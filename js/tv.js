/* テレビ（Fire TV Stick）向けのリモコン操作。
   十字キーで一番近いボタンへフォーカスを移し、決定で押す。戻るでダイアログ／設定を閉じる。
   メニューボタンを続けて3回押すと設定（PIN）を開く。数値入力は決定で「編集モード」に入り、上下で±1・左右で±10。
   iPad（タッチ）では何もしない。矢印キーか決定キーが押されたときだけ有効になる。 */
const TV = (function () {
  'use strict';
  const isTV = /casaTV/.test(navigator.userAgent);
  const FOCUSABLE = 'button, input, select, [data-act], [data-k], [data-r], #crest';
  let on = false, cur = null, curKey = '', editing = false, menuTaps = [], pending = 0, backHold = 0, logoTaps = [];

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
  // 描き直しのあとに同じ要素へ枠を戻すための目印。data-〇〇 と id で決める。文字は目印が何も無いときだけ使う
  // （b75: ON/OFF のように文字が変わるボタンを押すと、文字入りの目印が合わなくなって枠が先頭へ飛んでいた）
  const keyOf = (el) => { if (!el) return ''; const ds = Object.keys(el.dataset || {}).sort().map((k) => k + '=' + el.dataset[k]).join(','); return [el.tagName, el.id || '', ds, (el.id || ds) ? '' : (el.textContent || '').trim().slice(0, 20)].join('|'); };

  /* 設定やダイアログの本文だけをスクロールして、選んだ場所を見える位置へ（scrollIntoView は画面全体まで動かしてしまうので使わない） */
  function reveal(el) {
    const box = el.closest('.adm-body, .dialog .body');
    if (!box || box.scrollHeight <= box.clientHeight + 4) return;
    const r = rect(el), b = rect(box), k = (b.height / box.clientHeight) || 1, m = 14 * k;
    if (r.top < b.top + m) box.scrollTop -= (b.top + m - r.top) / k;
    else if (r.bottom > b.bottom - m) box.scrollTop += (r.bottom - b.bottom + m) / k;
  }
  function setFocus(el) {
    if (cur && cur !== el) { cur.classList.remove('tvfocus', 'tvedit'); editing = false; }
    cur = el;
    curKey = keyOf(el);
    if (!el) return;
    el.classList.add('tvfocus');
    reveal(el);
  }
  /* 今の層の中で既定のボタン: NEXT GAME → 決定 → OK → 最初の要素 */
  function defaultOf(list) {
    return list.find((e) => e.dataset.act === 'next') || list.find((e) => e.dataset.k === 'ok' || e.dataset.r === '1') ||
      list.find((e) => e.classList.contains('tab') && e.classList.contains('on')) || list[0] || null;
  }
  function ensure() {
    if (cur && visible(cur) && layer().contains(cur)) return;
    const list = candidates();
    // ゲーム画面で NEXT GAME が消えている間（回転中）は、枠をロゴなどへ移さない。戻ってきたら NEXT GAME に付け直す
    if (layer().id === 'content' && !list.some((e) => e.dataset.act === 'next')) {
      if (cur) cur.classList.remove('tvfocus', 'tvedit');
      cur = null; curKey = ''; editing = false;
      return;
    }
    setFocus((curKey && list.find((e) => keyOf(e) === curKey)) || defaultOf(list));
  }
  // ゲーム画面の固定ルート: NEXT GAME →(上)→ ? →(上)→ casa ロゴ →(下)→ ? →(下)→ NEXT GAME
  const ROUTE = { helpBtn: { ArrowUp: 'crest', ArrowLeft: 'crest' }, crest: { ArrowDown: 'helpBtn', ArrowRight: 'helpBtn' } };
  function move(dir) {
    ensure();
    if (!cur) return;
    if (layer().id === 'content' && ROUTE[cur.id] && ROUTE[cur.id][dir]) {
      const el = document.getElementById(ROUTE[cur.id][dir]);
      if (visible(el)) return setFocus(el);
    }
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
    if (best) return setFocus(best);
    // 行き先が無いときは、そのダイアログ／設定の本文を上下にスクロールする（長い説明文をリモコンで読むため）
    if (dir === 'ArrowUp' || dir === 'ArrowDown') {
      const box = layer().querySelector('.dialog .body, .adm-body');
      if (box && box.scrollHeight > box.clientHeight + 4) box.scrollBy({ top: dir === 'ArrowDown' ? 160 : -160, behavior: 'smooth' });
    }
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
    if (cur.tagName === 'SELECT') { cur.focus(); try { if (cur.showPicker) cur.showPicker(); } catch (e) { /* 開けない環境では上下キーで選ぶ */ } return; }
    if (cur.id === 'crest') { // 左上のロゴに枠を合わせて決定を5回（2.5秒以内）→ 設定（PIN）
      const now = Date.now();
      logoTaps = logoTaps.filter((x) => now - x < 2500).concat(now);
      if (logoTaps.length >= 5) { logoTaps = []; settings(); }
      return;
    }
    cur.click();
  }
  /* 戻る: 編集モード → ダイアログのキャンセル → 設定を閉じる。ゲーム画面では何もしない（アプリは終了しない） */
  let capture = null; // 画面サイズ調整など、キーを丸ごと受け取るモード
  const setCapture = (fn) => { capture = fn || null; };
  function back() {
    if (capture) { capture('Back', false); return true; }
    if (editing) { editing = false; cur.classList.remove('tvedit'); return true; }
    const top = layer();
    if (top.id === 'content') return false;
    const b = top.querySelector('[data-k="cancel"], [data-r="0"], [data-act="close"]') || (top.classList.contains('scrim') && top.querySelector('[data-r="1"]'));
    if (b) { b.click(); return true; }
    return false;
  }
  /* 設定を開く（PIN 入力へ）。ロゴで決定／メニュー3回／戻る長押し のどれからでも */
  function settings() {
    if (capture) return;
    if (typeof Game !== 'undefined' && Game.openSettings) Game.openSettings();
  }
  /* メニューボタン3回で設定 */
  function menu() {
    if (capture) return capture('Menu', false);
    const now = Date.now();
    menuTaps = menuTaps.filter((t) => now - t < 1500).concat(now);
    if (menuTaps.length >= 3) { menuTaps = []; settings(); }
  }
  function enable() {
    if (on) return;
    on = true;
    document.body.classList.add('tv');
    ensure();
  }
  function press(name, repeat) { // Android（Fire TV）側から呼ばれる
    onKey({ key: name, keyCode: 0, repeat: !!repeat, target: document.activeElement, preventDefault() {} });
  }
  function onKey(e) {
    const k = e.key, code = e.keyCode;
    const splash = document.getElementById('splash');
    const isEnter = k === 'Enter' || k === ' ' || code === 13 || code === 23 || code === 66;
    const isBack = k === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || code === 27 || code === 4;
    const isMenu = k === 'ContextMenu' || code === 93 || code === 82;
    const isArrow = /^Arrow(Up|Down|Left|Right)$/.test(k);
    if (!(isEnter || isBack || isMenu || isArrow)) return;
    if (e.target && e.target.tagName === 'SELECT' && (k === 'ArrowUp' || k === 'ArrowDown')) { // b79: Fire TV ではキーがネイティブに届かないので、上下で選択肢を動かす
      const sel = e.target, n = sel.selectedIndex + (k === 'ArrowDown' ? 1 : -1);
      if (n >= 0 && n < sel.options.length) { sel.selectedIndex = n; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      e.preventDefault(); return;
    }
    e.preventDefault();
    if (capture) {
      if (isMenu) { if (!e.repeat) capture('Menu', false); }
      else if (isBack) { if (!e.repeat) capture('Back', false); }
      else capture(isEnter ? 'Enter' : k, !!e.repeat);
      return;
    }
    if (e.repeat && isBack) { backHold += 1; if (backHold === 12) settings(); return; }
    if (!e.repeat) backHold = 0;
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
    if (isTV) { document.body.classList.add('tv', 'is-tv'); setTimeout(enable, 800); }
    document.addEventListener('keydown', onKey, true);
    // 画面全体（#stage）は絶対にスクロールさせない。フォーカス移動などで動いてしまったら即座に戻す（位置ズレ防止）
    document.addEventListener('scroll', (e) => {
      const t = e.target;
      if (t && t.id === 'stage' && (t.scrollTop || t.scrollLeft)) { t.scrollTop = 0; t.scrollLeft = 0; }
      else if (t === document && (window.scrollX || window.scrollY)) window.scrollTo(0, 0);
    }, true);
    document.addEventListener('focusin', (e) => { const el = e.target; if (el && el !== document.body && el.matches && el.matches(FOCUSABLE)) { enable(); setFocus(el); } }, true);
    // ロゴ（div）でのブラウザ標準の決定（keydown が届く環境向け）
    document.getElementById('crest').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); enable(); setFocus(e.currentTarget); activate(); } });
    // ダイアログや設定の描き直し、NEXT GAME の出入りに合わせてフォーカスを付け直す
    const mo = new MutationObserver(() => {
      if (!on || pending) return;
      pending = requestAnimationFrame(() => { pending = 0; ensure(); });
    });
    mo.observe(document.getElementById('ui'), { childList: true, subtree: true });
    mo.observe(document.getElementById('lockbar'), { childList: true, attributes: true, attributeFilter: ['class'] });
  }
  document.addEventListener('DOMContentLoaded', init);
  /* Android 側の onResume から呼ばれる（b78）: ホームに戻ってから復帰したとき、リールが消えていたら描き直す */
  function resume() { try { if (window.Game && Game.reelHeal) Game.reelHeal(); } catch (e) { /* noop */ } }
  return { isTV, back, menu, settings, press, setCapture, resume, get enabled() { return on; } };
})();
window.TV = TV; // Android（Fire TV）側は window.TV 経由で呼ぶ（const は window に載らないため明示する）
