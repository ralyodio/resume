const { makeHtmlBoardAdapter } = require('./html-board-factory.cjs');
module.exports = makeHtmlBoardAdapter({
  id:'remotive', name:'Remotive Software Development', baseUrl:'https://remotive.com', tags:['remote','software'],
  buildSearchUrl: ({query=''}={}) => `https://remotive.com/remote-jobs/software-dev${query ? `?search=${encodeURIComponent(query)}` : ''}`,
  cardPatterns:[/<li[^>]*[\s\S]*?remote-jobs[\s\S]*?<\/li>/gi, /<article[\s\S]*?<\/article>/gi],
  parseCard(card){ const href=(card.match(/href=["']([^"']*\/remote-jobs\/[^"']+)["']/i)||[])[1]; const title=(card.match(/<(?:h2|h3|a)[^>]*>([\s\S]*?)<\/(?:h2|h3|a)>/i)||[])[1]; const company=(card.match(/company[^>]*>([\s\S]*?)<\//i)||[])[1]; return {href,title,company}; }
});
