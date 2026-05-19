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
const STATE_DIR = '/tmp/linkedin-easyapply-daily';
const STATE_PATH = path.join(STATE_DIR, 'state.json');
const RESULTS_PATH = path.join(STATE_DIR, 'results.jsonl');
const COOKIE_FILE = path.join(os.homedir(), '.cache/hermes-linkedin-cookies.json');
const MAX_APPLY = Number(process.env.MAX_APPLY || 5);
const MAX_SCAN = Number(process.env.MAX_SCAN || 40);
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
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
function appendResult(row) { fs.appendFileSync(RESULTS_PATH, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n'); }

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
    const cookies = await context.cookies('https://www.linkedin.com');
    fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  } catch {}
}

async function ensureLoggedIn(stagehand, z, page, context) {
  const cookies = await loadCookies();
  if (cookies.length) {
    try { await context.addCookies(cookies); } catch {}
  }

  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await sleep(2500);

  const check = await extractSafe(stagehand, 'Is the user currently logged into LinkedIn? Look for the home feed vs a sign-in page', z.object({ loggedIn: z.boolean() }));
  if (check?.loggedIn) return;

  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  if (!email || !password) throw new Error('Not logged in and LINKEDIN_EMAIL/LINKEDIN_PASSWORD not set');

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  await sleep(1000);
  await actSafe(stagehand, `fill in the email or username field with "${email}"`);
  await actSafe(stagehand, `fill in the password field with "${password}"`);
  await actSafe(stagehand, 'click the Sign In button');
  await sleep(4000);

  const mfaCheck = await extractSafe(stagehand, 'Is there a CAPTCHA, verification code, or multi-factor authentication challenge on the screen?', z.object({ challenge: z.boolean() }));
  if (mfaCheck?.challenge) throw new Error('LinkedIn requires manual MFA/CAPTCHA. Complete it then rerun.');

  const afterLogin = await extractSafe(stagehand, 'Is the user now logged into LinkedIn?', z.object({ loggedIn: z.boolean() }));
  if (!afterLogin?.loggedIn) throw new Error('LinkedIn login failed. Check credentials in .env');

  await saveCookies(context);
}

async function scanJobs(stagehand, z, page, state) {
  const { z: _z } = require('zod');
  const found = [];
  for (const keywords of SEARCHES) {
    const url = new URL('https://www.linkedin.com/jobs/search/');
    url.searchParams.set('keywords', keywords);
    url.searchParams.set('location', 'United States');
    url.searchParams.set('f_AL', 'true'); // Easy Apply only
    url.searchParams.set('f_WT', '2');    // Remote
    url.searchParams.set('sortBy', 'DD');

    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(800);
    }

    // Direct JS scraping — more reliable than extract() for card lists
    const cards = await page.evaluate(() => {
      const results = [];
      for (const a of Array.from(document.querySelectorAll('a[href*="/jobs/view/"]'))) {
        const m = a.href.match(/\/jobs\/view\/(\d+)/);
        if (!m) continue;
        const card = a.closest('li, [data-job-id]') || a.parentElement;
        const text = (card?.innerText || a.innerText || '').replace(/\s+/g, ' ').trim();
        if (!/easy apply/i.test(text)) continue;
        const title = (a.innerText || '').replace(/\s+/g, ' ').trim() || 'LinkedIn job';
        results.push({ id: m[1], title, text });
      }
      return results;
    }).catch(() => []);

    for (const j of cards) {
      if (state.applied?.[j.id] || state.skipped?.[j.id]) continue;
      if (found.find(x => x.id === j.id)) continue;
      found.push({ id: j.id, title: j.title, company: '', search: keywords, url: `https://www.linkedin.com/jobs/view/${j.id}/` });
      if (found.length >= MAX_SCAN) return found;
    }
  }
  return found;
}

async function applyToJob(stagehand, z, page, job) {
  const applyUrl = `https://www.linkedin.com/jobs/view/${job.id}/`;
  await page.goto(applyUrl, { waitUntil: 'domcontentloaded' });
  await sleep(2500);

  const pageInfo = await extractSafe(stagehand, 'On this LinkedIn job page: what is the job title, company name, is there an Easy Apply button, and has this application already been submitted?', z.object({
    title: z.string().optional(),
    company: z.string().optional(),
    hasEasyApply: z.boolean(),
    alreadyApplied: z.boolean(),
  }));

  if (pageInfo?.alreadyApplied) return { status: 'already_submitted', job };
  if (!pageInfo?.hasEasyApply) return { status: 'skip_no_easy_apply', job };

  job.title = pageInfo?.title || job.title;
  job.company = pageInfo?.company || job.company;

  await actSafe(stagehand, 'click the Easy Apply button');
  await sleep(2000);

  for (let step = 0; step < 8; step++) {
    // Upload resume if there's a file input
    if (fs.existsSync(RESUME_PDF)) {
      const fileInputs = await page.$$('input[type="file"]');
      for (const input of fileInputs) {
        try { await input.setInputFiles(RESUME_PDF); await sleep(1000); } catch {}
      }
    }

    // Use AI to fill the form
    await actSafe(stagehand, `fill in any empty phone number field with "${process.env.HERMES_APPLICANT_PHONE || '+14086562473'}"`);
    await actSafe(stagehand, 'for any years of experience questions: software engineering = 20 years, Node.js = 10 years, React = 8 years, TypeScript = 5 years, AI/LLM = 2 years, answer 0 for Python/AWS/Django');
    await actSafe(stagehand, 'for any yes/no questions: answer "Yes" to work authorization, "No" to visa sponsorship, "Yes" to background check, "Yes" to remote work');
    await actSafe(stagehand, 'select country code "United States (+1)" for phone if asked');

    const unknowns = await extractSafe(stagehand, 'Are there any required form fields that are still empty and cannot be answered from standard profile info (not phone, years of experience, or work authorization)?', z.object({
      hasUnknowns: z.boolean(),
      fields: z.array(z.string()).optional(),
    }));

    if (unknowns?.hasUnknowns) {
      await actSafe(stagehand, 'close or dismiss the application modal');
      return { status: 'skip_unknown_questions', job, unknown: unknowns.fields };
    }

    if (DRY_RUN) {
      await actSafe(stagehand, 'close or dismiss the application modal');
      return { status: 'dry_run_ready', job };
    }

    const submitted = await actSafe(stagehand, 'click the "Submit application" button if it is visible and enabled');
    if (submitted) {
      await sleep(3000);
      const result = await extractSafe(stagehand, 'Was the LinkedIn job application successfully submitted? Look for "Application submitted" or similar confirmation', z.object({ success: z.boolean() }));
      if (result?.success) return { status: 'applied', job };
      return { status: 'submitted_uncertain', job };
    }

    const next = await actSafe(stagehand, 'click the "Next" or "Review" button to go to the next step of the application');
    if (!next) {
      await actSafe(stagehand, 'close or dismiss the application modal');
      return { status: 'skip_stuck', job };
    }
    await sleep(1500);
  }

  await actSafe(stagehand, 'close or dismiss the application modal');
  return { status: 'skip_too_many_steps', job };
}

async function main() {
  const { Stagehand } = require('@browserbasehq/stagehand');
  const { z } = require('zod');

  if (!fs.existsSync(RESUME_PDF)) throw new Error(`Resume PDF not found: ${RESUME_PDF}`);
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const state = loadJson(STATE_PATH, { applied: {}, skipped: {}, seen: {} });

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
    console.log(`scanned ${candidates.length} new candidate(s)`);

    let submitted = 0;
    for (const job of candidates) {
      if (submitted >= MAX_APPLY) break;
      if (state.applied?.[job.id] || state.skipped?.[job.id]) continue;
      console.log(`checking ${job.id} ${job.title} @ ${job.company}`);
      let result;
      try {
        result = await applyToJob(stagehand, z, page, job);
      } catch (e) {
        result = { status: 'error', reason: e.message };
      }
      const row = { jobId: job.id, title: job.title, company: job.company, url: job.url, search: job.search, status: result.status, reason: result.reason || '' };
      appendResult(row);
      if (['applied', 'already_submitted', 'submitted_uncertain'].includes(result.status)) {
        state.applied[job.id] = row;
        submitted++;
      } else if (result.status.startsWith('skip_')) {
        state.skipped[job.id] = row;
      }
      state.seen[job.id] = row;
      saveJson(STATE_PATH, state);
      console.log(`${result.status}: ${job.title} | ${job.company} | ${job.url}`);
      await sleep(1500);
    }

    await saveCookies(context);
    console.log(`done: submitted/already-submitted count this run=${submitted}; state=${STATE_PATH}; log=${RESULTS_PATH}`);
  } finally {
    await stagehand.close().catch(() => {});
  }
}

main().catch(err => { console.error(err.stack || err.message || String(err)); process.exit(1); });
