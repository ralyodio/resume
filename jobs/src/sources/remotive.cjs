const { makeApiBoardAdapter } = require('./api-board-factory.cjs');

module.exports = makeApiBoardAdapter({
  id:'remotive',
  name:'Remotive Remote Jobs API',
  tags:['remote','software','aggregator'],
  buildSearchUrl: ({query='' }={}) => `https://remotive.com/api/remote-jobs${query ? `?search=${encodeURIComponent(query)}` : '?category=software-dev'}`,
  extractRows: data => data && data.jobs || [],
  mapRow: row => ({
    id:`remotive-${row.id || row.url}`,
    sourceUrl:row.url,

    title:row.title,
    company:row.company_name,
    companyUrl:row.company_logo,
    location:row.candidate_required_location || 'Remote',
    remote:true,
    remoteRegion:row.candidate_required_location || 'Remote',
    employmentType:row.job_type,
    tags:Array.isArray(row.tags) ? row.tags : [row.category].filter(Boolean),
    descriptionText:row.description,
    postedAt:row.publication_date,
    salary:row.salary,
    metadata:{ category:row.category }
  })
});
