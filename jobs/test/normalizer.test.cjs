const test=require('node:test'); const assert=require('node:assert/strict'); const {normalizeJob}=require('../src/normalize/job.cjs');
test('normalizes required fields and metadata',()=>{ const j=normalizeJob({source:'x',sourceUrl:'https://e.com?a=1&utm_source=x',title:' Dev ',company:' Co ',remote:true,applicationMode:'external-ats',foo:'bar'}); assert.equal(j.status,'new'); assert.equal(j.metadata.foo,'bar'); assert.ok(j.discoveredAt.endsWith('Z')); });
test('missing required fields throw useful error',()=>assert.throws(()=>normalizeJob({source:'x'}),/missing required field/));
