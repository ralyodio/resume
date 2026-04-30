const { makeHtmlBoardAdapter } = require('./html-board-factory.cjs');
module.exports = makeHtmlBoardAdapter({
  id:'laborx', name:'LaborX Remote Crypto Freelance', baseUrl:'https://laborx.com', nativeApply:true, tags:['crypto','freelance','remote'],
  buildSearchUrl: ({query=''}={}) => `https://laborx.com/jobs${query ? `?q=${encodeURIComponent(query)}` : ''}`,
  cardPatterns:[/<a[^>]+href=["'][^"']*\/jobs\/[^"']+["'][\s\S]*?<\/a>/gi, /<article[\s\S]*?<\/article>/gi],
  parseCard(card){ const href=(card.match(/href=["']([^"']*\/jobs\/[^"']+)["']/i)||[])[1]; const title=(card.match(/<(?:h2|h3|a|div)[^>]*>([\s\S]*?)<\/(?:h2|h3|a|div)>/i)||[])[1]; return {href,title,company:'LaborX client',applicationMode:'marketplace-proposal'}; }
});
