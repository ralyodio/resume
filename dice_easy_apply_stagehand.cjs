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
const MAX_APPLY = Number(process.env.MAX_APPLY || 999);
const MAX_SCAN = Number(process.env.MAX_SCAN || 500);
const DRY_RUN = process.env.DRY_RUN === '1';
const SEARCHES = (process.env.SEARCHES || 'claude|react').split('|').map(s => s.trim()).filter(Boolean);
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

  const homeText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  const loggedIn = /Anthony Ettinger|Profile Visibility|Your Profile|My Jobs|Recommended Jobs/i.test(homeText)
    && !/Sign In|Continue with email/i.test(homeText);
  if (loggedIn) { console.error('[dice] logged in via saved cookies'); return; }

  const email = process.env.DICE_EMAIL;
  const password = process.env.DICE_PASSWORD;
  if (!email || !password) throw new Error('Not logged in and DICE_EMAIL/DICE_PASSWORD not set');

  // Use page.evaluate to set values and fire React synthetic events
  function reactSet(sel, value) {
    return page.evaluate(({ sel, value }) => {
      const input = document.querySelector(sel);
      if (!input) return false;
      const nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      nativeInput.set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, { sel, value });
  }

  await page.goto('https://www.dice.com/dashboard/login', { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  // Step 1: email
  await reactSet('input[type="email"], input[name="email"], input[autocomplete="username"]', email);
  await sleep(300);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button,[role="button"]')).find(b => /continue|next/i.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
    if (btn) btn.click();
  });
  await sleep(2000);

  // Step 2: password
  await reactSet('input[type="password"], input[name="password"]', password);
  await sleep(300);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button,[role="button"]')).find(b => /sign in|log in|login/i.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
    if (btn) btn.click();
  });
  await sleep(5000);

  const afterText = await page.evaluate(() => document.body.innerText.slice(0, 300));
  if (/captcha|verification|multi-factor|security code/i.test(afterText))
    throw new Error('Dice requires manual CAPTCHA/MFA. Complete it then rerun.');

  // Dice search works even without login — don't hard-fail, just warn
  const stillOnLogin = page.url().includes('/login');
  if (stillOnLogin) console.error('[dice] Warning: login may have failed; proceeding as guest (search still works)');
  else await saveCookies(context);
}

function jobIdFromUrl(url) {
  return (url.match(/job-detail\/([^/?#]+)/) || url.match(/job-applications\/([^/?#]+)/))?.[1] || null;
}

async function scanJobs(stagehand, z, page, state) {
  const found = [];
  for (const q of SEARCHES) {
    let pageNum = 1;
    while (found.length < MAX_SCAN) {
      const url = `https://www.dice.com/jobs?filters.easyApply=true&filters.workplaceTypes=Remote&q=${encodeURIComponent(q)}&page=${pageNum}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await sleep(pageNum === 1 ? 5000 : 3000);
      if (pageNum === 1) await actSafe(stagehand, 'dismiss or close any popup dialogs or cookie banners if present');

      const items = await page.evaluate(() => {
        const byHref = new Map();
        for (const a of Array.from(document.querySelectorAll('a[href*="/job-detail/"]'))) {
          const href = a.href.split('?')[0];
          if (!byHref.has(href)) byHref.set(href, { href, texts: [] });
          const t = (a.innerText || a.getAttribute('aria-label') || '').trim();
          if (t) byHref.get(href).texts.push(t);
        }
        return Array.from(byHref.values());
      }).catch(() => []);

      if (!items.length) break; // no more results for this query

      let newOnPage = 0;
      for (const it of items) {
        const id = jobIdFromUrl(it.href);
        if (!id) continue;
        if (state.applied?.[id] || state.alreadySubmitted?.[id] || state.skipped?.[id]) continue;
        if (found.find(x => x.id === id)) continue;
        found.push({ id, title: it.texts[0] || 'Dice job', company: '', search: q, url: it.href });
        newOnPage++;
        if (found.length >= MAX_SCAN) return found;
      }

      if (newOnPage === 0) break; // all results on this page already seen
      pageNum++;
    }
  }
  return found;
}

async function applyToJob(stagehand, z, page, job) {
  // Go directly to wizard — jobs came from Easy Apply filter so wizard should exist
  const wizardUrl = `https://www.dice.com/job-applications/${job.id}/wizard`;
  await page.goto(wizardUrl, { waitUntil: 'domcontentloaded' });
  await sleep(5000);

  // Try to extract title/company from whatever page loaded
  const pageInfo = await page.evaluate(() => {
    const lines = document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
    return { title: document.title.split(' - ')[0] || '', lines: lines.slice(0, 20).join(' | ') };
  }).catch(() => ({ title: '', lines: '' }));
  if (pageInfo.title && !job.title.includes(pageInfo.title.slice(0, 20))) job.title = pageInfo.title;

  // Dismiss dialogs via direct JS
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('button,[role="button"],a'))) {
      const t = ((el.innerText || el.getAttribute('aria-label') || '').trim());
      if (/^(Dismiss|Close|No Thanks|Not now|Cancel|Got it|OK|Okay)$/i.test(t)) el.click();
    }
  }).catch(() => {});

  // Use direct page text check — same as original Puppeteer script
  const wizardText = await page.evaluate(() => document.body.innerText).catch(() => '');

  if (/already applied|application submitted|you applied/i.test(wizardText) && !/Submit\s*$/.test(wizardText)) {
    return { status: 'already_submitted', reason: 'dice shows already submitted' };
  }
  if (!/Resume \*/i.test(wizardText)) {
    return { status: 'skipped', reason: `application wizard not recognized: ${wizardText.slice(0, 80).replace(/\n/g, ' ')}` };
  }

  // Count file inputs
  const fileInputCount = await page.evaluate(() => document.querySelectorAll('input[type="file"]').length).catch(() => 0);

  // Upload resume using page-level setInputFiles (nth-match avoids pseudo-class issues)
  if (fileInputCount > 0 && fs.existsSync(RESUME_PDF)) {
    try { await page.locator('input[type="file"]').nth(0).setInputFiles(RESUME_PDF); await sleep(2000); } catch (e) {
      try { await page.setInputFiles('input[type="file"]', RESUME_PDF); await sleep(2000); } catch {}
    }
  }

  // Upload cover letter to second file input if multiple exist
  if (fileInputCount > 1 && fs.existsSync(COVER_PDF)) {
    try { await page.locator('input[type="file"]').nth(fileInputCount - 1).setInputFiles(COVER_PDF); await sleep(2000); } catch {}
  }

  // Verify uploads via page text
  const afterUpload = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (!/anthony\.ettinger\.resume4\.pdf/i.test(afterUpload)) {
    return { status: 'skipped', reason: 'could not attach resume4.pdf' };
  }

  if (DRY_RUN) return { status: 'dry_run_ready', reason: 'would submit after resume/cover attached' };

  // Click Next via direct JS
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button,[role="button"]')).find(b => /^Next$/i.test((b.innerText || '').trim()));
    if (btn) btn.click();
  });
  await sleep(4000);
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('button,[role="button"],a'))) {
      const t = ((el.innerText || el.getAttribute('aria-label') || '').trim());
      if (/^(Dismiss|Close|No Thanks|Not now|Cancel|Got it|OK|Okay)$/i.test(t)) el.click();
    }
  }).catch(() => {});

  const reviewText = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (!/anthony\.ettinger\.resume4\.pdf/i.test(reviewText)) {
    return { status: 'skipped', reason: 'review screen: resume not confirmed attached' };
  }

  // Submit
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button,[role="button"]')).find(b => /^Submit$/i.test((b.innerText || '').trim()));
    if (btn) btn.click();
  });
  await sleep(7000);
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('button,[role="button"],a'))) {
      const t = ((el.innerText || el.getAttribute('aria-label') || '').trim());
      if (/^(Dismiss|Close|No Thanks|Not now|Cancel|Got it|OK|Okay)$/i.test(t)) el.click();
    }
  }).catch(() => {});
  await page.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))).catch(() => {});
  await sleep(2000);

  const doneText = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (/application submitted|you applied|success|thank you|applied/i.test(doneText)) {
    return { status: 'applied', reason: 'submitted' };
  }
  return { status: 'unknown_after_submit', reason: doneText.replace(/\n/g, ' ').slice(0, 200) };
}

async function main() {
  const { Stagehand } = require('@browserbasehq/stagehand');
  const { z } = require('zod');

  if (!fs.existsSync(RESUME_PDF)) throw new Error(`Resume PDF not found: ${RESUME_PDF}`);
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const state = loadJson(STATE_FILE, { applied: {}, skipped: {}, seen: {}, alreadySubmitted: {} });

  const useCloud = Boolean(process.env.BROWSERBASE_API_KEY);

  function makeStagehand() {
    return new Stagehand({
      env: useCloud ? 'BROWSERBASE' : 'LOCAL',
      apiKey: useCloud ? process.env.BROWSERBASE_API_KEY : undefined,
      projectId: useCloud ? BROWSERBASE_PROJECT_ID : undefined,
      modelName: STAGEHAND_MODEL,
      modelClientOptions: { apiKey: process.env.ANTHROPIC_API_KEY },
      verbose: process.env.STAGEHAND_VERBOSE === '1' ? 1 : 0,
      ...(useCloud && { browserbaseSessionCreateParams: { projectId: BROWSERBASE_PROJECT_ID, timeout: 900 } }),
      ...(!useCloud && { localBrowserLaunchOptions: { headless: true } }),
    });
  }

  // Phase 1: scan — dedicated session
  const scanSh = makeStagehand();
  await scanSh.init();
  const scanCtx = scanSh.context;
  const scanPage = scanCtx.pages()[0];
  let candidates;
  try {
    await ensureLoggedIn(scanSh, z, scanPage, scanCtx);
    candidates = await scanJobs(scanSh, z, scanPage, state);
    await saveCookies(scanCtx);
  } finally {
    await scanSh.close().catch(() => {});
  }
  console.log(`scanned ${candidates.length} candidate(s)`);

  // Phase 2: apply — fresh session per job to avoid timeouts
  let submitted = 0;
  for (const c of candidates) {
    if (submitted >= MAX_APPLY) break;
    console.log(`checking ${c.id} ${c.title} | ${c.company}`);
    let result;
    const applySh = makeStagehand();
    try {
      await applySh.init();
      const applyCtx = applySh.context;
      const applyPage = applyCtx.pages()[0];
      const cookies = await loadCookies();
      if (cookies.length) await applyCtx.addCookies(cookies).catch(() => {});
      result = await applyToJob(applySh, z, applyPage, c);
      await saveCookies(applyCtx);
    } catch (e) {
      result = { status: 'error', reason: e.message };
    } finally {
      await applySh.close().catch(() => {});
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

  console.log(`done: submitted/already-submitted count this run=${submitted}; state=${STATE_FILE}; log=${LOG_FILE}`);
}

main().catch(err => { console.error(err.stack || err.message || String(err)); process.exit(1); });
