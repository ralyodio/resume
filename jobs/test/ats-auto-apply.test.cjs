const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const { spawnSync } = require('node:child_process');
const { JobStore } = require('../src/queue/store.cjs');
const {
  detectAts,
  buildApplicationPayload,
  canAutoSubmit,
  autoApplyExternal,
  browserApply,
  findBlockers,
  clickInitialApplyLink,
  clickProgressButton,
  clickFinalSubmit,
  extractAtsApplyUrlFromHtml,
  RESUME4_PATH,
  COVER4_PATH,
  ATS_ADAPTERS,
  getAtsAdapter,
  fillAdapterSpecificFields,
  choosePromptDropdown,
  classifyScreeningAnswer,
  companyFromJobPageData,
  refreshPayloadCoverLetterFromVerifiedEmployer
}=require('../src/apply/ats-auto-apply.cjs');
const { openExternalApplication } = require('../src/apply/open-external.cjs');

test('adapter-specific filler handles Workable QA radios and compound details textarea', async () => {
  const yes = { type:'radio', name:'QA_1', value:'true', checked:false, disabled:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], click(){ this.checked=true; }, getAttribute:()=>'', closest:()=>({innerText:'Production ML Engineering YES'}) };
  const no = { type:'radio', name:'QA_1', value:'false', checked:false, disabled:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], click(){ this.checked=true; }, getAttribute:()=>'', closest:()=>({innerText:'Production ML Engineering NO'}) };
  const details = { tagName:'TEXTAREA', type:'textarea', name:'QA_11542988', id:'QA_11542988', value:'', disabled:false, readOnly:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', closest:()=>({innerText:'LinkedIn URL Current Location Expected salary work authorisation available to start'}), dispatchEvent:()=>{} };
  const page = { evaluate: async (fn, a) => {
    global.HTMLTextAreaElement = { prototype: {} };
    global.HTMLInputElement = { prototype: {} };
    global.Event = class { constructor(){} };
    global.document = { querySelectorAll: (selector) => selector === 'input[type=radio]' ? [yes,no] : selector === 'textarea,input' ? [details] : [] };
    try { return fn(a); } finally { delete global.document; }
  }};
  await fillAdapterSpecificFields(page, { ats:'workable', profile:{ linkedin:'https://linkedin.example/in/a', location:'Seattle, WA, USA', workAuth:'US Citizen' } });
  assert.equal(yes.checked, true);
  assert.match(details.value, /350,000/);
  assert.match(details.value, /Seattle/);
});

test('adapter-specific filler clicks Workable div role radio wrappers with hidden inputs', async () => {
  const question = { innerText:'Do you have 5+ years of experience managing software implementation projects for customers?' };
  const yesLabel = { innerText:'YES' };
  const noLabel = { innerText:'NO' };
  const fieldset = { innerText:'Do you have 5+ years of experience managing software implementation projects for customers? YES NO' };
  const yesInput = { value:'true', checked:false, dispatchEvent:()=>{} };
  const noInput = { value:'false', checked:false, dispatchEvent:()=>{} };
  function roleRadio(labelEl, input) {
    return {
      offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], parentElement:fieldset,
      attrs:{'aria-checked':'false','aria-labelledby':`q ${labelEl === yesLabel ? 'yes' : 'no'}`},
      getAttribute(name){ return this.attrs[name] || ''; },
      setAttribute(name,value){ this.attrs[name]=value; },
      closest(sel){ return sel.includes('radiogroup') ? fieldset : { innerText:`${question.innerText} ${labelEl.innerText}` }; },
      querySelector(){ return input; },
      click(){ input.checked=true; this.attrs['aria-checked']='true'; }
    };
  }
  const yes = roleRadio(yesLabel, yesInput);
  const no = roleRadio(noLabel, noInput);
  const page = { evaluate: async (fn, a) => {
    global.HTMLTextAreaElement = { prototype: {} };
    global.HTMLInputElement = { prototype: {} };
    global.Event = class { constructor(){} };
    global.document = {
      getElementById: (id) => id === 'q' ? question : id === 'yes' ? yesLabel : id === 'no' ? noLabel : null,
      querySelector: () => null,
      querySelectorAll: (selector) => selector === '[role="radio"]' ? [yes,no] : []
    };
    try { return fn(a); } finally { delete global.document; }
  }};
  await fillAdapterSpecificFields(page, { ats:'workable', profile:{} });
  assert.equal(yesInput.checked, true);
  assert.equal(noInput.checked, false);
});

test('generic screening classifier answers by question meaning, not exact hardcoded wording', () => {
  assert.equal(classifyScreeningAnswer('Do you have 5+ years of experience managing software implementation projects for customers?'), 'yes');
  assert.equal(classifyScreeningAnswer('Have you successfully delivered healthcare IT solutions in hospital settings?'), 'no');
  assert.equal(classifyScreeningAnswer('Can you deliver clear written and verbal communication when translating between technical and clinical audiences?'), 'yes');
  assert.equal(classifyScreeningAnswer('Do you have experience with EHR systems (MEDITECH, Oracle Health/Cerner, Epic) or healthcare data standards (HL7, FHIR)?'), 'no');
  assert.equal(classifyScreeningAnswer('Do you have PMP certification or equivalent project management credentials?'), 'no');
  assert.equal(classifyScreeningAnswer('Do you have experience at a healthcare technology vendor?'), 'yes');
  assert.equal(classifyScreeningAnswer('Are you currently authorized to work in the United States without visa sponsorship?'), 'yes');
  assert.equal(classifyScreeningAnswer('Will you now or in the future require sponsorship for employment visa status (e.g., H-1B or other work visa)?'), 'no');
  assert.equal(classifyScreeningAnswer('Have you been previously employed with Weedmaps?'), 'no');
  assert.equal(classifyScreeningAnswer('In this question description we have provided a link to our California Consumer Privacy Act (CCPA) disclosure. Please acknowledge that you have been provided with this disclosure'), 'yes');
  assert.equal(classifyScreeningAnswer('Do you have any family or friends currently employed by CIQ?'), 'no');
  assert.equal(classifyScreeningAnswer('Are you 18 years of age or older?'), 'yes');
  assert.equal(classifyScreeningAnswer('Have you worked at a startup company before?'), 'yes');
  assert.equal(classifyScreeningAnswer('Are you interested in Full-Time employment with CIQ?'), 'yes');
  assert.equal(classifyScreeningAnswer('If yes, how are you authorized?', ['US Citizenship','US Permanent Resident','Visa','None of the above apply']), 'US Citizenship');
  assert.equal(classifyScreeningAnswer('What is your favorite database?'), null);
});

test('adapter-specific filler handles Breezy required radios and proficiency selects', async () => {
  const citizenQuestion = { innerText:'Are you a citizen of the United States (or have an active Green Card) and living in one the 50 states?* Yes No', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] };
  const salaryQuestion = { innerText:'The starting salary range for this position is $145,000-$160,000. Is this an acceptable starting salary range and benefits package for you?* Yes No', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] };
  const citizenYes = { type:'radio', name:'section_question_0', value:'Yes', checked:false, disabled:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; }, closest:()=>citizenQuestion };
  const citizenNo = { type:'radio', name:'section_question_0', value:'No', checked:false, disabled:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; }, closest:()=>citizenQuestion };
  const salaryYes = { type:'radio', name:'section_question_5', value:'Yes', checked:false, disabled:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; }, closest:()=>salaryQuestion };
  const salaryNo = { type:'radio', name:'section_question_5', value:'No', checked:false, disabled:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; }, closest:()=>salaryQuestion };
  function mkSelect(question) {
    return {
      tagName:'SELECT', name:'section_question_select', value:'? undefined:undefined ?', disabled:false,
      offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', dispatchEvent:()=>{},
      options:[
        { value:'? undefined:undefined ?', text:'' },
        { value:'None', text:'None' },
        { value:'Novice', text:'Novice' },
        { value:'Advanced Beginner', text:'Advanced Beginner' },
        { value:'Competent', text:'Competent' },
        { value:'Proficient', text:'Proficient' },
        { value:'Expert', text:'Expert' }
      ],
      closest:(selector)=> selector.includes('.dropdown') || selector.includes('li.question') ? { innerText:question, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] } : null
    };
  }
  const ts = mkSelect('What is your proficiency with Typescript?* None Novice Advanced Beginner Competent Proficient Expert');
  const go = mkSelect('What is your proficiency with Go language?* None Novice Advanced Beginner Competent Proficient Expert');
  const page = { evaluate: async (fn, a) => {
    global.HTMLTextAreaElement = { prototype: {} };
    global.HTMLInputElement = { prototype: {} };
    global.Event = class { constructor(){} };
    global.CSS = { escape: s => s };
    global.document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (selector) => {
        if (selector === 'input[type=radio]') return [citizenYes, citizenNo, salaryYes, salaryNo];
        if (selector === 'select') return [ts, go];
        return [];
      }
    };
    try { return fn(a); } finally { delete global.document; delete global.CSS; }
  }};
  await fillAdapterSpecificFields(page, { ats:'breezy', profile:{} });
  assert.equal(citizenYes.checked, true);
  assert.equal(salaryNo.checked, true);
  assert.equal(ts.value, 'Expert');
  assert.equal(go.value, 'None');
});

test('adapter-specific filler handles Greenhouse hidden radios and required acknowledgements', async () => {
  const authYes = { type:'radio', name:'auth', value:'Yes', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const authNo = { type:'radio', name:'auth', value:'No', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const sponsorYes = { type:'radio', name:'sponsor', value:'Yes', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const sponsorNo = { type:'radio', name:'sponsor', value:'No', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const prevYes = { type:'radio', name:'prev', value:'Yes', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const prevNo = { type:'radio', name:'prev', value:'No', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const ack = { type:'checkbox', name:'ccpa', checked:false, disabled:false, readOnly:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:(n)=> n === 'aria-required' ? 'true' : '', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const phone = { tagName:'INPUT', type:'tel', id:'phone', value:'', disabled:false, readOnly:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:(n)=> n === 'aria-label' ? 'Phone' : '', dispatchEvent:()=>{} };
  const groups = {
    auth: { innerText:'Are you legally authorized to work in the United States? Yes No', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    sponsor: { innerText:'Will you now or in the future require sponsorship for employment visa status? Yes No', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    prev: { innerText:'Have you been previously employed with Weedmaps? Yes No', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    ack: { innerText:'California Consumer Privacy Act CCPA disclosure acknowledge', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    phone: { innerText:'Phone', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] }
  };
  for (const r of [authYes, authNo]) r.closest = () => groups.auth;
  for (const r of [sponsorYes, sponsorNo]) r.closest = () => groups.sponsor;
  for (const r of [prevYes, prevNo]) r.closest = () => groups.prev;
  ack.closest = () => groups.ack;
  phone.closest = () => groups.phone;
  const page = { evaluate: async (fn, a) => {
    global.HTMLTextAreaElement = { prototype: {} };
    global.HTMLInputElement = { prototype: {} };
    global.Event = class { constructor(){} };
    global.CSS = { escape: s => s };
    global.document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (selector) => {
        if (selector === 'input[type=radio]') return [authYes, authNo, sponsorYes, sponsorNo, prevYes, prevNo];
        if (selector === '[role="radio"]') return [];
        if (selector === 'input,textarea' || selector === 'input, textarea') return [phone];
        if (selector === 'select') return [];
        if (selector === 'input[type=checkbox]') return [ack];
        return [];
      }
    };
    try { return fn(a); } finally { delete global.document; delete global.CSS; }
  }};
  await fillAdapterSpecificFields(page, { ats:'greenhouse', profile:{ phone:'(555) 123-4567' } });
  assert.equal(authYes.checked, true);
  assert.equal(sponsorNo.checked, true);
  assert.equal(prevNo.checked, true);
  assert.equal(ack.checked, true);
  assert.equal(phone.value, '5551234567');
});

test('Greenhouse prompt dropdown picks sibling select control from label-only question container', async () => {
  let clickedControl = false;
  let pickedNo = false;
  const label = {
    innerText:'Will you now or in the future require sponsorship for employment visa status?*', textContent:'Will you now or in the future require sponsorship for employment visa status?*', offsetWidth:10, offsetHeight:10,
    getClientRects:()=>[1], getBoundingClientRect:()=>({top:100,left:20,width:300,height:20}), getAttribute:()=>'', querySelectorAll:()=>[], click:()=>{}
  };
  const control = {
    innerText:'Select...', textContent:'Select...', className:'select__control remix-css-13cymwt-control', offsetWidth:10, offsetHeight:10,
    getClientRects:()=>[1], getBoundingClientRect:()=>({top:128,left:20,width:260,height:36}), getAttribute:()=>'', querySelectorAll:()=>[], click(){ clickedControl = true; }
  };
  const field = {
    innerText:`${label.innerText} Select...`, textContent:`${label.innerText} Select...`, offsetWidth:10, offsetHeight:10,
    getClientRects:()=>[1], getBoundingClientRect:()=>({top:96,left:15,width:330,height:80}), getAttribute:()=>'', parentElement:null,
    querySelectorAll:(selector)=> selector.includes('select__control') ? [control] : []
  };
  label.parentElement = field;
  control.parentElement = field;
  const yesOpt = { innerText:'Yes', textContent:'Yes', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', click:()=>{} };
  const noOpt = { innerText:'No', textContent:'No', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', click(){ pickedNo = true; } };
  const page = { evaluate: async (fn, arg) => {
    global.document = {
      querySelectorAll: (selector) => {
        if (selector.includes('[role="option"]')) return [yesOpt, noOpt];
        if (selector.includes('button') || selector.includes('select__control')) return [];
        if (selector.includes('.field-wrapper')) return [label, field];
        return [];
      }
    };
    try { return fn(arg); } finally { delete global.document; }
  }};
  const ok = await choosePromptDropdown(page, /sponsor|sponsorship|visa/i, [/^no$/i]);
  assert.equal(ok, true);
  assert.equal(clickedControl, true);
  assert.equal(pickedNo, true);
});

test('adapter-specific filler answers CIQ-style Greenhouse required radios and text inputs', async () => {
  const familyYes = { type:'radio', name:'family', value:'Yes', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const familyNo = { type:'radio', name:'family', value:'No', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const over18Yes = { type:'radio', name:'over18', value:'Yes', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const over18No = { type:'radio', name:'over18', value:'No', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const startupYes = { type:'radio', name:'startup', value:'Yes', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const startupNo = { type:'radio', name:'startup', value:'No', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const fullTimeYes = { type:'radio', name:'fulltime', value:'Yes', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const fullTimeNo = { type:'radio', name:'fulltime', value:'No', checked:false, disabled:false, offsetWidth:0, offsetHeight:0, getClientRects:()=>[], getAttribute:()=>'', dispatchEvent:()=>{}, click(){ this.checked=true; } };
  const groups = {
    family: { innerText:'Do you have any family or friends currently employed by CIQ? Yes No', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    over18: { innerText:'Are you 18 years of age or older? Yes No', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    startup: { innerText:'Have you worked at a startup company before? Yes No', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    fulltime: { innerText:'Are you interested in Full-Time employment with CIQ? Yes No', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    familyName: { innerText:'If yes, please tell us their name(s). Otherwise, please list N/A.', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    remoteLocation: { innerText:'Since this position would be remote, where would you be working from (Country, State, City)?', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    startDate: { innerText:'If offered the position, what is your available start date?', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] },
    salary: { innerText:'What is your desired salary amount for this position?', offsetWidth:10, offsetHeight:10, getClientRects:()=>[1] }
  };
  const familyName = { tagName:'INPUT', type:'text', id:'question_family_name', name:'question_family_name', value:'', disabled:false, readOnly:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', dispatchEvent:()=>{}, closest:()=>groups.familyName };
  const remoteLocation = { tagName:'INPUT', type:'text', id:'question_remote_location', name:'question_remote_location', value:'', disabled:false, readOnly:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', dispatchEvent:()=>{}, closest:()=>groups.remoteLocation };
  const startDate = { tagName:'INPUT', type:'text', id:'question_start_date', name:'question_start_date', value:'', disabled:false, readOnly:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', dispatchEvent:()=>{}, closest:()=>groups.startDate };
  const salary = { tagName:'INPUT', type:'text', id:'question_salary', name:'question_salary', value:'', disabled:false, readOnly:false, offsetWidth:10, offsetHeight:10, getClientRects:()=>[1], getAttribute:()=>'', dispatchEvent:()=>{}, closest:()=>groups.salary };
  for (const r of [familyYes, familyNo]) r.closest = () => groups.family;
  for (const r of [over18Yes, over18No]) r.closest = () => groups.over18;
  for (const r of [startupYes, startupNo]) r.closest = () => groups.startup;
  for (const r of [fullTimeYes, fullTimeNo]) r.closest = () => groups.fulltime;
  const page = { evaluate: async (fn, a) => {
    global.HTMLTextAreaElement = { prototype: {} };
    global.HTMLInputElement = { prototype: {} };
    global.Event = class { constructor(){} };
    global.CSS = { escape: s => s };
    global.document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (selector) => {
        if (selector === 'input[type=radio]') return [familyYes, familyNo, over18Yes, over18No, startupYes, startupNo, fullTimeYes, fullTimeNo];
        if (selector === '[role="radio"]') return [];
        if (selector === 'input,textarea' || selector === 'input, textarea') return [familyName, remoteLocation, startDate, salary];
        if (selector === 'textarea,input' || selector === 'textarea, input') return [familyName, remoteLocation, startDate, salary];
        if (selector === 'select') return [];
        if (selector === 'input[type=checkbox]') return [];
        return [];
      }
    };
    try { return fn(a); } finally { delete global.document; delete global.CSS; }
  }};
  await fillAdapterSpecificFields(page, { ats:'greenhouse', profile:{ location:'Los Gatos, CA, USA' } });
  assert.equal(familyNo.checked, true);
  assert.equal(over18Yes.checked, true);
  assert.equal(startupYes.checked, true);
  assert.equal(fullTimeYes.checked, true);
  assert.equal(familyName.value, 'N/A');
  assert.equal(remoteLocation.value, 'Los Gatos, CA, USA');
  assert.equal(startDate.value, 'Immediately');
  assert.equal(salary.value, '$350,000');
});

test('ATS adapter registry defines per-site browser behavior', () => {
  for (const ats of ['greenhouse','lever','applytojob','breezy','workable','ashby','icims']) {
    assert.equal(getAtsAdapter(ats).id, ats);
  }
  assert.equal(typeof ATS_ADAPTERS.applytojob.allowFinalSubmit, 'function');
  assert.ok(ATS_ADAPTERS.greenhouse.ignoreRequired({ getAttribute: (name) => name === 'aria-hidden' ? 'true' : '', tabIndex: -1, className: 'requiredInput' }));
  assert.match(ATS_ADAPTERS.lever.normalizeUrl('https://jobs.lever.co/acme/abc'), /\/apply$/);
  assert.equal(ATS_ADAPTERS.breezy.normalizeUrl('https://acme.breezy.hr/p/abc-role'), 'https://acme.breezy.hr/p/abc/apply');
  assert.equal(ATS_ADAPTERS.breezy.normalizeUrl('https://acme.breezy.hr/p/abc123-job-title'), 'https://acme.breezy.hr/p/abc123/apply');
  assert.match(ATS_ADAPTERS.workable.normalizeUrl('https://apply.workable.com/acme/j/ABC'), /\/apply\/$/);
});

test('detectAts identifies supported ATS and email URLs',()=>{
  assert.equal(detectAts('https://boards.greenhouse.io/acme/jobs/123'), 'greenhouse');
  assert.equal(detectAts('https://jobs.lever.co/acme/abc'), 'lever');
  assert.equal(detectAts('https://jobs.ashbyhq.com/acme/abc'), 'ashby');
  assert.equal(detectAts('https://apply.workable.com/acme/j/ABC/'), 'workable');
  assert.equal(detectAts('https://jobs.smartrecruiters.com/Foo/123'), 'smartrecruiters');
  assert.equal(detectAts('https://foo.wd5.myworkdayjobs.com/en-US/jobs/job/123'), 'workday');
  assert.equal(detectAts('https://company.bamboohr.com/careers/123'), 'bamboohr');
  assert.equal(detectAts('https://company.applytojob.com/apply/123'), 'applytojob');
  assert.equal(detectAts('https://company.breezy.hr/p/123'), 'breezy');
  assert.equal(detectAts('https://careers-company.icims.com/jobs/123/job'), 'icims');
  assert.equal(detectAts('https://jobs.jobvite.com/company/job/123'), 'jobvite');
  assert.equal(detectAts('https://company.recruiterbox.com/jobs/123'), 'recruiterbox');
  assert.equal(detectAts('mailto:jobs@example.com'), 'email');
  assert.equal(detectAts('https://example.com/apply'), 'unknown');
  assert.equal(detectAts('https://example.com/jobs/greenhouse-role'), 'unknown');
  assert.equal(detectAts('https://not-ashby.example.com/jobs/123'), 'unknown');
});

test('buildApplicationPayload uses resume4/cover4 PDFs and does not hallucinate missing email',()=>{
  const oldEmail=process.env.HERMES_APPLICANT_EMAIL;
  const oldPhone=process.env.HERMES_APPLICANT_PHONE;
  delete process.env.HERMES_APPLICANT_EMAIL;
  delete process.env.HERMES_APPLICANT_PHONE;
  try {
    const payload=buildApplicationPayload({title:'AI Engineer',company:'Acme',coverLetter:'hello'});
    assert.equal(payload.resumePath, RESUME4_PATH);
    assert.equal(path.basename(payload.resumePath), 'anthony.ettinger.resume4.pdf');
    assert.equal(payload.coverPdfPath, COVER4_PATH);
    assert.equal(path.basename(payload.coverPdfPath), 'anthony.ettinger.cover4.pdf');
    assert.equal(payload.profile.name, 'Anthony Ettinger');
    assert.equal(payload.profile.email, '');
    assert.equal(payload.profile.phone, '');
    assert.equal(payload.coverLetter, 'hello');
  } finally {
    if (oldEmail === undefined) delete process.env.HERMES_APPLICANT_EMAIL; else process.env.HERMES_APPLICANT_EMAIL=oldEmail;
    if (oldPhone === undefined) delete process.env.HERMES_APPLICANT_PHONE; else process.env.HERMES_APPLICANT_PHONE=oldPhone;
  }
});

test('buildApplicationPayload normalizes Lever job pages to the direct /apply form URL',()=>{
  const payload=buildApplicationPayload({applicationMode:'external-ats',applyUrl:'https://jobs.lever.co/smart-working-solutions/c9fc3a3a-ca9d-4bdd-89e8-6d4eab4a19f6'});
  assert.equal(payload.ats, 'lever');
  assert.equal(payload.url, 'https://jobs.lever.co/smart-working-solutions/c9fc3a3a-ca9d-4bdd-89e8-6d4eab4a19f6/apply');
});

test('job-page employer extraction uses structured hiringOrganization and rejects ATS/generic names',()=>{
  assert.equal(companyFromJobPageData({jsonLd:[{'@type':'JobPosting',hiringOrganization:{name:'Actual Employer Inc.'}}]}), 'Actual Employer Inc.');
  assert.equal(companyFromJobPageData({jsonLd:[{'@type':'JobPosting',hiringOrganization:{name:'Greenhouse'}}], explicit:['Lever']}), '');
  assert.equal(companyFromJobPageData({jsonLd:[{'@type':'JobPosting',hiringOrganization:{name:'Company Website'}}], explicit:['Company Website','Careers']}), '');
});

test('external ATS payload cover letter is regenerated from verified job-page employer only',()=>{
  const stale = 'Hi Greenlight team,\n\nOld stale text.';
  const payload=buildApplicationPayload({
    source:'valueserp-ats',
    applicationMode:'external-ats',
    applyUrl:'https://jobs.lever.co/greenlight/abc/apply',
    title:'Claude Engineer',
    company:'Greenlight',
    coverLetter:stale,
    metadata:{ats:'lever'}
  });
  refreshPayloadCoverLetterFromVerifiedEmployer(payload, '');
  assert.match(payload.coverLetter, /^Hi hiring team,/);
  assert.doesNotMatch(payload.coverLetter, /Hi Greenlight team/i);
  const verified=refreshPayloadCoverLetterFromVerifiedEmployer(payload, 'Acme Robotics');
  assert.equal(verified, 'Acme Robotics');
  assert.equal(payload.job.company, 'Acme Robotics');
  assert.equal(payload.job.metadata.employerVerifiedFromJobPage, true);
  assert.match(payload.coverLetter, /^Hi Acme Robotics team,/);
});

test('canAutoSubmit is true only for known external ATS/email flows',()=>{
  assert.equal(canAutoSubmit({applicationMode:'external-ats',applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}), true);
  assert.equal(canAutoSubmit({applicationMode:'email',applyUrl:'mailto:jobs@example.com'}), true);
  assert.equal(canAutoSubmit({applicationMode:'external-ats',applyUrl:'https://careers.cookunity.com/jobs/7718655003#application-form'}), true);
  assert.equal(canAutoSubmit({applicationMode:'native-profile',applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}), false);
  assert.equal(canAutoSubmit({applicationMode:'marketplace-proposal',applyUrl:'mailto:jobs@example.com'}), false);
  assert.equal(canAutoSubmit({applicationMode:'external-ats',applyUrl:'https://example.com/apply'}), true);
});

test('openExternalApplication dry-run/prep for Greenhouse returns prepared with ats and resume4.pdf',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ats-open-'));
  const result=await openExternalApplication({job:{id:'g1',applicationMode:'external-ats',applyUrl:'https://boards.greenhouse.io/acme/jobs/123',title:'Engineer',company:'Acme'},dryRun:true,storeDir:dir});
  assert.equal(result.status, 'prepared');
  assert.equal(result.ats, 'greenhouse');
  assert.equal(result.resumePath, RESUME4_PATH);
  assert.equal(result.coverPdfPath, COVER4_PATH);
});

test('openExternalApplication run-live with unsupported unknown URL is never submitted',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ats-open-'));
  const result=await openExternalApplication({job:{id:'u1',applicationMode:'external-ats',applyUrl:'https://example.com/apply'},dryRun:false,submit:true,storeDir:dir});
  assert.match(result.status, /unsupported|needs-human-review/);
  assert.notEqual(result.status, 'submitted');
});

test('extracts real ATS apply links from aggregator HTML before applying',async()=>{
  const html='<html><body><a href="https://boards.greenhouse.io/acme/jobs/123?gh_src=agg">Apply now</a><a href="https://linkedin.com/share">Share</a></body></html>';
  assert.equal(extractAtsApplyUrlFromHtml(html, 'https://remotive.com/remote-jobs/dev/role'), 'https://boards.greenhouse.io/acme/jobs/123?gh_src=agg');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ats-resolve-'));
  const result=await autoApplyExternal({
    job:{id:'agg1',applicationMode:'external-ats',applyUrl:'https://remotive.com/remote-jobs/dev/role',title:'Engineer',company:'Acme'},
    dryRun:true,
    storeDir:dir,
    fetchPageHtml:async()=>html
  });
  assert.equal(result.status,'prepared');
  assert.equal(result.ats,'greenhouse');
  assert.equal(result.url,'https://boards.greenhouse.io/acme/jobs/123?gh_src=agg');
});

test('does not resolve CAPTCHA solver links as apply targets',()=>{
  const html='<a href="https://2captcha.com/demo">captcha helper</a><a href="https://example.com/apply">Apply</a>';
  assert.equal(extractAtsApplyUrlFromHtml(html, 'https://example.com/jobs/1'), '');
});

test('email apply writes draft in dry-run and does not send without SMTP credentials',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ats-email-'));
  const result=await autoApplyExternal({job:{id:'m1',applicationMode:'email',applyUrl:'mailto:jobs@example.com?subject=Engineer',title:'Engineer',company:'Acme'},dryRun:true,storeDir:dir});
  assert.equal(result.status, 'prepared');
  assert.equal(result.ats, 'email');
  assert.ok(result.draftPath);
  assert.match(fs.readFileSync(result.draftPath,'utf8'), /To: jobs@example.com/);
  assert.match(fs.readFileSync(result.draftPath,'utf8'), /anthony\.ettinger\.cover4\.pdf/);
});

function fakePuppeteer({blockers=[], clicked=true, verified=true, anchorOnly=false}={}) {
  const state = { launchOptions:null, queries:[], auth:null };
  const isSuccess = verified === true || verified === 'success';
  const isSpam = verified === 'spam-blocked';
  const page = {
    url: () => 'https://boards.greenhouse.io/acme/jobs/123',
    goto: async()=>{},
    waitForTimeout: async()=>{},
    waitForFunction: async()=>{},
    waitForNavigation: async()=>{},
    setViewport: async()=>{},
    setUserAgent: async()=>{},
    authenticate: async(creds)=>{ state.auth=creds; },
    $: async()=>({click:async()=>{},type:async()=>{}}),
    $$: async()=>[{uploadFile:async()=>{},evaluate:async()=>''}],
    evaluate: async(fn, arg)=>{
      const src = String(fn);
      if (src.includes('blockers = []')) return blockers;
      if (src.includes('errorSelectors') || src.includes('invalid-feedback')) return [];
      if (src.includes("button, input[type=submit]") || src.includes('adapterSpec.selectors')) { state.queries.push('safe-submit-selector'); return anchorOnly ? false : clicked; }
      if (src.includes('application submitted')) return verified;
      if (src.includes('readyState')) return true;
      // waitForSubmitToSettle evaluate - return matching success/spam state
      if (src.includes('submitting') || src.includes('please wait')) return {busy:false, success:isSuccess, spam:isSpam, errors:false};
      // ensureNonEmptyPage - its evaluate is the shortest innerText check
      if (src.includes('innerText') && src.length < 100) return 'Apply for Engineer at Acme Corp. First name Last name Email Phone Location Submit Application';
      return null;
    }
  };
  return {state, puppeteer:{launch:async(options)=>{ state.launchOptions=options; return {newPage:async()=>page, close:async()=>{}}; }}};
}

test('browserApply does not use sandbox-disabling args by default and verifies submission success',async()=>{
  const {state,puppeteer}=fakePuppeteer({verified:true});
  const result=await browserApply({job:{id:'b1'},payload:buildApplicationPayload({applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}),opts:{puppeteer,submit:true,verifyAttempts:1,verifyDelayMs:10,verifyInitialDelayMs:10,submitSettleMs:10}});
  assert.equal(result.status,'submitted');
  assert.equal(result.reason,'submission-verified');
  assert.deepEqual(state.launchOptions.args,['--disable-dev-shm-usage']);
  assert.deepEqual(state.queries,['safe-submit-selector']);
});

test('browserApply configures Chromium proxy and authenticates when PROXY_URL is set',async()=>{
  const {state,puppeteer}=fakePuppeteer({verified:true});
  const oldProxy=process.env.PROXY_URL;
  process.env.PROXY_URL='http://user%40name:pa%24%24@proxy.example:8080';
  try {
    const result=await browserApply({job:{id:'b1p'},payload:buildApplicationPayload({applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}),opts:{puppeteer,submit:true,verifyAttempts:1,verifyDelayMs:10,verifyInitialDelayMs:10,submitSettleMs:10}});
    assert.equal(result.status,'submitted');
    assert.ok(state.launchOptions.args.includes('--proxy-server=http://proxy.example:8080'));
    assert.deepEqual(state.auth,{username:'user@name',password:'pa$$'});
  } finally {
    if (oldProxy === undefined) delete process.env.PROXY_URL; else process.env.PROXY_URL=oldProxy;
  }
});

test('browserApply returns needs-human-review when click is not verified',async()=>{
  const {puppeteer}=fakePuppeteer({verified:false});
  const result=await browserApply({job:{id:'b2'},payload:buildApplicationPayload({applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}),opts:{puppeteer,submit:true,verifyAttempts:1,verifyDelayMs:10,verifyInitialDelayMs:10,submitSettleMs:10}});
  assert.equal(result.status,'needs-human-review');
  assert.match(result.reason,/submission-unverified/);
});

test('browserApply treats successful same-page API submit responses as verified submissions', async()=>{
  const {puppeteer}=fakePuppeteer({verified:'network'});
  const result=await browserApply({job:{id:'b2n'},payload:buildApplicationPayload({applyUrl:'https://careers.cookunity.com/jobs/7718655003#application-form'}),opts:{puppeteer,submit:true,verifyAttempts:1,verifyDelayMs:10,verifyInitialDelayMs:10,submitSettleMs:10}});
  assert.equal(result.status,'submitted');
  assert.equal(result.reason,'submission-verified');
});

test('browserApply treats detached-frame submit followups as verified when same-page success text is present', async()=>{
  const {puppeteer}=fakePuppeteer({blockers:['blocker-check-failed: detached Frame'], verified:true});
  const result=await browserApply({job:{id:'b2df'},payload:buildApplicationPayload({applyUrl:'https://careers.cookunity.com/jobs/7718655003#application-form'}),opts:{puppeteer,submit:true,verifyAttempts:1,verifyDelayMs:10,verifyInitialDelayMs:10,submitSettleMs:10}});
  assert.equal(result.status,'submitted');
  assert.equal(result.reason,'submission-verified');
});

test('browserApply classifies Ashby spam-blocked responses as needs-human-review spam-blocked', async()=>{
  const {puppeteer}=fakePuppeteer({verified:'spam-blocked'});
  const result=await browserApply({job:{id:'ashbyspam'},payload:buildApplicationPayload({applyUrl:'https://jobs.ashbyhq.com/acme/123/application'}),opts:{puppeteer,submit:true,verifyAttempts:1,verifyDelayMs:10,verifyInitialDelayMs:10,submitSettleMs:10}});
  assert.equal(result.status,'needs-human-review');
  assert.equal(result.reason,'spam-blocked');
});

test('browserApply blocks visible captcha/login/unknown-required before submit',async()=>{
  const {puppeteer}=fakePuppeteer({blockers:['captcha','unknown-required:visa sponsorship']});
  const result=await browserApply({job:{id:'b3'},payload:buildApplicationPayload({applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}),opts:{puppeteer,submit:true,verifyAttempts:1,verifyDelayMs:10,verifyInitialDelayMs:10,submitSettleMs:10}});
  assert.equal(result.status,'needs-human-review');
  assert.match(result.reason,/captcha/);
});

test('findBlockers ignores invisible recaptcha token fields unless there is a visible challenge',async()=>{
  const page={evaluate:async(fn,arg)=>fn(arg)};
  const oldDocument=global.document;
  try {
    global.document={
      body:{innerText:'Name Email Resume Submit Application'},
      querySelector:(selector)=>{
        if(selector.includes('input[type=password]')) return null;
        if(selector.includes('[class*=captcha]')) return [
          {tagName:'TEXTAREA',name:'g-recaptcha-response',id:'g-recaptcha-response-100000',className:'',offsetWidth:300,offsetHeight:60,getClientRects:()=>[{}],getAttribute:(k)=>null},
          {tagName:'IFRAME',name:'a-123',id:'',className:'',src:'https://www.recaptcha.net/recaptcha/api2/anchor?size=invisible',offsetWidth:256,offsetHeight:60,getClientRects:()=>[{}],getAttribute:(k)=>k==='title'?'reCAPTCHA':k==='src'?'https://www.recaptcha.net/recaptcha/api2/anchor?size=invisible':null}
        ];
        return null;
      },
      querySelectorAll:(selector)=>{
        if(selector.includes('[class*=captcha]')) return [
          {tagName:'TEXTAREA',name:'g-recaptcha-response',id:'g-recaptcha-response-100000',className:'',offsetWidth:300,offsetHeight:60,getClientRects:()=>[{}],getAttribute:(k)=>null},
          {tagName:'IFRAME',name:'a-123',id:'',className:'',src:'https://www.recaptcha.net/recaptcha/api2/anchor?size=invisible',offsetWidth:256,offsetHeight:60,getClientRects:()=>[{}],getAttribute:(k)=>k==='title'?'reCAPTCHA':k==='src'?'https://www.recaptcha.net/recaptcha/api2/anchor?size=invisible':null}
        ];
        if(selector==='input, textarea, select') return [
          {required:false,getAttribute:(k)=>k==='aria-required'?null:null,type:'textarea',tagName:'TEXTAREA',name:'g-recaptcha-response',id:'g-recaptcha-response-100000',placeholder:'',value:''}
        ];
        return [];
      }
    };
    assert.deepEqual(await findBlockers(page), []);
  } finally {
    global.document=oldDocument;
  }
});

test('browserApply tries solving captcha before returning captcha-unsolved', async()=>{
  const seen=[];
  const fakePage={
    setViewport: async()=>{},
    setUserAgent: async()=>{},
    goto: async()=>{},
    waitForTimeout: async()=>{},
    waitForNavigation: async()=>{},
    url: ()=> 'https://jobs.lever.co/acme/123/apply',
    evaluate: async(fn,arg)=>{
      const src=String(fn);
      seen.push(src);
      if (src.includes('document.body?.innerText') && src.includes('trim()).catch')) return 'page text';
      if (src.includes('const jsonLd=[]')) return {};
      if (src.includes('button, a[role=button]')) return undefined;
      if (src.includes('blockers = []')) {
        fakePage._blockerCalls = (fakePage._blockerCalls||0) + 1;
        return fakePage._blockerCalls === 1 ? ['captcha'] : [];
      }
      if (src.includes('const hcIframe = document.querySelector')) return { type:'recaptcha', sitekey:'sitekey12345678901234567890' };
      if (src.includes('const candidates = Array.from(document.querySelectorAll(\'a, button, input[type=button], input[type=submit], [role="button"]\')')) return false;
      if (src.includes('button, input[type=submit], input[type=button], a[role=button], a[href="#"], a[href="javascript:void(0)"]')) return 'Submit Application';
      if (src.includes('application submitted')) return true;
      if (src.includes('const text = document.body ? document.body.innerText.toLowerCase() : \'\'')) return {busy:false, success:true, errors:false};
      return null;
    }
  };
  const puppeteer={launch:async()=>({newPage:async()=>fakePage,close:async()=>{}})};
  const oldFetch=global.fetch;
  try {
    global.fetch=async(url)=>({
      json: async()=> String(url).includes('createTask')
        ? { errorId:0, taskId:'t1' }
        : { errorId:0, status:'ready', solution:{ gRecaptchaResponse:'tok123' } }
    });
    process.env.CAPSOLVER_API_KEY='test-key';
    const result=await browserApply({job:{id:'captcha1'},payload:buildApplicationPayload({applyUrl:'https://jobs.lever.co/acme/123/apply'}),opts:{puppeteer,submit:true}});
    assert.equal(result.status,'submitted');
    assert.ok(seen.some(src=>src.includes('const hcIframe = document.querySelector')));
  } finally {
    global.fetch=oldFetch;
    delete process.env.CAPSOLVER_API_KEY;
  }
});

test('clickInitialApplyLink refuses social resume import buttons even when href contains apply return URL', async()=>{
  let clicked=false;
  const page={evaluate:async(fn,arg)=>{
    global.location={pathname:'/p/abc/apply'};
    global.document={querySelectorAll:()=>[{offsetWidth:1,offsetHeight:1,getClientRects:()=>[1],innerText:'Apply Using LinkedIn',href:'https://linkedin.com/oauth?redirect=/apply',click(){clicked=true;},getAttribute:()=>''}]};
    try { return fn(arg); } finally { delete global.document; delete global.location; }
  }};
  const res=await clickInitialApplyLink(page,'breezy');
  assert.equal(res,false);
  assert.equal(clicked,false);
});

test('clickInitialApplyLink clicks Greenhouse aria-label Apply even when non-application fields exist', async()=>{
  let clicked=false;
  const page={evaluate:async(fn,arg)=>fn(arg)};
  const oldDocument=global.document;
  try {
    global.document={
      querySelector:(selector)=> selector === 'input:not([type=hidden]), textarea, select' ? {name:'job-alert-email'} : null,
      querySelectorAll:(selector)=> selector === 'a, button, input[type=button], input[type=submit], [role="button"]' ? [{
        innerText:'',
        value:'',
        href:'',
        offsetWidth:80,
        offsetHeight:24,
        getClientRects:()=>[{}],
        getAttribute:(name)=> name === 'aria-label' ? 'Apply' : null,
        click:()=>{ clicked=true; }
      }] : []
    };
    assert.equal(await clickInitialApplyLink(page, 'greenhouse'), true);
    assert.equal(clicked, true);
  } finally {
    global.document=oldDocument;
  }
});

test('clickInitialApplyLink clicks input apply controls such as Apply Here', async()=>{
  let clicked=false;
  const page={evaluate:async(fn,arg)=>fn(arg)};
  const oldDocument=global.document;
  try {
    global.document={
      querySelectorAll:(selector)=> selector === 'a, button, input[type=button], input[type=submit], [role="button"]' ? [{
        innerText:'',
        value:'Apply Here',
        href:'',
        offsetWidth:120,
        offsetHeight:32,
        getClientRects:()=>[{}],
        getAttribute:(name)=> name === 'aria-label' ? '' : null,
        click:()=>{ clicked=true; }
      }] : []
    };
    assert.equal(await clickInitialApplyLink(page, 'workable'), true);
    assert.equal(clicked, true);
  } finally {
    global.document=oldDocument;
  }
});

test('clickInitialApplyLink clicks role button wrappers for apply actions', async()=>{
  let clicked=false;
  const page={evaluate:async(fn,arg)=>fn(arg)};
  const oldDocument=global.document;
  try {
    global.document={
      querySelectorAll:(selector)=> selector === 'a, button, input[type=button], input[type=submit], [role="button"]' ? [{
        innerText:'Start Application',
        value:'',
        href:'',
        offsetWidth:120,
        offsetHeight:32,
        getClientRects:()=>[{}],
        getAttribute:(name)=> name === 'aria-label' ? 'Start Application' : '',
        click:()=>{ clicked=true; }
      }] : []
    };
    assert.equal(await clickInitialApplyLink(page, 'ashby'), true);
    assert.equal(clicked, true);
  } finally {
    global.document=oldDocument;
  }
});

test('findBlockers ignores hidden required helper inputs', async () => {
  const page = {
    evaluate: async (fn) => {
      global.document = {
        body: { innerText: '' },
        querySelector: (selector) => selector === 'input[type=password]' ? null : null,
        querySelectorAll: (selector) => {
          if (selector.includes('captcha')) return [];
          if (selector === 'input, textarea, select') return [
            { required: true, getAttribute: (name) => name === 'type' ? 'text' : '', name: '', id: '', placeholder: '', value: '', disabled: false, offsetWidth: 0, offsetHeight: 0, getClientRects: () => [] },
            { required: true, getAttribute: (name) => name === 'type' ? 'text' : '', name: 'email', id: 'email', placeholder: '', value: 'anthony@example.com', disabled: false, offsetWidth: 20, offsetHeight: 20, getClientRects: () => [1] },
          ];
          return [];
        }
      };
      try { return fn(); } finally { delete global.document; }
    }
  };
  assert.deepEqual(await findBlockers(page), []);
});

test('clickFinalSubmit clicks ApplyToJob/JazzHR submit anchor by stable id', async () => {
  let clicked=false;
  const page={evaluate:async(fn,arg)=>fn(arg)};
  const oldDocument=global.document;
  try {
    global.document={
      querySelectorAll:(selector)=> selector.includes('a[href="#"]') || selector.includes('button') ? [{
        tagName:'A',
        innerText:'SUBMIT APPLICATION',
        value:'',
        href:'https://cyclotroninc.applytojob.com/apply/muxjx5MbpZ/Sr-AI-Architect#',
        id:'resumator-submit-resume',
        className:'btn',
        offsetWidth:120,
        offsetHeight:32,
        getClientRects:()=>[{}],
        getAttribute:(name)=>null,
        click:()=>{ clicked=true; }
      }] : []
    };
    assert.equal(await clickFinalSubmit(page, 'applytojob'), true);
    assert.equal(clicked, true);
  } finally {
    global.document=oldDocument;
  }
});

test('browserApply does not click anchors as final submit controls',async()=>{
  const {puppeteer}=fakePuppeteer({anchorOnly:true});
  const result=await browserApply({job:{id:'b4'},payload:buildApplicationPayload({applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}),opts:{puppeteer,submit:true,verifyAttempts:1,verifyDelayMs:10,verifyInitialDelayMs:10,submitSettleMs:10}});
  assert.equal(result.status,'needs-human-review');
  assert.match(result.reason,/submit-button-not-found/);
});

test('clickFinalSubmit does not treat initial Apply as final submit for Workday-style pages', async () => {
  let clicked=false;
  const page={evaluate:async(fn,arg)=>fn(arg)};
  const oldDocument=global.document;
  try {
    global.document={querySelectorAll:(selector)=> selector.includes('button') ? [{
      innerText:'Apply', value:'', href:'', id:'', className:'', offsetWidth:80, offsetHeight:30,
      getClientRects:()=>[{}], getAttribute:()=>'', click:()=>{ clicked=true; }
    }] : []};
    assert.equal(await clickFinalSubmit(page, 'workday'), false);
    assert.equal(clicked, false);
  } finally { global.document=oldDocument; }
});

test('clickProgressButton handles Workday Apply Manually progress action', async () => {
  let clicked='';
  const page={evaluate:async(fn)=>fn()};
  const oldDocument=global.document;
  try {
    global.document={querySelectorAll:()=>[
      {innerText:'Company Website',value:'',offsetWidth:80,offsetHeight:20,getClientRects:()=>[{}],getAttribute:()=>'',click(){clicked='bad';}},
      {innerText:'Apply Manually',value:'',offsetWidth:80,offsetHeight:20,getClientRects:()=>[{}],getAttribute:()=>'',click(){clicked='manual';}}
    ]};
    assert.equal(await clickProgressButton(page), 'Apply Manually');
    assert.equal(clicked, 'manual');
  } finally { global.document=oldDocument; }
});

test('findBlockers uses nearby label text for Ashby UUID required fields', async () => {
  const page={evaluate:async(fn)=>fn()};
  const oldDocument=global.document;
  try {
    global.document={
      body:{innerText:''},
      querySelector:()=>null,
      querySelectorAll:(selector)=>{
        if (selector.includes('captcha')) return [];
        if (selector === 'input, textarea, select') return [{
          required:true, tagName:'INPUT', type:'text', name:'a330848c-uuid', id:'a330848c-uuid', placeholder:'1-415-555-1234...', value:'', disabled:false, tabIndex:0,
          offsetWidth:20, offsetHeight:20, getClientRects:()=>[{}], getAttribute:(k)=>k==='type'?'text':null,
          labels:null, closest:()=>({innerText:'Phone number *'})
        }];
        return [];
      }
    };
    assert.deepEqual(await findBlockers(page), ['missing-required-common:phone number * a330848c-uuid a330848c-uuid 1-415-555-1234...']);
  } finally { global.document=oldDocument; }
});

test('CLI jobs apply --approved --run-live for queued Greenhouse job invokes auto-apply dry-test path without network',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jobs-cli-ats-'));
  const s=new JobStore(dir);
  s.enqueue({id:'gcli',source:'web3-career',applicationMode:'external-ats',title:'AI Engineer',company:'Acme',status:'queued',applyUrl:'https://boards.greenhouse.io/acme/jobs/123'});
  let r=spawnSync(process.execPath,['src/cli.cjs','jobs','approve','--id','gcli','--store',dir],{cwd:path.join(__dirname,'..'),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  r=spawnSync(process.execPath,['src/cli.cjs','jobs','apply','--approved','--run-live','--confirm-live-external-apply','--store',dir],{cwd:path.join(__dirname,'..'),encoding:'utf8',env:{...process.env,HERMES_ATS_DRY_TEST:'1'}});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/auto-apply\tprepared\tgcli\tgreenhouse/);
  assert.match(r.stdout,/anthony\.ettinger\.resume4\.pdf/);
  assert.match(r.stdout,/anthony\.ettinger\.cover4\.pdf/);
});
