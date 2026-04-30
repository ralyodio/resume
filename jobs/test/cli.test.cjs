const test=require('node:test'); const assert=require('node:assert/strict'); const {spawnSync}=require('node:child_process');
test('cli help includes commands',()=>{ const r=spawnSync(process.execPath,['src/cli.cjs','--help'],{cwd:__dirname+'/..',encoding:'utf8'}); assert.equal(r.status,0); assert.match(r.stdout,/jobs search/); assert.match(r.stdout,/jobs apply/); });
