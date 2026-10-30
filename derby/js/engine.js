/* casa DERBY 抽選エンジン（純粋ロジック。DOM に依存しない。Node でもテスト可）
   「みんなでダービー」に寄せた作り:
   - 6頭立て。馬には脚質4タイプ（逃げ・先行・差し・追込）、★能力、調子、過去成績
   - 距離は 1000m（約57秒）だけ（オーナー指示）。500m・1200m・1600m の作りも残してある、天候（晴/曇/雨）、馬場（芝/ダート）
   - 倍率はレースを何千回も試走して求めた確率から作る（払い戻し率 PAYOUT_RATE）。単勝は 6点、馬連は 15点
   - 本番のレースも同じ走り方のモデルで 1 回だけ走らせる（結果は本当に走って決まる。ニンジンの加速も効く）
   - レース後にチャンスボールが貯まるとルーレット → ボーナス牧場 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PAYOUT_RATE = 0.85;      // 払い戻し率（倍率 = 0.85 ÷ 確率）
  const MAX_BET = 99;            // 1マスの上限
  const SIMS = 1500;             // 倍率を出すための試走回数
  const FRAME = ['#f4f4f4', '#1a1a1e', '#d6332b', '#2459c9', '#f2c531', '#2a9a4a'];
  const INK = ['#111', '#fff', '#fff', '#fff', '#111', '#fff'];

  // 脚質: 逃げ・先行・差し・追込。chara（チビィ等の体型の呼び名）は 2026-10-14 から画面に出さない（馬の体は全頭同じになったため）。データだけ残す
  const TYPES = {
    nige: { key: 'nige', label: '逃げ', chara: 'チビィ', color: '#ff8a65' },
    senko: { key: 'senko', label: '先行', chara: 'ノマール', color: '#ffd54f' },
    sashi: { key: 'sashi', label: '差し', chara: 'ノッポン', color: '#81d4fa' },
    oikomi: { key: 'oikomi', label: '追込', chara: 'ヨコヅナ', color: '#ce93d8' },
  };
  const CONDS = [
    { mark: '◎', label: '絶好調', mul: 1.006 },
    { mark: '○', label: '好調', mul: 1.003 },
    { mark: '△', label: '普通', mul: 1.0 },
    { mark: '▲', label: '不調', mul: 0.997 },
    { mark: '×', label: '絶不調', mul: 0.994 },
  ];
  // 馬の一覧（初期の 16 頭）。stars=総合、spd/sta/pow=スピード・スタミナ・パワー（1〜5）、coat=毛色
  // 名前は 2026-10-30 に casa（カーサ＝ハウス）とポーカーにちなんだものへ一新（オーナー「全部めっちゃダサい」。ChatGPT と相談して決定）。
  // 脚質・能力・毛色は以前のまま（同じ位置の馬の名前だけを変えた＝レースの結果は名前以外変わらない）。かっこ内は以前の名前
  // 管理画面の「馬」で直した一覧があればそちらを使う（v2/core.js の horsePool → makeRace の pool）
  const POOL = [
    { name: 'カーサロワイヤル', type: 'senko', spd: 5, sta: 4, pow: 3, coat: 'white' },     // casa＋カジノ・ロワイヤル。看板馬（カーサブランカ）
    { name: 'リバーファントム', type: 'oikomi', spd: 4, sta: 5, pow: 4, coat: 'black' },   // 最後のカード（リバー）で現れる幻＝最後に来る（ミッドナイトキング）
    { name: 'プリフロップジャム', type: 'nige', spd: 5, sta: 2, pow: 3, coat: 'chestnut' }, // 配られてすぐオールイン＝最初から飛ばす（レッドアロー）
    { name: 'チェックレイズ', type: 'sashi', spd: 4, sta: 4, pow: 3, coat: 'gray' },        // 一度待ってから反撃（ブルームーン）
    { name: 'ポケットロケッツ', type: 'nige', spd: 4, sta: 3, pow: 2, coat: 'palomino' },  // A のペアの愛称。ロケットスタート（ゴールドラッシュ）
    { name: 'ショーダウン', type: 'sashi', spd: 3, sta: 3, pow: 5, coat: 'bay' },           // 手札を見せ合う最後の勝負＝力で抜ける（グリーンフラッシュ）
    { name: 'ハウスエッジ', type: 'senko', spd: 3, sta: 4, pow: 4, coat: 'bay' },           // 胴元（ハウス＝カーサ）がいつも有利（シブヤハチコウ）
    { name: 'ディープスタック', type: 'oikomi', spd: 3, sta: 5, pow: 5, coat: 'black' },   // チップがたっぷり＝最後まで余力（ウエノパンダ）
    { name: 'ナッツフラッシュ', type: 'nige', spd: 4, sta: 4, pow: 2, coat: 'white' },     // いちばん強いフラッシュ。閃光のように逃げる（サッポロユキダルマ）
    { name: 'ヘッズアップ', type: 'senko', spd: 4, sta: 2, pow: 4, coat: 'chestnut' },      // 1 対 1 の勝負（モーニングショット）
    { name: 'シルバーブラフ', type: 'sashi', spd: 2, sta: 4, pow: 4, coat: 'gray' },        // 銀色（芦毛）のはったり（ナイトキャップ）
    { name: 'ラストオールイン', type: 'oikomi', spd: 5, sta: 3, pow: 2, coat: 'palomino' }, // 最後の全部賭け＝一瞬の末脚（シャンパンタワー）
    { name: 'ターンミラージュ', type: 'sashi', spd: 2, sta: 3, pow: 3, coat: 'bay' },       // 4 枚目のカード（ターン）の蜃気楼（オヤジノユメ）
    { name: 'ランナーランナー', type: 'oikomi', spd: 3, sta: 2, pow: 3, coat: 'chestnut' }, // ターンとリバーで続けて引いて大逆転（ラストオーダー）
    { name: 'ポーカーフェイス', type: 'nige', spd: 3, sta: 5, pow: 3, coat: 'black' },     // 表情を変えず淡々と粘る（ハシゴザケ）
    { name: 'ワンペアドリーム', type: 'senko', spd: 2, sta: 2, pow: 2, coat: 'white' },     // 弱い役でも夢を見る（ツケバライ）
  ];
  // 毛色（3D の馬 js/r3d/horse3d.js の COATS と同じ 6 つ）と、管理画面に出す呼び名
  const COATS = { bay: '鹿毛', chestnut: '栗毛', black: '青毛', gray: '芦毛', white: '白毛', palomino: '月毛' };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // 勝負服（馬主の服色のつもり。名前から決める）: base=地色, accent=差し色, pattern=柄
  const SILK_COLORS = ['#d32f2f', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00', '#00838f', '#ad1457', '#37474f', '#fdd835', '#ffffff', '#212121'];
  const SILK_PATTERNS = ['solid', 'sash', 'stripes', 'hoops', 'star', 'diamond', 'halves'];
  function silkFor(name) { let h = 7; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; const b = SILK_COLORS[h % SILK_COLORS.length]; let a = SILK_COLORS[(h >>> 4) % SILK_COLORS.length]; if (a === b) a = SILK_COLORS[(h >>> 8) % SILK_COLORS.length]; return { base: b, accent: a, pattern: SILK_PATTERNS[(h >>> 12) % SILK_PATTERNS.length] }; }
  const rnd = (r) => (r || Math.random)();
  function pick(arr, r) { return arr[Math.floor(rnd(r) * arr.length)]; }
  function shuffle(arr, r) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd(r) * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  // 正規乱数（ボックス・ミュラー）
  function gauss(r) { let u = 0, v = 0; while (u === 0) u = rnd(r); while (v === 0) v = rnd(r); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v); }

  /* ---------- レースの条件と出走馬を作る ----------
     pool: 出走させる馬の一覧（2026-10-30 管理画面の「馬」で直せる。v2/core.js の horsePool が tuning.horses から作る）。
     渡さない・6 頭より少ないときは上の POOL。並べ方と乱数の使い方は同じなので、POOL を渡したときと渡さないときの結果は同じ */
  function makeRace(r, pool) {
    const src = Array.isArray(pool) && pool.length >= 6 ? pool : POOL;
    const dist = 1000; rnd(r); // オーナー指示「1000m にしよう」（全レース 1000m・約57秒。乱数は 1 つ消費して抽選の並びを保つ）
    const weather = pick(['sunny', 'cloudy', 'rain'], r);
    const surface = rnd(r) < 0.7 ? 'turf' : 'dirt';
    const horses = shuffle(src, r).slice(0, 6).map((h, i) => {
      const cond = CONDS[Math.floor(rnd(r) * CONDS.length)];
      // 過去5走の着順（能力が高いほど上位が多い）
      const stars = (h.spd + h.sta + h.pow) / 3;
      const past = [];
      for (let k = 0; k < 5; k++) { let p = 1 + Math.floor(Math.abs(gauss(r)) * (6 - stars) * 0.9); past.push(clamp(p, 1, 6)); }
      const wins = past.filter((p) => p === 1).length, places = past.filter((p) => p <= 2).length;
      const silk = silkFor(h.name);
      return { no: i + 1, name: h.name, type: h.type, silk, spd: h.spd, sta: h.sta, pow: h.pow, coat: h.coat, stars: Math.round(stars), cond, past, mark: wins >= 2 ? '◎' : places >= 2 ? '○' : places >= 1 ? '▲' : '', color: FRAME[i], ink: INK[i] };
    });
    return { dist, weather, surface, horses };
  }

  /* ---------- 走り方のモデル ----------
     進み具合 u（0〜1）での速さの倍率。脚質で山が違う。距離が長いと逃げがバテ、差し・追込が伸びる。 */
  function profile(type, u, dist) {
    const long = dist >= 1600 ? 1 : dist >= 1200 ? 0.4 : 0;
    switch (type) {
      case 'nige': return 1.03 - 0.055 * Math.pow(u, 1.6) - 0.015 * long * u;
      case 'senko': return 1.012 - 0.018 * u - 0.006 * long * u;
      case 'sashi': return 0.982 + 0.045 * Math.pow(u, 1.8) + 0.008 * long * u;
      case 'oikomi': return 0.968 + 0.07 * Math.pow(u, 2.6) + 0.012 * long * u;
    }
    return 1;
  }
  // 馬ごとの地力（距離・馬場・調子で変わる）
  function baseSpeed(h, race) {
    const staW = race.dist >= 1600 ? 0.0014 : race.dist >= 1200 ? 0.0009 : 0.0006, powW = race.surface === 'dirt' ? 0.0014 : 0.0006, spdW = race.dist >= 1600 ? 0.0011 : race.dist >= 1200 ? 0.0015 : 0.0018;
    return 1 + spdW * (h.spd - 3) + staW * (h.sta - 3) + powW * (h.pow - 3) + (h.cond.mul - 1);
  }
  /* 馬群のまとまり（オーナー指示「馬同士が離れすぎて展開が面白くない」）
     pack: 先頭から離れた馬ほど少し速くなる（本物の「前が壁になって脚がたまる／後ろは風よけ」をゲーム的に強めたもの）。
           先頭からの差 gap(m) に比例し、上限 packMax。最後の packEnd（進み具合）以降は効かせず、決着は地力と展開で決まる。
     sigmaMul: ゆらぎの強さ。調整はテスト用に globalThis.__DERBY_TUNE で上書きできる */
  const TUNE = Object.assign({ pack: 0.008, packMax: 0.1, packEnd: 0.9, sigmaMul: 0.8, oddsDt: 0.1 }, // 300 レースの計測で決定: 中間の馬群の幅 38m→9m、1 馬身以内の決着 14%→42%、残り 200m の先頭交代 0.5→1.5 回
     (typeof globalThis !== 'undefined' && globalThis.__DERBY_TUNE) || {});
  // race.tune（v2: サーバーがレースごとに決めて保存する調整値 { sigmaMul, payoutRate }）があればそちらを使う（全店のテレビで同じ走りを再現するため）
  const tuneOf = (race, k) => (race && race.tune && race.tune[k] != null ? race.tune[k] : TUNE[k]);
  const noiseSigma = (race) => tuneOf(race, 'sigmaMul') * (race.weather === 'rain' ? 0.075 : race.weather === 'cloudy' ? 0.065 : 0.058);

  /* 1 回走らせる。dt 刻みで各馬を進め、ゴール時刻を返す。
     boost(i, t) を渡すとニンジンなどの加速倍率を足せる（本番用）。
     stepCb(t, pos) を渡すと毎ステップ位置を受け取れる（本番の絵用）。 */
  function createRun(race, r, opt) {
    opt = opt || {};
    const n = race.horses.length, sigma = noiseSigma(race);
    const base = race.horses.map((h) => baseSpeed(h, race));
    const pos = new Array(n).fill(0), noise = new Array(n).fill(0), finish = new Array(n).fill(0), speed = new Array(n).fill(0);
    const theta = 0.6, length = race.dist >= 1600 ? 95 : race.dist >= 1200 ? 67 : race.dist >= 1000 ? 58 : 29; // ゴールまでの基準時間（秒。本物のタイムに合わせる）
    const run = { t: 0, done: 0, pos, finish, speed, length, n };
    run.step = function (dt) {
      dt = Math.max(0.0005, dt || 0);
      run.t += dt;
      let lead = 0; for (let i = 0; i < n; i++) if (!finish[i] && pos[i] > lead) lead = pos[i];
      for (let i = 0; i < n; i++) {
        if (finish[i]) continue;
        const h = race.horses[i], u = Math.min(1, pos[i]);
        noise[i] += -theta * noise[i] * dt + sigma * Math.sqrt(dt) * gauss(r);
        let v = base[i] * profile(h.type, u, race.dist) * (1 + noise[i]);
        v *= 0.45 + 0.55 * Math.min(1, run.t / 2.5);                      // スタートダッシュ（最初の 2.5 秒で加速）
        if (TUNE.pack && u < TUNE.packEnd) { const gapM = (lead - pos[i]) * race.dist, fade = Math.min(1, (TUNE.packEnd - u) / 0.1); v *= 1 + Math.min(TUNE.packMax, TUNE.pack * gapM) * fade; }
        if (opt.boost) v *= opt.boost(i, run.t);
        speed[i] = v;
        pos[i] += v * dt / length;
        if (pos[i] >= 1) { finish[i] = run.t - (pos[i] - 1) * length / v; run.done++; }
      }
      return run.done >= n;
    };
    run.order = function () { return race.horses.map((_, i) => i).sort((a, b) => (finish[a] || 99 + a) - (finish[b] || 99 + b)); };
    return run;
  }
  /* 1 回走らせてゴール時刻と着順を返す（倍率の計算用） */
  function simulate(race, r, opt) {
    opt = opt || {};
    const dt = opt.dt || 0.1, run = createRun(race, r, opt), length = run.length;
    const checkpoints = opt.checkpoints ? [] : null;
    while (run.t < 200) {
      const all = run.step(dt);
      if (checkpoints && (checkpoints.length === 0 && run.t >= length * 0.3 || checkpoints.length === 1 && run.t >= length * 0.6 || checkpoints.length === 2 && run.t >= length * 0.85)) checkpoints.push(run.pos.slice());
      if (all) break;
    }
    for (let i = 0; i < run.n; i++) if (!run.finish[i]) run.finish[i] = 200 + i;
    return { order: run.order(), finish: run.finish, checkpoints };
  }

  /* ---------- 倍率（試走して確率を出す） ---------- */
  /* 2026-10-21 v4: 2 連単（1 着・2 着を順番どおり。6 頭で 30 通り）の倍率も同じ試走から出す（exacta）。
     30 通りは試走 1500 回でも出にくい組み合わせがあるので、数えた割合に「勝率から作った目安」（Harville: P(a 1着)×P(b 1着)/(1−P(a 1着))）を
     EX_PRIOR 回ぶん混ぜてならす（0 回の組み合わせも 999 倍に張り付かない）。倍率 = 払い戻し率 ÷ 確率（0.1 刻みに切り捨て、1.0〜999.9）。
     exactaProb は合計 1（結果の決め方の抽選の重み）。キーは '1着の添字-2着の添字'（ekey。例 '2-4'） */
  const EX_PRIOR = 150, EX_MIN = 1.0, EX_MAX = 999.9;
  function ekey(a, b) { return a + '-' + b; }
  function calcOdds(race, r, sims) {
    sims = sims || SIMS;
    const n = race.horses.length;
    const win = new Array(n).fill(0), quin = {}, ex = {}, rankSum = [new Array(n).fill(0), new Array(n).fill(0), new Array(n).fill(0)];
    for (let s = 0; s < sims; s++) {
      const res = simulate(race, r, { dt: TUNE.oddsDt, checkpoints: s < 300 }); // 刻みが粗いと馬群のまとまりの効き方が本番とずれ、払い戻し率が 90% 近くまで上がる（0.1 で約 86%）
      win[res.order[0]]++;
      const k = qkey(res.order[0], res.order[1]); quin[k] = (quin[k] || 0) + 1;
      const e = ekey(res.order[0], res.order[1]); ex[e] = (ex[e] || 0) + 1;
      if (res.checkpoints) res.checkpoints.forEach((pos, c) => { const ord = pos.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]); ord.forEach((x, rank) => (rankSum[c][x[1]] += rank)); });
    }
    const rate = (race.tune && race.tune.payoutRate) || PAYOUT_RATE;
    const toOdds = (p) => (p <= 0 ? 999 : clamp(Math.floor(rate / p * 10) / 10, 1.1, 999));
    const tansho = win.map((w) => toOdds(w / sims));
    const umaren = {};
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) umaren[qkey(a, b)] = toOdds((quin[qkey(a, b)] || 0) / sims);
    // 2 連単: ならした確率 → 倍率
    const pw = win.map((w) => (w + 1) / (sims + n)), exactaProb = {}, exacta = {};
    let tot = 0;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) { if (a === b) continue; const prior = pw[a] * pw[b] / Math.max(1e-9, 1 - pw[a]); const p = ((ex[ekey(a, b)] || 0) + EX_PRIOR * prior) / (sims + EX_PRIOR); exactaProb[ekey(a, b)] = p; tot += p; }
    Object.keys(exactaProb).forEach((k) => { exactaProb[k] /= tot; exacta[k] = clamp(Math.floor(rate / exactaProb[k] * 10) / 10, EX_MIN, EX_MAX); });
    // 展開予想: 序盤・中盤・終盤の平均順位（小さいほど前）
    const tenkai = rankSum.map((arr) => arr.map((s) => s / 300));
    return { tansho, umaren, winProb: win.map((w) => w / sims), tenkai, exacta, exactaProb };
  }
  function qkey(a, b) { return a < b ? a + '-' + b : b + '-' + a; }
  // 倍率の色: 白=10倍未満、黄=10〜99.9、赤=100以上
  function oddsColor(o) { return o >= 100 ? 'red' : o >= 10 ? 'yellow' : 'white'; }

  /* ---------- 払い戻し ---------- */
  // bets: { tansho: [枚数×6], umaren: { 'a-b': 枚数 } }
  function totalBet(bets) {
    let s = 0; bets.tansho.forEach((b) => (s += b)); Object.keys(bets.umaren).forEach((k) => (s += bets.umaren[k])); return s;
  }
  function payout(bets, odds, order) {
    const w = order[0], k = qkey(order[0], order[1]);
    const hits = [];
    let total = 0;
    if (bets.tansho[w] > 0) { const amt = Math.floor(bets.tansho[w] * odds.tansho[w]); total += amt; hits.push({ kind: 'tansho', label: '単勝 ' + (w + 1), bet: bets.tansho[w], odds: odds.tansho[w], amt }); }
    if (bets.umaren[k] > 0) { const amt = Math.floor(bets.umaren[k] * odds.umaren[k]); total += amt; hits.push({ kind: 'umaren', label: '馬連 ' + (order[0] + 1) + '-' + (order[1] + 1), bet: bets.umaren[k], odds: odds.umaren[k], amt }); }
    return { total, hits };
  }

  /* ---------- ニンジン（応援） ----------
     賭けた枚数に応じて応援チャンスの回数が決まる（10枚ごとに1回、最大3回）。
     ルーレットの出目: ニンジン（加速）が多め、たまに大根（効果なし）、まれにとうもろこし（大加速）。 */
  function carrotCount(bets) { return clamp(Math.floor(totalBet(bets) / 10), 0, 3); }
  function spinFood(r) { const x = rnd(r); return x < 0.12 ? { key: 'corn', label: 'とうもろこし', boost: 1.09, sec: 2.2 } : x < 0.3 ? { key: 'daikon', label: '大根', boost: 1.0, sec: 0 } : { key: 'carrot', label: 'ニンジン', boost: 1.045, sec: 2.0 }; }
  // 賭けている馬（単勝・馬連の両方から）
  function betHorses(bets) {
    const set = {};
    bets.tansho.forEach((b, i) => { if (b > 0) set[i] = 1; });
    Object.keys(bets.umaren).forEach((k) => { if (bets.umaren[k] > 0) k.split('-').forEach((i) => (set[Number(i)] = 1)); });
    return Object.keys(set).map(Number);
  }

  /* ---------- チャンスボールとボーナスルーレット ---------- */
  const BALLS_MAX = 8;
  function ballsEarned(bets) { const t = totalBet(bets); return t <= 0 ? 0 : 1 + (t >= 30 ? 1 : 0) + (t >= 80 ? 1 : 0); }
  const ROULETTE = [
    { key: 'miss', label: 'ハズレ', w: 3 },
    { key: 'farm', label: 'ボーナス牧場', w: 4, sec: 15, chest: 0.06 },
    { key: 'special', label: 'スペシャル牧場', w: 2, sec: 20, chest: 0.12 },
    { key: 'ultra', label: '超ウルトラ牧場', w: 1, sec: 28, chest: 0.2 },
  ];
  function spinRoulette(r) {
    const s = ROULETTE.reduce((a, x) => a + x.w, 0); let x = rnd(r) * s;
    for (const item of ROULETTE) { x -= item.w; if (x < 0) return item; }
    return ROULETTE[0];
  }

  /* ---------- v2: 乱数の種（seed）で決まる走り（全店のテレビで同じレースを再現する） ----------
     rng(seed): 種から決まる乱数（mulberry32）。hashSeed(文字列/数, ...): 種を作る。
     replayRun(race, seed, opt): 固定刻み（1/60 秒）で最後まで走らせて記録し、経過時間で補間して見せる run を返す。
       createRun と同じ形（t, done, pos, finish, speed, length, n, step(dt), order()）なので race3d.js の this.run にそのまま入る。
       追加: seek(t)（途中から見るテレビ用）, duration（最後の馬のゴール時刻）, winTime, finishTimes, finalOrder(), natural（opt.order を直さずに満たしたか）。
       opt.order（サーバーが決めた着順）を渡すと、もし計算の誤差などで着順が違っても、走りの軌跡を入れ替えて必ずその着順にする。 */
  const FIXED_DT = 1 / 60;
  function rng(seed) { let a = (seed >>> 0) || 0x9e3779b9; return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hashSeed() { let h = 2166136261 >>> 0; for (let k = 0; k < arguments.length; k++) { const s = String(arguments[k]); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } h ^= 0x2c; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  // 固定刻みで走らせて記録する（サーバーの seed 探しもこれを使う）
  function recordRun(race, seed, onlyOrder) {
    const run = createRun(race, rng(seed)), n = run.n, frames = onlyOrder ? null : [new Float64Array(run.pos)], speeds = onlyOrder ? null : [new Float64Array(n)];
    let steps = 0;
    while (steps < 200 * 60) { const all = run.step(FIXED_DT); steps++; if (frames) { frames.push(new Float64Array(run.pos)); speeds.push(new Float64Array(run.speed)); } if (all) break; }
    for (let i = 0; i < n; i++) if (!run.finish[i]) run.finish[i] = 200 + i;
    return { frames, speeds, finish: run.finish.slice(), order: run.order(), length: run.length, n };
  }
  function replayOrder(race, seed) { return recordRun(race, seed, true).order; }
  /* 着順を決めた順にする（2026-10-21 v4・2 連単: 1 着と 2 着の両方を決めるので、入れ替えが要ることが増えた）。
     以前は「馬 i が、自然な着順で k 番目の馬の軌跡を最初から全部使う」入れ替え（逃げ馬が追込の走りをする、が起きる。opt.legacy で今も使える）。
     いまは、ゴールの順で隣どうしの 2 頭を 1 回ずつ入れ替える（並べ替えの泡立ち）。入れ替えるのは「2 頭の位置がいちばん近い時刻」から後ろだけで、
     その時刻から「つなぎの秒数」（1.5 秒以上・差 1.2m につき 1 秒）かけて、位置も速さも自分の走りから相手の走りへなめらかに移す（速さが飛ばない）。
     いちばん近い時刻の選び方: スタート 5 秒後〜（吸収を終えてゴールの 0.3 秒前まで）の中で「近さ（m）＋ゴールまでの秒数 × 0.05」が最小。
     決めた着順にならなかったとき（まれ）は以前の入れ替え。返り値 { P: 馬ごとの位置, V: 馬ごとの速さ, finish, swaps: [{ a, b, t, gapM, blend }] } または null */
  const BLEND_MIN = 1.5; // 入れ替えのつなぎの最短の秒数
  function forceOrder(rec, order, dist) {
    const n = rec.n, K = rec.frames.length, dt = FIXED_DT, P = [], V = [], fin = rec.finish.slice(), swaps = [];
    for (let i = 0; i < n; i++) { P.push(new Float64Array(K)); V.push(new Float64Array(K)); for (let k = 0; k < K; k++) { P[i][k] = rec.frames[k][i]; V[i][k] = rec.speeds[k][i]; } }
    const cur = rec.order.slice();
    function tailSwap(a, b) { // a（後ろ）を b（前）より先にゴールさせる
      const first = Math.min(fin[a], fin[b]), kEnd = Math.min(K - 1, Math.floor((first - 0.4) / dt)), kStart = Math.floor(5 / dt);
      let best = -1, bestCost = Infinity, bestW = 0;
      for (let k = kStart; k <= kEnd; k++) {
        const gapM = Math.abs(P[b][k] - P[a][k]) * dist, W = Math.max(BLEND_MIN, gapM / 1.2);
        if (k * dt + W > first - 0.3) continue; // 吸収はゴールの前に終える
        const cost = gapM + 0.05 * (first - k * dt);
        if (cost < bestCost) { bestCost = cost; best = k; bestW = W; }
      }
      if (best < 0) return false;
      const D = P[b][best] - P[a][best], L = rec.length;
      /* 位置も速さも、自分の走りから相手の走りへ少しずつ移す（s: 0 → 1 のなめらかな曲線。始めと終わりの傾きは 0 ＝速さが飛ばない） */
      for (let k = best; k < K; k++) {
        const x = Math.min(1, (k - best) * dt / bestW), s = x * x * (3 - 2 * x), ds = x >= 1 ? 0 : 6 * x * (1 - x) / bestW;
        const pA = P[a][k], pB = P[b][k], vA = V[a][k], vB = V[b][k];
        P[a][k] = pA + s * (pB - pA); P[b][k] = pB + s * (pA - pB);
        V[a][k] = vA + s * (vB - vA) + L * ds * (pB - pA); V[b][k] = vB + s * (vA - vB) + L * ds * (pA - pB);
      }
      const f = fin[a]; fin[a] = fin[b]; fin[b] = f;
      swaps.push({ a, b, t: Math.round(best * dt * 100) / 100, gapM: Math.round(Math.abs(D) * dist * 100) / 100, blend: Math.round(bestW * 100) / 100 });
      return true;
    }
    for (let p = 0; p < n; p++) {
      let j = cur.indexOf(order[p]);
      while (j > p) { if (!tailSwap(cur[j], cur[j - 1])) return null; const x = cur[j]; cur[j] = cur[j - 1]; cur[j - 1] = x; j--; }
    }
    const got = order.slice().sort((x, y) => fin[x] - fin[y]);
    if (got.some((h, k) => h !== order[k])) return null;
    return { P, V, finish: fin, swaps };
  }
  function replayRun(race, seed, opt) {
    opt = opt || {};
    const rec = recordRun(race, seed), n = rec.n;
    const map = race.horses.map((_, i) => i); // map[i] = 馬 i が使う軌跡の番号（ふつうは自分の軌跡）
    let natural = true, forced = null;
    if (opt.order && opt.order.length === n && opt.order.some((h, k) => h !== rec.order[k])) {
      natural = false;
      forced = opt.legacy ? null : forceOrder(rec, opt.order, race.dist || 1000);
      if (!forced) opt.order.forEach((h, k) => { map[h] = rec.order[k]; }); // 以前の入れ替え（最初から全部）
    }
    const finishT = forced ? forced.finish.slice() : map.map((src) => rec.finish[src]), last = rec.frames.length - 1;
    const pos = new Array(n).fill(0), finish = new Array(n).fill(0), speed = new Array(n).fill(0);
    const run = { t: 0, done: 0, pos, finish, speed, length: rec.length, n, natural, seed, duration: Math.max.apply(null, finishT), winTime: Math.min.apply(null, finishT), finishTimes: finishT.slice(), swaps: forced ? forced.swaps : natural ? [] : null };
    function apply() {
      const x = Math.max(0, run.t / FIXED_DT), k = Math.min(last, Math.floor(x)), f = k >= last ? 0 : x - k, k2 = Math.min(last, k + 1);
      let done = 0;
      for (let i = 0; i < n; i++) {
        if (forced) { const Pi = forced.P[i]; pos[i] = Pi[k] + (Pi[k2] - Pi[k]) * f; speed[i] = forced.V[i][k2]; }
        else { const src = map[i]; pos[i] = rec.frames[k][src] + (rec.frames[k2][src] - rec.frames[k][src]) * f; speed[i] = rec.speeds[k2][src]; }
        if (run.t >= finishT[i]) { finish[i] = finishT[i]; done++; } else finish[i] = 0;
      }
      run.done = done;
      return done >= n;
    }
    run.step = function (dt) { run.t += Math.max(0, dt || 0); return apply(); };
    run.seek = function (t) { run.t = Math.max(0, t || 0); return apply(); };
    run.order = function () { return race.horses.map((_, i) => i).sort((a, b) => (finish[a] || 99 + a) - (finish[b] || 99 + b)); };
    run.finalOrder = function () { return race.horses.map((_, i) => i).sort((a, b) => finishT[a] - finishT[b]); };
    apply();
    return run;
  }

  return { FIXED_DT, TUNE, rng, hashSeed, recordRun, replayOrder, replayRun, PAYOUT_RATE, MAX_BET,
 BALLS_MAX, TYPES, CONDS, POOL, COATS, ROULETTE, makeRace, simulate, createRun, calcOdds, qkey, ekey, forceOrder, EX_MIN, EX_MAX, oddsColor, totalBet, payout, carrotCount, spinFood, betHorses, ballsEarned, spinRoulette, profile, baseSpeed };
});
