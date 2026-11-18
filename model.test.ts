import test from 'node:test';
import assert from 'node:assert/strict';
import {fitValue, predictValue, foldFor,benchmark} from './lib/value.ts';
import {readFileSync} from 'node:fs';
test('held-out targets cannot influence their own fold predictions',()=>{
 const snap=JSON.parse(readFileSync('/data/workspace/makefun/token-radar-01-kit/token-radar-01-kit/input/snapshot.json','utf8'));
 const original=benchmark(snap.protocols,snap.as_of);
 const changed=benchmark(snap.protocols.map(p=>foldFor(p.slug)===0&&p.mcap_usd>0?{...p,mcap_usd:p.mcap_usd*100}:p),snap.as_of);
 assert.deepEqual(original.predictions.filter(p=>p.fold===0).map(p=>p.predicted),changed.predictions.filter(p=>p.fold===0).map(p=>p.predicted));
 assert.ok(original.comparison.bootstrap_replicates===2000);
});
import {farmSteps,planCost} from './lib/model.ts';
test('farm plan does not fabricate gas, eligibility or capabilities',()=>{
 const p={slug:'x',name:'Unknown',category:'Lending',tvl_usd:1e9,chains:['Ethereum','Solana'],change_7d:null,listed_at:null};
 const cost=planCost(p);assert.equal(cost.gas_total_units,null);
 assert.match(cost.line,/illustrative/i);
 const steps=farmSteps(p,'2026-11-14').join(' ');assert.match(steps,/verify/i);assert.doesNotMatch(steps,/points accrue|qualifying|snapshot rewards|confirm your balance accrues/);
});
test('regression discloses a clipped multiple instead of implying a fitted floor is precise',()=>{
 const f={method:'robust',cats:{},center:[0,0,0,0],scale:[1,1,1,1],beta:[-10,0,0,0,0],global:-10,asOf:'2026-11-14'};
 const p={tvl_usd:1e9,change_7d:0,listed_at:null,chains:[],category:'Rare'};
 const result=predictValue(f,p);assert.equal(result.mult,.05);assert.match(result.source,/lower-band clipped/);
});
test('singleton category falls back to global; no giant singleton estimate',()=>{
 const rows=[{slug:'a',category:'Rare',tvl_usd:1e8,mcap_usd:1e12},{slug:'b',category:'Common',tvl_usd:1e8,mcap_usd:2e7},{slug:'c',category:'Common',tvl_usd:1e8,mcap_usd:2e7}];
 const f=fitValue(rows,'shrink');
 const p=predictValue(f,rows[0]);
 assert.ok(p.source.includes('sparse'));
 assert.ok(p.value<1e8);
 assert.equal(foldFor('alpha-v2'),foldFor('alpha-v3'));
});
