const web3Career=require('./web3-career.cjs');
const remoteok=require('./remoteok.cjs');
const weworkremotely=require('./weworkremotely.cjs');
const builtin=require('./builtin.cjs');
const remotive=require('./remotive.cjs');
const himalayas=require('./himalayas.cjs');
const cryptocurrencyjobs=require('./cryptocurrencyjobs.cjs');
const laborx=require('./laborx.cjs');
const linkedin=require('./linkedin.cjs');
const dice=require('./dice.cjs');
const adapters=[web3Career,remoteok,weworkremotely,builtin,remotive,himalayas,cryptocurrencyjobs,laborx,linkedin,dice];
function listSources(){return adapters.map(a=>a.source)}
function getSource(id){ const a=adapters.find(x=>x.source.id===id); if(!a) throw new Error(`Unknown source: ${id}`); return a; }
module.exports={adapters,listSources,getSource};
