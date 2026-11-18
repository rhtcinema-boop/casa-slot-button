/* 競走馬と騎手の絵（図形で描く）。立体感の方針（アートディレクター講評より）:
   光源は左上前方45度。部位ごとに明・中・暗＋ハイライト。腹の下に幅20cm以上の濃い影。外周の輪郭は太く、内側の線は細く薄く。
   奥側の脚は20%暗くして胴に半分隠す。首は太く長くS字、頭は額が広く鼻先へ三角。脚は付け根が太く蹄へ細く。
   騎手はモンキー乗り（首の上15cmまで45度の前傾、膝を密着、あぶみは真下、手綱は口元へ）。
   Horse.draw(c, x, y, pxPerM, h, cycle, { view:'side'|'front'|'back', squash, shadow }) */
window.Horse = (function () {
  'use strict';
  const COATS = {
    bay: { body: '#7a4a24', hi: '#b07c4c', lo: '#36200e', points: '#1f1511', mane: '#1f1511', muzzle: '#2c1d14' },
    chestnut: { body: '#a8562a', hi: '#dc9158', lo: '#52250c', points: '#8a4420', mane: '#7a3a18', muzzle: '#5a2c12' },
    black: { body: '#2b2528', hi: '#625963', lo: '#0b0909', points: '#120e0d', mane: '#0f0c0b', muzzle: '#1a1413' },
    gray: { body: '#c4c3c1', hi: '#f2f1ed', lo: '#6a6867', points: '#5a5553', mane: '#44403e', muzzle: '#6a6360' },
    white: { body: '#e6e0d5', hi: '#fefcf8', lo: '#978d7e', points: '#9c9385', mane: '#cfc6b8', muzzle: '#b49f8f' },
    palomino: { body: '#c99a4a', hi: '#f0cc82', lo: '#6e4b1c', points: '#a07a30', mane: '#f1e4c2', muzzle: '#7a5a28' },
  };
  const TAU = Math.PI * 2, OUT = 'rgba(25,12,5,.55)', OUT_W = 0.03, INNER = 'rgba(0,0,0,.18)';
  const mix = (hex, k) => { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k); return 'rgb(' + r + ',' + g + ',' + b + ')'; };

  // 脚: 付け根 (px,py)、上段 L1（太い）、下段 L2（細い）。a1,a2 は鉛直からの角度（前が正）
  function leg(c, px, py, L1, L2, a1, a2, w, color, hoof) {
    const kx = px + Math.sin(a1) * L1, ky = py - Math.cos(a1) * L1;
    const fx = kx + Math.sin(a2) * L2, fy = ky - Math.cos(a2) * L2;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = OUT; c.lineWidth = w + OUT_W * 2; c.beginPath(); c.moveTo(px, py); c.lineTo(kx, ky); c.stroke();
    c.lineWidth = w * 0.6 + OUT_W * 2; c.beginPath(); c.moveTo(kx, ky); c.lineTo(fx, fy); c.stroke();
    c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(px, py); c.lineTo(kx, ky); c.stroke();
    c.lineWidth = w * 0.6; c.beginPath(); c.moveTo(kx, ky); c.lineTo(fx, fy); c.stroke();
    c.fillStyle = hoof; c.beginPath(); c.ellipse(fx, fy - w * 0.08, w * 0.5, w * 0.36, a2 * 0.5, 0, TAU); c.fill();
  }
  // 回転襲歩: 伸ばす脚は伸ばし切り、たたむ脚は胴につくほど曲げる
  function legA(ph, run, off, amp, fore) {
    if (!run) return [0.04, -0.06];
    const t = ph + off, a1 = amp * Math.sin(t);
    const fold = Math.max(0, Math.sin(t + 1.0));                    // 前へ振り出す途中で大きく折る
    const a2 = fore ? a1 + fold * 1.6 : a1 - fold * 1.5;
    return [a1, a2];
  }
  function strokePath(c, color, w) { c.strokeStyle = color; c.lineWidth = w; c.stroke(); }
  // 勝負服の柄（クリップ済みの領域に描く）。cx,cy は服の中心、s は大きさ
  function drawSilkPattern(c, silk, cx, cy, s) {
    c.fillStyle = silk.accent;
    switch (silk.pattern) {
      case 'sash': c.save(); c.translate(cx, cy); c.rotate(-0.7); c.fillRect(-s, -s * 0.12, s * 2, s * 0.24); c.restore(); break;
      case 'stripes': for (let k = -3; k <= 3; k++) c.fillRect(cx + k * s * 0.28 - s * 0.06, cy - s, s * 0.12, s * 2); break;
      case 'hoops': for (let k = -3; k <= 3; k++) c.fillRect(cx - s, cy + k * s * 0.28 - s * 0.06, s * 2, s * 0.12); break;
      case 'star': c.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? s * 0.12 : s * 0.3, a = -Math.PI / 2 + k * Math.PI / 5; c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } c.closePath(); c.fill(); break;
      case 'diamond': c.beginPath(); c.moveTo(cx, cy + s * 0.32); c.lineTo(cx + s * 0.22, cy); c.lineTo(cx, cy - s * 0.32); c.lineTo(cx - s * 0.22, cy); c.closePath(); c.fill(); break;
      case 'halves': c.fillRect(cx, cy - s, s, s * 2); break;
    }
  }

  /* ---------- 横向き ---------- */
  function drawSide(c, h, co, ph, run, squash) {
    const bob = run ? 0.05 * Math.sin(ph + 0.6) : 0, pitch = run ? 0.06 * Math.sin(ph - 0.3) : 0;
    c.translate(0, bob);
    const far = mix(co.body, 0.72), hoof = '#1a1410', hipX = -0.6, hipY = 0.98, shX = 0.52, shY = 0.98, L1 = 0.46, L2 = 0.5, W1 = 0.2;
    // 奥の脚
    let a = legA(ph, run, 0.0, 0.6, false); leg(c, hipX - 0.04, hipY, L1, L2, a[0], a[1], W1 * 0.9, far, hoof);
    a = legA(ph, run, 2.2, 0.6, true); leg(c, shX - 0.04, shY, L1, L2, a[0], a[1], W1 * 0.85, far, hoof);
    // 尻尾（骨盤の奥から）
    const tw = run ? Math.sin(ph) * 0.2 : 0;
    c.strokeStyle = co.points; c.lineWidth = 0.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-0.9, 1.26); c.quadraticCurveTo(-1.38, 1.18 + tw, -1.6, 0.66 + tw * 1.5); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 0.06; c.beginPath(); c.moveTo(-0.98, 1.3); c.quadraticCurveTo(-1.32, 1.12 + tw, -1.48, 0.74 + tw); c.stroke();
    // 胴体
    c.save(); c.translate(0, 1.05); c.rotate(pitch); c.translate(0, -1.05);
    const body = () => { c.beginPath(); c.moveTo(-0.88, 1.38); c.bezierCurveTo(-1.12, 1.24, -1.08, 0.76, -0.72, 0.68); c.bezierCurveTo(-0.3, 0.57, 0.3, 0.57, 0.72, 0.72); c.bezierCurveTo(1.0, 0.84, 1.0, 1.32, 0.62, 1.42); c.bezierCurveTo(0.2, 1.5, -0.4, 1.47, -0.88, 1.38); c.closePath(); };
    // 曲面に沿った明暗: 背に沿う帯状のハイライト → 側面 → 腹の暗部
    const g = c.createRadialGradient(-0.1, 1.55, 0.05, -0.1, 1.05, 0.95); g.addColorStop(0, co.hi); g.addColorStop(0.35, co.body); g.addColorStop(0.72, mix(co.body, 0.78)); g.addColorStop(1, co.lo);
    body(); c.fillStyle = g; c.fill();
    c.save(); body(); c.clip();
    // 臀部・肩の丸い筋肉
    const m = (x, y, rx, ry, rot) => { const mg = c.createRadialGradient(x - rx * 0.3, y + ry * 0.4, 0, x, y, Math.max(rx, ry)); mg.addColorStop(0, co.hi); mg.addColorStop(0.5, co.body); mg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = mg; c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.fill(); };
    m(-0.62, 1.1, 0.36, 0.32, -0.25); m(0.5, 1.08, 0.32, 0.3, 0.2);
    // 腹の下の濃い影（幅 0.2m）、内股の影
    const bg = c.createLinearGradient(0, 0.95, 0, 0.57); bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, 'rgba(0,0,0,.45)'); c.fillStyle = bg; c.fillRect(-1.2, 0.5, 2.4, 0.5);
    c.fillStyle = 'rgba(0,0,0,.22)'; c.beginPath(); c.ellipse(-0.66, 0.8, 0.22, 0.14, 0.4, 0, TAU); c.fill(); c.beginPath(); c.ellipse(0.52, 0.8, 0.18, 0.12, -0.3, 0, TAU); c.fill();
    // 背のハイライト、肩と腰の筋のライン
    c.fillStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.ellipse(-0.15, 1.4, 0.58, 0.05, 0, 0, TAU); c.fill();
    c.strokeStyle = INNER; c.lineWidth = 0.012; c.beginPath(); c.moveTo(0.3, 1.35); c.quadraticCurveTo(0.45, 1.1, 0.35, 0.85); c.stroke(); c.beginPath(); c.moveTo(-0.3, 1.38); c.quadraticCurveTo(-0.5, 1.15, -0.4, 0.9); c.stroke();
    c.restore();
    body(); strokePath(c, OUT, OUT_W);
    // 首（太く長いS字）と頭（額が広く鼻先へ三角）
    const nod = run ? 0.1 * Math.sin(ph + 2.4) : 0;
    c.save(); c.translate(0.55, 1.3); c.rotate(-nod);
    const neck = () => { c.beginPath(); c.moveTo(-0.15, 0.12); c.bezierCurveTo(0.15, 0.4, 0.5, 0.58, 0.8, 0.55); c.lineTo(0.95, 0.3); c.bezierCurveTo(0.7, 0.12, 0.42, -0.2, 0.15, -0.4); c.closePath(); };
    const ng = c.createLinearGradient(0.1, 0.55, 0.55, -0.25); ng.addColorStop(0, co.hi); ng.addColorStop(0.4, co.body); ng.addColorStop(0.8, mix(co.body, 0.75)); ng.addColorStop(1, co.lo);
    neck(); c.fillStyle = ng; c.fill(); strokePath(c, OUT, OUT_W);
    c.strokeStyle = INNER; c.lineWidth = 0.012; c.beginPath(); c.moveTo(0.05, 0.1); c.quadraticCurveTo(0.4, 0.2, 0.75, 0.3); c.stroke(); // 首筋
    const head = () => { c.beginPath(); c.moveTo(0.62, 0.62); c.bezierCurveTo(0.9, 0.7, 1.1, 0.45, 1.28, 0.12); c.lineTo(1.36, -0.1); c.bezierCurveTo(1.26, -0.22, 1.08, -0.18, 1.0, -0.06); c.bezierCurveTo(0.92, 0.12, 0.8, 0.22, 0.68, 0.26); c.closePath(); };
    const hg = c.createLinearGradient(0.85, 0.6, 1.15, -0.1); hg.addColorStop(0, co.hi); hg.addColorStop(0.5, co.body); hg.addColorStop(1, co.lo);
    head(); c.fillStyle = hg; c.fill(); strokePath(c, OUT, OUT_W);
    c.strokeStyle = INNER; c.lineWidth = 0.012; c.beginPath(); c.moveTo(0.92, 0.42); c.quadraticCurveTo(1.0, 0.3, 0.98, 0.1); c.stroke(); // 頬骨
    c.fillStyle = co.muzzle; c.beginPath(); c.ellipse(1.27, -0.06, 0.1, 0.07, -0.5, 0, TAU); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.ellipse(0.9, 0.36, 0.042, 0.034, 0, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath(); c.arc(0.915, 0.375, 0.012, 0, TAU); c.fill();
    c.fillStyle = co.points; c.beginPath(); c.moveTo(0.64, 0.58); c.lineTo(0.68, 0.8); c.lineTo(0.77, 0.6); c.closePath(); c.fill(); c.beginPath(); c.moveTo(0.74, 0.6); c.lineTo(0.8, 0.8); c.lineTo(0.86, 0.6); c.closePath(); c.fill();
    c.strokeStyle = co.mane; c.lineWidth = 0.11; c.lineCap = 'round';
    for (let k = 0; k < 7; k++) { const t = k / 6; c.beginPath(); c.moveTo(-0.1 + t * 0.76, 0.16 + t * 0.4); c.lineTo(-0.3 + t * 0.76 - (run ? 0.07 * Math.sin(ph + k) : 0), 0.02 + t * 0.38 - 0.08); c.stroke(); }
    c.strokeStyle = '#2a2a2a'; c.lineWidth = 0.025; c.beginPath(); c.moveTo(1.02, 0.02); c.lineTo(0.8, 0.42); c.stroke(); c.beginPath(); c.moveTo(0.78, 0.44); c.lineTo(1.2, 0.3); c.stroke();
    c.restore();
    // 騎手（モンキー乗り）
    const jb = run ? 0.03 * Math.sin(ph + 1.5) : 0;
    c.save(); c.translate(0.1, 1.44 + jb);
    // ゼッケン・鞍
    c.fillStyle = '#f4f4f4'; c.beginPath(); c.moveTo(-0.34, -0.04); c.lineTo(0.3, -0.02); c.lineTo(0.28, -0.44); c.lineTo(-0.34, -0.44); c.closePath(); c.fill(); strokePath(c, OUT, 0.015);
    c.fillStyle = h.color; c.beginPath(); c.moveTo(-0.31, -0.1); c.lineTo(0.26, -0.08); c.lineTo(0.25, -0.4); c.lineTo(-0.31, -0.4); c.closePath(); c.fill();
    c.save(); c.scale(1 / squash, -1); c.fillStyle = h.ink; c.font = 'bold 0.25px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(h.no, -0.03, 0.24); c.restore();
    c.fillStyle = '#2e2420'; c.beginPath(); c.ellipse(0.0, 0.02, 0.26, 0.08, 0, 0, TAU); c.fill();
    // 脚: 太腿は馬の肩と平行、下腿はほぼ真下、あぶみ
    c.strokeStyle = '#f2f2f2'; c.lineWidth = 0.1; c.lineCap = 'round'; c.beginPath(); c.moveTo(0.02, 0.22); c.lineTo(0.3, 0.1); c.lineTo(0.28, -0.2); c.stroke();
    c.strokeStyle = '#1a1a1a'; c.lineWidth = 0.1; c.beginPath(); c.moveTo(0.29, -0.18); c.lineTo(0.27, -0.32); c.stroke();
    c.strokeStyle = '#8a8a8a'; c.lineWidth = 0.02; c.beginPath(); c.moveTo(0.27, -0.34); c.lineTo(0.2, -0.34); c.stroke();
    // 体幹: 首の上 15cm、45度の前傾。背中は丸く
    const torso = () => { c.beginPath(); c.moveTo(-0.1, 0.2); c.bezierCurveTo(0.05, 0.42, 0.3, 0.56, 0.6, 0.5); c.lineTo(0.56, 0.3); c.bezierCurveTo(0.35, 0.28, 0.2, 0.14, 0.05, 0.12); c.closePath(); };
    const silk = h.silk || { base: h.color, accent: h.ink, pattern: 'solid' };
    torso(); c.fillStyle = silk.base; c.fill();
    c.save(); torso(); c.clip(); drawSilkPattern(c, silk, 0.25, 0.35, 0.5); c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.moveTo(0.0, 0.1); c.bezierCurveTo(0.1, 0.3, 0.3, 0.36, 0.56, 0.32); c.lineTo(0.56, 0.3); c.bezierCurveTo(0.35, 0.28, 0.2, 0.12, 0.05, 0.1); c.closePath(); c.fill(); c.fillStyle = 'rgba(255,255,255,.22)'; c.beginPath(); c.moveTo(-0.05, 0.25); c.bezierCurveTo(0.08, 0.45, 0.3, 0.56, 0.55, 0.52); c.lineTo(0.55, 0.47); c.bezierCurveTo(0.3, 0.5, 0.1, 0.4, -0.02, 0.22); c.closePath(); c.fill(); c.restore();
    torso(); strokePath(c, OUT, 0.02);
    // 腕: 上腕は水平、前腕は首に沿って下げ、手綱は口元へ
    c.strokeStyle = (h.silk || { base: h.color }).base; c.lineWidth = 0.09; c.beginPath(); c.moveTo(0.42, 0.4); c.lineTo(0.62, 0.38); c.lineTo(0.8, 0.26); c.stroke();
    c.fillStyle = '#e8c7a8'; c.beginPath(); c.arc(0.82, 0.25, 0.04, 0, TAU); c.fill();
    // 頭・帽子・ゴーグル
    c.fillStyle = '#e8c7a8'; c.beginPath(); c.arc(0.66, 0.58, 0.11, 0, TAU); c.fill();
    const cg = c.createLinearGradient(0.55, 0.7, 0.75, 0.55); cg.addColorStop(0, '#fff'); cg.addColorStop(0.2, h.color); cg.addColorStop(1, mix(h.color === '#f4f4f4' ? '#dddddd' : h.color, 0.7));
    c.fillStyle = cg; c.beginPath(); c.arc(0.66, 0.6, 0.125, Math.PI * 0.9, Math.PI * 2.1); c.fill(); c.fillRect(0.54, 0.56, 0.3, 0.04);
    c.fillStyle = '#222'; c.fillRect(0.64, 0.53, 0.15, 0.05);
    c.restore();
    c.restore();
    // 手前の脚（付け根が太く、胴で付け根を隠す）
    a = legA(ph, run, 0.75, 0.64, false); leg(c, hipX + 0.08, hipY, L1, L2, a[0], a[1], W1, co.body, hoof);
    a = legA(ph, run, 2.95, 0.64, true); leg(c, shX + 0.08, shY, L1, L2, a[0], a[1], W1 * 0.95, co.body, hoof);
    // 手前の脚の付け根を胴の影で馴染ませる
    c.fillStyle = 'rgba(0,0,0,.15)'; c.beginPath(); c.ellipse(hipX + 0.08, 0.92, 0.14, 0.07, 0, 0, TAU); c.fill(); c.beginPath(); c.ellipse(shX + 0.08, 0.92, 0.12, 0.06, 0, 0, TAU); c.fill();
  }

  /* ---------- 正面／後ろ向き ---------- */
  function drawFront(c, h, co, ph, run, toward) {
    const bob = run ? 0.05 * Math.sin(ph + 0.6) : 0;
    c.translate(0, bob);
    const hoof = '#1a1410', far = mix(co.body, 0.72);
    const sw = (off) => (run ? Math.sin(ph + off) : 0);
    // 脚: 左右に開き、振り出すと持ち上がって膝が見える
    const legF = (x, w, col, s) => {
      const lift = Math.max(0, s) * 0.3, kx = x * 1.02, ky = 0.5 + lift * 0.6, fx = x * 1.12, fy = 0.04 + lift;
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = OUT; c.lineWidth = w + OUT_W * 2; c.beginPath(); c.moveTo(x, 0.95); c.lineTo(kx, ky); c.stroke(); c.lineWidth = w * 0.62 + OUT_W * 2; c.beginPath(); c.moveTo(kx, ky); c.lineTo(fx, fy); c.stroke();
      c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(x, 0.95); c.lineTo(kx, ky); c.stroke(); c.lineWidth = w * 0.62; c.beginPath(); c.moveTo(kx, ky); c.lineTo(fx, fy); c.stroke();
      c.fillStyle = hoof; c.beginPath(); c.ellipse(fx, fy, w * 0.55, w * 0.32, 0, 0, TAU); c.fill();
    };
    if (toward) { legF(-0.2, 0.17, far, sw(0)); legF(0.2, 0.17, far, sw(0.75)); } else { legF(-0.19, 0.17, far, sw(2.2)); legF(0.19, 0.17, far, sw(2.95)); }
    // 胴: 胸（正面）／臀部（後ろ）。幅を広く、左右に張る
    const bw = 0.52;
    const bg = c.createRadialGradient(-0.16, 1.2, 0.04, 0, 1.0, 0.72); bg.addColorStop(0, co.hi); bg.addColorStop(0.45, co.body); bg.addColorStop(0.85, mix(co.body, 0.72)); bg.addColorStop(1, co.lo);
    c.fillStyle = bg; c.beginPath(); c.moveTo(-bw, 1.1); c.bezierCurveTo(-bw - 0.04, 0.8, -0.3, 0.6, 0, 0.6); c.bezierCurveTo(0.3, 0.6, bw + 0.04, 0.8, bw, 1.1); c.bezierCurveTo(bw, 1.3, 0.3, 1.38, 0, 1.38); c.bezierCurveTo(-0.3, 1.38, -bw, 1.3, -bw, 1.1); c.closePath(); c.fill(); strokePath(c, OUT, OUT_W);
    // 中央の割れ目（胸筋／臀部）と左右の丸み
    c.strokeStyle = INNER; c.lineWidth = 0.015; c.beginPath(); c.moveTo(0, 0.66); c.lineTo(0, toward ? 1.0 : 1.3); c.stroke();
    const mm = (x) => { const g2 = c.createRadialGradient(x - 0.08, 1.02, 0, x, 0.95, 0.3); g2.addColorStop(0, 'rgba(255,255,255,.18)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g2; c.beginPath(); c.ellipse(x, 0.95, 0.26, 0.28, 0, 0, TAU); c.fill(); };
    mm(-0.25); mm(0.25);
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(0, 0.66, 0.36, 0.08, 0, 0, TAU); c.fill();
    if (!toward) { c.strokeStyle = co.points; c.lineWidth = 0.18; c.lineCap = 'round'; c.beginPath(); c.moveTo(0, 1.22); c.quadraticCurveTo(0.05 + (run ? 0.12 * Math.sin(ph) : 0), 0.85, 0.02, 0.4); c.stroke(); }
    if (toward) { legF(-0.26, 0.19, co.body, sw(2.2)); legF(0.26, 0.19, co.body, sw(2.95)); } else { legF(-0.27, 0.19, co.body, sw(0)); legF(0.27, 0.19, co.body, sw(0.75)); }
    // 首（幅 0.38m、上へ伸びて少し手前へ）
    const nod = run ? 0.06 * Math.sin(ph + 2.4) : 0, nw = 0.19;
    const ng = c.createLinearGradient(-nw, 0, nw, 0); ng.addColorStop(0, co.lo); ng.addColorStop(0.35, co.body); ng.addColorStop(0.7, co.hi); ng.addColorStop(1, mix(co.body, 0.8));
    c.fillStyle = ng; c.beginPath(); c.moveTo(-nw - 0.05, 1.15); c.bezierCurveTo(-nw - 0.06, 1.5, -nw + 0.03, 1.78, -nw + 0.05, 1.9 + nod); c.lineTo(nw - 0.05, 1.9 + nod); c.bezierCurveTo(nw - 0.03, 1.78, nw + 0.06, 1.5, nw + 0.05, 1.15); c.closePath(); c.fill(); strokePath(c, OUT, OUT_W);
    if (toward) {
      // 顔: 額は広く、鼻先へ三角。目は左右、耳は上
      const hg = c.createLinearGradient(-0.16, 0, 0.16, 0); hg.addColorStop(0, mix(co.body, 0.8)); hg.addColorStop(0.5, co.hi); hg.addColorStop(1, co.lo);
      c.fillStyle = hg; c.beginPath(); c.moveTo(-0.17, 1.95 + nod); c.bezierCurveTo(-0.2, 1.62, -0.11, 1.3, 0, 1.26 + nod); c.bezierCurveTo(0.11, 1.3, 0.2, 1.62, 0.17, 1.95 + nod); c.closePath(); c.fill(); strokePath(c, OUT, OUT_W);
      c.fillStyle = co.muzzle; c.beginPath(); c.ellipse(0, 1.33 + nod, 0.1, 0.065, 0, 0, TAU); c.fill();
      c.fillStyle = '#2a1a12'; c.beginPath(); c.ellipse(-0.045, 1.31 + nod, 0.022, 0.03, 0, 0, TAU); c.fill(); c.beginPath(); c.ellipse(0.045, 1.31 + nod, 0.022, 0.03, 0, 0, TAU); c.fill();
      c.fillStyle = '#111'; c.beginPath(); c.ellipse(-0.13, 1.74 + nod, 0.032, 0.04, 0.3, 0, TAU); c.fill(); c.beginPath(); c.ellipse(0.13, 1.74 + nod, 0.032, 0.04, -0.3, 0, TAU); c.fill();
      c.fillStyle = co.points; c.beginPath(); c.moveTo(-0.17, 1.9 + nod); c.lineTo(-0.23, 2.14 + nod); c.lineTo(-0.06, 1.97 + nod); c.closePath(); c.fill(); c.beginPath(); c.moveTo(0.17, 1.9 + nod); c.lineTo(0.23, 2.14 + nod); c.lineTo(0.06, 1.97 + nod); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.ellipse(0, 1.62 + nod, 0.03, 0.16, 0, 0, TAU); c.fill();
      c.strokeStyle = '#2a2a2a'; c.lineWidth = 0.02; c.beginPath(); c.moveTo(-0.14, 1.5 + nod); c.lineTo(0.14, 1.5 + nod); c.stroke();
    } else {
      c.fillStyle = co.mane; c.beginPath(); c.ellipse(0, 1.88 + nod, 0.2, 0.14, 0, 0, TAU); c.fill(); strokePath(c, OUT, 0.02);
      c.fillStyle = co.points; c.beginPath(); c.moveTo(-0.17, 1.92 + nod); c.lineTo(-0.22, 2.14 + nod); c.lineTo(-0.06, 1.98 + nod); c.closePath(); c.fill(); c.beginPath(); c.moveTo(0.17, 1.92 + nod); c.lineTo(0.22, 2.14 + nod); c.lineTo(0.06, 1.98 + nod); c.closePath(); c.fill();
    }
    // 騎手
    const jb = run ? 0.03 * Math.sin(ph + 1.5) : 0;
    c.save(); c.translate(0, 1.42 + jb);
    c.fillStyle = '#f4f4f4'; c.fillRect(-0.36, -0.14, 0.72, 0.14); c.fillStyle = h.color; c.fillRect(-0.34, -0.12, 0.68, 0.1);
    const silkF = h.silk || { base: h.color, accent: h.ink, pattern: 'solid' };
    c.fillStyle = silkF.base; c.beginPath(); c.ellipse(0, 0.3, 0.3, 0.24, 0, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.ellipse(0, 0.3, 0.3, 0.24, 0, 0, TAU); c.clip(); drawSilkPattern(c, silkF, 0, 0.3, 0.6); const jg = c.createRadialGradient(-0.12, 0.42, 0.02, 0, 0.3, 0.34); jg.addColorStop(0, 'rgba(255,255,255,.35)'); jg.addColorStop(0.5, 'rgba(0,0,0,0)'); jg.addColorStop(1, 'rgba(0,0,0,.45)'); c.fillStyle = jg; c.fillRect(-0.4, 0, 0.8, 0.6); c.restore();
    c.beginPath(); c.ellipse(0, 0.3, 0.3, 0.24, 0, 0, TAU); strokePath(c, OUT, 0.02);
    c.strokeStyle = '#f2f2f2'; c.lineWidth = 0.09; c.lineCap = 'round'; c.beginPath(); c.moveTo(-0.3, 0.2); c.lineTo(-0.36, -0.1); c.stroke(); c.beginPath(); c.moveTo(0.3, 0.2); c.lineTo(0.36, -0.1); c.stroke();
    c.fillStyle = '#e8c7a8'; c.beginPath(); c.arc(0, 0.6, 0.11, 0, TAU); c.fill();
    c.fillStyle = h.color; c.beginPath(); c.arc(0, 0.63, 0.125, Math.PI, TAU); c.fill(); c.fillRect(-0.15, 0.6, 0.3, 0.04);
    if (toward) { c.fillStyle = '#222'; c.fillRect(-0.1, 0.54, 0.2, 0.05); }
    c.restore();
  }

  /* ---------- 写真風スプライトの動かし方 ----------
     本物の襲歩（ギャロップ）: 1 秒に約 2.3 完歩。四肢が胴の下に集まって宙に浮く瞬間に胴が一番高く、
     前脚で着地して体重を受ける瞬間に一番低い（上下 6〜8cm）。胴は前後にも少し揺れる（前脚着地で頭が下がる）。
     中継の映像では脚は速すぎてブレて見える。常歩（パドック）は四拍子でゆっくり、胴はほとんど揺れない。 */
  const hash = (n) => { const s = Math.sin((Number(n) || 1) * 127.1) * 43758.5453; return s - Math.floor(s); };
  function drawSprite(c, x, y, pxPerM, h, cycle, o, v, sp) {
    const run = cycle >= 0, walk = !!o.walk, side = v === 'side';
    // 馬ごとの個体差（体格 ±3%、揺れの大きさ）
    const r1 = hash(h.no), r2 = hash((Number(h.no) || 1) + 17), size = 1 + (r1 - 0.5) * 0.06;
    // 斜めのときは潰しすぎず、遠近の傾きで向きを出す
    const sq = side ? Math.max(0.68, o.squash == null ? 1 : o.squash) : 1;
    const skew = side && o.turn ? Math.max(-0.22, Math.min(0.22, -o.turn * 0.28)) : 0;
    const ph = run ? ((cycle % 1) + 1) % 1 : 0, mo = { skew };
    let frame = 0;
    if (run && !walk) {
      frame = ph * sp.n;
      const u = (ph - sp.susp) * TAU, amp = 0.025 + r2 * 0.012;           // u=0 が宙に浮く瞬間
      mo.settle = 0.8;                                                     // 蹄が浮いて見えるコマを地面へ（胴の上下動にもなる）
      mo.bob = (0.5 + 0.5 * Math.cos(u)) * amp * pxPerM;
      mo.rock = side ? Math.sin(u - 1.1) * 0.022 : 0;                       // 前脚の着地で前が沈む
      mo.nod = side ? -Math.sin(u) * (0.06 + r1 * 0.02) : 0;                // 首: 前脚の着地で下がり、宙に浮く前に上がる
      if (!side) { const a = Math.sin(u + 0.6), b = Math.sin(u + 0.6 - 0.9); mo.lift = [Math.max(0, a), Math.max(0, b)]; }
      mo.blur = side ? 0.8 : 0;
    } else if (run && walk) {
      // 常歩: 1 完歩（cycle 1.0）に左右の前脚・後脚が 1 回ずつ。後脚→同じ側の前脚の順に、四拍子で振る
      const u = ph * TAU;
      frame = sp.walkFrame != null ? sp.walkFrame : 0;
      mo.bob = Math.abs(Math.sin(u)) * 0.018 * pxPerM;
      mo.rock = side ? Math.sin(u * 2) * 0.008 : 0;
      // 元のコマは襲歩で脚を前後に大きく開いているので、まず脚を胴の下へ寄せ（前脚は後ろへ、後脚は前へ傾け）、そこから小さく振る
      if (side) mo.legs = [-0.32 + Math.sin(u) * 0.14, 0.3 + Math.sin(u - Math.PI / 2) * 0.14];
      else mo.lift = [Math.max(0, Math.sin(u)) * 0.45, Math.max(0, -Math.sin(u)) * 0.45];
    }
    if (o.shadow !== false) { c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(x + 0.15 * pxPerM, y, (side ? 1.25 * sq : 0.6) * pxPerM, 0.22 * pxPerM, 0, 0, TAU); c.fill(); }
    // 足元の接地の影（蹄の下の濃い影）。宙に浮くほど薄く小さく
    if (pxPerM > 4 && o.contact !== false) {
      const up = mo.bob ? mo.bob / (0.08 * pxPerM) : 0, k = 1 - up * 0.25;
      c.fillStyle = 'rgba(20,14,8,' + (0.3 * k).toFixed(3) + ')'; c.beginPath();
      c.ellipse(x - (side ? 0.05 : 0) * pxPerM, y, (side ? 0.95 * sq : 0.32) * pxPerM * k, 0.09 * pxPerM, 0, 0, TAU); c.fill();
    }
    Sprites.draw(c, sp, frame, x, y, 2.45 * size * pxPerM, sq, h.no, !!o.flip, v, mo);
  }

  function draw(c, x, y, pxPerM, h, cycle, o) {
    o = o || {};
    // 写真風スプライトがあればそちらを使う（体高＋騎手でおよそ 2.45m）
    if (window.Sprites && Sprites.ready && !o.vector) {
      const v = o.view || 'side', sp = Sprites.get(h.coat, v, h.silk);
      if (sp) { drawSprite(c, x, y, pxPerM, h, cycle, o, v, sp); return; }
    }
    const co = COATS[h.coat] || COATS.bay, run = cycle >= 0, ph = run ? (cycle % 1) * TAU : 0;
    const S = pxPerM, view = o.view || 'side', squash = Math.max(0.3, Math.min(1, o.squash == null ? 1 : o.squash));
    if (o.shadow !== false) { c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(x + 0.15 * S, y, (view === 'side' ? 1.25 * squash : 0.6) * S, 0.22 * S, 0, 0, TAU); c.fill(); }
    c.save(); c.translate(x, y);
    if (view === 'side') { c.scale(S * squash, -S); drawSide(c, h, co, ph, run, squash); }
    else { c.scale(S * Math.max(0.75, squash), -S); drawFront(c, h, co, ph, run, view === 'front'); }
    c.restore();
  }

  function face(c, x, y, size, h) {
    // 写真風スプライトがあれば、横向きのコマから頭と騎手のあたりを切り抜いて使う
    if (window.Sprites && Sprites.ready) {
      const sp = Sprites.get(h.coat, 'side', h.silk);
      if (sp) { const sx = sp.w * 0.42, sy = sp.pad, sw = sp.w * 0.5, sh = sp.h * 0.62, k = (size * 1.35) / sh; c.drawImage(sp.cv, sx, sy, sw, sh, x - sw * k / 2, y - sh * k / 2, sw * k, sh * k); return; }
    }
    const co = COATS[h.coat] || COATS.bay, s = size;
    c.save(); c.translate(x, y); c.scale(s, -s);
    const g = c.createLinearGradient(-0.3, 0.4, 0.4, -0.3); g.addColorStop(0, co.hi); g.addColorStop(0.5, co.body); g.addColorStop(1, co.lo);
    c.fillStyle = g;
    c.beginPath(); c.moveTo(-0.3, 0.35); c.bezierCurveTo(-0.1, 0.5, 0.25, 0.4, 0.4, 0.05); c.lineTo(0.45, -0.3); c.bezierCurveTo(0.3, -0.45, 0.05, -0.4, -0.05, -0.2); c.bezierCurveTo(-0.15, 0.0, -0.3, 0.1, -0.42, 0.1); c.closePath(); c.fill(); strokePath(c, OUT, 0.03);
    c.fillStyle = co.muzzle; c.beginPath(); c.ellipse(0.36, -0.28, 0.13, 0.1, -0.5, 0, TAU); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.ellipse(0.02, 0.12, 0.05, 0.045, 0, 0, TAU); c.fill();
    c.fillStyle = co.points; c.beginPath(); c.moveTo(-0.3, 0.3); c.lineTo(-0.25, 0.55); c.lineTo(-0.12, 0.33); c.closePath(); c.fill();
    c.strokeStyle = co.mane; c.lineWidth = 0.08; c.beginPath(); c.moveTo(-0.4, 0.2); c.lineTo(-0.55, -0.1); c.stroke();
    c.restore();
  }

  return { draw, face, COATS };
})();
