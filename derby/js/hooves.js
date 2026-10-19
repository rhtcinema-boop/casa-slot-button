/* 蹄の音（オーナー指示「走ってる時ずっと馬の足音が鳴ってる方がいい」）
   レース映像（DERBY.raceView）を毎コマ見て、6 頭それぞれの脚の運びに合わせて「ドドドッ」を鳴らし続ける。
   - 襲歩（全力）は 4 拍＋宙に浮く間。1 完歩の回数は速さで決まる（秒速 17m で毎秒約 2.4 完歩）。
   - 速さはエンジンの速さ（spd, m/秒）、テンポは画面での実際の動きから出すので、スロー・リプレイ・早送りでも自然に合う。
   - 芝は低く鈍い「ドッ」、ダートは砂を噛む「ザッ」を混ぜる。カメラから遠い馬は小さく、画面の左右で左右に振る。
   - 歩き（ゲートイン・パドック・ゴール後）は軽い 4 拍の「パカパカ」。
   - 消音（音ボタン・?mute=1）や ?hooves=0 では鳴らさない。?hoofdebug=1 は音を出さずに打った記録だけ取る（テスト用）。 */
window.Hooves = (function () {
  'use strict';
  const OFF = /[?&]hooves=0/.test(location.search), DEBUG = /[?&]hoofdebug=1/.test(location.search);
  let ctx = null, bus = null, bufs = null, raf = 0, real = null, realTried = false;
  /* 本物の録音（効果音ラボ「馬が走る（土の上）」「馬が歩く（土の上）」。商用無料・クレジット不要・ファイルの再配布は禁止）を
     1 歩ずつ切り出して使う（切り出し位置は art/sfx/sfx.json）。読めないときは下の合成の音で鳴らす */
  function loadReal(c) {
    if (realTried) return; realTried = true;
    const peakOf = (b) => { let m = 0; for (let ch = 0; ch < b.numberOfChannels; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < d.length; i += 4) m = Math.max(m, Math.abs(d[i])); } return m || 1; };
    fetch('art/sfx/sfx.json').then((r) => r.json()).then((j) => Promise.all([j.dash.file, j.walk.file].map((f) => fetch(f).then((r) => r.arrayBuffer()).then((ab) => new Promise((ok, ng) => c.decodeAudioData(ab, ok, ng))))).then(([dash, walk]) => {
      real = { dash, walk, dashG: j.dash.grains, walkG: j.walk.grains, dashPk: peakOf(dash), walkPk: peakOf(walk) };
    })).catch((e) => { console.info('casa DERBY: 蹄の録音を読めないので合成の音を使います', e && e.message); });
  }
  const S = [], log = [], stats = { hits: 0 };
  function muted() { return /[?&]mute=1/.test(location.search) || (window.Sfx && Sfx.isMuted && Sfx.isMuted()); }
  // 2026-10-19「レース中以外は音を出さない」: テレビがレースの場面でないとき（js/audio.js の scene が閉まっている）は打たない（?hoofdebug=1 の記録にも残さない）
  function offScene() { return !!(window.Sfx && Sfx.sceneOn && !Sfx.sceneOn()); }
  function setup() {
    if (bus) return true;
    ctx = window.Sfx && Sfx.ctx && Sfx.ctx(); if (!ctx) return false;
    bus = ctx.createGain(); bus.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    bus.connect(comp); comp.connect((Sfx.softIn && Sfx.softIn()) || ctx.destination); // 2026-10-19: こもった柔らかい音の通り道（js/audio.js）を通す
    bufs = makeBufs(ctx); loadReal(ctx);
    return true;
  }
  /* 音の素材（すべて合成。録音の素材は使わない＝オーナー指示）
     蹄 1 回 = ①地面を打つ低い衝撃（60〜110Hz、音程がすぐ下がる＋2 倍音）②土・芝が弾ける短い雑音（芝はこもった 700Hz 以下、
     ダートは明るい 2.5kHz）③ダートは砂粒が散る細かいパチパチ、芝は葉がこすれる高い「サッ」。芝・ダートそれぞれ 10 種類。
     息 = 全力の馬の荒い吐息「フッ」（300〜1200Hz のこもった雑音）。金具 = 鐙・はみの小さな「チャリ」。 */
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function norm(d, pk) { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= pk / m; }
  function makeHoof(c, dirt) {
    const sr = c.sampleRate, n = Math.floor(sr * 0.24), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    const f0 = rnd(62, 108), k = Math.exp(-2 * Math.PI * (dirt ? 2500 : 650) / sr), kh = Math.exp(-2 * Math.PI * 3500 / sr);
    let ph = 0, ph2 = 0, lp = 0, lpH = 0, prevG = 0, grit = 0;
    const gritRate = dirt ? rnd(1800, 3200) : rnd(250, 500);
    for (let i = 0; i < n; i++) {
      const t = i / sr, f = f0 * (0.55 + 0.45 * Math.exp(-t / 0.016));
      ph += 2 * Math.PI * f / sr; ph2 += 2 * Math.PI * f * 2.31 / sr;
      let x = Math.sin(ph) * Math.exp(-t / 0.045) + 0.28 * Math.sin(ph2) * Math.exp(-t / 0.018);
      const wn = Math.random() * 2 - 1; lp = k * lp + (1 - k) * wn;
      x += lp * (dirt ? 1.6 : 2.4) * Math.exp(-t / (dirt ? 0.02 : 0.026)) * (t < 0.001 ? t / 0.001 : 1);
      if (Math.random() < gritRate * Math.exp(-t / 0.045) / sr) grit += rnd(-1, 1) * (dirt ? 0.55 : 0.25);
      const g = grit; grit *= 0.55; x += g - prevG; prevG = g;                       // 砂粒（高い成分だけ残す）
      if (!dirt) { lpH = kh * lpH + (1 - kh) * wn; x += (wn - lpH) * 0.07 * Math.exp(-t / 0.035); } // 芝の葉の「サッ」
      d[i] = x;
    }
    norm(d, 0.9); return b;
  }
  function makeBreath(c) {
    const sr = c.sampleRate, n = Math.floor(sr * 0.34), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    const k1 = Math.exp(-2 * Math.PI * rnd(380, 520) / sr), k2 = Math.exp(-2 * Math.PI * rnd(1100, 1500) / sr); let a = 0, bb = 0;
    for (let i = 0; i < n; i++) { const t = i / sr, w = Math.random() * 2 - 1; a = k1 * a + (1 - k1) * w; bb = k2 * bb + (1 - k2) * w;
      const env = Math.min(1, t / 0.035) * Math.exp(-Math.max(0, t - 0.035) / 0.09); d[i] = (a * 2.2 + (bb - a) * 0.9) * env; }
    norm(d, 0.8); return b;
  }
  function makeJingle(c) {
    const sr = c.sampleRate, n = Math.floor(sr * 0.08), b = c.createBuffer(1, n, sr), d = b.getChannelData(0), fs = [rnd(3000, 4200), rnd(4800, 6200), rnd(7000, 8200)];
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] = fs.reduce((s, f, j) => s + Math.sin(2 * Math.PI * f * t + j) * Math.exp(-t / (0.02 - j * 0.004)), 0); }
    norm(d, 0.6); return b;
  }
  function makeBufs(c) {
    const turf = [], dirt = [], breath = [], jingle = [];
    for (let i = 0; i < 10; i++) { turf.push(makeHoof(c, false)); dirt.push(makeHoof(c, true)); }
    for (let i = 0; i < 6; i++) breath.push(makeBreath(c));
    for (let i = 0; i < 4; i++) jingle.push(makeJingle(c));
    return { turf, dirt, breath, jingle };
  }
  const pick = (a) => a[(Math.random() * a.length) | 0];
  // kind: 0=蹄 1=息 2=金具。far: 0（近い）〜1（遠い）。遠いほど高い音が空気で削れる
  function hit(at, gain, rate, pan, dirt, kind, far) {
    kind = kind || 0; far = far || 0; stats.hits++;
    if (DEBUG) { if (log.length < 30000) log.push([+at.toFixed(3), +gain.toFixed(3), +rate.toFixed(3), +pan.toFixed(2), dirt ? 1 : 0, kind, +far.toFixed(2)]); return; }
    const s = ctx.createBufferSource(), hoof = kind === 0 || kind === 3;
    let off = 0, dur = 0.4, gk = 1, lpf = 9000 - 7000 * far;
    if (hoof && real) {                                              // 本物の録音の 1 歩
      const walk = kind === 3, gr = pick(walk ? real.walkG : real.dashG);
      s.buffer = walk ? real.walk : real.dash; off = gr.off; dur = gr.dur + 0.03;
      gk = 0.9 / ((walk ? real.walkPk : real.dashPk) * Math.max(0.4, gr.pk)) * (walk ? 0.8 : 1);
      if (!dirt) lpf = Math.min(lpf, 1900);                         // 録音は土の上。芝はこもらせる
      s.playbackRate.value = (0.9 + 0.1 * rate) * (0.96 + Math.random() * 0.08);
    } else {
      s.buffer = kind === 1 ? pick(bufs.breath) : kind === 2 ? pick(bufs.jingle) : pick(dirt ? bufs.dirt : bufs.turf);
      s.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lpf; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain * gk, at); g.gain.setTargetAtTime(0, at + dur - 0.03, 0.01);
    let last = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); last = p; }
    s.connect(f); f.connect(g); last.connect(bus); s.start(at, off); s.stop(at + dur + 0.05);
  }
  const V = window.THREE ? new THREE.Vector3() : null;
  function frame() {
    raf = requestAnimationFrame(frame);
    const rv = window.DERBY && DERBY.raceView;
    if (OFF || !rv || !rv.horses3d || !rv.horses3d.length) return;
    if (offScene() || (!DEBUG && muted())) { S.length = 0; return; }
    if (!DEBUG && !setup()) return;
    if (DEBUG && !ctx) ctx = { currentTime: 0, fake: true }; // テストでは音の時計（消音中は止まっている）ではなく画面の時計で数える
    const now = ctx.fake ? performance.now() / 1000 : ctx.currentTime, wall = performance.now() / 1000;
    const ph = rv.phase, gate = !!rv.gi, live = ph === 'run' || ph === 'replay' || ph === 'winner' || gate || (rv.inPaddock && rv.inPaddock());
    if (!live) { S.length = 0; return; }
    const dirt = rv.race && rv.race.surface === 'dirt', cam = rv.camera;
    for (let i = 0; i < rv.horses3d.length; i++) {
      const hz = rv.horses3d[i], o = hz && hz.object3d; if (!o || !o.visible) { S[i] = null; continue; }
      const st = S[i] || (S[i] = { x: o.position.x, z: o.position.z, t: wall, vw: 0, next: now + Math.random() * 0.3, beat: 0 });
      // 画面での実際の速さ（m/秒、なめらかに）
      const dtw = Math.max(1e-3, wall - st.t), vw0 = Math.hypot(o.position.x - st.x, o.position.z - st.z) / dtw;
      st.vw += (Math.min(40, vw0) - st.vw) * Math.min(1, dtw * 6); st.x = o.position.x; st.z = o.position.z; st.t = wall;
      let vs = (rv.spd && rv.spd[i]) || 0; if (gate && rv.giSpeed) vs = rv.giSpeed(i) || 0; if (!(vs > 0.05)) vs = st.vw;
      if (st.vw < 0.25) { st.next = now + 0.05; continue; }          // 止まっている
      const fac = Math.max(0.15, Math.min(3, st.vw / Math.max(0.5, vs)));  // スロー・リプレイ・早送り
      const run = vs > 5;
      // 1 完歩の長さ（秒、エンジンの時間）と 4 拍の位置
      const T = run ? 1 / (1.55 + 0.05 * vs) : 1 / (0.75 + 0.35 * vs);
      const OFFS = run ? [0, 0.1, 0.24, 0.34] : [0, 0.25, 0.5, 0.75], VOL = run ? [0.75, 0.9, 0.85, 1] : [0.5, 0.45, 0.5, 0.45];
      // 距離と左右
      let gain = run ? 0.16 : 0.07, pan = 0, far = 0.5, near = 0.3;
      if (cam && V) {
        const d = Math.hypot(o.position.x - cam.position.x, o.position.z - cam.position.z); gain *= 0.4 + 0.6 * Math.min(1, 30 / Math.max(1, d));
        far = Math.max(0, Math.min(1, (d - 15) / 120)); near = Math.max(0, Math.min(1, 1 - (d - 8) / 45));
        V.set(o.position.x, 0.5, o.position.z).project(cam); pan = Math.max(-0.8, Math.min(0.8, V.x * 0.8)); if (V.z > 1) gain *= 0.3;
      }
      const rate = (0.82 + 0.18 * Math.min(1, fac)) * (run ? 1 : 1.25);
      if (st.next < now - 0.2) st.next = now;                          // 遅れすぎたら追いつく（まとめ打ちしない）
      while (st.next < now + 0.12) {
        hit(st.next, gain * VOL[st.beat], rate, pan, dirt, run ? 0 : 3, far);
        if (run && st.beat === 0) {                                     // 1 完歩に 1 回の荒い吐息（近いほどはっきり）
          const bt = st.next + 0.55 * T / fac; if (near > 0.05) hit(bt, gain * 0.55 * near, rate * (0.95 + 0.1 * Math.random()), pan, dirt, 1, far);
          if (near > 0.3 && Math.random() < 0.25) hit(st.next + 0.3 * T / fac, gain * 0.18 * near, 1, pan, dirt, 2, far);
        }
        const b = st.beat; st.beat = (st.beat + 1) % 4;
        const gapSim = st.beat === 0 ? (1 - OFFS[3]) * T : (OFFS[st.beat] - OFFS[b]) * T;
        st.next += gapSim / fac * (0.97 + Math.random() * 0.06);
      }
    }
  }
  function start() { if (!raf) raf = requestAnimationFrame(frame); }
  start();
  return { stats, log, makeBufs, get real() { return real; }, get debug() { return DEBUG; } };
})();
