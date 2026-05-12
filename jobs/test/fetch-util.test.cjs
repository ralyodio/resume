const test=require('node:test');
const assert=require('node:assert/strict');
const {fetchText,fetchJson}=require('../src/util/fetch.cjs');

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

test('fetchText passes a proxy dispatcher when PROXY_URL is set',async()=>{
  const originalFetch=global.fetch;
  const oldProxy=process.env.PROXY_URL;
  let seen;
  global.fetch=async(url,opts={})=>{
    seen=opts;
    return { ok:true, text:async()=> 'ok' };
  };
  process.env.PROXY_URL='http://user:pass@proxy.example:8080';
  try {
    const out=await fetchText('https://example.com/data');
    assert.equal(out,'ok');
    assert.ok(seen.dispatcher, 'expected fetch dispatcher when proxy is configured');
  } finally {
    global.fetch=originalFetch;
    if (oldProxy === undefined) delete process.env.PROXY_URL; else process.env.PROXY_URL=oldProxy;
  }
});

test('fetchJson passes a proxy dispatcher when HTTPS_PROXY is set',async()=>{
  const originalFetch=global.fetch;
  const oldProxy=process.env.HTTPS_PROXY;
  let seen;
  global.fetch=async(url,opts={})=>{
    seen=opts;
    return { ok:true, json:async()=> ({ok:true}) };
  };
  process.env.HTTPS_PROXY='http://user:pass@proxy.example:8080';
  try {
    const out=await fetchJson('https://example.com/data.json');
    assert.deepEqual(out,{ok:true});
    assert.ok(seen.dispatcher, 'expected fetch dispatcher when proxy is configured');
  } finally {
    global.fetch=originalFetch;
    if (oldProxy === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY=oldProxy;
  }
});
