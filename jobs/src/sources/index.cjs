const web3Career=require('./web3-career.cjs');
const weworkremotely=require('./weworkremotely.cjs');
const builtin=require('./builtin.cjs');
const remotive=require('./remotive.cjs');
const arbeitnow=require('./arbeitnow.cjs');
const jobicy=require('./jobicy.cjs');
const themuse=require('./themuse.cjs');
const valueserpAts=require('./valueserp-ats.cjs');
const himalayas=require('./himalayas.cjs');
const cryptocurrencyjobs=require('./cryptocurrencyjobs.cjs');
const laborx=require('./laborx.cjs');
const linkedin=require('./linkedin.cjs');
const dice=require('./dice.cjs');
const adapters=[web3Career,weworkremotely,builtin,remotive,arbeitnow,jobicy,themuse,valueserpAts,himalayas,cryptocurrencyjobs,laborx,linkedin,dice];
function listSources(){return adapters.map(a=>a.source)}
function getSource(id){ const a=adapters.find(x=>x.source.id===id); if(!a) throw new Error(`Unknown source: ${id}`); return a; }
module.exports={adapters,listSources,getSource};
