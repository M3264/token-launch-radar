import {tokenGroups} from './identity.ts';
import {createHash} from 'node:crypto';
import {fitValue,predictValue} from './value.ts';
import {ageDays,median} from './model.ts';
const group=(p:any)=>p.slug.replace(/[-_ ]v?\d+(\.\d+)?$/i,'');
export const split=(p:any,salt:string,n=5,groups?:Map<string,string>)=>createHash('sha256').update(salt+(groups?.get(p.slug)??group(p))).digest().readUInt32BE(0)%n;
const eligible=(rows:any[])=>rows.filter(p=>p.category!=='CEX'&&p.tvl_usd>0&&p.mcap_usd>0&&Number.isFinite(p.mcap_usd));
export function calibrate(rows:any[],asOf:string):any{
 const live=eligible(rows),groups=tokenGroups(live),train=live.filter(p=>split(p,'radar-cal-v2:',5,groups)!==0),cal=live.filter(p=>split(p,'radar-cal-v2:',5,groups)===0);
 const fit=fitValue(train,'robust',asOf),errors=cal.map(p=>Math.abs(Math.log(predictValue(fit,p).value/p.mcap_usd))).sort((a,b)=>a-b);
 const order=Math.ceil((cal.length+1)*.8),q=order<=errors.length?errors[order-1]:Infinity;
 return {fit,q,factor:Math.exp(q),nominal:.8,train_n:train.length,calibration_n:cal.length,order,method:'Split-conformal absolute log residuals; separate reference fit, not full-fit board point',limitations:'80% marginal coverage requires exchangeability. Small grouped cross-section and live-to-pre-token shift invalidate any guaranteed target-domain coverage. No launch or wallet-return probability.'};
}
export function interval(c:any,p:any):any{const center=predictValue(c.fit,p).value;return {reference_value_usd:center,lower_usd:Math.max(1,Math.floor(center*Math.exp(-c.q))),upper_usd:Math.ceil(center*Math.exp(c.q)),log_radius:c.q,nominal:c.nominal,train_n:c.train_n,calibration_n:c.calibration_n};}
export function assessIntervals(rows:any[],asOf:string):any{
 const live=eligible(rows),groups=tokenGroups(live),predictions:any[]=[];
 for(let outer=0;outer<5;outer++){const train=live.filter(p=>split(p,'radar-nested-v2:',5,groups)!==outer),test=live.filter(p=>split(p,'radar-nested-v2:',5,groups)===outer),c=calibrate(train,asOf);for(const p of test){const v=interval(c,p);predictions.push({outer,slug:p.slug,actual:p.mcap_usd,...v,covered:p.mcap_usd>=v.lower_usd&&p.mcap_usd<=v.upper_usd});}}
 return {nominal:.8,n:predictions.length,covered:predictions.filter(p=>p.covered).length,coverage:predictions.filter(p=>p.covered).length/predictions.length,median_log_radius:median(predictions.map(p=>p.log_radius)),folds:Array.from({length:5},(_,outer)=>{const ps=predictions.filter(p=>p.outer===outer);return {outer,n:ps.length,covered:ps.filter(p=>p.covered).length,calibration_n:ps[0].calibration_n,train_n:ps[0].train_n,log_radius:ps[0].log_radius};}),predictions};
}
export function explain(f:any,p:any,asOf:string):any{
 const age=ageDays(p.listed_at,asOf),raw=[Math.log(Math.max(1,p.tvl_usd)),Math.min(120,Math.max(-60,p.change_7d??0))/100,Math.log(1+Math.max(0,age??365)),Math.log(1+(p.chains??[]).length)],names=['log TVL','bounded 7d growth','log tracking age','log chain count'];
 const terms=raw.map((v,j)=>({feature:names[j],standardized:(v-f.center[j])/f.scale[j],log_contribution:f.beta[j+1]*(v-f.center[j])/f.scale[j]}));
 const flags:string[]=['Frozen snapshot; official products and rewards unverified','Token absence inferred from snapshot fields only'];
 if(p.change_7d==null)flags.push('Missing growth imputed to zero');
 if(age==null)flags.push('Missing tracking age imputed to 365 days');
 if(p.change_7d!=null&&(p.change_7d< -60||p.change_7d>120))flags.push('Growth feature clipped to [-60,120]%');
 if(!p.chains?.length)flags.push('No recorded chains');
 if(!p.category)flags.push('Missing category');
 if((f.cats[p.category??'Uncategorized']?.length??0)<5)flags.push('Fewer than five live category peers; regression does not use category');
 if(terms.some(t=>Math.abs(t.standardized)>4))flags.push('Feature more than four training MAD scales from median; extrapolation risk');
 const log=f.beta[0]+terms.reduce((s,t)=>s+t.log_contribution,0);if(Math.exp(log)<.05||Math.exp(log)>2)flags.push('Multiple band clipping dominates point scenario');
 return {intercept:f.beta[0],terms,unclipped_log_multiple:log,flags};
}
