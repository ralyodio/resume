#!/usr/bin/env node
// Apply to every job in $STATE/queue.json that is not already in applied.jsonl,
// one at a time. Prints one JSON line per job (plus "awaiting-code" lines when a
// Greenhouse security code is needed) and appends outcomes to results.jsonl.
// Submitted and likely-submitted jobs go into applied.jsonl so discover.mjs skips them.
//
//   node jobs/ai-startups/apply-queue.mjs [--dry-run] [key]
//
// queue.json: [{ key, company, title, url, applyUrl, focus }] where focus finishes
// the sentence "<company>'s work on ___ is exactly the production agent work I want".
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE = process.env.AI_JOBS_STATE || path.join(os.homedir(), '.local/share/hermes-remote-jobs/ai-startups');
const dryRun = process.argv.includes('--dry-run');
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const applied = new Set(readJsonl(path.join(STATE, 'applied.jsonl')).map((r) => r.url));
const queue = JSON.parse(fs.readFileSync(path.join(STATE, 'queue.json'), 'utf8'));
fs.mkdirSync(path.join(STATE, 'logs'), { recursive: true });

const why = (job) => `I've spent 30 years in Silicon Valley designing and architecting software (PayPal, Yahoo, Chegg, IBM), and today I write 100% of my code with AI agents (Claude Code, Codex, Cursor) while I own the design and architecture. That's how I run a fleet of live products at profullstack.com (code at github.com/profullstack). ${job.company}'s work on ${job.focus} is exactly the production agent work I want to do full time.`;

for (const job of queue) {
  if ((only && job.key !== only) || applied.has(job.url)) continue;
  const logFile = path.join(STATE, 'logs', `${job.key}.log`);
  const result = await new Promise((resolve) => {
    const out = fs.openSync(logFile, 'w');
    const args = [path.join(DIR, 'apply-one.mjs'), job.applyUrl || job.url, ...(dryRun ? [] : ['--submit'])];
    const child = spawn('node', args, { env: { ...process.env, WHY: why(job), JOB_KEY: job.key, AI_JOBS_STATE: STATE }, stdio: ['ignore', 'pipe', out] });
    let last = { status: 'failed', reason: 'no output' };
    child.stdout.on('data', (b) => {
      for (const line of b.toString().split('\n').filter(Boolean)) {
        fs.appendFileSync(logFile, `${line}\n`);
        try {
          const r = JSON.parse(line);
          if (r.status === 'awaiting-code') console.log(JSON.stringify({ key: job.key, company: job.company, ...r }));
          else last = r;
        } catch {}
      }
    });
    const timer = setTimeout(() => child.kill(), 480_000);
    child.on('exit', () => { clearTimeout(timer); resolve(last); });
  });
  const row = { key: job.key, company: job.company, title: job.title, url: job.url, ...result, at: new Date().toISOString() };
  fs.appendFileSync(path.join(STATE, 'results.jsonl'), `${JSON.stringify(row)}\n`);
  if (!dryRun && ['submitted', 'unverified'].includes(result.status)) {
    // unverified = submit clicked and no error seen; treat as applied so we never double-apply.
    fs.appendFileSync(path.join(STATE, 'applied.jsonl'), `${JSON.stringify({ url: job.url, company: job.company, title: job.title, status: result.status, via: 'tron-mcp', at: row.at })}\n`);
  }
  console.log(JSON.stringify(row));
}
console.log(JSON.stringify({ status: 'queue-finished' }));
