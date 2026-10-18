/* スタッフのスマホ（紙幣のページ bill.html）: 店のテレビのゲーム（casa SLOT / casa DERBY）の切り替えと、スマホの画面の入れ替え（2026-10-19）
   - 右上の「テレビ」ボタン → 今のゲームと「casa SLOT」「casa DERBY」。書く値はマスター画面・casa DERBY の管理画面と同じ
     （casa-derby の derbyStores/<店舗ID>.settings.tvGame と derbySwitch/tv.<店舗ID> を 1 回の書き込みで）。
   - 書けるのは casa DERBY のその店のスタッフ（ルールの staffOf）だけ。casa DERBY のスタッフ PIN を使う:
     このスマホで casa DERBY のスタッフ画面にログインしてあれば（localStorage 'casa.derby.staff.v1'。同じサイトなので見える）その PIN をそのまま使う。
     無ければこの画面で 1 回入れる。入れた PIN は casa DERBY のスタッフ画面と同じ場所に覚える（スタッフ画面と同じ扱い。どちらで入れても両方で使える）。
     ログイン（Firebase の匿名ログイン）は REST で、このページを開いている間だけ（鍵は保存しない）。
   - スマホの画面も自動で入れ替える: 店のゲームが casa DERBY になったら derby/v2/staff.html?store=<店舗ID> へ（数秒で。変更の通知は js/tvswitch.js の SlotTvSwitch.watch）。
     紙幣の流れの途中では移らない（GAME START か空の会計番号入力の画面で、送信中・扉・確認の画面でなく、6 秒さわっていないときだけ。bill.js の BillPage.idle）。
     行ったり来たり: 10 分に 6 回を超えたら 10 分止める（テレビと同じ）。「このスマホは自動で入れ替えない」も選べる（localStorage 'casa.phoneSwitch' = 'off'）。
   - 店舗の対応は js/tvswitch.js と同じ（渋谷 → shibuya、上野 → ueno、札幌 → sapporo。?derbystore= で覚えさせた値が先）。対応の無い店ではボタンを出さない
   - テスト用: localhost のときだけ ?derbyApi=<URL> で Google の入口（ログインと Firestore）を差し替える（js/derbyswitch-master.js と同じ） */
(function () {
  'use strict';
  const T = window.SlotTvSwitch;
  if (!T || !window.BillPage) return;
  const KEY = 'AIzaSyDuElvskkcKBs4XisXjTe7-mSxjq3KuswA', DB = 'projects/casa-derby/databases/(default)/documents';
  const STAFF_KEY = 'casa.derby.staff.v1', AUTO_KEY = 'casa.phoneSwitch', LOG_KEY = 'casa.phoneSwitchLog';
  const QUIET_MS = 6000, RETRY_MS = 2000, POLL_MS = 30000, LOOP_N = 6, LOOP_MS = 10 * 60000;
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  let stub = null;
  if (LOCAL) {
    const m = /[?&]derbyApi=([^&#]*)/.exec(location.search);
    try { if (m) { stub = decodeURIComponent(m[1]); sessionStorage.setItem('casa.derbyApi', stub); } else stub = sessionStorage.getItem('casa.derbyApi'); } catch (e) { /* noop */ }
  }
  const SIGNUP = (stub || 'https://identitytoolkit.googleapis.com') + '/v1/accounts:signUp?key=' + KEY;
  const FS = (stub || 'https://firestore.googleapis.com') + '/v1/' + DB;
  const NAMES = { slot: 'casa SLOT', derby: 'casa DERBY' };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* noop */ } };
  const state = { id: null, game: null, at: 0, busy: false, msg: '', open: false, waiting: false, leaving: false, why: '' };

  const bill = () => window.BillPage.saved;
  function derbyId() {
    const s = bill(); if (!s || !s.storeId) return null;
    const o = lsGet('casa.derbyStore'); if (o) return o;
    const hit = T.MAP.find(([re]) => re.test(s.name || ''));
    return hit ? hit[1] : null;
  }
  const staffSaved = () => { try { const j = JSON.parse(lsGet(STAFF_KEY)); return j && j.store && j.pin ? j : null; } catch (e) { return null; } };
  const auto = () => lsGet(AUTO_KEY) !== 'off';

  /* ---------- casa DERBY へのスタッフのログインと書き込み（REST。鍵はメモリだけ） ---------- */
  let sess = null; // { idToken, uid, exp, staff: '<店舗>|<PIN>' }
  async function post(url, body, token) {
    const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
    const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    return { r, j };
  }
  async function signIn() {
    if (sess && Date.now() < sess.exp) return sess;
    const { r, j } = await post(SIGNUP, { returnSecureToken: true });
    if (!r.ok || !j.idToken) throw new Error('casa DERBY につながりませんでした（' + r.status + '）。通信を確認してください。');
    sess = { idToken: j.idToken, uid: j.localId, exp: Date.now() + (Number(j.expiresIn) || 3600) * 1000 - 60000, staff: '' };
    return sess;
  }
  async function asStaff(id, pin) { // casa DERBY のスタッフ画面と同じ: derbyStaff/<uid> = { storeId, pin, at }（PIN が合うときだけルールが通す）
    const s = await signIn(), k = id + '|' + pin;
    if (s.staff === k) return s;
    const { r } = await post(FS + ':commit', { writes: [{ update: { name: DB + '/derbyStaff/' + s.uid, fields: { storeId: { stringValue: id }, pin: { stringValue: String(pin) }, at: { integerValue: String(Date.now()) } } } }] }, s.idToken);
    if (r.status === 403) { const e = new Error('casa DERBY のスタッフ PIN が違います。'); e.code = 'bad_pin'; throw e; }
    if (!r.ok) throw new Error('casa DERBY にログインできませんでした（' + r.status + '）。');
    s.staff = k; return s;
  }
  async function setGame(id, pin, game) {
    const s = await asStaff(id, pin), v = { stringValue: game === 'derby' ? 'derby' : 'slot' };
    const { r } = await post(FS + ':commit', { writes: [
      { update: { name: DB + '/derbyStores/' + id, fields: { settings: { mapValue: { fields: { tvGame: v } } } } }, updateMask: { fieldPaths: ['settings.tvGame'] }, currentDocument: { exists: true } },
      { update: { name: DB + '/derbySwitch/tv', fields: { [id]: v } }, updateMask: { fieldPaths: [id] } },
    ] }, s.idToken);
    if (r.ok) return;
    if (r.status === 404) throw new Error('casa DERBY に店舗「' + id + '」がありません。');
    if (r.status === 401) { sess = null; throw new Error('ログインの期限が切れました。もう一度押してください。'); }
    if (r.status === 403) { if (sess) sess.staff = ''; const e = new Error('書き込みが許可されませんでした。もう一度押しても同じときは、マスター画面から切り替えてください。'); e.code = 'denied'; throw e; }
    throw new Error('保存できませんでした（' + r.status + '）。');
  }

  /* ---------- 画面（右上のボタンと、開いたときのシート） ---------- */
  const css = document.createElement('style');
  css.textContent = '#tvgBtn{position:absolute;top:calc(var(--sat,0px) + 8px);right:10px;z-index:15;padding:6px 10px;border-radius:12px;border:1px solid #3a3320;background:#15120a;color:#cfd6cc;font:11px/1.25 -apple-system,"Hiragino Sans",sans-serif;text-align:center}' +
    '#tvgBtn b{display:block;font-size:12px;color:#ffe9a8}#tvgBtn.derby b{color:#9fe07a}#tvgBtn[hidden]{display:none}' +
    '#tvgSheet{position:fixed;inset:0;z-index:41;background:rgba(0,0,0,.78);display:flex;align-items:flex-end;justify-content:center}' +
    '#tvgSheet .card{width:100%;max-width:480px;background:#15120a;border:1px solid #c9a03e;border-bottom:0;border-radius:18px 18px 0 0;padding:18px 18px calc(var(--sab,0px) + 18px);color:#e8e3d2;font-family:-apple-system,"Hiragino Sans",sans-serif}' +
    '#tvgSheet h3{margin:0 0 4px;font-size:16px;color:#ffd773}#tvgSheet p{margin:6px 0;font-size:13px;color:#9aa89c;line-height:1.6}#tvgSheet .now{font-size:15px;color:#e8e3d2}#tvgSheet .now b{color:#ffe9a8}' +
    '#tvgSheet .two{display:flex;gap:10px;margin:12px 0}#tvgSheet .two button{flex:1;padding:16px 6px;border-radius:14px;border:1px solid #c9a03e;background:#0d0c08;color:#ffe9a8;font:700 17px/1.2 inherit}' +
    '#tvgSheet .two button.cur{background:linear-gradient(180deg,#ffe9a8,#c9a03e);color:#1a1408}#tvgSheet .two button.cur small{display:block;font-size:11px;font-weight:400}#tvgSheet .two button:disabled:not(.cur){opacity:.45}' +
    '#tvgSheet input{width:100%;box-sizing:border-box;padding:12px;font-size:22px;letter-spacing:.4em;text-align:center;border-radius:12px;border:1px solid #c9a03e;background:#0d0c08;color:#fff}' +
    '#tvgSheet .err{color:#ff8c7a;font-size:14px;min-height:18px;margin:6px 0}#tvgSheet .okm{color:#35e07a;font-size:14px;margin:6px 0}' +
    '#tvgSheet .auto{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid #2a2416;font-size:13px;color:#cfd6cc}' +
    '#tvgSheet .auto button{flex:none;white-space:nowrap}#tvgSheet .auto button,#tvgSheet .close{padding:9px 14px;border-radius:999px;border:1px solid #3a3a3a;background:#1a1a1a;color:#cfd6cc;font:inherit;font-size:13px}#tvgSheet .close{width:100%;margin-top:12px;padding:13px}';
  document.head.appendChild(css);
  const btn = document.createElement('button');
  btn.id = 'tvgBtn'; btn.type = 'button'; btn.hidden = true;
  btn.addEventListener('click', () => { state.open = true; state.msg = ''; paint(); });
  (document.getElementById('app') || document.body).appendChild(btn);

  function paintBtn() {
    const id = derbyId(), on = !!id && !!bill();
    btn.hidden = !on;
    if (!on) return;
    const g = state.game;
    btn.className = g === 'derby' ? 'derby' : '';
    btn.innerHTML = 'テレビ<b>' + (g ? NAMES[g] : '…') + '</b>';
  }
  function sheetHtml() {
    const id = derbyId(), s = bill(), g = state.game, sv = staffSaved(), needPin = !(sv && sv.store === id);
    const b = (x) => '<button type="button" data-tvg="' + x + '" class="' + (g === x ? 'cur' : '') + '"' + (g === x || state.busy || !g ? ' disabled' : '') + '>' + NAMES[x] + (g === x ? '<small>いまこちら</small>' : '') + '</button>';
    return '<div class="card"><h3>店のテレビのゲーム</h3>' +
      '<p class="now">' + esc(s ? s.name : '') + ' のテレビ: <b>' + (g ? NAMES[g] : '確認中…') + '</b></p>' +
      '<p>押すと、この店のテレビ（Fire TV）が数秒で切り替わります（ゲーム中・レース中は終わってから）。マスター画面・casa DERBY の管理画面と同じ設定です。</p>' +
      '<div class="two">' + b('slot') + b('derby') + '</div>' +
      (needPin ? '<p>切り替えには casa DERBY のスタッフ PIN（' + esc(s ? s.name : id) + '）が要ります。1 回入れると、このスマホの casa DERBY のスタッフ画面と同じく覚えます。</p><input id="tvgPin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8" placeholder="PIN">' : '') +
      (state.msg ? '<div class="' + (/^OK /.test(state.msg) ? 'okm' : 'err') + '" id="tvgMsg">' + esc(state.msg.replace(/^OK /, '')) + '</div>' : '') +
      '<div class="auto"><span>このスマホの画面も自動で入れ替える<br><small style="color:#9aa89c">casa DERBY のときは casa DERBY のスタッフ画面に</small></span><button type="button" data-tvg="auto">' + (auto() ? 'する' : 'しない') + '</button></div>' +
      '<button type="button" class="close" data-tvg="close">閉じる</button></div>';
  }
  function paint() {
    paintBtn();
    let sh = $('tvgSheet');
    if (!state.open || !derbyId()) { if (sh) sh.remove(); state.open = false; return; }
    const keep = sh && sh.querySelector('#tvgPin') ? sh.querySelector('#tvgPin').value : '';
    if (!sh) { sh = document.createElement('div'); sh.id = 'tvgSheet'; sh.addEventListener('click', onClick); document.body.appendChild(sh); }
    sh.innerHTML = sheetHtml();
    const pin = sh.querySelector('#tvgPin'); if (pin) pin.value = keep;
  }
  async function onClick(e) {
    const t = e.target.closest('[data-tvg]');
    if (!t) { if (e.target.id === 'tvgSheet' && !state.busy) { state.open = false; paint(); } return; }
    const a = t.dataset.tvg;
    if (a === 'close') { if (!state.busy) { state.open = false; paint(); } return; }
    if (a === 'auto') { lsSet(AUTO_KEY, auto() ? 'off' : null); paint(); kick(); return; }
    if (state.busy || (a !== 'slot' && a !== 'derby')) return;
    const id = derbyId(), s = bill(), sv = staffSaved(), inp = $('tvgPin');
    const pin = sv && sv.store === id ? sv.pin : (inp ? inp.value.trim() : '');
    if (!pin) { state.msg = 'casa DERBY のスタッフ PIN を入れてください。'; return paint(); }
    if (!window.confirm((s ? s.name : '') + ' のテレビを ' + NAMES[a] + ' にします。数秒で切り替わります（ゲーム中・レース中は終わってから）。')) return;
    state.busy = true; state.msg = ''; paint();
    try {
      await setGame(id, pin, a);
      if (!(sv && sv.store === id) && (!sv || sv.store === id)) lsSet(STAFF_KEY, JSON.stringify({ store: id, name: (s && s.name) || id, pin })); // casa DERBY のスタッフ画面と同じ場所に（ほかの店のログインは上書きしない）
      state.game = a; state.at = Date.now();
      state.msg = 'OK ' + (s ? s.name : '') + ' のテレビを ' + NAMES[a] + ' にしました。';
    } catch (err) {
      state.msg = err.message;
      if (err.code === 'bad_pin' && sv && sv.store === id) { lsSet(STAFF_KEY, null); state.msg = 'casa DERBY のスタッフ PIN が変わっています。新しい PIN を入れてください。'; } // casa DERBY のスタッフ画面と同じく、古い PIN は忘れる
    }
    state.busy = false; paint(); kick();
  }

  /* ---------- 店の設定を見張る → スマホの画面の入れ替え ---------- */
  let lastTouch = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { capture: true, passive: true }));
  function looping() { let l = []; try { l = JSON.parse(lsGet(LOG_KEY) || '[]'); } catch (e) { l = []; } const now = Date.now(); return l.filter((x) => now - x < LOOP_MS).length >= LOOP_N; }
  function mark() { let l = []; try { l = JSON.parse(lsGet(LOG_KEY) || '[]'); } catch (e) { l = []; } l.push(Date.now()); lsSet(LOG_KEY, JSON.stringify(l.slice(-LOOP_N * 3))); }
  let ready = null;
  async function derbyReady() { // casa DERBY のスタッフ画面が置いてあり、入れ替えに対応している（古い版のときは移らない）
    if (ready === true) return true;
    try { const r = await fetch('derby/v2/staff.html?t=' + Date.now(), { cache: 'no-store' }); ready = r.ok && /staffswitch\.js/.test(await r.text()); } catch (e) { ready = false; }
    return ready;
  }
  let timer = 0;
  function kick(ms) { clearTimeout(timer); timer = setTimeout(maybeGo, ms == null ? 300 : ms); }
  async function maybeGo() {
    const id = derbyId();
    state.id = id; state.waiting = false;
    if (!id || state.leaving || state.game !== 'derby') { state.why = !id ? 'no store' : state.game !== 'derby' ? 'slot' : ''; return; }
    if (!auto()) { state.why = 'auto off'; return; }
    if (looping()) { state.why = 'loop'; return kick(60000); }
    const quiet = Date.now() - lastTouch >= QUIET_MS;
    if (state.open || state.busy || !quiet || !window.BillPage.idle() || document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { state.waiting = true; state.why = 'busy'; return kick(RETRY_MS); }
    if (!(await derbyReady())) { state.why = 'no derby staff'; return kick(POLL_MS); }
    if (state.game !== 'derby' || !window.BillPage.idle()) return kick(RETRY_MS);
    state.leaving = true; state.why = 'go'; mark();
    location.href = 'derby/v2/staff.html?store=' + encodeURIComponent(id) + '&via=slot';
  }
  let lastDoc = null;
  function onDoc(doc) {
    lastDoc = doc;
    const id = derbyId(); state.id = id; if (!id) return paintBtn();
    state.game = T.gameOf(doc, id); state.at = Date.now();
    paint(); kick();
  }
  T.watch(onDoc);
  // 変更の通知が使えないとき（SDK を読めない・つながらない）は 30 秒ごとに 1 回読む
  setInterval(async () => { if (T.live.on || !derbyId()) return; const d = await T.readDoc(); if (d) onDoc(d); }, POLL_MS);
  setTimeout(async () => { if (!T.live.on && derbyId()) { const d = await T.readDoc(); if (d) onDoc(d); } }, 3000);
  setInterval(() => { if (lastDoc && derbyId() !== state.id) onDoc(lastDoc); else paintBtn(); }, 2000); // ログイン・店舗の切り替えのあと
  window.PhoneSwitch = { state, derbyId, open() { state.open = true; paint(); }, maybeGo };
})();
