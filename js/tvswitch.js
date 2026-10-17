/* テレビのゲームの切り替え（casa SLOT → casa DERBY。2026-10-17）
   casa DERBY の管理画面の店舗の設定「テレビのゲーム」（Firestore casa-derby の derbySwitch/tv = { <DERBY の店舗ID>: 'slot' | 'derby' }、
   ログインなしで読める 1 件）を、開いた 3 秒後と 30 秒ごとに読む（REST で GET するだけ。SDK は使わない）。'derby' なら、待機中に
   同じ場所の derby/index.html?store=<DERBY の店舗ID> へ移る（アプリの中でもブラウザでも同じ相対パス。戻るのは casa DERBY 側の v2/tvswitch.js）。
   - 動くのは Fire TV のアプリ（UA に casaTV）か、その端末で ?tvswitch=1 を 1 回開いたとき（localStorage。?tvswitch=0 で止める）。iPad では動かない
   - 店舗の対応: 店舗名に 渋谷 → shibuya、上野 → ueno、札幌 → sapporo。違う名前の店は ?derbystore=<ID> を 1 回開いて覚えさせる。対応が無い店は移らない
   - 読めない（オフライン・失敗）ときは casa SLOT のまま。回転中・CREDIT が残っている・設定や画面調整の最中は終わってから。
     derby/ のファイルが無い（古い版）ときは移らない。行ったり来たりが続くときは 10 分止める
   - テスト用: localhost のときだけ ?tvgameUrl=<URL> で読む先を差し替えられる（sessionStorage に覚える） */
(function () {
  'use strict';
  const DOC = 'https://firestore.googleapis.com/v1/projects/casa-derby/databases/(default)/documents/derbySwitch/tv?key=AIzaSyDuElvskkcKBs4XisXjTe7-mSxjq3KuswA';
  const MAP = [[/渋谷/, 'shibuya'], [/上野/, 'ueno'], [/札幌/, 'sapporo']];
  const QS = location.search, UA_TV = /casaTV/.test(navigator.userAgent || '');
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const S = (st) => ({ get(k) { try { return st().getItem(k); } catch (e) { return null; } }, set(k, v) { try { if (v == null) st().removeItem(k); else st().setItem(k, v); } catch (e) { /* noop */ } } });
  const ss = S(() => sessionStorage), ls = S(() => localStorage);
  const POLL_MS = 30000, FIRST_MS = 3000, BUSY_MS = 3000, LOOP_N = 6, LOOP_MS = 10 * 60000;
  const qp = (k) => { const m = new RegExp('[?&]' + k + '=([^&#]*)').exec(QS); try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } };
  if (qp('tvswitch') === '1') ls.set('casa.tvswitch', '1'); else if (qp('tvswitch') === '0') ls.set('casa.tvswitch', null);
  if (qp('derbystore') != null) ls.set('casa.derbyStore', /^[a-z0-9_-]{1,32}$/.test(qp('derbystore')) ? qp('derbystore') : null);
  let stub = null;
  if (LOCAL) { stub = qp('tvgameUrl'); if (stub) ss.set('casa.tvgameUrl', stub); else stub = ss.get('casa.tvgameUrl'); }
  const active = () => UA_TV || ls.get('casa.tvswitch') === '1';
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
  const state = { last: null, at: 0, err: '', target: null, leaving: false };
  async function readGame(id) {
    if (navigator.onLine === false) { state.err = 'offline'; return null; }
    const c = typeof AbortController === 'function' ? new AbortController() : null, t = c && setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch(stub || DOC, Object.assign({ cache: 'no-store', credentials: 'omit' }, c ? { signal: c.signal } : {}));
      if (r.status === 404) { state.err = ''; return 'slot'; }
      if (!r.ok) { state.err = 'http ' + r.status; return null; }
      const j = await r.json(), f = j && j.fields && j.fields[id];
      state.err = '';
      return f && f.stringValue === 'derby' ? 'derby' : 'slot';
    } catch (e) { state.err = 'net'; return null; } finally { if (t) clearTimeout(t); }
  }
  function looping() { let log = []; try { log = JSON.parse(ss.get('casa.tvswitchLog') || '[]'); } catch (e) { log = []; } const now = Date.now(); return log.filter((x) => now - x < LOOP_MS).length >= LOOP_N; }
  function mark() { let log = []; try { log = JSON.parse(ss.get('casa.tvswitchLog') || '[]'); } catch (e) { log = []; } log.push(Date.now()); ss.set('casa.tvswitchLog', JSON.stringify(log.slice(-LOOP_N * 2))); }
  async function derbyReady() { try { const r = await fetch('derby/index.html?t=' + Date.now(), { cache: 'no-store' }); return r.ok && /v2\/tvswitch\.js/.test(await r.text()); } catch (e) { return false; } }
  let timer = 0;
  const later = (ms) => { clearTimeout(timer); timer = setTimeout(check, ms); };
  async function check() {
    if (!active() || state.leaving) return;
    const id = derbyId();
    state.target = id;
    if (!id) return later(POLL_MS);
    const g = await readGame(id);
    state.at = Date.now();
    if (g) state.last = g;
    if (g !== 'derby') return later(POLL_MS);
    if (looping()) { state.err = 'loop'; return later(POLL_MS); }
    if (!idle()) return later(BUSY_MS);
    if (!(await derbyReady())) { state.err = 'no derby files'; return later(POLL_MS); }
    if (!idle()) return later(BUSY_MS);
    state.leaving = true; mark();
    try { if (typeof Store !== 'undefined' && Store.log) Store.transact(() => Store.log('TV_GAME', { to: 'derby', store: id })); } catch (e) { /* 記録できなくても移る */ }
    location.replace('derby/index.html?store=' + encodeURIComponent(id) + '&via=slot');
  }
  window.SlotTvSwitch = { check, state, active, derbyId };
  if (active()) later(FIRST_MS);
})();
