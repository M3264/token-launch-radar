/* Token Launch Radar: no-network board. Reads window.RADAR (written by main.ts). */
(function () {
  "use strict";
  var D = window.RADAR || { meta: {}, rows: [], live: [] };
  var meta = D.meta || {}, rows = D.rows || [], live = D.live || [];
  var bySlug = {};
  rows.concat(live,D.research||[]).forEach(function (r) { bySlug[r.slug] = r; });

  var state = { tab: "pre", q: "", cat: "", sort: "rank", dir: 1, limit: 50, open: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"; }); }
  function usd(v) {
    if (v == null) return "—";
    var a = Math.abs(v);
    if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return "$" + (v / 1e3).toFixed(0) + "K";
    return "$" + v;
  }
  function pct(v) {
    if (v == null) return '<span class="flat">n/a</span>';
    var c = v > 0.005 ? "up" : v < -0.005 ? "down" : "flat";
    var s = (v > 0 ? "+" : "") + v.toFixed(2) + "%";
    return '<span class="' + c + '">' + s + "</span>";
  }
  function age(v) {
    if (v == null) return "—";
    if (v >= 730) return (v / 365).toFixed(1) + "y";
    if (v >= 60) return Math.round(v / 30.4) + "mo";
    return v + "d";
  }

  /* Independent standardized regression arithmetic from lib/value.ts predictValue, run in-page per row. */
  function recompute(r) {
    var f=meta.regression, a=r.age_days==null?365:Math.max(0,r.age_days);
    var x=[Math.log(Math.max(1,r.tvl_usd)),Math.min(120,Math.max(-60,r.change_7d==null?0:r.change_7d))/100,Math.log(1+a),Math.log(1+r.chains.length)];
    var log=f.beta[0];for(var j=0;j<4;j++)log+=f.beta[j+1]*(x[j]-f.center[j])/f.scale[j];
    return Math.max(1,Math.round(r.tvl_usd*Math.min(2,Math.max(.05,Math.exp(log)))));
  }
  function valOf(r) { return state.tab === "pre" ? r.implied_value_usd : (r.mcap_usd == null ? -1 : r.mcap_usd); }

  function readHash() {
    var h = (location.hash || "").replace(/^#/, "");
    if (!h) return;
    h.split("&").forEach(function (kv) {
      var k = kv.split("=");
      var key = decodeURIComponent(k[0] || ""), v = decodeURIComponent(k[1] || "");
      if (key === "q") state.q = v;
      else if (key === "category") state.cat = v;
      else if (key === "p") state.open = v || null;
      else if (key === "tab" && (v === "pre" || v === "live" || v === 'research')) state.tab = v;
    });
  }
  function writeHash() {
    var parts = [];
    if (state.q) parts.push("q=" + encodeURIComponent(state.q));
    if (state.cat) parts.push("category=" + encodeURIComponent(state.cat));
    if (state.tab === "live") parts.push("tab=live");
    if (state.open) parts.push("p=" + encodeURIComponent(state.open));
    var h = parts.length ? "#" + parts.join("&") : "#";
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  function current() {
    var src = state.tab === 'research' ? (D.research||[]) : state.tab === "pre" ? rows : live;
    var q = state.q.trim().toLowerCase();
    var out = src.filter(function (r) {
      if (state.cat && (r.category || "Uncategorized") !== state.cat) return false;
      if (q && (r.name + " " + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var k = state.sort, d = state.dir;
    out.sort(function (a, b) {
      var x, y;
      if (k === "name") { x = a.name.toLowerCase(); y = b.name.toLowerCase(); return x < y ? -d : x > y ? d : 0; }
      if (k === "tvl") { x = a.tvl_usd; y = b.tvl_usd; }
      else if (k === "comp") {
        x = (a.model && a.model.compMult) || 0; y = (b.model && b.model.compMult) || 0;
      }
      else if (k === "change") { x = a.change_7d == null ? -1e18 : a.change_7d; y = b.change_7d == null ? -1e18 : b.change_7d; }
      else if (k === "age") { x = a.age_days == null ? -1 : a.age_days; y = b.age_days == null ? -1 : b.age_days; }
      else if (k === "value") { x = valOf(a); y = valOf(b); }
      else { x = a.rank || 0; y = b.rank || 0; }
      return (x - y) * d || (a.slug < b.slug ? -1 : 1);
    });
    return out;
  }

  var COLS = [
    ["rank", "Rank"], ["name", "Protocol"], ["tvl", "TVL"],
    ["change", "7d"], ["age", "Tracked"], ["comp", "Multiple"], ["value", "Implied value"], ["status", "Status"],
  ];

  function renderHead() {
    $("headrow").innerHTML = COLS.map(function (c) {
      var arrow = state.sort === c[0] ? (state.dir === 1 ? " ▲" : " ▼") : "";
      var label = c[0] === "value" && state.tab === "live" ? "Market cap" : c[1];
      return '<th data-k="' + c[0] + '">' + label + arrow + "</th>";
    }).join("");
    Array.prototype.forEach.call($("headrow").children, function (th) {
      th.onclick = function () {
        var k = th.getAttribute("data-k");
        if (k === "status") return;
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = k === "name" ? 1 : -1; }
        render();
      };
    });
  }

  function render() {
    renderHead();
    var list = current();
    var shown = list.slice(0, state.limit);
    var max = 1;
    shown.forEach(function (r) { max = Math.max(max, valOf(r)); });
    $("rows").innerHTML = shown.map(function (r) {
      var v = valOf(r);
      var w = Math.max(2, Math.round((v / max) * 120));
      var val = v < 0 ? "—" : usd(v) + '<span class="bar" style="width:' + w + 'px"></span>';
      var badge = state.tab === "pre"
        ? '<span class="badge pre">pre-token</span>' : '<span class="badge live">'+(state.tab==='research'?'uncertain':'live')+'</span>';
      var rankCell = r.rank != null && r.rank <= 3 && state.tab === "pre"
        ? '<span class="medal m' + r.rank + '">' + r.rank + "</span>" : (r.rank || "—");
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.open === r.slug ? ' class="sel"' : "") + '">' +
        "<td>" + rankCell + "</td>" +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) +
        '</span> <span class="catchip">' + esc(r.category || "Uncategorized") + "</span></td>" +
        "<td>" + usd(r.tvl_usd) + "</td><td>" + pct(r.change_7d) + "</td><td>" + age(r.age_days) + "</td>" +
        "<td>" + (r.model && r.model.compMult != null ? Number(r.model.compMult).toFixed(2) + "×" : "—") + "</td>" +
        "<td>" + val + "</td><td>" + badge + "</td></tr>";
    }).join("");
    Array.prototype.forEach.call($("rows").children, function (tr) {
      tr.onclick = function () {
        state.open = state.open === tr.getAttribute("data-slug") ? null : tr.getAttribute("data-slug");
        writeHash(); render();
      };
    });
    $("empty").hidden = list.length > 0;
    var cnt = $("count");
    if (cnt) cnt.textContent = "showing " + shown.length + " of " + list.length +
      " protocols" + (state.tab === "pre" ? " · click a row for its model inputs and farm plan" : "");
    renderDrawer();
    writeHash();
  }

  function fact(label, v) { return "<div><b>" + esc(v) + "</b><span>" + esc(label) + "</span></div>"; }

  function renderDrawer() {
    var d = $("drawer");
    var r = state.open ? bySlug[state.open] : null;
    if (!r) { d.hidden = true; d.innerHTML = ""; return; }
    var isPre = r.token_status === "pre-token" || r.implied_value_usd != null;
    var facts = fact("TVL", usd(r.tvl_usd)) +
      fact("7-day change", r.change_7d == null ? "n/a" : (r.change_7d > 0 ? "+" : "") + r.change_7d.toFixed(2) + "%") +
      fact("Tracking age", r.age_days == null ? "unknown" : age(r.age_days)) +
      fact("Chains", String(r.chains.length));
    var mid;
    if (isPre && r.implied_value_usd != null) {
      var again = recompute(r);
      var ok = again === r.implied_value_usd;
      mid = '<div class="match ' + (ok ? "ok" : "bad") + '">' +
        "in-page recompute " + usd(again) + (ok ? " — matches board.json" : " — MISMATCH vs board.json " + usd(r.implied_value_usd)) + "</div>";
      mid += "<h3>Model inputs — this row's own snapshot figures</h3><div class=\"facts\">" +
        fact("tvl_usd", "$" + String(r.tvl_usd)) +
        fact("change_7d", r.change_7d == null ? "null" : String(r.change_7d)) +
        fact("listed_at", r.listed_at == null ? "null" : String(r.listed_at)) +
        fact("chains (" + r.chains.length + ")", r.chains.join(", ")) + "</div>";
      if (r.model) {
        mid += "<h3>Derived factors</h3><div class=\"facts\">" +
          fact("fitted mcap/TVL ×",
            Number(r.model.compMult).toFixed(4) + " · " + String(r.model.compSource || "")) +
          fact("base comp×TVL", usd(Math.round(r.model.base))) +
          fact("live peers in category", String(r.model.categoryLiveN)+"; category not used by regression") +
          fact("implied scenario", usd(r.implied_value_usd)) + "</div>";
        var u=r.model.residual_interval, e=r.model.explanation;
        mid += '<h3>Residual-calibrated reference range</h3><p class="note">'+usd(u.lower_usd)+' – '+usd(u.upper_usd)+' · 80% nominal split-conformal range around a separate '+usd(u.reference_value_usd)+' reference fit. '+meta.uncertainty.calibration_n+' held-out calibration residuals; factor '+Number(meta.uncertainty.factor).toFixed(2)+'×. Outer live-token coverage '+meta.uncertainty.validation.covered+'/'+meta.uncertainty.validation.n+'. Not a confidence interval for the full-data board estimate; no guaranteed coverage for pre-token products, launches or wallet rewards.</p>';
        mid += '<details><summary>Feature contributions and data-quality flags</summary><p>Intercept '+e.intercept.toFixed(3)+'; unclipped log multiple '+e.unclipped_log_multiple.toFixed(3)+'. Log contributions explain the model, not causal effects.</p><ul>'+e.terms.map(function(t){return '<li>'+esc(t.feature)+': '+t.log_contribution.toFixed(3)+' log units</li>';}).join('')+'</ul><ul>'+e.flags.map(function(f){return '<li>'+esc(f)+'</li>';}).join('')+'</ul></details>';
        mid += '<p class="note">Not a token allocation, expected reward or launch likelihood. Tracking age is not token-free history.</p>';
      }
      if (r.plan_cost && r.plan_cost.line) {
        mid += '<div class="match ok">' + esc(r.plan_cost.line) + "</div>";
      }
      mid += "<h3>Conditional research pilot · verify before spending</h3><ol>" + r.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
    } else {
      mid = r.token_status==='uncertain' ? '<h3>Uncertain research universe · not ranked</h3><ul>'+r.reasons.map(function(reason){return '<li>'+esc(reason)+'</li>';}).join('')+'</ul><p>No independent token or farming eligibility verified. Exclusion is a conservative research policy, not proof.</p>' : '<div class="match ok">token recorded — set aside; trading not independently verified, no implied value</div>' +
        "<div class=\"facts\">" + fact("Market cap", r.mcap_usd == null ? "unreported" : usd(r.mcap_usd)) + "</div>";
    }
    d.innerHTML = '<button class="x">close ✕</button><h2>' + esc(r.name) + "</h2>" +
      '<div class="dslug">' + esc(r.slug) + " · " + esc(r.category || "Uncategorized") + " · " + esc(r.chains.join(", ")) + "</div>" +
      '<div class="facts">' + facts + "</div>" + mid;
    d.hidden = false;
    d.querySelector(".x").onclick = function () { state.open = null; render(); };
  }

  function renderStatic() {
    var m = meta.model || {};
    $("meta").textContent = "sealed snapshot " + meta.as_of + " · floor " + usd(meta.floor_usd) + " · not a live feed";
    var b=meta.validation.metrics, metric=b.robust;
    $("kpis").innerHTML = fact("watchlist covered",meta.watchlist_covered+"/"+meta.watchlist_total)+fact("protocols ranked",meta.rows_scored)+fact("early below floor",meta.early_below_floor)+fact("live set aside",meta.live_set_aside);
    $("validation").innerHTML='<strong>Held-out validation · '+meta.validation.live_count+' live protocols · 5 deterministic folds</strong><br>'+Object.keys(b).map(function(k){return esc(k)+': '+b[k].median_abs_log_error.toFixed(3)+' log error / '+b[k].error_factor.toFixed(2)+'×';}).join(' · ')+'<br><span>Selected: robust log regression. Lower is better; error factor = exp(median |ln(pred/actual)|). Training-only fitting and scaling. Exploratory comparison, not an untouched test; no temporal or airdrop validation. Values are market-cap scenarios, not wallet payouts.</span>';
    $('validation').innerHTML += '<br>Research holds: '+meta.research_held+' optional rows, excluded from ranking but not proven non-candidates. Token absence means snapshot fields only. <button id="researchOpen">View uncertain universe</button>';
    $('researchOpen').onclick=function(){state.tab='research';state.q='';state.cat='';state.sort='name';state.dir=1;render();};
    var cats = {};
    rows.forEach(function (r) { cats[r.category || "Uncategorized"] = 1; });
    var sel = $("cat"), keep = state.cat;
    sel.innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
    }).join("");
    sel.value = keep;
    $("formula").textContent = m.formula+". Huber regression predicts log(mcap/TVL); ridge penalty 10 on slopes, 30 IRLS iterations. Category is not used, so a single live peer cannot dictate a category multiple. No launch probability is estimated.";
    var f=meta.regression;
    var terms=[["features","log TVL; clamp(7d,-60,120)/100; log(1+tracking days); log(1+chains)"],["missing values","growth 0; tracking age 365 days; no evidence of token-free history"],["beta",f.beta.map(function(v){return v.toFixed(6);}).join(", ")],["training centers",f.center.map(function(v){return v.toFixed(6);}).join(", ")],["training scales",f.scale.map(function(v){return v.toFixed(6);}).join(", ")],["multiple band","[0.05,2.0] retained for identical comparison with baseline"],["uncertainty","large residual errors; market cap is not FDV, claim value, or expected reward"]];
    $("terms").innerHTML=terms.map(function(t){return "<dt>"+esc(t[0])+"</dt><dd>"+esc(t[1])+"</dd>";}).join("");
    $("fit").textContent = meta.validation.split+". "+meta.validation.limitations;
    $("foot").textContent = "token launch radar · snapshot " + meta.as_of + " · " + rows.length +
      " pre-token rows ranked strongest first · implied values are the entry's own claim, not financial advice";
  }

  readHash();
  renderStatic();
  $("q").value = state.q;
  $("limit").value = String(state.limit);
  $("tabPre").className = state.tab === "pre" ? "on" : "";
  $("tabLive").className = state.tab === "live" ? "on" : "";
  $("q").addEventListener("input", function (e) { state.q = e.target.value; render(); });
  $("cat").addEventListener("change", function (e) { state.cat = e.target.value; render(); });
  $("limit").addEventListener("change", function (e) { state.limit = Number(e.target.value); render(); });
  $("tabPre").onclick = function () { state.tab = "pre"; state.sort = "rank"; state.dir = 1; renderStatic();
    $("tabPre").className = "on"; $("tabLive").className = ""; render(); };
  $("tabLive").onclick = function () { state.tab = "live"; state.sort = "value"; state.dir = -1; renderStatic();
    $("tabLive").className = ""; $("tabLive").className = "on"; render(); };
  $("reset").onclick = function () {
    state.q = ""; state.cat = ""; state.open = null;
    $("q").value = ""; $("cat").value = ""; render();
  };
  window.addEventListener("hashchange", function () {
    var keep = state.open;
    readHash(); $("q").value = state.q;
    renderStatic(); render();
    if (keep !== state.open) render();
  });
  render();
})();
