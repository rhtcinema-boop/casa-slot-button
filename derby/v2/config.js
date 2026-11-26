/* casa DERBY v2 本番のつなぎ先（Firebase プロジェクト casa-derby。2026-10-17 作成）。
   公開するときに v2/config.js の代わりにこれを置く（開発・テストは v2/config.js = null のまま模擬クラウド）。
   ウェブ用の Firebase の設定は、ページに書き込んで使う前提の値（秘密ではない）。守りはルール（v2/firestore.prod.rules）。
   ※ casa SLOT のプロジェクト（casa-ruretto）の設定は入れない。 */
window.DERBY_FIREBASE = {
  firebase: { apiKey: 'AIzaSyDuElvskkcKBs4XisXjTe7-mSxjq3KuswA', authDomain: 'casa-derby.firebaseapp.com', projectId: 'casa-derby', storageBucket: 'casa-derby.firebasestorage.app', messagingSenderId: '431109044793', appId: '1:431109044793:web:dd4a929a82e9603717ebe8' },
  masterEmail: 'rhtcinema@gmail.com',
  tvEmail: 'derby-tv@casa-derby.jp',
  publicSite: 'https://rhtcinema-boop.github.io/casa-slot-button/', // 公開サイト（2026-10-20: Fire TV アプリの中のテレビの QR は、ここの derby/v2/bet.html を指す。v2/qr.js の joinURL）
};
/* App Check（2026-10-27。下準備だけ・まだ「強制」しない。手順は v2/FIREBASE_SETUP.md の「App Check」）:
   reCAPTCHA の「サイトキー」（公開してよい値）を入れると、画面が App Check を有効にする（null のままなら何もしない）。
   reCAPTCHA Enterprise のキーなら DERBY_APPCHECK_PROVIDER を 'enterprise' に。 */
window.DERBY_APPCHECK_KEY = '6Lc_WgMuAAAAAMlyGK4WqQ9r5O0in5sR0fuyxTY4'; // 2026-10-27 作成（reCAPTCHA → Fraud Defense に登録・Firestore と Auth は「非適用」＝記録だけ）
window.DERBY_APPCHECK_PROVIDER = 'enterprise'; // Firebase の App Check に Fraud Defense（旧 reCAPTCHA Enterprise）で登録したので enterprise
/* LINE ログイン（2026-11-26 オーナー決定「スマホは LINE ログイン必須」。v2/line-login.js・ログイン係は Apps Script）。どちらも公開してよい値（秘密ではない）。
   2026-11-27 いまは「試し」: アドレスに ?line=1 を付けて開いたスマホだけ LINE ログインになる（?line=0 で元に戻る。覚えるのはそのブラウザだけ）。
   全員に出すときは、下の on をいつも true にする */
(function () {
  var on = false, q = location.search;
  try { if (/[?&]line=1(&|$)/.test(q)) localStorage.setItem('casa.lineTrial', '1'); if (/[?&]line=0(&|$)/.test(q)) localStorage.removeItem('casa.lineTrial'); on = localStorage.getItem('casa.lineTrial') === '1'; } catch (e) { on = /[?&]line=1(&|$)/.test(q); }
  window.DERBY_LINE = on ? { liffId: '2012817848-mLpbgONy', loginUrl: 'https://script.google.com/macros/s/AKfycbwYB7DH7wNfKusuuA47qhf2YvuySZzeQq2jaBgtm3f9skJLFUs0CbopGAw_fvU8-lI2/exec' } : null;
})();
