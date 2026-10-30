/* casa DERBY 結果の決定（サーバーとブラウザの両方で動く。DOM なし）: window.Outcome
   v4（2026-10-21 オーナー決定・仕様書_v4_大改修.md）: 投票は 2 連単だけ（1 着・2 着を順番どおり。6 頭で 30 通り）。1 人 1 票＝100pt。
   - 当選額 ＝ 100pt × 2 連単の倍率 を 100pt 単位に切り上げ（例 12.4 倍 → 1,240 → 1,300pt）。payFor・PAY_STEP。
     倍率は 0.1 刻みなので、当選額が変わるのは倍率が 1.0 上がるごと（12.1〜13.0 倍はどれも 1,300pt）。
   - 裏の決め方（今までの単勝の決め方を 30 通りに広げたもの）:
     票の入った組み合わせごとに「確定倍率をずらし幅の中のどれかにしたとき」の払い戻し（票の数 × 当選額）を出し、
     当たりの幅（目標 ×（1 − bandBelow）〜 目標 ×（1 + bandAbove））に入る組み合わせから、自然に起きやすさ（comboProb）で重み付きの抽選（reason 'band'）。
     幅に入る組み合わせがなければ一番近いもの（reason 'target'。同点は起きやすさで抽選）。＝必ず誰かは当てる（票の入った組み合わせから選ぶ）。
   - 表示の倍率が先（2026-10-29 オーナー「表示オッズ優先しつつ、配当を調整する感じで、ぶれる仕組みに」）: 幅に入れられる組み合わせは、幅に入る倍率のうち
     締切前に見せた倍率（oT）に一番近いものにする（見せた倍率のままで幅に入るなら動かさない。動かすのは幅に入れるのに要る分だけ）。
     以前は幅の中でも目標に一番近い倍率にしていた＝毎レースほぼ目標ちょうどになり、倍率も見せた値から動いていた。幅に入らないときの「一番近いもの」と上限の決まりは今までと同じ。
   - 配当のぶれ（input.spread ＝ 調整の payoutSpread。0〜0.8）: レースごとに目標に掛ける数 f を seed から決める（同じ seed なら必ず同じ＝決める係のテレビと模擬クラウドが同じ答え）。
     f は 1 − spread 〜 1 + spread ÷ 4 のどれか（0.3 なら 0.70〜1.075）。当たりの幅・一番近いものは「目標 × f」（targetEff）のまわりで見る。上限はそのまま一番強い。
     spread が 0 なら f ＝ 1（目標ちょうどのまわり）。返り値の target は時刻表の目標のまま（集計の 目標と当選額 を比べられるように）。
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
   - 直近の当たり端末の票（2026-10-31 オーナー「直近 10 レースで当たった人が重複しないように」。input.block。v2/core.js の recentWinners）: 守る決まり（多いスマホの票と違って必ず）。
     その票が 1 つでも入った組み合わせは候補から外す（幅・目標・上限の当たりなしのどれでも選ばない）。残りの組み合わせで今までどおり決める。
     残りにふつうの票が無ければ、その票が無い組み合わせから起きやすさで抽選（当たりなしもある。reason 'norepeat'。上限を超える組み合わせは選ばない）。
     30 通り全部にその票があるときだけ（ほぼ起きない）、上限を超えない中でその票がいちばん少ない組み合わせ（reason 'norepeat_conflict'）。返り値 blocked: 外した組み合わせ。block が空なら今までと同じ答え。
   - 参加の多い店を先に（2026-10-31 オーナー「参加人数が多い店舗から当たりを出す」。input.favor ＝ 店の id。v2/core.js の bigStoreOf）: ほかの決まり（上限 > 直近の当たり端末 > 幅・目標）で
     残った候補（幅に入る組み合わせ・幅が無ければ目標にいちばん近い組み合わせ）の中に、その店のふつうの票が入った組み合わせがあれば、その中から抽選。無ければ今までどおり。
     返り値 favor: { group, applied }（applied ＝ その店の票が入った組み合わせから選んだ）。favor が無ければ今までと同じ答え。
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
     input: { exacta: { 'a-b': 倍率 }, comboProb?: { 'a-b': 確率 }, n?: 6, votes: [{ first, second, group? }], extra?: [{ first, second, group? }]（1 台で番号が多いスマホの票。2026-10-27）,
              block?: [{ first, second, group? }]（直近の当たり端末の票。2026-10-31）, favor?: 店の id（参加の多い店。2026-10-31）, target, scope: 'all'|'store', w?, up?, down?, bandBelow, bandAbove, cap, seed }
     返り値: { combo, first, second, comboOdds, payout, payoutHeavy?（多いスマホの票の当選額）, perGroup, dist, overCap, noWinner, reason, cands, target（時刻表の目標）, targetEff（目標 × f。寄せた額）, spreadF（f）, scope, band,
              blocked?（block があるとき: 外した組み合わせ）, favor?（favor があるとき: { group, applied }） }
     input.spread: 配当のぶれ（0〜0.8。省略・0 ならぶれなし）
     reason: 'band' | 'target' | 'cap_nowin'（上限のため票のない組み合わせ＝当たりなし）| 'cap_conflict' | 'nobody'（票なし＝自然の結果。combo は null）| 'heavy_only'（多いスマホの票だけ＝起きやすさで抽選）
             | 'norepeat'（ふつうの票の組み合わせが全部、直近の当たり端末の票で外れた＝その票の無い組み合わせから起きやすさで抽選）| 'norepeat_conflict'（30 通り全部にその票） */
  /* 配当のぶれ（2026-10-29）: レースごとに目標に掛ける数 f（1 − spread 〜 1 + spread ÷ 4）。spread は 0〜0.8 に丸める。seed が同じなら同じ f */
  const SPREAD_MAX = 0.8;
  function spreadOf(v) { const x = Number(v); return Number.isFinite(x) ? Math.min(SPREAD_MAX, Math.max(0, x)) : 0; }
  function spreadFactor(spread, seed) {
    const s = spreadOf(spread); if (!s) return 1;
    const u = mulberry(hash('spread', seed >>> 0))();
    return Math.round((1 - s + u * s * 1.25) * 10000) / 10000;
  }
  function chooseCombo(input) {
    const ex = input.exacta || {}, n = input.n || 6, sh = shiftOf(input), target0 = Math.max(0, Math.floor(input.target || 0));
    const spreadF = spreadFactor(input.spread, input.seed), target = Math.round(target0 * spreadF); // target: このレースで寄せる額（目標 × f）。target0: 時刻表の目標
    const scope = input.scope === 'store' ? 'store' : 'all', cap = Math.max(0, Math.floor(input.cap || 0));
    const bw = (v) => Math.min(0.5, Math.max(0, v == null ? 0.2 : Number(v) || 0)), below = bw(input.bandBelow), above = bw(input.bandAbove);
    const useBand = (below > 0 || above > 0) && target > 0, lo = target * (1 - below) - 1e-9, hi = target * (1 + above) + 1e-9;
    const g = groupVotes(input.votes, n, scope), cands = [];
    const xg = groupVotes(input.extra, n, scope), hasX = Object.keys(xg.tot).length > 0, xAt = (k, t) => (xg.tot[k] || 0) * amountT(t); // 1 台で番号が多いスマホの票（上限にだけ数える）
    const bg = groupVotes(input.block, n, scope), hasB = Object.keys(bg.tot).length > 0, blocked = (k) => hasB && !!bg.tot[k]; // 直近の当たり端末の票（2026-10-31。入った組み合わせは選ばない）
    const favor = input.favor != null && input.favor !== '' ? String(input.favor) : null, fv = favor ? groupVotes(input.votes, n, 'store') : null, favInfo = favor ? { group: favor, applied: false } : null; // 参加の多い店（2026-10-31）
    const fin = (o) => { if (hasB) o.blocked = Object.keys(bg.tot).sort(); if (favInfo) o.favor = favInfo; return o; }; // block・favor が無ければ今までとまったく同じ返り値
    const mk = (b) => b && { t: b.t, d: b.d, pay: b.pay, xt: b.xt };
    Object.keys(g.tot).sort().forEach((k) => {
      if (blocked(k)) return; // 直近の当たり端末の票が入った組み合わせは候補にしない
      const r = rangeT(ex[k], sh);
      let best = null, each = null, sum = null;
      const better = (cur, t, d) => !cur || d < cur.d || (d === cur.d && Math.abs(t - r.oT) < Math.abs(cur.t - r.oT));
      // 幅の中の倍率の選び方（2026-10-29 表示の倍率が先）: 上限を超えないもの → 見せた倍率 oT に近いもの → 目標に近いもの（それも同じなら低い倍率）
      const capOver = (d) => (d >= 1e12 ? 1 : 0);
      const nearer = (cur, t, d) => { if (!cur) return true; const a = capOver(d), b = capOver(cur.d); if (a !== b) return a < b; const x = Math.abs(t - r.oT), y = Math.abs(cur.t - r.oT); return x < y || (x === y && (d < cur.d || (d === cur.d && t < cur.t))); };
      levelsOf(r).forEach((t) => {
        const pay = payoutAt(g.by[k], t), xt = xAt(k, t), d = objective(pay, target, scope, g.groups, cap, xt);
        if (better(best, t, d)) best = { t, d, pay, xt };
        if (!useBand) return;
        if (scope !== 'store') { if (pay.total >= lo && pay.total <= hi && nearer(each, t, d)) each = { t, d, pay, xt }; return; }
        let all = true, short = 0, over = 0;
        g.groups.forEach((gg) => { const v = pay.per[gg] || 0; if (v < lo || v > hi) all = false; if (v < target) short += target - v; else over += v - target; });
        if (all && nearer(each, t, d)) each = { t, d, pay, xt };
        const G = g.groups.length || 1; if (short / G <= target * below + 1e-9 && over / G <= target * above + 1e-9 && nearer(sum, t, d)) sum = { t, d, pay, xt };
      });
      const ab = parseKey(k);
      const c = { combo: k, first: ab[0], second: ab[1], votes: g.tot[k], oddT: best.t, odds: best.t / 10, payout: best.pay.total, perGroup: best.pay.per, dist: best.d, overCap: cap > 0 && best.pay.total + best.xt > cap, _each: mk(each), _sum: mk(sum) };
      if (hasX) { c.heavy = xg.tot[k] || 0; c.payoutHeavy = best.xt; }
      cands.push(c);
    });
    const band = { below, above, lo: Math.ceil(lo), hi: Math.floor(hi), combos: [], how: null };
    const baseT = (k) => Math.min(MAX_T, Math.max(MIN_T, toT(ex[k]) || MAX_T));
    const asPick = (k) => { const ab = parseKey(k); return { combo: k, first: ab[0], second: ab[1] }; };
    if (!cands.length && (hasX || hasB)) { // 多いスマホの票だけ: 必ず当てることはしない。30 通りから起きやすさで抽選（上限を超える組み合わせは選ばない。全部超えるなら多いスマホの票が無い組み合わせ）
      // 直近の当たり端末（2026-10-31）: ふつうの票の組み合わせが全部外れた → その端末の票が無い組み合わせから同じように抽選（reason 'norepeat'。当たりなしもある）
      const keys = allKeys(n).filter((k) => !blocked(k));
      if (!keys.length) { // 30 通り全部に直近の当たり端末の票（ほぼ起きない）: 上限を超えない中で、その票がいちばん少ない組み合わせ（その端末も当たる。上限がいちばん強い）
        const all = allKeys(n), payAll = (k) => ((g.tot[k] || 0) + (bg.tot[k] || 0)) * amountT(baseT(k)) + xAt(k, baseT(k));
        const okA = all.filter((k) => !(cap > 0 && payAll(k) > cap)), pool = okA.length ? okA : all, minB = Math.min.apply(null, pool.map((k) => bg.tot[k]));
        const pk = lottery(pool.filter((k) => bg.tot[k] === minB).map(asPick), input, 'norepeat_conflict'), pt = baseT(pk.combo);
        return fin({ combo: pk.combo, first: pk.first, second: pk.second, comboOdds: pt / 10, payout: ((g.tot[pk.combo] || 0) + bg.tot[pk.combo]) * amountT(pt), payoutHeavy: xAt(pk.combo, pt), perGroup: {}, dist: target, overCap: cap > 0 && payAll(pk.combo) > cap, noWinner: false, reason: 'norepeat_conflict', cands, target: target0, targetEff: target, spreadF, scope, band });
      }
      const okK = keys.filter((k) => !(cap > 0 && xAt(k, baseT(k)) > cap)), freeK = keys.filter((k) => !xg.tot[k]);
      const pick = lottery((okK.length ? okK : freeK.length ? freeK : keys).map(asPick), input, hasB ? 'norepeat' : 'heavy');
      return fin({ combo: pick.combo, first: pick.first, second: pick.second, comboOdds: baseT(pick.combo) / 10, payout: 0, payoutHeavy: xAt(pick.combo, baseT(pick.combo)), perGroup: {}, dist: target, overCap: false, noWinner: !xg.tot[pick.combo], reason: hasB ? 'norepeat' : 'heavy_only', cands, target: target0, targetEff: target, spreadF, scope, band });
    }
    if (!cands.length) return fin({ combo: null, first: null, second: null, comboOdds: null, payout: 0, perGroup: {}, noWinner: false, reason: 'nobody', cands, target: target0, targetEff: target, spreadF, scope, band });
    const over = (b) => cap > 0 && b.pay.total + (b.xt || 0) > cap, allOver = cands.every((c) => c.overCap);
    // 上限が強い（2026-10-20 オーナー決定）: 票の入ったどの組み合わせも上限を超えるなら、票の入っていない組み合わせ（当たりなし）
    if (allOver) {
      const voted = new Set(cands.map((c) => c.combo)), free0 = allKeys(n).filter((k) => !voted.has(k) && !blocked(k)); // 直近の当たり端末の票が入った組み合わせも選ばない（2026-10-31）
      // 多いスマホの票がある組み合わせは後回し（その票だけで上限を超えるものは選ばない）。多いスマホの票が無ければ今までと同じ
      const freeX = hasX ? free0.filter((k) => !xg.tot[k]) : free0, free = (freeX.length ? freeX : free0.filter((k) => !(cap > 0 && xAt(k, baseT(k)) > cap))).map(asPick);
      cands.forEach((c) => { c.inBand = false; delete c._each; delete c._sum; });
      if (free.length) {
        const pick = lottery(free, input, 'nowin');
        return fin({ combo: pick.combo, first: pick.first, second: pick.second, comboOdds: baseT(pick.combo) / 10, payout: 0, payoutHeavy: hasX ? xAt(pick.combo, baseT(pick.combo)) : 0, perGroup: {}, dist: target, overCap: false, noWinner: !(hasX && xg.tot[pick.combo]), reason: 'cap_nowin', cands, target: target0, targetEff: target, spreadF, scope, band });
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
    // 参加の多い店（2026-10-31）: 残った候補の中に、その店のふつうの票が入った組み合わせがあればその中から（無ければそのまま＝今までと同じ）
    const fav = (list) => { if (!favor) return list; const f = list.filter((x) => fv.by[x.combo] && fv.by[x.combo][favor]); if (!f.length) return list; favInfo.applied = true; return f; };
    if (inB.length) { pick = lottery(fav(clean(inB)), input, 'band'); reason = 'band'; }
    else {
      const pool = clean(cands), minD = Math.min.apply(null, pool.map((c) => c.dist));
      pick = lottery(fav(pool.filter((c) => c.dist === minD)), input, 'tie');
      reason = 'target';
    }
    if (pick.overCap) reason = 'cap_conflict';
    const out = { combo: pick.combo, first: pick.first, second: pick.second, comboOdds: pick.odds, payout: pick.payout, perGroup: pick.perGroup, dist: pick.dist, overCap: pick.overCap, noWinner: false, reason, cands, target: target0, targetEff: target, spreadF, scope, band };
    if (hasX) out.payoutHeavy = pick.payoutHeavy || 0;
    return fin(out);
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
    const out = { first, second, combo, comboOdds: finalExacta[combo], order: fs.order, finalExacta, seed: fs.seed, natural: fs.natural, tries: fs.tries, swapsNeeded: fs.swapsNeeded,
      payout: ch.combo == null ? 0 : ch.payout, payoutHeavy: ch.payoutHeavy || 0, perGroup: ch.perGroup || {}, reason: ch.reason, target: ch.target, targetEff: ch.targetEff, spreadF: ch.spreadF, scope: ch.scope, cands: ch.cands, band: ch.band, noWinner: !!ch.noWinner };
    if (ch.blocked) out.blocked = ch.blocked; // 直近の当たり端末の票で外した組み合わせ（2026-10-31）
    if (ch.favor) out.favor = ch.favor; // 参加の多い店（2026-10-31）
    return out;
  }

  return { chooseCombo, spreadFactor, spreadOf, SPREAD_MAX, shapeExacta, findSeedPair, resolveExacta, groupVotes, weightOf, shiftOf, rangeT, levelsOf, payFor, amountT, stakePayout, perTicket, roundPay, ekey, parseKey, allKeys,
    PAY_STEP, STAKE, UNIT: STAKE, hash, mulberry, MIN_T, MAX_T, toT };
});
