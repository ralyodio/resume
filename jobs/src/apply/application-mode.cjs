function classifyApplicationMode(input={}) {
  const url = String(input.applyUrl || input.sourceUrl || input.url || '').toLowerCase();
  const text = String(input.applicationText || input.text || input.descriptionText || '').toLowerCase();
  if (url.startsWith('mailto:')) return 'email';
  if (/(laborx\.com|laborx\.io)/.test(url)) return 'marketplace-proposal';
  if (/web3\.career\//.test(url)) return 'external-ats';
  if (new RegExp('wellfound\\.com|angel\\.co|ycombinator\\.com/companies/').test(url)) return 'native-profile';
  if (/(greenhouse\.io|boards\.greenhouse|lever\.co|jobs\.ashbyhq\.com|ashbyhq\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|jobvite\.com|icims\.com|workdayjobs\.com|myworkdayjobs\.com)/.test(url)) return 'external-ats';
  if (/builtin\.com/.test(url) && /easy apply|quick apply|builtin apply/.test(text)) return 'easy-apply';
  if (new RegExp('linkedin\\.com/jobs').test(url)) return 'easy-apply';
  if (/dice\.com/.test(url)) return 'easy-apply';
  if (/apply|jobs|careers|ats/.test(url)) return 'external-ats';
  return 'unknown';
}
module.exports = { classifyApplicationMode };
