/* casa DERBY v2 クライアント（テレビ・スマホ・スタッフ・管理の共通）: window.DerbyCloud
   つなぎ先は v2/config.js で決まる: window.DERBY_FIREBASE が null なら模擬クラウド（node v2/server.js）、Firebase の設定なら Firestore（v2/client-firestore.js）。
   どちらでも関数の名前と返り値は同じ（フロントはこの API だけを使う）。使い方は v2/API.md の 7 章、Firestore は v2/FIRESTORE_PLAN.md。
   ?cloud=mock を付けると config.js があっても模擬クラウドにつなぐ（試験用）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DerbyCloud = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let offset = 0, synced = false; // サーバー時刻 − 手元の時刻（ms）
  let activeImpl = null; // Firestore 版を使っているとき
  function serverNow() { return activeImpl ? activeImpl.serverNow() : Date.now() + offset; }
  // v2/config.js（つなぎ先）を先に読む。document.write なので、このあとにあるページのスクリプトより先に入る
  const HAS_DOC = typeof document !== 'undefined';
  const ME = (HAS_DOC && document.currentScript && document.currentScript.src) || '';
  const DIR = ME ? ME.replace(/[?#].*$/, '').replace(/[^/]*$/, '') : '';
  const VQ = (/[?]v=[^#&]+/.exec(ME) || [''])[0]; // 自分（client.js?v=…）の版を、あとから読む core.js などにも付ける（古いファイルがキャッシュに残らないように。2026-10-14）
  try { if (HAS_DOC && DIR && document.readyState === 'loading' && typeof window.DERBY_FIREBASE === 'undefined') document.write('<script src="' + DIR + 'config.js"><\/script>'); } catch (e) { /* なし */ }

  function parseCode(s) {
    const m = /^derby:(auth|pay):(.+)$/.exec(String(s || '').trim());
    return m ? { kind: m[1], id: m[2] } : null;
  }
  // 時刻から場面の目安（テレビ用）
  function phase(race, t) {
    if (!race) return null;
    t = t == null ? serverNow() : t;
    if (t < race.openAt) return 'upcoming';
    if (t < race.closeAt) return 'open';
    if (t < race.at) return 'closed';
    if (t < race.runAt) return 'gate';
    const win = race.result ? race.result.winTime * 1000 : 58000;
    if (t < race.runAt + win) return 'run';
    if (t < race.revealAt) return 'post';
    if (t < race.endAt) return 'result';
    return 'over';
  }

  // 受付の 2 段（2026-10-16）: 'exchange'（参加受付＝券・認証もできる）| 'vote'（参加受付は締切・認証済みの人だけ投票）| null（受付中でない）
  function stage(race, t) {
    if (!race) return null;
    t = t == null ? serverNow() : t;
    if (t >= race.closeAt) return null;
    return t < (race.exchangeCloseAt != null ? race.exchangeCloseAt : race.closeAt) ? 'exchange' : 'vote';
  }

  /* ---------- Firestore 版（v2/config.js に Firebase の設定があるとき） ---------- */
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); }); }
  // オッズの計算（重い）は Worker で（Fire TV の絵が止まらないように）。使えなければ null（その場で計算）
  function oddsWorker() {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !DIR) return null;
    let w = null, seq = 0; const pend = {};
    return (race, seed, sims) => new Promise((res, rej) => {
      try {
        if (!w) {
          const src = 'importScripts(' + JSON.stringify(new URL(DIR + '../js/engine.js', location.href).href) + ');onmessage=function(e){var d=e.data;var o=Engine.calcOdds(d.race,Engine.rng(d.seed),d.sims);postMessage({id:d.id,o:{tansho:o.tansho,winProb:o.winProb,tenkai:o.tenkai}});};';
          w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
          w.onmessage = (e) => { const f = pend[e.data.id]; if (f) { delete pend[e.data.id]; f(e.data.o); } };
        }
        const id = ++seq; pend[id] = res; w.postMessage({ id, race, seed, sims });
        setTimeout(() => { if (pend[id]) { delete pend[id]; rej(new Error('odds timeout')); } }, 60000);
      } catch (e) { rej(e); }
    });
  }
  function createFirestore(opt, cfg) {
    let implP = null, impl = null; const adm = {};
    function getImpl() {
      if (!implP) implP = (async () => {
        if (!window.Engine) await loadScript(DIR + '../js/engine.js');
        if (!window.Outcome) await loadScript(DIR + 'outcome.js');
        if (!window.DerbyCore) await loadScript(DIR + 'core.js' + VQ);
        if (!window.DerbyFirestore) await loadScript(DIR + 'client-firestore.js' + VQ);
        const env = await window.DerbyFirestore.connect(cfg);
        impl = window.DerbyFirestore.create(opt, Object.assign({}, env, { Engine: window.Engine, Outcome: window.Outcome, Core: window.DerbyCore, oddsAsync: opt.role === 'tv' ? oddsWorker() : null }));
        if (!activeImpl) activeImpl = impl;
        await impl.ready();
        return impl;
      })().catch((e) => { implP = null; const er = new Error('通信できません。電波を確認してください'); er.code = 'network'; er.status = 0; er.cause = e; throw er; });
      return implP;
    }
    const call = (name) => async (...a) => (await getImpl())[name](...a);
    const ADMIN = ['config', 'saveStores', 'saveTimetable', 'preview', 'saveTuning', 'races', 'stats', 'logs', 'createRace', 'close', 'reveal', 'refund', 'reload', 'expire', 'setPassword', 'createTvAccount'];
    const api = {
      store: opt.store || null, role: opt.role || 'tv', backend: 'firestore',
      serverNow: () => (impl ? impl.serverNow() : Date.now()),
      get offset() { return impl ? impl.offset : 0; }, get synced() { return impl ? impl.synced : false; },
      syncClock: call('syncClock'), stores: call('stores'), state: call('state'), race: call('race'),
      createTicket: call('createTicket'), getTicket: call('getTicket'), cancelTicket: call('cancelTicket'), vote: call('vote'),
      staffLogin: call('staffLogin'), staffTicket: call('staffTicket'), auth: call('auth'), staffPayout: call('staffPayout'), claim: call('claim'), next: call('next'), logs: call('logs'),
      admin(password) { const m = {}; ADMIN.forEach((k) => { m[k] = async (...a) => { const i = await getImpl(); const ad = adm[password] || (adm[password] = i.admin(password)); return ad[k](...a); }; }); return m; },
      subscribe(handlers, o) { let un = null, closed = false; getImpl().then((i) => { if (!closed) un = i.subscribe(handlers, o); }).catch((e) => { if (handlers && handlers.error) handlers.error(e); }); return () => { closed = true; if (un) un(); }; },
      get decider() { return impl ? impl.decider : null; },
    };
    getImpl().catch(() => {}); // 早めにつなぐ（テレビは決める係の取り合いを始める）
    return api;
  }

  function create(opt) {
    opt = opt || {};
    const fbCfg = typeof window !== 'undefined' ? window.DERBY_FIREBASE : null;
    const forceMock = typeof location !== 'undefined' && /[?&]cloud=mock\b/.test(location.search);
    if (fbCfg && fbCfg.firebase && !opt.base && !forceMock) return createFirestore(opt, fbCfg);
    const base = (opt.base || '').replace(/\/$/, '');
    const store = opt.store || null, role = opt.role || 'tv';
    const tv = role === 'tv' && opt.tvKey ? String(opt.tvKey) : null; // テレビの合言葉（発表前の結果・seed を受け取るため。無いとスマホと同じ中身）

    async function request(method, p, body, headers) {
      const init = { method, headers: Object.assign({}, headers || {}), cache: 'no-store' };
      if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      let res;
      try { res = await fetch(base + p, init); }
      catch (e) { const err = new Error('通信できません。電波を確認してください'); err.code = 'network'; err.status = 0; throw err; }
      let data = null; try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) { const err = new Error((data && data.message) || ('HTTP ' + res.status)); err.code = (data && data.error) || 'http_' + res.status; err.status = res.status; err.body = data; throw err; }
      return data;
    }
    const get = (p) => request('GET', p);
    const post = (p, b, h) => request('POST', p, b || {}, h);
    const qs = (o) => Object.keys(o).filter((k) => o[k] != null && o[k] !== '').map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');

    // 時刻合わせ: 5 回はかって往復がいちばん短いものを使う
    async function syncClock(n) {
      n = n || 5; let best = null;
      for (let i = 0; i < n; i++) {
        const t0 = Date.now();
        try { const r = await get('/api/time'); const t1 = Date.now(), rtt = t1 - t0; if (!best || rtt < best.rtt) best = { rtt, off: r.now + rtt / 2 - t1 }; } catch (e) { if (i === n - 1 && !best) throw e; }
      }
      if (best) { offset = best.off; synced = true; }
      return { offset, rtt: best ? best.rtt : null };
    }

    const api = {
      store, role, serverNow, syncClock,
      get offset() { return offset; }, get synced() { return synced; },
      stores: () => get('/api/stores'),
      state: (s) => get('/api/state?' + qs({ store: s || store, role, tv })),
      race: (id) => get('/api/race?' + qs({ id, role, store, tv })),
      // スマホ
      createTicket: (o) => post('/api/ticket', Object.assign({ store }, o)),
      getTicket: (tid, key) => get('/api/ticket?' + qs({ tid, key })),
      cancelTicket: (tid, key) => post('/api/ticket/cancel', { tid, key }),
      // raceId（省略可）: 画面に出していたレース。締切で次のレースに切り替わっていたら 409 closed（別のレースの同じ番号の馬に入らないように）
      vote: (tid, key, picks, raceId) => post('/api/vote', Object.assign(Array.isArray(picks) ? { tid, key, picks } : { tid, key, horse: picks }, raceId ? { raceId } : {})),
      // スタッフ
      staffLogin: (pin) => post('/api/staff/login', { store, pin }),
      staffTicket: (pin, code) => post('/api/staff/ticket', { store, pin, code }),
      // rate（省略可）: スタッフの画面に出していた交換の割合。サーバーの割合と違えば 409 rate_changed（受け取る枚数をまちがえないように）
      auth: (pin, code, count, rate) => post('/api/auth', { store, pin, code, count, rate }),
      staffPayout: (pin, code) => post('/api/staff/payout', { store, pin, code }),
      claim: (pin, code) => post('/api/payout/claim', { store, pin, code }),
      next: (pin) => post('/api/next', { store, pin }),
      logs: (pin, o) => post('/api/staff/logs', Object.assign({ store, pin }, o || {})),
      // 管理
      admin(password) {
        const h = { 'X-Admin-Password': password };
        return {
          config: () => request('GET', '/api/admin/config', undefined, h),
          saveStores: (stores) => post('/api/admin/stores', { stores }, h),
          saveTimetable: (rules) => post('/api/admin/timetable', { rules }, h),
          preview: (date, s) => request('GET', '/api/admin/timetable/preview?' + qs({ date, store: s }), undefined, h),
          saveTuning: (t) => post('/api/admin/tuning', t, h),
          races: (date) => request('GET', '/api/admin/races?' + qs({ date }), undefined, h),
          stats: (from, to, s) => request('GET', '/api/admin/stats?' + qs({ from, to, store: s }), undefined, h),
          logs: (o) => request('GET', '/api/admin/logs?' + qs(o || {}), undefined, h),
          refund: (raceId) => post('/api/admin/refund', { raceId }, h),
          reload: (storeId) => post('/api/admin/reload', { storeId: storeId || null }, h),
          reveal: (raceId) => post('/api/admin/reveal', { raceId }, h),
          createRace: (o) => post('/api/admin/race', o, h),
          close: (raceId) => post('/api/admin/close', { raceId }, h),
          expire: (o) => post('/api/admin/expire', o || {}, h), // Firestore 版と同じ関数をそろえる（模擬クラウドだけ無かった）
          setPassword: (pw) => post('/api/admin/password', { password: pw }, h),
          tvKey: (o) => post('/api/admin/tvkey', o || {}, h), // テレビの合言葉を作り直す（{ storeId?, key?, clear? }）
          createTvAccount: async () => { const e = new Error('模擬クラウドではテレビ用アカウントは使いません'); e.status = 400; e.code = 'mock'; throw e; }, /* Firestore 版だけ（管理画面もボタンを出さない） */
        };
      },
      /* リアルタイム: handlers = { state, race, ticket, payout, next, reload, hello, open, error }。o = { tid, key }（スマホの自分の券）
         返り値の関数を呼ぶと止まる。切れたら自動で再接続し、つながるたびに時刻を合わせ直す。 */
      subscribe(handlers, o) {
        handlers = handlers || {}; o = o || {};
        if (typeof EventSource === 'undefined') throw new Error('EventSource がありません');
        const url = base + '/api/stream?' + qs({ store, role, tv, tid: o.tid, key: o.key });
        let es = null, closed = false, retry = null;
        const on = (name) => (ev) => { let d = null; try { d = JSON.parse(ev.data); } catch (e) { return; } if (handlers[name]) handlers[name](d); };
        function connect() {
          if (closed) return;
          es = new EventSource(url);
          ['hello', 'state', 'race', 'ticket', 'payout', 'next', 'reload'].forEach((n) => es.addEventListener(n, on(n)));
          es.onopen = () => { syncClock(3).catch(() => {}); if (handlers.open) handlers.open(); };
          es.onerror = (e) => {
            if (handlers.error) handlers.error(e);
            if (es.readyState === 2) { es.close(); clearTimeout(retry); retry = setTimeout(connect, 3000); } // 完全に閉じたら自分でつなぎ直す
          };
        }
        connect();
        return function () { closed = true; clearTimeout(retry); if (es) es.close(); };
      },
    };
    return api;
  }

  /* 通しテスト（tests/v2-e2e.plan.js）用の橋: ?e2e=1 で、iframe の中、ホスト名が *.localhost のときだけ有効（本番のホストでは絶対に動かない）。
     親ページ（localhost）から postMessage で届いたコードを実行して結果を返す。確認ダイアログは自動で OK。 */
  (function e2eBridge() {
    try {
      if (typeof window === 'undefined' || window.top === window || !/[?&]e2e=1\b/.test(location.search) || !/\.localhost$/.test(location.hostname)) return;
      window.__u = async (f, ms, every) => { const t0 = Date.now(); for (;;) { let v = false; try { v = f(); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > (ms || 10000)) return false; await new Promise((r) => setTimeout(r, every || 100)); } };
      window.confirm = () => true; window.alert = () => {};
      window.addEventListener('message', async (e) => {
        const m = e.data; if (!m || !m.__e2e) return;
        let host = ''; try { host = new URL(e.origin).hostname; } catch (x) { return; }
        if (host !== 'localhost' && !/\.localhost$/.test(host)) return;
        let r; try { r = { ok: true, v: await (0, eval)(m.code) }; } catch (err) { r = { ok: false, v: String((err && err.message) || err) }; }
        try { r.v = r.v === undefined ? null : JSON.parse(JSON.stringify(r.v)); } catch (x) { r.v = String(r.v); }
        e.source.postMessage({ __e2eR: m.id, r }, e.origin);
      });
    } catch (e) { /* なし */ }
  })();

  return { create, serverNow, parseCode, phase, stage, get offset() { return offset; } };
});
