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
  /* 2026-10-19: テレビの画質（店舗の設定 settings.tvQuality。'' ＝標準・'auto' ＝なめらか優先・'max' ＝きれい優先・'lite' ＝さらになめらか（最軽量。2026-10-28、管理画面だけ）。管理画面・スタッフのスマホで選ぶ）。
     テレビの中に 'casa.derby.q'（'auto' | 'max' | 'lite'、標準は消す）を覚えて読み直す。js/race3d.js がそれを見て描き方を決める（QMODE・TV_K_FIX・MAXQ・ADAPT）。
     今の値は、いつもの状態（DERBY.state.settings.tvQuality。v2/core.js の settingsFor）で 5 秒ごとに見る＝店舗の設定の変更の通知に乗るので、読み取りは増えない。
     状態に画質が無い（古い core.js のまま等）ときだけ、今までどおりテレビのログイン（client.js の 'derby' のアプリ）で 1 分ごとに読む。
     レース中・長押しの画面を開いている間は待つ。同じ値が 2 回続けて見えてから（10 秒以内）・10 分に 3 回まで（読み直しが続かないように）。
     localhost では ?qwatch=1 のときだけ（テスト用。ふだんの確認で 'casa.derby.q' を手で入れても消さない） */
  const QKEY = 'casa.derby.q', QLOG = 'casa.derby.qLog', Q_EVERY = 5000, Q_READ_MS = 60000, Q_LOOP_N = 3;
  const QWATCH = !LOCAL || /[?&]qwatch=1\b/.test(QS);
  const qState = { want: undefined, via: '', at: 0, wait: false, seen: undefined, err: '', reads: 0 };
  const qNorm = (v) => (v === 'max' || v === 'auto' || v === 'lite' ? v : ''); // 標準（空・'sharp'）＝軽い描き方のまま細かさ 1.2 倍で固定
  function qFromState() { const d = window.DERBY, s = d && d.state, st = s && s.settings; return st && typeof st.tvQuality === 'string' ? qNorm(st.tvQuality) : undefined; }
  async function readQuality() { // テレビはもう casa-derby に（匿名か進行役で）ログインしている。その接続で店舗の設定を読む（店舗の設定はログインした人なら読める）
    const fb = window.firebase; if (!fb || !fb.apps || !fb.apps.some((a) => a.name === 'derby')) return undefined;
    const app = fb.app('derby'); if (!app.auth().currentUser) return undefined;
    const d = await app.firestore().doc('derbyStores/' + STORE).get({ source: 'server' });
    qState.reads++;
    return qNorm((d.exists ? (d.data().settings || {}) : {}).tvQuality);
  }
  function qLooping() { let l = []; try { l = JSON.parse(ss.get(QLOG) || '[]'); } catch (e) { l = []; } const t = Date.now(); return l.filter((x) => t - x < LOOP_MS).length >= Q_LOOP_N; }
  function qMark() { let l = []; try { l = JSON.parse(ss.get(QLOG) || '[]'); } catch (e) { l = []; } l.push(Date.now()); ss.set(QLOG, JSON.stringify(l.slice(-Q_LOOP_N * 2))); }
  let qLastRead = 0;
  async function checkQuality() {
    if (navigator.onLine === false || state.leaving) return;
    try {
      let want = qFromState();
      if (want !== undefined) qState.via = 'state';
      else if (Date.now() - qLastRead >= Q_READ_MS) { qLastRead = Date.now(); want = await readQuality(); qState.via = 'read'; }
      if (want === undefined) return;
      const have = ls.get(QKEY) || '', prev = qState.seen;
      qState.want = want; qState.seen = want; qState.at = Date.now();
      if (want === have) { qState.wait = false; qState.err = ''; return; }
      if (qState.via === 'state' && prev !== want) { qState.wait = true; return; } // 状態で見えた値は、次の見直しでも同じなら（一瞬の古い写しで読み直さない）
      if (busy()) { qState.wait = true; return; } // レース中・長押しの画面 → 終わってから（5 秒ごとに見直す。読み取りなし）
      if (qLooping()) { qState.wait = true; qState.err = 'loop'; return; }
      try { if (want) localStorage.setItem(QKEY, want); else localStorage.removeItem(QKEY); } catch (e) { return; }
      qMark(); location.reload();
    } catch (e) { qState.err = 'read'; /* 読めないときは今のまま */ }
  }
  if (STORE && QWATCH) setTimeout(function loopQ() { checkQuality().finally(() => setTimeout(loopQ, Q_EVERY)); }, 8000);
  /* ---------- 投票の始まりで DERBY に（v4・2026-10-21） ----------
     オーナー決定「レースの時刻にテレビが SLOT なら自動で DERBY にする（投票が始まる時刻）。レースのあとも DERBY のまま。いつでも SLOT に切り替えられる」。
     店のテレビのゲームを DERBY にするのは決める係（模擬クラウドはサーバー・Firestore 版は進行役のテレビ。Core.tvAutoPlan）。ただし決める係が動いていない・
     書けなかったときに、DERBY を映しているテレビが「投票の時間なのに店の設定が SLOT のまま」を理由に SLOT へ出ていかないよう、このテレビ自身も時刻表を見る:
       1) 投票の始まりの LEAD_MS（60 秒）前からは、店の設定が SLOT でも出ていかない（出てもすぐ戻される）。
       2) 店の設定の SLOT が「いちばん新しい投票の始まり」より前からのもの（＝投票が始まったのに SLOT のまま）なら出ていかない。レースのあとも（次に設定が変わるまで）DERBY のまま。
          投票が始まったあとに SLOT に変わった（スタッフの手での切り替え）ときは、今までどおりレースが終わってから SLOT へ（手での切り替えとけんかしない）。
          いつから SLOT かは、このテレビが見た時刻（sessionStorage casa.tvswitchSeen。読み込み直しても続く）。
       3) このテレビが進行役（結果を決めて進める係。Firestore 版の決める係の鍵を持っている・管理画面で選ばれた）のときは、今日このあとレースがある間は
          店の設定が SLOT でも出ていかない（進行役が SLOT に行くと、投票の始まりにテレビを DERBY にする係も、レースの結果を決める係もいなくなる）。
          このテレビだけの設定（casa.tvGameLocal = 'slot'。長押しの画面の「casa SLOT に戻す」）は今までどおり出ていく（その場の操作なので）。
     いつもの状態（window.DERBY.state・DERBY.now）が読めないあいだ（起動直後の 30 秒まで）は待つ。それでも読めなければ今までどおり */
  const LEAD_MS = 60000, SEEN_KEY = 'casa.tvswitchSeen', BOOT = Date.now();
  const sNow = () => { const d = window.DERBY; try { return d && typeof d.now === 'function' ? d.now() : Date.now(); } catch (e) { return Date.now(); } };
  function seenGet() { try { const o = JSON.parse(ss.get(SEEN_KEY) || 'null'); return o && (o.v === 'slot' || o.v === 'derby') && o.store === STORE ? o : null; } catch (e) { return null; } }
  function seenNote(g) { // 店の設定の値を見た（同じ値が続く間は最初に見た時刻のまま）
    if (g !== 'slot' && g !== 'derby') return seenGet();
    const o = seenGet();
    if (o && o.v === g) return o;
    const n = { v: g, since: sNow(), store: STORE, from: o ? o.v : null };
    ss.set(SEEN_KEY, JSON.stringify(n));
    return n;
  }
  const openOf = (r) => (r && Number(r.openAt)) || 0;
  /* 時刻表から: last＝いちばん新しい「もう始まった投票の始まり」、next＝これからの投票の始まり、more＝今日このあとレースがあるか、on＝いま投票中・レース中 */
  function timetable() {
    const d = window.DERBY, s = d && d.state; if (!s || typeof s !== 'object') return null;
    const t = sNow(), cand = [s.open, s.live, s.last, s.next, s.current].concat(Array.isArray(s.upcoming) ? s.upcoming : []).filter(Boolean);
    let last = 0, next = Infinity;
    cand.forEach((r) => { const o = openOf(r); if (!o) return; if (o <= t) last = Math.max(last, o); else next = Math.min(next, o); });
    return { t, last, next, more: next < Infinity || !!s.open || !!s.live, on: !!s.open || !!s.live };
  }
  function isDecider() {
    const d = window.DERBY, c = d && d.cloud; if (!c || c.backend !== 'firestore') return false; // 模擬クラウドはサーバーが決める（テレビは進行役でも決めない）
    try { if (c.decider && c.decider.leader) return true; const p = c.pairState || (d.pair || null); return !!(p && p.decider); } catch (e) { return false; }
  }
  /* SLOT に出ていかない理由（'soon' | 'vote' | 'decider' | 'boot' | ''）。loc: このテレビだけの設定 */
  function holdDerby(loc, seen) {
    if (loc === 'slot') return ''; // このテレビだけの設定（その場の操作）は今までどおり
    const tt = timetable();
    if (!tt) return window.DERBY && Date.now() - BOOT < 30000 ? 'boot' : ''; // テレビの画面（v2/tv.js）が状態をまだ読めていない → 少し待つ。画面が無い（確認用の箱）は今までどおり
    if (isDecider() && tt.more) return 'decider';
    if (tt.next - tt.t < LEAD_MS) return 'soon';
    if (tt.last && seen && seen.v === 'slot' && seen.since < tt.last) return 'vote';
    return '';
  }
  let timer = 0, lastRest = 0;
  const later = (ms) => { clearTimeout(timer); timer = setTimeout(check, ms); };
  async function check() {
    if (!active() || state.leaving) return;
    let g;
    if (live.on && navigator.onLine !== false && Date.now() - lastRest < SAFE_MS) { g = gameOf(live.doc, STORE); state.err = ''; state.via = 'live'; } // 通知で届いた値（読み取りなし）
    else { g = await readGame(); lastRest = Date.now(); state.via = 'rest'; }
    const loc = local(), wait = live.on ? SAFE_MS : POLL_MS, seen = seenNote(g);
    state.at = Date.now(); state.local = loc;
    if (g) state.last = g;
    state.hold = '';
    if ((loc || g) !== 'slot') return later(wait); // DERBY のまま・分からないときは今のゲームのまま（このテレビの設定が先）
    const why = holdDerby(loc, seen);
    if (why) { // 投票の始まりの前後 2 分は 5 秒ごとに見直す（決める係が DERBY にした値を見落とさない＝そのあとの手での SLOT を「新しい SLOT」と分かる。通知が無い模擬クラウドでも）
      state.hold = why; showHold(why);
      const tt = timetable(), near = !!tt && (tt.next - tt.t < 2 * LEAD_MS || (tt.last > 0 && tt.t - tt.last < 120000));
      return later(why === 'boot' ? 3000 : why === 'soon' || near ? 5000 : Math.min(wait, POLL_MS));
    }
    showHold('');
    if (looping()) { state.err = 'loop'; return later(wait); }
    if (busy()) return later(BUSY_MS);
    leave();
  }
  /* 進行役のテレビが店の設定 SLOT のまま DERBY に残っているとき: 左下に小さく（スタッフ向け。お客さんの邪魔にならない大きさ） */
  function showHold(why) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    let b = document.getElementById('tvHold');
    if (why !== 'decider') { if (b) b.remove(); return; }
    if (b || !document.body || !document.createElement) return;
    b = document.createElement('div'); b.id = 'tvHold';
    b.style.cssText = 'position:fixed;left:10px;bottom:8px;z-index:60;padding:6px 12px;border-radius:10px;background:rgba(0,0,0,.6);color:#fff;font:700 14px/1.3 sans-serif;pointer-events:none';
    b.textContent = '進行役のテレビのため casa DERBY のままです（SLOT にするとレースが進みません）';
    document.body.appendChild(b);
  }
  function leave() {
    state.leaving = true; mark();
    ss.set('casa.skipSplash', '1'); // casa SLOT の起動画面を自動で閉じる（自動アップデートのあとと同じ）
    location.replace(home());
  }
  /* 「casa SLOT に戻す」: このテレビを casa SLOT に固定して戻る（すぐ。レース中なら終わってから＝店の設定で戻るときと同じ） */
  function backToSlot() { if (!home() || state.leaving) return; ls.set(LKEY, 'slot'); state.local = 'slot'; clearTimeout(timer); if (busy()) later(BUSY_MS); else leave(); }
  window.DerbyTvSwitch = { check, state, active, docUrl, local, backToSlot, watch, live, readDoc, gameOf, quality: qState, checkQuality, holdDerby, timetable, seen: seenGet, LEAD_MS };
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
        '<div style="font-size:15px;color:#a89f89;margin-top:8px">' + (local() === 'derby' ? 'このテレビは casa DERBY に固定されています。' : '') + 'このテレビだけ casa SLOT に固定して戻ります（下・上で選んで決定）。店の設定どおりに戻すのは casa SLOT の設定画面「このテレビのゲーム」で。' + (isDecider() ? '<br><b style="color:#ffb4a8">このテレビは進行役です。casa SLOT にすると、戻るまでレースが進みません（投票の始まりに自動で DERBY に戻りません）。</b>' : '') + '</div></div>' : '') + '</div>';
    // 2026-10-19: 画質の確認用に 1 行（3D の細かさ・1 秒のコマ数・画面の大きさ・版）。お客さんには見えない（この画面はスタッフ・オーナーだけ）
    const dg = document.createElement('div'); dg.id = 'tvDiag'; dg.style.cssText = 'margin-top:14px;font-size:15px;color:#8f8a7c';
    const r3 = window.R3D && window.R3D.inst, pf = r3 && r3.perf, tvv = ((document.querySelector('script[src*="v2/tv.js?v="]') || {}).src || '').split('v=')[1] || '';
    dg.textContent = '画質: ' + (r3 ? (r3.k || 0) + ' 倍' + (r3.kg && r3.kg !== r3.k ? '（3D ' + r3.kg + ' 倍）' : '') + '・' + Math.round((pf && pf.fps) || 0) + ' コマ/秒' + (r3.tvCap ? '（重いので ' + r3.tvCap + ' 倍まで）' : '') : '3D なし') + '・' + ({ auto: 'なめらか優先', max: 'きれい優先', lite: 'さらになめらか' }[ls.get(QKEY) || ''] || '標準') + '・画面 ' + innerWidth + '×' + innerHeight + '・密度 ' + (window.devicePixelRatio || 1) + '・' + tvv;
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
