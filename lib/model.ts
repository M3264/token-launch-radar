// Token-launch radar: value model for pre-token protocols.
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

/** Native gas to keep on the first chain, in that chain's own gas units. */
export function gasFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes("ethereum")) return 12;
  if (c.includes("solana")) return 0.05;
  if (c.includes("tron")) return 1;
  if (c.includes("arbitrum") || c.includes("optimism") || c.includes("base") ||
      c.includes("blast") || c.includes("mode") || c.includes("scroll") ||
      c.includes("linea") || c.includes("zora") || c.includes("zkevm") ||
      c.includes("starknet") || c.includes("zksync")) return 0.25;
  if (c.includes("bsc") || c.includes("binance") || c.includes("avalanche") ||
      c.includes("polygon")) return 0.4;
  return 2;
}

/** Working capital for the qualifying position, by TVL tier. */
export function capitalFor(tvl: number): number {
  if (tvl >= 5000000000) return 250;
  if (tvl >= 1000000000) return 150;
  if (tvl >= 100000000) return 100;
  return 50;
}

/** Minimum holding period: younger protocols need longer to look organic; unknown age plays safe. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Weekly qualifying touches implied by the holding period, at least two. */
export function weeksFor(holdDays: number): number {
  return Math.max(2, Math.round(holdDays / 7));
}

/** The qualifying action for step 3: one concrete move per protocol kind. */
export function actionFor(category: string | null, capital: number, chain: string, name: string): string {
  const c = (category ?? "").toLowerCase();
  const money = `about $${capital}`;
  if (c.includes("restak") || (c.includes("liquid") && c.includes("stak")))
    return `Restake ${money} of liquid-staking tokens through ${name} on ${chain} and hold the receipt token so restaking points accrue.`;
  if (c.includes("lend") || c.includes("cdp") || c.includes("collateral") || c.includes("borrow") ||
      c.includes("uncollateralized") || c.includes("money market") || c.includes("cedefi"))
    return `Supply ${money} to ${name} lending pools on ${chain} as collateral, borrow a small amount against it, and repay monthly.`;
  if (c.includes("dex") || c.includes("amm") || c.includes("liquidity manager") || c.includes("market maker"))
    return `Provide ${money} of two-sided liquidity to ${name} pools on ${chain} and route a small swap through them on each visit.`;
  if (c.includes("curator") || c.includes("aggregat") || c.includes("allocat") || c.includes("index") ||
      c.includes("vault") || c.includes("manager"))
    return `Deposit ${money} into ${name} vaults or curated allocations on ${chain} and keep the receipt token for the whole period.`;
  if (c.includes("bridge") || c.includes("canonical"))
    return `Bridge ${money} into ${chain} through ${name} in two or three tranches on different days to build a bridging history.`;
  if (c.includes("perp") || c.includes("deriv") || c.includes("option") || c.includes("predict") ||
      c.includes("synth") || c.includes("basis") || c.includes("leverag") || c.includes("future"))
    return `Open small hedged perp or derivative positions totalling ${money} on ${name} (${chain}), closing most within days.`;
  if (c.includes("yield") || c.includes("farm"))
    return `Stake ${money} in ${name} yield farms on ${chain}, compound the rewards weekly, and keep the principal deployed throughout.`;
  if (c.includes("stak"))
    return `Stake ${money} with ${name} on ${chain} through native delegation and leave the rewards compounding for the full period.`;
  if (c.includes("stable") || c.includes("anchor") || c.includes("reserve") || c.includes("money") ||
      c.includes("payment") || c.includes("card"))
    return `Mint or hold ${money} of ${name} stable assets on ${chain} and place them in one listed pool so the balance counts as active.`;
  if (c.includes("rwa") || c.includes("real") || c.includes("estate") || c.includes("treasur") || c.includes("credit"))
    return `Buy ${money} of ${name} tokenized real-world assets on ${chain}, finish any verification early, and hold to the term.`;
  if (c.includes("insur"))
    return `Buy cover or underwrite ${money} through ${name} on ${chain} so the wallet is registered as a policyholder before any snapshot.`;
  if (c.includes("oracle") || c.includes("infra") || c.includes("chain") || c.includes("depin") ||
      c.includes("ai") || c.includes("privacy") || c.includes("govern") || c.includes("launchpad") ||
      c.includes("locker") || c.includes("otc"))
    return `Run ${money} of qualifying volume through ${name} on ${chain} as the docs describe and keep every transaction receipt.`;
  if (c.includes("nft") || c.includes("gaming") || c.includes("collect"))
    return `Mint or trade ${money} through ${name} on ${chain}, holding at least one qualifying asset in the farming wallet throughout.`;
  return `Put ${money} to work in the main ${name} product on ${chain}, interacting with it directly rather than through an aggregator.`;
}

/** Short name for the weekly qualifying touch, one per protocol kind. */
export function weeklyVerb(category: string | null): string {
  const c = (category ?? "").toLowerCase();
  if (c.includes("restak") || (c.includes("liquid") && c.includes("stak")))
    return "restaking top-up";
  if (c.includes("lend") || c.includes("cdp") || c.includes("collateral") || c.includes("borrow") ||
      c.includes("uncollateralized") || c.includes("money market") || c.includes("cedefi"))
    return "supply-and-borrow touch";
  if (c.includes("dex") || c.includes("amm") || c.includes("liquidity manager") || c.includes("market maker"))
    return "swap-or-liquidity touch";
  if (c.includes("curator") || c.includes("aggregat") || c.includes("allocat") || c.includes("index") ||
      c.includes("vault") || c.includes("manager"))
    return "vault-deposit touch";
  if (c.includes("bridge") || c.includes("canonical"))
    return "bridging touch";
  if (c.includes("perp") || c.includes("deriv") || c.includes("option") || c.includes("predict") ||
      c.includes("synth") || c.includes("basis") || c.includes("leverag") || c.includes("future"))
    return "hedged perp touch";
  if (c.includes("yield") || c.includes("farm"))
    return "stake-and-compound touch";
  if (c.includes("stak"))
    return "staking touch";
  if (c.includes("stable") || c.includes("anchor") || c.includes("reserve") || c.includes("money") ||
      c.includes("payment") || c.includes("card"))
    return "mint-or-hold touch";
  if (c.includes("rwa") || c.includes("real") || c.includes("estate") || c.includes("treasur") || c.includes("credit"))
    return "position top-up";
  if (c.includes("insur"))
    return "coverage touch";
  if (c.includes("nft") || c.includes("gaming") || c.includes("collect"))
    return "mint-or-trade touch";
  return "product touch";
}

/** Calendar date holdDays after asOf (YYYY-MM-DD); deterministic. */
export function endDate(asOf: string, holdDays: number): string {
  const t = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(t)) return `at least ${holdDays} days out`;
  return new Date(t + holdDays * 86400000).toISOString().slice(0, 10);
}

export interface PlanCost {
  capital_usd: number;
  gas: { chain: string; units: number }[];
  gas_total_units: number;
  line: string;
}

/**
 * Explicit per-plan cost total: working capital plus summed gas units over
 * the protocol's chains. Gas stays in native units (no invented prices).
 */
export function planCost(p: ProtocolInput): PlanCost {
  const capital = capitalFor(p.tvl_usd);
  const chains = p.chains.length > 0 ? p.chains : ["Ethereum"];
  const gas = chains.map((chain) => ({ chain, units: gasFor(chain) }));
  const total = gas.reduce((s, g) => s + g.units, 0);
  const line =
    `Plan cost total: about $${capital} working capital plus ${total} ` +
    `summed gas units across ${chains.length} chain${chains.length === 1 ? "" : "s"} for fees.`;
  return { capital_usd: capital, gas, gas_total_units: total, line };
}

/** Seven concrete farm steps for one protocol; each trims to 20-600 characters. */
export function farmSteps(p: ProtocolInput, asOf = "2026-11-14"): string[] {
  const first = p.chains[0] ?? "Ethereum";
  const capital = capitalFor(p.tvl_usd);
  const touch = Math.max(5, Math.round(capital / 10));
  const age = ageDays(p.listed_at, asOf);
  const hold = holdDaysFor(age);
  const weeks = weeksFor(hold);
  const verb = weeklyVerb(p.category);
  const end = endDate(asOf, hold);
  return [
    `Open a fresh wallet used only for ${p.name} on ${first}; back up the seed phrase offline and never mix it with other farms.`,
    `Fund it with ${moneyStr(capital)} for the position plus gas for fees, in a single transfer from an exchange. ${planCost(p).line}`,
    actionFor(p.category, capital, first, p.name),
    `Work a ${weeks}-week rotation on ${first}, one touch per week on different weekdays: (a) repeat the qualifying ${verb} above, (b) add a small about $${touch} top-up or swap, (c) open the points page with the farming wallet — then cycle.`,
    `Leave the position working until at least ${end} (${hold} days from the ${asOf} snapshot); avoid early withdrawals since age and consistency are what a snapshot rewards.`,
    `Every Monday, check the official ${p.name} points or rewards page with the farming wallet connected and confirm your balance accrues.`,
    `Log every deposit, transaction hash and weekly check in a farm journal with screenshots so you can claim fast if a token is announced.`,
  ];
}

function moneyStr(capital: number): string {
  return `about $${capital}`;
}
