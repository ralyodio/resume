const fs = require('fs'); const path = require('path');
const { defaultHermesJobConfig } = require('../config/defaults.cjs');
const { appendAuditEvent } = require('../audit/audit-log.cjs');
class JobStore{
  constructor(storeDir=defaultHermesJobConfig.storeDir){ this.storeDir=storeDir; this.jobsFile=path.join(storeDir,'jobs.jsonl'); fs.mkdirSync(storeDir,{recursive:true}); }
  _read(){ try{return fs.readFileSync(this.jobsFile,'utf8').split('\n').filter(Boolean).map(JSON.parse)}catch{return []} }
  _write(rows){ fs.writeFileSync(this.jobsFile, rows.map(r=>JSON.stringify(r)).join('\n')+(rows.length?'\n':'')); }
  all(){ return this._read(); }
  get(id){ return this._read().find(j=>j.id===id); }
  upsert(job, eventType='upsert'){ const rows=this._read(); const idx=rows.findIndex(j=>j.id===job.id); const next={...job, updatedAt:new Date().toISOString()}; if(idx>=0) rows[idx]={...rows[idx],...next}; else rows.push(next); this._write(rows); appendAuditEvent({type:eventType, jobId:job.id, source:job.source, status:next.status}, this.storeDir); return next; }
  transition(id,status,extra={}){ const rows=this._read(); const idx=rows.findIndex(j=>j.id===id); if(idx<0) throw new Error(`Unknown job ${id}`); rows[idx]={...rows[idx],...extra,status,updatedAt:new Date().toISOString()}; this._write(rows); appendAuditEvent({type:'status-transition',jobId:id,status,extra},this.storeDir); return rows[idx]; }
  enqueue(job){ return this.upsert({...job,status:job.status==='new'?'queued':job.status||'queued'},'enqueue'); }
  skip(id, reason='skipped'){ return this.transition(id,'skipped',{skipReason:reason}); }
  approve(id){ return this.transition(id,'approved'); }
  markApplied(id, extra={}){ return this.transition(id,'applied',extra); }
  markFailed(id, error){ return this.transition(id,'failed',{error:String(error)}); }
  pendingReview(){ return this._read().filter(j=>['queued','needs-human-review'].includes(j.status)); }
}
module.exports={JobStore};
