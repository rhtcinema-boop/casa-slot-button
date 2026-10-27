/* casa DERBY v2 Firestore 版（本番用）: window.DerbyFirestore
   DerbyCloud（v2/client.js）と同じ関数・同じ返り値の形で、模擬クラウド（v2/server.js）の代わりに Firestore を使う。
   - サーバーはない。結果を決めるのは「決める係のテレビ」（方式 B・オーナー決定 2026-10-14）:
     テレビ用のアカウントでログインしたテレビが derbyLock/decider をトランザクションで取り合い（60 秒の期限を、残り 40 秒を切ったら延長。見回りは 2 秒ごと）、
     持っている 1 台だけが レースを作る・締切で決める・発表・期限切れ・参加人数 を書く。止まったら期限切れで別のテレビが引き継ぐ。
     決める処理は何度やっても同じ結果（seed・払い戻しの id は salt とレース id から決まる。状態はトランザクションで 1 回だけ進める）。
   - 結果（seed）は derbyResults に分けて置き、ルールでゲートが開く時刻（runAt）まで読めない。払い戻しの設定額は derbyRaceSecrets（マスターと決める係だけ）。
   - データの形・ルールは v2/FIRESTORE_PLAN.md と v2/firestore.rules。テストは tests/v2-firestore.test.js（にせ Firestore: v2/fake-firestore.js）。
   使い方: DerbyFirestore.create(opts, env)。env = { fb: { db, auth, FieldValue, Timestamp }, Engine, Outcome, Core, config, now? }
           ブラウザでは DerbyFirestore.connect(config) が SDK を読み込んで env を作る（v2/client.js が自動で使う）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DerbyFirestore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/'; // casa SLOT と同じ版（compat）
  const COL = { live: 'derbyLive', counts: 'derbyCounts', stores: 'derbyStores', pins: 'derbyPins', staff: 'derbyStaff', config: 'derbyConfig', races: 'derbyRaces', results: 'derbyResults', secrets: 'derbyRaceSecrets', votes: 'derbyVotes', payouts: 'derbyPayouts', logs: 'derbyLogs', stats: 'derbyStats', lock: 'derbyLock', clock: 'derbyClock', tvSwitch: 'derbySwitch', schedule: 'derbySchedule', tvs: 'derbyTvs', deciders: 'derbyDeciders', testReq: 'derbyTestReq', devices: 'derbyDevices', bonus: 'derbyBonus' }; /* tvs・deciders: 進行役のテレビ／testReq: この店だけテストレース（2026-10-19）／devices・bonus: 端末のリストと初参加ボーナスの印（2026-10-24） */
  const LEASE_MS = 60000, RENEW_MS = 40000, BEAT_MS = 2000, CLOSING_STALE_MS = 20000;
  const randId = (p, n) => { let s = ''; const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return p + s; };

  /* ---------- 入れ子の配列の変換（2026-10-18 本番で発覚） ----------
     本物の Firestore は「配列の中に配列」を保存できない（例: derbyRaces・derbyLive の tenkai）。
     書くときに、配列の中の配列を { derbyNestedArray_v1: [...] } という地図に包み、読むときに元へ戻す。
     この層は db の一番外側（create の中）で全部の読み書きにかかるので、core.js・tv.js などには元の形のまま渡る。
     地図・数・文字・Timestamp・FieldValue はそのまま。印の名前は他のデータでは使わない。 */
  const NA = 'derbyNestedArray_v1';
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  function encodeFS(v, inArray) {
    if (Array.isArray(v)) { const a = v.map((x) => encodeFS(x, true)); if (!inArray) return a; const o = {}; o[NA] = a; return o; }
    if (isPlain(v)) { const o = {}; Object.keys(v).forEach((k) => (o[k] = encodeFS(v[k], false))); return o; }
    return v;
  }
  function decodeFS(v) {
    if (Array.isArray(v)) return v.map(decodeFS);
    if (isPlain(v)) {
      const ks = Object.keys(v);
      if (ks.length === 1 && ks[0] === NA && Array.isArray(v[NA])) return v[NA].map(decodeFS);
      const o = {}; ks.forEach((k) => (o[k] = decodeFS(v[k]))); return o;
    }
    return v;
  }
  const encodePatch = (p) => { const o = {}; Object.keys(p || {}).forEach((k) => (o[k] = encodeFS(p[k], false))); return o; };
  const rawOf = (r) => (r && r._derbyRaw) || r;
  function wrapDocSnap(sn) {
    if (!sn) return sn;
    return { id: sn.id, exists: sn.exists, get ref() { return wrapRef(sn.ref); }, data: () => decodeFS(sn.data()), get: (f) => decodeFS(sn.get(f)), _derbyRaw: sn };
  }
  function wrapQuerySnap(q) { const docs = q.docs.map(wrapDocSnap); return { docs, size: q.size, empty: q.empty, forEach: (fn) => docs.forEach(fn), _derbyRaw: q }; }
  function wrapRef(r) {
    if (!r || r._derbyRaw) return r;
    return {
      id: r.id, path: r.path, _derbyRaw: r,
      collection: (c) => wrapColl(r.collection(c)),
      get: (o) => r.get(o).then(wrapDocSnap),
      set: (d, o) => (o === undefined ? r.set(encodeFS(d, false)) : r.set(encodeFS(d, false), o)),
      update: (p) => r.update(encodePatch(p)),
      delete: () => r.delete(),
      onSnapshot: (cb, ecb) => r.onSnapshot((sn) => cb(wrapDocSnap(sn)), ecb),
    };
  }
  function wrapQuery(q) {
    return {
      _derbyRaw: q,
      where: (a, b, c) => wrapQuery(q.where(a, b, c)),
      orderBy: (a, b) => wrapQuery(b === undefined ? q.orderBy(a) : q.orderBy(a, b)),
      limit: (n) => wrapQuery(q.limit(n)),
      get: (o) => q.get(o).then(wrapQuerySnap),
      onSnapshot: (cb, ecb) => q.onSnapshot((s) => cb(wrapQuerySnap(s)), ecb),
    };
  }
  function wrapColl(c) {
    return Object.assign(wrapQuery(c), { id: c.id, path: c.path, doc: (id) => wrapRef(id === undefined ? c.doc() : c.doc(id)), add: (d) => c.add(encodeFS(d, false)).then(wrapRef) });
  }
  function wrapDb(db) {
    if (!db || db._derbyRaw) return db;
    const out = {
      _derbyRaw: db,
      collection: (c) => wrapColl(db.collection(c)),
      doc: (p) => wrapRef(db.doc(p)),
      runTransaction: (fn) => db.runTransaction((tx) => {
        const w = {
          get: (ref) => tx.get(rawOf(ref)).then(wrapDocSnap),
          set: (ref, d, o) => { if (o === undefined) tx.set(rawOf(ref), encodeFS(d, false)); else tx.set(rawOf(ref), encodeFS(d, false), o); return w; },
          update: (ref, p) => { tx.update(rawOf(ref), encodePatch(p)); return w; },
          delete: (ref) => { tx.delete(rawOf(ref)); return w; },
        };
        return fn(w);
      }),
      batch: () => {
        const b = db.batch();
        const w = {
          set: (ref, d, o) => { if (o === undefined) b.set(rawOf(ref), encodeFS(d, false)); else b.set(rawOf(ref), encodeFS(d, false), o); return w; },
          update: (ref, p) => { b.update(rawOf(ref), encodePatch(p)); return w; },
          delete: (ref) => { b.delete(rawOf(ref)); return w; },
          commit: () => b.commit(),
        };
        return w;
      },
    };
    if (db.enablePersistence) out.enablePersistence = (...a) => db.enablePersistence(...a);
    return out;
  }

  /* ---------- ブラウザ: SDK を読み込んでつなぐ（casa SLOT の js/cloud.js と同じやり方） ---------- */
  let connectP = null;
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); }); }
  function connect(config) {
    if (connectP) return connectP;
    connectP = (async () => {
      for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']) await loadScript(SDK + f);
      /* global firebase */
      const app = firebase.apps.find((a) => a.name === 'derby') || firebase.initializeApp(config.firebase, 'derby'); // casa SLOT と同じページに入っても混ざらないよう名前つき
      const db = app.firestore();
      const newApp = (name) => firebase.initializeApp(config.firebase, name); /* テレビ用アカウントを作るときの 2 つ目の app（マスターのログインを入れ替えない） */
      return { fb: { db, auth: app.auth(), FieldValue: firebase.firestore.FieldValue, Timestamp: firebase.firestore.Timestamp, newApp }, config };
    })().catch((e) => { connectP = null; throw e; });
    return connectP;
  }

  function create(opts, env) {
    opts = opts || {};
    const role = opts.role || 'tv', store = opts.store || null;
    const { fb, Engine, Outcome, Core } = env, cfg = env.config || {};
    const { auth, FieldValue, Timestamp } = fb;
    const db = wrapDb(fb.db); /* 入れ子の配列を自動で包む・戻す（上の encodeFS / decodeFS） */
    const E = Core.err;
    let offset = 0, synced = false;
    const local = env.now || (() => Date.now());
    const now = () => local() + offset;
    const Ts = (ms) => Timestamp.fromMillis(Math.round(ms));
    const doc = (c, id) => db.collection(c).doc(id);
    const data = (snap) => (snap && snap.exists ? Object.assign({ _id: snap.id }, snap.data()) : null);

    /* ---------- ログイン ---------- */
    let readyP = null, mode = 'anon';
    /* まとめた書き込みの大きさ（2026-10-19）: 進行役のテレビ（匿名ログイン＋derbyDeciders）は、ルールが 1 件ごとに derbyDeciders を 1 回読むので、
       1 回のまとめた書き込み（20 件まで読める）を 15 件以下に分ける。マスター・テレビ用アカウントはメールで決まる（読まない）ので今までどおり大きく */
    const cap = (big, small) => (mode === 'tv' || mode === 'master' ? big : small);
    async function ready() {
      if (!readyP) readyP = (async () => {
        if (!auth.currentUser) {
          const tvPass = role === 'tv' && cfg.tvEmail ? (opts.tvPassword || readTvPass()) : null;
          if (tvPass) { try { await auth.signInWithEmailAndPassword(cfg.tvEmail, tvPass); mode = 'tv'; } catch (e) { await auth.signInAnonymously(); } }
          else await auth.signInAnonymously();
        } else mode = auth.currentUser.email && auth.currentUser.email === cfg.tvEmail ? 'tv' : auth.currentUser.email ? 'master' : 'anon';
        try { await auth.currentUser.getIdToken(); } catch (e) { /* noop */ }
        await syncClock(role === 'tv' ? 3 : 1).catch(() => {});
        if (mode === 'tv' && opts.decider !== false) startDecider();
        else if (mode === 'anon' && role === 'tv') startPair(); // 進行役のテレビ（管理画面の 1 タップ）: パスワードのないテレビは名乗って、選ばれたら決める係になる
      })().catch((e) => { readyP = null; throw e; });
      return readyP;
    }
    function readTvPass() { // テレビ用のパスワード: ?tvkey=... で 1 回開くと、そのテレビに覚える（URL からは消す）
      try {
        if (typeof location !== 'undefined') { const m = /[?&]tvkey=([^&]+)/.exec(location.search); if (m) { localStorage.setItem('casa.derby.tvkey', decodeURIComponent(m[1])); history.replaceState(null, '', location.href.replace(/([?&])tvkey=[^&]*&?/, '$1').replace(/[?&]$/, '')); } }
        return localStorage.getItem('casa.derby.tvkey');
      } catch (e) { return null; }
    }
    const uid = () => (auth.currentUser ? auth.currentUser.uid : null);
    // Firestore の失敗を DerbyCloud と同じ形のエラーに
    function mapErr(e, permCode, permMsg, status) {
      if (e && e.status) return e;
      if (e && e.code === 'permission-denied') { if (role === 'staff') staffOk = null; return E(status || 403, permCode || 'permission', permMsg || '権限がありません'); } // スタッフ: PIN が変わったなど → 次の操作で登録し直す（以前は覚えたままで、ずっと「権限がありません」）
      if (e && (e.code === 'unavailable' || e.code === 'deadline-exceeded')) return E(0, 'network', '通信できません。電波を確認してください');
      return E(500, 'server', 'エラー: ' + ((e && e.message) || e));
    }

    /* ---------- 時刻合わせ（serverTimestamp を書いて読み戻す） ---------- */
    async function syncClock(n) {
      n = n || 3; let best = null;
      for (let i = 0; i < n; i++) {
        const t0 = local(); const ref = doc(COL.clock, uid());
        await ref.set({ t: FieldValue.serverTimestamp() }); const s = await ref.get(); const t1 = local();
        const st = s.data().t, sv = st && st.toMillis ? st.toMillis() : null;
        if (sv != null && (!best || t1 - t0 < best.rtt)) best = { rtt: t1 - t0, off: sv + (t1 - t0) / 2 - t1 };
      }
      if (best) { offset = best.off; synced = true; }
      return { offset, rtt: best ? best.rtt : null };
    }

    /* ---------- 読み込み（キャッシュつき） ---------- */
    let storesCache = null, storesAt = 0, pubCache = null, pubAt = 0;
    const live = { races: null, subs: 0, votes: {}, payouts: {}, watch2: {} }; // 見張りで届いた写し（state・myVote は読み取りなしで答える）。watch2: 2 票目も見張っている 1 票目の vid
    async function getStores(force) {
      if (!force && storesCache && (local() - storesAt < 30000 || live.subs > 0)) return storesCache; // 見張り中は変わったときに届くので読み直さない
      const q = await db.collection(COL.stores).get();
      storesCache = q.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name), 'ja'));
      storesAt = local(); return storesCache;
    }
    const storeNameOf = (list) => (id) => { const s = (list || storesCache || []).find((x) => x.id === id); return s ? s.name : id; };
    async function getPublic(force) {
      if (!force && pubCache && (local() - pubAt < 30000 || live.subs > 0)) return pubCache;
      const s = await doc(COL.config, 'public').get(); pubCache = Object.assign({}, Core.DEFAULT_TUNING, s.exists ? s.data() : {}); pubAt = local(); return pubCache;
    }
    /* 公開の時刻表 derbySchedule/public（2026-10-27 本日の出走時間）: Core.stateFor に rules を渡して today（この営業日のこの店のレースの時刻）を付けるために読む。
       ログインなしでも読める（ルール read: if true）のでスマホも読む。管理画面が保存したときだけ変わるので 5 分は読み直さない。レースの一覧が変わったとき（見張りで届いたとき）は次に読み直す。
       読めなかったときは前の値（無ければ空の時刻表）で続ける＝today が空になるだけ */
    let schedCache = null, schedAt = 0, schedDirty = false;
    const SCHED_TTL = 5 * 60000;
    async function getSchedule(force) {
      if (!force && schedCache && !schedDirty && local() - schedAt < SCHED_TTL) return schedCache;
      try { const s = await doc(COL.schedule, 'public').get(); schedCache = Object.assign({ rules: [] }, s.exists ? s.data() : {}); } catch (e) { schedCache = schedCache || { rules: [] }; }
      schedAt = local(); schedDirty = false; return schedCache;
    }
    const WINDOW = (role === 'tv' ? 120 : role === 'staff' ? 60 : 30) * 60000; // 見るレースの範囲（テレビは前のレースのハイライトがあるので 2 時間、スタッフ 1 時間、スマホ 30 分）
    async function getRaces(fresh) { if (!fresh && live.subs > 0 && live.races) return live.races; const q = await db.collection(COL.races).where('at', '>=', now() - WINDOW).orderBy('at').get(); return q.docs.map((d) => d.data()); }
    const resultCache = {};
    async function resultsFor(races) { // テレビ: ゲートが開く 2 秒前から結果（seed）を読む（ルールで runAt まで読めない）
      if (role !== 'tv') return {};
      const t = now(), out = {};
      for (const r of races) {
        if (resultCache[r.id]) { out[r.id] = resultCache[r.id]; continue; }
        if ((r.status === 'decided' || r.status === 'done') && (t >= r.runAt - 2000 || canDecide())) { /* テレビ用アカウント（ルールの isDecider）は決まった直後から読める＝確定演出（ゲートインの遅れ）をゲートインの前に渡せる */
          try { const s = await doc(COL.results, r.id).get(); if (s.exists) { const x = s.data(); resultCache[r.id] = { winner: x.winner, second: x.second, combo: x.combo, comboOdds: x.comboOdds, order: x.order, finalExacta: x.finalExacta, finalOdds: x.finalOdds, seed: x.seed, finishTimes: x.finishTimes, winTime: x.winTime, natural: x.natural, cues: x.cues || null }; out[r.id] = resultCache[r.id]; } } catch (e) { /* まだ読めない */ } /* cues: 確定演出（derbyResults にだけ。derbyRaces・derbyLive には写さない） */
        }
      }
      return out;
    }
    let countsCache = null;
    const withCounts = (races, counts) => (counts ? races.map((r) => (r.status === 'upcoming' && counts[r.id] ? Object.assign({}, r, { participants: counts[r.id] }) : r)) : races);
    async function compose(s, races, stores, pub) {
      s = s || store;
      if (role !== 'phone') { if (!countsCache || live.subs === 0) { try { const c = await doc(COL.counts, 'live').get(); countsCache = c.exists ? c.data() : {}; } catch (e) { countsCache = {}; } } races = withCounts(races, countsCache); }
      const sched = await getSchedule(); // 本日の出走時間（2026-10-27）: 公開の時刻表の決まり → state.today
      return Core.stateFor({ t: now(), store: s, role, stores, races, tuning: pub, results: await resultsFor(races.filter((r) => Core.visibleTo(r, s))), rules: Array.isArray(sched.rules) ? sched.rules : [] });
    }
    // スマホ: 見張っていなければ「いまの状態」1 件を読む（レースの一覧を問い合わせない）
    async function phoneLive(storeId) { if (role !== 'phone') return null; try { return data(await doc(COL.live, storeId).get()); } catch (e) { return null; } }
    async function openRace(storeId) {
      if (role === 'phone' && !(live.subs > 0 && live.races)) { const d = await phoneLive(storeId); if (d) return Core.openRaceFor(d.races || [], storeId, now()); }
      return Core.openRaceFor(await getRaces(), storeId, now());
    }

    /* ---------- 共通 ---------- */
    async function state(s) { await ready(); try {
      if (role === 'phone' && !(live.subs > 0 && live.races)) { const d = await phoneLive(s || store); if (d) return compose(s, d.races || [], d.stores || [], Object.assign({}, Core.DEFAULT_TUNING, d.pub || {})); } const [stores, races, pub] = await Promise.all([getStores(), getRaces(), getPublic()]); return compose(s, races, stores, pub); } catch (e) { throw mapErr(e); } }
    async function race(id) {
      await ready();
      const r = data(await doc(COL.races, id).get()); if (!r) throw E(404, 'no_race', 'レースが見つかりません');
      const stores = await getStores(), st = stores.find((x) => x.id === store);
      return Core.publicRace(r, { role, store, storeSettings: st && st.settings, openId: (Core.openRaceFor(await getRaces(), store, now()) || {}).id, result: (await resultsFor([r]))[r.id] });
    }

    /* ---------- スマホ（v4: 参加無料・1 票 ＝ 店＋会計番号 2 けた・2 連単） ----------
       票は derbyVotes/<レース id>~<店>~<会計番号>（Core.voteId）。持ち主（owner）は最初に投票したスマホの匿名ログインの uid。
       選び直しは持ち主だけ（ルール）。ほかのスマホが同じ番号で投票しようとすると読めない（ルールで拒否）→ 409 bill_taken。
       まだ誰も使っていない番号の票は「無い」と読める（ルール: resource == null）＝ 番号が空いているかが分かる */
    const effPay = (p) => (p && p.status === 'unpaid' && p.expireAt != null && now() >= p.expireAt ? Object.assign({}, p, { status: 'expired' }) : p);
    async function raceFor(id) { return (live.subs > 0 && live.races && live.races.find((x) => x.id === id)) || data(await doc(COL.races, id).get()); }
    /* ---------- 端末のリストと初参加ボーナス（2026-10-24。Core の「端末 ID と 初参加ボーナス」） ----------
       端末 ID ＝ 匿名ログインの uid。derbyDevices/<uid> はこのスマホだけが読み書きできる（ルール）。本物のレースの 1 票目を作ったあとに書く（失敗しても投票はそのまま）。
       2 票目（derbyVotes/<1 票目の id>~2）と使った印（derbyBonus/<営業日>~<店>~<会計番号>）は 1 回のまとめた書き込みで作る（ルールが印の有無・端末の初めてのレースを確かめる）。
       ルールを貼る前（古いルール）は端末のリストが読めない → ボーナスを出さない（投票はふつうにできる） */
    let devCache; // undefined: まだ読んでいない / null: 無い / { ... } / 'err'（読めない＝古いルール）
    async function myDevice() {
      if (devCache !== undefined) return devCache;
      try { devCache = data(await doc(COL.devices, uid()).get()); } catch (e) { devCache = 'err'; }
      return devCache;
    }
    async function touchDevice(r, sid, t) {
      const dev = await myDevice(); if (dev === 'err') return;
      const pl = Core.devicePlan(dev, r.id, sid, t); if (!pl) return;
      const ref = doc(COL.devices, uid());
      try { if (pl.create) { await ref.set(pl.create); devCache = pl.create; } else { await ref.update(pl.update); devCache = Object.assign({}, dev, pl.update); } } catch (e) { devCache = undefined; }
    }
    const raceDay = (r) => r.day || Core.bizDate(r.at, (pubCache || Core.DEFAULT_TUNING).dayStartHour);
    const bonusMemo = {}; // 1 票目の vid → いま 2 票目を入れられるか（端末と印を 1 回だけ読む。2 票目を作った・番号を空けられたら消す）
    async function bonusCan(v1, r, v2) {
      if (!v1 || v2 || !r || !Core.votingOpen(r, now())) return false;
      if (bonusMemo[v1.vid] !== undefined) return bonusMemo[v1.vid];
      const dev = await myDevice(); let ok = false;
      if (dev !== 'err' && Core.bonusDeviceOk(dev, r.id)) {
        if (v1.test) ok = true; // テストの票は印を見ない（本物の印を使い切らない）
        else { try { ok = !(await doc(COL.bonus, Core.bonusKey(raceDay(r), v1.storeId, v1.bill)).get()).exists; } catch (e) { ok = false; } } // 人の印は読めない（＝使われている）
      }
      bonusMemo[v1.vid] = ok; return ok;
    }
    async function readVote(vid) { if (live.votes[vid]) return live.votes[vid]; try { return data(await doc(COL.votes, vid).get()); } catch (e) { return null; } }
    // スマホに返す票の組: { vote（1 票目）, vote2（2 票目 | null）, bonus（いま 2 票目を入れられる）, r（レース） }
    async function pairOf(v1, v2) {
      const b1 = await voteBundle(v1), b2 = v2 ? await voteBundle(v2) : null;
      return { vote: Core.voteView(v1, b1.r, b1.p), vote2: v2 ? Core.voteView(v2, b2.r, b2.p) : null, bonus: await bonusCan(v1, b1.r, v2), r: b1.r };
    }
    async function vote(o) {
      await ready(); o = o || {};
      const sid = (o && o.store) || store, pl = role === 'phone' && !(live.subs > 0 && live.races) ? await phoneLive(sid) : null;
      const races = pl ? pl.races || [] : await getRaces(), stores = pl ? pl.stores || [] : await getStores(), st = stores.find((x) => x.id === sid);
      if (!st) throw E(404, 'no_store', '店舗が見つかりません');
      const openId = () => (Core.openRaceFor(races, sid, now()) || {}).id || null;
      const r = o.raceId ? races.find((x) => x.id === o.raceId) || data(await doc(COL.races, String(o.raceId)).get()) : Core.currentRaceFor(races, sid, now());
      if (!r || !Core.visibleTo(r, sid)) throw E(409, o.raceId ? 'closed' : 'no_open_race', o.raceId ? 'このレースは締め切りました' : 'いま投票できるレースがありません', { openId: openId() });
      if (!Core.canVote(r, sid)) throw Core.notMyStore(r, storeNameOf(stores)); // 2026-10-26「このレースはこの店だけ」: 見るだけの店からは投票できない（409 not_my_store。ルールの voteOpen も同じ）
      const c = Core.cleanVote(o, (r.horses || []).length || 6), t = now();
      if (r.status !== 'upcoming' || t >= r.closeAt) throw E(409, 'closed', '締め切りました', { openId: openId() });
      const ow = Core.voteWindow(r).openAt;
      if (t < ow) throw E(409, 'not_open', '投票はまだ始まっていません（' + Core.fmtTime(ow) + ' から）', { raceId: r.id, openAt: ow, at: r.at });
      const raceOut = () => Core.publicRace(r, { role: 'phone', store: sid, storeSettings: st.settings, openId: r.id });
      if (Number(o.n) === 2) { // 初参加ボーナスの 2 票目（初めて・選び直し）
        const vid1 = Core.voteId(r.id, sid, c.bill), vid2 = vid1 + '~2', ref2 = doc(COL.votes, vid2);
        let v1 = null; try { v1 = live.votes[vid1] || data(await doc(COL.votes, vid1).get()); } catch (e) { if (!(e && e.code === 'permission-denied')) throw mapErr(e); }
        if (!v1 || v1.owner !== uid()) throw E(409, 'bill_taken', 'この会計番号はもう投票に使われています。スタッフに伝えてください', { bill: c.bill });
        let v2 = await readVote(vid2);
        try {
          if (v2) { const patch = { nick: c.nick, first: c.first, second: c.second, updatedAt: t }; await ref2.update(patch); v2 = Object.assign(v2, patch); }
          else {
            if (!(await bonusCan(v1, r, null))) throw E(409, 'no_bonus', '初参加ボーナスの 2 票目は使えません（このスマホの初めてのレースで、その日その番号で 1 回だけ）');
            v2 = { vid: vid2, raceId: r.id, storeId: sid, bill: v1.bill, nick: c.nick, first: c.first, second: c.second, owner: uid(), votedAt: t, updatedAt: t, test: !!v1.test, n: 2 };
            const b = db.batch(); b.set(ref2, v2);
            if (!v1.test) { const day = raceDay(r); b.set(doc(COL.bonus, Core.bonusKey(day, sid, v1.bill)), { day, storeId: sid, bill: v1.bill, raceId: r.id, owner: uid(), at: t }); }
            await b.commit(); bonusMemo[vid1] = false;
          }
        } catch (e) {
          if (e && e.code === 'no_bonus') throw e;
          if (e && e.code === 'permission-denied') { bonusMemo[vid1] = false; const r2 = data(await doc(COL.races, r.id).get().catch(() => null)); if (r2 && r2.status === 'upcoming' && now() < r2.closeAt) throw E(409, 'no_bonus', '初参加ボーナスの 2 票目は使えません'); throw E(409, 'closed', '締め切りました', { openId: openId() }); }
          throw mapErr(e);
        }
        if (live.votes[vid2]) live.votes[vid2] = v2;
        const pr = await pairOf(v1, v2);
        return { vote: pr.vote, vote2: pr.vote2, bonus: pr.bonus, key: 'uid', race: raceOut() };
      }
      const vid = Core.voteId(r.id, sid, c.bill), ref = doc(COL.votes, vid);
      let mine = null, taken = false;
      try { mine = data(await ref.get()); } catch (e) { if (e && e.code === 'permission-denied') taken = true; else throw mapErr(e); }
      if (taken) throw E(409, 'bill_taken', 'この会計番号はもう投票に使われています。スタッフに伝えてください', { bill: c.bill });
      let v;
      try {
        if (mine) { const patch = { nick: c.nick, first: c.first, second: c.second, updatedAt: t }; await ref.update(patch); v = Object.assign(mine, patch); }
        else { v = { vid, raceId: r.id, storeId: sid, bill: c.bill, nick: c.nick, first: c.first, second: c.second, owner: uid(), votedAt: t, updatedAt: t, test: !!(r.test || (st.settings && st.settings.test)) }; await ref.set(v); }
      } catch (e) {
        if (e && e.code === 'permission-denied') { const r2 = data(await doc(COL.races, r.id).get().catch(() => null)); if (r2 && r2.status === 'upcoming' && now() < r2.closeAt) throw E(409, 'bill_taken', 'この会計番号はもう投票に使われています。スタッフに伝えてください', { bill: c.bill }); throw E(409, 'closed', '締め切りました', { openId: openId() }); }
        throw mapErr(e);
      }
      if (live.votes[vid]) live.votes[vid] = v; // 見張り中の写しだけ直す（見張っていない票は写しを持たない＝決める係の書いた当たりの印を見落とさない）
      if (!mine && !v.test) await touchDevice(r, sid, t); // 端末のリスト（本物のレースの 1 票目だけ）
      const pr = await pairOf(v, mine ? await readVote(vid + '~2') : null); // 新しい 1 票目に 2 票目は無い（番号を空けると両方消える）
      return { vote: pr.vote, vote2: pr.vote2, bonus: pr.bonus, key: 'uid', race: raceOut() };
    }
    async function voteBundle(v) {
      const r = await raceFor(v.raceId);
      let p = null;
      if (r && r.status === 'done' && v.payoutId) { p = live.payouts[v.payoutId] || null; if (!p) { try { p = data(await doc(COL.payouts, v.payoutId).get()); } catch (e) { p = null; } } }
      return { r, p: effPay(p) };
    }
    // 自分の票の組 → { vote（1 票目）, vote2（初参加ボーナスの 2 票目 | null）, bonus, race }。vid は 2 票目の id でもよい
    async function myVote(vid) {
      await ready();
      const base = Core.baseVid(vid);
      let v = live.votes[base] || null;
      if (!v) { try { v = data(await doc(COL.votes, base).get()); } catch (e) { v = null; } }
      if (!v || v.owner !== uid()) throw E(404, 'no_vote', '票が見つかりません（番号を空けられたか、別のスマホの票です）');
      const v2 = live.watch2[base] ? live.votes[base + '~2'] || null : await readVote(base + '~2'); // 見張っていれば写しが正しい（読まない）
      const pr = await pairOf(v, v2 && v2.owner === uid() ? v2 : null);
      return { vote: pr.vote, vote2: pr.vote2, bonus: pr.bonus, race: Core.publicRace(pr.r, { role: 'phone', store: v.storeId }) };
    }
    // 受け取りの確かめ（取引の中。スタッフ・お客さんのスライド共通）
    function claimCheck(s, rr, names) {
      if (!s) throw E(404, 'no_payout', '当たりが見つかりません');
      if (s.revealAt > now()) throw E(409, 'not_revealed', 'まだ結果の発表前です');
      if (s.status === 'void') throw E(409, 'void', 'このレースは取り消しになりました');
      if (s.status === 'expired' || (s.status === 'unpaid' && s.expireAt && now() >= s.expireAt)) throw E(409, 'expired', '受け取りの期限が切れています（営業日が変わったので無効）', { payout: Core.payoutView(s, names, true) });
      if (s.status === 'paid') throw E(409, 'already_paid', 'もう受け取り済みです（' + Core.fmtTime(s.paidAt) + '）', { payout: Core.payoutView(s, names, true) });
      if (rr && rr.refunded) throw E(409, 'void', 'このレースは取り消しになりました');
    }
    // お客さんのスマホのスライドで「受け取った」（持ち主だけ。ルール: owner == uid・発表のあと・期限の前・unpaid → paid・paidVia 'self'）
    async function claimSelf(vid) {
      await ready();
      const got = await myVote(vid), v = got.vote, race0 = got.race;
      if (!race0 || race0.status !== 'done') throw E(409, 'not_revealed', 'まだ結果の発表前です');
      if (v.test) throw E(409, 'test_race', 'テストなので受け取りはありません');
      const raw = live.votes[vid] || data(await doc(COL.votes, vid).get());
      if (!raw || !raw.payoutId) throw E(409, 'no_win', 'この票は当たりではありません');
      const ref = doc(COL.payouts, raw.payoutId), names = storeNameOf(await getStores().catch(() => null));
      try {
        const p = await db.runTransaction(async (tx) => {
          const s = data(await tx.get(ref)), rr = s ? data(await tx.get(doc(COL.races, s.raceId))) : null;
          claimCheck(s, rr, names);
          const patch = { status: 'paid', paidAt: now(), paidBy: uid(), paidVia: 'self' };
          tx.update(ref, patch); return Object.assign(s, patch);
        });
        live.payouts[p.pid] = p;
        return { payout: Core.payoutView(p, names, true), vote: Core.voteView(raw, race0, p) };
      } catch (e) { throw mapErr(e); }
    }

    /* ---------- スタッフ ---------- */
    let staffOk = null; // `${store}|${pin}`
    async function staffEnsure(pin) {
      await ready();
      const k = store + '|' + pin; if (staffOk === k) return;
      try { await doc(COL.staff, uid()).set({ storeId: store, pin: String(pin || ''), at: now() }); staffOk = k; }
      catch (e) { if (e && e.code === 'permission-denied') throw E(401, 'bad_pin', '暗証番号がちがいます'); throw mapErr(e); }
    }
    async function staffLogin(pin) { await staffEnsure(pin); const s = (await getStores()).find((x) => x.id === store); return { ok: true, id: store, name: s ? s.name : store }; }
    async function addLog(entry, tx) {
      const t = now(), pub = await getPublic();
      const ref = entry._id ? doc(COL.logs, entry._id) : db.collection(COL.logs).doc();
      const row = Object.assign({ at: t, date: Core.bizDate(t, pub.dayStartHour), cal: Core.dateStr(t) }, entry); delete row._id;
      Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
      if (tx) tx.set(ref, row); else await ref.set(row);
    }
    async function readPayoutAsStaff(code) {
      const pid = Core.parseCode(code).id;
      let p; try { p = data(await doc(COL.payouts, String(pid || '')).get()); } catch (e) { if (e && e.code === 'permission-denied') { staffOk = null; throw E(403, 'wrong_store', 'ほかの店舗の当たりか、見つからないか、まだ結果の発表前です'); } throw mapErr(e); }
      if (!p) throw E(404, 'no_payout', '当たりが見つかりません');
      return p;
    }
    async function staffPayout(pin, code) { await staffEnsure(pin); const p = effPay(await readPayoutAsStaff(code)); return { payout: Core.payoutView(p, storeNameOf(await getStores()), p.revealAt <= now()) }; }
    // スタッフのスマホの「今日の当たり一覧」から「渡した」（ルール: その店のスタッフ・発表のあと・期限の前・unpaid → paid・paidVia 'staff'）
    async function claim(pin, code) {
      await staffEnsure(pin);
      const p0 = await readPayoutAsStaff(code), ref = doc(COL.payouts, p0.pid), names = storeNameOf(await getStores());
      if (p0.storeId !== store) throw E(403, 'wrong_store', 'ほかの店舗の当たりです（' + names(p0.storeId) + '）');
      try {
        const p = await db.runTransaction(async (tx) => {
          const s = data(await tx.get(ref)), rr = s ? data(await tx.get(doc(COL.races, s.raceId))) : null;
          claimCheck(s, rr, names);
          const patch = { status: 'paid', paidAt: now(), paidBy: uid(), paidVia: 'staff' };
          tx.update(ref, patch); const done = Object.assign(s, patch);
          await addLog(Object.assign({ _id: 'paid_' + s.pid }, { type: 'paid', via: 'staff', storeId: s.storeId, bill: s.bill, nick: s.nick, amount: s.amount, combo: s.combo || null, vid: s.vid || null, pid: s.pid, raceId: s.raceId }), tx);
          return done;
        });
        return { payout: Core.payoutView(p, names, true) };
      } catch (e) { throw mapErr(e); }
    }
    // 今日の当たり一覧（その店・営業日・発表済み）。まだ渡していない人が上
    async function wins(pin, o) {
      await staffEnsure(pin); o = o || {};
      const pub = await getPublic(), date = o.date || Core.bizDate(now(), pub.dayStartHour), names = storeNameOf(await getStores());
      try {
        const q = await db.collection(COL.payouts).where('storeId', '==', store).where('revealed', '==', true).where('day', '==', date).get();
        return { date, wins: Core.sortWins(q.docs.map((d) => Core.payoutView(effPay(d.data()), names, true))) };
      } catch (e) { throw mapErr(e); }
    }
    // 番号を空ける: いまのレース（投票中か投票前）のその会計番号の票を消す（ルール: その店のスタッフ・締切の前）
    async function release(pin, billIn, raceId) {
      await staffEnsure(pin);
      const bill = Core.cleanBill(billIn), t = now();
      const r = raceId ? data(await doc(COL.races, String(raceId)).get()) : Core.currentRaceFor(await getRaces(true), store, t);
      if (!r || !Core.visibleTo(r, store)) throw E(409, 'no_open_race', 'いま投票できるレースがありません');
      if (!Core.canVote(r, store)) throw Core.notMyStore(r, storeNameOf(await getStores())); // 見るだけの店に票は無い（2026-10-26）
      if (r.status !== 'upcoming' || t >= r.closeAt) throw E(409, 'closed', '締め切ったレースの票は消せません');
      const vid = Core.voteId(r.id, store, bill), ref = doc(COL.votes, vid), ref2 = doc(COL.votes, vid + '~2');
      try {
        const v1 = data(await ref.get()), v2 = data(await ref2.get()), v = v1 || v2; // 初参加ボーナスの 2 票目も一緒に消す（使った印 derbyBonus は残る）
        if (!v) return { ok: true, released: false, vid, raceId: r.id, bill };
        const b = db.batch(); if (v1) b.delete(ref); if (v2) b.delete(ref2);
        b.set(doc(COL.logs, 'rel_' + vid.replace(/[^A-Za-z0-9_-]/g, '_') + '_' + t), { at: t, date: Core.bizDate(t, (await getPublic()).dayStartHour), cal: Core.dateStr(t), type: 'release', storeId: store, bill, nick: v.nick, combo: Core.comboOf(v), vid, raceId: r.id });
        await b.commit();
        return { ok: true, released: true, vid, raceId: r.id, bill };
      } catch (e) { throw mapErr(e); }
    }
    async function next(pin) {
      await staffEnsure(pin);
      const ref = doc(COL.stores, store);
      try { const seq = await db.runTransaction(async (tx) => { const s = data(await tx.get(ref)); const n = (s.nextSeq || 0) + 1; tx.update(ref, { nextSeq: n }); return n; }); return { nextSeq: seq }; }
      catch (e) { throw mapErr(e); }
    }
    /* テレビのゲーム（2026-10-19）: その店のスタッフが自分の店の settings.tvGame と derbySwitch/tv.<店舗ID> だけを 1 回の書き込みで（ルール: staffOf・ほかの設定は書けない） */
    async function tvGame(pin, game) {
      await staffEnsure(pin);
      const g = game === 'derby' ? 'derby' : 'slot';
      const write = async () => { const b = db.batch(); b.update(doc(COL.stores, store), { 'settings.tvGame': g }); b.set(doc(COL.tvSwitch, 'tv'), { [store]: g }, { merge: true }); await b.commit(); return { store, tvGame: g }; };
      try { return await write(); }
      catch (e) {
        if (!(e && e.code === 'permission-denied')) throw mapErr(e);
        staffOk = null; await staffEnsure(pin); // 管理画面で PIN が変わった → ここで「PIN がちがう」（bad_pin）になる。登録し直せたら 1 回だけやり直す
        try { return await write(); } catch (e2) { throw mapErr(e2); }
      }
    }
    /* テレビの画質（2026-10-19）: その店のスタッフが自分の店の settings.tvQuality だけを書く（'' ＝標準・'auto' ＝なめらか優先・'max' ＝きれい優先。ルール: staffOf・tvQualityOnly）。
       テレビはいつもの状態（settings.tvQuality）で気づいて読み込み直す（v2/tvswitch.js） */
    async function tvQuality(pin, quality) {
      await staffEnsure(pin);
      const q = Core.tvQualityOf({ tvQuality: quality });
      if (quality !== q) throw E(400, 'bad_quality', 'なめらか優先・標準・きれい優先から選んでください');
      const write = async () => { await doc(COL.stores, store).update({ 'settings.tvQuality': q }); storesCache = null; return { store, tvQuality: q }; };
      try { return await write(); }
      catch (e) {
        if (!(e && e.code === 'permission-denied')) throw mapErr(e);
        staffOk = null; await staffEnsure(pin); // 管理画面で PIN が変わった → bad_pin。登録し直せたら 1 回だけやり直す
        try { return await write(); } catch (e2) { throw mapErr(e2); }
      }
    }
    async function logs(pin, o) {
      await staffEnsure(pin); o = o || {};
      const pub = await getPublic(), date = o.date || Core.bizDate(now(), pub.dayStartHour);
      const q = await db.collection(COL.logs).where('storeId', '==', store).where('date', '==', date).get();
      const list = q.docs.map((d) => d.data()).filter((l) => !o.bill || l.bill === String(o.bill)).sort((a, b) => b.at - a.at);
      return { logs: list, byBill: Core.sumBill(list) }; // 額とリングバウンティを分けて集計（core.js）
    }

    /* ---------- 決める処理（決める係のテレビとマスターが使う。何度呼んでも同じ） ---------- */
    let secretCache = null, secretAt = 0;
    async function secretConfig(force) {
      if (!force && secretCache && local() - secretAt < 30000) return secretCache;
      const s = data(await doc(COL.config, 'secret').get());
      secretAt = local(); secretCache = { tuning: Core.tuningOf((s && s.tuning) || {}), /* 以前のデータ（shiftWidth だけ）も読める */ timetable: (s && s.timetable) || { rules: [] }, salt: (s && s.salt) || 'nosalt' };
      return secretCache;
    }
    /* 店ごとの「いまの状態」: その店に見えるレース（30 分前より後・まだ終わっていないもの）を、スマホに見せてよい項目だけで。
       結果（result）と当たった人（winners）は発表後（done）だけ。目標額・決定の中身は入れない。中身が変わったときだけ書く */
    const LIVE_KEYS = ['id', 'storeId', 'storeIds', 'at', 'openAt', 'voteSec', 'closeAt', 'runAt', 'revealAt', 'endAt', 'status', 'dist', 'weather', 'surface', 'horses', 'tune', 'odds', 'exacta', 'tenkai', 'refunded', 'refundedAt', 'day', 'gateSec', 'postSec', 'resultSec', 'test', 'photo', 'photo2']; /* storeIds: 投票できる店（null ＝ 全店。2026-10-26。スマホが canVote を見るのに要る） */
    function liteRace(r) { const o = {}; LIVE_KEYS.forEach((k) => { if (r[k] !== undefined) o[k] = r[k]; }); if (o.status === 'closing') o.status = 'closed'; if (r.status === 'done') { o.result = r.result || null; o.winners = r.winners || []; o.photo = !!r.photo; o.photo2 = !!r.photo2; } return o; }
    const liveKeys = {};
    async function publishLive(races) {
      const stores = await getStores(), pub = await getPublic(), t = now(), from = t - 30 * 60000;
      const sinfo = stores.map((x) => ({ id: x.id, name: x.name, settings: x.settings || {}, order: x.order || 0 }));
      const pubLite = Core.publicTuning(pub);
      for (const st of stores) {
        const list = races.filter((r) => Core.visibleTo(r, st.id) && (r.at >= from || r.status !== 'done')).sort((a, b) => a.at - b.at).map(liteRace);
        const body = { store: st.id, stores: sinfo, pub: pubLite, races: list }, key = JSON.stringify(body);
        if (liveKeys[st.id] === key) continue;
        await doc(COL.live, st.id).set(Object.assign({ at: t }, body)); liveKeys[st.id] = key;
      }
    }
    async function publishWith(changed) {
      try { const base = live.races || await getRaces(true); await publishLive(base.filter((x) => x.id !== changed.id).concat([changed])); } catch (e) { /* 次の見回りで直る */ }
    }
    async function writeRace(entry, sc, opt) {
      const built = Core.buildRace(Engine, Outcome, entry, sc.tuning, sc.salt, now(), opt);
      const r = built.race;
      const b = db.batch();
      b.set(doc(COL.races, r.id), Object.assign({}, r, { openAtTs: Ts(r.openAt), closeAtTs: Ts(r.closeAt), runAtTs: Ts(r.runAt), revealAtTs: Ts(r.revealAt) }));
      b.set(doc(COL.secrets, r.id), Object.assign({}, built.secret, { day: r.day }));
      await b.commit();
      await publishWith(r);
      return r;
    }
    const CHUNK = 150; // 1 回の取引で書くのは 500 件まで（Firestore の上限）。当たり 1 件 = 当たり・票の 2 件
    async function decideRace(raceId, actor) {
      const ref = doc(COL.races, raceId), t = now(), key = randId('k', 12);
      const claimed = await db.runTransaction(async (tx) => {
        const r = data(await tx.get(ref)); if (!r) return null;
        const can = (r.status === 'upcoming' && r.closeAt <= t) || (r.status === 'closing' && (r.closingAt || 0) < t - CLOSING_STALE_MS);
        if (!can) return null;
        tx.update(ref, { status: 'closing', closingBy: actor || uid(), closingAt: t, closingKey: key }); return r;
      });
      if (!claimed) return null;
      const r = claimed, sc = await secretConfig(), secret = data(await doc(COL.secrets, raceId).get()) || { payoutTarget: 0, scope: 'all', comboProb: null };
      const vq = await db.collection(COL.votes).where('raceId', '==', raceId).get();
      const votes = vq.docs.map((d) => d.data());
      const day = r.day || Core.bizDate(r.at, sc.tuning.dayStartHour), st = data(await doc(COL.stats, day).get());
      const d = Core.decideRace(Engine, Outcome, r, secret, votes, sc.tuning, sc.salt, now(), (st && st.committed) || 0);
      const exp = Core.expireAtFor(Math.max(r.at, d.revealAt), sc.tuning.dayStartHour);
      const mine = (x) => !!x && x.status === 'closing' && x.closingKey === key;
      const list = d.payouts.map((p) => ({ p, pid: Core.pidFor(Outcome, sc.salt, raceId, p.vid, 'win') }));
      const CH = cap(CHUNK, 6); // 進行役のテレビは 1 回 15 件まで（当たり 1 件 = 2 件の書き込み＋確かめ）
      for (let i = 0; i < list.length; i += CH) { // 同じ id なので何度書いても同じ
        const part = list.slice(i, i + CH);
        const okp = await db.runTransaction(async (tx) => {
          if (!mine(data(await tx.get(ref)))) return false;
          part.forEach(({ p, pid }) => {
            tx.set(doc(COL.payouts, pid), Object.assign({}, p, { pid, day, createdAt: now(), revealed: false, revealAt: d.revealAt, revealAtTs: Ts(d.revealAt), expireAt: exp, expireAtTs: Ts(exp) }));
            tx.update(doc(COL.votes, p.vid), { payoutId: pid });
          });
          return true;
        });
        if (!okp) return null;
      }
      // 集計に使う本物の票（テストを除く）: 店ごとの数と会計番号（発表のときに集計へ足す。票を読み直さない）
      const real = votes.filter((v) => !v.test && !r.test), byStore = {}, bills = {};
      real.forEach((v) => { byStore[v.storeId] = (byStore[v.storeId] || 0) + 1; bills[v.storeId + ':' + v.bill] = true; });
      const decision = Object.assign({}, d.decision, { winnerList: d.winners, real: { total: real.length, byStore, bills } });
      const fin = await db.runTransaction(async (tx) => {
        if (!mine(data(await tx.get(ref)))) return false;
        tx.set(doc(COL.results, raceId), Object.assign({ raceId, runAt: d.runAt, runAtTs: Ts(d.runAt), revealAt: d.revealAt }, d.result));
        tx.set(doc(COL.secrets, raceId), { decision }, { merge: true });
        tx.update(ref, { status: 'decided', runAt: d.runAt, runAtTs: Ts(d.runAt), revealAt: d.revealAt, endAt: d.endAt, revealAtTs: Ts(d.revealAt), photo: d.photo, photo2: d.photo2, participants: d.participants, decidedAt: now() });
        tx.set(doc(COL.stats, day), { date: day, committed: FieldValue.increment(d.decision.paidReal || 0) }, { merge: true });
        tx.set(doc(COL.counts, 'live'), { [raceId]: FieldValue.delete() }, { merge: true });
        return true;
      });
      if (!fin) return null;
      const patch = { status: 'decided', runAt: d.runAt, revealAt: d.revealAt, endAt: d.endAt, photo: d.photo, photo2: d.photo2, participants: d.participants };
      await publishWith(Object.assign({}, r, patch));
      return Object.assign({}, r, patch, { result: d.result, decision: d.decision });
    }
    async function commitChunks(writes) { // [ (b) => void ] を 400 件ずつ batch で（同じ id への書き込みなので、何度やっても同じ）。進行役のテレビは 15 件ずつ
      const n = cap(400, 15);
      for (let i = 0; i < writes.length; i += n) { const b = db.batch(); writes.slice(i, i + n).forEach((w) => w(b)); await b.commit(); }
    }
    async function revealRace(raceId, force) { const out = await revealRace0(raceId, force); if (out) await publishWith(out); return out; }
    async function revealRace0(raceId, force) {
      const ref = doc(COL.races, raceId), t = now();
      const r0 = data(await ref.get()); if (!r0 || r0.status !== 'decided' || (!force && r0.revealAt > t)) return null;
      const sc = await secretConfig(), h = sc.tuning.dayStartHour;
      const res = data(await doc(COL.results, raceId).get()), sec = data(await doc(COL.secrets, raceId).get()) || {}, dc = sec.decision || {};
      const pq = await db.collection(COL.payouts).where('raceId', '==', raceId).get(), payouts = pq.docs.map((d) => d.data());
      const storesAll = await getStores(true), names = storeNameOf(storesAll), day = r0.day;
      const out = await db.runTransaction(async (tx) => {
        const r = data(await tx.get(ref)); if (!r || r.status !== 'decided' || !!r.refunded !== !!r0.refunded) return null;
        const revealAt = Math.min(r.revealAt, t);
        const patch = { status: 'done', revealAt, revealedAt: t, endAt: revealAt + (r.resultSec || 300) * 1000, revealAtTs: Ts(revealAt),
          result: res ? { winner: res.winner, second: res.second, combo: res.combo, comboOdds: res.comboOdds, order: res.order, finalExacta: res.finalExacta, finalOdds: res.finalOdds, seed: res.seed, finishTimes: res.finishTimes, winTime: res.winTime, natural: res.natural } : null,
          winners: r.refunded ? [] : Core.winnersView(dc.winnerList || [], names) };
        tx.update(ref, patch);
        if (!r.test) { // テストのレースは集計に入れない
          const real = dc.real || { total: 0, byStore: {}, bills: {} }, inc = { date: day, races: FieldValue.increment(1), votes: FieldValue.increment(real.total || 0), target: FieldValue.increment(Core.raceTargetSum(sec.payoutTarget, sec.scope, real.byStore)), bills: real.bills || {}, byStore: {} };
          let paid = 0; const by = {};
          payouts.forEach((p) => { if (p.status === 'void') return; paid += p.amount; by[p.storeId] = (by[p.storeId] || 0) + p.amount; });
          inc.paid = FieldValue.increment(paid);
          const voters = storesAll.map((s) => s.id).filter((s) => Core.canVote(r, s)); // 店ごとのレース数は、その店が投票できたレースだけ（2026-10-26）
          const sids = new Set(Object.keys(real.byStore || {}).concat(Object.keys(by), voters));
          sids.forEach((s) => { const bb = {}; Object.keys(real.bills || {}).forEach((k) => { if (k.indexOf(s + ':') === 0) bb[k.slice(s.length + 1)] = true; }); inc.byStore[s] = { races: FieldValue.increment(voters.includes(s) ? 1 : 0), votes: FieldValue.increment((real.byStore || {})[s] || 0), paid: FieldValue.increment(by[s] || 0), target: FieldValue.increment(sec.scope === 'store' && (real.byStore || {})[s] ? sec.payoutTarget || 0 : 0), bills: bb }; });
          tx.set(doc(COL.stats, day), inc, { merge: true });
        }
        return Object.assign(r, patch);
      });
      if (!out) return null;
      // 当たりの記録・発表の印（スタッフの一覧は revealed で探す）・受け取りの期限の直し
      const exp = Core.expireAtFor(Math.max(r0.at, t), h), ws = [];
      payouts.forEach((p) => {
        if (p.status === 'void') return;
        const patch = { revealed: true };
        if (force && p.revealAt > out.revealAt) Object.assign(patch, { revealAt: out.revealAt, revealAtTs: Ts(out.revealAt) });
        if (p.status === 'unpaid' && p.expireAt != null && p.expireAt < exp) Object.assign(patch, { expireAt: exp, expireAtTs: Ts(exp) });
        ws.push((b) => b.update(doc(COL.payouts, p.pid), patch));
        ws.push((b) => b.set(doc(COL.logs, 'win_' + p.pid), { at: t, date: Core.bizDate(t, h), cal: Core.dateStr(t), type: 'win', storeId: p.storeId, bill: p.bill, nick: p.nick, amount: p.amount, combo: p.combo || null, vid: p.vid || null, pid: p.pid, raceId }));
      });
      await commitChunks(ws);
      return out;
    }
    async function expirePayouts(o) {
      o = o || {};
      const sc = await secretConfig(), today = o.today || Core.bizDate(now(), sc.tuning.dayStartHour);
      const q = await db.collection(COL.payouts).where('status', '==', 'unpaid').get();
      let n = 0;
      for (const d of q.docs) {
        const p = d.data();
        const due = o.today || p.expireAt == null ? p.day < today : now() >= p.expireAt;
        if ((o.pid && p.pid !== o.pid) || !due) continue;
        const ok = await db.runTransaction(async (tx) => {
          const s = data(await tx.get(doc(COL.payouts, p.pid))); if (!s || s.status !== 'unpaid') return false;
          tx.update(doc(COL.payouts, p.pid), { status: 'expired', expiredAt: now() });
          tx.set(doc(COL.stats, s.day), { date: s.day, expired: FieldValue.increment(s.amount), byStore: { [s.storeId]: { expired: FieldValue.increment(s.amount) } } }, { merge: true });
          tx.set(doc(COL.logs, 'exp_' + s.pid), { at: now(), date: Core.bizDate(now(), sc.tuning.dayStartHour), cal: Core.dateStr(now()), type: 'expired', storeId: s.storeId, bill: s.bill, nick: s.nick, amount: s.amount, combo: s.combo || null, vid: s.vid || null, pid: s.pid, raceId: s.raceId, day: s.day });
          return true;
        });
        if (ok) n++;
      }
      return n;
    }
    /* 取り消し（成立しなかったレース。管理の「返還」の v4 版。参加無料なので返すものはない）:
       取引の中でレースに refunded の印（このあとは受け取れない＝ルールと受け取りの取引がレースを見る）・集計を直す → まだ渡していない当たりを void → 発表前なら発表 */
    async function voidRace(raceId) {
      const ref = doc(COL.races, raceId), r = data(await ref.get());
      if (!r) throw E(404, 'no_race', 'レースが見つかりません');
      if (r.refunded) throw E(409, 'already_refunded', 'もう取り消し済みです');
      if (!['closing', 'decided', 'done'].includes(r.status)) throw E(409, 'not_closed', '締切前のレースは取り消せません');
      if (r.status === 'closing') throw E(409, 'busy', 'いま結果を決めているところです。少し待ってからもう一度');
      const t = now(), day = r.day, payIds = (await db.collection(COL.payouts).where('raceId', '==', raceId).get()).docs.map((d) => d.id);
      const got = await db.runTransaction(async (tx) => {
        const rr = data(await tx.get(ref));
        if (!rr) throw E(404, 'no_race', 'レースが見つかりません');
        if (rr.refunded) throw E(409, 'already_refunded', 'もう取り消し済みです');
        if (!['decided', 'done'].includes(rr.status)) throw E(409, 'busy', 'いま結果を決めているところです。少し待ってからもう一度');
        const pays = []; for (const id of payIds) { const p = data(await tx.get(doc(COL.payouts, id))); if (p) pays.push(p); }
        const pl = Core.voidPlan(pays), wd = rr.status === 'done';
        const inc = { date: day, committed: FieldValue.increment(-pl.voided), byStore: {} };
        if (wd && !rr.test) { inc.paid = FieldValue.increment(-pl.voided); const by = {}; pl.voids.forEach((p) => { by[p.storeId] = (by[p.storeId] || 0) + p.amount; }); Object.keys(by).forEach((s) => { inc.byStore[s] = { paid: FieldValue.increment(-by[s]) }; }); }
        tx.set(doc(COL.stats, day), inc, { merge: true });
        tx.update(ref, { refunded: true, refundedAt: t, voided: pl.voided, winners: [] });
        tx.set(doc(COL.secrets, raceId), { decision: { paid: pl.kept.reduce((a, p) => a + p.amount, 0), refunded: true } }, { merge: true });
        pl.voids.forEach((p) => tx.update(doc(COL.payouts, p.pid), { status: 'void', voidAt: t }));
        return { pl, wd };
      });
      if (!got.wd) await revealRace(raceId, true); else { const fresh = data(await ref.get()); if (fresh) await publishWith(fresh); }
      return { voided: got.pl.voided };
    }

    /* ---------- 決める係のテレビ（方式 B） ---------- */
    const decider = { running: false, leader: false, until: 0, nextTry: 0, me: randId('tv-', 8), lastBeat: 0, timer: null, ticketUnsubs: {}, participantsAt: {}, pending: {}, flushT: {}, lastExpire: 0, errors: 0, log: [] };
    const logD = (x) => { decider.log.push(x); if (decider.log.length > 200) decider.log.splice(0, decider.log.length - 200); }; // つけっぱなしのテレビで増え続けないように
    async function heartbeat(force) {
      const t = now();
      if (!force && decider.leader && decider.until - t > RENEW_MS) return true; // まだ期限に余裕がある（読み書きしない）
      if (!force && !decider.leader && t < decider.nextTry) return false;          // ほかのテレビが持っている: 期限が切れるころまで待つ
      const ref = doc(COL.lock, 'decider');
      const got = await db.runTransaction(async (tx) => {
        const l = data(await tx.get(ref));
        if (!l || l.until < t || l.holder === decider.me) { tx.set(ref, { holder: decider.me, until: t + LEASE_MS, at: t, store: store || null, uid: uid(), kind: mode === 'tv' ? 'account' : mode === 'master' ? 'master' : 'paired' }); return true; } // uid・kind: 管理画面の「いま進めているテレビ」と、進行役を替えたときに鍵を外すため（2026-10-19）
        decider.nextTry = Math.min(l.until + 500, t + 20000); return false;
      });
      if (got) decider.until = t + LEASE_MS;
      if (got !== decider.leader) logD([t, got ? 'leader' : 'follower']);
      decider.leader = got; decider.lastBeat = t;
      return got;
    }
    async function materialize(sc, races) {
      const t = now(), horizon = Math.max(sc.tuning.voteSec * 1000 + 120000, (sc.tuning.horizonMin || 15) * 60000), have = new Set(races.map((r) => r.id));
      for (let e of Core.scheduleAround(t, sc.timetable.rules || [])) {
        if (e.at - t > horizon) break;
        if (e.at - sc.tuning.closeLeadSec * 1000 <= t + 1000 || have.has(e.id)) continue;
        const exists = await doc(COL.races, e.id).get(); if (exists.exists) continue;
        // 作る前に裏の設定を読み直す（30 秒のキャッシュのままだと、管理画面で消した・額を変えたレースを古い時刻表で作り直していた。QA 2026-10-14）
        const fresh = await secretConfig(true), fe = Core.scheduleAround(t, fresh.timetable.rules || []).find((x) => x.id === e.id);
        if (!fe) return null;
        sc = fresh; e = fe;
        let odds = null;
        if (env.oddsAsync) { try { const base = Core.raceBase(Engine, Outcome, sc.salt, e.id, sc.tuning); odds = await env.oddsAsync(base, Outcome.hash(sc.salt, e.id, 'odds'), sc.tuning.oddsSims); } catch (err) { odds = null; } } // Worker が使えなければその場で計算
        await writeRace(e, sc, { odds });
        return e.id; // 1 回に 1 レース（オッズの計算が重い）
      }
      return null;
    }
    function watchParticipants(races) { // 投票中のレースの票を見張って、参加人数と人気（組み合わせごとの票の数）を derbyCounts/live に書く（見張りなので読み取りは変化の分だけ）
      const open = new Set(races.filter((r) => r.status === 'upcoming' && now() >= Core.voteWindow(r).openAt - 5000).map((r) => r.id));
      Object.keys(decider.ticketUnsubs).forEach((id) => { if (!open.has(id)) { decider.ticketUnsubs[id](); delete decider.ticketUnsubs[id]; clearTimeout(decider.flushT[id]); delete decider.flushT[id]; delete decider.pending[id]; delete decider.participantsAt[id]; } }); // 終わったレースの分は捨てる
      open.forEach((id) => {
        if (decider.ticketUnsubs[id]) return;
        decider.ticketUnsubs[id] = db.collection(COL.votes).where('raceId', '==', id).onSnapshot((q) => {
          const p = Core.countVotes(q.docs.map((d) => d.data()));
          if (!decider.leader) return;
          decider.pending[id] = p; // 参加人数は derbyCounts/live に（レースのドキュメントは決まったときの最終の人数だけ）
          if (decider.flushT[id]) return; // 5 秒に 1 回にまとめる（この 1 行がコメントの中に入っていて、票が入るたびに書いていた）
          const wait = Math.max(0, 5000 - (local() - (decider.participantsAt[id] || 0)));
          decider.flushT[id] = setTimeout(() => { decider.flushT[id] = null; decider.participantsAt[id] = local(); const v = decider.pending[id]; if (v && decider.leader) doc(COL.counts, 'live').set({ [id]: v }, { merge: true }).catch(() => {}); }, wait);
        }, () => {});
      });
    }
    let deciderWatch = null;
    function ensureRaceWatch() {
      if (deciderWatch) return;
      live.subs++;
      deciderWatch = db.collection(COL.races).where('at', '>=', now() - WINDOW).orderBy('at').onSnapshot((q) => { live.races = q.docs.map((d) => d.data()); }, () => { live.subs--; deciderWatch = null; });
    }
    async function deciderTick() {
      if (typeof setTimeout !== 'undefined' && opts.deciderAuto !== false) { ensureRaceWatch(); ensureTestWatch(); }
      if (!(await heartbeat())) { Object.values(decider.ticketUnsubs).forEach((u) => u()); decider.ticketUnsubs = {}; return { leader: false }; }
      const sc = await secretConfig(), races = await getRaces(), t = now(), did = [];
      for (const r of races.filter((x) => (x.status === 'upcoming' && x.closeAt <= t) || (x.status === 'closing' && (x.closingAt || 0) < t - CLOSING_STALE_MS)).sort((a, b) => a.closeAt - b.closeAt)) { if (await decideRace(r.id, decider.me)) did.push('decide ' + r.id); }
      for (const r of races.filter((x) => x.status === 'decided' && x.revealAt <= t)) { if (await revealRace(r.id)) did.push('reveal ' + r.id); }
      (await tvAuto(races)).forEach((x) => did.push(x)); // 投票が始まったら店のテレビを DERBY に（v4）
      (await processTestReqs(sc, races)).forEach((x) => did.push(x)); // この店だけテストレース（2026-10-19）
      const made = await materialize(sc, races); if (made) did.push('create ' + made);
      watchParticipants(races);
      if (!did.length) await publishLive(live.races || races).catch(() => {}); // 何かした回は、その場でもう書いてある（はじめに読んだ古い一覧で上書きしない）
      /* 期限切れの見回りは 15 分に 1 回と、営業日の区切り（5 時）を越えたとき */ const dayNow = Core.bizDate(t, sc.tuning.dayStartHour); if (t - decider.lastExpire > 15 * 60000 || decider.lastExpireDay !== dayNow) { decider.lastExpire = t; decider.lastExpireDay = dayNow; const n = await expirePayouts(); if (n) did.push('expire ' + n); }
      return { leader: true, did };
    }
    /* 投票が始まったら、そのレースが見える店のテレビのゲームを DERBY に（2026-10-20 オーナー決定。Core.tvAutoPlan。1 レース 1 回＝レースに tvAutoAt の印）。
       店の settings.tvGame と derbySwitch/tv を同じ書き込みで（casa SLOT のテレビは derbySwitch/tv を見て、遊んでいる途中なら終わってから移る）。
       ルール: 決める係は店の設定のうち tvGame を 'derby' にすることだけできる */
    async function tvAuto(races) {
      const stores = await getStores(), plan = Core.tvAutoPlan(races, stores, now()), did = [];
      for (const x of plan) {
        const b = db.batch();
        x.stores.forEach((sid) => b.update(doc(COL.stores, sid), { 'settings.tvGame': 'derby' }));
        if (x.stores.length) { const sw = {}; x.stores.forEach((sid) => { sw[sid] = 'derby'; }); b.set(doc(COL.tvSwitch, 'tv'), sw, { merge: true }); }
        b.update(doc(COL.races, x.raceId), { tvAutoAt: now() });
        try { await b.commit(); if (x.stores.length) { storesCache = null; did.push('tv ' + x.raceId + ' ' + x.stores.join(',')); } } catch (e) { logD([now(), 'tvauto ' + ((e && e.code) || e)]); }
      }
      return did;
    }
    /* ---------- この店だけテストレース（2026-10-19）: スタッフのお願い derbyTestReq/<店舗> を見て、決める係（の鍵を持つ 1 台）が作る ----------
       その 3（2026-10-19）: 店のテレビが casa SLOT のときは、スタッフが押すと同じ書き込みで店のテレビのゲームを casa DERBY にする（今のスタッフの決まり tvGameOnly のまま）。
       発走まで 90 秒（switchSec）のお願いは、テレビが切り替わってから受付を始める（30 秒あとから）。終わったあと SLOT に戻すことはしない（オーナー決定） */
    let testWatch = null, testReqs = {};
    function ensureTestWatch() {
      if (testWatch) return;
      testWatch = db.collection(COL.testReq).onSnapshot((q) => { const o = {}; q.docs.forEach((d) => (o[d.id] = d.data())); testReqs = o; }, () => { testWatch = null; });
    }
    async function testRequests() { if (testWatch) return testReqs; const q = await db.collection(COL.testReq).get(), o = {}; q.docs.forEach((d) => (o[d.id] = d.data())); return o; } // 見張っていないとき（テスト）は 1 回読む
    const msOf = (v) => (v && v.toMillis ? v.toMillis() : Number(v) || 0);
    async function processTestReqs(sc, races) {
      const reqs = await testRequests(), t = now(), did = [];
      for (const sid of Object.keys(reqs)) {
        const q = reqs[sid]; if (!q || q.raceId || q.err) continue;
        const at = msOf(q.at); if (!at || t - at > Core.TEST_RACE.staleSec * 1000) continue; // 10 分より前のお願いは捨てる（止まっていた間のものを今ごろ作らない）
        const ref = doc(COL.testReq, sid), id = Core.testRaceId(sid, at), startIn = Core.testStartIn(q.startIn);
        const made = data(await doc(COL.races, id).get());
        if (made) { await ref.set({ raceId: id, raceAt: made.at, doneAt: t }, { merge: true }); continue; } // 作ったあとに止まっていた: 印だけ
        if (t - at > Core.TEST_RACE.tvWaitSec * 1000) { await ref.set({ err: 'tv_wait', doneAt: t }, { merge: true }); did.push('test tv_wait ' + sid); continue; } // その 4: 5 分待っても作れなかった（テレビがゲーム中のまま・進行役が戻らない）→ 理由を出してやめる
        const stRow = (await getStores()).find((s) => s.id === sid);
        if (!stRow) { await ref.set({ err: 'no_store', doneAt: t }, { merge: true }); continue; }
        let sec = startIn;
        if (startIn === Core.TEST_RACE.switchSec) { // その 4: 店のテレビを切り替えたお願い → その店の Fire TV が casa DERBY に来てから作る（来た時刻から quickSec）
          const w = await tvArrival(sid, at, t);
          if (w === 'waiting') { if (!q.wait) { await ref.set({ wait: 'tv', waitAt: t }, { merge: true }); did.push('test wait-tv ' + sid); } continue; }
          if (w === 'arrived') sec = Core.TEST_RACE.quickSec;
        }
        /* v4: 投票は 60 秒（Core.testStages）。発走の 60 秒前から投票（startIn が 120 なら 60 秒待ってから） */
        const sg = Core.testStages(sec, sc.tuning); sec = sg.startIn;
        if (Core.testRaceBusy(races, sid, t, sec, sc.tuning, sc.timetable.rules || [])) { await ref.set({ err: 'busy', doneAt: t }, { merge: true }); did.push('test busy ' + sid); continue; }
        const r = await writeRace({ id, at: t + sec * 1000, payout: Core.TEST_RACE.payout, scope: 'all', storeId: sid, test: true }, sc, sg); // 管理画面の「テストのレースを作る」と同じ形（その店だけ）＋ test。2 段は押した時刻から（Core.testStages。2026-10-19 その 2）
        await ref.set({ raceId: r.id, raceAt: r.at, doneAt: t }, { merge: true });
        did.push('test ' + r.id);
      }
      return did;
    }
    /* その 4（2026-10-20）: その店の Fire TV が casa DERBY に来たか（Core.testTvWait。derbyTvs の名乗りの時刻）。待っている間だけ、決める係の 1 回ごとに 1 回読む。
       derbyTvs を決める係が読めるのは新しいルールから（貼り直しの前は読めない → null ＝今までどおりすぐ作る。10 分ごとに読めるか確かめ直す） */
    let tvsDeniedAt = 0;
    async function tvArrival(sid, reqAt, t) {
      if (tvsDeniedAt && local() - tvsDeniedAt < 10 * 60000) return null;
      let q;
      try { q = await db.collection(COL.tvs).where('store', '==', sid).get(); tvsDeniedAt = 0; }
      catch (e) { if (e && e.code === 'permission-denied') { tvsDeniedAt = local(); logD([now(), 'tvs denied']); } return null; }
      return Core.testTvWait(q.docs.map((d) => { const x = d.data() || {}; return { store: x.store, kind: x.kind, at: msOf(x.at) }; }), sid, reqAt, t);
    }
    // スタッフ: 進行役のテレビがいるか（決める係の鍵の期限。鍵は 20 秒ごとに延ばすので、止まると 60 秒以内に切れる）
    async function deciderAlive() { const l = data(await doc(COL.lock, 'decider').get()); return !!(l && l.until > now()); }
    /* スタッフ: テストレースの前の様子。鍵（derbyLock/decider）には最後の決める係の店 store が残る。進行役を替える・やめると管理画面が鍵を消すので、
       鍵が残っていて期限が切れている＝選ばれた進行役のテレビがいま DERBY を映していない（その店が SLOT になっているだけ） */
    async function testPre() {
      const [l, sw, q] = await Promise.all([doc(COL.lock, 'decider').get().then(data).catch(() => null), doc(COL.tvSwitch, 'tv').get().then(data).catch(() => null), doc(COL.testReq, store).get().then(data).catch(() => null)]);
      const alive = !!(l && l.until > now()), game = sw && sw[store] === 'derby' ? 'derby' : 'slot', dStore = (l && l.store) || null;
      return { alive, game, dStore, dGame: dStore ? (sw && sw[dStore] === 'derby' ? 'derby' : 'slot') : null, wake: !alive && dStore === store && game === 'slot', sw, q };
    }
    async function testRace(pin, startIn, o) {
      await staffEnsure(pin);
      o = o || {};
      const p = await testPre();
      if (!p.alive && !p.wake) throw p.dStore && p.dGame === 'slot' ? E(409, 'decider_slot', '進行役のテレビ（' + storeNameOf(await getStores().catch(() => null))(p.dStore) + '）が casa SLOT になっています') : E(409, 'no_decider', '進行役のテレビがありません');
      const switching = p.game === 'slot' && o.switchTv !== false;
      let sec = Core.testStartIn(startIn);
      if (switching && !p.wake) sec = Math.max(sec, Core.TEST_RACE.switchSec); // ほかの店の進行役がすぐ作る → テレビが切り替わって読み込む時間を足す
      const pubT = await getPublic();
      const runIn = Core.testStages(sec, pubT).startIn; // 実際の発走まで（投票 60 秒）
      if (Core.testRaceBusy(await getRaces(true), store, now(), runIn, pubT, [])) throw E(409, 'busy', 'いまはテストのレースを作れません（投票中・レース中か、もうすぐ次のレースです）');
      const write = async () => {
        const b = db.batch();
        b.set(doc(COL.testReq, store), { at: FieldValue.serverTimestamp(), by: uid(), startIn: sec });
        if (switching) { b.update(doc(COL.stores, store), { 'settings.tvGame': 'derby' }); b.set(doc(COL.tvSwitch, 'tv'), { [store]: 'derby' }, { merge: true }); }
        await b.commit();
      };
      try { await write(); }
      catch (e) {
        if (!(e && e.code === 'permission-denied')) throw mapErr(e);
        staffOk = null; await staffEnsure(pin); // PIN が変わっていた → bad_pin。登録し直せたら 1 回だけやり直す
        try { await write(); } catch (e2) { if (e2 && e2.code === 'permission-denied') throw E(429, 'too_soon', '少し待ってからもう一度押してください'); throw mapErr(e2); }
      }
      return { ok: true, pending: true, startIn: sec, runIn, switched: switching, wait: p.wake };
    }
    async function testRaceStatus(pin) {
      await staffEnsure(pin);
      const p = await testPre(), q = p.q;
      return { decider: p.alive, deciderStore: p.dStore, deciderGame: p.dGame, deciderName: p.dStore && !p.alive ? storeNameOf(await getStores().catch(() => null))(p.dStore) : null, game: p.game, wake: p.wake,
        req: q ? { at: msOf(q.at), startIn: q.startIn, raceId: q.raceId || null, raceAt: q.raceAt || null, err: q.err || null, wait: q.wait || null } : null }; // wait: その 4（テレビが casa DERBY に来るのを待っている）
    }

    /* ---------- 進行役のテレビ（2026-10-19: パスワードを打たずに管理画面の 1 タップで） ----------
       パスワードのないテレビ（匿名ログイン）は derbyTvs/<uid> に名乗る（店舗・端末の種類・連絡の時刻・画面に出す 4 けたの数字）。書くのは起動時と 5 分ごとだけ。
       自分の 2 件だけを見張る: derbyTvs/<uid> の ask（管理画面が「進行役にする」を押した＝数字を出す）と、derbyDeciders/<uid>（選ばれた＝決める係になる・消えたら止める） */
    const PAIR_BEAT_MS = 5 * 60000, PAIR_ASK_MS = 3 * 60000;
    const pair = { on: false, code: null, askAt: 0, decider: false, cbs: [], unsubs: [], timer: null, askT: null, err: '' };
    const canDecide = () => mode === 'tv' || pair.decider;
    function pairState() { const asking = !pair.decider && pair.askAt > 0 && now() - pair.askAt < PAIR_ASK_MS; return { on: pair.on, code: pair.code, asking, decider: pair.decider, account: mode === 'tv' }; }
    function pairEmit() {
      clearTimeout(pair.askT); const s = pairState();
      if (s.asking && typeof setTimeout !== 'undefined') pair.askT = setTimeout(pairEmit, Math.max(500, PAIR_ASK_MS - (now() - pair.askAt) + 200)); // 3 分たったら数字を消す
      pair.cbs.slice().forEach((cb) => { try { cb(s); } catch (e) { /* noop */ } });
    }
    function newCode() { let n; try { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); n = a[0] % 10000; } catch (e) { n = Math.floor(Math.random() * 10000); } return String(n).padStart(4, '0'); }
    const tvKind = () => (typeof navigator !== 'undefined' && /casaTV/.test(navigator.userAgent || '') ? 'casatv' : 'browser');
    async function pairHello() { if (!pair.on) return; await doc(COL.tvs, uid()).set({ store, kind: tvKind(), at: FieldValue.serverTimestamp(), code: pair.code }, { merge: true }); }
    function startPair() {
      if (pair.on || role !== 'tv' || mode !== 'anon' || !store || !/^[a-z0-9_-]{1,32}$/.test(store) || opts.pair === false) return;
      pair.on = true; pair.code = opts.pairCode || newCode(); // 数字は起動のたびに作り直す（5 分ごとの連絡では変えない＝確認の途中で変わらない）
      pairHello().catch((e) => { pair.err = 'hello ' + ((e && e.code) || ''); });
      if (typeof setInterval !== 'undefined' && opts.deciderAuto !== false) pair.timer = setInterval(() => pairHello().catch(() => {}), PAIR_BEAT_MS);
      pair.unsubs.push(doc(COL.tvs, uid()).onSnapshot((s) => { const d = data(s), a = d && typeof d.ask === 'number' ? d.ask : 0; if (a !== pair.askAt) { pair.askAt = a; pairEmit(); } }, () => {}));
      pair.unsubs.push(doc(COL.deciders, uid()).onSnapshot((s) => {
        const on = !!(s && s.exists); if (on === pair.decider) return;
        pair.decider = on; logD([now(), on ? 'paired' : 'unpaired']);
        if (on) { if (opts.decider !== false) startDecider(); }
        else { stopDecider(); decider.leader = false; decider.until = 0; }
        pairEmit();
      }, () => {}));
      pairEmit();
    }
    function onPair(cb) { if (typeof cb !== 'function') return () => {}; pair.cbs.push(cb); try { cb(pairState()); } catch (e) { /* noop */ } return () => { const i = pair.cbs.indexOf(cb); if (i >= 0) pair.cbs.splice(i, 1); }; }

    function startDecider() {
      if (decider.running || typeof setTimeout === 'undefined' || opts.deciderAuto === false) return;
      decider.running = true;
      const loop = async () => { if (!decider.running) return; try { await deciderTick(); decider.errors = 0; } catch (e) { decider.errors++; logD([now(), 'error ' + ((e && e.message) || e)]); } decider.timer = setTimeout(loop, BEAT_MS); };
      loop();
    }
    function stopDecider() { decider.running = false; clearTimeout(decider.timer); Object.values(decider.ticketUnsubs).forEach((u) => u()); decider.ticketUnsubs = {}; }

    /* ---------- リアルタイム（onSnapshot → state / race / vote / next / reload / payout） ---------- */
    function subscribe(handlers, o) {
      handlers = handlers || {}; o = o || {};
      const unsubs = [], raceHooks = []; let closed = false, races = [], stores = null, pub = null, lastStatus = {}, seq = null, rseq = null, timer = null, opened = false;
      const emit = async () => {
        if (closed || !stores || !pub) return;
        try {
          const s = await compose(store, races, stores, pub);
          for (const r of races) { if (!Core.visibleTo(r, store)) continue; const k = r.status + (r.revealAt || 0); if (lastStatus[r.id] !== k) { const first = lastStatus[r.id] === undefined; lastStatus[r.id] = k; if (!first && handlers.race) handlers.race(Core.publicRace(r, { role, store, result: resultCache[r.id] })); } }
          if (handlers.state) handlers.state(s);
        } catch (e) { if (handlers.error) handlers.error(e); }
      };
      const soon = () => { clearTimeout(timer); timer = setTimeout(emit, 150); };
      const fail = (e) => { if (handlers.error) handlers.error(e); };
      ready().then(() => {
        if (closed) return;
        live.subs++; unsubs.push(() => { live.subs--; });
        const gotRaces = (list) => { races = list; live.races = races; schedDirty = true; /* レースの一覧が変わった → 公開の時刻表も次に読み直す（2026-10-27） */ raceHooks.forEach((f) => { try { f(); } catch (e) { /* noop */ } }); if (!opened) { opened = true; if (handlers.open) handlers.open(); if (handlers.hello) handlers.hello({ now: now(), store, role }); } soon(); };
        let full = false;
        const startFull = () => { // テレビ・スタッフ（とスマホの予備）: レースの一覧・店舗・設定を見張る
          if (full) return; full = true;
          unsubs.push(db.collection(COL.races).where('at', '>=', now() - WINDOW).orderBy('at').onSnapshot((q) => gotRaces(q.docs.map((d) => d.data())), fail));
        unsubs.push(db.collection(COL.stores).onSnapshot((q) => {
          stores = q.docs.map((d) => Object.assign({ id: d.id }, d.data())); storesCache = stores; storesAt = local();
          const st = stores.find((x) => x.id === store);
          if (st) { // 「次へ」・再読み込み: 最初の値を基準にして、増えたら知らせる
            if (seq != null && (st.nextSeq || 0) > seq && handlers.next) handlers.next({ store, nextSeq: st.nextSeq || 0 });
            if (rseq != null && (st.reloadSeq || 0) > rseq && handlers.reload && role === 'tv') handlers.reload({ store, at: now(), reloadSeq: st.reloadSeq || 0 });
            seq = st.nextSeq || 0; rseq = st.reloadSeq || 0;
          }
          soon();
        }, fail));
        if (role !== 'phone') unsubs.push(doc(COL.counts, 'live').onSnapshot((s) => { countsCache = s.exists ? s.data() : {}; soon(); }, () => {}));
        unsubs.push(doc(COL.config, 'public').onSnapshot((s) => { pub = Object.assign({}, Core.DEFAULT_TUNING, s.exists ? s.data() : {}); pubCache = pub; pubAt = local(); soon(); }, fail));
        };
        if (role === 'phone') { // スマホ: 「いまの状態」1 件だけ（変わったときに 1 回読む）
          unsubs.push(doc(COL.live, store).onSnapshot((s) => {
            if (!s.exists) { startFull(); return; }
            const d = s.data(); stores = d.stores || []; storesCache = stores; storesAt = local(); pub = Object.assign({}, Core.DEFAULT_TUNING, d.pub || {}); pubCache = pub; pubAt = local();
            gotRaces(d.races || []);
          }, () => startFull()));
        } else startFull();
        if (o.vid) { // スマホ: 自分の票の組（1 票目と初参加ボーナスの 2 票目。消えた＝番号を空けられたら vote: null・released: true）と、発表のあとの当たり
          const vid1 = Core.baseVid(o.vid), vid2 = vid1 + '~2';
          let lastKey = '', v1L = null, v2L = null, got1 = false, got2 = false; const payW = {};
          const pushVote = async () => {
            if (!got1 || !got2) return; // 2 つとも最初の値が届いてから
            if (!v1L) { const k = 'released'; if (k !== lastKey) { lastKey = k; if (handlers.vote) handlers.vote({ vote: null, released: true, vid: vid1 }); } return; }
            const pr = await pairOf(v1L, v2L), view = { vote: pr.vote, vote2: pr.vote2, bonus: pr.bonus }, k = JSON.stringify(view);
            if (k !== lastKey) { lastKey = k; if (handlers.vote) handlers.vote(view); }
          };
          const watchPayout = (v) => {
            if (!v || !v.payoutId || payW[v.payoutId]) return;
            const r = races.find((x) => x.id === v.raceId); if (!r || r.status !== 'done') return;
            const pidW = v.payoutId;
            payW[pidW] = doc(COL.payouts, pidW).onSnapshot((ps) => { const pd = data(ps); if (pd) live.payouts[pidW] = pd; pushVote(); }, () => { delete payW[pidW]; });
          };
          live.watch2[vid1] = true;
          unsubs.push(() => { delete live.votes[vid1]; delete live.votes[vid2]; delete live.watch2[vid1]; Object.keys(payW).forEach((k) => payW[k]()); });
          const onVote = (which) => (s) => {
            const v = data(s), id = which === 1 ? vid1 : vid2;
            if (which === 1) { v1L = v; got1 = true; } else { v2L = v && v.owner === uid() ? v : null; got2 = true; }
            if (v) live.votes[id] = v; else delete live.votes[id];
            if (which === 1 && !v) delete bonusMemo[vid1]; // 番号を空けられた（もう一度投票したらボーナスを確かめ直す）
            pushVote(); watchPayout(v);
          };
          unsubs.push(doc(COL.votes, vid1).onSnapshot(onVote(1), fail));
          unsubs.push(doc(COL.votes, vid2).onSnapshot(onVote(2), () => { got2 = true; v2L = null; pushVote(); })); // 古いルール（2 票目が読めない）でも 1 票目は届く
          raceHooks.push(() => { if (v1L) { const r = races.find((x) => x.id === v1L.raceId); if (r && r.status === 'done') { pushVote(); watchPayout(v1L); watchPayout(v2L); } } });
        }
        if (role === 'staff' && (handlers.payout || handlers.wins)) { // スタッフ: 今日の当たり一覧（発表済み）を見張る。新しい当たり・受け取り（スタッフ・お客さんのスライドのどちらでも）が届く
          const seen = {}; let un = null, dayT = null;
          const watchDay = () => {
            if (closed) return; const h = (pubCache || Core.DEFAULT_TUNING).dayStartHour, today = Core.bizDate(now(), h);
            if (un) un();
            un = db.collection(COL.payouts).where('storeId', '==', store).where('revealed', '==', true).where('day', '==', today).onSnapshot((q) => {
              const names = storeNameOf(stores), list = q.docs.map((d) => Core.payoutView(effPay(d.data()), names, true));
              list.forEach((p) => { const k = p.status + (p.paidAt || ''); if (seen[p.pid] !== undefined && seen[p.pid] !== k && p.status === 'paid' && handlers.payout) handlers.payout({ payout: p }); seen[p.pid] = k; });
              if (handlers.wins) handlers.wins({ date: today, wins: Core.sortWins(list) });
            }, () => {});
            dayT = setTimeout(watchDay, Math.max(1000, Math.min(2 ** 31 - 1, Core.expireAtFor(now(), h) - now() + 1000)));
          };
          watchDay(); unsubs.push(() => { clearTimeout(dayT); if (un) un(); });
        }
        const iv = setInterval(emit, 1000); unsubs.push(() => clearInterval(iv)); // 時刻で変わる場面（締切・ゲート）と、テレビの結果の読み込み
      }).catch(fail);
      return function () { closed = true; clearTimeout(timer); unsubs.forEach((u) => { try { u(); } catch (e) { /* noop */ } }); };
    }

    /* ---------- 管理（マスターのメールアドレスでログイン） ---------- */
    function admin(password) {
      let signed = null;
      const login = async () => {
        if (!signed) signed = (async () => {
          try { await auth.signInWithEmailAndPassword(cfg.masterEmail, password); mode = 'master'; readyP = null; await ready(); }
          catch (e) { signed = null; if (e && e.status) throw e; throw E(401, 'bad_password', '管理パスワードがちがいます'); }
          // 最初の 1 回: 設定のドキュメントがなければ作る
          const sec = await doc(COL.config, 'secret').get();
          if (!sec.exists) { const salt = randId('', 16); await doc(COL.config, 'secret').set({ tuning: Core.DEFAULT_TUNING, timetable: { rules: [] }, salt, moneyUnit: Core.MONEY_PER_TICKET }); await doc(COL.config, 'public').set(Core.publicTuning(Core.DEFAULT_TUNING)); }
          else if (sec.data().moneyUnit !== Core.MONEY_PER_TICKET) { // お金の単位の移行（2026-10-16「払い戻しは額。1 枚 = 100」）: 時刻表の払い戻しの合計・上限・まだ決めていないレースの設定額を ×100（1 回だけ）
            const M = Core.MONEY_PER_TICKET, sd = sec.data(), tt = JSON.parse(JSON.stringify(sd.timetable || { rules: [] })), tu = Object.assign({}, sd.tuning || {});
            (tt.rules || []).forEach((r) => { if (typeof r.payout === 'number') r.payout *= M; (r.races || []).forEach((y) => { if (typeof y.payout === 'number') y.payout *= M; }); });
            ['payoutCap', 'payoutCapDay'].forEach((k) => { if (typeof tu[k] === 'number') tu[k] *= M; });
            const up = await db.collection(COL.races).where('status', '==', 'upcoming').get();
            for (const d of up.docs) { const x = data(await doc(COL.secrets, d.id).get()); if (x && typeof x.payoutTarget === 'number') await doc(COL.secrets, d.id).set({ payoutTarget: x.payoutTarget * M }, { merge: true }); }
            await doc(COL.config, 'secret').set({ timetable: tt, tuning: tu, moneyUnit: M }, { merge: true }); secretCache = null;
          }
          // v4: 公開の時刻表（derbySchedule/public）がまだ無ければ作る（v4 に切り替えた最初のログインで。以後は時刻表・調整の保存で書き直す）
          try { if (!(await doc(COL.schedule, 'public').get()).exists) { const s0 = (await doc(COL.config, 'secret').get()).data() || {}; await doc(COL.schedule, 'public').set(Core.publicSchedule((s0.timetable && s0.timetable.rules) || [], s0.tuning || {}, now())); } } catch (e) { /* 書けなくてもログインは続ける */ }
        })();
        return signed;
      };
      const wrap = (fn) => async (...a) => { await login(); try { return await fn(...a); } catch (e) { throw mapErr(e); } };
      return {
        config: wrap(async () => {
          const [stores, pins, sc] = await Promise.all([getStores(true), db.collection(COL.pins).get(), secretConfig()]);
          const pinOf = {}; pins.docs.forEach((d) => (pinOf[d.id] = d.data().pin));
          return { stores: stores.map((s) => ({ id: s.id, name: s.name, pin: pinOf[s.id] || '', settings: s.settings || {} })), timetable: sc.timetable, tuning: sc.tuning };
        }),
        saveStores: wrap(async (list) => {
          if (!Array.isArray(list) || !list.length) throw E(400, 'bad_stores', '店舗の一覧がありません');
          const old = await getStores(true), b = db.batch(), keep = new Set();
          list.forEach((s, i) => {
            const id = String(s.id || '').trim();
            if (!/^[a-z0-9_-]{1,32}$/.test(id)) throw E(400, 'bad_store_id', '店舗 ID は英小文字・数字で（' + id + '）');
            if (!/^\d{4,8}$/.test(String(s.pin || ''))) throw E(400, 'bad_pin', '暗証番号は数字 4〜8 桁です（' + id + '）');
            const o = old.find((x) => x.id === id) || {};
            keep.add(id);
            b.set(doc(COL.stores, id), { name: String(s.name || id).slice(0, 20), settings: s.settings || o.settings || {}, nextSeq: o.nextSeq || 0, reloadSeq: o.reloadSeq || 0, order: i });
            b.set(doc(COL.pins, id), { pin: String(s.pin) });
          });
          old.forEach((s) => { if (!keep.has(s.id)) { b.delete(doc(COL.stores, s.id)); b.delete(doc(COL.pins, s.id)); } });
          b.set(doc(COL.tvSwitch, 'tv'), Core.tvSwitchDoc(list.map((s) => ({ id: String(s.id || '').trim(), settings: s.settings || (old.find((x) => x.id === String(s.id || '').trim()) || {}).settings })))); /* テレビのゲーム（casa SLOT のテレビが読む）。店舗と同じ書き込みなので食いちがわない */
          await b.commit(); storesCache = null;
          await publishLive(await getRaces(true)).catch(() => {});
          return { ok: true, stores: list };
        }),
        saveTimetable: wrap(async (rulesIn) => {
          const stores = await getStores(true), sc0 = await secretConfig(), rules = Core.normalizeRules(rulesIn, stores.map((s) => s.id), storeNameOf(stores), Core.tuningOf(sc0.tuning).dayStartHour); /* 時刻は 05:00〜28:59（25 時表記。2026-10-26） */
          const tb = db.batch(); tb.set(doc(COL.config, 'secret'), { timetable: { rules } }, { merge: true }); tb.set(doc(COL.schedule, 'public'), Core.publicSchedule(rules, sc0.tuning, now())); await tb.commit(); /* derbySchedule/public: 時刻だけの公開の時刻表（casa SLOT のテレビが読む） */
          const sched = Core.scheduleAround(now(), rules), keep = new Map(sched.map((e) => [e.id, e]));
          for (const r of await getRaces()) {
            if (r.status !== 'upcoming' || r.id.startsWith('x-')) continue;
            const e = keep.get(r.id);
            if (e) {
              await doc(COL.secrets, r.id).set({ payoutTarget: e.payout, scope: e.scope }, { merge: true });
              if (JSON.stringify(Core.storeIdsOf(r.storeIds)) !== JSON.stringify(e.storeIds || null)) { await doc(COL.races, r.id).set({ storeIds: e.storeIds || null }, { merge: true }); await publishWith(Object.assign({}, r, { storeIds: e.storeIds || null })); } /* 投票できる店の変更も、作ってあるレースに写す（2026-10-26） */
              continue;
            }
            if (now() >= (r.openAt || r.closeAt) - 5000) continue; // 受付中のレースは消さない（票を確かめてから消すまでの間に投票が入ると、票だけ残ってレースが消えた。模擬サーバーは 1 本で動くので起きない）
            const t = await db.collection(COL.votes).where('raceId', '==', r.id).limit(1).get(); if (!t.empty) continue; // 票のあるレースは消さない
            const b = db.batch(); b.delete(doc(COL.races, r.id)); b.delete(doc(COL.secrets, r.id)); await b.commit();
          }
          secretCache = null; await publishLive(await getRaces(true)).catch(() => {});
          return { ok: true, timetable: { rules } };
        }),
        /* テレビ用アカウントを作る（管理画面の「テレビ用アカウントを作る」）。パスワードは管理画面がブラウザの中で作って渡す（ここでは保存も記録もしない）。
           2 つ目の app（tvcreator）で作るので、マスターのログインはそのまま。作ったら 2 つ目の app はログアウトして消す */
        createTvAccount: wrap(async (pw) => {
          if (!cfg.tvEmail) throw E(400, 'no_tv_email', 'テレビ用のメールアドレス（config.js の tvEmail）がありません');
          if (typeof pw !== 'string' || pw.length < 16) throw E(400, 'bad_tv_password', 'パスワードが短すぎます');
          if (!fb.newApp) throw E(500, 'no_app', 'この環境では作れません');
          const app2 = fb.newApp('tvcreator');
          try { await app2.auth().createUserWithEmailAndPassword(cfg.tvEmail, pw); return { ok: true, email: cfg.tvEmail }; }
          catch (e) { if (e && e.code === 'auth/email-already-in-use') throw E(409, 'tv_exists', 'テレビ用アカウントはもうあります。パスワードを忘れた場合は Firebase の Authentication で再設定してください'); throw E(500, 'tv_create', 'テレビ用アカウントを作れませんでした（' + ((e && e.code) || 'error') + '）'); }
          finally { try { await app2.auth().signOut(); } catch (e) { /* noop */ } try { await app2.delete(); } catch (e) { /* noop */ } }
        }),
        /* 進行役のテレビ（2026-10-19）: 名乗っているテレビ（7 日以内に連絡）・いまの進行役・いま進めているテレビ（決める係の鍵） */
        tvs: wrap(async () => {
          const [q, dq, lk] = await Promise.all([db.collection(COL.tvs).where('at', '>=', Ts(now() - 7 * 86400000)).get(), db.collection(COL.deciders).get(), doc(COL.lock, 'decider').get()]);
          const tvs = q.docs.map((d) => { const x = d.data(); return { id: d.id, store: x.store, kind: x.kind, at: msOf(x.at), code: x.code, ask: Number(x.ask) || 0 }; }).sort((a, b) => b.at - a.at);
          const dd = dq.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null, l = data(lk);
          return { tvs, decider: dd ? { id: dd.id, store: dd.store || null, at: dd.at || null, seen: (tvs.find((x) => x.id === dd.id) || {}).at || null } : null, lock: l && l.until > now() ? { store: l.store || null, kind: l.kind || 'account', uid: l.uid || null, at: l.at || null } : null, now: now() };
        }),
        // 「進行役にする」を押した: そのテレビに数字を出してもらう（on=false で消す）。答えはそのテレビの数字（管理画面の確認に出す）
        tvAsk: wrap(async (id, on) => {
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(id || ''))) throw E(400, 'bad_tv', 'テレビの指定がちがいます');
          try { await doc(COL.tvs, id).update({ ask: on ? now() : FieldValue.delete() }); } catch (e) { if (e && e.code === 'not-found') throw E(404, 'no_tv', 'テレビが見つかりません'); throw e; }
          const x = data(await doc(COL.tvs, id).get()) || {};
          return { ok: true, id, code: x.code || null, store: x.store || null, at: msOf(x.at) };
        }),
        // 進行役を決める（id）・やめる（null）。1 台だけ: ほかは消す。前の進行役のテレビが鍵を持っていたら外す（新しいテレビがすぐ続ける）
        setDecider: wrap(async (id) => {
          const [dq, l] = await Promise.all([db.collection(COL.deciders).get(), doc(COL.lock, 'decider').get().then(data)]);
          const tv = id ? data(await doc(COL.tvs, id).get()) : null;
          if (id && !tv) throw E(404, 'no_tv', 'テレビが見つかりません');
          const b = db.batch();
          dq.docs.forEach((d) => { if (d.id !== id) b.delete(doc(COL.deciders, d.id)); });
          if (id) { b.set(doc(COL.deciders, id), { store: tv.store || null, at: now() }); b.update(doc(COL.tvs, id), { ask: FieldValue.delete() }); }
          if (l && l.kind === 'paired' && l.uid !== id) b.delete(doc(COL.lock, 'decider'));
          await b.commit();
          return { ok: true, decider: id ? { id, store: tv.store || null, at: now() } : null };
        }),
        preview: wrap(async (date, s) => { const sc = await secretConfig(), ds = date || Core.dateStr(now()); return { date: ds, holiday: Core.holidayName(ds), weekday: Core.weekday(ds), /* holiday: 祝日の名前 | null（模擬クラウドの GET /api/admin/timetable/preview と同じ。2026-10-27） */ races: Core.expandDate(ds, sc.timetable.rules || []).filter((e) => !s || !e.storeId || e.storeId === s) }; }),
        saveTuning: wrap(async (t) => {
          const sc = await secretConfig(), merged = Core.mergeTuning(sc.tuning, t || {}, now());
          const b = db.batch(); b.set(doc(COL.config, 'secret'), { tuning: merged }, { merge: true }); b.set(doc(COL.config, 'public'), Core.publicTuning(merged)); b.set(doc(COL.schedule, 'public'), Core.publicSchedule(sc.timetable.rules || [], merged, now())); for (const x of Core.revoteRaces(await getRaces(true), merged, now())) b.set(doc(COL.races, x.id), { openAt: x.openAt, openAtTs: Ts(x.openAt), voteSec: x.voteSec }, { merge: true }); /* まだ投票が始まっていないレースも新しい投票の秒数に */ await b.commit(); pubCache = null; secretCache = null;
          await publishLive(await getRaces(true)).catch(() => {});
          return { ok: true, tuning: merged };
        }),
        races: wrap(async (date) => {
          const sc = await secretConfig(), ds = date || Core.bizDate(now(), sc.tuning.dayStartHour), names = storeNameOf(await getStores());
          const q = await db.collection(COL.races).where('day', '==', ds).get(), list = q.docs.map((d) => d.data()).sort((a, b) => a.at - b.at);
          const out = [];
          for (const r of list) {
            const secret = data(await doc(COL.secrets, r.id).get()) || {}, res = r.result || data(await doc(COL.results, r.id).get());
            const ps = (await db.collection(COL.payouts).where('raceId', '==', r.id).get()).docs.map((d) => d.data()), sum = (st) => ps.filter((p) => p.status === st).reduce((a, p) => a + p.amount, 0);
            const dc = secret.decision || {};
            out.push(Object.assign(Core.publicRace(r, { role: 'admin', secret, result: res, winners: r.winners || Core.winnersView(dc.winnerList || [], names) }), { votes: (r.participants || {}).total || 0, paidTotal: dc.paid || 0, claimedTotal: sum('paid'), unpaidTotal: sum('unpaid'), expiredTotal: sum('expired'), refunded: !!r.refunded, tvAutoAt: r.tvAutoAt || null }));
          }
          return { races: out };
        }),
        /* 集計（v4）: 票の数（参加人数）・会計番号の数・当選額の目標・当選額・渡した額・期限切れ・まだ渡していない額（Core.statRow。server.js と同じ形）。
           渡した額は当たりのドキュメント（スタッフ・お客さんのスライドの両方）から数える */
        stats: wrap(async (from, to, s) => {
          const sc = await secretConfig(); to = to || Core.bizDate(now(), sc.tuning.dayStartHour); from = from || to;
          const q = await db.collection(COL.stats).where('date', '>=', from).where('date', '<=', to).get();
          const pq = await db.collection(COL.payouts).where('day', '>=', from).where('day', '<=', to).get();
          const claimed = {}; pq.docs.forEach((d) => { const p = d.data(); if (p.status !== 'paid') return; const c = (claimed[p.day] = claimed[p.day] || { all: 0 }); c.all += p.amount; c[p.storeId] = (c[p.storeId] || 0) + p.amount; });
          const K = ['races', 'votes', 'players', 'target', 'paid', 'claimed', 'expired', 'unclaimed'];
          const zero = () => { const o = {}; K.forEach((k) => (o[k] = 0)); return o; };
          const tot = Object.assign(zero(), { byStore: {} }), days = [];
          q.docs.map((d) => d.data()).sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((x) => {
            const cl = claimed[x.date] || {}, byStore = {};
            // 店ごとのレース数（2026-10-26）: 新しい記録は店ごとに数えてある（その店が投票できたレースだけ）。無い（以前の記録）ときはその日のレース数
            const perStore = Object.values(x.byStore || {}).some((b) => b && b.races != null), racesOf = (b) => (b && b.races != null ? b.races : perStore ? 0 : x.races || 0);
            Object.keys(x.byStore || {}).forEach((sid) => { byStore[sid] = Core.statRow(Object.assign({}, x.byStore[sid], { races: racesOf(x.byStore[sid]) }), cl[sid] || 0); });
            const src = s ? Object.assign(zero(), byStore[s] || { races: racesOf(null) }) : Core.statRow(x, cl.all || 0);
            const row = Object.assign({ date: x.date }, src, { byStore }); days.push(row);
            K.forEach((k) => (tot[k] += row[k] || 0));
            Object.keys(byStore).forEach((sid) => { if (s && sid !== s) return; const a = (tot.byStore[sid] = tot.byStore[sid] || zero()); K.forEach((k) => (a[k] += byStore[sid][k] || 0)); });
          });
          const rate = (x) => (x.target ? Math.round(x.paid / x.target * 1000) / 1000 : 0);
          tot.payRate = rate(tot); Object.values(tot.byStore).forEach((b) => { b.payRate = rate(b); });
          return { from, to, store: s || null, days, totals: tot };
        }),
        logs: wrap(async (o) => {
          o = o || {}; const sc = await secretConfig(), to = o.to || Core.bizDate(now(), sc.tuning.dayStartHour), from = o.from || to;
          const q = await db.collection(COL.logs).where('date', '>=', from).where('date', '<=', to).get();
          const list = q.docs.map((d) => d.data()).filter((l) => (!o.store || l.storeId === o.store) && (!o.bill || l.bill === String(o.bill)) && (!l.test || o.test === '1' || o.test === true)).sort((a, b) => b.at - a.at).slice(0, 5000);
          return { from, to, logs: list, byBill: Core.sumBill(list) };
        }),
        createRace: wrap(async (o) => {
          o = o || {}; const sc = await secretConfig(), t = now(), sid = o.storeId || null;
          const storeIds = sid ? null : Core.cleanStoreIds(o.storeIds, (await getStores(true)).map((s) => s.id)); /* 投票できる店（省くと全店。2026-10-26） */
          const r = await writeRace({ id: 'x-' + t.toString(36) + randId('', 4).toLowerCase() + (sid ? '-' + sid : ''), /* 乱数つき: 同じミリ秒に 2 つ作ると前のレースを上書きしていた（RED TEAM） */ at: t + Math.max(0, Number(o.inSec) || 0) * 1000, payout: Math.max(0, Math.floor(Number(o.payout) || 0)), scope: o.scope === 'store' ? 'store' : 'all', storeId: sid, storeIds, test: !!o.test }, sc, Core.manualStages(o, Number(o.inSec) || 0, sc.tuning));
          const secret = data(await doc(COL.secrets, r.id).get());
          return { race: Core.publicRace(r, { role: 'admin', secret }) };
        }),
        close: wrap(async (raceId) => {
          const ref = doc(COL.races, raceId), r = data(await ref.get()); if (!r) throw E(404, 'no_race', 'レースが見つかりません');
          if (r.status !== 'upcoming') throw E(409, 'already_closed', 'もう締め切っています');
          const sc = await secretConfig(), t = now(), at = t + sc.tuning.closeLeadSec * 1000, runAt = at + (r.gateSec || 0) * 1000;
          await db.runTransaction(async (tx) => { const x = data(await tx.get(ref)); if (!x || x.status !== 'upcoming') throw E(409, 'already_closed', 'もう締め切っています'); const oa = Math.min(x.openAt != null ? x.openAt : t, t); tx.update(ref, { closeAt: t, at, runAt, openAt: oa, openAtTs: Ts(oa), closeAtTs: Ts(t), runAtTs: Ts(runAt) }); }); // 決める係が同時に締め切っていたら時刻を書きかえない
          const d = await decideRace(raceId, 'master'); const secret = data(await doc(COL.secrets, raceId).get());
          return { race: Core.publicRace(d || data(await ref.get()), { role: 'admin', secret, result: d && d.result }) };
        }),
        reveal: wrap(async (raceId) => { const r = await revealRace(raceId, true); if (!r) throw E(409, 'not_decided', 'まだ結果が決まっていません'); return { race: Core.publicRace(r, { role: 'admin', secret: data(await doc(COL.secrets, raceId).get()) }) }; }),
        refund: wrap(async (raceId) => { const x = await voidRace(raceId); const r = data(await doc(COL.races, raceId).get()); return { ok: true, voided: x.voided, race: Core.publicRace(r, { role: 'admin', secret: data(await doc(COL.secrets, raceId).get()) }) }; }), // 取り消し（v4。以前の返還）
        reload: wrap(async (sid) => { const stores = await getStores(true); let n = 0; for (const s of stores) { if (sid && s.id !== sid) continue; await doc(COL.stores, s.id).update({ reloadSeq: FieldValue.increment(1) }); n++; } return { ok: true, sent: n }; }),
        expire: wrap(async (o) => { o = o || {}; if (o.pid) { const sc = await secretConfig(); return { ok: true, expired: await expirePayouts({ pid: o.pid, today: Core.bizDate(now() + 2 * 86400000, sc.tuning.dayStartHour) }) }; } return { ok: true, expired: await expirePayouts() }; }),
        setPassword: async () => { throw E(400, 'use_console', '管理パスワードは Firebase のコンソール（Authentication）で変えてください'); },
      };
    }

    return {
      store, role, serverNow: now, syncClock, get offset() { return offset; }, get synced() { return synced; }, backend: 'firestore',
      stores: async () => { await ready(); return (await getStores()).map((s) => ({ id: s.id, name: s.name })); },
      state, race, vote, myVote, claimSelf,
      staffLogin, release, wins, staffPayout, claim, next, logs, tvGame, tvQuality, testRace, testRaceStatus,
      admin, subscribe,
      // 進行役のテレビ（2026-10-19）: state = { on, code, asking, decider, account }・on(cb) で変わるたびに
      pair: { get state() { return pairState(); }, on: onPair, hello: pairHello, get uid() { return uid(); } },
      // 決める係（テストと確認用）
      decider: { tick: deciderTick, start: startDecider, stop: stopDecider, heartbeat, get paired() { return pair.decider; }, get leader() { return decider.leader; }, get me() { return decider.me; }, get log() { return decider.log; }, decideRace, revealRace, expirePayouts, voidRace },
      ready,
    };
  }

  return { create, connect, COL, SDK, encodeFS, decodeFS, wrapDb, NESTED_ARRAY_MARK: NA };
});
