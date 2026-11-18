import test from 'node:test';
import assert from 'node:assert/strict';
import * as identity from './lib/identity.ts';
import {benchmark} from './lib/value.ts';
import {runNested} from './nested.ts';
import {split} from './lib/uncertainty.ts';
import {readFileSync} from 'node:fs';

const p=(slug:string,name:string,symbol:string|null=null,gecko_id:string|null=null)=>({slug,name,symbol,gecko_id,mcap_usd:null,category:'Lending'});
test('research policy withholds wrappers without claiming no independent token can exist',()=>{
 assert.equal(identity.researchReasons(p('bridge','Unproven Bridge'),[]).length,0);
 assert.match(identity.researchReasons({...p('x','Unknown'),category:'Bridge'},[]).join(' '),/uncertain/i);
});
test('sibling evidence uses multiword names or recorded symbol, not broken suffix regex or invented parents',()=>{
 const live=[p('gmx-evm','GMX EVM','GMX'),p('manta-pacific','Manta Pacific','MANTA'),p('flying-tulip-lend','Flying Tulip Lend','FT')];
 for(const q of [p('gmx-solana','GMX Solana'),p('manta-cedefi','Manta CeDeFi'),p('flying-tulip-ftusd','Flying Tulip ftUSD')]) assert.ok(identity.researchReasons(q,live).some(r=>/sibling/i.test(r)));
 for(const q of [p('gmxify','GMXify'),p('blue-finance','Blue Finance'),p('tulip','Tulip Lending')]) assert.deepEqual(identity.researchReasons(q,live),[]);
 // Ambiguous single-word brands are deliberately NOT established as siblings.
 assert.deepEqual(identity.researchReasons(p('kava-mint','Kava Mint'),[p('kava-lend','Kava Lend','HARD','kava-lend')]),[]);
 assert.deepEqual(identity.researchReasons(p('metalx-swap','MetalX Swap'),[p('metalx-lending','MetalX Lending','LOAN','proton-loan')]),[]);
});
test('actual benchmark/nested folds keep a synthetic repeated token id together',()=>{
 const s=JSON.parse(readFileSync('/data/workspace/makefun/token-radar-01-kit/token-radar-01-kit/input/snapshot.json','utf8'));
 const original=s.protocols.find(p=>p.category!=='CEX'&&p.tvl_usd>0&&p.mcap_usd>0&&p.gecko_id);
 const clone={...original,slug:'deliberately-unrelated-fixture-name',name:'Synthetic identity fixture'};const rows=[...s.protocols,clone];
 const a=benchmark(rows,s.as_of).predictions.filter(p=>p.method==='robust'&&(p.slug===original.slug||p.slug===clone.slug));assert.equal(a.length,2);assert.equal(a[0].fold,a[1].fold);
 const b=runNested(rows,s.as_of).predictions.filter(p=>p.family==='prior'&&(p.slug===original.slug||p.slug===clone.slug));assert.equal(b.length,2);assert.equal(b[0].outer,b[1].outer);
 const g=identity.tokenGroups(rows);assert.equal(split(original,'radar-cal-v2:',5,g),split(clone,'radar-cal-v2:',5,g));
});
test('token grouping joins exact gecko ids, not ambiguous symbols or generic name prefixes',()=>{
 const rows=[p('a','Blue Finance','ONE','same-id'),p('b','Other Name','TWO','same-id'),p('c','Blue River','ONE','different-id'),p('d','Blue Finance Plus','ONE')];
 const g=identity.tokenGroups(rows);assert.equal(g.get('a'),g.get('b'));assert.notEqual(g.get('a'),g.get('c'));assert.notEqual(g.get('a'),g.get('d'));
});
