/* casa DERBY 3D: 会場（担当: 会場の美術）
   R3D.Venue.build(scene, { quality }) -> venue
     コース（芝・内側のダート・ラチ・ハロン棒・ゴール板）、スタンドと観客、木立・街並み・遠くの丘、内馬場（池・ターフビジョン・道）、発走ゲート、パドック
   ・形の基準は R3D.Course（pointAt / laneR / startS / RI / RO / FINISH_S / PADDOCK）だけ。模様はすべて CanvasTexture にコードで描く。
   ・描画呼び出しを減らすため、動かない物は材質ごとに 1 つのジオメトリへまとめる（自前の Geo）。同じ形の大量の物（観客・ラチの支柱・木）は InstancedMesh。
   ・色は sRGB の 16 進で書き、線形に直して使う（renderer.outputEncoding = sRGBEncoding が前提）。
   venue.setCues(cues)  隠れた確定演出（2026-10-16）。cues = { fruit: { horse }, crowd: { horse }, sign: { horse }, cloud: { horse }, … }（horse は馬番の添字 0〜5。
     1 白・2 黒・3 赤・4 青・5 黄・6 緑の枠色＝FRAME）。知らない鍵は無視、鍵が無い・null はその演出なし。setCues(null) で全部ふつうに戻る。
     いつ呼んでもよい（レース前・レースの合間）。すぐ効く（uniform・instanceColor・canvas の描き直しだけ。形は作り直さない）。
     会場を作り直しても（画質の切り替え）最後に渡した cues をそのまま使う。venue.cues で今の値を読める。
       fruit: コースの近くの木・植え込み・外ラチの生け垣（向正面〜4 コーナー）・スタンド前の花壇に、枠色ごとの果物が実る（2026-10-17）:
              1 白＝白桃・2 黒＝巨峰・3 赤＝りんご・4 青＝ブルーベリー・5 黄＝レモン・6 緑＝マスカット（房は葉の下から下がる）。うっすら自発光＋縁の光。
              ふだんは木に小さなくすんだ茶の実が少しだけ（果物は出ない）
       crowd: 観客全体の 55% が枠色の服になる（スタンドの段の模様・広場・パドック・座席の全部。ふだんの色の混ざり方は元のまま）。さらに内馬場の縁（最後の直線の奥）・向正面・
              最終コーナーの外の応援団（大きな旗つき）の 95% と、そこに並ぶのぼり、スタンドの屋根の旗の半分、ゴール板の脇の旗が枠色になる（レース中のカメラにも映る）
       sign:  casa DERBY の広告（向正面の大看板 3 枚・ゴール前の広告板の 1 枚おき・スタンドの手すり壁）の板全体が枠色になり、枠色のゼッケンの馬の影絵が入る（数字は出さない。ロゴは左の小さな板の上）。
              ゴール前の内ラチの横断幕とターフビジョンの枠も枠色になる
       cloud: ここでは無視。照明担当の look.setCues(cues)（同じ cues をそのまま渡す）が受け持つ（空の雲の 1 つが馬番の数字の形になる） */
window.R3D = window.R3D || {};
R3D.Venue = (function () {
  'use strict';
  const T = window.THREE, CO = R3D.Course;
  const LS = CO.LS, RC = CO.RC, L = CO.L, RI = CO.RI, RO = CO.RO, FINISH_S = CO.FINISH_S;
  const CUR = Math.PI * RC;                      // コーナー 1 つの長さ
  const ZS = RO + 42, SX0 = -182, SX1 = 262;     // スタンド前面の z と左右の端
  const VIS = { x: 150, z: 16, w: 30, h: 10, y0: 2.6 }; // 内馬場のターフビジョン（スタンドへ向く）
  const DIN = RI - 16, DOUT = RI - 5;            // 内側のコース（ダート）の内・外
  const WHEEL = { x: -150, z: -238, r: 30, y: 36 }; // 向正面の奥の街の観覧車
  const POND = [[-150, -18], [-122, -29], [-90, -32], [-62, -28], [-52, -19], [-62, -11], [-86, -8], [-112, -7], [-136, -9], [-148, -12]];
  const FRAME = ['#ffffff', '#1e1e1e', '#e8322e', '#2a62d9', '#f7d21e', '#2fa84f'], INK = ['#222', '#fff', '#fff', '#fff', '#fff', '#fff'];   // 枠色（ref/minnade/STYLE.md 1-4）
  const TURF_HI = '#64a03f', TURF_MID = '#619c3d', TURF_LO = '#5e973b';   // 芝の刈り込みの帯（明・境目・暗）。画面では日なたで約 1.1 倍明るく出る
  const LEAF_BASE = '#609c4c', HEDGE = '#4f8a3e';   // 2026-10-14（講評 92→95 の 3）: 画面で #4B853C〜#67954E に出る緑（前は #64a644）   // 木の葉・植え込みの緑
  const FONT = '"Noto Sans JP", "Hiragino Sans", sans-serif'; // 2026-10-21 Noto Sans JP に統一（看板は会場を作るときに 1 回描く。読み込み前なら予備の文字）
  /* ---------- 隠れた確定演出（setCues）の色 ----------
     木の実: 白は少し明るい白（上の面が光る）、黒は濃い灰に強めのハイライト、緑は葉より明るい緑。ふだんはくすんだ茶（FRUIT_NEUTRAL）。
     服: 枠色を布らしく少し落ち着かせた色。 */
  /* 2026-10-16 オーナー「もっとわかりやすく」: 実は 2 倍の大きさ・数を増やし、太陽を向いた面が白く光る（HI）。下の面は暗く（LO。白い実の縁取りの代わり）。
     緑は葉よりはっきり明るい黄緑、白は真っ白＋暗い下面、黒はつやのある黒＋強い光 */
  const CUE_FRUIT = ['#ffffff', '#121214', '#ff2a1e', '#2a5cff', '#ffd400', '#9cf03c'], CUE_FRUIT_HI = [0.0, 0.75, 0.35, 0.35, 0.22, 0.4], CUE_FRUIT_LO = [0.55, 0.0, 0.3, 0.3, 0.3, 0.25], FRUIT_NEUTRAL = '#7d6e42';
  const FRUIT_OFF_SCALE = 0.42;   /* ふだんの実の大きさ（演出時の倍率 1 に対して。前の小さな実に戻す）。ふだんは「ふだん用の実」だけ描き、「演出用の実」は大きさ 0 で消す */
  const HEDGE_KNOB = '#4a8238';   /* 外ラチの生け垣の上の実のかたまり: ふだんは生け垣と同じ緑（目立たない）。fruit のときだけ枠色 */
  const CUE_CLOTH = ['#f6f6f4', '#1a1a1d', '#d8362f', '#2d63d0', '#f0cf2a', '#2f9f4c'];
  const CUE_CROWD_P = 0.55;   /* 観客全体のうち枠色の服になる割合（2026-10-16 2 回目: 鮮やかな服の 85% → 全員の 55%。服の色に関わらず） */
  const CUE_FAN_P = 0.95;     /* 応援団（内馬場・向正面・最終コーナーの柵の後ろ）のうち枠色になる割合 */
  let CUES = null;            /* 最後に setCues で渡された値（会場を作り直しても使う） */
  function cueHorse(cues, key) { const c = cues && cues[key]; if (!c || c.horse == null) return -1; const h = Math.floor(+c.horse); return h >= 0 && h <= 5 ? h : -1; }
  // 新しいロゴの横長版（看板の casa DERBY の広告に貼る。2026-10-14）。読めたら看板の模様を描き直す。読めなければ文字の広告のまま
  const LOGO_URL = (() => { try { return new URL('../../art/logo-3d/B/lockup-3d-B-casaWhite.svg', document.currentScript.src).href; } catch (e) { return 'art/logo-3d/B/lockup-3d-B-casaWhite.svg'; } })();

  /* ================= 小道具 ================= */
  function srand(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  const CC = {};
  // ColorManagement.legacyMode = false（照明担当が設定）のときは new Color(hex) がすでに線形へ直すので、二重に直さない
  function C(hex) { if (!CC[hex]) { const c = new T.Color(hex); if (!T.ColorManagement || T.ColorManagement.legacyMode !== false) c.convertSRGBToLinear(); CC[hex] = c; } return CC[hex]; }
  const vary = (c, k, r) => c.clone().multiplyScalar(1 + (r() - 0.5) * k);
  const _E = new T.Euler(), _Q = new T.Quaternion(), _P = new T.Vector3(), _S = new T.Vector3();
  function mat(x, y, z, sx, sy, sz, ry, rx) { _E.set(rx || 0, ry || 0, 0, 'YXZ'); _Q.setFromEuler(_E); return new T.Matrix4().compose(_P.set(x, y, z), _Q, _S.set(sx, sy, sz)); }
  // z 軸まわりに回した箱などの行列（位置・z 回転・大きさ）
  function matZ(x, y, z, sx, sy, sz, rz) { _E.set(0, 0, rz, 'XYZ'); _Q.setFromEuler(_E); return new T.Matrix4().compose(_P.set(x, y, z), _Q, _S.set(sx, sy, sz)); }
  const hash3 = (x, y, z) => { const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return v - Math.floor(v); };

  /* ---------- まとめ用のジオメトリ（位置・法線・UV・頂点色・tint） ----------
     tint: InstancedMesh の色をどれだけ掛けるか（0 = 掛けない、1 = 全部）。観客の服・木の葉だけに色の違いを付けるのに使う */
  function Geo() { this.p = []; this.n = []; this.u = []; this.c = []; this.t = []; this.f = []; this.i = []; this.nv = 0; }
  const F0 = [0, 0, 0, 0];   /* aFruit: 木の実の中心 (x,y,z) と w（0 = ふだんから描く実、1 = 演出のときだけ描く実）。実以外は 0 */
  const _v = new T.Vector3(), _w = new T.Vector3(), _m3 = new T.Matrix3();
  Geo.prototype.vert = function (x, y, z, nx, ny, nz, u, v, col, tint, fr) {
    const c = typeof col === 'function' ? col(x, y, z, nx, ny, nz) : col, f = fr || F0;
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v); this.c.push(c.r, c.g, c.b); this.t.push(tint || 0); this.f.push(f[0], f[1], f[2], f[3]);
    return this.nv++;
  };
  // 既存のジオメトリを行列で動かして足す。o: { tint, tintf(x,y,z)->tint（頂点ごと）, uvf(x,y,z,nx,ny,nz)->[u,v], uvT:[u0,v0,su,sv] }
  Geo.prototype.add = function (g, m, col, o) {
    o = o || {};
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, n = P.count, base = this.nv, uT = o.uvT;
    if (m) _m3.getNormalMatrix(m);
    for (let k = 0; k < n; k++) {
      _v.fromBufferAttribute(P, k); if (m) _v.applyMatrix4(m);
      if (N) { _w.fromBufferAttribute(N, k); if (m) _w.applyMatrix3(_m3).normalize(); } else _w.set(0, 1, 0);
      let u = U ? U.getX(k) : 0, v = U ? U.getY(k) : 0;
      if (o.uvf) { const t = o.uvf(_v.x, _v.y, _v.z, _w.x, _w.y, _w.z); u = t[0]; v = t[1]; } else if (uT) { u = uT[0] + u * uT[2]; v = uT[1] + v * uT[3]; }
      this.vert(_v.x, _v.y, _v.z, _w.x, _w.y, _w.z, u, v, col, o.tintf ? o.tintf(_v.x, _v.y, _v.z) : o.tint, o.fruit);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) this.i.push(base + g.index.getX(k));
    else for (let k = 0; k < n; k++) this.i.push(base + k);
  };
  Geo.prototype.box = function (x, y, z, sx, sy, sz, col, ry, o) { this.add(BOX, mat(x, y, z, sx, sy, sz, ry), col, o); };
  // 四角形 a→b→c→d（表から見て反時計回り）。hint を渡すと、法線がその向きになるよう並びを直す
  Geo.prototype.quad = function (a, b, c, d, col, uv, tint, hint) {
    const ex = c[0] - a[0], ey = c[1] - a[1], ez = c[2] - a[2], fx = d[0] - b[0], fy = d[1] - b[1], fz = d[2] - b[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    uv = uv || [0, 0, 1, 0, 1, 1, 0, 1];
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { const t = b; b = d; d = t; uv = [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]]; nx = -nx; ny = -ny; nz = -nz; }
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, uv[0], uv[1], col, tint), i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, uv[2], uv[3], col, tint);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, uv[4], uv[5], col, tint), i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, uv[6], uv[7], col, tint);
    this.i.push(i0, i1, i2, i0, i2, i3);
  };
  Geo.prototype.tri = function (a, b, c, col, hint, uvf) {
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
    const uv = (p) => (uvf ? uvf(p[0], p[1], p[2]) : [0, 0]);
    const ua = uv(a), ub = uv(b), uc = uv(c);
    this.i.push(this.vert(a[0], a[1], a[2], nx, ny, nz, ua[0], ua[1], col), this.vert(b[0], b[1], b[2], nx, ny, nz, ub[0], ub[1], col), this.vert(c[0], c[1], c[2], nx, ny, nz, uc[0], uc[1], col));
  };
  Geo.prototype.build = function () {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.setAttribute('tint', new T.Float32BufferAttribute(this.t, 1));
    g.setAttribute('aFruit', new T.Float32BufferAttribute(this.f, 4));
    g.setIndex(this.nv > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };
  const BOX = new T.BoxGeometry(1, 1, 1);
  // 多角形（地面の上の (x,z) の並び）を三角形に分けて上向きに貼る
  function polyFill(g, pts, y, col, uvf) {
    const tris = T.ShapeUtils.triangulateShape(pts.map(([x, z]) => new T.Vector2(x, z)), []);
    for (const [a, b, c] of tris) g.tri([pts[a][0], y, pts[a][1]], [pts[b][0], y, pts[b][1]], [pts[c][0], y, pts[c][1]], col, [0, 1, 0], uvf);
  }

  /* ---------- コースに沿った道のり ---------- */
  function isCurve(s) { const m = ((s % L) + L) % L; return (m >= LS && m < LS + CUR) || m >= 2 * LS + CUR; }
  // s0〜s1 を、直線は step m ごと、コーナーは deg 度ごとに刻む（直線とコーナーの境目は必ず入れる）
  function sList(s0, s1, deg, step) {
    const BR = [0, LS, LS + CUR, 2 * LS + CUR, L], dc = RC * deg * Math.PI / 180, out = [s0];
    let s = s0;
    while (s < s1 - 1e-6) {
      const m = ((s % L) + L) % L, base = s - m; let nb = L;
      for (let k = 0; k < BR.length; k++) if (BR[k] > m + 1e-6) { nb = BR[k]; break; }
      s = Math.min(base + nb, s1, s + (isCurve(s) ? dc : step));
      out.push(s);
    }
    return out;
  }
  // コースの外向き（半径 1 の差で求める。中心線 r=0 のコーナーでも正しい）
  function outAt(s) { const a = CO.pointAt(s, 0), b = CO.pointAt(s, 1); return { x: b.x - a.x, z: b.z - a.z }; }
  function cpath(r, s0, s1, deg, step) { return sList(s0, s1, deg || 1.5, step || 20).map((s) => { const p = CO.pointAt(s, r), o = outAt(s); return { x: p.x, z: p.z, ox: o.x, oz: o.z, s }; }); }
  // 断面 prof（[外向きのずれ, 高さ] の折れ線。外向きを右・上を上にして反時計回りに並べると表が外側）を道のりに沿って掃く
  function sweep(g, path, prof, col, uvf, tint) {
    for (let j = 0; j + 1 < prof.length; j++) {
      const q0 = prof[j], q1 = prof[j + 1];
      for (let k = 0; k + 1 < path.length; k++) {
        const A = path[k], B = path[k + 1];
        const a = [A.x + A.ox * q0[0], q0[1], A.z + A.oz * q0[0]], b = [B.x + B.ox * q0[0], q0[1], B.z + B.oz * q0[0]];
        const c = [B.x + B.ox * q1[0], q1[1], B.z + B.oz * q1[0]], d = [A.x + A.ox * q1[0], q1[1], A.z + A.oz * q1[0]];
        g.quad(a, b, c, d, col, uvf ? [].concat(uvf(A, q0, a), uvf(B, q0, b), uvf(B, q1, c), uvf(A, q1, d)) : null, tint);
      }
    }
  }
  const worldUV = (k) => (P, q, w) => [w[0] / k, w[2] / k];
  const flUV = (x, y, z) => [x / 4, z / 4];   // 花壇の UV（4m 四方）

  /* ================= テクスチャ（すべてコードで描く） ================= */
  function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c, o) {
    o = o || {};
    const sm = XMQ ? shrinkCv(c) : c, t = new T.CanvasTexture(sm);
    t.wrapS = t.wrapT = o.clamp ? T.ClampToEdgeWrapping : T.RepeatWrapping;
    t.anisotropy = XMQ ? 2 : 16; t.encoding = T.sRGBEncoding;
    if (sm !== c) Object.defineProperty(t, 'needsUpdate', { set(v) { if (v === true) { shrinkCv(c, sm); this.version++; this.source.needsUpdate = true; } } }); // 元の絵（c）を描き直したら（看板・掲示板・観客の絵の演出）、小さい写しも描き直す
    return t;
  }
  /* 軽い 3D（2026-10-29。最もなめらか＝XMQ。オーナー: 見た目が変わりうる軽くする所は最もなめらかだけ）: GPU に送る絵は長い辺 XL_TEX 画素まで（大きい絵は半分・4 分の 1 に縮めた写し）。
     映像の細かさ 0.4〜0.5 倍では大きい絵の細かさは見えない。GPU のメモリと最初に送る時間（場面の切り替えの止まり）が減る */
  const XL_TEX = 512;
  function shrinkCv(c, dst) {
    const k = Math.min(1, XL_TEX / Math.max(c.width || 1, c.height || 1)); if (k >= 1 && !dst) return c;
    const d = dst || cv(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k))), g = d.getContext('2d');
    g.clearRect(0, 0, d.width, d.height); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, d.width, d.height); return d;
  }
  // 画素ごとのざらつき
  function grain(g, w, h, amt, seed, chroma) {
    const id = g.getImageData(0, 0, w, h), d = id.data, r = srand(seed);
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amt, m = chroma ? (r() - 0.5) * chroma : 0; d[i] += n + m; d[i + 1] += n; d[i + 2] += n * 0.8 - m; }
    g.putImageData(id, 0, 0);
  }
  // 端でつながる楕円の点
  function blot(g, W, H, x, y, rx, ry, rot) {
    for (let dx = -W; dx <= W; dx += W) for (let dy = -H; dy <= H; dy += H) {
      const X = x + dx, Y = y + dy, R = Math.max(rx, ry);
      if (X + R < 0 || X - R > W || Y + R < 0 || Y - R > H) continue;
      g.beginPath(); g.ellipse(X, Y, rx, ry, rot || 0, 0, 6.2832); g.fill();
    }
  }
  // 芝: 横（u）＝進む向き 20m（明るい帯・暗い帯 各 10m）、縦（v）＝コース幅。canvas の下（v=0）が内ラチ側
  function turfTex() {
    const W = 1024, H = 512, c = cv(W, H), g = c.getContext('2d'), r = srand(31);
    // 2026-10-14（講評 v2-1 の 2）: 彩度を抑えた芝（画面で #78B64D〜#83BC53 に出る色）、刈り込みの帯は控えめ（明暗の差 約 6%）、細かいざらつきを減らした
    const gr = g.createLinearGradient(0, 0, W, 0);
    [[0, TURF_HI], [0.44, TURF_HI], [0.5, TURF_MID], [0.56, TURF_LO], [0.94, TURF_LO], [1, TURF_HI]].forEach(([k, col]) => gr.addColorStop(k, col));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // 草のむら（大きくゆるいしみ。小さな斑点は遠くでちらつくので使わない）
    for (let k = 0; k < 260; k++) { g.fillStyle = r() < 0.5 ? 'rgba(170,196,110,' + (0.025 + r() * 0.03).toFixed(3) + ')' : 'rgba(52,92,40,' + (0.025 + r() * 0.03).toFixed(3) + ')'; blot(g, W, H, r() * W, r() * H, 18 + r() * 50, 8 + r() * 20, r() * 3); }
    // 刈り込みの細い筋（進む向きに長い。ごく弱く）
    for (let k = 0; k < 200; k++) { g.fillStyle = r() < 0.5 ? 'rgba(240,248,210,' + (0.012 + r() * 0.02).toFixed(3) + ')' : 'rgba(30,62,20,' + (0.015 + r() * 0.02).toFixed(3) + ')'; g.fillRect(0, r() * H, W, 2 + r() * 3); }
    // ラチの足元（コースの両端 約 0.4m）: 草が伸びて少し暗い＝ラチの接地感（影の無い軽い画質でもラチが浮かない）
    for (const [y0, y1] of [[0, 9], [H, H - 9]]) { const e = g.createLinearGradient(0, y0, 0, y1); e.addColorStop(0, 'rgba(40,62,30,.30)'); e.addColorStop(1, 'rgba(40,62,30,0)'); g.fillStyle = e; g.fillRect(0, Math.min(y0, y1), W, 9); }
    // 内ラチ沿いの傷み（土が見える）
    for (let k = 0; k < 2600; k++) {
      const v = Math.pow(r(), 2.3) * 0.42, y = H * (1 - v), a = Math.max(0, 0.42 - v) * 1.15;
      g.fillStyle = 'rgba(' + (148 + r() * 40 | 0) + ',' + (132 + r() * 28 | 0) + ',' + (78 + r() * 26 | 0) + ',' + a.toFixed(3) + ')';
      blot(g, W, H, r() * W, y, 1.2 + r() * 5, 0.8 + r() * 2.2, (r() - 0.5) * 0.5);
    }
    // 蹄の跡・小さな土の点（内ラチ寄りに多い。数と濃さは控えめ）
    for (let k = 0; k < 2600; k++) { const v = Math.pow(r(), 1.4); g.fillStyle = 'rgba(' + (105 + r() * 40 | 0) + ',' + (95 + r() * 30 | 0) + ',' + (60 + r() * 20 | 0) + ',' + (0.06 + r() * 0.14 * (1 - v)).toFixed(3) + ')'; blot(g, W, H, r() * W, H * (1 - v), 0.6 + r() * 1.6, 0.5 + r() * 1.0, 0); }
    // 葉先（弱く）
    for (let k = 0; k < 4000; k++) { g.fillStyle = r() < 0.6 ? 'rgba(196,220,150,.1)' : 'rgba(36,66,26,.1)'; g.fillRect(r() * W, r() * H, 1, 1 + r() * 2); }
    grain(g, W, H, 9, 7, 3);
    return tex(c);
  }
  // ダート: 横 20m・縦コース幅。ハローの筋（進む向き）と蹄の跡
  function dirtTex() {
    const W = 1024, H = 512, c = cv(W, H), g = c.getContext('2d'), r = srand(41);
    g.fillStyle = '#c4935a'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 260; k++) { g.fillStyle = r() < 0.5 ? 'rgba(220,200,165,.12)' : 'rgba(120,95,65,.12)'; blot(g, W, H, r() * W, r() * H, 10 + r() * 60, 4 + r() * 18, r() * 3); }
    for (let y = 0; y < H; y += 2 + r() * 3) { g.fillStyle = r() < 0.5 ? 'rgba(235,220,190,' + (0.05 + r() * 0.1).toFixed(3) + ')' : 'rgba(95,72,48,' + (0.05 + r() * 0.1).toFixed(3) + ')'; g.fillRect(0, y, W, 1); }
    for (let k = 0; k < 6000; k++) { g.fillStyle = 'rgba(' + (85 + r() * 40 | 0) + ',' + (66 + r() * 30 | 0) + ',' + (45 + r() * 20 | 0) + ',' + (0.12 + r() * 0.22).toFixed(3) + ')'; blot(g, W, H, r() * W, r() * H, 1 + r() * 2.6, 0.6 + r() * 1.4, (r() - 0.5) * 0.6); }
    for (let k = 0; k < 3000; k++) { g.fillStyle = 'rgba(245,232,205,.25)'; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1); }
    grain(g, W, H, 30, 9, 6);
    return tex(c);
  }
  // 内馬場・地面の草（世界座標で 48m 四方。24m の市松に刈る）
  function grassTex(plain) {
    const W = 512, c = cv(W, W), g = c.getContext('2d'), r = srand(plain ? 52 : 51);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = plain ? '#7aae4c' : (i + j) % 2 ? '#78ac4b' : '#7fb351'; g.fillRect(i * 256, j * 256, 256, 256); }   // 芝コースと同じ落ち着いた緑（講評 v2-1 の 2）
    if (plain) for (let k = 0; k < 160; k++) { g.fillStyle = r() < 0.5 ? 'rgba(160,190,80,.14)' : 'rgba(60,100,30,.14)'; blot(g, W, W, r() * W, r() * W, 20 + r() * 60, 14 + r() * 40, r() * 3); }
    for (let k = 0; k < 260; k++) { g.fillStyle = r() < 0.5 ? 'rgba(170,200,90,.08)' : 'rgba(40,90,25,.09)'; blot(g, W, W, r() * W, r() * W, 6 + r() * 30, 4 + r() * 16, r() * 3); }
    for (let k = 0; k < 3500; k++) { g.fillStyle = r() < 0.6 ? 'rgba(196,220,150,.1)' : 'rgba(36,66,26,.11)'; g.fillRect(r() * W, r() * W, 1, 1 + r() * 2); }
    grain(g, W, W, 9, 11, 3);
    return tex(c);
  }
  // 近くで見たときの細かい模様（灰色・平均 0.5。地面の色に掛けて、草の葉・土の粒に見せる）
  function detailTex() {
    const W = 256, c = cv(W, W), g = c.getContext('2d'), r = srand(97);
    g.fillStyle = '#808080'; g.fillRect(0, 0, W, W);
    for (let k = 0; k < 9000; k++) { const v = r() < 0.5 ? 70 + r() * 40 : 150 + r() * 60; g.fillStyle = 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + (v | 0) + ',.55)'; g.fillRect(r() * W, r() * W, 1, 2 + r() * 4); }
    grain(g, W, W, 40, 98);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 16; return t;   // 色ではない（線形のまま）
  }
  // 地面の材質に細かい模様を足す（uv × scale で繰り返す）
  function detailPatch(m, dtex, scale, amt) {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.uDetail = { value: dtex };
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\n diffuseColor.rgb *= mix(1.0, texture2D(uDetail, vUv * ' + scale.toFixed(1) + ').r * 2.0, ' + amt.toFixed(2) + ');\n#endif');
    };
    m.customProgramCacheKey = () => 'venueDetail' + scale + '/' + amt + (m.type);
    dtex.userData = { linear: true };
    return m;
  }
  // 葉のかたまり（灰色。色は頂点色と木ごとの色で付ける）
  function leafTex() {
    const W = 256, c = cv(W, W), g = c.getContext('2d'), r = srand(61);
    // 2026-10-14（講評 v2-1 の 2）: 細かいざらつきを減らし、大きめの葉の房のむらに（平均の明るさは前と同じ約 0.82）
    g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, W, W);
    for (let k = 0; k < 520; k++) { const v = 172 + r() * 66 | 0; g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',.38)'; blot(g, W, W, r() * W, r() * W, 5 + r() * 10, 4 + r() * 7, r() * 3); }
    for (let k = 0; k < 160; k++) { g.fillStyle = 'rgba(96,96,96,.24)'; blot(g, W, W, r() * W, r() * W, 2 + r() * 3, 1.5 + r() * 2, 0); }
    grain(g, W, W, 10, 13);
    return tex(c);
  }
  // 花壇（4m 四方）: 濃い緑の葉に白・橙・黄の小さな花。頂点色で全体の色味を変える
  function flowerTex() {
    const W = 256, c = cv(W, W), g = c.getContext('2d'), r = srand(67);
    g.fillStyle = '#3b6a2a'; g.fillRect(0, 0, W, W);
    for (let k = 0; k < 900; k++) { g.fillStyle = r() < 0.5 ? 'rgba(90,150,60,.5)' : 'rgba(25,60,20,.5)'; blot(g, W, W, r() * W, r() * W, 2 + r() * 5, 1.5 + r() * 3, r() * 3); }
    const cols = ['#ffffff', '#ffffff', '#fff6e8', '#ffa23a', '#ffd23f', '#e6a4cf', '#e6a4cf'];
    for (let k = 0; k < 4200; k++) {
      const x = r() * W, y = r() * W, rad = 2.2 + r() * 2.2; g.fillStyle = cols[(r() * cols.length) | 0];
      for (let q = 0; q < 5; q++) { const a = q * 1.2566 + r(); blot(g, W, W, x + Math.cos(a) * rad * 0.7, y + Math.sin(a) * rad * 0.7, rad * 0.6, rad * 0.6, 0); }
      g.fillStyle = '#f4c430'; blot(g, W, W, x, y, rad * 0.35, rad * 0.35, 0);
    }
    grain(g, W, W, 18, 69);
    return tex(c);
  }
  // 足元の影（ぼかした丸。黒＋透明度）
  function blobTex() {
    const W = 64, c = cv(W, W), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    gr.addColorStop(0, 'rgba(0,0,0,0.62)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, W);
    return tex(c, { clamp: true });
  }
  // スタンドの観客席（横 48m・縦 8 列。各列 1m。下の列が前。通路は 12m と 36m の所）。
  // 席ごとに: 空席のむら（ゆっくり変わる）、座る・立つ・両手を上げる・新聞・帽子・子ども、6m ごとの仲間の服の色。
  // 細かい斑点に見えないよう、ざらつきは弱く、人の形（肩の四角と頭の丸）がはっきりした大きさで並ぶ
  // cueCol: 隠れた確定演出の服の色（無ければ null）。乱数の列は cueCol の有無で変わらない（席の並びは同じで服の色だけ変わる）
  function crowdTex(c, cueCol) {
    const W = 2048, H = 512, g = c.getContext('2d'), r = srand(71), cr = srand(72), PX = W / 48, RH = H / 8;
    const pal = CALM, hats = HATS;   // 2026-10-14（講評 92→95 の 3）: 手前の観客と同じ落ち着いた色。鮮やかな服は 15%
    const occ = (x, row) => 0.62 + 0.3 * Math.sin(x * 0.011 + row * 0.6) * Math.sin(x * 0.0047 + 1.1) + 0.12 * Math.sin(x * 0.031 + row * 1.7);
    const aisle = (x) => Math.abs(x - 512) < 24 || Math.abs(x - 1536) < 24;
    const groupCol = []; for (let k = 0; k < 9; k++) groupCol.push(r() < 0.45 ? pal[(r() * pal.length) | 0] : null);
    for (let row = 0; row < 8; row++) {
      const y0 = row * RH;
      g.fillStyle = '#69717a'; g.fillRect(0, y0, W, RH);                          // 座席（灰。青みは控えめ）
      g.fillStyle = '#3a4048'; g.fillRect(0, y0 + RH * 0.84, W, RH * 0.16);       // 段の陰
      for (let x = 3; x < W - 8; x += PX * (0.5 + r() * 0.06)) {
        if (aisle(x + PX * 0.2)) continue;
        const w = PX * (0.36 + r() * 0.08);
        if (r() > occ(x, row)) { // 空席: 背もたれだけ見える
          g.fillStyle = '#7e868e'; g.fillRect(x, y0 + RH * 0.42, w, RH * 0.3); g.fillStyle = '#566069'; g.fillRect(x, y0 + RH * 0.66, w, RH * 0.06);
          continue;
        }
        const gc = groupCol[(x / (PX * 6) | 0) % groupCol.length], kid = r() < 0.05, stand = !kid && r() < 0.08, k = kid ? 0.72 : 1;
        let sh;
        if (gc && r() < 0.4) sh = gc;
        else if (r() < 0.15) { const ai = (r() * ACCENT.length) | 0; sh = ACCENT[ai]; }
        else sh = pal[(r() * pal.length) | 0];
        if (cueCol && cr() < CUE_CROWD_P) sh = cueCol;   /* 隠れた確定演出 crowd: 服の色に関わらず CUE_CROWD_P の人が枠色（r() の列は変えない） */
        const hy = y0 + RH * (stand ? 0.03 : kid ? 0.34 : 0.2 + r() * 0.06), bw = w * k, bx = x + (w - bw) / 2, by = hy + PX * 0.17 * k, bh = y0 + RH * 0.84 - by;
        const u = r();
        if (u < 0.03) { g.strokeStyle = sh; g.lineWidth = PX * 0.1; g.beginPath(); g.moveTo(bx + 2, by + 3); g.lineTo(bx - 2, hy - PX * 0.34); g.moveTo(bx + bw - 2, by + 3); g.lineTo(bx + bw + 2, hy - PX * 0.34); g.stroke(); } // 両手を上げる
        g.fillStyle = sh; g.fillRect(bx, by, bw, bh);
        g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(bx + bw * 0.72, by, bw * 0.28, bh);
        if (u >= 0.03 && u < 0.1) { g.fillStyle = '#eeeae0'; g.fillRect(bx - bw * 0.1, by + bh * 0.25, bw * 1.2, bh * 0.38); g.fillStyle = '#d9b9b5'; g.fillRect(bx - bw * 0.1, by + bh * 0.25, bw * 1.2, bh * 0.08); } // 新聞
        g.fillStyle = r() < 0.12 ? '#8a6248' : '#e6c09c'; g.beginPath(); g.arc(bx + bw / 2, hy + 1, PX * 0.14 * k, 0, 6.283); g.fill();
        const hu = r();
        if (hu < 0.16) { g.fillStyle = hats[(r() * hats.length) | 0]; g.beginPath(); g.arc(bx + bw / 2, hy - 0.5, PX * 0.14 * k, Math.PI, 6.283); g.fill(); g.fillRect(bx + bw / 2 - PX * 0.02, hy - 1.5, PX * 0.2 * k, 3); }
        else { g.fillStyle = hu < 0.8 ? '#1d1a18' : hu < 0.9 ? '#6a5040' : '#bdbab4'; g.beginPath(); g.arc(bx + bw / 2, hy - 1, PX * 0.13 * k, Math.PI, 6.283); g.fill(); }
      }
      // 通路の階段
      for (const ax of [512, 1536]) { g.fillStyle = '#aaa79f'; g.fillRect(ax - 22, y0, 44, RH); g.fillStyle = '#7d7a73'; g.fillRect(ax - 22, y0 + RH * 0.5, 44, 3); g.fillRect(ax - 22, y0 + RH - 4, 44, 4); }
    }
    grain(g, W, H, 8, 17);
  }
  // ガラス面（横 6m・縦 4m）: 空の映り込みと桟、奥の明かり
  function glassTex() {
    const W = 256, c = cv(W, W), g = c.getContext('2d'), r = srand(81);
    const gr = g.createLinearGradient(0, 0, 0, W); gr.addColorStop(0, '#b0bcc4'); gr.addColorStop(0.45, '#76848e'); gr.addColorStop(1, '#3a434b');
    g.fillStyle = gr; g.fillRect(0, 0, W, W);
    for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(255,240,210,' + (0.06 + r() * 0.12).toFixed(3) + ')'; g.fillRect(r() * W, W * (0.35 + r() * 0.5), 6 + r() * 30, 3 + r() * 10); }
    g.fillStyle = 'rgba(255,255,255,.10)'; g.beginPath(); g.moveTo(40, 0); g.lineTo(90, 0); g.lineTo(20, W); g.lineTo(-30, W); g.fill();
    g.fillStyle = '#c8cdd2'; for (let x = 0; x < W; x += 64) g.fillRect(x, 0, 4, W);
    g.fillRect(0, W * 0.68, W, 5); g.fillRect(0, 0, W, 4);
    grain(g, W, W, 8, 19);
    return tex(c);
  }
  // 街の建物の窓（横 25.6m・縦 28m。左上の画素は壁の色）
  function winTex() {
    const W = 512, c = cv(W, W), g = c.getContext('2d'), r = srand(91);
    // 2026-10-14（講評 92→95 の 3）: 遠くの建物が写実的に見えないよう、窓は壁より 15〜20% 暗いだけの帯（細い縦の桟も弱く）。左上の画素は壁の色（白＝頂点色そのまま）
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, W);
    for (let j = 0; j < 8; j++) {
      const y = j * 64, v = r();
      g.fillStyle = v < 0.1 ? '#e2ddcf' : v < 0.45 ? '#cdd5d7' : '#d6dcdd'; g.fillRect(0, y + 18, W, 28);
      g.fillStyle = 'rgba(255,255,255,.35)'; for (let x = 0; x < W; x += 32) g.fillRect(x, y + 18, 2, 28);
      g.fillStyle = 'rgba(0,0,0,.035)'; g.fillRect(0, y + 46, W, 3);
    }
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 4, 4);
    grain(g, W, W, 4, 23);
    return tex(c);
  }
  // 番号板の図柄（8×4 のます）: 0〜7 ハロン棒の数字 2〜16、8〜13 ゲートの馬番 1〜6、14 ゴール板、15 無地の丸
  function plateTex() {
    const W = 1024, H = 512, c = cv(W, H), g = c.getContext('2d'), S = 128;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    const cell = (i) => [(i % 8) * S, Math.floor(i / 8) * S];
    const disc = (i, bg, ring, txt, ink, fs) => {
      const [x, y] = cell(i); g.fillStyle = ring; g.fillRect(x, y, S, S);
      g.fillStyle = bg; g.beginPath(); g.arc(x + 64, y + 64, 54, 0, 6.283); g.fill();
      if (txt) { g.fillStyle = ink; g.font = 'bold ' + fs + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, x + 64, y + 68); }
    };
    for (let k = 0; k < 8; k++) disc(k, '#ffffff', '#d32f2f', String((k + 1) * 2), '#c62828', k >= 4 ? 70 : 92);
    for (let k = 0; k < 6; k++) { const [x, y] = cell(8 + k); g.fillStyle = '#222'; g.fillRect(x, y, S, S); g.fillStyle = FRAME[k]; g.fillRect(x + 6, y + 6, S - 12, S - 12); g.font = 'bold 96px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; if (k === 4) { g.lineWidth = 10; g.strokeStyle = '#222'; g.strokeText(String(k + 1), x + 64, y + 70); } g.fillStyle = INK[k]; g.fillText(String(k + 1), x + 64, y + 70); }
    { // ゴール板: 青地の丸い看板（みんなでダービー）
      const [x, y] = cell(14); g.fillStyle = '#ffffff'; g.fillRect(x, y, S, S);
      g.fillStyle = '#1f5fd0'; g.beginPath(); g.arc(x + 64, y + 64, 56, 0, 6.283); g.fill();
      g.strokeStyle = '#ffd54f'; g.lineWidth = 5; g.beginPath(); g.arc(x + 64, y + 64, 48, 0, 6.283); g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 20px ' + FONT; g.fillText('casa', x + 64, y + 42); g.font = 'bold 30px ' + FONT; g.fillText('GOAL', x + 64, y + 68); g.font = 'bold 15px ' + FONT; g.fillText('DERBY', x + 64, y + 93);
    }
    disc(15, '#ffffff', '#d32f2f', '', '#000', 10);
    const t = tex(c); t.wrapS = t.wrapT = T.ClampToEdgeWrapping; return t;
  }
  const cellUV = (i) => [(i % 8) / 8, 1 - (Math.floor(i / 8) + 1) / 4, 1 / 8, 1 / 4];
  // 看板（2048×1024・8 段）: 1 段目＝屋根の縁の名前、2〜8 段目＝広告 14 枚（各 1024×128。架空の会社）。adUV(i) で i 番の広告の UV
  const ADS = [
    ['#1d6b3a', 'casa DERBY', '#ffffff', 'logo'], ['#f3f1ea', 'CASA KEIBA', '#183153', 'bar'], ['#e8322e', 'うまうまカレー', '#ffffff', 'dot'], ['#ffd54f', 'にんじん牧場', '#c0392b', 'logo'],
    ['#183153', 'casa BANK', '#ffd54f', 'bar'], ['#ffffff', 'ターフ牛乳', '#2a62c9', 'dot'], ['#2a62c9', 'GALLOP COLA', '#ffffff', 'stripe'], ['#2fa84f', 'みどりの保険', '#ffffff', 'logo'],
    ['#151515', 'はやて自動車', '#f2c230', 'bar'], ['#f08cb8', 'ひづめ製菓', '#ffffff', 'dot'], ['#ff9a2a', 'TURF TV', '#ffffff', 'stripe'], ['#f4f4f2', '馬券は 20 歳になってから', '#c62828', ''],
    ['#6b3fa0', 'casa HOTEL', '#ffffff', 'logo'], ['#0e5c7a', 'そよかぜ電機', '#ffffff', 'stripe']];
  const adUV = (i) => { i = ((i % ADS.length) + ADS.length) % ADS.length; const row = 1 + (i >> 1), u0 = (i & 1) * 0.5; return [u0, 1 - (row + 1) / 8, u0 + 0.5, 1 - row / 8]; };
  // 四角形 a→b→c→d（a・d が文字の左、b・c が右）に広告 i を貼る UV
  const adQuadUV = (i) => { const [u0, v0, u1, v1] = adUV(i); return [u0, v0, u1, v0, u1, v1, u0, v1]; };
  function signTex() {
    const W = 2048, H = 1024, c = cv(W, H), g = c.getContext('2d');
    g.fillStyle = '#183153'; g.fillRect(0, 0, W, 128);
    g.fillStyle = '#ffd54f'; g.font = 'bold 92px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('casa 競馬場   CASA RACECOURSE', W / 2, 68);
    const drawAd = (i) => {
      const [bg, txt, ink, deco] = ADS[i], x = (i & 1) * 1024, y = 128 * (1 + (i >> 1));
      g.fillStyle = bg; g.fillRect(x, y, 1024, 128);
      let tx = x + 512;
      if (deco === 'logo') { g.fillStyle = ink; g.beginPath(); g.arc(x + 110, y + 64, 44, 0, 6.283); g.fill(); g.fillStyle = bg; g.font = 'bold 54px ' + FONT; g.textAlign = 'center'; g.fillText(txt.charAt(0).toUpperCase(), x + 110, y + 68); tx = x + 560; }
      if (deco === 'bar') { g.fillStyle = ink; g.fillRect(x, y + 104, 1024, 10); g.fillRect(x + 40, y + 22, 18, 70); }
      if (deco === 'dot') { g.fillStyle = 'rgba(255,255,255,.22)'; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x + 60 + k * 180, y + 64, 26, 0, 6.283); g.fill(); } }
      if (deco === 'stripe') { g.fillStyle = 'rgba(255,255,255,.18)'; for (let k = -2; k < 12; k++) { g.beginPath(); g.moveTo(x + k * 100, y + 128); g.lineTo(x + k * 100 + 40, y + 128); g.lineTo(x + k * 100 + 110, y); g.lineTo(x + k * 100 + 70, y); g.fill(); } }
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y, 6, 128);
      g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 80; g.font = 'bold ' + fs + 'px ' + FONT; while (g.measureText(txt).width > (deco === 'logo' ? 760 : 900) && fs > 40) { fs -= 4; g.font = 'bold ' + fs + 'px ' + FONT; }
      g.fillText(txt, tx, y + 68);
    };
    ADS.forEach((a, i) => drawAd(i));
    const t = tex(c), st = { img: null, frame: -1 };
    /* 右へ走る馬の影絵（横 w・縦 0.62w）。ink: 馬体の色、cloth: ゼッケンの色、edge: ゼッケンの縁の色（馬体から浮かせる） */
    function drawHorse(x, y, w, ink, cloth, edge) {
      const X = (v) => x + v * w, Y = (v) => y + v * w;
      g.save(); g.fillStyle = ink; g.strokeStyle = ink; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = w * 0.058;
      const seg = (a, b, c, d) => { g.beginPath(); g.moveTo(X(a), Y(b)); g.lineTo(X(c), Y(d)); g.stroke(); };
      seg(0.32, 0.4, 0.12, 0.59); seg(0.37, 0.43, 0.43, 0.61); seg(0.64, 0.43, 0.59, 0.61); seg(0.69, 0.4, 0.86, 0.56);   /* 脚 4 本（走る形） */
      g.lineWidth = w * 0.05; seg(0.26, 0.27, 0.05, 0.19);                                                                 /* 尾 */
      g.beginPath(); g.ellipse(X(0.5), Y(0.33), w * 0.27, w * 0.13, 0, 0, 6.283); g.fill();                                 /* 胴 */
      g.beginPath(); g.moveTo(X(0.65), Y(0.22)); g.lineTo(X(0.89), Y(0.06)); g.lineTo(X(0.96), Y(0.13)); g.lineTo(X(0.75), Y(0.41)); g.closePath(); g.fill();   /* 首 */
      g.beginPath(); g.ellipse(X(0.96), Y(0.13), w * 0.1, w * 0.046, 0.38, 0, 6.283); g.fill();                             /* 頭 */
      g.beginPath(); g.moveTo(X(0.87), Y(0.07)); g.lineTo(X(0.885), Y(-0.02)); g.lineTo(X(0.925), Y(0.06)); g.closePath(); g.fill();   /* 耳 */
      g.fillStyle = cloth; g.strokeStyle = edge; g.lineWidth = w * 0.022;
      g.beginPath(); g.rect(X(0.5), Y(0.235), w * 0.17, w * 0.19); g.fill(); g.stroke();                                    /* ゼッケン */
      g.restore();
    }
    /* 0 番の広告（casa DERBY）: 新しいロゴの絵（読めたら。読めなければ文字）。
       隠れた確定演出（sign。2026-10-16 オーナー「もっとわかりやすく」）: 左 4 割にロゴ、右 6 割が枠色一色の帯に、枠色のゼッケンを着けた馬の影絵（数字は出さない）。
       白は白い板に濃い枠と濃い馬、黒は黒い板に白い細枠と白い馬（ロゴの地も黒）。ふだんは緑一色の今日の絵柄 */
    function drawAd0() {
      const [bg] = ADS[0], x = 0, y = 128, f = st.frame, img = st.img, cue = f >= 0, lw = cue ? 380 : 1024;
      g.save(); g.beginPath(); g.rect(x, y, 1024, 128); g.clip();
      /* 2 回目: 板全体が枠色。ロゴは左の小さな板（ブランドの緑。緑の演出のときは濃紺）に載せる。白いロゴ文字が消えるので白い板にはしない */
      g.fillStyle = cue ? FRAME[f] : bg; g.fillRect(x, y, 1024, 128);
      if (cue) { g.fillStyle = f === 5 ? '#1f2630' : '#1d6b3a'; g.beginPath(); g.roundRect ? g.roundRect(x + 14, y + 12, lw - 28, 104, 14) : g.rect(x + 14, y + 12, lw - 28, 104); g.fill(); }
      if (img && img.naturalWidth) { const h = cue ? 92 : 112, w = h * img.naturalWidth / img.naturalHeight; g.drawImage(img, x + (lw - w) / 2, y + (128 - h) / 2, w, h); }
      else { g.fillStyle = '#ffffff'; g.font = 'bold ' + (cue ? 48 : 80) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('casa DERBY', x + lw / 2, y + 66); }
      if (cue) {
        const band = FRAME[f], ink = f === 0 ? '#1f2630' : '#ffffff';
        if (f === 0) { g.strokeStyle = ink; g.lineWidth = 12; g.strokeRect(x + 6, y + 6, 1012, 116); }
        drawHorse(x + lw + 30, y + 4, 195, ink, band, ink);
        drawHorse(x + lw + 330, y + 4, 195, ink, band, ink);
      }
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y, 6, 128);
      g.restore(); t.needsUpdate = true;
    }
    try {
      const img = new Image();
      img.onload = () => { try { if (img.naturalWidth) { st.img = img; drawAd0(); } } catch (e) { /* 文字の広告のまま */ } };
      img.src = LOGO_URL;
    } catch (e) { /* 文字の広告のまま */ }
    /* 最下段（v 0〜0.125）: 左 97% はゴール前の内ラチの横断幕、右下の角はターフビジョンの枠の一色 */
    function drawExtra() {
      const f = st.frame, cue = f >= 0, y = 896, W2 = 1984;
      g.save(); g.beginPath(); g.rect(0, y, 2048, 128); g.clip();
      g.fillStyle = cue ? FRAME[f] : '#f4f4f0'; g.fillRect(0, y, W2, 128);
      if (!cue) { g.fillStyle = '#1d6b3a'; g.fillRect(0, y + 6, W2, 10); g.fillRect(0, y + 112, W2, 10); g.font = 'bold 64px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; for (let k = 0; k < 3; k++) g.fillText('casa RACECOURSE', 330 + k * 660, y + 64); }
      else { const ink = f === 0 ? '#1f2630' : '#ffffff'; if (f === 0) { g.strokeStyle = ink; g.lineWidth = 10; g.strokeRect(5, y + 5, W2 - 10, 118); } for (let k = 0; k < 6; k++) drawHorse(40 + k * 325, y + 8, 180, ink, FRAME[f], ink); }
      g.fillStyle = cue ? FRAME[f] : '#30363d'; g.fillRect(W2, y, 2048 - W2, 128);
      g.restore(); t.needsUpdate = true;
    }
    drawExtra();
    t.userData.setFrame = (f) => { f = f == null ? -1 : f; if (f === st.frame) return; st.frame = f; drawAd0(); drawExtra(); };   /* 隠れた確定演出: 枠色の番号（-1 でふだん） */
    return t;
  }
  // スタンド端の大型掲示板（オッズ）
  function scoreTex() {
    const W = 1024, H = 640, c = cv(W, H), g = c.getContext('2d'), r = srand(5);
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1f6f3a'; g.fillRect(0, 0, W, 90); g.fillStyle = '#fff'; g.font = 'bold 58px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('単勝オッズ', W / 2, 48);
    for (let k = 0; k < 6; k++) {
      const y = 120 + k * 84; g.fillStyle = FRAME[k]; g.fillRect(40, y, 90, 70); g.fillStyle = INK[k]; g.font = 'bold 56px ' + FONT; g.fillText(String(k + 1), 85, y + 38);
      g.fillStyle = '#ffb02e'; g.font = 'bold 64px "Courier New", monospace'; g.textAlign = 'right'; g.fillText((1.5 + r() * 30).toFixed(1), 560, y + 40);
      g.fillStyle = '#ff6b3a'; g.fillText(String((100 + r() * 900) | 0), 960, y + 40); g.textAlign = 'center';
    }
    g.fillStyle = 'rgba(0,0,0,.35)'; for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H); for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    const t = tex(c, { clamp: true }); return t;
  }
  // ターフビジョンの画面
  function drawBoard(c, head, text) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0d2a52'); bg.addColorStop(1, '#06142a'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1f6f3a'; g.fillRect(0, 0, W, 70);
    g.fillStyle = '#fff'; g.font = 'bold 46px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(head, 28, 37);
    const m = /^([\d ]+?)\s{2,}(\d+:\d\d)$/.exec(text || '');
    if (m) {
      const nos = m[1].trim().split(/\s+/);
      nos.forEach((no, k) => { const i = (Number(no) - 1 + 6) % 6, x = 30 + k * 112; g.fillStyle = FRAME[i]; g.fillRect(x, 110, 96, 120); g.fillStyle = INK[i]; g.font = 'bold 92px ' + FONT; g.textAlign = 'center'; g.fillText(no, x + 48, 174); g.fillStyle = '#ffd54f'; g.font = 'bold 34px ' + FONT; g.fillText((k + 1) + '', x + 48, 262); });
      g.fillStyle = '#fff'; g.font = 'bold 96px ' + FONT; g.textAlign = 'right'; g.fillText(m[2], W - 30, 176);
    } else {
      // 左: 中継の絵（空・スタンド・芝・ラチと 6 頭の勝負服の色）、右: 文字、下: 枠色の帯
      const px = 24, py = 86, pw = W * 0.5, ph = H - 150, r = srand(3);
      const sky = g.createLinearGradient(0, py, 0, py + ph * 0.35); sky.addColorStop(0, '#5da2e8'); sky.addColorStop(1, '#bfe0ff'); g.fillStyle = sky; g.fillRect(px, py, pw, ph * 0.35);
      g.fillStyle = '#c9ccd2'; g.fillRect(px, py + ph * 0.22, pw, ph * 0.16);
      for (let k = 0; k < 260; k++) { g.fillStyle = ['#f4f4f2', '#2b3a55', '#b33a3a', '#e0c050', '#3f7a4a', '#1c1e22'][(r() * 6) | 0]; g.fillRect(px + r() * pw, py + ph * (0.23 + r() * 0.14), 3, 3); }
      for (let k = 0; k < 6; k++) { g.fillStyle = k % 2 ? '#6fb33c' : '#7cc043'; g.fillRect(px, py + ph * (0.38 + k * 0.104), pw, ph * 0.104); }
      g.fillStyle = '#ffffff'; g.fillRect(px, py + ph * 0.45, pw, 4); g.fillRect(px, py + ph * 0.93, pw, 5);
      for (let k = 0; k < 6; k++) { const x = px + pw * (0.18 + k * 0.12 + (k % 2) * 0.03), y = py + ph * (0.55 + (k % 3) * 0.11); g.fillStyle = '#7a4a2a'; g.beginPath(); g.ellipse(x, y, 26, 12, 0, 0, 6.283); g.fill(); g.fillStyle = FRAME[k]; g.beginPath(); g.arc(x - 2, y - 18, 9, 0, 6.283); g.fill(); }
      g.fillStyle = '#d92b3a'; g.fillRect(px + 12, py + 12, 92, 40); g.fillStyle = '#fff'; g.font = 'bold 30px ' + FONT; g.textAlign = 'center'; g.fillText('LIVE', px + 58, py + 33);
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 3; g.strokeRect(px, py, pw, ph);
      const lines = String(text || '').split('\n'), tx = px + pw + (W - px - pw) / 2;
      g.fillStyle = '#ffd54f'; g.textAlign = 'center';
      lines.forEach((ln, k) => { let fs = k ? 48 : 76; g.font = 'bold ' + fs + 'px ' + FONT; while (g.measureText(ln).width > W - pw - 70 && fs > 30) { fs -= 4; g.font = 'bold ' + fs + 'px ' + FONT; } g.fillText(ln, tx, 170 + k * 70 - (lines.length - 1) * 30); });
      for (let k = 0; k < 6; k++) { const x = px + pw + 30 + k * ((W - pw - px - 54) / 6), w = (W - pw - px - 54) / 6 - 8; g.fillStyle = FRAME[k]; g.fillRect(x, H - 62, w, 44); g.fillStyle = INK[k]; g.font = 'bold 36px ' + FONT; g.fillText(String(k + 1), x + w / 2, H - 39); }
    }
    g.fillStyle = 'rgba(0,0,0,.22)'; for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H); for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  }

  // 季節・時間の見た目（setTheme）: 芝と地面の色の掛け算、葉の色 [色, 混ぜる量]、生け垣、夜のネオン
  const THEMES = {
    normal: { turf: [1, 1, 1], grass: [1, 1, 1], hedge: [1, 1, 1], leaf: null },
    autumn: { turf: [2.3, 1.0, 0.3], grass: [2.1, 1.0, 0.35], hedge: [1.25, 1.0, 0.55], leaf: ['#f0a030', 0.85] },
    sakura: { turf: [1, 1, 1], grass: [1, 1, 1], hedge: [1, 1, 1], leaf: ['#ffa8c8', 0.95] },
    night: { turf: [1, 1, 1], grass: [1, 1, 1], hedge: [1, 1, 1], leaf: null, neon: 1 },
  };

  /* ================= 材質 ================= */
  // 頂点の tint の分だけ InstancedMesh の色を掛ける。sway: 観客のゆれ・木のそよぎ（uTime）
  function tintPatch(m, sway) {
    m.userData.uTime = { value: 0 }; m.userData.uLeaf = { value: new T.Color(1, 1, 1) }; m.userData.uLeafMix = { value: 0 };
    /* 木の実（隠れた確定演出 fruit）: uFruit = 実の色、uFruitH = 生け垣の上のかたまりの色（tint 3。ふだんは生け垣の緑）、uFruitHi = 太陽を向いた面の白い光の強さ、uFruitLo = 下の面の暗さ、uFruitSun = 太陽の向き */
    m.userData.uFruit = { value: C(FRUIT_NEUTRAL).clone() }; m.userData.uFruitH = { value: C(HEDGE_KNOB).clone() }; m.userData.uFruitHi = { value: 0 }; m.userData.uFruitLo = { value: 0.2 };
    m.userData.uFruitSun = { value: new T.Vector3(CO.SUN.x, CO.SUN.y, CO.SUN.z) };
    m.userData.uFruitScale = { value: FRUIT_OFF_SCALE }; m.userData.uFruitExtra = { value: 0 }; m.userData.uFruitGlow = { value: new T.Color(0, 0, 0) };   /* 実の大きさ（ふだん用・演出用）と自発光 */
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = m.userData.uTime; sh.uniforms.uLeaf = m.userData.uLeaf; sh.uniforms.uLeafMix = m.userData.uLeafMix; sh.uniforms.uFruit = m.userData.uFruit; sh.uniforms.uFruitHi = m.userData.uFruitHi;
      sh.uniforms.uFruitH = m.userData.uFruitH; sh.uniforms.uFruitLo = m.userData.uFruitLo; sh.uniforms.uFruitSun = m.userData.uFruitSun;
      sh.uniforms.uFruitScale = m.userData.uFruitScale; sh.uniforms.uFruitExtra = m.userData.uFruitExtra; sh.uniforms.uFruitGlow = m.userData.uFruitGlow;
      let vs = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float tint;\nattribute vec4 aFruit;\nvarying float vFruit;\nuniform float uTime;\nuniform vec3 uLeaf;\nuniform float uLeafMix;\nuniform vec3 uFruit;\nuniform vec3 uFruitH;\nuniform float uFruitHi;\nuniform float uFruitLo;\nuniform vec3 uFruitSun;\nuniform float uFruitScale;\nuniform float uFruitExtra;');
      /* 実の大きさ: 中心（aFruit.xyz）まわりに拡縮。ふだん用の実は uFruitScale、演出用の実（aFruit.w = 1）は uFruitExtra（ふだん 0 = 消える）。木のそよぎの後に足すので一緒にゆれる */
      vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += (position - aFruit.xyz) * (mix(uFruitScale, uFruitExtra, aFruit.w) - 1.0) * step(1.5, tint);');
      /* 実は葉の模様を掛けず（色が濁らない）、枠色でうっすら自発光（日陰でも沈まない） */
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFruit;\nuniform vec3 uFruitGlow;')
        .replace('#include <map_fragment>', T.ShaderChunk.map_fragment.replace('diffuseColor *= sampledDiffuseColor;', 'diffuseColor *= mix( sampledDiffuseColor, vec4( 1.0 ), vFruit );'))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += uFruitGlow * vFruit;');
      // 季節の葉の色（秋・桜）: 元の緑の明るさ（陰影）を残して色だけ差し替える。tint が 0.5〜1.5 の所（葉）だけ。tint > 1.5 は木の実（2 = 木の実 uFruit、3 = 生け垣の上のかたまり uFruitH。太陽を向いた面が uFruitHi だけ白く光り、下の面は uFruitLo だけ暗い）
      vs = vs.replace('#include <color_vertex>', '#ifdef USE_COLOR\n float tLeaf = step(0.5, tint) * step(tint, 1.5), tFruit = step(1.5, tint);\n vColor = vec3(1.0);\n vColor *= color.xyz;\n#ifdef USE_INSTANCING_COLOR\n vColor = mix(vColor, vColor * instanceColor.xyz, tLeaf);\n vec3 leafC = uLeaf * clamp(dot(color.xyz, vec3(0.3, 0.59, 0.11)) * 3.6, 0.35, 1.3) * (0.7 + 0.3 * instanceColor.xyz);\n#else\n vec3 leafC = uLeaf * clamp(dot(color.xyz, vec3(0.3, 0.59, 0.11)) * 3.6, 0.35, 1.3);\n#endif\n vColor = mix(vColor, leafC, uLeafMix * tLeaf);\n vec3 fruitC = mix(uFruit, uFruitH, step(2.5, tint)) * (1.0 - uFruitLo * (1.0 - max(normal.y, 0.0)));\n fruitC = mix(fruitC, vec3(1.0), uFruitHi * pow(max(dot(normalize(normal), uFruitSun), 0.0), 3.0));\n vColor = mix(vColor, fruitC, tFruit);\n vFruit = tFruit;\n#endif');
      if (sway === 'crowd') vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n float ph = instanceMatrix[3].x * 1.37 + instanceMatrix[3].z * 2.11;\n transformed.x += sin(uTime * 1.9 + ph) * 0.05 * position.y;\n transformed.y += max(0.0, sin(uTime * 2.7 + ph * 1.7) - 0.85) * 0.5;\n#endif');
      if (sway === 'flag') vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n float ph = instanceMatrix[3].x * 0.31;\n float k = max(0.0, -position.z);\n transformed.x += sin(uTime * 4.0 + ph - k * 1.4) * 0.16 * k;\n transformed.y += sin(uTime * 3.1 + ph - k * 1.7) * 0.05 * k;\n#endif');
      if (sway === 'tree') vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n float ph = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;\n transformed.x += sin(uTime * 0.9 + ph) * 0.012 * max(0.0, position.y - 0.4);\n transformed.z += sin(uTime * 0.7 + ph * 1.3) * 0.010 * max(0.0, position.y - 0.4);\n#endif');
      sh.vertexShader = vs;
    };
    m.customProgramCacheKey = () => 'venueTint' + (sway || '');
    return m;
  }
  /* ---------- ラチ・決勝審判の小屋: 後ろに馬がいる所だけ薄くする（勝負所でラチが馬体を隠さないように） ----------
     uHorse[i] = (x, z, 進む向きの cos, sin)、uHorseB[i] = (背の高さ, 使う 0/1)。会場の update が毎コマ、シーンの馬（名前 horseN）から入れる。
     カメラから見てこのかけらの奥に馬があり、視線が馬の胴（前後 1.55m・左右 0.75m の楕円柱、地面〜背の高さ）を通る所だけ、不透明度を uFadeMin まで下げる。
     uFade（0..1）はカメラ担当が venue.setRailFade(k) で場面ごとに弱められる（既定 1） */
  const FADE_U = { uHorse: { value: [0, 1, 2, 3, 4, 5].map(() => new T.Vector4(0, 0, 1, 0)) }, uHorseB: { value: [0, 1, 2, 3, 4, 5].map(() => new T.Vector2(0, 0)) }, uFade: { value: 0 }, uFadeMin: { value: 0.12 } }; /* 2026-10-14 オーナー「てすりの透過処理いらない」→ 既定 0（ラチは常に不透明）。仕組みは残す */
  const FADE_FS_HEAD = [
    'varying vec3 vFadeW; uniform vec4 uHorse[ 6 ]; uniform vec2 uHorseB[ 6 ]; uniform float uFade; uniform float uFadeMin;',
    'float horseCover( vec3 P ) {',
    '  vec3 d = P - cameraPosition; float dd = dot( d.xz, d.xz ), a = 0.0;',
    '  if ( dd < 1e-4 ) return 0.0;',
    '  for ( int i = 0; i < 6; i++ ) {',
    '    if ( uHorseB[ i ].y < 0.5 ) continue;',
    '    vec2 h = uHorse[ i ].xy;',
    '    float t = dot( h - cameraPosition.xz, d.xz ) / dd;',          // 視線が馬の軸にいちばん近づく所（このかけらが t=1）
    '    if ( ( t - 1.0 ) * sqrt( dd ) < 0.25 ) continue;',          // 馬（の軸）がこのかけらより 0.25m 以上奥にあるときだけ
    '    vec2 q = cameraPosition.xz + d.xz * t - h;',
    '    float e = length( vec2( dot( q, uHorse[ i ].zw ) / 1.55, dot( q, vec2( - uHorse[ i ].w, uHorse[ i ].z ) ) / 0.75 ) );',
    '    float y = cameraPosition.y + d.y * t;',
    '    a = max( a, ( 1.0 - smoothstep( 1.0, 1.45, e ) ) * smoothstep( -0.25, 0.1, y ) * ( 1.0 - smoothstep( uHorseB[ i ].x, uHorseB[ i ].x + 0.4, y ) ) );',
    '  }',
    '  return a;',
    '}'].join('\n');
  function fadePatch(m) {
    m.transparent = false; /* 不透明のまま描く（透過をやめた。2026-10-14） */
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uHorse = FADE_U.uHorse; sh.uniforms.uHorseB = FADE_U.uHorseB; sh.uniforms.uFade = FADE_U.uFade; sh.uniforms.uFadeMin = FADE_U.uFadeMin;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFadeW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvec4 fadeW = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\n fadeW = instanceMatrix * fadeW;\n#endif\nvFadeW = ( modelMatrix * fadeW ).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FADE_FS_HEAD)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= 1.0 - ( 1.0 - uFadeMin ) * uFade * horseCover( vFadeW );');
    };
    m.customProgramCacheKey = () => 'venueFade' + m.type;
    return m;
  }
  /* ---------- 発走ゲートの金属: 頂点の tint（0..1）で金属らしさを変える（1 本の材質・1 回の描画のまま）。
     tint 1 ＝鉄骨（粗さ 0.38・金属 0.45）、0 ＝塗装・クッション（粗さ 0.62・金属 0） ---------- */
  /* 軽い 3D その 2（2026-10-29。最もなめらか＝XMQ だけ）: 発走ゲートも軽い材質（Lambert）に。つや・金属の計算（いちばん重いシェーダ）をやめ、
     鉄骨（tint 1）は金属の分だけ暗く（金属 0.45 ＝拡散の色 55%）＝明るさはだいたい同じ・光沢だけなくなる。塗装とクッション（tint 0）はそのまま */
  function gateLam() {
    const m = new T.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float tint;\nvarying float vGateM;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGateM = tint;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGateM;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.45 * vGateM;');
    };
    m.customProgramCacheKey = () => 'venueGateL';
    return m;
  }
  function gatePatch(m) {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float tint;\nvarying float vGateM;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGateM = tint;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGateM;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( 0.62, roughnessFactor, vGateM );')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vGateM;');
    };
    m.customProgramCacheKey = () => 'venueGate';
    return m;
  }
  /* ---------- 地面の彩度（雨の日は芝・草を少しくすませる）: uSat 1＝そのまま ---------- */
  // stand: スタンド（観客席の模様・ガラス）-13%、mid: 中景（広場の観客・パラソル・のぼり）-8%（講評 92→95 の 3）
  const SAT_U = { turf: { value: 1 }, green: { value: 1 }, stand: { value: 0.87 }, mid: { value: 0.92 } };
  function satPatch(m, u) {
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.uSat = u;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSat;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = max( mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, uSat ), 0.0 );');
    };
    m.customProgramCacheKey = () => 'sat|' + (prevKey ? prevKey.call(m) : m.type);
    return m;
  }

  /* ---------- 空気遠近（講評 92→95 の 3）: カメラから遠いほど、光を当てたあとの色を #A6B9B3 に寄せる（霧とは別。霧は照明担当）。
     150m から効き始め 1000m で最大 uHazeK。街・丘・木・スタンド・遠くの地面に。色と強さは天気・季節で applySurface が変える ---------- */
  const HAZE_U = { uHaze: { value: new T.Color(1, 1, 1) }, uHazeK: { value: 0.42 }, uHazeR: { value: new T.Vector2(150, 1000) } };
  function hazePatch(m) {
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.uHaze = HAZE_U.uHaze; sh.uniforms.uHazeK = HAZE_U.uHazeK; sh.uniforms.uHazeR = HAZE_U.uHazeR;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uHazeK; uniform vec2 uHazeR; varying float vHz;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvec4 hzW = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\n hzW = instanceMatrix * hzW;\n#endif\nvHz = uHazeK * smoothstep( uHazeR.x, uHazeR.y, distance( ( modelMatrix * hzW ).xyz, cameraPosition ) );');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze; varying float vHz;')
        .replace('#include <output_fragment>', 'outgoingLight = mix( outgoingLight, uHaze, vHz );\n#include <output_fragment>');
    };
    m.customProgramCacheKey = () => 'haze|' + (prevKey ? prevKey.call(m) : m.type);
    return m;
  }

  function makeMats(low, T_) {
    const lam = (o) => new T.MeshLambertMaterial(o), std0 = (o) => new T.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, o));
    /* さらになめらか（XLQ）: つやのある材質（ラチ・支柱・水・ガラス・扉）も軽い材質に（発走ゲートの金属だけはそのまま） */
    const std = (o) => (XLQ ? lam(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'roughness' && k !== 'metalness'))) : std0(o));
    // 芝・ダートの濡れは setRace で自分で扱う（照明側の自動の濡れ処理はしない: userData.noWet）
    const ground = (o) => { if (low) { delete o.roughness; delete o.envMapIntensity; } const m = low ? lam(o) : std(o); m.userData.noWet = true; return m; };
    const off = (m, f) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f * 2; return m; };
    return {
      turf: ground({ map: T_.turf, roughness: 0.96, envMapIntensity: 0.6 }),   // 映り込みは弱め（斜めから見たとき芝が灰色に光らない）
      dirt: ground({ map: T_.dirt, roughness: 0.96 }),
      grass: lam({ map: T_.grass, vertexColors: true }),
      ground: lam({ map: T_.ground, vertexColors: true }),
      pave: off(lam({ vertexColors: true }), -1),
      water: off(std({ color: C('#4a82c8'), roughness: 0.08, metalness: 0.1 }), -2),
      // 白い樹脂（ハロン棒・ラチ・支柱）は少しつや消し（講評 v2-1 の 2: 0.62。前の 0.38 は空が映って白く飛び、陰影が出なかった）
      plastic: std({ vertexColors: true, roughness: 0.6 }),
      rail: fadePatch(std({ vertexColors: true, roughness: 0.62 })),
      railIn: fadePatch(std({ vertexColors: true, roughness: 0.62 })),
      post: fadePatch(std({ vertexColors: true, roughness: 0.62 })),   // 頂点色＝根元を暗く（接地感）
      gate: XMQ ? gateLam() : gatePatch(std0({ vertexColors: true, roughness: 0.38, metalness: 0.45 })),   // 最もなめらか: 軽い材質（下の gateLam）   // 発走ゲート: 頂点の tint＝金属らしさ（1 鉄骨・0 塗装やクッション）
      judge: fadePatch(lam({ vertexColors: true })),
      judgeGlass: fadePatch(std({ map: T_.glass, roughness: 0.18, metalness: 0.35, vertexColors: true })),
      conc: lam({ vertexColors: true }),
      glass: std({ map: T_.glass, roughness: 0.18, metalness: 0.35, vertexColors: true }),
      crowd: lam({ map: T_.crowd }),
      blob: off(new T.MeshBasicMaterial({ map: T_.blob, color: C("#26221e"), transparent: true, depthWrite: false }), -2),
      sign: lam({ map: T_.sign }),
      plate: lam({ map: T_.plate }),
      city: lam({ map: T_.win, vertexColors: true }),
      hill: lam({ vertexColors: true }),
      leaf: tintPatch(lam({ map: T_.leaf, vertexColors: true }), 'tree'),
      hedge: lam({ map: T_.leaf, vertexColors: true }),
      flower: off(lam({ map: T_.flower, vertexColors: true }), -1),
      parasol: tintPatch(lam({ vertexColors: true, side: T.DoubleSide })),
      flag: tintPatch(lam({ vertexColors: true, side: T.DoubleSide }), 'flag'),
      door: std({ vertexColors: true, roughness: 0.55 }),
      board: new T.MeshBasicMaterial({ map: T_.board, toneMapped: false }),
      score: new T.MeshBasicMaterial({ map: T_.score, toneMapped: false }),
    };
  }

  /* ================= 形 ================= */
  // ラチ: 上の横木（白い樹脂の丸みのある角材）と、外へ斜めに立つ支柱
  const RAIL_PROF = [[-0.05, 0.92], [0.05, 0.92], [0.075, 0.97], [0.075, 1.05], [0.05, 1.1], [-0.05, 1.1], [-0.075, 1.05], [-0.075, 0.97], [-0.05, 0.92]];
  const RAIL_PROF_XL = [[0.07, 0.93], [0.07, 1.08], [-0.07, 1.08], [-0.07, 0.93]]; // 軽い 3D: 外・上・内の 3 面だけ（下の面は見えない。8 面 → 3 面）
  function addRail(g, posts, r, side, col, step, sRange) {
    const s0 = sRange ? sRange[0] : 0, s1 = sRange ? sRange[1] : L;
    sweep(g, cpath(r, s0, s1, XMQ ? 7 : TVQ ? 4 : 1.5, 25), XMQ ? RAIL_PROF_XL : RAIL_PROF, col);
    for (let s = s0; s < s1 - 0.1; s += step) {
      const p = CO.pointAt(s, r), o = outAt(s);
      posts.push({ x0: p.x + o.x * side * 0.42, z0: p.z + o.z * side * 0.42, x1: p.x, z1: p.z, y1: 0.98 });
    }
  }
  function postMatrix(P) {
    const dx = P.x1 - P.x0, dz = P.z1 - P.z0, dy = P.y1, len = Math.hypot(dx, dy, dz);
    _Q.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(dx / len, dy / len, dz / len));
    return new T.Matrix4().compose(_P.set((P.x0 + P.x1) / 2, dy / 2, (P.z0 + P.z1) / 2), _Q, _S.set(1, len, 1));
  }
  // 木 1 本（高さ 1・幅 1 の単位。幹は tint 0、葉は tint 1）
  const BLOBS_FOREST = [[0, 0.52, 0, 0.5, 0.34], [0.2, 0.7, 0.12, 0.36, 0.26], [-0.2, 0.68, -0.12, 0.38, 0.27], [0.03, 0.84, -0.05, 0.3, 0.17], [-0.14, 0.42, 0.2, 0.34, 0.2], [0.22, 0.44, -0.18, 0.32, 0.2]];
  const BLOBS_ROUND = [[0, 0.58, 0, 0.5, 0.42]];
  const BLOBS_BUSH = [[0, 0.5, 0, 0.5, 0.5]];
  const BLOBS_POPLAR = [[0, 0.56, 0, 0.5, 0.4], [0, 0.82, 0, 0.36, 0.2]];
  // 針葉樹（高さ 1・幅 1 の単位）: 幹と 3 段の円すい
  function coniferGeo(detail) {
    const g = new Geo(), base = C('#4a8243');
    g.add(new T.CylinderGeometry(0.03, 0.05, 0.35, 5, 1, true), mat(0, 0.175, 0, 1, 1, 1), C('#5a4a3a'), { tint: 0 });
    for (const [y0, h, r] of [[0.2, 0.5, 0.5], [0.42, 0.42, 0.38], [0.62, 0.38, 0.25]]) {
      g.add(new T.ConeGeometry(r, h, detail ? 9 : 6, 1, true), mat(0, y0 + h / 2, 0, 1, 1, 1), (x, y) => base.clone().multiplyScalar(0.7 + 0.4 * Math.min(1, Math.max(0, (y - 0.2) / 0.8))), { tint: 1, uvT: [0, 0, 3, 2] });
      g.add(new T.CircleGeometry(r, detail ? 9 : 6), mat(0, y0, 0, 1, 1, 1, 0, Math.PI / 2), base.clone().multiplyScalar(0.5), { tint: 1 });
    }
    return g.build();
  }
  // fruit: 木の実（隠れた確定演出 fruit。{ n: 1 本あたりの数, base: そのうちふだんから描く数（残りは演出のときだけ）, size: 半径（木の大きさ 1 に対して）, tv: 三角形 4 の形にする }。無ければ実なし）。
  // 実は葉の房の表面（横〜上）に置き、頂点の tint = 2（材質の uFruit の色で描く。ふだんはくすんだ茶）。三角形は 1 つ 8（tv は 4）
  function treeGeo(detail, blobs, seed, fruit) {
    const g = new Geo(), r = srand(seed);
    g.add(new T.CylinderGeometry(0.03, 0.05, 0.42, TVQ ? 4 : 5, 1, true), mat(0, 0.21, 0, 1, 1, 1), C('#5a4a3a'), { tint: 0 });   /* 幹（Fire TV は 4 角） */
    const base = C(LEAF_BASE);   // 葉の色（講評 v2-1 の 2: 画面で #417E35〜#619345 に出る落ち着いた緑。前は #4f9f2c で彩度が高すぎた）
    const jit = (x, y, z, bx, bz) => 1 + (hash3(x * 3 + bx * 7, y * 3 + seed, z * 3 + bz * 5) - 0.5) * 0.42;
    for (const [bx, by, bz, rxz, ry] of blobs) {
      const ico = new T.IcosahedronGeometry(1, detail), P = ico.attributes.position, N = ico.attributes.normal;
      for (let k = 0; k < P.count; k++) {
        const x = P.getX(k), y = P.getY(k), z = P.getZ(k), j = jit(x, y, z, bx, bz);
        P.setXYZ(k, x * j, y * j, z * j); N.setXYZ(k, x, y, z);
      }
      g.add(ico, mat(bx, by, bz, rxz, ry, rxz), (x, y) => base.clone().multiplyScalar(0.78 + 0.42 * Math.min(1, Math.max(0, (y - 0.25) / 0.7))), { tint: 1, uvT: [0, 0, 3, 2] });
    }
    if (fruit && fruit.n > 0) {
      const fg = fruit.tv ? new T.TetrahedronGeometry(1, 0) : new T.OctahedronGeometry(1, 0), fc = C(FRUIT_NEUTRAL), fr = srand(seed * 7 + 3);
      for (let k = 0; k < fruit.n; k++) {
        const [bx, by, bz, rxz, ry] = blobs[(fr() * blobs.length) | 0];
        const y = -0.15 + fr() * 0.85, a = fr() * 6.2832, c = Math.sqrt(Math.max(0, 1 - y * y)), x = Math.cos(a) * c, z = Math.sin(a) * c, j = jit(x, y, z, bx, bz) * 0.98;
        const cx = bx + x * j * rxz, cy = by + y * j * ry, cz = bz + z * j * rxz;
        g.add(fg, mat(cx, cy, cz, fruit.size, fruit.size, fruit.size, fr() * 6.28), fc, { tint: 2, fruit: [cx, cy, cz, k < (fruit.base == null ? fruit.n : fruit.base) ? 0 : 1] });
      }
    }
    return g.build();
  }
  /* ---------- 隠れた確定演出 fruit の果物（2026-10-17 オーナー「木になってる実は各色に沿った果物にしてほしい」） ----------
     枠色ごとに形で見分けられる果物: 0 白＝白桃・1 黒＝巨峰・2 赤＝りんご・3 青＝ブルーベリー・4 黄＝レモン・5 緑＝マスカット。
     形は「実の半径 1」の大きさで、原点が枝の付け根（実はその下にぶら下がる）。房（巨峰・マスカット）は高さ約 2.5、上へ枝が伸びる。
     色は頂点色（産毛の赤み・割れ目・つや・ブルーベリーのへそ）。三角形は 1 個 60 以下・房 200 以下（Fire TV はさらに粗く） */
  const FRUIT_KIND = ['peach', 'grape', 'apple', 'berry', 'lemon', 'grape'];
  const FRUIT_GRAPE = { 1: ['#2c1838', '#5b3b74', '#8a74a8'], 5: ['#9fd04c', '#d8f28c', '#f4ffc8'] };   /* 房の実: 地の色・上の面・白い粉（ブルーム） */
  const FRUIT_GLOW = [0.2, 0.05, 0.22, 0.24, 0.24, 0.22];   /* 果物の自発光（頂点色に掛ける。日陰でも沈まない） */
  const FRUIT_RIM = [['#fff4ee', 0.3], ['#c8a8ff', 0.55], ['#ffe2d8', 0.22], ['#c4d0ff', 0.4], ['#fff8c8', 0.22], ['#f6ffd8', 0.5]];   /* 縁の光（葉から浮かせる） */
  function smoothBall(detail, tv) {   /* なめらかに光る小さな球（法線＝中心からの向き）。tv は 8 三角形・ふだんは 20 三角形 */
    const g = tv ? new T.OctahedronGeometry(1, 0) : new T.IcosahedronGeometry(1, detail || 0), P = g.attributes.position, N = g.attributes.normal;
    for (let k = 0; k < P.count; k++) { _v.fromBufferAttribute(P, k).normalize(); N.setXYZ(k, _v.x, _v.y, _v.z); }
    return g;
  }
  function leafQuad(g, x, y, z, len, ry, col) {   /* 小さな葉（菱形 2 三角形。両面で描く材質） */
    const c = Math.cos(ry), s2 = Math.sin(ry), w = len * 0.32, A = [x, y, z], B = [x + c * len * 0.5 - s2 * w, y + len * 0.18, z + s2 * len * 0.5 + c * w], Cc = [x + c * len, y + len * 0.3, z + s2 * len], D = [x + c * len * 0.5 + s2 * w, y + len * 0.22, z + s2 * len * 0.5 - c * w];
    g.quad(A, B, Cc, D, col, null, 0, [0, 1, 0]);
  }
  function fruitGeo(f, tv) {
    const g = new Geo(), kind = FRUIT_KIND[f], brown = C('#6b4a2c'), leaf = C('#4f9a3a');
    const stick = (y0, y1, w) => { if (tv) { g.quad([-w, y0, 0], [w, y0, 0], [w, y1, 0], [-w, y1, 0], brown, null, 0, [0, 0, 1]); } else g.add(new T.CylinderGeometry(w, w, y1 - y0, 3, 1, true), mat(0, (y0 + y1) / 2, 0, 1, 1, 1), brown); };
    if (kind === 'grape') {
      const [base, top, bloom] = FRUIT_GRAPE[f].map(C), rows = tv ? [[3, 0.48, -0.5], [1, 0, -1.1], [1, 0, -1.7]] : [[3, 0.5, -0.48], [3, 0.42, -1.06], [2, 0.26, -1.6], [1, 0, -2.08]], ball = smoothBall(0, tv), rr = srand(f * 11 + 3);
      const col = (x, y, z, nx, ny) => { const t = Math.max(0, ny); return base.clone().lerp(top, t * 0.8).lerp(bloom, Math.max(0, ny - 0.75) * 1.6); };
      rows.forEach(([n, ring, y], j) => { for (let k = 0; k < n; k++) { const a = k / n * 6.2832 + j * 0.9, rad = 0.44 - j * 0.02; g.add(ball, mat(Math.cos(a) * ring, y + (rr() - 0.5) * 0.1, Math.sin(a) * ring, rad, rad, rad), col); } });
      stick(-0.35, 0.95, 0.06); if (!tv) leafQuad(g, 0, 0.55, 0, 0.9, 0.6, leaf);   /* 枝（葉の中から下りてくる）と葉 1 枚 */
    } else if (kind === 'berry') {
      const ball = smoothBall(0, tv), base = C('#3049c0'), bloom = C('#8494dc'), crown = C('#141a44');
      const col = (x, y, z, nx, ny) => (ny < -0.72 ? crown : base.clone().lerp(bloom, Math.max(0, ny) * 0.75));   /* 下の先に濃いへそ（がく） */
      const pts = tv ? [[0, -0.55, 0], [0.5, -0.95, 0.12], [-0.42, -0.98, 0.28], [0.05, -1.35, -0.3]] : [[0, -0.5, 0], [0.52, -0.88, 0.14], [-0.46, -0.92, 0.3], [0.1, -0.96, -0.5], [-0.05, -1.4, 0.08], [0.45, -1.35, -0.3]];
      pts.forEach(([x, y, z]) => g.add(ball, mat(x, y, z, 0.46, 0.46, 0.46), col));
      stick(-0.4, 0.6, 0.05); if (!tv) leafQuad(g, 0, 0.3, 0, 0.8, 2.2, leaf);
    } else {
      const sp = tv ? new T.SphereGeometry(1, 5, 3) : new T.SphereGeometry(1, 7, 5), P = sp.attributes.position, N = sp.attributes.normal;
      for (let k = 0; k < P.count; k++) {
        let x = P.getX(k), y = P.getY(k), z = P.getZ(k);
        if (kind === 'apple') { y *= 0.9; if (y > 0.82) y = 0.62; if (y < -0.85) y = -0.75; x *= 1.04; z *= 1.04; }           /* 上のくぼみと少し平たい形 */
        if (kind === 'peach') { const crease = Math.max(0, 1 - Math.abs(Math.atan2(x, z)) / 0.5); x *= 1 - 0.1 * crease; z *= 1 - 0.1 * crease; if (y < -0.9) y = -1.08; }   /* 割れ目と下のとがり */
        if (kind === 'lemon') { const ax = Math.abs(y); y *= 1.32 + (ax > 0.86 ? 0.32 : 0); x *= 0.86; z *= 0.86; }               /* 長い楕円＋両端のとがり */
        P.setXYZ(k, x, y, z);
      }
      sp.computeVertexNormals();
      let col, tilt = 0, cy = -1.0;
      if (kind === 'apple') { const red = C('#d81e18'), hi = C('#f24a26'), dark = C('#8e1410'); col = (x, y, z, nx, ny) => red.clone().lerp(hi, Math.max(0, nx) * 0.6).lerp(dark, Math.max(0, y - cy - 0.45) * 0.9); }
      if (kind === 'peach') { const cream = C('#fbf3e8'), blush = C('#f4b2b0'), crease = C('#e2cfc2'); col = (x, y, z, nx, ny, nz) => { const a = Math.abs(Math.atan2(nx, nz)); return a < 0.18 ? crease : cream.clone().lerp(blush, Math.max(0, nx + 0.15) * 0.7); }; }
      if (kind === 'lemon') { const yel = C('#ffe01a'), tip = C('#d9d21e'), hi = C('#fff59a'); col = (x, y, z, nx, ny) => yel.clone().lerp(hi, Math.max(0, ny) * 0.35).lerp(tip, Math.max(0, Math.abs(y - cy) - 1.1) * 1.6); tilt = 1.25; cy = -0.95; }
      g.add(sp, kind === 'lemon' ? new T.Matrix4().makeRotationZ(tilt).premultiply(new T.Matrix4().makeTranslation(0, cy, 0)) : mat(0, cy, 0, 1, 1, 1), col);
      stick(-0.2, kind === 'apple' ? 0.45 : 0.25, 0.06);
      leafQuad(g, 0.04, kind === 'apple' ? 0.12 : 0.05, 0, kind === 'peach' ? 0.75 : 0.85, kind === 'lemon' ? 2.4 : 0.5, leaf);
    }
    return g.build();
  }
  /* ---------- 観客（姿・服・持ち物を 1 人ずつ変える） ----------
     形は細かさ別に 4 つ（hi＝立ち・丸みあり、lo＝立ち・箱、seat＝座り・箱、pad＝パドック用・靴つき）。どの形にも
     腕・キャップ・つば広の帽子・新聞・スマホ・長い髪を全部入れておき、人ごとの値（aPose）でシェーダが腕を回し、要らない部品は 0 に縮めて消す。
     服（instanceColor）・ズボン（aPants）・髪（aHair）・帽子（aHat）の色も人ごと。体の幅・背の高さは人ごとの行列の大きさ。
     頂点の tint = 部品 × 8 ＋ 色の種類
       部品: 0 体 / 1 左腕 / 2 右腕 / 3 キャップ / 4 つば広の帽子 / 5 新聞 / 6 スマホ（右腕といっしょに動く）/ 7 長い髪 / 8 傘（雨の日だけ）
       色:   0 頂点色のまま（肌・靴・紙）/ 1 服 / 2 ズボン / 3 髪 / 4 帽子
     aPose = (左腕の角度, 右腕の角度, 帽子(0 なし・1 キャップ・2 つば広) + 4×長い髪 + 8×傘を持つ人, 持ち物(0 なし・1 新聞・2 スマホ) + 4×応援の種類(1 両手を上げる・2 手をたたく))
       腕の角度: 肩を軸に前へ振り上げる（0＝下ろす・1.1＝前へ・2.0＝顔の前・2.7＝ほぼ真上）
     ゴール前（先頭の馬が最後の直線の残り約 480m 以内。uCheer）だけ、先頭の馬の近く（uLeadX）ほど応援する。前列（ラチ際）は 2 割、ほかは 1 割が両手を上げて跳ね、3 割前後が手をたたく */
  const PT = (part, ck) => part * 8 + ck;
  // Fire TV 向けのさらに軽い描き方（R3D.tv。js/race3d.js の ?q=tv）: 観客は板の人、木・支柱・街を間引き、ラチを粗く。build のたびに決める
  let TVQ = false, XLQ = false, XMQ = false;
  const CROWD_U = { uTime: { value: 0 }, uCheer: { value: 0 }, uLeadX: { value: -1e4 }, uRain: { value: 0 } };
  /* 2026-10-14（講評 92→95 の 3「観客・背景・建物の統一」）: 馬・騎手と同じ「おもちゃの人形」の体つきに。
     頭を大きめ（半径 0.2）、胴は丸い豆形（回転体）、手は丸いミトン、髪は頭にかぶせた殻、顔に小さな目（パドック用はほっぺも。騎手と同じ色）。
     三角形（隠れている部品も含む）: pad 約 600・hi 約 350・lo（箱）約 150・tv（板）14 */
  const SKIN = '#f3c9a2', EYE = '#1a1418', CHEEK = '#f3a596';
  function personGeo(kind) {
    if (kind === 'tv') { // Fire TV 向け: 板だけの人（1 人 14 三角形。正面は +z、両面で描く）。色分け（服・ズボン・髪・帽子）と腕の動きは同じシェーダ
      const g = new Geo(), skin = C(SKIN), wh = C('#ffffff'), hy = 1.56, SX = 0.265, SY = 1.3;
      g.add(PLANE, mat(0, 0.38, 0, 0.3, 0.76, 1), wh, { tint: PT(0, 2) });            // 脚（ズボン）
      g.add(PLANE, mat(0, 1.04, 0.01, 0.48, 0.62, 1), wh, { tint: PT(0, 1) });         // 胴（服。板なので少し太めにして人だまりの密度を保つ）
      g.add(PLANE, mat(0, hy - 0.02, 0.02, 0.32, 0.32, 1), skin, { tint: PT(0, 0) });  // 顔（大きめ）
      g.add(PLANE, mat(0, hy + 0.12, 0.015, 0.34, 0.12, 1), wh, { tint: PT(0, 3) });   // 髪
      g.add(PLANE, mat(0, hy + 0.19, 0.025, 0.38, 0.11, 1), wh, { tint: PT(3, 4) });   // 帽子（かぶっている人だけ出る）
      for (const [sx, part] of [[-SX, 1], [SX, 2]]) g.add(PLANE, mat(sx, SY - 0.24, 0.012, 0.11, 0.5, 1), wh, { tint: PT(part, 1) }); // 腕
      g.add(PLANE, mat(0, hy + 0.46, 0.06, 0.95, 0.3, 1), wh, { tint: PT(8, 4) });     // 傘（雨の日だけ出る）
      return g.build();
    }
    const g = new Geo(), skin = C(SKIN), wh = C('#ffffff'), shoe = C('#2f2c2c'), phone = C('#1f2329'), eye = C(EYE);
    const seat = kind === 'seat', box = kind === 'lo' || kind === 'seat', pad = kind === 'pad';
    const dy = seat ? -0.5 : 0, SX = 0.265, SY = 1.3 + dy, hy = 1.56 + dy, HR = 0.2;
    const paperCol = (x, y) => (y > SY - 0.12 ? C('#ecd8d2') : C('#ebe7dc'));   // 競馬新聞（上の見出しは薄い赤）
    if (box) { // 中景（箱の人形。頭は大きめ・髪は頭にかぶせた箱）
      if (seat) { g.box(0, 0.36, 0.16, 0.34, 0.16, 0.42, wh, 0, { tint: PT(0, 2) }); g.box(0, 0.16, 0.34, 0.3, 0.32, 0.12, wh, 0, { tint: PT(0, 2) }); }
      else g.box(0, 0.37, 0, 0.3, 0.74, 0.18, wh, 0, { tint: PT(0, 2) });
      g.box(0, 1.03 + dy, 0, 0.42, 0.6, 0.27, wh, 0, { tint: PT(0, 1) });
      g.box(0, hy, 0, 0.29, 0.29, 0.29, skin, 0, { tint: PT(0, 0) });
      g.box(0, hy + 0.045, -0.03, 0.31, 0.23, 0.28, wh, 0, { tint: PT(0, 3) });
      for (const [sx, part] of [[-SX, 1], [SX, 2]]) g.box(sx, SY - 0.23, 0, 0.1, 0.48, 0.11, wh, 0, { tint: PT(part, 1) });
      g.box(0, hy + 0.17, 0.02, 0.33, 0.08, 0.36, wh, 0, { tint: PT(3, 4) });                                                      // キャップ（つばは前へ少し出る）
      g.box(0, hy + 0.12, 0, 0.6, 0.025, 0.6, wh, 0, { tint: PT(4, 4) }); g.box(0, hy + 0.21, 0, 0.32, 0.16, 0.32, wh, 0, { tint: PT(4, 4) });
      g.add(BOX, mat(0, SY - 0.15, 0.42, 0.46, 0.32, 0.012, 0, -0.45), paperCol, { tint: PT(5, 0) });
      g.box(0, hy + 0.52, 0.06, 0.95, 0.06, 0.95, wh, 0, { tint: PT(8, 4) }); g.box(0.12, hy + 0.05, 0.12, 0.03, 0.9, 0.03, C('#2a2a2a'), 0, { tint: PT(8, 0) });
      g.box(0, hy - 0.15, -0.12, 0.27, 0.32, 0.1, wh, 0, { tint: PT(7, 3) });
      return g.build();
    }
    // 丸みのある人形（hi＝広場の手前、pad＝パドック。pad は少し細かい）
    const S = pad ? { leg: 7, tor: 9, hw: 10, hh: 7, hair: 3, arm: 6, hand: [5, 3], hat: 8, lh: 3 } : { leg: 5, tor: 6, hw: 7, hh: 5, hair: 2, arm: 5, hand: [4, 2], hat: 6, lh: 3 };
    for (const sx of [-0.09, 0.09]) {
      g.add(new T.CylinderGeometry(0.082, 0.07, 0.74, S.leg, 1, true), mat(sx, 0.37, 0, 1, 1, 1), wh, { tint: PT(0, 2) });
      if (pad) g.add(BOX, mat(sx, 0.05, 0.045, 0.14, 0.1, 0.26), shoe, { tint: PT(0, 0) });
    }
    // 胴（豆形の回転体。前後に少し薄く）
    const prof = pad ? [[0.17, 0.7], [0.205, 0.86], [0.218, 1.06], [0.2, 1.24], [0.13, 1.35], [0.0, 1.385]] : [[0.17, 0.7], [0.215, 0.92], [0.2, 1.22], [0.12, 1.355], [0.0, 1.385]];
    g.add(new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(r, y)), S.tor), mat(0, 0, 0, 1, 1, 0.76), wh, { tint: PT(0, 1) });
    // 頭（肌）と髪（頭の上と後ろにかぶせた殻。前の縁は額の上）
    g.add(new T.SphereGeometry(HR, S.hw, S.hh), mat(0, hy, 0, 1, 1, 1), skin, { tint: PT(0, 0) });
    g.add(new T.SphereGeometry(HR * 1.06, S.hw, S.hair, 0, 6.2832, 0, Math.PI * 0.52), mat(0, hy + 0.012, -0.014, 1, 1, 1, 0, -0.5), wh, { tint: PT(0, 3) });
    // 目（縦長の小さな黒い丸。少し内向き）・ほっぺ（パドックだけ）
    for (const sx of [-1, 1]) {
      const ex = 0.074 * sx, ey = hy + 0.0, ez = Math.sqrt(HR * HR - ex * ex) + 0.004;
      g.add(pad ? new T.CircleGeometry(0.024, 6) : PLANE, mat(ex, ey, ez, pad ? 1 : 0.04, pad ? 1.4 : 0.055, 1, Math.atan2(ex, ez)), eye, { tint: PT(0, 0) });
      if (pad) { const cx = 0.118 * sx, cy = hy - 0.055, cz = Math.sqrt(Math.max(0, HR * HR - cx * cx - 0.055 * 0.055)) + 0.003; g.add(new T.CircleGeometry(0.03, 5), mat(cx, cy, cz, 1, 0.75, 1, Math.atan2(cx, cz), 0.25), C(CHEEK), { tint: PT(0, 0) }); }
    }
    // 腕（肩を軸に回す。袖は服の色、手は丸いミトン）
    for (const [sx, part] of [[-SX, 1], [SX, 2]]) {
      g.add(new T.CylinderGeometry(0.06, 0.052, 0.44, S.arm, 1, true), mat(sx, SY - 0.22, 0, 1, 1, 1), wh, { tint: PT(part, 1) });
      g.add(new T.SphereGeometry(0.066, S.hand[0], S.hand[1]), mat(sx, SY - 0.47, 0, 1, 1.1, 1), skin, { tint: PT(part, 0) });
    }
    // キャップ（つばは前）・つば広の帽子
    g.add(new T.SphereGeometry(HR * 1.1, S.hat, 2, 0, 6.2832, 0, Math.PI * 0.46), mat(0, hy + 0.012, 0, 1, 1.02, 1), wh, { tint: PT(3, 4) });
    g.add(BOX, mat(0, hy + 0.07, 0.235, 0.24, 0.024, 0.17, 0, 0.12), wh, { tint: PT(3, 4) });
    g.add(new T.CylinderGeometry(0.36, 0.36, 0.022, S.hat + 2, 1), mat(0, hy + 0.11, 0, 1, 1, 1), wh, { tint: PT(4, 4) });
    g.add(new T.CylinderGeometry(0.18, 0.205, 0.16, S.hat, 1), mat(0, hy + 0.2, 0, 1, 1, 1), wh, { tint: PT(4, 4) });
    // 新聞（胸の前に両手で広げる）・スマホ（右手。腕を上げると顔の前に来る）
    g.add(BOX, mat(0, SY - 0.15, 0.42, 0.46, 0.32, 0.012, 0, -0.45), paperCol, { tint: PT(5, 0) });
    g.add(BOX, mat(SX, SY - 0.53, 0.06, 0.075, 0.14, 0.014), phone, { tint: PT(6, 0) });
    // 傘（雨の日だけ。頭の上に開き、柄は右手の前へ。色は帽子の色）
    g.add(new T.ConeGeometry(0.6, 0.26, pad ? 10 : 8, 1, true), mat(0, hy + 0.58, 0.06, 1, 1, 1), wh, { tint: PT(8, 4) }); g.add(new T.CylinderGeometry(0.012, 0.012, 0.95, 4), mat(0.12, hy + 0.1, 0.12, 1, 1, 1), C('#2a2a2a'), { tint: PT(8, 0) });
    // 長い髪（頭の後ろから肩へ）
    g.add(new T.SphereGeometry(0.17, pad ? 6 : 5, S.lh), mat(0, hy - 0.13, -0.09, 1.08, 1.4, 0.62), wh, { tint: PT(7, 3) });
    return g.build();
  }
  const CROWD_HEAD = [
    'attribute float tint; attribute vec4 aPose; attribute vec3 aPants; attribute vec3 aHair; attribute vec3 aHat;',
    'uniform float uTime; uniform float uCheer; uniform float uLeadX; uniform float uRain; uniform vec2 uSh;',
    // 肩を軸に x 軸まわりへ th（前へ振り上げ）、そのあと z 軸まわりへ sp（腕を開く）
    'vec3 crowdRot( vec3 v, float th, float sp ) {',
    '  float c = cos( th ), s = sin( th );',
    '  v = vec3( v.x, v.y * c + v.z * s, - v.y * s + v.z * c );',
    '  float c2 = cos( sp ), s2 = sin( sp );',
    '  return vec3( v.x * c2 - v.y * s2, v.x * s2 + v.y * c2, v.z );',
    '}'].join('\n');
  // color_vertex（いちばん先に来る）の所で、人ごとの姿を決めて色を付ける。
  // 動きは 1 人ごとに 0.2〜0.8 秒ずらす（cOff。立っている場所から決まる）。応援（uCheer）も 1 人ずつ少し遅れて始まる。
  // 応援の種類（aPose.w / 4）: 1 両手を上げて跳ねる / 2 胸の前で手をたたく / 0 しない
  const CROWD_POSE = [
    'float cPart = floor( tint / 8.0 + 0.01 ), cKind = tint - cPart * 8.0;',
    'float cShow = 1.0, cTh = 0.0, cSp = 0.0, cEx = 0.0, cCl = 0.0, cPh = 0.0, cT = uTime;',
    'vec3 cPiv = vec3( 0.0 );',
    '#ifdef USE_INSTANCING',
    '  cPh = instanceMatrix[ 3 ].x * 1.37 + instanceMatrix[ 3 ].z * 2.11;',
    '  float cOff = 0.2 + 0.6 * fract( sin( dot( instanceMatrix[ 3 ].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );',
    '  cT = uTime - cOff;',
    '  float cHat = mod( aPose.z, 4.0 ), cLong = mod( floor( aPose.z / 4.0 + 0.01 ), 2.0 ), cUmb = floor( aPose.z / 8.0 + 0.01 ) * step( 0.5, uRain ), cProp = mod( aPose.w, 4.0 ), cFan = floor( aPose.w / 4.0 + 0.01 );',
    '  float cOn = uCheer * smoothstep( cOff * 0.9, cOff * 0.9 + 0.2, uCheer ) * ( 0.25 + 0.75 * exp( - pow( ( instanceMatrix[ 3 ].x - uLeadX ) / 55.0, 2.0 ) ) ) * ( 1.0 - cUmb );',
    '  cEx = cOn * step( 0.5, cFan ) * step( cFan, 1.5 );',
    '  cCl = cOn * step( 1.5, cFan );',
    '  if ( abs( cPart - 3.0 ) < 0.5 ) cShow = abs( cHat - 1.0 ) < 0.5 ? 1.0 : 0.0;',
    '  if ( abs( cPart - 4.0 ) < 0.5 ) cShow = abs( cHat - 2.0 ) < 0.5 ? 1.0 : 0.0;',
    '  if ( abs( cPart - 5.0 ) < 0.5 ) cShow = abs( cProp - 1.0 ) < 0.5 ? 1.0 : 0.0;',
    '  if ( abs( cPart - 6.0 ) < 0.5 ) cShow = abs( cProp - 2.0 ) < 0.5 ? 1.0 : 0.0;',
    '  if ( abs( cPart - 7.0 ) < 0.5 ) cShow = cLong;',
    '  if ( cPart > 7.5 ) cShow = cUmb;',
    '  float aL = aPose.x, aR = mix( aPose.y, 1.45, cUmb );',
    '  aL += step( 2.2, aL ) * sin( cT * 3.1 + cPh ) * 0.22;',       // 上げた手はゆっくり振る
    '  aR += step( 2.2, aR ) * sin( cT * 3.4 + cPh * 1.3 ) * 0.22;',
    '  aL = mix( aL, 1.2 + sin( cT * 9.0 + cPh ) * 0.2, cCl );',      // 手をたたく（胸の前で上下に）
    '  aR = mix( aR, 1.2 + sin( cT * 9.0 + cPh + 0.5 ) * 0.2, cCl );',
    '  aL = mix( aL, 2.7 + sin( cT * 6.0 + cPh ) * 0.3, cEx );',
    '  aR = mix( aR, 2.7 + sin( cT * 6.0 + cPh + 1.7 ) * 0.3, cEx );',
    '  if ( abs( cPart - 1.0 ) < 0.5 ) { cTh = aL; cSp = mix( -0.07, 0.42, smoothstep( 1.7, 2.6, aL ) ); cPiv = vec3( - uSh.x, uSh.y, 0.0 ); }',
    '  if ( abs( cPart - 2.0 ) < 0.5 || abs( cPart - 6.0 ) < 0.5 ) { cTh = aR; cSp = - mix( -0.07, 0.42, smoothstep( 1.7, 2.6, aR ) ); cPiv = vec3( uSh.x, uSh.y, 0.0 ); }',
    '#endif',
    '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )',
    '  vColor = vec3( 1.0 );',
    '#endif',
    '#ifdef USE_COLOR',
    '  vColor *= color;',
    '#endif',
    '#ifdef USE_INSTANCING_COLOR',
    '  if ( abs( cKind - 1.0 ) < 0.5 ) vColor *= instanceColor.xyz;',
    '#endif',
    '#ifdef USE_INSTANCING',
    '  if ( abs( cKind - 2.0 ) < 0.5 ) vColor *= aPants;',
    '  if ( abs( cKind - 3.0 ) < 0.5 ) vColor *= aHair;',
    '  if ( abs( cKind - 4.0 ) < 0.5 ) vColor *= aHat;',
    '#endif'].join('\n');
  const CROWD_MOVE = [
    'vec3 transformed = ( cPiv + crowdRot( vec3( position ) - cPiv, cTh, cSp ) ) * cShow;',   // 消す部品は 1 点に縮める（三角形の面積 0 で描かれない）
    '#ifdef USE_INSTANCING',
    '  transformed.x += sin( cT * 1.9 + cPh ) * 0.022 * transformed.y;',
    '  transformed.y += max( 0.0, sin( cT * 2.7 + cPh * 1.7 ) - 0.9 ) * 0.35 + cEx * max( 0.0, sin( cT * 7.0 + cPh ) ) * 0.12 + cCl * max( 0.0, sin( cT * 4.5 + cPh ) ) * 0.025;',
    '#endif'].join('\n');
  // sh: 肩の位置 [左右, 高さ]（形ごと。立ち 1.3・座り 0.8）。lam: 軽い画質は Lambert、それ以外はつや消しの Standard（粗さ 0.85）
  function crowdMat(sh, lam) {
    const m = lam ? new T.MeshLambertMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.35 }), uSh = { value: new T.Vector2(sh[0], sh[1]) };
    m.userData.noWet = true;   // 雨でも服は光らせない
    m.onBeforeCompile = (s) => {
      s.uniforms.uTime = CROWD_U.uTime; s.uniforms.uCheer = CROWD_U.uCheer; s.uniforms.uLeadX = CROWD_U.uLeadX; s.uniforms.uRain = CROWD_U.uRain; s.uniforms.uSh = uSh;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + CROWD_HEAD)
        .replace('#include <color_vertex>', CROWD_POSE)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = crowdRot( vec3( normal ), cTh, cSp );')
        .replace('#include <begin_vertex>', CROWD_MOVE);
    };
    m.customProgramCacheKey = () => 'venueCrowd3' + m.type;
    return m;
  }
  // 色（sRGB）: 服は落ち着いた色が 8 割強（白・生成り・紺・灰・カーキ・くすんだ青や緑）、鮮やかな色（ACCENT）は 2 割弱
  const CALM = ['#eeeeea', '#eeeeea', '#dcd7cb', '#2d3138', '#394457', '#4e5b70', '#6b7280', '#8e949b', '#a99f8a', '#5f6a53', '#7b6957', '#98a8b5', '#b3a69f', '#6c5b6c', '#4e6c69', '#c8b99b'];
  const ACCENT = ['#c4483f', '#d9b041', '#3f7cbf', '#d27c99', '#dc8640', '#3d9068'];
  const SHIRTS = CALM.concat(ACCENT), ACC0 = CALM.length;
  const PANTS = ['#3b4f6e', '#3b4f6e', '#2a2d33', '#22252a', '#b5aa90', '#6c7078', '#454b57', '#8a7e63', '#dcd9cf'];
  const HAIRS = ['#1d1a18', '#1d1a18', '#1d1a18', '#3a2a20', '#5e4232', '#9a9893', '#a8743e'];
  const HATS = ['#efefea', '#2c3a52', '#b8473f', '#1f2023', '#d6c8a6', '#4b6e52', '#d4b44c', '#4d74b0', '#cf8ca2'];
  const ACCENT_P = 0.19;   // 鮮やかな服の割合（ふだん。2026-10-16 の 2 回目で元の値に戻した）
  // 1 人ぶんの姿を決める。o: { kids（子どもの割合）, rail（ラチ際＝前列。手すりに手を置く人が多く、ゴール前は 2 割が両手を上げる）, seat（座り）, fanTone（そろいの服の色: [色の番号の候補]）}
  function rollPerson(r, o) {
    o = o || {};
    const kid = !o.seat && r() < (o.kids != null ? o.kids : 0.05);
    const h = kid ? 0.6 + r() * 0.12 : 0.88 + r() * 0.24, w = kid ? 0.78 + r() * 0.08 : 0.88 + r() * 0.3;
    const fr = r();
    let L = 0.04 + r() * 0.14, R = 0.04 + r() * 0.14, prop = 0, fan = o.rail ? (fr < 0.2 ? 1 : fr < 0.5 ? 2 : 0) : (fr < 0.1 ? 1 : fr < 0.38 ? 2 : 0);
    const u = r();
    if (o.rail && u < 0.32) { L = 0.55 + r() * 0.25; R = 0.55 + r() * 0.25; }              // 手すりの方へ手を下ろして身を乗り出す（前へ水平に伸ばすと人形が手を突き出して見えるので斜め下）
    else if (u < 0.4) { /* 腕を下ろす */ }
    else if (u < 0.52) { L = 0.95 + r() * 0.1; R = L; prop = 1; fan = 0; }             // 新聞を読む（応援しない）
    else if (u < 0.6) { R = 1.85 + r() * 0.35; prop = 2; }                             // スマホで写真を撮る
    else if (u < 0.64) { R = 2.5 + r() * 0.35; }                                       // 片手を上げる
    else if (u < 0.66) { L = 2.5 + r() * 0.3; R = 2.5 + r() * 0.3; }                   // 両手を上げる
    else if (u < 0.8) { L = 0.5 + r() * 0.15; R = 0.5 + r() * 0.15; }                 // 腕を組む・前で手を組む
    else if (u < 0.85) { R = 2.35 + r() * 0.1; prop = 2; fan = 0; }                    // 電話をかける
    else if (u < 0.92) { L = 0.25 + r() * 0.3; R = 1.0 + r() * 0.3; }                  // 指さす・身ぶり
    const hat = r() < (kid ? 0.5 : 0.2) ? 1 : r() < 0.08 ? 2 : 0, long = r() < 0.3 ? 1 : 0, umb = !o.seat && r() < 0.36 ? 1 : 0;
    const si = o.fanTone && r() < 0.6 ? o.fanTone[(r() * o.fanTone.length) | 0] : r() < ACCENT_P ? ACC0 + ((r() * ACCENT.length) | 0) : (r() * CALM.length) | 0;
    return { h, w, d: w * (0.92 + r() * 0.16), L, R, pose: [L, R, hat + 4 * long + 8 * umb, prop + 4 * fan],
      shirt: si, bright: 0.92 + r() * 0.16, pants: (r() * PANTS.length) | 0, hair: (r() * HAIRS.length) | 0, hatc: (r() * HATS.length) | 0 };
  }
  /* ================= 組み立て ================= */
  function build(scene, opts) {
    opts = opts || {};
    const low = (opts.quality || R3D.quality || 'high') === 'low';
    TVQ = low && !!(opts.tv || R3D.tv);
    XLQ = TVQ && !!(opts.xlite || R3D.xlite);   /* テレビの画質「さらになめらか（最軽量）」（2026-10-28）: 観客・木・旗をさらに間引く */
    XMQ = XLQ && !!R3D.xmin;   /* 軽い 3D（2026-10-29）: テレビの画質「最もなめらか」だけ。絵の大きさ・ラチと生け垣の断面・ハロン棒の円柱・木の葉の房・観客の数を軽く */
    const root = new T.Group(); root.name = 'venue'; scene.add(root);
    const crowdCv = cv(2048, 512), cueCrowd0 = cueHorse(CUES, 'crowd'); crowdTex(crowdCv, cueCrowd0 >= 0 ? CUE_CLOTH[cueCrowd0] : null);
    const TX = { blob: blobTex(), flower: flowerTex(), turf: turfTex(), dirt: dirtTex(), grass: grassTex(), ground: grassTex(true), leaf: leafTex(), crowd: tex(crowdCv), glass: glassTex(), win: winTex(), plate: plateTex(), sign: signTex(), score: scoreTex() };
    const boardCv = cv(1024, 344); drawBoard(boardCv, 'casa DERBY', 'まもなく発走'); TX.board = tex(boardCv, { clamp: true });
    const M = makeMats(low, TX);
    if (!low) { TX.detail = detailTex(); detailPatch(M.turf, TX.detail, 24, 0.2); detailPatch(M.dirt, TX.detail, 20, 0.4); detailPatch(M.grass, TX.detail, 40, 0.18); detailPatch(M.ground, TX.detail, 30, 0.16); }   // 細かい模様は控えめ（芝が遠くでざらつかない。講評 v2-1 の 2）
    satPatch(M.turf, SAT_U.turf); satPatch(M.grass, SAT_U.green); satPatch(M.ground, SAT_U.green); satPatch(M.hedge, SAT_U.green);
    satPatch(M.crowd, SAT_U.stand); satPatch(M.glass, SAT_U.stand); satPatch(M.parasol, SAT_U.mid); satPatch(M.flag, SAT_U.mid);
    [M.city, M.hill, M.leaf, M.hedge, M.conc, M.glass, M.crowd, M.ground].forEach(hazePatch);
    const G = { rail: new Geo(), judge: new Geo(), judgeGlass: new Geo(), flower: new Geo(), grass: new Geo(), ground: new Geo(), pave: new Geo(), plastic: new Geo(), railIn: new Geo(), conc: new Geo(), glass: new Geo(), crowd: new Geo(), sign: new Geo(), plate: new Geo(), city: new Geo(), hill: new Geo(), hedge: new Geo() };
    const posts = [], postsIn = [], trees = [], people = [], peopleFar = [], seated = [], parasols = [];
    // 花壇（箱）: 側面は植え込み、上は花。tint で花の色味
    function bed(x, z, w, d, h, tint, ry) {
      G.hedge.box(x, h / 2, z, w, h, d, C(HEDGE), ry || 0, { uvf: (X, y, Z) => [X / 2 + Z / 2, y] });
      G.flower.add(PLANE, mat(x, h + 0.01, z, w, d, 1, ry || 0, -Math.PI / 2), tint, { uvf: flUV });
    }
    // 丸い花壇（輪）: 中心 (x,z)、半径 r0〜r1
    function bedRing(x, z, r0, r1, h, tint, n) {
      n = n || 48;
      for (let k = 0; k < n; k++) {
        const a = k / n * 6.2832, b = (k + 1) / n * 6.2832, P = (r, t, y) => [x + r * Math.cos(t), y, z + r * Math.sin(t)];
        G.flower.quad(P(r0, a, h), P(r1, a, h), P(r1, b, h), P(r0, b, h), tint, null, 0, [0, 1, 0]);
        G.hedge.quad(P(r1, a, 0), P(r1, b, 0), P(r1, b, h), P(r1, a, h), C(HEDGE), [a * 8, 0, b * 8, 0, b * 8, h, a * 8, h], 0, [Math.cos(a), 0, Math.sin(a)]);
        if (r0 > 0.1) G.hedge.quad(P(r0, a, 0), P(r0, b, 0), P(r0, b, h), P(r0, a, h), C(HEDGE), [a * 8, 0, b * 8, 0, b * 8, h, a * 8, h], 0, [-Math.cos(a), 0, -Math.sin(a)]);
      }
    }
    const R = srand(2024);

    /* ---------- 地面: 内馬場（中心〜内側のコース）、内側のコースと芝の間、外の地面 ---------- */
    const gIn = C('#ffffff'), gOut = C('#d8dccb');
    sweep(G.grass, cpath(0, 0, L, 2, 25), [[DIN, 0], [0, 0]], gIn, worldUV(48));
    sweep(G.grass, cpath(DOUT, 0, L, 1.5, 25), [[RI - DOUT, 0], [0, 0]], gIn, worldUV(48));
    // 外の地面: コースのそば → 遠くほどくすんだ色
    const farCol = (x, y, z) => { const d = Math.max(0, Math.hypot(Math.max(0, Math.abs(x) - LS / 2), z) - RO); return gIn.clone().lerp(gOut, Math.min(1, d / 260)); };
    sweep(G.ground, cpath(RO, 0, L, 1.5, 25), [[60, 0], [0, 0]], farCol, worldUV(40));
    sweep(G.ground, cpath(RO, 0, L, 3, 50), [[72, 0], [60, 0]], farCol, worldUV(40));
    // その外は街（アスファルト色）。遠くは田畑の緑に戻る
    const asph = C('#8f9296'), fields = C('#7d9468'), cityCol = (x, y, z) => { const d = Math.hypot(Math.max(0, Math.abs(x) - LS / 2), z); return d < RO + 84 ? farCol(x, y, z).clone().multiply(C('#9fc35a')) : asph.clone().lerp(fields, Math.min(1, Math.max(0, (d - 820) / 260))); };
    sweep(G.hill, cpath(RO, 0, L, 2, 25), [[90, 0], [72, 0]], cityCol);
    sweep(G.hill, cpath(RO, 0, L, 3, 50), [[1600, 0], [90, 0]], cityCol);
    // 芝コース・内側のダート（UV: 横 = 道のり/20m、縦 = 幅）
    const trackG = new Geo(), innerG = new Geo();
    sweep(trackG, cpath(RI, 0, L, 1, 20), [[RO - RI, 0], [0, 0]], C('#ffffff'), (P, q) => [P.s / 20, q[0] / (RO - RI)]);
    sweep(innerG, cpath(DIN, 0, L, 1, 20), [[DOUT - DIN, 0], [0, 0]], C('#ffffff'), (P, q) => [P.s / 20, q[0] / (DOUT - DIN)]);

    /* ---------- ラチ ---------- */
    const white = C('#efefe9'), pstep = TVQ ? 10 : low ? 4 : 2.5;
    addRail(G.rail, posts, RI, -1, white, pstep);             // 芝の内ラチ（支柱は内馬場側）
    addRail(G.rail, posts, RO, 1, white, pstep);              // 芝の外ラチ
    addRail(G.railIn, postsIn, DOUT, 1, white, pstep);        // ダートの外ラチ
    addRail(G.railIn, postsIn, DIN, -1, white, pstep);        // ダートの内ラチ
    // 外ラチの外の生け垣（向正面とコーナー。スタンド前は花壇）
    const sA = LS + 1.0 * RC, sB = 2 * LS + CUR + (Math.PI - 1.0) * RC;
    const hedgeCol = (x, y) => C('#5a9244').clone().multiplyScalar(0.66 + 0.4 * y);
    sweep(G.hedge, cpath(RO + 1.9, LS + 0.25 * RC, 2 * LS + CUR + (Math.PI - 0.25) * RC, 2, 20), XMQ ? [[0.5, 0], [0.5, 1.1], [-0.5, 1.1], [-0.5, 0]] : [[-0.5, 0], [0.5, 0], [0.5, 1.0], [0.35, 1.2], [-0.35, 1.2], [-0.5, 1.0], [-0.5, 0]], hedgeCol, (P, q) => [P.s / 3, q[1] + q[0]]); // 軽い 3D（XMQ）: 生け垣の断面は 3 面（6 面 → 3 面。下の面は見えない）
    // 生け垣の上の実のかたまり（kind 5。向正面〜4 コーナーの内馬場のカメラと、4 コーナーのクレーンのカメラの背景に入る目の高さ）
    for (let s = LS + 0.3 * RC, ks = 0; s < 2 * LS + CUR + (Math.PI - 0.3) * RC; s += (XLQ ? 20 : TVQ ? 12 : low ? 6 : 5) * (0.85 + 0.3 * hash3(ks++, 2, 3))) { const q = CO.pointAt(s, RO + 1.9 - 0.22); trees.push({ x: q.x, y: 1.14, z: q.z, h: 1, rad: 0.5, tone: 1, kind: 5 }); }
    // 最後の直線（スタンド前）の花壇の上にも（2 回目。横からのゴール前のカメラの背景）
    for (let x = SX0 - 4, ks = 0; x < SX1 + 4; x += (XLQ ? 20 : TVQ ? 12 : low ? 7 : 5.5) * (0.85 + 0.3 * hash3(ks++, 4, 1))) trees.push({ x, y: 0.62, z: RO + 2.6 + (hash3(x, 1, 2) - 0.5) * 0.8, h: 1, rad: 0.5, tone: 1, kind: 5 });

    /* ---------- ハロン棒（残り 100m ごと。200m ごとに数字の円板）とゴール板 ---------- */
    const red = C('#d42a2a');
    const stripedPole = (x, z, h, rad, seg) => { for (let k = 0; k < seg; k++) G.plastic.add(XMQ ? CYL_XL : CYL, mat(x, h * (k + 0.5) / seg, z, rad, h / seg, rad), k % 2 ? white : red); };
    const discPair = (x, y, z, ox, oz, rad, cellI) => {
      const ry = Math.atan2(ox, oz);
      G.plate.add(XMQ ? DISC_XL : DISC, mat(x + ox * 0.03, y, z + oz * 0.03, rad, rad, 1, ry), C('#ffffff'), { uvT: cellUV(cellI) });
      G.plate.add(XMQ ? DISC_XL : DISC, mat(x - ox * 0.03, y, z - oz * 0.03, rad, rad, 1, ry + Math.PI), C('#ffffff'), { uvT: cellUV(cellI) });
      G.plastic.add(XMQ ? CYL_XL : CYL, mat(x, y, z, rad * 1.04, 0.05, rad * 1.04, ry, Math.PI / 2), white);
    };
    for (let m = 100; m <= 2400; m += 100) {
      const s = FINISH_S - m, p = CO.pointAt(s, RI - 0.95), o = outAt(s), big = m % 200 === 0 && m <= 1600;
      if (big) { stripedPole(p.x, p.z, 3.3, 0.13, 6); discPair(p.x, 3.3 + 0.44, p.z, o.x, o.z, 0.44, m / 200 - 1); }
      else if (m <= 1600) { stripedPole(p.x, p.z, 2.3, 0.1, 4); discPair(p.x, 2.3 + 0.26, p.z, o.x, o.z, 0.26, 15); }
    }
    for (const [r, sgn] of [[RI - 1.0, -1], [RO + 1.0, 1]]) {
      const p = CO.pointAt(FINISH_S, r), o = outAt(FINISH_S);
      G.plastic.add(XMQ ? CYL_XL : CYL, mat(p.x, 2.6, p.z, 0.18, 5.2, 0.18), white);
      G.plastic.add(XMQ ? CYL_XL : CYL, mat(p.x, 3.3, p.z, 0.19, 0.5, 0.19), red);
      G.plastic.box(p.x, 0.15, p.z, 0.7, 0.3, 0.7, C('#9a9a96'));
      discPair(p.x, 5.2 + 0.85, p.z, o.x, o.z, 0.85, 14);
      if (sgn > 0) { // 決勝審判室（ガラス張り）: 本物どおりスタンドのゴール線の所（下の段の上・張り出しの先）。前はラチの外の柱の上にあり、ゴール前の低い横のカメラで先頭の馬を隠していた
        const zx = ZS + 13.6;
        G.judge.box(p.x, 14.55, zx, 3.4, 0.3, 3.4, C('#d6d3cb'));
        G.judgeGlass.box(p.x, 15.75, zx, 3.2, 2.1, 3.2, C('#ffffff'), 0, { uvf: (x, y, z, nx) => [(Math.abs(nx) > 0.5 ? z : x) / 6, y / 4] });
        G.judge.box(p.x, 16.95, zx, 3.8, 0.3, 3.8, C('#2f74d0'));
        for (const dx of [-1.55, 1.55]) G.judge.box(p.x + dx, 10.5, zx - 1.4, 0.3, 8.4, 0.3, C('#e9e8e2'));   // 前の 2 本の細い柱（下の段の観客席に立つ）
      }
    }
    // 決勝線（芝の上の細い白線）
    { const a = CO.pointAt(FINISH_S - 0.25, RI), b = CO.pointAt(FINISH_S + 0.25, RI), c = CO.pointAt(FINISH_S + 0.25, RO), d = CO.pointAt(FINISH_S - 0.25, RO);
      G.pave.quad([a.x, 0.012, a.z], [b.x, 0.012, b.z], [c.x, 0.012, c.z], [d.x, 0.012, d.z], C('#f4f4ee'), null, 0, [0, 1, 0]); }

    /* ---------- スタンド前の広場・花壇 ---------- */
    { // 広場の敷石（10m ごとに少し色の違う板）
      const r = srand(7);
      // 帯: ラチ際の敷石 / 立ち見の所（踏まれて少し暗いコンクリート）/ 真ん中の広場（敷石）/ スタンド前の帯。
      // 前は「上から見た観客の模様」を床に貼っていたが、細かい斑点に見えるのでやめ、本物の人（3D）と足元の影で密度を出す
      const bands = [[RO + 3.6, RO + 4.4, '#b9b3a8'], [RO + 4.4, RO + 14, '#a9a59d'], [RO + 14, ZS - 7.5, '#bdb7ab'], [ZS - 7.5, ZS, '#a7a39b']];
      for (const [za, zb, base] of bands) for (let x = SX0 - 8; x < SX1 + 8; x += 10) {
        for (let z = za; z < zb - 0.01; z += 9.6) { const z1 = Math.min(zb, z + 9.6); G.pave.quad([x, 0.03, z], [x + 10, 0.03, z], [x + 10, 0.03, z1], [x, 0.03, z1], vary(C(base), 0.07, r), null, 0, [0, 1, 0]); }
      }
      // 立ち見の所の白線（場所取りの区切り。手すりと平行）と目地
      for (let x = SX0 - 8; x < SX1 + 8; x += 10) G.pave.quad([x, 0.034, RO + 9.1], [x + 9.4, 0.034, RO + 9.1], [x + 9.4, 0.034, RO + 9.22], [x, 0.034, RO + 9.22], C('#d9d6cf'), null, 0, [0, 1, 0]);
      // 花壇（赤い花・白い花）と植え込み
      for (let x = SX0 - 6; x < SX1 + 6; x += 22.5) {
        const x1 = Math.min(SX1 + 6, x + 20), col = C(['#ff7f86', '#ff7f86', '#ffffff', '#ffd08a'][(r() * 4) | 0]);
        bed((x + x1) / 2, RO + 2.6, x1 - x, 1.6, 0.64, col);
      }
      // 外ラチの後ろの広告板（ゴール前の直線。少し後ろへ傾ける）
      for (let x = -40, k = 0; x < LS / 2 - 8; x += 12, k++) {
        const x0 = x, x1 = x + 10, zb = RO + 1.05, zt = RO + 1.45, u0 = (k % 2) * 0.5;
        G.sign.quad([x1, 0.15, zb], [x0, 0.15, zb], [x0, 1.05, zt], [x1, 1.05, zt], C('#ffffff'), adQuadUV(k % 2 ? k * 5 + 3 : 0), 0, [0, 0.4, -1]);   /* 1 枚おきに casa DERBY（確定演出 sign がゴール前にも出る。2026-10-16） */
        G.conc.quad([x0, 0.15, zb + 0.02], [x1, 0.15, zb + 0.02], [x1, 1.05, zt + 0.02], [x0, 1.05, zt + 0.02], C('#d8d8d4'), null, 0, [0, 0.3, 1]);
      }
      // 広場の手すり・柵（花壇の後ろ）
      G.plastic.box((SX0 + SX1) / 2, 1.0, RO + 3.7, SX1 - SX0 + 12, 0.06, 0.06, C('#b9bec4'));
      for (let x = SX0 - 6; x <= SX1 + 6; x += 3) G.plastic.box(x, 0.5, RO + 3.7, 0.05, 1.0, 0.05, C('#9aa0a6'));
    }

    /* ---------- スタンド（ホームストレッチの外） ---------- */
    buildStand(G, low);
    // 観客（広場）: ラチ際の 1 列（手すりに手を置く人が多い）→ その後ろの人だまり（大小のかたまり・通路・すき間）→ スタンド前の帯 → 真ん中を歩く人・立ち話の輪。
    // 密度はゴール前（x≈150）ほど高く、ゆっくり変わるむらで濃い所・薄い所を作る。人どうしは 0.46m 以上あける。
    // 手前の帯は丸みのある形（people）、スタンド前の帯・歩く人は箱の形（peopleFar）。軽い画質はすべて箱の形で人数も減らす
    {
      const r = srand(99), grid = new Map(), CELL = 0.5;
      const gk = (i, j) => (i + 4096) * 8192 + (j + 4096);
      const free = (x, z, d) => {
        const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const L = grid.get(gk(ci + i, cj + j)); if (L) for (const q of L) if ((q[0] - x) ** 2 + (q[1] - z) ** 2 < d * d) return false; }
        return true;
      };
      const mark = (x, z) => { const k = gk(Math.floor(x / CELL), Math.floor(z / CELL)); let L = grid.get(k); if (!L) grid.set(k, L = []); L.push([x, z]); };
      const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-6, r()))) * Math.cos(6.2832 * r());
      const noise = (x, z) => Math.max(0, Math.min(1, 0.55 + 0.45 * Math.sin(x * 0.071 + 1.3) * Math.sin(x * 0.023 + z * 0.11 + 0.7) + 0.22 * Math.sin(x * 0.19 + z * 0.37)));
      const goal = (x) => 0.62 + 0.38 * Math.exp(-Math.pow((x - 150) / 140, 2));
      const face = (x) => Math.PI - Math.max(-0.25, Math.min(0.35, (200 - x) / 500));   // コースを向き、少しゴールの方へ
      // 通路（スタンドの階段からラチへ向かう通り道）: 22〜42m おきに幅 2〜3.4m
      const aisles = []; for (let x = SX0 + 8 + r() * 14; x < SX1 - 5; x += 22 + r() * 20) aisles.push([x, 1.0 + r() * 0.7]);
      const inAisle = (x, z) => aisles.some(([ax, hw]) => Math.abs(x - ax) < hw) && z > RO + 5.6;
      const put = (list, x, y, z, ry, o) => { const p = rollPerson(r, o); p.x = x; p.y = y; p.z = z; p.ry = ry; list.push(p); mark(x, z); return p; };
      // 手前の帯（形の細かさは描くときにカメラからの距離で選ぶ）
      let nNearNow = 0; const near = { push(p) { nNearNow++; people.push(p); } }, zA = RO + 4.55, zB = RO + 13.8;
      // ラチ際の 1 列: 0.5〜0.85m おき、ときどき 1〜4m のすき間
      for (let x = SX0 + 3; x < SX1 - 3;) {
        if (r() > goal(x) * 1.25) { x += 1 + r() * 3; continue; }
        put(near, x, 0.03, zA + r() * 0.22, Math.PI + (r() - 0.5) * 0.5, { rail: true, kids: 0.1 });
        x += (0.5 + r() * 0.35) * (XMQ ? 1.7 : 1); // 軽い 3D: ラチ際の列は 1.7 倍の間隔
      }
      // 人だまり: 中心を密度に比例して選び、3〜17 人をまわりに（ときどき同じ色の服の仲間）
      const nNear = XMQ ? 150 : XLQ ? 260 : TVQ ? 700 : low ? 1000 : 3300;
      for (let tries = 0; nNearNow < nNear && tries < 40000; tries++) {
        const cx = SX0 + 4 + r() * (SX1 - SX0 - 8), cz = zA + 0.8 + Math.pow(r(), 1.25) * (zB - zA - 0.9), dens = goal(cx) * noise(cx, cz);
        if (r() > Math.pow(dens, 1.5) * 1.25 || inAisle(cx, cz)) continue;
        const n = 3 + ((r() * 15 * dens) | 0), sg = 0.6 + r() * 1.2, tone = r() < 0.15 ? [(r() * SHIRTS.length) | 0, (r() * SHIRTS.length) | 0] : null;
        for (let k = 0; k < n; k++) {
          const x = cx + gauss() * sg, z = cz + gauss() * sg * 0.65;
          if (z < zA + 0.55 || z > zB || x < SX0 + 2 || x > SX1 - 2 || inAisle(x, z) || !free(x, z, 0.46)) continue;
          put(near, x, 0.03, z, face(x) + (r() - 0.5) * 0.7 + (r() < 0.1 ? (r() - 0.5) * 2.6 : 0), { fanTone: tone });
        }
      }
      // スタンド前の帯（屋根の下・階段の前）: むらのある人の帯
      const zC = ZS - 7.2, zD = ZS - 0.7, nBack = XMQ ? 40 : XLQ ? 70 : low ? 220 : 700;
      for (let tries = 0, n0 = peopleFar.length; peopleFar.length - n0 < nBack && tries < 12000; tries++) {
        const x = SX0 + 3 + r() * (SX1 - SX0 - 6), z = zC + r() * (zD - zC);
        if (r() > goal(x) * noise(x * 1.3, z + 40) || !free(x, z, 0.5)) continue;
        put(peopleFar, x, 0.03, z, face(x) + (r() - 0.5) * 1.2, {});
      }
      // 真ん中の広場: 2〜5 人の立ち話の輪（内向き）と、歩く人
      for (let k = 0; k < (XLQ ? 12 : low ? 40 : 110); k++) {
        const cx = SX0 + 8 + r() * (SX1 - SX0 - 16), cz = RO + 15.5 + r() * (ZS - RO - 24), n = 2 + ((r() * 4) | 0), rad = 0.45 + n * 0.1;
        for (let j = 0; j < n; j++) { const a = j / n * 6.2832 + r() * 0.5, x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad; if (free(x, z, 0.45)) put(peopleFar, x, 0.03, z, Math.atan2(cx - x, cz - z) + (r() - 0.5) * 0.4, { kids: 0.12 }); }
      }
      for (let k = 0; k < (XLQ ? 12 : low ? 50 : 160); k++) { const x = SX0 + 6 + r() * (SX1 - SX0 - 12), z = RO + 15 + r() * (ZS - RO - 23); if (free(x, z, 0.5)) put(peopleFar, x, 0.03, z, r() * 6.28, { kids: 0.1 }); }
      // 座った観客（下の段の前 2 列、ゴールのまわり）: ところどころ空席
      if (!low) for (let k = 0; k < 2; k++) {
        const z = ZS + 0.5 + 0.55 + k * 1.03, y = 1.4 + (z - ZS - 0.5) * (7.2 / 16.5);
        for (let x = -90; x < SX1 - 4; x += 0.58 + r() * 0.1) { if (r() > 0.25 + 0.75 * noise(x * 2.1, k * 7)) continue; put(seated, x, y - 0.12, z, Math.PI + (r() - 0.5) * 0.35, { seat: true }); }
      }
    }

    const fanFlags = [];   /* 応援団の大きな旗・ゴール板の脇の旗（屋根の旗と同じ形。{ x, y, z, k: 倍率, ry, cue }） */
    /* ---------- 応援団（2026-10-16: 確定演出 crowd がレース中のカメラにも映るように） ----------
       内馬場の縁（最後の直線の奥。スタンド側のクレーン・ゴール前のカメラの背景）と、向正面の生け垣の後ろ（内馬場を走るカメラの背景）。
       ふだんから鮮やかな服の団体（枠色 6 色が混ざる）。crowd のときは 9 割強が枠色の服になる（p.fan） */
    {
      const r = srand(1213), tone = [ACC0, ACC0 + 1, ACC0 + 2, ACC0 + 3, ACC0 + 4, ACC0 + 5], nf = XLQ ? 10 : TVQ ? 18 : low ? 36 : 56, nflag = XLQ ? 1 : TVQ ? 2 : 3;   /* 2 回目: 人数 2 倍、大きな旗（2〜3m）を持つ */
      const group = (cx, cz, w, d, face) => {
        for (let k = 0; k < nf; k++) { const p = rollPerson(r, { fanTone: tone, kids: 0.08 }); p.shirt = tone[(r() * tone.length) | 0]; p.fan = 1; p.x = cx + (r() - 0.5) * w; p.y = 0.03; p.z = cz + (r() - 0.5) * d; p.ry = face + (r() - 0.5) * 0.5; people.push(p); }
        for (let k = 0; k < nflag; k++) fanFlags.push({ x: cx + (r() - 0.5) * w * 0.8, y: 0.03, z: cz + (r() - 0.5) * d, k: 0.5 + r() * 0.12, ry: face + Math.PI / 2 + (r() - 0.5) * 1.2, cue: 1 });
      };
      for (const cx of [-150, -70, 10, 90, 160]) group(cx, DIN - 4.6, 20, 2.2, 0);          // 内馬場の縁。スタンド（+z）を向く
      for (const cx of [-120, -40, 40, 120]) group(cx, -(RO + 4.4), 20, 2.2, 0);             // 向正面の生け垣の後ろ。コース（+z）を向く
      for (const k of [0.3, 0.6]) { const q = CO.pointAt(2 * LS + CUR + k * CUR, RO + 4.4), o = outAt(2 * LS + CUR + k * CUR); group(q.x, q.z, 2.2, 20, Math.atan2(-o.x, -o.z)); }   // 最終コーナーの外の生け垣の後ろ。コースを向く
      // ゴール板の脇の旗（内・外）。確定演出 crowd で枠色
      for (const [rr, dx] of [[RI - 1.0, -1.1], [RI - 1.0, 1.1], [RO + 1.0, -1.1], [RO + 1.0, 1.1]]) { const q = CO.pointAt(FINISH_S, rr); fanFlags.push({ x: q.x + dx, y: 0.03, z: q.z, k: 0.42, ry: Math.PI / 2 + (hash3(dx, rr, 1) - 0.5) * 0.4, cue: 1 }); }
    }

    /* ---------- 内馬場: 池・道・ターフビジョン・低い木 ---------- */
    {
      const pcx = -100, pcz = -19;
      polyFill(G.pave, POND.map(([x, z]) => [(x - pcx) * 1.08 + pcx, (z - pcz) * 1.2 + pcz]), 0.025, C('#b8ad8c'));
      // 内馬場の周回道路（内側のコースの内）
      sweep(G.pave, cpath(DIN - 6, 0, L, 2, 25), [[3.2, 0.02], [0, 0.02]], C('#c4bca8'));
      // ターフビジョン（脚・枠・裏）
      const vx0 = VIS.x - VIS.w / 2, vx1 = VIS.x + VIS.w / 2, frame = C('#30363d'), grey = C('#8b9299');
      for (const lx of [vx0 + 6, vx1 - 6]) G.conc.box(lx, VIS.y0 / 2, VIS.z - 0.8, 1.6, VIS.y0, 1.4, grey);
      G.sign.box(VIS.x, VIS.y0 + VIS.h / 2, VIS.z - 0.7, VIS.w + 1.6, VIS.h + 1.6, 1.4, C('#ffffff'), 0, { uvT: [0.992, 0.015, 0.0001, 0.0001] });   /* 枠: 看板テクスチャの右下の一色の所（確定演出 sign で枠色。ふだんは濃い灰） */
      // ゴール前の内ラチの横断幕（横 12.4m・高さ 0.8m。横からのゴール前のカメラが先頭の馬のすぐ奥に見る。確定演出 sign で枠色＋馬の影絵）
      { const bz = RI + 0.09, x0 = 183, x1 = 195.4; G.sign.quad([x0, 0.25, bz], [x1, 0.25, bz], [x1, 1.05, bz], [x0, 1.05, bz], C('#ffffff'), [0, 0, 0.96875, 0, 0.96875, 0.125, 0, 0.125], 0, [0, 0, 1]); }
      G.conc.box(VIS.x, VIS.y0 + VIS.h + 1.2, VIS.z - 0.7, VIS.w + 1.6, 0.8, 1.6, C('#e8e8e4'));
      G.conc.box(VIS.x, 0.1, VIS.z - 0.8, VIS.w * 0.7, 0.2, 4, C('#a5a39b'));
      // 内馬場の森（みんなでダービーの卓の画面のように、丸い木がぎっしり）。池・ターフビジョン・真ん中の芝生・小道は空ける。
      // カメラ担当の内馬場のカメラ（1 コーナー側 HEADON・3 コーナー手前 POLE）の前も空ける
      const inField = (x, z) => Math.hypot(Math.max(0, Math.abs(x) - LS / 2), z) < DIN - 7.5;
      const clear = (x, z) => (x > -162 && x < -40 && z > -38 && z < 1) || (x > 122 && x < 178 && z > 2) || ((x - 15) ** 2 / 2200 + z * z / 220 < 1)
        || Math.hypot(x - 225, z - (RI - 32)) < 16 || (x > 140 && z > 12) || Math.hypot(x + 170, z + (RI - 32)) < 14 || pathD(x, z) < 3.2;
      // 小道（池 → 真ん中の芝生 → ターフビジョン）
      const pathPts = [[-215, -14], [-185, -2], [-160, 6], [-120, 8], [-80, 6], [-40, 4], [-10, 9], [40, 10], [80, 4], [120, 0], [150, 2]];
      const curve = new T.CatmullRomCurve3(pathPts.map(([x, z]) => new T.Vector3(x, 0, z))), cp = curve.getSpacedPoints(120);
      function pathD(x, z) { let d = 1e9; for (let k = 0; k < cp.length; k += 2) d = Math.min(d, Math.hypot(cp[k].x - x, cp[k].z - z)); return d; }
      for (let k = 0; k + 1 < cp.length; k++) {
        const A = cp[k], B = cp[k + 1], dx = B.x - A.x, dz = B.z - A.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 1.4, nz = dx / l * 1.4;
        G.pave.quad([A.x - nx, 0.025, A.z - nz], [B.x - nx, 0.025, B.z - nz], [B.x + nx, 0.025, B.z + nz], [A.x + nx, 0.025, A.z + nz], C('#d9c9a3'), null, 0, [0, 1, 0]);
      }
      const step = XLQ ? 22 : TVQ ? 15 : low ? 11 : 8.6;
      for (let x = -LS / 2 - DIN; x <= LS / 2 + DIN; x += step) for (let z = -DIN; z <= DIN; z += step * 0.87) {
        const X = x + (R() - 0.5) * step * 0.8 + (Math.round(z / step) % 2) * step * 0.5, Z = z + (R() - 0.5) * step * 0.6;
        if (!inField(X, Z) || clear(X, Z)) continue;
        // 高さはスタンド上段（高さ約 27m）から向正面の馬を見下ろす視線より低く（向正面寄りほど低い）
        const hmax = 27 - 0.141 * (RO + 50 - Z) - 1.2, h = Math.max(3.2, Math.min(7 + R() * 4, hmax - R() * 1.2));
        trees.push({ x: X, z: Z, h, rad: Math.min(4.2 + R() * 1.8, h * 0.62), tone: 0.88 + R() * 0.3, kind: 1 });
      }
      // 真ん中の噴水の広場（石畳・花の輪・噴水）
      const fx = 15, fz = 0, stone = C('#c9c3b8'), stone2 = C('#b3ada3');
      for (let k = 0; k < 48; k++) { const a = k / 48 * 6.2832, b = (k + 1) / 48 * 6.2832, P = (r, t) => [fx + r * Math.cos(t), 0.035, fz + r * Math.sin(t)]; G.pave.quad(P(0, a), P(13, a), P(13, b), P(0, b), k % 2 ? stone : stone2, null, 0, [0, 1, 0]); }
      bedRing(fx, fz, 7.2, 11.2, 0.4, C('#ffffff'), 48);
      G.conc.add(new T.CylinderGeometry(4.6, 4.8, 0.7, 32, 1, true), mat(fx, 0.35, fz, 1, 1, 1), C('#e2ddd3'));
      G.conc.add(new T.TorusGeometry(4.7, 0.18, 6, 32), mat(fx, 0.7, fz, 1, 1, 1, 0, Math.PI / 2), C('#f2efe8'));
      G.conc.add(new T.CylinderGeometry(0.5, 0.8, 2.4, 12), mat(fx, 1.2, fz, 1, 1, 1), C('#e8e4dc'));
      G.conc.add(new T.CylinderGeometry(1.8, 0.4, 0.5, 16), mat(fx, 2.5, fz, 1, 1, 1), C('#f2efe8'));
      const jet = new T.CylinderGeometry(0.12, 0.35, 2.2, 8, 1, true); G.plastic.add(jet, mat(fx, 3.7, fz, 1, 1, 1), C('#eef8ff'));
      G.waterExtra = [fx, fz, 4.5];
      // 向正面寄りの花畑（低いので視線を隠さない）: 丸い花壇と長い花壇
      const gardens = [[-20, -26, 'ring', 7, '#ffffff'], [8, -27, 'ring', 6, '#ffb0b8'], [34, -26, 'ring', 7, '#ffd08a'], [112, -27, 'ring', 6, '#ffffff'], [-182, -18, 'ring', 8, '#ffb0b8']];
      for (const [gx, gz, kind, rr, tint] of gardens) { bedRing(gx, gz, 0, rr, 0.35, C(tint), 32); bedRing(gx, gz, rr + 0.6, rr + 1.6, 0.3, C('#ff9a8a'), 32); }
      for (const [bx, bz, w, tint] of [[70, -30, 26, '#ffd08a'], [70, -24, 26, '#ffb0b8'], [150, -28, 22, '#ffffff'], [-196, 8, 14, '#ffd08a']]) bed(bx, bz, w, 2.6, 0.35, C(tint), 0);
      for (let i = trees.length - 1; i >= 0; i--) { const t = trees[i]; if (t.kind === 1 && (gardens.some(([gx, gz, k, rr]) => Math.hypot(t.x - gx, t.z - gz) < rr + 4) || (t.z < -20 && t.z > -34 && ((t.x > 54 && t.x < 86) || (t.x > 136 && t.x < 164))))) trees.splice(i, 1); }
      // 内馬場の小さな休憩所（白い壁に青い屋根）。まわりの木は空ける
      const pav = [[-46, 21, 12, 7], [96, 20, 10, 6]];
      for (const [bx, bz, w, d] of pav) {
        G.conc.box(bx, 1.5, bz, w, 3, d, C('#f4f1ea'));
        G.conc.add(new T.ConeGeometry(1, 1, 4, 1), mat(bx, 3.9, bz, w * 0.78, 1.8, d * 0.78, Math.PI / 4), C(bx < 0 ? '#d8402e' : '#2f6fd0'));
        G.glass.box(bx, 1.6, bz - d / 2 - 0.02, w * 0.7, 1.4, 0.05, C('#ffffff'), 0, { uvf: (x, y) => [x / 6, y / 4] });
        G.pave.quad([bx - w / 2 - 3, 0.032, bz - d / 2 - 3], [bx + w / 2 + 3, 0.032, bz - d / 2 - 3], [bx + w / 2 + 3, 0.032, bz + d / 2 + 3], [bx - w / 2 - 3, 0.032, bz + d / 2 + 3], C('#d9c9a3'), null, 0, [0, 1, 0]);
      }
      for (let i = trees.length - 1; i >= 0; i--) { const t = trees[i]; if (t.kind === 1 && pav.some(([bx, bz, w, d]) => Math.abs(t.x - bx) < w / 2 + 5 && Math.abs(t.z - bz) < d / 2 + 5)) trees.splice(i, 1); }
      // 小道沿いの花壇
      for (const [bx, bz, ry, tint] of [[-30, 14, 0.1, C('#ffb0b8')], [-60, 13, 0.05, C('#ffffff')], [60, 15, -0.12, C('#ffd08a')], [96, 9, -0.1, C('#ffffff')], [-100, 14, 0.0, C('#ffb0b8')]]) bed(bx, bz, 14, 3, 0.4, tint, ry);
    }

    // 内馬場の縁（ダートの内ラチの内側）に丸い植え込みの列
    for (let s = 0; s < L; s += XLQ ? 14 : TVQ ? 8 : low ? 5 : 3.4) { const p = CO.pointAt(s, DIN - 2.2); trees.push({ x: p.x, z: p.z, h: 1.5 + R() * 0.4, rad: 0.95 + R() * 0.2, tone: 0.95 + R() * 0.15, kind: 2 }); }
    // スタンド前の広場のパラソル（青と白・ときどき赤や緑）
    for (const z of [RO + 19.5, RO + 28]) for (let x = SX0 + 8; x < SX1 - 4; x += 11) { if (R() < 0.12) continue; parasols.push({ x: x + (R() - 0.5) * 2, z: z + (R() - 0.5) * 2 }); }

    /* ---------- 向正面の外: 道・柵・木立（3 列）・街並み・丘 ---------- */
    sweep(G.pave, cpath(RO + 8, sA - 0.3 * RC, sB + 0.3 * RC, 2, 25), [[5.5, 0.02], [0, 0.02]], C('#bcb6a6'));
    sweep(G.conc, cpath(RO + 18, sA - 0.2 * RC, sB + 0.2 * RC, 2, 25), [[0, 0], [0, 1.8], [0.06, 1.8], [0.06, 0]], C('#5d8a62'));
    // 向正面の大看板（casa DERBY の広告。隠れた確定演出 sign で絵柄が変わる）: 道と柵の間、コースの方（+z）を向く。横 20m・縦 3m（2026-10-16 18×2.4 から大きく）、3 枚
    for (const bx of [-110, 0, 110]) {
      const x0 = bx - 10, x1 = bx + 10, bz = -(RO + 11), y0 = 1.2, y1 = 4.2;
      G.sign.quad([x0, y0, bz], [x1, y0, bz], [x1, y1, bz], [x0, y1, bz], C('#ffffff'), adQuadUV(0), 0, [0, 0, 1]);
      G.conc.quad([x0, y0, bz - 0.06], [x1, y0, bz - 0.06], [x1, y1, bz - 0.06], [x0, y1, bz - 0.06], C('#9aa0a6'), null, 0, [0, 0, -1]);
      for (const px of [x0 + 1.5, x1 - 1.5]) G.conc.box(px, y1 / 2, bz - 0.2, 0.25, y1, 0.25, C('#8b9299'));
    }
    const rows = TVQ ? [[23.5, 10, 5, 7.5, 3.8, 4.8, 1], [37, 13, 13, 24, 5.4, 7.2]] : low ? [[23.5, 7, 5, 7.5, 3.2, 4, 1], [33, 8, 12, 20, 4, 5.6], [47, 9, 17, 27, 4.6, 6.6]] : [[22.5, 5, 5, 7.5, 3, 4, 1], [29, 6, 11, 17, 3.6, 5], [38.5, 7, 14, 22, 4.2, 5.8], [50, 8, 17, 28, 4.8, 6.8]];
    for (const [off, step, h0, h1, r0, r1, kind] of rows) {
      let s = sA - 0.12 * RC;
      while (s < sB + 0.12 * RC) {
        const p = CO.pointAt(s, RO + off + (R() - 0.5) * 4), o = outAt(s);
        trees.push({ x: p.x + o.z * (R() - 0.5) * 1.5, z: p.z - o.x * (R() - 0.5) * 1.5, h: h0 + R() * (h1 - h0), rad: r0 + R() * (r1 - r0), tone: 0.8 + R() * 0.35, kind: kind || 0 });
        s += isCurve(s) ? step * RC / (RO + off) * (0.8 + R() * 0.4) : step * (0.8 + R() * 0.4);
      }
    }
    // 4 コーナー・1 コーナーの外（スタンドの脇）にも木のかたまり
    // スタンドの両脇（3〜4 コーナーの外・1 コーナーの外）の広場: 石畳・花壇・丸い木・ベンチ
    for (const [x0, x1, z0, z1] of [[-318, SX0 - 8, 80, ZS + 4], [SX1 + 8, 336, 64, ZS + 4]]) {
      const rr = srand(x0 | 0);
      for (let x = x0; x < x1 - 0.01; x += 8) for (let z = z0; z < z1 - 0.01; z += 8) { const xe = Math.min(x1, x + 8), ze = Math.min(z1, z + 8); G.pave.quad([x, 0.03, z], [xe, 0.03, z], [xe, 0.03, ze], [x, 0.03, ze], vary(C('#d8d1c3'), 0.06, rr), null, 0, [0, 1, 0]); }
      for (let x = x0 + 9; x < x1 - 8; x += 16) for (let z = z0 + 8; z < z1 - 6; z += 13) {
        if (rr() < 0.45) { bed(x, z, 7, 2.4, 0.45, C(['#ffb0b8', '#ffffff', '#ffd08a'][(rr() * 3) | 0]), 0); G.conc.box(x, 0.25, z + 2.2, 3, 0.1, 0.5, C('#b07a4a')); }
        else trees.push({ x: x + (rr() - 0.5) * 4, z: z + (rr() - 0.5) * 4, h: 6 + rr() * 4, rad: 3 + rr() * 1.2, tone: 0.95 + rr() * 0.2, kind: 1 });
      }
    }
    for (const [cx, cz, n] of [[-330, 50, 8], [350, 50, 8]]) for (let k = 0; k < n; k++) trees.push({ x: cx + (R() - 0.5) * 30, z: cz + (R() - 0.5) * 40, h: 12 + R() * 9, rad: 3.4 + R() * 2, tone: 0.85 + R() * 0.3 });
    buildCity(G.city, G.pave, trees, low);
    buildHills(G.hill);
    // スタンド端の大型掲示板（オッズ）
    const sbx = SX0 - 30, sbz = ZS - 2;
    G.conc.box(sbx - 7, 4, sbz + 1, 1.2, 8, 1.2, C('#8b9299')); G.conc.box(sbx + 7, 4, sbz + 1, 1.2, 8, 1.2, C('#8b9299'));
    G.conc.box(sbx, 15, sbz + 1, 23, 15, 1.6, C('#2b3036'));

    /* ---------- パドック ---------- */
    const padPeople = [];
    buildPaddock(G, posts, padPeople, trees, low);

    /* ---------- メッシュにする ---------- */
    const mk = (geo, m, cast, recv, name) => { const me = new T.Mesh(geo.build ? geo.build() : geo, m); me.castShadow = !!cast; me.receiveShadow = recv !== false; me.name = name || ''; me.matrixAutoUpdate = false; me.updateMatrix(); root.add(me); return me; };
    mk(G.grass, M.grass, false, true, 'grass');
    mk(G.ground, M.ground, false, true, 'ground');
    const trackMesh = mk(trackG, M.turf, false, true, 'track');
    const innerMesh = mk(innerG, M.dirt, false, true, 'innerTrack');
    mk(G.pave, M.pave, false, true, 'pave');
    { const wg = new Geo(), sh = new T.Shape(POND.map(([x, z]) => new T.Vector2(x, -z))), pg = new T.ShapeGeometry(sh); pg.rotateX(-Math.PI / 2); pg.translate(0, 0.04, 0); wg.add(pg, null, C('#ffffff'));
      if (G.waterExtra) { const [x, z, r] = G.waterExtra, cg = new T.CircleGeometry(r, 32); cg.rotateX(-Math.PI / 2); cg.translate(x, 0.6, z); wg.add(cg, null, C('#ffffff')); }
      mk(wg, M.water, false, true, 'water'); }
    mk(G.plastic, M.plastic, true, true, 'rails');
    mk(G.rail, M.rail, true, true, 'railsTurf');
    mk(G.judge, M.judge, true, true, 'judgeBox'); mk(G.judgeGlass, M.judgeGlass, false, true, 'judgeBoxGlass');
    const railInMesh = mk(G.railIn, M.railIn, true, true, 'railsInner');
    mk(G.plate, M.plate, true, true, 'plates');
    mk(G.conc, M.conc, true, true, 'concrete');
    mk(G.glass, M.glass, false, true, 'glass');
    mk(G.crowd, M.crowd, false, true, 'crowdTiers');
    mk(G.sign, M.sign, false, true, 'signs');
    mk(G.city, M.city, false, false, 'city');
    mk(G.hill, M.hill, false, false, 'hills');
    mk(G.hedge, M.hedge, !low, true, 'hedges');
    mk(G.flower, M.flower, false, true, 'flowers');
    // ターフビジョンの画面・掲示板の画面
    { const pg = new T.PlaneGeometry(VIS.w, VIS.h); pg.translate(VIS.x, VIS.y0 + VIS.h / 2, VIS.z + 0.01); mk(pg, M.board, false, false, 'turfVision'); }
    { const pg = new T.PlaneGeometry(21, 13); pg.rotateY(Math.PI); pg.translate(sbx, 15, sbz + 0.18); mk(pg, M.score, false, false, 'scoreBoard'); }
    // 支柱（全部のラチをまとめて 1 つの InstancedMesh）
    const allPosts = posts.concat(postsIn), postGeo = new T.BoxGeometry(0.075, 1, 0.075, 1, TVQ ? 1 : 2, 1);
    { // 根元ほど暗く（草の陰・泥はね＝接地感。影の無い軽い画質でも支柱が浮かない）
      const pp = postGeo.attributes.position, cc = new Float32Array(pp.count * 3);
      for (let k = 0; k < pp.count; k++) { if (Math.abs(pp.getY(k)) < 0.01) pp.setY(k, -0.3); const y = pp.getY(k) + 0.5, v = TVQ ? 0.72 + 0.28 * y : 0.62 + 0.38 * Math.min(1, y / 0.2); cc[k * 3] = v; cc[k * 3 + 1] = v; cc[k * 3 + 2] = v * 0.97; }   // 真ん中の段を根元から 0.2m に下げる（三角形は 1 本 12→20。Fire TV 向けは段を足さず上下の 2 色だけ＝三角形は前と同じ）
      postGeo.setAttribute('color', new T.BufferAttribute(cc, 3));
      if (TVQ) { const ix = postGeo.index.array, keep = []; for (let k = 0; k < ix.length; k++) if (k < 12 || k >= 24) keep.push(ix[k]); postGeo.setIndex(keep); }   /* Fire TV: 上下のふた（見えない）を省く（12→8 三角形） */
    }
    const postMesh = new T.InstancedMesh(postGeo, M.post, allPosts.length);
    allPosts.forEach((P, i) => { postMesh.setMatrixAt(i, postMatrix(P)); postMesh.setColorAt(i, white); });
    postMesh.castShadow = true; postMesh.receiveShadow = true; postMesh.name = 'posts'; root.add(postMesh);
    // 木
    const tc = new T.Color();
    // 外の木立の 2 割弱を針葉樹（3）、1 割をポプラ（4。細く高い）に（丸い木ばかりの箱庭っぽさを減らす）
    for (const t of trees) if ((t.kind | 0) === 0) { const u = hash3(t.x, t.z, 7); if (u < 0.17) { t.kind = 3; t.rad *= 0.72; t.h *= 1.08; t.tone *= 0.86; } else if (u < 0.27) { t.kind = 4; t.rad *= 0.5; t.h *= 1.2; t.tone *= 1.06; } }
    // 木の実（隠れた確定演出 fruit）: 外の木立（0）・丸い木（1）・内馬場の縁の植え込み（2）に。Fire TV は三角形 4 の実を少なめ（全部で約 5 千三角形以内）
    // 2026-10-16: 実は 2 倍の大きさ・数も増やす（オーナー「もっとわかりやすく」）。Fire TV は数を 2 割強に絞り（三角形 15 万以内）、その分 1.25 倍大きく
    // 2 回目（同日）: 大きささらに 1.3 倍・自発光。ふだんは base 個（前の半分）だけを小さく（FRUIT_OFF_SCALE）描き、残りは演出のときだけ出す
    // 2026-10-17: 演出のときは枠色ごとの果物（別の InstancedMesh）に置き換えるので、木の実は「ふだんの小さな茶色い実」（base 個）だけ
    const FR = (n, base, size) => { const b = TVQ ? (base > 4 ? 1 : 0) : low ? Math.ceil(base * 0.7) : base; return { n: b, base: b, size: TVQ ? size * 1.25 : size, tv: TVQ }; };
    [[0, treeGeo(low ? 0 : 1, BLOBS_FOREST.slice(0, XMQ ? 1 : TVQ ? 2 : 3), 3, FR(18, 6, 0.078)), 'trees'], [1, treeGeo(low ? 0 : 1, BLOBS_ROUND, 5, FR(14, 5, 0.072)), 'treesRound'], [2, treeGeo(low ? 0 : 1, BLOBS_BUSH, 7, FR(10, 4, 0.18)), 'bushes'], [3, coniferGeo(!low), 'treesConifer'], [4, treeGeo(low ? 0 : 1, BLOBS_POPLAR, 9), 'treesPoplar']].forEach(([kind, tgeo, name]) => {
      const list = trees.filter((t) => (t.kind | 0) === kind); if (!list.length) return;
      const tm = new T.InstancedMesh(tgeo, M.leaf, list.length);
      list.forEach((t, i) => {
        tm.setMatrixAt(i, mat(t.x, 0, t.z, t.rad * 2, t.h, t.rad * 2, hash3(t.x, t.z, 1) * 6.28));
        const hue = hash3(t.z, t.x, 2); tc.setRGB(0.92 + hue * 0.16, 1, 0.88 + hash3(t.x, 3, t.z) * 0.2).multiplyScalar(t.tone);   // 木ごとの色のばらつき（黄み・青みは控えめ）
        if (kind === 3) tc.multiply(C('#c4e0d6')); else if (kind === 4) tc.multiply(C('#fff2c0'));   // 針葉樹は青み、ポプラは黄み
        tm.setColorAt(i, tc);
      });
      tm.castShadow = !low && kind === 1; tm.receiveShadow = true; tm.name = name; root.add(tm);
    });
    /* ---------- 隠れた確定演出 fruit の果物を置く所（コースの近くの木・植え込み・外ラチの生け垣・スタンド前の花壇） ----------
       カメラ: ゲートインの全景（向正面の両側の木）・向正面の並走（外の 1 列目の木と生け垣）・最後の直線（内馬場の縁の植え込みと木）。
       コースの中心線からの距離 dC と、コースへ向く向き（dirC）を出して、木の「コース側の面」に実を付ける。房は葉の下の縁から下がる */
    const FRUITS = (function () {
      const spots = [], fr = srand(4242), RMID = (RI + RO) / 2;
      const courseRel = (x, z) => { const ax = Math.abs(x) - LS / 2; let gx, gz, rad; if (ax <= 0) { rad = Math.abs(z); gx = 0; gz = Math.sign(z) || 1; } else { rad = Math.hypot(ax, z); gx = Math.sign(x) * ax / (rad || 1); gz = z / (rad || 1); } const out = rad > RMID; return { d: Math.abs(rad - RMID), dx: out ? -gx : gx, dz: out ? -gz : gz }; };
      /* 木（中心 cx,cy,cz・横の半径 rx・縦の半径 ry）のコース側の面に n 個。r は実の半径（m） */
      const onTree = (t, cy, rx, ry, n, r) => {
        const c = courseRel(t.x, t.z), a0 = Math.atan2(c.dz, c.dx);
        for (let k = 0; k < n; k++) {
          const a = a0 + (fr() - 0.5) * 1.9, y = -0.3 + fr() * 0.55, cc = Math.sqrt(1 - y * y), ex = Math.cos(a), ez = Math.sin(a);
          /* 1 個の実: 葉の表面のすぐ外。房: 葉の外の縁の下半分から、葉の外へ出て下がる（地面に着かない高さ。葉に埋もれないよう外へ r だけ出す） */
          const by = Math.min(0.25, Math.max(-0.4, (3.2 * r + 0.15 - cy) / ry, y - 0.25)), bc = Math.sqrt(1 - by * by);
          spots.push({ one: [t.x + ex * (cc * rx * 1.02 + r * 0.55), cy + y * ry + r * 0.85, t.z + ez * (cc * rx * 1.02 + r * 0.55)], bunch: [t.x + ex * (bc * rx * 1.04 + r * 0.7), cy + by * ry, t.z + ez * (bc * rx * 1.04 + r * 0.7)], r, ry: a });
        }
      };
      /* Fire TV は数を絞り、カメラが見る所（向正面の外の木・生け垣、最後の直線の奥の内馬場の縁の植え込み）に集めて、1 個を 1.7 倍に */
      const nB = 2, dMax = TVQ ? 34 : 40, nTat = (d) => (TVQ ? 1 : low ? 2 : d < 26 ? 3 : 2), TK = TVQ ? 1.7 : 1;   /* コースに近い木ほど多く */
      const onStraight = (x) => Math.abs(x) < LS / 2 + 25;
      let kt = 0;
      for (const t of trees) {
        const kind = t.kind | 0; if (kind > 2) continue;
        const c = courseRel(t.x, t.z); if (c.d > dMax) continue;
        if (kind === 2) { if (TVQ && (t.z < 0 || !onStraight(t.x))) continue; onTree(t, 0.5 * t.h, t.rad, 0.5 * t.h, nB, TK * Math.min(0.42, 0.3 + t.rad * 0.06)); continue; }
        if (TVQ && (t.z > -RO || !onStraight(t.x) || (kt++ % 2))) continue;   /* Fire TV の木は向正面の外の木だけ（向正面のカメラは外を向く） */
        const cyK = kind === 1 ? 0.58 : 0.52, ryK = kind === 1 ? 0.42 : 0.34;
        onTree(t, cyK * t.h, t.rad, ryK * t.h, nTat(c.d), TK * Math.min(0.68, Math.max(0.32, t.rad * 0.14)));
      }
      /* 外ラチの生け垣（向正面〜4 コーナー）の、コース側の面の上の縁。スタンド前の花壇の前の縁 */
      let kh = 0;
      for (const t of trees) {
        if ((t.kind | 0) !== 5) continue; if (TVQ && (t.y < 1 || (!onStraight(t.x) && (kh++ % 3)))) continue;   /* Fire TV はスタンド前の花壇には置かない（最後の直線のカメラは内馬場を見る） */
        const c = courseRel(t.x, t.z), hedge = t.y > 1, r = (hedge ? 0.3 : 0.26) * TK, off = hedge ? 0.6 : 0.85, top = hedge ? 1.2 : 0.66;
        spots.push({ one: [t.x + c.dx * off, top + r * 0.4, t.z + c.dz * off], bunch: [t.x + c.dx * (off + 0.12), top + 0.05, t.z + c.dz * (off + 0.12)], r: hedge ? r : r * 0.8, ry: Math.atan2(c.dz, c.dx) });
      }
      return spots;
    })();
    /* 果物の材質: 頂点色＋うっすら自発光（uFGlow）＋縁の光（uFRim。葉から浮かせる）。両面（葉・枝の板） */
    const fruitU = { uFGlow: { value: 0.2 }, uFRim: { value: new T.Color(1, 1, 1) } };
    const fruitMat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
    fruitMat.onBeforeCompile = (sh) => {
      sh.uniforms.uFGlow = fruitU.uFGlow; sh.uniforms.uFRim = fruitU.uFRim;
      const rim = sh.fragmentShader.indexOf('vViewPosition') >= 0 ? ' totalEmissiveRadiance += uFRim * pow( 1.0 - abs( dot( normalize( vViewPosition ), normal ) ), 2.2 );\n' : '';
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFGlow;\nuniform vec3 uFRim;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * uFGlow;\n' + rim);
    };
    fruitMat.customProgramCacheKey = () => 'venueFruit';
    const fruitMeshes = [0, 1, 2, 3, 4, 5].map((f) => {
      if (!FRUITS.length) return null;
      const me = new T.InstancedMesh(fruitGeo(f, TVQ), fruitMat, FRUITS.length), bunch = FRUIT_KIND[f] === 'grape';
      FRUITS.forEach((q, i) => {
        const P = bunch ? q.bunch : q.one, rot = q.ry + hash3(P[0], P[2], f) * 1.2 - 0.6, tilt = bunch ? 0 : (hash3(P[2], P[0], 7) - 0.5) * 0.5;
        const k = bunch ? q.r * 1.2 : q.r; me.setMatrixAt(i, mat(P[0], P[1], P[2], k, k, k, rot, tilt));   /* 房は 1.2 倍 */
      });
      me.visible = false; me.castShadow = false; me.receiveShadow = false; me.frustumCulled = false; me.name = 'fruit' + f; root.add(me);
      return me;
    });
    // 観客（人ごとの姿・色は rollPerson で決めた値）。材質は形の細かさごとに 1 つ（同じシェーダを共有）
    const crowdMats = [], matOf = {}, crowdSets = [];   /* crowdSets: [{ me, list }]（隠れた確定演出 crowd で服の色を塗り直すため） */
    const cueBanners = [];   /* [{ me, idx, base }] のぼり・屋根の旗のうち、確定演出 crowd で枠色になるもの（idx は instance の番号、base はふだんの色） */
    function applyBannerCue(f) {
      const cc = f >= 0 ? C(CUE_CLOTH[f]) : null;
      for (const b of cueBanners) { b.idx.forEach((i, k) => b.me.setColorAt(i, cc || b.base[k])); if (b.me.instanceColor) b.me.instanceColor.needsUpdate = true; }
    }
    const crowdMesh = (list, kind, name) => {
      if (!list.length) return null;
      const n = list.length, geo = personGeo(kind), m = matOf[kind] || (matOf[kind] = crowdMat(kind === 'seat' ? [0.265, 0.8] : [0.265, 1.3], low)), me = new T.InstancedMesh(geo, m, n);
      if (kind === 'tv') m.side = T.DoubleSide;
      const pose = new Float32Array(n * 4), pants = new Float32Array(n * 3), hair = new Float32Array(n * 3), hat = new Float32Array(n * 3), tc = new T.Color();
      list.forEach((p, i) => {
        me.setMatrixAt(i, mat(p.x, p.y, p.z, p.w, p.h, p.d, p.ry));
        me.setColorAt(i, tc.copy(C(SHIRTS[p.shirt])).multiplyScalar(p.bright));
        pose.set(p.pose, i * 4); C(PANTS[p.pants]).toArray(pants, i * 3); C(HAIRS[p.hair]).toArray(hair, i * 3); C(HATS[p.hatc]).toArray(hat, i * 3);
      });
      geo.setAttribute('aPose', new T.InstancedBufferAttribute(pose, 4)); geo.setAttribute('aPants', new T.InstancedBufferAttribute(pants, 3));
      geo.setAttribute('aHair', new T.InstancedBufferAttribute(hair, 3)); geo.setAttribute('aHat', new T.InstancedBufferAttribute(hat, 3));
      if (crowdMats.indexOf(m) < 0) { satPatch(m, SAT_U.mid); crowdMats.push(m); }
      me.castShadow = false; me.receiveShadow = true; me.name = name; root.add(me); crowdSets.push({ me, list }); return me;
    };
    // 隠れた確定演出 crowd: 観客の CUE_CROWD_P（応援団 p.fan は CUE_FAN_P）を枠色 f の服にする（f = -1 で元の色）。人ごとの当たり外れは場所から決まる（毎回同じ人）
    function applyCrowdCue(f) {
      const tc = new T.Color(), cc = f >= 0 ? C(CUE_CLOTH[f]) : null;
      for (const { me, list } of crowdSets) {
        for (let i = 0; i < list.length; i++) {
          const p = list[i], on = cc && hash3(p.x, 5, p.z) < (p.fan ? CUE_FAN_P : CUE_CROWD_P);
          me.setColorAt(i, tc.copy(on ? cc : C(SHIRTS[p.shirt])).multiplyScalar(p.bright));
        }
        if (me.instanceColor) me.instanceColor.needsUpdate = true;
      }
    }
    // 広場の立ち見: 高画質は 40m ごとの区画に分け、区画ごとに丸みのある形と箱の形の 2 つを作る。
    // 毎コマ描く直前（scene.onBeforeRender）に、実際のカメラからの距離（望遠ほど近いとみなす）で区画ごとにどちらを描くか選ぶ。軽い画質は箱の形だけ
    const lodBins = [];
    if (low) crowdMesh(people.concat(peopleFar), TVQ ? 'tv' : 'lo', 'crowdStandingFar');
    else {
      const all = people.concat(peopleFar), BW = 40;
      for (let x0 = SX0 - 4; x0 < SX1 + 4; x0 += BW) {
        const bx = (x) => Math.min(SX1 + 3.99, Math.max(SX0 - 4, x));   /* 区画の外（最終コーナーの応援団）は端の区画に入れる */
        const list = all.filter((p) => bx(p.x) >= x0 && bx(p.x) < x0 + BW); if (!list.length) continue;
        let z0 = 1e9, z1 = -1e9; list.forEach((p) => { if (p.fan) return; z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
        if (z0 > z1) { z0 = RO + 4; z1 = ZS; }
        const b = { x0, x1: x0 + BW, z0, z1, on: false, hi: crowdMesh(list, 'hi', 'crowdHi' + lodBins.length), lo: crowdMesh(list, 'lo', 'crowdLo' + lodBins.length) };
        const sph = new T.Sphere(new T.Vector3(x0 + BW / 2, 1.5, (z0 + z1) / 2), Math.hypot(BW / 2, (z1 - z0) / 2, 2) + 1);
        b.hi.geometry.boundingSphere = sph; b.lo.geometry.boundingSphere = sph.clone(); b.hi.visible = false;
        lodBins.push(b);
      }
    }
    const lodCam = new T.Vector3(), K25 = Math.tan(25 * Math.PI / 180);
    function crowdLod(camera) {
      if (!lodBins.length || !camera || !camera.matrixWorld) return;
      lodCam.setFromMatrixPosition(camera.matrixWorld);
      const k = camera.isPerspectiveCamera ? Math.tan(camera.fov * Math.PI / 360) / K25 : 1;   // 縦の画角 50° を基準に、望遠ほど距離を短く
      for (const b of lodBins) {
        const dx = Math.max(0, b.x0 - lodCam.x, lodCam.x - b.x1), dz = Math.max(0, b.z0 - lodCam.z, lodCam.z - b.z1), d = Math.hypot(dx, dz, lodCam.y) * k;
        b.on = d < (b.on ? 125 : 110);   // 行ったり来たりしないよう少し幅を持たせる
        b.hi.visible = b.on; b.lo.visible = !b.on;
      }
    }
    const prevSceneBR = scene.onBeforeRender;
    if (lodBins.length) scene.onBeforeRender = function (r, s, cam) { crowdLod(cam); return prevSceneBR.apply(this, arguments); };
    const padMesh = crowdMesh(padPeople, TVQ ? 'tv' : low ? 'lo' : 'pad', 'crowdPaddock');
    crowdMesh(seated, 'seat', 'crowdSeated');
    // 足元の影（人の影は描かない代わりに、ぼかした丸を床に置く。人だまりが暗いかたまりになって密度が読める）
    {
      const all = people.concat(peopleFar), n = all.length;
      if (n) {
        const bg = new T.PlaneGeometry(1, 1); bg.rotateX(-Math.PI / 2);
        const bm = new T.InstancedMesh(bg, M.blob, n), sx = -CO.SUN.x / CO.SUN.y * 0.35, sz = -CO.SUN.z / CO.SUN.y * 0.35;
        all.forEach((p, i) => bm.setMatrixAt(i, mat(p.x + sx * p.h, p.y + 0.012, p.z + sz * p.h, 0.95 * p.w + 0.25, 1, 0.8 * p.d + 0.25, p.ry)));
        bm.castShadow = false; bm.receiveShadow = false; bm.renderOrder = 1; bm.name = 'crowdBlobs'; root.add(bm);
      }
    }
    // パラソル（柄・8 枚の布を交互に色と白・丸テーブル）
    if (TVQ) parasols.splice(0, parasols.length, ...parasols.filter((_, i) => i % (XLQ ? 4 : 2) === 0)); // Fire TV: パラソルは半分
    if (parasols.length) {
      const pg = new Geo(), wh = C("#f7f7f5"), N8 = 8, Rr = 2.5, Hh = 2.7;
      pg.add(new T.CylinderGeometry(0.03, 0.03, Hh, TVQ ? 4 : 5, 1, true), mat(0, Hh / 2, 0, 1, 1, 1), C('#d8d8d8'));   /* 柄（ふたなし） */
      for (let k = 0; k < N8; k++) {
        const a = k / N8 * 6.2832, b = (k + 1) / N8 * 6.2832, tint = k % 2 ? 0 : 1;
        const A = [0, Hh + 0.42, 0], P1 = [Rr * Math.cos(a), Hh, Rr * Math.sin(a)], P2 = [Rr * Math.cos(b), Hh, Rr * Math.sin(b)];
        const i0 = pg.vert(A[0], A[1], A[2], 0, 1, 0, 0, 0, wh, tint), n1 = [Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25], n2 = [Math.cos(b) * 0.25, 1, Math.sin(b) * 0.25];
        const i1 = pg.vert(P1[0], P1[1], P1[2], n1[0], n1[1], n1[2], 0, 0, wh, tint), i2 = pg.vert(P2[0], P2[1], P2[2], n2[0], n2[1], n2[2], 0, 0, wh, tint);
        pg.i.push(i0, i2, i1);
      }
      pg.add(new T.CylinderGeometry(0.55, 0.55, 0.05, TVQ ? 6 : 12), mat(0, 0.74, 0, 1, 1, 1), wh); pg.add(new T.CylinderGeometry(0.05, 0.05, 0.72, TVQ ? 4 : 5, 1, true), mat(0, 0.36, 0, 1, 1, 1), C('#bbbbbb'));
      const pm = new T.InstancedMesh(pg.build(), M.parasol, parasols.length), pc = [C('#2a62c9'), C('#2a62c9'), C('#2a62c9'), C('#f08cb8'), C('#f08cb8'), C('#d93a3a'), C('#2f9a4a'), C('#f2b632')];
      parasols.forEach((q, i) => { pm.setMatrixAt(i, mat(q.x, 0.03, q.z, 1, 1, 1, hash3(q.x, q.z, 4) * 6.28)); pm.setColorAt(i, pc[(hash3(q.z, q.x, 9) * pc.length) | 0]); });
      pm.castShadow = !low; pm.receiveShadow = true; pm.name = 'parasols'; root.add(pm);
    }

    /* ---------- 発走ゲート ---------- */
    const gate = buildGate(M);
    root.add(gate.group);

    /* ---------- 観覧車（向正面の奥の街。ゆっくり回る） ---------- */
    const wheel = (function () {
      const W = WHEEL, legs = C('#f2f2f2');
      // 脚（動かない）: A の字の 2 組
      for (const dz of [-3.2, 3.2]) for (const sx of [-1, 1]) {
        const x0 = W.x + sx * 17, ang = Math.atan2(17, W.y), len = Math.hypot(17, W.y);
        G.conc.add(BOX, matZ((x0 + W.x) / 2, W.y / 2, W.z + dz, 0.9, len, 0.9, sx * ang), legs);
      }
      G.conc.box(W.x, 0.6, W.z, 40, 1.2, 12, C('#cfc8bb'));
      // 回る部分: 輪 2 本・スポーク・ゴンドラ
      const g = new Geo(), rim = C('#ffffff'), cols = ['#e8322e', '#f7d21e', '#2a62d9', '#2fa84f', '#f08cb8', '#ff9a2a'].map(C);
      for (const dz of [-2.2, 2.2]) g.add(new T.TorusGeometry(W.r, 0.35, TVQ ? 3 : 5, TVQ ? 40 : 64), mat(0, 0, dz, 1, 1, 1), rim);   /* Fire TV は輪を粗く */
      const N = 18;
      for (let k = 0; k < N; k++) {
        const a = k / N * 6.2832, x = Math.cos(a) * W.r, y = Math.sin(a) * W.r;
        for (const dz of [-2.2, 2.2]) g.add(BOX, matZ(x / 2, y / 2, dz, W.r, 0.18, 0.18, a), rim);
        g.add(BOX, mat(x, y, 0, 0.2, 0.2, 4.6), rim);
        g.add(new T.CylinderGeometry(1.25, 1.25, 2.1, 10), mat(x, y - 1.9, 0, 1, 1, 1), cols[k % cols.length]);
        g.add(new T.CylinderGeometry(1.35, 1.35, 0.2, 10), mat(x, y - 0.8, 0, 1, 1, 1), rim);
      }
      g.add(new T.CylinderGeometry(1.6, 1.6, 5.6, 12), mat(0, 0, 0, 1, 1, 1, 0, Math.PI / 2), rim);
      const me = new T.Mesh(g.build(), M.plastic); me.position.set(W.x, W.y, W.z); me.castShadow = false; me.receiveShadow = false; me.name = 'ferrisWheel'; root.add(me);
      return me;
    })();

    /* ---------- 飛行船（内馬場の上をゆっくり回る） ---------- */
    const blimp = (function () {
      const g = new Geo(), wh = C('#f4f6f8'), bl = C('#2a62c9'), ye = C('#ffd54f');
      g.add(new T.SphereGeometry(1, 24, 12), mat(0, 0, 0, 13, 4.2, 4.2), (x, y, z) => (Math.abs(y) < 1.1 && Math.abs(x) < 9 ? bl : Math.abs(y) < 1.5 && Math.abs(x) < 9 ? ye : wh));
      for (const [ry, rx] of [[0, 0], [0, Math.PI / 2]]) g.add(BOX, mat(-11.5, 0, 0, 3.6, 0.25, 6.4, ry, rx), bl);
      g.box(1, -4.4, 0, 4, 1.1, 1.4, C('#dfe3e8')); g.box(1, -4.1, 0, 4.1, 0.25, 1.5, bl);
      const me = new T.Mesh(g.build(), M.plastic); me.castShadow = false; me.receiveShadow = false; me.name = 'blimp'; root.add(me); return me;
    })();

    // スタンドの屋根の上の旗（風でなびく）
    {
      const fg = new Geo(), wh = C('#f2f2f2');
      fg.add(new T.CylinderGeometry(0.07, 0.09, 7, 5), mat(0, 3.5, 0, 1, 1, 1), wh, { tint: 0 });
      for (let k = 0; k < 4; k++) fg.quad([0, 4.9, -k], [0, 4.9, -k - 1], [0, 7, -k - 1], [0, 7, -k], C('#ffffff'), null, 1, [1, 0, 0]);
      const list = [], fz = ZS + 26, fy = 36.4;
      for (let x = SX0, i = 0; x <= SX1; x += 14, i++) list.push({ x, y: fy, z: fz, k: 0.82 + hash3(x, 5, 1) * 0.4, ry: Math.PI / 2 + 0.5 + (hash3(x, 2, 9) - 0.5) * 0.25, cue: i % 2 === 0 ? 1 : 0 });
      fanFlags.forEach((f) => list.push(f));   /* 応援団の大きな旗（倍率 0.5 ＝ 竿 3.5m・旗 2m×1m）とゴール板の脇の旗 */
      const fm = new T.InstancedMesh(fg.build(), M.flag, list.length), fc = ['#e53935', '#fdd835', '#1e88e5', '#43a047', '#fb8c00', '#ffffff', '#8e24aa'].map(C);
      const fb = { me: fm, idx: [], base: [] };
      list.forEach((f, i) => { const col = fc[(i * 3 + (hash3(f.x, 1, f.z) * 2 | 0)) % fc.length]; fm.setMatrixAt(i, mat(f.x, f.y, f.z, f.k, f.k, f.k, f.ry)); fm.setColorAt(i, col); if (f.cue) { fb.idx.push(i); fb.base.push(col); } });
      fm.castShadow = false; fm.receiveShadow = false; fm.name = 'flags'; root.add(fm); cueBanners.push(fb);   /* 屋根の旗は 1 本おき、応援団・ゴール板の旗は全部、確定演出 crowd で枠色 */
    }
    // のぼり（広場の立ち見の後ろ・スタンドの両脇の広場）: 縦長の布を細い竿に。色は枠色＋白・黄緑。風で少しなびく
    {
      const ng = new Geo(), wh = C('#e8e8e8');
      ng.add(new T.CylinderGeometry(0.025, 0.03, 3.9, TVQ ? 4 : 5, 1, true), mat(0, 1.95, 0, 1, 1, 1), wh, { tint: 0 });   /* 竿（ふたなし。2026-10-16 本数が増えたので軽く） */
      ng.add(new T.CylinderGeometry(0.02, 0.02, 0.7, TVQ ? 3 : 4, 1, true), mat(0, 3.75, -0.33, 1, 1, 1, 0, Math.PI / 2), wh, { tint: 0 });
      for (let k = 0; k < 3; k++) { const y0 = 1.55 + k * 0.72; ng.quad([0, y0, 0], [0, y0, -0.66], [0, y0 + 0.72, -0.66], [0, y0 + 0.72, 0], C('#ffffff'), null, 1, [1, 0, 0]); }
      const list = [], rr = srand(41);
      for (let x = SX0 + 6; x < SX1 - 4; x += 13 + rr() * 9) list.push([x + (rr() - 0.5) * 2, RO + 14.4 + rr() * 0.6]);
      for (let k = 0; k < 10; k++) list.push([SX1 + 14 + rr() * 50, RO + 6 + rr() * 30]);
      // 2026-10-16 確定演出 crowd 用の列（[x, z, 1]）: 内馬場の縁（最後の直線の奥）と向正面の生け垣の後ろ。ふだんは色とりどり、crowd のときは全部枠色
      const NSTEP = TVQ ? 12 : 9;
      for (let x = -176; x <= 190; x += NSTEP) list.push([x + (rr() - 0.5) * 2, DIN - 3.3 + (rr() - 0.5) * 0.6, 1]);
      for (let x = -156; x <= 156; x += NSTEP) list.push([x + (rr() - 0.5) * 2, -(RO + 5.6) + (rr() - 0.5) * 0.6, 1]);
      for (let s = 2 * LS + CUR + 0.12 * CUR; s < 2 * LS + 2 * CUR - 0.08 * CUR; s += NSTEP) { const q = CO.pointAt(s, RO + 5.6 + (rr() - 0.5) * 0.6); list.push([q.x, q.z, 1]); }   /* 最終コーナーの外（クレーンのカメラの背景） */
      const nm = new T.InstancedMesh(ng.build(), M.flag, list.length), nc = ['#ffffff', '#e8322e', '#2a62d9', '#f7d21e', '#2fa84f', '#9fd04a', '#ff9a2a', '#f08cb8'].map(C), nb = { me: nm, idx: [], base: [] };
      list.forEach(([x, z, cue], i) => { const col = nc[(rr() * nc.length) | 0]; nm.setMatrixAt(i, mat(x, 0.03, z, 1, 0.92 + rr() * 0.16, 1, (z > 0 && z < RO ? Math.PI / 2 : -Math.PI / 2) + (rr() - 0.5) * 0.3)); nm.setColorAt(i, col); if (cue) { nb.idx.push(i); nb.base.push(col); } });
      nm.castShadow = false; nm.receiveShadow = true; nm.name = 'nobori'; root.add(nm); cueBanners.push(nb);
    }
    // r149 の InstancedMesh は形 1 つ分の大きさで画面外判定をしてしまうので、判定をやめる（会場全体に散らばっているため）
    root.traverse((o) => { if (o.isInstancedMesh) o.frustumCulled = false; });
    // パドックの観客はパドックのまわりだけにいるので、まとめた大きさで画面外判定をする（レース中は描かない）
    lodBins.forEach((b) => { b.hi.frustumCulled = true; b.lo.frustumCulled = true; });   // 区画ごとの大きさで画面外判定
    if (padMesh) { const P = CO.PADDOCK; padMesh.geometry.boundingSphere = new T.Sphere(new T.Vector3(P.cx, 2, P.cz), P.a + 16); padMesh.frustumCulled = true; }

    /* ---------- 操作 ---------- */
    const state = { surface: 'turf', weather: 'sunny', dist: 1600, gate: 'closed', doorK: 0, boardText: 'まもなく発走', t: 0, theme: 'normal' };
    const cream = C('#efe3a4');
    function head() { return 'casa DERBY  ' + (state.surface === 'dirt' ? 'ダート' : '芝') + state.dist + 'm  ' + ({ sunny: '晴', cloudy: '曇', rain: '雨' }[state.weather] || ''); }
    function redrawBoard() { drawBoard(boardCv, head(), state.boardText); TX.board.needsUpdate = true; }
    function applySurface() {
      const dirt = state.surface === 'dirt', wet = state.weather === 'rain', cloudy = state.weather === 'cloudy';
      trackMesh.material = dirt ? M.dirt : M.turf; innerMesh.material = dirt ? M.turf : M.dirt;
      // 馬場の湿り: 雨は暗く・つやを出す
      const th = THEMES[state.theme] || THEMES.normal, wk = wet ? 0.85 : cloudy ? 0.97 : 1;
      M.turf.color.setRGB(th.turf[0] * wk, th.turf[1] * wk, th.turf[2] * wk); M.dirt.color.copy(wet ? C('#b3a596') : C('#ffffff'));
      if (M.turf.roughness !== undefined) { M.turf.roughness = wet ? 0.6 : 0.96; M.dirt.roughness = wet ? 0.55 : 0.96; M.dirt.metalness = 0; }
      const gk = wet ? 0.8 : 1;
      // 彩度: 雨は芝 -13%・草木 -10%、曇りは少しだけ
      CROWD_U.uRain.value = wet ? 1 : 0;   // 雨の日は観客の 3 割強が傘をさす
      HAZE_U.uHaze.value.copy(C(wet ? '#8e999b' : cloudy ? '#a5b0b0' : '#a6b9b3')); HAZE_U.uHazeK.value = state.theme === 'night' ? 0 : wet ? 0.3 : 0.42;   // 空気遠近（雨は霧が強いので控えめ・夜はなし）
      SAT_U.turf.value = wet ? 0.87 : cloudy ? 0.95 : 1; SAT_U.green.value = wet ? 0.9 : cloudy ? 0.96 : 1;
      M.grass.color.setRGB(th.grass[0] * gk, th.grass[1] * gk, th.grass[2] * gk); M.ground.color.setRGB(th.grass[0] * gk, th.grass[1] * gk, th.grass[2] * gk);
      M.pave.color.setScalar(wet ? 0.72 : 1); M.hedge.color.setRGB(th.hedge[0] * (wet ? 0.85 : 1), th.hedge[1] * (wet ? 0.85 : 1), th.hedge[2] * (wet ? 0.85 : 1));
      // 葉の色
      if (th.leaf) { M.leaf.userData.uLeaf.value.copy(C(th.leaf[0])); M.leaf.userData.uLeafMix.value = th.leaf[1]; } else M.leaf.userData.uLeafMix.value = 0;
      // 夜: ラチに水色のネオン、スタンドのガラス・街の窓・ターフビジョンの明かり（空の暗さは照明担当）
      const nt = th.neon || 0;
      M.plastic.emissive.setRGB(0.05 * nt, 0.45 * nt, 0.65 * nt); M.gate.emissive.setRGB(0.04 * nt, 0.36 * nt, 0.52 * nt); M.rail.emissive.setRGB(0.05 * nt, 0.45 * nt, 0.65 * nt); M.railIn.emissive.setRGB(0.05 * nt, 0.4 * nt, 0.6 * nt); M.post.emissive.setRGB(0.04 * nt, 0.3 * nt, 0.45 * nt);
      M.glass.emissive.setRGB(0.55 * nt, 0.48 * nt, 0.32 * nt); M.glass.emissiveMap = nt ? TX.glass : null;
      M.city.emissive.setRGB(0.35 * nt, 0.3 * nt, 0.2 * nt); M.city.emissiveMap = nt ? TX.win : null;
      M.glass.needsUpdate = true; M.city.needsUpdate = true;
      M.water.roughness = wet ? 0.35 : 0.12;
      // 内側のコースのラチ: 芝のときはクリーム色、ダートが本コースのときは白
      M.railIn.color.copy(dirt ? C('#ffffff') : cream);
      for (let i = posts.length; i < allPosts.length; i++) postMesh.setColorAt(i, dirt ? white : cream);
      postMesh.instanceColor.needsUpdate = true;
    }
    function placeGate() {
      const s = CO.gateS ? CO.gateS(state.dist) : CO.startS(state.dist), p = CO.pointAt(s, gate.rMid);   // 1200m（ゴールの真上が発走地点）はゴール板の少し手前
      gate.group.position.set(p.x, 0, p.z); gate.group.rotation.y = Math.atan2(-p.hz, p.hx);
    }
    applySurface(); placeGate();
    // 隠れた確定演出（setCues）を反映: 木の実の色（uniform）、観客の服（instanceColor とスタンドの段の模様の描き直し）、看板の絵柄（canvas の描き直し）
    state.cueCrowd = cueCrowd0;
    function applyCues(cues) {
      const ff = cueHorse(cues, 'fruit'), fc = cueHorse(cues, 'crowd'), fs = cueHorse(cues, 'sign');
      const LU = M.leaf.userData; LU.uFruit.value.copy(C(ff >= 0 ? CUE_FRUIT[ff] : FRUIT_NEUTRAL)); LU.uFruitH.value.copy(C(ff >= 0 ? CUE_FRUIT[ff] : HEDGE_KNOB));
      LU.uFruitHi.value = ff >= 0 ? CUE_FRUIT_HI[ff] : 0; LU.uFruitLo.value = ff >= 0 ? CUE_FRUIT_LO[ff] : 0.2;
      LU.uFruitScale.value = ff >= 0 ? 0 : FRUIT_OFF_SCALE; LU.uFruitExtra.value = 0; LU.uFruitGlow.value.setRGB(0, 0, 0);   /* 演出のときは木の茶色い実を消す */
      fruitMeshes.forEach((me, f) => { if (me) me.visible = f === ff; });   /* 枠色の果物だけ描く（描く回数 +1） */
      if (ff >= 0) { fruitU.uFGlow.value = FRUIT_GLOW[ff]; fruitU.uFRim.value.copy(C(FRUIT_RIM[ff][0])).multiplyScalar(FRUIT_RIM[ff][1]); }
      if (fc !== state.cueCrowd) { applyCrowdCue(fc); applyBannerCue(fc); crowdTex(crowdCv, fc >= 0 ? CUE_CLOTH[fc] : null); TX.crowd.needsUpdate = true; state.cueCrowd = fc; }
      TX.sign.userData.setFrame(fs);
    }
    if (CUES) { applyCues(CUES); if (cueCrowd0 >= 0) { applyCrowdCue(cueCrowd0); applyBannerCue(cueCrowd0); } }   /* 段の模様は作るときに描いたが、人形の服・のぼりはまだ元の色なので塗る */
    // シーンの馬（統合側が scene に直接足す、名前 horseN）を見つけて、ラチ・審判の小屋を薄くする所（FADE_U）と観客の応援（CROWD_U）に使う。
    // 応援: 走っている馬（秒速 4m 以上）が最後の直線（スタンド前の直線とその前後・走った道のりが距離の残り 480m 以内）にいる間、先頭の馬の近くの観客ほど応援する
    const hs = { list: [], at: 0, last: new Map(), lead: -1e4, cheer: 0 };
    function trackHorses(dt) {
      if (hs.at-- <= 0) { hs.at = 30; hs.list = scene.children.filter((o) => /^horse\d+$/.test(o.name)); for (const o of Array.from(hs.last.keys())) if (hs.list.indexOf(o) < 0) hs.last.delete(o); }
      let k = 0, lead = -1e4;
      for (const o of hs.list) {
        if (k >= 6) break;
        if (!o.visible || o.parent !== scene) continue;
        const p = o.position, y = o.rotation.y;
        FADE_U.uHorse.value[k].set(p.x, p.z, Math.cos(y), -Math.sin(y)); FADE_U.uHorseB.value[k].set(2.9, 1); k++;
        if (dt > 1e-4) {
          let q = hs.last.get(o); if (!q) hs.last.set(o, q = { x: p.x, z: p.z, v: 0, d: 0 });
          q.v += (Math.min(30, Math.hypot(p.x - q.x, p.z - q.z) / dt) - q.v) * Math.min(1, dt * 4); q.x = p.x; q.z = p.z;
          q.d = q.v < 1.5 ? 0 : q.d + q.v * dt;   /* 走り出してからの道のり（止まると 0 に戻る） */
          if (q.v > 4 && q.d > state.dist - 480 && p.z > RI - 4 && p.z < RO + 4 && p.x > -LS / 2 - 40 && p.x < LS / 2 + 70) lead = Math.max(lead, p.x);
        }
      }
      for (; k < 6; k++) FADE_U.uHorseB.value[k].set(0, 0);
      if (dt <= 1e-4) return;
      const want = lead > -1e4 ? 1 : 0;
      hs.cheer += (want - hs.cheer) * Math.min(1, dt * (want ? 1.2 : 0.45));
      if (want) hs.lead = hs.lead < -1e3 ? lead : hs.lead + (lead - hs.lead) * Math.min(1, dt * 3);
      CROWD_U.uCheer.value = hs.cheer; CROWD_U.uLeadX.value = hs.lead;
    }
    const venue = {
      group: root,
      info: { standZ: ZS, standX: [SX0, SX1], vision: VIS, gateRMid: gate.rMid },
      fx: { fade: FADE_U, crowd: CROWD_U, sat: SAT_U, haze: HAZE_U },   // 確認用（テストから値を読む）
      setRace(o) {
        o = o || {};
        if (o.dist) state.dist = o.dist; if (o.surface) state.surface = o.surface; if (o.weather) state.weather = o.weather;
        applySurface(); placeGate(); redrawBoard(); gate.setRear(null);
      },
      // 任意: 後ろの扉の開き具合（枠ごと 0..1 の配列。null で全部閉める）。ゲートインの演出で統合側が毎コマ呼ぶ
      setRearDoors(list) { gate.setRear(list); },
      setGate(st) {
        if (st === state.gate) return;
        if (st === 'closed') state.doorK = 0;
        state.gate = st; gate.group.visible = st !== 'hidden'; gate.setDoors(state.doorK);
      },
      // 任意: 季節・時間の見た目（'normal' | 'autumn' | 'sakura' | 'night'）。空・光の暗さは照明担当の側
      setTheme(name) { state.theme = THEMES[name] ? name : 'normal'; applySurface(); },
      // 任意（カメラ担当向け）: ラチ・審判の小屋の「後ろの馬を見せるために薄くする」強さ 0..1（既定 1。0 で本物どおり不透明）
      setRailFade(k) { FADE_U.uFade.value = Math.max(0, Math.min(1, +k || 0)); },
      setBoard(text) { text = String(text == null ? '' : text); if (text === state.boardText) return; state.boardText = text; redrawBoard(); },
      // 隠れた確定演出（ファイル冒頭の説明）。cues = { fruit: { horse }, crowd: { horse }, sign: { horse }, … } か null。いつ呼んでもよく、すぐ効く
      setCues(cues) { CUES = cues && typeof cues === 'object' ? Object.assign({}, cues) : null; applyCues(CUES); },
      get cues() { return CUES; },
      update(dt, t) {
        dt = Math.min(0.1, Math.max(0, dt || 0)); state.t = t != null ? t : state.t + dt;
        trackHorses(dt);
        CROWD_U.uTime.value = state.t; M.leaf.userData.uTime.value = state.t; M.flag.userData.uTime.value = state.t;
        wheel.rotation.z = -state.t * 0.04;
        { const a = state.t * 0.018; blimp.position.set(Math.cos(a) * 150, 72 + Math.sin(state.t * 0.2) * 1.5, -40 + Math.sin(a) * 70); blimp.rotation.y = Math.atan2(-Math.cos(a) * 70, -Math.sin(a) * 150); }
        if (state.gate === 'open' && state.doorK < 1) { state.doorK = Math.min(1, state.doorK + dt * 12); gate.setDoors(state.doorK); } // 前扉は約 0.08 秒で開く（本物はばねで一気に開く。遅いと飛び出した馬の鼻先が扉を突き抜ける）
      },
      dispose() {
        scene.remove(root); if (lodBins.length) scene.onBeforeRender = prevSceneBR;
        root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        Object.values(M).forEach((m) => m.dispose()); crowdMats.forEach((m) => m.dispose()); Object.values(TX).forEach((t) => t.dispose());
      },
    };
    redrawBoard();
    return venue;
  }
  const CYL = new T.CylinderGeometry(1, 1, 1, 16, 1), CYL_XL = new T.CylinderGeometry(1, 1, 1, 6, 1); // CYL_XL: 軽い 3D のハロン棒・ゴール板（16 角 → 6 角）
  const DISC = new T.CircleGeometry(1, 28), DISC_XL = new T.CircleGeometry(1, 12);

  /* ---------- スタンド ---------- */
  function buildStand(G, low) {
    const z0 = ZS, x0 = SX0, x1 = SX1, xm = (x0 + x1) / 2, len = x1 - x0;
    const conc = C('#d6d1c6'), conc2 = C('#bfbab0'), white = C('#f0f0ec'), under = C('#868c93'), dark = C('#4d535a');
    const NZ = [0, 0, -1], PZ = [0, 0, 1], UP = [0, 1, 0], DN = [0, -1, 0];
    const strip = (g, ya, za, yb, zb, col, hint, uv, xa, xb) => g.quad([xa == null ? x0 : xa, ya, za], [xb == null ? x1 : xb, ya, za], [xb == null ? x1 : xb, yb, zb], [xa == null ? x0 : xa, yb, zb], col, uv, 0, hint);
    const uX = (k, va, vb) => [x0 / k, va, x1 / k, va, x1 / k, vb, x0 / k, vb];
    // 前の手すり壁と広告
    G.conc.box(xm, 0.8, z0 + 0.25, len, 1.6, 0.5, conc2);
    G.conc.box(xm, 1.63, z0 + 0.25, len, 0.06, 0.6, white);
    // 手すり壁の広告: 10m ごとに違う広告（コースから見て左が文字の頭＝ x の大きい側）
    { const rr = srand(13); for (let x = x0; x < x1 - 0.01; x += 10) { const xe = Math.min(x1, x + 10), [u0, v0, u1, v1] = adUV((rr() * ADS.length) | 0); strip(G.sign, 0.3, z0 - 0.01, 1.3, z0 - 0.01, C('#ffffff'), NZ, [u1, v0, u0, v0, u0, v1, u1, v1], x, xe); } }
    // 観客の段: 24m ごとに、模様（48m）の左半分・右半分・その左右反転のどれかを貼る（同じ並びの繰り返しに見えないように。通路は 24m の真ん中＝階段の手すりの所）
    const tiers = (ya, za, yb, zb, rows) => {
      const rr = srand((za * 7) | 0);
      for (let x = x0; x < x1 - 0.01; x += 24) {
        const xe = Math.min(x1, x + 24), k = (rr() * 4) | 0, f = (xe - x) / 48, ua = (k & 1 ? 0.5 : 0) + (k & 2 ? 0.5 : 0), ub = k & 2 ? ua - f : ua + f;
        strip(G.crowd, ya, za, yb, zb, C('#ffffff'), UP, [ua, 0, ub, 0, ub, rows, ua, rows], x, xe);
      }
    };
    // 下の段（観客の模様）
    tiers(1.4, z0 + 0.5, 8.6, z0 + 17, 18 / 8);
    // 下の段の奥: ガラスの食堂階、上の床（白い張り出し）
    strip(G.glass, 8.6, z0 + 17, 13.6, z0 + 17, C('#ffffff'), NZ, uX(6, 8.6 / 4, 13.6 / 4));
    G.conc.box(xm, 14.0, z0 + 15.2, len, 0.8, 4.6, white);
    G.conc.box(xm, 14.55, z0 + 13.0, len, 0.35, 0.12, C('#b9bec4'));
    // 上の段
    tiers(14.4, z0 + 17.5, 25.5, z0 + 33, 19 / 8);
    strip(G.glass, 25.5, z0 + 33, 32.6, z0 + 33, C('#ffffff'), NZ, uX(6, 25.5 / 4, 32.6 / 4));
    strip(G.conc, 32.6, z0 + 33, 35.2, z0 + 33, conc, NZ);
    // 大屋根（上は白、裏は灰色、前の縁に名前）
    const rx0 = x0 - 4, rx1 = x1 + 4, fz = z0 + 26, bz = z0 + 40, tf = 36.4, tb = 35.6, uf = 35.2, ub = 34.4;
    // 屋根の上: 白い膜の帯（8m ごとに少し色を変える）と、真ん中に競馬場の名前（上空から読める）
    for (let x = rx0, k = 0; x < rx1; x += 8, k++) { const xe = Math.min(rx1, x + 8); G.conc.quad([x, tf, fz], [xe, tf, fz], [xe, tb, bz], [x, tb, bz], C(k % 2 ? '#f6f6f3' : '#e4e8ec'), null, 0, UP); }
    const yAt = (z) => tf + (tb - tf) * (z - fz) / (bz - fz) + 0.06, lz0 = fz + 3, lz1 = fz + 11.5;
    G.sign.quad([-40, yAt(lz1), lz1], [96, yAt(lz1), lz1], [96, yAt(lz0), lz0], [-40, yAt(lz0), lz0], C('#ffffff'), [0, 0.875, 1, 0.875, 1, 1, 0, 1], 0, UP);
    G.conc.quad([rx0, uf, fz], [rx1, uf, fz], [rx1, ub, bz], [rx0, ub, bz], under, null, 0, DN);
    G.conc.quad([rx0, uf, fz], [rx1, uf, fz], [rx1, tf, fz], [rx0, tf, fz], white, null, 0, NZ);
    G.conc.quad([rx0, ub, bz], [rx1, ub, bz], [rx1, tb, bz], [rx0, tb, bz], conc2, null, 0, PZ);
    for (const [x, hx] of [[rx0, -1], [rx1, 1]]) G.conc.quad([x, uf, fz], [x, ub, bz], [x, tb, bz], [x, tf, fz], white, null, 0, [hx, 0, 0]);
    G.conc.box(xm, uf - 0.15, fz + 0.4, rx1 - rx0, 0.3, 0.8, C('#c9ccd0'));
    const sc = 40;
    G.sign.quad([sc + 27, uf + 0.25, fz - 0.02], [sc - 27, uf + 0.25, fz - 0.02], [sc - 27, tf - 0.2, fz - 0.02], [sc + 27, tf - 0.2, fz - 0.02], C('#ffffff'), [0, 0.875, 1, 0.875, 1, 1, 0, 1], 0, NZ);
    // 屋根の裏の梁
    const ang = Math.atan((uf - ub) / (bz - fz));
    for (let x = x0; x <= x1; x += 12) G.conc.add(BOX, mat(x, (uf + ub) / 2 - 0.55, (fz + bz) / 2, 0.36, 1.1, bz - fz, 0, ang), dark);
    // 柱
    for (let x = x0 + 18; x < x1; x += 44) { G.conc.box(x, 5, z0 + 17.8, 0.8, 10, 0.8, conc2); G.conc.box(x, 30.5, z0 + 27.5, 0.7, 9, 0.7, white); }
    // 上の段の手すり（前の縁）
    G.plastic.box(xm, 15.4, z0 + 17.6, len, 0.06, 0.06, C('#c8ccd0')); G.conc.box(xm, 14.85, z0 + 17.55, len, 0.9, 0.25, white);
    // 階段の手すり（下の段の通路ごと）
    for (let x = x0 + 12; x < x1; x += 24) G.plastic.add(BOX, mat(x, 5.3, z0 + 8.75, 0.05, 0.05, 18.0, 0, -Math.atan(7.2 / 16.5)), C('#c8ccd0'));
    // 後ろの壁（パドック側）とガラスの帯
    strip(G.conc, 0, z0 + 38, 34.4, z0 + 38, conc, PZ);
    for (const [ya, yb] of [[3.6, 7.6], [11, 15], [18.4, 22.4], [25.8, 29.8]]) strip(G.glass, ya, z0 + 38.05, yb, z0 + 38.05, C('#ffffff'), PZ, uX(6, ya / 4, yb / 4));
    for (let x = x0 + 30; x < x1; x += 60) G.conc.box(x, 2.0, z0 + 39.5, 8, 4, 3, conc2); // 入口のひさし
    // 両端の壁（横から見た形）
    const outline = [[0, 0], [0, 1.6], [0.5, 1.6], [17, 8.6], [17, 14.4], [17.5, 14.4], [33, 25.5], [33, 34.4], [38, 34.4], [38, 0]];
    for (const [x, hx] of [[x0, -1], [x1, 1]]) {
      const tris = T.ShapeUtils.triangulateShape(outline.map(([dz, y]) => new T.Vector2(dz, y)), []);
      for (const [a, b, c] of tris) G.conc.tri([x, outline[a][1], z0 + outline[a][0]], [x, outline[b][1], z0 + outline[b][0]], [x, outline[c][1], z0 + outline[c][0]], conc2, [hx, 0, 0]);
    }
  }

  /* ---------- 街並み（木立のさらに奥） ---------- */
  function buildCity(g, pave, trees, low) {
    // 2026-10-14（講評 92→95 の 3）: 壁は #A4B1AE〜#CAD0C7 の落ち着いた灰緑、屋根も彩度を落とす（遠くの街を背景として馴染ませる）
    const r = srand(91), walls = ['#c8cec5', '#bfc7c0', '#b4bfbb', '#cad0c7', '#aab6b2', '#c3c9bf', '#c6c9bd', '#b9c2bd', '#a8b4b1', '#cdd0c6'];
    const roofs = ['#959f9e', '#a3abaa', '#8a9696', '#aab0a8', '#8f9ea6', '#a0998f', '#97a092', '#b4b7ae'];
    const uvf = (x, y, z, nx, ny, nz) => (Math.abs(ny) > 0.5 ? [0.002, 0.998] : [(x * -nz + z * nx) / 25.6, y / 28]);
    const put = (x, z, w, d, h, ry) => {
      const wc = C(walls[(r() * walls.length) | 0]), rc = C(roofs[(r() * roofs.length) | 0]);
      g.add(BOX, mat(x, h / 2, z, w, h, d, ry), (X, Y, Z, nx, ny) => (ny > 0.5 ? rc : wc), { uvf });
      if (r() < 0.55) g.add(BOX, mat(x + (r() - 0.5) * w * 0.4, h + 1.1, z + (r() - 0.5) * d * 0.4, w * 0.3, 2.2, d * 0.3, ry), C('#a6aeac'), { uvf: () => [0.002, 0.998] });
    };
    // 碁盤の目の街区（道は地面のアスファルト色、街区は歩道＋建物、ときどき公園）
    const BW = 64, BD = 56, maxD = XLQ ? 200 : TVQ ? 300 : low ? 560 : 860;
    for (let gx = -BW * 13; gx < BW * 13; gx += BW) for (let gz = -BD * 13; gz < BD * 11; gz += BD) {
      const cx = gx + BW / 2, cz = gz + BD / 2, d = Math.hypot(Math.max(0, Math.abs(cx) - LS / 2), cz);
      if (d < RO + 118 || d > maxD) continue;
      if (cx > -300 && cx < 340 && cz > 80 && cz < 300) continue;       // スタンドとパドックの裏は別
      if (Math.hypot(cx - WHEEL.x, cz - WHEEL.z) < 50) { // 観覧車の広場
        pave.quad([cx - BW / 2 + 5, 0.03, cz - BD / 2 + 5], [cx + BW / 2 - 5, 0.03, cz - BD / 2 + 5], [cx + BW / 2 - 5, 0.03, cz + BD / 2 - 5], [cx - BW / 2 + 5, 0.03, cz + BD / 2 - 5], C('#d8cfbf'), null, 0, [0, 1, 0]);
        continue;
      }
      const w = BW - 11, dd = BD - 11;
      pave.quad([cx - w / 2, 0.03, cz - dd / 2], [cx + w / 2, 0.03, cz - dd / 2], [cx + w / 2, 0.03, cz + dd / 2], [cx - w / 2, 0.03, cz + dd / 2], C('#cbc7bd'), null, 0, [0, 1, 0]);
      if (r() < 0.12) { // 公園
        pave.quad([cx - w / 2 + 2, 0.045, cz - dd / 2 + 2], [cx + w / 2 - 2, 0.045, cz - dd / 2 + 2], [cx + w / 2 - 2, 0.045, cz + dd / 2 - 2], [cx - w / 2 + 2, 0.045, cz + dd / 2 - 2], C('#86b84a'), null, 0, [0, 1, 0]);
        for (let k = 0; k < (TVQ ? 1 : low ? 3 : 8); k++) trees.push({ x: cx + (r() - 0.5) * (w - 10), z: cz + (r() - 0.5) * (dd - 10), h: 7 + r() * 4, rad: 3.2 + r() * 1.5, tone: 0.9 + r() * 0.2, kind: 1 });
        continue;
      }
      const far = Math.min(1, (d - 180) / 500), tall = r() < 0.08 + far * 0.18;
      if (tall) { put(cx, cz, w * (0.5 + r() * 0.3), dd * (0.5 + r() * 0.3), 50 + r() * 70, 0); continue; }
      const nx = r() < 0.5 ? 2 : 3, nz = 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        if (r() < 0.12) continue;
        const lw = w / nx, ld = dd / nz, h = 6 + r() * (14 + far * 26);
        put(cx - w / 2 + lw * (i + 0.5), cz - dd / 2 + ld * (j + 0.5), lw * (0.62 + r() * 0.3), ld * (0.62 + r() * 0.3), h, 0);
      }
    }
    // スタンドの裏（パドックのまわり）の駐車場と低い建物
    for (const [x0, x1, z0, z1] of [[-290, -90, ZS + 50, 290], [100, 330, ZS + 50, 290]]) {
      pave.quad([x0, 0.03, z0], [x1, 0.03, z0], [x1, 0.03, z1], [x0, 0.03, z1], C('#9a9ca0'), null, 0, [0, 1, 0]);
      for (let x = x0 + 6; x < x1 - 6; x += 2.6) for (let z = z0 + 12; z < z1 - 8; z += 16) pave.quad([x, 0.04, z], [x + 0.15, 0.04, z], [x + 0.15, 0.04, z + 5], [x, 0.04, z + 5], C('#f2f2ee'), null, 0, [0, 1, 0]);
    }
    // 鉄塔（向正面の奥）
    for (const [x, z] of [[-140, -330], [260, -420]]) for (let k = 0; k < 4; k++) g.add(BOX, mat(x + (k % 2 ? 2.5 : -2.5), 22, z + (k < 2 ? 2.5 : -2.5), 0.5, 44, 0.5, 0, (k % 2 ? 0.05 : -0.05)), C('#c9ccd0'), { uvf: () => [0.002, 0.998] });
  }
  /* ---------- 遠くの丘 ---------- */
  function buildHills(g) {
    const r = srand(17), N = 150, p1 = r() * 6, p2 = r() * 6, p3 = r() * 6;
    const hAt = (th) => 22 + 30 * (0.5 + 0.5 * Math.sin(3 * th + p1)) * (0.6 + 0.4 * Math.sin(7 * th + p2)) + 9 * Math.sin(13 * th + p3) + 6 * Math.sin(29 * th);
    const R1 = 1200, R2 = 1420, R3 = 1700, base = C('#4f6a55'), top = C('#6c8670');
    for (let k = 0; k < N; k++) {
      const a = k / N * 6.2832, b = (k + 1) / N * 6.2832, ha = hAt(a), hb = hAt(b);
      const P = (th, R, y) => [Math.cos(th) * R, y, Math.sin(th) * R];
      g.quad(P(a, R1, 0), P(b, R1, 0), P(b, R2, hb), P(a, R2, ha), (x, y) => base.clone().lerp(top, Math.min(1, y / 60)), null, 0, [-Math.cos(a), 0.5, -Math.sin(a)]);
      g.quad(P(a, R2, ha), P(b, R2, hb), P(b, R3, hb * 0.5), P(a, R3, ha * 0.5), top, null, 0, [0, 1, 0]);
    }
  }

  /* ---------- 発走ゲート（局所座標: +X が進む向き、+Z がコースの外） ---------- */
  function buildGate(M) {
    const group = new T.Group(), g = new Geo(), n = 6, half = 0.975, r0 = CO.laneR(0), r1 = CO.laneR(n - 1), rMid = (r0 + r1) / 2;
    const X0 = -1.6, X1 = 0.9, XM = (X0 + X1) / 2, LEN = X1 - X0;
    // 骨組みは銀色の鉄骨に落ち着いた青緑の差し色、前扉は枠色（ref/minnade/STYLE.md 3-3）
    // 2026-10-14（講評 v2-1 の 2「ゲートの水色が強すぎて馬が埋もれる」）: 水色 #5aaee8 → くすんだ青緑 #6093a3、仕切りのクッションは白に近い水色 → 中くらいの灰緑
    // （白・芦毛の馬も黒い馬も仕切りから浮く）。鉄骨は金属（粗さ 0.38・金属 0.45）、塗装とクッションはつや消し（材質 M.gate の tint）
    const blue = C('#6093a3'), silver = C('#e3e8ec'), pad = C('#a9b8b9'), steel = C('#a3afb6'), black = C('#1d1f22');
    const MT = { tint: 1 }, PT = { tint: 0.35 };   // 金属らしさ（鉄骨・塗装した鉄）
    const box = (x, y, z, sx, sy, sz, col) => g.box(x, y, z, sx, sy, sz, col, 0, col === silver || col === steel ? MT : col === blue ? PT : null);
    const zb = []; for (let k = 0; k <= n; k++) zb.push((k === 0 ? r0 - half : k === n ? r1 + half : (CO.laneR(k - 1) + CO.laneR(k)) / 2) - rMid);
    const zl = []; for (let k = 0; k < n; k++) zl.push(CO.laneR(k) - rMid);
    const zMin = zb[0] - 0.2, zMax = zb[n] + 0.2, W = zMax - zMin;   // 両端の枠・車輪はラチの内側に収める（内ラチは RI ±0.075）
    // 仕切りごとの柱・クッション・上の桁（銀色の鉄骨に青い差し色）
    for (let k = 0; k <= n; k++) {
      const z = zb[k], end = k === 0 || k === n;
      for (const x of [X0 - 0.05, X1 + 0.05]) box(x, 1.65, z, 0.13, 3.3, 0.13, silver);
      box(XM, 1.15, z, LEN, end ? 2.2 : 1.55, end ? 0.14 : 0.1, end ? blue : pad);
      box(XM, 3.3, z, LEN + 0.3, 0.15, 0.15, silver);
      box(XM, 2.05, z, LEN, 0.1, 0.12, blue);
      box(XM, 0.22, z, LEN, 0.08, 0.12, steel);
      // 斜めの筋交い（上から見ると X の模様）
      if (k < n) { const zc = (zb[k] + zb[k + 1]) / 2, dz = zb[k + 1] - zb[k], ang = Math.atan2(dz, LEN), len = Math.hypot(LEN, dz);
        g.add(BOX, mat(XM, 3.32, zc, len, 0.06, 0.08, ang), silver, MT); g.add(BOX, mat(XM, 3.32, zc, len, 0.06, 0.08, -ang), silver, MT); }
    }
    // 前と後ろの桁、前の青い横幕
    box(X1 + 0.12, 2.82, 0, 0.1, 0.62, W, blue);
    box(X1 + 0.1, 3.3, 0, 0.2, 0.2, W, silver);
    box(X0 - 0.1, 3.3, 0, 0.2, 0.2, W, silver);
    box(X0 - 0.1, 2.6, 0, 0.12, 0.3, W, blue);
    // 後ろの扉は下で別に作る（ゲートインのときに開け閉めする）
    // 両端の枠と車輪
    for (const z of [zMin - 0.15, zMax + 0.15]) {
      for (const x of [X0 - 0.2, X1 + 0.2]) box(x, 1.7, z, 0.16, 3.4, 0.16, silver);
      box(XM, 3.35, z, LEN + 0.6, 0.16, 0.16, silver); box(XM, 1.0, z, LEN + 0.6, 0.12, 0.12, blue);
      for (const x of [X0 + 0.2, X1 - 0.2]) g.add(CYL, mat(x, 0.5, z, 0.5, 0.3, 0.5, 0, Math.PI / 2), black);
    }
    const frame = new T.Mesh(g.build(), M.gate); frame.castShadow = true; frame.receiveShadow = true; group.add(frame);
    // 馬番の板: 前の横幕（縦）と、上の大きな四角（上から見える。みんなでダービーのゲート）
    const pg = new Geo();
    zl.forEach((z, k) => {
      pg.add(PLANE, mat(X1 + 0.18, 2.82, z, 0.5, 0.5, 1, Math.PI / 2), C('#ffffff'), { uvT: cellUV(8 + k) });
      pg.add(PLANE, mat(X1 - 0.55, 3.43, z, 1.3, 1.3, 1, -Math.PI / 2, -Math.PI / 2), C('#ffffff'), { uvT: cellUV(8 + k) });
    });
    const plates = new T.Mesh(pg.build(), M.plate); plates.castShadow = true; group.add(plates);
    // 前扉（左右 2 枚ずつ。蝶番を軸に前へ開く）
    const dg = new Geo();
    dg.box(0.0, 1.1, 0.43, 0.05, 1.4, 0.84, C('#ffffff'));
    dg.box(0.0, 1.78, 0.43, 0.07, 0.08, 0.86, silver); dg.box(0.0, 0.42, 0.43, 0.07, 0.08, 0.86, silver); dg.box(0.0, 1.1, 0.84, 0.07, 1.4, 0.06, silver); dg.box(0.0, 1.1, 0.43, 0.065, 0.06, 0.84, C('#e8eef4'));
    const doors = new T.InstancedMesh(dg.build(), M.door, n * 2); doors.frustumCulled = false;
    for (let k = 0; k < n; k++) { const fc = C(FRAME[k]).clone(); if (k === 1) fc.setScalar(0.06); doors.setColorAt(k * 2, fc); doors.setColorAt(k * 2 + 1, fc); } doors.castShadow = true; doors.receiveShadow = true; group.add(doors);
    // 前扉の大きな馬番（左の扉に貼る。扉といっしょに開く）。馬番ごとに図柄のますをずらす（cellOff）
    const ng = new T.PlaneGeometry(0.66, 0.66), nu = ng.attributes.uv;
    for (let k = 0; k < nu.count; k++) nu.setXY(k, nu.getX(k) / 8, nu.getY(k) / 4);
    ng.rotateY(Math.PI / 2); ng.translate(0.035, 1.15, 0.45);
    const off = new Float32Array(n * 2); for (let k = 0; k < n; k++) { const c = cellUV(8 + k); off[k * 2] = c[0]; off[k * 2 + 1] = c[1]; }
    ng.setAttribute('cellOff', new T.InstancedBufferAttribute(off, 2));
    const nm = M.doorNum || (M.doorNum = (function () {
      const m = new T.MeshLambertMaterial({ map: M.plate.map });
      m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 cellOff;').replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_UV\n vUv += cellOff;\n#endif'); };
      m.customProgramCacheKey = () => 'venueDoorNum';
      return m;
    })());
    const nums = new T.InstancedMesh(ng, nm, n); nums.frustumCulled = false; group.add(nums);
    function setDoors(k) {
      const a = (1 - Math.pow(1 - k, 3)) * 1.75;
      zl.forEach((z, i) => {
        const ml = mat(X1 + 0.06, 0, z - half + 0.06, 1, 1, 1, a);
        doors.setMatrixAt(i * 2, ml); nums.setMatrixAt(i, ml);
        doors.setMatrixAt(i * 2 + 1, mat(X1 + 0.06, 0, z + half - 0.06, 1, 1, 1, Math.PI - a));
      });
      doors.instanceMatrix.needsUpdate = true; nums.instanceMatrix.needsUpdate = true;
    }
    setDoors(0);
    // 後ろの扉（左右 2 枚ずつ。蝶番を軸に後ろへ開く）: ゲートインで開けておき、馬が入ったら係員が閉める
    const rg = new Geo();
    rg.box(0.0, 1.1, 0.44, 0.05, 1.4, 0.86, steel, 0, PT);
    rg.box(0.0, 1.78, 0.44, 0.07, 0.08, 0.88, silver, 0, MT); rg.box(0.0, 0.42, 0.44, 0.07, 0.08, 0.88, silver, 0, MT); rg.box(0.0, 1.1, 0.86, 0.07, 1.4, 0.06, silver, 0, MT); rg.box(0.0, 1.1, 0.44, 0.065, 0.06, 0.86, pad);
    const rear = new T.InstancedMesh(rg.build(), M.gate, n * 2); rear.frustumCulled = false; rear.castShadow = true; rear.receiveShadow = true; group.add(rear);
    const rearK = new Float32Array(n);
    // list[k] = 枠 k の後ろの扉の開き具合（0＝閉 … 1＝開。約 90 度）。null で全部閉める
    function setRear(list) {
      let changed = false;
      for (let i = 0; i < n; i++) { const v = list ? Math.max(0, Math.min(1, +list[i] || 0)) : 0; if (Math.abs(v - rearK[i]) > 1e-4 || !setRear.done) { rearK[i] = v; changed = true; } }
      if (!changed) return;
      setRear.done = true;
      zl.forEach((z, i) => {
        const k = rearK[i], a = k * k * (3 - 2 * k) * 1.6;
        rear.setMatrixAt(i * 2, mat(X0 - 0.06, 0, z - half + 0.06, 1, 1, 1, -a));
        rear.setMatrixAt(i * 2 + 1, mat(X0 - 0.06, 0, z + half - 0.06, 1, 1, 1, Math.PI + a));
      });
      rear.instanceMatrix.needsUpdate = true;
    }
    setRear(null);
    return { group, rMid, setDoors, setRear };
  }
  const PLANE = new T.PlaneGeometry(1, 1);

  /* ---------- パドック（R3D.Course.PADDOCK の楕円の周回路） ---------- */
  function buildPaddock(G, posts, people, trees, low) {
    const P = CO.PADDOCK, cx = P.cx, cz = P.cz, A = P.a, B = P.b, Wd = P.w, N = 96;
    const E = (off, th) => [cx + (A + off) * Math.cos(th), cz + (B + off) * Math.sin(th)];
    const ring = (g, o0, o1, y, col) => { for (let k = 0; k < N; k++) { const a = k / N * 6.2832, b = (k + 1) / N * 6.2832, p0 = E(o0, a), p1 = E(o0, b), q1 = E(o1, b), q0 = E(o1, a); g.quad([p0[0], y, p0[1]], [p1[0], y, p1[1]], [q1[0], y, q1[1]], [q0[0], y, q0[1]], col, null, 0, [0, 1, 0]); } };
    const riser = (g, o, y0, y1, col) => { for (let k = 0; k < N; k++) { const a = k / N * 6.2832, b = (k + 1) / N * 6.2832, p0 = E(o, a), p1 = E(o, b); g.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], col, null, 0, [cx - p0[0], 0, cz - p0[1]]); } };
    // 内側の芝（縞）
    const ra = A - Wd / 2, rb = B - Wd / 2;
    for (let z = -rb; z < rb - 1e-6; z += 1.5) {
      const z1 = Math.min(rb, z + 1.5), w0 = ra * Math.sqrt(Math.max(0, 1 - (z / rb) ** 2)), w1 = ra * Math.sqrt(Math.max(0, 1 - (z1 / rb) ** 2));
      G.pave.quad([cx - w0, 0.03, cz + z], [cx + w0, 0.03, cz + z], [cx + w1, 0.03, cz + z1], [cx - w1, 0.03, cz + z1], C(Math.round(z / 1.5) % 2 ? '#7fb446' : '#8ec450'), null, 0, [0, 1, 0]);
    }
    // 周回路（土）と縁
    ring(G.pave, -Wd / 2, Wd / 2, 0.035, C('#b99c70'));
    ring(G.pave, -Wd / 2 - 0.25, -Wd / 2, 0.04, C('#e9e5da'));
    ring(G.pave, Wd / 2, Wd + 1.7, 0.03, C('#bdb6a8'));
    // 真ん中の花壇
    G.hedge.add(CYL, mat(cx, 0.25, cz, A * 0.3, 0.5, B * 0.22), C(HEDGE), { uvf: (x, y, z) => [x / 2, z / 2 + y] });
    { const fg = new T.CircleGeometry(1, 32); fg.rotateX(-Math.PI / 2); G.flower.add(fg, mat(cx, 0.51, cz, A * 0.3, 1, B * 0.22), C('#ff9aa2'), { uvf: flUV }); }
    // 白い柵（観客と馬の間）: 楕円を θ の逆向きにたどる（表を外へ）
    const fo = Wd + 1.0, fp = [];
    for (let k = N; k >= 0; k--) { const th = k / N * 6.2832, [x, z] = E(fo, th), nx = Math.cos(th) / (A + fo), nz = Math.sin(th) / (B + fo), nl = Math.hypot(nx, nz); fp.push({ x, z, ox: nx / nl, oz: nz / nl, s: k }); }
    sweep(G.plastic, fp, RAIL_PROF.map(([o, y]) => [o, y + 0.02]), C('#f7f7f5'));
    for (let k = 0; k < N; k += 2) { const th = k / N * 6.2832, [x, z] = E(fo, th); posts.push({ x0: x, z0: z, x1: x, z1: z, y1: 0.98 }); }
    // 観客の段（4 段）と、そこに立つ人
    const S0 = Wd + 1.7, SD = 1.25, SH = 0.42, conc = C('#c7c1b5'), conc2 = C('#a39d92'), r = srand(77);
    for (let k = 0; k < 4; k++) {
      const o0 = S0 + SD * k, o1 = o0 + SD, y = (k + 1) * SH;
      ring(G.conc, o0, o1, y, k % 2 ? conc : C('#bfb9ad'));
      riser(G.conc, o0, y - SH, y, conc2);
      const off = o0 + SD * 0.55, per = 2 * Math.PI * Math.sqrt(((A + off) ** 2 + (B + off) ** 2) / 2), n = Math.floor(per / 0.72);
      for (let j = 0; j < n; j++) {
        const th0 = j / n * 6.2832, dens = 0.62 + 0.3 * Math.sin(th0 * 3 + k * 1.3) + 0.15 * Math.sin(th0 * 7 + 2);   // 人だまりとすき間のむら
        if (r() > dens * (low ? 0.5 : 1)) continue;
        const th = (j + r() * 0.4) / n * 6.2832, [x, z] = E(off + (r() - 0.5) * 0.3, th);
        const p = rollPerson(r, { kids: 0.1, rail: k === 0 }); p.x = x; p.y = y; p.z = z; p.ry = Math.atan2(cx - x, cz - z) + (r() - 0.5) * 0.6;
        people.push(p);
      }
    }
    riser(G.conc, S0 + SD * 4, 0, 4 * SH, conc2);
    // まわりの建物（四方の壁。内側の面は低い壁＋ガラス＋白いひさし）
    const X = A + 27, Z = B + 23, Hh = 10, D = 8;
    const sides = [[-X - D, -Z - D, X + D, -Z, 1], [-X - D, Z, X + D, Z + D, -1], [-X - D, -Z, -X, Z, 2], [X, -Z, X + D, Z, -2]];
    for (const [xa, za, xb, zb, f] of sides) {
      G.conc.box(cx + (xa + xb) / 2, Hh / 2, cz + (za + zb) / 2, xb - xa, Hh, zb - za, C('#d8d3c9'));
      // 内側の面: ガラスの帯とひさし
      const inZ = f === 1 ? -Z + 0.02 : f === -1 ? Z - 0.02 : null, inX = f === 2 ? -X + 0.02 : f === -2 ? X - 0.02 : null;
      if (inZ != null) {
        const hint = [0, 0, f === 1 ? 1 : -1], z = cz + inZ;
        G.glass.quad([cx + xa + D, 3.6, z], [cx + xb - D, 3.6, z], [cx + xb - D, 9.0, z], [cx + xa + D, 9.0, z], C('#ffffff'), [xa / 6, 0.9, xb / 6, 0.9, xb / 6, 2.25, xa / 6, 2.25], 0, hint);
        G.conc.box(cx, 9.4, z + (f === 1 ? 0.8 : -0.8), xb - xa, 0.35, 1.6, C('#f2f2ef'));
      } else {
        const hint = [f === 2 ? 1 : -1, 0, 0], x = cx + inX;
        G.glass.quad([x, 3.6, cz + za], [x, 3.6, cz + zb], [x, 9.0, cz + zb], [x, 9.0, cz + za], C('#ffffff'), [za / 6, 0.9, zb / 6, 0.9, zb / 6, 2.25, za / 6, 2.25], 0, hint);
        G.conc.box(x + (f === 2 ? 0.8 : -0.8), 9.4, cz, 1.6, 0.35, zb - za, C('#f2f2ef'));
      }
    }
    // 建物と段の間の床
    G.pave.quad([cx - X, 0.02, cz - Z], [cx + X, 0.02, cz - Z], [cx + X, 0.02, cz + Z], [cx - X, 0.02, cz + Z], C('#c9c3b6'), null, 0, [0, 1, 0]);
    // 建物の外の木
    const TX = X + D + 7, TZ = Z + D + 7;
    for (let x = -TX; x <= TX; x += 4.4) { trees.push({ x: cx + x + (r() - 0.5) * 2, z: cz - TZ + (r() - 0.5) * 2, h: 14 + r() * 8, rad: 2.8 + r() * 1.8, tone: 0.9 + r() * 0.2 }); trees.push({ x: cx + x + (r() - 0.5) * 2, z: cz + TZ + (r() - 0.5) * 2, h: 15 + r() * 8, rad: 2.8 + r() * 1.8, tone: 0.9 + r() * 0.2 }); }
    for (let z = -TZ + 4; z < TZ; z += 4.4) { trees.push({ x: cx - TX + (r() - 0.5) * 2, z: cz + z, h: 14 + r() * 8, rad: 2.8 + r() * 1.8, tone: 0.9 + r() * 0.2 }); trees.push({ x: cx + TX + (r() - 0.5) * 2, z: cz + z, h: 14 + r() * 8, rad: 2.8 + r() * 1.8, tone: 0.9 + r() * 0.2 }); }
  }

  return { build };
})();
