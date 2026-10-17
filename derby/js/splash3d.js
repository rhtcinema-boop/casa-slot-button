/* casa DERBY 起動画面の 3D の馬（three.js r149 と js/r3d/horse3d.js の R3D.Horse を使う）。
   レースと同じアニメ調の馬 6 頭が、芝のコースを横から追うカメラの前で全力で走り続ける（内ラチ・芝の刈り込みの縞・土煙つき）。
   起動画面専用の小さなレンダラー（WebGL）を 1 つ作り、stop() で馬・材質・レンダラーを片付けてコンテキストも手放す。
   使い方: const run = Splash3D.start(箱の要素, 馬のデータの配列, { quality }) → null（WebGL が無い・失敗）なら呼び出し側が 2D の絵を出す。
           run.stop()  run.info（{ fps, frames, horses, calls, tris, k }） */
window.Splash3D = (function () {
  'use strict';
  const W = 1600, H = 480;                 // 箱の大きさ（ステージの座標）
  const V = 15.5;                          // 馬群の速さ（m/秒）
  const CAM = { dist: 23.75, fov: 16, pitch: 6.0, aim: 0.25 }; // 講評 r2 の 8: 馬を 2 割小さく（前は 19m） // カメラ: 馬群からの距離、縦の画角、見下ろし角（度）、狙う高さ（m）。地平線は箱の上から約 60px
  const RAIL_Z = -5.2, POST = 2.5;         // 内ラチの位置と支柱の間隔
  const WRAP = 2000;                       // この距離を走ったら全体を戻す（長時間つけっぱなしでも数字が大きくならないように）

  function supported() {
    try { if (!window.THREE || !window.R3D || !R3D.Horse) return false; const cv = document.createElement('canvas'); return !!(cv.getContext('webgl2') || cv.getContext('webgl')); } catch (e) { return false; }
  }

  // 芝: 進む向きに 8m ごとの刈り込みの縞（明・暗）＋細かい粒。1 枚で 16m
  function turfTexture(low) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const c = cv.getContext('2d');
    c.fillStyle = '#4c9f2c'; c.fillRect(0, 0, 256, 128); c.fillStyle = '#5bb236'; c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < (low ? 900 : 2400); i++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(20,70,0,.10)' : 'rgba(255,255,190,.08)'; c.fillRect(Math.random() * 256, Math.random() * 128, 1, 2); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = low ? 1 : 4;
    return t;
  }

  function start(box, horsesData, opts) {
    opts = opts || {};
    if (!box || !supported() || !horsesData || !horsesData.length) return null;
    const quality = opts.quality === 'low' ? 'low' : 'high', low = quality === 'low';
    let renderer = null, cv = null;
    const owned = [];                      // 自分で作った形・材質・テクスチャ（stop で片付ける）
    const horses = [];
    try {
      cv = document.createElement('canvas'); cv.className = 'sp3d';
      cv.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;display:block';
      renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: !low, alpha: true, powerPreference: 'high-performance', stencil: false });
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
      box.appendChild(cv);
    } catch (e) {
      console.warn('casa DERBY: 起動画面の 3D が作れないので 2D の絵にします', e);
      try { if (renderer) renderer.dispose(); } catch (e2) { }
      if (cv && cv.parentNode) cv.remove();
      return null;
    }
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xb8e2b0, 60, 260);   // 遠くの芝は地平線の色（index.html の遠景と同じ色）へ溶ける
    const camera = new THREE.PerspectiveCamera(CAM.fov, W / H, 0.5, 900);
    scene.add(new THREE.HemisphereLight(0xe6f4ff, 0x5e8a3a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.9); sun.position.set(-30, 60, 45); scene.add(sun); scene.add(sun.target);

    // 地面（カメラについて動く。縞の 1 周期ごとにずらすので模様は地面に張り付いて見える）
    const gtex = turfTexture(low); owned.push(gtex);
    const GW = 600, GD = 600;
    gtex.repeat.set(GW / 16, GD / 16);
    const gGeo = new THREE.PlaneGeometry(GW, GD), gMat = new THREE.MeshLambertMaterial({ map: gtex }); owned.push(gGeo, gMat);
    const ground = new THREE.Mesh(gGeo, gMat); ground.rotation.x = -Math.PI / 2; ground.position.z = -GD / 2 + 40; scene.add(ground);
    // 内ラチ（白い横木＋支柱）。支柱は 1 つの InstancedMesh
    const railMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); owned.push(railMat);
    const barGeo = new THREE.BoxGeometry(160, 0.13, 0.12), postGeo = new THREE.BoxGeometry(0.1, 1.05, 0.1); owned.push(barGeo, postGeo);
    const rail = new THREE.Group(); scene.add(rail);
    const bar = new THREE.Mesh(barGeo, railMat); bar.position.set(0, 1.05, RAIL_Z); rail.add(bar);
    const NP = Math.round(160 / POST), posts = new THREE.InstancedMesh(postGeo, railMat, NP), m4 = new THREE.Matrix4();
    for (let i = 0; i < NP; i++) { m4.makeTranslation(-80 + i * POST, 0.52, RAIL_Z); posts.setMatrixAt(i, m4); }
    rail.add(posts);
    // 内ラチの足元の影（細い帯）
    const rsGeo = new THREE.PlaneGeometry(160, 0.6), rsMat = new THREE.MeshBasicMaterial({ color: 0x2f6a1c, transparent: true, opacity: 0.25, depthWrite: false }); owned.push(rsGeo, rsMat);
    const rs = new THREE.Mesh(rsGeo, rsMat); rs.rotation.x = -Math.PI / 2; rs.position.set(0, 0.02, RAIL_Z + 0.35); rail.add(rs);

    // 馬群: 6 頭を奥行きと前後にずらして並べ、それぞれゆっくり前後に入れ替わる
    const LAY = [[4.6, 0.7], [2.75, -1.5], [0.9, 1.1], [-0.95, -0.9], [-2.8, 1.7], [-4.65, -0.3]]; // 講評 r2 の 8: 前後に 1.85m ずつ・奥行きは交互に 2m 以上ずらす（体が重ならない、まとまった馬群） // [前後 m, 奥行き m（+ がカメラ側）]。奥行きは 1.3m おき＝隣の馬と体が重ならない
    horsesData.slice(0, 6).forEach((h, i) => {
      try {
        const hz = R3D.Horse.create(h, { quality, jockey: true, ring: false, outline: false, dust: false }); // 土煙は止まった地面に残って石のように見えるので出さない
        const L = LAY[i % LAY.length];
        hz.sp = { x0: L[0], z: L[1], a1: 0.35 + 0.2 * ((i * 37) % 7) / 7, w1: 0.27 + 0.05 * i, p1: i * 1.7, a2: 0.35, w2: 0.83 + 0.07 * i, p2: i * 2.3 };
        scene.add(hz.object3d); horses.push(hz);
      } catch (e) { console.warn('casa DERBY: 起動画面の馬を作れませんでした', e); }
    });
    if (!horses.length) { stopNow(); return null; }

    let X = 0, t = 0, raf = 0, last = 0, alive = true, k = 1;
    const info = { fps: 0, frames: 0, horses: horses.length, calls: 0, tris: 0, k: 1 };
    let fpsN = 0, fpsT = 0;
    // 描く解像度: 画面に出る大きさ（ステージの拡縮 × 画素密度）に合わせる。上限 high 1.5 倍 / low 0.8 倍
    function fit() {
      const r = box.getBoundingClientRect(); const s = r.width > 0 ? r.width / W : 1;
      k = Math.max(0.5, Math.min(low ? 0.8 : 1.5, s * (window.devicePixelRatio || 1)));
      renderer.setPixelRatio(1); renderer.setSize(Math.round(W * k), Math.round(H * k), false); info.k = Math.round(k * 100) / 100;
    }
    fit();
    const onResize = () => { if (alive) fit(); };
    window.addEventListener('resize', onResize);

    function place(dt) {
      X += V * dt; t += dt;
      if (X > WRAP) { X -= WRAP; horses.forEach((hz) => { hz.object3d.position.x -= WRAP; }); } // 全体を戻す（馬は瞬間移動を見分けて歩幅を保つ）
      horses.forEach((hz) => {
        const p = hz.sp, x = X + p.x0 + p.a1 * Math.sin(p.w1 * t + p.p1) + p.a2 * Math.sin(p.w2 * t + p.p2);
        hz.object3d.position.set(x, 0, p.z);
        const lead = p.a1 * p.w1 * Math.cos(p.w1 * t + p.p1);   // 前へ出ようとしている馬は追う（体を伸ばす）
        hz.update(dt, { gait: 'gallop', speed: V, lean: 0, whip: lead > 0.15 ? Math.min(1, lead) : 0 });
      });
      const cx = X - 0.7;
      camera.position.set(cx, CAM.aim + CAM.dist * Math.tan(CAM.pitch * Math.PI / 180), CAM.dist);
      camera.lookAt(cx, CAM.aim, 0);
      ground.position.x = Math.round(cx / 16) * 16;
      rail.position.x = Math.round(cx / POST) * POST;
    }
    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60; last = now;
      try { place(dt); renderer.render(scene, camera); }
      catch (e) { console.warn('casa DERBY: 起動画面の 3D を止めます', e); stopNow(); if (opts.onFail) opts.onFail(); return; }
      info.frames++; fpsN++; fpsT += dt; if (fpsT >= 1) { info.fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; info.calls = renderer.info.render.calls; info.tris = renderer.info.render.triangles; }
    }
    // 最初の 1 枚はすぐ描く（読み込み直後に空の箱が見えないように）
    try { for (let i = 0; i < 3; i++) place(1 / 60); renderer.render(scene, camera); } catch (e) { console.warn('casa DERBY: 起動画面の 3D を止めます', e); stopNow(); return null; }
    raf = requestAnimationFrame(frame);

    function stopNow() {
      if (!alive && !renderer) return; alive = false;
      cancelAnimationFrame(raf); window.removeEventListener('resize', onResize);
      horses.forEach((hz) => { try { hz.dispose(); } catch (e) { } }); horses.length = 0;   // 形・材質の共有分（レース用）は残す
      owned.forEach((o) => { try { o.dispose(); } catch (e) { } }); owned.length = 0;
      try { posts.dispose && posts.dispose(); } catch (e) { }
      try { renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) { }
      renderer = null; if (cv && cv.parentNode) cv.remove();
      info.stopped = true;
    }
    return { stop: stopNow, info, get running() { return alive; } };
  }
  return { start, supported };
})();
