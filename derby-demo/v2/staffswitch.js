/* casa DERBY スタッフのスマホ（v2/staff.html）: casa SLOT とのつなぎ（2026-10-19。v4 で 2026-10-21 に整理）
   - 左上の「スロット ｜ 競馬」のタブ（casa SLOT の js/phoneswitch.js と同じ見た目。今いる方＝競馬が銀）。「スロット」で casa SLOT の紙幣のページへ。
     casa SLOT の下に置いた公開版だけ（tools/build-derby-deploy.js が window.DERBY_SLOT_BILL を書き足したとき）。
     手で移ったら localStorage 'casa.phoneSwitchManual' = { store, game: 移ったときの店のゲーム, to, at }。店のゲームがそれと同じあいだは自動で入れ替えない。
   - スマホの画面の自動の入れ替え: 店のテレビのゲームが casa SLOT になったら casa SLOT の紙幣のページ（bill.html）へ。
     対象は、このスマホで紙幣のページにも同じ店でログインしてある（localStorage 'casa-slot-bill.v1'）スタッフのスマホだけ。
     途中では移らない: シート（番号を空ける・テストレース・その他）・スライドの途中・確認の窓・ログインの入力中・6 秒さわっていないとき以外。
     行ったり来たり: 10 分に 6 回を超えたら 10 分止める。「このスマホは自動で入れ替えない」（'casa.phoneSwitch' = 'off'）は staff.js の「その他」で切り替える（StaffSwitch.setAuto）。
   - 店のゲームは v2/tvswitch.js の DerbyTvSwitch.watch（数秒）。通知が使えないときは 30 秒ごとに読む。Web デモでは何もしない。
   - 2026-10-23 デザイン見直し 1 回目: 確認の窓（#gtAsk）を紺の地・金のボタン（DESIGN_SYSTEM_V4.md）に。タブの見た目は casa SLOT と同じのまま。
   - v4 で変えたこと: 上の帯の「テレビ: … 切り替え・画質 ›」のボタンとシートはなくした（staff.js の画面の上・「その他」に移した）。 */
(function () {
  'use strict';
  const T = window.DerbyTvSwitch, S = () => window.STAFF;
  if (!T || !window.STAFF || (window.DERBY_FIREBASE && window.DERBY_FIREBASE.demo)) return;
  const MAP = [[/渋谷/, 'shibuya'], [/上野/, 'ueno'], [/札幌/, 'sapporo']]; // js/tvswitch.js（casa SLOT）と同じ
  const BILL_KEY = 'casa-slot-bill.v1', AUTO_KEY = 'casa.phoneSwitch', LOG_KEY = 'casa.phoneSwitchLog', MAN_KEY = 'casa.phoneSwitchManual';
  const QUIET_MS = 6000, RETRY_MS = 2000, POLL_MS = 30000, LOOP_N = 6, LOOP_MS = 10 * 60000;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* noop */ } };
  const qs = new URLSearchParams(location.search);
  const state = { id: null, game: null, at: 0, busy: false, open: false, waiting: false, leaving: false, why: '' };
  const auto = () => lsGet(AUTO_KEY) !== 'off';
  const home = () => window.DERBY_SLOT_BILL || '';
  const storeId = () => { const s = S().saved; return (s && s.store) || qs.get('store') || null; };
  function billFits(id) { // このスマホは casa SLOT の紙幣のページにも、同じ店でログインしてある
    let b = null; try { b = JSON.parse(lsGet(BILL_KEY)); } catch (e) { b = null; }
    if (!b || !b.storeId) return false;
    const o = lsGet('casa.derbyStore'); if (o) return o === id;
    const hit = MAP.find(([re]) => re.test(b.name || ''));
    return !!hit && hit[1] === id;
  }

  /* ---------- 手で移った記録（casa SLOT の js/phoneswitch.js と同じ決まり・同じ場所） ---------- */
  function manualGet() { try { const j = JSON.parse(lsGet(MAN_KEY)); return j && j.store ? j : null; } catch (e) { return null; } }
  function manualHold(id, game) { // true ＝手で移ったあと、店のゲームがまだ同じ（自動で入れ替えない）
    const m = manualGet(); if (!m) return false;
    if (m.store !== id) { lsSet(MAN_KEY, null); return false; }
    if (!game) return true;
    if (m.game == null) { m.game = game; lsSet(MAN_KEY, JSON.stringify(m)); return true; }
    if (m.game === game) return true;
    lsSet(MAN_KEY, null); return false;
  }

  /* ---------- 「スロット ｜ 競馬」のタブ ---------- */
  const gcss = document.createElement('style');
  gcss.textContent = '#gameTabs{position:fixed;top:calc(var(--sat,0px) + 5px);left:10px;z-index:45;display:flex;gap:2px;padding:2px;border-radius:12px;border:1px solid #3a3a42;background:#101012;font:700 13px/1 -apple-system,"Hiragino Sans",sans-serif}' +
    '#gameTabs[hidden]{display:none}#gameTabs button{height:34px;min-width:46px;padding:0 8px;border:0;border-radius:9px;background:transparent;color:#cfd6cc;font:inherit;letter-spacing:.02em;white-space:nowrap}' +
    '#gameTabs button{position:relative}#gameTabs button::after{content:"";position:absolute;left:0;right:0;top:-5px;bottom:-5px}' + /* 見た目は casa SLOT と同じ 34px のまま、押せる所だけ上下に広げる（44px。2026-10-23） */
    '#gameTabs button.cur{background:#d9dce3;color:#1a1d24}@media (max-width:389px){#gameTabs{font-size:12px}#gameTabs button{padding:0 7px;min-width:44px}}' +
    '#gtAsk{position:fixed;inset:0;z-index:70;background:rgba(4,7,13,.8);display:flex;align-items:center;justify-content:center;padding:24px}' +
    '#gtAsk .card{width:100%;max-width:360px;box-sizing:border-box;background:#101d36;border:1px solid #2c3a57;border-radius:16px;padding:20px;color:#f5f3ef;font-family:-apple-system,"Hiragino Sans",sans-serif}' +
    '#gtAsk h3{margin:0 0 8px;font-size:18px;color:#f5f3ef;text-align:center}#gtAsk p{margin:0 0 16px;font-size:15px;line-height:1.6;color:#b8beca;text-align:center}#gtAsk .row{display:flex;gap:10px}' +
    '#gtAsk button{flex:1;min-height:52px;border-radius:14px;font:inherit;font-size:16px;font-weight:700}#gtAsk [data-gt="no"]{border:1px solid #2c3a57;background:#16213a;color:#e8eaf0}' +
    '#gtAsk [data-gt="yes"]{border:0;background:linear-gradient(180deg,#ffe9a8,#c9a03e);color:#1a1408;font-weight:900}';
  document.head.appendChild(gcss);
  const tabs = document.createElement('div');
  tabs.id = 'gameTabs'; tabs.hidden = true; tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = '<button type="button" role="tab" data-gt="slot" aria-selected="false">スロット</button><button type="button" role="tab" data-gt="derby" class="cur" aria-selected="true">競馬</button>';
  ($('app') || document.body).appendChild(tabs);
  function ask(title, text) {
    return new Promise((res) => {
      const old = $('gtAsk'); if (old) old.remove();
      const w = document.createElement('div'); w.id = 'gtAsk';
      w.innerHTML = '<div class="card" role="dialog" aria-modal="true"><h3>' + esc(title) + '</h3><p>' + text + '</p><div class="row"><button type="button" data-gt="no">やめる</button><button type="button" data-gt="yes">移る</button></div></div>';
      w.addEventListener('click', (e) => { const b = e.target.closest('[data-gt]'); if (!b && e.target !== w) return; w.remove(); res(!!b && b.dataset.gt === 'yes'); });
      document.body.appendChild(w);
    });
  }
  tabs.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-gt]'); if (!b || b.dataset.gt !== 'slot') return; // 今いる方（競馬）は何もしない
    const id = storeId(); if (!home() || !id || state.leaving) return;
    if (S().sheetOpen && !(await ask('手続きの途中です', '開いている画面はここで閉じます。<br>スロット（casa SLOT の紙幣のページ）へ移りますか？'))) return;
    if (state.leaving) return;
    lsSet(MAN_KEY, JSON.stringify({ store: id, game: state.game || null, to: 'slot', at: Date.now() })); // 手で移った（行ったり来たりの回数には数えない）
    state.leaving = true;
    location.href = home();
  });
  function placeTabs() { // ロゴ（上の帯）がタブと重ならないように、重なる分だけ右へ
    const on = !!home() && !!storeId();
    tabs.hidden = !on;
    const cr = document.querySelector('header.top .crest'); if (!cr) return;
    cr.style.position = 'relative'; cr.style.left = '0px';
    if (!on) return;
    const t = tabs.getBoundingClientRect(), c = (cr.querySelector('img') || cr).getBoundingClientRect();
    const need = Math.ceil(t.right + 10 - c.left);
    if (need > 0 && c.top < t.bottom) cr.style.left = need + 'px';
  }
  window.addEventListener('resize', placeTabs);

  /* ---------- 店のゲームを見張る → スマホの画面の入れ替え ---------- */
  let lastTouch = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { capture: true, passive: true }));
  function looping() { let l = []; try { l = JSON.parse(lsGet(LOG_KEY) || '[]'); } catch (e) { l = []; } const now = Date.now(); return l.filter((x) => now - x < LOOP_MS).length >= LOOP_N; }
  function mark() { let l = []; try { l = JSON.parse(lsGet(LOG_KEY) || '[]'); } catch (e) { l = []; } l.push(Date.now()); lsSet(LOG_KEY, JSON.stringify(l.slice(-LOOP_N * 3))); }
  function busyNow() {
    if (S().sheetOpen || $('gtAsk')) return true;
    const lg = $('login');
    if (lg && !lg.classList.contains('hidden') && Array.from(lg.querySelectorAll('input')).some((i) => i.value || document.activeElement === i)) return true; // PIN を入れている途中
    const ae = document.activeElement;
    return !!(ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName));
  }
  let ready = null;
  async function slotReady() {
    if (ready === true) return true;
    try { const r = await fetch(home() + '?t=' + Date.now(), { cache: 'no-store' }); ready = r.ok && /phoneswitch\.js/.test(await r.text()); } catch (e) { ready = false; }
    return ready;
  }
  let timer = 0;
  function kick(ms) { clearTimeout(timer); timer = setTimeout(maybeGo, ms == null ? 300 : ms); }
  async function maybeGo() {
    const id = storeId();
    state.id = id; state.waiting = false;
    const g = gameNow();
    if (!home() || !id || state.leaving || g !== 'slot') { state.why = !home() ? 'not under slot' : g !== 'slot' ? 'derby' : ''; return; }
    if (!billFits(id)) { state.why = 'no bill login'; return; }
    if (manualHold(id, g)) { state.why = 'manual'; return; }
    if (!auto()) { state.why = 'auto off'; return; }
    if (looping()) { state.why = 'loop'; return kick(60000); }
    if (busyNow() || Date.now() - lastTouch < QUIET_MS) { state.waiting = true; state.why = 'busy'; return kick(RETRY_MS); }
    if (!(await slotReady())) { state.why = 'no slot bill'; return kick(POLL_MS); }
    if (gameNow() !== 'slot' || busyNow() || manualHold(id, gameNow())) return kick(RETRY_MS);
    state.leaving = true; state.why = 'go'; mark();
    location.href = home();
  }
  // 店のゲーム: 通知・読み取りの値（state.game）。staff.js が切り替えた直後はその値（S().gameNow）
  function gameNow() { const g = S().gameNow ? S().gameNow() : null; return g || state.game; }
  let lastDoc = null;
  function onDoc(doc) {
    lastDoc = doc;
    const id = storeId(); state.id = id; if (!id) return placeTabs();
    state.game = T.gameOf(doc, id); state.at = Date.now();
    manualHold(id, state.game); // 店のゲームが手で移ったときと変わっていたら、ここで記録を消す
    if (S().onGame) S().onGame(state.game);
    placeTabs(); kick();
  }
  T.watch(onDoc);
  setInterval(async () => { if (T.live.on || !storeId()) return; const d = await T.readDoc(); if (d) onDoc(d); }, POLL_MS);
  setTimeout(async () => { if (!T.live.on && storeId()) { const d = await T.readDoc(); if (d) onDoc(d); } }, 3000);
  setInterval(() => { if (lastDoc && storeId() !== state.id) onDoc(lastDoc); else placeTabs(); }, 2000);
  placeTabs();
  window.StaffSwitch = { state, manualHold, placeTabs, maybeGo, kick, home, auto, setAuto(on) { lsSet(AUTO_KEY, on ? null : 'off'); kick(); } };
})();
