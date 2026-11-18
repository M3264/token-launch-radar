// Snapshot evidence only: these are research holds, never proof a new token is impossible.
const words=(s:string)=>s.toLowerCase().match(/[a-z0-9]+/g)??[];
const generic=new Set(['liquid','staking','staked','wrapped','yield','finance','protocol','bridge','lending','lend','swap','vault','vaults']);
export function researchReasons(p:any,rows:any[]):string[]{
 const reasons:string[]=[];
 if(/^(Bridge|Canonical Bridge|Liquid Staking|Liquid Restaking|Restaked BTC|CEX)$/.test(p.category??'')) reasons.push('Uncertain: category '+p.category+' withheld by wrapper research policy; independent token not disproven');
 if(/\b(wrapped|staked|staking)\b/i.test(p.name)) reasons.push('Uncertain: wrapper/staking name marker; inspect underlying product and reward rules');
 if(/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini|Crypto\.com)\b/i.test(p.name)) reasons.push('Uncertain: exchange-prefixed product; independent issuance unverified');
 const a=words(p.name);
 for(const q of rows){if(q.slug===p.slug||!(q.symbol||q.gecko_id||q.mcap_usd!=null))continue;const b=words(q.name);let common=0;while(common<Math.min(a.length,b.length)&&a[common]===b[common])common++;
 const multi=common>=2&&!generic.has(a[0]!)&&!generic.has(a[1]!);
 const symbol=typeof q.symbol==='string'&&q.symbol.length>=3&&a[0]===q.symbol.toLowerCase()&&b[0]===a[0];
 if(multi||symbol)reasons.push('Uncertain sibling: '+q.slug+' records '+(q.gecko_id??q.symbol??'market cap')+'; '+(multi?'shared multi-token name prefix':'exact brand/token-symbol word')+' suggests related product, not proven common token ownership');
 }
 return reasons;
}
// Exact token identifiers are stronger than names. Only duplicate IDs add links;
// absent IDs and colliding symbols never fabricate family relationships.
export function tokenGroups(rows:any[]):Map<string,string>{
 const g=new Map<string,string>(),ids=new Map<string,string[]>();
 for(const p of rows){g.set(p.slug,p.slug.replace(/[-_ ]v?\d+(\.\d+)?$/i,''));if(p.gecko_id)(ids.get(p.gecko_id)??(ids.set(p.gecko_id,[]),ids.get(p.gecko_id)!)).push(p.slug);}
 for(const slugs of ids.values())if(slugs.length>1){const key=slugs.map(s=>g.get(s)!).sort()[0];for(const slug of slugs)g.set(slug,key);}
 return g;
}
