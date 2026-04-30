const fs = require('fs'); const path = require('path');
const DEFAULT='/home/ettinger/Desktop/resume/anthony.ettinger.resume4.pdf';
function has(text,rx){return rx.test(String(text||'').toLowerCase())}
function selectResume(job={}, opts={}){
  const dir=opts.resumeDir||'/home/ettinger/Desktop/resume'; const fallback=opts.fallbackResume||DEFAULT;
  const text=`${job.title||''} ${(job.tags||[]).join(' ')} ${job.descriptionText||''}`;
  const choices=[[/\b(ai|llm|genai|machine learning|ml infra|rag|agentic)\b/,'resume-ai-engineer.pdf'],[/\b(web3|crypto|blockchain|protocol|defi|smart contract|solidity)\b/,'resume-web3-engineer.pdf'],[/founding engineer|technical cofounder|startup|founder/,'resume-startup-founder-engineer.pdf'],[/distributed systems|infrastructure|platform|devops|kubernetes|systems/,'resume-distributed-systems.pdf'],[/software|full.?stack|frontend|backend|node|react|javascript|typescript/,'resume-fullstack.pdf']];
  for (const [rx,file] of choices){ const p=path.join(dir,file); if(has(text,rx) && fs.existsSync(p)) return p; }
  if (fs.existsSync(fallback)) return fallback; throw new Error(`No resume file found; fallback missing: ${fallback}`);
}
module.exports={selectResume};
