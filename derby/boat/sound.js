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
  let R = null, raceRef = null, lastTT = null, flags = {}, voiceUntil = 0, vsrc = [], lastFrame = 0, gen = 0, stopped = false;
  /* 2026-11-23 オーナー「音の途切れ方・レース終わってるのに音が流れてたり・ファンファーレの音なってなかったり」の直し:
     cueS … 合図の音（ブザー・ファンファーレ）を 1 レースに 1 回だけ鳴らすための印（下の cue）。K … 場面の終わりの絞り（1 ＝ ふつう・0 ＝ 無音。下の frame）。
     stopT … 止めている途中（絞り終わったら中の音を片付ける予約）。stat … 確かめ用の数（debug） */
  let cueS = { key: null, buz: 0, fan: 0, off: null }, K = 1, Kv = 1, stopT = 0, resumeAt = 0;
  const stat = { stops: 0, resumes: 0, cuts: 0, trims: 0, skips: 0 }, TAIL = 0.8, TAIL_V = 0.35, OVER = 0.6, BUZ_FROM = -2.6, FAN_PRE = 0.3, FAN_END = 3.3;

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
    loadCue();
    setInterval(() => { if (ctx && performance.now() - lastFrame > 400) engBus.gain.setTargetAtTime(0, ctx.currentTime, 0.1); }, 250); // 画面が止まったらエンジンも消す
  }
  /* 合図の音（ブザー・ファンファーレ）は、あらかじめ作った音のファイルを流す（2026-11-23 夜。オーナー「ピットアウトの時ファンファーレなってない」）。
     前は、その場で音を合成していた（のこぎり波 数百本＋残響）。パソコンでは鳴るが、店の Fire TV では実況とエンジンは聞こえるのにブザーとファンファーレだけ聞こえなかった（原因は特定できていない）。
     Fire TV で聞こえている実況の声と同じ方式（ファイルを読んでそのまま流す）にそろえる。ファイルは同じ合成をそのまま書き出した物（art/voice-boat/fan-A.m4a・fan-B.m4a・buzzer.m4a。頭に CUE_LEAD 秒の無音。
     割れないように fan は 0.5 倍・buzzer は 4 倍で書き出してあるので、流すときに CUE_K で割り戻す）。ファイルが読めていないときだけ、前の合成で鳴らす */
  const CUE_LEAD = 0.1, CUE_K = { fan: 0.5, buz: 4 }, cueBuf = { fan: null, buz: null };
  function loadCue() {
    const get = (f, k) => fetch(VOICE_DIR + f).then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); }).then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej))).then((b) => { cueBuf[k] = b; }).catch((e) => { console.warn('boat cue: ' + f, e && e.message); });
    get('fan-' + FAN + '.m4a', 'fan'); if (BUZ) get('buzzer.m4a', 'buz');
  }
  /* when ＝ 音の頭が鳴る時刻。もう過ぎていたら、ほかの店と同じ位置から入る。grid（秒）があるときは、次の区切り（ブザーの次の 1 回）の頭から＝半端な長さで鳴らさない。戻り値: 鳴らしたか */
  function playBuf(buf, dest, when, vol, grid) {
    const now = ctx.currentTime, st = when - CUE_LEAD; let at = st, off = 0;
    if (st < now) { off = now - st; at = now; if (grid && off > CUE_LEAD) { const nx = CUE_LEAD + Math.ceil((off - CUE_LEAD) / grid - 1e-6) * grid - 0.01; at = now + (nx - off); off = nx; } }
    if (off >= buf.duration - 0.05) return false;
    const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; g.gain.value = vol; src.connect(g); g.connect(dest); src.start(at, off); stat.files = (stat.files || 0) + 1;
    return true;
  }
  /* again ＝ 取り直し。2026-11-28 に声を作り直した（速さを競馬に合わせた）ので、テレビに残っている古い音（announce.m4a）と新しい一覧（index.json）、またはその逆が組になることがある。
     組が違うと部品の位置がずれて別の言葉が鳴るので、一覧に書いてある音の長さ（dur）と読んだ音の長さを比べ、違えば両方を取り直す（1 回だけ）。それでも違えば実況の声は出さない（字幕は出る） */
  function loadVoice(again) {
    const opt = again ? { cache: 'reload' } : undefined; let idx = null;
    fetch(VOICE_DIR + 'index.json', opt).then((r) => r.json()).then((j) => {
      idx = j;
      if (!j.dur && !again) { loadVoice(true); return null; } // dur の無い一覧 ＝ 作り直す前の古い一覧が残っている → 取り直す
      return fetch(VOICE_DIR + (j.sprite || 'announce.m4a'), opt).then((r) => r.arrayBuffer());
    }).then((ab) => ab && new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej))).then((b) => {
      if (!b) return;
      if (idx.dur && Math.abs(b.duration - idx.dur) > 0.5) { stat.voiceMix = (stat.voiceMix || 0) + 1; if (!again) loadVoice(true); else console.warn('boat voice: 一覧と音の組が違う', idx.dur, b.duration); return; }
      vidx = idx; names = Object.keys(idx.clips).filter((k) => k.indexOf('#S') === 1).map((k) => k.slice(3)).filter((v, i, a) => a.indexOf(v) === i);
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
    wakeUp();
    if (stopped) reopen(); // stop で閉じた出口・消した歓声を戻す
    const now = ctx.currentTime, tt = race.tt, V = race.vis || [], cam = race.camera, PIT_T = BOAT.Race.PIT_T;
    if (race.race !== raceRef) { raceRef = race.race; flags = {}; lastTT = null; stopVoice(); if (crowd) crowdTo(1, 0.3); eng.forEach((e) => { e.f = 118 * (1 + e.pit); e.on = false; }); }
    const card = st.state === 'card', over = st.state === 'result';
    const dt = lastTT == null ? 0 : clamp(tt - lastTT, 0, 0.2), jumped = lastTT != null && (tt < lastTT - 0.01 || tt - lastTT > 1);
    // 合図の音（出走表の終わりにブザー 3 回 → ピットアウトと同時にファンファーレ。桐生・大村・丸亀の形）: 「ピット離れから何秒か」で決める（下の cue）。出走表の間は残り時間から、映像の間は映像の時刻から。
    // 映像の時刻を飛ばしたコマ・止めた絵（確かめ用のページの seek）では鳴らし始めない
    cue(st.key != null ? st.key : race.race, card ? -Math.max(0, (st.cardLen || 6) - (st.cardT || 0)) : tt - PIT_T, card || (lastTT != null && !jumped && tt > lastTT));
    if (!card && lastTT != null && !jumped && crowd) { // ビッグレースの歓声
      const G = race.G || 999, cross = (x) => lastTT < x && tt >= x;
      if (cross(0)) { crowdTo(2.4, 0.3); later(() => crowdTo(1.2, 3), 4000); }
      if (cross(G - 2.5)) crowdTo(3, 0.5);
      if (cross(G + 1.5)) { clap.gain.setTargetAtTime(0.09, now, 0.4); crowdTo(1.6, 2); later(() => clap && clap.gain.setTargetAtTime(0, ctx.currentTime, 1.5), 6500); }
      if (cross(G + 5.3)) BOAT.Fanfare.play(ctx, fxBus, now + 0.05, 'W', LVL.fan * 0.8);
    }
    lastTT = tt;
    /* 場面の終わりの消え方（2026-11-23）: 映像の終わり（ゴール後 8 秒 ＝ race.endT）の 0.8 秒前から、声・エンジン・合図の音・客席を映像の時刻に合わせて絞り、映像が終わる所で無音にする
       （前は結果の画面に替わっても実況の残りとエンジンが鳴り続けた。確かめ: tests/boat-tv-sound.plan.js）。結果（state 'result'）の間は鳴らさない */
    const endT = race.endT, hasEnd = typeof endT === 'number' && isFinite(endT), k = over ? 0 : (hasEnd ? clamp((endT - tt) / TAIL, 0, 1) : 1), kv = over ? 0 : (hasEnd ? clamp((endT - tt) / TAIL_V, 0, 1) : 1); // 声は言い切らせたいので、終わりの 0.35 秒だけ絞る（say が、入り切らない行を先に短くする）
    if (k !== K || kv !== Kv) { K = k; Kv = kv; voiceBus.gain.setTargetAtTime(LVL.voice * kv, now, 0.03); fxBus.gain.setTargetAtTime(k, now, 0.04); }
    if (k < 1 && !flags.tail) { flags.tail = 1; gen++; if (crowdBus) crowdBus.gain.setTargetAtTime(0, now, 0.2); if (clap) clap.gain.setTargetAtTime(0, now, 0.2); } // 客席（ビッグレース）も絞る。あとから音量を戻す予約（later）は無効に
    else if (k >= 1 && flags.tail) { flags.tail = 0; if (crowd) crowdTo(1, 0.3); } // 映像を巻き戻した（確かめ用のページ）
    // エンジン
    const talking = now < voiceUntil;
    duckG.gain.setTargetAtTime(talking ? LVL.duck : 1, now, talking ? 0.12 : 0.35);
    engBus.gain.setTargetAtTime(k, now, k < 1 ? 0.05 : 0.2);
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
  // 鳴っている声・これから鳴る声を止める。fade（秒。省くと 0.08）かけて消す。0 ならその場で切る（出口をもう絞り終えたあとの片付け用）
  function stopVoice(fade) {
    if (!ctx) return; const t = ctx.currentTime, f = fade == null ? 0.08 : Math.max(0, fade);
    vsrc.forEach((s) => { try { if (f > 0) { s.g.gain.cancelScheduledValues(t); s.g.gain.setTargetAtTime(0, t, f / 4); s.s.stop(t + f + 0.02); } else s.s.stop(t); } catch (e) { } });
    vsrc = []; voiceUntil = 0;
  }
  function clipOf(key, tier) { const c = vidx.clips; return c[tier + key] || c[(tier === 2 ? 1 : tier === 0 ? 1 : 2) + key] || c[(tier === 2 ? 0 : tier === 0 ? 2 : 0) + key] || null; }
  // line: 台本の 1 行 { t, d, s }
  function say(line) {
    if (!ctx || !vbuf || !vidx || ctx.state !== 'running' || !line || !line.s || !BOAT.Announce) return;
    const now = ctx.currentTime, items = BOAT.Announce.plan(line, names), seq = [];
    let dur = 0;
    items.forEach((x) => { if (x.pause != null) { seq.push({ pause: x.pause }); dur += x.pause; return; } const c = clipOf(x.key, x.tier); if (!c) { if (!warned[x.key]) { warned[x.key] = 1; console.warn('boat voice: no clip', x.key, line.s); } return; } seq.push({ c }); dur += c[1] - 0.015; });
    if (!seq.length) return;
    /* 声は速回ししない（2026-11-28 オーナー「実況も早口だから修正してほしい。競馬と同じぐらいのスピード感でいい」）。
       前は、次の行までに言い切れない行を 1.12 倍まで速く回していた。声そのものも競馬より 2 割ほど速かった（測り: ボート 10.4・11.4・12.0 拍/秒、競馬 8.7・10.0・10.0 拍/秒）ので、
       声を競馬と同じ速さで作り直し（tools/make-boat-announce.js の LV）、ここの速回しをやめた。台本（boat/race-boat.js の script）は、遅くした声でも次の行までに言い切れるように行を減らしてある。
       それでも次の行に 0.6 秒より長くかかる行（先頭の入れ替わり・事故などが続いたとき）は、後ろの文から落とす（最初の文は残す）。0.6 秒までなら、次の行が少し待つ（下の「前の声がまだ続いている」） */
    const rate = 1, list = R && R.capList, k = list ? list.indexOf(line) : -1, nxt = k >= 0 ? list[k + 1] : null;
    const lenOf = () => seq.reduce((a, x) => a + (x.pause != null ? x.pause : x.c[1] - 0.015), 0);
    const dropLast = () => { let j = -1; for (let i = seq.length - 1; i > 0; i--) if (seq[i].pause != null && seq[i].pause >= 0.18) { j = i; break; } if (j < 1) return false; seq.length = j; dur = lenOf(); return true; }; // 後ろの文を 1 つ落とす（「。」「！」の所で切る）。落とせなければ false
    // 前の声がまだ続いている: 1 秒以内に終わるなら待つ、それより長ければ切って次へ
    let t0 = now + 0.03;
    if (voiceUntil > now) { if (voiceUntil - now < 1.0) t0 = voiceUntil + 0.06; else { stopVoice(0.22); stat.cuts++; t0 = now + 0.2; } } // 切るときは 0.2 秒かけて消してから次の行へ（2026-11-23: 前は 0.02 秒で切れて「ブツッ」と聞こえた）
    if (nxt) { const late = R && typeof R.tt === 'number' ? Math.max(0, R.tt - line.t) : 0, avail = nxt.t - line.t - late - (t0 - now) - (/^お知らせいたします/.test(line.s) ? 1.9 : 0) + OVER; let cut = false; while (dur > avail && dropLast()) cut = true; if (cut) stat.trims++; } // 次の行に 0.6 秒より長くかかるなら、後ろの文を落とす
    /* 映像の終わり（結果の画面に替わる所）までに言い切れない行（2026-11-23: 2 着のゴールが遅いレースで「着順確定。1着…2着…。2連単 1-2」の終わりが結果の画面に 1.5 秒ほどかぶっていた）:
       入らなければ後ろの文から落とす（最初の文は残す）。0.4 秒も無ければ言わない。速回しはしない（2026-11-28。前は 1.12 倍まで速くしていた） */
    if (R && typeof R.endT === 'number' && isFinite(R.endT) && typeof R.tt === 'number') {
      const room = (R.endT - TAIL_V - R.tt) - (t0 - now);
      if (room < 0.4) { stat.skips++; return; }
      let cut = false;
      while (dur > room && dropLast()) cut = true;
      if (cut) stat.trims++;
    }
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
  /* 2026-11-23 止め方の直し（オーナー「音の途切れ方」）: 前は声を 0.02 秒・合図の音を 0.03 秒で切っていて「ブツッ」と聞こえた（測り: 映像の途中の取り消しで声が 0.00 秒で消えていた）。
     → 声・エンジン・合図の音・客席の出口を、fade 秒（省くと 0.5）かけて同じ形でなめらかに絞る（fade の 9 割で 1/100 の大きさ）。絞り終わったら中の音を片付ける（hardStop）。
     fade が 0 のとき・音の部品が止まっているときは、その場で片付ける。次に frame / cue が呼ばれたら出口を開け直す（reopen） */
  function stop(fade) {
    if (!ctx) return;
    stat.stops++; gen++;
    const f = fade == null ? 0.5 : Math.max(0, Number(fade) || 0), t = ctx.currentTime;
    if (stopped) { if (f <= 0.02 && stopT) hardStop(); return; } // もう止めている（絞っている途中に「すぐ」と言われたら、その場で片付ける）
    stopped = true;
    if (f <= 0.02 || ctx.state !== 'running') { hardStop(); return; }
    [voiceBus, engBus, fxBus, crowdBus, clap].forEach((g) => { if (!g) return; try { const p = g.gain; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.setTargetAtTime(0, t, f / 5); } catch (e) { } });
    stopT = setTimeout(hardStop, f * 1000 + 60);
  }
  // 中の音を片付ける: 声の元を止める・これから鳴る予約ずみの合図の音（ファンファーレ・ブザー・チャイム）を出口ごと外して新しい出口を作る・エンジンと客席は 0 のまま（次の frame が戻す）
  function hardStop() {
    clearTimeout(stopT); stopT = 0; if (!ctx) return;
    const t = ctx.currentTime;
    stopVoice(0);
    [engBus, crowdBus, clap].forEach((g) => { if (!g) return; try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0, t); } catch (e) { } });
    if (fxBus) { const old = fxBus; try { old.gain.cancelScheduledValues(t); old.gain.setValueAtTime(0, t); } catch (e) { } setTimeout(() => { try { old.disconnect(); } catch (e) { } }, 300); fxBus = ctx.createGain(); fxBus.gain.value = 1; fxBus.connect(master); }
    try { voiceBus.gain.cancelScheduledValues(t); voiceBus.gain.setValueAtTime(0, t); voiceBus.gain.setValueAtTime(LVL.voice, t + 0.05); } catch (e) { } // 声の元はもう止めた。出口は少し置いてから開ける
    K = 1; Kv = 1;
  }
  // stop のあと、また鳴らす所で出口を開け直す（絞っている途中なら先に片付ける）
  function reopen() { if (stopT) hardStop(); stopped = false; K = 1; Kv = 1; if (crowd) crowdTo(1, 0.3); }
  /* 音の部品（AudioContext）が止まっているとき（ブラウザが人の操作まで止める・途中で止められた）は、鳴らす場面に入るたびに動かし直す（競馬のテレビの unlockAudio と同じ考え方。1 秒に 1 回まで）。
     Fire TV のアプリは触らなくても動く。ふつうのブラウザで断られたら、次に押されたとき（init の wake）に動く */
  function wakeUp() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    const p = performance.now(); if (p - resumeAt < 1000) return; resumeAt = p; stat.resumes++;
    try { const q = ctx.resume(); if (q && q.catch) q.catch(() => { }); } catch (e) { /* noop */ }
  }
  /* 合図の音（ブザー 3 回・ファンファーレ）を「ピット離れ（映像の始まり）から何秒か」（sp。前はマイナス）だけで決めて鳴らす（2026-11-23 オーナー「ファンファーレの音なってなかったり」）。
     前は「映像のコマが −100 秒をまたいだ瞬間」にだけ鳴らしていたので、映像の準備が発走に間に合わないテレビ・途中で読み込み直したテレビ・音の部品が止まっていたテレビでは一度も鳴らなかった
     （測り: 準備を 3.6 秒おくらせると合図の音は −120dB のまま。tests/boat-tv-sound.plan.js の C・D・E）。
     ・ブザー: ピット離れの 2.6・1.6・0.6 秒前に 0.6 秒ずつ。途中から入ったら、まだ始まっていない回だけ
     ・ファンファーレ: ピット離れと同時（0.3 秒前から予約して時刻ぴったりに）。途中から入ったら、ほかの店のテレビと同じ位置から（0.3 秒かけて入る。頭からは鳴らし直さない＝店ごとにずれない・あとの実況にかぶらない）。
       終わりの和音（残り約 3 秒）より後から入るときは鳴らさない（競馬のテレビが「発走の 3 秒前を過ぎたら鳴らさない」のと同じ考え方。v2/tv.js の playRace）
     1 レース（key）に 1 回だけ。flow === false（止めた絵）と、音の部品が動いていない間は鳴らし始めない（動いたときに、その時刻の位置から入る）。
     店のテレビ（v2/tv-boat.js）は、映像の準備を待たずにサーバーの時刻でここを呼ぶ */
  function cue(key, sp, flow) {
    if (!ctx || !(typeof sp === 'number') || !isFinite(sp)) return;
    if (key !== cueS.key) cueS = { key, buz: 0, fan: 0, off: null };
    if ((cueS.buz || !BUZ) && cueS.fan) return;
    const join = BOAT.Fanfare.length(FAN) - FAN_END; // ここまでなら途中から入る
    if (sp < BUZ_FROM - 0.1 || sp > join) return;
    wakeUp();
    if (flow === false || ctx.state !== 'running') return;
    if (stopped) reopen();
    const now = ctx.currentTime;
    if (BUZ && !cueS.buz && sp < -0.55) { cueS.buz = 1; const bw = now - (sp - BUZ_FROM); if (cueBuf.buz) playBuf(cueBuf.buz, fxBus, bw, LVL.buzzer / CUE_K.buz, 1.0); else BOAT.Fanfare.buzzer(ctx, fxBus, bw, LVL.buzzer); } // もう過ぎた回は buzzer が飛ばす
    if (!cueS.fan && sp >= -FAN_PRE) {
      cueS.fan = 1; const late = sp > 0.25; cueS.off = late ? Math.round(sp * 100) / 100 : 0;
      let dest = fxBus; if (late) { const g = ctx.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + 0.3); g.connect(fxBus); dest = g; }
      const fw = late ? now - sp : now + Math.max(0.02, -sp); cueS.file = cueBuf.fan ? 1 : 0;
      if (cueBuf.fan) playBuf(cueBuf.fan, dest, fw, LVL.fan / CUE_K.fan); else BOAT.Fanfare.play(ctx, dest, fw, FAN, LVL.fan);
      if (crowd) { crowdTo(2.2, 0.4); later(() => crowdTo(1, 2), 9000); }
    }
  }
  // 確かめ用（tests/boat-tv-sound.plan.js）: いまの状態・出口ごとの音量・鳴っている声の数・合図の音の印・数えたもの
  function debug() {
    const now = ctx ? ctx.currentTime : 0, g = (n) => (n ? Math.round(n.gain.value * 1000) / 1000 : null);
    return { state: ctx ? ctx.state : 'none', mute: MUTE, stopped, fading: !!stopT, k: K, kv: Kv, voices: vsrc.length, voiceLeft: Math.round(Math.max(0, voiceUntil - now) * 100) / 100,
      cue: { key: typeof cueS.key === 'string' ? cueS.key : cueS.key ? 'race' : null, buz: cueS.buz, fan: cueS.fan, off: cueS.off, file: cueS.file == null ? null : cueS.file, loaded: (cueBuf.fan ? 1 : 0) + (cueBuf.buz ? 1 : 0) }, gain: { voice: g(voiceBus), eng: g(engBus), duck: g(duckG), fx: g(fxBus), crowd: g(crowdBus) }, stat: Object.assign({}, stat), voice: !!vbuf };
  }
  const later = (fn, ms) => { const g0 = gen; setTimeout(() => { if (g0 === gen) fn(); }, ms); }; // stop のあとは実行しない予約
  return { init, say: sayCompat, frame, stop, cue, debug, get _fx() { return fxBus; }, get _crowd() { return crowdBus; }, get _clap() { return clap; }, get _bus() { return { ctx, master, voice: voiceBus, eng: engBus, duck: duckG, fx: fxBus, crowd: crowdBus }; }, update() { }, get on() { return !!ctx && ctx.state === 'running'; }, get ready() { return !!vbuf; }, get voff() { return voff; }, MUTE, BIG, FAN, LVL };
})();
