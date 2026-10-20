/* casa DERBY 3D のレース映像（統合）— 2D の Race（js/race.js）と同じ使い方の Race3D。
   レースの進行（Engine.createRun で 1 コマずつ走らせる・進路取り・実況・スロー・リプレイ・勝ち馬のアップ・パドック 18 秒）は
   2D 版とまったく同じ。絵だけを three.js で描き、テロップ（時計・通過順・コース図・字幕）は上に重ねた 2D キャンバス（#race）に描く。
   部品: R3D.Horse（馬）・R3D.Venue（会場）・R3D.Look（光と空）・R3D.Director（カメラ）。
   まだ無い・壊れている部品は、ここにある簡単な代わり（箱の馬・平らな芝・2D 版と同じカメラ台本）で動かす。
   WebGL が使えないときは index.html の最後で 2D の Race のままにする（window.Race を差し替えない）。 */
window.R3D = window.R3D || {};
window.Race3D = (function () {
  'use strict';
  const Race2D = window.Race;            // 2D 版（静的な道具を借りる・失敗したときの控え）
  if (!window.THREE || !R3D.Course || !Race2D) return null; // three.js が読めない（オフラインなど）→ 2D のまま
  const W = 1000, H = 480, ASPECT = W / H;
  const C = R3D.Course;
  const LS = C.LS, RC = C.RC, L = C.L, RI = C.RI, RO = C.RO, FINISH_S = C.FINISH_S, pointAt = C.pointAt, outward = C.outward, laneR = C.laneR;
  const PD = C.PADDOCK;
  const PADDOCK_SEC = 18;
  const QS = location.search;
  // 解像度の上限（画素密度の倍率）。きれいさ優先で、ふつうの機械は 2 倍まで（?hd=1.5 などで指定可）。軽い描き方では 1 倍
  // 解像度の上限（画素密度の倍率）。ふつうは 1.5 倍から始め、60fps を保てないときだけ 0.25 ずつ下げる（?hd=2 で 2 倍から）
  const HD = Number((QS.match(/[?&]hd=([\d.]+)/) || [])[1] || 0), MAXK = Math.max(1, Math.min(2, HD || 1.5));
  const QMODE = (() => { try { return localStorage.getItem('casa.derby.q') || ''; } catch (e) { return ''; } })(); // 2026-10-19: 管理者が店舗の設定で選んだテレビの画質（v2/tvswitch.js）。'max'＝最高、'sharp'＝軽い描き方のまま細かさ 1.2 倍で固定
  const MAXQ = QMODE === 'max';
  const ADAPT = !/[?&]adapt=0/.test(QS) && !MAXQ;                         // ?adapt=0 で自動の画質調整を止める（重さの測定用）
  const STD_CAM = /[?&]cam=std/.test(QS);
  const LAYOUT_OLD = /[?&]layout=old/.test(QS);
  const THEME = (QS.match(/[?&]theme=(\w+)/) || [])[1] || '';   // 会場の季節・時間（normal / autumn / sakura / night）   // テスト用: カメラ担当の部品を使わず 2D 版と同じカメラ台本で撮る
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /* 確定演出（2026-10-16 オーナー決定）の確認用の上書き ?cues=fruit:2,eye:2（0 始まりの馬の添字。鍵: fruit crowd sign cloud gateLate eye）。
     v2 のテレビ（v2/tv.js）が setCues を呼ばないとき（一人用・写真を撮るとき）に使う */
  const CUES_Q = (() => { const m = QS.match(/[?&]cues=([^&#]*)/); if (!m) return null; const o = {}; decodeURIComponent(m[1]).split(',').forEach((p) => { const kv = /^([A-Za-z]+)[:=](\d+)$/.exec(p.trim()); if (kv) o[kv[1]] = { horse: Number(kv[2]) }; }); return Object.keys(o).length ? o : null; })();
  const CUE_KEYS = ['fruit', 'crowd', 'sign', 'cloud', 'gateLate', 'eye'];
  const EYE_R = 470, EYE_DUR = 2.0, EYE_WAIT = 1.0;   // eye: 先頭の残りがこの m になった瞬間（最終コーナーの動くカメラ L_SWING は残り 480m から。切り替わって約 0.5 秒後）に、その馬の目が EYE_DUR 秒光る（0.3 秒きらっ → 1.4 秒ゆっくり脈打つ金色の光の輪（約 2.2m）＋頭から舞い上がる小さな光 → 0.3 秒で消える）。
                                                         // そのとき頭がカメラからほかの馬に隠れていれば、見えるまで最大 EYE_WAIT 秒待つ（馬の位置とカメラから決まる＝どの店でも同じ）
  // 演出の形をそろえる: { 鍵: { horse: 0〜n-1 } } だけ残す（数だけ渡されても { horse } に）。何も残らなければ null
  function normCues(c, n) {
    if (!c || typeof c !== 'object') return null;
    const o = {}; let any = false;
    CUE_KEYS.forEach((k) => { const v = c[k], h = v == null ? NaN : typeof v === 'object' ? Number(v.horse) : Number(v); if (Number.isInteger(h) && h >= 0 && (!n || h < n)) { o[k] = { horse: h }; any = true; } });
    return any ? o : null;
  }
  const DEG = 180 / Math.PI;
  // 2D 版の「横の画角」⇔ three.js の「縦の画角」
  const h2v = (h) => 2 * Math.atan(Math.tan(h / 2 / DEG) * H / W) * DEG;
  const v2h = (v) => 2 * Math.atan(Math.tan(v / 2 / DEG) * W / H) * DEG;

  // 一度だけ警告を出す（毎コマ同じエラーでコンソールを埋めない）
  const warned = {};
  // 局のロゴ（レース映像の左下。リプレイ・ハイライトも同じ）: 新しいロゴの横長版（art/logo-3d/B/lockup-3d-B-casaWhite.svg）を読み、
  // 読めたら描く大きさで 1 回だけ小さなキャンバスに焼いて、毎コマはそれを貼る（毎コマ SVG を描き直さない）。SVG が読めなければ PNG、それもだめなら文字のロゴ
  const LOGO_BASE = (() => { try { return new URL('../art/logo-3d/B/', document.currentScript.src).href; } catch (e) { return 'art/logo-3d/B/'; } })();
  const LOGO_SRCS = [LOGO_BASE + 'lockup-3d-B-casaWhite.svg', LOGO_BASE + 'png/lockup-3d-B-casaWhite-2x.png'];
  let hudLogoImg = null, hudLogoTry = 0, hudLogoBake = null, hudLogoBakeH = 0;
  function hudLogoLoad() {
    if (hudLogoTry >= LOGO_SRCS.length) return;
    const img = new Image(), src = LOGO_SRCS[hudLogoTry++];
    img.onload = () => { if (img.naturalWidth && img.naturalHeight) { hudLogoImg = img; hudLogoBake = null; } else hudLogoLoad(); };
    img.onerror = () => { warnOnce('局のロゴの読み込み（' + src.split('/').pop() + '）', src); hudLogoLoad(); };
    img.src = src;
  }
  function hudLogo(px) { /* px: 実際の画素での高さ。その大きさで焼いたキャンバスを返す（まだ読めていなければ null） */
    if (!hudLogoImg) { if (!hudLogoTry) hudLogoLoad(); return null; }
    const ph = Math.max(8, Math.round(px));
    if (hudLogoBake && hudLogoBakeH === ph) return hudLogoBake;
    try {
      const w = Math.round(ph * hudLogoImg.naturalWidth / hudLogoImg.naturalHeight), cv = document.createElement('canvas');
      cv.width = w; cv.height = ph; const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(hudLogoImg, 0, 0, w, ph);
      hudLogoBake = cv; hudLogoBakeH = ph; return cv;
    } catch (e) { warnOnce('局のロゴ', e); hudLogoImg = null; hudLogoTry = LOGO_SRCS.length; return null; }
  }
  try { hudLogoLoad(); } catch (e) { /* 読み込みは最初に描くときにもう一度 */ }
  function warnOnce(key, e) { if (warned[key]) return; warned[key] = 1; console.warn('casa DERBY 3D: ' + key + ' で問題（代わりの部品で続けます）', e); }

  /* ===================================================================================
     代わりの部品（担当の部品がまだ無い・壊れているとき用。見た目は最低限、軽さ優先）
     =================================================================================== */
  const Stub = {};
  // 光と空: 半球光＋太陽 1 灯、単色の空と霧
  Stub.look = function (renderer, scene, opt) {
    const low = opt.quality === 'low', S = C.SUN;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = !low; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const hemi = new THREE.HemisphereLight(0xe4f0ff, 0x5c7a3c, 0.8); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.05); sun.position.set(S.x * 300, S.y * 300, S.z * 300);
    sun.castShadow = !low; sun.shadow.mapSize.set(1024, 1024); const sc = sun.shadow.camera; sc.left = sc.bottom = -45; sc.right = sc.top = 45; sc.near = 50; sc.far = 600; sun.shadow.bias = -0.0006;
    scene.add(sun); scene.add(sun.target);
    const WX = { sunny: [0x8ec3ee, 0xcfe0ea, 1.05], cloudy: [0xaebccb, 0xd5dce2, 0.8], rain: [0x7d8994, 0xa9b2ba, 0.6] };
    function setWeather(w) { const v = WX[w] || WX.sunny; scene.background = new THREE.Color(v[0]); scene.fog = new THREE.Fog(v[1], 200, w === 'rain' ? 700 : 1500); sun.intensity = v[2]; }
    setWeather('sunny');
    const dir = new THREE.Vector3(), foc = new THREE.Vector3();
    return {
      setWeather,
      update(dt, camera) { // 影の範囲をカメラの見ている地面の近くへ
        camera.getWorldDirection(dir); const k = dir.y < -0.01 ? Math.min(160, -camera.position.y / dir.y) : 60;
        foc.copy(camera.position).addScaledVector(dir, k); foc.y = 0;
        sun.target.position.copy(foc); sun.position.set(foc.x + S.x * 300, S.y * 300, foc.z + S.z * 300);
      },
      render(r, s, c) { r.render(s, c); },
    };
  };
  // 会場: 広い芝の地面、コースの帯、白いラチ（線）、ゴール板、発走ゲート、パドックの楕円、スタンドの箱
  Stub.venue = function (scene, opt) {
    const g = new THREE.Group(); scene.add(g);
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), lam(0x6f9e3c)); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; g.add(ground);
    // コースの帯（周回の s に沿った三角形の帯）
    function ring(r0, r1, y, n) {
      const pos = [], idx = []; n = n || 240;
      for (let k = 0; k <= n; k++) { const s = k / n * L, a = pointAt(s, r0), b = pointAt(s, r1); pos.push(a.x, y, a.z, b.x, y, b.z); if (k < n) { const j = k * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); } }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals(); return geo;
    }
    const trackMat = lam(0x86bd45), track = new THREE.Mesh(ring(RI, RO, 0, 240), trackMat); track.receiveShadow = true; g.add(track);
    const rail = (r) => { const pts = []; for (let k = 0; k <= 240; k++) { const p = pointAt(k / 240 * L, r); pts.push(new THREE.Vector3(p.x, 1.0, p.z)); } return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff })); };
    g.add(rail(RI - 0.4)); g.add(rail(RO + 0.4));
    const gp = pointAt(FINISH_S, RO + 1.2), post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), lam(0xffffff)); post.position.set(gp.x, 2, gp.z); g.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 1.6), lam(0xd23b3b)); board.position.set(gp.x, 3.8, gp.z); g.add(board);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(LS + 120, 22, 30), lam(0xb9b6ae)); stand.position.set(10, 11, RO + 44 + 15); g.add(stand);
    // パドック（楕円の周回路）
    const pdk = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 64), lam(0xbc9f74)); pdk.rotation.x = -Math.PI / 2; pdk.scale.set(PD.a, PD.b, 1); pdk.position.set(PD.cx, 0.01, PD.cz); g.add(pdk);
    // 発走ゲート（青い枠の箱）
    const gate = new THREE.Group(); g.add(gate);
    const n6 = 6, w = laneR(n6 - 1) - laneR(0) + 2;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.4, w), lam(0x2f5fa8)); beam.position.y = 2.9; gate.add(beam);
    for (let k = 0; k <= n6; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.6, 0.08), lam(0xb4bec9)); p.position.set(0, 1.6, -w / 2 + k * w / n6); gate.add(p); }
    const doors = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, w), lam(0xe6ebf0)); doors.position.set(1.25, 1.15, 0); gate.add(doors);
    return {
      setRace(o) {
        trackMat.color.set(o.surface === 'dirt' ? 0xb9a98a : 0x86bd45);
        const s = (C.gateS ? C.gateS(o.dist) : C.startS(o.dist)) - 0.35, p = pointAt(s, (laneR(0) + laneR(n6 - 1)) / 2); gate.position.set(p.x, 0, p.z); gate.rotation.y = Math.atan2(-p.hz, p.hx);
      },
      setRearDoors() {},
      setGate(st) { gate.visible = st !== 'hidden'; doors.visible = st === 'closed'; },
      setBoard() {},
      update() {},
    };
  };
  // 馬: 箱と円柱の簡単な馬（毛色・勝負服の色・脚の動き）
  const STUB_GEO = {};
  Stub.horse = function (h) {
    const G = STUB_GEO;
    if (!G.body) { G.body = new THREE.BoxGeometry(1.7, 0.75, 0.62); G.neck = new THREE.BoxGeometry(0.75, 0.35, 0.3); G.head = new THREE.BoxGeometry(0.55, 0.28, 0.26); G.leg = new THREE.BoxGeometry(0.14, 0.95, 0.14); G.jock = new THREE.BoxGeometry(0.4, 0.55, 0.42); G.cap = new THREE.SphereGeometry(0.15, 8, 6); G.tail = new THREE.BoxGeometry(0.5, 0.12, 0.12); G.leg.translate(0, -0.47, 0); }
    const coat = (Race2D && Race2D.COATS && Race2D.COATS[h.coat]) || { body: '#9a6132', mane: '#2d1a0c' };
    const mBody = new THREE.MeshLambertMaterial({ color: coat.body }), mMane = new THREE.MeshLambertMaterial({ color: coat.mane });
    const silk = h.silk || {}, mSilk = new THREE.MeshLambertMaterial({ color: silk.base || h.color || '#ffffff' }), mCap = new THREE.MeshLambertMaterial({ color: silk.accent || h.ink || '#222222' });
    const o = new THREE.Group(), add = (geo, mat, x, y, z, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rz) m.rotation.z = rz; m.castShadow = true; o.add(m); return m; };
    add(G.body, mBody, 0, 1.3, 0);
    add(G.neck, mBody, 0.95, 1.62, 0, 0.75); add(G.head, mBody, 1.22, 1.88, 0, -0.35); add(G.tail, mMane, -0.98, 1.4, 0, 0.6);
    const legs = [[0.65, 0.2], [0.65, -0.2], [-0.65, 0.2], [-0.65, -0.2]].map((p) => add(G.leg, mBody, p[0], 0.98, p[1]));
    const jock = add(G.jock, mSilk, 0.15, 1.95, 0); add(G.cap, mCap, 0.25, 2.3, 0);
    let ph = Math.random() * 6.283;
    return {
      object3d: o, no: h.no, type: h.type, src: h, coat: h.coat,
      update(dt, st) {
        const sp = st.speed || 0, gait = st.gait;
        ph += dt * (gait === 'gallop' ? 2.3 : gait === 'canter' ? 1.8 : gait === 'walk' ? 0.9 : 0) * 6.283;
        const amp = gait === 'gallop' ? 0.7 : gait === 'canter' ? 0.5 : gait === 'walk' ? 0.25 : 0;
        legs.forEach((lg, k) => { lg.rotation.z = Math.sin(ph + (k < 2 ? 0 : Math.PI) + (k % 2) * 0.5) * amp; });
        o.children[0].position.y = 1.3 + (amp ? Math.abs(Math.sin(ph)) * 0.06 * amp : 0);
        jock.position.y = 1.95 + (sp > 6 ? -0.15 : 0);
        o.rotation.x = st.lean ? st.lean * 0.6 : 0;
      },
      setQuality() {},
      dispose() { [mBody, mMane, mSilk, mCap].forEach((m) => m.dispose()); },
    };
  };
  // パドックの厩務員（白いシャツ・紺のズボン・紺の帽子、胸に馬番の色。馬の頭の内側を歩く。丸みのある簡単な人形）
  const HAND_GEO = {};
  function makeHandler(h) {
    const G = HAND_GEO;
    if (!G.body) {
      G.body = new THREE.CapsuleGeometry(0.19, 0.42, 4, 10); G.leg = new THREE.CapsuleGeometry(0.075, 0.62, 3, 8); G.leg.translate(0, -0.38, 0);
      G.arm = new THREE.CapsuleGeometry(0.055, 0.44, 3, 8); G.arm.translate(0, -0.27, 0); G.head = new THREE.SphereGeometry(0.2, 16, 12);
      G.cap = new THREE.SphereGeometry(0.207, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); G.brim = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 14); G.brim.translate(0.17, 0, 0);
      G.bib = new THREE.PlaneGeometry(0.26, 0.24); G.shoe = new THREE.BoxGeometry(0.2, 0.07, 0.1); G.shoe.translate(0.04, 0, 0);
    }
    const mats = [new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0xe8c3a0, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0x1d2a44, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: h.color || '#ffffff', roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 })];
    const o = new THREE.Group(), add = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; (parent || o).add(m); return m; };
    const legs = [-0.1, 0.1].map((z) => { const lg = add(G.leg, mats[1], 0, 0.86, z); add(G.shoe, mats[5], 0, -0.74, 0, lg); return lg; });
    add(G.body, mats[0], 0, 1.2, 0);
    const arms = [-0.25, 0.25].map((z) => add(G.arm, mats[0], 0, 1.43, z));
    add(G.head, mats[2], 0, 1.74, 0); add(G.cap, mats[3], 0, 1.77, 0); add(G.brim, mats[3], 0, 1.78, 0);
    o.scale.setScalar(0.86); // かわいい馬に合わせて少し小さく、頭は大きめ
    const bib = new THREE.Mesh(G.bib, mats[4]); bib.position.set(0.2, 1.22, 0); bib.rotation.y = Math.PI / 2; o.add(bib);
    let ph = Math.random() * 6.283;
    // right: 右手で引く（ゲートの係員は馬の左＝内側に立つので、馬は係員の右）。hold=false で綱を放して両手を振る
    o.userData.walk = (dt, v, right, hold) => {
      ph += dt * v * 3.2; const a = Math.sin(ph) * 0.45 * Math.min(1, v); legs[0].rotation.z = a; legs[1].rotation.z = -a;
      const lead = right ? arms[1] : arms[0], free = right ? arms[0] : arms[1];
      free.rotation.z = right ? a * 0.7 : -a * 0.7; free.rotation.x = 0;
      if (hold === false) { lead.rotation.z = right ? -a * 0.7 : a * 0.7; lead.rotation.x = 0; }
      else { lead.rotation.z = a * 0.35 + 0.55; lead.rotation.x = right ? -0.25 : 0.25; }
    };
    o.userData.legs = legs; o.userData.arms = arms; o.userData.color = h.color || '#ffffff';
    o.userData.hand = arms[0]; // 引き手（左手。馬は厩務員の左にいる）: 綱をここから馬の頭へ
    o.userData.handR = arms[1]; // ゲートの係員は右手で引く
    o.userData.dispose = () => mats.forEach((m) => m.dispose());
    return o;
  }
  // 引き綱（手から馬の頭まで。細い円柱を 2 本つないで少したるませる）
  const ROPE_GEO = new THREE.CylinderGeometry(0.018, 0.018, 1, 6, 1); ROPE_GEO.translate(0, 0.5, 0);
  const ROPE_MAT = new THREE.MeshStandardMaterial({ color: 0x6b3a1e, roughness: 0.8 });
  function makeRope() { const g = new THREE.Group(); g.add(new THREE.Mesh(ROPE_GEO, ROPE_MAT), new THREE.Mesh(ROPE_GEO, ROPE_MAT)); g.visible = false; g.userData.isRope = true; return g; }
  const _ha = new THREE.Vector3(), _hb = new THREE.Vector3(), _hm = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _dv = new THREE.Vector3();
  function seg(mesh, a, b) { _dv.subVectors(b, a); const len = _dv.length() || 1e-3; mesh.position.copy(a); mesh.scale.set(1, len, 1); mesh.quaternion.setFromUnitVectors(_up, _dv.divideScalar(len)); }
  function setRope(g, a, b) { _hm.addVectors(a, b).multiplyScalar(0.5); _hm.y -= Math.min(0.3, a.distanceTo(b) * 0.15); seg(g.children[0], a, _hm); seg(g.children[1], _hm, b); g.visible = true; }

  /* ===================================================================================
     Fire TV 向け（?q=tv）: 係員（白いシャツの人）と引き綱をまとめて描く。ふつうは 1 人 13 回の描画を、6 人分で 5 回に。
     形と色は makeHandler と同じ（胴・頭・帽子・つばは 1 つの形に、脚と靴も 1 つに）。動き（脚・腕の振り・綱）は元の部品の位置をそのまま写す（元の部品は描かない）
     =================================================================================== */
  function mergeGeo(parts) { // parts: [{ g: BufferGeometry, m: Matrix4, c: 色 }] → 頂点色つきの 1 つの形
    let nv = 0, ni = 0; parts.forEach((q) => { nv += q.g.attributes.position.count; ni += q.g.index ? q.g.index.count : q.g.attributes.position.count; });
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni), v = new THREE.Vector3(), nm = new THREE.Matrix3(), c = new THREE.Color();
    let vo = 0, io = 0;
    parts.forEach((q) => {
      const P = q.g.attributes.position, N = q.g.attributes.normal; nm.getNormalMatrix(q.m); c.set(q.c);
      for (let i = 0; i < P.count; i++) { const k = (vo + i) * 3; v.fromBufferAttribute(P, i).applyMatrix4(q.m); pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z; v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[k] = v.x; nor[k + 1] = v.y; nor[k + 2] = v.z; col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; }
      if (q.g.index) for (let i = 0; i < q.g.index.count; i++) idx[io++] = q.g.index.getX(i) + vo; else for (let i = 0; i < P.count; i++) idx[io++] = vo + i;
      vo += P.count;
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }
  function makeHandBatch(scene, handlers) {
    const G = HAND_GEO, T4 = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z), n = handlers.length;
    const torso = mergeGeo([{ g: G.body, m: T4(0, 1.2, 0), c: 0xf4f4f2 }, { g: G.head, m: T4(0, 1.74, 0), c: 0xe8c3a0 }, { g: G.cap, m: T4(0, 1.77, 0), c: 0x1d2a44 }, { g: G.brim, m: T4(0, 1.78, 0), c: 0x1d2a44 }]);
    const leg = mergeGeo([{ g: G.leg, m: new THREE.Matrix4(), c: 0x2b2d42 }, { g: G.shoe, m: T4(0, -0.74, 0), c: 0x222222 }]);
    const bibG = G.bib.clone(); bibG.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0.2, 1.22, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1)));
    const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    const mk = (geo, mat, max) => { const m = new THREE.InstancedMesh(geo, mat, max); m.frustumCulled = false; m.count = 0; m.visible = false; m.name = 'handBatch'; scene.add(m); return m; };
    const B = { torso: mk(torso, vc, n), leg: mk(leg, vc, n * 2), arm: mk(G.arm, new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.8 }), n * 2), bib: mk(bibG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), n), rope: mk(ROPE_GEO, ROPE_MAT, n * 2), own: [torso, leg, bibG, vc] };
    B.cols = handlers.map((hd) => new THREE.Color(hd.userData.color || '#ffffff'));
    for (let i = 0; i < n; i++) B.bib.setColorAt(i, B.cols[i]);
    handlers.forEach((hd) => { hd.traverse((m) => { if (m.isMesh) m.visible = false; }); const r = hd.userData.rope; if (r) r.children.forEach((m) => { m.visible = false; }); });
    B.dispose = () => { ['torso', 'leg', 'arm', 'bib', 'rope'].forEach((k) => scene.remove(B[k])); B.own.forEach((x) => x.dispose()); B.arm.material.dispose(); B.bib.material.dispose(); };
    return B;
  }
  function updateHandBatch(B, scene, handlers) {
    scene.updateMatrixWorld();
    let nt = 0, nl = 0, na = 0, nr = 0;
    handlers.forEach((hd, i) => {
      if (hd.visible) {
        B.torso.setMatrixAt(nt, hd.matrixWorld); B.bib.setMatrixAt(nt, hd.matrixWorld); B.bib.setColorAt(nt, B.cols[i]); nt++;
        hd.userData.legs.forEach((l) => B.leg.setMatrixAt(nl++, l.matrixWorld)); hd.userData.arms.forEach((a) => B.arm.setMatrixAt(na++, a.matrixWorld));
      }
      const r = hd.userData.rope; if (r && r.visible) r.children.forEach((c) => B.rope.setMatrixAt(nr++, c.matrixWorld));
    });
    [[B.torso, nt], [B.bib, nt], [B.leg, nl], [B.arm, na], [B.rope, nr]].forEach(([m, k]) => { m.count = k; m.visible = k > 0; m.instanceMatrix.needsUpdate = true; });
    if (B.bib.instanceColor) B.bib.instanceColor.needsUpdate = true;
  }

  /* ===================================================================================
     土ぼこり（蹴り上げた芝・砂の粒。1 回の描画呼び出しで全部）
     =================================================================================== */
  function makeDust(scene, max) {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(max * 3), col = new Float32Array(max * 4), size = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 4)); geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute float size; attribute vec4 color; varying vec4 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = clamp(size * 480.0 * projectionMatrix[1][1] * 0.5 / -mv.z, 0.0, 24.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - r * 2.5)); }',
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
    return {
      max,
      set(list) {
        const n = Math.min(max, list.length);
        for (let k = 0; k < n; k++) { const d = list[k], j = k * 3, c = d.rgb; pos[j] = d.x; pos[j + 1] = d.y; pos[j + 2] = d.z; col[k * 4] = c[0]; col[k * 4 + 1] = c[1]; col[k * 4 + 2] = c[2]; col[k * 4 + 3] = Math.max(0, Math.min(1, d.a)); size[k] = d.r * 2; }
        geo.setDrawRange(0, n); pts.visible = n > 0;
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.attributes.size.needsUpdate = true;
      },
    };
  }
  const DUST_RGB = { dirt: [196 / 255, 160 / 255, 112 / 255], turfA: [92 / 255, 120 / 255, 52 / 255], turfB: [120 / 255, 96 / 255, 64 / 255] };

  /* ===================================================================================
     Race3D 本体
     =================================================================================== */
  /* 画質の段: 'high'（ふつう）→ 'low'（軽い。?lite=1・?q=low）→ 'tv'（Fire TV 向けのさらに軽い。?q=tv、Fire TV・Android TV のときは最初から）。
     'tv' のとき部品には 'low' を渡し、R3D.tv = true で会場・土煙がさらに減らす（観客を板の人に・木と支柱を間引く・ラチを粗く）。統合側は影を切り（馬の足元のぼかした丸は残す）、解像度を 0.8 倍に */
  const TVK_Q = (QS.match(/[?&]tvk=([\d.]+)/) || [])[1];               // ?tvk=0.8 などで Fire TV の解像度を固定（重さの測定用）
  // 2026-10-19 オーナー決定: Fire TV の標準は「真ん中」＝軽い描き方のまま細かさ 1.2 倍で固定（自動で下げない）。店舗の設定 tvQuality='auto' のときだけ自動で下げる、'max' は最高
  const TV_K_FIX = TVK_Q ? Math.max(0.5, Math.min(1.2, Number(TVK_Q))) : (QMODE === 'auto' ? 0 : 1.2);
  // 2026-10-19: Fire TV の解像度は「画面の画素と同じ」（最大 1.2 倍＝1920 の幅）から始め、重いときだけ 0.1 ずつ下げる（最低 0.7）。軽ければ 1 分たってから戻す
  // （以前は 0.8 倍で固定＝3D だけ引き伸ばして映っていて、走る場面だけ荒く見えた。オーナー指摘）
  const TV_K_MIN = 0.7, TV_K_MAX = 1.2;
  const PERF_UI = /[?&]perf=1/.test(QS);   // ?perf=1: 左上に重さの表示（Fire TV の確認用。v2/FIRETV_TEST.md）
  function guessQuality() {
    if (MAXQ) return 'high'; // 画質を最高に: Fire TV でもふつうの画質（影・ふちのなめらか）、細かさは画面と同じ（自動で下げない）
    if (/[?&]q=tv/.test(QS)) return 'tv';
    if (/[?&]lite=1/.test(QS)) return 'low';
    if (/[?&]q=low/.test(QS)) return 'low';
    if (/[?&]q=high/.test(QS)) return 'high';
    if (/AFT|Silk|Android TV|SMART-TV|SmartTV|Tizen|Web0S|CrKey/i.test(navigator.userAgent)) return 'tv';
    return 'high';
  }
  function Race3D(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.race = null; this.run = null; this.phase = 'idle'; this.t = 0; this.slow = 1; this.tape = []; this.dust = [];
    this.label = ''; this.cut = 0; this.slowSaid = false; this.winnerIdx = -1;
    this.lite = /[?&]lite=1/.test(QS);
    this.quality = R3D.quality = R3D.quality || guessQuality();
    R3D.inst = this; // 2026-10-19: テレビの「戻る」長押しの画面に、いまの 3D の細かさ・なめらかさを出すため（v2/tvswitch.js）
    if (this.quality === 'tv' || R3D.tv) { this.tv = R3D.tv = true; this.quality = R3D.quality = 'low'; }
    if (this.quality === 'low') this.lite = true;
    this.cam = { p: { x: 0, y: 30, z: 120 }, t: { x: 0, y: 0, z: 0 }, fov: 60, mode: '' }; // fov は 2D 版と同じ横の画角（度）
    this.ext = [0, 0, 0, 0, 0, 0]; this.vel = [0, 0, 0, 0, 0, 0]; this.spd = [0, 0, 0, 0, 0, 0];
    this.perf = { frames: 0, ms: 0, fps: 0, gap: 16.7, calls: 0, tris: 0 };
    this.parts = {};
    // WebGL のキャンバスを #race の真下（同じ箱）に置く。#race は透明にしてテロップ専用にする
    const gl = this.glcv = document.createElement('canvas');
    gl.className = 'race3d'; gl.width = W; gl.height = H;
    gl.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;display:block';
    canvas.parentNode.insertBefore(gl, canvas);
    const low = this.quality === 'low';
    this.renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: !low, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.setSize(W, H, false);
    this.renderer.info.autoReset = false; // 後処理で何回描いても 1 コマ分の合計を数える
    this.k = 1; this.fitRes(true);
    gl.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('casa DERBY 3D: WebGL のコンテキストが失われました'); }, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, ASPECT, 0.3, 6000);
    this.look = this.part('Look', () => R3D.Look.setup(this.renderer, this.scene, { quality: this.quality }), () => Stub.look(this.renderer, this.scene, { quality: this.quality }));
    this.venue = this.part('Venue', () => R3D.Venue.build(this.scene, { quality: this.quality }), () => Stub.venue(this.scene, { quality: this.quality }));
    // 確定演出（cloud）の数字の雲の置き場所: 向正面の奥（4 コーナーの上）の空、仰角 7.2 度・高さ 3.6 度。1000m のゲートインの全景（GI_WIDE。ゲートの後ろから向正面の奥を見る）で画面の左上に入る（向正面の並走カメラでは手前の木が仰角 20 度まであって空が見えない）
    if (this.look && typeof this.look.placeDigit === 'function') { try { this.look.placeDigit(-1, 0.02, 7.2, 3.6); } catch (e) { warnOnce('look.placeDigit', e); } }
    this.director = null; this.makeDirector();
    this.horses3d = []; this.handlers = [];
    this.dustFx = makeDust(this.scene, this.tv ? 40 : low ? 70 : 160);
    if (this.tv) this.noShadows();
    // 残線（直線の残り 400・200・100m の白い線）
    this.remainMesh = {};
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    [400, 200, 100].forEach((m) => { const a = pointAt(FINISH_S - m, RI), b = pointAt(FINISH_S - m, RO), len = Math.hypot(b.x - a.x, b.z - a.z); const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.36, len), lineMat); mesh.rotation.x = -Math.PI / 2; mesh.position.set((a.x + b.x) / 2, 0.04, (a.z + b.z) / 2); mesh.visible = false; mesh.renderOrder = 2; this.scene.add(mesh); this.remainMesh[m] = mesh; });
    this.gateState = ''; this.boardText = null;
  }
  // 部品を作る（無い・失敗したら代わりの部品）
  Race3D.prototype.part = function (name, make, stub) {
    if (R3D[name]) { try { const o = make(); if (o) { this.parts[name] = 'real'; return o; } } catch (e) { warnOnce(name + ' の作成', e); } }
    this.parts[name] = 'stub'; return stub ? stub() : null;
  };
  Race3D.prototype.makeDirector = function () {
    this.director = null; this.directorBroken = false; this.dirErr = 0;
    if (STD_CAM) { this.parts.Director = 'stub'; return; }
    this.director = this.part('Director', () => R3D.Director.create(), null);
    this.makeDirectorOcc(this.director);
  };
  // カメラと馬の間に入る大きな物（ターフビジョン・内馬場の大きな木）をカメラに教える
  Race3D.prototype.makeDirectorOcc = function (d) {
    try {
      const vi = this.venue && this.venue.info && this.venue.info.vision;
      const vg = this.venue && this.venue.group, occ = [];
      if (vi) occ.push({ minx: vi.x - vi.w / 2, maxx: vi.x + vi.w / 2, miny: 0, maxy: vi.y0 + vi.h + 0.8, minz: vi.z - 1.6, maxz: vi.z + 0.4 });
      if (vg && vg.getObjectByName) { const tr = vg.getObjectByName('treesRound'); if (tr) occ.push(tr); } // 内馬場の大きな木
      if (d && d.setOccluders && occ.length) d.setOccluders(occ);
      if (d && d.setAspect) d.setAspect(ASPECT);
    } catch (e) { warnOnce('Director.setOccluders', e); }
  };
  // 解像度: 画面に映る大きさ × 画素密度（最大 2 倍、軽い描き方では 1 倍）。テロップのキャンバスも同じ倍率
  Race3D.prototype.fitRes = function (force) {
    const now = performance.now();
    if (force || !this.resAt || now - this.resAt > 500) {
      this.resAt = now;
      const rw = (this.cv.getBoundingClientRect && this.cv.getBoundingClientRect().width) || W, dpr = window.devicePixelRatio || 1;
      const k = this.tv ? this.tvK(rw, dpr) : Math.round(Math.max(1, Math.min(this.lite ? 1 : Math.min(MAXK, this.kCap || 9), (rw || W) * Math.max(1, dpr) / W)) * 4) / 4;
      if (k !== this.k || force) { this.k = k; this.cv.width = Math.round(W * k); this.cv.height = Math.round(H * k); this.renderer.setPixelRatio(k); this.renderer.setSize(W, H, false); }
    }
    this.ctx.setTransform(this.k || 1, 0, 0, this.k || 1, 0, 0);
  };
  // Fire TV の解像度: 画面に映る大きさ × 画素密度（0.1 刻み、0.7〜1.2）。重さで下げた上限（tvCap）を超えない
  Race3D.prototype.tvK = function (rw, dpr) {
    if (TV_K_FIX) return TV_K_FIX;
    const want = Math.max(TV_K_MIN, Math.min(TV_K_MAX, Math.round((rw || W) * Math.max(1, dpr || 1) / W * 10) / 10));
    return this.tvCap ? Math.min(want, this.tvCap) : want;
  };
  Race3D.prototype.setRace = function (race) {
    this.runSeq = (this.runSeq || 0) + 1; // 走っている本番・再生・勝ち馬のアップの描画ループを止める（v2 のテレビが途中でレースを切り替えるとき）
    this.race = race; this.run = null; this.lane = null; this.phase = 'idle'; this.t = 0; this.slow = 1; this.tape = []; this.dust = []; this.label = ''; this.slowSaid = false; this.winnerIdx = -1;
    this.startS = C.startS(race.dist);
    this.gateS = C.gateS ? C.gateS(race.dist) : this.startS; this.gateOff = this.gateS - this.startS; // ゲートの位置（1200m はゴール板の少し手前）
    // 確定演出: 発走前（このレースのために）に setCues で渡された分は残し、前のレースの分は消す（何も無ければ ?cues= の上書き）
    if (!this.cuesFresh) this.cues = normCues(CUES_Q, race.horses.length); else this.cues = normCues(this.cues, race.horses.length);
    this.cuesFresh = false; this.eyeAt = null; this.eyeFired = false; this.eyeFireAt = null;
    this.gi = null; this.giPlan = giPlanFor(race.horses.length, this.cueHorse('gateLate')); this.rearKey = null; // ゲートイン（枠入り）の台本（gateLate の馬は枠の前で一度ためらう）
    this.boostFn = null; this.boostK = null; this.boostOn = null; this.clearFoods();
    if (this.venueLowPending) { this.venueLowPending = false; this.rebuildVenue('low'); }
    this.ext = race.horses.map(() => 0); this.vel = race.horses.map(() => 0); this.spd = race.horses.map(() => 0);
    try { this.venue.setRace({ dist: race.dist, surface: race.surface, weather: race.weather }); } catch (e) { warnOnce('venue.setRace', e); }
    if (THEME && this.venue.setTheme) { try { this.venue.setTheme(THEME); } catch (e) { warnOnce('venue.setTheme', e); } }
    try { this.look.setWeather(race.weather); } catch (e) { warnOnce('look.setWeather', e); }
    this.forwardCues();
    this.gateState = ''; this.boardText = null; this.setGate('closed');
    this.buildHorses(race);
    this.makeDirector();
    this.cam.mode = ''; this.placeCamera(0, true); this.draw(0);
    this.prewarm();
    this.startIdle();
  };
  // 賭けている馬の足元の輪を明るく（game.js の DERBY.bets を読むだけ）
  Race3D.prototype.markBets = function () {
    let set = [];
    try { const D = window.DERBY; if (D && D.bets && window.Engine) set = Engine.betHorses(D.bets); } catch (e) { set = []; }
    const key = set.join(','); if (key === this.betKey) return; this.betKey = key;
    this.horses3d.forEach((hz, i) => { if (hz.setRingHighlight) { try { hz.setRingHighlight(set.indexOf(i) >= 0); } catch (e) { warnOnce('Horse.setRingHighlight', e); } } });
  };
  // シェーダを先に作っておく（レース中に初めて出る物でカクッと止まらないように。食べ物・パドックの人も含めて）
  Race3D.prototype.prewarm = function () {
    try {
      const tmp = [makeFood('carrot'), makeFood('corn')]; tmp.forEach((o) => { o.position.set(0, -50, 0); this.scene.add(o); });
      const hidden = []; this.scene.traverse((o) => { if (o.isObject3D && !o.visible) { hidden.push(o); o.visible = true; } });
      this.renderer.compile(this.scene, this.camera);
      hidden.forEach((o) => (o.visible = false)); tmp.forEach((o) => this.scene.remove(o));
    } catch (e) { warnOnce('prewarm', e); }
  };
  /* 出馬表・展開予想・表彰台の馬の絵: レースで走る 3D の馬そのもの（毛色・体型・勝負服・帽子・ゼッケン・白斑）を
     少し斜め前から小さな画像に撮る。kind: 'face'＝上半身（出馬表）、'full'＝全身（表彰台・展開予想）。
     1 頭 1 種類につき 1 回だけ撮り、レースが変わると撮り直す。背景は透明。cv.foot＝蹄の位置（px）、cv.ppm＝1m の px。
     撮れないとき（WebGL の不具合など）は null（呼び出し側は 2D の絵で代用） */
  Race3D.prototype.portrait = function (i, kind) {
    kind = kind === 'full' ? 'full' : 'face';
    const pc = this.portraits || (this.portraits = {}), key = kind + i;
    if (pc[key] !== undefined) return pc[key];
    pc[key] = null;
    const hz = this.horses3d[i]; if (!hz || !hz.object3d || !this.race) return null;
    const o = hz.object3d, parent = o.parent, S = 256, r = this.renderer;
    const keep = { p: o.position.clone(), ry: o.rotation.y, jk: hz.jockey, ring: null };
    let rt = this.pRT;
    try {
      if (!this.pScene) {
        const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x9aa48a, 0.95));
        const d = new THREE.DirectionalLight(0xfff6ea, 1.25); d.position.set(4, 7, 9); sc.add(d); sc.add(d.target);
        this.pScene = sc; this.pCam = new THREE.PerspectiveCamera(20, 1, 0.1, 200);
      }
      if (!rt) { rt = this.pRT = new THREE.WebGLRenderTarget(S, S, { samples: 4 }); rt.texture.encoding = THREE.sRGBEncoding; }
      // 立ち姿・騎手あり（勝負服が見えるように）・足元の輪なし。向きは +x（画面の右）
      try { if (hz.setJockey) hz.setJockey(true); hz.update(0, { gait: 'stand', speed: 0, lean: 0, whip: 0 }); } catch (e) { }
      const ringObj = o.getObjectByName('ring'); if (ringObj) { keep.ring = ringObj.visible; ringObj.visible = false; }
      const badgeObj = o.getObjectByName('ringBadges'); if (badgeObj) { keep.badge = badgeObj.visible; badgeObj.visible = false; }
      o.position.set(0, 0, 0); o.rotation.y = 0; this.pScene.add(o); o.updateMatrixWorld(true);
      // 骨の行列はふつう「1 コマに 1 回」しか更新されない（info.autoReset=false のため）。ここで直接更新しないと元の場所に描かれる
      o.traverse((m) => { if (m.isSkinnedMesh && m.skeleton) m.skeleton.update(); });
      const hh = (hz.size && hz.size.height) || 2.4, cam = this.pCam;
      // 顔のアップ（出馬表）: 頭の骨の位置を基準に、少し斜め前から顔と首元（騎手の帽子が少し入る）を撮る
      const headB = kind === 'face' ? o.getObjectByName('head') : null;
      if (headB) {
        const hp = new THREE.Vector3(); headB.getWorldPosition(hp);
        const F = window.__pf || hz.portraitView || { fx: 0.3, fy: -0.12, cx: 2.3, cy: 0.35, cz: 3.6, fov: 22 }; // 頭の骨からの位置（m）。顔・帽子・勝負服が入る。馬の部品が自分の写し方（portraitView）を持っていればそれを使う
        const tgt = new THREE.Vector3(hp.x + F.fx, hp.y + F.fy, 0);
        cam.fov = F.fov; cam.position.set(tgt.x + F.cx, tgt.y + F.cy, F.cz); cam.lookAt(tgt);
      } else if (kind === 'face') { cam.fov = 24; cam.position.set(1.9, hh * 0.84, 4.1); cam.lookAt(0.5, hh * 0.66, 0); }
      else { cam.fov = 26; cam.position.set(2.2, 1.9, 10.5); cam.lookAt(0.05, hh * 0.5, 0); }
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      const prevRT = r.getRenderTarget(), prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha(), prevShadow = r.shadowMap.enabled;
      r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.shadowMap.enabled = false; r.clear(); r.render(this.pScene, cam);
      const px = new Uint8Array(S * S * 4); r.readRenderTargetPixels(rt, 0, 0, S, S, px);
      r.setRenderTarget(prevRT); r.setClearColor(prevClear, prevAlpha); r.shadowMap.enabled = prevShadow;
      const cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d'), img = c.createImageData(S, S), d = img.data;
      let any = 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { // 上下を反転し、縁の半透明を戻す（乗算済み → 通常）
        const s4 = ((S - 1 - y) * S + x) * 4, t4 = (y * S + x) * 4, a = px[s4 + 3];
        if (!a) continue; any++; const k = a < 255 ? 255 / a : 1;
        d[t4] = Math.min(255, px[s4] * k); d[t4 + 1] = Math.min(255, px[s4 + 1] * k); d[t4 + 2] = Math.min(255, px[s4 + 2] * k); d[t4 + 3] = a;
      }
      c.putImageData(img, 0, 0);
      const v = new THREE.Vector3(0, 0, 0).project(cam), v1 = new THREE.Vector3(0, 1, 0).project(cam);
      cv.foot = { x: (v.x + 1) / 2 * S, y: (1 - v.y) / 2 * S }; cv.ppm = Math.abs(v1.y - v.y) / 2 * S;
      cv.horseNo = this.race.horses[i].no; cv.kind = kind;
      if (any > 50) pc[key] = cv; // 何も写っていなければ使わない
    } catch (e) { warnOnce('出馬表の馬の絵', e); }
    finally {
      // 元の場所・向き・騎手・輪に戻す（この直後のコマで updateWorld がいつもの姿勢に戻す）
      if (parent) parent.add(o); else if (this.pScene) this.pScene.remove(o);
      o.position.copy(keep.p); o.rotation.y = keep.ry; o.updateMatrixWorld(true);
      const ringObj = o.getObjectByName('ring'); if (ringObj && keep.ring != null) ringObj.visible = keep.ring;
      const badgeObj = o.getObjectByName('ringBadges'); if (badgeObj && keep.badge != null) badgeObj.visible = keep.badge;
      try { if (hz.setJockey && keep.jk !== undefined) hz.setJockey(keep.jk); } catch (e) { }
    }
    return pc[key];
  };
  Race3D.prototype.setGate = function (st) { if (st === this.gateState) return; this.gateState = st; try { this.venue.setGate(st); } catch (e) { warnOnce('venue.setGate', e); } };
  /* ---------- 確定演出（勝ち馬をほのめかす隠し演出。2026-10-16 オーナー決定） ----------
     setCues(cues): cues = { fruit:{horse}, crowd:{horse}, sign:{horse}, cloud:{horse}, gateLate:{horse}, eye:{horse} }（horse は 0 始まり。無い鍵・null は無し）。null で全部消す。
       木の実・観客・看板・雲は会場（venue.setCues）と光と空（look.setCues）へ渡す（無い版なら何もしない）。ゲートインの遅れ（gateLate）と最終コーナーの目の光（eye）はここで描く。
       v2 のテレビは setRace の前・ゲートインの前に呼ぶ。発走前に渡した分はそのレースに効き、次の setRace で消える（また渡せば残る）。
       レースの結果・共有の時計（8.0 秒でゲートが開く）には一切ふれない。 */
  Race3D.prototype.setCues = function (cues) {
    const n = this.race ? this.race.horses.length : 0;
    this.cues = normCues(cues, n); this.cuesFresh = true;
    if (this.race && (!this.gi || (!this.gi.finished && this.gi.t < 0.3))) this.giPlan = giPlanFor(n, this.cueHorse('gateLate')); // ゲートインがまだなら台本を組み直す
    this.forwardCues();
  };
  // 確定演出のカメラ用: 遅れる馬が止まっている度合い（0〜1。横のカメラが少し寄る）と、目の光の度合い（0〜1。最終コーナーのカメラが少し寄る）。どちらも共有の時計から
  Race3D.prototype.giBalkK = function () { const P = this.giPlan, G = this.gi, pl = P && P.late >= 0 ? P.H[P.late] : null; if (!pl || !G) return 0; const u = G.t - pl.balk; return smooth01((u + 0.1) / 0.5) * (1 - smooth01((u - (pl.hold || GI_LATE.hold) + 0.1) / 0.5)); };
  Race3D.prototype.eyeGlowK = function () { if (this.eyeFireAt == null || !this.run || this.phase !== 'run') return 0; const el = this.run.t - this.eyeFireAt; return smooth01(el / 0.35) * (1 - smooth01((el - (EYE_DUR - 0.35)) / 0.35)); };
  Race3D.prototype.cueHorse = function (key) { const c = this.cues && this.cues[key]; return c && Number.isInteger(c.horse) ? c.horse : -1; };
  Race3D.prototype.forwardCues = function () {
    const c = this.cues || null;
    if (this.venue && typeof this.venue.setCues === 'function') { try { this.venue.setCues(c); } catch (e) { warnOnce('venue.setCues', e); } }
    if (this.look && typeof this.look.setCues === 'function') { try { this.look.setCues(c); } catch (e) { warnOnce('look.setCues', e); } }
  };
  /* 馬の見た目（2026-10-14）: 'cute'＝R3D.Horse（js/r3d/horse3d.js、標準）| 'real'＝R3D.HorseReal（js/r3d/horse3d-real.js）。どちらも同じ使い方。
     本物寄りの部品は使うと決まってから読む（Fire TV のメモリの節約。読む場所は index.html の window.R3D_LAZY.HorseReal）。
     切り替えはレースを作るとき（setRace → buildHorses）だけ＝走っている途中では変わらない。?horse=real|cute で上書き（確認用） */
  const HORSE_Q = (/[?&]horse=(real|cute)\b/.exec(location.search) || [])[1] || null;
  function loadHorseReal() {
    if (R3D.HorseReal) return Promise.resolve(true);
    if (loadHorseReal.p) return loadHorseReal.p;
    const src = (window.R3D_LAZY && window.R3D_LAZY.HorseReal) || 'js/r3d/horse3d-real.js';
    loadHorseReal.p = new Promise((ok) => {
      const sc = document.createElement('script'); sc.src = src;
      sc.onload = () => ok(!!R3D.HorseReal);
      sc.onerror = () => { loadHorseReal.p = null; warnOnce('本物寄りの馬の読み込み', new Error(src)); ok(false); };
      document.head.appendChild(sc);
    });
    return loadHorseReal.p;
  }
  Race3D.loadHorseReal = loadHorseReal;
  // 次に作るレースの馬の見た目（v2 のテレビが設定から決めて setRace の前に呼ぶ）。'real' なら前もって読み込みを始める
  Race3D.prototype.setHorseLook = function (look) { this.horseLookReq = look === 'real' ? 'real' : 'cute'; if (this.horseLookReq === 'real' || HORSE_Q === 'real') loadHorseReal(); };
  Race3D.prototype.horseModule = function () {
    const want = HORSE_Q || this.horseLookReq || 'cute';
    if (want === 'real' && !R3D.HorseReal) { loadHorseReal(); warnOnce('本物寄りの馬がまだ読めていないので、このレースはかわいい馬', new Error('HorseReal not loaded')); }
    const M = want === 'real' && R3D.HorseReal ? R3D.HorseReal : R3D.Horse;
    return { M, look: M && M === R3D.HorseReal ? 'real' : 'cute' };
  };
  Race3D.prototype.buildHorses = function (race) {
    this.horses3d.forEach((hz) => { this.scene.remove(hz.object3d); try { hz.dispose(); } catch (e) {} });
    this.handlers.forEach((o) => { this.scene.remove(o); if (o.userData.rope) this.scene.remove(o.userData.rope); if (o.userData.dispose) o.userData.dispose(); });
    if (this.handBatch) { this.handBatch.dispose(); this.handBatch = null; }
    this.horses3d = []; this.handlers = []; this.handler2 = null; this.lodQ = []; this.betKey = null; this.portraits = {}; // 出馬表などの馬の絵もレースごとに撮り直す
    const q = this.lite ? 'low' : this.quality, HM = this.horseModule(), M = HM.M;
    // 見た目を変えたら、前の部品の共有の形・材質を捨てる（両方を持ったままにしない。Fire TV のメモリ）
    if (this.horseLook && this.horseLook !== HM.look) { const old = this.horseLook === 'real' ? R3D.HorseReal : R3D.Horse; try { if (old && old !== M && old.disposeShared) old.disposeShared(); } catch (e) { warnOnce('馬の部品の片付け', e); } }
    this.horseLook = HM.look;
    race.horses.forEach((h) => {
      let hz = null;
      if (M) { try { hz = M.create(h, { quality: q }); if (!hz || !hz.object3d) hz = null; else this.parts.Horse = 'real'; } catch (e) { warnOnce('Horse.create', e); hz = null; } }
      if (!hz) { hz = Stub.horse(h); if (this.parts.Horse !== 'real') this.parts.Horse = 'stub'; }
      if (this.tv && hz.setQuality) { try { hz.setQuality('far'); hz.setQuality(q); } catch (e) { } } // Fire TV: 遠くの馬の形を先に作っておく（レース中に初めて作るとカクッとする）
      this.scene.add(hz.object3d); this.horses3d.push(hz);
      if ('onStep' in hz) hz.onStep = (e) => { const lk = this.look; if (lk && lk.splash) lk.splash(e); }; /* 雨の日の足元の水しぶき（光と空の担当が描く） */
      const hd = makeHandler(h); hd.visible = false; this.scene.add(hd); this.handlers.push(hd);
      const rope = makeRope(); this.scene.add(rope); hd.userData.rope = rope;
    });
    // 確定演出 gateLate の 2 人目の係員（枠の中で待っていて、遅れる馬へ走って行き外側から引く）。handlers の最後（馬の数の次）に置く＝まとめ描き（handBatch）と崩れのチェックに入る
    { const hd = makeHandler({ color: '#ffffff' }); hd.visible = false; hd.userData.extra = true; this.scene.add(hd); this.handlers.push(hd); const rope = makeRope(); this.scene.add(rope); hd.userData.rope = rope; this.handler2 = hd; }
    if (this.tv) this.handBatch = makeHandBatch(this.scene, this.handlers); // Fire TV: 係員と綱をまとめて描く
    this.horseDust = this.horses3d.some((hz) => hz.dust === true || 'onStep' in hz); // 馬の部品が自分で土煙を出すなら統合側の粒は止める
    this.hdim = this.horses3d.map(bodyDims); // 上から見た馬の大きさ（進路取りで重ならないように）
  };
  /* 上から見た馬の大きさ（休みの姿勢の形から測る。m、原点＝胴の真下）: f＝鼻先まで（全力で首を伸ばす分を足す）、b＝尻まで（尾の細い所は除き、後ろ脚の振り分けを足す）、
     hw＝体の半幅（騎手の足・鐙まで）。形が読めない馬（代わりの部品）は標準の大きさ */
  function bodyDims(hz) {
    const d = { f: 1.65, b: 0.78, hw: 0.42 };
    try {
      const P = hz.meshes && hz.meshes[0] && hz.meshes[0].geometry.attributes.position; if (!P) return d;
      let maxZ = 0, maxX = -9, rear = 0;
      for (let k = 0; k < P.count; k++) { maxZ = Math.max(maxZ, Math.abs(P.getZ(k))); maxX = Math.max(maxX, P.getX(k)); }
      for (let k = 0; k < P.count; k++) if (Math.abs(P.getZ(k)) > 0.5 * maxZ) rear = Math.min(rear, P.getX(k));
      let tz = 0; const T = hz.meshes[2] && hz.meshes[2].geometry.attributes.position; if (T) for (let k = 0; k < T.count; k++) tz = Math.max(tz, Math.abs(T.getZ(k)));
      if (maxX > 0.5 && rear < -0.2) { d.f = maxX + 0.1; d.b = -rear + 0.12; d.hw = Math.max(maxZ + 0.09, tz * 1.03) + 0.02; } // 騎手の足・鐙は胴より約 0.08m 外（騎手を降ろしているときも同じ幅で見る）
    } catch (e) { }
    return d;
  }
  Race3D.prototype.startIdle = function () {
    const self = this; if (this.idleOn) return; this.idleOn = true;
    let last = performance.now();
    function frame(now) {
      if (self.phase !== 'idle') { self.idleOn = false; return; }
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now; self.t += dt;
      let sdt = self.gi ? dt * (self.timeScale || 1) : dt; // ゲートイン中は早送りの倍率で動かす（馬・カメラも同じ時間で）
      // v2（全店同時）: ゲートインの時計をサーバーの時刻に合わせる（gateIn({ clock }) の秒。遅れていたら追いつき、進みすぎなら待つ）
      if (self.gi && self.gi.clock && !self.gi.finished) { let c = NaN; try { c = self.gi.clock(); } catch (e) { } if (isFinite(c)) sdt = clamp(c - self.gi.t, 0, 30); }
      if (self.gi) { try { self.giStep(sdt); } catch (e) { console.error(e); self.giFinish(); } }
      try { self.placeCamera(sdt, false); if (self.cut > 0) self.cut -= dt; self.draw(sdt); } catch (e) { console.error(e); }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };
  // パドックの長さ: ふつうは 18 秒。v2 のテレビ（v2/tv.js）は受付の間ずっとパドックにするため paddockSec を大きくし、締切の少し前に今の t へ下げて「まもなく発走」へ移る
  Race3D.prototype.padSec = function () { return this.paddockSec != null ? this.paddockSec : PADDOCK_SEC; };
  Race3D.prototype.inPaddock = function () { return this.phase === 'idle' && !this.gateShot && this.t < this.padSec(); };
  Race3D.prototype.paddockIdx = function () { const n = this.race.horses.length, k = this.inPaddock() ? Math.floor(this.t / (this.paddockSec > 1e8 ? 4.5 : 3)) : Math.floor(Math.max(0, this.t - this.padSec()) / 4); return ((k % n) + n) % n; }; // v2 のテレビ（受付の間ずっとパドック）は 1 頭 4.5 秒（REVIEW_TODO 4）。一人用は 18 秒で 6 頭なので 3 秒のまま
  // パドックの楕円を反時計回りに 1.5m/秒（ワールド座標で返す。lx, lz はパドックの中心からの位置）
  Race3D.prototype.paddockPos = function (i) {
    const n = this.race.horses.length, PA = PD.a, PB = PD.b, per = Math.PI * (3 * (PA + PB) - Math.sqrt((3 * PA + PB) * (PA + 3 * PB)));
    const th = -(this.t * 1.5 / per) * Math.PI * 2 + (i / n) * Math.PI * 2;
    const x = PA * Math.cos(th), z = PB * Math.sin(th), tx = PA * Math.sin(th), tz = -PB * Math.cos(th), tl = Math.hypot(tx, tz);
    return { x: PD.cx + x, z: PD.cz + z, lx: x, lz: z, hx: tx / tl, hz: tz / tl, th };
  };
  // コース上の馬の位置（ゴール後は少し流して止まる見た目の距離 ext を足す。結果には関係しない）
  Race3D.prototype.horseS = function (i) {
    if (!this.run) return (this.gateS != null ? this.gateS : this.startS) + this.giDs(i); // 発走前: ゲートの後ろで待つ・ゲートイン・枠の中
    const gone = Math.min(1.04, this.run.pos[i]) * this.race.dist, k = clamp(gone / 40, 0, 1);
    // 枠の中（ゲートの位置 − 0.4m）から出て、最初の 40m で本来の位置（発走地点 + 進んだ距離）に合わせる（ずれは 1200m で約 2.8m）
    return this.startS + gone + ((this.gateOff || 0) + this.stallOf(i)) * (1 - k * k * (3 - 2 * k)) + (this.ext[i] || 0);
  };
  Race3D.prototype.horsePos = function (i) {
    const lr = this.lane ? this.lane[i] : laneR(i);
    return pointAt(this.horseS(i), lr);
  };
  // 2D 版と同じ進路取り
  Race3D.prototype.updateLanes = Race2D.prototype.updateLanes;      // 重ならない進路取り（js/race.js。ゴール後に流す距離 ext も horseS で見る）
  Race3D.prototype.updateLanesOld = Race2D.prototype.updateLanesOld;
  Race3D.prototype.packCenter = Race2D.prototype.packCenter;
  Race3D.prototype.leaderIdx = Race2D.prototype.leaderIdx;
  Race3D.prototype.group = Race2D.prototype.group;
  // ゴールした馬を見た目だけ流す（速さをキャンター 4〜6m/秒まで落としていく）
  Race3D.prototype.advanceOverrun = function (dt) {
    const run = this.run; if (!run) return;
    const len = run.length, dist = this.race.dist;
    for (let i = 0; i < run.n; i++) {
      if (!run.finish[i]) { this.spd[i] = (run.speed[i] || 0) * dist / len; continue; }
      // ゴールしたコマはエンジンの位置がすでに 1 を越えて進んでいるので、流す距離は足さない（足すと 1 コマだけ 2 倍進む＝動きのテストで検出）
      if (!this.vel[i]) { this.vel[i] = Math.max(8, this.spd[i] || (run.speed[i] || 1) * dist / len); this.spd[i] = this.vel[i]; continue; }
      // （勝ち馬のアップで負けた馬を急に止めると、詰まった馬群を進路取りが横へ大きく動かして体の向きが速く回る（0.46 → 2.2rad/秒）ので、前のまま。
      //   手前に来る馬は winnerClear でこのカットの間だけ映さない）
      // 喜ぶ勝ち馬（講評 r3 の 6）: 止めて立ち上がらせるのをやめ、首を振りながら誇らしげに速歩（約 3.6m/秒）。負けた馬も 3m/秒までゆっくり落とす（追い越していかない）
      const win = this.phase === 'winner' && this.winStage !== 'back' && i === this.winnerIdx, cel = this.phase === 'winner' && this.winStage !== 'back', floor = win ? 3.6 : cel ? 3 : this.phase === 'winner' ? 5 : 4;
      this.vel[i] = floor + (this.vel[i] - floor) * Math.exp(-dt / (win ? 0.5 : 1.6));
      this.ext[i] = Math.min(140, this.ext[i] + this.vel[i] * dt);
      this.spd[i] = this.vel[i];
    }
  };

  /* ---------- カメラ ----------
     カメラ担当の部品（R3D.Director）があればそれを使う。無い・壊れたときは 2D 版と同じ台本（stdCamera）。 */
  Race3D.prototype.camPhase = function () {
    if (this.gateShot) return this.gi && !this.gi.finished && this.gi.cue !== 'ready' ? 'gatein' : 'gate'; // ゲートイン（枠入り）→ 体勢完了
    if (this.phase === 'idle') return this.inPaddock() ? 'paddock' : 'prerace';
    if (this.phase === 'replay') return 'replay';
    if (this.phase === 'winner') return 'winner';
    if (this.phase === 'run') return 'race';
    return 'idle';
  };
  Race3D.prototype.dirCtx = function (snap) {
    const race = this.race, n = race.horses.length, phase = this.camPhase(), pad = phase === 'paddock', horses = [];
    for (let i = 0; i < n; i++) {
      const hz = this.horses3d[i], type = race.horses[i].type, height = (hz && hz.size && hz.size.height) || 2.45; // 馬の背の高さ（頭の先まで）
      const body = hz && hz.size && hz.size.length ? hz.size.length * 0.59 : undefined; // カメラが使う体の長さの半分（実際の馬の大きさから。ノマールの 2.11m → 1.25m と同じ比）
      if (pad) { const p = this.paddockPos(i); horses.push({ x: p.x, z: p.z, hx: p.hx, hz: p.hz, s: 0, lane: 0, type, height, body }); }
      else { const p = this.horsePos(i); horses.push({ x: p.x, z: p.z, hx: p.hx, hz: p.hz, s: this.run ? Math.min(1.04, this.run.pos[i]) * race.dist + (this.ext[i] || 0) : this.horseS(i) - this.startS, lane: this.lane ? this.lane[i] : laneR(i), type, height, body }); } // 発走前の s は発走地点からの m（ゲートの後ろで待つ馬は負）
    }
    const Li = this.leaderIdx(), u = this.run ? Math.min(1, this.run.pos[Li]) : 0;
    return { phase, t: this.t, raceT: this.run ? this.run.t : 0, dist: race.dist, startS: this.startS, horses, leader: Li, remain: race.dist * (1 - u), gone: race.dist * u, paddockIdx: this.paddockIdx(), winnerIdx: this.winnerIdx, winStage: this.phase === 'winner' ? this.winStage || '' : '', replayStage: this.phase === 'replay' ? this.replayStage || '' : '', slow: this.slow, gateOpen: !!(this.run && this.run.t > 0.05), gateS: this.gateS, gateIn: this.gi && phase === 'gatein' ? { t: this.gi.t, cue: this.gi.cue, focus: this.giPlan.sideFocus != null ? this.giPlan.sideFocus : this.giPlan.focus, side: this.giPlan.late >= 0 ? this.giPlan.side : '', late: this.giPlan.late, balkK: this.giBalkK(), order: this.giPlan.order } : null, eyeGlow: this.eyeGlowK(), eyeHorse: this.cueHorse('eye'), snap: !!snap, surface: race.surface, weather: race.weather, boost: this.phase === 'run' ? this.boostK : null }; // boost: 応援の加速の強さ（馬ごと 0..1。カメラが低い横の絵を差し込む）
  };
  Race3D.prototype.placeCamera = function (dt, snap) {
    if (!this.race) return;
    if (this.director && !this.directorBroken) {
      try {
        const ctx = this.dirCtx(snap || this.cam.mode === ''), out = this.director.update(dt || 0, ctx);
        if (out && out.pos && out.target && isFinite(out.pos.x + out.pos.y + out.pos.z + out.target.x + out.target.y + out.target.z) && out.fov > 0) {
          const cam = this.cam;
          cam.p = { x: out.pos.x, y: out.pos.y, z: out.pos.z }; cam.t = { x: out.target.x, y: out.target.y, z: out.target.z };
          cam.vfov = clamp(out.fov, 0.5, 120); cam.fov = v2h(cam.vfov); cam.mode = ctx.phase; this.dirLabel = out.label || '';
          if (out.cut) { this.cut = 0.22; this.cutNo = (this.cutNo || 0) + 1; }
          this.dirErr = 0; return;
        }
        throw new Error('director.update の戻り値が不正');
      } catch (e) {
        // そのコマだけ 2D 版の台本で撮る。続けて 60 コマ失敗したら、このレースの間は代わりのカメラ
        warnOnce('Director.update', e); this.dirErr = (this.dirErr || 0) + 1;
        if (this.dirErr > 60) { this.directorBroken = true; this.parts.Director = 'stub'; }
        this.stdCamera(dt, snap); return;
      }
    }
    this.stdCamera(dt, snap);
  };
  // 2D 版の placeCamera と drawPaddock のカメラをそのまま 3D に（座標は同じ）
  const ST = RO + 40;
  const VIS = { x: 150, z: 16, w: 30, h: 10, y0: 2.4 };
  const ITREES = [{ x: 60, z: 31, h: 8, rad: 4.6 }, { x: -20, z: 33, h: 6.5, rad: 3 }];
  const OCCL = [{ x: VIS.x, z: VIS.z, w: VIS.w, y0: VIS.y0, y1: VIS.y0 + VIS.h }].concat(ITREES.map((t) => ({ x: t.x, z: t.z, w: t.rad * 2.2, y0: t.h * 0.3, y1: t.h })));
  function blocked(P, T) {
    const dz = T.z - P.z; if (Math.abs(dz) < 1e-6) return false;
    for (const o of OCCL) { const k = (o.z - P.z) / dz; if (k <= 0 || k >= 1) continue; const x = P.x + (T.x - P.x) * k, y = P.y + (T.y - P.y) * k; if (Math.abs(x - o.x) < o.w / 2 + 3 && y > o.y0 - 3 && y < o.y1 + 1.5) return true; }
    return false;
  }
  Race3D.prototype.stdCamera = function (dt, snap) {
    const cam = this.cam, race = this.race, t = this.t, n = race.horses.length;
    if (this.inPaddock()) { // パドック: 歩く馬の斜め前・外から（2D 版の drawPaddock と同じ）
      const i0 = this.paddockIdx(), tp = this.paddockPos(i0), PA = PD.a, PB = PD.b;
      const on = Math.hypot(tp.lx / PA, tp.lz / PB) || 1, ox = tp.lx / on / PA * PB, oz = tp.lz / on / PB * PA, ol = Math.hypot(ox, oz) || 1;
      const P = { x: tp.x - ox / ol * 9 + tp.hx * 5, y: 1.9, z: tp.z - oz / ol * 9 + tp.hz * 5 }, T = { x: tp.x - tp.hx * 0.5, y: 1.3, z: tp.z - tp.hz * 0.5 };
      const dist = Math.hypot(T.x - P.x, T.y - P.y, T.z - P.z), F = (0.62 * H) * dist / 2.1, fov = Math.max(8, Math.min(60, 2 * Math.atan((W / 2) / F) * DEG));
      const mode = 'paddock' + i0;
      if (cam.mode !== mode || snap) { cam.mode = mode; cam.p = P; cam.t = T; cam.fov = fov; this.cut = 0.2; this.cutNo = (this.cutNo || 0) + 1; }
      else { const k = Math.min(1, (dt || 0.016) * 4); ['x', 'y', 'z'].forEach((a) => { cam.p[a] += (P[a] - cam.p[a]) * k; cam.t[a] += (T[a] - cam.t[a]) * k; }); cam.fov += (fov - cam.fov) * k; }
      cam.vfov = h2v(cam.fov); return;
    }
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
    else if (mode === 'pole') { P = { x: -LS / 2 + 30, y: 4, z: -RI + 32 }; size = 0.17; fitW = g.span + 24; ty = 1.8; }
    else if (mode === 'c4') { const c0 = pointAt(FINISH_S - 230, RO + 18); P = { x: c0.x, y: 12, z: c0.z }; size = 0.24; fitW = g.span + 14; }
    else if (mode === 'fan') { P = { x: 60, y: 30, z: ST + 3 }; size = 0.1 + 0.06 * clamp(1 - (remain - 140) / 160, 0, 1); fitW = g.span + 30; sway = 0.25; }
    else if (mode === 'goal') { P = { x: FINISH_S - LS / 2 + 15, y: 18, z: ST + 3 }; size = 0.2 + 0.14 * clamp(1 - (remain - 45) / 95, 0, 1); fitW = g.span + 12; sway = 0.3; }
    else if (mode === 'front') { P = { x: FINISH_S - LS / 2 - 14, y: 4.5, z: RI - 24 }; size = 0.32; fitW = g.span + 10; }
    else if (mode === 'replay') { const c0 = pointAt(FINISH_S - 6, RI - 3); P = { x: c0.x, y: 1.5, z: c0.z }; size = 0.62; fitW = g.span + 5; ty = 1.5; }
    else { // winner: 3D では勝ち馬がゴール後も流しているので、勝ち馬の 7m 先・内側 9m の低い位置に据えて、横を通る勝ち馬を追う（ほかの馬は勝ち馬の向こうに入りやすい）
      const wi = this.winnerIdx >= 0 ? this.winnerIdx : Li;
      if (snap || cam.mode !== 'winner' || this.winCamS == null) { this.winCamS = this.horseS(wi) + 7; this.winCamR = (this.lane ? this.lane[wi] : RI + 2) - 9; }
      const c0 = pointAt(this.winCamS, this.winCamR); P = { x: c0.x, y: 1.8, z: c0.z }; size = 0.6;
    }
    const T = { x: tgt.x + Math.sin(t * 1.3) * sway, y: ty + Math.cos(t * 0.9) * sway * 0.3, z: tgt.z + Math.cos(t * 1.1) * sway };
    if (P.z > ST) for (let k = 0; k < 4 && blocked(P, T); k++) P.x += (k % 2 ? 1 : -1) * 55 * (k + 1);
    const dist = Math.hypot(T.x - P.x, T.y - P.y, T.z - P.z);
    let F = (size * H) * dist / 2.1; if (fitW > 0) F = Math.min(F, W * dist / fitW);
    const fov = Math.max(3, Math.min(62, 2 * Math.atan((W / 2) / F) * DEG));
    if (mode !== cam.mode || snap) { cam.mode = mode; cam.p = P; cam.t = T; cam.fov = fov; this.cut = 0.22; this.cutNo = (this.cutNo || 0) + 1; }
    else {
      const kt = Math.min(1, dt * 7); cam.t.x += (T.x - cam.t.x) * kt; cam.t.y += (T.y - cam.t.y) * kt; cam.t.z += (T.z - cam.t.z) * kt;
      const kp = Math.min(1, dt * 3); cam.p.x += (P.x - cam.p.x) * kp; cam.p.y += (P.y - cam.p.y) * kp; cam.p.z += (P.z - cam.p.z) * kp;
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 2.2);
    }
    cam.vfov = h2v(cam.fov);
  };

  /* ゴール前スロー（2026-10-16 から毎レース。前は接戦のときだけ）の速さの倍率を 1 コマ分進める。st = { slow, slowLock }。
     本番（start）と、v2 のテレビが「何秒後に何が起きるか」を先に計算する Race3D.timeline の両方で使う（同じ式で同じ時間割になる） */
  function slowStep(st, run, race, real) {
    let a = -1, b = -1; for (let i = 0; i < run.n; i++) { const p = run.pos[i]; if (a < 0 || p > run.pos[a]) { b = a; a = i; } else if (b < 0 || p > run.pos[b]) b = i; }
    const gap = (run.pos[a] - run.pos[b]) * race.dist;
    // ゴール前スロー: 先頭がゴールまで 45m を切ったら必ずスローに入り、1着がゴールした瞬間に元の速さへ戻す
    // （以前は全馬ゴールまで finishedAt が立たず、ゴール後に上位が並んで見えてスローが続いていた）
    const leadLeft = (1 - run.pos[a]) * race.dist;
    // 接戦（1・2 番手の差が 1 馬身＝約 2.4m 以内）のときだけスロー。いったん入ったら 1.5 馬身を超えて離れるまで続ける（ちらつき防止）
    // 2026-10-16 オーナー「ゴール直前は毎回スローになる感じでもいいかも」: 接戦かどうかにかかわらず、毎レース同じスローにする（前は 1・2 番手の差が 1 馬身以内のときだけ）。
    // 写真判定の再生（止めた絵・鼻の拡大）は今までどおり 1・2 着の差 0.05 秒以内だけ（replay の photo）。slowLock は「スロー中」の印として残す
    if (run.done || leadLeft >= 45) st.slowLock = false; else st.slowLock = true;
    // 速さ（v2 講評 1 回目の TOP1: ゴール前 1.5〜2.0 秒を 0.35〜0.5 倍）: 接戦かどうかは今までどおり残り 45m から見て決め、
    // 残り 23m から 11.5m にかけてなめらかに 0.42 倍まで落とし、残り 11.5m からゴールまでがいちばん遅い（実時間 約 1.6〜1.9 秒）。前は 45→22m で 0.55 倍（約 3.5 秒、ゆるいスロー）
    const slowU = clamp((23 - leadLeft) / 11.5, 0, 1), targetSlow = (!run.done && leadLeft < 45 && st.slowLock) ? 1 - 0.58 * slowU * slowU * (3 - 2 * slowU) : 1;
    st.slow += (targetSlow - st.slow) * Math.min(1, real * (targetSlow < 1 ? 7 : 4));
    return gap;
  }
  const SIM_DT = 1 / 60;   // 追いつき・時間割の計算の 1 コマ（実時間の秒）
  // ゴール後の流れの長さ（実時間の秒）: 0.6 秒の生の絵 → 0.65 秒止める → 再生（ゴールの横 2 秒・写真判定 約 4 秒・正面 3 秒）→ 勝ち馬（1.8＋2.8 秒）
  const POST = { live: 0.6, hold: 0.65, goal: 2.0, photo: 0.37 / 0.15 + 1.5, head: 0.65 / 0.4, winner: 4.6 }; // head: 正面のスロー（replay の 'head' 区間 0.65 秒を 0.4 倍）
  /* v2（全店同時）用: 決まった走り（run。Engine.replayRun などで作った、刻み方で結果が変わらないもの）を、実時間 1/60 秒ずつ
     ゴール前スローも含めて最後まで進め、レースの時間割（ゲートが開いてからの実時間の秒）を返す。渡した run は進んでしまうので、本番用とは別の run を渡すこと。
     → { finishWall: 1 着がゴールした実時間, endWall: ゴール後の生の絵が終わる実時間, postSec: そのあと勝ち馬のアップが終わるまで, totalSec, photo, order, finish } */
  Race3D.timeline = function (race, run) {
    const st = { slow: 1, slowLock: false };
    let w = 0, fin = 0, finW = 0;
    for (let k = 0; k < 60 * 400; k++) {
      slowStep(st, run, race, SIM_DT);
      const dt = SIM_DT * st.slow;
      if (!fin) { if (run.step(dt)) fin = run.t; } else run.t += dt;
      w += SIM_DT;
      if (!finW && run.finish.some((x) => x > 0)) finW = w;
      if (fin && run.t > fin + POST.live) break;
    }
    const f = run.finish.filter((x) => x > 0).sort((x, y) => x - y), photo = f.length >= 2 && f[1] - f[0] <= 0.05;
    const postSec = POST.hold + POST.goal + (photo ? POST.photo : 0) + POST.head + POST.winner;
    return { finishWall: finW, endWall: w, postSec, totalSec: w + postSec, photo, order: run.order(), finish: run.finish.slice() };
  };

  /* ---------- 本番（2D 版と同じ進行。違うのは土ぼこりの色の持ち方・見た目の流し・draw に経過時間を渡すことだけ） ----------
     opt.run: 走りを外から渡す（v2: サーバーが決めた seed で再現した決まった走り。無ければ今までどおり Engine.createRun）
     opt.clock(): v2 の全店同時用。ゲートが開いてからの実時間（秒、サーバーの時刻から）。渡すとその時計に合わせて進める:
       遅れていたら（途中から見始めた・画面が止まっていた）絵を描かずに 1/60 秒ずつ追いつき、進みすぎなら待つ */
  Race3D.prototype.start = function (opt) {
    const self = this, race = this.race;
    opt = opt || {};
    const clock = typeof opt.clock === 'function' ? opt.clock : null;
    this.run = opt.run || Engine.createRun(race, null, { boost: opt.boost });
    if (this.gi && !this.gi.finished) this.giFinish(); this.gi = null; // ゲートインの途中で呼ばれても（テストなど）そのまま発走
    this.cuesFresh = false; this.eyeAt = null; this.eyeFired = false; this.eyeFireAt = null; // 確定演出: 走り出したら「このレースの分」。目の光は 1 レース 1 回（再生では光らない）
    this.markBets();
    this.onPhase = opt.onPhase || null; this.photo = false; // 段階の知らせ（game.js の中継のグラフィックス: 'photo' 'replay' 'winner'）
    this.boostLog = [];
    this.boostFn = opt.boost || null; this.boostK = race.horses.map(() => 0); this.boostOn = race.horses.map(() => false); this.clearFoods();
    this.phase = 'run'; this.t = 0; this.tape = []; this.slow = 1; this.lane = null; this.slowSaid = false; this.winnerIdx = -1; this.winnerIdx_set = false; this.saidStart = false; this.saidCorner = false; this.saidStraight = false; this.split1000 = null; this.lastCall = 0; this.callNo = 0; this.t600 = null; this.last3f = null; this.t800 = null; this.finalAt = 0;
    this.ext = race.horses.map(() => 0); this.vel = race.horses.map(() => 0); this.spd = race.horses.map(() => 0); this.winCamS = null;
    this.simWall = 0; this.catchUps = 0; this.holdFn = typeof opt.hold === 'function' ? opt.hold : null;
    const seq = this.runSeq = (this.runSeq || 0) + 1;
    return new Promise((resolve) => {
      let last = performance.now(), leader = -1, leaderSince = 0, finishedAt = 0, said200 = false, quiet = false;
      self.endHold = 0;
      // opt.replay: false＝リプレイなし、'short'＝ゴールの横（と写真判定）だけ。opt.winner: false＝勝ち馬のアップなし（v2 の店ごとの場面の設定）
      const startReplay = () => { const run = self.run, result = { order: run.order(), finish: run.finish.slice() }; const rp = opt.replay === false ? Promise.resolve() : self.replay(Math.min.apply(null, run.finish.filter((x) => x > 0)), { short: opt.replay === 'short' }); rp.then(() => (opt.winner === false ? null : self.winnerShot())).then(() => { self.phase = 'done'; resolve(result); }); };
      const kicked = {}, slowSt = { slow: 1, slowLock: false };
      const say = (text) => { if (!quiet && opt.onEvent) opt.onEvent(text); }; // 追いつきの間（絵を描かない）は字幕・声を出さない
      // 1 コマ分のレースを進める（絵は描かない）。ゴール後の生の絵が終わったら true
      function sim(real) {
        const run = self.run;
        const gap = slowStep(slowSt, run, race, real); self.slowLock = slowSt.slowLock; self.slow = slowSt.slow;
        const dt = real * self.slow * (self.timeScale || 1); self.lastDt = dt;
        if (!finishedAt) { if (run.step(dt)) finishedAt = run.t; }
        else run.t += dt;
        self.t = run.t;
        self.advanceOverrun(dt);
        self.updateLanes(dt); // ゴール後に流す馬・まだ走っている馬も重ならないように（流す距離 ext を進めてから）
        self.tape.push({ t: run.t, pos: run.pos.slice(), lane: self.lane.slice(), lv: self.lv ? self.lv.slice() : null, ext: self.ext.slice(), spd: self.spd.slice() }); if (self.tape.length > 1200) self.tape.shift();
        const L_ = self.leaderIdx();
        const leadU = Math.min(1, run.pos[L_]);
        const remain = Math.max(0, Math.round((1 - leadU) * race.dist / 50) * 50);
        self.remainNow = remain; self.leaderNow = L_;
        if (run.t > 1.5 && L_ !== leader && run.t - leaderSince > 1.2 && !run.finish[L_]) { const first = leader < 0; leader = L_; leaderSince = run.t; say(first ? '先手を取ったのは ' + (L_ + 1) + '番 ' + race.horses[L_].name : (L_ + 1) + '番 ' + race.horses[L_].name + ' が先頭に立った！'); }
        if (self.t600 == null && (1 - run.pos[L_]) * race.dist <= 600) self.t600 = run.t;
        if (self.eyeAt == null && run.t > 1 && (1 - leadU) * race.dist <= EYE_R && self.cueHorse('eye') >= 0) self.eyeAt = run.t; // 確定演出: 最終コーナーに入った（動くカメラが始まって少し）時刻。レースの時計で決める＝どの店でも同じ瞬間
        if (finishedAt && self.last3f == null) { const w = run.order()[0]; self.last3f = run.finish[w] - (self.t600 || 0); }
        if (race.dist > 1000 && !self.split1000 && run.pos[L_] * race.dist >= 1000) { const t = Math.round(run.t * 10) / 10; self.split1000At = t; self.split1000 = Math.floor(t / 60) + '.' + (t % 60 < 10 ? '0' : '') + (t % 60).toFixed(1); say('1000m 通過 ' + self.split1000); }
        if (!self.saidStart && run.t > 0.4) { self.saidStart = true; say('各馬一斉にスタート！'); }
        if (run.t > 9 && remain > 560 && run.t - (self.lastCall || 0) > 12) {
          self.lastCall = run.t; const o3 = race.horses.map((_, i) => i).sort((p, q) => run.pos[q] - run.pos[p]);
          const lines = ['先頭は ' + (o3[0] + 1) + '番、2番手に ' + (o3[1] + 1) + '番、3番手 ' + (o3[2] + 1) + '番', (o3[0] + 1) + '番が引っ張る展開、' + (o3[5] + 1) + '番は最後方で脚をためる', '向こう正面、' + (o3[1] + 1) + '番が ' + (o3[0] + 1) + '番に並びかけてきた'];
          say(lines[(self.callNo = (self.callNo || 0) + 1) % lines.length]);
        }
        if (!self.saidCorner && remain <= (race.dist <= 600 ? 450 : 520) && remain > 380) { self.saidCorner = true; say(race.dist <= 600 ? '4コーナー、すぐに最後の直線へ' : '3コーナーから4コーナー、馬群が固まって回ってくる'); } // 500m は 4 コーナーの途中から発走
        if (!self.saidStraight && remain <= 380 && remain > 240) { self.saidStraight = true; say('4コーナーを回って 直線に向いた！'); }
        for (let i = 0; i < run.n; i++) {
          const ty = race.horses[i].type;
          if (!kicked[i] && !run.finish[i] && ((ty === 'sashi' && run.pos[i] > 0.55) || (ty === 'oikomi' && run.pos[i] > 0.68))) { kicked[i] = 1; say((i + 1) + '番 仕掛けた！'); }
        }
        if (!said200 && remain <= 200) { said200 = true; const o2 = race.horses.map((_, i) => i).sort((p, q) => run.pos[q] - run.pos[p]); say('残り 200m！ ' + (o2[0] + 1) + '番先頭、' + (o2[1] + 1) + '番が追ってくる！'); }
        if ((self.slow < 0.6 || slowSt.slowLock) && !self.slowSaid && gap < 2.5) { self.slowSaid = true; say('ゴール前 大接戦！'); } // スローは残り 24m からなので、接戦と決まった時（残り 45m）に言う
        if (!quiet) {
          const dmax = self.dustFx.max;
          if (!finishedAt && !self.horseDust && self.dust.length < dmax) for (let i = 0; i < run.n; i++) if (Math.random() < 0.55) { const p = self.horsePos(i), sp = (run.speed[i] || 1) * race.dist / run.length; self.dust.push({ x: p.x - p.hx * 0.9, z: p.z - p.hz * 0.9, y: 0.05, vx: -p.hx * (2 + Math.random() * 3) + p.hx * sp * 0.6, vz: -p.hz * (2 + Math.random() * 3) + p.hz * sp * 0.6 + (Math.random() - 0.5), vy: 1.5 + Math.random() * 2.2, r: 0.05 + Math.random() * 0.06, a: 0.9, rgb: race.surface === 'dirt' ? DUST_RGB.dirt : (Math.random() < 0.6 ? DUST_RGB.turfA : DUST_RGB.turfB) }); }
          self.dust.forEach((d) => { d.x += (d.vx || 0) * dt; d.z += (d.vz || 0) * dt; d.vy = (d.vy || 0) - 9.8 * dt; d.y = Math.max(0, d.y + d.vy * dt); if (d.y === 0) d.a -= dt * 3; d.a -= dt * 0.8; }); self.dust = self.dust.filter((d) => d.a > 0);
        }
        if (run.done >= 2 && !self.winnerIdx_set) { self.winnerIdx_set = true; /* 2 着の馬がゴールした時点で決める（全馬のゴールを待つと写真判定の字幕が遅れた） */ self.winnerIdx = run.order()[0]; const f = run.finish.slice().filter((x) => x > 0).sort((x, y) => x - y); if (f.length >= 2 && f[1] - f[0] <= 0.05) { self.label = 'PHOTO FINISH'; self.cut = self.onPhase ? 0 : 0.5; self.photo = true; self.emit('photo'); say('写真判定！'); } }
        return !!(finishedAt && run.t > finishedAt + 0.6);
      }
      function frame(now) {
        if (self.runSeq !== seq) return; // setRace で別のレースに切り替わった
        // ゴール後に止めている間（講評 r3 の 2: ゴール後 0.5〜0.8 秒静止してから再生）
        if (self.endHold) { if (now - self.endHold < 650 / Math.max(1, self.timeScale || 1)) { last = now; self.draw(0); requestAnimationFrame(frame); return; } self.endHold = 0; startReplay(); return; }
        let real = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
        let ended = false, snap = false;
        if (clock) {
          // 全店同時: サーバーの時計で「ゲートが開いてから何秒」かを見て合わせる
          let target = NaN; try { target = clock(); } catch (e) { }
          if (isFinite(target)) {
            if (target - self.simWall > 0.25) { // 遅れている: 絵を描かずに追いつく（字幕・声・土ぼこりは出さない）
              quiet = true; self.catchUps++;
              for (let k = 0; k < 60 * 120 && target - self.simWall > SIM_DT && !ended; k++) { ended = sim(SIM_DT); self.simWall += SIM_DT; }
              quiet = false; snap = true; real = 0;
            } else real = clamp(target - self.simWall, 0, 0.05);
          }
        }
        if (!ended && real > 0) { ended = sim(real); self.simWall += real; }
        const run = self.run, dt = real > 0 ? self.lastDt || 0 : 0;
        self.placeCamera(snap ? 0 : real, snap);
        if (self.cut > 0) self.cut -= real;
        if (self.label !== 'PHOTO FINISH' || self.cut <= 0) self.label = self.slow < 0.7 ? 'SLOW' : '';
        self.draw(dt);
        if (opt.onTick) opt.onTick({ t: run.t, leader: self.leaderNow != null ? self.leaderNow : self.leaderIdx(), remain: self.remainNow || 0, pos: run.pos, finish: run.finish, slow: self.slow });
        if (ended) { // ゴール後 0.6 秒は生の絵（E）を続け、0.65 秒止めてから再生へ（ref/STRAIGHT_STUDY.md 3-1・講評 r3 の 2）
          self.endHold = now; requestAnimationFrame(frame); return;
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  };
  /* ゴール後の再生（ref/STRAIGHT_STUDY.md 3-1・3-2）: テープ（1 コマずつの記録）を区間ごとに再生する。
     1) ゴールの真横の固定カメラ: ゴール前 0.7 秒〜ゴール後 0.3 秒を 0.5 倍（約 2 秒）
     2) 接戦（1・2 着の差 0.05 秒以内）: 同じカメラでもう 1 回 0.15 倍、1 着の鼻がゴールに届いたコマで 1.5 秒止め、ゴールに縦の線と着差を出す
     3) ゴールの先から真正面の低い望遠: ゴール前 0.9 秒〜ゴール後 0.15 秒を 0.35 倍（約 3 秒）
     早送りのテスト（?speed=）では区間の長さも縮む。ctx.replayStage（'goal' 'photo' 'head'）でカメラが切り替わる */
  Race3D.prototype.replay = function (finishedAt, ro) {
    const self = this, run = this.run, fin = run.finish.filter((x) => x > 0).sort((x, y) => x - y), gap = fin.length >= 2 ? fin[1] - fin[0] : 9;
    const segs = [{ st: 'goal', a: -0.7, b: 0.3, rate: 0.5 }];
    if (gap <= 0.05) segs.push({ st: 'photo', a: -0.25, b: 0.12, rate: 0.15, freeze: 1.5 });
    // 正面のスローは短く（正面からだと馬が丸い塊に見える。ゴールの真横の再生を主役に。2026-10-14 見た目の講評）
    if (!(ro && ro.short)) segs.push({ st: 'head', a: -0.55, b: 0.1, rate: 0.4 });
    if (this.tape.filter((f) => f.t >= finishedAt - 0.7 && f.t <= finishedAt + 0.3).length < 10) return Promise.resolve();
    const live = run.pos.slice(), liveExt = this.ext.slice(), liveSpd = this.spd.slice(), liveLane = this.lane.slice(), liveLv = this.lv ? this.lv.slice() : null;
    // 1 着の鼻先がゴールに届いた時刻（馬の位置は胴の真下なので、鼻先までの長さ hdim.f の分だけ手前）。テープのコマの間を補って求める
    const w0 = run.order()[0], tgt = 1 - (((this.hdim && this.hdim[w0] && this.hdim[w0].f) || 1.3) - 0.15) / this.race.dist; let tN = finishedAt; // hdim.f は首を伸ばしきった分を足してあるので 0.15m 引く
    for (let j = 0; j < this.tape.length - 1; j++) { const A = this.tape[j], B = this.tape[j + 1]; if (A.pos[w0] < tgt && B.pos[w0] >= tgt) { tN = A.t + (B.t - A.t) * (tgt - A.pos[w0]) / ((B.pos[w0] - A.pos[w0]) || 1); break; } }
    this.noseT = tN; this.noseIdx = w0;
    const L = gap / 0.14; this.photoMargin = L < 0.15 ? 'ハナ' : L < 0.3 ? 'アタマ' : L < 0.45 ? 'クビ' : L < 0.625 ? '1/2 馬身' : L < 0.875 ? '3/4 馬身' : '1 馬身';
    this.phase = 'replay'; this.label = 'REPLAY'; this.dust = []; this.photoHold = 0; this.emit('replay', { photo: !!this.photo });
    return new Promise((resolve) => {
      let si = -1, tape = null, k = 0, acc = 0, last = performance.now(), hold = 0, held = false; const seq = self.runSeq;
      // 記録のコマとコマの間を補う（補わないと 0.5 倍などの再生で全馬が 1 コマおきに止まってカクつく＝動きのテストで検出）
      const apply = (a) => { const fr = tape[k], nx = tape[k + 1] && a > 0 ? tape[k + 1] : null, f = nx ? Math.min(1, Math.max(0, a)) : 0;
        const mix = (A, B, i) => (B ? A[i] + (B[i] - A[i]) * f : A[i]);
        for (let i = 0; i < live.length; i++) { run.pos[i] = mix(fr.pos, nx && nx.pos, i); if (fr.lane) self.lane[i] = mix(fr.lane, nx && nx.lane, i); if (self.lv) self.lv[i] = fr.lv ? mix(fr.lv, nx && nx.lv, i) : 0; self.ext[i] = fr.ext ? mix(fr.ext, nx && nx.ext, i) : 0; self.spd[i] = fr.spd ? mix(fr.spd, nx && nx.spd, i) : 0; } };
      function next() {
        for (;;) {
          si++;
          if (si >= segs.length) {
            for (let i = 0; i < live.length; i++) { run.pos[i] = live[i]; self.ext[i] = liveExt[i]; self.spd[i] = liveSpd[i]; self.lane[i] = liveLane[i]; if (liveLv) self.lv[i] = liveLv[i]; }
            self.label = ''; self.phase = 'run'; self.replayStage = ''; self.photoHold = 0; self.draw(0); resolve(); return false;
          }
          const g = segs[si]; tape = self.tape.filter((f) => f.t >= finishedAt + g.a && f.t <= finishedAt + g.b);
          if (tape.length >= 4) break;
        }
        self.replayStage = segs[si].st; k = 0; acc = 0; hold = 0; held = false; self.photoHold = 0; apply(); self.placeCamera(0, true);
        return true;
      }
      if (!next()) return;
      function frame(now) {
        if (self.runSeq !== seq) return;
        const real = Math.min(0.05, Math.max(0.001, (now - last) / 1000)) * (self.timeScale || 1); last = now; self.t += real;
        const g = segs[si];
        if (hold > 0) { hold -= real; self.photoHold = Math.max(0.001, hold); self.placeCamera(real, false); self.draw(0); }
        else {
          self.photoHold = 0; acc += real * g.rate;
          if (g.freeze && !held && tape[0].t + acc >= tN) { acc = tN - tape[0].t; held = true; hold = g.freeze; self.photoHold = hold; } // 鼻先がゴールに届いた瞬間で止める
          while (k < tape.length - 1 && tape[k + 1].t - tape[0].t <= acc) k++;
          const span = tape[k + 1] ? tape[k + 1].t - tape[k].t : 0; apply(!span ? 0 : (acc - (tape[k].t - tape[0].t)) / span); self.placeCamera(real, false); if (self.cut > 0) self.cut -= real; self.draw(real * g.rate);
          if (k >= tape.length - 1 && hold <= 0 && !next()) return;
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  };
  /* 勝ち馬のアップ（講評 r2 の 7「手前に別の馬がかぶらない」）: カットの最初のコマで、カメラから見て勝ち馬より手前〜横（勝ち馬の距離 + 4m まで）にいて
     画面に入る負けた馬を、このカットの間だけ映さない（カットの頭で決めて途中では変えない＝消える瞬間は見えない）。奥の馬は背景として残す */
  Race3D.prototype.winnerClear = function () {
    const n = this.race.horses.length, w = this.winnerIdx; this.winHide = [];
    if (w < 0 || w >= n) return;
    this.applyCamera();
    const cp = this.camera.position, pw = this.horsePos(w), dW = Math.hypot(pw.x - cp.x, pw.z - cp.z);
    const inView = (q) => { const s = this.project(q.x, 1, q.z); return !!s && s.x > -200 && s.x < W + 200 && s.y > -200 && s.y < H + 300; };
    for (let i = 0; i < n; i++) {
      if (i === w) continue;
      // いまと、このカットの間（最大 2.8 秒）に進む先（負けた馬は 5m/秒まで落としながら流れる: advanceOverrun）のどこかで、
      // 画面に入っていて勝ち馬より手前〜横（勝ち馬の距離 + 4m まで）なら映さない（カメラの後ろから前へ出てくる馬も）
      const lr = this.lane ? this.lane[i] : laneR(i), v0 = this.vel[i] || 5, s0 = this.horseS(i);
      for (let k = 0; k <= 4; k++) {
        const tt = k * 0.7, q = k ? pointAt(s0 + 5 * tt + Math.max(0, v0 - 5) * 1.6 * (1 - Math.exp(-tt / 1.6)), lr) : this.horsePos(i);
        if (Math.hypot(q.x - cp.x, q.z - cp.z) < dW + 4 && inView(q)) { this.winHide[i] = true; break; }
      }
    }
  };
  Race3D.prototype.emit = function (ph, info) { if (this.onPhase) { try { this.onPhase(ph, info || {}); } catch (e) { warnOnce('onPhase', e); } } };
  Race3D.prototype.winnerShot = function () {
    // ゴール後（ref/STRAIGHT_STUDY.md 3-2）: まず減速して向かってくる勝ち馬を正面から（1.8 秒）→ 止まって喜ぶ勝ち馬のアップ（2.8 秒。早送りのテストは 0.9 秒 → 1.6 秒）
    const self = this, fast = (self.timeScale || 1) > 2; this.phase = 'winner'; this.winStage = 'back'; this.label = ''; this.winCamS = null; this.winHide = [];
    this.emit('winback', { winner: this.winnerIdx });
    this.placeCamera(0, true); this.winnerClear(); // 正面から: 勝ち馬より手前に来る馬は映さない
    const celebrate = () => {
      self.winStage = 'celebrate'; self.label = '1着 ' + (self.winnerIdx + 1) + '番';
      self.emit('winner', { winner: self.winnerIdx, order: self.run.order() }); // 勝ち馬のカードと「獲得 ○枚」（game.js）
      self.placeCamera(0, true); self.winnerClear();
    };
    return new Promise((resolve) => {
      let last = performance.now(), back = fast ? 0.9 : 1.8, left = back + (fast ? 1.6 : 2.8); const seq = self.runSeq;
      function frame(now) {
        if (self.runSeq !== seq) return;
        const real = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now; left -= real; self.t += real;
        if (self.winStage === 'back' && (back -= real) <= 0) celebrate();
        self.advanceOverrun(real); self.updateLanes(real); self.placeCamera(real, false); if (self.cut > 0) self.cut -= real; self.draw(real);
        // opt.hold()（v2）: 結果発表の時刻まで勝ち馬のアップを続ける（残り秒が 0 より大きい間）
        if (left <= 0 && !(self.holdFn && self.holdFn() > 0)) { self.label = ''; self.phase = 'run'; self.winStage = ''; self.winHide = []; resolve(); return; }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  };

  /* ---------- 応援（ニンジン）: 加速が始まった馬の前に大きな食べ物が浮かび、馬が食べると光る ----------
     game.js がくれる boost(i, t) の倍率で決める（1.09 以上ならとうもろこし、それ以外はニンジン。大根は加速しないので出ない）。見た目だけ。 */
  const FOOD_GEO = {};
  function makeFood(kind) {
    const G = FOOD_GEO;
    if (!G.carrot) {
      G.carrot = new THREE.ConeGeometry(0.34, 1.3, 14, 1); G.carrot.rotateZ(Math.PI); G.leaf = new THREE.ConeGeometry(0.07, 0.55, 6); G.leaf.translate(0, 0.27, 0);
      G.corn = new THREE.CapsuleGeometry(0.28, 0.8, 6, 12); G.husk = new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI, 0, Math.PI); G.husk.scale(0.5, 2.0, 1);
      G.ring = new THREE.TorusGeometry(0.9, 0.05, 6, 32);
      G.mat = { carrot: new THREE.MeshStandardMaterial({ color: 0xf07a1a, roughness: 0.55, emissive: 0x401800 }), leaf: new THREE.MeshStandardMaterial({ color: 0x3daa3a, roughness: 0.7 }), corn: new THREE.MeshStandardMaterial({ color: 0xf2d23a, roughness: 0.5, emissive: 0x302400 }), glow: new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }) };
    }
    const o = new THREE.Group(), M = G.mat, add = (geo, m, x, y, z, rz, rx) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.z = rz || 0; me.rotation.x = rx || 0; me.castShadow = true; o.add(me); return me; };
    if (kind === 'corn') { add(G.corn, M.corn, 0, 0, 0); add(G.husk, M.leaf, 0, -0.25, 0.12, 0, 0.25); add(G.husk, M.leaf, 0, -0.25, -0.12, 0, -0.25 + Math.PI); }
    else { add(G.carrot, M.carrot, 0, 0, 0); [-0.35, 0, 0.35].forEach((a) => add(G.leaf, M.leaf, 0, 0.62, 0, a)); }
    const ring = new THREE.Mesh(G.ring, M.glow); ring.rotation.x = Math.PI / 2; ring.position.y = -0.9; o.add(ring); o.userData.ring = ring;
    o.rotation.z = -0.35; return o;
  }
  Race3D.prototype.clearFoods = function () { (this.foods || []).forEach((f) => this.scene.remove(f.o)); this.foods = []; };
  Race3D.prototype.updateFoods = function (dt) {
    const run = this.run; if (!this.foods) this.foods = [];
    if (run && this.boostFn && this.phase === 'run') {
      for (let i = 0; i < run.n; i++) {
        let m = 1; try { m = this.boostFn(i, run.t) || 1; } catch (e) { m = 1; }
        const on = m > 1.001 && !run.finish[i];
        if (on && !this.boostOn[i]) { // 加速が始まった: 馬の 9m 先に食べ物
          const s0 = this.horseS(i) + 9, lr = this.lane ? this.lane[i] : laneR(i), o = makeFood(m >= 1.07 ? 'corn' : 'carrot');
          this.scene.add(o); this.foods.push({ i, s: s0, lr, o, t: 0, eaten: -1 });
          this.boostLog.push({ i, t: run.t, mul: m }); // 確認用: 見えた加速の記録
        }
        this.boostOn[i] = on;
        this.boostK[i] += ((on ? 1 : 0) - this.boostK[i]) * Math.min(1, dt * 6);
        if (this.boostK[i] < 0.01) this.boostK[i] = 0;
      }
    } else if (this.boostK) { for (let i = 0; i < this.boostK.length; i++) { this.boostK[i] = 0; this.boostOn[i] = false; } }
    this.foods = this.foods.filter((f) => {
      f.t += dt; const hs = this.horseS(f.i);
      if (f.eaten < 0 && (hs >= f.s - 0.6 || f.t > 4)) f.eaten = 0;
      const p = pointAt(f.eaten < 0 ? f.s : hs + 0.8, f.lr), k = f.eaten < 0 ? Math.min(1, f.t * 4) : Math.max(0, 1 - f.eaten / 0.25);
      if (f.eaten >= 0) f.eaten += dt;
      f.o.position.set(p.x, 2.4 + Math.sin(f.t * 5) * 0.2, p.z); f.o.rotation.y = f.t * 2.5; f.o.scale.setScalar(Math.max(0.001, k) * 1.6); // 馬 1 頭分くらいの大きさ
      f.o.userData.ring.scale.setScalar(1 + Math.sin(f.t * 8) * 0.1);
      if (f.eaten > 0.25 || this.phase !== 'run') { this.scene.remove(f.o); return false; }
      return true;
    });
  };

  /* ---------- ゲートイン（枠入り）: 本物（JRA）と同じく奇数番 → 偶数番の順に、係員が 1 頭ずつ引いて枠に入れ、後ろの扉を閉める ----------
     待機（ベット中のパドックのあと）: 発走地点の後ろ（奇数番は 6m、偶数番は 8.5m 後ろ。自分の枠の真後ろ）で係員が頭を持って立つ。
     game.js が gateIn({ onEvent }) を呼ぶと、約 8 秒（?speed= の倍率で早送り）でゲートが開く時刻まで進めて Promise を返す。
     オーナー指示（2026-10-14、ChatGPT 95 点のテンポの助言）: 4 つの段（全景 → 横の中望遠 → 正面の静止 → 開く）を 7.5〜8.5 秒、正面の静止 0.8〜1.0 秒、開く直前の間 0.25〜0.35 秒。前は約 13 秒。
     台本（6 頭・等倍。歩く速さは前と同じ 2.4・2.6m/秒＝蹄が滑らない）: 0.1 秒 後ろの扉が開く → 0.6・1.0・1.4 秒に 1・3・5 番が歩き出す（約 3 秒で枠へ）
     → 1.4・1.9・2.4 秒に 2・4・6 番（約 3.8 秒。5 番と 2 番は同時＝2 頭ずつ並行）→ 入った馬から扉を閉める（最後は 6.8 秒に閉まる）
     → 全頭が枠の中で約 0.9 秒ほぼ静止 → 7.7 秒 体勢完了（上下の動きも止める）→ 0.3 秒の間 → 8.0 秒 ゲートが開く（game.js・v2 のテレビが発走）。
     カメラ（ctx.gateIn.cue。カメラは 1 台ずつ切り替え。JRA の中継の文法 ref/START_STUDY.md G1・G3・G4 と v2 講評 92→95 の 2）:
       wide＝ゲートの後ろ斜め・外の少し高い所からゲート全体（画面の横 7〜8 割。待つ馬・係員が手前で動く）
       → close＝外の目の高さから中望遠。最後に入る大外の馬が待って・歩き出し（顔が見える斜め前 → 真横）枠に入るまで（係員は馬の向こう側）
       → front＝ゲートの斜め前（約 18 度）の低い所から。残りの馬が枠に入り、全頭そろって約 1 秒ほぼ静止 → 体勢完了（ready）→ 開く・飛び出す（同じカメラのまま切らない）
     音（js/audio.js。あれば）: 始まりに薄い環境音、扉が閉まる「ガチャ」・首を振る鼻息（環境音より +2.5dB）、開く 0.5 秒前に他の音を下げてゲートの音を目立たせる */
  const GI_ROW = [-6.0, -8.5], GI_STALL = -0.4, GI_HAND = -2.85;   // 待つ所（奇数番・偶数番）、枠の中、係員が綱を放す所（ゲートの位置 gateS からの m）。前は -7.5・-10.5（13 秒の台本）
  const GI_ODD0 = 0.6, GI_ODD_GAP = 0.4, GI_EVEN_GAP = 0.5;   // 歩き出す時刻: 奇数番は 0.6 秒から 0.4 秒おき、偶数番は最後の奇数番と同時に始めて 0.5 秒おき（最初を 0.2 秒にすると、パドックから切り替わってすぐ歩き出し「歩く → 止まる → 歩く」が 0.6 秒未満で起きた）
  const GI_SHUT = 0.6, GI_STILL = 0.9, GI_PAUSE = 0.3;         // 最後の馬が止まってから後ろの扉が閉まりきるまで・全頭そろって静止・体勢完了から開くまでの間（秒）
  /* 確定演出 gateLate（ゲートインで遅れた馬。2026-10-16 オーナー「もっとわかりやすく」で大きく）: その馬だけ、係員が綱を放す所の 1.1m 手前
     （ゲートの 4.4m 後ろ＝鼻先が開いた後ろの扉の口）でぴたりと止まり（0.4 秒）、横のカメラに切り替わった直後（2.6 秒）から 2.0 秒ためらう：まず一度
     後ろ脚で立ち上がり（前脚が宙に浮く。0.7 秒）、着地して脚を踏ん張り（前を少し持ち上げて腰を落とす）首を 3 回大きく振り上げながら 22cm 後ずさりする。
     係員は綱を引いて体をのけぞらせ（3 回）、枠の中で待っていたもう 1 人の係員が走って来て反対側（外）からも引く。そのあと速足（1.3 倍）で枠へ入り、
     どの馬より最後（約 6.5〜6.6 秒。arrMax 6.8 秒まで）に入る。8.0 秒でゲートが開く共有の時計はそのまま＝体勢完了（ready）・開く時刻（end）・
     カメラの切り替え（dep0・arr0）は遅れの無い台本から決める。遅れた馬の扉が閉まりきるのは約 7.1〜7.2 秒（体勢完了の 0.5 秒以上前）。
     横のカメラ（2.5〜5.0 秒）の主役（sideFocus）はこの馬。外の 7.5m・高さ 4m から見下ろす（隣の馬が通っても騎手の頭より上から顔が見える。director3d の GI_LATE_OUT） */
  const GI_LATE = { at: GI_HAND - 0.45 - 1.1, stop: 0.4, hold: 2.0, rear: 0.7, back: 0.22, backT: 0.8, go: 0.5, hurry: 1.3, tosses: 3, arrMax: 6.8 };   // hold: ためらう秒（2026-10-16 夜「もっと強調」で 1.3→2.0）、rear: そのうち最初に立ち上がる秒、arrMax: 遅くともこの秒までに枠に入る
  function giPlanFor(n, late) {
    const order = []; for (let i = 0; i < n; i += 2) order.push(i); for (let i = 1; i < n; i += 2) order.push(i);
    const nOdd = Math.ceil(n / 2), H = [];
    order.forEach((i, k) => {
      const odd = i % 2 === 0, from = GI_ROW[odd ? 0 : 1], D = GI_STALL - from, v = odd ? 2.4 : 2.6;
      const dep = k < nOdd ? GI_ODD0 + k * GI_ODD_GAP : GI_ODD0 + (nOdd - 1) * GI_ODD_GAP + (k - nOdd) * GI_EVEN_GAP, dur = D / v + 0.7;   // 歩き出し 0.6 秒・止まる 0.8 秒の台形の速さ
      H[i] = { k, from, D, v, dep, dur, arr: dep + dur, toss: dep + dur - 1.5, dep0: dep, arr0: dep + dur };   // toss: 枠に近づいて係員が綱を放すころ、首をくいっと振る時刻
    });
    const last = order[order.length - 1], ready = H[last].arr + GI_SHUT + GI_STILL, lastArr = H[last].arr, isLate = late >= 0 && late < n && !!H[late];
    if (isLate) {
      const pl = H[late], L = GI_LATE, D1 = Math.min(L.at - pl.from, pl.D - 1), D2 = pl.D - (D1 - L.back), v2 = pl.v * L.hurry;
      const segs = [{ D: D1, v: pl.v, ta: 0.6, td: L.stop }, { hold: true, back: L.back, tb: L.backT, dur: L.hold }, { D: D2, v: v2, ta: L.go, td: 0.8 }];
      segs.forEach((sg) => { if (!sg.hold) sg.dur = sg.D / sg.v + (sg.ta + sg.td) / 2; });
      // 止まる時刻 balk は横のカメラに切り替わった（最後の馬の dep0 + 0.1）0.1 秒後。到着が arrMax を超えるなら、ためらいを縮める（最低 1.0 秒）
      const balk = H[last].dep0 + 0.2, maxHold = Math.max(1.0, L.arrMax - balk - segs[2].dur);
      if (segs[1].dur > maxHold) segs[1].dur = maxHold;
      const dur = segs.reduce((a, sg) => a + sg.dur, 0), dep = balk - segs[0].dur, arr = balk + dur - segs[0].dur;
      // balk: 止まった時刻（立ち上がる・首を振る・鼻を鳴らす）、hold: 止まっている秒、rearT: そのうち立ち上がっている秒
      Object.assign(pl, { segs, dur, dep, arr, toss: arr - 1.5, balk, hold: segs[1].dur, rearT: Math.min(L.rear, segs[1].dur * 0.4), late: true });
    }
    // 横のカメラは外の少し高い所から（内側からだと放したあと下がる係員の頭やほかの馬が手前にかぶった。2026-10-16 の写真で確認）。'in' にすると係員は馬の右（外）に立つ
    const side = 'out';
    // focus: 時計の主役＝遅れの無い台本で最後に入る馬（大外。カメラの切り替えの時刻）。sideFocus: 横のカメラが追う馬（遅れる馬がいればその馬）。lastIn: 実際に最後に入る馬（字幕）
    return { order, nOdd, H, last, focus: last, sideFocus: isLate ? late : last, lastIn: isLate ? late : last, side, ready, end: ready + GI_PAUSE, late: isLate ? late : -1 };
  }
  // 台形の速さ（歩き出し ta 秒・止まる td 秒・あいだは v m/秒）で D m: 始めから tau 秒で [進んだ m, 速さ m/秒]
  function trapAt(D, v, ta, td, tau) {
    const dur = D / v + (ta + td) / 2;
    if (tau <= 0) return [0, 0];
    if (tau >= dur) return [D, 0];
    if (tau < ta) return [v * tau * tau / (2 * ta), v * tau / ta];
    if (tau < dur - td) return [v * ta / 2 + v * (tau - ta), v];
    const r = dur - tau; return [D - v * r * r / (2 * td), v * r / td];
  }
  // 歩き出してから T 秒: [進んだ m, 速さ m/秒]（遅れる馬は 歩く → 止まって後ずさり → 歩く の 3 つの区間）
  function giWalk(pl, T) {
    const tau = T - pl.dep;
    if (!pl.segs) return trapAt(pl.D, pl.v, 0.6, 0.8, tau);
    if (tau <= 0) return [0, 0];
    let s0 = 0, t0 = 0;
    for (let k = 0; k < pl.segs.length; k++) {
      const sg = pl.segs[k], u = tau - t0;
      if (u < sg.dur || k === pl.segs.length - 1) {
        if (sg.hold) return [s0 - sg.back * smooth01(u / sg.tb), 0];
        const r = trapAt(sg.D, sg.v, sg.ta, sg.td, u); return [s0 + r[0], r[1]];
      }
      t0 += sg.dur; s0 += sg.hold ? -sg.back : sg.D;
    }
    return [pl.D, 0];
  }
  const smooth01 = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  // 馬 i のゲートの位置からの m（発走前）
  // 枠の中で立つ位置（ゲートの位置からの m）。鼻先が閉じた前扉（会場のゲートの前扉は +0.96m）を突き抜けないよう、体の長い馬は少し奥（最大 −0.6m）に立つ
  Race3D.prototype.stallOf = function (i) { const d = this.hdim && this.hdim[i]; return d ? clamp(0.93 - (d.f - 0.1), -0.6, GI_STALL) : GI_STALL; };
  Race3D.prototype.giDs = function (i) {
    const P = this.giPlan, pl = P && P.H[i], st = this.stallOf(i); if (!pl) return st;
    if (this.gi) return pl.from + giWalk(pl, this.gi.t)[0] * (st - pl.from) / pl.D; // 台本の歩き（GI_STALL まで）を自分の立つ位置までに伸び縮み
    return this.gateShot ? st : pl.from; // ゲートインなしで発走するとき（?gatein=0）は枠の中
  };
  Race3D.prototype.giSpeed = function (i) { const P = this.giPlan, pl = P && P.H[i]; return pl && this.gi ? giWalk(pl, this.gi.t)[1] * (this.stallOf(i) - pl.from) / pl.D : 0; };
  // 見た目だけの味付け（時刻はゲートインの時計 gi.t だけで決まる＝どのテレビでも同じ）: 枠に近づくと 0.16 秒だけ首を振り上げ、
  // 枠に入ったら重心を移して小さく上下する（体を 0〜3cm 沈める。馬ごとに速さと位相をずらす。体勢完了の前に止まる）
  Race3D.prototype.giFidget = function (i, st) {
    const P = this.giPlan, pl = P && P.H[i], G = this.gi; if (!pl || !G) return;
    const T = G.t, u = (T - pl.toss) / 0.16;
    if (u > 0 && u < 1) st.toss = Math.sin(Math.PI * u);
    if (pl.late) {
      // 遅れる馬: 止まった所でまず後ろ脚で立ち上がり（gait 'rear'、高さ rearAmp。rearT 秒）、着地してからは脚を踏ん張って前を持ち上げ（balk 0〜1）、
      // 残りの時間で首を 3 回大きく振り上げる（toss は 1.5 まで＝ふつうの 1.5 倍）。立ち上がっている間も首を振る
      const hold = pl.hold || GI_LATE.hold, rT = pl.rearT || 0, u = T - pl.balk;
      if (u >= 0 && u < rT && st.gait === 'stand') { const rr = u / rT; st.gait = 'rear'; st.rearAmp = Math.max(0.1, 0.62 * smooth01(rr / 0.45) * (1 - 0.82 * smooth01((rr - 0.55) / 0.45))); st.toss = Math.max(st.toss || 0, 0.8 * Math.sin(Math.PI * rr)); }   // 高さは 0.3 秒で上がり、後半はゆっくり下りて（0.11 まで）から着地＝前脚が速く上がったり落ちたりしない
      else {
        const w = (u - rT) / Math.max(0.3, hold - rT);
        const env = smooth01((u - rT + 0.1) / 0.35) * (1 - smooth01((u - hold + 0.15) / 0.35));
        if (env > 0) st.balk = env;
        if (w > 0 && w < 1) { const nT = GI_LATE.tosses; st.toss = Math.max(st.toss || 0, 1.5 * Math.pow(Math.abs(Math.sin(Math.PI * nT * w)), 0.8) * (1 - 0.15 * Math.floor(nT * w))); }
      }
    }
    const k = smooth01((T - pl.arr - 0.4) / 0.8) * (1 - smooth01((T - (this.giPlan.ready - GI_PAUSE)) / GI_PAUSE));   // 体勢完了までに止める（開く直前の間は全頭が静止）
    if (k > 0) st.sink = k * 0.015 * (1 - Math.cos(2 * Math.PI * (0.5 + 0.09 * (i % 3)) * (T - pl.arr) + i * 1.7));
  };
  // 後ろの扉の開き具合（枠ごと）。ゲートインの間だけ
  Race3D.prototype.giRear = function () {
    const G = this.gi, P = this.giPlan; if (!G || !P) return null;
    const out = this._rear || (this._rear = []);
    for (let i = 0; i < P.H.length; i++) { const pl = P.H[i], op = smooth01((G.t - 0.1) / 0.5), cl = smooth01((G.t - pl.arr - 0.15) / 0.45); out[i] = op * (1 - cl); }
    out.length = P.H.length; return out;
  };
  // 遅れる馬の係員の綱の引き（0〜1）: 止まっている間、立ち上がる間は強く引きっぱなし、そのあと首振りに合わせて 3 回引く
  function giTug(pl, T) {
    if (!pl || !pl.late) return 0;
    const hold = pl.hold || GI_LATE.hold, rT = pl.rearT || 0, u = T - pl.balk;
    if (u < -0.1 || u > hold + 0.1) return 0;
    const env = smooth01((u + 0.1) / 0.3) * (1 - smooth01((u - hold + 0.2) / 0.3));
    if (u < rT) return env * (0.75 + 0.25 * Math.sin(Math.PI * u / Math.max(0.1, rT)));
    const w = (u - rT) / Math.max(0.3, hold - rT);
    return env * (0.35 + 0.65 * Math.pow(Math.abs(Math.sin(Math.PI * GI_LATE.tosses * w + 0.5)), 1.5));
  }
  // 係員: 馬の左（内側）で頭を持って歩き、枠の後ろで綱を放す。扉が閉まったら少し下がる。
  // 遅れる馬（gateLate）を内側のカメラで撮るときだけ、係員は馬の右（外側）で左手で引く（カメラと馬の顔の間に立たない）。止まった所では綱を引いて体をのけぞらせる（3 回）
  Race3D.prototype.giHandler = function (i, hz, hd, o, dt) {
    const P = this.giPlan, pl = P && P.H[i]; if (!pl) { hd.visible = false; return; }
    const outer = !!(pl.late && P.side === 'in');
    const T = this.gi ? this.gi.t : -1, ds = this.giDs(i), gs = this.gateS, lr = laneR(i), p = pointAt(gs + ds, lr);
    let headF = 1.15;
    if (hz.getHeadPosition) { o.updateMatrixWorld(true); hz.getHeadPosition(_hb); headF = (_hb.x - o.position.x) * p.hx + (_hb.z - o.position.z) * p.hz; }
    else { const q = pointAt(gs + ds + 1.15, lr); _hb.set(q.x, 1.6, q.z); }
    let hr = outer ? Math.min(lr + 0.9, RO - 0.35) : Math.max(lr - 0.9, RI + 0.35); const relP = GI_HAND - 0.45; // 開いた後ろ扉は係員の側へ開くので、扉の 0.45m 手前で綱を放す（そこからは馬が自分で入る）
    let hs = Math.min(ds + headF + 0.15, relP);
    // 遅れる馬の係員: 止まっている間（balk〜balk+hold）綱を 3 回引く。引くたびに半歩下がって（最大 0.22m）体をのけぞらせる（最大 0.42 ラジアン）
    const tug = this.gi ? giTug(pl, T) : 0;
    if (tug > 0) hs -= 0.22 * tug;
    const hr0 = hr, rel = this.gi ? T - pl.arr - 0.6 : -1;   // rel: 綱を放してからの秒
    if (rel > 0) { const w = smooth01((rel - 0.6) / 1.1), w0 = smooth01(rel / 0.35); hs = relP - 0.35 * w0 - 1.3 * w; hr += 0.45 * w; } // 放したらまず半歩（0.35m）下がって扉から離れ、0.6 秒は向きを変えるだけ
    // ゲートの後ろは 1000m では第 1 コーナーの弧の上 → 弧に沿わせず、ゲートのまっすぐな向きで置く（弧だと下がり幅が縮み、開いた後ろ扉に重なっていた）
    const gp = (d, r) => { const b = pointAt(gs, r); return { x: b.x + b.hx * d, z: b.z + b.hz * d, hx: b.hx, hz: b.hz }; };
    // 引いて歩く間は馬と同じ弧の上、放したあとはゲートのまっすぐな向き（0.3 秒かけてつなぐ＝瞬間移動しない）
    const qa = pointAt(gs + hs, hr), qb = gp(hs, hr), mb = rel > 0 ? smooth01(rel / 0.3) : 0;
    const q = { x: qa.x + (qb.x - qa.x) * mb, z: qa.z + (qb.z - qa.z) * mb, hx: qb.hx, hz: qb.hz }, pv = hd.userData.prevP;
    const v = pv && dt > 0 ? Math.min(3, Math.hypot(q.x - pv.x, q.z - pv.z) / dt) : 0; hd.userData.prevP = { x: q.x, z: q.z };
    // 向き: ふだんはゲート（進む向き）。下がる間は下がる向きへ振り返って歩く。なめらかに回す（1 秒に約 9 ラジアンまで）
    let yawT = Math.atan2(-q.hz, q.hx);
    if (rel > 0 && rel < 1.75) { const a = gp(relP, hr0), b = gp(relP - 1.3, hr0 + 0.45); yawT = Math.atan2(-(b.z - a.z), b.x - a.x); }
    let yaw = hd.userData.yaw; if (yaw == null || !isFinite(yaw)) yaw = yawT;
    let dy = yawT - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yaw += Math.sign(dy) * Math.min(Math.abs(dy), 4.5 * Math.max(0, dt)); hd.userData.yaw = yaw; // 振り向きは 1 秒に約 4.5 ラジアン（180° を約 0.7 秒）
    // z（向きを決めたあとの左右の軸）の + ＝後ろへのけぞる（足もとが支点）
    hd.visible = true; hd.position.set(q.x, 0, q.z); hd.rotation.order = 'YZX'; hd.rotation.y = yaw; hd.rotation.z = 0.42 * tug;
    hd.updateMatrixWorld(true);
    const hand = outer ? hd.userData.hand : hd.userData.handR || hd.userData.hand; hand.localToWorld(_ha.set(0, -0.52, 0));
    const hold = _ha.distanceTo(_hb) < 1.8, rope = hd.userData.rope;
    hd.userData.walk(dt, v, !outer, hold);
    if (rope) { if (hold) { hd.updateMatrixWorld(true); hand.localToWorld(_ha.set(0, -0.52, 0)); _hb.y -= 0.12; setRope(rope, _ha, _hb); } else rope.visible = false; }
  };
  /* 2 人目の係員（確定演出 gateLate のときだけ）: 遅れる馬の枠の中（ゲートの 0.9m 後ろ）で待ち、止まる 1.55 秒前に枠の後ろへ走り出し（3m/秒。
     まっすぐ後ろへ 2.4m → 外へ 0.9m＝開いた後ろの扉の内側を抜けて馬の頭の外側へ）、止まっている間は 1 人目と一緒に綱を引いてのけぞる。
     馬が枠へ歩き出したら綱を放す所（relP）に立って見送り、放したら外へ下がる。レース中・パドックでは消える */
  Race3D.prototype.giHandler2 = function (dt) {
    const P = this.giPlan, hd = this.handler2, G = this.gi, li = P ? P.late : -1, pl = li >= 0 ? P.H[li] : null, rope = hd.userData.rope;
    if (!pl || !G) { hd.visible = false; if (rope) rope.visible = false; return; }
    const T = G.t, lr = laneR(li), gs = this.gateS, relP = GI_HAND - 0.45, hz = this.horses3d[li], o = hz.object3d;
    const t0 = pl.balk - 1.55, D1 = relP + 0.9 > 0 ? 0 : -(relP + 0.9), r1 = trapAt(D1, 3.0, 0.2, 0.2, T - t0), d1 = D1 / 3.0 + 0.2, r2 = trapAt(0.9, 2.5, 0.15, 0.15, T - t0 - d1);
    const rel = T - pl.arr - 0.6, tug = giTug(pl, T);
    let ds = -0.9 - r1[0], r = lr + r2[0], face = T < t0 ? 1 : T < t0 + d1 ? -1 : 1;
    if (tug > 0) ds -= 0.22 * tug;
    if (rel > 0) { const w = smooth01((rel - 0.6) / 1.1), w0 = smooth01(rel / 0.35); ds = relP - 0.35 * w0 - 1.3 * w; r = lr + 0.9 + 0.5 * w; face = rel < 1.75 ? -1 : 1; }
    const q = pointAt(gs + ds, r), pv = hd.userData.prevP;
    const v = pv && dt > 0 ? Math.min(3, Math.hypot(q.x - pv.x, q.z - pv.z) / dt) : 0; hd.userData.prevP = { x: q.x, z: q.z };
    let yawT = Math.atan2(-q.hz, q.hx); if (face < 0) yawT += Math.PI;
    let yaw = hd.userData.yaw; if (yaw == null || !isFinite(yaw)) yaw = yawT;
    let dy = yawT - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yaw += Math.sign(dy) * Math.min(Math.abs(dy), 4.5 * Math.max(0, dt)); hd.userData.yaw = yaw;
    hd.visible = true; hd.position.set(q.x, 0, q.z); hd.rotation.order = 'YZX'; hd.rotation.y = yaw; hd.rotation.z = 0.42 * tug;
    hd.updateMatrixWorld(true);
    let hold = false;
    if (T >= t0 + d1 + 0.5 && rel <= 0.0 && hz.getHeadPosition) { o.updateMatrixWorld(true); hz.getHeadPosition(_hb); hd.userData.hand.localToWorld(_ha.set(0, -0.52, 0)); hold = _ha.distanceTo(_hb) < 1.8; }
    hd.userData.walk(dt, v, false, hold);
    if (rope) { if (hold) { hd.updateMatrixWorld(true); hd.userData.hand.localToWorld(_ha.set(0, -0.52, 0)); _hb.y -= 0.12; setRope(rope, _ha, _hb); } else rope.visible = false; }
  };
  // ゲートインを始める（game.js から）。終わったら（体勢完了の約 1 秒後）解決する Promise。字幕は opt.onEvent(text)
  Race3D.prototype.gateIn = function (opt) {
    opt = opt || {};
    const P = this.giPlan;
    if (!P || this.phase !== 'idle' || this.run) { this.gateShot = true; return Promise.resolve(); }
    const name = (i) => this.race.horses[i].name, first = P.order.slice(0, P.nOdd).sort((a, b) => P.H[a].arr - P.H[b].arr)[0], lastOdd = P.order.slice(0, P.nOdd).sort((a, b) => P.H[b].arr - P.H[a].arr)[0], last = P.last, ev = []; // first / lastOdd: 実際に最初・奇数番で最後に入る馬（遅れる馬がいると順が入れ替わる）
    ev.push([0.05, '各馬 ゲートインを開始しました'], [1.6, '奇数番の馬から 順にゲートへ'], [P.H[first].arr + 0.6, (first + 1) + '番 ' + name(first) + ' 入りました']);
    if (P.order.length > P.nOdd) ev.push([P.H[lastOdd].arr + 0.6, '続いて 偶数番の馬がゲートへ']);
    const lastIn = P.lastIn != null ? P.lastIn : last;
    ev.push([P.H[lastIn].arr - 1.2, '最後に ' + (lastIn + 1) + '番が入って'], [P.ready, '体勢 完了']);
    ev.sort((a, b) => a[0] - b[0]);
    this.gateShot = true; this.cam.mode = '';
    const G = this.gi = { t: 0, ev, k: 0, onEvent: opt.onEvent, cue: 'wide', finished: false, done: null, clock: typeof opt.clock === 'function' ? opt.clock : null };
    return new Promise((resolve) => {
      G.done = resolve;
      // 念のため: 画面が隠れて描画が止まっても、決まった時間で必ず終える（setTimeout は ?speed= で早送りされる）
      setTimeout(() => { if (this.gi === G && !G.finished) this.giFinish(); }, (P.end + 8) * 1000);
    });
  };
  Race3D.prototype.giStep = function (dt) {
    const G = this.gi, P = this.giPlan; if (!G || G.finished || !P) return;
    G.t += dt;
    while (G.k < G.ev.length && G.t >= G.ev[G.k][0]) { const e = G.ev[G.k++]; try { if (G.onEvent) G.onEvent(e[1]); } catch (er) { console.error(er); } }
    // 全景 約 2.5 秒（主役が歩き出すまで）→ 横 約 2.5 秒（主役の頭が枠に入るまで。そこからは枠の端に隠れるので切る）→ 正面 約 3 秒（主役が枠に収まり扉が閉まる → 静止 0.9 秒 → 体勢完了 → 間 0.3 秒 → 開く）
    { const F = P.H[P.focus]; G.cue = G.t < F.dep0 + 0.1 ? 'wide' : G.t < F.arr0 - 1.25 ? 'close' : G.t < P.ready - 0.15 ? 'front' : 'ready'; } // 主役が遅れる馬でもカメラの切り替えは遅れの無い時刻
    this.giSound(G, P);
    if (G.t >= P.end) this.giFinish();
  };
  // ゲートインの音（js/audio.js の Sfx。無い・消音なら何もしない）。決まった時刻を過ぎたコマで 1 回だけ。途中から見始めたとき（0.35 秒より遅れた分）は鳴らさない
  Race3D.prototype.giSound = function (G, P) {
    const S = window.Sfx; if (!S || !S.play) return;
    const F = G.snd || (G.snd = {}), T = G.t;
    const at = (key, t0, fn) => { if (F[key] || T < t0) return; F[key] = 1; if (T - t0 < 0.35) { try { fn(); } catch (e) { } } };
    at('bed', 0, () => S.play('giStart'));
    for (let k = 0; k < P.order.length; k++) {
      const i = P.order[k], pl = P.H[i], pan = (i / Math.max(1, P.H.length - 1)) * 1.2 - 0.6;
      at('t' + i, pl.toss, () => S.play('giSnort', pan));
      if (pl.late) at('b' + i, pl.balk + 0.05, () => S.play('giSnort', pan));   // 遅れる馬: 止まった所でも鼻を鳴らす
      at('l' + i, pl.arr + 0.58, () => S.play('giLatch', pan));   // 後ろの扉が閉まりきる（giRear: arr+0.15 から 0.45 秒）
    }
    at('duck', P.end - 0.5, () => S.play('giDuck'));   // ゲートが開く（P.end）0.5 秒前
  };
  // 終わり（全頭が枠の中・扉は閉）
  Race3D.prototype.giFinish = function () {
    const G = this.gi, P = this.giPlan; if (!G || G.finished) return;
    G.finished = true; if (P) G.t = Math.max(G.t, P.end); G.cue = 'ready';
    if (G.onEvent) for (; G.k < G.ev.length; G.k++) { if (/体勢/.test(G.ev[G.k][1])) { try { G.onEvent(G.ev[G.k][1]); } catch (er) { console.error(er); } } }
    const d = G.done; G.done = null; if (d) d();
  };

  // 確定演出（eye）: 馬 i の頭がカメラからほかの馬（胴を 2 つの球・頭を 1 つの球で近似）に隠れているか。カメラと馬の位置だけで決まる
  const _eh = new THREE.Vector3(), _ej = new THREE.Vector3();
  Race3D.prototype.eyeOccluded = function (i) {
    const hz = this.horses3d[i]; if (!hz || !hz.getHeadPosition || !this.camera) return false;
    hz.object3d.updateMatrixWorld(true); hz.getHeadPosition(_eh);
    const cp = this.camera.position, dx = _eh.x - cp.x, dy = _eh.y - cp.y, dz = _eh.z - cp.z, L2 = dx * dx + dy * dy + dz * dz; if (L2 < 1e-6) return false;
    const hit = (x, y, z, r) => { const t = ((x - cp.x) * dx + (y - cp.y) * dy + (z - cp.z) * dz) / L2; if (t <= 0 || t >= 1) return false; const px = cp.x + dx * t - x, py = cp.y + dy * t - y, pz = cp.z + dz * t - z; return px * px + py * py + pz * pz < r * r; };
    for (let j = 0; j < this.horses3d.length; j++) {
      if (j === i) continue; const o = this.horses3d[j] && this.horses3d[j].object3d; if (!o || !o.visible) continue;
      const fx = Math.cos(o.rotation.y), fz = -Math.sin(o.rotation.y);
      if (hit(o.position.x + fx * 0.45, 1.15, o.position.z + fz * 0.45, 0.75) || hit(o.position.x - fx * 0.45, 1.15, o.position.z - fz * 0.45, 0.75)) return true;
      if (this.horses3d[j].getHeadPosition) { o.updateMatrixWorld(true); this.horses3d[j].getHeadPosition(_ej); if (hit(_ej.x, _ej.y, _ej.z, 0.45)) return true; }
    }
    return false;
  };
  /* ---------- 描画: 3D の場面を動かして描き、上のキャンバスにテロップ ---------- */
  const _v = new THREE.Vector3(), _r = new THREE.Vector3();
  Race3D.prototype.updateWorld = function (dt) {
    const race = this.race, run = this.run, n = race.horses.length, pad = this.inPaddock(), phase = this.phase;
    const L_ = this.leaderIdx(), dist = race.dist;
    // 直線（残り 420m から）では先頭 2 頭の足元の土煙を強く（講評 r2 の 6。馬の部品の dustBoost）
    const dustTop = run && phase === 'run' && (1 - Math.min(1, run.pos[L_])) * dist < 420 ? race.horses.map((_, i) => i).sort((a, b) => run.pos[b] - run.pos[a]).slice(0, 2) : null;
    for (let i = 0; i < n; i++) {
      const hz = this.horses3d[i]; if (!hz) continue;
      const o = hz.object3d, hd = this.handlers[i];
      let p, st;
      if (pad) {
        p = this.paddockPos(i); st = { gait: 'walk', speed: 1.5, lean: 0, whip: 0 };
        // 厩務員: 馬の頭の内側（楕円の中心向き）
        const il = Math.hypot(p.lx, p.lz) || 1; hd.visible = true;
        hd.position.set(p.x + p.hx * 1.1 - p.lx / il * 0.85, 0, p.z + p.hz * 1.1 - p.lz / il * 0.85); hd.rotation.y = Math.atan2(-p.hz, p.hx); hd.rotation.z = 0; hd.userData.walk(dt, 1.5);
      } else {
        if (run) { hd.visible = false; if (hd.userData.rope) hd.userData.rope.visible = false; }
        p = this.horsePos(i);
        if (!run) { const v = this.giSpeed(i); st = { gait: v > 0.05 ? 'walk' : 'stand', speed: v, lean: 0, whip: 0 }; this.giFidget(i, st); } // 発走前: ゲートの後ろで待つ・係員に引かれて枠へ歩く
        else if (this.gateShot) st = { gait: 'stand', speed: 0, lean: 0, whip: 0 };
        else {
          const sp = this.spd[i] || 0, fin = !!run.finish[i];
          const gait = sp > 9.5 ? 'gallop' : sp > 3.5 ? 'canter' : sp > 0.3 ? 'walk' : 'stand';
          // 曲がりの傾き（コーナーだけ。内＝左へ）
          const sm = ((this.horseS(i) % L) + L) % L, corner = (sm >= LS && sm < LS + Math.PI * RC) || sm >= 2 * LS + Math.PI * RC;
          const lean = corner ? Math.min(0.22, sp * sp / (9.8 * (this.lane ? this.lane[i] : RC)) * 0.35) : 0;
          const rem = (1 - Math.min(1, run.pos[i])) * dist;
          st = { gait, speed: sp, lean, whip: !fin && rem < 360 && phase !== 'winner' ? clamp((360 - rem) / 120, 0, 1) : 0 };
          if (phase === 'winner' && this.winStage !== 'back' && i === this.winnerIdx) st = { gait: sp > 5 ? 'canter' : 'trot', speed: sp, lean: 0, whip: 0 }; // 勝ち馬は騎手を乗せたまま速歩（気分 'win' で首を振る）
        }
      }
      // 向き: 進む向き＋進路を変えている分（外へ動くときは少し右へ）
      let yaw = Math.atan2(-p.hz, p.hx);
      if (!pad && run && this.lane) {
        let lv; if (this.lv) lv = this.lv[i] || 0; else { const prev = hz._lane == null ? this.lane[i] : hz._lane; lv = dt > 0 ? (this.lane[i] - prev) / dt : 0; } // 横の速さ（新しい進路取りは自分で持っている）
        hz._lane = this.lane[i];
        const want = st.speed > 0.5 ? -clamp(Math.atan2(lv, Math.max(2, st.speed)), -0.3, 0.3) : 0;
        if (LAYOUT_OLD) hz._yawOff = (hz._yawOff || 0) * 0.8 + (st.speed > 1 ? -clamp(Math.atan2(lv, st.speed), -0.3, 0.3) : 0) * 0.2; // 前の向きの付け方（比べる用）
        else hz._yawOff = (hz._yawOff || 0) + (want - (hz._yawOff || 0)) * (1 - Math.exp(-dt / 0.12));
        yaw += hz._yawOff;
      }
      else { hz._lane = null; hz._yawOff = 0; }
      if (!pad && !run) yaw += 0.1 * Math.sin(this.t * 0.37 + i * 1.9) * Math.max(0, 1 - this.giSpeed(i) / 0.6) * clamp((this.stallOf(i) - this.giDs(i)) / 2, 0, 1); // 待っている馬は少しずつ首・体の向きを変える（枠に近づいたら止める。枠の中で向きを変えていると、発走の瞬間に向きが飛ぶ）
      o.position.set(p.x, 0, p.z); o.rotation.y = yaw;
      o.visible = !(phase === 'winner' && this.winHide && this.winHide[i]); // 勝ち馬のアップ: 手前・横の負けた馬は映さない（winnerClear）
      const jk = !pad; // 騎手はパドック以外ずっと乗せる（勝ち馬のアップも騎手つきで速歩）
      if (hz.setJockey && hz._jockey !== jk) { hz._jockey = jk; try { hz.setJockey(jk); } catch (e) { warnOnce('Horse.setJockey', e); } }
      st.surface = race.surface;
      if ('dustBoost' in hz) { const k = dustTop && dustTop.indexOf(i) >= 0 && !run.finish[i] ? 1.7 : 1; if (hz._dk !== k) { hz._dk = k; try { hz.dustBoost = k; } catch (e) { warnOnce('Horse.dustBoost', e); } } }
      if (hz.setBoost) { const k = this.boostK ? this.boostK[i] || 0 : 0; if (hz._boost !== k) { hz._boost = k; try { hz.setBoost(k); } catch (e) { warnOnce('Horse.setBoost', e); } } }
      // ゴール後の気分（馬の部品の setMood）: 勝ち馬は首を振って喜び、ほかは少しうなだれる。リプレイ中は戻す
      if (hz.setMood) { const m = run && phase !== 'replay' && run.finish[i] && this.winnerIdx >= 0 ? (i === this.winnerIdx ? 'win' : 'lose') : null; if (hz._mood !== m) { hz._mood = m; try { hz.setMood(m); } catch (e) { warnOnce('Horse.setMood', e); } } }
      // 勝ち馬のアップでは騎手がムチを突き上げて喜ぶ（馬の部品の setJockeyPose）
      if (hz.setJockeyPose) { const jp = phase === 'winner' && i === this.winnerIdx ? 'celebrate' : null; if (hz._jpose !== jp) { hz._jpose = jp; try { hz.setJockeyPose(jp); } catch (e) { warnOnce('Horse.setJockeyPose', e); } } }
      // 確定演出（eye）: 最終コーナーで目が一度きらっと光る。途中から見始めて（追いつき）過ぎていたら光らせない
      if (this.eyeAt != null && !this.eyeFired && run && i === this.cueHorse('eye')) {
        const el = run.t - this.eyeAt;
        // 途中から見始めて（追いつき）過ぎていたら光らせない
        if (el > EYE_WAIT + 0.6) this.eyeFired = true;
        else if (el >= EYE_WAIT || !this.eyeOccluded(i)) { this.eyeFired = true; this.eyeFireAt = run.t; if (hz.flashEye) { try { hz.flashEye(EYE_DUR, 0); } catch (e) { warnOnce('Horse.flashEye', e); } } }
      }
      try { hz.update(dt, st); } catch (e) { warnOnce('Horse.update', e); }
      if (pad && hd.userData.rope && hz.getHeadPosition) {
        try {
          // 厩務員は馬の頭の外側 0.9m・少し前を歩く（パドックのカメラは楕円の内側から撮るので、内側に立つと馬が隠れる。
          // 体型で頭の位置が違うので、頭の位置から決める）
          o.updateMatrixWorld(true); hz.getHeadPosition(_hb);
          // 楕円の外向きは中心からの向きではなく楕円の法線（細長い楕円では中心からの向きが前後に傾き、係員が馬の首に重なっていた）
          const pp = this.paddockPos(i), nx = pp.lx / (PD.a * PD.a), nz = pp.lz / (PD.b * PD.b), il = Math.hypot(nx, nz) || 1;
          hd.position.set(_hb.x + nx / il * 0.9 + pp.hx * 0.15, 0, _hb.z + nz / il * 0.9 + pp.hz * 0.15);
          hd.updateMatrixWorld(true); hd.userData.hand.localToWorld(_ha.set(0, -0.52, 0)); _hb.y -= 0.12; setRope(hd.userData.rope, _ha, _hb);
        } catch (e) { warnOnce('引き綱', e); }
      }
      else if (!pad && !run) { try { this.giHandler(i, hz, hd, o, dt); } catch (e) { warnOnce('ゲートの係員', e); } }
    }
    if (this.handler2) { if (!pad && !run) { try { this.giHandler2(dt); } catch (e) { warnOnce('2 人目の係員', e); } } else { this.handler2.visible = false; if (this.handler2.userData.rope) this.handler2.userData.rope.visible = false; } }
    if (!LAYOUT_OLD) this.fitRings(dt, pad); // ?layout=old（前の進路取りと比べる用）では輪も元のまま
    // 後ろの扉（ゲートインで開け、馬が入ったら閉める。変わったときだけ会場へ）
    { const rear = !run ? this.giRear() : null, key = rear ? rear.map((v) => v.toFixed(3)).join(',') : '';
      if (key !== this.rearKey) { this.rearKey = key; if (this.venue.setRearDoors) { try { this.venue.setRearDoors(rear); } catch (e) { warnOnce('venue.setRearDoors', e); } } } }
    this.updateFoods(dt);
    if (!run && (this.betAt = (this.betAt || 0) + dt) > 0.4) { this.betAt = 0; this.markBets(); } // ベット中も輪の明るさを追いかける
    // 土ぼこり
    this.dustFx.set(this.phase === 'run' ? this.dust : []);
    // 残線（2D 版と同じ条件: 先頭の残りが m+260 〜 m-8 のあいだ）
    const remainL = run ? (1 - Math.min(1, run.pos[L_])) * dist : 1e9;
    for (const m of [400, 200, 100]) this.remainMesh[m].visible = !!run && phase !== 'winner' && !pad && !(remainL < m - 8 || remainL > m + 260);
    // ゲート: 待機中は閉、発走 0.05 秒で開、5 秒で片付け
    this.setGate(!run || this.gateShot ? 'closed' : run.t <= 0 ? 'closed' : run.t < 5 ? 'open' : 'hidden'); // 馬が動き出したコマから開ける
    // ターフビジョンの文字（変わったときだけ）
    let txt;
    if (!run) txt = 'まもなく発走';
    else { const order = race.horses.map((_, i) => i).sort((a, b) => run.pos[b] - run.pos[a]), tt = Math.min(run.t, 599); txt = order.map((i) => i + 1).join(' ') + '  ' + Math.floor(tt / 60) + ':' + ('0' + Math.floor(tt % 60)).slice(-2); }
    if (txt !== this.boardText) { this.boardText = txt; try { this.venue.setBoard(txt); } catch (e) { warnOnce('venue.setBoard', e); } }
    try { this.venue.update(dt, this.t); } catch (e) { warnOnce('venue.update', e); }
  };
  /* 足元の輪（馬の部品の object3d の子 'ring'）が隣の馬の輪と大きく重ならないように、混んでいるときだけ縮める。
     輪は楕円として扱い、隣の輪の中心の向きで「自分の半径＋相手の半径 ≦ 中心の間＋5cm」になるよう、横に並ぶ相手なら横（幅）を、
     前後に並ぶ相手なら前後を縮める（横は元の 50%、前後は 65% まで）。大きさは 1 秒に 2.5 倍の速さまででなめらかに。パドックでは元の大きさ。
     馬番の札（'ringBadges'。輪とは別）は縮めない: 輪の前後の端に置き直し、文字の上がカメラの奥を向くよう地面の上で回す（どのカメラでも正立） */
  const _cp = new THREE.Vector3();
  Race3D.prototype.fitRings = function (dt, pad) {
    const HS = this.horses3d, n = HS.length, R = this._rings || (this._rings = []);
    for (let i = 0; i < n; i++) {
      if (R[i] && R[i].hz === HS[i]) continue;
      const o = HS[i].object3d, r = o.getObjectByName ? o.getObjectByName('ring') : null, bg = o.getObjectByName ? o.getObjectByName('ringBadges') : null;
      R[i] = r ? { hz: HS[i], r, bg, base: r.scale.x, cx: r.position.x, qx: 1, qz: 1, c: { x: 0, z: 0 } } : { hz: HS[i], r: null, bg };
    }
    R.length = n;
    for (let i = 0; i < n; i++) { const A = R[i]; if (!A.r) continue; const o = HS[i].object3d, y = o.rotation.y; A.f = { x: Math.cos(y), z: -Math.sin(y) }; A.c.x = o.position.x + A.f.x * A.cx; A.c.z = o.position.z + A.f.z * A.cx; }
    for (let i = 0; i < n; i++) {
      const A = R[i]; if (!A.r) continue;
      let wx = 1, wz = 1;
      if (!pad) {
        const ra = A.base * 0.4;
        for (let j = 0; j < n; j++) {
          const B = R[j]; if (j === i || !B.r) continue;
          const dx = B.c.x - A.c.x, dz = B.c.z - A.c.z, d = Math.hypot(dx, dz), rb = B.base * 0.4; // 相手は元の大きさで見る（縮んだ大きさで見ると互いに影響し合って伸び縮みが往復していた）
          if (d > ra + rb) continue;
          // 相手の向きでの自分の半径の上限（相手の分を引いた残り。半分ずつ受け持つ）
          const q = clamp((d + 0.05) / (ra + B.base * 0.4), 0.3, 1), c = Math.abs(dx * A.f.x + dz * A.f.z) / (d || 1), s = Math.abs(-dx * A.f.z + dz * A.f.x) / (d || 1);
          // 楕円の半径 r(θ) = ra / sqrt((c/qx)² + (s/qz)²) ≦ q·ra
          if (s >= c) { const rest = 1 / (q * q) - (c / wx) * (c / wx); wz = Math.min(wz, rest > 1e-4 ? clamp(s / Math.sqrt(rest), 0.5, 1) : 0.5); }
          else { const rest = 1 / (q * q) - (s / wz) * (s / wz); wx = Math.min(wx, rest > 1e-4 ? clamp(c / Math.sqrt(rest), 0.65, 1) : 0.65); }
        }
      }
      // 縮むのは速く（1 秒に 2.5）、戻るのはゆっくり（0.6）。ちらつき（往復）を防ぐ
      const kd = Math.min(1, 2.5 * Math.max(0, dt)), ku = Math.min(1, 0.6 * Math.max(0, dt));
      // 往復（伸び縮みのちらつき）を防ぐ: 目標をなめらかにならし（0.25 秒）、差が 0.04 未満なら動かさない。
      // 一度縮んだら 0.8 秒は戻さない。縦横は同じ向きにしか動かさない（片方が縮み片方が伸びる＝全体で往復、を避ける）
      const a4 = Math.min(1, 4 * Math.max(0, dt)); A.tx = A.tx == null ? wx : A.tx + (wx - A.tx) * a4; A.tz = A.tz == null ? wz : A.tz + (wz - A.tz) * a4;
      if (A.tx < A.qx - 0.04 || A.tz < A.qz - 0.04) A.hold = 0.8; A.hold = Math.max(0, (A.hold || 0) - dt);
      const ex = A.tx - A.qx, ez = A.tz - A.qz, shrink = ex < -0.04 || ez < -0.04, grow = !shrink && A.hold <= 0 && (ex > 0.04 || ez > 0.04);
      if (shrink) { A.qx += clamp(Math.min(0, ex), -kd, 0); A.qz += clamp(Math.min(0, ez), -kd, 0); }
      else if (grow) { A.qx += clamp(Math.max(0, ex), 0, ku); A.qz += clamp(Math.max(0, ez), 0, ku); }
      A.r.scale.set(A.base * A.qx, 1, A.base * A.qz);
    }
    // 馬番の札: 輪の前後の端（縮めた輪に合わせる）・カメラの方を向ける（札は馬の部品が地面から起こしてある）
    this.camera.getWorldPosition(_cp);
    const cam = this.camera, list = this._badgeList || (this._badgeList = []); list.length = 0;
    for (let i = 0; i < n; i++) {
      const A = R[i]; if (!A || !A.bg) continue;
      const o = HS[i].object3d, ud = A.bg.userData, qx = A.r ? A.qx : 1;
      A.bg.children.forEach((b) => {
        const sg = b.userData.sg || 1, lx = ud.midX + sg * ud.rad * qx;
        b.position.x = lx;
        const wx = o.position.x + A.f.x * lx, wz = o.position.z + A.f.z * lx, dx = wx - _cp.x, dz = wz - _cp.z;
        b.rotation.y = (dx * dx + dz * dz > 1e-6 ? Math.atan2(-dx, -dz) : -Math.PI / 2 + o.rotation.y) - o.rotation.y;
        // 画面での位置と大きさ（重なりを見る）
        _v.set(wx, (ud.d || 0.8) * 0.35, wz).applyMatrix4(cam.matrixWorldInverse); const depth = -_v.z;
        if (depth > 0.3) {
          _v.applyMatrix4(cam.projectionMatrix);
          const e = { b, x: _v.x * W / 2, y: _v.y * H / 2, r: (ud.d || 0.8) * 0.45 * (H / 2) / Math.tan(cam.fov / 2 / DEG) / depth, depth };
          // 自分の馬の脚（前脚・後ろ脚の下の方）に画面で重なる札は出さない（カメラが馬の後ろ・前寄りのとき。もう 1 枚は見える）
          let legs = false;
          for (const lx2 of [0.45, -0.5]) {
            _v.set(o.position.x + A.f.x * lx2, 0.35, o.position.z + A.f.z * lx2).applyMatrix4(cam.matrixWorldInverse); if (-_v.z <= 0.3) continue;
            _v.applyMatrix4(cam.projectionMatrix); if (Math.hypot(_v.x * W / 2 - e.x, _v.y * H / 2 - e.y) < e.r * 0.8) legs = true;
          }
          // パドックの紹介の帯（左下 x20〜540・y H-144〜H-20）の上に来る札は出さない（帯の馬名に札が重なっていた。2026-10-14 見た目の講評）
          const sx = W / 2 + e.x, sy = H / 2 - e.y, underHud = this.phase === 'idle' && this.info && !this.gateShot && sx > 20 - e.r && sx < 540 + e.r && sy > H - 144 - e.r;
          e.i = i; if (legs || underHud) b.userData.want = 0; else list.push(e);
        }
        else b.userData.want = 0;
      });
    }
    // 画面で重なる札は、手前の札を残して奥の札を薄くする（ぱっと消さず 0.15 秒で）。どの札とも重ならなければ濃く。
    // まず 1 頭 1 枚（その馬のいちばん手前の札）を手前の馬から、そのあと 2 枚目（なるべく全部の馬の馬番が見えるように）
    const first = {}; list.forEach((e) => { if (!first[e.i] || e.depth < first[e.i].depth) first[e.i] = e; });
    list.sort((a, b) => ((first[a.i] === a ? 0 : 1) - (first[b.i] === b ? 0 : 1)) || a.depth - b.depth);
    for (let k = 0; k < list.length; k++) {
      const e = list[k]; let hit = false;
      for (let q = 0; q < k && !hit; q++) { const f = list[q]; if (f.keep && Math.hypot(e.x - f.x, e.y - f.y) < 0.95 * (e.r + f.r)) hit = true; }
      e.keep = !hit; e.b.userData.want = hit ? 0 : 1;
    }
    const now = performance.now(), rdt = this._badgeT ? Math.min(0.1, (now - this._badgeT) / 1000) : 1; this._badgeT = now; // 薄くするのは実際の時間で（スロー・止めた画でも）
    const kf = Math.min(1, rdt / 0.15);
    for (let i = 0; i < n; i++) { const A = R[i]; if (!A || !A.bg) continue; A.bg.children.forEach((b) => { const m = b.material, w = b.userData.want == null ? 1 : b.userData.want; m.opacity += (w - m.opacity) * kf; b.visible = m.opacity > 0.02; }); }
  };
  Race3D.prototype.applyCamera = function () {
    const cam = this.cam, c = this.camera, vf = cam.vfov || h2v(cam.fov || 60);
    c.position.set(cam.p.x, cam.p.y, cam.p.z); c.up.set(0, 1, 0); c.lookAt(cam.t.x, cam.t.y, cam.t.z);
    // 遠くの望遠でも奥が切れないよう、近い面・遠い面を距離に合わせる
    const d = Math.hypot(cam.t.x - cam.p.x, cam.t.y - cam.p.y, cam.t.z - cam.p.z);
    const near = clamp(d * 0.02, 0.2, 4);
    if (Math.abs(c.fov - vf) > 1e-4 || c.near !== near) { c.fov = vf; c.near = near; c.updateProjectionMatrix(); }
    c.updateMatrixWorld();
  };
  Race3D.prototype.draw = function (adt) {
    const race = this.race; if (!race) return;
    const dt = adt || 0, t0 = performance.now();
    this.fitRes();
    try { this.updateWorld(dt); } catch (e) { warnOnce('updateWorld', e); }
    this.applyCamera();
    if (this.tv) this.lodHorses();
    if (this.handBatch) { try { updateHandBatch(this.handBatch, this.scene, this.handlers); } catch (e) { warnOnce('係員のまとめ', e); } }
    try { this.look.update(dt, this.camera, { slow: this.slow, remain: this.run && this.phase === 'run' ? this.remainNow : null }); } catch (e) { warnOnce('look.update', e); } /* 3 つ目: ゴール前に雨を薄くする目安（スローの倍率・先頭の残り m） */
    this.inset = null;
    if (this.phase === 'replay' && this.photoHold > 0 && this.run) { try { this.renderInset(); } catch (e) { this.inset = null; warnOnce('写真判定の小窓', e); } }
    this.renderer.info.reset();
    try { this.look.render(this.renderer, this.scene, this.camera); }
    catch (e) { warnOnce('look.render', e); try { this.renderer.render(this.scene, this.camera); } catch (e2) { warnOnce('renderer.render', e2); } }
    try { this.drawOverlay(this.ctx); } catch (e) { warnOnce('テロップ', e); }
    // 重さの記録と、遅い機械なら軽い描き方へ（コマの間隔が平均 40ms を超えたら）
    const pf = this.perf, now = performance.now(), ms = now - t0;
    pf.ms = pf.frames ? pf.ms * 0.95 + ms * 0.05 : ms;
    if (this.lastDrawAt && now - this.lastDrawAt < 250) { const gap = now - this.lastDrawAt; pf.gap = pf.gap * 0.95 + gap * 0.05; pf.fps = 1000 / pf.gap; }
    this.lastDrawAt = now; pf.frames++;
    const info = this.renderer.info.render; pf.calls = info.calls; pf.tris = info.triangles;
    // 自動の画質調整: 48fps を下回る状態が 2 秒続いたら解像度を 0.25 下げる。1 倍でも 28fps を下回るなら軽い描き方へ
    if (ADAPT && !this.lite && document.visibilityState === 'visible' && pf.frames > 120) {
      if (pf.gap > 21 && this.k > 1) { this.kCap = Math.max(1, this.k - 0.25); pf.frames = 0; pf.gap = 16.7; this.fitRes(true); console.info('casa DERBY 3D: 解像度を ' + this.k + ' 倍に下げました'); }
      else if (pf.gap > 36 && this.k <= 1) this.goLite();
    } else if (ADAPT && this.lite && !this.tv && document.visibilityState === 'visible' && pf.frames > 120 && pf.gap > 36) this.goTv(); // 軽い描き方でも 28fps を下回る → Fire TV 向けへ
    else if (ADAPT && this.tv && !TV_K_FIX && document.visibilityState === 'visible' && pf.frames > 90) { // Fire TV: 40fps を下回ったら 0.1 下げる。52fps を超えて 1 分たったら 0.1 戻す（2026-10-19: 45→40。細かさを優先）
      if (pf.gap > 25 && this.k > TV_K_MIN) { this.tvCap = Math.max(TV_K_MIN, Math.round((this.k - 0.1) * 10) / 10); this.tvDownAt = now; pf.frames = 0; pf.gap = 16.7; this.fitRes(true); console.info('casa DERBY 3D: Fire TV の解像度を ' + this.k + ' 倍に下げました'); }
      else if (this.tvCap && pf.gap < 19.2 && pf.frames > 600 && now - (this.tvDownAt || 0) > 60000) { this.tvCap = Math.round((this.tvCap + 0.1) * 10) / 10; if (this.tvCap >= TV_K_MAX) this.tvCap = 0; pf.frames = 0; pf.gap = 16.7; this.fitRes(true); console.info('casa DERBY 3D: Fire TV の解像度を ' + this.k + ' 倍に戻しました'); }
    }
    if (PERF_UI) this.perfUi(now);
  };
  // 遅いとき: まず解像度だけ 1.25 倍に下げ、それでも遅ければ軽い描き方（影・後処理・馬の作りを軽く）
  Race3D.prototype.goLite = function () {
    this.lite = true; this.resAt = 0; this.fitRes(true); this.perf.frames = 0; this.perf.gap = 16.7;
    this.horses3d.forEach((hz) => { try { hz.setQuality('low'); } catch (e) {} });
    try { if (this.look.setQuality) this.look.setQuality('low'); } catch (e) {}
    this.venueLowPending = true; // 会場の作り直しは 1 秒近くかかるので、レースの途中ではなく次のレースの準備のときに
    if (this.phase === 'idle' && !this.run) { this.venueLowPending = false; this.rebuildVenue('low'); }
    console.info('casa DERBY 3D: 軽い描き方に切り替え（1 コマ ' + this.perf.gap.toFixed(1) + 'ms）');
  };

  /* Fire TV 向け: 画面で小さく映る馬（体高が画面の高さの約 13% より小さい）は粗い形（'far'）にする。行ったり来たりしないよう 11%〜15% の幅を持たせる。
     形は最初に作ると使い回し（setQuality の中でキャッシュ）。アップ（パドック・勝ち馬・ゲートの近く）はいつもの軽い形 */
  Race3D.prototype.lodHorses = function () {
    let pc = this._padCrowd; if (!pc || !pc.parent) pc = this._padCrowd = this.scene.getObjectByName('crowdPaddock');
    if (pc) pc.visible = this.phase === 'idle' && !this.gateShot; // パドックの観客はパドックの場面だけ（レース中は映らない）
    const cam = this.camera, th = Math.tan(cam.fov * Math.PI / 360), L = this.lodQ || (this.lodQ = []);
    for (let i = 0; i < this.horses3d.length; i++) {
      const hz = this.horses3d[i], o = hz && hz.object3d; if (!o || !hz.setQuality) continue;
      const bl = o.getObjectByName('blob'), rg = o.getObjectByName('ring'); if (bl) bl.visible = !(rg && rg.visible); // 足元の輪が出ている間はぼかした丸（影）を描かない（描く回数を 6 回へらす）
      const d = Math.max(0.5, cam.position.distanceTo(o.position)), frac = 1.62 / (2 * d * th);
      const want = L[i] === 'far' ? (frac > 0.15 ? 'low' : 'far') : (frac < 0.11 ? 'far' : 'low');
      if (want !== L[i]) { L[i] = want; try { hz.setQuality(want); } catch (e) { warnOnce('Horse.setQuality far', e); } }
    }
  };
  // Fire TV 向けのさらに軽い描き方へ（自動）: 影を切る・解像度 0.8 倍・土煙の粒を粗く・会場は次のレースの準備のときに作り直す
  Race3D.prototype.goTv = function () {
    this.tv = R3D.tv = true; this.lite = true; this.resAt = 0; this.fitRes(true); this.perf.frames = 0; this.perf.gap = 16.7;
    this.noShadows();
    if (!this.handBatch && this.handlers.length) this.handBatch = makeHandBatch(this.scene, this.handlers);
    this.venueLowPending = true;
    if (this.phase === 'idle' && !this.run) { this.venueLowPending = false; this.rebuildVenue('low'); }
    console.info('casa DERBY 3D: Fire TV 向けの描き方に切り替え');
  };
  // 影を描かない（太陽の影の地図を作らない＝描く回数が半分近くに）。馬・人の足元のぼかした丸は残る
  Race3D.prototype.noShadows = function () {
    const r = this.renderer; if (!r.shadowMap.enabled) return;
    r.shadowMap.enabled = false;
    this.scene.traverse((o) => { if (o.isLight) o.castShadow = false; const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; }); });
    const d = this.scene.getObjectByName('horseDust'); if (d && d.geometry && d.geometry.parameters && d.geometry.parameters.detail > 0) { d.geometry.dispose(); d.geometry = new THREE.IcosahedronGeometry(1, 0); }
  };
  // ?perf=1 の重さの表示（左上。0.5 秒ごとに更新）: 画質・fps・1 コマの時間（ふつう／遅いほう 5%）・三角形・描く回数・場面・GPU
  Race3D.prototype.perfUi = function (now) {
    const P = this._pui || (this._pui = { el: null, ft: [], last: 0, at: 0, gpu: '' });
    if (P.last) { P.ft.push(now - P.last); if (P.ft.length > 180) P.ft.shift(); } P.last = now;
    if (now - P.at < 500) return; P.at = now;
    if (!P.el) {
      P.el = document.createElement('div'); P.el.id = 'perfUi';
      P.el.style.cssText = 'position:fixed;left:6px;top:6px;z-index:999;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.72);color:#fff;font:14px/1.45 monospace;white-space:pre;pointer-events:none';
      document.body.appendChild(P.el);
      try { const gl = this.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); P.gpu = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { }
    }
    const a = P.ft.slice().sort((x, y) => x - y), q = (f) => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : 0), mid = q(0.5), slow = q(0.95);
    const fps = mid ? 1000 / mid : 0, tier = this.tv ? 'tv' : this.lite ? 'low' : 'high', pf = this.perf;
    const ok = slow <= 34 ? 'OK' : slow <= 50 ? '注意' : '重い';
    P.el.textContent = '画質 ' + tier + '  解像度 ' + (this.k || 1) + '倍  影 ' + (this.renderer.shadowMap.enabled ? 'あり' : 'なし') + '\n' +
      fps.toFixed(0) + 'fps  1コマ ' + mid.toFixed(1) + 'ms  遅いコマ ' + slow.toFixed(1) + 'ms  → ' + ok + '\n' +
      '三角形 ' + Math.round(pf.tris / 1000) + 'k  描く回数 ' + pf.calls + '  場面 ' + this.phase + (this.gi ? '(ゲートイン)' : '') + '\n' + 'GPU ' + String(P.gpu).slice(0, 48);
  };
  // 会場を作り直す（会場の画質は作るときに決まるので、軽い描き方に切り替えるときに 'low' で作り直す）
  Race3D.prototype.rebuildVenue = function (q) {
    if (this.parts.Venue !== 'real' || !this.venue || !this.venue.dispose) return;
    try {
      this.venue.dispose();
      this.venue = R3D.Venue.build(this.scene, { quality: q });
      const race = this.race; if (race) this.venue.setRace({ dist: race.dist, surface: race.surface, weather: race.weather });
      if (THEME && this.venue.setTheme) this.venue.setTheme(THEME);
      const g = this.gateState; this.gateState = ''; this.setGate(g || 'closed'); this.boardText = null; this.rearKey = null;
      this.forwardCues();
      const d = this.director; this.makeDirectorOcc(d);
    } catch (e) { warnOnce('会場の作り直し', e); }
  };
  /* ---------- テロップと画面の仕上げ（2D 版の drawHud / drawPost をそのまま。背景は透明） ---------- */
  const badge = Race2D.badge, roundRect = Race2D.roundRect;
  // テロップの文字: みんなでダービー風に、丸くて太いゴシック＋黒い太い縁取り
  const TV_FONT = '"Hiragino Maru Gothic ProN","Hiragino Sans","Arial Rounded MT Bold","Helvetica Neue",Arial,sans-serif';
  function tvText(c, txt, x, y, size, col, align, weight) {
    c.font = (weight || 'bold') + ' ' + Math.round(size) + 'px ' + TV_FONT; c.textAlign = align || 'left'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = Math.max(3, size * 0.26); c.strokeStyle = 'rgba(0,0,0,.75)'; c.strokeText(txt, x, y); c.fillStyle = col || '#fff'; c.fillText(txt, x, y);
  }
  const fmtClock = (t, tenth) => { if (tenth) t = Math.round(t * 10) / 10; const m = Math.floor(t / 60), s = t - m * 60; return tenth ? (m ? m + '.' + (s < 10 ? '0' : '') : '') + s.toFixed(1) : (m ? m + '.' + (s < 10 ? '0' : '') : '') + Math.floor(s); };
  // 世界の点 → テロップの座標（x, y と、その奥行きでの 1m あたりの px = s）。後ろなら null
  Race3D.prototype.project = function (x, y, z) {
    const c = this.camera; _v.set(x, y, z).applyMatrix4(c.matrixWorldInverse); const depth = -_v.z; if (depth <= 0.3) return null;
    _v.applyMatrix4(c.projectionMatrix);
    return { x: (_v.x + 1) * W / 2, y: (1 - _v.y) * H / 2, s: (H / 2) / Math.tan(c.fov / 2 / DEG) / depth };
  };
  Race3D.prototype.drawOverlay = function (c) {
    c.clearRect(0, 0, W, H);
    const race = this.race, pad = this.inPaddock();
    // ゼッケンの丸（パドックは大きく映ったとき、レース中は 1m が 9px より大きいとき）
    if (!this.gateShot) {
      for (let i = 0; i < race.horses.length; i++) {
        const p = pad ? this.paddockPos(i) : this.horsePos(i), s = this.project(p.x, 0, p.z); if (!s || s.x < -40 || s.x > W + 40) continue;
        // 本物の馬の部品（足元の輪・ゼッケンつき）のときは、輪が読めないくらい小さく映るときだけ丸を出す。大きく映るときは輪とゼッケンで分かる
        const ringed = this.parts.Horse === 'real', hh = (this.horses3d[i] && this.horses3d[i].size && this.horses3d[i].size.height) || 2.05;
        if (pad) { if (!ringed && s.s > 6) badge(c, s.x, s.y - 2.7 * s.s, Math.max(8, Math.min(14, s.s * 0.45)), race.horses[i]); }
        else if (ringed ? s.s > 2.5 && s.s < 14 : s.s > 9) badge(c, s.x, s.y - hh * s.s - 12, Math.max(8, Math.min(13, s.s * 0.5 + 4)), race.horses[i]);
      }
    }
    // 残線の距離の文字
    if (this.run && this.phase !== 'winner' && !pad) {
      const remain = (1 - Math.min(1, this.run.pos[this.leaderIdx()])) * race.dist;
      for (const m of [400, 200, 100]) {
        if (remain < m - 8 || remain > m + 260) continue;
        const q = pointAt(FINISH_S - m, RO - 1.5), s = this.project(q.x, 0, q.z); if (!s || s.x < 0 || s.x > W) continue;
        const fs = Math.max(11, Math.min(26, s.s * 1.6)); tvText(c, m + 'm', s.x, s.y - fs * 0.7, fs, '#ffffff', 'center');
      }
    }
    // 雨（光と空の部品が代わりのときだけ。本物の部品は自分で雨を降らせる）
    if (race.weather === 'rain' && this.parts.Look !== 'real') { c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.5; const r0 = (this.t * 900) % 40; c.beginPath(); for (let k = 0; k < 90; k++) { const x = (k * 97 + 13) % W, y = (k * 53 + r0 * (1 + k % 3)) % H; c.moveTo(x, y); c.lineTo(x - 3, y + 14); } c.stroke(); }
    // 集中線（2026-10-16 オーナー「残り100mから徐々に集中線増やす」）: 先頭の残り 100m で 0 → ゴールで最大（なめらかに増える）→ 1 着の 0.6 秒後に消える。
    // 先頭 2 頭の頭のあたりへ向かう線を画面の縁だけに（真ん中は空けて馬と番号を見せる）。ちらつきはレースの時計（run.t）で決める＝スローでゆっくり・どの店も同じ
    if (this.run && this.phase === 'run' && !this.gateShot) {
      const run = this.run, rem = (1 - Math.min(1, run.pos[this.leaderIdx()])) * race.dist, f1 = run.finish.filter((x) => x > 0);
      const u = clamp((100 - rem) / 100, 0, 1), ramp = u * u * (3 - 2 * u), after = f1.length ? run.t - Math.min.apply(null, f1) : -1;
      const k = f1.length ? Math.max(0, 1 - after / 0.6) : ramp;
      if (k > 0.01) {
        const top = race.horses.map((_, i) => i).sort((a, b) => run.pos[b] - run.pos[a]).slice(0, 2); let fx = 0, fy = 0, m = 0;
        for (const i of top) { const p = this.horsePos(i), hz = this.horses3d[i], hh = (hz && hz.size && hz.size.height) || 2.45, q = this.project(p.x, hh * 0.8, p.z); if (q) { fx += q.x; fy += q.y; m++; } }
        this.speedLines(c, k, m ? clamp(fx / m, W * 0.3, W * 0.7) : W / 2, m ? clamp(fy / m, H * 0.3, H * 0.7) : H / 2, Math.floor(run.t * 18));
      }
    }
    this.drawPost(c);
    this.drawHud(c);
    this.avoidTelop();
  };
  /* 実況テロップ（#announce。映像の下寄り x247〜753・y368〜413）が先頭 2 頭に重なるときは上へ逃がす（.hi。0.9 秒は戻さない） */
  Race3D.prototype.avoidTelop = function () {
    const el = this.annEl || (this.annEl = document.getElementById('announce')); if (!el) return;
    let hit = false; const run = this.run;
    if (run && this.phase === 'run' && !this.gateShot) {
      const top = this.race.horses.map((_, i) => i).sort((a, b) => run.pos[b] - run.pos[a]).slice(0, 2);
      for (const i of top) {
        const p = this.horsePos(i), hz = this.horses3d[i], hh = (hz && hz.size && hz.size.height) || 2.45, a = this.project(p.x, 0, p.z), b = this.project(p.x, hh, p.z); if (!a || !b) continue;
        const half = Math.max(24, (a.y - b.y) * 0.75);
        if (a.x + half > 236 && a.x - half < 764 && a.y + 6 > 362 && b.y < 420) { hit = true; break; }
      }
    }
    const now = performance.now(); if (hit) this.telopHiAt = now;
    const want = hit || (!!run && this.phase === 'run' && this.telopHiAt > 0 && now - this.telopHiAt < 900);
    if (want !== !!this.telopHi) { this.telopHi = want; el.classList.toggle('hi', want); }
  };
  /* 集中線を 1 回の塗りで描く（細い三角 最大 72 本）。k: 強さ 0..1（本数・長さ・濃さ）、(cx, cy): 線が向かう点、tick: ちらつきの番号（レースの時計から）。
     線の場所 j ごとに出る強さの順番を決めておき（hash(j)）、k が増えると本数が増える。ちらつきは tick ごとに角度・長さ・間引きを少し変える */
  const SL_N = 72, slHash = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  Race3D.prototype.speedLines = function (c, k, cx, cy, tick) {
    if (cx == null) { cx = W / 2; cy = H / 2; } tick = tick | 0;
    c.save(); c.fillStyle = 'rgba(255,255,255,' + (0.35 * (0.35 + 0.65 * k)).toFixed(3) + ')'; c.beginPath();
    const cov = 0.38 * (0.45 + 0.55 * k);   // 縁から中心へ、線が届く長さ（その向きの縁までの距離の割合。最大 38%）
    for (let j = 0; j < SL_N; j++) {
      if (slHash(j * 7 + 3) > k) continue;                              // まだ出ない線
      const h1 = slHash(tick * 131 + j * 17 + 1), h2 = slHash(tick * 197 + j * 29 + 5), h3 = slHash(tick * 61 + j * 43 + 9);
      if (h3 < 0.14) continue;                                           // ちらつき: ときどき消える
      const a = (j + slHash(j * 13 + 1) * 0.6) / SL_N * Math.PI * 2 + (h1 - 0.5) * 0.05, ca = Math.cos(a), sa = Math.sin(a);
      const re = Math.min(ca > 0 ? (W - cx) / ca : ca < 0 ? -cx / ca : 1e9, sa > 0 ? (H - cy) / sa : sa < 0 ? -cy / sa : 1e9);   // この向きの画面の縁まで
      const R = re + 12, r0 = re * (1 - cov * (0.55 + 0.45 * h2)), w = (0.0035 + 0.0055 * slHash(j * 5 + 2)) * (0.8 + 0.4 * h1) * Math.min(2.2, 420 / R);
      c.moveTo(cx + Math.cos(a - w) * R, cy + Math.sin(a - w) * R); c.lineTo(cx + ca * r0, cy + sa * r0); c.lineTo(cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R);
    }
    c.fill(); c.restore();
  };
  Race3D.prototype.drawPost = function (c) {
    // 光と空の部品が仕上げ（周辺減光・粒子）を入れているときは、ここでは場面の切り替えの白いフラッシュだけ
    const lk = this.look, lookPost = this.parts.Look === 'real' && lk && lk.post && lk.quality !== 'low';
    if (lookPost) { if (this.cut > 0) { c.fillStyle = 'rgba(255,255,255,' + Math.min(1, this.cut * 1.6).toFixed(2) + ')'; c.fillRect(0, 0, W, H); } return; }
    if (!this.grain) { const g = document.createElement('canvas'); g.width = g.height = 128; const gc = g.getContext('2d'), id = gc.createImageData(128, 128); for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 10; } gc.putImageData(id, 0, 0); this.grain = c.createPattern(g, 'repeat'); }
    if (!this.lite) { c.fillStyle = this.grain; c.fillRect(0, 0, W, H); }
    if (!this.vig) { this.vig = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62); this.vig.addColorStop(0, 'rgba(0,0,0,0)'); this.vig.addColorStop(1, 'rgba(0,0,0,.2)'); }
    c.fillStyle = this.vig; c.fillRect(0, 0, W, H);
    if (this.cut > 0) { c.fillStyle = 'rgba(255,255,255,' + Math.min(1, this.cut * 1.6).toFixed(2) + ')'; c.fillRect(0, 0, W, H); }
  };
  Race3D.prototype.drawHud = function (c) {
    const race = this.race, run = this.run;
    if (this.phase === 'idle' && this.info && !this.gateShot) {
      const i = this.paddockIdx(), h = race.horses[i], inf = this.info(i) || {};
      const MARU = '"Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif';
      c.fillStyle = 'rgba(0,0,0,.6)'; roundRect(c, 20, H - 144, 520, 124, 8); c.fill();
      c.fillStyle = h.color; roundRect(c, 20, H - 144, 80, 124, 8); c.fill();
      c.fillStyle = h.ink; c.font = 'bold 54px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(h.no), 60, H - 82);
      c.fillStyle = '#fff'; c.textAlign = 'left'; c.font = 'bold 34px ' + MARU; c.fillText(h.name, 116, H - 114);
      c.font = '22px ' + MARU; c.fillStyle = '#ffd54f'; c.fillText(inf.line1 || '', 116, H - 74);
      c.fillStyle = '#ddd'; c.fillText(inf.line2 || '', 116, H - 42);
      c.fillStyle = 'rgba(0,0,0,.55)'; roundRect(c, W - 236, 12, 222, 40, 6); c.fill(); c.fillStyle = '#fff'; c.font = 'bold 20px ' + MARU; c.textAlign = 'center'; c.fillText((this.inPaddock() ? 'パドック  ' : 'まもなく発走  ') + (i + 1) + ' / ' + race.horses.length, W - 125, 32);
      return;
    }
    if (!this.band) { this.band = c.createLinearGradient(0, H - 92, 0, H); this.band.addColorStop(0, 'rgba(0,0,0,0)'); this.band.addColorStop(1, 'rgba(0,0,0,.42)'); }
    c.fillStyle = this.band; c.fillRect(0, H - 92, W, 92);
    const dom = !!this.onPhase; // game.js が REPLAY・PHOTO FINISH・勝ち馬のカードを画面の部品で出す（講評 r2 の 2・7）。そのときはここでは描かない
    if (this.label && !dom) { c.font = 'bold 20px sans-serif'; const w = c.measureText(this.label).width + 30; c.fillStyle = this.label === 'REPLAY' || this.label === 'PHOTO FINISH' ? 'rgba(220,40,40,.85)' : 'rgba(0,0,0,.6)'; roundRect(c, 14, 12, w, 34, 8); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(this.label, 14 + w / 2, 29); }
    const bugH = 40, bug = hudLogo(bugH * (this.k || 1));
    if (bug) { const bugW = bugH * bug.width / bug.height, a0 = c.globalAlpha; c.globalAlpha = a0 * 0.9; c.drawImage(bug, 12, H - 34 - bugH, bugW, bugH); c.globalAlpha = a0; }
    else { c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.arc(28, H - 40, 9, 0.6, 5.7); c.stroke(); c.fillStyle = '#ffd54f'; c.beginPath(); c.arc(28, H - 40, 3.2, 0, 6.283); c.fill();
      tvText(c, 'casa DERBY', 44, H - 40, 17, '#fff', 'left'); }
    // 先頭の残り約 70m（ゴールの約 4 秒前）からゴール後まで: 本物の中継と同じく、下の通過順の帯・コース図・速さを 0.8 秒で消し、局のロゴ・レース名と時計だけにする（ref/STRAIGHT_STUDY.md 2-3）
    const final = !!run && this.phase === 'run' && dom && ((1 - Math.min(1, Math.max.apply(null, run.pos))) * race.dist < 70 || run.finish.some((x) => x > 0));
    const nowMs = performance.now(); if (final) { if (!this.finalAt) this.finalAt = nowMs; } else if (this.phase === 'run') this.finalAt = 0;
    const fa = final ? Math.max(0, 1 - (nowMs - this.finalAt) / 800) : 1;
    tvText(c, 'casa競馬場  ' + (race.surface === 'dirt' ? 'ダート' : '芝') + race.dist + 'm  ' + { sunny: '晴', cloudy: '曇', rain: '雨' }[race.weather], 18, H - 17, 14, '#eeeeee', 'left');
    // 再生・勝ち馬のアップ: 止まった勝ちタイムの時計だけ（ref/STRAIGHT_STUDY.md 2-4）。接戦の 2 回目の再生で止めている間はゴールの縦の線と着差
    if (run && dom && (this.phase === 'replay' || this.phase === 'winner')) { const f1 = run.finish.filter((x) => x > 0); if (f1.length) this.clockBox(c, Math.min.apply(null, f1), true, []); if (this.phase === 'replay' && this.photoHold > 0) this.photoLine(c); }
    if (!run || this.phase === 'winner' || this.phase === 'replay') return;
    const fin = run.finish.filter((x) => x > 0), done = fin.length > 0;
    const L_ = this.leaderIdx(), remain = Math.max(0, Math.round((1 - Math.min(1, run.pos[L_])) * race.dist / 10) * 10);
    // 右上: 中継の時計（「TIME 0:18.3」。1 着がゴールしたら勝ちタイムで止めて金色）。下に 1000m 通過・残り距離・スローの札を重ねる
    this.clockBox(c, done ? Math.min.apply(null, fin) : run.t, done, [
      race.dist > 1000 && this.split1000 && run.t - (this.split1000At || 0) < 10 ? ['1000m', this.split1000, '#ffe14a'] : null,
      !final && this.t600 != null && run.t - this.t600 < 3 ? ['残り600m', fmtRace(this.t600), '#ffe14a'] : null,   // 残り 600m の通過タイムを 3 秒
      !final && remain <= 400 && remain > 0 ? ['残り', remain + 'm', '#ffffff'] : null,
      dom && this.slow < 0.7 ? ['SLOW', 'MOTION', '#ff7a6b'] : null,
    ]);
    const order = race.horses.map((_, i) => i).sort((p, q) => run.pos[q] - run.pos[p]);
    /* ordBig（v2 の店内モニターだけ。2026-10-20 オーナー「画面中央にもっと大きく。横だけずらせばいい」）: 通過順の丸を 1.8 倍にして、横だけ画面のまん中に置く（縦の位置は同じ）。
       幅は左下のロゴ・コース名（〜x250）と右下のコース図・距離（x814〜）に重ならないよう、丸の中心どうしで 380 まで（矢印と丸の半分を足しても x270〜730 に入る） */
    const OB = this.ordBig ? 1.8 : 1, cap = this.ordBig ? 380 : 420, nn = order.length - 1;
    const ex = [0]; for (let k = 1; k < order.length; k++) ex.push(ex[k - 1] + Math.min(40, Math.max(0, (run.pos[order[k - 1]] - run.pos[order[k]]) * race.dist) * 4) * OB);
    const stp = nn > 0 ? Math.min(25 * OB, cap / nn) : 0;
    const esc = Math.min(1, Math.max(0, cap - stp * nn) / (ex[ex.length - 1] || 1));
    const x0 = this.ordBig ? W / 2 - (stp * nn + (ex[ex.length - 1] || 0) * esc) / 2 : 240;
    // 本物の中継と同じく、画面の中で馬が走っている向きに先頭を置く（右へ走る画なら先頭が右端・矢印も右向き）。
    // 先頭の進む向きをカメラの右方向に投影して決める。カットが変わったらすぐ、同じカメラの中でははっきり傾いたときだけ切り替える（正面・真後ろでちらつかない）
    const lh = this.horsePos(L_); _r.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const along = lh.hx * _r.x + lh.hz * _r.z, key = this.cutNo || 0;
    if (this.ordDir == null || key !== this.ordMode) { this.ordDir = along >= 0 ? 1 : -1; this.ordMode = key; }
    else if (Math.abs(along) > 0.3) this.ordDir = along > 0 ? 1 : -1;
    if (fa <= 0) return; // 通過順の帯・コース図・速さは消えた（向き ordDir は上で更新しておく）
    // 通過順の帯は発走から約 11 秒（残り 810m 前後）で 0.5 秒かけて出す。残り 800m のハロン棒で「800m」の縦の札を 1.5 秒（ref/START_STUDY.md 3-3）
    const sa = dom ? clamp((run.t - 11) / 0.5, 0, 1) : 1;
    if (dom && race.dist > 800) { const r8 = (1 - Math.min(1, run.pos[L_])) * race.dist; if (r8 <= 800 && this.t800 == null) this.t800 = run.t; if (r8 > 800) this.t800 = null; }
    if (dom && !this.no800 && this.t800 != null && run.t - this.t800 < 1.5 && run.t >= this.t800) { /* no800: v2 の店内モニターは出さない（2026-10-20 オーナー） */ c.globalAlpha = fa; c.fillStyle = 'rgba(20,36,54,.86)'; roundRect(c, 212, H - 118, 26, 76, 4); c.fill(); c.fillStyle = '#f2b705'; c.fillRect(212, H - 118, 26, 3); c.fillStyle = '#fff'; c.font = 'bold 15px ' + CLK_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; ['8', '0', '0', 'm'].forEach((ch, j) => c.fillText(ch, 225, H - 104 + j * 16)); }
    c.globalAlpha = fa * sa;
    const span = stp * nn + (ex[ex.length - 1] || 0) * esc, toR = this.ordDir > 0;
    const chipX = (k) => (toR ? x0 + span - (k * stp + ex[k] * esc) : x0 + k * stp + ex[k] * esc);
    c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath();
    if (toR) { const ax = chipX(0) + 21 * OB; c.moveTo(ax, H - 31); c.lineTo(ax - 7 * OB, H - 31 - 6 * OB); c.lineTo(ax - 7 * OB, H - 31 + 6 * OB); }
    else { c.moveTo(x0 - 21 * OB, H - 31); c.lineTo(x0 - 14 * OB, H - 31 - 6 * OB); c.lineTo(x0 - 14 * OB, H - 31 + 6 * OB); }
    c.fill();
    for (let k = order.length - 1; k >= 0; k--) badge(c, chipX(k), H - 31, 11.5 * OB, race.horses[order[k]]);
    c.globalAlpha = fa;
    const mx = W - 92, my = H - 40, sx = 0.17;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); for (let k = 0; k <= 60; k++) { const p = pointAt(k * L / 60, RC); k ? c.lineTo(mx + p.x * sx, my + p.z * sx) : c.moveTo(mx + p.x * sx, my + p.z * sx); } c.closePath();
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 7; c.stroke(); c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 3.5; c.stroke();
    const gpt = pointAt(FINISH_S, RC); c.fillStyle = '#ff5252'; c.fillRect(mx + gpt.x * sx - 1.5, my + gpt.z * sx - 7, 3, 14);
    const lp = this.horsePos(L_); c.fillStyle = '#ffd54f'; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(mx + lp.x * sx, my + lp.z * sx, 4.5, 0, 6.28); c.fill(); c.stroke();
    const spd = run.speed && run.speed[L_] ? (run.speed[L_] * race.dist / run.length * 3.6) : 0;
    tvText(c, (race.surface === 'dirt' ? 'DIRT ' : 'TURF ') + race.dist.toLocaleString() + 'm', W - 186, H - 13, 14, '#fff', 'left');
    tvText(c, spd.toFixed(1) + 'km/h', W - 16, H - 13, 14, '#fff', 'right');
    if (!dom && remain <= 400 && remain > 0) tvText(c, '残り ' + remain + 'm', W / 2, 30, 24, '#fff', 'center');
    c.globalAlpha = 1;
  };
  // 写真判定の再生で止めている間: 1 着の進路のゴールの位置に縦の線、その横に着差
  /* 写真判定の再生で止めている間（講評 r3 の 2）: ゴールの位置に赤い縦線（画面で約 3px）、上位 2 頭の鼻先のまわりを 2 倍に拡大した小窓（右上の時計の下）、
     「写真判定」と着差。小窓は WebGL の絵をそのまま写す（描いた直後の同じコマなので読める） */
  const _v2 = new THREE.Vector3();
  /* 写真判定の小窓の切り出し（画面の px）: 1 着の進路の決勝線 a と、上位 2 頭それぞれの鼻先 n・切り出す四角 (sx, sy, sw×sh)・線が窓に入るか。
     photoLine（描く）と renderInset（足元の札を隠した絵を先に撮る）が同じものを使う */
  const PH_SW = 74, PH_SH = 40;
  Race3D.prototype.photoCrops = function () {
    const run = this.run; if (!run) return null; const ord = run.order(), w = ord[0], lr = this.lane ? this.lane[w] : laneR(w), q = pointAt(FINISH_S, lr), a = this.project(q.x, 0, q.z); if (!a) return null;
    // 上位 2 頭の鼻先（画面の点）: 馬の部品の頭の位置から少し前（無ければ体の大きさから）
    const nose = (i) => { const hz = this.horses3d[i]; try { if (hz && hz.getNosePosition) { hz.object3d.updateMatrixWorld(true); hz.getNosePosition(_v2); return this.project(_v2.x, _v2.y, _v2.z); } if (hz && hz.getHeadPosition) { hz.object3d.updateMatrixWorld(true); hz.getHeadPosition(_v2); const o = hz.object3d, yw = o.rotation.y; return this.project(_v2.x + Math.cos(yw) * 0.25, _v2.y - 0.1, _v2.z - Math.sin(yw) * 0.25); } } catch (e) { }
      const d = this.hdim && this.hdim[i], hh = (hz && hz.size && hz.size.height) || 2.45, p = pointAt(this.horseS(i) + ((d && d.f) || 1.3), this.lane ? this.lane[i] : laneR(i)); return this.project(p.x, hh * 0.62, p.z); };
    const sw = PH_SW, sh = PH_SH, items = [];
    [w, ord[1]].forEach((i, r) => {
      if (i == null) return; const n = nose(i); if (!n) return;
      const both = Math.abs(n.x - a.x) <= sw * 0.7, cx = both ? (n.x + a.x) / 2 : n.x;
      const sx = clamp(cx - sw / 2, 0, W - sw), sy = clamp(n.y - sh / 2, 0, H - sh), lineIn = a.x >= sx + 2 && a.x <= sx + sw - 2;
      items.push({ i, r, n, sx, sy, lineIn });
    });
    return { a, w, ord, items };
  };
  /* 写真判定の小窓の元の絵: 足元の輪・馬番の札・土煙を隠して 1 回描き、上位 2 頭の鼻先のまわりだけ小さなキャンバスに写して元に戻す（2026-10-14: 2 着の窓が
     ほかの馬の大きな「3」の札で隠れた）。写真判定で止めている間だけ（1 コマに描く回数が 1 回増える） */
  Race3D.prototype.renderInset = function () {
    this.inset = null;
    const pc = this.photoCrops(); if (!pc || !pc.items.length) return;
    const hide = [], off = (o) => { if (o && o.visible) { o.visible = false; hide.push(o); } };
    this.horses3d.forEach((hz) => { const o = hz && hz.object3d; if (!o) return; off(o.getObjectByName('ring')); off(o.getObjectByName('ringBadges')); });
    off(this.scene.getObjectByName('horseDust'));
    try {
      try { this.look.render(this.renderer, this.scene, this.camera); } catch (e) { this.renderer.render(this.scene, this.camera); }
      const k = this.k || 1, cw = Math.max(1, Math.round(PH_SW * k)), ch = Math.max(1, Math.round(PH_SH * k));
      const cv = this.insetCv || (this.insetCv = document.createElement('canvas')); if (cv.width !== cw || cv.height !== ch * 2) { cv.width = cw; cv.height = ch * 2; }
      const g = cv.getContext('2d'); g.clearRect(0, 0, cw, ch * 2);
      pc.items.forEach((it) => g.drawImage(this.glcv, it.sx * k, it.sy * k, PH_SW * k, PH_SH * k, 0, it.r * ch, cw, ch));
      this.inset = { cv, ch, crops: pc };
    } finally { hide.forEach((o) => { o.visible = true; }); }
  };
  Race3D.prototype.photoLine = function (c) {
    const pc = (this.inset && this.inset.crops) || this.photoCrops(); if (!pc) return; const run = this.run, w = pc.w, ord = pc.ord, a = pc.a;
    const RED = '#ff2b2b';
    c.save(); c.strokeStyle = RED; c.lineWidth = 2; c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 3; c.beginPath(); c.moveTo(a.x, 0); c.lineTo(a.x, H); c.stroke(); c.restore();
    const k = this.k || 1, sw = PH_SW, sh = PH_SH, iw = sw * 2.6, ih = sh * 2.6, ix = W - 14 - iw;
    c.fillStyle = 'rgba(20,36,54,.92)'; roundRect(c, ix - 4, 62, iw + 8, 30 + (ih + 28) * 2, 5); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = 'bold 17px ' + CLK_JP; c.fillText('写真判定', ix + 4, 77);
    c.textAlign = 'right'; c.fillStyle = '#ffd54f'; c.fillText('着差 ' + (this.photoMargin || 'ハナ'), ix + iw - 4, 77);
    pc.items.forEach((it) => {
      // 切り出しはその馬の鼻先のまわり（2 着が 0.7m 以上離れると、決勝線の所を切っても芝と線しか映らなかった）。
      // 鼻先と決勝線が 1 枚に入るなら両方が入るように間を、入らなければ鼻先を真ん中にして、線の代わりに「差 0.7m（アタマ）」の札
      const i = it.i, r = it.r, sx = it.sx, sy = it.sy, lineIn = it.lineIn, iy = 92 + r * (ih + 28) + 22, h = this.race.horses[i];
      badge(c, ix + 12, iy - 12, 9, h); c.fillStyle = '#fff'; c.textAlign = 'left'; c.font = 'bold 15px ' + CLK_JP; c.fillText((r + 1) + '着  ' + h.name, ix + 26, iy - 12);
      try {
        c.save(); c.beginPath(); c.rect(ix, iy, iw, ih); c.clip(); c.imageSmoothingEnabled = true;
        const ins = this.inset; // 足元の札を隠して撮った絵（renderInset）。無ければいまの画面から
        if (ins && ins.crops === pc) c.drawImage(ins.cv, 0, r * ins.ch, ins.cv.width, ins.ch, ix, iy, iw, ih); else c.drawImage(this.glcv, sx * k, sy * k, sw * k, sh * k, ix, iy, iw, ih);
        if (lineIn) { const lx = ix + (a.x - sx) * (iw / sw); c.strokeStyle = RED; c.lineWidth = 2; c.beginPath(); c.moveTo(lx, iy); c.lineTo(lx, iy + ih); c.stroke(); }
        else if (r > 0) { // 決勝線が窓の外: 1 着との差を札で
          const gm = Math.max(0, (run.pos[w] - run.pos[i]) * this.race.dist), txt = '差 ' + gm.toFixed(1) + 'm（' + (this.photoMargin || 'ハナ') + '）';
          c.font = 'bold 13px ' + CLK_JP; const tw = c.measureText(txt).width + 14; c.fillStyle = 'rgba(20,36,54,.88)'; roundRect(c, ix + 6, iy + ih - 26, tw, 20, 4); c.fill();
          c.fillStyle = '#ffd54f'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(txt, ix + 13, iy + ih - 16);
        }
        c.restore();
      } catch (e) { c.restore(); }
      c.strokeStyle = '#f2b705'; c.lineWidth = 1.5; c.strokeRect(ix, iy, iw, ih);
      c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 1; c.strokeRect(sx, sy, sw, sh);   // 拡大している所
    });
  };
  // 右上の時計の札（紺 #142436・左に黄色の線）。rows: [見出し, 値, 値の色]（null は飛ばす）
  const CLK_FONT = '"Avenir Next Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif', CLK_JP = '"Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif';
  const fmtRace = (t, tenth) => { t = Math.max(0, tenth ? Math.round(t * 10) / 10 : Math.floor(t * 10) / 10); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
  Race3D.prototype.clockBox = function (c, t, done, rows) {
    const bw = 176, bx = W - 14 - bw; let y = 10;
    const panel = (h) => { c.fillStyle = 'rgba(20,36,54,.86)'; roundRect(c, bx, y, bw, h, 4); c.fill(); c.fillStyle = '#f2b705'; c.fillRect(bx, y, 4, h); };
    panel(40);
    c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = 'bold 12px ' + CLK_FONT; c.fillStyle = '#9fb3d9'; c.fillText('T I M E', bx + 14, y + 21);
    c.textAlign = 'right'; c.font = 'bold 28px ' + CLK_FONT; c.fillStyle = done ? '#ffd54f' : '#ffffff'; c.fillText(fmtRace(t, done), bx + bw - 12, y + 21.5);
    y += 44;
    rows.forEach((r) => {
      if (!r) return; panel(28);
      if (r[0] === 'SLOW') { c.fillStyle = '#e84141'; c.beginPath(); c.arc(bx + 17, y + 14, 4.5, 0, 6.283); c.fill(); c.textAlign = 'left'; c.font = 'bold 13px ' + CLK_FONT; c.fillStyle = '#fff'; c.fillText('S L O W   M O T I O N', bx + 30, y + 14.5); }
      else { c.textAlign = 'left'; c.font = 'bold 13px ' + CLK_JP; c.fillStyle = '#9fb3d9'; c.fillText(r[0], bx + 14, y + 14.5); c.textAlign = 'right'; c.font = 'bold 20px ' + CLK_FONT; c.fillStyle = r[2]; c.fillText(r[1], bx + bw - 12, y + 15); }
      y += 32;
    });
  };

  // 2D 版の静的な道具（出馬表・展開予想・ボーナス牧場が使う）
  Race3D.drawChibi = Race2D.drawChibi; Race3D.drawTenkai = Race2D.drawTenkai; Race3D.badge = Race2D.badge; Race3D.roundRect = Race2D.roundRect; Race3D.COATS = Race2D.COATS;
  Race3D.Race2D = Race2D;
  // WebGL が使えるか（three.js が読めて、WebGL のコンテキストが作れる）
  Race3D.supported = function () {
    try { if (!window.THREE || !window.R3D || !R3D.Course) return false; const cv = document.createElement('canvas'); return !!(cv.getContext('webgl2') || cv.getContext('webgl') || cv.getContext('experimental-webgl')); } catch (e) { return false; }
  };
  return Race3D;
})();
/* 差し替え: WebGL が使えるときだけ window.Race を 3D 版に（?r2d=1 で 2D のまま）。
   new Race(canvas) で 3D の準備に失敗したら、その場で 2D の Race を返す（ゲームは止めない）。 */
(function () {
  const R2 = window.Race, R3 = window.Race3D;
  if (!R3 || /[?&]r2d=1/.test(location.search) || !R3.supported()) { console.info('casa DERBY: 2D のレース映像を使います'); return; }
  function Race(canvas) {
    try { return new R3(canvas); }
    catch (e) { console.warn('casa DERBY 3D: 準備に失敗したので 2D に戻します', e); const gl = canvas.parentNode && canvas.parentNode.querySelector('canvas.race3d'); if (gl) gl.remove(); return new R2(canvas); }
  }
  Race.drawChibi = R2.drawChibi; Race.drawTenkai = R2.drawTenkai; Race.badge = R2.badge; Race.roundRect = R2.roundRect; Race.COATS = R2.COATS; Race.Race2D = R2; Race.Race3D = R3;
  window.Race = Race;
})();
