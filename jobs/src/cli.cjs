#!/usr/bin/env node
const { spawnSync } = require('child_process');
const { defaultHermesJobConfig } = require('./config/defaults.cjs');
const { getSource, listSources } = require('./sources/index.cjs');
const { assertSourceAdapter } = require('./sources/interface.cjs');
const { JobStore } = require('./queue/store.cjs');
const { scoreJob } = require('./score/scorer.cjs');
const { selectResume } = require('./resumes/select-resume.cjs');
const { generateCoverLetter } = require('./cover/generate-cover-letter.cjs');
const { openExternalApplication } = require('./apply/open-external.cjs');

function help(){ console.log(`Hermes Remote Jobs

Usage:
  node src/cli.cjs jobs search --source web3-career --remote --query "Web3 Engineer" [--limit 10]
  node src/cli.cjs jobs search --all --remote --since 3d
  node src/cli.cjs jobs score --new
  node src/cli.cjs jobs queue --min-score 70
  node src/cli.cjs jobs review
  node src/cli.cjs jobs approve --id <jobId>
  node src/cli.cjs jobs skip --id <jobId> --reason "not a fit"
  node src/cli.cjs jobs apply --approved [--run-live --confirm-live-external-apply]
  node src/cli.cjs jobs rotate --review-only --query "AI Engineer" --limit 10
  node src/cli.cjs jobs rotate --include-easy-apply --dry-run-easy-apply
  node src/cli.cjs jobs rotate --include-easy-apply --run-easy-apply-live --confirm-live-easy-apply
  node src/cli.cjs sources list
  node src/cli.cjs sources enable builtin
  node src/cli.cjs sources disable indeed
  node src/cli.cjs blacklist company "Some Staffing Agency"
  node src/cli.cjs blacklist keyword "clearance required"

Commands include jobs search, jobs score, jobs queue, jobs review, jobs approve, jobs skip, jobs apply, jobs rotate.
External apply supports conservative auto-apply for Greenhouse, Lever, Ashby, Workable, SmartRecruiters, and mailto email drafts; live external ATS submission requires --run-live --confirm-live-external-apply and still submits only when common fields are filled and no captcha/login/unknown required questions are detected.`); }
function parse(argv){ const out={_:[]}; for(let i=0;i<argv.length;i++){ const a=argv[i]; if(a.startsWith('--')){ const k=a.slice(2); const v=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true; out[k]=v; } else out._.push(a); } return out; }

async function searchSources({store,args,sourceIds}) {
  let count=0;
  for(const id of sourceIds){
    try {
      const adapter=getSource(id); assertSourceAdapter(adapter);
      const jobs=await adapter.searchJobs({query:args.query||'', remoteOnly:true, since:args.since||'7d', limit:Number(args.limit||25)});
      for(const job of jobs){ store.upsert(job,'search-result'); count++; console.log(`${job.source}\t${job.title}\t${job.company}\t${job.sourceUrl}`); }
    } catch (err) {
      console.error(`source failed\t${id}\t${err.message}`);
    }
  }
  return count;
}
function scoreNew(store){ let n=0; for(const job of store.all().filter(j=>j.status==='new')){ const s=scoreJob(job); store.upsert({...job,...s,status:'scored'},'score'); n++; console.log(`${s.score}\t${s.decision}\t${job.title}\t${job.company}\t${s.reasons.join('; ')}`); } return n; }
function queueScored(store, min){ let n=0; const queueDecisions=new Set(['queue-for-review','auto-apply-eligible']); for(const job of store.all().filter(j=>(j.score||0)>=min && ['new','scored'].includes(j.status) && queueDecisions.has(j.decision))){ const resumePath=selectResume(job); const coverLetter=generateCoverLetter(job); store.upsert({...job,status:'queued',resumePath,coverLetter},'queue'); n++; console.log(`queued\t${job.score}\t${job.title}\t${job.company}`); } return n; }
function easyApplySources(){ return listSources().filter(s=>s.supportsNativeApply && s.supportsEasyApply); }
async function runEasyApplyRotation({args,store}){
  const include = Boolean(args['include-easy-apply'] || args['include-legacy']);
  if(args['review-only']) args['skip-easy-apply']=true;
  if(!include || args['skip-easy-apply'] || args['skip-legacy']) { console.log('easy-apply skipped'); return; }
  const liveRequested = args['run-easy-apply-live'] === true || args['run-legacy-live'] === true;
  const liveConfirmed = args['confirm-live-easy-apply'] === true;
  const dryRun = !liveRequested || !liveConfirmed;
  if(liveRequested && !liveConfirmed) console.log('easy-apply live requested but not confirmed; dry-run only. Add --confirm-live-easy-apply to submit live.');
  for (const s of easyApplySources()) {
    const adapter=getSource(s.id);
    const plan=adapter.buildRunnerPlan({dryRun, query:args.query||'', limit:Number(args['easy-apply-limit']||args.limit||5), storeDir:store.storeDir});
    const cmd=`${Object.entries(plan.env).filter(([,v])=>v).map(([k,v])=>`${k}=${JSON.stringify(String(v))}`).join(' ')} node ${plan.command}`;
    if (dryRun) { console.log(`easy-apply dry-run\t${s.id}\t${cmd}`); continue; }
    console.log(`easy-apply running\t${s.id}\t${plan.command}`);
    const result=spawnSync(process.execPath,plan.args,{cwd:plan.cwd,stdio:'inherit',env:{...process.env,...plan.env}});
    if(result.status!==0) throw new Error(`${s.id} easy-apply runner failed with ${result.status}`);
  }
}

async function main(argv=process.argv.slice(2)){ const args=parse(argv); if(!argv.length||args.help||args.h){ help(); return; } const store=new JobStore(args.store||defaultHermesJobConfig.storeDir); const [group,cmd]=args._;
  if(group==='sources'){ if(cmd==='list'){ for(const s of listSources()) console.log(`${s.id}\t${s.name}\treviewOnly=${!!s.reviewOnly}\tlegacy=${!!s.legacyScript}`); return; } console.log(`${cmd||'source'} is configuration-only in MVP; no source state changed.`); return; }
  if(group==='blacklist'){ console.log(`Recorded blacklist request (${args._.slice(1).join(' ')}). Persistent blacklist is planned after MVP core.`); return; }
  if(group!=='jobs') { help(); return; }
  if(cmd==='search'){ const selected=args.all ? listSources().filter(s=>!s.legacyScript).map(s=>s.id) : [args.source||'web3-career']; const count=await searchSources({store,args,sourceIds:selected}); console.error(`saved ${count} jobs`); return; }
  if(cmd==='score'){ let n=0; for(const job of store.all().filter(j=>args.new?j.status==='new':true)){ const s=scoreJob(job); store.upsert({...job,...s,status:'scored'},'score'); n++; console.log(`${s.score}\t${s.decision}\t${job.title}\t${job.company}\t${s.reasons.join('; ')}`); } console.error(`scored ${n} jobs`); return; }
  if(cmd==='queue'){ const n=queueScored(store, Number(args['min-score']||defaultHermesJobConfig.minScoreForQueue)); console.error(`queued ${n} jobs`); return; }
  if(cmd==='review'){ const rows=store.pendingReview(); if(!rows.length){ console.log('No queued jobs.'); return; } for(const j of rows) console.log(`---\n${j.id}\n${j.score} ${j.title} @ ${j.company}\n${j.source} ${j.applicationMode}\n${j.applyUrl||j.sourceUrl}\nReasons: ${(j.reasons||[]).join('; ')}\nRisks: ${(j.riskFlags||[]).join('; ')||'none'}\nResume: ${j.resumePath||''}\nCover letter:\n${j.coverLetter||''}`); return; }
  if(cmd==='approve'){ const id=args.id||args._[2]; if(!id) throw new Error('jobs approve requires --id <jobId>'); const j=store.approve(id); console.log(`approved\t${j.id}`); return; }
  if(cmd==='skip'){ const id=args.id||args._[2]; if(!id) throw new Error('jobs skip requires --id <jobId>'); const j=store.skip(id,args.reason||'user-skip'); console.log(`skipped\t${j.id}\t${j.skipReason}`); return; }
  if(cmd==='apply'){ let n=0; let submitted=0; const externalLive=args['run-live']===true && args['confirm-live-external-apply']===true; if(args['run-live']===true && !args['confirm-live-external-apply']) console.error('external live requested but not confirmed; dry-run only. Add --confirm-live-external-apply to submit supported ATS applications.'); for(const job of store.all().filter(j=>args.approved?j.status==='approved':false)){ const adapter = listSources().some(s=>s.id===job.source) ? getSource(job.source) : null; if(adapter && adapter.source.supportsNativeApply){ const r=await adapter.applyToJob(job,{dryRun:args['run-live']!==true,storeDir:store.storeDir,limit:1}); console.log(`native ${r.status}\t${job.id}\t${job.source}\t${r.command||''}`); if(r.status==='submitted'){ store.markApplied(job.id,{applyResult:r}); submitted++; } n++; continue; } const r=await openExternalApplication({job,dryRun:!externalLive,submit:externalLive,storeDir:store.storeDir,dryTest:process.env.HERMES_ATS_DRY_TEST==='1'}); console.log(`auto-apply\t${r.status}\t${job.id}\t${r.ats||'unknown'}\t${r.url||''}\t${r.resumePath||''}\t${r.reason||''}${r.draftPath?`\t${r.draftPath}`:''}`); if(r.status==='submitted'){ store.markApplied(job.id,{applyResult:r}); submitted++; } else if(r.status==='needs-human-review' || r.status==='unsupported') { store.transition(job.id,'needs-human-review',{applyResult:r}); } else if(r.status==='failed') { store.markFailed(job.id,r.reason||'apply failed'); } n++; } console.error(`processed ${n}; submitted ${submitted}; external live submit requires --run-live --confirm-live-external-apply and still falls back to needs-human-review when unsafe`); return; }
  if(cmd==='rotate'){
    const sourceIds = listSources().filter(s=>!s.supportsNativeApply).map(s=>s.id);
    const found = Number(args.limit||25) > 0 ? await searchSources({store,args,sourceIds}) : 0;
    const scored = scoreNew(store);
    const queued = queueScored(store, Number(args['min-score']||defaultHermesJobConfig.minScoreForQueue));
    await runEasyApplyRotation({args,store});
    console.log(`rotation complete\tfound=${found}\tscored=${scored}\tqueued=${queued}\tstore=${store.storeDir}`);
    return;
  }
  help(); }
main().catch(err=>{ console.error(err.stack||err.message); process.exit(1); });
