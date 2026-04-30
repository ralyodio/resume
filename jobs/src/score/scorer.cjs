const { defaultHermesJobConfig } = require('../config/defaults.cjs');
function has(t, rx){ return rx.test(String(t||'').toLowerCase()); }
function daysOld(iso){ if (!iso) return Infinity; return (Date.now() - new Date(iso).getTime()) / 86400000; }
function scoreJob(job, config={}){
  const cfg={...defaultHermesJobConfig, ...config};
  let score=0; const reasons=[]; const riskFlags=[];
  const text = `${job.title||''} ${job.company||''} ${job.location||''} ${(job.tags||[]).join(' ')} ${job.descriptionText||''}`.toLowerCase();
  const add=(n,r)=>{score+=n; reasons.push(`${n>0?'+':''}${n} ${r}`)}; const risk=(n,r)=>{score+=n; riskFlags.push(r); reasons.push(`${n} ${r}`)};
  if (job.remote) add(30,'remote'); else risk(-35,'no remote confirmation');
  if (has(text,/\b(ai|llm|agentic|generative ai|genai|machine learning|ml infra|rag|openai|anthropic|claude)\b/)) add(25,'AI/LLM signal');
  if (has(text,/\b(web3|crypto|blockchain|protocol|defi|smart contract|solidity|ethereum|polygon)\b/)) add(25,'Web3/crypto signal');
  if (has(text,/\b(node|react|next\.js|nextjs|supabase|rust|distributed systems|svelte|typescript|javascript|postgres|api|devtools|infrastructure)\b/)) add(20,'matching tech stack');
  if (job.salaryMin || job.salaryMax || /\$\s?\d{2,3}[0-9,]*(k|000)?|salary/.test(text)) add(15,'salary visible');
  if (has(text,/founding engineer|technical cofounder|co-founder|founder|early[- ]stage|startup/)) add(15,'founding/startup signal');
  if (daysOld(job.postedAt) <= 2) add(10,'posted within 48 hours');
  if (has(text,/founder|hiring manager|direct apply|email the founder/)) add(10,'direct hiring path');
  if (['native-profile','easy-apply'].includes(job.applicationMode)) add(10,'profile/easy apply flow');
  if (has(text,/open[- ]source|developer tools?|devtools|infrastructure|platform|distributed/)) add(5,'devtools/infra focus');
  if (has(text,/hybrid only|hybrid|onsite|on-site|in office/)) risk(-25,'hybrid/onsite signal');
  if (has(text,/staffing|recruiter|recruitment agency|talent solutions|contract-to-hire/)) risk(-30,'recruiter/staffing signal');
  if ((job.descriptionText||'').length < 120) risk(-30,'vague description');
  if (has(text,/unpaid|volunteer/)) risk(-40,'unpaid role');
  if (has(text,/commission[- ]only|100% commission/)) risk(-40,'commission-only role');
  if (has(text,/clearance required|security clearance|top secret|ts\/sci/)) risk(-50,'clearance required');
  if (has(text,/relocation required|must relocate/)) risk(-50,'relocation required');
  if (has(text,/guaranteed income|wire money|upfront fee|telegram only|whatsapp only/)) risk(-60,'scam language');
  if (has(text,/token[- ]only|paid in tokens only|equity only|crypto pump/)) risk(-75,'token-only crypto compensation');
  score=Math.max(0, Math.min(100, score));
  let decision = score >= cfg.minScoreForAutoApply ? 'auto-apply-eligible' : score >= cfg.minScoreForQueue ? 'queue-for-review' : score >= 50 ? 'save-only' : 'skip';
  const knownSafe = (cfg.knownSafeAutoApplySources||[]).includes(job.source);
  if (decision === 'auto-apply-eligible' && (cfg.humanReviewRequiredForNewSources && !knownSafe)) decision='queue-for-review';
  if (riskFlags.some(r=>/clearance|required|unpaid|commission|relocation|token-only|scam|hybrid/.test(r)) && score < cfg.minScoreForQueue) decision='skip';
  return { score, reasons, riskFlags, decision };
}
module.exports={scoreJob};
