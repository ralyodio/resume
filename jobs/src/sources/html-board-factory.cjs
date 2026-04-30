const { normalizeJob } = require('../normalize/job.cjs');
const { classifyApplicationMode } = require('../apply/application-mode.cjs');
const { fetchText } = require('../util/fetch.cjs');
const { stripHtml, cleanText, hashString, parseSinceDays } = require('../util/text.cjs');
const { unsupportedApply } = require('./interface.cjs');

function absoluteUrl(base, href='') { try { return new URL(href, base).toString(); } catch { return href; } }
function allMatches(text, query='') { const terms=cleanText(query).toLowerCase().split(/\s+/).filter(Boolean); if(!terms.length) return true; const t=String(text||'').toLowerCase(); return terms.every(term=>t.includes(term)); }
function withinSince(dateText, since='7d') { if(!dateText) return true; const d=new Date(dateText); if(Number.isNaN(d.getTime())) return true; return ((Date.now()-d.getTime())/86400000) <= parseSinceDays(since); }
function parseCards(html, patterns) {
  const cards=[];
  for (const rx of patterns) for (const m of String(html).matchAll(rx)) cards.push(m[0]);
  return cards.length ? cards : String(html).split(/<li|<article|<tr|<div/gi).map((part,i)=>i?'<div'+part:part).filter(s=>/href=|job|role|engineer|developer/i.test(s));
}
function makeHtmlBoardAdapter(def) {
  const source={id:def.id,name:def.name,supportsRemoteFilter:true,supportsNativeApply:!!def.nativeApply,supportsExternalApply:true,reviewOnly:true};
  function buildSearchUrl(opts={}) { return def.buildSearchUrl(opts); }
  function parseJobsFromHtml(html, opts={}) {
    const jobs=[]; const cards=parseCards(html, def.cardPatterns||[]);
    for (const card of cards) {
      if (jobs.length >= Number(opts.limit||25)) break;
      const parsed = def.parseCard ? def.parseCard(card, opts) : {};
      const href = parsed.href || (card.match(/href=["']([^"']+)["']/i)||[])[1];
      const text = stripHtml(card);
      const title = cleanText(parsed.title || (card.match(/<(?:h1|h2|h3|a)[^>]*>([\s\S]{2,180}?)<\/(?:h1|h2|h3|a)>/i)||[])[1] || text.split(/\s{2,}|\n/)[0] || 'Remote Role');
      const company = cleanText(parsed.company || 'Unknown');
      if (!href || !title || /post job|sign in|login|subscribe|category|newsletter/i.test(title)) continue;
      if (!allMatches(`${title} ${company} ${text}`, opts.query || '')) continue;
      if (!withinSince(parsed.postedAt, opts.since||'7d')) continue;
      const sourceUrl=absoluteUrl(def.baseUrl, href);
      jobs.push(normalizeJob({
        id: parsed.id || `${def.id}-${hashString(sourceUrl)}`,
        source:def.id,
        sourceUrl,
        applyUrl: parsed.applyUrl ? absoluteUrl(def.baseUrl, parsed.applyUrl) : sourceUrl,
        title,
        company,
        location: parsed.location || 'Remote',
        remote:true,
        remoteRegion: parsed.remoteRegion || parsed.location || 'Unknown',
        tags: parsed.tags || def.tags || [],
        descriptionText: text,
        salaryMin: parsed.salaryMin,
        salaryMax: parsed.salaryMax,
        currency: parsed.currency,
        postedAt: parsed.postedAt,
        applicationMode: parsed.applicationMode || classifyApplicationMode({applyUrl: parsed.applyUrl || sourceUrl, sourceUrl}),
        status:'new',
        metadata: { remoteOnlyUrl: buildSearchUrl(opts) }
      }));
    }
    return jobs;
  }
  async function searchJobs(opts={}) { const url=buildSearchUrl(opts); const html=await fetchText(url,{headers:{'user-agent':'Mozilla/5.0 HermesRemoteJobs/0.1'}}); return parseJobsFromHtml(html, opts); }
  async function getJobDetails(jobUrl){ return {sourceUrl:jobUrl}; }
  async function getApplicationMode(job){ return classifyApplicationMode(job); }
  return {source, buildSearchUrl, parseJobsFromHtml, searchJobs, getJobDetails, getApplicationMode, applyToJob: unsupportedApply};
}
module.exports={makeHtmlBoardAdapter, absoluteUrl, allMatches};
