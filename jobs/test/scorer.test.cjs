const test=require('node:test'); const assert=require('node:assert/strict'); const {scoreJob, requiresVideoApplication}=require('../src/score/scorer.cjs');
test('scores strong AI remote job for review on new source',()=>{ const r=scoreJob({source:'web3-career',title:'Founding AI LLM Node React Engineer',company:'Startup',remote:true,applicationMode:'native-profile',postedAt:new Date().toISOString(),descriptionText:'We build open-source devtools infrastructure using LLM agents Node React distributed systems. Salary $180k.'}); assert.ok(r.score>=85); assert.equal(r.decision,'queue-for-review'); });
test('skips clearance onsite unpaid roles',()=>{ const r=scoreJob({source:'web3-career',title:'Software Engineer',company:'Staffing Agency',remote:false,applicationMode:'external-ats',descriptionText:'Onsite unpaid clearance required relocation required commission-only.'}); assert.ok(r.score<50); assert.equal(r.decision,'skip'); assert.ok(r.riskFlags.length>=3); });

test('queues direct ATS technical roles from sparse Google snippets instead of burying viable forms',()=>{
  const r=scoreJob({
    source:'valueserp-ats',
    title:'Full Stack Engineer (Node.js)',
    company:'workable',
    remote:true,
    applicationMode:'external-ats',
    applyUrl:'https://apply.workable.com/lastcallmedia/j/45D033AF4C',
    descriptionText:'Remote Full Stack Engineer (Node.js).'
  });
  assert.equal(r.decision,'queue-for-review');
  assert.ok(r.score>=70);
  assert.ok(r.reasons.some(x=>/direct ATS/.test(x)));
  assert.equal(r.riskFlags.includes('vague description'), false);
});

test('does not queue non-technical business or marketing roles just because description mentions AI',()=>{
  for (const title of ['Marketing Manager','M&A Research Analyst','Executive Assistant / Marketing Assistant','AI Video Artist']) {
    const r=scoreJob({source:'remotive',title,company:'Acme',remote:true,applicationMode:'external-ats',postedAt:new Date().toISOString(),descriptionText:'Remote startup role using AI, Claude, React, APIs, infrastructure, salary $150k.'});
    assert.equal(r.decision,'skip', title);
    assert.ok(r.riskFlags.includes('non-engineering role'), title);
  }
});

test('skips jobs whose application requires recorded video',()=>{
  assert.equal(requiresVideoApplication('Please complete a one-way video interview as part of your application.'), true);
  assert.equal(requiresVideoApplication('Record and upload a short Loom video response before submitting.'), true);
  assert.equal(requiresVideoApplication('Remote team uses Zoom video meetings after hire.'), false);
  const r=scoreJob({source:'valueserp-ats',title:'Senior AI Engineer',company:'Acme',remote:true,applicationMode:'external-ats',postedAt:new Date().toISOString(),descriptionText:'Remote AI LLM platform role using Node React TypeScript. Salary $200k. Candidates must submit a video response with the application.'});
  assert.equal(r.decision,'skip');
  assert.ok(r.riskFlags.includes('video application required'));
});
