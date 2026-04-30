const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const RESUME_PDF = process.env.RESUME_PDF || '/home/ettinger/Desktop/resume/anthony.ettinger.resume4.pdf';
const COVER_PDF = process.env.COVER_PDF || '/home/ettinger/Desktop/resume/anthony.ettinger.cover4.pdf';
const CHROME_PROFILE = process.env.CHROME_PROFILE || `${process.env.HOME}/.cache/hermes-dice-chrome`;
const STATE_DIR = process.env.STATE_DIR || '/tmp/dice-easyapply-daily';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const LOG_FILE = path.join(STATE_DIR, 'results.jsonl');
const MAX_SCAN = Number(process.env.MAX_SCAN || 30);
const MAX_APPLY = Number(process.env.MAX_APPLY || 15);
const DRY_RUN = process.env.DRY_RUN === '1';
const EMPLOYMENT_FILTER = process.env.EMPLOYMENT_FILTER || ''; // e.g. CONTRACTS, FULLTIME, PARTTIME
const EMPLOYER_TYPE = process.env.EMPLOYER_TYPE || ''; // e.g. Direct Hire
const SEARCHES = (process.env.SEARCHES || 'Claude|OpenAI Codex|Claude Code|AI Full Stack Engineer|LLM Engineer|GenAI Engineer|Agentic AI Engineer').split('|').map(s=>s.trim()).filter(Boolean);

fs.mkdirSync(STATE_DIR, {recursive:true});
for (const f of [RESUME_PDF, COVER_PDF]) if (!fs.existsSync(f)) throw new Error(`Missing file: ${f}`);
let state = {seen:{}, applied:{}, skipped:{}, alreadySubmitted:{}};
if (fs.existsSync(STATE_FILE)) state = {...state, ...JSON.parse(fs.readFileSync(STATE_FILE,'utf8'))};
function saveState(){ fs.writeFileSync(STATE_FILE, JSON.stringify(state,null,2)); }
function log(row){ fs.appendFileSync(LOG_FILE, JSON.stringify({ts:new Date().toISOString(), ...row})+'\n'); }
function jobIdFromUrl(url){ return (url.match(/job-detail\/([^/?#]+)/)||[])[1] || (url.match(/job-applications\/([^/?#]+)/)||[])[1]; }
function norm(s){ return (s||'').replace(/\s+/g,' ').trim(); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function isRelevant(text){
  const t = text.toLowerCase();
  const strong = /gen\s*ai|genai|generative ai|claude|anthropic|openai|codex|llm|agentic|ai\s*\/\s*ml|ai\s*\/\s*llm|ai engineer|ai native software engineer|full stack ai engineer|ai full stack|fullstack|full stack|front[- ]?end|backend|back[- ]?end|web developer|web engineer|software developer|software engineer|node|react|svelte|typescript|javascript/.test(t);
  if (!strong) return false;
  // Exclude only if the role is clearly outside the user's software/AI/web engineering wheelhouse.
  if (/salesforce admin|servicenow|scrum master|project manager|product manager|recruiter|sales engineer|support content producer|pki engineer|business analyst/.test(t)) return false;
  return true;
}
function isRemoteJob(text){
  const t = text.toLowerCase();
  // The Dice Remote filter is authoritative enough for first pass. Only reject explicit constraints in the actual job detail,
  // not unrelated recommended-job text elsewhere on the page.
  if (/\b(hybrid|onsite|on-site|on site)\b/.test(t)) return false;
  if (/local candidates only|3 days onsite|3 days in the office|5 days onsite|must be located|must live in|must reside in|relocation required|travel required/.test(t)) return false;
  return true;
}
async function dismissDialogs(page){
  const clicks = await page.evaluate(()=>{
    let n=0;
    for (const el of Array.from(document.querySelectorAll('button,[role="button"],a'))) {
      const txt = ((el.innerText||el.getAttribute('aria-label')||'').trim());
      if (/^(Dismiss|Close|No Thanks|Not now|Cancel|Got it|OK|Okay)$/i.test(txt)) { el.click(); n++; }
    }
    return n;
  }).catch(()=>0);
  if (clicks) await sleep(500);
}
async function clickText(page, re, selectors='button,a,[role="button"],[role="menuitem"]'){
  return await page.evaluate((src,flags,selectors)=>{
    const rx = new RegExp(src, flags);
    const els = Array.from(document.querySelectorAll(selectors));
    const el = els.find(e => rx.test(((e.innerText||e.getAttribute('aria-label')||'').trim())) && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
    if (!el) return false;
    el.scrollIntoView({block:'center', inline:'center'});
    el.focus?.();
    el.click();
    el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, view:window}));
    el.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, view:window}));
    el.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
    return true;
  }, re.source, re.flags, selectors);
}
async function scrapeSearch(page, q){
  const employment = EMPLOYMENT_FILTER ? `&filters.employmentType=${encodeURIComponent(EMPLOYMENT_FILTER)}` : '';
  const employerType = EMPLOYER_TYPE ? `&filters.employerType=${encodeURIComponent(EMPLOYER_TYPE).replace(/%20/g, '+')}` : '';
  const url = `https://www.dice.com/jobs?filters.easyApply=true${employment}${employerType}&filters.workplaceTypes=Remote&q=${encodeURIComponent(q)}`;
  await page.goto(url, {waitUntil:'domcontentloaded', timeout:60000});
  await sleep(5000);
  await dismissDialogs(page);
  return await page.evaluate(()=>{
    const byHref = new Map();
    for (const a of Array.from(document.querySelectorAll('a[href*="/job-detail/"]'))) {
      const href = a.href.split('?')[0];
      if (!byHref.has(href)) byHref.set(href, []);
      byHref.get(href).push((a.innerText || a.getAttribute('aria-label') || '').trim());
    }
    const body = document.body.innerText;
    return Array.from(byHref.entries()).map(([href,texts])=>({href, texts, body: body.slice(0,12000)}));
  });
}
async function detail(page, href){
  await page.goto(href, {waitUntil:'domcontentloaded', timeout:60000});
  await sleep(3500);
  await dismissDialogs(page);
  return await page.evaluate(()=>{
    const text = document.body.innerText;
    const lines = text.split('\n').map(s=>s.trim()).filter(Boolean);
    const applyHref = Array.from(document.querySelectorAll('a[href*="/job-applications/"]')).map(a=>a.href)[0] || '';
    const titleIdx = lines.findIndex(l=>/^Apply$|^Applied$/.test(l));
    let company = lines[lines.findIndex(l=>/^Apply$|^Applied$/.test(l))-1] || '';
    let title = titleIdx>=0 ? lines[titleIdx+1] : (document.title.split(' - ')[0] || '');
    return {url: location.href, title, company, text, applyHref};
  });
}
async function uploadResumeIfNeeded(page){
  const text = await page.evaluate(()=>document.body.innerText);
  if (/anthony\.ettinger\.resume4\.pdf/i.test(text)) return true;
  await clickText(page, /file options/i);
  await sleep(800);
  const clicked = await clickText(page, /^Replace$/i, 'button,[role="menuitem"],div,span');
  await sleep(1000);
  const inputs = await page.$$('input[type=file]');
  if (!clicked || !inputs.length) return false;
  await inputs[0].uploadFile(RESUME_PDF);
  await sleep(3500);
  return /anthony\.ettinger\.resume4\.pdf/i.test(await page.evaluate(()=>document.body.innerText));
}
async function uploadCoverIfNeeded(page){
  const text = await page.evaluate(()=>document.body.innerText);
  if (/anthony\.ettinger\.cover4\.pdf/i.test(text)) return true;
  const inputs = await page.$$('input[type=file]');
  if (!inputs.length) return false;
  await inputs[inputs.length-1].uploadFile(COVER_PDF);
  await sleep(3000);
  return /anthony\.ettinger\.cover4\.pdf/i.test(await page.evaluate(()=>document.body.innerText));
}
async function applyJob(page, job){
  const id = job.id;
  const applyUrl = `https://www.dice.com/job-applications/${id}/wizard`;
  await page.goto(applyUrl, {waitUntil:'domcontentloaded', timeout:60000});
  await sleep(4500);
  await dismissDialogs(page);
  let text = await page.evaluate(()=>document.body.innerText);
  if (/already applied|application submitted|you applied|applied/i.test(text) && !/Submit\s*$/.test(text)) return {status:'already_submitted', reason:'dice shows already submitted'};
  if (!/Resume \*/i.test(text)) return {status:'skipped', reason:'application wizard not recognized'};
  const resumeOk = await uploadResumeIfNeeded(page);
  const coverOk = await uploadCoverIfNeeded(page);
  text = await page.evaluate(()=>document.body.innerText);
  if (!resumeOk || !/anthony\.ettinger\.resume4\.pdf/i.test(text)) return {status:'skipped', reason:'could not attach resume4.pdf'};
  if (!coverOk || !/anthony\.ettinger\.cover4\.pdf/i.test(text)) return {status:'skipped', reason:'could not attach cover4.pdf'};
  if (DRY_RUN) return {status:'dry_run_ready', reason:'would submit after resume4/cover4 attached'};
  await clickText(page, /^Next$/i);
  await sleep(4000);
  await dismissDialogs(page);
  text = await page.evaluate(()=>document.body.innerText);
  if (!/Review your application/i.test(text) || !/US Citizen/i.test(text) || !/anthony\.ettinger\.resume4\.pdf/i.test(text)) return {status:'skipped', reason:'review screen missing expected resume/work authorization'};
  await clickText(page, /^Submit$/i);
  await sleep(2000);
  await dismissDialogs(page);
  await page.keyboard.press('Enter').catch(()=>{});
  await sleep(7000);
  await dismissDialogs(page);
  text = await page.evaluate(()=>document.body.innerText);
  if (/application submitted|you applied|success|thank you|applied/i.test(text)) return {status:'applied', reason:'submitted'};
  return {status:'unknown_after_submit', reason:norm(text).slice(0,400)};
}
(async()=>{
  const browser = await puppeteer.launch({headless:false, executablePath:'/snap/bin/chromium', userDataDir:CHROME_PROFILE, defaultViewport:null, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--start-maximized']});
  let page = await browser.newPage(); page.setDefaultTimeout(30000);
  page.on('dialog', async d => {
    console.log(`dialog:${d.type()}:${d.message()}`);
    try {
      if (d.type() === 'beforeunload') await d.accept();
      else await d.dismiss();
    } catch {}
  });
  const candidates = [];
  for (const q of SEARCHES) {
    const items = await scrapeSearch(page, q);
    for (const it of items) {
      const id = jobIdFromUrl(it.href); if (!id || state.applied[id] || state.alreadySubmitted[id]) continue;
      const label = norm(it.texts.filter(Boolean).join(' | '));
      if (!/easy apply/i.test(label)) continue;
      if (!isRelevant(label)) continue;
      candidates.push({id, href:it.href, search:q, label});
      if (candidates.length >= MAX_SCAN) break;
    }
    if (candidates.length >= MAX_SCAN) break;
  }
  const uniq = Array.from(new Map(candidates.map(c=>[c.id,c])).values());
  console.log(`scanned ${uniq.length} candidate(s)`);
  let submitted = 0;
  for (const c of uniq) {
    if (submitted >= MAX_APPLY) break;
    if (!page || page.isClosed()) {
      page = await browser.newPage();
      page.setDefaultTimeout(30000);
      page.on('dialog', async d => {
        console.log(`dialog:${d.type()}:${d.message()}`);
        try { if (d.type() === 'beforeunload') await d.accept(); else await d.dismiss(); } catch {}
      });
    }
    console.log(`checking ${c.id} ${c.label}`);
    let d, result;
    try {
      d = await detail(page, c.href);
      c.title = d.title; c.company = d.company; c.url = d.url;
      const relevanceText = `${c.label}\n${d.title}\n${d.company}`;
      const full = `${c.label}\n${d.text.split(/Technology Professionals|Search for Jobs|Similar Jobs|Recommended Jobs/i)[0]}`;
      if (!isRelevant(relevanceText)) result = {status:'skipped', reason:'not relevant to resume4 AI/full-stack target'};
      else if (!isRemoteJob(full)) result = {status:'skipped', reason:'not remote-only or has hybrid/location text'};
      else if (!d.applyHref && !/Apply/i.test(d.text)) result = {status:'skipped', reason:'no Dice application link'};
      else result = await applyJob(page, c);
    } catch (e) { result = {status:'error', reason:e.message}; }
    const row = {jobId:c.id, title:c.title||'', company:c.company||'', url:c.url||c.href, search:c.search, status:result.status, reason:result.reason};
    if (result.status === 'applied') { state.applied[c.id]=row; submitted++; }
    else if (result.status === 'already_submitted') { state.alreadySubmitted[c.id]=row; submitted++; }
    else if (result.status === 'skipped') state.skipped[c.id]=row;
    state.seen[c.id]=row;
    saveState(); log(row);
    console.log(`${result.status}: ${row.title} | ${row.company} | ${row.url} | ${result.reason}`);
  }
  console.log(`done: submitted/already-submitted count this run=${submitted}; state=${STATE_FILE}; log=${LOG_FILE}`);
  await browser.close();
})();
