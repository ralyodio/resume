const { makeApiBoardAdapter } = require('./api-board-factory.cjs');

module.exports = makeApiBoardAdapter({
  id:'arbeitnow',
  name:'Arbeitnow Public Job API',
  tags:['remote','software','aggregator'],
  buildSearchUrl: ({page=1}={}) => `https://www.arbeitnow.com/api/job-board-api?page=${encodeURIComponent(page)}`,
  extractRows: data => data && data.data || [],
  mapRow: row => ({
    id:`arbeitnow-${row.slug || row.id}`,
    sourceUrl:row.url,

    title:row.title,
    company:row.company_name,
    location:row.location || (row.remote ? 'Remote' : ''),
    remote:Boolean(row.remote) || /remote/i.test(`${row.location || ''} ${row.description || ''}`),
    employmentType:Array.isArray(row.job_types) ? row.job_types.join(', ') : row.job_types,
    tags:Array.isArray(row.tags) ? row.tags : [],
    descriptionText:row.description,
    postedAt:row.created_at ? new Date(Number(row.created_at) * 1000).toISOString() : undefined,
    metadata:{ slug:row.slug }
  })
});
