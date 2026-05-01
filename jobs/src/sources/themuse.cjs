const { makeApiBoardAdapter } = require('./api-board-factory.cjs');

module.exports = makeApiBoardAdapter({
  id:'themuse',
  name:'The Muse Public Jobs API',
  tags:['remote','software','aggregator'],
  buildSearchUrl: ({query='',page=1}={}) => {
    const params = new URLSearchParams({ page:String(page), location:'Remote', category:'Computer and IT' });
    if (query) params.set('q', query);
    return `https://www.themuse.com/api/public/jobs?${params.toString()}`;
  },
  extractRows: data => data && data.results || [],
  mapRow: row => ({
    id:`themuse-${row.id}`,
    sourceUrl:row.refs && row.refs.landing_page,

    title:row.name,
    company:row.company && row.company.name,
    companyUrl:row.company && row.company.refs && row.company.refs.landing_page,
    location:(row.locations || []).map(l=>l.name).join(', ') || 'Remote',
    remote:/remote/i.test((row.locations || []).map(l=>l.name).join(' ')),
    employmentType:row.type,
    seniority:(row.levels || []).map(l=>l.name).join(', '),
    tags:[...(row.categories || []).map(c=>c.name), ...(row.levels || []).map(l=>l.name)],
    descriptionText:row.contents,
    postedAt:row.publication_date,
    metadata:{ museId:row.id }
  })
});
