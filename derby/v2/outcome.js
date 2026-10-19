/* casa DERBY v2 結果の決定（サーバーとブラウザの両方で動く。DOM なし）
   DESIGN.md 3 章:
   - 賭けのある馬ごとに「オッズを ±w の中でずらして、払い戻しを設定額（target）に一番近づけたとき」の払い戻しとずれを出す
   - 当たりの幅（2026-10-16 オーナー決定「幅の中から抽選」）: bandBelow＝目標より少なくてよい幅、bandAbove＝多くてよい幅（初期どちらも 0.2）。
     オッズを ±w の中のどれかにしたとき 払い戻しが target ×（1 − bandBelow）〜 target ×（1 + bandAbove）に入る馬を候補にし、
     候補の中から元の勝率（winProb。なければオッズから）で重み付きの抽選（reason 'band'）。その馬のオッズは、幅の中で一番 target に近くなる値。
     店ごと（scope 'store'）は「賭けのあるどの店も幅に入る」馬（how 'store_each'）。そういう馬がいなければ
     「各店の足りない分の平均 ≦ target × bandBelow かつ 多い分の平均 ≦ target × bandAbove」の馬（how 'store_avg'。
     合計で比べると、1 店でも幅の外ならその店だけで超えてしまい意味がないので平均。店どうしで多い・少ないが打ち消し合うことはない）
   - 幅に入る馬がいない・幅が両方 0 のときは、一番近い馬を 1 着にする（reason 'target'。同点は元の勝率で重み付きの抽選）
     （必ず誰かは当たる＝賭けのある馬からしか選ばない。上限を超える馬は、ほかに候補があれば選ばない）
   - 賭けが 1 頭もいなければ通常の抽選（seed の走りの自然な 1 着）
   - 他の馬のオッズは、見かけの払い戻し率が大きく崩れないよう ±w の中で少しだけ動かす
   - ずらし幅は上下別々にできる（2026-10-16）: up＝見せていたオッズより上げてよい幅、down＝下げてよい幅。範囲は [オッズ ×（1 − down）, オッズ ×（1 + up）]。
     up・down がなければ w を両方に使う（以前の ±w と同じ結果）。両方 0 なら確定オッズ＝見せていたオッズ（設定額への寄せは 1 着の選び方だけ）
   - 1 着が winner になる走りの seed を探す（Engine.replayOrder）。見つからなければ軌跡の入れ替え（Engine.replayRun の order）で必ずその着順にする
   オッズは 0.1 刻み。払い戻しは「額」（2026-10-16 オーナー決定: 1 枚 = 100。表示は額だけ）: 1 件 = 枚数 × オッズ × 100 ＝ 枚数 × (オッズ×10) × 10。
   0.1 刻みなので必ず整数（切り捨てなし・誤差なし）。target・cap も額。以前は「枚数 × オッズ の小数切り捨て（枚）」だった。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Outcome = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_T = 11, MAX_T = 9990; // オッズの下限・上限（0.1 倍単位: 1.1〜999.0）

  function mulberry(seed) { let a = (seed >>> 0) || 0x9e3779b9; return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash() { let h = 2166136261 >>> 0; for (let k = 0; k < arguments.length; k++) { const s = String(arguments[k]); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } h ^= 0x2c; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  const toT = (o) => Math.round(o * 10);
  const UNIT = 100; // 1 枚の額
  /* 当選額の切り上げ（2026-10-20 オーナー決定「当選額は 10 の位で切り上げて渡す」例 243 → 250・240 → 240）: 1 件（券 1 枚の当たり）ごとに 10 の倍数へ切り上げる。
     渡す額＝集計の額＝結果の決め方（目標の幅・上限の判定）に使う額を、全部この切り上げた額にそろえる（実際に渡した額で集計が合うように）。
     今の決まり（オッズ 0.1 刻み・1 枚 = 100）では元から 10 の倍数なので、数は変わらない（オッズの刻みや 1 枚の額を変えたときの守り） */
  const PAY_STEP = 10;
  const roundPay = (v) => { const x = Math.round((Number(v) || 0) * 1000) / 1000; return x > 0 ? Math.ceil(x / PAY_STEP) * PAY_STEP : 0; };
  const amountT = (count, oddT) => roundPay(count * oddT * (UNIT / 10)); // 1 件の払い戻し（額。10 の倍数に切り上げ）

  // stakes: [{ horse, count, group? }] → 馬ごと・グループごとの一覧
  function groupStakes(stakes, n, scope) {
    const by = Array.from({ length: n }, () => ({})), tot = new Array(n).fill(0), groups = {};
    (stakes || []).forEach((s) => {
      const c = Math.floor(Number(s.count) || 0), h = s.horse;
      if (c <= 0 || !(h >= 0 && h < n)) return;
      const g = scope === 'store' ? String(s.group == null ? '_' : s.group) : '_';
      groups[g] = 1;
      (by[h][g] = by[h][g] || []).push(c);
      tot[h] += c;
    });
    return { by, tot, groups: Object.keys(groups) };
  }

  // 馬 h が 1 着でオッズ oddT のときの払い戻し（グループごと・合計）
  function payoutAt(byH, oddT) {
    const per = {}; let total = 0;
    Object.keys(byH).forEach((g) => { let s = 0; byH[g].forEach((c) => { s += amountT(c, oddT); }); per[g] = s; total += s; });
    return { per, total };
  }
  function objective(pay, target, scope, groups, cap) {
    let d;
    if (scope === 'store') { d = 0; groups.forEach((g) => { d += Math.abs((pay.per[g] || 0) - target); }); }
    else d = Math.abs(pay.total - target);
    if (cap > 0 && pay.total > cap) d += 1e12 + pay.total; // 上限超えはほかに候補があれば選ばない
    return d;
  }
  // ずらし幅 { up, down }: input.up / input.down、なければ w（初期 0.1）を両方に
  function shiftOf(x) {
    if (typeof x === 'number' || x == null) { const w = x == null ? 0.1 : Math.max(0, Number(x) || 0); return { up: w, down: w }; }
    const w = x.w == null ? 0.1 : Math.max(0, Number(x.w) || 0), f = (v) => (v == null ? w : Math.max(0, Number(v) || 0));
    return { up: f(x.up), down: Math.min(0.99, f(x.down)) };
  }
  function rangeT(o, sh) {
    const oT = Math.min(MAX_T, Math.max(MIN_T, toT(o)));
    let lo = Math.max(MIN_T, Math.ceil(oT * (1 - sh.down) - 1e-9)), hi = Math.min(MAX_T, Math.floor(oT * (1 + sh.up) + 1e-9));
    if (lo > hi) lo = hi = oT;
    return { oT, lo, hi };
  }

  // 抽選の重み: 元の勝率（winProb）。なければ・0 ならオッズから（0.85 / オッズ）
  function weightOf(input, h) { const p = input.winProb && Number(input.winProb[h]); if (p > 0 && Number.isFinite(p)) return p; return 0.85 / Math.max(1.1, Number(input.odds[h]) || 999); }
  // list から重み付きの抽選（同じ seed ならいつも同じ）
  function lottery(list, input, label) {
    if (list.length === 1) return list[0];
    const rnd = mulberry(hash(label, input.seed >>> 0)), wts = list.map((c) => Math.max(1e-6, weightOf(input, c.horse)));
    let x = rnd() * wts.reduce((a, b) => a + b, 0);
    for (let k = 0; k < list.length; k++) { x -= wts[k]; if (x < 0) return list[k]; }
    return list[list.length - 1];
  }
  /* 1 着とその確定オッズを選ぶ
     input: { odds:[6], winProb?:[6], stakes:[{horse,count,group?}], target, scope:'all'|'store', w:0.1, up?, down?, bandBelow:0.2, bandAbove:0.2, cap:0, seed }
     返り値の reason: 'band'（幅の中から抽選）| 'target'（一番近い馬）| 'cap_conflict'（全部の馬が上限超え。必ず当たりを優先）| 'nobody'（賭けなし）
     band: { below, above, lo, hi, horses:[幅に入った候補], how:'all'|'store_each'|'store_avg'|null }。cands の各馬に inBand */
  function chooseWinner(input) {
    const odds = input.odds, n = odds.length, sh = shiftOf(input), target = Math.max(0, Math.floor(input.target || 0));
    const scope = input.scope === 'store' ? 'store' : 'all', cap = Math.max(0, Math.floor(input.cap || 0));
    const bw = (v) => Math.min(0.5, Math.max(0, v == null ? 0.2 : Number(v) || 0)), below = bw(input.bandBelow), above = bw(input.bandAbove);
    const useBand = (below > 0 || above > 0) && target > 0, lo = target * (1 - below) - 1e-9, hi = target * (1 + above) + 1e-9;
    const g = groupStakes(input.stakes, n, scope);
    const cands = [];
    const mk = (b) => b && { t: b.t, d: b.d, pay: b.pay };
    for (let h = 0; h < n; h++) {
      if (g.tot[h] <= 0) continue;
      const r = rangeT(odds[h], sh);
      let best = null, each = null, sum = null;
      const better = (cur, t, d) => !cur || d < cur.d || (d === cur.d && Math.abs(t - r.oT) < Math.abs(cur.t - r.oT));
      for (let t = r.lo; t <= r.hi; t++) {
        const pay = payoutAt(g.by[h], t), d = objective(pay, target, scope, g.groups, cap);
        if (better(best, t, d)) best = { t, d, pay };
        if (!useBand) continue;
        /* 幅の判定（オッズの範囲の全部の値で。いちばん近い値が幅の外でも、ほかの値なら入ることがある） */
        if (scope !== 'store') { if (pay.total >= lo && pay.total <= hi && better(each, t, d)) each = { t, d, pay }; continue; }
        let all = true, short = 0, over = 0;
        g.groups.forEach((gg) => { const v = pay.per[gg] || 0; if (v < lo || v > hi) all = false; if (v < target) short += target - v; else over += v - target; });
        if (all && better(each, t, d)) each = { t, d, pay };
        const G = g.groups.length || 1; if (short / G <= target * below + 1e-9 && over / G <= target * above + 1e-9 && better(sum, t, d)) sum = { t, d, pay };
      }
      cands.push({ horse: h, bet: g.tot[h], oddT: best.t, odds: best.t / 10, payout: best.pay.total, perGroup: best.pay.per, dist: best.d, overCap: cap > 0 && best.pay.total > cap, _each: mk(each), _sum: mk(sum) });
    }
    const band = { below, above, lo: Math.ceil(lo), hi: Math.floor(hi), horses: [], how: null };
    if (!cands.length) return { winner: null, reason: 'nobody', cands, target, scope, band };
    /* 幅の中の候補（上限を超える馬は、超えない馬が 1 頭でもいれば外す） */
    const over = (b) => cap > 0 && b.pay.total > cap, allOver = cands.every((c) => c.overCap);
    const pickBand = (key) => cands.filter((c) => c[key] && (allOver || !over(c[key])));
    let inB = [], key = null;
    if (useBand) {
      inB = pickBand('_each'); key = '_each'; band.how = inB.length ? (scope === 'store' ? 'store_each' : 'all') : null;
      if (!inB.length && scope === 'store') { inB = pickBand('_sum'); key = '_sum'; if (inB.length) band.how = 'store_avg'; }
    }
    cands.forEach((c) => {
      c.inBand = inB.indexOf(c) >= 0;
      if (c.inBand) { const b = c[key]; Object.assign(c, { oddT: b.t, odds: b.t / 10, payout: b.pay.total, perGroup: b.pay.per, dist: b.d, overCap: over(b) }); }
      delete c._each; delete c._sum;
    });
    band.horses = inB.map((c) => c.horse);
    let pick, reason;
    if (inB.length) { pick = lottery(inB, input, 'band'); reason = 'band'; }
    else {
      const minD = Math.min.apply(null, cands.map((c) => c.dist));
      pick = lottery(cands.filter((c) => c.dist === minD), input, 'tie');
      reason = 'target';
    }
    if (pick.overCap) reason = 'cap_conflict';
    return { winner: pick.horse, winnerOdds: pick.odds, payout: pick.payout, perGroup: pick.perGroup, dist: pick.dist, overCap: pick.overCap, reason, cands, target, scope, band };
  }

  /* 確定オッズ: 1 着はずらした値。他の馬は見かけの払い戻し率（Σ1/オッズ）がそろうよう同じ向きに少し動かし、[1 − down, 1 + up] の中で小さなゆらぎを足す
     w は数（±w）か { up, down }。up = down = w なら以前と同じ値になる */
  function shapeOdds(odds, winner, winnerOdds, w, seed) {
    const n = odds.length, rnd = mulberry(hash('odds', seed >>> 0)), sh = shiftOf(w);
    const S = odds.reduce((a, o) => a + 1 / o, 0), ow = odds[winner], nw = winnerOdds == null ? ow : winnerOdds;
    let gmul = 1;
    const rest = S - 1 / ow, restNew = S - 1 / nw;
    if (rest > 1e-9 && restNew > 1e-9) gmul = rest / restNew; // 他の馬にかける倍率（1/G）
    gmul = Math.min(1 + sh.up, Math.max(1 - sh.down, gmul));
    return odds.map((o, i) => {
      if (i === winner) return toT(nw) / 10;
      const r = rangeT(o, sh), j = rnd() * 2 - 1;
      let m = gmul * (1 + j * (j > 0 ? sh.up : sh.down) * 0.3);
      m = Math.min(1 + sh.up, Math.max(1 - sh.down, m));
      return Math.min(r.hi, Math.max(r.lo, Math.round(r.oT * m))) / 10;
    });
  }

  /* 1 着が winner になる seed を探す（winner が null なら最初の seed の自然な結果） */
  function findSeed(Engine, race, winner, baseSeed, maxTries) {
    maxTries = maxTries || 400;
    for (let k = 0; k < maxTries; k++) {
      const seed = hash('run', baseSeed >>> 0, k), order = Engine.replayOrder(race, seed);
      if (winner == null || order[0] === winner) return { seed, order, natural: true, tries: k + 1 };
    }
    // 見つからない（極端な大穴）: 最初の seed の走りで、1 着の軌跡と winner の軌跡を入れ替える
    const seed = hash('run', baseSeed >>> 0, 0), nat = Engine.replayOrder(race, seed), order = nat.slice(), j = order.indexOf(winner);
    order[j] = order[0]; order[0] = winner;
    return { seed, order, natural: false, tries: maxTries };
  }

  /* まとめて: 結果を決める。race は Engine のレース（horses, dist, weather, surface, tune）
     input は chooseWinner と同じ（odds 省略時は race.odds）。返り値 { winner, order, finalOdds, seed, natural, payout, perGroup, reason, cands, tries } */
  function resolve(Engine, race, input) {
    input = Object.assign({ odds: race.odds, seed: 1 }, input);
    const ch = chooseWinner(input), baseSeed = hash('race', input.seed >>> 0);
    const fs = findSeed(Engine, race, ch.winner, baseSeed, input.maxTries);
    const winner = fs.order[0];
    const winnerOdds = ch.winner == null ? input.odds[winner] : ch.winnerOdds;
    const finalOdds = shapeOdds(input.odds, winner, winnerOdds, shiftOf(input), input.seed);
    return { winner, order: fs.order, finalOdds, seed: fs.seed, natural: fs.natural, tries: fs.tries, payout: ch.winner == null ? 0 : ch.payout, perGroup: ch.perGroup || {}, reason: ch.reason, target: ch.target, scope: ch.scope, cands: ch.cands, band: ch.band };
  }

  // 1 件ごとの払い戻し（サーバーが payouts を作るとき。10 の倍数に切り上げ済み）
  function stakePayout(count, odds) { return amountT(Math.floor(count), toT(odds)); }

  // 1 枚あたりの額（オッズの表示の代わり）: 6.1 → 610
  function perTicket(odds) { return toT(odds) * (UNIT / 10); }
  return { chooseWinner, weightOf, shiftOf, shapeOdds, findSeed, resolve, stakePayout, perTicket, roundPay, PAY_STEP, UNIT, hash, mulberry, MIN_T, MAX_T };
});
