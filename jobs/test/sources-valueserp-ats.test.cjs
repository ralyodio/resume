const test=require('node:test');
const assert=require('node:assert/strict');
const { assertSourceAdapter }=require('../src/sources/interface.cjs');
const valueserp=require('../src/sources/valueserp-ats.cjs');
const { listSources, getSource }=require('../src/sources/index.cjs');

test('valueserp ats source is registered and review-only',()=>{
  assert.ok(listSources().some(s=>s.id==='valueserp-ats'));
  assert.equal(assertSourceAdapter(getSource('valueserp-ats')), true);
  assert.equal(getSource('valueserp-ats').source.reviewOnly, true);
});

test('builds ValueSERP URL with site query, location, and page',()=>{
  const url=valueserp.buildValueSerpUrl({apiKey:'x',host:'boards.greenhouse.io',query:'claude',page:2,remoteOnly:false});
  const u=new URL(url);
  assert.equal(u.origin+u.pathname,'https://api.valueserp.com/search');
  assert.equal(u.searchParams.get('api_key'),'x');
  assert.equal(u.searchParams.get('q'),'site:boards.greenhouse.io "claude"');
  assert.equal(u.searchParams.get('location'),'98146, Washington, United States');
  assert.equal(u.searchParams.get('gl'),'us');
  assert.equal(u.searchParams.get('hl'),'en');
  assert.equal(u.searchParams.get('google_domain'),'google.com');
  assert.equal(u.searchParams.get('page'),'2');
});

test('remote-only searches add remote term and all ATS targets are covered',()=>{
  assert.deepEqual(valueserp.ATS_TARGETS.map(t=>t.host),[
    'jobs.lever.co','boards.greenhouse.io','myworkdayjobs.com','jobs.smartrecruiters.com','bamboohr.com','applytojob.com','breezy.hr','icims.com','jobs.jobvite.com','recruiterbox.com','jobs.ashbyhq.com','apply.workable.com',null
  ]);
  assert.equal(valueserp.buildGoogleQuery({host:'jobs.lever.co',query:'claude',remoteOnly:true}),'site:jobs.lever.co "claude" remote');
});

test('normalizes strict ATS organic results',()=>{
  const job=valueserp.resultToJob({
    position:1,
    title:'Senior Claude Engineer - Acme',
    link:'https://boards.greenhouse.io/acme/jobs/123?gh_src=x',
    displayed_link:'https://boards.greenhouse.io/acme/jobs/123',
    snippet:'Remote role building LLM apps with Claude and Node.js.'
  },{target:{id:'greenhouse',host:'boards.greenhouse.io'},query:'claude'});
  assert.equal(job.source,'valueserp-ats');
  assert.equal(job.applicationMode,'external-ats');
  assert.equal(job.applyUrl,'https://boards.greenhouse.io/acme/jobs/123?gh_src=x');
  assert.equal(job.remote,true);
  assert.equal(job.metadata.ats,'greenhouse');
});

test('rejects generic hosts even if path mentions greenhouse',()=>{
  const job=valueserp.resultToJob({title:'Greenhouse role',link:'https://example.com/jobs/greenhouse-role',snippet:'Remote Claude'}, {target:{id:'greenhouse',host:'boards.greenhouse.io'},query:'claude'});
  assert.equal(job,null);
});

test('remote-only normalization rejects results without a remote signal',()=>{
  const job=valueserp.resultToJob({
    position:1,
    title:'Senior Claude Engineer - Acme',
    link:'https://boards.greenhouse.io/acme/jobs/123?gh_src=x',
    displayed_link:'https://boards.greenhouse.io/acme/jobs/123',
    snippet:'Onsite role building LLM apps with Claude and Node.js.'
  },{target:{id:'greenhouse',host:'boards.greenhouse.io'},query:'claude',remoteOnly:true});
  assert.equal(job,null);
});

test('email target can normalize mailto application results from snippets',()=>{
  const job=valueserp.resultToJob({
    position:1,
    title:'Remote Software Engineer',
    link:'https://example-company.com/jobs/remote-software-engineer',
    displayed_link:'https://example-company.com/jobs/remote-software-engineer',
    snippet:'Remote software engineer. Email your resume to jobs@example-company.com.'
  },{target:{id:'email',host:null},query:'("mailto:" OR "email your resume") "remote" "software engineer"'});
  assert.equal(job.applicationMode,'email');
  assert.equal(job.applyUrl,'mailto:jobs@example-company.com');
});

test('organicResults returns empty when ValueSERP has no organic results',()=>{
  assert.deepEqual(valueserp.organicResults({}),[]);
  assert.deepEqual(valueserp.organicResults({organic_results:[]}),[]);
});
