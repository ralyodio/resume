#!/usr/bin/env node
// Discover remote, US-eligible agentic / AI-coding engineering roles at the
// companies in vinitshahdeo/awesome-ai-startups-hiring, via public ATS APIs
// (Ashby, Greenhouse, Lever, Workable). Skips anything already in applied.jsonl
// and writes a ranked shortlist for review.
//
//   node jobs/ai-startups/discover.mjs [--min-score 7] [--limit 40]
//
// State lives outside the repo (it is public): $AI_JOBS_STATE or
// ~/.local/share/hermes-remote-jobs/ai-startups/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE = process.env.AI_JOBS_STATE || path.join(os.homedir(), '.local/share/hermes-remote-jobs/ai-startups');
const LIST_URL = 'https://raw.githubusercontent.com/vinitshahdeo/awesome-ai-startups-hiring/main/README.md';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const MIN = Number(arg('min-score', 7));
const LIMIT = Number(arg('limit', 40));
fs.mkdirSync(STATE, { recursive: true });

const applied = new Set(
  (fs.existsSync(`${STATE}/applied.jsonl`) ? fs.readFileSync(`${STATE}/applied.jsonl`, 'utf8').trim().split('\n').filter(Boolean) : [])
    .map((l) => JSON.parse(l)).map((r) => r.url),
);

const readme = await (await fetch(LIST_URL)).text();
const companies = readme.split('\n').filter((l) => /^\| \d+ /.test(l)).map((l) => {
  const cell = l.split('|')[2] || '';
  const m = cell.match(/\[([^\]]+)\]\(([^)]+)\)/);
  return { name: (m ? m[1] : cell).trim(), url: m ? m[2] : '' };
});

function slugs({ name, url }) {
  const s = new Set();
  const n = name.toLowerCase().replace(/\(.*?\)/g, '').trim();
  s.add(n.replace(/[^a-z0-9]/g, ''));
  s.add(n.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  s.add(n.replace(/\b(ai|labs?|inc|hq)\b/g, '').replace(/[^a-z0-9]/g, ''));
  if (url) {
    try {
      const h = new URL(url).hostname.replace(/^www\./, '');
      const root = h.split('.')[0];
      for (const x of [root, h.replace(/\./g, ''), `${root}ai`, `${root}hq`, `${root}labs`]) s.add(x);
    } catch {}
  }
  return [...s].filter((x) => x && x.length > 1);
}
const json = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(12000) }); return r.ok ? await r.json() : null; } catch { return null; } };
const strip = (h) => (h || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/g, ' ');

async function probe(co) {
  for (const sl of slugs(co)) {
    const a = await json(`https://api.ashbyhq.com/posting-api/job-board/${sl}?includeCompensation=true`);
    // Ashby's isRemote is true for Hybrid roles too; workplaceType is the real signal.
    if (a?.jobs?.length) return a.jobs.map((x) => ({ ats: 'ashby', title: x.title, loc: x.location, remote: x.workplaceType === 'Remote', url: x.jobUrl, applyUrl: `${x.jobUrl}/application`, desc: x.descriptionPlain || '', comp: x.compensation?.compensationTierSummary || '' }));
    const g = await json(`https://boards-api.greenhouse.io/v1/boards/${sl}/jobs?content=true`);
    // The embed URL serves the bare form even when a board redirects to the company site.
    if (g?.jobs?.length) return g.jobs.map((x) => ({ ats: 'greenhouse', title: x.title, loc: x.location?.name || '', url: x.absolute_url, applyUrl: `https://job-boards.greenhouse.io/embed/job_app?for=${sl}&token=${x.id}`, desc: strip(x.content) }));
    const l = await json(`https://api.lever.co/v0/postings/${sl}?mode=json`);
    if (Array.isArray(l) && l.length) return l.map((x) => ({ ats: 'lever', title: x.text, loc: x.categories?.location || '', remote: x.workplaceType === 'remote', url: x.hostedUrl, applyUrl: x.applyUrl, desc: `${x.descriptionPlain || ''} ${(x.lists || []).map((q) => `${q.text} ${strip(q.content)}`).join(' ')}` }));
    const w = await json(`https://apply.workable.com/api/v1/widget/accounts/${sl}`);
    if (w?.jobs?.length) return w.jobs.map((x) => ({ ats: 'workable', title: x.title, loc: [x.city, x.country].filter(Boolean).join(', '), remote: x.telecommuting, url: x.url, applyUrl: x.application_url || x.url, desc: '' }));
  }
  return [];
}

const boards = [];
let next = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (next < companies.length) {
    const co = companies[next++];
    boards.push({ ...co, jobs: await probe(co) });
  }
}));

const NOT_ENG = /\b(intern|new grad|junior|sales|recruit|director|vp|manager|strategist|operations|client services|solutions architect|hardware|embedded|firmware|mechanical|electrical|asic|fpga|silicon|support engineer|solutions engineer|sales engineer|research scientist|ml research|ios|android)\b/i;
const NON_US = /india|bangalore|bengaluru|london|berlin|paris|europe|emea|\buk\b|united kingdom|germany|poland|israel|tel aviv|japan|singapore|canada|toronto|sydney|australia|korea|seoul|amsterdam|netherlands|spain|brazil|zurich|munich|dublin|stockholm|taiwan|apac/i;
const out = [];
for (const co of boards) for (const j of co.jobs) {
  const t = j.title || '';
  const d = j.desc.toLowerCase();
  const loc = String(j.loc || '');
  if (!/engineer|developer|architect|member of technical staff/i.test(t) || NOT_ENG.test(t)) continue;
  const remote = j.remote === true || /remote|anywhere|distributed/i.test(loc) || /\bremote\b/i.test(t);
  if (!remote || (NON_US.test(loc) && !/united states|\bus\b|usa|americas/i.test(loc))) continue;
  if (applied.has(j.url)) continue;
  let score = 0;
  const why = [];
  const hit = (re, w, tag) => { if (re.test(t) || re.test(d)) { score += w; why.push(tag); } };
  hit(/claude code|cursor|codex|copilot|windsurf/i, 4, 'ai-tools');
  hit(/agentic coding|ai[- ]native|coding agents?|ai[- ]assisted (development|coding)|write (almost )?(all|most) of (our|the) code/i, 5, 'ai-coding-culture');
  hit(/\bagent(s|ic)?\b/i, 3, 'agents');
  hit(/full[- ]?stack|typescript|node|react|svelte/i, 2, 'js-stack');
  hit(/founding|forward deployed|product engineer/i, 2, 'role');
  if (/agent|\bai\b|llm/i.test(t)) { score += 3; why.push('title-ai'); }
  const flags = [];
  if (/(monday|mon)\s*[-–]\s*(thursday|friday)\s+onsite|days a week in (the )?office|in[- ]office \d|onsite (required|in)/i.test(d)) flags.push('ONSITE');
  if (/clearance/i.test(d)) flags.push('CLEARANCE');
  if (/\b(primary language|primarily in) (go|golang|java|python|rust|c\+\+)/i.test(d) && !/typescript|node/i.test(d)) flags.push('NON-JS');
  if (/must be based in|required to be based in/i.test(d)) flags.push('LOCATION-BOUND');
  out.push({ company: co.name, title: t.trim(), loc, ats: j.ats, score, why: why.join(','), flags, url: j.url, applyUrl: j.applyUrl, comp: j.comp || '' });
}
const shortlist = out.filter((x) => x.score >= MIN).sort((a, b) => b.score - a.score).slice(0, LIMIT);
fs.writeFileSync(`${STATE}/shortlist.json`, JSON.stringify(shortlist, null, 1));
console.error(`companies ${boards.length}, with boards ${boards.filter((b) => b.jobs.length).length}, new remote US eng roles ${out.length}, shortlist ${shortlist.length} -> ${STATE}/shortlist.json`);
for (const [i, x] of shortlist.entries()) console.log([i, x.score, x.company, x.title, x.loc, x.flags.join('+') || '-', x.comp].join(' | '));
