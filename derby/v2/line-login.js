/* casa DERBY・casa BOAT のスマホの LINE ログイン（2026-11-26 オーナー決定「スマホは LINE ログイン必須」）: window.DerbyLine
   前は Firebase の匿名ログインで、ブラウザごと（LINE の中・Safari・プライベート）に番号が変わり、BPT が見えなくなっていた。
   LINE でログインすると、どのブラウザでも同じ番号（uid ＝ 'L' ＋ LINE の userId）になる。
   設定: v2/config.prod.js の window.DERBY_LINE = { liffId, loginUrl }（loginUrl ＝ ログイン係 gas/line-login/Code.gs のウェブアプリの URL）。
         未設定（null）なら何もしない（enabled() が false ＝ 今までどおり匿名ログイン）。
   流れ（v2/client-firestore.js の ready() が、スマホ・観戦で、まだ L のログインでないときに signIn を呼ぶ）:
     LIFF の SDK を読む → liff.init → 未ログインなら「LINEでログイン」の画面（ボタン 1 つ）→ 押すと liff.login（LINE へ移って、このページへ戻る）
     → liff.getIDToken() → ログイン係に POST（いま匿名ログインが残っていればその ID トークンも＝BPT の引き継ぎ）→ signInWithCustomToken → いつもの画面へ。
   会員 ID（例 C-4821）は、ログイン係の返事を端末に覚える（casa.derby.member）。無ければ v2/client-firestore.js の member() が derbyMembers を 1 回読む。
   試験: node tests/line-login.test.js（LIFF・ログイン係・Firebase はにせ物） */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DerbyLine = api.create({});
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SDK = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
  const LS_MEMBER = 'casa.derby.member', LS_KEEP = 'casa.derby.line.ss', KEEP_MS = 15 * 60000;
  const LIFF_PARAMS = ['code', 'state', 'liffClientId', 'liffRedirectUri', 'error', 'error_description'];
  const TX = { title: 'ログイン', lead: 'スマホやブラウザを変えても BPT が残ります', btn: 'LINEでログイン', busy: 'ログイン中…', again: 'もう一度', errNet: '通信できませんでした。電波を確認して、もう一度押してください', errLine: 'ログインできませんでした。もう一度押してください', errLoad: 'LINE の読み込みに失敗しました。もう一度押してください' };
  const isLineUid = (u) => typeof u === 'string' && /^L/.test(u);

  /* deps（試験で差し替える）: cfg（DERBY_LINE）・liff・loadScript・fetch・doc（document）・loc（location）・hist（history）・ls（localStorage）・setTimeout */
  function create(deps) {
    deps = deps || {};
    const W = typeof window !== 'undefined' ? window : {};
    const cfg = () => (deps.cfg !== undefined ? deps.cfg : W.DERBY_LINE) || null;
    const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
    const loc = deps.loc || (typeof location !== 'undefined' ? location : null);
    const hist = deps.hist || (typeof history !== 'undefined' ? history : null);
    const ls = () => { if (deps.ls !== undefined) return deps.ls; try { return W.localStorage || null; } catch (e) { return null; } };
    const ss = () => { if (deps.ss !== undefined) return deps.ss; try { return W.sessionStorage || null; } catch (e) { return null; } };
    const doFetch = deps.fetch || (typeof fetch === 'function' ? fetch.bind(W) : null);
    const later = deps.setTimeout || setTimeout;
    const enabled = () => { const c = cfg(); return !!(c && typeof c.liffId === 'string' && c.liffId && typeof c.loginUrl === 'string' && /^https:\/\//.test(c.loginUrl)); };

    /* ---------- 会員 ID の覚え ---------- */
    function member(uid) { try { const s = ls(); const x = s ? JSON.parse(s.getItem(LS_MEMBER) || 'null') : null; return x && x.uid === uid && x.code ? { code: String(x.code), name: String(x.name || '') } : null; } catch (e) { return null; } }
    function remember(uid, m) { try { const s = ls(); if (s && m && m.code) s.setItem(LS_MEMBER, JSON.stringify({ uid, code: m.code, name: m.name || '' })); } catch (e) { /* 覚えられない端末は毎回読む */ } }

    /* ---------- LINE へ移る間の覚え ----------
       ボートの QR の合言葉などは、このタブの覚え（sessionStorage の casa.…）にある。LINE から戻ると別のタブになるブラウザもあるので、
       LINE へ移る前に端末の覚え（localStorage）へ写し、戻ったら（15 分以内なら）足りない分だけ戻す */
    function keepSession() {
      try { const S = ss(), L = ls(); if (!S || !L) return; const v = {}; for (let i = 0; i < S.length; i++) { const k = S.key(i); if (k && /^casa\./.test(k)) v[k] = S.getItem(k); } L.setItem(LS_KEEP, JSON.stringify({ at: Date.now(), v })); } catch (e) { /* noop */ }
    }
    function restoreSession(drop) {
      try { const S = ss(), L = ls(); if (!L) return; const x = JSON.parse(L.getItem(LS_KEEP) || 'null'); if (drop) L.removeItem(LS_KEEP); if (!S || !x || !x.v || !(Date.now() - x.at < KEEP_MS)) return; Object.keys(x.v).forEach((k) => { if (S.getItem(k) == null) S.setItem(k, x.v[k]); }); } catch (e) { /* noop */ }
    }
    function toLine(L) { keepSession(); L.login({ redirectUri: here() }); }

    /* ---------- LIFF ---------- */
    let liffP = null;
    function loadScript(src) {
      if (deps.loadScript) return deps.loadScript(src);
      return new Promise((res, rej) => { const s = doc.createElement('script'); s.src = src; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error('load ' + src)); doc.head.appendChild(s); });
    }
    const timeout = (p, ms, what) => Promise.race([p, new Promise((res, rej) => later(() => rej(Object.assign(new Error('timeout ' + what), { code: 'timeout' })), ms))]);
    function liff() {
      if (!liffP) liffP = (async () => {
        let L = deps.liff || W.liff;
        if (!L) { await timeout(loadScript(SDK), 15000, 'liff sdk'); L = W.liff; }
        if (!L) throw Object.assign(new Error('no liff'), { code: 'load' });
        await timeout(L.init({ liffId: cfg().liffId }), 15000, 'liff init');
        cleanUrl();
        return L;
      })().catch((e) => { liffP = null; throw e; });
      return liffP;
    }
    /* LINE から戻ったときの印（code・state など）をアドレスから消す（店の印 store などはそのまま） */
    function cleanUrl() {
      try {
        if (!loc || !hist || !hist.replaceState) return;
        const u = new URL(loc.href); let ch = false;
        LIFF_PARAMS.forEach((k) => { if (u.searchParams.has(k)) { u.searchParams.delete(k); ch = true; } });
        if (ch) hist.replaceState(hist.state, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash);
      } catch (e) { /* noop */ }
    }
    /* いまのページの住所（LINE から戻る先）。LINE の印は付けない */
    function here() { try { const u = new URL(loc.href); LIFF_PARAMS.forEach((k) => u.searchParams.delete(k)); return u.href; } catch (e) { return loc ? loc.href : ''; } }

    /* ---------- 画面（1 画面・ボタン 1 つ） ---------- */
    let ui = null;
    function css() {
      if (!doc || doc.getElementById('lnCss')) return;
      const st = doc.createElement('style'); st.id = 'lnCss';
      st.textContent = '#lnGate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px 16px calc(24px + env(safe-area-inset-bottom));background:#0b101b;color:#f3ead0;font-family:"Noto Sans JP",system-ui,-apple-system,sans-serif;text-align:center}' +
        'body.boat #lnGate{background:#071425}' +
        '#lnGate .in{width:100%;max-width:340px;display:flex;flex-direction:column;align-items:center;gap:14px}' +
        '#lnGate h1{margin:0;font-size:22px;font-weight:900;letter-spacing:.02em}#lnGate p{margin:0;font-size:14px;line-height:1.6;color:#c9c2ad}' +
        '#lnGate button{width:100%;height:56px;margin-top:6px;border:0;border-radius:14px;background:#06c755;color:#fff;font:inherit;font-size:18px;font-weight:900;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
        '#lnGate button:active{filter:brightness(.92)}#lnGate button[disabled]{opacity:.6;cursor:default}#lnGate .err{min-height:1.6em;color:#ff9d8c;font-size:13px;font-weight:700}#lnGate .err:empty{visibility:hidden}';
      doc.head.appendChild(st);
    }
    function show(o) {
      if (!doc || !doc.body) return null;
      css();
      if (!ui) {
        const el = doc.createElement('div'); el.id = 'lnGate'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'lnT');
        el.innerHTML = '<div class="in"><h1 id="lnT"></h1><p id="lnP"></p><button type="button" id="lnB"></button><p class="err" id="lnE" role="alert"></p></div>';
        doc.body.appendChild(el); ui = el;
      }
      ui.querySelector('#lnT').textContent = TX.title; ui.querySelector('#lnP').textContent = TX.lead;
      const b = ui.querySelector('#lnB'); b.textContent = o.busy ? TX.busy : o.retry ? TX.again : TX.btn; b.disabled = !!o.busy; b.onclick = o.busy ? null : o.onTap;
      ui.querySelector('#lnE').textContent = o.err || '';
      return ui;
    }
    function hide() { if (ui && ui.parentNode) ui.parentNode.removeChild(ui); ui = null; }

    /* ---------- ログイン係 ---------- */
    async function callServer(body) {
      if (!doFetch) throw Object.assign(new Error('no fetch'), { code: 'network' });
      let r;
      try { r = await timeout(doFetch(cfg().loginUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', credentials: 'omit' }), 25000, 'login'); }
      catch (e) { throw Object.assign(new Error('network'), { code: 'network', cause: e }); }
      let j = null; try { j = await r.json(); } catch (e) { j = null; }
      if (!j) throw Object.assign(new Error('bad reply'), { code: 'network' });
      if (!j.ok || !j.token) throw Object.assign(new Error(j.message || 'login'), { code: j.error || 'server' });
      return j;
    }
    /* 保存領域が使えないブラウザ（アプリの中など）: このページの間だけ覚える形でもう一度（client-firestore.js の匿名ログインと同じ） */
    async function fbSignIn(auth, token) {
      try { return await auth.signInWithCustomToken(token); } catch (e) {
        const c = String((e && e.code) || '');
        if (/network|timeout|too-many|invalid-custom-token|custom-token-mismatch/.test(c) || typeof auth.setPersistence !== 'function') throw e;
        try { await auth.setPersistence('none'); } catch (e2) { /* noop */ }
        return auth.signInWithCustomToken(token);
      }
    }

    /* signIn({ auth, anon }): L のログインができたら { uid, code, name, moved } で終わる（それまでは画面を出して待つ。LINE へ移るときは戻らない）。
       anon: いまの匿名ログインのユーザー（あれば BPT を引き継ぐ） */
    let running = null;
    function signIn(o) {
      if (running) return running;
      const auth = o.auth;
      running = new Promise((resolve) => {
        let tries = 0;
        const fail = (msg) => show({ err: msg, retry: true, onTap: () => go(true) });
        async function go(tapped) {
          tries++; restoreSession(false);
          show({ busy: true });
          let L;
          try { L = await liff(); } catch (e) { return fail(TX.errLoad); }
          if (!L.isLoggedIn()) {
            if (!tapped) return show({ onTap: () => { show({ busy: true }); try { toLine(L); } catch (e) { fail(TX.errLine); } } });
            show({ busy: true }); try { toLine(L); } catch (e) { fail(TX.errLine); } return;
          }
          const idToken = L.getIDToken && L.getIDToken();
          if (!idToken) { try { L.logout(); } catch (e) { /* noop */ } return show({ onTap: () => { show({ busy: true }); toLine(L); } }); }
          let anonToken = null;
          const cur = auth.currentUser;
          if (cur && cur.isAnonymous && !isLineUid(cur.uid)) { try { anonToken = await cur.getIdToken(); } catch (e) { anonToken = null; } }
          let j;
          try { j = await callServer({ idToken, anonToken }); }
          catch (e) {
            if (e.code === 'line_token') { try { L.logout(); } catch (e2) { /* noop */ } return show({ err: TX.errLine, onTap: () => { show({ busy: true }); toLine(L); } }); } // 期限切れなど: LINE でもう一度
            return fail(TX.errNet);
          }
          try { await fbSignIn(auth, j.token); } catch (e) { return fail(TX.errNet); }
          const uid = auth.currentUser ? auth.currentUser.uid : j.uid;
          remember(uid, { code: j.code, name: j.name }); restoreSession(true);
          hide(); running = null;
          resolve({ uid, code: j.code || null, name: j.name || '', moved: Number(j.moved) || 0, tries });
        }
        go(false);
      });
      return running;
    }
    return { enabled, isLineUid, signIn, member, remember, hide, TX, _here: here, _cleanUrl: cleanUrl, create };
  }
  return { create, isLineUid, TX };
});
