function safeUrl(url) { try { return new URL(String(url || '')); } catch { return null; } }
function appendPath(url, suffix, testRe) {
  const u = safeUrl(url);
  if (!u) return url || '';
  const p = u.pathname.replace(/\/+$/,'');
  if (!testRe.test(p)) u.pathname = `${p}${suffix}`;
  return u.toString();
}

const ATS_ADAPTERS = {
  greenhouse: {
    id: 'greenhouse',
    name: 'Greenhouse',
    initialApplyTexts: [/^apply$/i, /^apply now$/i, /^apply for this job$/i],
    finalSubmitSelectors: ['button[type=submit]', 'button'],
    finalSubmitTexts: [/^submit application$/i, /^submit$/i],
    ignoreRequired: (el) => el.getAttribute?.('aria-hidden') === 'true' || el.tabIndex === -1 || /requiredInput/.test(String(el.className || '')),
  },
  lever: {
    id: 'lever',
    name: 'Lever',
    normalizeUrl: (url) => appendPath(url, '/apply', /\/apply$/i),
    initialApplyTexts: [/^apply for this job$/i, /^apply$/i],
    finalSubmitSelectors: ['button[type=submit]', 'input[type=submit]', 'button'],
    finalSubmitTexts: [/^submit application$/i, /^submit$/i],
  },
  applytojob: {
    id: 'applytojob',
    name: 'ApplyToJob/JazzHR',
    finalSubmitSelectors: ['#resumator-submit-resume', 'button', 'input[type=submit]', 'input[type=button]', 'a[role=button]', 'a[href="#"]', 'a[href$="#"]'],
    finalSubmitTexts: [/^submit application$/i, /^submit$/i],
    allowFinalSubmit: (el, text) => el.id === 'resumator-submit-resume' && /^submit application$/i.test(text),
  },
  breezy: {
    id: 'breezy',
    name: 'Breezy',
    normalizeUrl: (url) => {
      const u = safeUrl(url); if (!u) return url || '';
      const m = u.pathname.match(/^(\/p\/[^/-]+)(?:-[^/]*)?/i);
      if (m) u.pathname = `${m[1]}/apply`;
      else return appendPath(url, '/apply', /\/apply$/i);
      return u.toString();
    },
    initialApplyTexts: [/^apply$/i, /^apply now$/i],
    finalSubmitSelectors: ['button[type=submit]', 'button.button.green', 'button'],
    finalSubmitTexts: [/^submit application$/i, /^submit$/i],
    uploadTexts: [/^upload resume$/i],
  },
  workable: {
    id: 'workable',
    name: 'Workable',
    normalizeUrl: (url) => appendPath(url, '/apply/', /\/apply$/i),
    initialApplyTexts: [/^apply$/i, /^application$/i],
    finalSubmitSelectors: ['button[type=submit]', 'button'],
    finalSubmitTexts: [/^submit application$/i, /^submit$/i],
    successTexts: [/application submitted/i, /thank you for applying/i, /application received/i],
  },
  ashby: {
    id: 'ashby',
    name: 'Ashby',
    normalizeUrl: (url) => appendPath(url, '/application', /\/application$/i),
    finalSubmitSelectors: ['button[type=submit]', 'button'],
    finalSubmitTexts: [/^submit application$/i, /^submit$/i],
  },
  icims: {
    id: 'icims',
    name: 'iCIMS',
    normalizeUrl: (url) => {
      const u = safeUrl(url); if (!u) return url || '';
      const p = u.pathname.replace(/\/+$/,'');
      if (!/\/login$/i.test(p) && !u.searchParams.has('mode')) u.searchParams.set('mode','apply');
      return u.toString();
    },
    initialApplyTexts: [/^apply$/i, /^apply for this job$/i, /^apply now$/i],
    finalSubmitSelectors: ['button[type=submit]', 'input[type=submit]', 'button', 'input[type=button]'],
    finalSubmitTexts: [/^submit profile$/i, /^submit application$/i, /^submit$/i],
  },
  jobvite: { id: 'jobvite', name: 'Jobvite', finalSubmitTexts: [/^submit application$/i, /^submit$/i] },
  workday: {
    id: 'workday',
    name: 'Workday',
    initialApplyTexts: [/^apply$/i, /^apply manually$/i, /^use my last application$/i, /^bewerben$/i, /^jetzt bewerben$/i],
    finalSubmitSelectors: ['button[type=submit]', 'input[type=submit]', 'button'],
    finalSubmitTexts: [/^submit$/i, /^submit application$/i, /^send application$/i],
  },
  smartrecruiters: { id: 'smartrecruiters', name: 'SmartRecruiters', finalSubmitTexts: [/^submit application$/i, /^submit$/i] },
  bamboohr: { id: 'bamboohr', name: 'BambooHR' },
  recruiterbox: { id: 'recruiterbox', name: 'Recruiterbox' },
  email: { id: 'email', name: 'Email' },
};

function getAtsAdapter(ats) {
  return ATS_ADAPTERS[ats] || { id: ats || 'unknown', name: ats || 'Unknown' };
}

module.exports = { ATS_ADAPTERS, getAtsAdapter };
