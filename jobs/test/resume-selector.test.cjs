const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {selectResume}=require('../src/resumes/select-resume.cjs');

test('selectResume forces anthony.ettinger.resume4.pdf when present, even for AI/web3/etc variants',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'resume-'));
  const fb=path.join(dir,'anthony.ettinger.resume4.pdf'); fs.writeFileSync(fb,'x');
  for (const file of ['resume-ai-engineer.pdf','resume-web3-engineer.pdf','resume-startup-founder-engineer.pdf','resume-distributed-systems.pdf','resume-fullstack.pdf']) fs.writeFileSync(path.join(dir,file),'variant');
  assert.equal(selectResume({title:'LLM AI Engineer'}, {resumeDir:dir,fallbackResume:fb}), fb);
  assert.equal(selectResume({title:'Web3 Blockchain Engineer'}, {resumeDir:dir,fallbackResume:fb}), fb);
  assert.equal(selectResume({title:'Founding Distributed Systems Fullstack Engineer'}, {resumeDir:dir,fallbackResume:fb}), fb);
});

test('selectResume may use an existing variant only when resume4.pdf is missing',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'resume-'));
  const missingFb=path.join(dir,'anthony.ettinger.resume4.pdf');
  const ai=path.join(dir,'resume-ai-engineer.pdf'); fs.writeFileSync(ai,'x');
  assert.equal(selectResume({title:'LLM Engineer'}, {resumeDir:dir,fallbackResume:missingFb}), ai);
});
