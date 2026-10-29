/* casa DERBY テレビの調子（2026-10-29 オーナー「現場が電波悪いんだって気づければいい」）: window.DerbyTvHealth（node でも require できる）
   テレビ（v2/tv.js）が、もうしている通信と映像の様子を数えておき、5 分ごとの名乗り（derbyTvs/<uid> ／ 模擬は POST /api/tv/hello）に h として一緒に送る。
   通信を増やさない・テレビの画面は変えない。毎コマの仕事はレースの間だけ（数を 1 つ足すだけ）。
   管理画面（v2/admin.js のテレビのタブ）は label() で「電波 ○点（良い／ふつう／悪い）」「なめらかさ ○点（なめらか／少しカクつく／カクつく）」にする。

   h の形（v: 1。ルール v2/firestore.rules の tvHealthOk と同じ。全部の項目がいつもある）:
     v 1 ／ up 起動してからの分 ／ ver アプリの版（b158 など。読めなければ ''）／ q 画質（localStorage 'casa.derby.q'。'' ＝標準）／ r 進行役 'p'・予備 'b'・どちらでもない ''
     直近 5 分の通信: n 測った回数 ／ lat 返事までの時間のまん中（ms）／ lmax いちばん遅い返事（ms）／ f 失敗・返事なし・手元の写しで返った回数 ／
                     off 切れた回数 ／ offs 切れていた秒（いま切れている分も）
     端末の回線（navigator.connection。無ければ '' と 0）: ct 種類（4g など）／ dl 速さ（Mbps）／ rtt 端末の見積もりの往復（ms）
     直近 5 分の映像（3D が動いている間だけ）: fps 1 秒あたりのコマ ／ as 動いていた秒 ／ j 0.1 秒以上かかったコマ（重い処理の回数）
     rs 直近のレース（新しい順に 5 つまで。ゲートインからゴール・勝ち馬のアップまで）: id レース ／ at 始まり（端末の時計 ms）／ d 長さ（秒）／ fr コマ数 ／ fps ／
        md 1 コマの時間のまん中（ms）／ p95 遅いほう 5% の 1 コマ（ms）／ h1 0.1 秒以上止まった回数 ／ h2 0.25 秒以上止まった回数 ／ mx いちばん長く止まった時間（ms）／ off そのレースの間に切れていた秒

   点数（0〜100。管理画面で大きく出す。言葉は点数から）:
     電波 ＝ 100 − 遅れ（まん中が 300ms を超えた分 40ms ごとに 1 点。最大 60）− 失敗 1 回 15 点（最大 45）− 切れていた秒 1 秒 0.5 点（最大 60）− 切れた回数 1 回 5 点（最大 20）
            80 点以上 良い ／ 50 点以上 ふつう ／ それより下 悪い。5 分の間に一度でも切れたら「切れていた」の印も出す。測った回数が 0 で切れてもいなければ点数なし（「測っていません」）
     なめらかさ（1 レース）＝ 1 秒あたりのコマ ÷ 30 × 100（30 コマで満点）− 0.1 秒以上の止まり 1 回 3 点（最大 30）− 0.25 秒以上の止まり 1 回さらに 7 点（最大 35）
            − いちばん長い止まりが 0.25 秒を超えた分 50ms ごとに 1 点（最大 30）。80 点以上 なめらか ／ 55 点以上 少しカクつく ／ それより下 カクつく。
            直近のレースの平均点も出す（rs の点数の平均） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DerbyTvHealth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const WIN = 5 * 60000, MAX_OPS = 200, MAX_RACES = 5, MAX_FRAMES = 20000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const int = (v, a, b) => clamp(Math.round(Number(v) || 0), a, b);
  const num1 = (v, a, b) => clamp(Math.round((Number(v) || 0) * 10) / 10, a, b);
  const str = (v, n, re) => { const s = String(v == null ? '' : v).slice(0, n); return re && !re.test(s) ? '' : s; };
  const RACE_ID_RE = /^[A-Za-z0-9_:.-]{1,48}$/;
  function pct(a, f) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; }

  /* 1 レースのコマの時間（ms の並び）から、まとめの数字にする */
  function frameStats(gaps, durMs) {
    const g = (gaps || []).filter((x) => x > 0 && isFinite(x)), dur = durMs > 0 ? durMs : g.reduce((a, b) => a + b, 0);
    let h1 = 0, h2 = 0, mx = 0; g.forEach((x) => { if (x > 100) h1++; if (x > 250) h2++; if (x > mx) mx = x; });
    return { d: int(dur / 1000, 0, 600), fr: int(g.length, 0, 100000), fps: num1(dur > 0 ? g.length / (dur / 1000) : 0, 0, 240), md: num1(pct(g, 0.5), 0, 10000), p95: num1(pct(g, 0.95), 0, 10000), h1: int(h1, 0, 10000), h2: int(h2, 0, 10000), mx: int(mx, 0, 600000) };
  }

  /* 集める係（テレビ）。clock: ms の時計（ふだんは Date.now） */
  function create(o) {
    o = o || {};
    const clock = o.clock || (() => Date.now()), t0 = clock();
    const S = { ops: [], downAt: 0, offs: [], fps: [], j: [], races: [], cur: null };
    const prune = (t) => {
      const lo = t - WIN;
      while (S.ops.length && (S.ops[0][0] < lo || S.ops.length > MAX_OPS)) S.ops.shift();
      while (S.offs.length && S.offs[0][1] < lo - WIN) S.offs.shift(); // レースの間の切れた秒にも使うので 10 分ぶん残す
      while (S.fps.length && S.fps[0][0] < lo) S.fps.shift();
      while (S.j.length && S.j[0] < lo) S.j.shift();
    };
    const H = {
      extra: null, // テレビが付ける { ver, q, r }（v2/tv.js）
      /* 通信 1 回: label（読み・書きの名前）・ms（返事までの時間）・ok（返事が来た。返事なし・つながらない・手元の写しで返った＝false） */
      note(label, ms, ok) { const t = clock(); S.ops.push([t, Math.max(0, Number(ms) || 0), ok ? 1 : 0]); prune(t); },
      /* つながっているか（見張りの知らせ・端末のオフライン）。切れた → つながった で 1 回 */
      link(up) {
        const t = clock();
        if (!up && !S.downAt) S.downAt = t;
        else if (up && S.downAt) { S.offs.push([S.downAt, t]); S.downAt = 0; prune(t); }
      },
      get down() { return !!S.downAt; },
      /* 1 秒ごと（テレビ）: 3D が動いている間のコマの数（Race3D の perf.frames。減った＝数え直した） */
      fpsTick(frames, on) {
        const t = clock(), last = S.lastFrames;
        S.lastFrames = frames;
        if (!on || last == null) { S.lastOn = false; return; }
        if (S.lastOn) { const d = frames >= last ? frames - last : frames; S.fps.push([t, d, (t - S.lastAt) / 1000]); prune(t); }
        S.lastOn = true; S.lastAt = t;
      },
      longFrame() { S.j.push(clock()); if (S.j.length > 2000) S.j.shift(); },
      /* レースの間だけ: 始め・1 コマ（前のコマとの間 ms）・終わり */
      raceBegin(id) { if (S.cur) H.raceEnd(); S.cur = { id: str(id, 48, RACE_ID_RE), at: clock(), gaps: [] }; },
      raceGap(ms) { const c = S.cur; if (c && c.gaps.length < MAX_FRAMES) c.gaps.push(ms); },
      raceEnd() {
        const c = S.cur; S.cur = null; if (!c || c.gaps.length < 30) return null; // 30 コマ未満（途中から見た・すぐ止めた）は残さない
        const t = clock(), r = Object.assign({ id: c.id, at: Math.round(c.at) }, frameStats(c.gaps, t - c.at), { off: int(offSec(c.at, t), 0, 3600) });
        S.races.unshift(r); if (S.races.length > MAX_RACES) S.races.length = MAX_RACES;
        return r;
      },
      get races() { return S.races.slice(); },
      get racing() { return !!S.cur; },
      /* 名乗りに付ける h（上の形） */
      summary() {
        const t = clock(); prune(t);
        const lo = t - WIN, ops = S.ops.filter((x) => x[0] >= lo), okMs = ops.filter((x) => x[2]).map((x) => x[1]);
        const offs = S.offs.filter((x) => x[1] >= lo).concat(S.downAt ? [[S.downAt, t]] : []);
        const fr = S.fps.reduce((a, x) => a + x[1], 0), sec = S.fps.reduce((a, x) => a + x[2], 0);
        let cn = null; try { cn = typeof navigator !== 'undefined' && navigator.connection ? navigator.connection : null; } catch (e) { cn = null; }
        const ex = (() => { try { return (H.extra && H.extra()) || {}; } catch (e) { return {}; } })();
        return {
          v: 1, up: int((t - t0) / 60000, 0, 1000000), ver: str(ex.ver, 16, /^[A-Za-z0-9._-]*$/), q: str(ex.q, 8, /^[a-z]*$/), r: ex.r === 'p' || ex.r === 'b' ? ex.r : '',
          n: int(ops.length, 0, 10000), lat: int(pct(okMs, 0.5), 0, 60000), lmax: int(okMs.length ? Math.max.apply(null, okMs) : 0, 0, 60000), f: int(ops.length - okMs.length, 0, 10000),
          off: int(offs.length, 0, 1000), offs: int(offSec(lo, t, offs), 0, 3600),
          ct: str(cn && cn.effectiveType, 8, /^[a-z0-9-]*$/), dl: num1(cn && cn.downlink, 0, 10000), rtt: int(cn && cn.rtt, 0, 60000),
          fps: num1(sec > 0 ? fr / sec : 0, 0, 240), as: int(sec, 0, 3600), j: int(S.j.filter((x) => x >= lo).length, 0, 10000),
          rs: S.races.map((r) => Object.assign({}, r)),
          m: modelCode(), // 機種の記号（2026-10-29 オーナー「Fire stick の機種が古いとかわかる？」。UA の AFT…。無ければ ''）
        };
      },
    };
    function offSec(a, b, list) { // [a, b] の間に切れていた秒
      const L = list || S.offs.concat(S.downAt ? [[S.downAt, clock()]] : []);
      return L.reduce((s, x) => s + Math.max(0, Math.min(b, x[1]) - Math.max(a, x[0])), 0) / 1000;
    }
    return H;
  }

  /* レースの間だけ動く 1 コマの見張り（テレビ v2/tv.js と測る道具 tools/smooth-bench.html で同じものを使う）。
     毎コマ: 描いた時刻 drawAt()（js/race3d.js の lastDrawAt を読むだけ。無ければ requestAnimationFrame の時刻）が変わっていたら、前との差を 1 つ足す。
     画面が隠れている間は数えない。返り値 stop() でやめて、そのレースのまとめ（30 コマ未満は null）。何が起きても投げない */
  function meter(H, id, drawAt) {
    let on = true, last = 0;
    try { H.raceBegin(id); } catch (e) { return () => null; }
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    const step = (ts) => {
      if (!on) return;
      try { const d = drawAt ? drawAt() : ts; if (d && d !== last) { if (last && d > last && (typeof document === 'undefined' || document.visibilityState === 'visible')) H.raceGap(d - last); last = d; } } catch (e) { /* noop */ }
      if (raf) raf(step);
    };
    if (raf) raf(step);
    return () => { if (!on) return null; on = false; try { return H.raceEnd(); } catch (e) { return null; } };
  }

  /* 届いた h を確かめて、形がちがえば null（模擬クラウドの server.js が保存する前に。Firestore はルールが同じことをする） */
  const H_KEYS = ['v', 'up', 'ver', 'q', 'r', 'n', 'lat', 'lmax', 'f', 'off', 'offs', 'ct', 'dl', 'rtt', 'fps', 'as', 'j', 'rs'];
  const R_KEYS = ['id', 'at', 'd', 'fr', 'fps', 'md', 'p95', 'h1', 'h2', 'mx', 'off'];
  const isInt = (v, a, b) => Number.isInteger(v) && v >= a && v <= b, isNum = (v, a, b) => typeof v === 'number' && isFinite(v) && v >= a && v <= b;
  /* 機種（2026-10-29）: Fire TV の UA にある記号（例 AFTMM）。h.m は無くてもよい（古い版のテレビ）。管理画面で機種名にする */
  function modelCode() { try { const m = String((typeof navigator !== 'undefined' && navigator.userAgent) || '').match(/\b(AFT[A-Z0-9]{1,12})\b/); return m ? m[1] : ''; } catch (e) { return ''; } }
  const MODELS = { AFTM: 'Fire TV Stick（第1世代・2014）', AFTT: 'Fire TV Stick（第2世代・2016）', AFTSSS: 'Fire TV Stick（第3世代・2020）', AFTSS: 'Fire TV Stick Lite（2020）', AFTMM: 'Fire TV Stick 4K（2018）', AFTKM: 'Fire TV Stick 4K（第2世代・2023）', AFTKA: 'Fire TV Stick 4K Max（2021）', AFTKRT: 'Fire TV Stick 4K Max（第2世代・2023）', AFTA: 'Fire TV Cube（第1世代・2018）', AFTR: 'Fire TV Cube（第2世代・2019）', AFTGAZL: 'Fire TV Cube（第3世代・2022）', AFTN: 'Fire TV（第3世代・2017）', AFTB: 'Fire TV（第1世代・2014）', AFTS: 'Fire TV（第2世代・2015）' };
  const modelName = (c) => (c ? MODELS[c] || ('機種 ' + c) : '');
  const MODEL_RE = /^[A-Za-z0-9_-]{0,16}$/;
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const exact = (o, ks) => { const n = Object.keys(o).length - ('m' in o && ks === H_KEYS ? 1 : 0); return n === ks.length && ks.every((k) => k in o); }; // h の m（機種）は無くてもよい
  function raceOk(x) {
    return isObj(x) && exact(x, R_KEYS) && typeof x.id === 'string' && RACE_ID_RE.test(x.id) && isInt(x.at, 0, 1e14) && isInt(x.d, 0, 600) && isInt(x.fr, 0, 100000) && isNum(x.fps, 0, 240)
      && isNum(x.md, 0, 10000) && isNum(x.p95, 0, 10000) && isInt(x.h1, 0, 10000) && isInt(x.h2, 0, 10000) && isInt(x.mx, 0, 600000) && isInt(x.off, 0, 3600);
  }
  function valid(h) {
    return isObj(h) && exact(h, H_KEYS) && h.v === 1 && isInt(h.up, 0, 1000000) && typeof h.ver === 'string' && /^[A-Za-z0-9._-]{0,16}$/.test(h.ver) && typeof h.q === 'string' && /^[a-z]{0,8}$/.test(h.q)
      && (h.r === '' || h.r === 'p' || h.r === 'b') && isInt(h.n, 0, 10000) && isInt(h.lat, 0, 60000) && isInt(h.lmax, 0, 60000) && isInt(h.f, 0, 10000) && isInt(h.off, 0, 1000) && isInt(h.offs, 0, 3600)
      && typeof h.ct === 'string' && /^[a-z0-9-]{0,8}$/.test(h.ct) && isNum(h.dl, 0, 10000) && isInt(h.rtt, 0, 60000) && isNum(h.fps, 0, 240) && isInt(h.as, 0, 3600) && isInt(h.j, 0, 10000)
      && Array.isArray(h.rs) && h.rs.length <= MAX_RACES && h.rs.every(raceOk)
      && (!('m' in h) || (typeof h.m === 'string' && MODEL_RE.test(h.m)));
  }
  const clean = (h) => (valid(h) ? JSON.parse(JSON.stringify(h)) : null);

  /* ---------- 点数と言葉（管理画面） ---------- */
  function signalScore(h) {
    if (!h || (!(h.n > 0) && !(h.off > 0) && !(h.offs > 0))) return null;
    const s = 100 - Math.min(60, Math.max(0, (h.lat || 0) - 300) / 40) - Math.min(45, 15 * (h.f || 0)) - Math.min(60, 0.5 * (h.offs || 0)) - Math.min(20, 5 * (h.off || 0));
    return Math.round(clamp(s, 0, 100));
  }
  function raceScore(r) {
    if (!r || !(r.fr > 0)) return null;
    const s = Math.min(100, (r.fps || 0) / 30 * 100) - Math.min(30, 3 * (r.h1 || 0)) - Math.min(35, 7 * (r.h2 || 0)) - Math.min(30, Math.max(0, (r.mx || 0) - 250) / 50);
    return Math.round(clamp(s, 0, 100));
  }
  const signalWord = (s) => (s == null ? '' : s >= 80 ? '良い' : s >= 50 ? 'ふつう' : '悪い');
  const smoothWord = (s) => (s == null ? '' : s >= 80 ? 'なめらか' : s >= 55 ? '少しカクつく' : 'カクつく');
  const lvOf = (s, mid) => (s == null ? 'none' : s >= 80 ? 'good' : s >= mid ? 'mid' : 'bad');
  /* 管理画面の 1 台ぶん: { has, sig: { score, word, lv, cut }, race: { score, word, lv, avg, avgN, last }, details: [文字] } */
  function label(h) {
    if (!h || h.v !== 1) return { has: false, text: '情報なし（古い版）' };
    const ss = signalScore(h), rs = Array.isArray(h.rs) ? h.rs : [], last = rs[0] || null, ls = raceScore(last);
    const sc = rs.map(raceScore).filter((x) => x != null), avg = sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null;
    const sec = (ms) => (ms >= 10000 ? Math.round(ms / 1000) : ms >= 1000 ? Math.round(ms / 100) / 10 : Math.round(ms / 10) / 100) + '秒'; // 1 秒より短いときは 0.05秒 まで
    const net = [h.n > 0 ? '遅れ ' + h.lat + 'ms' : '通信を測っていません', '切断 ' + (h.off || 0) + '回' + (h.offs > 0 ? '（' + h.offs + '秒）' : ''), h.f > 0 ? '失敗 ' + h.f + '回' : '', h.ct ? '回線 ' + h.ct : ''].filter(Boolean);
    const vid = [h.m ? modelName(h.m) : '', h.as > 0 ? 'コマ ' + Math.round(h.fps) + '/秒' : '', h.ver ? '版 ' + h.ver : '', '画質 ' + qName(h.q), h.r === 'p' ? '進行役' : h.r === 'b' ? '予備' : '', '起動 ' + upTxt(h.up)].filter(Boolean);
    return {
      has: true,
      sig: { score: ss, word: ss == null ? '測っていません' : signalWord(ss), lv: lvOf(ss, 50), cut: (h.off || 0) > 0 || (h.offs || 0) > 0 },
      race: last ? { score: ls, word: smoothWord(ls), lv: lvOf(ls, 55), avg, avgN: sc.length, last, text: '直近のレース: ' + smoothWord(ls) + '（コマ ' + Math.round(last.fps) + '/秒・止まり ' + last.h1 + '回・最長 ' + sec(last.mx) + '）' } : null,
      net: net.join('・'), vid: vid.join('・'),
    };
  }
  const qName = (q) => ({ '': '標準', auto: 'なめらか優先', max: 'きれい優先', lite: 'さらになめらか', min: '最もなめらか' })[q || ''] || q;
  const upTxt = (m) => (m < 60 ? m + '分' : m < 1440 ? Math.floor(m / 60) + '時間' : Math.floor(m / 1440) + '日');
  /* 店ごとの 1 行（いちばん悪いテレビに合わせる） */
  function storeLine(hs) {
    const L = (hs || []).map(label).filter((x) => x.has);
    if (!L.length) return null;
    const sig = L.map((x) => x.sig.score).filter((x) => x != null), rc = L.map((x) => x.race && x.race.avg).filter((x) => x != null);
    const s = sig.length ? Math.min.apply(null, sig) : null, r = rc.length ? Math.min.apply(null, rc) : null, cut = L.some((x) => x.sig.cut);
    return { sig: s, sigWord: signalWord(s), sigLv: lvOf(s, 50), smooth: r, smoothWord: smoothWord(r), smoothLv: lvOf(r, 55), cut };
  }

  return { modelCode, modelName, MODELS, WIN, create, meter, frameStats, valid, clean, raceOk, signalScore, raceScore, signalWord, smoothWord, label, storeLine, H_KEYS, R_KEYS };
});
