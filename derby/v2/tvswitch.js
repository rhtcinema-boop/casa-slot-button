/* casa DERBY テレビ → casa SLOT へ戻る切り替え（2026-10-17。index.html?store=<店舗> のときだけ読む）
   - 店の「テレビのゲーム」（管理画面の店舗の設定。Firestore の derbySwitch/tv = { <店舗ID>: 'slot' | 'derby' }、誰でも読める）を
     開いた 5 秒後と 30 秒ごとに読み、'derby' でなくなったら casa SLOT のテレビ（window.DERBY_SLOT_HOME）へ移る。
   - 動くのは casa SLOT の下に置いた公開版だけ（tools/build-derby-deploy.js が DERBY_SLOT_HOME を書き足す）。開発・単独の公開では何もしない。
     さらに、Fire TV のアプリ（UA に casaTV）か、casa SLOT から来た（via=slot）か、その端末で切り替えを ON にした（localStorage casa.tvswitch=1）ときだけ。
   - 読めない（オフライン・通信の失敗）ときは今のゲームのまま。レース中（m-live）は終わってから移る。行ったり来たりが続くときは 10 分止める。
   - Fire TV のアプリでは、リモコンのキーは window.TV に届く（アプリの決まり）。ここで最小の TV を用意する:
     決定 → 音を出す（キーを押したのと同じ）／戻るの長押し・メニュー 3 回 → テレビ用のパスワードの入力（結果を決める係になるため。端末に覚える）
   - テスト用: localhost のときだけ ?tvgameUrl=<URL> で読む先を差し替えられる（sessionStorage に覚える） */
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
  const POLL_MS = 30000, FIRST_MS = 5000, BUSY_MS = 3000, LOOP_N = 6, LOOP_MS = 10 * 60000;
  let stub = null;
  if (LOCAL) { const m = QS.match(/[?&]tvgameUrl=([^&#]+)/); if (m) { try { stub = decodeURIComponent(m[1]); ss.set('casa.tvgameUrl', stub); } catch (e) { stub = null; } } else stub = ss.get('casa.tvgameUrl'); }
  const home = () => window.DERBY_SLOT_HOME || '';
  const active = () => !!home() && !!STORE && (UA_TV || ls.get('casa.tvswitch') === '1' || /[?&]via=slot\b/.test(QS));
  const state = { last: null, at: 0, err: '', leaving: false };

  function docUrl() {
    if (stub) return stub;
    const c = window.DERBY_FIREBASE && window.DERBY_FIREBASE.firebase;
    if (c && c.projectId && c.apiKey) return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(c.projectId) + '/databases/(default)/documents/derbySwitch/tv?key=' + encodeURIComponent(c.apiKey);
    return '/api/tvgame';
  }
  /* 'slot' | 'derby' | null（分からない＝今のまま） */
  async function readGame() {
    if (navigator.onLine === false) { state.err = 'offline'; return null; }
    const c = typeof AbortController === 'function' ? new AbortController() : null, t = c && setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch(docUrl(), Object.assign({ cache: 'no-store', credentials: 'omit' }, c ? { signal: c.signal } : {}));
      if (r.status === 404) { state.err = ''; return 'slot'; }
      if (!r.ok) { state.err = 'http ' + r.status; return null; }
      const j = await r.json(), f = j && j.fields && j.fields[STORE];
      state.err = '';
      return f && f.stringValue === 'derby' ? 'derby' : 'slot';
    } catch (e) { state.err = 'net'; return null; } finally { if (t) clearTimeout(t); }
  }
  function looping() {
    let log = []; try { log = JSON.parse(ss.get('casa.tvswitchLog') || '[]'); } catch (e) { log = []; }
    const now = Date.now(); log = log.filter((x) => now - x < LOOP_MS);
    return log.length >= LOOP_N;
  }
  function mark() { let log = []; try { log = JSON.parse(ss.get('casa.tvswitchLog') || '[]'); } catch (e) { log = []; } log.push(Date.now()); ss.set('casa.tvswitchLog', JSON.stringify(log.slice(-LOOP_N * 2))); }
  const busy = () => { const st = document.getElementById('stage'); return !!(st && st.classList.contains('m-live')) || !!document.getElementById('tvkeyBox'); };
  let timer = 0;
  const later = (ms) => { clearTimeout(timer); timer = setTimeout(check, ms); };
  async function check() {
    if (!active() || state.leaving) return;
    const g = await readGame();
    state.at = Date.now();
    if (g) state.last = g;
    if (g !== 'slot') return later(POLL_MS); // DERBY のまま・分からないときは今のゲームのまま
    if (looping()) { state.err = 'loop'; return later(POLL_MS); }
    if (busy()) return later(BUSY_MS);
    state.leaving = true; mark();
    ss.set('casa.skipSplash', '1'); // casa SLOT の起動画面を自動で閉じる（自動アップデートのあとと同じ）
    location.replace(home());
  }
  window.DerbyTvSwitch = { check, state, active, docUrl };
  if (active()) later(FIRST_MS);

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
    w.innerHTML = '<div style="background:#16161a;border:1px solid #a57c26;border-radius:16px;padding:24px 28px;width:min(760px,90vw)"><div style="color:#e9c25e;font-weight:700;margin-bottom:8px">テレビ用のパスワード</div>' +
      '<div style="font-size:16px;color:#a89f89;margin-bottom:12px">' + (has ? 'このテレビには登録済みです。入れ直すときだけ入力してください。' : '結果を決める係になるテレビだけ入れます（管理画面の「テレビ用アカウントを作る」で出たもの）。') + '空のまま決定で閉じます。</div>' +
      '<input id="tvkeyIn" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:100%;font-size:24px;padding:10px;border-radius:10px;border:1px solid #2a2a31;background:#0b0b0d;color:#fff"></div>';
    document.body.appendChild(w);
    const inp = w.querySelector('input');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); e.stopPropagation(); submit(); } });
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
      if (document.getElementById('tvkeyBox')) { if (name === 'Enter') submit(); return; }
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); } catch (e) { /* noop */ } /* 音を出せるようにする（v2/tv.js はキーで音を有効にする） */
    },
    back() { closeKey(); return true; },
    settings() { openKey(); },
    menu() { const now = Date.now(); menuTaps = menuTaps.filter((x) => now - x < 1500).concat(now); if (menuTaps.length >= 3) { menuTaps = []; openKey(); } },
    resume() { /* noop */ },
  };
})();
