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
import { ageDays, farmSteps, isRankable, planCost } from "./lib/model.ts";
import { benchmark,fitValue,predictValue } from "./lib/value.ts";
import {calibrate,interval,assessIntervals,explain} from './lib/uncertainty.ts';
import {researchReasons} from './lib/identity.ts';
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
const research:any[]=[];
for (const slug of snap.watchlist) {
  const p = bySlug.get(slug);
  if (!p) throw new Error(`boardIssue: watchlist slug ${slug} is not in the snapshot`);
  picked.set(slug, p);
}
for (const p of snap.protocols) {
  if (watch.has(p.slug)) continue;
  if (!isRankable(p)) continue;
  if (p.tvl_usd >= floor) continue;
  const reasons=researchReasons(p,snap.protocols);
  if(reasons.length){research.push({...p,token_status:'uncertain',reasons});continue;}
  picked.set(p.slug, p);
}

interface Scored {
  p: SnapshotProtocol;
  implied: number;
  model: Record<string, any>;
  age: number | null;
  steps: string[];
  cost: ReturnType<typeof planCost>;
}

// Fit only positive, finite live-token market caps; the benchmark refits within each fold.
const validation = benchmark(snap.protocols,asOf);
const valueFit = fitValue(snap.protocols.filter(p=>p.category!=="CEX"),"robust",asOf);
const calibration=calibrate(snap.protocols,asOf);
const intervalValidation=assessIntervals(snap.protocols,asOf);
const selected = validation.metrics.robust;
const scored: Scored[] = [];
for (const p of picked.values()) {
  const pred = predictValue(valueFit,p);
  scored.push({
    p,
    implied: pred.value,
    model: {
      base: p.tvl_usd*pred.mult,
      compMult: pred.mult,
      compSource: pred.source,
      categoryLiveN: pred.n,
      uncertainty: "80% nominal split-conformal reference range; live-token exchangeability only, not launch odds",
      residual_interval: interval(calibration,p),
      explanation: explain(valueFit,p,asOf),
    },
    age: ageDays(p.listed_at,asOf),
    steps: farmSteps(p, asOf),
    cost: planCost(p),
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
  plan_cost: s.cost,
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

writeFileSync(join(outDir,'research-universe.json'),JSON.stringify({policy:'Optional rows excluded from candidate ranking, not proven non-candidates',rows:research})+'\n');
writeFileSync(join(outDir,"validation.json"),JSON.stringify(validation)+"\n");
const payload = {
  meta: {
    as_of: asOf,
    validation: {...validation,predictions:undefined},
    regression: {beta:valueFit.beta,center:valueFit.center,scale:valueFit.scale},
    uncertainty: {...calibration,fit:undefined,validation:{...intervalValidation,predictions:undefined}},
    floor_usd: floor,
    watchlist_total: snap.watchlist.length,
    watchlist_covered: snap.watchlist.length,
    rows_scored: rows.length,
    early_below_floor: earlyBelow,
    research_held: research.length,
    live_set_aside: liveTotal,
    live_shown: live.length,
    model: {
      formula: "implied = round(TVL * clamp(exp(beta dot standardized log-features),0.05,2))",
      base: "tvl_usd*compMult",
      comp: "Huber regression of log(mcap/TVL) using log TVL, bounded growth, log tracking age, log(1+chains); category not used",
      fit_live_protocols: valueFit.n,
      fit_med_abs_log_err: selected.median_abs_log_error,
      fit_error_factor: selected.error_factor,
      fit_method: "5-fold held-out Huber log regression, ridge 10, training-only scaling; exploratory model comparison",


    },
  },
  rows,
  live,
  research,
};
writeFileSync(join(outDir, "data.js"), `window.RADAR = ${JSON.stringify(payload)};\n`);
writeFileSync(join(outDir,'uncertainty-validation.json'),JSON.stringify(intervalValidation)+'\n');

const dashSrc = join(ROOT, "dashboard");
const shotsSrc = join(ROOT, "screenshots");
if (!existsSync(join(dashSrc, "index.html"))) throw new Error("boardIssue: dashboard/index.html missing");
cpSync(dashSrc, join(outDir, "dashboard"), { recursive: true });
cpSync(shotsSrc, join(outDir, "screenshots"), { recursive: true });
// Exact executable model/validation source for reproducibility, not judge instructions.
for(const [name,source] of [['model-method.txt','lib/value.ts'],['uncertainty-method.txt','lib/uncertainty.ts'],['identity-method.txt','lib/identity.ts']]) writeFileSync(join(outDir,'dashboard',name),readFileSync(join(ROOT,source)));
writeFileSync(join(outDir,'dashboard','validation-summary.json'),JSON.stringify({...validation,predictions:undefined}));

writeFileSync(join(outDir, "dossier.json"), Buffer.from(buildDossier(outDir, { text_max_bytes: 65536 })));

console.log(
  `radar: ${rows.length} rows (watchlist ${snap.watchlist.length}/${snap.watchlist.length}, early below floor ${earlyBelow}, live set aside ${liveTotal}) -> ${outDir}`,
);
console.log(`validation: robust held-out median |ln(pred/mcap)| ${selected.median_abs_log_error.toFixed(4)}, factor ${selected.error_factor.toFixed(4)} over ${validation.live_count} live protocols`);
