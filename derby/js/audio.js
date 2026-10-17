/* 音（WebAudio で合成。音声ファイルなし）。最初のタップで unlock() を呼ぶ。 */
window.Sfx = (function () {
  'use strict';
  let ctx = null, master = null, duck = null, muted = false, gateRec = null, gateTried = false;
  /* ゲートの音の録音（効果音ラボ「牢屋の扉を閉める」「鉄の扉を閉める」。商用無料・クレジット不要・ファイルの再配布は禁止）。
     読めないときは gateClang の合成の音で鳴らす */
  function loadGate() {
    if (gateTried || !ctx) return; gateTried = true;
    const dec = (f) => fetch(f).then((r) => r.arrayBuffer()).then((ab) => new Promise((ok, ng) => ctx.decodeAudioData(ab, ok, ng)));
    fetch('art/sfx/sfx.json').then((r) => r.json()).then((j) => Promise.all([dec(j.gate.main.file), dec(j.gate.rattle.file)]).then(([m, r]) => { gateRec = { main: m, rattle: r, mainOff: j.gate.main.off, rattleOff: j.gate.rattle.off }; }))
      .catch((e) => console.info('casa DERBY: ゲートの録音を読めないので合成の音を使います', e && e.message));
  }
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended' && !muted) ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      // master → duck（ゲートが開く直前に下げる）→ スピーカー。ゲートの音（gateClang）は duck を通らない
      duck = ctx.createGain(); duck.gain.value = 1; duck.connect(ctx.destination);
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(duck); setTimeout(loadGate, 0); if (muted) ctx.suspend(); // 消音中に作ったときは止めておく
    } catch (e) { ctx = null; }
  }
  function tone(freq, t0, dur, type, vol) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol || 0.3, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(t0, dur, vol) {
    if (!ctx || muted) return;
    const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 600; s.buffer = buf; g.gain.value = vol || 0.4;
    s.connect(f); f.connect(g); g.connect(master); s.start(t0);
  }
  const now = () => (ctx ? ctx.currentTime : 0);
  /* ゲートが開く音（本物に寄せる。オーナー指示「本物の競馬の音に寄せて」「めちゃくちゃ大きく」）
     調べた仕組み: 各枠の前扉は電磁石で閉じてあり、発走の合図で全枠の扉が同時に開く（観音開きの扉が止め金に当たる）。
     海外の発馬機は開くと同時に発走ベルが鳴る（特許 US2012186 など）。そこで次の 4 つを重ねる:
       1) （発走ベル「ジリリリ」は 2026-10-13 にオーナー指示で外した）
       2) 扉が一斉に開いて止め金に当たる「ガシャン」: 12 枚の扉が 70ms ほどの間にばらばらに当たる、短く重い金属の打撃
          （前の版の長い「シャーン」は鐘のように聞こえるので短くした）＋ ゲート全体が揺れる低い「ドン」
       3) 扉の跳ね返り・掛け金の「カタカタ」: 0.1〜0.35 秒後の小さな打撃
       4) 飛び出す馬の蹄の「ドドッ」: 0.25〜0.9 秒の低い連打
     全体の音量（master）を通さず直接出し、強く圧縮して詰め、最後に頭を丸めて音割れを防ぐ */
  /* 本物の録音で鳴らすゲートの音: 電磁石が外れる「カシャッ」→ 6 枠の鉄の扉が左右に広がって 70ms ほどの間に「ガシャン」
     （録音を枠ごとに少しずらし、高さ・左右を変えて重ねる）→ 鉄骨のガタつき（別の録音を薄く）→ 低い「ドン」→ 飛び出す蹄（蹄の録音） */
  function gateClangRec() {
    const t0 = now() + 0.02, R = gateRec;
    const out = ctx.createDynamicsCompressor(); out.threshold.value = -22; out.knee.value = 4; out.ratio.value = 8; out.attack.value = 0.001; out.release.value = 0.25;
    const vol = ctx.createGain(); vol.gain.value = 3.2; const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.0003; lim.release.value = 0.12;
    const clip = ctx.createWaveShaper(), cv = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; cv[i] = 0.93 * Math.tanh(1.6 * x) / Math.tanh(1.6); } clip.curve = cv;
    out.connect(vol); vol.connect(lim); lim.connect(clip); clip.connect(ctx.destination);
    const play = (buf, at, off, rate, gain, pan, lp, dur) => {
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; s.playbackRate.value = rate; g.gain.value = gain;
      let last = s; if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; s.connect(f); last = f; }
      last.connect(g); if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(out); } else g.connect(out);
      s.start(at, off, dur || 1.1);
    };
    // 電磁石が外れる「カシャッ」（短い高い打撃）
    { const n = Math.floor(ctx.sampleRate * 0.03), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.004));
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = b; f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 2; g.gain.value = 0.5; s.connect(f); f.connect(g); g.connect(out); s.start(t0 - 0.015); }
    // 6 枠の扉
    const td = t0 + 0.01;
    for (let k = 0; k < 6; k++) {
      const at = td + k * 0.011 + Math.random() * 0.01, pan = -0.7 + k * 0.28;
      play(R.main, at, R.mainOff, 0.88 + Math.random() * 0.2, 0.55, pan, 0);
      if (k % 2 === 0) play(R.rattle, at + 0.02 + Math.random() * 0.03, R.rattleOff, 0.9 + Math.random() * 0.2, 0.35, -pan * 0.6, 6000);
    }
    // 低い「ドン」（ゲート全体の揺れ）
    { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(80, td); o.frequency.exponentialRampToValueAtTime(36, td + 0.4);
      g.gain.setValueAtTime(0, td); g.gain.linearRampToValueAtTime(0.9, td + 0.004); g.gain.exponentialRampToValueAtTime(0.001, td + 0.5); o.connect(g); g.connect(out); o.start(td); o.stop(td + 0.55); }
    // 飛び出す蹄（蹄の録音があれば、それを 6 頭ぶん）
    const H = window.Hooves && Hooves.real;
    if (H) for (let k = 0; k < 18; k++) { const gr = H.dashG[(Math.random() * H.dashG.length) | 0], at = td + 0.22 + k * 0.035 + Math.random() * 0.03;
      play(H.dash, at, gr.off, 0.95 + Math.random() * 0.1, 0.32 / (H.dashPk * Math.max(0.4, gr.pk)) * (1 - k / 30), -0.6 + Math.random() * 1.2, 2600, gr.dur + 0.03); }
    setTimeout(() => { try { vol.disconnect(); lim.disconnect(); clip.disconnect(); } catch (e) { } }, 3000);
  }
  function gateClang() {
    if (!ctx || muted) return;
    if (gateRec) { try { gateClangRec(); return; } catch (e) { } }
    const t0 = now() + 0.01, sr = ctx.sampleRate;
    const out = ctx.createDynamicsCompressor();
    out.threshold.value = -24; out.knee.value = 4; out.ratio.value = 10; out.attack.value = 0.001; out.release.value = 0.3;
    const vol = ctx.createGain(); vol.gain.value = 4.5; const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.0003; lim.release.value = 0.12;
    const clip = ctx.createWaveShaper(), cv = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; cv[i] = 0.93 * Math.tanh(1.6 * x) / Math.tanh(1.6); } clip.curve = cv;
    out.connect(vol); vol.connect(lim); lim.connect(clip); clip.connect(ctx.destination);
    // 屋外の短い反響（スタンド・ゲートの鉄骨に跳ね返る）
    const dl = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(), lp = ctx.createBiquadFilter();
    dl.delayTime.value = 0.09; fb.gain.value = 0.3; wet.gain.value = 0.32; lp.type = 'lowpass'; lp.frequency.value = 3000;
    dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(out);
    const send = (node, rev) => { node.connect(out); if (rev) node.connect(dl); };
    const nlen = Math.floor(sr * 0.6), nb = ctx.createBuffer(1, nlen, sr), nd = nb.getChannelData(0); for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
    const hit = (t, f, q, peak, dec, rev) => { // 雑音の打撃
      const ns = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      ns.buffer = nb; ns.playbackRate.value = 0.8 + Math.random() * 0.4; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.002); g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      ns.connect(bp); bp.connect(g); send(g, rev); ns.start(t); ns.stop(t + dec + 0.05);
    };
    const ring = (t, f, peak, dec, rev) => { // 金属の短い鳴り
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0008, t + dec);
      o.connect(g); send(g, rev); o.start(t); o.stop(t + dec + 0.05);
    };
    // 1) 発走ベルはオーナー指示で外した（「ガシャン」と蹄の音だけ）
    // 2) 扉 12 枚が止め金に当たる「ガシャン」
    const td = t0 + 0.04;
    for (let k = 0; k < 12; k++) {
      const t = td + Math.random() * 0.07, sc = 0.75 + Math.random() * 0.25;
      hit(t, 520 + Math.random() * 800, 1.0, 0.85 * sc, 0.11 + Math.random() * 0.05, true);   // 重い（低め）
      hit(t, 180 + Math.random() * 120, 1.2, 0.9 * sc, 0.12, false);                          // 胴鳴り
      hit(t, 1500 + Math.random() * 900, 1.3, 0.35 * sc, 0.06, false);                        // 金属のエッジは控えめに
      [240, 560, 980, 1530].forEach((f) => ring(t, f * (0.92 + Math.random() * 0.16), 0.06 * sc, 0.22 + Math.random() * 0.16, true));
    }
    // 低い「ドン」
    { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(78, td); o.frequency.exponentialRampToValueAtTime(34, td + 0.45);
      g.gain.setValueAtTime(0, td); g.gain.linearRampToValueAtTime(1.2, td + 0.004); g.gain.exponentialRampToValueAtTime(0.001, td + 0.65); o.connect(g); g.connect(out); o.start(td); o.stop(td + 0.7);
      // 鉄骨全体の低い唸り（2 本目のドン、少し遅れて）
      const o2 = ctx.createOscillator(), g2 = ctx.createGain(); o2.type = 'triangle'; o2.frequency.setValueAtTime(120, td + 0.03); o2.frequency.exponentialRampToValueAtTime(55, td + 0.4);
      g2.gain.setValueAtTime(0, td + 0.03); g2.gain.linearRampToValueAtTime(0.45, td + 0.035); g2.gain.exponentialRampToValueAtTime(0.001, td + 0.5); o2.connect(g2); g2.connect(out); o2.start(td + 0.03); o2.stop(td + 0.55); }
    // 3) 跳ね返り・掛け金の「カタカタ」
    for (let k = 0; k < 9; k++) { const t = td + 0.1 + Math.random() * 0.25; hit(t, 1100 + Math.random() * 1200, 1.8, 0.26, 0.04, false); }
    // 4) 飛び出す蹄「ドドッ」（6 頭 × 数歩）
    for (let k = 0; k < 16; k++) { const t = td + 0.25 + Math.random() * 0.65; hit(t, 140 + Math.random() * 120, 1.2, 0.5 * (1 - (t - td) / 1.2), 0.08, false); }
    setTimeout(() => { try { vol.disconnect(); lim.disconnect(); clip.disconnect(); dl.disconnect(); fb.disconnect(); } catch (e) { } }, 3000);
  }
  /* ゲートイン（枠入り）の音（v2 講評 92→95 の 2）。js/race3d.js の giSound が台本の時刻に呼ぶ。
     ・giStart: 薄い環境音（遠いざわめき＋風。ループ）。実況エンジンの観客の音が鳴っているとき（ゲームの 1 店版）は足さない
     ・giLatch(pan): 後ろの扉が閉まる「ガチャン」、giSnort(pan): 首を振るときの鼻息「ブルッ」。どちらも環境音より +2.5dB（音の大きさ RMS をそろえて作る）
     ・giDuck: ゲートが開く 0.5 秒前に、ゲートの音以外（効果音・環境音）を約 −8dB 下げる。ゲートの音（gate）が鳴ったら 0.4 秒後から戻し、環境音は消していく
       （ゲートの音が来なかったとき＝発走が止まったときも 1.5 秒で戻る） */
  const GI = { bed: null, bedG: null, bufs: null, to: 0, lvl: 0.014, over: Math.pow(10, 2.5 / 20) };   // lvl: 環境音の RMS（実況エンジンの観客のざわめきの道中の大きさ 0.01 と同じくらい）。over: 扉・鼻息はその +2.5dB
  function giBufs() {
    if (GI.bufs) return GI.bufs;
    const sr = ctx.sampleRate, mk = (sec, fn) => { const n = Math.floor(sr * sec), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0); fn(d, n); return b; };
    const norm = (d, n0, n1) => { let q = 0; for (let i = n0; i < n1; i++) q += d[i] * d[i]; const g = 1 / Math.sqrt(q / Math.max(1, n1 - n0) + 1e-12); for (let i = 0; i < d.length; i++) d[i] *= g; };   // n0〜n1 の RMS を 1 に
    // 環境音 4 秒のループ: 低いうなり（風・遠くの人）＋人の声の帯域のゆらぎ。つなぎ目は 0.5 秒重ねる
    const bed = mk(4, (d, n) => {
      const f = Math.floor(sr * 0.5), tmp = new Float32Array(n + f); let a = 0, b = 0, c = 0, env = 0.6, tgt = 0.6;
      for (let i = 0; i < n + f; i++) { const x = Math.random() * 2 - 1; a += 0.02 * (x - a); b += 0.25 * (x - b); c = b - c * 0.2; if (i % 2400 === 0) tgt = 0.35 + Math.random() * 0.65; env += (tgt - env) * 0.0004; tmp[i] = a * 1.6 + (c - a) * 0.35 * env; }
      for (let i = 0; i < n; i++) d[i] = tmp[i]; for (let i = 0; i < f; i++) { const u = i / f; d[i] = tmp[i] * u + tmp[n + i] * (1 - u); }
      norm(d, 0, n);
    });
    // 掛け金「ガチャン」0.12 秒: 短い金属の打撃（雑音＋2 つの鳴り）
    const latch = mk(0.3, (d, n) => {
      for (let i = 0; i < n; i++) { const t = i / sr, e1 = Math.exp(-t / 0.012), e2 = Math.exp(-t / 0.05), t2 = t - 0.045, e3 = t2 > 0 ? Math.exp(-t2 / 0.01) : 0;
        d[i] = (Math.random() * 2 - 1) * (0.9 * e1 + 0.45 * e3) + 0.5 * e2 * Math.sin(2 * Math.PI * 820 * t) + 0.35 * e2 * Math.sin(2 * Math.PI * 1370 * t + 1); }
      norm(d, 0, Math.floor(sr * 0.12));
    });
    // 鼻息「ブルッ」0.3 秒: 息の雑音を小刻みに震わせる
    const snort = mk(0.35, (d, n) => {
      let a = 0; for (let i = 0; i < n; i++) { const t = i / sr, e = Math.min(1, t / 0.02) * Math.exp(-t / 0.1), x = Math.random() * 2 - 1; a += 0.35 * (x - a); d[i] = a * e * (0.6 + 0.4 * Math.sin(2 * Math.PI * 38 * t)); }
      norm(d, 0, Math.floor(sr * 0.25));
    });
    return (GI.bufs = { bed, latch, snort });
  }
  function giShot(buf, gain, pan, rate, lp) {
    if (!ctx || muted || !duck) return;
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; s.playbackRate.value = rate || 1; g.gain.value = gain;
    let last = s; if (lp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = lp; f.Q.value = 0.8; s.connect(f); last = f; }
    last.connect(g); if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan || 0; g.connect(p); p.connect(duck); } else g.connect(duck);
    s.start(now() + 0.005);
  }
  function giStart() {
    if (!ctx || muted || !duck || GI.bed) return;
    const B = giBufs(), crowdOn = !!(window.Commentary && window.Commentary.active);
    if (crowdOn) return;   // ゲームの 1 店版: 実況エンジンの観客のざわめきが環境音
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = B.bed; s.loop = true;   // フィルターを通さない（RMS がそのまま＝扉・鼻息との差が +2.5dB のまま）
    g.gain.setValueAtTime(0, now()); g.gain.linearRampToValueAtTime(GI.lvl, now() + 1.2);
    s.connect(g); g.connect(duck); s.start(now()); GI.bed = s; GI.bedG = g;
  }
  function giBedStop(at, fade) { if (!GI.bed) return; const s = GI.bed, g = GI.bedG; GI.bed = null; GI.bedG = null; g.gain.cancelScheduledValues(at); g.gain.setTargetAtTime(0, at, fade / 4); try { s.stop(at + fade + 0.2); } catch (e) { } }
  function giDuck() {
    if (!ctx || !duck) return; const t = now(), g = duck.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(0.4, t, 0.08);   // 約 0.25 秒で −8dB
    g.setTargetAtTime(1, t + 1.5, 0.3);   // ゲートの音が来なかったときの戻し
    clearTimeout(GI.to); GI.to = setTimeout(() => giBedStop(now(), 2), 3000);   // 環境音も止める
  }
  function giRelease() {
    if (!ctx || !duck) return; const t = now(), g = duck.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(1, t + 0.4, 0.35);
    clearTimeout(GI.to); giBedStop(t + 0.3, 2.5);   // 環境音は消していく（このあとは実況エンジンの観客の音）
  }
  const play = {
    giStart() { giStart(); },
    giLatch(pan) { if (ctx && !muted) giShot(giBufs().latch, GI.lvl * GI.over, pan, 0.92 + Math.random() * 0.16); },
    giSnort(pan) { if (ctx && !muted) giShot(giBufs().snort, GI.lvl * GI.over, pan, 0.9 + Math.random() * 0.2); },
    giDuck() { giDuck(); },
    button() { tone(880, now(), 0.08, 'square', 0.12); },
    select() { tone(660, now(), 0.06, 'triangle', 0.15); tone(990, now() + 0.06, 0.08, 'triangle', 0.15); },
    deny() { tone(180, now(), 0.18, 'sawtooth', 0.15); },
    fanfare() { const t = now(); [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.13, 0.25, 'triangle', 0.25)); },
    gate() { gateClang(); giRelease(); },
    hoof() { noise(now(), 0.05, 0.08); },
    bell() { const t = now(); tone(1568, t, 0.5, 'sine', 0.2); tone(2093, t + 0.02, 0.5, 'sine', 0.12); },
    win(big) { const t = now(); const seq = big ? [523, 659, 784, 1046, 1318, 1568] : [659, 784, 1046]; seq.forEach((f, i) => tone(f, t + i * 0.11, 0.5, 'triangle', 0.25)); },
    bet1() { tone(1200, now(), 0.05, 'square', 0.12); },
    bet10() { const t = now(); [900, 1200, 1500].forEach((f, i) => tone(f, t + i * 0.04, 0.06, 'square', 0.12)); },
    cancel() { tone(500, now(), 0.08, 'square', 0.1); tone(350, now() + 0.07, 0.1, 'square', 0.1); },
    tick() { tone(1000, now(), 0.04, 'square', 0.1); },
    goal() { const t = now(); [784, 988, 1175, 1568].forEach((f, i) => tone(f, t + i * 0.1, 0.35, 'triangle', 0.25)); },
    coins() { const t = now(); for (let i = 0; i < 12; i++) tone(2200 + (i % 3) * 300, t + i * 0.09, 0.08, 'sine', 0.12); },
    coinEnd() { tone(1760, now(), 0.3, 'sine', 0.15); },
    coin() { tone(1900 + Math.random() * 400, now(), 0.07, 'sine', 0.12); },
    chest() { const t = now(); [660, 880, 1320].forEach((f, i) => tone(f, t + i * 0.07, 0.2, 'triangle', 0.2)); },
    ball() { tone(1400, now(), 0.12, 'sine', 0.15); tone(1900, now() + 0.1, 0.18, 'sine', 0.12); },
    yum() { tone(600, now(), 0.08, 'triangle', 0.2); tone(900, now() + 0.08, 0.12, 'triangle', 0.2); },
    // 観客の歓声（わーっ）: 帯域を絞った雑音を、ゆっくり立ち上げて 1.6〜2.4 秒で消す。細かい揺れで人の声の集まりらしく。big で大きく長く
    cheer(big) {
      if (!ctx || muted) return;
      const t = now(), dur = big ? 2.4 : 1.6, n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      let a = 0, b = 0; for (let i = 0; i < n; i++) { const u = i / n, env = Math.min(1, u / 0.18) * Math.pow(1 - u, 1.6), am = 0.75 + 0.25 * Math.sin(i / ctx.sampleRate * 2 * Math.PI * (9 + 3 * Math.sin(i / 9000))); a = a * 0.6 + (Math.random() * 2 - 1) * 0.4; b = b * 0.97 + a * 0.03; d[i] = (a - b) * env * am; }
      const s = ctx.createBufferSource(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), g = ctx.createGain();
      f1.type = 'bandpass'; f1.frequency.value = 1100; f1.Q.value = 0.6; f2.type = 'lowshelf'; f2.frequency.value = 400; f2.gain.value = 4; g.gain.value = big ? 0.5 : 0.28;
      s.buffer = buf; s.connect(f1); f1.connect(f2); f2.connect(g); g.connect(master); s.start(t);
    },
    lose() { const t = now(); tone(330, t, 0.25, 'triangle', 0.15); tone(262, t + 0.22, 0.4, 'triangle', 0.15); },
  };
  // ctx(): 実況エンジン（js/commentary.js）が同じ AudioContext を使うため
  return { unlock, ctx() { return ctx; }, play(name) { if (play[name]) try { play[name].apply(null, [].slice.call(arguments, 1)); } catch (e) {} }, mute(v) { muted = !!v; if (ctx) { try { if (muted) ctx.suspend(); else ctx.resume(); } catch (e) { } } if (muted && window.Voice && Voice.stop) Voice.stop(); }, isMuted() { return muted; } };
})();
