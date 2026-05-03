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
  extractAtsApplyUrlFromHtml,
  RESUME4_PATH,
  COVER4_PATH
}=require('../src/apply/ats-auto-apply.cjs');
const { openExternalApplication } = require('../src/apply/open-external.cjs');

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

test('canAutoSubmit is true only for known external ATS/email flows',()=>{
  assert.equal(canAutoSubmit({applicationMode:'external-ats',applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}), true);
  assert.equal(canAutoSubmit({applicationMode:'email',applyUrl:'mailto:jobs@example.com'}), true);
  assert.equal(canAutoSubmit({applicationMode:'native-profile',applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}), false);
  assert.equal(canAutoSubmit({applicationMode:'marketplace-proposal',applyUrl:'mailto:jobs@example.com'}), false);
  assert.equal(canAutoSubmit({applicationMode:'external-ats',applyUrl:'https://example.com/apply'}), false);
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
  const state = { launchOptions:null, queries:[] };
  const page = {
    url: () => 'https://boards.greenhouse.io/acme/jobs/123',
    goto: async()=>{},
    waitForTimeout: async()=>{},
    $: async()=>({click:async()=>{},type:async()=>{}}),
    $$: async()=>[{uploadFile:async()=>{}}],
    evaluate: async(fn, arg)=>{
      const src = String(fn);
      if (src.includes('blockers = []')) return blockers;
      if (src.includes("button, input[type=submit]")) { state.queries.push('safe-submit-selector'); return anchorOnly ? false : clicked; }
      if (src.includes('application submitted')) return verified;
      return null;
    }
  };
  return {state, puppeteer:{launch:async(options)=>{ state.launchOptions=options; return {newPage:async()=>page, close:async()=>{}}; }}};
}

test('browserApply does not use sandbox-disabling args by default and verifies submission success',async()=>{
  const {state,puppeteer}=fakePuppeteer({verified:true});
  const result=await browserApply({job:{id:'b1'},payload:buildApplicationPayload({applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}),opts:{puppeteer,submit:true}});
  assert.equal(result.status,'submitted');
  assert.equal(result.reason,'submission-verified');
  assert.deepEqual(state.launchOptions.args,['--disable-dev-shm-usage']);
  assert.deepEqual(state.queries,['safe-submit-selector']);
});

test('browserApply returns needs-human-review when click is not verified',async()=>{
  const {puppeteer}=fakePuppeteer({verified:false});
  const result=await browserApply({job:{id:'b2'},payload:buildApplicationPayload({applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}),opts:{puppeteer,submit:true}});
  assert.equal(result.status,'needs-human-review');
  assert.match(result.reason,/submission-unverified/);
});

test('browserApply blocks captcha/login/unknown-required before submit',async()=>{
  const {puppeteer}=fakePuppeteer({blockers:['captcha','unknown-required:visa sponsorship']});
  const result=await browserApply({job:{id:'b3'},payload:buildApplicationPayload({applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}),opts:{puppeteer,submit:true}});
  assert.equal(result.status,'needs-human-review');
  assert.match(result.reason,/captcha/);
});

test('browserApply does not click anchors as final submit controls',async()=>{
  const {puppeteer}=fakePuppeteer({anchorOnly:true});
  const result=await browserApply({job:{id:'b4'},payload:buildApplicationPayload({applyUrl:'https://boards.greenhouse.io/acme/jobs/123'}),opts:{puppeteer,submit:true}});
  assert.equal(result.status,'needs-human-review');
  assert.match(result.reason,/submit-button-not-found/);
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
