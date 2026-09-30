/* 効果音。音声ファイルは使わず WebAudio で全SEを合成する（オフラインでも動作）。
   音色: サイン/ノコギリ/FMベル/ブラス/パッド/ドラム（キック・スネア・ハット・クラッシュ・タム・ティンパニ）/
         コイン/花火/スイープ など。ステレオ定位・リバーブ・ディレイ付き。
   iOS の自動再生制限のため、最初のタッチで AudioContext を resume する。 */
const Sfx = (function () {
  'use strict';
  let ctx = null, master = null, revSend = null, dlySend = null, noiseBuf = null;
  let spinNodes = null;
  let volume = 0.9, lastTick = 0, resumeAt = -1e9, stage = 1, tickN = 0;

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.22;
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(comp); comp.connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // リバーブ
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const x = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    revSend = ctx.createGain();
    revSend.gain.value = 0.5;
    revSend.connect(conv); conv.connect(master);

    // ディレイ（やまびこ）
    const dl = ctx.createDelay(1);
    dl.delayTime.value = 0.23;
    const fb = ctx.createGain(); fb.gain.value = 0.36;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3200;
    dlySend = ctx.createGain(); dlySend.gain.value = 0.5;
    dlySend.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(master);
    return true;
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state !== 'running') { resumeAt = performance.now(); ctx.resume().catch(() => {}); }
  }
  // resume 直後（同じタッチ内）の音は、開始待ちの間でも予約して鳴らす
  function ready() {
    return ensure() && (ctx.state === 'running' || performance.now() - resumeAt < 600);
  }

  /* 出力。o.pan: -1〜1 / o.rev: リバーブ量 / o.dly: ディレイ量 */
  function out(node, o) {
    let head = node;
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p); head = p;
    }
    head.connect(master);
    if (o.rev) { const g = ctx.createGain(); g.gain.value = o.rev; head.connect(g); g.connect(revSend); }
    if (o.dly) { const g = ctx.createGain(); g.gain.value = o.dly; head.connect(g); g.connect(dlySend); }
  }
  /* 軽量化: 同時に鳴っている音の数を数え、多すぎるときは小さな音（きらめき・コインなど）から間引く。
     音を一度に大量に作ると、その瞬間に画面が引っかかるため。 */
  const voices = [];
  const MAX_VOICES = 32;
  function admit(t, dur, gain) {
    const now = ctx.currentTime;
    while (voices.length && voices[0] < now) voices.shift();
    const busy = voices.filter((e) => e > t).length;
    if (busy >= MAX_VOICES) return false;
    if (busy >= MAX_VOICES * 0.6 && gain < 0.12) return false; // 混んできたら小さい音は鳴らさない
    const end = t + dur;
    let i = voices.length;
    while (i > 0 && voices[i - 1] > end) i--;
    voices.splice(i, 0, end);
    return true;
  }
  /* 軽量化: 少し先に鳴る音は、その直前になってから部品を作る。
     1つの効果音が数十〜百個の部品をまとめて作ると、その瞬間に画面が引っかかるため、作る時刻を分散させる。
     鳴る時刻は呼び出し時点で確定させるので、タイミングはずれない。 */
  function defer(fn, o) {
    if (o._t !== undefined || !(o.at > 0.25)) return false;
    const t = ctx.currentTime + o.at;
    setTimeout(() => { if (ctx.currentTime < t + 0.05) fn(Object.assign({}, o, { _t: Math.max(t, ctx.currentTime) })); }, (o.at - 0.18) * 1000);
    return true;
  }
  function envelope(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  /* o: {type,f,f2,at,a,d,g,lp,lp2,vib,trem,pan,rev,dly} */
  function tone(o) {
    if (defer(tone, o)) return;
    const t = o._t !== undefined ? o._t : ctx.currentTime + (o.at || 0), a = o.a || 0.004, d = o.d || 0.1;
    if (!admit(t, a + d, o.g || 0.2)) return;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
    if (o.vib) { // ビブラート
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = o.vibRate || 6; lg.gain.value = o.vib;
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + a + d + 0.05);
    }
    const g = ctx.createGain();
    envelope(g, t, a, d, o.g || 0.2);
    let head = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 0.8;
      f.frequency.setValueAtTime(o.lp, t);
      if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, t + a + d);
      osc.connect(f); head = f;
    }
    head.connect(g);
    let tail = g;
    if (o.trem) { // トレモロ
      const tg = ctx.createGain(); tg.gain.value = 0.6;
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = o.trem; lg.gain.value = 0.4;
      l.connect(lg); lg.connect(tg.gain); l.start(t); l.stop(t + a + d + 0.05);
      g.connect(tg); tail = tg;
    }
    out(tail, o);
    osc.start(t); osc.stop(t + a + d + 0.05);
  }
  /* o: {ft,f,f2,q,at,a,d,g,pan,rev,dly} */
  function noise(o) {
    if (defer(noise, o)) return;
    const t = o._t !== undefined ? o._t : ctx.currentTime + (o.at || 0), a = o.a || 0.002, d = o.d || 0.05;
    if (!admit(t, a + d, o.g || 0.2)) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.ft || 'bandpass';
    f.frequency.setValueAtTime(o.f, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    envelope(g, t, a, d, o.g || 0.2);
    src.connect(f); f.connect(g);
    out(g, o);
    src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  }
  /* FM音源。o: {f,f2,ratio,idx,at,a,d,g,pan,rev,dly} — ベル・チャイム・ゴング・レーザー */
  function fm(o) {
    if (defer(fm, o)) return;
    const t = o._t !== undefined ? o._t : ctx.currentTime + (o.at || 0), a = o.a || 0.003, d = o.d || 0.4;
    if (!admit(t, a + d, o.g || 0.2)) return;
    const ratio = Math.min(o.ratio || 3.5, 15000 / Math.max(o.f, o.f2 || 0)); // 変調波が可聴域を超えないように
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    car.frequency.setValueAtTime(o.f, t);
    mod.frequency.setValueAtTime(o.f * ratio, t);
    if (o.f2) { car.frequency.exponentialRampToValueAtTime(o.f2, t + a + d); mod.frequency.exponentialRampToValueAtTime(o.f2 * ratio, t + a + d); }
    mg.gain.setValueAtTime(o.f * (o.idx === undefined ? 2 : o.idx), t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, o.f * 0.05), t + a + d * 0.7);
    mod.connect(mg); mg.connect(car.frequency);
    envelope(g, t, a, d, o.g || 0.2);
    car.connect(g);
    out(g, o);
    car.start(t); mod.start(t); car.stop(t + a + d + 0.05); mod.stop(t + a + d + 0.05);
  }

  /* ---------- 楽器 ---------- */
  const bell = (f, at, d, g, o) => { fm(Object.assign({ f, at, d, g, ratio: 3.5, idx: 1.6, rev: 0.5 }, o)); tone({ f: f * 2.01, at, d: d * 0.5, g: g * 0.25 }); };
  const chime = (f, at, d, g, o) => fm(Object.assign({ f: f > 3600 ? f / 2 : f, at, d, g, ratio: 7.1, idx: 0.9, rev: 0.45, dly: 0.3 }, o)); // オルゴール
  const gong = (f, at, d, g) => { fm({ f, at, d, g, ratio: 1.41, idx: 3.2, rev: 0.7 }); fm({ f: f * 2.3, at, d: d * 0.6, g: g * 0.4, ratio: 1.7, idx: 2, rev: 0.6 }); };
  function brass(f, at, d, g, o) {
    o = o || {};
    tone({ type: 'sawtooth', f, at, a: 0.035, d, g, lp: 500, lp2: 2600, rev: 0.35, pan: o.pan });
    tone({ type: 'sawtooth', f: f * 1.006, at, a: 0.035, d, g: g * 0.7, lp: 500, lp2: 2000, pan: o.pan });
    tone({ type: 'square', f: f * 0.5, at, a: 0.03, d, g: g * 0.25, lp: 900 });
  }
  function pad(midis, at, a, d, g, o) { // コーラス風パッド
    o = o || {};
    midis.forEach((m, i) => {
      const f = hz(m);
      tone({ type: 'sawtooth', f: f * 0.997, at, a, d, g, lp: 900, lp2: 2400, rev: 0.6, pan: -0.5 + i * 0.3, vib: 3, trem: o.trem });
      tone({ type: 'sawtooth', f: f * 1.004, at, a, d, g: g * 0.8, lp: 800, lp2: 2000, pan: 0.5 - i * 0.3, trem: o.trem });
    });
  }
  const kick = (at, g) => { tone({ f: 150, f2: 38, at, d: 0.28, g: g || 0.9 }); noise({ ft: 'lowpass', f: 900, at, d: 0.03, g: (g || 0.9) * 0.4 }); };
  const sub = (at, d, g) => tone({ f: 85, f2: 24, at, d, g: g || 1 });
  const snare = (at, g, pan) => { noise({ f: 1900, q: 0.6, at, d: 0.11, g: g || 0.35, pan }); tone({ f: 210, f2: 150, at, d: 0.07, g: (g || 0.35) * 0.7, pan }); };
  const hat = (at, g, pan) => noise({ ft: 'highpass', f: 7000, at, d: 0.035, g: g || 0.12, pan });
  const crash = (at, d, g, pan) => { noise({ ft: 'highpass', f: 3800, at, d: d || 1.6, g: g || 0.3, rev: 0.5, pan }); noise({ f: 6200, q: 2, at, d: (d || 1.6) * 0.7, g: (g || 0.3) * 0.6, pan }); };
  const revCrash = (at, d, g) => noise({ ft: 'highpass', f: 3500, at, a: d, d: 0.04, g: g || 0.3, rev: 0.3 }); // 逆再生シンバル
  const tom = (f, at, g, pan) => { tone({ f, f2: f * 0.55, at, d: 0.26, g: g || 0.6, pan }); noise({ ft: 'lowpass', f: 1200, at, d: 0.03, g: 0.2, pan }); };
  const timp = (f, at, d, g) => { tone({ f, f2: f * 0.92, at, d, g, rev: 0.5 }); tone({ type: 'triangle', f: f * 1.5, at, d: d * 0.6, g: g * 0.35 }); noise({ ft: 'lowpass', f: 500, at, d: 0.05, g: g * 0.4 }); };
  function clang(at, g, d) {
    [311, 466, 702, 1051, 1580, 2370].forEach((f, i) =>
      tone({ type: i % 2 ? 'triangle' : 'sine', f: f * (1 + Math.random() * 0.01), at, d: d * (1 - i * 0.1), g: g * (1 - i * 0.12), rev: 0.6, pan: i % 2 ? 0.3 : -0.3 }));
  }
  function hit(midis, at, g) { // オーケストラヒット
    midis.forEach((m, i) => {
      tone({ type: 'sawtooth', f: hz(m), at, a: 0.008, d: 0.5, g, lp: 3800, lp2: 600, rev: 0.5, pan: -0.4 + i * 0.25 });
      tone({ type: 'sawtooth', f: hz(m) * 1.008, at, a: 0.008, d: 0.45, g: g * 0.7, lp: 3000, lp2: 500 });
    });
    kick(at, 1); noise({ f: 2500, q: 0.5, at, d: 0.2, g: 0.35, rev: 0.4 });
  }
  function coin(at, g, pan) { // コイン: 高い2音
    fm({ f: hz(95), at, d: 0.07, g: g || 0.14, ratio: 2, idx: 0.6, pan });
    fm({ f: hz(100), at: at + 0.065, d: 0.4, g: g || 0.14, ratio: 2, idx: 0.6, pan, rev: 0.3 });
  }
  function coins(at, dur, n) { for (let i = 0; i < n; i++) coin(at + Math.random() * dur, rnd(0.05, 0.12), rnd(-0.9, 0.9)); }
  function sparkle(at, dur, base, n) { for (let i = 0; i < n; i++) chime(hz(base + pick([0, 4, 7, 12, 16, 19, 24])), at + Math.random() * dur, 0.5, rnd(0.04, 0.09), { pan: rnd(-0.9, 0.9) }); }
  const whoosh = (at, d, g, up, pan) => noise({ f: up ? 250 : 3500, f2: up ? 4500 : 200, q: 0.9, at, a: d * 0.6, d: d * 0.4, g, pan });
  /* メロディ: notes = [[MIDI, 拍, 長さ(拍)]] */
  const melody = (notes, beat, at, tr, fn) => notes.forEach(([m, b, l]) => fn(hz(m + tr), at + b * beat, l * beat));
  function firework(at, pan) { // 花火: ヒュー → ドン → パラパラ
    tone({ f: rnd(700, 1000), f2: rnd(2200, 3000), at, a: 0.02, d: 0.28, g: 0.07, pan, vib: 30, vibRate: 22 });
    tone({ f: 130, f2: 48, at: at + 0.3, d: 0.3, g: 0.55, pan });
    noise({ ft: 'lowpass', f: 4500, f2: 400, at: at + 0.3, d: 0.4, g: 0.3, pan, rev: 0.5 });
    for (let i = 0; i < 8; i++) noise({ ft: 'highpass', f: rnd(3000, 7000), at: at + 0.4 + Math.random() * 0.6, d: 0.03, g: rnd(0.04, 0.12), pan: pan + rnd(-0.3, 0.3) });
  }

  // ステージごとの音階（停止直前のオルゴール・ジングルに使用）と基音
  const SCALES = { 1: [72, 74, 76, 79, 81, 84, 86, 88], 2: [74, 76, 78, 81, 83, 86, 88, 90], 3: [76, 78, 79, 83, 84, 87, 88, 91] };
  const ROOT = { 1: 60, 2: 62, 3: 64 };

  /* ファンファーレ一式（tr: 移調, big: ドラム・ベース付き） */
  const FANFARE = [[72, 0, 0.7], [72, 0.75, 0.25], [72, 1, 0.5], [76, 1.5, 0.5], [79, 2, 0.5], [76, 2.5, 0.5], [79, 3, 0.5], [84, 3.5, 3]];
  function fanfare(at, tr, big) {
    const B = 0.19;
    melody(FANFARE, B, at, tr, (f, t, l) => { brass(f, t, l + 0.1, 0.12); brass(f / 2, t, l + 0.1, 0.08, { pan: -0.3 }); });
    melody([[76, 3.5, 3], [79, 3.5, 3]], B, at, tr, (f, t, l) => brass(f, t, l, 0.06, { pan: 0.4 }));
    melody([[48, 0, 1], [48, 1, 1], [43, 2, 1], [43, 3, 0.5], [48, 3.5, 3]], B, at, tr, (f, t, l) => tone({ type: 'triangle', f, at: t, d: l + 0.1, g: 0.3 }));
    if (big) {
      for (let b = 0; b < 3.5; b += 1) { kick(at + b * B, 0.8); snare(at + (b + 0.5) * B, 0.28, 0.2); }
      [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25].forEach((b) => hat(at + b * B, 0.1, -0.3));
      tom(180, at + 3 * B, 0.5, -0.5); tom(140, at + 3.17 * B, 0.5, 0); tom(100, at + 3.33 * B, 0.6, 0.5);
      kick(at + 3.5 * B, 1); crash(at + 3.5 * B, 2.2, 0.32);
    }
    [0, 4, 7, 12].forEach((iv, i) => bell(hz(84 + tr + iv), at + 3.5 * B + i * 0.06, 1.6, 0.1, { pan: -0.6 + i * 0.4 }));
  }

  const SOUNDS = {
    /* ---------- レバー ---------- */
    leverTouch() {
      noise({ f: 2600, q: 2, d: 0.04, g: 0.22 });
      tone({ f: 190, f2: 120, d: 0.07, g: 0.3 });
      fm({ f: hz(ROOT[stage] + 12), d: 0.12, g: 0.06, ratio: 2, idx: 1 });
    },
    ratchet(p) { // ギアの歯が1段ずつ上がっていく
      noise({ f: 1700 + p * 1500, q: 3, d: 0.028, g: 0.2 + p * 0.1 });
      tone({ type: 'square', f: 700 + p * 600, d: 0.014, g: 0.04 });
      fm({ f: hz(ROOT[stage] + 12 + Math.round(p * 12)), d: 0.09, g: 0.05, ratio: 3, idx: 0.8 });
    },
    leverCommit() {
      sub(0, 0.3, 1.0);
      noise({ ft: 'lowpass', f: 1100, d: 0.13, g: 0.6 });
      clang(0.01, 0.07, 0.5);
      tone({ type: 'sawtooth', f: hz(ROOT[stage] - 12), f2: hz(ROOT[stage] + 24), a: 0.22, d: 0.05, g: 0.12, lp: 3000 }); // エネルギーが入る
      whoosh(0.02, 0.3, 0.2, true);
    },
    leverReturn() { whoosh(0, 0.26, 0.14, true); },
    leverHome() {
      tone({ f: 170, f2: 85, d: 0.09, g: 0.5 });
      noise({ ft: 'lowpass', f: 900, d: 0.06, g: 0.32 });
      tone({ type: 'triangle', f: 1100, d: 0.05, g: 0.05 });
    },
    leverDeny() {
      tone({ type: 'square', f: 150, d: 0.09, g: 0.12, lp: 900 });
      noise({ ft: 'lowpass', f: 500, d: 0.06, g: 0.3 });
    },

    /* ---------- リール ---------- */
    reelStart() {
      tickN = 0;
      noise({ f: 280, f2: 2600, q: 0.9, a: 0.35, d: 0.25, g: 0.26 });
      tone({ type: 'sawtooth', f: 55, f2: 190, a: 0.3, d: 0.25, g: 0.12, lp: 900 });
      [0, 7, 12, 19].slice(0, stage + 1).forEach((iv, i) => chime(hz(ROOT[stage] + 12 + iv), i * 0.07, 0.4, 0.08, { pan: -0.5 + i * 0.3 }));
    },
    stop() {
      [0, 4, 7, 12].forEach((iv, i) => tone({ type: 'square', f: hz(ROOT[stage] + 24 + iv), at: 0.02 + i * 0.045, d: i === 3 ? 0.3 : 0.06, g: 0.08, lp: 5200, pan: -0.3 + i * 0.2, rev: i === 3 ? 0.4 : 0 }));
      if (stage === 1) {
        sub(0, 0.2, 0.9); noise({ ft: 'lowpass', f: 1400, d: 0.08, g: 0.55 });
        bell(hz(79), 0.01, 0.5, 0.1);
      } else if (stage === 2) {
        sub(0, 0.26, 1.0); noise({ ft: 'lowpass', f: 1600, d: 0.09, g: 0.6 });
        bell(hz(74), 0.01, 0.6, 0.1); bell(hz(81), 0.07, 0.7, 0.09, { pan: 0.4 });
        clang(0, 0.04, 0.5);
      } else {
        sub(0, 0.5, 1.0); noise({ ft: 'lowpass', f: 2000, f2: 200, d: 0.2, g: 0.7, rev: 0.4 });
        gong(hz(40), 0, 1.6, 0.25); clang(0, 0.07, 0.9);
        timp(hz(40), 0, 0.7, 0.5);
      }
    },
    tease(dur) { // 緊張: トレモロの弦が半音ずつ上がる
      const r = ROOT[stage];
      const steps = Math.max(2, Math.round(dur / 0.45));
      for (let i = 0; i < steps; i++) {
        const at = (dur / steps) * i, d = dur / steps + 0.1;
        tone({ type: 'sawtooth', f: hz(r + 12 + i), at, a: 0.05, d, g: 0.05 + 0.03 * (i / steps), lp: 1800, trem: 14, rev: 0.3, pan: -0.3 });
        tone({ type: 'sawtooth', f: hz(r + 19 + i), at, a: 0.05, d, g: 0.04 + 0.03 * (i / steps), lp: 1800, trem: 15, pan: 0.3 });
      }
      tone({ f: hz(r - 12), f2: hz(r - 5), a: dur * 0.9, d: dur * 0.1, g: 0.14 });
      revCrash(Math.max(0, dur - 0.9), 0.85, 0.12);
    },
    heartbeat() {
      tone({ f: 62, f2: 38, d: 0.14, g: 0.85 });
      tone({ f: 58, f2: 36, at: 0.2, d: 0.14, g: 0.55 });
    },
    zero() {
      const v = Math.floor(Math.random() * 3);
      if (v === 0) { // しぼむ2音
        tone({ type: 'triangle', f: 196, f2: 120, d: 0.5, g: 0.24, rev: 0.4, vib: 4 });
        tone({ type: 'triangle', f: 147, f2: 82, at: 0.18, d: 0.7, g: 0.26, rev: 0.4, vib: 5 });
        noise({ ft: 'lowpass', f: 320, at: 0.18, d: 0.4, g: 0.2 });
      } else if (v === 1) { // ブラスの下降
        [[58, 0], [57, 0.22], [53, 0.44]].forEach(([m, at]) => brass(hz(m), at, 0.3, 0.09));
        tone({ type: 'sawtooth', f: hz(53), f2: hz(41), at: 0.66, d: 0.7, g: 0.1, lp: 900, vib: 6 });
        timp(hz(41), 0.66, 0.6, 0.4);
      } else { // 短調のオルゴール
        [[76, 0], [72, 0.14], [69, 0.28], [64, 0.46]].forEach(([m, at]) => chime(hz(m), at, 0.9, 0.12));
        sub(0.46, 0.5, 0.35);
      }
    },

    /* ---------- 当選（レベル 1〜8） ---------- */
    count(u) { fm({ f: hz(72 + Math.round(u * 24)), d: 0.06, g: 0.07, ratio: 2, idx: 0.7, pan: rnd(-0.4, 0.4) }); },
    winSmall() { SOUNDS.win(1); },
    win(L) {
      const horn = (f, t, l) => { brass(f, t, l, 0.12); brass(f / 2, t, l, 0.08); };
      if (L === 1) {
        coin(0, 0.16); coin(0.16, 0.14, 0.4);
        [72, 76, 79, 84].forEach((m, i) => chime(hz(m), 0.3 + i * 0.08, 0.7, 0.16, { pan: -0.4 + i * 0.25 }));
        return;
      }
      if (L === 2) {
        kick(0, 0.5); coins(0, 0.5, 4);
        [72, 76, 79, 84].forEach((m, i) => bell(hz(m), 0.1 + i * 0.08, 0.7, 0.16, { pan: -0.4 + i * 0.25 }));
        [76, 79, 84, 88].forEach((m, i) => chime(hz(m), 0.55 + i * 0.07, 0.9, 0.14, { pan: 0.4 - i * 0.25 }));
        return;
      }
      if (L === 3) {
        kick(0, 0.8); crash(0, 1.0, 0.16);
        melody([[72, 0, 0.5], [76, 0.5, 0.5], [79, 1, 2]], 0.17, 0.05, 0, horn);
        coins(0.3, 1.4, 8); sparkle(0.6, 1.6, 84, 10);
        return;
      }
      if (L === 4) {
        tom(200, 0, 0.5, -0.5); tom(160, 0.09, 0.5, 0); snare(0.18, 0.4); kick(0.3, 1); crash(0.3, 1.6, 0.26);
        melody([[67, 0, 0.5], [72, 0.5, 0.5], [76, 1, 0.5], [79, 1.5, 0.5], [84, 2, 2.5]], 0.15, 0.3, 0, horn);
        coins(0.5, 2.2, 14); sparkle(0.9, 2.2, 84, 14);
        pad([60, 64, 67], 0.6, 0.3, 2.2, 0.03);
        return;
      }
      if (L === 5) {
        hit([48, 60, 64, 67, 72], 0, 0.1); crash(0, 2, 0.3); sub(0, 0.9, 1);
        melody([[67, 0, 0.5], [72, 0.5, 0.5], [76, 1, 0.5], [79, 1.5, 0.5], [84, 2, 2]], 0.15, 0.15, 0, horn);
        melody([[69, 0, 0.5], [74, 0.5, 0.5], [78, 1, 0.5], [81, 1.5, 0.5], [86, 2, 3.5]], 0.15, 0.95, 0, horn); // 1音上げて繰り返す
        kick(0.95, 0.9); crash(1.25, 2, 0.26, 0.4);
        coins(0.4, 3.4, 24); sparkle(1.2, 3, 86, 20);
        pad([62, 66, 69], 1.25, 0.3, 2.8, 0.035);
        return;
      }
      // L6〜8: フルファンファーレ
      hit([36, 48, 60, 64, 67, 72], 0, 0.1); crash(0, 2.4, 0.34); sub(0, 1.2, 1); clang(0, 0.08, 1.4);
      fanfare(0.35, 0, true);
      pad([60, 64, 67, 72], 0.8, 0.3, 2.4, 0.035);
      coins(0.5, 3.0, L === 6 ? 36 : 50);
      sparkle(0.8, 2.6, 84, 26);
      if (L >= 7) { // 1音上げて2回目
        const at = 1.9;
        revCrash(at - 0.9, 0.9, 0.25);
        for (let i = 0; i < 10; i++) timp(hz(38), at - 0.9 + i * 0.09, 0.2, 0.18 + i * 0.04);
        hit([38, 50, 62, 66, 69, 74], at, 0.1); crash(at, 2.4, 0.34, -0.3); sub(at, 1.2, 1);
        fanfare(at + 0.3, 2, true);
        pad([62, 66, 69, 74], at + 0.6, 0.3, 1.8, 0.04);
        sparkle(at + 0.5, 1.8, 86, 20);
      }
      if (L >= 8) { // さらに上げてフィナーレ
        const at = 3.3;
        revCrash(at - 1.0, 1.0, 0.3);
        for (let i = 0; i < 14; i++) { timp(hz(40), at - 1.1 + i * 0.075, 0.2, 0.16 + i * 0.04); snare(at - 1.1 + i * 0.075, 0.1 + i * 0.02, i % 2 ? 0.4 : -0.4); }
        hit([40, 52, 64, 68, 71, 76], at, 0.11); crash(at, 3, 0.36); crash(at + 0.1, 3, 0.3, 0.6); sub(at, 1.6, 1); clang(at, 0.1, 2);
        fanfare(at + 0.3, 4, true);
        pad([64, 68, 71, 76, 80], at + 0.3, 0.3, 1.6, 0.04);
        for (let i = 0; i < 28; i++) chime(hz(64 + [0, 4, 7][i % 3] + 12 * Math.floor(i / 6)), at + 0.3 + i * 0.035, 0.5, 0.09, { pan: -0.8 + (i / 28) * 1.6 }); // 駆け上がり
        coins(at, 1.4, 36); sparkle(at + 0.3, 1.2, 88, 18);
        hit([40, 52, 64, 68, 71, 76, 88], at + 1.3, 0.12); crash(at + 1.3, 3, 0.36); sub(at + 1.3, 1.8, 1); gong(hz(40), at + 1.3, 3, 0.3);
      }
    },

    /* ---------- ステージ突入 ---------- */
    riser(dur) { // チャージ: 加速するアルペジオ＋スネアロール＋逆シンバル
      const a = (dur || 1) - 0.05, r = ROOT[stage];
      const arp = [0, 4, 7, 12, 16, 19, 24, 28, 31];
      noise({ f: 180, f2: 7000, q: 1.4, a, d: 0.04, g: 0.36 });
      tone({ type: 'sawtooth', f: 70, f2: 700, a, d: 0.04, g: 0.12, lp: 2400 });
      revCrash(a * 0.3, a * 0.7, 0.26);
      let t = 0, i = 0;
      while (t < a) {
        const u = t / a;
        fm({ f: hz(r + 12 + arp[i % arp.length]), at: t, d: 0.12, g: 0.06 + 0.08 * u, ratio: 2, idx: 1.2, pan: i % 2 ? 0.5 : -0.5 });
        snare(t, 0.05 + 0.22 * u, i % 2 ? 0.3 : -0.3);
        tone({ f: 50 + 40 * u, at: t, d: 0.07, g: 0.2 + 0.3 * u });
        t += 0.2 - 0.15 * u; i++;
      }
    },
    impact() {
      const r = ROOT[stage];
      sub(0, 1.2, 1.0);
      noise({ ft: 'lowpass', f: 4000, f2: 180, d: 0.55, g: 0.7, rev: 0.4 });
      crash(0, 2.4, 0.36); crash(0.06, 2.2, 0.28, 0.6);
      clang(0, 0.12, 1.5);
      hit([r - 24, r - 12, r, r + 4, r + 7, r + 12], 0, 0.11);
      tone({ type: 'sawtooth', f: 2400, f2: 120, d: 0.5, g: 0.08, lp: 5000 }); // 落下スイープ
      [0, 4, 7, 12, 16].forEach((iv, i) => bell(hz(r + 19 + iv), 0.22 + i * 0.07, 1.0, 0.16, { pan: -0.6 + i * 0.3 }));
      melody([[72, 0, 0.5], [76, 0.5, 0.5], [79, 1, 0.5], [84, 1.5, 2.5]], 0.14, 0.5, r - 60, (f, t, l) => { brass(f, t, l, 0.12); brass(f / 2, t, l, 0.08); });
      coins(0.4, 1.6, 14);
    },
    pop() { firework(0, rnd(-0.9, 0.9)); },
    zap() { // 稲妻
      noise({ ft: 'highpass', f: 3000, d: 0.06, g: 0.3, pan: rnd(-0.8, 0.8) });
      fm({ f: 1800, f2: 200, d: 0.18, g: 0.12, ratio: 1.3, idx: 6, pan: rnd(-0.8, 0.8) });
      sub(0.02, 0.3, 0.5);
    },
    warp() { // ワープ（ズーム）
      whoosh(0, 0.9, 0.3, true, -0.6); whoosh(0.05, 0.9, 0.3, true, 0.6);
      fm({ f: 200, f2: 2400, a: 0.7, d: 0.1, g: 0.1, ratio: 1.5, idx: 3, dly: 0.4 });
    },
    shutterClose() {
      whoosh(0, 0.42, 0.3, false);
      tone({ type: 'sawtooth', f: 300, f2: 60, d: 0.42, g: 0.08, lp: 1200 });
      sub(0.42, 0.5, 1.0); kick(0.42, 1);
      noise({ ft: 'lowpass', f: 1500, at: 0.42, d: 0.14, g: 0.6 });
      clang(0.42, 0.1, 1.1); gong(hz(36), 0.42, 1.4, 0.2);
      noise({ ft: 'lowpass', f: 160, at: 0.5, d: 0.9, g: 0.5 }); // 残響の地鳴り
    },
    slam(p) { // 扉が1枚ぶつかる（p が大きいほど高い音）
      sub(0, 0.35, 1.0); kick(0, 1);
      noise({ ft: 'lowpass', f: 1600, d: 0.1, g: 0.55 });
      clang(0, 0.08, 0.6);
      bell(hz(ROOT[stage] + Math.round((p || 0) * 12)), 0.02, 0.5, 0.12, { pan: -0.5 + (p || 0) });
    },
    shutterOpen() {
      tone({ f: 60, f2: 40, d: 0.15, g: 0.6 });
      whoosh(0, 0.55, 0.28, true);
      [72, 79].forEach((m, i) => bell(hz(m), 0.3 + i * 0.1, 0.8, 0.1));
    },
    bolt(p) { // ロック解除: 歯車 → 金属音 → 音階が上がる
      const m = SCALES[stage][Math.min(7, Math.round((p || 0) * 6))];
      for (let i = 0; i < 3; i++) noise({ f: 2600, q: 3, at: i * 0.035, d: 0.02, g: 0.16 });
      sub(0.1, 0.18, 0.9);
      noise({ ft: 'lowpass', f: 1800, at: 0.1, d: 0.06, g: 0.5 });
      clang(0.1, 0.05, 0.5);
      bell(hz(m - 12), 0.12, 0.7, 0.16, { pan: -0.6 + (p || 0) * 1.2, dly: 0.3 });
      hat(0.1, 0.12);
    },
    stamp() { // ステージ名の刻印
      const r = ROOT[stage];
      hit([r - 24, r - 12, r, r + 7, r + 12], 0, 0.12);
      sub(0, 1.0, 1.0); crash(0, 1.8, 0.28);
      gong(hz(r - 24), 0, 2.2, 0.3);
      clang(0, 0.1, 1.4);
      noise({ ft: 'lowpass', f: 200, d: 0.8, g: 0.5 });
    },
    roll(dur) { // ドラムロール＋ティンパニ＋上昇するストリングス
      const r = ROOT[stage];
      let t = 0, i = 0;
      while (t < dur) {
        const u = t / dur;
        snare(t, 0.08 + 0.26 * u, i % 2 ? 0.25 : -0.25);
        if (i % 4 === 0) timp(hz(r - 24 + (u > 0.6 ? 5 : 0)), t, 0.25, 0.2 + 0.3 * u);
        t += 0.11 - 0.05 * u; i++;
      }
      tone({ type: 'sawtooth', f: hz(r), f2: hz(r + 12), a: dur * 0.95, d: 0.05, g: 0.13, lp: 1800, trem: 16 });
      noise({ f: 300, f2: 5000, q: 1, a: dur * 0.95, d: 0.05, g: 0.2 });
      revCrash(Math.max(0, dur - 1.1), 1.05, 0.3);
    },
    thunder() {
      noise({ ft: 'highpass', f: 2500, d: 0.08, g: 0.4 });
      for (let i = 0; i < 5; i++) noise({ ft: 'highpass', f: rnd(1500, 4000), at: 0.03 + Math.random() * 0.25, d: 0.04, g: 0.2, pan: rnd(-0.8, 0.8) });
      noise({ ft: 'lowpass', f: 900, f2: 90, at: 0.05, d: 1.3, g: 0.8, rev: 0.6 });
      tone({ f: 60, f2: 28, at: 0.05, d: 1.0, g: 0.8 });
    },
    open(fin) { // 開門: ヒット＋クラッシュ＋合唱パッド＋駆け上がり
      const r = ROOT[stage];
      sub(0, 1.8, 1.0);
      noise({ ft: 'lowpass', f: 5000, f2: 150, d: 0.9, g: 0.7, rev: 0.5 });
      whoosh(0, 1.1, 0.3, true, -0.5); whoosh(0.05, 1.1, 0.3, true, 0.5);
      crash(0, 3, 0.36, -0.4); crash(0.08, 3, 0.32, 0.4);
      clang(0, 0.12, 1.8);
      hit([r - 12, r, r + 7, r + 12], 0, 0.12);
      pad(fin ? [r, r + 7, r + 15] : [r, r + 7, r + 16], 0.1, 0.5, 2.0, 0.05);
      const n = fin ? 10 : 8;
      for (let i = 0; i < n; i++) chime(hz(r + 12 + [0, 4, 7][i % 3] + 12 * Math.floor(i / 6)), 0.2 + i * 0.05, 0.7, 0.1, { pan: -0.8 + (i / n) * 1.6 });
      melody([[72, 0, 0.5], [79, 0.5, 0.5], [84, 1, 3]], 0.16, 0.35, r - 60, (f, t, l) => { brass(f, t, l, 0.12); brass(f / 2, t, l, 0.09); });
      if (fin) { gong(hz(r - 24), 0, 3, 0.3); for (let i = 0; i < 4; i++) timp(hz(r - 24), 0.1 + i * 0.22, 0.3, 0.4); }
      coins(0.5, 1.2, 5);
    },
    stageReady() { // 新しいステージでレバー待ちになった合図
      const r = ROOT[stage];
      if (stage === 1) { bell(hz(88), 0, 0.5, 0.14); bell(hz(95), 0.09, 0.7, 0.14); return; }
      [0, 7, 12, 16].forEach((iv, i) => chime(hz(r + 12 + iv), i * 0.09, 0.8, 0.13, { pan: -0.5 + i * 0.3 }));
      pad([r, r + 7], 0, 0.2, 1.2, 0.03);
      if (stage === 3) { timp(hz(r - 24), 0, 0.6, 0.5); timp(hz(r - 24), 0.36, 0.8, 0.5); }
    },

    /* ---------- ポーカー小物・ステージ移行 ---------- */
    crack(p) { // ガラスにヒビ
      for (let i = 0; i < 5; i++) noise({ ft: 'highpass', f: rnd(3500, 7000), at: i * 0.025 + Math.random() * 0.03, d: 0.035, g: 0.28, pan: rnd(-0.8, 0.8) });
      fm({ f: 2400 + (p || 0) * 900, f2: 900, d: 0.18, g: 0.12, ratio: 2.3, idx: 4, rev: 0.4 });
      tone({ f: 140, f2: 70, d: 0.12, g: 0.5 });
    },
    shatter() { // ガラスが砕け散る
      sub(0, 1.0, 1.0); kick(0, 1);
      noise({ ft: 'highpass', f: 2500, d: 0.9, g: 0.6, rev: 0.5 });
      noise({ f: 5200, q: 1.2, d: 0.6, g: 0.4 });
      for (let i = 0; i < 26; i++) fm({ f: rnd(2200, 6000), at: 0.04 + Math.random() * 1.2, d: rnd(0.08, 0.3), g: rnd(0.03, 0.09), ratio: rnd(1.3, 3.1), idx: 3, pan: rnd(-0.9, 0.9), rev: 0.4 }); // 破片が落ちる音
      crash(0, 2.2, 0.3);
    },
    deal() { // カードを配る
      noise({ f: 1800, f2: 5200, q: 1.1, a: 0.05, d: 0.05, g: 0.22, pan: rnd(-0.5, 0.5) });
      noise({ ft: 'lowpass', f: 900, at: 0.09, d: 0.03, g: 0.3 });
    },
    flip() { // カードをめくる
      noise({ f: 3800, q: 1.5, d: 0.04, g: 0.26 });
      tone({ type: 'triangle', f: 520, f2: 880, d: 0.07, g: 0.12 });
    },
    shuffle() { // シャッフル（パラパラ）
      for (let i = 0; i < 14; i++) noise({ f: rnd(2600, 4200), q: 2, at: i * 0.028, d: 0.02, g: 0.12 + i * 0.006, pan: -0.8 + i * 0.12 });
    },
    chip() { // チップが当たる音
      const f = rnd(2100, 3200);
      fm({ f, d: 0.05, g: 0.09, ratio: 1.48, idx: 1.2, pan: rnd(-0.8, 0.8) });
      noise({ f: 4200, q: 3, d: 0.015, g: 0.08 });
    },
    chipfall(dur) { // チップが大量に降る
      const n = Math.round((dur || 1) * 22);
      for (let i = 0; i < n; i++) {
        const at = Math.random() * (dur || 1);
        fm({ f: rnd(1900, 3400), at, d: 0.05, g: rnd(0.03, 0.08), ratio: 1.48, idx: 1.2, pan: rnd(-0.9, 0.9) });
      }
    },

    /* ---------- 確定・復活 ---------- */
    kyuin() {
      fm({ f: 500, f2: 3400, a: 0.16, d: 0.5, g: 0.2, ratio: 1.5, idx: 4, rev: 0.5, dly: 0.4 });
      tone({ f: 1000, f2: 6400, a: 0.16, d: 0.6, g: 0.14, rev: 0.5 });
      [88, 95, 100, 103].forEach((m, i) => bell(hz(m), 0.16 + i * 0.05, 1.4, 0.16, { pan: -0.6 + i * 0.4, dly: 0.3 }));
      sub(0.16, 0.8, 0.9); crash(0.16, 2, 0.28);
      hit([48, 60, 64, 67, 72, 76], 0.16, 0.08);
      sparkle(0.3, 1.4, 96, 16);
    },
    freeze() {
      tone({ type: 'sawtooth', f: 400, f2: 30, d: 0.55, g: 0.2, lp: 2000, lp2: 100 }); // 電源が落ちる
      noise({ ft: 'lowpass', f: 2500, f2: 80, d: 0.45, g: 0.4 });
      tone({ f: 58, f2: 36, at: 0.75, d: 0.14, g: 0.85 });
      tone({ f: 54, f2: 34, at: 0.95, d: 0.14, g: 0.55 });
      revCrash(0.9, 0.6, 0.2);
    },
    revive() {
      revCrash(0, 0.32, 0.3);
      tone({ type: 'sawtooth', f: 90, f2: 900, a: 0.3, d: 0.05, g: 0.14, lp: 3000 });
      sub(0.32, 0.9, 1.0); crash(0.32, 2, 0.3);
      clang(0.32, 0.1, 1.2);
      hit([48, 60, 64, 67, 72], 0.32, 0.1);
      [79, 84, 88, 91, 96].forEach((m, i) => bell(hz(m), 0.36 + i * 0.06, 1.0, 0.17, { pan: -0.6 + i * 0.3 }));
      fm({ f: 400, f2: 2400, at: 0.32, a: 0.1, d: 0.3, g: 0.12, ratio: 1.5, idx: 3, dly: 0.4 });
    },

    /* ---------- UI ---------- */
    button() { tone({ f: 820, d: 0.05, g: 0.13 }); noise({ f: 3000, q: 2, d: 0.02, g: 0.1 }); },
    key() { fm({ f: hz(pick([84, 86, 88, 91, 93])), d: 0.08, g: 0.1, ratio: 2, idx: 0.6 }); noise({ f: 3500, q: 2, d: 0.015, g: 0.07 }); },
    ok() { bell(hz(88), 0, 0.5, 0.16); bell(hz(95), 0.09, 0.7, 0.16); },
    error() {
      tone({ type: 'square', f: 170, d: 0.13, g: 0.16, lp: 1100 });
      tone({ type: 'square', f: 130, at: 0.17, d: 0.2, g: 0.16, lp: 1100 });
    },
  };

  function play(name, arg) {
    if (!ready()) return;
    try { SOUNDS[name](arg); } catch (e) { console.warn('sfx:' + name, e); /* 音の失敗でゲーム進行を止めない */ }
  }

  /* リール回転音。speed は 0..1（1=最高速）。
     アイテムルーレット風: コマが通過するたびに、ステージの音階からランダムな高さの「ピコ」音を鳴らす。
     高速時は連打、減速するとコマ送りに合わせて間隔が開いていき、1音ずつが長く・はっきりする。 */
  let lastNote = -1;
  function tick(speed) {
    if (!ready()) return;
    const now = ctx.currentTime;
    if (now - lastTick < 0.058) return;
    lastTick = now;
    const slow = 1 - Math.min(1, speed * 3);
    const sc = SCALES[stage];
    let n;
    do n = Math.floor(Math.random() * sc.length); while (n === lastNote); // 同じ音を続けない
    lastNote = n;
    const f = hz(sc[n] - (tickN % 3 === 0 ? 12 : 0));
    const pan = tickN % 2 ? 0.3 : -0.3;
    tickN++;
    // 矩形波のピコピコ音（8bit風）＋ごく短いクリック
    tone({ type: 'square', f, d: 0.05 + slow * 0.09, g: 0.075 + slow * 0.04, lp: 5200, pan });
    tone({ type: 'triangle', f: f * 2, d: 0.04 + slow * 0.06, g: 0.05, pan: -pan });
    noise({ f: 2600, q: 2.5, d: 0.012, g: 0.05, pan });
    if (slow > 0.5) chime(f, 0, 0.3 + slow * 0.3, 0.04 + slow * 0.06, { pan: -pan }); // 止まり際は余韻を足す
  }

  /* 回転音（ループ）: ノイズ＋ステージごとに高さの違うモーター音。speed 0 で停止。 */
  function spin(speed) {
    if (!ready()) return;
    if (!spinNodes) {
      if (speed <= 0) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
      const ng = ctx.createGain(); ng.gain.value = 0;
      src.connect(bp); bp.connect(ng); ng.connect(master);
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'sawtooth';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const og = ctx.createGain(); og.gain.value = 0;
      o1.connect(lp); o2.connect(lp); lp.connect(og); og.connect(master);
      src.start(); o1.start(); o2.start();
      spinNodes = { src, bp, ng, o1, o2, lp, og };
    }
    const t = ctx.currentTime, n = spinNodes, base = hz(ROOT[stage] - 24);
    n.ng.gain.setTargetAtTime(0.07 * speed, t, 0.05); // ルーレット音を主役にするため控えめ
    n.bp.frequency.setTargetAtTime(350 + 2300 * speed, t, 0.05);
    n.og.gain.setTargetAtTime(0.04 * speed, t, 0.05);
    n.o1.frequency.setTargetAtTime(base * (0.6 + 1.4 * speed), t, 0.06);
    n.o2.frequency.setTargetAtTime(base * (0.6 + 1.4 * speed) * (stage === 3 ? 1.498 : 1.006), t, 0.06);
    n.lp.frequency.setTargetAtTime(300 + 1400 * speed, t, 0.06);
    if (speed <= 0) {
      spinNodes = null;
      n.src.stop(t + 0.3); n.o1.stop(t + 0.3); n.o2.stop(t + 0.3);
    }
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  }
  function setStage(n) { stage = n; }

  function init(v) {
    if (typeof v === 'number') volume = v;
    // 以後のあらゆるタッチで（中断からの）復帰を試みる
    ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); });
  }

  return { init, unlock, play, tick, spin, setVolume, setStage };
})();
