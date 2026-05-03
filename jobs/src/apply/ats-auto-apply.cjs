const fs = require('fs');
const path = require('path');
const { appendAuditEvent } = require('../audit/audit-log.cjs');

const RESUME4_PATH = '/home/ettinger/Desktop/resume/anthony.ettinger.resume4.pdf';
const COVER4_PATH = '/home/ettinger/Desktop/resume/anthony.ettinger.cover4.pdf';
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

function normalizeApplicationUrl(url, ats) {
  const u = safeUrl(url);
  if (!u) return url || '';
  const path = u.pathname.replace(/\/+$/,'');
  if (ats === 'ashby' && !/\/application$/i.test(path)) { u.pathname = `${path}/application`; return u.toString(); }
  if (ats === 'workable' && !/\/apply$/i.test(path)) { u.pathname = `${path}/apply/`; return u.toString(); }
  if (ats === 'breezy' && !/\/apply$/i.test(path)) { u.pathname = `${path}/apply`; return u.toString(); }
  if (ats === 'icims' && !/\/login$/i.test(path) && !u.searchParams.has('mode')) { u.searchParams.set('mode','apply'); return u.toString(); }
  return u.toString();
}
function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#39;|&apos;/g,"'")
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>');
}
function extractAtsApplyUrlFromHtml(html, baseUrl='') {
  const text = String(html || '');
  const hrefs = [];
  for (const m of text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) hrefs.push(m[1]);
  for (const m of text.matchAll(/https?:\\?\/\\?\/[^\s"'<>]+/gi)) hrefs.push(m[0].replace(/\\\//g,'/'));
  for (const raw of hrefs) {
    let url = decodeHtmlEntities(raw).trim();
    if (!url || /2captcha|capsolver|recaptcha|hcaptcha|captcha/i.test(url)) continue;
    try { url = new URL(url, baseUrl || undefined).toString(); } catch { continue; }
    const ats = detectAts(url);
    if (SUPPORTED_ATS.has(ats) && ats !== 'unknown') return normalizeApplicationUrl(url, ats);
  }
  return '';
}
const AGGREGATOR_SOURCES = new Set(['remotive','arbeitnow','jobicy','themuse','web3-career','himalayas','cryptocurrencyjobs','laborx','builtin','weworkremotely']);
async function fetchPageHtmlDefault(url, timeoutMs=12000) {
  if (typeof fetch !== 'function') return '';
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { headers:{'user-agent':process.env.HERMES_ATS_USER_AGENT || 'Mozilla/5.0 Hermes Jobs ATS Resolver'}, signal:ac?.signal });
    if (!res.ok) return '';
    return await res.text();
  } catch { return ''; }
  finally { if (timer) clearTimeout(timer); }
}
async function resolveAggregatorApplyUrl(job={}, opts={}) {
  const original = job.applyUrl || job.sourceUrl || '';
  if (!original || detectAts(original) !== 'unknown') return job;
  const shouldResolve = typeof opts.fetchPageHtml === 'function' || AGGREGATOR_SOURCES.has(job.source);
  if (!shouldResolve) return job;
  const fetcher = opts.fetchPageHtml || ((url) => fetchPageHtmlDefault(url, opts.resolveTimeoutMs || opts.timeoutMs || 12000));
  const html = await fetcher(original, job).catch(()=>'');
  const resolved = extractAtsApplyUrlFromHtml(html, original);
  if (!resolved) return job;
  return { ...job, applyUrl: resolved, applicationMode: 'external-ats', metadata:{...(job.metadata||{}), resolvedApplyUrlFrom: original} };
}
function envFirst(keys) { for (const k of keys) if (process.env[k]) return process.env[k]; return ''; }
function defaultCoverLetterText() {
  const candidates = [
    process.env.COVER_MD,
    '/home/ettinger/Desktop/resume/anthony.ettinger.cover4.md',
    '/home/ettinger/Desktop/resume/anthony.ettinger.cover.md'
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      return fs.readFileSync(file, 'utf8')
        .replace(/^---[\s\S]*?---\s*/,'')
        .replace(/^#\s+/gm,'')
        .replace(/\[[^\]]+\]\([^\)]+\)/g, m => m.replace(/^\[|\]\([^\)]+\)$/g,''))
        .replace(/[\*_`>#]/g,'')
        .replace(/\n{3,}/g,'\n\n')
        .trim();
    } catch {}
  }
  return '';
}
function buildApplicationPayload(job = {}, opts = {}) {
  const profile = {
    name: opts.name || process.env.HERMES_APPLICANT_NAME || 'Anthony Ettinger',
    email: opts.email || envFirst(['HERMES_APPLICANT_EMAIL','APPLICANT_EMAIL']),
    phone: opts.phone || envFirst(['HERMES_APPLICANT_PHONE','APPLICANT_PHONE']),
    location: opts.location || envFirst(['HERMES_APPLICANT_LOCATION','APPLICANT_LOCATION']),
    linkedin: opts.linkedin || envFirst(['HERMES_APPLICANT_LINKEDIN','APPLICANT_LINKEDIN']),
    github: opts.github || envFirst(['HERMES_APPLICANT_GITHUB','APPLICANT_GITHUB']),
    website: opts.website || envFirst(['HERMES_APPLICANT_WEBSITE','APPLICANT_WEBSITE']),
    workAuth: opts.workAuth || envFirst(['HERMES_APPLICANT_WORK_AUTH','APPLICANT_WORK_AUTH']) || 'US Citizen',
    requiresSponsorship: opts.requiresSponsorship || envFirst(['HERMES_APPLICANT_REQUIRES_SPONSORSHIP','APPLICANT_REQUIRES_SPONSORSHIP']) || 'no'
  };
  const [firstName, ...rest] = profile.name.split(/\s+/).filter(Boolean);
  const ats = detectAts(job.applyUrl || job.sourceUrl);
  return {
    job,
    ats,
    url: normalizeApplicationUrl(job.applyUrl || job.sourceUrl || '', ats),
    resumePath: opts.resumePath || job.resumePath || process.env.RESUME_PDF || RESUME4_PATH,
    coverPdfPath: opts.coverPdfPath || job.coverPdfPath || process.env.COVER_PDF || COVER4_PATH,
    coverLetter: opts.coverLetter || job.coverLetter || defaultCoverLetterText(),
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
  const body = [m.body, payload.coverLetter, '', `Resume: ${payload.resumePath}`, `Cover letter PDF: ${payload.coverPdfPath}`].filter(Boolean).join('\n\n');
  const safeId = String(job.id || Date.now()).replace(/[^a-z0-9_.-]+/gi,'_');
  const draftPath = path.join(dir, `email-apply-${safeId}.eml`);
  fs.writeFileSync(draftPath, `To: ${m.to}\nSubject: ${subject}\nAttachment: ${payload.resumePath}\nAttachment: ${payload.coverPdfPath}\n\n${body}\n`);
  return { draftPath, to: m.to, subject };
}

async function sendEmailViaSmtp({to, subject, body, attachmentPath}) {
  const net = require('net');
  const tls = require('tls');
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || process.env.HERMES_APPLICANT_EMAIL;
  if (!host || !user || !pass) throw new Error('SMTP not configured');

  // Read attachment
  let attachmentB64 = '';
  let attachmentName = '';
  if (attachmentPath && fs.existsSync(attachmentPath)) {
    attachmentB64 = fs.readFileSync(attachmentPath).toString('base64');
    attachmentName = path.basename(attachmentPath);
  }

  const boundary = `----=_Part_${Date.now()}`;
  const mimeBody = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body,
    ...(attachmentB64 ? [
      `--${boundary}`,
      `Content-Type: application/pdf; name="${attachmentName}"`,
      `Content-Disposition: attachment; filename="${attachmentName}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      attachmentB64.match(/.{1,76}/g).join('\r\n'),
    ] : []),
    `--${boundary}--`,
  ].join('\r\n');

  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
      let buf = '';
      const send = (cmd) => socket.write(cmd + '\r\n');
      socket.setEncoding('utf8');
      socket.on('data', chunk => {
        buf += chunk;
        const lines = buf.split('\r\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('220') && !line.includes('2.0.0')) { send('EHLO localhost'); }
          else if (line.startsWith('250') && line.includes('AUTH')) { send(`AUTH LOGIN`); }
          else if (line.startsWith('334') && buf === '' && !socket._authUser) { socket._authUser = true; send(Buffer.from(user).toString('base64')); }
          else if (line.startsWith('334') && socket._authUser && !socket._authPass) { socket._authPass = true; send(Buffer.from(pass).toString('base64')); }
          else if (line.startsWith('235')) { send(`MAIL FROM:<${from.match(/<(.+)>/)?.[1] || from}>`); }
          else if (line.startsWith('250') && socket._authPass && !socket._mailfrom) { socket._mailfrom = true; send(`RCPT TO:<${to}>`); }
          else if (line.startsWith('250') && socket._mailfrom && !socket._rcpt) { socket._rcpt = true; send('DATA'); }
          else if (line.startsWith('354')) { socket.write(mimeBody + '\r\n.\r\n'); }
          else if (line.startsWith('250') && socket._rcpt && !socket._sent) { socket._sent = true; send('QUIT'); resolve({ sent: true }); }
          else if (line.startsWith('221')) { socket.destroy(); }
          else if (line.startsWith('5')) { socket.destroy(); reject(new Error(`SMTP error: ${line}`)); }
        }
      });
      socket.on('error', reject);
    });
    socket.on('error', reject);
  });
}
async function optionalPuppeteer(opts = {}) {
  if (opts.puppeteer) return opts.puppeteer;
  try { return require('puppeteer'); } catch { return null; }
}
async function dismissCookieBanners(page) {
  await page.evaluate(() => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    const candidates = Array.from(document.querySelectorAll('button, a[role=button], a[href="javascript:void(0);"], a[href="#"]')).filter(visible);
    const el = candidates.find(e => /^(accept|accept all|allow)$/i.test((e.innerText || e.value || e.getAttribute('aria-label') || '').trim()));
    if (el) el.click();
  }).catch(()=>{});
}
async function fillFirst(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    const el = await page.$(sel).catch(()=>null);
    if (el) { await el.click({clickCount:3}).catch(()=>{}); await el.type(String(value), {delay:5}).catch(()=>{}); return true; }
  }
  return false;
}
async function uploadDocuments(page, {resumePath, coverPdfPath}) {
  const inputs = await page.$$('input[type="file"]').catch(()=>[]);
  const labels = [];
  for (const input of inputs) {
    labels.push(typeof input.evaluate === 'function' ? await input.evaluate(el => `${el.name||''} ${el.id||''} ${el.getAttribute('aria-label')||''} ${el.closest('label')?.innerText||''} ${el.parentElement?.innerText||''}`.toLowerCase()).catch(()=>'') : '');
  }
  const hasSpecificResume = labels.some(l => /resume|cv/.test(l) && !/autofill|import/.test(l));
  let uploaded = 0;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const label = labels[i] || '';
    if (/autofill|import/.test(label) && hasSpecificResume) continue;
    const file = /cover/.test(label) && coverPdfPath && fs.existsSync(coverPdfPath) ? coverPdfPath : resumePath;
    await input.uploadFile(file).then(()=>uploaded++).catch(()=>{});
  }
  return uploaded;
}
async function fillKnownCustomQuestions(page, payload) {
  const answers = {
    salaryAnnual: process.env.HERMES_APPLICANT_DESIRED_SALARY || '$350,000',
    hourlyRate: process.env.HERMES_APPLICANT_HOURLY_RATE || '$135/hour',
    location: payload.profile.location || process.env.HERMES_APPLICANT_LOCATION || 'Seattle, WA, USA',
    yearsAi: process.env.HERMES_APPLICANT_AI_YEARS || '5+ years',
    yearsSoftware: process.env.HERMES_APPLICANT_SOFTWARE_YEARS || '20+ years',
    notice: process.env.HERMES_APPLICANT_NOTICE_PERIOD || 'Available immediately / 2 weeks',
    portfolio: payload.profile.website || payload.profile.github || payload.profile.linkedin,
    timeTracker: process.env.HERMES_APPLICANT_TIME_TRACKER_OK || 'Yes'
  };
  await page.evaluate((a) => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    function labelFor(el){
      const id = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : '';
      const near = el.closest('label,.field,.form-group,.question,.questionnaire-question,div')?.innerText || '';
      return `${id||''} ${near||''} ${el.name||''} ${el.id||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''}`.toLowerCase();
    }
    function setValue(el, value){
      if (!value || !visible(el) || ['hidden','file','submit','button','checkbox','radio'].includes((el.type||'').toLowerCase())) return false;
      if (el.value) return false;
      el.focus(); el.value = value; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;
    }
    for (const el of document.querySelectorAll('input, textarea')) {
      const label = labelFor(el);
      if (/salary|annual|compensation/.test(label)) setValue(el, a.salaryAnnual);
      else if (/hourly|monthly|rate/.test(label)) setValue(el, a.hourlyRate);
      else if (/where.*based|current.*based|city.*country|location|address/.test(label)) setValue(el, a.location);
      else if (/portfolio/.test(label)) setValue(el, a.portfolio);
      else if (/years.*(ai|ml|machine|llm)|ai\/ml.*experience/.test(label)) setValue(el, a.yearsAi);
      else if (/years.*experience|software.*experience/.test(label)) setValue(el, a.yearsSoftware);
      else if (/notice period/.test(label)) setValue(el, a.notice);
      else if (/time tracker|time doctor/.test(label)) setValue(el, a.timeTracker);
    }
  }, answers).catch(()=>{});
}
async function fillProfileFieldsByLabel(page, payload) {
  const p = payload.profile;
  const answers = {
    firstName: p.firstName,
    lastName: p.lastName,
    name: p.name,
    email: p.email,
    phone: p.phone,
    location: p.location || process.env.HERMES_APPLICANT_LOCATION || 'Seattle, WA, USA',
    city: process.env.HERMES_APPLICANT_CITY || 'Seattle',
    state: process.env.HERMES_APPLICANT_STATE || 'WA',
    postal: process.env.HERMES_APPLICANT_POSTAL || process.env.HERMES_APPLICANT_ZIP || '',
    country: process.env.HERMES_APPLICANT_COUNTRY || 'United States',
    linkedin: p.linkedin,
    github: p.github,
    website: p.website || p.github || p.linkedin,
    twitter: process.env.HERMES_APPLICANT_TWITTER || process.env.APPLICANT_TWITTER || '',
    coverLetter: payload.coverLetter,
    workAuth: p.workAuth,
    salaryAnnual: process.env.HERMES_APPLICANT_DESIRED_SALARY || '$350,000',
    hourlyRate: process.env.HERMES_APPLICANT_HOURLY_RATE || '$135/hour',
    start: process.env.HERMES_APPLICANT_START_DATE || 'Immediately'
  };
  await page.evaluate((a) => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    function labelFor(el){
      const id = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : '';
      const ariaBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ');
      const near = el.closest('label,.field,.form-group,.question,.questionnaire-question,.application-question,.form-field,div')?.innerText || '';
      return `${id||''} ${ariaBy||''} ${near||''} ${el.name||''} ${el.id||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''}`.toLowerCase();
    }
    function set(el, value){
      if (!value || !visible(el) || el.disabled || el.readOnly) return false;
      const type = (el.type || '').toLowerCase();
      if (['hidden','file','submit','button','checkbox','radio'].includes(type)) return false;
      if (el.value) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      return true;
    }
    for (const el of document.querySelectorAll('input, textarea')) {
      const label = labelFor(el);
      if (/first\s*name|given\s*name/.test(label)) set(el, a.firstName);
      else if (/last\s*name|family\s*name|surname/.test(label)) set(el, a.lastName);
      else if (/full\s*name|^name\b|\bname\b/.test(label) && !/company|school|employer|file/.test(label)) set(el, a.name);
      else if (/e-?mail|email/.test(label)) set(el, a.email);
      else if (/phone|mobile|telephone/.test(label)) set(el, a.phone);
      else if (/linkedin/.test(label)) set(el, a.linkedin);
      else if (/twitter|x url|x\.com/.test(label)) set(el, a.twitter);
      else if (/github/.test(label)) set(el, a.github);
      else if (/website|portfolio|personal site|url/.test(label) && !/linkedin|github/.test(label)) set(el, a.website);
      else if (/cover\s*letter|why.*interested|summary/.test(label)) set(el, a.coverLetter);
      else if (/salary|annual|compensation/.test(label)) set(el, a.salaryAnnual);
      else if (/hourly|rate/.test(label)) set(el, a.hourlyRate);
      else if (/start\s*date|earliest\s*start/.test(label)) set(el, a.start);
      else if (/city/.test(label)) set(el, a.city);
      else if (/state|province/.test(label)) set(el, a.state);
      else if (/postal|zip/.test(label)) set(el, a.postal);
      else if (/country/.test(label)) set(el, a.country);
      else if (/address|location|where.*based|current.*based/.test(label)) set(el, a.location);
      else if (/work.*auth|authorized.*work/.test(label)) set(el, a.workAuth);
    }
    for (const sel of document.querySelectorAll('select')) {
      if (!visible(sel) || sel.disabled || sel.value) continue;
      const label = labelFor(sel);
      const want = /country/.test(label) ? /(united states|usa|us\b)/i
        : /state|province/.test(label) ? /^(wa|washington)$/i
        : /sponsor/.test(label) ? /no/i
        : /authorized|work.*auth|eligib|citizen/.test(label) ? /(yes|authorized|citizen|united states|usa)/i
        : /gender|race|ethnicity|veteran|disability/.test(label) ? /(decline|prefer not|do not wish|not disclose)/i
        : null;
      if (!want) continue;
      const opt = Array.from(sel.options).find(o => want.test(o.text) || want.test(o.value));
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); }
    }
    for (const cb of document.querySelectorAll('input[type=checkbox]')) {
      const label = labelFor(cb);
      if (!cb.checked && /privacy|terms|consent|agree|certif|confirm|acknowledge/.test(label)) cb.click();
    }
  }, answers).catch(()=>{});
}
async function selectOrFillWorkAuth(page, workAuth, requiresSponsorship) {
  await page.evaluate((auth, sponsorship) => {
    const no = sponsorship === 'no' || sponsorship === 'false' || !sponsorship;
    // Handle select dropdowns for work authorization
    for (const sel of document.querySelectorAll('select')) {
      const label = `${sel.name||''} ${sel.id||''} ${sel.getAttribute('aria-label')||''}`.toLowerCase();
      if (/work.?auth|authorized|eligib|citizenship|visa/i.test(label)) {
        for (const opt of sel.options) {
          if (/citizen|authorized|yes|us\s/i.test(opt.text)) { sel.value = opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); break; }
        }
      }
      if (/sponsor/i.test(label)) {
        for (const opt of sel.options) {
          if (no ? /no|not\s/i.test(opt.text) : /yes/i.test(opt.text)) { sel.value = opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); break; }
        }
      }
    }
    // Handle yes/no radio buttons for sponsorship
    for (const inp of document.querySelectorAll('input[type=radio]')) {
      const label = `${inp.name||''} ${inp.id||''} ${inp.value||''} ${inp.getAttribute('aria-label')||''}`.toLowerCase();
      if (/sponsor/i.test(label)) {
        if (no && /no/i.test(inp.value || inp.id || inp.getAttribute('aria-label') || '')) inp.click();
        if (!no && /yes/i.test(inp.value || inp.id || inp.getAttribute('aria-label') || '')) inp.click();
      }
      if (/work.?auth|authorized|us.?citizen/i.test(label) && /yes|true|authorized/i.test(inp.value || inp.id || '')) inp.click();
    }
  }, workAuth, requiresSponsorship).catch(() => {});
}
async function fillPlatformSpecificFields(page, payload) {
  const answers = {
    country: process.env.HERMES_APPLICANT_COUNTRY || 'United States',
    state: process.env.HERMES_APPLICANT_STATE || 'WA',
    city: process.env.HERMES_APPLICANT_CITY || 'Seattle',
    location: payload.profile.location || process.env.HERMES_APPLICANT_LOCATION || 'Seattle, WA, USA',
    authorized: 'Yes',
    sponsorship: 'No',
    salaryAnnual: process.env.HERMES_APPLICANT_DESIRED_SALARY || '$350,000',
    hourlyRate: process.env.HERMES_APPLICANT_HOURLY_RATE || '$135/hour',
    decline: 'Prefer not to disclose',
    over18: 'Yes'
  };
  await page.evaluate((a) => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    function labelFor(el){
      const id = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : '';
      const ariaBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ');
      const near = el.closest('label,.field,.form-group,.question,.questionnaire-question,.application-question,.form-field,.select,.select-wrapper,div')?.innerText || '';
      return `${id||''} ${ariaBy||''} ${near||''} ${el.name||''} ${el.id||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''}`.replace(/\s+/g,' ').toLowerCase();
    }
    function setInput(el, value){
      if (!value || !visible(el) || el.disabled || el.readOnly) return false;
      const type = (el.type || '').toLowerCase();
      if (['hidden','file','submit','button','checkbox','radio'].includes(type)) return false;
      if (el.value) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      return true;
    }
    function chooseSelect(sel, patterns){
      if (!visible(sel) || sel.disabled || sel.value) return false;
      const opts = Array.from(sel.options || []);
      for (const re of patterns) {
        const opt = opts.find(o => re.test((o.text || '').trim()) || re.test((o.value || '').trim()));
        if (opt && opt.value !== '') { sel.value = opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); return true; }
      }
      return false;
    }
    for (const el of document.querySelectorAll('input, textarea')) {
      const label = labelFor(el);
      if (/country/.test(label)) setInput(el, a.country);
      else if (/state|province/.test(label)) setInput(el, a.state);
      else if (/city/.test(label)) setInput(el, a.city);
      else if (/location|address|where.*based/.test(label)) setInput(el, a.location);
      else if (/sponsor|visa/.test(label)) setInput(el, a.sponsorship);
      else if (/authorized|eligible.*work|work.*auth/.test(label)) setInput(el, a.authorized);
      else if (/salary|compensation/.test(label)) setInput(el, a.salaryAnnual);
      else if (/hourly|rate/.test(label)) setInput(el, a.hourlyRate);
    }
    for (const sel of document.querySelectorAll('select')) {
      const label = labelFor(sel);
      if (/country/.test(label)) chooseSelect(sel, [/united states/i, /^usa$/i, /^us$/i]);
      else if (/state|province/.test(label)) chooseSelect(sel, [/^wa$/i, /washington/i]);
      else if (/sponsor|visa/.test(label)) chooseSelect(sel, [/^no$/i, /not.*require/i]);
      else if (/authorized|eligible.*work|work.*auth/.test(label)) chooseSelect(sel, [/^yes$/i, /authorized/i, /citizen/i]);
      else if (/gender|race|ethnic|veteran|disability|demographic/.test(label)) chooseSelect(sel, [/prefer not/i, /decline/i, /do not wish/i, /not disclose/i]);
    }
    const radiosByName = new Map();
    for (const r of document.querySelectorAll('input[type=radio]')) {
      if (!visible(r) || r.disabled || r.checked) continue;
      const key = r.name || r.id || Math.random().toString();
      if (!radiosByName.has(key)) radiosByName.set(key, []);
      radiosByName.get(key).push(r);
    }
    for (const group of radiosByName.values()) {
      const text = group.map(labelFor).join(' ');
      const want = /sponsor|visa/.test(text) ? [/\bno\b/i]
        : /authorized|eligible|work.*auth/.test(text) ? [/\byes\b/i, /authorized/i]
        : /over.*18|eighteen|adult/.test(text) ? [/\byes\b/i]
        : /gender|race|ethnic|veteran|disability|demographic/.test(text) ? [/prefer not/i, /decline/i, /not disclose/i]
        : [];
      for (const re of want) {
        const hit = group.find(r => re.test(labelFor(r)) || re.test(r.value || ''));
        if (hit) { hit.click(); break; }
      }
    }
  }, answers).catch(()=>{});
}
async function fillRemainingRequiredFields(page, payload) {
  const fallback = {
    coverLetter: payload.coverLetter || 'Please see my attached resume and cover letter.',
    text: 'N/A',
    yearsAi: process.env.HERMES_APPLICANT_AI_YEARS || '5+ years',
    yearsSoftware: process.env.HERMES_APPLICANT_SOFTWARE_YEARS || '20+ years',
    salaryAnnual: process.env.HERMES_APPLICANT_DESIRED_SALARY || '$350,000',
    hourlyRate: process.env.HERMES_APPLICANT_HOURLY_RATE || '$135/hour',
    location: payload.profile.location || process.env.HERMES_APPLICANT_LOCATION || 'Seattle, WA, USA'
  };
  await page.evaluate((a) => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    function labelFor(el){
      const id = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : '';
      const ariaBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ');
      const near = el.closest('label,.field,.form-group,.question,.questionnaire-question,.application-question,.form-field,div')?.innerText || '';
      return `${id||''} ${ariaBy||''} ${near||''} ${el.name||''} ${el.id||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''}`.replace(/\s+/g,' ').toLowerCase();
    }
    function setValue(el, value){
      if (!visible(el) || el.disabled || el.readOnly || el.value) return false;
      const type = (el.type || '').toLowerCase();
      if (['hidden','file','submit','button','checkbox','radio'].includes(type)) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.dispatchEvent(new Event('blur',{bubbles:true}));
      return true;
    }
    const required = Array.from(document.querySelectorAll('input, textarea, select')).filter(el => (el.required || el.getAttribute('aria-required') === 'true') && visible(el) && !el.disabled);
    for (const el of required) {
      const label = labelFor(el);
      if (el.tagName === 'SELECT') {
        if (el.value) continue;
        const opts = Array.from(el.options || []).filter(o => o.value !== '' && !/select|choose/i.test(o.text || ''));
        const preferred = opts.find(o => /prefer not|decline|not disclose/i.test(o.text))
          || opts.find(o => /no/i.test(o.text) && /sponsor|visa|relocat/.test(label))
          || opts.find(o => /yes/i.test(o.text) && /authorized|eligible|over.*18/.test(label))
          || opts[0];
        if (preferred) { el.value = preferred.value; el.dispatchEvent(new Event('change',{bubbles:true})); }
        continue;
      }
      const type = (el.type || '').toLowerCase();
      if (type === 'checkbox' && !el.checked && /agree|consent|terms|privacy|certif|acknowledge|confirm/.test(label)) { el.click(); continue; }
      if (type === 'radio') continue;
      const value = /cover|summary|why|interest|additional/.test(label) ? a.coverLetter
        : /salary|compensation|annual/.test(label) ? a.salaryAnnual
        : /hourly|rate/.test(label) ? a.hourlyRate
        : /location|city|country|address/.test(label) ? a.location
        : /years.*(ai|ml|machine|llm)/.test(label) ? a.yearsAi
        : /years|experience/.test(label) ? a.yearsSoftware
        : a.text;
      setValue(el, value);
    }
  }, fallback).catch(()=>{});
}
async function findBlockers(page) {
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText.toLowerCase() : '';
    const blockers = [];
    if (/captcha|recaptcha|hcaptcha/.test(text) || document.querySelector('[class*=captcha], [id*=captcha], iframe[src*=captcha], iframe[src*=recaptcha]')) blockers.push('captcha');
    if (document.querySelector('input[type=password]')) blockers.push('login');
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
async function clickInitialApplyLink(page) {
  return page.evaluate(() => {
    const hasFields = document.querySelector('input:not([type=hidden]), textarea, select');
    if (hasFields) return false;
    const candidates = Array.from(document.querySelectorAll('a, button'));
    const el = candidates.find(e => {
      const text = (e.innerText || e.value || e.getAttribute('aria-label') || '').trim();
      const href = e.href || '';
      return /^(apply|apply now|apply to position|apply for this job|apply manually|autofill with resume)$/i.test(text) || /\/(apply|application)(\/|$|\?)/i.test(href);
    });
    if (el) { el.click(); return true; }
    return false;
  }).catch(()=>false);
}
async function clickProgressButton(page) {
  return page.evaluate(() => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    const candidates = Array.from(document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], a[href="#"], a[href="javascript:void(0)"]')).filter(visible);
    const bad = /cookie|linkedin|indeed|google|facebook|back|cancel|dismiss|reject|decline|share/i;
    const el = candidates.find(e => {
      const text = (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
      return text && !bad.test(text) && /^(next|continue|review|save and continue)$/i.test(text);
    });
    if (el) { el.click(); return (el.innerText || el.value || el.getAttribute('aria-label') || '').trim(); }
    return '';
  }).catch(()=>'');
}
async function clickFinalSubmit(page) {
  return page.evaluate(() => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    const candidates = Array.from(document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], a[href="#"], a[href="javascript:void(0)"]')).filter(visible);
    const el = candidates.find(e => {
      const text = (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
      if (/cookie|linkedin|indeed|google|facebook|back|cancel|dismiss|reject|decline|share/i.test(text)) return false;
      return /^(submit|submit application|send application|apply|apply now|apply for this job)$/i.test(text);
    });
    if (el) { el.click(); return true; }
    return false;
  });
}
async function ensureNonEmptyPage(page) {
  const empty = await page.evaluate(() => !(document.body?.innerText || '').trim()).catch(()=>false);
  if (empty) {
    await page.reload({waitUntil:'networkidle2', timeout:30000}).catch(()=>{});
    await page.waitForTimeout?.(5000);
  }
}
async function debugStep(page, step) {
  if (!process.env.HERMES_ATS_DEBUG_STEPS) return;
  const d = await submitDiagnostics(page).catch(e => `debug-failed:${e.message}`);
  console.error(`[ats-debug] ${step} ${d}`);
}
async function submitDiagnostics(page) {
  return page.evaluate(() => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    return Array.from(document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], a[href="#"], a[href="javascript:void(0)"]')).filter(visible).map(e => (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,12).join('|') || `url:${location.href} body:${(document.body?.innerText||'').replace(/\s+/g,' ').trim().slice(0,240)}`;
  }).catch(err => `diagnostics-failed:${err.message}`);
}
async function verifySubmission(page, beforeUrl) {
  return page.evaluate((priorUrl) => {
    const text = document.body ? document.body.innerText.toLowerCase() : '';
    const successText = /application submitted|thank you for applying|thanks for applying|successfully submitted|we received your application|your application has been received|application complete|we have received your application/.test(text);
    const urlChangedToSuccess = location.href !== priorUrl && /(thank|success|submitted|confirmation)/i.test(location.href);
    return successText || urlChangedToSuccess;
  }, beforeUrl).catch(() => false);
}
async function browserApply({job,payload,opts}) {
  const puppeteer = await optionalPuppeteer(opts);
  if (!puppeteer) return {status:'needs-human-review', reason:'puppeteer-not-installed'};
  if (!fs.existsSync(payload.resumePath)) return {status:'needs-human-review', reason:`resume-missing:${payload.resumePath}`};
  const launchArgs = ['--disable-dev-shm-usage'];
  if (opts.noSandbox || process.env.HERMES_PUPPETEER_NO_SANDBOX === '1') launchArgs.push('--no-sandbox','--disable-setuid-sandbox');
  const browser = await puppeteer.launch({headless: opts.headless !== false, defaultViewport:null, args:launchArgs});
  try {
    const page = await browser.newPage();
    await page.setViewport?.({width:1366,height:900});
    await page.setUserAgent?.(process.env.HERMES_ATS_USER_AGENT || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(payload.url, {waitUntil:'domcontentloaded', timeout: opts.timeoutMs || 30000});
    await page.waitForTimeout?.(3000);
    await ensureNonEmptyPage(page);
    await debugStep(page, 'after-goto');
    await dismissCookieBanners(page);
    if (await clickInitialApplyLink(page)) await page.waitForNavigation({waitUntil:'domcontentloaded',timeout:opts.timeoutMs||30000}).catch(()=>page.waitForTimeout?.(2000));
    if (await clickInitialApplyLink(page)) await page.waitForNavigation({waitUntil:'domcontentloaded',timeout:opts.timeoutMs||30000}).catch(()=>page.waitForTimeout?.(2000));
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
    await fillFirst(page, ['input[name*=work_auth i]','input[id*=work_auth i]','input[name*=authorization i]','input[id*=authorization i]','input[placeholder*=work authori i]'], p.workAuth);
    await debugStep(page, 'after-fill-first');
    await fillProfileFieldsByLabel(page, payload);
    await debugStep(page, 'after-fill-profile');
    await selectOrFillWorkAuth(page, p.workAuth, p.requiresSponsorship);
    await fillKnownCustomQuestions(page, payload);
    await fillPlatformSpecificFields(page, payload);
    await fillRemainingRequiredFields(page, payload);
    await uploadDocuments(page, {resumePath: payload.resumePath, coverPdfPath: payload.coverPdfPath});
    await page.waitForTimeout?.(8000);
    await debugStep(page, 'after-upload');
    await fillProfileFieldsByLabel(page, payload);
    await fillFirst(page, ['textarea[name*=cover i]','textarea[id*=cover i]','textarea[placeholder*=cover i]','textarea'], payload.coverLetter);
    let blockers = await findBlockers(page);
    if (blockers.includes('captcha')) {
      return {status:'needs-human-review', reason:'captcha'};
    }
    if (blockers.length) return {status:'needs-human-review', reason:blockers.join(';')};
    if (opts.submit !== true) return {status:'prepared', reason:'submit-not-requested'};
    let beforeUrl = typeof page.url === 'function' ? page.url() : payload.url;
    let clickedAny = false;
    for (let i = 0; i < 5; i++) {
      const clicked = await clickFinalSubmit(page);
      if (clicked) {
        clickedAny = true;
        await page.waitForNavigation?.({waitUntil:'domcontentloaded',timeout:opts.timeoutMs||15000}).catch(()=>page.waitForTimeout?.(8000));
        if (await verifySubmission(page, beforeUrl)) return {status:'submitted', reason:'submission-verified'};
      } else {
        const progressed = await clickProgressButton(page);
        if (!progressed) break;
        await page.waitForNavigation({waitUntil:'domcontentloaded',timeout:opts.timeoutMs||15000}).catch(()=>page.waitForTimeout?.(1500));
      }
      await fillProfileFieldsByLabel(page, payload);
      await selectOrFillWorkAuth(page, p.workAuth, p.requiresSponsorship);
      await fillKnownCustomQuestions(page, payload);
      await fillPlatformSpecificFields(page, payload);
      await fillRemainingRequiredFields(page, payload);
      await uploadDocuments(page, {resumePath: payload.resumePath, coverPdfPath: payload.coverPdfPath});
      await page.waitForTimeout?.(4000);
      await debugStep(page, 'after-submit-loop-refill');
      await fillProfileFieldsByLabel(page, payload);
      blockers = await findBlockers(page);
      if (blockers.length) return {status:'needs-human-review', reason:blockers.join(';')};
      const currentUrl = typeof page.url === 'function' ? page.url() : beforeUrl;
      if (currentUrl !== beforeUrl) beforeUrl = currentUrl;
    }
    if (!clickedAny) return {status:'needs-human-review', reason:`submit-button-not-found:${await submitDiagnostics(page)}`};
    await page.waitForTimeout?.(8000);
    if (await verifySubmission(page, beforeUrl)) return {status:'submitted', reason:'submission-verified'};
    return {status:'needs-human-review', reason:`submission-unverified:${await submitDiagnostics(page)}`};
  } finally { await browser.close().catch(()=>{}); }
}

async function autoApplyExternal({job = {}, dryRun = true, submit = false, storeDir, ...opts} = {}) {
  job = await resolveAggregatorApplyUrl(job, opts);
  const payload = buildApplicationPayload(job, opts);
  const base = { url: payload.url, ats: payload.ats, resumePath: payload.resumePath, coverPdfPath: payload.coverPdfPath };
  if (!payload.url) return {...base, status:'unsupported', reason:'missing-url'};
  appendAuditEvent({type:'external-auto-apply', jobId:job.id, url:payload.url, ats:payload.ats, dryRun, submit}, storeDir);
  if (!canAutoSubmit(job)) {
    if (dryRun) return {...base, status:'prepared', reason:`manual-link-prepared:${payload.ats}`};
    return {...base, status:'unsupported', reason:`unsupported-ats-or-mode:${payload.ats}`};
  }
  if (payload.ats === 'email') {
    const draft = writeEmailDraft({job,payload,storeDir});
    if (!submit || dryRun) return {...base, ...draft, status:'prepared', reason:'email-draft-created'};
    const smtpReady = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD;
    if (!smtpReady) return {...base, ...draft, status:'needs-human-review', reason:'smtp-not-configured-draft-created'};
    try {
      await sendEmailViaSmtp({ to: draft.to, subject: draft.subject, body: [payload.coverLetter, `\nResume attached.`].filter(Boolean).join('\n\n'), attachmentPath: payload.resumePath });
      return {...base, ...draft, status:'submitted', reason:'email-sent-via-smtp'};
    } catch (err) {
      return {...base, ...draft, status:'needs-human-review', reason:`smtp-send-failed:${err.message}`};
    }
  }
  if (dryRun || opts.dryTest || process.env.HERMES_ATS_DRY_TEST === '1') return {...base, status:'prepared', reason:'dry-run'};
  const result = await browserApply({job,payload,opts:{...opts,submit}});
  return {...base, ...result};
}

module.exports = { RESUME4_PATH, COVER4_PATH, detectAts, buildApplicationPayload, canAutoSubmit, extractAtsApplyUrlFromHtml, resolveAggregatorApplyUrl, autoApplyExternal, browserApply };
