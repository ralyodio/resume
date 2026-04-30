const { makeHtmlBoardAdapter } = require('./html-board-factory.cjs');
module.exports = makeHtmlBoardAdapter({
  id:'weworkremotely', name:'We Work Remotely', baseUrl:'https://weworkremotely.com', tags:['remote','software'],
  buildSearchUrl: ({query=''}={}) => query ? `https://weworkremotely.com/remote-jobs/search?term=${encodeURIComponent(query)}` : 'https://weworkremotely.com/categories/remote-programming-jobs',
  cardPatterns:[/<li[^>]+class=["'][^"']*(?:feature|new-listing)[^"']*["'][\s\S]*?<\/li>/gi],
  parseCard(card){ const href=(card.match(/href=["']([^"']*\/remote-jobs\/[^"']+)["']/i)||[])[1]; const company=(card.match(/<span[^>]+class=["']company["'][^>]*>([\s\S]*?)<\/span>/i)||[])[1]; const title=(card.match(/<span[^>]+class=["']title["'][^>]*>([\s\S]*?)<\/span>/i)||[])[1]; const region=(card.match(/<span[^>]+class=["']region[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)||[])[1]; return {href, company, title, location: region && region.replace(/<[^>]+>/g,' ')}; }
});
