const test=require('node:test');
const assert=require('node:assert/strict');
const { generateCoverLetter, employerName, normalizeCoverLetterText }=require('../src/cover/generate-cover-letter.cjs');

test('cover letter never greets an ATS platform as the employer',()=>{
  for (const company of ['breezy','Greenhouse','Lever','Ashby','Workable']) {
    const letter=generateCoverLetter({title:'AI Engineer',company});
    assert.match(letter,/^Hi hiring team,/);
    assert.doesNotMatch(letter,new RegExp(`Hi ${company} team,`,'i'));
  }
});

test('cover letter uses real employer names when available',()=>{
  const letter=generateCoverLetter({title:'AI Engineer',company:'GitLab'});
  assert.match(letter,/^Hi GitLab team,/);
});

test('external ATS cover letters require employer verified from job page',()=>{
  const unverified=generateCoverLetter({source:'valueserp-ats',applicationMode:'external-ats',title:'Staff Product Security Engineer',company:'Greenlight',metadata:{ats:'lever'}});
  assert.match(unverified,/^Hi hiring team,/);
  assert.doesNotMatch(unverified,/Hi Greenlight team,/);
  const verified=generateCoverLetter({source:'valueserp-ats',applicationMode:'external-ats',title:'AI Engineer',company:'GitLab',metadata:{ats:'greenhouse',employerVerifiedFromJobPage:true}});
  assert.match(verified,/^Hi GitLab team,/);
});

test('cover letter rejects generic employer labels and preserves paragraph breaks',()=>{
  for (const company of ['Company Website','company website','Company','Website','Careers']) {
    assert.equal(employerName({company, metadata:{employerVerifiedFromJobPage:true}, applicationMode:'external-ats'}), 'hiring');
    const letter=generateCoverLetter({source:'valueserp-ats',applicationMode:'external-ats',title:'Software Engineering Intern',company,metadata:{ats:'greenhouse',employerVerifiedFromJobPage:true}});
    assert.match(letter,/^Hi hiring team,/);
    assert.doesNotMatch(letter,/Hi Company Website team,/i);
    assert.match(letter,/Hi hiring team,\n\nI’m Anthony Ettinger/);
    assert.match(letter,/\n\nBest,\nAnthony Ettinger$/);
  }
});

test('cover letter normalizer restores paragraph breaks from collapsed one-line text',()=>{
  const collapsed='Hi hiring team, I’m Anthony Ettinger, a senior full-stack software engineer and founder with 20+ years building production web apps. At Profullstack I’ve shipped client and internal products spanning security automation. I’d welcome a conversation about how I can help your team build and ship high-quality software for this role. Best, Anthony Ettinger';
  const formatted=normalizeCoverLetterText(collapsed);
  assert.equal(formatted.split('\n\n').length, 5);
  assert.match(formatted,/^Hi hiring team,\n\nI’m Anthony Ettinger/);
  assert.match(formatted,/\n\nAt Profullstack/);
  assert.match(formatted,/\n\nI’d welcome/);
  assert.match(formatted,/\n\nBest,\nAnthony Ettinger$/);
});
