const test=require('node:test');
const assert=require('node:assert/strict');
const { assertSourceAdapter }=require('../src/sources/interface.cjs');
const { listSources, getSource }=require('../src/sources/index.cjs');

const expected=['weworkremotely','builtin','remotive','arbeitnow','jobicy','themuse','himalayas','cryptocurrencyjobs','laborx'];

test('expanded remote-only sources are registered and review-only',()=>{
  const ids=listSources().map(s=>s.id);
  for (const id of expected) {
    assert.ok(ids.includes(id), `${id} not listed`);
    const adapter=getSource(id);
    assert.equal(assertSourceAdapter(adapter), true);
    assert.equal(adapter.source.supportsRemoteFilter, true);
    assert.equal(adapter.source.reviewOnly, true);
  }
});

test('expanded sources build remote-filtered urls',()=>{
  const urls=Object.fromEntries(expected.map(id=>[id,getSource(id).buildSearchUrl({query:'AI Engineer', remoteOnly:true})]));
  assert.match(urls.weworkremotely,/weworkremotely\.com/);
  assert.match(urls.builtin,/builtin\.com\/jobs\/remote/);
  assert.match(urls.remotive,/remotive\.com\/api\/remote-jobs/);
  assert.match(urls.arbeitnow,/arbeitnow\.com\/api\/job-board-api/);
  assert.match(urls.jobicy,/jobicy\.com\/api\/v2\/remote-jobs/);
  assert.match(urls.themuse,/themuse\.com\/api\/public\/jobs/);
  assert.match(urls.himalayas,/himalayas\.app\/jobs\/software-engineering/);
  assert.match(urls.cryptocurrencyjobs,/cryptocurrencyjobs\.co\/remote/);
  assert.match(urls.laborx,/laborx\.com\/jobs/);
});

test('laborx marketplace proposals are review-only and not native apply',()=>{
  const laborx=getSource('laborx');
  assert.equal(laborx.source.supportsNativeApply,false);
  const rows=laborx.parseJobsFromHtml('<article><a href="/jobs/build-web3-app">Build Web3 App</a></article>',{query:'Web3',limit:1});
  assert.equal(rows.length,1);
  assert.equal(rows[0].applicationMode,'marketplace-proposal');
});

test('html adapters parse a simple fixture into normalized review-only records',()=>{
  const html='<article><a href="/remote-jobs/senior-ai-engineer">Senior AI Engineer</a><h3>Acme AI</h3><p>Remote Node React LLM platform role</p></article>';
  const rows=getSource('builtin').parseJobsFromHtml(html,{query:'AI Engineer',limit:1});
  assert.equal(rows.length,1);
  assert.equal(rows[0].source,'builtin');
  assert.equal(rows[0].remote,true);
  assert.equal(rows[0].status,'new');
});
