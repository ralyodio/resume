'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Load .env
(function () {
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
})();

const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || '6323d706-92e1-453d-b591-9ceffa0fbdfd';
const STAGEHAND_MODEL = process.env.STAGEHAND_MODEL || 'claude-sonnet-4-5-20251001';
const RESUME_PDF = process.env.RESUME_PDF || path.resolve(__dirname, 'anthony.ettinger.resume4.pdf');
const COVER_PDF = process.env.COVER_PDF || path.resolve(__dirname, 'anthony.ettinger.cover4.pdf');
const STATE_DIR = '/tmp/dice-easyapply-daily';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const LOG_FILE = path.join(STATE_DIR, 'results.jsonl');
const COOKIE_FILE = path.join(os.homedir(), '.cache/hermes-dice-cookies.json');
const MAX_APPLY = Number(process.env.MAX_APPLY || 15);
const MAX_SCAN = Number(process.env.MAX_SCAN || 30);
const DRY_RUN = process.env.DRY_RUN === '1';
const SEARCHES = (process.env.SEARCHES || 'claude remote|AI engineer remote|LLM engineer remote|next.js remote').split('|').map(s => s.trim()).filter(Boolean);
const ACT_TIMEOUT = Number(process.env.STAGEHAND_ACT_TIMEOUT_MS || 45000);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms))]);
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, val) { fs.writeFileSync(file, JSON.stringify(val, null, 2)); }
function log(row) { fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n'); }

async function actSafe(stagehand, action) {
  try { await withTimeout(stagehand.act(action), ACT_TIMEOUT, action.slice(0, 50)); return true; } catch { return false; }
}
async function extractSafe(stagehand, instruction, schema) {
  try { return await withTimeout(stagehand.extract(instruction, schema), ACT_TIMEOUT, instruction.slice(0, 50)); } catch { return null; }
}

async function loadCookies() {
  try { return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8')); } catch { return []; }
}
async function saveCookies(context) {
  try {
    const cookies = await context.cookies('https://www.dice.com');
    fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  } catch {}
}

async function ensureLoggedIn(stagehand, z, page, context) {
  const cookies = await loadCookies();
  if (cookies.length) {
    try { await context.addCookies(cookies); } catch {}
  }

  await page.goto('https://www.dice.com/home-feed', { waitUntil: 'domcontentloaded' });
  await sleep(2500);

  const check = await extractSafe(stagehand, 'Is the user logged into Dice.com? Look for a logged-in home feed vs a sign-in page', z.object({ loggedIn: z.boolean() }));
  if (check?.loggedIn) return;

  const email = process.env.DICE_EMAIL;
  const password = process.env.DICE_PASSWORD;
  if (!email || !password) throw new Error('Not logged in and DICE_EMAIL/DICE_PASSWORD not set');

  await page.goto('https://www.dice.com/dashboard/login', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await actSafe(stagehand, `fill in the email field with "${email}"`);
  await actSafe(stagehand, 'click the Continue with email or Next button');
  await sleep(1500);
  await actSafe(stagehand, `fill in the password field with "${password}"`);
  await actSafe(stagehand, 'click the Sign In button');
  await sleep(3500);

  const mfaCheck = await extractSafe(stagehand, 'Is there a CAPTCHA or verification challenge on screen?', z.object({ challenge: z.boolean() }));
  if (mfaCheck?.challenge) throw new Error('Dice requires manual CAPTCHA/MFA. Complete it then rerun.');

  const afterLogin = await extractSafe(stagehand, 'Is the user now logged into Dice.com?', z.object({ loggedIn: z.boolean() }));
  if (!afterLogin?.loggedIn) throw new Error('Dice login failed. Check credentials in .env');

  await saveCookies(context);
}

async function scanJobs(stagehand, z, page, state) {
  const found = [];
  for (const q of SEARCHES) {
    const url = `https://www.dice.com/jobs?filters.easyApply=true&filters.workplaceTypes=Remote&q=${encodeURIComponent(q)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(4000);

    // Dismiss any dialogs
    await actSafe(stagehand, 'dismiss or close any popup dialogs or cookie banners if present');

    const results = await extractSafe(stagehand,
      'Extract all job listings visible on this Dice search results page. For each job get the job ID from the URL (the GUID after /job-detail/ or /job-applications/), the job title, company name, and the full job URL.',
      z.object({
        jobs: z.array(z.object({
          id: z.string(),
          title: z.string(),
          company: z.string().optional(),
          url: z.string(),
        }))
      })
    );

    for (const j of results?.jobs || []) {
      if (!j.id || !j.url) continue;
      if (state.applied?.[j.id] || state.alreadySubmitted?.[j.id] || state.skipped?.[j.id]) continue;
      if (found.find(x => x.id === j.id)) continue;
      found.push({ id: j.id, title: j.title, company: j.company || '', search: q, url: j.url });
      if (found.length >= MAX_SCAN) return found;
    }
  }
  return found;
}

async function applyToJob(stagehand, z, page, job) {
  const applyUrl = `https://www.dice.com/job-applications/${job.id}/wizard`;
  await page.goto(applyUrl, { waitUntil: 'domcontentloaded' });
  await sleep(4500);
  await actSafe(stagehand, 'dismiss or close any popup dialogs if present');

  const pageInfo = await extractSafe(stagehand, 'On this Dice application page: has this application already been submitted? Is there a resume upload section? What is the current state?', z.object({
    alreadySubmitted: z.boolean(),
    hasResumeSection: z.boolean(),
    currentState: z.string().optional(),
  }));

  if (pageInfo?.alreadySubmitted) return { status: 'already_submitted', reason: 'already submitted' };
  if (!pageInfo?.hasResumeSection) return { status: 'skipped', reason: 'application wizard not recognized' };

  // Upload resume
  if (fs.existsSync(RESUME_PDF)) {
    const resumeInputs = await page.$$('input[type="file"]');
    if (resumeInputs.length > 0) {
      try { await resumeInputs[0].setInputFiles(RESUME_PDF); await sleep(2000); } catch {}
    }
  }

  // Upload cover letter (second file input if present)
  if (fs.existsSync(COVER_PDF)) {
    const inputs = await page.$$('input[type="file"]');
    if (inputs.length > 1) {
      try { await inputs[inputs.length - 1].setInputFiles(COVER_PDF); await sleep(2000); } catch {}
    }
  }

  // Verify uploads
  const uploadCheck = await extractSafe(stagehand, 'Are the resume file "anthony.ettinger.resume4.pdf" and cover letter "anthony.ettinger.cover4.pdf" shown as attached on this page?', z.object({
    resumeAttached: z.boolean(),
    coverAttached: z.boolean(),
  }));

  if (!uploadCheck?.resumeAttached) return { status: 'skipped', reason: 'could not attach resume4.pdf' };

  if (DRY_RUN) return { status: 'dry_run_ready', reason: 'would submit after resume/cover attached' };

  // Click Next to proceed to review
  await actSafe(stagehand, 'click the Next button to proceed');
  await sleep(4000);
  await actSafe(stagehand, 'dismiss or close any popup dialogs if present');

  // Verify review screen
  const reviewCheck = await extractSafe(stagehand, 'Is this the "Review your application" screen showing the resume and work authorization (US Citizen)?', z.object({
    isReviewScreen: z.boolean(),
  }));

  if (!reviewCheck?.isReviewScreen) return { status: 'skipped', reason: 'review screen not recognized' };

  // Submit
  await actSafe(stagehand, 'click the Submit button to submit the application');
  await sleep(7000);
  await actSafe(stagehand, 'dismiss or close any popup dialogs if present');

  const result = await extractSafe(stagehand, 'Was the Dice application successfully submitted? Look for "Application submitted", "You applied", or similar confirmation', z.object({ success: z.boolean() }));
  if (result?.success) return { status: 'applied', reason: 'submitted' };
  return { status: 'unknown_after_submit', reason: 'submit clicked but confirmation not detected' };
}

async function main() {
  const { Stagehand } = require('@browserbasehq/stagehand');
  const { z } = require('zod');

  if (!fs.existsSync(RESUME_PDF)) throw new Error(`Resume PDF not found: ${RESUME_PDF}`);
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const state = loadJson(STATE_FILE, { applied: {}, skipped: {}, seen: {}, alreadySubmitted: {} });

  const useCloud = Boolean(process.env.BROWSERBASE_API_KEY);
  const stagehand = new Stagehand({
    env: useCloud ? 'BROWSERBASE' : 'LOCAL',
    apiKey: useCloud ? process.env.BROWSERBASE_API_KEY : undefined,
    projectId: useCloud ? BROWSERBASE_PROJECT_ID : undefined,
    modelName: STAGEHAND_MODEL,
    modelClientOptions: { apiKey: process.env.ANTHROPIC_API_KEY },
    verbose: process.env.STAGEHAND_VERBOSE === '1' ? 1 : 0,
    ...(!useCloud && { localBrowserLaunchOptions: { headless: true } }),
  });

  await stagehand.init();
  const context = stagehand.context;
  const page = context.pages()[0];

  try {
    await ensureLoggedIn(stagehand, z, page, context);
    const candidates = await scanJobs(stagehand, z, page, state);
    console.log(`scanned ${candidates.length} candidate(s)`);

    let submitted = 0;
    for (const c of candidates) {
      if (submitted >= MAX_APPLY) break;
      console.log(`checking ${c.id} ${c.title} | ${c.company}`);
      let result;
      try {
        result = await applyToJob(stagehand, z, page, c);
      } catch (e) {
        result = { status: 'error', reason: e.message };
      }
      const row = { jobId: c.id, title: c.title, company: c.company, url: c.url, search: c.search, status: result.status, reason: result.reason || '' };
      log(row);
      if (result.status === 'applied') { state.applied[c.id] = row; submitted++; }
      else if (result.status === 'already_submitted') { state.alreadySubmitted[c.id] = row; submitted++; }
      else if (result.status === 'skipped') state.skipped[c.id] = row;
      state.seen[c.id] = row;
      saveJson(STATE_FILE, state);
      console.log(`${result.status}: ${c.title} | ${c.company} | ${c.url} | ${result.reason}`);
      await sleep(1500);
    }

    await saveCookies(context);
    console.log(`done: submitted/already-submitted count this run=${submitted}; state=${STATE_FILE}; log=${LOG_FILE}`);
  } finally {
    await stagehand.close().catch(() => {});
  }
}

main().catch(err => { console.error(err.stack || err.message || String(err)); process.exit(1); });
