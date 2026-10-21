/* レースの絵（canvas 1000x480）— 楕円コースを疑似3Dで描き、テレビ中継のようにカメラを切り替える。
   本番は Engine.createRun で 1 コマずつ本当に走らせる（結果はここで決まる。ニンジンの加速も効く）。
   カメラ: ①スタートは高い俯瞰 ②道中は横から並走 ③向こう正面は正面からの寄り ④最後の直線は低い横アングル
          ⑤ゴール前が接戦ならスローモーション ⑥ゴール後は別角度のリプレイ */
window.Race = (function () {
  'use strict';
  const W = 1000, H = 480;
  // 局のロゴ（映像の左下）: 3D 版（js/race3d.js）と同じく新しいロゴの横長版（art/logo-3d/B/lockup-3d-B-casaWhite.svg）を読み、
  // 描く大きさで 1 回だけ小さなキャンバスに焼いて毎コマはそれを貼る。SVG が読めなければ PNG、それもだめなら文字のロゴ
  const LOGO_BASE = (() => { try { return new URL('../art/logo-3d/B/', document.currentScript.src).href; } catch (e) { return 'art/logo-3d/B/'; } })();
  const LOGO_SRCS = [LOGO_BASE + 'lockup-3d-B-casaWhite.svg', LOGO_BASE + 'png/lockup-3d-B-casaWhite-2x.png'];
  let logoImg = null, logoTry = 0, logoBake = null, logoBakeH = 0;
  function logoLoad() {
    if (logoTry >= LOGO_SRCS.length || typeof Image === 'undefined') return;
    const img = new Image(); logoTry++;
    img.onload = () => { if (img.naturalWidth && img.naturalHeight) { logoImg = img; logoBake = null; } else logoLoad(); };
    img.onerror = () => logoLoad();
    img.src = LOGO_SRCS[logoTry - 1];
  }
  function stationLogo(px) { /* px: 実際の画素での高さ。その大きさで焼いたキャンバス（まだ読めていなければ null） */
    if (!logoImg) { if (!logoTry) logoLoad(); return null; }
    const ph = Math.max(8, Math.round(px));
    if (logoBake && logoBakeH === ph) return logoBake;
    try {
      const w = Math.round(ph * logoImg.naturalWidth / logoImg.naturalHeight), cv = document.createElement('canvas');
      cv.width = w; cv.height = ph; const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(logoImg, 0, 0, w, ph);
      logoBake = cv; logoBakeH = ph; return cv;
    } catch (e) { logoImg = null; logoTry = LOGO_SRCS.length; return null; }
  }
  try { logoLoad(); } catch (e) { /* 最初に描くときにもう一度 */ }
  // コース: 直線 400m ×2 ＋ 半円（半径 63.66m → 200m）×2 ＝ 1200m。中心が原点。1 単位 = 1m
  const LS = 400, RC = 200 / Math.PI, L = 1200, HALF = 7; // HALF: コース幅の半分
  const RI = RC - HALF, RO = RC + HALF;
  const FINISH_S = LS; // ホームストレッチの終わりがゴール
  const COATS = {
    white: { body: '#f7f1e4', mane: '#7a5230', dark: '#e2d8c6' },
    black: { body: '#4a3f48', mane: '#1f1a20', dark: '#352c33' },
    chestnut: { body: '#c9743a', mane: '#7a3d14', dark: '#a85c2c' },
    gray: { body: '#c3c6cf', mane: '#6d7079', dark: '#a7aab3' },
    palomino: { body: '#e6bd68', mane: '#f7eccb', dark: '#c99f4e' },
    bay: { body: '#9a6132', mane: '#2d1a0c', dark: '#7c4c25' },
  };

  /* ---------- コースの幾何 ---------- */
  function pointAt(s, r) {
    s = ((s % L) + L) % L;
    if (s < LS) return { x: -LS / 2 + s, z: r, hx: 1, hz: 0 };
    if (s < LS + Math.PI * RC) { const th = (s - LS) / RC; return { x: LS / 2 + r * Math.sin(th), z: r * Math.cos(th), hx: Math.cos(th), hz: -Math.sin(th) }; }
    if (s < 2 * LS + Math.PI * RC) { const d = s - LS - Math.PI * RC; return { x: LS / 2 - d, z: -r, hx: -1, hz: 0 }; }
    const th = (s - 2 * LS - Math.PI * RC) / RC; return { x: -LS / 2 - r * Math.sin(th), z: -r * Math.cos(th), hx: -Math.cos(th), hz: Math.sin(th) };
  }
  function outward(p) {
    if (Math.abs(p.x) <= LS / 2) return { x: 0, z: p.z >= 0 ? 1 : -1 };
    const cx = p.x > 0 ? LS / 2 : -LS / 2, dx = p.x - cx, dz = p.z, n = Math.hypot(dx, dz) || 1; return { x: dx / n, z: dz / n };
  }
  const laneR = (i) => RI + 1.6 + i * 1.95;

  /* ---------- カメラ ---------- */
  function Cam() { this.p = { x: 0, y: 30, z: 120 }; this.t = { x: 0, y: 0, z: 0 }; this.fov = 60; this.mode = ''; }
  Cam.prototype.basis = function () {
    const f = norm3(sub3(this.t, this.p));
    const r = norm3({ x: -f.z, y: 0, z: f.x });
    const u = cross3(r, f);
    this.F = (W / 2) / Math.tan(this.fov * Math.PI / 360);
    this.f = f; this.r = r; this.u = u;
  };
  Cam.prototype.toCam = function (p) { const d = { x: p.x - this.p.x, y: (p.y || 0) - this.p.y, z: p.z - this.p.z }; return { x: dot3(d, this.r), y: dot3(d, this.u), z: dot3(d, this.f) }; };
  Cam.prototype.proj = function (c) { return { x: W / 2 + c.x * this.F / c.z, y: H * 0.5 - c.y * this.F / c.z, s: this.F / c.z, z: c.z }; };
  const NEAR = 0.8;
  const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross3 = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  function norm3(a) { const n = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / n, y: a.y / n, z: a.z / n }; }
  function clipNear(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ain = a.z > NEAR, bin = b.z > NEAR;
      if (ain) out.push(a);
      if (ain !== bin) { const t = (NEAR - a.z) / (b.z - a.z); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR }); }
    }
    return out;
  }


  /* ---------- 光と空気（天気ごと） ----------
     太陽はスタンドから見て左上・手前（馬の絵の光源と同じ）。影は右奥へ落ちる。
     遠くのものほど空の色に溶ける（空気遠近）。hazeK は 1m あたりのかすみ具合。 */
  const SUN = norm3({ x: -0.5, y: 0.8, z: 0.42 });
  const SHX = -SUN.x / SUN.y, SHZ = -SUN.z / SUN.y; // 高さ 1m のものの影が地面でずれる量
  const WEATHER = {
    sunny: { sky: ['#2f86d6', '#79b6e6', '#d6e8f2'], haze: [208, 224, 234], hazeK: 1 / 700, shade: 0.36, turf: '#86bd45', turfHi: 'rgba(255,255,200,.11)', turfLo: 'rgba(20,60,0,.07)', grass: '#77aa3d', infield: '#7fb242', dirt: '#b9a98a', road: '#a9a497', apron: '#cfc9bd', tree: '#3f6a34', treeFar: '#4c6f47', cloud: 1, light: 1 },
    cloudy: { sky: ['#8aa2b8', '#b5c4d1', '#dde4ea'], haze: [210, 217, 223], hazeK: 1 / 520, shade: 0.13, turf: '#7fb046', turfHi: 'rgba(255,255,210,.08)', turfLo: 'rgba(20,50,0,.06)', grass: '#729f40', infield: '#78a843', dirt: '#ab9d82', road: '#9c998f', apron: '#c2bfb7', tree: '#3d6136', treeFar: '#52694d', cloud: 0.9, light: 0.92 },
    rain: { sky: ['#5c6874', '#87929d', '#b3bcc4'], haze: [168, 177, 186], hazeK: 1 / 300, shade: 0.05, turf: '#6c9a3e', turfHi: 'rgba(230,240,255,.07)', turfLo: 'rgba(0,30,10,.08)', grass: '#638c3a', infield: '#6a943e', dirt: '#857560', road: '#7e7c76', apron: '#a3a19c', tree: '#33532f', treeFar: '#4c5f4c', cloud: 0.55, light: 0.8 },
  };
  const RGBC = {};
  function rgbOf(hex) { let v = RGBC[hex]; if (!v) { const n = parseInt(hex.slice(1), 16); v = RGBC[hex] = [n >> 16, (n >> 8) & 255, n & 255]; } return v; }
  function mixc(hex, to, a) { const p = rgbOf(hex); return 'rgb(' + Math.round(p[0] + (to[0] - p[0]) * a) + ',' + Math.round(p[1] + (to[1] - p[1]) * a) + ',' + Math.round(p[2] + (to[2] - p[2]) * a) + ')'; }
  const hazeOf = (d, wx) => Math.min(0.88, 1 - Math.exp(-Math.max(0, d) * wx.hazeK));

  /* ---------- 会場の素材（最初に 1 回だけ作る小さな絵。模様として貼る） ---------- */
  const TX = {}, PAT = {};
  function mkCanvas(w, h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; }
  function srand(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  function wrapDot(g, w, h, x, y, rad) { for (let dx = -w; dx <= w; dx += w) for (let dy = -h; dy <= h; dy += h) { const X = x + dx, Y = y + dy; if (X + rad < 0 || X - rad > w || Y + rad < 0 || Y - rad > h) continue; g.beginPath(); g.arc(X, Y, rad, 0, 6.283); g.fill(); } }
  const CLOTH = ['#2b2f3a', '#3d4a63', '#f0efe9', '#c9c2b2', '#6b7280', '#1f2023', '#8a6f55', '#4f6b4a', '#b23a3a', '#d8b48a', '#5a7fa8', '#e7e2d4', '#33415c', '#9aa3ad', '#e0d36a', '#7a4f6d'];
  const SKIN = ['#e8c4a2', '#d9ac86', '#f0d0b2', '#c99a76'], HAIR = ['#1b1612', '#2a201a', '#3b2c22', '#5a524c'];
  const MAKE = {
    // 木の葉（12m 四方 = 256px）。左上から光が当たった葉のかたまり
    foliage() {
      const w = 256, cv = mkCanvas(w, w), g = cv.getContext('2d'), r = srand(7);
      for (let k = 0; k < 560; k++) {
        const x = r() * w, y = r() * w, rad = 3 + r() * 10;
        g.fillStyle = 'rgba(6,20,4,.28)'; wrapDot(g, w, w, x + rad * 0.3, y + rad * 0.35, rad);
        g.fillStyle = 'rgba(150,195,90,.15)'; wrapDot(g, w, w, x - rad * 0.15, y - rad * 0.2, rad * 0.72);
        if (r() < 0.35) { g.fillStyle = 'rgba(220,240,150,.20)'; wrapDot(g, w, w, x - rad * 0.35, y - rad * 0.4, rad * 0.3); }
      }
      return cv;
    },
    // 座った観客（32m × 16m = 512 × 256px。上が後ろの高い段）
    seated() {
      const w = 512, h = 256, cv = mkCanvas(w, h), g = cv.getContext('2d'), r = srand(21);
      g.fillStyle = '#3c3f47'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 14) {
        g.fillStyle = '#6a6e76'; g.fillRect(0, y + 11, w, 3);
        for (let x = r() * 6; x < w; x += 6.5 + r() * 3.5) {
          if (r() < 0.14) continue;
          const col = CLOTH[(r() * CLOTH.length) | 0], sk = SKIN[(r() * 4) | 0], hr = HAIR[(r() * 4) | 0];
          for (let dx = -w; dx <= w; dx += w) { const X = x + dx; if (X < -8 || X > w + 8) continue; g.fillStyle = col; g.fillRect(X - 3, y + 4.5, 6, 6.5); g.fillStyle = sk; g.beginPath(); g.arc(X, y + 2.6, 2.3, 0, 6.283); g.fill(); g.fillStyle = hr; g.beginPath(); g.arc(X, y + 2.0, 2.3, Math.PI, 0); g.fill(); }
        }
      }
      return cv;
    },
    // 立って見る観客（32m × 2.5m = 512 × 40px。透明の地に 3 列）
    standing() {
      const w = 512, h = 40, cv = mkCanvas(w, h), g = cv.getContext('2d'), r = srand(33);
      for (let row = 2; row >= 0; row--) for (let x = r() * 5; x < w; x += 4.5 + r() * 4) {
        if (r() < 0.12) continue;
        const foot = h - row * 1.2, tall = 24 + r() * 5, col = CLOTH[(r() * CLOTH.length) | 0], leg = r() < 0.6 ? '#25262b' : '#4b4f5c', sk = SKIN[(r() * 4) | 0], hr = HAIR[(r() * 4) | 0], cap = r() < 0.18, capc = CLOTH[(r() * CLOTH.length) | 0], arm = r() < 0.08;
        for (let dx = -w; dx <= w; dx += w) {
          const X = x + dx; if (X < -8 || X > w + 8) continue;
          g.fillStyle = leg; g.fillRect(X - 2.4, foot - tall * 0.47, 4.8, tall * 0.47);
          g.fillStyle = col; g.fillRect(X - 3.4, foot - tall * 0.82, 6.8, tall * 0.38); g.beginPath(); g.arc(X, foot - tall * 0.8, 3.4, Math.PI, 0); g.fill();
          if (arm) g.fillRect(X + 2.2, foot - tall * 1.08, 1.6, tall * 0.3);
          g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(X + 0.8, foot - tall * 0.82, 2.6, tall * 0.38);
          g.fillStyle = sk; g.beginPath(); g.arc(X, foot - tall * 0.92, 2.4, 0, 6.283); g.fill();
          g.fillStyle = cap ? capc : hr; g.beginPath(); g.arc(X, foot - tall * 0.94, 2.5, Math.PI, 0); g.fill();
          if (row) { g.fillStyle = 'rgba(30,30,40,' + (0.12 * row) + ')'; g.fillRect(X - 3.6, foot - tall * 1.0, 7.2, tall); }
        }
      }
      return cv;
    },
    // ガラスの壁（8m × 4m = 128 × 64px）。縦の桟と空の映り込み
    glass() {
      const cv = mkCanvas(128, 64), g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, '#9fb7c9'); gr.addColorStop(0.55, '#6f899d'); gr.addColorStop(1, '#4e6273'); g.fillStyle = gr; g.fillRect(0, 0, 128, 64);
      g.fillStyle = 'rgba(255,255,255,.10)'; g.beginPath(); g.moveTo(10, 0); g.lineTo(46, 0); g.lineTo(20, 64); g.lineTo(-16, 64); g.fill(); g.beginPath(); g.moveTo(84, 0); g.lineTo(96, 0); g.lineTo(70, 64); g.lineTo(58, 64); g.fill();
      g.fillStyle = '#d9dde0'; for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 2, 64); g.fillRect(0, 0, 128, 2); g.fillRect(0, 31, 128, 1.5);
      return cv;
    },
    // 遠くの建物の窓（6m × 6m = 48px。透明の地に窓の帯）
    windows() {
      const cv = mkCanvas(48, 48), g = cv.getContext('2d');
      for (let y = 6; y < 48; y += 24) { g.fillStyle = 'rgba(55,75,98,.55)'; g.fillRect(0, y, 48, 10); g.fillStyle = 'rgba(255,255,255,.35)'; for (let x = 0; x < 48; x += 12) g.fillRect(x, y, 1.5, 10); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, y + 10, 48, 3); }
      return cv;
    },
    // 雲（ふわっとした積雲。下側は少し灰色）
    cloud(seed) {
      const cv = mkCanvas(256, 128), g = cv.getContext('2d'), r = srand(seed);
      for (let k = 0; k < 30; k++) {
        const x = 34 + r() * 188, mid = 1 - Math.abs(x - 128) / 128, y = 84 - r() * 34 * mid - 6, rad = 12 + r() * 22 * (0.5 + mid);
        const gr = g.createRadialGradient(x - rad * 0.3, y - rad * 0.4, rad * 0.1, x, y, rad);
        gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.55, 'rgba(242,246,250,.8)'); gr.addColorStop(1, 'rgba(225,232,240,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill();
      }
      g.globalCompositeOperation = 'source-atop'; const sh = g.createLinearGradient(0, 50, 0, 110); sh.addColorStop(0, 'rgba(120,135,155,0)'); sh.addColorStop(1, 'rgba(120,135,155,.45)'); g.fillStyle = sh; g.fillRect(0, 0, 256, 128);
      return cv;
    },
  };
  function tex(name, arg) { const key = name + (arg || ''); return TX[key] || (TX[key] = MAKE[name](arg)); }
  function pat(c, name) { return PAT[name] || (PAT[name] = c.createPattern(tex(name), 'repeat')); }

  /* ---------- 会場の配置（動かないもの。1 単位 = 1m） ----------
     スタンドはホームストレッチの外（z が正）。向正面の外は木立、その奥に街の建物。内馬場にターフビジョンと大きな木。 */
  const ST = RO + 40;                  // スタンド前面の z
  const STX0 = -LS / 2 - 40, STX1 = LS / 2 + 60; // スタンドの左右の端
  // コース沿いの点（直線は粗く、コーナーは細かく）
  const RING_S = (function () {
    const a = [];
    for (let s = 0; s < LS; s += 25) a.push(s);
    for (let k = 0; k < 40; k++) a.push(LS + k * Math.PI * RC / 40);
    for (let s = 0; s < LS; s += 25) a.push(LS + Math.PI * RC + s);
    for (let k = 0; k < 40; k++) a.push(2 * LS + Math.PI * RC + k * Math.PI * RC / 40);
    return a;
  })();
  const RING_CACHE = {};
  function ringPts(r) { return RING_CACHE[r] || (RING_CACHE[r] = RING_S.map((s) => { const p = pointAt(s, r); return { x: p.x, z: p.z, s }; })); }
  // ホームストレッチ以外の外周（コーナーのスタンド寄りは除く）を step m おきにたどる
  function outerPath(off, step, cut) {
    const R = RO + off, out = [];
    const arc = (cx, a0, a1, sign) => { const n = Math.max(2, Math.round(Math.abs(a1 - a0) * R / step)); for (let k = 0; k <= n; k++) { const th = a0 + (a1 - a0) * k / n; out.push({ x: cx + sign * R * Math.sin(th), z: sign * R * Math.cos(th) }); } };
    arc(LS / 2, cut, Math.PI, 1);                                   // 1〜2 コーナーの外
    for (let x = LS / 2 - step; x > -LS / 2; x -= step) out.push({ x, z: -R }); // 向正面の外
    arc(-LS / 2, 0, Math.PI - cut, -1);                             // 3〜4 コーナーの外
    return out;
  }
  const FOREST = [0, 1].map((li) => {
    const r = srand(11 + li * 5);
    return Object.assign(outerPath(li ? 44 : 27, li ? 5 : 3.4, li ? 0.45 : 0.62).map((p) => ({ x: p.x + (r() - 0.5) * 2, z: p.z + (r() - 0.5) * 2, h: li ? 17 + r() * 9 : 12 + r() * 7, rad: li ? 3.4 + r() * 2.4 : 2.4 + r() * 1.9 })), { step: li ? 5 : 3.4 });
  });
  const FENCE = outerPath(19, 12, 0.7);
  // 街の建物（向正面とコーナーの、木立のさらに奥）
  const CITY = (function () {
    const r = srand(91), a = [], cols = ['#dcd8cf', '#c8ccd2', '#e6e2da', '#b8bec6', '#d2c9bb', '#aeb6bf', '#e9e7e3'];
    const add = (x, z) => { const n = Math.hypot(x, z); a.push({ x, z, nx: -x / n, nz: -z / n, w: 14 + r() * 40, d: 12 + r() * 16, h: 14 + r() * (r() < 0.25 ? 70 : 34), col: cols[(r() * cols.length) | 0] }); };
    for (let k = 0; k < 22; k++) add(-560 + r() * 1120, -RO - 150 - r() * 380);
    for (let k = 0; k < 7; k++) add(-LS / 2 - RO - 170 - r() * 300, -260 + r() * 360);
    for (let k = 0; k < 7; k++) add(LS / 2 + RO + 170 + r() * 300, -260 + r() * 360);
    return a;
  })();
  // 内馬場: ターフビジョン（スタンドへ向く大画面）と木
  const VIS = { x: 150, z: 16, w: 30, h: 10, y0: 2.4 };
  const ITREES = [{ x: 60, z: 31, h: 8, rad: 4.6, big: 1 }, { x: -20, z: 33, h: 6.5, rad: 3 }]; // スタンドからの視線より低い木だけ（ホームストレッチ寄り）
  const CLOUDS = (function () { const r = srand(5), a = []; for (let k = 0; k < 14; k++) a.push({ az: r() * 6.283, el: 0.06 + r() * 0.3, w: 0.18 + r() * 0.22, v: k % 3 }); return a; })();

  // 世界の点の並びを画面へ投影して、今の path に多角形として足す（手前で切る）
  function addPoly(c, cam, pts) {
    const q = clipNear(pts.map((p) => cam.toCam(p))); if (q.length < 3) return false;
    for (let k = 0; k < q.length; k++) { const s = cam.proj(q[k]); k ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }
    c.closePath(); return true;
  }
  // 模様（テクスチャ）を世界の四角形に貼る。p00→p10 が u 方向、p00→p01 が v 方向。uv は模様の px
  function texQuad(c, cam, pt, p00, p10, p11, p01, u0, v0, u1, v1) {
    const a = cam.toCam(p00), b = cam.toCam(p10), d = cam.toCam(p01), e = cam.toCam(p11);
    if (a.z <= NEAR || b.z <= NEAR || d.z <= NEAR || e.z <= NEAR) return;
    const A = cam.proj(a), B = cam.proj(b), D = cam.proj(d), E = cam.proj(e);
    if (Math.max(A.x, B.x, D.x, E.x) < 0 || Math.min(A.x, B.x, D.x, E.x) > W || Math.max(A.y, B.y, D.y, E.y) < 0 || Math.min(A.y, B.y, D.y, E.y) > H) return;
    const du = u1 - u0, dv = v1 - v0, ma = (B.x - A.x) / du, mb = (B.y - A.y) / du, mc = (D.x - A.x) / dv, md = (D.y - A.y) / dv;
    if (pt.setTransform) pt.setTransform(new DOMMatrix([ma, mb, mc, md, A.x - ma * u0 - mc * v0, A.y - mb * u0 - md * v0]));
    c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.lineTo(E.x, E.y); c.lineTo(D.x, D.y); c.closePath(); c.fillStyle = pt; c.fill();
  }

  function Race(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.race = null; this.run = null; this.phase = 'idle'; this.t = 0; this.cam = new Cam(); this.slow = 1; this.tape = []; this.dust = [];
    this.label = ''; this.cut = 0; this.slowSaid = false; this.winnerIdx = -1;
    this.lite = /[?&]lite=1/.test(location.search); // 軽い描き方（遅い機械向け。自動でも切り替わる）
  }
  /* 画面の大きさに合わせて canvas の解像度を上げる（座標は W×H のまま。最大 1.5 倍: Fire TV の描画の重さを考えて） */
  const MAXK = Math.max(1, Math.min(2, Number((location.search.match(/[?&]hd=([\d.]+)/) || [])[1] || 1.5)));
  Race.prototype.fitRes = function () {
    const cv = this.cv, now = performance.now();
    if (!this.resAt || now - this.resAt > 500) {
      this.resAt = now; const cw = cv.clientWidth || W, dpr = window.devicePixelRatio || 1;
      const k = Math.round(Math.max(1, Math.min(this.lite ? 1 : MAXK, cw * dpr / W)) * 4) / 4;
      if (k !== this.k) { this.k = k; cv.width = Math.round(W * k); cv.height = Math.round(H * k); }
    }
    this.ctx.setTransform(this.k || 1, 0, 0, this.k || 1, 0, 0);
  };
  Race.prototype.setRace = function (race) {
    this.race = race; this.run = null; this.lane = null; this.phase = 'idle'; this.t = 0; this.slow = 1; this.tape = []; this.dust = []; this.label = ''; this.slowSaid = false;
    this.startS = ((FINISH_S - race.dist) % L + L) % L;
    this.cam.mode = ''; this.placeCamera(0, true); this.draw();
    this.startIdle();
  };
  Race.prototype.startIdle = function () {
    const self = this; if (this.idleOn) return; this.idleOn = true;
    let last = performance.now();
    function frame(now) {
      if (self.phase !== 'idle') { self.idleOn = false; return; }
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now; self.t += dt;
      try { self.placeCamera(dt, false); if (self.cut > 0) self.cut -= dt; self.draw(); } catch (e) { console.error(e); }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };
  const PADDOCK_SEC = 18;
  Race.prototype.inPaddock = function () { return this.phase === 'idle' && !this.gateShot && this.t < PADDOCK_SEC; };
  Race.prototype.paddockIdx = function () { const n = this.race.horses.length, k = this.inPaddock() ? Math.floor(this.t / 3) : Math.floor(Math.max(0, this.t - PADDOCK_SEC) / 4); return ((k % n) + n) % n; };
  /* ---------- パドック（楕円の周回路を厩務員に引かれて歩く） ---------- */
  const PA = 26, PB = 12, PW = 3.2; // 楕円の半径（m）と歩く道の幅
  Race.prototype.paddockPos = function (i) {
    const n = this.race.horses.length, per = Math.PI * (3 * (PA + PB) - Math.sqrt((3 * PA + PB) * (PA + 3 * PB)));
    const th = -(this.t * 1.5 / per) * Math.PI * 2 + (i / n) * Math.PI * 2; // 反時計回りに 1.5m/秒
    const x = PA * Math.cos(th), z = PB * Math.sin(th), tx = PA * Math.sin(th), tz = -PB * Math.cos(th), tl = Math.hypot(tx, tz);
    return { x, z, hx: tx / tl, hz: tz / tl, th };
  };
  // パドックの周り: 観客の立つ段（4 段）、2 階建ての建物、その上に見える木立
  const PSTEP = 4, PST0 = PW + 1.7, PSTD = 1.25, PSTH = 0.42;  // 段の数・始まり（周回路の中心から）・奥行き・高さ
  const PBOX = { x: PA + 27, z: PB + 23, h: 10 };                 // 建物の内側の面
  const PCROWD = (function () {
    const r = srand(77), a = [];
    for (let row = 0; row < PSTEP; row++) {
      const off = PST0 + PSTD * (row + 0.55), per = 2 * Math.PI * Math.sqrt(((PA + off) ** 2 + (PB + off) ** 2) / 2), n = Math.floor(per / 0.68);
      for (let k = 0; k < n; k++) { if (r() < 0.12) continue; const th = (k + r() * 0.45) / n * Math.PI * 2; a.push({ x: (PA + off) * Math.cos(th), y: row * PSTH, z: (PB + off) * Math.sin(th), seed: (r() * 16777215) | 0 }); }
    }
    return a;
  })();
  const PTREES = (function () {
    const r = srand(55), a = [], X = PBOX.x + 10, Z = PBOX.z + 10;
    for (let x = -X; x <= X; x += 4.2) { a.push({ x, z: -Z }); a.push({ x, z: Z }); }
    for (let z = -Z + 4; z < Z; z += 4.2) { a.push({ x: -X, z }); a.push({ x: X, z }); }
    return [Object.assign(a.map((p) => ({ x: p.x + (r() - 0.5) * 2, z: p.z + (r() - 0.5) * 2, h: 15 + r() * 8, rad: 2.8 + r() * 1.8 })), { step: 4.2 })];
  })();
  const ELL = {};
  const ellPts = (off, y, n) => { const key = off + '/' + (y || 0) + '/' + (n || 64); if (ELL[key]) return ELL[key]; const a = ELL[key] = []; n = n || 64; for (let k = 0; k < n; k++) { const th = k / n * Math.PI * 2; a.push({ x: (PA + off) * Math.cos(th), y: y || 0, z: (PB + off) * Math.sin(th) }); } return a; };
  // 観客ひとり（k は 1m あたりの px。正面向き、光は左上）
  let PLITE = false;
  function drawPerson(c, x, y, k, seed, t, o) {
    const b = (n) => ((seed >> n) & 255) / 255;
    const tall = (1.55 + b(1) * 0.3) * k, sw = (0.44 + b(3) * 0.08) * k;
    x += Math.sin(t * 0.7 + (seed & 63)) * 0.025 * k;
    const top = o ? o.top : CLOTH[seed % CLOTH.length], pants = o ? o.pants : ['#23252c', '#3a3f4d', '#5b5a55', '#2f3b52', '#c9c0ae'][(seed >> 5) % 5], sk = SKIN[(seed >> 7) & 3], hair = HAIR[(seed >> 9) & 3];
    const hip = y - tall * 0.47, sh = y - tall * 0.8, hr = 0.115 * k, hy = y - tall * 0.915;
    if (k < 7 || (PLITE && !o)) { c.fillStyle = pants; c.fillRect(x - sw * 0.38, hip, sw * 0.76, y - hip); c.fillStyle = top; c.fillRect(x - sw / 2, sh, sw, hip - sh); c.fillStyle = sk; c.fillRect(x - hr, hy - hr, hr * 2, hr * 2); c.fillStyle = hair; c.fillRect(x - hr, hy - hr * 1.1, hr * 2, hr * 0.8); return; }
    // 脚と靴
    c.fillStyle = pants; c.fillRect(x - sw * 0.38, hip, sw * 0.35, y - hip - 0.06 * k); c.fillRect(x + sw * 0.03, hip, sw * 0.35, y - hip - 0.06 * k);
    c.fillStyle = '#18181a'; c.fillRect(x - sw * 0.42, y - 0.07 * k, sw * 0.4, 0.07 * k); c.fillRect(x + sw * 0.02, y - 0.07 * k, sw * 0.4, 0.07 * k);
    // 胴（肩の丸いジャケット）
    c.fillStyle = top; c.beginPath(); c.moveTo(x - sw * 0.42, hip + 0.05 * k); c.lineTo(x - sw * 0.5, sh + sw * 0.16); c.quadraticCurveTo(x - sw * 0.5, sh, x - sw * 0.22, sh - 0.01 * k); c.lineTo(x + sw * 0.22, sh - 0.01 * k); c.quadraticCurveTo(x + sw * 0.5, sh, x + sw * 0.5, sh + sw * 0.16); c.lineTo(x + sw * 0.42, hip + 0.05 * k); c.closePath(); c.fill();
    if (seed & 1) { c.fillStyle = '#f1f0ea'; c.beginPath(); c.moveTo(x - 0.07 * k, sh); c.lineTo(x + 0.07 * k, sh); c.lineTo(x, sh + 0.16 * k); c.fill(); }
    // 腕（スマホで撮る人、新聞を持つ人、下ろす人）
    const pose = o ? 2 : (seed >> 15) % 8;
    c.lineCap = 'round'; c.strokeStyle = top; c.lineWidth = 0.11 * k;
    if (pose === 0) {
      c.beginPath(); c.moveTo(x - sw * 0.44, sh + 0.08 * k); c.lineTo(x - sw * 0.5, hip); c.moveTo(x + sw * 0.4, sh + 0.06 * k); c.lineTo(x + sw * 0.42, sh + 0.24 * k); c.lineTo(x + 0.06 * k, hy + 0.12 * k); c.stroke();
      c.fillStyle = '#1d1f24'; c.fillRect(x - 0.05 * k, hy - 0.04 * k, 0.13 * k, 0.2 * k); c.fillStyle = sk; c.beginPath(); c.arc(x + 0.06 * k, hy + 0.13 * k, 0.045 * k, 0, 6.283); c.fill();
    } else if (pose === 1) {
      c.beginPath(); c.moveTo(x - sw * 0.44, sh + 0.08 * k); c.lineTo(x - sw * 0.36, sh + 0.32 * k); c.moveTo(x + sw * 0.44, sh + 0.08 * k); c.lineTo(x + sw * 0.36, sh + 0.32 * k); c.stroke();
      c.fillStyle = '#ecebe3'; c.fillRect(x - sw * 0.42, sh + 0.2 * k, sw * 0.84, 0.3 * k); c.fillStyle = 'rgba(80,80,80,.45)'; for (let j = 1; j < 5; j++) c.fillRect(x - sw * 0.36, sh + 0.2 * k + j * 0.055 * k, sw * 0.72, 0.012 * k);
    } else {
      c.beginPath(); c.moveTo(x - sw * 0.45, sh + 0.08 * k); c.lineTo(x - sw * 0.52, hip + 0.02 * k); c.moveTo(x + sw * 0.45, sh + 0.08 * k); c.lineTo(x + sw * 0.52, hip + 0.02 * k); c.stroke();
      c.fillStyle = sk; c.beginPath(); c.arc(x - sw * 0.52, hip + 0.06 * k, 0.045 * k, 0, 6.283); c.arc(x + sw * 0.52, hip + 0.06 * k, 0.045 * k, 0, 6.283); c.fill();
    }
    if (o && o.bib) { c.fillStyle = o.bib; c.fillRect(x - sw * 0.36, sh + 0.1 * k, sw * 0.72, 0.3 * k); if (k > 25) { c.fillStyle = o.ink; c.font = 'bold ' + Math.round(0.22 * k) + 'px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(o.no, x, sh + 0.26 * k); } }
    c.fillStyle = 'rgba(0,0,0,.17)'; c.fillRect(x + sw * 0.1, sh + 0.02 * k, sw * 0.4, hip - sh + 0.03 * k); // 右側の陰
    // 首と頭
    c.fillStyle = sk; c.fillRect(x - 0.045 * k, hy + hr * 0.6, 0.09 * k, sh - hy - hr * 0.5);
    c.beginPath(); c.ellipse(x, hy, hr * 0.86, hr, 0, 0, 6.283); c.fill();
    c.fillStyle = 'rgba(110,60,30,.18)'; c.beginPath(); c.ellipse(x + hr * 0.32, hy + hr * 0.1, hr * 0.5, hr * 0.85, 0, 0, 6.283); c.fill();
    const hs = o ? 0 : (seed >> 11) % 4;
    if (hs === 0) { c.fillStyle = o ? o.hat : CLOTH[(seed >> 13) % CLOTH.length]; c.beginPath(); c.ellipse(x, hy - hr * 0.3, hr * 0.95, hr * 0.78, 0, Math.PI, 0); c.fill(); c.beginPath(); c.ellipse(x, hy - hr * 0.3, hr * 0.8, hr * 0.2, 0, 0, Math.PI); c.fill(); }
    else if (hs === 1) { c.fillStyle = hair; c.beginPath(); c.ellipse(x, hy - hr * 0.12, hr * 1.0, hr * 1.05, 0, Math.PI * 0.95, Math.PI * 0.05); c.fill(); c.fillRect(x - hr * 1.0, hy - hr * 0.2, hr * 0.3, hr * 1.5); c.fillRect(x + hr * 0.7, hy - hr * 0.2, hr * 0.3, hr * 1.5); }
    else { c.fillStyle = hair; c.beginPath(); c.ellipse(x, hy - hr * 0.28, hr * 0.92, hr * 0.8, 0, Math.PI, 0); c.fill(); }
    if (k > 60) { c.fillStyle = 'rgba(40,25,20,.65)'; c.fillRect(x - hr * 0.45, hy, hr * 0.17, hr * 0.11); c.fillRect(x + hr * 0.26, hy, hr * 0.17, hr * 0.11); }
  }
  Race.prototype.drawPaddock = function (c, dt) {
    const race = this.race, cam = this.pcam || (this.pcam = new Cam()), i0 = this.paddockIdx(), wx = WEATHER[race.weather] || WEATHER.sunny; PLITE = !!this.lite;
    const tp = this.paddockPos(i0), on = Math.hypot(tp.x / PA, tp.z / PB) || 1, ox = tp.x / on / PA * PB, oz = tp.z / on / PB * PA, ol = Math.hypot(ox, oz) || 1;
    const P = { x: tp.x - ox / ol * 9 + tp.hx * 5, y: 1.9, z: tp.z - oz / ol * 9 + tp.hz * 5 }, T = { x: tp.x - tp.hx * 0.5, y: 1.3, z: tp.z - tp.hz * 0.5 };
    const dist = Math.hypot(T.x - P.x, T.y - P.y, T.z - P.z), F = (0.62 * H) * dist / 2.1, fov = Math.max(8, Math.min(60, 2 * Math.atan((W / 2) / F) * 180 / Math.PI));
    if (cam.idx !== i0) { cam.idx = i0; cam.p = P; cam.t = T; cam.fov = fov; this.cut = 0.2; } else { const k = Math.min(1, (dt || 0.016) * 4); ['x', 'y', 'z'].forEach((a) => { cam.p[a] += (P[a] - cam.p[a]) * k; cam.t[a] += (T[a] - cam.t[a]) * k; }); cam.fov += (fov - cam.fov) * k; }
    cam.basis();
    const flat = (pts, col) => { c.beginPath(); if (addPoly(c, cam, pts)) { c.fillStyle = col; c.fill(); } };
    // 空・木立・建物
    const fh = norm3({ x: cam.f.x, y: 0, z: cam.f.z }), hz = cam.proj(cam.toCam({ x: cam.p.x + fh.x * 4000, y: 0, z: cam.p.z + fh.z * 4000 })).y;
    this.drawSky(c, hz, wx, cam);
    c.fillStyle = mixc(wx.apron, [0, 0, 0], 0.05); c.fillRect(0, Math.max(0, hz - 1), W, H);
    this.drawForest(c, wx, cam, PTREES);
    const gl = pat(c, 'glass'), X = PBOX.x, Z = PBOX.z, Hh = PBOX.h;
    const walls = [[-X, -Z, X, -Z], [X, -Z, X, Z], [X, Z, -X, Z], [-X, Z, -X, -Z]];
    for (const [x0, z0, x1, z1] of walls) {
      const len = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / len, nz = (x1 - x0) / len; // 内向き
      const at = (u, y, o) => ({ x: x0 + (x1 - x0) * u + nx * (o || 0), y, z: z0 + (z1 - z0) * u + nz * (o || 0) });
      flat([at(0, 0), at(1, 0), at(1, 3.4), at(0, 3.4)], '#cdc7bb');
      for (let u = 0; u < 1; u += 0.125) texQuad(c, cam, gl, at(u, Hh - 1), at(u + 0.125, Hh - 1), at(u + 0.125, 3.4), at(u, 3.4), u * len * 16, 0, (u + 0.125) * len * 16, (Hh - 4.4) * 16);
      flat([at(0, 3.4), at(1, 3.4), at(1, 3.8), at(0, 3.8)], '#efefec');
      flat([at(0, Hh - 1, 1.6), at(1, Hh - 1, 1.6), at(1, Hh - 1.05, 0), at(0, Hh - 1.05, 0)], '#6d737a');
      flat([at(0, Hh - 1, 1.6), at(1, Hh - 1, 1.6), at(1, Hh, 1.6), at(0, Hh, 1.6)], '#f2f2ef');
      // 柱
      c.beginPath(); for (let u = 0.0625; u < 1; u += 0.125) addPoly(c, cam, [at(u - 0.004, 0, 1.4), at(u + 0.004, 0, 1.4), at(u + 0.004, Hh - 1, 1.4), at(u - 0.004, Hh - 1, 1.4)]); c.fillStyle = '#e6e6e3'; c.fill();
    }
    // 観客の段（外の高い段から順に）と床
    for (let r = PSTEP - 1; r >= 0; r--) {
      const o0 = PST0 + PSTD * r, o1 = PST0 + PSTD * (r + 1), y = r * PSTH;
      flat(ellPts(o1, y), r % 2 ? '#c4beb2' : '#bdb7aa');
      if (r > 0) { const a = ellPts(o0, y), b = ellPts(o0, y - PSTH); c.beginPath(); for (let k = 0; k < a.length; k++) { const k2 = (k + 1) % a.length; addPoly(c, cam, [a[k], a[k2], b[k2], b[k]]); } c.fillStyle = '#9d978b'; c.fill(); }
    }
    flat(ellPts(PST0, 0), mixc(wx.apron, [0, 0, 0], 0.08));
    // 周回路（土）と内側の芝・花壇
    flat(ellPts(PW + 0.6, 0), '#b9b2a4');
    flat(ellPts(PW / 2, 0.005), '#bc9f74');
    c.beginPath(); for (let k = 0; k < 3; k++) { const a = ellPts(-PW / 2 + 0.6 + k * 0.9, 0.008), b = ellPts(-PW / 2 + 0.75 + k * 0.9, 0.008); for (let j = 0; j < a.length; j++) { const j2 = (j + 1) % a.length; addPoly(c, cam, [a[j], a[j2], b[j2], b[j]]); } } c.fillStyle = 'rgba(255,240,210,.18)'; c.fill();
    flat(ellPts(-PW / 2, 0.01), wx.turf);
    for (let k = -3; k <= 3; k++) flat([{ x: -PA, z: k * 3 }, { x: PA, z: k * 3 }, { x: PA, z: k * 3 + 1.5 }, { x: -PA, z: k * 3 + 1.5 }].map((p) => ({ x: p.x * Math.sqrt(Math.max(0, 1 - (p.z / (PB - PW / 2)) ** 2)) * 0.97, y: 0.012, z: p.z })), wx.turfHi);
    flat(ellPts(-PA + 6, 0.02).map((p) => ({ x: p.x, y: 0.02, z: p.z * 0.45 })), '#3f6b30');
    flat(ellPts(-PA + 6.6, 0.03).map((p) => ({ x: p.x * 0.97, y: 0.25, z: p.z * 0.4 })), '#c8434b');
    // 観客（奥から）
    const fans = [];
    for (const f of PCROWD) { const q = cam.toCam(f); if (q.z > 1.2) fans.push([q, f]); }
    fans.sort((a, b) => b[0].z - a[0].z);
    for (const [q, f] of fans) { const s = cam.proj(q); if (s.x < -s.s || s.x > W + s.s || s.y - 2 * s.s > H) continue; drawPerson(c, s.x, s.y, s.s, f.seed, this.t); }
    // 白い柵（観客と馬の間）
    const fa = ellPts(PW + 1, 1.0, 96), fb = ellPts(PW + 1, 1.12, 96);
    c.beginPath(); for (let k = 0; k < fa.length; k++) { const k2 = (k + 1) % fa.length; addPoly(c, cam, [fb[k], fb[k2], fa[k2], fa[k]]); } c.fillStyle = '#f6f6f4'; c.fill();
    c.beginPath(); for (let k = 0; k < 96; k++) { const p = fa[k], q0 = cam.toCam({ x: p.x, y: 0, z: p.z }); if (q0.z <= NEAR) continue; const s0 = cam.proj(q0), w = Math.max(1.5, 0.1 * s0.s); if (s0.x < -w || s0.x > W + w) continue; const s1 = cam.proj(cam.toCam(p)); c.rect(s0.x - w / 2, s1.y, w, s0.y - s1.y); } c.fillStyle = '#ececea'; c.fill();
    // 馬と厩務員（奥から）
    const items = [];
    for (let i = 0; i < race.horses.length; i++) items.push({ i, p: this.paddockPos(i) });
    items.forEach((it) => { it.cc = cam.toCam({ x: it.p.x, y: 0, z: it.p.z }); });
    items.filter((it) => it.cc.z > NEAR).sort((a, b) => b.cc.z - a.cc.z).forEach((it) => {
      const s = cam.proj(it.cc); if (s.x < -200 || s.x > W + 200) return;
      const i = it.i, h = race.horses[i], p = it.p;
      const hxc = p.hx * cam.r.x + p.hz * cam.r.z, hzc = p.hx * cam.f.x + p.hz * cam.f.z, ratio = Math.abs(hxc) / (Math.hypot(hxc, hzc) || 1);
      const view = ratio < 0.5 ? (hzc < 0 ? 'front' : 'back') : 'side', flip = hxc < 0, turn = view === 'side' ? (hzc < 0 ? -1 : 1) * Math.sqrt(Math.max(0, 1 - ratio * ratio)) : 0;
      this.groundShadow(c, p, 1.25, 0.42, 1.1, wx, cam);
      // 厩務員（馬の頭の内側を歩く）: 内側＝楕円の中心向き
      const inx = -p.x, inz = -p.z, il = Math.hypot(inx, inz) || 1, hp = { x: p.x + p.hx * 1.1 - inx / il * 0.85, z: p.z + p.hz * 1.1 - inz / il * 0.85 }, hc = cam.toCam({ x: hp.x, y: 0, z: hp.z });
      const drawHandler = () => { if (hc.z <= NEAR) return; const hs = cam.proj(hc); drawPerson(c, hs.x, hs.y, hs.s, 4242 + i * 977, this.t, { top: '#f4f4f2', pants: '#2b2d42', hat: '#1d2a44', bib: h.color, ink: h.ink, no: String(h.no) }); };
      const handlerBehind = hc.z > it.cc.z; if (handlerBehind) drawHandler();
      c.save(); c.translate(s.x, s.y); if (flip) c.scale(-1, 1);
      Horse.draw(c, 0, 0, s.s, h, this.t * 0.9 + i * 0.3, { shadow: false, squash: Math.max(0.3, ratio), view, flip, turn, walk: true });
      c.restore();
      if (!handlerBehind) drawHandler();
      if (s.s > 6) badge(c, s.x, s.y - 2.7 * s.s, Math.max(8, Math.min(14, s.s * 0.45)), h);
    });
  };
  Race.prototype.horsePos = function (i) {
    const u = this.run ? Math.min(1.04, this.run.pos[i]) : -0.4 / this.race.dist;
    const lr = this.lane ? this.lane[i] : laneR(i);
    return pointAt(this.startS + u * this.race.dist, lr);
  };
  // 前の進路取り（?layout=old で比べる用）: 目標の進路（内寄り）を決め、ゆっくり動かす。真横〜少し前に他馬がいれば外へ
  Race.prototype.updateLanesOld = function (dt) {
    const run = this.run, n = this.race.horses.length, dist = this.race.dist;
    if (!this.lane) this.lane = this.race.horses.map((_, i) => laneR(i));
    const order = this.race.horses.map((_, i) => i).sort((a, b) => run.pos[b] - run.pos[a]);
    const target = new Array(n);
    order.forEach((i, rank) => {
      const gone = run.pos[i] * dist;
      let want = gone < 120 ? laneR(i) : RI + 1.4 + (i % 3) * 0.25; // 120m を過ぎたら内へ
      // 前（0〜3.5m 先）で、ほぼ同じ進路にいる馬がいれば外へ 1.6m
      for (let k = 0; k < rank; k++) { const j = order[k], ahead = (run.pos[j] - run.pos[i]) * dist; if (ahead > -1.2 && ahead < 3.5 && Math.abs(this.lane[j] - want) < 1.5) want = Math.max(want, this.lane[j] + 1.6); }
      // 直線では差し・追込が外から伸びる
      if ((1 - run.pos[i]) * dist < 400 && (this.race.horses[i].type === 'sashi' || this.race.horses[i].type === 'oikomi')) want = Math.max(want, RI + 3 + (i % 3) * 1.2);
      target[i] = Math.min(RO - 1.0, want);
    });
    for (let i = 0; i < n; i++) this.lane[i] += (target[i] - this.lane[i]) * Math.min(1, dt * 0.6);
  };
  /* ---------- 進路取り（横の位置）: 馬どうしが重ならないように（2D・3D 共通。3D の Race3D もこれを使う） ----------
     着順・タイムを決めるのはエンジンの進んだ距離（run.pos）だけ。ここで動かすのは横の位置（コースの中心からの半径＝lane）だけなので結果は変わらない。
     1) 馬ごとの「行きたい進路」: 最初の 120m は自分の枠の進路、そのあとは内ラチ沿い、直線では差し・追込が外へ（前と同じ）。
     2) 前後に重なっている（または近づいていて 2 秒以内に重なる）2 頭は「横に並ぶ組」にし、内外の順番を決めて固定する
        （重なっている間は入れ替わらない＝体を通り抜けない）。横の間隔は 2 頭の体の半幅の和＋0.3m。前後の長さ・幅は馬の形から（this.hdim）。
     3) 行きたい進路から、並ぶ組の間隔とラチ（内外とも体の端から 0.95m）を満たす目標を、後ろの馬が多めに動く形で求める（数回の押し合い）。
     4) 実際の横の動きは、速さ（全力で 1.6m/秒・流すとき・歩くときは遅く）と加速度（2.2m/秒²）を制限してなめらかに目標へ。
     5) 念のため: それでも前後に重なっていて横の間隔が足りないときは、3m/秒までで押し広げる（layoutStats.emerg に回数）。
     ?layout=old で前の進路取り（比べる用） */
  const LAYOUT_OLD = /[?&]layout=old/.test(location.search);
  const DIM0 = { f: 1.65, b: 0.78, hw: 0.42 };       // 馬の形が分からないとき: 原点から鼻先・尻まで（m）、体の半幅（騎手の足まで）
  const LAT_GAP = 0.3, LAT_A = 2.2, LAT_EM = 3, LOOK_T = 2.0, LONG_M = 1.0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  Race.prototype.updateLanes = function (dt) {
    if (LAYOUT_OLD) return this.updateLanesOld(dt);
    const run = this.run, race = this.race, n = race.horses.length, dist = race.dist;
    if (!this.lane || !this.lv) { this.lane = this.lane || race.horses.map((_, i) => laneR(i)); this.lv = race.horses.map(() => 0); this.lanePair = {}; this.layoutStats = this.layoutStats || { emerg: 0 }; }
    if (!(dt > 0) || !run) return;
    const y = this.lane, lv = this.lv, P = this.lanePair;
    const s = [], v = [], dm = [], pref = [], lo = [], hi = [];
    for (let i = 0; i < n; i++) {
      const u = Math.min(1.04, run.pos[i]);
      s[i] = this.horseS ? this.horseS(i) : this.startS + u * dist;
      v[i] = this.spd && this.spd[i] != null ? this.spd[i] : run.pos[i] >= 1.04 ? 0 : (run.speed[i] || 0) * dist / run.length;
      dm[i] = (this.hdim && this.hdim[i]) || DIM0;
      lo[i] = RI + 0.95 + dm[i].hw; hi[i] = RO - 0.95 - dm[i].hw;
      const gone = Math.min(1, run.pos[i]) * dist, ty = race.horses[i].type;
      // 120m を過ぎたら内ラチ沿いへ。全馬が一度に内へ寄ると押し合いの連鎖になるので、行きたい進路を 200m かけて少しずつ内へ
      const kIn = clamp((gone - 120) / 200, 0, 1), rail = RI + 1.4 + (i % 3) * 0.25;
      let want = laneR(i) + (rail - laneR(i)) * kIn * kIn * (3 - 2 * kIn);
      if ((1 - run.pos[i]) * dist < 400 && (ty === 'sashi' || ty === 'oikomi')) want = Math.max(want, RI + 3 + (i % 3) * 1.2);
      if (run.finish[i]) want = y[i]; // ゴール後はそのままの進路で流す
      pref[i] = clamp(want, lo[i], hi[i]);
    }
    // コーナーでは外の進路ほど同じ s の差でも実際の前後の距離が長い
    const kAt = (ss, r) => { const m = ((ss % L) + L) % L; return (m >= LS && m < LS + Math.PI * RC) || m >= 2 * LS + Math.PI * RC ? r / RC : 1; };
    // 2) 並ぶ組（前後に重なる・近づいている 2 頭）と内外の順番
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = s[i] >= s[j] ? i : j, b = a === i ? j : i;                  // a が前、b が後ろ
      const gapL = (s[a] - s[b]) * kAt(s[a], (y[a] + y[b]) / 2) - (dm[b].f + dm[a].b); // 後ろの馬の鼻先から前の馬の尻まで（負なら前後に重なっている）
      const key = i * 8 + j, old = P[key], need = dm[i].hw + dm[j].hw + LAT_GAP;
      // 近づく速さ: 勝ち馬のアップで止まる勝ち馬は、止まったものとして先に見る（後ろから来る馬が早めによける）
      const va = this.phase === 'winner' && a === this.winnerIdx ? 0 : v[a], close = Math.max(0, v[b] - va);
      const win = LONG_M + close * LOOK_T + (old ? 0.8 : 0);
      if (gapL >= win) { if (old) delete P[key]; continue; }
      let side = old ? old.side : 0;                                      // +1: j が i より外
      if (!side) {
        const sep = y[j] - y[i];
        if (Math.abs(sep) >= need * 0.35) side = sep > 0 ? 1 : -1;
        else { // ほぼ真後ろ: 後ろの馬が行きたい側（内に入れる余地がなければ外）へ
          const inside = y[a] - need >= lo[b] && pref[b] < y[a] - 0.3, bOut = !inside;
          side = (b === j) === bOut ? 1 : -1;
        }
        P[key] = { side };
      }
      pairs.push({ i, j, side, need, a, b, gapL, close });
    }
    // 3) 目標: 並ぶ組の「内→外」の順に並べ（トポロジカル順。決まっていない所は今の進路の順）、内から順に「行きたい進路」と
    //    内の相手＋間隔の大きい方へ置く（内ラチ側の馬が進路を守り、外の馬が外を回る）。外ラチを越える分は外から順に内へ戻す。
    //    止まりかけ（勝ち馬のアップなど 2m/秒未満）の馬は動かさず、ほかの馬がよける
    for (let i = 0; i < n; i++) if (v[i] < 2) lo[i] = hi[i] = pref[i] = y[i];
    const outE = [], inE = [], deg = new Array(n).fill(0);
    for (let i = 0; i < n; i++) { outE.push([]); inE.push([]); }
    for (const p of pairs) { const inn = p.side > 0 ? p.i : p.j, out = p.side > 0 ? p.j : p.i; outE[inn].push([out, p.need]); inE[out].push([inn, p.need]); deg[out]++; }
    const order = [], done = new Array(n).fill(false);
    for (let k = 0; k < n; k++) { // 内側にだれも残っていない馬のうち、今いちばん内にいる馬から
      let best = -1; for (let i = 0; i < n; i++) if (!done[i] && deg[i] === 0 && (best < 0 || y[i] < y[best])) best = i;
      if (best < 0) for (let i = 0; i < n; i++) if (!done[i] && (best < 0 || y[i] < y[best])) best = i; // 順番が輪になった（まれ）: 今の順で
      done[best] = true; order.push(best); for (const e of outE[best]) deg[e[0]]--;
    }
    const tgt = new Array(n);
    for (const k of order) { let x = Math.max(pref[k], lo[k]); for (const e of inE[k]) if (done[e[0]] && tgt[e[0]] != null) x = Math.max(x, tgt[e[0]] + e[1]); tgt[k] = x; }
    for (let q = n - 1; q >= 0; q--) { const k = order[q]; let x = Math.min(tgt[k], hi[k]); for (const e of outE[k]) x = Math.min(x, tgt[e[0]] - e[1]); tgt[k] = Math.max(x, lo[k] - 0.3); }
    // 4) なめらかに動かす（細かく刻む）。前後に重なっていて横の間隔が足りない組の馬は急ぐ（速さ 2.6m/秒・加速度 6m/秒² まで。位置は跳ばない）
    const urgent = new Array(n).fill(false);
    for (const p of pairs) { if (p.gapL > 0.3 + p.close * 1.0) continue; /* 1 秒以内に重なる組も */ const inn = p.side > 0 ? p.i : p.j, out = p.side > 0 ? p.j : p.i; if (y[out] - y[inn] < p.need) urgent[inn] = urgent[out] = true; }
    const steps = Math.max(1, Math.ceil(dt / 0.034)), h = dt / steps;
    for (let st = 0; st < steps; st++) {
      for (let i = 0; i < n; i++) {
        const A = urgent[i] ? 6 : LAT_A, vmax = urgent[i] ? 2.6 : Math.min(1.6, 0.35 + 0.12 * v[i]), err = tgt[i] - y[i], ae = Math.max(0, Math.abs(err) - 0.01);
        const vd = Math.sign(err) * Math.min(vmax, ae * (urgent[i] ? 3 : 1.4), Math.sqrt(2 * A * 0.8 * ae));
        lv[i] += clamp(vd - lv[i], -A * h, A * h);
        y[i] += lv[i] * h;
      }
    }
    // 5) 念のため: 前後に重なっているのに横の間隔が足りない組を押し広げる
    for (const p of pairs) {
      if (p.gapL > 0.05) continue;
      const inn = p.side > 0 ? p.i : p.j, out = p.side > 0 ? p.j : p.i, viol = p.need - LAT_GAP + 0.05 - (y[out] - y[inn]); // 体と体が 5cm まで近づいたら（ふだんは 4) の急ぎ足で間に合う）
      if (viol <= 0) continue;
      this.layoutStats.emerg++; if (!this.layoutStats.last || this.layoutStats.n0 !== this.layoutStats.emerg - 1) this.layoutStats.last = { t: run.t, i: p.i, j: p.j, gapL: p.gapL, sep: y[out] - y[inn], need: p.need, y: y.map((x) => +x.toFixed(2)), tgt: tgt.map((x) => +x.toFixed(2)), s: s.map((x) => +x.toFixed(2)), v: v.map((x) => +x.toFixed(1)), pairs: JSON.stringify(P) };
      this.layoutStats.n0 = this.layoutStats.emerg;
      const mob = (k) => (k === p.b ? 3 : 1) * Math.min(1, 0.02 + v[k] / 5);
      // 位置は跳ばさず、離れる向きの横の速さを 1 秒に 12m/秒 まで足す（3m/秒 まで）
      const mi = mob(inn), mo = mob(out), w = mi / (mi + mo), dv = 12 * dt;
      const vi = Math.max(-LAT_EM, Math.min(lv[inn], lv[inn] - dv * w * 2)), vo = Math.min(LAT_EM, Math.max(lv[out], lv[out] + dv * (1 - w) * 2));
      y[inn] += (vi - lv[inn]) * dt; y[out] += (vo - lv[out]) * dt; lv[inn] = vi; lv[out] = vo;
    }
    for (let i = 0; i < n; i++) { if (y[i] < lo[i] - 0.3) { y[i] = Math.max(y[i], lo[i] - 0.3); lv[i] = Math.max(0, lv[i]); } if (y[i] > hi[i] + 0.3) { y[i] = hi[i] + 0.3; lv[i] = Math.min(0, lv[i]); } }
    this.laneTarget = tgt;
  };
  // 馬群の中心: 座標の平均だとコーナーで内側に落ちるので、コースに沿った「平均の進み具合」で出す
  // k を渡すと「先頭から k 頭」の平均（直線では上位の争いを映す）
  Race.prototype.packCenter = function (k) {
    const n = this.race.horses.length; const us = []; for (let i = 0; i < n; i++) us.push(this.run ? Math.min(1.04, this.run.pos[i]) : 0);
    us.sort((a, b) => b - a); k = Math.min(n, k || n); let u = 0; for (let i = 0; i < k; i++) u += us[i];
    const p = pointAt(this.startS + (u / k) * this.race.dist, RC); return { x: p.x, y: 0, z: p.z, hx: p.hx, hz: p.hz };
  };
  Race.prototype.leaderIdx = function () { let L_ = 0; if (!this.run) return 0; for (let i = 1; i < this.run.n; i++) if (this.run.pos[i] > this.run.pos[L_]) L_ = i; return L_; };

  /* ---------- カメラ台本（JRA の実際の中継映像 85 コマを参考にした運び） ----------
     gate  : 発走地点の斜め前・外の高台（ゲート全景 → 飛び出す馬群）
     wide  : スタンド最上部から馬群全体を小さく。だんだん寄る
     tele  : スタンドからの望遠でほぼ水平の横からの追い（馬が画面の 3 割、手前に内ラチ）。ときどき引き
     pole  : 3 コーナー手前の内馬場のカメラ。手前にハロン棒（とダートのラチ）、奥に馬群と木立
     far   : スタンドから 3〜4 コーナーの超望遠。馬群が一本の線、奥は木立と街
     c4    : 4 コーナー、直線の入口から斜め前の圧縮された馬群
     fan   : 直線入口をスタンドの高い位置から（扇形に広がる馬群）
     goal  : ゴール側のスタンドから向かってくる馬群を上から
     front : ゴール前を内馬場側から横に追う（奥に植え込み・観客・スタンド）
     replay: ゴール前の低い内側アングル（スロー）／ winner: 勝ち馬のアップ
     画角は「馬の高さが画面の何割か（size）」と「横に何 m 入れるか（fitW）」の広い方で決める。 */
  // 上位 k 頭がコース上のどこからどこまでにいるか（s は周回上の位置）
  Race.prototype.group = function (k) {
    const n = this.race.horses.length, d = this.race.dist, us = [];
    for (let i = 0; i < n; i++) us.push(this.run ? Math.min(1.04, this.run.pos[i]) : -0.4 / d);
    us.sort((a, b) => b - a); k = Math.max(1, Math.min(n, k || n));
    const s1 = this.startS + us[0] * d, s0 = this.startS + us[k - 1] * d;
    return { s0, s1, mid: (s0 + s1) / 2, span: s1 - s0 };
  };
  // カメラと被写体の間にターフビジョンや内馬場の木があるか（スタンドから見て正面を向いた板として調べる）
  const OCCL = [{ x: VIS.x, z: VIS.z, w: VIS.w, y0: VIS.y0, y1: VIS.y0 + VIS.h }].concat(ITREES.map((t) => ({ x: t.x, z: t.z, w: t.rad * 2.2, y0: t.h * 0.3, y1: t.h })));
  function blocked(P, T) {
    const dz = T.z - P.z; if (Math.abs(dz) < 1e-6) return false;
    for (const o of OCCL) { const k = (o.z - P.z) / dz; if (k <= 0 || k >= 1) continue; const x = P.x + (T.x - P.x) * k, y = P.y + (T.y - P.y) * k; if (Math.abs(x - o.x) < o.w / 2 + 3 && y > o.y0 - 3 && y < o.y1 + 1.5) return true; }
    return false;
  }
  Race.prototype.placeCamera = function (dt, snap) {
    const cam = this.cam, race = this.race, t = this.t, n = race.horses.length;
    const Li = this.leaderIdx(), lead = this.horsePos(Li);
    const u = this.run ? Math.min(1, this.run.pos[Li]) : 0, remain = race.dist * (1 - u), gone = race.dist * u;
    let mode;
    if (this.gateShot) mode = 'gate';
    else if (this.phase === 'idle') mode = 'paddock' + this.paddockIdx();
    else if (this.phase === 'replay') mode = 'replay';
    else if (this.phase === 'winner') mode = 'winner';
    else if (gone < 40) mode = 'gate';
    else if (gone < 150) mode = 'wide';
    else if (remain > 640) mode = 'tele';
    else if (remain > 520) mode = 'pole';
    else if (remain > 420) mode = 'far';
    else if (remain > 300) mode = 'c4';
    else if (remain > 140) mode = 'fan';
    else if (remain > 45) mode = 'goal';
    else mode = 'front';
    const whole = mode === 'gate' || mode === 'wide' || mode === 'far' || mode === 'fan';
    const g = this.group(whole ? n : mode === 'front' || mode === 'replay' ? 2 : 3), gp = pointAt(g.mid, RI + 3.5);
    let tgt = { x: gp.x, z: gp.z };
    if (mode.startsWith('paddock')) tgt = this.horsePos(this.paddockIdx());
    else if (mode === 'winner') tgt = this.horsePos(this.winnerIdx >= 0 ? this.winnerIdx : Li);
    else if (mode === 'front') { const lp = lead; tgt = { x: (lp.x * 2 + gp.x) / 3, z: (lp.z * 2 + gp.z) / 3 }; }
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    let P, size = 0.3, fitW = 0, sway = 0.1, ty = 1.1;
    if (mode.startsWith('paddock')) { const hp = this.horsePos(this.paddockIdx()), o = outward(hp); P = { x: hp.x + hp.hx * 10 + o.x * 5, y: 3.4, z: hp.z + hp.hz * 10 + o.z * 5 }; size = 0.58; }
    else if (mode === 'gate') {
      const gc = pointAt(this.startS + 46, RO + 15); P = { x: gc.x, y: 9, z: gc.z };
      if (this.gateShot || !this.run || this.run.t < 0.6) { const c0 = pointAt(this.startS - 0.4, (laneR(0) + laneR(n - 1)) / 2); tgt = { x: c0.x, z: c0.z }; fitW = 24; size = 1; }
      else { fitW = 26 + g.span * 1.2; size = 1; sway = 0.15; }
    }
    else if (mode === 'wide') { P = { x: clamp(tgt.x * 0.5, -170, 200), y: 34, z: ST + 3 }; fitW = g.span + 80 - 45 * clamp((gone - 40) / 110, 0, 1); size = 1; sway = 0.3; }
    else if (mode === 'tele') { P = { x: clamp(tgt.x * 0.65, -170, 210), y: 26, z: ST + 3 }; const k = Math.floor(t / 14) % 3; size = k === 2 ? 0.13 : 0.3; fitW = g.span + (k === 2 ? 34 : 9); sway = 0.35; }
    else if (mode === 'far') { P = { x: 40, y: 30, z: ST + 3 }; size = 0.09; fitW = g.span + 40; sway = 0.2; ty = 4; }
    else if (mode === 'pole') { P = { x: -LS / 2 + 30, y: 4, z: -RI + 32 }; size = 0.17; fitW = g.span + 24; ty = 1.8; } // 3 コーナー手前の内馬場。「6」のハロン棒の向こうを馬群が通る
    else if (mode === 'c4') { const c0 = pointAt(FINISH_S - 230, RO + 18); P = { x: c0.x, y: 12, z: c0.z }; size = 0.24; fitW = g.span + 14; }
    else if (mode === 'fan') { P = { x: 60, y: 30, z: ST + 3 }; size = 0.1 + 0.06 * clamp(1 - (remain - 140) / 160, 0, 1); fitW = g.span + 30; sway = 0.25; }
    else if (mode === 'goal') { P = { x: FINISH_S - LS / 2 + 15, y: 18, z: ST + 3 }; size = 0.2 + 0.14 * clamp(1 - (remain - 45) / 95, 0, 1); fitW = g.span + 12; sway = 0.3; }
    else if (mode === 'front') { P = { x: FINISH_S - LS / 2 - 14, y: 4.5, z: RI - 24 }; size = 0.32; fitW = g.span + 10; }
    else if (mode === 'replay') { const c0 = pointAt(FINISH_S - 6, RI - 3); P = { x: c0.x, y: 1.5, z: c0.z }; size = 0.62; fitW = g.span + 5; ty = 1.5; }
    else { const c0 = pointAt(FINISH_S + 30, RC + 1); P = { x: c0.x, y: 1.6, z: c0.z }; size = 0.6; }
    const T = { x: tgt.x + Math.sin(t * 1.3) * sway, y: ty + Math.cos(t * 0.9) * sway * 0.3, z: tgt.z + Math.cos(t * 1.1) * sway };
    // ターフビジョンや木で馬が隠れるなら、スタンド上のとなりのカメラへずらす
    if (P.z > ST) for (let k = 0; k < 4 && blocked(P, T); k++) P.x += (k % 2 ? 1 : -1) * 55 * (k + 1);
    const dist = Math.hypot(T.x - P.x, T.y - P.y, T.z - P.z);
    let F = (size * H) * dist / 2.1; if (fitW > 0) F = Math.min(F, W * dist / fitW);
    const fov = Math.max(3, Math.min(62, 2 * Math.atan((W / 2) / F) * 180 / Math.PI));
    if (mode !== cam.mode || snap) { cam.mode = mode; cam.p = P; cam.t = T; cam.fov = fov; this.cut = 0.22; }
    else {
      const kt = Math.min(1, dt * 7); cam.t.x += (T.x - cam.t.x) * kt; cam.t.y += (T.y - cam.t.y) * kt; cam.t.z += (T.z - cam.t.z) * kt;
      const kp = Math.min(1, dt * 3); cam.p.x += (P.x - cam.p.x) * kp; cam.p.y += (P.y - cam.p.y) * kp; cam.p.z += (P.z - cam.p.z) * kp;
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 2.2);
    }
    cam.basis();
  };

  /* ---------- 本番 ---------- */
  Race.prototype.start = function (opt) {
    const self = this, race = this.race;
    opt = opt || {};
    this.run = opt.run || Engine.createRun(race, null, { boost: opt.boost }); // opt.run: v2 の決まった走り（2D の映像でも勝ち馬はサーバーの決めたとおり。時刻合わせは 3D だけ）
    this.phase = 'run'; this.t = 0; this.tape = []; this.slow = 1; this.lane = null; this.slowSaid = false; this.winnerIdx = -1; this.winnerIdx_set = false; this.saidStart = false; this.saidCorner = false; this.saidStraight = false; this.split1000 = null; this.lastCall = 0; this.callNo = 0; this.t600 = null; this.last3f = null;
    return new Promise((resolve) => {
      let last = performance.now(), leader = -1, leaderSince = 0, finishedAt = 0, said200 = false, said400 = false;
      const kicked = {};
      function frame(now) {
        const real = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
        const run = self.run;
        const sorted = race.horses.map((_, i) => i).sort((a, b) => run.pos[b] - run.pos[a]);
        const gap = (run.pos[sorted[0]] - run.pos[sorted[1]]) * race.dist;
        // ゴール前スロー: 先頭がゴールまで 45m を切ったら必ずスローに入り、1着がゴールした瞬間に元の速さへ戻す
        // （以前は全馬ゴールまで finishedAt が立たず、ゴール後に上位が並んで見えてスローが続いていた）
        const leadLeft = (1 - run.pos[sorted[0]]) * race.dist;
        // 接戦（1・2 番手の差が 1 馬身＝約 2.4m 以内）のときだけスロー。いったん入ったら 1.5 馬身を超えて離れるまで続ける（ちらつき防止）
        if (run.done || leadLeft >= 45) self.slowLock = false; else if (gap < 2.4) self.slowLock = true; else if (gap > 3.6) self.slowLock = false;
        const targetSlow = (!run.done && leadLeft < 45 && self.slowLock) ? 0.32 : 1;
        self.slow += (targetSlow - self.slow) * Math.min(1, real * (targetSlow < 1 ? 7 : 4));
        const dt = real * self.slow * (self.timeScale || 1);
        if (!finishedAt) { if (run.step(dt)) finishedAt = run.t; }
        else run.t += dt;
        self.t = run.t;
        self.updateLanes(dt);
        self.tape.push({ t: run.t, pos: run.pos.slice(), lane: self.lane.slice() }); if (self.tape.length > 1200) self.tape.shift();
        const L_ = self.leaderIdx();
        const leadU = Math.min(1, run.pos[L_]);
        const remain = Math.max(0, Math.round((1 - leadU) * race.dist / 50) * 50);
        if (run.t > 1.5 && L_ !== leader && run.t - leaderSince > 1.2 && !run.finish[L_]) { const first = leader < 0; leader = L_; leaderSince = run.t; if (opt.onEvent) opt.onEvent(first ? '先手を取ったのは ' + (L_ + 1) + '番 ' + race.horses[L_].name : (L_ + 1) + '番 ' + race.horses[L_].name + ' が先頭に立った！'); }
        if (self.t600 == null && (1 - run.pos[L_]) * race.dist <= 600) self.t600 = run.t;
        if (finishedAt && self.last3f == null) { const w = run.order()[0]; self.last3f = run.finish[w] - (self.t600 || 0); }
        if (race.dist > 1000 && !self.split1000 && run.pos[L_] * race.dist >= 1000) { const t = Math.round(run.t * 10) / 10; self.split1000At = t; self.split1000 = Math.floor(t / 60) + '.' + (t % 60 < 10 ? '0' : '') + (t % 60).toFixed(1); if (opt.onEvent) opt.onEvent('1000m 通過 ' + self.split1000); }
        if (!self.saidStart && run.t > 0.4) { self.saidStart = true; if (opt.onEvent) opt.onEvent('各馬一斉にスタート！'); }
        if (run.t > 9 && remain > 560 && run.t - (self.lastCall || 0) > 12) {
          self.lastCall = run.t; const o3 = race.horses.map((_, i) => i).sort((p, q) => run.pos[q] - run.pos[p]);
          const lines = ['先頭は ' + (o3[0] + 1) + '番、2番手に ' + (o3[1] + 1) + '番、3番手 ' + (o3[2] + 1) + '番', (o3[0] + 1) + '番が引っ張る展開、' + (o3[5] + 1) + '番は最後方で脚をためる', '向こう正面、' + (o3[1] + 1) + '番が ' + (o3[0] + 1) + '番に並びかけてきた'];
          if (opt.onEvent) opt.onEvent(lines[(self.callNo = (self.callNo || 0) + 1) % lines.length]);
        }
        if (!self.saidCorner && remain <= (race.dist <= 600 ? 450 : 520) && remain > 380) { self.saidCorner = true; if (opt.onEvent) opt.onEvent(race.dist <= 600 ? '4コーナー、すぐに最後の直線へ' : '3コーナーから4コーナー、馬群が固まって回ってくる'); } // 500m は 4 コーナーの途中から発走
        if (!self.saidStraight && remain <= 380 && remain > 240) { self.saidStraight = true; if (opt.onEvent) opt.onEvent('4コーナーを回って 直線に向いた！'); }
        for (let i = 0; i < run.n; i++) {
          const ty = race.horses[i].type;
          if (!kicked[i] && !run.finish[i] && ((ty === 'sashi' && run.pos[i] > 0.55) || (ty === 'oikomi' && run.pos[i] > 0.68))) { kicked[i] = 1; if (opt.onEvent) opt.onEvent((i + 1) + '番 仕掛けた！'); }
        }
        if (!said200 && remain <= 200) { said200 = true; const o2 = race.horses.map((_, i) => i).sort((p, q) => run.pos[q] - run.pos[p]); if (opt.onEvent) opt.onEvent('残り 200m！ ' + (o2[0] + 1) + '番先頭、' + (o2[1] + 1) + '番が追ってくる！'); }
        if (self.slow < 0.6 && !self.slowSaid && gap < 2.5) { self.slowSaid = true; if (opt.onEvent) opt.onEvent('ゴール前 大接戦！'); }
        if (!finishedAt && self.dust.length < 160) for (let i = 0; i < run.n; i++) if (Math.random() < 0.55) { const p = self.horsePos(i), sp = (run.speed[i] || 1) * race.dist / run.length; self.dust.push({ x: p.x - p.hx * 0.9, z: p.z - p.hz * 0.9, y: 0.05, vx: -p.hx * (2 + Math.random() * 3) + p.hx * sp * 0.6, vz: -p.hz * (2 + Math.random() * 3) + p.hz * sp * 0.6 + (Math.random() - 0.5), vy: 1.5 + Math.random() * 2.2, r: 0.05 + Math.random() * 0.06, a: 0.9, col: race.surface === 'dirt' ? '196,160,112' : (Math.random() < 0.6 ? '92,120,52' : '120,96,64') }); }
        self.dust.forEach((d) => { d.x += (d.vx || 0) * dt; d.z += (d.vz || 0) * dt; d.vy = (d.vy || 0) - 9.8 * dt; d.y = Math.max(0, d.y + d.vy * dt); if (d.y === 0) d.a -= dt * 3; d.a -= dt * 0.8; }); self.dust = self.dust.filter((d) => d.a > 0);
        self.placeCamera(real, false);
        if (self.cut > 0) self.cut -= real;
        if (self.label !== 'PHOTO FINISH' || self.cut <= 0) self.label = self.slow < 0.7 ? 'SLOW' : '';
        self.draw();
        if (opt.onTick) opt.onTick({ t: run.t, leader: L_, remain, pos: run.pos, finish: run.finish, slow: self.slow });
        if (run.done >= 2 && !self.winnerIdx_set) { self.winnerIdx_set = true; /* 2 着の馬がゴールした時点で決める（全馬のゴールを待つと写真判定の字幕が遅れた） */ self.winnerIdx = run.order()[0]; const f = run.finish.slice().filter((x) => x > 0).sort((x, y) => x - y); if (f.length >= 2 && (f[1] - f[0]) * 14 < 0.5) { self.label = 'PHOTO FINISH'; self.cut = 0.5; if (opt.onEvent) opt.onEvent('写真判定！'); } }
        if (finishedAt && run.t > finishedAt + 1.1) {
          const result = { order: run.order(), finish: run.finish.slice() };
          self.replay(Math.min.apply(null, run.finish.filter((x) => x > 0))).then(() => self.winnerShot()).then(() => { self.phase = 'done'; resolve(result); });
          return;
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  };
  Race.prototype.replay = function (finishedAt) {
    const self = this, tape = this.tape.filter((f) => f.t >= finishedAt - 2.4 && f.t <= finishedAt + 0.6);
    if (tape.length < 10) return Promise.resolve();
    const live = this.run.pos.slice(), liveLane = this.lane ? this.lane.slice() : null;
    this.phase = 'replay'; this.label = 'REPLAY'; this.placeCamera(0, true);
    return new Promise((resolve) => {
      let k = 0, last = performance.now(), acc = 0;
      function frame(now) {
        const real = Math.min(0.05, Math.max(0.001, (now - last) / 1000)) * (self.timeScale || 1); last = now; acc += real * 0.5;
        while (k < tape.length - 1 && tape[k + 1].t - tape[0].t <= acc) k++;
        for (let i = 0; i < live.length; i++) { self.run.pos[i] = tape[k].pos[i]; if (tape[k].lane) self.lane[i] = tape[k].lane[i]; }
        self.t += real;
        // 場面の切り替えの白いフラッシュ（cut）はここでも減らす（減らさないとリプレイ〜勝ち馬のアップの間ずっと白っぽく残っていた）
        self.placeCamera(real, false); if (self.cut > 0) self.cut -= real; self.draw();
        if (k >= tape.length - 1) { for (let i = 0; i < live.length; i++) { self.run.pos[i] = live[i]; if (liveLane) self.lane[i] = liveLane[i]; } self.label = ''; self.phase = 'run'; self.draw(); resolve(); return; }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  };

  Race.prototype.winnerShot = function () {
    const self = this; this.phase = 'winner'; this.label = '1着 ' + (this.winnerIdx + 1) + '番'; this.placeCamera(0, true);
    return new Promise((resolve) => { let last = performance.now(), left = 1.6; function frame(now) { const real = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now; left -= real; self.t += real; self.placeCamera(real, false); if (self.cut > 0) self.cut -= real; self.draw(); if (left <= 0) { self.label = ''; self.phase = 'run'; resolve(); return; } requestAnimationFrame(frame); } requestAnimationFrame(frame); });
  };

  /* ---------- 描画 ----------
     奥から順に: 空・雲 → 地面（コース・内馬場・スタンド前の広場）→ 空気のかすみ → 街の建物 → 木立・フェンス
     → スタンド・観客 → ラチ → ゲート → （奥行き順に）馬・土ぼこり・ハロン棒・ゴール板・内馬場の木・ターフビジョン
     → 馬群のそばの手前のラチ（中継の「手前に内ラチ」）→ ゼッケン → 雨 → 画面の仕上げ → テロップ */
  Race.prototype.draw = function () {
    const c = this.ctx, race = this.race, cam = this.cam;
    if (!race) return;
    this.fitRes();
    const t0 = performance.now();
    this.drawScene(c, race, cam);
    // 遅い機械（Fire TV など）なら飾りを減らす: 1 コマの描画が平均 7ms を超えたら軽い描き方に切り替える
    const dt = performance.now() - t0; this.drawMs = this.drawMs == null ? dt : this.drawMs * 0.97 + dt * 0.03;
    if (!this.lite && (this.frames = (this.frames || 0) + 1) > 90 && this.drawMs > 7) { this.lite = true; this.resAt = 0; console.info('casa DERBY: 軽い描き方に切り替え (' + this.drawMs.toFixed(1) + 'ms)'); }
  };
  Race.prototype.drawScene = function (c, race, cam) {
    if (this.inPaddock()) { this.drawPaddock(c, 0.016); this.drawPost(c); this.drawHud(c); return; }
    const wx = WEATHER[race.weather] || WEATHER.sunny, dirt = race.surface === 'dirt';
    const fh = norm3({ x: cam.f.x, y: 0, z: cam.f.z });
    const hz = cam.proj(cam.toCam({ x: cam.p.x + fh.x * 5000, y: 0, z: cam.p.z + fh.z * 5000 })).y;
    this.drawSky(c, hz, wx);
    c.fillStyle = wx.grass; c.fillRect(0, Math.max(0, Math.floor(hz) - 1), W, H);
    this.drawGround(c, wx, dirt);
    this.drawHaze(c, hz, wx);
    this.drawRemainLines(c);
    if (!this.lite) this.drawCity(c, wx);
    this.drawForest(c, wx);
    this.drawStand(c, wx);
    this.drawRails(c, wx, dirt, null);
    if (!this.run || this.run.t < 5) this.drawGate(c); // ゲートは発走後すぐに片付ける
    const items = [];
    for (let i = 0; i < race.horses.length; i++) { const p = this.horsePos(i); const cc = cam.toCam({ x: p.x, y: 0, z: p.z }); if (cc.z > NEAR) items.push({ kind: 'horse', i, p, cc }); }
    this.dust.forEach((d) => { const cc = cam.toCam({ x: d.x, y: d.y, z: d.z }); if (cc.z > NEAR) items.push({ kind: 'dust', d, cc }); });
    for (let m = 200; m < L; m += 200) { const p = pointAt(FINISH_S - m, RI - 1.2), cc = cam.toCam({ x: p.x, y: 0, z: p.z }); if (cc.z > NEAR) items.push({ kind: 'pole', m, p, cc }); }
    [RI - 1.0, RO + 1.0].forEach((r, k) => { const p = pointAt(FINISH_S, r), cc = cam.toCam({ x: p.x, y: 0, z: p.z }); if (cc.z > NEAR) items.push({ kind: 'goal', k, p, cc }); });
    ITREES.forEach((tr) => { const cc = cam.toCam(tr); if (cc.z > NEAR) items.push({ kind: 'tree', tr, cc }); });
    { const cc = cam.toCam({ x: VIS.x, y: 0, z: VIS.z }); if (cc.z > NEAR) items.push({ kind: 'vision', cc }); }
    items.sort((a, b) => b.cc.z - a.cc.z);
    const badges = [], running = this.phase !== 'idle';
    // 土ぼこりは同じ色・濃さが続くあいだ 1 つの path にまとめて塗る（数が多いので）
    let dStyle = '', dOpen = false;
    const flushDust = () => { if (dOpen) { c.fillStyle = dStyle; c.fill(); dOpen = false; } };
    for (const it of items) {
      if (it.kind !== 'dust') flushDust();
      if (it.kind === 'pole') { this.drawPole(c, it, wx); continue; }
      if (it.kind === 'goal') { this.drawGoalPost(c, it, wx); continue; }
      if (it.kind === 'tree') { this.drawTree(c, it.tr, it.cc, wx); continue; }
      if (it.kind === 'vision') { this.drawVision(c, wx); continue; }
      const s = cam.proj(it.cc);
      if (it.kind === 'dust') {
        const rr = it.d.r * s.s; if (rr < 0.7 || s.x < -12 || s.x > W + 12 || s.y < -12 || s.y > H + 12) continue;
        const st = 'rgba(' + (it.d.col || '230,205,160') + ',' + (Math.round(Math.max(0, it.d.a) * 8) / 8) + ')';
        if (st !== dStyle) { flushDust(); dStyle = st; } if (!dOpen) { c.beginPath(); dOpen = true; }
        const r2 = Math.min(12, rr); c.moveTo(s.x + r2, s.y); c.arc(s.x, s.y, r2, 0, 6.283); continue;
      }
      if (s.x < -6 * s.s || s.x > W + 6 * s.s) continue;
      const i = it.i, p = it.p, h = race.horses[i];
      // 進行方向をカメラ座標で見て、左右の向きと「細さ」（正面に近いほど細い）を決める
      const hx = p.hx * cam.r.x + p.hz * cam.r.z, hzc = p.hx * cam.f.x + p.hz * cam.f.z;
      const flip = hx < 0, ratio = Math.abs(hx) / (Math.hypot(hx, hzc) || 1), squash = Math.max(0.3, ratio);
      const view = ratio < 0.5 ? (hzc < 0 ? 'front' : 'back') : 'side';
      const turn = view === 'side' ? (hzc < 0 ? -1 : 1) * Math.sqrt(Math.max(0, 1 - ratio * ratio)) : 0; // 向かってくる(−)／遠ざかる(＋)度合い
      const speed = this.run && this.run.speed ? this.run.speed[i] : 1;
      const cycle = running ? (this.t * 2.25 * speed + i * 0.37) : (this.phase === 'idle' && !this.gateShot ? (this.t * 0.35 + i * 0.37) : -1);   // 1 秒に約 2.25 完歩。待機中はゆっくり
      this.groundShadow(c, p, 1.25, 0.42, 1.1, wx);
      c.save(); c.translate(s.x, s.y); if (flip) c.scale(-1, 1);
      Horse.draw(c, 0, 0, s.s, h, cycle, { shadow: false, squash, view, flip, turn });
      c.restore();
      if (s.s > 9 && !this.gateShot) badges.push([s.x, s.y - 2.05 * s.s - 12, Math.max(8, Math.min(13, s.s * 0.5)), h]);
    }
    flushDust();
    // 馬群のそばのラチをもう一度、馬より手前に（カメラと馬の間にあるラチだけ）
    if (this.run && this.phase !== 'idle') { const g = this.group(race.horses.length); this.drawRails(c, wx, dirt, [g.s0 - 6, g.s1 + 6]); }
    badges.forEach((b) => badge(c, b[0], b[1], b[2], b[3]));
    if (race.weather === 'rain') { c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.5; const r0 = (this.t * 900) % 40; c.beginPath(); for (let k = 0; k < 90; k++) { const x = (k * 97 + 13) % W, y = (k * 53 + r0 * (1 + k % 3)) % H; c.moveTo(x, y); c.lineTo(x - 3, y + 14); } c.stroke(); }
    this.drawPost(c);
    this.drawHud(c);
  };
  // 地面に落ちる影（太陽の向きにずらした楕円。len/wid は進行方向／横の半径 m、hgt は物の重心の高さ）
  Race.prototype.groundShadow = function (c, p, len, wid, hgt, wx, cam_) {
    const cam = cam_ || this.cam, ox = p.x + SHX * hgt * 0.8, oz = p.z + SHZ * hgt * 0.8, hx = p.hx || 1, hz = p.hz || 0;
    const o = cam.toCam({ x: ox, y: 0, z: oz }), a = cam.toCam({ x: ox + hx * len + SHX * hgt * 0.3, y: 0, z: oz + hz * len + SHZ * hgt * 0.3 }), b = cam.toCam({ x: ox - hz * wid, y: 0, z: oz + hx * wid });
    if (o.z <= NEAR || a.z <= NEAR || b.z <= NEAR) return;
    const O = cam.proj(o), A = cam.proj(a), B = cam.proj(b);
    c.save(); c.transform(A.x - O.x, A.y - O.y, B.x - O.x, B.y - O.y, O.x, O.y); c.beginPath(); c.arc(0, 0, 1, 0, 6.283); c.restore();
    c.fillStyle = 'rgba(20,32,10,' + (0.08 + wx.shade * 0.75).toFixed(2) + ')'; c.fill();
  };
  Race.prototype.drawSky = function (c, hz, wx, cam_) {
    if (hz <= 0) return;
    const cam = cam_ || this.cam, F = cam.F, top = Math.min(hz - 60, hz - F * 0.5);
    const g = c.createLinearGradient(0, top, 0, hz); g.addColorStop(0, wx.sky[0]); g.addColorStop(0.62, wx.sky[1]); g.addColorStop(1, wx.sky[2]);
    c.fillStyle = g; c.fillRect(0, 0, W, Math.min(H, hz + 2));
    // 太陽（カメラが太陽の方を向いたときだけ、まぶしさ）
    if (wx.shade > 0.2 && dot3(cam.f, SUN) > 0.15) {
      const q = cam.toCam({ x: cam.p.x + SUN.x * 1e4, y: cam.p.y + SUN.y * 1e4, z: cam.p.z + SUN.z * 1e4 });
      if (q.z > 0) { const s = cam.proj(q), rr = Math.max(90, Math.min(420, F * 0.4)); const sg = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr); sg.addColorStop(0, 'rgba(255,253,235,.95)'); sg.addColorStop(0.12, 'rgba(255,248,215,.6)'); sg.addColorStop(1, 'rgba(255,245,210,0)'); c.fillStyle = sg; c.fillRect(s.x - rr, s.y - rr, rr * 2, rr * 2); }
    }
    // 雲（空の決まった方向に浮かぶ。カメラを振ると一緒に流れる）
    c.globalAlpha = 0.9 * wx.cloud;
    for (const cl of CLOUDS) {
      const ce = Math.cos(cl.el), q = cam.toCam({ x: cam.p.x + Math.sin(cl.az) * ce * 1e4, y: cam.p.y + Math.sin(cl.el) * 1e4, z: cam.p.z + Math.cos(cl.az) * ce * 1e4 });
      if (q.z <= 0) continue;
      const s = cam.proj(q), w = cl.w * F; if (w < 30 || s.x + w / 2 < 0 || s.x - w / 2 > W || s.y - w * 0.3 > hz || s.y + w * 0.3 < 0) continue;
      c.drawImage(tex('cloud', cl.v + 1), s.x - w / 2, s.y - w * 0.34, w, w * 0.5);
    }
    c.globalAlpha = 1;
  };
  // 地面のかすみ: 地平線に近い（遠い）ほど空の色を重ねる
  Race.prototype.drawHaze = function (c, hz, wx) {
    const cam = this.cam, h = Math.max(1, cam.p.y), F = cam.F, k = wx.hazeK, hc = wx.haze.join(',');
    const dEnd = 0.08 / k, yEnd = Math.min(H, hz + F * h / dEnd); if (yEnd <= Math.max(0, hz)) return;
    const g = c.createLinearGradient(0, hz, 0, yEnd), span = yEnd - hz;
    [1e9, 3 / k, 1.4 / k, 0.7 / k, 0.35 / k, 0.18 / k, dEnd].forEach((d) => { const y = d > 1e8 ? hz : hz + F * h / d; g.addColorStop(Math.max(0, Math.min(1, (y - hz) / span)), 'rgba(' + hc + ',' + (hazeOf(d, wx) * 0.9).toFixed(3) + ')'); });
    c.fillStyle = g; c.fillRect(0, Math.max(0, hz - 1), W, yEnd - Math.max(0, hz - 1));
  };
  Race.prototype.drawGround = function (c, wx, dirt) {
    const cam = this.cam;
    // 外周の管理道路（向正面とコーナーの外）
    this.fillRing(c, RO + 12, RO + 16, wx.road);
    // 内馬場（市松の刈り込み）と池
    this.fillRing(c, 0, RI - 16.4, wx.infield);
    c.beginPath(); for (let i = -8; i < 8; i++) for (let j = -2; j < 2; j++) if ((i + j) & 1) addPoly(c, cam, [{ x: i * 25, z: j * 20 }, { x: i * 25 + 25, z: j * 20 }, { x: i * 25 + 25, z: j * 20 + 20 }, { x: i * 25, z: j * 20 + 20 }]);
    c.fillStyle = 'rgba(255,255,215,.06)'; c.fill();
    const pond = [[-150, -18], [-122, -29], [-90, -32], [-62, -28], [-52, -19], [-62, -11], [-86, -8], [-112, -7], [-136, -9], [-148, -12]];
    c.beginPath(); const pcx = -100, pcz = -19; addPoly(c, cam, pond.map(([x, z]) => ({ x: (x - pcx) * 1.08 + pcx, z: (z - pcz) * 1.18 + pcz }))); c.fillStyle = 'rgba(205,195,160,.9)'; c.fill();
    c.beginPath(); addPoly(c, cam, pond.map(([x, z]) => ({ x, z }))); c.fillStyle = mixc('#6f93ab', wx.haze, 0.25); c.fill();
    c.beginPath(); addPoly(c, cam, pond.map(([x, z]) => ({ x: (x - pcx) * 0.8 + pcx, z: (z - pcz) * 0.5 + pcz - 2 }))); c.fillStyle = 'rgba(255,255,255,.14)'; c.fill();
    // 内側のコース（芝のレースならダート、ダートのレースなら芝）
    this.fillRing(c, RI - 16, RI - 5, dirt ? wx.turf : wx.dirt);
    if (!dirt && !this.lite) this.fillRing(c, RI - 11, RI - 10.6, 'rgba(255,255,255,.08)');
    // 本コース。芝は刈り込みの縞（10m ごと）と内側の傷み、ダートはハローの筋
    this.fillRing(c, RI, RO, dirt ? wx.dirt : wx.turf);
    if (!dirt) { this.fillSegments(c, 0, 20, RI, RO, wx.turfHi); this.fillSegments(c, 10, 20, RI, RO, wx.turfLo); this.fillRing(c, RI, RI + 2.4, 'rgba(170,160,90,.13)'); }
    else { this.fillSegments(c, 0, 30, RI, RO, 'rgba(255,255,255,.05)'); if (!this.lite) for (const r of [RI + 4, RI + 9]) this.fillRing(c, r, r + 0.35, 'rgba(255,255,255,.07)'); this.fillRing(c, RI, RI + 0.7, 'rgba(0,0,0,.08)'); }
    this.fillSegment(c, FINISH_S - 0.25, FINISH_S + 0.25, RI, RO, 'rgba(255,255,255,.92)');
    // スタンド前: 植え込み（赤い花）と広場（コンクリート）
    c.beginPath(); addPoly(c, cam, [{ x: STX0, z: RO + 6 }, { x: STX1, z: RO + 6 }, { x: STX1, z: ST }, { x: STX0, z: ST }]); c.fillStyle = wx.apron; c.fill();
  };
  Race.prototype.drawCity = function (c, wx) {
    const cam = this.cam, P = cam.p, wp = pat(c, 'windows');
    const list = CITY.map((b) => ({ b, d: Math.hypot(b.x - P.x, b.z - P.z) })).sort((a, b) => b.d - a.d);
    for (const { b, d } of list) {
      const cc = cam.toCam({ x: b.x, y: b.h / 2, z: b.z }); if (cc.z < 40) continue;
      const k = cam.F / cc.z, sx = W / 2 + cc.x * k; if (sx + b.w * k < 0 || sx - b.w * k > W || H / 2 - (b.h - cam.p.y) * k > H) continue;
      const hz = Math.min(0.92, hazeOf(d, wx) * 1.2 + 0.1), tx = -b.nz, tz = b.nx;
      const f0 = { x: b.x - tx * b.w / 2, z: b.z - tz * b.w / 2 }, f1 = { x: b.x + tx * b.w / 2, z: b.z + tz * b.w / 2 };
      const sg = ((P.x - b.x) * tx + (P.z - b.z) * tz) > 0 ? f1 : f0;
      c.beginPath(); addPoly(c, cam, [{ x: sg.x, y: 0, z: sg.z }, { x: sg.x - b.nx * b.d, y: 0, z: sg.z - b.nz * b.d }, { x: sg.x - b.nx * b.d, y: b.h, z: sg.z - b.nz * b.d }, { x: sg.x, y: b.h, z: sg.z }]);
      c.fillStyle = mixc(b.col, [90, 100, 115], 0.25 + (1 - 0.25) * hz * 0.8); c.fill();
      c.beginPath(); addPoly(c, cam, [{ x: f0.x, y: 0, z: f0.z }, { x: f1.x, y: 0, z: f1.z }, { x: f1.x, y: b.h, z: f1.z }, { x: f0.x, y: b.h, z: f0.z }]);
      c.fillStyle = mixc(b.col, wx.haze, hz * 0.85); c.fill();
      if (k * 3 > 1.5) { c.globalAlpha = Math.max(0, 1 - hz * 1.1); texQuad(c, cam, wp, { x: f0.x, y: b.h, z: f0.z }, { x: f1.x, y: b.h, z: f1.z }, { x: f1.x, y: 0, z: f1.z }, { x: f0.x, y: 0, z: f0.z }, 0, 0, b.w * 8, b.h * 8); c.globalAlpha = 1; }
    }
  };
  // 木立（奥の列 → 手前の列）。木ごとに丸い樹冠＋幹の帯を 1 つの形にまとめて塗り、葉の模様と日の当たる面を重ねる
  Race.prototype.drawForest = function (c, wx, cam_, layers) {
    const cam = cam_ || this.cam, fp = pat(c, 'foliage'), LAY = layers || FOREST;
    for (let li = LAY.length - 1; li >= 0; li--) {
      const arr = LAY[li]; let sum = 0, n = 0, ax = 0, ay = 0, ytop = 1e9, ybot = -1e9;
      const vis = [];
      for (let k = 0; k < arr.length; k++) {
        const t = arr[k], q = cam.toCam(t); if (q.z <= 3) continue;
        const s = cam.F / q.z, x = W / 2 + q.x * s, rad = t.rad * s; if (x + rad < 0 || x - rad > W) continue;
        const yb = H / 2 - q.y * s, yt = yb - t.h * s; if (yt > H || yb < -50) continue;
        vis.push([x, yb, yt, rad]); sum += q.z; n++; if (n === 1) { ax = x - k * arr.step * s; ay = yb; } ytop = Math.min(ytop, yt); ybot = Math.max(ybot, yb);
      }
      if (!n) continue;
      const zAvg = sum / n, s = cam.F / zAvg, hz = hazeOf(zAvg + (li ? 25 : 0), wx);
      c.beginPath();
      for (const [x, yb, yt, rad] of vis) { c.moveTo(x + rad, yt + rad); c.arc(x, yt + rad, rad, 0, Math.PI * 2); c.rect(x - rad, yt + rad, rad * 2, yb - yt - rad); }
      c.fillStyle = mixc(li ? wx.treeFar : wx.tree, wx.haze, hz); c.fill();
      if (fp && s > 0.6 && !this.lite) { const sc = s * 12 / 256; if (fp.setTransform) fp.setTransform(new DOMMatrix([sc, 0, 0, sc, ax, ay])); c.globalAlpha = Math.max(0, 1 - hz * 1.3); c.fillStyle = fp; c.fill(); c.globalAlpha = 1; }
      const sh = c.createLinearGradient(0, ytop, 0, ybot); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,15,0,' + (0.32 * (1 - hz)).toFixed(2) + ')'); c.fillStyle = sh; c.fill();
      c.beginPath(); for (const [x, , yt, rad] of vis) { c.moveTo(x - rad * 0.2 + rad * 0.55, yt + rad * 0.75); c.arc(x - rad * 0.2, yt + rad * 0.75, rad * 0.55, 0, Math.PI * 2); }
      c.fillStyle = 'rgba(190,220,120,' + (0.22 * wx.light * (1 - hz)).toFixed(3) + ')'; c.fill();
    }
    if (layers) return;
    // 木立の手前のフェンス
    const hzF = hazeOf(Math.hypot(cam.p.x, cam.p.z + RO), wx);
    c.beginPath(); for (let k = 0; k + 1 < FENCE.length; k++) { const a = FENCE[k], b = FENCE[k + 1]; addPoly(c, cam, [{ x: a.x, y: 0, z: a.z }, { x: b.x, y: 0, z: b.z }, { x: b.x, y: 2.2, z: b.z }, { x: a.x, y: 2.2, z: a.z }]); }
    c.fillStyle = mixc('#3a5a3e', wx.haze, hzF); c.fill();
  };
  // スタンド（ホームストレッチの外）: 前の壁 → 下の段（観客）→ 中のガラス → 上の段（観客）→ 上のガラス → 大屋根
  Race.prototype.drawStand = function (c, wx) {
    const cam = this.cam, P = cam.p;
    // 広場に立って見る観客（2 列）
    const onStand = P.z > ST - 8 && P.x > STX0 - 30 && P.x < STX1 + 30, sp = pat(c, 'standing');
    if (onStand) { const cr = pat(c, 'seated'); for (let x = -140; x < 250; x += 30) texQuad(c, cam, cr, { x, y: 0.05, z: RO + 16 }, { x: x + 30, y: 0.05, z: RO + 16 }, { x: x + 30, y: 0.05, z: RO + 7 }, { x, y: 0.05, z: RO + 7 }, x * 16, 0, (x + 30) * 16, 9 * 16); }
    if (!onStand) for (const [z, x0, x1] of [[RO + 15, -140, 250], [RO + 8, -110, 240]]) for (let x = x0; x < x1; x += 32) texQuad(c, cam, sp, { x, y: 2.5, z }, { x: x + 32, y: 2.5, z }, { x: x + 32, y: 0, z }, { x, y: 0, z }, 0, 0, 512, 40);
    // 植え込み（赤い花）
    c.beginPath(); addPoly(c, cam, [{ x: -LS / 2, y: 0, z: RO + 2.5 }, { x: LS / 2 + 40, y: 0, z: RO + 2.5 }, { x: LS / 2 + 40, y: 0.8, z: RO + 2.5 }, { x: -LS / 2, y: 0.8, z: RO + 2.5 }]); c.fillStyle = '#35602b'; c.fill();
    c.beginPath(); addPoly(c, cam, [{ x: -LS / 2, y: 0.8, z: RO + 2.5 }, { x: LS / 2 + 40, y: 0.8, z: RO + 2.5 }, { x: LS / 2 + 40, y: 0.8, z: RO + 3.7 }, { x: -LS / 2, y: 0.8, z: RO + 3.7 }]); c.fillStyle = '#b8454a'; c.fill();
    if (onStand) return; // カメラがスタンドの上にいる
    const ends = [cam.toCam({ x: STX0, y: 18, z: ST + 12 }), cam.toCam({ x: STX1, y: 18, z: ST + 12 }), cam.toCam({ x: (STX0 + STX1) / 2, y: 18, z: ST + 12 })];
    if (ends.every((q) => q.z <= NEAR)) return;
    const hz = hazeOf(Math.hypot(P.x - 30, P.z - ST - 12), wx), ga = pat(c, 'glass'), cr = pat(c, 'seated'), step = 24;
    const flat = (pts, col) => { c.beginPath(); if (addPoly(c, cam, pts)) { c.fillStyle = col; c.fill(); } };
    const strip = (pt, y0, z0, y1, z1, vlen) => { for (let x = STX0; x < STX1; x += step) texQuad(c, cam, pt, { x, y: y1, z: z1 }, { x: x + step, y: y1, z: z1 }, { x: x + step, y: y0, z: z0 }, { x, y: y0, z: z0 }, x * 16, 0, (x + step) * 16, vlen); };
    // 奥の壁（屋根の下の暗がり）
    flat([{ x: STX0, y: 33, z: ST + 25 }, { x: STX1, y: 33, z: ST + 25 }, { x: STX1, y: 35, z: ST + 25 }, { x: STX0, y: 35, z: ST + 25 }], '#4d545c');
    strip(ga, 24, ST + 24, 33, ST + 24, 9 * 16);
    strip(cr, 14.5, ST + 12, 24, ST + 24, 15.3 * 16);
    flat([{ x: STX0, y: 14.3, z: ST + 11.9 }, { x: STX1, y: 14.3, z: ST + 11.9 }, { x: STX1, y: 14.9, z: ST + 11.9 }, { x: STX0, y: 14.9, z: ST + 11.9 }], '#eef0f0');
    strip(ga, 10.5, ST + 12, 14.3, ST + 12, 3.8 * 16);
    strip(cr, 1.3, ST, 10.5, ST + 12, 15.1 * 16);
    flat([{ x: STX0, y: 0, z: ST }, { x: STX1, y: 0, z: ST }, { x: STX1, y: 1.3, z: ST }, { x: STX0, y: 1.3, z: ST }], '#d8d2c4');
    flat([{ x: STX0, y: 1.3, z: ST }, { x: STX1, y: 1.3, z: ST }, { x: STX1, y: 1.6, z: ST }, { x: STX0, y: 1.6, z: ST }], '#f4f4f2');
    // 端の壁（横から見えるときだけ）
    if (P.x < STX0) flat([{ x: STX0, y: 0, z: ST }, { x: STX0, y: 0, z: ST + 28 }, { x: STX0, y: 35, z: ST + 28 }, { x: STX0, y: 35, z: ST + 24 }, { x: STX0, y: 24, z: ST + 24 }, { x: STX0, y: 1.3, z: ST }], '#cfc9bb');
    if (P.x > STX1) flat([{ x: STX1, y: 0, z: ST }, { x: STX1, y: 0, z: ST + 28 }, { x: STX1, y: 35, z: ST + 28 }, { x: STX1, y: 35, z: ST + 24 }, { x: STX1, y: 24, z: ST + 24 }, { x: STX1, y: 1.3, z: ST }], '#bdb7a9');
    // 屋根を支える柱
    c.beginPath(); for (let x = STX0 + 20; x < STX1; x += 40) addPoly(c, cam, [{ x: x - 0.4, y: 14.9, z: ST + 12.2 }, { x: x + 0.4, y: 14.9, z: ST + 12.2 }, { x: x + 0.4, y: 35, z: ST + 12.2 }, { x: x - 0.4, y: 35, z: ST + 12.2 }]); c.fillStyle = '#e4e4e2'; c.fill();
    // 大屋根: 裏側（下から見える）と前の縁（白）
    const under = c.createLinearGradient(0, cam.proj(cam.toCam({ x: 30, y: 35, z: ST - 4 })).y, 0, cam.proj(cam.toCam({ x: 30, y: 34, z: ST + 26 })).y);
    under.addColorStop(0, '#8b9198'); under.addColorStop(1, '#3f454c');
    if (P.y < 35) flat([{ x: STX0 - 4, y: 35, z: ST - 4 }, { x: STX1 + 4, y: 35, z: ST - 4 }, { x: STX1 + 4, y: 34, z: ST + 26 }, { x: STX0 - 4, y: 34, z: ST + 26 }], under);
    flat([{ x: STX0 - 4, y: 35, z: ST - 4 }, { x: STX1 + 4, y: 35, z: ST - 4 }, { x: STX1 + 4, y: 37.6, z: ST - 4 }, { x: STX0 - 4, y: 37.6, z: ST - 4 }], '#f3f3f1');
    flat([{ x: STX0 - 4, y: 35, z: ST - 4.05 }, { x: STX1 + 4, y: 35, z: ST - 4.05 }, { x: STX1 + 4, y: 35.4, z: ST - 4.05 }, { x: STX0 - 4, y: 35.4, z: ST - 4.05 }], '#b9bec4');
    // 名前の看板（屋根の縁の中央）
    const bx = FINISH_S - LS / 2 - 50, bq = [{ x: bx - 26, y: 35.4, z: ST - 4.1 }, { x: bx + 26, y: 35.4, z: ST - 4.1 }, { x: bx + 26, y: 37.4, z: ST - 4.1 }, { x: bx - 26, y: 37.4, z: ST - 4.1 }].map((p) => cam.toCam(p));
    if (bq.every((q) => q.z > NEAR)) { const s0 = cam.proj(bq[3]), s1 = cam.proj(bq[1]); const w = s1.x - s0.x, hh = s1.y - s0.y; if (w > 50) { c.fillStyle = '#183153'; c.fillRect(s0.x, s0.y, w, hh); c.fillStyle = '#ffd54f'; c.font = 'bold ' + Math.round(Math.min(hh * 0.8, w * 0.075)) + 'px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('casa RACECOURSE', s0.x + w / 2, s0.y + hh / 2); } }
    // 遠いときは空気でかすませる
    if (hz > 0.04) flat([{ x: STX0, y: 0, z: ST }, { x: STX1, y: 0, z: ST }, { x: STX1 + 4, y: 37.6, z: ST - 4 }, { x: STX0 - 4, y: 37.6, z: ST - 4 }], 'rgba(' + wx.haze.join(',') + ',' + (hz * 0.9).toFixed(2) + ')');
  };
  // ラチ（白い柵）。range を渡すと、そのコース上の範囲で「カメラと馬の間にあるラチ」だけを描く
  const POST_CACHE = {};
  function postPts(r) { return POST_CACHE[r] || (POST_CACHE[r] = (() => { const a = []; for (let s = 0; s < L; s += 3) { const p = pointAt(s, r); a.push({ x: p.x, z: p.z, s }); } return a; })()); }
  const inSpan = (s, range) => { let d = s - range[0]; d = ((d % L) + L) % L; return d <= range[1] - range[0]; };
  Race.prototype.drawRails = function (c, wx, dirt, range) {
    const cam = this.cam, P = cam.p, f = cam.f, F = cam.F, rails = [[RI, '#ffffff'], [RO, '#ffffff'], [RI - 5, dirt ? '#ffffff' : '#efe3a4'], [RI - 16, dirt ? '#ffffff' : '#efe3a4']];
    let rcam = 0;
    if (range) { const mid = (range[0] + range[1]) / 2, o = pointAt(mid, 0), e = pointAt(mid, 1); rcam = (P.x - o.x) * (e.x - o.x) + (P.z - o.z) * (e.z - o.z); }
    for (const [r, col] of rails) {
      if (range && !((r <= RI && rcam < r - 0.3) || (r >= RO && rcam > r + 0.3))) continue;
      const pts = ringPts(r), N = pts.length, use = new Uint8Array(N);
      for (let k = 0; k < N; k++) { if (!range) { use[k] = 1; continue; } const a = pts[k].s, b = k + 1 < N ? pts[k + 1].s : L, d0 = (((a - range[0]) % L) + L) % L; use[k] = (d0 <= range[1] - range[0] || d0 + (b - a) >= L) ? 1 : 0; }
      const main = r === RI || r === RO;
      if (!range && main && !this.lite && wx.shade > 0.06) {
        const S0 = camArr(cam, pts, 0, SHX * 1.15, SHZ * 1.15), S1 = camArr(cam, pts, 0, SHX * 0.95, SHZ * 0.95);
        c.beginPath(); for (let k = 0; k < N; k++) { const k2 = (k + 1) % N; quadArr(c, cam, S0, k, S0, k2, S1, k2, S1, k); }
        c.fillStyle = 'rgba(20,35,10,' + (wx.shade * 0.7).toFixed(2) + ')'; c.fill();
      }
      const A = camArr(cam, pts, 1.16, 0, 0), C = camArr(cam, pts, 0.93, 0, 0), B = main && !this.lite ? camArr(cam, pts, 0.99, 0, 0) : null;
      c.beginPath(); for (let k = 0; k < N; k++) if (use[k]) { const k2 = (k + 1) % N; quadArr(c, cam, A, k, A, k2, C, k2, C, k); } c.fillStyle = col; c.fill();
      if (main && !this.lite) { c.beginPath(); for (let k = 0; k < N; k++) if (use[k]) { const k2 = (k + 1) % N; quadArr(c, cam, B, k, B, k2, C, k2, C, k); } c.fillStyle = 'rgba(80,90,100,.3)'; c.fill(); }
      // 支柱（近いものだけ）
      c.beginPath();
      const pp = postPts(r), Y0 = -P.y, Y1 = 1 - P.y, r_ = cam.r, u = cam.u;
      for (let k = 0; k < pp.length; k++) {
        const p = pp[k]; if (range && !inSpan(p.s, range)) continue;
        const X = p.x - P.x, Z = p.z - P.z, z0 = X * f.x + Y0 * f.y + Z * f.z; if (z0 <= NEAR || z0 > (this.lite ? 70 : 160)) continue;
        const x0 = X * r_.x + Y0 * r_.y + Z * r_.z, sx = W / 2 + x0 * F / z0; if (sx < -10 || sx > W + 10) continue;
        const z1 = X * f.x + Y1 * f.y + Z * f.z; if (z1 <= NEAR) continue;
        const sy0 = H / 2 - (X * u.x + Y0 * u.y + Z * u.z) * F / z0, sy1 = H / 2 - (X * u.x + Y1 * u.y + Z * u.z) * F / z1, w = Math.max(1, 0.09 * F / z0);
        c.rect(sx - w / 2, sy1, w, sy0 - sy1);
      }
      c.fillStyle = col; c.fill();
    }
  };
  Race.prototype.drawPole = function (c, it, wx) {
    const cam = this.cam, p = it.p, s0 = cam.proj(it.cc), s1 = cam.proj(cam.toCam({ x: p.x, y: 3.3, z: p.z })), w = Math.max(1.5, 0.15 * s0.s);
    if (s0.x < -60 || s0.x > W + 60) return;
    if (wx.shade > 0.06) { const e = cam.toCam({ x: p.x + SHX * 3.3, y: 0, z: p.z + SHZ * 3.3 }); if (e.z > NEAR) { const se = cam.proj(e); c.strokeStyle = 'rgba(20,35,10,' + (wx.shade * 0.8).toFixed(2) + ')'; c.lineWidth = w * 0.9; c.beginPath(); c.moveTo(s0.x, s0.y); c.lineTo(se.x, se.y); c.stroke(); } }
    for (let k = 0; k < 6; k++) { c.fillStyle = k % 2 ? '#e53935' : '#ffffff'; const y0 = s0.y + (s1.y - s0.y) * k / 6, y1 = s0.y + (s1.y - s0.y) * (k + 1) / 6; c.fillRect(s0.x - w / 2, y1, w, y0 - y1 + 0.5); }
    const rr = Math.max(2.5, 0.45 * s0.s); c.fillStyle = '#ffffff'; c.beginPath(); c.arc(s0.x, s1.y - rr, rr, 0, 6.28); c.fill(); c.strokeStyle = '#e53935'; c.lineWidth = Math.max(1, rr * 0.16); c.stroke();
    if (rr > 5) { c.fillStyle = '#c62828'; c.font = 'bold ' + Math.round(rr * 1.25) + 'px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(it.m / 100), s0.x, s1.y - rr + rr * 0.05); }
  };
  Race.prototype.drawGoalPost = function (c, it, wx) {
    const cam = this.cam, p = it.p, q0 = it.cc, q1 = cam.toCam({ x: p.x, y: 5, z: p.z }); if (q1.z <= NEAR) return;
    const s0 = cam.proj(q0), s1 = cam.proj(q1), w = Math.max(1.5, 0.14 * s0.s); if (s0.x < -80 || s0.x > W + 80) return;
    if (wx.shade > 0.06) { const e = cam.toCam({ x: p.x + SHX * 5, y: 0, z: p.z + SHZ * 5 }); if (e.z > NEAR) { const se = cam.proj(e); c.strokeStyle = 'rgba(20,35,10,' + (wx.shade * 0.8).toFixed(2) + ')'; c.lineWidth = w; c.beginPath(); c.moveTo(s0.x, s0.y); c.lineTo(se.x, se.y); c.stroke(); } }
    c.fillStyle = '#f5f5f5'; c.fillRect(s0.x - w / 2, s1.y, w, s0.y - s1.y);
    c.fillStyle = '#e53935'; c.fillRect(s0.x - w / 2, s1.y + (s0.y - s1.y) * 0.55, w, (s0.y - s1.y) * 0.12);
    const rr = Math.max(2, 0.5 * s0.s); c.fillStyle = '#e53935'; c.beginPath(); c.arc(s0.x, s1.y - rr * 0.9, rr, 0, 6.28); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = Math.max(1, rr * 0.14); c.stroke();
    if (rr > 7 && it.k === 1) { c.fillStyle = '#fff'; c.font = 'bold ' + Math.round(rr * 0.6) + 'px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('GOAL', s0.x, s1.y - rr * 0.9); }
  };
  // 内馬場の木（幹＋丸い葉のかたまり。大きいのは 3 コーナーの大ケヤキ）
  Race.prototype.drawTree = function (c, tr, cc, wx) {
    const cam = this.cam, s = cam.proj(cc), k = s.s, R = tr.rad * k; if (s.x + R * 2 < 0 || s.x - R * 2 > W || s.y - tr.h * k > H) return;
    const hz = hazeOf(cc.z, wx);
    this.groundShadow(c, { x: tr.x + SHX * tr.h * 0.25, z: tr.z + SHZ * tr.h * 0.25, hx: SHX / Math.hypot(SHX, SHZ), hz: SHZ / Math.hypot(SHX, SHZ) }, tr.h * 0.35, tr.rad * 0.9, 0, wx);
    const tw = (tr.big ? 0.9 : 0.35) * k; c.fillStyle = mixc('#4e3b2a', wx.haze, hz); c.beginPath(); c.moveTo(s.x - tw, s.y); c.lineTo(s.x - tw * 0.55, s.y - tr.h * 0.55 * k); c.lineTo(s.x + tw * 0.55, s.y - tr.h * 0.55 * k); c.lineTo(s.x + tw, s.y); c.fill();
    const blobs = tr.big ? [[0, 0.72, 1], [-0.75, 0.6, 0.72], [0.8, 0.62, 0.75], [-0.35, 0.86, 0.7], [0.4, 0.88, 0.68], [-1.15, 0.5, 0.5], [1.2, 0.52, 0.5]] : [[0, 0.68, 1], [-0.55, 0.55, 0.72], [0.55, 0.57, 0.75], [0, 0.85, 0.7]];
    c.beginPath(); for (const [dx, dy, r] of blobs) { const x = s.x + dx * R, y = s.y - tr.h * dy * k; c.moveTo(x + r * R, y); c.arc(x, y, r * R, 0, 6.283); }
    c.fillStyle = mixc(wx.tree, wx.haze, hz); c.fill();
    const fp = pat(c, 'foliage'); if (fp && k > 0.8) { const sc = k * 12 / 256; if (fp.setTransform) fp.setTransform(new DOMMatrix([sc, 0, 0, sc, s.x, s.y])); c.globalAlpha = 1 - hz; c.fillStyle = fp; c.fill(); c.globalAlpha = 1; }
    c.beginPath(); for (const [dx, dy, r] of blobs) { const x = s.x + (dx - 0.22 * r) * R, y = s.y - tr.h * dy * k - 0.25 * r * R; c.moveTo(x + r * R * 0.55, y); c.arc(x, y, r * R * 0.55, 0, 6.283); }
    c.fillStyle = 'rgba(185,215,120,' + (0.25 * wx.light * (1 - hz)).toFixed(3) + ')'; c.fill();
  };
  // ターフビジョン（内馬場の大画面。表は今のレースの順位と時計を映す）
  Race.prototype.drawVision = function (c, wx) {
    const cam = this.cam, race = this.race, x0 = VIS.x - VIS.w / 2, x1 = VIS.x + VIS.w / 2, z = VIS.z, y0 = VIS.y0, y1 = VIS.y0 + VIS.h;
    const hz = hazeOf(Math.hypot(cam.p.x - VIS.x, cam.p.z - z), wx);
    const flat = (pts, col) => { c.beginPath(); if (addPoly(c, cam, pts)) { c.fillStyle = col; c.fill(); } };
    flat([{ x: x0 + 5, y: 0, z: z - 1 }, { x: x0 + 7, y: 0, z: z - 1 }, { x: x0 + 7, y: y0, z: z - 1 }, { x: x0 + 5, y: y0, z: z - 1 }], mixc('#6b7178', wx.haze, hz));
    flat([{ x: x1 - 7, y: 0, z: z - 1 }, { x: x1 - 5, y: 0, z: z - 1 }, { x: x1 - 5, y: y0, z: z - 1 }, { x: x1 - 7, y: y0, z: z - 1 }], mixc('#6b7178', wx.haze, hz));
    flat([{ x: x0 - 0.8, y: y1 + 0.8, z: z - 1.6 }, { x: x1 + 0.8, y: y1 + 0.8, z: z - 1.6 }, { x: x1 + 0.8, y: y1 + 0.8, z: z }, { x: x0 - 0.8, y: y1 + 0.8, z: z }], mixc('#9aa1a8', wx.haze, hz));
    flat([{ x: x0 - 0.8, y: y0 - 0.8, z }, { x: x1 + 0.8, y: y0 - 0.8, z }, { x: x1 + 0.8, y: y1 + 0.8, z }, { x: x0 - 0.8, y: y1 + 0.8, z }], mixc('#2c3138', wx.haze, hz));
    if (cam.p.z < z) return; // 裏側
    const A = cam.toCam({ x: x0, y: y1, z }), B = cam.toCam({ x: x1, y: y1, z }), D = cam.toCam({ x: x0, y: y0, z });
    if (A.z <= NEAR || B.z <= NEAR || D.z <= NEAR) return;
    const a = cam.proj(A), b = cam.proj(B), d = cam.proj(D), lw = 360, lh = 120;
    if (Math.abs(b.x - a.x) < 12) return;
    c.save(); c.transform((b.x - a.x) / lw, (b.y - a.y) / lw, (d.x - a.x) / lh, (d.y - a.y) / lh, a.x, a.y);
    const bg = c.createLinearGradient(0, 0, 0, lh); bg.addColorStop(0, '#0d2a52'); bg.addColorStop(1, '#06142a'); c.fillStyle = bg; c.fillRect(0, 0, lw, lh);
    c.fillStyle = '#1f6f3a'; c.fillRect(0, 0, lw, 24); c.fillStyle = '#fff'; c.font = 'bold 17px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('casa DERBY  ' + (race.surface === 'dirt' ? 'ダート' : '芝') + race.dist + 'm', 10, 12);
    if (this.run) {
      const order = race.horses.map((_, i) => i).sort((p, q) => this.run.pos[q] - this.run.pos[p]);
      order.forEach((i, k) => { const h = race.horses[i], x = 14 + k * 44; c.fillStyle = h.color; c.fillRect(x, 40, 36, 44); c.fillStyle = h.ink; c.font = 'bold 30px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.fillText(h.no, x + 18, 63); c.fillStyle = '#ffd54f'; c.font = 'bold 13px sans-serif'; c.fillText(String(k + 1), x + 18, 98); });
      const tt = Math.min(this.run.t, 599); c.fillStyle = '#fff'; c.font = 'bold 30px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'right'; c.fillText(Math.floor(tt / 60) + ':' + ('0' + Math.floor(tt % 60)).slice(-2), lw - 12, 64);
    } else { c.fillStyle = '#ffd54f'; c.font = 'bold 34px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.fillText('まもなく発走', lw / 2, 70); }
    const gl = c.createLinearGradient(0, 0, lw, lh); gl.addColorStop(0, 'rgba(255,255,255,.10)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)'); c.fillStyle = gl; c.fillRect(0, 0, lw, lh);
    if (hz > 0.03) { c.fillStyle = 'rgba(' + wx.haze.join(',') + ',' + (hz * 0.8).toFixed(2) + ')'; c.fillRect(0, 0, lw, lh); }
    c.restore();
  };
  Race.prototype.drawPost = function (c) {
    if (!this.grain) { const g = document.createElement('canvas'); g.width = g.height = 128; const gc = g.getContext('2d'), id = gc.createImageData(128, 128); for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 10; } gc.putImageData(id, 0, 0); this.grain = c.createPattern(g, 'repeat'); }
    if (!this.lite) { c.fillStyle = this.grain; c.fillRect(0, 0, W, H); }
    // 周辺減光（望遠レンズ）
    if (!this.vig) { this.vig = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62); this.vig.addColorStop(0, 'rgba(0,0,0,0)'); this.vig.addColorStop(1, 'rgba(0,0,0,.2)'); }
    c.fillStyle = this.vig; c.fillRect(0, 0, W, H);
    if (this.cut > 0) { c.fillStyle = 'rgba(255,255,255,' + (this.cut * 1.6).toFixed(2) + ')'; c.fillRect(0, 0, W, H); }
  };
  // 速い投影: 世界の点の並び → カメラ座標（Float64Array に x,y,z の順）。地面の帯やラチなど数の多いものに使う
  function camArr(cam, pts, y, dx, dz) {
    const n = pts.length, o = new Float64Array(n * 3), px = cam.p.x, pz = cam.p.z, r = cam.r, u = cam.u, f = cam.f, Y = y - cam.p.y;
    for (let k = 0; k < n; k++) { const X = pts[k].x + dx - px, Z = pts[k].z + dz - pz, j = k * 3; o[j] = X * r.x + Y * r.y + Z * r.z; o[j + 1] = X * u.x + Y * u.y + Z * u.z; o[j + 2] = X * f.x + Y * f.y + Z * f.z; }
    return o;
  }
  // 配列 A の i 番 → B の j 番 → C の k 番 → D の l 番の四角形を path に足す（手前で切れるときだけ遅い道）
  function quadArr(c, cam, A, i, B, j, C, k, D, l) {
    i *= 3; j *= 3; k *= 3; l *= 3;
    const az = A[i + 2], bz = B[j + 2], cz = C[k + 2], dz = D[l + 2];
    if (az > NEAR && bz > NEAR && cz > NEAR && dz > NEAR) {
      const F = cam.F, x0 = W / 2 + A[i] * F / az, x1 = W / 2 + B[j] * F / bz, x2 = W / 2 + C[k] * F / cz, x3 = W / 2 + D[l] * F / dz;
      if ((x0 < 0 && x1 < 0 && x2 < 0 && x3 < 0) || (x0 > W && x1 > W && x2 > W && x3 > W)) return;
      c.moveTo(x0, H / 2 - A[i + 1] * F / az); c.lineTo(x1, H / 2 - B[j + 1] * F / bz); c.lineTo(x2, H / 2 - C[k + 1] * F / cz); c.lineTo(x3, H / 2 - D[l + 1] * F / dz); c.closePath(); return;
    }
    if (az <= NEAR && bz <= NEAR && cz <= NEAR && dz <= NEAR) return;
    const v = (X, m) => ({ x: X[m], y: X[m + 1], z: X[m + 2] });
    const q = clipNear([v(A, i), v(B, j), v(C, k), v(D, l)]); if (q.length < 3) return;
    q.forEach((p, n) => { const s = cam.proj(p); n ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.closePath();
  }
  // 閉じた輪の点の並びを path に足す（手前で切れるときは clipNear）
  function ringPath(c, cam, pts, y) {
    const o = camArr(cam, pts, y || 0, 0, 0), n = pts.length, F = cam.F; let all = true;
    for (let k = 0; k < n; k++) if (o[k * 3 + 2] <= NEAR) { all = false; break; }
    if (all) { for (let k = 0; k < n; k++) { const j = k * 3, x = W / 2 + o[j] * F / o[j + 2], yy = H / 2 - o[j + 1] * F / o[j + 2]; k ? c.lineTo(x, yy) : c.moveTo(x, yy); } c.closePath(); return true; }
    const q = []; for (let k = 0; k < n; k++) q.push({ x: o[k * 3], y: o[k * 3 + 1], z: o[k * 3 + 2] });
    const cl = clipNear(q); if (cl.length < 3) return false;
    cl.forEach((p, k) => { const s = cam.proj(p); k ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.closePath(); return true;
  }
  Race.prototype.fillRing = function (c, r0, r1, color) {
    const cam = this.cam; c.beginPath();
    if (!ringPath(c, cam, ringPts(r1))) return;
    if (r0 > 0) ringPath(c, cam, ringPts(r0));
    c.fillStyle = color; c.fill('evenodd');
  };
  Race.prototype.fillQuad = function (c, ps, color) { c.beginPath(); if (addPoly(c, this.cam, ps)) { c.fillStyle = color; c.fill(); } };
  Race.prototype.fillSegment = function (c, s0, s1, r0, r1, color) { c.beginPath(); if (addPoly(c, this.cam, [pointAt(s0, r0), pointAt(s1, r0), pointAt(s1, r1), pointAt(s0, r1)])) { c.fillStyle = color; c.fill(); } };
  // 縞（period m ごとに、offset から半分の長さ）をまとめて 1 回で塗る
  const STRIPE_CACHE = {};
  Race.prototype.fillSegments = function (c, offset, period, r0, r1, color) {
    const cam = this.cam, key = offset + '/' + period + '/' + r0 + '/' + r1;
    const S = STRIPE_CACHE[key] || (STRIPE_CACHE[key] = (() => { const a = [], b = [], d = [], e = []; for (let m = offset; m < L; m += period) { a.push(pointAt(m, r0)); b.push(pointAt(m + period / 2, r0)); d.push(pointAt(m + period / 2, r1)); e.push(pointAt(m, r1)); } return [a, b, d, e]; })());
    const A = camArr(cam, S[0], 0, 0, 0), B = camArr(cam, S[1], 0, 0, 0), D = camArr(cam, S[2], 0, 0, 0), E = camArr(cam, S[3], 0, 0, 0);
    c.beginPath(); for (let k = 0; k < S[0].length; k++) quadArr(c, cam, A, k, B, k, D, k, E, k);
    c.fillStyle = color; c.fill();
  };
  // 残線（直線の残り 400・200・100m に引く CG の線と距離。馬の下に入る）
  Race.prototype.drawRemainLines = function (c) {
    const run = this.run, race = this.race; if (!run || this.phase === 'winner') return;
    const remain = (1 - Math.min(1, run.pos[this.leaderIdx()])) * race.dist, cam = this.cam;
    for (const m of [400, 200, 100]) {
      if (remain < m - 8 || remain > m + 260) continue;
      this.fillSegment(c, FINISH_S - m - 0.18, FINISH_S - m + 0.18, RI, RO, 'rgba(255,255,255,.75)');
      const q = cam.toCam(pointAt(FINISH_S - m, RO - 1.5)); if (q.z <= NEAR) continue;
      const s = cam.proj(q), fs = Math.max(11, Math.min(26, s.s * 1.6)); if (s.x < 0 || s.x > W) continue;
      tvText(c, m + 'm', s.x, s.y - fs * 0.7, fs, '#ffffff', 'center');
    }
  };
  function tvText(c, txt, x, y, size, col, align, weight) {
    c.font = (weight || 'bold') + ' ' + Math.round(size) + 'px "Noto Sans JP","Hiragino Sans",sans-serif'; c.textAlign = align || 'left'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = Math.max(2, size * 0.2); c.strokeStyle = 'rgba(0,0,0,.55)'; c.strokeText(txt, x, y); c.fillStyle = col || '#fff'; c.fillText(txt, x, y);
  }
  const fmtClock = (t, tenth) => { if (tenth) t = Math.round(t * 10) / 10; const m = Math.floor(t / 60), s = t - m * 60; return tenth ? (m ? m + '.' + (s < 10 ? '0' : '') : '') + s.toFixed(1) : (m ? m + '.' + (s < 10 ? '0' : '') : '') + Math.floor(s); };
  Race.prototype.drawGate = function (c) {
    const cam = this.cam, s0 = this.startS - 1.6, s1 = this.startS + 0.9, open = this.run && this.run.t > 0.05;
    const poly = (pts, color, stroke) => { const q = clipNear(pts.map((v) => cam.toCam(v))); if (q.length < 3) return; c.beginPath(); q.forEach((v, k) => { const sc = cam.proj(v); k ? c.lineTo(sc.x, sc.y) : c.moveTo(sc.x, sc.y); }); c.closePath(); c.fillStyle = color; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); } };
    const n = this.race.horses.length, rIn = laneR(0) - 1.0, rOut = laneR(n - 1) + 1.0;
    // 地面の影
    const sh = (s, r) => { const p = pointAt(s, r); return { x: p.x + SHX * 2.9, y: 0, z: p.z + SHZ * 2.9 }; };
    poly([sh(s0, rIn), sh(s0, rOut), sh(s1, rOut), sh(s1, rIn)], 'rgba(20,35,10,.22)');
    // 上の梁（青い枠）と脚
    const top = (s, y) => { const p = pointAt(s, rIn), q = pointAt(s, rOut); return [{ x: p.x, y, z: p.z }, { x: q.x, y, z: q.z }]; };
    const [a0, b0] = top(s0, 2.9), [a1, b1] = top(s1, 2.9);
    poly([a0, b0, b1, a1], '#2f5fa8', '#1b3a6b');
    // 仕切り板（各馬の間）
    for (let k = 0; k <= n; k++) { const rr = k === 0 ? rIn : k === n ? rOut : (laneR(k - 1) + laneR(k)) / 2, p = pointAt(s0, rr), q = pointAt(s1, rr); poly([{ x: p.x, y: 0.3, z: p.z }, { x: q.x, y: 0.3, z: q.z }, { x: q.x, y: 2.9, z: q.z }, { x: p.x, y: 2.9, z: p.z }], k === 0 || k === n ? 'rgba(60,90,140,.95)' : 'rgba(180,190,205,.55)', '#5d6570'); }
    // 前扉（発走前だけ）
    if (!open) for (let k = 0; k < n; k++) { const p = pointAt(s1, laneR(k) - 0.85), q = pointAt(s1, laneR(k) + 0.85); poly([{ x: p.x, y: 0.4, z: p.z }, { x: q.x, y: 0.4, z: q.z }, { x: q.x, y: 1.9, z: q.z }, { x: p.x, y: 1.9, z: p.z }], 'rgba(230,235,240,.85)', '#8a96a6'); }
    // 番号板
    for (let k = 0; k < n; k++) { const p = pointAt(s1, laneR(k)), cc = cam.toCam({ x: p.x, y: 2.6, z: p.z }); if (cc.z <= NEAR) continue; const sc = cam.proj(cc); if (sc.s > 6) badge(c, sc.x, sc.y, Math.max(6, Math.min(12, sc.s * 0.3)), this.race.horses[k]); }
  };
  /* ---------- テロップ（中継の画面の作り: 右上に時計、左下にロゴとレース名、下中央に通過順、右下にコース図） ---------- */
  Race.prototype.drawHud = function (c) {
    const race = this.race, run = this.run;
    if (this.phase === 'idle' && this.info && !this.gateShot) {
      const i = this.paddockIdx(), h = race.horses[i], inf = this.info(i) || {};
      const MARU = '"Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif';
      c.fillStyle = 'rgba(0,0,0,.6)'; roundRect(c, 20, H - 144, 520, 124, 8); c.fill();
      c.fillStyle = h.color; roundRect(c, 20, H - 144, 80, 124, 8); c.fill();
      c.fillStyle = h.ink; c.font = '900 54px "Noto Sans JP","Hiragino Sans",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(h.no), 60, H - 82);
      c.fillStyle = '#fff'; c.textAlign = 'left'; c.font = 'bold 34px ' + MARU; c.fillText(h.name, 116, H - 114);
      c.font = '22px ' + MARU; c.fillStyle = '#ffd54f'; c.fillText(inf.line1 || '', 116, H - 74);
      c.fillStyle = '#ddd'; c.fillText(inf.line2 || '', 116, H - 42);
      c.fillStyle = 'rgba(0,0,0,.55)'; roundRect(c, W - 236, 12, 222, 40, 6); c.fill(); c.fillStyle = '#fff'; c.font = 'bold 20px ' + MARU; c.textAlign = 'center'; c.fillText((this.inPaddock() ? 'パドック  ' : 'まもなく発走  ') + (i + 1) + ' / ' + race.horses.length, W - 125, 32);
      return;
    }
    // 下の帯（文字が読みやすいよう、うっすら暗く）
    if (!this.band) { this.band = c.createLinearGradient(0, H - 92, 0, H); this.band.addColorStop(0, 'rgba(0,0,0,0)'); this.band.addColorStop(1, 'rgba(0,0,0,.42)'); }
    c.fillStyle = this.band; c.fillRect(0, H - 92, W, 92);
    // 左上: ラベル（SLOW / REPLAY / PHOTO FINISH）
    if (this.label) { c.font = '900 20px "Noto Sans JP","Hiragino Sans",sans-serif'; const w = c.measureText(this.label).width + 30; c.fillStyle = this.label === 'REPLAY' || this.label === 'PHOTO FINISH' ? 'rgba(220,40,40,.85)' : 'rgba(0,0,0,.6)'; roundRect(c, 14, 12, w, 34, 8); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(this.label, 14 + w / 2, 29); }
    // 左下: ロゴ・レース名・競馬場
    const bugH = 40, bug = stationLogo(bugH * (this.k || 1));
    if (bug) { const bugW = bugH * bug.width / bug.height, a0 = c.globalAlpha; c.globalAlpha = a0 * 0.9; c.drawImage(bug, 12, H - 34 - bugH, bugW, bugH); c.globalAlpha = a0; }
    else { c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.arc(28, H - 40, 9, 0.6, 5.7); c.stroke(); c.fillStyle = '#ffd54f'; c.beginPath(); c.arc(28, H - 40, 3.2, 0, 6.283); c.fill();
      tvText(c, 'casa DERBY', 44, H - 40, 17, '#fff', 'left'); }
    tvText(c, 'casa競馬場  ' + (race.surface === 'dirt' ? 'ダート' : '芝') + race.dist + 'm  ' + { sunny: '晴', cloudy: '曇', rain: '雨' }[race.weather], 18, H - 17, 14, '#eeeeee', 'left');
    if (!run || this.phase === 'winner') return;
    // 右上: 経過時計（走っている間は秒まで、1 着が入ったらタイムを 0.1 秒まで）
    const fin = run.finish.filter((x) => x > 0), done = fin.length > 0;
    tvText(c, fmtClock(done ? Math.min.apply(null, fin) : run.t, done), W - 22, 30, 30, '#fff', 'right');
    // 1000m 通過（通過から 10 秒だけ、黄色で）
    if (race.dist > 1000 && this.split1000 && run.t - (this.split1000At || 0) < 10) { tvText(c, this.split1000, W - 22, 64, 24, '#ffe14a', 'right'); tvText(c, '1000m', W - 22, 87, 14, '#ffe14a', 'right'); }
    const L_ = this.leaderIdx(), remain = Math.max(0, Math.round((1 - Math.min(1, run.pos[L_])) * race.dist / 10) * 10);
    const order = race.horses.map((_, i) => i).sort((p, q) => run.pos[q] - run.pos[p]);
    // 下中央: 通過順（枠色の丸に馬番。間隔は馬と馬の差）
    const ex = [0]; for (let k = 1; k < order.length; k++) ex.push(ex[k - 1] + Math.min(40, Math.max(0, (run.pos[order[k - 1]] - run.pos[order[k]]) * race.dist) * 4));
    const esc = Math.min(1, (420 - 25 * (order.length - 1)) / (ex[ex.length - 1] || 1)), x0 = 240;
    // 本物の中継と同じく、画面の中で馬が走っている向きに先頭を置く（右へ走る画なら先頭が右端・矢印も右向き）。
    // 進む向きをカメラの右方向に投影して決める。真正面・真後ろのカメラではちらつかないよう、はっきり傾いたときだけ切り替える
    const lh = this.horsePos(L_), along = lh.hx * this.cam.r.x + lh.hz * this.cam.r.z;
    if (this.ordDir == null || this.cam.mode !== this.ordMode) { this.ordDir = along >= 0 ? 1 : -1; this.ordMode = this.cam.mode; }
    else if (Math.abs(along) > 0.3) this.ordDir = along > 0 ? 1 : -1;
    const span = 25 * (order.length - 1) + (ex[ex.length - 1] || 0) * esc, toR = this.ordDir > 0;
    const chipX = (k) => (toR ? x0 + span - (k * 25 + ex[k] * esc) : x0 + k * 25 + ex[k] * esc);
    c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath();
    if (toR) { const ax = chipX(0) + 21; c.moveTo(ax, H - 31); c.lineTo(ax - 7, H - 37); c.lineTo(ax - 7, H - 25); }
    else { c.moveTo(x0 - 21, H - 31); c.lineTo(x0 - 14, H - 37); c.lineTo(x0 - 14, H - 25); }
    c.fill();
    for (let k = order.length - 1; k >= 0; k--) badge(c, chipX(k), H - 31, 11.5, race.horses[order[k]]);
    // 右下: コース図（楕円と先頭の位置）、距離、時速
    const mx = W - 92, my = H - 40, sx = 0.17;
    c.lineCap = 'round'; c.lineJoin = 'round';
    const oval = () => { c.beginPath(); for (let k = 0; k <= 60; k++) { const p = pointAt(k * L / 60, RC); k ? c.lineTo(mx + p.x * sx, my + p.z * sx) : c.moveTo(mx + p.x * sx, my + p.z * sx); } c.closePath(); };
    oval(); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 7; c.stroke(); c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 3.5; c.stroke();
    const gpt = pointAt(FINISH_S, RC); c.fillStyle = '#ff5252'; c.fillRect(mx + gpt.x * sx - 1.5, my + gpt.z * sx - 7, 3, 14);
    const lp = this.horsePos(L_); c.fillStyle = '#ffd54f'; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(mx + lp.x * sx, my + lp.z * sx, 4.5, 0, 6.28); c.fill(); c.stroke();
    const spd = run.speed && run.speed[L_] ? (run.speed[L_] * race.dist / run.length * 3.6) : 0;
    tvText(c, (race.surface === 'dirt' ? 'DIRT ' : 'TURF ') + race.dist.toLocaleString() + 'm', W - 186, H - 13, 14, '#fff', 'left');
    tvText(c, spd.toFixed(1) + 'km/h', W - 16, H - 13, 14, '#fff', 'right');
    // 残り距離（直線の 400m から。上の中央）
    if (remain <= 400 && remain > 0) tvText(c, '残り ' + remain + 'm', W / 2, 30, 24, '#fff', 'center');
  };

  /* 旧い呼び出し（出馬表・表彰・牧場）向け: scale 1 ≒ 体高 60px */
  function drawChibi(c, x, y, s, h, ph, o) { Horse.draw(c, x, y, s * 38, h, ph < 0 ? -1 : ph / 6.283, { shadow: !o || o.shadow !== false }); }
  function badge(c, x, y, r, h) {
    c.fillStyle = h.color; c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
    c.fillStyle = h.ink; c.font = '900 ' + Math.round(r * 1.3) + 'px "Noto Sans JP","Hiragino Sans",sans-serif'; /* 2026-10-21 Noto Sans JP に統一（数字は 900） */ c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(h.no, x, y + 0.5);
  }
  function roundRect(c, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // drawHorse(c, x, y, pxPerM, i) を渡すと、その絵で馬を描く（3D のときは走る 3D の馬と同じ見た目の絵）。false を返したら 2D の馬
  // 展開予想の図。opt.scale で馬・文字を大きく（テレビ向けの馬券画面は 1.35 倍。並べる間隔は列に収まるよう詰める）
  function drawTenkai(canvas, race, tenkai, drawHorse, opt) {
    const c = canvas.getContext('2d'), Wt = canvas.width, Ht = canvas.height, S = (opt && opt.scale) || 1, top = 20 * S;
    c.clearRect(0, 0, Wt, Ht);
    c.fillStyle = '#8ad45a'; roundRect(c, 0, 0, Wt, Ht, 12); c.fill();
    c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(0, top, Wt, 2); c.fillRect(0, Ht - 10, Wt, 2);
    const labels = ['序盤', '中盤', '終盤'], colW = Wt / 3, ppm = 14 * S, step = Math.min(22 * S, (colW - 44 * S) / 5);
    const foot0 = S === 1 ? 86 : top + 30 * S, footStep = S === 1 ? 12 : (Ht - 12 - foot0) / 5;
    labels.forEach((lb, k) => {
      if (k) { c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(k * colW, 0, 1, Ht); }
      c.fillStyle = '#245c12'; c.font = 'bold ' + Math.round(13 * S) + 'px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(lb, k * colW + 8, 4);
      const ranks = tenkai[k].map((r, i) => [r, i]).sort((a, b) => a[0] - b[0]);
      ranks.forEach((p, idx) => { const i = p[1], x = k * colW + colW - 34 * S - idx * step, y = foot0 + i * footStep; if (!(drawHorse && drawHorse(c, x, y, ppm, i))) Horse.draw(c, x, y, ppm, race.horses[i], 0.3 + idx * 0.15, { shadow: false }); });
    });
  }

  Race.drawChibi = drawChibi; Race.drawTenkai = drawTenkai; Race.badge = badge; Race.roundRect = roundRect; Race.COATS = COATS;
  return Race;
})();

