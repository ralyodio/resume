const { normalizeJob } = require('../normalize/job.cjs');
const { classifyApplicationMode } = require('../apply/application-mode.cjs');
const { fetchJson } = require('../util/fetch.cjs');
const { stripHtml, cleanText, hashString, parseSinceDays } = require('../util/text.cjs');
const { unsupportedApply } = require('./interface.cjs');

const ATS_HOST_RE = /(greenhouse\.io|boards\.greenhouse\.io|lever\.co|jobs\.ashbyhq\.com|ashbyhq\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|jobvite\.com|icims\.com|workdayjobs\.com|myworkdayjobs\.com)/i;

function allMatches(text, query='') {
  const terms = cleanText(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const t = String(text || '').toLowerCase();
  return terms.every(term => t.includes(term));
}
function withinSince(dateText, since='7d') {
  if (!dateText) return true;
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return true;
  return ((Date.now() - d.getTime()) / 86400000) <= parseSinceDays(since);
}
function firstUrl(...values) {
  for (const value of values) {
    const s = String(value || '');
    const direct = s.match(/https?:\/\/[^\s"'<>]+/i);
    if (direct) return direct[0].replace(/[),.;]+$/,'');
  }
  return '';
}
function findAtsUrl(...values) {
  for (const value of values) {
    const s = String(value || '');
    const matches = s.match(/https?:\/\/[^\s"'<>]+/ig) || [];
    const hit = matches.find(u => ATS_HOST_RE.test(u));
    if (hit) return hit.replace(/[),.;]+$/,'');
  }
  return '';
}
function parseSalary(text='') {
  const s = String(text || '').replace(/,/g,'');
  const range = s.match(/\$?\s*(\d{2,3})(?:k|000)?\s*[-–]\s*\$?\s*(\d{2,3})(?:k|000)?/i);
  if (!range) return {};
  let min = Number(range[1]); let max = Number(range[2]);
  if (min < 1000) min *= 1000;
  if (max < 1000) max *= 1000;
  return { salaryMin:min, salaryMax:max, currency:'USD' };
}
function makeApiBoardAdapter(def) {
  const source = { id:def.id, name:def.name, supportsRemoteFilter:true, supportsNativeApply:false, supportsExternalApply:true, reviewOnly:true };
  function buildSearchUrl(opts={}) { return def.buildSearchUrl(opts); }
  function normalizeRows(data, opts={}) {
    const rows = def.extractRows(data, opts) || [];
    const out = [];
    for (const row of rows) {
      if (out.length >= Number(opts.limit || 25)) break;
      const p = def.mapRow(row, opts) || {};
      const rawDescription = p.descriptionText || p.description || '';
      const descriptionText = stripHtml(rawDescription);
      const hay = `${p.title || ''} ${p.company || ''} ${(p.tags || []).join(' ')} ${p.location || ''} ${descriptionText}`;
      if (!allMatches(hay, opts.query || '')) continue;
      if (!withinSince(p.postedAt, opts.since || '7d')) continue;
      if (opts.remoteOnly !== false && p.remote === false) continue;
      const sourceUrl = p.sourceUrl || p.url || firstUrl(row.url, row.apply_url, row.refs && row.refs.landing_page, descriptionText);
      if (!sourceUrl) continue;
      const atsUrl = p.applyUrl || findAtsUrl(row.apply_url, row.application_url, row.url, row.refs && row.refs.landing_page, rawDescription, descriptionText);
      const applyUrl = atsUrl || sourceUrl;
      const salary = parseSalary(p.salary || descriptionText);
      out.push(normalizeJob({
        id: p.id || `${def.id}-${hashString(sourceUrl)}`,
        source:def.id,
        sourceUrl,
        applyUrl,
        title:p.title,
        company:p.company,
        companyUrl:p.companyUrl,
        location:p.location || 'Remote',
        remote:p.remote !== false,
        remoteRegion:p.remoteRegion || p.location || 'Unknown',
        employmentType:p.employmentType,
        tags:p.tags || def.tags || [],
        descriptionText,
        postedAt:p.postedAt,
        applicationMode:p.applicationMode || classifyApplicationMode({applyUrl, sourceUrl}),
        status:'new',
        ...salary,
        metadata:{ aggregator:def.id, atsDiscovered: Boolean(atsUrl), ...(p.metadata || {}) }
      }));
    }
    return out;
  }
  async function searchJobs(opts={}) { return normalizeRows(await fetchJson(buildSearchUrl(opts)), opts); }
  async function getJobDetails(jobUrl) { return {sourceUrl:jobUrl}; }
  async function getApplicationMode(job) { return classifyApplicationMode(job); }
  return { source, buildSearchUrl, normalizeRows, searchJobs, getJobDetails, getApplicationMode, applyToJob: unsupportedApply };
}

module.exports = { makeApiBoardAdapter, ATS_HOST_RE, findAtsUrl, allMatches };
