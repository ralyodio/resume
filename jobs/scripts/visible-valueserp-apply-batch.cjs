#!/usr/bin/env node
const { defaultHermesJobConfig } = require('../src/config/defaults.cjs');
const { JobStore } = require('../src/queue/store.cjs');
const valueserp = require('../src/sources/valueserp-ats.cjs');
const { scoreJob } = require('../src/score/scorer.cjs');
const { selectResume } = require('../src/resumes/select-resume.cjs');
const { generateCoverLetter, normalizeCoverLetterText } = require('../src/cover/generate-cover-letter.cjs');
const { openExternalApplication } = require('../src/apply/open-external.cjs');
const { redactUrl } = require('../src/util/fetch.cjs');

function sanitizeMessage(message) {
  return String(message || '').replace(/https?:\/\/[^\s]+/g, m => redactUrl(m));
}

async function withAbortTimeout(label, timeoutMs, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const QUERIES = (process.env.HERMES_JOB_GOOGLE_QUERIES || [
  'AI Engineer',
  'Generative AI Engineer',
  'Full Stack AI Engineer',
  'Senior Software Engineer'
].join('|')).split('|').map(s=>s.trim()).filter(Boolean);
const PER_QUERY = Number(process.env.HERMES_JOBS_PER_SEARCH || 15);
const MIN_SCORE = Number(process.env.HERMES_MIN_APPLY_SCORE || 70);
const store = new JobStore(process.env.HERMES_JOBS_STORE || defaultHermesJobConfig.storeDir);

function existingByApplyUrl(){
  const map = new Map();
  for (const j of store.all()) {
    const url = j.applyUrl || j.sourceUrl;
    if (url) map.set(url, j);
  }
  return map;
}
function lastApplyReason(job) {
  const r = job?.applyResult || job?.applicationResult || job?.metadata?.applyResult || job?.reason || '';
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object') return [r.reason, r.status, r.url].filter(Boolean).join(' ');
  return '';
}
function nonRetryableReview(job) {
  return /captcha-unsolved|\blogin\b|flagged as possible spam|spam-blocked|job not found|already applied/i.test(lastApplyReason(job));
}
function alreadyTerminal(job){
  const retryReview = /^(1|true|yes)$/i.test(process.env.HERMES_RETRY_NEEDS_REVIEW || '');
  if (retryReview && ['needs-human-review','failed'].includes(job.status) && !nonRetryableReview(job)) return false;
  return ['applied','needs-human-review','failed','skipped'].includes(job.status);
}
function approvedPayload(job, score){
  const resumePath = selectResume(job);
  const coverPdfPath = process.env.COVER_PDF || '/home/ettinger/Desktop/resume/anthony.ettinger.cover4.pdf';
  const next = {...job, ...score, status:'approved', resumePath, coverPdfPath};
  next.coverLetter = normalizeCoverLetterText(generateCoverLetter(next));
  next.metadata = {...(next.metadata||{}), approvedBy:'visible-valueserp-apply-batch', approvedAt:new Date().toISOString()};
  return next;
}
async function searchAndApprove(){
  const approved=[];
  for (const query of QUERIES) {
    console.log(`SEARCH_START\t${query}\tlimit=${PER_QUERY}`);
    let candidates=[];
    try {
      const jobs=[];
      for (const target of valueserp.ATS_TARGETS.filter(t=>t.id!=='email' && !(process.env.HERMES_DISABLE_ASHBY === '1' && t.id === 'ashby'))) {
        console.log(`SEARCH_TARGET\t${query}\t${target.id}`);
        try {
          const timeoutMs = Number(process.env.VALUESERP_TARGET_TIMEOUT_MS || 90000);
          const got = await withAbortTimeout(`ValueSERP ${query} ${target.id}`, timeoutMs, signal =>
            valueserp.searchTarget(target,{query, remoteOnly:true, usaOnly:true, limit:PER_QUERY, maxPages:Number(process.env.VALUESERP_MAX_PAGES || 3), timeoutMs:Number(process.env.VALUESERP_FETCH_TIMEOUT_MS || 20000), signal})
          );
          console.log(`SEARCH_TARGET_DONE\t${query}\t${target.id}\tfound=${got.length}`);
          jobs.push(...got);
        } catch (err) {
          console.error(`SEARCH_TARGET_FAILED\t${query}\t${target.id}\t${sanitizeMessage(err.message)}`);
        }
      }
      const existing=existingByApplyUrl();
      const approvedByAts={};
      for (const discovered of jobs) {
        const url=discovered.applyUrl||discovered.sourceUrl;
        const prior = url ? existing.get(url) : null;
        const job = prior && !alreadyTerminal(prior) ? {...prior, ...discovered, id: prior.id, status: prior.status} : discovered;
        const ats = job.metadata?.ats || 'unknown';
        if ((approvedByAts[ats] || 0) >= PER_QUERY) continue;
        if(!url || (prior && alreadyTerminal(prior))) continue;
        const scored=scoreJob(job);
        const technicalDecision = ['queue-for-review','auto-apply-eligible'].includes(scored.decision) && scored.score >= MIN_SCORE;
        if (!technicalDecision) {
          store.upsert({...job,...scored,status:'scored'}, 'score');
          continue;
        }
        const approvedJob=approvedPayload(job, scored);
        store.upsert(approvedJob, 'search-approved-for-live-apply');
        existing.set(url, approvedJob);
        approvedByAts[ats]=(approvedByAts[ats]||0)+1;
        candidates.push(approvedJob);
        approved.push(approvedJob);
        console.log(`APPROVED\t${query}\t${scored.score}\t${approvedJob.title}\t${approvedJob.company}\t${url}`);
      }
    } catch (err) {
      console.error(`SEARCH_FAILED\t${query}\t${sanitizeMessage(err.message)}`);
    }
    console.log(`SEARCH_DONE\t${query}\tapproved=${candidates.length}`);
  }
  return approved;
}
async function applyApproved(jobs){
  let processed=0, submitted=0, review=0, failed=0;
  for (const job of jobs) {
    const current=store.get(job.id) || job;
    if (alreadyTerminal(current) && current.status !== 'approved') continue;
    console.log(`APPLY_START\t${current.title}\t${current.company}\t${current.applyUrl||current.sourceUrl}`);
    try {
      const r=await openExternalApplication({job:current,dryRun:false,submit:true,storeDir:store.storeDir,headless:false,timeoutMs:Number(process.env.HERMES_PUPPETEER_NAV_TIMEOUT_MS || 60000)});
      console.log(`APPLY_RESULT\t${r.status}\t${current.title}\t${current.company}\t${r.ats||''}\t${r.url||''}\t${r.reason||''}`);
      if(r.status==='submitted') { store.markApplied(current.id,{applyResult:r}); submitted++; }
      else if(r.status==='needs-human-review' || r.status==='unsupported') { store.transition(current.id,'needs-human-review',{applyResult:r}); review++; }
      else if(r.status==='failed') { store.markFailed(current.id,r.reason||'apply failed'); failed++; }
      else { store.transition(current.id,'needs-human-review',{applyResult:r}); review++; }
    } catch (err) {
      console.error(`APPLY_ERROR\t${current.title}\t${current.company}\t${err.message}`);
      store.markFailed(current.id,err.message);
      failed++;
    }
    processed++;
  }
  console.log(`BATCH_DONE\tprocessed=${processed}\tsubmitted=${submitted}\treview=${review}\tfailed=${failed}\tstore=${store.storeDir}`);
}
(async()=>{
  process.env.HERMES_PUPPETEER_HEADLESS='0';
  process.env.HERMES_LOAD_REPO_DOTENV='1';
  // Do not force every manual-review browser to stay open during a batch: orphaned
  // Chrome windows exhaust Puppeteer launch slots and cause WS endpoint timeouts.
  // The caller can still opt in for a single debug run with HERMES_PUPPETEER_KEEP_OPEN_ON_REVIEW=1.
  process.env.HERMES_PUPPETEER_KEEP_OPEN_ON_REVIEW=process.env.HERMES_PUPPETEER_KEEP_OPEN_ON_REVIEW || '0';
  process.env.HERMES_PUPPETEER_NAV_TIMEOUT_MS=process.env.HERMES_PUPPETEER_NAV_TIMEOUT_MS || '60000';
  process.env.HERMES_ATS_VERIFY_ATTEMPTS=process.env.HERMES_ATS_VERIFY_ATTEMPTS || '8';
  process.env.HERMES_ATS_VERIFY_DELAY_MS=process.env.HERMES_ATS_VERIFY_DELAY_MS || '10000';
  process.env.HERMES_ATS_VERIFY_INITIAL_DELAY_MS=process.env.HERMES_ATS_VERIFY_INITIAL_DELAY_MS || '10000';
  process.env.HERMES_JOB_SEARCH_US_ONLY='1';
  const approved=await searchAndApprove();
  console.log(`APPROVED_TOTAL\t${approved.length}`);
  await applyApproved(approved);
})().catch(err=>{ console.error(err.stack||err.message); process.exit(1); });
