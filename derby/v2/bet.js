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
    billTaken: 'この番号はもう使われています', billTakenSub: 'スタッフに伝えてください。番号を空けてもらうと投票できます',
    closed: '締め切りました', notOpen: '投票はまだ始まっていません', noOpen: 'いま投票できるレースがありません',
    netErr: '通信できませんでした。もう一度押してください', retry: 'もう一度お試しください',
    released: '番号が空けられました。もう一度投票できます',
    unpaid: '受け取っていない当たりがあります', unpaidBtn: '{b}番 {a} を受け取る',
    claimNet: '通信できませんでした。もう一度スライドしてください',
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
  const hhmm = (ms) => { const d = JST(ms); return d.getUTCHours() + ':' + pad(d.getUTCMinutes()); };
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
  let draft = null;            // 入力中（メモリーだけ）: { raceId, bill, nick, first, second, redo, err }
  let my = null;               // 見ている自分の票: { raceId, vid, key, vote, race, kind: 'cur'|'live'|'last'|'pin' }
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
    return (st.upcoming || []).filter((x) => x && x.at > t).sort((x, y) => x.at - y.at)[0] || null;
  }
  function nextLine() {
    const nx = nextRace(); if (!nx) return '<p class="nextr">' + esc(TX.dayOver) + '</p>';
    return '<p class="nextr">' + esc(TX.nextRace).replace('{t}', '<b class="nt">' + hhmm(nx.at) + '</b>') + /* 時刻だけ大きく（言葉は文字帳のまま） */ (nx.openAt ? '<small>' + esc(fill(TX.nextVote, { t: hhmm(nx.openAt) })) + '</small>' : '') + '</p>';
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
  R.boot = () => '<div class="scr mid"><p class="lead">' + esc(TX.loading) + '</p></div>';

  /* ① 待ち: 次のレースは 21:00・投票は 20:57 から・残り */
  R.wait = () => {
    const c = st && st.current, nx = c || ((st && st.upcoming) || []).filter((x) => x.at > now())[0] || null;
    if (!nx) return '<div class="scr mid">' + unpaidNote() + '<div class="waitbox"><p class="wk">' + esc(TX.dayOver) + '</p></div></div>';
    const open = nx.openAt || nx.at;
    return '<div class="scr mid">' + unpaidNote() + testTag(nx) +
      '<div class="waitbox"><p class="wk">' + esc(TX.waitHead) + '</p><p class="wt">' + hhmm(nx.at) + '</p>' +
      '<p class="wv">' + esc(fill(TX.waitVoteFrom, { t: hhmm(open) })) + '</p>' +
      '<div class="clock"><div class="k">' + esc(TX.waitLeft) + '</div><div class="v">' + cd(open) + '</div></div></div></div>';
  };

  /* ② 会計番号（数字のボタン）＋ニックネーム */
  R.entry = () => {
    const d = draft, b = d.bill || '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'];
    return '<div class="scr entry">' + (notice ? '<div class="note" role="status">' + esc(notice) + '</div>' : '') + unpaidNote() + testTag(st && st.current) +
      (d.err === 'bill_taken' ? '<div class="note red" role="alert"><b>' + esc(TX.billTaken) + '</b>' + esc(TX.billTakenSub) + '</div>' : '') +
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
    let g = '<div class="grid" role="grid" aria-label="2連単の倍率の表"><div class="gc corner"><small>1着↓<br>2着→</small></div>' + hs.map((h) => '<div class="gc ch' + (has && d.second === h.i ? ' on' : '') + '">' + waku(h, 'sm') + '</div>').join('');
    hs.forEach((a) => {
      g += '<div class="gc rh' + (has && d.first === a.i ? ' on' : '') + '">' + waku(a, 'sm') + '</div>';
      hs.forEach((b) => {
        if (a.i === b.i) { g += '<div class="gc x" aria-hidden="true"></div>'; return; }
        const o = exOdds(r, a.i, b.i), sel = d.first === a.i && d.second === b.i, ax = has && !sel && (d.first === a.i || d.second === b.i);
        g += '<button type="button" class="gc cell' + (sel ? ' sel' : ax ? ' ax' : '') + (o && o < 10 ? ' lo' : o && o >= 100 ? ' hi' : '') + '" data-a="' + a.i + '" data-b="' + b.i + '" aria-label="1着 ' + a.no + '番 2着 ' + b.no + '番 ' + oddsTxt(o) + '倍">' + oddsTxt(o) + '</button>';
      });
    });
    g += '</div>';
    return '<div class="scr pickscr">' + testTag(r) + '<h1>' + esc(TX.pickHead) + '</h1>' + info +
      '<p class="axis">' + esc(TX.pickAxis) + '・' + esc(TX.pickTap) + '</p>' + g +
      (d.redo ? '<button class="btn ghost" data-act="cancelRedo">' + esc(TX.back) + '</button>' : '<button class="link" data-act="toEntry"><span class="nw">' + esc(bill2(d.bill)) + '番・' + esc(d.nick) + '</span>　<span class="nw">' + esc(TX.back) + '</span></button>') + '</div>';
  };

  /* ④ 確認: 組み合わせ・倍率・当たれば ○pt */
  R.confirm = () => {
    const r = st && st.current, d = draft; if (!r || d.first == null) return R.pick();
    const o = exOdds(r, d.first, d.second);
    return '<div class="scr confirm">' + testTag(r) + '<h1>' + esc(TX.confHead) + '</h1>' + pickCard(r, d.first, d.second, 'big') + /* 組み合わせの文は出さない（2026-10-21 文字帳 w0052） */
      '<div class="ifwin"><span>' + esc(TX.ifWin) + '</span><b>' + bigAmt(o ? payFor(o) : 0, 'n') + '</b></div>' +
      (shiftOn() ? '<p class="sub shift">' + esc(TX.shiftNote) + '</p>' : '') +
      whoLine(bill2(d.bill), d.nick) +
      '<p class="err" id="err" role="alert">' + esc(d.err && d.err !== 'bill_taken' ? d.err : '') + '</p>' +
      '<div class="dock"><button class="btn" data-act="vote">' + esc(d.redo ? TX.changeBtn : TX.voteBtn) + '</button><button class="btn ghost" data-act="toPick2">' + esc(TX.back) + '</button></div></div>';
  };

  /* ⑤ 投票済み: あなたの予想・締切まで・選び直す */
  R.voted = () => {
    const v = my && my.vote, r = (st && st.current && my && st.current.id === my.raceId ? st.current : my && my.race) || null;
    if (!v || !r) return R.boot();
    const o = exOdds(r, v.first, v.second);
    return '<div class="scr voted">' + testTag(r) + '<h1 class="done-h"><i aria-hidden="true">✓</i>' + esc(TX.voted) + '</h1>' +
      '<div class="mine"><p class="mk">' + esc(TX.yourPick) + '</p>' + pickCard(r, v.first, v.second, 'mid') +
      '<div class="combo">' + esc(comboText(r, v.first, v.second, o)) + '</div><div class="ifwin sm"><span>' + esc(TX.ifWin) + '</span><b>' + bigAmt(o ? payFor(o) : 0, 'n') + '</b></div>' +
      whoLine(v.bill, v.nick) + '</div>' +
      '<div class="clock"><div class="k">' + esc(TX.closeIn) + '</div><div class="v">' + cd(r.closeAt) + '</div></div>' +
      '<button class="btn ghost" data-act="redo">' + esc(TX.redo) + '</button></div>';
  };

  /* ⑥ レース中: 自分の予想だけ */
  R.race = () => {
    const v = my && my.vote, r = my && my.race; if (!v || !r) return R.boot();
    return '<div class="scr racing mid">' + testTag(r) + '<div class="mine"><p class="mk">' + esc(TX.yourPick) + '</p>' + pickCard(r, v.first, v.second, 'mid') + /* ⑤投票済みと同じ札・同じ大きさ */
      (() => { const o = exOdds(r, v.first, v.second); return o ? '<div class="ifwin sm"><span>' + esc(TX.ifWin) + '</span><b>' + bigAmt(payFor(o), 'n') + '</b></div>' : ''; })() + /* 当たればいくら（2026-10-21 文字帳の指示） */
      whoLine(v.bill, v.nick) + '</div></div>';
  };

  /* ⑦ 結果 */
  R.result = () => {
    const v = my && my.vote, r = my && my.race, res = v && v.result; if (!v || !r) return R.boot();
    if (!res) return R.race();
    const nextBtn = (ghost) => { const c = st && st.current, vote = c && c.id !== my.raceId && stageOf(c) === 'vote'; return '<button class="btn' + (ghost ? ' ghost' : '') + '" data-act="dismiss">' + esc(vote ? TX.toNextVote : TX.toNext) + '</button>'; };
    const resLine = '<div class="resline">' + pickCard(r, res.first, res.second, false) + '</div>';
    if (res.refunded) return '<div class="scr result">' + testTag(r) + '<div class="miss"><h1 class="t">' + esc(TX.voided) + '</h1></div>' + nextLine() + nextBtn(false) + '</div>';
    if (!res.win) {
      return '<div class="scr result">' + testTag(r) + '<div class="miss"><h1 class="t">' + esc(TX.lose) + '</h1><p class="rc">' + esc(TX.result) + ' ' + arrowNum(res.first, res.second) + '</p></div>' + resLine +
        '<div class="mine sm"><p class="mk">' + esc(TX.yourPick) + ' ' + arrowNum(v.first, v.second) + '</p></div>' + nextLine() + nextBtn(false) + '</div>';
    }
    const p = res.payout, test = !!res.test;
    let pay;
    if (test) pay = '<div class="note" role="status"><b>' + esc(TX.testNoPay) + '</b></div>';
    else if (!p) pay = '<div class="note" role="status">' + esc(TX.loading) + '</div>';
    else if (p.status === 'paid') pay = '<div class="stamp" role="status"><b>' + esc(TX.paid) + '</b>' + (p.paidAt ? '<small>' + hhmm(p.paidAt) + '</small>' : '') + '</div>';
    else if (p.status === 'expired') pay = '<div class="note red" role="status"><b>' + esc(TX.expired) + '</b></div>';
    else if (p.status === 'void') pay = '<div class="note red" role="status"><b>' + esc(TX.voided) + '</b></div>';
    else pay = '<div class="payop"><p class="ops">' + esc(TX.staffOps) + '</p><div class="slider" id="slider" role="slider" aria-label="' + esc(TX.slide) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fillbar"></div><span class="lbl">' + esc(TX.slide) + ' ›››</span><div class="knob" aria-hidden="true">›</div></div><p class="err" id="err" role="alert"></p></div>'; // 「スタッフが操作します」はスライドのすぐ上
    return '<div class="scr result win">' + testTag(r) + '<div class="hit"><h1 class="t">' + esc(TX.win) + '</h1><div class="combo">' + esc(comboText(r, res.first, res.second, res.odds)) + '</div>' +
      '<div class="k">' + esc(TX.amount) + '</div><div class="a">' + bigAmt(res.amount, 'n') + '</div></div>' +
      '<div class="billbig"><span>' + esc(TX.billHead) + '</span><b>' + esc(v.bill) + '</b><small data-fit="13">' + esc(v.nick) + '</small></div>' + pay +
      nextBtn(true) + '</div>';
  };

  /* ================= 描画 ================= */
  function go(name) { if (screen !== name) window.scrollTo(0, 0); screen = name; draw(); }
  let dragging = false, drawLater = false, drawn = ''; // drawn: 前に描いた画面（画面が変わったときだけふわっと出す。描き直しのたびに出し直すとちらつく）
  function draw() {
    if (dragging) { drawLater = true; return; } // スライドを動かしている途中は描き直さない
    drawLater = false;
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
      const d = await C.claimSelf(my.vid, my.key); if (d && d.vote) my.vote = d.vote;
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
      if (!my || my.vid !== f.vid) { my = { raceId: f.raceId, vid: f.vid, key: f.key, vote: null, race: f.race || null, kind: f.kind }; loadMine(); resubscribe(); }
      else { my.kind = f.kind; if (f.race) my.race = Object.assign({}, my.race || {}, f.race, { result: (my.race && my.race.result) || f.race.result || null }); }
      if (f.kind === 'cur' && draft && draft.redo && draft.raceId === f.raceId && ['pick', 'confirm'].indexOf(screen) >= 0) return drawTop(); // 選び直しの途中
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
  function sigOf() { const v = my && my.vote, r = my && my.race, p = v && v.result && v.result.payout; return [my && my.vid, v && v.combo, v && v.updatedAt, r && r.status, v && v.result && v.result.combo, p && p.status, (st && st.current && st.current.id) || '', unpaidList.length].join('|'); }

  /* 自分の票を読む（myVote → { vote, race }）。無い（番号を空けられた・ほかのスマホ）なら覚えを消す */
  let loading = null;
  function loadMine(force) {
    if (!my) return Promise.resolve();
    if (loading && !force) return loading;
    const m = my;
    loading = C.myVote(m.vid, m.key).then((d) => {
      if (my !== m) return;
      my.vote = d.vote; if (d.race) my.race = d.race; online = up(); route();
    }).catch((e) => {
      if (my !== m) return;
      if (e && (e.status === 404 || e.code === 'no_vote')) return gone(m);
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
        const d = await C.myVote(m.vid, m.key), res = d.vote && d.vote.result, p = res && res.payout;
        if (res && res.win && !res.test && p && p.status === 'unpaid') out.push({ raceId, vid: m.vid, key: m.key, bill: d.vote.bill, amount: res.amount, at: d.race && d.race.at });
        else if (res && (!res.win || res.test || res.refunded || (p && p.status !== 'unpaid'))) scanDone.add(raceId);
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
    if (a === 'vote') {
      if (busy || !draft) return;
      const d = draft; busy = true; if (el) { el.disabled = true; el.textContent = TX.sending; }
      try {
        const r = await C.vote({ raceId: d.raceId, bill: d.bill, nick: d.nick, first: d.first, second: d.second });
        busy = false; draft = null; notice = '';
        const raceId = r.vote.raceId; if (MV && !MV.get(raceId)) MV.set(raceId, r.vote.vid, r.key);
        my = { raceId, vid: r.vote.vid, key: r.key, vote: r.vote, race: r.race || (st && st.current) || null, kind: 'cur' }; resubscribe();
        lastSig = ''; return route();
      } catch (e) {
        busy = false;
        const code = e && e.code;
        if (code === 'bill_taken') { d.err = 'bill_taken'; d.redo = false; return go('entry'); }
        if (code === 'closed' || code === 'no_open_race' || code === 'not_open') { toast(code === 'not_open' ? TX.notOpen : code === 'no_open_race' ? TX.noOpen : TX.closed, true, 5000); draft = null; await refreshState(); return route(); }
        if (code === 'no_store') return badStore();
        d.err = !e || !e.status ? TX.netErr : (e.body && e.body.message) || TX.retry;
        if (code === 'bad_bill' || code === 'bad_nick') return go('entry');
        draw();
      }
      return;
    }
    if (a === 'dismiss') { if (my) dismissed.add(my.raceId); if (pinned && my && pinned.vid === my.vid) pinned = null; my = null; resubscribe(); lastSig = ''; route(); return scanUnpaid(); }
    if (a === 'openUnpaid') {
      const u = unpaidList.find((x) => x.vid === (el && el.dataset.vid)); if (!u) return;
      pinned = { raceId: u.raceId, vid: u.vid, key: u.key, race: null }; dismissed.delete(u.raceId); my = null; lastSig = ''; return route();
    }
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
    if (b.classList.contains('cell')) { if (!draft) return; draft.first = Number(b.dataset.a); draft.second = Number(b.dataset.b); draft.err = null; shownAt = performance.now(); return go('confirm'); }
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
      state(s) { st = s; online = up(); route(); },
      vote(d) {
        if (!my || !d) return;
        if (d.vote && d.vote.vid === my.vid) { my.vote = d.vote; if (d.vote.result && my.race && my.race.status !== 'done') loadMine(true); else route(); if (d.vote.result) setTimeout(scanUnpaid, 500); return; }
        if (!d.vote && d.released && (!d.vid || d.vid === my.vid)) gone(my);
      },
    }, my ? { vid: my.vid, key: my.key } : undefined);
  }
  function badStore() { if (unsub) { try { unsub(); } catch (e) { /* noop */ } unsub = null; } go('badStore'); }
  function refreshState() { return C.state().then((d) => { st = d; online = up(); }).catch((e) => { if (e && e.code === 'no_store') return badStore(); online = false; }).then(() => { if (screen !== 'badStore') route(); }); }
  window.addEventListener('online', () => { refreshState(); loadMine(true); });
  window.addEventListener('offline', () => { online = false; drawTop(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && C) { C.syncClock().catch(() => {}); refreshState(); loadMine(true); } });

  // 1 秒ごと: 残りの数字。投票の始まり・締切・発表の時刻をまたいだら行き先を決め直す
  let lastPh = '';
  setInterval(() => {
    if (!C) return;
    const n = now();
    document.querySelectorAll('[data-cd]').forEach((x) => { const t = mmss(Number(x.dataset.cd) - n); if (x.textContent !== t) x.textContent = t; });
    const c = st && st.current, r = my && my.race;
    const ph = [c && c.id, c && stageOf(c), r && r.id, r && n >= r.closeAt, r && r.revealAt && n >= r.revealAt].join('|');
    if (ph !== lastPh) { const first = !lastPh; lastPh = ph; if (!first) { refreshState(); if (my) loadMine(true); } }
    drawTop();
  }, 1000);
  // 通知が届かない環境の保険
  setInterval(() => {
    if (document.hidden || !C || screen === 'badStore') return;
    if (my && ['voted', 'race', 'result'].indexOf(screen) >= 0 && !(my.vote && my.vote.result && my.vote.result.payout && my.vote.result.payout.status !== 'unpaid')) loadMine();
    if (!online || ['wait', 'boot'].indexOf(screen) >= 0) refreshState();
    if (Date.now() - scanAt > 60000) scanUnpaid();
  }, 6000);

  window.BET = { get screen() { return screen; }, get st() { return st; }, get my() { return my; }, get draft() { return draft; }, get unpaid() { return unpaidList; }, C, TX, payFor, oddsTxt, route, scanUnpaid };

  /* ================= 起動 ================= */
  async function boot() {
    if (!STORE || !C) return go('noStore');
    go('boot');
    try { if (MV) MV.prune(); } catch (e) { /* noop */ }
    try { localStorage.removeItem('casa.derby.bet.v3'); } catch (e) { /* noop */ } // 以前の版の覚え（会計番号・ニックネーム）は消す
    try { await C.syncClock(); } catch (e) { online = false; }
    try { st = await C.state(); online = up(); } catch (e) { online = false; if (e && e.code === 'no_store') return go('badStore'); }
    resubscribe();
    route();
    scanUnpaid();
  }
  boot();
})();
