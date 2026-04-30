const { buildRunnerPlan, commandPreview, normalizeResultRow, runRunner } = require('./easy-apply-runner.cjs');

const source = {
  id: 'linkedin',
  name: 'LinkedIn Easy Apply',
  supportsRemoteFilter: true,
  supportsNativeApply: true,
  supportsExternalApply: false,
  supportsEasyApply: true,
  reviewOnly: false,
  runnerScript: '/home/ettinger/Desktop/resume/linkedin_easy_apply_daily.cjs',
};

function buildRunnerPlanForLinkedIn(opts={}) {
  return buildRunnerPlan({ id: source.id, script: 'linkedin_easy_apply_daily.cjs', ...opts });
}

async function searchJobs(opts={}) {
  if (Array.isArray(opts.results)) return opts.results.map(row => normalizeResultRow(source.id, row));
  return [];
}

async function getJobDetails(job) { return job || null; }
async function getApplicationMode() { return 'easy-apply'; }
async function applyToJob(job={}, opts={}) {
  const dryRun = opts.dryRun !== false;
  const plan = buildRunnerPlanForLinkedIn({
    dryRun,
    query: opts.query || job.title || '',
    limit: opts.limit || 1,
    storeDir: opts.storeDir || '',
    extraEnv: job.sourceUrl ? { TARGET_JOB_URL: job.sourceUrl } : {},
  });
  const result = runRunner(plan, { dryRun });
  return { ...result, source: source.id, jobId: job.id, command: result.command || commandPreview(plan) };
}

module.exports = { source, searchJobs, getJobDetails, getApplicationMode, applyToJob, buildRunnerPlan: buildRunnerPlanForLinkedIn };
