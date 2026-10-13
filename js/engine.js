/* MTD formula engine — a 1:1 port of the formulas in MEG_MTD template.
   Each block names the sheet + cell it mirrors so it can be audited against Excel. */
(function (root) {
  'use strict';

  // ---------- helpers ----------
  const SAFE = /^[\d.+\-*/()\s%,]*$/;
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    let s = String(v).trim().replace(/^=/, '').replace(/^\+/, '').replace(/,/g, '');
    if (s === '') return 0;
    if (!SAFE.test(s)) return 0;
    s = s.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
    try { const r = Function('"use strict";return (' + s + ')')(); return isFinite(r) ? r : 0; } catch (e) { return 0; }
  }
  const div = (a, b) => (b === 0 || !isFinite(b) || !isFinite(a)) ? NaN : a / b; // Excel #DIV/0!
  const sum = (arr) => arr.reduce((t, x) => t + x, 0);
  const lsRow = d => (d <= 15 ? 5 + d : 7 + d);   // day -> row on LS_RPRO / MANUAL / OUTSALE
  const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
  const firstHalf = DAYS.filter(d => d <= 15), secondHalf = DAYS.filter(d => d >= 16);

  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
  }
  function daysInMonth(iso) { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function weekday(iso) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(iso + 'T00:00:00Z').getUTCDay()]; }

  // ---------- MANUAL / OUTSALE (fed by MSI & MRet tables) ----------
  // MSI: O=M*N, Q=O*P, R=O-Q ; MRet adds Z = V+W+X (CHARGE)
  function lineCalc(row, withChargeFormula) {
    const M = num(row.M), N = num(row.N), P = num(row.P);
    const O = M * N, Q = O * P, R = O - Q;
    const Z = withChargeFormula ? num(row.V) + num(row.W) + num(row.X) : num(row.Z);
    return { O, Q, R, Z };
  }
  function sumifs(lines, isRet, field, dateIso, kind) {
    let t = 0;
    for (const l of lines) {
      const k = String(isRet ? l.D : l.D || '').trim().toLowerCase();
      if ((l.B || '') !== dateIso || k !== kind.toLowerCase()) continue;
      const c = lineCalc(l, isRet);
      const v = field in c ? c[field] : num(l[field]);
      t += v;
    }
    return t;
  }

  function calcManualLike(state, kind, dateOf) {
    const inp = kind === 'Manual' ? state.manual : state.outsale;
    const rows = {};
    for (const d of DAYS) {
      const i = inp[d] || {}, dt = dateOf(d);
      // B=SUMIFS(msi SP)-SUMIFS(MRet SP); C=DISC. AMOUNT; M=CHARGE; N=GC/OTHERS; S=Check; T=COD; W=CWT; X=CASH
      const f = (col) => sumifs(state.msi, false, col, dt, kind) - sumifs(state.mret, true, col, dt, kind);
      const r = { A: dt };
      r.B = f('O'); r.C = f('Q'); r.D = r.B - r.C; r.E = num(i.E); r.F = r.C - r.E; r.G = num(i.G); r.H = num(i.H);
      r.K = num(i.K); r.M = f('Z'); r.N = f('AA'); r.O = num(i.O); r.P = num(i.P); r.Q = num(i.Q); r.R = num(i.R);
      r.S = f('T'); r.T = f('U'); r.U = 0; r.V = num(i.V); r.W = f('AB'); r.X = f('S');
      r.Y = r.D - r.M - r.N + r.O + r.Q + r.R - r.S - r.T - r.U - r.V - r.W;  // Y=D-M-N+O+Q+R-S-T-U-V-W
      r.Z = r.X - r.Y;                                                          // Z=X-Y
      r.I = r.Z < 0.01 ? r.Z : 0;  r.J = r.Z > 0.01 ? r.Z : 0;                  // SUMIF(Z,"<.01") / (">.01")
      rows[d] = r;
    }
    const cols = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    return { rows, ...subtotals(rows, cols, ['D', 'F']) };
  }

  function subtotals(rows, cols, recompute) {
    const s1 = {}, s2 = {}, tot = {};
    for (const c of cols) {
      s1[c] = sum(firstHalf.map(d => rows[d][c]));   // row 21 =SUM(x6:x20)
      s2[c] = sum(secondHalf.map(d => rows[d][c]));  // row 39 =SUM(x23:x38)
      tot[c] = s1[c] + s2[c];                         // row 41 =+x21+x39
    }
    if (recompute) { tot.D = tot.B - tot.C; tot.F = tot.C - tot.E; } // D41=+B41-C41, F41=+C41-E41
    return { sub1: s1, sub2: s2, total: tot };
  }

  // ---------- main ----------
  function compute(state) {
    const meta = state.meta;
    const start = meta.monthStart;
    const dim = daysInMonth(start);
    const dateOf = d => addDays(start, d - 1);
    const out = { meta: { ...meta, daysInMonth: dim } };

    const MAN = calcManualLike(state, 'Manual', dateOf);
    const OUT = calcManualLike(state, 'OutSale', dateOf);
    out.manual = MAN; out.outsale = OUT;
    out.msi = state.msi.map(l => ({ ...l, ...lineCalc(l, false) }));
    out.mret = state.mret.map(l => ({ ...l, ...lineCalc(l, true) }));

    // ---------- LS_RPRO ----------
    const ls = {};
    for (const d of DAYS) {
      const i = state.ls[d] || {}; const r = { A: dateOf(d) };
      for (const c of ['B', 'C', 'E', 'G', 'H', 'K', 'L', 'M', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']) r[c] = num(i[c]);
      r.D = r.B - r.C;                                   // =+B-C
      r.F = r.C - r.E;                                   // =+C-E
      r.AA = r.D - r.O - r.P + r.Q + r.S + r.T - r.U - r.V - r.W - r.X - r.Y; // CASH SALES AVAILABLE
      r.AB = r.Z - r.AA;                                 // =Z-AA
      r.I = r.AB < 0.01 ? r.AB : 0;                      // =SUMIF(AB,"<.01")
      r.J = r.AB > 0.01 ? r.AB : 0;                      // =SUMIF(AB,">.01")
      r.AC = MAN.rows[d].X + OUT.rows[d].X;              // =MANUAL!X+OUTSALE!X
      r.AD = r.AB - r.AC;                                // =AB-AC
      r.AF = r.O + r.P + r.U + r.V + r.W + r.X + r.Y - r.Q - r.R - r.S - r.T;
      r.hasData = ['B', 'C', 'H', 'M', 'O', 'Z'].some(c => String(i[c] ?? '').trim() !== '' && num(i[c]) !== 0);
      ls[d] = r;
    }
    const LSCOLS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD'];
    out.ls = { rows: ls, ...subtotals(ls, LSCOLS, ['D', 'F']) };

    // ---------- Seasonality Template ----------
    const S = {}; const G15 = num(meta.target), M15 = num(meta.gmTarget);
    const lastWithData = DAYS.filter(d => d <= dim && ls[d].hasData).pop() || 0;
    const J20 = (meta.runningDays !== null && meta.runningDays !== '' && meta.runningDays !== undefined) ? num(meta.runningDays) : lastWithData;
    for (const d of DAYS) {
      const i = state.seas[d] || {}; const r = { D: d, date: dateOf(d), E: weekday(dateOf(d)) };
      for (const c of ['G', 'O', 'P', 'T', 'U', 'X', 'AE', 'AI', 'AL', 'AS', 'AV', 'BC', 'BD', 'BG', 'BH', 'BJ', 'BK', 'BQ', 'BR']) r[c] = num(i[c]);
      r.K = ls[d].B + MAN.rows[d].B + OUT.rows[d].B;     // =LS_RPRO!B+MANUAL!B+OUTSALE!B
      r.Q = ls[d].C + MAN.rows[d].C + OUT.rows[d].C;     // DISCOUNT 2026
      r.AF = ls[d].O + MAN.rows[d].M + OUT.rows[d].M;    // CREDIT CARD SALES 2026
      r.AJ = ls[d].M;                                    // ENTERING CUSTOMER 2026
      r.AM = ls[d].H + MAN.rows[d].H + OUT.rows[d].H;    // BUYING CUSTOMER
      r.AT = ls[d].K; r.AW = ls[d].L;                    // TENNIS / BADMINTON
      S[d] = r;
    }
    const G56 = sum(DAYS.map(d => S[d].G));
    let run = 0;
    for (const d of DAYS) {
      const r = S[d];
      r.H = d === 1 ? div(r.K, G56) : div(r.G, G56); // H25 is =K25/G$56 in the template; H26:H55 =G/G$56 (kept as-is)
      r.I = G15 * r.H;                     // =G$15*H
      r.L = r.K - r.I;                     // =K-I
      r.M = div(r.K, G15);                 // =K/G15
      run += r.L; r.N = run;               // N25=L25 ; N=N(prev)+L
      r.R = div(r.Q - r.P, r.P);
      r.V = div(r.U - r.T, r.T);
      r.W = r.U * 0.25;                    // =U*25%
      r.Y = r.K - r.U;                     // =K-U
      r.Z = div(r.Y - r.X, r.X);
      r.AA = r.Y * 0.30;                   // =Y*30%
      r.AB = r.W + r.AA;
      r.AC = div(r.AB, M15);               // =AB/$M$15
      r.AG = div(r.AF - r.AE, r.AE);
      r.AK = div(r.AJ, r.AI) - 1;
      r.AN = div(r.AM, r.AL) - 1;
      r.AO = div(r.AL, r.AI); r.AP = div(r.AM, r.AJ); r.AQ = r.AP - r.AO;
      r.AU = div(r.AT - r.AS, r.AS); r.AX = div(r.AW - r.AV, r.AV);
      r.AY = r.AS + r.AV; r.AZ = r.AT + r.AW; r.BA = div(r.AZ - r.AY, r.AY);
      r.BE = div(r.BD - r.BC, r.BC); r.BI = div(r.BH - r.BG, r.BG); r.BL = div(r.BK - r.BJ, r.BJ);
      r.BM = div(r.BJ, r.BG); r.BN = div(r.BK, r.BH); r.BO = r.BN - r.BM;
      r.BS = div(r.BR - r.BQ, r.BQ);
    }
    const T = {}; // row 56
    for (const c of ['G', 'H', 'I', 'K', 'L', 'N', 'O', 'P', 'Q', 'T', 'U', 'W', 'X', 'Y', 'AA', 'AB', 'AC', 'AE', 'AF', 'AI', 'AJ', 'AL', 'AM', 'AS', 'AT', 'AV', 'AW', 'AY', 'AZ', 'BC', 'BD', 'BG', 'BH', 'BJ', 'BK', 'BQ', 'BR'])
      T[c] = sum(DAYS.map(d => S[d][c]));
    T.M = div(T.K, G15); T.R = div(T.Q - T.P, T.P); T.V = div(T.U - T.T, T.T); T.Z = div(T.Y - T.X, T.X);
    T.AG = div(T.AF - T.AE, T.AE); T.AK = div(T.AJ, T.AI) - 1; T.AN = div(T.AM, T.AL) - 1;
    T.AO = div(T.AL, T.AI); T.AP = div(T.AM, T.AJ); T.AQ = T.AP - T.AO;
    T.AU = div(T.AT - T.AS, T.AS); T.AX = div(T.AW - T.AV, T.AV); T.BA = div(T.AZ - T.AY, T.AY);
    T.BE = div(T.BD - T.BC, T.BC); T.BI = div(T.BH - T.BG, T.BG); T.BL = div(T.BK - T.BJ, T.BJ);
    T.BM = div(T.BJ, T.BG); T.BN = div(T.BK, T.BH); T.BO = T.BN - T.BM; T.BS = div(T.BR - T.BQ, T.BQ);

    const upTo = DAYS.filter(d => d <= J20);
    const H = {}; // header KPI block
    H.G15 = G15; H.M15 = M15; H.J20 = J20; H.lastWithData = lastWithData;
    H.G16 = T.K;                                        // MTD =K56
    H.J15 = div(H.G16, J20);                            // AVE. DAILY SALES =G16/J20
    H.J16 = div(G15, T.G) - 1;                          // TARGET GROWTH VS LY =G15/G56-1
    H.M16 = T.AB;                                       // GM MTD =AB56
    H.G17 = H.G16 - G15;                                // TOTAL VARIANCE ON TARGET
    H.J17 = sum(upTo.map(d => S[d].H));                 // CURRENT SEASONALITY =SUM(H25:H[24+J20])
    H.M17 = H.M16 - M15;
    H.G18 = J20 > 0 ? S[J20].N : 0;                     // VARIANCE ON EXPECTED SALES =N[24+J20]
    H.J18 = (1 / dim) * J20;                            // STRAIGHT LINE =(100%/31)*J20
    H.M18 = T.AC;                                       // GM ACHIEVEMENT =SUM(AC)
    H.J21 = dim - J20;                                  // REMAINING DAYS =31-J20
    H.G19 = div(H.G17, H.J21);                          // AVE SALES NEEDED DAILY =G17/J21
    H.J19 = sum(DAYS.map(d => S[d].M));                 // SALES ACHIEVEMENT =SUM(M25:M55)
    H.M19 = div(H.M16, H.G16);                          // GM vs gross =M16/G16
    H.G20 = H.J15 * H.J21 + H.G16;                      // BEST EOM PESO VALUE
    H.G21 = div(H.G20, G15);                            // BEST EOM %
    H.K21 = 1 - H.J19;                                  // vs target
    H.G22 = T.G;                                        // MTD LY =G56
    H.J22 = div(T.K - H.G22, H.G22);                    // % LY
    // Retail drivers block
    H.P15 = T.AI; H.Q15 = T.AJ; H.R15 = div(H.Q15, H.P15) - 1;
    H.P16 = T.AL; H.Q16 = T.AM; H.R16 = div(H.Q16, H.P16) - 1;
    H.P17 = div(T.G, T.AL); H.Q17 = div(H.G16, H.Q16); H.R17 = div(H.Q17, H.P17) - 1;
    H.P18 = div(H.P16, H.P15); H.Q18 = div(H.Q16, H.Q15); H.R18 = H.Q18 - H.P18;
    H.P19 = T.AY; H.Q19 = T.AZ; H.R19 = div(H.Q19, H.P19) - 1;
    H.P20 = T.BC; H.Q20 = T.BD; H.R20 = div(H.Q20, H.P20) - 1;
    H.U15 = T.BG; H.V15 = T.BH; H.W15 = div(H.V15, H.U15) - 1;
    H.U16 = T.BJ; H.V16 = T.BK; H.W16 = div(H.V16, H.U16) - 1;
    H.U17 = div(H.U16, H.U15); H.V17 = div(H.V16, H.V15); H.W17 = H.V17 - H.U17;
    H.U18 = T.BQ; H.V18 = T.BR; H.W18 = div(H.V18, H.U18) - 1;
    const pct = x => Math.round(x * 100);
    H.interp = [
      `*Current seasonality %age is ${pct(H.J17)}% while Sales Achievement is @ ${pct(H.J19)}%. The store is ${H.J19 >= H.J17 ? 'ahead' : 'short'} by ${Math.abs(pct(H.J17) - pct(H.J19))}% on seasonality`,
      `*Straight line is ${pct(H.J18)}% while Sales Achievement is @ ${pct(H.J19)}%. The store is ${H.J19 >= H.J18 ? 'ahead' : 'short'} by ${Math.abs(pct(H.J18) - pct(H.J19))}% on straight line`,
    ];
    // Weekly sales report (rows 62-66): Mon–Sun weeks of the month
    const weeks = []; let cur = null;
    for (const d of DAYS.filter(d => d <= dim)) {
      const wd = new Date(dateOf(d) + 'T00:00:00Z').getUTCDay();
      if (!cur || wd === 1) { cur = { from: d, to: d }; weeks.push(cur); } else cur.to = d;
    }
    const mon = new Date(start + 'T00:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
    H.weeks = weeks.map(w => {
      const ds = DAYS.filter(d => d >= w.from && d <= w.to);
      const G = sum(ds.map(d => S[d].K)), Hh = sum(ds.map(d => S[d].G));
      return { label: `${mon} ${w.from}-${w.to}`, from: w.from, to: w.to, TY: G, LY: Hh, chg: div(G - Hh, G) }; // =(G-H)/G
    });
    out.seas = { rows: S, total: T, head: H };

    // ---------- SAME DAY COMPARISON ----------
    const SD = {};
    for (const d of DAYS) { const B = num(state.same[d]); const C = S[d].K; SD[d] = { A: dateOf(d), B, C, D: d <= 3 ? div(C - B, C) : div(C - B, B) }; } // template: D7:D9 =(C-B)/C, D10:D37 =(C-B)/B
    const SDt = { B: sum(DAYS.map(d => SD[d].B)), C: sum(DAYS.map(d => SD[d].C)) }; SDt.D = div(SDt.C - SDt.B, SDt.B);
    const B3 = sum(upTo.map(d => SD[d].B));           // LY same days (B3)
    const B4 = SDt.C;                                 // =C38
    out.same = { rows: SD, total: SDt, B3, B4, C3: div(B4 - B3, B3), F3: B4 - B3 };

    // ---------- EOD MONITORING ----------
    const eodStart = state.eod.start || start;
    out.eod = { rows: Object.fromEntries(DAYS.map(d => [d, { A: addDays(eodStart, d - 1), B: state.eod.rows[d]?.B ?? '', C: state.eod.rows[d]?.C ?? '' }])) };

    // ---------- YTD-SALES ----------
    const MDAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // divisors exactly as template E6:E17
    const MN = ['JAN', 'FEB', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC'];
    const ym = []; for (let i = 0; i < 12; i++) {
      const m = state.ytd.months[i] || {}; const r = { A: MN[i] };
      for (const c of ['B', 'C', 'F', 'H', 'I', 'L', 'M', 'O', 'P']) r[c] = num(m[c]);
      r.D = div(r.C - r.B, r.B); r.E = r.C / MDAYS[i]; r.G = div(r.C - r.F, r.F);
      r.J = div(r.I, r.H); r.K = div(r.I - r.H, r.H); r.N = div(r.M - r.L, r.L); r.Q = div(r.P - r.O, r.O);
      ym.push(r);
    }
    const yt = {}; for (const c of ['B', 'C', 'F', 'H', 'I', 'L', 'M', 'O', 'P']) yt[c] = sum(ym.map(r => r[c]));
    yt.D = div(yt.C - yt.B, yt.B); yt.G = div(yt.C - yt.F, yt.F); yt.J = div(yt.I, yt.H); yt.K = div(yt.I - yt.H, yt.H); yt.N = div(yt.M - yt.L, yt.L); yt.Q = div(yt.P - yt.O, yt.O);
    const shoes = {}; for (const d of DAYS) {
      const s = state.ytd.shoes[d] || {}; const r = { S: s.S || '' };
      for (const c of ['T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AG']) r[c] = num(s[c]);
      r.AF = d; r.AH = S[d].K; shoes[d] = r;
    }
    // template row 33 (day 31 slot) holds T33:W33 =SUM(x3:x32)
    for (const c of ['T', 'U', 'V', 'W']) shoes[31][c] = sum(DAYS.filter(d => d <= 30).map(d => shoes[d][c]));
    for (const d of DAYS) { const r = shoes[d]; r.AD = r.U + r.W + r.Y + r.AA + r.AC; } // =U+W+Y+AA+AC
    const st = {}; for (const c of ['T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AG', 'AH']) st[c] = sum(DAYS.filter(d => d <= 30 || !'TUVW'.includes(c)).map(d => shoes[d][c]));
    st.AD = sum(DAYS.map(d => shoes[d].AD));          // AD34 =SUM(AD3:AD33)
    const AK3 = st.AG, AK4 = st.AH;
    out.ytd = { months: ym, total: yt, shoes, shoeTotal: st, AK3, AK4, AL3: div(AK4 - AK3, AK3), AK7: AK4 - AK3, S1: st.AD, labels: state.ytd.labels || {} };

    // ---------- YTD RETAIL DRIVERS ----------
    const rd = []; for (let i = 0; i < 12; i++) {
      const m = state.ytdrd.months[i] || {}; const r = { A: MN[i] };
      for (const c of ['B', 'C', 'E', 'F', 'N', 'O', 'Q', 'R', 'T', 'U']) r[c] = num(m[c]);
      r.D = div(r.C - r.B, r.B); r.G = div(r.F - r.E, r.E);
      r.H = div(ym[i].B, r.E); r.I = div(ym[i].C, r.F); r.J = div(r.I - r.H, r.H);  // ='YTD-SALES'!B/E
      r.K = div(r.E, r.B); r.L = div(r.F, r.C); r.M = r.L - r.K;
      r.P = div(r.O - r.N, r.N); r.S = div(r.R - r.Q, r.Q); r.V = div(r.U - r.T, r.T);
      rd.push(r);
    }
    const rt = {}; for (const c of ['B', 'C', 'E', 'F', 'N', 'O', 'Q', 'R', 'T', 'U']) rt[c] = sum(rd.map(r => r[c]));
    rt.D = div(rt.C - rt.B, rt.B); rt.G = div(rt.F - rt.E, rt.E); rt.H = div(yt.B, rt.E); rt.I = div(yt.C, rt.F); rt.J = div(rt.I - rt.H, rt.H);
    rt.K = div(rt.E, rt.B); rt.L = div(rt.F, rt.C); rt.M = rt.L - rt.K; rt.P = div(rt.O - rt.N, rt.N); rt.S = div(rt.R - rt.Q, rt.Q); rt.V = div(rt.U - rt.T, rt.T);
    out.ytdrd = { months: rd, total: rt };

    // ---------- DEPOSIT SUMMARY ----------
    const depStart = state.dep.B2 || start; const dep = {};
    for (const d of DAYS) {
      const i = state.dep.rows[d] || {}; const r = { B: addDays(depStart, d - 1) };
      for (const c of ['E', 'F', 'H', 'I', 'J', 'K', 'M']) r[c] = i[c] ?? '';
      r.D = num(i.D); r.L = num(i.L);
      r.C = ls[d].AA;                 // =LS_RPRO!AA
      r.G = ls[d].Z + r.D;            // =LS_RPRO!Z+'DEPOSIT SUMMARY'!D
      dep[d] = r;
    }
    out.dep = { rows: dep, G40: sum(DAYS.map(d => dep[d].G)), C: sum(DAYS.map(d => dep[d].C)), L: sum(DAYS.map(d => dep[d].L)), D: sum(DAYS.map(d => dep[d].D)) };

    // ---------- #OF SG RECEIPT COPY ----------
    const sgStart = state.sg.B2 || start; const sg = {};
    for (const d of DAYS) {
      const i = state.sg.rows[d] || {}; const r = { A: addDays(sgStart, d - 1) };
      r.B = ls[d].H;                  // =LS_RPRO!H
      r.C = num(i.C); r.D = r.C - r.B; // =SUM(C-B)
      r.E = num(i.E); r.F = num(i.F); r.G = r.E - r.F;
      sg[d] = r;
    }
    const sgt = {}; for (const c of ['B', 'C', 'D', 'E', 'F', 'G']) sgt[c] = sum(DAYS.map(d => sg[d][c]));
    out.sg = { rows: sg, total: sgt };

    // ---------- WML (weekly report) — template week blocks rows 25-32, 33-39, 40-46, 47-54, 55 ----------
    const blocks = [[1, 8], [9, 15], [16, 22], [23, 30], [31, 31]];
    const wml = blocks.map(([a, b]) => {
      const ds = DAYS.filter(d => d >= a && d <= b);
      const s = c => sum(ds.map(d => S[d][c]));
      const r = { label: `${mon}. ${a === b ? a : a + '-' + b}`, B: s('G'), C: s('K'), F: s('P'), G: s('Q'), L: s('AL'), M: s('AM'), O: s('AI'), P: s('AJ') };
      return wmlDerive(r, G15);
    });
    const wt = { label: 'TOTAL' }; for (const c of ['B', 'C', 'F', 'G', 'L', 'M', 'O', 'P']) wt[c] = sum(wml.map(r => r[c]));
    out.wml = { rows: wml, total: wmlDerive(wt, G15) };

    return out;
  }
  function wmlDerive(r, G15) {
    r.D = div(r.C - r.B, r.B); r.E = div(r.C, G15); r.H = div(r.G - r.F, r.F);
    r.I = r.B - r.F; r.J = r.C - r.G; r.K = div(r.J - r.I, r.I); r.N = div(r.M - r.L, r.L); r.Q = div(r.P - r.O, r.O);
    r.R = div(r.B, r.L); r.S = div(r.C, r.M); r.T = div(r.S - r.R, r.R); r.U = div(r.L, r.O); r.V = div(r.M, r.P); r.W = r.V - r.U;
    return r;
  }

  const api = { compute, num, lsRow, addDays, daysInMonth, weekday, DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MTDEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
