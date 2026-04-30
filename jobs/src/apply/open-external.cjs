const { appendAuditEvent } = require('../audit/audit-log.cjs');
async function openExternalApplication({job, dryRun=true, storeDir}={}){ const url=job?.applyUrl||job?.sourceUrl; if(!url) return {opened:false, reason:'missing-url'}; appendAuditEvent({type:'open-external-application', jobId:job.id, url, dryRun}, storeDir); return {opened:!dryRun, prepared:true, url, note:'MVP does not auto-submit new source applications'}; }
module.exports={openExternalApplication};
