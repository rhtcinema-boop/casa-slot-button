/* casa DERBY Web デモ: 各画面（テレビ・お客さん・スタッフ・管理）の最初に読むつなぎ先の設定。v2/config.js の代わり。
   サーバーも本物の Firebase も使わない。デモの舞台（index.html）が持っている「にせ Firestore」1 つを、
   同じページの中のテレビ・スマホ・管理画面みんなで使う（v2/client-firestore.js がそのまま動く）。
   - window.DERBY_FIREBASE に印を入れる → v2/client.js は Firestore 版（client-firestore.js）を選ぶ
   - DerbyFirestore.connect（本物の SDK を読み込む所）だけを、舞台のにせ Firestore を返すものに差し替える
   - テレビは決める係のアカウントでログインする（舞台が持っている合言葉を渡す）
   ゲームのファイルには手を入れない。舞台の外で開いたときは案内だけ出す。 */
(function () {
  'use strict';
  function findHub() {
    var w = window;
    for (var i = 0; i < 8; i++) {
      try { if (w.__derbyDemo) return w.__derbyDemo; } catch (e) { /* よそのページ */ }
      var p = null; try { p = w.parent; } catch (e) { p = null; }
      if (!p || p === w) break; w = p;
    }
    try { if (window.opener && window.opener.__derbyDemo) return window.opener.__derbyDemo; } catch (e) { /* なし */ }
    return null;
  }
  var hub = findHub();
  var path = location.pathname, kind = /bet\.html$/.test(path) ? 'bet' : /staff\.html$/.test(path) ? 'staff' : /admin\.html$/.test(path) ? 'admin' : /watchmap\.html$/.test(path) || /[?&]watch=1\b/.test(location.search) ? 'watch' : 'tv'; // watch: スマホの「レースを見る」（3D の tv.html?watch=1・図の v2/watchmap.html。2026-10-30）。テレビではない（決める係の鍵を外さない）
  var home = /\/v2\/[^/]*$/.test(path) ? '../index.html' : 'index.html';
  window.DERBY_FIREBASE = { firebase: { projectId: 'casa-derby-webdemo', demo: true }, masterEmail: hub ? hub.MASTER : 'master@demo.invalid', tvEmail: hub ? hub.TV_EMAIL : 'tv@demo.invalid', demo: true };
  window.__derbyDemoPage = { kind: kind, hub: hub };
  // 本物の Firebase の SDK（gstatic）を読みに行かない（v2/client.js は window.firebase が無いと SDK を読む。デモは舞台のにせ Firestore だけ。2026-10-30）
  if (typeof window.firebase === 'undefined') window.firebase = { apps: [], __demoStub: true };

  // 閲覧用の枠（claude.ai の Artifact）では confirm() が出ずにすぐ false が返る → 押した操作が止まる。
  // すぐに返ってきた false だけ「OK」とみなす（人が答えた false は、そのまま false）
  try {
    var nativeConfirm = window.confirm && window.confirm.bind(window);
    window.confirm = function (m) { var t0 = Date.now(), r = false; try { r = nativeConfirm ? nativeConfirm(m) : false; } catch (e) { r = false; } return r || Date.now() - t0 < 40; };
  } catch (e) { /* なし */ }

  // 舞台の中のスマホ・管理画面が入力欄に自分でカーソルを置いても、舞台のページごと動かない（スマホの画面で急に下へ飛ばない）
  if (hub && kind !== 'tv') { try { var focus0 = HTMLElement.prototype.focus; HTMLElement.prototype.focus = function (o) { return focus0.call(this, Object.assign({ preventScroll: true }, o || {})); }; } catch (e) { /* なし */ } }

  // 音なし（オーナー指示「音を出すのはやめて」）: テレビは ?mute=1 で開く（実況・蹄の音は読まない）。
  // そのうえで、効果音（js/audio.js）は音の部品を作らず・読まず、ずっと消音のまま。音のボタンも出さない。音のファイルはデモに入れていない
  if (kind === 'tv' || kind === 'watch') {
    var sfx0;
    try {
      Object.defineProperty(window, 'Sfx', { configurable: true, enumerable: true, get: function () { return sfx0; }, set: function (v) {
        if (v && typeof v.mute === 'function') { var mute0 = v.mute; v.mute = function () { return mute0.call(v, true); }; v.unlock = function () {}; v.mute(true); }
        sfx0 = v;
      } });
    } catch (e) { /* なし */ }
    try { // 念のため: 音のファイルを読みに行かない（デモに入っていないので、読むと「見つからない」になる）
      var fetch0 = window.fetch && window.fetch.bind(window);
      if (fetch0) window.fetch = function (u, o) { var s = String(u && u.url ? u.url : u); if (/(^|\/)art\/(sfx|voice)\//.test(s)) return new Promise(function () {}); return fetch0(u, o); };
    } catch (e) { /* なし */ }
    var st = document.createElement('style');
    st.textContent = '.soundbtn,#v2snd{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  var fbP = null;
  function patch(DF) {
    if (!DF || DF.__demo) return DF;
    var create0 = DF.create;
    // 本物は 1 ページに 1 つのログイン（同じページの DerbyCloud はみな同じ利用者）。デモも同じにする
    DF.connect = function (config) {
      if (!hub) return Promise.reject(new Error('デモの舞台が見つかりません'));
      if (!fbP) fbP = hub.ready.then(function () { return { fb: hub.clientFor(window, kind), config: config }; });
      return fbP;
    };
    DF.create = function (opts, env) {
      opts = Object.assign({}, opts || {});
      if (opts.role === 'tv' && hub && hub.tvPassFor(window)) opts.tvPassword = hub.tvPassFor(window);
      if (env && typeof env.oddsAsync === 'function') {
        // オッズの計算は Worker で。Worker が使えない所（枠の決まり）では、待たずにその場で計算する
        var w = env.oddsAsync, broken = false;
        env.oddsAsync = function (race, seed, sims) {
          if (broken) return Promise.reject(new Error('worker off'));
          return new Promise(function (res, rej) {
            var to = setTimeout(function () { broken = true; rej(new Error('worker timeout')); }, 8000);
            w(race, seed, sims).then(function (o) { clearTimeout(to); res(o); }, function (e) { clearTimeout(to); broken = true; rej(e); });
          });
        };
      }
      return create0(opts, env);
    };
    DF.__demo = true;
    return DF;
  }
  var real;
  try {
    Object.defineProperty(window, 'DerbyFirestore', { configurable: true, enumerable: true, get: function () { return real; }, set: function (v) { real = patch(v); } });
  } catch (e) { /* なし */ }
  if (hub && hub.pageStart) { try { hub.pageStart(window, kind); } catch (e) { /* なし */ } }

  if (!hub) { // 舞台の外（新しいタブで開いた等）: 案内を出す
    document.addEventListener('DOMContentLoaded', function () {
      var d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:99999;padding:14px 16px;border-radius:12px;background:#1d2a1f;color:#f3efe2;font:15px/1.6 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
      d.innerHTML = 'この画面は「casa DERBY デモ」の舞台の中で動きます。<a href="' + home + '" style="color:#f2c94c">デモの舞台を開く</a>';
      document.body.appendChild(d);
    });
  }
})();
