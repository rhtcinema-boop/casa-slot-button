/* 実況エンジン（本物の競馬実況のように、レースの様子を見ながら途切れずにしゃべる）
   - 声は前もって録音した部品（art/voice/{c,e,x}.m4a と index.json。tools/make-voice.js で作る）をつないで話す
     例: 「先頭は3番」＋「レッドアロー」＋「リードは2馬身」
   - テンションは 3 段階: c=道中（落ち着いた） e=スタート・3〜4コーナー・直線の入口 x=残り 260m〜ゴール（最高潮）
   - 毎コマ、レースの画面（DERBY.raceView）から位置・着・進路・スローを読み、次に何を言うかを決める
     （隊列・リード・動き・コーナー・1000m の通過タイム・残り距離・「○番か！○番か！」・ゴールイン・写真判定）
   - 声は 1 本だけ（重ならない）。急ぎの言葉（ゴールインなど）は今の言葉を区切りで止めて割り込む。古くなった話題は捨てる
   - 声は「場内のスピーカー」を通した音にする（低音を切る・中高音を持ち上げる・軽く歪ませる・競馬場の残響とやまびこ）
   - 観客のざわめき（合成）を薄く流し、直線で大きく、ゴールで歓声
   - ?mute=1 / ?voice=0 / Sfx の消音では黙る。?speed=2 までは再生速度を上げて合わせ、それより速いときは使わない
   - 素材が読めないときは active=false のまま（game.js は従来の読み上げ js/voice.js に戻る）
   使い方（game.js）: Commentary.unlock() … 最初のタップ、begin(raceView, race, odds) … 発走前、caption(text) … テロップの文、finish(res) … 結果
   確認用: Commentary.log（言った文と時刻）、tools/render-commentary.html（音声ファイルに書き出して確かめる） */
window.Commentary = (function () {
  'use strict';
  const Q = typeof location !== 'undefined' ? location.search : '';
  const OFF = /[?&](mute=1|voice=0)/.test(Q);
  const BASE = 'art/voice/';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const BASHIN = 2.4; // 1 馬身 ≒ 2.4m
  // 実況を少なめに（オーナー「実況をもっと少なく」10/13）: 直線の前は発走・隊列 1 回のあと、大事な出来事だけを 6〜8 秒に 1 回ほど。
  // 3〜6 秒の間（観客と蹄の音）を空ける。直線に入ったら今までどおり途切れずに盛り上げる
  const QUIET = true;

  /* ---------- 素材（声の部品） ---------- */
  const Lib = { index: null, raw: null, buf: {}, vars: {}, ready: false, failed: false, loading: null, decoding: null };
  function fetchLib(base) {
    if (Lib.loading) return Lib.loading;
    base = base || BASE;
    Lib.loading = fetch(base + 'index.json').then((r) => r.json()).then((ix) => {
      Lib.index = ix;
      // 声の表記（VOICEVOX は「VOICEVOX:キャラクター名」の表示が必要）を起動画面の隅へ
      const cr = typeof document !== 'undefined' && document.getElementById('voiceCredit'); if (cr && ix.credit) cr.textContent = '実況の声 ' + ix.credit;
      Object.keys(ix.clips).forEach((id) => { const b = id.replace(/#\d+$/, ''); (Lib.vars[b] = Lib.vars[b] || []).push(id); });
      return Promise.all(Object.keys(ix.files).map((t) => fetch(base + ix.files[t]).then((r) => r.arrayBuffer()).then((ab) => [t, ab])));
    }).then((list) => { Lib.raw = list; return Lib; }).catch((e) => { Lib.failed = true; console.warn('実況の声を読めませんでした', e); throw e; });
    return Lib.loading;
  }
  function decodeOne(ctx, ab) { return new Promise((res, rej) => { const p = ctx.decodeAudioData(ab.slice(0), res, rej); if (p && p.then) p.then(res, rej); }); }
  // 読み込み＋音声に戻す。AAC の頭のずれ（エンコーダの遅れ）は、最初の声の立ち上がりで合わせる
  function loadLib(ctx, base) {
    if (Lib.ready) return Promise.resolve(Lib);
    if (Lib.decoding) return Lib.decoding;
    Lib.decoding = fetchLib(base).then(() => Promise.all(Lib.raw.map(([t, ab]) => decodeOne(ctx, ab).then((b) => {
      const x = b.getChannelData(0); let a = 0; while (a < x.length && Math.abs(x[a]) < 0.02) a++;
      const want = (Lib.index.onset && Lib.index.onset[t]) || 0, sh = clamp(a / b.sampleRate - want, -0.15, 0.15);
      Lib.buf[t] = { b, shift: sh };
    })))).then(() => { Lib.ready = true; return Lib; }).catch((e) => { Lib.failed = true; console.warn('実況の声を戻せませんでした', e); throw e; });
    return Lib.decoding;
  }
  // 部品 1 つ: { id, buf, off, dur, text }。clips[id] の 4 つ目があれば、その名前の音声ファイル（あとから足した部品。例 'g' → g.m4a）
  function clipById(id) {
    const c = Lib.index && Lib.index.clips[id]; if (!c) return null;
    const t = c[3] || id[0], B = Lib.buf[t]; if (!B) return null;
    return { id, buf: B.b, off: Math.max(0, c[0] + B.shift), dur: c[1], text: c[2] };
  }
  const FALL = { c: 'cex', e: 'ecx', x: 'xec' };
  const hasClip = (k) => !!(Lib.vars['c:' + k] || Lib.vars['e:' + k] || Lib.vars['x:' + k]); // その部品があるか（古い素材でも動くように）

  /* ---------- 声の出口（同時に 1 本だけ。部品を隙間なく並べて鳴らす） ---------- */
  function Out(ctx, dest, opt) {
    opt = opt || {};
    this.ctx = ctx; this.dest = dest; this.rate = opt.rate || 1;
    this.cur = null; this.lineEnd = 0; this.log = opt.log || []; this.items = [];
  }
  // line.parts を時刻 at から鳴らす。返り値は終わる時刻
  Out.prototype.say = function (line, at) {
    const ctx = this.ctx; let t = at; const items = [];
    for (const p of line.parts) {
      if (p.pause) { t += p.pause / this.rate; continue; }
      const c = p.c, src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = c.buf; src.playbackRate.value = this.rate; src.connect(g); g.connect(this.dest);
      src.start(t, c.off, c.dur);
      const it = { src, g, t0: t, t1: t + c.dur / this.rate, id: c.id, text: c.text, key: line.key };
      items.push(it); this.items.push(it);
      t = it.t1 + (p.gap || 0) / this.rate;
    }
    line.items = items; line.start = at; line.end = items.length ? items[items.length - 1].t1 : at;
    this.cur = line; this.lineEnd = line.end;
    this.log.push({ t: +at.toFixed(3), end: +line.end.toFixed(3), key: line.key, pri: line.pri, tier: line.tier, text: line.text, raceT: line.raceT });
    if (this.items.length > 200) this.items = this.items.filter((x) => x.t1 > at - 5);
    return line.end;
  };
  // 区切りで止める: いま鳴っている部品は最後まで言い、そのあとの部品は捨てる。止まる時刻を返す
  Out.prototype.trimAfter = function (now) {
    const L = this.cur; if (!L || !L.items) return now;
    let end = now;
    // つなぎの言葉（「○番と」「前は」「○番に」「1番人気の」など）で終わらないよう、その次の部品までは言う
    let keep = -1; L.items.forEach((it, k) => { if (it.t0 <= now + 0.005) keep = k; });
    while (keep >= 0 && keep + 1 < L.items.length && /:(to\.|maewa|ni\.|fav|mid2|split|timeis|winner|yuuri|lead_is)/.test(L.items[keep].id)) keep++;
    L.items.forEach((it, k) => {
      if (k <= keep) { if (it.t1 > end) end = it.t1; }
      else if (!it.dead) { it.dead = true; try { it.src.stop(it.t0); } catch (e) {} it.g.gain.setValueAtTime(0, it.t0); it.t1 = it.t0; }
    });
    this.lineEnd = Math.min(this.lineEnd, end); L.end = this.lineEnd; this.fixLog(L);
    return this.lineEnd;
  };
  // すぐ止める（25ms で音を絞る）。ゴールインのときだけ使う
  Out.prototype.cut = function (now) {
    const L = this.cur; if (!L || !L.items) return now;
    L.items.forEach((it) => {
      if (it.dead) return;
      if (it.t0 >= now) { it.dead = true; try { it.src.stop(it.t0); } catch (e) {} it.g.gain.setValueAtTime(0, it.t0); it.t1 = it.t0; }
      else if (it.t1 > now) { it.g.gain.setValueAtTime(1, now); it.g.gain.linearRampToValueAtTime(0, now + 0.025); try { it.src.stop(now + 0.03); } catch (e) {} it.t1 = now + 0.03; it.cutAt = now; }
    });
    this.lineEnd = Math.min(this.lineEnd, now + 0.03); L.end = this.lineEnd; this.fixLog(L);
    return this.lineEnd;
  };
  Out.prototype.fixLog = function (L) {
    const g = this.log[this.log.length - 1]; if (!g || g.t !== +L.start.toFixed(3)) return;
    g.end = +L.end.toFixed(3); g.text = L.items.filter((it) => !it.dead).map((it) => it.text).join(' '); g.cut = true;
  };

  /* ---------- 場内スピーカーの音（声の通り道） ----------
     声 → 低音カット 180Hz → 高域の頭打ち 7.5kHz → 3kHz を持ち上げる → 圧縮 → 軽い歪み → 乾いた音
                                                                           ├→ やまびこ（110ms・弱い繰り返し）
                                                                           └→ 競馬場の残響（1.3 秒。手作りの響き）  */
  // 決まった並びの乱数（書き出しで毎回同じ音にするため）。小さい種でも偏らないように最初にかき混ぜる
  function seeded(seed) {
    let s = (Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0 || 1;
    const f = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (let i = 0; i < 8; i++) f();
    return f;
  }
  function makeIR(ctx, sec, rnd) {
    const sr = ctx.sampleRate, n = Math.floor(sr * sec), ir = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, env = Math.pow(10, -3 * t / 1.2);            // 残響時間 1.2 秒
        const k = clamp(0.55 - t * 0.35, 0.08, 0.55);                   // あとほどこもる
        lp += k * ((rnd() * 2 - 1) - lp);
        d[i] = t < 0.018 ? 0 : lp * env * (t < 0.09 ? 0.5 : 1);          // 少し遅れて立ち上がる
      }
      // はっきりした初期反射（スタンドの屋根・向かいの建物）
      [0.031, 0.047, 0.066, 0.083, 0.12].forEach((tt, k) => { const i = Math.floor((tt + (ch ? 0.004 * (k + 1) : 0)) * sr); if (i < n) d[i] += (0.5 - k * 0.07) * (k % 2 ? -1 : 1); });
    }
    return ir;
  }
  function satCurve(k) { const n = 1024, c = new Float32Array(n), m = Math.tanh(k); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / m; } return c; }
  function buildPA(ctx, dest, rnd) {
    const inp = ctx.createGain(); inp.gain.value = 1;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180; hp.Q.value = 0.8;
    const hp2 = ctx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 160; hp2.Q.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(7500, ctx.sampleRate * 0.45); lp.Q.value = 0.7;
    const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3000; pres.Q.value = 0.9; pres.gain.value = 6;
    const box = ctx.createBiquadFilter(); box.type = 'peaking'; box.frequency.value = 1100; box.Q.value = 1.2; box.gain.value = 2.5; // ラッパのようなクセ
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -22; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.15;
    const drive = ctx.createGain(); drive.gain.value = 1.6;
    const sat = ctx.createWaveShaper(); sat.curve = satCurve(1.8); sat.oversample = '2x';
    const post = ctx.createGain(); post.gain.value = 0.37; // 声の大きさ（2026-10-13 オーナー「もう少しだけ小さく」: 0.5→0.37 ≒ -2.6dB。歓声・効果音はそのまま）
    inp.connect(hp); hp.connect(hp2); hp2.connect(lp); lp.connect(pres); pres.connect(box); box.connect(comp); comp.connect(drive); drive.connect(sat); sat.connect(post);
    const dry = ctx.createGain(); dry.gain.value = 0.9; post.connect(dry); dry.connect(dest);
    // やまびこ（遠くのスピーカーから遅れて届く声）
    const dl = ctx.createDelay(1); dl.delayTime.value = 0.11;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'bandpass'; dlf.frequency.value = 1800; dlf.Q.value = 0.6;
    const fb = ctx.createGain(); fb.gain.value = 0.18;
    const dlo = ctx.createGain(); dlo.gain.value = 0.22;
    post.connect(dl); dl.connect(dlf); dlf.connect(fb); fb.connect(dl); dlf.connect(dlo);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = 0.35; dlo.connect(pan); pan.connect(dest); } else dlo.connect(dest);
    // 残響
    const conv = ctx.createConvolver(); conv.normalize = true; conv.buffer = makeIR(ctx, 1.3, rnd);
    const wet = ctx.createGain(); wet.gain.value = 0.32;
    post.connect(conv); conv.connect(wet); wet.connect(dest);
    return inp;
  }

  /* ---------- 観客（合成のざわめきと歓声） ---------- */
  function biquadBP(f, q, sr) { // 2 次のバンドパス（係数）
    const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    return { b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - al) / a0 };
  }
  function makeBabble(ctx, sec, rnd) {
    const sr = Math.min(16000, ctx.sampleRate), /* 軽くするため 16kHz で作る（再生時に合わせてくれる） */ n = Math.floor(sr * sec), fade = Math.floor(sr * 0.6), len = n + fade;
    const out = [new Float32Array(len), new Float32Array(len)];
    const talkers = 18;
    for (let k = 0; k < talkers; k++) {
      const pan = rnd(), gl = Math.sqrt(1 - pan), gr = Math.sqrt(pan), f1 = 350 + rnd() * 500, f2 = 1000 + rnd() * 1300;
      const A = biquadBP(f1, 2.2, sr), B = biquadBP(f2, 3, sr);
      let ax1 = 0, ax2 = 0, ay1 = 0, ay2 = 0, bx1 = 0, bx2 = 0, by1 = 0, by2 = 0, env = 0, target = 0, nextSyl = 0;
      const amp = 0.5 + rnd() * 0.8, syl = 3 + rnd() * 3;
      for (let i = 0; i < len; i++) {
        if (i >= nextSyl) { target = rnd() < 0.78 ? (0.3 + rnd() * 0.7) : 0; nextSyl = i + Math.floor(sr / syl * (0.6 + rnd() * 0.8)); }
        env += (target - env) * 0.0016;
        const x = rnd() * 2 - 1;
        const ya = A.b0 * x + A.b2 * ax2 - A.a1 * ay1 - A.a2 * ay2; ax2 = ax1; ax1 = x; ay2 = ay1; ay1 = ya;
        const yb = B.b0 * x + B.b2 * bx2 - B.a1 * by1 - B.a2 * by2; bx2 = bx1; bx1 = x; by2 = by1; by1 = yb;
        const v = (ya + 0.5 * yb) * env * amp;
        out[0][i] += v * gl; out[1][i] += v * gr;
      }
    }
    // 低いうなり（遠くの人の声・風）
    let l1 = 0, l2 = 0;
    for (let i = 0; i < len; i++) { l1 += 0.02 * ((rnd() * 2 - 1) - l1); l2 += 0.02 * ((rnd() * 2 - 1) - l2); out[0][i] += l1 * 1.2; out[1][i] += l2 * 1.2; }
    // つなぎ目が分からないように、終わりを頭に重ねる
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch), o = out[ch];
      for (let i = 0; i < n; i++) d[i] = o[i];
      for (let i = 0; i < fade; i++) { const a = i / fade; d[i] = o[i] * a + o[n + i] * (1 - a); }
      let s = 0; for (let i = 0; i < n; i++) s += d[i] * d[i];
      const g = 0.1 / Math.sqrt(s / n + 1e-12); for (let i = 0; i < n; i++) d[i] *= g;   // RMS 0.1 にそろえる
    }
    return buf;
  }
  function makeCheer(ctx, sec, rnd) {
    const sr = Math.min(16000, ctx.sampleRate), n = Math.floor(sr * sec), buf = ctx.createBuffer(2, n, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const env = (t) => Math.min(1, t / 0.35) * (t < 1.2 ? 1 : Math.exp(-(t - 1.2) / 1.4));
    // どよめき（広い帯域のざわめきが一気に上がる）
    const A = biquadBP(700, 0.7, sr), B = biquadBP(2200, 0.9, sr);
    let s = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let i = 0; i < n; i++) {
      const e = env(i / sr);
      for (let ch = 0; ch < 2; ch++) {
        const x = rnd() * 2 - 1, a = s[ch], b = s[ch + 2];
        const ya = A.b0 * x + A.b2 * a[1] - A.a1 * a[2] - A.a2 * a[3]; a[1] = a[0]; a[0] = x; a[3] = a[2]; a[2] = ya;
        const yb = B.b0 * x + B.b2 * b[1] - B.a1 * b[2] - B.a2 * b[3]; b[1] = b[0]; b[0] = x; b[3] = b[2]; b[2] = yb;
        (ch ? R : L)[i] += (ya + 0.6 * yb) * e;
      }
    }
    // 拍手（短い破裂音をたくさん）
    const claps = Math.floor(sec * 260);
    for (let k = 0; k < claps; k++) {
      const t0 = 0.25 + rnd() * (sec - 0.4), i0 = Math.floor(t0 * sr), a = (0.15 + rnd() * 0.35) * env(t0), p = rnd(), len = Math.floor(sr * (0.006 + rnd() * 0.01));
      let prev = 0;
      for (let i = 0; i < len && i0 + i < n; i++) { const x = rnd() * 2 - 1, hpv = x - prev; prev = x; const v = hpv * a * Math.exp(-i / (len * 0.35)); L[i0 + i] += v * (1 - p); R[i0 + i] += v * p; }
    }
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const g = 0.9 / (pk || 1); for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
    return buf;
  }
  function Crowd(ctx, dest, rnd) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(dest);
    this.cheerOut = ctx.createGain(); this.cheerOut.gain.value = 1; this.cheerOut.connect(dest);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(6000, ctx.sampleRate * 0.45); lp.connect(this.out);
    this.bus = lp;
    this.babble = makeBabble(ctx, 7, rnd); this.cheerBuf = makeCheer(ctx, 5, rnd);
    this.src = null; this.level = 0;
  }
  Crowd.prototype.start = function (at, lvl) {
    if (this.src) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.babble; s.loop = true; s.connect(this.bus); s.start(at); this.src = s;
    this.out.gain.setValueAtTime(0, at); this.out.gain.linearRampToValueAtTime(lvl, at + 1.5); this.level = lvl;
  };
  Crowd.prototype.set = function (lvl, at, tc) { if (!this.src || Math.abs(lvl - this.level) < 0.004) return; this.level = lvl; this.out.gain.setTargetAtTime(lvl, at, tc || 0.6); };
  Crowd.prototype.cheer = function (at, vol) {
    // 歓声はざわめきの音量とは別に鳴らす
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = this.cheerBuf; g.gain.value = vol; s.connect(g); g.connect(this.cheerOut); s.start(at);
  };
  Crowd.prototype.stop = function (at, fade) {
    if (!this.src) return; const s = this.src; this.src = null;
    this.out.gain.cancelScheduledValues(at); this.out.gain.setTargetAtTime(0, at, (fade || 3) / 4); try { s.stop(at + (fade || 3) + 0.5); } catch (e) {}
  };

  /* ---------- 実況の台本を決める係 ---------- */
  // race: エンジンのレース、opt: { fav: 人気順の馬の添字の配列, rnd, timeScale }
  function Director(race, opt) {
    opt = opt || {};
    this.race = race; this.n = race.horses.length; this.dist = race.dist; this.rnd = opt.rnd || Math.random;
    this.fav = opt.fav || [];
    this.pend = []; this.used = {}; this.flags = {}; this.named = {}; this.rank = null; this.rankAt = {}; this.moveAt = -9; this.kicked = {};
    this.leader = -1; this.candL = -1; this.candSince = 0; this.leaderAt = {}; this.hanaIdx = -1;
    this.goalAt = 0; this.winner = -1; this.lastSay = 0; this.orderStep = 0; this.fillStep = 0; this.xStep = 0; this.nextAt = 0; this.ended = false;
    this.speedRate = opt.rate || 1;
    this.sideSaid = {}; this.sideStep = 0; this.lowAt = {}; this.quietUntil = 0; this.fieldSaid = 0;
  }
  const NAMEIDX = {};
  function nameKey(name) { if (!(name in NAMEIDX)) { const pool = (window.Engine && Engine.POOL) || []; NAMEIDX[name] = pool.findIndex((p) => p.name === name); } return NAMEIDX[name]; }
  // 1 本の文を作る道具
  Director.prototype.line = function (pri, tier, key) {
    const D = this, L = { pri, tier, key, parts: [], text: '', dur: 0 };
    const gapOf = { c: 0.07, e: 0.04, x: 0.015 };
    L.add = function (k, opt) {
      opt = opt || {}; const tr = opt.tier || tier;
      let id = null;
      for (const t of FALL[tr]) { const vs = Lib.vars[t + ':' + k]; if (vs && vs.length) { id = D.pickVar(vs, opt.v); break; } }
      const c = id && clipById(id); if (!c) return L;
      const gap = opt.gap != null ? opt.gap : gapOf[tr];
      L.parts.push({ c, gap }); L.text += (L.text ? ' ' : '') + c.text; L.dur += c.dur + gap;
      const m = /^(lead_is|hana|leadchg|kawa|nuke)\.(\d)/.exec(k); if (m) D.calledL = Number(m[2]) - 1; // 先頭として伝えた馬
      return L;
    };
    L.pause = function (s) { L.parts.push({ pause: s }); L.dur += s; return L; };
    L.name = function (i, opt) { const k = nameKey(D.race.horses[i].name); if (k >= 0) { L.add('name.' + k, opt); D.named[i] = D.now; } return L; };
    return L;
  };
  Director.prototype.pickVar = function (vs, v) {
    if (vs.length === 1) return vs[0];
    if (typeof v === 'number') return vs[clamp(v, 0, vs.length - 1)];
    // いちばん長く使っていないもの（同じなら運）
    let best = null, bu = Infinity;
    vs.forEach((id) => { const u = (this.used[id] || -99) + this.rnd() * 0.01; if (u < bu) { bu = u; best = id; } });
    this.used[best] = this.now || 0; return best;
  };
  Director.prototype.push = function (key, pri, now, life, data) {
    this.pend = this.pend.filter((p) => p.key !== key);
    this.pend.push({ key, pri, at: now, exp: now + life, data: data || {} });
  };
  // 状態から並び・差などを出す
  Director.prototype.derive = function (st) {
    const n = this.n, dist = this.dist, pos = st.pos, fin = st.fin;
    const order = []; for (let i = 0; i < n; i++) order.push(i);
    order.sort((a, b) => (fin[a] && fin[b] ? fin[a] - fin[b] : fin[a] ? -1 : fin[b] ? 1 : pos[b] - pos[a]));
    const L = order[0], gone = Math.min(1, pos[L]) * dist, remain = dist - gone;
    const gapM = order.map((i, k) => (k ? (Math.min(1.05, pos[order[k - 1]]) - Math.min(1.05, pos[i])) * dist : 0));
    const rankOf = []; order.forEach((i, k) => (rankOf[i] = k));
    const tier = st.t < 4.5 ? 'e' : remain > 620 ? 'c' : remain > 260 ? 'e' : 'x';
    return { order, L, gone, remain, gapM, rankOf, tier };
  };
  const PRI = { goal: 10, start: 9, won: 9, photo: 9, rem200: 8, leadchgX: 8, food: 7, straight: 7, start2: 7, rem100: 7, c4: 6, split: 6, leadchg: 6, hana: 6, move: 6, kick: 5, c3: 5, c12: 4, back: 4, boostgo: 4, recap: 5, result: 6, gate: 8, ready: 8 }; // gate: ゲートイン（枠入り）の文はみな同じ優先度で順に言う

  // 毎コマ: 出来事を見つけて話題に積み、声が空いたら次の文を言う
  Director.prototype.tick = function (st, now, out) {
    this.now = now;
    if (this.ended) return;
    if (st.phase === 'run' || st.phase === 'replay' || st.phase === 'winner' || st.phase === 'done') this.watch(st, now, out);
    this.pend = this.pend.filter((p) => p.exp > now);
    // 割り込み: 大事な話題が来たのに、今の文の優先度が低いとき
    if (now < out.lineEnd && out.cur) {
      const top = this.pend.reduce((a, p) => (this.stale(p) ? a : !a || p.pri > a.pri ? p : a), null);
      if (top && top.pri >= 6 && (top.pri >= 7 || !this.sparse(st)) && out.cur.pri <= top.pri - (top.pri >= 7 ? 2 : 3) && !out.cur.trimmed) { out.cur.trimmed = true; this.nextAt = out.trimAfter(now) + 0.04; }
    }
    if (now < this.nextAt - 0.05 || now < out.lineEnd - 0.05) return;
    const at = Math.max(now + 0.02, this.nextAt, out.lineEnd);
    const L = this.choose(st, now, at);
    if (!L) { this.nextAt = now + 0.1; return; }
    if (!L.parts.length) { this.nextAt = now + 0.05; return; }
    L.raceT = +st.t.toFixed(2);
    const end = out.say(L, at);
    this.lastSay = end;
    // 直線の前は間を空ける: 次の文の始まりまで 6.5 秒（大事な話題だけは別。choose を参照）
    if (this.sparse(st) && !/^(start|start2|wait)$/.test(L.key)) this.quietUntil = at + 6.5;
    const gapAfter = { c: 0.32, e: 0.16, x: 0.05 }[L.tier] + (L.rest || 0);
    this.nextAt = end + gapAfter;
  };

  // 出来事を見つける
  Director.prototype.watch = function (st, now, out) {
    const d = this.derive(st), F = this.flags, dist = this.dist, race = this.race;
    this.d = d;
    if (st.phase !== 'run') return;
    const anyFin = st.fin.some((x) => x > 0);
    // スタート
    if (!F.start && st.t > 0.02) { F.start = 1; this.push('start', PRI.start, now, 1.5); this.push('start2', PRI.start2, now, 4); }
    // ゴールイン（その瞬間に割り込む）
    if (anyFin && !F.goal) {
      F.goal = 1; this.goalAt = now; this.winner = d.order[0];
      out.cut(now);
      const L = this.line(PRI.goal, 'x', 'goal').add('goal'); L.raceT = +st.t.toFixed(2);
      const end = out.say(L, now + 0.005);
      this.pend = []; this.nextAt = end + 0.06; this.push('won', PRI.won, now, 6);
      if (this.onGoal) this.onGoal(now);
      return;
    }
    if (F.goal) return;
    // 先頭の入れ替わり（0.5 秒続いたら本物）
    // 先頭の候補: 今の先頭より 0.4m 以上前に出たときだけ（同じくらいで行ったり来たりするのを数えない）
    const lead = this.candL >= 0 ? this.candL : d.L;
    if (d.L !== this.candL && (this.candL < 0 || (st.pos[d.L] - st.pos[lead]) * dist > 0.4 || d.remain < 300)) { this.candL = d.L; this.candSince = st.t; }
    if (this.candL !== this.leader && st.t - this.candSince > (d.remain < 300 ? 0.25 : 0.6) && st.t > 2.2) {
      const prev = this.leader; this.leader = this.candL;
      if (prev < 0 || !F.hana) { F.hana = 1; this.hanaIdx = this.leader; if (!QUIET) this.push('hana', PRI.hana, now, 4, { i: this.leader }); } // 少なめの実況では、最初の隊列の文で先頭も言う
      // 道中の先頭の入れ替わりは 10 秒に 1 回まで（馬群が固まっていて先頭がよく替わるので、先頭の話ばかりにならないように）
      else if (QUIET && d.remain > 400 && d.gapM[1] < 1.0) { /* 直線の前は、はっきり前に出たときだけ（1m 以上） */ }
      else if (d.remain < 620 || now - (this.leadchgAt || -99) > 10) { this.leadchgAt = now; this.push('leadchg', d.remain < 420 ? PRI.leadchgX : PRI.leadchg, now, d.remain < 420 ? 1.6 : 4, { i: this.leader, prev }); }
    }
    // 区間ごとの決まり文句
    const sec = (key, cond, life, data) => { if (!F[key] && cond) { F[key] = 1; this.push(key, PRI[key], now, life, data); } };
    if (dist >= 1600) {
      sec('c12', d.gone >= 390 && d.gone < 560, 5);
      sec('back', d.gone >= 610 && d.gone < 760, 5);
      if (!F.split && d.gone >= 1000) { F.split = 1; const v = Math.max(5, st.v[d.L] || 16), ts = st.t - (d.gone - 1000) / v; this.push('split', PRI.split, now, 6, { t: ts }); }
    }
    else if (dist >= 1200) sec('back', d.gone >= 215 && d.gone < 380, 5); // 1200m: 1・2 コーナーを回って向こう正面へ
    const short = dist <= 600; // 500m: 4 コーナーの途中から発走（3 コーナーは通らない。4 コーナーは「すぐに最後の直線」）
    if (!short) sec('c3', d.remain <= 610 && d.remain > 480, QUIET ? 7 : 4);
    sec('c4', short ? d.remain <= 455 && d.remain > 405 : d.remain <= 470 && d.remain > 410, 3);
    sec('straight', d.remain <= 400 && d.remain > 300, 2.5);
    sec('rem200', d.remain <= 205 && d.remain > 140, 1.4);
    sec('rem100', d.remain <= 105 && d.remain > 50, 1.0);
    if (this.pace == null && d.gone >= 300) { const v = Math.max(5, st.v[d.L] || 17), t300 = st.t - (d.gone - 300) / v; this.pace = t300 < 17.15 ? 1 : t300 > 17.6 ? 0 : 2; } // ペース（1000m の 300m 通過: 速い 17.1 秒未満／落ち着いた 17.6 秒より遅い）
    if (d.remain <= 610 && !this.leaderAt[600]) this.leaderAt[600] = d.L + 1;
    if (d.remain <= 400 && !this.leaderAt[400]) this.leaderAt[400] = d.L + 1;
    if (d.remain <= 200 && !this.leaderAt[200]) this.leaderAt[200] = d.L + 1;
    // 仕掛け（差し・追込が動き出す）
    for (let i = 0; i < this.n; i++) {
      const ty = race.horses[i].type;
      if (!this.kicked[i] && !st.fin[i] && ((ty === 'sashi' && st.pos[i] > 0.55) || (ty === 'oikomi' && st.pos[i] > 0.68))) { this.kicked[i] = 1; if (d.rankOf[i] > 0 && d.remain > 120 && !(QUIET && d.remain > 400)) this.push('kick', d.remain < 450 ? PRI.move : PRI.kick, now, 2.5, { i }); }
    }
    // 後方 2 頭にいた時刻（「後ろから大きく上がってきた」を見分ける）
    d.order.forEach((i, r) => { if (r >= this.n - 2) this.lowAt[i] = now; });
    // 順位を上げた馬（上位 3 頭に入ってきた）。直線の前は、後方 2 頭から 8 秒以内に上がってきた大きな動きだけ
    if (this.rank) {
      for (let i = 0; i < this.n; i++) {
        const r0 = this.rank[i], r1 = d.rankOf[i];
        if (r1 < r0 && r1 <= 2 && r1 > 0 && d.remain < 720 && d.remain > 60 && now - this.moveAt > (d.remain > 260 ? 4.5 : 2.2) && !(QUIET && d.remain > 400 && !(now - (this.lowAt[i] || -99) < 8))) { // 道中は 4.5 秒に 1 回まで
          const j = d.order[r1 + 1]; // 抜かれた馬
          const outside = st.lane ? st.lane[i] > st.lane[j] + 0.6 : (i > j);
          this.moveAt = now; this.push('move', PRI.move, now, 1.8, { i, j, outside });
        }
      }
    }
    this.rank = d.rankOf.slice();
  };

  // 次に言う文を選ぶ（話題が無ければ、場面に合ったつなぎの文）
  Director.prototype.choose = function (st, now, at) {
    const d = this.d || this.derive(st);
    const sparse = this.sparse(st), quiet = sparse && now < (this.quietUntil || 0);
    if (this.pend.length) {
      this.pend.sort((a, b) => b.pri - a.pri || a.at - b.at);
      // 直線の前で間を空けている間は、優先度 7 以上（応援・直線・発走）と 4 コーナーだけ
      const ok = (p) => !quiet || p.pri >= 7 || p.key === 'c4';
      for (let k = 0; k < this.pend.length; k++) {
        const p = this.pend[k]; if (!ok(p)) continue;
        this.pend.splice(k--, 1);
        const L = this.build(p, st, d, now, at);
        if (L) return L;
      }
    }
    if (!(st.phase === 'run' && this.flags.start && !this.flags.goal)) return null;
    if (sparse) {
      // 直線の前のつなぎ: 最初の 12 秒に隊列を 1 回。あとは 5.5 秒黙ったときだけ（観客と蹄の音を聞かせる）
      if (!this.fieldSaid) { if (st.t < 4.5) return null; this.fieldSaid = 1; return this.fieldLine(st, d, d.tier, now); }
      if (quiet || now - this.lastSay < 5.5) return null;
    }
    return this.filler(st, d, now, at);
  };
  // 話題 → 文
  Director.prototype.build = function (p, st, d, now) {
    const D = this, race = this.race, h = race.horses, tier = d.tier, k = p.key, x = p.data;
    const N = (i) => 'num.' + (i + 1);
    switch (k) {
      case 'gate': return this.line(PRI.gate, 'c', k).add('gatein');
      // ゲートイン（枠入り）: 「各馬ゲートインを開始しました」「奇数番の馬から順にゲートへ」「1番 ○○ 入りました」「続いて偶数番の馬がゲートへ」「最後に6番が入って」
      case 'gstart': return this.line(PRI.gate, 'c', k).add(hasClip('gstart') ? 'gstart' : 'gatein', hasClip('gstart') ? { v: 0 } : {});
      case 'gkisu': return hasClip('gkisu') ? this.line(PRI.gate, 'c', k).add('gkisu') : null;
      case 'gin': return hasClip('hairi') ? this.line(PRI.gate, 'c', k).add('num.' + (x.i + 1)).name(x.i).add('hairi', { v: 0 }) : null;
      case 'gguu': return hasClip('gguu') ? this.line(PRI.gate, 'c', k).add('gguu') : null;
      case 'glast': return hasClip('glast.' + (x.i + 1)) ? this.line(PRI.gate, 'c', k).add('glast.' + (x.i + 1)) : null;
      case 'ready': return this.line(PRI.ready, 'c', k).add('ready');
      case 'start': { const L = this.line(PRI.start, 'e', k).add('start'); L.rest = -0.1; return L; }
      case 'start2': {
        const L = this.line(PRI.start2, 'e', k).add('start2');
        if (!QUIET && this.rnd() < 0.5) L.add('hana_q');
        // 発走地点: 500m は 4 コーナーの途中、1000m は向こう正面、1200m（ゴール板の前）・1600m はスタンド前
        if (this.dist <= 600) { if (hasClip('c4st')) L.add('c4st', { tier: 'c' }); }
        else L.add(this.dist >= 1600 ? 'stand' : this.dist >= 1200 ? (hasClip('standst') ? 'standst' : 'stand') : 'back1000', { tier: 'c' });
        return L;
      }
      case 'hana': {
        const i = d.L; const L = this.line(PRI.hana, st.t < 9 ? 'e' : 'c', k).add('hana.' + (i + 1)).name(i);
        return L;
      }
      case 'leadchg': {
        const i = x.i; if (this.stale(p)) return null;
        const L = this.line(p.pri, tier === 'c' ? 'e' : tier, k);
        if (tier === 'x' && x.prev >= 0 && d.order[1] === x.prev) L.add('kawa.' + (i + 1)); else L.add('leadchg.' + (i + 1));
        L.name(i); return L;
      }
      case 'c12': return this.line(PRI.c12, 'c', k).add('c12').add('lead_is.' + (d.L + 1)).name(d.L).add('lead_m', { v: this.marginV(d.gapM[1]) });
      case 'back': { const L = this.line(PRI.back, 'c', k).add('back'); this.orderStep = 0; return L; }
      case 'split': {
        const t = x.t, m = Math.floor(t / 60), s = Math.floor(t % 60), dec = Math.floor((t * 10) % 10);
        const L = this.line(PRI.split, 'c', k).add('split');
        if (m) L.add('min1', { gap: 0.02 });
        L.add('sec.' + s, { gap: 0.0 }).add('dec.' + dec, { gap: 0.18 });
        L.add('pace', { v: t < 58.0 ? 1 : t > 59.3 ? 2 : 0 }); // このゲームの 1600m の通過は 57.9〜59.5 秒（中央 58.6）
        return L;
      }
      case 'c3': {
        // 馬群が固まっていれば「3コーナーで馬群が凝縮」＋前の 2 頭
        if (hasClip('gyoshuku') && this.spreadM(st, d) < BASHIN * 4.5) { this.frontAt = now; return this.line(PRI.c3, 'e', k).add('gyoshuku', { v: 0 }).add('maewa').add('to.' + (d.L + 1)).add('num.' + (d.order[1] + 1)); }
        const L = this.line(PRI.c3, 'e', k).add('c3').add('lead_is.' + (d.L + 1)).name(d.L); if (d.gapM[1] > BASHIN * 0.8) L.add('lead_m', { v: this.marginV(d.gapM[1]) }); return L; }
      case 'c4': {
        if (this.dist <= 600 && hasClip('soon')) return this.line(PRI.c4, 'e', k).add('soon').add('lead_is.' + (d.L + 1)).name(d.L); // 500m
        const L = this.line(PRI.c4, 'e', k).add('c4');
        const mv = this.mover(st, d); if (mv >= 0) L.add((st.lane && st.lane[mv] > st.lane[d.L] + 1 ? 'outside.' : 'moved.') + (mv + 1)); else L.add('lead_is.' + (d.L + 1)).name(d.L);
        return L;
      }
      case 'straight': {
        const L = this.line(PRI.straight, 'e', k).add('straight');
        // 進路が横に広がっていれば「横に大きく広がった」
        if (st.lane && hasClip('hirogaru')) { const ls = d.order.filter((i) => !st.fin[i]).map((i) => st.lane[i]); if (Math.max.apply(null, ls) - Math.min.apply(null, ls) > 4.5) return L.add('hirogaru', { v: 1 }).add('lead_is.' + (d.L + 1)); }
        L.add('lead_is.' + (d.L + 1)).name(d.L);
        if (d.gapM[1] > BASHIN * 1.5) L.add('lead_m', { v: this.marginV(d.gapM[1]) });
        return L;
      }
      case 'rem200': {
        const L = this.line(PRI.rem200, 'x', k).add('rem200');
        if (d.remain < 60) return L;
        L.add('lead_is.' + (d.L + 1)); if (d.gapM[1] < BASHIN * 1.2) L.add('chase.' + (d.order[1] + 1)); return L;
      }
      case 'rem100': return this.line(PRI.rem100, 'x', k).add('rem100');
      case 'kick': { const i = x.i; if (st.fin[i]) return null; const L = this.line(p.pri, tier === 'c' ? 'c' : 'e', k).add((tier === 'c' ? 'moved.' : 'kick.') + (i + 1)); if (tier !== 'x' && now - (this.named[i] || -99) > 6) L.name(i); return L; }
      case 'move': {
        const i = x.i; if (d.rankOf[i] > 2 || st.fin[i]) return null;
        const t2 = tier === 'c' ? 'e' : tier;
        const L = this.line(p.pri, t2, k).add((x.outside ? 'outside.' : 'inside.') + (i + 1));
        if (tier !== 'x' && now - (this.named[i] || -99) > 5) L.name(i);
        return L;
      }
      case 'food': {
        const i = x.i, t2 = tier;
        const L = this.line(PRI.food, t2, k).add('ni.' + (i + 1)).add('food', { v: x.key === 'corn' ? 1 : x.key === 'daikon' ? 2 : 0 });
        if (x.key !== 'daikon' && !this.sparse(st)) this.push('boostgo', PRI.boostgo, now + 0.8, 3, { i });
        return L;
      }
      case 'boostgo': { const i = x.i; if (st.fin[i]) return null; return this.line(PRI.boostgo, tier === 'c' ? 'e' : tier, k).add('num.' + (i + 1)).add('boostgo'); }
      case 'won': {
        // 2 着の馬が入るまで（最大 0.5 秒）待つ
        const fin = st.fin, w = this.winner, o = d.order, f1 = fin[w], f2 = fin[o[1]];
        if (!f2 && now - this.goalAt < 0.5) { this.push('won', PRI.won, p.at, 6, x); return this.line(0, 'x', 'wait'); }
        const close = f2 ? f2 - f1 < 0.05 : false;
        this.photo = close;
        if (close) { this.push('recap', PRI.recap, now, 12); return this.line(PRI.photo, 'x', 'photo').add('photo', { v: 0 }).add('photo', { v: 1 }); }
        const L = this.line(PRI.won, 'x', k).add(N(w)).name(w);
        const ty = h[w].type, led400 = this.leaderAt[400] === w + 1, led200 = this.leaderAt[200] === w + 1;
        L.add('won', { v: !led200 ? 1 : (led400 && (this.hanaIdx === w || ty === 'nige')) ? 0 : (this.rnd() < 0.5 ? 2 : 3) });
        this.push('recap', PRI.recap, now, 12);
        return L;
      }
      case 'recap': {
        if (st.phase === 'run' && now - this.goalAt < 2.2) { this.push('recap', PRI.recap, p.at, 12); return this.line(0, 'c', 'wait'); }
        const w = this.winner, o = d.order;
        if (this.photo) { const L = this.line(PRI.recap, 'e', k).add('yuuri').add('ka.' + (w + 1), { tier: 'x' }); return L; }
        const L = this.line(PRI.recap, 'e', k).add('winner').add(N(w)).name(w);
        if (o[1] != null) L.add('second2.' + (o[1] + 1), { tier: 'c' });
        return L;
      }
      case 'result': {
        const t = x.t, m = Math.floor(t / 60), s = Math.floor(t % 60), dec = Math.floor((t * 10 + 1e-6) % 10);
        const L = this.line(PRI.result, 'c', k).add('timeis');
        if (m) L.add('min1', { gap: 0.02 });
        L.add('sec.' + s, { gap: 0 }).add('dec.' + dec);
        return L;
      }
    }
    return null;
  };
  // もう言う意味がない話題か（先頭が替わったという話なのに、その馬をもう先頭として伝えた・もう先頭でない など）
  Director.prototype.stale = function (p) {
    const d = this.d; if (!d) return false;
    if (p.key === 'leadchg') return d.L !== p.data.i || this.calledL === p.data.i;
    if (p.key === 'move') return d.rankOf[p.data.i] > 2;
    if (p.key === 'ready' || p.key === 'gate' || /^g(start|kisu|in|guu|last)$/.test(p.key)) return !!this.flags.start; // 発走したら発走前の文は言わない
    return false;
  };
  // 着差（m）→ 「リードは○馬身」の番号
  Director.prototype.marginV = function (m) { const b = m / BASHIN; return b < 0.75 ? 0 : b < 1.5 ? 1 : b < 2.5 ? 2 : b < 3.5 ? 3 : b < 4.5 ? 4 : 5; };
  // 直線（残り 400m）の前で、実況を少なめにする区間か
  Director.prototype.sparse = function (st) { const d = this.d; return QUIET && st.phase === 'run' && !!this.flags.start && !this.flags.goal && !!d && d.remain > 400; };
  // 先頭から最後方までの差（m）
  Director.prototype.spreadM = function (st, d) { const o = d.order.filter((i) => !st.fin[i]); return o.length > 1 ? (Math.min(1, st.pos[o[0]]) - Math.min(1, st.pos[o[o.length - 1]])) * this.dist : 0; };
  // 全体の隊列: 「先頭は1番、半馬身差で5番、その後ろ4番と2番が並んで、1馬身離れて3番、最後方に6番」
  Director.prototype.fieldLine = function (st, d, tier, now) {
    let pairSaid = false;
    const o = d.order, n = this.n, L = this.line(2, tier, 'field'), gv = (g) => (g / BASHIN < 1.5 ? 0 : g / BASHIN < 2.5 ? 1 : 2);
    L.add('lead_is.' + (o[0] + 1)); if (now - (this.named[o[0]] || -99) > 12) L.name(o[0]);
    for (let r = 1; r < n; r++) {
      const i = o[r], g = d.gapM[r], last = r === n - 1;
      if (r === 1) {
        // 「並んで」は 1 本の文に 1 回まで（pairSaid = 'n' のあとの 2 頭は「○番と○番」）
        if (g < 0.6) { L.add('narande.' + (i + 1)); pairSaid = 'n'; } else if (g < BASHIN * 0.75) L.add('hansa.' + (i + 1)); else if (g < BASHIN * 1.5) L.add('sa1.' + (i + 1)); else L.add('gap', { v: gv(g) }).add('second.' + (i + 1));
        continue;
      }
      if (g > BASHIN * 0.75) L.add('gap', { v: gv(g) });
      const j = r + 1 < n ? o[r + 1] : -1;
      if (j >= 0 && d.gapM[r + 1] < 0.8 && pairSaid !== true) { L.add('to.' + (i + 1)).add((pairSaid === 'n' ? 'num.' : 'ganara.') + (j + 1)); pairSaid = true; r++; continue; } // 2 頭が並んでいる（1 回だけ。「並んで」を言った後は「○番と○番」）
      // 位置の言葉は順位で変える（「並んで」ばかりにならないように）: 3 番手=その後ろ、4 番手=中団に、5 番手=後方から、最後=最後方に
      L.add((last ? 'last.' : g > BASHIN * 0.75 ? 'num.' : r === 2 ? 'next.' : r === 3 ? 'mid.' : 'rear.') + (i + 1));
    }
    return L;
  };
  // 馬群の形: 「馬群は一団、先頭から最後方まで4馬身ほど」
  Director.prototype.shapeLine = function (st, d, tier) {
    const sp = this.spreadM(st, d) / BASHIN, L = this.line(2, tier, 'shape');
    if (tier === 'e' && sp < 4 && hasClip('gyoshuku')) return L.add('gyoshuku', { v: 1 });
    if (sp < 4) L.add('form', { v: 1 }); else if (sp > 7) L.add('form', { v: 2 });
    const steps = [2, 3, 4, 5, 6, 8]; let v = 0; steps.forEach((s, k) => { if (Math.abs(s - sp) < Math.abs(steps[v] - sp)) v = k; });
    return L.add('span', { v, tier: 'c' });
  };
  // 馬群の中の 1 頭: 外から押し上げる・内で脚をためる・外を回る・中団の 2 頭
  Director.prototype.sideLine = function (st, d, tier, now) {
    const o = d.order, n = this.n, h = this.race.horses, L0 = d.L, run = o.filter((i) => !st.fin[i]);
    const lanes = st.lane ? run.map((i) => st.lane[i]) : null, minL = lanes ? Math.min.apply(null, lanes) : 0, maxL = lanes ? Math.max.apply(null, lanes) : 0;
    const cands = [];
    if (st.lane) {
      o.forEach((i, r) => { if (r >= 2 && !st.fin[i] && st.lane[i] > minL + 2 && st.v[i] > st.v[L0] * 1.004) cands.push(['oshiage', i]); });
      o.forEach((i, r) => { if (r >= 2 && r < n - 1 && (h[i].type === 'sashi' || h[i].type === 'oikomi') && st.lane[i] < minL + 0.9 && tier === 'c') cands.push(['tame', i]); });
      o.forEach((i, r) => { if (r >= 1 && st.lane[i] >= maxL - 0.01 && st.lane[i] > minL + 3 && tier === 'c') cands.push(['sotomawari', i]); });
    }
    // 同じ種類・同じ馬が続かないように回す
    const pick = cands.filter((c) => now - (this.sideSaid[c[0] + c[1]] || -99) > 15);
    if (pick.length) { const c = pick[(this.sideStep++) % pick.length]; this.sideSaid[c[0] + c[1]] = now; const L = this.line(2, tier, 'side').add(c[0] + '.' + (c[1] + 1)); if (now - (this.named[c[1]] || -99) > 10) L.name(c[1]); return L; }
    if (tier === 'c' && n >= 5) return this.line(2, tier, 'side').add('mid2').add('to.' + (o[2] + 1)).add('num.' + (o[3] + 1)); // 「中団に3番と5番」
    return null;
  };
  // いちばん勢いよく上がってきている馬（先頭以外）
  Director.prototype.mover = function (st, d) {
    let best = -1, bv = 0;
    d.order.forEach((i, r) => { if (r === 0 || st.fin[i]) return; const v = st.v[i] / Math.max(1, st.v[d.L]); if (v > 1.015 && v > bv) { bv = v; best = i; } });
    return best;
  };
  // つなぎの文（話題が無いとき）
  Director.prototype.filler = function (st, d, now, at) {
    const D = this, h = this.race.horses, o = d.order, L_ = d.L, tier = d.tier;
    const num = (i) => 'num.' + (i + 1);
    const needName = (i, sec) => now - (this.named[i] || -99) > sec;
    // ゴール直前: 残り時間に収まる短い文だけ
    const vL = Math.max(4, st.v[L_] || 16), toGoal = d.remain / vL / Math.max(0.15, st.slow || 1) / (st.timeScale || 1) / 1; // 実時間（秒）
    if (tier === 'x') {
      const close = d.gapM[1] < BASHIN * 0.9, three = d.gapM[1] + d.gapM[2] < BASHIN * 1.2;
      const a = o[0], b = o[1], c = o[2];
      const cands = [];
      if (close) {
        cands.push(() => { const L = this.line(4, 'x', 'ka').add('ka.' + (a + 1)).add('ka.' + (b + 1)); if (three) L.add('ka.' + (c + 1)); return L; });
        cands.push(() => this.line(4, 'x', 'narabi').add(three ? 'yoko' : 'narabi'));
        if (st.lane && Math.abs(st.lane[a] - st.lane[b]) > 1.2) { const ins = st.lane[a] < st.lane[b] ? a : b, ous = ins === a ? b : a; cands.push(() => this.line(4, 'x', 'uchisoto').add('uchi.' + (ins + 1)).add('soto.' + (ous + 1))); }
        cands.push(() => this.line(4, 'x', 'holdchase').add('hold.' + (a + 1)).add('chase.' + (b + 1)));
        cands.push(() => this.line(4, 'x', 'ka').add('ka.' + (a + 1)).add('ka.' + (b + 1)));
      } else if (d.gapM[1] > BASHIN * 2) {
        cands.push(() => this.line(3, 'x', 'lead').add('lead_is.' + (a + 1)).add('lead_m', { v: this.marginV(d.gapM[1]) }));
        cands.push(() => { const ty = h[a].type; return this.line(3, 'x', 'strong').add('strong', { v: d.remain < 120 ? 0 : (ty === 'nige' ? 2 : 1) }); });
        cands.push(() => this.line(3, 'x', 'nuke').add('nuke.' + (a + 1)).name(a));
        cands.push(() => this.line(3, 'x', 'chase').add('chase.' + (b + 1)).add('strong', { v: 4 }));
      } else {
        cands.push(() => this.line(3, 'x', 'holdchase').add('hold.' + (a + 1)).add('chase.' + (b + 1)));
        cands.push(() => this.line(3, 'x', 'lead').add('lead_is.' + (a + 1)).name(a));
        cands.push(() => this.line(3, 'x', 'ka').add('ka.' + (a + 1)).add('ka.' + (b + 1)));
        cands.push(() => this.line(3, 'x', 'strong').add('strong', { v: h[b].type === 'sashi' || h[b].type === 'oikomi' ? 3 : 4 }));
      }
      // 順番に回す（同じ型が続かないように）
      for (let k = 0; k < cands.length; k++) {
        const L = cands[(this.xStep + k) % cands.length]();
        if (!L || !L.parts.length) continue;
        if (L.dur > toGoal - 0.08 && toGoal < 3) {
          // 間に合わない: 馬番だけを短く
          if (toGoal > 0.55) { const s = this.shortStep = (this.shortStep || 0) + 1; return this.line(3, 'x', 'short').add(close ? 'ka.' + ((s % 2 ? a : b) + 1) : s % 2 ? 'num.' + (a + 1) : 'strong', close ? {} : { v: 5 }); }
          return this.line(0, 'x', 'wait');
        }
        this.xStep++; return L;
      }
      return null;
    }
    if (tier === 'e') {
      // 3〜4 コーナー・直線の入口: 先頭と差、動いている馬
      const step = this.fillStep++ % 5, mv = this.mover(st, d);
      // 全体（前の 3 頭）→ 馬群の中の 1 頭 → 形 → 動いている馬 → 先頭 の順（先頭だけの話は 5 回に 1 回）
      const moverLine = () => (mv >= 0 ? (() => { const L = this.line(3, 'e', 'mover').add((st.lane && st.lane[mv] > st.lane[L_] + 1 ? 'outside.' : 'moved.') + (mv + 1)); if (needName(mv, 6)) L.name(mv); return L; })() : this.line(3, 'e', 'hold').add('hold.' + (L_ + 1)).add('chase.' + (o[1] + 1)));
      if (step === 0 && now - (this.frontAt || -99) < 8) return this.shapeLine(st, d, 'e'); // 「前は○番と○番」を言ったばかり
      if (step === 0) { this.frontAt = now; const L = this.line(2, 'e', 'fieldTop').add('maewa').add('to.' + (o[0] + 1)).add('num.' + (o[1] + 1)); if (this.n > 2) L.add((d.gapM[2] < 0.6 ? 'narande.' : 'next.') + (o[2] + 1), { tier: 'c' }); return L; }
      if (step === 1) { const L = this.sideLine(st, d, 'e', now); return L && L.parts.length ? L : moverLine(); }
      if (step === 2) return d.remain < 400 ? moverLine() : this.shapeLine(st, d, 'e'); // 直線では馬群の形より動き
      if (step === 3) return moverLine();
      const L = this.line(3, 'e', 'lead').add('lead_is.' + (L_ + 1)); if (needName(L_, 5)) L.name(L_); return L.add('lead_m', { v: this.marginV(d.gapM[1]) });
    }
    // 道中（落ち着いて隊列を伝える）
    const step = this.orderStep++;
    // 全体の展開を中心に（オーナー「先頭の実況が多いから全体の展開の実況とかあってもいい」10/13）。先頭だけの文（A）は 8 回に 1 回
    const seq = ['field', 'shape', 'side', 'fav', 'pace', 'rear2', 'A', 'field'];
    const what = seq[step % seq.length];
    if (what === 'field') return this.fieldLine(st, d, 'c', now);
    if (what === 'shape') return this.shapeLine(st, d, 'c');
    if (what === 'side') { const L = this.sideLine(st, d, 'c', now); if (L && L.parts.length) return L; }
    if (what === 'pace' && this.pace != null && !this.paceSaid) { this.paceSaid = 1; return this.line(2, 'c', 'pace').add('pace2', { v: this.pace }); }
    if (what === 'rear2' || what === 'pace') { const a = o[this.n - 1], b = o[this.n - 2]; if (!this.kicked[a] && !this.kicked[b] && !st.fin[a]) return this.line(2, 'c', 'rear2').add('ato2'); }
    if (what === 'A') {
      const L = this.line(2, 'c', 'orderA').add('lead_is.' + (L_ + 1));
      if (needName(L_, 8)) L.name(L_);
      return L.add('lead_m', { v: this.marginV(d.gapM[1]) });
    }
    if ((what === 'B1' || what === 'B2') && d.L !== this.calledL) { this.orderStep--; return this.line(2, 'c', 'orderA').add('lead_is.' + (L_ + 1)).name(L_).add('lead_m', { v: this.marginV(d.gapM[1]) }); } // 先頭が替わったのに伝えていなければ先に
    if (what === 'B1' || what === 'B2') {
      const L = this.line(2, 'c', 'order' + what), from = what === 'B1' ? 1 : 3, to = what === 'B1' ? 3 : this.n;
      for (let r = from; r < to && r < this.n; r++) {
        const i = o[r], g = d.gapM[r];
        if (g > BASHIN * 1.6) L.add('gap', { v: g > BASHIN * 3 ? 2 : g > BASHIN * 1.9 ? 1 : 0 });
        let key;
        if (r >= 2 && g < 0.8) key = 'narande.';
        else key = r === 1 ? 'second.' : r === 2 ? 'third.' : r === 3 ? 'next.' : r === this.n - 1 ? 'last.' : (r === 4 ? 'rear.' : 'mid.');
        L.add(key + (i + 1));
        if (r <= 1 && needName(i, 10)) L.name(i);
      }
      if (what === 'B2') { const spread = (st.pos[o[0]] - st.pos[o[this.n - 1]]) * this.dist; L.add('form', { v: spread < BASHIN * 5 ? 1 : spread > BASHIN * 12 ? 2 : 0 }); }
      return L;
    }
    if (what === 'fav' && this.fav.length && now - (this.favAt || -99) > 40) {
      this.favAt = now;
      const f = this.fav[0], r = d.rankOf[f];
      const L = this.line(2, 'c', 'fav').add('fav', { v: 0 }).add(num(f)).name(f).add('favpos', { v: r === 0 ? 0 : r <= 2 ? 1 : r <= 3 ? 2 : 3 });
      return L;
    }
    if (what === 'stay') {
      const i = o[this.n - 1]; if (!st.fin[i] && (h[i].type === 'oikomi' || h[i].type === 'sashi') && !this.kicked[i]) { const L = this.line(2, 'c', 'stay').add('stay.' + (i + 1)); if (needName(i, 10)) L.name(i); return L; }
    }
    const L = this.line(1, 'c', 'fill').add('fill'); L.rest = 0.4; return L;
  };

  // 観客のざわめきの大きさ: 道中は小さく、残り 420m から直線で大きく、ゴール後は少し落とす。
  // ゴールの約 5 秒前（実時間。スローも含めて先頭の速さから）から 2 秒前にかけて、さらに +4dB 盛り上げる（REVIEW_TODO 5。山は今のリミッター −4dB で抑える）
  const SWELL_DB = 4;
  function crowdFollow(dir, crowd, st, now) {
    if (dir.flags.goal) crowd.set(0.14, now, 2.5);
    else if (st.phase === 'run' && dir.d) {
      const d = dir.d, v = Math.max(4, (st.v && st.v[d.L]) || 16), toGoal = d.remain / v / Math.max(0.15, st.slow || 1) / (st.timeScale || 1);
      const k = clamp((5 - toGoal) / 3, 0, 1);
      crowd.set((0.10 + 0.24 * clamp((420 - d.remain) / 420, 0, 1)) * Math.pow(10, SWELL_DB * k / 20), now, k > 0 ? 0.4 : 0.8);
    }
  }

  /* ---------- 本番（ゲームの画面につなぐ） ---------- */
  const S = { ctx: null, bus: null, pa: null, crowd: null, out: null, dir: null, view: null, race: null, raf: 0, prevRun: null, rate: 1, log: [], active: false, gain: null, endAt: 0, finished: false };
  function enabled() { return !OFF && !Lib.failed && !(window.Sfx && Sfx.isMuted && Sfx.isMuted()); }
  // 最初のタップで: 素材を読み、音の通り道を作る
  function unlock() {
    if (OFF) return;
    const ctx = window.Sfx && Sfx.ctx && Sfx.ctx(); if (!ctx) return;
    if (!S.ctx) {
      S.ctx = ctx;
      S.gain = ctx.createGain(); S.gain.gain.value = 1;
      const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
      /* 2026-10-19: 実況の声は出口（js/audio.js の scene＝レース中だけ開く）へそのまま（聞き取りやすさのため、こもらせない）。
         観客のざわめき・歓声は効果音と同じ「こもった柔らかい音」の通り道へ（リミッターは声と同じ −4dB のものを別に持つ） */
      S.gain.connect(lim); lim.connect((Sfx.sceneIn && Sfx.sceneIn()) || ctx.destination);
      S.cgain = ctx.createGain(); S.cgain.gain.value = 1;
      const lim2 = ctx.createDynamicsCompressor(); lim2.threshold.value = -4; lim2.knee.value = 0; lim2.ratio.value = 20; lim2.attack.value = 0.001; lim2.release.value = 0.12;
      S.cgain.connect(lim2); lim2.connect((Sfx.softIn && Sfx.softIn()) || ctx.destination);
      const rnd = seeded(12345);
      S.pa = buildPA(ctx, S.gain, rnd);
      S.crowd = new Crowd(ctx, S.cgain, rnd);
    }
    loadLib(ctx).catch(() => {});
  }
  // 発走前に呼ぶ。実況エンジンが話すなら true（そのときは従来の読み上げを止める）
  function begin(view, race, odds) {
    stop(true);
    S.active = false;
    if (!S.ctx) unlock();
    const ts = (view && view.timeScale) || 1;
    // 音が止まったまま（ユーザーの操作なしで作られた AudioContext など）だと時刻が進まず話せないので、そのときも使わない
    if (S.ctx && S.ctx.state === 'suspended') try { S.ctx.resume(); } catch (e) {}
    if (!S.ctx || S.ctx.state !== 'running' || !Lib.ready || !enabled() || ts > 2) return false;
    S.view = view; S.race = race; S.prevRun = view.run; S.rate = ts; S.finished = false; S.endAt = 0;
    const fav = odds && odds.tansho ? odds.tansho.map((o, i) => [o, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]) : [];
    S.dir = new Director(race, { fav });
    S.out = new Out(S.ctx, S.pa, { rate: ts, log: (S.log = []) });
    S.dir.onGoal = (t) => S.crowd.cheer(t, 0.5);
    S.crowd.start(S.ctx.currentTime + 0.05, 0.10);
    S.active = true;
    if (window.Voice && Voice.stop) Voice.stop();
    const frame = () => { S.raf = requestAnimationFrame(frame); try { tick(); } catch (e) { console.error(e); stop(); } };
    S.raf = requestAnimationFrame(frame);
    return true;
  }
  function snap() {
    const v = S.view, run = v.run, race = S.race, n = race.horses.length;
    const live = run && run !== S.prevRun;
    const phase = v.gateShot || !live ? 'pre' : v.phase === 'run' ? 'run' : v.phase === 'replay' ? 'replay' : v.phase === 'winner' ? 'winner' : 'done';
    if (!live) return { phase, t: 0, pos: new Array(n).fill(0), fin: new Array(n).fill(0), v: new Array(n).fill(0), lane: null, slow: 1, timeScale: S.rate };
    const k = race.dist / run.length;
    return { phase, t: run.t, pos: run.pos, fin: run.finish, v: run.speed.map((s) => s * k), lane: v.lane, slow: v.slow || 1, timeScale: S.rate };
  }
  function tick() {
    if (!S.active) return;
    const now = S.ctx.currentTime;
    S.gain.gain.value = enabled() ? 1 : 0; if (S.cgain) S.cgain.gain.value = S.gain.gain.value;
    const st = snap();
    S.dir.tick(st, now, S.out);
    // 観客: 直線で大きく
    crowdFollow(S.dir, S.crowd, st, now);
    if (S.finished && now > S.out.lineEnd + 0.3 && !S.dir.pend.length) { S.crowd.stop(now, 3); S.active = false; cancelAnimationFrame(S.raf); }
  }
  // テロップの文（game.js の announce）。ゲートイン（枠入りの各段階）・体勢完了・応援だけを拾う（レース中の文はエンジンが自分で作る）
  function caption(text) {
    if (!S.active || !S.dir) return;
    captionInto(S.dir, S.out, String(text), S.ctx.currentTime);
  }
  // 字幕の文 → 話題（tools/render-commentary.html も同じものを使う）
  function captionInto(dir, out, text, now) {
    const S = { dir, out }; let m;
    // オーナー「ゲートインの実況はいらないかもね」（10/13）: ゲートイン〜体勢完了は声を出さない（効果音と観客のざわめきだけ）
    if (/ゲートイン|奇数番|偶数番|入りました|最後に\s*\d番|体勢/.test(text)) return;
    if (/ゲートインを開始/.test(text)) S.dir.push('gstart', PRI.gate, now, 1.5);
    else if (/奇数番/.test(text)) S.dir.push('gkisu', PRI.gate, now, 2.5);
    else if ((m = text.match(/^(\d)番 .*入りました/))) S.dir.push('gin', PRI.gate, now, 2.5, { i: Number(m[1]) - 1 });
    else if (/偶数番/.test(text)) S.dir.push('gguu', PRI.gate, now, 2.0);
    else if ((m = text.match(/最後に\s*(\d)番/))) S.dir.push('glast', PRI.gate, now, 1.5, { i: Number(m[1]) - 1 });
    else if (/ゲートイン/.test(text)) S.dir.push('gate', PRI.gate, now, 1.2);
    else if (/体勢/.test(text)) { // 体勢完了: 言いかけのゲートインの文は区切りで止める（発走したら言わない）
      if (S.out.cur && /^(gate|gstart|gkisu|gin|gguu|glast)$/.test(S.out.cur.key)) S.dir.nextAt = S.out.trimAfter(now);
      S.dir.pend = S.dir.pend.filter((p) => !/^(gate|gstart|gkisu|gin|gguu|glast)$/.test(p.key));
      S.dir.push('ready', PRI.ready, now, 2.0);
    }
    else { const m = text.match(/(\d)番に\s*(ニンジン|大根|とうもろこし)/); if (m) S.dir.push('food', PRI.food, now, 2.5, { i: Number(m[1]) - 1, key: m[2] === '大根' ? 'daikon' : m[2] === 'とうもろこし' ? 'corn' : 'carrot' }); }
  }
  // 結果の画面: 勝ちタイムを言って終わる
  function finish(res) {
    if (!S.active || !S.dir) return;
    const w = res.order[0]; S.dir.pend = S.dir.pend.filter((p) => p.key === 'recap');
    S.dir.push('result', PRI.result, S.ctx.currentTime, 6, { t: res.finish[w] });
    S.finished = true;
  }
  function stop(quiet) {
    if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0;
    if (S.ctx && S.out) S.out.cut(S.ctx.currentTime);
    if (S.ctx && S.crowd) S.crowd.stop(S.ctx.currentTime, quiet ? 0.5 : 2);
    S.active = false;
  }

  // ゲームの画面では、起動したらすぐ素材を取りに行く（声の表記を起動画面に出すため。音に戻すのは最初のタップのあと）
  if (!OFF && typeof document !== 'undefined' && document.getElementById('voiceCredit')) fetchLib().catch(() => {});

  return {
    unlock, begin, caption, finish, stop,
    get active() { return S.active; }, get ready() { return Lib.ready; }, get log() { return S.log; },
    // 書き出し・確認用の部品（tools/render-commentary.html が使う）
    _: { Lib, loadLib, fetchLib, Director, Out, Crowd, buildPA, seeded, PRI, clipById, crowdFollow, captionInto },
  };
})();
