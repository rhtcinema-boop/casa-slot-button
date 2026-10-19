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
  const COL = { live: 'derbyLive', counts: 'derbyCounts', stores: 'derbyStores', pins: 'derbyPins', staff: 'derbyStaff', config: 'derbyConfig', races: 'derbyRaces', results: 'derbyResults', secrets: 'derbyRaceSecrets', tickets: 'derbyTickets', payouts: 'derbyPayouts', shorts: 'derbyShorts', logs: 'derbyLogs', stats: 'derbyStats', lock: 'derbyLock', clock: 'derbyClock', tvSwitch: 'derbySwitch', tvs: 'derbyTvs', deciders: 'derbyDeciders', testReq: 'derbyTestReq' }; /* tvs・deciders: 進行役のテレビ／testReq: この店だけテストレース（2026-10-19） */
  const LEASE_MS = 60000, RENEW_MS = 40000, BEAT_MS = 2000, CLOSING_STALE_MS = 20000, SHORT_TTL = 2 * 86400000;
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
    const live = { races: null, subs: 0, tickets: {}, payouts: {} }; // 見張りで届いた写し（state・getTicket は読み取りなしで答える）
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
    const WINDOW = (role === 'tv' ? 120 : role === 'staff' ? 60 : 30) * 60000; // 見るレースの範囲（テレビは前のレースのハイライトがあるので 2 時間、スタッフ 1 時間、スマホ 30 分）
    async function getRaces(fresh) { if (!fresh && live.subs > 0 && live.races) return live.races; const q = await db.collection(COL.races).where('at', '>=', now() - WINDOW).orderBy('at').get(); return q.docs.map((d) => d.data()); }
    const resultCache = {};
    async function resultsFor(races) { // テレビ: ゲートが開く 2 秒前から結果（seed）を読む（ルールで runAt まで読めない）
      if (role !== 'tv') return {};
      const t = now(), out = {};
      for (const r of races) {
        if (resultCache[r.id]) { out[r.id] = resultCache[r.id]; continue; }
        if ((r.status === 'decided' || r.status === 'done') && (t >= r.runAt - 2000 || canDecide())) { /* テレビ用アカウント（ルールの isDecider）は決まった直後から読める＝確定演出（ゲートインの遅れ）をゲートインの前に渡せる */
          try { const s = await doc(COL.results, r.id).get(); if (s.exists) { const x = s.data(); resultCache[r.id] = { winner: x.winner, order: x.order, finalOdds: x.finalOdds, seed: x.seed, finishTimes: x.finishTimes, winTime: x.winTime, natural: x.natural, cues: x.cues || null }; out[r.id] = resultCache[r.id]; } } catch (e) { /* まだ読めない */ } /* cues: 確定演出（derbyResults にだけ。derbyRaces・derbyLive には写さない） */
        }
      }
      return out;
    }
    let countsCache = null;
    const withCounts = (races, counts) => (counts ? races.map((r) => (r.status === 'upcoming' && counts[r.id] ? Object.assign({}, r, { participants: counts[r.id] }) : r)) : races);
    async function compose(s, races, stores, pub) {
      s = s || store;
      if (role !== 'phone') { if (!countsCache || live.subs === 0) { try { const c = await doc(COL.counts, 'live').get(); countsCache = c.exists ? c.data() : {}; } catch (e) { countsCache = {}; } } races = withCounts(races, countsCache); }
      return Core.stateFor({ t: now(), store: s, role, stores, races, tuning: pub, results: await resultsFor(races.filter((r) => Core.visibleTo(r, s))) });
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

    /* ---------- スマホ ---------- */
    async function reserveShort(storeId, kind, id, fixed) { // 6 桁の番号（その店で 2 日のあいだ重ならない）
      for (let k = 0; k < 8; k++) {
        const short = fixed ? Core.shortFor(Outcome, id, id, k) : String(100000 + Math.floor(Math.random() * 900000));
        const ref = doc(COL.shorts, storeId + '_' + short);
        const ok = await db.runTransaction(async (tx) => { const s = await tx.get(ref); if (s.exists && s.data().id !== id && s.data().createdAt > now() - SHORT_TTL) return false; tx.set(ref, { kind, id, storeId, createdAt: now() }); return true; }).catch(() => false);
        if (ok) return short;
      }
      return null;
    }
    async function createTicket(o) {
      await ready();
      const sid = (o && o.store) || store, b = Core.cleanTicket(o || {});
      const pl = role === 'phone' && !(live.subs > 0 && live.races) ? await phoneLive(sid) : null; // スマホ: 店舗も受付中のレースも「いまの状態」1 件から
      const stores = pl ? pl.stores || [] : await getStores(), st = stores.find((x) => x.id === sid); if (!st) throw E(404, 'no_store', '店舗が見つかりません');
      exchangeGuard(pl ? Core.openRaceFor(pl.races || [], sid, now()) : await openRace(sid), st.settings, pl ? pl.races || [] : null); // 参加受付の締切のあとは新しい券を作らない（server.js と同じ）
      const tid = randId('t', 14);
      try {
        const short = await reserveShort(sid, 'auth', tid);
        const tk = { tid, owner: uid(), storeId: sid, bill: b.bill, nick: b.nick, count: b.count, status: 'pending', createdAt: now(), short: short || null, test: !!(st.settings && st.settings.test) };
        await doc(COL.tickets, tid).set(tk);
        return { tid, key: tid, authCode: 'derby:auth:' + tid, ticket: Core.ticketView(tk), race: Core.publicRace(pl ? Core.openRaceFor(pl.races || [], sid, now()) : await openRace(sid), { role: 'phone', store: sid, storeSettings: st.settings, openId: null }) };
      } catch (e) { throw mapErr(e); }
    }
    /* 参加受付（引き換え）の締切（2026-10-16）: 受付中のレースの exchangeCloseAt（店ごとの上書きつき）を過ぎたら新しい券・認証は断る（server.js の exchangeGuard と同じ。ルールも認証で同じ時刻を見る） */
    function exchangeGuard(r, ss, races) {
      if (!r) return null;
      const g = Core.stagesFor(r, ss || {});
      if (now() >= g.exchangeCloseAt) { const nx = (races || live.races || []).filter((x) => Core.visibleTo(x, r.storeId || store) && x.status === 'upcoming' && x.at > r.at).sort((a, b) => a.at - b.at)[0]; throw E(409, 'exchange_closed', '参加受付は締め切りました。次のレースをお待ちください', { raceId: r.id, exchangeCloseAt: g.exchangeCloseAt, voteCloseAt: r.closeAt, nextAt: nx ? nx.at : null, nextOpenAt: r.closeAt }); }
      return g;
    }
    // 期限（expireAt）を過ぎた unpaid は、見回り（決める係）を待たずに「期限切れ」として見せる（受け取りは claim でも止まる。コードレビュー 2026-10-14）
    const effPay = (p) => (p && p.status === 'unpaid' && p.expireAt != null && now() >= p.expireAt ? Object.assign({}, p, { status: 'expired' }) : p);
    async function ticketBundle(tk) {
      let r = null, p = null;
      const rid0 = tk.raceId || tk.authRaceId; // 認証したレース（投票前）も見せる
      if (rid0) r = (live.subs > 0 && live.races && live.races.find((x) => x.id === rid0)) || data(await doc(COL.races, rid0).get());
      if (((r && r.status === 'done') || tk.novote) && tk.payoutId) { /* 返却（投票なし）は発表を待たない */ p = live.payouts[tk.payoutId] || null; if (!p) { try { p = data(await doc(COL.payouts, tk.payoutId).get()); } catch (e) { p = null; } } }
      return { r, p: effPay(p) };
    }
    async function getTicket(tid) {
      await ready();
      let tk = live.tickets[tid] || null; // 見張り中の券は写しで（読み取りなし）
      if (!tk) { try { tk = data(await doc(COL.tickets, String(tid || '')).get()); } catch (e) { throw E(404, 'no_ticket', '投票券が見つかりません'); } }
      if (!tk) throw E(404, 'no_ticket', '投票券が見つかりません');
      const { r, p } = await ticketBundle(tk), raceDoc = r || await openRace(tk.storeId);
      return { ticket: Core.ticketView(tk, r, p), race: Core.publicRace(raceDoc, { role: 'phone', store: tk.storeId }) };
    }
    async function cancelTicket(tid) {
      await ready();
      const ref = doc(COL.tickets, tid);
      try {
        const tk = await db.runTransaction(async (tx) => { const s = data(await tx.get(ref)); if (!s) throw E(404, 'no_ticket', '投票券が見つかりません'); if (s.status === 'void') return s; if (s.status !== 'pending') throw E(409, 'already_authorized', '認証済みの投票券は取り消せません'); tx.update(ref, { status: 'void' }); return Object.assign(s, { status: 'void' }); });
        if (live.tickets[tid]) live.tickets[tid] = tk;
        return { ticket: Core.ticketView(tk) };
      } catch (e) { throw mapErr(e); }
    }
    async function vote(tid, key, picksIn, raceId) {
      await ready();
      const ref = doc(COL.tickets, tid);
      try {
        const tk0 = live.tickets[tid] || data(await ref.get()); if (!tk0) throw E(404, 'no_ticket', '投票券が見つかりません'); // 見張り中の券は写しで（取引の中でもう一度確かめる）
        if (tk0.status === 'voted') throw E(409, 'already_voted', 'このレースはもう投票済みです');
        if (tk0.status === 'void' && tk0.novote) throw E(409, 'closed', '締め切りました（投票がなかったので返却します）', { novote: true });
        if (tk0.status !== 'authorized') throw E(403, 'not_authorized', 'スタッフの認証がまだです');
        const pk = Core.cleanPicks(Array.isArray(picksIn) ? { picks: picksIn } : { horse: picksIn }, tk0.count);
        const r0 = tk0.authRaceId ? data(await doc(COL.races, tk0.authRaceId).get()) : await openRace(tk0.storeId); if (!r0) throw E(409, 'no_open_race', '受付中のレースがありません'); // 認証したレースにだけ投票できる（2026-10-16）
        if (raceId && raceId !== r0.id) throw E(409, 'closed', 'このレースは締め切りました。次のレースに投票できます', { openId: r0.id }); // 見ていたレースが締め切られて次に移っていた（server.js と同じ）
        const t = now(), openNow = tk0.authRaceId ? await openRace(tk0.storeId) : r0, cx = { openId: openNow ? openNow.id : null }; // 締め切られていたら、いま受付中のレースを知らせる
        const tk = await db.runTransaction(async (tx) => {
          const s = data(await tx.get(ref)), r = data(await tx.get(doc(COL.races, r0.id)));
          if (s.status === 'voted') throw E(409, 'already_voted', 'このレースはもう投票済みです');
          if (s.status === 'void' && s.novote) throw E(409, 'closed', '締め切りました（投票がなかったので返却します）', { novote: true });
          if (s.status !== 'authorized') throw E(403, 'not_authorized', 'スタッフの認証がまだです');
          if (!r || r.status !== 'upcoming' || t >= r.closeAt) throw E(409, 'closed', '締め切りました', cx);
          if (s.authRaceId && s.authRaceId !== r.id) throw E(409, 'closed', '締め切りました', cx);
          const patch = { status: 'voted', raceId: r.id, picks: pk.picks, pickMap: pk.pickMap, votedAt: t };
          tx.update(ref, patch); return Object.assign(s, patch);
        });
        if (live.tickets[tid]) live.tickets[tid] = tk;
        return { ticket: Core.ticketView(tk), race: Core.publicRace(r0, { role: 'phone', store: tk.storeId, openId: r0.id }) };
      } catch (e) { throw mapErr(e, 'closed', '締め切りました', 409); }
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
    async function resolveCode(code, kind) {
      const c = Core.parseCode(code, kind);
      if (!c.short) return c.id;
      const s = data(await doc(COL.shorts, store + '_' + c.short).get());
      if (!s || s.createdAt < now() - SHORT_TTL) throw E(404, kind === 'auth' ? 'no_ticket' : 'no_payout', 'この番号は見つかりません（' + c.short + '）');
      if (s.kind !== kind) throw E(400, 'wrong_code', s.kind === 'pay' ? 'これは受け取りの番号です' : 'これは認証の番号です', { kind: s.kind });
      return s.id;
    }
    async function readTicketAsStaff(code) {
      const tid = await resolveCode(code, 'auth');
      let tk; try { tk = data(await doc(COL.tickets, tid).get()); } catch (e) { if (e && e.code === 'permission-denied') { staffOk = null; throw E(403, 'wrong_store', 'ほかの店舗の投票券か、見つかりません'); } throw mapErr(e); }
      if (!tk) throw E(404, 'no_ticket', '投票券が見つかりません');
      return tk;
    }
    async function addLog(entry, tx) {
      const t = now(), pub = await getPublic();
      const ref = entry._id ? doc(COL.logs, entry._id) : db.collection(COL.logs).doc();
      const row = Object.assign({ at: t, date: Core.bizDate(t, pub.dayStartHour), cal: Core.dateStr(t) }, entry); delete row._id;
      Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
      if (tx) tx.set(ref, row); else await ref.set(row);
    }
    async function staffTicket(pin, code) { await staffEnsure(pin); return { ticket: Core.ticketView(await readTicketAsStaff(code)) }; }
    async function authTicket(pin, code, count, rateSeen) {
      await staffEnsure(pin);
      const tk0 = await readTicketAsStaff(code), ref = doc(COL.tickets, tk0.tid);
      if (tk0.storeId !== store) throw E(403, 'wrong_store', 'ほかの店舗の投票券です');
      const stInfo = (await getStores()).find((x) => x.id === store) || {};
      const r0 = Core.openRaceFor(await getRaces(true), store, now()); if (!r0) throw E(409, 'no_open_race', '受付中のレースがありません（次のレースの受付を待ってください）');
      exchangeGuard(r0, stInfo.settings);
      try {
        const tk = await db.runTransaction(async (tx) => {
          const s = data(await tx.get(ref));
          if (s.status !== 'pending') throw E(409, 'already_authorized', s.status === 'void' ? 'この投票券は無効です' : 'もう認証済みです');
          if (count != null && count !== '' && Number(count) !== s.count) throw E(400, 'count_mismatch', 'お客さんの枚数（' + s.count + ' 枚）と違います');
          // 参加受付の締切（サーバーの時計。ルールも request.time で同じ時刻を見る）。認証したレース authRaceId を券に残す（このレースで投票しなければ返却）
          const rr = data(await tx.get(doc(COL.races, r0.id))); if (!rr || rr.status !== 'upcoming') throw E(409, 'exchange_closed', '参加受付は締め切りました');
          exchangeGuard(rr, stInfo.settings);
          // 交換の割合（リングバウンティ ○枚 ＝ 投票券 1 枚）は公開の設定から取引の中で読む（ルールも同じ値を確かめる）。スタッフの画面の割合と違えば断る
          const pb = data(await tx.get(doc(COL.config, 'public'))), rate = Core.bountyRate(pb || {});
          if (rateSeen != null && rateSeen !== '' && Number(rateSeen) !== rate) throw E(409, 'rate_changed', '交換の割合が変わりました（リングバウンティ ' + rate + '枚 ＝ 投票券 1 枚）。読み直してください', { rate });
          const patch = { status: 'authorized', authAt: now(), authBy: uid(), authRaceId: rr.id, rate, bounty: s.count * rate }; // 認証したときの割合を券に残す
          tx.update(ref, patch); const done = Object.assign(s, patch); await addLog(Object.assign({ _id: 'auth_' + s.tid }, { type: 'auth', test: s.test || rr.test || undefined, storeId: s.storeId, bill: s.bill, nick: s.nick, count: s.count, rate, bounty: patch.bounty, tid: s.tid }), tx); return done; // 記録も同じ取引で（通信が切れて「認証・受け取りはできたのに記録がない」をなくす）
        });
        return { ticket: Core.ticketView(tk) };
      } catch (e) { throw mapErr(e); }
    }
    async function readPayoutAsStaff(code) {
      const pid = await resolveCode(code, 'pay');
      let p; try { p = data(await doc(COL.payouts, pid).get()); } catch (e) { if (e && e.code === 'permission-denied') { staffOk = null; throw E(403, 'wrong_store', 'ほかの店舗の当たりか、見つからないか、まだ結果の発表前です'); } throw mapErr(e); }
      if (!p) throw E(404, 'no_payout', '当たりが見つかりません');
      return p;
    }
    async function staffPayout(pin, code) { await staffEnsure(pin); const p = effPay(await readPayoutAsStaff(code)); return { payout: Core.payoutView(p, storeNameOf(await getStores()), p.revealAt <= now()) }; }
    async function claim(pin, code) {
      await staffEnsure(pin);
      const p0 = await readPayoutAsStaff(code), ref = doc(COL.payouts, p0.pid), names = storeNameOf(await getStores());
      if (p0.storeId !== store) throw E(403, 'wrong_store', 'ほかの店舗の当たりです（' + names(p0.storeId) + '）');
      try {
        const p = await db.runTransaction(async (tx) => {
          const s = data(await tx.get(ref));
          const rr = s.kind === 'refund' ? null : data(await tx.get(doc(COL.races, s.raceId))); // 返還の途中・返還済みのレースの当たりは受け取れない（返還と同時に受け取ると二重に渡っていた）
          if (s.revealAt > now()) throw E(409, 'not_revealed', 'まだ結果の発表前です');
          if (s.status === 'void') throw E(409, 'void', 'このレースは返還になりました（当たりは取り消し）');
          if (s.status === 'expired' || (s.status === 'unpaid' && s.expireAt && now() >= s.expireAt)) throw E(409, 'expired', '受け取りの期限が切れています（営業日が変わったので破棄）', { payout: Core.payoutView(s, names, true) });
          if (s.status === 'paid') throw E(409, 'already_paid', 'もう受け取り済みです（' + Core.fmtTime(s.paidAt) + '）', { payout: Core.payoutView(s, names, true) });
          if (rr && rr.refunded) throw E(409, 'void', 'このレースは返還になりました（当たりは取り消し）'); // 受け取り済みなら already_paid を先に
          const patch = { status: 'paid', paidAt: now(), paidBy: uid() };
          tx.update(ref, patch); const done = Object.assign(s, patch); await addLog(Object.assign({ _id: 'paid_' + s.pid }, { type: 'paid', test: s.test || undefined, kind: s.kind || 'win', novote: s.novote || undefined, storeId: s.storeId, bill: s.bill, nick: s.nick, count: s.kind === 'refund' ? s.count || 0 : s.amount, tid: s.tid, pid: s.pid, raceId: s.raceId }, s.kind === 'refund' ? { bounty: Core.payoutBounty(s) } : {}), tx); return done; // 記録も同じ取引で（通信が切れて「認証・受け取りはできたのに記録がない」をなくす）
        });
        return { payout: Core.payoutView(p, names, true) };
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
       結果（result）と当たった人（winners）は発表後（done）だけ。設定額・決定の中身は入れない。中身が変わったときだけ書く */
    const LIVE_KEYS = ['id', 'storeId', 'at', 'openAt', 'exchangeCloseAt', 'exchangeSec', 'voteSec', 'closeAt', 'runAt', 'revealAt', 'endAt', 'status', 'dist', 'weather', 'surface', 'horses', 'tune', 'odds', 'tenkai', 'refunded', 'refundedAt', 'day', 'gateSec', 'postSec', 'resultSec'];
    function liteRace(r) { const o = {}; LIVE_KEYS.forEach((k) => { if (r[k] !== undefined) o[k] = r[k]; }); if (o.status === 'closing') o.status = 'closed'; if (r.status === 'done') { o.result = r.result || null; o.winners = r.winners || []; o.photo = !!r.photo; } return o; }
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
    async function publishWith(changed) { // 変わった 1 レースを手元の一覧に入れて書く（全部を読み直さない）
      try { const base = live.races || await getRaces(true); await publishLive(base.filter((x) => x.id !== changed.id).concat([changed])); } catch (e) { /* 次の見回りで直る */ }
    }
    async function writeRace(entry, sc, opt) {
      const built = Core.buildRace(Engine, Outcome, entry, sc.tuning, sc.salt, now(), opt);
      const r = built.race;
      const b = db.batch();
      b.set(doc(COL.races, r.id), Object.assign({}, r, { closeAtTs: Ts(r.closeAt), runAtTs: Ts(r.runAt), revealAtTs: Ts(r.revealAt) }));
      b.set(doc(COL.secrets, r.id), Object.assign({}, built.secret, { day: r.day }));
      await b.commit();
      await publishWith(r);
      return r;
    }
    /* 手入力の 6 桁の番号（受け取り用）を選ぶ: 取引の中で読んで、空いている（または同じ id の・2 日より古い）番号だけを使う。
       以前は k=0 の番号を確かめずに上書きしていたので、同じ店で番号が重なると先の当たりの番号が別の人の当たりを指していた（QA 2026-10-14）。
       items: [{ storeId, id }]。読むだけ（書くのは呼ぶ側。Firestore の取引は「読む → 書く」の順） */
    async function pickShorts(tx, items, salt) {
      const used = new Set(), out = [], lim = now() - SHORT_TTL;
      for (const it of items) {
        let got = null;
        for (let k = 0; k < 12 && !got; k++) {
          const short = Core.shortFor(Outcome, salt, it.id, k), key = it.storeId + '_' + short;
          if (used.has(key)) continue;
          const s = data(await tx.get(doc(COL.shorts, key)));
          if (!s || s.id === it.id || !(s.createdAt > lim)) got = short;
        }
        if (got) used.add(it.storeId + '_' + got);
        out.push(got); // 見つからなければ null（QR では受け取れる）
      }
      return out;
    }
    const CHUNK = 120; // 1 回の取引で書くのは 500 件まで（Firestore の上限）。当たり 1 件 = 当たり・番号・投票券の 3 件
    async function decideRace(raceId, actor) {
      const ref = doc(COL.races, raceId), t = now(), key = randId('k', 12);
      const claimed = await db.runTransaction(async (tx) => {
        const r = data(await tx.get(ref)); if (!r) return null;
        const can = (r.status === 'upcoming' && r.closeAt <= t) || (r.status === 'closing' && (r.closingAt || 0) < t - CLOSING_STALE_MS);
        if (!can) return null;
        tx.update(ref, { status: 'closing', closingBy: actor || uid(), closingAt: t, closingKey: key }); return r;
      });
      if (!claimed) return null;
      const r = claimed, sc = await secretConfig(), secret = data(await doc(COL.secrets, raceId).get()) || { payoutTarget: 0, scope: 'all', winProb: null };
      const tq = await db.collection(COL.tickets).where('raceId', '==', raceId).where('status', '==', 'voted').get();
      const tickets = tq.docs.map((d) => { const x = d.data(); return Object.assign(x, { picks: Core.picksFromMap(x.pickMap) }); });
      const day = r.day || Core.bizDate(r.at, sc.tuning.dayStartHour), st = data(await doc(COL.stats, day).get());
      const d = Core.decideRace(Engine, Outcome, r, secret, tickets, sc.tuning, sc.salt, now(), (st && st.committed) || 0);
      const exp = Core.expireAtFor(Math.max(r.at, d.revealAt), sc.tuning.dayStartHour); // 区切りをまたいで発表されるときは、発表した営業日の終わりまで
      // 書く前に毎回「まだ自分が決めている途中か」を取引の中で確かめる。止まったと思われて別のテレビに引き継がれたあとで
      // 遅れて書くと、受け取り済みの当たりを unpaid に戻したり、1 日の上限の数（committed）を二重に足したりしていた（QA 2026-10-14）
      const mine = (x) => !!x && x.status === 'closing' && x.closingKey === key;
      const list = d.payouts.map((p) => ({ p, pid: Core.pidFor(Outcome, sc.salt, raceId, p.tid, 'win') }));
      const CH = cap(CHUNK, 5); // 進行役のテレビは 1 回 15 件まで（当たり 1 件 = 3 件の書き込み）
      for (let i = 0; i < list.length; i += CH) { // 当たりが多いと 1 回で書けない（500 件の上限）ので分けて書く。同じ id なので何度書いても同じ
        const part = list.slice(i, i + CH);
        const okp = await db.runTransaction(async (tx) => {
          if (!mine(data(await tx.get(ref)))) return false;
          const shorts = await pickShorts(tx, part.map((x) => ({ storeId: x.p.storeId, id: x.pid })), sc.salt);
          part.forEach(({ p, pid }, j) => {
            const short = shorts[j];
            tx.set(doc(COL.payouts, pid), Object.assign({}, p, { pid, short, day, createdAt: now(), revealAt: d.revealAt, revealAtTs: Ts(d.revealAt), expireAt: exp, expireAtTs: Ts(exp) }));
            if (short) tx.set(doc(COL.shorts, p.storeId + '_' + short), { kind: 'pay', id: pid, storeId: p.storeId, createdAt: now() });
            tx.update(doc(COL.tickets, p.tid), { payoutId: pid });
          });
          return true;
        });
        if (!okp) return null;
      }
      /* 返却（2026-10-16）: このレースに認証されたのに投票しなかった券を無効にして、認証した枚数の返却の受け取りを作る（発表を待たずに読める＝revealAt は今）。
         取引の中で券がまだ authorized かを確かめてから書く（やり直しても二重に作らない・集計も 1 回だけ） */
      const uq = await db.collection(COL.tickets).where('authRaceId', '==', raceId).where('status', '==', 'authorized').get();
      const nv = Core.novotePlan(r, uq.docs.map((d) => d.data())).map((x) => ({ x, pid: Core.pidFor(Outcome, sc.salt, raceId, x.tid, 'novote') }));
      const tRet = now(), expRet = Core.expireAtFor(Math.max(r.at, tRet), sc.tuning.dayStartHour);
      const NV = cap(90, 3); // 返却 1 件 = 4 件の書き込み（＋集計 1 件）
      for (let i = 0; i < nv.length; i += NV) {
        const part = nv.slice(i, i + NV);
        const okn = await db.runTransaction(async (tx) => {
          if (!mine(data(await tx.get(ref)))) return false;
          const cur = []; for (const y of part) cur.push(data(await tx.get(doc(COL.tickets, y.x.tid))));
          const todo = part.filter((y, j) => cur[j] && cur[j].status === 'authorized' && cur[j].authRaceId === raceId);
          const shorts = await pickShorts(tx, todo.map((y) => ({ storeId: y.x.storeId, id: y.pid })), sc.salt);
          const inc = { date: day, bounty: 0, tickets: 0, byStore: {} };
          todo.forEach(({ x, pid }, j) => {
            const short = shorts[j];
            tx.set(doc(COL.payouts, pid), Object.assign({}, x, { pid, short, day, createdAt: tRet, revealAt: tRet, revealAtTs: Ts(tRet), expireAt: expRet, expireAtTs: Ts(expRet) }));
            if (short) tx.set(doc(COL.shorts, x.storeId + '_' + short), { kind: 'pay', id: pid, storeId: x.storeId, createdAt: tRet });
            tx.update(doc(COL.tickets, x.tid), { status: 'void', novote: true, raceId, payoutId: pid, voidAt: tRet });
            tx.set(doc(COL.logs, 'ret_' + pid), { at: tRet, date: Core.bizDate(tRet, sc.tuning.dayStartHour), cal: Core.dateStr(tRet), type: 'return', test: x.test || false, storeId: x.storeId, bill: x.bill, nick: x.nick, count: x.count, rate: x.rate, bounty: x.bounty, tid: x.tid, pid, raceId });
            if (!x.test) { inc.bounty += x.bounty; inc.tickets += x.count; const b = (inc.byStore[x.storeId] = inc.byStore[x.storeId] || { bounty: 0, tickets: 0 }); b.bounty += x.bounty; b.tickets += x.count; }
          });
          if (inc.tickets) { const by = {}; Object.keys(inc.byStore).forEach((k) => { by[k] = { bountyReturned: FieldValue.increment(inc.byStore[k].bounty), returnedTickets: FieldValue.increment(inc.byStore[k].tickets) }; }); tx.set(doc(COL.stats, day), { date: day, bountyReturned: FieldValue.increment(inc.bounty), returnedTickets: FieldValue.increment(inc.tickets), byStore: by }, { merge: true }); } /* 返却はリングバウンティ */
          return true;
        });
        if (!okn) return null;
      }
      const fin = await db.runTransaction(async (tx) => {
        if (!mine(data(await tx.get(ref)))) return false;
        tx.set(doc(COL.results, raceId), Object.assign({ raceId, runAt: d.runAt, runAtTs: Ts(d.runAt), revealAt: d.revealAt }, d.result)); // runAt: 遅れて決めたときは後ろへずれる（core.js）
        tx.set(doc(COL.secrets, raceId), { decision: d.decision }, { merge: true });
        tx.update(ref, { status: 'decided', runAt: d.runAt, runAtTs: Ts(d.runAt), revealAt: d.revealAt, endAt: d.endAt, revealAtTs: Ts(d.revealAt), photo: d.photo, participants: d.participants, decidedAt: now() });
        tx.set(doc(COL.stats, day), { date: day, committed: FieldValue.increment(d.decision.paidReal != null ? d.decision.paidReal : d.decision.paid) }, { merge: true }); // テストの店の当たりは 1 日の上限に数えない
        tx.set(doc(COL.counts, 'live'), { [raceId]: FieldValue.delete() }, { merge: true });
        return true;
      });
      if (!fin) return null;
      await publishWith(Object.assign({}, r, { status: 'decided', runAt: d.runAt, revealAt: d.revealAt, endAt: d.endAt, photo: d.photo, participants: d.participants }));
      return Object.assign({}, r, { status: 'decided', runAt: d.runAt, revealAt: d.revealAt, endAt: d.endAt, photo: d.photo, participants: d.participants, result: d.result, decision: d.decision });
    }
    async function commitChunks(writes) { // [ (b) => void ] を 400 件ずつ batch で（同じ id への書き込みなので、何度やっても同じ）。進行役のテレビは 15 件ずつ
      const n = cap(400, 15);
      for (let i = 0; i < writes.length; i += n) { const b = db.batch(); writes.slice(i, i + n).forEach((w) => w(b)); await b.commit(); }
    }
    async function revealRace(raceId, force) { const out = await revealRace0(raceId, force); if (out) await publishWith(out); return out; }
    async function revealRace0(raceId, force) {
      const ref = doc(COL.races, raceId), t = now();
      const r0 = data(await ref.get()); if (!r0 || r0.status !== 'decided' || (!force && r0.revealAt > t)) return null;
      if (r0.refunded && r0.refundDone === false) return null; // 返還の途中（取り消しを書き終わってから返還の処理が発表する）
      const sc = await secretConfig(), h = sc.tuning.dayStartHour;
      const res = data(await doc(COL.results, raceId).get());
      const pq = await db.collection(COL.payouts).where('raceId', '==', raceId).get(), payouts = pq.docs.map((d) => d.data());
      const tq = await db.collection(COL.tickets).where('raceId', '==', raceId).where('status', '==', 'voted').get(), tickets = tq.docs.map((d) => d.data());
      const names = storeNameOf(await getStores(true)), day = r0.day;
      const out = await db.runTransaction(async (tx) => {
        const r = data(await tx.get(ref)); if (!r || r.status !== 'decided' || (r.refunded && r.refundDone === false) || !!r.refunded !== !!r0.refunded) return null; // 読んだあとに返還が入った: 古い当たりの一覧で数えない（返還の処理が発表する）
        const revealAt = Math.min(r.revealAt, t), patch = { status: 'done', revealAt, revealedAt: t, endAt: revealAt + (r.resultSec || 300) * 1000, revealAtTs: Ts(revealAt), result: res ? { winner: res.winner, order: res.order, finalOdds: res.finalOdds, seed: res.seed, finishTimes: res.finishTimes, winTime: res.winTime, natural: res.natural } : null, winners: Core.winnersFrom(payouts, names) };
        tx.update(ref, patch);
        const inc = { date: day, races: FieldValue.increment(r.test ? 0 : 1) }; /* テストのレース（2026-10-19）は数えない */ let nt = 0, bet = 0, paid = 0, bb = 0; const by = {}, bills = {}, z = () => ({ tickets: 0, bet: 0, paid: 0, bounty: 0 });
        tickets.forEach((tk) => { if (tk.test || r.test) return; const kb = Core.ticketBounty(tk); nt++; bet += tk.count; bb += kb; const b = (by[tk.storeId] = by[tk.storeId] || z()); b.tickets++; b.bet += tk.count; b.bounty += kb; bills[tk.storeId + ':' + tk.bill] = true; });
        payouts.forEach((p) => { if (p.kind === 'refund' || p.status === 'void' || p.test) return; paid += p.amount; (by[p.storeId] = by[p.storeId] || z()).paid += p.amount; });
        inc.tickets = FieldValue.increment(nt); inc.bet = FieldValue.increment(bet); inc.paid = FieldValue.increment(paid); inc.bountyBet = FieldValue.increment(bb); inc.betRated = FieldValue.increment(bet); /* 受け取ったリングバウンティ（認証したときの割合） */
        inc.byStore = {}; Object.keys(by).forEach((s) => { inc.byStore[s] = { tickets: FieldValue.increment(by[s].tickets), bet: FieldValue.increment(by[s].bet), paid: FieldValue.increment(by[s].paid), bountyBet: FieldValue.increment(by[s].bounty), betRated: FieldValue.increment(by[s].bet) }; });
        inc.bills = bills;
        tx.set(doc(COL.stats, day), inc, { merge: true });
        return Object.assign(r, patch);
      });
      if (!out) return null;
      // 当たりの記録と、発表の時刻・受け取りの期限の直し（1 件ずつ・何度書いても同じ。取引の 500 件の上限を超えないよう取引の外で）
      const exp = Core.expireAtFor(Math.max(r0.at, t), h), ws = [];
      payouts.forEach((p) => {
        if (p.kind === 'refund' || p.status === 'void') return;
        const patch = {};
        if (force && p.revealAt > out.revealAt) Object.assign(patch, { revealAt: out.revealAt, revealAtTs: Ts(out.revealAt) });
        if (p.status === 'unpaid' && p.expireAt != null && p.expireAt < exp) Object.assign(patch, { expireAt: exp, expireAtTs: Ts(exp) }); // 決める係が止まっていて区切りのあとに発表した
        if (Object.keys(patch).length) ws.push((b) => b.update(doc(COL.payouts, p.pid), patch));
        ws.push((b) => b.set(doc(COL.logs, 'win_' + p.pid), { at: t, date: Core.bizDate(t, h), cal: Core.dateStr(t), type: 'win', test: p.test || false, storeId: p.storeId, bill: p.bill, nick: p.nick, count: p.amount, tid: p.tid, pid: p.pid, raceId })); // 日付の区切りは設定どおり（以前は 5 時に固定）
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
        // 期限は expireAt（発表した営業日の終わり）。テストで today を渡したときと、古いデータ（expireAt なし）は営業日でくらべる
        const due = o.today || p.expireAt == null ? p.day < today : now() >= p.expireAt;
        if ((o.pid && p.pid !== o.pid) || !due) continue;
        const ok = await db.runTransaction(async (tx) => {
          const s = data(await tx.get(doc(COL.payouts, p.pid))); if (!s || s.status !== 'unpaid') return false;
          const rr = data(await tx.get(doc(COL.races, s.raceId))); if (rr && rr.refunded && rr.refundDone === false) return false; // 返還の途中（取り消し予定）は触らない
          tx.update(doc(COL.payouts, p.pid), { status: 'expired', expiredAt: now() });
          const rf = s.kind === 'refund', pb = Core.payoutBounty(s);
          if (!s.test) { const k = !rf ? 'expired' : s.novote ? 'bountyReturnedExpired' : 'bountyRefundExpired', v = rf ? pb : s.amount; tx.set(doc(COL.stats, s.day), { date: s.day, [k]: FieldValue.increment(v), byStore: { [s.storeId]: { [k]: FieldValue.increment(v) } } }, { merge: true }); } // 当たりは額・返却/返還はリングバウンティ
          tx.set(doc(COL.logs, 'exp_' + s.pid), Object.assign({ at: now(), date: Core.bizDate(now(), sc.tuning.dayStartHour), cal: Core.dateStr(now()), type: 'expired', test: s.test || false, kind: s.kind || 'win', storeId: s.storeId, bill: s.bill, nick: s.nick, count: rf ? s.count || 0 : s.amount, tid: s.tid, pid: s.pid, raceId: s.raceId, day: s.day }, rf ? { bounty: pb } : {}));
          return true;
        });
        if (ok) n++;
      }
      return n;
    }
    /* 返還: ① 取引の中で、払い戻しの状態を読み直して「返還の印・集計」を 1 回だけ書く（このあとスタッフは当たりを受け取れない＝ルールと claim の取引がレースを見る）
             ② 取り消し・返還の受け取りを分けて書く（何度書いても同じ id）③ 終わりの印 → 発表前なら発表。
       以前は取引なしの 1 回の batch で、読んだあとに受け取られた当たりを void にして返還も全額出していた（二重に渡る）。当たりが多いと 500 件の上限で失敗していた。
       ②の途中で止まったら、もう一度「返還」を押すと続きから（refundDone: false）。 */
    async function refundRace(raceId) {
      const ref = doc(COL.races, raceId), r = data(await ref.get());
      if (!r) throw E(404, 'no_race', 'レースが見つかりません');
      const resume = !!r.refunded && r.refundDone === false;
      if (r.refunded && !resume) throw E(409, 'already_refunded', 'もう返還済みです');
      if (!['closing', 'decided', 'done'].includes(r.status)) throw E(409, 'not_closed', '締切前のレースは返還できません（投票は次のレースに回せません）');
      if (r.status === 'closing') throw E(409, 'busy', 'いま結果を決めているところです。少し待ってからもう一度');
      const sc = await secretConfig(), t = now(), day = r.day;
      const tickets = (await db.collection(COL.tickets).where('raceId', '==', raceId).where('status', '==', 'voted').get()).docs.map((d) => d.data());
      const payIds = (await db.collection(COL.payouts).where('raceId', '==', raceId).get()).docs.map((d) => d.id);
      let plan, wasDone;
      if (!resume) {
        const got = await db.runTransaction(async (tx) => {
          const rr = data(await tx.get(ref));
          if (!rr) throw E(404, 'no_race', 'レースが見つかりません');
          if (rr.refunded) throw E(409, 'already_refunded', 'もう返還済みです');
          if (!['decided', 'done'].includes(rr.status)) throw E(409, 'busy', 'いま結果を決めているところです。少し待ってからもう一度');
          const pays = []; for (const id of payIds) { const p = data(await tx.get(doc(COL.payouts, id))); if (p) pays.push(p); }
          const pl = Core.refundPlan(tickets, pays, rr), wd = rr.status === 'done';
          let voided = 0; const byStore = {};
          pl.voids.forEach((p) => { if (!p.test) voided += p.amount; });
          const refundB = pl.refunds.filter((x) => !x.test).reduce((a, x) => a + x.bounty, 0); /* 返還はリングバウンティ */
          pl.refunds.forEach((x) => { if (!x.test) { const s = (byStore[x.storeId] = byStore[x.storeId] || { refund: 0, paid: 0 }); s.refund += x.bounty; } });
          if (wd) pl.voids.forEach((p) => { if (!p.test) (byStore[p.storeId] = byStore[p.storeId] || { refund: 0, paid: 0 }).paid -= p.amount; });
          const inc = { date: day, bountyRefund: FieldValue.increment(refundB), committed: FieldValue.increment(-voided), byStore: {} };
          if (wd) inc.paid = FieldValue.increment(-voided);
          Object.keys(byStore).forEach((s) => { inc.byStore[s] = { bountyRefund: FieldValue.increment(byStore[s].refund) }; if (wd) inc.byStore[s].paid = FieldValue.increment(byStore[s].paid); });
          tx.set(doc(COL.stats, day), inc, { merge: true });
          tx.update(ref, { refunded: true, refundDone: false, refundWasDone: wd, refundBounty: pl.bounty, refundedAt: t, refundTickets: pl.refunds.length, winners: [] });
          tx.set(doc(COL.secrets, raceId), { decision: { paid: Object.values(pl.paidBy).reduce((a, x) => a + x, 0), refunded: true } }, { merge: true });
          return { pl, wd };
        });
        plan = got.pl; wasDone = got.wd;
      } else { // 続き: 取り消し済み（void）は数えないので、同じ返還の一覧になる
        const pays = (await Promise.all(payIds.map((id) => doc(COL.payouts, id).get()))).map(data).filter(Boolean);
        plan = Core.refundPlan(tickets, pays, r); wasDone = !!r.refundWasDone;
      }
      const revealAt = Math.min(r.revealAt, t), exp = Core.expireAtFor(Math.max(r.at, revealAt, t), sc.tuning.dayStartHour); // 翌日に返還したときも、その営業日の終わりまで受け取れる
      const ws = plan.voids.map((p) => (b) => b.update(doc(COL.payouts, p.pid), { status: 'void' }));
      await commitChunks(ws);
      const items = plan.refunds.map((x) => ({ x, pid: Core.pidFor(Outcome, sc.salt, raceId, x.tid, 'refund') }));
      const RF = cap(100, 3);
      for (let i = 0; i < items.length; i += RF) { // 返還 1 件 = 4 件の書き込み
        const part = items.slice(i, i + RF);
        await db.runTransaction(async (tx) => {
          const shorts = await pickShorts(tx, part.map((y) => ({ storeId: y.x.storeId, id: y.pid })), sc.salt);
          part.forEach(({ x, pid }, j) => {
            const short = shorts[j];
            tx.set(doc(COL.payouts, pid), Object.assign({}, x, { pid, short, day, createdAt: t, revealAt, revealAtTs: Ts(revealAt), expireAt: exp, expireAtTs: Ts(exp) }));
            if (short) tx.set(doc(COL.shorts, x.storeId + '_' + short), { kind: 'pay', id: pid, storeId: x.storeId, createdAt: t });
            tx.update(doc(COL.tickets, x.tid), { payoutId: pid, refunded: true });
            tx.set(doc(COL.logs, 'ref_' + pid), { at: t, date: Core.bizDate(t, sc.tuning.dayStartHour), cal: Core.dateStr(t), type: 'refund', test: x.test || false, storeId: x.storeId, bill: x.bill, nick: x.nick, count: x.count, rate: x.rate, bounty: x.bounty, tid: x.tid, pid, raceId });
          });
        });
      }
      await ref.update({ refundDone: true });
      if (!wasDone) await revealRace(raceId, true); else { const fresh = data(await ref.get()); if (fresh) await publishWith(fresh); }
      return { bounty: plan.bounty, tickets: plan.refunds.length };
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
      const t = now(), horizon = Math.max(sc.tuning.betSec * 1000 + 120000, (sc.tuning.horizonMin || 15) * 60000), have = new Set(races.map((r) => r.id));
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
    function watchParticipants(races) { // 受付中のレースの票を見張って、参加人数をレースに書く（見張りなので読み取りは変化の分だけ）
      const open = new Set(races.filter((r) => r.status === 'upcoming').map((r) => r.id));
      Object.keys(decider.ticketUnsubs).forEach((id) => { if (!open.has(id)) { decider.ticketUnsubs[id](); delete decider.ticketUnsubs[id]; clearTimeout(decider.flushT[id]); delete decider.flushT[id]; delete decider.pending[id]; delete decider.participantsAt[id]; } }); // 終わったレースの分は捨てる
      open.forEach((id) => {
        if (decider.ticketUnsubs[id]) return;
        decider.ticketUnsubs[id] = db.collection(COL.tickets).where('raceId', '==', id).where('status', '==', 'voted').onSnapshot((q) => {
          const p = { total: 0, byStore: {}, medals: 0 };
          q.docs.forEach((d) => { const x = d.data(); p.total++; p.byStore[x.storeId] = (p.byStore[x.storeId] || 0) + 1; p.medals += x.count; });
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
      (await processTestReqs(sc, races)).forEach((x) => did.push(x)); // この店だけテストレース（2026-10-19）
      const made = await materialize(sc, races); if (made) did.push('create ' + made);
      watchParticipants(races);
      if (!did.length) await publishLive(live.races || races).catch(() => {}); // 何かした回は、その場でもう書いてある（はじめに読んだ古い一覧で上書きしない）
      /* 期限切れの見回りは 15 分に 1 回と、営業日の区切り（5 時）を越えたとき */ const dayNow = Core.bizDate(t, sc.tuning.dayStartHour); if (t - decider.lastExpire > 15 * 60000 || decider.lastExpireDay !== dayNow) { decider.lastExpire = t; decider.lastExpireDay = dayNow; const n = await expirePayouts(); if (n) did.push('expire ' + n); }
      return { leader: true, did };
    }
    /* ---------- この店だけテストレース（2026-10-19）: スタッフのお願い derbyTestReq/<店舗> を見て、決める係（の鍵を持つ 1 台）が作る ---------- */
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
        if (!(await getStores()).some((s) => s.id === sid)) { await ref.set({ err: 'no_store', doneAt: t }, { merge: true }); continue; }
        if (Core.testRaceBusy(races, sid, t, startIn, sc.tuning, sc.timetable.rules || [])) { await ref.set({ err: 'busy', doneAt: t }, { merge: true }); did.push('test busy ' + sid); continue; }
        const r = await writeRace({ id, at: t + startIn * 1000, payout: Core.TEST_RACE.payout, scope: 'all', storeId: sid, test: true }, sc, Core.manualStages({}, startIn, sc.tuning)); // 管理画面の「テストのレースを作る」と同じ形（その店だけ）＋ test
        await ref.set({ raceId: r.id, raceAt: r.at, doneAt: t }, { merge: true });
        did.push('test ' + r.id);
      }
      return did;
    }
    // スタッフ: 進行役のテレビがいるか（決める係の鍵の期限。鍵は 20 秒ごとに延ばすので、止まると 60 秒以内に切れる）
    async function deciderAlive() { const l = data(await doc(COL.lock, 'decider').get()); return !!(l && l.until > now()); }
    async function testRace(pin, startIn) {
      await staffEnsure(pin);
      const sec = Core.testStartIn(startIn);
      if (!(await deciderAlive().catch(() => false))) throw E(409, 'no_decider', '進行役のテレビがありません');
      if (Core.testRaceBusy(await getRaces(true), store, now(), sec, await getPublic(), [])) throw E(409, 'busy', 'いまはテストのレースを作れません（受付中・レース中か、もうすぐ次のレースです）');
      const write = () => doc(COL.testReq, store).set({ at: FieldValue.serverTimestamp(), by: uid(), startIn: sec });
      try { await write(); }
      catch (e) {
        if (!(e && e.code === 'permission-denied')) throw mapErr(e);
        staffOk = null; await staffEnsure(pin); // PIN が変わっていた → bad_pin。登録し直せたら 1 回だけやり直す
        try { await write(); } catch (e2) { if (e2 && e2.code === 'permission-denied') throw E(429, 'too_soon', '少し待ってからもう一度押してください'); throw mapErr(e2); }
      }
      return { ok: true, pending: true, startIn: sec };
    }
    async function testRaceStatus(pin) {
      await staffEnsure(pin);
      const [alive, q] = await Promise.all([deciderAlive().catch(() => false), doc(COL.testReq, store).get().then(data).catch(() => null)]);
      return { decider: alive, req: q ? { at: msOf(q.at), startIn: q.startIn, raceId: q.raceId || null, raceAt: q.raceAt || null, err: q.err || null } : null };
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

    /* ---------- リアルタイム（onSnapshot → state / race / ticket / next / reload / payout） ---------- */
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
        const gotRaces = (list) => { races = list; live.races = races; raceHooks.forEach((f) => { try { f(); } catch (e) { /* noop */ } }); if (!opened) { opened = true; if (handlers.open) handlers.open(); if (handlers.hello) handlers.hello({ now: now(), store, role }); } soon(); };
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
        if (o.tid) {
          let lastKey = '';
          const pushTicket = async (tk) => { if (!tk) return; const b = await ticketBundle(tk); const v = Core.ticketView(tk, b.r, b.p), k = JSON.stringify(v); if (k !== lastKey) { lastKey = k; if (handlers.ticket) handlers.ticket({ ticket: v }); } };
          unsubs.push(() => { delete live.tickets[o.tid]; });
          unsubs.push(doc(COL.tickets, o.tid).onSnapshot((s) => { const tk = data(s); lastTk = tk; if (tk) live.tickets[o.tid] = tk; pushTicket(tk); if (tk && tk.payoutId) watchPayout(tk); }, fail));
          const onRaces = () => { if (lastTk && lastTk.raceId) { const r = races.find((x) => x.id === lastTk.raceId); if (r && r.status === 'done') { pushTicket(lastTk); if (lastTk.payoutId) watchPayout(lastTk); } } };
          raceHooks.push(onRaces);
          let payWatch = null, lastTk = null;
          let payWatchId = null; unsubs.push(() => payWatch && payWatch());
          const watchPayout = (tk) => { if (payWatch && payWatchId === tk.payoutId) return; const r = races.find((x) => x.id === tk.raceId); if (!tk.novote && (!r || r.status !== 'done')) return; if (payWatch) payWatch(); payWatchId = tk.payoutId; const pidW = tk.payoutId; payWatch = doc(COL.payouts, pidW).onSnapshot((ps) => { const pd = data(ps); if (pd) live.payouts[pidW] = pd; pushTicket(live.tickets[tk.tid] || tk); }, () => { payWatch = null; payWatchId = null; }); }; // 返還で payoutId が変わったら見張り直す（コードレビュー）
        }
        if (role === 'staff' && handlers.payout) {
          const since = now(), seenPay = {}; let payLogUn = null, dayT = null; // seenPay: 新しく増えた受け取りだけ知らせる（以前は 1 件増えるたびに全部をもう一度。コードレビュー）
          const watchDay = () => { // 営業日の区切りをまたいだら、新しい営業日で見張り直す（コードレビュー 2026-10-14）
            if (closed) return; const h = (pubCache || Core.DEFAULT_TUNING).dayStartHour, today = Core.bizDate(now(), h);
            if (payLogUn) payLogUn();
            payLogUn = db.collection(COL.logs).where('storeId', '==', store).where('date', '==', today).where('type', '==', 'paid').onSnapshot((q) => { q.docs.map((d) => d.data()).filter((l) => l.at > since && !seenPay[l.pid] && (seenPay[l.pid] = 1)).forEach((l) => handlers.payout({ payout: { pid: l.pid, amount: l.kind === 'refund' ? 0 : l.count, bounty: Core.logBounty(l), bill: l.bill, nick: l.nick, status: 'paid', paidAt: l.at, storeId: l.storeId } })); }, () => {});
            dayT = setTimeout(watchDay, Math.max(1000, Math.min(2 ** 31 - 1, Core.expireAtFor(now(), h) - now() + 1000)));
          };
          watchDay(); unsubs.push(() => { clearTimeout(dayT); if (payLogUn) payLogUn(); });
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
          const stores = await getStores(true), rules = Core.normalizeRules(rulesIn, stores.map((s) => s.id), storeNameOf(stores));
          await doc(COL.config, 'secret').set({ timetable: { rules } }, { merge: true });
          const sched = Core.scheduleAround(now(), rules), keep = new Map(sched.map((e) => [e.id, e]));
          for (const r of await getRaces()) {
            if (r.status !== 'upcoming' || r.id.startsWith('x-')) continue;
            const e = keep.get(r.id);
            if (e) { await doc(COL.secrets, r.id).set({ payoutTarget: e.payout, scope: e.scope }, { merge: true }); continue; }
            if (now() >= (r.openAt || r.closeAt) - 5000) continue; // 受付中のレースは消さない（票を確かめてから消すまでの間に投票が入ると、票だけ残ってレースが消えた。模擬サーバーは 1 本で動くので起きない）
            const t = await db.collection(COL.tickets).where('raceId', '==', r.id).limit(1).get(); if (!t.empty) continue;
            const ta = await db.collection(COL.tickets).where('authRaceId', '==', r.id).limit(1).get(); if (!ta.empty) continue; /* 認証済み（投票前）の券があるレースも消さない */
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
        preview: wrap(async (date, s) => { const sc = await secretConfig(), ds = date || Core.dateStr(now()); return { date: ds, races: Core.expandDate(ds, sc.timetable.rules || []).filter((e) => !s || !e.storeId || e.storeId === s) }; }),
        saveTuning: wrap(async (t) => {
          const sc = await secretConfig(), merged = Core.mergeTuning(sc.tuning, t || {}, now());
          const b = db.batch(); b.set(doc(COL.config, 'secret'), { tuning: merged }, { merge: true }); b.set(doc(COL.config, 'public'), Core.publicTuning(merged)); await b.commit(); pubCache = null; secretCache = null;
          await publishLive(await getRaces(true)).catch(() => {});
          return { ok: true, tuning: merged };
        }),
        races: wrap(async (date) => {
          const sc = await secretConfig(), ds = date || Core.bizDate(now(), sc.tuning.dayStartHour), names = storeNameOf(await getStores());
          const q = await db.collection(COL.races).where('day', '==', ds).get(), list = q.docs.map((d) => d.data()).sort((a, b) => a.at - b.at);
          const out = [];
          for (const r of list) {
            const secret = data(await doc(COL.secrets, r.id).get()) || {}, res = r.result || data(await doc(COL.results, r.id).get());
            const ps = (await db.collection(COL.payouts).where('raceId', '==', r.id).get()).docs.map((d) => d.data());
            out.push(Object.assign(Core.publicRace(r, { role: 'admin', secret, result: res, winners: r.winners || Core.winnersFrom(ps, names) }), { betTotal: (r.participants || {}).medals || 0, paidTotal: (secret.decision || {}).paid || 0, betBounty: (secret.decision || {}).bounty != null ? secret.decision.bounty : (r.participants || {}).medals || 0, refundBounty: r.refundBounty != null ? r.refundBounty : Math.round((r.refundTotal || 0) / Core.MONEY_PER_TICKET), refunded: !!r.refunded, claimedTotal: ps.filter((p) => p.kind !== 'refund' && p.status === 'paid').reduce((a, p) => a + p.amount, 0) }));
          }
          return { races: out };
        }),
        stats: wrap(async (from, to, s) => { /* 当選額・受取額は額、リングバウンティ（受け取った・返却・返還・返した）と投票券の枚数は別（core.js の statBounty。server.js と同じ形） */
          const sc = await secretConfig(); to = to || Core.bizDate(now(), sc.tuning.dayStartHour); from = from || to;
          const q = await db.collection(COL.stats).where('date', '>=', from).where('date', '<=', to).get();
          const claimedQ = await db.collection(COL.payouts).where('day', '>=', from).where('day', '<=', to).get();
          const claimed = {}, back = {}, add = (m, p, v) => { const c = (m[p.day] = m[p.day] || { all: 0 }); c.all += v; c[p.storeId] = (c[p.storeId] || 0) + v; };
          claimedQ.docs.forEach((d) => { const p = d.data(); if (p.status !== 'paid' || p.test) return; if (p.kind === 'refund') { add(back, p, 0); const c = back[p.day], k = p.novote ? 'ret' : 'ref', v = Core.payoutBounty(p); c[k] = (c[k] || 0) + v; c[k + ':' + p.storeId] = (c[k + ':' + p.storeId] || 0) + v; return; } add(claimed, p, p.amount); });
          const K = ['races', 'tickets', 'players', 'bet', 'paid', 'claimed', 'expired', 'unclaimed', 'bountyIn', 'exchanged', 'bountyReturned', 'bountyReturnedPaid', 'bountyRefund', 'bountyRefundPaid'];
          const zero = () => { const o = {}; K.forEach((k) => (o[k] = 0)); return o; };
          const rate = (x) => (x.bet ? Math.round(x.paid / (x.bet * Core.MONEY_PER_TICKET) * 1000) / 1000 : 0);
          const rowOf = (x, players, cl, rp, fp) => { const bb = Core.statBounty(x); const row = { tickets: x.tickets || 0, players, bet: x.bet || 0, paid: x.paid || 0, claimed: cl || 0, expired: x.expired || 0, bountyIn: bb.bountyIn, exchanged: bb.exchanged, bountyReturned: bb.bountyReturned, bountyReturnedPaid: rp || 0, bountyRefund: bb.bountyRefund, bountyRefundPaid: fp || 0 }; row.unclaimed = Math.max(0, row.paid - row.claimed - row.expired); row.rate = rate(row); return row; };
          const tot = Object.assign(zero(), { byStore: {} }), days = [];
          q.docs.map((d) => d.data()).sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((x) => {
            const bills = Object.keys(x.bills || {}), cl = claimed[x.date] || {}, bk = back[x.date] || {}, byStore = {};
            Object.keys(x.byStore || {}).forEach((sid) => { byStore[sid] = rowOf(x.byStore[sid], bills.filter((k) => k.startsWith(sid + ':')).length, cl[sid], bk['ret:' + sid], bk['ref:' + sid]); });
            const src = s ? Object.assign(zero(), byStore[s] || {}, { races: x.races || 0 }) : Object.assign(rowOf(x, bills.length, cl.all, bk.ret, bk.ref), { races: x.races || 0 });
            const row = Object.assign({ date: x.date }, src, { rate: rate(src), byStore }); days.push(row);
            K.forEach((k) => (tot[k] += row[k] || 0));
            Object.keys(byStore).forEach((sid) => { if (s && sid !== s) return; const a = (tot.byStore[sid] = tot.byStore[sid] || (() => { const z = zero(); delete z.races; return z; })()); Object.keys(a).forEach((k) => (a[k] += byStore[sid][k] || 0)); });
          });
          tot.rate = rate(tot); Object.values(tot.byStore).forEach((b) => (b.rate = rate(b)));
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
          const r = await writeRace({ id: 'x-' + t.toString(36) + randId('', 4).toLowerCase() + (sid ? '-' + sid : ''), /* 乱数つき: 同じミリ秒に 2 つ作ると前のレースを上書きしていた（RED TEAM） */ at: t + Math.max(0, Number(o.inSec) || 0) * 1000, payout: Math.max(0, Math.floor(Number(o.payout) || 0)), scope: o.scope === 'store' ? 'store' : 'all', storeId: sid }, sc, Core.manualStages(o, Number(o.inSec) || 0, sc.tuning));
          const secret = data(await doc(COL.secrets, r.id).get());
          return { race: Core.publicRace(r, { role: 'admin', secret }) };
        }),
        close: wrap(async (raceId) => {
          const ref = doc(COL.races, raceId), r = data(await ref.get()); if (!r) throw E(404, 'no_race', 'レースが見つかりません');
          if (r.status !== 'upcoming') throw E(409, 'already_closed', 'もう締め切っています');
          const sc = await secretConfig(), t = now(), at = t + sc.tuning.closeLeadSec * 1000, runAt = at + (r.gateSec || 0) * 1000;
          await db.runTransaction(async (tx) => { const x = data(await tx.get(ref)); if (!x || x.status !== 'upcoming') throw E(409, 'already_closed', 'もう締め切っています'); tx.update(ref, Object.assign({ closeAt: t, at, runAt, openAt: Math.min(r.openAt, t), closeAtTs: Ts(t), runAtTs: Ts(runAt) }, x.exchangeCloseAt != null ? { exchangeCloseAt: Math.min(x.exchangeCloseAt, t) } : {})); }); // 決める係が同時に締め切っていたら時刻を書きかえない
          const d = await decideRace(raceId, 'master'); const secret = data(await doc(COL.secrets, raceId).get());
          return { race: Core.publicRace(d || data(await ref.get()), { role: 'admin', secret, result: d && d.result }) };
        }),
        reveal: wrap(async (raceId) => { const r = await revealRace(raceId, true); if (!r) throw E(409, 'not_decided', 'まだ結果が決まっていません'); return { race: Core.publicRace(r, { role: 'admin', secret: data(await doc(COL.secrets, raceId).get()) }) }; }),
        refund: wrap(async (raceId) => { const x = await refundRace(raceId); const r = data(await doc(COL.races, raceId).get()); return { ok: true, bounty: x.bounty, tickets: x.tickets, race: Core.publicRace(r, { role: 'admin', secret: data(await doc(COL.secrets, raceId).get()) }) }; }),
        reload: wrap(async (sid) => { const stores = await getStores(true); let n = 0; for (const s of stores) { if (sid && s.id !== sid) continue; await doc(COL.stores, s.id).update({ reloadSeq: FieldValue.increment(1) }); n++; } return { ok: true, sent: n }; }),
        expire: wrap(async (o) => { o = o || {}; if (o.pid) { const sc = await secretConfig(); return { ok: true, expired: await expirePayouts({ pid: o.pid, today: Core.bizDate(now() + 2 * 86400000, sc.tuning.dayStartHour) }) }; } return { ok: true, expired: await expirePayouts() }; }),
        setPassword: async () => { throw E(400, 'use_console', '管理パスワードは Firebase のコンソール（Authentication）で変えてください'); },
      };
    }

    return {
      store, role, serverNow: now, syncClock, get offset() { return offset; }, get synced() { return synced; }, backend: 'firestore',
      stores: async () => { await ready(); return (await getStores()).map((s) => ({ id: s.id, name: s.name })); },
      state, race, createTicket, getTicket, cancelTicket, vote,
      staffLogin, staffTicket, auth: authTicket, staffPayout, claim, next, logs, tvGame, testRace, testRaceStatus,
      admin, subscribe,
      // 進行役のテレビ（2026-10-19）: state = { on, code, asking, decider, account }・on(cb) で変わるたびに
      pair: { get state() { return pairState(); }, on: onPair, hello: pairHello, get uid() { return uid(); } },
      // 決める係（テストと確認用）
      decider: { tick: deciderTick, start: startDecider, stop: stopDecider, heartbeat, get paired() { return pair.decider; }, get leader() { return decider.leader; }, get me() { return decider.me; }, get log() { return decider.log; }, decideRace, revealRace, expirePayouts },
      ready,
    };
  }

  return { create, connect, COL, SDK, encodeFS, decodeFS, wrapDb, NESTED_ARRAY_MARK: NA };
});
