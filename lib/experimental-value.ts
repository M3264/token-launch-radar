import {createHash} from 'node:crypto';
import {median,clamp,ageDays,fitComps,compFor,scoreProtocol} from './model.ts';
export function foldFor(slug:string):number { return createHash('sha256').update('radar-v1:'+slug.replace(/[-_ ]v?\d+(\.\d+)?$/i,'')).digest().readUInt32BE(0)%5; }
const cat=(p:any)=>p.category??'Uncategorized';
const ratio=(p:any)=>Math.log(p.mcap_usd/p.tvl_usd);
function features(p:any,asOf:string):number[]{return [Math.log(Math.max(1,p.tvl_usd)),clamp(p.change_7d??0,-60,120)/100,Math.log(1+Math.max(0,ageDays(p.listed_at,asOf)??365)),Math.log(1+(p.chains??[]).length)];}
function solve(a:number[][],b:number[]):number[]{
 const m=a.map((r,i)=>[...r,b[i]]),n=b.length;
 for(let k=0;k<n;k++){let q=k;for(let i=k+1;i<n;i++)if(Math.abs(m[i][k])>Math.abs(m[q][k]))q=i;[m[k],m[q]]=[m[q],m[k]];const d=m[k][k]||1e-10;for(let j=k;j<=n;j++)m[k][j]/=d;for(let i=0;i<n;i++)if(i!==k){const s=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=s*m[k][j];}}
 return m.map(r=>r[n]);
}
export function fitValue(rows:any[],method='shrink',asOf='2026-11-14',options:any={}):any{
 const train=rows.filter(p=>p.tvl_usd>0&&p.mcap_usd>0&&Number.isFinite(p.mcap_usd));
 const global=median(train.map(ratio));const cats:any={};for(const p of train)(cats[cat(p)]??=[]).push(ratio(p));
 const f:any={method,asOf,global,cats,n:train.length,options};
 if(method==='baseline'||method==='comps')f.old=fitComps(train);
 if(method==='robust'){
  const raw=train.map(p=>features(p,asOf));f.center=raw[0].map((_:any,j:number)=>median(raw.map(r=>r[j])));f.scale=f.center.map((_:any,j:number)=>Math.max(.1,median(raw.map(r=>Math.abs(r[j]-f.center[j])))));
  const x=raw.map(r=>[1,...r.map((v,j)=>(v-f.center[j])/f.scale[j])]);const y=train.map(ratio);let beta=[global,0,0,0,0];
  for(let t=0;t<30;t++){
   const res=x.map((r,i)=>y[i]-r.reduce((s,v,j)=>s+v*beta[j],0));const scale=Math.max(.2,1.4826*median(res.map(Math.abs)));
   const a=Array.from({length:5},()=>Array(5).fill(0)),b=Array(5).fill(0);
   x.forEach((r,i)=>{const w=options.squared?1:Math.min(1,(options.delta??1.345)*scale/Math.max(1e-9,Math.abs(res[i])));for(let j=0;j<5;j++){b[j]+=w*r[j]*y[i];for(let k=0;k<5;k++)a[j][k]+=w*r[j]*r[k];}});
   for(let j=1;j<5;j++)a[j][j]+=(options.ridge??10);beta=solve(a,b);
  }f.beta=beta;
 }
 return f;
}
export function predictValue(f:any,p:any):any{
 const c=cat(p),n=f.cats[c]?.length??0;let log=f.global,source='global fallback';
 if(f.method==='baseline'||f.method==='comps'){const co=compFor(f.old,p.category);const m=scoreProtocol(p,f.asOf,co.mult,co.source);return {value:f.method==='baseline'?m.implied:Math.max(1,Math.round(p.tvl_usd*co.mult)),mult:co.mult,source:co.source,n};}
 if(f.method==='shrink'&&n>=5){const w=n/(n+10);log=(1-w)*f.global+w*median(f.cats[c]);source=`log-category shrink n=${n}, weight=${w.toFixed(3)}`;}
 else if(f.method==='shrink')source=`sparse category n=${n}<5; global fallback`;
 if(f.method==='robust'){const x=[1,...features(p,f.asOf).map((v,j)=>(v-f.center[j])/f.scale[j])];log=x.reduce((s,v,j)=>s+v*f.beta[j],0);source='Huber log regression; ridge=10';const w=f.options?.blend??0;if(w){const category=n>=5?(1-n/(n+10))*f.global+n/(n+10)*median(f.cats[c]):f.global;log=(1-w)*log+w*category;}}
 const raw=Math.exp(log),mult=clamp(raw,.05,2);if(raw<.05)source+='; lower-band clipped';else if(raw>2)source+='; upper-band clipped';return {value:Math.max(1,Math.round(p.tvl_usd*mult)),mult,source,n};
}
export function benchmark(protocols:any[],asOf:string):any{
 const live=protocols.filter(p=>p.category!=='CEX'&&p.tvl_usd>0&&p.mcap_usd>0&&Number.isFinite(p.mcap_usd));
 const methods=['baseline','comps','shrink','robust'];const errors:any={};const details:any=[];
 for(const method of methods){const e:number[]=[];const folds:any=[];for(let fold=0;fold<5;fold++){
  const train=live.filter(p=>foldFor(p.slug)!==fold),test=live.filter(p=>foldFor(p.slug)===fold);const f=fitValue(train,method,asOf);const fe:number[]=[];
  for(const p of test){const pred=predictValue(f,p).value;const err=Math.abs(Math.log(pred/p.mcap_usd));e.push(err);fe.push(err);details.push({method,fold,slug:p.slug,actual:p.mcap_usd,predicted:pred,abs_log_error:err});}
  folds.push({fold,train:train.length,test:test.length,median_abs_log_error:median(fe)});
 }errors[method]={median_abs_log_error:median(e),error_factor:Math.exp(median(e)),folds};}
 const base=details.filter((p:any)=>p.method==='baseline'),robust=new Map(details.filter((p:any)=>p.method==='robust').map((p:any)=>[p.slug,p.abs_log_error]));
 const gains:number[]=[];let seed=20261114;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let b=0;b<2000;b++){const x:number[]=[],y:number[]=[];for(let i=0;i<base.length;i++){const p=base[Math.floor(random()*base.length)];x.push(p.abs_log_error);y.push(robust.get(p.slug) as number);}gains.push(median(x)-median(y));}gains.sort((a,b)=>a-b);
 const comparison={bootstrap_replicates:2000,median_log_error_reduction:errors.baseline.median_abs_log_error-errors.robust.median_abs_log_error,paired_bootstrap_95_percent:[gains[50],gains[1949]],caution:'Conditional paired row bootstrap of fixed out-of-fold predictions; not selection-adjusted and does not refit models or account for unknown protocol families.'};
 return {comparison,schema:'radar-validation/v1',live_count:live.length,split:'5-fold SHA256(radar-v1:version-normalized slug) modulo 5; fit and preprocessing training-only',metrics:errors,predictions:details,limitations:'Single sealed cross-section, not temporal validation. Shared versions grouped where suffix is detectable; parent identities unavailable. Comparing alternatives on these folds is exploratory selection, not an untouched test. Live-token performance does not validate launches or airdrop returns.'};
}
