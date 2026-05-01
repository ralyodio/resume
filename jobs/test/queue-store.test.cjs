const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {JobStore}=require('../src/queue/store.cjs'); const {readAuditEvents}=require('../src/audit/audit-log.cjs');
test('queue lifecycle writes audit events',()=>{ const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jobs-')); const s=new JobStore(dir); s.enqueue({id:'j1',source:'x',title:'T',company:'C',status:'new'}); s.approve('j1'); s.markApplied('j1'); assert.equal(s.get('j1').status,'applied'); assert.ok(readAuditEvents(dir).length>=3); });

test('store upsert dedupes search ingestion across apply url and title/company/location',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jobs-dedupe-'));
  const s=new JobStore(dir);
  s.upsert({id:'a1',source:'alpha',title:'Senior AI Engineer',company:'Acme',location:'Remote US',status:'new',applyUrl:'https://jobs.example.com/apply/123?utm=alpha',tags:['ai'],applicationMode:'external-ats'},'search-result');
  s.upsert({id:'b9',source:'beta',title:'Senior AI Engineer',company:'Acme',location:'Remote US',status:'new',applyUrl:'https://jobs.example.com/apply/123?utm=beta',tags:['web3'],applicationMode:'unknown'},'search-result');
  assert.equal(s.all().length,1);
  const row=s.all()[0];
  assert.equal(row.id,'a1');
  assert.deepEqual(row.tags.sort(),['ai','web3']);
  assert.ok(row.mergedFrom.includes('a1'));
  assert.ok(row.mergedFrom.includes('b9'));

  s.upsert({id:'c7',source:'gamma',title:'Senior AI Engineer',company:'Acme',location:'Remote US',status:'new',tags:['remote'],applicationMode:'unknown'},'search-result');
  assert.equal(s.all().length,1);
  assert.deepEqual(s.all()[0].tags.sort(),['ai','remote','web3']);
});
