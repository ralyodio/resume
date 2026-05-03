const test=require('node:test'); const assert=require('node:assert/strict'); const {scoreJob}=require('../src/score/scorer.cjs');
test('scores strong AI remote job for review on new source',()=>{ const r=scoreJob({source:'web3-career',title:'Founding AI LLM Node React Engineer',company:'Startup',remote:true,applicationMode:'native-profile',postedAt:new Date().toISOString(),descriptionText:'We build open-source devtools infrastructure using LLM agents Node React distributed systems. Salary $180k.'}); assert.ok(r.score>=85); assert.equal(r.decision,'queue-for-review'); });
test('skips clearance onsite unpaid roles',()=>{ const r=scoreJob({source:'web3-career',title:'Software Engineer',company:'Staffing Agency',remote:false,applicationMode:'external-ats',descriptionText:'Onsite unpaid clearance required relocation required commission-only.'}); assert.ok(r.score<50); assert.equal(r.decision,'skip'); assert.ok(r.riskFlags.length>=3); });

test('does not queue non-technical business or marketing roles just because description mentions AI',()=>{
  for (const title of ['Marketing Manager','M&A Research Analyst','Executive Assistant / Marketing Assistant','AI Video Artist']) {
    const r=scoreJob({source:'remotive',title,company:'Acme',remote:true,applicationMode:'external-ats',postedAt:new Date().toISOString(),descriptionText:'Remote startup role using AI, Claude, React, APIs, infrastructure, salary $150k.'});
    assert.equal(r.decision,'skip', title);
    assert.ok(r.riskFlags.includes('non-engineering role'), title);
  }
});
