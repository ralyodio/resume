const web3Career=require('./web3-career.cjs'); const remoteok=require('./remoteok.cjs'); const linkedin=require('./linkedin-legacy.cjs'); const dice=require('./dice-legacy.cjs');
const adapters=[web3Career,remoteok,linkedin,dice];
function listSources(){return adapters.map(a=>a.source)}
function getSource(id){ const a=adapters.find(x=>x.source.id===id); if(!a) throw new Error(`Unknown source: ${id}`); return a; }
module.exports={adapters,listSources,getSource};
