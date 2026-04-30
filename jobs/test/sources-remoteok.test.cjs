const test=require('node:test'); const assert=require('node:assert/strict'); const remoteok=require('../src/sources/remoteok.cjs'); const {assertSourceAdapter}=require('../src/sources/interface.cjs');
test('remoteok adapter contract',()=>assert.equal(assertSourceAdapter(remoteok),true));
test('remoteok query matching uses all terms and strips html helper path',()=>{ const r={position:'Senior AI Engineer',company:'Acme',tags:['node'],description:'<p>LLM platform</p>'}; assert.equal(remoteok.matchesQuery(r,'AI Engineer'),true); assert.equal(remoteok.matchesQuery(r,'Web3 Engineer'),false); });
