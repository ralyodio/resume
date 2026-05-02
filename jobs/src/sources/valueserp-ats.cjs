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

const DEFAULT_LOCATION = '98146, Washington, United States';
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
function quoteQuery(q){ return String(q||'').trim().replace(/^"|"$/g,''); }
function buildGoogleQuery({host, query, remoteOnly=true}){
  if(!host) return String(query||'').trim();
  const parts=[`site:${host}`];
  const q=quoteQuery(query);
  if(q) parts.push(`"${q}"`);
  if(remoteOnly) parts.push('remote');
  return parts.join(' ');
}
function buildValueSerpUrl({apiKey='VALUE_SERP_API_KEY', host, query='', page=1, location=DEFAULT_LOCATION, gl=DEFAULT_GL, hl=DEFAULT_HL, googleDomain=DEFAULT_GOOGLE_DOMAIN, remoteOnly=true}){
  const url=new URL('https://api.valueserp.com/search');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('q', buildGoogleQuery({host, query, remoteOnly}));
  url.searchParams.set('location', location);
  url.searchParams.set('gl', gl);
  url.searchParams.set('hl', hl);
  url.searchParams.set('google_domain', googleDomain);
  url.searchParams.set('page', String(page));
  return url.toString();
}
function organicResults(payload){ return Array.isArray(payload && payload.organic_results) ? payload.organic_results : []; }
function canonicalUrl(u){ try{ const x=new URL(u); x.hash=''; return x.toString(); }catch{return u||'';} }
function urlSlug(u){ return Buffer.from(canonicalUrl(u)).toString('base64url').slice(0,48); }
function resultToJob(result,{target,query,remoteOnly=false}){
  const link=canonicalUrl(result.link || result.url || '');
  if(!link) return null;
  if(target.host && !new RegExp(`^https?://([^/]+\\.)?${target.host.replace(/\./g,'\\.')}/`,'i').test(link)) return null;
  const title=stripHtml(result.title || 'ATS job result').replace(/\s+[-|].*$/,'').trim() || 'ATS job result';
  const snippet=stripHtml(result.snippet || result.description || '');
  const email=(snippet.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0];
  const companyGuess=(result.displayed_link || '').replace(/^https?:\/\//,'').split('/')[1] || target.id;
  const remoteText=`${title} ${snippet} ${link} ${result.displayed_link || ''}`;
  const remote=/\bremote\b|work from home|work from anywhere|anywhere|distributed|wfh/i.test(remoteText);
  if(remoteOnly && !remote) return null;
  const applyUrl=email ? `mailto:${email}` : link;
  const mode=target.id==='email' && email ? 'email' : classifyApplicationMode({applyUrl});
  return normalizeJob({
    id:`valueserp-${target.id}-${urlSlug(link)}`,
    source:'valueserp-ats',
    sourceUrl:link,
    applyUrl,
    title,
    company:companyGuess,
    location:remote ? 'Remote / USA' : DEFAULT_LOCATION,
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
    const url=buildValueSerpUrl({apiKey, host:target.host, query:target.rawQuery || opts.query || '', page, location:opts.location||DEFAULT_LOCATION, gl:opts.gl||DEFAULT_GL, hl:opts.hl||DEFAULT_HL, googleDomain:opts.googleDomain||DEFAULT_GOOGLE_DOMAIN, remoteOnly:target.rawQuery ? false : opts.remoteOnly!==false});
    const payload=await fetchJson(url, {timeoutMs:Number(opts.timeoutMs||20000)});
    const results=organicResults(payload);
    if(!results.length) break;
    for(const r of results){
      const job=resultToJob(r,{target,query:opts.query||'',remoteOnly:opts.remoteOnly!==false});
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
function buildSearchUrl(opts={}){ return buildValueSerpUrl({host:(opts.host||ATS_TARGETS[0].host), query:opts.query||'', page:Number(opts.page||1), apiKey:'VALUE_SERP_API_KEY', remoteOnly:opts.remoteOnly!==false}); }
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
