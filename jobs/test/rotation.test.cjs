const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

test('jobs rotate supports review-only mode without running legacy scripts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jobs-rotate-'));
  const r=spawnSync(process.execPath,[
    'src/cli.cjs','jobs','rotate',
    '--review-only','--skip-legacy','--limit','1','--query','zzzznojobmatchzzzz','--store',dir
  ],{cwd:__dirname+'/..',encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/rotation complete/);
  assert.match(r.stdout,/legacy skipped/);
});

test('jobs rotate --include-legacy defaults legacy scripts to DRY_RUN',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jobs-rotate-'));
  const r=spawnSync(process.execPath,[
    'src/cli.cjs','jobs','rotate',
    '--include-legacy','--dry-run-legacy','--limit','0','--query','zzzznojobmatchzzzz','--store',dir
  ],{cwd:__dirname+'/..',encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/legacy dry-run/);
  assert.match(r.stdout,/linkedin-legacy/);
  assert.match(r.stdout,/dice-legacy/);
});
