/* casa BOAT の出走合図のファンファーレ（自作 3 曲）と、合図の音（ピットのブザー・お知らせのチャイム・勝者の短い音楽）。素材ファイルなし（その場で合成）。
   本物の曲は使わない・写さない（JASRAC 管理外で、権利者の許しが無い。ref/boat/research/10 ⑤）。本物から使ったのは「型」だけ（10 ⑧ 8-1・8-6 の実測）:
     長さ 17〜18.5 秒・長調・出だしは主音と 5 度だけ（3 度なし）の強いのばし 約 2 秒・中ほど（全体の 65〜80%）に 0.22〜0.28 秒きざみの細かい動き・
     最後は主和音を全体の約 15%（2.5〜3 秒）のばして切る・金管の合奏（2,000〜3,500Hz まで倍音が強く、上は急に弱い）・低音 82〜110Hz・出だしより終わりが約 7dB 大きい。
     ふだんのレースは速く軽く（実測 1 分 112 拍の 4 拍子）、ビッグレースは遅く重く（実測 1 分 82 拍で 1 拍を 3 つに割る）。調は本物（D・A）を避けた。
   曲（旋律・和音の順）はこのファイルで新しく作ったもの。
     A … ふだん用。1 分 112 拍・4 拍子・変ロ長調・8 小節＋のばし（約 18 秒）
     B … ビッグレース用。1 分 82 拍・1 拍を 3 つ割り・変ホ長調。途中で調の外の和音（♭VI→iv）に寄って緊張を上げる（約 18 秒）
     C … ふだん用の別案。1 分 116 拍・4 拍子・ヘ長調。終わり前に主和音の第 2 転回→属七（約 17.5 秒）
   使い方: BOAT.Fanfare.play(ctx, dest, when, 'A') → 長さ（秒）を返す。ctx は AudioContext でも OfflineAudioContext でもよい（音のファイル書き出しに使う）。 */
(function (root) {
  'use strict';
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // 楽譜: unit = 1 単位の秒。notes: [始まり, 長さ, MIDI 番号, 強さ 0〜1]。parts の楽器: tp（トランペット）・hn（ホルン）・tb（トロンボーン）・bs（低音）
  // hits: ['timp', 始まり, MIDI, 強さ] / ['roll', 始まり, 長さ, MIDI, 強さ0, 強さ1] / ['cym', 始まり, 強さ] / ['swell', 始まり, 長さ]
  const S = {};
  const ch = (t, d, ms, v) => ms.map((m) => [t, d, m, v == null ? 0.7 : v]);
  // ---- A: ふだん用（変ロ長調 112）----
  S.A = {
    unit: 60 / 112, end: 33, rel: 0.6, gain0: 0.6,
    tp: [ // 1 番トランペット（旋律）＋ 2 番（3 度・6 度下の重ね）
      [0, 3, 70, 1], [0, 3, 77, 0.9], [3, 0.5, 65, 0.8], [3.5, 0.5, 70, 0.85],
      [4, 1.5, 74, 0.9], [5.5, 0.5, 72, 0.75], [6, 1, 75, 0.85], [7, 1, 79, 0.9],
      [8, 2, 77, 0.9], [10, 1, 74, 0.8], [11, 1, 70, 0.8],
      [12, 1.5, 72, 0.85], [13.5, 0.5, 74, 0.75], [14, 1, 75, 0.85], [15, 1, 77, 0.9],
      [16, 2, 82, 0.95], [18, 0.5, 81, 0.8], [18.5, 0.5, 79, 0.8], [19, 1, 77, 0.85],
      [20, 0.5, 75, 0.8], [20.5, 0.5, 77, 0.8], [21, 0.5, 79, 0.85], [21.5, 0.5, 77, 0.8], [22, 0.5, 75, 0.85], [22.5, 0.5, 74, 0.8], [23, 0.5, 72, 0.85], [23.5, 0.5, 74, 0.85],
      [24, 1.5, 81, 0.95], [25.5, 0.5, 79, 0.85], [26, 0.5, 77, 0.85], [26.5, 0.5, 79, 0.9], [27, 1, 81, 0.95],
      [28, 5, 82, 1],
      // 2 番
      [4, 2, 70, 0.7], [6, 1, 70, 0.7], [7, 1, 75, 0.7], [8, 2, 74, 0.7], [10, 1, 70, 0.65], [11, 1, 67, 0.65],
      [12, 1.5, 67, 0.7], [13.5, 0.5, 70, 0.6], [14, 1, 72, 0.7], [15, 1, 69, 0.7], [16, 2, 77, 0.75], [18, 1, 72, 0.7], [19, 1, 74, 0.7],
      [20, 2, 67, 0.65], [22, 2, 67, 0.65], [24, 1.5, 77, 0.75], [25.5, 0.5, 75, 0.7], [26, 1, 72, 0.7], [27, 1, 75, 0.75], [28, 5, 77, 0.85], [28, 5, 74, 0.7]],
    hn: [].concat(ch(0, 3, [58, 65]), ch(4, 2, [62, 65]), ch(6, 2, [63, 67]), ch(8, 2, [62, 65]), ch(10, 2, [62, 67]), ch(12, 2, [63, 67]), ch(14, 2, [63, 69]),
      ch(16, 2, [62, 65]), ch(18, 1, [60, 65]), ch(19, 1, [62, 65]), ch(20, 2, [58, 63]), ch(22, 2, [60, 63]), ch(24, 4, [63, 69]), ch(28, 5, [62, 65, 70], 0.85)),
    tb: [].concat(ch(0, 3, [46, 53]), ch(4, 2, [46, 53]), ch(6, 2, [51, 55]), ch(8, 2, [46, 53]), ch(10, 2, [43, 50]), ch(12, 2, [48, 55]), ch(14, 2, [41, 48]),
      ch(16, 2, [46, 53]), ch(18, 1, [41, 48]), ch(19, 1, [50, 53]), ch(20, 2, [51, 55]), ch(22, 2, [48, 55]), ch(24, 4, [41, 48]), ch(28, 5, [46, 53, 50], 0.85)),
    bs: [[0, 3, 46, 0.9], [4, 2, 46, 0.8], [6, 2, 39, 0.8], [8, 2, 46, 0.8], [10, 2, 43, 0.8], [12, 2, 48, 0.8], [14, 2, 41, 0.8], [16, 2, 46, 0.85], [18, 1, 41, 0.8], [19, 1, 38, 0.8],
      [20, 2, 39, 0.8], [22, 2, 36, 0.8], [24, 4, 41, 0.9], [28, 5, 46, 1]],
    hits: [['cym', 0, 0.8], ['roll', 0, 3, 41, 0.15, 0.6], ['timp', 4, 46, 0.6], ['timp', 8, 46, 0.55], ['timp', 12, 41, 0.5], ['timp', 16, 46, 0.65],
      ['timp', 20, 41, 0.5], ['timp', 22, 41, 0.55], ['timp', 23, 41, 0.6], ['timp', 23.5, 41, 0.65], ['roll', 26, 2, 41, 0.3, 0.85], ['cym', 28, 1], ['timp', 28, 46, 1], ['roll', 28.5, 4.3, 46, 0.5, 0.9]],
  };
  // ---- B: ビッグレース用（変ホ長調 82、3 つ割り）----
  S.B = {
    unit: 60 / 82 / 3, end: 72, rel: 0.5, gain0: 0.6,
    tp: [[0, 9, 75, 1], [0, 9, 70, 0.9],
      [9, 2, 70, 0.85], [11, 1, 75, 0.8], [12, 3, 79, 0.9], [15, 2, 77, 0.85], [17, 1, 75, 0.8], [18, 3, 82, 0.95],
      [21, 2, 84, 0.95], [23, 1, 82, 0.85], [24, 3, 80, 0.9], [27, 2, 79, 0.85], [29, 1, 77, 0.8],
      [30, 6, 78, 0.95], [36, 2, 75, 0.85], [38, 1, 78, 0.85], [39, 3, 80, 0.9],
      [42, 4, 82, 0.95], [46, 1, 80, 0.85], [47, 1, 77, 0.85],
      [48, 1, 79, 0.85], [49, 1, 80, 0.8], [50, 1, 82, 0.85], [51, 1, 75, 0.8], [52, 1, 77, 0.8], [53, 1, 79, 0.85], [54, 1, 80, 0.85], [55, 1, 82, 0.85], [56, 1, 84, 0.9],
      [57, 1, 82, 0.9], [58, 1, 84, 0.9], [59, 1, 86, 0.95],
      [60, 12, 87, 1],
      // 2 番
      [9, 2, 67, 0.65], [11, 1, 70, 0.6], [12, 3, 75, 0.7], [15, 2, 74, 0.7], [17, 1, 70, 0.6], [18, 3, 79, 0.75],
      [21, 2, 80, 0.75], [23, 1, 79, 0.7], [24, 3, 75, 0.7], [27, 2, 75, 0.7], [29, 1, 74, 0.65],
      [30, 6, 75, 0.75], [36, 3, 71, 0.7], [39, 3, 75, 0.7], [42, 4, 77, 0.75], [46, 2, 74, 0.7],
      [48, 6, 75, 0.7], [54, 3, 75, 0.7], [57, 3, 74, 0.75], [60, 12, 82, 0.85], [60, 12, 79, 0.75]],
    hn: [].concat(ch(0, 9, [63, 58]), ch(9, 6, [58, 63, 67]), ch(15, 3, [58, 62, 65]), ch(18, 3, [58, 63, 67]), ch(21, 6, [56, 60, 63]), ch(27, 3, [56, 62, 65]),
      ch(30, 6, [59, 63, 66], 0.8), ch(36, 6, [56, 59, 63], 0.8), ch(42, 6, [56, 62, 65]), ch(48, 6, [58, 63, 67]), ch(54, 3, [56, 60, 63]), ch(57, 3, [56, 62, 65]), ch(60, 12, [63, 67, 70], 0.9)),
    tb: [].concat(ch(0, 9, [51, 46]), ch(9, 6, [51, 55]), ch(15, 3, [50, 53]), ch(18, 3, [51, 55]), ch(21, 6, [44, 51]), ch(27, 3, [46, 53]),
      ch(30, 6, [47, 54], 0.8), ch(36, 6, [44, 51], 0.8), ch(42, 6, [46, 53]), ch(48, 6, [51, 55]), ch(54, 3, [44, 51]), ch(57, 3, [46, 53]), ch(60, 12, [51, 46, 55], 0.9)),
    bs: [[0, 9, 39, 0.9], [9, 6, 39, 0.8], [15, 3, 38, 0.8], [18, 3, 39, 0.8], [21, 6, 44, 0.85], [27, 3, 46, 0.8], [30, 6, 47, 0.9], [36, 6, 44, 0.9], [42, 6, 46, 0.9],
      [48, 6, 39, 0.85], [54, 3, 44, 0.85], [57, 3, 46, 0.9], [60, 12, 39, 1]],
    hits: [['cym', 0, 0.9], ['roll', 0, 9, 46, 0.15, 0.7], ['timp', 9, 51, 0.6], ['timp', 18, 51, 0.6], ['timp', 21, 44 + 12, 0.5], ['swell', 30, 6], ['timp', 36, 44 + 12, 0.55],
      ['roll', 39, 3, 46, 0.3, 0.7], ['timp', 42, 46, 0.8], ['timp', 45, 46, 0.6], ['timp', 48, 51, 0.6], ['roll', 57, 3, 46, 0.4, 0.9], ['cym', 60, 1], ['timp', 60, 51, 1], ['roll', 61, 10.5, 51, 0.5, 0.95]],
  };
  // ---- C: ふだん用の別案（ヘ長調 116）----
  S.C = {
    unit: 60 / 116, end: 33, rel: 0.6, gain0: 0.6,
    tp: [[0, 3, 77, 1], [0, 3, 72, 0.9], [3, 0.5, 72, 0.8], [3.5, 0.5, 72, 0.85],
      [4, 1, 77, 0.9], [5, 0.5, 72, 0.75], [5.5, 0.5, 77, 0.8], [6, 1.5, 81, 0.95], [7.5, 0.5, 79, 0.8],
      [8, 1, 77, 0.85], [9, 1, 74, 0.8], [10, 1, 77, 0.85], [11, 1, 82, 0.9],
      [12, 1.5, 81, 0.9], [13.5, 0.5, 79, 0.8], [14, 1, 76, 0.85], [15, 1, 72, 0.8],
      [16, 0.5, 74, 0.8], [16.5, 0.5, 76, 0.8], [17, 1, 77, 0.85], [18, 0.5, 79, 0.85], [18.5, 0.5, 81, 0.85], [19, 1, 82, 0.9],
      [20, 0.5, 84, 0.95], [20.5, 0.5, 82, 0.85], [21, 0.5, 81, 0.85], [21.5, 0.5, 79, 0.8], [22, 0.5, 81, 0.85], [22.5, 0.5, 79, 0.85], [23, 0.5, 77, 0.8], [23.5, 0.5, 76, 0.85],
      [24, 0.5, 77, 0.85], [24.5, 0.5, 79, 0.85], [25, 1, 81, 0.9], [26, 1, 84, 0.95], [27, 0.5, 82, 0.9], [27.5, 0.5, 79, 0.9],
      [28, 5, 81, 1],
      [4, 1, 72, 0.65], [5, 0.5, 69, 0.6], [5.5, 0.5, 72, 0.6], [6, 1.5, 77, 0.7], [7.5, 0.5, 76, 0.65], [8, 1, 74, 0.65], [9, 1, 70, 0.6], [10, 1, 74, 0.65], [11, 1, 77, 0.7],
      [12, 1.5, 77, 0.7], [13.5, 0.5, 76, 0.65], [14, 1, 72, 0.65], [15, 1, 67, 0.6], [16, 1, 69, 0.6], [17, 1, 74, 0.65], [18, 1, 74, 0.65], [19, 1, 77, 0.7],
      [20, 2, 77, 0.7], [22, 2, 76, 0.7], [24, 1, 74, 0.65], [25, 1, 77, 0.7], [26, 1, 76, 0.7], [27, 1, 76, 0.7], [28, 5, 77, 0.85], [28, 5, 72, 0.75]],
    hn: [].concat(ch(0, 3, [60, 65]), ch(4, 4, [57, 60, 65]), ch(8, 4, [58, 62, 65]), ch(12, 4, [60, 64, 67]), ch(16, 2, [57, 62, 65]), ch(18, 2, [58, 62, 65]),
      ch(20, 2, [57, 60, 65]), ch(22, 2, [58, 64, 67]), ch(24, 2, [57, 60, 65]), ch(26, 2, [58, 64, 67]), ch(28, 5, [60, 65, 69], 0.9)),
    tb: [].concat(ch(0, 3, [53, 48]), ch(4, 4, [48, 53]), ch(8, 4, [50, 53]), ch(12, 4, [48, 55]), ch(16, 2, [50, 53]), ch(18, 2, [43, 50]),
      ch(20, 2, [48, 53]), ch(22, 2, [48, 52]), ch(24, 2, [50, 53]), ch(26, 2, [48, 52]), ch(28, 5, [53, 48, 57], 0.9)),
    bs: [[0, 3, 41, 0.9], [4, 4, 41, 0.8], [8, 4, 46, 0.8], [12, 4, 36, 0.85], [16, 2, 38, 0.8], [18, 2, 43, 0.8], [20, 4, 36, 0.9], [24, 2, 38, 0.85], [26, 2, 36, 0.9], [28, 5, 41, 1]],
    hits: [['cym', 0, 0.85], ['roll', 0, 3, 48, 0.15, 0.6], ['timp', 4, 41, 0.6], ['timp', 6, 41, 0.45], ['timp', 8, 46 - 12 + 12, 0.55], ['timp', 12, 48, 0.6], ['timp', 14, 48, 0.45],
      ['timp', 16, 50 - 12, 0.5], ['timp', 18, 43, 0.5], ['timp', 20, 48, 0.6], ['timp', 21, 48, 0.5], ['timp', 22, 48, 0.6], ['timp', 23, 48, 0.65], ['roll', 26, 2, 48, 0.3, 0.85],
      ['cym', 28, 1], ['timp', 28, 41, 1], ['roll', 28.5, 4.3, 41, 0.5, 0.9]],
  };
  // ---- 勝者の短い音楽（ビッグレースだけ。本物は優勝戦でゴールの 10〜25 秒後に音楽。ゲームはゴール後 8 秒なので 3 秒に）----
  S.W = {
    unit: 60 / 132 / 3, end: 15, rel: 0.6, gain0: 0.85,
    tp: [[0, 1, 70, 0.85], [1, 1, 75, 0.85], [2, 1, 79, 0.9], [3, 12, 82, 1], [3, 12, 79, 0.8], [3, 12, 75, 0.75]],
    hn: ch(3, 12, [63, 67, 70], 0.85), tb: ch(3, 12, [51, 46, 55], 0.85), bs: [[3, 12, 39, 1]],
    hits: [['cym', 3, 0.9], ['timp', 3, 51, 1], ['roll', 4, 10, 51, 0.4, 0.8]],
  };
  const INST = { // 楽器ごとの音色（のこぎり波 2 本＋ローパスの開き方）
    tp: { det: 7, att: 0.035, cut: [1.6, 11, 6.5], cmax: 3600, q: 1.3, vol: 0.16, vib: 0.0045, scoop: 35 },
    hn: { det: 9, att: 0.07, cut: [1.2, 5, 3.6], cmax: 1700, q: 0.9, vol: 0.1, vib: 0.002, scoop: 15 },
    tb: { det: 8, att: 0.05, cut: [1.4, 7, 4.5], cmax: 1500, q: 1.0, vol: 0.12, vib: 0.0015, scoop: 20 },
    bs: { det: 5, att: 0.06, cut: [1.2, 5, 3.5], cmax: 700, q: 0.8, vol: 0.2, vib: 0, scoop: 0 },
  };
  let noiseBuf = null, revBuf = null;
  function noise(ctx) { if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf; const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return (noiseBuf = b); }
  // 広い場所の響き（2 秒で消える）。左右で別の雑音
  function reverb(ctx) {
    if (revBuf && revBuf.sampleRate === ctx.sampleRate) return revBuf;
    const n = Math.round(ctx.sampleRate * 2.2), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0; for (let i = 0; i < n; i++) { const t = i / ctx.sampleRate; lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp * Math.exp(-t / 0.5) * (t < 0.012 ? t / 0.012 : 1); } }
    return (revBuf = b);
  }
  /* 途中から鳴らす（2026-11-23。boat/sound.js の cue: 映像の準備が遅れたテレビ・読み込み直したテレビは、ほかの店と同じ位置から入る）: play の when に「もう過ぎた時刻」を渡すと、
     鳴り終わっている音は作らず（下の gone）、鳴っている途中の音は「いま」から残りの長さだけ、これからの音は時刻どおりに鳴る。
     音の予約に「過ぎた時刻」は渡さない（読み込み直した直後のテレビは音の時計が 0 秒に近く、頭の時刻がマイナスになって予約が失敗し、何も鳴らなかった。測り: tests/boat-tv-sound.plan.js の D）。
     ファイル書き出し（OfflineAudioContext。currentTime ＝ 0）では何も飛ばさない・何も変わらない */
  const gone = (ctx, tEnd) => tEnd < ctx.currentTime;
  function brass(ctx, out, t, dur, midi, vel, I) {
    const now = ctx.currentTime, joined = t < now;
    if (joined) { dur -= now - t; t = now; if (dur < 0.06) return; } // 途中から: いまから残りの長さだけ（残りが短すぎる音は鳴らさない）
    const f = hz(midi), end = t + dur, rel = dur < 0.4 ? 0.07 : 0.18;
    const g = ctx.createGain(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = I.q;
    const c0 = Math.min(I.cmax, f * I.cut[0]), c1 = Math.min(I.cmax * 1.3, f * I.cut[1] * (0.6 + 0.4 * vel)), c2 = Math.min(I.cmax, f * I.cut[2] * (0.6 + 0.4 * vel));
    lp.frequency.setValueAtTime(c0, t); lp.frequency.linearRampToValueAtTime(c1, t + I.att + 0.02); lp.frequency.setTargetAtTime(c2, t + I.att + 0.02, 0.12);
    lp.frequency.setTargetAtTime(c0, end, rel * 0.6);
    const a = I.vol * vel;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + I.att); g.gain.setTargetAtTime(a * 0.78, t + I.att, 0.15); g.gain.setValueAtTime(a * 0.78, end); g.gain.setTargetAtTime(0, end, rel / 3);
    lp.connect(g); g.connect(out);
    [-1, 1].forEach((s) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = s * I.det;
      if (I.scoop && !joined) { o.frequency.setValueAtTime(f * Math.pow(2, -I.scoop / 1200), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); } else o.frequency.value = f; // 途中から入る音は、しゃくり上げなし
      if (I.vib && dur > 0.6) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.3; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * I.vib, t + 0.5); l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(end + rel + 0.1); }
      o.connect(lp); o.start(t); o.stop(end + rel + 0.1);
    });
  }
  function timp(ctx, out, t, midi, vel) {
    if (gone(ctx, t + 0.05)) return; // 打つ音は頭が大事: 打つ瞬間を過ぎていたら鳴らさない
    t = Math.max(t, ctx.currentTime);
    const f = hz(midi), o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.04, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.006); g.gain.setTargetAtTime(0, t + 0.01, 0.45);
    const o2 = ctx.createOscillator(), g2 = ctx.createGain(); o2.frequency.value = f * 1.5; g2.gain.setValueAtTime(0.15 * vel, t); g2.gain.setTargetAtTime(0, t, 0.2); o2.connect(g2); g2.connect(out); o2.start(t); o2.stop(t + 1.5);
    const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain(); n.buffer = noise(ctx); nf.type = 'lowpass'; nf.frequency.value = 500; ng.gain.setValueAtTime(0.35 * vel, t); ng.gain.setTargetAtTime(0, t, 0.025);
    n.connect(nf); nf.connect(ng); ng.connect(out); n.start(t, Math.random()); n.stop(t + 0.3);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 2.5);
  }
  function cym(ctx, out, t, vel, swell) {
    if (gone(ctx, swell ? t + swell - 0.1 : t + 0.05)) return; // 途中から: 打ったあとのシンバルは鳴らさない（だんだん強くなる方は、山の前なら残りの長さで）
    { const now = ctx.currentTime; if (t < now) { if (swell) swell -= now - t; t = now; } }
    const n = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = noise(ctx); n.loop = true;
    hp.type = 'highpass'; hp.frequency.value = 3800; pk.type = 'peaking'; pk.frequency.value = 7500; pk.gain.value = 6; pk.Q.value = 0.8;
    if (swell) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + swell); g.gain.setTargetAtTime(0, t + swell, 0.08); }
    else { g.gain.setValueAtTime(0.16 * vel, t); g.gain.setTargetAtTime(0, t + 0.01, 0.9); }
    n.connect(hp); hp.connect(pk); pk.connect(g); g.connect(out); n.start(t, Math.random()); n.stop(t + (swell || 0) + 4);
  }
  // 1 曲を ctx の when から鳴らす。戻り値は長さ（秒）
  function play(ctx, dest, when, id, vol) {
    const s = S[id] || S.A, u = s.unit, total = s.end * u + s.rel;
    const bus = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), cv = ctx.createConvolver(), shelf = ctx.createBiquadFilter();
    cv.buffer = reverb(ctx); dry.gain.value = 1; wet.gain.value = 0.32;
    shelf.type = 'lowpass'; shelf.frequency.value = 7000; // 3,500Hz より上は弱く（実測の形）。上の端だけ切る
    // だんだん強く: 頭は終わりの −7dB（gain0 ≒ 0.45）
    const v = vol == null ? 1 : vol, endT = when + s.end * u, now = ctx.currentTime, upT = Math.max(when + 0.1, endT - (s.end - (s.end * 0.85)) * u);
    if (when >= now) bus.gain.setValueAtTime(v * s.gain0, when);
    else bus.gain.setValueAtTime(v * (s.gain0 + (1 - s.gain0) * Math.min(1, (now - when) / (upT - when))), now); // 途中から: その位置の強さから
    if (upT > now) bus.gain.linearRampToValueAtTime(v, upT);
    bus.gain.setValueAtTime(v, Math.max(now, endT)); bus.gain.linearRampToValueAtTime(0, Math.max(now, endT) + s.rel);
    bus.connect(shelf); shelf.connect(dry); shelf.connect(cv); cv.connect(wet); dry.connect(dest); wet.connect(dest);
    ['tp', 'hn', 'tb', 'bs'].forEach((k) => (s[k] || []).forEach(([a, d, m, vel]) => { const end = Math.min(a + d, s.end); brass(ctx, bus, when + a * u, (end - a) * u, m, vel, INST[k]); }));
    (s.hits || []).forEach((h) => {
      if (h[0] === 'timp') timp(ctx, bus, when + h[1] * u, h[2], h[3]);
      else if (h[0] === 'cym') cym(ctx, bus, when + h[1] * u, h[2]);
      else if (h[0] === 'swell') cym(ctx, bus, when + h[1] * u, 1, h[2] * u);
      else if (h[0] === 'roll') { const t0 = h[1] * u, dur = h[2] * u, step = 1 / 14; for (let x = 0; x < dur; x += step) { const k = x / dur; timp(ctx, bus, when + t0 + x + (Math.random() - 0.5) * 0.01, h[3], (h[4] + (h[5] - h[4]) * k) * (0.85 + Math.random() * 0.15) * 0.55); } }
    });
    return total;
  }
  // ピットの発走の合図（ブザー 3 回。3 回目で出走。資料 10 2-4。高さと間隔は資料に無い＝仮: 0.6 秒鳴らして 1.0 秒おき）
  function buzzer(ctx, dest, when, vol) {
    for (let k = 0; k < 3; k++) {
      if (gone(ctx, when + k * 1.0 + 0.08)) continue; // 途中から（2026-11-23）: もう始まっている回は鳴らさない（半端な長さのブザーを出さない）
      const t = Math.max(when + k * 1.0, ctx.currentTime), o = ctx.createOscillator(), o2 = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 220; o2.type = 'square'; o2.frequency.value = 223; bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.9;
      const a = (vol == null ? 1 : vol) * 0.09; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.01); g.gain.setValueAtTime(a, t + 0.6); g.gain.linearRampToValueAtTime(0, t + 0.62);
      o.connect(bp); o2.connect(bp); bp.connect(g); g.connect(dest); o.start(t); o2.start(t); o.stop(t + 0.7); o2.stop(t + 0.7);
    }
    return 2.6;
  }
  // お知らせのチャイム（平和島・江戸川・多摩川・びわこはフライングの告知の前に鳴る。市販の放送用チャイムの 4 音。資料 10 2-5）
  function chime(ctx, dest, when, vol) {
    [77, 81, 84, 89].forEach((m, k) => {
      const t = when + k * 0.36, f = hz(m), g = ctx.createGain(), a = (vol == null ? 1 : vol) * 0.12;
      [[1, 1], [2.76, 0.25], [5.4, 0.08]].forEach(([r, w]) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * r; const og = ctx.createGain(); og.gain.value = w; o.connect(og); og.connect(g); o.start(t); o.stop(t + 2.2); });
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.005); g.gain.setTargetAtTime(0, t + 0.01, 0.5); g.connect(dest);
    });
    return 2.4;
  }
  const API = { play, buzzer, chime, length(id) { const s = S[id] || S.A; return s.end * s.unit + s.rel; }, SCORES: S };
  root.BOAT = root.BOAT || {}; root.BOAT.Fanfare = API;
})(typeof window !== 'undefined' ? window : globalThis);
