/* テレビ（Fire TV Stick）向けのリモコン操作。
   十字キーで一番近いボタンへフォーカスを移し、決定で押す。戻るでダイアログ／設定を閉じる。
   メニューボタンを続けて3回押すと設定（PIN）を開く。数値入力は決定で「編集モード」に入り、上下で±1・左右で±10。
   iPad（タッチ）では何もしない。矢印キーか決定キーが押されたときだけ有効になる。 */
const TV = (function () {
  'use strict';
  const isTV = /casaTV/.test(navigator.userAgent);
  const FOCUSABLE = 'button, input, select, [data-act], [data-k], [data-r]';
  let on = false, cur = null, curKey = '', editing = false, menuTaps = [], pending = 0;

  const rect = (el) => el.getBoundingClientRect();
  function visible(el) {
    if (!el || !document.contains(el) || el.disabled) return false;
    const r = rect(el);
    if (r.width < 2 || r.height < 2) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    }
    return true;
  }
  /* いちばん手前の層: ダイアログ（.scrim）や設定画面（.adm）があればそれ、無ければゲーム画面 */
  function layer() {
    const kids = Array.from(document.getElementById('ui').children).filter((k) => visible(k) || k.querySelector(FOCUSABLE));
    if (kids.length) return kids[kids.length - 1];
    return document.getElementById('content');
  }
  function candidates() {
    return Array.from(layer().querySelectorAll(FOCUSABLE)).filter(visible);
  }
  const keyOf = (el) => el ? [el.tagName, el.dataset.act, el.dataset.tab, el.dataset.k, el.dataset.r, el.dataset.p, el.dataset.f, el.dataset.d, el.dataset.g, (el.textContent || '').trim().slice(0, 20)].join('|') : '';

  function setFocus(el) {
    if (cur && cur !== el) { cur.classList.remove('tvfocus', 'tvedit'); editing = false; }
    cur = el;
    curKey = keyOf(el);
    if (!el) return;
    el.classList.add('tvfocus');
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* 古いWebView */ }
  }
  /* 今の層の中で既定のボタン: NEXT GAME → 決定 → OK → 最初の要素 */
  function defaultOf(list) {
    return list.find((e) => e.dataset.act === 'next') || list.find((e) => e.dataset.k === 'ok' || e.dataset.r === '1') ||
      list.find((e) => e.classList.contains('tab') && e.classList.contains('on')) || list[0] || null;
  }
  function ensure() {
    if (cur && visible(cur) && layer().contains(cur)) return;
    const list = candidates();
    setFocus((curKey && list.find((e) => keyOf(e) === curKey)) || defaultOf(list));
  }
  function move(dir) {
    ensure();
    if (!cur) return;
    const cr = rect(cur), cx = (cr.left + cr.right) / 2, cy = (cr.top + cr.bottom) / 2;
    let best = null, bestScore = Infinity;
    candidates().forEach((el) => {
      if (el === cur) return;
      const r = rect(el), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
      let p, s, overlap;
      if (dir === 'ArrowRight') { p = x - cx; s = Math.abs(y - cy); overlap = r.top < cr.bottom && r.bottom > cr.top; }
      else if (dir === 'ArrowLeft') { p = cx - x; s = Math.abs(y - cy); overlap = r.top < cr.bottom && r.bottom > cr.top; }
      else if (dir === 'ArrowDown') { p = y - cy; s = Math.abs(x - cx); overlap = r.left < cr.right && r.right > cr.left; }
      else { p = cy - y; s = Math.abs(x - cx); overlap = r.left < cr.right && r.right > cr.left; }
      if (p < 2) return;
      const score = p + (overlap ? 0.3 : 2.5) * s;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) setFocus(best);
  }
  const isNum = (el) => el && el.tagName === 'INPUT' && (el.type === 'number' || el.type === 'range');
  function setVal(el, d) {
    const min = el.min === '' ? -Infinity : +el.min, max = el.max === '' ? Infinity : +el.max;
    let v = (el.value === '' ? 0 : +el.value) + d;
    v = Math.min(max, Math.max(min, Math.round(v * 100) / 100));
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function activate() {
    ensure();
    if (!cur) return;
    if (isNum(cur)) { editing = !editing; cur.classList.toggle('tvedit', editing); return; }
    if (cur.tagName === 'SELECT') { cur.focus(); return; }
    cur.click();
  }
  /* 戻る: 編集モード → ダイアログのキャンセル → 設定を閉じる。ゲーム画面では何もしない（アプリは終了しない） */
  function back() {
    if (editing) { editing = false; cur.classList.remove('tvedit'); return true; }
    const top = layer();
    if (top.id === 'content') return false;
    const b = top.querySelector('[data-k="cancel"], [data-r="0"], [data-act="close"]') || (top.classList.contains('scrim') && top.querySelector('[data-r="1"]'));
    if (b) { b.click(); return true; }
    return false;
  }
  /* メニューボタン3回で設定 */
  function menu() {
    const now = Date.now();
    menuTaps = menuTaps.filter((t) => now - t < 1500).concat(now);
    if (menuTaps.length >= 3) { menuTaps = []; if (typeof Game !== 'undefined' && Game.openSettings) Game.openSettings(); }
  }
  function enable() {
    if (on) return;
    on = true;
    document.body.classList.add('tv');
    ensure();
  }
  function onKey(e) {
    const k = e.key, code = e.keyCode;
    const splash = document.getElementById('splash');
    const isEnter = k === 'Enter' || k === ' ' || code === 13 || code === 23 || code === 66;
    const isBack = k === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || code === 27 || code === 4;
    const isMenu = k === 'ContextMenu' || code === 93 || code === 82;
    const isArrow = /^Arrow(Up|Down|Left|Right)$/.test(k);
    if (!(isEnter || isBack || isMenu || isArrow)) return;
    if (e.target && e.target.tagName === 'SELECT' && isArrow) return; // ネイティブの選択に任せる
    e.preventDefault();
    if (e.repeat && !isArrow) return;
    enable();
    if (isMenu) return menu();
    if (isBack) return back();
    if (splash && document.contains(splash)) { if (isEnter) splash.click(); return; }
    if (isEnter) return activate();
    if (editing && isNum(cur)) {
      const range = cur.type === 'range';
      if (k === 'ArrowUp') return setVal(cur, range ? 5 : 1);
      if (k === 'ArrowDown') return setVal(cur, range ? -5 : -1);
      if (k === 'ArrowRight') return setVal(cur, range ? 10 : 10);
      if (k === 'ArrowLeft') return setVal(cur, range ? -10 : -10);
    }
    move(k);
  }
  function init() {
    if (isTV) document.body.classList.add('tv', 'is-tv');
    document.addEventListener('keydown', onKey, true);
    // ダイアログや設定の描き直し、NEXT GAME の出入りに合わせてフォーカスを付け直す
    const mo = new MutationObserver(() => {
      if (!on || pending) return;
      pending = requestAnimationFrame(() => { pending = 0; ensure(); });
    });
    mo.observe(document.getElementById('ui'), { childList: true, subtree: true });
    mo.observe(document.getElementById('lockbar'), { childList: true, attributes: true, attributeFilter: ['class'] });
  }
  document.addEventListener('DOMContentLoaded', init);
  return { isTV, back, menu, get enabled() { return on; } };
})();
