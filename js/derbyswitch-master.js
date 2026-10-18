/* casa SLOT マスター → 店のテレビのゲーム（casa SLOT / casa DERBY）を切り替える（2026-10-18）
   casa DERBY の管理画面の「テレビのゲーム」と同じ値を書く: casa DERBY の Firebase（casa-derby）の
     derbyStores/<店舗ID>.settings.tvGame（管理画面が見る元の値）と derbySwitch/tv.<店舗ID>（テレビが読む写し）を 1 回の書き込み（commit）で。
   - 書けるのは casa DERBY のマスター（rhtcinema@gmail.com）だけ（casa-derby のルール）。オーナーがこの画面の小さな入力欄に casa DERBY のパスワードを
     その場で入れてログインする（REST。パスワードも鍵も端末に保存しない。ログインはこのページを開いている間だけ）。
   - casa SLOT のクラウド（casa-ruretto）・SDK・cloud.js とは別（Firebase の SDK は読まない。fetch だけ）
   - 読むのはログインなしで読める derbySwitch/tv だけ（一覧に今の値を出す）
   - 店舗の対応は js/tvswitch.js と同じ: 店舗名に 渋谷 → shibuya、上野 → ueno、札幌 → sapporo
   - テスト用: localhost のときだけ ?derbyApi=<URL> で Google の 2 つの入口（ログインと Firestore）を差し替えられる（sessionStorage に覚える） */
(function () {
  'use strict';
  const KEY = 'AIzaSyDuElvskkcKBs4XisXjTe7-mSxjq3KuswA', PROJECT = 'casa-derby', EMAIL = 'rhtcinema@gmail.com';
  const MAP = [[/渋谷/, 'shibuya'], [/上野/, 'ueno'], [/札幌/, 'sapporo']];
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  let stub = null;
  if (LOCAL) {
    const m = /[?&]derbyApi=([^&#]*)/.exec(location.search);
    try { if (m) { stub = decodeURIComponent(m[1]); sessionStorage.setItem('casa.derbyApi', stub); } else stub = sessionStorage.getItem('casa.derbyApi'); } catch (e) { /* noop */ }
  }
  const AUTH = (stub || 'https://identitytoolkit.googleapis.com') + '/v1/accounts:signInWithPassword?key=' + KEY;
  const TOKEN = (stub || 'https://securetoken.googleapis.com') + '/v1/token?key=' + KEY;
  const DB = 'projects/' + PROJECT + '/databases/(default)/documents';
  const FS = (stub || 'https://firestore.googleapis.com') + '/v1/' + DB;
  const NAMES = { slot: 'casa SLOT', derby: 'casa DERBY' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const derbyIdOf = (name) => { const hit = MAP.find(([re]) => re.test(name || '')); return hit ? hit[1] : null; };

  let sess = null; // { idToken, refreshToken, exp }（メモリだけ）
  let doc = null, docErr = '', loading = null, busy = false, msg = '', host = null, ctx = null, lastView = '';

  async function readDoc() {
    try {
      const r = await fetch(FS + '/derbySwitch/tv?key=' + KEY, { cache: 'no-store', credentials: 'omit' });
      if (r.status === 404) { doc = {}; docErr = ''; return; }
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json(), o = {};
      Object.keys((j && j.fields) || {}).forEach((k) => { o[k] = j.fields[k].stringValue === 'derby' ? 'derby' : 'slot'; });
      doc = o; docErr = '';
    } catch (e) { docErr = '今の設定を読めませんでした（' + e.message + '）'; }
  }
  async function login(pw) {
    const r = await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: pw, returnSecureToken: true }), credentials: 'omit' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.idToken) throw new Error('ログインできませんでした。casa DERBY のパスワードを確認してください。');
    if (String(j.email || '').toLowerCase() !== EMAIL) throw new Error('casa DERBY のマスターのアカウントではありません。');
    sess = { idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + (Number(j.expiresIn) || 3600) * 1000 - 60000 };
  }
  async function token() {
    if (!sess) throw new Error('casa DERBY にログインしてください。');
    if (Date.now() < sess.exp) return sess.idToken;
    const r = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(sess.refreshToken), credentials: 'omit' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id_token) { sess = null; throw new Error('ログインの期限が切れました。もう一度ログインしてください。'); }
    sess = { idToken: j.id_token, refreshToken: j.refresh_token || sess.refreshToken, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000 };
    return sess.idToken;
  }
  /* casa DERBY の管理画面の店舗の保存と同じ 2 か所を、1 回の commit で（片方だけ書かれることはない）。店舗が無いときは何も書かない */
  async function setGame(id, game) {
    const t = await token(), v = { stringValue: game === 'derby' ? 'derby' : 'slot' };
    const body = { writes: [
      { update: { name: DB + '/derbyStores/' + id, fields: { settings: { mapValue: { fields: { tvGame: v } } } } }, updateMask: { fieldPaths: ['settings.tvGame'] }, currentDocument: { exists: true } },
      { update: { name: DB + '/derbySwitch/tv', fields: { [id]: v } }, updateMask: { fieldPaths: [id] } },
    ] };
    const r = await fetch(FS + ':commit', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(body), credentials: 'omit' });
    if (r.ok) return;
    const j = await r.json().catch(() => ({})), st = (j.error && j.error.status) || '';
    if (r.status === 404 || st === 'NOT_FOUND') throw new Error('casa DERBY に店舗「' + id + '」がありません。casa DERBY の管理画面で店舗を確認してください。');
    if (r.status === 401) { sess = null; throw new Error('ログインの期限が切れました。もう一度ログインしてください。'); }
    if (r.status === 403) throw new Error('書き込みが許可されませんでした（casa DERBY のマスターのアカウントか、ルールを確認してください）。');
    throw new Error('保存できませんでした（' + r.status + '）。');
  }

  /* ---------- 画面 ---------- */
  const rowsFor = (stores) => stores.map((s) => ({ name: s.name, id: derbyIdOf(s.name) }));
  function rowHtml(r) {
    if (!r.id) return '<div class="item"><div class="name">' + esc(r.name) + '<small>casa DERBY の店舗がありません（店舗名に 渋谷・上野・札幌 のどれかが入っている店だけ切り替えられます）</small></div><span class="chip">casa SLOT のまま</span></div>';
    const cur = doc ? (doc[r.id] || 'slot') : null;
    const b = (g) => cur === g
      ? '<button class="btn sm" aria-pressed="true" style="pointer-events:none" tabindex="-1">' + NAMES[g] + '</button>' /* 今の値: はっきり見せる（押しても何もしない） */
      : '<button class="btn sm ghost" data-dsw="set" data-id="' + esc(r.id) + '" data-name="' + esc(r.name) + '" data-g="' + g + '"' + (!sess || busy ? ' disabled' : '') + '>' + NAMES[g] + '</button>';
    return '<div class="item"><div class="name">' + esc(r.name) + '<small>casa DERBY の店舗 ' + esc(r.id) + '｜いま: ' + (cur ? '<b style="color:' + (cur === 'derby' ? 'var(--gold)' : 'var(--text)') + '">' + NAMES[cur] + '</b>' : '確認中…') + '</small></div>' + b('slot') + b('derby') + '</div>';
  }
  function loginHtml() {
    if (sess) return '<p class="hint">casa DERBY に <b style="color:var(--text)">' + EMAIL + '</b> でログイン中（このページを閉じるまで）。 <button class="btn sm ghost" data-dsw="logout">ログアウト</button></p>';
    return '<div class="panel" style="margin:10px 0;background:#111115"><h3 style="font-size:14px">casa DERBY にログイン（切り替えるときだけ）</h3><p class="hint">切り替えには casa DERBY のマスター（' + EMAIL + '）のパスワードが要ります。この画面にも端末にも保存しません。</p>' +
      '<div style="display:flex;gap:8px;align-items:center"><input type="password" id="dswPw" autocomplete="off" placeholder="casa DERBY のパスワード" style="flex:1"><button class="btn" data-dsw="login"' + (busy ? ' disabled' : '') + '>ログイン</button></div></div>';
  }
  function panelHtml(stores) {
    return '<div class="panel" id="dswPanel"><h3>テレビのゲーム（casa SLOT / casa DERBY）</h3><p class="hint">店のテレビ（Fire TV）に映すゲームです。casa DERBY の管理画面の「テレビのゲーム」と同じ設定で、どちらで変えても同じになります。切り替えると数秒でその店のテレビが変わります（ゲーム中・レース中は終わってから）。スタッフのスマホ（紙幣のページ・casa DERBY のスタッフ画面）の「テレビ」からも、その店だけ切り替えられます。テレビの設定画面で「このテレビのゲーム」を固定しているテレビは、そちらが優先されます。</p>' +
      loginHtml() + (docErr ? '<div class="err">' + esc(docErr) + '</div>' : '') +
      '<div class="list">' + rowsFor(stores).map(rowHtml).join('') + '</div>' +
      (msg ? '<div class="' + (/^OK /.test(msg) ? 'okmsg' : 'err') + '" id="dswMsg">' + esc(msg.replace(/^OK /, '')) + '</div>' : '') + '</div>';
  }
  function paint() {
    if (!host || !host.isConnected || !ctx) return;
    const old = host.querySelector('#dswPanel'), keep = old && old.querySelector('#dswPw') ? old.querySelector('#dswPw').value : '';
    const html = ctx.edit ? (ctx.edit.name ? panelHtml([ctx.edit]) : '') : panelHtml(ctx.stores || []);
    if (!html) { if (old) old.remove(); return; }
    const box = document.createElement('div'); box.innerHTML = html; const panel = box.firstChild;
    if (old) old.replaceWith(panel);
    else if (ctx.edit) { const sel = host.querySelector('#sactive'), lab = sel && sel.closest('label'); if (lab) lab.after(panel); else host.appendChild(panel); }
    else { const first = host.querySelector('.panel'); if (first) first.after(panel); else host.appendChild(panel); }
    const pw = panel.querySelector('#dswPw');
    if (pw) { pw.value = keep; pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onAct('login'); } }); }
  }
  async function onAct(act, b) {
    if (busy) return;
    msg = '';
    if (act === 'login') {
      const inp = host.querySelector('#dswPw'), pw = inp ? inp.value : '';
      if (!pw) { msg = 'パスワードを入力してください。'; return paint(); }
      if (inp) inp.value = '';
      busy = true; paint();
      try { await login(pw); msg = 'OK casa DERBY にログインしました。'; } catch (e) { msg = e.message; }
      const now = host.querySelector('#dswPw'); if (now) now.value = ''; // 待つ間に描き直しているので、今の入力欄を空にする
      busy = false; await readDoc(); return paint();
    }
    if (act === 'logout') { sess = null; return paint(); }
    if (act === 'set') {
      const id = b.dataset.id, g = b.dataset.g === 'derby' ? 'derby' : 'slot';
      if (!window.confirm(b.dataset.name + ' のテレビを ' + NAMES[g] + ' にします。数秒で切り替わります（ゲーム中・レース中は終わってから）。')) return;
      busy = true; paint();
      try { await setGame(id, g); msg = 'OK ' + b.dataset.name + ' のテレビを ' + NAMES[g] + ' にしました。'; } catch (e) { msg = e.message; }
      busy = false; await readDoc(); return paint();
    }
  }
  /* master.js の render() のあとに呼ばれる。店舗の一覧（全店舗）と店舗の編集（その店だけ）に出す。店舗のタブ以外では何もしない */
  function mount(main, c) {
    host = main; ctx = c && c.tab === 'stores' ? c : null;
    if (!ctx) return;
    if (ctx.edit && !ctx.edit.id) { ctx = null; return; } // 新しい店舗（まだ保存していない）には出さない
    const view = ctx.edit ? 'edit:' + ctx.edit.id : 'list';
    if (view !== lastView) { msg = ''; lastView = view; } // 画面を変えたら前の知らせは消す
    if (!main.__dsw) { main.__dsw = true; main.addEventListener('click', (e) => { const b = e.target.closest('[data-dsw]'); if (b && host && host.contains(b)) onAct(b.dataset.dsw, b); }); }
    paint();
    if (!doc && !loading) loading = readDoc().then(() => { loading = null; paint(); });
  }
  window.DerbySwitchMaster = { mount, state: () => ({ loggedIn: !!sess, doc, docErr, busy, msg }) };
})();
