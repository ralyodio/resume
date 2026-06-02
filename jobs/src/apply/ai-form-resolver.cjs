'use strict';
/**
 * AI form resolver. When ATS form filling produces unknown-required or
 * missing-required-common blockers, extract the visible required-but-empty
 * controls, send to the configured LLM provider with the user's resume + job context,
 * apply the returned answers, and let the submit loop retry.
 *
 * Hard-skip categories (never answer, leave for manual review):
 * - security clearances, PMP, EHR/Epic/Cerner/MEDITECH, HL7/FHIR
 * - recorded video / one-way interview
 * - credentialed legal/licensure claims not in resume
 * - employment history facts not present in the resume
 *
 * Allowed: preferences, source ("how did you hear"), generic consent,
 * location/availability, salary, authorization Y/US-Citizen, EEO defaults.
 */

const fs = require('fs');
const path = require('path');
const { request } = require('undici');
const { applicantProfile } = require('../config/applicant.cjs');

const RESUME_MD = process.env.RESUME_MD || '/home/ettinger/Desktop/resume/anthony.ettinger.resume4.md';
const MODEL = process.env.HERMES_AI_RESOLVER_MODEL || (process.env.HERMES_AI_RESOLVER_PROVIDER === 'openai' ? 'gpt-5.5' : 'claude-sonnet-4-5-20250929');
const RESOLUTIONS_LOG = process.env.HERMES_AI_RESOLUTIONS_LOG || '/tmp/hermes-remote-jobs/ai-resolutions.jsonl';

let _resumeCache = null;
function loadResume() {
  if (_resumeCache != null) return _resumeCache;
  try { _resumeCache = fs.readFileSync(RESUME_MD, 'utf8'); }
  catch { _resumeCache = ''; }
  return _resumeCache;
}

function appendLog(row) {
  try {
    fs.mkdirSync(path.dirname(RESOLUTIONS_LOG), { recursive: true });
    fs.appendFileSync(RESOLUTIONS_LOG, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n');
  } catch {}
}

async function extractRequiredFields(page) {
  return page.evaluate(() => {
    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const s = window.getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      return true;
    }
    function labelFor(el) {
      if (!el) return '';
      const id = el.id;
      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab && lab.innerText) return lab.innerText.trim().slice(0, 300);
      }
      const wrap = el.closest('label');
      if (wrap && wrap.innerText) return wrap.innerText.trim().slice(0, 300);
      const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (aria) {
        if (el.getAttribute('aria-labelledby')) {
          const ref = document.getElementById(aria);
          if (ref && ref.innerText) return ref.innerText.trim().slice(0, 300);
        } else return aria.trim().slice(0, 300);
      }
      const parent = el.parentElement;
      if (parent) {
        const txt = (parent.innerText || '').trim().slice(0, 300);
        if (txt) return txt;
      }
      return el.name || el.id || el.placeholder || '';
    }
    function cssPath(el) {
      if (!el) return '';
      if (el.id) return `#${CSS.escape(el.id)}`;
      // Prefer simple name-only selector when unique
      if (el.name) {
        const tag = el.tagName.toLowerCase();
        const sel = `${tag}[name="${el.name}"]`;
        try {
          if (document.querySelectorAll(sel).length === 1) return sel;
        } catch {}
      }
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && parts.length < 6) {
        let part = cur.tagName.toLowerCase();
        if (cur.name) part += `[name="${cur.name}"]`;
        const parent = cur.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
        cur = parent;
      }
      return parts.join(' > ');
    }
    const out = [];
    const required = Array.from(document.querySelectorAll('input,select,textarea'));
    for (const el of required) {
      if (!visible(el)) continue;
      if (el.disabled) continue;
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button') continue;
      const req = el.required || el.getAttribute('aria-required') === 'true';
      const hasValue = tag === 'select'
        ? (el.value && el.value !== '')
        : (type === 'checkbox' || type === 'radio')
          ? el.checked
          : (el.value && el.value.trim() !== '');
      if (!req) continue;
      if (hasValue && type !== 'checkbox' && type !== 'radio') continue;
      // Skip files (uploads handled elsewhere)
      if (type === 'file') continue;
      const item = {
        selector: cssPath(el),
        name: el.name || '',
        id: el.id || '',
        tag,
        type,
        label: labelFor(el).replace(/\s+/g, ' ').slice(0, 300),
        placeholder: el.placeholder || '',
      };
      if (tag === 'select') {
        item.options = Array.from(el.options).map(o => ({ value: o.value, text: o.text.trim() })).slice(0, 30);
      }
      if (type === 'radio' || type === 'checkbox') {
        // Collect siblings sharing the name
        const sameName = Array.from(document.querySelectorAll(`input[type="${type}"][name="${CSS.escape(el.name)}"]`));
        item.options = sameName.map(s => ({
          value: s.value,
          text: (() => {
            const lid = s.id ? document.querySelector(`label[for="${CSS.escape(s.id)}"]`) : null;
            return (lid?.innerText || s.parentElement?.innerText || s.value || '').trim().slice(0, 100);
          })(),
          selector: cssPath(s),
        }));
        // Only emit one entry per radio/checkbox group
        if (out.some(o => o.name === item.name && (o.type === 'radio' || o.type === 'checkbox'))) continue;
      }
      out.push(item);
      if (out.length >= 30) break;
    }
    return out;
  }).catch(() => []);
}

function applicantContext() {
  const p = applicantProfile();
  return {
    name: p.name,
    email: p.email,
    phone: p.phone,
    location: p.location,
    city: p.city,
    state: p.state,
    country: p.country,
    linkedin: p.linkedin,
    github: p.github,
    website: p.website,
    salary: p.salaryText,
    desiredSalary: p.desiredSalary,
    hourlyRate: p.hourlyRate,
    school: p.school,
    workAuth: p.workAuthSummary,
    requiresSponsorship: p.requiresSponsorship,
    eeo: { gender: p.gender, race: p.race, veteran: p.veteran, disability: p.disability },
    pacificOverlap: 'Yes — based in Pacific Time',
    aiCodingTools: `Yes — production use of ${p.aiCodingTools}`,
    softwareExperience: p.softwareYears,
    aiExperience: p.aiYears,
    ruby: 'Yes — hands-on production Ruby on Rails',
  };
}

function buildPrompt({ resume, job, fields }) {
  const applicant = applicantContext();
  const today = new Date();
  const todayStr = today.toISOString().slice(0,10);
  const twoWeeks = new Date(today.getTime() + 14*86400000).toISOString().slice(0,10);
  const oneMonth = new Date(today.getTime() + 30*86400000).toISOString().slice(0,10);
  return [
    {
      role: 'user',
      content: `You answer job application form fields on behalf of a candidate. You will receive:
1. The candidate's resume (markdown)
2. The job title/company/description
3. A list of required form fields with labels, types, and options

Today's date: ${todayStr}. For "earliest start date" / "available start date" / "when can you start" — use a date roughly 2 weeks from today (${twoWeeks}) or up to 1 month out (${oneMonth}). NEVER use a date in the past.
Date format: match the placeholder shown (mm/dd/yyyy → "${twoWeeks.split('-')[1]}/${twoWeeks.split('-')[2]}/${twoWeeks.split('-')[0]}", yyyy-mm-dd → "${twoWeeks}").

Return STRICT JSON: an array of {selector, value} objects. Rules:
- "value" for text/textarea/tel/email/url/number = the exact string to type
- "value" for select = the option's "value" attribute (NOT visible text)
- "value" for radio/checkbox = the option's "value" attribute to select
- Use "SKIP" as value if you should not answer (see hard-skip list below)
- Use the candidate's known facts when relevant; never invent employment history, credentials, certifications, or clearances not in the resume

Candidate facts (authoritative):
${JSON.stringify(applicant, null, 2)}

HARD SKIP — return "SKIP" for fields asking about:
- security clearances (Secret/TS/SCI/Public Trust/active clearance)
- PMP / project management certifications
- EHR systems experience (Epic, Cerner, MEDITECH, Allscripts)
- HL7 / FHIR / healthcare data standards
- hospital / clinical healthcare IT delivery
- recorded video / Loom / one-way video interview / webcam response
- any factual claim about prior employers/dates/titles not in the resume
- any licensure/legal credential not in resume
- any field requiring a long custom essay/cover letter (>200 chars expected)
- citizenship for countries other than US, or sensitive personal info beyond standard EEO

ALLOWED defaults:
- "How did you hear?" → "Google search" or "Job board"
- Visa sponsorship required? → "No"
- Authorized to work in US? → "Yes"
- Years of experience (general software) → "20+"
- Salary expectation → "$350,000" or "$135/hour" depending on context
- Remote/Pacific time overlap → "Yes"
- Generic acknowledgement/consent checkboxes → check them (use the option value)
- Standard EEO: Gender=Male, Race=White, Veteran=No, Disability=Decline / Prefer not to say
- Privacy / data processing consent → Yes / Agree

Job:
title: ${job.title || ''}
company: ${job.company || ''}
url: ${job.url || ''}
description: ${(job.description || '').slice(0, 1500)}

Resume (candidate):
${resume.slice(0, 5000)}

Fields needing answers:
${JSON.stringify(fields, null, 2)}

Return ONLY a JSON array. No prose. Example:
[{"selector":"#input-1","value":"Yes"},{"selector":"select[name=country]","value":"US"},{"selector":"input[name=clearance]","value":"SKIP"}]`,
    },
  ];
}

async function callClaude(messages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await request('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages,
    }),
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new Error(`Anthropic API ${res.statusCode}: ${body.slice(0, 500)}`);
  }
  const data = await res.body.json();
  const text = data.content?.[0]?.text || '';
  return text;
}

async function callOpenAI(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const res = await request(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      max_completion_tokens: 2000,
    }),
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new Error(`OpenAI API ${res.statusCode}: ${body.slice(0, 500)}`);
  }
  const data = await res.body.json();
  return data.choices?.[0]?.message?.content || data.output_text || '';
}

function aiProvider() {
  const explicit = (process.env.HERMES_AI_RESOLVER_PROVIDER || '').toLowerCase();
  if (explicit) return explicit;
  if (process.env.OPENAI_API_KEY && (!process.env.ANTHROPIC_API_KEY || /^gpt/i.test(MODEL))) return 'openai';
  return 'anthropic';
}

async function callAI(messages) {
  return aiProvider() === 'openai' ? callOpenAI(messages) : callClaude(messages);
}

function parseAnswers(text) {
  // Strip code fences if present
  const cleaned = text.replace(/```json\s*|```\s*$/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]); }
  catch { return []; }
}

async function applyAnswers(page, answers) {
  let applied = 0;
  for (const { selector, value } of answers) {
    if (!selector || value === 'SKIP' || value == null) continue;
    try {
      const ok = await page.evaluate(async ({ sel, val }) => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const el = document.querySelector(sel);
        if (!el) return false;
        const tag = el.tagName.toLowerCase();
        const type = (el.type || '').toLowerCase();
        const setter = (e, v) => {
          const proto = Object.getPrototypeOf(e);
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc?.set) desc.set.call(e, v); else e.value = v;
          e.dispatchEvent(new Event('input', { bubbles: true }));
          e.dispatchEvent(new Event('change', { bubbles: true }));
          e.dispatchEvent(new Event('blur', { bubbles: true }));
        };
        if (type === 'radio' || type === 'checkbox') {
          const group = document.querySelectorAll(`input[type="${type}"][name="${CSS.escape(el.name)}"]`);
          for (const r of group) {
            if (r.value === val) { r.click(); r.dispatchEvent(new Event('change', { bubbles: true })); return true; }
          }
          el.click();
          return true;
        }
        if (tag === 'select') {
          el.value = val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return el.value === val;
        }
        setter(el, val);
        return true;
      }, { sel: selector, val: String(value) });
      if (ok) { applied++; continue; }

      // Fallback: maybe it's a React-style custom dropdown wrapper.
      // Click the wrapper, wait for options, click the option matching the value.
      const clickResult = await page.evaluate(async ({ sel, val }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        // Click the element or nearest button/role=combobox
        const wrapper = el.closest('button,[role="combobox"],[role="button"],[class*="select"],[class*="dropdown"]') || el;
        wrapper.scrollIntoView({block:'center'});
        wrapper.click();
        return true;
      }, { sel: selector, val: String(value) });
      if (!clickResult) continue;
      await new Promise(r => setTimeout(r, 600));
      // Find an option in the freshly opened menu matching value (case-insensitive substring)
      const picked = await page.evaluate(async ({ val }) => {
        const needle = String(val).toLowerCase();
        const candidates = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, [class*="option"]'))
          .filter(el => {
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          });
        for (const c of candidates) {
          const txt = (c.innerText || c.textContent || '').trim().toLowerCase();
          if (txt && (txt === needle || txt.includes(needle) || needle.includes(txt))) {
            c.click();
            return true;
          }
        }
        return false;
      }, { val: String(value) });
      if (picked) applied++;
    } catch {}
  }
  return applied;
}

async function resolveBlockedForm({ page, job, payload, blockers, opts = {} }) {
  if (process.env.HERMES_AI_FORM_RESOLVER !== '1') return { resolved: false, reason: 'disabled' };
  if (aiProvider() === 'openai' ? !process.env.OPENAI_API_KEY : !process.env.ANTHROPIC_API_KEY) return { resolved: false, reason: 'no-api-key' };
  // Only act when blockers indicate unknown / missing-required fields
  const triggers = ['unknown-required', 'missing-required-common'];
  if (!blockers.some(b => triggers.some(t => b.includes(t)))) return { resolved: false, reason: 'no-trigger' };

  const fields = await extractRequiredFields(page);
  if (!fields.length) return { resolved: false, reason: 'no-fields' };

  const resume = loadResume();
  const jobCtx = {
    title: job.title || payload.title || '',
    company: job.company || payload.company || '',
    url: job.applyUrl || job.sourceUrl || payload.url || '',
    description: (job.description || payload.description || '').slice(0, 2000),
  };

  const messages = buildPrompt({ resume, job: jobCtx, fields });
  let text = '';
  try { text = await callAI(messages); }
  catch (err) {
    appendLog({ jobId: job.id, error: err.message, blockers, fields });
    return { resolved: false, reason: 'api-error', error: err.message };
  }

  const answers = parseAnswers(text);
  appendLog({ jobId: job.id, title: jobCtx.title, company: jobCtx.company, blockers, fields, answers, raw: text.slice(0, 2000) });
  if (!answers.length) return { resolved: false, reason: 'no-answers' };

  const applied = await applyAnswers(page, answers);
  return { resolved: applied > 0, applied, total: answers.length };
}

module.exports = { resolveBlockedForm, extractRequiredFields, loadResume };
