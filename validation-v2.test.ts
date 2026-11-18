import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runNested,partition} from './nested.ts';
import {calibrate,interval,assessIntervals,explain,split} from './lib/uncertainty.ts';
import {fitValue,predictValue} from './lib/value.ts';
const snap=JSON.parse(readFileSync('/data/workspace/makefun/token-radar-01-kit/token-radar-01-kit/input/snapshot.json','utf8'));
test('nested settings and predictions exclude every outer target',()=>{
 const a=runNested(snap.protocols,snap.as_of);
 for(let outer=0;outer<5;outer++){
 const changed=snap.protocols.map(p=>partition(p.slug,'radar-nested-v2:',5)===outer&&p.mcap_usd>0?{...p,mcap_usd:p.mcap_usd*100}:p),b=runNested(changed,snap.as_of);
 assert.deepEqual(a.folds[outer].selections,b.folds[outer].selections);
 assert.deepEqual(a.predictions.filter(p=>p.outer===outer).map(p=>p.predicted),b.predictions.filter(p=>p.outer===outer).map(p=>p.predicted));
 }
 assert.equal(a.predictions.length,119*4);
});
test('uncertainty calibration and endpoints exclude outer targets',()=>{
 const a=assessIntervals(snap.protocols,snap.as_of);
 for(let outer=0;outer<5;outer++){
 const changed=snap.protocols.map(p=>partition(p.slug,'radar-nested-v2:',5)===outer&&p.mcap_usd>0?{...p,mcap_usd:p.mcap_usd*100}:p),b=assessIntervals(changed,snap.as_of);
 const endpoints=x=>x.predictions.filter(p=>p.outer===outer).map(p=>[p.lower_usd,p.upper_usd,p.reference_value_usd]);assert.deepEqual(endpoints(a),endpoints(b));
 }
});
test('finite-sample residual quantile is actual held-out order statistic',()=>{
 const c=calibrate(snap.protocols,snap.as_of),cal=snap.protocols.filter(p=>p.category!=='CEX'&&p.tvl_usd>0&&p.mcap_usd>0&&Number.isFinite(p.mcap_usd)&&split(p,'radar-cal-v2:')===0);
 const errors=cal.map(p=>Math.abs(Math.log(predictValue(c.fit,p).value/p.mcap_usd))).sort((a,b)=>a-b);assert.equal(c.q,errors[Math.ceil((cal.length+1)*.8)-1]);assert.equal(c.train_n+c.calibration_n,119);
 const v=interval(c,cal[0]);assert.ok(v.lower_usd<=v.reference_value_usd&&v.upper_usd>=v.reference_value_usd);
});
test('contributions reconcile exactly and flags disclose missing inputs',()=>{
 const f=fitValue(snap.protocols.filter(p=>p.category!=='CEX'),'robust',snap.as_of),p={slug:'unknown',tvl_usd:1e6,chains:[],category:null,listed_at:null,change_7d:null};
 const e=explain(f,p,snap.as_of);assert.ok(e.flags.some(x=>/growth imputed/.test(x)));assert.ok(e.flags.some(x=>/age imputed/.test(x)));assert.equal(e.terms.length,4);assert.ok(Math.abs(e.unclipped_log_multiple-e.intercept-e.terms.reduce((s,t)=>s+t.log_contribution,0))<1e-12);
 assert.equal(predictValue(f,p).value,Math.round(p.tvl_usd*Math.min(2,Math.max(.05,Math.exp(e.unclipped_log_multiple)))));
});
