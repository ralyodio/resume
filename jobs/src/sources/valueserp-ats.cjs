const fs = require('fs');
const path = require('path');
const { normalizeJob } = require('../normalize/job.cjs');
const { classifyApplicationMode } = require('../apply/application-mode.cjs');
const { fetchJson } = require('../util/fetch.cjs');
const { stripHtml } = require('../util/text.cjs');

const ATS_TARGETS = [
  { id:'lever', host:'jobs.lever.co' },
  { id:'greenhouse', host:'boards.greenhouse.io' },
  { id:'workday', host:'myworkdayjobs.com' },
  { id:'smartrecruiters', host:'jobs.smartrecruiters.com' },
  { id:'bamboohr', host:'bamboohr.com' },
  { id:'applytojob', host:'applytojob.com' },
  { id:'breezy', host:'breezy.hr' },
  { id:'icims', host:'icims.com' },
  { id:'jobvite', host:'jobs.jobvite.com' },
  { id:'recruiterbox', host:'recruiterbox.com' },
  { id:'ashby', host:'jobs.ashbyhq.com' },
  { id:'workable', host:'apply.workable.com' },
  { id:'email', host:null, rawQuery:'("mailto:" OR "email your resume") "remote" "software engineer"' },
];

const DEFAULT_LOCATION = 'United States';
const DEFAULT_GL = 'us';
const DEFAULT_HL = 'en';
const DEFAULT_GOOGLE_DOMAIN = 'google.com';

function repoRootEnvPath(){ return path.resolve(__dirname, '../../../.env'); }
function loadDotEnv(file=repoRootEnvPath()){
  try {
    const text=fs.readFileSync(file,'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if(!m) continue;
      const key=m[1];
      if(process.env[key]) continue;
      let val=m[2];
      if((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val=val.slice(1,-1);
      process.env[key]=val;
    }
  } catch {}
}
function getApiKey(){ loadDotEnv(); return process.env.VALUESERP_API_KEY || ''; }
function getValueSerpLocation(){ loadDotEnv(); return process.env.HERMES_JOB_SEARCH_LOCATION || process.env.VALUESERP_LOCATION || DEFAULT_LOCATION; }
function getValueSerpGl(){ loadDotEnv(); return process.env.HERMES_JOB_SEARCH_GL || process.env.VALUESERP_GL || DEFAULT_GL; }
function getValueSerpHl(){ loadDotEnv(); return process.env.HERMES_JOB_SEARCH_HL || process.env.VALUESERP_HL || DEFAULT_HL; }
function getValueSerpGoogleDomain(){ loadDotEnv(); return process.env.HERMES_JOB_SEARCH_GOOGLE_DOMAIN || process.env.VALUESERP_GOOGLE_DOMAIN || DEFAULT_GOOGLE_DOMAIN; }
function getUsOnly(){ loadDotEnv(); return /^(1|true|yes)$/i.test(process.env.HERMES_JOB_SEARCH_US_ONLY || process.env.VALUESERP_US_ONLY || ''); }
function quoteQuery(q){ return String(q||'').trim().replace(/^"|"$/g,''); }
function buildGoogleQuery({host, query, remoteOnly=true, usaOnly=false}){
  if(!host) return String(query||'').trim();
  const parts=[`site:${host}`];
  const q=quoteQuery(query);
  if(q) parts.push(`"${q}"`);
  if(remoteOnly) parts.push('remote');
  if(usaOnly) parts.push('("United States" OR USA OR "U.S." OR "Remote US" OR "Remote - US")');
  return parts.join(' ');
}
function buildValueSerpUrl({apiKey='VALUE_SERP_API_KEY', host, query='', page=1, location, gl, hl, googleDomain, remoteOnly=true, usaOnly}){
  const url=new URL('https://api.valueserp.com/search');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('q', buildGoogleQuery({host, query, remoteOnly, usaOnly: usaOnly ?? getUsOnly()}));
  url.searchParams.set('location', location || getValueSerpLocation());
  url.searchParams.set('gl', gl || getValueSerpGl());
  url.searchParams.set('hl', hl || getValueSerpHl());
  url.searchParams.set('google_domain', googleDomain || getValueSerpGoogleDomain());
  url.searchParams.set('page', String(page));
  return url.toString();
}
function organicResults(payload){ return Array.isArray(payload && payload.organic_results) ? payload.organic_results : []; }
function canonicalUrl(u){ try{ const x=new URL(u); x.hash=''; return x.toString(); }catch{return u||'';} }
function urlSlug(u){ return Buffer.from(canonicalUrl(u)).toString('base64url').slice(0,48); }
const ATS_PLATFORM_NAMES = new Set(['lever','greenhouse','workday','smartrecruiters','bamboohr','applytojob','breezy','icims','jobvite','recruiterbox','ashby','workable','boards','jobs','apply']);
function titleCaseCompany(s){
  return String(s||'').replace(/\.[a-z]{2,}$/i,'').replace(/[_+]+/g,' ').replace(/-/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(Boolean).map(w=>{
    if (/^[A-Z0-9]{2,}$/.test(w)) return w;
    if (/^[a-z]+[A-Z]/.test(w)) return w;
    return w.charAt(0).toUpperCase()+w.slice(1);
  }).join(' ');
}
function cleanCompanyName(s){
  let out=decodeURIComponent(String(s||'')).replace(/\b(?:careers?|jobs?|job application|apply|hiring)\b/ig,' ').replace(/[|–—]+.*$/,'').replace(/\s+/g,' ').trim();
  out=out.replace(/^for\s+/i,'').replace(/\s+(?:team|careers)$/i,'').trim();
  return out ? titleCaseCompany(out) : '';
}
function companyFromTitle(rawTitle){
  const title=stripHtml(rawTitle||'');
  const patterns=[/(?:\bat\b|@)\s+([^|–—-]+)$/i, /\s[-–—]\s([^|–—-]+)$/i, /^Job Application for .+? at ([^|–—-]+)$/i];
  for (const re of patterns) { const m=title.match(re); const c=cleanCompanyName(m&&m[1]); if(c) return c; }
  return '';
}
function companyFromAtsUrl(link,target={}){
  let u; try{ u=new URL(link); } catch { return ''; }
  const parts=u.pathname.split('/').filter(Boolean);
  const hostParts=u.hostname.split('.');
  let slug='';
  switch(target.id){
    case 'breezy': slug=hostParts[0]; break;
    case 'greenhouse': slug=parts[0]; break;
    case 'lever': slug=parts[0]; break;
    case 'ashby': slug=parts[0]; break;
    case 'workable': slug=parts[0]; break;
    case 'smartrecruiters': slug=parts[0]; break;
    case 'bamboohr': slug=hostParts[0]; break;
    case 'applytojob': slug=hostParts[0]; break;
    case 'jobvite': slug=parts[0]; break;
    case 'recruiterbox': slug=hostParts[0] || parts[0]; break;
    case 'icims': slug=(hostParts[0]||'').replace(/^careers[-_]?/i,''); break;
    case 'workday': slug=(parts[0]||hostParts[0]||'').replace(/_?External$/i,''); break;
    default: slug='';
  }
  const c=cleanCompanyName(slug);
  if(!c || ATS_PLATFORM_NAMES.has(c.toLowerCase())) return '';
  return c;
}
function companyGuessFromResult(result,target,link){
  return companyFromTitle(result.title) || companyFromAtsUrl(link,target) || 'Unknown';
}
function isUsEligibleText(text) {
  const s=String(text||'');
  const us=/\b(united states|usa|u\.s\.?|us-only|u\.s\.-only|remote\s*[-/]?\s*us|remote\s*[-/]?\s*usa|remote\s*[-/]?\s*united states|based in the us|within the us|california|los gatos|ca,?\s*usa)\b/i.test(s);
  if (us) return true;
  return false;
}
function hasForeignOnlySignal(text) {
  return /\b(europe|emea|uk|united kingdom|canada|australia|new zealand|india|germany|france|spain|portugal|netherlands|poland|romania|singapore|latin america|latam|mexico|brazil|argentina|apac)\b/i.test(String(text||''));
}
function isLikelyJobPostingUrl(link, target={}){
  if(target.id === 'email') return true;
  const u = (()=>{ try { return new URL(link); } catch { return null; } })();
  if(!u) return false;
  const p = u.pathname.replace(/\/+$/,'');
  switch(target.id){
    case 'lever': return /^\/[^/]+\/[^/]+(?:\/apply)?$/i.test(p);
    case 'greenhouse': return /\/jobs\/\d+/i.test(p);
    case 'workday': return /\/job\//i.test(p);
    case 'smartrecruiters': return /^\/[^/]+\/\d+-.+/i.test(p);
    case 'bamboohr': return /\.bamboohr\.com$/i.test(u.hostname) && /\/careers\/\d+/i.test(p);
    case 'applytojob': return /\/apply\/(?!share\b)[^/]+(?:\/[^/]+)?$/i.test(p);
    case 'breezy': return /\/p\/[^/]+/i.test(p);
    case 'icims': return /\/jobs\/\d+\/.*\/job/i.test(p);
    case 'jobvite': return /\/job\/[^/]+/i.test(p);
    case 'recruiterbox': return /\/jobs\/[^/]+/i.test(p) && !/^\/jobs$/i.test(p);
    case 'ashby': return /^\/[^/]+\/[0-9a-f-]{20,}(?:\/application)?$/i.test(p);
    case 'workable': return /^\/[^/]+\/j\/[a-z0-9]+(?:\/apply)?\/?$/i.test(p);
    default: return true;
  }
}
function resultToJob(result,{target,query,remoteOnly=false,usaOnly}){
  const link=canonicalUrl(result.link || result.url || '');
  if(!link) return null;
  if(target.host && !new RegExp(`^https?://([^/]+\\.)?${target.host.replace(/\./g,'\\.')}/`,'i').test(link)) return null;
  const rawTitle=stripHtml(result.title || 'ATS job result');
  const title=rawTitle.replace(/\s+[-|].*$/,'').trim() || 'ATS job result';
  const snippet=stripHtml(result.snippet || result.description || '');
  const email=(snippet.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0];
  const companyGuess=companyGuessFromResult({...result,title:rawTitle},target,link);
  const remoteText=`${title} ${snippet} ${link} ${result.displayed_link || ''}`;
  const remote=/\bremote\b|work from home|work from anywhere|anywhere|distributed|wfh/i.test(remoteText);
  if(remoteOnly && !remote) return null;
  const requireUs = usaOnly ?? getUsOnly();
  if(requireUs && (!isUsEligibleText(remoteText) || hasForeignOnlySignal(remoteText))) return null;
  if(!email && !isLikelyJobPostingUrl(link, target)) return null;
  const applyUrl=email ? `mailto:${email}` : link;
  const mode=target.id==='email' && email ? 'email' : classifyApplicationMode({applyUrl});
  return normalizeJob({
    id:`valueserp-${target.id}-${urlSlug(link)}`,
    source:'valueserp-ats',
    sourceUrl:link,
    applyUrl,
    title,
    company:companyGuess,
    location:remote ? 'Remote / USA' : getValueSerpLocation(),
    remote: true,
    remoteRegion: 'US',
    applicationMode: mode,
    discoveredAt:new Date().toISOString(),
    status:'new',
    descriptionText:snippet,
    tags:['valueserp',target.id,'ats',query].filter(Boolean),
    metadata:{ats:target.id, atsHost:target.host, searchQuery:query, remoteMatched:remote, rawPosition:result.position, email:email||undefined}
  });
}
async function searchTarget(target, opts={}){
  const apiKey=opts.apiKey || getApiKey();
  if(!apiKey) throw new Error('VALUESERP_API_KEY missing; set it in /home/ettinger/Desktop/resume/.env');
  const maxPages=Number(opts.maxPages || opts['max-pages'] || process.env.VALUESERP_MAX_PAGES || 100);
  const limit=Number(opts.limit || 25);
  const out=[];
  const seen=new Set();
  for(let page=Number(opts.startPage || 1); page<=maxPages; page++){
    const url=buildValueSerpUrl({apiKey, host:target.host, query:target.rawQuery || opts.query || '', page, location:opts.location||getValueSerpLocation(), gl:opts.gl||getValueSerpGl(), hl:opts.hl||getValueSerpHl(), googleDomain:opts.googleDomain||getValueSerpGoogleDomain(), remoteOnly:target.rawQuery ? false : opts.remoteOnly!==false, usaOnly: opts.usaOnly ?? getUsOnly()});
    const payload=await fetchJson(url, {timeoutMs:Number(opts.timeoutMs||20000)});
    const results=organicResults(payload);
    if(!results.length) break;
    for(const r of results){
      const job=resultToJob(r,{target,query:opts.query||'',remoteOnly:opts.remoteOnly!==false,usaOnly: opts.usaOnly ?? getUsOnly()});
      if(!job || seen.has(job.sourceUrl)) continue;
      seen.add(job.sourceUrl); out.push(job);
      if(out.length>=limit) return out;
    }
  }
  return out;
}

const source={
  id:'valueserp-ats',
  name:'ValueSERP Global ATS Search',
  supportsRemoteFilter:true,
  supportsNativeApply:false,
  supportsExternalApply:true,
  supportsEasyApply:false,
  reviewOnly:true,
  tags:['remote','software','aggregator','ats','greenhouse','lever','ashby','workable','smartrecruiters']
};
function buildSearchUrl(opts={}){ return buildValueSerpUrl({host:(opts.host||ATS_TARGETS[0].host), query:opts.query||'', page:Number(opts.page||1), apiKey:'VALUE_SERP_API_KEY', remoteOnly:opts.remoteOnly!==false, usaOnly: opts.usaOnly ?? getUsOnly()}); }
async function searchJobs(opts={}){
  const selected=opts.ats ? ATS_TARGETS.filter(t=>t.id===opts.ats || t.host===opts.ats) : ATS_TARGETS;
  const all=[];
  const perTargetLimit=Math.max(Number(opts.limit||10), 1);
  for(const target of selected){
    const jobs=await searchTarget(target,{...opts,limit:perTargetLimit});
    all.push(...jobs);
  }
  return all;
}
async function getJobDetails(jobIdOrUrl){ return { id:jobIdOrUrl, source:'valueserp-ats' }; }
function getApplicationMode(job){ return classifyApplicationMode(job.applyUrl || job.sourceUrl || ''); }
async function applyToJob(){ return { supported:false, reason:'review-only' }; }

module.exports={source,ATS_TARGETS,buildGoogleQuery,buildValueSerpUrl,organicResults,resultToJob,searchTarget,searchJobs,getJobDetails,getApplicationMode,applyToJob};
