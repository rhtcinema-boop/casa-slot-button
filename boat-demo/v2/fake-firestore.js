/* テスト用の「にせ Firestore」（メモリの中だけ。node とブラウザの両方）: window.FakeFirestore
   Firebase JS SDK（compat 版 10.x）のうち、v2/client-firestore.js が使う分だけを同じ形で真似る:
   collection/doc/where/orderBy/limit/get/set(merge)/update（a.b の項目指定）/delete/add/onSnapshot/runTransaction/batch、
   FieldValue.increment/serverTimestamp/delete、Timestamp.fromMillis、auth（匿名・メールとパスワード）。
   rules(ctx) を渡すと、読み書きのたびに呼ぶ（Firestore のルールの代わりに JS で同じことを確かめる。拒否は code='permission-denied'）。
   本物のエミュレーターではないので、ルールの文面（v2/firestore.rules）そのものはここでは確かめられない。
   ルールの中の読み取り（rules が ctx.getDoc で読んだドキュメント）の数も数える（2026-10-19。本物の上限: 1 件の書き込みで 10 件、まとめた書き込み＝batch・取引で 20 件）:
   stats.access = { maxOp（1 件で読んだドキュメントの数の最大）, maxReq（まとめた書き込み 1 回の合計の最大。書き込みごとの数を足す＝キャッシュなしの数え方）, maxReqAt }。
   1 件の中で同じドキュメントを何度読んでも 1 と数える。
   ctx.getAfter(p)（2026-10-24。本物の getAfter/existsAfter）: 書き込みが全部すんだあとの中身（まとめた書き込みなら、ほかの書き込みも反映したあと）。読み取りの数にも入れる（'after:' + p）。
   電波の悪い店のまね（2026-10-29。client(label).net）: net.set('down' | 'hang' | 'up', { latency, offlineMs })。何もしなければ今までと同じ（待ちも遅れも足さない）。
     down ＝ SDK が「オフライン」と気づいた状態: 読み取り・取引は offlineMs（既定 300ms）あとに code 'unavailable'。書き込みはつながるまで待つ（本物と同じく返事が来ない）。
            見張りは止まる。まだ一度も届いていない見張りは、offlineMs あとに空の写し（fromCache: true）を 1 回だけ出す（本物も手元に写しが無いと空を出す）。
     hang ＝ 電波が悪く、SDK もまだ気づいていない状態: 読み書き・取引・見張りが、つながるまで返事なしで待つ（エラーにならない）。
     up   ＝ つながった: 待っていたものを latency（ms）あとに進め、止まっていた見張りに最新の中身を届ける。latency を付けると、ふだんの読み書きもその分遅れる。
     見張りの写しには metadata（fromCache・hasPendingWrites）を付ける。onSnapshot({ includeMetadataChanges: true }, cb) は、つながった・切れたときにも呼ぶ。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FakeFirestore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class Timestamp {
    constructor(ms) { this._ms = ms; this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
    toMillis() { return this._ms; }
    static fromMillis(ms) { return new Timestamp(ms); }
  }
  const SENT = { inc: 'increment', ts: 'serverTimestamp', del: 'delete' };
  const FieldValue = {
    increment: (n) => ({ __fv: SENT.inc, n }),
    serverTimestamp: () => ({ __fv: SENT.ts }),
    delete: () => ({ __fv: SENT.del }),
  };
  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Timestamp) return new Timestamp(v._ms);
    if (Array.isArray(v)) return v.map(clone);
    const o = {}; for (const k of Object.keys(v)) o[k] = clone(v[k]); return o;
  }
  /* 本物と同じ: 配列の中に配列を直接入れることはできない（配列の中の「地図」の中の配列は可）。2026-10-18 本番で発覚。 */
  function checkNoNestedArrays(v, fn, path, inArray) {
    if (v === null || typeof v !== 'object' || v instanceof Timestamp || v.__fv) return;
    if (Array.isArray(v)) {
      if (inArray) { const e = new Error('Function ' + fn + '() called with invalid data. Nested arrays are not supported (found in document ' + path + ')'); e.code = 'invalid-argument'; throw e; }
      v.forEach((x) => checkNoNestedArrays(x, fn, path, true));
      return;
    }
    Object.keys(v).forEach((k) => checkNoNestedArrays(v[k], fn, path, false));
  }
  const permErr = (msg) => { const e = new Error(msg || 'Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; };
  const nf = (p) => { const e = new Error('No document to update: ' + p); e.code = 'not-found'; return e; };
  function getPath(obj, field) { return field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
  const cmpVal = (v) => (v instanceof Timestamp ? v._ms : v);
  function applyField(obj, path, val, nowMs) {
    const ks = path.split('.'); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    const k = ks[ks.length - 1];
    if (val && val.__fv === SENT.del) { delete o[k]; return; }
    o[k] = resolve(val, o[k], nowMs);
  }
  function resolve(val, prev, nowMs) {
    if (val && val.__fv === SENT.inc) return (typeof prev === 'number' ? prev : 0) + val.n;
    if (val && val.__fv === SENT.ts) return new Timestamp(nowMs);
    if (val && typeof val === 'object' && !(val instanceof Timestamp) && !Array.isArray(val)) { const o = {}; for (const k of Object.keys(val)) { const r = resolve(val[k], prev && prev[k], nowMs); if (!(val[k] && val[k].__fv === SENT.del)) o[k] = r; } return o; }
    return clone(val);
  }
  function mergeDeep(base, patch, nowMs) {
    const out = clone(base || {});
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v && v.__fv === SENT.del) { delete out[k]; continue; }
      if (v && typeof v === 'object' && !v.__fv && !(v instanceof Timestamp) && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !(out[k] instanceof Timestamp) && !Array.isArray(out[k])) out[k] = mergeDeep(out[k], v, nowMs);
      else out[k] = resolve(v, out[k], nowMs);
    }
    return out;
  }

  /* ひとつの「データベース」（全員で共有）。client() で、ログインを持った利用者ごとの入口を作る */
  function create(opt) {
    opt = opt || {};
    const store = new Map(); // path -> { data, v }
    const listeners = new Set();
    const users = {}; // email -> { password, uid }
    let uidSeq = 0, idSeq = 0;
    const clock = { now: opt.now || (() => Date.now()) };
    let rules = opt.rules || null;
    const stats = { reads: 0, writes: 0, by: {} }; // 本物の課金と同じ数え方: 1 回読む＝1、問い合わせは返った件数（0 件でも 1）、見張りは変わったドキュメントの数だけ

    function notify() { const ls = Array.from(listeners); setTimeout(() => ls.forEach((l) => { if (listeners.has(l)) l(); }), 0); }
    const access = (stats.access = { maxOp: 0, maxOpAt: '', maxReq: 0, maxReqAt: '', ops: 0 });
    let reqAcc = null; // まとめた書き込みの途中: { n, path }
    function check(ctx) {
      if (!rules) return;
      const seen = new Set(), g = ctx.getDoc, ga = ctx.getAfter || g;
      ctx.getDoc = (p) => { seen.add(p); return g(p); };
      ctx.getAfter = (p) => { seen.add('after:' + p); return ga(p); };
      try { rules(ctx); } finally {
        const n = seen.size; access.ops++;
        if (n > access.maxOp) { access.maxOp = n; access.maxOpAt = ctx.op + ' ' + ctx.path; }
        if (reqAcc) { reqAcc.n += n; if (reqAcc.n > access.maxReq) { access.maxReq = reqAcc.n; access.maxReqAt = reqAcc.what + ' (' + ctx.path + ')'; } }
      }
    }

    function client(label) {
      /* 電波のまね（上の説明）。mode 'up' ＋ latency 0 のときは今までどおり（待ちを足さない） */
      const net = { mode: 'up', latency: 0, offlineMs: 300, waiters: [], paused: new Set(), metas: new Set(), n: { reads: 0, writes: 0, failed: 0 } };
      const plain = () => net.mode === 'up' && !net.latency;
      const offErr = () => { const e = new Error('Failed to get document because the client is offline.'); e.code = 'unavailable'; return e; };
      const whenUp = () => new Promise((res) => { const go = () => setTimeout(res, net.latency || 0); if (net.mode === 'up') go(); else net.waiters.push(go); });
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      async function gate(kind) { // kind: 'read' | 'write' | 'tx'
        if (kind === 'write') { net.n.writes++; return whenUp(); }
        net.n.reads++;
        if (net.mode === 'down') { await delay(net.offlineMs); if (net.mode !== 'up') { net.n.failed++; throw offErr(); } }
        return whenUp();
      }
      const gated = (kind, fn) => (...a) => (plain() ? fn(...a) : gate(kind).then(() => fn(...a)));
      net.set = (mode, o) => {
        o = o || {}; const was = net.mode; net.mode = mode === 'down' || mode === 'hang' ? mode : 'up';
        if (o.latency != null) net.latency = Math.max(0, Number(o.latency) || 0); if (o.offlineMs != null) net.offlineMs = Math.max(0, Number(o.offlineMs) || 0);
        if (net.mode === 'up' && was !== 'up') {
          const w = net.waiters.splice(0); w.forEach((f) => f());
          setTimeout(() => { const ps = Array.from(net.paused); net.paused.clear(); ps.forEach((f) => f()); net.metas.forEach((f) => f()); }, net.latency || 0);
        } else if (net.mode === 'down' && was !== 'down') setTimeout(() => { if (net.mode === 'down') net.metas.forEach((f) => f()); }, net.offlineMs);
        return net.mode;
      };
      const meta = () => ({ fromCache: net.mode === 'down', hasPendingWrites: false });
      const auth = { currentUser: null, _cbs: [] };
      const my = (stats.by[label || 'other'] = stats.by[label || 'other'] || { reads: 0, writes: 0 });
      const addR = (n) => { stats.reads += n; my.reads += n; }, addW = (n) => { stats.writes += n; my.writes += n; };
      const setUser = (u) => { auth.currentUser = u; auth._cbs.forEach((cb) => cb(u)); };
      auth.signInAnonymously = async () => { if (net.mode !== 'up') { if (auth.currentUser && auth.currentUser.isAnonymous) return { user: auth.currentUser }; await whenUp(); } setUser({ uid: 'anon' + (++uidSeq), isAnonymous: true, email: null, getIdToken: async () => 'tok' }); return { user: auth.currentUser }; };
      auth.signInWithEmailAndPassword = async (email, pw) => { const u = users[email]; if (!u || u.password !== pw) { const e = new Error('wrong password'); e.code = 'auth/wrong-password'; throw e; } setUser({ uid: u.uid, isAnonymous: false, email, getIdToken: async () => 'tok' }); return { user: auth.currentUser }; };
      auth.signOut = async () => setUser(null);
      auth.onAuthStateChanged = (cb) => { auth._cbs.push(cb); cb(auth.currentUser); return () => { auth._cbs = auth._cbs.filter((x) => x !== cb); }; };
      const ctxBase = () => ({ auth: auth.currentUser ? { uid: auth.currentUser.uid, token: { email: auth.currentUser.email || null, firebase: { sign_in_provider: auth.currentUser.isAnonymous ? 'anonymous' : 'password' } } } : null, now: clock.now(), getDoc: (p) => { const r = store.get(p); return r ? clone(r.data) : null; } });

      function docSnap(path, rec) { const id = path.split('/').pop(); return { id, exists: !!rec, metadata: meta(), ref: docRef(path), data: () => (rec ? clone(rec.data) : undefined), get: (f) => (rec ? clone(getPath(rec.data, f)) : undefined) }; }
      function readDoc(path, noCount) { const rec = store.get(path); check(Object.assign(ctxBase(), { op: 'get', path, coll: path.split('/')[0], id: path.split('/')[1], before: rec ? clone(rec.data) : null })); if (!noCount) addR(1); return rec; }
      function writeDoc(path, op, after) {
        const rec = store.get(path), before = rec ? clone(rec.data) : null;
        if (op === 'update' && !rec) throw nf(path);
        const base = ctxBase(), g0 = base.getDoc;
        check(Object.assign(base, { op: op === 'delete' ? 'delete' : rec ? 'update' : 'create', path, coll: path.split('/')[0], id: path.split('/')[1], before, after: after ? clone(after) : null, getAfter: (p) => (p === path ? (after ? clone(after) : null) : g0(p)) }));
      }
      function commit(path, after) { addW(1); if (after == null) store.delete(path); else store.set(path, { data: after, v: (store.get(path) ? store.get(path).v : 0) + 1 }); }
      function computeSet(path, data, o) { const rec = store.get(path); return o && o.merge ? mergeDeep(rec ? rec.data : {}, data, clock.now()) : resolve(data, undefined, clock.now()); }
      function computeUpdate(path, patch) { const rec = store.get(path); if (!rec) throw nf(path); const out = clone(rec.data); for (const k of Object.keys(patch)) applyField(out, k, patch[k], clock.now()); return out; }

      function docRef(path) {
        const ref = {
          id: path.split('/').pop(), path,
          collection: (c) => collRef(path + '/' + c),
          get: gated('read', async () => docSnap(path, readDoc(path))),
          set: gated('write', async (data, o) => { checkNoNestedArrays(data, 'DocumentReference.set', path); const after = computeSet(path, data, o); writeDoc(path, 'set', after); commit(path, after); notify(); }),
          update: gated('write', async (patch) => { checkNoNestedArrays(patch, 'DocumentReference.update', path); const after = computeUpdate(path, patch); writeDoc(path, 'update', after); commit(path, after); notify(); }),
          delete: gated('write', async () => { writeDoc(path, 'delete', null); commit(path, null); notify(); }),
          onSnapshot: (a, b, c) => {
            const mo = a && typeof a === 'object' && typeof a !== 'function' ? a : null, cb = mo ? b : a, ecb = mo ? c : b;
            let last = '__none__', dead = false, lastMeta = '', gotOne = false;
            const metaFire = () => { if (dead || !mo || !mo.includeMetadataChanges) return; const m = meta(), k = JSON.stringify(m); if (k === lastMeta) return; lastMeta = k; if (!gotOne && net.mode === 'down') { gotOne = true; cb(Object.assign(docSnap(path, null), { metadata: m })); return; } if (gotOne) { const rec = store.get(path); cb(docSnap(path, rec)); } };
            const fire0 = () => { if (dead) return; try { const rec = readDoc(path, true); const key = rec ? rec.v + ':' + JSON.stringify(rec.data) : 'x'; if (key === last) return; last = key; gotOne = true; lastMeta = JSON.stringify(meta()); addR(1); cb(docSnap(path, rec)); } catch (e) { dead = true; listeners.delete(fire); net.metas.delete(metaFire); if (ecb) ecb(e); } };
            const fire = () => { if (dead) return; if (net.mode !== 'up') { net.paused.add(fire0); return; } fire0(); }; // 電波のまね: つながっていない間は止める（つながったら最新を届ける）
            listeners.add(fire); net.metas.add(metaFire); setTimeout(fire, 0);
            if (net.mode === 'down') setTimeout(() => { if (!dead && !gotOne && net.mode === 'down') { gotOne = true; lastMeta = JSON.stringify(meta()); cb(docSnap(path, null)); } }, net.offlineMs); // 手元に写しが無い: 空の写し（fromCache）
            return () => { dead = true; listeners.delete(fire); net.metas.delete(metaFire); net.paused.delete(fire0); };
          },
        };
        return ref;
      }
      function makeQuery(cpath, filters, orders, lim) {
        const run = (noCount) => {
          check(Object.assign(ctxBase(), { op: 'list', path: cpath, coll: cpath, filters: filters.slice() }));
          let rows = [];
          for (const [p, rec] of store) { if (p.startsWith(cpath + '/') && p.split('/').length === cpath.split('/').length + 1) rows.push([p, rec]); }
          rows = rows.filter(([p, rec]) => filters.every(([f, op, v]) => {
            const x = f === '__name__' ? p.split('/').pop() /* ドキュメントの id（本物の FieldPath.documentId() ＝ '__name__'。2026-11-20） */ : cmpVal(getPath(rec.data, f)), y = Array.isArray(v) ? v.map(cmpVal) : cmpVal(v);
            switch (op) { case '==': return x === y; case '!=': return x !== y && x !== undefined; case '<': return x < y; case '<=': return x <= y; case '>': return x > y; case '>=': return x >= y; case 'in': return y.includes(x); case 'array-contains': return Array.isArray(x) && x.includes(y); }
            return false;
          }));
          // 各ドキュメントも読めるか確かめる（本物のルールは「結果に読めないものが入りうる問い合わせ」を拒否する）
          rows.forEach(([p, rec]) => check(Object.assign(ctxBase(), { op: 'get', path: p, coll: cpath, id: p.split('/').pop(), before: clone(rec.data), viaList: true })));
          orders.forEach(([f, dir]) => rows.sort((a, b) => { const x = cmpVal(getPath(a[1].data, f)), y = cmpVal(getPath(b[1].data, f)); return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); }));
          // orderBy の項目が無いドキュメントは本物では出てこない
          if (orders.length) rows = rows.filter(([, rec]) => orders.every(([f]) => getPath(rec.data, f) !== undefined));
          if (lim) rows = rows.slice(0, lim);
          if (!noCount) addR(Math.max(1, rows.length));
          const docs = rows.map(([p, rec]) => docSnap(p, rec));
          return { docs, size: docs.length, empty: !docs.length, metadata: meta(), forEach: (fn) => docs.forEach(fn) };
        };
        const q = {
          where: (f, op, v) => makeQuery(cpath, filters.concat([[f, op, v]]), orders, lim),
          orderBy: (f, dir) => makeQuery(cpath, filters, orders.concat([[f, dir || 'asc']]), lim),
          limit: (n) => makeQuery(cpath, filters, orders, n),
          get: gated('read', async () => run()),
          onSnapshot: (a, b, c) => {
            const mo = a && typeof a === 'object' && typeof a !== 'function' ? a : null, cb = mo ? b : a, ecb = mo ? c : b;
            let last = '__none__', dead = false, lastMeta = '', gotOne = false, lastSnap = null;
            const emptySnap = () => ({ docs: [], size: 0, empty: true, metadata: meta(), forEach: () => {} });
            const metaFire = () => { if (dead || !mo || !mo.includeMetadataChanges) return; const m = meta(), k = JSON.stringify(m); if (k === lastMeta) return; lastMeta = k; if (!gotOne && net.mode === 'down') { gotOne = true; cb(emptySnap()); return; } if (gotOne && lastSnap) cb(Object.assign({}, lastSnap, { metadata: m })); };
            let seen = null; const fire0 = () => { if (dead) return; try { const s = run(true); const key = s.docs.map((d) => d.id + ':' + store.get(cpath + '/' + d.id).v).join('|'); if (key === last) return; last = key; const now2 = {}; s.docs.forEach((d) => (now2[d.id] = store.get(cpath + '/' + d.id).v)); let n = 0; if (!seen) n = Math.max(1, s.docs.length); else Object.keys(now2).forEach((id) => { if (seen[id] !== now2[id]) n++; }); seen = now2; addR(n); gotOne = true; lastSnap = s; lastMeta = JSON.stringify(meta()); cb(s); } catch (e) { dead = true; listeners.delete(fire); net.metas.delete(metaFire); if (ecb) ecb(e); } };
            const fire = () => { if (dead) return; if (net.mode !== 'up') { net.paused.add(fire0); return; } fire0(); };
            listeners.add(fire); net.metas.add(metaFire); setTimeout(fire, 0);
            if (net.mode === 'down') setTimeout(() => { if (!dead && !gotOne && net.mode === 'down') { gotOne = true; lastMeta = JSON.stringify(meta()); cb(emptySnap()); } }, net.offlineMs);
            return () => { dead = true; listeners.delete(fire); net.metas.delete(metaFire); net.paused.delete(fire0); };
          },
        };
        return q;
      }
      function collRef(cpath) {
        const q = makeQuery(cpath, [], [], 0);
        return Object.assign(q, { id: cpath.split('/').pop(), path: cpath, doc: (id) => docRef(cpath + '/' + (id || ('auto' + (++idSeq).toString(36) + Math.random().toString(36).slice(2, 8)))), add: async (data) => { const r = docRef(cpath + '/' + ('auto' + (++idSeq).toString(36) + Math.random().toString(36).slice(2, 8))); await r.set(data); return r; } });
      }
      async function runTransaction(fn) {
        if (!plain()) await gate('tx'); // 電波のまね: 取引はつながっていないと失敗（down）・返事なし（hang）
        for (let attempt = 0; attempt < 6; attempt++) {
          const reads = new Map(), writes = [];
          const tx = {
            get: async (ref) => { const rec = readDoc(ref.path); reads.set(ref.path, rec ? rec.v : 0); return docSnap(ref.path, rec); },
            set: (ref, data, o) => { writes.push(['set', ref.path, data, o, 'Transaction']); return tx; },
            update: (ref, patch) => { writes.push(['update', ref.path, patch, undefined, 'Transaction']); return tx; },
            delete: (ref) => { writes.push(['delete', ref.path]); return tx; },
          };
          const out = await fn(tx);
          // 読んだあとに誰かが書き換えていたらやり直す（楽観的な同時実行制御。本物と同じ考え方）
          let conflict = false; for (const [p, v] of reads) { const rec = store.get(p); if ((rec ? rec.v : 0) !== v) conflict = true; }
          if (conflict) continue;
          applyWrites(writes);
          return out;
        }
        const e = new Error('transaction failed after retries'); e.code = 'aborted'; throw e;
      }
      function applyWrites(writes) {
        if (writes.length > 500) { const e = new Error('maximum 500 writes allowed per request'); e.code = 'invalid-argument'; throw e; } // 本物の上限（batch・取引とも 500 件）
        // まず全部の権限を確かめてから、まとめて反映（途中で失敗したら何も書かない）
        const staged = new Map(); const get = (p) => (staged.has(p) ? staged.get(p) : (store.get(p) ? store.get(p).data : null));
        const results = [];
        // 1 回目: 書き込みを順に重ねて、それぞれの前と後を出す。2 回目: ルール（getAfter は全部すんだあとの中身）
        const steps = [];
        for (const w of writes) {
          const [op, p] = w; let after;
          if (op !== 'delete') checkNoNestedArrays(w[2], (w[4] || 'WriteBatch') + '.' + op, p);
          if (op === 'set') { const base = get(p); after = w[3] && w[3].merge ? mergeDeep(base || {}, w[2], clock.now()) : resolve(w[2], undefined, clock.now()); }
          else if (op === 'update') { const base = get(p); if (!base) throw nf(p); after = clone(base); for (const k of Object.keys(w[2])) applyField(after, k, w[2][k], clock.now()); }
          else after = null;
          const before = get(p);
          steps.push([op, p, before, after]);
          staged.set(p, after); results.push([p, after]);
        }
        const afterOf = (p) => { const d = staged.has(p) ? staged.get(p) : (store.get(p) ? store.get(p).data : null); return d ? clone(d) : null; };
        reqAcc = { n: 0, what: writes.length + ' writes' };
        try { for (const [op, p, before, after] of steps) {
          check(Object.assign(ctxBase(), { op: op === 'delete' ? 'delete' : before ? 'update' : 'create', path: p, coll: p.split('/')[0], id: p.split('/')[1], before: before ? clone(before) : null, after: after ? clone(after) : null, getAfter: afterOf }));
        } } finally { reqAcc = null; }
        results.forEach(([p, after]) => commit(p, after));
        notify();
      }
      function batch() {
        const writes = [];
        const b = { set: (ref, data, o) => { writes.push(['set', ref.path, data, o]); return b; }, update: (ref, patch) => { writes.push(['update', ref.path, patch]); return b; }, delete: (ref) => { writes.push(['delete', ref.path]); return b; }, commit: gated('write', async () => applyWrites(writes)) };
        return b;
      }
      const db = { collection: (c) => collRef(c), doc: (p) => docRef(p), runTransaction, batch, enablePersistence: async () => {} };
      return { db, auth, FieldValue, Timestamp, net };
    }
    return {
      client, FieldValue, Timestamp, stats, clock,
      addUser(email, password) { users[email] = { password, uid: 'u' + (++uidSeq) + '_' + email.split('@')[0] }; return users[email].uid; },
      setRules(r) { rules = r; },
      dump(prefix) { const o = {}; for (const [p, rec] of store) if (!prefix || p.startsWith(prefix)) o[p] = clone(rec.data); return o; },
      raw: store,
    };
  }
  return { create, Timestamp, FieldValue };
});
