/* casa DERBY 店のテレビの「投票の案内」の声（2026-10-30 オーナー「投票開始と間もなく締め切り、それぞれ AI の声でアナウンスしてほしい。
   AI の声は実況で流れてるやつ」。同日の変更: 投票の前は 1 分前だけ・投票中は締切の 20・10・5・3・1 分前）。
   index.html?store=<店舗> のテレビだけ（v2/tv.js のあとに読む。見るだけ ?watch=1・Web デモ・一人用では何もしない）。
   v2/tv.js は変えずに、tv.js が出している window.DERBY（state・phase・now・canVote・tv）を 1 秒ごとに見る。
   声: 実況と同じ VOICEVOX:雀松朱司 の部品（tools/make-voice.js の ann_*。--add で art/voice/g.m4a に入る）を、実況と同じ「場内スピーカー」の音
       （js/commentary.js の buildPA）で鳴らす。テレビは「レース中以外は音を出さない」（js/audio.js の scene）ので、案内の声だけは scene を通さずに出す。
   いつ言うか（この店が投票できるレース＝DERBY.canVote だけ。openAt＝投票の始まり、closeAt＝締切）:
     pre1  … openAt の 1 分前「まもなく投票開始！あと1分です！」
     open  … openAt「投票を開始しました！テレビのQRコードから、1着と2着を予想してください！」
     cl20 / cl10 … closeAt の 20・10 分前「締め切りまで、あと20分です」「締め切りまで、あと10分です」
     cl5 / cl3   … closeAt の 5・3 分前「まもなく締め切りです。あと5分です」「まもなく締め切りです！あと3分です！」
     cl1   … closeAt の 1 分前「まもなく締め切り！あと1分です！投票はお早めに！」
     締切の案内は投票の始まりから GAP 以上あとのものだけ（投票 600 秒なら cl20 は無し・cl10 は投票の始まりと同じ時刻なので open だけ）
   決まり:
     - テストレース（スタッフの「この店だけテストレース」。投票 60 秒）は open と cl1 だけ（cl1 が open と重なるときは open だけ＝投票 60 秒なら open だけ）
     - 2 つの案内が GAP（12 秒）より近いときは大事な方だけ（open ＞ cl1 ＞ ほかの締切 ＞ 始まる前）
     - 時刻を過ぎて late 秒（始まる前・締切 15 秒、open 45 秒）たったら言わない（読み込み直し・SLOT から移ってきた直後に古い案内を言わない）。
       同じレースで言えるものが 2 つあれば新しい方だけ言い、古い方は言ったことにする
     - ほかの声・音と重ねない: レース（場面 live・映像の再生中）・実況（Commentary.active）・自分の案内の途中は待つ（late のうちに空けば言う、空かなければ言わない）
     - ほかのレースの投票中は、次のレースの始まる前の案内（pre）は言わない（「投票を開始しました」のすぐあとに「次のレースの投票開始まで…」と食い違わないように）
     - 消音（?mute=1・?voice=0・Sfx.mute）のときは言わない。音がまだ出せない（AudioContext が running でない・声の部品が読めていない）ときも言わない
     - 1 台のテレビで 1 レース 1 回だけ: 言ったものは localStorage 'casa.derby.ann'（{ 'レースid|案内': 時刻 }。2 日より古いものは消す）に覚える＝読み込み直しても言い直さない
   チャイム（2026-10-31 オーナー「締め切りとかのアナウンスの前後に、ちょっと効果音を入れてほしい。ピロロンみたいな。ピロロン → 締め切りまで何分です → ピロロン」）:
     どの案内も「チャイム（上がる）→ 0.15 秒 → 声 → 0.15 秒 → チャイム（下がる）」。駅・空港の案内のように、前は上がって後は下がる（下の CHIME・chime）。
     音声ファイルは使わず、その場でサイン波から作る。声と同じ出口（out → リミッター → スピーカー）を通るので、消音・音量は声と同じ。
     チャイムも案内の一部: 次の案内・ほかの声を待たせる長さ（busyUntil）は後のチャイムの終わりまで。途中で消音・レースになったら残りを止める（player.stop）
   確認用: window.DerbyAnnounce（plan・due・candidates・log・player・env を差し替えられる。schedule は好きな AudioContext に 1 回の案内を予約する＝書き出し・確かめ用。
     tests/v4-announce.test.js・tests/v4-announce.plan.js） */
(function (root) {
  'use strict';
  const MIN = 60000;
  const CL = [20, 10, 5, 3, 1]; // 締切の何分前
  const CLIP = { pre1: 'e:ann_pre1', open: 'e:ann_open', cl20: 'c:ann_cl20', cl10: 'c:ann_cl10', cl5: 'e:ann_cl5', cl3: 'e:ann_cl3', cl1: 'e:ann_cl1' };
  const PRI = { pre1: 1, open: 4, cl1: 3, cl3: 2, cl5: 2, cl10: 2, cl20: 2 };
  const GAP = 12000, LATE = 15000, LATE_OPEN = 45000;
  const KEY = 'casa.derby.ann', KEEP_MS = 2 * 24 * 3600 * 1000;

  const isTest = (r) => !!(r && (r.test || /^x-.*test-/.test(String(r.id || ''))));
  /* レース 1 つの案内の一覧 [{ key, clip, at, until, pri }]（時刻の早い順）。openAt が無ければ []。
     until: これより後には言わない（at＋late と、始まる前は openAt・締切は closeAt の早い方） */
  function plan(r) {
    if (!r || !Number.isFinite(Number(r.openAt))) return [];
    const openAt = Number(r.openAt), closeAt = Number.isFinite(Number(r.closeAt)) ? Number(r.closeAt) : Number(r.at);
    let L = [];
    const test = isTest(r);
    if (!test) L.push({ key: 'pre1', at: openAt - MIN, until: Math.min(openAt, openAt - MIN + LATE), pri: PRI.pre1 });
    L.push({ key: 'open', at: openAt, until: Number.isFinite(closeAt) ? Math.min(closeAt, openAt + LATE_OPEN) : openAt + LATE_OPEN, pri: PRI.open });
    if (Number.isFinite(closeAt)) (test ? [1] : CL).forEach((m) => { const k = 'cl' + m, at = closeAt - m * MIN; if (at >= openAt + GAP) L.push({ key: k, at, until: Math.min(closeAt, at + LATE), pri: PRI[k] }); });
    // 近すぎる 2 つは大事な方だけ（同じ大事さなら早い方）
    L.sort((a, b) => a.at - b.at);
    L = L.filter((x) => !L.some((y) => y !== x && Math.abs(y.at - x.at) < GAP && (y.pri > x.pri || (y.pri === x.pri && y.at < x.at))));
    // open の until は次の案内の手前まで（遅れて言った open が次の案内と重ならないように）
    L.forEach((x, i) => { const nx = L[i + 1]; if (nx && x.until > nx.at - GAP / 2) x.until = Math.max(x.at + 1, nx.at - GAP / 2); x.clip = CLIP[x.key]; });
    return L;
  }
  /* いま言うもの: { item, skip: [言わずに済ませるもの] } か null。done(key) は言ったか */
  function due(r, t, done) {
    const L = plan(r).filter((x) => !done(r.id + '|' + x.key) && x.at <= t);
    if (!L.length) return null;
    const live = L.filter((x) => t < x.until);
    const item = live.length ? live[live.length - 1] : null;
    return { item, skip: L.filter((x) => x !== item) };
  }
  /* 案内するレース: 投票中（open）・次（next）・時刻表（upcoming）から、この店が投票できて締切前のもの（id ごとに 1 つ。情報の多い open・next を優先） */
  function candidates(S, t, canVote) {
    if (!S) return [];
    const seen = {}, out = [];
    [S.open, S.next].concat(Array.isArray(S.upcoming) ? S.upcoming : []).forEach((r) => {
      if (!r || !r.id || seen[r.id]) return; seen[r.id] = 1;
      const close = Number.isFinite(Number(r.closeAt)) ? Number(r.closeAt) : Number(r.at);
      if (!(close > t) || !(canVote ? canVote(r) : r.canVote !== false)) return;
      out.push(r);
    });
    return out;
  }

  // ---------- 覚えておく（1 レース 1 回） ----------
  const mem = {
    m: null,
    load() { if (this.m) return this.m; let m = {}; try { m = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { m = {}; } this.m = m; return m; },
    has(k) { return !!this.load()[k]; },
    add(k, t) { const m = this.load(); m[k] = t; Object.keys(m).forEach((x) => { if (!(m[x] > t - KEEP_MS)) delete m[x]; }); try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) { /* 保存できなくても今の間は覚えている */ } },
  };

  // ---------- チャイム「ピロロン」（上の説明。2026-10-31） ----------
  /* 3 音のアルペジオ: ソ・シ・レ（G5 784Hz・B5 988Hz・D6 1175Hz）を 0.12 秒おき。前（up）は上がる・後（down）は下がる（レ・シ・ソ）で少し小さく（−2dB）。
     1 音: サイン波の基音＋オクターブ上（薄く・早く消える）＋4 倍音の「チン」（立ち上がりだけ）。5ms で立ち上がり、なめらかに減る。
     最初の 2 音は 0.55 秒・最後の音は 1.1 秒で −60dB（最後の音だけ長く響く）。1 回の長さ len＝0.72 秒（最後の音の頭から 0.48 秒）。そのあと gap＝0.15 秒で声。
     音色をやわらげる 5.5kHz の高域カットと、薄い残響（0.9 秒）。大きさ vol は声（場内スピーカーの音）の山より約 3dB 小さく（tests/v4-announce.plan.js で測る） */
  const CHIME = {
    up: [783.99, 987.77, 1174.66], down: [1174.66, 987.77, 783.99], downVol: 0.8,
    step: 0.12, len: 0.72, gap: 0.15, ring: [0.55, 0.55, 1.1], vol: 0.22,
    partials: [[1, 1, 1], [2, 0.22, 0.45], [4, 0.05, 0.1]], // [倍音, 大きさ, 響く長さの割合]
  };
  let irCache = null;
  function chimeIR(ctx, rnd) { // 薄い残響（左右で別の雑音・あとほどこもる）
    if (irCache && irCache.ctx === ctx) return irCache.buf;
    const sr = ctx.sampleRate, n = Math.floor(sr * 1.0), b = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { const t = i / sr, k = Math.max(0.06, 0.5 - t * 0.45); lp += k * ((rnd() * 2 - 1) - lp); d[i] = t < 0.012 ? 0 : lp * Math.pow(10, -3 * t / 0.9); }
    }
    irCache = { ctx, buf: b };
    return b;
  }
  // チャイムの通り道（入口を返す）: 音量 → 高域カット → そのまま＋残響 → out
  function chimeBus(ctx, out, rnd) {
    const inp = ctx.createGain(); inp.gain.value = CHIME.vol;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(5500, ctx.sampleRate * 0.45); lp.Q.value = 0.5;
    const conv = ctx.createConvolver(); conv.buffer = chimeIR(ctx, rnd);
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    inp.connect(lp); lp.connect(out); lp.connect(conv); conv.connect(wet); wet.connect(out);
    return inp;
  }
  // チャイム 1 回を ctx の時刻 t から予約する。返す: { kind: 'chime', dir, at, len, notes: [{ f, at }] }
  function chime(ctx, dest, dir, t) {
    const F = CHIME[dir], v = dir === 'down' ? CHIME.downVol : 1, notes = [];
    F.forEach((f, i) => {
      const t1 = t + i * CHIME.step; notes.push({ f, at: t1 });
      CHIME.partials.forEach(([m, a, k]) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), end = t1 + CHIME.ring[i] * k, pk = v * a;
        o.type = 'sine'; o.frequency.value = f * m;
        g.gain.setValueAtTime(0, t1); g.gain.linearRampToValueAtTime(pk, t1 + 0.005); g.gain.exponentialRampToValueAtTime(pk * 0.001, end); g.gain.linearRampToValueAtTime(0, end + 0.015);
        o.connect(g); g.connect(dest); o.start(t1); o.stop(end + 0.02);
      });
    });
    return { kind: 'chime', dir, at: t, len: CHIME.len, notes };
  }

  // ---------- 声を鳴らす（実況の声の部品・場内スピーカーの音。scene を通さない） ----------
  /* 1 回の案内（チャイム → 声 → チャイム）を ctx の時刻 t0 から予約する。dest: 出口（本番は ctx.destination。書き出し・確かめは OfflineAudioContext）。
     返す: { dur: t0 から後のチャイムの終わりまで（秒）, parts: [チャイム, { kind: 'voice', id, at, len }, チャイム], out, nodes } か null（声の部品が無い） */
  function schedule(ctx, dest, id, t0) {
    const C = root.Commentary && Commentary._, c = C && C.clipById && C.clipById(id); if (!c) return null;
    const out = ctx.createGain(); out.gain.value = 1;
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
    out.connect(lim); lim.connect(dest);
    const pa = C.buildPA(ctx, out, C.seeded(4242));
    const bus = chimeBus(ctx, out, C.seeded ? C.seeded(7171) : Math.random);
    const parts = []; let t = t0;
    parts.push(chime(ctx, bus, 'up', t)); t += CHIME.len + CHIME.gap;
    const src = ctx.createBufferSource(); src.buffer = c.buf; src.connect(pa); src.start(t, c.off, c.dur);
    parts.push({ kind: 'voice', id, at: t, len: c.dur }); t += c.dur + CHIME.gap;
    parts.push(chime(ctx, bus, 'down', t)); t += CHIME.len;
    return { dur: t - t0, parts, out, nodes: [src, pa, bus, out, lim] };
  }
  let busyUntil = 0; // テレビの時計（DERBY.now）の ms。自分の案内（後のチャイムまで）が終わる時刻（＋1.5 秒）
  let cur = null;    // いま鳴っている案内（schedule の返り値）
  const player = {
    ready() {
      const ctx = root.Sfx && Sfx.ctx && Sfx.ctx(), C = root.Commentary && Commentary._;
      if (!ctx || !C || !C.loadLib) return false;
      if (!C.Lib.ready) { if (!C.Lib.decoding && !C.Lib.failed) C.loadLib(ctx).catch(() => {}); return false; }
      return ctx.state === 'running';
    },
    // 鳴らせたら長さ（秒。前のチャイムから後のチャイムの終わりまで）、鳴らせなければ 0。消音なら何も作らない
    play(id) {
      if (A.env.muted() || !this.ready()) return 0;
      const ctx = Sfx.ctx(), s = schedule(ctx, ctx.destination, id, ctx.currentTime + 0.05); if (!s) return 0;
      cur = s;
      setTimeout(() => { s.nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* noop */ } }); if (cur === s) cur = null; }, (s.dur + 3.5) * 1000); // 響きが消えてから外す
      return s.dur + 0.05;
    },
    // 途中で止める（消音・レースが始まったとき）: 残りの声・チャイムを消す
    stop() {
      const s = cur, ctx = root.Sfx && Sfx.ctx && Sfx.ctx(); cur = null; if (!s || !ctx) return;
      try { const g = s.out.gain, t = ctx.currentTime; g.cancelScheduledValues(t); if (ctx.state === 'running') { g.setValueAtTime(g.value, t); g.setTargetAtTime(0, t, 0.03); } else g.setValueAtTime(0, t); } catch (e) { /* noop */ }
    },
  };
  // ---------- テレビの様子（tests で差し替えられる） ----------
  const Q = typeof location !== 'undefined' ? location.search : '';
  const env = {
    muted() { return /[?&](mute=1|voice=0)\b/.test(Q) || !!(root.Sfx && Sfx.isMuted && Sfx.isMuted()); },
    // ほかの声・音が鳴っている（レース・映像の再生中・実況）。自分の案内の途中は tick が busyUntil で見る
    busy() {
      const D = root.DERBY, tv = D && D.tv;
      if (D && D.phase === 'live') return true;
      if (tv && tv.playing) return true;
      return !!(root.Commentary && Commentary.active);
    },
  };
  const log = [];
  const note = (o) => { log.push(o); if (log.length > 100) log.shift(); };

  function tick() {
    const D = root.DERBY;
    if (!D || !D.v2 || D.watch || !D.state || !D.now) return;
    const t = D.now(), done = (k) => mem.has(k), C = candidates(D.state, t, D.canVote);
    // 自分の案内の途中で消音・レース・実況になったら、残り（声・後のチャイム）を止める（消音を戻したあとに続きが鳴らないように）
    if (t < busyUntil && (env.muted() || env.busy()) && A.player.stop) A.player.stop();
    const voting = C.find((r) => Number(r.openAt) <= t && t < Number(Number.isFinite(Number(r.closeAt)) ? r.closeAt : r.at)) || null; // いま投票中のレース
    for (const r of C) {
      const d = due(r, t, done); if (!d) continue;
      // 言えない: 言わずに待つ（late を過ぎたら下の skip で済ませる）。ほかのレースの投票中は、次のレースの「始まるまで あと○分」は言わない（「投票を開始しました」と食い違うので）
      if (d.item && (env.muted() || env.busy() || t < busyUntil || (voting && voting !== r && /^pre/.test(d.item.key)) || !A.player.ready())) {
        d.skip.forEach((x) => { mem.add(r.id + '|' + x.key, t); note({ t, race: r.id, key: x.key, skip: true }); });
        continue;
      }
      d.skip.forEach((x) => { mem.add(r.id + '|' + x.key, t); note({ t, race: r.id, key: x.key, skip: true }); });
      if (!d.item) continue;
      const dur = A.player.play(d.item.clip);
      if (!dur) continue; // 鳴らせなかった（部品なし）: 次の 1 秒でまた試す（late を過ぎたら言わない）
      mem.add(r.id + '|' + d.item.key, t);
      busyUntil = t + dur * 1000 + 1500;
      note({ t, race: r.id, key: d.item.key, clip: d.item.clip, late: Math.round((t - d.item.at) / 1000) });
      return; // 1 秒に 1 つだけ
    }
  }

  const A = { plan, due, candidates, isTest, CLIP, CL, GAP, LATE, LATE_OPEN, KEY, CHIME, chime, schedule, mem, player, env, log, tick, busyUntil: () => busyUntil, reset() { busyUntil = 0; cur = null; log.length = 0; } };
  if (typeof module !== 'undefined' && module.exports) { module.exports = A; return; }
  root.DerbyAnnounce = A;
  const on = /[?&]store=[^&]/.test(Q) && !/[?&]watch=1\b/.test(Q) && !(root.DERBY_FIREBASE && root.DERBY_FIREBASE.demo) && !root.__derbyDemoPage;
  if (on) setInterval(() => { try { tick(); } catch (e) { console.error('casa DERBY 投票の案内', e); } }, 1000);
})(typeof window !== 'undefined' ? window : globalThis);
