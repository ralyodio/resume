#!/usr/bin/env node
/*
 Daily LinkedIn Easy Apply runner.
 - Uses an existing authenticated Chromium profile: ~/.cache/hermes-linkedin-chrome
 - Uses resume PDF: ./anthony.ettinger.resume4.pdf by default
 - Applies only when questions can be answered from verified resume/profile defaults.
 - Records state/results in /tmp/linkedin-easyapply-daily/ so it is safe to rerun.

 Usage:
   cd /home/ettinger/Desktop/resume
   xvfb-run -a env MAX_APPLY=5 node linkedin_easy_apply_daily.cjs
   xvfb-run -a env DRY_RUN=1 node linkedin_easy_apply_daily.cjs
*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer');

const ROOT = '/tmp/linkedin-easyapply-daily';
const STATE_PATH = path.join(ROOT, 'state.json');
const RESULTS_PATH = path.join(ROOT, 'results.jsonl');
const DEBUG_DIR = path.join(ROOT, 'debug');
const RESUME_PDF = process.env.RESUME_PDF || path.resolve(process.cwd(), 'anthony.ettinger.resume4.pdf');
const USER_DATA_DIR = process.env.CHROME_PROFILE || path.join(os.homedir(), '.cache/hermes-linkedin-chrome');
const CHROME = process.env.CHROME || '/snap/bin/chromium';
const MAX_APPLY = Number(process.env.MAX_APPLY || 5);
const MAX_SCAN = Number(process.env.MAX_SCAN || 40);
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const HEADLESS = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
const SEARCHES = (process.env.SEARCHES || [
  'Claude OpenAI LLM engineer',
  'AI prompt engineer',
  'AI full stack engineer',
  'LLM software engineer',
  'OpenAI developer',
].join('|')).split('|').map(s => s.trim()).filter(Boolean);

const ANSWERS = {
  generalYears: 20,
  nodeYears: 10,
  reactYears: 8,
  typescriptYears: 5,
  svelteYears: 4,
  sqlYears: 5,
  aiYears: 2,
  zeroYears: 0,
};

function ensureDirs() {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function saveJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function appendResult(row) {
  fs.appendFileSync(RESULTS_PATH, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function jobIdFromUrl(url='') {
  const m = url.match(/\/jobs\/view\/(\d+)/) || url.match(/currentJobId=(\d+)/) || url.match(/jobId=(\d+)/);
  return m ? m[1] : null;
}

function isBadRemoteText(text='') {
  const t = text.toLowerCase();
  return /\bhybrid\b|\bonsite\b|on-site|in office|in-office|office per month|days\/month|days per week|must be located|local candidates/.test(t);
}

function isRelevantJob(text='') {
  const t = text.toLowerCase();
  // Keep the daily runner narrow: Claude/OpenAI/LLM/AI/agentic roles first.
  // Do not let the search keywords themselves make an unrelated card look relevant.
  const negative = /(e[- ]?commerce|\binfra(?:structure)?\b|infra core|tech lead|sales engineer|\bdevops\b|aws devops|servicenow|sharepoint|salesforce|rust programmer|\brust\b|blockchain.*subject matter expert|subject matter expert|general opportunity|product manager|project manager|program manager|scrum master|recruiter|marketing manager|solutions architect|systems? integration)/.test(t);
  if (negative) return false;
  const positive = /(claude|openai|\bllm\b|large language model|generative ai|\bgenai\b|prompt engineer|agentic|ai engineer|ai[- ]augmented|machine learning|ml engineer|founding engineer)/.test(t);
  return positive;
}

async function visibleText(page) {
  return await page.evaluate(() => document.body.innerText || '');
}

async function dump(page, name) {
  const safe = name.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 120);
  const file = path.join(DEBUG_DIR, `${safe}.txt`);
  fs.writeFileSync(file, await visibleText(page));
  return file;
}

async function clickByText(page, selector, regex) {
  return await page.evaluate((selector, source, flags) => {
    const rx = new RegExp(source, flags);
    const els = Array.from(document.querySelectorAll(selector));
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const el = els.find(e => !e.disabled && visible(e) && rx.test((e.innerText || e.getAttribute('aria-label') || '').trim()));
    if (!el) return false;
    el.click();
    return true;
  }, selector, regex.source, regex.flags);
}

async function setInputValue(page, el, value) {
  await el.focus();
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.press('A');
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.type(String(value));
}

async function scanJobs(page, state) {
  const found = [];
  for (const keywords of SEARCHES) {
    const url = new URL('https://www.linkedin.com/jobs/search/');
    url.searchParams.set('keywords', keywords);
    url.searchParams.set('location', 'United States');
    url.searchParams.set('f_AL', 'true');
    url.searchParams.set('f_WT', '2'); // remote
    url.searchParams.set('sortBy', 'DD');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(1000);
    }
    const jobs = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('li, .job-card-container, .jobs-search-results__list-item'));
      return cards.map(card => {
        const a = card.querySelector('a[href*="/jobs/view/"]');
        if (!a) return null;
        const href = new URL(a.href, location.origin).href;
        const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
        const title = (a.innerText || text.split(' · ')[0] || '').replace(/\s+/g, ' ').trim();
        return { href, text, title };
      }).filter(Boolean);
    });
    for (const j of jobs) {
      const id = jobIdFromUrl(j.href);
      if (!id || state.applied[id] || state.skipped[id] || found.find(x => x.id === id)) continue;
      const text = j.text || '';
      if (!/easy apply/i.test(text)) continue;
      if (!/remote/i.test(text)) continue;
      if (!isRelevantJob(`${j.title}\n${text}`)) continue;
      found.push({ id, url: `https://www.linkedin.com/jobs/view/${id}/`, title: j.title || 'LinkedIn job', search: keywords, cardText: text });
      if (found.length >= MAX_SCAN) return found;
    }
  }
  return found;
}

async function classifyJobPage(page, job) {
  await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  const text = await visibleText(page);
  const title = await page.evaluate(() => {
    const h = document.querySelector('h1');
    return (h?.innerText || document.title || '').replace(/\s+/g, ' ').trim();
  });
  const company = await page.evaluate(() => {
    const sels = ['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', 'a[href*="/company/"]'];
    for (const s of sels) {
      const el = document.querySelector(s);
      const txt = (el?.innerText || '').replace(/\s+/g, ' ').trim();
      if (txt) return txt;
    }
    return '';
  });
  if (/Application submitted/i.test(text)) return { ok: false, status: 'already_submitted', title, company };
  if (isBadRemoteText(text)) return { ok: false, status: 'skip_location_or_hybrid_text', title, company };
  if (!isRelevantJob(`${title}\n${company}\n${text}`)) return { ok: false, status: 'skip_off_target_role', title, company };
  return { ok: true, title, company };
}

async function chooseSelects(page) {
  return await page.evaluate(() => {
    const changes = [];
    for (const sel of Array.from(document.querySelectorAll('select'))) {
      if (sel.disabled) continue;
      const label = (document.querySelector(`label[for="${CSS.escape(sel.id || '')}"]`)?.innerText || sel.closest('label')?.innerText || sel.getAttribute('aria-label') || '').trim();
      const options = Array.from(sel.options).map(o => ({ value: o.value, text: o.innerText.trim() })).filter(o => o.value && !/^select/i.test(o.text));
      if (!options.length) continue;
      let pick = null;
      const low = label.toLowerCase();
      if (/email/.test(low)) pick = options[0];
      else if (/country|phone.*code/.test(low)) pick = options.find(o => /united states|\+1|usa/i.test(o.text));
      else if (/sponsor|visa/.test(low)) pick = options.find(o => /^no\b/i.test(o.text));
      if (pick && sel.value !== pick.value) {
        sel.value = pick.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        changes.push({ label, value: pick.text });
      }
    }
    return changes;
  });
}

function yearsForLabel(label) {
  const l = label.toLowerCase();
  if (/python|aws|azure|django/.test(l)) return ANSWERS.zeroYears;
  if (/sql|postgres|database|mongodb|supabase/.test(l)) return ANSWERS.sqlYears;
  if (/ai|llm|openai|claude|prompt|generative/.test(l)) return ANSWERS.aiYears;
  if (/svelte/.test(l)) return ANSWERS.svelteYears;
  if (/typescript/.test(l)) return ANSWERS.typescriptYears;
  if (/react/.test(l)) return ANSWERS.reactYears;
  if (/node|node\.js|express/.test(l)) return ANSWERS.nodeYears;
  if (/software|engineer|javascript|frontend|front-end|backend|back-end|full.?stack/.test(l)) return ANSWERS.generalYears;
  return null;
}

function yesNoForLabel(label) {
  const l = label.toLowerCase();
  if (/sponsor|visa/.test(l)) return 'No';
  if (/authorized|authorised|eligible.*work|work.*authorized|legally.*work/.test(l)) return 'Yes';
  if (/remote/.test(l)) return 'Yes';
  if (/background check/.test(l)) return 'Yes';
  if (/contract/.test(l)) return 'Yes';
  // Do NOT answer broad location/hybrid/willing/comfortable questions automatically.
  return null;
}

async function fillInputs(page) {
  const unknown = [];
  const handles = await page.$$('input:not([type="hidden"]):not([type="file"]), textarea');
  for (const el of handles) {
    const info = await el.evaluate(e => {
      const id = e.id || '';
      const label = (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText : '') || e.closest('label')?.innerText || e.getAttribute('aria-label') || e.placeholder || '';
      const type = e.getAttribute('type') || e.tagName.toLowerCase();
      const value = e.value || '';
      const required = e.required || e.getAttribute('aria-required') === 'true';
      const visible = (() => { const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden'; })();
      return { label: label.replace(/\s+/g, ' ').trim(), type, value, required, visible };
    });
    if (!info.visible || info.value) continue;
    const l = info.label.toLowerCase();
    let value = null;
    if (/middle name/.test(l)) value = '';
    else if (/phone/.test(l)) value = process.env.LI_PHONE || null;
    else if (/portfolio|website|personal site/.test(l)) value = 'https://profullstack.com';
    else if (/linkedin/.test(l)) value = 'https://www.linkedin.com/in/profullstack/';
    else if (/github/.test(l)) value = 'https://github.com/profullstack';
    else if (/years|how many/.test(l) || /sql|python|aws|azure|django|typescript|react|svelte|node|llm|openai|claude/i.test(info.label)) value = yearsForLabel(info.label);
    else if (/salary|compensation|rate|cover letter|why|explain|describe|address|city|zip|postal/.test(l)) value = null;
    if (value !== null) await setInputValue(page, el, value);
    else if (info.required) unknown.push({ type: info.type.toUpperCase(), label: info.label });
  }
  return unknown;
}

async function fillRadios(page) {
  return await page.evaluate(() => {
    const unknown = [];
    const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(r => {
      const box = r.getBoundingClientRect();
      return !r.disabled && box.width >= 0 && box.height >= 0;
    });
    const groups = [...new Set(radios.map(r => r.name).filter(Boolean))];
    for (const name of groups) {
      const group = radios.filter(r => r.name === name);
      if (!group.length || group.some(r => r.checked)) continue;
      const fieldset = group[0].closest('fieldset');
      const legend = fieldset?.querySelector('legend')?.innerText || '';
      const labelText = legend || fieldset?.innerText || group[0].closest('[data-test-form-builder-radio-button-form-component], .fb-dash-form-element')?.innerText || '';
      const l = labelText.toLowerCase();
      let want = null;
      if (/sponsor|visa/.test(l)) want = 'no';
      else if (/authorized|authorised|eligible.*work|work.*authorized|legally.*work/.test(l)) want = 'yes';
      else if (/remote/.test(l)) want = 'yes';
      else if (/background check/.test(l)) want = 'yes';
      else if (/contract/.test(l)) want = 'yes';
      if (!want) { unknown.push({ type: 'RADIO', label: labelText.replace(/\s+/g, ' ').trim().slice(0, 200) }); continue; }
      const pick = group.find(r => {
        const id = r.id || '';
        const txt = (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText : '') || r.closest('label')?.innerText || r.value || '';
        return txt.trim().toLowerCase().startsWith(want);
      });
      if (pick) {
        pick.click();
        pick.dispatchEvent(new Event('input', { bubbles: true }));
        pick.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        unknown.push({ type: 'RADIO', label: labelText.replace(/\s+/g, ' ').trim().slice(0, 200) });
      }
    }
    return unknown;
  });
}

async function uploadResume(page) {
  const inputs = await page.$$('input[type="file"]');
  for (const input of inputs) {
    try { await input.uploadFile(RESUME_PDF); await sleep(1000); } catch {}
  }
}

async function requiredUnknowns(page) {
  return await page.evaluate(() => {
    const out = [];
    const fields = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea, select'));
    for (const e of fields) {
      const visible = (() => { const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden'; })();
      if (!visible || !(e.required || e.getAttribute('aria-required') === 'true')) continue;
      if (e.type === 'radio') continue;
      if (!e.value) {
        const id = e.id || '';
        const label = (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText : '') || e.closest('label')?.innerText || e.getAttribute('aria-label') || e.placeholder || '';
        out.push({ type: e.tagName, label: label.replace(/\s+/g, ' ').trim().slice(0, 200) });
      }
    }
    return out;
  });
}

async function closeModal(page) {
  await clickByText(page, 'button', /dismiss|close|discard/i).catch(() => false);
  await sleep(500);
  await page.keyboard.press('Escape').catch(() => {});
}

async function applyToJob(page, job, state) {
  const pageInfo = await classifyJobPage(page, job);
  job.title = pageInfo.title || job.title;
  job.company = pageInfo.company || job.company || '';
  if (!pageInfo.ok) return { status: pageInfo.status, job };

  const applyUrl = `https://www.linkedin.com/jobs/view/${job.id}/apply/?openSDUIApplyFlow=true`;
  await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  let text = await visibleText(page);
  if (/Application submitted/i.test(text)) return { status: 'already_submitted', job };
  if (!/Submit application|Contact info|Resume|Apply to/i.test(text)) {
    await clickByText(page, 'button,a', /^Easy Apply$/i);
    await sleep(2000);
    text = await visibleText(page);
  }
  if (!/Submit application|Contact info|Resume|Apply to/i.test(text)) {
    const debug = await dump(page, `${job.id}_no_easy_apply`);
    return { status: 'skip_no_easy_apply_modal', job, debug };
  }

  for (let step = 0; step < 8; step++) {
    await uploadResume(page);
    await chooseSelects(page);
    const inputUnknown = await fillInputs(page);
    const radioUnknown = await fillRadios(page);
    await sleep(500);
    const reqUnknown = await requiredUnknowns(page);
    const unknown = [...inputUnknown, ...radioUnknown, ...reqUnknown]
      .filter(x => x.label && !/middle name/i.test(x.label));
    if (unknown.length) {
      const debug = await dump(page, `${job.id}_unknown_questions`);
      await closeModal(page);
      return { status: 'skip_unknown_questions', job, unknown, debug };
    }

    if (DRY_RUN) {
      const debug = await dump(page, `${job.id}_dry_run_ready`);
      await closeModal(page);
      return { status: 'dry_run_ready_to_submit', job, debug };
    }

    if (await clickByText(page, 'button', /^Submit application$/i)) {
      await sleep(3000);
      const doneText = await visibleText(page);
      if (/Application submitted|Your application was sent|Applied/i.test(doneText)) return { status: 'applied', job };
      const debug = await dump(page, `${job.id}_submit_uncertain`);
      return { status: 'submitted_uncertain', job, debug };
    }
    if (await clickByText(page, 'button', /^Review$/i)) { await sleep(1500); continue; }
    if (await clickByText(page, 'button', /^Next$/i)) { await sleep(1500); continue; }

    const debug = await dump(page, `${job.id}_stuck_step_${step}`);
    await closeModal(page);
    return { status: 'skip_stuck', job, debug };
  }
  const debug = await dump(page, `${job.id}_too_many_steps`);
  await closeModal(page);
  return { status: 'skip_too_many_steps', job, debug };
}

async function main() {
  ensureDirs();
  if (!fs.existsSync(RESUME_PDF)) throw new Error(`Resume PDF not found: ${RESUME_PDF}`);
  const state = loadJson(STATE_PATH, { applied: {}, skipped: {}, seen: {} });
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    executablePath: CHROME,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--start-maximized'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2500);
    const t = await visibleText(page);
    if (/sign in|join now|email or phone/i.test(t) && !/start a post|feed/i.test(t)) {
      throw new Error(`LinkedIn session is not logged in. Open Chromium with profile ${USER_DATA_DIR} and login manually.`);
    }
    const candidates = await scanJobs(page, state);
    console.log(`scanned ${candidates.length} new candidate(s)`);
    let submitted = 0;
    for (const job of candidates) {
      if (submitted >= MAX_APPLY) break;
      if (state.applied[job.id] || state.skipped[job.id]) continue;
      console.log(`checking ${job.id} ${job.title}`);
      const result = await applyToJob(page, job, state);
      appendResult(result);
      if (['applied', 'already_submitted', 'submitted_uncertain'].includes(result.status)) {
        state.applied[job.id] = result;
        submitted++;
      } else if (result.status.startsWith('skip_')) {
        state.skipped[job.id] = result;
      }
      // Dry runs are logged in results.jsonl but not stored as skipped, so a real run can submit them later.
      state.seen[job.id] = result;
      saveJson(STATE_PATH, state);
      console.log(`${result.status}: ${job.title} ${job.url}`);
      await sleep(1500);
    }
    console.log(`done: submitted/already-submitted count this run=${submitted}; state=${STATE_PATH}; log=${RESULTS_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
