const { normalizeJob } = require('../normalize/job.cjs');
const { classifyApplicationMode } = require('../apply/application-mode.cjs');
const { fetchJson } = require('../util/fetch.cjs');
const { stripHtml, cleanText } = require('../util/text.cjs');
const { unsupportedApply } = require('./interface.cjs');

const API_BASE_URL = 'https://704k2n7od3.execute-api.us-east-1.amazonaws.com/prod';
const PUBLIC_BASE_URL = 'https://jobs.fedstack.com';
const PUBLISHING_ENTITY = 'FEDSTACK';

const source = {
  id: 'fedstack',
  name: 'Fedstack ATS',
  supportsRemoteFilter: true,
  supportsNativeApply: false,
  supportsExternalApply: true,
  supportsEasyApply: false,
  reviewOnly: true,
  tags: ['remote','software','ai','ats','fedstack']
};

function buildSearchUrl() {
  const url = new URL(`${API_BASE_URL}/jobs`);
  url.searchParams.set('active', 'true');
  url.searchParams.set('publishingEntity', PUBLISHING_ENTITY);
  return url.toString();
}

function publicJobUrl(id) {
  return `${PUBLIC_BASE_URL}/jobs/${encodeURIComponent(id)}`;
}

function parseJobDetailsJson(row = {}) {
  const raw = row.Job_Details_JSON__c || row.Job_Details_JSON || '';
  if (!raw) return '';
  try {
    const details = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const chunks = [];
    const visit = (node) => {
      if (node == null) return;
      if (typeof node === 'string') { chunks.push(node); return; }
      if (Array.isArray(node)) { for (const item of node) visit(item); return; }
      if (typeof node === 'object') {
        if (node.title) chunks.push(node.title);
        if (Array.isArray(node.contents)) visit(node.contents);
        else if (node.content) visit(node.content);
        else if (node.value) visit(node.value);
        for (const [key, value] of Object.entries(node)) {
          if (['title','contents','content','value','contentType'].includes(key)) continue;
          if (/sections?|items?|children|rows?/i.test(key)) visit(value);
        }
      }
    };
    visit(details.sections || details);
    return stripHtml(chunks.join('\n')).replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return stripHtml(raw);
  }
}

function isRemote(row = {}) {
  return /remote/i.test(`${row.Job_Location__c || ''} ${row.Location__c || ''} ${row.Work_Location__c || ''}`);
}

function mapRowToJob(row = {}, opts = {}) {
  const id = row.Id || row.id;
  if (!id) return null;
  const title = row.Job_Title__c || row.Name || 'Fedstack role';
  const descriptionText = parseJobDetailsJson(row) || stripHtml(row.Public_Description__c || row.Description || '');
  const location = row.Job_Location__c || row.Location__c || (isRemote(row) ? 'Remote' : 'Unknown');
  const remote = isRemote(row);
  const hay = cleanText(`${title} ${location} ${descriptionText} ${row.Cohort_Category__c || ''}`.toLowerCase());
  const terms = cleanText(opts.query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length && !terms.every(term => hay.includes(term))) return null;
  if (opts.remoteOnly !== false && !remote) return null;
  const url = publicJobUrl(id);
  return normalizeJob({
    id: `fedstack-${id}`,
    source: source.id,
    sourceUrl: url,
    applyUrl: url,
    title,
    company: 'Fedstack',
    companyUrl: 'https://fedstack.com',
    location: remote ? 'Remote / USA' : location,
    remote,
    remoteRegion: remote ? 'US' : location,
    employmentType: 'full-time',
    tags: ['fedstack','ats','ai', row.Cohort_Category__c].filter(Boolean),
    descriptionText,
    salaryMin: Number(row.Year_1_Salary__c) || undefined,
    salaryMax: Number(row.Year_2_Salary__c) || undefined,
    currency: (row.Year_1_Salary__c || row.Year_2_Salary__c) ? 'USD' : undefined,
    postedAt: row.LastModifiedDate || row.CreatedDate || undefined,
    discoveredAt: new Date().toISOString(),
    applicationMode: classifyApplicationMode({ applyUrl: url, sourceUrl: url }),
    status: 'new',
    metadata: {
      ats: 'fedstack',
      apiId: id,
      salesforceName: row.Name,
      jobId: row.Job_ID__c,
      workAuthorization: row.Allowable_Work_Authorization__c,
      minDegree: row.Min_Degree_Required__c,
      codingChallengeName: row.Coding_Challenge_Name__c,
      challengeUrl: row.Challenge_URL__c,
      publishingEntity: PUBLISHING_ENTITY,
      apiBaseUrl: API_BASE_URL,
    }
  });
}

function normalizeRows(rows = [], opts = {}) {
  const limit = Math.max(Number(opts.limit || 25), 1);
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const job = mapRowToJob(row, opts);
    if (!job) continue;
    out.push(job);
    if (out.length >= limit) break;
  }
  return out;
}

async function searchJobs(opts = {}) {
  return normalizeRows(await fetchJson(buildSearchUrl(opts)), opts);
}

async function getJobDetails(jobIdOrUrl) {
  const raw = String(jobIdOrUrl || '');
  const id = raw.startsWith('http') ? raw.split('/').filter(Boolean).pop() : raw.replace(/^fedstack-/, '');
  if (!id) return { id: raw, source: source.id };
  const row = await fetchJson(`${API_BASE_URL}/jobs/${encodeURIComponent(id)}`);
  return mapRowToJob(row, { remoteOnly: false }) || { id, source: source.id };
}

function getApplicationMode(job) {
  return classifyApplicationMode(job);
}

module.exports = { source, API_BASE_URL, PUBLIC_BASE_URL, PUBLISHING_ENTITY, buildSearchUrl, publicJobUrl, parseJobDetailsJson, mapRowToJob, normalizeRows, searchJobs, getJobDetails, getApplicationMode, applyToJob: unsupportedApply };
