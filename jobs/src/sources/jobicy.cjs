const { makeApiBoardAdapter } = require('./api-board-factory.cjs');

module.exports = makeApiBoardAdapter({
  id:'jobicy',
  name:'Jobicy Remote Jobs API',
  tags:['remote','software','aggregator'],
  buildSearchUrl: ({query='',limit=50}={}) => {
    const params = new URLSearchParams({ count:String(Math.min(Number(limit || 50), 50)), industry:'engineering' });
    const q = String(query || '').toLowerCase();
    if (/python/.test(q)) params.set('tag','python');
    else if (/react/.test(q)) params.set('tag','react');
    else if (/node|javascript|typescript|developer|engineer|software|ai|llm|ml/.test(q)) params.set('tag','developer');
    return `https://jobicy.com/api/v2/remote-jobs?${params.toString()}`;
  },
  extractRows: data => data && data.jobs || [],
  mapRow: row => ({
    id:`jobicy-${row.id || row.jobId || row.url}`,
    sourceUrl:row.url || row.jobUrl,

    title:row.jobTitle || row.title,
    company:row.companyName || row.company,
    companyUrl:row.companyLogo ? undefined : row.companyUrl,
    location:row.jobGeo || row.location || 'Remote',
    remote:true,
    remoteRegion:row.jobGeo || 'Remote',
    employmentType:row.jobType,
    tags:Array.isArray(row.jobTags) ? row.jobTags : [],
    descriptionText:row.jobDescription || row.description,
    postedAt:row.pubDate || row.publicationDate,
    salary:row.annualSalaryMin && row.annualSalaryMax ? `$${row.annualSalaryMin}-${row.annualSalaryMax}` : '',
    metadata:{ companyLogo:row.companyLogo }
  })
});
