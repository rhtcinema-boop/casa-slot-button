/* casa DERBY 3D: 馬「リアル寄り」版（B 案、three.js r149、すべてコードで作る）。R3D.HorseReal。
   使い方は js/r3d/horse3d.js の R3D.Horse（かわいい版・A 案）とまったく同じ（create(h, opts) と返す馬の中身・disposeShared・faceOf ほか）。
   統合側は R3D.Horse と R3D.HorseReal のどちらかを選ぶだけで切り替えられる。作業台: tools/horse-lab/B/（lab-B.html・index-B.html）。
   見た目の方針（2026-10-14 オーナー「馬は身体的特徴ない感じで普通の馬に寄せて」）:
   - 全馬が同じ 1 つの体型（脚質 h.type で形を変えない。horse.type は確認用にそのまま返す）。本物のサラブレッドの割合:
     き甲 約 1.60m、胴（尻端〜胸前）約 1.7m、胸が深く（き甲〜胸底 約 0.7m）腹は後ろへ巻き上がる、尻と太ももの筋肉が大きい、
     首は長く付け根が太くのど元が細い、頭は小さめ（0.64m＝き甲の約 40%）で下向き 52 度、脚は細く（管の太さ 約 7cm）ひざ・飛節・球節がはっきり、蹄は小さい。
   - 目は自然な大きさ（直径 約 6cm のアーモンド形・濃い茶色・小さな光の点 1 つ・上まぶた）。耳は小さく立つ。鼻先は濃い皮膚の色。
   - 毛は短く寝た毛のつや（粗さ 0.5、縁の明るさは控えめ）。たてがみは競走馬らしく短く整えて首の右側に寝る細い毛の束、前髪は額に垂れる束、
     尾は毛色の尾根＋毛の芯＋広がる毛の束（ふだんは垂れ、速いほど後ろへ流れる）。
   - 1 頭ごとの違いは毛色・白斑（流星・星・鼻の白・白い靴下）・たてがみの色（本物にある色だけ）・勝負服・ゼッケンだけ。
   - 騎手は人の頭の大きさ（ちびキャラの 0.72 倍）。
   作り方・動き（IK・着地中に地面に固定される蹄・4 拍の襲歩）・重さの工夫は R3D.Horse と同じ。1 頭の三角形は今の馬（ノマール）以下。
   出馬表の顔の絵: 統合側は getObjectByName('head') の位置から撮るので、顔が中央に来る所に 'head' という目印を置いている（頭の骨の名前は 'headBone'）。
   座標: 原点＝胴の真下の地面、前（鼻先）が +X、上が +Y、馬の右が +Z。state.lean > 0 で左（−Z、内ラチ側）へ傾く。 */
window.R3D = window.R3D || {};
R3D.HorseReal = (function () {
  'use strict';
  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const frac = (x) => x - Math.floor(x);
  const dirA = (a) => [Math.sin(a), -Math.cos(a)];          // 角度 a（真下から前へ正）の向き
  const angOf = (dx, dy) => Math.atan2(dx, -dy);

  // ---------------- 色 ----------------
  function hexRGB(h) { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mulC = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const toLin = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  // 毛色（アニメ調で少し鮮やかに）: body 地色, top 背, belly 腹, mane たてがみ・尾, muzzle 鼻先, points 脚先（null＝地色）, hoof 蹄, ear 耳の内側
  // 2026-10-14 リアル寄り（B 案）: 本物のサラブレッドの毛色に寄せる。ただし画面で沈まないよう明るめ・少し鮮やかに。
  // 鹿毛・青鹿毛は脚先（ひざ・飛節から下）とたてがみ・尾が黒。鼻先は毛の薄い濃い皮膚の色（白斑の鼻先だけ桃色）。耳の内側は暗い
  const COATS = {
    bay: { body: '#7e3c1a', top: '#6c3215', belly: '#94552f', mane: '#17110f', muzzle: '#3c2b24', points: '#1d1714', hoof: '#2a2420', ear: '#2a1d18', blaze: false },
    chestnut: { body: '#b5541b', top: '#a1491a', belly: '#c8743d', mane: '#a2471a', muzzle: '#6e4a3a', points: null, hoof: '#4a3a30', ear: '#5a3020', blaze: true },
    black: { body: '#3a2722', top: '#2c1d19', belly: '#57392c', mane: '#120d0c', muzzle: '#2a2020', points: '#16110f', hoof: '#1e1a18', ear: '#1e1614', blaze: false },
    gray: { body: '#aca8a5', top: '#9d9996', belly: '#c6c2bf', mane: '#68625f', muzzle: '#3e3836', points: '#6f6a67', hoof: '#3a3432', ear: '#4a4442', blaze: false, dapple: '#d9d6d3' }, // 連銭（明るい丸い斑）で白毛と見分ける
    white: { body: '#f1ede7', top: '#e8e2da', belly: '#f7f4f0', mane: '#f3eee6', muzzle: '#d9b2aa', points: null, hoof: '#cdbb9f', ear: '#c9b4ad', blaze: false },
    palomino: { body: '#d6a447', top: '#c7943a', belly: '#e6bd6c', mane: '#f2e6c4', muzzle: '#7a5a48', points: null, hoof: '#6b5236', ear: '#8a6a40', blaze: true },
  };
  const WHITE_MARK = hexRGB('#fbf8f2');
  // 白斑（馬番で決める）: 流星（顔の白い筋）と白い靴下（LF,RF,LH,RH）
  const MARKS = [{ sock: [] }, { blaze: 1, sock: [2, 3] }, { sock: [0, 1, 2, 3] }, { blaze: 1, sock: [3] }];

  // ---------------- 体型（STYLE.md 1-1・1-2。ノマールがき甲 1.62m の基準） ----------------
  // belly 腹の下の高さ, L 胴の長さ, R 胴の半分の高さ, W 胴の半幅, nL 首の長さ, nR 首の太さ(半径), nA 首の角度(度), hL 頭の長さ, hR 頭の半分の高さ, hW 頭の幅/高さ, mR 鼻先の太さ,
  // hA 頭の向き(度, 下向きが負), lR 脚の太さ(半径), sf 全速の完歩数/秒, bob 上下の大きさ, sq 胴のつぶれ（ヨコヅナ）, rb/xb 胸の曲がり
  const TYPES = {
    // B 案（リアル寄り）: 全馬この 1 つの体型。き甲 約 1.60m・胴の長さ（尻端〜胸前）約 1.65m・頭 0.58m（き甲の 36%）・
    // 胸が深く（き甲〜胸底 0.68m）腹は後ろへ巻き上がる・脚は細く（管の太さ 約 7cm）関節がはっきり・蹄は小さい
    real: { belly: 0.88, L: 1.72, R: 0.37, W: 0.26, nL: 0.6, nR: 0.17, nA: 46, hL: 0.64, hR: 0.16, hW: 0.78, mR: 0.085, hA: -52, lR: 0.05, ear: 0.13, tail: 0.85, sf: 2.4, bob: 1.0, sq: 0.03, real: 1 },
    nige: { belly: 0.48, L: 1.0, R: 0.29, W: 0.265, nL: 0.1, nR: 0.2, nA: 66, hL: 0.86, hR: 0.265, hW: 0.86, mR: 0.215, hA: -16, lR: 0.072, ear: 0.18, tail: 0.45, sf: 3.0, bob: 0.8, sq: 0.25 },
    senko: { belly: 0.81, L: 1.25, R: 0.31, W: 0.275, nL: 0.45, nR: 0.19, nA: 50, hL: 0.8, hR: 0.24, hW: 0.83, mR: 0.2, hA: -28, lR: 0.068, ear: 0.18, tail: 0.55, sf: 2.5, bob: 1.0, sq: 0.15 },
    sashi: { belly: 1.16, L: 1.2, R: 0.28, W: 0.235, nL: 0.72, nR: 0.165, nA: 65, hL: 0.72, hR: 0.215, hW: 0.83, mR: 0.18, hA: -32, lR: 0.056, ear: 0.17, tail: 0.55, sf: 2.1, bob: 1.1, sq: 0.1 },
    oikomi: { belly: 0.55, L: 1.5, R: 0.625, W: 0.625, nL: 0.22, nR: 0.21, nA: 72, hL: 0.68, hR: 0.205, hW: 0.85, mR: 0.17, hA: -22, lR: 0.05, ear: 0.16, tail: 0.38, rb: 0.62, xb: 0.5, sf: 2.4, bob: 1.5, sq: 1.0 },
  };
  // 頭を大きく丸く（ChatGPT の評価 5: 頭 +15〜20%）。長さは少しだけ、太さを大きく → 鼻先が相対的に短く丸く見える
  const HEADK = { real: [1, 1, 1], nige: [0.86, 1.14, 0.97], senko: [0.88, 1.2, 1.0], sashi: [0.89, 1.2, 1.0], oikomi: [0.88, 1.18, 0.98] }; // [長さ, 頭の太さ, 鼻先の太さ]
  // 1 頭ごとの顔だち（目・前髪・たてがみの形）。名前（無ければ馬番）から決める＝同じ馬はいつも同じ顔（出馬表の絵も 3D から撮るので一致する）。
  // h.look に { eye, forelock, maneStyle } があればそれを優先
  const EYES = ['round', 'tall', 'droopy', 'sharp', 'sparkle'], FORES = ['twin', 'swoop', 'spiky', 'bangs', 'ahoge'], MANES = ['spiky', 'mohawk', 'flow', 'brush'];
  function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995); x ^= x >>> 15; return x >>> 0; }
  function faceOf(h) {
    const L = h.look || {}, k = hashStr(String(h.name || ('no' + (h.no || 1))));
    const pick = (v, list, n) => (list.indexOf(v) >= 0 ? v : list[n % list.length]);
    const coat = COATS[h.coat] ? h.coat : 'bay', mc = MANE_TINT[coat], plain = coat === 'white' || coat === 'gray', ci = Object.keys(COATS).indexOf(coat);
    // 出走馬の一覧（engine の POOL）で同じ毛色の馬の中の順番 j が分かれば、それで決める＝同じ毛色どうしは必ず顔だちが違う（2 頭の芦毛など）。
    // 一覧に無い馬は名前のハッシュで決める
    let j = -1;
    try { const pool = (typeof Engine !== 'undefined' && Engine.POOL) || null; if (pool && h.name) j = pool.filter((x) => x.coat === h.coat).map((x) => x.name).sort().indexOf(h.name); } catch (e) { j = -1; }
    const eye = j >= 0 ? EYES[(j * 3 + ci) % EYES.length] : EYES[k % 997 % EYES.length];
    const fore = j >= 0 ? FORES[(j * 2 + ci) % FORES.length] : FORES[(k >>> 9) % 991 % FORES.length];
    const mane = j >= 0 ? MANES[(j + ci) % MANES.length] : MANES[(k >>> 18) % 983 % MANES.length];
    const face = plain ? 'none' : j >= 0 ? GROUP_FACE[j % GROUP_FACE.length] : FACEM[(k >>> 4) % 997 % FACEM.length];
    const maneCol = j >= 0 ? mc[j % mc.length] : mc[(k >>> 13) % 977 % mc.length];
    return { eye: pick(L.eye, EYES, EYES.indexOf(eye)), fore: pick(L.forelock, FORES, FORES.indexOf(fore)), mane: pick(L.maneStyle, MANES, MANES.indexOf(mane)), face: FACEM.indexOf(L.face) >= 0 ? L.face : face, maneCol: L.maneColor || maneCol, seed: k };
  }
  const GROUP_FACE = ['wide', 'star', 'none', 'snip', 'blaze'];
  // 顔の白斑の種類と、たてがみの色の候補（芦毛・白毛は白斑が見えないので、たてがみの色で見分ける）
  const FACEM = ['blaze', 'star', 'wide', 'snip', 'starsnip', 'none'];
  const MANE_TINT = { bay: ['#17110f'], chestnut: ['#a2471a', '#e3c48e', '#8a3a12'], black: ['#120d0c'], gray: ['#8d8784', '#6e6866', '#aaa4a0', '#5a5452'], white: ['#f3eee6', '#e6ddd0'], palomino: ['#f2e6c4', '#fff4dc', '#e2cc96'] }; // B 案: 本物にある色だけ（栗毛の尾花＝亜麻色など）
  const specCache = {};
  function makeSpec(type) {
    if (specCache[type]) return specCache[type];
    const D0 = TYPES[type] || TYPES.senko, HK = HEADK[type] || HEADK.senko;
    const D = Object.assign({}, D0, { hL: D0.hL * HK[0], hR: D0.hR * HK[1], mR: D0.mR * HK[2], ear: D0.ear * 1.1 });
    const S = { type, D, bones: [], BI: {} };
    const bone = (name, x, y, z, q0) => { S.BI[name] = S.bones.length; S.bones.push({ name, r: [x, y, z || 0], q0 }); };
    const yb = D.belly + D.R, xr = -D.L / 2, xc = D.L / 2;
    S.yb = yb; S.xr = xr; S.xc = xc;
    // 胴〜首の中心線: 胴（水平）→ 曲がり（半径 Rb の円弧）→ 首（まっすぐ）
    const xs = Math.max(xc - D.R * (D.xb || 0.95), xr + Math.min(D.R * 0.95, D.L * 0.42) + 0.08), Rb = D.R * (D.rb || 1.3), A = D.nA * DEG;
    S.bend = { xs, Rb, A, cx: xs, cy: yb + Rb };
    const nb = [xs + Rb * Math.sin(A), yb + Rb - Rb * Math.cos(A)];           // 首の付け根（曲がりの終わり）の中心
    const nd = [Math.cos(A), Math.sin(A)];
    const ne = [nb[0] + nd[0] * D.nL, nb[1] + nd[1] * D.nL];                    // 首の先＝うなじ（頭の骨の位置）
    S.nb = nb; S.nd = nd; S.ne = ne;
    bone('body', 0, yb); bone('hind', xr + D.L * 0.42, yb + D.R * 0.3);
    bone('neck1', xs + Rb * Math.sin(A * 0.35), yb + Rb - Rb * Math.cos(A * 0.35));
    bone('neck2', nb[0] + nd[0] * D.nL * 0.25, nb[1] + nd[1] * D.nL * 0.25);
    bone('neck3', nb[0] + nd[0] * D.nL * 0.7, nb[1] + nd[1] * D.nL * 0.7);
    bone('head', ne[0], ne[1]);
    // 頭の軸: 後頭部 B0 から鼻先へ
    const ha = D.hA * DEG, HD = [Math.cos(ha), Math.sin(ha), 0], HU = [-Math.sin(ha), Math.cos(ha), 0];
    const B0 = [ne[0] - HD[0] * D.hL * 0.2 + HU[0] * D.hR * 0.45, ne[1] - HD[1] * D.hL * 0.2 + HU[1] * D.hR * 0.45, 0];
    S.head = { HD, HU, B0 };
    // 尾
    const tb = [xr + D.R * 0.28, yb + D.R * 0.62], tl = D.tail;
    const T = [tb]; const tdirs = D.real ? [172, 226, 248, 257, 262] : [158, 200, 215, 205, 185]; // B 案: 尾根から下へ垂れる
    for (let i = 0; i < 5; i++) { const a = tdirs[i] * DEG, p = T[i]; T.push([p[0] + Math.cos(a) * tl / 5, p[1] + Math.sin(a) * tl / 5]); }
    S.TAIL = T; for (let i = 0; i < 5; i++) bone('tail' + i, T[i][0], T[i][1]);
    // 脚の関節（休みの姿勢、横から見た 2D）
    const b = D.belly, hoofH = Math.max(0.06, D.lR * 1.0), xf = xc - D.L * 0.25, xh = xr + D.L * 0.25, k = clamp(b / 0.78, 0.6, 1.4);
    const fy = D.real ? 0.2 * b : Math.max(0.16 * b, hoofH + 0.05); // B 案: 球節は本物の高さ（地面から 約 18cm）
    S.FJ = { S: [xf + 0.1 * k, b + D.R * 0.75], E: [xf - 0.01, b + 0.03], K: [xf + 0.005, 0.5 * b + 0.02], F: [xf + 0.012, fy], C: [xf + 0.04, hoofH] };
    if (D.real) { const xR = xr; S.HJ = { H: [xR + D.L * 0.25, b + D.R * 1.05], St: [xR + D.L * 0.33, b + 0.07], Ho: [xR + D.L * 0.085, 0.62 * b], F: [xR + D.L * 0.115, fy], C: [xR + D.L * 0.13, hoofH] }; } else
    S.HJ = { H: [xh - 0.03, b + D.R * 1.0], St: [xh + 0.13 * k, b + 0.02], Ho: [xh - 0.12 * k, 0.56 * b + 0.03], F: [xh - 0.1 * k, fy], C: [xh - 0.07 * k, hoofH] };
    S.hoofH = hoofH;
    S.LEGS = [{ name: 'LF', fore: true, z: -D.W * 0.5 }, { name: 'RF', fore: true, z: D.W * 0.5 }, { name: 'LH', fore: false, z: -D.W * 0.55 }, { name: 'RH', fore: false, z: D.W * 0.55 }];
    const FJ = S.FJ, HJ = S.HJ;
    S.LEGS.forEach((L) => {
      const n = L.name, z = L.z;
      if (L.fore) { bone('hum' + n, FJ.S[0], FJ.S[1], z); bone('fa' + n, FJ.E[0], FJ.E[1], z); bone('can' + n, FJ.K[0], FJ.K[1], z); bone('pas' + n, FJ.F[0], FJ.F[1], z); bone('hoof' + n, FJ.C[0], FJ.C[1], z); }
      else { bone('fem' + n, HJ.H[0], HJ.H[1], z); bone('tib' + n, HJ.St[0], HJ.St[1], z); bone('can' + n, HJ.Ho[0], HJ.Ho[1], z); bone('pas' + n, HJ.F[0], HJ.F[1], z); bone('hoof' + n, HJ.C[0], HJ.C[1], z); }
    });
    const len = (a, c) => Math.hypot(c[0] - a[0], c[1] - a[1]), ang = (a, c) => angOf(c[0] - a[0], c[1] - a[1]);
    S.FL = { h: len(FJ.S, FJ.E), f: len(FJ.E, FJ.K), c: len(FJ.K, FJ.F), p: len(FJ.F, FJ.C) };
    S.FA = { h: ang(FJ.S, FJ.E), f: ang(FJ.E, FJ.K), c: ang(FJ.K, FJ.F), p: ang(FJ.F, FJ.C) };
    S.HL = { fe: len(HJ.H, HJ.St), ti: len(HJ.St, HJ.Ho), c: len(HJ.Ho, HJ.F), p: len(HJ.F, HJ.C) };
    S.HA = { fe: ang(HJ.H, HJ.St), ti: ang(HJ.St, HJ.Ho), c: ang(HJ.Ho, HJ.F), p: ang(HJ.F, HJ.C) };
    S.legLen = b + D.R * 0.5;
    { const mx = ne[0] - HD[0] * D.hL * 0.2 + HD[0] * D.hL; S.lenAll = mx - xr; S.midX = (mx + xr) / 2; }
    // 耳（付け根に骨。走るときは後ろへ伏せ、止まっているときはぴくぴく動く）
    S.EARS = [-1, 1].map((sd) => headSurf(S, EAR_F, EAR_TH * sd, -0.01).p);
    bone("earL", ...S.EARS[0]); bone("earR", ...S.EARS[1]);
    // 目（まばたき）: 目の中心に骨。休みの向きを「x＝目の横、y＝目の上、z＝目の外向き」に合わせておき、y を縮めると目が閉じる
    S.EYES = [-1, 1].map((sd) => {
      const e = headSurf(S, EYE_F, EYE_TH * sd, 0), n = e.n, up = vnorm(vsub(e.U, vsc(n, vdot(e.U, n)))), x = vcross(up, n);
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...up), new THREE.Vector3(...n)), q = new THREE.Quaternion().setFromRotationMatrix(m);
      return { p: e.p, n, up, T: e.T, q0: [q.x, q.y, q.z, q.w] };
    });
    bone('eyeL', ...S.EYES[0].p, S.EYES[0].q0); bone('eyeR', ...S.EYES[1].p, S.EYES[1].q0);
    // 前髪（額）とたてがみ（首の上 3 か所）: 走りに合わせて遅れて揺れる
    S.FORE = headSurf(S, EAR_F + 0.02, 0, 0).p; bone('fore', ...S.FORE);
    S.MANE = [0.12, 0.5, 0.88].map((f) => { const c = [S.nb[0] + S.nd[0] * D.nL * f, S.nb[1] + S.nd[1] * D.nL * f], cr = [-S.nd[1], S.nd[0]], rr = D.nR * lerp(1.15, 0.95, f) * 0.92; return [c[0] + cr[0] * rr, c[1] + cr[1] * rr, 0]; });
    S.MANE.forEach((p, i) => bone('mane' + i, ...p));
    // ゼッケンの位置と騎手の休みの姿勢（胴の上の鞍の点から。騎手の大きさは馬の大きさに合わせる）
    {
      const cx = xr + D.L * 0.5, cl = D.L * 0.42;
      S.cloth = { x0: cx - cl * 0.55, x1: cx + cl * 0.45, th: 1.62, cl };
      const js = clamp((yb + D.R) / 1.46, 0.8, 1.12), sx = cx + cl * 0.15, s0 = trunkSurf(S, sx, 0, 0.03).p;
      const zSide = trunkSurf(S, sx + 0.1, PI / 2, 0).p[2];
      const P = [s0[0] - 0.02 * js, s0[1] + 0.17 * js, 0], W0 = [s0[0] + 0.02 * js, s0[1] + 0.25 * js, 0];
      const ta = 46 * DEG, tl = 0.34 * js, Sc = [W0[0] + Math.cos(ta) * tl, W0[1] + Math.sin(ta) * tl, 0];
      const cr0 = vadd([S.nb[0], S.nb[1], 0], vsc([S.nd[0], S.nd[1], 0], D.nL * 0.3)), crest = [-S.nd[1], S.nd[0], 0];
      let hand = vadd(cr0, vsc(crest, D.nR * 1.15 + 0.05));
      const reachMax = 0.5 * js; const dh = vsub(hand, Sc), dl = Math.hypot(dh[0], dh[1]); if (dl > reachMax) hand = vadd(Sc, vsc(dh, reachMax / dl));
      const JK = S.JK = {
        js, s0, pelvis: P, chest: W0, sc: Sc, head: D.real ? [Sc[0] + 0.065 * js, Sc[1] + 0.165 * js, 0] : [Sc[0] + 0.07 * js, Sc[1] + 0.21 * js, 0], neck: [Sc[0] + 0.02 * js, Sc[1] + 0.05 * js, 0], hr: (D.real ? 0.112 : 0.155) * js, // B 案: 騎手の頭は人の大きさ（ちびキャラの 0.72 倍）
        sh: [Sc[0] - 0.02 * js, Sc[1] - 0.02 * js, 0.14 * js], hand: [hand[0], hand[1], 0.075 * js],
        hip: [P[0], P[1] - 0.03 * js, 0.085 * js], knee: [sx + 0.2 * js, s0[1] - 0.04 * js, zSide * 0.75 + 0.06 * js],
        ank: [sx + 0.03 * js, s0[1] - 0.3 * js, zSide + 0.06 * js],
      };
      JK.el = vadd(vlerp(JK.sh, JK.hand, 0.5), [-0.02 * js, -0.09 * js, 0.07 * js]);
      JK.toe = vadd(JK.ank, [0.13 * js, -0.015 * js, 0]);
      bone('jpel', ...JK.pelvis); bone('jchest', ...JK.chest); bone('jhead', ...JK.neck);
      [['L', -1], ['R', 1]].forEach(([s, k]) => {
        const z = (p) => [p[0], p[1], p[2] * k];
        bone('jua' + s, ...z(JK.sh)); bone('jfa' + s, ...z(JK.el)); bone('jth' + s, ...z(JK.hip)); bone('jsh' + s, ...z(JK.knee)); bone('jft' + s, ...z(JK.ank)); bone('jrn' + s, ...z(JK.hand)); // jrn: 手綱の手元（ガッツポーズで右手を上げたときは左手に持ち替える）
      });
    }
    specCache[type] = S; return S;
  }

  // ---------------- 形の組み立て ----------------
  function Geo(BI) { this.BI = BI; this.P = []; this.UV = []; this.C = []; this.SI = []; this.SW = []; this.I = []; this.seams = []; }
  Geo.prototype.vert = function (p, uv, col, wt) {
    const i = this.P.length / 3; this.P.push(p[0], p[1], p[2]); this.UV.push(uv[0], uv[1]); this.C.push(col[0], col[1], col[2]);
    const arr = []; for (const k in wt) if (wt[k] > 1e-4) arr.push([this.BI[k], wt[k]]);
    arr.sort((a, b) => b[1] - a[1]); arr.length = Math.min(arr.length, 4);
    let s = 0; arr.forEach((a) => { s += a[1]; });
    for (let j = 0; j < 4; j++) { this.SI.push(arr[j] ? arr[j][0] : 0); this.SW.push(arr[j] ? arr[j][1] / s : 0); }
    return i;
  };
  Geo.prototype.tri = function (a, b, c) { this.I.push(a, b, c); };
  Geo.prototype.build = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    g.setIndex(this.I); g.computeVertexNormals();
    const n = g.attributes.normal.array;
    this.seams.forEach(([a, b]) => { const x = n[a * 3] + n[b * 3], y = n[a * 3 + 1] + n[b * 3 + 1], z = n[a * 3 + 2] + n[b * 3 + 2], l = Math.hypot(x, y, z) || 1; n[a * 3] = n[b * 3] = x / l; n[a * 3 + 1] = n[b * 3 + 1] = y / l; n[a * 3 + 2] = n[b * 3 + 2] = z / l; });
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.1, 1.0, 0), 2.4);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-2, -0.2, -1.2), new THREE.Vector3(2.2, 2.6, 1.2));
    return g;
  };
  const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vsc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
  const vnorm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vlerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

  // 断面の補間: key = { p:[x,y,z], a:角度(度) | d:[向き], up:[上の目安], t:上(前), b:下(後), w:横の半幅, n:角ばり, wt:{骨:重み} }
  function interp(keys, k, t) {
    const n = keys.length, k0 = keys[Math.max(k - 1, 0)], k1 = keys[k], k2 = keys[Math.min(k + 1, n - 1)], k3 = keys[Math.min(k + 2, n - 1)];
    const r = {};
    r.p = [0, 1, 2].map((i) => cr(k0.p[i], k1.p[i], k2.p[i], k3.p[i], t));
    ['t', 'b', 'w'].forEach((f) => { r[f] = Math.max(0.0004, cr(k0[f], k1[f], k2[f], k3[f], t)); });
    r.n = cr(k0.n || 2, k1.n || 2, k2.n || 2, k3.n || 2, t);
    if (k1.a !== undefined) r.a = cr(k0.a, k1.a, k2.a, k3.a, t) * DEG;
    if (k1.d) r.d = vnorm([0, 1, 2].map((i) => cr(k0.d[i], k1.d[i], k2.d[i], k3.d[i], t)));
    if (k1.up) r.up = vnorm([0, 1, 2].map((i) => cr(k0.up[i], k1.up[i], k2.up[i], k3.up[i], t)));
    const wt = {};
    for (const b in k1.wt) wt[b] = (wt[b] || 0) + k1.wt[b] * (1 - t);
    for (const b in k2.wt) wt[b] = (wt[b] || 0) + k2.wt[b] * t;
    r.wt = wt;
    return r;
  }
  function frameOf(r, T0, upDef) {
    let T;
    if (r.d) T = r.d; else if (r.a !== undefined) T = [Math.cos(r.a), Math.sin(r.a), 0]; else T = T0;
    const up = r.up || (r.a !== undefined && !r.d ? [-Math.sin(r.a), Math.cos(r.a), 0] : upDef || [0, 1, 0]);
    let S = vcross(T, up); if (Math.hypot(S[0], S[1], S[2]) < 1e-5) S = vcross(T, [0, 0, 1]);
    S = vnorm(S); r.T = T; r.U = vcross(S, T); r.S = S;
  }
  // 輪切りの点（超楕円）。th=0 が U（上・前）、+π/2 が S（右・外）
  function ringPoint(r, th) {
    const ct = Math.cos(th), st = Math.sin(th), e = 2 / r.n;
    const ey = Math.sign(ct) * Math.pow(Math.abs(ct), e), ez = Math.sign(st) * Math.pow(Math.abs(st), e), up = ct >= 0 ? r.t : r.b;
    const p = [r.p[0] + r.U[0] * ey * up + r.S[0] * ez * r.w, r.p[1] + r.U[1] * ey * up + r.S[1] * ez * r.w, r.p[2] + r.U[2] * ey * up + r.S[2] * ez * r.w];
    const nn = vnorm([r.U[0] * ct / up + r.S[0] * st / r.w, r.U[1] * ct / up + r.S[1] * st / r.w, r.U[2] * ct / up + r.S[2] * st / r.w]);
    return { p, n: nn };
  }
  function sampleRings(keys, step, upDef) {
    const rings = [];
    for (let k = 0; k < keys.length - 1; k++) {
      const A = keys[k].p, B = keys[k + 1].p, n = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) / step));
      for (let i = 0; i < n; i++) { const r = interp(keys, k, i / n); r.u = k + i / n; rings.push(r); }
    }
    const last = interp(keys, keys.length - 2, 1); last.u = keys.length - 1; rings.push(last);
    let s = 0;
    rings.forEach((r, i) => {
      const a = rings[Math.max(i - 1, 0)].p, b = rings[Math.min(i + 1, rings.length - 1)].p;
      frameOf(r, vnorm(vsub(b, a)), upDef);
      if (i > 0) s += Math.hypot(r.p[0] - rings[i - 1].p[0], r.p[1] - rings[i - 1].p[1], r.p[2] - rings[i - 1].p[2]);
      r.s = s;
    });
    return rings;
  }
  const TILE = 0.5; // 毛のテクスチャ 1 枚の大きさ（m）
  const WHITE_UV = [0.03, 0.03];
  // 筒を作る。o: { segs, step, color(ctx)->rgb, col, uv:'coat'|'flat'|[u0,v0,u1,v1], bump(p,n)->m, capA, capB, th0, up }
  function tube(G, keys, o) {
    // G.det: 細かさの倍率（'far'＝遠くの馬用は 0.55。輪の数と 1 周の分割を減らす）
    const det = G.det || 1, st0 = o.step || 0.05, rings = sampleRings(keys, st0 >= 1 ? st0 : st0 / det, o.up), segs = Math.max(4, Math.round((o.segs || 12) * det)), th0 = o.th0 === undefined ? PI : o.th0;
    const base = G.P.length / 3, total = rings[rings.length - 1].s || 1;
    rings.forEach((r) => {
      const per = PI * (3 * ((r.t + r.b) / 2 + r.w) - Math.sqrt((3 * (r.t + r.b) / 2 + r.w) * ((r.t + r.b) / 2 + 3 * r.w)));
      for (let j = 0; j <= segs; j++) {
        const th = th0 + TAU * j / segs;
        let { p, n } = ringPoint(r, th);
        if (o.bump) { const d = o.bump(p, n, r); if (d) p = vadd(p, vsc(n, d)); }
        let thN = ((th % TAU) + TAU) % TAU; if (thN > PI) thN -= TAU;
        const col = o.color ? o.color({ p, n, s: r.s, sN: r.s / total, th: thN, r }) : (o.col || [1, 1, 1]);
        let uv;
        if (o.uv === 'coat') uv = [j / segs * per / TILE, r.s / TILE];
        else if (Array.isArray(o.uv)) uv = [lerp(o.uv[0], o.uv[2], j / segs), lerp(o.uv[1], o.uv[3], r.s / total)];
        else uv = WHITE_UV;
        G.vert(p, uv, toLin(col), r.wt);
      }
    });
    const RS = segs + 1;
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < segs; j++) {
      const a = base + i * RS + j, b = a + 1, c = a + RS + 1, d = a + RS;
      G.tri(a, b, c); G.tri(a, c, d);
    }
    for (let i = 0; i < rings.length; i++) G.seams.push([base + i * RS, base + i * RS + segs]);
    const cap = (ri, end) => {
      const r = rings[ri], k = Math.min(r.t, r.b, r.w) * 0.55, sgn = end ? 1 : -1;
      const p = vadd(r.p, vsc(r.T, sgn * k));
      const col = o.color ? o.color({ p, n: vsc(r.T, sgn), s: r.s, sN: end ? 1 : 0, th: 0, r }) : (o.col || [1, 1, 1]);
      const uv = Array.isArray(o.uv) ? [lerp(o.uv[0], o.uv[2], 0.5), lerp(o.uv[1], o.uv[3], end ? 1 : 0)] : o.uv === 'coat' ? [0, r.s / TILE] : WHITE_UV;
      const pole = G.vert(p, uv, toLin(col), r.wt), b0 = base + ri * RS;
      for (let j = 0; j < segs; j++) { if (end) G.tri(pole, b0 + j, b0 + j + 1); else G.tri(pole, b0 + j + 1, b0 + j); }
    };
    if (o.capA !== false) cap(0, false);
    if (o.capB !== false) cap(rings.length - 1, true);
    return rings;
  }
  // 細い帯（ベルト類）: pts の点列を通る平たい筒。nrm＝帯の面の向き
  function strap(G, pts, o) {
    const keys = pts.map((p, i) => {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
      return { p, d: vnorm(vsub(b, a)), up: o.nrm ? o.nrm[i] : (o.upv || [0, 1, 0]), t: o.h, b: o.h, w: o.w, n: o.n || 2.6, wt: o.wt(i / (pts.length - 1), p) };
    });
    return tube(G, keys, { segs: o.segs || 6, step: o.step || 1, col: o.col, color: o.color, uv: o.uv || 'flat', capA: !o.loop, capB: !o.loop, th0: 0 });
  }

  // ---------------- 胴〜首（1 本の筒） ----------------
  function trunkKeys(S) {
    if (S._trunk) return S._trunk;
    const D = S.D, K = [], xr = S.xr, yb = S.yb, { xs, Rb, A, cx, cy } = S.bend;
    const hindX = S.bones[S.BI.hind].r[0];
    const wtBody = (x) => { const k = smooth(hindX - 0.12, hindX + 0.18, x); return { hind: 1 - k, body: k }; };
    // 胴: 尻の丸み（半球）→ 少しくびれ → 胸
    const R0 = Math.min(D.R * 0.95, D.L * 0.42), ds = [0, 0.02, 0.07, 0.16, 0.3, 0.5, 0.75, 1.0].map((f) => f * R0);
    const prof = D.real ? (x) => {
      // B 案: 横から見た背の線（尻→背のくぼみ→き甲）と腹の線（後ろへ巻き上がる→胸底が一番深い）、上から見た幅（腰が張り、肋が丸く、胸前は細い）
      // 尻は丸い半球ではなく、後ろが縦に落ちて太ももへ続く（下 b は丸めを弱く＝深いまま）。太ももの前（u 0.38）で腹が巻き上がる（ひばら）
      const d0 = x - xr, q = Math.max(0, 1 - (1 - Math.min(1, d0 / R0)) ** 2), u = (x - xr) / D.L, g = (c, w) => Math.exp(-(((u - c) / w) ** 2));
      const top = 0.9 + 0.1 * g(0.17, 0.15) - 0.05 * g(0.55, 0.16) + 0.04 * g(0.86, 0.1);
      const bot = 1.0 - 0.2 * g(0.4, 0.1) - 0.1 * g(0.55, 0.15) + 0.0 * u - 0.04 * smooth(0.0, 0.3, u) + 0.02 * smooth(0.6, 0.85, u);
      const wid = 0.92 + 0.1 * g(0.2, 0.13) + 0.07 * g(0.55, 0.18) - 0.14 * smooth(0.7, 1.0, u);
      return { t: D.R * Math.pow(q, 0.45) * top, b: D.R * Math.pow(q, 0.16) * bot, w: D.W * Math.pow(q, 0.35) * wid };
    } : (x) => {
      const d0 = x - xr, e0 = d0 < R0 ? Math.sqrt(Math.max(0, 1 - (1 - d0 / R0) ** 2)) : 1;
      const u = (x - xr) / D.L, waist = 1 - 0.07 * Math.exp(-(((u - 0.56) / 0.18) ** 2));
      const rump = 1 + 0.05 * Math.exp(-(((u - 0.22) / 0.15) ** 2));
      return { t: D.R * e0 * waist * rump, b: D.R * e0 * waist * (1 - 0.04 * Math.exp(-(((u - 0.65) / 0.15) ** 2))), w: D.W * e0 * waist * rump };
    };
    const xs2 = [];
    ds.forEach((d) => xs2.push(xr + d));
    const nb = Math.max(3, Math.round((xs - (xr + R0)) / 0.14));
    for (let i = 1; i <= nb; i++) xs2.push(xr + R0 + (xs - xr - R0) * i / nb);
    xs2.forEach((x) => { const p = prof(x); K.push({ p: [x, yb - 0.01 * Math.exp(-((((x - xr) / D.L - 0.6) / 0.2) ** 2)), 0], a: 0, t: Math.max(p.t, 0.004), b: Math.max(p.b, 0.004), w: Math.max(p.w, 0.004), n: 2.15, wt: wtBody(x) }); });
    // 曲がり（胸）: 中心は円弧に沿って上へ。上（内側）は細く、下（胸の前）は張る
    const p0 = prof(xs), nbB = 5;
    for (let i = 1; i <= nbB; i++) {
      const f = i / nbB, a = A * f, x = cx + Rb * Math.sin(a), y = cy - Rb * Math.cos(a);
      const nk = D.real ? [1.2, 1.95, 1.35] : [1.15, 1.55, 1.3];
      const t = lerp(p0.t, D.nR * nk[0], smooth(0, 1, f)), b = lerp(p0.b, D.nR * nk[1], smooth(0, 1, f)) * (1 + (D.real ? 0.06 : 0.12) * Math.sin(PI * f)), w = lerp(p0.w, D.nR * nk[2], smooth(0, 1, f));
      K.push({ p: [x, y, 0], a: a / DEG, t: Math.min(t, Rb * 0.92), b, w, n: 2.1, wt: { body: 1 - 0.6 * f, neck1: 0.6 * f } });
    }
    // 首: 付け根→うなじ
    const nbN = Math.max(2, Math.round(D.nL / 0.12));
    for (let i = 1; i <= nbN; i++) {
      const f = i / nbN, x = S.nb[0] + S.nd[0] * D.nL * f, y = S.nb[1] + S.nd[1] * D.nL * f;
      const wt = f < 0.25 ? { body: 0.4 * (1 - f / 0.25), neck1: 0.6 + 0.4 * (f / 0.25) * 0 + 0.0, neck2: 0.4 * (f / 0.25) } : f < 0.7 ? { neck2: 1 - (f - 0.25) / 0.45 * 0.6, neck3: (f - 0.25) / 0.45 * 0.6 } : { neck3: 1 - (f - 0.7) / 0.3 * 0.5, head: (f - 0.7) / 0.3 * 0.5 };
      if (D.real) K.push({ p: [x, y, 0], a: D.nA, t: D.nR * lerp(1.2, 0.72, f) * (1 + 0.12 * Math.sin(PI * f)), b: D.nR * lerp(1.95, 0.7, Math.sqrt(f)), w: D.nR * lerp(1.35, 0.62, f), n: 2.05, wt });
      else K.push({ p: [x, y, 0], a: D.nA, t: D.nR * lerp(1.15, 0.95, f), b: D.nR * lerp(1.55, 1.0, Math.sqrt(f)), w: D.nR * lerp(1.3, 0.95, f), n: 2.05, wt });
    }
    const e = S.ne;
    K.push({ p: [e[0] + S.nd[0] * D.nR * 0.6, e[1] + S.nd[1] * D.nR * 0.6, 0], a: D.nA, t: D.nR * 0.3, b: D.nR * 0.3, w: D.nR * 0.3, n: 2, wt: { neck3: 0.3, head: 0.7 } });
    S._trunk = K; return K;
  }
  // 胴の面の点（ゼッケン・腹帯の置き場所）
  function trunkRingAtX(S, x) {
    const keys = trunkKeys(S); let lo = 0, hi = keys.length - 8;
    for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2, k = Math.min(Math.floor(m), keys.length - 2), r = interp(keys, k, m - k); if (r.p[0] < x) lo = m; else hi = m; }
    const k = Math.min(Math.floor(lo), keys.length - 2), r = interp(keys, k, lo - k); frameOf(r, [1, 0, 0]); return r;
  }
  function trunkSurf(S, x, th, off) { const r = trunkRingAtX(S, x), s = ringPoint(r, th); return { p: vadd(s.p, vsc(s.n, off)), n: s.n, wt: r.wt }; }

  // ---------------- 頭 ----------------
  // 頭の断面: [s(頭の長さに対する割合), 上, 下, 横（頭の太さ hR に対する割合）]、鼻先の部分は mR に対する割合
  // 頭＝後ろの大きな丸（頭）と前の丸（鼻先）をなめらかにつないだ形。両端は球のように丸く（近くで見てもかくかくしない）
  const HC = { fc: 0.355, ac: 0.39, fm: 0.785, am: 0.215 };
  function headKeys(S) {
    if (S._head) return S._head;
    const D = S.D, { HD, B0 } = S.head, K = [], wk = D.hW / 0.95;
    const ell = (f, c, a) => { const x = (f - c) / a; return x <= -1 || x >= 1 ? 0 : Math.sqrt(1 - x * x); };
    const smax = (a, b, k) => { const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return lerp(b, a, h) + k * h * (1 - h); };
    const N = 34;
    if (D.real) {
      // [f（後頭部 0 → 鼻先 1）, 上（額・鼻筋側）, 下（あご側）, 横の半幅]（hR に対する割合）
      const PR = [[0, 0.05, 0.05, 0.05], [0.025, 0.5, 0.55, 0.45], [0.07, 0.72, 0.86, 0.64], [0.15, 0.8, 1.0, 0.74], [0.25, 0.82, 1.0, 0.78], [0.33, 0.8, 0.86, 0.74], [0.42, 0.74, 0.64, 0.62],
        [0.55, 0.64, 0.5, 0.49], [0.68, 0.57, 0.45, 0.44], [0.8, 0.53, 0.47, 0.45], [0.88, 0.51, 0.5, 0.46], [0.94, 0.43, 0.46, 0.4], [0.98, 0.27, 0.3, 0.26], [1, 0.04, 0.05, 0.04]];
      const at = (f, j) => { let i = 0; while (i < PR.length - 2 && PR[i + 1][0] < f) i++; const a = PR[i], b = PR[i + 1], u = smooth(0, 1, clamp((f - a[0]) / (b[0] - a[0]), 0, 1)); return lerp(a[j], b[j], u) * D.hR; };
      for (let i = 0; i <= N; i++) {
        const f = 0.004 + 0.992 * (0.5 - 0.5 * Math.cos(PI * i / N));
        K.push({ p: [B0[0] + HD[0] * D.hL * f, B0[1] + HD[1] * D.hL * f, 0], a: D.hA, t: Math.max(at(f, 1), 0.002), b: Math.max(at(f, 2), 0.002), w: Math.max(at(f, 3), 0.002), n: 2.1, wt: { head: 1 } });
      }
      S._head = K; return K;
    }
    for (let i = 0; i <= N; i++) {
      const f = 0.004 + 0.992 * (0.5 - 0.5 * Math.cos(PI * i / N));   // 両端ほど細かく
      const c = ell(f, HC.fc, HC.ac), m = ell(f, HC.fm, HC.am), k = D.hR * 0.16, cheek = 1 + 0.06 * Math.exp(-(((f - 0.4) / 0.12) ** 2));
      const t = smax(c * D.hR, m * D.mR * 0.97, k), b = smax(c * D.hR * 1.02 * cheek, m * D.mR * 1.04, k), w = smax(c * D.hR * wk * 1.0 * cheek, m * D.mR * 1.0, k);
      K.push({ p: [B0[0] + HD[0] * D.hL * f, B0[1] + HD[1] * D.hL * f, 0], a: D.hA, t: Math.max(t, 0.002), b: Math.max(b, 0.002), w: Math.max(w, 0.002), n: lerp(2.08, 2.0, smooth(0.5, 0.75, f)), wt: { head: 1 } });
    }
    S._head = K; return K;
  }
  function headSurf(S, f, th, off) {
    const keys = headKeys(S), D = S.D, { HD, B0 } = S.head, s = f * D.hL;
    const sOf = (p) => (p[0] - B0[0]) * HD[0] + (p[1] - B0[1]) * HD[1];
    let k = 0; while (k < keys.length - 2 && sOf(keys[k + 1].p) < s) k++;
    const s0 = sOf(keys[k].p), s1 = sOf(keys[k + 1].p), r = interp(keys, k, clamp((s - s0) / (s1 - s0), 0, 1)); frameOf(r, HD);
    const q = ringPoint(r, th); return { p: vadd(q.p, vsc(q.n, off)), n: q.n, T: r.T, U: r.U, S: r.S };
  }
  const headLocal = (S, p) => { const { HD, HU, B0 } = S.head, d = vsub(p, B0); return { f: vdot(d, HD) / S.D.hL, u: vdot(d, HU), z: p[2] }; };
  // 目・鼻の穴の位置
  // NB_F＝鼻革の位置（頭の丸と鼻先の丸の境目）
  // B 案: 目は額の横（頭の長さの 27% の所、横向き）、鼻の穴は鼻先の前寄りの横、鼻革は頬骨の少し下（55%）
  const EYE_F = 0.27, EYE_TH = 1.02, NOS_F = 0.915, NOS_TH = 0.62, NB_F = 0.55, MZ_F = 0.8, EAR_F = 0.06, EAR_TH = 0.52;

  // ---------------- 毛色の塗り分け ----------------
  function coatColor(S, coat, mark, part, ctx, legIdx, mare) {
    const C = COATS[coat], body = hexRGB(C.body), p = ctx.p;
    let c = body;
    const shade = (base) => { const ny = ctx.n[1]; let k = base; if (ny > 0.5) k = mixC(k, hexRGB(C.top), smooth(0.5, 0.95, ny) * 0.7); if (ny < -0.2) k = mixC(k, hexRGB(C.belly), smooth(-0.2, -0.85, ny) * 0.8); return k; };
    if (part === 'trunk') {
      c = shade(body);
      if (C.dapple) { const f = Math.sin(p[0] * 21 + 0.4) * Math.sin(p[1] * 19 + 1.3) * Math.sin(p[2] * 23 + 0.7) + 0.35 * Math.sin(p[0] * 9 + p[2] * 7); c = mixC(c, hexRGB(C.dapple), 0.65 * smooth(0.12, 0.42, f) * smooth(-0.5, 0.1, ctx.n[1])); }
    }
    else if (part === 'head') {
      const L = headLocal(S, p), D = S.D;
      c = shade(body);
      // 鼻先（はっきり色を分ける）
      c = mixC(c, hexRGB(C.muzzle), smooth(MZ_F - 0.08, MZ_F + 0.06, L.f));
      // 目のまわりの毛の薄い所（少し暗い）
      S.EYES.forEach((E) => { const d = vlen(vsub(p, E.p)); c = mixC(c, hexRGB(C.muzzle), 0.55 * smooth(D.hR * 0.42, D.hR * 0.24, d)); });
      if (false) { const ch = headSurf(S, 0.66, 1.3, 0).p, d2 = (p[0] - ch[0]) ** 2 + (p[1] - ch[1]) ** 2 + (Math.abs(p[2]) - Math.abs(ch[2])) ** 2; c = mixC(c, hexRGB("#f19093"), 0.85 * smooth((D.mR * 0.4) ** 2, (D.mR * 0.22) ** 2, d2)); }
      // 流星（顔の前の白い筋）
      // 顔の白斑（1 頭ごと: 流星・太い流星・星・鼻の白・星＋鼻の白・なし）。小さな絵（出馬表 62px）でも見分けられるよう、形をはっきり変える
      const fm = mark.face || ((mark.blaze || C.blaze) ? 'blaze' : 'none'), az = Math.abs(L.z);
      if (coat !== 'white' && coat !== 'gray' && L.u > 0 && fm !== 'none') {
        let k = 0;
        if (fm === 'blaze' || fm === 'wide') { const wide = fm === 'wide', wz = D.hR * (wide ? 0.42 + 0.22 * smooth(0.45, 0.85, L.f) : 0.18 + 0.1 * smooth(0.45, 0.2, L.f)) * (L.f > NB_F - 0.05 && !wide ? 1.4 : 1); if (L.f > 0.16) k = smooth(wz, wz * 0.82, az) * smooth(0.16, 0.21, L.f); }
        if (fm === 'star' || fm === 'starsnip') { const d = az / (D.hR * 0.3) + Math.abs(L.f - 0.23) / 0.07; k = Math.max(k, smooth(1.0, 0.85, d)); }
        if (fm === 'snip' || fm === 'starsnip') { const d = Math.hypot(az / (D.mR * 0.45), (L.f - 0.88) / 0.07); k = Math.max(k, smooth(1.0, 0.85, d)); }
        c = mixC(c, mixC(WHITE_MARK, hexRGB('#e6c3ba'), smooth(MZ_F - 0.04, MZ_F + 0.06, L.f)), k); // 白斑が鼻先にかかる所は桃色の皮膚
      }
    } else if (part === 'leg') {
      const y = p[1];
      c = shade(body);
      if (C.points) c = mixC(c, hexRGB(C.points), smooth(S.D.belly * 0.68, S.D.belly * 0.5, y)); // 鹿毛の黒い脚先（ひざ・飛節から下）
      if (mark.sock.indexOf(legIdx) >= 0 && coat !== 'white') c = mixC(c, WHITE_MARK, smooth(S.D.belly * (0.3 + 0.04 * legIdx), S.D.belly * (0.26 + 0.04 * legIdx), y));
      if (y < S.hoofH * 1.05) c = mixC(c, hexRGB(C.hoof), smooth(S.hoofH * 1.05, S.hoofH * 0.9, y));
    } else if (part === 'mane' || part === 'tail') c = hexRGB(mark.maneCol || C.mane);
    else if (part === "ear") { c = shade(body); if (Math.abs(ctx.th) < 1.0 && ctx.sN > 0.12) c = mixC(c, hexRGB(C.ear), 0.8 * smooth(1.0, 0.6, Math.abs(ctx.th))); if (ctx.sN > 0.85) c = mixC(c, hexRGB(C.mane), 0.5); }
    return c;
  }

  // ---------------- 馬の体の形（体型・毛色・白斑・品質ごとに 1 つ作って共有） ----------------
  const geoCache = {};
  /* 使っている馬の数を数え、使われなくなった形は新しい順に GEO_IDLE_MAX 個だけ残して捨てる（QA3 2026-10-14: 馬名 × 馬番で鍵が変わるため、
     捨てないとレースのたびに増え続けた＝1 頭 約 0.5MB。全店テレビを 1 日つけっぱなしにすると数十 MB の GPU メモリ） */
  const geoRefs = {}, geoIdle = [], GEO_IDLE_MAX = 12; // 6 頭 × 遠くの形（far・LOD）の切り替えぶんより多く
  function geoRef(key, d) {
    if (!key || !geoCache[key]) return;
    const n = geoRefs[key] = Math.max(0, (geoRefs[key] || 0) + d), at = geoIdle.indexOf(key);
    if (n > 0) { if (at >= 0) geoIdle.splice(at, 1); return; }
    if (at < 0) geoIdle.push(key);
    while (geoIdle.length > GEO_IDLE_MAX) { const k = geoIdle.shift(); if (geoCache[k] && !geoRefs[k]) { geoCache[k].dispose(); delete geoCache[k]; delete geoRefs[k]; } }
  }
  function horseGeometry(S, coat, markIdx, q, mare, F) {
    F = F || { eye: 'round', fore: 'twin', mane: 'spiky', face: null, maneCol: null };
    const key = S.type + coat + markIdx + q + F.face + F.maneCol; if (geoCache[key]) return geoCache[key];
    const hi = q === 'high', G = new Geo(S.BI), mark = Object.assign({}, MARKS[markIdx], { face: F.face, maneCol: F.maneCol }), D = S.D; const type = S.type;
    G.det = q === 'far' ? 0.55 : 1; // 'far': Fire TV 向けの遠くの馬（js/race3d.js が画面で小さい馬だけ切り替える）
    const cf = (part, legIdx) => (ctx) => coatColor(S, coat, mark, part, ctx, legIdx, mare);
    // 胴〜首
    tube(G, trunkKeys(S), { segs: hi ? 26 : 14, step: hi ? 0.065 : 0.13, uv: 'coat', color: cf('trunk') });
    // 頭
    const HK = headKeys(S), hk = hi ? HK : HK.filter((k, i) => i % 2 === 0 || i === HK.length - 1); // 軽い形は輪切りを半分に
    tube(G, hk, { segs: hi ? 26 : 12, step: hi ? 0.026 : 0.08, uv: "coat", color: cf("head") }); // B 案の頭は小さいので分割を減らす（三角形を今の馬以下に）
    // 鼻の穴（暗い楕円の皿）と口の線
    {
      const dk = mixC(hexRGB(COATS[coat].muzzle), [0.1, 0.04, 0.05], 0.8), H = { head: 1 };
      [-1, 1].forEach((sd) => {
        const s = headSurf(S, NOS_F, NOS_TH * sd, 0), n = s.n, up = vnorm(vsub(s.T, vsc(n, vdot(s.T, n))));
        const nk = (k, sc) => ({ p: vadd(s.p, vsc(n, k)), d: n, up, t: D.mR * 0.28 * sc, b: D.mR * 0.24 * sc, w: D.mR * 0.12 * sc, n: 2, wt: H });
        tube(G, [nk(-0.012, 0.9), nk(0.0, 1), nk(0.0025, 0.75), nk(0.003, 0.1)], { segs: hi ? 10 : 6, step: 1, col: dk });
      });
    }
    // 目（B 案: 自然な大きさのアーモンド形の目。濃い茶色の瞳につや、小さな光の点 1 つ、上まぶたの線）。目は目の骨に付く（まばたき）
    [-1, 1].forEach((sd) => {
      const E = S.EYES[sd < 0 ? 0 : 1], n = E.n, c = E.p, H = { [sd < 0 ? 'eyeL' : 'eyeR']: 1 };
      const T0 = vnorm(vsub(E.T, vsc(n, vdot(E.T, n))));
      const up = vnorm(vsub(E.up, vsc(T0, 0.12))), fw = vnorm(vcross(n, up)), fs = vdot(fw, T0) < 0 ? -1 : 1;
      const er = 0.03, et = er * 0.72, ew = er * 1.05;
      const dark = hexRGB('#140c0a'), iris = hexRGB('#4a2a1c');
      const eyeKey = (k, sc) => ({ p: vadd(c, vsc(n, k * er)), d: n, up, t: et * sc, b: et * sc, w: ew * sc, n: 2.3, wt: H });
      const ks = (hi ? [-0.5, -0.2, 0.0, 0.14, 0.24, 0.31, 0.35] : [-0.5, 0.0, 0.24, 0.35]).map((k) => eyeKey(k, Math.sqrt(Math.max(0.0025, 1 - ((k + 0.05) / 0.41) ** 2))));
      tube(G, ks, { segs: hi ? 20 : 8, step: 1, uv: [-1, -1, -1, -1], color: (ctx) => mixC(dark, iris, 0.6 * smooth(-0.1, -0.8, vdot(vsub(ctx.p, c), up) / et)) });
      // 光の点（小さく 1 つ）
      { const hp = vadd(vadd(vadd(c, vsc(n, er * 0.33)), vsc(up, 0.35 * et)), vsc(fw, fs * 0.3 * ew)), hd = n, r = er * 0.13;
        const hk = (k, sc) => ({ p: vadd(hp, vsc(hd, k)), d: hd, up, t: r * sc, b: r * sc, w: r * sc, n: 2, wt: H });
        tube(G, [hk(-er * 0.08, 0.7), hk(0.0, 1), hk(er * 0.035, 0.6), hk(er * 0.045, 0.1)], { segs: hi ? 8 : 5, step: 1, col: [1, 1, 1], uv: [-3, -3, -3, -3] }); }
      // 上まぶた（目の上の弓なりの皮膚のふち。毛色を暗くした色）
      if (hi) { const lid = []; for (let i = 0; i <= 8; i++) { const a = lerp(-1.25, 1.25, i / 8); lid.push(vadd(vadd(vadd(c, vsc(up, et * 1.02 * Math.cos(a))), vsc(fw, ew * 1.04 * Math.sin(a))), vsc(n, er * 0.2 * Math.cos(a)))); }
        strap(G, lid, { w: er * 0.16, h: er * 0.07, upv: n, col: mixC(hexRGB(COATS[coat].muzzle), [0, 0, 0], 0.4), wt: () => ({ head: 0.3, [sd < 0 ? 'eyeL' : 'eyeR']: 0.7 }), segs: 4 }); }
      // 耳: 頭のてっぺんで上へ立ち、少し外・前を向く。細めの木の葉の形（内側が暗い）
      const eb = headSurf(S, EAR_F, EAR_TH * sd, -0.01).p, eu = vnorm(vadd(vadd(vsc(S.head.HU, 0.55), vsc(S.head.HD, -0.5)), [0, 0, 0.22 * sd]));
      const side = vnorm(vcross(eu, [0, 0, 1])), fwd = vnorm(vsub(S.head.HD, vsc(eu, vdot(S.head.HD, eu))));
      const L = D.ear, eN = sd < 0 ? "earL" : "earR", ek = (k, t, bb, w) => ({ p: vadd(eb, vsc(eu, k * L)), d: eu, up: vnorm(vadd(fwd, vsc(side, 0))), t: t * L, b: bb * L, w: w * L, n: 2.1, wt: k < 0 ? { head: 0.6, [eN]: 0.4 } : { [eN]: 1 } });
      tube(G, [ek(-0.15, 0.22, 0.22, 0.24), ek(0.12, 0.2, 0.14, 0.25), ek(0.45, 0.17, 0.07, 0.22), ek(0.78, 0.1, 0.035, 0.13), ek(1.0, 0.015, 0.01, 0.02)], { segs: hi ? 10 : 6, step: hi ? 0.03 : 0.08, uv: "coat", color: cf("ear"), th0: 0 });
    });
    // 脚
    S.LEGS.forEach((Lg, li) => {
      const z = Lg.z, keys = [], r = D.lR;
      const K = (p, a, t, b, w, wt, n) => keys.push({ p: [p[0], p[1], z], a, t: t * r, b: b * r, w: w * r, n: n || 2.1, wt });
      const mid = (a, b, f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
      const lower = (J, c, p, o) => {
        K(J.F, -82, 0.98, 1.12, 0.95, { [c]: 0.5, [p]: 0.5 });
        K(mid(J.F, J.C, 0.5), -70, 0.7, 0.72, 0.7, { [p]: 1 });
        K([J.C[0], J.C[1] + 0.005], -88, 0.92, 0.88, 0.98, { [p]: 0.3, [o]: 0.7 }, 2.4);
        K([J.C[0] + 0.01, J.C[1] * 0.45], -90, 1.1, 0.98, 1.1, { [o]: 1 }, 2.6);
        K([J.C[0] + 0.012, 0.004], -90, 1.14, 1.0, 1.13, { [o]: 1 }, 2.6);
        K([J.C[0] + 0.012, 0.0], -90, 0.9, 0.78, 0.88, { [o]: 1 }, 2.6);
      };
      if (D.real && Lg.fore) {
        const J = S.FJ, h = 'hum' + Lg.name, f = 'fa' + Lg.name, c = 'can' + Lg.name, p = 'pas' + Lg.name, o = 'hoof' + Lg.name;
        K([J.S[0] - 0.03, J.S[1] - 0.02], -105, 3.1, 3.2, 2.3, { body: 0.7, [h]: 0.3 });
        K(mid(J.S, J.E, 0.6), -100, 2.5, 2.7, 1.95, { [h]: 0.6, [f]: 0.4 });
        K(mid(J.E, J.K, 0.15), -90, 1.95, 1.9, 1.55, { [f]: 1 });
        K(mid(J.E, J.K, 0.6), -90, 1.3, 1.2, 1.1, { [f]: 1 });
        K(J.K, -90, 1.15, 1.05, 1.22, { [f]: 0.5, [c]: 0.5 });
        K(mid(J.K, J.F, 0.5), -90, 0.68, 0.98, 0.7, { [c]: 1 });
        lower(J, c, p, o);
      } else if (D.real) {
        const J = S.HJ, fe = 'fem' + Lg.name, ti = 'tib' + Lg.name, c = 'can' + Lg.name, p = 'pas' + Lg.name, o = 'hoof' + Lg.name;
        // 太もも〜尻: 後ろ（b）を大きく張って尻端からすねの後ろの線へつなぐ（ハムストリング）。前（t）は後膝へ
        K([J.H[0] + 0.02, J.H[1] + 0.02], -95, 4.2, 5.0, 2.9, { hind: 1 });
        K(mid(J.H, J.St, 0.5), -112, 3.9, 5.4, 2.8, { hind: 0.5, [fe]: 0.5 });
        K(mid(J.St, J.Ho, 0.1), -128, 2.8, 6.0, 2.2, { [fe]: 0.4, [ti]: 0.6 });
        K(mid(J.St, J.Ho, 0.45), -130, 1.7, 4.0, 1.35, { [ti]: 1 });
        K(mid(J.St, J.Ho, 0.78), -122, 1.15, 2.3, 1.08, { [ti]: 1 });
        K(J.Ho, -100, 1.05, 1.5, 1.1, { [ti]: 0.5, [c]: 0.5 });
        K(mid(J.Ho, J.F, 0.5), -90, 0.72, 1.0, 0.72, { [c]: 1 });
        lower(J, c, p, o);
      } else if (Lg.fore) {
        const J = S.FJ, h = 'hum' + Lg.name, f = 'fa' + Lg.name, c = 'can' + Lg.name, p = 'pas' + Lg.name, o = 'hoof' + Lg.name;
        K([J.S[0] - 0.03, J.S[1] - 0.02], -105, 1.9, 1.9, 1.7, { body: 0.7, [h]: 0.3 });
        K(mid(J.S, J.E, 0.6), -100, 1.85, 1.9, 1.6, { [h]: 0.6, [f]: 0.4 });
        K(mid(J.E, J.K, 0.2), -90, 1.6, 1.5, 1.38, { [f]: 1 });
        K(mid(J.E, J.K, 0.6), -90, 1.15, 1.1, 1.08, { [f]: 1 });
        K(J.K, -90, 1.05, 1.0, 1.02, { [f]: 0.5, [c]: 0.5 });
        K(mid(J.K, J.F, 0.5), -90, 0.82, 0.86, 0.82, { [c]: 1 });
        K(J.F, -82, 0.95, 1.0, 0.95, { [c]: 0.5, [p]: 0.5 });
        K(mid(J.F, J.C, 0.5), -70, 0.85, 0.85, 0.85, { [p]: 1 });
        K([J.C[0], J.C[1] + 0.005], -88, 1.12, 1.05, 1.15, { [p]: 0.3, [o]: 0.7 }, 2.4);
        K([J.C[0] + 0.01, J.C[1] * 0.45], -90, 1.32, 1.12, 1.3, { [o]: 1 }, 2.6);
        K([J.C[0] + 0.012, 0.004], -90, 1.36, 1.15, 1.32, { [o]: 1 }, 2.6);
        K([J.C[0] + 0.012, 0.0], -90, 1.05, 0.9, 1.0, { [o]: 1 }, 2.6);
      } else {
        const J = S.HJ, fe = 'fem' + Lg.name, ti = 'tib' + Lg.name, c = 'can' + Lg.name, p = 'pas' + Lg.name, o = 'hoof' + Lg.name;
        K([J.H[0], J.H[1] - 0.04], -80, 2.6, 2.7, 2.1, { hind: 1 });
        K(mid(J.H, J.St, 0.55), -100, 2.5, 2.6, 2.0, { hind: 0.5, [fe]: 0.5 });
        K(mid(J.St, J.Ho, 0.15), -120, 1.85, 2.0, 1.55, { [fe]: 0.4, [ti]: 0.6 });
        K(mid(J.St, J.Ho, 0.55), -125, 1.25, 1.35, 1.15, { [ti]: 1 });
        K(J.Ho, -100, 1.0, 1.2, 1.0, { [ti]: 0.5, [c]: 0.5 });
        K(mid(J.Ho, J.F, 0.5), -90, 0.84, 0.88, 0.84, { [c]: 1 });
        K(J.F, -82, 0.95, 1.0, 0.95, { [c]: 0.5, [p]: 0.5 });
        K(mid(J.F, J.C, 0.5), -70, 0.85, 0.85, 0.85, { [p]: 1 });
        K([J.C[0], J.C[1] + 0.005], -88, 1.12, 1.05, 1.15, { [p]: 0.3, [o]: 0.7 }, 2.4);
        K([J.C[0] + 0.01, J.C[1] * 0.45], -90, 1.32, 1.12, 1.3, { [o]: 1 }, 2.6);
        K([J.C[0] + 0.012, 0.004], -90, 1.36, 1.15, 1.32, { [o]: 1 }, 2.6);
        K([J.C[0] + 0.012, 0.0], -90, 1.05, 0.9, 1.0, { [o]: 1 }, 2.6);
      }
      tube(G, keys, { segs: hi ? 11 : 7, step: hi ? 0.06 : 0.12, uv: "coat", color: cf("leg", li), capA: false });
    });
    // たてがみ（B 案: 競走馬の短く整えたたてがみ。首の右側に寝る細い毛の束を少しずつ重ねて並べる。毛先はぎざぎざ）と前髪（額に垂れる細い束 3 本）。
    // 束の根元は首・頭に、先は揺れる骨（mane0〜2・fore）に付ける
    {
      const neckW = (f) => (f < 0.4 ? { neck2: 1 } : f < 0.8 ? { neck2: 1 - (f - 0.4) / 0.4, neck3: (f - 0.4) / 0.4 } : { neck3: 1 });
      const maneW = (f) => (f <= 0.12 ? { mane0: 1 } : f < 0.5 ? { mane0: 1 - (f - 0.12) / 0.38, mane1: (f - 0.12) / 0.38 } : f < 0.88 ? { mane1: 1 - (f - 0.5) / 0.38, mane2: (f - 0.5) / 0.38 } : { mane2: 1 });
      const mixW = (a, b, k) => { const w = {}; for (const n in a) w[n] = (w[n] || 0) + a[n] * (1 - k); for (const n in b) w[n] = (w[n] || 0) + b[n] * k; return w; };
      const nd = [S.nd[0], S.nd[1], 0], crest = [-S.nd[1], S.nd[0], 0], ZZ = [0, 0, 1], R = seeded(31);
      const gapM = hi ? 0.036 : 0.05, N = Math.round(D.nL / gapM) + 3;
      for (let i = 0; i < N; i++) {
        const f = lerp(-0.06, 1.0, i / (N - 1)), fc = clamp(f, 0, 1), c = [S.nb[0] + nd[0] * D.nL * f, S.nb[1] + nd[1] * D.nL * f, 0];
        const tN = D.nR * lerp(1.2, 0.72, fc) * (1 + 0.12 * Math.sin(PI * fc)), wN = D.nR * lerp(1.35, 0.62, fc);
        const len = (0.85 + 0.3 * R()) * (i === 0 ? 0.6 : 1) * (fc > 0.92 ? 0.75 : 1), th1 = 1.45 * len, wA = neckW(fc), wB = maneW(fc);
        const pt = (k) => { const th = lerp(-0.22, th1 - 0.22, k), o = 0.006 + 0.01 * k; return vadd(vadd(vadd(c, vsc(crest, (tN + o) * Math.cos(th))), vsc(ZZ, (wN + o) * Math.sin(th))), vsc(nd, -0.035 * k * k)); };
        const ks = [0, 0.3, 0.65, 1].map((k, j) => {
          const p = pt(k), d = vnorm(vsub(pt(Math.min(1, k + 0.05)), pt(Math.max(0, k - 0.05)))), out = vnorm(vadd(vsc(crest, Math.cos(lerp(-0.22, th1 - 0.22, k))), vsc(ZZ, Math.sin(lerp(-0.22, th1 - 0.22, k)))));
          const sc = [1, 0.95, 0.7, 0.08][j];
          return { p, d, up: out, t: 0.007 * sc, b: 0.004 * sc, w: gapM * 1.25 * sc, n: 2, wt: mixW(wA, wB, clamp(k * 1.1, 0, 1) * 0.9) };
        });
        tube(G, ks, { segs: hi ? 4 : 3, step: 1, uv: "coat", color: cf("mane"), capA: false });
      }
      // たてがみの根元: 首の頂（少し右寄り）に沿った毛の帯（束のすき間から首の地肌が見えないように）
      { const pts = [], nrm = [], M = hi ? 14 : 7; for (let i = 0; i <= M; i++) { const fc = lerp(-0.04, 1.0, i / M), c = [S.nb[0] + nd[0] * D.nL * fc, S.nb[1] + nd[1] * D.nL * fc, 0], fcc = clamp(fc, 0, 1);
          const tN = D.nR * lerp(1.2, 0.72, fcc) * (1 + 0.12 * Math.sin(PI * fcc)), wN = D.nR * lerp(1.35, 0.62, fcc), th = 0.32, out = vnorm(vadd(vsc(crest, Math.cos(th)), vsc(ZZ, Math.sin(th))));
          pts.push(vadd(vadd(c, vsc(crest, (tN + 0.004) * Math.cos(th))), vsc(ZZ, (wN + 0.004) * Math.sin(th)))); nrm.push(out); }
        strap(G, pts, { w: 0.05, h: 0.004, nrm, col: [0, 0, 0], color: cf('mane'), uv: 'coat', wt: (t) => neckW(clamp(t, 0, 1)), segs: 4 }); }
      // 前髪: 耳の間から額へ垂れる細い束（顔の面に沿う）
      const fw = (k) => (k <= 0 ? { head: 1 } : { head: 1 - 0.9 * k, fore: 0.9 * k });
      [[-0.2, 0.2], [0.0, 0.26], [0.2, 0.18]].forEach(([th, L]) => {
        const ks = [0, 0.35, 0.7, 1].map((k, j) => {
          const hs = headSurf(S, EAR_F + 0.01 + k * L, th * (1 - 0.4 * k), 0.008 + 0.006 * Math.sin(PI * k)), hs2 = headSurf(S, EAR_F + 0.02 + k * L, th * (1 - 0.4 * k), 0.008);
          const sc = [0.9, 1, 0.7, 0.08][j];
          return { p: hs.p, d: vnorm(vsub(hs2.p, hs.p)), up: hs.n, t: 0.008 * sc, b: 0.005 * sc, w: D.hR * 0.2 * sc, n: 2, wt: fw(k) };
        });
        tube(G, ks, { segs: hi ? 4 : 3, step: 1, uv: 'coat', color: cf('mane') });
      });
    }
    // 尾（B 案: 尾根（毛色）＋毛の芯＋外側に広がる細い毛の束。毛先は細くばらける）
    {
      const T = S.TAIL, tw = (u) => { const f = u * 5, i = Math.min(Math.floor(f), 4), t = f - i, w = {}; w['tail' + i] = 1 - t * 0.5; if (i < 4) w['tail' + (i + 1)] = t * 0.5; else w.tail4 = 1; return w; };
      const path = (u) => { const f = clamp(u, 0, 1) * 5, i = Math.min(Math.floor(f), 4), t = f - i; return [lerp(T[i][0], T[i + 1][0], t), lerp(T[i][1], T[i + 1][1], t), 0]; };
      const tan = (u) => vnorm(vsub(path(u + 0.02), path(u - 0.02)));
      // 尾根（毛色の短い筒）
      { const keys = []; for (let i = 0; i <= 4; i++) { const u = -0.02 + 0.2 * i / 4, p = path(u), r = lerp(0.05, 0.038, i / 4); keys.push({ p: vadd(p, [0.01, 0, 0]), d: tan(Math.max(0.01, u)), up: [0, 0, 1], t: r, b: r * 0.95, w: r * 0.9, n: 2, wt: tw(Math.max(0, u)) }); }
        tube(G, keys, { segs: hi ? 10 : 6, step: 1, uv: 'coat', color: cf('trunk') }); }
      // 毛の芯（尾根の少し下から。中ほどで少し広がり、先は細い）
      const R0 = 0.045;
      { const keys = [], N = hi ? 10 : 6; for (let i = 0; i <= N; i++) { const u = 0.06 + 0.92 * i / N, p = path(u), pr = u < 0.4 ? lerp(0.9, 1.25, smooth(0.06, 0.4, u)) : lerp(1.25, 0.1, smooth(0.4, 1, u)); keys.push({ p, d: tan(u), up: [0, 0, 1], t: R0 * pr * 0.8, b: R0 * pr * 0.8, w: R0 * pr * 1.15, n: 2, wt: tw(u) }); }
        tube(G, keys, { segs: hi ? 10 : 6, step: 1, uv: 'coat', color: cf('tail'), bump: (p, n, r) => (r.u > 1 ? R0 * 0.18 * Math.sin(Math.atan2(n[2], n[0]) * 7 + r.u * 0.9) : 0) }); }
      // 外側の毛の束（左右・後ろへ少し広がり、長さをそろえない）
      const NS = hi ? 6 : 4, Rr = seeded(53);
      for (let k = 0; k < NS; k++) {
        const ang = -1.1 + 2.2 * k / (NS - 1), len = 0.88 + 0.14 * Rr(), keys = [], N = hi ? 7 : 4;
        for (let i = 0; i <= N; i++) {
          const u = 0.12 + (len - 0.12) * i / N, p = path(u), d = tan(Math.min(u, 0.99)), side = vnorm(vcross(d, [0, 0, 1])), spread = R0 * (0.7 + 0.9 * smooth(0.1, 0.6, u)) * (1 + 0.15 * Math.sin(u * 13 + k));
          const q = vadd(vadd(p, vsc([0, 0, 1], Math.sin(ang) * spread)), vsc(side, -Math.cos(ang) * spread * 0.6)), pr = lerp(1, 0.08, smooth(0.35, 1, (u - 0.12) / (len - 0.12)));
          keys.push({ p: q, d, up: [0, 0, 1], t: 0.012 * pr, b: 0.012 * pr, w: 0.02 * pr, n: 2, wt: tw(Math.min(u, 1)) });
        }
        tube(G, keys, { segs: hi ? 5 : 3, step: 1, uv: 'coat', color: cf('tail') });
      }
    }
    const g = G.build(); g.userData.cacheKey = key; geoCache[key] = g; return g;
  }

  // ---------------- ゼッケン・腹帯・頭絡・騎手（体型ごとに共有、色の違いは 1 頭ごとのアトラスで） ----------------
  // アトラス（512×512、v は上が 1）: 勝負服の胴 u[0,.5] v[.5,1]、袖 左 u[.5,.75] 右 u[.75,1] v[.5,1]、帽子（枠の色）u[0,.25] v[.25,.5]、白 u[.25,.5] v[0,.25]、ゼッケン u[.5,1] v[0,.5]
  const UV_TORSO = [0.004, 0.502, 0.496, 0.996], UV_SLV = [[0.504, 0.502, 0.746, 0.996], [0.754, 0.502, 0.996, 0.996]], UV_CAP = [0.125, 0.375, 0.125, 0.375], UV_CLOTH = [0.504, 0.004, 0.996, 0.496], UV_WHITE = [0.375, 0.125];
  const TC = { leather: hexRGB("#6b3a1e"), girth: hexRGB('#3b2a20'), ring: hexRGB('#d8c070'), saddle: hexRGB('#2a2220'),
    skin: hexRGB('#f3c9a2'), cheek: hexRGB('#f3a596'), white: hexRGB('#f6f5f2'), boot: hexRGB('#1d1b1e'), cuff: hexRGB('#8a5a32'), glove: hexRGB('#f2f1ee'), eye: hexRGB('#1a1418'), whip: hexRGB('#222'), iron: hexRGB('#b9bdc2') };
  const tackCache = {};
  function tackGeometry(S, q, jockey) {
    const key = S.type + q + (jockey ? 'J' : ''); if (tackCache[key]) return tackCache[key];
    const hi = q === 'high', G = new Geo(S.BI), D = S.D;
    G.det = q === 'far' ? 0.55 : 1;
    const flatUV = UV_WHITE;
    // 胴の面に沿った殻（ゼッケン・鞍）
    const shell = (x0, x1, th0, th1, nu, nv, off, thick, uvRect, col, bulge) => {
      const grid = [];
      for (let i = 0; i <= nu; i++) {
        const row = [], x = lerp(x0, x1, i / nu);
        for (let j = 0; j <= nv; j++) {
          const th = lerp(th0, th1, j / nv), s = trunkSurf(S, x, th, off), bz = bulge ? bulge(i / nu, j / nv) : 0;
          const pIn = s.p, pOut = vadd(s.p, vsc(s.n, thick + bz));
          const uv = uvRect ? [lerp(uvRect[0], uvRect[2], j / nv), lerp(uvRect[1], uvRect[3], i / nu)] : flatUV;
          const cl = toLin(uvRect ? [1, 1, 1] : col);
          row.push([G.vert(pOut, uv, cl, s.wt), G.vert(pIn, uv, cl, s.wt)]);
        }
        grid.push(row);
      }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j + 1], d = grid[i + 1][j];
        G.tri(a[0], b[0], c[0]); G.tri(a[0], c[0], d[0]); G.tri(a[1], c[1], b[1]); G.tri(a[1], d[1], c[1]);
      }
      const edge = (A, B) => { G.tri(A[0], A[1], B[1]); G.tri(A[0], B[1], B[0]); };
      for (let j = 0; j < nv; j++) { edge(grid[0][j + 1], grid[0][j]); edge(grid[nu][j], grid[nu][j + 1]); }
      for (let i = 0; i < nu; i++) { edge(grid[i][0], grid[i + 1][0]); edge(grid[i + 1][nv], grid[i][nv]); }
    };
    const CL = S.cloth, thR = CL.th;
    shell(CL.x0, CL.x1, -thR, thR, hi ? 10 : 5, hi ? 28 : 12, 0.006, 0.012, UV_CLOTH, null);
    // 腹帯（ゼッケンの前寄りで一周）
    {
      const x = CL.x1 - CL.cl * 0.18, pts = [], nrm = [], N = hi ? 28 : 14;
      for (let i = 0; i <= N; i++) { const s = trunkSurf(S, x, lerp(-thR + 0.05, thR - 0.05, i / N) + PI, 0.014); pts.push(s.p); nrm.push(s.n); }
      strap(G, pts, { w: D.R * 0.09, h: 0.006, nrm, col: TC.girth, wt: () => ({ body: 1 }), segs: 4 });
    }
    // 頭絡: 鼻革・頬革（鼻革→耳の後ろ→反対の鼻革）・額革
    {
      const H = { head: 1 }, band = (pairs, w, off) => { const ss = pairs.map(([f, th]) => headSurf(S, f, th, off || 0.008)); strap(G, ss.map((s) => s.p), { w, h: 0.007, nrm: ss.map((s) => s.n), col: TC.leather, wt: () => H, segs: 4 }); };
      const N = hi ? 24 : 12, nose = []; for (let i = 0; i <= N; i++) nose.push([NB_F, lerp(0, TAU, i / N)]);
      band(nose, D.mR * 0.1, 0.006);
      const CP = [[NB_F, 1.62], [0.4, 1.66], [0.24, 1.6], [0.12, 1.3], [0.07, 0.62], [0.055, 0]], cheek = [];
      const cpAt = (k) => { const f = k * (CP.length - 1), i = Math.min(Math.floor(f), CP.length - 2), t = f - i; return [lerp(CP[i][0], CP[i + 1][0], t), lerp(CP[i][1], CP[i + 1][1], t)]; };
      for (let i = 0; i <= N; i++) { const t = i / N, sd = t < 0.5 ? -1 : 1, k = 1 - Math.abs(t - 0.5) * 2, c = cpAt(k); cheek.push([c[0], sd * c[1]]); }
      band(cheek, D.hR * 0.075);
      const brow = []; for (let i = 0; i <= 10; i++) brow.push([0.1, lerp(-1.2, 1.2, i / 10)]); band(brow, D.hR * 0.08);
      // 金具（鼻革と頬革の交わる所＝ハミの輪）
      [-1, 1].forEach((sd) => {
        const c = headSurf(S, NB_F, 1.75 * sd, 0.014), pts = [], nrm = [];
        for (let i = 0; i <= 10; i++) { const a = i / 10 * TAU; pts.push(vadd(c.p, vadd(vsc(c.U, Math.cos(a) * D.mR * 0.14), vsc(c.T, Math.sin(a) * D.mR * 0.14)))); nrm.push(c.n); }
        strap(G, pts, { w: 0.007, h: 0.007, nrm, col: TC.ring, wt: () => H, segs: 4, loop: true });
      });
    }
    if (jockey) jockeyGeometry(S, G, hi, shell);
    const g = G.build(); tackCache[key] = g; return g;
  }
  // 騎手（ちびキャラ: 大きなヘルメット頭、勝負服、白いズボン、黒い長靴）
  function jockeyGeometry(S, G, hi, shell) {
    const D = S.D, JK = S.JK, js = JK.js, CL = S.cloth;
    // 小さな鞍
    shell(CL.x0 + CL.cl * 0.3, CL.x1 - CL.cl * 0.15, -0.8, 0.8, hi ? 6 : 3, hi ? 8 : 4, 0.02, 0.018, null, TC.saddle, (u, v) => 0.02 * smooth(0.6, 1, u) * (1 - Math.abs(v - 0.5) * 1.8));
    const A = (p, r, wt, rw) => ({ p, t: r, b: r, w: r * (rw || 1.05), n: 2, wt });
    // 胴（勝負服）: 尻→腰→胸→襟
    {
      const P = JK.pelvis, W0 = JK.chest, Sc = JK.sc, dir = vnorm(vsub(Sc, W0)), K = [];
      const k = (p, t, b, w, wt, a) => K.push({ p, a, t: t * js, b: b * js, w: w * js, n: 2.2, wt });
      const a1 = Math.atan2(W0[1] - P[1], W0[0] - P[0]) / DEG, a2 = Math.atan2(dir[1], dir[0]) / DEG;
      k(vadd(P, [-0.09 * js, -0.04 * js, 0]), 0.03, 0.03, 0.04, { jpel: 1 }, a1);
      k(vadd(P, [-0.06 * js, -0.02 * js, 0]), 0.09, 0.09, 0.12, { jpel: 1 }, a1);
      k(P, 0.11, 0.11, 0.135, { jpel: 1 }, a1);
      k(W0, 0.115, 0.12, 0.14, { jpel: 0.5, jchest: 0.5 }, (a1 + a2) / 2);
      k(vadd(W0, vsc(dir, 0.18 * js)), 0.12, 0.13, 0.16, { jchest: 1 }, a2);
      k(vadd(Sc, vsc(dir, -0.02 * js)), 0.1, 0.11, 0.165, { jchest: 1 }, a2);
      k(vadd(Sc, vsc(dir, 0.05 * js)), 0.06, 0.06, 0.08, { jchest: 1 }, a2);
      k(vadd(Sc, vsc(dir, 0.07 * js)), 0.015, 0.015, 0.02, { jchest: 1 }, a2);
      tube(G, K, { segs: hi ? 16 : 8, step: hi ? 0.05 : 0.12, uv: UV_TORSO });
    }
    // 頭: 顔（肌）＋ヘルメット（帽子＝枠の色）＋つば＋目
    {
      const c = JK.head, r = JK.hr, H = { jhead: 1 };
      const fk = (dx, t, b, w) => ({ p: [c[0] + dx * r, c[1], 0], a: -5, t: t * r, b: b * r, w: w * r, n: 2, wt: H });
      tube(G, [fk(-1.0, 0.05, 0.05, 0.05), fk(-0.85, 0.55, 0.55, 0.55), fk(-0.4, 0.92, 0.95, 0.93), fk(0.15, 0.96, 1.0, 0.97), fk(0.6, 0.78, 0.86, 0.8), fk(0.9, 0.4, 0.5, 0.45), fk(1.0, 0.05, 0.05, 0.05)],
        { segs: hi ? 16 : 8, step: 0.04, color: (ctx) => { const u = ctx.p[0] - c[0], v = ctx.p[1] - c[1]; return (u > r * 0.55 && Math.abs(v + r * 0.25) < r * 0.12 && Math.abs(Math.abs(ctx.p[2]) - r * 0.35) < r * 0.12) ? TC.cheek : TC.skin; } });
      const hk = (dx, t, b, w, dy) => ({ p: [c[0] + dx * r, c[1] + (dy || 0.12) * r, 0], a: -8, t: t * r, b: b * r, w: w * r, n: 2.05, wt: H });
      tube(G, [hk(-1.08, 0.05, 0.05, 0.05), hk(-0.95, 0.6, 0.35, 0.65), hk(-0.5, 1.0, 0.55, 1.02), hk(0.0, 1.06, 0.5, 1.07), hk(0.45, 0.98, 0.32, 1.0), hk(0.75, 0.75, 0.12, 0.8, 0.22), hk(0.88, 0.1, 0.05, 0.1, 0.3)],
        { segs: hi ? 18 : 10, step: 0.04, uv: UV_CAP });
      tube(G, [{ p: [c[0] + 0.62 * r, c[1] + 0.2 * r, 0], a: -14, t: 0.04 * r, b: 0.04 * r, w: 0.62 * r, wt: H }, { p: [c[0] + 1.12 * r, c[1] + 0.08 * r, 0], a: -14, t: 0.03 * r, b: 0.03 * r, w: 0.5 * r, wt: H }], { segs: 8, step: 1, uv: UV_CAP });
      // 目（黒い楕円＋光）
      [-1, 1].forEach((sd) => {
        const e = [c[0] + 0.88 * r, c[1] - 0.02 * r, sd * 0.34 * r], n = vnorm([0.85, 0.0, sd * 0.45]);
        const ek = (k, sc) => ({ p: vadd(e, vsc(n, k * r)), d: n, up: [0, 1, 0], t: 0.17 * r * sc, b: 0.17 * r * sc, w: 0.1 * r * sc, n: 2, wt: H });
        tube(G, [ek(-0.06, 0.8), ek(0.0, 1), ek(0.04, 0.6), ek(0.05, 0.1)], { segs: 8, step: 1, col: TC.eye });
      });
      // 首
      tube(G, [A(vadd(JK.neck, [-0.03 * js, -0.04 * js, 0]), 0.05 * js, { jchest: 1 }), A(vadd(JK.neck, [0.02 * js, 0.06 * js, 0]), 0.05 * js, { jhead: 1 })], { segs: 8, step: 1, col: TC.skin, capA: false, capB: false });
    }
    // 腕（袖）・手袋・ムチ、脚（白いズボン・長靴）、あぶみ
    [['L', -1], ['R', 1]].forEach(([s, k], si) => {
      const z = (p) => [p[0], p[1], p[2] * k];
      const sh = z(JK.sh), el = z(JK.el), ha = z(JK.hand), wr = vlerp(el, ha, 0.84);
      const ua = 'jua' + s, fa = 'jfa' + s;
      tube(G, [A(vadd(sh, [-0.02 * js, 0.0, -0.04 * k * js]), 0.055 * js, { jchest: 1 }), A(sh, 0.07 * js, { jchest: 0.5, [ua]: 0.5 }), A(vlerp(sh, el, 0.5), 0.062 * js, { [ua]: 1 }), A(el, 0.056 * js, { [ua]: 0.5, [fa]: 0.5 }), A(vlerp(el, wr, 0.5), 0.05 * js, { [fa]: 1 }), A(wr, 0.044 * js, { [fa]: 1 })],
        { segs: hi ? 10 : 6, step: hi ? 0.05 : 0.12, uv: UV_SLV[si], capB: false, up: [0, 1, 0] });
      tube(G, [A(vlerp(el, wr, 0.9), 0.035 * js, { [fa]: 1 }), A(vadd(ha, [-0.02 * js, 0, 0]), 0.05 * js, { [fa]: 1 }), A(vadd(ha, [0.03 * js, -0.01 * js, -0.01 * k]), 0.045 * js, { [fa]: 1 }), A(vadd(ha, [0.06 * js, -0.015 * js, -0.012 * k]), 0.01 * js, { [fa]: 1 })],
        { segs: hi ? 8 : 6, step: 1, col: TC.glove });
      if (k > 0) strap(G, [vadd(ha, [0.05 * js, -0.05 * js, 0]), vadd(ha, [0.0, 0.02 * js, 0]), vadd(ha, [-0.2 * js, 0.2 * js, 0.05 * js]), vadd(ha, [-0.38 * js, 0.36 * js, 0.08 * js])],
        { w: 0.012 * js, h: 0.012 * js, col: TC.whip, wt: () => ({ jfaR: 1 }), segs: 5, upv: [0, 0, 1] });
      const hp = z(JK.hip), kn = z(JK.knee), an = z(JK.ank), to = z(JK.toe), th = 'jth' + s, shn = 'jsh' + s, ft = 'jft' + s;
      tube(G, [A(vadd(hp, [-0.03 * js, 0.02 * js, -0.04 * k * js]), 0.08 * js, { jpel: 1 }), A(hp, 0.09 * js, { jpel: 0.5, [th]: 0.5 }), A(vlerp(hp, kn, 0.5), 0.085 * js, { [th]: 1 }), A(vlerp(hp, kn, 0.88), 0.07 * js, { [th]: 1 }), A(kn, 0.066 * js, { [th]: 0.5, [shn]: 0.5 }), A(vlerp(kn, an, 0.2), 0.058 * js, { [shn]: 1 })],
        { segs: hi ? 10 : 6, step: hi ? 0.05 : 0.12, col: TC.white, capB: false, up: [0, 1, 0] });
      tube(G, [A(vlerp(kn, an, 0.15), 0.064 * js, { [shn]: 1 }), A(vlerp(kn, an, 0.24), 0.064 * js, { [shn]: 1 }), A(vlerp(kn, an, 0.3), 0.06 * js, { [shn]: 1 }), A(vlerp(kn, an, 0.7), 0.056 * js, { [shn]: 1 }), A(an, 0.05 * js, { [shn]: 0.4, [ft]: 0.6 }), A(vadd(an, [0, -0.025 * js, 0]), 0.035 * js, { [ft]: 1 })],
        { segs: hi ? 10 : 6, step: hi ? 0.05 : 0.12, color: (ctx) => (vdot(vsub(ctx.p, kn), vnorm(vsub(an, kn))) < 0.27 * vlen(vsub(an, kn)) ? TC.cuff : TC.boot), up: [1, 0, 0] });
      tube(G, [{ p: vadd(an, [-0.07 * js, -0.01 * js, 0]), a: -4, t: 0.04 * js, b: 0.035 * js, w: 0.04 * js, wt: { [ft]: 1 } }, { p: vadd(an, [0.04 * js, -0.025 * js, 0]), a: -4, t: 0.05 * js, b: 0.035 * js, w: 0.05 * js, wt: { [ft]: 1 } }, { p: vadd(to, [0, -0.01 * js, 0]), a: -4, t: 0.035 * js, b: 0.03 * js, w: 0.045 * js, wt: { [ft]: 1 } }, { p: vadd(to, [0.035 * js, -0.015 * js, 0]), a: -4, t: 0.006, b: 0.006, w: 0.006, wt: { [ft]: 1 } }],
        { segs: hi ? 10 : 6, step: 0.05, col: TC.boot });
      const top = trunkSurf(S, JK.s0[0] + 0.02, 1.0 * k, 0.03).p, iron = vadd(an, [0.03 * js, -0.04 * js, 0]);
      strap(G, [top, vlerp(top, iron, 0.5), iron], { w: 0.014 * js, h: 0.004, upv: [0, 0, k], col: TC.leather, segs: 4, wt: (t) => (t < 0.3 ? { body: 1 } : { body: 1 - (t - 0.3) / 0.7, [ft]: (t - 0.3) / 0.7 }) });
      const ip = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * TAU; ip.push(vadd(iron, [Math.cos(a) * 0.06 * js, Math.sin(a) * 0.04 * js - 0.005, 0])); }
      strap(G, ip, { w: 0.014 * js, h: 0.005, upv: [0, 0, 1], col: TC.iron, segs: 4, loop: true, wt: () => ({ [ft]: 1 }) });
      // 手綱: ハミ→首の横→手（重みを頭→首→手へ）
      const bit = headSurf(S, NB_F, 1.75 * k, 0.02).p, n3 = S.bones[S.BI.neck3].r, n2 = S.bones[S.BI.neck2].r;
      const m1 = [n3[0], n3[1] + D.nR * 0.2, k * D.nR * 1.05], hand = vadd(ha, [0.01, -0.01, -0.01 * k]);
      const pts = [], N = hi ? 12 : 6;
      for (let i = 0; i <= N; i++) { const t = i / N; pts.push(t < 0.45 ? vlerp(bit, m1, t / 0.45) : vlerp(m1, hand, (t - 0.45) / 0.55)); }
      strap(G, pts, { w: 0.012, h: 0.004, upv: [0, 0, 1], col: TC.leather, segs: 4,
        wt: (t) => (t < 0.2 ? { head: 1 } : t < 0.45 ? { head: 1 - (t - 0.2) / 0.25, neck3: (t - 0.2) / 0.25 } : t < 0.8 ? { neck3: 1 - (t - 0.45) / 0.35, ['jrn' + s]: (t - 0.45) / 0.35 } : { ['jrn' + s]: 1 }) });
    });
  }

  // ---------------- テクスチャ・材質 ----------------
  const texCache = {};
  function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  // ぬいぐるみの毛（細かいざらつき＋ゆるいまだら）。平均 0.93 くらいで頂点の色に掛ける
  function furTexture() {
    if (texCache.fur) return texCache.fur;
    // B 案: 短く寝た毛のつや。大きなむらはごく弱く、細かい毛並みの筋（一方向）だけ。平均 0.95 くらい
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d'), R = seeded(77);
    c.fillStyle = 'rgb(242,242,242)'; c.fillRect(0, 0, S, S);
    const wrap = (f) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) f(dx, dy); };
    for (let i = 0; i < 40; i++) { const x = R() * S, y = R() * S, r = 30 + R() * 60, l = R() < 0.5; wrap((dx, dy) => { const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); g.addColorStop(0, l ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.03)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x + dx - r, y + dy - r, r * 2, r * 2); }); }
    c.lineCap = 'round';
    for (let i = 0; i < 2600; i++) { const x = R() * S, y = R() * S, a = 1.35 + (R() - 0.5) * 0.25, L = 3 + R() * 5; c.strokeStyle = R() < 0.5 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.04)'; c.lineWidth = 0.8; wrap((dx, dy) => { c.beginPath(); c.moveTo(x + dx, y + dy); c.lineTo(x + dx + Math.cos(a) * L, y + dy + Math.sin(a) * L); c.stroke(); }); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    texCache.fur = t; return t;
  }
  // 縁が明るいぬいぐるみ風（velvet）の光を足す
  function addRim(m, k) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rimK = { value: k };
      sh.fragmentShader = 'uniform float rimK;\n' + sh.fragmentShader.replace('#include <output_fragment>',
        'float rimF = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );\noutgoingLight += diffuseColor.rgb * rimK * pow( rimF, 2.2 );\n#include <output_fragment>');
    };
    m.customProgramCacheKey = () => 'realRim' + k;
  }
  const matCache = {};
  // 毛の材質: テクスチャは三方向から投影して混ぜる（休みの姿勢の位置で。継ぎ目や鼻先の渦が出ない）＋縁の明るさ
  function coatMaterial() {
    if (matCache.coat) return matCache.coat;
    if (R3D.xlite) { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.name = "horseFurLite"; matCache.coat = m; return m; } // テレビの画質「さらになめらか（最軽量）」（2026-10-28）: 毛の模様・つや・縁の明るさなしの軽い材質
    const m = new THREE.MeshStandardMaterial({ map: furTexture(), vertexColors: true, roughness: 0.5, metalness: 0.0 }); // B 案: 短い毛のつや（ぬいぐるみの 0.86 より滑らか）
    m.onBeforeCompile = (sh) => {
      sh.uniforms.rimK = { value: 0.1 }; sh.uniforms.triS = { value: 1 / TILE };
      sh.vertexShader = "varying vec3 vTriP; varying vec3 vTriN;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvTriP = position; vTriN = normal;");
      sh.fragmentShader = "uniform float rimK; uniform float triS; varying vec3 vTriP; varying vec3 vTriN;\n" + sh.fragmentShader
        .replace("#include <map_fragment>", "vec3 tw = pow( abs( normalize( vTriN ) ), vec3( 4.0 ) ); tw /= ( tw.x + tw.y + tw.z );\nvec4 txc = texture2D( map, vTriP.zy * triS ) * tw.x + texture2D( map, vTriP.xz * triS ) * tw.y + texture2D( map, vTriP.xy * triS ) * tw.z;\nfloat eyeK = step( vUv.x, -0.5 ), hlK = step( vUv.x, -2.0 );\ndiffuseColor *= mix( txc, vec4( 1.0 ), eyeK );")
        // 目（uv の印 -1）はつやつや（粗さ 0.22。鏡面の光が動く）、光の点（-3）は影でも白（キャッチライト）
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.22, eyeK );")
        .replace("#include <output_fragment>", "float rimF = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );\noutgoingLight += diffuseColor.rgb * rimK * pow( rimF, 2.2 ) * ( 1.0 - eyeK );\noutgoingLight = mix( outgoingLight, vec3( 1.9 ), hlK );\n#include <output_fragment>");
    };
    m.customProgramCacheKey = () => "horseRealCoat1";
    m.name = "horseFur"; matCache.coat = m; return m;
  }
  // 輪郭線: 裏返しの殻を画面上で一定の太さ（px）だけ外へ押し出す。色は頂点の色を暗くしたもの
  const outlineU = { olW: { value: 0.016 }, olMin: { value: 0.6 }, olMax: { value: 2.0 }, olView: { value: new THREE.Vector2(1280, 720) } };
  function outlineMaterial() {
    if (matCache.outline) return matCache.outline;
    const m = new THREE.MeshBasicMaterial({ color: 0x3a2a26, vertexColors: true, side: THREE.BackSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, outlineU);
      sh.vertexShader = 'uniform float olW; uniform float olMin; uniform float olMax; uniform vec2 olView;\n' + sh.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n' +
        '{ vec3 nV = normalize( normalMatrix * objectNormal ); vec4 nC = projectionMatrix * vec4( nV, 0.0 );\n' +
        '  float px = clamp( olW * projectionMatrix[1][1] * 0.5 * olView.y / max( gl_Position.w, 0.01 ), olMin, olMax );\n' +
        '  vec2 dir = normalize( nC.xy + vec2( 1e-5 ) ); gl_Position.xy += dir * px * 2.0 / olView * gl_Position.w; }');
    };
    m.customProgramCacheKey = () => 'horseRealOutline';
    m.name = 'horseRealOutline'; matCache.outline = m; return m;
  }
  // 星の形
  function starPath(c, x, y, r) { c.beginPath(); for (let i = 0; i < 10; i++) { const a = i * PI / 5 - PI / 2, rr = i % 2 ? r * 0.42 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); }
  // 1 頭ごとのアトラス: 勝負服（7 柄）・袖・帽子（枠の色）・ゼッケン（枠の色に馬番）・白
  function atlasTexture(h) {
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
    const silk = h.silk || { base: '#d32f2f', accent: '#ffffff', pattern: 'solid' }, B = silk.base, A = silk.accent, pat = silk.pattern;
    const R = seeded((h.no || 1) * 131 + 7);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
    // 胴: 横＝ぐるり（0 胸, .25 左脇, .5 背中, .75 右脇, 1 胸）、縦＝上が襟、下が腰
    const tw = 256, th = 256;
    c.save(); c.beginPath(); c.rect(0, 0, tw, th); c.clip();
    c.fillStyle = B; c.fillRect(0, 0, tw, th); c.fillStyle = A;
    if (pat === 'sash') { for (const ox of [-tw, 0, tw]) { c.beginPath(); c.moveTo(ox + tw * 0.16, 0); c.lineTo(ox + tw * 0.4, 0); c.lineTo(ox + tw * 0.94, th); c.lineTo(ox + tw * 0.7, th); c.closePath(); c.fill(); } }
    else if (pat === 'stripes') { for (let i = 0; i < 12; i += 2) c.fillRect(i * tw / 12, 0, tw / 12, th); }
    else if (pat === 'hoops') { for (let i = 0; i < 3; i++) c.fillRect(0, th * (0.18 + i * 0.28), tw, th * 0.14); }
    else if (pat === 'star') { [[0.5, 0.5, 50], [0.0, 0.48, 38], [1.0, 0.48, 38], [0.25, 0.45, 30], [0.75, 0.45, 30]].forEach(([u, v, r]) => { starPath(c, u * tw, v * th, r); c.fill(); }); }
    else if (pat === 'diamond') { for (let i = 0; i < 4; i++) { const x = i * 0.25 * tw; for (const ox of [0, tw]) { c.beginPath(); c.moveTo(x + ox, th * 0.15); c.lineTo(x + ox + tw * 0.1, th * 0.5); c.lineTo(x + ox, th * 0.85); c.lineTo(x + ox - tw * 0.1, th * 0.5); c.closePath(); c.fill(); } } }
    else if (pat === 'halves') c.fillRect(tw * 0.5, 0, tw * 0.5, th);
    c.fillStyle = pat === 'solid' ? A : B; c.fillRect(0, 0, tw, th * 0.06);   // 襟
    for (let i = 0; i < 18; i++) { // 生地のしわ
      const x = R() * tw, w = 8 + R() * 18, g = c.createLinearGradient(x - w, 0, x + w, 0), dk = R() < 0.5;
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, dk ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(x - w, 0, w * 2, th);
    }
    c.restore();
    // 袖（左右）: 横＝ぐるり、縦＝上が肩
    [0, 1].forEach((i) => {
      const x0 = 256 + i * 128, w = 128, hh = 256;
      c.save(); c.beginPath(); c.rect(x0, 0, w, hh); c.clip();
      let col = B; if (pat === 'stripes' || pat === 'star' || pat === 'sash') col = A; if (pat === 'halves') col = i === 0 ? B : A;
      const other = col === B ? A : B;
      c.fillStyle = col; c.fillRect(x0, 0, w, hh); c.fillStyle = other;
      if (pat === 'hoops' || pat === 'diamond') for (let k = 0; k < 3; k++) c.fillRect(x0, hh * (0.15 + k * 0.27), w, hh * 0.12);
      if (pat === 'star') for (let k = 0; k < 3; k++) { starPath(c, x0 + w * 0.5, hh * (0.2 + k * 0.3), 22); c.fillStyle = B; c.fill(); }
      c.fillStyle = pat === 'solid' ? A : other; c.fillRect(x0, hh * 0.88, w, hh * 0.12);   // 袖口
      c.restore();
    });
    // 帽子（枠の色）
    c.fillStyle = h.color || B; c.fillRect(0, 256, 128, 128);
    // ゼッケン: 枠色の角の丸い四角に白い馬番（白枠だけ黒字、黄色は黒い縁取り）、縁に細い白線。横＝ぐるり（左の裾→背→右の裾）、縦＝上が前。角の外は透明（alphaTest）
    {
      const x0 = 256, y0 = 256, W = 256, H = 256, bg = h.color || "#f4f4f4";
      const n = parseInt(bg.slice(1), 16), lum = ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11;
      c.clearRect(x0, y0, W, H);
      const rr = (x, y, w, hh, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
      rr(x0 + 4, y0 + 4, W - 8, H - 8, 44); c.fillStyle = bg; c.fill();
      rr(x0 + 13, y0 + 13, W - 26, H - 26, 36); c.strokeStyle = lum > 230 ? "#c8c8c8" : "rgba(255,255,255,.95)"; c.lineWidth = 4; c.stroke();
      if (lum > 230) { rr(x0 + 4, y0 + 4, W - 8, H - 8, 44); c.strokeStyle = "#bdbdbd"; c.lineWidth = 3; c.stroke(); }
      const num = String(h.no || 1);
      [[-1, x0 + W * 0.21], [1, x0 + W * 0.79]].forEach(([sd, x]) => {
        c.save(); c.translate(x, y0 + H * 0.52); c.rotate(sd > 0 ? -PI / 2 : PI / 2);
        c.textAlign = "center"; c.textBaseline = "middle"; c.font = "900 " + (num.length > 1 ? 74 : 100) + "px \"Noto Sans JP\", \"Hiragino Sans\", sans-serif"; // 2026-10-21 Noto Sans JP に統一
        if (lum > 230) { c.fillStyle = "#222"; c.fillText(num, 0, 4); }
        else { if (lum > 150) { c.lineWidth = 9; c.strokeStyle = "#3a2a10"; c.lineJoin = "round"; c.strokeText(num, 0, 4); } c.fillStyle = "#fff"; c.fillText(num, 0, 4); }
        c.restore();
      });
    }
    // 白（単色の部品が使う）
    c.fillStyle = '#ffffff'; c.fillRect(128, 384, 128, 128);
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  // 足元の薄い影
  let blobGeo = null, blobMat = null;
  function blob(S) {
    if (!blobMat) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d');
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(0.5, 'rgba(0,0,0,.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
      blobGeo = new THREE.PlaneGeometry(1, 1); blobGeo.rotateX(-PI / 2);
      blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    const m = new THREE.Mesh(blobGeo, blobMat); m.scale.set(S.D.L * 1.5, 1, S.D.W * 3.0); m.position.set(0, 0.012, 0); m.renderOrder = 1; m.name = 'blob'; return m;
  }

  // ---------------- 足元の枠色の輪（STYLE 5: 前後に馬番、進む向きに三角。真上から見分ける目印） ----------------
  let ringGeo = null;
  function drawRing(cv, h, strong, gold) {   // gold: 確定演出 eye の間、外側のふちを金色に（ringGlow と合わせて光って見える）
    const S = cv.width, c = cv.getContext('2d'), m = S / 2, r = S * 0.4;
    c.clearRect(0, 0, S, S);
    // 接地の影（講評 v2-1 の 2）: 胴の真下にぼかした楕円。輪が出ている間はぼかした丸（blob）を描かないので、その代わり（描く回数は増えない。影の無い ?q=tv でも馬が浮かない）
    const sh = cv.userData && cv.userData.contact;
    if (sh) {
      c.save(); c.translate(sh.cx, m); c.scale(1, sh.rz / sh.rx);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, sh.rx); g.addColorStop(0, 'rgba(20,18,14,.34)'); g.addColorStop(0.55, 'rgba(20,18,14,.2)'); g.addColorStop(1, 'rgba(20,18,14,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, sh.rx, 0, TAU); c.fill(); c.restore();
    }
    const col = h.color || '#f4f4f4', n = parseInt(col.slice(1), 16), lum = ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11;
    const lw = S * (strong ? 0.075 : 0.05);
    // 外側の白いふち（光って見える）→ 枠色の輪
    c.beginPath(); c.arc(m, m, r, 0, TAU); c.strokeStyle = gold ? '#ffd457' : strong ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.7)'; c.lineWidth = lw + S * (gold ? 0.045 : 0.018); c.stroke();
    c.beginPath(); c.arc(m, m, r, 0, TAU); c.strokeStyle = lum > 230 ? '#e9e9e9' : col; c.lineWidth = lw; c.stroke();
    if (lum > 230) { c.beginPath(); c.arc(m, m, r, 0, TAU); c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 2; c.stroke(); }
    // 進む向き（キャンバスの右＝馬の前）に三角
    c.beginPath(); c.moveTo(m + r + S * 0.085, m); c.lineTo(m + r + S * 0.02, m - S * 0.045); c.lineTo(m + r + S * 0.02, m + S * 0.045); c.closePath();
    c.fillStyle = lum > 230 ? '#ffffff' : col; c.fill(); c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 3; c.stroke();
    // 馬番は輪とは別の札（makeBadges）。輪が混んで縮んでも馬番の大きさは変わらない
  }
  /* 足元の馬番の札（輪の前と後ろ。2026-10-13 オーナー「数字をもう少し大きく」）: テロップの丸と同じ枠色の地に h.ink の数字、
     白いふち＋細い黒の線で芝・ダートの上でも読める。直径 0.86m（前の輪の中の馬番は約 0.31m）、数字は札の 53% の高さ。
     地面から 40 度起こした板（下の縁が地面）で、向きは統合側（race3d.js の fitRings）が毎コマ「カメラの方を向く」よう回す
     （横からの追い・ゴール板の横でも つぶれずに正立して読める。1600×900 の横からの追いで数字の高さ 約 22px 以上）。
     札ごとに材質を分けて（模様は共通）、混んで画面で重なる札は統合側が薄くする。何もしなければ馬の前を向く */
  let badgeGeo = null;
  const BADGE_D = 0.86, BADGE_TILT = 40 * DEG; // 札の直径（m）、地面から起こす角度
  function makeBadges(S, h, rad) {
    if (!badgeGeo) { badgeGeo = new THREE.PlaneGeometry(1, 1); badgeGeo.rotateX(-PI / 2); }
    const N = 128, cv = document.createElement('canvas'); cv.width = cv.height = N;
    drawBadge(cv, h, false);
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
    return badgeMeshes(S, h, rad, cv, tex);
  }
  // 馬番の札の絵。gold: 確定演出 eye の間、白いふちを金色に（いちばん外の線も金色）
  function drawBadge(cv, h, gold) {
    const N = cv.width, c = cv.getContext('2d'), m = N / 2; c.clearRect(0, 0, N, N);
    const col = h.color || '#f4f4f4', ink = h.ink || '#000000', num = String(h.no || 1);
    c.beginPath(); c.arc(m, m, N * 0.48, 0, TAU); c.fillStyle = gold ? '#e0a400' : 'rgba(20,20,20,.75)'; c.fill();           // 細い黒の線（いちばん外）
    c.beginPath(); c.arc(m, m, N * 0.455, 0, TAU); c.fillStyle = gold ? '#ffd457' : '#ffffff'; c.fill();                       // 白いふち
    c.beginPath(); c.arc(m, m, N * 0.39, 0, TAU); c.fillStyle = col; c.fill();                              // 枠色の地
    c.lineWidth = N * 0.012; c.strokeStyle = 'rgba(0,0,0,.35)'; c.stroke();
    c.font = '900 ' + Math.round(N * (num.length > 1 ? 0.5 : 0.74)) + 'px "Noto Sans JP", "Hiragino Sans", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const dark = parseInt(ink.slice(1), 16) < 0x808080;
    c.lineJoin = 'round'; c.lineWidth = N * 0.05; c.strokeStyle = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.55)'; c.strokeText(num, m, m + N * 0.03);
    c.fillStyle = ink; c.fillText(num, m, m + N * 0.03);
  }
  function badgeMeshes(S, h, rad, cv, tex) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const g = new THREE.Group(); g.name = 'ringBadges';
    const lift = 0.5 * BADGE_D * Math.sin(BADGE_TILT) + 0.02; // 起こしても下の縁が地面に着く高さ
    [1, -1].forEach((sg) => {
      const b = new THREE.Mesh(badgeGeo, sg > 0 ? mat : mat.clone()); b.scale.set(BADGE_D, 1, BADGE_D); b.position.set(S.midX + sg * rad, lift, 0);
      b.rotation.order = 'YXZ'; b.rotation.set(BADGE_TILT, -PI / 2, 0); b.renderOrder = 3; b.userData.sg = sg; g.add(b); // 先に起こし（x）、それから向き（y）
    });
    g.userData = { cv, tex, mat, mats: g.children.map((b) => b.material), midX: S.midX, rad, d: BADGE_D, tilt: BADGE_TILT };
    return g;
  }
  function makeRing(S, h) {
    if (!ringGeo) { ringGeo = new THREE.PlaneGeometry(1, 1); ringGeo.rotateX(-PI / 2); }
    // B 案: 体が長い（2.5m）が、輪は足元（蹄の範囲）を囲めば足りるので今の馬（ノマール）と同じ大きさまで（輪・馬番の札の並びと重なり方が今と同じ＝描く回数が増えない）
    const rad = Math.max(0.85, Math.min(1.08, 0.5 * S.lenAll)), size = rad / 0.4, ppm = 256 / size;   // 輪の板 1m あたりの画素
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    cv.userData = { contact: { cx: 128 - S.midX * ppm, rx: S.D.L * 0.66 * ppm, rz: S.D.W * 1.35 * ppm } };   // 接地の影（胴の真下＝馬の原点。輪の中心は midX）
    drawRing(cv, h, false);
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.scale.set(size, 1, size); mesh.position.set(S.midX, 0.025, 0); mesh.renderOrder = 2; mesh.name = 'ring';
    mesh.userData = { cv, tex, mat, h, badges: makeBadges(S, h, rad) };
    return mesh;
  }

  // ---------------- 土煙（STYLE 2-2: 蹄の後ろに白っぽいもこもこ）。全馬で 1 つの InstancedMesh（1 描画） ----------------
  const DUST_PER = 12, DUST_MAX = 12 * DUST_PER;   // 1 頭 12 粒（講評 r2 の 6: 量を約 1.35 倍・小さめの粒が 0.35〜0.55 秒で消える）
  const dustSystems = new WeakMap();
  function dustSystem(scene) {
    let sys = dustSystems.get(scene); if (sys) return sys;
    const geo = new THREE.IcosahedronGeometry(1, R3D.tv ? 0 : 1);   // Fire TV 向け（R3D.tv）は粗い粒
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });   // 1 粒は薄く（重なると濃く見える）
    const mesh = new THREE.InstancedMesh(geo, mat, DUST_MAX); mesh.name = 'horseDust'; mesh.frustumCulled = false; mesh.renderOrder = 3;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < DUST_MAX; i++) { mesh.setMatrixAt(i, zero); mesh.setColorAt(i, new THREE.Color(1, 1, 1)); }
    scene.add(mesh);
    sys = { mesh, used: new Array(DUST_MAX / DUST_PER).fill(false), users: 0 };
    sys.alloc = () => { const k = sys.used.indexOf(false); if (k < 0) return -1; sys.used[k] = true; sys.users++; return k; };
    sys.free = (k) => { if (k < 0) return; sys.used[k] = false; sys.users--; for (let i = 0; i < DUST_PER; i++) mesh.setMatrixAt(k * DUST_PER + i, zero); mesh.instanceMatrix.needsUpdate = true; if (sys.users <= 0) { scene.remove(mesh); geo.dispose(); mat.dispose(); dustSystems.delete(scene); } };
    dustSystems.set(scene, sys); return sys;
  }
  const DUST_COL = { turf: new THREE.Color('#e8efe0'), dirt: new THREE.Color('#d8c3a5') };

  // ---------------- ニンジンの加速（STYLE 2-3: 青紫の炎の光＋残像） ----------------
  const boostU = { bT: { value: 0 } };
  function auraMaterial(ghost) {
    const m = new THREE.MeshBasicMaterial({ color: ghost ? 0x8a6cff : 0x6a6cff, transparent: true, depthWrite: false, toneMapped: false });
    m.userData.k = { value: 0 };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.bT = boostU.bT; sh.uniforms.bK = m.userData.k;
      sh.vertexShader = 'uniform float bT; uniform float bK; varying float vRim; varying float vH;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', ghost ? '#include <begin_vertex>' :
          '#include <begin_vertex>\nfloat fl = sin( position.y * 9.0 - bT * 11.0 + position.x * 5.0 ) * 0.5 + 0.5;\ntransformed += objectNormal * ( 0.035 + 0.06 * fl * bK ) + vec3( 0.0, 0.05 * fl * bK, 0.0 );')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvec3 nV = normalize( normalMatrix * objectNormal ); vRim = 1.0 - abs( dot( nV, normalize( -mvPosition.xyz ) ) ); vH = position.y;');
      sh.fragmentShader = 'uniform float bT; uniform float bK; varying float vRim; varying float vH;\n' + sh.fragmentShader.replace('#include <output_fragment>',
        '#include <output_fragment>\nvec3 cA = vec3( 0.1, 0.15, 1.0 ), cB = vec3( 0.45, 0.2, 1.0 );\ngl_FragColor.rgb = mix( cA, cB, clamp( vH * 0.7, 0.0, 1.0 ) ) * ' + (ghost ? '0.9' : '1.0') + ' + vec3( 0.25 ) * pow( vRim, 3.0 );\ngl_FragColor.a = bK * ' + (ghost ? '( 0.22 + 0.3 * vRim )' : 'clamp( pow( vRim, 1.3 ) * ( 0.8 + 0.3 * sin( bT * 17.0 + vH * 13.0 ) ), 0.0, 0.9 )') + ';');
    };
    m.customProgramCacheKey = () => 'horseRealAura' + (ghost ? 'G' : 'A');
    return m;
  }

  // ---------------- 歩き方 ----------------
  // 脚の順: 0 LF, 1 RF, 2 LH, 3 RH。off＝着地する時刻（1 完歩 0〜1）
  const GAIT = {
    gallop: { off: [0.37, 0.26, 0.11, 0.0], lift: [0.5, 0.5, 0.4, 0.4], fold: [1.2, 1.2, 1.0, 1.0] },   // B 案: つなぎの折りたたみは本物くらい（アニメ調の 1.8 は蹄が前へはね返って見えた）   // 本物の襲歩（左手前）: 右後→左後→右前→左前と続けて着き、そのあと脚を体の下に集めて 1 回だけ宙に浮く
    canter: { off: [0.56, 0.30, 0.27, 0.0], lift: [0.42, 0.42, 0.32, 0.32], fold: [1.3, 1.3, 1.0, 1.0] },
    trot: { off: [0.0, 0.5, 0.5, 0.0], lift: [0.34, 0.34, 0.26, 0.26], fold: [1.7, 1.7, 1.2, 1.2] },   // 速歩（対角の 2 本ずつ）。ゴール後に流すときなど（統合側の canter が遅いとき・walk が速いときに内部で使う）
    walk: { off: [0.25, 0.75, 0.0, 0.5], lift: [0.22, 0.22, 0.16, 0.16], fold: [1.3, 1.3, 1.0, 1.0] },
    stand: { off: [0, 0, 0, 0], lift: [0, 0, 0, 0], fold: [0, 0, 0, 0] },
    rear: { off: [0, 0, 0, 0], lift: [0, 0, 0, 0], fold: [0, 0, 0, 0] },   // おまけ: 後ろ脚で立ち上がる（勝ち馬の喜び）
  };
  const DEF_SPEED = { gallop: 16, canter: 7, trot: 3.8, walk: 1.7, stand: 0, rear: 0 };
  // 歩き方の数字: f＝1 秒あたりの完歩数、duty＝1 本の脚が地面に着いている割合、sweep＝着地中に蹄が（体に対して）後ろへ動く距離。
  // 滑らない約束: sweep＝速さ×着地の時間（v×duty÷f）。こうすると着地中の蹄は地面に対して止まる（歩幅×歩数＝速さ）。
  // 脚が届かない（sweep が脚の長さを超える）ときは、着地の時間を短くし、それでも足りなければ歩数を増やす。
  // 駈歩・速歩・常歩の完歩数は体型ごとの D.sf（STYLE 2-1）、襲歩は下の GF。k＝追い・加速で体を伸ばす量（0〜1）
  // 襲歩の 1 秒あたりの完歩数（レースの最高速 18m/秒のとき。1 完歩 チビィ 0.45・ノマール 0.49・ノッポン 0.55・ヨコヅナ 0.50 秒。ChatGPT 講評 r3 の 3: 0.45〜0.6 秒）
  const GF = { real: 2.1, nige: 2.2, senko: 2.05, sashi: 1.82, oikomi: 2.0 };
  // fm: 1 頭ごとのリズムの違い（＋ほかの馬と同じ周期にならないためのずらし）。速いと着地の長さは脚の届く範囲（maxS÷速さ）で決まるので、fm を変えても蹄は滑らない
  function gaitParams(S, g, v, k, fm) {
    if (g === 'stand' || g === 'rear') return { f: 0, duty: 1, sweep: 0 };
    const L = S.legLen, D = S.D; k = k || 0; v = Math.max(0, v); fm = fm || 1;
    let f, duty, maxS, dmin;
    if (g === 'gallop') { f = (GF[S.type] || 2.05) * Math.pow(Math.max(v, 4) / 18, 0.25) * (1 + 0.04 * k) * fm; duty = clamp(0.24 + (16 - v) * 0.008, 0.2, 0.34); maxS = 0.84 * L * (1 + 0.1 * k); dmin = 0.045; }
    else if (g === 'canter') { f = D.sf * 0.72 * Math.pow(Math.max(v, 2) / 7, 0.3) * fm; duty = 0.38; maxS = 0.8 * L; dmin = 0.2; }
    else if (g === 'trot') { f = 1.5 * (D.sf / 2.5) * Math.pow(Math.max(v, 1.5) / 4, 0.35); duty = 0.42; maxS = 0.75 * L; dmin = 0.3; }
    else { f = 0.92 * Math.pow(Math.max(v, 0.4) / 1.7, 0.5) * (D.sf / 2.5); duty = 0.62; maxS = 0.7 * L; dmin = 0.5; }
    if (v * duty / f > maxS) { duty = Math.max(dmin, maxS * f / v); if (v * duty / f > maxS) f = v * duty / maxS; }
    return { f, duty, sweep: v * duty / f };
  }

  // 襲歩の胴・首・頭の動き（周期の位置 → 値。間はなめらかにつなぐ。0〜0.45 で 4 本が着き、そのあと 1 回だけ宙に浮く）
  const KG = {
    bob: [[0.0, -0.4], [0.17, -1], [0.3, -0.75], [0.42, -0.8], [0.54, -0.05], [0.66, 0.65], [0.8, 1], [0.92, 0.3]], // 上下（−1〜1）。前脚が離れる 0.45 まで低いまま（後ろへ蹴る前脚が地面に届く）
    pitch: [[0.0, 0.055], [0.1, 0.065], [0.24, -0.02], [0.36, -0.07], [0.5, -0.035], [0.72, 0.015], [0.9, 0.045]], // 前後の傾き（rad、＋＝前が上）
    neck: [[0.02, 0.09], [0.2, 0.0], [0.38, -0.11], [0.56, -0.04], [0.8, 0.07]],                                  // 首（＋＝上げる）
    head: [[0.05, -0.03], [0.38, 0.05], [0.7, 0.0]],
  };
  function cycK(K, ph) {
    const n = K.length; let i = n - 1; for (let k = 0; k < n; k++) if (K[k][0] <= ph) i = k;
    const a = K[i], b = K[(i + 1) % n], span = frac(b[0] - a[0]) || 1, u = frac(ph - a[0]) / span;
    return lerp(a[1], b[1], 0.5 - 0.5 * Math.cos(PI * clamp(u, 0, 1)));
  }
  // 1 つの歩き方での姿勢（数値の集まり）
  let REAR_AMP = 0;   // 立ち上がる高さ（rad。0 なら勝ち馬の喜びの 0.85）。update が state.rearAmp から入れる（確定演出 gateLate の小さな立ち上がり）。降りてくる間（前の歩き方が rear）は前の値のまま＝途中で高さが変わって蹄が飛ばない
  function gaitPose(S, g, ph, v, t, idle, GP, kS) {
    GP = GP || gaitParams(S, g, v, kS); kS = kS || 0;
    const G = GAIT[g], duty = GP.duty, P = { legs: [] }, D = S.D, bob = D.bob, sc = S.legLen / 1.0;
    const tau = (x) => TAU * x;
    if (g === 'gallop') {
      // 胴: 4 本が続けて着くあいだ（周期 0〜0.45）に沈み、宙に浮くあいだ（0.5〜1）に上がる（上下の幅＝き甲の高さの約 4%）。
      // 後ろ脚が着くあいだは尻が下がって前が上がり、前脚が着くあいだは前が下がる（蹄が地面に届く＝滑らない）。首と頭は前脚が着くところで一番低い
      // 遅い襲歩（着地が長い）では前脚が離れるのが 0.45 より後になるので、胴の動きの周期を着地の終わり E に合わせて伸ばす（離れる前に胴が上がって前脚が届かなくなるのを防ぐ）
      const E = clamp(0.37 + duty, 0.45, 0.62), pk = ph < E ? ph * 0.45 / E : 0.45 + (ph - E) * 0.55 / (1 - E);
      const W = S.yb + D.R, bA = W * (0.0112 + 0.0005 * (bob - 1));
      P.bob = bA * cycK(KG.bob, pk) - 0.012 * sc; P.pitch = cycK(KG.pitch, pk) * (0.66 + 0.06 * bob); P.flex = 0.06 * Math.sin(tau(ph - 0.05));
      P.neck = -0.06 + cycK(KG.neck, pk); P.head = 0.04 + cycK(KG.head, pk);
      P.squash = D.sq * 0.02 * Math.cos(tau(ph - 0.2)); P.surge = 0.025 * Math.sin(tau(ph - 0.05));
      P.tail = 0.2; P.tailAmp = 0.18; P.ear = -0.35;
      P.jUp = 0; P.jFollow = 0.45; P.jBob = 0.012 * Math.cos(tau(ph - 0.23)); P.jRock = 0.035 * Math.sin(tau(ph - 0.88)); P.pump = 0.045 * Math.sin(tau(ph - 0.01));
    } else if (g === 'canter') {
      P.bob = 0.06 * bob * sc * Math.cos(tau(ph - 0.85)) - 0.01 * sc; P.pitch = -0.08 * Math.sin(tau(ph - 0.42)); P.flex = 0.05 * Math.sin(tau(ph - 0.6));
      P.neck = 0.02 - 0.1 * Math.sin(tau(ph - 0.67)); P.head = -0.02 + 0.06 * Math.sin(tau(ph - 0.67)); P.surge = 0.02 * Math.sin(tau(ph - 0.3));
      P.tail = -0.1; P.tailAmp = 0.15; P.ear = -0.15;
      P.jUp = 0.35; P.jFollow = 0.5; P.jBob = 0.02 * Math.cos(tau(ph - 0.85)); P.jRock = 0.04 * Math.sin(tau(ph - 0.55)); P.pump = 0.03 * Math.sin(tau(ph - 0.7));
    } else if (g === 'trot') {
      P.bob = 0.035 * bob * sc * Math.cos(tau(ph * 2 - 0.92)) - 0.01 * sc; P.pitch = 0.015 * Math.sin(tau(ph * 2)); P.flex = 0.02 * Math.sin(tau(ph * 2 - 0.3));
      P.neck = 0.07 + 0.05 * Math.sin(tau(ph * 2 - 0.3)); P.head = -0.06 - 0.03 * Math.sin(tau(ph * 2 - 0.3)); P.surge = 0.01 * Math.sin(tau(ph * 2));
      P.tail = -0.35; P.tailAmp = 0.12; P.ear = 0.05;
      P.jUp = 0.6; P.jFollow = 0.6; P.jBob = 0.015 * Math.cos(tau(ph * 2 - 0.1)); P.jRock = 0.02 * Math.sin(tau(ph * 2)); P.pump = 0.02 * Math.sin(tau(ph * 2));
    } else if (g === 'walk') {
      P.bob = 0.025 * bob * sc * Math.cos(tau(ph * 2 - 0.1)); P.pitch = 0.02 * Math.sin(tau(ph * 2)); P.flex = 0.02 * Math.sin(tau(ph));
      P.neck = 0.1 + 0.06 * Math.sin(tau(ph * 2 - 0.2)); P.head = -0.1 - 0.04 * Math.sin(tau(ph * 2 - 0.2)); P.surge = 0;
      P.tail = -0.55; P.tailAmp = 0.1; P.ear = 0.1 * Math.sin(t * 0.7);
      P.jUp = 1; P.jFollow = 0.75; P.jBob = 0.008 * Math.cos(tau(ph * 2)); P.jRock = 0.015 * Math.sin(tau(ph * 2)); P.pump = 0.015 * Math.sin(tau(ph * 2));
    } else if (g === "rear") {
      // 後ろの蹄の上に腰が来るように胴を回して持ち上げる
      const amp = REAR_AMP > 0 ? REAR_AMP : 0.85, a = amp + 0.07 * Math.sin(t * 3.2), pv = S.bones[S.BI.body].r, H = S.HJ.H, c = Math.cos(a), s = Math.sin(a);
      const hx = pv[0] + c * (H[0] - pv[0]) - s * (H[1] - pv[1]), hy = pv[1] + s * (H[0] - pv[0]) + c * (H[1] - pv[1]);
      P.pitch = a; P.surge = S.HJ.C[0] + 0.1 - hx; P.bob = (H[1] - S.HJ.C[1]) * 0.86 + S.HJ.C[1] - hy; P.flex = -0.15;
      P.neck = -0.25 * amp / 0.85 + 0.06 * Math.sin(t * 3.2 + 1); P.head = -0.45 * amp / 0.85; P.tail = -0.9; P.tailAmp = 0.12; P.ear = 0.15;
      P.jUp = 0.7; P.jFollow = 1; P.jBob = 0; P.jRock = -0.05; P.pump = 0;
      P.rear = { a, c, s, pv, k: Math.min(1, amp / 0.85) };   // k: 立ち上がりの高さの割合（小さい立ち上がりでは前脚を折りたたまず、蹄を地面の近くに＝降りるときに飛ばない）
    } else {
      const br = Math.sin(t * 1.6);
      P.breath = 0.015 * Math.sin(t * 2.4);
      P.bob = 0.006 * br; P.pitch = 0; P.flex = 0; P.neck = 0.12 + 0.04 * Math.sin(t * 0.37) + 0.02 * Math.sin(t * 0.9); P.head = -0.12 + 0.05 * Math.sin(t * 0.53); P.surge = 0;
      P.tail = -0.7; P.tailAmp = 0.05; P.ear = 0.15 * Math.sin(t * 0.45) + 0.2 * Math.max(0, Math.sin(t * 0.23)) ** 6;
      P.jUp = 1; P.jFollow = 0.85; P.jBob = 0.002 * br; P.jRock = 0.01 * Math.sin(t * 0.7); P.pump = 0;
    }
    // B 案の尾はふだん下へ垂れ（休みの形）、速いほど後ろへ流れる（負＝持ち上げる）
    if (D.real) P.tail = { gallop: -1.0, canter: -0.75, trot: -0.45, walk: -0.12, stand: -0.04, rear: 0.25 }[g];
    P.tailFreq = g === "stand" || g === "walk" || g === "rear" ? null : ph;
    const reach = (g === "walk" ? 0.8 : 1.1) * S.legLen;
    const still = g === "stand" || g === "rear";
    const sweep = still ? 0 : GP.sweep;
    const nO = still ? 0 : 0.02, NEU = [S.FJ.C[0] + nO, S.FJ.C[0] + nO, S.HJ.C[0] - nO, S.HJ.C[0] - nO], BIAS = g === 'gallop' ? [0.58, 0.58, 0.53, 0.53] : [0.56, 0.56, 0.5, 0.5]; // 着地の範囲の前寄り具合（後ろ脚は 0.42 → 0.5: 蹴り出しで脚が届かず蹄が浮いて滑るのを防ぐ。tools/lab-anim.html で確認）。襲歩は前脚 0.58・後ろ脚 0.53（後ろへ蹴り終わる所で脚が届かず蹄が浮くのを防ぐ）
    for (let i = 0; i < 4; i++) {
      const fore = i < 2, lp = frac(ph - G.off[i]), xn = NEU[i], xOn = xn + sweep * BIAS[i], xOff = xn - sweep * (1 - BIAS[i]);
      const L = { stance: true, u: 0 };
      const lp_ = fore ? S.FL.p : S.HL.p, pr = fore ? S.FA.p : S.HA.p, C = fore ? S.FJ.C : S.HJ.C;
      const sink = clamp(0.08 + v * 0.012, 0.08, 0.26) * (still ? 0 : 1);
      const phiAt = (u) => pr + sink * Math.sin(PI * u);
      if (g === "rear" && fore) {
        // 前脚は胴に付いたまま宙で掻く
        const R = P.rear, rk = R.k == null ? 1 : R.k, lx = S.FJ.E[0] + 0.08 + 0.06 * Math.sin(t * 6.4 + i * 2), ly = S.FJ.E[1] - S.legLen * (0.32 + 0.5 * (1 - rk)) + 0.05 * Math.cos(t * 6.4 + i * 2) * rk;
        L.stance = false; L.u = 0.5; L.fold = (1.7 + 0.25 * Math.sin(t * 6.4 + i * 2)) * rk;
        L.F = [R.pv[0] + P.surge + R.c * (lx - R.pv[0]) - R.s * (ly - R.pv[1]), R.pv[1] + P.bob + R.s * (lx - R.pv[0]) + R.c * (ly - R.pv[1])];
        { const gy = C[1] - lp_ * dirA(pr)[1] + 0.03; if (L.F[1] < gy) L.F[1] = gy; }   // 小さな立ち上がり（確定演出 gateLate）でも前の蹄は立っている地面の高さより 3cm 上＝降りるときに芝にめり込まない
      } else if (still || lp < duty) {
        const u = still ? 0.5 : lp / duty; L.u = u;
        const cx = still ? xn : xOn - sweep * u;
        const phi = still ? pr : phiAt(u), d = dirA(phi);
        L.F = [cx - lp_ * d[0], C[1] - lp_ * d[1]]; L.ap = phi; L.ah = 0;
        if (g === 'stand' && i === 3 && idle) { L.F = [cx + 0.02, C[1] + lp_ + 0.04]; L.ap = pr - 0.5; L.ah = -0.7; } // 後ろ脚を休める
      } else {
        const u = (lp - duty) / (1 - duty); L.stance = false; L.u = u;
        const pOff = phiAt(1), pOn = phiAt(0), dOff = dirA(pOff), dOn = dirA(pOn);
        const Fo = [xOff - lp_ * dOff[0], C[1] - lp_ * dOff[1]], Fn = [xOn - lp_ * dOn[0], C[1] - lp_ * dOn[1]];
        const e = u * u * (3 - 2 * u);
        const k = clamp(sweep / reach, 0.3, 1.1), ex = g === "walk" ? 0 : 1;
        // 蹴った後、脚はいったん後ろ上へ跳ね上げ（後ろ脚は大きく）、前脚は着地の前に前へ大きく伸ばす（アニメらしい「飛ぶ」形）
        // 襲歩は振り上げ・伸ばしの大きさを肘・後膝の高さ（腹の下の高さ）で決める（胴の太いヨコヅナで脚が肘より上まで巻き上がり、腕節・飛節が折れ曲がりすぎていた）
        const gal = g === 'gallop', LB = gal ? S.D.belly : S.legLen;
        // 蹄を上げ下ろしする時間（襲歩は約 12ms。宙の時間が長くなったので割合で決めると蹄が芝をこする時間が延びる）
        const uA = gal ? clamp(0.012 * GP.f / (1 - duty), 0.02, 0.06) : 0.06, uB = gal ? clamp(0.011 * GP.f / (1 - duty), 0.02, 0.05) : 0.05;
        const back = (fore ? (gal ? 0.05 : 0.12) : (gal ? 0.13 : 0.26) * ex) * LB * (1 + (gal ? 0.3 : 0.45) * kS);   // 追い・加速では大きく伸ばす
        const over = (fore ? (gal ? 0.2 : 0.22) * ex : 0.06) * LB * (1 + (gal ? 0.3 : 0.45) * kS);
        const lx = lerp(Fo[0], Fn[0], e) - back * Math.sin(PI * Math.pow(u, 0.55)) * (1 - u) * k + over * Math.pow(Math.sin(PI * u), 2) * u * k;
        // 宙の蹄が着地の直前・離れた直後に芝の中を進む（地面を滑って見える）のを防ぐ: 離れたらすぐ・着地の直前まで蹄を数 cm 上げておき、最後にすとんと下ろす（平方根の形。スローでも芝をこすらない）
        const ly = lerp(Fo[1], Fn[1], u) + G.lift[i] * LB * Math.pow(Math.sin(PI * Math.pow(u, fore ? 0.95 : 0.6)), 1.1) * clamp(k, 0.4, 1.1)
          + (fore ? Math.max(0.08, 0.075 * S.legLen) * (1 - Math.sin(PI * u)) ** 2 : Math.max(0.085, 0.1 * S.legLen)) * Math.sqrt(Math.min(1, u / uA, (1 - u) / uB)) * (g === 'walk' ? 0.7 : 1);
        L.F = [lx, ly]; L.fold = G.fold[i] * Math.pow(Math.sin(PI * Math.pow(u, 0.8)), 1.2);
      }
      P.legs.push(L);
    }
    return P;
  }
  // 歩き方の切り替え: 体（数値）は k で、脚は 1 本ずつ wl[i] で混ぜる。脚の記録（着地かどうか等）は重みの大きい方を使う
  function blendPose2(A, B, k, wl) {
    const P = { legs: [] };
    for (const f in B) if (typeof B[f] === 'number') P[f] = lerp(A[f] || 0, B[f], k);
    P.tailFreq = B.tailFreq;
    for (let i = 0; i < 4; i++) {
      const a = A.legs[i], b = B.legs[i], w = wl[i], L = Object.assign({}, w < 0.5 ? a : b);
      L.F = [lerp(a.F[0], b.F[0], w), lerp(a.F[1], b.F[1], w)];
      if (a.stance && b.stance) { L.ap = lerp(a.ap, b.ap, w); L.ah = lerp(a.ah || 0, b.ah || 0, w); }
      else if (!a.stance && !b.stance) L.fold = lerp(a.fold, b.fold, w);
      P.legs.push(L);
    }
    return P;
  }
  function blendPose(A, B, k) {
    if (k >= 1) return B; if (k <= 0) return A;
    const P = { legs: [] };
    for (const f in B) if (typeof B[f] === 'number') P[f] = lerp(A[f] || 0, B[f], k);
    P.tailFreq = B.tailFreq;
    for (let i = 0; i < 4; i++) {
      const a = A.legs[i], b = B.legs[i], L = Object.assign({}, b);
      L.F = [lerp(a.F[0], b.F[0], k), lerp(a.F[1], b.F[1], k)];
      if (a.stance && b.stance) { L.ap = lerp(a.ap, b.ap, k); L.ah = lerp(a.ah, b.ah, k); }
      else if (!a.stance && !b.stance) L.fold = lerp(a.fold, b.fold, k);
      P.legs.push(L);
    }
    return P;
  }
  // 2 本の骨の IK（2D）: 根元 (ax,ay) から目標 (tx,ty)。関節は前に出る向き
  function ik2(ax, ay, tx, ty, l1, l2, o) {
    const dx = tx - ax, dy = ty - ay; let d = Math.hypot(dx, dy);
    d = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    const base = Math.atan2(dx, -dy), c = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), b1 = Math.acos(clamp(c, -1, 1));
    o.a1 = base + b1; o.jx = ax + l1 * Math.sin(o.a1); o.jy = ay - l1 * Math.cos(o.a1);
    const ex = ax + Math.sin(base) * d, ey = ay - Math.cos(base) * d;
    o.a2 = Math.atan2(ex - o.jx, -(ey - o.jy));
    return o;
  }
  // 3D の 2 本骨 IK（騎手の手足）。pole の向きへ関節を出す
  const _v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  function ik3(A, T, l1, l2, pole, J, E) {
    const dir = _v[0].subVectors(T, A); let d = dir.length(); dir.normalize();
    d = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pd = _v[1].subVectors(pole, A); pd.addScaledVector(dir, -pd.dot(dir)); if (pd.lengthSq() < 1e-8) pd.set(0, 1, 0); pd.normalize();
    J.copy(A).addScaledVector(dir, a).addScaledVector(pd, h); E.copy(A).addScaledVector(dir, d);
  }
  const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4();
  function basisQuat(d0, s0, d1, s1, q) { // 休みの向き (d0,s0) → いまの向き (d1,s1) へ回す回転
    const a = _v[2].copy(d0).normalize(), b = _v[3].copy(s0); b.addScaledVector(a, -b.dot(a)).normalize(); const c = _v[4].crossVectors(a, b); _m0.makeBasis(a, b, c);
    const a1 = _v[5].copy(d1).normalize(), b1 = _v[6].copy(s1); b1.addScaledVector(a1, -b1.dot(a1)).normalize(); const c1 = _v[7].crossVectors(a1, b1); _m1.makeBasis(a1, b1, c1);
    _m1.multiply(_m0.transpose()); return q.setFromRotationMatrix(_m1);
  }
  const ZAX = new THREE.Vector3(0, 0, 1), YAX = new THREE.Vector3(0, 1, 0), XAX = new THREE.Vector3(1, 0, 0);

  // ---------------- 1 頭 ----------------
  // 動いている馬の一覧（脚の周期をほかの馬とずらすため。dispose で外す）
  const LIVE = new Set(), REP_T = 0.09;
  // 確定演出（eye。js/race3d.js が最終コーナーで flashEye を呼ぶ）: 目のきらめき用の星の絵（白い芯＋十字の光条＋斜めの短い光条＋やわらかなにじみ）。両方の馬の部品で同じ
  function glintTexture() {
    if (texCache.glint) return texCache.glint;
    const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d'), m = S / 2;
    const g = c.createRadialGradient(m, m, 0, m, m, m); g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.16, 'rgba(255,245,215,0.8)'); g.addColorStop(0.42, 'rgba(255,240,200,0.2)'); g.addColorStop(1, 'rgba(255,240,200,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    c.save(); c.translate(m, m); c.fillStyle = 'rgba(255,252,240,0.95)';
    for (let k = 0; k < 2; k++) { c.beginPath(); c.moveTo(-m, 0); c.lineTo(0, -1.7); c.lineTo(m, 0); c.lineTo(0, 1.7); c.closePath(); c.fill(); c.rotate(Math.PI / 2); }
    c.rotate(Math.PI / 4); c.fillStyle = 'rgba(255,252,240,0.5)';
    for (let k = 0; k < 2; k++) { c.beginPath(); c.moveTo(-m * 0.5, 0); c.lineTo(0, -1.2); c.lineTo(m * 0.5, 0); c.lineTo(0, 1.2); c.closePath(); c.fill(); c.rotate(Math.PI / 2); }
    c.restore();
    const t = new THREE.CanvasTexture(cv); t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; texCache.glint = t; return t;
  }
  // 確定演出（eye）の 2 段目: 頭のまわりのやわらかな光の輪（レンズの光のにじみ風。真ん中は明るく、外へ向かってすっと薄く）
  // 確定演出（eye）: 足元の輪のまわりの金色の光（輪の板と同じ大きさの板。輪の半径 0.4 の所が明るく、内外へすっと薄く）
  function ringGlowTexture() {
    if (texCache.ringGlow) return texCache.ringGlow;
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d'), m = S / 2;
    const g = c.createRadialGradient(m, m, S * 0.28, m, m, S * 0.5); g.addColorStop(0, 'rgba(255,210,90,0)'); g.addColorStop(0.42, 'rgba(255,220,110,1)'); g.addColorStop(0.62, 'rgba(255,200,80,0.45)'); g.addColorStop(1, 'rgba(255,190,70,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(cv); t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; texCache.ringGlow = t; return t;
  }
  function haloTexture() {
    if (texCache.halo) return texCache.halo;
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d'), m = S / 2;
    const g = c.createRadialGradient(m, m, 0, m, m, m); g.addColorStop(0, 'rgba(255,250,230,1)'); g.addColorStop(0.22, 'rgba(255,240,190,0.8)'); g.addColorStop(0.5, 'rgba(255,225,140,0.4)'); g.addColorStop(0.78, 'rgba(255,215,120,0.12)'); g.addColorStop(1, 'rgba(255,215,120,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(cv); t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; texCache.halo = t; return t;
  }
  function create(h, opts) {
    opts = opts || {};
    const type = TYPES[h.type] ? h.type : 'senko', S = makeSpec('real'); // B 案: 脚質に関係なく全馬同じ体（type は呼び出し側の確認用にそのまま返す）
    const coat = COATS[h.coat] ? h.coat : 'bay', F = faceOf(h);
    const markIdx = (coat === 'white' || coat === 'gray') ? 0 : ((h.no || 1) * 5 + coat.length) % MARKS.length;
    let quality = opts.quality || R3D.quality || "high";
    const mare = !!(h.mare || h.sex === "f" || h.sex === "mare" || h.sex === "牝");
    const object3d = new THREE.Group(); object3d.name = 'horse' + (h.no || '');
    const rig = new THREE.Group(); object3d.add(rig);
    const BONES = S.bones, BI = S.BI;
    const bones = BONES.map((b) => { const o = new THREE.Bone(); o.name = b.name; o.position.set(b.r[0], b.r[1], b.r[2]); if (b.q0) o.quaternion.fromArray(b.q0); rig.add(o); return o; });
    /* B 案の頭は小さく下向きなので、頭の骨（うなじ）と顔の位置が今の馬と違う。統合側（race3d.js）を変えずに同じように撮れるよう:
       - 'head' という名前の目印（出馬表の顔の絵のカメラは getObjectByName('head') ＋ (0.3, −0.12) を見る）を、顔が絵の中央に来る所に置く（骨の名前は 'headBone'）
       - getHeadPosition は頭の中ほど（鼻革のあたり）を返す（引き綱・鼻先の位置はそこから決まる） */
    const headMark = new THREE.Object3D(); headMark.name = 'head'; headMark.position.set(-0.25, -0.08, 0); bones[BI.head].name = 'headBone'; bones[BI.head].add(headMark);
    const headMid = new THREE.Vector3().fromArray(vsub(vadd(S.head.B0, vsc(S.head.HD, S.D.hL * 0.5)), BONES[BI.head].r));
    const noseTip = new THREE.Vector3().fromArray(vsub(vadd(S.head.B0, vsc(S.head.HD, S.D.hL)), BONES[BI.head].r)); // 鼻先（頭の骨から）
    const bodyMesh = new THREE.SkinnedMesh(horseGeometry(S, coat, markIdx, quality, mare, F), coatMaterial());
    const lineMesh = new THREE.SkinnedMesh(bodyMesh.geometry, outlineMaterial());
    let geoKey = bodyMesh.geometry.userData.cacheKey; geoRef(geoKey, 1);
    let jockeyOn = opts.jockey !== false, disposed = false;
    const clothTex = atlasTexture(h);
    const tMat = R3D.xlite ? new THREE.MeshLambertMaterial({ map: clothTex, vertexColors: true, alphaTest: 0.5 }) : new THREE.MeshStandardMaterial({ map: clothTex, vertexColors: true, roughness: 0.68, metalness: 0.0, alphaTest: 0.5 }); // さらになめらか: 勝負服も軽い材質
    if (!R3D.xlite) addRim(tMat, 0.12);   // 勝負服: 布らしい柔らかい陰影（縁が少し明るい。講評 v2-1 の 2）
    const tMesh = new THREE.SkinnedMesh(tackGeometry(S, quality, jockeyOn), tMat);
    [bodyMesh, tMesh].forEach((m) => { m.castShadow = true; m.receiveShadow = true; });
    lineMesh.castShadow = false; lineMesh.receiveShadow = false; lineMesh.visible = quality === "high" && opts.outline === true;
    lineMesh.onBeforeRender = (renderer) => { renderer.getDrawingBufferSize(outlineU.olView.value); };
    [bodyMesh, lineMesh, tMesh].forEach((m) => rig.add(m));
    object3d.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    [bodyMesh, lineMesh, tMesh].forEach((m) => m.bind(skeleton, m.matrixWorld));
    const shadowBlob = opts.blob === false ? null : blob(S); if (shadowBlob) object3d.add(shadowBlob);
    // 足元の枠色の輪（object3d の子＝傾かない）
    const ring = opts.ring === false ? null : makeRing(S, h); if (ring) { object3d.add(ring); object3d.add(ring.userData.badges); } // 輪と馬番の札（札は輪の子にしない＝輪を縮めても札の形は変わらない）
    // ニンジンの加速: 体を包む青紫の光（体の形を少し膨らませて縁を光らせる）と後ろの残像 2 つ。加速中だけ描く
    const auraMat = auraMaterial(false), ghostMat = auraMaterial(true);
    const aura = new THREE.SkinnedMesh(bodyMesh.geometry, auraMat), ghosts = [-0.75, -1.5].map((dx) => { const g = new THREE.SkinnedMesh(bodyMesh.geometry, ghostMat); g.bindMode = 'detached'; g.userData.dx = dx; return g; });
    [aura, ...ghosts].forEach((m) => { m.visible = false; m.castShadow = false; m.renderOrder = 4; rig.add(m); m.bind(skeleton, new THREE.Matrix4()); });
    const _inv = new THREE.Matrix4();
    ghosts.forEach((g) => { g.position.x = g.userData.dx; g.onBeforeRender = () => { g.bindMatrixInverse.copy(_inv.copy(bodyMesh.matrixWorld).invert()); }; });
    let boostK = 0, boostTarget = 0;
    /* 確定演出（eye）: flashEye(秒) で両目の表面に星のきらめきを 1 回だけ。2 段＝前の約 0.3 秒は星がぱっと大きく（2026-10-16 「もっとわかりやすく」で 1.6 倍）、
       残り約 1 秒は星が少し小さくほんのり光り続け、頭のまわりにやわらかな光の輪（halo）が出て、最後にすっと消える。見ている間だけ描く＝ふだんは描く数が増えない。
       星は目の骨（eyeL / eyeR。z が目の外向き）の子に置いた板（Sprite。いつもカメラを向く）、光の輪は両目の真ん中に置く板（奥行きを見ない＝頭の前にかぶる）。使う馬だけ初めて呼ばれたときに作る */
    let glint = null, glintT = -1, glintDur = 0.45, ringStrong = false, ringGold = false;   // ringStrong: setRingHighlight の状態（金色を戻すときに使う）
    const GLINT_R = 0.03, GLINT_SZ = 0.35, HALO_SZ = 2.2;   // 目の半径（目の表面の少し外に置く）、きらめきの最大の大きさ（m。前は 0.22）、光の輪の大きさ（m）
    function makeGlint() {
      const mat = new THREE.SpriteMaterial({ map: glintTexture(), color: 0xfff6d8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const sp = ['eyeL', 'eyeR'].map((n) => { const s = new THREE.Sprite(mat); s.position.set(0, 0, GLINT_R * 0.9); s.scale.set(0.001, 0.001, 1); s.visible = false; s.renderOrder = 5; B(n).add(s); return s; });
      const hmat = new THREE.SpriteMaterial({ map: haloTexture(), color: 0xffd470, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const halo = new THREE.Sprite(hmat); halo.scale.set(0.001, 0.001, 1); halo.visible = false; halo.renderOrder = 6; object3d.add(halo);
      // 頭から舞い上がる小さな光（点の群れ。1 回の描画。大きさは画角に合わせる＝望遠でも点のまま小さくならない）
      const NP = 14, pg = new THREE.BufferGeometry(), pp = new Float32Array(NP * 3), pk = new Float32Array(NP);
      pg.setAttribute('position', new THREE.BufferAttribute(pp, 3)); pg.setAttribute('aK', new THREE.BufferAttribute(pk, 1));
      const pm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uOp: { value: 0 }, uSz: { value: 0.16 } },
        vertexShader: 'uniform float uSz; attribute float aK; varying float vK; void main(){ vK = aK; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(uSz * 480.0 * 0.5 * projectionMatrix[1][1] / max(0.1, -mv.z), 1.0, 48.0); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform float uOp; varying float vK; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; float a = 1.0 - r * 4.0; a = a * a * uOp * vK; gl_FragColor = vec4(vec3(1.0, 0.92, 0.6) * a, a); }' });
      const pts = new THREE.Points(pg, pm); pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 6; object3d.add(pts);
      // 足元の輪の金色の光（輪の子＝輪が混んで縮んでも一緒に縮む。光っている間だけ描く＝+1 回）
      let rglow = null;
      if (ring) { rglow = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringGlowTexture(), color: 0xffd25a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); rglow.name = 'ringGlow'; rglow.position.y = 0.004; rglow.scale.set(1.18, 1, 1.18); rglow.renderOrder = 2; rglow.visible = false; ring.add(rglow); }
      return { mat, sp, hmat, halo, pts, pp, pk, pm, rglow, v: new THREE.Vector3(), v2: new THREE.Vector3() };
    }
    function updateGlint(dt) {
      if (glintT < 0 || !glint) return;
      glintT += dt; const u = glintT / glintDur;
      if (u >= 1) { glintT = -1; glint.sp.forEach((s) => { s.visible = false; }); glint.halo.visible = false; glint.pts.visible = false; ringGlowSet(0); return; }
      // 3 段（2.0 秒なら 0.3 → 1.4 → 0.3 秒）: きらっ（星が最大）→ 金色の光の輪がゆっくり脈打ちながら光り続け、星は 7 割・小さな光が舞い上がる → すっと消える
      const a = Math.min(0.3, glintDur * 0.25), f = Math.min(0.3, glintDur * 0.25), tG = glintT - a, Gd = Math.max(0.1, glintDur - a - f), spark = glintT < a;
      const out = tG > Gd ? 1 - clamp((tG - Gd) / f, 0, 1) : 1, pulse = spark ? 1 : 0.85 + 0.15 * Math.sin(TAU * tG / 0.7 - PI / 2);
      const k = spark ? Math.pow(Math.sin(PI * glintT / a), 0.8) : 0.7 * pulse * out, sz = spark ? GLINT_SZ * (0.5 + 0.5 * k) : GLINT_SZ * 0.7 * pulse;
      glint.mat.opacity = k; glint.mat.rotation = (u - 0.5) * 0.9;
      glint.sp.forEach((s) => { s.visible = true; s.scale.set(sz, sz, 1); });
      // 光の輪: 1 段目の終わりから出て 2 段目のあいだ頭を包み、最後にすっと消える。両目の真ん中（馬の座標）に置く
      const hk = spark ? 0.9 * Math.pow(glintT / a, 2) : 0.9 * pulse * out, hs = HALO_SZ * (spark ? 0.6 + 0.4 * glintT / a : 1 + 0.1 * Math.sin(TAU * tG / 0.7));
      B('eyeL').getWorldPosition(glint.v); B('eyeR').getWorldPosition(glint.v2); glint.v.add(glint.v2).multiplyScalar(0.5); object3d.worldToLocal(glint.v);
      glint.halo.position.copy(glint.v); glint.halo.visible = true; glint.halo.scale.set(hs, hs, 1); glint.hmat.opacity = hk;
      ringGlowSet(Math.min(1, hk / 0.9));   // 足元の輪と馬番の札も光の輪と同じ脈で光る
      // 舞い上がる光: 2 段目のあいだ、頭の上 0.1〜1.3m を 1.1 秒かけて上がって消える（位置は時刻だけで決まる）
      if (!spark) {
        const pp = glint.pp, pk = glint.pk, hv = glint.v;
        for (let i = 0; i < pk.length; i++) { const ph = (i * 0.618 + tG / 1.1) % 1, sw = 0.3 + 0.25 * ph; pp[i * 3] = hv.x + sw * Math.sin(i * 2.4 + tG * 1.3); pp[i * 3 + 1] = hv.y + 0.1 + 1.2 * ph; pp[i * 3 + 2] = hv.z + sw * Math.cos(i * 1.7 - tG * 0.9); pk[i] = Math.sin(PI * ph); }
        glint.pts.geometry.attributes.position.needsUpdate = true; glint.pts.geometry.attributes.aK.needsUpdate = true;
        glint.pts.visible = true; glint.pm.uniforms.uOp.value = out;
      } else glint.pts.visible = false;
    }
    // 確定演出（eye）: 足元の輪と馬番の札を光らせる（k 0〜1。0 で元に戻す）。ふちを金色に描き直すのは光り始めと終わりの 2 回だけ、脈は材質の色と光の板の濃さで
    function ringGlowSet(k) {
      if (!ring) return;
      const bg = ring.userData.badges, on = k > 0.001;
      if (on !== ringGold) {
        ringGold = on; drawRing(ring.userData.cv, h, ringStrong, on); ring.userData.tex.needsUpdate = true;
        if (bg && bg.userData.cv) { drawBadge(bg.userData.cv, h, on); bg.userData.tex.needsUpdate = true; }
      }
      const b = 1 + 0.45 * k;   // 札と輪を少し明るく（暖かい色寄り）
      ring.userData.mat.color.setRGB(1 + 0.3 * k, 1 + 0.22 * k, 1);
      if (bg) bg.userData.mats.forEach((m) => m.color.setRGB(b, 1 + 0.35 * k, 1 + 0.05 * k));
      if (glint && glint.rglow) { glint.rglow.visible = on; glint.rglow.material.opacity = 0.95 * k; }
    }
    // 土煙: 蹄が着いた瞬間に後ろへ小さなもこもこを出す（全馬で 1 つの InstancedMesh）
    let dustSys = null, dustSlot = -1, dustNext = 0, surface = opts.surface === 'dirt' ? 'dirt' : 'turf', onStep = null, dustK = 1;   // dustK: 統合側が直線の先頭 2 頭を強める（dustBoost）
    const puffs = []; for (let i = 0; i < DUST_PER; i++) puffs.push({ age: 9, life: 1, x: 0, y: 0, z: 0, s: 0.3, vx: 0, vz: 0 });
    const prevStance = [true, true, true, true], _hv = new THREE.Vector3(), _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dp = new THREE.Vector3(), _ds = new THREE.Vector3();
    function sceneOf(o) { while (o.parent) o = o.parent; return o; }
    function updateDust(dt, P, g, v) {
      if (opts.dust === false) return;
      if (!dustSys && object3d.parent) { dustSys = dustSystem(sceneOf(object3d)); dustSlot = dustSys.alloc(); }
      const moving = (g === 'gallop' || g === 'canter') && v > 5;
      for (let i = 0; i < 4; i++) {
        const st = P.legs[i].stance;
        if (st && !prevStance[i]) {
          B('hoof' + LEGS[i].name).getWorldPosition(_hv);
          if (onStep) { try { onStep({ x: _hv.x, y: 0, z: _hv.z, leg: i, gait: g, speed: v }); } catch (e) { } }
          if (moving && dustSlot >= 0 && (i >= 2 || v > 10 || dustK > 1.2)) for (let e = 0; e < 2; e++) {   // 1 歩で 2 粒（少しずらす）
            const p = puffs[dustNext]; dustNext = (dustNext + 1) % DUST_PER;
            p.age = 0; p.life = 0.35 + Math.random() * 0.2; p.x = _hv.x + (e ? (Math.random() - 0.5) * 0.3 : 0); p.y = 0.06 + e * 0.08; p.z = _hv.z + (e ? (Math.random() - 0.5) * 0.3 : 0); p.s = (0.2 + Math.random() * 0.11) * Math.min(1.3, S.legLen + 0.2) * (g === 'canter' ? 0.7 : 1) * Math.sqrt(dustK);
            p.vx = (Math.random() - 0.5) * 0.4; p.vz = (Math.random() - 0.5) * 0.4;
            dustSys.mesh.setColorAt(dustSlot * DUST_PER + ((dustNext + DUST_PER - 1) % DUST_PER), DUST_COL[surface]); if (dustSys.mesh.instanceColor) dustSys.mesh.instanceColor.needsUpdate = true;
          }
        }
        prevStance[i] = st;
      }
      if (dustSlot < 0) return;
      for (let i = 0; i < DUST_PER; i++) {
        const p = puffs[i]; let sc = 0;
        if (p.age < p.life) { p.age += dt; const k = p.age / p.life; sc = p.s * (0.35 + 0.9 * Math.sqrt(k)) * (1 - smooth(0.6, 1, k)); p.x += p.vx * dt; p.z += p.vz * dt; p.y += 0.25 * dt; }
        _dm.compose(_dp.set(p.x, p.y, p.z), _dq, _ds.set(sc, sc * 0.75, sc)); dustSys.mesh.setMatrixAt(dustSlot * DUST_PER + i, _dm);
      }
      dustSys.mesh.instanceMatrix.needsUpdate = true;
    }

    let ph = ((h.no || 1) * 0.137) % 1, t = (h.no || 1) * 3.1, gaitCur = 'stand', blendK = 1, leanCur = 0, lastPose = null, prevPose = null;
    // 歩き方の切り替え中も前の歩き方を自分の周期（phA）で動かし続け、脚は宙にある間だけ新しい歩き方へ移す（着地中の蹄が地面を滑らないように）
    let gaitPrev = null, phA = 0, blendT = 9, carry = null, slideX = 0, realN = 0; const legW = [1, 1, 1, 1];
    const idle = ((h.no || 1) % 2) === 0;
    // 表情・揺れもの: まばたき、前髪・たてがみの揺れ（後追い）、気分（勝ち＝首を振って跳ねる、負け＝うなだれる）
    const rnd = seeded(F.seed ^ 0x9e3779b9);
    let blinkT = 0.5 + rnd() * 2.5, blinkA = 9, blinkDbl = 0, eyeS = 1, foreA = 0, earDroop = 0, mood = null, moodK = 0, hopY = 0, stretchK = 0, gaitReq = 'stand';
    const maneA = [0, 0, 0];
    let lastPos = null, vMeas = -1;
    // 1 頭ごとのリズム（完歩数 ±3.5%）と、近くを走るほかの馬と脚の周期がそろわないためのずらし（fmRep。0.09 秒より近いと離れる向きに最大 ±10%）
    const rhythm = 1 + ((Math.imul(F.seed ^ 0x5bd1e995, 2654435761) >>> 0) / 4294967296 - 0.5) * 0.07;
    let fmRep = 0; const rec = { o: object3d, ph: 0, ph0: 0, n: 0, f: 0, g: 'stand', no: h.no || 0 }; LIVE.add(rec);
    const fmNow = () => rhythm * (1 + fmRep);
    const legMem = [0, 1, 2, 3].map(() => ({ fa: S.FA.f }));
    const hindMem = [0, 1, 2, 3].map(() => ({ a: S.HA.fe, ds: 0 }));
    const B = (n) => bones[BI[n]];
    const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), pos = new THREE.Vector3(), dv = new THREE.Vector3();
    const P2 = {};
    function set2(n, x, y, a, z) { const b = B(n); b.position.set(x, y, z !== undefined ? z : BONES[BI[n]].r[2]); b.quaternion.setFromAxisAngle(ZAX, a); P2[n] = { x, y, a }; }
    function xf(n, rx, ry) { const p = P2[n], r = BONES[BI[n]].r, c = Math.cos(p.a), s = Math.sin(p.a), dx = rx - r[0], dy = ry - r[1]; return [p.x + c * dx - s * dy, p.y + s * dx + c * dy]; }
    const { FJ, HJ, FL, FA, HL, HA, LEGS, TAIL } = S;

    // 騎手: 休みの姿勢の腕・脚の向き（IK の基準）
    const JK = S.JK, jRest = {};
    [['L', -1], ['R', 1]].forEach(([s, k]) => {
      const z = (p) => new THREE.Vector3(p[0], p[1], p[2] * k);
      const sh = z(JK.sh), el = z(JK.el), ha = z(JK.hand), hp = z(JK.hip), kn = z(JK.knee), an = z(JK.ank);
      const armPole = z([JK.el[0], JK.el[1] - 0.05, JK.el[2] + 0.3]), legPole = z([JK.knee[0] + 0.3, JK.knee[1], JK.knee[2] + 0.1]);
      jRest[s] = {
        ua: new THREE.Vector3().subVectors(el, sh), fa: new THREE.Vector3().subVectors(ha, el), armN: new THREE.Vector3().subVectors(ha, sh).cross(new THREE.Vector3().subVectors(armPole, sh)).normalize(),
        lua: sh.distanceTo(el), lfa: el.distanceTo(ha),
        th: new THREE.Vector3().subVectors(kn, hp), sh: new THREE.Vector3().subVectors(an, kn), legN: new THREE.Vector3().subVectors(an, hp).cross(new THREE.Vector3().subVectors(legPole, hp)).normalize(),
        lth: hp.distanceTo(kn), lsh: kn.distanceTo(an),
      };
    });
    const tv = { A: new THREE.Vector3(), T: new THREE.Vector3(), P: new THREE.Vector3(), J: new THREE.Vector3(), E: new THREE.Vector3(), n: new THREE.Vector3(), d1: new THREE.Vector3(), d2: new THREE.Vector3() };
    const jq = { pel: new THREE.Quaternion(), chest: new THREE.Quaternion() }, jp = { pel: new THREE.Vector3(), chest: new THREE.Vector3() };
    const jxf = (qq, p0, pivot, pt, out) => out.set(pt[0] - pivot[0], pt[1] - pivot[1], pt[2] - pivot[2]).applyQuaternion(qq).add(p0);
    const jHandL = new THREE.Vector3();
    let whipK = 0, whipT = 0, jPose = null, celK = 0, celT = 0;   // celK: 騎手のガッツポーズ（setJockeyPose('celebrate')）の効き 0〜1
    function applyJockey(P) {
      const up = clamp(P.jUp || 0, 0, 1), fol = clamp(P.jFollow || 0, 0, 1), js = JK.js;
      const cel = celK, cw = Math.sin(TAU * 0.8 * celT), cp = 0.5 + 0.5 * Math.sin(TAU * 1.6 * celT); // cw: ゆっくりした体の揺れ、cp: こぶしを突き上げる拍（1 秒に 1.6 回）
      // 腰: 馬の背の上下動をいくらか打ち消して安定させる（常歩・停止では鞍に座る）
      const pr = JK.pelvis, pf = xf('body', pr[0], pr[1]);
      jp.pel.set(lerp(pr[0] + P.surge, pf[0], fol) - 0.03 * up * js, lerp(pr[1] + P.bob * 0.3, pf[1], fol) + (P.jBob || 0) - 0.07 * up * js + 0.03 * js * cel, 0);
      jq.pel.setFromAxisAngle(ZAX, P.pitch * (0.35 + 0.65 * fol) + (P.jRock || 0) * 0.5 + 0.1 * up);
      const bp = B('jpel'); bp.position.copy(jp.pel); bp.quaternion.copy(jq.pel);
      // 胴: 前傾（常歩では起こす）。ムチのときは右へひねる
      jxf(jq.pel, jp.pel, pr, JK.chest, jp.chest);
      // ガッツポーズ: 胴を起こして（＋0.3rad）少し揺らし、上げた右腕の反対（左）へわずかに傾ける
      q.setFromAxisAngle(ZAX, (P.jRock || 0) + 0.45 * up - 0.04 * whipK + cel * (0.3 + 0.05 * cw)); q2.setFromAxisAngle(XAX, -0.14 * whipK * (0.6 + 0.4 * Math.sin(whipT)) + 0.06 * cel * (1 + 0.5 * cw));
      jq.chest.copy(jq.pel).multiply(q).multiply(q2);
      const bc = B('jchest'); bc.position.copy(jp.chest); bc.quaternion.copy(jq.chest);
      const hd = B('jhead'); jxf(jq.chest, jp.chest, JK.chest, JK.neck, hd.position);
      q.setFromAxisAngle(ZAX, -(P.jRock || 0) * 0.8 - 0.35 * up - P.pitch * fol * 0.5 - cel * (0.16 - 0.06 * cp)); hd.quaternion.copy(jq.chest).multiply(q);
      [['L', -1], ['R', 1]].forEach(([s, k]) => {
        const R = jRest[s];
        // 腕: 手は首の上（首の骨に付いて動く）＋押し出し
        const sh = jxf(jq.chest, jp.chest, JK.chest, [JK.sh[0], JK.sh[1], JK.sh[2] * k], tv.A);
        const hr = xf('neck2', JK.hand[0], JK.hand[1]), nd = [Math.cos(P2.neck2.a + S.D.nA * DEG), Math.sin(P2.neck2.a + S.D.nA * DEG)], pump = P.pump || 0;
        tv.T.set(hr[0] + nd[0] * pump - 0.05 * up * js, hr[1] + nd[1] * pump + 0.03 * up * js, JK.hand[2] * k);
        if (k > 0 && whipK > 0.001) { const sw = Math.sin(whipT); tv.P.set(jp.chest.x + 0.02 * js - 0.16 * js * sw, jp.chest.y + 0.42 * js + 0.05 * js * sw, 0.3 * js); tv.T.lerp(tv.P, whipK); }
        tv.P.set(sh.x + 0.1, sh.y - 0.05, sh.z + 0.3 * k);
        if (k > 0 && cel > 0.001) { // 右手（ムチ）を頭の上へ突き上げる。こぶしは拍に合わせて伸び縮み、ゆっくり左右に振る
          const L = (R.lua + R.lfa) * (0.88 + 0.1 * cp), dx = 0.24 + 0.12 * cw, dz = 0.62, n = 1 / Math.hypot(dx, 1, dz);
          tv.d2.set(sh.x + dx * n * L, sh.y + n * L, sh.z + dz * n * L); tv.T.lerp(tv.d2, cel);
          tv.d2.set(sh.x - 0.08, sh.y - 0.02, sh.z + 0.35); tv.P.lerp(tv.d2, cel);
        }
        ik3(sh, tv.T, R.lua, R.lfa, tv.P, tv.J, tv.E);
        tv.n.subVectors(tv.E, sh).cross(tv.d1.subVectors(tv.P, sh)).normalize();
        const ua = B('jua' + s); ua.position.copy(sh); basisQuat(R.ua, R.armN, tv.d1.subVectors(tv.J, sh), tv.n, ua.quaternion);
        const fa = B('jfa' + s); fa.position.copy(tv.J); basisQuat(R.fa, R.armN, tv.d2.subVectors(tv.E, tv.J), tv.n, fa.quaternion);
        // 手綱の手元: ふつうは手と一緒。右手を突き上げているあいだは左手のすぐ横（左手でまとめて持つ）
        const rn = B('jrn' + s); rn.position.copy(tv.E); rn.quaternion.identity();
        if (k < 0) jHandL.copy(tv.E); else if (cel > 0.001) rn.position.lerp(tv.d2.set(jHandL.x + 0.01 * js, jHandL.y, jHandL.z + 0.05 * js), cel);
        // 脚: 足はあぶみ（胴に付いて動く）
        const hp = jxf(jq.pel, jp.pel, pr, [JK.hip[0], JK.hip[1], JK.hip[2] * k], tv.A);
        const an = xf('body', JK.ank[0], JK.ank[1]); tv.T.set(an[0], an[1], JK.ank[2] * k);
        const kn = xf('body', JK.knee[0] + 0.3, JK.knee[1]); tv.P.set(kn[0], kn[1], (JK.knee[2] + 0.1) * k);
        ik3(hp, tv.T, R.lth, R.lsh, tv.P, tv.J, tv.E);
        tv.n.subVectors(tv.E, hp).cross(tv.d1.subVectors(tv.P, hp)).normalize();
        const th = B('jth' + s); th.position.copy(hp); basisQuat(R.th, R.legN, tv.d1.subVectors(tv.J, hp), tv.n, th.quaternion);
        const sb = B('jsh' + s); sb.position.copy(tv.J); basisQuat(R.sh, R.legN, tv.d2.subVectors(tv.E, tv.J), tv.n, sb.quaternion);
        const ft = B('jft' + s); ft.position.copy(tv.E); ft.quaternion.setFromAxisAngle(ZAX, P2.body.a);
      });
    }

    // 曲がりの傾き（x 軸まわり a rad）を骨に入れる。脚の骨は高さ（蹄 0 → 胴の下 1）で弱める
    const LEGB = new Set(), _lq = new THREE.Quaternion();
    LEGS.forEach((Lg) => (Lg.fore ? ['hum', 'fa', 'can', 'pas', 'hoof'] : ['fem', 'tib', 'can', 'pas', 'hoof']).forEach((k) => LEGB.add(BI[k + Lg.name])));
    function leanBones(a) {
      const y0 = S.hoofH, y1 = S.D.belly;
      for (let k = 0; k < bones.length; k++) {
        if (!jockeyOn && BONES[k].name[0] === 'j') continue; // 騎手を降ろしているときの騎手の骨は毎コマ置き直されないので回さない
        const b = bones[k], w = LEGB.has(k) ? clamp((b.position.y - y0) / (y1 - y0), 0, 1) : 1, an = a * w;
        if (!an) continue;
        const c = Math.cos(an), s = Math.sin(an), y = b.position.y, z = b.position.z;
        b.position.y = y * c - z * s; b.position.z = y * s + z * c; b.quaternion.premultiply(_lq.setFromAxisAngle(XAX, an));
      }
    }
    function applyPose(P) {
      const body = BONES[BI.body].r;
      set2('body', body[0] + P.surge, body[1] + P.bob, P.pitch);
      // 胴のつぶれ・伸び（ヨコヅナは大きく）と呼吸
      const sq = P.squash || 0, brt = P.breath || 0;
      B("body").scale.set(1 + sq * 0.2, 1 - sq + brt, 1 + sq * 0.67 + brt); B("hind").scale.copy(B("body").scale);
      const hr = BONES[BI.hind].r, hp = xf('body', hr[0], hr[1]); set2('hind', hp[0], hp[1], P.pitch + P.flex);
      let prev = 'body'; const nk = [0.4, 0.35, 0.25];
      ['neck1', 'neck2', 'neck3'].forEach((n, i) => { const r = BONES[BI[n]].r, p = xf(prev, r[0], r[1]); set2(n, p[0], p[1], P2[prev].a + P.neck * nk[i]); prev = n; });
      { const r = BONES[BI.head].r, p = xf('neck3', r[0], r[1]); set2('head', p[0], p[1], P2.neck3.a + P.head); }
      [["earL", -1], ["earR", 1]].forEach(([n, sd]) => {
        const r = BONES[BI[n]].r, p = xf("head", r[0], r[1]), b = B(n);
        const flick = P.tailFreq === null ? 0.25 * Math.max(0, Math.sin(t * (0.9 + sd * 0.17) + sd)) ** 12 : 0;
        const tw = P.tailFreq === null ? 0.12 * Math.sin(t * (0.6 + sd * 0.23) + sd * 2) * Math.max(0, Math.sin(t * 0.29 + sd)) : 0; // 左右の耳が別々にくるっと向きを変える
        b.position.set(p[0], p[1], r[2]); b.quaternion.setFromAxisAngle(ZAX, P2.head.a + P.ear - flick + tw - earDroop * 0.35); q2.setFromAxisAngle(XAX, sd * (0.12 + flick * 0.8 - P.ear * 0.25 + earDroop * 0.7)); b.quaternion.multiply(q2);
      });
      // 目（まばたき: 目の上下を縮める）
      ['eyeL', 'eyeR'].forEach((n) => {
        const r = BONES[BI[n]].r, p = xf('head', r[0], r[1]), b = B(n);
        b.position.set(p[0], p[1], r[2]); q.setFromAxisAngle(ZAX, P2.head.a); b.quaternion.fromArray(BONES[BI[n]].q0).premultiply(q); b.scale.set(1, eyeS, 0.55 + 0.45 * eyeS);
      });
      // 前髪とたてがみ（根元は頭・首、先が遅れて揺れる）
      { const r = BONES[BI.fore].r, p = xf('head', r[0], r[1]); set2('fore', p[0], p[1], P2.head.a + foreA, r[2]); }
      ['neck2', 'neck2', 'neck3'].forEach((nb, i) => { const r = BONES[BI['mane' + i]].r, p = xf(nb, r[0], r[1]); set2('mane' + i, p[0], p[1], P2[nb].a + maneA[i], 0); });
      // 尾（波打ち＋左右の揺れ）
      {
        let pq = q.setFromAxisAngle(ZAX, P2.hind.a).clone(); const p0 = xf('hind', TAIL[0][0], TAIL[0][1]); pos.set(p0[0], p0[1], 0);
        const drop = [0.5, 0.25, 0.12, 0.08, 0.05];
        for (let i = 0; i < 5; i++) {
          const b = B('tail' + i);
          if (i > 0) { dv.set(TAIL[i][0] - TAIL[i - 1][0], TAIL[i][1] - TAIL[i - 1][1], 0).applyQuaternion(pq); pos.add(dv); }
          const wave = P.tailFreq !== null ? Math.sin(TAU * (P.tailFreq - i * 0.1)) : Math.sin(t * 1.3 - i * 0.6);
          const sway = P.tailFreq !== null ? Math.sin(TAU * (P.tailFreq * 0.5 - i * 0.08)) * 0.12 : Math.sin(t * 0.8 - i * 0.5) * 0.1 + (idle ? Math.max(0, Math.sin(t * 0.31)) ** 8 * 0.5 : 0);
          q2.setFromAxisAngle(ZAX, P.tail * drop[i] + P.tailAmp * wave * (0.5 + i * 0.25)); pq.multiply(q2);
          q2.setFromAxisAngle(YAX, sway * (1 + i * 0.3)); pq.multiply(q2);
          b.position.copy(pos); b.quaternion.copy(pq);
        }
      }
      for (let i = 0; i < 4; i++) {
        const Lg = LEGS[i], L = P.legs[i], n = Lg.name, z = Lg.z;
        if (Lg.fore) {
          const Sp = xf('body', FJ.S[0], FJ.S[1]), m = legMem[i];
          let o = {}, ah = FA.h + P.pitch;
          for (let it = 0; it < 3; it++) {
            ah = FA.h + P.pitch + 0.5 * (m.fa - FA.f - P.pitch);
            const ex = Sp[0] + FL.h * Math.sin(ah), ey = Sp[1] - FL.h * Math.cos(ah);
            o = ik2(ex, ey, L.F[0], L.F[1], FL.f, FL.c, o); m.fa = o.a1; o.sx = ex; o.sy = ey;
          }
          { // 着地中に届かない（肘から目標の球節まで前腕＋管骨より遠い）ときは、上腕を目標の方へ回して届かせる（着地の瞬間に蹄が浮いて後から滑らないように）。
            // 回した分（m.ahx）は宙にある間にゆっくり戻す（届く・届かないの切り替わりで肩がぴくっと動かないように）
            const reach = FL.f + FL.c - 2e-3, dOf = (a) => Math.hypot(Sp[0] + FL.h * Math.sin(a) - L.F[0], Sp[1] - FL.h * Math.cos(a) - L.F[1]);
            let off = (m.ahx || 0) * (L.stance ? 1 : 0.85);
            if (L.stance && dOf(ah + off) > reach) {
              const aT = angOf(L.F[0] - Sp[0], L.F[1] - Sp[1]) - ah; let lo = off, hi = aT;
              if (dOf(ah + aT) <= reach) { for (let it = 0; it < 10; it++) { const mid = (lo + hi) / 2; if (dOf(ah + mid) <= reach) hi = mid; else lo = mid; } }
              off = clamp(hi, -0.35, 0.35); // 届かないままでも肩は 20 度までしか回さない
            }
            m.ahx = Math.abs(off) < 1e-4 ? 0 : off;
            if (off) { ah += off; const ex = Sp[0] + FL.h * Math.sin(ah), ey = Sp[1] - FL.h * Math.cos(ah); o = ik2(ex, ey, L.F[0], L.F[1], FL.f, FL.c, o); m.fa = o.a1; o.sx = ex; o.sy = ey; }
          }
          set2('hum' + n, Sp[0], Sp[1], ah - FA.h, z);
          set2('fa' + n, o.sx, o.sy, o.a1 - FA.f, z);
          set2('can' + n, o.jx, o.jy, o.a2 - FA.c, z);
          finishLeg(i, L, o.jx + FL.c * Math.sin(o.a2), o.jy - FL.c * Math.cos(o.a2), o.a2, z, FL.p, FA.p);
        } else {
          const H = xf('hind', HJ.H[0], HJ.H[1]), m = hindMem[i];
          // 後膝と飛節は一緒に曲がる（相反装置）。未知数: 大腿の角度 a と曲げ ds。ニュートン法で球節を目標へ
          const fk = (a, ds) => {
            const at = a - (HA.fe - HA.ti) - ds, ac = at + (HA.c - HA.ti) + ds * 1.05;
            const sx = H[0] + HL.fe * Math.sin(a), sy = H[1] - HL.fe * Math.cos(a), hx = sx + HL.ti * Math.sin(at), hy = sy - HL.ti * Math.cos(at);
            return [hx + HL.c * Math.sin(ac), hy - HL.c * Math.cos(ac), at, ac, sx, sy, hx, hy];
          };
          let a = m.a, ds = m.ds;
          for (let it = 0; it < 6; it++) {
            const f0 = fk(a, ds), ex = L.F[0] - f0[0], ey = L.F[1] - f0[1];
            if (ex * ex + ey * ey < 1e-7) break;
            const e = 1e-3, fa = fk(a + e, ds), fd = fk(a, ds + e);
            const j11 = (fa[0] - f0[0]) / e, j21 = (fa[1] - f0[1]) / e, j12 = (fd[0] - f0[0]) / e, j22 = (fd[1] - f0[1]) / e;
            const lam = 0.002, a11 = j11 * j11 + j21 * j21 + lam, a12 = j11 * j12 + j21 * j22, a22 = j12 * j12 + j22 * j22 + lam;
            const b1 = j11 * ex + j21 * ey, b2 = j12 * ex + j22 * ey, det = a11 * a22 - a12 * a12;
            let da = (a22 * b1 - a12 * b2) / det, dd = (a11 * b2 - a12 * b1) / det;
            const mx = Math.max(Math.abs(da), Math.abs(dd)); if (mx > 0.3) { da *= 0.3 / mx; dd *= 0.3 / mx; }
            a = clamp(a + da, -0.9, 1.6); ds = clamp(ds + dd, -0.5, 1.8); // 曲げ ds は -0.5 まで（蹴り出しで後ろ脚をもう少し伸ばせる）
          }
          m.a = a; m.ds = ds;
          const r = fk(a, ds);
          set2('fem' + n, H[0], H[1], a - HA.fe, z);
          set2('tib' + n, r[4], r[5], r[2] - HA.ti, z);
          set2('can' + n, r[6], r[7], r[3] - HA.c, z);
          finishLeg(i, L, r[0], r[1], r[3], z, HL.p, HA.p);
        }
      }
    }
    // 球節から先（つなぎと蹄）
    function finishLeg(i, L, fx, fy, ac, z, lp, apRest) {
      const n = LEGS[i].name, m = legMem[i];
      let ap, ah;
      if (L.stance) {
        ap = L.ap; ah = L.ah || 0;
        if (L.u < 0.1) m.relOn = ap - ac; if (L.u > 0.9) m.relOff = ap - ac;
      } else {
        const relOff = m.relOff !== undefined ? m.relOff : 0.8, relOn = m.relOn !== undefined ? m.relOn : 0.5;
        ap = ac + lerp(relOff, relOn, L.u) - L.fold;
        ah = (ap - apRest) * smooth(0, 0.18, L.u) * (1 - smooth(0.8, 1, L.u)) * 0.6;
      }
      set2('pas' + n, fx, fy, ap - apRest, z);
      set2('hoof' + n, fx + lp * Math.sin(ap), fy - lp * Math.cos(ap), ah, z);
    }

    const horse = {
      object3d, no: h.no, type, src: h, coat, // src: 元の馬のデータ（出馬表と同じもの。確認用）
      update(dt, st) {
        st = st || {}; const rawDt = Math.max(0, dt || 0); dt = clamp(rawDt, 0, 0.1); t += dt;
        const gR = GAIT[st.gait] ? st.gait : 'gallop'; gaitReq = gR; REAR_AMP = st.rearAmp > 0 ? Math.min(0.85, st.rearAmp) : gR === 'rear' ? 0 : REAR_AMP;
        let v = st.speed !== undefined ? Math.max(0, st.speed) : DEF_SPEED[gR];
        // 実際に地面を進んだ速さ（統合側が毎コマ object3d.position を入れる）で脚を回す＝蹄が滑らない。
        // その場で足踏み（作業台）や瞬間移動（リプレイの頭出し・出馬表の絵）のときは state.speed を使う
        // 時間の進まない呼び出し（出馬表の絵を撮るときの立ち姿など）は、その場の姿勢だけ作って歩き方の状態は元に戻す（次のコマで脚が飛ばない）
        const poseOnly = rawDt === 0 && realN > 0, saved = poseOnly ? { gaitCur, blendK, blendT, gaitPrev, phA, carry, slideX, lastPose, legW: legW.slice() } : null;
        if (rawDt > 0) {
          realN++;
          const op = object3d.position;
          if (lastPos) { const d = Math.hypot(op.x - lastPos.x, op.z - lastPos.z), vm = d / rawDt; if (d > 1e-5 && vm < Math.max(40, v * 3 + 10)) vMeas = vMeas < 0 ? vm : vMeas + (vm - vMeas) * Math.min(1, rawDt * 14); else vMeas = -1; }
          else lastPos = new THREE.Vector3();
          lastPos.copy(op);
        }
        if (vMeas >= 0 && gR !== 'stand' && gR !== 'rear') v = vMeas;
        // 遅い駈歩・速い常歩は速歩に（ゴール後に流して止まるところ）。行ったり来たりしないよう幅を持たせる
        let g = gR;
        if (g === 'canter' && v < (gaitCur === 'trot' ? 5.0 : 4.5)) g = 'trot';
        else if (g === 'walk' && v > (gaitCur === 'trot' ? 2.3 : 2.8)) g = 'trot';
        if (g !== gaitCur) {
          // 切り替えの瞬間の見た目（前の切り替えの途中なら、その混ざった姿勢）と、前の歩き方そのものの姿勢の差（carry）を覚えておき、混ぜる間ずっと足す（＝切り替えの瞬間に脚・体が飛ばない）
          prevPose = lastPose; gaitPrev = gaitCur; phA = ph; gaitCur = g; blendK = 0; blendT = 0; legW.fill(0); carry = null; slideX = 0;
          if (realN <= 1) { blendT = 9; legW.fill(1); } // まだ一度も動いていない（作ったばかり）なら混ぜずに切り替える
          if (lastPose) { const A0 = gaitPose(S, gaitPrev, phA, v, t, idle, gaitParams(S, gaitPrev, v, stretchK, fmNow()), stretchK); carry = { b: {}, l: lastPose.legs.map((L, i) => [L.F[0] - A0.legs[i].F[0], Math.max(0, L.F[1] - A0.legs[i].F[1])]) }; for (const f in lastPose) if (typeof lastPose[f] === 'number') carry.b[f] = lastPose[f] - (A0[f] || 0); }
        }
        if (st.boost !== undefined) boostTarget = clamp(st.boost, 0, 1);
        boostK += (boostTarget - boostK) * Math.min(1, dt * 4);
        // 追い（whip）・ニンジンの加速: 体を伸ばす（首を低く前へ、少し沈んで前傾、歩幅を大きく、耳を伏せ、尾を流す）
        const w = clamp(st.whip || 0, 0, 1);
        stretchK += ((g === 'gallop' ? Math.max(w * 0.75, boostK) : 0) - stretchK) * Math.min(1, dt * 3);
        const GP = gaitParams(S, g, v, stretchK, fmNow());
        const phOld = ph; ph = frac(ph + GP.f * Math.min(rawDt, 0.25));
        // 同じ場面で 30m 以内を駈歩・襲歩で走るほかの馬と、脚の周期の差が 0.09 秒より小さいまま並んで走るときは、前を行く方が少し速く・後ろの方が少し遅く脚を回して離れる（6 頭がそろって同じ脚にならない）
        if (rawDt > 0) {
          let push = 0;
          if ((g === 'gallop' || g === 'canter') && object3d.parent && GP.f > 0) {
            const sc0 = sceneOf(object3d), op = object3d.position;
            for (const r of LIVE) {
              if (r === rec || (r.g !== 'gallop' && r.g !== 'canter') || !r.o.parent || r.f <= 0) continue;
              const dx = r.o.position.x - op.x, dz = r.o.position.z - op.z; if (dx * dx + dz * dz > 900 || sceneOf(r.o) !== sc0) continue;
              // 比べるのは両方ともこのコマで進める前の周期（先に更新した馬の新しい周期と比べると、後の馬がいつも「前にいる」と見えてそろってしまう）
              let d = frac(phOld - (r.n === realN ? r.ph0 : r.ph) + 0.5) - 0.5; if (Math.abs(d) < 1e-6) d = rec.no > r.no ? 1e-6 : -1e-6;
              const td = Math.abs(d) / GP.f, rel = Math.abs(GP.f - r.f) / GP.f; // rel: 回る速さの差。差が大きい組はすぐ離れていくので押さない（そろったまま並んで走る組だけ離す）
              if (td < REP_T) push += Math.sign(d) * (1 - td / REP_T) * (1 - smooth(0.05, 0.1, rel));
            }
          }
          fmRep += (clamp(push * 0.15, -0.1, 0.1) - fmRep) * Math.min(1, rawDt * 4);
          rec.ph0 = phOld; rec.ph = ph; rec.n = realN; rec.f = GP.f; rec.g = g;
        }
        let P = gaitPose(S, g, ph, v, t, idle, GP, stretchK);
        const P0 = {}; for (const f in P) if (typeof P[f] === 'number') P0[f] = P[f]; // 下の味付け（追い・気分など）の前の値
        P.neck -= 0.1 * w + 0.08 * stretchK; P.head += 0.06 * w + 0.05 * stretchK; P.pitch -= 0.04 * stretchK; P.bob -= 0.035 * stretchK * S.legLen; P.ear -= 0.25 * stretchK; P.tail += (S.D.real ? -0.25 : 0.25) * stretchK;
        const moving = g !== 'stand' && g !== 'rear';
        if (moving) P.ear += (g === 'walk' ? 0.04 : 0.07) * Math.sin(TAU * (ph * (g === 'walk' || g === 'trot' ? 2 : 1) - 0.6)); // 耳も一歩ごとに揺れる
        // 停止中: ときどき首をくいっと上げる（ゲートで待つあいだ）
        if (g === 'stand') { const nod = Math.exp(-(((frac(t / 6.7 + (F.seed % 97) / 97) - 0.5) / 0.035) ** 2)); P.head += 0.16 * nod; P.neck += 0.05 * nod; }
        // ゲートイン（統合側が渡す。無ければ何もしない）: state.toss 0〜1 ＝ 首をくいっと振り上げる量（枠に近づくとき 0.1〜0.2 秒）、
        // state.sink 0〜0.05m ＝ 枠の中で体を沈める量（重心を移して小さく上下する。下げる向きだけ＝蹄は地面に着いたまま脚が少し曲がる）
        // 確定演出 gateLate のいやいやは 1.5 まで（ふつうの 1.5 倍）
        if (st.toss > 0) { const k = Math.min(1.5, st.toss); P.head += 0.3 * k; P.neck += 0.1 * k; }
        // state.balk 0〜1（確定演出 gateLate。止まった所で脚を踏ん張る）: 前を少し持ち上げて腰を落とす（前脚の付け根の高さはそのまま＝前脚は伸びきらない、後ろ脚が曲がる）、首を起こし、耳を伏せ、尾を振る
        if (st.balk > 0 && g === 'stand') { const b = Math.min(1, st.balk), pv = S.bones[S.BI.body].r, fx = Math.max(0.2, S.FJ.C[0] - pv[0]), a = 0.15 * b; P.pitch += a; P.bob -= fx * Math.sin(a); P.neck += 0.1 * b; P.ear -= 0.35 * b; P.tail += (S.D.real ? -0.25 : 0.25) * b; }
        if (st.sink > 0 && g === 'stand') P.bob -= Math.min(0.05, st.sink);
        // 気分（setMood）
        moodK += ((mood ? 1 : 0) - moodK) * Math.min(1, dt * 3);
        let hopT = 0, close = 0, droop = 0;
        if (mood === 'win' && g !== 'gallop') {
          const toss = Math.exp(-(((frac(t / (g === 'rear' ? 0.55 : 1.3)) - 0.3) / 0.12) ** 2)) * moodK;
          P.head += 0.32 * toss - (g === 'rear' ? 0.05 : 0); P.neck += 0.1 * toss; P.ear = lerp(P.ear, 0.3, moodK); P.tailAmp = (P.tailAmp || 0) * (1 + 1.5 * moodK); close = 0.85 * toss;
          if (g === 'stand') hopT = 0.13 * S.legLen * Math.max(0, Math.sin(TAU * t / 0.75)) * moodK;   // うれしくてぴょんぴょん
        } else if (mood === 'lose' && g !== 'gallop') {
          P.neck -= 0.2 * moodK; P.head -= 0.14 * moodK; P.ear = lerp(P.ear, -0.05, moodK); P.tail -= (S.D.real ? -0.3 : 0.3) * moodK; P.tailAmp = (P.tailAmp || 0) * (1 - 0.5 * moodK); droop = 0.55 * moodK; close = 0.3 * moodK;
        }
        earDroop += (droop - earDroop) * Math.min(1, dt * 4);
        hopY += (hopT - hopY) * Math.min(1, dt * 20); rig.position.y = hopY;
        // まばたき（2〜5 秒おき、ときどき 2 回）
        blinkT -= dt; if (blinkT <= 0) { blinkA = 0; blinkT = 1.8 + rnd() * 3.4; blinkDbl = rnd() < 0.25 ? 0.26 : 0; }
        blinkA += dt;
        const lid = blinkA < 0.15 ? Math.sin(PI * blinkA / 0.15) : (blinkDbl && blinkA > blinkDbl && blinkA < blinkDbl + 0.15 ? Math.sin(PI * (blinkA - blinkDbl) / 0.15) : 0);
        eyeS = 1 - 0.92 * Math.max(lid, close);
        // 前髪・たてがみの揺れ: 走っているときは一歩に合わせて遅れて揺れ、速いほど後ろへなびく。止まっているときはそよ風
        {
          const kD = Math.min(1, dt * 14), sp = clamp(v / 16, 0, 1.2);
          const A = g === 'gallop' ? 0.26 : g === 'canter' ? 0.2 : g === 'trot' ? 0.14 : g === 'walk' ? 0.07 : 0.03, cyc = g === 'walk' || g === 'trot' ? 2 : 1;
          for (let i = 0; i < 3; i++) {
            const tgt = moving ? 0.12 * sp + A * Math.sin(TAU * (ph * cyc - 0.22 - i * 0.07)) : 0.05 * Math.sin(t * 1.4 + i * 0.9) + 0.03 * Math.sin(t * 2.9 + i);
            maneA[i] += (tgt - maneA[i]) * kD;
          }
          const tf = moving ? 0.22 * sp + A * 1.2 * Math.sin(TAU * (ph * cyc - 0.3)) : 0.05 * Math.sin(t * 1.7) + (mood === 'win' ? 0.25 * close : 0);
          foreA += (tf - foreA) * kD;
        }
        if (blendT < 1.6 && gaitPrev && (blendK < 1 || legW.some((x) => x < 1))) {
          blendK = Math.min(1, blendK + dt / (gaitPrev === 'rear' && g === 'stand' ? 0.85 : 0.45)); blendT += dt;   // 立ち上がりから降りるときはゆっくり（0.85 秒。確定演出 gateLate の小さな立ち上がりで前脚が速く落ちて飛んで見えないように）
          const toStill = g === 'stand' || g === 'rear', GA = gaitParams(S, gaitPrev, v, stretchK, fmNow()); if (!toStill) phA = frac(phA + GA.f * Math.min(rawDt, 0.25)); // 止まるときは前の歩き方の脚をその場で止める（足踏みで蹄がこすれないように）
          const A = gaitPose(S, gaitPrev, phA, v, t, idle, GA, stretchK);
          if (carry) { for (const f in carry.b) A[f] = (A[f] || 0) + carry.b[f]; A.legs.forEach((L, i) => { L.F = [L.F[0] + carry.l[i][0], L.F[1] + carry.l[i][1]]; }); }
          const tsw = Math.max(0.12, GP.f > 0 ? 0.8 * (1 - GP.duty) / GP.f : 0.3), force = blendT > 1.2;
          const quick = (gaitPrev === 'stand' || gaitPrev === 'rear') && v > 2;
          let stepping = -1; // 両方とも着地中の脚は 1 本ずつ小さく踏み替える（止まるとき・遅いとき。持ち上げて置き直す＝地面をこすらない）
          for (let i = 0; i < 4; i++) {
            const inAir = !P.legs[i].stance || !A.legs[i].stance;
            if (quick) legW[i] = Math.min(1, legW[i] + dt / (0.08 + 0.03 * i)); // 止まった姿勢からいきなり速く動き出す（ゲートを飛び出す）: 4 本とも急いで新しい歩き方へ（体が先に行って蹄が置いていかれないように）
            else if (inAir || force) legW[i] = Math.min(1, legW[i] + dt / (force ? 0.15 : gaitPrev === 'rear' && toStill ? 0.9 : tsw));
            else if (toStill && legW[i] < 1 && stepping < 0 && !legW.some((x, j) => j !== i && x > 0 && x < 1 && P.legs[j].stance && A.legs[j].stance)) { legW[i] = Math.min(1, legW[i] + dt / 0.28); stepping = i; }
          }
          const wl = legW.map((x) => smooth(0, 1, x));
          P = blendPose2(A, P, smooth(0, 1, blendK), wl);
          for (let i = 0; i < 4; i++) if (wl[i] > 0 && wl[i] < 1 && A.legs[i].stance && P.legs[i].stance) { P.legs[i] = Object.assign({}, P.legs[i], { stance: false, u: wl[i], fold: 0.4 * Math.sin(PI * wl[i]) }); P.legs[i].F = [P.legs[i].F[0], P.legs[i].F[1] + 0.09 * S.legLen * Math.sin(PI * wl[i])]; }
        } else { blendK = 1; legW.fill(1); }
        lastPose = P;
        whipK += ((w > 0.05 && g === "gallop" && jPose !== 'celebrate' ? 1 : 0) - whipK) * Math.min(1, dt * 5); whipT += dt * TAU * (1.5 + 0.8 * w);
        if (st.jockeyPose !== undefined) horse.setJockeyPose(st.jockeyPose);
        celK += ((jPose === 'celebrate' ? 1 : 0) - celK) * Math.min(1, dt * 4); celT += dt;
        if (st.surface) surface = st.surface === "dirt" ? "dirt" : "turf";
        if (st.jockey !== undefined) horse.setJockey(st.jockey);
        if (st.mood !== undefined) horse.setMood(st.mood);
        applyPose(P); if (jockeyOn) applyJockey(P);
        updateDust(dt, P, g, v);
        // ニンジンの加速の光
        boostU.bT.value = performance.now() / 1000;
        updateGlint(dt);
        const bv = boostK > 0.01; aura.visible = bv; ghosts.forEach((m, i) => { m.visible = bv && quality === "high"; }); auraMat.userData.k.value = boostK; ghostMat.userData.k.value = boostK * 0.8;
        leanCur += ((st.lean || 0) - leanCur) * Math.min(1, dt * 4);
        rig.rotation.x = 0; if (Math.abs(leanCur) > 1e-4) leanBones(-leanCur);
        if (saved) { gaitCur = saved.gaitCur; blendK = saved.blendK; blendT = saved.blendT; gaitPrev = saved.gaitPrev; phA = saved.phA; carry = saved.carry; slideX = saved.slideX; lastPose = saved.lastPose; saved.legW.forEach((x, i) => (legW[i] = x)); }
      },
      // 気分: 'win'（首を振る・目を細める・止まっていれば跳ねる）| 'lose'（うなだれる・耳が垂れる）| null。全力疾走中は変えない。state.mood でも渡せる
      setMood(m) { mood = m === 'win' || m === 'lose' ? m : null; },
      get mood() { return mood; },
      // 1 頭ごとの顔だち（確認用）: { eye, fore, mane, face, maneCol }
      face: { eye: F.eye, fore: F.fore, mane: F.mane, face: F.face, maneCol: F.maneCol },
      dust: true, // 土煙は馬の部品が出す（統合側の粒は止めてよい）
      setQuality(qq) {
        if (qq === 'xfar') qq = 'far'; // 2026-10-29: いちばん粗い形 'xfar'（R3D.Horse だけにある）は、この部品では 'far' と同じ
        if (qq !== 'low' && qq !== 'high' && qq !== 'far') return; if (qq === quality) return; quality = qq;
        bodyMesh.geometry = lineMesh.geometry = horseGeometry(S, coat, markIdx, quality, mare, F); aura.geometry = bodyMesh.geometry;
        ghosts.forEach((g) => { g.geometry = bodyMesh.geometry; }); tMesh.geometry = tackGeometry(S, quality, jockeyOn);
        // 切り替えた形も数える（QA3: Fire TV の far・遠くの馬の形が捨てられずに増えていた）
        { const nk = bodyMesh.geometry.userData.cacheKey; if (nk !== geoKey && !disposed) { geoRef(nk, 1); geoRef(geoKey, -1); geoKey = nk; } }
        lineMesh.visible = quality === "high" && opts.outline === true;
      },
      setOutline(on) { lineMesh.visible = !!on; },
      // 騎手を乗せる・降ろす（パドックでは降ろすなど）
      setJockey(on) { on = !!on; if (on === jockeyOn) return; jockeyOn = on; tMesh.geometry = tackGeometry(S, quality, jockeyOn); },
      get jockey() { return jockeyOn; },
      // 騎手の姿勢: 'celebrate'（勝ったときのガッツポーズ: 右手のムチを突き上げて拍に合わせて振り、胴を起こして揺れる。ずっと繰り返せる）| null（ふつう）。state.jockeyPose でも渡せる。切り替えは約 0.5 秒でなめらかに
      setJockeyPose(p) { jPose = p === 'celebrate' ? 'celebrate' : null; },
      get jockeyPose() { return jPose; },
      // ニンジンの加速（0〜1。青紫の炎の光と残像）。state.boost でも渡せる
      setBoost(k) { boostTarget = clamp(k || 0, 0, 1); },
      // 確定演出: 目をきらっと光らせる（dur 秒。elapsed 秒ぶん進んだ所から始める＝途中から見始めたテレビも同じ瞬間に消える）。R3D.Horse と R3D.HorseReal で同じ使い方
      flashEye(dur, elapsed) { if (!glint) glint = makeGlint(); glintDur = Math.max(0.1, +dur || 0.45); glintT = Math.max(0, +elapsed || 0); updateGlint(0); },
      get eyeFlash() { return glintT >= 0 ? glintT / glintDur : null; },   // 確認用: 光っている途中なら 0〜1
      // 足元の輪を太く明るく（自分の賭けた馬など）
      // 2026-10-21: 文字（Noto Sans JP）が読めたあとに、ゼッケンと足元の札の馬番を描き直す（js/race3d.js の setRace が呼ぶ）
      refreshText() { const old = tMat.map; tMat.map = atlasTexture(h); tMat.needsUpdate = true; if (old && old !== clothTex) old.dispose(); const bg = ring && ring.userData.badges; if (bg && bg.userData.cv) { drawBadge(bg.userData.cv, h, ringGold); bg.userData.tex.needsUpdate = true; } },
      setRingHighlight(on) { if (!ring) return; ringStrong = !!on; drawRing(ring.userData.cv, h, ringStrong, ringGold); ring.userData.tex.needsUpdate = true; },
      get ringGlow() { return ringGold; },   // 確認用: 確定演出 eye で足元の輪・札が光っている間 true
      setRingVisible(on) { if (ring) ring.visible = ring.userData.badges.visible = !!on; },
      // 馬場（土煙の色）: "turf" | "dirt"。state.surface でも渡せる
      setSurface(s) { surface = s === "dirt" ? "dirt" : "turf"; },
      // 蹄が着くたびに呼ばれる（統合側で土煙や足音を出したいとき）: fn({ x, y, z, leg, gait, speed })
      set onStep(fn) { onStep = typeof fn === "function" ? fn : null; }, get onStep() { return onStep; },
      set dustBoost(k) { dustK = Math.max(0.5, Math.min(2.5, +k || 1)); }, get dustBoost() { return dustK; },   // 土煙の強さ（1 = ふつう。統合側が直線の先頭 2 頭を 1.7 に）
      dispose() {
        clothTex.dispose(); if (tMat.map && tMat.map !== clothTex) tMat.map.dispose(); tMat.dispose(); auraMat.dispose(); ghostMat.dispose(); skeleton.dispose(); if (glint) glint.mat.dispose();
        if (glint && glint.rglow) glint.rglow.material.dispose();
        if (ring) { ring.userData.tex.dispose(); ring.userData.mat.dispose(); ring.userData.badges.userData.tex.dispose(); ring.userData.badges.userData.mats.forEach((m) => m.dispose()); }
        if (dustSys) { dustSys.free(dustSlot); dustSys = null; dustSlot = -1; }
        LIVE.delete(rec);
        if (object3d.parent) object3d.parent.remove(object3d);
        if (!disposed) { disposed = true; geoRef(geoKey, -1); }
      },
      get gait() { return gaitReq; }, get gaitInner() { return gaitCur; }, get pose() { return lastPose; }, get phase() { return ph; }, get groundSpeed() { return vMeas; },
      get stride() { return { f: rec.f, rhythm, rep: fmRep }; },   // 確認用: 1 秒あたりの完歩数・1 頭ごとのリズム・ほかの馬とずらしている量
      meshes: [bodyMesh, lineMesh, tMesh],
      // カメラ用: 体の大きさ（休みの姿勢、m）と頭の位置（世界座標）
      size: { height: S.ne[1] + S.D.hR * 1.1 + S.D.ear, withers: S.yb + S.D.R, length: S.head.B0[0] + S.D.hL * Math.cos(S.D.hA * DEG) - S.xr },
      getHeadPosition(out) { out = out || new THREE.Vector3(); return B("head").localToWorld(out.copy(headMid)); },
      // 鼻先の位置（世界座標。写真判定の拡大窓が使う。R3D.Horse と同じ。2026-10-14 統合で追加）: 頭の骨の休みの姿勢での鼻先を、いまの頭の骨の向きで動かす
      // 出馬表の顔の絵の写し方（js/race3d.js の portrait が使う。目印 'head' からの注視点のずれと、注視点からのカメラの位置。2026-10-14 統合で追加: 既定の写し方では騎手の帽子が切れた）
      portraitView: { fx: -0.15, fy: 0.12, cx: 2.0, cy: 0.25, cz: 3.6, fov: 24 },
      getNosePosition(out) { out = out || new THREE.Vector3(); return B("head").localToWorld(out.copy(noseTip)); },
    };
    horse.update(0, { gait: 'stand', speed: 0 });
    return horse;
  }
  function disposeShared() {
    for (const k in geoCache) { geoCache[k].dispose(); delete geoCache[k]; delete geoRefs[k]; }
    geoIdle.length = 0;
    for (const k in tackCache) { tackCache[k].dispose(); delete tackCache[k]; }
    for (const k in matCache) { matCache[k].dispose(); delete matCache[k]; }
    for (const k in texCache) { texCache[k].dispose(); delete texCache[k]; }
  }
  // faceOf(h): 1 頭ごとの顔だち { eye, fore, mane, face, maneCol }（出馬表など 3D 以外で同じ見た目を描きたいとき用）
  return { create, disposeShared, faceOf, COATS: Object.keys(COATS), TYPES: Object.keys(TYPES), EYES, FORES, MANES, FACEM, outline: outlineU };
})();
