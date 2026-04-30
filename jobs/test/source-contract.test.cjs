const test=require('node:test'); const assert=require('node:assert/strict'); const {assertSourceAdapter}=require('../src/sources/interface.cjs'); const web3=require('../src/sources/web3-career.cjs');
test('valid adapter passes',()=>assert.equal(assertSourceAdapter(web3),true));
test('invalid adapter fails',()=>assert.throws(()=>assertSourceAdapter({source:{id:'x'}}),/missing source.name/));
