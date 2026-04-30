const fs = require('fs'); const path = require('path');
const { defaultHermesJobConfig } = require('../config/defaults.cjs');
function ensureDir(dir){ fs.mkdirSync(dir,{recursive:true}); }
function auditPath(storeDir=defaultHermesJobConfig.storeDir){ return path.join(storeDir,'audit.jsonl'); }
function appendAuditEvent(event, storeDir=defaultHermesJobConfig.storeDir){ ensureDir(storeDir); const row={ts:new Date().toISOString(), ...event}; fs.appendFileSync(auditPath(storeDir), JSON.stringify(row)+'\n'); return row; }
function readAuditEvents(storeDir=defaultHermesJobConfig.storeDir){ try { return fs.readFileSync(auditPath(storeDir),'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
module.exports={appendAuditEvent,readAuditEvents,auditPath};
