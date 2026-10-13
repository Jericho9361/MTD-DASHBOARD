/* MTD Dashboard — UI, device storage, sheet tabs, send flow */
(function () {
  'use strict';
  const E = window.MTDEngine;
  const K_STATE = 'mtd.state.v1', K_SET = 'mtd.settings.v1', K_TPL = 'mtd.template.v1', K_LOG = 'mtd.sendlog.v1', K_ARCH = 'mtd.archive.v1';
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const k in attrs) { if (k === 'class') el.className = attrs[k]; else if (k.startsWith('on')) el.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]); }
    for (const c of kids.flat()) if (c !== null && c !== undefined) el.append(c.nodeType ? c : String(c));
    return el;
  };

  // ---------- storage (this device) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Could not save on this device: ' + e.message); return false; } },
    raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setRaw(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { toast('Storage full: ' + e.message); return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } },
    bytes() { let n = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('mtd.')) n += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch (e) { } return n; }
  };
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }

  const clone = o => JSON.parse(JSON.stringify(o));
  let state = store.get(K_STATE, null) || clone(window.MTD_SEED);
  let settings = Object.assign({ cc: '' }, store.get(K_SET, {}));
  let out = E.compute(state);
  let currentTab = 'dashboard', entryDay = 1, saveTimer = null;

  function persist() { store.set(K_STATE, state); updateStoragePill(); }
  function recalc() { out = E.compute(state); refresh(); }
  function changed() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 250); recalc(); }

  // ---------- formatting ----------
  const nf2 = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
  const isBad = v => typeof v === 'number' && !isFinite(v);
  const F = {
    money: v => isBad(v) ? '#DIV/0!' : (v === 0 ? '-' : (v < 0 ? '(' + nf2.format(-v) + ')' : nf2.format(v))),
    peso: v => isBad(v) ? '—' : '₱' + nf0.format(Math.round(v)),
    pesoS: v => { if (isBad(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e6 ? s + '₱' + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + '₱' + (a / 1e3).toFixed(1) + 'K' : s + '₱' + a.toFixed(0); },
    int: v => isBad(v) ? '#DIV/0!' : (v === 0 ? '-' : nf0.format(v)),
    pct: v => isBad(v) ? '#DIV/0!' : (v * 100).toFixed(2) + '%',
    pct1: v => isBad(v) ? '—' : (v * 100).toFixed(1) + '%',
    date: v => { if (!v) return ''; const d = new Date(v + 'T00:00:00Z'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); },
    dateL: v => { if (!v) return ''; const d = new Date(v + 'T00:00:00Z'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); },
    text: v => v ?? ''
  };
  const monthLabel = () => new Date(state.meta.monthStart + 'T00:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const periodLabel = () => { const m = new Date(state.meta.monthStart + 'T00:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toUpperCase(); return `${m} 1-${out.meta.daysInMonth}, ${state.meta.monthStart.slice(0, 4)}`; };

  function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms); }
  function updateStoragePill() { const b = store.bytes(); $('#storageText').textContent = b > 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

  // ---------- tabs ----------
  const TABS = [
    ['dashboard', 'Dashboard'], ['entry', 'Daily Entry'], '|',
    ['LS_RPRO', 'LS_RPRO', 1], ['MSI', 'MSI', 1], ['MRet', 'MRet', 1], ['MANUAL', 'MANUAL', 1], ['OUTSALE', 'OUTSALE', 1],
    ['Seasonality', 'Seasonality Template', 1], ['SameDay', 'Same Day Comparison', 1], ['EOD', 'EOD Monitoring', 1],
    ['YTDSales', 'YTD-Sales', 1], ['YTDRD', 'YTD Retail Drivers', 1], ['Deposit', 'Deposit Summary', 1], ['SG', '#of SG Receipt Copy', 1], ['WML', 'WML Weekly', 1], '|',
    ['settings', 'Settings']
  ];
  function buildTabs() {
    const nav = $('#tabs'); nav.innerHTML = '';
    for (const t of TABS) {
      if (t === '|') { nav.append(h('span', { class: 'tab-sep' })); continue; }
      nav.append(h('button', { class: 'tab' + (t[2] ? ' sheet' : '') + (t[0] === currentTab ? ' active' : ''), role: 'tab', 'data-tab': t[0], onclick: () => show(t[0]) }, t[1]));
    }
  }
  function show(tab) {
    currentTab = tab; try { sessionStorage.setItem('mtd.tab', tab); } catch (e) { }
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    if (tab === 'dashboard') { $('#view-dashboard').classList.add('active'); renderDashboard(); }
    else if (tab === 'entry') { $('#view-entry').classList.add('active'); renderEntry(); }
    else if (tab === 'settings') { $('#view-settings').classList.add('active'); renderSettings(); }
    else { $('#view-sheet').classList.add('active'); renderSheet(tab); }
    window.scrollTo({ top: 0 });
  }
  function refresh() {
    $('#hdrStore').textContent = state.meta.store; $('#hdrPeriod').textContent = monthLabel();
    if (currentTab === 'dashboard') renderDashboard();
    else if (currentTab === 'entry') updateEntryLive();
    else updateBindings();
  }

  // ---------- DASHBOARD ----------
  const charts = {};
  function chip(v, invert) {
    if (isBad(v)) return h('span', { class: 'chip flat' }, 'n/a');
    const up = invert ? v < 0 : v > 0;
    return h('span', { class: 'chip ' + (Math.abs(v) < 1e-9 ? 'flat' : up ? 'up' : 'down') }, (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '') + (Math.abs(v) * 100).toFixed(1) + '%');
  }
  function kpi(label, value, sub, opts = {}) {
    return h('div', { class: 'kpi ' + (opts.tone || '') }, opts.ref ? h('span', { class: 'ref' }, opts.ref) : null, h('div', { class: 'l' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 's' }, sub) : null);
  }
  function renderDashboard() {
    const H = out.seas.head, T = out.seas.total, L = out.ls.total, dim = out.meta.daysInMonth;
    $('#asof').textContent = H.J20 ? `Data through ${F.dateL(E.addDays(state.meta.monthStart, H.J20 - 1))} · day ${H.J20} of ${dim}` + (state.meta.runningDays ? ' (set manually)' : '') : 'No sales entered yet for ' + monthLabel();
    $('#kMTD').textContent = F.peso(H.G16); $('#kTarget').textContent = F.peso(H.G15);
    const ach = isBad(H.J19) ? 0 : H.J19;
    $('#ringFg').setAttribute('stroke-dashoffset', String(314.16 * (1 - Math.min(1, Math.max(0, ach)))));
    $('#ringVal').textContent = (ach * 100).toFixed(1) + '%';
    const ahead = H.J19 >= H.J17; const st = $('#kStatus');
    st.className = 'status ' + (ahead ? 'good' : 'bad');
    st.textContent = ahead ? `Ahead of seasonality by ${((H.J19 - H.J17) * 100).toFixed(1)} pts` : `Behind seasonality by ${((H.J17 - H.J19) * 100).toFixed(1)} pts`;

    const pace = $('#paceBars'); pace.innerHTML = '';
    const mx = Math.max(H.J17 || 0, H.J18 || 0, ach, 0.0001);
    [['Sales achievement', ach, 'var(--gold)'], ['Current seasonality', H.J17, 'var(--royal)'], ['Straight line', H.J18, 'var(--silver-deep)']].forEach(([l, v, c]) => {
      pace.append(h('div', { class: 'pace-row' }, h('span', {}, l), h('div', { class: 'pace-track' }, h('div', { class: 'pace-fill', style: `width:${Math.max(0, Math.min(100, (v || 0) / Math.max(1, mx) * 100))}%;background:${c}` })), h('span', { class: 'pace-val' }, F.pct1(v))));
    });
    $('#interp').innerHTML = ''; H.interp.forEach(t => $('#interp').append(h('div', {}, t)));

    const ks = $('#kpiSales'); ks.innerHTML = '';
    ks.append(
      kpi('Total variance on target', F.peso(H.G17), h('span', {}, `${H.J21} day(s) remaining`), { tone: H.G17 >= 0 ? 'gold' : '', ref: 'G17' }),
      kpi('Ave. daily sales', F.peso(H.J15), h('span', {}, `over ${H.J20} running day(s)`), { tone: 'royal', ref: 'J15' }),
      kpi('Ave. sales needed – daily', F.peso(-H.G19), h('span', {}, 'to hit target'), { tone: 'gold', ref: 'G19' }),
      kpi('Variance on expected sales', F.peso(H.G18), h('span', {}, 'running vs seasonality target'), { ref: 'G18' }),
      kpi('Best EOM peso value', F.peso(H.G20), h('span', {}, 'Best EOM ', chip(H.G21 - 1)), { tone: 'royal', ref: 'G20' }),
      kpi('MTD last year (full month)', F.peso(H.G22), h('span', {}, '% LY ', chip(H.J22)), { ref: 'G22' }),
      kpi('Same days LY', F.peso(out.same.B3), h('span', {}, 'TY vs LY ', chip(out.same.C3)), { tone: 'gold', ref: 'SDC B3' }),
      kpi('Target growth vs LY', F.pct1(H.J16), null, { ref: 'J16' }),
      kpi('Net sales', F.peso(L.D), h('span', {}, 'Discount ', F.peso(L.C)), { tone: 'royal', ref: 'LS D41' }),
      kpi('Gross margin MTD', F.peso(H.M16), h('span', {}, 'GM vs gross ', F.pct1(H.M19)), { ref: 'M16' })
    );
    const kd = $('#kpiDrivers'); kd.innerHTML = '';
    kd.append(
      kpi('Entering customers', F.int(H.Q15), h('span', {}, 'LY ' + F.int(H.P15), chip(H.R15)), { tone: 'royal', ref: 'Q15' }),
      kpi('Buying customers', F.int(H.Q16), h('span', {}, 'LY ' + F.int(H.P16), chip(H.R16)), { tone: 'royal', ref: 'Q16' }),
      kpi('Average purchase', F.peso(H.Q17), h('span', {}, 'LY ' + F.peso(H.P17), chip(H.R17)), { tone: 'gold', ref: 'Q17' }),
      kpi('Conversion ratio', F.pct1(H.Q18), h('span', {}, 'LY ' + F.pct1(H.P18), h('span', { class: 'chip ' + (H.R18 >= 0 ? 'up' : 'down') }, (H.R18 >= 0 ? '+' : '') + (H.R18 * 100).toFixed(1) + ' pts')), { tone: 'gold', ref: 'Q18' }),
      kpi('Racquet stringing', F.int(H.Q19), h('span', {}, 'LY ' + F.int(H.P19), chip(H.R19)), { ref: 'Q19' }),
      kpi('Discount', F.peso(T.Q), h('span', {}, 'LY ' + F.peso(T.P), chip(T.R, true)), { ref: 'Q56' }),
      kpi('Credit card sales', F.peso(T.AF), h('span', {}, 'LY ' + F.peso(T.AE), chip(T.AG)), { ref: 'AF56' }),
      kpi('Shoes sold', F.int(H.V18), h('span', {}, 'LY ' + F.int(H.U18), chip(H.W18)), { ref: 'V18' })
    );
    const kc = $('#kpiCash'); kc.innerHTML = '';
    const sgd = out.sg.total.D;
    kc.append(
      kpi('Cash sales available', F.peso(L.AA), null, { tone: 'royal', ref: 'LS AA41' }),
      kpi('Cash declared & deposited', F.peso(L.Z), null, { tone: 'royal', ref: 'LS Z41' }),
      kpi('Over / (short)', F.money(L.AD), h('span', {}, `Short ${F.money(L.I)} · Over ${F.money(L.J)}`), { tone: Math.abs(L.AD) < 1 ? '' : 'gold', ref: 'LS AD41' }),
      kpi('Amount to be deposited', F.peso(out.dep.G40), h('span', {}, 'Pending ' + F.peso(out.dep.L)), { ref: 'DEP G40' }),
      kpi('Charge sales', F.peso(L.O), null, { ref: 'LS O41' }),
      kpi('SG receipt discrepancy', F.int(sgd), h('span', {}, `SG copies ${F.int(out.sg.total.C)} vs ${F.int(out.sg.total.B)} receipts`), { tone: sgd === 0 ? '' : 'gold', ref: 'SG D37' })
    );
    drawCharts(); renderWeekly();
  }
  function renderWeekly() {
    const H = out.seas.head; const host = $('#weeklyTbl'); host.innerHTML = '';
    const y = +state.meta.monthStart.slice(0, 4);
    const t = h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Week'), h('th', {}, String(y)), h('th', {}, String(y - 1)), h('th', {}, '% inc/dec'))));
    const tb = h('tbody'); let a = 0, b = 0;
    H.weeks.forEach(w => { a += w.TY; b += w.LY; tb.append(h('tr', {}, h('th', {}, w.label), h('td', { class: 'calc' }, F.money(w.TY)), h('td', { class: 'calc' }, F.money(w.LY)), h('td', { class: 'calc' + (w.chg < 0 ? ' neg' : '') }, F.pct(w.chg)))); });
    tb.append(h('tr', { class: 'tot' }, h('th', {}, 'TOTAL'), h('td', { class: 'calc' }, F.money(a)), h('td', { class: 'calc' }, F.money(b)), h('td', { class: 'calc' }, F.pct((a - b) / (a || NaN)))));
    t.append(tb); host.append(t);
  }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function drawCharts() {
    if (!window.Chart) return;
    const S = out.seas.rows, dim = out.meta.daysInMonth, H = out.seas.head, days = E.DAYS.filter(d => d <= dim);
    const labels = days.map(d => d);
    const royal = css('--royal'), gold = css('--gold'), silver = css('--silver'), ink = css('--muted'), grid = css('--line');
    Chart.defaults.font.family = 'Inter'; Chart.defaults.color = ink;
    const base = (extra = {}) => ({ responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${typeof c.raw === 'number' ? (c.dataset.fmt === 'int' ? F.int(c.raw) : F.peso(c.raw)) : c.raw}` } } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: grid }, ticks: { callback: v => extra.int ? v : F.pesoS(v) } } } });
    const mk = (id, cfg) => { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); };
    mk('chDaily', { type: 'bar', data: { labels, datasets: [
      { label: 'This year', data: days.map(d => S[d].K), backgroundColor: royal, borderRadius: 4, order: 2 },
      { label: 'Last year', data: days.map(d => S[d].G), backgroundColor: silver, borderRadius: 4, order: 3 },
      { label: 'Daily target', type: 'line', data: days.map(d => S[d].I), borderColor: gold, backgroundColor: gold, pointRadius: 0, borderWidth: 2.5, order: 1 }] }, options: base() });
    let a = 0, b = 0; const run = [], seas = [], line = [];
    days.forEach(d => { a += S[d].K; b += S[d].I; run.push(d <= H.J20 ? a : null); seas.push(b); line.push(H.G15 / dim * d); });
    mk('chCum', { type: 'line', data: { labels, datasets: [
      { label: 'Running MTD', data: run, borderColor: royal, backgroundColor: royal + '22', fill: true, borderWidth: 3, pointRadius: 0 },
      { label: 'Seasonality target', data: seas, borderColor: gold, borderWidth: 2, pointRadius: 0 },
      { label: 'Straight line', data: line, borderColor: silver, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 }] }, options: base() });
    mk('chWeek', { type: 'bar', data: { labels: H.weeks.map(w => w.label), datasets: [
      { label: 'This year', data: H.weeks.map(w => w.TY), backgroundColor: royal, borderRadius: 5 },
      { label: 'Last year', data: H.weeks.map(w => w.LY), backgroundColor: gold, borderRadius: 5 }] }, options: base() });
    mk('chTraffic', { type: 'line', data: { labels, datasets: [
      { label: 'Entering TY', data: days.map(d => d <= H.J20 ? S[d].AJ : null), borderColor: royal, borderWidth: 2.5, pointRadius: 2, fmt: 'int' },
      { label: 'Entering LY', data: days.map(d => S[d].AI), borderColor: silver, borderWidth: 2, pointRadius: 0, borderDash: [5, 4], fmt: 'int' },
      { label: 'Buying TY', data: days.map(d => d <= H.J20 ? S[d].AM : null), borderColor: gold, borderWidth: 2.5, pointRadius: 2, fmt: 'int' },
      { label: 'Buying LY', data: days.map(d => S[d].AL), borderColor: css('--gold-deep'), borderWidth: 1.5, pointRadius: 0, borderDash: [5, 4], fmt: 'int' }] }, options: base({ int: 1 }) });
  }

  // ---------- DAILY ENTRY ----------
  const LS_GROUPS = [
    ['Sales', [['B', 'Gross sales'], ['C', 'Discount'], ['E', 'Approved discount'], ['G', 'Delivery fee']]],
    ['Customers & stringing', [['M', 'Entering customers', 'int'], ['H', 'No. of buying customers', 'int'], ['K', 'Strings – Tennis', 'int'], ['L', 'Strings – Badminton', 'int']]],
    ['Charge & gift', [['O', 'Charge sales'], ['P', 'Gift check']]],
    ['Other collection', [['Q', 'GC issued – cash'], ['R', 'GC issued – card'], ['S', 'Downpayment'], ['T', 'ADV']]],
    ['Checks & other disbursement', [['U', 'Checks'], ['V', 'COD'], ['W', 'Cash advance'], ['X', '(ADV)'], ['Y', 'CWT']]],
    ['Cash', [['Z', 'Cash declared and deposited']]]
  ];
  function renderEntry() {
    const sel = $('#daySel'); sel.innerHTML = '';
    const dim = out.meta.daysInMonth;
    if (entryDay > dim) entryDay = dim;
    for (let d = 1; d <= dim; d++) sel.append(h('option', { value: d }, `Day ${d} · ${F.dateL(E.addDays(state.meta.monthStart, d - 1))}${out.ls.rows[d].hasData ? '  ✓' : ''}`));
    sel.value = entryDay;
    const form = $('#entryForm'); form.innerHTML = '';
    const groups = h('div', { class: 'groups' });
    const row = state.ls[entryDay] = state.ls[entryDay] || {};
    for (const [title, fields] of LS_GROUPS) {
      const g = h('div', { class: 'card group' }, h('h4', {}, title));
      for (const [col, label, t] of fields) {
        const id = 'f_' + col;
        const inp = h('input', { id, inputmode: t === 'int' ? 'numeric' : 'decimal', autocomplete: 'off', value: row[col] ?? '' });
        inp.addEventListener('change', () => { row[col] = cleanRaw(inp.value); changed(); });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const all = [...form.querySelectorAll('input')]; const i = all.indexOf(inp); (all[i + 1] || $('#btnSaveNext')).focus(); } });
        g.append(h('div', { class: 'field' }, h('label', { for: id }, label, h('small', {}, 'LS_RPRO!' + col + E.lsRow(entryDay))), inp));
      }
      groups.append(g);
    }
    // related daily inputs from other tabs
    const g2 = h('div', { class: 'card group' }, h('h4', {}, 'Controls (other tabs)'));
    const addOther = (label, ref, get, set, t) => {
      const inp = h('input', { inputmode: t === 'txt' ? 'text' : 'decimal', value: get() ?? '' });
      inp.addEventListener('change', () => { set(cleanRaw(inp.value)); changed(); });
      g2.append(h('div', { class: 'field' }, h('label', {}, label, h('small', {}, ref)), inp));
    };
    const d = entryDay;
    addOther('SG receipt copies', `#OF SG RECEIPT COPY!C${5 + d}`, () => state.sg.rows[d]?.C, v => (state.sg.rows[d] = state.sg.rows[d] || {}).C = v);
    addOther('Other deposit', `DEPOSIT SUMMARY!D${7 + d}`, () => state.dep.rows[d]?.D, v => (state.dep.rows[d] = state.dep.rows[d] || {}).D = v);
    addOther('Deposit slip #', `DEPOSIT SUMMARY!F${7 + d}`, () => state.dep.rows[d]?.F, v => (state.dep.rows[d] = state.dep.rows[d] || {}).F = v, 'txt');
    addOther('Z-ID POS 1', `EOD MONITORING!B${2 + d}`, () => state.eod.rows[d]?.B, v => (state.eod.rows[d] = state.eod.rows[d] || {}).B = v, 'txt');
    addOther('Z-ID POS 2', `EOD MONITORING!C${2 + d}`, () => state.eod.rows[d]?.C, v => (state.eod.rows[d] = state.eod.rows[d] || {}).C = v, 'txt');
    groups.append(g2);
    form.append(groups);
    updateEntryLive();
  }
  function cleanRaw(v) { v = String(v).trim(); if (v.startsWith('=')) v = v.slice(1); return v; }
  function updateEntryLive() {
    const r = out.ls.rows[entryDay], s = out.seas.rows[entryDay];
    const live = $('#entryLive'); live.innerHTML = '';
    [['Net sales', F.money(r.D)], ['Cash sales available', F.money(r.AA)], ['Over / (short)', F.money(r.AD), 'gold'],
     ['vs daily target', F.money(s.L), 'gold'], ['Conversion', F.pct1(s.AP)], ['Avg purchase', F.peso(s.AM ? s.K / s.AM : NaN)]].forEach(([l, v, c]) =>
      live.append(h('div', { class: 'live ' + (c || '') }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v))));
  }

  // ---------- SHEET GRIDS ----------
  let bindings = [];
  function updateBindings() { for (const b of bindings) { const v = b.get(); b.el.textContent = b.fmt(v); b.el.classList.toggle('neg', typeof v === 'number' && v < 0); } }
  function cellIn(get, set, opts = {}) {
    const td = h('td', { class: 'in' });
    const inp = h('input', { value: get() ?? '', class: opts.txt ? 'txt' : '', type: opts.type || 'text', inputmode: opts.txt ? 'text' : 'decimal' });
    const numeric = !opts.txt && !opts.type;
    const pretty = () => { const r = get(); if (numeric && r !== '' && r !== undefined && r !== null) { inp.value = F[opts.fmt || 'money'](E.num(r)); inp.title = /[+\-*/]/.test(String(r).replace(/^-/, '')) ? '=' + r : ''; } };
    if (numeric) { pretty(); inp.addEventListener('focus', () => { inp.value = get() ?? ''; inp.select(); }); inp.addEventListener('blur', pretty); }
    inp.addEventListener('change', () => { set(opts.txt || opts.type ? inp.value : cleanRaw(inp.value)); changed(); });
    td.append(inp); return td;
  }
  function cellCalc(get, fmt) { const td = h('td', { class: 'calc' }); bindings.push({ el: td, get, fmt }); return td; }
  function sheetHeader(title, sub, extra) {
    return h('div', { class: 'sheet-head' }, h('div', {}, h('div', { class: 'sheet-title' }, title), h('div', { class: 'hint' }, sub)),
      h('div', { class: 'legend' }, h('span', {}, h('span', { class: 'sw in' }), 'input'), h('span', {}, h('span', { class: 'sw calc' }), 'formula'), extra || null));
  }
  /* cols: [{c:'B', label, in:true|false, fmt:'money'|'int'|'pct'|'text', txt}] ; rows: [{label, cls, get(c), set(c,v), raw(c)}] */
  function grid(cols, rows, groups) {
    const thead = h('thead');
    if (groups) thead.append(h('tr', { class: 'grp' }, h('th', {}), ...groups.map(g => h('th', { colspan: g[1] }, g[0]))));
    thead.append(h('tr', {}, h('th', {}, h('span', { class: 'col' }, ''), 'DAY'), ...cols.map(c => h('th', { class: c.in ? '' : 'calc' }, h('span', { class: 'col' }, c.c), c.label))));
    const tb = h('tbody');
    for (const r of rows) {
      const tr = h('tr', { class: r.cls || '' }, h('th', {}, r.label));
      for (const c of cols) {
        if (c.in && r.set) tr.append(cellIn(() => r.raw(c.c), v => r.set(c.c, v), { txt: c.txt, type: c.type, fmt: c.fmt }));
        else tr.append(cellCalc(() => r.get(c.c), F[c.fmt || 'money']));
      }
      tb.append(tr);
    }
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'grid' }, thead, tb));
  }
  const dayLabel = d => `${d} · ${F.date(E.addDays(state.meta.monthStart, d - 1))}`;
  function dayRows(dataOut, inputObj, opts = {}) {
    const dim = out.meta.daysInMonth, rows = [];
    const mk = d => ({ label: dayLabel(d), cls: (d > dim ? 'off ' : '') + (d === out.seas.head.J20 ? 'today' : ''), get: c => dataOut.rows[d][c], raw: c => (inputObj()[d] || {})[c], set: (c, v) => { const o = inputObj(); (o[d] = o[d] || {})[c] = v; } });
    for (let d = 1; d <= 15; d++) rows.push(mk(d));
    if (dataOut.sub1) rows.push({ label: 'Subtotal', cls: 'sub', get: c => dataOut.sub1[c] });
    for (let d = 16; d <= 31; d++) rows.push(mk(d));
    if (dataOut.sub2) rows.push({ label: 'Subtotal', cls: 'sub', get: c => dataOut.sub2[c] });
    if (dataOut.total) rows.push({ label: 'Total', cls: 'tot', get: c => dataOut.total[c] });
    return rows;
  }

  const SHEETS = {
    LS_RPRO() {
      const cols = [['B', 'GROSS', 1], ['C', 'DISCOUNT', 1], ['D', 'NET SALES'], ['E', 'APPROVED DISC', 1], ['F', 'DISC W/O APPROVAL'], ['G', 'DEL. FEE', 1], ['H', 'NO. CUSTOMER', 1, 'int'], ['I', 'SHORTAGE'], ['J', 'OVERAGE'],
        ['K', 'TENNIS', 1, 'int'], ['L', 'BADMIN2N', 1, 'int'], ['M', 'ENTERING CUSTOMER', 1, 'int'], ['O', 'CHARGE SALES', 1], ['P', 'GIFT CHECK', 1], ['Q', 'GC ISSUED-cash', 1], ['R', 'GC ISSUED-card', 1], ['S', 'DOWNPAYMENT', 1], ['T', 'ADV', 1],
        ['U', 'CHECKS', 1], ['V', 'COD', 1], ['W', 'CASH ADVANCE', 1], ['X', '(ADV)', 1], ['Y', 'CWT', 1], ['Z', 'CASH DECLARED and DEPOSITED', 1], ['AA', 'CASH SALES AVAILABLE'], ['AB', 'Calculated Cash Fr. Manual and OutSale'], ['AC', 'Cash Fr. Manual and OutSale'], ['AD', 'Over/(Short)']]
        .map(([c, label, i, fmt]) => ({ c, label, in: !!i, fmt: fmt || 'money' }));
      const groups = [['', 3], ['Details of Discount', 2], ['', 1], ['NO.', 1], ['', 2], ['NO. OF STRING', 2], ['ENTERING', 1], ['CHARGE', 1], ['GIFT', 1], ['OTHER COLLECTION', 4], ['CHECKS', 1], ['OTHER DISBURSEMENT', 4], ['CASH', 5]];
      return [sheetHeader('LS_RPRO', `Branch: ${state.meta.store} · ${periodLabel()} · the main daily sales sheet`), grid(cols, dayRows(out.ls, () => state.ls), groups.slice(0))];
    },
    MANUAL() { return manualLike('MANUAL', 'manual'); },
    OUTSALE() { return manualLike('OUTSALE', 'outsale'); },
    MSI() { return lines('MSI', 'msi', 'MANUALLY ADDED TRANSACTIONS', false); },
    MRet() { return lines('MRet', 'mret', 'MANUAL RETURNS', true); },
    Seasonality() {
      const H = out.seas.head, T = out.seas.total;
      const mk = (l, v, ref) => h('div', { class: 'mk' }, h('span', {}, l, ' ', h('code', {}, ref)), h('b', {}, v));
      const editable = (l, ref, get, set) => { const i = h('input', { value: get() ?? '', inputmode: 'decimal' }); i.addEventListener('change', () => { set(i.value.trim()); changed(); renderSheet('Seasonality'); }); return h('div', { class: 'mk' }, h('span', {}, l, ' ', h('code', {}, ref)), i); };
      const head = h('div', { class: 'mini-kpis' },
        editable('Gross sales target', 'G15', () => state.meta.target, v => state.meta.target = E.num(v)),
        editable('Gross margin target', 'M15', () => state.meta.gmTarget, v => state.meta.gmTarget = E.num(v)),
        editable('Running day/s (blank = auto)', 'J20', () => state.meta.runningDays ?? '', v => state.meta.runningDays = v === '' ? null : E.num(v)),
        mk('Month-to-date (MTD)', F.money(H.G16), 'G16'), mk('Ave. daily sales', F.money(H.J15), 'J15'), mk('Target growth vs LY', F.pct(H.J16), 'J16'),
        mk('Total variance on target', F.money(H.G17), 'G17'), mk('Current seasonality', F.pct(H.J17), 'J17'), mk('Straight line', F.pct(H.J18), 'J18'),
        mk('Variance on expected sales – daily', F.money(H.G18), 'G18'), mk('Sales achievement', F.pct(H.J19), 'J19'), mk('Ave. sales needed – daily', F.money(H.G19), 'G19'),
        mk('Best EOM peso value', F.money(H.G20), 'G20'), mk('Best EOM %', F.pct(H.G21), 'G21'), mk('Remaining day/s', String(H.J21), 'J21'),
        mk('MTD LY', F.money(H.G22), 'G22'), mk('% LY', F.pct(H.J22), 'J22'), mk('vs target', F.pct(H.K21), 'K21'),
        mk('GM MTD', F.money(H.M16), 'M16'), mk('GM variance', F.money(H.M17), 'M17'), mk('GM achievement', F.pct(H.M18), 'M18'), mk('GM based on gross', F.pct(H.M19), 'M19'));
      const drv = [['Entering Customer', 'P15', H.P15, H.Q15, H.R15, 'int'], ['Buying Customer', 'P16', H.P16, H.Q16, H.R16, 'int'], ['Average Purchase', 'P17', H.P17, H.Q17, H.R17, 'money'], ['Conversion Ratio', 'P18', H.P18, H.Q18, H.R18, 'pct'], ['Raquet Stringing', 'P19', H.P19, H.Q19, H.R19, 'int'], ['Shoot-out', 'P20', H.P20, H.Q20, H.R20, 'int'],
        ['Gait Request', 'U15', H.U15, H.V15, H.W15, 'int'], ['Gait w/ po', 'U16', H.U16, H.V16, H.W16, 'int'], ['Gait Conversion', 'U17', H.U17, H.V17, H.W17, 'pct'], ['Shoes Sold', 'U18', H.U18, H.V18, H.W18, 'int']];
      const drvT = h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'RETAIL DRIVERS'), h('th', {}, 'RUNNING LY'), h('th', {}, 'RUNNING TY'), h('th', {}, '% inc/dec'))),
        h('tbody', {}, drv.map(r => h('tr', {}, h('th', {}, r[0]), h('td', { class: 'calc' }, F[r[5]](r[2])), h('td', { class: 'calc' }, F[r[5]](r[3])), h('td', { class: 'calc' }, F.pct(r[4]))))));
      const C = (c, label, i, fmt) => ({ c, label, in: !!i, fmt: fmt || 'money' });
      const cols = [C('E', 'DAY', 0, 'text'), C('G', 'ACTUAL LY', 1), C('H', '% SEASONALITY', 0, 'pct'), C('I', 'TARGET SALES PER DAY'), C('K', 'ACTUAL TY'), C('L', 'VARIANCE ON DAILY SALES TARGET'), C('M', '% SEASONALITY OF ACTUAL SALES', 0, 'pct'), C('N', 'Running Variance'),
        C('O', 'QTY. SOLD TY', 1, 'int'), C('P', 'DISCOUNT LY', 1), C('Q', 'DISCOUNT TY'), C('R', '% CHANGE', 0, 'pct'), C('T', 'CONCESSION SALES LY', 1), C('U', 'CONCESSION SALES TY', 1), C('V', '% Inc/Dec', 0, 'pct'), C('W', 'CONCESSION GM'),
        C('X', 'OUTRIGHT SALES LY', 1), C('Y', 'OUTRIGHT SALES TY'), C('Z', '% Inc/Dec', 0, 'pct'), C('AA', 'OUTRIGHT GM'), C('AB', 'TOTAL GROSS MARGIN'), C('AC', '% SEASONALITY OF ACTUAL GM', 0, 'pct'),
        C('AE', 'CREDIT CARD SALES LY', 1), C('AF', 'CREDIT CARD SALES TY'), C('AG', '% Inc/Dec', 0, 'pct'), C('AI', 'ENTERING CUSTOMER LY', 1, 'int'), C('AJ', 'ENTERING CUSTOMER TY', 0, 'int'), C('AK', '% Inc/Dec', 0, 'pct'),
        C('AL', 'BUYING CUSTOMER LY', 1, 'int'), C('AM', 'BUYING CUSTOMER TY', 0, 'int'), C('AN', '% Inc/Dec', 0, 'pct'), C('AO', 'BATTING AVE. LY', 0, 'pct'), C('AP', 'BATTING AVE. TY', 0, 'pct'), C('AQ', '% Inc/Dec', 0, 'pct'),
        C('AS', 'TENNIS LY', 1, 'int'), C('AT', 'TENNIS TY', 0, 'int'), C('AU', '% Inc/Dec', 0, 'pct'), C('AV', 'BADMINTON LY', 1, 'int'), C('AW', 'BADMINTON TY', 0, 'int'), C('AX', '% Inc/Dec', 0, 'pct'),
        C('AY', 'TOTAL RACQUETS STRINGING LY', 0, 'int'), C('AZ', 'TOTAL RACQUETS STRINGING TY', 0, 'int'), C('BA', '% CHANGE', 0, 'pct'), C('BC', 'SHOOT-OUT SALES LY', 1), C('BD', 'SHOOT-OUT SALES TY', 1), C('BE', '% Inc/Dec', 0, 'pct'),
        C('BG', 'GAIT REQUEST LY', 1, 'int'), C('BH', 'GAIT REQUEST TY', 1, 'int'), C('BI', '% Inc/Dec', 0, 'pct'), C('BJ', 'GAIT W/ PO LY', 1, 'int'), C('BK', 'GAIT W/ PO TY', 1, 'int'), C('BL', '% Inc/Dec', 0, 'pct'),
        C('BM', 'GAIT CONVERSION LY', 0, 'pct'), C('BN', 'GAIT CONVERSION TY', 0, 'pct'), C('BO', '% CHANGE', 0, 'pct'), C('BQ', 'SHOES SOLD LY', 1, 'int'), C('BR', 'SHOES SOLD TY', 1, 'int'), C('BS', '% Inc/Dec', 0, 'pct')];
      const dim = out.meta.daysInMonth, rows = [];
      for (let d = 1; d <= 31; d++) rows.push({ label: dayLabel(d), cls: (d > dim ? 'off ' : '') + (d === H.J20 ? 'today' : ''), get: c => out.seas.rows[d][c], raw: c => (state.seas[d] || {})[c], set: (c, v) => (state.seas[d] = state.seas[d] || {})[c] = v });
      rows.push({ label: 'OVERALL TOTAL', cls: 'tot', get: c => c === 'E' ? '' : T[c] });
      return [sheetHeader('Seasonality Template', `DAILY SALES MONITORING REPORT · STORE: ${state.meta.store} · MONTH: ${periodLabel()}`),
        h('div', { class: 'interp block' }, ...H.interp.map(t => h('div', {}, t)), h('div', {}, '**Seasonality percentage shows sales trend last year thus it will be great if the store is at par with the seasonality %age'), h('div', {}, '**Straight line shows equal distribution of sales based on the no. of days')),
        head, h('div', { class: 'block tbl-wrap', style: 'max-height:none' }, drvT), grid(cols, rows),
        h('div', { class: 'card block', style: 'margin-top:14px' }, h('div', { class: 'eyebrow' }, 'Weekly sales report'), (() => { const x = h('div'); const host = $('#weeklyTbl'); renderWeekly(); x.append(host.firstChild.cloneNode(true)); return x; })())];
    },
    SameDay() {
      const o = out.same, dim = out.meta.daysInMonth, y = +state.meta.monthStart.slice(0, 4);
      const cols = [{ c: 'B', label: `LY(${y - 1})`, in: true }, { c: 'C', label: `TY(${y})` }, { c: 'D', label: '% INC/DEC', fmt: 'pct' }];
      const rows = E.DAYS.map(d => ({ label: dayLabel(d), cls: d > dim ? 'off' : '', get: c => o.rows[d][c], raw: () => state.same[d], set: (c, v) => state.same[d] = v }));
      rows.push({ label: 'TOTAL', cls: 'tot', get: c => o.total[c] });
      const sum = h('div', { class: 'mini-kpis' },
        h('div', { class: 'mk' }, h('span', {}, `${y - 1} same days `, h('code', {}, 'B3')), h('b', {}, F.money(o.B3))), h('div', { class: 'mk' }, h('span', {}, `${y} `, h('code', {}, 'B4')), h('b', {}, F.money(o.B4))),
        h('div', { class: 'mk' }, h('span', {}, '% INC/DEC ', h('code', {}, 'C3')), h('b', {}, F.pct(o.C3))), h('div', { class: 'mk' }, h('span', {}, 'Difference ', h('code', {}, 'F3')), h('b', {}, F.money(o.F3))));
      return [sheetHeader('SAME DAY COMPARISON', 'SALES COMPARISON · LY daily values are inputs; TY comes from the Seasonality Template'), sum, grid(cols, rows)];
    },
    EOD() {
      const start = h('input', { type: 'date', value: state.eod.start || state.meta.monthStart }); start.addEventListener('change', () => { state.eod.start = start.value; changed(); renderSheet('EOD'); });
      const cols = [{ c: 'A', label: 'DATE', fmt: 'date' }, { c: 'B', label: 'POS 1', in: true, txt: 1 }, { c: 'C', label: 'POS 2', in: true, txt: 1 }];
      const rows = E.DAYS.map(d => ({ label: String(d), get: c => out.eod.rows[d][c], raw: c => state.eod.rows[d]?.[c], set: (c, v) => (state.eod.rows[d] = state.eod.rows[d] || {})[c] = v }));
      return [sheetHeader('EOD MONITORING', 'Z-ID NUMBER per POS', h('label', {}, 'Start date ', start)), grid(cols, rows)];
    },
    YTDSales() {
      const o = out.ytd, y = +state.meta.monthStart.slice(0, 4);
      const C = (c, label, i, fmt) => ({ c, label, in: !!i, fmt: fmt || 'money' });
      const cols = [C('B', `GROSS SALES ${y - 1}`, 1), C('C', `GROSS SALES ${y}`, 1), C('D', '% CHANGE', 0, 'pct'), C('E', 'AVE. DAILY SALES'), C('F', 'TARGET', 1), C('G', 'ACHV. VS. TARGET', 0, 'pct'),
        C('H', 'GROSS MARGIN TARGET', 1), C('I', 'GROSS MARGIN ACTUAL', 1), C('J', 'ACHIEVEMENT', 0, 'pct'), C('K', 'INC/DEC %', 0, 'pct'), C('L', `CONCESSION ${y - 1}`, 1), C('M', `CONCESSION ${y}`, 1), C('N', '% CHANGE', 0, 'pct'), C('O', 'OUTRIGHT LY', 1), C('P', 'OUTRIGHT TY', 1), C('Q', '% CHANGE', 0, 'pct')];
      const rows = o.months.map((m, i) => ({ label: m.A, get: c => m[c], raw: c => (state.ytd.months[i] || {})[c], set: (c, v) => (state.ytd.months[i] = state.ytd.months[i] || {})[c] = v }));
      rows.push({ label: 'TOTAL', cls: 'tot', get: c => o.total[c] });
      const mIdx = +state.meta.monthStart.slice(5, 7) - 1;
      const pull = h('button', { class: 'btn ghost sm', onclick: () => { (state.ytd.months[mIdx] = state.ytd.months[mIdx] || {}).C = String(Math.round(out.seas.head.G16 * 100) / 100); changed(); renderSheet('YTDSales'); toast('Current MTD copied to ' + o.months[mIdx].A); } }, `Copy MTD into ${o.months[mIdx].A} ${y}`);
      const sc = [C('S', 'DATE', 1), C('T', 'NIKE (amt)', 1), C('U', 'NIKE (qty)', 1, 'int'), C('V', 'ADIDAS (amt)', 1), C('W', 'ADIDAS (qty)', 1, 'int'), C('X', 'SKECHERS (amt)', 1), C('Y', 'SKECHERS (qty)', 1, 'int'), C('Z', 'XTEP (amt)', 1), C('AA', 'XTEP (qty)', 1, 'int'), C('AB', 'SAUCONY (amt)', 1), C('AC', 'SAUCONY (qty)', 1, 'int'), C('AD', 'TOTAL PAIRS', 0, 'int'), C('AG', 'RUNNING SALES LY', 1), C('AH', 'RUNNING SALES TY')];
      sc[0].type = 'date'; sc[0].fmt = 'date';
      const srows = E.DAYS.map(d => ({ label: String(d), get: c => o.shoes[d][c], raw: c => (state.ytd.shoes[d] || {})[c], set: (c, v) => (state.ytd.shoes[d] = state.ytd.shoes[d] || {})[c] = v }));
      srows.push({ label: 'TOTAL', cls: 'tot', get: c => c === 'S' ? '' : o.shoeTotal[c] });
      const mk = (l, v) => h('div', { class: 'mk' }, h('span', {}, l), h('b', {}, v));
      return [sheetHeader('YTD-SALES', `STORE SALES PERFORMANCE SUMMARY · ${y - 1} VS ${y}`, pull), grid(cols, rows),
        h('h3', { class: 'section-h' }, 'Footwear by brand & running sales'),
        h('div', { class: 'mini-kpis' }, mk('Total pairs (S1)', F.int(o.S1)), mk('Running LY (AK3)', F.money(o.AK3)), mk('Running TY (AK4)', F.money(o.AK4)), mk('% (AL3)', F.pct(o.AL3)), mk('Difference (AK7)', F.money(o.AK7))),
        grid(sc, srows)];
    },
    YTDRD() {
      const o = out.ytdrd, y = +state.meta.monthStart.slice(0, 4);
      const C = (c, label, i, fmt) => ({ c, label, in: !!i, fmt: fmt || 'int' });
      const cols = [C('B', `ENTERING ${y - 1}`, 1), C('C', `ENTERING ${y}`, 1), C('D', '% CHANGE', 0, 'pct'), C('E', `BUYING ${y - 1}`, 1), C('F', `BUYING ${y}`, 1), C('G', '% CHANGE', 0, 'pct'), C('H', `AVE PURCHASE ${y - 1}`, 0, 'money'), C('I', `AVE PURCHASE ${y}`, 0, 'money'), C('J', '% CHANGE', 0, 'pct'),
        C('K', `CONVERSION ${y - 1}`, 0, 'pct'), C('L', `CONVERSION ${y}`, 0, 'pct'), C('M', '% CHANGE', 0, 'pct'), C('N', `STRINGING ${y - 1}`, 1), C('O', `STRINGING ${y}`, 1), C('P', '% CHANGE', 0, 'pct'), C('Q', `SHOOTOUT ${y - 1}`, 1), C('R', `SHOOTOUT ${y}`, 1), C('S', '% CHANGE', 0, 'pct'), C('T', `FOOTWEAR ${y - 1}`, 1), C('U', `FOOTWEAR ${y}`, 1), C('V', '% CHANGE', 0, 'pct')];
      const rows = o.months.map((m, i) => ({ label: m.A, get: c => m[c], raw: c => (state.ytdrd.months[i] || {})[c], set: (c, v) => (state.ytdrd.months[i] = state.ytdrd.months[i] || {})[c] = v }));
      rows.push({ label: 'TOTAL', cls: 'tot', get: c => o.total[c] });
      const mIdx = +state.meta.monthStart.slice(5, 7) - 1, H = out.seas.head;
      const pull = h('button', { class: 'btn ghost sm', onclick: () => { const m = (state.ytdrd.months[mIdx] = state.ytdrd.months[mIdx] || {}); m.C = H.Q15; m.F = H.Q16; m.O = H.Q19; m.U = H.V18 || m.U || ''; changed(); renderSheet('YTDRD'); toast('MTD drivers copied to ' + o.months[mIdx].A); } }, `Copy MTD drivers into ${o.months[mIdx].A}`);
      return [sheetHeader('YTD RETAIL DRIVERS', 'Average purchase uses YTD-SALES gross sales ÷ buying customers', pull), grid(cols, rows)];
    },
    Deposit() {
      const o = out.dep;
      const C = (c, label, i, fmt, txt) => ({ c, label, in: !!i, fmt: fmt || 'money', txt });
      const cols = [C('B', 'CASH SALES DATE', 0, 'date'), C('C', 'CASH SALES'), C('D', 'Other Deposit', 1), C('E', 'DEPOSIT SLIP DATE', 1, 'text', 1), C('F', 'Deposit slip #', 1, 'text', 1), C('G', 'Amount to be Deposited'),
        C('H', 'Prepared & Sealed BY:/Witnessed by:', 1, 'text', 1), C('I', 'OIC/Cashier in Charge (During Pick-up)', 1, 'text', 1), C('J', 'Date/Received by: (Bank Rep)', 1, 'text', 1), C('K', 'DATE RECEIVED OF VALIDATED SLIPS', 1, 'text', 1), C('L', 'Pending Deposit Amount', 1), C('M', 'REMARKS', 1, 'text', 1)];
      cols[3].type = 'date';
      const rows = E.DAYS.map(d => ({ label: String(d), get: c => o.rows[d][c], raw: c => (state.dep.rows[d] || {})[c], set: (c, v) => (state.dep.rows[d] = state.dep.rows[d] || {})[c] = v }));
      rows.push({ label: 'TOTAL', cls: 'tot', get: c => ({ C: o.C, D: o.D, G: o.G40, L: o.L })[c] ?? '' });
      return [sheetHeader('DEPOSIT LOGBOOK', `Branch: ${state.meta.store} · PICK-UP SCHEDULE: EVERYDAY`), grid(cols, rows)];
    },
    SG() {
      const o = out.sg;
      const cols = [{ c: 'A', label: 'DATE', fmt: 'date' }, { c: 'B', label: 'TOTAL REGULAR SALES (Z-OUT)', fmt: 'int' }, { c: 'C', label: 'TOTAL SG RECEIPT COPY', in: true, fmt: 'int' }, { c: 'D', label: 'DISCREPANCY', fmt: 'int' },
        { c: 'E', label: 'TOTAL MANUAL SALES (CSI)', in: true, fmt: 'int' }, { c: 'F', label: 'TOTAL SG MANUAL SALES RECEIPT COPY (CSI)', in: true, fmt: 'int' }, { c: 'G', label: 'DISCREPANCY', fmt: 'int' }];
      const rows = E.DAYS.map(d => ({ label: String(d), get: c => o.rows[d][c], raw: c => (state.sg.rows[d] || {})[c], set: (c, v) => (state.sg.rows[d] = state.sg.rows[d] || {})[c] = v }));
      rows.push({ label: 'TOTAL', cls: 'tot', get: c => c === 'A' ? '' : o.total[c] });
      return [sheetHeader("SECURITY GUARD'S RECEIPT MONITORING SHEET", `MONTH: ${monthLabel()} · BRANCH: ${state.meta.store}`), grid(cols, rows)];
    },
    WML() {
      const o = out.wml, y = +state.meta.monthStart.slice(0, 4);
      const C = (c, label, fmt) => ({ c, label, fmt: fmt || 'money' });
      const cols = [C('B', `GROSS ${y - 1}`), C('C', `GROSS ${y}`), C('D', '% CHANGE', 'pct'), C('E', '% VS TARGET', 'pct'), C('F', `DISCOUNT ${y - 1}`), C('G', `DISCOUNT ${y}`), C('H', '% CHANGE', 'pct'), C('I', `NET ${y - 1}`), C('J', `NET ${y}`), C('K', '% CHANGE', 'pct'),
        C('L', `BUYING ${y - 1}`, 'int'), C('M', `BUYING ${y}`, 'int'), C('N', '% CHANGE', 'pct'), C('O', `ENTERING ${y - 1}`, 'int'), C('P', `ENTERING ${y}`, 'int'), C('Q', '% CHANGE', 'pct'), C('R', `AVE PURCHASE ${y - 1}`), C('S', `AVE PURCHASE ${y}`), C('T', '% CHANGE', 'pct'), C('U', `CONVERSION ${y - 1}`, 'pct'), C('V', `CONVERSION ${y}`, 'pct'), C('W', '% CHANGE', 'pct')];
      const rows = o.rows.map(r => ({ label: r.label, get: c => r[c] })); rows.push({ label: 'TOTAL', cls: 'tot', get: c => o.total[c] });
      return [sheetHeader('WML · WEEKLY REPORT', 'STORE SALES PERFORMANCE SUMMARY (hidden sheet in the workbook)'), grid(cols, rows)];
    }
  };
  function manualLike(title, key) {
    const cols = [['B', 'GROSS'], ['C', 'DISCOUNT'], ['D', 'NET SALES'], ['E', 'APPROVED DISC', 1], ['F', 'DISC W/O APPROVAL'], ['G', 'DEL. FEE', 1], ['H', 'NO. CUSTOMER', 1, 'int'], ['I', 'SHORTAGE'], ['J', 'OVERAGE'], ['K', 'INVOICES', 1, 'int'],
      ['M', 'CHARGE SALES'], ['N', 'GIFT CHECK'], ['O', 'GC ISSUED-cash', 1], ['P', 'GC ISSUED-card', 1], ['Q', 'DOWNPAYMENT', 1], ['R', 'ADV', 1], ['S', 'CHECKS'], ['T', 'COD'], ['U', 'CASH ADVANCE'], ['V', '(ADV)', 1], ['W', 'CWT'], ['X', title === 'MANUAL' ? 'CASH' : 'CASH DEPOSIT'], ['Y', 'CASH SALES AVAILABLE'], ['Z', 'Over/(short)']]
      .map(([c, label, i, fmt]) => ({ c, label, in: !!i, fmt: fmt || 'money' }));
    return [sheetHeader(title, `Summed from the MSI / MRet tables where "Manual /OutSale" = "${title === 'MANUAL' ? 'Manual' : 'OutSale'}"`), grid(cols, dayRows(out[key], () => state[key]))];
  }
  const LINE_HEAD = { A: 'BRANCH', B: 'DATE', C: 'CSI No.', D: 'Manual /OutSale', E: 'SALES ORDER #', F: 'Sales Shipment No.', G: 'CON/ OUT', H: 'ALU/UPC', I: 'BRAND', J: 'DESCRIPTION1', K: 'DESC2/ ARTICLE #', L: 'SIZE/ COLOR', M: 'QTY', N: 'Unit Price', O: 'SP', P: '%', Q: 'DISC. AMOUNT', R: 'NET PRICE', S: 'CASH', T: 'Check', U: 'COD', V: 'CREDIT CARD', W: "EMPLOYEES' CHARGE", X: 'Other Charge', Y: 'Customer Name for Charge transaction', Z: 'CHARGE', AA: 'GC/  OTHERS', AB: 'CWT', AC: 'REASON(LS-POP UP)', AD: 'REMARKS', AE: 'CASHIER NAME', AF: 'SALES PERSON(SA) SALES AGENT', AG: 'MIS-REMARKS' };
  const TXT = new Set(['A', 'C', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'Y', 'AC', 'AD', 'AE', 'AF', 'AG']);
  function lines(title, key, sub, isRet) {
    const arr = state[key]; const calc = out[key];
    const cols = Object.keys(LINE_HEAD).map(c => {
      const isCalc = ['O', 'Q', 'R'].includes(c) || (isRet && (c === 'Z' || c === 'A'));
      return { c, label: isRet && c === 'C' ? 'RS#' : isRet && c === 'F' ? 'Return Receipt No.' : LINE_HEAD[c], in: !isCalc, fmt: TXT.has(c) || c === 'D' ? 'text' : c === 'M' ? 'int' : c === 'P' ? 'pct' : 'money' };
    });
    const thead = h('thead', {}, h('tr', {}, h('th', {}, '#'), ...cols.map(c => h('th', { class: c.in ? '' : 'calc' }, h('span', { class: 'col' }, c.c), c.label)), h('th', {}, '')));
    const tb = h('tbody');
    arr.forEach((l, i) => {
      const tr = h('tr', {}, h('th', {}, String(9 + i)));
      for (const c of cols) {
        if (!c.in) tr.append(cellCalc(() => c.c === 'A' ? state.meta.branch : (out[key][i] || {})[c.c], c.c === 'A' ? F.text : F[c.fmt]));
        else if (c.c === 'D') { const s = h('select', {}, ['', 'Manual', 'OutSale'].map(o => h('option', { value: o }, o || '—'))); s.value = l.D || ''; s.addEventListener('change', () => { l.D = s.value; changed(); }); tr.append(h('td', { class: 'in' }, s)); }
        else if (c.c === 'B') tr.append(cellIn(() => l.B, v => l.B = v, { type: 'date' }));
        else tr.append(cellIn(() => l[c.c], v => l[c.c] = v, { txt: TXT.has(c.c) }));
      }
      tr.append(h('td', {}, h('button', { class: 'btn ghost sm', title: 'Delete row', onclick: () => { arr.splice(i, 1); changed(); renderSheet(title); } }, '✕')));
      tb.append(tr);
    });
    const add = h('button', { class: 'btn royal sm', onclick: () => { arr.push({ B: E.addDays(state.meta.monthStart, Math.max(0, (out.seas.head.J20 || 1) - 1)), D: 'Manual', A: isRet ? undefined : state.meta.branch }); changed(); renderSheet(title); } }, '+ Add row');
    const legend = h('div', { class: 'mini-kpis' }, h('div', { class: 'mk' }, h('span', {}, 'INF-'), h('b', {}, 'ITEM NOT ON FILE')), h('div', { class: 'mk' }, h('span', {}, 'WP-'), h('b', {}, 'WRONG PRICE')),
      !isRet ? h('div', { class: 'mk' }, h('span', {}, 'Store Code ', h('code', {}, 'B3')), h('b', {}, state.meta.branch)) : null);
    return [sheetHeader(title, `${sub} · DATE: ${periodLabel()} · ${arr.length} line(s)`, add), legend,
      arr.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'grid' }, thead, tb)) : h('div', { class: 'card hint' }, 'No lines yet. Use “+ Add row” for manual sales / out-sales; they flow into the MANUAL and OUTSALE tabs and into gross sales.')];
  }
  function renderSheet(tab) {
    bindings = []; const host = $('#sheetHost'); host.innerHTML = '';
    const parts = SHEETS[tab](); for (const p of [].concat(parts)) host.append(p);
    updateBindings();
  }

  // ---------- SETTINGS ----------
  function renderSettings() {
    $('#sStore').value = state.meta.store; $('#sBranch').value = state.meta.branch || ''; $('#sMonth').value = state.meta.monthStart;
    $('#sTarget').value = state.meta.target; $('#sGM').value = state.meta.gmTarget || ''; $('#sRun').value = state.meta.runningDays ?? '';
    $('#sTo').value = state.meta.recipient; $('#sCc').value = settings.cc || '';
    $('#tplStatus').textContent = store.raw(K_TPL) ? 'Using a replaced template from this device.' : 'Using the built-in MEG MTD template.';
    renderLog();
  }
  function renderLog() {
    const log = store.get(K_LOG, []); const el = $('#sendLog'); el.innerHTML = '';
    if (!log.length) { el.append(h('div', { class: 'hint' }, 'Nothing sent yet.')); return; }
    log.slice().reverse().forEach(x => el.append(h('div', { class: 'it' }, h('b', {}, x.status), ` · ${new Date(x.at).toLocaleString()} · ${x.file}`, h('div', { class: 'hint' }, `MTD ${F.peso(x.mtd)} · ${x.to} · via ${x.via}`))));
  }
  function bindSettings() {
    $('#btnSaveSettings').onclick = () => {
      const m = $('#sMonth').value;
      state.meta.store = $('#sStore').value.trim() || state.meta.store; state.meta.branch = $('#sBranch').value.trim();
      if (m) state.meta.monthStart = m.slice(0, 8) + '01';
      state.meta.target = E.num($('#sTarget').value); state.meta.gmTarget = E.num($('#sGM').value);
      state.meta.runningDays = $('#sRun').value.trim() === '' ? null : E.num($('#sRun').value);
      state.meta.recipient = $('#sTo').value.trim() || 'FranchiseDev@tobys.com';
      settings.cc = $('#sCc').value.trim(); store.set(K_SET, settings);
      changed(); renderSettings(); toast('Settings saved on this device');
    };
    $('#btnBackup').onclick = () => downloadBlob(new Blob([JSON.stringify({ state, settings }, null, 1)], { type: 'application/json' }), `MTD_${state.meta.branch || 'store'}_${state.meta.monthStart.slice(0, 7)}_backup.json`);
    $('#fRestore').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); state = j.state || j; if (j.settings) { settings = Object.assign(settings, j.settings); store.set(K_SET, settings); } persist(); recalc(); renderSettings(); toast('Backup restored'); } catch (err) { toast('Could not read that file'); } e.target.value = ''; };
    $('#fTemplate').onchange = async e => { const f = e.target.files[0]; if (!f) return; const b64 = await blobToB64(f); if (store.setRaw(K_TPL, b64)) { toast('Template replaced'); renderSettings(); } e.target.value = ''; };
    $('#btnTplReset').onclick = () => { store.del(K_TPL); renderSettings(); toast('Using built-in template'); };
    $('#btnReset').onclick = () => { if (!confirm('Reset everything to the original October workbook data? Your entries on this device will be lost.')) return; state = clone(window.MTD_SEED); persist(); recalc(); renderSettings(); toast('Reset done'); };
    $('#btnNewMonth').onclick = () => {
      if (!confirm('Archive this month on this device and start the next month with empty daily entries? LY/baseline columns and YTD tables are kept for you to update.')) return;
      const arch = store.get(K_ARCH, []); arch.push({ month: state.meta.monthStart, state }); store.set(K_ARCH, arch.slice(-6));
      const [y, m] = state.meta.monthStart.split('-').map(Number); const nx = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const ns = clone(state); ns.meta.monthStart = nx; ns.meta.runningDays = null;
      for (const d of E.DAYS) { ns.ls[d] = {}; ns.manual[d] = {}; ns.outsale[d] = {}; ns.eod.rows[d] = {}; ns.dep.rows[d] = {}; ns.sg.rows[d] = {}; ns.ytd.shoes[d] = {}; }
      ns.msi = []; ns.mret = []; ns.eod.start = nx; ns.dep.B2 = nx; ns.sg.B2 = nx;
      state = ns; persist(); recalc(); renderSettings(); toast('Started ' + monthLabel());
    };
  }
  // ---------- SEND ----------
  function templateBytes() {
    const b64 = store.raw(K_TPL) || window.MTD_TEMPLATE_B64;
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
  }
  function blobToB64(blob) { return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); }); }
  function downloadBlob(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  const fileName = () => { const m = new Date(state.meta.monthStart + 'T00:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toUpperCase(); return `${(state.meta.branch || 'STORE').toUpperCase()}_MTD_${m}_1-${out.meta.daysInMonth}__${state.meta.monthStart.slice(0, 4)}.xlsx`; };
  async function buildWorkbook() { return window.MTDExporter.build(templateBytes(), state, out, { JSZip: window.JSZip, DOMParser, XMLSerializer, outType: 'blob' }); }
  function summary() {
    const H = out.seas.head, L = out.ls.total;
    return { store: state.meta.store, branch: state.meta.branch, month: state.meta.monthStart.slice(0, 7), asOfDay: H.J20, mtd: H.G16, target: H.G15, achievement: H.J19, seasonality: H.J17, straightLine: H.J18,
      varianceOnTarget: H.G17, aveDaily: H.J15, neededDaily: -H.G19, bestEOM: H.G20, vsLY: out.same.C3, entering: H.Q15, buying: H.Q16, avePurchase: H.Q17, conversion: H.Q18, overShort: L.AD };
  }
  function emailHtml(s) {
    const row = (l, v) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #DCE1E8;color:#5E6880">${l}</td><td style="padding:6px 10px;border-bottom:1px solid #DCE1E8;text-align:right;font-weight:700;color:#141B33">${v}</td></tr>`;
    const asof = s.asOfDay ? F.dateL(E.addDays(state.meta.monthStart, s.asOfDay - 1)) : '—';
    return `<div style="font-family:Arial,sans-serif;max-width:560px">
<div style="background:#0E1F5B;color:#fff;padding:16px 18px;border-bottom:4px solid #C9A227"><div style="font-size:12px;letter-spacing:2px;color:#E3C35A">MONTH-TO-DATE SALES REPORT</div><div style="font-size:20px;font-weight:700;margin-top:4px">${state.meta.store}</div><div style="font-size:13px;color:#C3CAD5">${periodLabel()} · data through ${asof}</div></div>
<table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff">
${row('MTD gross sales', F.peso(s.mtd))}${row('Target', F.peso(s.target))}${row('Sales achievement', F.pct1(s.achievement))}${row('Current seasonality', F.pct1(s.seasonality))}${row('Straight line', F.pct1(s.straightLine))}
${row('Variance on target', F.peso(s.varianceOnTarget))}${row('Ave. daily sales', F.peso(s.aveDaily))}${row('Ave. sales needed daily', F.peso(s.neededDaily))}${row('Best EOM value', F.peso(s.bestEOM))}${row('TY vs LY (same days)', F.pct1(s.vsLY))}
${row('Entering / buying customers', F.int(s.entering) + ' / ' + F.int(s.buying))}${row('Average purchase', F.peso(s.avePurchase))}${row('Conversion ratio', F.pct1(s.conversion))}${row('Cash over / (short)', F.money(s.overShort))}
</table>
<p style="font-size:13px;color:#5E6880">${out.seas.head.interp.join('<br>')}</p>
<p style="font-size:12px;color:#7D8798">The full MTD workbook (${fileName()}) is attached — same template and formulas as the store file.</p></div>`;
  }
  function openSend() {
    const s = summary(); const body = $('#sendBody'); body.innerHTML = '';
    const r = (l, v) => h('div', { class: 'sumrow' }, h('span', {}, l), h('b', {}, v));
    body.append(r('To', state.meta.recipient + (settings.cc ? ' · cc ' + settings.cc : '')), r('Attachment', fileName()), r('MTD gross sales', F.peso(s.mtd)), r('Sales achievement', F.pct1(s.achievement)), r('Data through', s.asOfDay ? 'Day ' + s.asOfDay : '—'),
      h('p', { class: 'hint' }, 'On a phone, pick Gmail or Outlook in the share menu. The workbook is already attached. On a computer, the workbook downloads and your mail app opens addressed to Franchise Dev, so attach the downloaded file before sending.'));
    const dlg = $('#sendDlg'); dlg.returnValue = ''; dlg.showModal();
    dlg.onclose = () => { if (dlg.returnValue === 'go') doSend(s); };
  }
  async function doSend(s) {
    const btns = [$('#btnSend'), $('#btnSend2')]; btns.forEach(b => b.disabled = true);
    const name = fileName(); const subject = `MTD Sales Report – ${state.meta.store} – ${periodLabel()} (as of day ${s.asOfDay || 0})`;
    const log = store.get(K_LOG, []); const entry = { at: Date.now(), file: name, to: state.meta.recipient, mtd: s.mtd, status: 'Sent', via: '' };
    try {
      const blob = await buildWorkbook();
      {
        const file = new File([blob], name, { type: blob.type });
        const text = `${subject}\n\nMTD gross sales: ${F.peso(s.mtd)}\nTarget: ${F.peso(s.target)}\nAchievement: ${F.pct1(s.achievement)} (seasonality ${F.pct1(s.seasonality)})\n\n${out.seas.head.interp.join('\n')}`;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: subject, text: 'To: ' + state.meta.recipient + '\n\n' + text });
          entry.via = 'Share sheet'; toast('Workbook attached — choose your mail app and tap send');
        } else {
          downloadBlob(blob, name);
          location.href = `mailto:${encodeURIComponent(state.meta.recipient)}?${settings.cc ? 'cc=' + encodeURIComponent(settings.cc) + '&' : ''}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text + '\n\n(Attach the downloaded file: ' + name + ')')}`;
          entry.via = 'Mail app + download'; entry.status = 'Prepared';
          toast('Workbook downloaded — attach it in the e-mail that just opened', 6000);
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') { btns.forEach(b => b.disabled = false); return; }
      entry.status = 'Failed'; entry.via = String(e.message || e); toast('Send failed: ' + (e.message || e), 6000);
    }
    log.push(entry); store.set(K_LOG, log.slice(-50)); updateStoragePill(); btns.forEach(b => b.disabled = false);
  }

  // ---------- init ----------
  function init() {
    buildTabs(); bindSettings(); persist();
    $('#btnSend').onclick = openSend; $('#btnSend2').onclick = openSend;
    $('#btnDownload').onclick = async () => { const b = $('#btnDownload'); b.disabled = true; try { downloadBlob(await buildWorkbook(), fileName()); } catch (e) { toast('Could not build workbook: ' + e.message); } b.disabled = false; };
    $('#daySel').onchange = e => { entryDay = +e.target.value; renderEntry(); };
    $('#dayPrev').onclick = () => { if (entryDay > 1) { entryDay--; renderEntry(); } };
    $('#dayNext').onclick = () => { if (entryDay < out.meta.daysInMonth) { entryDay++; renderEntry(); } };
    $('#btnSaveNext').onclick = () => { document.activeElement && document.activeElement.blur(); persist(); toast(`Day ${entryDay} saved`); if (entryDay < out.meta.daysInMonth) { entryDay++; renderEntry(); } };
    $('#btnClearDay').onclick = () => { if (!confirm(`Clear all LS_RPRO entries for day ${entryDay}?`)) return; state.ls[entryDay] = {}; changed(); renderEntry(); };
    entryDay = Math.min(out.meta.daysInMonth, (out.seas.head.lastWithData || 0) + 1) || 1;
    let t = 'dashboard'; try { t = sessionStorage.getItem('mtd.tab') || 'dashboard'; } catch (e) { }
    refresh(); show(TABS.some(x => x[0] === t) ? t : 'dashboard');
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => currentTab === 'dashboard' && renderDashboard());
  }
  init();
})();
