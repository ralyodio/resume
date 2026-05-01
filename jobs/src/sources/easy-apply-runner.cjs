const path = require('path');
const { spawnSync } = require('child_process');
const { normalizeJob } = require('../normalize/job.cjs');

const RESUME_ROOT = '/home/ettinger/Desktop/resume';

function splitSearches(query, fallback) {
  return String(query || fallback || '').split('|').map(s => s.trim()).filter(Boolean).join('|');
}

function buildRunnerPlan({ id, script, dryRun=true, query='', limit=5, storeDir='', extraEnv={} }) {
  const max = String(Math.max(0, Number(limit || 5)));
  const command = path.join(RESUME_ROOT, script);
  return {
    cwd: RESUME_ROOT,
    command,
    args: [command],
    env: {
      DRY_RUN: dryRun ? '1' : '0',
      MAX_SCAN: max,
      MAX_APPLY: max,
      SEARCHES: splitSearches(query, extraEnv.SEARCHES || defaultSearches(id)),
      HERMES_JOBS_STORE: storeDir || '',
      CHROME: process.env.CHROME || require('puppeteer').executablePath(),
      ...extraEnv,
    },
  };
}

function defaultSearches(id) {
  if (id === 'dice') return 'Claude|OpenAI Codex|LLM Engineer|AI Engineer|Node.js AI Engineer|Svelte React remote';
  return 'Claude OpenAI LLM engineer|AI prompt engineer|AI full stack engineer|LLM software engineer|OpenAI developer';
}

function commandPreview(plan) {
  const env = Object.entries(plan.env)
    .filter(([,v]) => v !== '' && v !== undefined)
    .map(([k,v]) => `${k}=${JSON.stringify(String(v))}`)
    .join(' ');
  return `${env} node ${plan.command}`;
}

function normalizeResultRow(sourceId, row) {
  const payload = row.job || row;
  const status = row.status || payload.status || 'new';
  const url = payload.url || payload.href || payload.sourceUrl || payload.applyUrl || '';
  const id = payload.id || payload.jobId || `${sourceId}-${url}`;
  return normalizeJob({
    id: `${sourceId}-${String(id).replace(/^linkedin-|^dice-/, '')}`,
    source: sourceId,
    sourceUrl: url,
    applyUrl: payload.applyUrl || url,
    title: payload.title || `${sourceId} Easy Apply job`,
    company: payload.company || 'Unknown',
    location: payload.location || 'Remote',
    remote: true,
    remoteRegion: 'US',
    applicationMode: 'easy-apply',
    descriptionText: payload.descriptionText || payload.cardText || payload.label || row.reason || '',
    status: ['applied','failed','skipped'].includes(status) ? status : 'new',
    metadata: { runnerStatus: status, runnerReason: row.reason || payload.reason || '', original: payload },
  });
}

function runRunner(plan, { dryRun=true } = {}) {
  if (dryRun) return { supported: true, status: 'dry-run', command: commandPreview(plan), plan };
  const result = spawnSync(process.execPath, plan.args, {
    cwd: plan.cwd,
    stdio: 'inherit',
    env: { ...process.env, ...plan.env },
  });
  return { supported: true, status: result.status === 0 ? 'completed' : 'failed', exitCode: result.status };
}

module.exports = { RESUME_ROOT, buildRunnerPlan, commandPreview, normalizeResultRow, runRunner };
