const { cleanText, hashString, isIsoDate, toIsoDate, canonicalUrl } = require('../util/text.cjs');
const { classifyApplicationMode } = require('../apply/application-mode.cjs');
const ALLOWED = new Set(['id','source','sourceUrl','title','company','companyUrl','location','remote','remoteRegion','employmentType','seniority','tags','descriptionText','salaryMin','salaryMax','currency','applyUrl','applicationMode','postedAt','discoveredAt','score','status','skipReason','metadata','sourceIds','mergedFrom','riskFlags','reasons','decision','resumePath','coverLetter']);
const REQUIRED = ['id','source','sourceUrl','title','company','remote','applicationMode','discoveredAt','status'];
const STATUSES = new Set(['new','scored','queued','approved','applying','applied','needs-human-review','skipped','failed','withdrawn','blacklisted']);
function normalizeJob(input={}){
  const meta = { ...(input.metadata||{}) };
  for (const [k,v] of Object.entries(input)) if (!ALLOWED.has(k)) meta[k]=v;
  const source = cleanText(input.source || meta.source || 'unknown');
  const sourceUrl = canonicalUrl(input.sourceUrl || input.url || input.href || input.applyUrl || '');
  const title = cleanText(input.title);
  const company = cleanText(input.company || 'Unknown');
  const discoveredAt = toIsoDate(input.discoveredAt || new Date());
  const job = {
    id: cleanText(input.id) || `${source}-${hashString(`${sourceUrl}|${title}|${company}`)}`,
    source, sourceUrl, title, company,
    companyUrl: input.companyUrl ? canonicalUrl(input.companyUrl) : undefined,
    location: cleanText(input.location || ''),
    remote: Boolean(input.remote),
    remoteRegion: cleanText(input.remoteRegion || 'Unknown'),
    employmentType: cleanText(input.employmentType || 'unknown'),
    seniority: cleanText(input.seniority || 'unknown'),
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(t=>cleanText(t).toLowerCase()).filter(Boolean))] : [],
    descriptionText: cleanText(input.descriptionText || input.description || ''),
    salaryMin: Number.isFinite(Number(input.salaryMin)) ? Number(input.salaryMin) : undefined,
    salaryMax: Number.isFinite(Number(input.salaryMax)) ? Number(input.salaryMax) : undefined,
    currency: cleanText(input.currency || (input.salaryMin || input.salaryMax ? 'USD' : '')) || undefined,
    applyUrl: input.applyUrl ? canonicalUrl(input.applyUrl) : undefined,
    applicationMode: input.applicationMode || classifyApplicationMode(input),
    postedAt: input.postedAt ? toIsoDate(input.postedAt) : undefined,
    discoveredAt,
    score: Number.isFinite(Number(input.score)) ? Number(input.score) : undefined,
    status: input.status || 'new',
    skipReason: input.skipReason || null,
    metadata: meta,
  };
  for (const [k,v] of Object.entries(input)) if (ALLOWED.has(k) && !Object.prototype.hasOwnProperty.call(job,k)) job[k]=v;
  validateJob(job);
  return Object.fromEntries(Object.entries(job).filter(([,v]) => v !== undefined));
}
function validateJob(job){
  for (const f of REQUIRED) if (job[f] === undefined || job[f] === null || job[f] === '') throw new Error(`Invalid job: missing required field ${f}`);
  if (!isIsoDate(job.discoveredAt)) throw new Error('Invalid job: discoveredAt must be an ISO date string');
  if (job.postedAt && !isIsoDate(job.postedAt)) throw new Error('Invalid job: postedAt must be an ISO date string');
  if (typeof job.remote !== 'boolean') throw new Error('Invalid job: remote must be boolean');
  if (!STATUSES.has(job.status)) throw new Error(`Invalid job: unsupported status ${job.status}`);
  return true;
}
module.exports = { normalizeJob, validateJob, REQUIRED_FIELDS: REQUIRED, STATUSES: [...STATUSES] };
