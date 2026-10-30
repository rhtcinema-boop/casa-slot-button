/* casa DERBY v4 お客さんのスマホ（bet.html?store=<id>）。2026-10-21 作り直し（仕様書_v4_大改修.md「スマホとテレビの細かい所」・v2/V4_CORE_NOTES.md 8 章）。
   通信は v2/client.js（DerbyCloud）だけ。模擬クラウドも Firestore も同じ呼び方。
   流れ: ①待ち（次のレース・投票の始まり）→ ②会計番号 2 けた（数字のボタン）＋ニックネーム → ③予想（馬の情報＋6×6 の表）→ ④確認 → 投票する
         → ⑤投票済み（あなたの予想・選び直す・締切まで）→ ⑥レース中（あなたの予想だけ）→ ⑦結果（当たり: 額・会計番号・スタッフが動かすスライド／はずれ: 結果と次のレース）
   覚えるもの: 会計番号・ニックネームは覚えない（毎回入れる）。そのレースの票の持ち主であることだけ（DerbyCloud.myVotes。client.js が自動で覚える）。
   言葉は下の TX にまとめた（文字帳で直す。ふつうの文字のまま）。音は鳴らさない。テスト用に window.BET を出す。 */
(function () {
  'use strict';
  /* ================= 言葉（文字帳） ================= */
  const TX = {
    connecting: '接続中…', offline: '通信が切れています', waiting: '接続を待っています',
    noStore: 'テレビの QR から開いてください', badStore: 'お店が見つかりません', loading: '読み込み中…',
    test: 'テストレース',
    waitHead: '次のレース', waitVoteFrom: '投票は {t} から', waitLeft: '投票の始まりまで', dayOver: '本日のレースは終わりました',
    prep: '準備中です。少しお待ちください（自動で始まります）', prepStaff: 'スタッフにお知らせください', /* 2026-10-28: 投票の始まりを過ぎたのにレースがまだできていない（0:00 のまま止まって見えた） */
    billHead: '会計番号', billSub: '伝票の番号（2けた）', nickHead: 'ニックネーム', nickSub: '8文字まで・当たるとテレビに出ます', toPick: '予想をえらぶ',
    errBill: '会計番号を 2 けたで入れてください', errNick: 'ニックネームを入れてください',
    pickHead: '1着と2着をえらぶ', pickAxis: '縦が1着・横が2着', pickTap: 'マスを押してください', cond: '調子', style: '脚質', recent: '近走',
    confHead: 'この予想で投票しますか？', ifWin: '当たれば', shiftNote: '倍率は締切のときに少し変わることがあります',
    voteBtn: '投票する', changeBtn: 'この予想に変える', back: '戻る', sending: '送っています…',
    voted: '投票しました', yourPick: 'あなたの予想', closeIn: '締切まで', redo: '選び直す',
    resultWait: '結果を待っています', racing: 'レース中',
    win: '当たり', amount: '当選額', staffOps: 'スタッフが操作します', slide: 'スライドして受け取り', saving: '記録しています…',
    paid: '受け取り済み', expired: '受け取りの期限が切れました', voided: 'このレースは取り消しになりました', testNoPay: 'テストなので受け取りはありません',
    lose: 'はずれ', result: '結果', toNext: '次のレースへ', toNextVote: '次のレースに投票する',
    nextRace: '次のレース {t}', nextVote: '投票は {t} から',
    todayHead: '本日のレース', todayNext: '次', todayNone: '本日のこの店のレースはありません', /* 本日の出走時間（2026-10-27） */
    billTaken: 'この番号はもう使われています', billTakenSub: 'スタッフに伝えてください\n番号を空けてもらうと投票できます', /* 2026-10-24 文字帳 w0030: 2 行で（\n で改行） */
    closed: '締め切りました', notOpen: '投票はまだ始まっていません', noOpen: 'いま投票できるレースがありません',
    netErr: '通信できませんでした。もう一度押してください', retry: 'もう一度お試しください',
    released: '番号が空けられました。もう一度投票できます',
    unpaid: '受け取っていない当たりがあります', unpaidBtn: '{b}番 {a} を受け取る',
    claimNet: '通信できませんでした。もう一度スライドしてください',
    /* 初参加ボーナス（2026-10-24 オーナー決定: そのスマホで初めて投票するレースで、その日その番号で 1 回だけ 2 票） */
    bonusHead: '初参加ボーナス：もう1票', bonusSub: '同じ組み合わせでもOK・当たればそれぞれお支払い', bonusBtn: 'もう1票えらぶ', bonusTag: '初参加ボーナス',
    vote1: '1票目', vote2: '2票目', pick2Head: '2票目をえらぶ', pick2Sub: '金の点が1票目・同じ組み合わせでもえらべます', vote2Btn: '2票目を投票する',
    redo1: '1票目を選び直す', redo2: '2票目を選び直す', noBonus: '初参加ボーナスの2票目は使えません',
    times: '{a} × {n}票', hitMark: '当たり', missMark: 'はずれ', slideAll: 'スライドして2票分受け取り',
    /* この店は投票できないレース（2026-10-26 オーナー: レースごとに投票できる店を選べる）。待ち画面の上の知らせと、送ってしまったときのお知らせ */
    watchOnly: 'いまの {t} のレースは {s} だけの開催です', notMyStore: 'このレースはこの店では投票できません',
    /* 2026-10-28 速さと「必ず開ける・必ず投票できる」: つながるまでの知らせと、投票の自動の送り直し */
    bootSlow: '通信に時間がかかっています。自動でつなぎ直しています', reload: '読み込み直す',
    sendSlow: '時間がかかっています。このままお待ちください', sendRetry: '通信が不安定です。自動で送り直しています（{n}回目）',
    checking: '最新状況を確認中…', closedSend: '受付できませんでした（締め切りました）', ownerChanged: 'この端末の記録が変わったため、ここからは選び直せません。変更はスタッフにお伝えください',
    sendQueued: '電波が戻ったら自動で送ります（締切 {t} まで）', sendFail: '送れませんでした。電波が戻ると自動で送ります', resend: 'もう一度送る',
    /* 2026-10-29 オーナー「投票終わった端末のみレースを観測できるように」: 投票した人だけの「レースを見る」（テレビと同じ画面。v2/watch.js） */
    watchBtn: 'レースを見る', watchSub: 'テレビと同じ画面',
  };
  const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? o[k] : ''));

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = new URLSearchParams(location.search);
  const STORE = (qs.get('store') || '').trim().toLowerCase();
  const DC = window.DerbyCloud || null, MV = DC && DC.myVotes, F = window.DerbyForm || null;
  const C = DC && STORE ? DC.create({ store: STORE, role: 'phone' }) : null;
  const now = () => (C ? C.serverNow() : Date.now());
  const MAX_NICK = 8, VKEY = 'casa.derby.vote.'; // VKEY: client.js の myVotes の置き場所（受け取っていない当たりを探すときだけ読む）
  const FRAME = ['#f4f4f4', '#1a1a1e', '#d6332b', '#2459c9', '#f2c531', '#2a9a4a'], INK = ['#111', '#fff', '#fff', '#fff', '#111', '#fff'];

  /* ================= 小さな道具 ================= */
  const pad = (n) => ('0' + n).slice(-2);
  const JST = (ms) => new Date(ms + 9 * 3600e3); // いつも日本時間（テレビと同じ）
  /* 2026-10-26 オーナー「25 時表記」: 時刻は営業日の時計で出す（区切り dayStartHour＝ふだん 5 時より前の時刻は +24。深夜 1:00 → 25:00）。
     時は今までどおり 0 を付けない（9:05・19:00・25:00）。中身の Core.fmtBizTime（0 付きの HH:MM）があればそれを使って先頭の 0 だけ取る */
  const dayStartHour = () => { const x = st && ((st.tuning && st.tuning.dayStartHour) != null ? st.tuning.dayStartHour : st.settings && st.settings.dayStartHour); const h = Number(x); return Number.isFinite(h) ? h : 5; };
  const hhmm = (ms) => {
    const h = dayStartHour(), CORE = window.DerbyCore || window.Core;
    if (CORE && CORE.fmtBizTime) return String(CORE.fmtBizTime(ms, h)).replace(/^0(\d:)/, '$1');
    const d = JST(ms), hr = d.getUTCHours(); return (hr < h ? hr + 24 : hr) + ':' + pad(d.getUTCMinutes());
  };
  /* 投票できる店（race.storeIds: 店の id の並び。null＝全店）。名前は「渋谷・上野」のように「・」でつなぐ */
  const canVote = (r) => !r || r.canVote === true || (r.canVote !== false && (!Array.isArray(r.storeIds) || r.storeIds.indexOf(STORE) >= 0));
  const storeNames = (ids) => { const L = (st && st.stores) || []; return (ids || []).map((id) => { const s = L.find((x) => x.id === id); return s ? s.name : id; }).join('・'); };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return (s >= 3600 ? Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ':' + pad(s % 60); };
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const ptH = (n) => amt(n) + '<small class="pt">pt</small>', ptT = (n) => amt(n) + 'pt';
  const payFor = (o) => (F ? F.payFor(o) : Math.ceil(Math.max(10, Math.round(Number(o) * 10)) / 10 - 1e-9) * 100);
  const oddsTxt = (o) => (F ? F.odds(o) : (Number(o) > 0 ? (Math.round(Number(o) * 10) / 10).toFixed(1) : '—'));
  const stageOf = (r) => (DC && DC.stage ? DC.stage(r, now()) : null);
  function cutNick(s) { // 8 文字（サーバーと同じコードポイントの数え方）まで。絵文字の途中では切らない
    if (Array.from(s).length <= MAX_NICK) return s;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) { let out = '', n = 0; for (const g of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s)) { const c = Array.from(g.segment).length; if (n + c > MAX_NICK) break; out += g.segment; n += c; } return out; }
    return Array.from(s).slice(0, MAX_NICK).join('');
  }
  const cleanNick = (s) => cutNick(String(s || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim());
  const billOk = (b) => /^\d{1,2}$/.test(b) && Number(b) >= 1 && Number(b) <= 99;
  const bill2 = (b) => String(b).padStart(2, '0');

  /* ================= 状態 ================= */
  let screen = 'boot', st = null, online = true, unsub = null, subVid = null, busy = false;
  let draft = null;            // 入力中（メモリーだけ）: { raceId, bill, nick, first, second, redo, n（2 ＝ 初参加ボーナスの 2 票目）, err }
  let my = null;               // 見ている自分の票: { raceId, vid, key, vote, vote2（2 票目 | null）, bonus（いま 2 票目を入れられる）, race, kind: 'cur'|'live'|'last'|'pin' }
  let pinned = null;           // 「受け取っていない当たり」から開いた票 { raceId, vid, key }
  const dismissed = new Set(); // 「次のレースへ」で閉じた結果（レース id。メモリーだけ）
  let unpaidList = [];         // 受け取っていない当たり [{ raceId, vid, key, bill, amount }]
  let notice = '';             // 入力画面の上に 1 回出す知らせ（番号が空けられた など）
  const up = () => navigator.onLine !== false;

  /* ================= 馬 ================= */
  function horsesOf(r) {
    if (!r || !Array.isArray(r.horses)) return [];
    return r.horses.map((h, i) => {
      const ty = F ? F.typeOf(h) : { label: '', color: '#ccc' };
      const fm = F ? F.formOf(h, r.at, st && st.settings && st.settings.dayStartHour, r.horses.length) : null;
      return { i, no: h.no || i + 1, name: h.name || '', color: h.color || FRAME[i], ink: h.ink || INK[i], type: ty.label, typeColor: ty.color, cond: h.cond && h.cond.mark ? h.cond.mark + (h.cond.label || '') : '', recent: fm ? fm.recent.join('-') : '' };
    });
  }
  const waku = (h, cls) => (h ? '<span class="waku' + (cls ? ' ' + cls : '') + '" style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</span>' : '');
  const exOdds = (r, a, b) => { const v = r && r.exacta ? Number(r.exacta[a + '-' + b]) : NaN; return Number.isFinite(v) && v > 0 ? v : null; };
  const comboText = (r, a, b, o) => { const hs = horsesOf(r), h1 = hs[a], h2 = hs[b]; return '1着 ' + (h1 ? h1.no : a + 1) + '番 → 2着 ' + (h2 ? h2.no : b + 1) + '番' + (o ? ' ' + oddsTxt(o) + '倍' : ''); };
  function pickCard(r, a, b, size) { // 「1着 [3] 名前 → 2着 [5] 名前」。size: 'big'＝④確認（馬番 56px）／'mid'＝⑤投票済み・⑥レース中（同じ札。馬番 40px）／なし＝結果の行
    const hs = horsesOf(r), h1 = hs[a], h2 = hs[b], big = size === 'big';
    const one = (lb, h, i) => '<div class="pp"><span class="lb">' + lb + '</span>' + (h ? waku(h, big ? 'xl' : 'lg') + '<span class="nm" data-fit="13">' + esc(h.name) + '</span>' : '<span class="waku lg">' + (i + 1) + '</span>') + '</div>'; // 馬名は「…」で切らない（入らなければ小さく → 2 行。fitText）
    return '<div class="pick' + (size ? ' ' + size : '') + '">' + one('1着', h1, a) + '<i class="arw" aria-hidden="true">→</i>' + one('2着', h2, b) + '</div>';
  }
  const arrowNum = (a, b) => '<b class="an">' + (a + 1) + '<i>→</i>' + (b + 1) + '</b>'; // 「3→5」（数字は太い文字・矢印はふつうの文字）
  const bigAmt = (n, cls) => { const t = amt(n); return '<span class="' + cls + (t.length >= 7 ? ' l7' : t.length >= 6 ? ' l6' : '') + '">' + t + '<small class="pt">pt</small></span>'; }; // 桁が多いときは少し小さく
  const whoLine = (bill, nick) => '<div class="who"><span class="nw">' + esc(TX.billHead) + ' <b>' + esc(bill) + '</b></span>・<span class="nw">' + esc(nick) + '</span></div>'; // 折り返すときは「・」で（番号やニックネームの途中で切らない）
  const isTest = (r) => !!((r && r.test) || (st && st.settings && st.settings.test));
  const shiftOn = () => { const x = st && st.settings; if (!x || x.shiftUp == null || x.shiftDown == null) return true; return Number(x.shiftUp) > 0 || Number(x.shiftDown) > 0; };

  /* ================= 画面の部品 ================= */
  function toast(text, err, ms) { const t = $('toast'); t.textContent = text; t.className = 'toast' + (err ? ' err' : ''); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms || 3200); }
  const cd = (at, cls) => '<b class="cd' + (cls ? ' ' + cls : '') + '" data-cd="' + at + '">' + mmss(at - now()) + '</b>'; // 1 秒ごとに数字だけ書き換える
  const testTag = (r) => (isTest(r) ? '<div class="testtag">' + esc(TX.test) + '</div>' : '');
  function nextRace() { // 次のレース（作ってあるレースか、時刻表の予定）
    if (!st) return null;
    const c = st.current; if (c && (!my || c.id !== my.raceId)) return c;
    const t = Math.max(now(), my && my.race ? my.race.at : 0);
    const up = (st.upcoming || []).filter((x) => x && x.at > t && canVote(x)).sort((x, y) => x.at - y.at)[0]; // この店が投票できるレースだけ（2026-10-26）
    if (up) return up;
    /* 2026-10-27: 進行役のテレビがまだレースを作っていない（15 分より先）・upcoming が届いていないときも、本日の時刻表（state.today）の次のレースを出す。
       これが無いと「本日のレースは終わりました」と下の帯の「22:00 次」が食い違っていた */
    const T = st.tuning || {}, lead = ((Number(T.closeLeadSec) || 0) + (Number(T.voteSec) || 180)) * 1000;
    const td = (st.today || []).filter((x) => x && x.at > t).sort((x, y) => x.at - y.at)[0];
    return td ? { id: td.id, at: td.at, time: td.time, storeIds: td.storeIds || null, openAt: td.at - lead } : null;
  }
  /* この店が投票できないのに投票が始まっているレース（state.watch。2026-10-26）: 待ち画面の上に「いまの 21:00 のレースは 渋谷 だけの開催です」 */
  const watchRace = () => { const w = st && st.watch; return w && w.closeAt > now() && !canVote(w) ? w : null; };
  const watchNote = () => { const w = watchRace(); return w ? '<div class="note watch" role="status">' + esc(fill(TX.watchOnly, { t: hhmm(w.at), s: storeNames(w.storeIds) })) + '</div>' : ''; };
  function nextLine() {
    const nx = nextRace(); if (!nx) return '<p class="nextr">' + esc(TX.dayOver) + '</p>';
    return '<p class="nextr">' + esc(TX.nextRace).replace('{t}', '<b class="nt">' + hhmm(nx.at) + '</b>') + /* 時刻だけ大きく（言葉は文字帳のまま） */ (nx.openAt ? '<small>' + esc(fill(TX.nextVote, { t: hhmm(nx.openAt) })) + '</small>' : '') + '</p>';
  }
  /* 本日のレースの時刻（2026-10-27 オーナー「本日の出走時間を店ごとにテレビとスマホへ」）: state.today（中身の Core.todayRaces ＝ 時刻表のうち、この営業日のこの店が投票できるレースだけ。テストレース・手で作ったレースは入らない）。
     待ち画面の「次のレース」の枠の下、投票済み・結果の画面の下に 1 行「本日のレース 13:00 ✓ 16:00 ✓ 19:00 次 22:00 25:00」（小さな札。320px 幅では折り返す）。
     済み（発走の時刻を過ぎた）は薄く ✓、次は金の枠「次」、そのあとはふつう。済み・次はスマホの時計で見る（状態が古くても時刻が来れば ✓ に）。
     時刻表にこの店のレースが無い日は「本日のこの店のレースはありません」。state に today が無い（古い中身）なら出さない */
  const TODAY_MAX = 8;
  function todayWindow(L, ni) { if (L.length <= TODAY_MAX) return { from: 0, to: L.length }; const from = Math.max(0, Math.min(ni < 0 ? L.length - 1 : ni - 1, L.length - TODAY_MAX)); return { from, to: from + TODAY_MAX }; }
  function todayRow() {
    const L = st && Array.isArray(st.today) ? st.today : null; if (!L) return '';
    const n = now(), ni = L.findIndex((x) => x.at > n);
    if (!L.length) return '<div class="today"><span class="tl">' + esc(TX.todayHead) + '</span><span class="none">' + esc(TX.todayNone) + '</span></div>';
    const W = todayWindow(L, ni); // 札は 8 つまで（1 日に何本もある店: 済みは次の 1 つ前だけ残し、前後を「…」）
    return '<div class="today"><span class="tl">' + esc(TX.todayHead) + '</span><span class="chips">' + (W.from ? '<span class="more">…</span>' : '') + L.slice(W.from, W.to).map((x, k) => { const i = k + W.from, done = x.at <= n, nx = i === ni; return '<span class="rc' + (done ? ' done' : nx ? ' nx' : '') + '"><b>' + hhmm(x.at) + '</b>' + (done ? '<i>✓</i>' : nx ? '<i>' + esc(TX.todayNext) + '</i>' : '') + '</span>'; }).join('') + (W.to < L.length ? '<span class="more">…</span>' : '') + '</span></div>';
  }
  function unpaidNote() {
    const u = unpaidList.filter((x) => !my || x.vid !== my.vid)[0]; if (!u) return '';
    return '<button class="btn ghost unpaid" data-act="openUnpaid" data-vid="' + esc(u.vid) + '">' + esc(TX.unpaid) + '<small>' + esc(fill(TX.unpaidBtn, { b: u.bill, a: ptT(u.amount) })) + '</small></button>';
  }

  /* ---------- 上の帯 ---------- */
  function chipRace() {
    if (['voted', 'race', 'result'].indexOf(screen) >= 0 && my) return my.race || (st && st.current) || null;
    if (draft && draft.raceId && st && st.current && st.current.id === draft.raceId) return st.current;
    return (st && st.current) || null;
  }
  function drawTop() {
    const name = (st && st.store && st.store.name) || '';
    $('store').className = 'store' + (online ? '' : ' off');
    $('storeText').textContent = (name || '') + (online ? '' : (name ? '・' : '') + TX.waiting);
    $('net').classList.toggle('hidden', online);
    const r = chipRace(), el = $('raceChip'), n = now();
    let h = '';
    if (r && ['boot', 'noStore', 'badStore'].indexOf(screen) < 0) {
      /* 「{時刻} のレース」は出さない（2026-10-21 文字帳 w0015） */
      if (isTest(r)) h += '<span class="t">' + esc(TX.test) + '</span>';
      if (screen === 'result') h += '<span>' + esc(TX.result) + '</span>';
      else if (screen === 'race') h += '<span>' + esc(TX.racing) + '</span>';
      else if (r.closeAt > n && n >= (r.openAt || 0)) h += '<span class="' + (r.closeAt - n < 15000 ? 'hot' : '') + '">' + esc(TX.closeIn) + ' <b data-cd="' + r.closeAt + '">' + mmss(r.closeAt - n) + '</b></span>';
      else if (r.closeAt <= n) h += '<span>' + esc(TX.closed) + '</span>';
    }
    if (el.innerHTML !== h) el.innerHTML = h;
  }

  /* ================= 各画面 ================= */
  const R = {};
  const LOGO = '<h1 class="logo-h1"><img src="../art/logo-3d/B/lockup-3d-B-casaWhite.svg" width="148" height="48" alt="casa DERBY" draggable="false"></h1>';
  R.noStore = () => '<div class="scr mid">' + LOGO + '<p class="lead">' + esc(TX.noStore) + '</p></div>';
  R.badStore = () => '<div class="scr mid">' + LOGO + '<p class="lead">' + esc(TX.badStore) + '</p></div>';
  /* 起動（2026-10-28）: bet.html に最初から入っている画面と同じ形（ロゴを大きく・読み込み中…）。時間がかかったら知らせと「読み込み直す」 */
  let bootSlow = false;
  R.boot = () => '<div class="scr mid splash" data-slow="' + bootSlow + '"><h1 class="logo-h1"><img src="../art/logo-3d/B/lockup-3d-B-casaWhite.svg" width="280" height="91" alt="casa DERBY" draggable="false"></h1><p class="lead" role="status">' + esc(TX.loading) + '</p>' +
    (bootSlow ? '<p class="slow">' + esc(TX.bootSlow) + '</p><button class="btn ghost" data-act="reload">' + esc(TX.reload) + '</button>' : '') + '</div>';

  /* 準備中（2026-10-28）: 作ってあるレース（st.current）が無く、時刻表の次のレースの投票の始まりを過ぎている＝進行役のテレビがまだ作っていない。
     '' ＝ふつう／'prep' ＝準備中／'late' ＝ 3 分たっても始まらない（「スタッフにお知らせください」）。レースが届けば st.current ができて投票の画面へ */
  function prepKey() {
    if (!st || st.current) return '';
    const n = now(), nx = ((st.upcoming || []).filter((x) => x && x.at > n && canVote(x))[0]) || null;
    if (!nx) return '';
    const open = nx.openAt || nx.at;
    return open > n ? '' : n - open > 180000 ? 'late' : 'prep';
  }
  /* ① 待ち: 次のレースは 21:00・投票は 20:57 から・残り */
  R.wait = () => {
    const c = st && st.current, nx = c || ((st && st.upcoming) || []).filter((x) => x.at > now() && canVote(x))[0] || null; // この店が投票できるレースだけ（2026-10-26）
    if (!nx) return '<div class="scr mid">' + unpaidNote() + watchNote() + '<div class="waitbox"><p class="wk">' + esc(TX.dayOver) + '</p></div>' + todayRow() + '</div>';
    const open = nx.openAt || nx.at;
    const pk = prepKey();
    if (pk) return '<div class="scr mid">' + unpaidNote() + watchNote() + '<div class="waitbox prep" id="prepBox"><p class="wk">' + esc(TX.waitHead) + '</p><p class="wt">' + hhmm(nx.at) + '</p>' +
      '<p class="wv prep" role="status"><i class="prepdot" aria-hidden="true"></i>' + esc(TX.prep) + '</p>' + (pk === 'late' ? '<p class="prepstaff">' + esc(TX.prepStaff) + '</p>' : '') + '</div>' + todayRow() + '</div>';
    return '<div class="scr mid">' + unpaidNote() + watchNote() + testTag(nx) +
      '<div class="waitbox"><p class="wk">' + esc(TX.waitHead) + '</p><p class="wt">' + hhmm(nx.at) + '</p>' +
      '<p class="wv">' + esc(fill(TX.waitVoteFrom, { t: hhmm(open) })) + '</p>' +
      '<div class="clock"><div class="k">' + esc(TX.waitLeft) + '</div><div class="v">' + cd(open) + '</div></div></div>' + todayRow() + '</div>'; // 本日のレースの時刻（2026-10-27）は枠の下
  };

  /* 覚えていた状態で開いて、最新の状況がまだ届いていない間（2026-10-28）: 入力はできる・送るのは届いて確かめてから（submitVote） */
  const checkNote = () => (stLive ? '' : '<div class="note" role="status">' + esc(TX.checking) + '</div>');
  /* ② 会計番号（数字のボタン）＋ニックネーム */
  R.entry = () => {
    const d = draft, b = d.bill || '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'];
    return '<div class="scr entry">' + checkNote() + (notice ? '<div class="note" role="status">' + esc(notice) + '</div>' : '') + unpaidNote() + testTag(st && st.current) +
      (d.err === 'bill_taken' ? '<div class="note red" role="alert"><b>' + esc(TX.billTaken) + '</b>' + TX.billTakenSub.split('\n').map((s) => '<span class="ln">' + esc(s) + '</span>').join('') + '</div>' : '') +
      '<div class="sec"><h1>' + esc(TX.billHead) + '</h1><p class="sub">' + esc(TX.billSub) + '</p>' +
      '<div class="digits' + (b ? '' : ' empty') + '" id="digits" aria-live="polite" aria-label="会計番号 ' + esc(b) + '">' + digitsHtml(b) + '</div>' +
      '<div class="keypad">' + keys.map((k) => '<button type="button" data-key="' + k + '"' + (k === 'clr' ? ' aria-label="消す">消す' : k === 'del' ? ' aria-label="1文字消す">⌫' : '>' + k) + '</button>').join('') + '</div></div>' +
      '<div class="sec"><h2>' + esc(TX.nickHead) + '</h2><input class="big nick" id="nick" type="text" autocomplete="off" autocapitalize="off" enterkeyhint="done" maxlength="40" value="' + esc(d.nick || '') + '" aria-label="ニックネーム（8文字まで）"><p class="sub">' + esc(TX.nickSub) + '</p></div>' +
      '<p class="err" id="err" role="alert">' + esc(d.err && d.err !== 'bill_taken' ? d.err : '') + '</p>' +
      '<button class="btn" data-act="toPick">' + esc(TX.toPick) + '</button></div>';
  };

  /* ③ 予想: 馬の情報（小さく）＋ 6×6 の表（縦 1 着・横 2 着。同じ馬のマスは空き） */
  R.pick = () => {
    const r = st && st.current; if (!r) return R.wait();
    const hs = horsesOf(r), d = draft;
    /* 2026-10-23 見直し: 「調子」「近走」を行ごとに書かず、上に 1 回だけ（列の見出し）。そのぶん馬名の幅を広く（「サッポロユキダ…」と切れていた） */
    const info = '<div class="hinfo"><div class="hh"><span></span><span></span><span class="hc">' + esc(TX.cond) + '</span><span class="hy">' + esc(TX.style) + '</span><span class="hf">' + esc(TX.recent) + '</span></div>' +
      hs.map((h) => '<div class="hr">' + waku(h, 'sm') + '<span class="hn" data-fit="12">' + esc(h.name) + '</span>' +
      '<span class="hc"><b>' + esc(h.cond) + '</b></span>' +
      '<span class="hy">' + (h.type ? '<span class="ht" style="background:' + h.typeColor + '">' + esc(h.type) + '</span>' : '') + '</span>' +
      '<span class="hf"><b>' + esc(h.recent) + '</b></span></div>').join('') + '</div>';
    const has = d.first != null && d.second != null; // 選び直し: 今の予想の行（1 着）と列（2 着）を少し明るく・交わるマスに金の枠（2026-10-23 デザイン見直し 1 回目）
    const v1 = d.n === 2 && my && my.vote ? my.vote : null; // 2 票目をえらぶとき: 1 票目のマスに小さな「1」（同じマスも押せる）
    let g ='<div class="grid" role="grid" aria-label="2連単の倍率の表"><div class="gc corner"><small>1着↓<br>2着→</small></div>' + hs.map((h) => '<div class="gc ch' + (has && d.second === h.i ? ' on' : '') + '">' + waku(h, 'sm') + '</div>').join('');
    hs.forEach((a) => {
      g += '<div class="gc rh' + (has && d.first === a.i ? ' on' : '') + '">' + waku(a, 'sm') + '</div>';
      hs.forEach((b) => {
        if (a.i === b.i) { g += '<div class="gc x" aria-hidden="true"></div>'; return; }
        const o = exOdds(r, a.i, b.i), sel = d.first === a.i && d.second === b.i, ax = has && !sel && (d.first === a.i || d.second === b.i);
        const m1 = v1 && v1.first === a.i && v1.second === b.i;
        g += '<button type="button" class="gc cell' + (sel ? ' sel' : ax ? ' ax' : '') + (m1 ? ' m1' : '') + (o && o < 10 ? ' lo' : o && o >= 100 ? ' hi' : '') + '" data-a="' + a.i + '" data-b="' + b.i + '" aria-label="1着 ' + a.no + '番 2着 ' + b.no + '番 ' + oddsTxt(o) + '倍' + (m1 ? '（' + TX.vote1 + '）' : '') + '">' + oddsTxt(o) + '</button>';
      });
    });
    g += '</div>';
    return '<div class="scr pickscr">' + checkNote() + testTag(r) + (d.n === 2 ? '<div class="bonustag">' + esc(TX.bonusTag) + '</div><h1>' + esc(TX.pick2Head) + '</h1><p class="sub b2sub">' + esc(TX.pick2Sub) + '</p>' : '<h1>' + esc(TX.pickHead) + '</h1>') + info +
      '<p class="axis">' + esc(TX.pickAxis) + '・' + esc(TX.pickTap) + '</p>' + g +
      (d.redo || d.n === 2 ? '<button class="btn ghost" data-act="cancelRedo">' + esc(TX.back) + '</button>' :'<button class="link" data-act="toEntry"><span class="nw">' + esc(bill2(d.bill)) + '番・' + esc(d.nick) + '</span>　<span class="nw">' + esc(TX.back) + '</span></button>') + '</div>';
  };

  /* ④ 確認: 組み合わせ・倍率・当たれば ○pt */
  R.confirm = () => {
    const r = st && st.current, d = draft; if (!r || d.first == null) return R.pick();
    const o = exOdds(r, d.first, d.second);
    return '<div class="scr confirm">' + checkNote() + testTag(r) + (d.n === 2 ? '<div class="bonustag">' + esc(TX.bonusTag) + '・' + esc(TX.vote2) + '</div>' : '') + '<h1>' + esc(TX.confHead) + '</h1>' + pickCard(r, d.first, d.second, 'big') + /* 組み合わせの文は出さない（2026-10-21 文字帳 w0052） */
      '<div class="ifwin"><span>' + esc(TX.ifWin) + '</span><b>' + bigAmt(o ? payFor(o) : 0, 'n') + '</b></div>' +
      (shiftOn() ? '<p class="sub shift">' + esc(TX.shiftNote) + '</p>' : '') +
      whoLine(bill2(d.bill), d.nick) +
      '<p class="err" id="err" role="alert">' + esc(d.err && d.err !== 'bill_taken' ? d.err : '') + '</p>' +
      '<div class="dock"><p class="vstat" id="vstat" role="status">' + esc(d.sendMsg || '') + '</p><button class="btn" data-act="vote"' + (d.sendDis ? ' disabled' : '') + '>' + esc(d.sendLabel || (d.redo ? TX.changeBtn : d.n === 2 ? TX.vote2Btn : TX.voteBtn)) + '</button><button class="btn ghost" data-act="toPick2">' + esc(TX.back) + '</button></div></div>'; // 送っている途中も描き直しで消えない（d.sendLabel・d.sendMsg。2026-10-28）
  };

  /* ⑤ 投票済み: あなたの予想・締切まで・選び直す */
  /* 「あなたの予想」の札（⑤投票済み・⑥レース中で同じ形）。n: 0＝1 票だけ／1＝1 票目／2＝初参加ボーナスの 2 票目。combo: 組み合わせの文も出す（⑤） */
  function mineCard(r, v, n, combo, who) {
    const o = exOdds(r, v.first, v.second);
    return '<div class="mine' + (n === 2 ? ' b2' : '') + '"><p class="mk">' + esc(n === 2 ? TX.vote2 : TX.yourPick) + (n === 1 ? '<span class="vn">' + esc(TX.vote1) + '</span>' : n === 2 ? '<span class="vn bt">' + esc(TX.bonusTag) + '</span>' : '') + '</p>' + pickCard(r, v.first, v.second, 'mid') +
      (combo ? '<div class="combo">' + esc(comboText(r, v.first, v.second, o)) + '</div>' : '') +
      (o ? '<div class="ifwin sm"><span>' + esc(TX.ifWin) + '</span><b>' + bigAmt(payFor(o), 'n') + '</b></div>' : '') + (who ? whoLine(v.bill, v.nick) : '') + '</div>';
  }
  const bonusBox = () => '<div class="bonusbox"><b>' + esc(TX.bonusHead) + '</b><span>' + esc(TX.bonusSub) + '</span><button class="btn" data-act="bonus">' + esc(TX.bonusBtn) + '</button></div>';
  let ownerChanged = false; // 匿名ログインの uid が変わった（client-firestore.js の onUser）
  R.voted = () => {
    const v = my && my.vote, v2 = my && my.vote2, r = (st && st.current && my && st.current.id === my.raceId ? st.current : my && my.race) || null;
    if (!v || !r) return R.boot();
    const lost = !!my.lost, can = !lost && !v2 && !!my.bonus && stageOf(r) === 'vote'; // 初参加ボーナス: 1 票目のすぐ下に「もう1票」。lost: ログインが変わって自分の票として読めない（選び直しは出さない）
    return '<div class="scr voted">' + testTag(r) + '<h1 class="done-h"><i aria-hidden="true">✓</i>' + esc(TX.voted) + '</h1>' +
      mineCard(r, v, v2 ? 1 : 0, true, true) + (can ? bonusBox() : '') + (v2 ? mineCard(r, v2, 2, true, false) : '') + watchBtn(r) +
      '<div class="clock"><div class="k">' + esc(TX.closeIn) + '</div><div class="v">' + cd(r.closeAt) + '</div></div>' + todayRow() + /* 本日のレースの時刻（2026-10-27）: 締切の時計の下・「選び直す」の上（開いた直後の画面に入る位置。デザイン審査） */
      (lost ? '<div class="note" role="status">' + esc(TX.ownerChanged) + '</div>' : v2 ? '<div class="redo2"><button class="btn ghost" data-act="redo">' + esc(TX.redo1) + '</button><button class="btn ghost" data-act="redo2">' + esc(TX.redo2) + '</button></div>'
        : '<button class="btn ghost" data-act="redo">' + esc(TX.redo) + '</button>') + '</div>';
  };

  /* 「レースを見る」（2026-10-29 オーナー「投票終わった端末のみレースを観測できるように」）: このスマホに票があるレースだけ、投票済み・レース中・結果の画面に出す。
     押すとこのページの上に窓を開き、テレビと同じ画面（../index.html?store=<店>&watch=1。v2/watch.js・tv.js の見るだけ）を出す。重い部品（3D の映像）は押したときに初めて読む。
     出すのは結果の画面が終わるまで（endAt）。取り消しのレースは出さない */
  const watchEnd = (r) => r.endAt || (r.revealAt ? r.revealAt + 300000 : (r.closeAt || 0) + 15 * 60000);
  function watchBtn(r) {
    if (!my || !my.vote || !r || r.refunded || r.status === 'void' || my.lost || now() >= watchEnd(r)) return '';
    return '<button class="btn ghost watchbtn" data-act="watch"><span aria-hidden="true">▶ </span>' + esc(TX.watchBtn) + '<small>' + esc(TX.watchSub) + '</small></button>';
  }
  /* 窓の見た目は開くときだけ足す（投票ページの最初の読み込みを重くしない＝bet.css には入れない） */
  const WATCH_CSS = '#watchOv{position:fixed;inset:0;z-index:100;background:#0b101b}#watchOv iframe{position:absolute;top:0;bottom:0;left:env(safe-area-inset-left);right:env(safe-area-inset-right);width:calc(100% - env(safe-area-inset-left) - env(safe-area-inset-right));height:100%;border:0;display:block;background:#0b101b}html.watching,html.watching body{overflow:hidden}.watchbtn small{display:block;font-size:12px;font-weight:500;opacity:.8}';
  function openWatch() {
    if (!my || !my.vote || $('watchOv')) return;
    if (!$('watchCss')) { const s = document.createElement('style'); s.id = 'watchCss'; s.textContent = WATCH_CSS; document.head.appendChild(s); }
    const keep = ['cloud', 'mute'].map((k) => (qs.get(k) ? '&' + k + '=' + encodeURIComponent(qs.get(k)) : '')).join('');
    const ov = document.createElement('div'); ov.id = 'watchOv'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', TX.watchBtn);
    const fr = document.createElement('iframe'); fr.id = 'watchFr'; fr.title = TX.watchBtn; fr.setAttribute('allow', 'autoplay; fullscreen');
    /* 3D（テレビと同じ画面）が先。図の表示（v2/watchmap.html）は ?view=map・窓の中の「図で見る」で選んだ端末（casa.derby.watchView = 'map'）・Web デモ（?view=3d でなく、選んでいないとき）。
       Web デモのテレビの画面は ../tv.html（2026-10-30 本番も「図で見る」「3Dで見る」で切り替えられるように） */
    let pref = null; try { pref = localStorage.getItem('casa.derby.watchView'); } catch (e) { pref = null; }
    const DEMO = !!window.__derbyDemoPage, vq = qs.get('view'), map = vq === 'map' || (vq !== '3d' && (pref === 'map' || (DEMO && pref !== '3d')));
    const q = '?store=' + encodeURIComponent(STORE) + '&race=' + encodeURIComponent(my.raceId) + keep;
    fr.src = map ? 'watchmap.html' + q : (DEMO ? '../tv.html' : '../index.html') + q + '&watch=1';
    ov.appendChild(fr); document.body.appendChild(ov); document.documentElement.classList.add('watching');
    try { history.pushState(Object.assign({}, history.state || {}, { derbyWatch: 1 }), ''); } catch (e) { /* noop */ } // スマホの「戻る」で窓を閉じる
  }
  function closeWatch(fromPop) {
    const ov = $('watchOv'); if (!ov) return;
    const fr = $('watchFr');
    try { const w = fr && fr.contentWindow; if (w && w.__derbyWatchStop) w.__derbyWatchStop(); } catch (e) { /* noop: 見張りを止める（このページの Firebase の見張りを残さない） */ }
    try { if (fr) fr.src = 'about:blank'; } catch (e) { /* noop */ }
    ov.remove(); document.documentElement.classList.remove('watching');
    if (!fromPop) { try { if (history.state && history.state.derbyWatch) history.back(); } catch (e) { /* noop */ } }
    lastSig = ''; route();
  }
  window.addEventListener('popstate', () => { if ($('watchOv')) closeWatch(true); });
  /* 窓（v2/watch.js）が読むもの: このスマホのそのレースの票（予想・会計番号・結果）と、票の持ち主の印。窓から閉じる */
  const watchVote = (v) => (v ? { first: v.first, second: v.second, bill: v.bill, nick: v.nick, n: v.n, result: v.result ? { win: !!v.result.win, amount: v.result.amount, test: !!v.result.test, refunded: !!v.result.refunded } : null } : null);
  /* 投票が届いたら自動で「レースを見る」を開く（2026-10-30 オーナー）。同じレースはこの端末で 1 回だけ（閉じたあとはもう開かない。ボタンはそのまま）。
     覚える場所: casa.derby.watchAuto（レース id の並び。新しい 20 件だけ）。保存できない端末はこのページの間だけ */
  const AUTO_KEY = 'casa.derby.watchAuto', autoMem = new Set();
  function autoOpened(raceId) { if (autoMem.has(raceId)) return true; try { const L = JSON.parse(localStorage.getItem(AUTO_KEY) || '[]'); return Array.isArray(L) && L.indexOf(raceId) >= 0; } catch (e) { return false; } }
  function markAuto(raceId) { autoMem.add(raceId); try { let L = JSON.parse(localStorage.getItem(AUTO_KEY) || '[]'); if (!Array.isArray(L)) L = []; L = L.filter((x) => x !== raceId).concat([raceId]).slice(-20); localStorage.setItem(AUTO_KEY, JSON.stringify(L)); } catch (e) { /* このページの間だけ */ } }
  function autoWatch() {
    if (!my || !my.vote || autoOpened(my.raceId) || $('watchOv') || /[?&]watchauto=0\b/.test(location.search)) return; // ?watchauto=0: 自動で開かない（確認用）
    markAuto(my.raceId); openWatch();
  }
  window.BETWATCH = {
    close: () => closeWatch(false),
    bonus: (raceId) => !!(my && my.raceId === raceId && my.vote && !my.vote2 && my.bonus && !my.lost && my.race && stageOf(my.race) === 'vote'), // 初参加ボーナスの 2 票目をまだ入れられる（窓に「もう1票」を出す）
    votes: (raceId) => (my && my.raceId === raceId && my.vote ? [my.vote, my.vote2].filter(Boolean).map(watchVote) : []),
    mv: (raceId) => (MV ? MV.get(raceId) : null),
  };

  /* ⑥ レース中: 自分の予想だけ（初参加ボーナスの 2 票目もあれば 2 枚） */
  R.race = () => {
    const v = my && my.vote, v2 = my && my.vote2, r = my && my.race; if (!v || !r) return R.boot();
    return '<div class="scr racing' + (v2 ? ' two' : ' mid') + '">' + testTag(r) + mineCard(r, v, v2 ? 1 : 0, false, true) + /* ⑤投票済みと同じ札・同じ大きさ。当たればいくら（2026-10-21 文字帳の指示） */
      (v2 ? mineCard(r, v2, 2, false, false) : '') + watchBtn(r) + '</div>';
  };

  /* ⑦ 結果 */
  R.result = () => {
    const v = my && my.vote, r = my && my.race, res = v && v.result; if (!v || !r) return R.boot();
    if (!res) return R.race();
    const nextBtn = (ghost) => { const c = st && st.current, vote = c && c.id !== my.raceId && stageOf(c) === 'vote'; return '<button class="btn' + (ghost ? ' ghost' : '') + '" data-act="dismiss">' + esc(vote ? TX.toNextVote : TX.toNext) + '</button>'; };
    const resLine = '<div class="resline">' + pickCard(r, res.first, res.second, false) + '</div>';
    if (res.refunded) return '<div class="scr result">' + testTag(r) + '<div class="miss"><h1 class="t">' + esc(TX.voided) + '</h1></div>' + nextLine() + todayRow() + nextBtn(false) + '</div>';
    const v2 = my.vote2, all = [v].concat(v2 ? [v2] : []), wins = all.filter((x) => x.result && x.result.win);
    /* 初参加ボーナスの 2 票: 票ごとに「1票目 3→5 当たり」「2票目 2→4 はずれ」（1 票だけのときは今までどおり） */
    const perVote = v2 ? '<div class="vlist">' + all.map((x) => { const w = !!(x.result && x.result.win); return '<div class="vr' + (w ? ' w' : '') + '"><span class="vk">' + esc(x.n === 2 ? TX.vote2 : TX.vote1) + '</span>' + arrowNum(x.first, x.second) + '<b class="vm">' + esc(w ? TX.hitMark : TX.missMark) + '</b></div>'; }).join('') + '</div>' : '';
    if (!wins.length) {
      return '<div class="scr result">' + testTag(r) + '<div class="miss"><h1 class="t">' + esc(TX.lose) + '</h1><p class="rc">' + esc(TX.result) + ' ' + arrowNum(res.first, res.second) + '</p></div>' + resLine +
        (v2 ? perVote : '<div class="mine sm"><p class="mk">' + esc(TX.yourPick) + ' ' + arrowNum(v.first, v.second) + '</p></div>') + watchBtn(r) + nextLine() + todayRow() + nextBtn(false) + '</div>'; // 本日のレースの時刻（2026-10-27）は「次のレース」と「次のレースへ」の間
    }
    /* 受け取りは 1 つのスライドで（2 票とも当たりなら 2 票分をまとめて。スタッフの操作は 1 回。2026-10-24 決め） */
    const wr = wins[0].result, total = wins.reduce((a, x) => a + (Number(x.result.amount) || 0), 0), test = wins.some((x) => x.result.test);
    const ps = wins.map((x) => x.result.payout), unpaid = ps.filter((p) => p && p.status === 'unpaid');
    let pay;
    if (test) pay = '<div class="note" role="status"><b>' + esc(TX.testNoPay) + '</b></div>';
    else if (ps.some((p) => !p)) pay = '<div class="note" role="status">' + esc(TX.loading) + '</div>';
    else if (unpaid.length) { const lb = unpaid.length >= 2 ? TX.slideAll : TX.slide; pay = '<div class="payop"><p class="ops">' + esc(TX.staffOps) + '</p><div class="slider" id="slider" role="slider" aria-label="' + esc(lb) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fillbar"></div><span class="lbl">' + esc(lb) + ' ›››</span><div class="knob" aria-hidden="true">›</div></div><p class="err" id="err" role="alert"></p></div>'; } // 「スタッフが操作します」はスライドのすぐ上
    else if (ps.every((p) => p.status === 'paid')) { const at = Math.max.apply(null, ps.map((p) => p.paidAt || 0)); pay = '<div class="stamp" role="status"><b>' + esc(TX.paid) + '</b>' + (at ? '<small>' + hhmm(at) + '</small>' : '') + '</div>'; }
    else if (ps.some((p) => p.status === 'void')) pay = '<div class="note red" role="status"><b>' + esc(TX.voided) + '</b></div>';
    else pay = '<div class="note red" role="status"><b>' + esc(TX.expired) + '</b></div>';
    return '<div class="scr result win">' + testTag(r) + '<div class="hit"><h1 class="t">' + esc(TX.win) + '</h1><div class="combo">' + esc(comboText(r, wr.first, wr.second, wr.odds)) + '</div>' +
      '<div class="k">' + esc(TX.amount) + '</div><div class="a">' + bigAmt(total, 'n') + '</div>' + (wins.length >= 2 ? '<div class="x2">' + esc(fill(TX.times, { a: ptT(wr.amount), n: wins.length })) + '</div>' : '') + '</div>' + perVote +
      '<div class="billbig"><span>' + esc(TX.billHead) + '</span><b>' + esc(v.bill) + '</b><small data-fit="13">' + esc(v.nick) + '</small></div>' + pay +
      watchBtn(r) + todayRow() + nextBtn(true) + '</div>'; // 本日のレースの時刻（2026-10-27）は「次のレースへ」のすぐ上
  };

  /* ================= 描画 ================= */
  function go(name) { if (screen !== name) window.scrollTo(0, 0); screen = name; draw(); }
  let dragging = false, drawLater = false, drawn = ''; // drawn: 前に描いた画面（画面が変わったときだけふわっと出す。描き直しのたびに出し直すとちらつく）
  function draw() {
    if (dragging) { drawLater = true; return; } // スライドを動かしている途中は描き直さない
    drawLater = false;
    if (screen === 'boot') { const f = $('main').firstElementChild; if (f && f.classList.contains('splash') && f.dataset.slow === String(bootSlow)) { drawn = 'boot'; return drawTop(); } } // 起動の画面がもう出ている（bet.html の中）なら作り直さない（ちらつかない）
    else { const a = $('app'); if (a && a.classList.contains('booting')) a.classList.remove('booting'); }
    $('main').innerHTML = (R[screen] || R.boot)();
    if (drawn !== screen) { const f = $('main').firstElementChild; if (f) f.classList.add('in'); drawn = screen; }
    drawTop(); fitText($('main'));
    if (screen === 'entry') {
      const i = $('nick');
      i.addEventListener('input', () => { if (Array.from(i.value).length > MAX_NICK) i.value = cutNick(i.value); draft.nick = i.value; const e = $('err'); if (e && e.textContent) e.textContent = ''; });
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); i.blur(); act('toPick'); } }); // 変換を確定する Enter では進まない
    }
    if (screen === 'result') { const s = $('slider'); if (s) bindSlider(s); }
    notice = screen === 'entry' ? notice : '';
  }
  /* 枠に入らない文字（馬名・ニックネーム）: 「…」で切らずに、まず文字を小さく（data-fit の px まで）、それでも入らなければ 2 行にする（2026-10-23 見直し） */
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
  window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => fitText($('main')), 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitText($('main'))); // 文字（Noto Sans JP）が届いたら測り直す
  /* 文字（Noto Sans JP。2026-10-28）: 画面を止めないように、最初の中身が届いたあとで読む（それまでは端末の日本語の文字）。前に読めた端末は bet.html がすぐ読む（キャッシュ） */
  function loadFont() {
    if ($('webfont')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.id = 'webfont'; l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap';
    l.onload = () => { const done = () => { try { localStorage.setItem('casa.derby.font', '1'); } catch (e) { /* noop */ } fitText($('main')); }; if (document.fonts && document.fonts.ready) document.fonts.ready.then(done); else done(); };
    document.head.appendChild(l);
  }
  /* 会計番号の 2 つの枠: 1 けただけなら右の枠に入れて左は薄い 0（07 の 7 と同じに見える） */
  function digitsHtml(b) { return b.length === 2 ? '<span class="dg">' + esc(b[0]) + '</span><span class="dg">' + esc(b[1]) + '</span>' : b.length === 1 ? '<span class="dg ph">0</span><span class="dg">' + esc(b) + '</span>' : '<span class="dg"></span><span class="dg"></span>'; }
  function drawDigits() { const d = $('digits'); if (!d) return draw(); const b = draft.bill || ''; d.innerHTML = digitsHtml(b); d.classList.toggle('empty', !b); d.setAttribute('aria-label', '会計番号 ' + b); }

  /* ---------- スライド（スタッフが動かす。持ち主のスマホだけ） ---------- */
  function bindSlider(el) {
    const knob = el.querySelector('.knob'), bar = el.querySelector('.fillbar');
    let x0 = null, dx = 0, max = 0;
    const set = (x) => { knob.style.transform = 'translateX(' + x + 'px)'; bar.style.width = (x + knob.offsetWidth / 2) + 'px'; el.setAttribute('aria-valuenow', String(Math.round(max ? (x / max) * 100 : 0))); };
    el.addEventListener('pointerdown', (e) => {
      if (busy || el.classList.contains('busy')) return;
      const k = knob.getBoundingClientRect(); if (e.clientX < k.left - 12 || e.clientX > k.right + 12) return; // つまみから始めたときだけ（さわっただけで動かない）
      x0 = e.clientX; dx = 0; max = el.clientWidth - knob.offsetWidth - 8; el.classList.add('drag'); dragging = true;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* noop */ }
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (x0 == null) return; dx = Math.max(0, Math.min(max, e.clientX - x0)); set(dx); });
    const end = () => {
      if (x0 == null) return; x0 = null; el.classList.remove('drag'); dragging = false;
      if (max > 0 && dx >= max * 0.9) { set(max); claim(el); } else { dx = 0; set(0); if (drawLater) draw(); }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  async function claim(el) {
    if (busy || !my) return; busy = true; el.classList.add('busy'); const lb = el.querySelector('.lbl'); if (lb) lb.textContent = TX.saving;
    try {
      // 当たった票の、まだ受け取っていない当たりを全部（初参加ボーナスで 2 票とも当たりなら 2 つ。1 回のスライドで）
      const todo = [my.vote, my.vote2].filter((x) => x && x.result && x.result.win && x.result.payout && x.result.payout.status === 'unpaid');
      for (const x of todo) { const d = await C.claimSelf(x.vid, my.key); if (d && d.vote) { if (d.vote.n === 2) my.vote2 = d.vote; else my.vote = d.vote; } }
      busy = false; unpaidList = unpaidList.filter((x) => x.vid !== my.vid); draw();
    } catch (e) {
      busy = false;
      if (['already_paid', 'expired', 'void', 'test_race', 'no_win', 'not_revealed'].indexOf(e && e.code) >= 0) { await loadMine(true); return draw(); }
      draw(); const er = $('err'); if (er) er.textContent = e && e.status ? ((e.body && e.body.message) || TX.retry) : TX.claimNet;
    }
  }

  /* ================= 行き先を決める ================= */
  function focusOf() { // いま見せる自分の票（レース中 → 投票中 → 発表のあと → 受け取っていない当たり）
    if (!st || !MV) return null;
    const cand = [['live', st.live], ['cur', st.current], ['last', st.last]];
    for (const [kind, r] of cand) {
      if (!r) continue;
      const m = MV.get(r.id); if (!m) continue;
      if (kind === 'cur' && stageOf(r) !== 'vote') {
        // 締切の時刻を過ぎて、次の状態（レース中）が届くまでの 1〜2 秒: 待ちの画面に一瞬戻らず、そのまま「レース中」を見せる（2026-10-21 統合で直した）
        if (r.closeAt && now() >= r.closeAt && now() < r.closeAt + 30000 && r.status !== 'done' && r.status !== 'void' && !r.refunded) return { kind: 'live', raceId: r.id, vid: m.vid, key: m.key, race: r };
        continue;
      }
      if (kind === 'last' && dismissed.has(r.id)) continue;
      return { kind, raceId: r.id, vid: m.vid, key: m.key, race: r };
    }
    if (pinned) return Object.assign({ kind: 'pin' }, pinned);
    /* 2026-10-23 直した: 締切のあと、進行役のテレビがレースを「締切」にする前（Firestore 版・Web デモ）は、状態の current がもう次のレースで live もまだ空。
       発表の時刻のあと、結果が書かれる前も live・last のどちらにも入らない。この数秒〜数十秒、自分の票が見えなくなり待ち画面がちらついていた。
       その間は、見ている自分の票をそのまま持つ（結果がまだ → レース中、結果が来た → 結果）。持つのは締切から 15 分・発表から 2 分まで */
    const r = my && my.race, n = now();
    if (r && MV.get(my.raceId) && !dismissed.has(my.raceId) && r.closeAt && n >= r.closeAt && r.status !== 'void' && !r.refunded) {
      const res = my.vote && my.vote.result;
      if (!res && n < r.closeAt + 15 * 60000) return { kind: 'live', raceId: my.raceId, vid: my.vid, key: my.key, race: r };
      if (res && n < Math.max(r.revealAt || 0, r.closeAt) + 2 * 60000) return { kind: 'hold', raceId: my.raceId, vid: my.vid, key: my.key, race: r };
    }
    return null;
  }
  function route() {
    if (!STORE || !C) return go('noStore');
    if (screen === 'badStore') return;
    if (!st) return screen === 'boot' ? draw() : drawTop();
    const f = focusOf();
    if (f) {
      if (!my || my.vid !== f.vid) { my = { raceId: f.raceId, vid: f.vid, key: f.key, vote: null, vote2: null, bonus: false, race: f.race || null, kind: f.kind }; loadMine(); resubscribe(); }
      else { my.kind = f.kind; if (f.race) my.race = Object.assign({}, my.race || {}, f.race, { result: (my.race && my.race.result) || f.race.result || null }); }
      if (f.kind === 'cur' && draft && (draft.redo || draft.n === 2) && draft.raceId === f.raceId && ['pick', 'confirm'].indexOf(screen) >= 0) return drawTop(); // 選び直し・2 票目をえらんでいる途中
      const want = f.kind === 'cur' ? 'voted' : f.kind === 'live' ? 'race' : (my.vote && my.vote.result) || (my.race && my.race.status === 'done') ? 'result' : 'race';
      if (screen === want && sigOf() === lastSig) return drawTop();
      go(want); lastSig = sigOf(); return;
    }
    if (my) { my = null; resubscribe(); }
    const c = st.current, sg = c ? stageOf(c) : null;
    if (sg === 'vote') {
      if (draft && draft.raceId === c.id && ['entry', 'pick', 'confirm'].indexOf(screen) >= 0) return drawTop();
      if (draft && draft.raceId && draft.raceId !== c.id && ['pick', 'confirm'].indexOf(screen) >= 0) toast(TX.closed, true, 4000);
      draft = { raceId: c.id, bill: (draft && draft.raceId === c.id && draft.bill) || '', nick: (draft && draft.raceId === c.id && draft.nick) || '', first: null, second: null, redo: false, err: null };
      return go('entry');
    }
    if (draft && ['entry', 'pick', 'confirm'].indexOf(screen) >= 0) toast(TX.closed, true, 4000);
    draft = null;
    if (screen === 'wait' && sigOf() === lastSig) return drawTop();
    go('wait'); lastSig = sigOf();
  }
  let lastSig = '';
  function sigOf() { const v = my && my.vote, v2 = my && my.vote2, r = my && my.race, p = v && v.result && v.result.payout, p2 = v2 && v2.result && v2.result.payout; return [my && my.vid, my && my.lost ? 'lost' : '', v && v.combo, v && v.updatedAt, v2 && v2.combo, v2 && v2.updatedAt, my && my.bonus, r && r.status, v && v.result && v.result.combo, p && p.status, p2 && p2.status, (st && st.current && st.current.id) || '', (st && st.watch && st.watch.id) || '' /* 他店だけのレースが始まった・終わった（2026-10-26） */, unpaidList.length,
    st && Array.isArray(st.today) ? st.today.map((x) => x.at).join() + '|' + st.today.filter((x) => x.at <= now()).length : '' /* 本日のレースの時刻が変わった・済みが増えた（2026-10-27。時刻表を直したときも待ち画面を描き直す） */].join('|'); }

  /* 自分の票を読む（myVote → { vote, vote2, bonus, race }）。無い（番号を空けられた・ほかのスマホ）なら覚えを消す */
  let loading = null;
  function loadMine(force) {
    if (!my) return Promise.resolve();
    if (loading && !force) return loading;
    const m = my;
    loading = C.myVote(m.vid, m.key).then((d) => {
      if (my !== m) return;
      my.vote = d.vote; my.vote2 = d.vote2 || null; my.bonus = !!d.bonus; if (d.race) my.race = d.race; online = up(); route();
    }).catch((e) => {
      if (my !== m) return;
      if (e && (e.status === 404 || e.code === 'no_vote')) { if (ownerChanged && m.vote) { m.lost = true; return route(); } return gone(m); } // ログインが変わって自分の票として読めない: 覚えていた票を出したまま（番号を空けられたのとは別）
      if (e && !e.status) { online = false; drawTop(); }
    }).then(() => { loading = null; });
    return loading;
  }
  function gone(m, wasVote) { // 票が消えた（スタッフが番号を空けた）
    const old = wasVote || m.vote;
    if (MV) MV.clear(m.raceId);
    if (pinned && pinned.vid === m.vid) pinned = null;
    unpaidList = unpaidList.filter((x) => x.vid !== m.vid);
    my = null; resubscribe();
    const c = st && st.current;
    if (c && c.id === m.raceId && stageOf(c) === 'vote') { notice = TX.released; draft = { raceId: c.id, bill: old ? String(old.bill || '') : '', nick: old ? old.nick || '' : '', first: null, second: null, redo: false, err: null }; return go('entry'); }
    route();
  }

  /* 受け取っていない当たりを探す（このスマホが持ち主の票。2 日より古いものは client.js が消す） */
  let scanAt = 0;
  const scanDone = new Set(); // 結果が決まって、もう受け取るものが無い票（はずれ・受け取り済み・期限切れ・テスト）は読み直さない
  async function scanUnpaid() {
    if (!C || !MV) return; scanAt = Date.now();
    const keys = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(VKEY) === 0) keys.push(k.slice(VKEY.length)); } } catch (e) { return; }
    const skip = new Set([st && st.current && st.current.id, st && st.live && st.live.id].filter(Boolean)), out = [];
    for (const raceId of keys.slice(-12)) {
      if (skip.has(raceId) || scanDone.has(raceId)) continue;
      const m = MV.get(raceId); if (!m) continue;
      try {
        const d = await C.myVote(m.vid, m.key), all = [d.vote, d.vote2].filter(Boolean); // 初参加ボーナスの 2 票目の当たりも足す
        const un = all.filter((x) => x.result && x.result.win && !x.result.test && x.result.payout && x.result.payout.status === 'unpaid');
        if (un.length) out.push({ raceId, vid: m.vid, key: m.key, bill: d.vote.bill, amount: un.reduce((a, x) => a + (Number(x.result.amount) || 0), 0), at: d.race && d.race.at });
        else if (all.length && all.every((x) => x.result && (!x.result.win || x.result.test || x.result.refunded || (x.result.payout && x.result.payout.status !== 'unpaid')))) scanDone.add(raceId);
      } catch (e) { if (e && (e.status === 404 || e.code === 'no_vote')) { MV.clear(raceId); scanDone.add(raceId); } }
    }
    const before = unpaidList.map((x) => x.vid).join(); unpaidList = out.sort((a, b) => (b.at || 0) - (a.at || 0));
    if (before !== unpaidList.map((x) => x.vid).join() && ['wait', 'entry'].indexOf(screen) >= 0) { if (screen === 'entry') { const nk = $('nick'); if (nk) draft.nick = nk.value; } draw(); }
  }

  /* ================= 操作 ================= */
  let shownAt = 0;
  async function act(a, el) {
    const err = (t) => { const e = $('err'); if (e) e.textContent = t || ''; };
    if (a === 'toPick') {
      if (!draft) return;
      const nk = $('nick'); if (nk) draft.nick = nk.value;
      draft.err = null;
      if (!billOk(draft.bill)) return err(TX.errBill);
      const n = cleanNick(draft.nick); if (!n) return err(TX.errNick);
      draft.nick = n; draft.bill = bill2(draft.bill); return go('pick');
    }
    if (a === 'toEntry') { draft.err = null; return go('entry'); }
    if (a === 'toPick2') { draft.err = null; return go('pick'); }
    if (a === 'cancelRedo') { draft = null; return route(); }
    if (a === 'redo') {
      const v = my && my.vote; if (!v) return;
      draft = { raceId: my.raceId, bill: v.bill, nick: v.nick, first: v.first, second: v.second, redo: true, err: null };
      return go('pick');
    }
    if (a === 'redo2') { // 初参加ボーナスの 2 票目を選び直す
      const v = my && my.vote2; if (!v) return;
      draft = { raceId: my.raceId, bill: v.bill, nick: v.nick, first: v.first, second: v.second, redo: true, n: 2, err: null };
      return go('pick');
    }
    if (a === 'bonus') { // 初参加ボーナス: 2 票目をえらぶ（同じ組み合わせでもよい）
      const v = my && my.vote; if (!v || my.vote2 || !my.bonus) return;
      draft = { raceId: my.raceId, bill: v.bill, nick: v.nick, first: null, second: null, redo: false, n: 2, err: null };
      return go('pick');
    }
    if (a === 'vote') {
      if (!draft) return;
      return submitVote(draft); // 同じ予想を送っている途中なら何もしない（submitVote の中）
    }
    if (a === 'reload') { try { location.reload(); } catch (e) { /* noop */ } return; }
    if (a === 'watch') return openWatch(); // レースを見る（2026-10-29）
    if (a === 'dismiss') { if (my) dismissed.add(my.raceId); if (pinned && my && pinned.vid === my.vid) pinned = null; my = null; resubscribe(); lastSig = ''; route(); return scanUnpaid(); }
    if (a === 'openUnpaid') {
      const u = unpaidList.find((x) => x.vid === (el && el.dataset.vid)); if (!u) return;
      pinned = { raceId: u.raceId, vid: u.vid, key: u.key, race: null }; dismissed.delete(u.raceId); my = null; lastSig = ''; return route();
    }
  }

  /* ---------- 投票を送る（2026-10-28「誰でも必ず投票できる」） ----------
     押したらすぐ「送っています…」。届いたら「投票しました」。
     通信の失敗（返事が無い・つながらない・サーバーの一時的なエラー 502/503/504）は自動で送り直す（0.8 → 1.6 → 3.2 秒あけて 4 回まで）。電波が無いときは戻るのを待って送る。
     それでも送れなければ「もう一度送る」（電波が戻ったとき・画面に戻ったとき・15 秒ごとに自動でも送る）。どれも締切まで（サーバーの時計）。
     送り直さないもの: 番号が使われている（bill_taken）・締切（closed）・権限・形のまちがい（400・403・409）＝すぐその知らせ。
     票の id は レース~店~会計番号 で決まるので、何度送っても票は 1 つ。送れたか分からない失敗のあとは、送り直す前に保存された自分の票を読んで、
     押した予想と同じなら「投票しました」にする（同じでなければ、いちばん新しい予想だけを送る）。
     予想ごとに番号（intent）を付ける: 送っている途中に選び直したら、前の送信が終わるのを待ってから新しい予想を送る（古い送信があとから上書きしない）。古い予想の返事は使わない。
     最新の状況がまだ届いていない（覚えていた状態で開いた）ときは、届くのを待ってから、そのレースがまだ投票中か確かめて送る。 */
  const RETRY_MS = [800, 1600, 3200], SEND_WAIT_MS = 20000, RESEND_EVERY_MS = 15000;
  const retryable = (e) => !e || !e.status || [502, 503, 504].indexOf(e.status) >= 0;
  const closeAtOf = (d) => { const c = st && st.current; if (c && c.id === d.raceId) return c.closeAt; if (my && my.race && my.race.id === d.raceId) return my.race.closeAt; return Infinity; };
  const onConfirm = (d) => draft === d && screen === 'confirm';
  const argsOf = (d) => ({ raceId: d.raceId, bill: d.bill, nick: d.nick, first: d.first, second: d.second, n: d.n === 2 ? 2 : undefined });
  const sameArgs = (x, y) => !!x && !!y && x.raceId === y.raceId && x.bill === y.bill && x.nick === y.nick && x.first === y.first && x.second === y.second && x.n === y.n;
  let sendSeq = 0, inflight = null, wake = null, resendAt = 0;
  const kick = () => { const w = wake; wake = null; if (w) w(); }; // 待っているところを起こす（画面に戻った・電波が戻った）
  const nap = (ms) => new Promise((r) => { const t = setTimeout(() => { wake = null; r(); }, ms); wake = () => { clearTimeout(t); r(); }; });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function setSend(d, I, label, msg, dis) {
    if (I && d.intent !== I) return; // 古い予想の送信は画面を変えない
    d.sendLabel = label; d.sendMsg = msg || ''; d.sendDis = !!dis;
    if (!onConfirm(d)) return;
    const b = document.querySelector('[data-act=vote]'), s = $('vstat');
    if (b) { b.textContent = label || (d.redo ? TX.changeBtn : d.n === 2 ? TX.vote2Btn : TX.voteBtn); b.disabled = !!dis; }
    if (s) s.textContent = d.sendMsg;
  }
  async function waitUntil(d, I, ok, every) { while (!ok()) { if (d.done || d.intent !== I || now() >= closeAtOf(d)) return false; await nap(every || 1000); } return true; }
  /* 送れたか分からないとき: 保存された自分の票（Firestore 版は匿名ログインの持ち主・模擬クラウドはキーがあるとき）を読んで、押した予想と同じか */
  async function storedMatches(I) {
    const A = I.args, m = MV && MV.get(A.raceId), key = (m && m.key) || (C.backend === 'firestore' ? 'uid' : null);
    if (!key) return null;
    const vid = A.raceId + '~' + STORE + '~' + bill2(A.bill) + (A.n === 2 ? '~2' : '');
    try {
      const x = await Promise.race([C.myVote(vid, key), nap(6000).then(() => null)]); if (!x) return null;
      const v = A.n === 2 ? x.vote2 : x.vote;
      if (v && v.first === A.first && v.second === A.second && v.nick === A.nick) return { vote: x.vote, vote2: x.vote2 || null, bonus: !!x.bonus, key: key === 'uid' ? 'uid' : key, race: x.race || null };
    } catch (e) { /* 読めない（無い・通信）→ 送り直す */ }
    return null;
  }
  async function submitVote(d) {
    const A = argsOf(d);
    if (d.intent && sameArgs(d.intent.args, A) && busy && !d.waitResend) return; // 同じ予想をもう送っている
    const I = d.intent = { seq: ++sendSeq, args: A };
    d.done = false; busy = true; d.err = null; d.tries = 0; d.waitResend = false; d.sent = false;
    const e0 = $('err'); if (e0) e0.textContent = '';
    setSend(d, I, TX.sending, stLive ? '' : TX.checking, true);
    for (;;) {
      if (d.done || d.intent !== I) return;
      if (!stLive) { // 覚えていた状態で開いた: 最新の状況が届くまで待つ（届いたら、まだ投票中か確かめる）
        if (!(await waitUntil(d, I, () => stLive, 500))) { if (d.intent !== I || d.done) return; busy = false; return voteFailed(d, { code: 'closed', status: 409 }); }
        const c = st && st.current;
        if (!c || c.id !== A.raceId || stageOf(c) !== 'vote') { busy = false; return voteFailed(d, { code: 'closed', status: 409 }); }
        setSend(d, I, TX.sending, '', true);
      }
      if (inflight) await Promise.race([inflight, nap(SEND_WAIT_MS)]); // 前の送信が終わってから（順番を守る）
      if (d.done || d.intent !== I) return;
      d.tries++; d.sent = true;
      const res = await new Promise((resolve) => {
        let fin = false; const out = (x) => { if (!fin) { fin = true; resolve(x); } };
        const slow = setTimeout(() => { if (!d.done && d.tries <= 1) setSend(d, I, TX.sending, TX.sendSlow, true); }, 4000);
        const to = setTimeout(() => out({ err: { code: 'network', status: 0, timeout: true } }), SEND_WAIT_MS);
        const call = C.vote(A); inflight = call.then(() => {}, () => {});
        call.then((r) => { clearTimeout(slow); clearTimeout(to); if (!d.done && d.intent === I) { d.done = true; voted(d, r, I); } out({ ok: true }); }, // 古い予想の返事は使わない
          (e) => { clearTimeout(slow); clearTimeout(to); out({ err: e }); });
      });
      if (res.ok || d.done || d.intent !== I) return;
      const e = res.err;
      if (retryable(e) && now() < closeAtOf(d)) {
        const got = await storedMatches(I); // 届いていたか確かめる
        if (d.done || d.intent !== I) return;
        if (got) { d.done = true; return voted(d, got, I); }
        if (!onConfirm(d)) { busy = false; return; }
        if (!up()) { setSend(d, I, TX.sending, fill(TX.sendQueued, { t: hhmm(closeAtOf(d)) }), true); await waitUntil(d, I, up, 2000); if (!onConfirm(d)) { busy = false; return; } continue; }
        if (d.tries < 4) { setSend(d, I, TX.sending, fill(TX.sendRetry, { n: d.tries + 1 }), true); await nap(RETRY_MS[d.tries - 1]); if (!onConfirm(d)) { busy = false; return; } continue; }
        busy = false; d.waitResend = true; resendAt = Date.now(); setSend(d, I, TX.resend, TX.sendFail, false); online = false; drawTop(); return; // 「もう一度送る」（自動でも: flushResend）
      }
      busy = false; d.sendLabel = d.sendMsg = ''; d.sendDis = false;
      return voteFailed(d, e);
    }
  }
  /* 送れなかった投票を送る（電波が戻った・画面に戻った・15 秒ごと）。Wi-Fi はつながっているのに外へ出られないときも、これで締切まで送り続ける */
  function flushResend(force) {
    kick();
    const d = draft;
    if (!d || !d.waitResend || screen !== 'confirm' || busy || d.done) return;
    if (now() >= closeAtOf(d)) { d.waitResend = false; return voteFailed(d, { code: 'closed', status: 409 }); }
    if (force || Date.now() - resendAt >= RESEND_EVERY_MS) submitVote(d);
  }
  function voted(d, r, I) {
    /* 届いた。けれど、その間に「戻る」で選び直している（予想の表・ちがう予想の確認）なら画面はそのまま（票は覚える。続きは選び直しとして送る）。2026-10-28 */
    const rechoosing = draft === d && I && (screen === 'pick' || (screen === 'confirm' && !sameArgs(argsOf(d), I.args)));
    busy = false; notice = ''; if (!rechoosing && draft === d) draft = null;
    const raceId = r.vote.raceId; if (MV && !MV.get(raceId)) MV.set(raceId, r.vote.vid, r.key);
    my = { raceId, vid: r.vote.vid, key: r.key, vote: r.vote, vote2: r.vote2 || null, bonus: !!r.bonus, race: r.race || (st && st.current) || null, kind: 'cur' }; resubscribe();
    online = up(); lastSig = '';
    if (rechoosing) { d.redo = true; d.done = false; d.sendLabel = d.sendMsg = ''; d.sendDis = false; return drawTop(); }
    route();
    autoWatch(); // 投票できたら、自動で「レースを見る」（このレースで初めてのときだけ）
  }
  async function voteFailed(d, e) { // 送り直しても変わらない答え（今までと同じ動き）
    const code = e && e.code;
    if (code === 'no_bonus') { toast(TX.noBonus, true, 5000); draft = null; if (my) my.bonus = false; lastSig = ''; return route(); } // 2 票目は使えなかった（ほかで使われた・端末の 2 レース目）
    if (code === 'bill_taken') { d.err = 'bill_taken'; d.redo = false; d.n = undefined; return go('entry'); }
    if (code === 'closed' || code === 'no_open_race' || code === 'not_open') { toast(code === 'not_open' ? TX.notOpen : code === 'no_open_race' ? TX.noOpen : d.sent ? TX.closedSend : TX.closed, true, 5000); draft = null; await refreshState(); return route(); } // 送ったのに締切だった → 「受付できませんでした（締め切りました）」
    if (code === 'not_my_store') { toast((e.body && e.body.message) || TX.notMyStore, true, 5000); draft = null; await refreshState(); return route(); } // この店は投票できないレース（2026-10-26）→ お知らせして待ち画面へ
    if (code === 'no_store') return badStore();
    d.err = !e || !e.status ? TX.netErr : (e.body && e.body.message) || TX.retry;
    if (code === 'bad_bill' || code === 'bad_nick') return go('entry');
    if (retryable(e) && now() >= closeAtOf(d)) { toast(d.sent ? TX.closedSend : TX.closed, true, 5000); draft = null; await refreshState(); return route(); } // 送れないまま締切を過ぎた
    draw();
  }
  function key(k) {
    if (!draft) return;
    let b = draft.bill || '';
    if (k === 'clr') b = ''; else if (k === 'del') b = b.slice(0, -1); else if (/^\d$/.test(k)) b = b.length >= 2 ? k : b + k; // 3 つ目を押したら打ち直し
    draft.bill = b; if (draft.err === 'bill_taken') { draft.err = null; const nk = $('nick'); if (nk) draft.nick = nk.value; return draw(); }
    const e = $('err'); if (e) e.textContent = '';
    drawDigits();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act],[data-key],.cell');
    if (!b || b.disabled) return;
    if (b.dataset.key) { e.preventDefault(); return key(b.dataset.key); }
    if (b.classList.contains('cell')) { if (!draft) return; draft.first = Number(b.dataset.a); draft.second = Number(b.dataset.b); draft.err = null; draft.sendLabel = draft.sendMsg = ''; draft.sendDis = false; draft.waitResend = false; /* 選び直した: 前の送信の知らせは消す（前の送信の返事は使わない＝submitVote） */ shownAt = performance.now(); return go('confirm'); }
    e.preventDefault();
    if (b.dataset.act === 'vote' && e.isTrusted && performance.now() - shownAt < 500) return; // マスの 2 度押しが「投票する」に当たらないように
    act(b.dataset.act, b);
  });

  /* ================= リアルタイム ================= */
  function resubscribe() {
    const want = my ? my.vid : null;
    if (unsub && subVid === want) return;
    if (unsub) { try { unsub(); } catch (e) { /* noop */ } }
    subVid = want;
    unsub = C.subscribe({
      open() { if (!online && up()) { online = true; drawTop(); } },
      error() { online = false; drawTop(); },
      state(s) { gotState(s); },
      vote(d) {
        if (!my || !d) return;
        if (d.vote && d.vote.vid === my.vid) { my.vote = d.vote; my.vote2 = d.vote2 || null; my.bonus = !!d.bonus; if (d.vote.result && my.race && my.race.status !== 'done') loadMine(true); else route(); if (d.vote.result) setTimeout(scanUnpaid, 500); return; }
        if (!d.vote && d.released && (!d.vid || d.vid === my.vid)) gone(my);
      },
    }, my ? { vid: my.vid, key: my.key } : undefined);
  }
  function badStore() { if (unsub) { try { unsub(); } catch (e) { /* noop */ } unsub = null; } go('badStore'); }
  function refreshState() { return C.state().then((d) => { gotState(d, true); }).catch((e) => { if (e && e.code === 'no_store') return badStore(); online = false; }).then(() => { if (screen !== 'badStore') route(); }); }
  /* 届いた状態（2026-10-28）: 画面を決め直し、この店の最後の状態をスマホに覚える（次に開いたとき、通信の前にすぐ出す＝stale-while-revalidate）。
     覚えるのはレースの時刻・馬・倍率などの公開の中身だけ（会計番号・ニックネーム・当たった人の名前は入れない）。6 時間より古いものは使わない */
  const SKEY = 'casa.derby.st.' + STORE, ST_MAX_AGE = 6 * 3600e3;
  let stLive = false, stSavedAt = 0, stSavedSig = '', firstLive = true;
  function stripSt(s) {
    const cut = (r) => { if (!r || typeof r !== 'object') return r; const o = Object.assign({}, r); delete o.winners; return o; };
    const o = Object.assign({}, s); ['current', 'live', 'last', 'watch'].forEach((k) => { if (o[k]) o[k] = cut(o[k]); }); if (Array.isArray(o.upcoming)) o.upcoming = o.upcoming.map(cut); delete o.winners;
    return o;
  }
  function saveSt() {
    if (!st) return;
    const c = st.current, sig = [c && c.id, c && c.status, c && c.closeAt, st.live && st.live.id, st.last && st.last.id, (st.upcoming || []).length, (st.today || []).length].join('|');
    if (sig === stSavedSig && Date.now() - stSavedAt < 60000) return;
    try { localStorage.setItem(SKEY, JSON.stringify({ at: Date.now(), st: stripSt(st) })); stSavedSig = sig; stSavedAt = Date.now(); } catch (e) { /* noop: 保存できなくても続ける */ }
  }
  function loadSt() { try { const x = JSON.parse(localStorage.getItem(SKEY) || 'null'); if (x && x.st && typeof x.st === 'object' && Date.now() - x.at < ST_MAX_AGE && x.at <= Date.now() + 60000 && (!x.st.store || !x.st.store.id || x.st.store.id === STORE)) return x.st; } catch (e) { /* noop */ } return null; }
  function gotState(s, noRoute) {
    if (!s) return;
    const was = stLive; st = s; stLive = true; online = up(); saveSt();
    if (firstLive) { firstLive = false; setTimeout(afterLive, 400); }
    if (!noRoute) route();
    if (!was && ['entry', 'pick', 'confirm'].indexOf(screen) >= 0) { const nk = $('nick'); if (nk && draft) draft.nick = nk.value; draw(); } // 「最新状況を確認中…」を消す
    if (!was) kick(); // 確かめるのを待っている投票を起こす
  }
  function afterLive() { // 最初の中身が届いたあと（画面が使えるようになってから）: 文字
    loadFont();
  }
  window.addEventListener('online', () => {
    refreshState(); loadMine(true);
    flushResend(true); // 送れなかった投票: 電波が戻ったら自動で送る（待っている送信も起こす）
  });
  window.addEventListener('offline', () => { online = false; drawTop(); });
  /* 画面に戻ったとき（2026-10-28）: 裏ではタイマーが止まることがあるので、すぐ時刻・状況・自分の票（ほかのタブ・2 回読んだ QR で変えた予想もここで出る）を読み直し、送れていない投票を送る */
  document.addEventListener('visibilitychange', () => { if (!document.hidden && C) { C.syncClock().catch(() => {}); refreshState(); loadMine(true); flushResend(true); } });

  // 1 秒ごと: 残りの数字。投票の始まり・締切・発表の時刻をまたいだら行き先を決め直す
  let lastPh = '', lastPrep = ''; // lastPrep: 準備中の印（待ちの画面は 6 秒ごとにも読み直す＝下の見回り）
  setInterval(() => {
    if (!C) return;
    const n = now();
    document.querySelectorAll('[data-cd]').forEach((x) => { const t = mmss(Number(x.dataset.cd) - n); if (x.textContent !== t) x.textContent = t; });
    const c = st && st.current, r = my && my.race;
    const ph = [c && c.id, c && stageOf(c), r && r.id, r && n >= r.closeAt, r && r.revealAt && n >= r.revealAt].join('|');
    if (ph !== lastPh) { const first = !lastPh; lastPh = ph; if (!first) { refreshState(); if (my) loadMine(true); } }
    if (screen === 'wait') { const pk = prepKey(); if (pk !== lastPrep) { const was = lastPrep; lastPrep = pk; draw(); if (pk && !was) refreshState(); } } // 準備中に入った・3 分たった・レースが届いた（2026-10-28）
    drawTop();
  }, 1000);
  // 通知が届かない環境の保険
  setInterval(() => {
    if (document.hidden || !C || screen === 'badStore') return;
    if (my && ['voted', 'race', 'result'].indexOf(screen) >= 0 && !(my.vote && my.vote.result && [my.vote, my.vote2].every((x) => !x || !x.result || !x.result.win || (x.result.payout && x.result.payout.status !== 'unpaid')))) loadMine();
    if (!online || ['wait', 'boot'].indexOf(screen) >= 0) refreshState();
    if (Date.now() - scanAt > 60000) scanUnpaid();
    flushResend(false); // 送れなかった投票は 15 秒ごとにも（Wi-Fi はつながっているのに外へ出られないとき）
  }, 6000);

  window.BET = { get screen() { return screen; }, get st() { return st; }, get my() { return my; }, get draft() { return draft; }, set draft(d) { draft = d; } /* テスト用（投票できないレースへ送る） */, get unpaid() { return unpaidList; }, prepKey, C, TX, payFor, oddsTxt, route, scanUnpaid, act, hhmm, canVote, openWatch, closeWatch };

  /* ================= 起動 ================= */
  /* 2026-10-28 速さの見直し: 時刻合わせ・状態・見張りを同時に始める（以前は時刻合わせ → 状態 → 見張りの順で待っていた）。
     前に開いたことがあれば、覚えていた状態ですぐ画面を出し、届いたら差し替える。届かないときは 1 → 2 → 4 → 8 秒あけて自動で読み直す
     （6 秒ごとの見回りも続く）。6 秒たっても起動の画面のままなら「通信に時間がかかっています」と「読み込み直す」を出す */
  async function boot() {
    if (!STORE || !C) return go('noStore');
    screen = 'boot'; draw(); // bet.html の中の起動の画面をそのまま使う
    try { if (MV) MV.prune(); } catch (e) { /* noop */ }
    try { localStorage.removeItem('casa.derby.bet.v3'); } catch (e) { /* noop */ } // 以前の版の覚え（会計番号・ニックネーム）は消す
    const cached = loadSt();
    if (cached) { st = cached; route(); }
    setTimeout(() => { if (screen === 'boot' && !bootSlow) { bootSlow = true; draw(); } }, Math.max(1000, 6000 - ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0))); // 開いてから 6 秒（このファイルが届くまでの時間も入れる）
    C.syncClock().catch(() => {});
    if (C.onUser) C.onUser(() => { ownerChanged = true; if (my) loadMine(true); }); // ログインが変わった → 自分の票を読み直す
    resubscribe();
    for (let i = 0; !stLive; i++) {
      try { gotState(await C.state()); break; } catch (e) {
        if (e && e.code === 'no_store') return badStore();
        if (stLive) break;
        online = false; drawTop();
        await sleep(Math.min(8000, 1000 * 2 ** Math.min(i, 3)));
      }
    }
    scanUnpaid();
  }
  boot();
})();
