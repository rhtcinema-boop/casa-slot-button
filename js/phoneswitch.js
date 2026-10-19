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
   - テレビの画質（2026-10-19）: 同じシートに「なめらか優先・標準・きれい優先」（casa-derby の derbyStores/<店舗ID>.settings.tvQuality = 'auto' | '' | 'max'）。
     今の値はシートを開いたときに 1 回だけ読む（匿名のログインで読める）。書くのは上と同じ casa DERBY のスタッフ PIN で、tvQuality だけ（ルールの tvQualityOnly）。
     casa DERBY のテレビが 1 分ほどで読み込み直して反映する（レース中は終わってから。derby/v2/tvswitch.js）
   - 2026-10-19 その 2（オーナー「スタッフ画面でスロットと競馬を切り替えれるようにしたい」）:
     左上に「スロット ｜ 競馬」のタブ（v2/staffswitch.js と同じ見た目。今いる方が銀）。「競馬」で casa DERBY のスタッフ画面へ（自動の入れ替えと同じ行き先）。
     紙幣の手続きの途中（BillPage.idle() が false）なら、画面の中の確認の窓を出してから。対応する店が無いときはタブを出さない。
     手で移ったら localStorage 'casa.phoneSwitchManual' = { store, game: 移ったときの店のゲーム, to, at } を残し、店のゲームがそれと同じあいだは
     自動で入れ替えない（両方の画面で同じ決まり）。店のゲームが変わったら記録を消して今までどおり。手で移った分は行ったり来たりの回数に数えない。
     シートの「今すぐ casa DERBY のスタッフ画面へ」はタブと同じ役目なので消した（タブはいつも見えていて、途中の確認も同じ）。
   - 2026-10-19 その 2（オーナー「すぐテストレースを走らせるみたいなボタン」）: シートに「テストレースを今すぐ走らせる」。
     casa DERBY のスタッフ画面の「この店だけテストレース」と同じお願い（derbyTestReq/<店舗ID> = { at: サーバーの時刻, by: 自分, startIn: 60 }。ルールは今のまま）を、
     上と同じ casa DERBY のスタッフ PIN で書く。進行役のテレビが 1 分後（参加受付 30 秒 → 投票 30 秒）のその店だけのレースを作る。
     押せないときの理由: 進行役のテレビ（derbyLock/decider の期限）・受付中・レース中・もうすぐ次のレース（derbyLive/<店舗ID> のレース）・準備中・発走まで
   - テスト用: localhost のときだけ ?derbyApi=<URL> で Google の入口（ログインと Firestore）を差し替える（js/derbyswitch-master.js と同じ） */
(function () {
  'use strict';
  const T = window.SlotTvSwitch;
  if (!T || !window.BillPage) return;
  const KEY = 'AIzaSyDuElvskkcKBs4XisXjTe7-mSxjq3KuswA', DB = 'projects/casa-derby/databases/(default)/documents';
  const STAFF_KEY = 'casa.derby.staff.v1', AUTO_KEY = 'casa.phoneSwitch', LOG_KEY = 'casa.phoneSwitchLog', MAN_KEY = 'casa.phoneSwitchManual';
  const TEST_SEC = 60; // テストレース: 押してから発走まで（ルールの下限。casa DERBY の core.js TEST_RACE.quickSec と同じ）
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
  const QS3 = [['auto', 'なめらか優先', '重いときは自動で少し粗くして、動きをなめらかに'], ['', '標準', 'ふだんはこれ。細かさはそのまま'], ['max', 'きれい優先', '影までくっきり。動きがカクカクすることがあります']];
  const QN = { auto: 'なめらか優先', '': '標準', max: 'きれい優先' };
  const qNorm = (v) => (v === 'auto' || v === 'max' ? v : '');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* noop */ } };
  const state = { id: null, game: null, at: 0, busy: false, msg: '', open: false, waiting: false, leaving: false, why: '', q: undefined, qId: null, qmsg: '', qLoading: false };

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

  /* テレビの画質（2026-10-19）: 今の値を 1 回読む（匿名のログインで。店舗の設定はログインした人なら読める）／スタッフとして tvQuality だけ書く */
  async function readQuality(id) {
    const s = await signIn();
    const r = await fetch(FS + '/derbyStores/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + s.idToken }, credentials: 'omit', cache: 'no-store' });
    if (r.status === 401) { sess = null; throw new Error('expired'); }
    if (!r.ok) throw new Error('read ' + r.status);
    const j = await r.json().catch(() => ({})), f = j && j.fields && j.fields.settings && j.fields.settings.mapValue && j.fields.settings.mapValue.fields;
    return qNorm(f && f.tvQuality && f.tvQuality.stringValue);
  }
  async function setQuality(id, pin, q) {
    const s = await asStaff(id, pin);
    const { r } = await post(FS + ':commit', { writes: [
      { update: { name: DB + '/derbyStores/' + id, fields: { settings: { mapValue: { fields: { tvQuality: { stringValue: qNorm(q) } } } } } }, updateMask: { fieldPaths: ['settings.tvQuality'] }, currentDocument: { exists: true } },
    ] }, s.idToken);
    if (r.ok) return;
    if (r.status === 404) throw new Error('casa DERBY に店舗「' + id + '」がありません。');
    if (r.status === 401) { sess = null; throw new Error('ログインの期限が切れました。もう一度押してください。'); }
    if (r.status === 403) { if (sess) sess.staff = ''; const e = new Error('書き込みが許可されませんでした。もう一度押しても同じときは、casa DERBY の管理画面から変えてください。'); e.code = 'denied'; throw e; }
    throw new Error('保存できませんでした（' + r.status + '）。');
  }
  async function loadQuality() { // シートを開いたとき 1 回
    const id = derbyId(); if (!id || state.qLoading) return;
    state.qLoading = true; if (state.qId !== id) { state.q = undefined; state.qId = id; }
    try { state.q = await readQuality(id); } catch (e) { state.q = state.q === undefined ? null : state.q; } // null ＝読めなかった（押せば書ける）
    state.qLoading = false; if (state.open) paint();
  }

  /* ---------- この店だけテストレース（2026-10-19 その 2）。casa DERBY のスタッフ画面と同じお願いを REST で ---------- */
  function fv(v) { // Firestore の REST の値 → ふつうの値
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return Number(v.integerValue); if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue; if ('timestampValue' in v) return Date.parse(v.timestampValue);
    if ('mapValue' in v) { const o = {}, f = v.mapValue.fields || {}; Object.keys(f).forEach((k) => { o[k] = fv(f[k]); }); return o; }
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fv);
    return null;
  }
  async function getDoc(path) { // 1 件読む（無ければ null）
    const s = await signIn();
    const r = await fetch(FS + '/' + path, { headers: { Authorization: 'Bearer ' + s.idToken }, credentials: 'omit', cache: 'no-store' });
    if (r.status === 404) return null;
    if (r.status === 401) { sess = null; throw new Error('expired'); }
    if (!r.ok) throw new Error('read ' + r.status);
    const j = await r.json().catch(() => ({}));
    return fv({ mapValue: { fields: (j && j.fields) || {} } });
  }
  const tr = { decider: undefined, races: [], pub: {}, req: null, msg: '', id: null, t: 0 };
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
  async function loadTest(reqOnly) { // シートを開いたとき（進行役・店のレース・お願い）／押したあと（お願いだけ）
    const id = derbyId(); if (!id) return;
    if (tr.id !== id) { Object.assign(tr, { decider: undefined, races: [], pub: {}, req: null, msg: '', id }); }
    try {
      if (!reqOnly) {
        const [lock, live] = await Promise.all([getDoc('derbyLock/decider'), getDoc('derbyLive/' + encodeURIComponent(id))]);
        tr.decider = !!(lock && Number(lock.until) > Date.now());
        tr.races = (live && Array.isArray(live.races) ? live.races : []); tr.pub = (live && live.pub) || {};
      }
      const sv = staffSaved();
      if (sv && sv.store === id) { // お願いは、その店のスタッフだけが読める（ルールの staffOf）
        await asStaff(id, sv.pin).catch(() => null);
        const q = await getDoc('derbyTestReq/' + encodeURIComponent(id)).catch(() => null);
        tr.req = q ? { at: num(q.at, 0), startIn: q.startIn, raceId: q.raceId || null, raceAt: q.raceAt || null, err: q.err || null } : null;
      }
    } catch (e) { if (tr.decider === undefined) tr.decider = null; } // null ＝読めなかった
    tr.t = Date.now(); paintTest();
    const r = tr.req, pending = r && !r.raceId && !r.err && Date.now() - r.at < 60000;
    clearTimeout(loadTest.h);
    if (state.open && pending) loadTest.h = setTimeout(() => loadTest(true), 3000); // 準備中は 3 秒ごと（シートを開いている間だけ）
    else if (state.open && r && r.raceId && !tr.races.some((x) => x.id === r.raceId)) loadTest.h = setTimeout(() => loadTest(false), 1500); // できたレースを店のレースの一覧に
  }
  function clash(n) { // 押すと、店のレース（受付の始まり〜結果画面の終わり）とぶつかる？（core.js の testRaceBusy と同じ考え方。時刻表のレースは進行役が 15 分先まで作ってある）
    const P = tr.pub || {}, gate = P.scenes && P.scenes.gate === false ? 0 : num(P.gateSec, 8), post = num(P.postSec, 28), res = num(P.resultSec, 300), ex = num(P.exchangeSec, 90), vo = num(P.voteSec, 30);
    const end = n + (TEST_SEC + gate + 60 + post + res) * 1000;
    for (const r of tr.races || []) {
      if (!r || r.status === 'void') continue;
      const s = r.openAt != null ? r.openAt : r.at - (ex + vo) * 1000;
      const e = r.endAt || (r.revealAt ? r.revealAt + res * 1000 : (r.runAt || r.at) + 60000 + (post + res) * 1000);
      if (s < end && e > n) return s <= n ? 'now' : r;
    }
    return null;
  }
  function trWhy() { // [いまの文, 押せない]
    const n = Date.now(), r = tr.req;
    if (tr.decider === undefined) return ['確認中…', true];
    if (r && !r.raceId && !r.err && n - r.at < 60000) return ['準備中…（進行役のテレビがレースを作っています）', true];
    if (r && r.raceAt && r.raceAt > n) return ['テストのレース 発走まで ' + mmss(r.raceAt - n), true];
    if (tr.decider === null) return ['casa DERBY の状態を読めませんでした。閉じて開き直してください', true];
    if (!tr.decider) return ['進行役のテレビがありません', true];
    const c = clash(n);
    if (c === 'now') return ['受付中・レース中は押せません', true];
    if (c) return ['もうすぐ次のレース（' + hhmm(c.at) + ' 発走）があるので押せません', true];
    if (r && r.err === 'busy' && n - r.at < 120000) return ['作れませんでした（もうすぐ次のレースです）', true];
    return [tr.msg, false];
  }
  const pad2 = (x) => ('0' + x).slice(-2);
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + pad2(s % 60); };
  const hhmm = (ms) => { const d = new Date(Number(ms) + 9 * 3600e3); return d.getUTCHours() + ':' + pad2(d.getUTCMinutes()); }; // いつも日本時間
  async function onTest() {
    if (state.busy) return;
    const [, off] = trWhy(); if (off) return;
    const id = derbyId(), s = bill(), sv = staffSaved(), inp = $('tvgPin');
    const pin = sv && sv.store === id ? sv.pin : (inp ? inp.value.trim() : '');
    if (!pin) { tr.msg = 'casa DERBY のスタッフ PIN を入れてください（上の欄）。'; return paint(); }
    if (!window.confirm((s ? s.name : '') + ' のテレビだけで、1 分後にテストのレースが走ります（参加受付 30 秒 → 投票 30 秒 → 発走）。\n集計には入りません。' + (state.game === 'slot' ? '\nいまテレビは casa SLOT です。テレビで見るには casa DERBY にしてください。' : ''))) return;
    state.busy = true; tr.msg = ''; paint();
    try {
      const ss = await asStaff(id, pin);
      const { r } = await post(FS + ':commit', { writes: [{ update: { name: DB + '/derbyTestReq/' + id, fields: { by: { stringValue: ss.uid }, startIn: { integerValue: String(TEST_SEC) } } }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }] }] }, ss.idToken);
      if (r.status === 401) { sess = null; throw new Error('ログインの期限が切れました。もう一度押してください。'); }
      if (r.status === 403) throw new Error('少し待ってからもう一度押してください（前のお願いから 3 分たっていません）。');
      if (!r.ok) throw new Error('お願いできませんでした（' + r.status + '）。');
      if (!(sv && sv.store === id) && (!sv || sv.store === id)) lsSet(STAFF_KEY, JSON.stringify({ store: id, name: (s && s.name) || id, pin })); // テレビのゲームと同じく覚える
      tr.req = { at: Date.now(), startIn: TEST_SEC, raceId: null, raceAt: null, err: null };
    } catch (err) {
      tr.msg = err.message;
      if (err.code === 'bad_pin' && sv && sv.store === id) { lsSet(STAFF_KEY, null); tr.msg = 'casa DERBY のスタッフ PIN が変わっています。新しい PIN を入れてください。'; }
    }
    state.busy = false; paint(); if (tr.req && !tr.req.raceId) setTimeout(() => loadTest(true), 1500);
  }
  function trHtml() {
    const [t, off] = trWhy();
    return '<div class="tr" id="trBox"><h4>テストレース<small>この店のテレビだけ・集計に入りません</small></h4>' +
      '<p class="now" id="trNow">' + esc(t || '押すと 1 分後に発走します（参加受付 30 秒 → 投票 30 秒）') + '</p>' +
      (state.game === 'slot' ? '<p class="warn">いまテレビは casa SLOT です。テレビで見るには、先に上で casa DERBY にしてください。</p>' : '') +
      '<button type="button" class="go" data-tvg="test"' + (off || state.busy ? ' disabled' : '') + '>テストレースを今すぐ走らせる</button></div>';
  }
  function paintTest() { const b = $('trBox'); if (b && state.open) { const h = trHtml(); if (b.outerHTML !== h) b.outerHTML = h; } }

  /* ---------- 手で移った記録（2026-10-19 その 2。casa DERBY のスタッフ画面 v2/staffswitch.js と同じ決まり・同じ場所） ---------- */
  function manualGet() { try { const j = JSON.parse(lsGet(MAN_KEY)); return j && j.store ? j : null; } catch (e) { return null; } }
  function manualHold(id, game) { // true ＝手で移ったあと、店のゲームがまだ同じ（自動で入れ替えない）
    const m = manualGet(); if (!m) return false;
    if (m.store !== id) { lsSet(MAN_KEY, null); return false; } // ほかの店の記録は消す
    if (!game) return true;
    if (m.game == null) { m.game = game; lsSet(MAN_KEY, JSON.stringify(m)); return true; } // 移ったときに店のゲームがまだ分からなかった → 最初に分かった値を「そのときのゲーム」に
    if (m.game === game) return true;
    lsSet(MAN_KEY, null); return false; // 店のゲームが変わった → 今までどおり自動で
  }

  /* ---------- 「スロット ｜ 競馬」のタブ（2026-10-19 その 2） ---------- */
  const GT_CSS = '#gameTabs{position:absolute;top:calc(var(--sat,0px) + 5px);left:10px;z-index:15;display:flex;gap:2px;padding:2px;border-radius:12px;border:1px solid #3a3a42;background:#101012;font:700 13px/1 -apple-system,"Hiragino Sans",sans-serif}' +
    '#gameTabs[hidden]{display:none}#gameTabs button{height:34px;min-width:46px;padding:0 8px;border:0;border-radius:9px;background:transparent;color:#cfd6cc;font:inherit;letter-spacing:.02em;white-space:nowrap}' +
    '#gameTabs button.cur{background:#d9dce3;color:#1a1d24}@media (max-width:389px){#gameTabs{font-size:12px}#gameTabs button{padding:0 7px;min-width:42px}}' +
    '#gtAsk{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:24px}' +
    '#gtAsk .card{width:100%;max-width:360px;box-sizing:border-box;background:#15120a;border:1px solid #c9a03e;border-radius:16px;padding:18px;color:#e8e3d2;font-family:-apple-system,"Hiragino Sans",sans-serif}' +
    '#gtAsk h3{margin:0 0 8px;font-size:17px;color:#ffd773}#gtAsk p{margin:0 0 16px;font-size:15px;line-height:1.6;color:#cfd6cc}#gtAsk .row{display:flex;gap:10px}' +
    '#gtAsk button{flex:1;min-height:50px;border-radius:12px;font:inherit;font-size:16px}#gtAsk [data-gt="no"]{border:1px solid #3a3a42;background:#1a1a1a;color:#cfd6cc}' +
    '#gtAsk [data-gt="yes"]{border:1px solid #a57c26;background:linear-gradient(#f3d27a,#c99a3a);color:#1a1205;font-weight:800}';
  const tabs = document.createElement('div');
  tabs.id = 'gameTabs'; tabs.hidden = true; tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = '<button type="button" role="tab" data-gt="slot" class="cur" aria-selected="true">スロット</button><button type="button" role="tab" data-gt="derby" aria-selected="false">競馬</button>';
  function ask(title, text) { // 画面の中の確認の窓（ブラウザの確認は写真に写らない・見た目をそろえる）
    return new Promise((res) => {
      const old = $('gtAsk'); if (old) old.remove();
      const w = document.createElement('div'); w.id = 'gtAsk';
      w.innerHTML = '<div class="card" role="dialog" aria-modal="true"><h3>' + esc(title) + '</h3><p>' + text + '</p><div class="row"><button type="button" data-gt="no">やめる</button><button type="button" data-gt="yes">移る</button></div></div>';
      w.addEventListener('click', (e) => { const b = e.target.closest('[data-gt]'); if (!b && e.target !== w) return; w.remove(); res(!!b && b.dataset.gt === 'yes'); });
      document.body.appendChild(w);
    });
  }
  tabs.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-gt]'); if (!b || b.dataset.gt !== 'derby') return; // 今いる方（スロット）は何もしない
    const id = derbyId(); if (!id || state.leaving) return;
    if (!window.BillPage.idle() && !(await ask('紙幣の手続きの途中です', '手続きはここで止まります。<br>競馬（casa DERBY）のスタッフ画面へ移りますか？'))) return;
    if (state.leaving || derbyId() !== id) return;
    lsSet(MAN_KEY, JSON.stringify({ store: id, game: state.game || null, to: 'derby', at: Date.now() })); // 手で移った（行ったり来たりの回数には数えない）
    state.leaving = true; state.open = false; paint();
    location.href = 'derby/v2/staff.html?store=' + encodeURIComponent(id) + '&via=slot';
  });

  /* ---------- 画面（右上のボタンと、開いたときのシート） ---------- */
  const css = document.createElement('style');
  css.textContent = '#tvgBtn{position:absolute;top:calc(var(--sat,0px) + 8px);right:10px;z-index:15;padding:6px 10px;border-radius:12px;border:1px solid #3a3320;background:#15120a;color:#cfd6cc;font:11px/1.25 -apple-system,"Hiragino Sans",sans-serif;text-align:center}' +
    '#tvgBtn b{display:block;font-size:12px;color:#ffe9a8}#tvgBtn.derby b{color:#9fe07a}#tvgBtn[hidden]{display:none}' +
    '#tvgSheet{position:fixed;inset:0;z-index:41;background:rgba(0,0,0,.78);display:flex;align-items:flex-end;justify-content:center}' +
    '#tvgSheet .card{width:100%;max-width:480px;max-height:92vh;overflow-y:auto;box-sizing:border-box;background:#15120a;border:1px solid #c9a03e;border-bottom:0;border-radius:18px 18px 0 0;padding:18px 18px calc(var(--sab,0px) + 18px);color:#e8e3d2;font-family:-apple-system,"Hiragino Sans",sans-serif}' +
    '#tvgSheet h3{margin:0 0 4px;font-size:16px;color:#ffd773}#tvgSheet p{margin:6px 0;font-size:13px;color:#9aa89c;line-height:1.6}#tvgSheet .now{font-size:15px;color:#e8e3d2}#tvgSheet .now b{color:#ffe9a8}' +
    '#tvgSheet .two{display:flex;gap:10px;margin:12px 0}#tvgSheet .two button{flex:1;padding:16px 6px;border-radius:14px;border:1px solid #c9a03e;background:#0d0c08;color:#ffe9a8;font:700 17px/1.2 inherit}' +
    '#tvgSheet .two button.cur{background:linear-gradient(180deg,#ffe9a8,#c9a03e);color:#1a1408}#tvgSheet .two button.cur small{display:block;font-size:11px;font-weight:400}#tvgSheet .two button:disabled:not(.cur){opacity:.45}' +
    '#tvgSheet input{width:100%;box-sizing:border-box;padding:12px;font-size:22px;letter-spacing:.4em;text-align:center;border-radius:12px;border:1px solid #c9a03e;background:#0d0c08;color:#fff}' +
    '#tvgSheet .tq{margin-top:12px;padding-top:12px;border-top:1px solid #2a2416}#tvgSheet .tq h4{margin:0;font-size:15px;color:#ffd773}#tvgSheet .tq h4 small{font-weight:400;font-size:12px;color:#9aa89c;margin-left:6px}' +
    '#tvgSheet .three{display:flex;flex-direction:column;gap:8px;margin:10px 0 4px}#tvgSheet .three button{display:block;width:100%;text-align:left;padding:10px 14px;border-radius:12px;border:1px solid #6b5626;background:#0d0c08;color:#ffe9a8;font:inherit}' +
    '#tvgSheet .three button b{display:block;font-size:15px}#tvgSheet .three button small{display:block;font-size:12px;color:#9aa89c;margin-top:2px;line-height:1.45}#tvgSheet .three button i{float:right;font-style:normal;font-size:11px;margin-top:2px}' +
    '#tvgSheet .three button.cur{background:linear-gradient(180deg,#ffe9a8,#c9a03e);border-color:#c9a03e;color:#1a1408}#tvgSheet .three button.cur small{color:#3a2d10}#tvgSheet .three button:disabled:not(.cur){opacity:.45}' +
    '#tvgSheet .err{color:#ff8c7a;font-size:14px;min-height:18px;margin:6px 0}#tvgSheet .okm{color:#35e07a;font-size:14px;margin:6px 0}' +
    '#tvgSheet .go{display:block;width:100%;margin-top:12px;padding:13px 14px;border-radius:12px;border:1px solid #a57c26;background:linear-gradient(#f3d27a,#c99a3a);color:#1a1205;font:inherit;font-weight:800;font-size:15px}' +
    '#tvgSheet .auto{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid #2a2416;font-size:13px;color:#cfd6cc}' +
    '#tvgSheet .auto button{flex:none;white-space:nowrap}#tvgSheet .auto button,#tvgSheet .close{padding:9px 14px;border-radius:999px;border:1px solid #3a3a3a;background:#1a1a1a;color:#cfd6cc;font:inherit;font-size:13px}#tvgSheet .close{width:100%;margin-top:12px;padding:13px}';
  css.textContent += GT_CSS + '#tvgSheet .tr{margin-top:12px;padding-top:12px;border-top:1px solid #2a2416}#tvgSheet .tr h4{margin:0;font-size:15px;color:#ffd773}#tvgSheet .tr h4 small{font-weight:400;font-size:12px;color:#9aa89c;margin-left:6px}#tvgSheet .tr .warn{color:#ffb347;font-size:13px}#tvgSheet .go:disabled{opacity:.45}';
  document.head.appendChild(css);
  const btn = document.createElement('button');
  btn.id = 'tvgBtn'; btn.type = 'button'; btn.hidden = true;
  btn.addEventListener('click', () => { state.open = true; state.msg = ''; state.qmsg = ''; tr.msg = ''; paint(); loadQuality(); loadTest(); });
  (document.getElementById('app') || document.body).appendChild(btn);
  (document.getElementById('app') || document.body).appendChild(tabs);

  function paintBtn() {
    const id = derbyId(), on = !!id && !!bill();
    btn.hidden = !on; tabs.hidden = !on; // タブも同じ: 対応する casa DERBY の店があるときだけ
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
      trHtml() + // テストレース（2026-10-19 その 2）
      qHtml() + // 「今すぐ casa DERBY のスタッフ画面へ」は左上のタブに（2026-10-19 その 2）
      '<div class="auto"><span>このスマホの画面も自動で入れ替える<br><small style="color:#9aa89c">casa DERBY のときは casa DERBY のスタッフ画面に</small></span><button type="button" data-tvg="auto">' + (auto() ? 'する' : 'しない') + '</button></div>' +
      '<button type="button" class="close" data-tvg="close">閉じる</button></div>';
  }
  function qHtml() { // テレビの画質（2026-10-19）。PIN の欄は上のものを使う
    const q = state.qId === derbyId() ? state.q : undefined;
    return '<div class="tq" id="tvqBox"><h4>テレビの画質<small>casa DERBY を映しているとき</small></h4>' +
      '<p class="now">いま: <b id="tvqNow">' + (q === undefined ? '確認中…' : q === null ? '読めませんでした' : QN[q]) + '</b></p>' +
      '<div class="three">' + QS3.map(([v, name, note]) => '<button type="button" data-tvq="' + v + '" class="' + (q === v ? 'cur' : '') + '"' + (q === v || state.busy || q === undefined ? ' disabled' : '') + '>' + (q === v ? '<i>いまこちら</i>' : '') + '<b>' + name + '</b><small>' + note + '</small></button>').join('') + '</div>' +
      (state.qmsg ? '<div class="' + (/^OK /.test(state.qmsg) ? 'okm' : 'err') + '" id="tvqMsg">' + esc(state.qmsg.replace(/^OK /, '')) + '</div>' : '') + '</div>';
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
    const tq = e.target.closest('[data-tvq]');
    if (tq) return onQuality(qNorm(tq.dataset.tvq));
    const t = e.target.closest('[data-tvg]');
    if (!t) { if (e.target.id === 'tvgSheet' && !state.busy) { state.open = false; paint(); } return; }
    const a = t.dataset.tvg;
    if (a === 'close') { if (!state.busy) { state.open = false; clearTimeout(loadTest.h); paint(); } return; }
    if (a === 'auto') { lsSet(AUTO_KEY, auto() ? 'off' : null); paint(); kick(); return; }
    if (a === 'test') return onTest();
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

  async function onQuality(v) { // テレビの画質を変える（確認 → casa DERBY のスタッフとして書く → 「1 分ほどでテレビに反映」）
    if (state.busy || state.q === undefined || v === state.q) return;
    const id = derbyId(), s = bill(), sv = staffSaved(), inp = $('tvgPin');
    const pin = sv && sv.store === id ? sv.pin : (inp ? inp.value.trim() : '');
    if (!pin) { state.qmsg = 'casa DERBY のスタッフ PIN を入れてください（上の欄）。'; return paint(); }
    if (!window.confirm((s ? s.name : '') + ' のテレビの画質を「' + QN[v] + '」にします。\n1 分ほどでテレビに反映されます（レース中は終わってから）。' + (v === 'max' ? '\nきれい優先は動きがカクカクすることがあります。' : ''))) return;
    state.busy = true; state.qmsg = ''; paint();
    try {
      await setQuality(id, pin, v);
      if (!(sv && sv.store === id) && (!sv || sv.store === id)) lsSet(STAFF_KEY, JSON.stringify({ store: id, name: (s && s.name) || id, pin })); // テレビのゲームと同じく覚える
      state.q = v; state.qId = id;
      state.qmsg = 'OK 画質を「' + QN[v] + '」にしました。1 分ほどでテレビに反映されます（レース中は終わってから）。';
    } catch (err) {
      state.qmsg = err.message;
      if (err.code === 'bad_pin' && sv && sv.store === id) { lsSet(STAFF_KEY, null); state.qmsg = 'casa DERBY のスタッフ PIN が変わっています。新しい PIN を入れてください。'; }
    }
    state.busy = false; paint();
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
    if (manualHold(id, state.game)) { state.why = 'manual'; return; } // 手で移ったあと、店のゲームが変わるまで（2026-10-19 その 2）
    if (!auto()) { state.why = 'auto off'; return; }
    if (looping()) { state.why = 'loop'; return kick(60000); }
    const quiet = Date.now() - lastTouch >= QUIET_MS;
    if (state.open || state.busy || !quiet || !window.BillPage.idle() || document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { state.waiting = true; state.why = 'busy'; return kick(RETRY_MS); }
    if (!(await derbyReady())) { state.why = 'no derby staff'; return kick(POLL_MS); }
    if (state.game !== 'derby' || !window.BillPage.idle() || manualHold(id, state.game)) return kick(RETRY_MS);
    state.leaving = true; state.why = 'go'; mark();
    location.href = 'derby/v2/staff.html?store=' + encodeURIComponent(id) + '&via=slot';
  }
  let lastDoc = null;
  function onDoc(doc) {
    lastDoc = doc;
    const id = derbyId(); state.id = id; if (!id) return paintBtn();
    state.game = T.gameOf(doc, id); state.at = Date.now();
    manualHold(id, state.game); // 店のゲームが手で移ったときと変わっていたら、ここで記録を消す（どちらのゲームに変わっても）
    paint(); kick();
  }
  T.watch(onDoc);
  // 変更の通知が使えないとき（SDK を読めない・つながらない）は 30 秒ごとに 1 回読む
  setInterval(async () => { if (T.live.on || !derbyId()) return; const d = await T.readDoc(); if (d) onDoc(d); }, POLL_MS);
  setTimeout(async () => { if (!T.live.on && derbyId()) { const d = await T.readDoc(); if (d) onDoc(d); } }, 3000);
  setInterval(() => { if (lastDoc && derbyId() !== state.id) onDoc(lastDoc); else paintBtn(); }, 2000); // ログイン・店舗の切り替えのあと
  setInterval(() => { if (state.open) paintTest(); }, 1000); // 発走までの残り
  window.PhoneSwitch = { state, tr, loadTest, manualHold, derbyId, open() { state.open = true; paint(); loadQuality(); }, maybeGo, loadQuality };
})();
