const { makeHtmlBoardAdapter } = require('./html-board-factory.cjs');
module.exports = makeHtmlBoardAdapter({
  id:'himalayas', name:'Himalayas Remote Software Engineering', baseUrl:'https://himalayas.app', tags:['remote','software'],
  buildSearchUrl: ({query=''}={}) => `https://himalayas.app/jobs/software-engineering${query ? `?search=${encodeURIComponent(query)}` : ''}`,
  cardPatterns:[/<article[\s\S]*?<\/article>/gi, /<li[\s\S]*?href=["'][^"']*\/jobs\/[\s\S]*?<\/li>/gi],
  parseCard(card){ const href=(card.match(/href=["']([^"']*\/jobs\/[^"']+)["']/i)||[])[1]; const title=(card.match(/<(?:h2|h3|a)[^>]*>([\s\S]*?)<\/(?:h2|h3|a)>/i)||[])[1]; const company=(card.match(/company[^>]*>([\s\S]*?)<\//i)||[])[1]; return {href,title,company}; }
});
