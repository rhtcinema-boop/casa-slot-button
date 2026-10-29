/* casa DERBY 管理画面（v4・2026-10-21）: 今日／時刻表／テレビ／調整／集計
   元の仕様: 仕様書_v4_大改修.md。中身（core）の関数と項目は v2/V4_CORE_NOTES.md の 8 章。画面のメモは v2/V4_UI_ADMIN_NOTES.md。
   v4 で変わったこと: 参加無料・1 人 1 票（会計番号）・2 連単だけ。リングバウンティの交換の割合・参加受付の秒数・賭けたチップ・当選額の割合・返却はなくした。
   投票の秒数（初期 180 秒・全店同じ）・元の額 100pt（決まり）・倍率のずらし幅（上限なし。1.0 倍より下げない）・払い出しの上限・当たりの幅・時刻表（走り出す時刻・全店同じ・当選額の目標）。
   通信はすべて DerbyCloud（v2/client.js）経由（模擬クラウドも Firestore も同じ関数）。
   方針: 時刻表は「エラーがあったら保存できない」（casa SLOT の配当表と同じ）。見た目と言葉は 2026-10-19 のシンプル化（deploy/ADMIN_SIMPLE_NOTES.md）のまま。
   2026-10-26 オーナー: 営業は 25 時まで。時刻は「25:00」の書き方（05:00〜28:59・文字の欄・Core.fmtBizTime と同じ営業日の時計で表示）。
   時刻表の行ごとに「投票できる店」のチェック（rule.storeIds。null ＝ 全店）。今日のレース・この日の予定に店の札（全店／上野・札幌）。
   2026-10-27 オーナー: 時刻表に「祝日」の予定（kind 'holiday'。祝日は core.js が自動で判定: Core.isHoliday / Core.holidayName。振替休日・国民の休日を含む）。
   使う順は 日付 → 祝日 → 曜日 → 毎日（サーバーと同じ）。この日の予定・今日のレースに「祝日・文化の日」の金の札。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (v) => Number(v || 0).toLocaleString('en-US');
  const pad = (n) => ('0' + n).slice(-2);
  const main = $('main');
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const RUN_SEC = 60; // 走り（約 58 秒）に少し余裕を足した長さ。最短間隔の計算に使う（v2/core.js の minGapSec と同じ）
  /* 当選額の目標・上限は pt（100pt 単位に丸めて保存＝core.js の roundAmount）。当選額 ＝ 100pt × 2 連単の倍率を 100pt 単位に切り上げ */
  const PAY_MAX = 99999900, STAKE = 100, TEST_VOTE_SEC = 60;
  const ptN = (v) => fmtN(v) + '<small class="pt">pt</small>', ptT = (v) => fmtN(v) + 'pt';
  const per1 = (o) => (o ? (Math.round(Number(o) * 10) / 10).toFixed(1) + '倍' : '');
  const payFor = (o) => Math.ceil(Math.round(Number(o) * 10) / 10 - 1e-9) * STAKE; // 12.4 倍 → 1,300pt（core.js の payFor と同じ）
  const STATUS = { upcoming: ['予定', 'st-upcoming'], vote: ['投票中', 'st-open'], closed: ['締切', 'st-closed'], decided: ['レース中', 'st-decided'], done: ['確定', 'st-done'], void: ['取り消し済み', 'st-void'] };
  const MODES = [['auto', 'ずっと自動で始める'], ['bet', '誰かが投票したら始める'], ['staff', 'スタッフが始める']];
  const modeName = (m) => (MODES.find((x) => x[0] === m) || MODES[0])[1];
  /* 確定演出（店舗には見せない。v4 でも「1 着の馬だけ教える」）: 演出名 → [表示名, どう見えるか]。割合の初期値は v2/core.js の DEFAULT_CUES と同じ */
  const CUES = [['fruit', '木の実の色', 'コース脇の木の実が、その馬の枠の色になる'], ['crowd', '観客の服の色', '観客の服がその馬の枠の色に寄る'], ['sign', '看板の絵柄', '向こう正面の看板にその馬の枠の色が出る'], ['cloud', '雲の形', 'その馬の番号の形をした雲が浮かぶ'], ['gateLate', 'ゲートインで遅れた馬', 'その馬だけゲートに入るのをためらう'], ['eye', '最終コーナーで目が光る', '最終コーナーでその馬の目が光る']];
  const DEF_CUES = { fruit: { show: 30, hit: 100 }, crowd: { show: 40, hit: 70 }, sign: { show: 30, hit: 100 }, cloud: { show: 30, hit: 100 }, gateLate: { show: 25, hit: 70 }, eye: { show: 20, hit: 100 } };
  const DEF_TUNING = { horseLook: 'cute', payoutRate: 0.85, volatility: 1, payoutCap: 0, payoutCapDay: 0, shiftUp: 0.1, shiftDown: 0.1, bandBelow: 0.2, bandAbove: 0.2, payoutSpread: 0.3, voteSec: 180, resultSec: 300, gateSec: 8, postSec: 28, photoExtraSec: 6, closeLeadSec: 0, scenes: { paddock: true, gate: true, replay: true, winner: true }, cues: DEF_CUES, maxBillsPerDevice: 4 };
  const TUNE_PRESETS = [['steady', '堅め', { volatility: 0.7, shiftUp: 0.05, shiftDown: 0.05 }, '人気の組み合わせが来やすい・倍率のずらしは小さめ'], ['normal', 'ふつう', { volatility: 1.0, shiftUp: 0.1, shiftDown: 0.1 }, '今の作り'], ['wild', '荒れやすい', { volatility: 1.5, shiftUp: 0.15, shiftDown: 0.15 }, '人気薄も来る・倍率のずらしは大きめ']];
  const BIG_SHIFT = 50; // ずらし幅がこれ（%）より大きいと「見た倍率と大きく変わります」

  /* ---------- 時刻（サーバー時刻・日本時間） ---------- */
  let C = null, A = null;
  const now = () => (C && typeof C.serverNow === 'function' ? C.serverNow() : Date.now());
  const JST = 9 * 3600e3;
  const iso = (ms) => new Date(ms + JST).toISOString();
  const ymd = (ms) => iso(ms).slice(0, 10);
  const hms = (ms) => iso(ms).slice(11, 19);
  const hm = (ms) => iso(ms).slice(11, 16);
  const todayStr = () => ymd(now());
  // 営業日の「今日」（区切りは dayStartHour 時、初期 5 時）: レース一覧・集計はこちら。時刻表は暦の日付のまま
  const DSH = () => (cfg && cfg.tuning && cfg.tuning.dayStartHour != null ? Number(cfg.tuning.dayStartHour) : 5);
  const bizYmd = (ms) => ymd(ms - DSH() * 3600e3);
  const bizToday = () => bizYmd(now());
  /* 営業日の時計（2026-10-26 オーナー: 深夜 1 時は「25:00」と出す）。core.js の Core.fmtBizTime(ms, dayStartHour) と同じ。
     模擬クラウドでは core.js が読まれないことがあるので、無いときは同じ式で出す（日本時間の時が dayStartHour より前なら +24） */
  const bizHM = (ms) => {
    if (window.DerbyCore && typeof DerbyCore.fmtBizTime === 'function') return DerbyCore.fmtBizTime(ms, DSH());
    const d = new Date(ms + JST); let h = d.getUTCHours(); if (h < DSH()) h += 24;
    return pad(h) + ':' + pad(d.getUTCMinutes());
  };
  const bizMin = (ms) => toMin(bizHM(ms)); // 営業日の 0:00 からの分（25:30 → 1530）
  /* 祝日（2026-10-27 オーナー）: 判定は core.js の Core.isHoliday(日付) / Core.holidayName(日付)（振替休日・国民の休日を含む）。
     模擬クラウドでは client.js が core.js を読まないので、無ければ ensureCore で自分の隣の core.js を読む。読めない間・読めなかったときは「祝日ではない」として何も出さない（bizHM と同じ考え） */
  const holidayName = (ds) => { const K = window.DerbyCore; if (!K || typeof K.holidayName !== 'function' || !isDate(ds)) return null; try { return K.holidayName(ds) || null; } catch (e) { return null; } };
  const isHoliday = (ds) => { const K = window.DerbyCore; if (!K || !isDate(ds)) return false; if (typeof K.isHoliday === 'function') { try { return !!K.isHoliday(ds); } catch (e) { return false; } } return !!holidayName(ds); };
  const holidayChip = (ds, cls) => { const n = holidayName(ds); return n ? '<span class="chip holiday' + (cls ? ' ' + cls : '') + '">祝日・' + esc(n) + '</span>' : ''; }; // 金の札「祝日・文化の日」
  const SELF_SRC = (document.currentScript && document.currentScript.src) || '';
  function ensureCore() {
    if (window.DerbyCore || !SELF_SRC) return;
    const s = document.createElement('script');
    s.src = SELF_SRC.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + 'core.js' + ((/[?]v=[^#&]+/.exec(SELF_SRC) || [''])[0]); // 自分（admin.js?v=…）と同じ版の印を付ける
    s.onload = () => { if (tab === 'timetable' && tt) paintPreview(); if (tab === 'races' && racesData) keepScroll(() => { main.innerHTML = viewRaces(); }); }; // 読めたら祝日の札を出し直す
    s.onerror = () => { /* 読めなければ祝日なしのまま */ };
    document.head.appendChild(s);
  }
  const addDays = (d, n) => ymd(Date.parse(d + 'T00:00:00Z') + n * 864e5);
  const wdOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
  const fmtDay = (d) => (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '(' + WD[wdOf(d)] + ')';
  /* 2026-10-26 オーナー: 営業は 25 時（深夜 1 時）まで。時刻表の時刻は「25:00」と書く（05:00〜28:59。深夜は 24:00〜28:59。00:00〜04:59 は受け付けない＝core.js と同じ決まり）。
     toMin は 24 時以上もそのまま分にする（25:00 → 1500）。fromMin は日をまたいでも 0 時に戻さない（1500 → "25:00"）。範囲の確かめは timeOk */
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); if (!m) return NaN; const h = +m[1], mi = +m[2]; return h < 48 && mi < 60 ? h * 60 + mi : NaN; };
  const fromMin = (m) => { m = Math.max(0, Math.round(m)); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
  const TT_MIN = 5 * 60, TT_MAX = 28 * 60 + 59, TIME_MSG = '時刻は 05:00〜28:59 で（深夜は 24:00〜28:59）'; // core.js の normalizeRules と同じ言葉
  const timeOk = (m) => !isNaN(m) && m >= TT_MIN && m <= TT_MAX;
  // 文字の時刻欄の整え（欄を離れたとき）: 「1900」→「19:00」・「25」→「25:00」・「9:5」→「09:05」・全角の数字と「：」も半角に。読めない文字はそのまま返す（赤い欄になる）
  const normTime = (s) => {
    s = String(s == null ? '' : s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/：/g, ':').replace(/\s+/g, '');
    let m = /^(\d{1,2}):(\d{1,2})$/.exec(s); if (m) return pad(+m[1]) + ':' + pad(+m[2]);
    m = /^(\d{1,2})(\d{2})$/.exec(s); if (m) return pad(+m[1]) + ':' + m[2];
    m = /^(\d{1,2})$/.exec(s); if (m) return pad(+m[1]) + ':00';
    return s;
  };
  // 時刻の入力欄（type=time だと 24 時以上が打てないので文字の欄。数字キーで開く）
  const timeInput = (attrs, val) => '<input type="text" class="tm" inputmode="numeric" placeholder="19:00" pattern="^\\d{1,2}:\\d{2}$" maxlength="5" autocomplete="off" ' + attrs + ' value="' + esc(val) + '">';
  const secTxt = (s) => (s >= 60 ? Math.floor(s / 60) + '分' + (s % 60 ? (s % 60) + '秒' : '') : s + '秒');
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d + 'T00:00:00Z'));

  let toastTimer = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800); }
  const errText = (e) => (e && e.code === 'not_supported' ? 'サーバーがまだこの操作に対応していません' : (e && (e.body && e.body.message || e.message)) || '通信できませんでした');

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
  let tab = 'races'; // 最初に開くのは「今日」
  let editStore = null; // 店舗の編集中のコピー（「テレビ」タブの中）
  let tt = null; // 時刻表の編集中のコピー { tpls }
  let ttDirty = false, ttOrig = new Set(); // ttOrig: 読み込んだ時点の「テンプレートid|時刻」（過去の時刻を新しく足したかの判定用）
  let tunDirty = false;
  let pvDate = '', pvSrc = 'local', pvServer = null;
  let raceDate = '', racesData = null, racesErr = '', racesTimer = 0;
  let stFrom = '', stTo = '', stStore = '', statsData = null, statsErr = '';
  let abuseData = null, abuseErr = '', abuseOff = false; // 見える化（集計タブの「注意」。2026-10-27）: api('abuse') の答え／使えないサーバー（古い）なら出さない
  let logBill = '', logsData = null, logsErr = '';
  let raceAll = false, refundOpen = null; // 今日のレース: 全部を表示するか／その場で開いているレース取消（レース id）
  let pairData = null, pairErr = '', pairSeq = 0; // 進行役のテレビ: api('tvs') の答え { tvs, decider, backups, fireTvs, lock, lockInfo, now }
  let healthData = null, healthAt = 0; // 進行役のテレビが止まっていないか（2026-10-28）: api('health') の答え { lock, stall, text }
  let memoOn = false, connOpen = false; // memoOn: 勝ち馬の決まり方（オーナー用。最初は隠す）／connOpen: リンクの畳みを開いているか
  const tplOpen = new Set(); // 時刻表: 開いているテンプレート（id）
  const tplAll = new Set(); // 時刻表: 行を全部見せているテンプレート（id）。ふだんは最初の 10 行だけ
  const ROWS_SHOWN = 10;
  let uid = 0; const nk = () => 'k' + (++uid);

  function normCfg(c) {
    const T = Object.assign({}, DEF_TUNING, (c && c.tuning) || {});
    T.scenes = Object.assign({}, DEF_TUNING.scenes, (c && c.tuning && c.tuning.scenes) || {});
    { const src = (c && c.tuning && c.tuning.cues) || {}, cz = {}; CUES.forEach(([k]) => { cz[k] = Object.assign({}, DEF_CUES[k], src[k] || {}); }); T.cues = cz; } /* 演出: 足りない演出は初期値 */
    return {
      stores: ((c && c.stores) || []).map((s) => ({ id: s.id, name: s.name || s.id, pin: s.pin == null ? '' : String(s.pin), settings: Object.assign({}, s.settings || {}), tvKey: s.tvKey || null })),
      rules: ((c && c.timetable && c.timetable.rules) || []).map((r) => Object.assign({}, r)),
      tuning: T,
      tvKey: (c && c.tvKey) || null, // テレビの合言葉（模擬クラウドだけ。テレビの URL の tvkey=）
    };
  }
  const storeName = (id) => { if (!id) return '全店'; const s = cfg.stores.find((x) => x.id === id); return s ? s.name : id + '（削除済み）'; };
  /* 2026-10-26 オーナー: レース（時刻）ごとに投票できる店（race.storeIds / rule.storeIds。null ＝ 全店）。「全店」か「上野・札幌」のように店名を・でつなぐ */
  const storesTxt = (ids) => (!Array.isArray(ids) || !ids.length ? '全店' : ids.map(storeName).join('・'));
  const storesChip = (ids) => '<span class="chip st' + (Array.isArray(ids) && ids.length ? ' lim' : '') + '">' + esc(storesTxt(ids)) + '</span>';
  // 行の店の選び方（r.s: 店 id の配列。null ＝ 全店）: 知らない店（削除済み）は外し、全部の店がそろっていれば null に
  const cleanStores = (ids) => { if (!Array.isArray(ids)) return null; const all = cfg.stores.map((s) => s.id), out = all.filter((id) => ids.indexOf(id) >= 0); return out.length === all.length ? null : out; };

  /* ---------- ログイン ---------- */
  function viewLogin(msg) {
    return '<div class="panel" id="login"><h3>ログイン</h3><p class="hint">casa DERBY の管理パスワード</p>' +
      '<label class="f"><span>パスワード</span><input type="password" id="pw" autocomplete="current-password"></label>' +
      '<div class="err" id="lerr">' + esc(msg || '') + '</div><div class="acts"><button class="btn" id="dologin">ログイン</button></div></div>';
  }
  async function start() {
    if (!window.DerbyCloud) { main.innerHTML = '<div class="panel"><h3>接続できません</h3><p class="hint">v2/client.js が読み込めませんでした。</p></div>'; return; }
    C = DerbyCloud.create({ role: 'admin' });
    ensureCore(); // 祝日の判定（core.js）。模擬クラウドでは client.js が読まないので自分で読む（2026-10-27）
    try { await C.syncClock(); } catch (e) { /* 時刻合わせに失敗しても端末の時計で続ける */ }
    const saved = sessionStorage.getItem(PW_KEY);
    if (saved) { try { await login(saved); return; } catch (e) { sessionStorage.removeItem(PW_KEY); } }
    showLogin('');
  }
  function showLogin(msg) {
    main.innerHTML = viewLogin(msg); main.classList.add('loginv'); // ログインの間だけ画面の真ん中に大きく
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
    main.classList.remove('loginv');
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

  const leaveOk = () => !((ttDirty && tab === 'timetable') || (tunDirty && tab === 'tuning') || (editStore && tab === 'tv')) || confirm('保存していない変更があります。破棄して移動しますか？');
  window.addEventListener('beforeunload', (e) => { if (ttDirty || tunDirty) { e.preventDefault(); e.returnValue = ''; } });
  const markTab = () => document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  function switchTab(name) {
    if (name === tab) { if (!editStore) { if (tab === 'races') racesData = null; if (tab === 'tv') pairData = null; render(); } return; } // いまのタブを押したら読み直す
    if (!leaveOk()) return;
    if (tab === 'timetable' && ttDirty) { tt = null; ttDirty = false; }
    if (tab === 'tuning') tunDirty = false;
    if (tab === 'races') { memoOn = false; refundOpen = null; } // 勝ち馬の決まり方・レース取消はほかの画面へ移ったら閉じ直す
    editStore = null; connOpen = false; // 畳みは別の画面に移ったら閉じた状態から
    if (name === 'tv') pairData = null; // 進行役のテレビは開くたびに読み直す
    tab = name; markTab(); window.scrollTo(0, 0);
    render();
    if (name === 'races' && racesData) loadRaces(true); // 今日に戻ったら、前に読んだ一覧を出したまま読み直す（10 秒を待たない）
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); });

  function render() {
    clearInterval(racesTimer);
    main.classList.toggle('wide', tab === 'timetable' || tab === 'races' || tab === 'stats');
    if (tab === 'tv') { main.innerHTML = editStore ? viewStoreEdit() : viewTvPanel() + viewStores(); if (editStore) validateStore(); else if (!pairData && pairOk()) loadPair(); }
    else if (tab === 'timetable') { if (!tt) loadTT(); main.innerHTML = viewTT(); paintTT(); }
    else if (tab === 'races') { if (!raceDate) raceDate = bizToday(); main.innerHTML = viewRaces(); if (!racesData) loadRaces(); racesTimer = setInterval(() => { if (tab === 'races' && raceDate === bizToday()) loadRaces(true); }, 10000); }
    else if (tab === 'tuning') { main.innerHTML = viewTuning(); validateTuning(); }
    else if (tab === 'stats') { if (!stFrom) { stTo = bizToday(); stFrom = addDays(stTo, -6); } main.innerHTML = viewStats(); if (!statsData && !statsErr) loadStats(); }
  }
  const keepScroll = (fn) => { const y = window.scrollY; fn(); window.scrollTo(0, y); };

  /* ---------- 共通の部品 ---------- */
  // 数字の入力（◀ ▶ と直接入力）。値は保存のときに DOM から読む
  function stepRow(label, hint, key, val, unit, min, max, step) {
    return '<div class="row"><div class="lbl">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</div>' +
      '<div class="stepper" data-k="' + key + '" data-min="' + min + '" data-max="' + max + '" data-step="' + step + '"><button type="button" data-act="st" data-d="-1" aria-label="減らす">◀</button>' +
      '<input class="pv" type="number" inputmode="decimal" id="n-' + key + '" value="' + val + '" min="' + min + '" max="' + max + '" step="' + step + '" style="--d:' + pvDigits(max, step) + '"><i>' + unit + '</i>' +
      '<button type="button" data-act="st" data-d="1" aria-label="増やす">▶</button></div></div>';
  }
  /* 数字の欄の幅（2026-10-23 見直し）: いちばん大きい値の桁数（99999900 → 8 桁）。admin.css の .stepper input.pv が --d から幅を決める＝大きな上限でも数字が欄からはみ出さない */
  const pvDigits = (max, step) => String(Math.floor(Math.abs(Number(max) || 0))).length + (Number(step) < 1 ? 2 : 0);
  // 変えられない値（決まり）の 1 行
  const fixedRow = (label, hint, val, id) => '<div class="row fixed"' + (id ? ' id="' + id + '"' : '') + '><div class="lbl">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</div><div class="fixv"><b>' + val + '</b><small>決まり</small></div></div>';
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
  // 馬の番号（0 始まりの添字 → 「3番」）と 2 連単の組み合わせ（'2-4' → 「3→5」）
  const noOf = (r, h) => (r && r.horses && r.horses[h] && r.horses[h].no) || h + 1;
  const comboTxt = (k, r) => { const m = /^(\d+)-(\d+)$/.exec(String(k || '')); return m ? noOf(r, +m[1]) + '→' + noOf(r, +m[2]) : ''; };

  /* ======================================================================
     テレビ（テレビの切り替え・画質・進行役・リンク）と店舗（名前・暗証番号・結果の時間など）
     ====================================================================== */
  function sset(s) {
    const st = (s && s.settings) || {}, T = cfg.tuning;
    const n = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    return {
      resultSec: n(st.resultSec, T.resultSec || 300),
      scenes: Object.assign({ paddock: true, gate: true, replay: true }, st.scenes || {}),
      sceneSec: Object.assign({ paddock: 30, gate: T.gateSec, replay: T.postSec }, st.sceneSec || {}),
      modes: Array.isArray(st.modes) ? st.modes.map((m) => ({ k: nk(), from: m.from || '', to: m.to || '', mode: m.mode || 'auto' })) : [],
      modeDefault: st.modeDefault || 'auto',
      test: !!st.test,
      tvGame: st.tvGame === 'derby' ? 'derby' : 'slot', /* テレビのゲーム: casa SLOT のテレビがこれを見て切り替わる */
      tvStrip: stripOf(st), /* 最もなめらか（'min'）のときに会場から削るもの（2026-10-29）。true ＝削る */
      tvQuality: qOf(st), /* テレビの画質: 'min' ＝最もなめらか（演出なし）・'lite' ＝さらになめらか（最軽量）・'auto' ＝なめらか優先・'' ＝標準・'max' ＝きれい優先 */
    };
  }
  const gameName = (g) => (g === 'derby' ? 'casa DERBY' : 'casa SLOT');
  /* 最もなめらか（'min'）の「削るもの」（2026-10-29 オーナー: 店ごとに選ぶ）。settings.tvStrip = { crowd, signs, props, trees, buildings, backdrop }（true ＝削る）。
     v2/core.js の tvStripOf と同じ（無い・変な値は A 案）。テレビは v2/tvswitch.js が 1 分ほどで読み直す（レース中は終わってから）。書くのはマスター（店舗の保存）だけ */
  const STRIPS = [['crowd', '観客'], ['signs', '看板'], ['props', '小物（パラソル・旗・のぼり・飾り）'], ['trees', '木'], ['buildings', '建物・スタンド'], ['backdrop', '背景（観覧車・飛行船・遠くの景色）']];
  const STRIP_A = { crowd: true, signs: true, props: true, trees: false, buildings: false, backdrop: false };
  const STRIP_B = { crowd: true, signs: true, props: true, trees: true, buildings: true, backdrop: true };
  const stripOf = (st) => { const v = st && st.tvStrip, o = {}; STRIPS.forEach(([k]) => { o[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof v[k] === 'boolean' ? v[k] : STRIP_A[k]; }); return o; };
  const sameStrip = (a, b) => STRIPS.every(([k]) => !!a[k] === !!b[k]);
  const stripName = (o) => (sameStrip(o, STRIP_A) ? 'A案' : sameStrip(o, STRIP_B) ? 'B案' : 'カスタム');
  const STRIP_NOTE = '削ると、その場所を使う演出は出ません（結果は変わりません）';
  /* 削るものの欄: where = 'row'（テレビのタブの店の行。押すとすぐ保存）／'edit'（店舗の編集。保存ボタンで） */
  function stripBox(id, name, o, where) {
    const row = where === 'row', pre = (p, label, cur) => '<button type="button" class="btn xs ghost' + (cur ? ' on' : '') + '" data-act="' + (row ? 'strip-preset' : 'sstrip-preset') + '" data-id="' + esc(id) + '" data-p="' + p + '" aria-pressed="' + cur + '">' + label + '</button>';
    return '<div class="tvstrip" data-strip="' + esc(id) + '"' + (where === 'edit-hidden' ? ' hidden' : '') + ' role="group" aria-label="' + esc(name) + 'の最もなめらかで削るもの"><div class="sh"><b>削るもの</b><small>最もなめらか のとき・いま ' + stripName(o) + '</small></div>' +
      '<div class="ck">' + STRIPS.map(([k, nm]) => '<label><input type="checkbox" ' + (row ? 'data-strip-ck="' + esc(id) + '"' : 'id="sstrip-' + k + '"') + ' data-k="' + k + '"' + (o[k] ? ' checked' : '') + '><span>' + esc(nm) + '</span></label>').join('') + '</div>' +
      '<div class="pre">' + pre('a', 'A案（観客と看板と小物を削る・建物は残す）', sameStrip(o, STRIP_A)) + pre('b', 'B案（全部削る）', sameStrip(o, STRIP_B)) + '</div>' +
      '<p class="hint">' + STRIP_NOTE + '</p></div>';
  }
  /* [値, 名前, ひとこと, テレビの行の短い名前]。'lite'（2026-10-28 オーナー: 渋谷のテレビは「なめらか優先」でもカクカクする）は管理画面だけで選べる（スタッフのスマホ・casa SLOT のスタッフの画面は 3 択のまま） */
  /* 'min'（2026-10-28 オーナー: さらになめらかでもカクカクする弱い Fire TV 向け）も管理画面だけ */
  const QUALS = [['min', '最もなめらか（演出なし）', '会場の飾り・観客・看板をなくして一番軽く。木や旗の演出は出ません', '最もなめらか'], ['lite', 'さらになめらか（最軽量）', '動きが重いテレビ向け。画面は少し粗くなります', 'さらになめらか'], ['auto', 'なめらか優先', '重いときは自動で少し粗くして、動きをなめらかに'], ['', '標準', 'ふだんはこれ。細かさはそのまま'], ['max', 'きれい優先', '影までくっきり。動きがカクカクすることがあります']];
  const qOf = (st) => (st && (st.tvQuality === 'min' || st.tvQuality === 'lite' || st.tvQuality === 'auto' || st.tvQuality === 'max') ? st.tvQuality : '');
  const qName = (q) => (q === 'min' ? '最もなめらか（演出なし）' : q === 'lite' ? 'さらになめらか（最軽量）' : q === 'auto' ? 'なめらか優先' : q === 'max' ? 'きれい優先' : '標準');
  function viewStores() {
    const S = cfg.stores;
    return '<div class="panel" id="storePanel"><h3>店舗（名前・暗証番号）<span class="sp"></span><button class="btn sm ghost" data-act="cfg-reload">最新の情報にする</button></h3>' +
      (S.length ? '<div class="list">' + S.map((s) => {
        const x = sset(s);
        return '<div class="item"><div class="name">' + esc(s.name) + (x.test ? ' <span class="chip test">テストモード</span>' : '') + ' <span class="chip' + (x.tvGame === 'derby' ? ' on' : '') + '">テレビ: ' + gameName(x.tvGame) + '</span>' + (x.tvQuality ? ' <span class="chip">画質: ' + qName(x.tvQuality) + '</span>' : '') +
          '<small>暗証番号 ' + esc(s.pin) + '・結果を見せる時間 ' + x.resultSec + '秒</small></div>' +
          '<button class="btn sm ghost" data-act="store-edit" data-id="' + esc(s.id) + '">変える</button></div>';
      }).join('') + '</div>' : '<div class="empty">まだ店舗がありません</div>') +
      '<div class="acts l"><button class="btn ghost" data-act="store-new">＋ 店舗を追加</button></div></div>';
  }
  /* テレビ: 店ごとに 1 行（店名 › ・SLOT|DERBY・読み込み直す・画質）＋全店舗の読み込み直し＋進行役のテレビ＋畳んだリンク */
  function viewTvPanel() {
    const S = cfg.stores;
    const link = (label, href) => '<div class="lnk"><b>' + esc(label) + ' <button type="button" class="btn xs ghost" data-act="copy" data-copy="' + esc(new URL(href, location.href).href) + '">コピー</button></b><a href="' + esc(href) + '" target="_blank">' + esc(href) + '</a></div>';
    return '<div class="panel" id="tvPanel"><h3>テレビを切り替える</h3>' +
      '<p class="hint">ふだんは DERBY のまま。SLOT にしていても、<b>投票が始まると自動で DERBY</b> になります（遊んでいる途中なら終わってから）。</p>' +
      (S.length ? S.map((s) => {
        const g = sset(s).tvGame;
        const x0 = sset(s);
        return '<div class="tvrow' + (x0.tvQuality === 'min' ? ' hasstrip' : '') + '" data-store="' + esc(s.id) + '"><button type="button" class="nm" data-act="store-edit" data-id="' + esc(s.id) + '" aria-label="' + esc(s.name) + 'の設定を開く" title="店舗の設定を開く">' + esc(s.name) + '<i aria-hidden="true">›</i>' + (sset(s).test ? '<span class="chip test">テスト</span>' : '') + '<span class="tvnow" data-g="' + g + '">テレビ: ' + gameName(g) + '</span></button>' +
          '<div class="seg" role="group" aria-label="' + esc(s.name) + 'のテレビに映すゲーム">' + ['slot', 'derby'].map((v) => '<button type="button" data-act="tvgame-set" data-id="' + esc(s.id) + '" data-v="' + v + '" class="' + (g === v ? 'on' : '') + '" aria-pressed="' + (g === v) + '">' + (v === 'derby' ? 'DERBY' : 'SLOT') + '</button>').join('') + '</div>' +
          '<button class="btn sm ghost" data-act="tv-reload" data-store="' + esc(s.id) + '" aria-label="' + esc(s.name) + 'のテレビを読み込み直す">読み込み直す</button>' +
          '<div class="tvq"><span>画質</span><div class="seg q5r" role="group" aria-label="' + esc(s.name) + 'のテレビの画質">' + QUALS.map(([v, nm, , short]) => '<button type="button" data-act="tvq-set" data-id="' + esc(s.id) + '" data-v="' + v + '" class="' + (sset(s).tvQuality === v ? 'on' : '') + '" aria-pressed="' + (sset(s).tvQuality === v) + '"' + (short ? ' title="' + nm + '" aria-label="' + nm + '"' : '') + '>' + (short || nm) + '</button>').join('') + '</div></div>' + (x0.tvQuality === 'min' ? stripBox(s.id, s.name, x0.tvStrip, 'row') : '') + '</div>';
      }).join('') : '<div class="empty">まだ店舗がありません（下の「＋ 店舗を追加」）</div>') +
      (S.length ? '<p class="hint tvqhint">画質は casa DERBY を映しているときのもの。最もなめらか＝さらになめらかでも重いテレビ向け。会場の飾り・観客・看板なし（木や旗の演出も出ません）／さらになめらか＝動きが重いテレビ向け。画面は少し粗くなります／なめらか優先＝重いときは自動で少し粗く／きれい優先＝動きがカクカクすることがあります。1 分ほどで反映（レース中は終わってから）。</p>' : '') +
      (S.length > 1 ? '<div class="acts l tvall"><button class="btn sm ghost" data-act="tv-reload" data-store="">全店舗のテレビを読み込み直す</button></div>' : '') +
      viewPair() +
      '<details class="fold conn" id="connFold"' + (connOpen ? ' open' : '') + '><summary>テレビ・スマホ・スタッフ画面のリンク</summary><div class="in">' +
      S.map((s) => '<details class="fold"><summary>' + esc(s.name) + '</summary><div class="in">' + link('テレビ用', tvUrl(s)) + link('お客様用', 'bet.html?store=' + encodeURIComponent(s.id)) + link('スタッフ用', 'staff.html?store=' + encodeURIComponent(s.id)) + '</div></details>').join('') +
      (cfg.tvKey ? '<p class="hint">テレビ用のリンクはお客さんに見せないでください。</p>' : '') +
      (isFs() ? '<p class="hint">テレビ用アカウントは最初に 1 回だけ作ります。</p>' : '') +
      '<div class="acts l">' + (isFs() ? '<button class="btn sm ghost" data-act="tvacct-new">テレビ用アカウントを作る</button>' : '') + (cfg.tvKey ? '<button class="btn sm ghost" data-act="tvkey-new">テレビのリンクを作り直す（漏れたとき）</button>' : '') + '</div>' +
      '</div></details></div>';
  }
  /* ---------- 進行役のテレビ: パスワードを打たずに、ここで 1 タップ ----------
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
  /* テレビの調子（2026-10-29。v2/tvhealth.js の label）: テレビ 1 台ぶん。大きな点数（電波・なめらかさ）＋言葉＋小さな細かい数字。
     悪い＝赤・ふつう＝黄。h が無い（古い版のテレビ）は「情報なし（古い版）」 */
  const TH = () => window.DerbyTvHealth || null;
  function healthHtml(x) {
    const T = TH(); if (!T) return '';
    const L = T.label(x.h);
    if (!L.has) return '<div class="tvh none"><small>' + esc(L.text) + '</small></div>';
    const big = (lv, n, word, name, title) => '<span class="sc lv-' + lv + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><b>' + (n == null ? '—' : n) + '<i>点</i></b><small>' + esc(name) + ' ' + esc(word) + '</small></span>';
    const r = L.race;
    return '<div class="tvh">' + big(L.sig.lv, L.sig.score, L.sig.word, '電波', '直近 5 分') + (L.sig.cut ? '<span class="chip cut">切れていた</span>' : '') +
      (r ? big(r.lv, r.score, r.word, 'なめらかさ', '直近のレース') + (r.avgN > 1 ? '<span class="avg">直近 ' + r.avgN + ' レースの平均 <b>' + r.avg + '点</b></span>' : '') : '<span class="sc lv-none"><b>—</b><small>なめらかさ まだレースなし</small></span>') +
      '<small class="hd">' + esc(L.net) + (r ? '<br>' + esc(r.text) + (r.last.off ? '・レース中に切れていた ' + r.last.off + '秒' : '') : '') + '<br>' + esc(L.vid) + '</small></div>';
  }
  function healthStores(tvs) { // 店ごとの 1 行（いちばん悪いテレビに合わせる）
    const T = TH(); if (!T) return '';
    const by = {}; tvs.forEach((x) => { (by[x.store] = by[x.store] || []).push(x.h); });
    const rows = Object.keys(by).map((sid) => { const s = T.storeLine(by[sid]); if (!s) return ''; return '<div class="hsrow"><b>' + esc(storeName(sid)) + '</b><span class="lv-' + s.sigLv + '">電波 ' + (s.sig == null ? '—' : s.sig + '点 ' + s.sigWord) + '</span>' + (s.cut ? '<span class="lv-bad">切れていた</span>' : '') + '<span class="lv-' + s.smoothLv + '">なめらかさ ' + (s.smooth == null ? '—' : s.smooth + '点 ' + s.smoothWord) + '</span></div>'; }).join('');
    return rows ? '<div class="hstores"><small>店ごとの調子（いちばん悪いテレビ）</small>' + rows + '</div>' : '';
  }
  function viewPair() {
    if (!pairOk()) return '';
    const P = pairData, head = '<div class="phd"><b>進行役のテレビ</b><small>結果を決めて進める役（1 台）と予備</small><span class="sp"></span><button type="button" class="btn xs ghost" data-act="pair-reload">最新にする</button></div>';
    if (!P) return '<div class="pair" id="pairBox">' + stallHtml() + head + '<div class="hint">' + (pairErr ? esc(pairErr) : '読み込み中…') + '</div></div>';
    const t = P.now || now(), tvs = P.tvs || [], lab = tvLabels(tvs), d = P.decider, STALE = 12 * 60000;
    const bk = new Set((P.backups || []).map((x) => x.id)), canBk = Array.isArray(P.backups);
    const fireNew = (P.fireTvs || []).filter((id) => !bk.has(id) && !(d && d.id === id)).length;
    const dName = d ? lab[d.id] || storeName(d.store) + 'のテレビ' : '';
    const nowLine = d
      ? '<div class="pnow">いま <b>' + esc(dName) + '</b> <small class="' + (d.seen && t - d.seen < STALE ? '' : 'warn') + '">' + (d.seen ? (t - d.seen < STALE ? (t - d.seen < 120000 ? '連絡あり' : agoTxt(t - d.seen) + 'に連絡') : '連絡がありません（' + agoTxt(t - d.seen) + '）') : '連絡がありません') + '</small><button type="button" class="btn xs ghost" data-act="pair-stop">やめる</button></div>'
      : '<div class="pnow">いま <b>なし</b>' + (P.lock && P.lock.kind === 'account' ? ' <small>パスワードのテレビ（' + esc(storeName(P.lock.store)) + '）が進めています</small>' : '') + '</div>';
    const rows = tvs.map((x) => {
      const me = d && d.id === x.id, old = t - x.at >= STALE, isB = bk.has(x.id);
      return '<div class="prow' + (me ? ' me' : '') + (isB ? ' bk' : '') + '" data-tv="' + esc(x.id) + '"><span class="nm">' + esc(lab[x.id]) + '<small' + (old ? ' class="old"' : '') + '>' + kindName(x.kind) + '・' + agoTxt(t - x.at) + '</small>' + healthHtml(x) + '</span>' +
        (isB ? '<span class="chip bkc">予備</span>' : '') +
        (me ? '<span class="chip on">進行役</span>' : '<button type="button" class="btn sm ghost" data-act="pair-set" data-id="' + esc(x.id) + '">進行役にする</button>' +
          (canBk ? '<button type="button" class="btn sm ghost" data-act="bk-set" data-id="' + esc(x.id) + '" data-on="' + (isB ? '0' : '1') + '">' + (isB ? '予備をやめる' : '予備にする') + '</button>' : '')) + '</div>';
    }).join('');
    /* いま進めているテレビ（鍵）と最後のエラー（2026-10-28） */
    const li = P.lockInfo, liLine = li && (li.lastErr || (li.until && li.until <= t)) ? '<p class="hint plock">' + (li.until && li.until > t ? 'いま進めている: ' + esc(li.uid && lab[li.uid] ? lab[li.uid] : storeName(li.store) + 'のテレビ') + (li.role === 'backup' ? '（予備）' : '') : '最後に進めていた: ' + esc(li.uid && lab[li.uid] ? lab[li.uid] : li.store ? storeName(li.store) + 'のテレビ' : '—') + '（' + agoTxt(t - (li.lastTickAt || li.at || t)) + '）') + (li.lastErr ? '・最後のエラー ' + esc(String(li.lastErr).slice(0, 80)) + (li.lastErrAt ? '（' + hms(li.lastErrAt).slice(0, 5) + '）' : '') : '') + '</p>' : '';
    const liveB = li && li.until > t && li.role === 'backup' ? '<p class="hint plock warn">いまは予備のテレビが進めています（進行役のテレビが戻ると自動で替わります）</p>' : '';
    return '<div class="pair" id="pairBox">' + stallHtml() + head + nowLine + liveB + liLine + (rows ? healthStores(tvs) + '<div class="plist">' + rows + '</div>' : '<div class="hint">テレビがまだありません。DERBY のテレビをつけると、ここに出ます。</div>') +
      (canBk && fireNew ? '<div class="acts l"><button type="button" class="btn sm ghost" data-act="bk-all">全店の Fire TV を予備にする（' + fireNew + ' 台）</button></div>' : '') +
      '<p class="hint" style="margin:6px 0 0">進行役のテレビは DERBY のままにしてください（SLOT だとレースが進みません）。' + (canBk ? '予備のテレビは、進行役が止まると 1〜2 分で自動で代わりに進めます。' : '') + '</p></div>';
  }
  /* 進行役のテレビが止まっている知らせ（2026-10-28）: 今日のタブの見出しの下と、テレビのタブの進行役の枠の上。赤い帯 */
  function stallHtml() { const h = healthData; return h && h.stall && h.text ? '<div class="err stallmsg" id="stallMsg" role="alert">' + esc(h.text) + '</div>' : ''; }
  async function loadHealth() {
    if (!pairOk() || typeof A.health !== 'function') return;
    const before = JSON.stringify(healthData && healthData.text);
    try { healthData = await api('health'); healthAt = Date.now(); } catch (e) { return; }
    if (JSON.stringify(healthData && healthData.text) === before) return;
    const el = $('stallMsg'), html = stallHtml();
    if (tab === 'races') { if (el) { if (html) el.outerHTML = html; else el.remove(); } else if (html) { const h = document.querySelector('#racePanel > h3'); if (h) h.insertAdjacentHTML('afterend', html); } }
    if (tab === 'tv' && !editStore) { const box = $('pairBox'); if (box) box.outerHTML = viewPair(); }
  }
  async function bkSet(btn) {
    const id = btn.dataset.id, on = btn.dataset.on === '1', name = tvLabels((pairData && pairData.tvs) || [])[id] || 'テレビ';
    btn.disabled = true;
    try { await api('setBackup', id, on); toast(name + (on ? 'を予備にしました' : 'の予備をやめました')); } catch (e) { toast('失敗しました: ' + errText(e)); }
    pairData = null; loadPair();
  }
  async function bkAll(btn) {
    btn.disabled = true;
    try { const r = await api('setBackupsAll'); toast(r && r.added && r.added.length ? 'Fire TV ' + r.added.length + ' 台を予備にしました' : '予備にする Fire TV はありませんでした'); } catch (e) { toast('失敗しました: ' + errText(e)); }
    pairData = null; loadPair();
  }
  async function loadPair() {
    const my = ++pairSeq;
    loadHealth();
    try { const r = await api('tvs'); if (my !== pairSeq) return; pairData = r || { tvs: [] }; pairErr = ''; }
    catch (e) { if (my !== pairSeq) return; pairErr = errText(e); pairData = null; }
    if (tab === 'tv' && !editStore) { const box = $('pairBox'); if (box) box.outerHTML = viewPair(); }
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
  /* テレビのゲームの切り替え: 書き込みは店舗の編集の「保存」とまったく同じ（saveStore。tvGame だけ変えて保存） */
  async function quickTvGame(b) {
    const s = cfg.stores.find((x) => x.id === b.dataset.id), v = b.dataset.v === 'derby' ? 'derby' : 'slot';
    if (!s || sset(s).tvGame === v) return;
    if (!/^\d{4,8}$/.test(s.pin)) { toast('この店舗の暗証番号を直してから切り替えてください（店名を押すと開きます）'); return; }
    if (!confirm(s.name + 'のテレビを ' + gameName(v) + ' に切り替えます。\n反映まで約 30 秒かかります（遊んでいる途中・レース中は終わってから）。' + (v === 'slot' ? '\n次のレースの投票が始まると、自動で casa DERBY に戻ります。' : ''))) return;
    main.querySelectorAll('[data-act="tvgame-set"][data-id="' + s.id + '"]').forEach((x) => { x.disabled = true; });
    editStore = { isNew: false, id: s.id, name: s.name, pin: s.pin, orig: s.settings, x: sset(s), quick: true }; editStore.x.tvGame = v;
    try { await saveStore(); toast(s.name + 'のテレビを ' + gameName(v) + ' にしました（30 秒ほどで切り替わります）'); }
    finally { editStore = null; keepScroll(render); }
  }
  /* テレビの画質: 書き込みは店舗の編集の「保存」と同じ（saveStore。tvQuality だけ変えて保存） */
  /* 削るもの（テレビのタブの店の行）: チェック・A案・B案を押すとすぐ保存（店舗の保存と同じ saveStore。tvStrip だけ変える） */
  async function quickTvStrip(id, o) {
    const s = cfg.stores.find((x) => x.id === id); if (!s) return;
    if (sameStrip(sset(s).tvStrip, o)) return;
    if (!/^\d{4,8}$/.test(s.pin)) { toast('この店舗の暗証番号を直してから変えてください（店名を押すと開きます）'); return keepScroll(render); }
    main.querySelectorAll('[data-strip="' + id + '"] input, [data-strip="' + id + '"] button').forEach((x) => { x.disabled = true; });
    editStore = { isNew: false, id: s.id, name: s.name, pin: s.pin, orig: s.settings, x: sset(s), quick: true }; editStore.x.tvStrip = Object.assign({}, o);
    try { await saveStore(); toast(s.name + 'の削るものを「' + stripName(o) + '」にしました（1 分ほどで反映。レース中は終わってから）'); }
    finally { editStore = null; keepScroll(render); }
  }
  async function quickTvQuality(b) {
    const s = cfg.stores.find((x) => x.id === b.dataset.id), v = qOf({ tvQuality: b.dataset.v });
    if (!s || sset(s).tvQuality === v) return;
    if (!/^\d{4,8}$/.test(s.pin)) { toast('この店舗の暗証番号を直してから変えてください（店名を押すと開きます）'); return; }
    if (!confirm(s.name + 'のテレビの画質を「' + qName(v) + '」にします。\n1 分ほどでテレビに反映されます（レース中は終わってから）。' + (v === 'max' ? '\nきれい優先は動きがカクカクすることがあります。' : v === 'lite' ? '\nさらになめらかは画面が少し粗くなります。' : v === 'min' ? '\n最もなめらかは会場の飾り・観客・看板が消え、木や旗の演出は出ません。' : ''))) return;
    main.querySelectorAll('[data-act="tvq-set"][data-id="' + s.id + '"]').forEach((x) => { x.disabled = true; });
    editStore = { isNew: false, id: s.id, name: s.name, pin: s.pin, orig: s.settings, x: sset(s), quick: true }; editStore.x.tvQuality = v;
    try { await saveStore(); toast(s.name + 'のテレビの画質を「' + qName(v) + '」にしました（1 分ほどで反映。レース中は終わってから）'); }
    finally { editStore = null; keepScroll(render); }
  }
  const isFs = () => !!(C && C.backend === 'firestore'); /* Firestore 版（本番）。模擬クラウドでは出さないもの用 */
  /* テレビ用アカウントを作る（Firestore 版だけ）: パスワードはこのブラウザの中で作り（crypto.getRandomValues）、Firebase に登録したら
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
      '<p class="hint" style="margin-bottom:0">保存すると約 30 秒で切り替わります。投票が始まると自動で casa DERBY になります。</p></div>' +
      /* テレビの画質。見えるのは 5 択のボタン、保存される値は下の select（#stvq） */
      '<div class="panel"><h3>テレビの画質 <small class="qsub">casa DERBY を映しているとき</small></h3>' +
      '<div class="seg big q3 q4 q5" id="stvqseg" role="group" aria-label="テレビの画質">' + QUALS.map(([v, nm]) => '<button type="button" data-act="sg-q" data-v="' + v + '" class="' + (x.tvQuality === v ? 'on' : '') + '" aria-pressed="' + (x.tvQuality === v) + '">' + nm + '</button>').join('') + '</div>' +
      '<select id="stvq" class="vh" aria-hidden="true" tabindex="-1">' + QUALS.map(([v, nm]) => '<option value="' + v + '"' + (x.tvQuality === v ? ' selected' : '') + '>' + nm + '</option>').join('') + '</select>' +
      stripBox(s.id || 'new', s.name || '新しい店舗', x.tvStrip, x.tvQuality === 'min' ? 'edit' : 'edit-hidden') +
      '<ul class="qnotes">' + QUALS.map(([, nm, note]) => '<li><b>' + nm + '</b>' + note + '</li>').join('') + '</ul>' +
      '<p class="hint" style="margin-bottom:0">保存すると 1 分ほどでテレビに反映されます（レース中は終わってから）。</p></div>' +
      '<div class="panel"><h3>名前と暗証番号</h3>' +
      '<div class="grid2"><label class="f"><span>店舗名</span><input type="text" id="sname" value="' + esc(s.name) + '" maxlength="20"></label>' +
      (s.isNew ? '<label class="f"><span>店舗ID（英小文字・数字。あとから変えられません）</span><input type="text" id="sid" value="' + esc(s.id) + '" maxlength="20" placeholder="例: ikebukuro" autocapitalize="off"></label>' : '') +
      '<label class="f"><span>スタッフ画面の暗証番号（数字 4〜8 桁）</span><input type="text" id="spin" value="' + esc(s.pin) + '" inputmode="numeric" maxlength="8" autocomplete="off"></label></div>' +
      '</div>' +
      '<div class="panel"><h3>時間</h3>' +
      stepRow('結果を見せる時間', 'テレビに結果と当たった人を出しておく長さ', 'resultSec', x.resultSec, '秒', 10, 1800, 10) +
      '<p class="hint" style="margin-bottom:0">投票の時間は全店同じです（「調整」で変えます）。</p>' +
      '</div>' +
      '<div class="panel"><details class="fold" id="sother" style="border-top:0;margin:0"' + (other ? ' open' : '') + '><summary>テレビの画面・始め方・テスト <small>' + esc('テスト ' + (x.test ? 'ON' : 'OFF') + '・画面 ' + ['paddock', 'gate', 'replay'].filter((k) => x.scenes[k]).length + '/3・' + modeName(x.modeDefault) + (x.modes.length ? '＋時間帯 ' + x.modes.length : '')) + '</small></summary><div class="in">' +
      '<h4 class="sumh">テレビに出す画面</h4><p class="hint">長さを変えても走り出す時刻は変わりません。</p>' +
      scene('paddock', 'パドック', '投票中の馬の紹介') + scene('gate', 'ゲートイン', '走り出す前') + scene('replay', 'リプレイ', 'ゴールのあと') +
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
  // テレビのゲーム・画質の選択ボタンを select に合わせて塗り直す
  function paintStripEdit() { const box = main.querySelector('#stvqseg ~ .tvstrip'); if (!box) return; const o = {}; STRIPS.forEach(([k]) => { o[k] = !!($('sstrip-' + k) || {}).checked; }); const sm = box.querySelector('.sh small'); if (sm) sm.textContent = '最もなめらか のとき・いま ' + stripName(o); box.querySelectorAll('[data-act="sstrip-preset"]').forEach((b) => { const on = sameStrip(o, b.dataset.p === 'b' ? STRIP_B : STRIP_A); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
  function paintQSeg() { const sel = $('stvq'); if (!sel) return; { const sb = main.querySelector('#stvqseg ~ .tvstrip'); if (sb) sb.hidden = sel.value !== 'min'; } main.querySelectorAll('[data-act="sg-q"]').forEach((b) => { const on = b.dataset.v === sel.value; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
  function paintTvSeg() { const sel = $('stvgame'); if (!sel) return; main.querySelectorAll('[data-act="sg-tv"]').forEach((b) => { const on = b.dataset.v === sel.value; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
  // 画面の入力を editStore に読み込む（行の追加・削除で作り直す前と、保存の前）。「テレビ」の 1 タップの切り替え（quick）は画面に欄がないので読まない
  function captureStore() {
    const s = editStore, x = s.x;
    if (s.quick) return;
    if ($('sname')) s.name = $('sname').value;
    if ($('sid')) s.id = $('sid').value.trim();
    if ($('spin')) s.pin = $('spin').value.trim();
    if ($('n-resultSec')) x.resultSec = Number($('n-resultSec').value);
    ['paddock', 'gate', 'replay'].forEach((k) => { if ($('sc-' + k)) x.scenes[k] = $('sc-' + k).checked; if ($('n-ss-' + k)) x.sceneSec[k] = Number($('n-ss-' + k).value); });
    main.querySelectorAll('[data-mk]').forEach((tr) => { const m = x.modes.find((y) => y.k === tr.dataset.mk); if (!m) return; tr.querySelectorAll('[data-mf]').forEach((el) => { m[el.dataset.mf] = el.value; }); });
    if ($('smodedef')) x.modeDefault = $('smodedef').value;
    if ($('stest')) x.test = $('stest').checked;
    if ($('stvgame')) x.tvGame = $('stvgame').value === 'derby' ? 'derby' : 'slot';
    if ($('stvq')) x.tvQuality = qOf({ tvQuality: $('stvq').value });
    if ($('sstrip-crowd')) { const o = {}; STRIPS.forEach(([k]) => { o[k] = !!($('sstrip-' + k) || {}).checked; }); x.tvStrip = o; }
  }
  function validateStore() {
    if (!editStore) return [];
    if (editStore.quick) return /^\d{4,8}$/.test(editStore.pin) ? [] : ['暗証番号は数字 4〜8 桁にしてください'];
    if (!$('smsg')) return [];
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
    ['resultSec', 'ss-paddock', 'ss-gate', 'ss-replay'].forEach((k) => { if (!numOk(k)) errs.push('数字の範囲を確かめてください（赤い欄）'); });
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
    /* 「テレビ」の 1 タップの切り替え（quick）は、テレビのゲーム・画質だけを変える（ほかの設定は今のまま。初期値を書き足さない） */
    const settings = s.quick ? Object.assign({}, s.orig || {}, { tvGame: x.tvGame }) : Object.assign({}, s.orig || {}, {
      resultSec: x.resultSec,
      scenes: Object.assign({}, x.scenes), sceneSec: Object.assign({}, x.sceneSec),
      modes: x.modes.map((m) => ({ from: m.from, to: m.to, mode: m.mode })), modeDefault: x.modeDefault, test: x.test, tvGame: x.tvGame,
    });
    if (!s.quick) ['exchangeSec', 'voteSec', 'betSec'].forEach((k) => { delete settings[k]; }); // v4: 店ごとの参加受付・投票の秒数はなくした（投票の時間は全店同じ＝調整）
    if (x.tvQuality !== qOf(s.orig)) settings.tvQuality = x.tvQuality; // 変えたときだけ書く（前の値 'sharp' などはそのまま）
    if (x.tvStrip && !sameStrip(x.tvStrip, stripOf(s.orig))) settings.tvStrip = Object.assign({}, x.tvStrip); // 削るもの（2026-10-29）も変えたときだけ
    const one = { id: s.id, name: s.name.trim(), pin: s.pin, settings };
    // 店舗の保存は「一覧を丸ごと置き換え」なので、保存の直前にサーバーの最新を読み直して、この店舗だけ差し替える
    // （別のタブ・別の人が足した店舗や変えた設定を、古い画面の内容で消さない）
    await reloadCfg();
    { // テレビのゲーム・画質は、スタッフのスマホ・投票の始まり（自動で DERBY）など別の所からも変わる。この画面で変えていなければ、サーバーの今の値のまま
      const cur = !s.isNew && cfg.stores.find((y) => y.id === s.id), cs = (cur && cur.settings) || null, os = s.orig || {};
      const keep = (k) => { if (Object.prototype.hasOwnProperty.call(cs, k)) settings[k] = cs[k]; else delete settings[k]; };
      if (cs && x.tvGame === (os.tvGame === 'derby' ? 'derby' : 'slot')) keep('tvGame');
      if (cs && x.tvQuality === qOf(os)) keep('tvQuality');
      if (cs && x.tvStrip && sameStrip(x.tvStrip, stripOf(os))) keep('tvStrip');
    }
    if (s.isNew && cfg.stores.some((y) => y.id === s.id)) { toast('その店舗ID は、ほかの画面でもう作られています'); return; }
    if (!s.isNew && !cfg.stores.some((y) => y.id === s.id)) { toast('この店舗は、ほかの画面で削除されています'); editStore = null; return render(); }
    const list = cfg.stores.map((y) => (y.id === s.id ? one : { id: y.id, name: y.name, pin: y.pin, settings: y.settings }));
    if (s.isNew) list.push(one);
    await api('saveStores', list);
    await reloadCfg();
    const quick = s.quick;
    editStore = null; if (!quick) { toast('保存しました'); render(); }
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
     時刻表（v4: 時刻 ＝ レースが走り出す時刻・全店同じ・行ごとに当選額の目標）
     テンプレート（毎日・曜日・日付）× 行（走り出す時刻・当選額の目標）。
     サーバーの Rule は 1 つに payout が 1 つなので、保存のときに「同じ目標の行」ごとに Rule に分ける（tpl で元のテンプレートに戻す）。
     以前の「店舗だけ」「目標は店舗ごと」の予定は、そのまま残して「全店にそろえる」を出す（新しく作る予定は全店）。
     2026-10-26 オーナー: 行ごとに「投票できる店」のチェック（行の s: 店 id の配列。null ＝ 全店）。Rule は storeIds が 1 つなので、保存のときは
     「同じ目標 × 同じ店の組」ごとに Rule に分ける（決まりの id は t.id・t.id~1・…）。読むときは rule.storeIds を行ごとに写す。
     時刻は 05:00〜28:59 の文字の欄（25:00 ＝ 深夜 1 時。集計・受け取りはその日のぶん）。
     ====================================================================== */
  function ruleRows(r) {
    const out = [];
    const def = Number(r.payout) || 0, s = cleanStores(r.storeIds);
    if (Array.isArray(r.races)) r.races.forEach((x) => out.push({ t: x.time || x.at, p: x.payout == null ? def : x.payout, s }));
    else if (Array.isArray(r.times) && r.times.length) r.times.forEach((x) => (typeof x === 'string' ? out.push({ t: x, p: def, s }) : out.push({ t: x.time || x.at, p: x.payout == null ? def : x.payout, s })));
    else if (r.from && r.to && r.everyMin) { const f = toMin(r.from), t = toMin(r.to), e = Math.max(1, +r.everyMin); if (!isNaN(f) && !isNaN(t)) for (let m = f; m <= t; m += e) out.push({ t: fromMin(m), p: def, s }); }
    return out;
  }
  const sKey = (r) => (r.s ? r.s.join(',') : ''); // 行の店の組を文字に（Rule に分けるときの鍵。'' ＝ 全店）
  const copyS = (s) => (Array.isArray(s) ? s.slice() : null);
  const KINDS = ['daily', 'weekday', 'date', 'holiday']; // 予定の種類（2026-10-27: 祝日を足した。知らない種類は毎日として読む）
  // サーバーの Rule → 画面のテンプレート（保存済みの決まりから「この日の予定」を見るときにも使う）
  function tplsFromRules(rules) {
    const map = new Map(), tpls = [];
    rules.forEach((r) => {
      const key = r.tpl || (r.id ? String(r.id).split('~')[0] : nk()); // サーバーが tpl を残さなくても、id の「~」より前で元のテンプレートに戻せる
      let t = map.get(key);
      if (!t) {
        t = { k: nk(), id: key, name: r.name || '', enabled: r.enabled !== false, kind: KINDS.indexOf(r.kind) >= 0 ? r.kind : 'daily', weekdays: (r.weekdays || []).slice(), date: r.date || '', storeId: r.storeId || null, scope: r.scope || 'all', rows: [] };
        map.set(key, t); tpls.push(t);
      }
      ruleRows(r).forEach((x) => t.rows.push({ k: nk(), t: x.t, p: String(x.p), s: copyS(x.s) }));
    });
    tpls.forEach((t) => sortRows(t));
    return tpls;
  }
  function loadTT() {
    const tpls = tplsFromRules(cfg.rules);
    tt = { tpls };
    ttOrig = new Set(); tpls.forEach((t) => t.rows.forEach((r) => ttOrig.add(t.id + '|' + r.t)));
    ttDirty = false;
  }
  const sortRows = (t) => t.rows.sort((a, b) => { const x = toMin(a.t), y = toMin(b.t); return (isNaN(x) ? 1e9 : x) - (isNaN(y) ? 1e9 : y); });
  const tplName = (t) => t.name || (t.kind === 'daily' ? '毎日' : t.kind === 'holiday' ? '祝日' : t.kind === 'weekday' ? '曜日: ' + (t.weekdays.length ? t.weekdays.slice().sort().map((d) => WD[d]).join('') : 'まだ選んでいない') : '日付: ' + (t.date ? fmtDay(t.date) : 'まだ選んでいない'));
  const legacyTpl = (t) => !!t.storeId || t.scope === 'store'; // 以前の形（店舗だけ・目標は店舗ごと）
  // 閉じた札の 1 行: いつ・件数・時間帯・目標
  function tplSummary(t) {
    const kind = tplName(Object.assign({}, t, { name: '' })), ts = t.rows.map((r) => r.t).filter((x) => !isNaN(toMin(x))).sort(), ps = t.rows.map((r) => Number(r.p)).filter((p) => p > 0);
    const lo = ps.length ? Math.min.apply(null, ps) : 0, hi = ps.length ? Math.max.apply(null, ps) : 0;
    const lim = t.rows.filter((r) => Array.isArray(r.s)).length; // 店を限定している行（2026-10-26）
    return [t.name ? kind : '', t.kind === 'holiday' ? '祝日に使う（自動で判定）' : '', t.storeId ? storeName(t.storeId) + 'だけ' : '', t.rows.length + ' レース', ts.length ? ts[0] + '〜' + ts[ts.length - 1] : '', ps.length ? '目標 ' + (lo === hi ? ptT(lo) : fmtN(lo) + '〜' + ptT(hi)) : '', lim ? lim + ' レースは店を限定' : ''].filter(Boolean).join('・');
  }
  // 画面のテンプレート → サーバーの Rule。「同じ目標 × 同じ店の組」の行をひとつの Rule に（storeIds は配列か null＝全店）。並びは最初に出てきた組の順
  function templatesToRules(tpls) {
    const rules = [];
    tpls.forEach((t) => {
      const groups = new Map();
      t.rows.forEach((r) => { const key = Number(r.p) + '|' + sKey(r); if (!groups.has(key)) groups.set(key, { p: Number(r.p), s: copyS(r.s), times: [] }); groups.get(key).times.push(r.t); });
      const base = { tpl: t.id, name: t.name || '', enabled: t.enabled, kind: t.kind, weekdays: t.kind === 'weekday' ? t.weekdays.slice().sort() : [], date: t.kind === 'date' ? t.date : '', scope: t.storeId ? 'store' : t.scope === 'store' ? 'store' : 'all', storeId: t.storeId || null };
      let i = 0;
      groups.forEach((g) => { const times = g.times.slice().sort(); rules.push(Object.assign({ id: i ? t.id + '~' + i : t.id, times, payout: g.p, storeIds: g.s && g.s.length ? g.s : null, races: times.map((x) => ({ time: x, payout: g.p })) }, base)); i++; });
    });
    return rules;
  }
  // その日・その店に適用されるテンプレート（サーバーと同じ決まり: 日付 → 祝日 → 曜日 → 毎日。全店の決まりと店舗ごとの決まりは別々に判定）
  // 祝日は core.js の判定（2026-10-27）。core.js が無いときは祝日ではないとして進む（曜日 → 毎日）
  function dayTpls(tpls, d, group) {
    const mine = tpls.filter((t) => t.enabled && (t.storeId || null) === group);
    let pick = mine.filter((t) => t.kind === 'date' && t.date === d);
    if (!pick.length && isHoliday(d)) pick = mine.filter((t) => t.kind === 'holiday');
    if (!pick.length) pick = mine.filter((t) => t.kind === 'weekday' && t.weekdays.indexOf(wdOf(d)) >= 0);
    if (!pick.length) pick = mine.filter((t) => t.kind === 'daily');
    return pick;
  }
  const usesHoliday = (tpls, d) => dayTpls(tpls, d, null).some((t) => t.kind === 'holiday'); // その日は祝日の決まりを使うか（全店の決まりで見る）
  // その日・その店で実際に走るレース（storeId=null なら全店同時のレースだけ）
  // collide（配列）を渡すと、別のテンプレートどうしで同じ時刻になった組を入れる（サーバーは黙って下のテンプレートを使うので、画面ではエラーにする）
  function daySchedule(tpls, d, storeId, collide) {
    const out = [];
    [null].concat(storeId ? [storeId] : []).forEach((g) => {
      const byTime = new Map(); // 同じ時刻が重なったら後ろの決まりが勝つ
      dayTpls(tpls, d, g).forEach((t) => t.rows.forEach((r) => { const m = toMin(r.t); if (isNaN(m)) return; const old = byTime.get(m); if (old && old.tpl !== t && collide) collide.push([old, { t: r.t, tpl: t, row: r }]); byTime.set(m, { m, t: r.t, p: Number(r.p), s: r.s, tpl: t, row: r, group: g }); }));
      byTime.forEach((v) => out.push(v));
    });
    return out.sort((a, b) => a.m - b.m || (a.group ? 1 : -1));
  }
  /* レースとレースの間の目安（v2/core.js の minGapSec と同じ式）: 投票 ＋ ゲートイン ＋ 走り（約 60 秒）＋ ゴール後 ＋ 写真判定の余裕（2 回分） */
  function minGapSec() {
    const T = cfg.tuning, gate = T.scenes && T.scenes.gate === false ? 0 : Number(T.gateSec) || 0, photo = 2 * (Number(T.photoExtraSec) || 0);
    const vote = Number(T.voteSec) || 0, post = Number(T.postSec) || 0;
    return { sec: vote + gate + RUN_SEC + post + photo, vote, gate, post, photo };
  }
  function validateTT() {
    const rowErr = new Map(), rowWarn = new Map(), tplErr = new Map(), list = [];
    const addR = (m, r, msg) => { if (!m.has(r.k)) m.set(r.k, []); if (m.get(r.k).indexOf(msg) < 0) m.get(r.k).push(msg); };
    const addT = (t, msg) => { if (!tplErr.has(t.k)) tplErr.set(t.k, []); if (tplErr.get(t.k).indexOf(msg) < 0) tplErr.get(t.k).push(msg); };
    const pushList = (x) => { if (list.length < 200 && list.indexOf(x) < 0) list.push(x); };
    // 「今日」「いまの時刻」は営業日で見る（2026-10-26: 深夜 1 時は前の日の 25:00。日付の予定は 28:59 まで「今日」のまま）
    const today = bizToday(), nowM = bizMin(now());
    const storeIds = cfg.stores.map((s) => s.id);
    tt.tpls.forEach((t) => {
      if (t.kind === 'weekday' && !t.weekdays.length) addT(t, '曜日を選んでください');
      if (t.kind === 'date') { if (!isDate(t.date)) addT(t, '日付を入れてください'); else if (t.date < today) addT(t, '過去の日付です'); }
      if (t.storeId && storeIds.indexOf(t.storeId) < 0) addT(t, '店舗がありません（削除された店舗）。「全店にそろえる」を押してください');
      const seen = new Map();
      t.rows.forEach((r) => {
        const m = toMin(r.t);
        if (isNaN(m)) addR(rowErr, r, '時刻を入れてください');
        else if (!timeOk(m)) addR(rowErr, r, TIME_MSG);
        else { if (seen.has(m)) { addR(rowErr, r, '同じ時刻が 2 つあります'); addR(rowErr, seen.get(m), '同じ時刻が 2 つあります'); } else seen.set(m, r); }
        const p = String(r.p).trim();
        if (!/^\d+$/.test(p) || +p < 1 || +p > PAY_MAX) addR(rowErr, r, '当選額の目標は 1〜' + ptT(PAY_MAX) + ' の整数（100 単位に丸めて保存）');
        if (Array.isArray(r.s) && !r.s.filter((id) => storeIds.indexOf(id) >= 0).length) addR(rowErr, r, '店を 1 つは選んでください'); // 店のチェックが全部外れている（2026-10-26）
        if (t.kind === 'date' && t.date === today && !isNaN(m) && m <= nowM && !ttOrig.has(t.id + '|' + r.t)) addR(rowErr, r, 'もう過ぎた時刻です');
      });
    });
    // 近すぎるレース（最短間隔より近い）: 今日から 14 日分と、日付テンプレートの日で、店ごとに確かめる
    const gap = minGapSec().sec;
    const days = new Set(); for (let i = 0; i < 14; i++) days.add(addDays(today, i));
    tt.tpls.forEach((t) => { if (t.kind === 'date' && isDate(t.date) && t.date >= today) days.add(t.date); });
    const groups = storeIds.length ? storeIds : [null];
    const prev = {}; // 店ごとの「前の日の最後のレース」（深夜 28:30 と次の日の 05:00 のように、日をまたいで近すぎるのも見る。2026-10-26）
    Array.from(days).sort().forEach((d) => groups.forEach((sid) => {
      const col = [], sc = daySchedule(tt.tpls, d, sid, col);
      col.forEach((c) => { const msg = c[0].t + ' が「' + tplName(c[0].tpl) + '」と「' + tplName(c[1].tpl) + '」で同じ時刻です（下の予定だけが使われます）'; addR(rowErr, c[0].row, msg); addR(rowErr, c[1].row, msg); pushList(fmtDay(d) + ' ' + (c[0].row && (c[0].tpl.storeId || c[1].tpl.storeId) ? storeName(sid) : '全店') + ': ' + msg); });
      const near = (a, b, diff) => {
        const where = (a.tpl === b.tpl ? '' : '（「' + tplName(a.tpl) + '」と「' + tplName(b.tpl) + '」）');
        const msg = diff === 0 ? a.t + ' に 2 つのレースが重なっています' + where : a.t + ' と ' + b.t + ' が近すぎます（' + secTxt(gap) + ' 以上あける）' + where;
        addR(rowErr, a.row, a.tpl === b.tpl ? (diff === 0 ? '重なっています' : '次のレースと近すぎます') : msg);
        addR(rowErr, b.row, a.tpl === b.tpl ? (diff === 0 ? '重なっています' : '前のレースと近すぎます') : msg);
        pushList(fmtDay(d) + ' ' + (a.group || b.group ? storeName(sid) : '全店') + ': ' + msg);
      };
      const pk = sid || '', pv = prev[pk];
      if (pv && sc.length && addDays(pv.d, 1) === d && timeOk(pv.last.m) && timeOk(sc[0].m)) { const diff = (sc[0].m + 1440 - pv.last.m) * 60; if (diff < gap) near(pv.last, sc[0], diff); } // 範囲の外の時刻（01:00 など）は別のエラーが出るので、ここでは見ない
      for (let i = 1; i < sc.length; i++) { const a = sc[i - 1], b = sc[i], diff = (b.m - a.m) * 60; if (diff < gap) near(a, b, diff); }
      if (sc.length) prev[pk] = { d, last: sc[sc.length - 1] };
    }));
    tt.tpls.forEach((t) => { if (!t.rows.length) addT(t, 'レースを 1 つ以上入れてください（使わない予定は × で消せます）'); });
    let n = 0; rowErr.forEach((v) => { n += v.length ? 1 : 0; }); tplErr.forEach((v) => { n += v.filter(Boolean).length; });
    return { rowErr, rowWarn, tplErr, list, n };
  }
  /* 行の「投票できる店」のチェック（2026-10-26）: 店ごとに小さな札（押すと ON/OFF）＋「全店」（押すと全部 ON）。全部 ON ＝ 全店（r.s = null） */
  function rowChips(r) {
    const all = !Array.isArray(r.s);
    return '<div class="stchips" role="group" aria-label="投票できる店">' +
      '<button type="button" class="stchip all' + (all ? ' on' : '') + '" data-act="row-all" aria-pressed="' + all + '" title="全部の店で投票できる">全店</button>' +
      cfg.stores.map((s) => { const on = all || r.s.indexOf(s.id) >= 0; return '<label class="stchip' + (on ? ' on' : '') + '"><input type="checkbox" data-rs="' + esc(s.id) + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(s.name) + 'で投票できる">' + esc(s.name) + '</label>'; }).join('') + '</div>';
  }
  function paintRowChips(tr, r) {
    const all = !Array.isArray(r.s), ab = tr.querySelector('[data-act="row-all"]');
    if (ab) { ab.classList.toggle('on', all); ab.setAttribute('aria-pressed', String(all)); }
    tr.querySelectorAll('input[data-rs]').forEach((c) => { const on = all || r.s.indexOf(c.dataset.rs) >= 0; c.checked = on; c.parentNode.classList.toggle('on', on); });
  }
  function viewTT() {
    const g = minGapSec(), voteMin = secTxt(g.vote);
    const tplHtml = (t, i) => {
      const cond = t.kind === 'weekday' ? '<div class="wdays">' + [1, 2, 3, 4, 5, 6, 0].map((d) => '<label class="' + (t.weekdays.indexOf(d) >= 0 ? 'on' : '') + '"><input type="checkbox" data-wd="' + d + '"' + (t.weekdays.indexOf(d) >= 0 ? ' checked' : '') + '>' + WD[d] + '</label>').join('') + '</div>'
        : t.kind === 'date' ? '<input type="date" data-tf="date" value="' + esc(t.date) + '">'
        : t.kind === 'holiday' ? '<div class="hint holnote" style="margin:0;padding-top:18px">祝日は自動で判定します（振替休日・国民の休日を含む）</div>' /* 2026-10-27: 祝日は曜日・日付を選ばない */
        : '<div class="hint" style="margin:0;padding-top:18px">祝日・曜日・日付の予定がない日に使います</div>';
      const open = tplOpen.has(t.id);
      return '<div class="tpl' + (t.enabled ? '' : ' off') + (open ? ' open' : '') + '" data-tk="' + t.k + '">' +
        /* 閉じた札: 名前・いつ・件数・時間帯・目標・要確認。押すと開く */
        '<div class="tpl-top"><button type="button" class="open-btn" data-act="tpl-open" aria-expanded="' + open + '"><b data-tname>' + esc(tplName(t)) + '</b><span class="sum" data-sum>' + esc(tplSummary(t)) + '</span><span class="chip ng" data-terrn hidden></span><span class="ol"></span></button>' +
        '<button type="button" class="btn xs onoff' + (t.enabled ? ' on' : '') + '" data-act="tpl-on" title="押すと切り替え">' + (t.enabled ? 'ON 使用中' : 'OFF 停止中') + '</button></div>' +
        '<div class="tpl-body">' +
        '<div class="tpl-head"><input type="text" class="name" data-tf="name" value="' + esc(t.name) + '" placeholder="' + esc(tplName(Object.assign({}, t, { name: '' }))) + '" maxlength="30" aria-label="予定の名前">' +
        '<span class="chip info" data-cnt>' + t.rows.length + ' レース</span>' +
        '<button type="button" class="icon" data-act="tpl-up" aria-label="上へ"' + (i ? '' : ' disabled') + '>↑</button><button type="button" class="icon" data-act="tpl-down" aria-label="下へ"' + (i < tt.tpls.length - 1 ? '' : ' disabled') + '>↓</button>' +
        '<button type="button" class="btn xs ghost" data-act="tpl-dup">コピー</button><button type="button" class="icon del" data-act="tpl-del" aria-label="この予定を消す">×</button></div>' +
        (legacyTpl(t) ? '<div class="legacy"><span>以前の形の予定です（' + esc(t.storeId ? storeName(t.storeId) + 'だけ' : '当選額の目標が店舗ごと') + '）。v4 の時刻表は全店同じです。</span><button type="button" class="btn xs ghost" data-act="tpl-allstores">全店にそろえる</button></div>' : '') +
        '<div class="tpl-cond v4"><label class="f"><span>いつ</span><select data-tf="kind"><option value="daily"' + (t.kind === 'daily' ? ' selected' : '') + '>毎日</option><option value="weekday"' + (t.kind === 'weekday' ? ' selected' : '') + '>曜日を選ぶ</option><option value="date"' + (t.kind === 'date' ? ' selected' : '') + '>日付を選ぶ</option><option value="holiday"' + (t.kind === 'holiday' ? ' selected' : '') + '>祝日</option></select></label>' +
        '<div class="f">' + (t.kind === 'weekday' || t.kind === 'date' ? '<span class="hint" style="display:block;margin:0 0 4px">' + (t.kind === 'weekday' ? '曜日' : '日付') + '</span>' : '') + cond + '</div></div>' +
        '<div class="err" data-terr></div>' +
        '<div class="bulk"><b class="bt">まとめて作る</b>' +
        '<label class="f"><span>開始</span>' + timeInput('data-bf="from"', '19:00') + '</label><span class="t">〜</span>' +
        '<label class="f"><span>終了</span>' + timeInput('data-bf="to"', '23:00') + '</label>' +
        '<label class="f"><span>何分おき</span><input type="number" data-bf="every" value="10" min="1" max="180"></label>' +
        '<label class="f"><span>当選額の目標（pt）</span><input type="number" data-bf="pay" value="3000" min="1" max="' + PAY_MAX + '" step="100"></label>' +
        '<button type="button" class="btn sm ghost" data-act="bulk">まとめて作る</button></div>' +
        (t.rows.length > ROWS_SHOWN ? '<div class="acts l rowsbar"><label class="find"><span>時刻で探す</span>' + timeInput('data-find aria-label="この時刻のレースへ移る"', '') + '</label><small class="hint" style="margin:0">' + t.rows.length + ' レースのうち、入れた時刻の行へ移ります</small></div>' : '') +
        '<div class="tbl"><table class="tt-rows"><tr class="hd"><th class="no">#</th><th class="th-t">走り出す時刻</th><th class="th-p">当選額の目標（pt）</th><th class="th-s">投票できる店</th><th></th><th></th></tr>' +
        (t.rows.length ? t.rows.map((r, j) => '<tr data-rk="' + r.k + '"' + (j >= ROWS_SHOWN && !tplAll.has(t.id) ? ' class="more"' : '') + '><td class="no">' + (j + 1) + '</td><td class="tdt">' + timeInput('data-rf="t" aria-label="走り出す時刻"', r.t) + '</td>' +
          '<td class="tdp"><input type="number" class="pay" data-rf="p" value="' + esc(r.p) + '" min="1" max="' + PAY_MAX + '" step="1" inputmode="numeric" aria-label="当選額の目標"></td><td class="st">' + rowChips(r) + '</td><td class="msg"></td>' +
          '<td class="ops"><button type="button" class="icon" data-act="row-dup" aria-label="この行をコピー" title="この行をコピー（次の時刻に）">⧉</button><button type="button" class="icon del" data-act="row-del" aria-label="この行を消す" title="この行を消す">×</button></td></tr>').join('')
          : '<tr><td colspan="6" class="empty">まだレースがありません。上の「まとめて作る」で入れてください</td></tr>') +
        '</table></div>' +
        (t.rows.length > ROWS_SHOWN ? '<div class="acts l rowsbar" style="margin-top:6px"><button type="button" class="btn sm ghost" data-act="tpl-rows" data-rowsbtn>' + (tplAll.has(t.id) ? '最初の ' + ROWS_SHOWN + ' 件だけ表示' : '残り ' + (t.rows.length - ROWS_SHOWN) + ' 件を表示（' + t.rows[ROWS_SHOWN].t + '〜）') + '</button></div>' : '') +
        '<div class="acts l" style="margin-top:6px"><button type="button" class="btn sm ghost" data-act="row-add">＋ 1 行追加</button><button type="button" class="btn xs ghost" data-act="row-sort">時刻順に並べる</button><button type="button" class="btn xs ghost" data-act="row-payall">目標を全部そろえる</button><button type="button" class="btn xs ghost" data-act="row-clear"' + (t.rows.length ? '' : ' disabled') + '>全部消す</button></div>' +
        '</div></div>';
    };
    const side = '<div class="side"><div class="panel"><h3>この日の予定</h3>' +
      '<label class="f"><span>日付</span><input type="date" id="pvdate" value="' + esc(pvDate || todayStr()) + '"></label><span class="pvhol" id="pvhol"></span>' + /* 祝日なら「祝日・文化の日」の札（paintPreview で入れる。2026-10-27） */
      '<div class="seg pvseg"><button type="button" class="' + (pvSrc === 'local' ? 'on' : '') + '" aria-pressed="' + (pvSrc === 'local') + '" data-act="pv-local">変更後</button><button type="button" class="' + (pvSrc === 'server' ? 'on' : '') + '" aria-pressed="' + (pvSrc === 'server') + '" data-act="pv-server">保存済み</button></div>' +
      '<div id="pvbox"></div></div></div>';
    return '<div class="panel"><h3>時刻表を変える</h3>' +
      '<p class="hint">時刻は<b>レースが走り出す時刻</b>（投票はその ' + voteMin + '前から）。<b>全店同じ</b>時刻表です（レースごとに「投票できる店」をしぼれます）。レースとレースの間は <b>' + secTxt(g.sec) + ' 以上</b>あけてください。</p>' +
      '<p class="hint nightnote" style="margin-bottom:0">深夜は <b>24:00〜28:59</b> と書きます（25:00 ＝ 深夜 1 時。集計・受け取りはその日のぶんに入ります）。</p>' +
      '<details class="fold"><summary>くわしく</summary><div class="in">' +
      '<p class="hint">時刻は 05:00〜28:59。数字だけ打っても整えます（「1900」→ 19:00・「25」→ 25:00）。00:00〜04:59 は受け付けません（深夜は 24:00〜28:59 で）。</p>' +
      '<p class="hint">「投票できる店」のチェックを外した店では、そのレースに投票できません（テレビには見るだけで映ります）。全部 ON ＝ 全店。1 つは残してください。</p>' +
      '<p class="hint">' + voteExample(g.vote) + ' 21:00 に締め切って走り出します。</p>' +
      '<p class="hint">最短間隔 ' + secTxt(g.sec) + ' ＝ 投票 ' + g.vote + ' 秒＋ゲートイン ' + g.gate + ' 秒＋レース約 ' + RUN_SEC + ' 秒＋ゴール後 ' + g.post + ' 秒＋写真判定の余裕 ' + g.photo + ' 秒。投票の時間は「調整」で変えます。</p>' +
      '<p class="hint">当選額の目標＝そのレースで当たった人に渡す額の合計の目安（当たった人数 × 100pt × 倍率）。100 単位に丸めて保存します。勝ち馬はこの目標に近づくように決まります（「調整」の「勝ち馬の決まり方」）。</p>' +
      '<p class="hint">その日に<b>日付の予定があればそれだけ → なければ祝日 → なければ曜日 → なければ毎日</b>を使います。祝日は自動で判定します（振替休日・国民の休日を含む）。同じ時刻は下の予定が使われます。</p>' +
      '<p class="hint">近すぎる・重なる・過去の時刻・おかしな値があると保存できません。保存すると、まだ作られていないこれからのレースに反映されます。</p>' +
      '</div></details></div>' +
      '<div class="tt-layout"><div>' + (tt.tpls.length ? tt.tpls.map(tplHtml).join('') : '<div class="panel"><div class="empty">まだ予定がありません。下のボタンで作ってください。</div></div>') +
      '<div class="acts l"><button type="button" class="btn ghost" data-act="tpl-add" data-kind="daily">＋ 毎日の予定</button><button type="button" class="btn ghost" data-act="tpl-add" data-kind="weekday">＋ 曜日の予定</button><button type="button" class="btn ghost" data-act="tpl-add" data-kind="date">＋ 日付の予定</button><button type="button" class="btn ghost" data-act="tpl-add" data-kind="holiday">＋ 祝日の予定</button></div>' +
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
        tr.querySelector('[data-rf="t"]').classList.toggle('bad', es.length > 0 && (isNaN(m) || es.some((x) => !/当選額の目標|店を 1 つは/.test(x))));
        tr.querySelector('[data-rf="p"]').classList.toggle('bad', !/^\d+$/.test(p) || +p < 1 || +p > PAY_MAX);
        { const sc = tr.querySelector('.stchips'); if (sc) sc.classList.toggle('bad', es.some((x) => /店を 1 つは/.test(x))); }
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
  // この日の予定（右の枠）: 走り出す時刻・投票の始まり・目標
  function paintPreview() {
    const box = $('pvbox'); if (!box) return;
    const d = pvDate || todayStr(), vs = (Number(cfg.tuning.voteSec) || 0) + (Number(cfg.tuning.closeLeadSec) || 0);
    /* 祝日（2026-10-27）: 日付の横に「祝日・文化の日」の金の札。名前はサーバーの答え（preview の holiday）か core.js。
       「変更後」はいま編集中の予定で、「保存済み」は保存済みの決まりで、その日に祝日の決まりを使うかを見て「祝日の決まりを使っています」 */
    let hol = holidayName(d), usedHol = false;
    if (pvSrc === 'server') { if (pvServer && !pvServer.err) { if (pvServer.holiday) hol = pvServer.holiday; usedHol = !!(hol || isHoliday(d)) && usesHoliday(tplsFromRules(cfg.rules), d); } }
    else if (isDate(d) && tt) usedHol = usesHoliday(tt.tpls, d);
    { const h = $('pvhol'); if (h) h.innerHTML = hol ? '<span class="chip holiday">祝日・' + esc(hol) + '</span>' : ''; }
    const holHint = usedHol ? '<p class="hint holhint">祝日の決まりを使っています</p>' : '';
    let items;
    if (pvSrc === 'server') {
      if (!pvServer) { box.innerHTML = '<div class="empty">読み込み中…</div>'; return; }
      if (pvServer.err) { box.innerHTML = '<div class="err">' + esc(pvServer.err) + '</div>'; return; }
      // サーバーの予定: time は「25:00」の形で届く（core.js の expandDate）。無ければ at から営業日の時計で出す。storeIds ＝ 投票できる店（null ＝ 全店）
      items = pvServer.races.map((r) => ({ t: r.time || bizHM(r.at), p: r.payout, store: r.storeId, s: r.storeIds, open: r.openAt != null ? bizHM(r.openAt) : r.at ? bizHM(r.at - vs * 1000) : '' }));
    } else {
      if (!isDate(d)) { box.innerHTML = '<div class="empty">日付を入れてください</div>'; return; }
      items = daySchedule(tt.tpls, d, null).map((x) => ({ t: x.t, p: x.p, store: x.group, s: x.s, name: tplName(x.tpl), open: fromMin(x.m - Math.ceil(vs / 60)) }));
    }
    const isToday = d === bizToday(), nm = bizMin(now()); // 営業日で見る（25:00 は「今日」の深夜）
    const total = items.reduce((a, x) => a + (Number(x.p) || 0), 0);
    const anyLim = items.some((x) => Array.isArray(x.s) && x.s.length); // 店を限定したレースがあるときだけ、時刻の下に店の札（全店／渋谷・札幌）。右の枠は細いので列は増やさない
    box.innerHTML = holHint + '<div class="summary" style="grid-template-columns:1fr 1fr"><div class="stat"><small>レース数</small><b>' + items.length + '</b></div><div class="stat"><small>当選額の目標の合計</small><b>' + ptN(total) + '</b></div></div>' +
      (items.length ? '<div class="pv-list"><table><tr><th>走り出す</th><th>投票</th><th class="n">目標</th><th>予定</th></tr>' + items.map((x) => '<tr class="' + (isToday && toMin(x.t) < nm ? 'past' : '') + '"><td class="pvt"><b>' + esc(x.t) + '</b>' + (x.store ? '<small class="hint"> ' + esc(storeName(x.store)) + 'だけ</small>' : '') + (anyLim ? '<span class="pvst">' + storesChip(x.s) + '</span>' : '') + '</td><td><small class="hint">' + esc(x.open || '') + '〜</small></td><td class="n">' + ptN(x.p) + '</td><td class="pvname"><small class="hint" title="' + esc(x.name || '') + '">' + esc(x.name || '') + '</small></td></tr>').join('') + '</table></div>'
        : '<div class="empty">この日はレースがありません</div>');
  }
  async function loadServerPreview() {
    pvServer = null; paintPreview();
    try { const r = await api('preview', pvDate || todayStr()); pvServer = { races: ((r && r.races) || []).filter((x) => !x.storeId), holiday: (r && r.holiday) || null }; } // holiday: 祝日の名前か null（2026-10-27）
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
    ['from', 'to'].forEach((f) => { q(f).value = normTime(q(f).value); }); // 「1900」→「19:00」
    const f = toMin(q('from').value), to = toMin(q('to').value), ev = Number(q('every').value), p = String(q('pay').value).trim();
    const bad = [];
    if (isNaN(f) || isNaN(to)) bad.push('開始と終了の時刻を入れてください'); else if (!timeOk(f) || !timeOk(to)) bad.push(TIME_MSG); else if (to < f) bad.push('終了は開始より後にしてください（深夜は 24:00〜28:59 と書きます）');
    if (!(ev >= 1 && ev <= 180 && Math.floor(ev) === ev)) bad.push('何分おきは 1〜180 の整数');
    if (!/^\d+$/.test(p) || +p < 1 || +p > PAY_MAX) bad.push('当選額の目標は 1〜' + ptT(PAY_MAX) + ' の整数');
    if (bad.length) { toast(bad[0]); return; }
    const have = new Set(t.rows.map((r) => toMin(r.t)));
    let add = 0, skip = 0;
    for (let m = f; m <= to; m += ev) { if (have.has(m)) { skip++; continue; } t.rows.push({ k: nk(), t: fromMin(m), p, s: null }); add++; } // 新しい行は全店
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
     今日のレース（v4: 参加＝票の数・当選額と目標・勝ち（1着→2着 倍率）・テストレースの印）
     ====================================================================== */
  async function loadRaces(quiet) {
    const sig = () => JSON.stringify([racesData, racesErr, (racesData || []).map((r) => statusOf(r) + (r.endAt && r.endAt < now() ? 'p' : ''))]), before = sig();
    // 読んでいる間に日付を変えたら、古い日付の答えで上書きしない
    const d = raceDate, my = (loadRaces.seq = (loadRaces.seq || 0) + 1);
    if (d === bizToday()) loadHealth(); // 進行役のテレビが止まっていないか（2026-10-28。10 秒ごとの読み直しと一緒に）
    try { const r = await api('races', d); if (my !== loadRaces.seq || d !== raceDate) return; racesData = (r && r.races) || []; racesErr = ''; }
    catch (e) { if (my !== loadRaces.seq || d !== raceDate) return; racesErr = errText(e); if (!quiet) racesData = []; }
    if (quiet && sig() === before) return; // 10 秒ごとの読み直しで何も変わっていなければ描き直さない（日付の入力・ボタンを押している途中を消さない）
    if (tab === 'races') keepScroll(() => { main.innerHTML = viewRaces(); });
  }
  // 管理用の一覧は店舗を指定しないので、投票中かどうかは時刻で判定する（openAt〜closeAt）
  const statusOf = (r) => { if (r.refunded || r.status === 'void') return 'void'; const t = now(); if ((r.status === 'upcoming' || r.status === 'open') && r.openAt <= t && t < r.closeAt) return 'vote'; if ((r.status === 'upcoming' || r.status === 'open') && t >= r.closeAt) return 'closed'; /* 締切の時刻を過ぎて、サーバーが締めるまでの数秒 */ return r.status === 'open' ? 'vote' : r.status; };
  const votesOf = (r) => Number(r.votes != null ? r.votes : r.participants && r.participants.total) || 0;
  const finished = (r) => !r.refunded && (r.status === 'decided' || r.status === 'done');
  /* 勝ち馬の決まり方（decision.reason。v2/outcome.js）を 1 行で */
  const REASONS = { band: '目標の幅に入る組み合わせから抽選', target: '幅に入る組み合わせがなく、目標にいちばん近い組み合わせ（必ず誰かは当てる）', cap_nowin: '上限を超えるので当たりなし（票のない組み合わせ）', cap_conflict: '全部の組み合わせが上限超え。いちばん少ない組み合わせ', nobody: '投票なし（自然の結果）' };
  function reasonTxt(r) {
    const d = r.decision; if (!d || !d.reason) return '';
    const n = d.band && Array.isArray(d.band.combos) ? d.band.combos.length : 0;
    const t = (REASONS[d.reason] || d.reason) + (d.reason === 'band' && n ? '（候補 ' + n + ' 組）' : '') + (d.target ? '・目標 ' + ptT(d.target) : '') + (d.target && d.targetEff != null && d.targetEff !== d.target ? '・このレースは ' + ptT(d.targetEff) + ' に寄せる（ぶれ ×' + (Number(d.spreadF) || 1).toFixed(2) + '）' : '') + /* 配当のぶれ（2026-10-29） */ (d.reason !== 'nobody' ? '・当選額 ' + ptT(d.paid != null ? d.paid : d.payout) : '') + (d.cap ? '・上限 ' + ptT(d.cap) : '');
    return '<small class="hint memo-reason" style="display:block;margin:0">' + nwJoin(t, '・') + '</small>';
  }
  // 区切り（・や /）ごとのかたまりを途中で折り返さない（「看/板の絵柄」のような切れ方をなくす。文字はそのまま）
  const nwJoin = (t, sep) => { const p = t.split(sep), tail = sep.replace(/\s+$/, ''), gap = sep.length > tail.length ? ' ' : '<wbr>'; return p.map((x, i) => '<span class="nw">' + esc(x + (i < p.length - 1 ? tail : '')) + '</span>').join(gap); }; // 区切りは前のかたまりの終わりに付ける（行の頭に「・」「/」が来ない）
  const leftTxt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 60 ? Math.floor(s / 60) + '分' + pad(s % 60) + '秒' : s + '秒'; };
  function nowCard(list, isToday) {
    if (!isToday) return '';
    const t = now(), cur = list.find((r) => statusOf(r) === 'vote'), next = list.find((r) => r.status === 'upcoming' && r.openAt > t && r !== cur);
    const live = list.find((r) => !r.refunded && (r.status === 'closed' || r.status === 'decided'));
    // 時刻は営業日の時計（深夜 1 時 → 25:00）。店を限定したレースは店名の札（2026-10-26）
    const tag = (r) => (r.test ? ' <span class="chip test">テスト</span>' : '') + (Array.isArray(r.storeIds) && r.storeIds.length ? ' ' + storesChip(r.storeIds) : '');
    if (cur) {
      return '<div class="nowcard"><div class="big"><b class="mono">' + bizHM(cur.at) + '</b> <span class="status st-open">投票中</span>' + tag(cur) + '</div>' +
        '<div class="sub">締切まで <b data-until="' + cur.closeAt + '">' + leftTxt(cur.closeAt - t) + '</b>・参加 <b>' + fmtN(votesOf(cur)) + '人</b>' + (next ? '・次は ' + bizHM(next.at) : '') + '</div></div>';
    }
    if (live) return '<div class="nowcard"><div class="big"><b class="mono">' + bizHM(live.at) + '</b> <span class="status st-decided">レース中</span>' + tag(live) + '</div><div class="sub">参加 ' + fmtN(votesOf(live)) + '人' + (next ? '・次は ' + bizHM(next.at) : '') + '</div></div>';
    if (next) return '<div class="nowcard"><div class="big">次のレース <b class="mono">' + bizHM(next.at) + '</b>' + tag(next) + '</div><div class="sub">投票は ' + bizHM(next.openAt) + ' から（あと <b data-until="' + next.openAt + '">' + leftTxt(next.openAt - t) + '</b>）</div></div>';
    return '<div class="nowcard"><div class="big">今日のレースは終わりました</div></div>';
  }
  // 今日のいちばん上: 店のテレビの今のゲーム（切り替えは「テレビ」タブ）
  function tvStrip() {
    if (!cfg.stores.length) return '';
    return '<div class="tvstrip" id="tvStrip"><span class="lb">テレビ</span>' + cfg.stores.map((s) => { const g = sset(s).tvGame; return '<span class="chip' + (g === 'derby' ? ' on' : '') + '">' + esc(s.name) + ' ' + (g === 'derby' ? 'DERBY' : 'SLOT') + '</span>'; }).join('') +
      '<button type="button" class="btn xs ghost" data-act="go-tv">切り替え ›</button></div>';
  }
  // 勝ち（1着→2着 倍率）と当たった人数
  function resultHtml(r) {
    const res = r.result; if (!res || res.winner == null) return '';
    const odds = res.comboOdds != null ? res.comboOdds : res.finalExacta && res.combo ? res.finalExacta[res.combo] : null;
    const ws = (r.winners || []).filter((w) => r.test || !w.test), n = ws.length;
    return '<b class="combo">' + noOf(r, res.winner) + '番 → ' + noOf(r, res.second) + '番</b> <span class="hint">' + per1(odds) + '</span>' +
      (r.refunded ? ' <small class="hint">取り消し（受け取りなし）</small>' : r.status === 'done' || r.status === 'decided' ? ' <small class="hint">' + (n ? '当たり ' + n + '人' : '当たりなし') + '</small>' : '');
  }
  function viewRaces() {
    const list = racesData || [];
    const real = list.filter((r) => !r.test && !r.refunded);
    const sum = real.reduce((a, r) => { if (finished(r)) { a.paid += Number(r.paidTotal) || 0; a.target += Number(r.payoutTarget) || 0; a.unpaid += Number(r.unpaidTotal) || 0; a.done++; } a.votes += votesOf(r); return a; }, { paid: 0, target: 0, unpaid: 0, done: 0, votes: 0 });
    const isToday = raceDate === bizToday();
    /* これから（投票中を含む。近い順に 3 件）と、終わったレース（新しい順）。取り消したレースはいつも見せる */
    const coming = list.filter((r) => r.status === 'upcoming' && !r.refunded), done = list.filter((r) => r.status !== 'upcoming' || r.refunded).reverse();
    const shownDone = raceAll ? done : done.filter((r, i) => i < 5 || r.refunded || r.id === refundOpen);
    const hidden = done.length - shownDone.length + Math.max(0, coming.length - 3);
    const rows = coming.slice(0, raceAll ? coming.length : 3).concat(shownDone);
    /* 1 行（PC は表、スマホはカード。td の data-l がカードの見出し）。勝ち馬の決まり方・演出は「勝ち馬の決まり方を見る」のときだけ */
    const td = (l, html, cls) => '<td' + (cls ? ' class="' + cls + '"' : '') + (l ? ' data-l="' + l + '"' : '') + '>' + html + '</td>';
    const row = (r) => {
      const stK = statusOf(r), st = STATUS[stK] || [r.status, 'st-upcoming'];
      const canRefund = ['closed', 'decided', 'done'].indexOf(r.status) >= 0 && !r.refunded;
      const open = refundOpen === r.id && canRefund, before = r.status === 'upcoming' && stK === 'upcoming';
      const money = r.test ? '<small class="hint">テスト（払わない）</small>' : finished(r) ? ptN(r.paidTotal) + '<span class="hint tg"> / ' + ptN(r.payoutTarget) + '</span>' : '<span class="hint">目標 </span>' + ptN(r.payoutTarget);
      return '<tr class="' + (stK === 'vote' ? 'now' : r.status === 'upcoming' ? '' : 'past') + (r.refunded ? ' voided' : '') + (r.test ? ' testrace' : '') + (open ? ' rfopen' : '') + '" data-race="' + esc(r.id) + '">' +
        /* 時刻は営業日の時計（25:00）。店の札: 「全店」か「上野・札幌」（以前の形の storeId の「だけ」はそのまま） */
        td('', '<b class="mono" style="font-size:15px">' + bizHM(r.at) + '</b>' + (r.test ? ' <span class="chip test">テスト</span>' : '') + (r.storeId ? '<small class="hint"> ' + esc(storeName(r.storeId)) + 'だけ</small>' : ' ' + storesChip(r.storeIds)) + (before ? '<small class="hint vfrom"> 投票 ' + bizHM(r.openAt) + '〜</small>' : ''), 'head') +
        td('', '<span class="status ' + st[1] + '">' + st[0] + '</span>') +
        td(before && !votesOf(r) ? '' : '参加', before && !votesOf(r) ? '' : fmtN(votesOf(r)) + '人', 'n') +
        td(finished(r) && !r.test ? '当選額 / 目標' : '', money, 'n') +
        td(r.result ? '結果' : '', resultHtml(r) + (memoOn ? reasonTxt(r) + cueTxt(r) : ''), 'full') +
        td('', canRefund && !open ? '<button class="btn xs ghost" data-act="race-refund" data-id="' + esc(r.id) + '" aria-expanded="false">レース取消</button>' : '', 'right') + '</tr>' +
        (open ? '<tr class="rfrow"><td colspan="6">' + refundBox(r) + '</td></tr>' : '');
    };
    /* 祝日（2026-10-27）: 見出しの日付の横に「祝日・文化の日」の金の札。保存済みの決まりでその日に祝日の予定を使うなら一文 */
    const holUsed = isHoliday(raceDate) && usesHoliday(tplsFromRules(cfg.rules), raceDate);
    return '<div class="panel" id="racePanel"><h3>' + (isToday ? '今日のレース' : esc(fmtDay(raceDate)) + 'のレース') + holidayChip(raceDate, 'hd') + '<span class="sp"></span>' + (isToday ? '<small class="auto">自動で更新</small>' : '') + '</h3>' +
      (isToday ? stallHtml() : '') + /* 進行役のテレビが止まっている（2026-10-28） */
      (holUsed ? '<p class="hint holhint">祝日の決まりを使っています</p>' : '') +
      (isToday ? tvStrip() : '') +
      nowCard(list, isToday) +
      '<div class="summary" id="raceSum"><div class="stat"><small>終わったレース</small><b>' + sum.done + ' / ' + real.length + '</b></div><div class="stat"><small>参加（票の数）</small><b>' + fmtN(sum.votes) + '人</b></div>' +
      '<div class="stat"><small>当選額 / 目標</small><b>' + ptN(sum.paid) + '<span class="of"> / ' + ptN(sum.target) + '</span></b></div><div class="stat' + (sum.unpaid ? ' ng' : '') + '"><small>まだ渡していない</small><b>' + ptN(sum.unpaid) + '</b></div></div>' +
      (list.some((r) => r.test) ? '<p class="hint" style="margin:2px 0 6px">テストのレースは数字に入れていません（当たっても払いません）。</p>' : '') +
      (racesErr ? '<div class="err">' + esc(racesErr) + '</div>' : '') +
      (racesData == null ? '<div class="empty">読み込み中…</div>' : !list.length ? '<div class="empty">この日のレースはありません</div>' :
        '<div class="tbl"><table class="cards rl"><tr class="hd"><th>走り出す</th><th>状態</th><th class="n">参加</th><th class="n">当選額 / 目標</th><th>結果（1着 → 2着）</th><th></th></tr>' +
        rows.map(row).join('') + '</table></div>' +
        (hidden || raceAll ? '<div class="acts l"><button class="btn sm ghost" data-act="race-all">' + (raceAll ? '少なく表示' : 'ほか ' + hidden + ' 件のレースを表示') + '</button></div>' : '')) +
      '<div class="datebar"><span class="hint" style="margin:0">ほかの日:</span><button class="btn sm ghost" data-act="rq" data-n="-1" aria-label="前の日">◀ 前の日</button><input type="date" id="rdate" value="' + esc(raceDate) + '" aria-label="日付"><button class="btn sm ghost" data-act="rq" data-n="1" aria-label="次の日">次の日 ▶</button>' + (isToday ? '' : '<button class="btn sm ghost" data-act="rq" data-n="0">今日へ</button>') + '</div>' +
      '<div class="acts l"><button class="btn link" data-act="memo" aria-pressed="' + memoOn + '">' + (memoOn ? '勝ち馬の決まり方を隠す' : '勝ち馬の決まり方を見る（オーナー用）') + '</button></div>' +
      (memoOn ? '<div class="explain" id="explainBox">' + explainHtml(cfg.tuning) + '</div>' : '') + '</div>';
  }
  /* 勝ち馬（1着→2着）の決まり方（オーナー用）。今の調整の値で書く。今日の「勝ち馬の決まり方を見る」と、調整の「くわしく」で同じ文 */
  function explainHtml(T) {
    const pc = (v) => Math.round((Number(v) || 0) * 100) + '%', tg = 30000;
    const lo = Math.ceil(tg * (1 - (Number(T.bandBelow) || 0)) - 1e-9), hi = Math.floor(tg * (1 + (Number(T.bandAbove) || 0)) + 1e-9);
    const cap = (v) => (Number(v) > 0 ? ptT(v) : 'なし'), sp = spreadOfT(T);
    return '<b class="exh">勝ち馬（1着 → 2着）の決まり方</b><ol class="exl">' +
      '<li>締切のあと、票の入った組み合わせごとに「当たったら渡す額の合計」（票の数 × 100pt × 倍率）を出します。倍率は見せていた値から<b>下げ ' + pc(T.shiftDown) + '〜上げ ' + pc(T.shiftUp) + '</b>の間で動かせます（1.0 倍より下げません）。</li>' +
      '<li>合計が<b>当選額の目標の幅</b>（目標の −' + pc(T.bandBelow) + '〜＋' + pc(T.bandAbove) + '。目標 ' + ptT(tg) + ' なら ' + fmtN(lo) + '〜' + ptT(hi) + '）に入る組み合わせがあれば、その中から起きやすさに合わせて抽選します。倍率は<b>見せていた倍率をなるべくそのまま</b>にし、幅に入れるのに要る分だけ動かします。</li>' +
      (sp > 0 ? '<li><b>配当のぶれ ' + pc(sp) + '</b>: レースごとに、寄せる額を目標の ' + spreadRange(sp) + ' の間でばらつかせます（幅はそのまわり）。毎レース目標ちょうどにはなりません。</li>' : '<li>配当のぶれは 0%（毎レース目標のまわりに寄せます）。</li>') +
      '<li>幅に入るものが無ければ、目標にいちばん近い組み合わせにします＝<b>必ず誰かは当てる</b>。</li>' +
      '<li>ただし<b>払い出しの上限</b>（1 レース ' + cap(T.payoutCap) + '・1 日 ' + cap(T.payoutCapDay) + '）を超える組み合わせは選びません。上限は「必ず誰かは当てる」より強い決まりです。票の入ったどの組み合わせも上限を超えるときは、票の入っていない組み合わせ＝<b>当たりなし</b>になります。</li>' +
      '<li><b>誰も投票していない</b>レースは自然の結果のまま。テストの票しかないときは払わないので上限を見ません。</li>' +
      '<li>決めた 1着 → 2着 の順にゴールするように走りを作ります（人気の倍率の表示はそのまま）。</li></ol>';
  }
  /* その場のレース取消（v4: まだ渡していない当たりを取り消す。渡した分はそのまま。参加無料なので返すものはない） */
  function refundBox(r) {
    return '<div class="rfbox" id="refundPanel"><b>' + esc(fmtDay(bizYmd(r.at))) + ' ' + bizHM(r.at) + ' のレースを取り消しますか？</b><small>参加 ' + fmtN(votesOf(r)) + ' 人' + (r.test ? '・テストのレース' : '') + '</small>' +
      '<div class="rfnums"><div><small>取り消す当選額（まだ渡していない）</small><b>' + ptN(r.unpaidTotal) + '</b></div><div><small>もう渡した当選額（そのまま）</small><b>' + ptN(r.claimedTotal) + '</b></div></div>' +
      '<div class="rfwarn">元に戻せません</div>' +
      '<div class="rfacts"><button class="btn ghost" data-act="race-refund" data-id="' + esc(r.id) + '">やめる</button><button class="btn danger" data-act="refund" data-id="' + esc(r.id) + '">取り消す</button></div></div>';
  }

  /* ======================================================================
     調整（v4: 投票の秒数・元の額・倍率のずらし幅（上限なし）・当たりの幅・払い出しの上限・馬の見た目・そのほか・テスト用）
     ====================================================================== */
  const pct = (v) => Math.round((Number(v) || 0) * 100);
  function voteExample(sec) {
    if (!(sec > 0)) return '';
    const m = 21 * 60 * 60 - sec, h = Math.floor(m / 3600), mi = Math.floor((m % 3600) / 60), s = m % 60;
    return '例: 21:00 のレースは <b>' + pad(h) + ':' + pad(mi) + (s ? ':' + pad(s) : '') + '</b> から投票（' + secTxt(sec) + '）。テレビの QR はずっと出ています。';
  }
  /* ずらし幅の例（見せた倍率 10.0 倍のとき）。入力のたびに書き直す */
  function shiftExample(up, down) {
    const o = 10, lo = Math.max(1, Math.round(o * (1 - down) * 10) / 10), hi = Math.min(999.9, Math.round(o * (1 + up) * 10) / 10);
    return '見せた倍率が 10.0 倍なら、確定は <b>' + lo.toFixed(1) + '〜' + hi.toFixed(1) + ' 倍</b>の間（当たれば ' + fmtN(payFor(lo)) + '〜' + ptT(payFor(hi)) + '）。';
  }
  /* 当たりの幅の例（目標 30,000pt のとき）。入力のたびに書き直す */
  function bandExample(below, above) {
    if (!(below > 0) && !(above > 0)) return '幅が両方 0% なので、目標にいちばん近い組み合わせが勝ちます';
    const tg = 30000, lo = Math.ceil(tg * (1 - below) - 1e-9), hi = Math.floor(tg * (1 + above) + 1e-9);
    return '目標 ' + ptT(tg) + ' なら <b>' + fmtN(lo) + '〜' + ptT(hi) + '</b> に入る組み合わせから、起きやすさで抽選。無ければいちばん近い組み合わせ（必ず誰かは当てる）';
  }
  /* 配当のぶれ（2026-10-29）: 0〜0.8。レースごとに目標 ×（1 − ぶれ）〜 ×（1 + ぶれ ÷ 4）に寄せる。v2/outcome.js の spreadFactor と同じ範囲 */
  const spreadOfT = (T) => (T && T.payoutSpread != null ? Number(T.payoutSpread) || 0 : 0.3);
  const spreadRange = (s) => Math.round((1 - s) * 100) + '%〜' + Math.floor((1 + s / 4) * 1000 + 1e-6) / 10 + '%';
  function spreadExample(s) {
    if (!(s > 0)) return '0 なので今までどおり、毎レース目標ちょうどのまわりに寄せます。上限は必ず守ります';
    const tg = 30000;
    return 'レースごとに目標の <b>' + spreadRange(s) + '</b> の間でばらつきます（目標 ' + ptT(tg) + ' なら ' + fmtN(Math.round(tg * (1 - s))) + '〜' + ptT(Math.round(tg * (1 + s / 4))) + ' のどこかに寄せる）。上限は必ず守ります';
  }
  /* 1 台の会計番号の上限（2026-10-27）の例文。1 は使えない（全員の票が数えられなくなる） */
  function billsExample(n) {
    n = Math.round(Number(n) || 0);
    if (!n) return '使っていません（1台で何個の会計番号を使っても、決め方は同じ）。';
    if (n === 1) return '<span class="err" style="display:inline">1 は使えません（0 か 2〜99）</span>';
    return '友だちの分を1台で入れる（' + (n - 1) + ' 個まで）はふつうどおり。' + n + ' 個以上は、決め方に数えず、管理の「集計」の「注意」に出ます（お客さん・スタッフの画面は変わりません）。';
  }
  function viewTuning() {
    const T = cfg.tuning;
    const cur = TUNE_PRESETS.find((p) => Math.abs(p[2].volatility - T.volatility) < 1e-6 && Math.abs(p[2].shiftUp - T.shiftUp) < 1e-6 && Math.abs(p[2].shiftDown - T.shiftDown) < 1e-6);
    const up = pct(T.shiftUp), down = pct(T.shiftDown);
    return '<div class="panel" id="votePanel"><h3>投票と当選額</h3>' +
      stepRow('投票の時間', '走り出す時刻の何秒前から投票できるか。全店同じ', 'voteSec', T.voteSec, '秒', 10, 3600, 10) +
      '<p class="hint" id="voteEx">' + voteExample(T.voteSec) + '</p>' +
      fixedRow('テストレースの投票', 'スタッフのスマホの「テストレース」。当たっても払いません', TEST_VOTE_SEC + '秒', 'fixTest') +
      fixedRow('元の額', '当選額 ＝ 100pt × 2 連単の倍率（100pt 単位に切り上げ。12.4 倍 → 1,300pt）', STAKE + 'pt', 'fixStake') +
      '</div>' +
      '<div class="panel" id="oddsPanel"><h3>倍率と当たりの決め方 <small class="qsub">オーナー用・店舗には見せない</small></h3>' +
      stepRow('確定の倍率を上げる幅', '締切のあと、見せていた倍率より上げてよい幅。上限なし', 'shiftUp', up, '%', 0, 1000000, 1) +
      '<div class="warnmsg bigwarn" id="warnUp"' + (up > BIG_SHIFT ? '' : ' hidden') + '>見た倍率と大きく変わります（上げ ' + up + '%）</div>' +
      stepRow('確定の倍率を下げる幅', '0〜100%。倍率は 1.0 倍より下げません（当たった人は最低 100pt）', 'shiftDown', down, '%', 0, 100, 1) +
      '<div class="warnmsg bigwarn" id="warnDown"' + (down > BIG_SHIFT ? '' : ' hidden') + '>見た倍率と大きく変わります（下げ ' + down + '%）</div>' +
      '<p class="hint" id="shiftEx">' + shiftExample(T.shiftUp, T.shiftDown) + '</p>' +
      stepRow('当たりの幅（目標より少ない側）', '当選額の合計が目標より何%少なくてもよいか', 'bandBelow', pct(T.bandBelow), '%', 0, 50, 1) +
      stepRow('当たりの幅（目標より多い側）', '当選額の合計が目標より何%多くてもよいか', 'bandAbove', pct(T.bandAbove), '%', 0, 50, 1) +
      '<p class="hint" id="bandEx">' + bandExample(T.bandBelow, T.bandAbove) + '</p>' +
      stepRow('配当のぶれ', '0 で今までどおり目標ちょうどに寄せる。30% なら目標の 70%〜107% の間でレースごとにばらつく。上限は必ず守る', 'payoutSpread', pct(spreadOfT(T)), '%', 0, 80, 1) +
      '<p class="hint" id="spreadEx">' + spreadExample(spreadOfT(T)) + '</p>' +
      stepRow('払い出しの上限（1 レース）', '0 = なし。1 レースの当選額の合計', 'payoutCap', T.payoutCap || 0, 'pt', 0, 99999900, 100) +
      stepRow('払い出しの上限（1 日）', '0 = なし。全店の 1 日の当選額の合計', 'payoutCapDay', T.payoutCapDay || 0, 'pt', 0, 999999900, 100) +
      '<p class="hint capnote">上限は「必ず誰かは当てる」より<b>強い</b>決まりです。上限を超える組み合わせしかないときは<b>当たりなし</b>になります。</p>' +
      stepRow('1台の会計番号の上限', '1台のスマホが1レースでこの数以上の会計番号を使うと、その票は「必ず誰かは当てる」に数えません（自然に当たれば払います）。0 = 使わない', 'maxBillsPerDevice', T.maxBillsPerDevice == null ? 4 : T.maxBillsPerDevice, '個', 0, 99, 1) +
      '<p class="hint" id="billsEx">' + billsExample(T.maxBillsPerDevice == null ? 4 : T.maxBillsPerDevice) + '</p>' +
      '<details class="fold" id="explainFold"><summary>勝ち馬の決まり方（くわしく）</summary><div class="in explain">' + explainHtml(T) + '</div></details>' +
      '</div>' +
      viewHorseLook(T) +
      '<div class="panel"><details class="fold" id="moreTune" style="border-top:0;margin:0"><summary>そのほかの調整 <small>倍率の作り方・演出・テレビの時間</small></summary><div class="in">' +
      '<h4 class="sumh">倍率の作り方</h4>' +
      '<div class="quick"><span class="hint" style="margin:0">まとめて:</span>' + TUNE_PRESETS.map((p) => '<button type="button" class="btn sm ghost" aria-pressed="' + !!(cur && cur[0] === p[0]) + '" data-act="tpreset" data-p="' + p[0] + '" title="' + esc(p[3]) + '">' + p[1] + '</button>').join('') + '</div>' +
      stepRow('払い戻し率', '見せる倍率の払い戻し率', 'payoutRate', pct(T.payoutRate), '%', 50, 99, 1) +
      stepRow('荒れやすさ', '1.0 がふつう。大きいほど人気薄が来る', 'volatility', T.volatility, '倍', 0.3, 2.5, 0.1) +
      viewCues(T) +
      '<h4 class="sumh">テレビの時間</h4>' +
      stepRow('結果を見せる時間（初期値）', '店舗を追加したときの初期値（店ごとに変えられます）', 'resultSec', T.resultSec || 300, '秒', 10, 1800, 10) +
      stepRow('ゲートイン', '走り出す時刻からゲートが開くまで', 'gateSec', T.gateSec, '秒', 0, 60, 1) +
      stepRow('ゴール後', 'リプレイ・写真判定・勝ち馬（結果発表まで）', 'postSec', T.postSec, '秒', 0, 120, 1) +
      '</div></details></div>' +
      '<details class="panel" id="testPanel"><summary>テスト用（本番では使わない）</summary>' +
      '<p class="hint">時刻表とは別に、今すぐテストレースを作ります。投票 ' + TEST_VOTE_SEC + ' 秒・当たっても払わない・集計に入れない。</p>' +
      '<div class="range"><label class="f"><span>何秒後に走り出す</span><input type="number" id="trin" value="120" min="10" max="3600"></label><label class="f"><span>当選額の目標（pt）</span><input type="number" id="trpay" value="3000" min="1" max="' + PAY_MAX + '"></label>' +
      '<label class="f"><span>店舗</span><select id="trstore"><option value="">全店（同時）</option>' + cfg.stores.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + 'だけ</option>').join('') + '</select></label></div>' +
      '<div class="acts"><button class="btn ghost" data-act="test-race">テストレースを作る</button></div></details>' +
      '<div class="savebar"><div class="msg" id="tumsg"></div><button type="button" class="btn ghost" data-act="tun-revert">元に戻す</button><button type="button" class="btn" data-act="tun-save" id="tusave">保存</button></div>';
  }
  /* 確定演出（店舗には見せない）: 演出ごとに「出す割合」と「当たる割合」を 1 行に。保存は下の「保存」ボタン（変えた演出だけ送る） */
  function stepMini(label, key, val, unit, min, max, step) {
    return '<div class="mini"><span>' + label + '</span><div class="stepper" data-k="' + key + '" data-min="' + min + '" data-max="' + max + '" data-step="' + step + '"><button type="button" data-act="st" data-d="-1" aria-label="減らす">◀</button>' +
      '<input class="pv" type="number" inputmode="decimal" id="n-' + key + '" value="' + val + '" min="' + min + '" max="' + max + '" step="' + step + '" style="--d:' + pvDigits(max, step) + '" aria-label="' + esc(label) + '"><i>' + unit + '</i><button type="button" data-act="st" data-d="1" aria-label="増やす">▶</button></div></div>';
  }
  function viewCues(T) {
    const cz = T.cues || DEF_CUES;
    return '<div id="cuesPanel"><h4 class="sumh">演出（1 着の馬のヒント）</h4>' +
      '<p class="hint"><b>出す</b>＝その演出が出る割合、<b>当たる</b>＝出たときに本当の 1 着の馬を指す割合。<b>100% ＝ 確定</b>。外れたときは別の馬を指します。</p>' +
      CUES.map(([k, name, how]) => { const c = cz[k] || DEF_CUES[k]; return '<div class="cue-row" data-cue="' + k + '"><div class="cn">' + esc(name) + '<small>' + esc(how) + '</small></div><div class="cs">' +
        stepMini('出す', 'cueShow_' + k, c.show, '%', 0, 100, 5) + stepMini('当たる', 'cueHit_' + k, c.hit, '%', 0, 100, 5) + '</div></div>'; }).join('') +
      '</div>';
  }
  /* 今日のレースの 1 行: 出た演出と、本当の 1 着を指していたか（○ / ×）。cues はサーバーが結果と一緒に決めたもの（管理と合言葉のあるテレビにだけ届く） */
  function cueTxt(r) {
    const cz = r.cues || (r.decision && r.decision.cues); if (!cz || !r.result) return '';
    const fired = CUES.filter(([k]) => cz[k] && cz[k].horse != null);
    const t = fired.length ? '演出: ' + fired.map(([k, name]) => { const h = cz[k].horse; return name + '→' + noOf(r, h) + '番 ' + (h === r.result.winner ? '○' : '×'); }).join(' / ') : '演出なし';
    return '<small class="hint cue-txt" style="display:block;margin:0">' + nwJoin(t, ' / ') + '</small>';
  }
  /* 馬の見た目（全店共通。v2/core.js の horseLook）: 押すとすぐ保存。全店のテレビが次のレースから同じ見た目にそろう */
  const HORSE_LOOKS = [['cute', 'かわいい（標準）'], ['real', '本物寄り']];
  function viewHorseLook(T) {
    const cur = T.horseLook === 'real' ? 'real' : 'cute';
    return '<div class="panel" id="hlookPanel"><h3>馬の見た目</h3><p class="hint">押すとすぐ保存。全店のテレビに次のレースから反映</p><div class="quick">' +
      HORSE_LOOKS.map(([v, l]) => '<button type="button" class="btn sm ' + (cur === v ? '' : 'ghost') + '" data-act="hlook" data-v="' + v + '" aria-pressed="' + (cur === v) + '">' + l + '</button>').join('') + '</div></div>';
  }
  async function saveHorseLook(v) {
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
  const CUE_KEYS = [].concat.apply([], CUES.map(([k]) => ['cueShow_' + k, 'cueHit_' + k]));
  const TUN_KEYS = ['voteSec', 'shiftUp', 'shiftDown', 'bandBelow', 'bandAbove', 'payoutSpread', 'payoutCap', 'payoutCapDay', 'maxBillsPerDevice', 'payoutRate', 'volatility', 'resultSec', 'gateSec', 'postSec'].concat(CUE_KEYS);
  function validateTuning() {
    if (!$('tumsg')) return 1;
    const badKeys = TUN_KEYS.filter((k) => !numOk(k) || (k === 'maxBillsPerDevice' && $('n-' + k) && Number($('n-' + k).value) === 1)), bad = badKeys.length;
    if ($('n-maxBillsPerDevice')) { const one = Number($('n-maxBillsPerDevice').value) === 1, inR = numOk('maxBillsPerDevice'); $('n-maxBillsPerDevice').classList.toggle('bad', one || !inR); if ($('billsEx') && inR) $('billsEx').innerHTML = billsExample(numOf('maxBillsPerDevice')); } // 1 は範囲の中でも赤（numOk は 1 回だけ。2 回目で赤が消えていた）
    if ($('voteEx') && numOk('voteSec')) $('voteEx').innerHTML = voteExample(numOf('voteSec'));
    if ($('bandEx') && numOk('bandBelow') && numOk('bandAbove')) $('bandEx').innerHTML = bandExample(numOf('bandBelow') / 100, numOf('bandAbove') / 100);
    if ($('spreadEx') && numOk('payoutSpread')) $('spreadEx').innerHTML = spreadExample(numOf('payoutSpread') / 100);
    if (numOk('shiftUp') && numOk('shiftDown')) {
      const up = numOf('shiftUp'), down = numOf('shiftDown');
      if ($('shiftEx')) $('shiftEx').innerHTML = shiftExample(up / 100, down / 100);
      if ($('warnUp')) { $('warnUp').hidden = !(up > BIG_SHIFT); $('warnUp').textContent = '見た倍率と大きく変わります（上げ ' + fmtN(up) + '%）'; }
      if ($('warnDown')) { $('warnDown').hidden = !(down > BIG_SHIFT); $('warnDown').textContent = '見た倍率と大きく変わります（下げ ' + down + '%）'; }
    }
    { const mt = $('moreTune'); if (mt && !mt.open && mt.querySelector('.bad')) mt.open = true; } // 畳んだ欄にエラーがあれば開く
    { // 勝ち馬の決まり方（くわしく）も、入れている値で書き直す（範囲の外の欄は保存済みの値）
      const ex = main.querySelector('#explainFold .explain'), T0 = cfg.tuning, v = (k, div) => (numOk(k) ? numOf(k) / (div || 1) : T0[k]);
      if (ex) ex.innerHTML = explainHtml(Object.assign({}, T0, { shiftUp: v('shiftUp', 100), shiftDown: v('shiftDown', 100), bandBelow: v('bandBelow', 100), bandAbove: v('bandAbove', 100), payoutSpread: v('payoutSpread', 100), payoutCap: v('payoutCap'), payoutCapDay: v('payoutCapDay') }));
    }
    $('tumsg').innerHTML = bad ? '<div class="err">数字の範囲を確かめてください（赤い欄）</div>' : tunDirty ? '<div class="warnmsg">保存していない変更があります</div>' : '<div class="okmsg">保存済みです</div>';
    $('tusave').disabled = bad > 0 || !tunDirty;
    return bad;
  }
  async function saveTuning() {
    if (validateTuning()) return;
    const t = {
      voteSec: Math.round(numOf('voteSec')),
      shiftUp: Math.round(numOf('shiftUp')) / 100, shiftDown: Math.round(numOf('shiftDown')) / 100,
      bandBelow: Math.round(numOf('bandBelow')) / 100, bandAbove: Math.round(numOf('bandAbove')) / 100, payoutSpread: Math.round(numOf('payoutSpread')) / 100,
      payoutCap: Math.round(numOf('payoutCap')), payoutCapDay: Math.round(numOf('payoutCapDay')), maxBillsPerDevice: Math.round(numOf('maxBillsPerDevice')),
      payoutRate: Math.round(numOf('payoutRate')) / 100, volatility: Math.round(numOf('volatility') * 10) / 10,
      resultSec: Math.round(numOf('resultSec')), gateSec: Math.round(numOf('gateSec')), postSec: Math.round(numOf('postSec')),
    };
    // 変えた項目だけ送る（ほかの画面で変えた項目を、この画面の古い値で戻さない）
    const T0 = cfg.tuning, near = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 1e-9;
    Object.keys(t).forEach((k) => { if (near(t[k], T0[k])) delete t[k]; });
    { const cz = {}; CUES.forEach(([k]) => { const cur = (T0.cues && T0.cues[k]) || DEF_CUES[k], sh = Math.round(numOf('cueShow_' + k)), hi = Math.round(numOf('cueHit_' + k)), d = {}; if (!near(sh, cur.show)) d.show = sh; if (!near(hi, cur.hit)) d.hit = hi; if (Object.keys(d).length) cz[k] = d; }); if (Object.keys(cz).length) t.cues = cz; } /* 演出: 変えた演出・項目だけ */
    if (!Object.keys(t).length) { tunDirty = false; toast('変更はありません'); return keepScroll(render); }
    const big = (t.shiftUp != null && t.shiftUp * 100 > BIG_SHIFT) || (t.shiftDown != null && t.shiftDown * 100 > BIG_SHIFT);
    if (big && !confirm('倍率のずらし幅が大きいので、お客さんが見た倍率と確定の倍率が大きく変わります。\n（上げ ' + fmtN(pct(t.shiftUp != null ? t.shiftUp : T0.shiftUp)) + '%・下げ ' + pct(t.shiftDown != null ? t.shiftDown : T0.shiftDown) + '%）\n保存しますか？')) return;
    await api('saveTuning', t);
    await reloadCfg(); tunDirty = false; toast('保存しました（これから作るレースから使われます）'); keepScroll(render);
  }

  /* ======================================================================
     集計（v4: 票の数（参加人数）・当選額と目標・渡した額・まだ渡していない額・期限切れ。日ごと・店舗ごと）と、会計番号で探す
     テストのレース・テストの店は入らない（サーバーの集計に入れていない）
     ====================================================================== */
  async function loadStats() {
    statsData = null; statsErr = ''; if (tab === 'stats') keepScroll(() => { main.innerHTML = viewStats(); });
    const my = (loadStats.seq = (loadStats.seq || 0) + 1); // 期間・店舗を続けて変えたとき、遅れて届いた前の答えで上書きしない
    abuseData = null; abuseErr = '';
    const ab = abuseOff ? Promise.resolve() : api('abuse', stFrom, stTo, stStore || undefined).then((x) => { if (my === loadStats.seq) abuseData = x; }, (e) => { if (my !== loadStats.seq) return; if (e && (e.code === 'not_supported' || e.status === 404)) abuseOff = true; else abuseErr = errText(e); }); // 注意（2026-10-27。古いサーバーなら出さない）
    try { const x = await api('stats', stFrom, stTo, stStore || undefined); if (my !== loadStats.seq) return; statsData = x; }
    catch (e) { if (my !== loadStats.seq) return; statsErr = errText(e); }
    await ab; if (my !== loadStats.seq) return;
    if (tab === 'stats') keepScroll(() => { main.innerHTML = viewStats(); });
  }
  const SK = ['races', 'votes', 'players', 'target', 'paid', 'claimed', 'expired', 'unclaimed'];
  const statRow = (x) => { const o = {}; SK.forEach((k) => { o[k] = Number(x && x[k]) || 0; }); if (!(x && x.unclaimed != null)) o.unclaimed = Math.max(0, o.paid - o.claimed - o.expired); return o; };
  const statDays = () => (statsData && statsData.days ? statsData.days.map((x) => Object.assign({ date: x.date }, statRow(x))) : []);
  function statTotal() {
    if (statsData && statsData.totals) return statRow(statsData.totals);
    return statDays().reduce((a, x) => { SK.forEach((k) => { a[k] += x[k]; }); return a; }, statRow({}));
  }
  function byStoreRows() {
    const bs = statsData && statsData.totals && statsData.totals.byStore; if (!bs) return null;
    const ids = Object.keys(bs).filter((k) => !stStore || k === stStore); if (!ids.length) return null;
    const order = cfg.stores.map((s) => s.id);
    return ids.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)).map((k) => Object.assign({ storeId: k }, statRow(bs[k])));
  }
  const rateTxt = (paid, target) => (target ? '目標の ' + Math.round(paid / target * 100) + '%' : '');
  function viewStats() {
    const quick = [['today', '今日'], ['yday', '昨日'], ['7', '7 日'], ['month', '今月'], ['31', '31 日']];
    const days = statDays(), tot = statTotal(), bs = byStoreRows(), L = logsData, oneStore = !!stStore;
    const qOn = (q) => { const r = quickRange(q); return r[0] === stFrom && r[1] === stTo; }; // 今選んでいる期間ボタンは銀
    /* 日ごと・店舗別の 1 行（PC は表、スマホはカード）。スマホは主な数字（票の数・当選額・まだ渡していない）を先に、残りは「くわしく」で開く */
    const cell = (l, v, more) => '<td class="n' + (more ? ' more' : '') + '" data-l="' + l + '">' + v + '</td>';
    const unc = (v) => (v ? '<b style="color:var(--unpaid)">' + ptN(v) + '</b>' : '0' + '<small class="pt">pt</small>');
    const moreBtn = '<button type="button" class="btn xs ghost daymore" data-act="day-more" aria-expanded="false">くわしく</button>';
    return '<div class="panel"><h3>集計を見る</h3>' +
      '<div class="quick">' + quick.map((q) => '<button class="btn sm ghost" data-act="stq" data-q="' + q[0] + '" aria-pressed="' + qOn(q[0]) + '">' + q[1] + '</button>').join('') + '</div>' +
      '<div class="range"><label class="f"><span>開始</span><input type="date" id="stfrom" value="' + esc(stFrom) + '" max="' + esc(stTo) + '"></label><label class="f"><span>終了</span><input type="date" id="stto" value="' + esc(stTo) + '" min="' + esc(stFrom) + '"></label>' +
      '<label class="f"><span>店舗</span><select id="ststore"><option value="">全店舗</option>' + cfg.stores.map((s) => '<option value="' + esc(s.id) + '"' + (stStore === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label></div>' +
      (statsErr ? '<div class="err">' + esc(statsErr) + '</div>' : '') +
      '<h4 class="sumh">票と当選額</h4><div class="summary" id="statVotes"><div class="stat"><small>票の数（参加人数）</small><b>' + fmtN(tot.votes) + '</b><small>会計番号 ' + fmtN(tot.players) + ' 個</small></div>' +
      '<div class="stat"><small>レース数</small><b>' + fmtN(tot.races) + '</b></div>' +
      (oneStore ? '' : '<div class="stat"><small>当選額の目標</small><b>' + ptN(tot.target) + '</b></div>') +
      '<div class="stat"><small>当選額</small><b>' + ptN(tot.paid) + '</b>' + (oneStore ? '' : '<small>' + rateTxt(tot.paid, tot.target) + '</small>') + '</div></div>' +
      '<h4 class="sumh">渡した額</h4><div class="summary" id="statMoney"><div class="stat"><small>渡した額</small><b>' + ptN(tot.claimed) + '</b></div>' +
      '<div class="stat ' + (tot.unclaimed ? 'ng' : '') + '"><small>まだ渡していない額</small><b>' + ptN(tot.unclaimed) + '</b></div>' +
      '<div class="stat"><small>期限切れ</small><b>' + ptN(tot.expired) + '</b><small>その日のうちに受け取られなかった</small></div></div>' +
      (statsData == null && !statsErr ? '<div class="empty">読み込み中…</div>' :
        '<h4 class="sumh">日ごと</h4><div class="tbl"><table class="cards days"><tr class="hd"><th>日付</th><th class="n">票の数</th><th class="n">当選額</th><th class="n">まだ渡していない</th><th class="n">レース</th>' + (oneStore ? '' : '<th class="n">目標</th>') + '<th class="n">渡した額</th><th class="n">期限切れ</th></tr>' +
        (days.length ? days.map((x) => '<tr><td class="head"><b>' + fmtDay(x.date) + '</b>' + moreBtn + '</td>' + cell('票', fmtN(x.votes)) + cell('当選額', ptN(x.paid)) + cell('まだ渡していない', unc(x.unclaimed)) +
          cell('レース', fmtN(x.races), 1) + (oneStore ? '' : cell('目標', ptN(x.target), 1)) + cell('渡した額', ptN(x.claimed), 1) + cell('期限切れ', ptN(x.expired), 1) + '</tr>').join('') : '<tr><td colspan="8" class="empty">この期間のデータはありません</td></tr>') + '</table></div>') +
      (bs ? '<h4 class="sumh">店舗ごと</h4><div class="tbl"><table class="cards days" id="statStores"><tr class="hd"><th>店舗</th><th class="n">票の数</th><th class="n">当選額</th><th class="n">まだ渡していない</th><th class="n">渡した額</th><th class="n">期限切れ</th></tr>' +
        bs.map((x) => '<tr><td class="head"><b>' + esc(storeName(x.storeId)) + '</b>' + moreBtn + '</td>' + cell('票', fmtN(x.votes)) + cell('当選額', ptN(x.paid)) + cell('まだ渡していない', unc(x.unclaimed)) +
          cell('渡した額', ptN(x.claimed), 1) + cell('期限切れ', ptN(x.expired), 1) + '</tr>').join('') + '</table></div>' : '') +
      '<div class="acts l"><button class="btn sm ghost" data-act="st-csv"' + (days.length ? '' : ' disabled') + '>CSV（Excel）に書き出す</button></div>' +
      '<details class="fold"><summary>言葉の意味</summary><div class="in"><p class="hint">票の数（参加人数）＝投票の数（1 人 1 レース 1 票なので参加人数と同じ）。会計番号＝その日に投票した会計番号の数。当選額の目標＝時刻表の目標の合計。当選額＝当たった人に渡す額の合計（100pt × 倍率を 100pt 単位に切り上げ）。渡した額＝お客さんのスマホのスライドかスタッフのスマホで「渡した」にした額。まだ渡していない額＝当たったのにまだ受け取っていない額（その日のうち）。期限切れ＝その日のうち（朝 5 時の区切りまで）に受け取られなかった額。テストのレースとテストモードの店舗の分は入りません。店舗ごとには目標を出しません（時刻表は全店同じ）。</p></div></details></div>' +
      viewAbuse() +
      '<div class="panel"><h3>会計番号で探す</h3><p class="hint">期間と店舗は上と同じ。空のまま探すと全部出ます。</p>' +
      '<div class="range"><label class="f"><span>会計番号（2 桁）</span><input type="text" id="lbill" value="' + esc(logBill) + '" maxlength="4" placeholder="例: 12" inputmode="numeric" autocapitalize="off"></label><div class="quick" style="align-items:end;padding-bottom:10px"><button class="btn sm" data-act="log-search">探す</button><button class="btn sm ghost" data-act="log-csv"' + (L && L.logs.length ? '' : ' disabled') + '>CSV に書き出す</button></div></div>' +
      (logsErr ? '<div class="err">' + esc(logsErr) + '</div>' : '') +
      (L ? viewLogs(L) : '') + '</div>';
  }
  /* 注意（2026-10-27。オーナー用。1 台のスマホ（端末）で番号・当たり・ボーナスが多いもの）: Core.abuseReport の答え（模擬クラウド GET /api/admin/abuse・Firestore 版 admin.abuse）。
     端末は末尾 6 文字だけ（…abc123）。お客さん・スタッフの画面には何も出さない（ここだけ） */
  const ABUSE_WHY = { bills: (x, n) => '1レースで番号 ' + x.bills + ' 個（' + n + ' 個以上）', wins: (x) => '当たり ' + x.wins + ' 回', bonus: (x) => 'ボーナス ' + x.bonus + ' 回', flag: () => '決め方に数えていない当たり' };
  function viewAbuse() {
    if (abuseOff) return '';
    const D = abuseData, n = (D && D.threshold) || 4, flags = (D && D.flags) || [];
    const top = (list) => (list || []).slice(0, 3).map((x) => '<span class="mono">' + esc(x.dev) + '</span> ' + x.bills + '個' + (x.wins ? '・当たり' + x.wins + '回 ' + esc(ptT(x.pt)) : '')).join('<br>') || '—';
    const dayRows = D ? [].concat.apply([], (D.days || []).map((d) => d.stores.map((s) => ({ date: d.date, s })))) : [];
    return '<div class="panel" id="abusePanel"><h3>注意 <small class="qsub">オーナー用・1台のスマホで番号や当たりが多いもの</small></h3>' +
      (abuseErr ? '<div class="err">' + esc(abuseErr) + '</div>' : '') +
      (D == null && !abuseErr ? '<div class="empty">読み込み中…</div>' : !D ? '' :
        (flags.length ? '<div class="tbl"><table class="cards" id="abuseFlags"><tr class="hd"><th>日付・端末</th><th>店舗</th><th class="n">番号（1レース）</th><th class="n">当たり</th><th class="n">額</th><th>気になる所</th></tr>' +
          flags.slice(0, 100).map((x) => '<tr class="flag"><td class="head"><b>' + fmtDay(x.date) + '</b> <span class="mono dev">' + esc(x.dev) + '</span></td><td data-l="店舗">' + esc(x.stores.map(storeName).join('・')) + '</td><td class="n" data-l="番号">' + fmtN(x.bills) + '個</td><td class="n" data-l="当たり">' + fmtN(x.wins) + '回</td><td class="n" data-l="額">' + ptN(x.pt) + '</td><td class="full why">' + x.reasons.map((r) => '<span class="chip kind warn">' + esc((ABUSE_WHY[r] || (() => r))(x, n)) + '</span>').join('') + '</td></tr>').join('') + '</table></div>'
          : '<div class="empty okline" id="abuseNone">気になる端末はありません</div>')) +
      '<p class="hint">端末 ＝ お客さんのスマホ（ブラウザ）。履歴を消すと別の端末に見えます。1レースで ' + n + ' 個以上の会計番号を使った端末の票は、当たりの決め方に数えません（自然に当たったときは、ふつうに払います）。ボーナスは 1 台 1 日 1 回です。お客さん・スタッフの画面は変わりません。</p>' +
      (dayRows.length ? '<details class="fold" id="abuseFold"><summary>日ごと・店舗ごとの端末</summary><div class="in"><div class="tbl"><table class="cards days" id="abuseDays"><tr class="hd"><th>日付・店舗</th><th class="n">ボーナス</th><th class="n">端末</th><th class="n">1台の番号（最大）</th><th>番号の多い端末</th></tr>' +
        dayRows.map((r) => '<tr><td class="head"><b>' + fmtDay(r.date) + ' ' + esc(storeName(r.s.storeId)) + '</b></td><td class="n" data-l="ボーナス">' + fmtN(r.s.bonus) + '</td><td class="n" data-l="端末">' + fmtN(r.s.devices) + '台</td><td class="n" data-l="1台の番号">' + fmtN(r.s.maxBills) + '個</td><td class="full tops" data-l="多い端末">' + top(r.s.top) + '</td></tr>').join('') + '</table></div></div></details>' : '') +
      '</div>';
  }
  const LOG_KIND = { vote: ['投票', 'info'], release: ['番号を空けた', ''], win: ['当たり', 'warn'], paid: ['受け取り', 'ok'], expired: ['期限切れ', ''] };
  const logKind = (x) => (x.type === 'paid' ? ['受け取り（' + (x.via === 'self' ? 'お客さんのスライド' : 'スタッフ') + '）', 'ok'] : LOG_KIND[x.type] || [x.type, '']);
  const logAmt = (x) => (x.type === 'win' || x.type === 'paid' || x.type === 'expired' ? Number(x.amount != null ? x.amount : x.count) || 0 : null);
  // 会計番号ごと（店＋番号）の集計（core.js の sumBill と同じ形）: 票・当選額・渡した・期限切れ
  function sumLogs(logs) {
    const by = {};
    logs.forEach((l) => {
      const k = (l.storeId ? l.storeId + ':' : '') + l.bill, x = (by[k] = by[k] || { storeId: l.storeId || null, bill: l.bill, nick: l.nick, votes: 0, win: 0, paid: 0, expired: 0 }), n = logAmt(l) || 0;
      if (l.type === 'win') x.win += n; else if (l.type === 'paid') x.paid += n; else if (l.type === 'expired') x.expired += n; else if (l.type === 'vote') x.votes++;
      if (l.nick) x.nick = l.nick;
    });
    return by;
  }
  function viewLogs(L) {
    const keys = Object.keys(L.byBill || {});
    return (keys.length ? '<div class="tbl"><table class="cards" id="billTable"><tr class="hd"><th>店舗・会計番号</th><th>ニックネーム</th><th class="n">票</th><th class="n">当選額</th><th class="n">渡した額</th><th class="n">まだ渡していない</th><th class="n">期限切れ</th></tr>' +
      keys.slice(0, 200).map((k) => { const x = L.byBill[k], un = Math.max(0, (x.win || 0) - (x.paid || 0) - (x.expired || 0)); return '<tr><td class="head"><b>' + esc(storeName(x.storeId)) + ' ' + esc(x.bill) + '番</b></td><td class="nick" data-l="ニックネーム">' + esc(x.nick || '') + '</td><td class="n" data-l="票">' + fmtN(x.votes) + '</td><td class="n" data-l="当選額">' + ptN(x.win) + '</td><td class="n" data-l="渡した額">' + ptN(x.paid) + '</td><td class="n" data-l="まだ渡していない">' + (un ? '<b style="color:var(--unpaid)">' + ptN(un) + '</b>' : '0<small class="pt">pt</small>') + '</td><td class="n" data-l="期限切れ">' + ptN(x.expired) + '</td></tr>'; }).join('') + '</table></div>' : '') +
      '<h3 style="margin-top:14px;font-size:14px">明細（' + fmtN(L.logs.length) + ' 件' + (L.logs.length > 500 ? '。新しい 500 件を表示' : '') + '）</h3>' +
      (L.logs.length ? '<div class="tbl"><table class="cards"><tr class="hd"><th>日時</th><th>店舗</th><th>会計番号</th><th>ニックネーム</th><th>種類</th><th>組み合わせ</th><th class="n">額</th></tr>' +
        L.logs.slice(0, 500).map((x) => { const k = logKind(x), a = logAmt(x); return '<tr><td class="mono dt">' + esc(x.date ? x.date.slice(5) : ymd(x.at).slice(5)) + ' ' + hms(x.at).slice(0, 5) + '</td><td>' + esc(storeName(x.storeId)) + '</td><td class="mono">' + esc(x.bill) + '</td><td class="nick">' + esc(x.nick || '') + '</td><td><span class="chip kind ' + k[1] + '">' + esc(k[0]) + '</span></td><td class="mono">' + esc(comboTxt(x.combo)) + '</td><td class="n">' + (a == null ? '' : esc(ptT(a))) + '</td></tr>'; }).join('') + '</table></div>'
        : '<div class="empty">記録はありません</div>');
  }
  // 会計番号の記録: 管理用の API（logs）があればそれ、なければ各店舗の PIN でスタッフ用の記録を日ごとに集める
  async function searchLogs() {
    const raw = ($('lbill') ? $('lbill').value : logBill).trim();
    logBill = /^\d$/.test(raw) ? '0' + raw : raw; // 会計番号は 2 桁（「7」は「07」）
    logsData = null; logsErr = '';
    keepScroll(() => { main.innerHTML = viewStats(); });
    try {
      let logs, r = null;
      if (A && typeof A.logs === 'function') { try { r = await api('logs', { from: stFrom, to: stTo, bill: logBill || undefined, store: stStore || undefined }); } catch (e) { if (e.status !== 404) throw e; } } // 404 = サーバーが古い → 下の集め方
      if (r) logs = (r.logs || []);
      else {
        const dates = []; for (let d = stFrom; d <= stTo && dates.length < 62; d = addDays(d, 1)) dates.push(d);
        const stores = cfg.stores.filter((s) => !stStore || s.id === stStore);
        const jobs = [];
        stores.forEach((s) => { const sc = DerbyCloud.create({ store: s.id, role: 'staff' }); dates.forEach((d) => jobs.push(sc.logs(s.pin, { date: d, bill: logBill || undefined }).then((x) => (x && x.logs) || []))); });
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

  /* ---------- 入力イベント ---------- */
  const TEST_INPUTS = ['trin', 'trpay', 'trstore'];
  main.addEventListener('input', (e) => {
    const el = e.target;
    if (tab === 'tv' && editStore) return validateStore();
    if (tab === 'tuning') { if (TEST_INPUTS.indexOf(el.id) >= 0) return; tunDirty = true; return validateTuning(); }
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
      if (t && el.dataset.tf === 'kind') {
        t.kind = el.value; if (t.kind === 'weekday' && !t.weekdays.length) t.weekdays = [6, 0]; if (t.kind === 'date' && !t.date) t.date = addDays(todayStr(), 1);
        ttDirty = true; return ttRerender();
      }
      if (t && el.dataset.rf === 't') { return; }
      if (t && el.dataset.rs) { // 行の「投票できる店」のチェック（2026-10-26）: 全部 ON なら全店（null）。全部 OFF は保存できないエラー（店を 1 つは選んでください）
        const r = rowOf(t, el); if (!r) return;
        const ids = cfg.stores.map((s) => s.id), cur = new Set(Array.isArray(r.s) ? r.s : ids);
        if (el.checked) cur.add(el.dataset.rs); else cur.delete(el.dataset.rs);
        const arr = ids.filter((id) => cur.has(id)); r.s = arr.length === ids.length ? null : arr;
        paintRowChips(el.closest('[data-rk]'), r); return ttTouched();
      }
      if (t && el.dataset.find != null) { // 時刻で探す: 全部の行を出して、その時刻（なければ次の時刻）の行へ移る
        el.value = normTime(el.value); const m = toMin(el.value); if (isNaN(m)) return;
        const hit = t.rows.find((r) => toMin(r.t) >= m) || t.rows[t.rows.length - 1]; if (!hit) return;
        tplAll.add(t.id); ttRerender();
        const tr = main.querySelector('[data-rk="' + hit.k + '"]'); if (tr) { tr.scrollIntoView({ block: 'center' }); tr.classList.add('hit'); setTimeout(() => tr.classList.remove('hit'), 2500); const ip = tr.querySelector('[data-rf="t"]'); if (ip) ip.focus({ preventScroll: true }); }
        return;
      }
      if (el.id === 'pvdate') { pvDate = el.value; pvServer = null; if (pvSrc === 'server') loadServerPreview(); return paintPreview(); }
    }
    if (el.id === 'stvgame') { paintTvSeg(); return; }
    if (el.id === 'stvq') { paintQSeg(); return; }
    if (el.dataset && el.dataset.stripCk) { const id = el.dataset.stripCk, o = {}; main.querySelectorAll('[data-strip-ck="' + id + '"]').forEach((c) => { o[c.dataset.k] = c.checked; }); quickTvStrip(id, o); return; }
    if (el.id && el.id.indexOf('sstrip-') === 0) { paintStripEdit(); return validateStore(); }
    if (el.id === 'rdate') { raceDate = el.value || bizToday(); racesData = null; refundOpen = null; raceAll = false; render(); return; }
    if (el.id === 'stfrom' || el.id === 'stto' || el.id === 'ststore') {
      stFrom = $('stfrom').value || stFrom; stTo = $('stto').value || stTo; stStore = $('ststore').value;
      if (stFrom > stTo) { const x = stFrom; stFrom = stTo; stTo = x; }
      logsData = null; return loadStats();
    }
  });
  main.addEventListener('toggle', (e) => { if (e.target && e.target.id === 'connFold') connOpen = e.target.open; }, true);
  main.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'lbill') { e.preventDefault(); searchLogs(); }
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.bf) { e.preventDefault(); const t = tplOf(e.target); if (t) bulkCreate(t, e.target.closest('[data-tk]')); }
  });
  // 時刻の欄を離れたら: 文字を整えて（「1900」→「19:00」）、行の時刻なら時刻順に並べ直す
  main.addEventListener('focusout', (e) => {
    const el = e.target;
    if (tab !== 'timetable' || !tt || !el.dataset || !el.classList || !el.classList.contains('tm')) return;
    const t = tplOf(el); if (!t) return;
    { const v = normTime(el.value); if (v !== el.value) el.value = v; }
    if (el.dataset.rf !== 't') return;
    { const r = rowOf(t, el); if (r && r.t !== el.value) { r.t = el.value; ttTouched(); } }
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
        /* テレビと店舗 */
        case 'go-tv': return switchTab('tv');
        case 'cfg-reload': await reloadCfg(); render(); toast('最新の情報にしました'); return;
        case 'tvacct-new': return createTvAccount(b);
        case 'pair-set': return pairStart(b);
        case 'bk-set': return bkSet(b);
        case 'bk-all': return bkAll(b);
        case 'pair-stop': return pairStop();
        case 'pair-reload': pairData = null; { const box = $('pairBox'); if (box) box.outerHTML = viewPair(); } return loadPair();
        case 'tvkey-new': if (!confirm('テレビのリンクを作り直します（リンクが漏れたときに使います）。\n今のテレビは、新しいリンクで開き直すまで結果を受け取れなくなります。')) return; await api('tvKey', {}); await reloadCfg(); render(); toast('作り直しました。各店のテレビを新しいリンクで開き直してください'); return;
        case 'store-new': editStore = { isNew: true, id: '', name: '', pin: '', orig: {}, x: sset({ settings: {} }) }; window.scrollTo(0, 0); return render();
        case 'store-edit': { const s = cfg.stores.find((x) => x.id === b.dataset.id); if (!s) return; if (tab !== 'tv') { if (!leaveOk()) return; tab = 'tv'; markTab(); } editStore = { isNew: false, id: s.id, name: s.name, pin: s.pin, orig: s.settings, x: sset(s) }; window.scrollTo(0, 0); return render(); }
        case 'store-cancel': editStore = null; window.scrollTo(0, 0); return render();
        case 'store-save': b.disabled = true; try { return await saveStore(); } finally { b.disabled = false; }
        case 'store-del': return await deleteStore();
        case 'mode-add': { captureStore(); const last = editStore.x.modes[editStore.x.modes.length - 1]; editStore.x.modes.push({ k: nk(), from: last ? last.to : '18:00', to: '', mode: 'bet' }); keepScroll(() => { main.innerHTML = viewStoreEdit(); }); return validateStore(); }
        case 'mode-del': { captureStore(); editStore.x.modes = editStore.x.modes.filter((m) => m.k !== b.dataset.k); keepScroll(() => { main.innerHTML = viewStoreEdit(); }); return validateStore(); }
        case 'tvgame-set': return await quickTvGame(b);
        case 'tvq-set': return await quickTvQuality(b);
        case 'strip-preset': return await quickTvStrip(b.dataset.id, Object.assign({}, b.dataset.p === 'b' ? STRIP_B : STRIP_A));
        case 'sstrip-preset': { const o = b.dataset.p === 'b' ? STRIP_B : STRIP_A; STRIPS.forEach(([k]) => { const c = $('sstrip-' + k); if (c) c.checked = o[k]; }); paintStripEdit(); return validateStore(); }
        case 'copy': { const v = b.dataset.copy || ''; try { await navigator.clipboard.writeText(v); b.textContent = 'コピーしました'; setTimeout(() => { if (document.contains(b)) b.textContent = 'コピー'; }, 1500); } catch (err) { toast('コピーできませんでした。リンクを長押ししてコピーしてください'); } return; }
        case 'sg-q': { const sel = $('stvq'); if (!sel) return; sel.value = qOf({ tvQuality: b.dataset.v }); paintQSeg(); return validateStore(); }
        case 'sg-tv': { const sel = $('stvgame'); if (!sel) return; sel.value = b.dataset.v === 'derby' ? 'derby' : 'slot'; paintTvSeg(); return validateStore(); }
        case 'tv-reload': {
          const sid = b.dataset.store || ''; // 店ごとのボタン／「全店舗のテレビを読み込み直す」（空＝全店舗）
          if (!confirm((sid ? '「' + storeName(sid) + '」' : '全店舗') + 'のテレビを今すぐ読み込み直します。\nレース中でも途中から追いつきます。')) return;
          const rr = await api('reload', sid || undefined);
          toast((sid ? storeName(sid) : '全店舗') + 'のテレビに再読み込みを指示しました（いまつながっているテレビ ' + ((rr && rr.sent) || 0) + ' 台）'); return;
        }
        /* 時刻表 */
        case 'tpl-add': return addTpl(b.dataset.kind);
        case 'tpl-open': { const t = tplOf(b), box = b.closest('[data-tk]'); if (!t) return; const op = !tplOpen.has(t.id); if (op) tplOpen.add(t.id); else tplOpen.delete(t.id); box.classList.toggle('open', op); b.setAttribute('aria-expanded', String(op)); return; }
        case 'tpl-on': { const t = tplOf(b); t.enabled = !t.enabled; ttDirty = true; return ttRerender(); }
        case 'tpl-allstores': { const t = tplOf(b); t.storeId = null; t.scope = 'all'; ttDirty = true; return ttRerender(); }
        case 'tpl-up': case 'tpl-down': { const t = tplOf(b), i = tt.tpls.indexOf(t), j = i + (act === 'tpl-up' ? -1 : 1); if (j < 0 || j >= tt.tpls.length) return; tt.tpls.splice(i, 1); tt.tpls.splice(j, 0, t); ttDirty = true; return ttRerender(); }
        case 'tpl-dup': { const t = tplOf(b), c = JSON.parse(JSON.stringify(t)); c.k = nk(); c.id = 'tt' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); c.name = (t.name || tplName(t)) + ' のコピー'; c.rows.forEach((r) => { r.k = nk(); }); tplOpen.add(c.id); if (c.kind === 'date') c.date = addDays(isDate(t.date) ? t.date : todayStr(), 1); tt.tpls.splice(tt.tpls.indexOf(t) + 1, 0, c); ttDirty = true; return ttRerender(); }
        case 'tpl-del': { const t = tplOf(b); if (t.rows.length && !confirm('予定「' + tplName(t) + '」（' + t.rows.length + ' レース）を消します（保存するまでは元に戻せます）。')) return; tt.tpls.splice(tt.tpls.indexOf(t), 1); ttDirty = true; return ttRerender(); }
        case 'tpl-rows': { const t = tplOf(b); if (tplAll.has(t.id)) tplAll.delete(t.id); else tplAll.add(t.id); return ttRerender(); }
        case 'row-add': { const t = tplOf(b); tplAll.add(t.id); const last = t.rows[t.rows.length - 1], gap = Math.ceil(minGapSec().sec / 60); const m = last && !isNaN(toMin(last.t)) ? Math.min(TT_MAX, toMin(last.t) + Math.max(gap, 5)) : 19 * 60; t.rows.push({ k: nk(), t: fromMin(m), p: last ? last.p : '3000', s: null }); ttDirty = true; ttRerender(); const ins = main.querySelectorAll('[data-tk="' + t.k + '"] [data-rf="t"]'); if (ins.length) ins[ins.length - 1].focus(); return; } // 新しい行は全店
        case 'row-dup': { const t = tplOf(b), r = rowOf(t, b), gap = Math.ceil(minGapSec().sec / 60), m = toMin(r.t); const c = { k: nk(), t: isNaN(m) ? '' : fromMin(Math.min(TT_MAX, m + Math.max(gap, 5))), p: r.p, s: copyS(r.s) }; t.rows.splice(t.rows.indexOf(r) + 1, 0, c); ttDirty = true; return ttRerender(); }
        case 'row-all': { const t = tplOf(b), r = rowOf(t, b); if (!r) return; r.s = null; paintRowChips(b.closest('[data-rk]'), r); return ttTouched(); } // 「全店」: 店のチェックを全部 ON に
        case 'row-del': { const t = tplOf(b), r = rowOf(t, b); t.rows.splice(t.rows.indexOf(r), 1); ttDirty = true; return ttRerender(); }
        case 'row-sort': { const t = tplOf(b); sortRows(t); return ttRerender(); }
        case 'row-clear': { const t = tplOf(b); if (!confirm('「' + tplName(t) + '」の ' + t.rows.length + ' レースを全部消します（保存するまでは元に戻せます）。')) return; t.rows = []; ttDirty = true; return ttRerender(); }
        case 'row-payall': { const t = tplOf(b); const v = prompt('この予定の当選額の目標を全部この額にします（1〜' + ptT(PAY_MAX) + '）', t.rows[0] ? t.rows[0].p : '3000'); if (v == null) return; if (!/^\d+$/.test(v.trim()) || +v < 1 || +v > PAY_MAX) { toast('1〜' + fmtN(PAY_MAX) + ' の整数を入れてください'); return; } t.rows.forEach((r) => { r.p = v.trim(); }); ttDirty = true; return ttRerender(); }
        case 'bulk': { const t = tplOf(b); return bulkCreate(t, b.closest('[data-tk]')); }
        case 'tt-revert': if (ttDirty && !confirm('保存していない変更を捨てて、保存済みの時刻表に戻します。')) return; loadTT(); return ttRerender();
        case 'tt-save': b.disabled = true; try { return await saveTT(); } finally { if (document.contains(b)) paintTT(); }
        case 'pv-local': pvSrc = 'local'; keepScroll(() => { main.innerHTML = viewTT(); paintTT(); }); return;
        case 'pv-server': pvSrc = 'server'; keepScroll(() => { main.innerHTML = viewTT(); paintTT(); }); return loadServerPreview();
        /* 今日のレース */
        case 'memo': memoOn = !memoOn; return keepScroll(() => { main.innerHTML = viewRaces(); });
        case 'rq': raceDate = +b.dataset.n === 0 ? bizToday() : addDays(raceDate || bizToday(), +b.dataset.n); racesData = null; refundOpen = null; raceAll = false; return render();
        case 'races-reload': return loadRaces();
        case 'race-refund': refundOpen = refundOpen === b.dataset.id ? null : b.dataset.id; return keepScroll(() => { main.innerHTML = viewRaces(); }); // その場で開く／閉じる（画面は移らない）
        case 'race-all': raceAll = !raceAll; return keepScroll(() => { main.innerHTML = viewRaces(); });
        case 'refund': {
          const r = (racesData || []).find((x) => x.id === b.dataset.id); if (!r) return;
          if (!confirm('レース取消\n\n日時: ' + bizYmd(r.at).replace(/-/g, '/') + '(' + WD[wdOf(bizYmd(r.at))] + ') ' + bizHM(r.at) + ' に走ったレース' + (r.test ? '（テスト）' : '') + '\n参加: ' + fmtN(votesOf(r)) + ' 人\n取り消す当選額（まだ渡していない）: ' + ptT(r.unpaidTotal) + '\nもう渡した当選額: ' + ptT(r.claimedTotal) + '（そのまま。取り戻さない）\n\nまだ受け取っていない人は受け取れなくなります。記録には「取り消し」として残ります。\n元に戻せません。取り消しますか？')) return;
          b.disabled = true;
          const rf = await api('refund', r.id);
          toast('取り消しました（取り消した当選額 ' + ptT(rf && rf.voided != null ? rf.voided : r.unpaidTotal) + '）'); refundOpen = null; return loadRaces();
        }
        /* 調整 */
        case 'tpreset': { const p = TUNE_PRESETS.find((x) => x[0] === b.dataset.p); $('n-volatility').value = p[2].volatility; $('n-shiftUp').value = Math.round(p[2].shiftUp * 100); $('n-shiftDown').value = Math.round(p[2].shiftDown * 100); tunDirty = true; main.querySelectorAll('[data-act="tpreset"]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); return validateTuning(); }
        case 'hlook': return saveHorseLook(b.dataset.v);
        case 'tun-revert': tunDirty = false; return keepScroll(render);
        case 'tun-save': b.disabled = true; try { return await saveTuning(); } finally { if (document.contains(b)) validateTuning(); }
        case 'test-race': {
          const inSec = Number($('trin').value), payout = Number($('trpay').value), sid = $('trstore').value || null;
          if (!(inSec >= 10 && inSec <= 3600) || !(payout >= 1 && payout <= PAY_MAX)) { toast('数字の範囲を確かめてください（何秒後は 10〜3600）'); return; }
          b.disabled = true; // 2 度押しで同じ時刻のレースが 2 つできないように
          let r; try { r = await api('createRace', { inSec, voteSec: Math.min(TEST_VOTE_SEC, inSec), payout, scope: 'all', storeId: sid, test: true }); } finally { b.disabled = false; }
          const at = (r && (r.at || (r.race && r.race.at))) || now() + inSec * 1000;
          toast('テストレースを作りました（' + bizHM(at) + ' に走り出す・投票は ' + bizHM(at - Math.min(TEST_VOTE_SEC, inSec) * 1000) + ' から）'); racesData = null; return;
        }
        /* 集計 */
        case 'day-more': { const tr = b.closest('tr'); const op = !tr.classList.contains('open'); tr.classList.toggle('open', op); b.setAttribute('aria-expanded', String(op)); b.textContent = op ? '閉じる' : 'くわしく'; return; }
        case 'stq': { const r = quickRange(b.dataset.q); stFrom = r[0]; stTo = r[1]; logsData = null; return loadStats(); }
        case 'st-csv': {
          const days = statDays();
          const rows = [['日付', 'レース数', '票の数（参加人数）', '会計番号の数', '当選額の目標(pt)', '当選額(pt)', '渡した額(pt)', 'まだ渡していない額(pt)', '期限切れ(pt)']].concat(days.map((x) => [x.date, x.races, x.votes, x.players, stStore ? '' : x.target, x.paid, x.claimed, x.unclaimed, x.expired]));
          const bs = byStoreRows(); if (bs) { rows.push([]); rows.push(['店舗', '', '票の数（参加人数）', '会計番号の数', '', '当選額(pt)', '渡した額(pt)', 'まだ渡していない額(pt)', '期限切れ(pt)']); bs.forEach((x) => rows.push([storeName(x.storeId), '', x.votes, x.players, '', x.paid, x.claimed, x.unclaimed, x.expired])); }
          return download('casaDERBY_集計_' + (stStore ? storeName(stStore) + '_' : '') + stFrom + '_' + stTo + '.csv', rows);
        }
        case 'log-search': return await searchLogs();
        case 'log-csv': {
          const rows = [['日時', '店舗', '会計番号', 'ニックネーム', '種類', '組み合わせ', '額(pt)', 'レース']].concat(logsData.logs.map((x) => [ymd(x.at) + ' ' + hms(x.at), storeName(x.storeId), x.bill, x.nick || '', logKind(x)[0], comboTxt(x.combo), logAmt(x) == null ? '' : logAmt(x), x.raceId || '']));
          return download('casaDERBY_会計番号_' + (logBill || '全部') + '_' + stFrom + '_' + stTo + '.csv', rows);
        }
      }
    } catch (err) { toast('失敗しました: ' + errText(err)); }
  });

  const TAB_ALIAS = { stores: 'tv', ops: 'tuning' }; // 以前のタブの名前（テスト・メモ用）
  window.DerbyAdmin = { // テスト用の入口（tests/v2-admin.plan.js）
    get tt() { return tt; }, get cfg() { return cfg; }, get abuse() { return abuseData; }, get dirty() { return ttDirty; }, get tunDirty() { return tunDirty; }, get pair() { return pairData; }, get races() { return racesData; }, get stats() { return statsData; }, get tab() { return tab; }, loadPair, minGapSec: () => minGapSec().sec,
    validate: () => (tt ? validateTT() : null), templatesToRules: () => templatesToRules(tt.tpls), daySchedule: (d, s) => daySchedule(tt.tpls, d, s || null).map((x) => ({ t: x.t, p: x.p, store: x.group, stores: x.s })),
    bizHM, normTime, // 営業日の時計（25:00）と時刻の整え（テスト用）
    holidayName, isHoliday, // 祝日の判定（core.js。無ければ null / false。2026-10-27）
    go(name) { name = TAB_ALIAS[name] || name; const b = document.querySelector('#tabs [data-tab="' + name + '"]'); if (b) b.click(); return tab; },
  };
  start();
})();
