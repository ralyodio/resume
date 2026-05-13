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
  const oldLocation=process.env.HERMES_JOB_SEARCH_LOCATION;
  process.env.HERMES_JOB_SEARCH_LOCATION='Los Gatos, California, United States';
  const oldUsOnly=process.env.HERMES_JOB_SEARCH_US_ONLY;
  delete process.env.HERMES_JOB_SEARCH_US_ONLY;
  const url=valueserp.buildValueSerpUrl({apiKey:'x',host:'boards.greenhouse.io',query:'claude',page:2,remoteOnly:false,usaOnly:false});
  if(oldLocation === undefined) delete process.env.HERMES_JOB_SEARCH_LOCATION; else process.env.HERMES_JOB_SEARCH_LOCATION=oldLocation;
  if(oldUsOnly === undefined) delete process.env.HERMES_JOB_SEARCH_US_ONLY; else process.env.HERMES_JOB_SEARCH_US_ONLY=oldUsOnly;
  const u=new URL(url);
  assert.equal(u.origin+u.pathname,'https://api.valueserp.com/search');
  assert.equal(u.searchParams.get('api_key'),'x');
  assert.equal(u.searchParams.get('q'),'site:boards.greenhouse.io "claude"');
  assert.equal(u.searchParams.get('location'),'Los Gatos, California, United States');
  assert.equal(u.searchParams.get('gl'),'us');
  assert.equal(u.searchParams.get('hl'),'en');
  assert.equal(u.searchParams.get('google_domain'),'google.com');
  assert.equal(u.searchParams.get('page'),'2');
});

test('remote-only searches add remote term and all ATS targets are covered',()=>{
  assert.deepEqual(valueserp.ATS_TARGETS.map(t=>t.host),[
    'jobs.lever.co','boards.greenhouse.io','myworkdayjobs.com','jobs.smartrecruiters.com','bamboohr.com','applytojob.com','breezy.hr','icims.com','jobs.jobvite.com','recruiterbox.com','jobs.ashbyhq.com','apply.workable.com','ats.rippling.com',null
  ]);
  assert.equal(valueserp.buildGoogleQuery({host:'jobs.lever.co',query:'claude',remoteOnly:true}),'site:jobs.lever.co "claude" remote');
});

test('usa-only searches add US terms and reject foreign-only remote roles',()=>{
  assert.equal(valueserp.buildGoogleQuery({host:'jobs.lever.co',query:'claude',remoteOnly:true,usaOnly:true}),'site:jobs.lever.co "claude" remote ("United States" OR USA OR "U.S." OR "Remote US" OR "Remote - US")');
  const foreign=valueserp.resultToJob({
    position:1,
    title:'Senior Claude Engineer - Acme',
    link:'https://jobs.lever.co/acme/123',
    displayed_link:'https://jobs.lever.co/acme/123',
    snippet:'Remote role based in Europe, UK, Germany, or India.'
  },{target:{id:'lever',host:'jobs.lever.co'},query:'claude',remoteOnly:true,usaOnly:true});
  assert.equal(foreign,null);
  const usa=valueserp.resultToJob({
    position:1,
    title:'Senior Claude Engineer - Acme',
    link:'https://jobs.lever.co/acme/123',
    displayed_link:'https://jobs.lever.co/acme/123',
    snippet:'Remote role open to candidates in the United States.'
  },{target:{id:'lever',host:'jobs.lever.co'},query:'claude',remoteOnly:true,usaOnly:true});
  assert.equal(usa.remoteRegion,'US');
});

test('normalizes strict ATS organic results',()=>{
  const job=valueserp.resultToJob({
    position:1,
    title:'Senior Claude Engineer - Acme',
    link:'https://boards.greenhouse.io/acme/jobs/123?gh_src=x',
    displayed_link:'https://boards.greenhouse.io/acme/jobs/123',
    snippet:'Remote role building LLM apps with Claude and Node.js.'
  },{target:{id:'greenhouse',host:'boards.greenhouse.io'},query:'claude',usaOnly:false});
  assert.equal(job.source,'valueserp-ats');
  assert.equal(job.applicationMode,'external-ats');
  assert.equal(job.applyUrl,'https://boards.greenhouse.io/acme/jobs/123?gh_src=x');
  assert.equal(job.remote,true);
  assert.equal(job.metadata.ats,'greenhouse');
  assert.equal(job.company,'Acme');
});

test('extracts the actual employer instead of the ATS platform name',()=>{
  const cases=[
    [{id:'breezy',host:'breezy.hr'}, 'https://cardahealth.breezy.hr/p/95e9f2e27554-full-stack-ai-engineer', 'Full Stack AI Engineer - Carda Health', 'Carda Health'],
    [{id:'greenhouse',host:'boards.greenhouse.io'}, 'https://boards.greenhouse.io/gitlab/jobs/8517564002', 'Job Application for AI Engineer at GitLab', 'GitLab'],
    [{id:'lever',host:'jobs.lever.co'}, 'https://jobs.lever.co/distro/24605ee3-5747-4fbf-820b-c83913f64755', 'SOFTWARE DEVELOPER - Distro', 'Distro'],
    [{id:'ashby',host:'jobs.ashbyhq.com'}, 'https://jobs.ashbyhq.com/sweedpos.com/b2335d86-ace5-4773-acf4-3d5c89c2a008', 'AI Engineer @ Sweed', 'Sweed'],
    [{id:'rippling',host:'ats.rippling.com'}, 'https://ats.rippling.com/subquadratic/jobs/c1a5017a-5b61-4c8f-a301-cae72eeb5459', 'Founding Developer Advocate - Subquadratic', 'Subquadratic']
  ];
  for (const [target,link,title,expected] of cases) {
    const job=valueserp.resultToJob({position:1,title,link,displayed_link:link,snippet:'Remote software engineering role.'},{target,query:'AI Engineer',remoteOnly:true,usaOnly:false});
    assert.equal(job.company, expected, link);
    assert.notEqual(job.company, target.id, link);
  }
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

test('rejects ATS board roots, search pages, and share links that are not job applications',()=>{
  const cases=[
    ['lever','jobs.lever.co','https://jobs.lever.co/turgon-ai'],
    ['greenhouse','boards.greenhouse.io','https://boards.greenhouse.io/affinity'],
    ['workday','myworkdayjobs.com','https://workday.wd5.myworkdayjobs.com/Workday/?source=Careers_Website'],
    ['applytojob','applytojob.com','https://vyro.applytojob.com/app/share/3T7daN1dcx'],
    ['breezy','breezy.hr','https://nexthire.breezy.hr'],
    ['jobvite','jobs.jobvite.com','https://jobs.jobvite.com/pulsepoint/search?c=Technology&p=0'],
    ['workable','apply.workable.com','https://apply.workable.com/opendatajobs'],
    ['ashby','jobs.ashbyhq.com','https://jobs.ashbyhq.com/OurRitual'],
    ['rippling','ats.rippling.com','https://ats.rippling.com/subquadratic/jobs'],
    ['bamboohr','bamboohr.com','https://www.bamboohr.com/job-description/software-development-intern']
  ];
  for (const [id,host,link] of cases) {
    const job=valueserp.resultToJob({title:'Remote AI Engineer',link,displayed_link:link,snippet:'Remote AI software engineer role.'},{target:{id,host},query:'AI Engineer',remoteOnly:true});
    assert.equal(job,null, link);
  }
});

test('email target can normalize mailto application results from snippets',()=>{
  const job=valueserp.resultToJob({
    position:1,
    title:'Remote Software Engineer',
    link:'https://example-company.com/jobs/remote-software-engineer',
    displayed_link:'https://example-company.com/jobs/remote-software-engineer',
    snippet:'Remote software engineer. Email your resume to jobs@example-company.com.'
  },{target:{id:'email',host:null},query:'("mailto:" OR "email your resume") "remote" "software engineer"',usaOnly:false});
  assert.equal(job.applicationMode,'email');
  assert.equal(job.applyUrl,'mailto:jobs@example-company.com');
});

test('organicResults returns empty when ValueSERP has no organic results',()=>{
  assert.deepEqual(valueserp.organicResults({}),[]);
  assert.deepEqual(valueserp.organicResults({organic_results:[]}),[]);
});
