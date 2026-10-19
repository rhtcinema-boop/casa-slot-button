/* casa DERBY テレビ → casa SLOT へ戻る切り替え（2026-10-17。index.html?store=<店舗> のときだけ読む）
   - 店の「テレビのゲーム」（管理画面の店舗の設定。Firestore の derbySwitch/tv = { <店舗ID>: 'slot' | 'derby' }、誰でも読める）を
     開いた 5 秒後と 30 秒ごとに読み、'derby' でなくなったら casa SLOT のテレビ（window.DERBY_SLOT_HOME）へ移る。
   - 動くのは casa SLOT の下に置いた公開版だけ（tools/build-derby-deploy.js が DERBY_SLOT_HOME を書き足す）。開発・単独の公開では何もしない。
     さらに、Fire TV のアプリ（UA に casaTV）か、casa SLOT から来た（via=slot）か、その端末で切り替えを ON にした（localStorage casa.tvswitch=1）ときだけ。
   - 読めない（オフライン・通信の失敗）ときは今のゲームのまま。レース中（m-live）は終わってから移る。行ったり来たりが続くときは 10 分止める。
   - Fire TV のアプリでは、リモコンのキーは window.TV に届く（アプリの決まり）。ここで最小の TV を用意する:
     決定 → 音を出す（キーを押したのと同じ）／戻るの長押し・メニュー 3 回 → テレビ用のパスワードの入力（結果を決める係になるため。端末に覚える）
     2026-10-19: 進行役（結果を決めて進めるテレビ）は管理画面の「進行役にする」で選べる（パスワード不要）と案内する。パスワードの欄は残す（両方使える）
   - このテレビだけの設定（2026-10-18。casa SLOT の設定画面「このテレビのゲーム」）: localStorage casa.tvGameLocal = 'slot' | 'derby'（無し＝店の設定どおり）。
     店の設定より優先: 'derby' なら店の設定が SLOT でも戻らない、'slot' なら（レースが終わってから）戻る。
     戻るの長押しの画面に「casa SLOT に戻す」（このテレビを casa SLOT に固定して戻る。店の設定どおりに戻すのは casa SLOT の設定画面で）
   - 数秒で切り替える（2026-10-19）: 同じ 1 件を Firestore の「変更の通知」（SDK の onSnapshot）でも見張る。変わったらすぐ確かめ直す。
     SDK は client.js が読み込む 'derby' のアプリをそのまま使う（2 回読まない）。通知が届いている間は、念のための読み取り（REST）を 5 分ごとに減らす。
     通知が使えない（模擬クラウド・SDK を読めない）ときは今までどおり 30 秒ごとの読み取り。端末の中の古い写し（fromCache）は使わない。
     スタッフのスマホ（v2/staffswitch.js）も DerbyTvSwitch.watch で同じ通知を使う。
   - テスト用: localhost のときだけ ?tvgameUrl=<URL> で読む先を差し替えられる（sessionStorage に覚える）。
     ?fbSdk=<にせの SDK の場所> のときだけ通知も使う（localhost では本物の casa-derby の SDK にはつながない） */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.DERBY_FIREBASE && window.DERBY_FIREBASE.demo) return; /* Web デモ（webdemo/）: casa SLOT は無いので何もしない（戻らない・リモコンも足さない） */
  const QS = location.search;
  const STORE = decodeURIComponent((QS.match(/[?&]store=([^&#]+)/) || [])[1] || '');
  const UA_TV = /casaTV/.test(navigator.userAgent || '');
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const S = (st) => ({ get(k) { try { return st().getItem(k); } catch (e) { return null; } }, set(k, v) { try { st().setItem(k, v); } catch (e) { /* noop */ } } });
  const ss = S(() => sessionStorage), ls = S(() => localStorage);
  const POLL_MS = 30000, SAFE_MS = 5 * 60000, FIRST_MS = 5000, BUSY_MS = 3000, LOOP_N = 6, LOOP_MS = 10 * 60000;
  let stub = null, sdkStub = null;
  if (LOCAL) {
    const m = QS.match(/[?&]tvgameUrl=([^&#]+)/); if (m) { try { stub = decodeURIComponent(m[1]); ss.set('casa.tvgameUrl', stub); } catch (e) { stub = null; } } else stub = ss.get('casa.tvgameUrl');
    const m2 = QS.match(/[?&]fbSdk=([^&#]+)/); if (m2) { try { sdkStub = decodeURIComponent(m2[1]); ss.set('casa.fbSdk', sdkStub); } catch (e) { sdkStub = null; } } else sdkStub = ss.get('casa.fbSdk');
  }
  const home = () => window.DERBY_SLOT_HOME || '';
  const active = () => !!home() && !!STORE && (UA_TV || ls.get('casa.tvswitch') === '1' || /[?&]via=slot\b/.test(QS));
  const LKEY = 'casa.tvGameLocal';
  const local = () => { const v = ls.get(LKEY); return v === 'slot' || v === 'derby' ? v : null; };
  const state = { last: null, at: 0, err: '', leaving: false, local: null, via: '' };
  const gameOf = (doc, id) => (doc && doc[id] === 'derby' ? 'derby' : 'slot');

  /* ---------- 変更の通知（2026-10-19） ---------- */
  const live = { on: false, doc: null, at: 0, err: '', n: 0 };
  const fns = [];
  let watchP = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
  async function getDb() {
    if (LOCAL) {
      if (!sdkStub) return null;
      if (!window.firebase) await loadScript(sdkStub + 'firebase-app-compat.js');
      if (!window.firebase.firestore) await loadScript(sdkStub + 'firebase-firestore-compat.js');
      const a = window.firebase.apps.find((x) => x.name === 'derbySwitch') || window.firebase.initializeApp({ projectId: 'stub', apiKey: 'stub' }, 'derbySwitch');
      return a.firestore();
    }
    if (!(window.DERBY_FIREBASE && window.DERBY_FIREBASE.firebase)) return null; // 模擬クラウド
    for (let i = 0; i < 180; i++) { // client.js が SDK を読み込んで 'derby' のアプリを作るのを待つ（最長 3 分）
      const f = window.firebase, a = f && f.apps && f.firestore && f.apps.find((x) => x.name === 'derby');
      if (a) return a.firestore();
      await sleep(1000);
    }
    return null;
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
  function startWatch() { if (!watchP) watchP = getDb().then((db) => { if (db) listen(db); else live.err = live.err || 'no sdk'; }, () => { live.err = 'sdk'; }); return watchP; }
  /* fn(doc): 店の設定が届くたび（最初の 1 回と、変わるたび）。返り値で見張りをやめる */
  function watch(fn) {
    if (typeof fn === 'function') { fns.push(fn); if (live.on) setTimeout(() => fn(live.doc), 0); }
    startWatch();
    return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); };
  }

  function docUrl() {
    if (stub) return stub;
    const c = window.DERBY_FIREBASE && window.DERBY_FIREBASE.firebase;
    if (c && c.projectId && c.apiKey) return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(c.projectId) + '/databases/(default)/documents/derbySwitch/tv?key=' + encodeURIComponent(c.apiKey);
    return '/api/tvgame';
  }
  /* { <店舗ID>: 'slot' | 'derby' } | null（分からない＝今のまま）。REST で 1 回読む */
  async function readDoc() {
    if (navigator.onLine === false) { state.err = 'offline'; return null; }
    const c = typeof AbortController === 'function' ? new AbortController() : null, t = c && setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch(docUrl(), Object.assign({ cache: 'no-store', credentials: 'omit' }, c ? { signal: c.signal } : {}));
      if (r.status === 404) { state.err = ''; return {}; }
      if (!r.ok) { state.err = 'http ' + r.status; return null; }
      const j = await r.json(), o = {};
      Object.keys((j && j.fields) || {}).forEach((k) => { o[k] = j.fields[k].stringValue === 'derby' ? 'derby' : 'slot'; });
      state.err = '';
      return o;
    } catch (e) { state.err = 'net'; return null; } finally { if (t) clearTimeout(t); }
  }
  /* 'slot' | 'derby' | null（分からない＝今のまま） */
  async function readGame() { const d = await readDoc(); return d ? gameOf(d, STORE) : null; }
  function looping() {
    let log = []; try { log = JSON.parse(ss.get('casa.tvswitchLog') || '[]'); } catch (e) { log = []; }
    const now = Date.now(); log = log.filter((x) => now - x < LOOP_MS);
    return log.length >= LOOP_N;
  }
  function mark() { let log = []; try { log = JSON.parse(ss.get('casa.tvswitchLog') || '[]'); } catch (e) { log = []; } log.push(Date.now()); ss.set('casa.tvswitchLog', JSON.stringify(log.slice(-LOOP_N * 2))); }
  const busy = () => { const st = document.getElementById('stage'); return !!(st && st.classList.contains('m-live')) || !!document.getElementById('tvkeyBox'); };
  /* 2026-10-19: 画質の「最高」（管理者が店舗の設定 settings.tvQuality = 'max' にしたときだけ）。テレビの中に 'casa.derby.q' = 'max' を覚えて読み直す。
     js/race3d.js がそれを見て、ふつうの画質（影・ふちのなめらか）で、細かさ 1.2 倍のまま（自動で下げない）描く。設定を消すと元の Fire TV 向けに戻る。
     店舗の設定はテレビのログイン（client.js の 'derby' のアプリ）で 1 分ごとに読む。レース中・この画面を開いている間は読み直さない */
  const QKEY = 'casa.derby.q';
  async function readQuality() { // テレビはもう casa-derby に（匿名か進行役で）ログインしている。その接続で店舗の設定を読む（店舗の設定はログインした人なら読める）
    const fb = window.firebase; if (!fb || !fb.apps || !fb.apps.some((a) => a.name === 'derby')) return undefined;
    const app = fb.app('derby'); if (!app.auth().currentUser) return undefined;
    const d = await app.firestore().doc('derbyStores/' + STORE).get({ source: 'server' });
    const st = d.exists ? (d.data().settings || {}) : {};
    return st.tvQuality === 'max' || st.tvQuality === 'auto' ? st.tvQuality : ''; // 標準（空・'sharp'）＝軽い描き方のまま細かさ 1.2 倍で固定。'auto'＝重いと自動で下げる、'max'＝最高（2026-10-19）
  }
  async function checkQuality() {
    if (navigator.onLine === false) return;
    try {
      const want = await readQuality(); if (want === undefined) return;
      const have = ls.get(QKEY) || '';
      if (want === have) return;
      if (busy()) { setTimeout(checkQuality, BUSY_MS * 5); return; }
      try { if (want) localStorage.setItem(QKEY, want); else localStorage.removeItem(QKEY); } catch (e) { return; }
      location.reload();
    } catch (e) { /* 読めないときは今のまま */ }
  }
  if (STORE && !LOCAL) setTimeout(function loopQ() { checkQuality(); setTimeout(loopQ, 60000); }, 8000);
  let timer = 0, lastRest = 0;
  const later = (ms) => { clearTimeout(timer); timer = setTimeout(check, ms); };
  async function check() {
    if (!active() || state.leaving) return;
    let g;
    if (live.on && navigator.onLine !== false && Date.now() - lastRest < SAFE_MS) { g = gameOf(live.doc, STORE); state.err = ''; state.via = 'live'; } // 通知で届いた値（読み取りなし）
    else { g = await readGame(); lastRest = Date.now(); state.via = 'rest'; }
    const loc = local(), wait = live.on ? SAFE_MS : POLL_MS;
    state.at = Date.now(); state.local = loc;
    if (g) state.last = g;
    if ((loc || g) !== 'slot') return later(wait); // DERBY のまま・分からないときは今のゲームのまま（このテレビの設定が先）
    if (looping()) { state.err = 'loop'; return later(wait); }
    if (busy()) return later(BUSY_MS);
    leave();
  }
  function leave() {
    state.leaving = true; mark();
    ss.set('casa.skipSplash', '1'); // casa SLOT の起動画面を自動で閉じる（自動アップデートのあとと同じ）
    location.replace(home());
  }
  /* 「casa SLOT に戻す」: このテレビを casa SLOT に固定して戻る（すぐ。レース中なら終わってから＝店の設定で戻るときと同じ） */
  function backToSlot() { if (!home() || state.leaving) return; ls.set(LKEY, 'slot'); state.local = 'slot'; clearTimeout(timer); if (busy()) later(BUSY_MS); else leave(); }
  window.DerbyTvSwitch = { check, state, active, docUrl, local, backToSlot, watch, live, readDoc, gameOf };
  if (active()) { watch(() => { if (active() && !state.leaving) later(200); }); later(FIRST_MS); }

  /* ---------- Fire TV のアプリのリモコン（window.TV が無いときだけ） ---------- */
  if (!UA_TV || window.TV) return;
  let menuTaps = [];
  const KEY = 'casa.derby.tvkey';
  function closeKey() { const b = document.getElementById('tvkeyBox'); if (b) b.remove(); }
  function openKey() {
    if (document.getElementById('tvkeyBox')) return;
    const has = !!ls.get(KEY), w = document.createElement('div');
    w.id = 'tvkeyBox';
    w.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.78);font:22px/1.5 sans-serif;color:#f3ead0';
    w.innerHTML = '<div style="background:#16161a;border:1px solid #a57c26;border-radius:16px;padding:24px 28px;width:min(760px,90vw)"><div style="color:#e9c25e;font-weight:700;margin-bottom:8px">進行役（結果を決めて進めるテレビ）</div>' +
      '<div style="font-size:19px;color:#f3ead0;margin-bottom:10px">管理画面の「進行役にする」で選べます。パスワードは要りません。</div>' +
      '<div style="font-size:16px;color:#a89f89;margin-bottom:12px">テレビ用のパスワードで決めるときだけ、下に入れてください。' + (has ? '（このテレビには登録済みです。入れ直すときだけ）' : '') + '空のまま決定で閉じます。</div>' +
      '<input id="tvkeyIn" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:100%;font-size:24px;padding:10px;border-radius:10px;border:1px solid #2a2a31;background:#0b0b0d;color:#fff">' +
      (home() && STORE ? '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #2a2a31"><button id="tvkeySlot" type="button" style="font:700 22px/1 sans-serif;padding:14px 22px;border-radius:12px;border:2px solid #a57c26;background:#232329;color:#f3ead0">casa SLOT に戻す</button>' +
        '<div style="font-size:15px;color:#a89f89;margin-top:8px">' + (local() === 'derby' ? 'このテレビは casa DERBY に固定されています。' : '') + 'このテレビだけ casa SLOT に固定して戻ります（下・上で選んで決定）。店の設定どおりに戻すのは casa SLOT の設定画面「このテレビのゲーム」で。</div></div>' : '') + '</div>';
    // 2026-10-19: 画質の確認用に 1 行（3D の細かさ・1 秒のコマ数・画面の大きさ・版）。お客さんには見えない（この画面はスタッフ・オーナーだけ）
    const dg = document.createElement('div'); dg.id = 'tvDiag'; dg.style.cssText = 'margin-top:14px;font-size:15px;color:#8f8a7c';
    const r3 = window.R3D && window.R3D.inst, pf = r3 && r3.perf, tvv = ((document.querySelector('script[src*="v2/tv.js?v="]') || {}).src || '').split('v=')[1] || '';
    dg.textContent = '画質: ' + (r3 ? (r3.k || 0) + ' 倍・' + Math.round((pf && pf.fps) || 0) + ' コマ/秒' + (r3.tvCap ? '（重いので ' + r3.tvCap + ' 倍まで）' : '') : '3D なし') + '・画面 ' + innerWidth + '×' + innerHeight + '・密度 ' + (window.devicePixelRatio || 1) + '・' + tvv;
    w.firstChild.appendChild(dg);
    fetch('../version.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j && j.v) dg.textContent += '・' + j.v; }).catch(() => {});
    document.body.appendChild(w);
    const inp = w.querySelector('input'), sb = w.querySelector('#tvkeySlot');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); e.stopPropagation(); submit(); } });
    if (sb) { sb.addEventListener('click', () => { closeKey(); backToSlot(); }); sb.addEventListener('focus', () => { sb.style.background = '#e9c25e'; sb.style.color = '#1a1204'; }); sb.addEventListener('blur', () => { sb.style.background = '#232329'; sb.style.color = '#f3ead0'; }); }
    setTimeout(() => inp.focus(), 50);
  }
  function submit() {
    const inp = document.getElementById('tvkeyIn'), v = inp ? inp.value.trim() : '';
    closeKey();
    if (!v) return;
    ls.set(KEY, v);
    location.reload();
  }
  window.TV = {
    isTV: true,
    press(name) {
      if (document.getElementById('tvkeyBox')) {
        const sb = document.getElementById('tvkeySlot'), onSb = sb && document.activeElement === sb;
        if (name === 'Enter') { if (onSb) { closeKey(); backToSlot(); } else submit(); }
        else if (sb && /^Arrow(Up|Down|Left|Right)$/.test(name)) (onSb ? document.getElementById('tvkeyIn') : sb).focus();
        return;
      }
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); } catch (e) { /* noop */ } /* 音を出せるようにする（v2/tv.js はキーで音を有効にする） */
    },
    back() { closeKey(); return true; },
    settings() { openKey(); },
    menu() { const now = Date.now(); menuTaps = menuTaps.filter((x) => now - x < 1500).concat(now); if (menuTaps.length >= 3) { menuTaps = []; openKey(); } },
    resume() { /* noop */ },
  };
})();
