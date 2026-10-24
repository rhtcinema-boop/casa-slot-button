/* マスター画面: 店舗・プリセット・集計。オーナーだけがログインして、全店舗の設定を配る。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (v) => Number(v).toLocaleString('en-US');
  const fmtDate = (ts) => { if (!ts) return '—'; const d = new Date(ts), p = (n) => ('0' + n).slice(-2); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const main = $('main');
  let tab = 'stores', stores = [], presets = [], editStore = null, editPreset = null, statsStore = null, statsData = null;
  let meter = null; // b101: ハズレメーター（全店舗共有）の設定と今の状態
  let toastTimer = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }

  /* ---------- ログイン ---------- */
  async function start() {
    if (!Cloud.enabled) {
      main.innerHTML = '<div class="panel"><h3>クラウドが設定されていません</h3><p class="hint">cloud-config.js に Firebase の設定を入れると使えるようになります。</p></div>';
      return;
    }
    try { await Cloud.ready(); } catch (e) { main.innerHTML = '<div class="panel"><h3>接続できません</h3><p class="hint">' + esc(e.message) + '</p></div>'; return; }
    if (Cloud.masterUser()) return enter();
    main.innerHTML = '<div class="panel" id="login"><h3>ログイン</h3><p class="hint">オーナーのメールアドレスとパスワード（Firebase に登録したもの）</p>' +
      '<label class="f"><span>メールアドレス</span><input type="email" id="email" autocomplete="username"></label>' +
      '<label class="f"><span>パスワード</span><input type="password" id="pw" autocomplete="current-password"></label>' +
      '<div class="err" id="lerr"></div><div class="acts"><button class="btn" id="dologin">ログイン</button></div></div>';
    $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dologin').click(); }); // b99: Enter でログイン
    $('dologin').addEventListener('click', async () => {
      $('lerr').textContent = '';
      try { await Cloud.masterLogin($('email').value.trim(), $('pw').value); enter(); }
      catch (e) { $('lerr').textContent = 'ログインできませんでした。メールアドレスとパスワードを確認してください。'; }
    });
  }
  async function enter() {
    const u = Cloud.masterUser();
    $('who').textContent = u ? u.email : '';
    $('logout').style.display = '';
    $('tabs').style.display = '';
    await reload();
    render();
  }
  $('logout').addEventListener('click', async () => { await Cloud.masterLogout(); location.reload(); });
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; editStore = null; editPreset = null; document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    if (tab === 'stats' && !statsStore && stores.length) return loadStats(stores.length > 1 ? ALL : stores[0].id); // 2026-10-19 その 2: 集計を開いたら、すぐ全店舗の合計（直近31日）を出す（店舗を選ぶ手間をなくす）
    render(); });

  async function reload() {
    const st = await Cloud.listStores();
    stores = await Promise.all(st.map((s) => Cloud.getStore(s.id)));
    presets = (await Cloud.listPresets()).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    try { meter = await Cloud.getMeter(); } catch (e) { meter = null; } // b101
  }
  const presetName = (id) => { const p = presets.find((x) => x.id === id); return p ? p.name : '（未設定）'; };

  /* 2026-10-19 見やすく: めったに使わない設定と長い説明は「畳み」（開け閉めできる見出し）に入れる。
     畳みの中の入力欄も画面にはあるので、保存の読み取り（$('sbill') など）はこれまでどおり。
     開け閉めの状態は、同じ画面を描き直しても（ON/OFF・金額の追加など）そのまま残す。別の画面に移ったら閉じた状態に戻す */
  const folds = new Set(); let foldView = '';
  function fold(key, head, body, opt) {
    const o = opt || {}, open = folds.has(key) ? true : folds.has('!' + key) ? false : !!o.open;
    return '<details class="fold' + (o.cls ? ' ' + o.cls : '') + '" data-fold="' + key + '"' + (open ? ' open' : '') + '><summary>' + head + '</summary><div class="fbody">' + body + '</div></details>';
  }
  const more = (key, html) => fold(key, 'くわしい説明', '<div class="hint">' + html + '</div>', { cls: 'more' }); // 長い説明は畳む（文は消さない）
  main.addEventListener('toggle', (e) => { const d = e.target; if (!d || !d.dataset || !d.dataset.fold) return; const k = d.dataset.fold; folds.delete(k); folds.delete('!' + k); folds.add(d.open ? k : '!' + k); }, true);
  const onOff = (on) => '<span class="badge ' + (on ? 'ok' : '') + '">' + (on ? 'ON' : 'OFF') + '</span>';

  function render() {
    const view = tab + (editStore ? ':s' + (editStore.id || 'new') : '') + (editPreset ? ':p' + (editPreset.id || 'new') : '');
    if (view !== foldView) { folds.clear(); foldView = view; }
    if (tab === 'stores') { main.innerHTML = editStore ? viewStoreEdit() : viewStores(); if (!editStore && !latestVer) loadLatest(); }
    else if (tab === 'presets') main.innerHTML = editPreset ? viewPresetEdit() : viewPresets();
    else main.innerHTML = viewStats();
    main.classList.toggle('wide', tab === 'presets' && !!editPreset);
    if (window.DerbySwitchMaster) DerbySwitchMaster.mount(main, { tab, stores, edit: editStore }); // テレビのゲーム（casa SLOT / casa DERBY。js/derbyswitch-master.js）。一覧では最初の .panel（店舗の状態）のすぐ下、編集では「いま使うプリセット」のすぐ下に入る
    if (tab === 'stores' && !editStore) refreshVers();
  }

  /* ---------- 店舗 ---------- */
  // 使用中のプリセットに誤りがあると、端末はそれを受け付けず前の設定のまま動く（b71）。店舗の一覧でそれが分かるようにする
  /* 期間限定の当たりの設定（2026-10-24）: 店舗の presetTimed = { presetId, from, to, setAt }。from〜to の間だけ、お店の画面はこの設定で動き、
     終わると「いま使う当たりの設定」（activePresetId）に自動で戻る（activePresetId は書き換えない）。js/game.js の effPid と同じ判定 */
  const timedOf = (s) => { const t = s && s.presetTimed; return t && t.presetId && Number(t.from) > 0 && Number(t.to) > Number(t.from) ? t : null; };
  function timedNote(s) {
    const t = timedOf(s), n = Date.now();
    if (!t || n >= t.to) return '';
    return '<div class="swarn" style="border-color:rgba(201,160,62,.6);color:#ffe9a8;background:rgba(201,160,62,.08)">⏱ ' + (n >= t.from
      ? '期間限定で「' + esc(presetName(t.presetId)) + '」を使っています（' + fmtDate(t.to) + ' まで。終わると「' + esc(presetName(s.activePresetId)) + '」に戻ります）'
      : fmtDate(t.from) + '〜' + fmtDate(t.to) + ' は期間限定で「' + esc(presetName(t.presetId)) + '」') + '</div>';
  }
  const dtl = (ms) => { if (!ms) return ''; const d = new Date(ms), p = (n) => ('0' + n).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }; // input type="datetime-local" の値（端末の時刻）

  /* 公開期間（2026-10-24）: pub = { kind, date, days, from, to }。now の時点で公開中なら true。pub が無ければいつも公開 */
  function pubOpen(pub, now) {
    if (!pub || !pub.kind) return true;
    const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    const f = hm(pub.from), t = hm(pub.to);
    if (f == null || t == null) return false;
    const d = new Date(now || Date.now()), cur = d.getHours() * 60 + d.getMinutes();
    const ymd = (x) => x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2);
    const dayOk = (x) => pub.kind === 'daily' ? true : pub.kind === 'date' ? ymd(x) === pub.date : pub.kind === 'weekly' ? (pub.days || []).map(Number).indexOf(x.getDay()) >= 0 : false;
    if (t > f) return dayOk(d) && cur >= f && cur < t; // 同じ日の中
    // 日をまたぐ（例 21:00〜02:00）: 今日の from から、または前の日の from から続いている
    if (cur >= f) return dayOk(d);
    const y = new Date(d.getTime() - 86400000);
    return cur < t && dayOk(y);
  }
  function pubText(pub) {
    if (!pub || !pub.kind) return '';
    const W = ['日', '月', '火', '水', '木', '金', '土'];
    const when = pub.kind === 'date' ? String(pub.date || '').replace(/^\d{4}-/, '').replace('-', '/') + ' だけ' : pub.kind === 'daily' ? '毎日' : '毎週 ' + (pub.days || []).map((x) => W[Number(x)] || '').join('');
    return when + ' ' + (pub.from || '') + '〜' + (pub.to || '');
  }
  const pubOf = (s, pid) => (s && s.presetPub && s.presetPub[pid]) || null;
  const pubNote = (s) => { const live = (s.presetIds || []).filter((id) => pubOf(s, id)); return live.length ? '<div class="smeta sm"><span style="color:#ffe9a8">⏱ 期間限定で選べる: ' + live.map((id) => esc(presetName(id)) + '（' + esc(pubText(pubOf(s, id))) + (pubOpen(pubOf(s, id)) ? '・いま公開中' : '') + '）').join('・') + '</span></div>' : ''; };
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  function pubRow(s, p) { // チェックの下に出す公開期間の入力
    const pub = pubOf(s, p.id) || {}, k = pub.kind || '', id = esc(p.id), today = (function () { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); })();
    return '<div class="pub" data-pub="' + id + '">' +
      '<select data-pk="' + id + '"><option value=""' + (!k ? ' selected' : '') + '>いつでも</option><option value="date"' + (k === 'date' ? ' selected' : '') + '>この日だけ</option><option value="daily"' + (k === 'daily' ? ' selected' : '') + '>毎日</option><option value="weekly"' + (k === 'weekly' ? ' selected' : '') + '>毎週</option></select>' +
      '<span class="pubx" data-px="' + id + '"' + (k ? '' : ' hidden') + '>' +
      '<input type="date" data-pd="' + id + '" value="' + esc(pub.date || today) + '"' + (k === 'date' ? '' : ' hidden') + '>' +
      '<span class="wd" data-pw="' + id + '"' + (k === 'weekly' ? '' : ' hidden') + '>' + WD.map((w, i) => '<label><input type="checkbox" data-pwd="' + id + '" value="' + i + '"' + ((pub.days || []).map(Number).indexOf(i) >= 0 ? ' checked' : '') + '>' + w + '</label>').join('') + '</span>' +
      '<input type="time" data-pf="' + id + '" value="' + esc(pub.from || '19:00') + '"><span class="tilde">〜</span><input type="time" data-pt="' + id + '" value="' + esc(pub.to || '23:00') + '">' +
      '</span></div>';
  }
  function storeWarn(s) {
    const p = presets.find((x) => x.id === s.activePresetId);
    return p && !Engine.validateProbs(p.probs).ok ? '<div class="swarn">⚠ この当たりの設定に誤りがあり、お店では前の設定のまま動いています</div>' : '';
  }
  /* 店舗の状態（2026-10-19）: 端末は 10 分ごとに lastSeen・deviceVersion を書く（game.js の生存報告）。today.js・bill.js と同じく 25 分以内なら「動いています」
     2026-10-19 その 2: 言葉を店長向けに（版・最終連絡・端末 → 最新／古いまま・何分前・お店の画面）。版の番号は画面に出さず、押さえておく所（title）にだけ残す */
  const ALIVE_MS = 25 * 60 * 1000;
  const ago = (ts) => { const m = Math.floor((Date.now() - ts) / 60000); if (m < 1) return 'たった今'; if (m < 60) return m + '分前'; const h = Math.floor(m / 60); return h < 24 ? h + '時間前' : Math.floor(h / 24) + '日前'; };
  const aliveOf = (s) => (!s.lastSeen ? 'none' : Date.now() - s.lastSeen < ALIVE_MS ? 'ok' : 'warn');
  const aliveBadge = (s) => { const a = aliveOf(s), t = s.lastSeen ? fmtDate(s.lastSeen) : '';
    return a === 'none' ? '<span class="badge">● まだ使われていません</span>'
      : a === 'ok' ? '<span class="badge ok" title="最後の連絡 ' + t + '">● 動いています</span><span class="ago">' + ago(s.lastSeen) + 'に確認</span>'
      : '<span class="badge warn" title="最後の連絡 ' + t + '">● つながっていません</span><span class="ago">' + ago(s.lastSeen) + 'から</span>'; };
  const vnum = (v) => (/^b\d+$/.test(v || '') ? Number(v.slice(1)) : 0);
  const isOld = (v) => !!(v && vnum(latestVer) && vnum(v) < vnum(latestVer));
  function verInfo(v) { // お店の画面が最新かどうかのバッジ（最新の版を読み込めたら、最新／古いままを色で分ける）
    if (!v) return { cls: 'none', txt: '' };
    if (vnum(latestVer) && vnum(v) >= vnum(latestVer)) return { cls: 'ok', txt: '✓ 最新' };
    if (isOld(v)) return { cls: 'warn', txt: '↻ 更新が必要' };
    return { cls: 'none', txt: '' };
  }
  const verBadge = (v) => { const i = verInfo(v); return '<span class="badge ' + i.cls + '" data-ver="' + esc(v || '') + '" title="' + esc(v || '') + '">' + esc(i.txt) + '</span>'; };
  function refreshVers() { // 最新の版を読み込んだあとに、描き直さずにバッジだけ直す（テレビの切り替えの入力欄を消さないため）
    main.querySelectorAll('[data-ver]').forEach((el) => { const i = verInfo(el.dataset.ver); el.className = 'badge ' + i.cls; el.textContent = i.txt; });
    const n = stores.filter((s) => isOld(s.deviceVersion)).length, el = $('oldNote'), box = $('updBox');
    const off = stores.filter((s) => isOld(s.deviceVersion) && aliveOf(s) !== 'ok').length; // game.js: 端末は updateAt の変化を見ている → つながっていない店は、つながったときに切り替わる
    if (el) el.innerHTML = n ? '更新が必要なお店が <b>' + n + ' 店</b>あります' + (off ? '<small>つながっていないお店は、つながったら更新されます</small>' : '') : vnum(latestVer) && stores.some((s) => s.deviceVersion) ? '✓ どのお店の画面も最新です' : '';
    if (box) box.className = 'updbox ' + (n ? 'warn' : 'ok');
  }
  const presetColor = (id) => { const p = presets.find((x) => x.id === id); return p ? (p.color || PRESET_COLORS[0][0]) : 'transparent'; };
  /* b101: ハズレメーター（全店舗共有）。全店舗のハズレが target 回溜まると、全店舗合計 superPlays 回のスーパーモード（superPresetId のプリセットで抽選＋派手な演出） */
  function viewMeter() {
    const m = meter || { enabled: false, target: 300, superPlays: 10, superPresetId: null, miss: 0, superLeft: 0 };
    const opts = '<option value="">（切り替えない。演出だけ）</option>' + presets.filter((p) => !p.test || p.id === m.superPresetId).map((p) => '<option value="' + esc(p.id) + '"' + (p.id === m.superPresetId ? ' selected' : '') + '>' + esc(p.name) + (p.test ? '（テスト用・使えません）' : '') + '</option>').join('');
    const head = '<h3>ハズレが貯まるとボーナスタイム<small>スーパーメーター・全店共通</small></h3><span class="fsum">' + onOff(m.enabled) + ' ハズレ ' + (m.miss || 0) + ' / ' + (m.target || 300) + '・いまは' + (m.superLeft > 0 ? 'ボーナスタイム中（残り ' + m.superLeft + ' 回）' : 'ふつう') + '</span>';
    return fold('meter', head,
      '<p class="hint">全店のハズレが決めた回数に達すると、決めた回数だけ「ボーナスタイム（スーパーモード）」になります。</p>' +
      more('meter-help', 'その間は選んだ当たりの設定で抽選し、画面が派手になります。お客さんにはメーターの溜まり具合だけ見え、数字は出ません。') +
      '<label class="check"><input type="checkbox" id="mon" ' + (m.enabled ? 'checked' : '') + '> スーパーメーターを使う</label>' +
      '<div class="cols"><label class="f"><span>何回ハズレたら始まるか（全店の合計）</span><input type="number" id="mtarget" min="10" max="100000" value="' + (m.target || 300) + '"></label>' +
      '<label class="f"><span>ボーナスタイムの回数（全店の合計）</span><input type="number" id="mplays" min="1" max="1000" value="' + (m.superPlays || 10) + '"></label>' +
      '<label class="f"><span>ボーナスタイム中の当たりの設定</span><select id="mpreset">' + opts + '</select></label></div>' +
      '<p class="hint">いま: ハズレ <b style="color:var(--text)">' + (m.miss || 0) + ' / ' + (m.target || 300) + '</b>　ボーナスタイム: <b style="color:var(--text)">' + (m.superLeft > 0 ? '残り ' + m.superLeft + ' 回' : 'なし') + '</b></p>' +
      '<div class="acts"><button class="btn ghost" data-act="meter-reset">ハズレを 0 に戻す</button><button class="btn ghost" data-act="meter-start">いますぐボーナスタイムにする</button><button class="btn" data-act="meter-save">保存</button></div>', { cls: 'panel' });
  }
  /* 店舗のタブ（2026-10-19 並べ替え）: ①店舗の状態（＋全店舗のアップデート）→ ②テレビのゲーム（js/derbyswitch-master.js が ① のすぐ下に入れる）→ ③スーパーメーター（畳み） */
  /* お店のタブ（2026-10-19 その 2）: 見出しを「やりたいこと」の言葉に。
     ①お店のようす（動いているか・最新か・いまの当たりの設定。当たりの設定はその場で変えられる）＋「お店の画面を最新にする」
     ②テレビに映すゲーム（js/derbyswitch-master.js が ① のすぐ下に入れる）③お店を追加 ④スーパーメーター（畳み） */
  function presetSelect(s) { // お店の一覧から、その場で当たりの設定を変える（保存の中身は店舗の編集の「いま使うプリセット」と同じ: activePresetId と、足りなければ presetIds に足す）
    return '<label class="qpre"><span>当たり</span><select data-qid="' + esc(s.id) + '" aria-label="' + esc(s.name) + ' の当たりの設定"><option value="">（未設定）</option>' +
      presets.map((p) => '<option value="' + esc(p.id) + '"' + (s.activePresetId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label><button class="btn sm" data-act="qpre-save" data-id="' + esc(s.id) + '" hidden>変更する</button><small class="qnote" hidden>まだ保存していません</small>';
  }
  function viewStores() {
    const nOk = stores.filter((s) => aliveOf(s) === 'ok').length, nWarn = stores.filter((s) => aliveOf(s) === 'warn').length, nNone = stores.length - nOk - nWarn;
    return '<div class="panel" id="storesPanel"><div class="phead"><h3>お店のようす</h3><span class="fsum">全 ' + stores.length + ' 店' + (stores.length ? '：動いている ' + nOk + (nWarn ? '・つながっていない ' + nWarn : '') + (nNone ? '・未使用 ' + nNone : '') : '') + '</span></div>' +
      (stores.length ? '<div class="slist">' + stores.map((s) => '<div class="scard"><div class="sinfo"><div class="sname"><span>' + esc(s.name) + '</span>' + verBadge(s.deviceVersion) + '</div>' +
        '<div class="smeta">' + aliveBadge(s) + '</div><div data-warn="' + esc(s.id) + '">' + storeWarn(s) + timedNote(s) + pubNote(s) + '</div></div>' +
        '<div class="sctl">' + presetSelect(s) + '<button class="btn sm ghost sedit" data-act="store-edit" data-id="' + esc(s.id) + '">お店の設定</button></div></div>').join('') + '</div>' : '<div class="empty">まだお店がありません</div>') +
      '<div class="updbox" id="updBox"><div class="oldnote" id="oldNote"></div><button class="btn" data-act="update-all"' + (stores.length ? '' : ' disabled') + '>全 ' + stores.length + ' 店の画面を最新にする</button></div>' +
      '<div class="acts start"><button class="btn ghost" data-act="store-new">＋ お店を追加</button><button class="btn ghost" data-act="stores-reload">読み直す</button></div>' +
      more('stores-help', '「● 動いています」は、お店の画面から 25 分以内に連絡があるお店です（10 分ごとに連絡が来ます）。<br>お店の画面は、ふだんは 1 時間以内に自動で最新になります。すぐに最新にしたいときは「お店の画面を最新にする」を押してください（ゲーム中の画面は、そのゲームが終わり次第）。とても古い画面（b61 より前）には届かないので、1 時間以内の自動の切り替えを待ってください。<br>お店ごとにパスワードと、選べる当たりの設定を決めます。お店の画面は、最初にお店を選んでパスワードを入れます。') + '</div>' +
      viewMeter();
  }
  // いま公開されている最新版（version.json）
  let latestVer = '', stale = false;
  // このマスター画面の版（読み込んだ master.js の ?v=）。開きっぱなしの画面は古いコードのまま動くので、公開されている版と見比べて、古ければ保存させない
  const MY_VER = (((document.querySelector('script[src*="js/master.js"]') || {}).src || '').match(/[?&]v=(b\d+)/) || [])[1] || '';
  async function loadLatest() {
    try { const man = await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json(); latestVer = (man && man.v) || ''; } catch (e) { latestVer = '（確認できません）'; }
    const el = $('latestVer'); if (el) el.textContent = latestVer;
    refreshVers(); // 各店舗の版のバッジ（最新／古い版）
    stale = !!(MY_VER && /^b\d+$/.test(latestVer) && Number(latestVer.slice(1)) > Number(MY_VER.slice(1))); // 公開のほうが新しいときだけ（公開の途中で version.json が一瞬古いことがあるので、「違う」ではなく「新しい」で見る）
    let bar = document.getElementById('stalebar');
    if (stale && !bar) { bar = document.createElement('div'); bar.id = 'stalebar'; bar.style.cssText = 'position:sticky;top:0;z-index:50;background:#5a1f1f;color:#fff;padding:10px 16px;font-size:14px;display:flex;gap:12px;align-items:center;justify-content:center'; document.body.insertBefore(bar, document.body.firstChild); }
    if (bar) { if (stale) bar.innerHTML = '⚠ このマスター画面は古い版（' + esc(MY_VER) + '）です。最新は ' + esc(latestVer) + '。読み直すまで保存はできません。 <button class="btn sm" onclick="location.reload()">読み直す</button>'; else bar.remove(); }
  }
  setInterval(loadLatest, 10 * 60 * 1000); // 開きっぱなしでも 10 分ごとに確かめる
  setTimeout(loadLatest, 1500);
  const staleMsg = () => (stale ? 'このマスター画面は古い版です。画面を読み直してから保存してください。' : '');
  function viewStoreEdit() {
    const s = editStore, notesN = (s.notes || []).filter(Boolean).length, nPre = (s.presetIds || []).length;
    const pinField = '<label class="f"><span>お店のパスワード（4〜8桁の数字）' + (s.id ? '（変えないときは空のまま）' : '') + '</span><input type="text" id="spin" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="' + (s.id ? '変更する場合だけ入力' : '例: 2580') + '"></label>';
    const chk = (id, on, label, help, key) => '<div class="opt"><label class="check"><input type="checkbox" id="' + id + '" ' + (on ? 'checked' : '') + '> ' + label + '</label>' + more(key, help) + '</div>';
    /* 並び（2026-10-19）: 店舗名 → 使えるプリセット → いま使うプリセット（＋テレビのゲーム。js/derbyswitch-master.js が「いま使うプリセット」のすぐ下に入れる）→ 遊び方と飾り（畳み）→ 待機中の説明（畳み）→ めったに使わない操作（畳み）。保存・戻るは画面の下に固定 */
    /* 並び（2026-10-19 その 2）: お店の名前 → いま使う当たりの設定（＋そのお店のテレビ。js/derbyswitch-master.js が #sactive の label のすぐ下に入れる）→ お店の画面で選べる当たりの設定 → 畳み 3 つ */
    return '<div class="panel"><h3>' + (s.id ? esc(s.name || '') + ' の設定' : 'お店を追加') + '</h3>' +
      '<label class="f"><span>お店の名前</span><input type="text" id="sname" value="' + esc(s.name || '') + '" maxlength="30"></label>' +
      (s.id ? '' : pinField) + // 新しい店舗はパスワードが必須なので上に出す
      '<label class="f"><span>いま使う当たりの設定<small class="lsub">このお店に設定されているもの</small></span><select id="sactive"><option value="">（未設定）</option>' + presets.map((p) => '<option value="' + esc(p.id) + '" ' + (s.activePresetId === p.id ? 'selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
      '<div class="sub"><h4>お店の画面で選べる当たりの設定<small>お店の人が画面で切り替えられるもの。いま使う設定は自動で含まれます。チェックした設定ごとに「公開する期間」を決められます（期間の外は選べません）</small></h4>' + (presets.length ? presets.map((p) => '<label class="check"><input type="checkbox" data-pid="' + esc(p.id) + '" ' + ((s.presetIds || []).indexOf(p.id) >= 0 ? 'checked' : '') + '> <i class="pdot" style="background:' + esc(p.color || PRESET_COLORS[0][0]) + '"></i>' + esc(p.name) + ' <span class="chip">平均 ' + fmtN(Math.round(Engine.probStats(p.probs).ev)) + '</span></label>' + pubRow(s, p)).join('') : '<div class="empty">先に「当たりの設定」のタブで作ってください</div>') + '</div>' +
      (function () { // 期間限定の当たりの設定（2026-10-24）
        const t = timedOf(s), n = Date.now(), live = t && n < t.to;
        return '<div class="sub"><h4>期間限定の当たりの設定<small>決めた期間だけ、この設定で動きます。終わると「いま使う当たりの設定」に自動で戻ります</small></h4>' +
          '<label class="f"><span>期間中に使う当たりの設定</span><select id="stimed"><option value="">（使わない）</option>' + presets.map((p) => '<option value="' + esc(p.id) + '"' + (live && t.presetId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
          '<div class="cols"><label class="f"><span>始まり</span><input type="datetime-local" id="stfrom" value="' + (live ? dtl(t.from) : '') + '"></label>' +
          '<label class="f"><span>終わり</span><input type="datetime-local" id="stto" value="' + (live ? dtl(t.to) : '') + '"></label></div>' +
          '<p class="hint">' + (live ? (n >= t.from ? 'いま期間中です。' : 'まだ始まっていません。') + '「（使わない）」にして保存すると、すぐ取り消せます。' : '終わった期間は自動で消えます。始まりを今より前にすると、保存してすぐ切り替わります（ゲームの途中なら、終わってから）。') + '</p></div>';
      })() +
      fold('st-play', '<h4>遊び方と飾り</h4><span class="fsum" id="playSum">' + playSum(s.billMode, s.doors, s.halloween) + '</span>',
        chk('sbill', s.billMode, 'スマホの紙幣でゲームを始める（紙幣モード）', 'ON にすると、この店舗の画面から NEXT GAME ボタンが消え、スタッフのスマホの紙幣ページ（公開 URL の bill.html）で紙幣をスライドしたときだけゲームが始まります。スマホが使えないときは、テレビはリモコンの決定を 2 秒長押し、iPad は左上のロゴを 2 秒長押しで始められます。', 'h-bill') +
        chk('sdoor', s.doors, '3つの扉を出す', '当たりの回の 5 回に 1 回くらい、最後にリールの代わりに扉が 3 つ出ます。スタッフのスマホ（またはリモコンの左右と決定）で扉を選ぶと、その回の当たり金額が出ます。見せ方が変わるだけで、当たりの確率と金額は変わりません。「スマホの紙幣で始める」が ON の店舗だけで動きます。', 'h-door') +
        chk('shw', s.halloween, 'ハロウィンの飾り', 'この店舗の画面の光がオレンジと紫になり、四隅に薄いクモの巣、ロゴの横にかぼちゃが出ます。リールや文字は変わりません。', 'h-hw'), { cls: 'sub' }) +
      fold('st-notes', '<h4>待っている間に出すお知らせ</h4><span class="fsum">' + (notesN ? notesN + ' つ入力済み' : 'なし') + '</span>',
        '<p class="hint">ゲームをしていない間、画面の左に出ます。3つまで。</p>' +
        more('h-notes', 'リールが回っていない待機中だけ、この店舗の画面の左（STAGE 1〜3 の場所）に出ます。<b style="color:var(--text)">入力した数だけ枠が分かれます</b>（1つなら大きく1枠、2つなら2分割、3つなら3分割）。ゲームが始まるとステージの表示に戻り、待機画面に戻るたびに、また説明が出ます。全部空にすると、今までどおりステージが出ます。文字は枠に収まる大きさに自動で調整されます（1枠 80 文字まで。改行もできます）。') +
        [0, 1, 2].map((i) => '<label class="f"><span>説明 ' + (i + 1) + '</span><textarea id="snote' + i + '" rows="2" maxlength="80">' + esc((s.notes || [])[i] || '') + '</textarea></label>').join(''), { cls: 'sub' }) +
      (s.id ? fold('st-rare', '<h4>めったに使わない操作</h4><span class="fsum">パスワードの変更・ログアウト・削除</span>',
        pinField +
        '<div class="rare"><div><b>お店の画面をログアウトさせる</b><small>次に起動したとき、お店の選び直しとパスワードが必要になります</small></div><button class="btn ghost" data-act="store-logout">強制ログアウト</button></div>' +
        '<div class="rare"><div><b>このお店を削除</b><small>お店の画面はログアウトされます。過去の集計の記録は残ります</small></div><button class="btn danger" data-act="store-del">削除</button></div>', { cls: 'sub' }) : '') +
      '</div>' +
      '<div class="savebar"><div class="msg"><div class="err" id="serr"></div></div><button class="btn ghost" data-act="store-cancel">戻る</button><button class="btn" data-act="store-save">保存</button></div>';
  }
  const playSum = (bill, door, hw) => [['紙幣', bill], ['3つの扉', door], ['ハロウィン', hw]].map((x) => '<span class="nw">' + x[0] + ' ' + onOff(x[1]) + '</span>').join(' '); // 名前と ON/OFF の間で改行しない
  async function saveStore() {
    const s = editStore, name = $('sname').value.trim(), pin = $('spin').value.trim();
    const err = $('serr'); err.textContent = '';
    if (!name) { err.textContent = '店舗名を入力してください。'; return; }
    if ((!s.id || pin) && !/^\d{4,8}$/.test(pin)) { err.textContent = 'パスワードは4〜8桁の数字にしてください。'; return; }
    if (staleMsg()) { err.textContent = staleMsg(); return; }
    const presetIds = Array.from(document.querySelectorAll('[data-pid]:checked')).map((x) => x.dataset.pid);
    let active = $('sactive').value;
    if (s.id && active === (s.activePresetId || '')) { // b99: フォームを開いている間に端末・スマホが使用中プリセットを変えていたら、それを上書きしない
      try { const fresh = await Cloud.getStore(s.id); if (fresh && (fresh.activePresetId || '') !== (s.activePresetId || '')) active = fresh.activePresetId || ''; } catch (e) { /* 取れなければフォームの値 */ }
    }
    const presetPub = {}; // 公開期間（2026-10-24）
    { let bad = '';
      presetIds.forEach((pid) => {
        const kSel = document.querySelector('[data-pk="' + pid + '"]'); if (!kSel || !kSel.value) return;
        const kind = kSel.value, from = (document.querySelector('[data-pf="' + pid + '"]') || {}).value || '', to = (document.querySelector('[data-pt="' + pid + '"]') || {}).value || '';
        if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) { bad = '「' + presetName(pid) + '」の公開する時間を入れてください。'; return; }
        if (from === to) { bad = '「' + presetName(pid) + '」の公開する時間の始まりと終わりが同じです。'; return; }
        const pub = { kind, from, to };
        if (kind === 'date') { const dv = (document.querySelector('[data-pd="' + pid + '"]') || {}).value || ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(dv)) { bad = '「' + presetName(pid) + '」の日付を入れてください。'; return; } pub.date = dv; }
        if (kind === 'weekly') { const days = Array.from(document.querySelectorAll('[data-pwd="' + pid + '"]:checked')).map((x) => Number(x.value)); if (!days.length) { bad = '「' + presetName(pid) + '」の曜日を 1 つ以上選んでください。'; return; } pub.days = days; }
        presetPub[pid] = pub;
      });
      if (bad) { err.textContent = bad; return; } }
    if (active && presetIds.indexOf(active) < 0) presetIds.push(active);
    const notes = [0, 1, 2].map((i) => $('snote' + i).value.trim().slice(0, 80)).filter(Boolean); // 待機中に左側に出す説明（入力されたものだけ）
    let presetTimed = null; // 期間限定の当たりの設定（2026-10-24）
    { const tp = $('stimed') ? $('stimed').value : '';
      if (tp) {
        const from = Date.parse($('stfrom').value), to = Date.parse($('stto').value);
        if (!Number.isFinite(from) || !Number.isFinite(to)) { err.textContent = '期間限定の当たりの設定の「始まり」と「終わり」を入れてください。'; return; }
        if (to <= from) { err.textContent = '期間限定の「終わり」は「始まり」より後にしてください。'; return; }
        if (to <= Date.now()) { err.textContent = '期間限定の「終わり」がもう過ぎています。'; return; }
        presetTimed = { presetId: tp, from, to, setAt: Date.now() };
      } }
    const data = { name, presetIds, activePresetId: active || null, presetTimed, presetPub, notes, billMode: !!($('sbill') && $('sbill').checked), halloween: !!($('shw') && $('shw').checked), doors: !!($('sdoor') && $('sdoor').checked) }; // b83: スマホの紙幣で始めるか / b98: ハロウィン / b110: 3つの扉
    if (pin) data.pin = Engine.makePin(pin);
    try { await Cloud.saveStore(s.id || null, data); }
    catch (e) { err.textContent = '保存できませんでした。通信を確認して、もう一度押してください。'; throw e; }
    toast((name || 'お店') + ' を保存しました');
    editStore = null; await reload(); render();
  }

  /* ---------- プリセット ---------- */
  const PKEYS = (d) => Engine.probKeys(d);
  const probLabel = (k) => (k === 'NEXT' ? 'NEXT STAGE' : fmtN(+k));
  const pct = (x) => (Math.round(x * 1000000) / 10000) + '%';
  const FREE_DEFAULT = 8; // FREE SPIN ×1 が出る割合の初期値（%）
  const FREE_KEYS = ['freeRate', 'freeRate2', 'freeRate3'], FREE_DEFAULTS = [8, 3, 1], FREE_MAX = [50, 25, 25]; // ×1 / ×2 / ×3
  const freeN = (p, n) => (typeof p[FREE_KEYS[n - 1]] === 'number' ? p[FREE_KEYS[n - 1]] : FREE_DEFAULTS[n - 1]);
  const freeOf = (p) => freeN(p, 1);
  const r2 = (x) => Math.round(x * 100) / 100;
  // casa ロゴ3つ = 10 FREE SPIN が出る割合。初期値は 0（出ない）。b66 から、この 10 回も当たりなしの回（予算は変わらない）
  const LOGO_SPINS = 10, LOGO_MAX = 5;
  const logoOf = (p) => (typeof p.logoRate === 'number' ? p.logoRate : 0);
  const noRetrig = (p) => p.noRetrigger !== false; // FREE SPIN で回っているゲームでは FREE SPIN を出さない（未設定は ON）
  // casa ロゴの 10 FREE SPIN も FREE SPIN ×1〜×3 も、当たりなしの回なので、予算には入らない。ここでは、ロゴがそろう頻度の目安だけを出す。
  // ロゴの抽選はスピンごとなので（1プレイで STAGE 2・3 に進むと回数が増える）、有料プレイ1回あたりは 平均スピン数 を掛ける
  function creditCost(p) {
    const st = Engine.probStats(p.probs);
    const r = (logoOf(p) / 100) * (1 + st.reach[2] + st.reach[3]);
    if (r <= 0) return '<span class="okmsg">オフ（casa ロゴはリールに出ません）</span>';
    return '<span class="okmsg">予算は変わりません（この 10 回は当たりが出ません）。ロゴがそろうのは平均 ' + fmtN(Math.round(1 / r)) + ' プレイに1回です。</span>';
  }
  const refreshCost = () => { main.querySelectorAll('.ccost').forEach((el) => { el.innerHTML = creditCost(editPreset); }); };
  // 開始直後の高額制限（最初の X 回は Y 以上を出さない）。Y は実際に出る金額の中から選ぶ
  const amountsOf = (p) => { const a = []; Engine.tableOf(p.probs).forEach((d) => d.values.forEach((v) => { if (v > 0 && a.indexOf(v) < 0) a.push(v); })); return a.sort((x, y) => x - y); };
  const EARLY_DEFAULT = { on: false, plays: 10, min: 2000 };
  // 端末に出すプリセット名の色（先頭が初期値）
  const PRESET_COLORS = [['#e2ba5c', '金'], ['#f2f2f2', '白'], ['#ff5a4d', '赤'], ['#ff9f43', 'オレンジ'], ['#3ddc84', '緑'], ['#4fc3ff', '水色'], ['#b388ff', '紫'], ['#ff7ac8', 'ピンク']];
  const earlyOf = (L) => Object.assign({}, EARLY_DEFAULT, (L && L.early) || {});
  /* 畳んだ見出しに出す今の値（ON/OFF → 大事な数字 → 補足 の順） */
  function presetSums(p) {
    const L = p.limits || {}, E = earlyOf(L), lg = logoOf(p);
    return {
      free: '×1 ' + freeN(p, 1) + '%・×2 ' + freeN(p, 2) + '%・×3 ' + freeN(p, 3) + '%',
      logo: (lg > 0 ? lg.toFixed(1) + '%' : 'オフ（0%）') + '・FREE SPIN 中は出さない ' + onOff(noRetrig(p)),
      lim: onOff(L.on) + (L.on ? ' ' + (L.total ? L.total + '本まで' : '本数は無制限') + (Object.keys(L.max || {}).length ? '・金額ごとの上限あり' : '') : '') + '・' + L.resetHour + ':00 リセット',
      early: onOff(E.on) + (E.on ? ' 最初の ' + E.plays + ' 回は ' + fmtN(E.min) + ' 以上なし' : ''),
    };
  }
  const updatePresetSums = () => { if (!editPreset) return; const S = presetSums(editPreset); main.querySelectorAll('[data-psum]').forEach((el) => { el.innerHTML = S[el.dataset.psum]; }); };
  function viewPresets() {
    const used = (id) => stores.filter((s) => s.activePresetId === id).map((s) => s.name); // いま使っている店舗（見るだけ）
    return '<div class="panel"><h3>当たりの設定<small>お店ごとに選ぶ、当たりの金額と確率のセット</small></h3>' +
      (presets.length ? '<div class="slist">' + presets.map((p) => { const st = Engine.probStats(p.probs), u = used(p.id); return '<div class="scard"><div class="sinfo"><div class="sname"><span><i class="pdot" style="background:' + esc(p.color || PRESET_COLORS[0][0]) + '"></i>' + esc(p.name) + '</span>' + (p.test ? '<span class="badge warn">テスト用（集計しない）</span>' : '') + (Engine.validateProbs(p.probs).ok ? '' : '<span class="badge ng">⚠ 設定に誤り</span>') + '</div>' +
        '<div class="smeta"><span>当たる確率 <b>' + pct(st.win) + '</b></span><span title="1プレイあたりの平均（ハズレも含む）">平均当たり額 <b>' + fmtN(Math.round(st.ev)) + '</b></span>' + (u.length ? '<span>使っているお店: <b>' + esc(u.join('・')) + '</b></span>' : '<span>使っているお店: なし</span>') + '</div>' +
        '<div class="smeta sm">' + [p.limits && p.limits.on ? '1日 ' + (p.limits.total || '—') + '本まで' : '', earlyOf(p.limits).on ? 'その日の最初の ' + earlyOf(p.limits).plays + ' 回は ' + fmtN(earlyOf(p.limits).min) + ' 未満' : ''].filter(Boolean).map((x) => '<span>' + x + '</span>').join('') + '</div>' +
        (Engine.validateProbs(p.probs).ok ? '' : '<div class="swarn">⚠ 設定に誤りがあり、お店では使えません。「金額・確率を直す」から直してください</div>') + '</div><button class="btn sm ghost" data-act="preset-edit" data-id="' + esc(p.id) + '">金額・確率を直す</button></div>'; }).join('') + '</div>' : '<div class="empty">まだ当たりの設定がありません</div>') +
      '<div class="acts start"><button class="btn ghost" data-act="preset-new">＋ 当たりの設定を新しく作る</button></div></div>';
  }
  function probSummary(p) {
    const v = Engine.validateProbs(p.probs), st = Engine.probStats(p.probs);
    return '<div class="summary"><div class="stat"><small>当たる確率</small><b>' + pct(st.win) + '</b></div><div class="stat"><small>STAGE 2 に進む</small><b>' + pct(st.reach[2]) + '</b></div><div class="stat"><small>STAGE 3 に進む</small><b>' + pct(st.reach[3]) + '</b></div>' +
      '<div class="stat"><small title="1プレイあたりの平均（ハズレも含む）">平均当たり額</small><b>' + fmtN(Math.round(st.ev)) + '</b></div></div>' +
      (v.ok ? '' : '<div class="err">' + v.errors.map(esc).join('<br>') + '</div>');
  }
  // 各ステージの見出しに出す合計（ちょうど 100% で緑）
  function sumBadge(p, stage) {
    const s = r2(Engine.probStats(p.probs).sums[stage]);
    return '<span class="sum ' + (s === 100 ? 'ok' : 'ng') + '" data-sum="' + stage + '">合計 ' + s + '%' + (s === 100 ? ' ✓' : s < 100 ? '（あと ' + r2(100 - s) + '%）' : '（' + r2(s - 100) + '% 多い）') + '</span>';
  }
  const saveMsg = (p) => { const v = Engine.validateProbs(p.probs); const btn = main.querySelector('[data-act="preset-save"]'); if (btn) btn.disabled = !v.ok; return v.ok ? '<span class="okmsg">保存できます</span>' : '<span class="err">' + esc(v.errors[0]) + (/種類まで/.test(v.errors[0]) ? '（× で行を消してください）' : '') + '</span>'; };
  /* 配当表の1行。金額の行は、金額そのものを書き換えられて × で消せる。0（ハズレ）と NEXT STAGE は固定 */
  function probRow(p, d, k) {
    const attr = 'data-p="' + d.stage + ':' + k + '"', fixed = k === '0' || k === 'NEXT';
    const lbl = fixed ? '<div class="lbl' + (k === 'NEXT' ? ' wrap' : '') + '">' + (k === 'NEXT' ? '次の STAGE へ' : '0<small>ハズレ</small>') + '</div>'
      : '<div class="lbl"><input type="number" class="amtin" inputmode="numeric" min="1" step="100" value="' + k + '" data-amt="' + d.stage + ':' + k + '" aria-label="STAGE ' + d.stage + ' の金額"></div>';
    return '<div class="row prow">' + lbl + '<div class="stepper"><button data-act="step" data-d="-1" ' + attr + ' aria-label="減らす">◀</button><span class="pv">' + p.probs[d.stage][k] + '<i>%</i></span><button data-act="step" data-d="1" ' + attr + ' aria-label="増やす">▶</button></div>' +
      (fixed ? '<span class="del ph"></span>' : '<button class="del" data-act="amt-del" data-k="' + d.stage + ':' + k + '" aria-label="' + fmtN(+k) + ' の行を消す">×</button>') + '</div>';
  }
  function probStage(p, d) {
    const n = d.values.length - 1, full = n >= Engine.MAX_AMOUNTS;
    return '<div class="stage"><h4><span>STAGE ' + d.stage + '</span>' + sumBadge(p, d.stage) + '</h4>' + PKEYS(d).map((k) => probRow(p, d, k)).join('') +
      '<div class="addrow"><button class="btn sm ghost" data-act="amt-add" data-s="' + d.stage + '"' + (full ? ' disabled' : '') + '>＋ 金額を追加</button><small>' + (full ? '金額は ' + Engine.MAX_AMOUNTS + ' 種類までです' : '金額 ' + n + ' 種類（最大 ' + Engine.MAX_AMOUNTS + '）') + '</small></div></div>';
  }
  function viewPresetEdit() {
    const p = editPreset, L = p.limits;
    L.early = earlyOf(L);
    const stepRow = (label, val, attr, unit, hint) => '<div class="row"><div class="lbl">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</div><div class="stepper"><button data-act="step" data-d="-1" ' + attr + ' aria-label="減らす">◀</button><span class="pv">' + val + '<i>' + unit + '</i></span><button data-act="step" data-d="1" ' + attr + ' aria-label="増やす">▶</button></div></div>';
    const S = presetSums(p), tgl = (on, act) => '<button class="btn sm tgl ' + (on ? 'on' : 'off') + '" data-act="' + act + '">' + (on ? 'ON' : 'OFF') + '</button>'; // ON は緑・OFF は灰（色だけでなく文字も）
    const fhead = (title, key) => '<h3>' + title + '</h3><span class="fsum" data-psum="' + key + '">' + S[key] + '</span>';
    /* 並び（2026-10-19）: 名前と色 → 配当と確率（いつも開いている）→ FREE SPIN・ロゴ・1日の本数制限・開始直後の制限（今の値を見出しに出して畳む）→ めったに使わない（削除）。保存・戻るは画面の下に固定 */
    return '<div class="panel"><h3>' + (p.id ? '当たりの設定「' + esc(p.name || '') + '」を直す' : '当たりの設定を新しく作る') + '</h3>' +
      (function () { const u = stores.filter((x) => x.activePresetId === p.id).map((x) => x.name); return p.id && u.length ? '<div class="usenote">いま <b>' + esc(u.join('・')) + '</b> で使っています。保存すると' + (u.length > 1 ? 'この ' + u.length + ' 店すべて' : 'このお店') + 'にすぐ反映されます</div>' : ''; })() +
      '<label class="f"><span>名前（お店の画面に出ます）</span><input type="text" id="pname" value="' + esc(p.name || '') + '" maxlength="20"></label>' +
      '<div class="row"><div class="lbl">名前の色<small>お店の画面の左上に、この色で出ます</small></div><div class="swatches">' +
      PRESET_COLORS.map((c) => '<button class="sw' + ((p.color || PRESET_COLORS[0][0]) === c[0] ? ' on' : '') + '" data-act="pcolor" data-c="' + c[0] + '" style="--c:' + c[0] + '" aria-label="' + c[1] + '" title="' + c[1] + '"></button>').join('') + '</div></div>' +
      '<div class="row"><div class="lbl">テスト用<small>ON の間は集計に数えません（画面に「TEST」）</small></div>' + tgl(p.test, 'test-on') + '</div>' +
      more('h-ptest', '名前の色: 店舗の端末の左上に、このプリセットの名前がこの色で出ます（いま何のプリセットで回っているかが分かります）。<br>テスト用プリセット: ON にすると、このプリセットで回した結果は配当履歴・合計・マスターの集計・当たり本数の制限のどれにも数えません。画面に「TEST」と表示されます。') + '</div>' +
      '<div class="panel"><h3>当たりの金額と確率</h3><p class="hint">各 STAGE の合計を <b style="color:var(--text)">100%</b> に（ずれると保存できません）。数字を押すと直接入力。</p>' +
      more('h-probs', '<b style="color:var(--text)">金額は数字を直接書き換えられます。</b>「＋ 金額を追加」で行を増やし、× で消せます（消した行の確率は 0 に足されます）。確率は ◀ ▶ で 1% ずつ（押しっぱなしで連続）。<b style="color:var(--text)">数字を押すと、直接入力もできます</b>（小数も可。ほかの欄の数字も同じです）。各ステージの合計をちょうど 100% にしてください。下の「平均当たり額」は、1プレイあたりの平均の当たり額です（ハズレも含めて平均。予算の目安）。<br>金額を増やしたり消したりしたプリセットは、店舗の端末が b52 以上になってから反映されます（端末は 1 時間以内に自動でアップデートします。店舗一覧で端末の版を確認できます）。') +
      '<div class="cols pcols">' + Engine.tableOf(p.probs).map((d) => probStage(p, d)).join('') + '</div>' +
      '<div id="psum">' + probSummary(p) + '</div></div>' +
      fold('p-free', fhead('FREE SPIN', 'free'),
        '<p class="hint">そろうと自動で回る回数が増えます。この回は<b style="color:var(--text)">必ずハズレ</b>（予算は変わりません）。</p>' +
        more('h-free', 'リールに同じ FREE SPIN が3本そろう割合です（1回のスピンあたり）。そろうと端末の CREDIT が 1・2・3 増え、その回数だけ自動で回ります。<b style="color:var(--text)">この回は演出で、抽選しません。必ず 0 で止まります</b>（当たりは出ません。当選確率・期待値・集計の回転数は変わりません）。0% にした種類は、絵柄も出なくなります。') +
        stepRow('FREE SPIN ×1 が出る割合', freeN(p, 1), 'data-f="1"', '%', 'CREDIT +1・当たりなし（0〜50%）') +
        stepRow('FREE SPIN ×2 が出る割合', freeN(p, 2), 'data-f="2"', '%', 'CREDIT +2・当たりなし（0〜25%）') +
        stepRow('FREE SPIN ×3 が出る割合', freeN(p, 3), 'data-f="3"', '%', 'CREDIT +3・当たりなし（0〜25%）'), { cls: 'panel' }) +
      fold('p-logo', fhead('casa ロゴ3つ ＝ 10 FREE SPIN', 'logo'),
        '<p class="hint">ロゴが3つそろうと 10 回自動で回ります。この 10 回も<b style="color:var(--text)">必ずハズレ</b>。</p>' +
        more('h-logo', 'リールに casa のロゴが3本そろうと、<b style="color:var(--text)">10 回ぶんの FREE SPIN</b> を獲得します。端末の CREDIT が 10 増え、CREDIT がなくなるまで自動で回り続けます。上の ×1〜×3 と同じく、<b style="color:var(--text)">この 10 回は演出で、抽選しません。必ず 0 で止まります</b>（当たりは出ません。当選確率・期待値・集計の回転数は変わりません）。10 回まわりきるのに約 3 分かかります。0% ならロゴは出ず、画面上部の説明も出ません。') +
        stepRow('casa ロゴが3本そろう割合', logoOf(p).toFixed(1), 'data-g="1"', '%', '1回のスピンあたり（0〜5%、0.1% きざみ）') +
        '<div class="ccost" style="margin-top:8px;font-size:14px">' + creditCost(p) + '</div>' +
        '<div class="row" style="margin-top:10px"><div class="lbl">FREE SPIN で回っている間は、FREE SPIN を出さない<small>スタッフが入れたクレジットで回っているゲームだけに効きます</small></div>' + tgl(noRetrig(p), 'retrig-on') + '</div>' +
        more('h-retrig', '獲得した FREE SPIN（当たりなしの回）では、この設定に関係なく、FREE SPIN ×1〜×3 も casa ロゴも出ません。この設定が効くのは、スタッフが設定画面で入れたクレジットで回っているゲームだけです。ON: その間は出ません（絵柄も出ません）。OFF: その間にもそろうことがあります（予算は変わりません）'), { cls: 'panel' }) +
      fold('p-lim', fhead('1日の当たりの本数の上限', 'lim'),
        '<p class="hint">1日に出る当たりの本数に上限をつけます（上限を超えた分はハズレになります）。</p>' +
        '<div class="row"><div class="lbl">制限を使う</div>' + tgl(L.on, 'lim-on') + '</div>' +
        stepRow('リセット時刻', L.resetHour, 'data-l="hour"', ':00', '毎日この時刻にカウントが 0 に戻ります') +
        stepRow('1日の当たり本数の上限（合計）', L.total, 'data-l="total"', '本', '0 は無制限') +
        '<p class="hint" style="margin:18px 0 8px"><b style="color:var(--text)">金額ごとの上限</b>（任意。0 は制限なし）</p><div class="cols">' +
        Engine.tableOf(p.probs).map((d) => '<div class="stage"><h4><span>STAGE ' + d.stage + '</span></h4>' + (d.values.filter((v) => v > 0).map((v) => stepRow(fmtN(v), L.max[d.stage + ':' + v] || 0, 'data-l="' + d.stage + ':' + v + '"', '回')).join('') || '<div class="empty" style="padding:8px 0">金額がありません</div>') + '</div>').join('') + '</div>', { cls: 'panel' }) +
      (function () { const E = L.early; return fold('p-early', fhead('その日の最初は高額を出さない', 'early'),
        '<p class="hint">1日の<b style="color:var(--text)">最初の X 回は、Y 以上が当たらない</b>ようにします（お店の画面ごとに数えます）。</p>' +
        '<div class="row"><div class="lbl">この制限を使う</div>' + tgl(E.on, 'early-on') + '</div>' +
        stepRow('最初の何回まで（X）', E.plays, 'data-e="plays"', '回', '1〜999 回') +
        stepRow('いくら以上を出さないか（Y）', fmtN(E.min), 'data-e="min"', '以上', '例: 2,000 にすると、2,000・3,000・5,000・10,000… が出ません'), { cls: 'panel' }); })() +
      (p.id ? fold('p-rare', '<h3>めったに使わない操作</h3><span class="fsum">この当たりの設定の削除</span>', '<div class="rare"><div><b>この当たりの設定を削除</b><small>お店の画面からも消えます</small></div><button class="btn danger" data-act="preset-del">削除する</button></div>', { cls: 'panel' }) : '') +
      '<div class="savebar"><div class="msg"><span id="pstate">' + saveMsg(p) + '</span><div class="err" id="perr"></div></div><button class="btn ghost" data-act="preset-cancel">戻る</button><button class="btn" data-act="preset-save"' + (Engine.validateProbs(p.probs).ok ? '' : ' disabled') + '>保存</button></div>';
  }
  async function savePreset() {
    const p = editPreset, name = $('pname').value.trim(), err = $('perr');
    err.textContent = '';
    if (!name) { err.textContent = '名前を入力してください。'; return; }
    const v = Engine.validateProbs(p.probs);
    if (!v.ok) { err.textContent = v.errors.join(' / '); return; }
    if (staleMsg()) { err.textContent = staleMsg(); return; }
    await Cloud.savePreset(p.id || null, { name, probs: p.probs, limits: p.limits, freeRate: freeN(p, 1), freeRate2: freeN(p, 2), freeRate3: freeN(p, 3), logoRate: logoOf(p), noRetrigger: noRetrig(p), test: !!p.test, color: p.color || PRESET_COLORS[0][0] });
    toast('「' + name + '」を保存しました。使っているお店にすぐ反映されます');
    editPreset = null; await reload(); render();
  }

  /* ---------- 集計（期間を指定できる。日付は営業日＝当たりのリセット時刻で切り替わる日） ---------- */
  const PLAY_MAX = 200; // 期間内のプレイの一覧に出す件数の上限
  let statsRange = null; // { from: 'yyyy-mm-dd', to: 'yyyy-mm-dd' }（営業日）
  const p2 = (n) => ('0' + n).slice(-2);
  const iso = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const isoToDate = (s) => { const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
  const addDays = (s, n) => { const d = isoToDate(s); d.setDate(d.getDate() + n); return iso(d); };
  // その店舗で使用中のプリセットのリセット時刻（営業日の切り替わり）。未設定は 19 時
  const ALL = '__all__'; // b106: 集計の「全店舗の合計」
  function resetHourOf(storeId) {
    if (storeId === ALL) storeId = stores[0] && stores[0].id; // 全店舗のときの「今日」の基準は先頭の店舗（日付の範囲は店舗ごとのリセット時刻で取る）
    const s = stores.find((x) => x.id === storeId), pr = s && presets.find((x) => x.id === s.activePresetId);
    return pr && pr.limits && Number.isInteger(pr.limits.resetHour) ? pr.limits.resetHour : 19;
  }
  // いまの営業日（リセット時刻より前なら前日の日付）
  const bizToday = (storeId) => iso(new Date(Engine.windowStart(Date.now(), resetHourOf(storeId))));
  function quickRange(q, storeId) {
    const t = bizToday(storeId), d = isoToDate(t);
    if (q === 'today') return { from: t, to: t };
    if (q === 'yesterday') return { from: addDays(t, -1), to: addDays(t, -1) };
    if (q === '7') return { from: addDays(t, -6), to: t };
    if (q === 'month') return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: t };
    if (q === 'last') return { from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) };
    return { from: addDays(t, -30), to: t }; // 直近31日
  }
  const QUICK = [['today', '今日'], ['yesterday', '昨日'], ['7', '直近7日'], ['month', '今月'], ['last', '先月'], ['31', '直近31日']];
  function viewStats() {
    const sel = '<label class="f"><span>どのお店</span><select id="stsel"><option value="">選んでください</option>' + (stores.length > 1 ? '<option value="' + ALL + '" ' + (statsStore === ALL ? 'selected' : '') + '>全店舗の合計</option>' : '') + stores.map((s) => '<option value="' + esc(s.id) + '" ' + (statsStore === s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label>';
    if (!statsStore) return '<div class="panel"><h3>集計</h3>' + sel + '</div>';
    const R = statsRange || quickRange('31', statsStore), rh = resetHourOf(statsStore);
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    const fmtDay = (k) => { const d = new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')'; };
    const isQ = (q) => { const x = quickRange(q, statsStore); return x.from === R.from && x.to === R.to; };
    /* 2026-10-19 その 2: よく使う期間のボタンを先に。日付の欄は「日付で選ぶ」の畳みへ（見出しにいまの期間）。1日の区切りの説明は 1 行 */
    const fmtIso = (x) => fmtDay(x.replace(/-/g, ''));
    const period = '<div class="quick">' + QUICK.map((q) => '<button class="btn sm ' + (isQ(q[0]) ? 'sel' : 'ghost') + '" data-act="st-quick" data-q="' + q[0] + '"' + (isQ(q[0]) ? ' aria-pressed="true"' : '') + '>' + q[1] + '</button>').join('') + '</div>' +
      fold('st-range', '<b style="font-size:14px">日付で選ぶ</b><span class="fsum">いま: ' + fmtIso(R.from) + (R.from === R.to ? '' : ' 〜 ' + fmtIso(R.to)) + '</span>',
        '<div class="range"><label class="f"><span>開始（営業日）</span><input type="date" id="stfrom" value="' + R.from + '" max="' + R.to + '"></label><label class="f"><span>終了（営業日）</span><input type="date" id="stto" value="' + R.to + '" min="' + R.from + '"></label></div>', { cls: 'more' }) +
      (statsStore === ALL && new Set(stores.map((x) => resetHourOf(x.id))).size > 1 ? '<p class="hint" style="margin-top:4px">1日の区切りは、お店ごとの当たりのリセット時刻（' + stores.map((x) => x.name + ' ' + resetHourOf(x.id) + ':00').join('・') + '）</p>'
        : (function () { const h = resetHourOf(statsStore), d = fmtIso(R.to).replace(/\(.\)$/, ''); return '<p class="hint" style="margin-top:4px">1日は ' + h + ':00 で区切ります（例: ' + d + ' の数字 ＝ ' + d + ' ' + h + ':00 〜 翌日 ' + (h ? (h - 1) + ':59' : '23:59') + '）</p>'; })());
    if (!statsData) return '<div class="panel"><h3>集計</h3>' + sel + period + '<div class="empty">読み込み中…</div></div>';
    const d = statsData, all = statsStore === ALL;
    const nameOf = (id) => { const x = stores.find((y) => y.id === id); return x ? x.name : ''; };
    const tot = d.days.reduce((a, x) => ({ plays: a.plays + (x.plays || 0), awarded: a.awarded + (x.awarded || 0), wins: a.wins + (x.wins || 0) }), { plays: 0, awarded: 0, wins: 0 });
    return '<div class="panel"><h3>集計</h3>' + sel + period +
      '<div class="summary"><div class="stat"><small>プレイ数</small><b>' + fmtN(tot.plays) + '</b></div><div class="stat"><small>当たりの合計額</small><b>' + fmtN(tot.awarded) + '</b></div><div class="stat"><small>当たり数</small><b>' + fmtN(tot.wins) + '</b></div><div class="stat"><small title="1プレイあたりの平均（ハズレも含む）">平均当たり額</small><b>' + fmtN(tot.plays ? Math.round(tot.awarded / tot.plays) : 0) + '</b></div></div>' +
      (all ? '<h4 style="margin:14px 0 6px">お店ごと</h4><table><tr><th>お店</th><th class="n">プレイ数</th><th class="n">当たり数</th><th class="n">当たり額</th></tr>' + d.byStore.map((x) => '<tr><td>' + esc(x.name) + '</td><td class="n">' + fmtN(x.plays) + '</td><td class="n">' + fmtN(x.wins) + '</td><td class="n">' + fmtN(x.awarded) + '</td></tr>').join('') + '</table><h4 style="margin:14px 0 6px">日ごと（全店舗の合計）</h4>' : '') +
      '<table><tr><th>日</th><th class="n">プレイ数</th><th class="n">当たり数</th><th class="n">当たり額</th></tr>' + ((all ? d.dayTotals : d.days).length ? (all ? d.dayTotals : d.days).map((x) => '<tr><td>' + fmtDay(x.day) + '</td><td class="n">' + fmtN(x.plays || 0) + '</td><td class="n">' + fmtN(x.wins || 0) + '</td><td class="n">' + fmtN(x.awarded || 0) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">この期間のデータはありません</td></tr>') + '</table></div>' +
      fold('st-plays', '<h3>1回ずつの記録</h3><span class="fsum">' + (d.plays.length ? '新しい順に ' + fmtN(d.plays.length) + ' 件' : 'なし') + '</span>', (tot.plays > d.plays.length && d.plays.length >= PLAY_MAX ? '<p class="hint">この期間のプレイは ' + fmtN(tot.plays) + ' 回あります。新しい ' + PLAY_MAX + ' 件を表示しています。</p>' : '') +
      '<div class="tscroll"><table><tr><th>日時</th>' + (all ? '<th>店舗</th>' : '') + '<th>STAGE</th><th class="n">当たり額</th><th>当たりの設定</th></tr>' + (d.plays.length ? d.plays.map((x) => '<tr><td>' + fmtDate(x.ts) + '</td>' + (all ? '<td>' + esc(nameOf(x.storeId)) + '</td>' : '') + '<td>STAGE ' + x.stage + '</td><td class="n">' + fmtN(x.value) + '</td><td>' + esc(presetName(x.presetId)) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">この期間のプレイはありません</td></tr>') + '</table></div>', { cls: 'panel' });
  }
  async function loadStats(id, range) {
    if (id !== statsStore) statsRange = null; // 店舗を変えたら、期間は直近31日に戻す
    statsStore = id; statsData = null;
    if (range) statsRange = range;
    if (!id) return render();
    if (id === ALL) return loadStatsAll();
    const R = statsRange || quickRange('31', id), rh = resetHourOf(id);
    render(); // 先に期間の欄だけ出す
    const from = isoToDate(R.from), to = isoToDate(R.to);
    from.setHours(rh, 0, 0, 0); to.setDate(to.getDate() + 1); to.setHours(rh, 0, 0, 0);
    const k0 = R.from.replace(/-/g, ''), k1 = R.to.replace(/-/g, ''), t0 = from.getTime(), t1 = to.getTime();
    let days, plays;
    try {
      [days, plays] = await Promise.all([Cloud.listDaysRange(id, k0, k1), Cloud.listPlaysRange(id, t0, t1, PLAY_MAX)]);
    } catch (err) {
      // 期間での問い合わせに失敗したら、これまでの取り方（新しい順にまとめて取る）で取って、こちらで期間に絞る
      try {
        const all = await Promise.all([Cloud.listDays(id, 400), Cloud.listPlays(id, 500)]);
        days = all[0].filter((x) => x.day >= k0 && x.day <= k1);
        plays = all[1].filter((x) => x.ts >= t0 && x.ts < t1).slice(0, PLAY_MAX);
      } catch (err2) { days = []; plays = []; toast('集計を読み込めませんでした: ' + err2.message); }
    }
    if (id !== statsStore) return; // 読み込み中に店舗を切り替えた
    statsData = { days, plays };
    render();
  }

  /* b106: 全店舗の合計。店舗ごとに、その店のリセット時刻で期間を取り、合計する */
  async function loadStatsAll() {
    const R = statsRange || quickRange('31', ALL);
    render();
    const k0 = R.from.replace(/-/g, ''), k1 = R.to.replace(/-/g, '');
    const per = await Promise.all(stores.map(async (s) => {
      const rh = resetHourOf(s.id), from = isoToDate(R.from), to = isoToDate(R.to);
      from.setHours(rh, 0, 0, 0); to.setDate(to.getDate() + 1); to.setHours(rh, 0, 0, 0);
      const t0 = from.getTime(), t1 = to.getTime();
      let days = [], plays = [];
      try { [days, plays] = await Promise.all([Cloud.listDaysRange(s.id, k0, k1), Cloud.listPlaysRange(s.id, t0, t1, PLAY_MAX)]); }
      catch (err) {
        try { const a = await Promise.all([Cloud.listDays(s.id, 400), Cloud.listPlays(s.id, 500)]); days = a[0].filter((x) => x.day >= k0 && x.day <= k1); plays = a[1].filter((x) => x.ts >= t0 && x.ts < t1).slice(0, PLAY_MAX); }
        catch (err2) { toast(s.name + ' の集計を読み込めませんでした'); }
      }
      return { s, days, plays: plays.map((x) => Object.assign({ storeId: s.id }, x)) };
    }));
    if (statsStore !== ALL) return; // 読み込み中に切り替えた
    const days = [], dmap = {};
    per.forEach((p) => p.days.forEach((x) => { days.push(x); const m = dmap[x.day] = dmap[x.day] || { day: x.day, plays: 0, wins: 0, awarded: 0 }; m.plays += x.plays || 0; m.wins += x.wins || 0; m.awarded += x.awarded || 0; }));
    const dayTotals = Object.keys(dmap).sort().reverse().map((k) => dmap[k]);
    const byStore = per.map((p) => p.days.reduce((a, x) => ({ name: a.name, plays: a.plays + (x.plays || 0), wins: a.wins + (x.wins || 0), awarded: a.awarded + (x.awarded || 0) }), { name: p.s.name, plays: 0, wins: 0, awarded: 0 }));
    const plays = [].concat(...per.map((p) => p.plays)).sort((a, b) => b.ts - a.ts).slice(0, PLAY_MAX);
    statsData = { days, dayTotals, byStore, plays };
    render();
  }

  /* ---------- 操作 ---------- */
  /* お店の一覧から当たりの設定を変える（2026-10-19 その 2）: 店舗の編集で「いま使うプリセット」だけ変えて保存したときと同じ 2 項目（activePresetId・presetIds）を書く。
     描き直さない（テレビの切り替えのパスワード欄を消さないため） */
  function quickPick(sel) { // 選んだだけでは保存しない（お金に関わるので、「変更する」を押したときだけ）。元の値に戻したらボタンを消す
    const s = stores.find((x) => x.id === sel.dataset.qid), b = main.querySelector('[data-act="qpre-save"][data-id="' + sel.dataset.qid + '"]');
    if (s && b) { const same = (sel.value || '') === (s.activePresetId || ''); b.hidden = same; if (b.nextElementSibling) b.nextElementSibling.hidden = same; } // 選んだ店だけ金の「変更する」と「まだ変わっていません」
  }
  async function quickPreset(sel) {
    const s = stores.find((x) => x.id === sel.dataset.qid); if (!s) return;
    const btn = main.querySelector('[data-act="qpre-save"][data-id="' + s.id + '"]');
    const back = (msg) => { sel.value = s.activePresetId || ''; toast(msg); };
    if (staleMsg()) return back(staleMsg());
    const active = sel.value || null, presetIds = (s.presetIds || []).slice();
    if (active && presetIds.indexOf(active) < 0) presetIds.push(active);
    sel.disabled = true;
    try { await Cloud.saveStore(s.id, { presetIds, activePresetId: active }); s.presetIds = presetIds; s.activePresetId = active; toast(s.name + ' の当たりの設定を「' + presetName(active) + '」にしました'); }
    catch (err) { back('保存できませんでした。通信を確認して、もう一度選んでください'); }
    sel.disabled = false; if (btn) { btn.hidden = true; btn.disabled = false; if (btn.nextElementSibling) btn.nextElementSibling.hidden = true; }
    const w = main.querySelector('[data-warn="' + s.id + '"]'); if (w) w.innerHTML = storeWarn(s) + timedNote(s) + pubNote(s);
  }
  main.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.qid) return quickPick(e.target);
    if (e.target.id === 'stsel') return loadStats(e.target.value);
    if (e.target.dataset && e.target.dataset.pk) { const id = e.target.dataset.pk, k = e.target.value, q = (a) => document.querySelector('[' + a + '="' + id + '"]'); q('data-px').hidden = !k; q('data-pd').hidden = k !== 'date'; q('data-pw').hidden = k !== 'weekly'; return; } // 公開期間の種類（2026-10-24）
    if (/^(sbill|sdoor|shw)$/.test(e.target.id) && $('playSum')) { $('playSum').innerHTML = playSum($('sbill').checked, $('sdoor').checked, $('shw').checked); return; } // 畳んだ見出しの ON/OFF（保存はまだ）
    // 集計の期間（開始・終了）を変えた
    if ((e.target.id === 'stfrom' || e.target.id === 'stto') && statsStore) {
      const R = Object.assign({}, statsRange || quickRange('31', statsStore));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return;
      R[e.target.id === 'stfrom' ? 'from' : 'to'] = e.target.value;
      if (R.from > R.to) { if (e.target.id === 'stfrom') R.to = R.from; else R.from = R.to; }
      return loadStats(statsStore, R);
    }
    // 配当表の金額を書き換えた
    if (e.target.dataset.amt && editPreset) {
      const pk = e.target.dataset.amt.split(':'), row = editPreset.probs[pk[0]], v = Number(e.target.value), key = String(v);
      const back = (msg) => { e.target.value = pk[1]; toast(msg); };
      if (!Number.isInteger(v) || v < 1 || v > Engine.MAX_VALUE) return back('金額は 1 以上の整数で入力してください');
      if (key === pk[1]) return;
      if (row[key] !== undefined) return back('STAGE ' + pk[0] + ' には、すでに ' + fmtN(v) + ' があります');
      row[key] = row[pk[1]]; delete row[pk[1]];
      const M = editPreset.limits.max || {}, old = pk[0] + ':' + pk[1];
      if (M[old]) { M[pk[0] + ':' + key] = M[old]; delete M[old]; } // 金額ごとの上限も一緒に移す
      const top = window.scrollY; render(); window.scrollTo(0, top);
    }
  });
  main.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.amt) e.target.blur(); }); // Enter で確定
  main.addEventListener('input', (e) => { if (e.target.id === 'pname' && editPreset) editPreset.name = e.target.value; }); // 途中で画面を作り直しても名前が消えないように
  /* ◀ ▶ 1回ぶん（d = ±1）の増減。数字の直接入力からは、d に「入力した値 − いまの値」を渡す（上限・下限・丸めは同じ決まり） */
  function doStep(b, d) {
    const pv = b.parentNode.querySelector('.pv');
    const show = (v, unit) => { pv.innerHTML = v + '<i>' + unit + '</i>'; };
    if (b.dataset.p) {
      const pk = b.dataset.p.split(':'); const v = Number(editPreset.probs[pk[0]][pk[1]]) || 0;
      editPreset.probs[pk[0]][pk[1]] = Math.max(0, Math.min(100, Math.round((v + d) * 100) / 100));
      show(editPreset.probs[pk[0]][pk[1]], '%');
      $('psum').innerHTML = probSummary(editPreset);
      const badge = main.querySelector('[data-sum="' + pk[0] + '"]'); if (badge) badge.outerHTML = sumBadge(editPreset, +pk[0]);
      $('pstate').innerHTML = saveMsg(editPreset);
      refreshCost();
      return;
    }
    if (b.dataset.e) {
      const E = editPreset.limits.early = earlyOf(editPreset.limits);
      if (b.dataset.e === 'plays') { E.plays = Math.max(1, Math.min(999, Math.round((Number(E.plays) || 0) + d))); return show(E.plays, '回'); }
      const A = amountsOf(editPreset); if (!A.length) return;
      let i = A.indexOf(E.min); if (i < 0) { i = A.filter((x) => x < E.min).length; if (d > 0) i -= 1; } // 配当表から消えた金額のときは、近い金額から選び直す
      E.min = A[Math.max(0, Math.min(A.length - 1, i + Math.round(d)))];
      return show(fmtN(E.min), '以上');
    }
    if (b.dataset.g) { editPreset.logoRate = Math.max(0, Math.min(LOGO_MAX, Math.round((logoOf(editPreset) + d * 0.1) * 10) / 10)); refreshCost(); return show(editPreset.logoRate.toFixed(1), '%'); }
    if (b.dataset.f) { const n = +b.dataset.f, key = FREE_KEYS[n - 1]; editPreset[key] = Math.max(0, Math.min(FREE_MAX[n - 1], Math.round((freeN(editPreset, n) + d) * 10) / 10)); refreshCost(); return show(editPreset[key], '%'); }
    const k = b.dataset.l, L = editPreset.limits;
    if (k === 'hour') { L.resetHour = ((Math.round(L.resetHour + d) % 24) + 24) % 24; return show(L.resetHour, ':00'); }
    if (k === 'total') { L.total = Math.max(0, Math.min(999, Math.round((L.total || 0) + d))); return show(L.total, '本'); }
    const v = Math.max(0, Math.min(99, Math.round((Number(L.max[k]) || 0) + d))); if (v) L.max[k] = v; else delete L.max[k];
    return show(v, '回');
  }
  /* 数字の直接入力: ◀ ▶ の間の数字を押すと入力欄になる。Enter か欄の外を押すと確定、Esc で取り消し */
  const curVal = (b) => { // その行のいまの値と、◀ ▶ 1回ぶんの大きさ（金額を選ぶ欄は直接入力なし）
    const P = editPreset, L = P.limits;
    if (b.dataset.p) { const pk = b.dataset.p.split(':'); return { v: Number(P.probs[pk[0]][pk[1]]) || 0, unit: 1 }; }
    if (b.dataset.e === 'plays') return { v: Number(earlyOf(L).plays) || 0, unit: 1 };
    if (b.dataset.e) return null;
    if (b.dataset.g) return { v: logoOf(P), unit: 0.1 };
    if (b.dataset.f) return { v: freeN(P, +b.dataset.f), unit: 1 };
    if (b.dataset.l === 'hour') return { v: L.resetHour, unit: 1 };
    if (b.dataset.l === 'total') return { v: L.total || 0, unit: 1 };
    if (b.dataset.l) return { v: Number(L.max[b.dataset.l]) || 0, unit: 1 };
    return null;
  };
  main.addEventListener('click', (e) => {
    const pv = e.target.closest('.stepper .pv');
    if (!pv || pv.querySelector('input') || !editPreset) return;
    const b = pv.parentNode.querySelector('[data-act="step"][data-d="1"]'), c = b && curVal(b);
    if (!c) return;
    const unit = (pv.querySelector('i') || {}).textContent || '';
    pv.innerHTML = '<input type="number" class="pvin" inputmode="decimal" step="any" value="' + c.v + '" aria-label="数字を入力"><i>' + esc(unit) + '</i>';
    const inp = pv.querySelector('input');
    inp.focus(); inp.select();
    let done = false;
    const commit = (apply) => {
      if (done) return; done = true;
      const now = curVal(b), x = Number(inp.value);
      doStep(b, apply && inp.value !== '' && isFinite(x) ? (x - now.v) / now.unit : 0); // 0 でも、表示を数字に戻すために呼ぶ
      updatePresetSums();
    };
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(true); } else if (ev.key === 'Escape') commit(false); });
    inp.addEventListener('blur', () => commit(true));
  });

  // ◀ ▶ を押しっぱなしにすると連続で増減する
  let holdT = 0, holdI = 0;
  const holdStop = () => { clearTimeout(holdT); clearInterval(holdI); };
  main.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-act="step"]');
    holdStop();
    if (!b) return;
    holdT = setTimeout(() => { holdI = setInterval(() => { if (!document.contains(b)) return holdStop(); b.click(); }, 70); }, 420);
  });
  ['pointerup', 'pointercancel', 'blur'].forEach((ev) => window.addEventListener(ev, holdStop));
  main.addEventListener('pointerleave', holdStop);
  main.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-act="step"]')) e.preventDefault(); });
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    try {
      switch (act) {
        case 'qpre-save': { const sel = main.querySelector('select[data-qid="' + b.dataset.id + '"]'); if (!sel || b.disabled) return; b.disabled = true; return await quickPreset(sel); }
        case 'store-new': editStore = { name: '', presetIds: [], activePresetId: null }; return render();
        case 'update-all': {
          if (!stores.length || !confirm('ログイン中のすべての店舗の端末を、いますぐ最新版に切り替えます。ゲーム中の端末は、そのゲームが終わり次第切り替わります。')) return;
          const t = Date.now();
          await Promise.all(stores.map((s) => Cloud.saveStore(s.id, { updateAt: t })));
          toast(stores.length + ' 店に「最新にする」を送りました。動いているお店は数分で切り替わります');
          return;
        }
        case 'stores-reload': await reload(); render(); loadLatest(); toast('読み直しました'); return;
        case 'meter-save': {
          const target = Math.max(10, Math.min(100000, Math.round(Number($('mtarget').value) || 300))), superPlays = Math.max(1, Math.min(1000, Math.round(Number($('mplays').value) || 10)));
          const cur = await Cloud.getMeter(), on = !!$('mon').checked;
          if (on && (cur.superLeft || 0) <= 0 && (cur.miss || 0) >= target && !confirm('いま溜まっているハズレ（' + (cur.miss || 0) + '）が満タン回数（' + target + '）以上なので、保存するとすぐに全店舗が SUPER MODE になります。よいですか？')) return;
          const f = { enabled: on, target, superPlays, superPresetId: $('mpreset').value || null }; if (!on) f.superLeft = 0; // b105: OFF にしたら、残っている SUPER MODE も終わらせる
          await Cloud.saveMeter(f);
          meter = await Cloud.getMeter(); toast('スーパーメーターの設定を保存しました'); return render();
        }
        case 'meter-reset': if (!confirm('溜まったハズレを 0 に戻します。')) return; await Cloud.saveMeter({ miss: 0 }); meter = await Cloud.getMeter(); toast('0 に戻しました'); return render();
        case 'meter-start': { if (b.disabled) return; b.disabled = true; try { const m = await Cloud.getMeter(); if (!m.enabled) { toast('先に「スーパーメーターを使う」を ON にして保存してください'); return; } if (m.superLeft > 0 && !confirm('いまスーパーモード中です（残り ' + m.superLeft + ' 回）。最初の ' + (m.superPlays || 10) + ' 回からやり直しますか？')) return; if (!m.superLeft && !confirm('いますぐ全店舗をスーパーモードにします（' + (m.superPlays || 10) + ' 回）。')) return; await Cloud.saveMeter({ miss: 0, superLeft: m.superPlays || 10, superAt: Date.now() }); meter = await Cloud.getMeter(); toast('スーパーモードを開始しました'); return render(); } finally { b.disabled = false; } }
        case 'store-edit': editStore = Object.assign({}, stores.find((s) => s.id === b.dataset.id)); return render();
        case 'store-cancel': editStore = null; return render();
        case 'store-save': if (b.disabled) return; b.disabled = true; try { return await saveStore(); } finally { b.disabled = false; }   // b79: 二度押しで同じ店舗が 2 つできないように。失敗したときに下の catch でメッセージを出すため await する
        case 'store-logout': if (!confirm('この店舗の端末をログアウトさせます。端末は次回起動時に店舗の選び直しとパスワード入力が必要になります。')) return; await Cloud.saveStore(editStore.id, { logoutAt: Date.now() }); toast('ログアウトを指示しました'); return;
        case 'store-del': if (!confirm('店舗「' + editStore.name + '」を削除します。端末はログアウトされます。過去の集計の記録はクラウドに残ります（画面からは見えなくなります）。')) return; await Cloud.deleteStore(editStore.id); editStore = null; await reload(); return render();
        case 'preset-new': editPreset = { name: '', probs: Engine.defaultProbs(), limits: { on: false, total: 0, max: {}, resetHour: 19 }, freeRate: FREE_DEFAULTS[0], freeRate2: FREE_DEFAULTS[1], freeRate3: FREE_DEFAULTS[2], logoRate: 0, noRetrigger: true, test: false, color: PRESET_COLORS[0][0] }; return render();
        case 'preset-edit': { const p = presets.find((x) => x.id === b.dataset.id); editPreset = JSON.parse(JSON.stringify({ id: p.id, name: p.name, probs: p.probs, limits: Object.assign({ on: false, total: 0, max: {}, resetHour: 19 }, p.limits || {}), freeRate: freeN(p, 1), freeRate2: freeN(p, 2), freeRate3: freeN(p, 3), logoRate: logoOf(p), noRetrigger: noRetrig(p), test: !!p.test, color: p.color || PRESET_COLORS[0][0] })); return render(); }
        case 'preset-cancel': editPreset = null; return render();
        case 'preset-save': if (b.disabled) return; b.disabled = true; try { return await savePreset(); } finally { b.disabled = false; }
        case 'preset-del': {
          // 使用中（いま使う／配布中）の店舗があるプリセットは消せない（端末が前の設定のまま動き続け、マスターでは「未設定」に見えるため）
          const users = stores.filter((s) => s.activePresetId === editPreset.id || (s.presetIds || []).indexOf(editPreset.id) >= 0).map((s) => s.name);
          if (users.length) { $('perr').textContent = '店舗「' + users.join('」「') + '」で使っているので削除できません。先に店舗の編集で外してください。'; return; }
          if (meter && meter.superPresetId === editPreset.id) { $('perr').textContent = 'スーパーメーターの「スーパーモード中のプリセット」に選ばれているので削除できません。先に店舗タブで外してください。'; return; } // b105
          if (!confirm('プリセット「' + editPreset.name + '」を削除します。')) return; await Cloud.deletePreset(editPreset.id); editPreset = null; await reload(); return render();
        }
        case 'test-on': editPreset.test = !editPreset.test; return render();
        case 'pcolor': { const top = window.scrollY; editPreset.color = b.dataset.c; editPreset.name = $('pname').value; render(); window.scrollTo(0, top); return; }
        case 'retrig-on': { const top = window.scrollY; editPreset.noRetrigger = !noRetrig(editPreset); render(); window.scrollTo(0, top); return; }
        case 'lim-on': editPreset.limits.on = !editPreset.limits.on; return render();
        case 'early-on': { const top = window.scrollY; editPreset.limits.early = earlyOf(editPreset.limits); editPreset.limits.early.on = !editPreset.limits.early.on; render(); window.scrollTo(0, top); return; }
        case 'st-quick': return await loadStats(statsStore, quickRange(b.dataset.q, statsStore));
        case 'amt-add': {
          const s = b.dataset.s, row = editPreset.probs[s], vals = Engine.tableOf(editPreset.probs)[s - 1].values.filter((v) => v > 0);
          if (vals.length >= Engine.MAX_AMOUNTS) return;
          // 新しい行の金額の初期値: いちばん大きい金額に、いちばん小さい金額を足した額（あとで直接書き換えられる）
          let v = vals.length ? vals[vals.length - 1] + vals[0] : Engine.DEFAULT_VALUES[s][1];
          while (row[v] !== undefined) v += vals[0] || 100;
          row[v] = 0;
          const top = window.scrollY; render(); window.scrollTo(0, top);
          const inp = main.querySelector('[data-amt="' + s + ':' + v + '"]'); if (inp) { inp.focus(); inp.select(); }
          return;
        }
        case 'amt-del': {
          const pk = b.dataset.k.split(':'), row = editPreset.probs[pk[0]];
          row['0'] = Math.round(((Number(row['0']) || 0) + (Number(row[pk[1]]) || 0)) * 100) / 100; // 消す行の確率は 0（ハズレ）に足す
          delete row[pk[1]];
          if (editPreset.limits.max) delete editPreset.limits.max[b.dataset.k];
          const top = window.scrollY; render(); window.scrollTo(0, top);
          return;
        }
        case 'step': doStep(b, +b.dataset.d); return updatePresetSums(); // 畳んだ見出しの今の値も直す
      }
    } catch (err) { toast('失敗しました: ' + err.message); }
  });

  start();
})();
