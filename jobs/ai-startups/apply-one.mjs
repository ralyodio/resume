#!/usr/bin/env node
// Fill (and with --submit, submit) one Greenhouse/Ashby application by driving
// `tron automate` over stdio MCP. Refuses to submit while any required field is
// unanswered, and never ticks consent/arbitration boxes.
//
//   node jobs/ai-startups/apply-one.mjs <application-url> [--submit]
//
// Env: WHY (answer for "why us?"), JOB_KEY (names the security-code file),
//      AI_JOBS_STATE, TRON_AUTOMATE_BIN, TRON_CHROMIUM_BIN, RESUME_PDF, COVER_PDF.
//
// Greenhouse emails a security code before accepting an application. This
// prints {"status":"awaiting-code","codeFile":...} and waits up to 5 minutes
// for that file; whoever runs it reads the code from the inbox and writes it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATE = process.env.AI_JOBS_STATE || path.join(HOME, '.local/share/hermes-remote-jobs/ai-startups');
// Needs a tron with browser_upload (tronbrowser.dev PR #113 or a release after it).
const BIN = process.env.TRON_AUTOMATE_BIN || path.join(HOME, '.local/lib/tronbrowser/tronbrowser/sdk/automate-bin.js');
// On this box the bundled engine needs user-space GUI libs + --no-sandbox; see the README.
const CHROMIUM = process.env.TRON_CHROMIUM_BIN || path.join(HOME, '.local/lib/tronbrowser/userlibs/ungoogled-chromium-nosandbox');
const RESUME = process.env.RESUME_PDF || path.join(REPO, 'anthony.ettinger.resume5.pdf');
const COVER = process.env.COVER_PDF || path.join(REPO, 'anthony.ettinger.cover5.pdf');
const [url] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const submit = process.argv.includes('--submit');
if (!url) { console.error('usage: apply-one.mjs <application-url> [--submit]'); process.exit(2); }

const P = {
  first: 'Anthony', last: 'Ettinger', email: 'anthony@profullstack.com', phone: '+1-408-656-2473',
  linkedin: 'https://linkedin.com/in/anthonyettinger', github: 'https://github.com/profullstack',
  website: 'https://profullstack.com',
};
// Label regex -> [kind, value]; first match wins, and upload rules only match file inputs.
const RULES = [
  [/preferred (first )?name/i, ['fill', P.first]],
  [/first name/i, ['fill', P.first]],
  [/last name/i, ['fill', P.last]],
  [/^full name|^name\*?$|^name\b/i, ['fill', `${P.first} ${P.last}`]],
  [/e-?mail/i, ['fill', P.email]],
  [/phone/i, ['fill', P.phone]],
  [/linkedin/i, ['fill', P.linkedin]],
  [/github/i, ['fill', P.github]],
  [/website|portfolio|personal site/i, ['fill', P.website]],
  [/cover letter/i, ['upload', COVER]],
  [/resume|cv\b|^attach$/i, ['upload', RESUME]],
  [/^country/i, ['select', 'United States']],
  [/legally authorized|authorized to work|eligible to work/i, ['select', 'Yes']],
  [/sponsorship|visa/i, ['select', 'No']],
  [/bay area|pst time zone|pacific time/i, ['select', 'Yes']],
  [/previously applied|been involved in a recruitment|interviewed (with|at)/i, ['select', 'No']],
  [/large language models|llm/i, ['select', 'Yes']],
  [/large scale backend/i, ['select', 'Yes']],
  [/client facing|customer handling|customer-facing/i, ['select', 'Yes']],
  [/how did you hear/i, ['select', 'Company website']],
  [/current location|where are you currently located|city and country/i, ['fill', 'Los Gatos, CA, United States']],
  [/^location\b/i, ['location', 'Los Gatos']],
  [/^why\b|why .*(interested|excited|join|apply)|why (do you want|are you)|what (excites|interests) you/i, ['fill', process.env.WHY || '']],
];

const child = spawn('node', [BIN, '--chromium-bin', CHROMIUM], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
rl.on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; } const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } });
const rpc = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
async function call(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = (r.result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.error || r.result?.isError) throw new Error(`${name}: ${r.error?.message || text}`);
  return text;
}
const parse = (snap) => snap.split('\n').map((l) => l.match(/^(@e\d+) (\S+) "((?:[^"\\]|\\.)*)"( \[required\])?(?: = "((?:[^"\\]|\\.)*)")?/)).filter(Boolean)
  .map((m) => ({ ref: m[1], role: m[2], name: JSON.parse(`"${m[3]}"`), required: !!m[4], value: m[5] ? JSON.parse(`"${m[5]}"`) : '' }));
const log = (...a) => console.error('[apply-one]', ...a);
const SUBMIT_BTN = /submit( application)?$/i;
const SUCCESS = /thank you for applying|application (has been |was )?(successfully )?(received|submitted)|successfully submitted|thanks for (your )?(applying|application|submitting)|we.ve received your application/i;
const ERRORS = /(missing entry for required field[^"\\]{0,80}|this field is required[^"\\]{0,40}|please complete[^"\\]{0,60}|[^"\\]{0,60}spam[^"\\]{0,60}|needs corrections[^"\\]{0,80})/gi;

async function main() {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'apply-one', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await call('browser_open', { url });
  await call('browser_wait', { ms: 2500 });
  let snap = await call('browser_snapshot');
  // Ashby job pages keep the form behind an "Application" tab.
  const tab = parse(snap).find((e) => /^application$/i.test(e.name) && /tab|link|button/.test(e.role));
  if (tab && !parse(snap).some((e) => /first name|^name/i.test(e.name))) { await call('browser_click', { ref: tab.ref }); await call('browser_wait', { ms: 1500 }); snap = await call('browser_snapshot'); }
  if (!parse(snap).some((e) => ['textbox', 'file'].includes(e.role))) { console.log(JSON.stringify({ status: 'needs-human-review', unknown: ['no form on the page (posting closed or page not found?)'] })); return; }

  const done = new Set();
  const unknown = [];
  for (const el of parse(snap)) {
    if (!['textbox', 'combobox', 'file', 'checkbox'].includes(el.role)) continue;
    const label = el.name.replace(/\s+/g, ' ').trim();
    if (el.role === 'checkbox') {
      // Option boxes of a multi-select ("How did you hear…"): tick ours, skip the rest.
      // Consent/agreement/arbitration boxes are the applicant's call: stop.
      if (/agree|consent|acknowledge|certify|arbitrat|attest/i.test(label)) { if (el.required) unknown.push(label); continue; }
      if (/company website|careers (page|site)/i.test(label) && el.value !== 'checked') await call('browser_click', { ref: el.ref });
      continue;
    }
    // "Please type your answer if you selected Other…": some employers make it required for everyone.
    if (/^please (type|specify|explain).{0,40}if (you )?(selected|answered|chose)/i.test(label)) { if (!el.value) await call('browser_fill', { ref: el.ref, value: 'Company website (careers page)' }); continue; }
    const rule = RULES.find(([re, [k]]) => re.test(label) && (el.role === 'file') === (k === 'upload'));
    if (!rule) { if (el.required || /\*/.test(label)) unknown.push(label || `(unlabeled ${el.role})`); continue; }
    const [kind, value] = rule[1];
    if (!value) { if (el.required || /\*/.test(label)) unknown.push(`${label} (no answer)`); continue; }
    const key = `${kind}:${label}`;
    if (done.has(key)) continue;
    try {
      if (kind === 'fill') { if (!el.value) await call('browser_fill', { ref: el.ref, value }); }
      else if (kind === 'upload') await call('browser_upload', { ref: el.ref, paths: [value] });
      else { const t = await call('browser_select', { ref: el.ref, value }); log(label, '->', t.split('\n')[0]); }
      done.add(key);
    } catch (e) { unknown.push(`${label} (${e.message.slice(0, 160)})`); }
  }
  snap = await call('browser_snapshot');
  log('fields:\n  ' + parse(snap).filter((e) => ['textbox', 'combobox', 'file'].includes(e.role)).map((e) => `${e.role} ${e.name.slice(0, 60)} = ${e.value.slice(0, 40)}`).join('\n  '));
  const pageText = JSON.stringify(await call('browser_extract', { mode: 'text' }));
  if (!pageText.includes(path.basename(RESUME, '.pdf'))) unknown.push('resume not shown as attached');
  if (unknown.length) { console.log(JSON.stringify({ status: 'needs-human-review', unknown })); return; }
  if (!submit) { console.log(JSON.stringify({ status: 'prepared' })); return; }

  const btn = parse(snap).find((e) => e.role === 'button' && SUBMIT_BTN.test(e.name.trim()));
  if (!btn) { console.log(JSON.stringify({ status: 'needs-human-review', unknown: ['submit button not found'] })); return; }
  await call('browser_click', { ref: btn.ref });
  let codeDone = false;
  for (let i = 0; i < 12; i++) {
    await call('browser_wait', { ms: 1500 });
    const text = JSON.stringify(await call('browser_extract', { mode: 'text' }));
    if (!codeDone && /security code/i.test(text)) {
      const box = parse(await call('browser_snapshot')).find((e) => e.role === 'textbox' && /code/i.test(e.name) && !e.value);
      if (box) {
        const codeFile = path.join(STATE, 'codes', `${process.env.JOB_KEY || 'job'}.txt`);
        fs.mkdirSync(path.dirname(codeFile), { recursive: true });
        fs.rmSync(codeFile, { force: true });
        console.log(JSON.stringify({ status: 'awaiting-code', codeFile }));
        let code = '';
        for (let w = 0; w < 200 && !code; w++) { await new Promise((r) => setTimeout(r, 1500)); try { code = fs.readFileSync(codeFile, 'utf8').trim(); } catch {} }
        if (!code) { console.log(JSON.stringify({ status: 'needs-human-review', unknown: ['security code not provided'] })); return; }
        await call('browser_fill', { ref: box.ref, value: code });
        const again = parse(await call('browser_snapshot')).find((e) => e.role === 'button' && SUBMIT_BTN.test(e.name.trim()));
        if (again) await call('browser_click', { ref: again.ref });
        codeDone = true;
        i = 0;
        continue;
      }
    }
    if (SUCCESS.test(text)) { console.log(JSON.stringify({ status: 'submitted' })); return; }
    const errs = text.match(ERRORS);
    if (errs && i >= 2) { console.log(JSON.stringify({ status: 'needs-human-review', unknown: errs.slice(0, 5) })); return; }
  }
  console.log(JSON.stringify({ status: 'unverified', tail: JSON.stringify(await call('browser_extract', { mode: 'text' })).slice(-600) }));
}
main().catch((e) => console.log(JSON.stringify({ status: 'failed', reason: e.message }))).finally(async () => { try { await call('browser_close'); } catch {} child.kill(); process.exit(0); });
