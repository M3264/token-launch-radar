// Legacy baseline value model for fair comparison; candidate regression is in value.ts.
// Also provides shared selection and conditional research-plan helpers.
//
// The base multiple is not a fixed constant: it is fitted from the
// snapshot's own live-token protocols (non-CEX, with both mcap_usd and
// tvl_usd) as the median mcap/tvl per category, falling back to the global
// median for unseen categories, clamped into [COMP_LO, COMP_HI].
// Everything else comes from one protocol's own snapshot figures: TVL, its
// 7-day change, how long it has run (listed_at vs as_of), how many chains
// it spans, and the velocity of deposits over its lifetime. No protocol
// name is special-cased anywhere in this file.

export const COMP_LO = 0.05;
export const COMP_HI = 2.0;

export interface ProtocolInput {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
}

export interface ModelBreakdown {
  base: number;
  compMult: number;
  compSource: string;
  growth: number;
  growthMult: number;
  ageDays: number | null;
  maturity: number;
  spread: number;
  velocity: number;
  efficiency: number;
  implied: number;
}

/** A name ending in a version marker (V2, v3, 2.0, ...) is a versioned product, not a fresh subject. */
export const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Pre-token means no token recorded on any of the three fields, and not a CEX or versioned product. */
export function isRankable(p: {
  mcap_usd: number | null;
  gecko_id: string | null;
  symbol: string | null;
  category: string | null;
  name: string;
}): boolean {
  if (p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category === "CEX") return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  return true;
}

/** Whole days between listed_at and the snapshot date; null when unlisted or unparsable. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((a - b) / 86400000);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Median of a non-empty list; NaN when empty. */
export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export interface CompLive {
  category: string | null;
  mcap_usd: number;
  tvl_usd: number;
}

export interface CompFit {
  byCategory: Record<string, number>;
  byCategoryN: Record<string, number>;
  global: number;
  liveCount: number;
  /** Median |ln(predicted/actual)| over the live set, leave-one-out. */
  medAbsLogErr: number;
  method: string;
}

/**
 * Fit category comps from live-token protocols: median mcap/tvl per
 * category, global median fallback, everything clamped into
 * [COMP_LO, COMP_HI]. Fit quality is the median absolute log error of the
 * comp prediction on the live set, each protocol predicted by comps fitted
 * without it (leave-one-out).
 */
export function fitComps(live: CompLive[]): CompFit {
  const usable = live.filter((p) => Number.isFinite(p.mcap_usd) && p.mcap_usd > 0 &&
    Number.isFinite(p.tvl_usd) && p.tvl_usd > 0);
  const ratios = (ps: CompLive[]): number[] => ps.map((p) => p.mcap_usd / p.tvl_usd);
  const perCat = new Map<string, CompLive[]>();
  for (const p of usable) {
    const c = p.category ?? "Uncategorized";
    if (!perCat.has(c)) perCat.set(c, []);
    perCat.get(c)!.push(p);
  }
  const byCategory: Record<string, number> = {};
  const byCategoryN: Record<string, number> = {};
  for (const [c, ps] of perCat) {
    byCategory[c] = clamp(median(ratios(ps)), COMP_LO, COMP_HI);
    byCategoryN[c] = ps.length;
  }
  const global = clamp(median(ratios(usable)), COMP_LO, COMP_HI);
  const errs: number[] = [];
  for (let i = 0; i < usable.length; i++) {
    const p = usable[i]!;
    const c = p.category ?? "Uncategorized";
    const catOthers = perCat.get(c)!.filter((q) => q !== p);
    const comp = catOthers.length > 0
      ? clamp(median(ratios(catOthers)), COMP_LO, COMP_HI)
      : clamp(median(ratios(usable.filter((q) => q !== p))), COMP_LO, COMP_HI);
    const pred = Math.max(1e-9, p.tvl_usd * comp);
    errs.push(Math.abs(Math.log(pred / p.mcap_usd)));
  }
  const medAbsLogErr = errs.length > 0 ? median(errs) : NaN;
  return {
    byCategory, byCategoryN, global, liveCount: usable.length, medAbsLogErr,
    method: "median mcap/tvl per category over live non-CEX protocols (global median fallback), clamped to [0.05, 2.0]; quality = median |ln(pred/mcap)| leave-one-out",
  };
}

/** Comp multiple and a human-readable source label for one category. */
export function compFor(fit: CompFit, category: string | null): { mult: number; source: string } {
  const c = category ?? "Uncategorized";
  if (c in fit.byCategory) return { mult: fit.byCategory[c]!, source: `category ${c} median (n=${fit.byCategoryN[c]})` };
  return { mult: fit.global, source: `global median fallback (n=${fit.liveCount})` };
}

/**
 * Score one protocol: TVL times its category comp multiple, scaled by
 * growth momentum, by how long it has run without a token, by chain
 * spread, and by deposit velocity.
 */
export function scoreProtocol(p: ProtocolInput, asOf: string, compMult = 0.25, compSource = "fixed 0.25"): ModelBreakdown {
  const age = ageDays(p.listed_at, asOf);
  const base = p.tvl_usd * compMult;
  const growth = clamp(p.change_7d ?? 0, -60, 120);
  const growthMult = 1 + (growth / 100) * 0.5;
  const maturity = 0.6 + (Math.min(Math.max(age ?? 365, 0), 1095) / 1095) * 0.4;
  const spread = 1 + 0.05 * Math.min(p.chains.length, 8);
  const velocity = p.tvl_usd / Math.max(age ?? 365, 30);
  const efficiency = 0.9 + 0.2 * clamp(Math.log10(1 + velocity / 1e6) / 2, 0, 1);
  const implied = Math.max(1, Math.round(base * growthMult * maturity * spread * efficiency));
  return { base, compMult, compSource, growth, growthMult, ageDays: age, maturity, spread, velocity, efficiency, implied };
}

/** Illustrative working-capital budget, not an eligibility threshold or fee. */
export function capitalFor(tvl:number):number { return tvl>=5e9?250:tvl>=1e9?150:tvl>=1e8?100:50; }
export function endDate(asOf:string,days:number):string {return new Date(Date.parse(asOf+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
export interface PlanCost {capital_usd:number;gas:{chain:string;units:null}[];gas_total_units:null;line:string;}
export function planCost(p:ProtocolInput):PlanCost {
 const capital=capitalFor(p.tvl_usd);
 return {capital_usd:capital,gas:p.chains.map(chain=>({chain,units:null})),gas_total_units:null,
 line:`Illustrative budget: $${capital} working capital at risk, not a fee or eligibility minimum; consumable gas, bridge fees and slippage unquoted. Obtain wallet estimates per transaction and chain; do not sum unlike native units.`};
}
/** Snapshot-only checklist: product access and rewards must be verified before any spend. */
export function farmSteps(p:ProtocolInput,asOf='2026-11-14'):string[]{
 const capital=capitalFor(p.tvl_usd), chain=p.chains[0]??'a verified supported chain';
 return [
 `Before spending on ${p.name}, verify its official domain, docs, contracts, current token status, jurisdiction and rewards rules. The snapshot category (${p.category??'unknown'}) and chain list do not prove product capabilities or eligibility.`,
 `Illustrative 30-day research pilot ${asOf} to ${endDate(asOf,30)}: allow 30 minutes for document checks, 20 for setup and 10 weekly for review (90 minutes total). These are planning assumptions, not protocol requirements.`,
 `If official docs confirm a suitable low-risk action on ${chain}, use an isolated wallet, verify addresses and approvals, and test deposit AND withdrawal first. Do not assume lending, borrowing, points, staking, or any particular pool exists. Otherwise stop at research.`,
 `${planCost(p).line} The $${capital} budget is an optional ceiling, not a recommendation to deploy; reduce it or skip the protocol if the verified minimum or costs do not fit.`,
 `Only after a successful withdrawal test, consider one documented spot or deposit action within the budget. Avoid leverage and manufactured volume. Check smart-contract, depeg, liquidity, bridge and approval risks; all deployed capital can be lost.`,
 `Review on ${endDate(asOf,7)}, ${endDate(asOf,14)}, ${endDate(asOf,21)} and ${endDate(asOf,28)}. Record balances and actual fees; repeat a transaction only for a genuine product need, not an assumed reward. Exit if risk or fees exceed your own limit.`,
 `At ${endDate(asOf,30)}, reassess withdrawal access and net costs; keep receipts and revoke unnecessary approvals. No required holding period, points program, launch date or airdrop eligibility is verified here; rewards may be zero.`
 ];
}
