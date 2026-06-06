const test = require('node:test');
const assert = require('node:assert/strict');
const fedstack = require('../src/sources/fedstack.cjs');
const { getSource, listSources } = require('../src/sources/index.cjs');

const sample = {
  Id: 'a11Jw000006HxxtIAC',
  Name: 'J-00278',
  Job_Title__c: 'Full Stack AI Engineer',
  Job_Location__c: 'Remote',
  Allowable_Work_Authorization__c: 'US Citizen',
  Min_Degree_Required__c: "Bachelor's",
  Cohort_Category__c: 'Cloud/DevOps',
  Year_1_Salary__c: 60000,
  Year_2_Salary__c: 70000,
  LastModifiedDate: '2026-06-05T19:17:22.000+0000',
  Challenge_URL__c: 'https://coderbyte.com/sl-candidate?promo=smoothstack-wxvjt:technical-assessment-srjraio&invb=userzfobehm7',
  Job_Details_JSON__c: JSON.stringify({
    sections: [[
      { contentType: 'PARAGRAPH', title: 'A career-defining opportunity', contents: ['Fedstack builds secure applications with AI-driven development.'] },
      { contentType: 'LIST', title: 'What you will do', contents: ['Build full stack AI systems', 'Work with federal customers'] },
    ]]
  })
};

test('Fedstack source is registered', () => {
  assert.equal(getSource('fedstack').source.name, 'Fedstack ATS');
  assert.ok(listSources().some(s => s.id === 'fedstack'));
});

test('Fedstack rows normalize into remote AI jobs', () => {
  const rows = fedstack.normalizeRows([sample], { query: 'ai engineer', remoteOnly: true });
  assert.equal(rows.length, 1);
  const job = rows[0];
  assert.equal(job.id, 'fedstack-a11Jw000006HxxtIAC');
  assert.equal(job.sourceUrl, 'https://jobs.fedstack.com/jobs/a11Jw000006HxxtIAC');
  assert.equal(job.applyUrl, 'https://jobs.fedstack.com/jobs/a11Jw000006HxxtIAC');
  assert.equal(job.title, 'Full Stack AI Engineer');
  assert.equal(job.company, 'Fedstack');
  assert.equal(job.remote, true);
  assert.equal(job.remoteRegion, 'US');
  assert.equal(job.salaryMin, 60000);
  assert.equal(job.salaryMax, 70000);
  assert.equal(job.metadata.ats, 'fedstack');
  assert.equal(job.metadata.workAuthorization, 'US Citizen');
  assert.match(job.descriptionText, /secure applications/);
});

test('Fedstack source honors query and remote filters', () => {
  assert.equal(fedstack.normalizeRows([sample], { query: 'rust compiler', remoteOnly: true }).length, 0);
  assert.equal(fedstack.normalizeRows([{ ...sample, Job_Location__c: 'Onsite' }], { query: 'ai engineer', remoteOnly: true }).length, 0);
});
