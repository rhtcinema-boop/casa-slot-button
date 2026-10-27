/* casa DERBY v4 スタッフのスマホ（v2/staff.html。casa SLOT の紙幣のページの「競馬」タブから開く）。2026-10-21 作り直し
   （仕様書_v4_大改修.md「スタッフ画面（シンプルにする）」・v2/V4_CORE_NOTES.md 8 章）。通信は v2/client.js（DerbyCloud）だけ。
   1 画面:
     上   … 店名・テレビの状態（casa DERBY / casa SLOT）と切り替え・次のレース（投票の始まり）
     真ん中 … 今日の当たり（まだ渡していない人が上: 会計番号・ニックネーム・額。スライドで「渡した」。下に渡した人（時刻つき）・期限切れは薄く）
     下   … 番号を空ける（2 けた → いまのレースのその番号の票を消す）・テストレース（この店だけ・投票 1 分）・その他（テレビの画質・店舗を変える）
   なくしたもの: カメラで QR を読む画面・認証・当たりの QR 読み取り・返却・リングバウンティ・記録のタブ・テレビを次へ。
   ログインは今までどおり店の 4 けたのスタッフ PIN（このスマホに覚える。localStorage 'casa.derby.staff.v1'）。
   言葉は下の TX にまとめた（文字帳で直す。ふつうの文字のまま）。テスト用に window.STAFF を出す（v2/staffswitch.js も使う）。 */
(function () {
  'use strict';
  /* ================= 言葉（文字帳） ================= */
  const TX = {
    staff: 'スタッフ', connecting: '接続中…', waiting: '接続を待っています', online: 'につながっています',
    tv: 'テレビ', toSlot: 'SLOT にする', toDerby: 'DERBY にする', tvAsk: '{s}のテレビを {g} にしますか？', tvAskSub: '数秒で切り替わります（ゲーム中・レース中は終わってから）', tvDone: 'テレビを {g} にしました', change: '切り替える',
    nextRace: '次のレース {t}', voteFrom: '投票は {t} から', voting: '{t} のレース 投票中', closeIn: '締切まで', votes: 'この店 {n} 票', racing: '{t} のレース レース中', dayOver: '本日のレースは終わりました', test: 'テスト',
    todayHead: '本日のレース', todayNext: '次', todayNone: '本日のこの店のレースはありません', /* 本日の出走時間（2026-10-27） */
    watchOnly: '{t} のレースは {s} だけ（この店は投票なし）', /* 2026-10-26 オーナー: レースごとに投票できる店を選べる。この店が入っていないレースの投票中 */
    winsHead: '今日の当たり', unpaidN: 'まだ {n} 人', paidN: '渡した {n} 人', vote2: '2票目', /* vote2: 初参加ボーナスの 2 票目の当たり（2026-10-24。当たればそれぞれ払う＝行が 2 つ） */ noWins: '今日の当たりはまだありません', loadErr: '読み込めませんでした',
    slide: 'スライドして渡した', saving: '記録しています…', gave: '{b}番 {n} {a} を渡しました', paidAt: '渡した {t}', viaSelf: 'お客さんのスマホ', viaStaff: 'スタッフ', expired: '期限切れ', voided: '取り消し', race: '{t} のレース',
    alreadyPaid: 'もう渡してあります', expiredMsg: '受け取りの期限が切れています', voidMsg: 'このレースは取り消しになりました', netErr: '通信できませんでした。もう一度お試しください', failed: 'うまくいきませんでした',
    relHead: '番号を空ける', relSub: '{t} のレースの、その番号の票を消します。お客さんはもう一度投票できます', relNone: 'いま投票できるレースがありません', relBtn: '空ける', relAsk: '{b}番の票を消しますか？', relAskSub: '{t} のレース・消すと元に戻せません', relDone: '{b}番を空けました。お客さんはもう一度投票できます', relNoVote: '{b}番の票はありません', relClosed: '締め切ったレースの票は消せません', errBill: '会計番号を 2 けたで入れてください',
    testHead: 'テストレース', testSub: 'この店のテレビだけ・集計に入りません・当たっても払いません', testBtn: 'テストレースを始める', testAsk: 'テストレースを始めますか？',
    moreHead: 'その他', qHead: 'テレビの画質', qSub: 'casa DERBY を映しているとき', qNow: 'いま', qAsk: 'テレビの画質を「{q}」にしますか？', qAskSub: '1 分ほどでテレビに反映されます（レース中は終わってから）', qDone: '画質を「{q}」にしました。1 分ほどでテレビに反映されます',
    autoHead: 'このスマホの画面も自動で入れ替える', autoSub: 'テレビが casa SLOT のときは casa SLOT の紙幣のページに', on: 'する', off: 'しない', logout: '店舗を変える（ログアウト）', reload: '一覧を読み直す', close: '閉じる', cancel: 'やめる', yes: 'はい',
    pinChanged: 'PIN が変わりました。ログインし直してください', badPin: 'PIN が正しくありません', pinHead: '店舗の PIN（スタッフ用）', chooseStore: 'このスマホで使う店舗を選んでください', back: '戻る', login: 'ログイン', loadingStores: '店舗の一覧を読み込んでいます…', noCloud: 'クラウドに接続できません。通信を確認してください。', retry: '再試行', noStores: '店舗が登録されていません。', logoutAsk: 'この店舗からログアウトしますか？',
  };
  const QS3 = [['auto', 'なめらか優先', '重いときは自動で少し粗くして、動きをなめらかに'], ['', '標準', 'ふだんはこれ'], ['max', 'きれい優先', '影までくっきり。動きがカクカクすることがあります']];
  const QN = { lite: 'さらになめらか（最軽量）', auto: 'なめらか優先', '': '標準', max: 'きれい優先' }; // lite（2026-10-28）は管理画面だけで選べる。ここでは今の値として出すだけ（ボタンは 3 つのまま）
  const NAMES = { slot: 'casa SLOT', derby: 'casa DERBY' };
  const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? o[k] : ''));

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'casa.derby.staff.v1';
  const pad = (n) => ('0' + n).slice(-2);
  /* 時刻はいつも日本時間。2026-10-26 オーナー「25 時表記」: 営業日の時計（区切り dayStartHour＝ふだん 5 時より前は +24。深夜 1:00 → 25:00）。時は 0 を付けない（9:05・25:00）。
     中身の Core.fmtBizTime（0 付きの HH:MM）があればそれを使って先頭の 0 だけ取る */
  const dayStartHour = () => { const x = st && ((st.tuning && st.tuning.dayStartHour) != null ? st.tuning.dayStartHour : st.settings && st.settings.dayStartHour); const h = Number(x); return Number.isFinite(h) ? h : 5; };
  const hhmm = (ms) => {
    if (!ms) return '';
    const h = dayStartHour(), CORE = window.DerbyCore || window.Core;
    if (CORE && CORE.fmtBizTime) return String(CORE.fmtBizTime(ms, h)).replace(/^0(\d:)/, '$1');
    const d = new Date(ms + 9 * 3600e3), hr = d.getUTCHours(); return (hr < h ? hr + 24 : hr) + ':' + pad(d.getUTCMinutes());
  };
  /* 投票できる店（race.storeIds: 店の id の並び。null＝全店）と、その名前「渋谷・上野」（2026-10-26） */
  const canVote = (r) => !r || r.canVote === true || (r.canVote !== false && (!Array.isArray(r.storeIds) || !saved || r.storeIds.indexOf(saved.store) >= 0));
  const storeNames = (ids) => { const L = (st && st.stores) || []; return (ids || []).map((id) => { const s = L.find((x) => x.id === id); return s ? s.name : id; }).join('・'); };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + pad(s % 60); };
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const ptT = (n) => amt(n) + 'pt';
  const nwrap = (t) => esc(t).replace(/^(.+?)(（.+）)$/, '<span class="nw">$1</span><span class="nw">$2</span>'); // 「店舗を変える／（ログアウト）」の所でだけ折り返す
  const qs = new URLSearchParams(location.search);
  const qNorm = (v) => (v === 'auto' || v === 'max' || v === 'lite' ? v : '');

  let saved = null; // { store, name, pin }
  let C = null, st = null, online = false, unsub = null, wins = null, winsErr = '', sheet = null, busy = false, claiming = null;
  let tvLocal = null; // 切り替えた直後の値（状態が届くまで）{ game, at }
  let qLocal = null;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* noop */ } };
  const now = () => (C ? C.serverNow() : Date.now());

  /* 枠に入らない文字（ニックネーム・下のボタン）: 「…」で切らずに、まず小さく（data-fit の px まで）、それでも入らなければ 2 行に（2026-10-23 見直し） */
  function fitText(root) {
    if (!root) return;
    root.querySelectorAll('[data-fit]').forEach((el) => {
      el.style.fontSize = ''; el.classList.remove('wrap2');
      const w = el.clientWidth; if (!w || el.scrollWidth <= w + 1) return;
      const fs = parseFloat(getComputedStyle(el).fontSize), min = Number(el.dataset.fit) || 12;
      el.style.fontSize = Math.max(min, Math.floor((fs * w) / el.scrollWidth * 10) / 10) + 'px';
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add('wrap2');
    });
  }
  let fitT = 0;
  const fitAll = () => { fitText($('main')); fitText($('dock')); };
  window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fitAll, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
  /* お知らせ（3 秒）: 上の帯（ロゴ・「スロット｜競馬」・テレビ・レース）を隠さないように、帯のすぐ下に出す（2026-10-23 デザイン見直し 1 回目） */
  function toast(t, err, ms) {
    const el = $('toast'), top = document.querySelector('header.top'), lg = $('login');
    const b = top && !(lg && !lg.classList.contains('hidden')) ? Math.round(top.getBoundingClientRect().bottom) : 0;
    el.style.top = b > 0 ? (b + 8) + 'px' : '';
    el.textContent = t; el.className = 'toast' + (err ? ' err' : ''); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.add('hidden'), ms || 3000);
  }
  const errText = (e) => (e && !e.status ? TX.netErr : (e && e.body && e.body.message) || (e && e.message) || TX.failed);
  const pinGone = (e) => { if (!(e && (e.status === 401 || e.code === 'bad_pin'))) return false; closeSheet(); toast(TX.pinChanged, true, 4000); logout(true); return true; };
  /* 画面の中の確認の窓（ブラウザの確認は使わない） */
  function ask(title, text, okLabel, kind) { // kind: 'danger'＝取り消せない操作（赤）／'test'＝テスト（青）／なし＝金
    return new Promise((res) => {
      const old = $('askBox'); if (old) old.remove();
      const w = document.createElement('div'); w.id = 'askBox'; w.className = 'ask';
      w.innerHTML = '<div class="card" role="dialog" aria-modal="true"><h3>' + esc(title) + '</h3>' + (text ? '<p>' + esc(text) + '</p>' : '') + '<div class="row"><button type="button" class="btn ghost" data-r="0">' + esc(TX.cancel) + '</button><button type="button" class="btn ' + (kind === 'danger' ? 'danger' : kind === 'test' ? 'testgo' : 'ok') + '" data-r="1">' + esc(okLabel || TX.yes) + '</button></div></div>';
      w.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (!b && e.target !== w) return; w.remove(); res(!!b && b.dataset.r === '1'); });
      document.body.appendChild(w);
    });
  }

  /* ================= ログイン（店舗と PIN を 1 回だけ） ================= */
  const LOGO_H1 = '<h1 class="logo-h1"><img src="../art/logo-3d/B/lockup-3d-B-casaWhite.svg" width="120" height="39" alt="casa DERBY" draggable="false"><span>' + esc(TX.staff) + '</span></h1>';
  async function login() {
    const box = $('login'); box.classList.remove('hidden'); showMain(false);
    for (;;) {
      box.innerHTML = LOGO_H1 + '<p>' + esc(TX.loadingStores) + '</p>';
      let stores = null;
      try { stores = await window.DerbyCloud.create({ role: 'staff' }).stores(); } catch (e) { stores = null; }
      if (!stores || !stores.length) {
        box.innerHTML = LOGO_H1 + '<p>' + esc(stores ? TX.noStores : TX.noCloud) + '</p><div class="row"><button class="btn ok" id="retry">' + esc(TX.retry) + '</button></div>';
        await new Promise((r) => { $('retry').onclick = r; }); continue;
      }
      let id = qs.get('store');
      if (!stores.some((s) => s.id === id)) {
        box.innerHTML = LOGO_H1 + '<p>' + esc(TX.chooseStore) + '</p><div class="list">' + stores.map((s) => '<button class="item" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>').join('') + '</div>';
        id = await new Promise((r) => box.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => r(b.dataset.id); }));
      }
      const s = stores.find((x) => x.id === id);
      const ok = await new Promise((resolve) => {
        box.innerHTML = '<h1>' + esc(s.name) + '</h1><p>' + esc(TX.pinHead) + '</p><input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8"><div class="err" id="perr"></div><div class="row"><button class="btn ghost" id="back">' + esc(TX.back) + '</button><button class="btn ok" id="go">' + esc(TX.login) + '</button></div>';
        const inp = $('pin'); setTimeout(() => inp.focus(), 100);
        const check = async () => {
          const pin = inp.value.trim(); if (!pin) return;
          $('go').disabled = true;
          try { const c = window.DerbyCloud.create({ store: id, role: 'staff' }); await c.staffLogin(pin); saved = { store: id, name: s.name, pin }; save(); resolve(true); }
          catch (e) { $('go').disabled = false; $('perr').textContent = e.status === 401 || e.status === 403 || e.code === 'bad_pin' ? TX.badPin : errText(e); inp.value = ''; inp.focus(); }
        };
        $('go').onclick = check; inp.onkeydown = (e) => { if (e.key === 'Enter') check(); };
        $('back').onclick = () => resolve(false);
      });
      if (ok) break;
      if (qs.get('store')) { history.replaceState(null, '', location.pathname); qs.delete('store'); }
    }
    box.classList.add('hidden');
  }
  async function logout(force) {
    if (force !== true && !(await ask(TX.logoutAsk, '', TX.yes))) return;
    if (unsub) { try { unsub(); } catch (e) { /* noop */ } unsub = null; }
    saved = null; wins = null; st = null; try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
    closeSheet(); await login(); start();
  }
  function showMain(on) { ['main', 'dock', 'tvRow', 'nextRow'].forEach((id) => $(id).classList.toggle('hidden', !on)); if (on) setTimeout(fitAll, 0); }

  /* ================= 上: 店名・テレビ・次のレース ================= */
  function gameNow() {
    if (tvLocal && Date.now() - tvLocal.at < 15000) return tvLocal.game;
    const g = st && st.settings && st.settings.tvGame; if (g === 'slot' || g === 'derby') return g;
    const w = window.StaffSwitch && window.StaffSwitch.state && window.StaffSwitch.state.game; return w || null;
  }
  function drawTop() {
    $('store').className = 'store' + (online ? '' : ' off');
    const t = esc(saved ? saved.name : '') + ' ' + esc(online ? TX.online : '… ' + TX.waiting);
    if ($('storeText').innerHTML !== t) $('storeText').innerHTML = t;
    if (!saved) return;
    const g = gameNow(), to = g === 'derby' ? 'slot' : 'derby';
    const tv = '<span class="k">' + esc(TX.tv) + '</span><b class="g ' + (g || '') + '">' + (g ? NAMES[g] : '…') + '</b>' + (g ? '<button type="button" class="sw" data-act="tv" data-g="' + to + '">' + esc(to === 'slot' ? TX.toSlot : TX.toDerby) + '</button>' : '');
    if ($('tvRow').innerHTML !== tv) $('tvRow').innerHTML = tv;
    const nx = nextHtml() + todayHtml(); if ($('nextRow').innerHTML !== nx) $('nextRow').innerHTML = nx; // 3 行目: 本日のレースの時刻（2026-10-27）
  }
  /* いまのレース: 1 行目＝レースの状態、2 行目＝締切と票（2026-10-23 デザイン見直し 1 回目）。
     テストのレースのあいだ（準備中・投票中・レース中・結果画面）は 1 行目にいつも「テスト」の札 */
  function testActive(n) {
    if (!st) return false;
    if ([st.open, st.live].some((r) => r && r.test)) return true;
    const l = st.last; if (l && l.test && l.status !== 'void' && n < (l.endAt || ((l.revealAt || l.at) + 300000))) return true;
    const q = trS && trS.req; return !!(q && (trPending(q, n) || (q.raceAt && q.raceAt > n))); // 押したあと、レースができるまで（できたあとは上の open・live・last の test で分かる）
  }
  function nextHtml() {
    if (!st) return '';
    const n = now(), o = st.open, live = st.live, c = st.current;
    const tag = (r) => ((r && r.test) || testActive(n) ? '<i class="tt">' + esc(TX.test) + '</i>' : '');
    const l1 = (r, h) => '<div class="nl1">' + tag(r) + h + '</div>', l2 = (h) => (h ? '<div class="nl2">' + h + '</div>' : '');
    if (o) return l1(o, '<span>' + esc(fill(TX.voting, { t: hhmm(o.at) })) + '</span>') + l2('<span class="' + (o.closeAt - n < 15000 ? 'hot' : '') + '">' + esc(TX.closeIn) + ' <b>' + mmss(o.closeAt - n) + '</b></span><span>' + esc(fill(TX.votes, { n: ((o.participants && o.participants.byStore) || {})[saved.store] || 0 })) + '</span>');
    if (live) return l1(live, '<span>' + esc(fill(TX.racing, { t: hhmm(live.at) })) + '</span>') + l2(c ? '<span>' + esc(fill(TX.nextRace, { t: hhmm(c.at) })) + '</span>' : '');
    const nx = c || ((st.upcoming || []).filter((x) => x.at > n && canVote(x))[0]) || null; // この店が投票できるレースだけ（2026-10-26）
    /* この店が投票できないレースの投票中（state.watch。2026-10-26）: 1 行目「21:00 のレースは 渋谷 だけ（この店は投票なし）」、2 行目はこの店の次のレース */
    const w = st.watch && st.watch.closeAt > n && !canVote(st.watch) ? st.watch : null;
    if (w) return l1(w, '<span>' + esc(fill(TX.watchOnly, { t: hhmm(w.at), s: storeNames(w.storeIds) })) + '</span>') + l2(nx ? '<span>' + esc(fill(TX.nextRace, { t: hhmm(nx.at) })) + '</span><span>' + esc(fill(TX.voteFrom, { t: hhmm(nx.openAt || nx.at) })) + '</span>' : '<span>' + esc(TX.dayOver) + '</span>');
    if (!nx) return l1(null, '<span>' + esc(TX.dayOver) + '</span>');
    return l1(nx, '<span>' + esc(fill(TX.nextRace, { t: hhmm(nx.at) })) + '</span>') + l2('<span>' + esc(fill(TX.voteFrom, { t: hhmm(nx.openAt || nx.at) })) + '</span>');
  }

  /* 本日のレースの時刻（2026-10-27 オーナー「本日の出走時間を店ごとにテレビとスマホへ」。お客さんのスマホと同じ見せ方）: state.today ＝ 時刻表のうち、この営業日のこの店が投票できるレースだけ。
     上の段の 3 行目に「本日のレース 13:00 ✓ 16:00 ✓ 19:00 次 22:00」。済みは薄く ✓・次は金の枠。state に today が無い（古い中身）なら出さない */
  function todayHtml() {
    const L = st && Array.isArray(st.today) ? st.today : null; if (!L) return '';
    const n = now(), ni = L.findIndex((x) => x.at > n);
    if (!L.length) return '<div class="nl3 today"><span class="tl">' + esc(TX.todayHead) + '</span><span class="none">' + esc(TX.todayNone) + '</span></div>';
    const MAX = 8, from = L.length <= MAX ? 0 : Math.max(0, Math.min(ni < 0 ? L.length - 1 : ni - 1, L.length - MAX)), to = Math.min(L.length, from + MAX); // 札は 8 つまで（お客さんのスマホと同じ。前後は「…」）
    return '<div class="nl3 today"><span class="tl">' + esc(TX.todayHead) + '</span><span class="rcs">' + (from ? '<span class="more">…</span>' : '') + L.slice(from, to).map((x, k) => { const i = k + from, done = x.at <= n, nx = i === ni; return '<span class="rc' + (done ? ' done' : nx ? ' nx' : '') + '"><b>' + hhmm(x.at) + '</b>' + (done ? '<i>✓</i>' : nx ? '<i>' + esc(TX.todayNext) + '</i>' : '') + '</span>'; }).join('') + (to < L.length ? '<span class="more">…</span>' : '') + '</span></div>';
  }

  /* ================= 真ん中: 今日の当たり ================= */
  const combo = (w) => (w.first != null && w.second != null ? (w.first + 1) + '→' + (w.second + 1) : '');
  function winRow(w) {
    const meta = (w.raceAt ? '<span class="nw">' + esc(fill(TX.race, { t: hhmm(w.raceAt) })) + '</span>' : '') + (combo(w) ? (w.raceAt ? '・' : '') + '<span class="nw">' + esc(combo(w)) + '</span>' : '') + (w.n === 2 ? '<span class="v2t">' + esc(TX.vote2) + '</span>' : ''); // 折り返すときは「・」で。初参加ボーナスの 2 票目には小さな札
    /* 2026-10-23 見直し: 1 行目＝ニックネーム（幅いっぱい・「…」で切らない）、2 行目＝レース・組み合わせと額。番号は左に 2 行ぶん */
    const head = '<span class="bill">' + esc(w.bill) + '</span><b class="nk" data-fit="12">' + esc(w.nick) + '</b><small class="meta">';
    const wa = '<span class="wa">' + amt(w.amount) + '<small>pt</small></span>';
    if (w.status === 'unpaid') {
      return '<div class="win unpaid" data-pid="' + esc(w.pid) + '"><div class="wl">' + head + meta + '</small>' + wa + '</div>' +
        '<div class="slider" data-pid="' + esc(w.pid) + '" role="slider" aria-label="' + esc(w.bill + '番 ' + TX.slide) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fillbar"></div><span class="lbl">' + esc(TX.slide) + ' ›››</span><div class="knob" aria-hidden="true">›</div></div></div>';
    }
    const sub = w.status === 'paid' ? esc(fill(TX.paidAt, { t: hhmm(w.paidAt) })) + '<span class="via">' + esc(w.paidVia === 'self' ? TX.viaSelf : TX.viaStaff) + '</span>' : esc(w.status === 'expired' ? TX.expired : TX.voided);
    return '<div class="win ' + esc(w.status) + '" data-pid="' + esc(w.pid) + '"><div class="wl">' + head + sub + (w.n === 2 ? '<span class="v2t">' + esc(TX.vote2) + '</span>' : '') + '</small>' + wa + '</div></div>';
  }
  function drawMain() {
    const m = $('main'); if (!m || !saved) return;
    if (dragging) { drawLater = true; return; } // スライドを動かしている途中は描き直さない
    drawLater = false;
    let h = '<div class="whead"><h2>' + esc(TX.winsHead) + '</h2>';
    if (!wins) { m.innerHTML = h + '</div><p class="empty">' + esc(winsErr || TX.connecting) + '</p>'; return; }
    const un = wins.filter((w) => w.status === 'unpaid'), pd = wins.filter((w) => w.status === 'paid'), rest = wins.filter((w) => w.status !== 'unpaid' && w.status !== 'paid');
    const ppl = (l) => new Set(l.map((w) => w.raceId + '~' + w.bill)).size; // 人数（初参加ボーナスの 2 票が両方当たっても 1 人）
    h += '<span class="cnt"><b class="u">' + esc(fill(TX.unpaidN, { n: ppl(un) })) + '</b><span>' + esc(fill(TX.paidN, { n: ppl(pd) })) + '</span></span></div>';
    if (winsErr) h += '<p class="warn">' + esc(winsErr) + '</p>';
    if (!wins.length) h += '<p class="empty">' + esc(TX.noWins) + '</p>';
    h += '<div class="wins">' + un.map(winRow).join('') + (un.length && (pd.length || rest.length) ? '<div class="sep"></div>' : '') + pd.map(winRow).join('') + rest.map(winRow).join('') + '</div>';
    m.innerHTML = h;
    m.querySelectorAll('.slider').forEach(bindSlider);
    fitText(m);
  }
  let winsSeq = 0, winsAt = 0;
  async function loadWins() {
    if (!C || !saved) return; const my = ++winsSeq; winsAt = Date.now();
    try { const d = await C.wins(saved.pin); if (my !== winsSeq) return; setWins(d.wins || []); winsErr = ''; }
    catch (e) { if (my !== winsSeq) return; if (pinGone(e)) return; winsErr = TX.loadErr + '（' + errText(e) + '）'; drawMain(); }
  }
  function setWins(list) { const k = JSON.stringify(list); if (k === setWins.k && !winsErr) return; setWins.k = k; wins = list; drawMain(); }

  /* ---------- スライドで「渡した」 ---------- */
  let dragging = false, drawLater = false;
  function bindSlider(el) {
    const knob = el.querySelector('.knob'), bar = el.querySelector('.fillbar');
    let x0 = null, dx = 0, max = 0;
    const set = (x) => { knob.style.transform = 'translateX(' + x + 'px)'; bar.style.width = (x + knob.offsetWidth / 2) + 'px'; el.setAttribute('aria-valuenow', String(Math.round(max ? (x / max) * 100 : 0))); };
    el.addEventListener('pointerdown', (e) => {
      if (claiming || el.classList.contains('busy')) return;
      const k = knob.getBoundingClientRect(); if (e.clientX < k.left - 12 || e.clientX > k.right + 12) return; // つまみから始めたときだけ
      x0 = e.clientX; dx = 0; max = el.clientWidth - knob.offsetWidth - 8; el.classList.add('drag'); dragging = true;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* noop */ }
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (x0 == null) return; dx = Math.max(0, Math.min(max, e.clientX - x0)); set(dx); });
    const end = () => {
      if (x0 == null) return; x0 = null; el.classList.remove('drag'); dragging = false;
      if (max > 0 && dx >= max * 0.9) { set(max); claim(el.dataset.pid, el); } else { dx = 0; set(0); if (drawLater) drawMain(); }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  async function claim(pid, el) {
    const w = (wins || []).find((x) => x.pid === pid); if (!w || claiming) return;
    claiming = pid; el.classList.add('busy'); const lb = el.querySelector('.lbl'); if (lb) lb.textContent = TX.saving;
    try {
      const d = await C.claim(saved.pin, pid); const p = (d && d.payout) || {};
      toast(fill(TX.gave, { b: p.bill || w.bill, n: p.nick || w.nick, a: ptT(p.amount || w.amount) }), false, 4000);
    } catch (e) {
      if (!pinGone(e)) {
        if (e.code === 'network' || !e.status) { // 返事が来なかった: 読み直して記録できていたら「渡した」
          claiming = null; await loadWins(); const x = (wins || []).find((y) => y.pid === pid);
          if (x && x.status === 'paid') toast(fill(TX.gave, { b: x.bill, n: x.nick, a: ptT(x.amount) }), false, 4000); else toast(TX.netErr, true, 4000);
          return;
        }
        const pp = e.body && e.body.payout;
        toast(e.code === 'already_paid' ? TX.alreadyPaid + (pp && pp.paidAt ? '（' + hhmm(pp.paidAt) + '）' : '') : e.code === 'expired' ? TX.expiredMsg : e.code === 'void' ? TX.voidMsg : errText(e), true, 4500);
      }
    }
    claiming = null; await loadWins(); drawMain();
  }

  /* ================= 下: シート（番号を空ける・テストレース・その他） ================= */
  function openSheet(name) { sheet = name; if (name === 'test') testPoll(true); drawSheet(); }
  function closeSheet() { sheet = null; relBill = ''; relMsg = null; const s = $('sheet'); s.className = 'sheet hidden'; s.innerHTML = ''; }
  function drawSheet() {
    const s = $('sheet'); if (!sheet) return closeSheet();
    const h = sheet === 'release' ? relHtml() : sheet === 'test' ? testHtml() : moreHtml();
    const close = '<button type="button" class="btn ghost close" data-act="close">' + esc(TX.close) + '</button>';
    const fresh = s.classList.contains('hidden'); // 開いたときだけ下から出す（描き直しのたびに薄く出し直さない）
    s.className = 'sheet'; s.innerHTML = '<div class="card ' + esc(sheet) + (fresh ? ' in' : '') + '">' + (sheet === 'release' ? h.replace('<!--close-->', close) : h + close) + '</div>'; // 番号を空ける: 「閉じる」と「空ける」を横に並べる（低いスマホでも 1 画面に入るように。2026-10-23）
  }
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet' && !busy) closeSheet(); });

  /* ---- 番号を空ける ---- */
  let relBill = '', relMsg = null; // relMsg: { ok, text }
  const relRace = () => { const r = (st && st.current) || null; return r && canVote(r) ? r : null; }; // いまのレース（投票中か投票前）。この店が投票できないレース（2026-10-26 の watch）は対象外＝「いま投票できるレースがありません」
  function relHtml() {
    const r = relRace(), b = relBill, keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'];
    const dg = b.length === 2 ? '<span class="dg">' + esc(b[0]) + '</span><span class="dg">' + esc(b[1]) + '</span>' : b.length === 1 ? '<span class="dg ph">0</span><span class="dg">' + esc(b) + '</span>' : '<span class="dg"></span><span class="dg"></span>';
    return '<h3>' + esc(TX.relHead) + '</h3>' + (r ? '<p>' + esc(fill(TX.relSub, { t: hhmm(r.at) })) + '</p>' : '<p class="warn">' + esc(TX.relNone) + '</p>') +
      '<div class="digits" id="relDigits">' + dg + '</div>' +
      (relMsg ? '<div class="msg ' + (relMsg.ok ? 'ok' : 'ng') + '" id="relMsg" role="status">' + esc(relMsg.text) + '</div>' : '') +
      '<div class="keypad">' + keys.map((k) => '<button type="button" data-rkey="' + k + '"' + (k === 'clr' ? '>消す' : k === 'del' ? ' aria-label="1文字消す">⌫' : '>' + k) + '</button>').join('') + '</div>' +
      '<div class="row acts"><!--close--><button type="button" class="btn danger big" data-act="release"' /* 取り消せない操作は赤（金は前に進む操作だけ） */ + (r && !busy ? '' : ' disabled') + '>' + esc(TX.relBtn) + '</button></div>';
  }
  async function doRelease() {
    const r = relRace(); if (!r || busy) return;
    const b = relBill; if (!/^\d{1,2}$/.test(b) || Number(b) < 1) { relMsg = { ok: false, text: TX.errBill }; return drawSheet(); }
    const bill = pad(Number(b));
    if (!(await ask(fill(TX.relAsk, { b: bill }), fill(TX.relAskSub, { t: hhmm(r.at) }), TX.relBtn, 'danger'))) return;
    busy = true; drawSheet();
    try {
      const d = await C.release(saved.pin, bill, r.id);
      relMsg = d.released ? { ok: true, text: fill(TX.relDone, { b: bill }) } : { ok: false, text: fill(TX.relNoVote, { b: bill }) };
      if (d.released) relBill = '';
    } catch (e) {
      if (pinGone(e)) { busy = false; return; }
      relMsg = { ok: false, text: e.code === 'closed' ? TX.relClosed : e.code === 'no_open_race' ? TX.relNone : e.code === 'bad_bill' ? TX.errBill : errText(e) };
    }
    busy = false; drawSheet();
  }

  /* ---- テストレース（この店だけ・投票 1 分・当たっても払わない） ----
     押せないとき: 進行役のテレビがいない／この店でレースの投票中・レース中（結果が出るまで）／押したあと（準備中・そのレースの結果が出るまで）。
     結果の画面のあいだは押せる（2026-10-25 オーナー「テストレースは何度でも走らせられるように」。押すとテレビは結果の画面を閉じて投票の画面になる）。
     テレビが casa SLOT なら、押すと casa DERBY に切り替えてから（Firestore 版は切り替えの時間をとって 2 分後に発走）。 */
  const TEST_SEC = 60; // core.js の TEST_RACE.quickSec（押してから発走まで。投票はその 60 秒）
  const SWITCH_SEC = 120, TV_WAIT_MS = 300000, GRACE_MS = 20000; // core.js の TEST_RACE の switchSec・tvWaitSec・tvGraceSec
  let trS = null, trAt = 0, trBusy = false, trT = 0, trMsg = '';
  const trPending = (r, n) => !!r && !r.raceId && !r.err && n - r.at < TV_WAIT_MS + 15000;
  const numOr = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
  function trClash(n, sec) { // { now: 結果が出る時刻 } ＝投票中・レース中／レース ＝もうすぐ次のレース／null ＝ぶつからない（core.js の testRaceBusy と同じ考え方。結果の画面はふさがない）
    if (!st) return null;
    const S = st.settings || {}, gate = S.scenes && S.scenes.gate === false ? 0 : numOr(S.gateSec, 8), post = numOr(S.postSec, 28), vote = numOr(S.voteSec, 180);
    const end = n + (sec + gate + 60 + post) * 1000, seen = new Set();
    for (const r of [st.live, st.last, st.open, st.next].filter((x) => x && !seen.has(x.id) && seen.add(x.id))) {
      if (r.status === 'void') continue;
      const s = r.openAt != null ? r.openAt : r.at - vote * 1000, e = r.revealAt || (r.runAt || r.at) + 60000 + post * 1000;
      if (s < end && e > n) return s <= n ? { now: e } : r;
    }
    return null;
  }
  function testWhy() { // [文, 押せない]
    const n = now(), r = trS && trS.req;
    if (!trS) return ['読み込み中…', true];
    if (trPending(r, n)) return [n - r.at < GRACE_MS || !trS.decider ? 'テレビを casa DERBY に切り替えています…' : r.wait ? 'テレビはスロットのゲーム中です。終わってから切り替えます' : '準備中…（進行役のテレビがレースを作っています）', true];
    if (r && r.raceAt && r.raceAt > n && !(st && st.last && st.last.id === r.raceId)) return ['テストのレース 発走まで ' + mmss(r.raceAt - n), true]; // 発走の前（管理画面で先に発表したレースは除く）
    if (!trS.decider && !trS.wake) return [trS.deciderStore && trS.deciderGame === 'slot' ? '進行役のテレビ（' + (trS.deciderName || trS.deciderStore) + '）が casa SLOT になっています' : '進行役のテレビがありません', true];
    const sw = trS.game === 'slot' && !trS.wake, c = trClash(n, sw ? SWITCH_SEC : TEST_SEC);
    if (c && c.now) return ['レース中 … あと ' + mmss(Math.max(0, c.now - n)) + '（結果が出たら押せます）', true];
    if (c) return ['もうすぐ次のレース（' + hhmm(c.at) + ' 発走）があるので押せません', true];
    if (r && r.err === 'busy' && n - r.at < 120000) return ['作れませんでした（もうすぐ次のレースです）', true];
    return [trMsg, false];
  }
  function testHint() {
    if (!trS || trS.game !== 'slot') return '押すと 1 分後に発走します（投票 1 分）';
    return '押すとテレビを casa DERBY に切り替えて、' + (trS.wake ? '進行役のテレビが戻ってから ' : '') + '2 分後に発走します（投票は最後の 1 分。スロットのゲーム中は終わるまで待ちます）';
  }
  function testHtml() {
    const [t, off] = testWhy();
    return '<h3>' + esc(TX.testHead) + '</h3><p>' + esc(TX.testSub) + '</p><p class="now" id="trNow">' + esc(t || testHint()) + '</p>' +
      '<button type="button" class="btn testgo big" data-act="test"' /* テストは青い枠と青い文字 */ + (off || trBusy ? ' disabled' : '') + '>' + esc(TX.testBtn) + '</button>';
  }
  function paintTest() { if (sheet !== 'test') return; const el = $('trNow'), b = document.querySelector('[data-act=test]'); if (!el || !b) return drawSheet(); const [t, off] = testWhy(); const tx = t || testHint(); if (el.textContent !== tx) el.textContent = tx; b.disabled = off || trBusy; }
  async function testPoll(force) {
    clearTimeout(trT);
    if (sheet !== 'test' || !C || !C.testRaceStatus) return;
    if (force || Date.now() - trAt > 2500) { try { trS = await C.testRaceStatus(saved.pin); trAt = Date.now(); } catch (e) { if (pinGone(e)) return; } }
    paintTest();
    const r = trS && trS.req; trT = setTimeout(testPoll, trPending(r, now()) ? 3000 : 15000);
  }
  async function testPress() {
    const [, off] = testWhy(); if (off || trBusy) return;
    if (!(await ask(TX.testAsk, testHint(), TX.testBtn, 'test'))) return;
    trBusy = true; paintTest();
    try { const d = await C.testRace(saved.pin, TEST_SEC, { switchTv: true }); toast(d && d.switched ? 'テレビを casa DERBY に切り替えました' : d && d.raceId ? 'テストのレースを作りました' : 'テストのレースをお願いしました'); trMsg = ''; }
    catch (e) { if (!pinGone(e)) { const m = e.code === 'busy' ? 'いまはテストのレースを作れません（投票中・レース中か、もうすぐ次のレースです）' : e.code === 'too_soon' ? '少し待ってからもう一度押してください' : e.code === 'no_decider' ? '進行役のテレビがありません' : errText(e); toast(m, true, 4500); trMsg = m; } }
    trBusy = false; testPoll(true);
  }

  /* ---- その他: テレビの画質・自動で入れ替え・店舗を変える ---- */
  function qNow() { if (qLocal && Date.now() - qLocal.at < 15000) return qLocal.q; const v = st && st.settings && typeof st.settings.tvQuality === 'string' ? qNorm(st.settings.tvQuality) : undefined; return v; }
  function moreHtml() {
    const q = qNow(), SW = window.StaffSwitch;
    return '<h3>' + esc(TX.moreHead) + '</h3>' +
      '<div class="tq"><h4>' + esc(TX.qHead) + '<small>' + esc(TX.qSub) + '</small></h4><p class="now">' + esc(TX.qNow) + ': <b id="tvqNow">' + (q === undefined ? '…' : QN[q]) + '</b></p>' +
      '<div class="three">' + QS3.map(([v, name, note]) => '<button type="button" data-tvq="' + v + '" class="' + (q === v ? 'cur' : '') + '"' + (q === v || busy ? ' disabled' : '') + '><b>' + name + '</b><small>' + note + '</small></button>').join('') + '</div></div>' +
      (SW && SW.home && SW.home() ? '<div class="auto"><span>' + esc(TX.autoHead) + '<small>' + esc(TX.autoSub) + '</small></span><button type="button" data-act="auto">' + esc(SW.auto() ? TX.on : TX.off) + '</button></div>' : '') +
      '<div class="row2"><button type="button" class="btn ghost" data-act="reload">' + esc(TX.reload) + '</button><button type="button" class="btn ghost" data-act="logout">' + nwrap(TX.logout) + '</button></div>';
  }
  async function setQuality(v) {
    if (busy || v === qNow()) return;
    if (!(await ask(fill(TX.qAsk, { q: QN[v] }), TX.qAskSub, TX.change))) return;
    busy = true; drawSheet();
    try { const r = await C.tvQuality(saved.pin, v); qLocal = { q: qNorm(r && r.tvQuality != null ? r.tvQuality : v), at: Date.now() }; toast(fill(TX.qDone, { q: QN[qLocal.q] }), false, 4000); }
    catch (e) { if (!pinGone(e)) toast(errText(e), true); }
    busy = false; if (sheet) drawSheet();
  }
  async function setGame(g) {
    if (busy || (g !== 'slot' && g !== 'derby')) return;
    if (!(await ask(fill(TX.tvAsk, { s: saved.name, g: NAMES[g] }), TX.tvAskSub, TX.change))) return;
    busy = true;
    try { await C.tvGame(saved.pin, g); tvLocal = { game: g, at: Date.now() }; toast(fill(TX.tvDone, { g: NAMES[g] })); if (window.StaffSwitch && window.StaffSwitch.kick) window.StaffSwitch.kick(); }
    catch (e) { if (!pinGone(e)) toast(errText(e), true); }
    busy = false; drawTop();
  }

  /* ================= 操作 ================= */
  document.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-sheet]'); if (sb) { openSheet(sb.dataset.sheet); return; }
    const rk = e.target.closest('[data-rkey]');
    if (rk) { const k = rk.dataset.rkey; relMsg = null; if (k === 'clr') relBill = ''; else if (k === 'del') relBill = relBill.slice(0, -1); else relBill = relBill.length >= 2 ? k : relBill + k; return drawSheet(); }
    const tq = e.target.closest('[data-tvq]'); if (tq && !tq.disabled) return setQuality(qNorm(tq.dataset.tvq));
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'close') { if (!busy) closeSheet(); return; }
    if (a === 'release') return doRelease();
    if (a === 'test') return testPress();
    if (a === 'tv') return setGame(b.dataset.g);
    if (a === 'reload') { closeSheet(); return loadWins(); }
    if (a === 'logout') { closeSheet(); return logout(); }
    if (a === 'auto') { const SW = window.StaffSwitch; if (SW && SW.setAuto) SW.setAuto(!SW.auto()); return drawSheet(); }
  });

  /* ================= 起動・リアルタイム ================= */
  let lastRaceKey = '';
  function start() {
    C = window.DerbyCloud.create({ store: saved.store, role: 'staff' });
    showMain(true); wins = null; winsErr = ''; setWins.k = null; drawTop(); drawMain();
    C.syncClock().catch(() => {});
    C.state().then((d) => { st = d; online = true; drawTop(); }).catch(() => { online = false; drawTop(); });
    loadWins();
    if (unsub) unsub();
    unsub = C.subscribe({
      open() { online = true; drawTop(); },
      error() { online = false; drawTop(); },
      state(s) {
        const g0 = st && st.settings && st.settings.tvGame;
        st = s; online = true; drawTop();
        if (s.settings && s.settings.tvGame !== g0 && window.StaffSwitch && window.StaffSwitch.kick) window.StaffSwitch.kick(); // テレビのゲームが変わった → スマホの画面の入れ替えを確かめる
        const k =[s.last && s.last.id, s.last && s.last.status, s.day].join('|'); // 発表があった・営業日が変わった → 一覧を読み直す
        if (k !== lastRaceKey) { const first = !lastRaceKey; lastRaceKey = k; if (!first) loadWins(); }
        if (sheet === 'release' && !busy) { const r = relRace(), d = $('sheet') && $('sheet').querySelector('[data-act=release]'); if (d && d.disabled !== !r) drawSheet(); }
      },
      payout() { loadWins(); }, // 模擬クラウド: 受け取りの合図だけ届く
      wins(d) { if (d && Array.isArray(d.wins)) { winsErr = ''; setWins(d.wins); } }, // Firestore 版: 一覧そのものが届く
    });
  }
  setInterval(() => {
    if (!saved || !C) return;
    drawTop();
    if (sheet === 'test') paintTest();
    if (!document.hidden && Date.now() - winsAt > 20000) loadWins(); // 通知が届かない環境の保険
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && saved && C) { C.syncClock().catch(() => {}); loadWins(); } });

  window.STAFF = {
    get saved() { return saved; }, get C() { return C; }, get st() { return st; }, get wins() { return wins; }, get sheet() { return sheet; },
    get sheetOpen() { return !!sheet || !!claiming || dragging || !!$('askBox'); }, // v2/staffswitch.js が見る（途中では画面を入れ替えない）
    gameNow, onGame() { drawTop(); }, loadWins, openSheet, closeSheet, TX, hhmm, canVote,
    test: { why: testWhy, hint: testHint, press: testPress, get s() { return trS; }, sec: TEST_SEC },
  };

  (async function boot() {
    if (!window.DerbyCloud) { $('login').classList.remove('hidden'); $('login').innerHTML = LOGO_H1 + '<p>読み込みに失敗しました。ページを開き直してください。</p>'; return; }
    saved = load();
    if (qs.get('store') && saved && saved.store !== qs.get('store')) saved = null;
    if (!saved || !saved.store || !saved.pin) await login();
    start();
  })();
})();
