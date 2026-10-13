/* Builds the e-mail attachment: the ORIGINAL MEG MTD workbook with every input cell filled from the
   dashboard and every formula kept. Cached values are written from the engine so previews (Gmail,
   phone viewers) show correct numbers; Excel also recalculates fully on open. */
(function (root) {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const E = root.MTDEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  function colToNum(c) { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function splitRef(ref) { const m = /^([A-Z]+)(\d+)$/.exec(ref); return [m[1], +m[2]]; }
  function serial(iso) { const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; }
  const isExpr = s => typeof s === 'string' && /^[\d.\s]+([+\-*/][\d.\s()]+)+$/.test(s.trim());

  // ---- shared formulas -> explicit formulas (so editing any cell never orphans a shared group) ----
  function shiftFormula(f, dr, dc) {
    // split out string literals and structured refs [..] so they are not touched
    return f.split(/("(?:[^"]|"")*"|\[[^\]]*\])/).map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/(^|[^A-Za-z_\d.!'])?(('[^']+'|[A-Za-z_][\w. ]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g,
        (m, pre, sh, shn, dcol, col, drow, rw) => {
          pre = pre || ''; sh = sh || '';
          const c = dcol ? col : numToCol(colToNum(col) + dc);
          const r = drow ? rw : String(+rw + dr);
          return pre + sh + dcol + c + drow + r;
        });
    }).join('');
  }
  function expandShared(doc) {
    const fs = doc.getElementsByTagNameNS(NS, 'f'); const masters = {}; const kids = [];
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i]; if (f.getAttribute('t') !== 'shared') continue;
      const si = f.getAttribute('si');
      if (f.getAttribute('ref') && f.textContent) masters[si] = { f: f.textContent, cell: f.parentNode.getAttribute('r') };
      kids.push(f);
    }
    for (const f of kids) {
      const m = masters[f.getAttribute('si')]; if (!m) continue;
      const [mc, mr] = splitRef(m.cell), [cc, cr] = splitRef(f.parentNode.getAttribute('r'));
      const text = (cc === mc && cr === mr) ? m.f : shiftFormula(m.f, cr - mr, colToNum(cc) - colToNum(mc));
      f.removeAttribute('t'); f.removeAttribute('ref'); f.removeAttribute('si');
      while (f.firstChild) f.removeChild(f.firstChild); f.appendChild(doc.createTextNode(text));
    }
  }

  // ---- cell writing on a parsed sheet DOM ----
  function sheetAPI(doc) {
    expandShared(doc);
    const sheetData = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
    const rowMap = new Map();
    const rows = sheetData.getElementsByTagNameNS(NS, 'row');
    for (let i = 0; i < rows.length; i++) rowMap.set(+rows[i].getAttribute('r'), rows[i]);
    function getRow(r) {
      if (rowMap.has(r)) return rowMap.get(r);
      const el = doc.createElementNS(NS, 'row'); el.setAttribute('r', String(r));
      let after = null; for (const [k, v] of rowMap) if (k > r && (!after || k < +after.getAttribute('r'))) after = v;
      sheetData.insertBefore(el, after); rowMap.set(r, el); return el;
    }
    function getCell(ref) {
      const [c, r] = splitRef(ref); const row = getRow(r);
      const cells = row.getElementsByTagNameNS(NS, 'c'); let after = null;
      for (let i = 0; i < cells.length; i++) {
        const cr = cells[i].getAttribute('r'); if (cr === ref) return cells[i];
        if (!after && colToNum(splitRef(cr)[0]) > colToNum(c)) after = cells[i];
      }
      const el = doc.createElementNS(NS, 'c'); el.setAttribute('r', ref); row.insertBefore(el, after);
      // inherit style from left neighbour row cell if none
      return el;
    }
    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); el.removeAttribute('t'); }
    function add(el, tag, text) { const x = doc.createElementNS(NS, tag); x.appendChild(doc.createTextNode(text)); el.appendChild(x); return x; }
    function valueInto(el, v) {
      if (typeof v === 'number') {
        if (!isFinite(v)) { el.setAttribute('t', 'e'); add(el, 'v', '#DIV/0!'); }
        else add(el, 'v', String(+v.toPrecision(15)));
      } else if (typeof v === 'boolean') { el.setAttribute('t', 'b'); add(el, 'v', v ? '1' : '0'); }
      else if (v !== '' && v != null) { el.setAttribute('t', 'str'); add(el, 'v', String(v)); }
    }
    return {
      // input cell: number / text / date / "a+b" expression (kept as a formula exactly like the template)
      input(ref, raw, kind) {
        const el = getCell(ref); clear(el);
        if (raw === '' || raw === null || raw === undefined) return;
        if (kind === 'date') { add(el, 'v', String(serial(raw))); return; }
        if (typeof raw === 'number') { add(el, 'v', String(raw)); return; }
        const s = String(raw).trim().replace(/,/g, '');
        if (isExpr(s)) { add(el, 'f', s); add(el, 'v', String(E.num(s))); return; }
        if (s !== '' && !isNaN(+s)) { add(el, 'v', String(+s)); return; }
        el.setAttribute('t', 'inlineStr'); const is = doc.createElementNS(NS, 'is'); add(is, 't', String(raw)); el.appendChild(is);
      },
      // formula cell: keep (or set) formula, refresh cached value
      calc(ref, v, formula) {
        const el = getCell(ref);
        const f = el.getElementsByTagNameNS(NS, 'f')[0];
        let fNode = null;
        if (formula) { clear(el); fNode = add(el, 'f', formula); }
        else if (f) { fNode = f.cloneNode(true); clear(el); el.appendChild(fNode); }
        else clear(el);
        if (fNode && fNode.getAttribute('t') === 'shared' && !fNode.textContent) { /* shared child: keep */ }
        valueInto(el, v);
      },
      text(ref, s) { const el = getCell(ref); clear(el); el.setAttribute('t', 'inlineStr'); const is = doc.createElementNS(NS, 'is'); add(is, 't', s); el.appendChild(is); }
    };
  }

  const LS_IN = ['B', 'C', 'E', 'G', 'H', 'K', 'L', 'M', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
  const LS_CALC = ['A', 'D', 'F', 'I', 'J', 'AA', 'AB', 'AC', 'AD'];
  const MO_IN = ['E', 'G', 'H', 'K', 'O', 'P', 'Q', 'R', 'V'];
  const MO_CALC = ['B', 'C', 'D', 'F', 'I', 'J', 'M', 'N', 'S', 'T', 'W', 'X', 'Y', 'Z'];
  const LINE_COLS = []; for (let c = 1; c <= 33; c++) LINE_COLS.push(numToCol(c));

  function fill(sheets, state, out) {
    const D = E.DAYS, row = E.lsRow, S = out.seas.rows;
    const monthName = new Date(state.meta.monthStart + 'T00:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toUpperCase();
    const year = state.meta.monthStart.slice(0, 4), dim = out.meta.daysInMonth;
    const period = `${monthName} 1-${dim}, ${year}`;

    // LS_RPRO
    let w = sheets['LS_RPRO'];
    w.input('A2', state.meta.monthStart, 'date');
    for (const d of D) {
      const r = row(d), i = state.ls[d] || {}, o = out.ls.rows[d];
      for (const c of LS_IN) w.input(c + r, i[c] ?? '');
      for (const c of LS_CALC) {
        if (c === 'A') w.calc('A' + r, serial(o.A));
        else if (c === 'AC') w.calc('AC' + r, o.AC, `MANUAL!X${r}+OUTSALE!X${r}`); // local refs (template rows 6-19 pointed to an old external file)
        else w.calc(c + r, o[c]);
      }
      w.calc('AF' + r, o.AF);
    }
    const lsCols = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD'];
    for (const c of lsCols) { w.calc(c + '21', out.ls.sub1[c]); w.calc(c + '39', out.ls.sub2[c]); w.calc(c + '41', out.ls.total[c]); }

    // MANUAL / OUTSALE
    for (const [name, key] of [['MANUAL', 'manual'], ['OUTSALE', 'outsale']]) {
      w = sheets[name]; const o = out[key];
      w.calc('A2', serial(state.meta.monthStart));
      for (const d of D) {
        const r = row(d); w.calc('A' + r, serial(o.rows[d].A));
        for (const c of MO_IN) w.input(c + r, (state[key][d] || {})[c] ?? '');
        for (const c of MO_CALC) w.calc(c + r, o.rows[d][c]);
      }
      for (const c of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']) {
        w.calc(c + '21', o.sub1[c]); w.calc(c + '39', o.sub2[c]); w.calc(c + '41', o.total[c]);
      }
    }

    // MSI / MRet line tables
    for (const [name, key, isRet] of [['MSI', 'msi', false], ['MRet', 'mret', true]]) {
      w = sheets[name]; const lines = out[key];
      w.text('A2', 'DATE: ' + period);
      if (!isRet) w.input('B3', state.meta.branch || ''); else w.calc('B3', state.meta.branch || '');
      const n = Math.max(lines.length, isRet ? 8 : 11);
      for (let k = 0; k < n; k++) {
        const r = 9 + k, l = lines[k] || {};
        for (const c of LINE_COLS) {
          if (c === 'O') w.calc('O' + r, l.O || 0, `M${r}*N${r}`);
          else if (c === 'Q') w.calc('Q' + r, l.Q || 0, `O${r}*P${r}`);
          else if (c === 'R') w.calc('R' + r, l.R || 0, `O${r}-Q${r}`);
          else if (isRet && c === 'A') w.calc('A' + r, state.meta.branch || '', 'B$3');
          else if (isRet && c === 'Z') w.calc('Z' + r, l.Z || 0, `${name}[[#This Row],[CREDIT CARD]]+${name}[[#This Row],[EMPLOYEES'' CHARGE]]+${name}[[#This Row],[Other Charge]]`);
          else if (c === 'B' && l.B) w.input('B' + r, l.B, 'date');
          else w.input(c + r, l[c] ?? '');
        }
      }
    }

    // Seasonality Template
    w = sheets['Seasonality Template'];
    w.text('E12', state.meta.store); w.text('E13', period);
    w.input('G15', state.meta.target); w.input('M15', state.meta.gmTarget || '');
    w.input('J20', out.seas.head.J20);
    const H = out.seas.head;
    const hmap = { J15: H.J15, J16: H.J16, G16: H.G16, M16: H.M16, G17: H.G17, M17: H.M17, G18: H.G18, J18: H.J18, M18: H.M18, G19: H.G19, J19: H.J19, M19: H.M19, G20: H.G20, G21: H.G21, J21: H.J21, K21: H.K21, G22: H.G22, J22: H.J22,
      P15: H.P15, Q15: H.Q15, R15: H.R15, P16: H.P16, Q16: H.Q16, R16: H.R16, P17: H.P17, Q17: H.Q17, R17: H.R17, P18: H.P18, Q18: H.Q18, R18: H.R18, P19: H.P19, Q19: H.Q19, R19: H.R19, P20: H.P20, Q20: H.Q20, R20: H.R20,
      U15: H.U15, V15: H.V15, W15: H.W15, U16: H.U16, V16: H.V16, W16: H.W16, U17: H.U17, V17: H.V17, W17: H.W17, U18: H.U18, V18: H.V18, W18: H.W18 };
    for (const k in hmap) w.calc(k, hmap[k]);
    w.calc('J17', H.J17, H.J20 > 0 ? `SUM(H25:H${24 + H.J20})` : '0');   // CURRENT SEASONALITY up to running days
    w.calc('G18', H.G18, H.J20 > 0 ? `N${24 + H.J20}` : '0');
    w.calc('J18', H.J18, `(100%/${dim})*J20`); w.calc('J21', H.J21, `${dim}-J20`);
    w.text('N3', H.interp[0]); w.text('N4', H.interp[1]);
    const SIN = ['G', 'O', 'P', 'T', 'U', 'X', 'AE', 'AI', 'AL', 'AS', 'AV', 'BC', 'BD', 'BG', 'BH', 'BJ', 'BK', 'BQ', 'BR'];
    const SCALC = ['H', 'I', 'K', 'L', 'M', 'N', 'Q', 'R', 'V', 'W', 'Y', 'Z', 'AA', 'AB', 'AC', 'AF', 'AG', 'AJ', 'AK', 'AM', 'AN', 'AO', 'AP', 'AQ', 'AT', 'AU', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BE', 'BI', 'BL', 'BM', 'BN', 'BO', 'BS'];
    for (const d of D) {
      const r = 24 + d, i = state.seas[d] || {};
      w.input('E' + r, d <= dim ? S[d].E : ''); w.input('J' + r, d <= dim ? S[d].E : '');
      for (const c of SIN) w.input(c + r, i[c] ?? '');
      for (const c of SCALC) w.calc(c + r, S[d][c]);
    }
    const T = out.seas.total;
    for (const c of Object.keys(T)) w.calc(c + '56', T[c]);
    // weekly sales report rows 62-67
    H.weeks.forEach((wk, k) => {
      const r = 62 + k; if (r > 67) return; const a = 24 + wk.from, b = 24 + wk.to;
      w.text('D' + r, wk.label);
      w.calc('G' + r, wk.TY, `SUM(K${a}:K${b})`); w.calc('H' + r, wk.LY, `SUM(G${a}:G${b})`);
      w.calc('I' + r, wk.chg, `(G${r}-H${r})/G${r}`);
    });
    for (let r = 62 + H.weeks.length; r <= 66; r++) { w.text('D' + r, ''); w.calc('G' + r, 0, '0'); w.calc('H' + r, 0, '0'); w.calc('I' + r, 0, '0'); }
    if (H.weeks.length <= 5) { w.calc('G67', S[31].K); w.calc('H67', T.K); }
    w.calc('G69', H.weeks.reduce((t, x) => t + x.TY, 0) + (H.weeks.length <= 5 ? S[31].K : 0));

    // SAME DAY COMPARISON
    w = sheets['SAME DAY COMPARISON'];
    w.input('A7', state.meta.monthStart, 'date'); w.input('A4', +year); w.input('A3', +year - 1);
    for (const d of D) { const r = 6 + d, o = out.same.rows[d]; if (d > 1) w.calc('A' + r, serial(o.A)); w.input('B' + r, state.same[d] ?? ''); w.calc('C' + r, o.C); w.calc('D' + r, o.D); }
    w.calc('B38', out.same.total.B); w.calc('C38', out.same.total.C); w.calc('D38', out.same.total.D);
    w.calc('B3', out.same.B3, H.J20 > 0 ? `SUM(B7:B${6 + H.J20})` : '0'); w.calc('B4', out.same.B4); w.calc('C3', out.same.C3); w.calc('F3', out.same.F3);

    // EOD MONITORING
    w = sheets['EOD MONITORING'];
    w.input('A3', state.eod.start || state.meta.monthStart, 'date');
    for (const d of D) { const r = 2 + d; if (d > 1) w.calc('A' + r, serial(out.eod.rows[d].A)); w.input('B' + r, state.eod.rows[d]?.B ?? ''); w.input('C' + r, state.eod.rows[d]?.C ?? ''); }

    // YTD-SALES
    w = sheets['YTD-SALES'];
    out.ytd.months.forEach((m, i) => {
      const r = 6 + i, s = state.ytd.months[i] || {};
      for (const c of ['B', 'C', 'F', 'H', 'I', 'L', 'M', 'O', 'P']) w.input(c + r, s[c] ?? '');
      for (const c of ['D', 'E', 'G', 'N', 'Q']) w.calc(c + r, m[c]);
      w.calc('J' + r, m.J, `I${r}/H${r}`); w.calc('K' + r, m.K, `SUM(I${r}-H${r})/H${r}`);
    });
    for (const c of ['B', 'C', 'D', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q']) w.calc(c + '18', out.ytd.total[c]);
    for (const d of D) {
      const r = 2 + d, s = state.ytd.shoes[d] || {}, o = out.ytd.shoes[d];
      if (d <= 30) { w.input('S' + r, s.S || '', s.S ? 'date' : undefined); for (const c of ['T', 'U', 'V', 'W']) w.input(c + r, s[c] ?? ''); }
      else for (const c of ['T', 'U', 'V', 'W']) w.calc(c + r, o[c]);
      for (const c of ['X', 'Y', 'Z', 'AA', 'AB', 'AC']) w.input(c + r, s[c] ?? '');
      if (d <= 30) w.input('AG' + r, s.AG ?? '');
      w.calc('AD' + r, o.AD); w.calc('AH' + r, o.AH);
    }
    w.calc('AD34', out.ytd.shoeTotal.AD); w.calc('AH34', out.ytd.shoeTotal.AH); w.calc('S1', out.ytd.S1);
    w.calc('AK3', out.ytd.AK3); w.calc('AK4', out.ytd.AK4); w.calc('AL3', out.ytd.AL3); w.calc('AK7', out.ytd.AK7);

    // YTD RETAIL DRIVERS
    w = sheets['YTD RETAIL DRIVERS'];
    out.ytdrd.months.forEach((m, i) => {
      const r = 6 + i, s = state.ytdrd.months[i] || {};
      for (const c of ['B', 'C', 'E', 'F', 'N', 'O', 'Q', 'R', 'T', 'U']) w.input(c + r, s[c] ?? '');
      for (const c of ['D', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'P', 'S', 'V']) w.calc(c + r, m[c]);
    });
    for (const c of Object.keys(out.ytdrd.total)) w.calc(c + '18', out.ytdrd.total[c]);

    // DEPOSIT SUMMARY (G uses the same LS_RPRO day row as column C)
    w = sheets['DEPOSIT SUMMARY'];
    w.input('B2', state.dep.B2 || state.meta.monthStart, 'date');
    for (const d of D) {
      const r = 7 + d, o = out.dep.rows[d], s = state.dep.rows[d] || {};
      if (d > 1) w.calc('B' + r, serial(o.B));
      w.calc('C' + r, o.C); w.calc('G' + r, o.G, `LS_RPRO!Z${row(d)}+'DEPOSIT SUMMARY'!D${r}`);
      for (const c of ['D', 'F', 'H', 'I', 'J', 'L', 'M']) w.input(c + r, s[c] ?? '');
      for (const c of ['E', 'K']) w.input(c + r, s[c] ?? '', /^\d{4}-\d{2}-\d{2}$/.test(s[c] || '') ? 'date' : undefined);
    }
    w.calc('G40', out.dep.G40);

    // #OF SG RECEIPT COPY
    w = sheets['#OF SG RECEIPT COPY'];
    w.input('B2', state.sg.B2 || state.meta.monthStart, 'date'); w.input('B3', state.sg.B3 || state.meta.store);
    for (const d of D) {
      const r = 5 + d, o = out.sg.rows[d], s = state.sg.rows[d] || {};
      if (d > 1) w.calc('A' + r, serial(o.A));
      w.calc('B' + r, o.B); w.calc('D' + r, o.D); w.calc('G' + r, o.G);
      for (const c of ['C', 'E', 'F']) w.input(c + r, s[c] ?? '');
    }
    for (const c of ['B', 'C', 'D', 'E', 'F', 'G']) w.calc(c + '37', out.sg.total[c]);

    // WML (hidden weekly sheet)
    w = sheets['WML'];
    out.wml.rows.forEach((x, k) => { const r = 6 + k; w.text('A' + r, x.label); for (const c of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W']) w.calc(c + r, x[c]); });
    for (const c of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W']) w.calc(c + '12', out.wml.total[c]);
  }

  async function build(templateBytes, state, out, deps) {
    const JSZip = deps.JSZip, DP = deps.DOMParser, XS = deps.XMLSerializer;
    const zip = await JSZip.loadAsync(templateBytes);
    const parse = async p => new DP().parseFromString(await zip.file(p).async('string'), 'application/xml');
    const ser = doc => new XS().serializeToString(doc);
    const wbDoc = await parse('xl/workbook.xml');
    const rels = await parse('xl/_rels/workbook.xml.rels');
    const relMap = {}; const R = rels.getElementsByTagName('Relationship');
    for (let i = 0; i < R.length; i++) relMap[R[i].getAttribute('Id')] = R[i].getAttribute('Target');
    const sheetEls = wbDoc.getElementsByTagNameNS(NS, 'sheet'); const sheets = {}, docs = {};
    for (let i = 0; i < sheetEls.length; i++) {
      const name = sheetEls[i].getAttribute('name'); const rid = sheetEls[i].getAttributeNS(RNS, 'id');
      const path = 'xl/' + relMap[rid].replace(/^\/?xl\//, '');
      docs[name] = { path, doc: await parse(path) }; sheets[name] = sheetAPI(docs[name].doc);
    }
    fill(sheets, state, out);
    for (const n in docs) zip.file(docs[n].path, ser(docs[n].doc));

    // extend MSI / MRet table ranges to the rows written
    for (const [tPath, n] of [['xl/tables/table1.xml', state.msi.length], ['xl/tables/table2.xml', state.mret.length]]) {
      if (!zip.file(tPath)) continue; let x = await zip.file(tPath).async('string');
      const cur = +(/ref="A8:AG(\d+)"/.exec(x) || [0, 19])[1]; const last = Math.max(cur, 8 + n);
      x = x.replace(/ref="A8:AG\d+"/g, `ref="A8:AG${last}"`); zip.file(tPath, x);
    }
    // force full recalculation on open and drop the stale calc chain
    let wbx = ser(wbDoc);
    wbx = /<calcPr[^>]*fullCalcOnLoad/.test(wbx) ? wbx : wbx.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
    zip.file('xl/workbook.xml', wbx);
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      let ct = await zip.file('[Content_Types].xml').async('string'); ct = ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''); zip.file('[Content_Types].xml', ct);
      let rx = await zip.file('xl/_rels/workbook.xml.rels').async('string'); rx = rx.replace(/<Relationship[^>]*calcChain[^>]*\/>/, ''); zip.file('xl/_rels/workbook.xml.rels', rx);
    }
    return zip.generateAsync({ type: deps.outType || 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const api = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTDExporter = api;
})(typeof window !== 'undefined' ? window : globalThis);
