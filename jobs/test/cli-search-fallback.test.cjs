const test=require('node:test');
const assert=require('node:assert/strict');
const { searchSources } = require('../src/cli.cjs');

test('searchSources falls back to alternate review sources when ValueSERP returns 402', async()=>{
  const oldFallback=process.env.HERMES_VALUESERP_FALLBACK_SOURCES;
  process.env.HERMES_VALUESERP_FALLBACK_SOURCES='remotive,themuse';
  const saved=[];
  const warnings=[];
  const store={ upsert(job){ saved.push(job); } };
  const args={ query:'claude', since:'7d', limit:5 };
  const sourceMap={
    'valueserp-ats': { searchJobs: async()=>{ throw new Error('Fetch failed 402 Payment Required: https://api.valueserp.com/search?...'); } },
    remotive: { searchJobs: async()=>[{ source:'remotive', title:'Claude Engineer', company:'Acme', sourceUrl:'https://example.com/remotive' }] },
    themuse: { searchJobs: async()=>[] }
  };
  const listSources=()=>[
    {id:'valueserp-ats', legacyScript:false, supportsNativeApply:false},
    {id:'remotive', legacyScript:false, supportsNativeApply:false},
    {id:'themuse', legacyScript:false, supportsNativeApply:false},
    {id:'linkedin', legacyScript:false, supportsNativeApply:true}
  ];
  try {
    const count=await searchSources({
      store,
      args,
      sourceIds:['valueserp-ats'],
      deps:{
        getSource:(id)=>sourceMap[id],
        listSources,
        assertSourceAdapter:()=>true,
        log:(line)=>saved.push({log:line}),
        warn:(line)=>warnings.push(line)
      }
    });
    assert.equal(count,1);
    assert.equal(saved.filter(x=>x && x.source).length,1);
    assert.match(warnings.join('\n'),/source failed\tvalueserp-ats\t.*402 Payment Required/);
    assert.match(warnings.join('\n'),/source fallback\tvalueserp-ats\tremotive,themuse/);
  } finally {
    if (oldFallback === undefined) delete process.env.HERMES_VALUESERP_FALLBACK_SOURCES;
    else process.env.HERMES_VALUESERP_FALLBACK_SOURCES=oldFallback;
  }
});

test('searchSources does not fall back for non-billing ValueSERP errors', async()=>{
  const oldFallback=process.env.HERMES_VALUESERP_FALLBACK_SOURCES;
  process.env.HERMES_VALUESERP_FALLBACK_SOURCES='remotive';
  const warnings=[];
  const store={ upsert(){} };
  try {
    const count=await searchSources({
      store,
      args:{ query:'claude', since:'7d', limit:5 },
      sourceIds:['valueserp-ats'],
      deps:{
        getSource:()=>({ searchJobs: async()=>{ throw new Error('Fetch failed 500 Internal Server Error'); } }),
        listSources:()=>[{id:'valueserp-ats', legacyScript:false, supportsNativeApply:false},{id:'remotive', legacyScript:false, supportsNativeApply:false}],
        assertSourceAdapter:()=>true,
        warn:(line)=>warnings.push(line)
      }
    });
    assert.equal(count,0);
    assert.doesNotMatch(warnings.join('\n'),/source fallback/);
  } finally {
    if (oldFallback === undefined) delete process.env.HERMES_VALUESERP_FALLBACK_SOURCES;
    else process.env.HERMES_VALUESERP_FALLBACK_SOURCES=oldFallback;
  }
});
