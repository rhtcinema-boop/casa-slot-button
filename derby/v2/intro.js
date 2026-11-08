/* casa DERBY スマホ 初めての人への説明（2026-11-08 オーナー「初めて投票する人にはこの施策の内容を理解できるような画面を出してあげたい」）。
   bet.js が「このスマホで初めて開いた」とき（名前の覚えも票の覚えも無い）に 1 回だけ読み込んで出す。閉じたら覚えて次から出さない（casa.derby.intro）。
   出すもの（オーナー選定）: タダで参加できてチップがもらえる／1着と2着を順番に当てる遊び／当たったらスマホをスタッフに見せる、を 3 コマの絵で。初参加の 2 票の案内とセット。
   window.BetIntro.show(opts) → opts.onClose() 。bet.js の中は増やさない（スマホの速さの決まり） */
(function () {
  'use strict';
  const KEY = 'casa.derby.intro';
  const TX = {
    head: 'casa DERBY のあそびかた', sub: '30秒でわかります',
    s1h: '参加はタダ、当たればチップ', s1p: '参加は無料、1票は 100pt。当たると 100pt × 倍率のチップ。16倍なら 1,600pt です。',
    s2h: '1着と2着を、順番に当てる', s2p: '6頭から、1着と2着になる馬を順番に選びます。',
    s3h: '当たったら、スタッフへ', s3p: 'レースはお店のテレビで。当たったら、この画面をスタッフへ。',
    twoH: '初めての方は 2票！', twoP: '100pt の票が 2 枚。2 通りの予想ができます（同じ組み合わせも OK）。',
    go: 'はじめる', skip: 'この案内は、次からは出ません',
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* 絵 1: チップ（金のコインに ✓ FREE）。絵 2: 券の番号 [3] → [5] と 1着・2着。絵 3: スマホ（的中の券）をスタッフ（蝶ネクタイ）へ */
  const PIC1 = '<svg viewBox="0 0 92 78" aria-hidden="true">' +
    '<ellipse cx="46" cy="64" rx="30" ry="6" class="line" opacity=".6"/>' +
    '<g transform="translate(14 36)"><ellipse cx="0" cy="26" rx="20" ry="7" class="gold2"/><rect x="-20" y="14" width="40" height="12" class="gold2"/><ellipse cx="0" cy="14" rx="20" ry="7" class="gold"/><ellipse cx="0" cy="14" rx="12" ry="4" class="cream"/></g>' +
    '<g transform="translate(58 30)"><circle cx="0" cy="0" r="26" class="gold2"/><circle cx="0" cy="0" r="22" class="gold"/><circle cx="0" cy="0" r="16" class="cream"/><text x="0" y="5" text-anchor="middle" font-size="13" font-weight="900" fill="#1a1407" font-family="inherit">FREE</text></g>' +
    '</svg>';
  const PIC2 = '<svg viewBox="0 0 92 78" aria-hidden="true">' +
    '<rect x="2" y="12" width="88" height="54" rx="5" class="paper"/><rect x="2" y="12" width="8" height="54" rx="2" class="sky"/>' +
    '<text x="18" y="27" font-size="9" font-weight="900" fill="#14203a" font-family="inherit">1着</text><text x="60" y="27" font-size="9" font-weight="900" fill="#14203a" font-family="inherit">2着</text>' +
    '<rect x="18" y="32" width="24" height="24" rx="3" class="navy"/><text x="30" y="50" text-anchor="middle" font-size="17" font-weight="900" fill="#fff" font-family="inherit">3</text>' +
    '<path d="M46 44 h8 m-3 -4 l4 4 l-4 4" fill="none" stroke="#14203a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<rect x="60" y="32" width="24" height="24" rx="3" class="navy"/><text x="72" y="50" text-anchor="middle" font-size="17" font-weight="900" fill="#fff" font-family="inherit">5</text>' +
        '</svg>';
  const PIC3 = '<svg viewBox="0 0 92 78" aria-hidden="true">' +
    '<rect x="6" y="6" width="34" height="66" rx="6" class="ink"/><rect x="9" y="11" width="28" height="56" rx="3" class="bg"/>' +
    '<rect x="12" y="24" width="22" height="16" rx="2" class="paper"/><circle cx="23" cy="32" r="6" fill="none" stroke="#c0392b" stroke-width="1.6"/><text x="23" y="34.5" text-anchor="middle" font-size="6" font-weight="900" fill="#c0392b" font-family="inherit">的中</text>' +
    '<path d="M44 40 h10 m-4 -5 l5 5 l-5 5" fill="none" stroke="#ffd773" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<g transform="translate(74 0)"><circle cx="0" cy="22" r="11" class="cream"/><path d="M-11 22 a11 11 0 0 1 22 0 v-3 a11 11 0 0 0 -22 0z" class="ink"/><path d="M-11 22 a11 11 0 0 1 22 0 l-3 0 a8 8 0 0 0 -16 0z" class="ink"/>' +
    '<path d="M-17 58 a17 17 0 0 1 34 0 v14 h-34z" class="ink"/><path d="M-6 42 l6 6 l6 -6 l-3 -3 h-6z" class="gold"/><path d="M-4 42 h8" stroke="#1a1407" stroke-width="1"/></g>' +
    '</svg>';
  function html() {
    return '<div class="in">' +
      '<div class="logo"><img src="../art/logo-3d/B/lockup-3d-B-casaWhite.svg" width="190" height="62" alt="casa DERBY" draggable="false"></div>' +
      '<h1>' + esc(TX.head) + '<small>' + esc(TX.sub) + '</small></h1>' +
      '<div class="steps">' +
      '<div class="st"><div class="pic">' + PIC1 + '</div><div><h2>' + esc(TX.s1h) + '</h2><p>' + esc(TX.s1p) + '</p></div></div>' +
      '<div class="st"><div class="pic">' + PIC2 + '</div><div><h2>' + esc(TX.s2h) + '</h2><p>' + esc(TX.s2p) + '</p></div></div>' +
      '<div class="st"><div class="pic">' + PIC3 + '</div><div><h2>' + esc(TX.s3h) + '</h2><p>' + esc(TX.s3p) + '</p></div></div>' +
      '</div>' +
      '<div class="two"><div class="n">2<small>票</small></div><div><h2>' + esc(TX.twoH) + '</h2><p>' + esc(TX.twoP) + '</p></div></div>' +
      '<button type="button" class="btn" data-act="introGo">' + esc(TX.go) + '</button>' +
      '<p class="skip">' + esc(TX.skip) + '</p>' +
      '</div>';
  }
  function seen() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function mark() { try { localStorage.setItem(KEY, '1'); } catch (e) { /* 覚えられない端末は次も出る */ } }
  function show(opts) {
    opts = opts || {};
    if (document.getElementById('introOv')) return;
    const ov = document.createElement('div'); ov.id = 'introOv'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', TX.head); ov.innerHTML = html();
    document.body.appendChild(ov);
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="introGo"]'); if (!b) return;
      mark(); ov.style.transition = 'opacity .25s'; ov.style.opacity = '0';
      setTimeout(() => { ov.remove(); document.body.style.overflow = prevOverflow; if (opts.onClose) opts.onClose(); }, 260);
    });
  }
  window.BetIntro = { show, seen, mark, TX };
})();
