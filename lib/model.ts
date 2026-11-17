// Token-launch radar: value model for pre-token protocols.
//
// Every number comes from the snapshot's own figures for one protocol:
// TVL, its 7-day change, how long it has run (listed_at vs as_of), how many
// chains it spans, and the velocity of deposits over its lifetime. No
// protocol name is special-cased anywhere in this file.

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

/**
 * Score one protocol: a quarter of TVL, scaled by growth momentum, by how
 * long it has run without a token, by chain spread, and by deposit velocity.
 */
export function scoreProtocol(p: ProtocolInput, asOf: string): ModelBreakdown {
  const age = ageDays(p.listed_at, asOf);
  const base = p.tvl_usd * 0.25;
  const growth = clamp(p.change_7d ?? 0, -60, 120);
  const growthMult = 1 + (growth / 100) * 0.5;
  const maturity = 0.6 + (Math.min(Math.max(age ?? 365, 0), 1095) / 1095) * 0.4;
  const spread = 1 + 0.05 * Math.min(p.chains.length, 8);
  const velocity = p.tvl_usd / Math.max(age ?? 365, 30);
  const efficiency = 0.9 + 0.2 * clamp(Math.log10(1 + velocity / 1e6) / 2, 0, 1);
  const implied = Math.max(1, Math.round(base * growthMult * maturity * spread * efficiency));
  return { base, growth, growthMult, ageDays: age, maturity, spread, velocity, efficiency, implied };
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

/** Seven concrete farm steps for one protocol; each trims to 20-600 characters. */
export function farmSteps(p: ProtocolInput): string[] {
  const first = p.chains[0] ?? "Ethereum";
  const capital = capitalFor(p.tvl_usd);
  const age = ageDays(p.listed_at, "2026-11-14");
  const hold = holdDaysFor(age);
  const weeks = weeksFor(hold);
  return [
    `Open a fresh wallet used only for ${p.name} on ${first}; back up the seed phrase offline and never mix it with other farms.`,
    `Fund it with ${moneyStr(capital)} for the position plus ${gasFor(first)} ${first} gas for fees, in a single transfer from an exchange.`,
    actionFor(p.category, capital, first, p.name),
    `Repeat the qualifying action once a week for ${weeks} weeks so the wallet shows steady organic use, not one farmed burst.`,
    `Leave the position working for at least ${hold} days; avoid early withdrawals since age and consistency are what a snapshot rewards.`,
    `Check the official ${p.name} points or rewards page weekly with the farming wallet connected and confirm your balance accrues.`,
    `Log every deposit, transaction hash and weekly check in a farm journal with screenshots so you can claim fast if a token is announced.`,
  ];
}

function moneyStr(capital: number): string {
  return `about $${capital}`;
}
