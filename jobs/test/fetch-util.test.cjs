const test=require('node:test'); const assert=require('node:assert/strict'); const {fetchText}=require('../src/util/fetch.cjs');

test('fetchText aborts when timeout is exceeded',async()=>{
  const original=global.fetch;
  global.fetch=(url,opts={})=>new Promise((resolve,reject)=>{
    opts.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));
  });
  try {
    await assert.rejects(fetchText('https://example.com/slow',{timeoutMs:1}),/timed out|aborted/i);
  } finally {
    global.fetch=original;
  }
});
