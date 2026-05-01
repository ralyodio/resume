const fs = require('fs');
const path = require('path');
const { appendAuditEvent } = require('../audit/audit-log.cjs');

const RESUME4_PATH = '/home/ettinger/Desktop/resume/anthony.ettinger.resume4.pdf';
const SUPPORTED_ATS = new Set(['greenhouse','lever','ashby','workable','smartrecruiters','workday','bamboohr','applytojob','breezy','icims','jobvite','recruiterbox','email']);

function safeUrl(url) { try { return new URL(String(url || '')); } catch { return null; } }
function detectAts(url) {
  const raw = String(url || '').trim();
  if (/^mailto:/i.test(raw)) return 'email';
  const u = safeUrl(raw); if (!u) return 'unknown';
  const host = u.hostname.toLowerCase();
  const hostIs = (domain) => host === domain || host.endsWith(`.${domain}`);
  if (hostIs('greenhouse.io')) return 'greenhouse';
  if (hostIs('lever.co')) return 'lever';
  if (hostIs('ashbyhq.com')) return 'ashby';
  if (hostIs('workable.com')) return 'workable';
  if (hostIs('smartrecruiters.com')) return 'smartrecruiters';
  if (hostIs('myworkdayjobs.com') || host.endsWith('.myworkdayjobs.com')) return 'workday';
  if (hostIs('bamboohr.com')) return 'bamboohr';
  if (hostIs('applytojob.com')) return 'applytojob';
  if (hostIs('breezy.hr')) return 'breezy';
  if (hostIs('icims.com')) return 'icims';
  if (hostIs('jobvite.com')) return 'jobvite';
  if (hostIs('recruiterbox.com')) return 'recruiterbox';
  return 'unknown';
}

function envFirst(keys) { for (const k of keys) if (process.env[k]) return process.env[k]; return ''; }
function buildApplicationPayload(job = {}, opts = {}) {
  const profile = {
    name: opts.name || process.env.HERMES_APPLICANT_NAME || 'Anthony Ettinger',
    email: opts.email || envFirst(['HERMES_APPLICANT_EMAIL','APPLICANT_EMAIL']),
    phone: opts.phone || envFirst(['HERMES_APPLICANT_PHONE','APPLICANT_PHONE']),
    location: opts.location || envFirst(['HERMES_APPLICANT_LOCATION','APPLICANT_LOCATION']),
    linkedin: opts.linkedin || envFirst(['HERMES_APPLICANT_LINKEDIN','APPLICANT_LINKEDIN']),
    github: opts.github || envFirst(['HERMES_APPLICANT_GITHUB','APPLICANT_GITHUB']),
    website: opts.website || envFirst(['HERMES_APPLICANT_WEBSITE','APPLICANT_WEBSITE'])
  };
  const [firstName, ...rest] = profile.name.split(/\s+/).filter(Boolean);
  return {
    job,
    ats: detectAts(job.applyUrl || job.sourceUrl),
    url: job.applyUrl || job.sourceUrl || '',
    resumePath: opts.resumePath || RESUME4_PATH,
    coverLetter: opts.coverLetter || job.coverLetter || '',
    profile: { ...profile, firstName: firstName || '', lastName: rest.join(' ') }
  };
}

function canAutoSubmit(job = {}) {
  if (['native-profile','marketplace-proposal'].includes(job.applicationMode)) return false;
  const ats = detectAts(job.applyUrl || job.sourceUrl);
  if (!SUPPORTED_ATS.has(ats) || ats === 'unknown') return false;
  return job.applicationMode ? ['external-ats','email','external','external-link'].includes(job.applicationMode) : true;
}

function parseMailto(mailto) {
  const raw = String(mailto || '');
  const noScheme = raw.replace(/^mailto:/i, '');
  const [toPart, query = ''] = noScheme.split('?');
  const params = new URLSearchParams(query);
  return { to: decodeURIComponent(toPart || ''), subject: params.get('subject') || '', body: params.get('body') || '' };
}
function writeEmailDraft({job,payload,storeDir}) {
  const dir = storeDir || process.cwd(); fs.mkdirSync(dir,{recursive:true});
  const m = parseMailto(payload.url);
  const subject = m.subject || `Application: ${job.title || 'Role'}${job.company ? ` at ${job.company}` : ''}`;
  const body = [m.body, payload.coverLetter, '', `Resume: ${payload.resumePath}`].filter(Boolean).join('\n\n');
  const safeId = String(job.id || Date.now()).replace(/[^a-z0-9_.-]+/gi,'_');
  const draftPath = path.join(dir, `email-apply-${safeId}.eml`);
  fs.writeFileSync(draftPath, `To: ${m.to}\nSubject: ${subject}\nAttachment: ${payload.resumePath}\n\n${body}\n`);
  return { draftPath, to: m.to, subject };
}

async function optionalPuppeteer(opts = {}) {
  if (opts.puppeteer) return opts.puppeteer;
  try { return require('puppeteer'); } catch { return null; }
}
async function fillFirst(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    const el = await page.$(sel).catch(()=>null);
    if (el) { await el.click({clickCount:3}).catch(()=>{}); await el.type(String(value), {delay:5}).catch(()=>{}); return true; }
  }
  return false;
}
async function uploadResume(page, resumePath) {
  const inputs = await page.$$('input[type="file"]').catch(()=>[]);
  let uploaded = 0;
  for (const input of inputs) { await input.uploadFile(resumePath).then(()=>uploaded++).catch(()=>{}); }
  return uploaded;
}
async function findBlockers(page) {
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText.toLowerCase() : '';
    const blockers = [];
    if (/captcha|recaptcha|hcaptcha/.test(text) || document.querySelector('[class*=captcha], [id*=captcha], iframe[src*=captcha], iframe[src*=recaptcha]')) blockers.push('captcha');
    if (/sign in|log in|create an account|password/.test(text) || document.querySelector('input[type=password]')) blockers.push('login');
    const unknownRequired = [];
    const fields = Array.from(document.querySelectorAll('input, textarea, select')).filter(el => el.required || el.getAttribute('aria-required') === 'true');
    for (const el of fields) {
      const type = (el.getAttribute('type') || el.tagName || '').toLowerCase();
      const name = `${el.name||''} ${el.id||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''}`.toLowerCase();
      if (['hidden','submit','button'].includes(type)) continue;
      if (type === 'file') { if (!el.value) blockers.push('missing-required-common:file-upload'); continue; }
      if (/first|last|name|email|phone|location|linkedin|github|website|url|cover|resume/.test(name)) { if (!el.value) blockers.push(`missing-required-common:${name.trim() || type || 'field'}`); continue; }
      if (!el.value) unknownRequired.push(name.trim() || type || 'required-field');
    }
    if (unknownRequired.length) blockers.push(`unknown-required:${unknownRequired.slice(0,5).join(',')}`);
    return blockers;
  }).catch(err => [`blocker-check-failed:${err.message}`]);
}
async function clickFinalSubmit(page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, input[type=submit]'));
    const el = candidates.find(e => /submit|send application/i.test(e.innerText || e.value || e.getAttribute('aria-label') || ''));
    if (el) { el.click(); return true; }
    return false;
  });
}
async function verifySubmission(page, beforeUrl) {
  return page.evaluate((priorUrl) => {
    const text = document.body ? document.body.innerText.toLowerCase() : '';
    const successText = /application submitted|thank you for applying|thanks for applying|successfully submitted|we received your application|your application has been received/.test(text);
    const urlChangedToSuccess = location.href !== priorUrl && /(thank|success|submitted|confirmation)/i.test(location.href);
    return successText || urlChangedToSuccess;
  }, beforeUrl).catch(() => false);
}
async function browserApply({job,payload,opts}) {
  const puppeteer = await optionalPuppeteer(opts);
  if (!puppeteer) return {status:'needs-human-review', reason:'puppeteer-not-installed'};
  if (!fs.existsSync(payload.resumePath)) return {status:'needs-human-review', reason:`resume-missing:${payload.resumePath}`};
  const launchArgs = [];
  if (opts.noSandbox || process.env.HERMES_PUPPETEER_NO_SANDBOX === '1') launchArgs.push('--no-sandbox','--disable-setuid-sandbox');
  const browser = await puppeteer.launch({headless: opts.headless !== false, args:launchArgs});
  try {
    const page = await browser.newPage();
    await page.goto(payload.url, {waitUntil:'domcontentloaded', timeout: opts.timeoutMs || 30000});
    const p = payload.profile;
    await fillFirst(page, ['input[name*=first i]','input[id*=first i]','input[placeholder*=First i]'], p.firstName);
    await fillFirst(page, ['input[name*=last i]','input[id*=last i]','input[placeholder*=Last i]'], p.lastName);
    await fillFirst(page, ['input[name=name i]','input[id=name i]','input[placeholder*=Name i]'], p.name);
    await fillFirst(page, ['input[type=email]','input[name*=email i]','input[id*=email i]'], p.email);
    await fillFirst(page, ['input[type=tel]','input[name*=phone i]','input[id*=phone i]'], p.phone);
    await fillFirst(page, ['input[name*=location i]','input[id*=location i]','input[placeholder*=Location i]'], p.location);
    await fillFirst(page, ['input[name*=linkedin i]','input[id*=linkedin i]','input[placeholder*=LinkedIn i]'], p.linkedin);
    await fillFirst(page, ['input[name*=github i]','input[id*=github i]','input[placeholder*=GitHub i]'], p.github);
    await fillFirst(page, ['input[name*=website i]','input[id*=website i]','input[name*=portfolio i]','input[id*=portfolio i]'], p.website);
    await uploadResume(page, payload.resumePath);
    await fillFirst(page, ['textarea[name*=cover i]','textarea[id*=cover i]','textarea[placeholder*=cover i]','textarea'], payload.coverLetter);
    const blockers = await findBlockers(page);
    if (blockers.length) return {status:'needs-human-review', reason:blockers.join(';')};
    if (opts.submit !== true) return {status:'prepared', reason:'submit-not-requested'};
    const beforeUrl = typeof page.url === 'function' ? page.url() : payload.url;
    const clicked = await clickFinalSubmit(page);
    if (!clicked) return {status:'needs-human-review', reason:'submit-button-not-found'};
    await page.waitForTimeout?.(1500);
    const verified = await verifySubmission(page, beforeUrl);
    if (!verified) return {status:'needs-human-review', reason:'submission-unverified'};
    return {status:'submitted', reason:'submission-verified'};
  } finally { await browser.close().catch(()=>{}); }
}

async function autoApplyExternal({job = {}, dryRun = true, submit = false, storeDir, ...opts} = {}) {
  const payload = buildApplicationPayload(job, opts);
  const base = { url: payload.url, ats: payload.ats, resumePath: payload.resumePath };
  if (!payload.url) return {...base, status:'unsupported', reason:'missing-url'};
  appendAuditEvent({type:'external-auto-apply', jobId:job.id, url:payload.url, ats:payload.ats, dryRun, submit}, storeDir);
  if (!canAutoSubmit(job)) {
    if (dryRun) return {...base, status:'prepared', reason:`manual-link-prepared:${payload.ats}`};
    return {...base, status:'unsupported', reason:`unsupported-ats-or-mode:${payload.ats}`};
  }
  if (payload.ats === 'email') {
    const draft = writeEmailDraft({job,payload,storeDir});
    if (!submit || dryRun) return {...base, ...draft, status:'prepared', reason:'email-draft-created'};
    if (!process.env.SMTP_URL && !process.env.HERMES_SMTP_URL) return {...base, ...draft, status:'needs-human-review', reason:'smtp-not-configured-draft-created'};
    return {...base, ...draft, status:'needs-human-review', reason:'smtp-send-not-implemented'};
  }
  if (dryRun || opts.dryTest || process.env.HERMES_ATS_DRY_TEST === '1') return {...base, status:'prepared', reason:'dry-run'};
  const result = await browserApply({job,payload,opts:{...opts,submit}});
  return {...base, ...result};
}

module.exports = { RESUME4_PATH, detectAts, buildApplicationPayload, canAutoSubmit, autoApplyExternal, browserApply };
