const { makeHtmlBoardAdapter } = require('./html-board-factory.cjs');
module.exports = makeHtmlBoardAdapter({
  id:'builtin', name:'Built In Remote', baseUrl:'https://builtin.com', tags:['remote','tech'],
  buildSearchUrl: ({query=''}={}) => `https://builtin.com/jobs/remote${query ? `?search=${encodeURIComponent(query)}` : ''}`,
  cardPatterns:[/<div[^>]+(?:data-testid|class)=["'][^"']*(?:job-card|job-item|job)[^"']*["'][\s\S]*?<\/div>\s*<\/div>/gi],
  parseCard(card){ const href=(card.match(/href=["']([^"']*\/job\/[^"']+)["']/i)||[])[1]; const title=(card.match(/<(?:h2|h3|a)[^>]*>([\s\S]*?)<\/(?:h2|h3|a)>/i)||[])[1]; const company=(card.match(/company[^>]*>[\s\S]*?<[^>]*>([\s\S]*?)<\//i)||[])[1]; return {href,title,company, applicationMode:/easy apply/i.test(card)?'easy-apply':undefined}; }
});
