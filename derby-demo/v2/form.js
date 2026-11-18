/* casa DERBY 出馬表の「脚質」と「直近の成績（近走の着順）」・オッズの倍率の書き方（2026-10-19 オーナー
   「出走表には直近の成績と、逃げとかの特徴は書いていいよ」「オッズ表記は倍率にしよう」）。テレビ（v2/tv.js）とお客さんのスマホ（v2/bet.js）で同じものを使う。
   window.DerbyForm（node では module.exports）

   脚質: 馬のデータの type（逃げ・先行・差し・追込）。レースの走り方のモデル（js/engine.js の profile）そのもの＝本当の特徴。

   直近の成績: 本物の前のレースの着順は使わない。理由:
     - レースは発走の約 15 分前に作る（時刻表の先読み）ので、作るときには直前の 2〜3 レースの着順がまだ決まっていない
     - テレビ・スマホは「いま・直前・次」のレースしか受け取らないので、何レースも前の着順を全店で同じに出すには、
       レースのデータ（Firebase に保存する形）に足す必要がある（今回は表示だけの直しにとどめる）
   → 馬ごとに決まった種（馬名＋営業日。朝 5 時で切り替わる）から作った「それらしい成績」。同じ日なら、どのレース・どのテレビ・どのスマホでも同じ。
     作り方: 能力 ★（スピード・スタミナ・パワーの平均）が馬の一覧の平均（約 3.4）より高いほど平均の着順が上（★4.3 で平均約 1.8 着、★2 で約 6 着の側に寄る）、
     ゆらぎ ±1.8 着ほど。6 頭立てで 1〜6 着がほぼ同じ割合・平均はおよそ 3.5 着（1 つのレースで「1-1-1」の馬が何頭も並ぶような、ありえない成績にならないように）。勝ち馬の決め方（裏の調整）・そのレースの結果とは関係しない
     （オッズも同じ能力から作っているので、オッズと食い違いにくい）。past[0] が前走（いちばん新しい）。

   オッズの倍率: 0.1 刻みの倍率をいつも小数 1 桁で（v4 の 2 連単は 1.0〜999.9。例 2.4 → "2.4"、15 → "15.0"）。当選額は payFor（100pt × 倍率 の 100pt 切り上げ）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DerbyForm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TYPES = { nige: { label: '逃げ', color: '#ff8a65' }, senko: { label: '先行', color: '#ffd54f' }, sashi: { label: '差し', color: '#81d4fa' }, oikomi: { label: '追込', color: '#ce93d8' } };
  const typeOf = (h) => TYPES[h && h.type] || { label: '', color: '#ccc' };
  // 種（FNV-1a）と乱数（mulberry32）。js/engine.js の hashSeed・rng と同じ形
  function hash() { let h = 2166136261 >>> 0; for (let k = 0; k < arguments.length; k++) { const s = String(arguments[k]); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } h ^= 0x2c; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function rng(seed) { let a = (seed >>> 0) || 0x9e3779b9; return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v); }
  // 営業日（日本時間・朝 h 時で切り替え）の "YYYY-MM-DD"
  function dayKey(ms, h) { h = h == null || !Number.isFinite(Number(h)) ? 5 : Number(h); return new Date((Number(ms) || 0) + 9 * 3600e3 - h * 3600e3).toISOString().slice(0, 10); }
  const N = 5, AVG_STARS = 3.4; // AVG_STARS: js/engine.js の馬の一覧（16 頭）の能力の平均
  /* 馬 h（name と能力 spd/sta/pow、なければ stars）・レースの発走時刻 at → { past: [前走, 2走前, …5走前], recent: 近 3 走, mark: ◎○▲ }。n 頭立て（既定 6） */
  function formOf(h, at, dayStartHour, n) {
    n = n || 6;
    const stars = h && h.spd != null && h.sta != null && h.pow != null ? (Number(h.spd) + Number(h.sta) + Number(h.pow)) / 3 : Number(h && h.stars) || 3;
    const r = rng(hash('form', (h && h.name) || '', dayKey(at, dayStartHour)));
    const past = [];
    const mean = (n + 1) / 2 - (stars - AVG_STARS) * 2.0;
    for (let k = 0; k < N; k++) past.push(Math.max(1, Math.min(n, Math.round(mean + 1.8 * gauss(r)))));
    const wins = past.filter((p) => p === 1).length, places = past.filter((p) => p <= 2).length;
    return { past, recent: past.slice(0, 3), mark: wins >= 2 ? '◎' : places >= 2 ? '○' : places >= 1 ? '▲' : '' };
  }
  /* 当選額（v4・2026-10-21）: 1 票 100pt × 倍率 を 100pt 単位に切り上げ（v2/outcome.js の payFor と同じ。例 12.4 倍 → 1,300pt）。確認画面の「当たれば 1,300pt」に使う */
  function payFor(o) { const t = Math.max(10, Math.round(Number(o) * 10)); return Number.isFinite(t) ? Math.ceil(t / 10 - 1e-9) * 100 : 0; }
  // オッズの倍率（数字だけ）。0・なしは "—"
  function odds(o) { const v = Number(o); return v > 0 ? (Math.round(v * 10) / 10).toFixed(1) : '—'; }
  return { TYPES, typeOf, hash, rng, dayKey, formOf, odds, payFor, N };
});
