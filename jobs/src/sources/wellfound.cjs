const { makeHtmlBoardAdapter } = require('./html-board-factory.cjs');
module.exports = makeHtmlBoardAdapter({
  id:'wellfound', name:'Wellfound Remote', baseUrl:'https://wellfound.com', nativeApply:true, tags:['startup','remote'],
  buildSearchUrl: ({query=''}={}) => `https://wellfound.com/jobs${query ? `?keyword=${encodeURIComponent(query)}&remote=true` : '?remote=true'}`,
  cardPatterns:[/<div[^>]+(?:class|data-test)=["'][^"']*(?:job|startup|styles_component)[^"']*["'][\s\S]*?<\/div>\s*<\/div>/gi],
  parseCard(card){ const href=(card.match(/href=["']([^"']*(?:\/jobs\/|\/company\/)[^"']+)["']/i)||[])[1]; const title=(card.match(/<(?:h2|h3|a)[^>]*>([\s\S]*?)<\/(?:h2|h3|a)>/i)||[])[1]; return {href,title,company:'Unknown',applicationMode:'native-profile'}; }
});
