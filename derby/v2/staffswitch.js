/* casa DERBY スタッフのスマホ（v2/staff.html）: 店のテレビのゲーム（casa SLOT / casa DERBY）の切り替えと、スマホの画面の入れ替え（2026-10-19）
   - 上の帯（店舗の行の下）の「テレビ: casa ○○ 切り替え」→ 今のゲームと「casa SLOT」「casa DERBY」。書く値は管理画面・casa SLOT のマスター画面と同じ
     （derbyStores/<店舗ID>.settings.tvGame と derbySwitch/tv.<店舗ID> を 1 回で。DerbyCloud の tvGame(pin, game)。ルールはその店のスタッフの自分の店だけ）。
     ログインはこの画面の PIN（staff.js が覚えているもの）。
   - スマホの画面も自動で入れ替える（casa SLOT の下に置いた公開版だけ。tools/build-derby-deploy.js が window.DERBY_SLOT_BILL を書き足す）:
     店のゲームが casa SLOT になったら casa SLOT の紙幣のページ（bill.html）へ。対象は、このスマホで紙幣のページにもログインしてある
     （localStorage 'casa-slot-bill.v1' の店が、この店と同じ）スタッフのスマホだけ。お客さんのスマホ（bet.html）は対象外。
     途中では移らない: 確認の画面（認証・受け取りのシート）・番号の手入力・ログインの入力中・このシートを開いている間・6 秒さわっていないとき以外。
     行ったり来たり: 10 分に 6 回を超えたら 10 分止める（js/phoneswitch.js と同じ記録。テレビと同じ回数）。「このスマホは自動で入れ替えない」も同じ設定（'casa.phoneSwitch'）。
   - 変更の通知は v2/tvswitch.js の DerbyTvSwitch.watch（数秒）。通知が使えないときは 30 秒ごとに読む。Web デモでは何もしない。 */
(function () {
  'use strict';
  const T = window.DerbyTvSwitch, S = () => window.STAFF;
  if (!T || !window.STAFF || (window.DERBY_FIREBASE && window.DERBY_FIREBASE.demo)) return;
  const MAP = [[/渋谷/, 'shibuya'], [/上野/, 'ueno'], [/札幌/, 'sapporo']]; // js/tvswitch.js（casa SLOT）と同じ
  const BILL_KEY = 'casa-slot-bill.v1', AUTO_KEY = 'casa.phoneSwitch', LOG_KEY = 'casa.phoneSwitchLog';
  const QUIET_MS = 6000, RETRY_MS = 2000, POLL_MS = 30000, LOOP_N = 6, LOOP_MS = 10 * 60000;
  const NAMES = { slot: 'casa SLOT', derby: 'casa DERBY' };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* noop */ } };
  const qs = new URLSearchParams(location.search);
  const state = { id: null, game: null, at: 0, busy: false, msg: '', open: false, waiting: false, leaving: false, why: '' };
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

  /* ---------- 画面 ---------- */
  const css = document.createElement('style');
  css.textContent = '#tvgBtn{display:inline-flex;align-items:center;gap:6px;margin:6px 0 2px;padding:5px 14px;border-radius:999px;border:1px solid #2a3a2c;background:#101612;color:#cfd6cc;font:12px/1.3 -apple-system,"Hiragino Sans",sans-serif}' +
    '#tvgBtn b{font-size:13px;color:#9fe07a}#tvgBtn.slot b{color:#ffe9a8}#tvgBtn i{font-style:normal;color:#9aa89c}#tvgBtn[hidden]{display:none}' +
    '#tvgSheet{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.78);display:flex;align-items:flex-end;justify-content:center}' +
    '#tvgSheet .card{width:100%;max-width:480px;background:#101612;border:1px solid #5fb53a;border-bottom:0;border-radius:18px 18px 0 0;padding:18px 18px calc(env(safe-area-inset-bottom,0px) + 18px);color:#e8e3d2;font-family:-apple-system,"Hiragino Sans",sans-serif}' +
    '#tvgSheet h3{margin:0 0 4px;font-size:16px;color:#9fe07a}#tvgSheet p{margin:6px 0;font-size:13px;color:#9aa89c;line-height:1.6}#tvgSheet .now{font-size:15px;color:#e8e3d2}#tvgSheet .now b{color:#d8f5c4}' +
    '#tvgSheet .two{display:flex;gap:10px;margin:12px 0}#tvgSheet .two button{flex:1;padding:16px 6px;border-radius:14px;border:1px solid #5fb53a;background:#0b0f0c;color:#d8f5c4;font:700 17px/1.2 inherit}' +
    '#tvgSheet .two button.cur{background:linear-gradient(180deg,#b9ec8f,#5fb53a);color:#0b1a06}#tvgSheet .two button.cur small{display:block;font-size:11px;font-weight:400}#tvgSheet .two button:disabled:not(.cur){opacity:.45}' +
    '#tvgSheet .err{color:#ff8c7a;font-size:14px;min-height:18px;margin:6px 0}#tvgSheet .okm{color:#35e07a;font-size:14px;margin:6px 0}' +
    '#tvgSheet .auto{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid #1d2a1f;font-size:13px;color:#cfd6cc}' +
    '#tvgSheet .auto button{flex:none;white-space:nowrap}#tvgSheet .auto button,#tvgSheet .close{padding:9px 14px;border-radius:999px;border:1px solid #3a3a3a;background:#1a1a1a;color:#cfd6cc;font:inherit;font-size:13px}#tvgSheet .close{width:100%;margin-top:12px;padding:13px}';
  document.head.appendChild(css);
  const btn = document.createElement('button');
  btn.id = 'tvgBtn'; btn.type = 'button'; btn.hidden = true;
  btn.addEventListener('click', () => { state.open = true; state.msg = ''; paint(); });
  (document.querySelector('header.top') || document.body).appendChild(btn); // 上の帯の、店舗の行の下（ロゴと重ならない）

  const loggedIn = () => { const s = S().saved; return !!(s && s.store && s.pin && S().C); };
  function paintBtn() {
    const on = loggedIn() && $('login').classList.contains('hidden');
    btn.hidden = !on;
    if (!on) return;
    const g = state.game;
    btn.className = g === 'slot' ? 'slot' : '';
    btn.innerHTML = 'テレビ: <b>' + (g ? NAMES[g] : '…') + '</b><i>切り替え ›</i>';
  }
  function sheetHtml() {
    const g = state.game, s = S().saved;
    const b = (x) => '<button type="button" data-tvg="' + x + '" class="' + (g === x ? 'cur' : '') + '"' + (g === x || state.busy || !g ? ' disabled' : '') + '>' + NAMES[x] + (g === x ? '<small>いまこちら</small>' : '') + '</button>';
    return '<div class="card"><h3>店のテレビのゲーム</h3>' +
      '<p class="now">' + esc(s ? s.name : '') + ' のテレビ: <b>' + (g ? NAMES[g] : '確認中…') + '</b></p>' +
      '<p>押すと、この店のテレビ（Fire TV）が数秒で切り替わります（ゲーム中・レース中は終わってから）。管理画面・casa SLOT のマスター画面と同じ設定です。</p>' +
      '<div class="two">' + b('slot') + b('derby') + '</div>' +
      (state.msg ? '<div class="' + (/^OK /.test(state.msg) ? 'okm' : 'err') + '" id="tvgMsg">' + esc(state.msg.replace(/^OK /, '')) + '</div>' : '') +
      (home() ? '<div class="auto"><span>このスマホの画面も自動で入れ替える<br><small style="color:#9aa89c">casa SLOT のときは casa SLOT の紙幣のページに（紙幣のページにもログインしてあるスマホだけ）</small></span><button type="button" data-tvg="auto">' + (auto() ? 'する' : 'しない') + '</button></div>' : '') +
      '<button type="button" class="close" data-tvg="close">閉じる</button></div>';
  }
  function paint() {
    paintBtn();
    let sh = $('tvgSheet');
    if (!state.open || !loggedIn()) { if (sh) sh.remove(); state.open = false; return; }
    if (!sh) { sh = document.createElement('div'); sh.id = 'tvgSheet'; sh.addEventListener('click', onClick); document.body.appendChild(sh); }
    sh.innerHTML = sheetHtml();
  }
  const ERR = { bad_pin: 'PIN が変わりました。ログインし直してください', permission: '書き込みが許可されませんでした（PIN を確かめてください）', no_store: '店舗が見つかりません' };
  async function onClick(e) {
    const t = e.target.closest('[data-tvg]');
    if (!t) { if (e.target.id === 'tvgSheet' && !state.busy) { state.open = false; paint(); } return; }
    const a = t.dataset.tvg;
    if (a === 'close') { if (!state.busy) { state.open = false; paint(); } return; }
    if (a === 'auto') { lsSet(AUTO_KEY, auto() ? 'off' : null); paint(); kick(); return; }
    if (state.busy || (a !== 'slot' && a !== 'derby') || !loggedIn()) return;
    const s = S().saved;
    if (!window.confirm(s.name + ' のテレビを ' + NAMES[a] + ' にします。数秒で切り替わります（ゲーム中・レース中は終わってから）。')) return;
    state.busy = true; state.msg = ''; paint();
    try { await S().C.tvGame(s.pin, a); state.game = a; state.at = Date.now(); state.msg = 'OK ' + s.name + ' のテレビを ' + NAMES[a] + ' にしました。'; }
    catch (err) { state.msg = (err && ERR[err.code]) || (err && !err.status ? '通信できませんでした。もう一度お試しください' : (err && err.message) || 'うまくいきませんでした'); }
    state.busy = false; paint(); kick();
  }

  /* ---------- 店の設定を見張る → スマホの画面の入れ替え ---------- */
  let lastTouch = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { capture: true, passive: true }));
  function looping() { let l = []; try { l = JSON.parse(lsGet(LOG_KEY) || '[]'); } catch (e) { l = []; } const now = Date.now(); return l.filter((x) => now - x < LOOP_MS).length >= LOOP_N; }
  function mark() { let l = []; try { l = JSON.parse(lsGet(LOG_KEY) || '[]'); } catch (e) { l = []; } l.push(Date.now()); lsSet(LOG_KEY, JSON.stringify(l.slice(-LOOP_N * 3))); }
  function busyNow() {
    if (state.open || state.busy || S().sheetOpen) return true;
    const lg = $('login');
    if (lg && !lg.classList.contains('hidden') && Array.from(lg.querySelectorAll('input')).some((i) => i.value || document.activeElement === i)) return true; // PIN・番号を入れている途中
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
    if (!home() || !id || state.leaving || state.game !== 'slot') { state.why = !home() ? 'not under slot' : state.game !== 'slot' ? 'derby' : ''; return; }
    if (!billFits(id)) { state.why = 'no bill login'; return; }
    if (!auto()) { state.why = 'auto off'; return; }
    if (looping()) { state.why = 'loop'; return kick(60000); }
    if (busyNow() || Date.now() - lastTouch < QUIET_MS) { state.waiting = true; state.why = 'busy'; return kick(RETRY_MS); }
    if (!(await slotReady())) { state.why = 'no slot bill'; return kick(POLL_MS); }
    if (state.game !== 'slot' || busyNow()) return kick(RETRY_MS);
    state.leaving = true; state.why = 'go'; mark();
    location.href = home();
  }
  let lastDoc = null;
  function onDoc(doc) {
    lastDoc = doc;
    const id = storeId(); state.id = id; if (!id) return paintBtn();
    state.game = T.gameOf(doc, id); state.at = Date.now();
    paint(); kick();
  }
  T.watch(onDoc);
  setInterval(async () => { if (T.live.on || !storeId()) return; const d = await T.readDoc(); if (d) onDoc(d); }, POLL_MS);
  setTimeout(async () => { if (!T.live.on && storeId()) { const d = await T.readDoc(); if (d) onDoc(d); } }, 3000);
  setInterval(() => { if (lastDoc && storeId() !== state.id) onDoc(lastDoc); else paintBtn(); }, 2000);
  window.StaffSwitch = { state, open() { state.open = true; paint(); }, maybeGo };
})();
