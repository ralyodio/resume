function generateCoverLetter(job={}, profile={}){ const title=job.title||'this role'; const company=job.company||'your team'; const text=`Hi ${company} team,

I’m Anthony Ettinger, a senior full-stack software engineer and founder with 20+ years building production web apps, APIs, developer tools, payment systems, security tooling, crypto products, and AI-assisted software workflows. Your ${title} role stood out because it overlaps with my recent work across JavaScript/Node.js, Svelte/React, API-first systems, browser automation, Web3 payments, and practical LLM-assisted engineering.

At Profullstack I’ve shipped client and internal products spanning security automation, crypto payments, distributed AI infrastructure, marketplaces, and developer tooling. I’m strongest where product ownership and implementation meet: quickly understanding the user problem, designing maintainable systems, and shipping reliable software with tests and operational awareness.

I’d welcome a conversation about how I can help ${company} build and ship high-quality software for this role.

Best,
Anthony Ettinger`; const words=text.split(/\s+/); return words.slice(0,250).join(' '); }
module.exports={generateCoverLetter};
