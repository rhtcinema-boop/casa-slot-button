/* casa BOAT Web デモ（2026-11-19）: ボートのスマホ（v2/boat.html）・テレビ（tv.html）の最初に読むつなぎ先。v2/config.js の代わり。
   サーバーも本物の Firebase も使わない。舞台（入口の index.html の hub.js）が持っている「にせ Firestore」1 つを、同じページの中の画面みんなで使う。
   - window.DERBY_FIREBASE に印 → v2/client.js は Firestore 版（client-firestore.js・boat-firestore.js）を選ぶ
   - DerbyFirestore.connect（本物の SDK を読む所）だけを、舞台のにせ Firestore を返すものに差し替える
   - テレビは決める係のアカウントで読む（QR の合言葉・映像の種）。ただし決める係（進行役）にはならない（舞台が決める）
   ゲームのファイルには手を入れない。音は出さない（テレビは ?mute=1）。 */
(function () {
  'use strict';
  function findHub() { let w = window; for (let i = 0; i < 6; i++) { try { if (w.__boatDemo) return w.__boatDemo; } catch (e) { /* よそのページ */ } let p = null; try { p = w.parent; } catch (e) { p = null; } if (!p || p === w) break; w = p; } return null; }
  const hub = findHub(), kind = /boat\.html$/.test(location.pathname) ? 'phone' : 'tv';
  window.DERBY_FIREBASE = { firebase: { projectId: 'casa-boat-webdemo', demo: true }, masterEmail: hub ? hub.MASTER : 'master@demo.invalid', tvEmail: hub ? hub.TV_EMAIL : 'tv@demo.invalid', demo: true };
  window.__derbyDemoPage = { kind, hub };
  if (typeof window.firebase === 'undefined') window.firebase = { apps: [], __demoStub: true }; // 本物の SDK を読みに行かない
  // デモの中のスマホは枠（iframe）の中: iOS 26 の Safari の下のバーは外の舞台がよける（中では空けない）
  if (kind === 'phone') { const st = document.createElement('style'); st.textContent = ':root{--sbar:0px!important}'; (document.head || document.documentElement).appendChild(st); }
  let fbP = null;
  function patch(DF) {
    if (!DF || DF.__demo) return DF;
    const create0 = DF.create;
    DF.connect = function (config) {
      if (!hub) return Promise.reject(new Error('デモの舞台が見つかりません'));
      if (!fbP) fbP = hub.ready.then(() => ({ fb: hub.clientFor(kind), config }));
      return fbP;
    };
    DF.create = function (opts, env) {
      opts = Object.assign({}, opts || {});
      if (opts.role === 'tv' && hub) { opts.tvPassword = hub.TV_PW; opts.decider = false; opts.pair = false; } // テレビ: 読むだけ（決めるのは舞台）
      return create0(opts, env);
    };
    DF.__demo = true;
    return DF;
  }
  let real;
  try { Object.defineProperty(window, 'DerbyFirestore', { configurable: true, enumerable: true, get() { return real; }, set(v) { real = patch(v); } }); } catch (e) { /* なし */ }
  if (!hub) document.addEventListener('DOMContentLoaded', () => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:99999;padding:14px;border-radius:12px;background:#10253c;color:#fff;font:15px/1.6 sans-serif'; d.innerHTML = 'この画面は「casa BOAT デモ」の中で動きます。<a href="' + (kind === 'phone' ? '../' : '') + 'index.html" style="color:#8fdcff">デモを開く</a>'; document.body.appendChild(d); });
})();
