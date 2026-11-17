// Token-launch radar entrypoint (Node 22, stdlib only, no network).
//
// Reads the sealed snapshot, scores every rankable pre-token protocol, writes
// the ranked board, the dashboard data, copies dashboard/ and screenshots/,
// and writes dossier.json with buildDossier from vendor/makefun-board.ts.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
//   node main.ts --output out --input /path/to/snapshot.json

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ageDays, farmSteps, isRankable, scoreProtocol } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

function resolveInput(): string {
  const raw = argValue("--input") ?? "/input";
  const st = statSync(raw);
  if (st.isDirectory()) return join(raw, "snapshot.json");
  return raw;
}

function resolveOutput(): string {
  return resolve(argValue("--output") ?? process.env["MAKEFUN_OUTPUT_DIR"] ?? "out");
}

const snap = JSON.parse(readFileSync(resolveInput(), "utf8")) as Snapshot;
const outDir = resolveOutput();
const asOf: string = snap.as_of;
const floor: number = snap.floor_usd;

const bySlug = new Map<string, SnapshotProtocol>();
for (const p of snap.protocols) bySlug.set(p.slug, p);

// Every rankable pre-token protocol: the whole watchlist plus every rankable
// pre-token below the floor (the early ones the radar exists to find).
const watch = new Set<string>(snap.watchlist);
const picked = new Map<string, SnapshotProtocol>();
for (const slug of snap.watchlist) {
  const p = bySlug.get(slug);
  if (!p) throw new Error(`boardIssue: watchlist slug ${slug} is not in the snapshot`);
  picked.set(slug, p);
}
for (const p of snap.protocols) {
  if (watch.has(p.slug)) continue;
  if (!isRankable(p)) continue;
  if (p.tvl_usd >= floor) continue;
  picked.set(p.slug, p);
}

interface Scored {
  p: SnapshotProtocol;
  implied: number;
  model: Record<string, number | null>;
  age: number | null;
  steps: string[];
}

const scored: Scored[] = [];
for (const p of picked.values()) {
  const m = scoreProtocol(p, asOf);
  scored.push({
    p,
    implied: m.implied,
    model: {
      base: m.base,
      growth: m.growth,
      growthMult: m.growthMult,
      maturity: m.maturity,
      spread: m.spread,
      velocity: m.velocity,
      efficiency: m.efficiency,
    },
    age: m.ageDays,
    steps: farmSteps(p, asOf),
  });
}

// Strongest first; ties break by slug so the order is deterministic.
scored.sort((a, b) => (b.implied - a.implied) || (a.p.slug < b.p.slug ? -1 : 1));

const rows = scored.map((s, i) => ({
  rank: i + 1,
  slug: s.p.slug,
  name: s.p.name,
  category: s.p.category,
  chains: s.p.chains,
  tvl_usd: s.p.tvl_usd,
  change_7d: s.p.change_7d,
  mcap_usd: s.p.mcap_usd,
  listed_at: s.p.listed_at,
  gecko_id: s.p.gecko_id,
  symbol: s.p.symbol,
  token_status: "pre-token",
  age_days: s.age,
  implied_value_usd: s.implied,
  model: s.model,
  farm_steps: s.steps,
}));

// Live-token protocols (any token recorded, non-CEX) set aside by market cap.
const live = snap.protocols
  .filter((p) => (p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null) && p.category !== "CEX")
  .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || (a.slug < b.slug ? -1 : 1))
  .slice(0, 24)
  .map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: "live",
    age_days: ageDays(p.listed_at, asOf),
  }));

const liveTotal = snap.protocols.filter(
  (p) => (p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null) && p.category !== "CEX",
).length;
const earlyBelow = rows.filter((r) => !watch.has(r.slug)).length;

// The entry's own gate: refuse to write a board that violates the rules.
function boardIssue(): string | null {
  if (rows.length < 100 || rows.length > 4000) return `want 100-4000 rows, got ${rows.length}`;
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
  }
  for (const slug of snap.watchlist) if (!seen.has(slug)) return `watchlist slug ${slug} missing`;
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `ranks are not 1..N (break at index ${i})`;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd)
      return `implied value rises at rank ${rows[i]!.rank}`;
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size === 1 && rows.length > 1)
    return "all implied values are equal";
  for (const r of rows) {
    const v = r.implied_value_usd;
    if (!Number.isSafeInteger(v) || v < 1 || v > 100000000000000)
      return `implied value out of range for ${r.slug}: ${v}`;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12)
      return `farm steps count out of range for ${r.slug}`;
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) return `farm step length ${n} out of range for ${r.slug}`;
    }
  }
  return null;
}

const issue = boardIssue();
if (issue) {
  console.error(`boardIssue: ${issue}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const f of ["board.json", "data.js", "dossier.json"]) rmSync(join(outDir, f), { force: true });
for (const d of ["dashboard", "screenshots"]) rmSync(join(outDir, d), { recursive: true, force: true });

writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows }) + "\n");

const payload = {
  meta: {
    as_of: asOf,
    floor_usd: floor,
    watchlist_total: snap.watchlist.length,
    watchlist_covered: snap.watchlist.length,
    rows_scored: rows.length,
    early_below_floor: earlyBelow,
    live_set_aside: liveTotal,
    live_shown: live.length,
    model: {
      formula: "implied = round(0.25*tvl * (1+clamp(change_7d,0)/200) * maturity * spread * efficiency)",
      base: "tvl_usd*0.25",
      growth: "clamp(change_7d ?? 0,-60,120)",
      growthMult: "1+growth/100*0.5",
      maturity: "0.6+min(max(age_days ?? 365,0),1095)/1095*0.4",
      spread: "1+0.05*min(chains.length,8)",
      velocity: "tvl_usd/max(age_days ?? 365,30)",
      efficiency: "0.9+0.2*clamp(log10(1+velocity/1e6)/2,0,1)",
    },
  },
  rows,
  live,
};
writeFileSync(join(outDir, "data.js"), `window.RADAR = ${JSON.stringify(payload)};\n`);

const dashSrc = join(ROOT, "dashboard");
const shotsSrc = join(ROOT, "screenshots");
if (!existsSync(join(dashSrc, "index.html"))) throw new Error("boardIssue: dashboard/index.html missing");
cpSync(dashSrc, join(outDir, "dashboard"), { recursive: true });
cpSync(shotsSrc, join(outDir, "screenshots"), { recursive: true });

writeFileSync(join(outDir, "dossier.json"), Buffer.from(buildDossier(outDir, { text_max_bytes: 65536 })));

console.log(
  `radar: ${rows.length} rows (watchlist ${snap.watchlist.length}/${snap.watchlist.length}, early below floor ${earlyBelow}, live set aside ${liveTotal}) -> ${outDir}`,
);
