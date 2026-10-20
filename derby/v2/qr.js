/* casa DERBY v2 共有 QR ヘルパー（スマホ bet.html・スタッフ staff.html・テレビ index.html で共通に使う）
   ライブラリ: qrcode-generator 1.4.4（cdnjs、版を固定）。読み込まれていなければ自動で読み込む。
   読み取り（スタッフのカメラ）は staff.js 側（BarcodeDetector → なければ jsQR）。

   ── 使い方（window.DerbyQR）──────────────────────────────────────────
   DerbyQR.ready()                      → Promise。ライブラリを読み込み終わったら解決（何度呼んでもよい）
   DerbyQR.svg(text, opts)              → Promise<string>  QR の SVG 文字列
   DerbyQR.svgSync(text, opts)          → string | null    ready() 後なら同期で SVG（未読込なら null）
   DerbyQR.render(el, text, opts)       → Promise<void>    el の中身を QR の SVG に置き換える（el は要素か id）
   DerbyQR.canvas(text, opts)           → Promise<HTMLCanvasElement>  （テレビの WebGL/2D 描画に貼る用）
       opts: { size: 表示の一辺 px（既定 240。SVG は viewBox なので CSS で伸縮可）, margin: 余白のマス数（既定 2）,
               dark: '#000', light: '#fff', ecl: 'L'|'M'|'Q'|'H'（誤り訂正、既定 'M'） }
   DerbyQR.joinURL(storeId, base?)      → string  お客さんが読む参加 URL（…/v2/bet.html?store=<id>）。
                                          base を省くと、いまのページの場所から v2/bet.html を組み立てる
   DerbyQR.payload(kind, id)            → string  スタッフが読む中身（API.md と同じ形）。kind: 'auth'（認証。id=tid）| 'pay'（受け取り。id=pid）
                                          形式: "derby:auth:<tid>" / "derby:pay:<pid>"。サーバーが返す authCode / payout.code をそのまま QR にしてもよい
   DerbyQR.parse(text)                  → { kind: 'auth'|'pay', id } | { kind: 'join', store, url } | null
   ──────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';
  const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  const LIB2 = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js'; // 予備（同じ版）
  // 2026-10-19: 同じ版をアプリの中（js/vendor/qrcode.min.js）にも置いた。まずそれを読み、無いときだけネットから（ネットなしでも QR が出る）
  const ME = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  const LOCAL = ME ? new URL('../js/vendor/qrcode.min.js', ME).href : null;
  let loading = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function ready() {
    if (typeof root.qrcode === 'function') return Promise.resolve();
    if (!loading) {
      loading = (LOCAL ? loadScript(LOCAL) : Promise.reject(new Error('no local'))).catch(() => loadScript(LIB)).catch(() => loadScript(LIB2)).then(() => {
        if (typeof root.qrcode !== 'function') throw new Error('qrcode-generator missing');
      });
      loading.catch(() => { loading = null; }); // 失敗したら次の呼び出しでやり直す
    }
    return loading;
  }

  function matrix(text, ecl) {
    const q = root.qrcode(0, ecl || 'M'); // 0 = 長さに合わせて型番を自動で選ぶ
    q.addData(String(text), 'Byte');
    q.make();
    return q;
  }

  function svgSync(text, opts) {
    if (typeof root.qrcode !== 'function') return null;
    const o = Object.assign({ size: 240, margin: 2, dark: '#000', light: '#fff', ecl: 'M' }, opts || {});
    const q = matrix(text, o.ecl), n = q.getModuleCount(), m = o.margin, w = n + m * 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) { // 横に続く黒マスを 1 本の長方形にまとめる（SVG が軽くなる）
        if (!q.isDark(r, c)) { c++; continue; }
        let e = c; while (e < n && q.isDark(r, e)) e++;
        d += 'M' + (c + m) + ' ' + (r + m) + 'h' + (e - c) + 'v1h-' + (e - c) + 'z';
        c = e;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + w + '" width="' + o.size + '" height="' + o.size +
      '" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="' + w + '" height="' + w + '" fill="' + o.light +
      '"/><path d="' + d + '" fill="' + o.dark + '"/></svg>';
  }

  const svg = (text, opts) => ready().then(() => svgSync(text, opts));

  function render(el, text, opts) {
    const node = typeof el === 'string' ? document.getElementById(el) : el;
    return svg(text, opts).then((s) => { if (node) node.innerHTML = s; });
  }

  function canvas(text, opts) {
    return ready().then(() => {
      const o = Object.assign({ size: 240, margin: 2, dark: '#000', light: '#fff', ecl: 'M' }, opts || {});
      const q = matrix(text, o.ecl), n = q.getModuleCount(), w = n + o.margin * 2;
      const cell = Math.max(1, Math.floor(o.size / w)), px = cell * w;
      const cv = document.createElement('canvas'); cv.width = cv.height = px;
      const g = cv.getContext('2d');
      g.fillStyle = o.light; g.fillRect(0, 0, px, px); g.fillStyle = o.dark;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + o.margin) * cell, (r + o.margin) * cell, cell, cell);
      return cv;
    });
  }

  /* 2026-10-20（本番 b137 の上野のテストレースで「QR を読んでも参加できなかった」）: casa SLOT の Fire TV アプリの中では、
     ページの場所が https://appassets.androidplatform.net/assets/www/derby/index.html（アプリの中だけの住所。スマホからは開けない）。
     いまのページの場所から組み立てると、QR がこのアプリの中の住所になっていた → アプリの中（と file: など）では公開サイトの同じ場所に置きかえる。
     公開サイトは v2/config.js（本番 = config.prod.js）の publicSite、無ければ casa SLOT の公開先（js/game.js の版の確かめと同じ） */
  const APP_HOST = 'appassets.androidplatform.net', APP_ROOT = '/assets/www/';
  const PUBLIC_SITE = 'https://rhtcinema-boop.github.io/casa-slot-button/';
  function publicSite() { const c = root.DERBY_FIREBASE; let s = (c && typeof c.publicSite === 'string' && /^https:\/\//.test(c.publicSite) ? c.publicSite : '') || PUBLIC_SITE; if (!/\/$/.test(s)) s += '/'; return s; }
  function joinURL(storeId, base, loc) {
    let b = base;
    if (!b) {
      const L = loc || location;
      const p = L.pathname.replace(/[^/]*$/, ''); // いまのページのフォルダ
      const dir = /\/v2\/$/.test(p) ? p : p + 'v2/';
      if (L.hostname === APP_HOST || !/^https?:$/.test(L.protocol)) { // アプリの中: …/assets/www/<ここから下> を公開サイトの同じ場所へ
        const i = dir.indexOf(APP_ROOT), rest = i >= 0 ? dir.slice(i + APP_ROOT.length) : 'derby/v2/';
        b = publicSite() + rest + 'bet.html';
      } else b = L.origin + dir + 'bet.html';
    }
    return b + (b.indexOf('?') >= 0 ? '&' : '?') + 'store=' + encodeURIComponent(storeId);
  }

  const payload = (kind, id) => 'derby:' + (kind === 'pay' ? 'pay' : 'auth') + ':' + id;

  function parse(text) {
    const t = String(text || '').trim();
    let m = /^derby:(auth|pay):([A-Za-z0-9_-]{2,64})$/i.exec(t);
    if (m) return { kind: m[1].toLowerCase(), id: m[2] };
    m = /[?&]store=([^&#]+)/.exec(t);
    if (/bet\.html/.test(t) && m) return { kind: 'join', store: decodeURIComponent(m[1]), url: t };
    return null;
  }

  root.DerbyQR = { ready, svg, svgSync, render, canvas, joinURL, payload, parse, LIB };
})(typeof self !== 'undefined' ? self : this);
