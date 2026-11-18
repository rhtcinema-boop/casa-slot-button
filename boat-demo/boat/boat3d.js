/* casa BOAT（競艇）テスト版: 船（ボート＋選手）と、航跡・水しぶき（three.js r149、すべてコードで作る。画像ファイルなし）。
   BOAT.Boat … 1 艇ぶんの形と動き。BOAT.Wake … 6 艇ぶんの航跡（泡の帯＋V 字の波の筋）と水しぶきをまとめて面倒を見る。
   座標: 単位メートル、y が上、水面は y = 0。艇の原点＝艇の真ん中の水面、舳先（前）が +X、艇の右が +Z（左＝内側は −Z）。
   見た目は本物の中継（ref/boat/README.md）に合わせる: 船体の側面と底は橙（白い細い線）、甲板は白、カウル（選手の前の覆い。風防つき）と艇番の札・選手の服とヘルメットが枠の色、
   舳先に小さな三角の艇旗、艇尾に黒い船外機。船体は輪切りを並べたなめらかな曲面（底は 2 段のハイドロ）、塗装はつやあり（空の映り込み）。
   重さ: 1 艇 2 描画（艇・選手）＋ 航跡 1 ＋ しぶき 1 ＝ 6 艇で 14 描画（high は艇の影で ＋6）。low はつやなし。
   色: 画面の出力が sRGB（renderer.outputEncoding = sRGBEncoding）の前提で、頂点の色は線形に直して入れる。
   使い方:
     const b = BOAT.Boat.create({ no: 3, color: '#d6332b', ink: '#fff', name: '…' }, { quality: 'high' });
     scene.add(b.object3d);  // 位置と rotation.y は統合側が毎コマ入れる。部品は子（rig）だけを動かす
     b.update(dt, { speed, turn, flip, t });
     const w = BOAT.Wake.create(scene, { quality: 'high' });  w.update(dt, [{ x, z, hx, hz, speed, turn, flip, on }, …]);  w.reset(); */
window.BOAT = window.BOAT || {};

BOAT.Boat = (function () {
  'use strict';
  const PI = Math.PI, DEG = PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function hexRGB(h) { h = String(h || '#888'); if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const toLin = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const lin = (h) => toLin(hexRGB(h));
  const luma = (h) => { const c = hexRGB(h); return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; };

  // 枠の色（1 白・2 黒・3 赤・4 青・5 黄・6 緑）
  const COLORS = [
    { color: '#f4f4f4', ink: '#111' }, { color: '#1a1a1e', ink: '#fff' }, { color: '#d6332b', ink: '#fff' },
    { color: '#2459c9', ink: '#fff' }, { color: '#f2c531', ink: '#111' }, { color: '#2a9a4a', ink: '#fff' },
  ];

  // ---------------- 寸法 ----------------
  const LEN = 2.895, HW = 0.658;              // 全長 2.895m・全幅 1.316m（ヤマト YM-730 型。等倍）
  const X = (t) => -LEN / 2 + t * LEN;        // t = 0 艇尾 〜 1 舳先
  // 下の割合は 陸に置いた艇の真横の写真（research/img3/wiki_boat.jpg。艇の長さ 1220 画素 = 2.895m）を測った値
  const T_CP0 = 0.09, T_CP1 = 0.5, CPZ = 0.36, CP_FLOOR = 0.022;     // 操縦席: 後ろの端・前の端（ハンドルの所）・内側の半分の幅・床の高さ
  const T_HOOD = 0.76, HOOD_H = 0.265, PANEL_H = 0.325, COWL_OUT = 0.085; // カウリング: 前の先（舳先から 24%）・ハンドルの所の高さ・側板のいちばん高い所（甲板から）・側板の外への張り出し

  // ---------------- 絵（6 艇で共有） ----------------
  // 色の絵 1024×512: 左の 768 に 256 角のマスを 3×2（マス i に 枠の色の地＋艇番。甲板の札・艇の横・選手の背中と胸で使う）。
  // 右端は白（絵を使わない面が指す所）。上半分＝つやなしの面、下半分＝つやありの面（つやの強さの絵 specMap で分ける）
  let atlas = null, specTex = null, envTex = null, matHigh = null, matLow = null, matGlass = null, users = 0;
  const UV_MATTE = [0.9, 0.875], UV_GLOSS = [0.9, 0.625];
  function ensureTextures() {
    if (atlas) return;
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 1024;                  // 上半分は前と同じ割り付け、下半分は選手名の札（512×170 を 2 列 × 3 段）
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 1024);
    atlas = new THREE.CanvasTexture(cv); atlas.encoding = THREE.sRGBEncoding; atlas.anisotropy = 4;
    const sv = document.createElement('canvas'); sv.width = 64; sv.height = 64; const sg = sv.getContext('2d'); sg.fillStyle = '#1c1c1c'; sg.fillRect(0, 32, 64, 32);
    sg.fillStyle = '#1c1c1c'; sg.fillRect(0, 0, 48, 32); sg.fillStyle = '#0c0c0c'; sg.fillRect(48, 0, 16, 16); sg.fillStyle = '#fff'; sg.fillRect(48, 16, 16, 16);
    specTex = new THREE.CanvasTexture(sv); specTex.magFilter = THREE.NearestFilter; specTex.minFilter = THREE.NearestFilter; specTex.generateMipmaps = false;
    // 映り込み用の空（6 面の小さな絵）: 上は青空、水平線は明るく、下は暗い水面
    const face = (kind) => {
      const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
      if (kind === 'top') { const r = x.createRadialGradient(10, 12, 1, 16, 16, 24); r.addColorStop(0, '#b4cde8'); r.addColorStop(1, '#84abd8'); x.fillStyle = r; }
      else if (kind === 'bottom') x.fillStyle = '#244a55';
      else { const l = x.createLinearGradient(0, 0, 0, 32); l.addColorStop(0, '#93bce4'); l.addColorStop(0.42, '#dbe8f0'); l.addColorStop(0.5, '#eef3f4'); l.addColorStop(0.53, '#5d8793'); l.addColorStop(1, '#2a525d'); x.fillStyle = l; }
      x.fillRect(0, 0, 32, 32); return c;
    };
    envTex = new THREE.CubeTexture([face('side'), face('side'), face('top'), face('bottom'), face('side'), face('side')]); envTex.encoding = THREE.sRGBEncoding; envTex.needsUpdate = true;
  }
  function ensureMaterial(low) {
    ensureTextures();
    if (low) { if (!matLow) matLow = new THREE.MeshLambertMaterial({ vertexColors: true, map: atlas }); return matLow; }
    if (!matHigh) matHigh = new THREE.MeshPhongMaterial({ vertexColors: true, map: atlas, specularMap: specTex, specular: new THREE.Color(0.035, 0.035, 0.035), shininess: 60,   // 色の数値は線形のまま使われる（r149 の既定）ので、反射は小さな数で
      envMap: envTex, combine: THREE.MixOperation, reflectivity: 0.1 });
    return matHigh;
  }
  function ensureGlass() { ensureTextures(); if (!matGlass) matGlass = new THREE.MeshPhongMaterial({ color: 0x0a1118, transparent: true, opacity: 0.62, specular: new THREE.Color(0.05, 0.05, 0.05), shininess: 80, envMap: envTex, combine: THREE.AddOperation, reflectivity: 0.12, side: THREE.DoubleSide, depthWrite: false }); if ('forceSinglePass' in matGlass) matGlass.forceSinglePass = true; return matGlass; }
  function drawCell(no, color, ink) {
    const i = clamp(no - 1, 0, 5), x0 = (i % 3) * 256, y0 = Math.floor(i / 3) * 256, g = atlas.image.getContext('2d');
    const inkDark = luma(ink) < 0.5, bgDark = luma(color) < 0.2;
    g.save(); g.beginPath(); g.rect(x0, y0, 256, 256); g.clip();
    g.fillStyle = color; g.fillRect(x0, y0, 256, 256);
    g.strokeStyle = ink; g.lineWidth = 7; g.strokeRect(x0 + 5.5, y0 + 5.5, 245, 245);   // 縁取り（白の 1 号艇は黒い縁、黒の 2 号艇は白い縁になる）
    g.font = '900 176px "Arial Black", "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    const m = g.measureText(String(no)), asc = m.actualBoundingBoxAscent || 126, cy = y0 + 128 + asc / 2;
    if (!inkDark && !bgDark) { g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 12; g.strokeText(String(no), x0 + 128, cy); } // 色の地に白い数字は、黒い縁でくっきり
    g.fillStyle = ink; g.fillText(String(no), x0 + 128, cy);
    g.restore(); atlas.needsUpdate = true;
  }
  // マス i の中の (a, b)（a 左→右、b 下→上、0〜1）を 絵の座標へ
  function cellUV(i, a, b) { a = clamp(a, 0.012, 0.988); b = clamp(b, 0.012, 0.988); return [((i % 3) + a) * 0.25, 1 - (Math.floor(i / 3) + 1) * 0.25 + b * 0.25]; }
  const NAME_BG = '#f4f3ee';
  function nameUV(i, a, b) { a = clamp(a, 0.01, 0.99); b = clamp(b, 0.02, 0.98); return [((i % 2) + a) * 0.5, 1 - (512 + Math.floor(i / 2) * 170 + (1 - b) * 170) / 1024]; }
  // 側板に書く選手名（本物と同じく名字だけ・赤い字）
  function drawName(no, name) {
    const i = clamp(no - 1, 0, 5), x0 = (i % 2) * 512, y0 = 512 + Math.floor(i / 2) * 170, g = atlas.image.getContext('2d'), txt = String(name || '').split(/[\s\u3000]/)[0] || String(no);
    g.save(); g.beginPath(); g.rect(x0, y0, 512, 170); g.clip(); g.fillStyle = NAME_BG; g.fillRect(x0, y0, 512, 170);
    g.fillStyle = '#c4161c'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 132px "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
    const w = g.measureText(txt).width; g.translate(x0 + 256, y0 + 90); g.scale(Math.min(1.25, 470 / Math.max(w, 1)), 1); g.fillText(txt, 0, 0);
    g.restore(); atlas.needsUpdate = true;
  }

  // ---------------- 形を貯める道具（位置・法線・色・絵の座標を 1 つの形にまとめる＝1 描画） ----------------
  function Builder() { this.p = []; this.n = []; this.c = []; this.u = []; this.zone = UV_GLOSS; }
  Builder.prototype.gloss = function () { this.zone = UV_GLOSS; return this; };   // これ以降に足す面は つやあり
  Builder.prototype.matte = function () { this.zone = UV_MATTE; return this; };   // つやなし（布・ゴム）
  Builder.prototype.v = function (p, n, col, uv) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(col[0], col[1], col[2]); uv = uv || this.zone; this.u.push(uv[0], uv[1]); };
  Builder.prototype.tri = function (a, b, c, col, inside, ua, ub, uc) { // 平らな面 1 枚。inside（中の点）を渡すと、面の向きを外向きにそろえる
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz); if (l < 1e-10) return; nx /= l; ny /= l; nz /= l;
    if (inside) { const ox = (a[0] + b[0] + c[0]) / 3 - inside[0], oy = (a[1] + b[1] + c[1]) / 3 - inside[1], oz = (a[2] + b[2] + c[2]) / 3 - inside[2]; if (nx * ox + ny * oy + nz * oz < 0) { const t = b; b = c; c = t; const tu = ub; ub = uc; uc = tu; nx = -nx; ny = -ny; nz = -nz; } }
    const n = [nx, ny, nz]; this.v(a, n, col, ua); this.v(b, n, col, ub); this.v(c, n, col, uc);
  };
  Builder.prototype.quad = function (a, b, c, d, col, inside, ua, ub, uc, ud) { this.tri(a, b, c, col, inside, ua, ub, uc); this.tri(a, c, d, col, inside, ua, uc, ud); };
  // 点の格子 P[行][列] を なめらかな曲面にする（法線は隣の点から）。inside = 中の点（面を外向きにそろえる）。col は色か (行, 列) → 色、uvFn は (点, 行, 列) → 絵の座標
  Builder.prototype.grid = function (P, col, inside, uvFn) {
    const n = P.length, m = P[0].length, N = []; let sign = 0;
    for (let i = 0; i < n; i++) { N.push([]); for (let j = 0; j < m; j++) {
      const a0 = P[Math.max(i - 1, 0)][j], a1 = P[Math.min(i + 1, n - 1)][j], b0 = P[i][Math.max(j - 1, 0)], b1 = P[i][Math.min(j + 1, m - 1)];
      const ax = a1[0] - a0[0], ay = a1[1] - a0[1], az = a1[2] - a0[2], bx = b1[0] - b0[0], by = b1[1] - b0[1], bz = b1[2] - b0[2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz);
      N[i].push(l < 1e-9 ? null : [nx / l, ny / l, nz / l]);
    } }
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if (!N[i][j]) N[i][j] = (i > 0 && N[i - 1][j]) || (i < n - 1 && N[i + 1][j]) || (j > 0 && N[i][j - 1]) || (j < m - 1 && N[i][j + 1]) || [0, 1, 0];
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const p = P[i][j], q = N[i][j]; sign += q[0] * (p[0] - inside[0]) + q[1] * (p[1] - inside[1]) + q[2] * (p[2] - inside[2]); }
    if (sign < 0) for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const q = N[i][j]; N[i][j] = [-q[0], -q[1], -q[2]]; }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
      const ids = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], c = typeof col === 'function' ? col(i, j) : col;
      const emit = (k0, k1, k2) => {
        const a = P[ids[k0][0]][ids[k0][1]], b = P[ids[k1][0]][ids[k1][1]], d = P[ids[k2][0]][ids[k2][1]];
        const gx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), gy = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), gz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        if (Math.hypot(gx, gy, gz) < 1e-10) return;
        const na = N[ids[k0][0]][ids[k0][1]], nb = N[ids[k1][0]][ids[k1][1]], nd = N[ids[k2][0]][ids[k2][1]];
        const order = gx * (na[0] + nb[0] + nd[0]) + gy * (na[1] + nb[1] + nd[1]) + gz * (na[2] + nb[2] + nd[2]) < 0 ? [k0, k2, k1] : [k0, k1, k2];
        for (const k of order) { const ii = ids[k][0], jj = ids[k][1]; this.v(P[ii][jj], N[ii][jj], c, uvFn ? uvFn(P[ii][jj], ii, jj) : null); }
      };
      emit(0, 1, 2); emit(0, 2, 3);
    }
  };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _n3 = new THREE.Matrix3();
  // three.js の基本の形（球・筒・箱・輪）を、置き場所・向き・大きさを決めて足す。rot は [x, y, z]（オイラー角）か、向かせたい軸 { axis: [x,y,z] }（形の +Y をその向きへ）
  Builder.prototype.add = function (geom, pos, rot, scl, col) {
    if (rot && rot.axis) { const a = rot.axis, l = Math.hypot(a[0], a[1], a[2]); _q.setFromUnitVectors(_v.set(0, 1, 0), _s.set(a[0] / l, a[1] / l, a[2] / l)); }
    else { _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0); _q.setFromEuler(_e); }
    _v.set(pos[0], pos[1], pos[2]); _s.set(scl ? scl[0] : 1, scl ? scl[1] : 1, scl ? scl[2] : 1);
    _m.compose(_v, _q, _s); _n3.getNormalMatrix(_m);
    const g = geom.index ? geom.toNonIndexed() : geom, P = g.attributes.position, N = g.attributes.normal, v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(_m); w.fromBufferAttribute(N, i).applyMatrix3(_n3).normalize(); this.v([v.x, v.y, v.z], [w.x, w.y, w.z], col); }
    if (g !== geom) g.dispose(); geom.dispose();
  };
  // a から b へのびる棒（筒）。r0 = a 側の太さ、r1 = b 側の太さ。caps = 両端に球（関節を丸く）
  Builder.prototype.limb = function (a, b, r0, r1, col, seg, caps) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]); seg = seg || 6;
    this.add(new THREE.CylinderGeometry(r1, r0, len, seg, 1, true), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], { axis: d }, null, col);
    if (caps) { this.add(new THREE.SphereGeometry(r0, seg, Math.max(3, seg >> 1)), a, { axis: d }, null, col); this.add(new THREE.SphereGeometry(r1, seg, Math.max(3, seg >> 1)), b, { axis: d }, null, col); }
  };
  Builder.prototype.build = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere(); return g;
  };
  const mirrorZ = (P) => P.map((row) => row.map((p) => [p[0], p[1], -p[2]]));

  // ---------------- 艇の形（本物の競走用ボート＝ハイドロプレーン。資料: ref/boat/research/07_艇の形.md） ----------------
  /* 本物の形: とても薄く平たい木の船体（深さ 20cm ほど。甲板は水面から 15cm くらい）。上から見ると ずんぐり幅広で舳先はゆるい丸み、艇尾は四角。
     横から見ると前へ行くほど薄い「くさび」で、舳先がわずかに反る。前の 4 割は何も無い平らな甲板。
     その後ろに FRP のカウリング: 前は低い丸い覆い（フード）、そこから左右の「側板」が艇尾の手前までのびて操縦席を囲む。
     側板の外側に 枠の色の四角＋艇番（後ろ寄り）・選手名・前向きの矢じり模様。選手は側板のあいだの床（船底の内側）に ひざ立ちで乗る。
     舳先に枠の色の三角の艇旗。艇尾の板に、むき出しの小さなモーター（上に はずみ車）。 */
  function halfW(t) { // 上から見た半分の幅（艇尾は四角く、舳先はゆるい丸み）
    if (t <= 0.45) return HW * (0.93 + 0.07 * smooth(0, 0.45, t));
    const s = clamp((t - 0.45) / 0.55, 0, 1); return HW * Math.pow(Math.max(0, 1 - Math.pow(s, 2.2)), 0.72);   // 前の半分で ゆるく尖る
  }
  // 底: 真ん中あたり（段のある所）がいちばん深く、艇尾へ少し上がり、舳先へ大きく反り上がる。深さは 真ん中 19cm・艇尾 14cm・舳先 5cm（写真の実測）
  const bottomY = (t) => (t < 0.5 ? -0.03 + 0.05 * Math.pow(1 - t / 0.5, 1.4) : -0.03 + 0.17 * Math.pow((t - 0.5) / 0.5, 2.1)) - 0.012 * smooth(0.5, 0.53, t) * smooth(0.95, 0.75, t);
  const deckY = (t) => 0.16 + 0.03 * Math.pow(clamp((t - 0.45) / 0.55, 0, 1), 1.6);                            // 甲板の縁（低く、舳先へ 3cm だけ上がる）
  const crownOf = (t) => 0.014 * halfW(t) / HW;
  function deckSurf(t, z) { const w = Math.max(halfW(t), 1e-4), f = clamp(z / w, -1, 1); return deckY(t) + crownOf(t) * (1 - f * f); } // 甲板の表面の高さ（真ん中がわずかに高い）
  const FB = 0.9;                              // 甲板の白い部分の幅（縁の帯の内側）
  function sectionOf(t) {
    const w = halfW(t), yb = bottomY(t), yd = deckY(t), hs = clamp((yd - yb) / 0.2, 0, 1), x = X(t);
    const yc = yb + 0.035 * hs, yg = yd - 0.028 * hs;                // 舷の下の角（チャイン）と上の角の高さ
    const sideZ = (v) => w * (0.87 + 0.13 * Math.pow(v, 0.75)), sideP = (v) => [x, lerp(yc, yg, v), sideZ(v)];   // 舷は外へ開く（皿の形）
    const bf = [[0, yb - 0.012 * hs], [0.25, yb - 0.006 * hs], [0.5, yb], [0.7, yb + 0.012 * hs], [0.87, yc]];
    const bottom = []; for (let k = bf.length - 1; k >= 1; k--) bottom.push([x, bf[k][1], -bf[k][0] * w]); for (let k = 0; k < bf.length; k++) bottom.push([x, bf[k][1], bf[k][0] * w]);
    const rim = [[x, yg, w], [x, (yg + yd) / 2, w + 0.012 * hs], [x, yd + 0.003, w - 0.008 * hs]];   // 甲板の縁の黒いゴム
    const band = [0.99, 0.945, FB].map((f) => [x, deckSurf(t, f * w) + (f > 0.96 ? 0.002 : 0), f * w]); // 甲板の外側の帯（枠の色）
    const deck = []; for (let k = -4; k <= 4; k++) { const f = FB * k / 4; deck.push([x, deckSurf(t, f * w), f * w]); }
    const sdeck = [CPZ + 0.02, (CPZ + 0.02 + FB * w) / 2, FB * w].map((z) => [x, deckSurf(t, z), z]);   // 操縦席の横の細い甲板
    return { t, x, w, yb, yd, yc, yg, bottom, rim, band, deck, sdeck, lo: [sideP(0), sideP(0.58)], line: [sideP(0.58), sideP(0.8)], hi: [sideP(0.8), sideP(1)], sideP };
  }
  // カウリングの形（上の縁の高さ・外側の半分の幅）。t = 艇尾 0 〜 舳先 1。前の先 T_HOOD から後ろへ高く・広くなり、ハンドルの所から後ろは側板になる
  const cowlTop = (t) => { const u = clamp((T_HOOD - t) / (T_HOOD - T_CP1), 0, 1); if (t >= T_CP1) return HOOD_H * (0.5 * u + 0.5 * Math.pow(u, 0.5)); return lerp(PANEL_H, HOOD_H, Math.pow(clamp((t - 0.2) / (T_CP1 - 0.2), 0, 1), 1.5)); };
  const cowlHalf = (t) => (t >= T_CP1 ? (CPZ + COWL_OUT) * (0.16 + 0.84 * Math.pow(Math.sin(clamp((T_HOOD - t) / (T_HOOD - T_CP1), 0, 1) * PI / 2), 0.75)) : CPZ + COWL_OUT);
  const panelTop = (t) => deckY(t) + cowlTop(t);

  // 艇（船体・カウリング・モーター・艇旗・艇番の札・ハンドル・レバー）を 1 つの形に
  function buildHull(no, C, low) {
    const B = new Builder(), cell = clamp(no - 1, 0, 5), IN = [0, 0.06, 0];
    const NS = low ? 10 : 22, ts = [T_CP0, T_CP1];
    for (let i = 0; i < NS; i++) { const u = i / (NS - 1), t = 1 - Math.pow(1 - u, 1.5); if (Math.abs(t - T_CP0) > 0.012 && Math.abs(t - T_CP1) > 0.012) ts.push(t); }   // 舳先ほど細かく。操縦席の前後の端は必ず入れる
    ts.sort((a, b) => a - b);
    const S = ts.map(sectionOf), rows = (k, f) => S.filter(f || (() => true)).map((s) => s[k]);
    B.gloss();
    B.grid(rows('bottom'), C.bottom, IN);
    for (const mir of [false, true]) {
      const R = (k, f) => (mir ? mirrorZ(rows(k, f)) : rows(k, f));
      B.gloss(); B.grid(R('lo'), C.side, IN); B.grid(R('line'), C.line, IN); B.grid(R('hi'), C.side2, IN);   // 舷: 木の色に白い細い線
      B.grid(R('band'), C.frame, IN);
      B.grid(R('sdeck', (s) => s.t >= T_CP0 - 1e-6 && s.t <= T_CP1 + 1e-6), C.deck, IN);
      B.matte(); B.grid(R('rim'), C.rubber, IN);
    }
    B.gloss();
    B.grid(rows('deck', (s) => s.t >= T_CP1 - 1e-6), C.deck, IN);                       // 前の甲板（白）
    B.grid(rows('deck', (s) => s.t <= T_CP0 + 1e-6), C.deck, IN);                       // 艇尾の甲板
    // 艇尾の板
    const s0 = S[0], ring = s0.bottom.concat([s0.sideP(0.5), s0.sideP(1)], s0.rim, s0.band, s0.deck.slice().reverse(), mirrorZ([s0.band.slice().reverse().concat(s0.rim.slice().reverse(), [s0.sideP(1), s0.sideP(0.5)])])[0]);
    const tc = [s0.x, (s0.yb + s0.yd) / 2, 0];
    for (let j = 0; j < ring.length; j++) B.tri(tc, ring[j], ring[(j + 1) % ring.length], C.transom, [s0.x + 1, tc[1], 0]);
    // --- 操縦席（船底の内側が床。前後は板の壁） ---
    const x0 = X(T_CP0), x1 = X(T_CP1), fy = CP_FLOOR, zi = CPZ, dq = (a, b, c, d, col, ins) => B.quad(a, b, c, d, col, ins);
    B.matte();
    dq([x0, fy, -zi], [x1, fy, -zi], [x1, fy, zi], [x0, fy, zi], C.mat, [0, -1, 0]);
    dq([x0, fy, -zi], [x0, fy, zi], [x0, deckSurf(T_CP0, zi), zi], [x0, deckSurf(T_CP0, zi), -zi], C.red, [x0 - 1, fy, 0]);
    dq([x1, fy, -zi], [x1, fy, zi], [x1, deckSurf(T_CP1, zi) + 0.02, zi], [x1, deckSurf(T_CP1, zi) + 0.02, -zi], C.wood, [x1 + 1, fy, 0]);
    // --- カウリング（白い FRP。前は低いくさび形の覆い、ハンドルの所から後ろは左右の側板。縁は黒いゴム） ---
    B.gloss();
    const np = low ? 4 : 8, tR = T_CP0 + 0.017, zo0 = zi + COWL_OUT, leanIn = 0.05;
    for (const sd of [-1, 1]) {
      const O = [[], []], Iw = [[], []], T = [[], []];
      for (let i = 0; i <= np; i++) {
        const t = lerp(tR, T_CP1, i / np), x = X(t), yt = panelTop(t), yd = deckSurf(t, zo0) - 0.01;
        O[0].push([x, yd, sd * zo0]); O[1].push([x + (i === 0 ? 0.06 : 0), yt, sd * (zo0 - leanIn)]);   // 外の面（平らな板。上は少し内へ寝る。後ろの切り口は斜め）
        Iw[0].push([x, fy, sd * zi]); Iw[1].push([x + (i === 0 ? 0.06 : 0), yt, sd * (zo0 - leanIn - 0.03)]); T[0].push(O[1][i]); T[1].push(Iw[1][i]);
      }
      B.gloss(); B.grid(O, C.cowl, [0, 0.3, 0]); B.matte(); B.grid(Iw, C.wood, [0, 0.3, sd * 2]); B.grid(T, C.rubber, [0, -1, 0]);
      B.gloss(); B.quad(Iw[0][0], O[0][0], O[1][0], Iw[1][0], C.cowl, [X(tR) + 1, 0.3, sd * zi]);                    // 後ろの切り口
      // 側板の外の絵: 後ろに艇番の札（枠の色の地）、真ん中に選手名、前に前向きの矢じり
      const face = (ta, tb, ya, yb2, lift) => { const pa = (t, y) => { const yd = deckSurf(t, zo0) - 0.01, k = clamp((y - yd) / Math.max(0.05, panelTop(t) - yd), 0, 1); return [X(t), y, sd * (zo0 - leanIn * k + lift)]; }; return [pa(ta, ya), pa(tb, ya), pa(tb, yb2), pa(ta, yb2)]; };
      const dT = (m) => m / LEN, tN0 = tR + dT(0.085), tN1 = tN0 + dT(0.29), yN0 = deckY(tN0) + 0.025, yN1 = yN0 + 0.255;
      const q = face(tN0, tN1, yN0, yN1, 0.005), uvN = sd > 0 ? [cellUV(cell, 0, 0), cellUV(cell, 1, 0), cellUV(cell, 1, 1), cellUV(cell, 0, 1)] : [cellUV(cell, 1, 0), cellUV(cell, 0, 0), cellUV(cell, 0, 1), cellUV(cell, 1, 1)];
      B.quad(q[0], q[1], q[2], q[3], C.white, [0, 0.3, 0], uvN[0], uvN[1], uvN[2], uvN[3]);
      const tM0 = tN1 + dT(0.04), tM1 = tM0 + dT(0.45), yM0 = deckY(tM0) + 0.07, yM1 = yM0 + 0.15, qm = face(tM0, tM1, yM0, yM1, 0.005);
      const uvM = sd > 0 ? [nameUV(cell, 0, 0), nameUV(cell, 1, 0), nameUV(cell, 1, 1), nameUV(cell, 0, 1)] : [nameUV(cell, 1, 0), nameUV(cell, 0, 0), nameUV(cell, 0, 1), nameUV(cell, 1, 1)];
      B.quad(qm[0], qm[1], qm[2], qm[3], C.white, [0, 0.3, 0], uvM[0], uvM[1], uvM[2], uvM[3]);
      { const tA0 = tM1 + dT(0.03), tA1 = T_CP1 - dT(0.01), yA = deckY(tA0) + 0.045, a0 = face(tA0, tA1, yA, yA + 0.15, 0.005), tip = [a0[1][0], (a0[1][1] + a0[2][1]) / 2, a0[1][2]], dx = (a0[1][0] - a0[0][0]) * 0.45, bk = (q2) => [q2[0] + dx, q2[1], q2[2]], mid = [a0[0][0] + dx * 0.9, tip[1], (a0[0][2] + a0[3][2]) / 2];
        B.quad(a0[0], bk(a0[0]), tip, mid, C.arrow, [0, 0.3, 0]); B.quad(a0[3], mid, tip, bk(a0[3]), C.arrow, [0, 0.3, 0]); }   // 前向きの矢じり（枠の色）
    }
    // 前の覆い: 後ろ（ハンドルの所）は角の丸い箱の断面、前へ行くほど低く細く、先は甲板に溶ける。後ろの口は黒いゴムの縁
    const nu = low ? 6 : 12, na = low ? 10 : 18, HP = [];
    const hoodP = (u, a) => { const t = lerp(T_HOOD, T_CP1, u), ez = lerp(0.8, 0.28, u), ey = lerp(0.75, 0.3, u), k = Math.max(0, Math.sin(a)), z = (cowlHalf(t) - leanIn * Math.pow(k, 2) * u) * (Math.cos(a) < 0 ? -1 : 1) * Math.pow(Math.abs(Math.cos(a)), ez); return [X(t), deckSurf(t, z) - 0.006 + cowlTop(t) * Math.pow(k, ey), z]; };
    for (let i = 0; i <= nu; i++) { const row = []; for (let j = 0; j <= na; j++) row.push(hoodP(i / nu, PI * j / na)); HP.push(row); }
    B.gloss(); B.grid(HP, C.cowl, [X(0.6), 0.1, 0]);
    const back = HP[nu], bc = [x1, deckSurf(T_CP1, 0) + 0.02, 0];
    B.matte(); for (let j = 0; j < na; j++) { const a = back[j], b = back[j + 1], k = 0.82, ia = [x1, bc[1] + (a[1] - bc[1]) * k, a[2] * k], ib = [x1, bc[1] + (b[1] - bc[1]) * k, b[2] * k]; B.quad(a, b, ib, ia, C.rubber, [x1 + 1, bc[1], 0]); B.tri(bc, ia, ib, C.dash, [x1 + 1, bc[1], 0]); }
    // 前の甲板の小さな艇番の札（真上・遠くからの見分け用。本物には無い。オーナーの決定で残す）
    B.gloss();
    { const t0 = T_HOOD + 0.02, t1 = t0 + 0.36 / LEN, hw = 0.18, P = []; for (let i = 0; i <= 2; i++) { const t = lerp(t0, t1, i / 2), row = []; for (let j = 0; j <= 2; j++) { const z = lerp(-hw, hw, j / 2); row.push([X(t), deckSurf(t, z) + 0.006, z]); } P.push(row); }
      B.grid(P, C.white, [X(t0), -2, 0], (p) => cellUV(cell, 0.5 + p[2] / (2 * hw), (p[0] - X(t0)) / (X(t1) - X(t0)))); }
    // ハンドル（黒い 3 本スポーク。木の台の上）とスロットルレバー（左の壁の黒いレバー）
    B.matte();
    B.add(new THREE.TorusGeometry(0.115, 0.013, low ? 4 : 5, low ? 8 : 16), WHEEL, { axis: [-0.25, 0.5, 0.9] }, null, C.rubber);
    if (!low) for (const a of [0.52, 2.62, 4.71]) B.limb(WHEEL, [WHEEL[0] + Math.sin(a) * 0.06 * 0, WHEEL[1] + Math.sin(a) * 0.105, WHEEL[2] + Math.cos(a) * 0.105], 0.012, 0.012, C.rubber, 4);
    B.add(new THREE.CylinderGeometry(0.035, 0.035, 0.03, low ? 6 : 10), [WHEEL[0] + 0.01, WHEEL[1], 0], [0, 0, PI / 2], null, C.rubber);
    B.add(new THREE.BoxGeometry(0.13, WHEEL[1] - fy - 0.03, 0.09), [WHEEL[0] + 0.07, (WHEEL[1] + fy) / 2 - 0.02, 0], [0, 0, -0.25], null, C.wood);          // 木の台
    B.limb([LEVER[0] + 0.02, fy + 0.1, LEVER[2] - 0.03], [LEVER[0], LEVER[1] + 0.05, LEVER[2]], 0.014, 0.012, C.rubber, 5);
    B.add(new THREE.BoxGeometry(0.1, 0.09, 0.03), [LEVER[0] + 0.02, fy + 0.13, LEVER[2] - 0.035], null, null, C.rubber);
    // --- モーター（ヤマト 331 型。写真 research/img3/wiki_engine.jpg・wiki_boat.jpg）: 本体は銀色のアルミ。上に銀の燃料タンク（赤いふた）、
    //     はずみ車のカバー、前に黒い吸気の箱とキャブレター、後ろに 2 気筒の頭、前へ出るステアリングバー（黒い握り）、銀の脚と平らな板、歯車箱、金色の 2 枚プロペラ ---
    const mx = X(0) - 0.14, sg = low ? 7 : 12, my = deckY(0);
    B.gloss();
    B.add(new THREE.BoxGeometry(0.2, 0.2, 0.2), [mx - 0.01, my + 0.2, 0], null, null, C.silver);                             // クランク室
    B.add(new THREE.BoxGeometry(0.11, 0.19, 0.17), [mx - 0.16, my + 0.2, 0], null, null, C.silver2);                         // 2 気筒のシリンダー（後ろ）
    B.add(new THREE.CylinderGeometry(0.12, 0.125, 0.05, sg), [mx - 0.01, my + 0.325, 0], null, null, C.silver);              // はずみ車のカバー
    B.add(new THREE.BoxGeometry(0.2, 0.13, 0.19), [mx - 0.05, my + 0.415, 0], null, null, C.silver);                         // 燃料タンク（上）
    B.add(new THREE.SphereGeometry(0.1, sg, low ? 4 : 6, 0, PI * 2, 0, PI / 2), [mx - 0.05, my + 0.478, 0], null, [1, 0.45, 0.95], C.silver);
    B.add(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), [mx - 0.1, my + 0.535, 0], null, null, C.red);                  // タンクの赤いふた
    B.matte();
    B.add(new THREE.BoxGeometry(0.13, 0.15, 0.22), [mx + 0.14, my + 0.16, 0], null, null, C.motor);                          // 吸気の箱（黒）
    B.add(new THREE.BoxGeometry(0.06, 0.07, 0.1), [mx + 0.09, my + 0.28, 0.06], null, null, C.motor2);                       // キャブレター
    if (!low) for (const z of [-0.045, 0.045]) { B.limb([mx - 0.215, my + 0.2, z], [mx - 0.25, my + 0.21, z], 0.011, 0.011, C.motor, 4); B.limb([mx - 0.25, my + 0.21, z], [mx - 0.08, my + 0.31, z * 2.2], 0.006, 0.006, C.motor, 3); }   // 点火プラグと線
    B.gloss();
    B.quad([mx - 0.14, my + 0.47, 0.1], [mx + 0.04, my + 0.47, 0.1], [mx + 0.04, my + 0.36, 0.1], [mx - 0.14, my + 0.36, 0.1], C.plate, [mx, my, 0]);   // モーター番号の白い札
    B.add(new THREE.BoxGeometry(0.15, 0.13, 0.2), [mx + 0.075, my + 0.01, 0], null, null, C.silver2);                        // 取り付け金具（艇尾の板をはさむ）
    B.add(new THREE.BoxGeometry(0.1, 0.36, 0.07), [mx - 0.02, my - 0.08, 0], null, [1, 1, 1], C.silver);                     // 脚（上）
    B.add(new THREE.BoxGeometry(0.2, 0.012, 0.13), [mx - 0.05, bottomY(0) - 0.035, 0], null, null, C.silver);                // 平らな板（空気を巻き込まないための板）
    B.add(new THREE.BoxGeometry(0.075, 0.13, 0.04), [mx - 0.03, bottomY(0) - 0.1, 0], null, null, C.silver);                 // 脚（下）
    B.add(new THREE.SphereGeometry(0.036, low ? 6 : 8, 5), [mx - 0.03, bottomY(0) - 0.17, 0], null, [3.2, 1, 1], C.silver); // 歯車箱
    B.add(new THREE.BoxGeometry(0.1, 0.07, 0.01), [mx - 0.01, bottomY(0) - 0.235, 0], null, null, C.silver);                 // ひれ
    B.add(new THREE.CylinderGeometry(0.0935, 0.0935, 0.008, low ? 6 : 10), [mx - 0.165, bottomY(0) - 0.17, 0], [0, 0, PI / 2], null, C.gold);   // プロペラ（直径 187mm・金色）
    B.limb([mx + 0.06, my + 0.09, 0.02], [X(T_CP0) + 0.02, my + 0.1, 0.17], 0.013, 0.013, C.silver, 5);                      // ステアリングバー（前へ出る棒）
    B.matte(); B.limb([X(T_CP0) + 0.02, my + 0.1, 0.17], [X(T_CP0) + 0.11, my + 0.105, 0.2], 0.019, 0.019, C.motor, 6, true);   // 黒い握り
    // 艇旗（舳先。枠の色の三角）
    const pt = 0.91, px = X(pt), py = deckSurf(pt, 0), fy1 = py + 0.33, fy0 = py + 0.15;
    B.limb([px, py - 0.01, 0], [px - 0.02, py + 0.35, 0], 0.008, 0.007, C.motor, 4);
    B.tri([px - 0.02, fy1, 0.003], [px - 0.012, fy0, 0.003], [px - 0.3, (fy0 + fy1) / 2 + 0.02, 0.003], C.flag, [px, fy0, -1]);
    B.tri([px - 0.02, fy1, -0.003], [px - 0.012, fy0, -0.003], [px - 0.3, (fy0 + fy1) / 2 + 0.02, -0.003], C.flag, [px, fy0, 1]);
    return B.build();
  }

  // ---------------- 選手（人の形。骨 16 本で動かす 1 枚の皮＝1 描画） ----------------
  /* 体つき: 身長 約 1.63m の細身（艇を大きめにしているので RS 倍）。胴は腰→腹→胸のなめらかな管（骨 3 本で曲げて背中を丸く）、
     腕・脚は「太さが場所で変わる管」＋関節に同じ太さの球（曲げても段差・つぶれが出ない）。ヘルメットは輪切りで作った卵形のフルフェイス。
     姿勢: 関節の場所を逆運動学で決める（ひざは床、左手はスロットルレバー、右手はハンドルから離れない）。
     絵: 選手ごとに 1 枚（勝負服の切り替え線・しわ・救命胴衣・艇番の白い札・ヘルメットの柄とシールド）。つやの絵と凹凸の絵は全員で共有。
     絵の割り付け（0〜1、上が v = 1）: 上半分＝胴（横 = 体のまわり: 右わき 0 → 前 0.25 → 左わき 0.5 → 背 0.75）、
     左下＝ヘルメット（横 = まわり: 前が 0.5、縦 = 下の縁 → てっぺん）、その右＝腕（肩 → 手首）、脚（腰 → 足首）、右端＝手袋・ブーツ・首 */
  const RS = 1.0;     // 等倍（競艇の選手は小柄: 身長 1.6m 台・52kg 前後）
  const BD = { hipZ: 0.085, hipY: -0.02, thigh: 0.4, shin: 0.39, lum: 0.1, chest: 0.26, neck: 0.5, shY: 0.412, shZ: 0.16, ua: 0.27, fa: 0.24, headUp: 0.124 };
  const BI = { P: 0, L: 1, C: 2, H: 3, UaL: 4, UaR: 5, FaL: 6, FaR: 7, HdL: 8, HdR: 9, ThL: 10, ThR: 11, ShL: 12, ShR: 13, FtL: 14, FtR: 15 };
  // 絵の中の四角（u0, u1, v の上端, v の下端）
  const TX = { torso: [0, 1, 1, 0.5], helmet: [0, 0.5, 0.5, 0], arm: [0.5, 0.72, 0.5, 0], leg: [0.72, 0.94, 0.5, 0], glove: [0.945, 0.995, 0.495, 0.385], boot: [0.945, 0.995, 0.375, 0.265], dark: [0.97, 0.97, 0.2, 0.2] };
  const TORSO_Y0 = -0.085, TORSO_H = 0.62, torsoT = (y) => (y - TORSO_Y0) / TORSO_H;
  const HELM = { lat0: -64, lat1: 90, vs: [0.31, 0.69], vt: [0.375, 0.575] };   // ヘルメットの縦の範囲（度）と、シールドの場所（絵の中で）

  function bindPositions() {
    const b = [], s = RS;
    b[BI.P] = [0, 0, 0]; b[BI.L] = [0, BD.lum, 0]; b[BI.C] = [0, BD.chest, 0]; b[BI.H] = [0, BD.neck, 0];
    [-1, 1].forEach((sd, k) => {
      b[BI.UaL + k] = [0, BD.shY, sd * BD.shZ]; b[BI.FaL + k] = [0, BD.shY - BD.ua, sd * BD.shZ]; b[BI.HdL + k] = [0, BD.shY - BD.ua - BD.fa, sd * BD.shZ];
      b[BI.ThL + k] = [0, BD.hipY, sd * BD.hipZ]; b[BI.ShL + k] = [0, BD.hipY - BD.thigh, sd * BD.hipZ]; b[BI.FtL + k] = [0, BD.hipY - BD.thigh - BD.shin, sd * BD.hipZ];
    });
    return b.map((p) => [p[0] * s, p[1] * s, p[2] * s]);
  }

  // 皮を貯める道具（位置・法線・絵の座標・骨の番号と重み）
  function RB() { this.p = []; this.n = []; this.u = []; this.si = []; this.sw = []; this.ix = []; }
  // 点の格子 P[行][列] をなめらかな面に。UV[行][列]、W(行, 列) → [骨, 重み, 骨, 重み]、cen(行) → その行の中心（面を外向きにそろえる）、wrap = 列が 1 周してつながる
  RB.prototype.surf = function (P, UV, W, cen, wrap) {
    const n = P.length, m = P[0].length, base = this.p.length / 3, N = [];
    for (let i = 0; i < n; i++) { N.push([]); const c = cen(i); for (let j = 0; j < m; j++) {
      const iu = Math.min(i + 1, n - 1), id = Math.max(i - 1, 0), jl = wrap ? (j === 0 ? m - 2 : j - 1) : Math.max(j - 1, 0), jr = wrap ? (j === m - 1 ? 1 : j + 1) : Math.min(j + 1, m - 1);
      const a0 = P[id][j], a1 = P[iu][j], b0 = P[i][jl], b1 = P[i][jr], p = P[i][j];
      const ax = a1[0] - a0[0], ay = a1[1] - a0[1], az = a1[2] - a0[2], bx = b1[0] - b0[0], by = b1[1] - b0[1], bz = b1[2] - b0[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz);
      const ox = p[0] - c[0], oy = p[1] - c[1], oz = p[2] - c[2];
      if (l < 1e-9) { nx = ox; ny = oy; nz = oz; l = Math.hypot(nx, ny, nz); if (l < 1e-9) { const c2 = cen(i === n - 1 ? i - 1 : i + 1); nx = c[0] - c2[0]; ny = c[1] - c2[1]; nz = c[2] - c2[2]; l = Math.hypot(nx, ny, nz) || 1; } }   // 極（点がつぶれた行）は 中心から外への向き
      else if (nx * ox + ny * oy + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      N[i].push([nx / l, ny / l, nz / l]);
    } }
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const p = P[i][j], q = N[i][j], w = W(i, j), uv = UV[i][j]; this.p.push(p[0], p[1], p[2]); this.n.push(q[0], q[1], q[2]); this.u.push(uv[0], uv[1]); this.si.push(w[0], w[2] || 0, 0, 0); this.sw.push(w[1], w[3] || 0, 0, 0); }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
      const a = [i, j], b = [i + 1, j], c = [i + 1, j + 1], d = [i, j + 1], id = (q) => base + q[0] * m + q[1];
      const tri = (q0, q1, q2) => {
        const A = P[q0[0]][q0[1]], B2 = P[q1[0]][q1[1]], C2 = P[q2[0]][q2[1]];
        const gx = (B2[1] - A[1]) * (C2[2] - A[2]) - (B2[2] - A[2]) * (C2[1] - A[1]), gy = (B2[2] - A[2]) * (C2[0] - A[0]) - (B2[0] - A[0]) * (C2[2] - A[2]), gz = (B2[0] - A[0]) * (C2[1] - A[1]) - (B2[1] - A[1]) * (C2[0] - A[0]);
        if (Math.hypot(gx, gy, gz) < 1e-12) return;
        const na = N[q0[0]][q0[1]], nb = N[q1[0]][q1[1]], nc = N[q2[0]][q2[1]];
        if (gx * (na[0] + nb[0] + nc[0]) + gy * (na[1] + nb[1] + nc[1]) + gz * (na[2] + nb[2] + nc[2]) < 0) this.ix.push(id(q0), id(q2), id(q1)); else this.ix.push(id(q0), id(q1), id(q2));
      };
      tri(a, b, c); tri(a, c, d);
    }
  };
  // 輪切りを並べた管。rings = [{ c 中心, X 前の軸, Z 右の軸, rx, rz 半径, v 絵の縦, w 骨と重み, e 角ばり（1 = だ円、小さいほど四角い） }]。rect = 絵の横の範囲
  RB.prototype.tube = function (rings, na, rect, mirror) {
    const P = [], UV = [], sp = (x, e) => (x < 0 ? -1 : 1) * Math.pow(Math.abs(x), e);
    for (const r of rings) { const row = [], uv = [], e = r.e || 1; for (let j = 0; j <= na; j++) {
      const a = (j % na) / na * PI * 2, sx = sp(Math.sin(a), e) * r.rx, sz = sp(Math.cos(a), e) * r.rz * (mirror ? -1 : 1);
      row.push([r.c[0] + r.X[0] * sx + r.Z[0] * sz, r.c[1] + r.X[1] * sx + r.Z[1] * sz, r.c[2] + r.X[2] * sx + r.Z[2] * sz]); uv.push([lerp(rect[0], rect[1], j / na), r.v]);
    } P.push(row); UV.push(uv); }
    this.surf(P, UV, (i) => rings[i].w, (i) => rings[i].c, true);
  };
  // 関節の球（管の端と同じ太さ。絵は 1 点の色）
  RB.prototype.ball = function (c, r, w, uv, nl, nt, scl) {
    const P = [], UV = []; scl = scl || [1, 1, 1];
    for (let i = 0; i <= nt; i++) { const la = -PI / 2 + PI * i / nt, row = [], u = []; for (let j = 0; j <= nl; j++) { const lo = (j % nl) / nl * PI * 2; row.push([c[0] + r * scl[0] * Math.cos(la) * Math.sin(lo), c[1] + r * scl[1] * Math.sin(la), c[2] + r * scl[2] * Math.cos(la) * Math.cos(lo)]); u.push(uv); } P.push(row); UV.push(u); }
    this.surf(P, UV, () => w, () => c, true);
  };
  RB.prototype.build = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.ix); g.computeBoundingSphere(); g.boundingSphere.radius = 3; return g;
  };

  // ヘルメットの表面（頭の中心からの向き → 半径）。lat = 上下の角度、lon = まわり（0 = 前、+ = 左）
  function helmetR(lat, lon) {
    const cl = Math.cos(lat), dx = cl * Math.cos(lon), dy = Math.sin(lat), dz = cl * Math.sin(lon), front = Math.max(0, Math.cos(lon)), back = Math.max(0, -Math.cos(lon));
    let r = 1 / Math.sqrt((dx / 0.142) * (dx / 0.142) + (dy / 0.134) * (dy / 0.134) + (dz / 0.119) * (dz / 0.119));
    const low = smooth(0.05, -0.75, lat);                                      // 下半分ほど 1
    r *= 1 + 0.13 * front * front * low;                                        // あごの覆いが前へ出る
    r *= 1 + 0.05 * back * smooth(0.9, 0.1, Math.abs(lat - 0.15));             // 後頭部のふくらみ
    r *= 1 - 0.05 * back * smooth(-0.5, -1.05, lat);                           // えり足はすぼまる
    r += 0.013 * Math.pow(back, 6) * smooth(0.25, 0.45, lat) * smooth(0.95, 0.6, lat);   // 後ろの小さなスポイラー
    r += 0.004 * smooth(0.5, 0.42, Math.abs(lat - 0.52)) * smooth(0.2, 0.6, front);      // シールドの上のひさしの段
    return r;
  }

  const riderGeo = { high: null, low: null };
  function buildRider(low) {
    const key = low ? 'low' : 'high'; if (riderGeo[key]) return riderGeo[key];
    const B = new RB(), s = RS, bp = bindPositions(), XA = [1, 0, 0], ZA = [0, 0, 1], YA = [0, 1, 0];
    const NA = low ? 8 : 16, NT = low ? 10 : 24, BL = low ? 6 : 12, BT2 = low ? 4 : 8, vOf = (rect, t) => lerp(rect[2], rect[3], t);
    // --- 胴（腰 → 腹 → 救命胴衣の胸 → 高いえり）。骨 3 本にまたがって重みをなめらかに ---
    const TR = [[-0.085, 0, 0.001, 0.001], [-0.074, 0, 0.066, 0.105], [-0.035, 0, 0.097, 0.148], [0.02, 0, 0.102, 0.153], [0.075, 0.002, 0.092, 0.137], [0.125, 0.004, 0.089, 0.132], [0.163, 0.004, 0.092, 0.136],
      [0.174, 0.004, 0.122, 0.165], [0.24, 0.004, 0.142, 0.182], [0.32, 0.004, 0.15, 0.19], [0.39, -0.004, 0.14, 0.18], [0.437, -0.012, 0.112, 0.152], [0.468, -0.008, 0.074, 0.092], [0.49, -0.004, 0.064, 0.071], [0.535, 0, 0.066, 0.069], [0.537, 0, 0.052, 0.055], [0.5, 0, 0.05, 0.052]];
    B.tube((low ? TR.filter((_, i) => i !== 2 && i !== 5 && i !== 8 && i !== 12) : TR).map((r) => {
      const y = r[0], s1 = smooth(0.03, 0.15, y), s2 = smooth(0.2, 0.32, y);
      return { c: [r[1] * s, y * s, 0], X: XA, Z: ZA, rx: r[2] * s, rz: r[3] * s, e: y > 0.17 && y < 0.45 ? 0.82 : 0.92, v: vOf(TX.torso, 1 - clamp(torsoT(y), 0, 1)), w: y < 0.18 ? [BI.P, 1 - s1, BI.L, s1] : [BI.L, 1 - s2, BI.C, s2] };
    }), NT, TX.torso);
    // --- 首（ヘルメットの下に少し見える） ---
    B.tube([[0.49, 0.046, 0], [0.54, 0.045, 0.5], [0.6, 0.047, 1]].map((r) => ({ c: [0, r[0] * s, 0], X: XA, Z: ZA, rx: r[1] * s, rz: r[1] * s, v: TX.dark[2], w: [BI.C, 1 - r[2], BI.H, r[2]] })), low ? 6 : 10, TX.dark);
    // --- 腕と脚（左 = −Z、右 = +Z。絵の合わせ目は体の内側に来るよう右を鏡にする） ---
    const limb = (bone, top, len, prof, rect, t0, t1, mirror, joint) => {   // prof = [[場所 0〜1, 半径, 前後のずれ]]
      B.tube(prof.map((q) => ({ c: [top[0] + (q[2] || 0) * s, top[1] - len * q[0], top[2]], X: XA, Z: ZA, rx: q[1] * s, rz: q[1] * s * (q[3] || 1), v: vOf(rect, lerp(t0, t1, q[0])), w: [bone, 1] })), NA, rect, mirror);
      if (joint) B.ball(top, prof[0][1] * s, [bone, 1], [lerp(rect[0], rect[1], 0.8), vOf(rect, t0 + 0.004)], BL, BT2);   // 球の色は 線の無い所から
    };
    const tE = BD.ua / (BD.ua + BD.fa), tK = BD.thigh / (BD.thigh + BD.shin) * 0.86;   // 絵の中の ひじ・ひざ の場所（脚の絵の下 14% はブーツ）
    [0, 1].forEach((k) => {
      const mir = k === 1;
      limb(BI.UaL + k, bp[BI.UaL + k], BD.ua * s, [[0, 0.07], [0.3, 0.069], [0.7, 0.062], [1, 0.056]], TX.arm, 0.02, tE, mir, true);
      if (k === 0) limb(BI.FaL, bp[BI.FaL], BD.fa * s, [[0, 0.058], [0.2, 0.062], [0.8, 0.056], [0.82, 0.045], [1, 0.039]], TX.boot, 0.1, 0.9, mir, true);   // 左腕だけ黒いアームプロテクター
      else limb(BI.FaL + k, bp[BI.FaL + k], BD.fa * s, [[0, 0.056], [0.25, 0.057], [0.7, 0.048], [1, 0.04]], TX.arm, tE, 0.98, mir, true);
      limb(BI.ThL + k, bp[BI.ThL + k], BD.thigh * s, [[0, 0.083], [0.3, 0.08], [0.7, 0.066], [1, 0.057]], TX.leg, 0.02, tK, mir, true);
      limb(BI.ShL + k, bp[BI.ShL + k], BD.shin * s, [[0, 0.057], [0.22, 0.06, -0.008], [0.5, 0.055, -0.006], [0.8, 0.046], [1, 0.044]], TX.leg, tK, 0.99, mir, true);
      // 手袋をした握りこぶし（少し角ばった形＋親指）
      const w = bp[BI.HdL + k], hb = [BI.HdL + k, 1], gv = (t) => vOf(TX.glove, t);
      B.tube([[0, 0.034, 0.034, 0], [0.018, 0.037, 0.04, 0.12], [0.045, 0.044, 0.046, 0.4], [0.078, 0.046, 0.045, 0.7], [0.1, 0.036, 0.04, 0.9], [0.11, 0.001, 0.001, 1]].map((q) => ({ c: [w[0] + (q[0] > 0.03 ? 0.006 * s : 0), w[1] - q[0] * s, w[2]], X: XA, Z: ZA, rx: q[1] * s, rz: q[2] * s, e: 0.72, v: gv(q[3]), w: hb })), low ? 6 : 10, TX.glove, mir);
      B.ball(w, 0.034 * s, hb, [0.97, gv(0.02)], low ? 6 : 8, low ? 3 : 5);
      if (!low) for (let i = 0; i < 4; i++) B.ball([w[0] + 0.036 * s, w[1] - (0.05 + 0.004 * (i === 0 || i === 3 ? 1 : 0)) * s, w[2] + (i - 1.5) * 0.021 * s], 0.0125 * s, hb, [0.97, gv(0.5)], 6, 4);   // 指の付け根の節
      B.ball([w[0] + 0.03 * s, w[1] - 0.05 * s, w[2] - (k ? 1 : -1) * 0.034 * s], 0.02 * s, hb, [0.97, gv(0.3)], low ? 5 : 8, low ? 3 : 5, [1.1, 1.7, 1]);
      // ブーツ（足首 → つま先。底は平ら）
      const f = bp[BI.FtL + k], fb = [BI.FtL + k, 1], bv = (t) => vOf(TX.boot, t);
      B.ball(f, 0.045 * s, fb, [0.97, bv(0.05)], BL, BT2);
      B.tube([[-0.062, 0.001, 0.001, -0.05, 0], [-0.058, 0.03, 0.03, -0.05, 0.05], [-0.03, 0.043, 0.042, -0.045, 0.2], [0.04, 0.042, 0.046, -0.05, 0.5], [0.11, 0.034, 0.05, -0.056, 0.75], [0.165, 0.026, 0.044, -0.063, 0.92], [0.19, 0.001, 0.001, -0.066, 1]].map((q) => ({ c: [f[0] + q[0] * s, f[1] + q[3] * s, f[2]], X: YA, Z: ZA, rx: q[1] * s, rz: q[2] * s, e: 0.8, v: bv(q[4]), w: fb })), low ? 6 : 10, TX.boot, mir);
    });
    // 肩の丸み（胸の骨）
    [0, 1].forEach((k) => B.ball(bp[BI.UaL + k], 0.074 * s, [BI.C, 1], [lerp(TX.arm[0], TX.arm[1], 0.8), vOf(TX.arm, 0.012)], BL, BT2, [1, 0.92, 1]));
    // カポック（救命胴衣）の大きなえり: 首の後ろから肩へかぶさる ふくらみ（枠の色）
    { const cu = [lerp(TX.torso[0], TX.torso[1], 0.03), vOf(TX.torso, 1 - 0.965)]; B.ball([-0.07 * s, 0.515 * s, 0], 0.1 * s, [BI.C, 1], cu, BL, BT2, [0.85, 0.82, 1.55]); B.ball([-0.02 * s, 0.5 * s, 0], 0.085 * s, [BI.C, 1], cu, BL, BT2, [1.1, 0.6, 1.75]); }
    // --- ヘルメット（フルフェイスの卵形。輪切り × まわり） ---
    const hc = [0.012 * s, (BD.neck + BD.headUp) * s, 0], nLat = low ? 9 : 22, nLon = low ? 12 : 32, HP = [], HU = [];
    for (let i = 0; i <= nLat; i++) {
      const t = i / nLat, lat = lerp(HELM.lat0, HELM.lat1, t) * DEG, row = [], uv = [];
      for (let j = 0; j <= nLon; j++) { const lon = ((j % nLon) / nLon - 0.5) * PI * 2, r = helmetR(lat, lon) * s * 1.07, cl = Math.cos(lat); row.push([hc[0] + r * cl * Math.cos(lon), hc[1] + r * Math.sin(lat), hc[2] - r * cl * Math.sin(lon)]); uv.push([lerp(TX.helmet[0], TX.helmet[1], j / nLon), vOf(TX.helmet, 1 - t)]); }
      HP.push(row); HU.push(uv);
    }
    // 下の縁を内へ丸めて、首の穴をふさぐ
    const rim = HP[0].map((p) => [hc[0] + (p[0] - hc[0]) * 0.86, p[1] - 0.012 * s, hc[2] + (p[2] - hc[2]) * 0.86]), hole = HP[0].map((p) => [hc[0] + (p[0] - hc[0]) * 0.45, p[1] + 0.006 * s, hc[2] + (p[2] - hc[2]) * 0.45]);
    const dk = HU[0].map(() => [TX.dark[0], TX.dark[2]]), rimUv = HU[0].map((q) => [q[0], vOf(TX.helmet, 0.995)]);
    B.surf(HP, HU, () => [BI.H, 1], () => hc, true);
    B.surf([hole, rim, HP[0]], [dk, rimUv, HU[0]], () => [BI.H, 1], (i) => [hc[0], hc[1] - (i === 0 ? 0.2 : 0.02) * s, hc[2]], true);
    return (riderGeo[key] = B.build());
  }

  // ---- 選手の絵 ----
  let riderSpec = null, riderBump = null;
  // しわ・縫い目・ベルト（色の絵には陰として、凹凸の絵には高さとして同じ線を引く）。g は 0〜1 の座標（y は下向き）
  function riderLines(g, mode) {
    const col = mode === 'bump', dark = (a) => (col ? 'rgba(40,40,40,' + a + ')' : 'rgba(0,0,0,' + a + ')'), lite = (a) => 'rgba(255,255,255,' + a + ')';
    const arc = (x0, y0, x1, y1, bend, w, a) => { g.lineWidth = w; g.lineCap = 'round'; g.strokeStyle = dark(a); g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + bend, x1, y1); g.stroke(); g.strokeStyle = lite(a * 0.7); g.beginPath(); g.moveTo(x0, y0 + w * 1.1); g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + bend + w * 1.1, x1, y1 + w * 1.1); g.stroke(); };
    const ty = (t) => (1 - t) * 0.5, K = col ? 1.6 : 1.35;
    // 腰のしわ（上着のすそ〜救命胴衣の下）
    for (let i = 0; i < 9; i++) { const x = (i * 0.113 + 0.03) % 1, t = 0.25 + ((i * 7) % 5) * 0.028; arc(x, ty(t), x + 0.085, ty(t + 0.012 * ((i % 3) - 1)), 0.008 * (i % 2 ? 1 : -1), 0.004, 0.2 * K); }
    // 腕: ひじのしわ（内側と外側）、肩と そで口の縫い目
    const ax = (u) => lerp(TX.arm[0], TX.arm[1], u), ay = (t) => 0.5 + 0.5 * t, tE = BD.ua / (BD.ua + BD.fa);
    for (let i = 0; i < 7; i++) { const dt = (i - 3) * 0.022 + (i > 2 ? 0.018 : -0.018), u0 = 0.06 + (i % 3) * 0.05; arc(ax(u0), ay(tE + dt), ax(u0 + 0.36), ay(tE + dt * 1.25), 0.006 * (i % 2 ? 1 : -1), 0.0035, 0.24 * K); if (i % 2) arc(ax(0.6), ay(tE + dt * 0.8), ax(0.9), ay(tE + dt), -0.004, 0.003, 0.16 * K); }
    arc(ax(0.02), ay(0.12), ax(0.98), ay(0.12), 0.012, 0.0028, 0.22 * K); arc(ax(0.02), ay(0.9), ax(0.98), ay(0.9), 0, 0.0028, 0.25 * K);
    // 脚: ひざのしわ（裏と横）、ひざ当ての縁
    const lx = (u) => lerp(TX.leg[0], TX.leg[1], u), tK = BD.thigh / (BD.thigh + BD.shin) * 0.86;
    for (let i = 0; i < 8; i++) { const dt = (i - 3.5) * 0.02 + (i > 3 ? 0.02 : -0.02); arc(lx(0.56), ay(tK + dt), lx(0.94), ay(tK + dt * 1.2), 0.005 * (i % 2 ? 1 : -1), 0.0035, 0.24 * K); if (i % 2) arc(lx(0.04), ay(tK + dt * 1.3), lx(0.2), ay(tK + dt * 1.5), 0.004, 0.003, 0.18 * K); }
    for (let i = 0; i < 4; i++) arc(lx(0.1 + i * 0.05), ay(0.05 + i * 0.012), lx(0.5 + i * 0.05), ay(0.085 + i * 0.02), 0.006, 0.0035, 0.2 * K);   // 脚の付け根
  }
  function ensureRiderShared() {
    if (riderSpec) return;
    // つやの強さ: 布はつやなし、札は少し、ヘルメットとシールドは強く、ブーツは少し
    const sv = document.createElement('canvas'); sv.width = sv.height = 128; const sg = sv.getContext('2d'); sg.scale(128, 128);
    sg.fillStyle = '#0d0d0d'; sg.fillRect(0, 0, 1, 1); sg.fillStyle = '#fff'; sg.fillRect(0, 0.5, 0.5, 0.5);
    sg.fillStyle = '#1c1c1c'; sg.fillRect(0.94, 0.5, 0.06, 0.12); sg.fillStyle = '#555'; sg.fillRect(0.94, 0.62, 0.06, 0.12); sg.fillStyle = '#444'; sg.fillRect(0.72, 0.5 + 0.5 * 0.86, 0.22, 0.07);
    riderSpec = new THREE.CanvasTexture(sv);
    // 凹凸（高さ）: しわ、救命胴衣の厚みの段、ベルト、札、シールドの縁、通気口
    const bv = document.createElement('canvas'); bv.width = bv.height = 512; const bg = bv.getContext('2d'); bg.scale(512, 512);
    bg.fillStyle = '#808080'; bg.fillRect(0, 0, 1, 1);
    const ty = (t) => (1 - t) * 0.5;
    bg.fillStyle = '#9a9a9a'; bg.fillRect(0, ty(0.9), 1, ty(0.41) - ty(0.9));                              // 救命胴衣（一段高い）
    bg.fillStyle = '#a8a8a8'; bg.fillRect(0.64, ty(0.815), 0.22, ty(0.46) - ty(0.815));   // 背中の札
    bg.fillStyle = '#909090'; bg.fillRect(0, ty(0.2), 1, 0.008);                                          // 腰の帯
    bg.fillStyle = '#929292'; bg.beginPath(); bg.ellipse(lerp(TX.leg[0], TX.leg[1], 0.25), 0.5 + 0.5 * 0.435, 0.03, 0.045, 0, 0, 7); bg.fill();   // ひざ当て
    riderLines(bg, 'bump');
    // ヘルメット: シールドは少しくぼむ、縁の溝、あごの通気口
    const hy = (t) => 0.5 + (1 - t) * 0.5, hx = (sx) => sx * 0.5;
    bg.strokeStyle = '#3c3c3c'; bg.lineWidth = 0.006; rr(bg, hx(HELM.vs[0]), hy(HELM.vt[1]), hx(HELM.vs[1]) - hx(HELM.vs[0]), hy(HELM.vt[0]) - hy(HELM.vt[1]), 0.022); bg.stroke();
    bg.fillStyle = '#404040'; [-0.045, 0, 0.045].forEach((d) => bg.fillRect(hx(0.5 + d) - 0.006, hy(0.25), 0.012, 0.012));
    try { const tmp = document.createElement('canvas'); tmp.width = tmp.height = 512; const tg = tmp.getContext('2d'); tg.filter = 'blur(1.2px)'; tg.drawImage(bv, 0, 0); bg.setTransform(1, 0, 0, 1, 0, 0); bg.drawImage(tmp, 0, 0); } catch (e) { /* ぼかしが無くても動く */ }
    riderBump = new THREE.CanvasTexture(bv);
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  const shade = (hex, k) => { const c = hexRGB(hex).map((v) => Math.round(clamp(k > 1 ? v + (1 - v) * (k - 1) : v * k, 0, 1) * 255)); return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; };
  // 選手 1 人ぶんの色の絵（勝負服・救命胴衣・艇番の札・ヘルメットの柄）
  function paintRider(h, low) {
    const N = low ? 512 : 1024, cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d'); g.scale(N, N);
    const lum = luma(h.color), white1 = lum > 0.85, black = lum < 0.2, inkDark = luma(h.ink) < 0.5;
    const suit = white1 ? '#eef0f4' : black ? '#191a1f' : h.color, vest = white1 ? '#f8f9fb' : black ? '#26282f' : shade(h.color, 1.12), deep = white1 ? '#c9d2e4' : black ? '#0d0e11' : shade(h.color, 0.72);
    const pipe = inkDark ? '#1b1c22' : '#f6f6f2', gold = '#e0b548', hsh = hashName(String(h.name || '')) + (h.no | 0) * 7, pants = ['#1d1f25', '#22305a', '#3a2a2a', '#1d1f25', '#2c3d4a', '#252525'][hsh % 6], bootC = '#111216', glove = ['#eceef2', '#16171b', '#c8323a', '#eceef2', '#16171b', '#2a4fa8'][(hsh >> 2) % 6];
    const ty = (t) => (1 - t) * 0.5, line = (x0, y0, x1, y1, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'butt'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    // ---- 胴 ----
    g.fillStyle = suit; g.fillRect(0, 0, 1, 0.5);
    g.fillStyle = pants; g.fillRect(0, ty(0.19), 1, 0.5 - ty(0.19));
    g.fillStyle = deep; g.fillRect(0, ty(0.2), 1, 0.009); line(0, ty(0.205), 1, ty(0.205), 0.0022, pipe);                        // 上着のすそ
    [0, 0.5, 1].forEach((x) => { g.fillStyle = ['#d8d8d8', '#e0b548', '#c8323a', '#ffffff', '#58a0d8', '#e0e0e0'][(hsh >> 1) % 6]; g.fillRect(x - 0.012, ty(0.185), 0.024, 0.5 - ty(0.185)); });   // ズボンのわきの線
    // 救命胴衣（胸と背が厚い。縁の縫い目、肩とわきのベルト、前のファスナー）
    g.fillStyle = vest; g.fillRect(0, ty(0.9), 1, ty(0.41) - ty(0.9));
    const gr = g.createLinearGradient(0, ty(0.9), 0, ty(0.41)); gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, white1 ? 'rgba(60,90,160,0.20)' : 'rgba(0,0,0,0.22)'); g.fillStyle = gr; g.fillRect(0, ty(0.9), 1, ty(0.41) - ty(0.9));
    [0.41, 0.9].forEach((t) => { line(0, ty(t), 1, ty(t), 0.005, deep); line(0, ty(t) + (t < 0.5 ? -0.006 : 0.006), 1, ty(t) + (t < 0.5 ? -0.006 : 0.006), 0.0018, pipe); });
    [0.125, 0.375, 0.6, 0.9].forEach((x) => line(x, ty(0.9), x, ty(0.41), 0.0022, deep));                                          // 胴衣の切り替え
    { const ao = g.createLinearGradient(0, 0, 1, 0), dk = white1 ? 'rgba(60,90,160,0.22)' : 'rgba(0,0,0,0.3)'; [0, 0.5, 1].forEach((x) => ao.addColorStop(x, dk)); [0.13, 0.37, 0.63, 0.87].forEach((x) => ao.addColorStop(x, 'rgba(0,0,0,0)')); g.fillStyle = ao; g.fillRect(0, 0, 1, 0.5); }   // わきの陰

    // 上着の白い柄（腕と胴に入る。写真の様子）と、背中の艇番
    g.fillStyle = white1 ? '#b9c6e2' : '#f4f4f0'; g.beginPath(); g.moveTo(0.16, ty(0.9)); g.lineTo(0.2, ty(0.9)); g.lineTo(0.12, ty(0.41)); g.lineTo(0.1, ty(0.41)); g.fill(); g.beginPath(); g.moveTo(0.34, ty(0.9)); g.lineTo(0.3, ty(0.9)); g.lineTo(0.38, ty(0.41)); g.lineTo(0.4, ty(0.41)); g.fill();
    const plate = (cx, t0, t1, w) => { const y = ty(t1), hh = ty(t0) - ty(t1); g.fillStyle = '#fbfbf8'; rr(g, cx - w / 2, y, w, hh, 0.008); g.fill(); g.strokeStyle = '#15161a'; g.lineWidth = 0.0028; g.stroke();
      g.fillStyle = '#121317'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.font = '900 ' + hh * 0.86 + 'px "Arial Black", "Helvetica Neue", Arial, sans-serif'; const m = g.measureText(String(h.no)), asc = m.actualBoundingBoxAscent || hh * 0.62; g.save(); g.translate(cx, y + hh / 2 + asc / 2); g.scale(Math.min(1, w * 0.8 / Math.max(m.width, 1e-6)) * 1.25, 1); g.fillText(String(h.no), 0, 0); g.restore(); };
    plate(0.75, 0.47, 0.81, 0.2);   // 番号は背中だけ（規程）
    // 高いえり
    g.fillStyle = suit; g.fillRect(0, 0, 1, ty(0.925)); line(0, ty(0.925), 1, ty(0.925), 0.003, deep); line(0, ty(0.985), 1, ty(0.985), 0.004, pipe);
    // ---- 腕 ----
    const ax = (u) => lerp(TX.arm[0], TX.arm[1], u), aw = TX.arm[1] - TX.arm[0], ay = (t) => 0.5 + 0.5 * t;
    g.fillStyle = suit; g.fillRect(TX.arm[0], 0.5, aw, 0.5);
    g.fillStyle = vest; g.fillRect(TX.arm[0], 0.5, aw, 0.06);                                                                     // 肩の当て布
    line(ax(0), ay(0.12), ax(1), ay(0.12), 0.003, deep);
    g.fillStyle = pipe; g.fillRect(ax(0.47), ay(0.12), aw * 0.06, 0.5 * 0.78); g.fillStyle = white1 ? '#9fb0d0' : gold; g.fillRect(ax(0.545), ay(0.12), aw * 0.018, 0.5 * 0.78);   // そでの外側の線
    { const ao = g.createLinearGradient(TX.arm[0], 0, TX.arm[1], 0), dk = white1 ? 'rgba(60,90,160,0.2)' : 'rgba(0,0,0,0.26)'; ao.addColorStop(0, dk); ao.addColorStop(0.3, 'rgba(0,0,0,0)'); ao.addColorStop(0.7, 'rgba(0,0,0,0)'); ao.addColorStop(1, dk); g.fillStyle = ao; g.fillRect(TX.arm[0], 0.5, aw, 0.5); }
    g.fillStyle = '#f4f4f0'; g.fillRect(ax(0.62), ay(0.2), aw * 0.2, 0.03); g.fillStyle = gold; g.fillRect(ax(0.62), ay(0.2) + 0.03, aw * 0.2, 0.006);   // そでの当て布
    g.fillStyle = deep; g.fillRect(TX.arm[0], ay(0.9), aw, 0.05); line(ax(0), ay(0.9), ax(1), ay(0.9), 0.003, pipe);              // そで口
    // ---- 脚 ----
    const lx = (u) => lerp(TX.leg[0], TX.leg[1], u), lw = TX.leg[1] - TX.leg[0];
    g.fillStyle = pants; g.fillRect(TX.leg[0], 0.5, lw, 0.5);
    g.fillStyle = ['#d8d8d8', '#e0b548', '#c8323a', '#ffffff', '#58a0d8', '#e0e0e0'][(hsh >> 1) % 6]; g.fillRect(lx(0.47), 0.5, lw * 0.06, 0.5 * 0.86);                                 // ズボンのわきの線
    g.fillStyle = '#2b2e36'; g.beginPath(); g.ellipse(lx(0.25), ay(0.435), lw * 0.15, 0.045, 0, 0, 7); g.fill(); g.strokeStyle = '#0c0d10'; g.lineWidth = 0.0025; g.stroke();   // ひざ当て
    g.fillStyle = bootC; g.fillRect(TX.leg[0], ay(0.86), lw, 0.07); line(lx(0), ay(0.86), lx(1), ay(0.86), 0.004, '#3a3d46'); line(lx(0), ay(0.9), lx(1), ay(0.9), 0.003, '#2a2c33');
    // しわの陰（1 号艇の白は青みの陰、2 号艇の黒は明るい線で形を出す）
    g.save(); g.globalCompositeOperation = 'source-over'; riderLines(g, 'color'); g.restore();
    if (black) { g.globalAlpha = 0.5; [0.125, 0.375, 0.6, 0.9].forEach((x) => line(x + 0.004, ty(0.9), x + 0.004, ty(0.41), 0.0016, '#b9bec8')); g.globalAlpha = 1; }
    if (white1) { g.fillStyle = 'rgba(70,100,170,0.10)'; g.fillRect(0, ty(0.41), 1, ty(0.2) - ty(0.41)); g.fillRect(TX.arm[0], ay(0.4), aw, 0.12); }
    // ---- 手袋・ブーツ・首 ----
    g.fillStyle = glove; g.fillRect(0.94, 0.5, 0.06, 0.12); g.strokeStyle = white1 || black ? '#8c93a3' : '#3c3f48'; g.lineWidth = 0.0016;
    for (let i = 0; i < 4; i++) { const x = 0.95 + i * 0.012; g.beginPath(); g.moveTo(x, 0.5 + 0.12 * 0.42); g.lineTo(x, 0.5 + 0.12 * 0.98); g.stroke(); }                 // 指の節
    line(0.94, 0.5 + 0.12 * 0.14, 1, 0.5 + 0.12 * 0.14, 0.004, pipe === glove ? '#30333b' : (inkDark ? '#2a2c33' : h.color));
    g.fillStyle = bootC; g.fillRect(0.94, 0.62, 0.06, 0.12); line(0.94, 0.62 + 0.12 * 0.3, 1, 0.62 + 0.12 * 0.3, 0.003, '#34373f');
    g.fillStyle = '#17181c'; g.fillRect(0.94, 0.74, 0.06, 0.26);
    // ---- ヘルメット（帽体は枠の色＋選手ごとの柄。前に横長の黒いシールド） ----
    const hx = (sx) => sx * 0.5, hy = (t) => 0.5 + (1 - t) * 0.5, HD = [['#f2f3f5', '#c8323a', '#1d2a6a'], ['#c9ccd2', '#16171b', '#e0b548'], ['#1b2452', '#f2f3f5', '#e0b548'], ['#e86a9a', '#f2f3f5', '#16171b'], ['#f08a1c', '#16171b', '#f2f3f5'], ['#2f8a56', '#f2e24a', '#16171b'], ['#6a3a9a', '#f2f3f5', '#e0b548'], ['#f2d53a', '#16171b', '#c8323a'], ['#16171b', '#c8323a', '#f2f3f5'], ['#3aa0d8', '#f2f3f5', '#1b2452']][(hsh >> 3) % 10];   // ヘルメットは選手ごとのデザイン（枠の色ではない）: 地・柄・線
    const shell = HD[0], st1 = HD[1], gold2 = HD[2];
    g.save(); g.beginPath(); g.rect(0, 0.5, 0.5, 0.5); g.clip();
    g.fillStyle = shell; g.fillRect(0, 0.5, 0.5, 0.5);
    const hg = g.createLinearGradient(0, hy(1), 0, hy(0)); hg.addColorStop(0, 'rgba(255,255,255,0.10)'); hg.addColorStop(0.6, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = hg; g.fillRect(0, 0.5, 0.5, 0.5);
    const band = (pts, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(hx(pts[0][0]), hy(pts[0][1])); for (let i = 1; i < pts.length; i += 2) g.quadraticCurveTo(hx(pts[i][0]), hy(pts[i][1]), hx(pts[i + 1][0]), hy(pts[i + 1][1])); g.stroke(); };
    const variant = hsh % 4;
    for (const sd of [-1, 1]) { const m = (s0) => 0.5 + sd * (s0 - 0.5);
      if (variant === 0) { band([[m(0.72), 0.82], [m(0.86), 0.62], [m(0.98), 0.36]], 0.03, st1); band([[m(0.7), 0.74], [m(0.84), 0.55], [m(0.97), 0.27]], 0.008, gold2); }
      else if (variant === 1) { band([[m(0.6), 0.99], [m(0.78), 0.72], [m(0.99), 0.66]], 0.024, st1); band([[m(0.64), 0.2], [m(0.8), 0.3], [m(0.99), 0.24]], 0.016, gold2); }
      else if (variant === 2) { band([[m(0.73), 0.3], [m(0.8), 0.7], [m(0.99), 0.8]], 0.02, st1); band([[m(0.77), 0.3], [m(0.84), 0.64], [m(0.99), 0.72]], 0.007, gold2); }
      else { band([[m(0.72), 0.6], [m(0.85), 0.66], [m(0.99), 0.6]], 0.034, st1); band([[m(0.72), 0.52], [m(0.85), 0.58], [m(0.99), 0.52]], 0.007, gold2); }
    }
    g.fillStyle = st1; g.fillRect(hx(0.5) - 0.011, hy(1), 0.022, hy(HELM.vt[1] + 0.05) - hy(1)); g.fillStyle = gold2; g.fillRect(hx(0.5) - 0.0155, hy(1), 0.003, hy(HELM.vt[1] + 0.05) - hy(1)); g.fillRect(hx(0.5) + 0.0125, hy(1), 0.003, hy(HELM.vt[1] + 0.05) - hy(1));   // てっぺんの筋
    // シールド（濃いスモーク。空の映り込みと光の点、上にひさしの線）
    const vx = hx(HELM.vs[0]), vw = hx(HELM.vs[1]) - vx, vy = hy(HELM.vt[1]), vh = hy(HELM.vt[0]) - vy;
    g.fillStyle = '#0b0c10'; rr(g, vx - 0.006, vy - 0.007, vw + 0.012, vh + 0.013, 0.026); g.fill();           // 縁（ひさし）
    const vg = g.createLinearGradient(0, vy, 0, vy + vh); vg.addColorStop(0, '#3c4c62'); vg.addColorStop(0.35, '#131a24'); vg.addColorStop(1, '#06080b'); g.fillStyle = vg; rr(g, vx, vy, vw, vh, 0.022); g.fill();
    g.save(); rr(g, vx, vy, vw, vh, 0.022); g.clip();
    g.fillStyle = 'rgba(190,215,240,0.22)'; g.beginPath(); g.moveTo(vx + vw * 0.08, vy); g.lineTo(vx + vw * 0.34, vy); g.lineTo(vx + vw * 0.2, vy + vh); g.lineTo(vx + vw * 0.02, vy + vh); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(vx + vw * 0.7, vy + vh * 0.27, vw * 0.035, vh * 0.07, -0.3, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.ellipse(vx + vw * 0.62, vy + vh * 0.3, vw * 0.09, vh * 0.05, -0.2, 0, 7); g.fill();
    g.restore();
    line(vx + 0.01, vy - 0.011, vx + vw - 0.01, vy - 0.011, 0.0025, 'rgba(255,255,255,0.35)');
    // あごの通気口、下の縁のゴム
    g.fillStyle = '#0a0b0e'; [-0.045, 0, 0.045].forEach((d) => { rr(g, hx(0.5 + d) - 0.006, hy(0.25), 0.012, 0.011, 0.003); g.fill(); });
    g.fillStyle = '#0d0e11'; g.fillRect(0, hy(0.035), 0.5, 0.5 - hy(0.035) + 0.5);
    g.restore();
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  }
  function hashName(s) { let x = 7; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x % 97; }

  // ---- 姿勢（艇の中の座標で、骨 1 本ずつの場所と向きを決める） ----
  const FLOOR = CP_FLOOR + 0.004;                                   // 操縦席の床
  const KNEE_X = X(0.42), KNEE_Y = FLOOR + 0.058 * RS, KNEE_Z = 0.17 * RS;     // ひざ（床につける。左右に開く）
  const WHEEL = [X(T_CP1) - 0.1, deckY(T_CP1) + 0.2, 0], LEVER = [X(0.47), CP_FLOOR + 0.36, -(CPZ - 0.05)];   // ハンドルの中心と、スロットルレバーの握り
  const V3 = () => new THREE.Vector3(), _a = V3(), _b = V3(), _c = V3(), _d = V3(), _x = V3(), _y = V3(), _z = V3(), _mb = new THREE.Matrix4(), _eu = new THREE.Euler(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  // 骨の向き: 骨の +Y を yDir へ、+X（体の前）をできるだけ xRef へ
  function aim(bone, yDir, xRef) {
    _y.copy(yDir).normalize(); _x.copy(xRef).addScaledVector(_y, -xRef.dot(_y));
    if (_x.lengthSq() < 1e-8) { _x.set(1, 0, 0).addScaledVector(_y, -_y.x); if (_x.lengthSq() < 1e-8) _x.set(0, 0, 1); }
    _x.normalize(); _z.crossVectors(_x, _y); _mb.makeBasis(_x, _y, _z); bone.quaternion.setFromRotationMatrix(_mb);
  }
  // 2 関節の逆運動学: 付け根 A・先 T・骨の長さ l1, l2・曲がる向き pole → 関節の場所 M（out）。先に届かないときは T を縮める
  function ik2(A, T, l1, l2, pole, M) {
    _d.subVectors(T, A); let L = _d.length(); const lo = Math.abs(l1 - l2) + 0.004, hi = l1 + l2 - 0.004; if (L < 1e-6) { _d.set(1, 0, 0); L = 1; }
    _d.multiplyScalar(1 / L); const Lc = clamp(L, lo, hi); if (Lc !== L) T.copy(A).addScaledVector(_d, Lc);
    const a = (l1 * l1 - l2 * l2 + Lc * Lc) / (2 * Lc), hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    _c.copy(pole).addScaledVector(_d, -pole.dot(_d)); if (_c.lengthSq() < 1e-8) _c.set(0, 1, 0); _c.normalize();
    M.copy(A).addScaledVector(_d, a).addScaledVector(_c, hh);
  }
  function makeRider(h, low) {
    ensureTextures(); ensureRiderShared();
    const tex = paintRider(h, low);
    const mat = low ? new THREE.MeshLambertMaterial({ map: tex })
      : new THREE.MeshPhongMaterial({ map: tex, specularMap: riderSpec, bumpMap: riderBump, bumpScale: 0.012, specular: new THREE.Color(0.07, 0.07, 0.07), shininess: 75, envMap: envTex, combine: THREE.MixOperation, reflectivity: 0.2 });
    const mesh = new THREE.SkinnedMesh(buildRider(low), mat), bp = bindPositions(), bones = bp.map((p, i) => { const b = new THREE.Bone(); b.position.set(p[0], p[1], p[2]); b.name = 'rb' + i; mesh.add(b); return b; });
    mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones)); mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = 'rider' + h.no;
    const s = RS, P = { pel: V3(), lum: V3(), che: V3(), nek: V3(), hip: [V3(), V3()], knee: [V3(), V3()], ank: [V3(), V3()], sho: [V3(), V3()], elb: [V3(), V3()], wri: [V3(), V3()] };
    const qP = new THREE.Quaternion(), qL = new THREE.Quaternion(), qC = new THREE.Quaternion(), qH = new THREE.Quaternion(), qF0 = [new THREE.Quaternion(), new THREE.Quaternion()], qF1 = new THREE.Quaternion(), pole = V3(), tmp = V3(), fwd = V3();
    // 正座の足: つま先は後ろ、足の甲は下（少し内へ）
    [-1, 1].forEach((sd, k) => { _x.set(-1, -0.12, sd * -0.18).normalize(); _y.set(-0.12, -1, 0); _y.addScaledVector(_x, -_y.dot(_x)).normalize(); _z.crossVectors(_x, _y); _mb.makeBasis(_x, _y, _z); qF0[k].setFromRotationMatrix(_mb); });
    const qF1L = new THREE.Quaternion();
    _x.set(0.8, 0, 0.6).normalize(); _y.set(0, 1, 0); _z.crossVectors(_x, _y); _mb.makeBasis(_x, _y, _z); qF1.setFromRotationMatrix(_mb);   // 旋回: 足の裏を床につけて立つ（右足は外向きに踏んばる）
    _x.set(1, 0, 0); _y.set(0, 1, 0); _z.set(0, 0, 1); _mb.makeBasis(_x, _y, _z); qF1L.setFromRotationMatrix(_mb);
    const l1 = BD.thigh * s, l2 = BD.shin * s, a1 = BD.ua * s, a2 = BD.fa * s;
    // v = 速さ 0〜1、tu = 立ち上がり 0〜1、bob = 上下のゆれ（m）、nod = 前後のゆれ（rad）、ls = 内への乗り出し 0〜1（省くと tu と同じ）
    // 実測（research/13）: 立つのは 0.4〜0.6 秒、内へ乗り出すのは旋回の間だけ、出口は立ったまま体を真ん中へ戻して腰を艇尾の上へ（舳先を浮かせる）、座るのも 0.4〜0.6 秒
    function pose(v, tu, bob, nod, ls) {
      if (ls == null) ls = tu; const ex = Math.max(0, tu - ls);                 // ex = 出口の「立ったまま後ろ」
      // 直線: 正座で上体を前へ伏せ、ヘルメットがカウリングのすぐ上。旋回（モンキーターン）: 立ち上がって腰を高く上げ、背中は水平に近い前傾、右足で艇の右を踏む
      const lean0 = lerp(lerp(12, 30, v), 66, tu) * DEG + nod, le1 = lerp(lerp(8, 15, v), 16, tu) * DEG, le2 = lerp(lerp(8, 15, v), 14, tu) * DEG;
      qP.setFromEuler(_eu.set(-26 * DEG * ls, 0.25 * ls, -lean0, 'YXZ'));      // 内へ倒す角度: 正面のコマ（科学する #1 6:16.2〜6:17.1）で上体が艇の左のふちの上まで出る
      qL.copy(qP).multiply(_q1.setFromEuler(_eu.set(-7 * DEG * ls, 0.05 * ls, -le1, 'YXZ')));
      qC.copy(qL).multiply(_q1.setFromEuler(_eu.set(-7 * DEG * ls, 0.08 * ls, -le2, 'YXZ')));
      // 腰の場所。正座: 高さを決め、ひざ（床に固定）から太ももの長さで前後を解く。旋回: 足の上に立ち上がる（腰は高く、少し左＝内へ）
      const py0 = FLOOR + lerp(0.228, 0.218, v) * s + bob;
      tmp.set(0, BD.hipY * s, -BD.hipZ * s).applyQuaternion(_q2.setFromEuler(_eu.set(0, 0, -lerp(12, 30, v) * DEG - nod, 'YXZ')));
      const dy = py0 + tmp.y - KNEE_Y, dz = tmp.z + KNEE_Z, px0 = KNEE_X - tmp.x - Math.sqrt(Math.max(0.0009, l1 * l1 - dy * dy - dz * dz));
      P.pel.set(lerp(px0, KNEE_X - 0.3 * s, tu) - 0.1 * s * ex, lerp(py0, FLOOR + 0.6 * s + bob, tu) + 0.04 * s * ex, -0.12 * ls * s);   // 出口で腰を後ろへ 10cm・上へ 4cm は仮（コマでは腰が艇尾の上まで来る）
      P.lum.set(0, BD.lum * s, 0).applyQuaternion(qP).add(P.pel); P.che.set(0, (BD.chest - BD.lum) * s, 0).applyQuaternion(qL).add(P.lum); P.nek.set(0, (BD.neck - BD.chest) * s, 0).applyQuaternion(qC).add(P.che);
      bones[BI.P].position.copy(P.pel); bones[BI.P].quaternion.copy(qP); bones[BI.L].position.copy(P.lum); bones[BI.L].quaternion.copy(qL); bones[BI.C].position.copy(P.che); bones[BI.C].quaternion.copy(qC);
      // 頭: 顔は進む先へ（旋回では内側を見る）。前かがみでも あごを上げて前を見る
      qH.setFromEuler(_eu.set(-0.1 * ls, 0.25 * ls + 0.45 * ls, -lerp(lerp(6, 16, v), 30, tu) * DEG, 'YXZ'));
      bones[BI.H].position.copy(P.nek); bones[BI.H].quaternion.copy(qH);
      // 脚（2 関節の逆運動学）。正座: すねは床に寝る。旋回: 足の裏で床を踏んで立つ（右足は右の壁ぎわ、左足は左の床）
      for (let k = 0; k < 2; k++) {
        const sd = k ? 1 : -1, ft = bones[BI.FtL + k];
        P.hip[k].set(0, BD.hipY * s, sd * BD.hipZ * s).applyQuaternion(qP).add(P.pel);
        const seizaK = tmp.set(KNEE_X, KNEE_Y, sd * KNEE_Z);
        P.ank[k].set(-0.985, -0.03, -sd * 0.115).normalize().multiplyScalar(l2).add(seizaK);
        pole.subVectors(seizaK, _a.addVectors(P.hip[k], P.ank[k]).multiplyScalar(0.5)).normalize();
        if (tu > 0.001) { _b.set(KNEE_X - (k ? 0.5 : 0.36) * s, FLOOR + 0.085 * s, k ? CPZ - 0.07 : -0.14); P.ank[k].lerp(_b, tu); pole.lerp(_b.set(0.9, 0.25, sd * 0.25), tu).normalize(); }
        ik2(P.hip[k], P.ank[k], l1, l2, pole, P.knee[k]); ft.quaternion.copy(qF0[k]).slerp(k ? qF1 : qF1L, tu);
        const th = bones[BI.ThL + k], sh = bones[BI.ShL + k], K = P.knee[k];
        th.position.copy(P.hip[k]); aim(th, _a.subVectors(P.hip[k], K), _b.subVectors(K, P.ank[k]));           // 太ももの前 = 足首と反対の向き
        sh.position.copy(K); aim(sh, _a.subVectors(K, P.ank[k]), _b.subVectors(K, P.hip[k]));                  // すねの前 = 腰と反対の向き
        ft.position.copy(P.ank[k]);
      }
      // 腕: 左手はスロットルレバー、右手はハンドルの右上を握る。ひじは下・外へ
      fwd.set(1, 0, 0).applyQuaternion(qC);
      for (let k = 0; k < 2; k++) {
        const sd = k ? 1 : -1, S = P.sho[k].set(0, (BD.shY - BD.chest) * s, sd * BD.shZ * s).applyQuaternion(qC).add(P.che), W = P.wri[k];
        if (k === 0) W.set(LEVER[0] - 0.02, LEVER[1] + 0.045 * s, LEVER[2] + 0.012); else W.set(WHEEL[0] - 0.04, WHEEL[1] + 0.085 + 0.04 * s, 0.09 - 0.12 * tu);
        pole.set(-0.35, -0.6, sd * 0.75); ik2(S, W, a1, a2, pole, P.elb[k]);
        const ua = bones[BI.UaL + k], fa = bones[BI.FaL + k], hd = bones[BI.HdL + k], E = P.elb[k];
        ua.position.copy(S); aim(ua, _a.subVectors(S, E), _b.subVectors(W, E));                                // 上腕の前 = 手首の側
        fa.position.copy(E); aim(fa, _a.subVectors(E, W), _b.subVectors(S, E).negate().add(_c.set(0, 0.6, 0)));
        hd.position.copy(W); aim(hd, k === 0 ? _a.set(0.25, 1, sd * 0.15) : _a.set(-0.5, 1, 0.1), k === 0 ? _b.set(1, 0, -0.3) : _b.set(1, 0.4, 0));   // こぶしは下向きに握る（指の背が前）
      }
    }
    pose(0, 0, 0, 0);
    return { mesh, pose, dispose() { tex.dispose(); mat.dispose(); } };
  }

  function palette(h) {
    const frame = lin(h.color), inkDark = luma(h.ink) < 0.5, veryDark = luma(h.color) < 0.2, white1 = luma(h.color) > 0.85;
    return {
      frame, ink: lin(inkDark ? '#16171c' : '#f7f7f7'), white: [1, 1, 1], deck: lin('#f3f2ec'), cockpit: lin('#a87a45'), rubber: lin('#141518'),
      side: lin('#e8891c'), side2: lin('#f1f0ea'), line: lin(white1 ? '#2a4fa8' : h.color), bottom: lin('#e58a1e'), transom: lin('#d98a2a'), wood: lin('#d9822a'),   // 舷の下と底は橙（ニスを塗った木）。舷の上は白と色の線
      cowl: lin(NAME_BG), cowlIn: lin('#d9d8d2'), hood: lin(NAME_BG), arrow: lin(white1 ? '#2a4fa8' : h.color), mat: lin('#1b1b1d'), dash: lin('#c8742a'), plate: lin('#f6f6f2'), gold: lin('#c9a23a'), red: lin('#c4261f'),   // カウリングは白（多くの場）。くさび模様だけ枠の色
      motor: lin('#141518'), motor2: lin('#2a2c31'), silver: lin('#c2c6cb'), silver2: lin('#9da2a8'), flag: frame,
      suit: frame, helmet: frame, visor: lin('#07090c'), glint: lin(veryDark ? '#e8f1fa' : '#c9dcee'), sleeve: veryDark ? lin('#f3f3f0') : frame, // 黒の 2 号艇は そでを白に（暗い水面で埋もれない）
      pants: lin(white1 ? '#f1f1ee' : '#1f2127'), boot: lin(white1 ? '#e9e9e6' : '#101114'), glove: lin(white1 || veryDark ? '#f3f3f0' : '#17181c'),
    };
  }

  function create(h, opts) {
    opts = opts || {};
    h = Object.assign({ no: 1 }, h); const def = COLORS[clamp((h.no | 0) - 1, 0, 5)];
    h.color = h.color || def.color; h.ink = h.ink || def.ink;
    let quality = opts.quality === 'low' ? 'low' : 'high', dead = false;
    ensureTextures(); users++; drawCell(h.no, h.color, h.ink); drawName(h.no, h.name);
    const C = palette(h);
    const root = new THREE.Object3D(); root.name = 'boat' + h.no;
    const rig = new THREE.Group();                 // 傾き・跳ね・転覆はここ（root の位置と向きは統合側の物）
    const hull = new THREE.Mesh(); let rider = null;   // rider = 選手（骨で動く 1 枚の皮）
    rig.add(hull); root.add(rig);
    function build() {
      const low = quality === 'low', mat = ensureMaterial(low);
      if (hull.geometry) hull.geometry.dispose();
      hull.geometry = buildHull(h.no, C, low); hull.material = mat; hull.castShadow = !low; hull.receiveShadow = false;   // 影は艇だけ（選手の影は艇の影に重なるので省く）
      if (rider) { rig.remove(rider.mesh); rider.dispose(); }
      rider = makeRider(h, low); rig.add(rider.mesh);
    }
    build();

    // なめらかに追いかける値（統合側の値が急に変わっても、形がカクッとしない）
    const cur = { speed: 0, turn: 0, init: false, raw: 0, acc: 0, stand: 0, hold: 0, exitM: 0 }, phase = (h.no * 1.37) % 6.28;
    /* st = { speed（m/s）, turn（0〜1）, flip, t }。あれば使う追加の項目: accel（前後の加速度 m/s²。減速がマイナス。無ければ speed の変化から求める）, slip（横すべり rad。内への乗り出しの強さに使う。無ければ turn から）
       動きの数字は research/13_旋回の減速と姿勢の実測.md（公式「ボートレースを科学する」#1・#2 の速度計つきの横からの映像を 0.1〜0.2 秒おきに見た）:
         舳先: 直線は 4〜6° 浮く → レバーを放すと 0.3〜0.5 秒でほぼ水平まで落ちる → 旋回中は 3〜5° → 出口（いちばん遅い所の直後。握り直して加速）で 8〜10° 浮く（ウィリー）→ 2〜3 秒かけて直線の角度へ
         傾き: 外側（右）の腹が 7〜9° 沈む（正面のコマ。目測 ±3°）。艇の上のカメラでも水平線は ±8° 以内
         選手: 0.4〜0.6 秒で立つ → 旋回の間は内へ乗り出す → 向きが変わり終わってから約 1.2 秒は立ったまま → 0.4〜0.6 秒で座る */
    function update(dt, st) {
      if (dead) return; st = st || {}; dt = Math.max(0, dt || 0);
      const sp = clamp(st.speed || 0, 0, 30), tn = clamp(st.turn || 0, 0, 1), fl = clamp(st.flip || 0, 0, 1), t = st.t || 0;
      if (!cur.init) { cur.speed = sp; cur.turn = tn; cur.raw = sp; cur.stand = tn > 0.06 ? 1 : 0; cur.init = true; }
      const k = 1 - Math.exp(-dt * 7); cur.speed += (sp - cur.speed) * k; cur.turn += (tn - cur.turn) * k;
      // 前後の加速度（m/s²）: もらえればそれを、無ければ速さの変化から。0.2 秒でならす
      const aRaw = st.accel != null && isFinite(st.accel) ? st.accel : (dt > 1e-4 ? (sp - cur.raw) / dt : 0); cur.raw = sp;
      cur.acc += (clamp(aRaw, -8, 8) - cur.acc) * (1 - Math.exp(-dt * 5));
      // 立つ・座る: 旋回が始まったら 0.45 秒で立つ。座るのは「いちばん遅い所を過ぎて加速が 0.9 秒続いた時」（実測: 底が 4.7〜4.9 秒、座り始めが 5.8 秒）か、旋回が終わって 1.2 秒たった時。0.5 秒で座る
      if (tn > 0.06) cur.hold = 1.2; else cur.hold = Math.max(0, cur.hold - dt);
      cur.up = cur.acc > 0.5 && tn < 0.6 ? (cur.up || 0) + dt : cur.acc < 0 || tn >= 0.6 ? 0 : (cur.up || 0);
      cur.stand = clamp(cur.stand + ((tn > 0.06 || cur.hold > 0) && !(cur.up > 0.9) ? dt / 0.45 : -dt / 0.5), 0, 1);
      cur.exitM = tn > cur.exitM ? cur.exitM + (tn - cur.exitM) * (1 - Math.exp(-dt * 6)) : cur.exitM * Math.exp(-dt / 1.3);   // 「いま旋回の出口か」の覚え（旋回のあと 1〜2 秒残る）
      const v = smooth(3, 19, cur.speed), tu = smooth(0, 1, cur.turn), f = fl, up = 1 - smooth(0, 0.35, f);
      const stand = smooth(0, 1, cur.stand), lean = Math.min(stand, st.slip != null && isFinite(st.slip) ? Math.max(tu, smooth(0, 0.6, Math.abs(st.slip))) : tu);
      // 艇: 波で小刻みに跳ね、ときどき水面をたたく。直線の左右の揺れは ±2〜3°・1 秒くらいの周期（尼崎の正面のコマ 2:34.9〜2:36.7。1 場面だけなので仮）
      const chop = Math.sin(t * 17 + phase) * 0.6 + Math.sin(t * 29.3 + phase * 2.1) * 0.4, slam = Math.pow(Math.max(0, Math.sin(t * 7.3 + phase * 3)), 6);
      const idle = (1 - v) * Math.sin(t * 1.9 + phase);                      // 止まっているときの ゆっくりした揺れ
      const drop = clamp(-cur.acc, 0, 4.5) * 1.0 * v;                        // レバーを放す（−4m/s² 前後）→ 舳先がほぼ水平へ。1m/s² あたり 1° は目測からの仮
      const wil = clamp(cur.acc, 0, 3) / 3 * Math.max(cur.exitM, 0.25 * (1 - v)) * 5;   // 出口で握り直す → 舳先が浮く（合わせて 8〜10°）。止まりからの起こしでも少し浮く（仮）
      const pitch = (v * 5.0 - drop + wil + (chop * 0.8 + slam * 1.6) * v * (1 - 0.5 * tu) + idle * 0.7) * DEG * up;
      const bank = (8 * tu + Math.sin(t * 5.7 + phase) * 2.0 * v * (1 - tu) + idle * 1.1) * DEG * up;   // 左旋回: 右（外側）の腹を水に沈める＝右へ傾き、左（内側）が浮く（公式辞典「サイド」、写真 wiki_turn_monkey3）
      const fe = f * f * (3 - 2 * f), roll = fe * PI;                         // 転覆: 外側（右）へ横倒し → 裏返し
      rig.rotation.set(bank + roll, 0, pitch);
      rig.position.y = (Math.sin(Math.max(0, pitch)) * 1.0 + 0.045 * v + Math.sin(Math.abs(bank)) * 0.5 + (chop * 0.02 + slam * 0.035) * v + idle * 0.012) * up + Math.sin(roll) * 0.42 + fe * (0.1 + Math.sin(t * 1.7 + phase) * 0.02);
      // 選手: 待機・直線は ひざ立ちで伏せる。旋回は立って内へ乗り出す（モンキーターン）。出口は立ったまま体を戻す
      rider.mesh.visible = f < 0.45;
      if (rider.mesh.visible) rider.pose(v, stand, (chop * 0.005 + slam * 0.012) * v + idle * 0.002, (chop * 0.01 + slam * 0.03) * v + idle * 0.008, lean);
    }
    update(0, { speed: 0, turn: 0, flip: 0, t: 0 });

    function setQuality(q) { q = q === 'low' ? 'low' : 'high'; if (q === quality || dead) return; quality = q; build(); }
    function dispose() {
      if (dead) return; dead = true;
      if (root.parent) root.parent.remove(root);
      if (hull.geometry) hull.geometry.dispose(); if (rider) rider.dispose();
      if (--users <= 0) { users = 0; [matHigh, matLow, matGlass, atlas, specTex, envTex, riderSpec, riderBump, riderGeo.high, riderGeo.low].forEach((o) => o && o.dispose()); matHigh = matLow = matGlass = atlas = specTex = envTex = riderSpec = riderBump = riderGeo.high = riderGeo.low = null; }
    }
    return { object3d: root, update, setQuality, dispose, no: h.no, get quality() { return quality; } };
  }

  return { create, COLORS, LEN, WIDTH: HW * 2 };
})();

/* 航跡と水しぶき。6 艇ぶんを 帯 1 描画＋しぶき 1 描画 で出す。
   形は本物の中継のコマに合わせた（research/13。尼崎 SG 優勝戦の 2 マーク・先頭の艇 yUebJkFlyJQ 2:28〜2:34 ほか）:
     直線: 艇の幅より細い白い筋。艇のすぐ後ろ 3 艇身だけ明るく、あとは薄い筋が長く残る。しぶきは低い（0.5〜1m）もやが後ろへ流れる
     旋回: 艇が横すべりしている間だけ、帯が 1〜1.5 艇身の幅のぼやけた白い帯になる（ふちは やわらかい）。1.5 秒ほど白く、3.5 秒過ぎまで灰色の筋で残る
           しぶきは すべっていく側（外側）の腹から上がり、その場に残るので艇の通った後ろ・外に 2〜2.5m の白い山ができる。向きを変えた 0.1〜0.3 秒後にはもう立つ
     出口: 握り直して加速する間、真後ろの白が濃くなる
   艇の「進んでいる向き」は list の x・z の動きから自分で求める（艇の向き hx・hz と違うぶんが横すべり）。どちらも半透明の白・depthWrite: false・水面の少し上。
   帯: 艇の真後ろの泡の帯（泡の模様。ふちがちぎれ、時間がたつと網目になって消える）＋ 艇の後ろで V 字に広がる 2 本の波の筋。
   しぶき: 細かい水滴（飛ぶ向きに伸びる）・薄い膜（大きく伸びた半透明）・霧（大きくやわらかい）の 3 種を混ぜる。
   opts: { quality: 'high'|'low', count: 艇の数（既定 6） }。update の list[i] が i 番目の艇。 */
BOAT.Wake = (function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const LIFE = 7.5, LIFE_V = 0.9, Y_RIBBON = 0.035, STERN = 1.5, G = 9.8; // LIFE = 泡の帯が残る秒数（全速で約 100m）、LIFE_V = V 字の筋

  /* 泡の絵（くり返し。横＝帯の幅の向き、縦＝進む向き）。本物の尼崎 1 周 1 マーク（ref/boat/frames/foam_ama1m_zoom.jpg、2:12.2〜2:13.4）を拡大して
     書き出した形に合わせた: 進路にそって細い白い筋が平行に何本も並び、筋の間は水が透ける。筋の中に横向きの細かい刻み、ところどころ切れる。網目の模様は無い。
     赤＝筋（横に 8 本。1 本の太さ・間隔・ゆれはばらつかせる）、緑＝ふちのちぎれ（進む向きに細かく変わる。外へ向かう ふさ）。
     数字は本物のコマの目測（艇の長さ 2.9m を物差し）: 筋 1 本の幅 0.3〜0.5m・間 1〜1.5m・刻み 約 0.5m おき【仮】 */
  function foamTexture(low) {
    const W = low ? 64 : 128, H = low ? 128 : 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data, TAU = 6.2832;
    const NS = 8, S = [];
    for (let k = 0; k < NS; k++) S.push({ c: (k + rnd(-0.3, 0.3)) / NS, w: rnd(0.018, 0.04), m: 1 + (k % 3), ph: Math.random() * TAU, am: rnd(0.006, 0.02),
      f1: 2 + (k % 4), f2: 5 + (k % 3), p1: Math.random() * TAU, p2: Math.random() * TAU, rp: Math.random() * TAU, pk: rnd(0.45, 1) });
    const RIP = low ? 24 : 48;                                                  // 刻みの数（縦 1 回り＝22m あたり）。low は絵が小さいので半分【仮】
    for (let y = 0; y < H; y++) {
      const v = y / H, tuft = 0.5 + 0.15 * Math.sin(TAU * (23 * v) + 1.3) + 0.2 * Math.sin(TAU * (41 * v) + 0.4) + 0.15 * Math.sin(TAU * (67 * v) + 2.2);   // ふさの間隔 約 0.3〜1m【仮】
      for (let x = 0; x < W; x++) {
        const u = x / W; let r = 0;
        for (let k = 0; k < NS; k++) {
          const q = S[k], cc = q.c + q.am * Math.sin(TAU * q.m * v + q.ph); let dx = Math.abs(u - cc); dx = Math.min(dx, 1 - dx);
          const brk = clamp(0.7 + 0.25 * Math.sin(TAU * q.f1 * v + q.p1) + 0.2 * Math.sin(TAU * q.f2 * v + q.p2), 0.3, 1);   // ところどころ切れる
          const rip = 0.9 + 0.1 * Math.sin(TAU * RIP * v + q.rp + dx * 40);                                                    // 横向きの刻み
          r = Math.max(r, Math.exp(-(dx * dx) / (2 * q.w * q.w)) * brk * rip * q.pk);
        }
        const o = (y * W + x) * 4; d[o] = Math.round(clamp(r, 0, 1) * 255); d[o + 1] = Math.round(clamp(tuft + 0.08 * Math.sin(TAU * 3 * u), 0, 1) * 255); d[o + 2] = 0; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  const TAIL = '\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}';

  function create(scene, opts) {
    opts = opts || {};
    const low = opts.quality === 'low', NB = opts.count || 6;
    const NC = low ? 50 : 100, NV = low ? 8 : 14, PER = NC + 2 * NV;     // 1 艇ぶんの節: 泡の帯 NC ＋ V 字の筋 NV × 2
    const MAXP = low ? 1200 : 6000, Q = low ? 0.3 : 1;                   // しぶきの粒の上限と、出す量
    /* 旋回の水の山の量（1 = 本物の実測どおり）。オーナー 2026-11-17「第 1 ターンマークあたりの水しぶきをもっと少なくして、全部の艇が見えるように」→ 既定 0.35。
       量と高さ・霧を下げる（直線の後ろのしぶきと航跡はそのまま）。wake.setTurnSpray(k) で変えられる */
    let TS = opts.turnSpray != null ? opts.turnSpray : 0.35;
    let dead = false;

    // ---- 帯 ----
    const NN = NB * PER, rPos = new Float32Array(NN * 2 * 3), rW = new Float32Array(NN * 2 * 3), rUv = new Float32Array(NN * 2 * 2), idx = [];
    const trails = [];
    for (let b = 0; b < NB; b++) {
      const mk = (n, base, kind, life) => { for (let i = 0; i < n - 1; i++) { const o = (base + i) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
        return { n, base, kind, life, step: life / (n - 2), w: new Float32Array(n), f: new Float32Array(n), x: new Float32Array(n), z: new Float32Array(n), nx: new Float32Array(n), nz: new Float32Array(n), drift0: kind === 0, vx: new Float32Array(n), vz: new Float32Array(n), age: new Float32Array(n).fill(99), k: new Float32Array(n), hw: new Float32Array(n), d: new Float32Array(n), on: false, timer: 0, dist: 0 }; };
      trails.push({ c: mk(NC, b * PER, 0, LIFE), l: mk(NV, b * PER + NC, 1, LIFE_V), r: mk(NV, b * PER + NC + NV, 1, LIFE_V), burst: 0, acc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], m: { has: false, x: 0, z: 0, sp: 0, sb: 0, a: 0, side: 1 } });
    }
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3).setUsage(THREE.DynamicDrawUsage));
    rGeo.setAttribute('wd', new THREE.BufferAttribute(rW, 3).setUsage(THREE.DynamicDrawUsage));       // 濃さ・年齢（0〜1）・種類（0 泡の帯, 1 V 字の筋）
    rGeo.setAttribute('uv', new THREE.BufferAttribute(rUv, 2).setUsage(THREE.DynamicDrawUsage));
    rGeo.setIndex(idx);
    const rTex = foamTexture(low);
    const rMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { map: { value: rTex } },
      vertexShader: 'attribute vec3 wd; varying vec2 vUv; varying vec3 vW;\nvoid main(){ vUv = uv; vW = wd; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      /* 泡の帯: vW.z = 0（直線の細い筋）〜0.4（旋回の広い泡）。絵を読むのは 1 回だけ（前と同じか軽い）。
         - 筋の数: 旋回は帯の中に 3〜4 本、直線は 2〜3 本（本物のコマの目測）。帯が時間で広がると、筋の間も開いて外へ流れて見える
         - 艇のすぐ後ろ（約 0.6 秒）は一面の白、そこから筋に分かれる。古いほど筋が細く・少なくなる（白 1.5 秒 → 灰色の筋。13 の資料）
         - ふち: 旋回の泡だけ、外へ向かう ふさのように ちぎれる */
      // V 字の筋（vW.z ≥ 0.5）: 本物は薄くつながった線（点線ではない）なので絵は読まない
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying vec3 vW;\nvoid main(){\n  float edge = 1.0 - abs(vUv.x * 2.0 - 1.0); float age = vW.y; float a;\n' +
        '  if (vW.z < 0.5) {\n    float f = clamp(vW.z * 2.5, 0.0, 1.0);\n    vec4 s = texture2D(map, vec2(vUv.x * mix(0.3, 0.65, f), vUv.y * 0.25));\n' +
        '    float soft = smoothstep(0.0, 0.5, edge) * mix(1.0, smoothstep(0.25, 0.75, s.g), (1.0 - smoothstep(0.05, 0.3, edge)) * f);\n' +
        '    float split = smoothstep(0.0, 0.08, age); float th = mix(0.04, 0.42, age);\n' +
        '    float st = smoothstep(th, th + 0.3, s.r);\n' +
        '    a = soft * mix(0.85 + 0.15 * s.r, 0.25 * (1.0 - age) + 0.75 * st, split) * vW.x;\n' +
        '  } else {\n    a = vW.x * smoothstep(0.0, 0.8, edge) * (1.0 - age) * 0.6;\n  }\n  if (a < 0.004) discard;\n  gl_FragColor = vec4(vec3(0.95, 0.975, 1.0), a);' + TAIL,
    });
    if ('forceSinglePass' in rMat) rMat.forceSinglePass = true;        // 両面でも 1 回で描く（描画の数を増やさない）
    const ribbon = new THREE.Mesh(rGeo, rMat); ribbon.frustumCulled = false; ribbon.renderOrder = 5; ribbon.name = 'boatWake';
    function shift(tr) { for (const a of [tr.x, tr.z, tr.nx, tr.nz, tr.vx, tr.vz, tr.age, tr.k, tr.d, tr.w, tr.f]) a.copyWithin(1, 0, tr.n - 1); }
    // 節の列を 1 コマ進める。0 番が先頭（艇に付いて動く）、後ろほど古い。emit = 出している、(px, pz) = 先頭の場所、(rx, rz) = 幅の向き、(vx, vz) = 節が流れる速さ
    function trailStep(tr, dt, emit, px, pz, rx, rz, kk, vx, vz, yy, w0, ff) {
      w0 = w0 || 0.4; ff = ff || 0;                                              // w0 = 出した時の半分の幅（m）、ff = 旋回の泡らしさ 0〜1
      const n = tr.n, fx = rz, fz = -rx;                                         // 進む向き（幅の向きに直角）
      for (let i = 0; i < n; i++) { tr.age[i] += dt; tr.x[i] += tr.vx[i] * dt; tr.z[i] += tr.vz[i] * dt; const dr = Math.exp(-1.1 * dt); tr.vx[i] *= dr; tr.vz[i] *= dr; }
      if (emit) {
        const jump = tr.on && Math.hypot(px - tr.x[0], pz - tr.z[0]) > 3.2;       // 急に飛んだ（置き直し）→ 前の帯とつながない
        if (!tr.on || jump) { tr.k[0] = 0; shift(tr); tr.x[0] = px; tr.z[0] = pz; tr.nx[0] = rx; tr.nz[0] = rz; tr.k[0] = 0; tr.age[0] = 0; tr.d[0] = tr.dist; tr.vx[0] = tr.vz[0] = 0; tr.w[0] = w0; tr.f[0] = ff; shift(tr); tr.on = true; tr.timer = 0; }
        else { tr.dist += Math.hypot(px - tr.x[0], pz - tr.z[0]); tr.timer += dt; if (tr.timer >= tr.step) { tr.timer = 0; shift(tr); } }
        tr.x[0] = px; tr.z[0] = pz; tr.nx[0] = rx; tr.nz[0] = rz; tr.k[0] = kk; tr.age[0] = 0; tr.d[0] = tr.dist; tr.vx[0] = vx; tr.vz[0] = vz; tr.w[0] = w0; tr.f[0] = ff;
        // 艇の場所が少し後ろへ戻ったとき、先頭より前に残った節は先頭へ寄せる（帯が折り返して三角に見えるのを防ぐ）
        if (tr.drift0) for (let i = 1; i < 6 && i < n; i++) { if ((tr.x[i] - px) * fx + (tr.z[i] - pz) * fz > 0) { tr.x[i] = px; tr.z[i] = pz; } }
        // 幅の向きは「実際に進んだ向き」に直角（艇が横すべりして向きと進路がずれても、帯がねじれない）
        const dx = px - tr.x[1], dz = pz - tr.z[1], dl = Math.hypot(dx, dz);
        if (tr.k[1] > 0 && dl > 0.2) { let ax = -dz / dl, az = dx / dl; if (ax * rx + az * rz < 0) { ax = -ax; az = -az; } tr.nx[0] = ax; tr.nz[0] = az; if (tr.timer === 0 || tr.age[1] < tr.step * 1.5) { tr.nx[1] = ax; tr.nz[1] = az; } }
      } else if (tr.on) { tr.on = false; tr.k[0] = 0; }
      // 1 回目: 節ごとの半分の幅
      for (let i = 0; i < n; i++) { const age = Math.min(tr.age[i], tr.life), ff2 = tr.f[i];
        tr.hw[i] = tr.kind === 0 ? tr.w[i] * (1 - 0.5 * ff2 * Math.exp(-age / 0.25)) + (0.07 + 0.2 * ff2) * age : 0.16 + 0.55 * age; }   // 中継のコマ: 直線は艇の幅より細い筋（半分の幅 0.4m → 7 秒で 0.9m）、旋回は 1〜1.5 艇身の幅
      // 2 回目: 向きと幅を前後の節とならして置く（泡の筋が節のつなぎ目で段に折れないように）
      for (let i = 0; i < n; i++) {
        const age = Math.min(tr.age[i], tr.life), u = age / tr.life, ff2 = tr.f[i];
        const i0 = i > 0 && tr.k[i - 1] > 0 ? i - 1 : i, i1 = i < n - 1 && tr.k[i + 1] > 0 ? i + 1 : i;
        let nx = tr.nx[i0] + 2 * tr.nx[i] + tr.nx[i1], nz = tr.nz[i0] + 2 * tr.nz[i] + tr.nz[i1]; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        const hw = tr.kind === 0 && i > 0 ? (tr.hw[i0] + 2 * tr.hw[i] + tr.hw[i1]) * 0.25 : tr.hw[i];
        // 濃さの時間変化: 直線は すぐ後ろ 0.5 秒（3 艇身）だけ明るく、あとは薄い筋。旋回の泡は 1.5 秒ほど白く、そのあと灰色で残る
        const fade = tr.kind === 0 ? ((1 - ff2) * (0.3 + 0.7 * Math.exp(-age / 0.45)) + ff2 * (0.4 + 0.6 * Math.exp(-age / 1.5))) * (1 - u * u) * (1 - 0.7 * ff2 * Math.exp(-age / 0.12)) : 1;   // 広い泡は艇の真下では まだ薄い（艇が通り過ぎてから白くなる）
        const k = tr.age[i] >= tr.life ? 0 : tr.k[i] * fade, kd = tr.kind === 0 ? 0.4 * ff2 : 1, o = (tr.base + i) * 2, o3 = o * 3, o2 = o * 2;
        rPos[o3] = tr.x[i] - nx * hw; rPos[o3 + 1] = yy; rPos[o3 + 2] = tr.z[i] - nz * hw;
        rPos[o3 + 3] = tr.x[i] + nx * hw; rPos[o3 + 4] = yy; rPos[o3 + 5] = tr.z[i] + nz * hw;
        rW[o3] = k; rW[o3 + 1] = u; rW[o3 + 2] = kd; rW[o3 + 3] = k; rW[o3 + 4] = u; rW[o3 + 5] = kd;
        const vv = tr.d[i] / 5.5; rUv[o2] = 0; rUv[o2 + 1] = vv; rUv[o2 + 2] = 1; rUv[o2 + 3] = vv;
      }
    }

    // ---- しぶき（いつもカメラを向く四角。1 粒 = 4 頂点。ax = 飛ぶ向きへの伸び） ----
    const pC = new Float32Array(MAXP * 4 * 3), pAx = new Float32Array(MAXP * 4 * 3), pSA = new Float32Array(MAXP * 4 * 2), pCorner = new Float32Array(MAXP * 4 * 2), pIdx = [];
    for (let i = 0; i < MAXP; i++) { pCorner.set([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], i * 8); const o = i * 4; pIdx.push(o, o + 1, o + 2, o, o + 2, o + 3); }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pC, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('ax', new THREE.BufferAttribute(pAx, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('sa', new THREE.BufferAttribute(pSA, 2).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('corner', new THREE.BufferAttribute(pCorner, 2));
    pGeo.setIndex(pIdx);
    const pMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute vec2 corner; attribute vec2 sa; attribute vec3 ax; varying vec2 vC; varying float vA;\nvoid main(){ vec4 c = modelViewMatrix * vec4(position, 1.0); vec4 tp = modelViewMatrix * vec4(position + ax, 1.0);\n  vec2 d = tp.xy - c.xy; float l = length(d); vec2 dir = l > 0.0005 ? d / l : vec2(1.0, 0.0);\n  c.xy += dir * corner.x * (sa.x + l) + vec2(-dir.y, dir.x) * corner.y * sa.x; vC = corner; vA = sa.y; gl_Position = projectionMatrix * c; }',
      fragmentShader: 'varying vec2 vC; varying float vA;\nvoid main(){ float d = length(vC) * 2.0; float s = 1.0 - smoothstep(0.0, 1.0, d); float a = vA * s * (0.55 + 0.45 * s); if (a < 0.004) discard;\n  gl_FragColor = vec4(vec3(0.95, 0.975, 1.0), a);' + TAIL,
    });
    const spray = new THREE.Mesh(pGeo, pMat); spray.frustumCulled = false; spray.renderOrder = 6; spray.name = 'boatSpray';
    scene.add(ribbon, spray);
    // 粒: 位置・速さ・年齢・寿命・大きさ（始め→終わり）・濃さ・伸び（秒）・重さ（1 = ふつうに落ちる、小さい = ただよう）
    const F = (fill) => { const a = new Float32Array(MAXP); if (fill) a.fill(fill); return a; };
    const P = { x: F(), y: F(), z: F(), vx: F(), vy: F(), vz: F(), age: F(1), life: F(), s0: F(), s1: F(), a: F(), st: F(), g: F() };
    let pNext = 0;
    function spawn(x, y, z, vx, vy, vz, life, s0, s1, a, st, g) { const i = pNext; pNext = (pNext + 1) % MAXP; P.x[i] = x; P.y[i] = y; P.z[i] = z; P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz; P.age[i] = 0; P.life[i] = life; P.s0[i] = s0; P.s1[i] = s1; P.a[i] = a; P.st[i] = st; P.g[i] = g; }
    // 3 種の粒
    const drop = (x, y, z, vx, vy, vz, life) => spawn(x, y, z, vx, vy, vz, life, rnd(0.025, 0.06), rnd(0.04, 0.1), rnd(0.75, 1), 0.035, 1);        // 細かい水滴（線に伸びる）
    const puff = (x, y, z, vx, vy, vz, life, s, a) => spawn(x, y, z, vx, vy, vz, life, s * 0.4, s, a, 0.02, 0.8);                                  // しぶきの本体（小さくやわらかい）
    const film = (x, y, z, vx, vy, vz, life, a) => spawn(x, y, z, vx, vy, vz, life, rnd(0.25, 0.4), rnd(0.7, 1.1), a, 0.11, 0.95);                 // 薄い膜（大きく伸びる）
    const mist = (x, y, z, vx, vy, vz, life, s, a) => spawn(x, y, z, vx, vy, vz, life, s * 0.35, s, a, 0, 0.2);                                    // 霧（ただよう）

    function update(dt, list) {
      if (dead) return; dt = clamp(dt || 0, 0, 0.1); list = list || [];
      for (let b = 0; b < NB; b++) {
        const T = trails[b], e = list[b], acc = T.acc;
        const sp = e ? e.speed || 0 : 0, tn = e ? clamp(e.turn || 0, 0, 1) : 0, fl = e ? e.flip || 0 : 0;
        const active = !!(e && e.on !== false);
        const rx = e ? -e.hz : 0, rz = e ? e.hx : 0, hx = e ? e.hx : 1, hz = e ? e.hz : 0;   // (rx, rz) = 艇の右（外側）
        // 転覆: 大きな水しぶきを 1 回だけ（倒れ始めと、裏返って水面をたたく時の 2 段）。その後は何も出さない
        if (active && ((fl > 0.12 && T.burst < 1) || (fl > 0.55 && T.burst < 2))) {
          const second = fl > 0.55 && T.burst === 1; T.burst = fl > 0.55 ? 2 : 1;
          const n = Math.round((second ? 110 : 170) * Q), fw = sp * 0.45;
          for (let i = 0; i < n; i++) {
            const a = Math.random() * 6.283, r = rnd(1, 6.5), x = e.x + Math.cos(a) * rnd(0, 1.4), z = e.z + Math.sin(a) * rnd(0, 1.4), vx = Math.cos(a) * r + hx * fw, vz = Math.sin(a) * r + hz * fw, kd = i % 6;
            if (kd === 0) mist(x, 0.3, z, vx * 0.5, rnd(2, 4.5), vz * 0.5, rnd(1.4, 2.2), rnd(2.2, 3.6), 0.2);
            else if (kd === 1) film(x, 0.1, z, vx, rnd(5, 9), vz, rnd(0.9, 1.3), 0.34);
            else drop(x, 0.1, z, vx, rnd(4, 11.5), vz, rnd(0.9, 1.7));
          }
        }
        if (!e || fl < 0.02) T.burst = 0;
        const emit = active && sp > 1.5 && fl < 0.12;
        // ---- 実際に進んでいる向き（ux, uz）・横すべり（sb = sin）・すべっていく側（side: +1 = 右）・前後の加速度（a） ----
        const M = T.m; let ux = hx, uz = hz, sinB = tn * 0.5, okMove = false;
        if (e && M.has && dt > 1e-4) { const dx = e.x - M.x, dz = e.z - M.z, d = Math.hypot(dx, dz); if (d > 0.02 && d < 3.2) { ux = dx / d; uz = dz / d; okMove = true; sinB = Math.min(1, Math.abs(hx * uz - hz * ux)); const sd = rx * ux + rz * uz; if (Math.abs(sd) > 0.06) M.side = sd > 0 ? 1 : -1; } }
        if (e) { const ar = M.has && dt > 1e-4 ? clamp((sp - M.sp) / dt, -8, 8) : 0; M.a += (ar - M.a) * Math.min(1, dt * 5); M.sb += ((emit ? sinB : 0) - M.sb) * Math.min(1, dt * (okMove ? 12 : 4)); M.x = e.x; M.z = e.z; M.sp = sp; M.has = true; } else { M.has = false; M.sb = 0; M.a = 0; }
        const side = M.side, band = clamp(M.sb / 0.7, 0, 1), lx = rx * side, lz = rz * side;        // band = 帯の広がり（横すべり 45° で最大）、(lx, lz) = すべっていく側
        // ---- 帯 ----
        const kk = clamp(sp / 12, 0, 1), yy = Y_RIBBON + b * 0.002, vOut = 2.4 + 0.07 * sp, kv = clamp((sp - 4) / 10, 0, 1) * 0.3 * (1 - band);
        const sb2 = STERN * (1 - 0.7 * band), sx = e ? e.x - hx * sb2 : 0, sz = e ? e.z - hz * sb2 : 0;   // 横すべり中は艇の真ん中あたりから（艇の全長で水をかく）
        trailStep(T.c, dt, emit, sx, sz, rx, rz, kk, 0, 0, yy, 0.4 + 1.75 * band, band);
        trailStep(T.l, dt, emit, sx + hx * 0.5 - rx * 0.6, sz + hz * 0.5 - rz * 0.6, rx, rz, kv, -rx * vOut, -rz * vOut, yy + 0.004);
        trailStep(T.r, dt, emit, sx + hx * 0.5 + rx * 0.6, sz + hz * 0.5 + rz * 0.6, rx, rz, kv, rx * vOut, rz * vOut, yy + 0.004);
        // ---- しぶきを出す ----
        if (emit) {
          const v01 = clamp((sp - 3) / 19, 0, 1), go = (k, rate) => { acc[k] += dt * Q * rate; let n = 0; while (acc[k] >= 1) { acc[k] -= 1; n++; } return n; };
          const ex = clamp(M.a / 2.5, 0, 1), rel = clamp((-M.a - 2) / 2.5, 0, 1);                    // ex = 握り直して加速中、rel = レバーを放して急に減速中
          const pw = clamp(M.sb / 0.25, 0, 1) * clamp(sp / 10, 0, 1);                                // 横すべり 15° でもう しぶきは立つ（向きを変えて 0.1〜0.3 秒）
          // 船外機の後ろのしぶき（直線の全速で 0.5〜1m。低いもやが後ろへ 20m ほど流れる）。出口の加速中は濃く・少し高く
          const rt = (1 - 0.5 * pw) * (1 + 1.6 * ex), rh = 1 + 0.6 * ex;
          for (let n = go(0, sp > 3 ? (18 + 5 * sp) * rt : 0); n > 0; n--) { const back = STERN + 0.2 + rnd(0, 0.5), sd = rnd(-0.14, 0.14), c = rnd(0.35, 0.7); puff(e.x - hx * back + rx * sd, 0.1, e.z - hz * back + rz * sd, ux * sp * c + rx * sd * 5, (1.2 + 2.6 * v01) * rh * rnd(0.3, 1), uz * sp * c + rz * sd * 5, rnd(0.4, 0.8), rnd(0.55, 1.15), 0.4); }
          for (let n = go(1, sp > 3 ? (20 + 6 * sp) * rt : 0); n > 0; n--) { const back = STERN + 0.2 + rnd(0, 0.4), sd = rnd(-0.16, 0.16), c = rnd(0.3, 0.75); drop(e.x - hx * back + rx * sd, 0.08, e.z - hz * back + rz * sd, ux * sp * c + rx * sd * 7, (1.4 + 3.0 * v01) * rh * rnd(0.3, 1), uz * sp * c + rz * sd * 7, rnd(0.3, 0.65)); }
          for (let n = go(2, sp > 5 ? 2.4 * sp * (1 + ex) : 0); n > 0; n--) { const back = STERN + 0.6 + rnd(0, 0.8), c = rnd(0.04, 0.14); mist(e.x - hx * back, 0.3, e.z - hz * back, ux * sp * c, rnd(0.4, 1.1) * (0.5 + 0.5 * v01), uz * sp * c, rnd(0.9, 1.4), rnd(0.8, 1.3), 0.3); }
          // 艇の両わきから低く飛ぶ水
          for (let n = go(6, sp > 5 ? 4.5 * sp : 0); n > 0; n--) { const sd = Math.random() < 0.5 ? -1 : 1, al = rnd(-1.4, 0.1), c = rnd(0.5, 0.8), o = rnd(1.2, 3.5); (n & 1 ? drop : (x, y, z, a, b2, c2, l) => puff(x, y, z, a, b2, c2, l, rnd(0.3, 0.6), 0.34))(e.x + hx * al + rx * sd * 0.72, 0.06, e.z + hz * al + rz * sd * 0.72, ux * sp * c + rx * sd * o, rnd(0.5, 2.0) * (0.4 + 0.6 * v01), uz * sp * c + rz * sd * o, rnd(0.22, 0.42)); }
          // レバーを放した時: 後ろの波が追いついて、船外機のまわりに白い水が盛り上がる（科学する #1 の渡邉 6:15.5〜6:15.9）
          for (let n = go(8, 70 * rel); n > 0; n--) { const sd = rnd(-0.6, 0.6); puff(e.x - hx * (STERN + rnd(-0.1, 0.5)) + rx * sd, 0.08, e.z - hz * (STERN + rnd(-0.1, 0.5)) + rz * sd, ux * sp * rnd(0.6, 0.9), rnd(0.8, 2.4), uz * sp * rnd(0.6, 0.9), rnd(0.35, 0.6), rnd(0.5, 0.9), 0.36); }
          // 旋回の水の山（すべっていく側の腹の全長から上がる。1 艇で高さ 2〜2.5m、粒の先は 3m。その場に残るので、艇の通った後ろ・外に 3〜5 艇身のびる）
          if (pw > 0.04) {
            const up = Math.sqrt(pw) * (0.55 + 0.45 * TS), ox = (al) => e.x + hx * al + lx * 0.6, oz = (al) => e.z + hz * al + lz * 0.6, AL0 = -1.6, AL1 = 0.3 + 0.7 * band;
            for (let n = go(3, 120 * pw * TS); n > 0; n--) { const al = rnd(AL0, AL1), out = rnd(0.3, 1.8), c = rnd(0.06, 0.2); film(ox(al), 0.1, oz(al), ux * sp * c + lx * out, rnd(3.6, 7.2) * up, uz * sp * c + lz * out, rnd(0.6, 0.95), 0.4); }
            for (let n = go(7, 280 * pw * TS); n > 0; n--) { const al = rnd(AL0, AL1), out = rnd(0.1, 1.8), c = rnd(0.04, 0.22); puff(ox(al), 0.1, oz(al), ux * sp * c + lx * out, rnd(2.2, 6.6) * up, uz * sp * c + lz * out, rnd(0.7, 1.2), rnd(0.8, 1.6), 0.58); }
            for (let n = go(4, 170 * pw * TS); n > 0; n--) { const al = rnd(AL0, AL1), out = rnd(0.2, 2.4), c = rnd(0.04, 0.26); drop(ox(al), 0.1, oz(al), ux * sp * c + lx * out, rnd(3, 7.6) * up, uz * sp * c + lz * out, rnd(0.7, 1.3)); }
            for (let n = go(5, 40 * pw * TS * TS); n > 0; n--) { const al = rnd(AL0, AL1), out = rnd(0.2, 1.4), c = rnd(0.03, 0.12); mist(ox(al) + lx * 0.2, 0.4, oz(al) + lz * 0.2, ux * sp * c + lx * out, rnd(1.6, 3.4) * up, uz * sp * c + lz * out, rnd(1.0, 1.6), rnd(1.4, 2.4), 0.2); } // 霧は艇を隠すので、量を TS の 2 乗で
          } else acc[3] = acc[4] = acc[5] = acc[7] = 0;
        }
      }
      // ---- 粒を進める ----
      const drag = Math.exp(-1.2 * dt);
      for (let i = 0; i < MAXP; i++) {
        let size = 0, al = 0, ax = 0, ay = 0, az = 0;
        if (P.age[i] < P.life[i]) {
          P.age[i] += dt; P.vy[i] -= G * P.g[i] * dt; P.vx[i] *= drag; P.vz[i] *= drag; if (P.g[i] < 0.5) P.vy[i] *= drag;
          P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
          if (P.y[i] < 0.03) { if (P.g[i] > 0.5) P.age[i] = P.life[i]; else { P.y[i] = 0.03; P.vy[i] = 0; } }   // 水滴は水面に落ちたら消える。霧は水面をはう
          const u = clamp(P.age[i] / P.life[i], 0, 1);
          if (u < 1) { size = P.s0[i] + (P.s1[i] - P.s0[i]) * Math.pow(u, 0.6); al = P.a[i] * Math.pow(1 - u, 1.1) * Math.min(1, u * 16); const st = P.st[i]; ax = P.vx[i] * st; ay = P.vy[i] * st; az = P.vz[i] * st; }
        }
        const o3 = i * 12, o2 = i * 8, x = P.x[i], y = P.y[i], z = P.z[i];
        for (let c = 0; c < 4; c++) { const q = o3 + c * 3; pC[q] = x; pC[q + 1] = y; pC[q + 2] = z; pAx[q] = ax; pAx[q + 1] = ay; pAx[q + 2] = az; pSA[o2 + c * 2] = size; pSA[o2 + c * 2 + 1] = al; }
      }
      rGeo.attributes.position.needsUpdate = true; rGeo.attributes.wd.needsUpdate = true; rGeo.attributes.uv.needsUpdate = true;
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.ax.needsUpdate = true; pGeo.attributes.sa.needsUpdate = true;
    }

    function reset() {
      for (const T of trails) { T.m.has = false; T.m.sb = 0; T.m.a = 0; for (const tr of [T.c, T.l, T.r]) { tr.age.fill(99); tr.k.fill(0); tr.vx.fill(0); tr.vz.fill(0); tr.on = false; tr.timer = 0; } T.burst = 0; T.acc.fill(0); }
      P.age.fill(1); P.life.fill(0); rW.fill(0); pSA.fill(0);
      rGeo.attributes.wd.needsUpdate = true; pGeo.attributes.sa.needsUpdate = true;
    }
    function dispose() { if (dead) return; dead = true; scene.remove(ribbon, spray); rGeo.dispose(); rMat.dispose(); rTex.dispose(); pGeo.dispose(); pMat.dispose(); }
    reset();
    return { update, reset, dispose, ribbon, spray, setTurnSpray(k) { TS = Math.max(0, Math.min(1, +k || 0)); }, get turnSpray() { return TS; } };
  }
  return { create };
})();
