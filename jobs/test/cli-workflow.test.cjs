const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {spawnSync}=require('node:child_process'); const {JobStore}=require('../src/queue/store.cjs');
test('cli can approve queued jobs and dry-run external apply reports auto-apply status',()=>{ const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jobs-cli-')); const s=new JobStore(dir); s.enqueue({id:'j1',source:'remoteok',title:'AI Engineer',company:'Co',status:'queued',sourceUrl:'https://example.com/job',applyUrl:'https://example.com/apply'}); let r=spawnSync(process.execPath,['src/cli.cjs','jobs','approve','--id','j1','--store',dir],{cwd:__dirname+'/..',encoding:'utf8'}); assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/approved/); r=spawnSync(process.execPath,['src/cli.cjs','jobs','apply','--approved','--store',dir],{cwd:__dirname+'/..',encoding:'utf8'}); assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/auto-apply\tprepared\tj1\tunknown/); assert.equal(new JobStore(dir).get('j1').status,'approved'); });

test('jobs queue respects scorer decisions and never queues skip decisions',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jobs-cli-'));
  const s=new JobStore(dir);
  s.upsert({id:'q1',source:'remoteok',title:'AI Engineer',company:'Co',location:'Remote',status:'scored',score:90,decision:'queue-for-review'});
  s.upsert({id:'q2',source:'linkedin',title:'AI Engineer',company:'Co',location:'Remote',status:'scored',score:95,decision:'auto-apply-eligible'});
  s.upsert({id:'skip1',source:'remoteok',title:'AI Engineer',company:'Co',location:'Remote',status:'scored',score:99,decision:'skip',riskFlags:['scam language']});
  s.upsert({id:'save1',source:'remoteok',title:'AI Engineer',company:'Co',location:'Remote',status:'scored',score:75,decision:'save-only'});
  const r=spawnSync(process.execPath,['src/cli.cjs','jobs','queue','--min-score','70','--store',dir],{cwd:__dirname+'/..',encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const next=new JobStore(dir);
  assert.equal(next.get('q1').status,'queued');
  assert.equal(next.get('q2').status,'queued');
  assert.equal(next.get('skip1').status,'scored');
  assert.equal(next.get('save1').status,'scored');
});
