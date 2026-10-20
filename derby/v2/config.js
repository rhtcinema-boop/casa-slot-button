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
