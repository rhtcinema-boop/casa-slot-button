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
   確認用: window.DerbyAnnounce（plan・due・candidates・log・player・env を差し替えられる。tests/v4-announce.test.js・tests/v4-announce.plan.js） */
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

  // ---------- 声を鳴らす（実況の声の部品・場内スピーカーの音。scene を通さない） ----------
  let busyUntil = 0; // テレビの時計（DERBY.now）の ms。自分の案内が終わる時刻（＋1.5 秒）
  const player = {
    ready() {
      const ctx = root.Sfx && Sfx.ctx && Sfx.ctx(), C = root.Commentary && Commentary._;
      if (!ctx || !C || !C.loadLib) return false;
      if (!C.Lib.ready) { if (!C.Lib.decoding && !C.Lib.failed) C.loadLib(ctx).catch(() => {}); return false; }
      return ctx.state === 'running';
    },
    // 鳴らせたら長さ（秒）、鳴らせなければ 0
    play(id) {
      const ctx = root.Sfx && Sfx.ctx && Sfx.ctx(), C = root.Commentary && Commentary._;
      if (!this.ready()) return 0;
      const c = C.clipById(id); if (!c) return 0;
      const out = ctx.createGain(); out.gain.value = 1;
      const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
      out.connect(lim); lim.connect(ctx.destination);
      const pa = C.buildPA(ctx, out, C.seeded(4242));
      const src = ctx.createBufferSource(); src.buffer = c.buf; src.connect(pa);
      src.start(ctx.currentTime + 0.05, c.off, c.dur);
      setTimeout(() => { try { src.disconnect(); pa.disconnect(); out.disconnect(); lim.disconnect(); } catch (e) { /* noop */ } }, (c.dur + 3) * 1000); // 残響が消えてから外す
      return c.dur;
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

  const A = { plan, due, candidates, isTest, CLIP, CL, GAP, LATE, LATE_OPEN, KEY, mem, player, env, log, tick, reset() { busyUntil = 0; log.length = 0; } };
  if (typeof module !== 'undefined' && module.exports) { module.exports = A; return; }
  root.DerbyAnnounce = A;
  const on = /[?&]store=[^&]/.test(Q) && !/[?&]watch=1\b/.test(Q) && !(root.DERBY_FIREBASE && root.DERBY_FIREBASE.demo) && !root.__derbyDemoPage;
  if (on) setInterval(() => { try { tick(); } catch (e) { console.error('casa DERBY 投票の案内', e); } }, 1000);
})(typeof window !== 'undefined' ? window : globalThis);
