const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const input='/data/workspace/makefun/token-radar-01-kit/token-radar-01-kit/input/snapshot.json';
test('gate rejects tampered coefficients even when stored compMult and board stay unchanged',()=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'radar-gate-'));
 try{fs.cpSync('out',dir,{recursive:true});let text=fs.readFileSync(path.join(dir,'data.js'),'utf8');let d=JSON.parse(text.match(/window\.RADAR\s*=\s*(\{[\s\S]*\});?\s*$/)[1]);d.meta.regression.beta[0]+=.5;fs.writeFileSync(path.join(dir,'data.js'),'window.RADAR = '+JSON.stringify(d)+';\n');const r=spawnSync(process.execPath,['gate-check.cjs','--input',input,'--out',dir],{encoding:'utf8'});fs.writeFileSync('gate-mutation-rejection.txt',r.stdout);assert.notEqual(r.status,0,'tampered coefficients escaped gate');assert.match(r.stdout,/FAIL recompute/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
