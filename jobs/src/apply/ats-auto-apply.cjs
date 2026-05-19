const fs = require('fs');
const path = require('path');
const { appendAuditEvent } = require('../audit/audit-log.cjs');
const { ATS_ADAPTERS, getAtsAdapter } = require('./ats-adapters.cjs');
const { generateCoverLetter, normalizeCoverLetterText } = require('../cover/generate-cover-letter.cjs');
const { fetchText } = require('../util/fetch.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RESUME4_PATH = process.env.RESUME_PDF || path.join(REPO_ROOT, 'anthony.ettinger.resume4.pdf');
const COVER4_PATH = process.env.COVER_PDF || path.join(REPO_ROOT, 'anthony.ettinger.cover4.pdf');
const PHOTO_PATH = process.env.PHOTO_PATH || path.join(REPO_ROOT, 'anthony.ettinger.photo.jpeg');
const SUPPORTED_ATS = new Set(['greenhouse','lever','ashby','workable','rippling','smartrecruiters','workday','bamboohr','applytojob','breezy','icims','jobvite','recruiterbox','email']);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
  if (hostIs('ats.rippling.com')) return 'rippling';
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
  const adapter = getAtsAdapter(ats);
  if (typeof adapter.normalizeUrl === 'function') return adapter.normalizeUrl(url);
  const u = safeUrl(url);
  if (!u) return url || '';
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
  try {
    return await fetchText(url, {
      timeoutMs,
      headers:{'user-agent':process.env.HERMES_ATS_USER_AGENT || 'Mozilla/5.0 Hermes Jobs ATS Resolver'}
    });
  } catch {
    return '';
  }
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
function loadRepoDotEnv() {
  try {
    const text = fs.readFileSync(path.resolve(__dirname, '../../../.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]]) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1,-1);
      process.env[m[1]] = val;
    }
  } catch {}
}
function envFirst(keys) { for (const k of keys) if (process.env[k]) return process.env[k]; return ''; }
function defaultCoverLetterText() {
  const candidates = [
    process.env.COVER_MD,
    path.join(REPO_ROOT, 'anthony.ettinger.cover4.md'),
    path.join(REPO_ROOT, 'anthony.ettinger.cover.md')
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
  if (opts.loadDotEnv || process.env.HERMES_LOAD_REPO_DOTENV === '1') loadRepoDotEnv();
  const profile = {
    name: opts.name || process.env.HERMES_APPLICANT_NAME || 'Anthony Ettinger',
    email: opts.email || envFirst(['HERMES_APPLICANT_EMAIL','APPLICANT_EMAIL']),
    phone: opts.phone || envFirst(['HERMES_APPLICANT_PHONE','APPLICANT_PHONE']),
    phoneDigits: String(opts.phone || envFirst(['HERMES_APPLICANT_PHONE','APPLICANT_PHONE'])).replace(/\D+/g,'').replace(/^1(?=\d{10}$)/,''),
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
    photoPath: opts.photoPath || job.photoPath || process.env.HERMES_APPLICANT_PHOTO || process.env.APPLICANT_PHOTO || PHOTO_PATH,
    coverLetter: normalizeCoverLetterText(opts.coverLetter || job.coverLetter || defaultCoverLetterText()),
    profile: { ...profile, firstName: firstName || '', lastName: rest.join(' ') }
  };
}

function canAutoSubmit(job = {}) {
  if (['native-profile','marketplace-proposal'].includes(job.applicationMode)) return false;
  const ats = detectAts(job.applyUrl || job.sourceUrl);
  if (ats === 'ashby' && process.env.HERMES_DISABLE_ASHBY === '1') return false;
  return job.applicationMode ? ['external-ats','email','external','external-link'].includes(job.applicationMode) : true;
}

function classifyScreeningAnswer(question, choices = []) {
  const raw = String(question || '').replace(/\s+/g, ' ').trim();
  const q = raw.toLowerCase();
  const opts = Array.isArray(choices) ? choices.map(String) : [];
  const has = (re) => re.test(q);
  const choice = (re) => opts.find(o => re.test(o));

  if (!q) return null;
  if (has(/startup company/)) return 'yes';
  if (has(/18 years of age or older|over\s*18|eighteen years/)) return 'yes';
  if (has(/full[- ]time employment|interested in full[- ]time/)) return 'yes';
  if (has(/(?:text|sms) messages?|receiving texts?|consent to receiving text|do not consent to receiving text/)) return 'no';
  if (has(/(?:how|what).*(?:authorized|authorised|work authorization|work authori[sz]ation|work eligibility|citizenship)/) || has(/if.*yes.*previous.*authorized/)) {
    return choice(/us citizenship|u\.?s\.? citizen|citizen/i) || 'US Citizenship';
  }
  if (/(?:authorized|authorised|eligible|eligibility|legal right|citizen|green card).*(?:work|employment|living|resid).*(?:united states|u\.?s\.?|usa|50 states)/.test(q) || /(?:work|employment|living|resid).*(?:authorized|authorised|eligible|citizen|green card).*(?:united states|u\.?s\.?|usa|50 states)/.test(q)) return 'yes';
  if (/(?:need|require|requires|requiring).*(?:visa|sponsor|sponsorship)/.test(q) || /(?:visa|sponsor|sponsorship).*(?:need|require|requires|requiring)/.test(q)) return 'no';
  if (/acceptable.*(?:salary|compensation|pay).*range/.test(q) || /(?:salary|compensation|pay).*range.*acceptable/.test(q)) return 'no';
  if (has(/(?:previously|formerly|ever).*(?:employed|worked).*(?:with|for|at)\b/) || has(/(?:employed|worked).*(?:with|for|at).*(?:previously|formerly|before)/) || has(/(?:recruiting process|interviewed|spoken to anyone).*(?:role|position|company|associates)/)) return 'no';
  if (has(/family|friends?.*(?:currently )?employed|related to anyone at the company/)) return 'no';
  if (has(/(?:ccpa|privacy|consumer privacy|disclosure|policy).*(?:acknowledge|provided|consent|agree)/) || has(/(?:acknowledge|provided|consent|agree).*(?:ccpa|privacy|consumer privacy|disclosure|policy)/)) return 'yes';
  if (has(/(?:event|conference|kubecon).*(?:meet|met|see|saw|attend|attending)/) || has(/(?:meet|met|see|saw).*(?:event|conference|kubecon)/)) return 'no';
  if (has(/(?:active|current).*(?:clearance|security clearance|government issued clearance)/) || has(/(?:clearance|security clearance).*(?:active|current|level)/)) return 'no';
  if (has(/(?:credentialed|credential).*(?:with|by)/)) return 'no';
  if (has(/production llm-powered system|built.*operated.*production.*llm|served real end users.*live environment/)) return 'yes';
  if (has(/\b(?:pmp|scrum master|prince2|project management professional|certification|certified|credential)s?\b/)) return 'no';
  if (has(/\b(?:ehr|emr|meditech|cerner|oracle health|epic|hl7|fhir)\b/)) return 'no';
  if (has(/hospital settings?|in hospitals?|clinical setting/) && has(/(?:delivered|implemented|deployed|rolled out|solution|healthcare it)/)) return 'no';

  if (has(/\b(?:ai|llm|claude|cursor|codex|copilot|ai-assisted|artificial intelligence)\b/) && has(/(?:tool|workflow|daily|familiar|comfort|experience|use|work)/)) return 'yes';
  if (has(/healthcare/) && has(/(?:technology vendor|tech vendor|vendor|software vendor|health tech|healthtech)/)) return 'yes';
  if (has(/(?:software|technical|technology|customer|client).*(?:implementation|delivery|project)/) || has(/(?:implementation|delivery|project).*(?:software|technical|technology|customer|client)/)) return 'yes';
  if (has(/(?:lead|run|facilitate).*(?:meeting|stakeholder|client|customer|executive|technical|clinical)/) || has(/(?:build|earn).*(?:trust|relationship)/)) return 'yes';
  if (has(/(?:written|verbal|communication|communicate|translat).*(?:technical|clinical|audience|stakeholder|clear)/) || has(/(?:technical|clinical).*(?:audience|stakeholder).*(?:communicat|translat)/)) return 'yes';
  if (has(/(?:own|ownership|primary contact|client relationship|customer relationship|kickoff|ongoing success|project plan|timeline|training)/) && has(/(?:comfortable|thrive|experience|ability|can you|do you|are you|would you)/)) return 'yes';
  if (has(/(?:5\+|five\+|five or more|at least five|\b5 years\b).*(?:software|implementation|project|customer|client)/)) return 'yes';
  if (has(/(?:ruby on rails|\brails\b|production\s+ml|machine learning|reinforcement|closed-loop|software engineering|full[- ]?stack|python|node|javascript|typescript|react|svelte|api)/) && has(/(?:experience|hands-on|production|used|built|developed|engineering)/)) return 'yes';
  if (has(/(?:pacific time|\bpst\b|\bpt\b|overlap)/) && has(/(?:able|can|comfortable|consistently|work)/)) return 'yes';

  return null;
}

function cleanEmployerCandidate(s) {
  const out=decodeHtmlEntities(String(s||''))
    .replace(/\s+/g,' ')
    .replace(/^(?:careers?|jobs?|job application|apply|at)\s+/i,'')
    .replace(/\s+(?:careers?|jobs?|team)$/i,'')
    .trim();
  if(!out || out.length<2 || out.length>80) return '';
  if(/^(lever|greenhouse|ashby|workable|rippling|breezy|workday|jobvite|icims|smartrecruiters|apply)$/i.test(out)) return '';
  if(/^(?:company\s+website|company|website|careers?|jobs?|job\s+board|job\s+posting|application|hiring\s+team|recruiting\s+team|talent\s+team)$/i.test(out)) return '';
  return out;
}
function companyFromJobPageData(data={}) {
  data = data || {};
  const json = Array.isArray(data.jsonLd) ? data.jsonLd : [];
  for (const obj of json) {
    const org = obj && (obj.hiringOrganization || obj.organization || obj.employerOverview);
    const name = typeof org === 'string' ? org : org && org.name;
    const c=cleanEmployerCandidate(name);
    if(c) return c;
  }
  const explicit = Array.isArray(data.explicit) ? data.explicit : [];
  for (const s of explicit) { const c=cleanEmployerCandidate(s); if(c) return c; }
  return '';
}
async function extractEmployerFromJobPage(page) {
  const data = await page.evaluate(() => {
    function text(sel){ return Array.from(document.querySelectorAll(sel)).map(e=>(e.textContent||e.getAttribute('content')||'').trim()).filter(Boolean); }
    const jsonLd=[];
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { const parsed=JSON.parse(el.textContent||'{}'); if(Array.isArray(parsed)) jsonLd.push(...parsed); else jsonLd.push(parsed); } catch {}
    }
    return {
      jsonLd,
      explicit:[
        ...text('[data-qa="posting-company"], .posting-company, .company-name, .job-company, .ashby-job-posting-brief-company-name, [class*="company"]'),
        ...text('meta[property="og:site_name"], meta[name="author"]')
      ]
    };
  }).catch(()=>({}));
  return companyFromJobPageData(data);
}
function refreshPayloadCoverLetterFromVerifiedEmployer(payload, employer) {
  const company=cleanEmployerCandidate(employer);
  if(!company) {
    payload.coverLetter=normalizeCoverLetterText(generateCoverLetter({...payload.job, metadata:{...(payload.job?.metadata||{}), employerVerifiedFromJobPage:false}}));
    return '';
  }
  payload.job={...payload.job, company, metadata:{...(payload.job?.metadata||{}), employerVerifiedFromJobPage:true, employerExtractedFrom:'job-page'}};
  payload.coverLetter=normalizeCoverLetterText(generateCoverLetter(payload.job));
  return company;
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
  const text = normalizeCoverLetterText(value);
  for (const sel of selectors) {
    const el = await page.$(sel).catch(()=>null);
    if (el) {
      let set = false;
      if (typeof el.evaluate === 'function') set = await el.evaluate((node, v) => {
        if (!node) return false;
        const tag = String(node.tagName || '').toLowerCase();
        if (tag === 'textarea' || node.isContentEditable) {
          node.focus?.();
          if (node.isContentEditable) node.innerText = v;
          else {
            const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            const oldValue = node.value || '';
            if (desc && desc.set) desc.set.call(node, v); else node.value = v;
            if (node._valueTracker) node._valueTracker.setValue(oldValue);
          }
          node.dispatchEvent(new Event('input',{bubbles:true}));
          node.dispatchEvent(new Event('change',{bubbles:true}));
          node.dispatchEvent(new Event('blur',{bubbles:true}));
          return true;
        }
        return false;
      }, text).catch(()=>false);
      if (!set) { await el.click({clickCount:3}).catch(()=>{}); await el.type(String(text), {delay:5}).catch(()=>{}); }
      return true;
    }
  }
  return false;
}
async function uploadDocuments(page, {resumePath, coverPdfPath, photoPath}) {
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
    const file = /photo|headshot|avatar|profile.?image|picture|portrait/.test(label) && photoPath && fs.existsSync(photoPath) ? photoPath
      : /cover/.test(label) && coverPdfPath && fs.existsSync(coverPdfPath) ? coverPdfPath
      : resumePath;
    await input.uploadFile(file).then(()=>uploaded++).catch(()=>{});
  }
  return uploaded;
}
async function fillKnownCustomQuestions(page, payload) {
  const answers = {
    salaryAnnual: process.env.HERMES_APPLICANT_DESIRED_SALARY || '$350,000',
    salaryNumeric: String(process.env.HERMES_APPLICANT_DESIRED_SALARY || '350000').replace(/[^0-9.]/g,'') || '350000',
    hourlyRate: process.env.HERMES_APPLICANT_HOURLY_RATE || '$135/hour',
    location: payload.profile.location || process.env.HERMES_APPLICANT_LOCATION || 'Los Gatos, CA, USA',
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
      if (/salary|annual|compensation/.test(label)) setValue(el, ((el.type || '').toLowerCase() === 'number') ? a.salaryNumeric : a.salaryAnnual);
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
    phoneDigits: p.phoneDigits || String(p.phone || '').replace(/\D+/g,'').replace(/^1(?=\d{10}$)/,''),
    location: p.location || process.env.HERMES_APPLICANT_LOCATION || 'Los Gatos, CA, USA',
    city: process.env.HERMES_APPLICANT_CITY || 'Los Gatos',
    state: process.env.HERMES_APPLICANT_STATE || 'CA',
    postal: process.env.HERMES_APPLICANT_POSTAL || process.env.HERMES_APPLICANT_ZIP || '95032',
    address: process.env.HERMES_APPLICANT_ADDRESS || process.env.HERMES_APPLICANT_LOCATION || 'Los Gatos, CA',
    country: process.env.HERMES_APPLICANT_COUNTRY || 'United States',
    linkedin: p.linkedin,
    github: p.github,
    website: p.website || p.github || p.linkedin,
    twitter: process.env.HERMES_APPLICANT_TWITTER || process.env.APPLICANT_TWITTER || '',
    coverLetter: payload.coverLetter,
    workAuth: p.workAuth,
    salaryAnnual: process.env.HERMES_APPLICANT_DESIRED_SALARY || '$350,000',
    salaryNumeric: String(process.env.HERMES_APPLICANT_DESIRED_SALARY || '350000').replace(/[^0-9.]/g,'') || '350000',
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
      const oldValue = el.value || '';
      if (desc && desc.set) desc.set.call(el, value); else el.value = value;
      if (el._valueTracker) el._valueTracker.setValue(oldValue);
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      return true;
    }
    for (const el of document.querySelectorAll('input, textarea')) {
      const label = labelFor(el);
      if (/first\s*name|given\s*name/.test(label)) set(el, a.firstName);
      else if (/last\s*name|family\s*name|surname/.test(label)) set(el, a.lastName);
      else if (/otherwise.*n\/?a|family.*friend.*name|their name\(s\)/.test(label)) set(el, 'N/A');
      else if (/full\s*name|^name\b|\bname\b/.test(label) && !/company|school|employer|file/.test(label)) set(el, a.name);
      else if (/e-?mail|email/.test(label)) set(el, a.email);
      else if (/phone|mobile|telephone/.test(label)) set(el, /country.*phone.*code/.test(label) ? '' : (el.type === 'tel' || /phone\s*number/.test(label) ? (a.phoneDigits || a.phone) : a.phone));
      else if (/linkedin/.test(label)) set(el, a.linkedin);
      else if (/twitter|x url|x\.com/.test(label)) set(el, a.twitter);
      else if (/github/.test(label)) set(el, a.github);
      else if (/website|portfolio|personal site|url/.test(label) && !/linkedin|github/.test(label)) set(el, a.website);
      else if (/cover\s*letter|why.*interested|summary/.test(label)) set(el, el.tagName === 'TEXTAREA' ? a.coverLetter : 'Please see my attached resume and cover letter.');
      else if (/salary|annual|compensation/.test(label)) set(el, ((el.type || '').toLowerCase() === 'number') ? a.salaryNumeric : a.salaryAnnual);
      else if (/hourly|rate/.test(label)) set(el, a.hourlyRate);
      else if (/start\s*date|earliest\s*start/.test(label)) set(el, a.start);
      else if (/city/.test(label)) set(el, a.city);
      else if (/state|province/.test(label)) set(el, a.state);
      else if (/postal|zip/.test(label)) set(el, a.postal);
      else if (/country/.test(label) && !/country.*phone.*code/.test(label)) set(el, a.country);
      else if (/address\s*line\s*1|street/.test(label)) set(el, a.address);
      else if (/address|location|where.*based|current.*based/.test(label)) set(el, a.location);
      else if (/work.*auth|authorized.*work/.test(label)) set(el, a.workAuth);
    }
    for (const sel of document.querySelectorAll('select')) {
      if (!visible(sel) || sel.disabled || sel.value) continue;
      const label = labelFor(sel);
      const want = /country/.test(label) ? /(united states|usa|us\b)/i
        : /state|province/.test(label) ? /^(ca|california)$/i
        : /sponsor/.test(label) ? /no/i
        : /authorized|work.*auth|eligib|citizen/.test(label) ? /(yes|authorized|citizen|united states|usa)/i
        : /gender/.test(label) ? /(^|\b)male\b/i
        : /race|ethnicity|ethnic/.test(label) ? /(^|\b)white\b/i
        : /veteran|disability/.test(label) ? /(decline|prefer not|do not wish|not disclose)/i
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
    state: process.env.HERMES_APPLICANT_STATE || 'CA',
    city: process.env.HERMES_APPLICANT_CITY || 'Los Gatos',
    location: payload.profile.location || process.env.HERMES_APPLICANT_LOCATION || 'Los Gatos, CA, USA',
    authorized: 'Yes',
    sponsorship: 'No',
    salaryAnnual: process.env.HERMES_APPLICANT_DESIRED_SALARY || '$350,000',
    salaryNumeric: String(process.env.HERMES_APPLICANT_DESIRED_SALARY || '350000').replace(/[^0-9.]/g,'') || '350000',
    hourlyRate: process.env.HERMES_APPLICANT_HOURLY_RATE || '$135/hour',
    gender: 'Male',
    race: 'White',
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
      const oldValue = el.value || '';
      if (desc?.set) desc.set.call(el, value); else el.value = value;
      if (el._valueTracker) el._valueTracker.setValue(oldValue);
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
      else if (/salary|compensation/.test(label)) setInput(el, ((el.type || '').toLowerCase() === 'number') ? a.salaryNumeric : a.salaryAnnual);
      else if (/hourly|rate/.test(label)) setInput(el, a.hourlyRate);
    }
    for (const sel of document.querySelectorAll('select')) {
      const label = labelFor(sel);
      if (/country/.test(label)) chooseSelect(sel, [/united states/i, /^usa$/i, /^us$/i]);
      else if (/state|province/.test(label)) chooseSelect(sel, [/^ca$/i, /california/i]);
      else if (/sponsor|visa/.test(label)) chooseSelect(sel, [/^no$/i, /not.*require/i]);
      else if (/authorized|eligible.*work|work.*auth/.test(label)) chooseSelect(sel, [/^yes$/i, /authorized/i, /citizen/i]);
      else if (/gender/.test(label)) chooseSelect(sel, [/^male$/i, /\bmale\b/i]);
      else if (/race|ethnic/.test(label)) chooseSelect(sel, [/^white$/i, /\bwhite\b/i]);
      else if (/veteran|disability|demographic/.test(label)) chooseSelect(sel, [/prefer not/i, /decline/i, /do not wish/i, /not disclose/i]);
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
        : /gender/.test(text) ? [/^male$/i, /\bmale\b/i]
        : /race|ethnic/.test(text) ? [/^white$/i, /\bwhite\b/i]
        : /veteran|disability|demographic/.test(text) ? [/prefer not/i, /decline/i, /not disclose/i]
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
    salaryNumeric: String(process.env.HERMES_APPLICANT_DESIRED_SALARY || '350000').replace(/[^0-9.]/g,'') || '350000',
    hourlyRate: process.env.HERMES_APPLICANT_HOURLY_RATE || '$135/hour',
    location: payload.profile.location || process.env.HERMES_APPLICANT_LOCATION || 'Los Gatos, CA, USA',
    recentAiProject: 'Recently I built an AI-assisted job application and resume automation system using LLMs, retrieval over job/resume context, browser automation, and conservative submission verification. My role covered the system design, Node.js/Puppeteer automation, prompt/data strategy, ATS adapters, queue state, tests, and production hardening.',
    dbieExample: 'I have changed my engineering process to make assumptions explicit, add accessibility-oriented checks, and provide human handoff when automation is uncertain. That helps avoid creating unnecessary barriers and makes communication clearer and more inclusive.'
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
      const oldValue = el.value || '';
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(el, value); else el.value = value;
      if (el._valueTracker) el._valueTracker.setValue(oldValue);
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
      const value = /describe.*recent.*project.*(?:ai|llm|retrieval)|recent.*project.*(?:ai|llm|retrieval)|applied.*(?:ai|llm|retrieval).*production|problem.*approach.*specific contribution/.test(label) ? a.recentAiProject
        : /\bdbie\b|diversity.*belonging.*inclusion.*equity|belonging.*inclusion.*equity|change.*behavior.*decision.*communication|inclusive.*equity/.test(label) ? a.dbieExample
        : /cover|summary|why|interest|additional/.test(label) ? (el.tagName === 'TEXTAREA' ? a.coverLetter : 'Please see my attached resume and cover letter.')
        : /salary|compensation|annual/.test(label) ? (((el.type || '').toLowerCase() === 'number') ? a.salaryNumeric : a.salaryAnnual)
        : /hourly|rate/.test(label) ? a.hourlyRate
        : /location|city|country|address/.test(label) ? a.location
        : /years.*(ai|ml|machine|llm)/.test(label) ? a.yearsAi
        : /years|experience/.test(label) ? a.yearsSoftware
        : a.text;
      setValue(el, value);
    }
  }, fallback).catch(()=>{});
}
async function fillAdapterSpecificFields(page, payload) {
  const a = {
    ats: payload.ats,
    name: payload.profile?.name || 'Anthony Ettinger',
    firstName: payload.profile?.firstName || 'Anthony',
    lastName: payload.profile?.lastName || 'Ettinger',
    email: payload.profile?.email || '',
    phone: payload.profile?.phone || '',
    phoneDigits: payload.profile?.phoneDigits || String(payload.profile?.phone || '').replace(/\D+/g,'').replace(/^1(?=\d{10}$)/,''),
    location: payload.profile?.location || process.env.HERMES_APPLICANT_LOCATION || 'Los Gatos, CA, USA',
    city: process.env.HERMES_APPLICANT_CITY || 'Los Gatos',
    state: process.env.HERMES_APPLICANT_STATE || 'CA',
    postal: process.env.HERMES_APPLICANT_POSTAL || process.env.HERMES_APPLICANT_ZIP || '95032',
    address: process.env.HERMES_APPLICANT_ADDRESS || process.env.HERMES_APPLICANT_LOCATION || 'Los Gatos, CA',
    country: process.env.HERMES_APPLICANT_COUNTRY || 'United States',
    linkedin: payload.profile?.linkedin || '',
    github: payload.profile?.github || '',
    website: payload.profile?.website || payload.profile?.github || payload.profile?.linkedin || '',
    workAuth: payload.profile?.workAuth || 'US Citizen',
    salaryAnnual: process.env.HERMES_APPLICANT_DESIRED_SALARY || '$350,000',
    salaryNumeric: String(process.env.HERMES_APPLICANT_DESIRED_SALARY || '350000').replace(/[^0-9.]/g,'') || '350000',
    hourlyRate: process.env.HERMES_APPLICANT_HOURLY_RATE || '$135/hour',
    start: process.env.HERMES_APPLICANT_START_DATE || 'Immediately',
    currentCompany: process.env.HERMES_APPLICANT_CURRENT_COMPANY || 'Independent Consultant',
    coverLetter: payload.coverLetter || 'Please see my attached resume and cover letter.',
    yearsAi: process.env.HERMES_APPLICANT_AI_YEARS || '5+ years',
    yearsSoftware: process.env.HERMES_APPLICANT_SOFTWARE_YEARS || '20+ years',
    yearsSoftwareNumeric: String(process.env.HERMES_APPLICANT_SOFTWARE_YEARS || '20').replace(/[^0-9.]/g,'') || '20',
    aiTools: 'Claude, Claude Code, Cursor, Codex, OpenAI, Anthropic APIs, Gemini, GitHub Copilot, and custom LLM-powered automation workflows.',
    aiApps: 'I have built production AI-powered applications and automation systems using major LLM APIs, including OpenAI and Anthropic/Claude, with full-stack integrations, browser automation, data pipelines, and agentic workflows.',
    recentAiProject: 'Recently I built an AI-assisted job application and resume automation system that uses LLMs, retrieval over job/resume context, browser automation, and conservative submission verification. The system parses job posts, generates tailored cover letters, fills ATS forms with Puppeteer, detects blockers, and records manual handoff events so repeated blockers can become automated fixes. My specific contribution was end-to-end system design and implementation: Node.js automation, prompt/data strategy, ATS adapters, file generation, queue state, tests, and production hardening.',
    dbieExample: 'In recent product and automation work, I changed how I communicate and review systems by explicitly checking whether defaults, wording, and edge cases create unnecessary barriers for people. A concrete example is adding clearer review paths, accessibility-oriented form handling, and human handoff instead of forcing brittle automation when the system is uncertain. That changed my behavior from optimizing only for speed to also documenting assumptions, making failure states visible, and giving people a safer way to correct or complete the process.'
  };
  await page.evaluate((a) => {
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects?.().length)); }
    function labelFor(el){
      const id = el.id ? document.querySelector?.(`label[for="${CSS.escape(el.id)}"]`)?.innerText : '';
      const labels = el.labels ? Array.from(el.labels).map(l => l.innerText).join(' ') : '';
      const ariaBy = (el.getAttribute?.('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById?.(id)?.innerText || '').join(' ');
      const question = el.closest?.('.multiplechoice,.dropdown,li.question,.question,.questionnaire-question,.application-question,.field,.form-group,.form-field,.control,.bzy-form-group');
      const near = question?.innerText || el.closest?.('label,li,div')?.innerText || '';
      return `${id||''} ${labels||''} ${ariaBy||''} ${near||''} ${el.name||''} ${el.id||''} ${el.placeholder||''} ${el.getAttribute?.('aria-label')||''}`.replace(/\s+/g,' ').toLowerCase();
    }
    function setValue(el, value){
      if (!value || !visible(el) || el.disabled || el.readOnly) return false;
      const type = (el.type || '').toLowerCase();
      if (['hidden','file','submit','button','checkbox','radio'].includes(type)) return false;
      if (el.value && !/^resumator_no_selection$|^\?$/.test(el.value)) return false;
      const oldValue = el.value || '';
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(el, value); else el.value = value;
      if (el._valueTracker) el._valueTracker.setValue(oldValue);
      el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.dispatchEvent(new Event('blur',{bubbles:true}));
      return true;
    }
    function chooseSelect(sel, patterns){
      if (!visible(sel) || sel.disabled) return false;
      if (sel.value && !/^resumator_no_selection$|^\?|undefined/i.test(sel.value)) return false;
      const opts = Array.from(sel.options || []);
      for (const re of patterns) {
        const opt = opts.find(o => o.value !== '' && !/select|choose/i.test(o.text || '') && (re.test(o.text || '') || re.test(o.value || '')));
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); return true; }
      }
      return false;
    }
    // Stable names/ids used by Breezy, Greenhouse, and ApplyToJob/JazzHR variants.
    for (const el of document.querySelectorAll('input,textarea')) {
      const label = labelFor(el);
      if (/otherwise.*n\/?a|family.*friend.*name|their name\(s\)/.test(label)) setValue(el, 'N/A');
      else if (el.name === 'cName') setValue(el, a.name);
      else if (el.name === 'cEmail') setValue(el, a.email);
      else if (el.name === 'cPhoneNumber') setValue(el, a.phoneDigits || a.phone);
      else if (/^first_name$|first.*name|given.*name/.test(el.id || label)) setValue(el, a.firstName);
      else if (/^last_name$|last.*name|family.*name|surname/.test(el.id || label)) setValue(el, a.lastName);
      else if (/^email$|e-?mail/.test(el.id || label)) setValue(el, a.email);
      else if (/^phone$|phone|mobile|telephone/.test(el.id || label)) setValue(el, /country.*phone.*code/.test(label) ? '' : (a.phoneDigits || a.phone));
      else if (/salary|compensation/.test(label)) setValue(el, ((el.type || '').toLowerCase() === 'number') ? a.salaryNumeric : a.salaryAnnual);
      else if (/available.*start|start\s*date|when.*start/.test(label)) setValue(el, a.start);
      else if (/remote.*where.*working|where.*working.*country.*state.*city/.test(label)) setValue(el, a.location);
      else if (/location.*city|city.*location|\bcity\b/.test(el.id || label)) setValue(el, a.city);
      else if (/\blocation\b/.test(el.id || label)) setValue(el, a.location);
      else if (el.name === 'cAddress' || el.id === 'fullAddress') setValue(el, a.location);
      else if (el.name === 'cSalary') setValue(el, ((el.type || '').toLowerCase() === 'number') ? a.salaryNumeric : a.salaryAnnual);
      else if (el.name === 'cSummary') setValue(el, a.coverLetter);
      else if (el.name === 'cCoverLetter') setValue(el, a.coverLetter);
      else if (el.name === 'org') setValue(el, a.currentCompany);
      else if (/years.*(engineering|software|professional)|professional.*software.*engineering|software.*engineering.*experience/.test(label)) setValue(el, (el.type || '').toLowerCase() === 'number' ? a.yearsSoftwareNumeric : a.yearsSoftware);
      else if (/years.*(ai|ml|llm|machine)|ai.*experience|llm.*experience/.test(label)) setValue(el, a.yearsAi);
      else if (/which.*ai.*tools|ai tools.*experience|tools.*experience.*ai/.test(label)) setValue(el, a.aiTools);
      else if (/describe.*recent.*project.*(?:ai|llm|retrieval)|recent.*project.*(?:ai|llm|retrieval)|applied.*(?:ai|llm|retrieval).*production|problem.*approach.*specific contribution/.test(label)) setValue(el, a.recentAiProject);
      else if (/\bdbie\b|diversity.*belonging.*inclusion.*equity|belonging.*inclusion.*equity|change.*behavior.*decision.*communication|inclusive.*equity/.test(label)) setValue(el, a.dbieExample);
      else if (/describe.*experience.*(ai|llm)|experience.*building.*ai|building.*ai-powered/.test(label)) setValue(el, a.aiApps);
      else if (/how.*hear|how.*heard|source.*opportunity|hear.*opportunity/.test(label)) setValue(el, 'Google / job search');
      else if (/current.*state.*residency|state.*residency/.test(label)) setValue(el, a.state);
      else if (/middle\s*name/.test(label)) setValue(el, 'N/A');
      else if (/pronouns?/.test(label)) setValue(el, 'He/him/his');
      else if (a.ats === 'ashby' && /first and last name.*legal name/.test(label)) setValue(el, a.name);
      else if (a.ats === 'ashby' && /website|portfolio/.test(label)) setValue(el, a.website);
      else if (a.ats === 'ashby' && /snack fuels|favorite snack|best ideas/.test(label)) setValue(el, 'Trail mix');
      else if (a.ats === 'ashby' && /start typing/i.test(el.placeholder || '') && !el.name && !el.id) setValue(el, a.location);
      else if (a.ats === 'ashby' && /why.*work.*(?:curri|company|here)|why.*want.*work/.test(label)) setValue(el, 'I am excited about the role because it combines product-minded engineering, automation, and real operational impact. My background in full-stack software, AI workflows, and customer-facing systems maps well to building useful tools for distributed teams and improving delivery workflows.');
      else if (a.ats === 'ashby' && /plumber.*sparked.*idea|sparked.*idea.*curri/.test(label)) setValue(el, 'I am not sure.');
      else if (a.ats === 'ashby' && /project.*highlight|feature.*system.*built.*proud|what.*was.*your.*role/.test(label)) setValue(el, 'I built AI-assisted resume and job-application automation that generates tailored documents, scores remote roles, drives ATS forms through Puppeteer, and verifies submissions conservatively. My role covered the full stack: Node.js automation, browser adapters, data pipelines, testing, and production hardening.');
      else if (a.ats === 'ashby' && /anything.*else.*like.*know/.test(label)) setValue(el, 'Please see my resume and cover letter for details on my full-stack engineering, AI automation, and customer-facing delivery experience.');
      else if (/urls\[LinkedIn\]/i.test(el.name)) setValue(el, a.linkedin);
      else if (/urls\[GitHub\]/i.test(el.name)) setValue(el, a.github);
      else if (/urls\[Portfolio\]/i.test(el.name)) setValue(el, a.website);
    }
    // Workable compound free-text question
    for (const el of document.querySelectorAll('textarea,input')) {
      const label = labelFor(el);
      if (/linkedin url.*current location.*expected salary|expected salary.*work authori|available to start/.test(label)) {
        setValue(el, `LinkedIn: ${a.linkedin}\nCurrent location: ${a.location}\nExpected salary: ${a.salaryAnnual} USD per year\nRemote/hybrid/on-site preference: Remote\nWork authorization: ${a.workAuth}\nAvailable to start: ${a.start}`);
      } else if (/vibe coded experience|build.*ai.*prototype|ai.*project/.test(label)) {
        setValue(el, 'I have built production AI and automation systems, including LLM-powered workflows, browser automation, data pipelines, and full-stack applications. Please see my resume and portfolio for examples.');
      }
    }
    function classifyScreeningAnswerInPage(question, choices) {
      const q = String(question || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const opts = Array.isArray(choices) ? choices.map(String) : [];
      const has = (re) => re.test(q);
      const choice = (re) => opts.find(o => re.test(o));
      if (!q) return null;
      if (has(/startup company/)) return 'yes';
      if (has(/18 years of age or older|over\s*18|eighteen years/)) return 'yes';
      if (has(/full[- ]time employment|interested in full[- ]time/)) return 'yes';
      if (has(/(?:text|sms) messages?|receiving texts?|consent to receiving text|do not consent to receiving text/)) return 'no';
      if (has(/(?:how|what).*(?:authorized|authorised|work authorization|work authori[sz]ation|work eligibility|citizenship)/) || has(/if.*yes.*previous.*authorized/)) return choice(/us citizenship|u\.?s\.? citizen|citizen/i) || 'US Citizenship';
  if (/(?:authorized|authorised|eligible|eligibility|legal right|citizen|green card).*(?:work|employment|living|resid).*(?:united states|u\.?s\.?|usa|50 states)/.test(q) || /(?:work|employment|living|resid).*(?:authorized|authorised|eligible|citizen|green card).*(?:united states|u\.?s\.?|usa|50 states)/.test(q)) return 'yes';
  if (/(?:need|require|requires|requiring).*(?:visa|sponsor|sponsorship)/.test(q) || /(?:visa|sponsor|sponsorship).*(?:need|require|requires|requiring)/.test(q)) return 'no';
  if (/acceptable.*(?:salary|compensation|pay).*range/.test(q) || /(?:salary|compensation|pay).*range.*acceptable/.test(q)) return 'no';
      if (has(/(?:previously|formerly|ever).*(?:employed|worked).*(?:with|for|at)\b/) || has(/(?:employed|worked).*(?:with|for|at).*(?:previously|formerly|before)/) || has(/(?:recruiting process|interviewed|spoken to anyone).*(?:role|position|company|associates)/)) return 'no';
      if (has(/(?:ccpa|privacy|consumer privacy|disclosure|policy).*(?:acknowledge|provided|consent|agree)/) || has(/(?:acknowledge|provided|consent|agree).*(?:ccpa|privacy|consumer privacy|disclosure|policy)/)) return 'yes';
      if (has(/family|friends?.*(?:currently )?employed|related to anyone at the company/)) return 'no';
      if (has(/(?:event|conference|kubecon).*(?:meet|met|see|saw|attend|attending)/) || has(/(?:meet|met|see|saw).*(?:event|conference|kubecon)/)) return 'no';
      if (has(/(?:active|current).*(?:clearance|security clearance|government issued clearance)/) || has(/(?:clearance|security clearance).*(?:active|current|level)/)) return 'no';
      if (has(/(?:credentialed|credential).*(?:with|by)/)) return 'no';
      if (has(/\b(?:pmp|scrum master|prince2|project management professional|certification|certified|credential)s?\b/)) return 'no';
      if (has(/\b(?:ehr|emr|meditech|cerner|oracle health|epic|hl7|fhir)\b/)) return 'no';
      if (has(/hospital settings?|in hospitals?|clinical setting/) && has(/(?:delivered|implemented|deployed|rolled out|solution|healthcare it)/)) return 'no';
      if (has(/\b(?:ai|llm|claude|cursor|codex|copilot|ai-assisted|artificial intelligence)\b/) && has(/(?:tool|workflow|daily|familiar|comfort|experience|use|work)/)) return 'yes';
      if (has(/healthcare/) && has(/(?:technology vendor|tech vendor|vendor|software vendor|health tech|healthtech)/)) return 'yes';
      if (has(/(?:software|technical|technology|customer|client).*(?:implementation|delivery|project)/) || has(/(?:implementation|delivery|project).*(?:software|technical|technology|customer|client)/)) return 'yes';
      if (has(/(?:lead|run|facilitate).*(?:meeting|stakeholder|client|customer|executive|technical|clinical)/) || has(/(?:build|earn).*(?:trust|relationship)/)) return 'yes';
      if (has(/(?:written|verbal|communication|communicate|translat).*(?:technical|clinical|audience|stakeholder|clear)/) || has(/(?:technical|clinical).*(?:audience|stakeholder).*(?:communicat|translat)/)) return 'yes';
      if (has(/(?:own|ownership|primary contact|client relationship|customer relationship|kickoff|ongoing success|project plan|timeline|training)/) && has(/(?:comfortable|thrive|experience|ability|can you|do you|are you|would you)/)) return 'yes';
      if (has(/(?:5\+|five\+|five or more|at least five|\b5 years\b).*(?:software|implementation|project|customer|client)/)) return 'yes';
      if (has(/(?:ruby on rails|\brails\b|production\s+ml|machine learning|reinforcement|closed-loop|software engineering|full[- ]?stack|python|node|javascript|typescript|react|svelte|api)/) && has(/(?:experience|hands-on|production|used|built|developed|engineering)/)) return 'yes';
      if (has(/(?:pacific time|\bpst\b|\bpt\b|overlap)/) && has(/(?:able|can|comfortable|consistently|work)/)) return 'yes';
      return null;
    }
    // Workable/Ashby/Lever radio groups: answer by the meaning of the whole question, not exact question text.
    const groups = new Map();
    for (const r of document.querySelectorAll('input[type=radio]')) {
      if (r.disabled || r.checked) continue;
      const container = r.closest?.('.multiplechoice,li.question,fieldset,[role="radiogroup"],.field,.form-field,.application-question,.question,.questionnaire-question,label,div');
      if (!visible(r) && container && !visible(container)) continue;
      const key = r.name || container || r.id || Math.random().toString();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    function chooseRadio(r){
      const lab = r.id ? document.querySelector?.(`label[for="${CSS.escape(r.id)}"]`) : null;
      if (lab && visible(lab)) lab.click?.(); else r.click?.();
      r.checked = true;
      r.dispatchEvent?.(new Event('input',{bubbles:true}));
      r.dispatchEvent?.(new Event('change',{bubbles:true}));
    }
    for (const group of groups.values()) {
      const whole = group.map(labelFor).join(' ');
      const answer = classifyScreeningAnswerInPage(whole, group.map(r => `${labelFor(r)} ${r.value || ''}`));
      const want = answer === 'yes' ? [/\byes\b/i, /^yes$/i, /true/i, /authorized/i, /5\+|more than|senior/i]
        : answer === 'no' ? [/\bno\b/i, /^no$/i, /false/i]
        : [];
      for (const re of want) {
        const hit = group.find(r => re.test(r.value || '')) || group.find(r => re.test(labelFor(r)));
        if (hit) { chooseRadio(hit); break; }
      }
    }
    for (const cb of document.querySelectorAll('input[type=checkbox]')) {
      if (cb.disabled || cb.checked) continue;
      const label = labelFor(cb);
      const answer = classifyScreeningAnswerInPage(label, ['Yes','No']);
      if (/pronouns?/.test(label) && /he\/him\/his/.test(label)) {
        const lab = cb.id ? document.querySelector?.(`label[for="${CSS.escape(cb.id)}"]`) : null;
        if (lab && visible(lab)) lab.click?.(); else cb.click?.();
        cb.checked = true;
        cb.dispatchEvent?.(new Event('input',{bubbles:true}));
        cb.dispatchEvent?.(new Event('change',{bubbles:true}));
        continue;
      }
      if (answer === 'yes' || /agree|consent|terms|privacy|ccpa|disclosure|acknowledge|confirm|certif/.test(label)) {
        const lab = cb.id ? document.querySelector?.(`label[for="${CSS.escape(cb.id)}"]`) : null;
        if (lab && visible(lab)) lab.click?.(); else cb.click?.();
        cb.checked = true;
        cb.dispatchEvent?.(new Event('input',{bubbles:true}));
        cb.dispatchEvent?.(new Event('change',{bubbles:true}));
      }
    }
    // Workable's current UI uses focusable div[role=radio] wrappers with hidden inputs.
    const roleGroups = new Map();
    for (const r of document.querySelectorAll('[role="radio"]')) {
      if (!visible(r) || r.getAttribute?.('aria-disabled') === 'true' || r.getAttribute?.('aria-checked') === 'true') continue;
      const parent = r.closest?.('[role="radiogroup"], fieldset') || r.parentElement || r;
      if (!roleGroups.has(parent)) roleGroups.set(parent, []);
      roleGroups.get(parent).push(r);
    }
    for (const group of roleGroups.values()) {
      const whole = group.map(labelFor).join(' ');
      const answer = classifyScreeningAnswerInPage(whole, group.map(r => labelFor(r)));
      const want = answer === 'yes' ? [/\byes\b/i, /true/i, /authorized/i, /5\+|more than|senior/i]
        : answer === 'no' ? [/\bno\b/i, /false/i]
        : [];
      for (const re of want) {
        const hit = group.find(r => re.test(labelFor(r)) || re.test(r.querySelector?.('input')?.value || ''));
        if (hit) {
          hit.click?.();
          hit.setAttribute?.('aria-checked','true');
          const input = hit.querySelector?.('input[type="radio"], input');
          if (input) { input.checked = true; input.dispatchEvent?.(new Event('input',{bubbles:true})); input.dispatchEvent?.(new Event('change',{bubbles:true})); }
          break;
        }
      }
    }
    // Ashby yes/no controls render as visible Yes/No buttons plus a hidden checkbox.
      if (a.ats === 'ashby') {
        for (const entry of document.querySelectorAll('.ashby-application-form-field-entry')) {
          const buttons = Array.from(entry.querySelectorAll('button')).filter(visible);
          if (!buttons.some(b => /^yes$/i.test((b.innerText || '').trim())) || !buttons.some(b => /^no$/i.test((b.innerText || '').trim()))) continue;
          const question = (entry.innerText || '').replace(/\s+/g,' ');
          const answer = classifyScreeningAnswerInPage(question, buttons.map(b => b.innerText || '')) || 'yes';
          const hit = buttons.find(b => new RegExp(`^${answer}$`, 'i').test((b.innerText || '').trim())) || buttons.find(b => /^yes$/i.test((b.innerText || '').trim()));
          hit?.click?.();
        }
        for (const entry of document.querySelectorAll('.ashby-application-form-field-entry')) {
          const label = (entry.innerText || '').replace(/\s+/g,' ').toLowerCase();
          const radios = Array.from(entry.querySelectorAll('input[type=radio]')).filter(r => !r.disabled);
          const selectRadio = (re) => {
            const hit = radios.find(r => re.test((r.closest?.('label')?.innerText || r.parentElement?.innerText || r.value || '').replace(/\s+/g,' ').trim()));
            if (hit) {
              const lab = hit.id ? document.querySelector?.(`label[for="${CSS.escape(hit.id)}"]`) : null;
              if (lab && visible(lab)) lab.click?.(); else hit.click?.();
              hit.checked = true;
              hit.dispatchEvent?.(new Event('input',{bubbles:true}));
              hit.dispatchEvent?.(new Event('change',{bubbles:true}));
              return true;
            }
            return false;
          };
          if (/gender identity|\bgender\b/.test(label)) { selectRadio(/^male$|\bmale\b/i); continue; }
          if (/race|ethnicity|ethnic/.test(label)) { selectRadio(/^white$|\bwhite\b/i); continue; }
          if (/veteran status/.test(label)) { selectRadio(/i am not a veteran/i); continue; }
          if (/quality, safety, or compliance/.test(label)) { selectRadio(/privacy\s*\/\s*equity\s*\/\s*regulation compliant|privacy.*equity.*regulation compliant/i); continue; }
          if (/role in system design and technical decision-making/.test(label)) { selectRadio(/shared architectural ownership/i); continue; }
        }
      }
    // ApplyToJob/JazzHR and Jobvite selects
    for (const sel of document.querySelectorAll('select')) {
      const label = labelFor(sel);
      const answer = classifyScreeningAnswerInPage(label, Array.from(sel.options || []).map(o => o.text || o.value || ''));
      if (answer && chooseSelect(sel, [new RegExp(`^${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), new RegExp(answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')])) continue;
      if (/proficiency|skill level|experience level/.test(label)) {
        if (/typescript|javascript|node|react|svelte|api|html|css/.test(label)) { if (chooseSelect(sel, [/expert/i, /proficient/i])) continue; }
        if (/go language|\bgolang\b/.test(label)) { if (chooseSelect(sel, [/^none$/i, /novice/i])) continue; }
        if (/java.*spring|spring boot|\baws\b|cloud service provider/.test(label)) { if (chooseSelect(sel, [/novice/i, /advanced beginner/i, /competent/i])) continue; }
      }
      if (/country/.test(label)) chooseSelect(sel, [/united states/i, /^us$/i, /^usa$/i]);
      else if (/state/.test(label)) chooseSelect(sel, [/california/i, /^ca$/i]);
      else if (/gender/.test(label)) chooseSelect(sel, [/^male$/i, /\bmale\b/i]);
      else if (/race|ethnicity|ethnic/.test(label)) chooseSelect(sel, [/^white$/i, /\bwhite\b/i]);
      else if (/citizenship|eligible|authorized|legally authorized|employment eligibility/.test(label)) chooseSelect(sel, [/yes/i, /citizen/i, /authorized/i, /permanent resident/i]);
      else if (/sponsor|visa/.test(label)) chooseSelect(sel, [/^no$/i, /not.*require/i]);
      else if (/background|credit/.test(label)) chooseSelect(sel, [/^yes$/i]);
      else if (/currently reside.*fl.*ga.*il.*tx|following states/.test(label)) chooseSelect(sel, [/^no$/i]);
      else if (/contact.*text/.test(label)) chooseSelect(sel, [/^no$/i]);
      else if (/how did you learn|source/.test(label)) chooseSelect(sel, [/google/i, /job board/i, /linkedin/i, /other/i, /website/i]);
      else if (/location.*applying|which location/.test(label)) chooseSelect(sel, [/remote/i, /san francisco/i, /new york/i]);
    }
  }, a).catch(()=>{});
}

function dropdownSearchText(optionRes) {
  const specs = optionRes.map(re => String(re.source || '').toLowerCase());
  if (specs.some(s => s.includes('united states'))) return 'United States';
  if (specs.some(s => s.includes('california'))) return 'California';
  if (specs.some(s => s.includes('mobile') || s.includes('cell'))) return 'Mobile';
  if (specs.some(s => s.includes('acknowledge'))) return 'Acknowledge';
  if (specs.some(s => s.includes('agree'))) return 'Agree';
  if (specs.some(s => s.includes('accept'))) return 'Accept';
  if (specs.some(s => s.includes('google'))) return 'Google';
  if (specs.some(s => s.includes('remote'))) return 'Remote';
  if (specs.some(s => s.includes('not.*require') || s.includes('^no') || s === 'no')) return 'No';
  if (specs.some(s => s.includes('authorized') || s.includes('^yes') || s === 'yes')) return 'Yes';
  if (specs.some(s => s.includes('none'))) return 'None';
  return '';
}
async function choosePromptDropdown(page, labelRe, optionRes) {
  const clicked = await page.evaluate((labelSpec) => {
    const re = new RegExp(labelSpec.source, labelSpec.flags);
    const controlSelector = 'button,[role="combobox"],input[role="combobox"],.select__control,.select-shell';
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects?.().length)); }
    function text(el){ return `${el.innerText || el.textContent || el.value || ''} ${el.getAttribute?.('aria-label') || ''} ${el.id || ''} ${el.name || ''}`.replace(/\s+/g,' ').trim(); }
    function badControl(el){ return /attach|remove file|upload|google drive|dropbox/i.test(text(el)); }
    function rect(el){ return el?.getBoundingClientRect?.() || {top:0,left:0,width:0,height:0}; }
    function controlsNear(container) {
      const roots = [];
      for (let p = container; p && roots.length < 7; p = p.parentElement) roots.push(p);
      if (container.nextElementSibling) roots.push(container.nextElementSibling);
      if (container.parentElement?.nextElementSibling) roots.push(container.parentElement.nextElementSibling);
      const seen = new Set();
      const labelRect = rect(container);
      const out = [];
      for (const root of roots) {
        const controls = Array.from(root.querySelectorAll?.(controlSelector) || []).filter(visible).filter(c => !badControl(c));
        for (const c of controls) {
          if (seen.has(c)) continue;
          seen.add(c);
          const r = rect(c);
          const belowPenalty = r.top + r.height >= labelRect.top ? 0 : 10000;
          const distance = Math.abs(r.top - labelRect.top) + Math.abs(r.left - labelRect.left) + belowPenalty;
          const comboInputBonus = c.matches?.('input[role="combobox"]') ? -1200 : 0;
          const selectBonus = /select__control|select-shell/.test(c.className || '') ? -500 : 0;
          const toggleBonus = /toggle flyout|select/i.test(text(c)) ? -300 : 0;
          const rootPenalty = Math.min((text(root).length || 0) / 20, 500);
          out.push({el:c, score:distance + rootPenalty + comboInputBonus + selectBonus + toggleBonus});
        }
      }
      return out.sort((a,b) => a.score - b.score).map(x => x.el);
    }
    const direct = Array.from(document.querySelectorAll(controlSelector)).filter(visible)
      .find(e => re.test(text(e)) && !/country phone code/i.test(text(e)) && !badControl(e));
    if (direct) {
      if (!/select|toggle flyout/i.test(text(direct)) && !/select__control|select-shell/.test(direct.className || '')) return false;
      direct.scrollIntoView?.({block:'center'});
      direct.focus?.();
      direct.click();
      return true;
    }
    const containers = Array.from(document.querySelectorAll('.field-wrapper,.custom-question,.question-wrapper,.application-question,.questionnaire-question,.question,.field,.form-field,.form-group,fieldset,label,div')).filter(visible)
      .filter(c => re.test((c.innerText || '').replace(/\s+/g,' ')) && (c.innerText || '').length < 1600)
      .sort((a,b) => (a.innerText || '').length - (b.innerText || '').length);
    for (const container of containers) {
      const control = controlsNear(container)[0];
      if (control) { control.scrollIntoView?.({block:'center'}); control.focus?.(); control.click(); return true; }
    }
    return false;
  }, {source: labelRe.source, flags: labelRe.flags}).catch(()=>false);
  if (!clicked) return false;
  await sleep(250);
  const searchText = dropdownSearchText(optionRes);
  if (searchText && page.keyboard?.type) {
    await page.keyboard.type(searchText).catch(()=>{});
  }
  await sleep(700);
  const picked = await page.evaluate((optionSpecs) => {
    const patterns = optionSpecs.map(s => new RegExp(s.source, s.flags));
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects?.().length)); }
    function text(el){ return (el.innerText || el.textContent || el.getAttribute?.('aria-label') || '').replace(/\s+/g,' ').trim(); }
    const candidates = Array.from(document.querySelectorAll('[role="option"], li, div')).filter(visible);
    const el = candidates.find(e => {
      const t = text(e);
      if (!t || /^select one$/i.test(t)) return false;
      return patterns.some(re => re.test(t));
    });
    if (el) { el.click(); return text(el); }
    return '';
  }, optionRes.map(re => ({source: re.source, flags: re.flags}))).catch(()=>'');
  await sleep(500);
  return Boolean(picked);
}
async function fillWorkdayPromptDropdowns(page) {
  await choosePromptDropdown(page, /^how did you hear about us/i, [/google/i, /job board/i, /internet/i, /web/i, /other/i]);
  await choosePromptDropdown(page, /^state\b/i, [/^california$/i, /^ca$/i]);
  await choosePromptDropdown(page, /^phone device type\b/i, [/mobile/i, /cell/i, /personal/i, /home/i]);
}
async function fillGreenhousePromptDropdowns(page, payload) {
  const phoneDigits = payload.profile?.phoneDigits || String(payload.profile?.phone || '').replace(/\D+/g,'').replace(/^1(?=\d{10}$)/,'');
  await choosePromptDropdown(page, /country\*/i, [/united states/i, /^us$/i, /^usa$/i]);
  await choosePromptDropdown(page, /state|province|current state of residency/i, [/california/i, /^ca$/i]);
  await choosePromptDropdown(page, /legally authorized|eligible to work|work authorization/i, [/^yes$/i, /authorized/i]);
  await choosePromptDropdown(page, /sponsor|sponsorship|visa/i, [/^no$/i, /not.*require/i]);
  await choosePromptDropdown(page, /previously employed|previous employee|ever been.*employee|currently.*employed|ever been employed|staff member|reviewer|consultant at|employee or contractor|recruiting process|spoken to anyone|interviewed/i, [/^no$/i]);
  await choosePromptDropdown(page, /willing.*office|required.*days.*week|relocate|which office/i, [/remote/i, /none/i, /not applicable/i, /california/i, /^no$/i]);
  await choosePromptDropdown(page, /agreement|terms.*agreement|i agree|recruiting terms/i, [/agree/i, /^yes$/i, /accept/i]);
  await choosePromptDropdown(page, /credentialed/i, [/^no$/i]);
  await choosePromptDropdown(page, /ccpa|privacy|acknowledge|disclosure/i, [/acknowledge/i, /agree/i, /^yes$/i, /accept/i]);
  await choosePromptDropdown(page, /event|conference|kubecon/i, [/^no$/i]);
  await choosePromptDropdown(page, /clearance/i, [/^no$/i, /none/i, /do not/i]);
  await choosePromptDropdown(page, /phone.*type|device type/i, [/mobile/i, /cell/i, /personal/i, /home/i]);
  await choosePromptDropdown(page, /source|how did you hear|how did you learn/i, [/google/i, /job board/i, /linkedin/i, /website/i, /other/i]);
  await page.evaluate((phone) => {
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects?.().length)); }
    function setValue(el, value){
      if (!el || !value || el.disabled || el.readOnly) return false;
      const proto = HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      return true;
    }
    const phoneInput = document.querySelector('input#phone,input[aria-label="Phone"],input[type="tel"]');
    if (phoneInput && !phoneInput.value) setValue(phoneInput, phone);
    const countryPhoneButton = Array.from(document.querySelectorAll('button')).find(b => visible(b) && /select country/i.test(b.getAttribute('aria-label') || b.innerText || ''));
    if (countryPhoneButton && !/united states|\+1/i.test(countryPhoneButton.getAttribute('title') || countryPhoneButton.innerText || '')) countryPhoneButton.click();
  }, phoneDigits).catch(()=>{});
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => {
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects?.().length)); }
    const usPhone = Array.from(document.querySelectorAll('[role="option"],li')).find(el => visible(el) && (el.getAttribute('data-country-code') === 'us' || /^united states\b/i.test((el.innerText || '').trim())));
    if (usPhone) usPhone.click();
  }).catch(()=>{});
  await page.evaluate(() => {
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects?.().length)); }
    const countryInputs = Array.from(document.querySelectorAll('input[role="combobox"],input.select__input')).filter(el => visible(el) && /country/i.test(`${el.id||''} ${el.getAttribute('aria-label')||''} ${el.closest?.('label,.field,.form-field,div')?.innerText || ''}`) && !/^iti-/.test(el.id || ''));
    for (const el of countryInputs) {
      if (/united states/i.test(el.value || '')) continue;
      el.focus?.(); el.click?.();
      const proto = HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(el, 'United States'); else el.value = 'United States';
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }).catch(()=>{});
  await new Promise(r => setTimeout(r, 600));
  await page.evaluate(() => {
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects?.().length)); }
    const opt = Array.from(document.querySelectorAll('[role="option"],li,div')).find(el => visible(el) && /^united states(?:\s|$)/i.test((el.innerText || '').trim()));
    if (opt) opt.click();
  }).catch(()=>{});
}
async function findBlockers(page) {
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText.toLowerCase() : '';
    const blockers = [];
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects?.().length)); }
    function captchaChallenge(el){
      const ident = `${el.tagName||''} ${el.name||''} ${el.id||''} ${el.className||''} ${el.src||''} ${el.getAttribute?.('src')||''} ${el.getAttribute?.('title')||''} ${el.getAttribute?.('aria-label')||''}`.toLowerCase();
      if (/g-recaptcha-response|grecaptcha-badge|grecaptcha-logo|grecaptcha-error|recaptcha-token|hcaptcha-response|size=invisible/.test(ident)) return false;
      if (!visible(el)) return false;
      if ((el.tagName || '').toLowerCase() === 'iframe') return (el.offsetWidth || 0) > 100 && (el.offsetHeight || 0) > 60;
      return /captcha|recaptcha|hcaptcha|challenge|verification/.test(ident);
    }
    const captchaText = /(?:solve|complete|verify|verification|challenge|security).*?(?:captcha|recaptcha|hcaptcha)|(?:captcha|recaptcha|hcaptcha).*?(?:required|challenge|verification)/.test(text);
    const captchaElements = Array.from(document.querySelectorAll('[class*=captcha], [id*=captcha], iframe[src*=captcha], iframe[src*=recaptcha], iframe[src*=hcaptcha]')).filter(captchaChallenge);
    if (captchaText || captchaElements.length) blockers.push('captcha');
    const videoRequired = /\b(one[-\s]?way|pre[-\s]?recorded|record(?:ed)?|submit|upload|complete|answer|response|interview|application)\b.{0,80}\b(video|webcam|camera|loom)\b|\b(video|webcam|camera|loom)\b.{0,80}\b(interview|response|answer|application|submission|screen(?:ing)?|assessment|record(?:ing)?|upload|required)\b/.test(text);
    if (videoRequired) blockers.push('video-required');
    const path = globalThis.location?.pathname || '';
    if (Array.from(document.querySelectorAll('input[type=password]')).some(visible) || /\/login\b/i.test(path)) blockers.push('login');
    const unknownRequired = [];
    const fields = Array.from(document.querySelectorAll('input, textarea, select')).filter(el => (el.required || el.getAttribute('aria-required') === 'true') && visible(el) && !el.disabled && el.getAttribute('aria-hidden') !== 'true' && el.tabIndex !== -1);
    for (const el of fields) {
      const type = (el.getAttribute('type') || el.tagName || '').toLowerCase();
      const labels = el.labels ? Array.from(el.labels).map(l => l.innerText || '').join(' ') : '';
      const near = el.closest?.('label,.field,.form-group,.question,.questionnaire-question,.application-question,.form-field,.control,div')?.innerText || '';
      const name = `${labels||''} ${near||''} ${el.name||''} ${el.id||''} ${el.placeholder||''} ${el.getAttribute('aria-label')||''}`.replace(/\s+/g,' ').trim().toLowerCase();
      if (['hidden','submit','button'].includes(type)) continue;
      if (type === 'file') { if (!el.value) blockers.push('missing-required-common:file-upload'); continue; }
      if (/first|last|name|email|phone|location|linkedin|github|website|url|cover|resume|country|state|city|postal|zip|address|salary|compensation|sponsor|visa|authorized|eligible|work.?auth/.test(name)) { if (!el.value) blockers.push(`missing-required-common:${name.trim() || type || 'field'}`); continue; }
      if (!el.value) unknownRequired.push(name.trim() || type || 'required-field');
    }
    if (unknownRequired.length) blockers.push(`unknown-required:${unknownRequired.slice(0,5).join(',')}`);
    return blockers;
  }).catch(err => [`blocker-check-failed:${err.message}`]);
}
async function clickInitialApplyLink(page, ats = '') {
  const adapter = getAtsAdapter(ats);
  return page.evaluate((adapterSpec) => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    const initialRes = (adapterSpec.initialApplyTexts || []).map(s => new RegExp(s.source, s.flags));
    const candidates = Array.from(document.querySelectorAll('a, button, input[type=button], input[type=submit], [role="button"]')).filter(visible);
    const el = candidates.find(e => {
      const text = (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
      const href = e.href || '';
      if (/submit|share|back|view|website|cookie|dismiss|allow|reject|linkedin|indeed|upload|import|resume|cv/i.test(text)) return false;
      return initialRes.some(re => re.test(text))
        || /^(apply|apply now|apply here|apply to position|apply for this job|apply for this role|apply manually|autofill with resume|start application|start your application|begin application|i'm interested|apply to this job|apply with resume|bewerben|jetzt bewerben)$/i.test(text)
        || /\/(apply|application)(\/|$|\?)/i.test(href);
    });
    if (el) { el.click(); return true; }
    return false;
  }, { initialApplyTexts: (adapter.initialApplyTexts || []).map(re => ({ source: re.source, flags: re.flags })) }).catch(()=>false);
}
async function clickProgressButton(page) {
  return page.evaluate(() => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    const candidates = Array.from(document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], a[href="#"], a[href="javascript:void(0)"]')).filter(visible);
    const bad = /cookie|linkedin|indeed|google|facebook|back|cancel|dismiss|reject|decline|share|company website|sign.?in|log.?in|create.?account/i;
    const el = candidates.find(e => {
      const text = (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
      return text && !bad.test(text) && /^(next|continue|proceed|review|review application|review & submit|review and submit|save and continue|save & continue|go to next step|next step|forward|apply manually|use my last application|start application|bewerben|jetzt bewerben)$/i.test(text);
    });
    if (el) { el.click(); return (el.innerText || el.value || el.getAttribute('aria-label') || '').trim(); }
    return '';
  }).catch(()=>'');
}
async function clickFinalSubmit(page, ats = '') {
  const adapter = getAtsAdapter(ats);
  const selectors = adapter.finalSubmitSelectors || ['button, input[type=submit], input[type=button], a[role=button], a[href="#"], a[href$="#"], #resumator-submit-resume'];
  return page.evaluate((adapterSpec) => {
    function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
    const selector = adapterSpec.selectors.join(', ');
    const textRes = (adapterSpec.texts || []).map(s => new RegExp(s.source, s.flags));
    const candidates = Array.from(document.querySelectorAll(selector)).filter(visible);
    const el = candidates.find(e => {
      const text = (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
      if (/cookie|linkedin|indeed|google|facebook|back|cancel|dismiss|reject|decline|share|sign.?in|log.?in|create.?account|save.?draft|save.?for.?later/i.test(text)) return false;
      if (adapterSpec.id === 'applytojob' && e.id === 'resumator-submit-resume' && /^submit application$/i.test(text)) return true;
      if (/^apply(?: now| for this job| for this role)?$/i.test(text) && adapterSpec.id !== 'rippling') return false;
      return textRes.some(re => re.test(text)) || /^(submit|submit application|submit your application|submit my application|send application|send my application|apply|apply now|apply for this job|apply for this role|complete application|complete submission|confirm|confirm and submit|confirm application|finish|finish application|done|send)$/i.test(text);
    });
    if (el) {
      el.click();
      if (adapterSpec.id === 'applytojob' && el.id === 'resumator-submit-resume') {
        const form = el.closest?.('form') || document.querySelector?.('form#form_submit_new_resume, form');
        if (form?.requestSubmit) form.requestSubmit();
        else if (form?.submit) form.submit();
      }
      return true;
    }
    return false;
  }, { id: adapter.id, selectors, texts: (adapter.finalSubmitTexts || []).map(re => ({ source: re.source, flags: re.flags })) }).catch(()=>false);
}
async function ensureNonEmptyPage(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const bodyText = String(await page.evaluate(() => (document.body?.innerText || '').trim()).catch(()=>'') || '');
    if (bodyText.length > 80 || typeof page.reload !== 'function') return;
    await page.reload({waitUntil:'domcontentloaded', timeout:30000}).catch(()=>{});
    await sleep(5000);
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
    const controls = Array.from(document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], a[href="#"], a[href="javascript:void(0)"]')).filter(visible).map(e => (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,12).join('|');
    const errors = Array.from(document.querySelectorAll('[role=alert], .error, [class*=error], [id*=error], [aria-invalid="true"]')).filter(visible).map(e => (e.innerText || e.validationMessage || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,8).join('|');
    return [errors && `errors:${errors}`, controls].filter(Boolean).join(' controls:') || `url:${location.href} body:${(document.body?.innerText||'').replace(/\s+/g,' ').trim().slice(0,240)}`;
  }).catch(err => `diagnostics-failed:${err.message}`);
}
async function verifySubmission(page, beforeUrl) {
  return page.evaluate((priorUrl) => {
    const text = document.body ? document.body.innerText.toLowerCase() : '';
    const successText = /application submitted|thank you for applying|thanks for applying|successfully submitted|we received your application|your application has been received|application complete|we have received your application|application has been submitted|application sent|your application was sent|we'll be in touch|we will be in touch|we'll review your application|we will review your application|thanks for your interest|thank you for your application|you've successfully applied|you have successfully applied|already applied to this job|you've already applied|you have already applied/.test(text);
    const spamRejected = /flagged as possible spam|couldn't submit your application|we couldn't submit your application/.test(text);
    const urlChangedToSuccess = location.href !== priorUrl && /(thank|success|submitted|confirmation|complete|applied)/i.test(location.href);
    const successElement = document.querySelector('[class*="success"], [class*="complete"], [class*="confirmation"], [data-testid*="success"]');
    const hasSuccessElement = successElement && !!(successElement.offsetWidth || successElement.offsetHeight);
    return spamRejected ? 'spam-blocked' : ((successText || urlChangedToSuccess || hasSuccessElement) ? 'success' : 'pending');
  }, beforeUrl).catch(() => 'pending');
}
async function waitForVerifiedSubmission(page, beforeUrl, opts = {}) {
  const attempts = Number(opts.verifyAttempts || process.env.HERMES_ATS_VERIFY_ATTEMPTS || 6);
  const rawDelay = Number(opts.verifyDelayMs || process.env.HERMES_ATS_VERIFY_DELAY_MS || 10000);
  const rawInitial = Number(opts.verifyInitialDelayMs || process.env.HERMES_ATS_VERIFY_INITIAL_DELAY_MS || 10000);
  const delayMs = opts.verifyDelayMs !== undefined ? rawDelay : Math.max(10000, rawDelay);
  const initialDelayMs = opts.verifyInitialDelayMs !== undefined ? rawInitial : Math.max(10000, rawInitial);
  await sleep(initialDelayMs);
  for (let i = 0; i < attempts; i++) {
    const status = await verifySubmission(page, beforeUrl);
    if (status === 'success' || status === true) return 'success';
    if (status === 'spam-blocked') return 'spam-blocked';
    await sleep(delayMs);
  }
  return 'pending';
}
async function waitForSubmitToSettle(page, opts = {}) {
  const rawSettle = Number(opts.submitSettleMs || process.env.HERMES_ATS_SUBMIT_SETTLE_MS || 120000);
  const timeoutMs = opts.submitSettleMs !== undefined ? rawSettle : Math.max(30000, rawSettle);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      const text = document.body ? document.body.innerText.toLowerCase() : '';
      const busy = Array.from(document.querySelectorAll('button, [role=button], input[type=submit], input[type=button]')).some(el => {
        const label = `${el.innerText || el.value || el.getAttribute('aria-label') || ''}`.toLowerCase();
        return /submitting|please wait|processing|saving|loading/.test(label) || el.getAttribute('aria-busy') === 'true';
      });
      const success = /thank you|application submitted|application received|successfully submitted|we received your application|your application has been received|already applied/.test(text);
      const spam = /flagged as possible spam|couldn't submit your application|we couldn't submit your application/.test(text);
      const errors = /required|is invalid|please complete|application contains errors|there was an error/.test(text);
      return {busy, success, spam, errors};
    }).catch(() => ({busy:false, success:false, spam:false, errors:false}));
    if (state.success) return 'success';
    if (state.spam) return 'spam-blocked';
    if (!state.busy && state.errors) return 'errors';
    const minSettleWait = opts.submitSettleMs !== undefined ? Math.min(rawSettle, 30000) : 30000;
    if (!state.busy && Date.now() - start > minSettleWait) return 'settled';
    await sleep(Math.min(5000, timeoutMs));
  }
  return 'timeout';
}
async function maybeHoldVisibleBrowserAfterSubmit(page, clickedAny, result) {
  const isVisible = process.env.HERMES_PUPPETEER_HEADLESS === '0' || process.env.HERMES_PUPPETEER_HEADLESS === 'false';
  const holdMs = Number(process.env.HERMES_PUPPETEER_HOLD_AFTER_SUBMIT_MS || (isVisible && clickedAny && result?.status === 'needs-human-review' ? 120000 : 0));
  if (holdMs > 0) {
    console.error(`[ats] submitted/clicked final submit; holding visible browser ${holdMs}ms for confirmation/review`);
    await page.waitForTimeout?.(holdMs);
  }
}
function manualHandoffEnabled(opts={}) {
  return opts.manualHandoff === true || process.env.HERMES_MANUAL_HANDOFF === '1';
}
function safeJobId(id='job') {
  return String(id || 'job').replace(/[^a-zA-Z0-9_.-]+/g,'_').slice(0,100) || 'job';
}
async function collectManualHandoffSnapshot(page) {
  const url = typeof page.url === 'function' ? page.url() : '';
  const dom = await page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g,' ').trim().slice(0,6000);
    const visible = el => {
      const r = el.getBoundingClientRect?.();
      const s = getComputedStyle(el);
      return !!r && r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const labelFor = el => {
      const id = el.id;
      const labels = [];
      if (el.labels) for (const l of Array.from(el.labels)) labels.push(l.innerText || l.textContent || '');
      if (id && window.CSS?.escape) {
        const direct = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (direct) labels.push(direct.innerText || direct.textContent || '');
      }
      const parent = el.closest?.('label,[role=group],fieldset,.field,.form-group,.application-question');
      if (parent) labels.push((parent.innerText || parent.textContent || '').slice(0,300));
      return labels.map(s => String(s || '').replace(/\s+/g,' ').trim()).filter(Boolean)[0] || '';
    };
    const controls = Array.from(document.querySelectorAll('input, textarea, select, button, a, [role="button"], [role="radio"], [role="checkbox"], [role="option"]'))
      .filter(visible)
      .slice(0,250)
      .map((el, index) => ({
        index,
        tag: el.tagName?.toLowerCase(),
        type: el.getAttribute('type') || el.getAttribute('role') || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        label: labelFor(el),
        text: String(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').replace(/\s+/g,' ').trim().slice(0,300),
        required: !!el.required || el.getAttribute('aria-required') === 'true',
        checked: !!el.checked || el.getAttribute('aria-checked') === 'true',
        value: /password|token|secret/i.test(el.getAttribute('name') || el.id || '') ? '[REDACTED]' : String(el.value || '').slice(0,300),
        href: el.href || ''
      }));
    const events = Array.isArray(window.__hermesManualEvents) ? window.__hermesManualEvents.slice(-300) : [];
    return { title: document.title || '', text, controls, events };
  }).catch(err => ({error: err.message, text:'', controls:[], events:[]}));
  return {url, capturedAt:new Date().toISOString(), ...dom};
}
async function installManualEventRecorder(page) {
  await page.evaluate(() => {
    if (window.__hermesManualRecorderInstalled) return;
    window.__hermesManualRecorderInstalled = true;
    window.__hermesManualEvents = window.__hermesManualEvents || [];
    const visibleLabel = el => {
      if (!el) return '';
      const parts = [el.innerText, el.value, el.getAttribute?.('aria-label'), el.getAttribute?.('placeholder'), el.name, el.id].filter(Boolean);
      const parent = el.closest?.('label,[role=group],fieldset,.field,.form-group,.application-question');
      if (parent) parts.push(parent.innerText || parent.textContent || '');
      return String(parts.find(Boolean) || '').replace(/\s+/g,' ').trim().slice(0,300);
    };
    const record = (eventName, target) => {
      try {
        const el = target?.closest?.('input, textarea, select, button, a, [role="button"], [role="radio"], [role="checkbox"], [role="option"]') || target;
        if (!el) return;
        window.__hermesManualEvents.push({
          ts: new Date().toISOString(), event: eventName,
          tag: el.tagName?.toLowerCase(), type: el.getAttribute?.('type') || el.getAttribute?.('role') || '',
          name: el.getAttribute?.('name') || '', id: el.id || '', label: visibleLabel(el),
          checked: !!el.checked || el.getAttribute?.('aria-checked') === 'true',
          value: /password|token|secret/i.test(el.getAttribute?.('name') || el.id || '') ? '[REDACTED]' : String(el.value || '').slice(0,300),
          href: el.href || '', url: location.href
        });
        if (window.__hermesManualEvents.length > 1000) window.__hermesManualEvents.splice(0, window.__hermesManualEvents.length - 1000);
      } catch {}
    };
    for (const ev of ['click','input','change','submit']) document.addEventListener(ev, e => record(ev, e.target), true);
  }).catch(()=>{});
}
async function saveManualHandoffSnapshot({page, job={}, payload={}, stage, reason, opts={}, suffix}) {
  const root = opts.manualHandoffDir || process.env.HERMES_MANUAL_HANDOFF_DIR || path.join(process.env.TMPDIR || '/tmp', 'hermes-ats-handoff');
  fs.mkdirSync(root, {recursive:true});
  const base = `${new Date().toISOString().replace(/[:.]/g,'-')}-${safeJobId(job.id)}-${suffix || stage}`;
  const snapshot = await collectManualHandoffSnapshot(page);
  const out = {stage, reason, job:{id:job.id,title:job.title,company:job.company}, ats:payload.ats, applyUrl:payload.url, ...snapshot};
  const jsonPath = path.join(root, `${base}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  if (typeof page.screenshot === 'function') await page.screenshot({path:path.join(root, `${base}.png`), fullPage:true}).catch(()=>{});
  return jsonPath;
}
async function manualHandoff({page, job={}, payload={}, stage, reason, opts={}}) {
  if (!manualHandoffEnabled(opts)) return null;
  await installManualEventRecorder(page);
  const beforePath = await saveManualHandoffSnapshot({page, job, payload, stage, reason, opts, suffix:'before'});
  const doneFile = opts.manualHandoffDoneFile || process.env.HERMES_MANUAL_HANDOFF_DONE_FILE || '';
  const timeoutMs = Number(opts.manualHandoffTimeoutMs || process.env.HERMES_MANUAL_HANDOFF_TIMEOUT_MS || 900000);
  const pollMs = Number(opts.manualHandoffPollMs || process.env.HERMES_MANUAL_HANDOFF_POLL_MS || 5000);
  console.error(`\nMANUAL_HANDOFF\tjob=${job.id||''}\tats=${payload.ats||''}\tstage=${stage}\treason=${reason}`);
  console.error(`MANUAL_HANDOFF_URL\t${typeof page.url === 'function' ? page.url() : payload.url}`);
  console.error(`MANUAL_HANDOFF_SNAPSHOT_BEFORE\t${beforePath}`);
  console.error(`MANUAL_HANDOFF_ACTION\tFix the visible browser. I am recording DOM events and will resume automatically when success/blockers clear${doneFile ? ` or when ${doneFile} exists` : ''}.`);
  const started = Date.now();
  let lastBlockers = [];
  while (Date.now() - started < timeoutMs) {
    await sleep(pollMs);
    await installManualEventRecorder(page);
    if (doneFile && fs.existsSync(doneFile)) {
      const afterPath = await saveManualHandoffSnapshot({page, job, payload, stage, reason:'done-file', opts, suffix:'after'});
      console.error(`MANUAL_HANDOFF_SNAPSHOT_AFTER\t${afterPath}`);
      return {action:'proceed', reason:'manual-done-file'};
    }
    const verified = await waitForVerifiedSubmission(page, payload.url, {...opts, verifyAttempts:1, verifyDelayMs:10, verifyInitialDelayMs:10});
    if (verified === 'success' || verified === true) {
      const afterPath = await saveManualHandoffSnapshot({page, job, payload, stage, reason:'manual-submission-verified', opts, suffix:'after'});
      console.error(`MANUAL_HANDOFF_SNAPSHOT_AFTER\t${afterPath}`);
      return {status:'submitted', reason:'manual-submission-verified'};
    }
    if (verified === 'spam-blocked') {
      const afterPath = await saveManualHandoffSnapshot({page, job, payload, stage, reason:'spam-blocked', opts, suffix:'after'});
      console.error(`MANUAL_HANDOFF_SNAPSHOT_AFTER\t${afterPath}`);
      return {status:'needs-human-review', reason:'spam-blocked'};
    }
    lastBlockers = await findBlockers(page).catch(err => [`blocker-check-failed:${err.message}`]);
    if (!lastBlockers.length) {
      const afterPath = await saveManualHandoffSnapshot({page, job, payload, stage, reason:'blockers-cleared', opts, suffix:'after'});
      console.error(`MANUAL_HANDOFF_SNAPSHOT_AFTER\t${afterPath}`);
      return {action:'proceed', reason:'manual-blockers-cleared'};
    }
  }
  const afterPath = await saveManualHandoffSnapshot({page, job, payload, stage, reason:'timeout', opts, suffix:'after'});
  console.error(`MANUAL_HANDOFF_SNAPSHOT_AFTER\t${afterPath}`);
  return {status:'needs-human-review', reason:`manual-handoff-timeout:${lastBlockers.join(';') || reason}`};
}
async function detectCaptchaInfo(page) {
  return page.evaluate(() => {
    // hCaptcha iframe
    const hcIframe = document.querySelector('iframe[src*="hcaptcha"]');
    if (hcIframe) {
      const m = (hcIframe.src || '').match(/[?&]sitekey=([^&]+)/);
      if (m) return { type: 'hcaptcha', sitekey: m[1] };
    }
    const hcDiv = document.querySelector('.h-captcha[data-sitekey], [data-hcaptcha-widget-id]');
    if (hcDiv) return { type: 'hcaptcha', sitekey: hcDiv.getAttribute('data-sitekey') || hcDiv.getAttribute('data-hcaptcha-widget-id') || '' };
    // reCAPTCHA v2/v3 iframe
    const rcIframe = document.querySelector('iframe[src*="recaptcha"][src*="/anchor"]');
    if (rcIframe) {
      const m = (rcIframe.src || '').match(/[?&]k=([^&]+)/);
      if (m) return { type: 'recaptcha', sitekey: m[1] };
    }
    // reCAPTCHA bframe iframe (Jobvite, ApplyToJob)
    const rcBframe = document.querySelector('iframe[src*="recaptcha"][src*="/bframe"]');
    if (rcBframe) {
      const m = (rcBframe.src || '').match(/[?&]k=([^&]+)/);
      if (m) return { type: 'recaptcha', sitekey: m[1] };
    }
    const rcDiv = document.querySelector('.g-recaptcha[data-sitekey]');
    if (rcDiv) return { type: 'recaptcha', sitekey: rcDiv.getAttribute('data-sitekey') || '' };
    // sitekey in page HTML/scripts — broadened patterns
    const html = document.documentElement.innerHTML;
    const rcPatterns = [
      /"sitekey"\s*:\s*"([^"]{20,})"/,
      /sitekey['":\s]+['"]([A-Za-z0-9_\-]{20,})['"]/,
      /data-sitekey=['"]([^'"]{20,})['"]/,
      /grecaptcha\.render\([^)]*['"]([A-Za-z0-9_\-]{20,})['"]/,
      /recaptcha[^]*?k=([A-Za-z0-9_\-]{20,})/,
    ];
    for (const p of rcPatterns) {
      const m = html.match(p);
      if (m && m[1]) {
        const ctx = html.slice(Math.max(0, html.indexOf(m[1]) - 300), html.indexOf(m[1]));
        const type = /hcaptcha/i.test(ctx) ? 'hcaptcha' : 'recaptcha';
        return { type, sitekey: m[1] };
      }
    }
    return null;
  }).catch(() => null);
}

async function solveWithCapsolver(type, sitekey, pageUrl) {
  const apiKey = process.env.CAPSOLVER_API_KEY;
  if (!apiKey) throw new Error('CAPSOLVER_API_KEY not set');
  const taskType = type === 'hcaptcha' ? 'HCaptchaTaskProxyless' : 'ReCaptchaV2TaskProxyless';
  const createRes = await fetch('https://api.capsolver.com/createTask', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ clientKey: apiKey, task: { type: taskType, websiteURL: pageUrl, websiteKey: sitekey } })
  });
  const created = await createRes.json();
  if (created.errorId) throw new Error(`CapSolver: ${created.errorDescription}`);
  const taskId = created.taskId;
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch('https://api.capsolver.com/getTaskResult', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ clientKey: apiKey, taskId })
    });
    const poll = await pollRes.json();
    if (poll.status === 'ready') return poll.solution?.gRecaptchaResponse || poll.solution?.token;
    if (poll.errorId) throw new Error(`CapSolver poll: ${poll.errorDescription}`);
  }
  throw new Error('CapSolver timeout');
}

async function solveWith2captcha(type, sitekey, pageUrl) {
  const apiKey = process.env.TWOCAPTCHA_API_KEY;
  if (!apiKey) throw new Error('TWOCAPTCHA_API_KEY not set');
  const method = type === 'hcaptcha' ? 'hcaptcha' : 'userrecaptcha';
  const keyParam = type === 'hcaptcha' ? 'sitekey' : 'googlekey';
  const submitRes = await fetch(`https://2captcha.com/in.php?key=${apiKey}&method=${method}&${keyParam}=${encodeURIComponent(sitekey)}&pageurl=${encodeURIComponent(pageUrl)}&json=1`);
  const submitted = await submitRes.json();
  if (submitted.status !== 1) throw new Error(`2captcha submit: ${submitted.request}`);
  const captchaId = submitted.request;
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`);
    const poll = await pollRes.json();
    if (poll.status === 1) return poll.request;
    if (poll.request !== 'CAPCHA_NOT_READY') throw new Error(`2captcha: ${poll.request}`);
  }
  throw new Error('2captcha timeout');
}

async function injectCaptchaToken(page, type, token) {
  await page.evaluate((t, tok) => {
    if (t === 'hcaptcha') {
      for (const sel of ['[name="h-captcha-response"]','textarea[id*=hcaptcha]','textarea[name*=hcaptcha]']) {
        const el = document.querySelector(sel);
        if (el) { el.value = tok; el.dispatchEvent(new Event('change',{bubbles:true})); }
      }
      try {
        const widget = document.querySelector('.h-captcha');
        const cb = widget?.getAttribute('data-callback');
        if (cb && window[cb]) window[cb](tok);
      } catch {}
    } else {
      const resp = document.querySelector('#g-recaptcha-response');
      if (resp) { resp.style.display = 'block'; resp.value = tok; resp.dispatchEvent(new Event('change',{bubbles:true})); }
      try {
        const clients = window.___grecaptcha_cfg?.clients || {};
        for (const k of Object.keys(clients)) {
          const c = clients[k];
          for (const ck of Object.keys(c)) {
            if (c[ck]?.callback) { c[ck].callback(tok); return; }
          }
        }
      } catch {}
      try {
        const el = document.querySelector('.g-recaptcha[data-callback]');
        if (el) { const fn = el.getAttribute('data-callback'); if (fn && window[fn]) window[fn](tok); }
      } catch {}
    }
  }, type, token);
}

async function trySolveCaptcha(page) {
  const pageUrl = typeof page.url === 'function' ? page.url() : '';
  const info = await detectCaptchaInfo(page);
  if (!info || !info.sitekey) { console.error('[captcha] could not detect sitekey'); return false; }
  console.error(`[captcha] detected ${info.type} sitekey=${info.sitekey.slice(0,12)}… solving via CapSolver`);
  let token;
  try {
    token = await solveWithCapsolver(info.type, info.sitekey, pageUrl);
  } catch (capErr) {
    console.error(`[captcha] CapSolver failed (${capErr.message}), trying 2captcha`);
    try {
      token = await solveWith2captcha(info.type, info.sitekey, pageUrl);
    } catch (twoErr) {
      console.error(`[captcha] 2captcha also failed: ${twoErr.message}`);
      return false;
    }
  }
  if (!token) return false;
  console.error(`[captcha] solved, injecting token`);
  await injectCaptchaToken(page, info.type, token);
  return true;
}

async function browserApply({job,payload,opts}) {
  const puppeteer = await optionalPuppeteer(opts);
  if (!puppeteer) return {status:'needs-human-review', reason:'puppeteer-not-installed'};
  if (!fs.existsSync(payload.resumePath)) return {status:'needs-human-review', reason:`resume-missing:${payload.resumePath}`};
  const launchArgs = ['--disable-dev-shm-usage'];
  const proxyUrl = process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  if (opts.noSandbox || process.env.HERMES_PUPPETEER_NO_SANDBOX === '1') launchArgs.push('--no-sandbox','--disable-setuid-sandbox');
  if (proxyUrl) {
    try {
      const parsedProxy = new URL(proxyUrl);
      launchArgs.push(`--proxy-server=${parsedProxy.protocol}//${parsedProxy.host}`);
    } catch {}
  }
  if (process.env.HERMES_PUPPETEER_EXTRA_ARGS) launchArgs.push(...process.env.HERMES_PUPPETEER_EXTRA_ARGS.split(/\s+/).filter(Boolean));
  if (opts.headless === false) launchArgs.push('--start-maximized');
  const browser = await puppeteer.launch({headless: opts.headless !== false, defaultViewport:null, args:launchArgs, timeout: Number(process.env.HERMES_PUPPETEER_LAUNCH_TIMEOUT_MS || opts.launchTimeoutMs || 60000)});
  try {
    const page = await browser.newPage();
    if (proxyUrl) {
      try {
        const parsedProxy = new URL(proxyUrl);
        if (parsedProxy.username || parsedProxy.password) {
          await page.authenticate({ username: decodeURIComponent(parsedProxy.username), password: decodeURIComponent(parsedProxy.password) });
        }
      } catch {}
    }
    await page.setViewport?.({width:1366,height:900});
    await page.setUserAgent?.(process.env.HERMES_ATS_USER_AGENT || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(payload.url, {waitUntil:'domcontentloaded', timeout: opts.timeoutMs || 30000});
    await sleep(3000);
    await ensureNonEmptyPage(page);
    const verifiedEmployer = await extractEmployerFromJobPage(page);
    const refreshedEmployer = refreshPayloadCoverLetterFromVerifiedEmployer(payload, verifiedEmployer);
    if (refreshedEmployer) console.error(`[ats] employer verified from job page: ${refreshedEmployer}`);
    else console.error('[ats] employer not verified from job page; using generic hiring-team cover letter');
    await debugStep(page, 'after-goto');
    await dismissCookieBanners(page);
    if (await clickInitialApplyLink(page, payload.ats)) await page.waitForNavigation({waitUntil:'domcontentloaded',timeout:opts.timeoutMs||30000}).catch(()=>sleep(3000));
    if (await clickInitialApplyLink(page, payload.ats)) await page.waitForNavigation({waitUntil:'domcontentloaded',timeout:opts.timeoutMs||30000}).catch(()=>sleep(3000));
    const formEmployer = await extractEmployerFromJobPage(page);
    const formRefreshedEmployer = refreshPayloadCoverLetterFromVerifiedEmployer(payload, formEmployer || verifiedEmployer);
    if (formRefreshedEmployer && formRefreshedEmployer !== refreshedEmployer) console.error(`[ats] employer verified from application page: ${formRefreshedEmployer}`);
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
    await fillAdapterSpecificFields(page, payload);
    if (payload.ats === 'workday') await fillWorkdayPromptDropdowns(page);
    if (payload.ats === 'greenhouse') await fillGreenhousePromptDropdowns(page, payload);
    await fillRemainingRequiredFields(page, payload);
    await uploadDocuments(page, {resumePath: payload.resumePath, coverPdfPath: payload.coverPdfPath, photoPath: payload.photoPath});
    await sleep(5000);
    await debugStep(page, 'after-upload');
    await fillProfileFieldsByLabel(page, payload);
    await fillAdapterSpecificFields(page, payload);
    if (payload.ats === 'workday') await fillWorkdayPromptDropdowns(page);
    if (payload.ats === 'greenhouse') await fillGreenhousePromptDropdowns(page, payload);
    if (payload.ats === 'breezy') await fillFirst(page, ['textarea[name="cSummary"]'], payload.coverLetter || 'Please see my attached resume and cover letter.');
    await fillFirst(page, ['textarea[name*=cover i]','textarea[id*=cover i]','textarea[placeholder*=cover i]','textarea'], payload.coverLetter);
    let blockers = await findBlockers(page);
    if (blockers.includes('captcha') && process.env.HERMES_ENABLE_CAPTCHA_SOLVING === '1') {
      const solved = await trySolveCaptcha(page).catch(() => false);
      if (solved) {
        await sleep(5000);
        blockers = await findBlockers(page);
      }
    }
    if (blockers.includes('captcha')) {
      const handoff = await manualHandoff({page, job, payload, stage:'pre-submit-blockers', reason:'captcha-unsolved', opts});
      if (handoff?.status) return handoff;
      if (handoff?.action === 'proceed') blockers = await findBlockers(page);
      if (blockers.includes('captcha')) return {status:'needs-human-review', reason:'captcha-unsolved'};
    }
    if (blockers.length) {
      const reason = blockers.join(';');
      const handoff = await manualHandoff({page, job, payload, stage:'pre-submit-blockers', reason, opts});
      if (handoff?.status) return handoff;
      if (handoff?.action === 'proceed') blockers = await findBlockers(page);
      if (blockers.length) return {status:'needs-human-review', reason:blockers.join(';')};
    }
    if (opts.submit !== true) return {status:'prepared', reason:'submit-not-requested'};
    let beforeUrl = typeof page.url === 'function' ? page.url() : payload.url;
    let clickedAny = false;
    const maxSubmitSteps = payload.ats === 'workday' ? 12 : 8;
    let consecutiveSubmitFails = 0;
    for (let i = 0; i < maxSubmitSteps; i++) {
      const clicked = await clickFinalSubmit(page, payload.ats);
      if (clicked) {
        clickedAny = true;
        consecutiveSubmitFails = 0;
        // Use SPA-aware waiting: try navigation, fall back to sleep for React-based ATS
        await page.waitForNavigation?.({waitUntil:'networkidle2',timeout:opts.timeoutMs||30000}).catch(()=>sleep(8000));
        const settleState = await waitForSubmitToSettle(page, opts);
        if (settleState === 'spam-blocked') return {status:'needs-human-review', reason:'spam-blocked'};
        const verifiedState = await waitForVerifiedSubmission(page, beforeUrl, opts);
        if (verifiedState === 'success' || verifiedState === true) return {status:'submitted', reason:'submission-verified'};
        if (verifiedState === 'spam-blocked') return {status:'needs-human-review', reason:'spam-blocked'};
      } else {
        const progressed = await clickProgressButton(page);
        if (!progressed) {
          consecutiveSubmitFails++;
          if (consecutiveSubmitFails >= 2) break;
          await sleep(1500);
          continue;
        }
        consecutiveSubmitFails = 0;
        // SPA-aware wait after clicking progress/next - critical for React-based ATS (Greenhouse, Lever, Ashby)
        await page.waitForNavigation?.({waitUntil:'domcontentloaded',timeout:opts.timeoutMs||15000}).catch(()=>sleep(3000));
      }
      await fillProfileFieldsByLabel(page, payload);
      await selectOrFillWorkAuth(page, p.workAuth, p.requiresSponsorship);
      await fillKnownCustomQuestions(page, payload);
      await fillPlatformSpecificFields(page, payload);
      await fillAdapterSpecificFields(page, payload);
      if (payload.ats === 'workday') await fillWorkdayPromptDropdowns(page);
      if (payload.ats === 'greenhouse') await fillGreenhousePromptDropdowns(page, payload);
      await fillRemainingRequiredFields(page, payload);
      await uploadDocuments(page, {resumePath: payload.resumePath, coverPdfPath: payload.coverPdfPath, photoPath: payload.photoPath});
      await sleep(3000);
      await debugStep(page, `after-submit-loop-refill-${i}`);
      await fillProfileFieldsByLabel(page, payload);
      blockers = await findBlockers(page);
      if (blockers.some(b => /blocker-check-failed:.*detached Frame/i.test(b))) {
        await sleep(5000);
        const verifiedState = await waitForVerifiedSubmission(page, beforeUrl, opts);
        if (verifiedState === 'success' || verifiedState === true) return {status:'submitted', reason:'submission-verified'};
        if (verifiedState === 'spam-blocked') return {status:'needs-human-review', reason:'spam-blocked'};
        continue;
      }
      if (blockers.includes('captcha')) {
        const handoff = await manualHandoff({page, job, payload, stage:'submit-loop-blockers', reason:'captcha-unsolved', opts});
        if (handoff?.status) return handoff;
        if (handoff?.action === 'proceed') blockers = await findBlockers(page);
        if (blockers.includes('captcha')) return {status:'needs-human-review', reason:'captcha-unsolved'};
      }
      if (blockers.length) {
        const reason = blockers.join(';');
        const handoff = await manualHandoff({page, job, payload, stage:'submit-loop-blockers', reason, opts});
        if (handoff?.status) return handoff;
        if (handoff?.action === 'proceed') blockers = await findBlockers(page);
        if (blockers.length) return {status:'needs-human-review', reason:blockers.join(';')};
      }
      const currentUrl = typeof page.url === 'function' ? page.url() : beforeUrl;
      if (currentUrl !== beforeUrl) beforeUrl = currentUrl;
    }
    if (!clickedAny) {
      const reason = `submit-button-not-found:${await submitDiagnostics(page)}`;
      const handoff = await manualHandoff({page, job, payload, stage:'submit-button-not-found', reason, opts});
      if (handoff?.status) return handoff;
      if (handoff?.action === 'proceed') {
        const clicked = await clickFinalSubmit(page, payload.ats);
        if (clicked) {
          clickedAny = true;
          await page.waitForNavigation?.({waitUntil:'networkidle2',timeout:opts.timeoutMs||30000}).catch(()=>sleep(8000));
          const verifiedAfterManual = await waitForVerifiedSubmission(page, beforeUrl, opts);
          if (verifiedAfterManual === 'success' || verifiedAfterManual === true) return {status:'submitted', reason:'manual-handoff-then-submission-verified'};
          if (verifiedAfterManual === 'spam-blocked') return {status:'needs-human-review', reason:'spam-blocked'};
        }
      }
      if (!clickedAny) return {status:'needs-human-review', reason};
    }
    const settleState = await waitForSubmitToSettle(page, opts);
    if (settleState === 'spam-blocked') return {status:'needs-human-review', reason:'spam-blocked'};
    const verifiedState = await waitForVerifiedSubmission(page, beforeUrl, opts);
    if (verifiedState === 'success' || verifiedState === true) return {status:'submitted', reason:'submission-verified'};
    if (verifiedState === 'spam-blocked') return {status:'needs-human-review', reason:'spam-blocked'};
    const unverifiedResult = {status:'needs-human-review', reason:`submission-unverified:${await submitDiagnostics(page)}`};
    const handoff = await manualHandoff({page, job, payload, stage:'submission-unverified', reason:unverifiedResult.reason, opts});
    if (handoff?.status) return handoff;
    await maybeHoldVisibleBrowserAfterSubmit(page, clickedAny, unverifiedResult);
    return unverifiedResult;
  } finally {
    if (process.env.HERMES_PUPPETEER_KEEP_OPEN_ON_REVIEW === '1' || process.env.HERMES_PUPPETEER_KEEP_OPEN === '1') {
      console.error('[ats] leaving browser open for manual confirmation/review');
    } else {
      await browser.close().catch(()=>{});
    }
  }
}

async function autoApplyExternal({job = {}, dryRun = true, submit = false, storeDir, ...opts} = {}) {
  job = await resolveAggregatorApplyUrl(job, opts);
  const payload = buildApplicationPayload(job, opts);
  const base = { url: payload.url, ats: payload.ats, resumePath: payload.resumePath, coverPdfPath: payload.coverPdfPath, photoPath: payload.photoPath };
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
  const result = await browserApply({job,payload,opts:{...opts,submit,storeDir}});
  return {...base, ...result};
}

module.exports = { RESUME4_PATH, COVER4_PATH, PHOTO_PATH, ATS_ADAPTERS, getAtsAdapter, detectAts, buildApplicationPayload, canAutoSubmit, classifyScreeningAnswer, extractAtsApplyUrlFromHtml, resolveAggregatorApplyUrl, autoApplyExternal, browserApply, findBlockers, fillAdapterSpecificFields, choosePromptDropdown, clickInitialApplyLink, clickProgressButton, clickFinalSubmit, companyFromJobPageData, refreshPayloadCoverLetterFromVerifiedEmployer, extractEmployerFromJobPage, collectManualHandoffSnapshot, installManualEventRecorder, manualHandoffEnabled };
