const { unsupportedApply } = require('./interface.cjs');
const source={id:'linkedin-legacy',name:'LinkedIn Easy Apply legacy runner',supportsRemoteFilter:true,supportsNativeApply:false,supportsExternalApply:false,supportsEasyApply:true,legacyScript:'/home/ettinger/Desktop/resume/linkedin_easy_apply_daily.cjs'};
async function searchJobs(){ return []; } async function getJobDetails(){ return null; } async function getApplicationMode(){ return 'easy-apply'; }
module.exports={source,searchJobs,getJobDetails,getApplicationMode,applyToJob:unsupportedApply};
