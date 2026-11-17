// Own gate check for the token-radar-01 entry. Verifies the files main.ts wrote:
// board shape/ranks/order/coverage/farm steps, file caps, no-network rule,
// screenshot validity, dossier shape, dashboard-source cap, and an in-page
// recompute of sampled rows with the same arithmetic as lib/model.ts.
//
//   node gate-check.cjs --input /path/to/snapshot.json --out out
"use strict";
const fs = require("node:fs");
const path = require("node:path");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const inputPath = arg("--input", "/input/snapshot.json");
const outDir = path.resolve(arg("--out", process.env.MAKEFUN_OUTPUT_DIR || "out"));

const failures = [];
const numbers = {};
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

const snap = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const board = JSON.parse(fs.readFileSync(path.join(outDir, "board.json"), "utf8"));
const rows = Array.isArray(board) ? board : board.rows;

// --- board shape ---
check("rows-100-4000", Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000, `${rows.length} rows`);
numbers.rows = rows.length;
const snapSlugs = new Set(snap.protocols.map((p) => p.slug));
check("slugs-known", rows.every((r) => snapSlugs.has(r.slug)), `${rows.length} slugs`);
const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
check("ranks-1..N", ranks.every((v, i) => v === i + 1), `N=${rows.length}`);
const byRank = [...rows].sort((a, b) => a.rank - b.rank);
let nonIncreasing = true;
for (let i = 1; i < byRank.length; i++) {
  if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) { nonIncreasing = false; break; }
}
check("values-non-increasing", nonIncreasing, `rank1=${byRank[0].implied_value_usd} rankN=${byRank[byRank.length - 1].implied_value_usd}`);
numbers.rank1 = byRank[0].implied_value_usd;
numbers.rankN = byRank[byRank.length - 1].implied_value_usd;
check("values-not-all-equal", new Set(rows.map((r) => r.implied_value_usd)).size > 1, `${new Set(rows.map((r) => r.implied_value_usd)).size} distinct`);
const covered = rows.filter((r) => snap.watchlist.includes(r.slug)).length;
check("watchlist-40/40", covered === 40 && snap.watchlist.length === 40, `${covered}/${snap.watchlist.length}`);
numbers.watchlist = `${covered}/${snap.watchlist.length}`;
const early = rows.filter((r) => !snap.watchlist.includes(r.slug)).length;
numbers.early_below_floor = early;
const stepsOk = rows.every((r) => Array.isArray(r.farm_steps) &&
  r.farm_steps.length >= 3 && r.farm_steps.length <= 12 &&
  r.farm_steps.every((s) => typeof s === "string" && s.trim().length >= 20 && s.trim().length <= 600));
check("farm-steps-count-length", stepsOk, "3-12 steps, 20-600 chars");
const valsOk = rows.every((r) => Number.isSafeInteger(r.implied_value_usd) &&
  r.implied_value_usd >= 1 && r.implied_value_usd <= 100000000000000);
check("values-safe-range", valsOk, "1..1e14 safe integers");

// --- comps fit invariants ---
const compOk = rows.every((r) => r.model && typeof r.model.compMult === "number" &&
  r.model.compMult >= 0.05 && r.model.compMult <= 2.0 && typeof r.model.compSource === "string");
check("model-comp-band", compOk, "compMult in [0.05, 2.0] with source label");
const costOk = rows.every((r) => r.plan_cost && typeof r.plan_cost.line === "string" &&
  r.plan_cost.line.trim().length >= 20 && r.plan_cost.line.trim().length <= 600 &&
  /capital/i.test(r.plan_cost.line) && /gas/i.test(r.plan_cost.line) &&
  Number.isFinite(r.plan_cost.capital_usd) && Number.isFinite(r.plan_cost.gas_total_units));
check("plan-cost-total", costOk, "explicit capital+gas cost line per plan");

// --- file caps ---
const boardBytes = fs.statSync(path.join(outDir, "board.json")).size;
check("board-<=8MiB", boardBytes <= 8 * 1024 * 1024, `${boardBytes} bytes`);
numbers.board_bytes = boardBytes;
const dossierPath = path.join(outDir, "dossier.json");
const dossierBytes = fs.statSync(dossierPath).size;
check("dossier-<=1572864", dossierBytes <= 1572864, `${dossierBytes} bytes`);
numbers.dossier_bytes = dossierBytes;
const dossier = JSON.parse(fs.readFileSync(dossierPath, "utf8"));
check("dossier-shape", dossier.schema === "makefun/dossier/v1" && Array.isArray(dossier.images) && typeof dossier.text === "string",
  `${dossier.images.length} images`);
numbers.dossier_images = dossier.images.length;

function walk(dir, rel) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out = out.concat(walk(path.join(dir, e.name), p));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}
const dashDir = path.join(outDir, "dashboard");
const dashFiles = walk(dashDir, "");
let dashBytes = 0;
for (const f of dashFiles) dashBytes += fs.statSync(path.join(dashDir, f)).size;
check("dashboard-total-<=4MiB", dashBytes <= 4 * 1024 * 1024, `${dashFiles.length} files, ${dashBytes} bytes`);
numbers.dashboard_files = dashFiles.length;
numbers.dashboard_bytes = dashBytes;
const srcFiles = dashFiles.filter((f) => /\.(html|css|js)$/.test(f));
let srcBytes = 0;
for (const f of srcFiles) srcBytes += fs.statSync(path.join(dashDir, f)).size;
check("dashboard-source-<=65536", srcBytes <= 65536, `${srcBytes} bytes`);
numbers.dashboard_source_bytes = srcBytes;
check("dashboard-has-shell", dashFiles.includes("index.html") && dashFiles.some((f) => f.endsWith(".css")) && dashFiles.some((f) => f.endsWith(".js")), srcFiles.join(","));
const nameOk = dashFiles.every((f) => f.split("/").every((seg, i) =>
  (i < f.split("/").length - 1 ? !seg.startsWith(".") : true) && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(seg)));
check("dashboard-names", nameOk, `${dashFiles.length} names`);

// --- no-network rule ---
function noHttpInAttr(html) {
  const re = /(href|src|action|srcset|poster|content|data-[a-z-]+)\s*=\s*["']https?:\/\//i;
  return !re.test(html);
}
function noHttpImport(js) {
  const re = /(import\s+(?:[^'"]*from\s+)?|export\s+[^'"]*from\s+|require\s*\(\s*|import\s*\(\s*)["']https?:\/\//;
  return !re.test(js);
}
let netOk = true;
for (const f of dashFiles) {
  const full = path.join(dashDir, f);
  const txt = fs.readFileSync(full, "utf8");
  if (f.endsWith(".html")) {
    if (!noHttpInAttr(txt)) { netOk = false; console.log(`  offender: ${f} (html attr)`); }
    const styles = txt.match(/<style[\s>][\s\S]*?<\/style>/gi) || [];
    const scripts = txt.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const s of styles) if (/https?:\/\//.test(s)) { netOk = false; console.log(`  offender: ${f} (style)`); }
    for (const s of scripts) if (!noHttpImport(s)) { netOk = false; console.log(`  offender: ${f} (inline import)`); }
  } else if (f.endsWith(".css")) {
    if (/https?:\/\//.test(txt)) { netOk = false; console.log(`  offender: ${f} (css)`); }
  } else if (f.endsWith(".js")) {
    if (!noHttpImport(txt)) { netOk = false; console.log(`  offender: ${f} (js import)`); }
  }
}
check("no-network-refs", netOk, `${dashFiles.length} dashboard files scanned`);

// --- screenshots ---
function pngDims(b) {
  if (b.length < 33) return null;
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!magic.every((v, i) => b[i] === v)) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: "png" };
}
function jpegDims(b) {
  if (!(b[0] === 0xff && b[1] === 0xd8)) return null;
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0xd9 || (m >= 0xe0 && m <= 0xef)) { i += 2 + (b.readUInt16BE(i + 2) || 0); continue; }
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), type: "jpeg" };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
const shotsDir = path.join(outDir, "screenshots");
const shots = fs.readdirSync(shotsDir).filter((e) => !e.startsWith(".") &&
  fs.statSync(path.join(shotsDir, e)).isFile()).sort();
check("screenshots-3-4", shots.length >= 3 && shots.length <= 4, shots.join(","));
numbers.screenshots = shots.length;
let shotsOk = true;
for (const s of shots) {
  const full = path.join(shotsDir, s);
  const b = fs.readFileSync(full);
  const dims = pngDims(b) || jpegDims(b);
  const sizeOk = b.length <= 524288;
  const dimsOk = dims !== null && Math.max(dims.w, dims.h) <= 1440 && Math.min(dims.w, dims.h) >= 800;
  console.log(`  shot ${s}: ${dims ? `${dims.type} ${dims.w}x${dims.h}` : "NOT-AN-IMAGE"}, ${b.length} bytes`);
  if (!(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(s) && sizeOk && dimsOk)) shotsOk = false;
  if (dims) numbers[`shot_${s}`] = `${dims.type} ${dims.w}x${dims.h} ${b.length}B`;
}
check("screenshots-size-dims", shotsOk, "each <=524288B, long<=1440 short>=800");

// --- data.js agrees with board.json ---
const dataJs = fs.readFileSync(path.join(outDir, "data.js"), "utf8");
const m = dataJs.match(/window\.RADAR\s*=\s*(\{[\s\S]*\});?\s*$/);
check("data.js-parse", !!m, `${dataJs.length} bytes`);
if (m) {
  const data = JSON.parse(m[1]);
  check("data.js-rows-match", Array.isArray(data.rows) && data.rows.length === rows.length &&
    data.rows[0].slug === byRank[0].slug && data.rows[0].implied_value_usd === byRank[0].implied_value_usd,
    `${data.rows.length} rows, rank1=${data.rows[0] && data.rows[0].slug}`);
  check("data.js-live-24", Array.isArray(data.live) && data.live.length <= 24 && data.live.length > 0,
    `${data.live.length} live`);
  numbers.live_shown = data.live.length;
  const fm = (data.meta && data.meta.model) || {};
  check("data.js-fit-quality", Number.isFinite(fm.fit_med_abs_log_err) && fm.fit_med_abs_log_err >= 0 &&
    Number.isInteger(fm.fit_live_protocols) && fm.fit_live_protocols > 0,
    `medAbsLogErr=${fm.fit_med_abs_log_err} over ${fm.fit_live_protocols} live`);
  numbers.fit_med_abs_log_err = fm.fit_med_abs_log_err;
  numbers.fit_live = fm.fit_live_protocols;
}

// --- in-page recompute equality on sampled rows ---
function recompute(r) {
  const cm = (r.model && r.model.compMult) || 0.25;
  const base = r.tvl_usd * cm;
  const g = r.change_7d == null ? 0 : Math.min(120, Math.max(-60, r.change_7d));
  const gm = 1 + g / 100 * 0.5;
  const a = Math.min(1095, Math.max(0, r.age_days == null ? 365 : r.age_days));
  const mat = 0.6 + (a / 1095) * 0.4;
  const sp = 1 + 0.05 * Math.min(r.chains.length, 8);
  const denom = Math.max(r.age_days == null ? 365 : r.age_days, 30);
  const vel = r.tvl_usd / denom;
  const eff = 0.9 + 0.2 * Math.min(1, Math.max(0, Math.log10(1 + vel / 1e6) / 2));
  return Math.max(1, Math.round(base * gm * mat * sp * eff));
}
const sampleIdx = new Set([0, rows.length - 1]);
for (let i = 0; i < 25; i++) sampleIdx.add(Math.floor((i * rows.length) / 25));
let matched = 0;
let mismatched = 0;
for (const i of [...sampleIdx].sort((a, b) => a - b)) {
  const r = byRank[i];
  if (recompute(r) === r.implied_value_usd) matched++;
  else { mismatched++; console.log(`  recompute mismatch: ${r.slug} board=${r.implied_value_usd} page=${recompute(r)}`); }
}
check("recompute-sampled", mismatched === 0, `${matched} sampled rows equal`);
numbers.recomputed = matched;

console.log(`\nGATE ${failures.length === 0 ? "GREEN" : "RED"} ${JSON.stringify(numbers)}`);
if (failures.length) { console.log(`failed: ${failures.join(", ")}`); process.exit(1); }
