/* casa DERBY 結果の決定（サーバーとブラウザの両方で動く。DOM なし）: window.Outcome
   v4（2026-10-21 オーナー決定・仕様書_v4_大改修.md）: 投票は 2 連単だけ（1 着・2 着を順番どおり。6 頭で 30 通り）。1 人 1 票＝100pt。
   - 当選額 ＝ 100pt × 2 連単の倍率 を 100pt 単位に切り上げ（例 12.4 倍 → 1,240 → 1,300pt）。payFor・PAY_STEP。
     倍率は 0.1 刻みなので、当選額が変わるのは倍率が 1.0 上がるごと（12.1〜13.0 倍はどれも 1,300pt）。
   - 裏の決め方（今までの単勝の決め方を 30 通りに広げたもの）:
     票の入った組み合わせごとに「確定倍率をずらし幅の中のどれかにしたとき」の払い戻し（票の数 × 当選額）を出し、
     当たりの幅（目標 ×（1 − bandBelow）〜 目標 ×（1 + bandAbove））に入る組み合わせから、自然に起きやすさ（comboProb）で重み付きの抽選（reason 'band'）。
     幅に入る組み合わせがなければ一番近いもの（reason 'target'。同点は起きやすさで抽選）。＝必ず誰かは当てる（票の入った組み合わせから選ぶ）。
     店ごと（scope 'store'）は今までと同じ（どの店も幅に入る 'store_each' → 各店の足りない分・多い分の平均で 'store_avg'）。
   - 払い出しの上限（1 レース・1 日の残り。cap）は「必ず誰かは当てる」より強い: 票の入ったどの組み合わせも上限を超えるなら、
     票の入っていない組み合わせから起きやすさで抽選する（当たりなし。reason 'cap_nowin'）。30 通り全部に票があって全部超えるときだけ、一番少ないもの（'cap_conflict'）。
   - 票が 1 つもないレースは自然の結果（seed の走りのまま。reason 'nobody'）。
   - 締切のあとの倍率のずらし（2026-10-20 オーナー決定「上限なし」）: 上げる幅 up・下げる幅 down は管理画面で自由に（up は上限なし・down は 1 まで）。
     ただし倍率は 1.0 倍より下げない（MIN_T）。999.9 倍より上げない（MAX_T）。ほかの組み合わせは見かけの払い戻し率がそろうよう同じ向きに少し動かす（shapeExacta）。
   - 決めた 1 着・2 着の順でゴールする走りの seed を探す（findSeedPair: Engine.recordRun。見つからなければ一番近い seed で、隣どうしの入れ替え＝Engine.replayRun の order）。
   - 1 台で番号が多いスマホの票（2026-10-27。input.extra）: 決め方（目標の幅・必ず誰かは当てる・倍率のずらし）には数えない。上限にだけ数える（上限がいちばん強いのはそのまま）。
     幅の中・目標に近い組み合わせを選ぶときは、そのスマホの票が無い組み合わせを先に選ぶ（どれにもあるときだけ、ある組み合わせ＝自然に当たる）。
     ふつうの票が無く、多いスマホの票だけのときは、30 通りから起きやすさで抽選（reason 'heavy_only'。上限を超える組み合わせは選ばない）。extra が空なら今までと同じ答え。
   キー（組み合わせ）は '1着の添字-2着の添字'（例 '2-4' ＝ 3 番 → 5 番）。js/engine.js の ekey と同じ。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Outcome = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_T = 10, MAX_T = 9999; // 倍率の下限・上限（0.1 倍単位: 1.0〜999.9）
  const STAKE = 100;               // 1 票の元の額（pt）
  const PAY_STEP = 100;            // 当選額は 100pt 単位に切り上げ

  function mulberry(seed) { let a = (seed >>> 0) || 0x9e3779b9; return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash() { let h = 2166136261 >>> 0; for (let k = 0; k < arguments.length; k++) { const s = String(arguments[k]); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } h ^= 0x2c; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  const toT = (o) => Math.round(Number(o) * 10);
  const ekey = (a, b) => a + '-' + b;
  const parseKey = (k) => { const m = /^(\d+)-(\d+)$/.exec(String(k || '')); return m ? [Number(m[1]), Number(m[2])] : null; };
  const roundPay = (v) => { const x = Math.round((Number(v) || 0) * 1000) / 1000; return x > 0 ? Math.ceil(x / PAY_STEP) * PAY_STEP : 0; };
  // 1 票の当選額（倍率は 0.1 倍単位の整数 oddT）: 100pt × 倍率 を 100pt 単位に切り上げ ＝ ceil(oddT / 10) × 100
  const amountT = (oddT) => roundPay(Math.max(MIN_T, oddT) * (STAKE / 10));
  // 倍率（小数）→ 1 票の当選額
  function payFor(odds) { return amountT(toT(odds)); }
  // 以前の名前（stakePayout(枚数, 倍率)）も残す: 票の数 × 1 票の当選額
  function stakePayout(count, odds) { return Math.max(0, Math.floor(Number(count) || 0)) * payFor(odds); }
  // 1 票あたりの額（以前の perTicket）＝ payFor
  const perTicket = payFor;

  // ずらし幅 { up, down }: input.up / input.down、なければ w（初期 0.1）を両方に。up は上限なし（MAX_T で止まる）・down は 1 まで（MIN_T で止まる）
  function shiftOf(x) {
    if (typeof x === 'number' || x == null) { const w = x == null ? 0.1 : Math.max(0, Number(x) || 0); return { up: w, down: Math.min(1, w) }; }
    const w = x.w == null ? 0.1 : Math.max(0, Number(x.w) || 0), f = (v) => (v == null ? w : Math.max(0, Number(v) || 0));
    return { up: f(x.up), down: Math.min(1, f(x.down)) };
  }
  function rangeT(o, sh) {
    const oT = Math.min(MAX_T, Math.max(MIN_T, toT(o) || MAX_T));
    let lo = Math.max(MIN_T, Math.ceil(oT * (1 - sh.down) - 1e-9)), hi = Math.min(MAX_T, Math.floor(oT * (1 + sh.up) + 1e-9));
    if (lo > hi) lo = hi = oT;
    return { oT, lo, hi };
  }

  // votes: [{ first, second, group? }] → 組み合わせごと・グループごとの票の数
  function groupVotes(votes, n, scope) {
    const by = {}, tot = {}, groups = {};
    (votes || []).forEach((v) => {
      const a = Number(v.first), b = Number(v.second);
      if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < n && b < n && a !== b)) return;
      const k = ekey(a, b), g = scope === 'store' ? String(v.group == null ? '_' : v.group) : '_';
      groups[g] = 1;
      const m = (by[k] = by[k] || {}); m[g] = (m[g] || 0) + 1;
      tot[k] = (tot[k] || 0) + 1;
    });
    return { by, tot, groups: Object.keys(groups) };
  }
  // 組み合わせが倍率 oddT のときの払い戻し（グループごと・合計）
  function payoutAt(byK, oddT) { const per = {}, a = amountT(oddT); let total = 0; Object.keys(byK).forEach((g) => { per[g] = byK[g] * a; total += per[g]; }); return { per, total }; }
  function objective(pay, target, scope, groups, cap, xt) {
    let d;
    if (scope === 'store') { d = 0; groups.forEach((g) => { d += Math.abs((pay.per[g] || 0) - target); }); }
    else d = Math.abs(pay.total - target);
    const all = pay.total + (xt || 0); // xt: 1 台で番号が多いスマホの票の当選額（上限にだけ数える。2026-10-27）
    if (cap > 0 && all > cap) d += 1e12 + all; // 上限超えはほかに候補があれば選ばない
    return d;
  }
  // 範囲 [lo, hi] の倍率を、当選額が変わる区切りごとに 1 つずつ（その区切りの中で元の倍率 oT に一番近い値）。当選額は 1.0 倍ごとにしか変わらないので、最大 1,000 個
  function levelsOf(r) {
    const out = [], L0 = Math.ceil(r.lo / 10), L1 = Math.ceil(r.hi / 10);
    for (let L = L0; L <= L1; L++) { const a = Math.max(r.lo, (L - 1) * 10 + 1), b = Math.min(r.hi, L * 10); if (a > b) continue; out.push(Math.min(b, Math.max(a, r.oT))); }
    return out;
  }
  // 抽選の重み: 自然に起きやすさ（comboProb）。なければ倍率から（0.85 ÷ 倍率）
  function weightOf(input, k) { const p = input.comboProb && Number(input.comboProb[k]); if (p > 0 && Number.isFinite(p)) return p; const o = input.exacta && Number(input.exacta[k]); return 0.85 / Math.max(1, o || 999); }
  function lottery(list, input, label) {
    if (list.length === 1) return list[0];
    const rnd = mulberry(hash(label, input.seed >>> 0)), wts = list.map((c) => Math.max(1e-9, weightOf(input, c.combo)));
    let x = rnd() * wts.reduce((a, b) => a + b, 0);
    for (let k = 0; k < list.length; k++) { x -= wts[k]; if (x < 0) return list[k]; }
    return list[list.length - 1];
  }
  const allKeys = (n) => { const o = []; for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) o.push(ekey(a, b)); return o; };

  /* 勝ちの組み合わせとその確定倍率を選ぶ
     input: { exacta: { 'a-b': 倍率 }, comboProb?: { 'a-b': 確率 }, n?: 6, votes: [{ first, second, group? }], extra?: [{ first, second, group? }]（1 台で番号が多いスマホの票。2026-10-27）, target, scope: 'all'|'store', w?, up?, down?, bandBelow, bandAbove, cap, seed }
     返り値: { combo, first, second, comboOdds, payout, payoutHeavy?（多いスマホの票の当選額）, perGroup, dist, overCap, noWinner, reason, cands, target, scope, band }
     reason: 'band' | 'target' | 'cap_nowin'（上限のため票のない組み合わせ＝当たりなし）| 'cap_conflict' | 'nobody'（票なし＝自然の結果。combo は null）| 'heavy_only'（多いスマホの票だけ＝起きやすさで抽選） */
  function chooseCombo(input) {
    const ex = input.exacta || {}, n = input.n || 6, sh = shiftOf(input), target = Math.max(0, Math.floor(input.target || 0));
    const scope = input.scope === 'store' ? 'store' : 'all', cap = Math.max(0, Math.floor(input.cap || 0));
    const bw = (v) => Math.min(0.5, Math.max(0, v == null ? 0.2 : Number(v) || 0)), below = bw(input.bandBelow), above = bw(input.bandAbove);
    const useBand = (below > 0 || above > 0) && target > 0, lo = target * (1 - below) - 1e-9, hi = target * (1 + above) + 1e-9;
    const g = groupVotes(input.votes, n, scope), cands = [];
    const xg = groupVotes(input.extra, n, scope), hasX = Object.keys(xg.tot).length > 0, xAt = (k, t) => (xg.tot[k] || 0) * amountT(t); // 1 台で番号が多いスマホの票（上限にだけ数える）
    const mk = (b) => b && { t: b.t, d: b.d, pay: b.pay, xt: b.xt };
    Object.keys(g.tot).sort().forEach((k) => {
      const r = rangeT(ex[k], sh);
      let best = null, each = null, sum = null;
      const better = (cur, t, d) => !cur || d < cur.d || (d === cur.d && Math.abs(t - r.oT) < Math.abs(cur.t - r.oT));
      levelsOf(r).forEach((t) => {
        const pay = payoutAt(g.by[k], t), xt = xAt(k, t), d = objective(pay, target, scope, g.groups, cap, xt);
        if (better(best, t, d)) best = { t, d, pay, xt };
        if (!useBand) return;
        if (scope !== 'store') { if (pay.total >= lo && pay.total <= hi && better(each, t, d)) each = { t, d, pay, xt }; return; }
        let all = true, short = 0, over = 0;
        g.groups.forEach((gg) => { const v = pay.per[gg] || 0; if (v < lo || v > hi) all = false; if (v < target) short += target - v; else over += v - target; });
        if (all && better(each, t, d)) each = { t, d, pay, xt };
        const G = g.groups.length || 1; if (short / G <= target * below + 1e-9 && over / G <= target * above + 1e-9 && better(sum, t, d)) sum = { t, d, pay, xt };
      });
      const ab = parseKey(k);
      const c = { combo: k, first: ab[0], second: ab[1], votes: g.tot[k], oddT: best.t, odds: best.t / 10, payout: best.pay.total, perGroup: best.pay.per, dist: best.d, overCap: cap > 0 && best.pay.total + best.xt > cap, _each: mk(each), _sum: mk(sum) };
      if (hasX) { c.heavy = xg.tot[k] || 0; c.payoutHeavy = best.xt; }
      cands.push(c);
    });
    const band = { below, above, lo: Math.ceil(lo), hi: Math.floor(hi), combos: [], how: null };
    const baseT = (k) => Math.min(MAX_T, Math.max(MIN_T, toT(ex[k]) || MAX_T));
    const asPick = (k) => { const ab = parseKey(k); return { combo: k, first: ab[0], second: ab[1] }; };
    if (!cands.length && hasX) { // 多いスマホの票だけ: 必ず当てることはしない。30 通りから起きやすさで抽選（上限を超える組み合わせは選ばない。全部超えるなら多いスマホの票が無い組み合わせ）
      const keys = allKeys(n), okK = keys.filter((k) => !(cap > 0 && xAt(k, baseT(k)) > cap)), freeK = keys.filter((k) => !xg.tot[k]);
      const pick = lottery((okK.length ? okK : freeK.length ? freeK : keys).map(asPick), input, 'heavy');
      return { combo: pick.combo, first: pick.first, second: pick.second, comboOdds: baseT(pick.combo) / 10, payout: 0, payoutHeavy: xAt(pick.combo, baseT(pick.combo)), perGroup: {}, dist: target, overCap: false, noWinner: !xg.tot[pick.combo], reason: 'heavy_only', cands, target, scope, band };
    }
    if (!cands.length) return { combo: null, first: null, second: null, comboOdds: null, payout: 0, perGroup: {}, noWinner: false, reason: 'nobody', cands, target, scope, band };
    const over = (b) => cap > 0 && b.pay.total + (b.xt || 0) > cap, allOver = cands.every((c) => c.overCap);
    // 上限が強い（2026-10-20 オーナー決定）: 票の入ったどの組み合わせも上限を超えるなら、票の入っていない組み合わせ（当たりなし）
    if (allOver) {
      const voted = new Set(cands.map((c) => c.combo)), free0 = allKeys(n).filter((k) => !voted.has(k));
      // 多いスマホの票がある組み合わせは後回し（その票だけで上限を超えるものは選ばない）。多いスマホの票が無ければ今までと同じ
      const freeX = hasX ? free0.filter((k) => !xg.tot[k]) : free0, free = (freeX.length ? freeX : free0.filter((k) => !(cap > 0 && xAt(k, baseT(k)) > cap))).map(asPick);
      cands.forEach((c) => { c.inBand = false; delete c._each; delete c._sum; });
      if (free.length) {
        const pick = lottery(free, input, 'nowin');
        return { combo: pick.combo, first: pick.first, second: pick.second, comboOdds: baseT(pick.combo) / 10, payout: 0, payoutHeavy: hasX ? xAt(pick.combo, baseT(pick.combo)) : 0, perGroup: {}, dist: target, overCap: false, noWinner: !(hasX && xg.tot[pick.combo]), reason: 'cap_nowin', cands, target, scope, band };
      }
    }
    const pickBand = (key) => cands.filter((c) => c[key] && (allOver || !over(c[key])));
    let inB = [], key = null;
    if (useBand) {
      inB = pickBand('_each'); key = '_each'; band.how = inB.length ? (scope === 'store' ? 'store_each' : 'all') : null;
      if (!inB.length && scope === 'store') { inB = pickBand('_sum'); key = '_sum'; if (inB.length) band.how = 'store_avg'; }
    }
    cands.forEach((c) => {
      c.inBand = inB.indexOf(c) >= 0;
      if (c.inBand) { const b = c[key]; Object.assign(c, { oddT: b.t, odds: b.t / 10, payout: b.pay.total, perGroup: b.pay.per, dist: b.d, overCap: over(b) }); if (hasX) c.payoutHeavy = b.xt; }
      delete c._each; delete c._sum;
    });
    band.combos = inB.map((c) => c.combo);
    let pick, reason;
    // 多いスマホの票が無い組み合わせを先に（それが 1 つも無い・全部上限を超えるときだけ、ある組み合わせから）。多いスマホの票が無ければ今までと同じ
    const clean = (list) => { if (!hasX) return list; const c = list.filter((x) => !xg.tot[x.combo] && !x.overCap); return c.length ? c : list; };
    if (inB.length) { pick = lottery(clean(inB), input, 'band'); reason = 'band'; }
    else {
      const pool = clean(cands), minD = Math.min.apply(null, pool.map((c) => c.dist));
      pick = lottery(pool.filter((c) => c.dist === minD), input, 'tie');
      reason = 'target';
    }
    if (pick.overCap) reason = 'cap_conflict';
    const out = { combo: pick.combo, first: pick.first, second: pick.second, comboOdds: pick.odds, payout: pick.payout, perGroup: pick.perGroup, dist: pick.dist, overCap: pick.overCap, noWinner: false, reason, cands, target, scope, band };
    if (hasX) out.payoutHeavy = pick.payoutHeavy || 0;
    return out;
  }

  /* 確定倍率（30 通り）: 勝ちの組み合わせはずらした値。ほかは見かけの払い戻し率（Σ1/倍率）がそろうよう同じ向きに動かし、[1 − down, 1 + up] の中で小さなゆらぎ（最大 ±3%）を足す。
     どれも 1.0〜999.9 倍。w は数（±w）か { up, down } */
  function shapeExacta(exacta, combo, comboOdds, w, seed) {
    const keys = Object.keys(exacta || {}).sort(), rnd = mulberry(hash('exodds', seed >>> 0)), sh = shiftOf(w), out = {};
    const inv = (o) => 1 / Math.max(MIN_T / 10, Number(o) || MAX_T / 10);
    const S = keys.reduce((a, k) => a + inv(exacta[k]), 0);
    let gmul = 1;
    if (combo && exacta[combo] != null) {
      const ow = exacta[combo], nw = comboOdds == null ? ow : comboOdds, rest = S - inv(ow), restNew = S - inv(nw);
      if (rest > 1e-9 && restNew > 1e-9) gmul = rest / restNew;
      gmul = Math.min(1 + sh.up, Math.max(1 - sh.down, gmul));
    }
    keys.forEach((k) => {
      if (k === combo) { out[k] = Math.min(MAX_T, Math.max(MIN_T, toT(comboOdds == null ? exacta[k] : comboOdds))) / 10; return; }
      const r = rangeT(exacta[k], sh), j = rnd() * 2 - 1;
      let m = gmul * (1 + j * Math.min(0.1, j > 0 ? sh.up : sh.down) * 0.3);
      m = Math.min(1 + sh.up, Math.max(1 - sh.down, m));
      out[k] = Math.min(r.hi, Math.max(r.lo, Math.round(r.oT * m))) / 10;
    });
    return out;
  }

  /* 1 着 first・2 着 second の順でゴールする seed を探す（first が null なら最初の seed の自然な結果）。
     maxTries 回までは「自然にその順になる」seed。なければ試した中で入れ替えが一番少ない seed を使い、着順を [first, second, 残りは自然の順] にする
     （テレビは Engine.replayRun(race, seed, { order }) で同じ入れ替えを再現する。入れ替えはゴールの近くで、並んでいるところから。js/engine.js の forceOrder）。
     返り値 { seed, order, natural, tries, swapsNeeded } */
  function findSeedPair(Engine, race, first, second, baseSeed, maxTries) {
    maxTries = maxTries || 300;
    let best = null;
    for (let k = 0; k < maxTries; k++) {
      const seed = hash('run', baseSeed >>> 0, k);
      if (first == null) { const rec = Engine.recordRun(race, seed, true); return { seed, order: rec.order, natural: true, tries: 1, swapsNeeded: 0 }; }
      const rec = Engine.recordRun(race, seed, true), order = rec.order;
      if (order[0] === first && order[1] === second) return { seed, order, natural: true, tries: k + 1, swapsNeeded: 0 };
      const i1 = order.indexOf(first), i2 = order.indexOf(second), j2 = i2 < i1 ? i2 + 1 : i2, need = i1 + j2 - 1;
      const gap = Math.abs(rec.finish[first] - rec.finish[order[0]]) + Math.abs(rec.finish[second] - rec.finish[order[1]]);
      const score = need * 10 + gap;
      if (!best || score < best.score) best = { seed, order, score, need };
    }
    const rest = best.order.filter((h) => h !== first && h !== second);
    return { seed: best.seed, order: [first, second].concat(rest), natural: false, tries: maxTries, swapsNeeded: best.need };
  }

  /* まとめて: 結果を決める。race は Engine のレース（horses, dist, weather, surface, tune）
     input は chooseCombo と同じ（exacta 省略時は race.exacta）。返り値 { first, second, combo, comboOdds, order, finalExacta, seed, natural, tries, payout, perGroup, reason, cands, band, target, scope, noWinner } */
  function resolveExacta(Engine, race, input) {
    input = Object.assign({ exacta: race.exacta, seed: 1, n: (race.horses || []).length || 6 }, input);
    const ch = chooseCombo(input), baseSeed = hash('race', input.seed >>> 0);
    const fs = findSeedPair(Engine, race, ch.first, ch.second, baseSeed, input.maxTries);
    const first = fs.order[0], second = fs.order[1], combo = ekey(first, second);
    const comboOdds = ch.combo == null ? Math.min(MAX_T, Math.max(MIN_T, toT(input.exacta[combo]) || MAX_T)) / 10 : ch.comboOdds;
    const finalExacta = shapeExacta(input.exacta, combo, comboOdds, shiftOf(input), input.seed);
    return { first, second, combo, comboOdds: finalExacta[combo], order: fs.order, finalExacta, seed: fs.seed, natural: fs.natural, tries: fs.tries, swapsNeeded: fs.swapsNeeded,
      payout: ch.combo == null ? 0 : ch.payout, payoutHeavy: ch.payoutHeavy || 0, perGroup: ch.perGroup || {}, reason: ch.reason, target: ch.target, scope: ch.scope, cands: ch.cands, band: ch.band, noWinner: !!ch.noWinner };
  }

  return { chooseCombo, shapeExacta, findSeedPair, resolveExacta, groupVotes, weightOf, shiftOf, rangeT, levelsOf, payFor, amountT, stakePayout, perTicket, roundPay, ekey, parseKey, allKeys,
    PAY_STEP, STAKE, UNIT: STAKE, hash, mulberry, MIN_T, MAX_T, toT };
});
