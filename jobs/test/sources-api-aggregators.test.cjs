const test=require('node:test');
const assert=require('node:assert/strict');
const { assertSourceAdapter }=require('../src/sources/interface.cjs');
const remotive=require('../src/sources/remotive.cjs');
const arbeitnow=require('../src/sources/arbeitnow.cjs');
const jobicy=require('../src/sources/jobicy.cjs');
const themuse=require('../src/sources/themuse.cjs');
const { findAtsUrl }=require('../src/sources/api-board-factory.cjs');

for (const adapter of [remotive, arbeitnow, jobicy, themuse]) {
  test(`${adapter.source.id} API adapter contract`,()=>{
    assert.equal(assertSourceAdapter(adapter),true);
    assert.equal(adapter.source.reviewOnly,true);
    assert.equal(adapter.source.supportsNativeApply,false);
  });
}

test('API adapters normalize rows and discover ATS URLs from payload text',()=>{
  const html='Remote AI LLM role <a href="https://boards.greenhouse.io/acme/jobs/123">Apply</a>';
  const rows=remotive.normalizeRows({jobs:[{id:1,url:'https://remotive.com/remote-jobs/acme-ai',title:'Senior AI Engineer',company_name:'Acme',candidate_required_location:'USA',description:html,publication_date:new Date().toISOString(),tags:['ai','node']} ]},{query:'AI Engineer',limit:1});
  assert.equal(rows.length,1);
  assert.equal(rows[0].source,'remotive');
  assert.equal(rows[0].applicationMode,'external-ats');
  assert.equal(rows[0].applyUrl,'https://boards.greenhouse.io/acme/jobs/123');
});

test('API adapters filter by query, since, and remote-only',()=>{
  const now=Math.floor(Date.now()/1000);
  const old=Math.floor((Date.now()-30*86400000)/1000);
  const rows=arbeitnow.normalizeRows({data:[
    {slug:'good',url:'https://jobs.lever.co/acme/1',title:'AI Engineer',company_name:'Acme',location:'Remote',remote:true,description:'LLM platform',created_at:now},
    {slug:'old',url:'https://jobs.lever.co/acme/2',title:'AI Engineer',company_name:'Acme',location:'Remote',remote:true,description:'LLM platform',created_at:old},
    {slug:'badq',url:'https://jobs.lever.co/acme/3',title:'Sales Manager',company_name:'Acme',location:'Remote',remote:true,description:'sales',created_at:now},
    {slug:'onsite',url:'https://jobs.lever.co/acme/4',title:'AI Engineer',company_name:'Acme',location:'Berlin',remote:false,description:'LLM platform',created_at:now}
  ]},{query:'AI Engineer',since:'7d',remoteOnly:true,limit:10});
  assert.deepEqual(rows.map(r=>r.id),['arbeitnow-good']);
});

test('jobicy and themuse normalize documented API shapes',()=>{
  const j=jobicy.normalizeRows({jobs:[{id:7,url:'https://jobs.ashbyhq.com/acme/abc',jobTitle:'Full Stack AI Developer',companyName:'Acme',jobGeo:'USA',jobDescription:'React Node LLM',pubDate:new Date().toISOString(),jobTags:['react']} ]},{query:'AI Developer',limit:1});
  assert.equal(j.length,1);
  assert.equal(j[0].applyUrl,'https://jobs.ashbyhq.com/acme/abc');
  const m=themuse.normalizeRows({results:[{id:8,name:'Machine Learning Engineer',company:{name:'MuseCo'},locations:[{name:'Remote'}],refs:{landing_page:'https://jobs.smartrecruiters.com/MuseCo/8'},contents:'ML platform',publication_date:new Date().toISOString(),categories:[{name:'Computer and IT'}]}]},{query:'Machine Learning',limit:1});
  assert.equal(m.length,1);
  assert.equal(m[0].applyUrl,'https://jobs.smartrecruiters.com/MuseCo/8');
});

test('findAtsUrl ignores generic aggregator links when no ATS URL is present',()=>{
  assert.equal(findAtsUrl('https://example.com/jobs/greenhouse-role'), '');
  assert.equal(findAtsUrl('apply at https://jobs.lever.co/acme/123'), 'https://jobs.lever.co/acme/123');
});
