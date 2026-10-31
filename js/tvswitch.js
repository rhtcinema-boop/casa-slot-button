/* テレビのゲームの切り替え（casa SLOT → casa DERBY。2026-10-17）
   casa DERBY の管理画面の店舗の設定「テレビのゲーム」（Firestore casa-derby の derbySwitch/tv = { <DERBY の店舗ID>: 'slot' | 'derby' }、
   ログインなしで読める 1 件）を、開いた 3 秒後と 30 秒ごとに読む（REST で GET するだけ。SDK は使わない）。'derby' なら、待機中に
   同じ場所の derby/index.html?store=<DERBY の店舗ID> へ移る（アプリの中でもブラウザでも同じ相対パス。戻るのは casa DERBY 側の v2/tvswitch.js）。
   - 動くのは Fire TV のアプリ（UA に casaTV）か、その端末で ?tvswitch=1 を 1 回開いたとき（localStorage。?tvswitch=0 で止める）。iPad では動かない
   - 店舗の対応: 店舗名に 渋谷 → shibuya、上野 → ueno、札幌 → sapporo。違う名前の店は ?derbystore=<ID> を 1 回開いて覚えさせる。対応が無い店は移らない
   - 読めない（オフライン・失敗）ときは casa SLOT のまま。回転中・CREDIT が残っている・設定や画面調整の最中は終わってから。
     derby/ のファイルが無い（古い版）ときは移らない。行ったり来たりが続くときは 10 分止める
   - このテレビだけの設定（2026-10-18）: 設定画面「このテレビのゲーム」で localStorage casa.tvGameLocal = 'slot' | 'derby'（無し＝店の設定どおり）。
     店の設定より優先する。'derby' は設定が読めなくても移る（その場の操作なので）。casa DERBY 側（derby/v2/tvswitch.js）も同じキーを見る
   - 数秒で切り替える（2026-10-19）: 同じ 1 件を Firestore の「変更の通知」（SDK の onSnapshot）でも見張り、変わったらすぐ確かめ直す。
     casa SLOT のクラウド（casa-ruretto）とは別の名前のアプリ（casaDerbySwitch）で casa-derby を読む（ログインなし。読むだけ）。
     SDK は casa SLOT のクラウドが読み込むものを待って使う（2 回読まない）。クラウドを使わない端末（1 台運用・模擬）は自分で読み込む。
     通知が届いている間は、念のための読み取り（REST）を 5 分ごとに減らす。通知が使えないときは今までどおり 30 秒ごと。端末の中の古い写し（fromCache）は使わない。
     スタッフのスマホ（js/phoneswitch.js）も SlotTvSwitch.watch で同じ通知を使う。
   - テスト用: localhost のときだけ ?tvgameUrl=<URL> で読む先を差し替えられる（sessionStorage に覚える）。
     ?fbSdk=<にせの SDK の場所> のときだけ通知も使う（localhost では本物の casa-derby にはつながない）
   - v4（2026-10-21、casa DERBY の定時開催）: casa SLOT を映している間も、DERBY の時刻表（derbySchedule/public。ログインなしで読める）と
     derby/v2/next-open.js の DerbyNextOpen.next(schedule, now) で次のレースの投票の始まり（openAt）〜発走（at）を求め、その間に入ったら DERBY へ移る
     （待機中はすぐ、遊んでいる途中は終わってから）。同じレースで 1 回だけ（localStorage casa.tvAutoAt に発走の時刻を覚える。そのあとスタッフが
     SLOT に戻したら、そのレースの間は SLOT のまま）。「このテレビだけ SLOT に固定」のテレビは移らない。テストの店（DERBY の店舗の対応が無い）は対象外。
     次の投票の始まりの時刻に合わせて確かめ直す。時刻表は 5 分ごとに読み直す。localhost では ?schedUrl=<URL> で読む先を差し替えられる
   - 〜まで casa SLOT のままにする（2026-10-31 b176）: マスター画面の店舗の設定 slotHold = { until }（casa SLOT の店舗データ。js/game.js が届くたび setHold で渡す。
     localStorage casa.tvHold にも覚える＝起動直後、店舗データが届く前でも効く）。期限中は、店の設定の 'derby' も時刻表の自動切替も見ずに casa SLOT のまま。
     「このテレビだけ casa DERBY に固定」だけは今までどおり（その場の操作）。期限が切れたあと、期限中から変わっていない店の設定の 'derby' は無視する
     （レースのたびに進行役が 'derby' を書くので、期限が切れた瞬間にレースも無いのに DERBY へ行かないように。設定が変わるか、次の投票の始まりで今までどおり） */
(function () {
  'use strict';
  const DOC = 'https://firestore.googleapis.com/v1/projects/casa-derby/databases/(default)/documents/derbySwitch/tv?key=AIzaSyDuElvskkcKBs4XisXjTe7-mSxjq3KuswA';
  const DERBY_CFG = { apiKey: 'AIzaSyDuElvskkcKBs4XisXjTe7-mSxjq3KuswA', authDomain: 'casa-derby.firebaseapp.com', projectId: 'casa-derby' }, APP = 'casaDerbySwitch';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/'; // js/cloud.js と同じ版
  const MAP = [[/渋谷/, 'shibuya'], [/上野/, 'ueno'], [/札幌/, 'sapporo']];
  const SCHED = 'https://firestore.googleapis.com/v1/projects/casa-derby/databases/(default)/documents/derbySchedule/public?key=AIzaSyDuElvskkcKBs4XisXjTe7-mSxjq3KuswA';
  const SCHED_MS = 5 * 60000, AUTO_KEY = 'casa.tvAutoAt', HOLD_KEY = 'casa.tvHold', HOLD_G_KEY = 'casa.tvHoldG';
  const QS = location.search, UA_TV = /casaTV/.test(navigator.userAgent || '');
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const S = (st) => ({ get(k) { try { return st().getItem(k); } catch (e) { return null; } }, set(k, v) { try { if (v == null) st().removeItem(k); else st().setItem(k, v); } catch (e) { /* noop */ } } });
  const ss = S(() => sessionStorage), ls = S(() => localStorage);
  const POLL_MS = 30000, SAFE_MS = 5 * 60000, FIRST_MS = 3000, BUSY_MS = 3000, LOOP_N = 6, LOOP_MS = 10 * 60000;
  const qp = (k) => { const m = new RegExp('[?&]' + k + '=([^&#]*)').exec(QS); try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } };
  if (qp('tvswitch') === '1') ls.set('casa.tvswitch', '1'); else if (qp('tvswitch') === '0') ls.set('casa.tvswitch', null);
  if (qp('derbystore') != null) ls.set('casa.derbyStore', /^[a-z0-9_-]{1,32}$/.test(qp('derbystore')) ? qp('derbystore') : null);
  let stub = null, sdkStub = null, schedStub = null;
  if (LOCAL) {
    schedStub = qp('schedUrl'); if (schedStub) ss.set('casa.schedUrl', schedStub); else schedStub = ss.get('casa.schedUrl');
    stub = qp('tvgameUrl'); if (stub) ss.set('casa.tvgameUrl', stub); else stub = ss.get('casa.tvgameUrl');
    sdkStub = qp('fbSdk'); if (sdkStub) ss.set('casa.fbSdk', sdkStub); else sdkStub = ss.get('casa.fbSdk');
  }
  const active = () => UA_TV || ls.get('casa.tvswitch') === '1';
  const LKEY = 'casa.tvGameLocal';
  const local = () => { const v = ls.get(LKEY); return v === 'slot' || v === 'derby' ? v : null; };
  const st = () => (typeof Store !== 'undefined' && Store.state) || null;
  function derbyId() {
    const s = st(), me = s && s.store;
    if (!me) return null;
    const o = ls.get('casa.derbyStore');
    if (o) return o;
    const hit = MAP.find(([re]) => re.test(me.name || ''));
    return hit ? hit[1] : null;
  }
  const idle = () => { const s = st(), ui = document.getElementById('ui'); return !!s && !s.play && !(s.credits > 0) && !(s.dud > 0) && !(ui && ui.children.length) && !document.getElementById('calib'); };
  const state = { last: null, at: 0, err: '', target: null, leaving: false, local: null, via: '', hold: null };
  /* 〜まで casa SLOT のまま（b176） */
  const holdNorm = (h) => { const u = h && Number(h.until); return u > 0 ? { until: u, setAt: Number(h.setAt) || 0 } : null; };
  try { state.hold = holdNorm(JSON.parse(ls.get(HOLD_KEY) || 'null')); } catch (e) { state.hold = null; }
  const hold = () => (state.hold && state.hold.until > Date.now() ? state.hold : null);
  function setHold(h) { const n = holdNorm(h); if (JSON.stringify(n) === JSON.stringify(state.hold)) return; state.hold = n; ls.set(HOLD_KEY, n ? JSON.stringify(n) : null); if (active() && !state.leaving) later(300); }
  const gameOf = (doc, id) => (doc && doc[id] === 'derby' ? 'derby' : 'slot');

  /* ---------- 変更の通知（2026-10-19） ---------- */
  const live = { on: false, doc: null, at: 0, err: '', n: 0 };
  const fns = [];
  let watchP = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
  async function sdk(base) { if (!window.firebase) await loadScript(base + 'firebase-app-compat.js'); if (!window.firebase.firestore) await loadScript(base + 'firebase-firestore-compat.js'); }
  async function getDb() {
    if (LOCAL) { if (!sdkStub) return null; await sdk(sdkStub); }
    else {
      const C = typeof Cloud !== 'undefined' ? Cloud : null;
      if (C && C.enabled && !C.isLocal) { for (;;) { try { await C.ready(); break; } catch (e) { await sleep(60000); } } } // casa SLOT のクラウドが SDK を読み終わるのを待つ（つながるまで 1 分ごと）
      if (!window.firebase || !window.firebase.firestore) await sdk(SDK);
    }
    const f = window.firebase, a = f.apps.find((x) => x.name === APP) || f.initializeApp(LOCAL ? { projectId: 'stub', apiKey: 'stub' } : DERBY_CFG, APP);
    return a.firestore();
  }
  function listen(db) {
    try {
      db.collection('derbySwitch').doc('tv').onSnapshot((snap) => {
        if (snap.metadata && snap.metadata.fromCache) return; // 端末の中の写しは使わない（オフラインの間は今のまま）
        live.doc = snap.exists ? (snap.data() || {}) : {}; live.on = true; live.at = Date.now(); live.err = ''; live.n++;
        fns.slice().forEach((fn) => { try { fn(live.doc); } catch (e) { /* noop */ } });
      }, (e) => { live.on = false; live.err = 'listen ' + ((e && e.code) || ''); setTimeout(() => listen(db), 60000); });
    } catch (e) { live.on = false; live.err = 'listen'; }
  }
  function startWatch() { if (!watchP) watchP = getDb().then((db) => { if (db) listen(db); else live.err = live.err || 'no sdk'; }, () => { live.err = 'sdk'; watchP = null; }); return watchP; }
  /* fn(doc): 店の設定が届くたび（最初の 1 回と、変わるたび）。返り値で見張りをやめる */
  function watch(fn) {
    if (typeof fn === 'function') { fns.push(fn); if (live.on) setTimeout(() => fn(live.doc), 0); }
    startWatch();
    return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); };
  }
  /* { <DERBY の店舗ID>: 'slot' | 'derby' } | null（分からない）。REST で 1 回読む */
  async function readDoc() {
    if (navigator.onLine === false) { state.err = 'offline'; return null; }
    const c = typeof AbortController === 'function' ? new AbortController() : null, t = c && setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch(stub || DOC, Object.assign({ cache: 'no-store', credentials: 'omit' }, c ? { signal: c.signal } : {}));
      if (r.status === 404) { state.err = ''; return {}; }
      if (!r.ok) { state.err = 'http ' + r.status; return null; }
      const j = await r.json(), o = {};
      Object.keys((j && j.fields) || {}).forEach((k) => { o[k] = j.fields[k].stringValue === 'derby' ? 'derby' : 'slot'; });
      state.err = '';
      return o;
    } catch (e) { state.err = 'net'; return null; } finally { if (t) clearTimeout(t); }
  }
  /* ---------- v4: 時刻表から次の投票の始まり ---------- */
  const sched = { doc: null, at: 0, err: '', lib: null, libP: null };
  function plain(v) { // Firestore の REST の値 → ふつうの値
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('booleanValue' in v) return !!v.booleanValue;
    if ('timestampValue' in v) return Date.parse(v.timestampValue);
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(plain);
    if ('mapValue' in v) { const o = {}, fs = (v.mapValue && v.mapValue.fields) || {}; Object.keys(fs).forEach((k) => { o[k] = plain(fs[k]); }); return o; }
    return null;
  }
  function nextLib() { // derby/v2/next-open.js（DERBY 側の計算をそのまま使う）。無い（古い版）ときは null
    if (window.DerbyNextOpen) return Promise.resolve(window.DerbyNextOpen);
    if (!sched.libP) sched.libP = loadScript('derby/v2/next-open.js?t=' + Math.floor(Date.now() / 3600000)).then(() => window.DerbyNextOpen || null, () => { sched.libP = null; return null; });
    return sched.libP;
  }
  async function readSched() {
    if (navigator.onLine === false) return sched.doc;
    const c = typeof AbortController === 'function' ? new AbortController() : null, t = c && setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch(schedStub || SCHED, Object.assign({ cache: 'no-store', credentials: 'omit' }, c ? { signal: c.signal } : {}));
      if (r.status === 404) { sched.doc = null; sched.err = ''; }
      else if (!r.ok) sched.err = 'http ' + r.status;
      else { const j = await r.json(); sched.doc = plain({ mapValue: { fields: (j && j.fields) || {} } }); sched.err = ''; }
      sched.at = Date.now();
    } catch (e) { sched.err = 'net'; } finally { if (t) clearTimeout(t); }
    return sched.doc;
  }
  /* 今が投票の始まり〜発走の間なら { at, openAt }。次の始まりまでの時間は state.nextOpenIn（ms）に */
  async function voteWindow(storeId) {
    state.nextOpen = null; state.nextOpenIn = 0;
    const lib = await nextLib();
    if (!lib || typeof lib.next !== 'function') return null;
    if (!sched.doc || Date.now() - sched.at > SCHED_MS) await readSched();
    if (!sched.doc) return null;
    let nx = null; try { nx = lib.next(sched.doc, Date.now(), storeId || undefined); } catch (e) { sched.err = 'next'; return null; }
    if (!nx || !(nx.at > 0) || !(nx.openAt > 0)) return null;
    const now = Date.now();
    state.nextOpen = nx;
    if (now < nx.openAt) { state.nextOpenIn = nx.openAt - now; return null; }
    return now < nx.at ? nx : null;
  }
  async function readGame(id) { const d = await readDoc(); return d ? gameOf(d, id) : null; }
  function looping() { let log = []; try { log = JSON.parse(ss.get('casa.tvswitchLog') || '[]'); } catch (e) { log = []; } const now = Date.now(); return log.filter((x) => now - x < LOOP_MS).length >= LOOP_N; }
  function mark() { let log = []; try { log = JSON.parse(ss.get('casa.tvswitchLog') || '[]'); } catch (e) { log = []; } log.push(Date.now()); ss.set('casa.tvswitchLog', JSON.stringify(log.slice(-LOOP_N * 2))); }
  async function derbyReady() { try { const r = await fetch('derby/index.html?t=' + Date.now(), { cache: 'no-store' }); return r.ok && /v2\/tvswitch\.js/.test(await r.text()); } catch (e) { return false; } }
  let timer = 0, lastRest = 0;
  const later = (ms) => { clearTimeout(timer); timer = setTimeout(check, ms); };
  async function check() {
    if (!active() || state.leaving) return;
    const id = derbyId();
    state.target = id;
    if (!id) return later(POLL_MS);
    let g;
    if (live.on && navigator.onLine !== false && Date.now() - lastRest < SAFE_MS) { g = gameOf(live.doc, id); state.err = ''; state.via = 'live'; } // 通知で届いた値（読み取りなし）
    else { g = await readGame(id); lastRest = Date.now(); state.via = 'rest'; }
    const loc = local();
    let wait = live.on ? SAFE_MS : POLL_MS;
    state.at = Date.now(); state.local = loc;
    if (g) state.last = g;
    const hd = hold(); // b176: 〜まで casa SLOT のまま
    if (hd) { if (g) ls.set(HOLD_G_KEY, g); }
    else { const hg = ls.get(HOLD_G_KEY); if (hg) { if (g && g !== hg) ls.set(HOLD_G_KEY, null); else if (g === 'derby') { g = 'slot'; state.via += '+hold'; } } } // 期限中から変わっていない 'derby' は無視
    if (hd && loc !== 'derby') { state.auto = null; return later(Math.max(1000, Math.min(wait, hd.until - Date.now() + 1500))); }
    let auto = null; // v4: 投票の始まりで DERBY へ（固定のテレビ・このレースでもう動いたときは動かない）
    if ((loc || g) !== 'derby' && loc !== 'slot') {
      const w = await voteWindow(id); // その店だけの時刻表の決まりも入れる
      if (w && ls.get(AUTO_KEY) !== String(w.at)) auto = w;
      if (!w && state.nextOpenIn > 0) wait = Math.min(wait, state.nextOpenIn + 500); // 次の投票の始まりちょうどに確かめ直す
      else if (w) wait = Math.min(wait, BUSY_MS * 10);
    }
    state.auto = auto;
    if ((loc || g) !== 'derby' && !auto) return later(wait);
    if (looping()) { state.err = 'loop'; return later(wait); }
    if (!idle()) return later(BUSY_MS);
    if (!(await derbyReady())) { state.err = 'no derby files'; return later(wait); }
    if (!idle()) return later(BUSY_MS);
    if (auto && (Date.now() >= auto.at)) return later(wait); // 遊んでいる間に発走を過ぎた（次のレースを待つ）
    state.leaving = true; mark();
    if (auto) ls.set(AUTO_KEY, String(auto.at)); // このレースでは 1 回だけ
    try { if (typeof Store !== 'undefined' && Store.log) Store.transact(() => Store.log('TV_GAME', { to: 'derby', store: id, local: !!loc, auto: auto ? auto.at : undefined })); } catch (e) { /* 記録できなくても移る */ }
    location.replace('derby/index.html?store=' + encodeURIComponent(id) + '&via=slot');
  }
  /* 設定画面から: v = 'slot' | 'derby' | null（店の設定どおり）。すぐ確かめ直す（設定画面を閉じて待機中になってから移る） */
  function setLocal(v) { ls.set(LKEY, v === 'slot' || v === 'derby' ? v : null); state.local = local(); if (active() && !state.leaving) later(300); }
  window.SlotTvSwitch = { check, state, active, derbyId, local, setLocal, watch, live, readDoc, gameOf, MAP, sched, voteWindow, readSched, hold, setHold };
  if (active()) { watch(() => { if (active() && !state.leaving) later(200); }); later(FIRST_MS); }
})();
