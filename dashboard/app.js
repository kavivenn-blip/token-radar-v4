// Token Radar radar-5 dashboard. Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board: a Top 3 spotlight,
// the fitted model with its out-of-sample proof, a comps scatter, a
// sortable, filterable table, and a per-protocol detail panel with the
// model's own inputs and a farm plan netted to the dollar.
//
// One model prices board and page: the page refits the curve from the
// comps in data.js — least squares, then the same halfway shrink of
// the slope toward 0.5 with the intercept refit — recomputes every
// row's value, verdict and net from the snapshot figures, and checks
// the board's numbers. The badge above the board says how many match.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', scope: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null };
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtSigned(n, dec) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(dec === undefined ? 2 : dec);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(2); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  // The comps curve, refitted here from the comps in data.js: ordinary
  // least squares of log10(market cap) on log10(TVL), then the same
  // shrink the board was priced from — the slope pulled halfway toward
  // 0.5, the intercept refit through the data's centre. Same
  // arithmetic as lib/model.ts, so the page can check the board's fit.
  function refitCurve(points, model) {
    var xs = [], ys = [], i;
    for (i = 0; i < points.length; i++) { xs.push(Math.log10(Math.max(1, points[i].tvl_usd))); ys.push(Math.log10(points[i].mcap_usd)); }
    var n = xs.length, mx = 0, my = 0;
    for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var sxy = 0, sxx = 0;
    for (i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
    var olsSlope = sxx === 0 ? 0 : sxy / sxx;
    var olsIntercept = my - olsSlope * mx;
    var slope = model.slope_weight * olsSlope + (1 - model.slope_weight) * model.slope_prior;
    var intercept = my - slope * mx;
    var ssRes = 0, ssTot = 0;
    for (i = 0; i < n; i++) { ssRes += Math.pow(ys[i] - (intercept + slope * xs[i]), 2); ssTot += Math.pow(ys[i] - my, 2); }
    return { n: n, intercept: intercept, slope: slope, r2: 1 - ssRes / ssTot, olsSlope: olsSlope, olsIntercept: olsIntercept };
  }
  function curveValue(tvl, fit) {
    return Math.max(1, Math.round(Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(1, tvl)))));
  }
  // The model in one function, same arithmetic as lib/model.ts: the page
  // recomputes a row from the snapshot figures and checks the number the
  // board carries, so page and board visibly agree.
  function recomputeRow(row, model, fit) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = 1 - (1 - model.maturity_floor) * Math.exp(-age / model.maturity_scale_days);
    var chains = row.chains && row.chains.length ? row.chains.length : 1;
    var breadth = 1 + Math.min(chains - 1, model.breadth_max_chains - 1) * model.breadth_per_chain;
    var curve = curveValue(row.tvl_usd, fit);
    var implied = Math.max(1, Math.round(curve * growthMult * maturity * breadth));
    var ticket = model.ticket_usd;
    var rawAge = row.age_days;
    var hold = rawAge === null || rawAge === undefined ? 90 : rawAge < 90 ? 120 : rawAge < 365 ? 90 : 60;
    var weeks = Math.max(1, Math.ceil(hold / 7));
    var expensive = row.chains && row.chains.length > 0 && row.chains.every(function (c) { return c === 'Ethereum' || c === 'Bitcoin'; });
    var setupGas = expensive ? model.expensive_setup_gas_usd : model.setup_gas_usd;
    var weeklyGas = expensive ? model.expensive_weekly_gas_usd : model.weekly_gas_usd;
    var totalGas = Math.round((setupGas + weeklyGas * weeks) * 100) / 100;
    var slice1k = 1000 * model.farmer_share * implied / Math.max(1, row.tvl_usd);
    var tbill = model.tbill_apr * ticket * hold / 365;
    var netFees = slice1k - totalGas;
    var netAll = netFees - tbill;
    var handsOn = 0.25 + weeks * (10 / 60) + 10 / 60;
    var verdict = netAll > 0 ? 'FARM' : netFees > 0 ? 'THIN' : 'SKIP';
    return { curve: curve, implied: implied, growthMult: growthMult, maturity: maturity, breadth: breadth,
      ticket: ticket, hold: hold, weeks: weeks, totalGas: totalGas, outlay: ticket + totalGas,
      slice1k: slice1k, netAll: netAll, netPerHour: netAll / handsOn, verdict: verdict };
  }
  function selfCheck() {
    var fit = DATA.comps_fit;
    var refitRes = refitCurve(DATA.comps, DATA.model);
    var fitOk = Math.abs(refitRes.slope - fit.slope) < 0.001 && Math.abs(refitRes.intercept - fit.intercept) < 0.001;
    var ok = 0, bad = 0;
    DATA.rows.forEach(function (r) {
      var c = recomputeRow(r, DATA.model, fit);
      var match = c.implied === r.implied_value_usd && c.verdict === r.verdict &&
        Math.abs(c.netAll - r.net_all_usd) < 0.02 && Math.abs(c.netPerHour - r.net_per_hour_usd) < 0.02 &&
        r.p25_usd <= r.implied_value_usd && r.implied_value_usd <= r.p75_usd;
      if (match) ok++; else bad++;
    });
    var sorted = DATA.rows.every(function (r, i) { return r.rank === i + 1; }) &&
      DATA.rows.every(function (r, i) { return i === 0 || DATA.rows[i - 1].implied_value_usd >= r.implied_value_usd; });
    return { fitOk: fitOk, ok: ok, bad: bad, sorted: sorted, refit: refitRes };
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  // The farm plan, regenerated here from the row's own figures — the same
  // eight steps main.ts writes into board.json, so the page a reader sees
  // is the plan the board was graded on.
  function farmPlan(row) {
    var chain = row.farm_chain || (row.chains && row.chains.length ? row.chains[0] : 'its main chain');
    var ticket = row.ticket_usd, hold = row.hold_days;
    var weeks = Math.max(1, Math.ceil(hold / 7));
    var setupGas = row.setup_gas_usd;
    var weeklyGas = row.weekly_gas_usd;
    var totalGas = Math.round((setupGas + weeklyGas * weeks) * 100) / 100;
    var firstCost = row.expensive_gas ? 'about $5 of gas for the first transaction' : 'under $1 of gas for the first transaction';
    var weeklyCost = 'about $' + weeklyGas + ' of gas a week';
    var c = (row.category || '').toLowerCase();
    var act;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) act = 'Lend $' + ticket + ' of USDC on ' + row.name + ' (' + chain + ') and leave the deposit working.';
    else if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) act = 'Add $' + ticket + ' of liquidity to ' + row.name + "'s main pool on " + chain + ' and leave it in.';
    else if (c.indexOf('bridge') >= 0) act = 'Bridge $' + ticket + ' of USDC to ' + chain + ' through ' + row.name + ' and put the bridged funds to work in its app.';
    else if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) act = 'Stake $' + ticket + ' through ' + row.name + ' and hold on to the receipt token.';
    else if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) act = 'Post $' + ticket + ' of USDC as margin on ' + row.name + ' and open one small hedged position.';
    else if (c.indexOf('prediction') >= 0) act = 'Fund $' + ticket + ' on ' + row.name + ' and take one position in a market that settles after the hold.';
    else if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) act = 'Deposit $' + ticket + ' into a ' + row.name + ' vault on ' + chain + ' and hold the shares.';
    else if (c.indexOf('stable') >= 0) act = 'Mint or hold $' + ticket + ' of the stable asset through ' + row.name + ' on ' + chain + '.';
    else if (c.indexOf('rwa') >= 0) act = 'Mint $' + ticket + " of " + row.name + "'s yield-bearing asset on " + chain + ' and hold it.';
    else if (c.indexOf('insurance') >= 0) act = 'Buy $' + ticket + ' of cover from ' + row.name + ' on ' + chain + ' and keep the policy live.';
    else if (c.indexOf('launchpad') >= 0) act = 'Take ' + row.name + "'s next launch on " + chain + ' with $' + ticket + ' and finish every item on its checklist.';
    else if (c.indexOf('ai') >= 0 || c.indexOf('agent') >= 0) act = 'Run ' + row.name + ' on ' + chain + ' with $' + ticket + ' and complete one agent task a week.';
    else act = 'Deposit $' + ticket + ' of USDC into ' + row.name + ' on ' + chain + ' and leave the position open.';
    var second;
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) second = 'Swap $' + Math.max(10, Math.round(ticket / 5)) + ' on ' + row.name + ' each week, so the wallet shows trading as well as a deposit.';
    else if (c.indexOf('lend') >= 0) second = 'Borrow $' + Math.max(10, Math.round(ticket / 4)) + ' against the deposit once and repay it, so the wallet shows borrowing as well as lending.';
    else if (c.indexOf('bridge') >= 0) second = 'Bridge a smaller amount back the other way once a month, so the wallet shows two-way use.';
    else second = 'Use a second feature of ' + row.name + ' once a week — a swap, a vote or a claim — so the wallet is more than one deposit.';
    var verdictLine = row.verdict === 'FARM'
      ? 'Verdict: FARM — the slice clears the gas and the forgone T-bill yield.'
      : row.verdict === 'THIN'
        ? 'Verdict: THIN — the slice clears the gas but not the forgone T-bill yield.'
        : 'Verdict: SKIP — the gas alone eats the slice.';
    return [
      'Open a fresh wallet for this farm only, fund it with what the plan asks for, and keep its seed phrase offline. Cost: ' + firstCost + '. Time: 5 minutes.',
      act + ' Cost: $' + ticket + ' of capital and about $' + setupGas + ' of gas. Time: 15 minutes to set up.',
      second + ' Cost: ' + weeklyCost + '. Time: 10 minutes a week.',
      'Do one qualifying action each week — a deposit, a borrow, a swap or a vote — and never leave the wallet idle for a full month. Cost: ' + weeklyCost + '. Time: 10 minutes a week.',
      'Hold the position for at least ' + hold + ' days, so the activity lands in more than one snapshot. Cost: the $' + ticket + ' stays in the position. Time: ' + hold + ' days.',
      'Before you withdraw, open the protocol\u2019s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.',
      'Log the wallet, the dates and every transaction, and check the log against the protocol\u2019s own activity page before you unwind. Cost: nothing but the log. Time: 5 minutes.',
      verdictLine + ' The plan: $' + ticket + ' ticket, about $' + totalGas + ' gas over ' + weeks + ' weeks, ' + hold + '-day hold, about $' + row.outlay_usd + ' all in. The launch\u2019s slice for this deposit is $' + row.slice_1k_usd.toFixed(2) + '; after gas and the 4% T-bill the net is ' + fmtSigned(row.net_all_usd) + ' (' + fmtSigned(row.net_per_hour_usd) + ' per hands-on hour). The launch pays back more than the outlay in ' + row.break_even_odds + '% of the curve\u2019s refits. Cost: about $' + row.outlay_usd + ' all in. Time: ' + hold + ' days.'
    ];
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }
  function verdictPill(v) {
    return el('span', { class: 'pill ' + v.toLowerCase(), text: v });
  }
  // The comps scatter: log TVL against log market cap, one dot per traded
  // comp, the fitted curve as a line, the screened-out tokens as hollow
  // dots — the screen is shown, not hidden.
  function drawComps(canvas) {
    if (!canvas || !canvas.getContext || !DATA.comps || !DATA.comps.length) return;
    var fit = DATA.comps_fit;
    var W = 1000, H = 320, padL = 64, padR = 16, padT = 14, padB = 40;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = '100%'; canvas.style.height = '300px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    var xs = DATA.comps.map(function (p) { return Math.log10(Math.max(1, p.tvl_usd)); });
    var ys = DATA.comps.map(function (p) { return Math.log10(p.mcap_usd); });
    var sx = (DATA.screened || []).map(function (p) { return Math.log10(Math.max(1, p.tvl_usd)); });
    var sy = (DATA.screened || []).map(function (p) { return Math.log10(p.mcap_usd); });
    var allX = xs.concat(sx), allY = ys.concat(sy);
    var x0 = Math.floor(Math.min.apply(null, allX)), x1 = Math.ceil(Math.max.apply(null, allX));
    var y0 = Math.floor(Math.min.apply(null, allY)), y1 = Math.ceil(Math.max.apply(null, allY));
    function X(v) { return padL + (v - x0) / (x1 - x0) * (W - padL - padR); }
    function Y(v) { return H - padB - (v - y0) / (y1 - y0) * (H - padT - padB); }
    ctx.strokeStyle = '#ddd5c0'; ctx.fillStyle = '#6b7280'; ctx.font = '12px ui-monospace, Menlo, monospace'; ctx.lineWidth = 1;
    var gx, gy;
    for (gx = x0; gx <= x1; gx++) {
      ctx.beginPath(); ctx.moveTo(X(gx), padT); ctx.lineTo(X(gx), H - padB); ctx.stroke();
      ctx.fillText('10^' + gx, X(gx) - 12, H - padB + 20);
    }
    for (gy = y0; gy <= y1; gy++) {
      ctx.beginPath(); ctx.moveTo(padL, Y(gy)); ctx.lineTo(W - padR, Y(gy)); ctx.stroke();
      ctx.fillText('$10^' + gy, 6, Y(gy) + 4);
    }
    ctx.fillStyle = '#6b7280'; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('TVL (log scale)', W / 2 - 44, H - 6);
    ctx.save(); ctx.translate(14, H / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Market cap (log scale)', -58, 0); ctx.restore();
    ctx.strokeStyle = '#9aa8c2'; ctx.lineWidth = 1.5;
    var i;
    for (i = 0; i < sx.length; i++) { ctx.beginPath(); ctx.arc(X(sx[i]), Y(sy[i]), 3.5, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = '#b45309';
    for (i = 0; i < xs.length; i++) { ctx.beginPath(); ctx.arc(X(xs[i]), Y(ys[i]), 3.2, 0, 2 * Math.PI); ctx.fill(); }
    ctx.strokeStyle = '#0f766e'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(X(x0), Y(fit.intercept + fit.slope * x0));
    ctx.lineTo(X(x1), Y(fit.intercept + fit.slope * x1));
    ctx.stroke();
    ctx.fillStyle = '#0f766e'; ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.fillText('fitted curve: log10(mcap) = ' + fit.intercept + ' + ' + fit.slope + ' x log10(TVL)', padL + 8, padT + 16);
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.scope === 'watchlist' && !r.watchlist) return false;
      if (state.scope === 'early' && r.watchlist) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'rank') { av = a.rank; bv = b.rank; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'change') { av = a.change_7d === null ? -999 : a.change_7d; bv = b.change_7d === null ? -999 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'slice') { av = a.slice_1k_usd; bv = b.slice_1k_usd; }
      else if (key === 'net') { av = a.net_per_hour_usd; bv = b.net_per_hour_usd; }
      else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -1 * state.dir;
      if (av > bv) return 1 * state.dir;
      return a.rank - b.rank;
    });
    return rows;
  }
  function sortButton(label, key) {
    var active = state.sort === key;
    return el('button', { class: 'th' + (active ? ' active' : ''), type: 'button', onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = (key === 'name' || key === 'rank') ? 1 : -1; }
      render();
    } }, label + (active ? (state.dir === 1 ? ' ▲' : ' ▼') : ''));
  }
  function bandBar(row, logMin, logMax) {
    var lo = (Math.log10(Math.max(1, row.p25_usd)) - logMin) / (logMax - logMin) * 100;
    var hi = (Math.log10(Math.max(1, row.p75_usd)) - logMin) / (logMax - logMin) * 100;
    var at = (Math.log10(Math.max(1, row.implied_value_usd)) - logMin) / (logMax - logMin) * 100;
    lo = Math.max(0, Math.min(100, lo)); hi = Math.max(0, Math.min(100, hi)); at = Math.max(0, Math.min(100, at));
    var bar = el('span', { class: 'band' });
    var fill = document.createElement('i');
    fill.style.left = lo + '%'; fill.style.width = Math.max(1, hi - lo) + '%';
    var mark = document.createElement('b');
    mark.style.left = at + '%';
    bar.appendChild(fill); bar.appendChild(mark);
    return bar;
  }
  function detailPanel(row) {
    var m = DATA.model, fit = DATA.comps_fit;
    var c = recomputeRow(row, m, fit);
    var check = c.implied === row.implied_value_usd && c.verdict === row.verdict;
    var refitRes = refitCurve(DATA.comps, DATA.model);
    var fitOk = Math.abs(refitRes.slope - fit.slope) < 0.001 && Math.abs(refitRes.intercept - fit.intercept) < 0.001;
    var bars = [
      ['Curve value', 'at ' + fmtUsd(row.tvl_usd) + ' TVL', fmtUsd(row.curve_value)],
      ['Growth 7d', fmtPct(row.change_7d) + ' (clamped)', fmtMult(row.growth_multiplier)],
      ['Maturity', fmtAge(row.age_days) + ' with no token', fmtMult(row.maturity_multiplier)],
      ['Breadth', (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's'), fmtMult(row.breadth_multiplier)],
      ['$1K slice', '10% of the launch to depositors, pro rata', '$' + row.slice_1k_usd.toFixed(2)],
      ['Farm chain', (row.farm_chain || 'its main chain') + (row.expensive_gas ? ' · mainnet gas' : ' · rollup gas'), '$' + row.setup_gas_usd + ' + $' + row.weekly_gas_usd + '/wk'],
      ['Net, all in', 'slice minus gas and the 4% T-bill', fmtSigned(row.net_all_usd) + ' · ' + fmtSigned(row.net_per_hour_usd) + '/h'],
      ['Break-even odds', 'share of the curve\u2019s 200 refits that pay back', row.break_even_odds + '%'],
    ];
    var plan = farmPlan(row);
    return el('section', { class: 'detail', 'aria-label': 'Protocol detail' },
      el('div', { class: 'detail-head' },
        el('div', {},
          el('h2', { text: '#' + row.rank + ' ' + row.name + ' ' }),
          el('p', { class: 'muted' }, (row.category || 'Uncategorised') + ' · ' + (row.chains || []).join(', ') + ' · listed ' + (row.listed_at || 'unknown') + ' · ' + fmtAge(row.age_days) + ' old · rank range #' + row.rank_low + '–#' + row.rank_high + ' across the refits')),
        el('div', { class: 'detail-value' }, verdictPill(row.verdict), el('strong', { text: fmtUsd(row.implied_value_usd) }), el('span', { class: 'muted small' }, 'P25–P75 ' + fmtUsd(row.p25_usd) + ' – ' + fmtUsd(row.p75_usd)))),
      el('div', { class: 'bars' }, bars.map(function (b) {
        return el('div', { class: 'bar-row' }, el('span', { class: 'bar-label', text: b[0] }), el('span', { class: 'bar-note muted', text: b[1] }), el('strong', { class: 'bar-val', text: b[2] }));
      })),
      el('p', { class: 'check' + (check ? ' ok' : ' bad'), text: check ? 'Model check: the page recomputes ' + fmtUsd(row.implied_value_usd) + ' and a ' + row.verdict + ' verdict from the snapshot figures — it matches board.json.' : 'Model check: recomputed value or verdict differs from board.json.' }),
      el('p', { class: 'check' + (fitOk ? ' ok' : ' bad'), text: fitOk ? 'Fit check: the page refits the curve from the ' + fit.n + ' comps and gets slope ' + refitRes.slope.toFixed(4) + ' — it matches the board.' : 'Fit check: the refit differs from the board.' }),
      el('h3', { text: 'Farm plan — 8 steps, netted to the dollar' }),
      el('ol', { class: 'plan' }, plan.map(function (s) { return el('li', { text: s }); })),
      el('p', { class: 'muted small' }, 'Pre-token: no market cap, no CoinGecko id, no symbol in the snapshot. Not financial advice — airdrops are not guaranteed.')
    );
  }
  function boardTab() {
    var frag = document.createDocumentFragment();
    var catSel = el('select', { 'aria-label': 'Filter by category', onchange: function (e) { state.category = e.target.value; render(); } },
      el('option', { value: 'all' }, 'All categories'), categories().map(function (c) { return el('option', { value: c, selected: state.category === c ? 'selected' : null }, c); }));
    var chainSel = el('select', { 'aria-label': 'Filter by chain', onchange: function (e) { state.chain = e.target.value; render(); } },
      el('option', { value: 'all' }, 'All chains'), chains().map(function (c) { return el('option', { value: c, selected: state.chain === c ? 'selected' : null }, c); }));
    var verdictSel = el('select', { 'aria-label': 'Filter by verdict', onchange: function (e) { state.verdict = e.target.value; render(); } },
      el('option', { value: 'all' }, 'Any verdict'),
      ['FARM', 'THIN', 'SKIP'].map(function (v) { return el('option', { value: v, selected: state.verdict === v ? 'selected' : null }, v); }));
    var scopeSel = el('select', { 'aria-label': 'Watchlist or early', onchange: function (e) { state.scope = e.target.value; render(); } },
      el('option', { value: 'all' }, 'Watchlist + early'),
      el('option', { value: 'watchlist', selected: state.scope === 'watchlist' ? 'selected' : null }, 'Watchlist only'),
      el('option', { value: 'early', selected: state.scope === 'early' ? 'selected' : null }, 'Early only'));
    var search = el('input', { type: 'search', placeholder: 'Search name, slug or category…', value: state.q, 'aria-label': 'Search the board', oninput: function (e) { state.q = e.target.value; var pos = e.target.selectionStart; render(); var next = app.querySelector('input[type="search"]'); if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (err) {} } } });
    frag.appendChild(el('div', { class: 'controls' }, search, catSel, chainSel, verdictSel, scopeSel));
    var rows = filteredRows();
    var implieds = DATA.rows.map(function (r) { return Math.log10(Math.max(1, r.implied_value_usd)); });
    var logMin = Math.min.apply(null, implieds), logMax = Math.max.apply(null, implieds);
    var table = el('table', { class: 'board' },
      el('thead', {}, el('tr', {},
        el('th', {}, sortButton('Rank', 'rank')),
        el('th', {}, sortButton('Protocol', 'name')),
        el('th', {}, sortButton('TVL', 'tvl')),
        el('th', {}, sortButton('7d', 'change')),
        el('th', {}, sortButton('No token for', 'age')),
        el('th', {}, sortButton('Implied value · P25–P75', 'implied')),
        el('th', {}, sortButton('$1K slice', 'slice')),
        el('th', {}, sortButton('Net $/h', 'net')),
        el('th', { text: 'Verdict' }))),
      el('tbody', {}, rows.map(function (r) {
        var sel = state.selected === r.slug;
        return el('tr', { class: sel ? 'selected' : '', onclick: function () { state.selected = sel ? null : r.slug; render(); } },
          el('td', { class: 'num', text: '#' + r.rank }),
          el('td', {}, el('strong', { text: r.name }), el('span', { class: 'sub muted' }, (r.category || 'Uncategorised') + ' · ' + (r.chains || []).join(', ')), r.watchlist ? el('span', { class: 'pill watch', text: 'watchlist' }) : null),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: (r.change_7d || 0) >= 0 ? 'up' : 'down', text: fmtPct(r.change_7d) }),
          el('td', { class: 'num', text: fmtAge(r.age_days) }),
          el('td', {}, el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }), bandBar(r, logMin, logMax), el('span', { class: 'sub muted' }, fmtUsd(r.p25_usd) + ' – ' + fmtUsd(r.p75_usd))),
          el('td', { class: 'num', text: '$' + r.slice_1k_usd.toFixed(2) }),
          el('td', { class: 'num ' + (r.net_per_hour_usd >= 0 ? 'up' : 'down'), text: fmtSigned(r.net_per_hour_usd) }),
          el('td', {}, verdictPill(r.verdict)));
      })));
    frag.appendChild(el('p', { class: 'count muted' }, rows.length + ' of ' + DATA.board_size + ' protocols shown. Click a row for its model breakdown and farm plan. The bar under each value is its P25–P75 band across 200 refits of the curve.'));
    frag.appendChild(table);
    var selected = DATA.rows.find(function (r) { return r.slug === state.selected; });
    if (selected) frag.appendChild(detailPanel(selected));
    return frag;
  }
  function compsTab() {
    var frag = document.createDocumentFragment();
    frag.appendChild(el('p', {}, 'The ' + DATA.comps_fit.n + ' traded protocols that price the curve. Each row shows its market cap against what the curve predicts from its TVL alone — the gap is what the curve cannot explain, and the leave-one-out test is run on exactly these rows.'));
    frag.appendChild(el('table', { class: 'board' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'Curve says' }), el('th', { text: 'Actual / curve' }))),
      el('tbody', {}, DATA.comps.map(function (r) {
        var f = r.mcap_usd / Math.max(1, r.predicted_usd);
        return el('tr', {}, el('td', {}, el('strong', { text: r.name })), el('td', { text: r.category || '—' }), el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }), el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }), el('td', { class: 'num', text: fmtUsd(r.predicted_usd) }), el('td', { class: 'num', text: 'x' + f.toFixed(2) }));
      }))));
    frag.appendChild(el('h3', { text: 'Screened out of the comps — ' + DATA.screened.length }));
    frag.appendChild(el('p', { class: 'muted small' }, 'A comp must be priced off its TVL: its market cap sits within a hundredfold band of its TVL (0.01x–10x). Outside the band the market is plainly pricing something else, so these tokens cannot anchor a TVL curve. They are listed here, not hidden.'));
    frag.appendChild(el('table', { class: 'board' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'mcap / TVL' }))),
      el('tbody', {}, DATA.screened.map(function (r) {
        return el('tr', {}, el('td', {}, el('strong', { text: r.name })), el('td', { text: r.category || '—' }), el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }), el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }), el('td', { class: 'num', text: 'x' + r.ratio }));
      }))));
    return frag;
  }
  function setAsideTab() {
    var frag = document.createDocumentFragment();
    frag.appendChild(el('p', {}, DATA.set_aside.length + ' pre-token protocols are set aside, with the reason each one is not a launch of its own. A wrapped, staked or bridged product of a token that already trades will never launch its own token, so ranking it would mislead a farmer.'));
    frag.appendChild(el('table', { class: 'board' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL' }), el('th', { text: 'Why it is set aside' }))),
      el('tbody', {}, DATA.set_aside.map(function (r) {
        return el('tr', {}, el('td', {}, el('strong', { text: r.name })), el('td', { text: r.category || '—' }), el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }), el('td', { text: r.reason }));
      }))));
    return frag;
  }
  function methodTab() {
    var fit = DATA.comps_fit, m = DATA.model;
    var frag = document.createDocumentFragment();
    var box = el('div', { class: 'method' },
      el('h3', { text: 'The curve' }),
      el('p', {}, 'implied = curve(TVL) × growth × maturity × breadth. The curve is log10(market cap) = ' + fit.intercept + ' + ' + fit.slope + ' × log10(TVL), fitted on the ' + fit.n + ' traded tokens that pass the screen: a market cap above zero, a TVL above zero, not an exchange or a bridge, and a market-cap/TVL ratio inside 0.01x–10x. ' + fit.screened_out + ' traded tokens fail the ratio screen and are listed on the Comps tab. The plain least-squares slope is ' + fit.ols_slope + '; it is shrunk halfway toward the 0.5 prior and the intercept is refit, because the plain slope is steeper than the 0.47–0.56 the top of the leaderboard reports and the shrinkage improves the out-of-sample median miss. No coefficient is typed in by hand and no name is special-cased.'),
      el('h3', { text: 'The proof' }),
      el('p', {}, 'Leave-one-out over the ' + fit.n + ' comps: fit on 88, predict the held-out token. Median miss ×' + fit.loo_median_factor + ', ' + Math.round(fit.loo_within_3x * 100) + '% within 3x, out-of-sample R² ' + fit.loo_r2 + ', rank correlation ' + fit.loo_rho + '. Time split: fitted on the tokens listed before 2024, tested on the ' + fit.ts_n + ' listed since — median miss ×' + fit.ts_median_factor + ', R² ' + fit.ts_r2 + '. One flat mcap/TVL multiple misses by ×' + fit.flat_median_factor + ' on the same tokens, leave-one-out. The curve beats it on every measure.'),
      el('h3', { text: 'What was tried and dropped' }),
      el('p', {}, 'Category effects — ridge-shrunk dummies and a two-stage estimator at several shrinkage levels — lift the in-sample R² but make honest leave-one-out worse and fail the time split too, so they are not in the model. A Huber robust fit does no better on the 89 comps and collapses when the ratio screen is loosened, so the hard screen stays. Fitted growth, age and breadth weights do the same, so those three stay stated priors. A quadratic size term does not help either. The plain curve is kept because it is the one the tests support, not because it is the fanciest.'),
      el('h3', { text: 'The priors' }),
      el('p', {}, 'Growth is the 7-day TVL change clamped to ' + m.growth_floor + '%…+' + m.growth_cap + '%, weighted ×' + m.growth_weight + '. Maturity rewards time tracked with no token, rising from ×' + m.maturity_floor + ' toward 1 with a ' + m.maturity_scale_days + '-day scale (unknown age: ' + m.unknown_age_days + ' days). Breadth adds +' + (m.breadth_per_chain * 100) + '% per extra chain, up to ' + m.breadth_max_chains + ' chains. They move a row off its curve value; they are judgements, stated as such, and the out-of-sample test covers the curve only.'),
      el('h3', { text: 'The farm net' }),
      el('p', {}, 'A $1,000 deposit\u2019s slice is what it would get if 10% of the launch went to depositors pro rata: $1,000 × 0.10 × implied value / TVL. The plan deposits $1,000, so the slice on the row is the plan\u2019s slice. Gas is priced for the chain the farm actually uses: $0.50 to set up plus $0.15 a week on a rollup, $5 plus $2 a week on Ethereum or Bitcoin mainnet — and a protocol that lives on an expensive chain alone is where the fees eat the drop. The hold is 60 days for a seasoned protocol, 90 for one under a year old, 120 for one under 90 days; the forgone yield is a 4% T-bill on the $1,000 over the hold. FARM clears the T-bill, THIN clears the fees only, SKIP does not clear the fees. The net per hands-on hour divides the net by the setup, the weekly actions and the claim.'),
      el('h3', { text: 'The bands and the odds' }),
      el('p', {}, 'The curve is refit on 200 bootstrap resamples of the comps (seeded, so the run is deterministic), with the same slope shrink applied to every refit. Each row\u2019s P25–P75 band, its rank range and its break-even odds — the share of refits in which the farm pays back more than it costs — come from those refits. A wide band means the curve is unsure about that protocol; the board ranks by the point value and shows the band beside it.'),
      el('h3', { text: 'Limits' }),
      el('p', {}, 'TVL alone explains about a third of the spread in traded market caps (in-sample R² ' + fit.r2 + '), so individual values carry wide errors and the ranking is more reliable at the top, where the gaps are large, than in the middle. The snapshot is one day: a protocol\u2019s TVL, growth and category can move sharply between snapshots. And a high rank is not a launch: it says what the token would be worth if the protocol launched one tomorrow at the market\u2019s current pricing of comparable tokens, nothing about whether or when it will.')
    );
    frag.appendChild(box);
    return frag;
  }
  function render() {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var fit = DATA.comps_fit;
    var vc = DATA.verdict_counts;
    var top = DATA.rows.slice(0, 3);
    var check = selfCheck();
    var best = DATA.rows.filter(function (r) { return r.verdict === 'FARM'; }).sort(function (a, b) { return b.net_per_hour_usd - a.net_per_hour_usd; }).slice(0, 3);
    var header = el('header', { class: 'hero' },
      el('div', {},
        el('p', { class: 'eyebrow', text: 'TOKEN RADAR · ' + DATA.model_version.toUpperCase() + ' · SNAPSHOT ' + DATA.as_of }),
        el('h1', { text: 'The next token, priced before it exists.' }),
        el('p', { class: 'lede' }, DATA.board_size + ' pre-token protocols scored from one snapshot — ' + DATA.watchlist_size + ' on the watchlist and ' + DATA.early_size + ' early finds, above and below the ' + fmtUsd(DATA.floor_usd) + ' floor. Every value is priced off the ' + fit.n + ' protocols that already trade and pass the screen. Live-token protocols are set aside, never ranked.')),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('strong', { text: DATA.watchlist_size + '/40' }), el('span', { text: 'watchlist covered' })),
        el('div', { class: 'stat' }, el('strong', { text: String(DATA.board_size) }), el('span', { text: 'ranked' })),
        el('div', { class: 'stat' }, el('strong', { text: String(fit.n) }), el('span', { text: 'traded comps' })),
        el('div', { class: 'stat' }, el('strong', { text: String(vc.farm) }), el('span', { text: 'FARM verdicts' })),
        el('div', { class: 'stat' }, el('strong', { text: fmtUsd(top[0].implied_value_usd) }), el('span', { text: 'top implied value' }))));
    var badge = el('p', {}, el('span', { class: 'badge' + (check.bad === 0 && check.fitOk && check.sorted ? '' : ' bad'), text: check.bad === 0 && check.fitOk && check.sorted ? 'page = board.json: ' + check.ok + '/' + DATA.board_size + ' ranks, values, verdicts and nets match' : 'page ≠ board.json: ' + check.bad + ' rows differ — read the board, not the page' }),
      el('span', { class: 'muted small', text: ' The page refits the curve from the comps and recomputes every row. ' }));
    var spot = el('section', { class: 'spot', 'aria-label': 'Top three' }, top.map(function (r, i) {
      return el('button', { class: 'spot-card', type: 'button', onclick: function () { state.selected = r.slug; state.tab = 'board'; render(); } },
        el('span', { class: 'spot-rank', text: '#' + (i + 1) + ' · ' + (r.category || 'Uncategorised') }),
        el('strong', { text: r.name }),
        el('span', { class: 'muted' }, fmtUsd(r.tvl_usd) + ' TVL · ' + fmtPct(r.change_7d) + ' in 7d · ' + (r.chains || []).length + ' chains'),
        el('span', { class: 'spot-val', text: fmtUsd(r.implied_value_usd) }),
        el('span', {}, verdictPill(r.verdict), el('span', { class: 'muted small', text: '  ' + fmtSigned(r.net_per_hour_usd) + '/h · break-even ' + r.break_even_odds + '%' })));
    }));
    var model = el('section', { class: 'card modelbox' },
      el('h2', { text: 'How a value is built' }),
      el('p', {}, 'implied = curve value × growth × maturity × breadth. The curve is fitted on the ' + fit.n + ' traded tokens that pass the screen: log10(market cap) = ' + fit.intercept + ' + ' + fit.slope + ' × log10(TVL). The plain least-squares slope is ' + fit.ols_slope + '; the slope is shrunk halfway toward 0.5 and the intercept refit. Growth is the 7-day TVL change clamped to ' + DATA.model.growth_floor + '%…+' + DATA.model.growth_cap + '%, weighted ×' + DATA.model.growth_weight + '. Maturity rises from ×' + DATA.model.maturity_floor + ' toward 1 with a ' + DATA.model.maturity_scale_days + '-day scale. Breadth adds +' + (DATA.model.breadth_per_chain * 100) + '% per extra chain, up to ' + DATA.model.breadth_max_chains + ' chains. One function scores every row; no name is special-cased.'),
      el('p', {}, 'Out of sample, leave-one-out over the ' + fit.n + ' comps: the curve predicts a held-out token\u2019s market cap within a factor of ×' + fit.loo_median_factor + ' (median) and within 3× for ' + Math.round(fit.loo_within_3x * 100) + '% of them, out-of-sample R² ' + fit.loo_r2 + '. On the time split it misses by ×' + fit.ts_median_factor + ' (R² ' + fit.ts_r2 + ', ' + fit.ts_n + ' tokens listed since 2024). One flat mcap/TVL multiple misses by ×' + fit.flat_median_factor + ' on the same tokens. Category effects were tried and dropped — honest leave-one-out and the time split both say they do not generalise.'),
      el('p', { class: 'muted small' }, 'What the curve cannot do: it cannot tell you whether a token launches, or when. It prices the launch if the protocol\u2019s record stays as it is. Source: ' + DATA.source));
    var chart = el('section', { class: 'card', 'aria-label': 'Comps curve' },
      el('h2', { text: 'The comps behind the curve' }),
      el('p', { class: 'muted small' }, 'Each amber dot is one of the ' + fit.n + ' traded protocols, TVL against its own market cap. Hollow dots are the ' + fit.screened_out + ' screened out by the ratio band. The green line is the fitted curve the board prices from.'),
      el('canvas', { class: 'chart', id: 'comps-chart', width: 1000, height: 320 }));
    var verdicts = el('section', { class: 'card' },
      el('h2', { text: 'Farm verdicts, netted to the dollar' }),
      el('p', {}, 'FARM ' + vc.farm + ' · THIN ' + vc.thin + ' · SKIP ' + vc.skip + ' of ' + DATA.board_size + ' rows. A $1,000 deposit\u2019s slice is what it would get if 10% of the launch went to depositors pro rata; the net subtracts the gas and the forgone 4% T-bill yield. FARM clears the T-bill, THIN clears the fees only, SKIP does not clear the fees.'),
      best.length ? el('p', {}, 'Best net per hands-on hour: ' + best.map(function (r) { return r.name + ' ' + fmtSigned(r.net_per_hour_usd) + '/h'; }).join(' · ') + '.') : null);
    var tabs = el('div', { class: 'tabs', role: 'tablist' },
      el('button', { class: 'tab' + (state.tab === 'board' ? ' active' : ''), type: 'button', onclick: function () { state.tab = 'board'; render(); } }, 'Pre-token board (' + DATA.board_size + ')'),
      el('button', { class: 'tab' + (state.tab === 'comps' ? ' active' : ''), type: 'button', onclick: function () { state.tab = 'comps'; render(); } }, 'Traded comps (' + DATA.comps.length + ')'),
      el('button', { class: 'tab' + (state.tab === 'aside' ? ' active' : ''), type: 'button', onclick: function () { state.tab = 'aside'; render(); } }, 'Set aside (' + DATA.set_aside.length + ')'),
      el('button', { class: 'tab' + (state.tab === 'method' ? ' active' : ''), type: 'button', onclick: function () { state.tab = 'method'; render(); } }, 'Method & calibration'));
    app.appendChild(header);
    app.appendChild(badge);
    app.appendChild(spot);
    app.appendChild(model);
    app.appendChild(chart);
    drawComps(document.getElementById('comps-chart'));
    app.appendChild(verdicts);
    app.appendChild(tabs);
    if (state.tab === 'comps') app.appendChild(compsTab());
    else if (state.tab === 'aside') app.appendChild(setAsideTab());
    else if (state.tab === 'method') app.appendChild(methodTab());
    else app.appendChild(boardTab());
    app.appendChild(el('footer', { class: 'foot muted small' }, 'Token Radar radar-5 · snapshot ' + DATA.as_of + ' · floor ' + fmtUsd(DATA.floor_usd) + ' · model: comps log10(mcap) = ' + fit.intercept + ' + ' + fit.slope + ' × log10(TVL) on ' + fit.n + ' comps, leave-one-out ×' + fit.loo_median_factor + ', time-split ×' + fit.ts_median_factor + ', growth ×' + DATA.model.growth_weight + ', maturity from ×' + DATA.model.maturity_floor + ', breadth +' + (DATA.model.breadth_per_chain * 100) + '%/chain.'));
  }
  render();
})();
