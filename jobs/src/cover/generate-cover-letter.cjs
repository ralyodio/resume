const ATS_PLATFORM_NAMES = new Set(['lever','greenhouse','workday','smartrecruiters','bamboohr','applytojob','breezy','icims','jobvite','recruiterbox','ashby','workable','boards','jobs','apply']);
const GENERIC_EMPLOYER_NAMES = /^(?:company\s+website|company|website|careers?|jobs?|job\s+board|job\s+posting|apply|application|hiring\s+team|recruiting\s+team|talent\s+team)$/i;

function employerName(job={}){
  const raw=String(job.company || '').replace(/\s+/g,' ').trim();
  const requiresVerifiedEmployer = job.source === 'valueserp-ats' || job.applicationMode === 'external-ats' || job.metadata?.ats;
  if(!raw || ATS_PLATFORM_NAMES.has(raw.toLowerCase()) || GENERIC_EMPLOYER_NAMES.test(raw)) return 'hiring';
  if(requiresVerifiedEmployer && !job.metadata?.employerVerifiedFromJobPage) return 'hiring';
  return raw;
}

function normalizeCoverLetterText(text){
  const raw=String(text || '').replace(/\r\n?/g,'\n').trim();
  if(!raw) return '';
  if(/\n/.test(raw)) {
    return raw
      .replace(/[ \t]+\n/g,'\n')
      .replace(/\n[ \t]+/g,'\n')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
  }
  return raw
    .replace(/^(Hi [^,]+,|Hello [^,]+,)\s+/i,'$1\n\n')
    .replace(/\s+(At Profullstack\b)/g,'\n\n$1')
    .replace(/\s+(I’d welcome\b|I'd welcome\b)/g,'\n\n$1')
    .replace(/\s+(Best,)\s+(Anthony Ettinger)$/i,'\n\n$1\n$2')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

function truncateWordsPreservingParagraphs(text, maxWords=250){
  const normalized=normalizeCoverLetterText(text);
  let count=0;
  const out=[];
  for (const token of normalized.split(/(\s+)/)) {
    if(!token) continue;
    if(/\S/.test(token)) {
      count += 1;
      if(count > maxWords) break;
      out.push(token);
    } else {
      out.push(token.replace(/[^\n\r\t ]+/g,' '));
    }
  }
  return normalizeCoverLetterText(out.join(''));
}

function generateCoverLetter(job={}, profile={}){
  const title=job.title||'this role';
  const company=employerName(job);
  const greeting=company === 'hiring' ? 'Hi hiring team,' : `Hi ${company} team,`;
  const companyPhrase=company === 'hiring' ? 'your team' : company;
  const text=`${greeting}

I’m Anthony Ettinger, a senior full-stack software engineer and founder with 20+ years building production web apps, APIs, developer tools, payment systems, security tooling, crypto products, and AI-assisted software workflows. Your ${title} role stood out because it overlaps with my recent work across JavaScript/Node.js, Svelte/React, API-first systems, browser automation, Web3 payments, and practical LLM-assisted engineering.

At Profullstack I’ve shipped client and internal products spanning security automation, crypto payments, distributed AI infrastructure, marketplaces, and developer tooling. I’m strongest where product ownership and implementation meet: quickly understanding the user problem, designing maintainable systems, and shipping reliable software with tests and operational awareness.

I’d welcome a conversation about how I can help ${companyPhrase} build and ship high-quality software for this role.

Best,
Anthony Ettinger`;
  return truncateWordsPreservingParagraphs(text,250);
}
module.exports={generateCoverLetter,employerName,truncateWordsPreservingParagraphs,normalizeCoverLetterText};
