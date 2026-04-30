const { makeHtmlBoardAdapter } = require('./html-board-factory.cjs');
module.exports = makeHtmlBoardAdapter({
  id:'cryptocurrencyjobs', name:'Cryptocurrency Jobs Remote', baseUrl:'https://cryptocurrencyjobs.co', tags:['crypto','web3','remote'],
  buildSearchUrl: ({query=''}={}) => `https://cryptocurrencyjobs.co/remote/${query ? `?s=${encodeURIComponent(query)}` : ''}`,
  cardPatterns:[/<li[\s\S]*?href=["'][^"']*\/[^"']*jobs?\/[\s\S]*?<\/li>/gi, /<article[\s\S]*?<\/article>/gi],
  parseCard(card){ const href=(card.match(/href=["']([^"']+)["']/i)||[])[1]; const title=(card.match(/<(?:h2|h3|a)[^>]*>([\s\S]*?)<\/(?:h2|h3|a)>/i)||[])[1]; const company=(card.match(/company[^>]*>([\s\S]*?)<\//i)||[])[1]; return {href,title,company}; }
});
