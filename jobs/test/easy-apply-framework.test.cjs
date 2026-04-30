const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {getSource,listSources}=require('../src/sources/index.cjs');
const {assertSourceAdapter}=require('../src/sources/interface.cjs');
const {JobStore}=require('../src/queue/store.cjs');

test('LinkedIn and Dice are native easy-apply framework adapters, not legacy placeholders',()=>{
  for (const id of ['linkedin','dice']) {
    const adapter=getSource(id);
    assert.equal(assertSourceAdapter(adapter),true);
    assert.equal(adapter.source.supportsNativeApply,true);
    assert.equal(adapter.source.reviewOnly,false);
    assert.equal(adapter.source.legacyScript,undefined);
    assert.equal(typeof adapter.buildRunnerPlan,'function');
  }
  assert.deepEqual(listSources().filter(s=>s.id.endsWith('-legacy')).map(s=>s.id),[]);
});

test('easy-apply adapters build safe dry-run runner plans with framework env',()=>{
  const linkedin=getSource('linkedin').buildRunnerPlan({dryRun:true, query:'AI Engineer', limit:3, storeDir:'/tmp/jobs-store'});
  assert.match(linkedin.command,/linkedin_easy_apply_daily\.cjs$/);
  assert.equal(linkedin.env.DRY_RUN,'1');
  assert.equal(linkedin.env.MAX_SCAN,'3');
  assert.equal(linkedin.env.MAX_APPLY,'3');
  assert.equal(linkedin.env.SEARCHES,'AI Engineer');
  assert.equal(linkedin.env.HERMES_JOBS_STORE,'/tmp/jobs-store');

  const dice=getSource('dice').buildRunnerPlan({dryRun:true, query:'AI Engineer', limit:2, storeDir:'/tmp/jobs-store'});
  assert.match(dice.command,/dice_easy_apply_daily\.cjs$/);
  assert.equal(dice.env.DRY_RUN,'1');
  assert.equal(dice.env.MAX_SCAN,'2');
  assert.equal(dice.env.MAX_APPLY,'2');
  assert.equal(dice.env.SEARCHES,'AI Engineer');
  assert.equal(dice.env.HERMES_JOBS_STORE,'/tmp/jobs-store');
});

test('jobs rotate can include native easy-apply adapters as dry-run without legacy wording',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jobs-native-rotate-'));
  const r=spawnSync(process.execPath,['src/cli.cjs','jobs','rotate','--limit','0','--include-easy-apply','--dry-run-easy-apply','--query','AI Engineer','--store',dir],{cwd:__dirname+'/..',encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/easy-apply dry-run\tlinkedin\t/);
  assert.match(r.stdout,/easy-apply dry-run\tdice\t/);
  assert.doesNotMatch(r.stdout,/legacy dry-run/);
});

test('jobs apply dispatches approved LinkedIn and Dice jobs through native adapter dry-runs',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jobs-native-apply-'));
  const store=new JobStore(dir);
  store.enqueue({id:'li1',source:'linkedin',title:'AI Engineer',company:'Co',status:'queued',sourceUrl:'https://www.linkedin.com/jobs/view/123/',applicationMode:'easy-apply'});
  store.enqueue({id:'di1',source:'dice',title:'AI Engineer',company:'Co',status:'queued',sourceUrl:'https://www.dice.com/job-detail/abc',applicationMode:'easy-apply'});
  store.approve('li1');
  store.approve('di1');
  const r=spawnSync(process.execPath,['src/cli.cjs','jobs','apply','--approved','--dry-run','--store',dir],{cwd:__dirname+'/..',encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/native dry-run\tli1\tlinkedin/);
  assert.match(r.stdout,/native dry-run\tdi1\tdice/);
});
