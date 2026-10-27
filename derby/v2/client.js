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

  // v4（2026-10-21）: 投票の場面 'wait'（投票の始まり openAt の前＝待ち画面）| 'vote'（投票できる）| null（締切のあと・レースなし）
  function stage(race, t) {
    if (!race) return null;
    t = t == null ? serverNow() : t;
    if (t >= race.closeAt) return null;
    return t < (race.openAt != null ? race.openAt : race.closeAt) ? 'wait' : 'vote';
  }
  /* スマホがそのレースの票の持ち主であることだけを覚える（2026-10-20「会計番号・ニックネームは覚えさせない。選び直しのため、そのレースの票の持ち主であることだけはスマホの中に持つ」）。
     localStorage 'casa.derby.vote.<レース id>' = { vid, key, at }。会計番号は vid の中に入るが、次のレースの入力には使わない（画面が毎回入れてもらう）。
     2 日より古いものは消す。Firestore 版の key は 'uid'（持ち主は匿名ログインの uid でルールが確かめる）。 */
  const VKEY = 'casa.derby.vote.';
  const myVotes = {
    get(raceId) { try { const v = JSON.parse(localStorage.getItem(VKEY + raceId) || 'null'); return v && v.vid && v.key ? v : null; } catch (e) { return null; } },
    set(raceId, vid, key) { try { localStorage.setItem(VKEY + raceId, JSON.stringify({ vid, key, at: Date.now() })); } catch (e) { /* noop */ } },
    clear(raceId) { try { localStorage.removeItem(VKEY + raceId); } catch (e) { /* noop */ } },
    prune(ms) { try { const lim = Date.now() - (ms || 2 * 86400000); for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.indexOf(VKEY) === 0) { let v = null; try { v = JSON.parse(localStorage.getItem(k)); } catch (e) { v = null; } if (!v || !(v.at > lim)) localStorage.removeItem(k); } } } catch (e) { /* noop */ } },
  };

  /* 端末 ID（2026-10-24 初参加ボーナス）: 本物の端末の番号はブラウザから取れないので、このブラウザに覚えさせた番号を使う（localStorage 'casa.derby.device'）。
     模擬クラウドはこの番号を投票に付けて送る。Firestore 版は匿名ログインの uid が端末 ID（この番号は使わない）。
     履歴を消す・シークレット・別のブラウザ（LINE の中と Safari など）だと別の端末になる。個人の情報は入れない（でたらめな文字だけ） */
  const DKEY = 'casa.derby.device';
  let devMem = null;
  function deviceId() {
    const rnd = () => { let s = ''; const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; for (let i = 0; i < 20; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
    try { let d = localStorage.getItem(DKEY); if (!/^[A-Za-z0-9_-]{12,64}$/.test(d || '')) { d = rnd(); localStorage.setItem(DKEY, d); } return d; } catch (e) { return devMem || (devMem = rnd()); }
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
          const src = 'importScripts(' + JSON.stringify(new URL(DIR + '../js/engine.js', location.href).href) + ');onmessage=function(e){var d=e.data;var o=Engine.calcOdds(d.race,Engine.rng(d.seed),d.sims);postMessage({id:d.id,o:{tansho:o.tansho,winProb:o.winProb,tenkai:o.tenkai,exacta:o.exacta,exactaProb:o.exactaProb}});};';
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
        if (!window.Outcome) await loadScript(DIR + 'outcome.js' + VQ); // 2026-10-20: 当選額の切り上げ（roundPay）が入ったので版の印を付ける（古い控えを使わない）
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
    const ADMIN = ['config', 'saveStores', 'saveTimetable', 'preview', 'saveTuning', 'races', 'stats', 'abuse', 'logs', 'createRace', 'close', 'reveal', 'refund', 'reload', 'expire', 'setPassword', 'createTvAccount', 'tvs', 'tvAsk', 'setDecider'];
    const api = {
      store: opt.store || null, role: opt.role || 'tv', backend: 'firestore',
      serverNow: () => (impl ? impl.serverNow() : Date.now()),
      get offset() { return impl ? impl.offset : 0; }, get synced() { return impl ? impl.synced : false; },
      syncClock: call('syncClock'), stores: call('stores'), state: call('state'), race: call('race'),
      vote: async (o) => { const r = await (await getImpl()).vote(o); if (r && r.vote) myVotes.set(r.vote.raceId, r.vote.vid, r.key); return r; }, myVote: call('myVote'), claimSelf: call('claimSelf'),
      staffLogin: call('staffLogin'), release: call('release'), wins: call('wins'), staffPayout: call('staffPayout'), claim: call('claim'), next: call('next'), logs: call('logs'), tvGame: call('tvGame'), tvQuality: call('tvQuality'),
      testRace: call('testRace'), testRaceStatus: call('testRaceStatus'), // この店だけテストレース（2026-10-19）
      // 進行役のテレビ（2026-10-19）: cb({ on, code, asking, decider, account })。返り値で止める
      onPair(cb) { let un = null, closed = false; getImpl().then((i) => { if (!closed && i.pair) un = i.pair.on(cb); }).catch(() => {}); return () => { closed = true; if (un) un(); }; },
      get pairState() { return impl && impl.pair ? impl.pair.state : null; },
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
    /* 進行役のテレビ（2026-10-19。Firestore 版の derbyTvs と同じ動き）: テレビはこの端末の id（tvid。localStorage に覚える）で名乗る（起動時と 5 分ごと）。
       管理画面の「進行役にする」で選ばれると、合言葉と同じく発表前の結果が届く。「数字を出して」「選ばれた」は見張り（SSE）の 'pair' で届く */
    const pairOn = role === 'tv' && !!store && HAS_DOC && opt.pair !== false;
    const pairSt = { on: pairOn, code: null, asking: false, decider: false, account: false }, pairCbs = [];
    let tvid = null, askT = 0;
    if (pairOn) {
      const rnd = (n) => { let s = ''; const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
      try { tvid = localStorage.getItem('casa.derby.tvid'); if (!/^[A-Za-z0-9_-]{16,40}$/.test(tvid || '')) { tvid = rnd(20); localStorage.setItem('casa.derby.tvid', tvid); } } catch (e) { tvid = tvid || rnd(20); }
      pairSt.code = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); // 起動のたびに作り直す
    }
    const pairEmit = () => pairCbs.slice().forEach((cb) => { try { cb(Object.assign({}, pairSt)); } catch (e) { /* noop */ } });
    function pairSet(p) {
      if (!p || typeof p !== 'object') return;
      const asking = !!p.asking && !p.decider, dec = !!p.decider;
      clearTimeout(askT); if (asking && p.askLeft > 0) askT = setTimeout(() => { pairSt.asking = false; pairEmit(); }, p.askLeft + 200);
      if (asking === pairSt.asking && dec === pairSt.decider) return;
      pairSt.asking = asking; pairSt.decider = dec; pairEmit();
    }

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
      state: (s) => get('/api/state?' + qs({ store: s || store, role, tv, tvid })),
      race: (id) => get('/api/race?' + qs({ id, role, store, tv, tvid })),
      /* スマホ（v4）: 投票（初めて・選び直し）。o = { raceId（画面に出していたレース。省略可＝いまのレース）, bill（2 けた）, nick, first, second, key（選び直しのときだけ。省略すると myVotes から）,
         n（2 ＝ 初参加ボーナスの 2 票目。2026-10-24） }
         → { vote（1 票目）, vote2（2 票目 | null）, bonus（いま 2 票目を入れられる）, key, race }。キーは myVotes に覚える（2 票目も同じキー）。
         409: bill_taken（ほかのスマホがその番号で投票済み）・not_open（投票の前）・closed（締切のあと）・no_bonus（2 票目は使えない） */
      vote: async (o) => {
        o = o || {}; const mine = o.raceId ? myVotes.get(o.raceId) : null, bill = o.bill != null ? String(o.bill).trim().padStart(2, '0') : '';
        const key = o.key || (mine && mine.vid && mine.vid.slice(-2) === bill ? mine.key : undefined);
        const r = await post('/api/vote', { store, raceId: o.raceId, bill: o.bill, nick: o.nick, first: o.first, second: o.second, key, device: o.device || deviceId(), n: Number(o.n) === 2 ? 2 : undefined });
        if (r && r.vote) myVotes.set(r.vote.raceId, r.vote.vid, r.key);
        return r;
      },
      myVote: (vid, key) => get('/api/vote?' + qs({ vid, key })), // → { vote, vote2, bonus, race }（票が消えていたら 404 no_vote）
      claimSelf: (vid, key) => post('/api/vote/claim', { vid, key }), // お客さんのスマホのスライドで「受け取った」→ { payout, vote }（vid は 2 票目の id でもよい。キーは 1 票目と同じ）
      // スタッフ
      staffLogin: (pin) => post('/api/staff/login', { store, pin }),
      release: (pin, bill, raceId) => post('/api/staff/release', { store, pin, bill, raceId }), // 番号を空ける → { ok, released, vid, raceId, bill }
      wins: (pin, o) => post('/api/staff/wins', Object.assign({ store, pin }, o || {})), // 今日の当たり一覧 → { date, wins: [payoutView] }
      staffPayout: (pin, code) => post('/api/staff/payout', { store, pin, code }),
      claim: (pin, code) => post('/api/payout/claim', { store, pin, code }),
      next: (pin) => post('/api/next', { store, pin }),
      tvGame: (pin, game) => post('/api/staff/tvgame', { store, pin, game }), // テレビのゲーム（2026-10-19。その店のスタッフ）
      tvQuality: (pin, quality) => post('/api/staff/tvquality', { store, pin, quality }), // テレビの画質（2026-10-19。その店のスタッフ。'' ＝標準・'auto' ＝なめらか優先・'max' ＝きれい優先）
      testRace: (pin, startIn, o) => post('/api/staff/testrace', { store, pin, startIn, switchTv: !!(o && o.switchTv) }), // この店だけテストレース（2026-10-19。switchTv: その 3＝SLOT なら DERBY にして、終わったら戻す）
      testRaceStatus: (pin) => post('/api/staff/testrace/status', { store, pin }),
      onPair(cb) { if (typeof cb !== 'function') return () => {}; pairCbs.push(cb); try { cb(Object.assign({}, pairSt)); } catch (e) { /* noop */ } return () => { const i = pairCbs.indexOf(cb); if (i >= 0) pairCbs.splice(i, 1); }; },
      get pairState() { return Object.assign({}, pairSt); },
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
          abuse: (from, to, s) => request('GET', '/api/admin/abuse?' + qs({ from, to, store: s }), undefined, h), // 見える化（集計タブの「注意」。2026-10-27）
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
          tvs: () => request('GET', '/api/admin/tvs', undefined, h), // 進行役のテレビ（2026-10-19）
          tvAsk: (id, on) => post('/api/admin/tvask', { id, on: !!on }, h),
          setDecider: (id) => post('/api/admin/decider', { id: id || null }, h),
        };
      },
      /* リアルタイム: handlers = { state, race, vote, payout, next, reload, hello, open, error }。o = { vid, key }（スマホの自分の票。vote は { vote } か消えたとき { vote: null, released: true }）
         返り値の関数を呼ぶと止まる。切れたら自動で再接続し、つながるたびに時刻を合わせ直す。 */
      subscribe(handlers, o) {
        handlers = handlers || {}; o = o || {};
        if (typeof EventSource === 'undefined') throw new Error('EventSource がありません');
        const url = base + '/api/stream?' + qs({ store, role, tv, tvid, vid: o.vid, key: o.key });
        let es = null, closed = false, retry = null;
        const on = (name) => (ev) => { let d = null; try { d = JSON.parse(ev.data); } catch (e) { return; } if (handlers[name]) handlers[name](d); };
        function connect() {
          if (closed) return;
          es = new EventSource(url);
          ['hello', 'state', 'race', 'vote', 'payout', 'next', 'reload'].forEach((n) => es.addEventListener(n, on(n)));
          es.addEventListener('pair', (ev) => { let d = null; try { d = JSON.parse(ev.data); } catch (e) { return; } pairSet(d); if (handlers.pair) handlers.pair(d); }); // 進行役のテレビ（2026-10-19）
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
    if (pairOn) { // 名乗る（起動時と 5 分ごと）
      const hello = () => post('/api/tv/hello', { tvid, store, code: pairSt.code, kind: /casaTV/.test((typeof navigator !== 'undefined' && navigator.userAgent) || '') ? 'casatv' : 'browser' }).then(pairSet, () => {});
      hello(); setInterval(hello, 5 * 60000);
    }
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

  return { create, serverNow, parseCode, phase, stage, myVotes, deviceId, get offset() { return offset; } };
});
