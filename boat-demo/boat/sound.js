/* casa BOAT テスト版の音（2026-11-18 作り直し）。調べた本物の音の流れ（ref/boat/research/10 ⑥⑧・24）に合わせる。
   鳴らすもの:
     ・エンジン 6 艇ぶん（艇ごとに別の音。高さは「レバー」で決まる: 係留 118Hz 前後 → 握ると 1 秒で 160 → 速さがつくと 221〜231 → 放すと 70〜100。
       ターンの入口で 15% 下がる。カメラに近づく艇は高く・遠ざかる艇は低く聞こえる（音の速さの計算）。6 艇の高さが少しずつ違うので「うなり」が出る）
     ・水と排気の「ザー」（300〜3,000Hz）、ターンのしぶき（1,500〜6,000Hz）、艇底が水をたたく小さなゆれ（1 秒に 3 回前後。証拠は弱いので浅く）
     ・ピットのブザー 3 回（3 回目で出走）→ ピットアウトと同時にファンファーレ（自作。boat/fanfare-boat.js）→ 終わってから実況
     ・実況の声（art/voice-boat/。boat/announce-boat.js で字幕の文を部品に分けて並べる）。話している間はエンジンを下げ、黙る −4.5〜0 秒はエンジンが主役
     ・ビッグレース（?big=1）だけ: 客席のざわめき（声の −6dB）・歓声・ゴール後の拍手・勝者の短い音楽。ふだんのレースは本物どおり客席の音なし
     ・フライングの告知の前にお知らせのチャイム（本物は 4 場だけ）
   鳴らさないもの（本物に無い）: スタートの合図・大時計の音・ゴールの合図・確定のメロディ・レース中の音楽。
   ?mute=1 のときは何も作らない（テストは無音）。?fan=A|B|C でファンファーレを選ぶ（ふだん A・ビッグレース B）。?buzzer=0 でブザーなし。
   ブラウザは最初の操作（クリック・キー）まで音を出せないので、それまでは無音のまま進む（撮影は --autoplay-policy=no-user-gesture-required）。 */
window.BOAT = window.BOAT || {};
BOAT.Sound = (function () {
  'use strict';
  const QS = new URLSearchParams(location.search);
  const MUTE = QS.get('mute') === '1', BIG = QS.get('big') === '1', FAN = /^[ABC]$/.test(QS.get('fan') || '') ? QS.get('fan') : (BIG ? 'B' : 'A'), BUZ = QS.get('buzzer') !== '0';
  const VOICE_DIR = (() => { try { const me = document.currentScript && document.currentScript.src; return me ? new URL('../art/voice-boat/', me).href : '../art/voice-boat/'; } catch (e) { return '../art/voice-boat/'; } })(); // 2026-11-19: 店のテレビ（ルートの index.html）から読んでも同じ場所（このファイルの場所から数える）
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), db = (x) => Math.pow(10, x / 20);
  // 音量の目安（声の部品は −16dBFS にそろえてある＝ 1.0）。エンジンは「全速で目の前」で声の −10dB、話している間はさらに −9dB（資料 10 8-5: 声のすき間は 20〜40dB 下）
  const LVL = { voice: 1.0, eng: 0.033, duck: db(-9), water: 0.5, spray: 0.9, fan: 0.42, buzzer: 0.5, chime: 0.6, crowd: 0.05 };
  let ctx = null, master = null, voiceBus = null, engBus = null, duckG = null, fxBus = null, crowdBus = null;
  let vbuf = null, vidx = null, voff = 0, names = [], warned = {};
  let eng = [], water = null, spray = null, slap = null, crowd = null, clap = null;
  let R = null, raceRef = null, lastTT = null, flags = {}, voiceUntil = 0, vsrc = [], lastFrame = 0, cardPrev = 0, gen = 0, stopped = false;

  function init() {
    if (MUTE || ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC({ latencyHint: 'playback' });
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 1.25; master.connect(comp); comp.connect(ctx.destination);
    voiceBus = ctx.createGain(); voiceBus.gain.value = LVL.voice; voiceBus.connect(master);
    duckG = ctx.createGain(); duckG.gain.value = 1; duckG.connect(master);
    engBus = ctx.createGain(); engBus.gain.value = 0; engBus.connect(duckG);
    fxBus = ctx.createGain(); fxBus.gain.value = 1; fxBus.connect(master);
    crowdBus = ctx.createGain(); crowdBus.gain.value = 0; crowdBus.connect(master);
    const wake = () => { if (ctx.state === 'suspended') ctx.resume(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach((e) => addEventListener(e, wake, { passive: true }));
    buildEngines(); if (BIG) buildCrowd();
    loadVoice();
    setInterval(() => { if (ctx && performance.now() - lastFrame > 400) engBus.gain.setTargetAtTime(0, ctx.currentTime, 0.1); }, 250); // 画面が止まったらエンジンも消す
  }
  function loadVoice() {
    fetch(VOICE_DIR + 'index.json').then((r) => r.json()).then((j) => {
      vidx = j; names = Object.keys(j.clips).filter((k) => k.indexOf('#S') === 1).map((k) => k.slice(3)).filter((v, i, a) => a.indexOf(v) === i);
      return fetch(VOICE_DIR + (j.sprite || 'announce.m4a')).then((r) => r.arrayBuffer());
    }).then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej))).then((b) => {
      vbuf = b;
      // AAC の頭のずれを測る: 最初の部品の声の立ち上がり（頭の 15ms のあと）を探す
      const first = Object.values(vidx.clips).reduce((a, c) => (c[0] < a[0] ? c : a)), d = b.getChannelData(0), from = Math.max(0, Math.floor((first[0] - 0.2) * b.sampleRate));
      let i = from; while (i < d.length && Math.abs(d[i]) < 0.012) i++;
      voff = clamp(i / b.sampleRate - (first[0] + 0.015), -0.15, 0.15);
    }).catch((e) => console.warn('boat voice', e));
  }
  /* ---------- エンジン ---------- */
  // 1 艇の音色: 主役の山（1 回転に 2 回の爆発）を 0dB として、1 オクターブ下 −5・1.5 倍 −14・2 倍 −13・2.5 倍 −14・3 倍 −9（資料 10 8-2 の近くのマイクの実測）。
  // 発振は 1 回転 1 回（主役の半分）の高さで作り、その倍音で並べる
  function engineWave() {
    const amp = [0, db(-5), 1, db(-14), db(-13), db(-14), db(-9), db(-20), db(-22), db(-24), db(-26), db(-28), db(-30), db(-32), db(-34)];
    const re = new Float32Array(amp.length), im = new Float32Array(amp.length); amp.forEach((a, n) => { im[n] = a * (n % 2 ? 1 : -1); });
    return ctx.createPeriodicWave(re, im);
  }
  function noiseBuf(sec, pink) {
    const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (pink) { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; } else d[i] = w; }
    return b;
  }
  function buildEngines() {
    const wave = engineWave(), nb = noiseBuf(3, false);
    // 6 艇の個体差（実測: 係留 113〜127Hz、全速 221〜231Hz）。艇ごとに少しずらしてうなりを出す
    const PIT = [0, 0.035, -0.04, 0.075, 0.015, -0.02], RUN = [0, 0.018, -0.012, 0.026, -0.02, 0.008];
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      o.setPeriodicWave(wave); o.frequency.value = 59; g.gain.value = 0; o.connect(g); if (p) { g.connect(p); p.connect(engBus); } else g.connect(engBus); o.start();
      eng.push({ o, g, p, f: 118 * (1 + PIT[i]), pit: PIT[i], run: RUN[i], on: false, amp: 0 });
    }
    const mk = (hp, lp) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(), g = ctx.createGain(); a.type = 'highpass'; a.frequency.value = hp; b.type = 'lowpass'; b.frequency.value = lp; g.gain.value = 0; s.connect(a); a.connect(b); b.connect(g); s.start(0, Math.random() * 2); return g; };
    water = mk(300, 3000); spray = mk(1500, 6000);
    // 艇底が水をたたくゆれ（1 秒に 3 回前後・浅く）: 水の音の大きさを少しゆらす
    const sg = ctx.createGain(); sg.gain.value = 1; water.connect(sg); spray.connect(sg); sg.connect(engBus);
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 3.2; lg.gain.value = 0; l.connect(lg); lg.connect(sg.gain); l.start(); slap = { l, lg };
  }
  /* ---------- 客席（ビッグレースだけ）---------- */
  function buildCrowd() {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf(4, true); s.loop = true; const bp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.6; lp.type = 'lowpass'; lp.frequency.value = 2200; g.gain.value = 1; s.connect(bp); bp.connect(lp); lp.connect(g); g.connect(crowdBus); s.start();
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 0.31; lg.gain.value = 0.25; l.connect(lg); lg.connect(g.gain); l.start();
    // 拍手: 短い手の音（雑音の粒）を 1 秒に 60 個ちらした 4 秒の輪
    const n = Math.round(ctx.sampleRate * 4), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let k = 0; k < 240; k++) { const at = Math.floor(Math.random() * (n - 2000)), len = 300 + Math.random() * 500, a = 0.3 + Math.random() * 0.7; let lpv = 0; for (let j = 0; j < len; j++) { const w = Math.random() * 2 - 1; lpv += 0.5 * (w - lpv); d[at + j] += (w - lpv) * a * Math.exp(-j / (len * 0.25)); } } }
    const cs = ctx.createBufferSource(), cg = ctx.createGain(), cf = ctx.createBiquadFilter(); cs.buffer = b; cs.loop = true; cf.type = 'bandpass'; cf.frequency.value = 1600; cf.Q.value = 0.5; cg.gain.value = 0;
    cs.connect(cf); cf.connect(cg); cg.connect(master); cs.start(); crowd = g; clap = cg;
  }
  function crowdTo(level, tau) { if (crowdBus) crowdBus.gain.setTargetAtTime(LVL.crowd * level, ctx.currentTime, tau || 0.6); }
  /* ---------- 1 コマごと ---------- */
  // st: { state: 'card'|'race'|'result', cardT, cardLen }
  function frame(race, st) {
    if (!ctx) return;
    lastFrame = performance.now(); R = race; st = st || {};
    if (stopped) { stopped = false; if (crowd) crowdTo(1, 0.3); } // stop で消した歓声を戻す
    const now = ctx.currentTime, tt = race.tt, V = race.vis || [], cam = race.camera, PIT_T = BOAT.Race.PIT_T;
    if (race.race !== raceRef) { raceRef = race.race; flags = {}; lastTT = null; stopVoice(); if (crowd) crowdTo(1, 0.3); eng.forEach((e) => { e.f = 118 * (1 + e.pit); e.on = false; }); }
    const card = st.state === 'card';
    const dt = lastTT == null ? 0 : clamp(tt - lastTT, 0, 0.2), jumped = lastTT != null && (tt < lastTT - 0.01 || tt - lastTT > 1);
    // ブザー（出走表の終わりに 3 回。3 回目の終わりでピットアウト）
    if (card) {
      const len = st.cardLen || 6, at = len - 2.6;
      if (BUZ && !flags.buz && cardPrev < at && (st.cardT || 0) >= at) { flags.buz = 1; BOAT.Fanfare.buzzer(ctx, fxBus, now + 0.02, LVL.buzzer); }
      cardPrev = st.cardT || 0;
    } else cardPrev = 0;
    // ファンファーレ（ピットアウトと同時。桐生・大村・丸亀の形）。途中から始めた（seek）ときは鳴らさない
    if (!card && !flags.fan && lastTT != null && !jumped && lastTT <= PIT_T + 0.3 && tt >= PIT_T) { flags.fan = 1; BOAT.Fanfare.play(ctx, fxBus, now - (tt - PIT_T), FAN, LVL.fan); if (crowd) { crowdTo(2.2, 0.4); later(() => crowdTo(1, 2), 9000); } }
    if (!card && lastTT != null && !jumped && crowd) { // ビッグレースの歓声
      const G = race.G || 999, cross = (x) => lastTT < x && tt >= x;
      if (cross(0)) { crowdTo(2.4, 0.3); later(() => crowdTo(1.2, 3), 4000); }
      if (cross(G - 2.5)) crowdTo(3, 0.5);
      if (cross(G + 1.5)) { clap.gain.setTargetAtTime(0.09, now, 0.4); crowdTo(1.6, 2); later(() => clap && clap.gain.setTargetAtTime(0, ctx.currentTime, 1.5), 6500); }
      if (cross(G + 5.3)) BOAT.Fanfare.play(ctx, fxBus, now + 0.05, 'W', LVL.fan * 0.8);
    }
    lastTT = tt;
    // エンジン
    const talking = now < voiceUntil;
    duckG.gain.setTargetAtTime(talking ? LVL.duck : 1, now, talking ? 0.12 : 0.35);
    engBus.gain.setTargetAtTime(1, now, 0.2);
    const cx = cam ? cam.position.x : 0, cy = cam ? cam.position.y : 20, cz = cam ? cam.position.z : 80;
    let wSum = 0, sSum = 0, spSum = 0;
    for (let i = 0; i < eng.length; i++) {
      const e = eng[i], v = V[i]; if (!v) { e.g.gain.setTargetAtTime(0, now, 0.2); continue; }
      const sp = v.speed || 0, acc = v.acc || 0, turnK = sp > 6 ? clamp((v.turn || 0) / 0.5, 0, 1) : 0;
      let target;
      if (card || tt <= PIT_T + 0.02) { target = 118 * (1 + e.pit); e.on = false; }
      else {
        // レバー: 加速していれば握っている、まっすぐ減速していれば放した。速いまままっすぐなら握ったまま（資料 10 3-4・8-5）
        if (acc > 0.8 || (sp > 14 && turnK < 0.6)) e.on = true; else if (acc < -1.5 && turnK < 0.25) e.on = false;
        if (e.on) { target = (160 + 65 * clamp((sp - 3) / 17, 0, 1)) * (1 + e.run); if (turnK > 0.2) target = Math.min(target, 225 * (1 + e.run) * (1 - 0.15 * turnK)); }
        else target = 70 + 30 * clamp(sp / 8, 0, 1);
      }
      if (dt > 0) { const tau = target > e.f ? (e.f < 160 ? 0.3 : 0.25) : 0.12; e.f += (target - e.f) * (1 - Math.exp(-dt / tau)); } else if (jumped || lastTT == null) e.f = target;
      // カメラに近づく・遠ざかる（音の速さ 343m/s）
      const dx = cx - v.x, dy = cy, dz = cz - v.z, d = Math.max(1, Math.hypot(dx, dy, dz)), hx = Math.cos(v.yaw || 0), hz = -Math.sin(v.yaw || 0), vr = clamp(sp * (hx * dx + hz * dz) / d, -40, 40);
      const fh = e.f * 343 / (343 - vr);
      e.o.frequency.setTargetAtTime(fh / 2, now, 0.03);
      // 大きさ: 回転（放すと −12〜−17dB）× 距離（バックは 1 マークの −4dB くらい）。転覆・欠場は消す
      const alive = v.on !== false && !(v.flip > 0.3);
      const lv = alive ? db(35 * Math.log10(e.f / 225) - 8 * Math.log10(Math.max(d, 30) / 60)) : 0;
      e.amp = lv; e.g.gain.setTargetAtTime(LVL.eng * lv, now, alive ? 0.06 : 0.3);
      if (e.p && cam) { const pv = new THREE.Vector3(v.x, 0, v.z).project(cam); e.p.pan.setTargetAtTime(clamp(pv.x * 0.45, -0.6, 0.6), now, 0.1); }
      wSum += lv; sSum += lv * turnK * clamp(sp / 12, 0, 1); spSum += lv * clamp(sp / 20, 0, 1);
    }
    water.gain.setTargetAtTime(LVL.eng * LVL.water * (0.4 * wSum + 0.6 * spSum) / 2.2, now, 0.1);
    spray.gain.setTargetAtTime(LVL.eng * LVL.spray * sSum / 1.6, now, 0.08);
    slap.lg.gain.setTargetAtTime(0.25 * clamp(spSum / 3, 0, 1), now, 0.3); slap.l.frequency.setTargetAtTime(2.6 + 1.2 * clamp(spSum / 4, 0, 1), now, 0.5);
  }
  /* ---------- 実況の声 ---------- */
  function stopVoice() { if (!ctx) return; const t = ctx.currentTime; vsrc.forEach((s) => { try { s.g.gain.setTargetAtTime(0, t, 0.02); s.s.stop(t + 0.1); } catch (e) { } }); vsrc = []; voiceUntil = 0; }
  function clipOf(key, tier) { const c = vidx.clips; return c[tier + key] || c[(tier === 2 ? 1 : tier === 0 ? 1 : 2) + key] || c[(tier === 2 ? 0 : tier === 0 ? 2 : 0) + key] || null; }
  // line: 台本の 1 行 { t, d, s }
  function say(line) {
    if (!ctx || !vbuf || !vidx || ctx.state !== 'running' || !line || !line.s || !BOAT.Announce) return;
    const now = ctx.currentTime, items = BOAT.Announce.plan(line, names), seq = [];
    let dur = 0;
    items.forEach((x) => { if (x.pause != null) { seq.push({ pause: x.pause }); dur += x.pause; return; } const c = clipOf(x.key, x.tier); if (!c) { if (!warned[x.key]) { warned[x.key] = 1; console.warn('boat voice: no clip', x.key, line.s); } return; } seq.push({ c }); dur += c[1] - 0.015; });
    if (!seq.length) return;
    // 次の行までに言い切れないときは少し速く（最大 1.12 倍）
    let rate = 1; const list = R && R.capList, k = list ? list.indexOf(line) : -1, nxt = k >= 0 ? list[k + 1] : null;
    if (nxt) { const avail = nxt.t - line.t - 0.1; if (dur > avail && avail > 0.5) rate = clamp(dur / avail, 1, 1.12); }
    // 前の声がまだ続いている: 1 秒以内に終わるなら待つ、それより長ければ切って次へ
    let t0 = now + 0.03;
    if (voiceUntil > now) { if (voiceUntil - now < 1.0) t0 = voiceUntil + 0.06; else stopVoice(); }
    if (/^お知らせいたします/.test(line.s)) { BOAT.Fanfare.chime(ctx, fxBus, t0, LVL.chime); t0 += 1.9; }
    let t = t0;
    seq.forEach((x) => {
      if (x.pause != null) { t += x.pause / rate; return; }
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = vbuf; s.playbackRate.value = rate; g.gain.value = 1; s.connect(g); g.connect(voiceBus);
      s.start(t, Math.max(0, x.c[0] + voff), x.c[1]); vsrc.push({ s, g }); s.onended = () => { vsrc = vsrc.filter((y) => y.s !== s); };
      t += (x.c[1] - 0.015) / rate;
    });
    voiceUntil = t;
  }
  // 古い呼び方（keys, race）も受ける
  function sayCompat(a, b) { if (a && a.s) return say(a); if (b && b.s) return say(b); }
  /* 音を全部止める（2026-11-20 直し）: 前は声とエンジンだけで、ファンファーレ・ブザー・チャイム・歓声・拍手は鳴り続けた（映像の途中の取り消し・競馬に戻る時に残る）。
     ファンファーレなどは「これから鳴る音」まで先に予約してあるので、それらがつながっている出口（fxBus）ごと 0.1 秒で絞って外し、次の音のために新しい出口を作る。
     歓声・拍手は音量を 0 に（あとで音量を戻す予約は gen で無効にする）。次に frame が呼ばれたら、歓声は元の大きさへ戻る。ふだんのレース（stop を呼ばない間）の鳴り方は変わらない */
  function stop() {
    stopVoice(); if (!ctx) return;
    const t = ctx.currentTime; gen++; stopped = true;
    if (engBus) engBus.gain.setTargetAtTime(0, t, 0.2);
    if (fxBus) { const old = fxBus; try { old.gain.cancelScheduledValues(t); old.gain.setTargetAtTime(0, t, 0.03); } catch (e) { } setTimeout(() => { try { old.disconnect(); } catch (e) { } }, 300); fxBus = ctx.createGain(); fxBus.gain.value = 1; fxBus.connect(master); }
    if (crowdBus) crowdBus.gain.setTargetAtTime(0, t, 0.1);
    if (clap) clap.gain.setTargetAtTime(0, t, 0.1);
  }
  const later = (fn, ms) => { const g0 = gen; setTimeout(() => { if (g0 === gen) fn(); }, ms); }; // stop のあとは実行しない予約
  return { init, say: sayCompat, frame, stop, get _fx() { return fxBus; }, get _crowd() { return crowdBus; }, get _clap() { return clap; }, update() { }, get on() { return !!ctx && ctx.state === 'running'; }, get ready() { return !!vbuf; }, get voff() { return voff; }, MUTE, BIG, FAN, LVL };
})();
