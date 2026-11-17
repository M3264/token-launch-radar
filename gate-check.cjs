const fs = require('node:fs');
const KIT = '/data/workspace/makefun/token-radar-01-kit/token-radar-01-kit';
const snap = JSON.parse(fs.readFileSync(KIT + '/input/snapshot.json', 'utf8'));
const wl = new Set(snap.watchlist);
const b = JSON.parse(fs.readFileSync('out/board.json', 'utf8')).rows;
const out = [];
out.push('rows: ' + b.length + ' (need 100-4000)');
out.push('ranks 1..N: ' + b.every((r, i) => r.rank === i + 1));
let desc = true;
for (let i = 1; i < b.length; i++) if (b[i].implied_value_usd > b[i - 1].implied_value_usd) { desc = false; break; }
out.push('non-increasing implied: ' + desc);
out.push('all-equal refused-check: ' + (b[0].implied_value_usd === b[b.length - 1].implied_value_usd ? 'FAIL' : 'pass'));
out.push('watchlist covered: ' + b.filter((r) => wl.has(r.slug)).length + '/' + wl.size);
out.push('early rows: ' + b.filter((r) => !wl.has(r.slug)).length);
let badSteps = 0, nSteps = 0, maxStep = 0;
for (const r of b) {
  nSteps += r.farm_steps.length;
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) badSteps++;
  for (const s of r.farm_steps) { maxStep = Math.max(maxStep, s.length); if (s.length < 20 || s.length > 600) badSteps++; }
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) badSteps++;
}
out.push('avg steps/row: ' + (nSteps / b.length).toFixed(2) + ', bad step rows: ' + badSteps + ', longest step: ' + maxStep);
out.push('board.json bytes: ' + fs.statSync('out/board.json').size + ' (<=8388608)');
out.push('data.js bytes: ' + fs.statSync('out/data.js').size);
out.push('dossier.json bytes: ' + fs.statSync('out/dossier.json').size + ' (<=1572864)');
let dashBytes = 0, dashFiles = 0;
for (const f of fs.readdirSync('out/dashboard')) { const s = fs.statSync('out/dashboard/' + f); if (s.isFile()) { dashFiles++; dashBytes += s.size; } }
out.push('dashboard files: ' + dashFiles + ' (<=400), bytes: ' + dashBytes + ' (<=4194304)');
let srcBytes = 0;
for (const f of ['index.html', 'app.css', 'app.js']) srcBytes += fs.statSync('out/dashboard/' + f).size;
out.push('dashboard judged source bytes: ' + srcBytes + ' (want <=65536)');
const shots = fs.readdirSync('out/screenshots').filter((f) => !f.startsWith('.'));
let shotBytes = 0;
for (const f of shots) { const s = fs.statSync('out/screenshots/' + f).size; shotBytes += s; out.push('shot ' + f + ': ' + s + ' bytes (<=524288)'); }
out.push('shots: ' + shots.length + ' total bytes: ' + shotBytes);
// no-network rule: check dashboard source for http(s) in attrs/imports/css
const src = ['index.html', 'app.css', 'app.js'].map((f) => fs.readFileSync('out/dashboard/' + f, 'utf8')).join('\n');
const attrHits = (src.match(/(href|src|action|srcset)\s*=\s*["']https?:\/\//gi) || []).length;
const importHits = (src.match(/(import\s+[^;]*?from\s*|require\s*\(|import\s*\()\s*["']https?:\/\//gi) || []).length;
const cssHits = (src.match(/@import\s+["']https?:\/\//gi) || []).length;
out.push('http refs in attrs: ' + attrHits + ', in imports: ' + importHits + ', css @import: ' + cssHits);
// in-page recompute check on 20 sample rows
const dataJs = fs.readFileSync('out/data.js', 'utf8').trim().replace(/^window\.RADAR=/, '').replace(/;\s*$/, '');
const RADAR = JSON.parse(dataJs);
const m = RADAR.model;
function impliedOf(row) {
  const growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
  const growthMult = 1 + (growth / 100) * m.growth_weight;
  const age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
  const maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
  const spread = 1 + m.spread_step * Math.min((row.chains || []).length, m.spread_cap_chains);
  const velocity = row.tvl_usd / Math.max(age, 30);
  const efficiency = m.efficiency_lo + (m.efficiency_hi - m.efficiency_lo) * Math.min(Math.max(Math.log10(1 + velocity / 1e6) / 2, 0), 1);
  return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * growthMult * maturity * spread * efficiency));
}
let mism = 0;
for (let i = 0; i < RADAR.rows.length; i += 7) {
  const r = RADAR.rows[i];
  const boardRow = b.find((x) => x.slug === r.slug);
  if (impliedOf(r) !== boardRow.implied_value_usd) { mism++; out.push('MISMATCH ' + r.slug); }
}
out.push('recompute mismatches: ' + mism);
console.log(out.join('\n'));
