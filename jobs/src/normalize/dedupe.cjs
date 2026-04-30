const { canonicalUrl, cleanText } = require('../util/text.cjs');
const modeRank = {'easy-apply':5,'native-profile':4,'email':3,'external-ats':2,'marketplace-proposal':1,'unknown':0};
function dedupeKey(job){
  if (job.applyUrl) return `apply:${canonicalUrl(job.applyUrl)}`;
  if (job.id && job.source) return `source:${job.source}:${job.id}`;
  return `ct:${cleanText(job.company).toLowerCase()}|${cleanText(job.title).toLowerCase()}|${cleanText(job.location).toLowerCase()}`;
}
function isDuplicate(a,b){
  if (a.applyUrl && b.applyUrl && canonicalUrl(a.applyUrl)===canonicalUrl(b.applyUrl)) return true;
  if (a.id && b.id && a.source===b.source && a.id===b.id) return true;
  return cleanText(a.company).toLowerCase()===cleanText(b.company).toLowerCase() && cleanText(a.title).toLowerCase()===cleanText(b.title).toLowerCase() && cleanText(a.location).toLowerCase()===cleanText(b.location).toLowerCase();
}
function mergeJobs(a,b){
  const first = (modeRank[b.applicationMode]||0) > (modeRank[a.applicationMode]||0) ? b : a;
  const second = first===a ? b : a;
  return { ...second, ...first, salaryMin: first.salaryMin ?? second.salaryMin, salaryMax: first.salaryMax ?? second.salaryMax, currency: first.currency ?? second.currency, applyUrl: first.applyUrl || second.applyUrl, tags:[...new Set([...(a.tags||[]),...(b.tags||[])])], metadata:{...(a.metadata||{}), ...(b.metadata||{}), sources:[a.source,b.source]}, mergedFrom:[...(a.mergedFrom||[a.id]), ...(b.mergedFrom||[b.id])] };
}
function dedupeJobs(jobs=[]){ const out=[]; for (const job of jobs){ const idx=out.findIndex(j=>isDuplicate(j,job)); if(idx>=0) out[idx]=mergeJobs(out[idx], job); else out.push(job); } return out; }
module.exports={dedupeKey,isDuplicate,mergeJobs,dedupeJobs};
