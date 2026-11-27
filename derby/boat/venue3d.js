/* casa BOAT（競艇）: 会場（水面・競艇場・光と空）の 3D 部品。three.js r149（グローバル THREE）だけで作る。画像ファイルなし（模様と文字は全部 CanvasTexture とシェーダ）。
   2026-11-17 作り直し: 寸法・設備・色は調査の資料 ref/boat/research/03_競走水面の実寸と設備.md（告示・水上施設統一基準・公式の水面図）どおり。
     場所の数字は全部 BOAT.Course から取る（ななめの岸 shoreZ(x)/farZ(x)、水面の端 X_MIN/X_MAX、CLOCK・BUOY・POLES・BOARDS・PIT）。
     資料に寸法の無い物（スタンドの大きさ・防風ネットの高さ・照明・遠景）は「資料に無い」とコメントに書いてある。
   使い方:
     const venue = BOAT.Venue.build(scene, renderer, { quality: 'high' | 'low', hour });
     venue.update(dt, t, camera);   // 毎フレーム。水面の動き・観客のゆれ・影をカメラの近くへ追従
     venue.setClock(sec);           // 大時計の 12 秒針（黄だいだい）。sec = 発走までの残り秒（12 → 0 で 1 周して真上で 0）。null なら真上で止める
     venue.setClock60(sec);         // 大時計の 1 分針（白）。sec = 残り秒（60 → 0 で 1 周して真上で 0）。null なら真上。残り 15 秒からは遮蔽板に隠れる
     venue.setBoard(text);          // 対岸の大型映像装置の文字（\n で改行）
     venue.setTime(hour);           // 時間帯（0〜24 の小数。省くと 晴れた昼＝13 時。2026-11-28 オーナー「暗い・どよーんとしている」→ 今の時刻には合わせない。夕方・ナイターは hour を渡した時だけ）。昼 7〜15.5 時 / 夕方 15.5〜18.5 時（と明け方 5〜7 時）/ ナイター 18.5〜5 時。venue.timeOfDay = 'day' | 'dusk' | 'night'
     venue.setWeather({ windDir, windSpeed, wave });   // 風と波（レースごとに呼ぶ。呼ばなければ静かな水面＝風 1m・波 1cm）。水面の肌・旗・吹き流し・空中線の小旗が変わる
                                    //   windDir（度）＝風が吹いていく向き。公式サイトの矢印と同じで 0 ＝ 対岸へ・90 ＝ 追い風（1 マークへ）・180 ＝ スタンドへ・270 ＝ 向かい風。{ arrow: 1〜16（17 ＝ 無風）} でも渡せる
                                    //   windSpeed（m/s）、wave（波高 cm）。資料 11 の ③-1・③-3・⑤-3 のコマに合わせた段（2〜3m の水面・泡の筋の出はじめ・流れる速さは仮。setWeather の中のコメント）
     venue.weather                  // 今の値 { windDir, windSpeed, wave, arrow, label（追い風・向かい風・横風・無風）, tail（追い風の成分 −1〜+1）, dirX, dirZ（世界の向き）, stabilizer, look }
     venue.dispose();
     venue.PIT = { x, z, dirX, dirZ, gap, out: { x, z } }  // ピット: 1 号艇の位置 (x, z)、k 号艇は (x + dirX×gap×(k−1), z + dirZ×gap×(k−1))、out = 出ていく向き
     venue.sunDir（光の向き。ナイターは照明の向き）、venue.clock（大時計の中心と向き）、venue.stand（スタンドの屋根の場所。カメラを置く目安）
   座標: メートル、y が上、水面は y = 0。原点＝センターポール。スタンド側が +z。
   重さの工夫: 動かない物は「近くの物（影あり）」「遠くの物（影なし）」「絵を貼る物」「街」「照明の灯」のメッシュへまとめる。観客・木は InstancedMesh。影は 1 灯だけ（low は影なし）。
   注意: カメラの far は 2000 以上にする（空の球はカメラに付いて動くので far に関係なく映る）。 */
window.BOAT = window.BOAT || {};
BOAT.Venue = (function () {
  'use strict';
  const T = THREE, CO = BOAT.Course;
  const LAND_Y = 0.9;                       // 陸（護岸の上）の高さ。大時計の軸が水面から 2.5m 以内・標識板の下の端が 1m 以内に収まる低さ
  const FONT = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans CJK JP","Noto Sans JP",sans-serif';
  const BOAT_COLS = ['#f4f4f4', '#1a1a1a', '#e0282e', '#1f5fd0', '#f5d21a', '#1f9a48']; // 1〜6 号艇の色（白黒赤青黄緑）

  // ───────── 小さな道具 ─────────
  function srand(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  // 色: r149 の既定（legacyMode）では材質の色が変換されないので、sRGB の指定を自分でリニアへ直す
  const CC = {};
  function C(hex) { if (!CC[hex]) { const c = new T.Color(hex); if (!T.ColorManagement || T.ColorManagement.legacyMode !== false) c.convertSRGBToLinear(); CC[hex] = c; } return CC[hex]; }
  function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // ───────── まとめジオメトリ（頂点色つき。材質ごとに 1 メッシュへ） ─────────
  const BOX = new T.BoxGeometry(1, 1, 1).toNonIndexed(), PLANE = new T.PlaneGeometry(1, 1).toNonIndexed(), CIRCLE = new T.CircleGeometry(0.5, 40).toNonIndexed();
  const CYL = {};
  function cylGeo(rt, rb, seg) { const k = rt.toFixed(3) + '/' + rb.toFixed(3) + '/' + seg; return CYL[k] || (CYL[k] = new T.CylinderGeometry(rt, rb, 1, seg, 1).toNonIndexed()); }
  const _v = new T.Vector3(), _a = new T.Vector3(), _b = new T.Vector3(), _nm = new T.Matrix3(), _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(), _p = new T.Vector3(), _m2 = new T.Matrix4(), _t = new T.Vector3(), XAXIS = new T.Vector3(1, 0, 0);
  function Geo() { this.p = []; this.n = []; this.c = []; this.u = []; this.t = []; this.tf = null; }   // tf = 置き場所の枠（ななめの岸に合わせた向き）。入れておくと、足す物を全部その枠の中の座標として扱う
  // 形 g を行列 m で置いて足す。o.uv = [u0, v0, du, dv]（絵の中の場所）、o.tint（InstancedMesh の色を掛ける割合）、o.skip = [開始, 終了]（足さない頂点の範囲）、o.shade(y) 明るさ
  Geo.prototype.add = function (g, m, col, o) {
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, c = typeof col === 'string' ? C(col) : col;
    if (this.tf) m = _m2.multiplyMatrices(this.tf, m);
    _nm.getNormalMatrix(m);
    const r = o && o.uv, tint = (o && o.tint) || 0, s0 = o && o.skip ? o.skip[0] : -1, s1 = o && o.skip ? o.skip[1] : -1;
    for (let i = 0; i < P.count; i++) {
      if (i >= s0 && i < s1) continue;
      const k = o && o.shade ? o.shade(P.getY(i)) : 1;
      let cr = c.r, cg = c.g, cb = c.b;
      if (o && o.grad) { const c2 = C(o.grad[0]), t = Math.min(1, Math.max(0, (P.getY(i) - o.grad[1]) / (o.grad[2] - o.grad[1]))); cr += (c2.r - cr) * t; cg += (c2.g - cg) * t; cb += (c2.b - cb) * t; }
      _v.fromBufferAttribute(P, i).applyMatrix4(m); this.p.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize(); this.n.push(_v.x, _v.y, _v.z);
      this.c.push(cr * k, cg * k, cb * k);
      this.u.push(r ? r[0] + U.getX(i) * r[2] : 0, r ? r[1] + U.getY(i) * r[3] : 0);
      this.t.push(tint);
    }
  };
  function mat(x, y, z, sx, sy, sz, rx, ry, rz) { _e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); _q.setFromEuler(_e); return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); }
  // 箱（y0 = 底の高さ）
  Geo.prototype.box = function (x, y0, z, sx, h, sz, col, ry, o) { this.add(BOX, mat(x, y0 + h / 2, z, sx, h, sz, 0, ry), col, o); };
  // 箱（中心で指定。傾けられる）
  Geo.prototype.boxC = function (x, y, z, sx, sy, sz, col, rx, ry, rz) { this.add(BOX, mat(x, y, z, sx, sy, sz, rx, ry, rz), col); };
  // 2 点を結ぶ細い棒（線・ケーブル・筋交い）
  Geo.prototype.beam = function (ax, ay, az, bx, by, bz, th, col) {
    _a.set(bx - ax, by - ay, bz - az); const len = _a.length(); _q.setFromUnitVectors(XAXIS, _a.normalize());
    this.add(BOX, _m.compose(_p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(len, th, th)), col);
  };
  // 円柱・円すい台（y0 = 底）
  Geo.prototype.cyl = function (x, y0, z, rt, rb, h, seg, col, o) { this.add(cylGeo(rt, rb, seg), mat(x, y0 + h / 2, z, 1, h, 1), col, o); };
  // 三角形（法線は自動）
  Geo.prototype.tri = function (a, b, c, col, uv) {
    if (this.tf) { const f = this.tf, w = (q) => { _t.set(q[0], q[1], q[2]).applyMatrix4(f); return [_t.x, _t.y, _t.z]; }; a = w(a); b = w(b); c = w(c); }
    const k = typeof col === 'string' ? C(col) : col; _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]); _a.cross(_b).normalize();
    const qs = [a, b, c];
    for (let i = 0; i < 3; i++) { const q = qs[i]; this.p.push(q[0], q[1], q[2]); this.n.push(_a.x, _a.y, _a.z); this.c.push(k.r, k.g, k.b); this.u.push(uv ? uv[i][0] : 0, uv ? uv[i][1] : 0); this.t.push(0); }
  };
  Geo.prototype.quad = function (a, b, c, d, col, uv) { this.tri(a, b, c, col, uv && [uv[0], uv[1], uv[2]]); this.tri(a, c, d, col, uv && [uv[0], uv[2], uv[3]]); };
  // 水平な長方形（上向き）
  Geo.prototype.rect = function (x0, x1, z0, z1, y, col) { this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], col); };
  // 絵を貼る板（ry = 0 で +z 向き、Math.PI で −z 向き、−Math.PI/2 で −x 向き）
  Geo.prototype.sign = function (cx, cy, cz, w, h, ry, uv, col) { this.add(PLANE, mat(cx, cy, cz, w, h, 1, 0, ry), col || '#ffffff', { uv: uv }); };
  Geo.prototype.build = function (withUv, withTint) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    if (withUv) g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
    if (withTint) g.setAttribute('tint', new T.Float32BufferAttribute(this.t, 1));
    g.computeBoundingSphere(); return g;
  };

  // ───────── 絵（CanvasTexture） ─────────
  function fit(g, text, cx, cy, maxW, px, color, weight) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let s = px; s > 8; s -= 2) { g.font = (weight || '900') + ' ' + s + 'px ' + FONT; if (g.measureText(text).width <= maxW) break; }
    g.fillStyle = color; g.fillText(text, cx, cy);
  }
  // 窓・大時計の文字盤・ピットの番号板・標識板・信号灯・電光表示板を 1 枚にまとめた絵。R = 場所ごとの uv（[u0, v0, du, dv]）
  function makeAtlas() {
    const W = 1024, c = cv(W, W), g = c.getContext('2d'), R = {};
    const reg = (name, x, y, w, h) => { R[name] = [(x + 3) / W, 1 - (y + h - 3) / W, (w - 6) / W, (h - 6) / W]; return [x, y, w, h]; };
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, W);
    // 室内席のガラス（空の映り込みと窓枠）
    (function () {
      const [x, y, w, h] = reg('glass', 0, 0, 1024, 128), gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#7fb4dc'); gr.addColorStop(0.55, '#a9d0ea'); gr.addColorStop(1, '#5e8fb6');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      const r = srand(7); for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.05 + r() * 0.12) + ')'; g.fillRect(x + r() * w, y, 20 + r() * 60, h); }
      g.fillStyle = '#eef2f5'; for (let i = 0; i <= 32; i++) g.fillRect(x + i * 32 - 2, y, 4, h);
      g.fillRect(x, y + h / 2 - 2, w, 4); g.fillRect(x, y, w, 6); g.fillRect(x, y + h - 6, w, 6);
    })();
    // 大時計の文字盤（統一基準 第2・3条）: つや消しの黒。外周 30cm の帯に黄色い三角の目盛り 12 個（0・10・7・4・2 秒前は大きい）。白い「10」（2 時の所）と「5」（7 時の所）
    (function () {
      const [x, y, w] = reg('clock', 0, 128, 512, 512), cx = x + w / 2, cy = y + w / 2, r = w / 2 - 4, M = r / 1.5;   // M = 1m あたりの画素
      g.fillStyle = '#0b0b0b'; g.fillRect(x, y, w, w);
      g.strokeStyle = '#1d1d1d'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r - 0.3 * M, 0, 7); g.stroke();
      const big = { 0: 1, 2: 1, 5: 1, 8: 1, 10: 1 };
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2, len = (big[i] ? 0.30 : 0.22) * M, half = (big[i] ? 0.10 : 0.065) * M;
        g.save(); g.translate(cx, cy); g.rotate(a); g.fillStyle = '#ffdd00'; g.beginPath(); g.moveTo(-half, -r + 2); g.lineTo(half, -r + 2); g.lineTo(0, -r + 2 + len); g.fill(); g.restore();
      }
      const num = (s, i) => { const a = i / 12 * Math.PI * 2, rr = r - 0.56 * M; fit(g, s, cx + Math.sin(a) * rr, cy - Math.cos(a) * rr, 0.5 * M, 0.34 * M, '#ffffff'); };
      num('10', 2); num('5', 7);
    })();
    // ピットの番号板（1〜6 の枠の色）
    BOAT_COLS.forEach((col, i) => {
      const [x, y, w, h] = reg('pit' + i, 512 + (i % 3) * 128, 128 + Math.floor(i / 3) * 128, 128, 128);
      g.fillStyle = col; g.fillRect(x, y, w, h); fit(g, String(i + 1), x + w / 2, y + h / 2 + 4, w - 30, 96, (i === 0 || i === 4) ? '#111111' : '#ffffff');
    });
    // スタート・ゴール灯（白と紺の市松 16 マス。統一基準 図）
    (function () { const [x, y, w] = reg('checker', 896, 128, 128, 128), q = w / 4; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { g.fillStyle = (i + j) % 2 ? '#1c2f66' : '#f4f4f0'; g.fillRect(x + i * q, y + j * q, q, q); } })();
    // 標識板（統一基準 第7条）: 5 = 赤白のしま、85 = 右半分が青白のしま＋左半分に数字、45・100・150 = 白地に黒い数字
    (function () {
      let [x, y, w, h] = reg('b5', 896, 256, 128, 64); for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#f4f4f0' : '#e0282e'; g.fillRect(x, y + k * h / 5, w, h / 5 + 1); }
      [x, y, w, h] = reg('b85', 896, 320, 128, 64); g.fillStyle = '#f4f4f0'; g.fillRect(x, y, w, h); for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#f4f4f0' : '#1f5fd0'; g.fillRect(x + w / 2, y + k * h / 5, w / 2, h / 5 + 1); } fit(g, '85', x + w / 4, y + h / 2 + 2, w / 2 - 10, 44, '#111111');
      ['45', '100', '150'].forEach((s, i) => { const q = reg('b' + s, 512 + i * 96, 384, 96, 96); g.fillStyle = '#f4f4f0'; g.fillRect(q[0], q[1], q[2], q[3]); fit(g, s, q[0] + 48, q[1] + 50, 80, 60, '#111111'); });
    })();
    // 航走指示灯（白い矢印）と危険信号灯（上が黄・下が赤）
    (function () {
      let [x, y, w, h] = reg('arrow', 800, 384, 96, 96); g.fillStyle = '#101010'; g.fillRect(x, y, w, h); g.fillStyle = '#f4f4f0'; g.beginPath(); g.moveTo(x + 14, y + 48); g.lineTo(x + 46, y + 18); g.lineTo(x + 46, y + 36); g.lineTo(x + 82, y + 36); g.lineTo(x + 82, y + 60); g.lineTo(x + 46, y + 60); g.lineTo(x + 46, y + 78); g.fill();
      [x, y, w, h] = reg('danger', 896, 384, 96, 96); g.fillStyle = '#f2c400'; g.fillRect(x, y, w, h / 2); g.fillStyle = '#d9241c'; g.fillRect(x, y + h / 2, w, h / 2);
    })();
    // 対岸の電光表示板（消えているときの黒い面。細かいマス目だけ）
    (function () {
      const [x, y, w, h] = reg('odds', 0, 640, 1024, 140); g.fillStyle = '#0a0c10'; g.fillRect(x, y, w, h);
      g.strokeStyle = '#1c2026'; g.lineWidth = 2; for (let i = 0; i <= 11; i++) { g.beginPath(); g.moveTo(x + i * w / 11, y); g.lineTo(x + i * w / 11, y + h); g.stroke(); }
      for (let j = 0; j <= 4; j++) { g.beginPath(); g.moveTo(x, y + j * h / 4); g.lineTo(x + w, y + j * h / 4); g.stroke(); }
    })();
    const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
    return { tex, R };
  }
  // 空（上が天頂、下の端が地平線の少し下）。雲もここに描く。mode = 'day' | 'dusk' | 'night'、horizon = 地平線の色（＝霧の色）
  function skyTex(low, mode, sunU, sunV, horizon) {
    const W = low ? 1024 : 2048, H = low ? 256 : 512, c = cv(W, H), g = c.getContext('2d'), hz = H * 0.909; // hz = 地平線の高さ（球を 99°まで作るので 90/99）
    const night = mode === 'night', dusk = mode === 'dusk';
    const stops = night ? [[0, '#0a1838'], [0.55, '#132a5a'], [0.9, '#27407a'], [1, horizon]] : dusk ? [[0, '#2f6fc4'], [0.4, '#6ea6e0'], [0.7, '#f2cfae'], [0.9, '#ffc98a'], [1, horizon]] : [[0, '#1a72d6'], [0.45, '#3f98ea'], [0.8, '#84c4f4'], [1, horizon]];   // 2026-11-28: 3 つとも明るく・青をはっきり（ナイターも まっ黒でなく濃い青の空）
    const gr = g.createLinearGradient(0, 0, 0, hz); stops.forEach((q) => gr.addColorStop(q[0], q[1]));
    g.fillStyle = gr; g.fillRect(0, 0, W, hz + 1); g.fillStyle = horizon; g.fillRect(0, hz, W, H - hz);
    const r = srand(20261117), k = H / 512;
    if (night) {            // 星と、街あかりでぼんやり明るい地平線
      for (let i = 0; i < (low ? 160 : 420); i++) { const a = 0.25 + r() * 0.75; g.fillStyle = 'rgba(' + (215 + r() * 40 | 0) + ',' + (220 + r() * 35 | 0) + ',255,' + a.toFixed(2) + ')'; const sz = (r() < 0.12 ? 1.8 : 1.1) * k; g.fillRect(r() * W, r() * r() * hz * 0.92, sz, sz); }
      const cg = g.createLinearGradient(0, hz - H * 0.2, 0, hz); cg.addColorStop(0, 'rgba(70,74,96,0)'); cg.addColorStop(1, 'rgba(92,86,96,.55)'); g.fillStyle = cg; g.fillRect(0, hz - H * 0.2, W, H * 0.2);
    } else {                // 太陽のまわりの明るさ
      const sx = sunU * W, sy = sunV * H, rad = H * (dusk ? 0.85 : 0.5), sc = dusk ? ['rgba(255,244,214,1)', 'rgba(255,214,140,.75)', 'rgba(255,170,90,.22)', 'rgba(255,160,90,0)'] : ['rgba(255,255,245,.95)', 'rgba(255,255,235,.55)', 'rgba(255,255,255,.12)', 'rgba(255,255,255,0)'];
      for (const dx of [-W, 0, W]) { const sg = g.createRadialGradient(sx + dx, sy, 0, sx + dx, sy, rad); sg.addColorStop(0, sc[0]); sg.addColorStop(0.06, sc[1]); sg.addColorStop(0.3, sc[2]); sg.addColorStop(1, sc[3]); g.fillStyle = sg; g.fillRect(0, 0, W, H); }
    }
    // わた雲: 丸いぼかしを集めて作る（下は影の色）
    function puff(x, y, rad, col, al) { for (const dx of [-W, 0, W]) { const pg = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad); pg.addColorStop(0, col + (0.9 * al) + ')'); pg.addColorStop(0.55, col + (0.5 * al) + ')'); pg.addColorStop(1, col + '0)'); g.fillStyle = pg; g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2); } }
    const n = night ? 6 : low ? 10 : 13, lit = night ? 'rgba(70,90,140,' : dusk ? 'rgba(255,232,204,' : 'rgba(255,255,255,', shade = night ? 'rgba(32,44,84,' : dusk ? 'rgba(190,160,170,' : 'rgba(206,224,242,', al = night ? 0.7 : 1;
    for (let i = 0; i < n; i++) {
      const cx = (i + r() * 0.8) / n * W, el = 0.08 + r() * r() * 0.5, cy = hz - el * hz * 0.72, size = (16 + r() * 30) * k * (0.5 + el), wide = 2.2 + r() * 2.2, m = 9 + Math.floor(r() * 9);
      for (let j = 0; j < m; j++) puff(cx + (r() - 0.5) * size * wide * 2, cy + size * 0.22 + r() * size * 0.12, size * (0.5 + r() * 0.4), shade, al);
      for (let j = 0; j < m * 2; j++) { const u = r() - 0.5; puff(cx + u * size * wide * 2, cy - (0.5 - Math.abs(u)) * size * (0.4 + r() * 0.7), size * (0.35 + r() * 0.5), lit, al); }
    }
    // 地平線のかすみ
    const hc = new T.Color(horizon), rgb = (hc.r * 255 | 0) + ',' + (hc.g * 255 | 0) + ',' + (hc.b * 255 | 0);
    const hg = g.createLinearGradient(0, hz - H * 0.12, 0, hz); hg.addColorStop(0, 'rgba(' + rgb + ',0)'); hg.addColorStop(1, 'rgba(' + rgb + ',1)'); g.fillStyle = hg; g.fillRect(0, hz - H * 0.12, W, H * 0.12 + 1);
    const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding; tex.wrapS = T.RepeatWrapping; tex.generateMipmaps = false; tex.minFilter = T.LinearFilter;
    return tex;
  }
  // コンクリートの汚れと目地（灰色の濃淡。近くの物の色に掛ける）
  function detailTex() {
    const N = 256, c = cv(N, N), g = c.getContext('2d'), r = srand(77), img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const v = 128 + (r() - 0.5) * 46; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 46; i++) { const x = r() * N, y = r() * N, rad = 10 + r() * 46, d = r() < 0.6; for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) { const pg = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad); pg.addColorStop(0, d ? 'rgba(60,58,52,.20)' : 'rgba(225,225,220,.16)'); pg.addColorStop(1, d ? 'rgba(60,58,52,0)' : 'rgba(225,225,220,0)'); g.fillStyle = pg; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2); } }
    for (let i = 0; i < 26; i++) { const x = r() * N, y = r() * N, len = 30 + r() * 90; const sg = g.createLinearGradient(0, y, 0, y + len); sg.addColorStop(0, 'rgba(50,48,44,.22)'); sg.addColorStop(1, 'rgba(50,48,44,0)'); g.fillStyle = sg; g.fillRect(x, y, 1.5 + r() * 3, len); } // 雨だれ
    g.fillStyle = 'rgba(40,40,38,.55)'; for (const q of [0, 128]) { g.fillRect(q, 0, 1.6, N); g.fillRect(0, q, N, 1.6); }   // 目地
    const tex = new T.CanvasTexture(c); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.anisotropy = 4; return tex;
  }
  // 街の建物の窓（8×8 マス。昼の絵と、夜に光る窓の絵）
  function cityTex() {
    const N = 256, S = 32, day = cv(N, N), ngt = cv(N, N), g = day.getContext('2d'), h = ngt.getContext('2d'), r = srand(909);
    g.fillStyle = '#eceae4'; g.fillRect(0, 0, N, N); h.fillStyle = '#000000'; h.fillRect(0, 0, N, N);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const x = i * S + 5, y = j * S + 7, w = S - 10, hh = S - 15, v = 138 + r() * 50;
      g.fillStyle = 'rgb(' + (v * 0.72 | 0) + ',' + (v * 0.86 | 0) + ',' + (v | 0) + ')'; g.fillRect(x, y, w, hh);
      g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x, y, w, 3); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + w / 2 - 0.6, y, 1.2, hh); g.fillStyle = '#c9c7c0'; g.fillRect(x - 2, y + hh, w + 4, 2);
      const lit = r(); h.fillStyle = lit < 0.24 ? 'rgb(255,' + (196 + r() * 40 | 0) + ',' + (120 + r() * 60 | 0) + ')' : lit < 0.33 ? 'rgb(214,228,255)' : lit < 0.5 ? '#2a2618' : '#05070a'; h.fillRect(x, y, w, hh);
    }
    const mk = (cvs) => { const t = new T.CanvasTexture(cvs); t.encoding = T.sRGBEncoding; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; return t; };
    return { day: mk(day), night: mk(ngt) };
  }
  // 灯のにじみ（丸いぼかし）
  function glowTex() {
    const c = cv(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,.85)'); gr.addColorStop(0.35, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c);
  }
  // 水面の波の傾き（つなぎ目なし）。r, g = x, z 方向の傾き、b = 高さ
  function waveTex(low) {
    const N = low ? 128 : 256, c = cv(N, N), g = c.getContext('2d'), img = g.createImageData(N, N), r = srand(4242), ws = [];
    for (let i = 0; i < 16; i++) { const a = r() * Math.PI * 2, k = 2 + r() * 8, kx = Math.round(Math.cos(a) * k), kz = Math.round(Math.sin(a) * k); if (!kx && !kz) continue; ws.push([kx, kz, r() * 6.283, 1 / Math.hypot(kx, kz)]); }
    const dx = new Float32Array(N * N), dz = new Float32Array(N * N), hh = new Float32Array(N * N); let mx = 1e-6, mh = 1e-6;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let a = 0, b = 0, h = 0;
      for (const w of ws) { const ph = (w[0] * x + w[1] * y) / N * 6.283185 + w[2], co = Math.cos(ph) * w[3]; a += co * w[0]; b += co * w[1]; h += Math.sin(ph) * w[3]; }
      const i = y * N + x; dx[i] = a; dz[i] = b; hh[i] = h; mx = Math.max(mx, Math.abs(a), Math.abs(b)); mh = Math.max(mh, Math.abs(h));
    }
    for (let i = 0; i < N * N; i++) { img.data[i * 4] = 127.5 + 127.5 * dx[i] / mx; img.data[i * 4 + 1] = 127.5 + 127.5 * dz[i] / mx; img.data[i * 4 + 2] = 127.5 + 127.5 * hh[i] / mh; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const tex = new T.CanvasTexture(c); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.anisotropy = low ? 1 : 4;
    return tex;
  }
  // 大型ビジョンの絵
  function drawBoard(c, text) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#07204a'); gr.addColorStop(1, '#03102a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#0b4fb8'; g.fillRect(0, 0, W, H * 0.2); fit(g, 'casa BOAT', W / 2, H * 0.105, W * 0.8, H * 0.14, '#ffffff');
    const lines = String(text == null ? '' : text).split('\n').filter((s) => s.length), n = Math.max(1, lines.length), lh = H * 0.72 / n;
    lines.forEach((s, i) => fit(g, s, W / 2, H * 0.24 + lh * (i + 0.5), W * 0.9, Math.min(lh * 0.82, H * 0.42), i ? '#ffffff' : '#ffe14a'));
    g.strokeStyle = '#8fa4c4'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
  }

  // ───────── 材質 ─────────
  // InstancedMesh の色を頂点の tint の分だけ掛ける（服や葉だけ色を変える）。bob > 0 なら少し上下にゆれる（観客）
  function tintMat(U, bob) {
    const m = new T.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.time;
      sh.vertexShader = 'attribute float tint;\nuniform float uTime;\n' + sh.vertexShader
        .replace('#include <color_vertex>', 'vColor = color;\n#ifdef USE_INSTANCING_COLOR\n vColor *= mix( vec3( 1.0 ), instanceColor, tint );\n#endif')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n' + (bob ? ' transformed.y += max( 0.0, sin( uTime * 2.6 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].y * 3.1 ) ) * ' + bob.toFixed(3) + ';\n' : '') + '#endif');
    };
    return m;
  }
  // 近くの動かない物: 頂点色に、コンクリートの汚れと目地の模様を掛ける（uv なし。場所と面の向きから貼る）
  function detailMat(tex) {
    const m = new T.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uDet = { value: tex };
      sh.vertexShader = 'varying vec3 vDp;\nvarying vec3 vDn;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vDp = position; vDn = normal;');
      sh.fragmentShader = 'uniform sampler2D uDet;\nvarying vec3 vDp;\nvarying vec3 vDn;\n' + sh.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n vec2 duv = abs( vDn.y ) > 0.6 ? vDp.xz : vec2( vDp.x + vDp.z, vDp.y );\n float dd = mix( texture2D( uDet, duv * 0.21 ).g, texture2D( uDet, duv * 0.031 + 0.37 ).g, 0.45 );\n diffuseColor.rgb *= 0.52 + 0.96 * dd;');
    };
    return m;
  }
  // 水面: 不透明。本物のコマ（昼＝鳴門 2026-10-13 3R、夕方＝尼崎 SG ダービー優勝戦、ナイター＝桐生 SG メモリアル優勝戦・住之江 グランプリ優勝戦）に色と模様を合わせた。
  //   2026-11-28: 色だけは本物のコマに合わせるのをやめた（オーナー「暗い・どよーんとしている」）。明るい青の水に入れ替え（下の TOD の表）。模様・映り込み・照り返しの式はそのまま
  //   ・見下ろす角度が深いほど水そのものの暗い色、浅いほど空と対岸の映り込み（本物の水と同じ割合の式）。
  //   ・波の傾きの絵を 5 枚（low は 3 枚）: 風にそって流れる細かいさざ波 2 枚、山の長いゆるいうねり 2 枚、大きなむら 1 枚。
  //   ・照明の映り込みは「その灯を目へはね返す傾き」と波の傾きが合った所だけ光る（細い柱がきらきらと手前へのびる）。
  //   ・風と波は setWeather が uWr・uWv を入れ替える（資料 11 の ③-1・⑤-3）。色と灯の強さは時間帯ごとに setTime が入れ替える
  function waterMat(U, tex, P, low) {
    const V3 = () => ({ value: new T.Color() });
    const uniforms = T.UniformsUtils.merge([T.UniformsLib.lights, T.UniformsLib.fog, {
      uSun: { value: new T.Vector3(CO.SUN.x, CO.SUN.y, CO.SUN.z) },
      uDeep: V3(), uShal: V3(), uSkyH: V3(), uSkyZ: V3(), uSunCol: V3(), uNet: V3(), uBld: V3(), uStd: V3(), uLampCol: V3(), uBoardCol: V3(), uMkCol: V3(),
      uGl: { value: new T.Vector2(5, 0.22) },
      uShore: { value: new T.Vector4(P.farZ, P.shoreZ, P.netH, P.standH) }, uStdX: { value: new T.Vector2(P.sx0, P.sx1) },
      uLamp: { value: new T.Vector4(P.lampFarH, P.lampFarStep, P.lampStdH, P.lampStdStep) }, uSlope: { value: new T.Vector3(P.farK, P.shoreK, P.lampFarX0) }, uBoard: { value: new T.Vector4(P.boardX, P.boardW, P.boardY0, P.boardY1) },
      uLampZ: { value: new T.Vector2(P.lampFarZ, P.lampStdZ) },                 // 灯の奥行き（対岸の照明塔・スタンドの屋根の照明）
      uMk: { value: new T.Vector4(P.m1x, P.m1z, P.m2x, P.m2z) },                // ターンマーク 2 つの場所（水面への映り込み用）
      uWr: { value: new T.Vector4(1, 0, 0.3, 1) },                              // 風が吹いていく向き (x, z)・さざ波の強さ・映り込みのくっきりさ
      uWv: { value: new T.Vector4(1, 0, 0, 0) },                                // うねりの強さ・暗い帯・泡の筋・全体の暗さ
      uDrift: { value: new T.Vector2(0, 0) },                                   // さざ波が風下へ流れた量（update が足していく）
    }]);
    uniforms.uN = { value: tex }; uniforms.uT = U.time;
    return new T.ShaderMaterial({
      uniforms: uniforms, lights: true, fog: true, defines: low ? {} : { BOAT_HQ: 1 },
      vertexShader: [
        'varying vec3 vW;', '#include <common>', '#include <fog_pars_vertex>', '#include <shadowmap_pars_vertex>',
        'void main() {', ' #include <beginnormal_vertex>', ' #include <defaultnormal_vertex>', ' #include <begin_vertex>', ' #include <project_vertex>', ' #include <worldpos_vertex>',
        ' vW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;', ' #include <shadowmap_vertex>', ' #include <fog_vertex>', '}'].join('\n'),
      fragmentShader: [
        'uniform sampler2D uN; uniform float uT; uniform vec3 uSun, uDeep, uShal, uSkyH, uSkyZ, uSunCol, uNet, uBld, uStd, uLampCol, uBoardCol, uMkCol; uniform vec4 uShore, uLamp, uBoard, uMk, uWr, uWv; uniform vec2 uStdX, uGl, uLampZ, uDrift; uniform vec3 uSlope;', 'varying vec3 vW;',
        '#include <common>', '#include <packing>', '#include <fog_pars_fragment>', '#include <bsdfs>', '#include <lights_pars_begin>', '#include <shadowmap_pars_fragment>', '#include <shadowmask_pars_fragment>',
        'void main() {',
        ' vec2 p = vW.xz, wd = uWr.xy, wp = vec2( wd.y, -wd.x );',                                                // wd = 風下の向き、wp = その横
        ' vec2 q = vec2( dot( p, wd ), dot( p, wp ) );',                                                          // 風にそった座標（さざ波の山は風に直角＝横に長い）
        ' float dist = distance( cameraPosition, vW );',
        ' vec3 a = texture2D( uN, q * vec2( 0.41, 0.23 ) - uDrift * 0.41 ).rgb;',                                  // さざ波（風下へ流れる）
        ' vec3 b = texture2D( uN, vec2( ( p.x * 0.94 + p.y * 0.34 ) * 0.016, ( p.y * 0.94 - p.x * 0.34 ) * 0.12 ) + uT * vec2( 0.002, 0.021 ) ).rgb;', // 山の長いゆるいうねり（本物の静かな日の「長い筋」）
        ' vec3 c = texture2D( uN, q * 0.0170 - uDrift * 0.011 + uT * vec2( 0.003, -0.004 ) ).rgb;',                 // 大きなむら（風の強い所・弱い所。風下へ動く）
        ' float wpat = 0.45 + 1.1 * c.b;',
        '#ifdef BOAT_HQ',
        // 大きさと向きの違う模様をもう 1 枚ずつ重ねて、くり返しが見えないようにする
        ' vec3 a2 = texture2D( uN, vec2( q.x * 0.91 - q.y * 0.42, q.y * 0.91 + q.x * 0.42 ) * vec2( 0.27, 0.17 ) - uDrift * 0.23 ).rgb;',
        ' vec3 b2 = texture2D( uN, vec2( ( p.x * 0.80 - p.y * 0.60 ) * 0.011, ( p.y * 0.80 + p.x * 0.60 ) * 0.075 ) + uT * vec2( -0.002, 0.014 ) ).rgb;',
        ' vec2 fa = ( a.rg - 0.5 ) * 0.10 + vec2( a2.r * 0.91 + a2.g * 0.42 - 0.665, a2.g * 0.91 - a2.r * 0.42 - 0.245 ) * 0.10;',
        ' vec2 gm = ( vec2( 0.94 * ( b.r - 0.5 ) * 0.13 - 0.34 * ( b.g - 0.5 ), 0.34 * ( b.r - 0.5 ) * 0.13 + 0.94 * ( b.g - 0.5 ) ) * 0.14',
        '   + vec2( 0.80 * ( b2.r - 0.5 ) * 0.15 + 0.60 * ( b2.g - 0.5 ), -0.60 * ( b2.r - 0.5 ) * 0.15 + 0.80 * ( b2.g - 0.5 ) ) * 0.11 ) * uWv.x;',
        ' float hgt = ( ( b.b + b2.b - 1.0 ) * 0.5 + ( c.b - 0.5 ) * 0.5 ) * uWv.x + ( a.b + a2.b - 1.0 ) * 0.2 * uWr.z;',
        ' float fo = a2.b;',
        '#else',
        ' vec2 fa = ( a.rg - 0.5 ) * 0.15;',
        ' vec2 gm = vec2( 0.94 * ( b.r - 0.5 ) * 0.13 - 0.34 * ( b.g - 0.5 ), 0.34 * ( b.r - 0.5 ) * 0.13 + 0.94 * ( b.g - 0.5 ) ) * 0.2 * uWv.x;',
        ' float hgt = ( ( b.b - 0.5 ) * 0.8 + ( c.b - 0.5 ) * 0.5 ) * uWv.x + ( a.b - 0.5 ) * 0.35 * uWr.z;',
        ' float fo = a.b;',
        '#endif',
        ' vec2 gf = ( wd * fa.x * 1.6 + wp * fa.y ) * uWr.z * wpat;',                                             // 風の座標の傾きを世界の向きへ戻す
        ' vec2 g = gf + gm + ( c.rg - 0.5 ) * 0.03 * uWv.x;',
        ' vec3 N = normalize( vec3( -g.x, 1.0, -g.y ) );',
        ' vec3 V = normalize( cameraPosition - vW );',
        ' float rough = clamp( uWr.z - 0.3, 0.0, 1.2 );',                                                         // 風で水面がざらつく度合い（0 ＝ 鏡）
        ' float nv = max( dot( N, V ), 0.0 ); ',
        ' float fr = 0.02 + 0.98 * pow( 1.0 - nv, 5.0 );',                                                        // 水の反射の割合（真上から 2%、すれすれで 100%）
        ' vec3 R = reflect( -V, N ); R.y = abs( R.y ) + 0.015;',
        ' vec3 refl = mix( uSkyH, uSkyZ, pow( clamp( R.y + rough * 0.04, 0.0001, 1.0 ), 0.5 ) );',
        // 対岸（緑の防風ネットと、その上の白い建物）とスタンドの映り込み: 映る向きの線が岸に当たる高さで決める
        ' vec3 Ng = normalize( vec3( -gm.x * 0.6 - gf.x * 0.35, 1.0, -gm.y * 0.6 - gf.y * 0.35 ) );',             // 岸の映り込み用のなだらかな傾き（ギザギザを防ぐ）
        ' vec3 Rg = reflect( -V, Ng ); Rg.y = abs( Rg.y ) + 0.01;',
        ' float rz = Rg.z < 0.0 ? min( Rg.z, -0.001 ) : max( Rg.z, 0.001 );',
        ' float zf = uShore.x + uSlope.x * vW.x, zs = uShore.y + uSlope.y * vW.x;',                                 // 岸はななめ（x で奥行きが変わる）
        ' float tt = ( ( Rg.z < 0.0 ? zf : zs ) - vW.z ) / rz;',
        ' float hh = Rg.y * tt, hx = vW.x + Rg.x * tt;',
        ' float sw = 1.0 + abs( tt ) * 0.03;',                                                                    // 遠い映り込みほど輪郭をぼかす
        ' float mir = uWr.w; vec3 glowC = vec3( 0.0 );',
        ' if ( Rg.z < 0.0 ) {',
        '  float bl = ' + P.blds.map((q) => 'smoothstep( ' + (q[1] / 2).toFixed(1) + ' + sw, ' + (q[1] / 2).toFixed(1) + ' - sw, abs( hx - ( ' + q[0].toFixed(1) + ' ) ) ) * smoothstep( ' + (q[2] + 1.5).toFixed(1) + ' + sw, ' + (q[2] - 0.5).toFixed(1) + ' - sw, hh )').join(' + ') + ';',   // 対岸の建物（会場に実際に置いた 3 棟の場所と高さ）
        '  refl = mix( refl, uBld, min( bl, 1.0 ) * 0.6 * mir );',
        '  refl = mix( refl, uNet, smoothstep( uShore.z + sw, uShore.z - sw, hh ) * ( 0.15 + 0.8 * mir ) );',
        '  float bx = smoothstep( uBoard.y + 2.5, uBoard.y - 1.0, abs( hx - uBoard.x ) ) * smoothstep( uBoard.z - sw, uBoard.z + sw * 0.5, hh ) * smoothstep( uBoard.w + sw * 2.0, uBoard.w - sw * 0.5, hh );',
        '  glowC = uBoardCol * bx * ( 0.3 + 0.7 * mir );',                                                         // 大型ビジョンの映り込み
        ' } else {',
        '  float inx = smoothstep( uStdX.x - 14.0, uStdX.x + 6.0, hx ) * smoothstep( uStdX.y + 14.0, uStdX.y - 6.0, hx );',
        '  refl = mix( refl, uStd, inx * smoothstep( uShore.w + sw * 1.5, uShore.w - sw * 1.5, hh ) * ( 0.15 + 0.7 * mir ) );',
        ' }',
        // 照明の灯の映り込み: 平らな水なら映る場所から、いちばん近い灯を選び、その灯を目へはね返す傾きと波の傾きの差で光らせる
        ' float fs = step( 0.0, V.z );',                                                                          // 1 ＝ 対岸の側の灯が映る向き
        ' float zl = mix( uLampZ.y + uSlope.y * vW.x, uLampZ.x + uSlope.x * vW.x, fs );',
        ' float xl = vW.x - V.x * ( zl - vW.z ) / ( abs( V.z ) > 0.001 ? -V.z : -0.001 );',
        ' float lxf = uSlope.z + uLamp.y * clamp( floor( ( xl - uSlope.z ) / uLamp.y + 0.5 ), -2.0, 2.0 );',
        ' float lxs = clamp( ( floor( ( xl - uStdX.x ) / uLamp.w ) + 0.5 ) * uLamp.w + uStdX.x, uStdX.x, uStdX.y );',
        ' float lx = mix( lxs, lxf, fs );',
        ' vec3 Ld = normalize( vec3( lx, mix( uLamp.z, uLamp.x, fs ), mix( uLampZ.y + uSlope.y * lx, uLampZ.x + uSlope.x * lx, fs ) ) - vW );',
        ' vec3 Hl = normalize( Ld + V );',
        ' vec2 dl = gm + gf * max( 1.0, 0.85 / uWr.z ) + Hl.xz / Hl.y;',                                           // 灯は、静かな日でも残る細かいさざ波できらきら砕ける
        ' float lampI = exp( - dot( dl, dl ) * 1900.0 ) * mix( 0.45, 1.0, fs );',
        // ターンマークの映り込み（本物は、静かな水面でマークのすぐ手前に赤い色がのびる）
        ' vec2 cm = cameraPosition.xz; float mk = 0.0, mkw = 0.0;',
        '#ifdef BOAT_HQ',
        ' for ( int i = 0; i < 2; i++ ) {',
        '  vec2 M = i == 0 ? uMk.xy : uMk.zw, dm = p - M, em = normalize( cm - M );',
        '  float al = dot( dm, em ), ac = dm.x * em.y - dm.y * em.x + ( gm.x + gf.x ) * al * 2.0;',
        '  float hm = al * cameraPosition.y / max( distance( cm, p ), 1.0 ) * 0.62;',                             // 映る線がマークを通る高さ（さざ波で縦に 1.6 倍のびる。本物のコマの長さ）
        '  float wm = hm < 0.45 ? 0.42 : max( 0.26 * ( 0.95 - hm ) / 0.5, 0.05 );',
        '  float mi = step( 0.0, al ) * smoothstep( 1.1, 0.2, hm ) * smoothstep( wm + 0.09, wm - 0.05, abs( ac ) );',
        '  mk += mi; mkw += mi * smoothstep( 0.1, 0.16, abs( abs( ac ) - 0.26 ) );',                                // 赤白のしま（真ん中と外が赤、その間が白）
        ' }',
        '#endif',
        ' vec3 mkc = mix( mix( uMkCol, vec3( dot( uMkCol, vec3( 0.6 ) ) ), 0.6 ), uMkCol, mk > 0.0 ? mkw / mk : 1.0 );',
        ' mk = min( mk, 1.0 );',
        ' refl = mix( refl, mkc, mk * ( 0.3 + 0.7 * mir ) );',
        ' vec3 body = mix( uDeep, uShal, clamp( 0.5 + hgt * 0.9, 0.0, 1.0 ) );',
        ' float sh = getShadowMask();',
        ' body *= ( 0.6 + 0.4 * sh ) * ( 0.75 + 0.35 * max( dot( N, uSun ), 0.0 ) );',
        ' vec3 col = mix( body, refl, fr * ( 0.7 + 0.3 * sh ) );',
        ' col = mix( col, mkc, mk * ( 0.15 + 0.3 * mir ) );',
        ' col *= 1.0 - uWv.w - uWv.y * 0.16 * smoothstep( 0.42, 0.7, c.b );',                                     // 風の強い日: 全体が暗く、風の強い所が暗い帯になる
        ' col += ( uLampCol * lampI + glowC ) * ( 0.25 + 0.75 * fr );',
        ' float sd = max( dot( R, uSun ), 0.0 );',
        ' col += uSunCol * ( pow( sd + 0.0001, 420.0 ) * uGl.x + pow( sd + 0.0001, 40.0 ) * uGl.y ) * sh;',                         // 光の照り返し（きらめき）
        ' float foam = uWv.z * smoothstep( 0.72, 0.84, fo * 0.65 + c.b * 0.42 ) * clamp( 1.3 - dist / 240.0, 0.0, 1.0 );',  // 波の高い日（江戸川 15cm）の泡の筋
        ' col = mix( col, ( uSkyH + uSunCol ) * 0.45 + 0.12, foam * 0.4 );',
        ' gl_FragColor = vec4( col, 1.0 );',
        ' #include <tonemapping_fragment>', ' #include <encodings_fragment>', ' #include <fog_fragment>', '}'].join('\n'),
    });
  }

  // ───────── 観客・木の形 ─────────
  // 人: 丸みのある胴（服の色＝インスタンスの色）と丸い頭（上が髪・下が肌）。底の面は見えないので作らない。1 人 35 三角形
  function personGeo(standing) {
    const H = standing ? 1.36 : 0.62, g = new Geo(), body = new T.CylinderGeometry(0.19, standing ? 0.17 : 0.21, H, 5, 1).toNonIndexed(), head = new T.SphereGeometry(1, 5, 3).toNonIndexed();
    g.add(body, mat(0, H / 2, 0, 1, 1, 0.72), '#ffffff', { tint: 1, skip: [45, 60], shade: (y) => 0.7 + 0.38 * (y / H + 0.5) });
    g.add(head, mat(0, H + 0.125, 0, 0.115, 0.135, 0.12), '#c49878', { grad: ['#221c19', -0.1, 0.75] });
    body.dispose(); head.dispose();
    return g.build(false, true);
  }
  // 木立: 高さ 1・幅 1 くらいの「こんもりした葉のかたまり」（でこぼこの球を 4〜5 個）。葉はインスタンスの色、下ほど暗い
  function treeGeo(low) {
    const g = new Geo(), ico1 = new T.IcosahedronGeometry(1, 1), ico0 = new T.IcosahedronGeometry(1, 0);
    for (const ge of [ico1, ico0]) { const P = ge.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = 1 + 0.17 * Math.sin(x * 7.1 + y * 5.3 + z * 9.7); P.setXYZ(i, x * k, y * k, z * k); } }
    const sh = (y) => 0.46 + 0.54 * Math.min(1, Math.max(0, y * 0.5 + 0.6));
    g.cyl(0, 0, 0, 0.03, 0.05, 0.3, 5, '#33271f');
    g.add(low ? ico0 : ico1, mat(0, 0.58, 0, 0.5, 0.42, 0.46, 0, 0.4), '#ffffff', { tint: 1, shade: sh });
    const side = [[0.42, 0.36, 0.1, 0.34], [-0.4, 0.34, -0.08, 0.36], [0.05, 0.33, 0.36, 0.3], [-0.08, 0.31, -0.38, 0.3]];
    for (let i = 0; i < (low ? 3 : 4); i++) { const q = side[i]; g.add(ico0, mat(q[0], q[1], q[2], q[3], q[3] * 0.95, q[3], 0, q[0] * 5), '#ffffff', { tint: 1, shade: sh }); }
    ico1.dispose(); ico0.dispose(); return g.build(false, true);
  }

  // ───────── 会場を作る ─────────
  function build(scene, renderer, opts) {
    opts = opts || {};
    const low = opts.quality === 'low', shadows = !low;
    const root = new T.Group(); root.name = 'boat-venue'; scene.add(root);
    const U = { time: { value: 0 } };
    const trash = [];                                 // dispose するもの
    const keep = (o) => { trash.push(o); return o; };
    const rnd = srand(1117);
    const SUN = new T.Vector3(CO.SUN.x, CO.SUN.y, CO.SUN.z);
    const LY = LAND_Y, SZ = CO.shoreZ, FZ = CO.farZ, X0 = CO.X_MIN, X1 = CO.X_MAX, M1 = CO.MARK1, M2 = CO.MARK2;
    // 岸はマークの線に対してななめ。岸にそった「置き場所の枠」を 2 つ作る（枠の中では x = 岸にそった向き、z = 岸から直角）
    const kS = SZ(1) - SZ(0), kF = FZ(1) - FZ(0), aS = Math.atan(-kS), aF = Math.atan(-kF);
    const TS = new T.Matrix4().makeRotationY(aS).setPosition(0, 0, SZ(0));   // スタンド側: z ＋ が陸の奥
    const TF = new T.Matrix4().makeRotationY(aF).setPosition(0, 0, FZ(0));   // 対岸: z − が陸の奥（＋ は水の上）
    const uS = (x) => x / Math.cos(aS), uF = (x) => x / Math.cos(aF);        // 世界の x → 枠の中の x
    const toW = (M, x, y, z) => new T.Vector3(x, y, z).applyMatrix4(M);
    // スタンドの大きさ（資料に数字が無い。住之江の写真「水ぎわのすぐ後ろ・屋外の階段席・その上にガラスの室内席と大きな屋根」の形だけ合わせた）
    const SU0 = -115, SU1 = 115, SLEN = SU1 - SU0, SW = 7;                   // 岸にそって 230m（スタート線が真ん中）、水ぎわから 7m 後ろが階段席の前の壁

    // ── 光・空・霧・描き方の設定 ──
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
    renderer.physicallyCorrectLights = false;
    renderer.shadowMap.enabled = shadows; renderer.shadowMap.type = T.PCFShadowMap;
    const prevFog = scene.fog, prevBg = scene.background;
    const fog = new T.Fog('#cfe5f3', 60, 1900); scene.fog = fog; scene.background = new T.Color('#cfe5f3');
    const sun = new T.DirectionalLight(0xffe4bd, 1.8); sun.name = 'boat-sun';     // 昼・夕方は太陽、ナイターは照明（スタンドの屋根の側から）
    const SH = 85;                                    // 影を作る範囲の半分（m）
    if (shadows) {
      sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
      const sc = sun.shadow.camera; sc.left = -SH; sc.right = SH; sc.top = SH; sc.bottom = -SH; sc.near = 10; sc.far = 520; sc.updateProjectionMatrix();
    }
    sun.position.copy(SUN).multiplyScalar(260); scene.add(sun); scene.add(sun.target);
    const hemi = new T.HemisphereLight(0xcfe0f5, 0x6f807c, 0.78); hemi.name = 'boat-hemi'; scene.add(hemi);
    const amb = new T.AmbientLight(0xffffff, 0.08); amb.name = 'boat-amb'; scene.add(amb);
    const fill = new T.DirectionalLight(0xffffff, 0); fill.name = 'boat-fill'; fill.position.set(-50, 120, -220); scene.add(fill);   // 対岸の側からの補助の光（夕方・ナイター。影なし）
    // 空の球（カメラに付いて動く。奥行きを書かないので一番奥に見える）。絵は時間帯ごとに 1 枚（初めて使うときに作る）
    const SKY_TH = Math.PI * 0.55, skyCache = {};
    const sky = new T.Mesh(keep(new T.SphereGeometry(400, 32, 10, 0, Math.PI * 2, 0, SKY_TH)), keep(new T.MeshBasicMaterial({ side: T.BackSide, fog: false, toneMapped: false, depthTest: false, depthWrite: false })));
    sky.renderOrder = -1000; sky.frustumCulled = false; sky.matrixAutoUpdate = false;
    sky.onBeforeRender = function (r, s, cam) { sky.matrixWorld.makeTranslation(cam.matrixWorld.elements[12], cam.matrixWorld.elements[13], cam.matrixWorld.elements[14]); };
    root.add(sky);

    // ── 水面（ななめの岸に合わせた四角形） ──
    const NET_H = 10, NET_W = -9;                                                                         // 対岸の防風ネット（高さは資料に無い）と、その奥行きの位置（対岸の枠の z）
    const TOWER_H = 31, TOWER_STEP = (X1 - X0) / 5, TOWER_X0 = (X0 + X1) / 2;                             // 照明塔（資料に位置と高さの数字は無い。ナイターに必要なので対岸に 5 本）
    const ROOF_Y0 = 24.5, ROOF_LAMP_Y = ROOF_Y0 + 4.4, ROOF_LAMP_N = 8;                                  // スタンドの屋根の照明（同じく資料に無い）
    const SCR_W = 16.8, SCR_H = 9.45, SCR_Y0 = LY + 2.5;                                                  // 対岸の大型映像装置（大村の 758 インチ＝16.8×9.45m）。スタート線の真向かい
    const FAR_BLDS = [[-190, 60, 22], [-85, 44, 18], [150, 70, 25]];                                      // 対岸の建物 [岸にそった位置, 幅, 高さ]（水面の映り込みにも同じ数字を使う）
    const waveT = keep(waveTex(low));
    const wg = new T.BufferGeometry(), wa = [X0 - 0.6, 0, SZ(X0) + 0.8], wb = [X1 + 0.6, 0, SZ(X1) + 0.8], wc = [X1 + 0.6, 0, FZ(X1) - 0.8], wd = [X0 - 0.6, 0, FZ(X0) - 0.8];
    wg.setAttribute('position', new T.Float32BufferAttribute([].concat(wa, wb, wc, wa, wc, wd), 3));
    wg.setAttribute('normal', new T.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const waterM = keep(waterMat(U, waveT, { farZ: FZ(0) + NET_W, farK: kF, shoreZ: SZ(0) + SW + 6, shoreK: kS, netH: LY + NET_H, standH: 22, sx0: SU0, sx1: SU1,
      lampFarH: LY + TOWER_H, lampFarStep: TOWER_STEP, lampFarX0: TOWER_X0, lampStdH: ROOF_LAMP_Y, lampStdStep: SLEN / ROOF_LAMP_N, lampFarZ: FZ(0) + NET_W + 2.8, lampStdZ: SZ(0) + SW - 2, blds: FAR_BLDS, m1x: M1.x, m1z: M1.z, m2x: M2.x, m2z: M2.z, boardX: 0, boardW: SCR_W / 2, boardY0: SCR_Y0, boardY1: SCR_Y0 + SCR_H }, low));
    const water = new T.Mesh(keep(wg), waterM); water.name = 'boat-water'; water.receiveShadow = shadows; water.frustumCulled = false; root.add(water);

    // ── まとめる入れ物 ──
    const G = new Geo();      // 近くの動かない物（影を落とす・受ける）
    const F = new Geo();      // 遠くの動かない物（影なし）
    const A = new Geo();      // 絵を貼る物
    const CT = new Geo();     // 街の建物（窓の絵をくり返して貼る）
    const LG = new Geo();     // 照明の灯の面（時間帯で色を変える）
    const FL = new Geo(), flH = [], flP = [];   // 風でなびく物（吹き流し・空中線の小旗）。flH = 頂点ごとの [付け根 x, y, z, 動く割合]、flP = ばたつきのずれ
    const flAdd = (fn, hx, hy, hz, wOf, ph) => { const n0 = FL.p.length / 3; fn(); for (let i = n0; i < FL.p.length / 3; i++) { flH.push(hx, hy, hz, wOf(FL.p[i * 3 + 1])); flP.push(ph); } };
    const glowPts = [];       // 照明のにじみを出す場所
    const cityPts = [], cityCols = [];   // 遠くの街の灯
    const atlas = makeAtlas(), R = atlas.R; keep(atlas.tex);
    const people = [];        // 観客 { x, y, z, s, sy }（スタンド側の枠の中の座標）
    const trees = [];         // 木 { x, z, h }（世界の座標）
    const noTree = [];        // 木を置かない四角 [x0, x1, z0, z1]
    const setF = (M) => { G.tf = A.tf = LG.tf = M || null; };
    const WHITE = '#eceeed', BLACK = '#0d0d0d';

    // ── 地面と護岸（岸はななめ。水面は X_MIN〜X_MAX、shoreZ(x)〜farZ(x)） ──
    const XA = X0 - 36, XB = X1 + 16, DN = 72, DF = 20, BIG = 2600, CONC = '#8b8a85', CONC2 = '#85867f', GRASS = '#6fae58', TOWN = '#8f968f';
    const hq = (g, xa, xb, lo, hi, col) => g.quad([xa, LY, hi(xa)], [xb, LY, hi(xb)], [xb, LY, lo(xb)], [xa, LY, lo(xa)], col);
    const sN = (x) => SZ(x) + DN, fS = (x) => FZ(x) - DF, bigN = () => BIG, bigS = () => -BIG;
    hq(G, XA, XB, SZ, sN, CONC); hq(G, XA, XB, fS, FZ, CONC2); hq(G, XA, X0, FZ, SZ, CONC2); hq(G, X1, XB, FZ, SZ, CONC2);
    hq(F, -BIG, BIG, sN, bigN, TOWN); hq(F, -BIG, XA, SZ, sN, TOWN); hq(F, XB, BIG, SZ, sN, TOWN);
    hq(F, -BIG, BIG, bigS, fS, GRASS); hq(F, -BIG, XA, fS, FZ, GRASS); hq(F, XB, BIG, fS, FZ, GRASS);
    hq(F, -BIG, XA, FZ, SZ, GRASS); hq(F, XB, BIG, FZ, SZ, GRASS);
    // 護岸の壁（水に向いた面。水ぎわは濡れて暗い）
    function wall(ax, az, bx, bz, col) {
      G.quad([ax, 0.3, az], [bx, 0.3, bz], [bx, LY, bz], [ax, LY, az], col || '#a8a79f');
      G.quad([ax, -0.8, az], [bx, -0.8, bz], [bx, 0.3, bz], [ax, 0.3, az], '#4f5b58');
    }
    wall(X1, SZ(X1), X0, SZ(X0)); wall(X0, FZ(X0), X1, FZ(X1), '#3e6e5c'); wall(X1, FZ(X1), X1, SZ(X1)); wall(X0, SZ(X0), X0, FZ(X0));

    // ══ スタンド側（岸にそった枠の中で作る） ══
    setF(TS);
    const UL0 = uS(X0) + 1.5, UL1 = uS(X1) - 1.5, ULM = (UL0 + UL1) / 2, ULL = UL1 - UL0;
    // 岸ぞいの消波装置の帯（統一基準 第14条で必須。ヤマト 200 型: 1 基 4m×2m×1.3m を並べる。色は桐生の写真の青）
    G.box(ULM, -0.75, -1.25, ULL, 1.3, 2.0, '#2a5fa3');
    for (let u = UL0 + 4; u < UL1; u += 4) G.box(u, -0.74, -1.25, 0.14, 1.3, 2.04, '#173a68');
    // 水面との間のさく（告示 第6条「強固なさく」）
    G.box(ULM, LY + 1.05, 0.45, ULL, 0.08, 0.08, '#e4e7e9'); G.box(ULM, LY + 0.55, 0.45, ULL, 0.05, 0.05, '#e4e7e9');
    for (let u = UL0; u <= UL1; u += 4) G.box(u, LY, 0.45, 0.09, 1.08, 0.09, '#dfe2e4');
    // スタンド: 屋外の階段席 → ガラスの室内席 → 大きな屋根
    const ROWS = 14, ROW_D = 1.05, ROW_H = 0.6, ROW_Y0 = 2.9, ROW_Z0 = SW + 0.8;
    G.box(0, LY, SW + 0.4, SLEN, ROW_Y0 - LY + 0.9, 0.36, '#c9c7c0');                          // 前の壁
    for (let i = 0; i < ROWS; i++) {
      const zf = ROW_Z0 + i * ROW_D, y = ROW_Y0 + i * ROW_H;
      G.box(0, LY, zf + ROW_D / 2, SLEN, y - LY, ROW_D, i % 2 ? '#8e9092' : '#989a9c');
      G.box(0, y, zf + ROW_D - 0.1, SLEN, 0.42, 0.1, '#2f8a63');                               // 椅子の背（住之江の写真の緑）
    }
    const TOP_Y = ROW_Y0 + ROWS * ROW_H, BACK_Z = ROW_Z0 + ROWS * ROW_D, BOX_D = 12, BOX_TOP = 20.4;
    G.box(0, LY, BACK_Z + BOX_D / 2, SLEN, BOX_TOP - LY, BOX_D, '#cfccc5');                    // 後ろの建物（室内席）
    for (let i = 0; i < 5; i++) A.sign(SU0 + SLEN * (i + 0.5) / 5, TOP_Y + 3.3, BACK_Z - 0.06, SLEN / 5, 5.2, Math.PI, R.glass);
    G.box(0, TOP_Y + 6.0, BACK_Z - 0.25, SLEN, 1.5, 0.5, '#d9d8d3');                           // ガラスの上の帯
    for (const su of [SU0 - 0.3, SU1 + 0.3]) G.box(su, LY, BACK_Z + BOX_D / 2 - 4, 0.6, BOX_TOP - LY, BOX_D + 8, '#bfbcb5'); // 両端の壁
    // 主審判室（告示 第3条: スタート線を含む鉛直面の上・スタンドのいちばん高い所）。ガラスの室内席の上に張り出した部屋
    G.box(0, TOP_Y + 6.0, BACK_Z - 1.7, 12, BOX_TOP - TOP_Y - 6.1, 3.4, '#e8e6e0'); A.sign(0, TOP_Y + 7.6, BACK_Z - 3.43, 11.4, 2.0, Math.PI, R.glass);
    // 屋根（前へせり上がる片持ち）
    const RF_Z0 = SW - 3, RF_Y0 = ROOF_Y0, RF_Z1 = BACK_Z + BOX_D + 0.6, RF_Y1 = 20.6, RF_L = Math.hypot(RF_Z1 - RF_Z0, RF_Y0 - RF_Y1);
    G.boxC(0, (RF_Y0 + RF_Y1) / 2, (RF_Z0 + RF_Z1) / 2, SLEN + 4, 0.5, RF_L, '#c4c8cc', Math.atan2(RF_Y0 - RF_Y1, RF_Z1 - RF_Z0));
    G.box(0, RF_Y0 - 1.5, RF_Z0 + 0.2, SLEN + 4, 1.5, 0.4, '#d6d8d9');                         // 屋根の前の帯
    // 屋根の下の鉄骨（垂木・母屋・トラス）
    const STEEL = '#7f878e';
    for (let i = 0; i <= 20; i++) {
      const x = SU0 + 2 + (SLEN - 4) * i / 20;
      G.beam(x, RF_Y1 - 0.55, RF_Z1 - 0.5, x, RF_Y0 - 0.55, RF_Z0 + 0.5, 0.4, STEEL);
      if (i % 2 === 0 && i !== 10) {
        const by = TOP_Y + 7.4, bz = BACK_Z - 0.3, fy = RF_Y0 - 1.5, fz = RF_Z0 + 5, at = (t) => { const z = bz + (RF_Z0 + 0.5 - bz) * t; return [z, RF_Y1 - 0.55 + (RF_Y0 - RF_Y1) * ((RF_Z1 - 0.5 - z) / (RF_Z1 - RF_Z0 - 1))]; };
        G.beam(x, by, bz, x, fy, fz, 0.3, STEEL);
        for (const t of [0.25, 0.5, 0.75]) { const q = at(t), lz = bz + (fz - bz) * t, ly = by + (fy - by) * t; G.beam(x, ly, lz, x, q[1], q[0], 0.2, STEEL); const q2 = at(t - 0.2); G.beam(x, ly, lz, x, q2[1], q2[0], 0.16, STEEL); }
      }
    }
    for (const t of [0.12, 0.38, 0.64, 0.9]) G.box(0, RF_Y1 + (RF_Y0 - RF_Y1) * (1 - t) - 0.72, RF_Z0 + (RF_Z1 - RF_Z0) * t, SLEN + 2, 0.24, 0.24, STEEL);
    // 屋根の上の照明（資料に無いが、ナイターの光のもととして必要。スタート線の真上は空けてある＝屋根のカメラのじゃまをしない）
    for (let i = 0; i < ROOF_LAMP_N; i++) {
      const x = SU0 + SLEN * (i + 0.5) / ROOF_LAMP_N, z = RF_Z0 + 1.0;
      for (const dx of [-2.6, 2.6]) G.box(x + dx, RF_Y0, z + 0.4, 0.22, 4.2, 0.22, '#6a7279');
      G.boxC(x, ROOF_LAMP_Y, z + 0.2, 7.6, 2.3, 0.4, '#3d444b', -0.3, Math.PI);
      for (let r2 = 0; r2 < 2; r2++) for (let k = 0; k < 6; k++) LG.boxC(x - 3.0 + k * 1.2, ROOF_LAMP_Y - 0.5 + r2 * 1.0, z - 0.06 + (r2 ? 0.15 : -0.15), 0.9, 0.8, 0.1, '#ffffff', -0.3, Math.PI);
      const gp = toW(TS, x, ROOF_LAMP_Y, z - 0.5); glowPts.push(gp.x, gp.y, gp.z);
    }
    // 階段席の通路の手すりと、前の壁の上の手すり
    for (let xa = SU0 + 11.5; xa < SU1; xa += 23) {
      G.beam(xa, ROW_Y0 + 0.95, ROW_Z0, xa, TOP_Y + 0.95, BACK_Z, 0.07, '#d5d9dc');
      for (let k = 0; k <= 4; k++) G.box(xa, ROW_Y0 + ROWS * ROW_H * k / 4 - (k ? ROW_H : 0), ROW_Z0 + (BACK_Z - ROW_Z0) * k / 4 - (k ? 0.3 : -0.2), 0.07, 0.95 + (k ? ROW_H : 0), 0.07, '#d5d9dc');
    }
    G.box(0, ROW_Y0 + 1.15, SW + 0.4, SLEN, 0.07, 0.07, '#d5d9dc');
    // 観客（階段席と、水ぎわの立ち見）
    (function () {
      const sc = low ? 1.5 : 1, pitch = 0.62 * sc, perRow = Math.floor((SLEN - 2) / pitch);
      const pSeat = Math.min(0.95, (low ? 650 : 1600) / (perRow * ROWS) * 1.06), nStand = low ? 450 : 1150;
      for (let i = 0; i < ROWS; i++) for (let x = SU0 + 1; x < SU1 - 1; x += pitch) {
        if (Math.abs(((x - SU0) % 23) - 11.5) < 0.7) continue;               // 通路
        if (rnd() > pSeat) continue;
        people.push({ x: x + (rnd() - 0.5) * 0.12, y: ROW_Y0 + i * ROW_H, z: ROW_Z0 + i * ROW_D + 0.42, s: sc * (0.94 + rnd() * 0.12), sy: sc * (0.9 + rnd() * 0.25) });
      }
      for (let i = 0; i < nStand; i++) {
        const x = SU0 + 1 + rnd() * (SLEN - 2), z = 1.2 + rnd() * rnd() * (SW - 2.2);
        if (x > -5 && x < 10 && z < 6.4) continue;                           // 大時計と信号灯の所
        people.push({ x: x, y: LY, z: z, s: sc * (0.96 + rnd() * 0.1), sy: sc * (0.94 + rnd() * 0.14), up: 1 });
      }
    })();
    // 副審判室（告示 第3条: 第 1・第 2 マークの真横、水面のすぐ外側の小さな建物）
    for (const mk of [M1, M2]) {
      const u = uS(mk.x);
      G.box(u, LY, 4.4, 4.0, 3.2, 4.0, '#dcdad3'); G.box(u, LY + 3.2, 4.4, 4.7, 0.25, 4.7, '#c9cdd0');
      G.box(u, LY + 3.45, 4.4, 4.2, 2.3, 4.2, '#5d88ad'); G.box(u, LY + 4.5, 4.4, 4.28, 0.12, 4.28, '#eef2f5');
      for (const dx of [-2.1, 2.1]) for (const dz of [-2.1, 2.1]) G.box(u + dx, LY + 3.45, 4.4 + dz, 0.18, 2.3, 0.18, '#eef2f5');
      G.box(u, LY + 5.75, 4.4, 5.0, 0.3, 5.0, '#b9bdc1');
    }
    setF(null);

    // ══ 大時計（発走信号用時計。統一基準 第2・3条） ══
    //   中心は水面の境から 4m 陸側・軸の高さ 2.5m・文字盤の直径 3m・つや消しの黒。第 2 マーク側の端がスタート線の上。
    //   面は「スタート線の真ん中から第 2 マークの方へ 40m の点」をまっすぐ向く（＝助走してくる艇のほうへななめ）
    const CK_Y = 2.5, CK_D = 3.0, ckz = CO.CLOCK.z + 4;
    let cnx = CO.CLOCK.x - 40 - (CO.CLOCK.x + 1), cnz = CO.CLOCK.z / 2 - ckz; { const l = Math.hypot(cnx, cnz); cnx /= l; cnz /= l; }
    const ckx = CO.CLOCK.x + CK_D / 2 * Math.abs(cnz), ckRy = Math.atan2(cnx, cnz);
    const TC = new T.Matrix4().makeRotationY(ckRy).setPosition(ckx, 0, ckz);   // 時計の枠: z ＋ が文字盤の向く方、x ＋ が（正面から見て）右
    setF(TC);
    G.box(0, LY, -0.6, 3.0, 4.15 - LY, 0.9, BLACK);                                             // 黒い箱
    G.add(cylGeo(CK_D / 2 + 0.04, CK_D / 2 + 0.04, 28), mat(0, CK_Y, -0.08, 1, 0.14, 1, Math.PI / 2), '#0b0b0b');   // 文字盤の円盤
    A.add(CIRCLE, mat(0, CK_Y, 0.005, CK_D, CK_D, 1), '#ffffff', { uv: R.clock });
    G.box(0, 4.15, -0.45, 0.95, 0.25, 0.5, BLACK); for (const dx of [-0.25, 0.25]) G.add(cylGeo(0.075, 0.075, 10), mat(dx, 4.275, -0.19, 1, 0.04, 1, Math.PI / 2), '#b9b6a8');   // 時間表示装置（95×25cm・直径 15cm の灯 2 個）
    // スタート・ゴール灯（1m 角・白と紺の市松 16 マス。写真では大時計の左下）
    G.box(-2.25, LY, -0.5, 1.16, 1.3, 0.5, BLACK); A.sign(-2.25, LY + 0.68, -0.24, 1.0, 1.0, 0, R.checker);
    // 最終周回灯（緑・上）・失格欠場灯（赤・中）・競技中止灯（黄・下）と、失格・欠場艇の表示盤（横 3m×縦 0.8m の黒い枠）
    G.box(2.35, LY, -0.5, 0.6, 2.5, 0.45, BLACK);
    [['#1f7a3e', 2.95], ['#8a1f1f', 2.4], ['#8f7a14', 1.85]].forEach((q) => G.add(cylGeo(0.19, 0.19, 12), mat(2.35, q[1], -0.26, 1, 0.05, 1, Math.PI / 2), q[0]));
    G.box(4.6, LY + 0.5, -0.5, 3.0, 0.8, 0.3, BLACK); for (const dx of [-1.2, 1.2]) G.box(4.6 + dx, LY, -0.5, 0.12, 0.5, 0.12, '#3a3f44');
    setF(null);
    // 針 2 本（別メッシュ。枠の中で z まわりに回す）: 白い 1 分針と、黄だいだいの 12 秒針
    const clockG = new T.Group(); clockG.position.set(ckx + cnx * 0.03, CK_Y, ckz + cnz * 0.03); clockG.rotation.y = ckRy; root.add(clockG);
    const handM = keep(new T.MeshBasicMaterial({ vertexColors: true }));
    const g60 = new Geo(); g60.quad([-0.055, -0.12, 0.02], [0.055, -0.12, 0.02], [0.03, 1.2, 0.02], [-0.03, 1.2, 0.02], '#f6f6f2');
    const hand60 = new T.Mesh(keep(g60.build()), handM); hand60.name = 'boat-clock-hand60'; clockG.add(hand60);
    const g12 = new Geo(), HZ = 0.05, HC = '#ffb400';
    g12.quad([-0.12, -0.1, HZ], [0.12, -0.1, HZ], [0.1, 0.98, HZ], [-0.1, 0.98, HZ], HC); g12.tri([-0.1, 0.98, HZ], [0.1, 0.98, HZ], [0, 1.24, HZ], HC);
    g12.add(CIRCLE, mat(0, 0, HZ + 0.01, 0.34, 0.34, 1), '#0b0b0b');
    const hand12 = new T.Mesh(keep(g12.build()), handM); hand12.name = 'boat-clock-hand12'; clockG.add(hand12);

    // ══ 水の上の目印（マークを結ぶ線の上。統一基準 第4〜9条） ══
    // ターンマーク: 3 段（下の輪 直径 1.10m・中の輪 0.90m・上の円すい 底 0.60m 高さ 0.50m）、水面から 0.95m。赤白（蛍光の朱色）を 8 等分、段ごとに入れ替え
    //   見え方は本物のコマ（鳴門・尼崎・桐生の 1 マーク／2 マーク、尼崎の写真 img3/wiki_turnmark2.jpg）に合わせた: 輪は丸みのある浮き輪、つやのある蛍光色、汚れの模様なし、水面に赤白が映る（映り込みは水面の側）。寸法は変えていない
    const MK = new Geo();
    function turnMark(mx, mz) {
      const RED = '#f03a1a', WH = '#f6f4ee', n = 8, sub = 2, pt = (a, r, y) => [mx + Math.cos(a) * r, y, mz - Math.sin(a) * r];
      // 輪の断面（半径の割合, 高さの割合）: 下ですぼまり、真ん中がいちばん太く、上で丸く閉じる
      const prof = [[0.86, 0], [1, 0.42], [0.93, 0.8], [0.72, 1]], tiers = [[0.55, -0.15, 0.2], [0.45, 0.2, 0.45]];
      for (let i = 0; i < n * sub; i++) {
        const a0 = i / (n * sub) * Math.PI * 2, a1 = (i + 1) / (n * sub) * Math.PI * 2, sec = Math.floor(i / sub);
        tiers.forEach((t, k) => {
          const col = (sec + k) % 2 ? WH : RED, at = (a, q) => pt(a, t[0] * q[0], t[1] + (t[2] - t[1]) * q[1]);
          for (let j = 0; j < prof.length - 1; j++) MK.quad(at(a0, prof[j]), at(a1, prof[j]), at(a1, prof[j + 1]), at(a0, prof[j + 1]), col);
          MK.tri(at(a0, prof[3]), at(a1, prof[3]), [mx, t[2], mz], col);
        });
        MK.tri(pt(a0, 0.3, 0.45), pt(a1, 0.3, 0.45), [mx, 0.95, mz], sec % 2 ? WH : RED);
      }
    }
    turnMark(M1.x, M1.z); turnMark(M2.x, M2.z);
    // 第 2 マークと小回り防止ブイの間の消波装置（黒い筒形の浮き。長さ約 20m）と、小回り防止ブイ（オレンジ。第 2 マークから 20m）
    const BU = CO.BUOY, fx0 = M2.x + 0.75, fx1 = BU.x - 0.6;
    G.add(cylGeo(0.33, 0.33, 10), mat((fx0 + fx1) / 2, 0.06, M2.z, 1, fx1 - fx0, 1, 0, 0, Math.PI / 2), '#141414');
    for (const x of [fx0 + 0.15, fx1 - 0.15]) G.add(cylGeo(0.35, 0.35, 10), mat(x, 0.06, M2.z, 1, 0.3, 1, 0, 0, Math.PI / 2), '#3a3a3a');
    G.cyl(BU.x, -0.2, BU.z, 0.24, 0.28, 0.6, 10, '#ff6a00'); G.cyl(BU.x, 0.4, BU.z, 0.05, 0.24, 0.22, 10, '#ff6a00');   // 大きさは資料に無い（映像で見える小ささに）
    // 標識ポール: しまの幅＝直径の 2 倍。5 赤白・45 黄白・80 青白・100 黄黒（上に吹き流し）。センターポールは白
    const AY = 3.5;                                                                                 // 空中線の高さ（水面から 4m 以内）
    function stripePole(x, z, h, dia, cols) {
      const seg = dia * 2, r = dia / 2;
      for (let y = h, k = 0; y > 0.001; y -= seg, k++) { const y0 = Math.max(0, y - seg); G.cyl(x, y0, z, r, r, y - y0, 8, cols[k % 2]); }
      G.cyl(x, -1, z, r, r, 1, 8, '#3f4a48');
    }
    const POLE_COLS = { 5: ['#e0282e', WHITE], 45: ['#f5d21a', WHITE], 80: ['#1f5fd0', WHITE], 100: ['#f5d21a', '#151515'] };
    stripePole(CO.CENTER_POLE.x, CO.CENTER_POLE.z, 2.6, 0.12, [WHITE, WHITE]);
    CO.POLES.forEach((d) => { stripePole(CO.LINE_X - d, 0, d === 100 ? 2.8 : AY + 0.1, 0.2, POLE_COLS[d] || [WHITE, WHITE]); });
    // 100m ポールの吹き流し（長さ 1m: 赤 50cm＋白 50cm。口の直径 25cm → 20cm）
    //   形は「たれ下がった姿」で作り、風の分だけ付け根（ポールの上）を軸に持ち上げる（setWeather。資料 11 ③-3: 1m ＝ たれ下がってポールにくっつく、7m ＝ 水平〜45° 下でばたつく）
    (function () {
      const x = CO.LINE_X - 100, hy = 3.08; G.box(x, 2.8, 0, 0.04, 0.3, 0.04, '#cfd3d6');
      flAdd(() => { FL.add(cylGeo(0.125, 0.1125, 8), mat(x, hy - 0.25, 0, 1, 0.5, 1), '#e0282e'); FL.add(cylGeo(0.1125, 0.1, 8), mat(x, hy - 0.75, 0, 1, 0.5, 1), WHITE); }, x, hy, 0, () => 1, 0.37);
    })();
    // 空中線は 5m・45m・80m の 3 本だけ（スタート線の上には無い）。小旗は 1 辺 45cm の正三角形を「色つき＋白」の 2 枚 1 組、組の間は 180cm
    function aerial(xa, za, xb, zb, col, square) {
      const len = Math.hypot(xb - xa, zb - za), dx = (xb - xa) / len, dz = (zb - za) / len;
      G.beam(xa, AY, za, xb, AY, zb, 0.045, '#20262c'); G.box(xb, LY, zb, 0.14, AY + 0.15 - LY, 0.14, WHITE);
      const top = AY - 0.02, wOf = (y) => (y < top - 0.1 ? 1 : 0);                                // 線に付いた辺は動かさず、下の角だけ風で持ち上げる
      const flag = (s, c) => { const a = [xa + dx * s, top, za + dz * s], b = [xa + dx * (s + 0.45), top, za + dz * (s + 0.45)], t = [xa + dx * (s + 0.225), AY - 0.41, za + dz * (s + 0.225)]; flAdd(() => FL.tri(a, b, t, c), t[0], top, t[2], wOf, rnd()); };
      for (let s = 1.2; s < len - 1.5; s += 2.7) { if (square && Math.abs(s + 0.45 - len / 2) < 1.35) continue; flag(s, col); flag(s + 0.45, WHITE); }
      if (square) { const s = len / 2 - 0.225, a = [xa + dx * s, top, za + dz * s], b = [xa + dx * (s + 0.45), top, za + dz * (s + 0.45)], c2 = [b[0], AY - 0.47, b[2]], d2 = [a[0], AY - 0.47, a[2]]; flAdd(() => FL.quad(a, b, c2, d2, col), (a[0] + b[0]) / 2, top, (a[2] + b[2]) / 2, wOf, rnd()); }   // 80m の線の真ん中の四角い旗（45cm 角）
    }
    aerial(CO.LINE_X - 5, 0, CO.LINE_X - 5, SZ(CO.LINE_X - 5) + 0.7, '#e0282e');
    aerial(CO.LINE_X - 45, 0, CO.LINE_X - 45, SZ(CO.LINE_X - 45) + 0.7, '#f5d21a');
    aerial(CO.LINE_X - 80, 0, CO.LINE_X - 85, SZ(CO.LINE_X - 85) + 0.7, '#1f5fd0', true);          // 内 80m・外 85m のななめ
    // 距離の標識板（スタンド側の水面の境の外。面はスタート線と平行＝助走の艇から読める。下の端は水面から 1m 以内。0.75m 角、5 と 85 は横 1.5m）
    CO.BOARDS.forEach((d) => {
      const x = CO.LINE_X - d, wide = (d === 5 || d === 85), w = wide ? 1.5 : 0.75, zc = SZ(x) + 1.0 + w / 2;
      A.sign(x - 0.045, 1.375, zc, w, 0.75, -Math.PI / 2, R['b' + d]); G.boxC(x, 1.375, zc, 0.07, 0.8, w + 0.05, '#dcdcd8');
      G.box(x + 0.02, LY, zc, 0.08, 0.2, 0.08, '#8d949a');
    });
    // 危険信号灯（上が黄・下が赤）と航走指示灯（白い矢印）: 1m 角を並べて、第 1 マーク側はスタンド側の端（イ）、第 2 マーク側は対岸側の端（ロ）
    function sigPair(x, z) {
      const l = Math.hypot(x, z), ry = Math.atan2(-x / l, -z / l), tx = Math.cos(ry), tz = -Math.sin(ry), nx = Math.sin(ry), nz = Math.cos(ry);
      [['danger', -0.58], ['arrow', 0.58]].forEach((q) => { const px = x + tx * q[1], pz = z + tz * q[1]; A.sign(px + nx * 0.14, LY + 2.6, pz + nz * 0.14, 1.0, 1.0, ry, R[q[0]]); G.boxC(px, LY + 2.6, pz, 1.1, 1.1, 0.25, BLACK, 0, ry); });
      G.box(x, LY, z, 0.2, 2.1, 0.2, '#8d949a');
    }
    sigPair(X1 - 3, SZ(X1 - 3) + 2); sigPair(X0 + 3, FZ(X0 + 3) - 2);

    // ══ ピット（第 2 マークの奥 118m ＝ x = X_MIN の壁ぎわ） ══
    //   浮き桟橋に 6 艇が横一列（艇は +x 向き）。映像（尼崎・桐生・住之江）のとおり、水面側から見て左から 6・5・4・3・2・1 ＝ 1 号艇が進む向きの左（内＝対岸寄り）。
    //   艇の間隔は住之江の映像のコマで測って約 2.9m（艇の幅 1.34m の 2.2 倍）。後ろの上に 1〜6 の枠色の番号板
    const PG = 2.9, PX = CO.PIT.x, PZC = CO.PIT.z, PL = PG * 6 + 2.4;
    G.box(X0 + 1.9, -0.35, PZC, 3.8, 0.8, PL, '#868e92');                                         // 岸に沿った桟橋
    for (let i = 0; i <= 6; i++) { const z = PZC + (i - 3) * PG; G.box(X0 + 5.7, -0.3, z, 3.8, 0.62, 0.36, '#9aa2a6'); G.box(X0 + 3.6, 0.45, z, 0.14, 2.9, 0.14, '#d9dde0'); }
    G.box(X0 + 1.4, 3.35, PZC, 6.6, 0.25, PL + 1, '#c9cdd0');                                     // 上屋（屋根）
    G.box(X0 + 4.45, 3.6, PZC, 0.2, 1.9, PG * 6 + 0.4, '#1b2026');
    for (let i = 0; i < 6; i++) A.sign(X0 + 4.57, 4.55, PZC + (i - 2.5) * PG, PG - 0.5, 1.6, Math.PI / 2, R['pit' + i]);
    G.box(X0 - 11, LY, PZC, 16, 8, PL + 16, '#cfcfc9'); G.box(X0 - 11, LY + 8, PZC, 17, 0.5, PL + 17, '#aeb2b4');   // 後ろの建物（艇庫・整備場。大きさは資料に無い）
    A.sign(X0 - 2.95, LY + 5.9, PZC, PL + 8, 1.8, Math.PI / 2, R.glass);
    noTree.push([X0 - 34, X0, PZC - PL / 2 - 14, PZC + PL / 2 + 14]);
    const PIT = { x: PX, z: PZC - PG * 2.5, dirX: 0, dirZ: 1, gap: PG, out: { x: 1, z: 0 } };

    // ══ 対岸（岸にそった枠の中で作る） ══
    setF(TF);
    const FL0 = uF(X0) + 1.5, FL1 = uF(X1) - 1.5, FLM = (FL0 + FL1) / 2, FLL = FL1 - FL0;
    // 岸ぞいの消波装置の帯（公式の水面図では対岸にもある場が多い）
    G.box(FLM, -0.75, 1.25, FLL, 1.3, 2.0, '#2a5fa3');
    for (let u = FL0 + 8; u < FL1; u += 8) G.box(u, -0.74, 1.25, 0.14, 1.3, 2.04, '#173a68');
    // 防風ネット（大村は対岸。高さの数字は資料に無い）
    const NET_L = FLL + 20;
    G.box(FLM, LY, NET_W, NET_L, NET_H, 0.3, '#35604f'); G.box(FLM, LY + NET_H, NET_W + 0.25, NET_L, 0.28, 0.28, '#9fb0a8');
    for (let u = FLM - NET_L / 2; u <= FLM + NET_L / 2; u += 12) G.box(u, LY, NET_W + 0.3, 0.36, NET_H + 0.5, 0.36, '#9fb0a8');
    // 大型映像装置（スタート線の真向かい）と、となりの横長の電光表示板（大村: 全長 66m・高さ約 9m。第 1 マーク寄り）
    const boardCv = cv(1024, 576), boardT = keep(new T.CanvasTexture(boardCv)); boardT.encoding = T.sRGBEncoding; boardT.anisotropy = 4;
    const boardM = keep(new T.MeshBasicMaterial({ map: boardT, toneMapped: false })), boardG = keep(new T.PlaneGeometry(1, 1));
    const boards = [], SCR_Z = -5, OD_W = 66, OD_H = 9, OD_U = SCR_W / 2 + 2.5 + OD_W / 2;
    G.box(0, SCR_Y0 - 0.5, SCR_Z - 0.45, SCR_W + 1.0, SCR_H + 1.0, 0.8, '#232a33');
    for (const k of [-0.32, 0.32]) G.box(SCR_W * k, LY, SCR_Z - 0.5, 0.9, SCR_Y0 - 0.5 - LY, 0.9, '#8d969e');
    (function () { const me = new T.Mesh(boardG, boardM), p = toW(TF, 0, SCR_Y0 + SCR_H / 2, SCR_Z); me.position.copy(p); me.rotation.y = aF; me.scale.set(SCR_W, SCR_H, 1); me.name = 'boat-venue-screen'; root.add(me); boards.push(me); })();
    A.sign(OD_U, SCR_Y0 + OD_H / 2, SCR_Z, OD_W, OD_H, 0, R.odds); G.box(OD_U, SCR_Y0 - 0.4, SCR_Z - 0.45, OD_W + 0.8, OD_H + 0.8, 0.8, '#232a33');
    for (const k of [-0.4, -0.13, 0.13, 0.4]) G.box(OD_U + OD_W * k, LY, SCR_Z - 0.5, 0.9, SCR_Y0 - 0.4 - LY, 0.9, '#8d969e');
    noTree.push([-30, 100, FZ(0) - 60, FZ(0) + 10]);
    // ネットの向こうの白い建物（尼崎の中継の写真にある。大きさは資料に無い）
    for (const q of FAR_BLDS) {
      G.box(q[0], LY, NET_W - 12, q[1], q[2], 17, '#d2d2cc'); G.box(q[0], LY + q[2], NET_W - 12, q[1] + 1, 0.5, 18, '#b9bcbd');
      for (let y = NET_H + 2.6; y < q[2] - 1.5; y += 4.2) A.sign(q[0], LY + y, NET_W - 3.45, q[1] - 3, 2.3, 0, R.glass);
    }
    // 照明塔（資料に位置・高さの数字は無い。ナイターの絵に必要なので対岸に 5 本。中継の記録「照明の縦の反射」に合わせ、灯が水面に映る）
    for (let k = -2; k <= 2; k++) {
      const x = uF(TOWER_X0 + k * TOWER_STEP), z = NET_W + 1.6, y = LY + TOWER_H;
      G.cyl(x, LY, z, 0.32, 0.6, TOWER_H - 1.5, 8, '#8d959c'); G.box(x, LY, z, 1.6, 0.8, 1.6, '#9b9a94');
      G.boxC(x, y, z + 0.3, 7.4, 4.2, 0.5, '#353c43', -0.28, 0);
      for (let r2 = 0; r2 < 3; r2++) for (let c2 = 0; c2 < 5; c2++) { const u = (c2 - 2) * 1.35, v = (r2 - 1) * 1.25; LG.boxC(x + u, y + v, z + 0.62 - v * 0.08, 1.0, 0.95, 0.1, '#ffffff', -0.28, 0); }
      const gp = toW(TF, x, y, z + 1.2); glowPts.push(gp.x, gp.y, gp.z);
    }
    setF(null);

    // ── 木立（資料に無い。対岸と両端とスタンドの裏の、地平線を作るための列） ──
    (function () {
      const ok = (x, z) => !noTree.some((q) => x > q[0] && x < q[1] && z > q[2] && z < q[3]);
      const step = low ? 24 : 15, put = (p, h) => { if (ok(p.x, p.z)) trees.push({ x: p.x, z: p.z, h: h }); };
      for (const row of [NET_W - 27, NET_W - 41]) for (let u = FL0 - 110; u < FL1 + 110; u += step * (0.75 + rnd() * 0.5)) put(toW(TF, u, 0, row - rnd() * 6), 9 + rnd() * 6);
      for (const x0 of [XA - 12, XB + 9]) for (let z = FZ(x0) - 10; z < SZ(x0) + DN; z += step * (0.8 + rnd() * 0.5)) put({ x: x0 + (x0 < 0 ? -1 : 1) * rnd() * 8, z: z }, 8 + rnd() * 5);
      for (let u = UL0 - 40; u < UL1 + 40; u += step * 2 * (0.7 + rnd() * 0.6)) put(toW(TS, u, 0, RF_Z1 + 16 + rnd() * 10), 7 + rnd() * 5);
    })();

    // ── 遠景（資料に無い。地平線を作るための街並みと山。橋・煙突・鉄塔などの作り物は置かない） ──
    (function () {
      const pal = ['#c9c7c0', '#b3b7bb', '#d6cfc0', '#9aa3ad', '#dcd9d0', '#b7a898', '#8f9399', '#c2b2a4', '#a4b0b8', '#e2ddd2'];
      const light = (x, y, z, col) => { cityPts.push(x, y, z); const c = C(col); cityCols.push(c.r, c.g, c.b); };
      // 窓の絵をくり返して貼った箱。屋上は窓のない所の色
      function cbox(x, z, w, d, h, col) {
        const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y0 = LY, y1 = LY + h, ou = Math.floor(rnd() * 8) / 8, ov = Math.floor(rnd() * 8) / 8, nv = Math.max(1, Math.round(h / 3.3)) / 8;
        const side = (ax, az, bx, bz, len) => { const nu = Math.max(1, Math.round(len / 3.6)) / 8; CT.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], col, [[ou, ov], [ou + nu, ov], [ou + nu, ov + nv], [ou, ov + nv]]); };
        side(x0, z1, x1, z1, w); side(x1, z0, x0, z0, w); side(x1, z1, x1, z0, d); side(x0, z0, x0, z1, d);
        const f = [0.004, 0.004]; CT.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col, [f, f, f, f]);
      }
      function bld(x, z, kind) {
        const col = pal[Math.floor(rnd() * pal.length)];
        let w, d, h;
        if (kind < 0.18) { w = 30 + rnd() * 40; d = 22 + rnd() * 20; h = 7 + rnd() * 6; F.box(x, LY, z, w, h, d, col); F.boxC(x, LY + h + 0.9, z, w, 1.8, d * 0.52, '#8f989f', 0.12); return; }   // 倉庫・工場
        if (kind < 0.36) { w = 12 + rnd() * 8; d = 12 + rnd() * 8; h = 38 + rnd() * 44; } else if (kind < 0.7) { w = 18 + rnd() * 26; d = 13 + rnd() * 10; h = 14 + rnd() * 22; } else { w = 10 + rnd() * 14; d = 9 + rnd() * 9; h = 7 + rnd() * 9; }
        cbox(x, z, w, d, h, col);
        if (h > 20) { F.box(x + (rnd() - 0.5) * w * 0.4, LY + h, z, w * 0.3, 2.6 + rnd() * 2, d * 0.4, '#9aa0a5'); if (h > 44) light(x, LY + h + 1.5, z, '#ff3b2e'); }
        if (rnd() < 0.5) light(x + (rnd() - 0.5) * w, LY + 5 + rnd() * 3, z + d / 2 + 3, rnd() < 0.7 ? '#ffd9a0' : '#e6efff');
      }
      const nS = low ? 46 : 84, nN = low ? 18 : 34, nE = low ? 9 : 17;
      for (let i = 0; i < nS; i++) { const x = (rnd() * 2 - 1) * 720; bld(x, FZ(x) - 84 - rnd() * rnd() * 300, rnd()); }
      for (let i = 0; i < nN; i++) { const x = (rnd() * 2 - 1) * 620; bld(x, SZ(x) + DN + 34 + rnd() * 210, rnd()); }
      for (let i = 0; i < nE; i++) { bld(XA - 70 - rnd() * 250, -120 + rnd() * 330, rnd()); bld(XB + 70 + rnd() * 250, -160 + rnd() * 330, rnd()); }
      for (let i = 0; i < (low ? 60 : 150); i++) { const a = rnd() * 6.283, rr = 380 + rnd() * 480; light(Math.cos(a) * rr, LY + 4 + rnd() * rnd() * 30, Math.sin(a) * rr * 0.75, rnd() < 0.65 ? '#ffd39a' : rnd() < 0.5 ? '#f2f6ff' : '#ffb070'); }   // 街灯・遠い窓
      // 山なみ（内側を向いた壁。霧でかすむ）
      function ridge(Rr, hMin, hMax, n, col, seed) {
        const r = srand(seed), hs = []; for (let i = 0; i < n; i++) hs.push(hMin + (hMax - hMin) * (0.5 + 0.5 * Math.sin(i * 0.9 + r() * 2)) * (0.5 + r() * 0.5));
        for (let i = 0; i < n; i++) {
          const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, h0 = hs[i], h1 = hs[(i + 1) % n];
          F.quad([Math.cos(a0) * Rr, 0, Math.sin(a0) * Rr], [Math.cos(a1) * Rr, 0, Math.sin(a1) * Rr], [Math.cos(a1) * (Rr + 60), h1, Math.sin(a1) * (Rr + 60)], [Math.cos(a0) * (Rr + 60), h0, Math.sin(a0) * (Rr + 60)], col);
        }
      }
      ridge(1100, 18, 62, 56, '#5f7a72', 5); ridge(1500, 50, 150, 44, '#6b8496', 9);
    })();

    // ── まとめたメッシュを作る ──
    const near = new T.Mesh(keep(G.build()), keep(detailMat(keep(detailTex())))); near.name = 'boat-venue-near'; near.castShadow = shadows; near.receiveShadow = shadows; near.frustumCulled = false; root.add(near);
    const far = new T.Mesh(keep(F.build()), keep(new T.MeshLambertMaterial({ vertexColors: true }))); far.name = 'boat-venue-far'; far.frustumCulled = false; root.add(far);
    const signs = new T.Mesh(keep(A.build(true)), keep(new T.MeshLambertMaterial({ map: atlas.tex, vertexColors: true, emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.28 }))); signs.name = 'boat-venue-signs'; signs.frustumCulled = false; root.add(signs);
    const ctex = cityTex(); keep(ctex.day); keep(ctex.night);
    const city = new T.Mesh(keep(CT.build(true)), keep(new T.MeshLambertMaterial({ map: ctex.day, vertexColors: true, emissive: 0xffffff, emissiveMap: ctex.night, emissiveIntensity: 0 }))); city.name = 'boat-venue-city'; city.frustumCulled = false; root.add(city);
    const lampMesh = new T.Mesh(keep(LG.build()), keep(new T.MeshBasicMaterial({ color: 0xffffff }))); lampMesh.name = 'boat-venue-lamps'; lampMesh.frustumCulled = false; root.add(lampMesh);
    // ターンマーク: つやのある蛍光色（少し自分で光って見える）。近くの物の「コンクリートの汚れ」は掛けない
    const markM = keep(new T.MeshPhongMaterial({ vertexColors: true, shininess: 30, specular: 0x0c0c0c }));
    markM.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.08;'); };
    const marks = new T.Mesh(keep(MK.build()), markM); marks.name = 'boat-venue-marks'; marks.castShadow = shadows; marks.receiveShadow = shadows; marks.frustumCulled = false; root.add(marks);
    // 風でなびく物（吹き流し・空中線の小旗）: 付け根を軸に、風下へ持ち上げて、ばたつかせる
    const flagG = keep(FL.build()); flagG.setAttribute('aHg', new T.Float32BufferAttribute(flH, 4)); flagG.setAttribute('aPh', new T.Float32BufferAttribute(flP, 1));
    const flagM = keep(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }));
    flagM.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.time; sh.uniforms.uFw = flagU.wind;
      sh.vertexShader = 'attribute vec4 aHg;\nattribute float aPh;\nuniform float uTime;\nuniform vec4 uFw;\n' + sh.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        ' vec3 fd = position - aHg.xyz;',
        ' float fb = 0.5 + 0.35 * sin( uTime * ( 11.0 + aPh * 4.0 ) + aPh * 40.0 - fd.y * 5.0 ) + 0.15 * sin( uTime * 4.3 + aPh * 17.0 );',   // ばたつき（0〜1。0.5 秒ほどで変わる）
        ' float fa = max( uFw.z * 1.5708 - uFw.w * 0.785 * fb + 0.03 * sin( uTime * 1.3 + aPh * 9.0 ), 0.0 );',                                // 持ち上がる角度（7m で 水平〜45° 下）
        ' float fy = uFw.w * 0.45 * sin( uTime * 2.1 + aPh * 23.0 );',                                                                         // 向きのふれ
        ' vec2 fw = vec2( uFw.x * cos( fy ) - uFw.y * sin( fy ), uFw.x * sin( fy ) + uFw.y * cos( fy ) );',
        ' vec3 fk = vec3( -fw.y, 0.0, fw.x );',                                                                                              // 回す軸（風に直角・水平）
        ' vec3 fr = fd * cos( fa ) + cross( fk, fd ) * sin( fa ) + fk * dot( fk, fd ) * ( 1.0 - cos( fa ) );',
        ' transformed = aHg.xyz + mix( fd, fr, aHg.w );'].join('\n'));
    };
    const flags = new T.Mesh(flagG, flagM); flags.name = 'boat-venue-flags'; flags.frustumCulled = false; root.add(flags);
    // 灯のにじみ（照明塔・屋根の照明）と、遠くの街の灯。夕方とナイターだけ見せる
    const gtex = keep(glowTex());
    const glowG = keep(new T.BufferGeometry()); glowG.setAttribute('position', new T.Float32BufferAttribute(glowPts, 3));
    const glow = new T.Points(glowG, keep(new T.PointsMaterial({ map: gtex, size: 30, sizeAttenuation: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false, color: 0xf4f8ff })));
    glow.name = 'boat-venue-glow'; glow.frustumCulled = false; glow.visible = false; root.add(glow);
    const cityG = keep(new T.BufferGeometry()); cityG.setAttribute('position', new T.Float32BufferAttribute(cityPts, 3)); cityG.setAttribute('color', new T.Float32BufferAttribute(cityCols, 3));
    const cityLights = new T.Points(cityG, keep(new T.PointsMaterial({ map: gtex, size: 7, sizeAttenuation: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, vertexColors: true, fog: false })));
    cityLights.name = 'boat-venue-citylights'; cityLights.frustumCulled = false; cityLights.visible = false; root.add(cityLights);

    // ── InstancedMesh: 観客・木 ──
    const _c = new T.Color(), m4 = new T.Matrix4();
    function inst(geo, material, n, name) { const me = new T.InstancedMesh(keep(geo), keep(material), n); me.name = name; me.frustumCulled = false; root.add(me); return me; }
    (function () {
      const pal = ['#1d1f24', '#1d1f24', '#2a2d35', '#2c3552', '#3a3f48', '#4a4640', '#5b5f66', '#6d6a62', '#8a8f98', '#d9d6cc', '#e6e6e6', '#9a2f2f', '#2f5a9a', '#b58a3a', '#3f6b4a', '#7a5a6e'].map(C);
      [0, 1].forEach((up) => {                                           // 座っている人と、立っている人（形が違うので 2 つのメッシュ）
        const list = people.filter((q) => (q.up ? 1 : 0) === up), me = inst(personGeo(!!up), tintMat(U, up ? 0.02 : 0.035), list.length, up ? 'boat-crowd-standing' : 'boat-crowd'); me.receiveShadow = shadows;
        list.forEach((q, i) => { me.setMatrixAt(i, m4.multiplyMatrices(TS, mat(q.x, q.y, q.z, q.s, q.sy, q.s, 0, Math.PI))); me.setColorAt(i, pal[Math.floor(rnd() * pal.length)]); });
      });
    })();
    (function () {
      const me = inst(treeGeo(low), tintMat(U, 0), trees.length, 'boat-trees');
      trees.forEach((q, i) => { me.setMatrixAt(i, m4.copy(mat(q.x, LY - 0.4, q.z, q.h * (1.25 + rnd() * 0.5), q.h, q.h * (1.25 + rnd() * 0.5), 0, rnd() * 6.28))); me.setColorAt(i, _c.setHSL(0.26 + rnd() * 0.07, 0.42 + rnd() * 0.16, 0.24 + rnd() * 0.09).convertSRGBToLinear()); });
    })();

    // ── 動かす所 ──
    let boardText = null;
    function setBoard(text) { text = text == null ? '' : String(text); if (text === boardText) return; boardText = text; drawBoard(boardCv, text); boardT.needsUpdate = true; }
    setBoard('');
    // 針は時計回り。正面から見て z まわりに「残り秒」の分だけ戻した角度
    function setClock(sec) { hand12.rotation.z = (sec == null || !isFinite(sec)) ? 0 : (sec / 12) * Math.PI * 2; }
    function setClock60(sec) {
      if (sec == null || !isFinite(sec)) { hand60.rotation.z = 0; hand60.visible = true; return; }
      hand60.rotation.z = (sec / 60) * Math.PI * 2;
      const f = (((-sec / 60) % 1) + 1) % 1; hand60.visible = !(f > 0.752 && f < 0.998);     // 1 分針遮蔽板: 真上から左回りに 90 度（＝残り 15 秒から 0 秒の手前まで）は隠れる
    }
    setClock(null); setClock60(null);
    // 影: カメラが見ている水面のあたりへ影の範囲を動かす（影の画素の刻みにそろえて、ちらつきを防ぐ）
    const up = new T.Vector3(0, 1, 0), lr = new T.Vector3().crossVectors(up, SUN).normalize(), lu = new T.Vector3().crossVectors(SUN, lr).normalize(), fwd = new T.Vector3(), foc = new T.Vector3();
    function followShadow(camera) {
      camera.getWorldDirection(fwd); camera.getWorldPosition(foc);
      let d = fwd.y < -0.02 ? foc.y / -fwd.y : 70; d = Math.min(Math.max(d, 8), 70);
      foc.addScaledVector(fwd, d); foc.y = 0;
      const tex = SH * 2 / 2048 * 4, a = Math.round(foc.dot(lr) / tex) * tex, b = Math.round(foc.dot(lu) / tex) * tex, c = foc.dot(SUN);
      foc.set(0, 0, 0).addScaledVector(lr, a).addScaledVector(lu, b).addScaledVector(SUN, c);
      sun.target.position.copy(foc); sun.position.copy(foc).addScaledVector(SUN, 260); sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
    }
    // ── 風と波（資料 11 の ①-1・③・⑤-3）──
    //   windDir（度）: 風が吹いていく向き。公式サイトの絵（下がスタンド・右が 1 マーク）の矢印と同じ決め方で、0 ＝ 真上（対岸へ）から時計回り。
    //     90 ＝ 追い風（スタート線を切って 1 マークへ走る艇の後ろから）、270 ＝ 向かい風、180 ＝ 対岸 → スタンドの横風。矢印の番号 arrow（1〜16。17 ＝ 無風）なら windDir ＝ (arrow − 1) × 22.5。
    //   windSpeed（m/s）・wave（波高 cm）。呼ばれなければ静かな水面（風 1m・波 1cm ＝ 鳴門の静かな日のコマ）。
    const seg = (x, pts) => { let i = 1; while (i < pts.length - 1 && x > pts[i][0]) i++; const a = pts[i - 1], b = pts[i], k = Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0]))); return a[1] + (b[1] - a[1]) * k; };
    const wxU = waterM.uniforms, flagU = { wind: { value: new T.Vector4(1, 0, 0, 0) } };   // 旗: 風下の向き (x, z)・なびく角度（0 ＝ たれ下がる、1 ＝ 水平）・ばたつき
    let driftV = 0;
    function setWeather(o) {
      o = o || {};
      let spd = Math.max(0, Number(o.windSpeed) || 0), wav = Math.max(0, Number(o.wave) || 0), dir = o.windDir;
      if (dir == null && o.arrow != null && o.arrow >= 1 && o.arrow <= 16) dir = (o.arrow - 1) * 22.5;
      if (o.arrow === 17) spd = 0;
      dir = (((Number(dir) || 0) % 360) + 360) % 360;
      const a = dir * Math.PI / 180, dx = Math.sin(a), dz = -Math.cos(a);          // 世界の向き: 0° ＝ −z（対岸へ）、90° ＝ ＋x（1 マークへ）
      // 見た目の段（資料 11 ⑤-3 の表。コマがあるのは 0・1・5・7・8m だけ。2〜3m は間を直線でつないだ仮）
      const look = {
        mirror: seg(spd, [[1, 1], [2.5, 0.45], [4, 0], [9, 0]]),                    // 映り込み: 0〜1m くっきり → 4〜5m 無し
        ripple: seg(spd, [[1, 0.3], [5, 1.0], [7, 1.35], [8, 1.5]]) + Math.min(0.2, wav * 0.012),   // さざ波: 5m で全面、7m で濃く粒が立つ
        gust: seg(spd, [[5, 0], [7, 1], [9, 1]]),                                   // 暗い帯（6〜8m）
        dark: seg(spd, [[3, 0], [5, 0.02], [7, 0.04], [9, 0.04]]),                  // 全体の暗さ（資料の言葉は「暗く」だが、コマの数字では手前がわずかに暗いだけ。鳴門 7m: 手前 (55,72,97)／静かな日 (49,84,108)）
        swell: seg(wav, [[2, 1], [7, 2.0], [15, 3.6]]),                             // うねり（波高）
        foam: seg(wav, [[8, 0], [15, 1], [30, 1]]),                                 // 泡の筋（本物は 7m・7cm では見えず、8m・15cm で少し。出はじめの 8cm は仮）
        flag: seg(spd, [[1, 0], [7, 1], [9, 1]]),                                   // 旗・吹き流し: 0〜1m たれ下がる → 7m 水平（間は直線。資料の目分量）
      };
      wxU.uWr.value.set(dx, dz, look.ripple, look.mirror); wxU.uWv.value.set(look.swell, look.gust, look.foam, look.dark);
      flagU.wind.value.set(dx, dz, look.flag, Math.min(1, spd / 7));
      driftV = 0.25 + spd * 0.12;                                                   // さざ波が風下へ流れる速さ（m/s。資料に数字が無い＝仮）
      const arrow = spd > 0 ? Math.round(dir / 22.5) % 16 + 1 : 17, tail = spd > 0 ? dx : 0;
      const label = spd <= 0 ? '無風' : (arrow >= 3 && arrow <= 7) ? '追い風' : (arrow >= 11 && arrow <= 15) ? '向かい風' : '横風';
      // 艇の側・表示の側に渡す今の値（資料 11 ⑤-3 の表の名前に合わせた）
      venue.weather = { windDir: dir, windSpeed: spd, wave: wav, arrow: arrow, label: label, tail: tail, dirX: dx, dirZ: dz, stabilizer: spd >= 7 || wav >= 7, look: look };
      return venue.weather;
    }
    function update(dt, t, camera) {
      U.time.value = t || 0;
      const dd = Math.min(0.1, Math.max(0, dt || 0)) * driftV, dv = wxU.uDrift.value; dv.x = (dv.x + dd) % 4096; dv.y = 0;   // 風にそった座標で流す
      if (shadows && camera) followShadow(camera);
    }
    // ── 時間帯（昼・夕方・ナイター）: 光・空・霧・水面の色・灯を入れ替える。作り直しはしない（空の絵だけ初回に作る） ──
    /* 2026-11-28 明るく作り直し（オーナー「暗い・どよーんとしている」「競馬に寄せてよい」）: 前は本物の中継のコマの色（昼の水 #1c2a2b〜#293e41 ＝ ほぼ黒に近い濃紺、夕方は灰色、ナイターは暗い緑）。
       昼 ＝ 晴れた昼のレース場（明るい青〜青緑の水・青い空）。夕方 ＝ 晴れた夕方（青い水に だいだいの光）。ナイター ＝ 照明で水面と艇が明るい（濃い青の空）。
       白い引き波・しぶきが見えるように、水は「白より 2 段暗い はっきりした青」で止める（空の映り込み skyH も白くしない）。光の数・影・解像度は変えていない（色と強さだけ） */
    const TOD = {
      day: { exp: 1.06, dir: [CO.SUN.x, CO.SUN.y, CO.SUN.z], sun: ['#fff1d8', 1.9], hemi: ['#d8eaff', '#8fa39c', 0.98], amb: ['#ffffff', 0.1], fill: ['#ffffff', 0], fog: '#d4ecfb', fogFar: 2200, sign: 0.28, city: 0, lamp: '#aeb3b8', glow: 0, lights: 0,
        w: { deep: '#106ca2', shal: '#1e86b8', skyH: '#74b6e8', skyZ: '#3585d4', sunC: '#fff6e0', net: '#3a7a62', bld: '#d2dadb', std: '#6f7880', gl: [5.0, 0.10], lamp: '#000000', board: '#0c1830', mk: '#f06a48' } },
      dusk: { exp: 1.08, dir: [-0.6, 0.23, -0.56], sun: ['#ffc27a', 2.2], hemi: ['#c6d6f4', '#9a8668', 0.86], amb: ['#ffe8cc', 0.14], fill: ['#ffe0bc', 0.3], fog: '#f4d6b0', fogFar: 1900, sign: 0.5, city: 0.4, lamp: '#fff3d6', glow: 0.35, lights: 0.55,
        w: { deep: '#1f6690', shal: '#317fa6', skyH: '#b4c6e6', skyZ: '#6f9fd8', sunC: '#ffb050', net: '#2f5a4c', bld: '#e0c8a2', std: '#6a5e50', gl: [1.0, 0.03], lamp: '#3a3426', board: '#1a2c52', mk: '#e8745a' } },
      night: { exp: 1.15, dir: [0.12, 0.8, 0.58], sun: ['#f4f7ff', 1.7], hemi: ['#5a72b4', '#2a3654', 0.7], amb: ['#a8b8e0', 0.3], fill: ['#e6eeff', 0.8], fog: '#1c2e56', fogFar: 1000, sign: 0.9, city: 1.0, lamp: '#ffffff', glow: 1.0, lights: 1.0,
        w: { deep: '#11567f', shal: '#196a92', skyH: '#2a4a76', skyZ: '#0d1e40', sunC: '#93a8cc', net: '#12332a', bld: '#4a4e50', std: '#5a5a52', gl: [0.0, 0.0], lamp: '#f2f6ff', board: '#1b2c58', mk: '#d0604a' } },
    };
    const DAY_HOUR = 13;
    const venue = { PIT: PIT, root: root, sun: sun, fill: fill, hemi: hemi, water: water, boards: boards, quality: low ? 'low' : 'high', timeOfDay: null, hour: 12, sunDir: SUN,
      clock: { x: ckx, y: CK_Y, z: ckz, nx: cnx, nz: cnz, d: CK_D },                                       // 大時計の中心・向き（文字盤の向く方）・直径
      stand: { roofY: RF_Y0, lampTopY: ROOF_LAMP_Y + 1.3, u0: SU0, u1: SU1, frontW: RF_Z0, backW: RF_Z1, angle: aS, at: (u, y, w) => toW(TS, u, y, w) } };   // スタンドの屋根（前の端の高さ・照明の上の端・岸からの奥行き）。at(岸にそった m, 高さ, 岸から奥へ m) → 世界の座標
    function setTime(hour) {
      let h = Number(hour); if (hour == null || !isFinite(h)) h = DAY_HOUR;   // 2026-11-28: 指定が無ければ 晴れた昼（前は今の時刻。15 時半から夕方・18 時半からナイターの絵 ＝ 全店のレースがある 19 時〜深夜は毎回ナイターの暗い絵だった）
      h = ((h % 24) + 24) % 24; venue.hour = h;
      const mode = (h >= 7 && h < 15.5) ? 'day' : (h >= 5 && h < 18.5) ? 'dusk' : 'night';
      if (mode === venue.timeOfDay) return;
      venue.timeOfDay = mode;
      const P = TOD[mode], W = P.w, wu = waterM.uniforms;
      renderer.toneMappingExposure = P.exp;
      SUN.set(P.dir[0], P.dir[1], P.dir[2]).normalize(); lr.crossVectors(up, SUN).normalize(); lu.crossVectors(SUN, lr).normalize();
      sun.color.set(P.sun[0]); sun.intensity = P.sun[1]; sun.target.position.set(0, 0, 0); sun.position.copy(SUN).multiplyScalar(260); sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
      hemi.color.set(P.hemi[0]); hemi.groundColor.set(P.hemi[1]); hemi.intensity = P.hemi[2];
      amb.color.set(P.amb[0]); amb.intensity = P.amb[1]; fill.color.set(P.fill[0]); fill.intensity = P.fill[1];
      fog.color.set(P.fog); fog.far = P.fogFar; if (scene.background && scene.background.isColor) scene.background.set(P.fog);
      if (!skyCache[mode]) { const phi = Math.atan2(SUN.z, -SUN.x), theta = Math.acos(SUN.y); skyCache[mode] = keep(skyTex(low, mode, ((phi / (Math.PI * 2)) % 1 + 1) % 1, theta / SKY_TH, P.fog)); }
      sky.material.map = skyCache[mode]; sky.material.needsUpdate = true;
      signs.material.emissiveIntensity = P.sign; city.material.emissiveIntensity = P.city;
      lampMesh.material.color.copy(C(P.lamp));
      glow.visible = P.glow > 0; glow.material.opacity = P.glow; cityLights.visible = P.lights > 0; cityLights.material.opacity = P.lights;
      wu.uSun.value.copy(SUN); wu.uGl.value.set(W.gl[0], W.gl[1]);
      wu.uDeep.value.copy(C(W.deep)); wu.uShal.value.copy(C(W.shal)); wu.uSkyH.value.copy(C(W.skyH)); wu.uSkyZ.value.copy(C(W.skyZ)); wu.uSunCol.value.copy(C(W.sunC));
      wu.uNet.value.copy(C(W.net)); wu.uBld.value.copy(C(W.bld)); wu.uStd.value.copy(C(W.std)); wu.uLampCol.value.copy(C(W.lamp)).multiplyScalar(mode === 'night' ? 8.0 : 1); wu.uBoardCol.value.copy(C(W.board)); wu.uMkCol.value.copy(C(W.mk));
      markM.color.setScalar(mode === 'night' ? 0.75 : mode === 'dusk' ? 0.9 : 1);   // 照明の下でも赤が白く飛ばないように（桐生のコマでは赤がはっきり赤い）
    }
    setTime(opts.hour);
    setWeather({ windDir: 90, windSpeed: 1, wave: 1 });                            // 呼ばれるまでは静かな水面
    function dispose() {
      scene.remove(root); scene.remove(sun); scene.remove(sun.target); scene.remove(hemi); scene.remove(amb); scene.remove(fill);
      if (sun.shadow && sun.shadow.map) sun.shadow.map.dispose();
      trash.forEach((o) => o && o.dispose && o.dispose());
      scene.fog = prevFog; scene.background = prevBg;
    }
    venue.update = update; venue.setClock = setClock; venue.setClock60 = setClock60; venue.setBoard = setBoard; venue.setTime = setTime; venue.setWeather = setWeather; venue.dispose = dispose;
    return venue;
  }

  return { build: build, LAND_Y: LAND_Y };
})();
