/* 抽選エンジンのテスト。実行: node tests/engine.test.js [旧版 engine.js のパス]
   旧版（b51）を渡すと、初期の配当表での結果が旧版と完全に一致することも確かめる。 */
const path = require('path');
const E = require('../js/engine.js');
const OLD = process.argv[2] ? require(path.resolve(process.argv[2])) : null;
let n = 0, fail = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('NG  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n      got ' + JSON.stringify(a).slice(0, 200) + '\n      exp ' + JSON.stringify(b).slice(0, 200));
// 0,1,2,... と順に返す乱数（全パターンを数えるため）
const seqRng = (list) => { let i = 0; return () => list[i++]; };

/* ---- 1. 初期の配当表 ---- */
const D = E.defaultProbs();
ok(E.validateProbs(D).ok, '初期の確率表は有効');
eq(E.tableOf(D).map((d) => d.values), [[0, 500, 1000], [0, 1000, 2000, 3000, 5000], [0, 10000, 50000, 100000]], '初期の表の金額');
ok(Math.abs(E.probStats(D).ev - 358) < 1e-9, '初期の期待値は 358');
E.setTable(D);
eq(E.REEL_SYMS, { 1: [100, 200, 300, 400, 500], 2: [500, 1000, 2000, 3000, 5000], 3: [5000, 10000, 20000, 30000, 50000, 100000] }, '初期の表ではリールの絵柄は元のまま');

/* ---- 2. 旧版と完全一致（初期の表） ---- */
if (OLD) {
  eq(E.probStats(D), OLD.probStats(D), '旧版と probStats が一致');
  [1, 2, 3].forEach((st) => {
    const targets = OLD.STAGE_DEFS[st - 1].values.concat(st < 3 ? ['NEXT'] : []).concat(['FREE', 'FREE2', 'FREE3', 'LOGO']);
    targets.forEach((t) => eq(E.reelCombos(st, t), OLD.reelCombos(st, t), '旧版と出目が一致 STAGE ' + st + ' / ' + t));
  });
  // 乱数を全通り流して、抽選結果が旧版と同じになること（各ステージ 0〜9999）
  for (let a = 0; a < 10000; a += 37) for (let b = 0; b < 10000; b += 1111) for (let c = 0; c < 10000; c += 3333) {
    const r1 = E.drawProb(D, seqRng([a, b, c])), r2 = OLD.drawProb(D, seqRng([a, b, c]));
    if (JSON.stringify(r1) !== JSON.stringify(r2)) { ok(false, '旧版と抽選結果が違う ' + [a, b, c]); break; }
  }
  ok(true, '旧版と抽選結果が一致');
  const lim = { on: true, total: 0, max: { '1:500': 1, '3:100000': 1 }, resetHour: 19 }, now = Date.now(), hits = [{ ts: now, key: '1:500' }];
  eq(E.blockedKeys(lim, hits, now), OLD.blockedKeys(lim, hits, now), '旧版と上限の止め方が一致');
  eq(E.earlyBlocked({ on: true, plays: 5, min: 2000 }, 0), OLD.earlyBlocked({ on: true, plays: 5, min: 2000 }, 0), '旧版と開始直後の制限が一致');
} else console.log('（旧版 engine.js を渡すと、旧版との一致も確かめます）');

/* ---- 3. 自由な配当表 ---- */
const C = { 1: { 0: 50, 300: 15, 500: 15, 1000: 8, 2000: 2, NEXT: 10 }, 2: { 0: 60, 1500: 30, NEXT: 10 }, 3: { 0: 60, 20000: 30, 70000: 9, 300000: 1 } };
ok(E.validateProbs(C).ok, '自由な表は有効: ' + E.validateProbs(C).errors.join(' / '));
eq(E.tableOf(C).map((d) => d.values), [[0, 300, 500, 1000, 2000], [0, 1500], [0, 20000, 70000, 300000]], '自由な表の金額');
const stC = E.probStats(C);
const evC = 300 * .15 + 500 * .15 + 1000 * .08 + 2000 * .02 + .1 * (1500 * .3) + .01 * (20000 * .3 + 70000 * .09 + 300000 * .01);
ok(Math.abs(stC.ev - evC) < 1e-9, '自由な表の期待値 ' + stC.ev + ' = ' + evC);
E.setTable(C);
eq(E.OUTCOMES.map((o) => o.key), ['1:0', '1:300', '1:500', '1:1000', '1:2000', '2:0', '2:1500', '3:0', '3:20000', '3:70000', '3:300000'], 'OUTCOMES が表に追従');
[1, 2, 3].forEach((st) => {
  const d = E.STAGE_DEFS[st - 1], syms = E.REEL_SYMS[st];
  d.values.forEach((v) => {
    const combos = E.reelCombos(st, v);
    ok(combos.length > 0, 'STAGE ' + st + ' の ' + v + ' を出す出目がある');
    ok(combos.every((c) => E.readReels(st, c) === v), 'STAGE ' + st + ' の ' + v + ' の出目は読みが一致');
    ok(combos.every((c) => c.every((s) => typeof s !== 'number' || syms.indexOf(s) >= 0)), 'STAGE ' + st + ' の出目はリールにある絵柄だけ');
  });
  // リールの数字は、必ずどれかの配当の合計に使える（出ても当たりにならない数字は置かない）
  syms.forEach((s) => ok(d.values.some((v) => v > 0 && E.reelCombos(st, v).some((c) => c.indexOf(s) >= 0)), 'STAGE ' + st + ' の絵柄 ' + s + ' は配当に使われる'));
  // 「惜しい」絵柄の候補は、正規の結果になるものだけ
  E.reelCombos(st, 0).slice(0, 20).forEach((c) => [0, 1, 2].forEach((i) => E.reelAlternatives(st, c, i).forEach((s) => { const x = c.slice(); x[i] = s; const r = E.readReels(st, x); ok(d.values.indexOf(r) >= 0 || r === 'NEXT' || E.FREE_SYMS.indexOf(r) >= 0, '惜しい絵柄の読みが正規'); })));
});
// 抽選の分布が設定どおり（STAGE 1 を 0.01% 単位で全通り）
const cnt = {};
for (let r = 0; r < 10000; r++) { const res = E.drawProb(C, seqRng([r, 0, 0])); const k = res.stage === 1 ? res.key : 'NEXT'; cnt[k] = (cnt[k] || 0) + 1; }
eq(cnt, { '1:0': 5000, '1:300': 1500, '1:500': 1500, '1:1000': 800, '1:2000': 200, NEXT: 1000 }, 'STAGE 1 の分布が確率どおり');
// 上限に達した金額は 0 に回る（他の当たりは増えない）
const cntB = {};
for (let r = 0; r < 10000; r++) { const res = E.drawProb(C, seqRng([r, 0, 0]), ['1:2000', '1:300']); const k = res.stage === 1 ? res.key : 'NEXT'; cntB[k] = (cntB[k] || 0) + 1; }
eq(cntB, { '1:0': 6700, '1:500': 1500, '1:1000': 800, NEXT: 1000 }, '止めた金額のぶんは 0 に回る');
eq(E.blockedKeys({ on: true, total: 0, max: { '1:300': 2 }, resetHour: 19 }, [{ ts: Date.now(), key: '1:300' }, { ts: Date.now(), key: '1:300' }], Date.now(), C), ['1:300'], '自由な金額にも本数の上限が効く');
eq(E.earlyBlocked({ on: true, plays: 3, min: 2000 }, 0, C), ['1:2000', '3:20000', '3:70000', '3:300000'], '開始直後の制限が自由な金額に効く');

/* ---- 4. 入力の検証 ---- */
const bad = (p, word, m) => { const v = E.validateProbs(p); ok(!v.ok && v.errors.join(' ').indexOf(word) >= 0, m + ' → ' + v.errors.join(' / ')); };
bad({ 1: { 0: 50, 500: 20, NEXT: 10 }, 2: D[2], 3: D[3] }, '合計', '合計が 100 でないとエラー');
bad({ 1: { 0: 50, '0500': 40, NEXT: 10 }, 2: D[2], 3: D[3] }, '金額は', '金額の書き方が変だとエラー');
bad({ 1: { 0: 50, '12.5': 40, NEXT: 10 }, 2: D[2], 3: D[3] }, '金額は', '小数の金額はエラー');
bad({ 1: { 0: 10, 100: 10, 200: 10, 300: 10, 400: 10, 500: 10, 600: 10, 700: 10, 800: 10, 900: 0, NEXT: 10 }, 2: D[2], 3: D[3] }, '種類まで', '金額が 9 種類はエラー');
bad({ 1: { 500: 90, NEXT: 10 }, 2: D[2], 3: D[3] }, '0〜100', '0 の行が無いとエラー');
// 金額が無いステージ（0 と NEXT だけ）でも動く
const Z = { 1: { 0: 90, NEXT: 10 }, 2: D[2], 3: D[3] };
ok(E.validateProbs(Z).ok, '金額なしのステージも有効');
E.setTable(Z);
eq(E.REEL_SYMS[1], [], '金額なしのステージは数字の絵柄なし');
ok(E.reelCombos(1, 0).length > 0 && E.reelCombos(1, 'NEXT').length === 1, '金額なしでも 0 と NEXT の出目はある');
E.setTable();
eq(E.OUTCOMES.length, 12, 'setTable() で初期の表に戻る');

/* ---- 5. b56: 始めるステージを指定した抽選 / CREDIT（ステージを下げない）の期待値 / 期待の段階化の判定 ---- */
{
  const cnt2 = {};
  for (let r = 0; r < 10000; r++) { const res = E.drawProb(D, seqRng([r, 0, 0]), [], 2); const k = res.stage === 2 ? res.key : 'NEXT'; cnt2[k] = (cnt2[k] || 0) + 1; }
  eq(cnt2, { '2:0': 5000, '2:1000': 2000, '2:2000': 1000, '2:3000': 600, '2:5000': 400, NEXT: 1000 }, 'STAGE 2 から始める抽選は STAGE 2 の確率どおり');
  ok(E.drawProb(D, seqRng([9999, 0, 0]), [], 3).stage === 3 && E.drawProb(D, seqRng([0, 0, 0]), [], 9).stage === 3, 'STAGE 3 から始めると STAGE 3 で終わる（範囲外は最後のステージ）');
  eq(E.drawProb(D, seqRng([0, 0, 0])), E.drawProb(D, seqRng([0, 0, 0]), [], 1), '始めるステージを省略すると STAGE 1 から');
  const cs = E.creditStats(D, 10);
  ok(Math.round(cs.one[1]) === 358 && Math.round(cs.one[2]) === 1580 && Math.round(cs.one[3]) === 8000, '1回ぶんの期待値（始めるステージ別）: ' + JSON.stringify(cs.one));
  ok(Math.abs(cs.total[1] - 14977.80) < 0.01 && Math.abs(cs.total[2] - 38185.16) < 0.01 && Math.abs(cs.total[3] - 80000) < 0.01, 'ステージを下げない 10 回の期待値: ' + JSON.stringify(cs.total));
  ok(Math.abs(E.creditStats(D, 1).total[1] - E.probStats(D).ev) < 1e-9, '1 回だけなら、ふつうの期待値と同じ');
  // 実際に回して確かめる（ステージを引き継いで 10 回）
  let sumAll = 0; const TR = 120000;
  for (let i = 0; i < TR; i++) { let st = 1; for (let k = 0; k < 10; k++) { const res = E.drawProb(D, undefined, [], st); sumAll += res.value; st = res.stage; } }
  ok(Math.abs(sumAll / TR - cs.total[1]) / cs.total[1] < 0.05, 'ステージを引き継いで回した平均が期待値と合う: ' + Math.round(sumAll / TR) + ' / ' + Math.round(cs.total[1]));

  const T = (st, c, o) => E.tensionOf(st, c, o || [0, 1, 2]);
  eq(T(1, ['NEXT', 'NEXT', 'NEXT']), { kind: 'next', cap: 2, hit: true, big: true }, '期待: NEXT 2本 → 3本目も NEXT');
  eq(T(1, ['NEXT', 'NEXT', 'BAR']), { kind: 'next', cap: 2, hit: false, big: true }, '期待: NEXT 2本 → 来ない');
  eq(T(2, ['NEXT', 'BAR', 'NEXT'], [0, 2, 1]), { kind: 'next', cap: 3, hit: false, big: true }, '期待: 止まる順で見る（STAGE 2 は 3 段階まで）');
  eq(T(2, ['NEXT', 'BAR', 'NEXT']), null, '期待: 先の2本がそろっていなければ出さない');
  eq(T(1, ['FREE', 'FREE', 'BAR']), { kind: 'free', cap: 1, hit: false, big: false }, '期待: FREE ×1 は控えめ（1 段階まで）');
  eq(T(1, ['FREE2', 'FREE2', 'FREE2']), { kind: 'free', cap: 2, hit: true, big: false }, '期待: FREE ×2');
  eq(T(1, ['FREE3', 'FREE3', 'FREE3']), { kind: 'free', cap: 3, hit: true, big: true }, '期待: FREE ×3 は大きな場面');
  eq(T(2, ['LOGO', 'LOGO', 'LOGO']), { kind: 'logo', cap: 3, hit: true, big: true }, '期待: casa ロゴ');
  eq(T(1, ['FREE', 'FREE2', 'BAR']), null, '期待: 種類の違う FREE は出さない');
  eq(T(3, ['BAR', 30000, 20000]), { kind: 'sum', cap: 3, hit: false, big: true, sum: 30000 }, '期待: 合計が大きい（50,000 が当たる回）');
  eq(T(3, ['BAR', 50000, 50000]), { kind: 'sum', cap: 3, hit: true, big: true, sum: 50000 }, '期待: 合計が大きい（最高額になる回）');
  eq(T(3, ['BAR', 5000, 5000]), null, '期待: 下位の金額（10,000）では出さない');
  eq(T(3, ['BAR', 'BAR', 100000]), null, '期待: 2本目までに金額が出ていなければ出さない');
  eq(T(1, ['BAR', 500, 500]), { kind: 'sum', cap: 1, hit: true, big: false, sum: 500 }, '期待: STAGE 1 の合計は控えめ');
  eq(T(2, ['BAR', 2000, 3000]), null, '期待: 2本の合計が当選額の半分に届かなければ出さない');
  eq(T(2, ['BAR', 2000, 3000], [0, 2, 1]), { kind: 'sum', cap: 2, hit: true, big: true, sum: 3000 }, '期待: 同じ出目でも止まる順で変わる');
  // どの出目・どの止まる順でも、判定が出目と食い違わない
  let bad5 = 0;
  const ORD = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  E.STAGE_DEFS.forEach((d) => d.values.concat(d.hasNext ? ['NEXT'] : []).concat(E.FREE_SYMS).forEach((target) => E.reelCombos(d.stage, target).forEach((c) => ORD.forEach((o) => {
    const t = E.tensionOf(d.stage, c, o);
    if (!t) return;
    if (t.cap < 1 || t.cap > 3) bad5++;
    if (t.kind === 'next' && t.hit !== (target === 'NEXT')) bad5++;
    if ((t.kind === 'free' || t.kind === 'logo') && t.hit !== (E.FREE_SYMS.indexOf(target) >= 0)) bad5++;
    if (t.kind === 'sum' && !(typeof target === 'number' && target > 0 && t.sum * 2 >= target)) bad5++;
  }))));
  eq(bad5, 0, '期待の判定は、すべての出目・止まる順で出目と食い違わない');
}

console.log(fail ? fail + ' 件失敗 / ' + n + ' 件' : 'すべて成功（' + n + ' 件）');
process.exit(fail ? 1 : 0);
