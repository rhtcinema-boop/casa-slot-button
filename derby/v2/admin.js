/* casa DERBY v2 管理画面（店舗・時刻表・今日のレース・裏の調整・集計・運用）
   casa SLOT のマスター画面（master.html / js/master.js）と同じ作り・言葉づかい。あとで master に「casa DERBY」として合流させる前提。
   通信はすべて DerbyCloud（v2/client.js）経由。API は v2/API.md。足りない API は v2/API_REQUESTS.md の「管理画面から」に書いてある。
   方針: 時刻表は「エラーがあったら保存できない」（casa SLOT の配当表と同じ）。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (v) => Number(v || 0).toLocaleString('en-US');
  const pad = (n) => ('0' + n).slice(-2);
  const main = $('main');
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const RUN_SEC = 60; // 走り（約 58 秒）に少し余裕を足した長さ。最短間隔の計算に使う
  /* 払い戻しは「額」（2026-10-16 オーナー決定。1 枚 = 100・単位なし）。投票は枚のまま。払い戻しの合計・上限は額で入れる（保存のとき 100 単位に丸める＝core.js の roundAmount） */
  const PAY_MAX = 99999900, YEN = 100;
  /* casa DERBY CHIPS（2026-10-17 オーナー「リングバウンティ20枚で casa DERBY 100チップ入る感じ」）: 中の投票券の枚数（bet・betTotal・auth・exchanged）は 1 枚 = 100 チップとして見せる */
  const chipN = (v) => fmtN((Number(v) || 0) * 100);
  // 記録 1 行のリングバウンティ（core.js の logBounty と同じ。以前の記録: 認証は枚数＝1 対 1、返却・返還は額 ÷ 100）
  const isBLog = (l) => l.type === 'auth' || l.type === 'return' || l.type === 'refund' || ((l.type === 'paid' || l.type === 'expired') && l.kind === 'refund');
  const logB = (l) => (!isBLog(l) ? 0 : l.bounty != null ? Number(l.bounty) || 0 : l.type === 'auth' ? Number(l.count) || 0 : Math.round((Number(l.count) || 0) / 100));
  const per1 = (o) => (o ? (Math.round(Number(o) * 10) / 10).toFixed(1) + '倍' : ''); // オッズは倍率（2026-10-19 オーナー「オッズ表記は倍率にしよう」。以前は 100あたりの額）
  const STATUS = { upcoming: ['予定', 'st-upcoming'], open: ['受付中', 'st-open'], vote: ['投票中', 'st-open'], closed: ['締切', 'st-closed'], decided: ['レース中', 'st-decided'], done: ['確定', 'st-done'], void: ['取り消し済み', 'st-void'] };
  const MODES = [['auto', 'ずっと自動で始める'], ['bet', '誰かが賭けたら始める'], ['staff', 'スタッフが始める']];
  const modeName = (m) => (MODES.find((x) => x[0] === m) || MODES[0])[1];
  /* 確定演出（2026-10-16 オーナー決定。店舗には見せない）: 演出名 → [表示名, どう見えるか]。割合の初期値は v2/core.js の DEFAULT_CUES と同じ */
  const CUES = [['fruit', '木の実の色', 'コース脇の木の実が、その馬の枠の色になる'], ['crowd', '観客の服の色', '観客の服がその馬の枠の色に寄る'], ['sign', '看板の絵柄', '向こう正面の看板にその馬の枠の色が出る'], ['cloud', '雲の形', 'その馬の番号の形をした雲が浮かぶ'], ['gateLate', 'ゲートインで遅れた馬', 'その馬だけゲートに入るのをためらう'], ['eye', '最終コーナーで目が光る', '最終コーナーでその馬の目が光る']];
  const DEF_CUES = { fruit: { show: 30, hit: 100 }, crowd: { show: 40, hit: 70 }, sign: { show: 30, hit: 100 }, cloud: { show: 30, hit: 100 }, gateLate: { show: 25, hit: 70 }, eye: { show: 20, hit: 100 } };
  const cueName = (k) => { const c = CUES.find((x) => x[0] === k); return c ? c[1] : k; };
  const DEF_TUNING = { horseLook: 'cute', payoutRate: 0.85, volatility: 1, payoutCap: 0, payoutCapDay: 0, shiftUp: 0.1, shiftDown: 0.1, bandBelow: 0.2, bandAbove: 0.2, exchangeSec: 90, voteSec: 30, betSec: 120, resultSec: 300, gateSec: 8, postSec: 28, closeLeadSec: 0, scenes: { paddock: true, gate: true, replay: true, winner: true }, cues: DEF_CUES, bountyPerTicket: 20 };
  const TUNE_PRESETS = [['steady', '堅め', { volatility: 0.7, shiftUp: 0.05, shiftDown: 0.05 }, '人気の馬が勝ちやすい・倍率のずらしは小さめ'], ['normal', 'ふつう', { volatility: 1.0, shiftUp: 0.1, shiftDown: 0.1 }, '今の作り'], ['wild', '荒れやすい', { volatility: 1.5, shiftUp: 0.15, shiftDown: 0.15 }, '人気薄も勝つ・倍率のずらしは大きめ']];

  /* ---------- 時刻（サーバー時刻・日本時間） ---------- */
  let C = null, A = null;
  const now = () => (C && typeof C.serverNow === 'function' ? C.serverNow() : Date.now());
  const JST = 9 * 3600e3;
  const iso = (ms) => new Date(ms + JST).toISOString();
  const ymd = (ms) => iso(ms).slice(0, 10);
  const hms = (ms) => iso(ms).slice(11, 19);
  const hm = (ms) => iso(ms).slice(11, 16);
  const todayStr = () => ymd(now());
  // 営業日の「今日」（区切りは裏の調整の dayStartHour 時、初期 5 時）: レース一覧・集計・運用はこちら（サーバーの集計・記録が営業日なので）。時刻表は暦の日付のまま
  const bizToday = () => ymd(now() - ((cfg && cfg.tuning && cfg.tuning.dayStartHour != null ? Number(cfg.tuning.dayStartHour) : 5) * 3600e3));
  const addDays = (d, n) => ymd(Date.parse(d + 'T00:00:00Z') + n * 864e5);
  const wdOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
  const fmtDay = (d) => (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '(' + WD[wdOf(d)] + ')';
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); if (!m) return NaN; const h = +m[1], mi = +m[2]; return h < 24 && mi < 60 ? h * 60 + mi : NaN; };
  const fromMin = (m) => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
  const secTxt = (s) => (s >= 60 ? Math.floor(s / 60) + '分' + (s % 60 ? (s % 60) + '秒' : '') : s + '秒');
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d + 'T00:00:00Z'));

  let toastTimer = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800); }
  const errText = (e) => (e && e.code === 'not_supported' ? 'サーバーがまだこの操作に対応していません（API_REQUESTS.md で依頼中）' : (e && (e.body && e.body.message || e.message)) || '通信できませんでした');

  /* ---------- 通信（DerbyCloud の admin） ---------- */
  async function api(name) {
    const args = Array.prototype.slice.call(arguments, 1);
    if (!A || typeof A[name] !== 'function') { const e = new Error('not_supported'); e.code = 'not_supported'; throw e; }
    try { return await A[name].apply(A, args); }
    catch (e) { if (e && (e.status === 401 || e.code === 'bad_password')) { sessionStorage.removeItem(PW_KEY); setTimeout(() => location.reload(), 1200); toast('パスワードが違います。ログインし直してください'); } throw e; }
  }

  /* ---------- 状態 ---------- */
  const PW_KEY = 'casa.derby.admin.pw';
  let cfg = null; // { stores, rules, tuning }
  let tab = 'races'; // 最初に開くのは「今日」（2026-10-19 シンプル化。deploy/ADMIN_SIMPLE_NOTES.md）
  let editStore = null; // 店舗の編集中のコピー
  let tt = null; // 時刻表の編集中のコピー { tpls }
  let ttDirty = false, ttOrig = new Set(); // ttOrig: 読み込んだ時点の「テンプレートid|時刻」（過去の時刻を新しく足したかの判定用）
  let tunDirty = false;
  let pvDate = '', pvStore = '', pvSrc = 'local', pvServer = null;
  let raceDate = '', racesData = null, racesErr = '', racesTimer = 0;
  let stFrom = '', stTo = '', stStore = '', statsData = null, statsErr = '';
  let logBill = '', logsData = null, logsErr = '';
  let raceAll = false, refundOpen = null; // 今日のレース: 全部を表示するか／その場で開いているレース取消（レース id）
  let pairData = null, pairErr = '', pairSeq = 0; // 進行役のテレビ（2026-10-19）: api('tvs') の答え { tvs, decider, lock, now }
  let memoOn = false, connOpen = false, editFrom = null; // memoOn: 今日のレースの内部メモ（1 着の選び方・演出。最初は隠す）／connOpen: テレビの「接続の設定」を開いているか／editFrom: 店舗の編集をどのタブから開いたか
  const tplOpen = new Set(); // 時刻表: 開いているテンプレート（id）
  const tplAll = new Set(); // 時刻表: 行を全部見せているテンプレート（id）。ふだんは最初の 10 行だけ（2026-10-19 改善 3）
  const ROWS_SHOWN = 10;
  let uid = 0; const nk = () => 'k' + (++uid);

  function normCfg(c) {
    const T = Object.assign({}, DEF_TUNING, (c && c.tuning) || {});
    if (c && c.tuning && c.tuning.shiftWidth != null) { if (c.tuning.shiftUp == null) T.shiftUp = c.tuning.shiftWidth; if (c.tuning.shiftDown == null) T.shiftDown = c.tuning.shiftWidth; } /* 以前のデータ（±1 つ）は上げ・下げの両方に */
    T.scenes = Object.assign({}, DEF_TUNING.scenes, (c && c.tuning && c.tuning.scenes) || {});
    { const src = (c && c.tuning && c.tuning.cues) || {}, cz = {}; CUES.forEach(([k]) => { cz[k] = Object.assign({}, DEF_CUES[k], src[k] || {}); }); T.cues = cz; } /* 演出: 足りない演出は初期値 */
    return {
      stores: ((c && c.stores) || []).map((s) => ({ id: s.id, name: s.name || s.id, pin: s.pin == null ? '' : String(s.pin), settings: Object.assign({}, s.settings || {}), tvKey: s.tvKey || null })),
      rules: ((c && c.timetable && c.timetable.rules) || []).map((r) => Object.assign({}, r)),
      tuning: T,
      tvKey: (c && c.tvKey) || null, // テレビの合言葉（模擬クラウドだけ。テレビの URL の tvkey=）
      capDayOk: !!(c && c.tuning && 'payoutCapDay' in c.tuning), // 1 日の上限はサーバーが対応したら保存される（API_REQUESTS.md）
    };
  }
  const storeName = (id) => { if (!id) return '全店'; const s = cfg.stores.find((x) => x.id === id); return s ? s.name : id + '（削除済み）'; };

  /* ---------- ログイン ---------- */
  function viewLogin(msg) {
    return '<div class="panel" id="login"><h3>ログイン</h3><p class="hint">casa DERBY の管理パスワード</p>' +
      '<label class="f"><span>パスワード</span><input type="password" id="pw" autocomplete="current-password"></label>' +
      '<div class="err" id="lerr">' + esc(msg || '') + '</div><div class="acts"><button class="btn" id="dologin">ログイン</button></div></div>';
  }
  async function start() {
    if (!window.DerbyCloud) { main.innerHTML = '<div class="panel"><h3>接続できません</h3><p class="hint">v2/client.js が読み込めませんでした。</p></div>'; return; }
    C = DerbyCloud.create({ role: 'admin' });
    try { await C.syncClock(); } catch (e) { /* 時刻合わせに失敗しても端末の時計で続ける */ }
    const saved = sessionStorage.getItem(PW_KEY);
    if (saved) { try { await login(saved); return; } catch (e) { sessionStorage.removeItem(PW_KEY); } }
    showLogin('');
  }
  function showLogin(msg) {
    main.innerHTML = viewLogin(msg);
    $('pw').focus();
    $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dologin').click(); });
    $('dologin').addEventListener('click', async () => {
      $('lerr').textContent = '';
      try { await login($('pw').value); }
      catch (e) { $('lerr').textContent = e && (e.status === 401 || e.code === 'bad_password') ? 'パスワードが違います。' : 'ログインできませんでした: ' + errText(e); }
    });
  }
  async function login(p) {
    A = C.admin(p);
    cfg = normCfg(await A.config());
    sessionStorage.setItem(PW_KEY, p);
    $('who').textContent = '管理者';
    $('logout').style.display = '';
    $('tabs').style.display = ''; markTab();
    setInterval(tick, 1000); tick();
    render();
  }
  $('logout').addEventListener('click', () => { if (!leaveOk()) return; sessionStorage.removeItem(PW_KEY); location.reload(); });
  async function reloadCfg() { cfg = normCfg(await api('config')); }
  function tick() { $('clock').textContent = fmtDay(todayStr()) + ' ' + hms(now()).slice(0, 5); main.querySelectorAll('[data-until]').forEach((el) => { el.textContent = leftTxt(+el.dataset.until - now()); }); }

  const leaveOk = () => !((ttDirty && tab === 'timetable') || (tunDirty && tab === 'tuning') || (editStore && tab === 'stores')) || confirm('保存していない変更があります。破棄して移動しますか？');
  window.addEventListener('beforeunload', (e) => { if (ttDirty || tunDirty) { e.preventDefault(); e.returnValue = ''; } });
  // タブの印: 「詳細の調整」（tuning）は「設定」タブの中の画面なので、設定タブを光らせる
  const markTab = () => document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === (tab === 'tuning' ? 'ops' : tab)));
  function switchTab(name) {
    if (name === tab) { if (!editStore) { if (tab === 'races') { racesData = null; pairData = null; } render(); } return; } // いまのタブを押したら読み直す
    if (!leaveOk()) return;
    if (tab === 'timetable' && ttDirty) { tt = null; ttDirty = false; }
    if (tab === 'tuning') tunDirty = false;
    if (tab === 'races') { memoOn = false; refundOpen = null; } // 勝ち馬の決まり方・レース取消はほかの画面へ移ったら閉じ直す
    editStore = null; editFrom = null; connOpen = false; // 畳みは別の画面に移ったら閉じた状態から（casa SLOT マスターと同じ）
    tab = name; markTab(); window.scrollTo(0, 0);
    render();
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); });

  function render() {
    clearInterval(racesTimer);
    main.classList.toggle('wide', tab === 'timetable' || tab === 'races' || tab === 'stats');
    if (tab === 'stores') { main.innerHTML = editStore ? viewStoreEdit() : viewStores(); if (editStore) validateStore(); }
    else if (tab === 'timetable') { if (!tt) loadTT(); main.innerHTML = viewTT(); paintTT(); }
    else if (tab === 'races') { if (!raceDate) raceDate = bizToday(); main.innerHTML = viewRaces(); if (!racesData) loadRaces(); if (!pairData && pairOk()) loadPair(); racesTimer = setInterval(() => { if (tab === 'races' && raceDate === bizToday()) loadRaces(true); }, 10000); }
    else if (tab === 'tuning') { main.innerHTML = viewTuning(); validateTuning(); }
    else if (tab === 'stats') { if (!stFrom) { stTo = bizToday(); stFrom = addDays(stTo, -6); } main.innerHTML = viewStats(); if (!statsData && !statsErr) loadStats(); }
    else if (tab === 'ops') { main.innerHTML = viewOps(); validateBp(); }
  }
  const keepScroll = (fn) => { const y = window.scrollY; fn(); window.scrollTo(0, y); };

  /* ---------- 共通の部品 ---------- */
  // 数字の入力（◀ ▶ と直接入力）。値は保存のときに DOM から読む
  function stepRow(label, hint, key, val, unit, min, max, step) {
    return '<div class="row"><div class="lbl">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</div>' +
      '<div class="stepper" data-k="' + key + '" data-min="' + min + '" data-max="' + max + '" data-step="' + step + '"><button type="button" data-act="st" data-d="-1" aria-label="減らす">◀</button>' +
      '<input class="pv" type="number" inputmode="decimal" id="n-' + key + '" value="' + val + '" min="' + min + '" max="' + max + '" step="' + step + '"><i>' + unit + '</i>' +
      '<button type="button" data-act="st" data-d="1" aria-label="増やす">▶</button></div></div>';
  }
  const numOf = (key) => { const el = $('n-' + key); return el ? Number(el.value) : NaN; };
  function numOk(key) { const el = $('n-' + key); if (!el) return true; const st = el.closest('.stepper'), v = Number(el.value), mn = +st.dataset.min, mx = +st.dataset.max, sp = +st.dataset.step; const ok = el.value !== '' && isFinite(v) && v >= mn && v <= mx && Math.abs(Math.round(v / sp) * sp - v) < 1e-9; el.classList.toggle('bad', !ok); return ok; }
  function stepBy(b) {
    const st = b.closest('.stepper'), el = st.querySelector('input'), sp = +st.dataset.step, mn = +st.dataset.min, mx = +st.dataset.max;
    const v = Number(el.value) || 0, d = +b.dataset.d;
    el.value = Math.round(Math.max(mn, Math.min(mx, (Math.round(v / sp) + d) * sp)) * 1000) / 1000;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // 押しっぱなしで連続して増減（casa SLOT と同じ）
  let holdT = 0, holdI = 0;
  const holdStop = () => { clearTimeout(holdT); clearInterval(holdI); };
  main.addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-act="st"]'); holdStop(); if (!b) return; holdT = setTimeout(() => { holdI = setInterval(() => { if (!document.contains(b)) return holdStop(); stepBy(b); }, 70); }, 420); });
  ['pointerup', 'pointercancel', 'blur'].forEach((ev) => window.addEventListener(ev, holdStop));
  function download(name, rows) {
    // Excel 用: 先頭に BOM。お客さんが入れた文字（ニックネーム・会計番号）が = + - @ で始まると Excel が数式として動かすので、先頭に ' を付けて文字にする（数字そのものはそのまま）
    const cell = (v) => { let s = String(v == null ? '' : v); if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ======================================================================
     店舗
     ====================================================================== */
  /* 受付の 2 段（2026-10-16）: 参加受付（引き換え）と投票の秒数。以前の betSec（1 つ）だけなら 参加受付 = max(betSec − 30, 10)・投票 = 30（v2/core.js の stageSecs と同じ） */
  function stagesOf(st, T) {
    const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null), base = { exchangeSec: n(T.exchangeSec) != null ? T.exchangeSec : 90, voteSec: n(T.voteSec) != null ? T.voteSec : 30 };
    let ex = n(st.exchangeSec), vo = n(st.voteSec);
    if (ex == null && vo == null && n(st.betSec) != null) { ex = Math.max(st.betSec - 30, 10); vo = 30; }
    return { exchangeSec: ex != null ? ex : base.exchangeSec, voteSec: vo != null ? vo : base.voteSec };
  }
  function sset(s) {
    const st = (s && s.settings) || {}, T = cfg.tuning;
    const n = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d), sg = stagesOf(st, T);
    return {
      exchangeSec: sg.exchangeSec, voteSec: sg.voteSec, betSec: sg.exchangeSec + sg.voteSec, resultSec: n(st.resultSec, T.resultSec || 300),
      scenes: Object.assign({ paddock: true, gate: true, replay: true }, st.scenes || {}),
      sceneSec: Object.assign({ paddock: 30, gate: T.gateSec, replay: T.postSec }, st.sceneSec || {}),
      modes: Array.isArray(st.modes) ? st.modes.map((m) => ({ k: nk(), from: m.from || '', to: m.to || '', mode: m.mode || 'auto' })) : [],
      modeDefault: st.modeDefault || 'auto',
      test: !!st.test,
      tvGame: st.tvGame === 'derby' ? 'derby' : 'slot', /* テレビのゲーム（2026-10-17）: casa SLOT のテレビがこれを見て切り替わる */
    };
  }
  function modeNow(s) {
    const S = sset(s), m = toMin(hm(now()));
    const b = S.modes.find((x) => { const f = toMin(x.from), t = toMin(x.to); return f < t ? m >= f && m < t : (m >= f || m < t); });
    return modeName(b ? b.mode : S.modeDefault);
  }
  const gameName = (g) => (g === 'derby' ? 'casa DERBY' : 'casa SLOT');
  function viewStores() {
    const S = cfg.stores;
    return '<div class="panel"><h3>店舗の設定を変える<span class="sp"></span><button class="btn sm ghost" data-act="cfg-reload">最新の情報にする</button></h3>' +
      (S.length ? '<div class="list">' + S.map((s) => {
        const x = sset(s);
        return '<div class="item"><div class="name">' + esc(s.name) + (x.test ? ' <span class="chip test">テストモード</span>' : '') + ' <span class="chip' + (x.tvGame === 'derby' ? ' on' : '') + '">テレビ: ' + gameName(x.tvGame) + '</span>' +
          '<small>参加受付 ' + x.exchangeSec + '秒・投票 ' + x.voteSec + '秒・結果 ' + x.resultSec + '秒・暗証番号 ' + esc(s.pin) + '</small></div>' +
          '<button class="btn sm ghost" data-act="store-edit" data-id="' + esc(s.id) + '">変える</button></div>';
      }).join('') + '</div>' : '<div class="empty">まだ店舗がありません</div>') +
      '<div class="acts l"><button class="btn ghost" data-act="store-new">＋ 店舗を追加</button></div>' +
      '<p class="hint">テレビの切り替えとリンクは「今日」にあります。</p></div>';
  }
  /* 今日: 店のテレビ（店ごとに ゲームの切り替え・再読み込み・設定）。テレビ関係のめったに使わないもの（リンク・合言葉・テレビ用アカウント）は下の「接続の設定」に畳む */
  /* 2026-10-19 改善 2（ChatGPT と壁打ち）: 見出しは「やりたいこと」の言葉。1 店 1 行（店名・SLOT|DERBY・読み込み直す）。全店舗の読み込み直しもここ（前は「設定」） */
  function viewTvPanel() {
    const S = cfg.stores;
    const link = (label, href) => '<div class="lnk"><b>' + esc(label) + ' <button type="button" class="btn xs ghost" data-act="copy" data-copy="' + esc(new URL(href, location.href).href) + '">コピー</button></b><a href="' + esc(href) + '" target="_blank">' + esc(href) + '</a></div>';
    return '<div class="panel" id="tvPanel"><h3>テレビを切り替える</h3>' +
      (S.length ? S.map((s) => {
        const g = sset(s).tvGame;
        return '<div class="tvrow" data-store="' + esc(s.id) + '"><button type="button" class="nm" data-act="store-edit" data-id="' + esc(s.id) + '" aria-label="' + esc(s.name) + 'の設定を開く" title="店舗の設定を開く">' + esc(s.name) + '<i aria-hidden="true">›</i>' + (sset(s).test ? '<span class="chip test">テスト</span>' : '') + '<span class="vh">テレビ: ' + gameName(g) + '</span></button>' +
          '<div class="seg" role="group" aria-label="' + esc(s.name) + 'のテレビに映すゲーム">' + ['slot', 'derby'].map((v) => '<button type="button" data-act="tvgame-set" data-id="' + esc(s.id) + '" data-v="' + v + '" class="' + (g === v ? 'on' : '') + '" aria-pressed="' + (g === v) + '">' + (v === 'derby' ? 'DERBY' : 'SLOT') + '</button>').join('') + '</div>' +
          '<button class="btn sm ghost" data-act="tv-reload" data-store="' + esc(s.id) + '" aria-label="' + esc(s.name) + 'のテレビを読み込み直す">読み込み直す</button></div>';
      }).join('') : '<div class="empty">まだ店舗がありません（「店舗」で追加）</div>') +
      (S.length > 1 ? '<div class="acts l tvall"><button class="btn sm ghost" data-act="tv-reload" data-store="">全店舗のテレビを読み込み直す</button></div>' : '') +
      viewPair() +
      '<details class="fold conn" id="connFold"' + (connOpen ? ' open' : '') + '><summary>テレビ・スマホ・スタッフ画面のリンク</summary><div class="in">' +
      S.map((s) => '<details class="fold"><summary>' + esc(s.name) + '</summary><div class="in">' + link('テレビ用', tvUrl(s)) + link('お客様用', 'bet.html?store=' + encodeURIComponent(s.id)) + link('スタッフ用', 'staff.html?store=' + encodeURIComponent(s.id)) + '</div></details>').join('') +
      (cfg.tvKey ? '<p class="hint">テレビ用のリンクはお客さんに見せないでください。</p>' : '') +
      (isFs() ? '<p class="hint">テレビ用アカウントは最初に 1 回だけ作ります。</p>' : '') +
      '<div class="acts l">' + (isFs() ? '<button class="btn sm ghost" data-act="tvacct-new">テレビ用アカウントを作る</button>' : '') + (cfg.tvKey ? '<button class="btn sm ghost" data-act="tvkey-new">テレビのリンクを作り直す（漏れたとき）</button>' : '') + '</div>' +
      '</div></details></div>';
  }
  /* ---------- 進行役のテレビ（2026-10-19）: パスワードを打たずに、ここで 1 タップ ----------
     名乗っているテレビ（7 日以内に連絡）の一覧と「進行役にする」。押すとそのテレビの上の帯に 4 けたの数字が出る → この画面の数字と同じなら OK。
     進行役は 1 台だけ（前のテレビは外れる）。Web デモでは出さない（デモのテレビはデモの決める係で動く） */
  const pairOk = () => !(window.DERBY_FIREBASE && window.DERBY_FIREBASE.demo) && !!A && typeof A.tvs === 'function';
  const kindName = (k) => (k === 'casatv' ? 'Fire TV' : 'ブラウザ');
  const agoTxt = (ms) => { const m = Math.floor(Math.max(0, ms) / 60000); return m < 2 ? 'たった今' : m < 60 ? m + '分前' : m < 1440 ? Math.floor(m / 60) + '時間前' : Math.floor(m / 1440) + '日前'; };
  function tvLabels(tvs) { // 同じ店に何台もあるときは「上野のテレビ 2」（新しく連絡した順）
    const n = {}, out = {};
    tvs.forEach((x) => { n[x.store] = (n[x.store] || 0) + 1; });
    const seen = {};
    tvs.forEach((x) => { seen[x.store] = (seen[x.store] || 0) + 1; out[x.id] = storeName(x.store) + 'のテレビ' + (n[x.store] > 1 ? ' ' + seen[x.store] : ''); });
    return out;
  }
  function viewPair() {
    if (!pairOk()) return '';
    const P = pairData, head = '<div class="phd"><b>進行役のテレビ</b><small>結果を決めて進める役</small><span class="sp"></span><button type="button" class="btn xs ghost" data-act="pair-reload">最新にする</button></div>';
    if (!P) return '<div class="pair" id="pairBox">' + head + '<div class="hint">' + (pairErr ? esc(pairErr) : '読み込み中…') + '</div></div>';
    const t = P.now || now(), tvs = P.tvs || [], lab = tvLabels(tvs), d = P.decider, STALE = 12 * 60000;
    const dName = d ? lab[d.id] || storeName(d.store) + 'のテレビ' : '';
    const nowLine = d
      ? '<div class="pnow">いま <b>' + esc(dName) + '</b> <small class="' + (d.seen && t - d.seen < STALE ? '' : 'warn') + '">' + (d.seen ? (t - d.seen < STALE ? (t - d.seen < 120000 ? '連絡あり' : agoTxt(t - d.seen) + 'に連絡') : '連絡がありません（' + agoTxt(t - d.seen) + '）') : '連絡がありません') + '</small><button type="button" class="btn xs ghost" data-act="pair-stop">やめる</button></div>'
      : '<div class="pnow">いま <b>なし</b>' + (P.lock && P.lock.kind === 'account' ? ' <small>パスワードのテレビ（' + esc(storeName(P.lock.store)) + '）が進めています</small>' : '') + '</div>';
    const rows = tvs.map((x) => {
      const me = d && d.id === x.id, old = t - x.at >= STALE;
      return '<div class="prow' + (me ? ' me' : '') + '" data-tv="' + esc(x.id) + '"><span class="nm">' + esc(lab[x.id]) + '<small' + (old ? ' class="old"' : '') + '>' + kindName(x.kind) + '・' + agoTxt(t - x.at) + '</small></span>' +
        (me ? '<span class="chip on">進行役</span>' : '<button type="button" class="btn sm ghost" data-act="pair-set" data-id="' + esc(x.id) + '">進行役にする</button>') + '</div>';
    }).join('');
    return '<div class="pair" id="pairBox">' + head + nowLine + (rows ? '<div class="plist">' + rows + '</div>' : '<div class="hint">テレビがまだありません。DERBY のテレビをつけると、ここに出ます。</div>') + '</div>';
  }
  async function loadPair() {
    const my = ++pairSeq;
    try { const r = await api('tvs'); if (my !== pairSeq) return; pairData = r || { tvs: [] }; pairErr = ''; }
    catch (e) { if (my !== pairSeq) return; pairErr = errText(e); pairData = null; }
    if (tab === 'races' && !editStore) { const box = $('pairBox'); if (box) box.outerHTML = viewPair(); }
  }
  // 「進行役にする」: テレビに数字を出してもらい（tvAsk）、同じ数字なら OK → 進行役に（setDecider）。やめる・閉じるとテレビの数字も消す
  async function pairStart(btn) {
    const id = btn.dataset.id, x = ((pairData && pairData.tvs) || []).find((y) => y.id === id); if (!x) return;
    const name = tvLabels(pairData.tvs)[id];
    btn.disabled = true;
    let r; try { r = await api('tvAsk', id, true); } catch (e) { btn.disabled = false; toast(errText(e)); return; }
    btn.disabled = false;
    const code = (r && r.code) || x.code || '----';
    const w = document.createElement('div'); w.className = 'onceScrim'; w.id = 'pairAsk';
    w.innerHTML = '<div class="onceCard pairCard" role="dialog" aria-label="進行役の確認"><h3>' + esc(name) + 'を進行役にします</h3>' +
      '<p>' + esc(name) + 'の画面の上に出ている数字が</p><div class="pcode" id="pairCode">' + esc(code) + '</div><p>なら OK を押してください。</p>' +
      '<p class="hint">数字が出ていない・ちがうときは「やめる」。前の進行役は外れます。</p>' +
      '<div class="acts"><button type="button" class="btn ghost" data-pa="no">やめる</button><button type="button" class="btn" data-pa="ok">OK</button></div></div>';
    document.body.appendChild(w);
    const done = await new Promise((res) => w.addEventListener('click', (e) => { const b = e.target.closest('[data-pa]'); if (b) res(b.dataset.pa === 'ok'); else if (e.target === w) res(false); }));
    w.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      if (done) { await api('setDecider', id); toast(name + 'を進行役にしました'); }
      else await api('tvAsk', id, false).catch(() => {});
    } catch (e) { toast('失敗しました: ' + errText(e)); }
    finally { w.remove(); pairData = null; loadPair(); }
  }
  async function pairStop() {
    const d = pairData && pairData.decider; if (!d) return;
    if (!confirm('進行役をやめますか？\nほかに進めるテレビがないと、レースが進まなくなります。')) return;
    try { await api('setDecider', null); toast('進行役をやめました'); } catch (e) { toast('失敗しました: ' + errText(e)); }
    pairData = null; loadPair();
  }
  /* テレビのゲームの切り替え（今日の「店のテレビ」から）: 書き込みは店舗の編集の「保存」とまったく同じ（saveStore。tvGame だけ変えて保存） */
  async function quickTvGame(b) {
    const s = cfg.stores.find((x) => x.id === b.dataset.id), v = b.dataset.v === 'derby' ? 'derby' : 'slot';
    if (!s || sset(s).tvGame === v) return;
    if (!/^\d{4,8}$/.test(s.pin)) { toast('この店舗の暗証番号を直してから切り替えてください（店名を押すと開きます）'); return; }
    if (!confirm(s.name + 'のテレビを ' + gameName(v) + ' に切り替えます。\n反映まで約 30 秒かかります（遊んでいる途中・レース中は終わってから）。')) return;
    main.querySelectorAll('[data-act="tvgame-set"][data-id="' + s.id + '"]').forEach((x) => { x.disabled = true; });
    editStore = { isNew: false, id: s.id, name: s.name, pin: s.pin, orig: s.settings, x: sset(s) }; editStore.x.tvGame = v;
    try { await saveStore(); toast(s.name + 'のテレビを ' + gameName(v) + ' にしました（30 秒ほどで切り替わります）'); }
    finally { if (tab !== 'stores') editStore = null; if (tab === 'races') keepScroll(() => { main.innerHTML = viewRaces(); }); }
  }
  const isFs = () => !!(C && C.backend === 'firestore'); /* Firestore 版（本番）。模擬クラウドでは出さないもの用 */
  /* テレビ用アカウントを作る（Firestore 版だけ・2026-10-17）: パスワードはこのブラウザの中で作り（crypto.getRandomValues）、Firebase に登録したら
     1 回だけ画面に出す。保存・送信・記録はしない（閉じたら変数ごと捨てる） */
  async function createTvAccount(btn) {
    if (!isFs()) return;
    if (!confirm('テレビ用アカウントを作ります。\nパスワードは 1 回だけ表示されます。テレビに入れる準備ができてから押してください。')) return;
    if (!window.DerbyCore || !DerbyCore.genTvPassword || !(window.crypto && crypto.getRandomValues)) { toast('このブラウザでは作れません'); return; }
    let pw = DerbyCore.genTvPassword((n) => crypto.getRandomValues(new Uint8Array(n)), 20);
    btn.disabled = true;
    try { await api('createTvAccount', pw); showTvPassword(pw); }
    catch (e) { if (e && e.code === 'tv_exists') showTvNote(e.message); else toast(errText(e)); }
    finally { pw = null; btn.disabled = false; }
  }
  function tvModal(html) {
    const w = document.createElement('div'); w.className = 'onceScrim'; w.innerHTML = '<div class="onceCard">' + html + '<div class="acts"><button class="btn" data-once="close">閉じる</button></div></div>';
    w.addEventListener('click', (e) => { const b = e.target.closest('[data-once]'); if (!b) return; if (b.dataset.once === 'close') { w.remove(); return; } const v = b.dataset.copy || ''; const done = () => { b.textContent = 'コピーしました'; setTimeout(() => { b.textContent = 'コピー'; }, 1500); }; try { navigator.clipboard.writeText(v).then(done, () => toast('コピーできませんでした。手で書き写してください')); } catch (err) { toast('コピーできませんでした。手で書き写してください'); } });
    document.body.appendChild(w); return w;
  }
  function showTvNote(msg) { tvModal('<h3>テレビ用アカウント</h3><p>' + esc(msg) + '</p>'); }
  function showTvPassword(pw) {
    const row = (label, v) => '<div class="onceRow"><small>' + esc(label) + '</small><code>' + esc(v) + '</code><button class="btn xs ghost" data-once="copy" data-copy="' + esc(v) + '">コピー</button></div>';
    const urls = cfg.stores.map((s) => row(s.name + '（' + s.id + '）のテレビ', new URL('../index.html?store=' + encodeURIComponent(s.id) + '&tvkey=' + encodeURIComponent(pw), location.href).href)).join('');
    tvModal('<h3>テレビ用アカウントを作りました</h3><p class="onceWarn">この画面を閉じると二度と表示されません。テレビに入れたら控えを安全な場所に</p>' +
      row('テレビ用のパスワード', pw) + urls +
      '<p class="hint">ブラウザのテレビは、上の URL を 1 回開けば覚えます。casa SLOT のアプリのテレビは、casa DERBY の画面で「戻る」を長押し（約 2 秒）してパスワードを入れます。</p>');
  }
  // テレビの URL（模擬クラウドは合言葉 tvkey= つき。店ごとの合言葉があればそちら）
  function tvUrl(s) { const k = s.tvKey || cfg.tvKey; return '../index.html?store=' + encodeURIComponent(s.id) + (k ? '&tvkey=' + encodeURIComponent(k) : ''); }
  function viewStoreEdit() {
    const s = editStore, x = s.x;
    const scene = (k, label, hint) => '<div class="row"><div class="lbl">' + label + '<small>' + hint + '</small></div>' +
      '<label class="check" style="padding:0"><input type="checkbox" id="sc-' + k + '"' + (x.scenes[k] ? ' checked' : '') + '> 出す</label>' +
      '<div class="stepper" data-k="ss-' + k + '" data-min="0" data-max="120" data-step="1"><button type="button" data-act="st" data-d="-1">◀</button><input class="pv" type="number" id="n-ss-' + k + '" value="' + x.sceneSec[k] + '"><i>秒</i><button type="button" data-act="st" data-d="1">▶</button></div></div>';
    const other = x.modes.length || x.test || ['paddock', 'gate', 'replay'].some((k) => !x.scenes[k]); // 初期値から変えてあれば「その他の設定」を開いておく
    return '<div class="backbar"><button class="btn sm ghost" data-act="store-cancel">← 戻る</button><h2>' + (s.isNew ? '店舗を追加' : esc(s.name) + 'の設定') + '</h2></div>' +
      /* テレビのゲーム（いちばん上）。見えるのは 2 択のボタン、保存される値は下の select（#stvgame）と同じ */
      '<div class="panel"><h3>テレビに映すゲーム</h3>' +
      '<div class="seg big" id="stvseg" role="group" aria-label="テレビに映すゲーム">' + ['slot', 'derby'].map((v) => '<button type="button" data-act="sg-tv" data-v="' + v + '" class="' + (x.tvGame === v ? 'on' : '') + '" aria-pressed="' + (x.tvGame === v) + '">' + gameName(v) + '</button>').join('') + '</div>' +
      '<select id="stvgame" class="vh" aria-hidden="true" tabindex="-1"><option value="slot"' + (x.tvGame !== 'derby' ? ' selected' : '') + '>casa SLOT</option><option value="derby"' + (x.tvGame === 'derby' ? ' selected' : '') + '>casa DERBY</option></select>' +
      '<p class="hint" style="margin-bottom:0">保存すると約 30 秒で切り替わります。</p></div>' +
      '<div class="panel"><h3>名前と暗証番号</h3>' +
      '<div class="grid2"><label class="f"><span>店舗名</span><input type="text" id="sname" value="' + esc(s.name) + '" maxlength="20"></label>' +
      (s.isNew ? '<label class="f"><span>店舗ID（英小文字・数字。あとから変えられません）</span><input type="text" id="sid" value="' + esc(s.id) + '" maxlength="20" placeholder="例: ikebukuro" autocapitalize="off"></label>'
        : '') +
      '<label class="f"><span>スタッフ画面の暗証番号（数字 4〜8 桁）</span><input type="text" id="spin" value="' + esc(s.pin) + '" inputmode="numeric" maxlength="8" autocomplete="off"></label></div>' +
      '</div>' +
      '<div class="panel"><h3>時間</h3>' +
      stepRow('参加受付の時間', 'リングバウンティと交換できる時間', 'exchangeSec', x.exchangeSec, '秒', 10, 1800, 5) +
      stepRow('投票の時間', '参加受付が終わってから', 'voteSec', x.voteSec, '秒', 10, 600, 5) +
      stepRow('結果を見せる時間', '', 'resultSec', x.resultSec, '秒', 10, 1800, 10) +
      '</div>' +
      '<div class="panel"><details class="fold" id="sother" style="border-top:0;margin:0"' + (other ? ' open' : '') + '><summary>テレビの画面・始め方・テスト <small>' + esc('テスト ' + (x.test ? 'ON' : 'OFF') + '・画面 ' + ['paddock', 'gate', 'replay'].filter((k) => x.scenes[k]).length + '/3・' + modeName(x.modeDefault) + (x.modes.length ? '＋時間帯 ' + x.modes.length : '')) + '</small></summary><div class="in">' +
      '<h4 class="sumh">テレビに出す画面</h4><p class="hint">長さを変えても発走の時刻は変わりません。</p>' +
      scene('paddock', 'パドック', '受付中の馬の紹介') + scene('gate', 'ゲートイン', '発走の前') + scene('replay', 'リプレイ', 'ゴールのあと') +
      '<h4 class="sumh">レースの始め方</h4><p class="hint">時間帯ごとに変えられます（例 22:00〜02:00）。</p>' +
      '<div class="tbl"><table class="tt-rows"><tr><th>開始</th><th>終了</th><th>始め方</th><th></th><th></th></tr>' +
      x.modes.map((m) => '<tr data-mk="' + m.k + '"><td><input type="time" data-mf="from" value="' + esc(m.from) + '"></td><td><input type="time" data-mf="to" value="' + esc(m.to) + '"></td><td><select data-mf="mode">' + MODES.map((o) => '<option value="' + o[0] + '"' + (m.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></td><td class="msg"></td><td class="ops"><button type="button" class="icon del" data-act="mode-del" data-k="' + m.k + '" aria-label="この時間帯を消す">×</button></td></tr>').join('') +
      '</table></div>' +
      '<div class="acts l"><button type="button" class="btn sm ghost" data-act="mode-add">＋ 時間帯を追加</button></div>' +
      '<label class="f"><span>上の時間帯以外</span><select id="smodedef">' + MODES.map((o) => '<option value="' + o[0] + '"' + (x.modeDefault === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
      '<h4 class="sumh">テストモード</h4><p class="hint">ON の間は集計に数えません（テレビとスマホに「TEST」）。</p>' +
      '<label class="check"><input type="checkbox" id="stest"' + (x.test ? ' checked' : '') + '> テストモード</label>' +
      '</div></details></div>' +
      (s.isNew ? '' : '<details class="fold" style="margin-top:18px"><summary>店舗を削除する</summary><div class="in danger-zone" style="margin-top:0">店舗をやめるとき<button class="btn sm danger" data-act="store-del">この店舗を削除</button></div></details>') +
      '<div class="savebar"><div class="msg" id="smsg"></div>' +
      '<button class="btn ghost" data-act="store-cancel">戻る</button><button class="btn" data-act="store-save" id="ssave">保存</button></div>';
  }
  // テレビのゲームの 2 択ボタンを select（#stvgame）に合わせて塗り直す
  function paintTvSeg() { const sel = $('stvgame'); if (!sel) return; main.querySelectorAll('[data-act="sg-tv"]').forEach((b) => { const on = b.dataset.v === sel.value; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
  // 画面の入力を editStore に読み込む（行の追加・削除で作り直す前と、保存の前）
  function captureStore() {
    const s = editStore, x = s.x;
    if ($('sname')) s.name = $('sname').value;
    if ($('sid')) s.id = $('sid').value.trim();
    if ($('spin')) s.pin = $('spin').value.trim();
    ['exchangeSec', 'voteSec', 'resultSec'].forEach((k) => { if ($('n-' + k)) x[k] = Number($('n-' + k).value); });
    ['paddock', 'gate', 'replay'].forEach((k) => { if ($('sc-' + k)) x.scenes[k] = $('sc-' + k).checked; if ($('n-ss-' + k)) x.sceneSec[k] = Number($('n-ss-' + k).value); });
    main.querySelectorAll('[data-mk]').forEach((tr) => { const m = x.modes.find((y) => y.k === tr.dataset.mk); if (!m) return; tr.querySelectorAll('[data-mf]').forEach((el) => { m[el.dataset.mf] = el.value; }); });
    if ($('smodedef')) x.modeDefault = $('smodedef').value;
    if ($('stest')) x.test = $('stest').checked;
    if ($('stvgame')) x.tvGame = $('stvgame').value === 'derby' ? 'derby' : 'slot';
  }
  function validateStore() {
    if (!editStore || !$('smsg')) return [];
    captureStore();
    const s = editStore, x = s.x, errs = [];
    const mark = (el, bad) => { if (el) el.classList.toggle('bad', !!bad); };
    mark($('sname'), !s.name.trim()); if (!s.name.trim()) errs.push('店舗名を入れてください');
    if (s.isNew) {
      const bad = !/^[a-z0-9][a-z0-9_-]{1,19}$/.test(s.id), dup = cfg.stores.some((y) => y.id === s.id);
      mark($('sid'), bad || dup);
      if (bad) errs.push('店舗ID は英小文字・数字・ - _ の 2〜20 文字にしてください'); else if (dup) errs.push('その店舗ID はもう使われています');
    }
    mark($('spin'), !/^\d{4,8}$/.test(s.pin)); if (!/^\d{4,8}$/.test(s.pin)) errs.push('暗証番号は数字 4〜8 桁にしてください');
    ['exchangeSec', 'voteSec', 'resultSec', 'ss-paddock', 'ss-gate', 'ss-replay'].forEach((k) => { if (!numOk(k)) errs.push('数字の範囲を確かめてください（赤い欄）'); });
    // 回し方の時間帯: 時刻の形・開始≠終了・重なり
    const spans = [];
    x.modes.forEach((m) => {
      const tr = main.querySelector('[data-mk="' + m.k + '"]'), f = toMin(m.from), t = toMin(m.to); let msg = '';
      if (isNaN(f) || isNaN(t)) msg = '時刻を入れてください'; else if (f === t) msg = '開始と終了が同じです';
      if (!msg) { const segs = f < t ? [[f, t]] : [[f, 1440], [0, t]]; segs.forEach((g) => spans.push({ g, m })); }
      if (tr) { tr.querySelector('.msg').innerHTML = msg ? '<div class="err">' + msg + '</div>' : ''; tr.querySelectorAll('input').forEach((el) => el.classList.toggle('bad', !!msg)); }
      if (msg) errs.push('始め方の時間帯: ' + msg);
    });
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i], b = spans[j];
      if (a.m !== b.m && a.g[0] < b.g[1] && b.g[0] < a.g[1]) {
        [a.m, b.m].forEach((m) => { const tr = main.querySelector('[data-mk="' + m.k + '"]'); if (tr) { tr.querySelector('.msg').innerHTML = '<div class="err">ほかの時間帯と重なっています</div>'; tr.querySelectorAll('input').forEach((el) => el.classList.add('bad')); } });
        errs.push('始め方の時間帯が重なっています');
      }
    }
    const uniq = errs.filter((e, i) => errs.indexOf(e) === i);
    { const so = $('sother'); if (so && !so.open && so.querySelector('.bad')) so.open = true; } // 畳んだ欄にエラーがあれば開く
    $('smsg').innerHTML = uniq.length ? '<div class="err">' + esc(uniq[0]) + (uniq.length > 1 ? '（ほか ' + (uniq.length - 1) + ' 件）' : '') + '</div>' : '<div class="okmsg">保存できます</div>';
    $('ssave').disabled = uniq.length > 0;
    return uniq;
  }
  async function saveStore() {
    if (validateStore().length) return;
    const s = editStore, x = s.x;
    const settings = Object.assign({}, s.orig || {}, {
      exchangeSec: x.exchangeSec, voteSec: x.voteSec, betSec: x.exchangeSec + x.voteSec, resultSec: x.resultSec, /* betSec は合計（古い画面用） */
      scenes: Object.assign({}, x.scenes), sceneSec: Object.assign({}, x.sceneSec),
      modes: x.modes.map((m) => ({ from: m.from, to: m.to, mode: m.mode })), modeDefault: x.modeDefault, test: x.test, tvGame: x.tvGame,
    });
    const one = { id: s.id, name: s.name.trim(), pin: s.pin, settings };
    // 店舗の保存は「一覧を丸ごと置き換え」なので、保存の直前にサーバーの最新を読み直して、この店舗だけ差し替える
    // （別のタブ・別の人が足した店舗や変えた設定を、古い画面の内容で消さない）
    await reloadCfg();
    if (s.isNew && cfg.stores.some((y) => y.id === s.id)) { toast('その店舗ID は、ほかの画面でもう作られています'); return; }
    if (!s.isNew && !cfg.stores.some((y) => y.id === s.id)) { toast('この店舗は、ほかの画面で削除されています'); editStore = null; return render(); }
    const list = cfg.stores.map((y) => (y.id === s.id ? one : { id: y.id, name: y.name, pin: y.pin, settings: y.settings }));
    if (s.isNew) list.push(one);
    await api('saveStores', list);
    await reloadCfg();
    editStore = null; toast('保存しました'); backFromEdit(); render();
  }
  // 店舗の編集を閉じたら、開いたタブ（今日など）へ戻る
  function backFromEdit() { if (editFrom && editFrom !== tab) { tab = editFrom; markTab(); } editFrom = null; }
  async function deleteStore() {
    const s = editStore;
    const used = cfg.rules.filter((r) => r.storeId === s.id).length;
    if (!confirm('店舗「' + s.name + '」を削除します。' + (used ? '\nこの店舗だけの時刻表（' + used + ' 件）は動かなくなります。' : '') + '\n過去の集計の記録は残ります。')) return;
    await reloadCfg(); // ほかの画面での変更を消さない
    if (cfg.stores.length <= 1) { toast('最後の 1 店舗は削除できません'); return; }
    await api('saveStores', cfg.stores.filter((y) => y.id !== s.id).map((y) => ({ id: y.id, name: y.name, pin: y.pin, settings: y.settings })));
    await reloadCfg(); editStore = null; editFrom = null; toast('削除しました'); render();
  }

  /* ======================================================================
     時刻表
     テンプレート（毎日・曜日・日付）× 行（出走時刻・払い戻し合計）。
     サーバーの Rule は 1 つに payout が 1 つなので、保存のときに「同じ払い戻し額の行」ごとに Rule に分ける（tpl で元のテンプレートに戻す）。
     ====================================================================== */
  function ruleRows(r) {
    const out = [];
    const def = Number(r.payout) || 0;
    if (Array.isArray(r.races)) r.races.forEach((x) => out.push({ t: x.time || x.at, p: x.payout == null ? def : x.payout }));
    else if (Array.isArray(r.times) && r.times.length) r.times.forEach((x) => (typeof x === 'string' ? out.push({ t: x, p: def }) : out.push({ t: x.time || x.at, p: x.payout == null ? def : x.payout })));
    else if (r.from && r.to && r.everyMin) { const f = toMin(r.from), t = toMin(r.to), e = Math.max(1, +r.everyMin); if (!isNaN(f) && !isNaN(t)) for (let m = f; m <= t; m += e) out.push({ t: fromMin(m), p: def }); }
    return out;
  }
  function loadTT() {
    const map = new Map(), tpls = [];
    cfg.rules.forEach((r) => {
      const key = r.tpl || (r.id ? String(r.id).split('~')[0] : nk()); // サーバーが tpl を残さなくても、id の「~」より前で元のテンプレートに戻せる
      let t = map.get(key);
      if (!t) {
        t = { k: nk(), id: key, name: r.name || '', enabled: r.enabled !== false, kind: r.kind || 'daily', weekdays: (r.weekdays || []).slice(), date: r.date || '', storeId: r.storeId || null, scope: r.scope || 'all', rows: [] };
        map.set(key, t); tpls.push(t);
      }
      ruleRows(r).forEach((x) => t.rows.push({ k: nk(), t: x.t, p: String(x.p) }));
    });
    tpls.forEach((t) => sortRows(t));
    tt = { tpls };
    ttOrig = new Set(); tpls.forEach((t) => t.rows.forEach((r) => ttOrig.add(t.id + '|' + r.t)));
    ttDirty = false;
  }
  const sortRows = (t) => t.rows.sort((a, b) => { const x = toMin(a.t), y = toMin(b.t); return (isNaN(x) ? 1e9 : x) - (isNaN(y) ? 1e9 : y); });
  const tplName = (t) => t.name || (t.kind === 'daily' ? '毎日' : t.kind === 'weekday' ? '曜日: ' + (t.weekdays.length ? t.weekdays.slice().sort().map((d) => WD[d]).join('') : 'まだ選んでいない') : '日付: ' + (t.date ? fmtDay(t.date) : 'まだ選んでいない'));
  // 閉じた札の 1 行: いつ・店舗・件数・時間帯・払い戻し
  function tplSummary(t) {
    const kind = tplName(Object.assign({}, t, { name: '' })), ts = t.rows.map((r) => r.t).filter((x) => !isNaN(toMin(x))).sort(), ps = t.rows.map((r) => Number(r.p)).filter((p) => p > 0);
    const lo = ps.length ? Math.min.apply(null, ps) : 0, hi = ps.length ? Math.max.apply(null, ps) : 0;
    return [t.name ? kind : '', t.storeId ? storeName(t.storeId) + 'だけ' : '', t.rows.length + ' レース', ts.length ? ts[0] + '〜' + ts[ts.length - 1] : '', ps.length ? '目標 ' + (lo === hi ? fmtN(lo) : fmtN(lo) + '〜' + fmtN(hi)) : ''].filter(Boolean).join('・');
  }
  function templatesToRules(tpls) {
    const rules = [];
    tpls.forEach((t) => {
      const groups = new Map();
      t.rows.forEach((r) => { const p = Number(r.p); if (!groups.has(p)) groups.set(p, []); groups.get(p).push(r.t); });
      const base = { tpl: t.id, name: t.name || '', enabled: t.enabled, kind: t.kind, weekdays: t.kind === 'weekday' ? t.weekdays.slice().sort() : [], date: t.kind === 'date' ? t.date : '', scope: t.storeId ? 'store' : t.scope, storeId: t.storeId || null };
      let i = 0;
      groups.forEach((times, p) => { rules.push(Object.assign({ id: i ? t.id + '~' + i : t.id, times: times.slice().sort(), payout: p, races: times.slice().sort().map((x) => ({ time: x, payout: p })) }, base)); i++; });
    });
    return rules;
  }
  // その日・その店に適用されるテンプレート（サーバーと同じ決まり: 日付 → 曜日 → 毎日。全店の決まりと店舗ごとの決まりは別々に判定）
  function dayTpls(tpls, d, group) {
    const mine = tpls.filter((t) => t.enabled && (t.storeId || null) === group);
    let pick = mine.filter((t) => t.kind === 'date' && t.date === d);
    if (!pick.length) pick = mine.filter((t) => t.kind === 'weekday' && t.weekdays.indexOf(wdOf(d)) >= 0);
    if (!pick.length) pick = mine.filter((t) => t.kind === 'daily');
    return pick;
  }
  // その日・その店で実際に走るレース（storeId=null なら全店同時のレースだけ）
  // collide（配列）を渡すと、別のテンプレートどうしで同じ時刻になった組を入れる（サーバーは黙って下のテンプレートを使うので、画面ではエラーにする）
  function daySchedule(tpls, d, storeId, collide) {
    const out = [];
    [null].concat(storeId ? [storeId] : []).forEach((g) => {
      const byTime = new Map(); // 同じ時刻が重なったら後ろの決まりが勝つ
      dayTpls(tpls, d, g).forEach((t) => t.rows.forEach((r) => { const m = toMin(r.t); if (isNaN(m)) return; const old = byTime.get(m); if (old && old.tpl !== t && collide) collide.push([old, { t: r.t, tpl: t, row: r }]); byTime.set(m, { m, t: r.t, p: Number(r.p), tpl: t, row: r, group: g }); }));
      byTime.forEach((v) => out.push(v));
    });
    return out.sort((a, b) => a.m - b.m || (a.group ? 1 : -1));
  }
  function minGapSec() {
    const T = cfg.tuning;
    // 受付の長さ = 参加受付 + 投票（2026-10-16）。全体の初期値と、いちばん長い店のほう
    const all = [stagesOf(T, T)].concat(cfg.stores.map((s) => sset(s))).map((x) => ({ ex: x.exchangeSec, vo: x.voteSec, sum: x.exchangeSec + x.voteSec }));
    const top = all.reduce((a, x) => (x.sum > a.sum ? x : a), all[0]), bet = top.sum;
    return { sec: bet + (T.gateSec || 0) + RUN_SEC + (T.postSec || 0), bet, ex: top.ex, vo: top.vo, gate: T.gateSec || 0, post: T.postSec || 0 };
  }
  function validateTT() {
    const rowErr = new Map(), rowWarn = new Map(), tplErr = new Map(), list = [];
    const addR = (m, r, msg) => { if (!m.has(r.k)) m.set(r.k, []); if (m.get(r.k).indexOf(msg) < 0) m.get(r.k).push(msg); };
    const addT = (t, msg) => { if (!tplErr.has(t.k)) tplErr.set(t.k, []); if (tplErr.get(t.k).indexOf(msg) < 0) tplErr.get(t.k).push(msg); };
    const pushList = (x) => { if (list.length < 200 && list.indexOf(x) < 0) list.push(x); };
    const today = todayStr(), nowM = toMin(hm(now()));
    const storeIds = cfg.stores.map((s) => s.id);
    tt.tpls.forEach((t) => {
      if (t.kind === 'weekday' && !t.weekdays.length) addT(t, '曜日を選んでください');
      if (t.kind === 'date') { if (!isDate(t.date)) addT(t, '日付を入れてください'); else if (t.date < today) addT(t, '過去の日付です'); }
      if (t.storeId && storeIds.indexOf(t.storeId) < 0) addT(t, '店舗がありません（削除された店舗）');
      const seen = new Map();
      t.rows.forEach((r) => {
        const m = toMin(r.t);
        if (isNaN(m)) addR(rowErr, r, '時刻を入れてください');
        else { if (seen.has(m)) { addR(rowErr, r, '同じ時刻が 2 つあります'); addR(rowErr, seen.get(m), '同じ時刻が 2 つあります'); } else seen.set(m, r); }
        const p = String(r.p).trim();
        if (!/^\d+$/.test(p) || +p < 1 || +p > PAY_MAX) addR(rowErr, r, '当選額の目標は 1〜' + fmtN(PAY_MAX) + ' の整数（100 単位に丸めて保存）');
        if (t.kind === 'date' && t.date === today && !isNaN(m) && m <= nowM && !ttOrig.has(t.id + '|' + r.t)) addR(rowErr, r, 'もう過ぎた時刻です');
      });
    });
    // 近すぎるレース（最短間隔より近い）: 今日から 14 日分と、日付テンプレートの日で、店ごとに確かめる
    const gap = minGapSec().sec;
    const days = new Set(); for (let i = 0; i < 14; i++) days.add(addDays(today, i));
    tt.tpls.forEach((t) => { if (t.kind === 'date' && isDate(t.date) && t.date >= today) days.add(t.date); });
    const groups = storeIds.length ? storeIds : [null];
    Array.from(days).sort().forEach((d) => groups.forEach((sid) => {
      const col = [], sc = daySchedule(tt.tpls, d, sid, col);
      col.forEach((c) => { const msg = c[0].t + ' が「' + tplName(c[0].tpl) + '」と「' + tplName(c[1].tpl) + '」で同じ時刻です（下の予定だけが使われます）'; addR(rowErr, c[0].row, msg); addR(rowErr, c[1].row, msg); pushList(fmtDay(d) + ' ' + (c[0].row && (c[0].tpl.storeId || c[1].tpl.storeId) ? storeName(sid) : '全店') + ': ' + msg); });
      for (let i = 1; i < sc.length; i++) {
        const a = sc[i - 1], b = sc[i], diff = (b.m - a.m) * 60;
        if (diff < gap) {
          const where = (a.tpl === b.tpl ? '' : '（「' + tplName(a.tpl) + '」と「' + tplName(b.tpl) + '」）');
          const msg = diff === 0 ? a.t + ' に 2 つのレースが重なっています' + where : a.t + ' と ' + b.t + ' が近すぎます（' + secTxt(gap) + ' 以上あける）' + where;
          addR(rowErr, a.row, a.tpl === b.tpl ? (diff === 0 ? '重なっています' : '次のレースと近すぎます') : msg);
          addR(rowErr, b.row, a.tpl === b.tpl ? (diff === 0 ? '重なっています' : '前のレースと近すぎます') : msg);
          pushList(fmtDay(d) + ' ' + (a.group || b.group ? storeName(sid) : '全店') + ': ' + msg);
        }
      }
    }));
    tt.tpls.forEach((t) => { if (!t.rows.length) addT(t, 'レースを 1 つ以上入れてください（使わない予定は × で消せます）'); });
    let n = 0; rowErr.forEach((v) => { n += v.length ? 1 : 0; }); tplErr.forEach((v) => { n += v.filter(Boolean).length; });
    return { rowErr, rowWarn, tplErr, list, n };
  }
  function viewTT() {
    const g = minGapSec();
    const stores = cfg.stores;
    const tplHtml = (t, i) => {
      const scopeSel = '<select data-tf="storeId">' + '<option value="">全店（同時）</option>' + stores.map((s) => '<option value="' + esc(s.id) + '"' + (t.storeId === s.id ? ' selected' : '') + '>' + esc(s.name) + 'だけ</option>').join('') + (t.storeId && !stores.some((s) => s.id === t.storeId) ? '<option value="' + esc(t.storeId) + '" selected>' + esc(t.storeId) + '（削除済み）</option>' : '') + '</select>';
      const cond = t.kind === 'weekday' ? '<div class="wdays">' + [1, 2, 3, 4, 5, 6, 0].map((d) => '<label class="' + (t.weekdays.indexOf(d) >= 0 ? 'on' : '') + '"><input type="checkbox" data-wd="' + d + '"' + (t.weekdays.indexOf(d) >= 0 ? ' checked' : '') + '>' + WD[d] + '</label>').join('') + '</div>'
        : t.kind === 'date' ? '<input type="date" data-tf="date" value="' + esc(t.date) + '">' : '<div class="hint" style="margin:0;padding-top:18px">曜日・日付の予定がない日に使います</div>';
      const open = tplOpen.has(t.id);
      return '<div class="tpl' + (t.enabled ? '' : ' off') + (open ? ' open' : '') + '" data-tk="' + t.k + '">' +
        /* 閉じた札: 名前・いつ・件数・時間帯・払い戻し・要確認。押すと開く */
        '<div class="tpl-top"><button type="button" class="open-btn" data-act="tpl-open" aria-expanded="' + open + '"><b data-tname>' + esc(tplName(t)) + '</b><span class="sum" data-sum>' + esc(tplSummary(t)) + '</span><span class="chip ng" data-terrn hidden></span><span class="ol"></span></button>' +
        '<button type="button" class="btn xs onoff' + (t.enabled ? ' on' : '') + '" data-act="tpl-on" title="押すと切り替え">' + (t.enabled ? 'ON 使用中' : 'OFF 停止中') + '</button></div>' +
        '<div class="tpl-body">' +
        '<div class="tpl-head"><input type="text" class="name" data-tf="name" value="' + esc(t.name) + '" placeholder="' + esc(tplName(Object.assign({}, t, { name: '' }))) + '" maxlength="30" aria-label="予定の名前">' +
        '<span class="chip info" data-cnt>' + t.rows.length + ' レース</span>' +
        '<button type="button" class="icon" data-act="tpl-up" aria-label="上へ"' + (i ? '' : ' disabled') + '>↑</button><button type="button" class="icon" data-act="tpl-down" aria-label="下へ"' + (i < tt.tpls.length - 1 ? '' : ' disabled') + '>↓</button>' +
        '<button type="button" class="btn xs ghost" data-act="tpl-dup">コピー</button><button type="button" class="icon del" data-act="tpl-del" aria-label="この予定を消す">×</button></div>' +
        '<div class="tpl-cond"><label class="f"><span>いつ</span><select data-tf="kind"><option value="daily"' + (t.kind === 'daily' ? ' selected' : '') + '>毎日</option><option value="weekday"' + (t.kind === 'weekday' ? ' selected' : '') + '>曜日を選ぶ</option><option value="date"' + (t.kind === 'date' ? ' selected' : '') + '>日付を選ぶ</option></select></label>' +
        '<div class="f">' + (t.kind === 'daily' ? '' : '<span class="hint" style="display:block;margin:0 0 4px">' + (t.kind === 'weekday' ? '曜日' : '日付') + '</span>') + cond + '</div>' +
        '<label class="f"><span>走る店舗</span>' + scopeSel + '</label>' +
        '<label class="f"><span>当選額の目標は</span><select data-tf="scope"' + (t.storeId ? ' disabled' : '') + '><option value="all"' + (t.scope !== 'store' || t.storeId ? ' selected' : '') + '>全店で 1 つ</option><option value="store"' + (t.scope === 'store' && !t.storeId ? ' selected' : '') + '>店舗ごとに 1 つずつ</option></select></label></div>' +
        '<div class="err" data-terr></div>' +
        '<div class="bulk"><b class="bt">まとめて作る</b>' +
        '<label class="f"><span>開始</span><input type="time" data-bf="from" value="19:00"></label><span class="t">〜</span>' +
        '<label class="f"><span>終了</span><input type="time" data-bf="to" value="23:00"></label>' +
        '<label class="f"><span>何分おき</span><input type="number" data-bf="every" value="5" min="1" max="180"></label>' +
        '<label class="f"><span>当選額の目標</span><input type="number" data-bf="pay" value="30000" min="1" max="' + PAY_MAX + '" step="100"></label>' +
        '<button type="button" class="btn sm ghost" data-act="bulk">まとめて作る</button></div>' +
        (t.rows.length > ROWS_SHOWN ? '<div class="acts l rowsbar"><label class="find"><span>時刻で探す</span><input type="time" data-find aria-label="この時刻のレースへ移る"></label><small class="hint" style="margin:0">' + t.rows.length + ' レースのうち、入れた時刻の行へ移ります</small></div>' : '') +
        '<div class="tbl"><table class="tt-rows"><tr><th>#</th><th>発走</th><th>当選額の目標</th><th></th><th></th></tr>' +
        (t.rows.length ? t.rows.map((r, j) => '<tr data-rk="' + r.k + '"' + (j >= ROWS_SHOWN && !tplAll.has(t.id) ? ' class="more"' : '') + '><td class="no">' + (j + 1) + '</td><td><input type="time" data-rf="t" value="' + esc(r.t) + '" aria-label="出走時刻"></td>' +
          '<td><input type="number" class="pay" data-rf="p" value="' + esc(r.p) + '" min="1" max="' + PAY_MAX + '" step="1" inputmode="numeric" aria-label="当選額の目標"></td><td class="msg"></td>' +
          '<td class="ops"><button type="button" class="icon" data-act="row-dup" aria-label="この行をコピー" title="この行をコピー（次の時刻に）">⧉</button><button type="button" class="icon del" data-act="row-del" aria-label="この行を消す" title="この行を消す">×</button></td></tr>').join('')
          : '<tr><td colspan="5" class="empty">まだレースがありません。上の「まとめて作る」で入れてください</td></tr>') +
        '</table></div>' +
        (t.rows.length > ROWS_SHOWN ? '<div class="acts l rowsbar" style="margin-top:6px"><button type="button" class="btn sm ghost" data-act="tpl-rows" data-rowsbtn>' + (tplAll.has(t.id) ? '最初の ' + ROWS_SHOWN + ' 件だけ表示' : '残り ' + (t.rows.length - ROWS_SHOWN) + ' 件を表示（' + t.rows[ROWS_SHOWN].t + '〜）') + '</button></div>' : '') +
        '<div class="acts l" style="margin-top:6px"><button type="button" class="btn sm ghost" data-act="row-add">＋ 1 行追加</button><button type="button" class="btn xs ghost" data-act="row-sort">時刻順に並べる</button><button type="button" class="btn xs ghost" data-act="row-payall">目標を全部そろえる</button><button type="button" class="btn xs ghost" data-act="row-clear"' + (t.rows.length ? '' : ' disabled') + '>全部消す</button></div>' +
        '</div></div>';
    };
    const side = '<div class="side"><div class="panel"><h3>この日の予定</h3>' +
      '<div class="grid2" style="grid-template-columns:1fr 1fr"><label class="f"><span>日付</span><input type="date" id="pvdate" value="' + esc(pvDate || todayStr()) + '"></label>' +
      '<label class="f"><span>店舗</span><select id="pvstore"><option value="">全店（同時）</option>' + stores.map((s) => '<option value="' + esc(s.id) + '"' + (pvStore === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label></div>' +
      '<div class="seg pvseg"><button type="button" class="' + (pvSrc === 'local' ? 'on' : '') + '" aria-pressed="' + (pvSrc === 'local') + '" data-act="pv-local">変更後</button><button type="button" class="' + (pvSrc === 'server' ? 'on' : '') + '" aria-pressed="' + (pvSrc === 'server') + '" data-act="pv-server">保存済み</button></div>' +
      '<div id="pvbox"></div></div></div>';
    return '<div class="panel"><h3>時刻表を変える</h3>' +
      '<p class="hint" style="margin-bottom:0">予定を押すと開きます。レースとレースの間は <b>' + secTxt(g.sec) + ' 以上</b>あけてください。</p>' +
      '<details class="fold"><summary>くわしく</summary><div class="in">' +
      '<p class="hint">最短間隔 ' + secTxt(g.sec) + ' ＝ 参加受付 ' + g.ex + ' 秒＋投票 ' + g.vo + ' 秒＋ゲートイン ' + g.gate + ' 秒＋レース約 ' + RUN_SEC + ' 秒＋ゴール後 ' + g.post + ' 秒。</p>' +
      '<p class="hint">当選額の目標＝そのレースで当たる額の合計の目安（チップ × オッズ）。100 単位に丸めて保存します。</p>' +
      '<p class="hint">その日に<b>日付の予定があればそれだけ → なければ曜日 → なければ毎日</b>を使います。全店の予定と店舗だけの予定は別々に選ばれ、両方走ります。同じ時刻は下の予定が使われます。</p>' +
      '<p class="hint">近すぎる・重なる・過去の時刻・おかしな値があると保存できません。保存すると、まだ作られていないこれからのレースに反映されます。</p>' +
      '</div></details></div>' +
      '<div class="tt-layout"><div>' + (tt.tpls.length ? tt.tpls.map(tplHtml).join('') : '<div class="panel"><div class="empty">まだ予定がありません。下のボタンで作ってください。</div></div>') +
      '<div class="acts l"><button type="button" class="btn ghost" data-act="tpl-add" data-kind="daily">＋ 毎日の予定</button><button type="button" class="btn ghost" data-act="tpl-add" data-kind="weekday">＋ 曜日の予定</button><button type="button" class="btn ghost" data-act="tpl-add" data-kind="date">＋ 日付の予定</button></div>' +
      '</div>' + side + '</div>' +
      '<div class="savebar"><div class="msg" id="ttmsg"></div><button type="button" class="btn ghost" data-act="tt-revert">元に戻す</button><button type="button" class="btn" data-act="tt-save" id="ttsave">保存</button></div>';
  }
  // 入力のたびに: 警告を出し直す（画面は作り直さない＝入力中の欄のフォーカスが外れない）
  function paintTT() {
    if (!tt || !$('ttmsg')) return;
    const v = validateTT();
    tt.tpls.forEach((t) => {
      const box = main.querySelector('[data-tk="' + t.k + '"]'); if (!box) return;
      const te = (v.tplErr.get(t.k) || []).filter(Boolean);
      box.querySelector('[data-terr]').innerHTML = te.map(esc).join('<br>');
      let bad = te.length > 0;
      t.rows.forEach((r) => {
        const tr = box.querySelector('[data-rk="' + r.k + '"]'); if (!tr) return;
        const es = v.rowErr.get(r.k) || [];
        const m = toMin(r.t), p = String(r.p).trim();
        tr.querySelector('[data-rf="t"]').classList.toggle('bad', es.length > 0 && (isNaN(m) || es.some((x) => !/当選額の目標/.test(x))));
        tr.querySelector('[data-rf="p"]').classList.toggle('bad', !/^\d+$/.test(p) || +p < 1 || +p > PAY_MAX);
        tr.querySelector('.msg').innerHTML = es.length ? '<div class="err">' + es.map(esc).join('<br>') + '</div>' : ''; // 問題のない行は何も出さない（エラーだけ赤字）
        if (es.length) bad = true;
      });
      box.classList.toggle('has-err', bad);
      if (bad && !tplAll.has(t.id) && box.querySelector('tr.more .bad, tr.more .err')) { tplAll.add(t.id); box.querySelectorAll('tr.more').forEach((x) => x.classList.remove('more')); const rb = box.querySelector('[data-rowsbtn]'); if (rb) rb.textContent = '最初の ' + ROWS_SHOWN + ' 件だけ表示'; } // 隠れた行にエラーがあれば全部出す
      const cnt = box.querySelector('[data-cnt]'); if (cnt) cnt.textContent = t.rows.length + ' レース';
      const nErr = te.length + t.rows.filter((r) => (v.rowErr.get(r.k) || []).length).length, badge = box.querySelector('[data-terrn]');
      if (badge) { badge.hidden = !nErr; badge.textContent = '要確認 ' + nErr + ' 件'; }
      const sm = box.querySelector('[data-sum]'); if (sm) sm.textContent = tplSummary(t);
      const tn = box.querySelector('[data-tname]'); if (tn) tn.textContent = tplName(t);
      if (bad && !tplOpen.has(t.id)) { tplOpen.add(t.id); box.classList.add('open'); const ob = box.querySelector('[data-act="tpl-open"]'); if (ob) ob.setAttribute('aria-expanded', 'true'); } // エラーのある札は開く
    });
    const n = v.n;
    $('ttmsg').innerHTML = n ? '<div class="err">エラーが ' + n + ' 件あります（赤い欄）。直すと保存できます。' + (v.list[0] ? '<br><small>' + esc(v.list[0]) + (v.list.length > 1 ? ' ほか' : '') + '</small>' : '') + '</div>'
      : ttDirty ? '<div class="warnmsg">保存していない変更があります</div>' : '<div class="okmsg">保存済みです</div>';
    $('ttsave').disabled = n > 0 || !ttDirty;
    paintPreview();
  }
  function paintPreview() {
    const box = $('pvbox'); if (!box) return;
    const d = pvDate || todayStr();
    let items;
    if (pvSrc === 'server') {
      if (!pvServer) { box.innerHTML = '<div class="empty">読み込み中…</div>'; return; }
      if (pvServer.err) { box.innerHTML = '<div class="err">' + esc(pvServer.err) + '</div>'; return; }
      items = pvServer.races.map((r) => ({ t: r.time || hm(r.at), p: r.payout, store: r.storeId, name: r.scope === 'store' && !r.storeId ? '店舗ごと' : '' }));
    } else {
      if (!isDate(d)) { box.innerHTML = '<div class="empty">日付を入れてください</div>'; return; }
      items = daySchedule(tt.tpls, d, pvStore || null).map((x) => ({ t: x.t, p: x.p, store: x.group, name: tplName(x.tpl), scope: x.tpl.scope }));
    }
    const isToday = d === todayStr(), nm = toMin(hm(now()));
    const total = items.reduce((a, x) => a + (Number(x.p) || 0), 0);
    box.innerHTML = '<div class="summary" style="grid-template-columns:1fr 1fr"><div class="stat"><small>レース数</small><b>' + items.length + '</b></div><div class="stat"><small>当選額の目標の合計</small><b>' + fmtN(total) + '</b></div></div>' +
      (items.length ? '<div class="pv-list"><table><tr><th>時刻</th><th>店舗</th><th class="n">目標</th><th>予定</th></tr>' + items.map((x) => '<tr class="' + (isToday && toMin(x.t) < nm ? 'past' : '') + '"><td>' + esc(x.t) + '</td><td>' + esc(storeName(x.store)) + (!x.store && x.scope === 'store' ? '<small class="hint"> 店ごと</small>' : '') + '</td><td class="n">' + fmtN(x.p) + '</td><td><small class="hint">' + esc(x.name || '') + '</small></td></tr>').join('') + '</table></div>'
        : '<div class="empty">この日はレースがありません</div>');
  }
  async function loadServerPreview() {
    pvServer = null; paintPreview();
    try { const r = await api('preview', pvDate || todayStr(), pvStore || undefined); pvServer = { races: (r && r.races) || [] }; }
    catch (e) { pvServer = { err: errText(e), races: [] }; }
    paintPreview();
  }
  function ttTouched() { ttDirty = true; paintTT(); }
  const tplOf = (el) => { const box = el.closest('[data-tk]'); return box && tt.tpls.find((t) => t.k === box.dataset.tk); };
  const rowOf = (t, el) => { const tr = el.closest('[data-rk]'); return tr && t.rows.find((r) => r.k === tr.dataset.rk); };
  function ttRerender() { keepScroll(() => { main.innerHTML = viewTT(); paintTT(); }); }
  function addTpl(kind) {
    const t = { k: nk(), id: 'tt' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: '', enabled: true, kind, weekdays: kind === 'weekday' ? [6, 0] : [], date: kind === 'date' ? addDays(todayStr(), 1) : '', storeId: null, scope: 'all', rows: [] };
    tt.tpls.push(t); tplOpen.add(t.id); ttDirty = true; ttRerender();
    const box = main.querySelector('[data-tk="' + t.k + '"]'); if (box) box.scrollIntoView({ block: 'center' });
  }
  function bulkCreate(t, box) {
    const q = (f) => box.querySelector('[data-bf="' + f + '"]');
    const f = toMin(q('from').value), to = toMin(q('to').value), ev = Number(q('every').value), p = String(q('pay').value).trim();
    const bad = [];
    if (isNaN(f) || isNaN(to)) bad.push('開始と終了の時刻を入れてください'); else if (to < f) bad.push('終了は開始より後にしてください（日をまたぐときは 2 つに分けてください）');
    if (!(ev >= 1 && ev <= 180 && Math.floor(ev) === ev)) bad.push('何分おきは 1〜180 の整数');
    if (!/^\d+$/.test(p) || +p < 1 || +p > PAY_MAX) bad.push('当選額の目標は 1〜' + fmtN(PAY_MAX) + ' の整数');
    if (bad.length) { toast(bad[0]); return; }
    const have = new Set(t.rows.map((r) => toMin(r.t)));
    let add = 0, skip = 0;
    for (let m = f; m <= to; m += ev) { if (have.has(m)) { skip++; continue; } t.rows.push({ k: nk(), t: fromMin(m), p }); add++; }
    sortRows(t); ttDirty = true; ttRerender();
    toast(add + ' レースを追加しました' + (skip ? '（同じ時刻の ' + skip + ' 件は飛ばしました）' : ''));
  }
  async function saveTT() {
    const v = validateTT(); if (v.n) { paintTT(); return; }
    tt.tpls.forEach(sortRows);
    const rules = templatesToRules(tt.tpls);
    // 開いてから、ほかの画面（別のタブ・別の人）で時刻表が保存されていたら、上書きしてよいか聞く
    const loaded = JSON.stringify(cfg.rules), fresh = normCfg(await api('config'));
    if (JSON.stringify(fresh.rules) !== loaded && !confirm('この画面を開いたあとに、ほかの画面で時刻表が保存されています。\nこの画面の内容で上書きしますか？（キャンセルすると保存しません。「元に戻す」で最新を読み込めます）')) { cfg = fresh; return; }
    await api('saveTimetable', rules);
    await reloadCfg();
    loadTT(); pvServer = null; ttRerender();
    if (pvSrc === 'server') loadServerPreview();
    toast('時刻表を保存しました（' + rules.length + ' 件の決まり）');
  }

  /* ======================================================================
     今日のレース（実際のレース一覧）
     ====================================================================== */
  async function loadRaces(quiet) {
    const sig = () => JSON.stringify([racesData, racesErr, (racesData || []).map((r) => statusOf(r) + (r.endAt && r.endAt < now() ? 'p' : ''))]), before = sig();
    // 読んでいる間に日付を変えたら、古い日付の答えで上書きしない（10 秒ごとの読み直しが「前の日」の画面に今日のレースを出していた。コードレビュー 2026-10-14）
    const d = raceDate, my = (loadRaces.seq = (loadRaces.seq || 0) + 1);
    try { const r = await api('races', d); if (my !== loadRaces.seq || d !== raceDate) return; racesData = (r && r.races) || []; racesErr = ''; }
    catch (e) { if (my !== loadRaces.seq || d !== raceDate) return; racesErr = errText(e); if (!quiet) racesData = []; }
    if (quiet && sig() === before) return; // 10 秒ごとの読み直しで何も変わっていなければ描き直さない（日付の入力・ボタンを押している途中を消さない）
    if (tab === 'races') keepScroll(() => { main.innerHTML = viewRaces(); });
  }
  // 管理用の一覧は店舗を指定しないので、受付中かどうかは時刻で判定する
  const statusOf = (r) => { if (r.refunded || r.status === 'void') return 'void'; const t = now(); if (r.status === 'upcoming' && r.openAt <= t && t < r.closeAt) return r.exchangeCloseAt != null && t >= r.exchangeCloseAt ? 'vote' : 'open'; return r.status; };
  /* 1 着の選び方（decision.reason。v2/outcome.js） */
  function reasonTxt(d) {
    if (!d || !d.reason) return '';
    const n = d.band && d.band.horses ? d.band.horses.length : 0;
    const t = { band: '幅の中から抽選' + (n ? '（候補 ' + n + ' 頭）' : ''), target: 'いちばん近い馬', cap_conflict: '上限超え（当たり優先）', nobody: '賭けなし' }[d.reason] || d.reason;
    return '<small class="hint" style="display:block;margin:0">' + esc(t) + '</small>';
  }
  function horseTxt(r, h) { if (h == null || !r.horses || !r.horses[h]) return '—'; const x = r.horses[h]; return (x.no || h + 1) + ' ' + x.name; }
  /* 2026-10-19 改善 2: 今日のレース = 「いまのレース」のカード → 数字 4 つ → これから（3 件）→ 終わったレース（新しい順に 5 件。残りは「ほか○件」で開く）。
     レース取消（返還）は行の下にその場で開く（設定の画面へ移らない）。ChatGPT と壁打ちして決めた（deploy/ADMIN_SIMPLE_NOTES.md） */
  const leftTxt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 60 ? Math.floor(s / 60) + '分' + pad(s % 60) + '秒' : s + '秒'; };
  function nowCard(list, isToday) {
    if (!isToday) return '';
    const t = now(), cur = list.find((r) => statusOf(r) === 'open' || statusOf(r) === 'vote'), next = list.find((r) => r.status === 'upcoming' && r.openAt > t && r !== cur);
    const live = list.find((r) => r.status === 'closed' || r.status === 'decided');
    if (cur) {
      const vote = statusOf(cur) === 'vote', until = vote ? cur.closeAt : (cur.exchangeCloseAt || cur.closeAt);
      return '<div class="nowcard"><div class="big"><b class="mono">' + hm(cur.at) + '</b> <span class="status ' + (STATUS[statusOf(cur)] || STATUS.open)[1] + '">' + (vote ? '投票中' : '受付中') + '</span></div>' +
        '<div class="sub">' + (vote ? '投票の締切まで ' : '受付の終わりまで ') + '<b data-until="' + until + '">' + leftTxt(until - t) + '</b>・参加 ' + fmtN(cur.participants && cur.participants.total) + '人' + (next ? '・次は ' + hm(next.at) : '') + '</div></div>';
    }
    if (live) return '<div class="nowcard"><div class="big"><b class="mono">' + hm(live.at) + '</b> <span class="status st-decided">レース中</span></div><div class="sub">参加 ' + fmtN(live.participants && live.participants.total) + '人' + (next ? '・次は ' + hm(next.at) : '') + '</div></div>';
    if (next) return '<div class="nowcard"><div class="big">次のレース <b class="mono">' + hm(next.at) + '</b></div><div class="sub">受付が始まるまで <b data-until="' + next.openAt + '">' + leftTxt(next.openAt - t) + '</b></div></div>';
    return '<div class="nowcard"><div class="big">今日のレースは終わりました</div></div>';
  }
  function viewRaces() {
    const list = racesData || [];
    const sum = list.reduce((a, r) => { a.bet += r.betTotal || 0; a.target += r.payoutTarget || 0; if (r.status === 'done' || r.status === 'decided') { a.paid += r.paidTotal || 0; a.done++; } a.players += (r.participants && r.participants.total) || 0; return a; }, { bet: 0, paid: 0, target: 0, done: 0, players: 0 });
    const isToday = raceDate === bizToday();
    /* これから（受付中を含む。近い順に 3 件）と、終わったレース（新しい順）。取り消したレースはいつも見せる */
    const coming = list.filter((r) => r.status === 'upcoming'), done = list.filter((r) => r.status !== 'upcoming').reverse();
    const shownDone = raceAll ? done : done.filter((r, i) => i < 5 || r.refunded || r.status === 'void' || r.id === refundOpen);
    const hidden = done.length - shownDone.length + Math.max(0, coming.length - 3);
    const rows = coming.slice(0, raceAll ? coming.length : 3).concat(shownDone);
    /* 1 行（PC は表、スマホはカード。td の data-l がカードの見出し）。勝ち馬の決まり方・演出は「勝ち馬の決まり方を見る」のときだけ */
    const td = (l, html, cls) => '<td' + (cls ? ' class="' + cls + '"' : '') + (l ? ' data-l="' + l + '"' : '') + '>' + html + '</td>';
    const row = (r) => {
      const stK = statusOf(r), st = STATUS[stK] || [r.status, 'st-upcoming'];
      const res = r.result, w = res ? res.winner : null;
      const canRefund = ['closed', 'decided', 'done'].indexOf(r.status) >= 0 && !r.refunded;
      const paid = r.status === 'decided' || r.status === 'done' ? fmtN(r.paidTotal) : '—';
      const open = refundOpen === r.id && canRefund;
      return '<tr class="' + (stK === 'open' || stK === 'vote' ? 'now' : r.status === 'upcoming' ? '' : 'past') + (r.refunded ? ' voided' : '') + (open ? ' rfopen' : '') + '">' +
        td('', '<b class="mono" style="font-size:15px">' + hm(r.at) + '</b>' + (r.storeId || r.scope === 'store' ? '<small class="hint"> ' + (r.storeId ? esc(storeName(r.storeId)) + 'だけ' : '店ごと') + '</small>' : ''), 'head') +
        td('', '<span class="status ' + st[1] + '">' + (r.refunded ? '取り消し済み' : st[0]) + '</span>' + (r.refunded ? ' <small class="hint">リングバウンティ ' + fmtN(r.refundBounty != null ? r.refundBounty : r.refundTotal) + '枚を返す</small>' : '')) +
        (r.status === 'upcoming' && !(r.participants && r.participants.total) ? td('', '', 'n') + td('', '', 'n') + td('目標', fmtN(r.payoutTarget), 'n') /* これからのレースは 0 を並べない */
          : td('参加', fmtN(r.participants && r.participants.total) + '人', 'n') + td('チップ', chipN(r.betTotal), 'n') + td('当選額 / 目標', paid + ' / ' + fmtN(r.payoutTarget), 'n')) +
        td(res ? '1着' : '', res ? esc(horseTxt(r, w)) + ' <span class="hint">' + (res.finalOdds && res.finalOdds[w] != null ? per1(res.finalOdds[w]) : '') + '</span>' + (memoOn ? reasonTxt(r.decision) + cueTxt(r) : '') : '', 'full') +
        td('', canRefund && !open ? '<button class="btn xs ghost" data-act="race-refund" data-id="' + esc(r.id) + '" aria-expanded="false">レース取消</button>' : '', 'right') + '</tr>' +
        (open ? '<tr class="rfrow"><td colspan="7">' + refundBox(r) + '</td></tr>' : '');
    };
    return viewTvPanel() +
      '<div class="panel" id="racePanel"><h3>' + (isToday ? '今日のレース' : esc(fmtDay(raceDate)) + 'のレース') + '<span class="sp"></span>' + (isToday ? '<small class="auto">自動で更新</small>' : '') + '</h3>' +
      nowCard(list, isToday) +
      '<div class="summary"><div class="stat"><small>終わったレース</small><b>' + sum.done + ' / ' + list.length + '</b></div><div class="stat"><small>参加（のべ）</small><b>' + fmtN(sum.players) + '人</b></div><div class="stat"><small>賭けたチップ</small><b>' + chipN(sum.bet) + '</b></div><div class="stat"><small>当選額 / 目標</small><b>' + fmtN(sum.paid) + '<span class="of"> / ' + fmtN(sum.target) + '</span></b></div></div>' +
      (racesErr ? '<div class="err">' + esc(racesErr) + '</div>' : '') +
      (racesData == null ? '<div class="empty">読み込み中…</div>' : !list.length ? '<div class="empty">この日のレースはありません</div>' :
        '<div class="tbl"><table class="cards rl"><tr class="hd"><th>発走</th><th>状態</th><th class="n">参加</th><th class="n">賭けたチップ</th><th class="n">当選額 / 目標</th><th>1着（100チップの当選額）</th><th></th></tr>' +
        rows.map(row).join('') + '</table></div>' +
        (hidden || raceAll ? '<div class="acts l"><button class="btn sm ghost" data-act="race-all">' + (raceAll ? '少なく表示' : 'ほか ' + hidden + ' 件のレースを表示') + '</button></div>' : '')) +
      '<div class="datebar"><span class="hint" style="margin:0">ほかの日:</span><button class="btn sm ghost" data-act="rq" data-n="-1" aria-label="前の日">◀ 前の日</button><input type="date" id="rdate" value="' + esc(raceDate) + '" aria-label="日付"><button class="btn sm ghost" data-act="rq" data-n="1" aria-label="次の日">次の日 ▶</button>' + (isToday ? '' : '<button class="btn sm ghost" data-act="rq" data-n="0">今日へ</button>') + '</div>' +
      '<div class="acts l"><button class="btn link" data-act="memo" aria-pressed="' + memoOn + '">' + (memoOn ? '勝ち馬の決まり方を隠す' : '勝ち馬の決まり方を見る（オーナー用）') + '</button></div></div>';
  }
  /* その場のレース取消（返還）。中身は前の「設定」の返還と同じ（発走・参加・返すリングバウンティ・取り消す当選額）。押すと確認の文 → api('refund') */
  function refundBox(r) {
    return '<div class="rfbox" id="refundPanel"><b>' + esc(fmtDay(ymd(r.at))) + ' ' + hm(r.at) + ' のレースを取り消しますか？</b><small>参加 ' + fmtN(r.participants && r.participants.total) + ' 人・チップ ' + chipN(r.betTotal) + '</small>' +
      '<div class="rfnums"><div><small>返すリングバウンティ</small><b>' + fmtN(r.betBounty != null ? r.betBounty : r.betTotal) + '枚</b></div><div><small>取り消す当選額</small><b>' + fmtN(r.paidTotal) + '</b></div></div>' +
      '<div class="rfwarn">元に戻せません</div>' +
      '<div class="rfacts"><button class="btn ghost" data-act="race-refund" data-id="' + esc(r.id) + '">やめる</button><button class="btn danger" data-act="refund" data-id="' + esc(r.id) + '">取り消して返す</button></div></div>';
  }


  /* ======================================================================
     裏の調整（店舗マニュアルには出さない）
     ====================================================================== */
  function viewTuning() {
    const T = cfg.tuning;
    const cur = TUNE_PRESETS.find((p) => Math.abs(p[2].volatility - T.volatility) < 1e-6 && Math.abs(p[2].shiftUp - T.shiftUp) < 1e-6 && Math.abs(p[2].shiftDown - T.shiftDown) < 1e-6);
    return '<div class="backbar"><button type="button" class="btn sm ghost" data-act="go-ops">← 設定</button><h2>オーナー用の詳細設定</h2></div>' +
      '<p class="hint">店舗には見せない設定です。これから作るレースから使われます。</p>' +
      '<div class="panel"><h3>当たり方</h3>' +
      '<div class="quick"><span class="hint" style="margin:0">まとめて:</span>' + TUNE_PRESETS.map((p) => '<button type="button" class="btn sm ghost" aria-pressed="' + !!(cur && cur[0] === p[0]) + '" data-act="tpreset" data-p="' + p[0] + '" title="' + esc(p[3]) + '">' + p[1] + '</button>').join('') + '</div>' +
      stepRow('払い戻し率', '表示オッズの払い戻し率', 'payoutRate', Math.round(T.payoutRate * 100), '%', 50, 99, 1) +
      stepRow('荒れやすさ', '1.0 がふつう。大きいほど人気薄が勝つ', 'volatility', T.volatility, '倍', 0.3, 2.5, 0.1) +
      stepRow('確定オッズを上げる幅', '締切後、見せていたオッズより上げてよい幅', 'shiftUp', Math.round(T.shiftUp * 100), '%', 0, 30, 1) +
      stepRow('確定オッズを下げる幅', '0% ならお客さんが損をしない', 'shiftDown', Math.round(T.shiftDown * 100), '%', 0, 30, 1) +
      stepRow('当たりの幅（目標より少ない側）', '払い戻しの合計が目標より何%少なくてもよいか', 'bandBelow', Math.round(T.bandBelow * 100), '%', 0, 50, 1) +
      stepRow('当たりの幅（目標より多い側）', '払い戻しの合計が目標より何%多くてもよいか', 'bandAbove', Math.round(T.bandAbove * 100), '%', 0, 50, 1) +
      '<p class="hint" id="bandEx">' + bandExample(T.bandBelow, T.bandAbove) + '</p>' +
      stepRow('払い出しの上限（1 レース）', '0 = なし。当選額の合計（額）。必ず当たりのほうを優先', 'payoutCap', T.payoutCap || 0, '', 0, 99999900, 1000) +
      stepRow('払い出しの上限（1 日）', '0 = なし。全店の当選額の合計（額）' + (cfg.capDayOk ? '' : '（<b style="color:var(--warn)">サーバー側の対応待ち。まだ保存されません</b>）'), 'payoutCapDay', T.payoutCapDay || 0, '', 0, 999999900, 10000) +
      '</div>' +
      viewCues(T) +
      '<div class="panel"><h3>時間</h3><p class="hint">上の 3 つは<b>店舗を追加したときの初期値</b>。ゲートインとゴール後は全店共通です。</p>' +
      stepRow('参加受付の時間（初期値）', 'リングバウンティと交換できる時間', 'exchangeSec', T.exchangeSec != null ? T.exchangeSec : 90, '秒', 10, 1800, 5) +
      stepRow('投票の時間（初期値）', '参加受付が終わってから', 'voteSec', T.voteSec != null ? T.voteSec : 30, '秒', 10, 600, 5) +
      stepRow('結果を見せる時間（初期値）', '', 'resultSec', T.resultSec || 300, '秒', 10, 1800, 10) +
      stepRow('ゲートイン', '発走時刻からゲートが開くまで', 'gateSec', T.gateSec, '秒', 0, 60, 1) +
      stepRow('ゴール後', 'リプレイ・写真判定・勝ち馬（結果発表まで）', 'postSec', T.postSec, '秒', 0, 120, 1) +
      '</div>' +
      '<div class="savebar"><div class="msg" id="tumsg"></div><button type="button" class="btn ghost" data-act="tun-revert">元に戻す</button><button type="button" class="btn" data-act="tun-save" id="tusave">保存</button></div>';
  }
  /* 確定演出（店舗には見せない）: 演出ごとに「出す割合」と「当たる割合」を 1 行に。保存は下の「保存」ボタン（ほかの詳細の調整と一緒。変えた演出だけ送る） */
  function stepMini(label, key, val, unit, min, max, step) {
    return '<div class="mini"><span>' + label + '</span><div class="stepper" data-k="' + key + '" data-min="' + min + '" data-max="' + max + '" data-step="' + step + '"><button type="button" data-act="st" data-d="-1" aria-label="減らす">◀</button>' +
      '<input class="pv" type="number" inputmode="decimal" id="n-' + key + '" value="' + val + '" min="' + min + '" max="' + max + '" step="' + step + '" aria-label="' + esc(label) + '"><i>' + unit + '</i><button type="button" data-act="st" data-d="1" aria-label="増やす">▶</button></div></div>';
  }
  function viewCues(T) {
    const cz = T.cues || DEF_CUES;
    return '<div class="panel" id="cuesPanel"><h3>演出（店舗には見せない）</h3>' +
      '<p class="hint"><b>出す</b>＝その演出が出る割合、<b>当たる</b>＝出たときに本当の勝ち馬を指す割合。<b>100% ＝ 確定。外れたときは別の馬を指します。複数同時に出ることがあります</b>。</p>' +
      CUES.map(([k, name, how]) => { const c = cz[k] || DEF_CUES[k]; return '<div class="cue-row" data-cue="' + k + '"><div class="cn">' + esc(name) + '<small>' + esc(how) + '</small></div><div class="cs">' +
        stepMini('出す', 'cueShow_' + k, c.show, '%', 0, 100, 5) + stepMini('当たる', 'cueHit_' + k, c.hit, '%', 0, 100, 5) + '</div></div>'; }).join('') +
      '</div>';
  }
  /* 今日のレースの 1 行: 出た演出と、本当の勝ち馬を指していたか（○ / ×）。cues はサーバーが結果と一緒に決めたもの（管理と合言葉のあるテレビにだけ届く） */
  function cueTxt(r) {
    const cz = r.cues || (r.decision && r.decision.cues); if (!cz || !r.result) return '';
    const fired = CUES.filter(([k]) => cz[k] && cz[k].horse != null);
    const t = fired.length ? '演出: ' + fired.map(([k, name]) => { const h = cz[k].horse, no = r.horses && r.horses[h] ? r.horses[h].no || h + 1 : h + 1; return name + '→' + no + '番 ' + (h === r.result.winner ? '○' : '×'); }).join(' / ') : '演出なし';
    return '<small class="hint cue-txt" style="display:block;margin:0">' + esc(t) + '</small>';
  }
  /* リングバウンティの交換（2026-10-19 オーナー「Bounty X 枚で 100 と交換できる感じ。X はマスターからいじれるように」）:
     「設定」タブのいちばん上。全店共通の 1 つの値（v2/core.js の bountyPerTicket。整数 1〜1000・初期 20。店ごとの設定はない）。
     テレビの参加受付中の画面・お客さんの参加画面（チップ）・スタッフの認証の案内に「リングバウンティ ○枚 → 100」と出る。
     保存はこの枠の「保存」だけ（詳細設定とは別）。認証したときの割合を券に残すので、変えても認証済みの券・返却・返還は前の割合のまま */
  function viewBounty(T) {
    const x = Number(T.bountyPerTicket) || 20;
    return '<div class="panel" id="bountyPanel"><h3>リングバウンティの交換</h3>' +
      '<p class="bpnow">いま <b>リングバウンティ <span id="bpNow">' + fmtN(x) + '</span>枚 → 100</b></p>' +
      stepRow('リングバウンティ ○枚 → 100', '1〜1000 の整数。全店共通', 'bountyPerTicket', x, '枚', 1, 1000, 1) +
      '<p class="hint">テレビ（参加受付中）・お客さんのスマホ（参加画面）・スタッフ画面にこの割合が出ます。<b>これから認証する分</b>から新しい割合です（認証済みの券・返却・返還は認証したときの割合のまま）。当たりの額（チップ × オッズ）は変わりません。</p>' +
      '<div class="savebar"><div class="msg" id="bpmsg"></div><button type="button" class="btn" data-act="bp-save" id="bpsave" disabled>保存</button></div></div>';
  }
  function validateBp() {
    if (!$('bpsave')) return 1;
    const ok = numOk('bountyPerTicket'), v = numOf('bountyPerTicket'), dirty = ok && v !== (Number(cfg.tuning.bountyPerTicket) || 20);
    $('bpmsg').innerHTML = !ok ? '<div class="err">1〜1000 の整数にしてください</div>' : dirty ? '<div class="warnmsg">保存すると「リングバウンティ ' + fmtN(v) + '枚 → 100」になります</div>' : '<div class="okmsg">保存済みです</div>';
    $('bpsave').disabled = !ok || !dirty;
    return ok ? 0 : 1;
  }
  async function saveBp() {
    if (validateBp()) return;
    const v = Math.round(numOf('bountyPerTicket')); if (v === (Number(cfg.tuning.bountyPerTicket) || 20)) return;
    $('bpsave').disabled = true;
    try { await api('saveTuning', { bountyPerTicket: v }); await reloadCfg(); toast('交換の割合を「リングバウンティ ' + fmtN(v) + '枚 → 100」にしました。これから認証する分から使います'); }
    catch (e) { toast(errText(e)); }
    keepScroll(render);
  }
  /* 馬の見た目（全店共通。v2/core.js の horseLook）: 押すとすぐ保存。全店のテレビが次のレースから同じ見た目にそろう（受付中・走っている途中のレースは変わらない） */
  const HORSE_LOOKS = [['cute', 'かわいい（標準）'], ['real', '本物寄り']];
  function viewHorseLook(T) {
    const cur = T.horseLook === 'real' ? 'real' : 'cute';
    return '<div class="panel" id="hlookPanel"><h3>馬の見た目</h3><p class="hint">全店のテレビに次のレースから反映</p><div class="quick">' +
      HORSE_LOOKS.map(([v, l]) => '<button type="button" class="btn sm ' + (cur === v ? '' : 'ghost') + '" data-act="hlook" data-v="' + v + '" aria-pressed="' + (cur === v) + '">' + l + '</button>').join('') + '</div></div>';
  }
  async function saveHorseLook(v, b) {
    if (v !== 'cute' && v !== 'real') return;
    if ((cfg.tuning.horseLook || 'cute') === v) return;
    const btns = main.querySelectorAll('[data-act="hlook"]'); btns.forEach((x) => { x.disabled = true; });
    try {
      await api('saveTuning', { horseLook: v }); cfg.tuning.horseLook = v;
      btns.forEach((x) => { const on = x.dataset.v === v; x.classList.toggle('ghost', !on); x.setAttribute('aria-pressed', String(on)); }); // ほかの欄の書きかけを消さないよう、ボタンだけ直す
      toast('馬の見た目を「' + (v === 'real' ? '本物寄り' : 'かわいい') + '」にしました。全店のテレビに次のレースから反映されます');
    } catch (e) { toast(errText(e)); }
    finally { btns.forEach((x) => { if (document.contains(x)) x.disabled = false; }); }
  }
  /* 当たりの幅の例（目標 30,000 のとき。額）。入力のたびに書き直す */
  function bandExample(below, above) {
    if (!(below > 0) && !(above > 0)) return '幅が両方 0% なので、目標にいちばん近い馬が勝ちます';
    const tg = 30000, lo = Math.ceil(tg * (1 - below) - 1e-9), hi = Math.floor(tg * (1 + above) + 1e-9);
    return '目標 ' + fmtN(tg) + ' なら <b>' + fmtN(lo) + '〜' + fmtN(hi) + '</b> に入る馬から、勝ちやすさで抽選。いない時はいちばん近い馬';
  }
  const CUE_KEYS = [].concat.apply([], CUES.map(([k]) => ['cueShow_' + k, 'cueHit_' + k]));
  const TUN_KEYS = ['payoutRate', 'volatility', 'shiftUp', 'shiftDown', 'bandBelow', 'bandAbove', 'payoutCap', 'payoutCapDay', 'exchangeSec', 'voteSec', 'resultSec', 'gateSec', 'postSec'].concat(CUE_KEYS); /* 交換の割合（bountyPerTicket）は 2026-10-19 から「設定」の上の枠（viewBounty。保存も別） */
  function validateTuning() {
    if (!$('tumsg')) return 1;
    const bad = TUN_KEYS.filter((k) => !numOk(k)).length;
    if ($('bandEx') && numOk('bandBelow') && numOk('bandAbove')) $('bandEx').innerHTML = bandExample(numOf('bandBelow') / 100, numOf('bandAbove') / 100);
    $('tumsg').innerHTML = bad ? '<div class="err">数字の範囲を確かめてください（赤い欄）</div>' : tunDirty ? '<div class="warnmsg">保存していない変更があります</div>' : '<div class="okmsg">保存済みです</div>';
    $('tusave').disabled = bad > 0 || !tunDirty;
    return bad;
  }
  async function saveTuning() {
    if (validateTuning()) return;
    const t = {
      payoutRate: Math.round(numOf('payoutRate')) / 100, volatility: Math.round(numOf('volatility') * 10) / 10, shiftUp: Math.round(numOf('shiftUp')) / 100, shiftDown: Math.round(numOf('shiftDown')) / 100,
      bandBelow: Math.round(numOf('bandBelow')) / 100, bandAbove: Math.round(numOf('bandAbove')) / 100,
      payoutCap: Math.round(numOf('payoutCap')), payoutCapDay: Math.round(numOf('payoutCapDay')),
      exchangeSec: Math.round(numOf('exchangeSec')), voteSec: Math.round(numOf('voteSec')), resultSec: Math.round(numOf('resultSec')), gateSec: Math.round(numOf('gateSec')), postSec: Math.round(numOf('postSec')),
    };
    // 変えた項目だけ送る（ほかの画面で変えた項目を、この画面の古い値で戻さない）
    const T0 = cfg.tuning, near = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 1e-9;
    Object.keys(t).forEach((k) => { if (near(t[k], T0[k])) delete t[k]; });
    { const cz = {}; CUES.forEach(([k]) => { const cur = (T0.cues && T0.cues[k]) || DEF_CUES[k], sh = Math.round(numOf('cueShow_' + k)), hi = Math.round(numOf('cueHit_' + k)), d = {}; if (!near(sh, cur.show)) d.show = sh; if (!near(hi, cur.hit)) d.hit = hi; if (Object.keys(d).length) cz[k] = d; }); if (Object.keys(cz).length) t.cues = cz; } /* 演出: 変えた演出・項目だけ */
    if (!Object.keys(t).length) { tunDirty = false; toast('変更はありません'); return keepScroll(render); }
    await api('saveTuning', t);
    await reloadCfg(); tunDirty = false; toast('保存しました'); keepScroll(render);
  }

  /* ======================================================================
     集計・会計番号の記録
     ====================================================================== */
  async function loadStats() {
    statsData = null; statsErr = ''; if (tab === 'stats') keepScroll(() => { main.innerHTML = viewStats(); });
    const my = (loadStats.seq = (loadStats.seq || 0) + 1); // 期間・店舗を続けて変えたとき、遅れて届いた前の答えで上書きしない
    try { const x = await api('stats', stFrom, stTo, stStore || undefined); if (my !== loadStats.seq) return; statsData = x; }
    catch (e) { if (my !== loadStats.seq) return; statsErr = errText(e); }
    if (tab === 'stats') keepScroll(() => { main.innerHTML = viewStats(); });
  }
  const dayRow = (x) => { const paid = x.paid || 0, cl = x.claimed || 0; return { date: x.date, races: x.races || 0, players: x.players == null ? null : x.players, tickets: x.tickets || 0, bet: x.bet || 0, paid, claimed: cl, bountyIn: x.bountyIn || 0, exchanged: x.exchanged || 0, bountyReturned: x.bountyReturned || 0, bountyReturnedPaid: x.bountyReturnedPaid || 0, bountyRefund: x.bountyRefund || 0, bountyRefundPaid: x.bountyRefundPaid || 0, /* リングバウンティと投票券の枚数（額とは別） */ unclaimed: x.unclaimed != null ? x.unclaimed : Math.max(0, paid - cl), rate: x.bet ? paid / (x.bet * YEN) : 0 }; /* 払い戻し率 = 当選額 ÷（投票枚数 × 100） */ };
  // 店舗を選んだときは、日ごとの店舗別（days[].byStore）からその店の数字だけを出す（参加人数は店舗別がまだないので —）
  function statDays() {
    if (!statsData) return [];
    return (statsData.days || []).map((x) => {
      if (!stStore) return dayRow(x);
      const b = (x.byStore && x.byStore[stStore]) || {};
      return dayRow({ date: x.date, races: x.races, players: b.players == null ? null : b.players, tickets: b.tickets, bet: b.bet, paid: b.paid, claimed: b.claimed, bountyIn: b.bountyIn, exchanged: b.exchanged, bountyReturned: b.bountyReturned, bountyReturnedPaid: b.bountyReturnedPaid, bountyRefund: b.bountyRefund, bountyRefundPaid: b.bountyRefundPaid, unclaimed: b.unclaimed /* 期限切れを引いた残り（サーバーの値。2026-10-19: 前は 当選額−渡した額 で期限切れが混ざっていた） */ });
    });
  }
  function byStoreRows(d) {
    if (!d || !d.days || !d.days.some((x) => x.byStore)) return null;
    const acc = {};
    d.days.forEach((x) => Object.keys(x.byStore || {}).forEach((k) => { const a = acc[k] = acc[k] || { storeId: k, tickets: 0, bet: 0, paid: 0, claimed: 0, unclaimed: 0, bountyIn: 0, exchanged: 0, bountyReturned: 0, bountyReturnedPaid: 0, bountyRefund: 0, bountyRefundPaid: 0, players: null }; const b = x.byStore[k]; ['tickets', 'bet', 'paid', 'claimed', 'bountyIn', 'exchanged', 'bountyReturned', 'bountyReturnedPaid', 'bountyRefund', 'bountyRefundPaid'].forEach((f) => { a[f] += b[f] || 0; }); a.unclaimed += b.unclaimed != null ? b.unclaimed : Math.max(0, (b.paid || 0) - (b.claimed || 0)); /* 期限切れを引いた残り（サーバーの値） */ if (b.players != null) a.players = (a.players || 0) + b.players; }));
    return Object.keys(acc).filter((k) => !stStore || k === stStore).map((k) => Object.assign({ storeId: k }, dayRow(acc[k])));
  }
  const nOrDash = (v) => (v == null ? '—' : fmtN(v));
  function viewStats() {
    const quick = [['today', '今日'], ['yday', '昨日'], ['7', '7 日'], ['month', '今月'], ['31', '31 日']];
    const days = statDays();
    const tot = days.reduce((a, x) => { Object.keys(a).forEach((k) => { if (x[k] != null) a[k] = (a[k] || 0) + x[k]; }); return a; }, { races: 0, players: stStore ? null : 0, tickets: 0, bet: 0, paid: 0, claimed: 0, unclaimed: 0, bountyIn: 0, exchanged: 0, bountyReturned: 0, bountyReturnedPaid: 0, bountyRefund: 0, bountyRefundPaid: 0 });
    const bs = byStoreRows(statsData);
    const L = logsData;
    const qOn = (q) => { const r = quickRange(q); return r[0] === stFrom && r[1] === stTo; }; // 今選んでいる期間ボタンは銀
    /* 日ごと・店舗別の 1 行（PC は表、スマホはカード）。スマホは主な数字（参加・当選額・まだ渡していない）を先に、残りは「くわしく」で開く（2026-10-19 改善 2） */
    const cell = (l, v, more) => '<td class="n' + (more ? ' more' : '') + '" data-l="' + l + '">' + v + '</td>';
    const unc = (v) => (v ? '<b style="color:var(--ng)">' + fmtN(v) + '</b>' : '0');
    const moreBtn = '<button type="button" class="btn xs ghost daymore" data-act="day-more" aria-expanded="false">くわしく</button>';
    return '<div class="panel"><h3>集計を見る</h3>' +
      '<div class="quick">' + quick.map((q) => '<button class="btn sm ghost" data-act="stq" data-q="' + q[0] + '" aria-pressed="' + qOn(q[0]) + '">' + q[1] + '</button>').join('') + '</div>' +
      '<div class="range"><label class="f"><span>開始</span><input type="date" id="stfrom" value="' + esc(stFrom) + '" max="' + esc(stTo) + '"></label><label class="f"><span>終了</span><input type="date" id="stto" value="' + esc(stTo) + '" min="' + esc(stFrom) + '"></label>' +
      '<label class="f"><span>店舗</span><select id="ststore"><option value="">全店舗</option>' + cfg.stores.map((s) => '<option value="' + esc(s.id) + '"' + (stStore === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label></div>' +
      (statsErr ? '<div class="err">' + esc(statsErr) + '</div>' : '') +
      /* 見出しを分ける（2026-10-17）: リングバウンティ（受け取った・返却した）と投票券の枚数、当選額と渡した額（額。1 枚 = 100）を混ぜない */
      '<h4 class="sumh">リングバウンティとチップ</h4><div class="summary" id="statBounty"><div class="stat"><small>受け取ったリングバウンティ</small><b>' + fmtN(tot.bountyIn) + '</b></div>' +
      '<div class="stat"><small>賭けたチップ</small><b>' + chipN(tot.bet) + '</b><small>交換した ' + chipN(tot.exchanged) + '</small></div>' +
      '<div class="stat" id="statRet"><small>返却したリングバウンティ</small><b>' + fmtN(tot.bountyReturnedPaid + tot.bountyRefundPaid) + '</b><small>投票なし ' + fmtN(tot.bountyReturned) + (tot.bountyRefund ? '・レース取消 ' + fmtN(tot.bountyRefund) : '') + '</small></div>' +
      '<div class="stat"><small>参加人数</small><b>' + nOrDash(tot.players) + '</b></div><div class="stat"><small>レース数</small><b>' + fmtN(tot.races) + '</b></div></div>' +
      '<h4 class="sumh">当選額と渡した額</h4><div class="summary" id="statMoney"><div class="stat"><small>当選額</small><b>' + fmtN(tot.paid) + '</b></div><div class="stat"><small>渡した当選額</small><b>' + fmtN(tot.claimed) + '</b></div>' +
      '<div class="stat ' + (tot.unclaimed ? 'ng' : '') + '"><small>まだ渡していない当選額</small><b>' + fmtN(tot.unclaimed) + '</b></div>' + '<div class="stat"><small>当選額の割合</small><b>' + (tot.bet ? Math.round(tot.paid / (tot.bet * YEN) * 1000) / 10 + '%' : '—') + '</b><small>当選額 ÷ 賭けたチップ</small></div></div>' +
      (statsData == null && !statsErr ? '<div class="empty">読み込み中…</div>' :
        '<h4 class="sumh">日ごと</h4><div class="tbl"><table class="cards days"><tr class="hd"><th>日付</th><th class="n">参加人数</th><th class="n">当選額</th><th class="n">まだ渡していない</th><th class="n">レース</th><th class="n">受け取ったリングバウンティ</th><th class="n">賭けたチップ</th><th class="n">渡した当選額</th><th class="n">返却したリングバウンティ</th><th class="n">当選額の割合</th></tr>' +
        (days.length ? days.map((x) => '<tr><td class="head"><b>' + fmtDay(x.date) + '</b>' + moreBtn + '</td>' + cell('参加', nOrDash(x.players)) + cell('当選額', fmtN(x.paid)) + cell('まだ渡していない', unc(x.unclaimed)) +
          cell('レース', fmtN(x.races), 1) + cell('受け取ったリングバウンティ', fmtN(x.bountyIn), 1) + cell('賭けたチップ', chipN(x.bet), 1) + cell('渡した当選額', fmtN(x.claimed), 1) + cell('返却したリングバウンティ', fmtN(x.bountyReturnedPaid + x.bountyRefundPaid), 1) + cell('当選額の割合', x.bet ? Math.round(x.rate * 1000) / 10 + '%' : '—', 1) + '</tr>').join('') : '<tr><td colspan="10" class="empty">この期間のデータはありません</td></tr>') + '</table></div>') +
      (bs ? '<h4 class="sumh">店舗別</h4><div class="tbl"><table class="cards days"><tr class="hd"><th>店舗</th><th class="n">参加人数</th><th class="n">当選額</th><th class="n">まだ渡していない</th><th class="n">受け取ったリングバウンティ</th><th class="n">賭けたチップ</th><th class="n">渡した当選額</th><th class="n">返却したリングバウンティ</th></tr>' +
        bs.map((x) => '<tr><td class="head"><b>' + esc(storeName(x.storeId)) + '</b>' + moreBtn + '</td>' + cell('参加', nOrDash(x.players)) + cell('当選額', fmtN(x.paid)) + cell('まだ渡していない', unc(x.unclaimed)) +
          cell('受け取ったリングバウンティ', fmtN(x.bountyIn), 1) + cell('賭けたチップ', chipN(x.bet), 1) + cell('渡した当選額', fmtN(x.claimed), 1) + cell('返却したリングバウンティ', fmtN(x.bountyReturnedPaid + x.bountyRefundPaid), 1) + '</tr>').join('') + '</table></div>' : '') +
      '<div class="acts l"><button class="btn sm ghost" data-act="st-csv"' + (days.length ? '' : ' disabled') + '>CSV（Excel）に書き出す</button></div>' +
      '<details class="fold"><summary>言葉の意味</summary><div class="in"><p class="hint">受け取ったリングバウンティ＝スタッフが受け取ったリングバウンティ（例 交換の割合 20 なら 100チップ ＝ 20枚）。賭けたチップ＝馬に賭けたチップ（「交換した」は投票しなかった分も入ります）。当選額＝当たりの合計（チップ × オッズ）。渡した当選額＝スタッフが渡した額。まだ渡していない当選額＝当たったのに受け取りに来ていない額。返却したリングバウンティ＝投票しなかった分とレース取消（返還）で、お客さんに返したリングバウンティ。当選額の割合＝当選額 ÷ 賭けたチップ（100% で同じ額）。テストモードの店舗の分は入りません。</p></div></details></div>' +
      '<div class="panel"><h3>会計番号で探す</h3><p class="hint">期間と店舗は上と同じ。空のまま探すと全部出ます。</p>' +
      '<div class="range"><label class="f"><span>会計番号</span><input type="text" id="lbill" value="' + esc(logBill) + '" maxlength="12" placeholder="例: 1234" autocapitalize="off"></label><div class="quick" style="align-items:end;padding-bottom:10px"><button class="btn sm" data-act="log-search">探す</button><button class="btn sm ghost" data-act="log-csv"' + (L && L.logs.length ? '' : ' disabled') + '>CSV に書き出す</button></div></div>' +
      (logsErr ? '<div class="err">' + esc(logsErr) + '</div>' : '') +
      (L ? viewLogs(L) : '') + '</div>';
  }
  const LOG_KIND = { auth: ['認証', 'info'], win: ['当たり', 'warn'], paid: ['受け取り', 'ok'], refund: ['レース取消', 'ng'], expired: ['期限切れ', ''], return: ['返却', 'info'] };
  const logKind = (x) => (x.type === 'paid' && x.novote ? ['返却の受取', 'ok'] : x.type === 'paid' && x.kind === 'refund' ? ['取消の受取', 'ok'] : LOG_KIND[x.type] || [x.type, '']);
  // 会計番号ごとの集計（返還で取り消された当たりは数えない。受け取りは当たりと返還を分ける。期限切れは未受け取りから引く）。
  // 額（当選額・受取額）とリングバウンティ（受け取った・返却・返還・返した）は別の項目（2026-10-17。混ぜない）
  function sumLogs(logs) {
    const refundTid = new Set(), paidPid = new Set(), out = {};
    const retTid = new Set(); logs.forEach((l) => { if (l.type === 'refund') refundTid.add(l.tid); if (l.type === 'paid') paidPid.add(l.pid); if (l.type === 'return') retTid.add(l.tid); });
    logs.forEach((l) => {
      const x = out[l.bill] = out[l.bill] || { auth: 0, bounty: 0, win: 0, paid: 0, refund: 0, refundPaid: 0, expired: 0, refundExpired: 0, ret: 0, retPaid: 0, retExpired: 0 }, n = Number(l.count != null ? l.count : l.amount) || 0, b = logB(l);
      if (l.type === 'auth') { x.auth += n; x.bounty += b; }
      else if (l.type === 'return') x.ret += b; /* 返却（投票しなかった券）: リングバウンティ */
      else if (l.type === 'paid' && l.novote) x.retPaid += b;
      else if (l.type === 'expired' && l.kind === 'refund' && retTid.has(l.tid)) x.retExpired += b;
      else if (l.type === 'win') { if (!(refundTid.has(l.tid) && !paidPid.has(l.pid))) x.win += n; }
      else if (l.type === 'paid') { if (l.kind === 'refund') x.refundPaid += b; else x.paid += n; }
      else if (l.type === 'refund') x.refund += b;
      else if (l.type === 'expired') { if (l.kind === 'refund') x.refundExpired += b; else x.expired += n; }
    });
    Object.keys(out).forEach((k) => { const x = out[k]; x.unclaimed = Math.max(0, x.win - x.paid - x.expired); x.unreturned = Math.max(0, x.refund - x.refundPaid - x.refundExpired) + Math.max(0, x.ret - x.retPaid - x.retExpired); });
    return out;
  }
  // 明細の数字: 認証は「30枚・リングバウンティ 600」、返却・返還は「リングバウンティ 600」、当たり・受け取りは額
  const logVal = (x) => (x.type === 'auth' ? 'チップ ' + chipN(x.count) + '・リングバウンティ ' + fmtN(logB(x)) : isBLog(x) ? 'リングバウンティ ' + fmtN(logB(x)) : fmtN(x.count != null ? x.count : x.amount));
  function viewLogs(L) {
    const bills = Object.keys(L.byBill || {});
    return (bills.length ? '<div class="tbl"><table class="cards"><tr class="hd"><th>会計番号</th><th class="n">チップ</th><th class="n">受け取ったリングバウンティ</th><th class="n">当選額</th><th class="n">渡した当選額</th><th class="n">まだ渡していない</th><th class="n">返却したリングバウンティ</th></tr>' +
      bills.slice(0, 200).map((b) => { const x = L.byBill[b]; const un = x.unclaimed != null ? x.unclaimed : Math.max(0, (x.win || 0) - (x.paid || 0)); return '<tr><td class="mono head"><b>' + esc(b) + '</b></td><td class="n" data-l="チップ">' + chipN(x.auth) + '</td><td class="n" data-l="受け取ったリングバウンティ">' + fmtN(x.bounty) + '</td><td class="n" data-l="当選額">' + fmtN(x.win) + '</td><td class="n" data-l="渡した当選額">' + fmtN(x.paid) + '</td><td class="n" data-l="まだ渡していない">' + (un ? '<b style="color:var(--ng)">' + fmtN(un) + '</b>' : '0') + '</td><td class="n" data-l="返却したリングバウンティ">' + fmtN((x.retPaid || 0) + (x.refundPaid || 0)) + ((x.ret || x.refund) ? '<small class="hint">（返却 ' + fmtN(x.ret) + (x.refund ? '・返還 ' + fmtN(x.refund) : '') + (x.unreturned ? '・まだ ' + fmtN(x.unreturned) : '') + '）</small>' : '') + '</td></tr>'; }).join('') + '</table></div>' : '') +
      '<h3 style="margin-top:14px;font-size:14px">明細（' + fmtN(L.logs.length) + ' 件' + (L.logs.length > 500 ? '。新しい 500 件を表示' : '') + '）</h3>' +
      (L.logs.length ? '<div class="tbl"><table class="cards"><tr class="hd"><th>日時</th><th>店舗</th><th>会計番号</th><th>ニックネーム</th><th>種類</th><th class="n">チップ・リングバウンティ・額</th><th>レース</th></tr>' +
        L.logs.slice(0, 500).map((x) => { const k = logKind(x); return '<tr><td class="mono">' + esc(x.date ? x.date.slice(5) : ymd(x.at).slice(5)) + ' ' + hms(x.at).slice(0, 5) + '</td><td>' + esc(storeName(x.storeId)) + '</td><td class="mono">' + esc(x.bill) + '</td><td>' + esc(x.nick || '') + '</td><td><span class="chip ' + k[1] + '">' + k[0] + '</span></td><td class="n">' + esc(logVal(x)) + '</td><td class="mono"><small>' + esc(x.raceId || '') + '</small></td></tr>'; }).join('') + '</table></div>'
        : '<div class="empty">記録はありません</div>');
  }
  // 会計番号の記録: 管理用の API（adminLogs）があればそれ、なければ各店舗の PIN でスタッフ用の記録を日ごとに集める
  async function searchLogs() {
    logBill = ($('lbill') ? $('lbill').value : logBill).trim();
    logsData = null; logsErr = '';
    keepScroll(() => { main.innerHTML = viewStats(); });
    try {
      let logs;
      let r = null;
      if (A && typeof A.logs === 'function') { try { r = await api('logs', { from: stFrom, to: stTo, bill: logBill || undefined, store: stStore || undefined }); } catch (e) { if (e.status !== 404) throw e; } } // 404 = サーバーが古い → 下の集め方
      if (r) logs = (r.logs || []);
      else {
        const dates = []; for (let d = stFrom; d <= stTo && dates.length < 62; d = addDays(d, 1)) dates.push(d);
        const stores = cfg.stores.filter((s) => !stStore || s.id === stStore);
        const jobs = [];
        stores.forEach((s) => { const sc = DerbyCloud.create({ store: s.id, role: 'staff' }); dates.forEach((d) => jobs.push(sc.logs(s.pin, { date: d, bill: logBill || undefined }).then((r) => (r && r.logs) || []))); });
        logs = [].concat.apply([], await Promise.all(jobs));
      }
      logs.sort((a, b) => b.at - a.at);
      logsData = { logs, byBill: sumLogs(logs) };
    } catch (e) { logsErr = errText(e); }
    if (tab === 'stats') keepScroll(() => { main.innerHTML = viewStats(); });
  }
  function quickRange(q) {
    const t = bizToday();
    if (q === 'today') return [t, t];
    if (q === 'yday') { const y = addDays(t, -1); return [y, y]; }
    if (q === 'month') return [t.slice(0, 8) + '01', t];
    return [addDays(t, -(+q - 1)), t];
  }

  /* ======================================================================
     運用
     ====================================================================== */
  /* 設定（2026-10-19 改善 2）: テレビの読み込み直しとレース取消は「今日」へ移した（その場で終わる）。ここは 馬の見た目・オーナー用の詳細設定・テスト用 だけ */
  function viewOps() {
    return '<p class="opsnote">テレビの切り替え・読み込み直しとレース取消は「今日」にあります。</p>' +
      viewBounty(cfg.tuning) +
      viewHorseLook(cfg.tuning) +
      '<button type="button" class="panel rowlink" data-act="go-tuning"><span><b>オーナー用の詳細設定</b><small>店舗には見せない設定</small></span><i aria-hidden="true">›</i></button>' +
      '<details class="panel"><summary>テスト用（本番では使わない）</summary>' +
      '<p class="hint">時刻表とは別に、今すぐレースを作ります（テストモードの店舗で確かめる用）。</p>' +
      '<div class="range"><label class="f"><span>何秒後に発走</span><input type="number" id="trin" value="90" min="5" max="3600"></label><label class="f"><span>当選額の目標</span><input type="number" id="trpay" value="30000" min="1" max="' + PAY_MAX + '"></label>' +
      '<label class="f"><span>店舗</span><select id="trstore"><option value="">全店（同時）</option>' + cfg.stores.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + 'だけ</option>').join('') + '</select></label></div>' +
      '<div class="acts"><button class="btn ghost" data-act="test-race">テストのレースを作る</button></div></details>';
  }

  /* ---------- 入力イベント ---------- */
  main.addEventListener('input', (e) => {
    const el = e.target;
    if (tab === 'stores' && editStore) return validateStore();
    if (tab === 'tuning') { tunDirty = true; return validateTuning(); }
    if (tab === 'ops' && el.id === 'n-bountyPerTicket') return validateBp();
    if (tab === 'timetable' && tt) {
      const t = tplOf(el);
      if (t && el.dataset.rf) { const r = rowOf(t, el); if (r) r[el.dataset.rf] = el.value; return ttTouched(); }
      if (t && el.dataset.tf === 'name') { t.name = el.value; return ttTouched(); }
      if (t && el.dataset.tf === 'date') { t.date = el.value; return ttTouched(); }
    }
  });
  main.addEventListener('change', (e) => {
    const el = e.target;
    if (tab === 'timetable' && tt) {
      const t = tplOf(el);
      if (t && el.dataset.wd != null) { const d = +el.dataset.wd, i = t.weekdays.indexOf(d); if (el.checked && i < 0) t.weekdays.push(d); if (!el.checked && i >= 0) t.weekdays.splice(i, 1); el.parentNode.classList.toggle('on', el.checked); return ttTouched(); }
      if (t && (el.dataset.tf === 'kind' || el.dataset.tf === 'storeId' || el.dataset.tf === 'scope')) {
        if (el.dataset.tf === 'kind') { t.kind = el.value; if (t.kind === 'weekday' && !t.weekdays.length) t.weekdays = [6, 0]; if (t.kind === 'date' && !t.date) t.date = addDays(todayStr(), 1); }
        else if (el.dataset.tf === 'storeId') t.storeId = el.value || null; else t.scope = el.value;
        ttDirty = true; return ttRerender();
      }
      if (t && el.dataset.rf === 't') { return; }
      if (t && el.dataset.find != null) { // 時刻で探す（2026-10-19 改善 4）: 全部の行を出して、その時刻（なければ次の時刻）の行へ移る
        const m = toMin(el.value); if (isNaN(m)) return;
        const hit = t.rows.find((r) => toMin(r.t) >= m) || t.rows[t.rows.length - 1]; if (!hit) return;
        tplAll.add(t.id); ttRerender();
        const tr = main.querySelector('[data-rk="' + hit.k + '"]'); if (tr) { tr.scrollIntoView({ block: 'center' }); tr.classList.add('hit'); setTimeout(() => tr.classList.remove('hit'), 2500); const ip = tr.querySelector('[data-rf="t"]'); if (ip) ip.focus({ preventScroll: true }); }
        return;
      }
      if (el.id === 'pvdate') { pvDate = el.value; pvServer = null; if (pvSrc === 'server') loadServerPreview(); return paintPreview(); }
      if (el.id === 'pvstore') { pvStore = el.value; pvServer = null; if (pvSrc === 'server') loadServerPreview(); return paintPreview(); }
    }
    if (el.id === 'stvgame') { paintTvSeg(); return; }
    if (el.id === 'rdate') { raceDate = el.value || bizToday(); racesData = null; refundOpen = null; raceAll = false; render(); return; }
    if (el.id === 'stfrom' || el.id === 'stto' || el.id === 'ststore') {
      stFrom = $('stfrom').value || stFrom; stTo = $('stto').value || stTo; stStore = $('ststore').value;
      if (stFrom > stTo) { const x = stFrom; stFrom = stTo; stTo = x; }
      logsData = null; return loadStats();
    }
  });
  main.addEventListener('toggle', (e) => { if (e.target && e.target.id === 'connFold') connOpen = e.target.open; }, true); // 10 秒ごとの描き直しで「接続の設定」が閉じないように
  main.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'lbill') { e.preventDefault(); searchLogs(); }
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.bf) { e.preventDefault(); const t = tplOf(e.target); if (t) bulkCreate(t, e.target.closest('[data-tk]')); }
  });
  // 時刻を書き換えて欄を離れたら、時刻順に並べ直す
  main.addEventListener('focusout', (e) => {
    if (tab !== 'timetable' || !tt || !e.target.dataset || e.target.dataset.rf !== 't') return;
    const t = tplOf(e.target); if (!t) return;
    const before = t.rows.map((r) => r.k).join();
    sortRows(t);
    if (t.rows.map((r) => r.k).join() !== before) setTimeout(() => { if (!main.contains(document.activeElement) || !document.activeElement.dataset.rf) ttRerender(); else { const k = document.activeElement.closest('[data-rk]'), f = document.activeElement.dataset.rf; ttRerender(); const el = k && main.querySelector('[data-rk="' + k.dataset.rk + '"] [data-rf="' + f + '"]'); if (el) el.focus(); } }, 0);
  });

  /* ---------- ボタン ---------- */
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    try {
      switch (act) {
        case 'st': return stepBy(b);
        /* 店舗 */
        case 'cfg-reload': await reloadCfg(); render(); toast('最新の情報にしました'); return;
        case 'tvacct-new': return createTvAccount(b);
        case 'pair-set': return pairStart(b); // 進行役のテレビ（2026-10-19）
        case 'pair-stop': return pairStop();
        case 'pair-reload': pairData = null; { const box = $('pairBox'); if (box) box.outerHTML = viewPair(); } return loadPair();
        case 'tvkey-new': if (!confirm('テレビのリンクを作り直します（リンクが漏れたときに使います）。\n今のテレビは、新しいリンクで開き直すまで結果を受け取れなくなります。')) return; await api('tvKey', {}); await reloadCfg(); render(); toast('作り直しました。各店のテレビを新しいリンクで開き直してください'); return;
        case 'store-new': editStore = { isNew: true, id: '', name: '', pin: '', orig: {}, x: sset({ settings: {} }) }; return render();
        case 'store-edit': { const s = cfg.stores.find((x) => x.id === b.dataset.id); if (!s) return; if (tab !== 'stores') { if (!leaveOk()) return; editFrom = tab; if (tab === 'races') memoOn = false; tab = 'stores'; markTab(); } editStore = { isNew: false, id: s.id, name: s.name, pin: s.pin, orig: s.settings, x: sset(s) }; window.scrollTo(0, 0); return render(); }
        case 'store-cancel': editStore = null; backFromEdit(); window.scrollTo(0, 0); return render();
        case 'store-save': b.disabled = true; try { return await saveStore(); } finally { b.disabled = false; }
        case 'store-del': return await deleteStore();
        case 'mode-add': { captureStore(); const last = editStore.x.modes[editStore.x.modes.length - 1]; editStore.x.modes.push({ k: nk(), from: last ? last.to : '18:00', to: '', mode: 'bet' }); keepScroll(() => { main.innerHTML = viewStoreEdit(); }); return validateStore(); }
        case 'mode-del': { captureStore(); editStore.x.modes = editStore.x.modes.filter((m) => m.k !== b.dataset.k); keepScroll(() => { main.innerHTML = viewStoreEdit(); }); return validateStore(); }
        /* 時刻表 */
        case 'tpl-add': return addTpl(b.dataset.kind);
        /* 今日 */
        case 'tvgame-set': return await quickTvGame(b);
        case 'memo': memoOn = !memoOn; return keepScroll(() => { main.innerHTML = viewRaces(); });
        case 'copy': { const v = b.dataset.copy || ''; try { await navigator.clipboard.writeText(v); b.textContent = 'コピーしました'; setTimeout(() => { if (document.contains(b)) b.textContent = 'コピー'; }, 1500); } catch (err) { toast('コピーできませんでした。リンクを長押ししてコピーしてください'); } return; }
        case 'sg-tv': { const sel = $('stvgame'); if (!sel) return; sel.value = b.dataset.v === 'derby' ? 'derby' : 'slot'; paintTvSeg(); return validateStore(); }
        case 'go-tuning': return switchTab('tuning');
        case 'bp-save': return saveBp();
        case 'go-ops': return switchTab('ops');
        case 'tpl-open': { const t = tplOf(b), box = b.closest('[data-tk]'); if (!t) return; const op = !tplOpen.has(t.id); if (op) tplOpen.add(t.id); else tplOpen.delete(t.id); box.classList.toggle('open', op); b.setAttribute('aria-expanded', String(op)); return; }
        case 'tpl-on': { const t = tplOf(b); t.enabled = !t.enabled; ttDirty = true; return ttRerender(); }
        case 'tpl-up': case 'tpl-down': { const t = tplOf(b), i = tt.tpls.indexOf(t), j = i + (act === 'tpl-up' ? -1 : 1); if (j < 0 || j >= tt.tpls.length) return; tt.tpls.splice(i, 1); tt.tpls.splice(j, 0, t); ttDirty = true; return ttRerender(); }
        case 'tpl-dup': { const t = tplOf(b), c = JSON.parse(JSON.stringify(t)); c.k = nk(); c.id = 'tt' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); c.name = (t.name || tplName(t)) + ' のコピー'; c.rows.forEach((r) => { r.k = nk(); }); tplOpen.add(c.id); if (c.kind === 'date') c.date = addDays(isDate(t.date) ? t.date : todayStr(), 1); tt.tpls.splice(tt.tpls.indexOf(t) + 1, 0, c); ttDirty = true; return ttRerender(); }
        case 'tpl-del': { const t = tplOf(b); if (t.rows.length && !confirm('予定「' + tplName(t) + '」（' + t.rows.length + ' レース）を消します（保存するまでは元に戻せます）。')) return; tt.tpls.splice(tt.tpls.indexOf(t), 1); ttDirty = true; return ttRerender(); }
        case 'tpl-rows': { const t = tplOf(b); if (tplAll.has(t.id)) tplAll.delete(t.id); else tplAll.add(t.id); return ttRerender(); }
        case 'row-add': { const t = tplOf(b); tplAll.add(t.id); const last = t.rows[t.rows.length - 1], gap = Math.ceil(minGapSec().sec / 60); const m = last && !isNaN(toMin(last.t)) ? Math.min(23 * 60 + 59, toMin(last.t) + Math.max(gap, 5)) : 19 * 60; t.rows.push({ k: nk(), t: fromMin(m), p: last ? last.p : '300' }); ttDirty = true; ttRerender(); const ins = main.querySelectorAll('[data-tk="' + t.k + '"] [data-rf="t"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
        case 'row-dup': { const t = tplOf(b), r = rowOf(t, b), gap = Math.ceil(minGapSec().sec / 60), m = toMin(r.t); const c = { k: nk(), t: isNaN(m) ? '' : fromMin(Math.min(23 * 60 + 59, m + Math.max(gap, 5))), p: r.p }; t.rows.splice(t.rows.indexOf(r) + 1, 0, c); ttDirty = true; return ttRerender(); }
        case 'row-del': { const t = tplOf(b), r = rowOf(t, b); t.rows.splice(t.rows.indexOf(r), 1); ttDirty = true; return ttRerender(); }
        case 'row-sort': { const t = tplOf(b); sortRows(t); return ttRerender(); }
        case 'row-clear': { const t = tplOf(b); if (!confirm('「' + tplName(t) + '」の ' + t.rows.length + ' レースを全部消します（保存するまでは元に戻せます）。')) return; t.rows = []; ttDirty = true; return ttRerender(); }
        case 'row-payall': { const t = tplOf(b); const v = prompt('この予定の当選額の目標を全部この額にします（1〜' + fmtN(PAY_MAX) + '）', t.rows[0] ? t.rows[0].p : '30000'); if (v == null) return; if (!/^\d+$/.test(v.trim()) || +v < 1 || +v > PAY_MAX) { toast('1〜' + fmtN(PAY_MAX) + ' の整数を入れてください'); return; } t.rows.forEach((r) => { r.p = v.trim(); }); ttDirty = true; return ttRerender(); }
        case 'bulk': { const t = tplOf(b); return bulkCreate(t, b.closest('[data-tk]')); }
        case 'tt-revert': if (ttDirty && !confirm('保存していない変更を捨てて、保存済みの時刻表に戻します。')) return; loadTT(); return ttRerender();
        case 'tt-save': b.disabled = true; try { return await saveTT(); } finally { if (document.contains(b)) paintTT(); }
        case 'pv-local': pvSrc = 'local'; keepScroll(() => { main.innerHTML = viewTT(); paintTT(); }); return;
        case 'pv-server': pvSrc = 'server'; keepScroll(() => { main.innerHTML = viewTT(); paintTT(); }); return loadServerPreview();
        /* 今日のレース */
        case 'rq': raceDate = +b.dataset.n === 0 ? bizToday() : addDays(raceDate || bizToday(), +b.dataset.n); racesData = null; refundOpen = null; raceAll = false; return render();
        case 'races-reload': return loadRaces();
        case 'race-refund': refundOpen = refundOpen === b.dataset.id ? null : b.dataset.id; return keepScroll(() => { main.innerHTML = viewRaces(); }); // その場で開く／閉じる（画面は移らない）
        case 'race-all': raceAll = !raceAll; return keepScroll(() => { main.innerHTML = viewRaces(); });
        /* 裏の調整 */
        case 'tpreset': { const p = TUNE_PRESETS.find((x) => x[0] === b.dataset.p); $('n-volatility').value = p[2].volatility; $('n-shiftUp').value = Math.round(p[2].shiftUp * 100); $('n-shiftDown').value = Math.round(p[2].shiftDown * 100); tunDirty = true; main.querySelectorAll('[data-act="tpreset"]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); return validateTuning(); }
        case 'hlook': return saveHorseLook(b.dataset.v, b);
        case 'tun-revert': tunDirty = false; return keepScroll(render);
        case 'tun-save': b.disabled = true; try { return await saveTuning(); } finally { if (document.contains(b)) validateTuning(); }
        /* 集計 */
        case 'day-more': { const tr = b.closest('tr'); const op = !tr.classList.contains('open'); tr.classList.toggle('open', op); b.setAttribute('aria-expanded', String(op)); b.textContent = op ? '閉じる' : 'くわしく'; return; }
        case 'stq': { const r = quickRange(b.dataset.q); stFrom = r[0]; stTo = r[1]; logsData = null; return loadStats(); }
        case 'st-csv': {
          const days = statDays();
          const rows = [['日付', 'レース数', '参加人数', '受け取ったリングバウンティ', '引き換えたチップ', '賭けたチップ', '当選額', '受取額', '未受け取り', '払い戻し率', '返却するリングバウンティ（投票なし）', '返還するリングバウンティ（不成立）', '返却したリングバウンティ']].concat(days.map((x) => [x.date, x.races, x.players == null ? '' : x.players, x.bountyIn, x.exchanged * 100, x.bet * 100, x.paid, x.claimed, x.unclaimed, x.bet ? (Math.round(x.rate * 1000) / 10) + '%' : '', x.bountyReturned, x.bountyRefund, x.bountyReturnedPaid + x.bountyRefundPaid]));
          const bs = byStoreRows(statsData); if (bs) { rows.push([]); rows.push(['店舗', '', '参加人数', '受け取ったリングバウンティ', '引き換えたチップ', '賭けたチップ', '当選額', '受取額', '未受け取り', '', '', '', '返却したリングバウンティ']); bs.forEach((x) => rows.push([storeName(x.storeId), '', x.players == null ? '' : x.players, x.bountyIn, x.exchanged * 100, x.bet * 100, x.paid, x.claimed, x.unclaimed, '', '', '', x.bountyReturnedPaid + x.bountyRefundPaid])); }
          return download('casaDERBY_集計_' + (stStore ? storeName(stStore) + '_' : '') + stFrom + '_' + stTo + '.csv', rows);
        }
        case 'log-search': return await searchLogs();
        case 'log-csv': {
          const rows = [['日時', '店舗', '会計番号', 'ニックネーム', '種類', 'チップ', 'リングバウンティ', '額（当選額・受取額）', 'レース']].concat(logsData.logs.map((x) => [ymd(x.at) + ' ' + hms(x.at), storeName(x.storeId), x.bill, x.nick || '', logKind(x)[0], x.type === 'auth' || (isBLog(x) && x.bounty != null) ? (x.count || 0) * 100 : '', isBLog(x) ? logB(x) : '', isBLog(x) ? '' : (x.count != null ? x.count : x.amount), x.raceId || '']));
          return download('casaDERBY_会計番号_' + (logBill || '全部') + '_' + stFrom + '_' + stTo + '.csv', rows);
        }
        /* 運用 */
        case 'tv-reload': {
          const sid = b.dataset.store || ''; // 今日の「テレビを切り替える」: 店ごとのボタン／「全店舗のテレビを読み込み直す」（空＝全店舗）
          if (!confirm((sid ? '「' + storeName(sid) + '」' : '全店舗') + 'のテレビを今すぐ読み込み直します。\nレース中でも途中から追いつきます。')) return;
          const rr = await api('reload', sid || undefined);
          toast((sid ? storeName(sid) : '全店舗') + 'のテレビに再読み込みを指示しました（いまつながっているテレビ ' + ((rr && rr.sent) || 0) + ' 台）'); return;
        }
        case 'refund': {
          const r = (racesData || []).find((x) => x.id === b.dataset.id); if (!r) return;
          if (!confirm('レース取消（返還）\n\n日時: ' + ymd(r.at).replace(/-/g, '/') + '(' + WD[wdOf(ymd(r.at))] + ') ' + hm(r.at) + ' 発走\n店舗: ' + storeName(r.storeId) + '\n返すリングバウンティ: ' + fmtN(r.betBounty != null ? r.betBounty : r.betTotal) + '枚（チップ ' + chipN(r.betTotal) + '・認証したときの割合）\n取り消す当選額: ' + fmtN(r.paidTotal) + '\n\nお客さんのスマホに返還用の QR が出て、スタッフが読み取ってリングバウンティを返します。すでに渡した当選額はそのまま（取り戻さない・差し引かない）、まだ渡していない当選額は取り消します。記録には「返還」として残ります。\n元に戻せません。取り消して返しますか？')) return;
          b.disabled = true;
          const rf = await api('refund', r.id);
          toast('取り消しました（リングバウンティ ' + fmtN(rf && (rf.bounty != null ? rf.bounty : rf.refundTotal)) + '枚を返します）'); refundOpen = null; return loadRaces();
        }
        case 'test-race': {
          const inSec = Number($('trin').value), payout = Number($('trpay').value), sid = $('trstore').value || null;
          if (!(inSec >= 5 && inSec <= 3600) || !(payout >= 1 && payout <= PAY_MAX)) { toast('数字の範囲を確かめてください'); return; }
          b.disabled = true; // 2 度押しで同じ時刻のレースが 2 つできないように
          let r; try { r = await api('createRace', { inSec, payout, scope: 'all', storeId: sid }); } finally { b.disabled = false; }
          toast('テストのレースを作りました（' + hm((r && (r.at || (r.race && r.race.at))) || now() + inSec * 1000) + ' 発走）'); racesData = null; return;
        }
      }
    } catch (err) { toast('失敗しました: ' + errText(err)); }
  });

  window.DerbyAdmin = { // テスト用の入口（tests/v2-admin.plan.js）
    get tt() { return tt; }, get cfg() { return cfg; }, get dirty() { return ttDirty; }, get pair() { return pairData; }, loadPair,
    validate: () => (tt ? validateTT() : null), templatesToRules: () => templatesToRules(tt.tpls), daySchedule: (d, s) => daySchedule(tt.tpls, d, s || null).map((x) => ({ t: x.t, p: x.p, store: x.group })),
    go(name) { const b = document.querySelector('#tabs [data-tab="' + name + '"]'); if (b) b.click(); else if (name === 'tuning') switchTab('tuning'); return tab; }, // 詳細の調整（tuning）はタブではなく設定の中の画面
  };
  start();
})();
