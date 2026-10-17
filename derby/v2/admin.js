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
  const per1 = (o) => (o ? fmtN(Math.round(Number(o) * 10) * 10) : '');
  const STATUS = { upcoming: ['予定', 'st-upcoming'], open: ['受付中', 'st-open'], vote: ['投票中（参加受付は締切）', 'st-open'], closed: ['締切', 'st-closed'], decided: ['レース中', 'st-decided'], done: ['確定', 'st-done'], void: ['返還済み', 'st-void'] };
  const MODES = [['auto', 'ずっと自動'], ['bet', '誰かが賭けたら開始'], ['staff', 'スタッフが開始']];
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
  let tab = 'stores';
  let editStore = null; // 店舗の編集中のコピー
  let tt = null; // 時刻表の編集中のコピー { tpls }
  let ttDirty = false, ttOrig = new Set(); // ttOrig: 読み込んだ時点の「テンプレートid|時刻」（過去の時刻を新しく足したかの判定用）
  let tunDirty = false;
  let pvDate = '', pvStore = '', pvSrc = 'local', pvServer = null;
  let raceDate = '', racesData = null, racesErr = '', racesTimer = 0;
  let stFrom = '', stTo = '', stStore = '', statsData = null, statsErr = '';
  let logBill = '', logsData = null, logsErr = '';
  let opsDate = '', opsRaces = null, opsRace = '';
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
    $('tabs').style.display = '';
    setInterval(tick, 1000); tick();
    render();
  }
  $('logout').addEventListener('click', () => { if (!leaveOk()) return; sessionStorage.removeItem(PW_KEY); location.reload(); });
  async function reloadCfg() { cfg = normCfg(await api('config')); }
  function tick() { $('clock').textContent = 'サーバー時刻 ' + fmtDay(todayStr()) + ' ' + hms(now()); }

  const leaveOk = () => !((ttDirty && tab === 'timetable') || (tunDirty && tab === 'tuning') || (editStore && tab === 'stores')) || confirm('保存していない変更があります。破棄して移動しますか？');
  window.addEventListener('beforeunload', (e) => { if (ttDirty || tunDirty) { e.preventDefault(); e.returnValue = ''; } });
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    if (b.dataset.tab === tab) { if (!editStore) { if (tab === 'races') racesData = null; render(); } return; } // いまのタブを押したら読み直す
    if (!leaveOk()) return;
    if (tab === 'timetable' && ttDirty) { tt = null; ttDirty = false; }
    if (tab === 'tuning') tunDirty = false;
    editStore = null;
    tab = b.dataset.tab;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });

  function render() {
    clearInterval(racesTimer);
    main.classList.toggle('wide', tab === 'timetable' || tab === 'races' || tab === 'stats');
    if (tab === 'stores') { main.innerHTML = editStore ? viewStoreEdit() : viewStores(); if (editStore) validateStore(); }
    else if (tab === 'timetable') { if (!tt) loadTT(); main.innerHTML = viewTT(); paintTT(); }
    else if (tab === 'races') { if (!raceDate) raceDate = bizToday(); main.innerHTML = viewRaces(); if (!racesData) loadRaces(); racesTimer = setInterval(() => { if (tab === 'races' && raceDate === bizToday()) loadRaces(true); }, 10000); }
    else if (tab === 'tuning') { main.innerHTML = viewTuning(); validateTuning(); }
    else if (tab === 'stats') { if (!stFrom) { stTo = bizToday(); stFrom = addDays(stTo, -6); } main.innerHTML = viewStats(); if (!statsData && !statsErr) loadStats(); }
    else if (tab === 'ops') { if (!opsDate) opsDate = bizToday(); main.innerHTML = viewOps(); loadOpsRaces(); } // 開くたびに読み直す（新しいレース・返還の状態）
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
  function viewStores() {
    const S = cfg.stores;
    return '<div class="panel"><h3>店舗</h3><p class="hint">店舗ごとに、スタッフ用の PIN・参加受付と投票の秒数・場面の長さ・回し方を決めます。レースは時刻表どおり全店で同時に走ります。</p>' +
      (S.length ? '<div class="list">' + S.map((s) => {
        const x = sset(s);
        return '<div class="item"><div class="name">' + esc(s.name) + (x.test ? ' <span class="chip ng">テストモード</span>' : '') + ' <span class="chip' + (x.tvGame === 'derby' ? ' on' : '') + '">テレビ: ' + (x.tvGame === 'derby' ? 'casa DERBY' : 'casa SLOT') + '</span>' +
          '<small>ID ' + esc(s.id) + '｜参加受付 ' + x.exchangeSec + '秒・投票 ' + x.voteSec + '秒・結果画面 ' + x.resultSec + '秒｜いまの回し方: ' + esc(modeNow(s)) + '</small>' +
          '<small>テレビ <a href="' + esc(tvUrl(s)) + '" target="_blank">' + esc(tvUrl(s)) + '</a>　お客さん <a href="bet.html?store=' + encodeURIComponent(s.id) + '" target="_blank">bet.html?store=' + esc(s.id) + '</a>　スタッフ <a href="staff.html?store=' + encodeURIComponent(s.id) + '" target="_blank">staff.html?store=' + esc(s.id) + '</a></small></div>' +
          '<button class="btn sm ghost" data-act="store-edit" data-id="' + esc(s.id) + '">編集</button></div>';
      }).join('') + '</div>' : '<div class="empty">まだ店舗がありません</div>') +
      (cfg.tvKey ? '<p class="hint">テレビの URL には合言葉（tvkey=）が入っています。テレビは 1 回開けば覚えます（アドレスからは消えます）。合言葉のないテレビは、発表前の結果を受け取れません（スマホから結果を先に読まれないため）。URL はお客さんに見せないでください。</p>' : '') +
      (isFs() ? '<p class="hint">テレビ用アカウント: 結果を決める係になれるテレビのログイン（1 つだけ）。最初に 1 回だけ「テレビ用アカウントを作る」を押します。パスワードはこの画面の中だけで作り、1 回だけ表示します。</p>' : '') +
      '<div class="acts"><button class="btn ghost" data-act="cfg-reload">読み直す</button>' + (isFs() ? '<button class="btn ghost" data-act="tvacct-new">テレビ用アカウントを作る</button>' : '') + (cfg.tvKey ? '<button class="btn ghost" data-act="tvkey-new">テレビの合言葉を作り直す</button>' : '') + '<button class="btn" data-act="store-new">店舗を追加</button></div></div>';
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
    return '<div class="panel"><h3>' + (s.isNew ? '店舗を追加' : '店舗を編集') + '</h3>' +
      '<div class="grid2"><label class="f"><span>店舗名</span><input type="text" id="sname" value="' + esc(s.name) + '" maxlength="20"></label>' +
      (s.isNew ? '<label class="f"><span>店舗ID（英小文字・数字。テレビの URL に使います。あとから変えられません）</span><input type="text" id="sid" value="' + esc(s.id) + '" maxlength="20" placeholder="例: ikebukuro" autocapitalize="off"></label>'
        : '<label class="f"><span>店舗ID</span><input type="text" value="' + esc(s.id) + '" disabled></label>') +
      '<label class="f"><span>スタッフ用 PIN（4〜8 桁の数字。スタッフのスマホで認証・受け取りに使います）</span><input type="text" id="spin" value="' + esc(s.pin) + '" inputmode="numeric" maxlength="8" autocomplete="off"></label></div>' +
      '</div>' +
      '<div class="panel"><h3>時間</h3>' +
      stepRow('参加受付（引き換え）の秒数', 'お客さんが会計番号・ニックネーム・枚数を入れて、スタッフがリングバウンティと引き換えて認証できる長さ（受付の画面を出してから）', 'exchangeSec', x.exchangeSec, '秒', 10, 1800, 5) +
      stepRow('投票の秒数', '参加受付の締切から投票の締切まで。認証済みのお客さんが馬を選ぶ長さ（参加受付の間も投票できます）。この間に投票しなかった分は返却になります', 'voteSec', x.voteSec, '秒', 10, 600, 5) +
      stepRow('結果画面の秒数', '着順・払戻金・当たった人を出す長さ。スタッフの「次へ」で先へ進めます（既定 300 秒）', 'resultSec', x.resultSec, '秒', 10, 1800, 10) +
      '</div>' +
      '<div class="panel"><h3>場面</h3><p class="hint">出す・出さないと長さ。全店で同時に走るので、長さを変えても発走の時刻は変わりません。</p>' +
      scene('paddock', 'パドック', '受付中の馬の紹介') + scene('gate', 'ゲートイン', '発走前のゲート入り') + scene('replay', 'リプレイ', 'ゴール後のリプレイ・写真判定') +
      '</div>' +
      '<div class="panel"><h3>回し方の時間帯</h3><p class="hint">時間帯ごとに、レースの回し方を選びます。表にない時間は「それ以外の時間」の回し方になります。日をまたぐ時間帯（例 22:00〜02:00）も入れられます。</p>' +
      '<div class="tbl"><table class="tt-rows"><tr><th>開始</th><th>終了</th><th>回し方</th><th></th><th></th></tr>' +
      x.modes.map((m) => '<tr data-mk="' + m.k + '"><td><input type="time" data-mf="from" value="' + esc(m.from) + '"></td><td><input type="time" data-mf="to" value="' + esc(m.to) + '"></td><td><select data-mf="mode">' + MODES.map((o) => '<option value="' + o[0] + '"' + (m.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></td><td class="msg"></td><td class="ops"><button type="button" class="icon del" data-act="mode-del" data-k="' + m.k + '" aria-label="この時間帯を消す">×</button></td></tr>').join('') +
      '</table></div>' +
      '<div class="acts l"><button type="button" class="btn sm ghost" data-act="mode-add">＋ 時間帯を追加</button></div>' +
      '<label class="f"><span>それ以外の時間</span><select id="smodedef">' + MODES.map((o) => '<option value="' + o[0] + '"' + (x.modeDefault === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
      '</div>' +
      '<div class="panel"><h3>テストモード</h3><p class="hint">ON にすると、この店舗の投票・当たり・受け取りは集計と会計番号の記録に数えません。テレビとスマホに「TEST」と出ます。</p>' +
      '<label class="check"><input type="checkbox" id="stest"' + (x.test ? ' checked' : '') + '> テストモード</label></div>' +
      '<div class="panel"><h3>テレビのゲーム</h3><p class="hint">この店舗のテレビ（casa SLOT と同じアプリ・同じリンク）に映すゲーム。保存すると、30 秒ほどでテレビが切り替わります（遊んでいる途中・レース中は終わってから）。ネットが切れている間は今のゲームのままです。</p>' +
      '<label class="f"><span>テレビのゲーム</span><select id="stvgame"><option value="slot"' + (x.tvGame !== 'derby' ? ' selected' : '') + '>casa SLOT</option><option value="derby"' + (x.tvGame === 'derby' ? ' selected' : '') + '>casa DERBY</option></select></label></div>' +
      '<div class="savebar"><div class="msg" id="smsg"></div>' + (s.isNew ? '' : '<button class="btn danger" data-act="store-del">削除</button>') +
      '<button class="btn ghost" data-act="store-cancel">戻る</button><button class="btn" data-act="store-save" id="ssave">保存</button></div>';
  }
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
    mark($('spin'), !/^\d{4,8}$/.test(s.pin)); if (!/^\d{4,8}$/.test(s.pin)) errs.push('PIN は 4〜8 桁の数字にしてください');
    ['exchangeSec', 'voteSec', 'resultSec', 'ss-paddock', 'ss-gate', 'ss-replay'].forEach((k) => { if (!numOk(k)) errs.push('数字の範囲を確かめてください（赤い欄）'); });
    // 回し方の時間帯: 時刻の形・開始≠終了・重なり
    const spans = [];
    x.modes.forEach((m) => {
      const tr = main.querySelector('[data-mk="' + m.k + '"]'), f = toMin(m.from), t = toMin(m.to); let msg = '';
      if (isNaN(f) || isNaN(t)) msg = '時刻を入れてください'; else if (f === t) msg = '開始と終了が同じです';
      if (!msg) { const segs = f < t ? [[f, t]] : [[f, 1440], [0, t]]; segs.forEach((g) => spans.push({ g, m })); }
      if (tr) { tr.querySelector('.msg').innerHTML = msg ? '<div class="err">' + msg + '</div>' : ''; tr.querySelectorAll('input').forEach((el) => el.classList.toggle('bad', !!msg)); }
      if (msg) errs.push('回し方の時間帯: ' + msg);
    });
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i], b = spans[j];
      if (a.m !== b.m && a.g[0] < b.g[1] && b.g[0] < a.g[1]) {
        [a.m, b.m].forEach((m) => { const tr = main.querySelector('[data-mk="' + m.k + '"]'); if (tr) { tr.querySelector('.msg').innerHTML = '<div class="err">ほかの時間帯と重なっています</div>'; tr.querySelectorAll('input').forEach((el) => el.classList.add('bad')); } });
        errs.push('回し方の時間帯が重なっています');
      }
    }
    const uniq = errs.filter((e, i) => errs.indexOf(e) === i);
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
    editStore = null; toast('保存しました'); render();
  }
  async function deleteStore() {
    const s = editStore;
    const used = cfg.rules.filter((r) => r.storeId === s.id).length;
    if (!confirm('店舗「' + s.name + '」を削除します。' + (used ? '\nこの店舗だけの時刻表（' + used + ' 件）は動かなくなります。' : '') + '\n過去の集計の記録は残ります。')) return;
    await reloadCfg(); // ほかの画面での変更を消さない
    if (cfg.stores.length <= 1) { toast('最後の 1 店舗は削除できません'); return; }
    await api('saveStores', cfg.stores.filter((y) => y.id !== s.id).map((y) => ({ id: y.id, name: y.name, pin: y.pin, settings: y.settings })));
    await reloadCfg(); editStore = null; toast('削除しました'); render();
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
  const tplName = (t) => t.name || (t.kind === 'daily' ? '毎日' : t.kind === 'weekday' ? '曜日: ' + (t.weekdays.length ? t.weekdays.slice().sort().map((d) => WD[d]).join('') : '未選択') : '日付: ' + (t.date ? fmtDay(t.date) : '未設定'));
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
        if (!/^\d+$/.test(p) || +p < 1 || +p > PAY_MAX) addR(rowErr, r, '払い戻しの合計は 1〜' + fmtN(PAY_MAX) + ' の整数（額。100 単位に丸めて保存）');
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
      col.forEach((c) => { const msg = c[0].t + ' が「' + tplName(c[0].tpl) + '」と「' + tplName(c[1].tpl) + '」で同じ時刻です（下のテンプレートだけが使われます）'; addR(rowErr, c[0].row, msg); addR(rowErr, c[1].row, msg); pushList(fmtDay(d) + ' ' + (c[0].row && (c[0].tpl.storeId || c[1].tpl.storeId) ? storeName(sid) : '全店') + ': ' + msg); });
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
    tt.tpls.forEach((t) => { if (!t.rows.length) addT(t, 'レースを 1 つ以上入れてください（使わないテンプレートは × で消せます）'); });
    let n = 0; rowErr.forEach((v) => { n += v.length ? 1 : 0; }); tplErr.forEach((v) => { n += v.filter(Boolean).length; });
    return { rowErr, rowWarn, tplErr, list, n };
  }
  function viewTT() {
    const g = minGapSec();
    const stores = cfg.stores;
    const tplHtml = (t, i) => {
      const scopeSel = '<select data-tf="storeId">' + '<option value="">全店（同時）</option>' + stores.map((s) => '<option value="' + esc(s.id) + '"' + (t.storeId === s.id ? ' selected' : '') + '>' + esc(s.name) + 'だけ</option>').join('') + (t.storeId && !stores.some((s) => s.id === t.storeId) ? '<option value="' + esc(t.storeId) + '" selected>' + esc(t.storeId) + '（削除済み）</option>' : '') + '</select>';
      const cond = t.kind === 'weekday' ? '<div class="wdays">' + [1, 2, 3, 4, 5, 6, 0].map((d) => '<label class="' + (t.weekdays.indexOf(d) >= 0 ? 'on' : '') + '"><input type="checkbox" data-wd="' + d + '"' + (t.weekdays.indexOf(d) >= 0 ? ' checked' : '') + '>' + WD[d] + '</label>').join('') + '</div>'
        : t.kind === 'date' ? '<input type="date" data-tf="date" value="' + esc(t.date) + '">' : '<div class="hint" style="margin:0;padding-top:18px">日付・曜日の指定がない日に使います</div>';
      return '<div class="tpl' + (t.enabled ? '' : ' off') + '" data-tk="' + t.k + '">' +
        '<div class="tpl-head"><input type="text" class="name" data-tf="name" value="' + esc(t.name) + '" placeholder="' + esc(tplName(Object.assign({}, t, { name: '' }))) + '" maxlength="30" aria-label="テンプレートの名前">' +
        '<span class="chip info" data-cnt>' + t.rows.length + ' レース</span>' +
        '<button type="button" class="btn xs ' + (t.enabled ? '' : 'ghost') + '" data-act="tpl-on">' + (t.enabled ? '使う' : '使わない') + '</button>' +
        '<button type="button" class="icon" data-act="tpl-up" aria-label="上へ"' + (i ? '' : ' disabled') + '>↑</button><button type="button" class="icon" data-act="tpl-down" aria-label="下へ"' + (i < tt.tpls.length - 1 ? '' : ' disabled') + '>↓</button>' +
        '<button type="button" class="btn xs ghost" data-act="tpl-dup">複製</button><button type="button" class="icon del" data-act="tpl-del" aria-label="テンプレートを消す">×</button></div>' +
        '<div class="tpl-cond"><label class="f"><span>いつ</span><select data-tf="kind"><option value="daily"' + (t.kind === 'daily' ? ' selected' : '') + '>毎日</option><option value="weekday"' + (t.kind === 'weekday' ? ' selected' : '') + '>曜日ごと</option><option value="date"' + (t.kind === 'date' ? ' selected' : '') + '>日付指定</option></select></label>' +
        '<div class="f">' + (t.kind === 'daily' ? '' : '<span class="hint" style="display:block;margin:0 0 4px">' + (t.kind === 'weekday' ? '曜日' : '日付') + '</span>') + cond + '</div>' +
        '<label class="f"><span>走る店舗</span>' + scopeSel + '</label>' +
        '<label class="f"><span>払い戻しの数え方</span><select data-tf="scope"' + (t.storeId ? ' disabled' : '') + '><option value="all"' + (t.scope !== 'store' || t.storeId ? ' selected' : '') + '>全店の合計</option><option value="store"' + (t.scope === 'store' && !t.storeId ? ' selected' : '') + '>店舗ごと</option></select></label></div>' +
        '<div class="err" data-terr></div>' +
        '<div class="tbl"><table class="tt-rows"><tr><th>#</th><th>出走時刻</th><th>払い戻しの合計</th><th>状態</th><th></th></tr>' +
        (t.rows.length ? t.rows.map((r, j) => '<tr data-rk="' + r.k + '"><td class="no">' + (j + 1) + '</td><td><input type="time" data-rf="t" value="' + esc(r.t) + '" aria-label="出走時刻"></td>' +
          '<td><input type="number" class="pay" data-rf="p" value="' + esc(r.p) + '" min="1" max="' + PAY_MAX + '" step="1" inputmode="numeric" aria-label="払い戻しの合計（額）"></td><td class="msg"></td>' +
          '<td class="ops"><button type="button" class="icon" data-act="row-dup" aria-label="この行を複製">⧉</button><button type="button" class="icon del" data-act="row-del" aria-label="この行を消す">×</button></td></tr>').join('')
          : '<tr><td colspan="5" class="empty">まだレースがありません。下の「一括作成」か「＋ 1 行追加」で入れてください</td></tr>') +
        '</table></div>' +
        '<div class="bulk"><button type="button" class="btn sm ghost" data-act="row-add">＋ 1 行追加</button><span class="sp" style="flex:1"></span>' +
        '<label class="f"><span>一括作成: 開始</span><input type="time" data-bf="from" value="19:00"></label><span class="t">〜</span>' +
        '<label class="f"><span>終了</span><input type="time" data-bf="to" value="23:00"></label>' +
        '<label class="f"><span>何分おき</span><input type="number" data-bf="every" value="5" min="1" max="180"></label>' +
        '<label class="f"><span>払い戻しの合計（額）</span><input type="number" data-bf="pay" value="30000" min="1" max="' + PAY_MAX + '" step="100"></label>' +
        '<button type="button" class="btn sm" data-act="bulk">一括作成</button></div>' +
        '<div class="acts l" style="margin-top:6px"><button type="button" class="btn xs ghost" data-act="row-sort">時刻順に並べる</button><button type="button" class="btn xs ghost" data-act="row-payall">払い戻しを全部そろえる</button><button type="button" class="btn xs ghost" data-act="row-clear"' + (t.rows.length ? '' : ' disabled') + '>全部消す</button></div>' +
        '</div>';
    };
    const side = '<div class="side"><div class="panel"><h3>この日の予定</h3>' +
      '<div class="grid2" style="grid-template-columns:1fr 1fr"><label class="f"><span>日付</span><input type="date" id="pvdate" value="' + esc(pvDate || todayStr()) + '"></label>' +
      '<label class="f"><span>店舗</span><select id="pvstore"><option value="">全店（同時）だけ</option>' + stores.map((s) => '<option value="' + esc(s.id) + '"' + (pvStore === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label></div>' +
      '<div class="quick"><button type="button" class="btn xs ' + (pvSrc === 'local' ? '' : 'ghost') + '" data-act="pv-local">編集中の内容</button><button type="button" class="btn xs ' + (pvSrc === 'server' ? '' : 'ghost') + '" data-act="pv-server">保存済み（サーバー）</button></div>' +
      '<div id="pvbox"></div></div></div>';
    return '<div class="panel"><h3>時刻表<span class="sp"></span><span class="chip">最短間隔 ' + secTxt(g.sec) + '</span></h3>' +
      '<p class="hint">レースの<b>出走時刻</b>と、そのレースの<b>払い戻しの合計（当選額の合計＝チップ × オッズ）</b>を並べます（100 単位に丸めて保存します）。テンプレートは「毎日」「曜日ごと」「日付指定」の 3 種類で、その日に<b>日付指定があればそれだけ → なければ曜日 → なければ毎日</b>を使います（全店のテンプレートと店舗だけのテンプレートは別々に選ばれ、両方走ります）。同じ種類が複数あるときは全部使い、同じ時刻は下のテンプレートが勝ちます。</p>' +
      '<p class="hint">レースどうしは <b>' + secTxt(g.sec) + '</b> 以上あけてください（参加受付 ' + g.ex + ' 秒＋投票 ' + g.vo + ' 秒＋ゲートイン ' + g.gate + ' 秒＋レース約 ' + RUN_SEC + ' 秒＋ゴール後 ' + g.post + ' 秒）。近すぎる・重なる・過去の時刻・おかしな値があると<b>保存できません</b>。保存すると、まだ作られていないこれからのレースに反映されます。</p></div>' +
      '<div class="tt-layout"><div>' + (tt.tpls.length ? tt.tpls.map(tplHtml).join('') : '<div class="panel"><div class="empty">まだテンプレートがありません。下のボタンで作ってください。</div></div>') +
      '<div class="acts l"><button type="button" class="btn ghost" data-act="tpl-add" data-kind="daily">＋ 毎日</button><button type="button" class="btn ghost" data-act="tpl-add" data-kind="weekday">＋ 曜日ごと</button><button type="button" class="btn ghost" data-act="tpl-add" data-kind="date">＋ 日付指定</button></div>' +
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
        tr.querySelector('[data-rf="t"]').classList.toggle('bad', es.length > 0 && (isNaN(m) || es.some((x) => !/払い戻し/.test(x))));
        tr.querySelector('[data-rf="p"]').classList.toggle('bad', !/^\d+$/.test(p) || +p < 1 || +p > PAY_MAX);
        tr.querySelector('.msg').innerHTML = es.length ? '<div class="err">' + es.map(esc).join('<br>') + '</div>' : '<span class="okmsg" style="font-size:12px">OK</span>';
        if (es.length) bad = true;
      });
      box.classList.toggle('has-err', bad);
      const cnt = box.querySelector('[data-cnt]'); if (cnt) cnt.textContent = t.rows.length + ' レース';
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
    box.innerHTML = '<div class="summary" style="grid-template-columns:1fr 1fr"><div class="stat"><small>レース数</small><b>' + items.length + '</b></div><div class="stat"><small>払い戻しの合計</small><b>' + fmtN(total) + '</b></div></div>' +
      (items.length ? '<div class="pv-list"><table><tr><th>時刻</th><th>店舗</th><th class="n">払い戻し</th><th>テンプレート</th></tr>' + items.map((x) => '<tr class="' + (isToday && toMin(x.t) < nm ? 'past' : '') + '"><td>' + esc(x.t) + '</td><td>' + esc(storeName(x.store)) + (!x.store && x.scope === 'store' ? '<small class="hint"> 店ごと</small>' : '') + '</td><td class="n">' + fmtN(x.p) + '</td><td><small class="hint">' + esc(x.name || '') + '</small></td></tr>').join('') + '</table></div>'
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
    tt.tpls.push(t); ttDirty = true; ttRerender();
    const box = main.querySelector('[data-tk="' + t.k + '"]'); if (box) box.scrollIntoView({ block: 'center' });
  }
  function bulkCreate(t, box) {
    const q = (f) => box.querySelector('[data-bf="' + f + '"]');
    const f = toMin(q('from').value), to = toMin(q('to').value), ev = Number(q('every').value), p = String(q('pay').value).trim();
    const bad = [];
    if (isNaN(f) || isNaN(to)) bad.push('開始と終了の時刻を入れてください'); else if (to < f) bad.push('終了は開始より後にしてください（日をまたぐときは 2 つに分けてください）');
    if (!(ev >= 1 && ev <= 180 && Math.floor(ev) === ev)) bad.push('何分おきは 1〜180 の整数');
    if (!/^\d+$/.test(p) || +p < 1 || +p > PAY_MAX) bad.push('払い戻しの合計は 1〜' + fmtN(PAY_MAX) + ' の整数（額）');
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
  function viewRaces() {
    const list = racesData || [];
    const tm = now();
    const sum = list.reduce((a, r) => { a.bet += r.betTotal || 0; a.target += r.payoutTarget || 0; if (r.status === 'done' || r.status === 'decided') { a.paid += r.paidTotal || 0; a.done++; } a.players += (r.participants && r.participants.total) || 0; return a; }, { bet: 0, paid: 0, target: 0, done: 0, players: 0 });
    const nextIdx = list.findIndex((r) => statusOf(r) === 'open' || statusOf(r) === 'vote' || r.status === 'upcoming');
    return '<div class="panel"><h3>レース一覧<span class="sp"></span><span class="chip">' + (raceDate === bizToday() ? '10 秒ごとに更新' : '') + '</span></h3>' +
      '<div class="range"><label class="f"><span>日付</span><input type="date" id="rdate" value="' + esc(raceDate) + '"></label><div class="quick" style="align-items:end;padding-bottom:10px"><button class="btn sm ghost" data-act="rq" data-n="-1">前の日</button><button class="btn sm ghost" data-act="rq" data-n="0">今日</button><button class="btn sm ghost" data-act="rq" data-n="1">次の日</button><button class="btn sm ghost" data-act="races-reload">読み直す</button></div></div>' +
      (racesErr ? '<div class="err">' + esc(racesErr) + '</div>' : '') +
      '<div class="summary"><div class="stat"><small>レース（確定 / 全部）</small><b>' + sum.done + ' / ' + list.length + '</b></div><div class="stat"><small>参加（のべ人数）</small><b>' + fmtN(sum.players) + '</b></div><div class="stat"><small>賭けたチップ</small><b>' + chipN(sum.bet) + '</b></div><div class="stat"><small>当選額（実際 / 設定）</small><b>' + fmtN(sum.paid) + ' / ' + fmtN(sum.target) + '</b></div></div>' +
      (racesData == null ? '<div class="empty">読み込み中…</div>' : !list.length ? '<div class="empty">この日のレースはありません（時刻表を確かめてください）</div>' :
        '<div class="tbl"><table><tr><th>発走</th><th>店舗</th><th>状態</th><th class="n">参加</th><th class="n">賭けたチップ</th><th class="n">払い戻し 設定</th><th class="n">当選額</th><th>1 着（100あたり）</th><th></th></tr>' +
        list.map((r, i) => {
          const st = STATUS[statusOf(r)] || [r.status, 'st-upcoming'];
          const res = r.result, w = res ? res.winner : null;
          const canRefund = ['closed', 'decided', 'done'].indexOf(r.status) >= 0 && !r.refunded;
          return '<tr class="' + (i === nextIdx ? 'now' : r.endAt && r.endAt < tm ? 'past' : '') + '"><td class="mono">' + hm(r.at) + '</td><td>' + esc(storeName(r.storeId)) + (r.scope === 'store' && !r.storeId ? '<small class="hint"> 店ごと</small>' : '') + '</td>' +
            '<td><span class="status ' + st[1] + '">' + st[0] + '</span>' + (r.refunded ? ' <small class="hint">返還 リングバウンティ ' + fmtN(r.refundBounty != null ? r.refundBounty : r.refundTotal) + '</small>' : '') + '</td><td class="n">' + fmtN(r.participants && r.participants.total) + '</td><td class="n">' + chipN(r.betTotal) + '</td>' +
            '<td class="n">' + fmtN(r.payoutTarget) + '</td><td class="n">' + (r.status === 'decided' || r.status === 'done' ? fmtN(r.paidTotal) : '—') + '</td>' +
            '<td>' + (res ? esc(horseTxt(r, w)) + ' <span class="hint">' + (res.finalOdds && res.finalOdds[w] != null ? per1(res.finalOdds[w]) : '') + '</span>' + reasonTxt(r.decision) + cueTxt(r) : '<span class="hint">—</span>') + '</td>' +
            '<td>' + (canRefund ? '<button class="btn xs ghost" data-act="race-refund" data-id="' + esc(r.id) + '">返還…</button>' : '') + '</td></tr>';
        }).join('') + '</table></div>') +
      '<p class="hint">「設定」は時刻表の払い戻しの合計、「実際」は当たった人への払い戻しの合計です（必ず誰かは当たる着順を選ぶので、設定とずれることがあります）。受付中の行は少し明るく出ます。</p></div>';
  }

  /* ======================================================================
     裏の調整（店舗マニュアルには出さない）
     ====================================================================== */
  function viewTuning() {
    const T = cfg.tuning;
    const cur = TUNE_PRESETS.find((p) => Math.abs(p[2].volatility - T.volatility) < 1e-6 && Math.abs(p[2].shiftUp - T.shiftUp) < 1e-6 && Math.abs(p[2].shiftDown - T.shiftDown) < 1e-6);
    return '<div class="panel"><h3>裏の調整</h3><p class="hint">結果の出方の調整です。<b>店舗には見せない画面です</b>（店舗マニュアルにも書きません）。変更は、これから作るレースに反映されます。</p>' +
      '<div class="quick">' + TUNE_PRESETS.map((p) => '<button type="button" class="btn sm ' + (cur && cur[0] === p[0] ? '' : 'ghost') + '" data-act="tpreset" data-p="' + p[0] + '" title="' + esc(p[3]) + '">' + p[1] + '</button>').join('') + '</div>' +
      '<p class="hint" style="margin-top:6px">プリセットを押すと、荒れやすさと確定オッズを上げる幅・下げる幅がまとめて変わります（保存は下のボタン）。</p>' +
      stepRow('払い戻し率', '表示オッズの払い戻し率', 'payoutRate', Math.round(T.payoutRate * 100), '%', 50, 99, 1) +
      stepRow('荒れやすさ', '1.0 がふつう。大きいほど人気薄が勝つ', 'volatility', T.volatility, '倍', 0.3, 2.5, 0.1) +
      stepRow('確定オッズを上げる幅', '締切後、見せていたオッズより上げてよい幅', 'shiftUp', Math.round(T.shiftUp * 100), '%', 0, 30, 1) +
      stepRow('確定オッズを下げる幅', '締切後、見せていたオッズより下げてよい幅。0% ならお客さんが損をしない', 'shiftDown', Math.round(T.shiftDown * 100), '%', 0, 30, 1) +
      stepRow('当たりの幅（目標より少ない側）', '払い戻しの合計が目標より何%少なくてもよいか', 'bandBelow', Math.round(T.bandBelow * 100), '%', 0, 50, 1) +
      stepRow('当たりの幅（目標より多い側）', '払い戻しの合計が目標より何%多くてもよいか', 'bandAbove', Math.round(T.bandAbove * 100), '%', 0, 50, 1) +
      '<p class="hint" id="bandEx">' + bandExample(T.bandBelow, T.bandAbove) + '</p>' +
      stepRow('払い出しの上限（1 レース）', '0 = なし。当選額の合計（額）。必ず当たりのほうを優先', 'payoutCap', T.payoutCap || 0, '', 0, 99999900, 1000) +
      stepRow('払い出しの上限（1 日）', '0 = なし。全店の当選額の合計（額）' + (cfg.capDayOk ? '' : '（<b style="color:var(--warn)">サーバー側の対応待ち。まだ保存されません</b>）'), 'payoutCapDay', T.payoutCapDay || 0, '', 0, 999999900, 10000) +
      '</div>' +
      viewHorseLook(T) + viewCues(T) +
      '<div class="panel" id="bountyPanel"><h3>交換の割合</h3><p class="hint">スタッフがリングバウンティを受け取って casa DERBY のチップにするときの割合です（店舗・お客さんに見せてよい設定。スマホとスタッフ画面に出ます）。変えると、<b>これから認証する分</b>から新しい割合になります。認証済みの券・返却・返還・記録は、認証したときの割合のままです。</p>' +
      stepRow('交換の割合（リングバウンティ ○枚 ＝ 100チップ）', '例 20 なら チップ 3,000 ＝ リングバウンティ 600枚。当たったときの額（チップ × オッズ）は変わりません', 'bountyPerTicket', T.bountyPerTicket || 20, '枚', 1, 1000, 1) + '</div>' +
      '<div class="panel"><h3>時間</h3><p class="hint">参加受付・投票・結果画面の秒数は、<b>店舗を追加したときの初期値</b>です（店舗ごとに変えられます）。受付は 2 段: 参加受付（引き換え）が締め切ったあと、投票の秒数だけ投票できます。ゲートインとゴール後は全店共通です（全店で同時に走るため）。</p>' +
      stepRow('参加受付（引き換え）の秒数（初期値）', '新しい店舗の初期値。会計番号・枚数の入力とスタッフの認証ができる長さ', 'exchangeSec', T.exchangeSec != null ? T.exchangeSec : 90, '秒', 10, 1800, 5) +
      stepRow('投票の秒数（初期値）', '新しい店舗の初期値。参加受付の締切から投票の締切まで', 'voteSec', T.voteSec != null ? T.voteSec : 30, '秒', 10, 600, 5) +
      stepRow('結果画面の秒数（初期値）', '新しい店舗の初期値', 'resultSec', T.resultSec || 300, '秒', 10, 1800, 10) +
      stepRow('ゲートイン', '発走時刻からゲートが開くまで', 'gateSec', T.gateSec, '秒', 0, 60, 1) +
      stepRow('ゴール後', 'リプレイ・写真判定・勝ち馬（結果発表まで）', 'postSec', T.postSec, '秒', 0, 120, 1) +
      '</div>' +
      '<div class="savebar"><div class="msg" id="tumsg"></div><button type="button" class="btn ghost" data-act="tun-revert">元に戻す</button><button type="button" class="btn" data-act="tun-save" id="tusave">保存</button></div>';
  }
  /* 確定演出（店舗には見せない）: 演出ごとに「出す割合」と「当たる割合」。保存は下の「保存」ボタン（ほかの裏の調整と一緒。変えた演出だけ送る） */
  function viewCues(T) {
    const cz = T.cues || DEF_CUES;
    return '<div class="panel" id="cuesPanel"><h3>演出（店舗には見せない）</h3>' +
      '<p class="hint">レースの中に、勝ち馬をほのめかす演出を隠します。<b>出す割合</b>はその演出が出る割合、<b>当たる割合</b>は出たときに本当の勝ち馬を指す割合です。<b>100% ＝ 確定。外れたときは別の馬を指します。複数同時に出ることがあります</b>。変更はこれから結果を決めるレースから反映されます。</p>' +
      CUES.map(([k, name, how]) => { const c = cz[k] || DEF_CUES[k]; return '<div class="cue-row" data-cue="' + k + '"><h4 style="margin:10px 0 2px;font-size:14px">' + esc(name) + ' <small class="hint" style="font-weight:normal">' + esc(how) + '</small></h4>' +
        stepRow('出す割合', '', 'cueShow_' + k, c.show, '%', 0, 100, 5) + stepRow('当たる割合', '', 'cueHit_' + k, c.hit, '%', 0, 100, 5) + '</div>'; }).join('') +
      '</div>';
  }
  /* 今日のレースの 1 行: 出た演出と、本当の勝ち馬を指していたか（○ / ×）。cues はサーバーが結果と一緒に決めたもの（管理と合言葉のあるテレビにだけ届く） */
  function cueTxt(r) {
    const cz = r.cues || (r.decision && r.decision.cues); if (!cz || !r.result) return '';
    const fired = CUES.filter(([k]) => cz[k] && cz[k].horse != null);
    const t = fired.length ? '演出: ' + fired.map(([k, name]) => { const h = cz[k].horse, no = r.horses && r.horses[h] ? r.horses[h].no || h + 1 : h + 1; return name + '→' + no + '番 ' + (h === r.result.winner ? '○' : '×'); }).join(' / ') : '演出なし';
    return '<small class="hint cue-txt" style="display:block;margin:0">' + esc(t) + '</small>';
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
  const TUN_KEYS = ['payoutRate', 'volatility', 'shiftUp', 'shiftDown', 'bandBelow', 'bandAbove', 'payoutCap', 'payoutCapDay', 'exchangeSec', 'voteSec', 'resultSec', 'gateSec', 'postSec', 'bountyPerTicket'].concat(CUE_KEYS);
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
      bountyPerTicket: Math.round(numOf('bountyPerTicket')), /* 交換の割合（整数 1〜1000） */
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
      return dayRow({ date: x.date, races: x.races, players: b.players == null ? null : b.players, tickets: b.tickets, bet: b.bet, paid: b.paid, claimed: b.claimed, bountyIn: b.bountyIn, exchanged: b.exchanged, bountyReturned: b.bountyReturned, bountyReturnedPaid: b.bountyReturnedPaid, bountyRefund: b.bountyRefund, bountyRefundPaid: b.bountyRefundPaid });
    });
  }
  function byStoreRows(d) {
    if (!d || !d.days || !d.days.some((x) => x.byStore)) return null;
    const acc = {};
    d.days.forEach((x) => Object.keys(x.byStore || {}).forEach((k) => { const a = acc[k] = acc[k] || { storeId: k, tickets: 0, bet: 0, paid: 0, claimed: 0, bountyIn: 0, exchanged: 0, bountyReturned: 0, bountyReturnedPaid: 0, bountyRefund: 0, bountyRefundPaid: 0, players: null }; const b = x.byStore[k]; ['tickets', 'bet', 'paid', 'claimed', 'bountyIn', 'exchanged', 'bountyReturned', 'bountyReturnedPaid', 'bountyRefund', 'bountyRefundPaid'].forEach((f) => { a[f] += b[f] || 0; }); if (b.players != null) a.players = (a.players || 0) + b.players; }));
    return Object.keys(acc).filter((k) => !stStore || k === stStore).map((k) => Object.assign({ storeId: k }, dayRow(acc[k])));
  }
  const nOrDash = (v) => (v == null ? '—' : fmtN(v));
  function viewStats() {
    const quick = [['today', '今日'], ['yday', '昨日'], ['7', '7 日'], ['month', '今月'], ['31', '31 日']];
    const days = statDays();
    const tot = days.reduce((a, x) => { Object.keys(a).forEach((k) => { if (x[k] != null) a[k] = (a[k] || 0) + x[k]; }); return a; }, { races: 0, players: stStore ? null : 0, tickets: 0, bet: 0, paid: 0, claimed: 0, unclaimed: 0, bountyIn: 0, exchanged: 0, bountyReturned: 0, bountyReturnedPaid: 0, bountyRefund: 0, bountyRefundPaid: 0 });
    const bs = byStoreRows(statsData);
    const L = logsData;
    return '<div class="panel"><h3>集計</h3>' +
      '<div class="range"><label class="f"><span>開始</span><input type="date" id="stfrom" value="' + esc(stFrom) + '" max="' + esc(stTo) + '"></label><label class="f"><span>終了</span><input type="date" id="stto" value="' + esc(stTo) + '" min="' + esc(stFrom) + '"></label>' +
      '<label class="f"><span>店舗</span><select id="ststore"><option value="">全店舗</option>' + cfg.stores.map((s) => '<option value="' + esc(s.id) + '"' + (stStore === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label></div>' +
      '<div class="quick">' + quick.map((q) => '<button class="btn sm ghost" data-act="stq" data-q="' + q[0] + '">' + q[1] + '</button>').join('') + '<span style="flex:1"></span><button class="btn sm ghost" data-act="st-csv"' + (days.length ? '' : ' disabled') + '>CSV に書き出す</button></div>' +
      (statsErr ? '<div class="err">' + esc(statsErr) + '</div>' : '') +
      /* 見出しを分ける（2026-10-17）: リングバウンティ（受け取った・返却した）と投票券の枚数、当選額・受取額（額。1 枚 = 100）を混ぜない */
      '<h4 class="sumh">リングバウンティとチップ</h4><div class="summary" id="statBounty"><div class="stat"><small>受け取ったリングバウンティ</small><b>' + fmtN(tot.bountyIn) + '</b></div>' +
      '<div class="stat"><small>賭けたチップ</small><b>' + chipN(tot.bet) + '</b><small>引き換えた ' + chipN(tot.exchanged) + '</small></div>' +
      '<div class="stat" id="statRet"><small>返却したリングバウンティ</small><b>' + fmtN(tot.bountyReturnedPaid + tot.bountyRefundPaid) + '</b><small>返却（投票なし）' + fmtN(tot.bountyReturned) + (tot.bountyRefund ? '・返還（不成立）' + fmtN(tot.bountyRefund) : '') + '</small></div>' +
      '<div class="stat"><small>参加人数（会計番号）</small><b>' + nOrDash(tot.players) + '</b></div><div class="stat"><small>レース数</small><b>' + fmtN(tot.races) + '</b></div></div>' +
      '<h4 class="sumh">当選額・受取額</h4><div class="summary" id="statMoney"><div class="stat"><small>当選額</small><b>' + fmtN(tot.paid) + '</b></div><div class="stat"><small>受取額（渡した）</small><b>' + fmtN(tot.claimed) + '</b></div>' +
      '<div class="stat ' + (tot.unclaimed ? 'ng' : '') + '"><small>未受け取り</small><b>' + fmtN(tot.unclaimed) + '</b></div>' + '<div class="stat"><small>払い戻し率（実績）</small><b>' + (tot.bet ? Math.round(tot.paid / (tot.bet * YEN) * 1000) / 10 + '%' : '—') + '</b></div></div>' +
      (statsData == null && !statsErr ? '<div class="empty">読み込み中…</div>' :
        '<div class="tbl"><table><tr><th>日付</th><th class="n">レース</th><th class="n">参加人数</th><th class="n">受け取ったリングバウンティ</th><th class="n">賭けたチップ</th><th class="n">当選額</th><th class="n">受取額</th><th class="n">未受け取り</th><th class="n">返却したリングバウンティ</th><th class="n">率</th></tr>' +
        (days.length ? days.map((x) => '<tr><td>' + fmtDay(x.date) + '</td><td class="n">' + fmtN(x.races) + '</td><td class="n">' + nOrDash(x.players) + '</td><td class="n">' + fmtN(x.bountyIn) + '</td><td class="n">' + chipN(x.bet) + '</td><td class="n">' + fmtN(x.paid) + '</td><td class="n">' + fmtN(x.claimed) + '</td><td class="n">' + (x.unclaimed ? '<b style="color:var(--ng)">' + fmtN(x.unclaimed) + '</b>' : '0') + '</td><td class="n">' + fmtN(x.bountyReturnedPaid + x.bountyRefundPaid) + '</td><td class="n">' + (x.bet ? Math.round(x.rate * 1000) / 10 + '%' : '—') + '</td></tr>').join('') : '<tr><td colspan="10" class="empty">この期間のデータはありません</td></tr>') + '</table></div>') +
      (bs ? '<h3 style="margin-top:16px">店舗別</h3><div class="tbl"><table><tr><th>店舗</th><th class="n">参加人数</th><th class="n">受け取ったリングバウンティ</th><th class="n">賭けたチップ</th><th class="n">当選額</th><th class="n">受取額</th><th class="n">未受け取り</th><th class="n">返却したリングバウンティ</th></tr>' +
        bs.map((x) => '<tr><td>' + esc(storeName(x.storeId)) + '</td><td class="n">' + nOrDash(x.players) + '</td><td class="n">' + fmtN(x.bountyIn) + '</td><td class="n">' + chipN(x.bet) + '</td><td class="n">' + fmtN(x.paid) + '</td><td class="n">' + fmtN(x.claimed) + '</td><td class="n">' + fmtN(x.unclaimed) + '</td><td class="n">' + fmtN(x.bountyReturnedPaid + x.bountyRefundPaid) + '</td></tr>').join('') + '</table></div>' : '') +
      '<p class="hint">受け取ったリングバウンティ＝スタッフが認証で受け取ったリングバウンティ（認証したときの交換の割合。例 20 なら 100チップ ＝ リングバウンティ 20枚）。賭けたチップ＝馬に賭けたチップ（下の小さな「引き換えた」は投票しなかった分も入ります）。当選額＝当たりの合計（チップ × オッズ）。受取額＝スタッフが渡した額。未受け取り＝当たったのにまだ渡していない額。返却したリングバウンティ＝投票しなかった券（返却）と成立しなかったレース（返還）で、スタッフがお客さんに返したリングバウンティ。払い戻し率＝当選額 ÷ 賭けたチップ。テストモードの店舗の分は入りません。</p></div>' +
      '<div class="panel"><h3>会計番号の記録</h3><p class="hint">会計番号ごとのチップ・受け取ったリングバウンティ・当選額・受取額（渡した額）・返却したリングバウンティ。期間と店舗は上の集計と同じです。会計番号を空にすると全部出ます。</p>' +
      '<div class="range"><label class="f"><span>会計番号</span><input type="text" id="lbill" value="' + esc(logBill) + '" maxlength="12" placeholder="例: 1234" autocapitalize="off"></label><div class="quick" style="align-items:end;padding-bottom:10px"><button class="btn sm" data-act="log-search">検索</button><button class="btn sm ghost" data-act="log-csv"' + (L && L.logs.length ? '' : ' disabled') + '>CSV に書き出す</button></div></div>' +
      (logsErr ? '<div class="err">' + esc(logsErr) + '</div>' : '') +
      (L ? viewLogs(L) : '<div class="empty">会計番号を入れて「検索」を押してください</div>') + '</div>';
  }
  const LOG_KIND = { auth: ['認証', 'info'], win: ['当たり', 'warn'], paid: ['受け取り', 'ok'], refund: ['返還', 'ng'], expired: ['期限切れ', ''], return: ['返却', 'info'] };
  const logKind = (x) => (x.type === 'paid' && x.novote ? ['返却の受取', 'ok'] : x.type === 'paid' && x.kind === 'refund' ? ['返還の受取', 'ok'] : LOG_KIND[x.type] || [x.type, '']);
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
    return (bills.length ? '<div class="tbl"><table><tr><th>会計番号</th><th class="n">チップ</th><th class="n">受け取ったリングバウンティ</th><th class="n">当選額</th><th class="n">受取額</th><th class="n">未受け取り</th><th class="n">返却したリングバウンティ</th></tr>' +
      bills.slice(0, 200).map((b) => { const x = L.byBill[b]; const un = x.unclaimed != null ? x.unclaimed : Math.max(0, (x.win || 0) - (x.paid || 0)); return '<tr><td class="mono">' + esc(b) + '</td><td class="n">' + chipN(x.auth) + '</td><td class="n">' + fmtN(x.bounty) + '</td><td class="n">' + fmtN(x.win) + '</td><td class="n">' + fmtN(x.paid) + '</td><td class="n">' + (un ? '<b style="color:var(--ng)">' + fmtN(un) + '</b>' : '0') + '</td><td class="n">' + fmtN((x.retPaid || 0) + (x.refundPaid || 0)) + ((x.ret || x.refund) ? '<small class="hint">（返却 ' + fmtN(x.ret) + (x.refund ? '・返還 ' + fmtN(x.refund) : '') + (x.unreturned ? '・まだ ' + fmtN(x.unreturned) : '') + '）</small>' : '') + '</td></tr>'; }).join('') + '</table></div>' : '') +
      '<h3 style="margin-top:14px;font-size:14px">明細（' + fmtN(L.logs.length) + ' 件' + (L.logs.length > 500 ? '。新しい 500 件を表示' : '') + '）</h3>' +
      (L.logs.length ? '<div class="tbl"><table><tr><th>日時</th><th>店舗</th><th>会計番号</th><th>ニックネーム</th><th>種類</th><th class="n">チップ・リングバウンティ・額</th><th>レース</th></tr>' +
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
  async function loadOpsRaces() {
    const d = opsDate, my = (loadOpsRaces.seq = (loadOpsRaces.seq || 0) + 1); // 日付を続けて変えたとき、前の日付の答えで上書きしない（返還するレースを取り違えないように）
    try { const r = await api('races', d); if (my !== loadOpsRaces.seq || d !== opsDate) return; opsRaces = (r && r.races) || []; }
    catch (e) { if (my !== loadOpsRaces.seq || d !== opsDate) return; opsRaces = []; }
    if (tab === 'ops') keepScroll(() => { main.innerHTML = viewOps(); });
  }
  function viewOps() {
    const rs = (opsRaces || []).filter((r) => r.status !== 'upcoming');
    const sel = rs.find((r) => r.id === opsRace);
    return '<div class="panel"><h3>テレビの再読み込み</h3><p class="hint">店舗のテレビ（Fire TV）を今すぐ読み込み直して、新しい版に切り替えます（casa SLOT の「全店舗をいますぐアップデート」と同じ）。レース中のテレビも、読み込み直したあと全店同時の走りに途中から追いつきます。</p>' +
      '<div class="range"><label class="f"><span>対象</span><select id="rlstore"><option value="">全店舗</option>' + cfg.stores.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('') + '</select></label><div class="quick" style="align-items:end;padding-bottom:10px"><button class="btn" data-act="tv-reload"' + (cfg.stores.length ? '' : ' disabled') + '>テレビを今すぐ再読み込み</button></div></div></div>' +
      '<div class="panel"><h3>成立しなかったレースの返還</h3><p class="hint">ネットが切れた・テレビが止まったなどでレースが成立しなかったときに使います。そのレースの当たりを取り消して、<b>受け取ったリングバウンティをそのまま返す</b>扱いにします（認証したときの交換の割合で、賭けたチップぶんのリングバウンティ。お客さんのスマホに返還用の QR が出て、スタッフが読み取ってリングバウンティを返します。すでに渡した当選額はそのままです（取り戻さない・差し引かない）。まだ渡していない当選額は取り消します。記録には「返還」として残ります）。元に戻せません。</p>' +
      '<div class="range"><label class="f"><span>日付</span><input type="date" id="opsdate" value="' + esc(opsDate) + '"></label>' +
      '<label class="f"><span>レース</span><select id="opsrace"><option value="">選んでください</option>' + rs.map((r) => '<option value="' + esc(r.id) + '"' + (r.id === opsRace ? ' selected' : '') + '>' + hm(r.at) + ' ' + esc(storeName(r.storeId)) + '（' + (STATUS[statusOf(r)] || [r.status])[0] + '・賭け ' + fmtN(r.betTotal) + ' 枚）</option>').join('') + '</select></label></div>' +
      (sel ? '<div class="summary"><div class="stat"><small>発走</small><b>' + hm(sel.at) + '</b></div><div class="stat"><small>参加</small><b>' + fmtN(sel.participants && sel.participants.total) + ' 人</b></div><div class="stat"><small>返還するリングバウンティ（チップ ' + chipN(sel.betTotal) + '・認証したときの割合）</small><b>' + fmtN(sel.betBounty != null ? sel.betBounty : sel.betTotal) + '</b></div><div class="stat"><small>取り消す当選額</small><b>' + fmtN(sel.paidTotal) + '</b></div></div>' : '') +
      '<div class="acts"><button class="btn danger" data-act="refund"' + (sel && !sel.refunded && ['closed', 'decided', 'done'].indexOf(sel.status) >= 0 ? '' : ' disabled') + '>このレースを返還する</button></div>' +
      (sel && (sel.refunded || sel.status === 'void') ? '<div class="okmsg">このレースは返還済みです</div>' : '') + '</div>' +
      '<details class="panel"><summary>テスト用（本番では使わない）</summary>' +
      '<p class="hint">時刻表とは別に、今すぐレースを作ります。テストモードの店舗で動きを確かめるときに使います。</p>' +
      '<div class="range"><label class="f"><span>何秒後に発走</span><input type="number" id="trin" value="90" min="5" max="3600"></label><label class="f"><span>払い戻しの合計（額）</span><input type="number" id="trpay" value="30000" min="1" max="' + PAY_MAX + '"></label>' +
      '<label class="f"><span>店舗</span><select id="trstore"><option value="">全店（同時）</option>' + cfg.stores.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + 'だけ</option>').join('') + '</select></label></div>' +
      '<div class="acts"><button class="btn ghost" data-act="test-race">テストのレースを作る</button></div></details>';
  }

  /* ---------- 入力イベント ---------- */
  main.addEventListener('input', (e) => {
    const el = e.target;
    if (tab === 'stores' && editStore) return validateStore();
    if (tab === 'tuning') { tunDirty = true; return validateTuning(); }
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
      if (el.id === 'pvdate') { pvDate = el.value; pvServer = null; if (pvSrc === 'server') loadServerPreview(); return paintPreview(); }
      if (el.id === 'pvstore') { pvStore = el.value; pvServer = null; if (pvSrc === 'server') loadServerPreview(); return paintPreview(); }
    }
    if (el.id === 'rdate') { raceDate = el.value || bizToday(); racesData = null; render(); return; }
    if (el.id === 'stfrom' || el.id === 'stto' || el.id === 'ststore') {
      stFrom = $('stfrom').value || stFrom; stTo = $('stto').value || stTo; stStore = $('ststore').value;
      if (stFrom > stTo) { const x = stFrom; stFrom = stTo; stTo = x; }
      logsData = null; return loadStats();
    }
    if (el.id === 'opsdate') { opsDate = el.value || bizToday(); opsRaces = null; opsRace = ''; return loadOpsRaces(); }
    if (el.id === 'opsrace') { opsRace = el.value; keepScroll(() => { main.innerHTML = viewOps(); }); return loadOpsRaces(); } // 選んだら最新の枚数で出し直す
  });
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
        case 'cfg-reload': await reloadCfg(); render(); toast('読み直しました'); return;
        case 'tvacct-new': return createTvAccount(b);
        case 'tvkey-new': if (!confirm('テレビの合言葉を作り直します。\n今のテレビは、新しい URL で開き直すまで発表前の結果を受け取れなくなります（URL が漏れたときに使います）。')) return; await api('tvKey', {}); await reloadCfg(); render(); toast('作り直しました。各店のテレビを新しい URL で開き直してください'); return;
        case 'store-new': editStore = { isNew: true, id: '', name: '', pin: '', orig: {}, x: sset({ settings: {} }) }; return render();
        case 'store-edit': { const s = cfg.stores.find((x) => x.id === b.dataset.id); editStore = { isNew: false, id: s.id, name: s.name, pin: s.pin, orig: s.settings, x: sset(s) }; window.scrollTo(0, 0); return render(); }
        case 'store-cancel': editStore = null; return render();
        case 'store-save': b.disabled = true; try { return await saveStore(); } finally { b.disabled = false; }
        case 'store-del': return await deleteStore();
        case 'mode-add': { captureStore(); const last = editStore.x.modes[editStore.x.modes.length - 1]; editStore.x.modes.push({ k: nk(), from: last ? last.to : '18:00', to: '', mode: 'bet' }); keepScroll(() => { main.innerHTML = viewStoreEdit(); }); return validateStore(); }
        case 'mode-del': { captureStore(); editStore.x.modes = editStore.x.modes.filter((m) => m.k !== b.dataset.k); keepScroll(() => { main.innerHTML = viewStoreEdit(); }); return validateStore(); }
        /* 時刻表 */
        case 'tpl-add': return addTpl(b.dataset.kind);
        case 'tpl-on': { const t = tplOf(b); t.enabled = !t.enabled; ttDirty = true; return ttRerender(); }
        case 'tpl-up': case 'tpl-down': { const t = tplOf(b), i = tt.tpls.indexOf(t), j = i + (act === 'tpl-up' ? -1 : 1); if (j < 0 || j >= tt.tpls.length) return; tt.tpls.splice(i, 1); tt.tpls.splice(j, 0, t); ttDirty = true; return ttRerender(); }
        case 'tpl-dup': { const t = tplOf(b), c = JSON.parse(JSON.stringify(t)); c.k = nk(); c.id = 'tt' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); c.name = (t.name || tplName(t)) + ' のコピー'; c.rows.forEach((r) => { r.k = nk(); }); if (c.kind === 'date') c.date = addDays(isDate(t.date) ? t.date : todayStr(), 1); tt.tpls.splice(tt.tpls.indexOf(t) + 1, 0, c); ttDirty = true; return ttRerender(); }
        case 'tpl-del': { const t = tplOf(b); if (t.rows.length && !confirm('テンプレート「' + tplName(t) + '」（' + t.rows.length + ' レース）を消します（保存するまでは元に戻せます）。')) return; tt.tpls.splice(tt.tpls.indexOf(t), 1); ttDirty = true; return ttRerender(); }
        case 'row-add': { const t = tplOf(b), last = t.rows[t.rows.length - 1], gap = Math.ceil(minGapSec().sec / 60); const m = last && !isNaN(toMin(last.t)) ? Math.min(23 * 60 + 59, toMin(last.t) + Math.max(gap, 5)) : 19 * 60; t.rows.push({ k: nk(), t: fromMin(m), p: last ? last.p : '300' }); ttDirty = true; ttRerender(); const ins = main.querySelectorAll('[data-tk="' + t.k + '"] [data-rf="t"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
        case 'row-dup': { const t = tplOf(b), r = rowOf(t, b), gap = Math.ceil(minGapSec().sec / 60), m = toMin(r.t); const c = { k: nk(), t: isNaN(m) ? '' : fromMin(Math.min(23 * 60 + 59, m + Math.max(gap, 5))), p: r.p }; t.rows.splice(t.rows.indexOf(r) + 1, 0, c); ttDirty = true; return ttRerender(); }
        case 'row-del': { const t = tplOf(b), r = rowOf(t, b); t.rows.splice(t.rows.indexOf(r), 1); ttDirty = true; return ttRerender(); }
        case 'row-sort': { const t = tplOf(b); sortRows(t); return ttRerender(); }
        case 'row-clear': { const t = tplOf(b); if (!confirm('「' + tplName(t) + '」の ' + t.rows.length + ' レースを全部消します（保存するまでは元に戻せます）。')) return; t.rows = []; ttDirty = true; return ttRerender(); }
        case 'row-payall': { const t = tplOf(b); const v = prompt('このテンプレートの払い戻しの合計を全部この額にします（1〜' + fmtN(PAY_MAX) + '）', t.rows[0] ? t.rows[0].p : '30000'); if (v == null) return; if (!/^\d+$/.test(v.trim()) || +v < 1 || +v > PAY_MAX) { toast('1〜' + fmtN(PAY_MAX) + ' の整数を入れてください'); return; } t.rows.forEach((r) => { r.p = v.trim(); }); ttDirty = true; return ttRerender(); }
        case 'bulk': { const t = tplOf(b); return bulkCreate(t, b.closest('[data-tk]')); }
        case 'tt-revert': if (ttDirty && !confirm('保存していない変更を捨てて、保存済みの時刻表に戻します。')) return; loadTT(); return ttRerender();
        case 'tt-save': b.disabled = true; try { return await saveTT(); } finally { if (document.contains(b)) paintTT(); }
        case 'pv-local': pvSrc = 'local'; keepScroll(() => { main.innerHTML = viewTT(); paintTT(); }); return;
        case 'pv-server': pvSrc = 'server'; keepScroll(() => { main.innerHTML = viewTT(); paintTT(); }); return loadServerPreview();
        /* 今日のレース */
        case 'rq': raceDate = +b.dataset.n === 0 ? bizToday() : addDays(raceDate || bizToday(), +b.dataset.n); racesData = null; return render();
        case 'races-reload': return loadRaces();
        case 'race-refund': opsDate = raceDate; opsRace = b.dataset.id; opsRaces = racesData; tab = 'ops'; document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'ops')); return render();
        /* 裏の調整 */
        case 'tpreset': { const p = TUNE_PRESETS.find((x) => x[0] === b.dataset.p); $('n-volatility').value = p[2].volatility; $('n-shiftUp').value = Math.round(p[2].shiftUp * 100); $('n-shiftDown').value = Math.round(p[2].shiftDown * 100); tunDirty = true; main.querySelectorAll('[data-act="tpreset"]').forEach((x) => x.classList.toggle('ghost', x !== b)); return validateTuning(); }
        case 'hlook': return saveHorseLook(b.dataset.v, b);
        case 'tun-revert': tunDirty = false; return keepScroll(render);
        case 'tun-save': b.disabled = true; try { return await saveTuning(); } finally { if (document.contains(b)) validateTuning(); }
        /* 集計 */
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
          const sid = $('rlstore').value;
          if (!confirm((sid ? '「' + storeName(sid) + '」' : '全店舗') + 'のテレビを今すぐ読み込み直します。')) return;
          const rr = await api('reload', sid || undefined);
          toast((sid ? storeName(sid) : '全店舗') + 'のテレビに再読み込みを指示しました（いまつながっているテレビ ' + ((rr && rr.sent) || 0) + ' 台）'); return;
        }
        case 'refund': {
          const r = (opsRaces || []).find((x) => x.id === opsRace); if (!r) return;
          if (!confirm(hm(r.at) + ' のレース（' + storeName(r.storeId) + '）を返還します。\nチップ ' + chipN(r.betTotal) + ' ぶんのリングバウンティ ' + fmtN(r.betBounty != null ? r.betBounty : r.betTotal) + '枚を返し、当選額 ' + fmtN(r.paidTotal) + ' は取り消します。元に戻せません。')) return;
          b.disabled = true;
          const rf = await api('refund', r.id);
          toast('返還しました（リングバウンティ ' + fmtN(rf && (rf.bounty != null ? rf.bounty : rf.refundTotal)) + '枚）'); opsRaces = null; racesData = null; return loadOpsRaces();
        }
        case 'test-race': {
          const inSec = Number($('trin').value), payout = Number($('trpay').value), sid = $('trstore').value || null;
          if (!(inSec >= 5 && inSec <= 3600) || !(payout >= 1 && payout <= PAY_MAX)) { toast('数字の範囲を確かめてください'); return; }
          b.disabled = true; // 2 度押しで同じ時刻のレースが 2 つできないように
          let r; try { r = await api('createRace', { inSec, payout, scope: 'all', storeId: sid }); } finally { b.disabled = false; }
          toast('テストのレースを作りました（' + hm((r && (r.at || (r.race && r.race.at))) || now() + inSec * 1000) + ' 発走）'); opsRaces = null; racesData = null; return loadOpsRaces();
        }
      }
    } catch (err) { toast('失敗しました: ' + errText(err)); }
  });

  window.DerbyAdmin = { // テスト用の入口（tests/v2-admin.plan.js）
    get tt() { return tt; }, get cfg() { return cfg; }, get dirty() { return ttDirty; },
    validate: () => (tt ? validateTT() : null), templatesToRules: () => templatesToRules(tt.tpls), daySchedule: (d, s) => daySchedule(tt.tpls, d, s || null).map((x) => ({ t: x.t, p: x.p, store: x.group })),
    go(name) { const b = document.querySelector('#tabs [data-tab="' + name + '"]'); if (b) b.click(); return tab; },
  };
  start();
})();
