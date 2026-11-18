import {tokenGroups} from './lib/identity.ts';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fitValue,predictValue} from './lib/experimental-value.ts';
import {median} from './lib/model.ts';
const path=process.argv[2]??'/data/workspace/makefun/token-radar-01-kit/token-radar-01-kit/input/snapshot.json';

export const partition=(slug:string,salt:string,n:number,groups?:Map<string,string>)=>createHash('sha256').update(salt+(groups?.get(slug)??slug.replace(/[-_ ]v?\d+(\.\d+)?$/i,''))).digest().readUInt32BE(0)%n;
const grids:any={huber:[{ridge:1},{ridge:10},{ridge:50},{ridge:10,delta:.7},{ridge:10,delta:2}],ridge:[{ridge:1,squared:true},{ridge:10,squared:true},{ridge:50,squared:true}],blend:[{ridge:10,blend:0},{ridge:10,blend:.15},{ridge:10,blend:.3}]};
export function runNested(protocols:any[],asOf:string):any{
 const live=protocols.filter(p=>p.category!=='CEX'&&p.tvl_usd>0&&p.mcap_usd>0&&Number.isFinite(p.mcap_usd));
 const groups=tokenGroups(live);
 const predictions:any[]=[],folds:any[]=[];
 for(let outer=0;outer<5;outer++){
  const train=live.filter(p=>partition(p.slug,'radar-nested-v2:',5,groups)!==outer),test=live.filter(p=>partition(p.slug,'radar-nested-v2:',5,groups)===outer);
  const selections:any={};
  for(const [family,grid] of Object.entries(grids)){
   const scores=(grid as any[]).map(options=>{const errors:number[]=[];for(let inner=0;inner<3;inner++){
    const tr=train.filter(p=>partition(p.slug,'radar-inner-v2:',3,groups)!==inner),va=train.filter(p=>partition(p.slug,'radar-inner-v2:',3,groups)===inner);
    const f=fitValue(tr,'robust',asOf,options);for(const p of va)errors.push(Math.abs(Math.log(predictValue(f,p).value/p.mcap_usd)));
   }return {options,inner_median:median(errors)};});
   scores.sort((a,b)=>a.inner_median-b.inner_median);selections[family]={selected:scores[0].options,all_settings:scores};
  }
  for(const family of ['prior',...Object.keys(grids)]){const f=fitValue(train,'robust',asOf,family==='prior'?{}:selections[family].selected);for(const p of test){const predicted=predictValue(f,p).value;predictions.push({family,outer,slug:p.slug,predicted,actual:p.mcap_usd,error:Math.abs(Math.log(predicted/p.mcap_usd))});}}
  folds.push({outer,train:train.length,test:test.length,selections});
 }
 const metrics:any={};for(const family of ['prior',...Object.keys(grids)]){const rows=predictions.filter(p=>p.family===family);const m=median(rows.map(p=>p.error));metrics[family]={median_abs_log_error:m,error_factor:Math.exp(m),fold_medians:Array.from({length:5},(_,i)=>median(rows.filter(p=>p.outer===i).map(p=>p.error)))};}
 return {schema:'radar-nested/v2',live_count:live.length,grids,metrics,folds,predictions,limitations:'Predeclared small grids selected only by three inner folds; five new deterministic grouped outer folds, identical for prior and variants. Previously inspected dataset, NOT a new untouched external test. Outer outcomes must not be used to tune further settings. Single cross-section; unknown families and target-domain shift remain.'};
}
if(process.argv[1]?.endsWith('/nested.ts')){const snap=JSON.parse(readFileSync(path,'utf8'));const result=runNested(snap.protocols,snap.as_of);writeFileSync('nested-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,predictions:undefined,folds:result.folds.map((f:any)=>({...f,selections:Object.fromEntries(Object.entries(f.selections).map(([k,v]:any)=>[k,v.selected]))}))},null,2));}
