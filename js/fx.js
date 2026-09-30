/* パーティクル演出（加算合成のグロースプライトを Canvas に描画）。
   座標は #content の設計座標（1600x900）。キャンバスは上下に余白 OFF を持つ。 */
const FX = (function () {
  'use strict';
  const CW = 1600, CHT = 1200, OFF = 150;
  let cv, ctx, raf = 0, last = 0, ambient = 0, ambAcc = 0;
  let parts = [], rings = [], lines = [], bolts = [];
  let timeScale = 1; // 1=等速。スローモーションや早回しに使う
  let lastRaf = 0;
  /* 軽量化: 1フレームにかかった時間の平均を見て、重い端末では粒子数を自動で減らす。総数にも上限を設ける。 */
  let Q = 0.75, avgMs = 16;
  const LITE = () => !!window.LITE; // 軽量モード（init 以降に決まる）
  let MAX_PARTS = 200, RES = 0.5, FRAME_MS = 30; // テレビ版は24フレーム上限 // 描画面の解像度（0.5 = 画素数は4分の1）。CSS で拡大表示する
  const qn = (n) => (parts.length > MAX_PARTS ? 0 : Math.max(1, Math.round(n * Q)));
  const sprites = {};
  const COLORS = { gold: [255, 205, 96], white: [255, 246, 220], silver: [214, 226, 240], red: [255, 80, 70], blue: [70, 140, 255], cyan: [120, 225, 255], violet: [185, 120, 255], orange: [255, 150, 50], yellow: [255, 235, 80], green: [90, 240, 120] };

  function sprite(name) {
    if (sprites[name]) return sprites[name];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const [r, g, b] = COLORS[name];
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, `rgba(${r},${g},${b},.95)`);
    gr.addColorStop(0.5, `rgba(${r},${g},${b},.28)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return (sprites[name] = c);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function kick() {
    if (!enabled) { parts = []; rings = []; lines = []; bolts = []; return; }
    if (!raf) { last = lastRaf = performance.now(); raf = requestAnimationFrame(loop); }
  }

  /* 中心から放射状に弾ける */
  function burst(x, y, n, o) {
    n = qn(n);
    o = o || {};
    const cols = o.colors || ['gold', 'gold', 'white'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(o.min || 150, o.max || 900);
      parts.push({ t: 0, life: rnd(0.6, o.life || 1.5), x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 0), g: o.grav === undefined ? 520 : o.grav, drag: 1.8, size: rnd(6, o.size || 22), c: pick(cols), tw: Math.random() * 6 });
    }
    kick();
  }
  /* 外周から一点へ光が集まる */
  function converge(x, y, n, dur) {
    n = qn(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(420, 900);
      parts.push({ conv: true, t: -rnd(0, dur * 0.55), life: dur * rnd(0.4, 0.55), sx: x + Math.cos(a) * r, sy: y + Math.sin(a) * r * 0.7, tx: x, ty: y, x: 0, y: 0, sw: rnd(1.2, 2.6), size: rnd(8, 24), c: pick(['gold', 'white', 'gold']), tw: 0 });
    }
    kick();
  }
  /* 上から金粉が降る */
  function rain(n, dur, cols) {
    n = qn(n);
    for (let i = 0; i < n; i++) {
      parts.push({ t: -rnd(0, dur), life: rnd(1.6, 2.6), x: rnd(0, CW), y: -OFF - 20, vx: rnd(-40, 40), vy: rnd(260, 560), g: 120, drag: 0.2, size: rnd(6, 18), c: pick(cols || ['gold', 'gold', 'white']), tw: Math.random() * 6 });
    }
    kick();
  }
  function ring(x, y, color, maxR, dur) {
    rings.push({ x, y, t: 0, dur: dur || 0.7, maxR: maxR || 900, c: COLORS[color || 'gold'] });
    kick();
  }
  /* 常時ただよう光の粒。rate は 1秒あたりの発生数（0で停止）。 */
  /* 待機中に漂う光の粒は廃止（待機中は描画ループを完全に止める）。呼び出し側との互換のため関数だけ残す */
  function setAmbient() { ambient = 0; }
  let enabled = true;
  function setEnabled(on) { enabled = on; if (!on) { parts = []; rings = []; lines = []; bolts = []; } }
  function clear() { parts = []; rings = []; lines = []; bolts = []; heights = new Array(COLS).fill(0); }
  /* 集中線。inward: 外から中心へ / それ以外: 中心から外へ飛ぶ */
  function streaks(x, y, n, dur, o) {
    n = qn(n);
    o = o || {};
    const cols = o.colors || ['gold', 'white'];
    for (let i = 0; i < n; i++) {
      lines.push({ x, y, a: Math.random() * Math.PI * 2, t: -rnd(0, dur), life: rnd(0.3, 0.6), r0: rnd(70, 240), r1: rnd(800, 1400), len: rnd(80, 260), w: rnd(1.5, 4.5), c: COLORS[pick(cols)], inward: !!o.inward });
    }
    kick();
  }
  /* 稲妻（ギザギザの折れ線＋枝） */
  function lightning(x1, y1, x2, y2, color, w) {
    const mk = (ax, ay, bx, by, jit, n) => {
      const pts = [], nx = -(by - ay), ny = bx - ax, L = Math.hypot(nx, ny) || 1;
      for (let i = 0; i <= n; i++) {
        const u = i / n, j = i === 0 || i === n ? 0 : rnd(-jit, jit);
        pts.push([ax + (bx - ax) * u + (nx / L) * j, ay + (by - ay) * u + (ny / L) * j]);
      }
      return pts;
    };
    const main = mk(x1, y1, x2, y2, 46, 12);
    bolts.push({ pts: main, t: 0, life: 0.3, c: COLORS[color || 'white'], w: w || 4 });
    const k = 3 + Math.floor(Math.random() * 6), m = main[k];
    bolts.push({ pts: mk(m[0], m[1], m[0] + rnd(-220, 220), m[1] + rnd(-220, 220), 26, 6), t: 0, life: 0.22, c: COLORS[color || 'white'], w: (w || 4) * 0.6 });
    kick();
  }
  /* 下から噴き上がる火花 */
  function fountain(x, y, n, dur, cols, o) {
    n = qn(n);
    o = o || {};
    for (let i = 0; i < n; i++) {
      parts.push({ t: -rnd(0, dur), life: rnd(1.2, 2.0), x, y, vx: rnd(-240, 240) + (o.vx || 0), vy: -rnd(900, 1600), g: 1200, drag: 0.35, size: rnd(6, 18), c: pick(cols || ['gold', 'gold', 'white']), tw: Math.random() * 6 });
    }
    kick();
  }
  /* ---------- カジノチップ・トランプ ---------- */
  const COLS = 40;
  let heights = new Array(COLS).fill(0), groundY = 900, onLand = null;
  const CHIP = { red: ['#d8261c', '#ffffff'], blue: ['#1f5fd0', '#ffffff'], green: ['#178a45', '#ffffff'], black: ['#1b1b20', '#e9c25e'], purple: ['#7a2fc0', '#ffffff'], gold: ['#e0a62f', '#1b1b20'], white: ['#f2f2f2', '#d8261c'] };
  const chipCache = {}, cardCache = {};
  function chipSprite(name) {
    if (chipCache[name]) return chipCache[name];
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const x = c.getContext('2d'), col = CHIP[name] || CHIP.red;
    x.translate(48, 48);
    x.fillStyle = '#0a0a0c'; x.beginPath(); x.arc(0, 0, 47, 0, 6.2832); x.fill();
    x.fillStyle = col[0]; x.beginPath(); x.arc(0, 0, 45, 0, 6.2832); x.fill();
    x.strokeStyle = col[1]; x.lineWidth = 12;                       // 縁の縞
    for (let i = 0; i < 8; i++) { x.beginPath(); x.arc(0, 0, 39, i * 0.7854 - 0.17, i * 0.7854 + 0.17); x.stroke(); }
    x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 32, 0, 6.2832); x.stroke();
    x.strokeStyle = col[1]; x.lineWidth = 2.5; x.setLineDash([5, 5]); x.beginPath(); x.arc(0, 0, 28, 0, 6.2832); x.stroke(); x.setLineDash([]);
    const g = x.createRadialGradient(-8, -10, 2, 0, 0, 24);
    g.addColorStop(0, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, 23, 0, 6.2832); x.fill();
    x.fillStyle = col[1]; x.font = '700 26px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('\u2660', 0, 1);
    return (chipCache[name] = c);
  }
  function roundRect(x, l, t, w, h, r) { x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath(); }
  const FACES = [['A', '\u2660'], ['K', '\u2665'], ['Q', '\u2666'], ['J', '\u2663'], ['10', '\u2660'], ['A', '\u2665'], ['K', '\u2660']];
  function cardSprite(i) {
    if (cardCache[i]) return cardCache[i];
    const c = document.createElement('canvas');
    c.width = 100; c.height = 140;
    const x = c.getContext('2d'), f = FACES[i % FACES.length];
    const red = f[1] === '\u2665' || f[1] === '\u2666';
    roundRect(x, 1, 1, 98, 138, 9); x.fillStyle = '#fbfaf5'; x.fill(); x.strokeStyle = '#8a8a8a'; x.lineWidth = 2; x.stroke();
    x.fillStyle = red ? '#d0201a' : '#15151a'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '700 26px Georgia, serif'; x.fillText(f[0], 18, 20); x.font = '22px Georgia, serif'; x.fillText(f[1], 18, 44);
    x.font = '70px Georgia, serif'; x.fillText(f[1], 50, 80);
    return (cardCache[i] = c);
  }
  function cardBack() {
    if (cardCache.back) return cardCache.back;
    const c = document.createElement('canvas');
    c.width = 100; c.height = 140;
    const x = c.getContext('2d');
    roundRect(x, 1, 1, 98, 138, 9); x.fillStyle = '#15151a'; x.fill(); x.strokeStyle = '#e9c25e'; x.lineWidth = 3; x.stroke();
    roundRect(x, 9, 9, 82, 122, 5); x.strokeStyle = '#b8862b'; x.lineWidth = 1.5; x.stroke();
    x.save(); x.clip(); x.strokeStyle = 'rgba(233,194,94,.5)'; x.lineWidth = 1;
    for (let k = -140; k < 240; k += 12) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 140, 140); x.moveTo(k + 140, 0); x.lineTo(k, 140); x.stroke(); }
    x.restore();
    return (cardCache.back = c);
  }
  /* チップの雨。o.land で下に積み上がる。o.size で大きさ。 */
  function chips(n, dur, cols, o) {
    n = qn(n);
    o = o || {};
    cols = cols || ['red'];
    for (let i = 0; i < n; i++) {
      const size = rnd(o.size || 18, (o.size || 18) * 1.35);
      parts.push({ img: chipSprite(pick(cols)), land: !!o.land, zk: !o.land && Math.random() < 0.16 ? rnd(1.0, 1.7) : 0, t: -rnd(0, dur), life: 4, x: rnd(40, CW - 40), y: -OFF - 40, vx: rnd(-60, 60), vy: rnd(420, 820), g: 900, drag: 0.12, size, rot: rnd(0, 6), vr: rnd(-2.5, 2.5), sp: rnd(7, 13), c: 'gold', tw: 0 });
    }
    kick();
  }
  /* チップの噴水（下から噴き上がる） */
  function chipFountain(x, y, n, dur, cols, o) {
    n = qn(n);
    o = o || {};
    for (let i = 0; i < n; i++) {
      const size = rnd(18, 26);
      parts.push({ img: chipSprite(pick(cols)), land: !!o.land, t: -rnd(0, dur), life: 4, x, y, vx: rnd(-330, 330) + (o.vx || 0), vy: -rnd(1100, 1900), g: 1500, drag: 0.2, size, rot: rnd(0, 6), vr: rnd(-4, 4), sp: rnd(9, 15), c: 'gold', tw: 0 });
    }
    kick();
  }
  /* 積み上がったチップを弾き飛ばして消す */
  function releasePile() {
    parts.forEach((p) => {
      if (!p.landed && !p.land) return;
      p.landed = false; p.land = false; p.t = 0; p.life = 1.5;
      p.vx = rnd(-700, 700); p.vy = -rnd(300, 1300); p.g = 2200; p.vr = rnd(-8, 8);
    });
    heights = new Array(COLS).fill(0);
  }
  function setTimeScale(s) { timeScale = s; }
  function setGround(y, cb) { groundY = y; onLand = cb || null; }
  /* トランプが舞う。o.sweep: 左から右へ流れる / それ以外: (x,y) から飛び散る */
  function cards(n, dur, o) {
    n = qn(n);
    o = o || {};
    for (let i = 0; i < n; i++) {
      const p = { img: cardSprite(Math.floor(Math.random() * FACES.length)), card: true, t: -rnd(0, dur), life: 2.2, size: rnd(50, 74), rot: rnd(-0.6, 0.6), vr: rnd(-3, 3), sp: rnd(5, 10), c: 'gold', tw: 0, drag: 0.1 };
      if (o.sweep) { p.x = -120; p.y = rnd(200, 700); p.vx = rnd(1500, 2400); p.vy = rnd(-420, 120); p.g = 500; }
      else { const a = Math.random() * 6.2832, s = rnd(500, 1300); p.x = o.x; p.y = o.y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s - 300; p.g = 1100; p.drag = 0.6; }
      parts.push(p);
    }
    kick();
  }
  /* 金箔の紙吹雪 */
  function flakes(n, dur, cols) {
    n = qn(n);
    for (let i = 0; i < n; i++) {
      parts.push({ flake: true, t: -rnd(0, dur), life: rnd(2.2, 3.6), x: rnd(0, CW), y: -OFF - 20, vx: rnd(-70, 70), vy: rnd(200, 460), g: 50, drag: 0.4, size: rnd(9, 20), rot: rnd(0, 6), vr: rnd(-7, 7), c: pick(cols || ['gold', 'gold', 'white']), tw: 0 });
    }
    kick();
  }

  function loop(now) {
    // 端末の実際のコマ間隔（画面の更新ごと）を測る
    const rawMs = Math.min(100, now - lastRaf);
    lastRaf = now;
    avgMs += (rawMs - avgMs) * 0.06;
    Q = LITE() ? 0.3 : avgMs > 26 ? 0.3 : avgMs > 20 ? 0.45 : 0.65;
    // 粒子は30フレームで描く（細かい光の点なので見た目はほぼ変わらず、描く回数が半分になる）
    if (now - last < FRAME_MS) { raf = requestAnimationFrame(loop); return; }
    const dt = Math.min(0.06, (now - last) / 1000) * timeScale;
    last = now;
    if (ambient > 0) {
      ambAcc += ambient * dt;
      while (ambAcc >= 1) {
        ambAcc -= 1;
        parts.push({ t: 0, life: rnd(3, 6), x: rnd(0, CW), y: rnd(200, 1050) , vx: rnd(-12, 12), vy: rnd(-46, -14), g: 0, drag: 0, size: rnd(4, 12), c: pick(setAmbient.colors), tw: Math.random() * 6, amb: true });
      }
    }
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    ctx.clearRect(0, 0, CW, CHT);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t < 0) continue;
      const u = p.landed ? 0 : p.t / p.life;
      if (u >= 1) { parts.splice(i, 1); continue; }
      let alpha, size = p.size;
      if (p.conv) {
        const e = u * u * u; // 吸い込まれるほど加速
        // 渦を巻きながら中心へ
        const dx = (p.sx - p.tx) * (1 - e), dy = (p.sy - p.ty) * (1 - e), an = (p.sw || 0) * e;
        p.x = p.tx + dx * Math.cos(an) - dy * Math.sin(an);
        p.y = p.ty + dx * Math.sin(an) + dy * Math.cos(an);
        alpha = Math.min(1, u * 3);
        size = p.size * (1.2 - u * 0.6);
      } else {
        if (!p.landed) {
          p.vx -= p.vx * p.drag * dt;
          p.vy += (p.g - p.vy * p.drag) * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.land && p.vy > 0) { // 山の上に着地
            const col = Math.max(0, Math.min(COLS - 1, Math.floor(p.x / (CW / COLS))));
            const gy = groundY - heights[col] - p.size * 0.4;
            if (p.y >= gy) {
              p.y = gy; p.landed = true; p.rot = rnd(-0.18, 0.18);
              heights[col] += p.size * 0.5;
              if (col > 0) heights[col - 1] += p.size * 0.16;
              if (col < COLS - 1) heights[col + 1] += p.size * 0.16;
              if (onLand && Math.random() < 0.35) onLand();
            }
          }
        }
        alpha = p.amb ? Math.sin(u * Math.PI) * 0.6 : 1 - u * u;
        alpha *= 0.75 + 0.25 * Math.sin(p.t * 14 + p.tw); // きらめき
      }
      ctx.globalAlpha = Math.max(0, alpha);
      if (p.img) { // チップ・カード（スプライトを回転・反転させて描く）
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = p.landed ? 1 : Math.min(1, (1 - u) * 6);
        ctx.translate(p.x, p.y + OFF);
        ctx.rotate(p.rot);
        if (p.landed) ctx.scale(1, 0.42);
        else {
          p.rot += p.vr * dt;
          const sq = Math.cos(p.t * p.sp);
          if (p.card) ctx.scale(Math.abs(sq) < 0.1 ? 0.1 : sq, 1); else ctx.scale(1, Math.max(0.16, Math.abs(sq)));
        }
        if (p.zk) { // カメラに向かって飛んでくる（指数関数的に大きくなる）
          const zs = Math.min(8, Math.exp(p.zk * p.t));
          size *= zs;
          ctx.globalAlpha *= Math.max(0, Math.min(1, (8 - zs) / 2.5));
        }
        const w = p.card ? size * 1.43 : size * 2, h = size * 2;
        ctx.drawImage(p.card && !p.landed && Math.cos(p.t * p.sp) < 0 ? cardBack() : p.img, -w / 2, -h / 2, w, h);
        ctx.restore();
        continue;
      }
      if (p.flake) { // ひらひら舞う金箔
        p.rot += p.vr * dt;
        const c = COLORS[p.c];
        ctx.save();
        ctx.translate(p.x, p.y + OFF);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.t * p.vr * 1.3));
        ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        ctx.fillRect(-size / 2, -size / 3, size, size * 0.66);
        ctx.restore();
        continue;
      }
      ctx.drawImage(sprite(p.c), p.x - size, p.y + OFF - size, size * 2, size * 2);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      const u = r.t / r.dur;
      if (u >= 1) { rings.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - u, 3);
      ctx.globalAlpha = (1 - u) * 0.9;
      ctx.lineWidth = 26 * (1 - u) + 2;
      ctx.strokeStyle = `rgb(${r.c[0]},${r.c[1]},${r.c[2]})`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y + OFF, r.maxR * e, r.maxR * e * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 集中線（ワープ）
    ctx.lineCap = 'round';
    for (let i = lines.length - 1; i >= 0; i--) {
      const s = lines[i];
      s.t += dt;
      if (s.t < 0) continue;
      const u = s.t / s.life;
      if (u >= 1) { lines.splice(i, 1); continue; }
      const e = s.inward ? 1 - u * u : u * u;
      const r = s.r0 + (s.r1 - s.r0) * e, len = s.len * (0.3 + e);
      const cx = Math.cos(s.a), cy = Math.sin(s.a) * 0.8;
      ctx.globalAlpha = Math.sin(u * Math.PI) * 0.85;
      ctx.lineWidth = s.w;
      ctx.strokeStyle = 'rgb(' + s.c[0] + ',' + s.c[1] + ',' + s.c[2] + ')';
      ctx.beginPath();
      ctx.moveTo(s.x + cx * r, s.y + OFF + cy * r);
      ctx.lineTo(s.x + cx * (r + len), s.y + OFF + cy * (r + len));
      ctx.stroke();
    }
    // 稲妻
    ctx.lineJoin = 'round';
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.t += dt;
      const u = b.t / b.life;
      if (u >= 1) { bolts.splice(i, 1); continue; }
      const al = (1 - u) * (Math.random() < 0.25 ? 0.4 : 1);
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = al * (pass ? 1 : 0.45);
        ctx.lineWidth = pass ? b.w : b.w * 4;
        ctx.strokeStyle = pass ? '#ffffff' : 'rgb(' + b.c[0] + ',' + b.c[1] + ',' + b.c[2] + ')';
        ctx.beginPath();
        b.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1] + OFF) : ctx.moveTo(p[0], p[1] + OFF)));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (parts.length || rings.length || lines.length || bolts.length || ambient > 0) raf = requestAnimationFrame(loop);
    else { raf = 0; ctx.clearRect(0, 0, CW, CHT); }
  }

  function init(canvas) {
    cv = canvas;
    if (LITE()) { MAX_PARTS = 80; RES = 0.4; FRAME_MS = 1000 / 24 - 2; }
    cv.width = CW * RES; cv.height = CHT * RES;
    ctx = cv.getContext('2d');
  }

  return { init, burst, converge, rain, ring, setAmbient, clear, streaks, lightning, fountain, flakes, chips, chipFountain, releasePile, setGround, cards, setTimeScale, setEnabled };
})();
