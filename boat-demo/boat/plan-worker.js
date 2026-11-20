/* casa BOAT: 進路の計画を、画面とは別の糸（Web Worker）で計算する（2026-11-21。不具合 I3「遅いテレビで準備の間ずっと出走表のまま」）。
   boat/race-boat.js の setRaceAsync が 2〜3 個作って、計画の「1 回分」（BOAT.Lines.planUnit。作り直しの 1 つ）を同時に計算させる。
   どの 1 回分も、乱数を使わない決まった計算なので、画面の糸で計算した時とまったく同じ答え（どのテレビでも同じ映像）。選び方は race-boat.js の Race.planJob と同じ順。
   受け取る: { id, race, seed, order, swapFrom, desc, over, preT, postT }  返す: { id, fp（走りの印。画面の糸の走りと同じか確かめる）, plan（BOAT.Lines.packPlan の形）, score, hasBeh } か { id, err } */
self.window = self;
(function () {
  const q = self.location.search || '';
  importScripts('../js/engine.js' + q, '../js/boat-model.js' + q, 'course.js' + q, 'lines.js' + q);
})();
self.onmessage = function (ev) {
  const m = ev.data || {};
  if (m.ping) { self.postMessage({ id: m.id, pong: true }); return; }
  try {
    const opt = {}; if (m.order) opt.order = m.order; if (m.swapFrom != null) opt.swapFrom = m.swapFrom;
    const run = Engine.replayRun(m.race, m.seed, opt);
    const info = Object.assign({}, m.desc || {}, { Course: BOAT.Course, preT: m.preT, postT: m.postT });
    const u = BOAT.Lines.planUnit(m.race, run, info, m.over || null);
    const plan = BOAT.Lines.packPlan(u.plan);
    self.postMessage({ id: m.id, fp: runPrint(run), plan, score: u.score, hasBeh: u.hasBeh }, buffers(plan)); // 数の並びは写さずに渡す（画面の糸で受け取る時に止まらないように）
  } catch (e) { self.postMessage({ id: m.id, err: String((e && e.message) || e) }); }
};
// 計画の中の数の並び（Float64Array など）の入れ物を、重ならないように集める
function buffers(o) { const seen = new Set(), out = []; (function walk(x) { if (!x || typeof x !== 'object') return; if (ArrayBuffer.isView(x)) { if (!seen.has(x.buffer)) { seen.add(x.buffer); out.push(x.buffer); } return; } if (Array.isArray(x)) { x.forEach(walk); return; } for (const k in x) walk(x[k]); })(o); return out; }
// 走りの印（race-boat.js にも同じ物がある）: 同じ走りなら同じ文字
function runPrint(run) { return JSON.stringify([run.natural, run.duration, run.winTime, run.finishTimes, run.swaps, run.out, run.fallT]); }
