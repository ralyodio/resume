const { appendAuditEvent } = require('../audit/audit-log.cjs');
const { autoApplyExternal } = require('./ats-auto-apply.cjs');

async function openExternalApplication({job, dryRun=true, submit=false, storeDir, ...opts}={}){
  const url=job?.applyUrl||job?.sourceUrl;
  if(!url) return {status:'unsupported', opened:false, reason:'missing-url'};
  appendAuditEvent({type:'open-external-application', jobId:job.id, url, dryRun, submit}, storeDir);
  const result = await autoApplyExternal({job,dryRun,submit,storeDir,...opts});
  return {...result, opened: result.status === 'submitted' || (!dryRun && result.status === 'prepared'), prepared: ['prepared','submitted'].includes(result.status)};
}
module.exports={openExternalApplication};
