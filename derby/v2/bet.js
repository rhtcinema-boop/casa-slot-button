/* casa DERBY v4 お客さんのスマホ（bet.html?store=<id>）。2026-10-21 作り直し（仕様書_v4_大改修.md「スマホとテレビの細かい所」・v2/V4_CORE_NOTES.md 8 章）。
   通信は v2/client.js（DerbyCloud）だけ。模擬クラウドも Firestore も同じ呼び方。
   流れ: ①待ち（次のレース・投票の始まり）→ ②会計番号 2 けた（数字のボタン）＋ニックネーム → ③予想（馬の情報＋6×6 の表）→ ④確認 → 投票する
         → ⑤投票済み（あなたの予想・選び直す・締切まで）→ ⑥レース中（あなたの予想だけ）→ ⑦結果（当たり: 額・会計番号・スタッフが動かすスライド／はずれ: 結果と次のレース）
   覚えるもの: ニックネーム（投票できたら。次からは会計番号だけ。2026-11-05）と、そのレースの票の持ち主のしるし（DerbyCloud.myVotes。client.js が自動で覚える）。
   言葉は下の TX にまとめた（文字帳で直す。ふつうの文字のまま）。音は鳴らさない。テスト用に window.BET を出す。 */
(function () {
  'use strict';
  /* ================= 言葉（文字帳） ================= */
  const TX = {
    connecting: '接続中…', offline: '通信が切れています', waiting: '接続を待っています',
    noStore: 'テレビの QR から開いてください', badStore: 'お店が見つかりません', loading: '読み込み中…',
    test: 'テストレース',
    waitHead: '次のレース', waitVoteFrom: '投票は {t} から', waitLeft: '受付開始まで あと', dayOver: '本日のレースは終わりました', /* 2026-11-23 残り時間の言い方を競馬とボートでそろえた（ref/boat/つなぐ設計案_2026-11-23.jpg）: 待ち「受付開始まで あと」→ 投票中「締切まで あと」→ 締切後「まもなく発走」。前は「投票の始まりまで」「締切まで」 */
    prep: '準備中です' /* 2026-11-28 オーナー「無駄に説明多い」: 消した */, prepStaff: 'スタッフにお知らせください', /* 2026-10-28: 投票の始まりを過ぎたのにレースがまだできていない（0:00 のまま止まって見えた） */
    billHead: '会計番号', nickHead: 'ニックネーム', nickChange: '変える', nickSaved: '前回の名前で投票します', nickSub: '' /* 2026-11-28 消した */, toPick: '予想をえらぶ',
    errBill: '会計番号を 2 けたで入れてください', errNick: 'ニックネームを入れてください',
    pickHead: '1着と2着をえらぶ', pvHorse: '馬を選ぶ', pvPop: '人気順で選ぶ', first: '1着', second: '2着', colNo: '馬番', colName: '馬名', colOdds: 'の倍率', pickStep1: '① 1着になる馬を選んでください', pickStep2: '② 2着になる馬を選んでください', toConfirm: 'この予想で次へ', ifHit: '的中すると', pickDone: '予想が決まりました', pick2SubT: '同じ組み合わせでもえらべます', pickAxis: '上が1着・左が2着', pickTap: 'マスを押してください', cond: '調子', style: '脚質', recent: '近走',
    confHead: 'この予想で投票しますか？', ifWin: '当たれば', shiftNote: '' /* 2026-11-28 オーナー「無駄に説明多い」: 消した */,
    backS: '戻る', /* 2026-11-18 1 画面: 予想の画面のいちばん上の小さなボタン（読み上げは back のまま） */
    voteBtn: '投票する', changeBtn: 'この予想に変える', back: '投票画面に戻る', sending: '送っています…',
    voted: '投票しました', yourPick: 'あなたの予想', closeIn: '締切まで あと', closeInS: '締切まで', redo: '選び直す',
    resultWait: '結果を待っています', racing: 'レース中', soon: 'まもなく発走',
    win: '当たり', amount: '当選額', staffOps: 'スタッフが操作します', slide: 'スライドして受け取り', saving: '記録しています…',
    paid: '受け取り済み', expired: '受け取りの期限が切れました', voided: 'このレースは取り消しになりました', testNoPay: 'テストなので受け取りはありません',
    lose: 'はずれ', result: '結果', toNext: '次のレースへ', toNextVote: '次のレースに投票する', toBack: 'もどる',
    nextRace: '次のレース {t}', nextVote: '投票は {t} から',
    todayHead: '本日のレース', todayNext: '次', todayNone: '本日のこの店のレースはありません', /* 本日の出走時間（2026-10-27） */
    billTaken: 'この番号はもう使われています', billTakenSub: 'スタッフに伝えてください\n番号を空けてもらうと投票できます', /* 2026-10-24 文字帳 w0030: 2 行で（\n で改行） */
    closed: '締め切りました', notOpen: '投票はまだ始まっていません', noOpen: 'いま投票できるレースがありません',
    netErr: '通信できませんでした。もう一度押してください', retry: 'もう一度お試しください',
    released: '番号が空けられました。もう一度投票できます',
    unpaid: '受け取っていない当たりがあります', unpaidBtn: '{b}番 {a} を受け取る', keepTill: '' /* 2026-11-28 消した */,
    claimNet: '通信できませんでした。もう一度スライドしてください',
    /* 初参加ボーナス（2026-10-24 オーナー決定: そのスマホで初めて投票するレースで、その日その番号で 1 回だけ 2 票） */
    bonusHead: '初参加ボーナス：もう1票', bonusSub: '' /* 2026-11-28 消した */, bonusBtn: 'もう1票えらぶ', bonusTag: '初参加ボーナス',
    /* スタンプラリー（2026-11-02 オーナー「10 個で 2 票目」。仮・デモで確かめる）: 端末ごとにためる（v2/core.js の「スタンプラリー」） */
    stampHead: 'スタンプカード', stampLeft: 'あと {k} 個で、2票目が入れられます', stampReady: '{c} 個達成！|次の投票で 2票目が使えます',
    /* 2026-11-15 オーナー「10 個たまったら演出で『2票目獲得』・次から使えます・次のスタンプカードが発行される・使ったら減る」: 10 個で「2票目の券」1 枚に替わり、カードは新しい 1 枚に（数え方は前と同じ＝残り ÷ cost が券・あまりがカード） */
    stampTk: '2票目の券', stampTkN: '{t} 枚', stampTkSub: '次の投票で使えます', stampLeft2: 'あと {k} 個で、もう 1 枚',
    stampFxK: 'スタンプ {c} 個 達成！', stampFxH: '2票目|獲得！', stampFxS: '次の投票から使えます', stampFxN: '新しいスタンプカードを発行しました', stampFxOk: 'OK', stampFxHave: '2票目の券 {t} 枚',
    stampRule: '投票 +{v}|当たり +{w}|1着か2着に1頭 +{n}', stampUseHead: '2票目の券で もう1票', stampUseSub: '' /* 2026-11-28 オーナー「説明多い」: 消した */,
    stampUseBtn: '券を使って2票目をえらぶ', stampTag: 'スタンプ', stampGot: 'スタンプ +{n}', stampVote: '投票', stampWin: '当たり', stampNear: '1・2着に1頭', noStamp: 'スタンプの2票目は使えません',
    vote1: '1票目', vote2: '2票目', pick2Head: '2票目をえらぶ', pick2Sub: '金の点が1票目・同じ組み合わせでもえらべます', vote2Btn: '2票目を投票する',
    redo1: '1票目を選び直す', redo2: '2票目を選び直す', noBonus: '初参加ボーナスの2票目は使えません',
    times: '{a} × {n}票', hitMark: '当たり', missMark: 'はずれ', slideAll: 'スライドして{n}票分受け取り',
    /* BPT（ボートレースポイント）の追加の票（2026-11-18）。画面に「ポイント」とは書かない（競馬の当たりは pt、ボートは BPT）。2026-11-23: 「券・枚」→「票」 */
    bptHead: 'BPT で票を追加（あと{n}票）', bptLeft: '1票 100 BPT・残り {b} BPT', bptTag: 'BPT の票', bptPickHead: '追加の票をえらぶ', bptPickSub: '同じ組み合わせでもOK・1票 100 BPT', bptGo: '{n}票 追加する',
    bptAdding: '票を追加しています…', bptDone: 'BPT で{n}票 追加しました', bptPart: 'BPT で{n}票 追加しました（残り{m}票は追加できませんでした）', /* 2026-11-20: 何枚か入ったところで締め切られたとき */ bptNo: 'BPT の票は追加できませんでした', bptBack: 'BPT の{n}票は返還（{b} BPT を戻しました）', bptBackCut: 'BPT の{n}票は返還（{b} BPT を戻しました。BPT が上限に達したため）' /* 2026-11-23 オーナー決定: 上限の数字（3,000）は画面に出さない */, /* 2026-11-20: 返還した追加の券（上限のため・取り消したレース。券の bptBack の印） */ bptN: '×{n}票', bptSum: '（{n}票分）',
    /* 2026-11-24 オーナー決定「ボートと同じ形」: 最初の「予想をえらぶ」画面から、BPT で組み合わせを複数えらぶ（1 つ目は無料・2 つ目から 1票 100 BPT）。
       えらんだ組み合わせは画面の下に並べる（押すと消せる）→ まとめて確認 → 投票。BPT を持っている人だけ（BPT 0 の人には出さない）。足せる数は今の決まり（bptLeftFor）のまま */
    cartAdd: '＋ もう1つ えらぶ', cartGo: '確認へ（{n}票）', cartFree: '無料', cartBpt: '100 BPT', cartDel: '取り消す', cartMax: 'BPT の票は ここまで',
    cartHead: 'この{n}票で投票しますか？', cartBal: 'BPT 残り {a} → {b}', cartVote: 'まとめて投票する（{n}票）',
    /* この店は投票できないレース（2026-10-26 オーナー: レースごとに投票できる店を選べる）。待ち画面の上の知らせと、送ってしまったときのお知らせ */
    watchOnly: 'いまの {t} のレースは {s} だけの開催です', notMyStore: 'このレースはこの店では投票できません',
    /* 2026-10-28 速さと「必ず開ける・必ず投票できる」: つながるまでの知らせと、投票の自動の送り直し */
    bootSlow: '通信に時間がかかっています。自動でつなぎ直しています', reload: '読み込み直す',
    sendSlow: '時間がかかっています。このままお待ちください', sendRetry: '通信が不安定です。自動で送り直しています（{n}回目）',
    checking: '最新状況を確認中…', closedSend: '受付できませんでした（締め切りました）', ownerChanged: 'この端末の記録が変わったため、ここからは選び直せません。変更はスタッフにお伝えください',
    sendQueued: '電波が戻ったら自動で送ります' /* 2026-11-28 短く（締切の時刻は上の帯にある） */, sendFail: '送れませんでした。電波が戻ると自動で送ります', resend: 'もう一度送る',
    /* 2026-10-29 オーナー「投票終わった端末のみレースを観測できるように」: 投票した人だけの「レースを見る」（テレビと同じ画面。v2/watch.js） */
    watchBtn: 'レースを見る', watchSub: 'テレビと同じ画面', watchOff: '観戦は休止中です', watchOffSub: '混み合っているため', /* 読み取りの枠（2026-11-25） */
  };
  const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? o[k] : ''));

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = new URLSearchParams(location.search);
  const STORE = (qs.get('store') || '').trim().toLowerCase(), TKQ = ((document.currentScript || {}).src || '').replace(/^[^?]*/, '');
  const DC = window.DerbyCloud || null, MV = DC && DC.myVotes, F = window.DerbyForm || null;
  const C = DC && STORE ? DC.create({ store: STORE, role: 'phone' }) : null;
  const now = () => (C ? C.serverNow() : Date.now());
  const MAX_NICK = 8, VKEY = 'casa.derby.vote.', NKEY = 'casa.derby.nick';
  const savedNick = () => { try { return cleanNick(localStorage.getItem(NKEY) || ''); } catch (e) { return ''; } };
  // 初めての人への説明を出すか（2026-11-08）: 名前の覚えも票の覚えも無く、まだ閉じていないスマホ。?intro=1 で必ず出す（確かめ用）
  const introDue = () => { try { if (qs.get('intro') === '1') return true; if (localStorage.getItem('casa.derby.intro') === '1' || savedNick()) return false; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(VKEY) === 0) return false; } return true; } catch (e) { return false; } };
  const saveNick = (n) => { n = cleanNick(n); if (!n) return; try { localStorage.setItem(NKEY, n); } catch (e) { /* 覚えられない端末は毎回入れる */ } }; // VKEY: client.js の myVotes の置き場所（受け取っていない当たりを探すときだけ読む）
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
  /* 2026-11-21（ボート 3 回目 L6）: ボートのスマホ（v2/boat-bet.js の cleanNick）と同じ 1 つの決まり。見えない字・向きの印・U+0080〜U+009F の制御文字（U+0085 など）を取りのぞき、
     結合文字（濁点・囲みの印など）と絵文字をつなぐ字だけ（見える字が無い）なら空＝通さない */
  const NICK_INVIS = /[\u0000-\u001f\u007f-\u009f­͏؜ᅟᅠ឴឵᠋-᠏​‌‎‏‪-‮⁠-⁯ㅤ﻿ﾠ￰-￻]/g;
  const cleanNick = (s) => { const n = cutNick(String(s || '').normalize('NFKC').replace(NICK_INVIS, '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim()); return /[^\s\p{M}‍]/u.test(n) ? n : ''; };
  const billOk = (b) => /^\d{1,2}$/.test(b) && Number(b) >= 1 && Number(b) <= 99;
  const bill2 = (b) => String(b).padStart(2, '0');

  /* ================= 状態 ================= */
  let screen = 'boot', st = null, online = true, unsub = null, subVid = null, busy = false;
  let draft = null;            // 入力中（メモリーだけ）: { raceId, bill, nick, first, second, redo, n（2 ＝ 初参加ボーナスの 2 票目）, err }
  let stampSt = null, stampAt = 0, stampFor = '', stampShown = null; // stampShown: 画面に出した数（増えたマスに「押された」動きを付けるため） // スタンプラリー: { cost, vote, win, near, bal, earned, spent, h } | null（オフ・模擬クラウド）
  function loadStamps(delay) {
    if (!C || !C.stamps) return;
    setTimeout(() => { C.stamps().then((x) => { const k = JSON.stringify(x); if (k !== JSON.stringify(stampSt)) { stampSt = x; stampMile(x); lastSig = ''; route(); } stampAt = Date.now(); }).catch(() => {}); }, delay || 0);
  }
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
  const shiftOn = () => { const x = st && st.settings; if (x && typeof x.shiftOn === 'boolean') return x.shiftOn; if (!x || x.shiftUp == null || x.shiftDown == null) return true; return Number(x.shiftUp) > 0 || Number(x.shiftDown) > 0; }; // shiftOn: 倍率が動くか（2026-11-21 から幅の数は配らない）。無ければ前の形の数

  /* ================= 画面の部品 ================= */
  function toast(text, err, ms) { const t = $('toast'); t.textContent = text; t.className = 'toast' + (err ? ' err' : ''); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms || 3200); }

  /* ---------- 動き（2026-11-28 オーナー「お客さんの投票画面にワクワクするアニメーションを」。言葉と見た目は v2/bet.css のいちばん下の「動き」の段 ＝ ボート（v2/boat-bet.js）と同じ） ----------
     画面は作り直して描くので、動きは「合図」で出す: 押した所・届いた所で mv('名前') → 次に描いた画面の根（.scr）に mv-名前 が付く（途中で描き直しても --mv-名前 の時間の続きから）。
     動きの終わりは待たない（押す・送る・読むは今までどおり）。鼓動 ＝ 残り 30 秒からの残り時間（data-bt）。当たりの光と数え上がりは v2/ticket.js の BetFx。音・振動なし */
  const mvT = {}, MVMS = { p1: 400, p2: 400, set: 700, add: 450, qty: 300, print: 1600, win: 2600, lose: 1400 };
  const mv = (k, x) => { mvT[k] = { t: performance.now(), x }; };
  function mvMark(root) {
    const n = performance.now();
    for (const k in mvT) { const d = n - mvT[k].t; if (d > MVMS[k]) { delete mvT[k]; continue; } root.classList.add('mv-' + k); root.style.setProperty('--mv-' + k, -Math.round(d) + 'ms'); }
    if (mvT.add) { const c = root.querySelectorAll('.cartl .cc')[mvT.add.x]; if (c) { c.classList.add('mv-chip'); c.style.setProperty('--mvd', -Math.round(n - mvT.add.t) + 'ms'); } }
    if (mvT.win && window.BetFx) { BetFx.burst(mvT.win.t); BetFx.count(root.querySelector('.hit .a .n'), mvT.win.t, 900); }
  }
  const beat = (e, ms) => { const s = Math.ceil(ms / 1000), k = ms > 0 && s <= 30 ? (s <= 10 ? 'b' : 'a') + (s & 1) : ''; if (k) { if (e.dataset.bt !== k) e.dataset.bt = k; } else if (e.dataset.bt) delete e.dataset.bt; };
  let fxFor = '', fxDue = ''; // 当たり・はずれの動きを出したレース（レースごとに 1 回）／「レースを見る」の窓を閉じたら出す動き（'win'・'lose'・'print'）
  const cd = (at, cls) => '<b class="cd' + (cls ? ' ' + cls : '') + '" data-cd="' + at + '">' + mmss(at - now()) + '</b>'; // 1 秒ごとに数字だけ書き換える
  const testTag = (r) => (isTest(r) ? '<div class="testtag">' + esc(TX.test) + '</div>' : '');
  const bb = (k) => (window.BetBoat ? BetBoat.card(k) : ''); // 次のボートレースと BPT（2026-11-23。中身は v2/bet-boat.js ＝ loadBB があとから読む）
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
  /* 次のビッグレース（2026-11-11 試作。テレビの待ち画面と同じ中身: 名前・日時・あと何日。金額は書かない）。データは st.big（無ければ window.__demoBig＝確認用） */
  /* 投票中・投票済み・結果のビッグレースの札（2026-11-11 試作「投票中も特別な見た目」）: 金の帯にレース名。金額は書かない。r.big（確認用に window.__demoBigRace） */
  function bigTag(r) { const b = r && (r.big || window.__demoBigRace); if (!b) return ''; return '<div class="bigtag"><i>★</i><b>' + esc(r.bigName || (window.__demoBig && window.__demoBig.name) || 'ビッグレース') + '</b><i>★</i></div>'; }
  function bigCard() {
    const B = (st && st.big) || window.__demoBig, t = Date.now(); if (!B || !(B.at > t)) return '';
    const d = new Date(B.at), WDJ = '日月火水木金土', day0 = (x) => { const y = new Date(x); y.setHours(y.getHours() - 6); y.setHours(0, 0, 0, 0); return y.getTime(); };
    const dd = Math.round((day0(B.at) - day0(t)) / 86400000), hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return '<div class="bigc"><span class="bk">次のビッグレース</span><b class="nm">' + esc(B.name || 'ビッグレース') + '</b>' +
      '<div class="bw"><span>' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WDJ[d.getDay()] + '）</span><b>' + hm + '</b><em>' + (dd <= 0 ? '今夜！' : dd === 1 ? 'あした' : 'あと ' + dd + ' 日') + '</em></div></div>';
  }
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
      else if (screen === 'race') h += '<span>' + esc(r.runAt > n && r.status !== 'done' ? TX.soon : TX.racing) + '</span>'; // 締切のあと、発走（ゲートが開く runAt）までは「まもなく発走」
      else if (r.closeAt > n && n >= (r.openAt || 0)) h += '<span class="' + (r.closeAt - n < 15000 ? 'hot' : '') + '">' + esc(isTest(r) ? TX.closeInS : TX.closeIn) + ' <b data-cd="' + r.closeAt + '">' + mmss(r.closeAt - n) + '</b></span>'; // テストレースの札と並ぶときは短く（幅 360px で上の帯からはみ出さないように）
      else if (r.closeAt <= n) h += '<span>' + esc(TX.closed) + '</span>';
    }
    if (el.innerHTML !== h) el.innerHTML = h;
    const fk = online + '|' + (h ? 1 : 0); if (drawTop.fk !== fk) { drawTop.fk = fk; if (drawn) fitLevel(); } // 上の帯の高さが変わった（通信の知らせ・締切の札）ときは詰め方を決め直す（b220）
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
    if (!nx) return '<div class="scr mid">' + unpaidNote() + watchNote() + '<div class="waitbox"><p class="wk">' + esc(TX.dayOver) + '</p></div>' + bb('wait') + bigCard() + todayRow() + '</div>';
    const open = nx.openAt || nx.at;
    const pk = prepKey();
    if (pk) return '<div class="scr mid">' + unpaidNote() + watchNote() + '<div class="waitbox prep" id="prepBox"><p class="wk">' + esc(TX.waitHead) + '</p><p class="wt">' + hhmm(nx.at) + '</p>' +
      '<p class="wv prep" role="status"><i class="prepdot" aria-hidden="true"></i>' + esc(TX.prep) + '</p>' + (pk === 'late' ? '<p class="prepstaff">' + esc(TX.prepStaff) + '</p>' : '') + '</div>' + todayRow() + '</div>';
    return '<div class="scr mid">' + unpaidNote() + watchNote() + testTag(nx) +
      '<div class="waitbox"><p class="wk">' + esc(TX.waitHead) + '</p><p class="wt">' + hhmm(nx.at) + '</p>' +
      '<div class="wr"><p class="wv">' + esc(fill(TX.waitVoteFrom, { t: hhmm(open) })) + '</p>' + /* 2026-11-18: 右の列（投票の始まり・残り）にまとめる */
      '<div class="clock"><div class="k">' + esc(TX.waitLeft) + '</div><div class="v">' + cd(open) + '</div></div></div></div>' + bb('wait') + bigCard() + stampCard() + todayRow() + '</div>'; // 本日のレースの時刻（2026-10-27）は枠の下
  };

  /* 覚えていた状態で開いて、最新の状況がまだ届いていない間（2026-10-28）: 入力はできる・送るのは届いて確かめてから（submitVote） */
  const checkNote = () => (stLive ? '' : '<div class="note" role="status">' + esc(TX.checking) + '</div>');
  /* ② 会計番号（数字のボタン）＋ニックネーム */
  R.entry = () => {
    const d = draft, b = d.bill || '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'];
    return '<div class="scr entry">' + checkNote() + (notice ? '<div class="note" role="status">' + esc(notice) + '</div>' : '') + unpaidNote() + testTag(st && st.current) + bigTag(st && st.current) +
      (d.err === 'bill_taken' ? '<div class="note red" role="alert"><b>' + esc(TX.billTaken) + '</b>' + TX.billTakenSub.split('\n').map((s) => '<span class="ln">' + esc(s) + '</span>').join('') + '</div>' : '') +
      '<div class="sec billsec"><h1>' + esc(TX.billHead) + '</h1>' +
      '<div class="digits' + (b ? '' : ' empty') + '" id="digits" aria-live="polite" aria-label="会計番号 ' + esc(b) + '">' + digitsHtml(b) + '</div>' +
      '<div class="keypad">' + keys.map((k) => '<button type="button" data-key="' + k + '"' + (k === 'clr' ? ' aria-label="全部消す">全部消す' /* 2026-11-28 採点: 全部消すのか 1 字消すのか迷う → 「全部消す」（右下の ⌫ は 1 字消す） */ : k === 'del' ? ' aria-label="1文字消す">⌫' : '>' + k) + '</button>').join('') + '</div></div>' +
      (d.nickFixed ? '<div class="sec nickrow"><span class="nl">' + esc(TX.nickHead) + '</span><b class="nv" data-fit="16">' + esc(d.nick) + '</b><button type="button" class="btn ghost sm" data-act="editNick">' + esc(TX.nickChange) + '</button></div>' /* 2026-11-28 オーナー「無駄に説明多い」: 消した */ : '<div class="sec nicksec"><h2>' + esc(TX.nickHead) + '</h2><input class="big nick" id="nick" type="text" autocomplete="off" autocapitalize="off" enterkeyhint="done" maxlength="40" value="' + esc(d.nick || '') + '" aria-label="ニックネーム（8文字まで）">' + (TX.nickSub ? '<p class="sub">' + esc(TX.nickSub) + '</p>' : '') + '</div>') +
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
    /* 2026-11-05 オーナー「本物の競馬アプリの 2 連単のオッズの見方と一緒に」: 投票アプリ（馬単の「通常」）と同じく、出馬表の行ごとに「1着」「2着」を押す形。
       1 着を選ぶと 2 着の欄にその組み合わせの倍率が出る（オッズの見方も同じ）。「人気順で選ぶ」は 30 通りを倍率の低い順に（押すとそのまま確認へ）。
       以前の 6×6 の表（上＝1 着・左＝2 着）はやめた（表の読み方を取り違えるお客さんがいた） */
    const both = d.first != null && d.second != null, pv = d.pv === 'pop' ? 'pop' : 'horse';
    const v1 = (d.n === 2 || d.x) && my && my.vote ? my.vote : null; // 2 票目・追加の券をえらぶとき: 1 票目の組み合わせを上に出す（同じ組み合わせも選べる）
    const tabs = '<div class="pvtabs" role="tablist">' + [['horse', TX.pvHorse], ['pop', TX.pvPop]].map(([k, l]) => '<button type="button" class="pvt' + (pv === k ? ' on' : '') + '" role="tab" aria-selected="' + (pv === k) + '" data-act="pv" data-v="' + k + '">' + esc(l) + '</button>').join('') + '</div>';
    const rows = hs.map((h) => {
      const is1 = d.first === h.i, is2 = d.second === h.i, o = d.first != null && !is1 ? exOdds(r, d.first, h.i) : null;
      /* 2026-11-28 採点「調子・脚質・近走が小さい」: 字を 1.2 倍に。調子・脚質を 1 行目、近走を 2 行目に分けて、いつも 2 行（行の高さは増えない。ボートと同じ） */
      const sub = [h.cond, h.type].filter(Boolean).map((x) => '<span class="nw">' + esc(x) + '</span>').join('<i>・</i>') + (h.recent ? '<span class="nw kin">' + esc(TX.recent + ' ' + h.recent) + '</span>' : '');
      return '<div class="btr' + (is1 ? ' s1' : '') + (is2 ? ' s2' : '') + '" role="row">' + waku(h, 'lg') +
        '<span class="bn"><b data-fit="15">' + esc(h.name) + '</b><small>' + sub + '</small></span>' +
        '<button type="button" class="pk k1' + (is1 ? ' on' : '') + '" data-act="p1" data-i="' + h.i + '" aria-pressed="' + is1 + '">' + (is1 ? '<span class="ck" aria-hidden="true">✓</span><b>' + esc(TX.first) + '</b>' : esc(TX.first)) + '</button>' +
        '<button type="button" class="pk k2' + (is2 ? ' on' : '') + (o != null ? ' od' : '') + '" data-act="p2" data-i="' + h.i + '"' + (d.first == null || is1 ? ' disabled' : '') + ' aria-pressed="' + is2 + '" aria-label="2着 ' + h.no + '番 ' + esc(h.name) + (o != null ? ' ' + oddsTxt(o) + '倍' : '') + '">' +
          (is2 ? '<span class="ck" aria-hidden="true">✓</span>' : '') + (o != null ? '<b>' + oddsTxt(o) + '</b><i>倍</i>' : is1 ? '<small>1着</small>' : esc(TX.second)) + '</button></div>';
    }).join('');
    const step = d.first == null ? 1 : d.second == null ? 2 : 0;
    const head = '<div class="bth" role="row"><span>' + esc(TX.colNo) + '</span><span>' + esc(TX.colName) + '</span><span class="c' + (step === 1 ? ' now' : '') + '">' + esc(TX.first) + '</span><span class="c' + (step === 2 ? ' now' : '') + '">' + esc(TX.second) + (d.first != null ? '<small>' + esc(TX.colOdds) + '</small>' : '') + '</span></div>';
    const horseView = '<div class="bt step' + step + '" role="table" aria-label="2連単 1着と2着をえらぶ"' + (pv === 'horse' ? '' : ' hidden') + '>' + head + rows + '</div>';
    const pop = []; hs.forEach((a) => hs.forEach((b) => { if (a.i !== b.i) pop.push({ a, b, o: exOdds(r, a.i, b.i) }); }));
    pop.sort((x, y) => (x.o || 1e9) - (y.o || 1e9) || x.a.i - y.a.i || x.b.i - y.b.i);
    const popView = '<ol class="poplist"' + (pv === 'pop' ? '' : ' hidden') + '>' + pop.map((x, k) => { const sel = d.first === x.a.i && d.second === x.b.i, m1 = v1 && v1.first === x.a.i && v1.second === x.b.i;
      return '<li><button type="button" class="cell pop' + (sel ? ' sel' : '') + (m1 ? ' m1' : '') + '" data-a="' + x.a.i + '" data-b="' + x.b.i + '" aria-label="' + (k + 1) + '番人気 1着 ' + x.a.no + '番 2着 ' + x.b.no + '番 ' + oddsTxt(x.o) + '倍"><span class="rk">' + (k + 1) + '</span><span class="cb">' + waku(x.a, '') + '<i>→</i>' + waku(x.b, '') + '</span><span class="nm2">' + esc(x.a.name) + '<br>' + esc(x.b.name) + '</span><b class="po">' + oddsTxt(x.o) + '<small>倍</small></b>' + (m1 ? '<em>' + esc(TX.vote1) + '</em>' : '') + (sel ? '<span class="ck" aria-hidden="true">✓</span>' : '') + '</button></li>'; }).join('') + '</ol>';
    const o = both ? exOdds(r, d.first, d.second) : null;
    /* 2026-11-24 BPT で組み合わせを複数（ボートと同じ形）: えらんだ組み合わせは下の帯の上に並べる（押すと消せる）。BPT を持っている人だけ（cartOn） */
    const co = cartOn(d, r), cl = cartL(d), nAll = cl.length + (both ? 1 : 0), L = co ? bptLeftFor(d, r) : 0, cbal = bptSt ? bptSt.bal : 0;
    const cartRow = co && cl.length ? '<div class="cartl" data-scrollarea>' + cl.map((x, i) => '<button type="button" class="cc" data-act="cartDel" data-i="' + i + '" aria-label="' + esc(TX.cartDel) + ' ' + (x.first + 1) + '→' + (x.second + 1) + '">' + waku(hs[x.first], 'sm') + '<i>→</i>' + waku(hs[x.second], 'sm') + '<small>' + esc(i ? TX.cartBpt : TX.cartFree) + '</small><em aria-hidden="true">×</em></button>').join('') + '</div>' : '';
    const goB = '<button class="btn" data-act="toConfirm">' + esc(co && cl.length ? fill(TX.cartGo, { n: nAll }) : TX.toConfirm) + '</button>';
    const addB = co ? '<button type="button" class="btn ghost cartadd" data-act="cartAdd"' + (cl.length >= L ? ' disabled' : '') + '>' + esc(cl.length >= L ? TX.cartMax : TX.cartAdd) + (cl.length >= L ? '' : '<small>' + esc(fill(TX.bptLeft, { b: amt(Math.max(0, cbal - Math.max(0, nAll - 1) * 100)) })) + '</small>') + '</button>' : '';
    const dock = '<div class="pickdock" aria-live="polite">' + cartRow + (both
      ? '<p class="pdok">✓ ' + esc(TX.pickDone) + '</p><div class="pdsel"><span class="pdc">' + waku(hs[d.first], '') + '<i>→</i>' + waku(hs[d.second], '') + '</span><span class="pdo"><b>' + oddsTxt(o) + '</b>倍</span><span class="pdw">' + esc(TX.ifHit) + ' <b>' + ptT(o ? payFor(o) : 0) + '</b></span></div>' + (co ? '<div class="btnrow cartbtns">' + addB + goB + '</div>' : goB)
      : '<p class="pdh">' + esc(d.first == null ? TX.pickStep1 : TX.pickStep2) + '</p>' + (co && cl.length ? goB : '')) + '</div>';
    const v1Line = v1 ? '<p class="v1line">' + esc(TX.vote1) + ' ' + arrowNum(v1.first, v1.second) + '</p>' : '';
    /* 2026-11-18 オーナー「1 画面で全部」: 「戻る」はタブの横（上の 1 行）・表は残りの高さいっぱい（入らない小さい画面は表の中だけ動く）・下の帯はいちばん下 */
    const backB = d.redo || d.n === 2 || d.x ? '<button type="button" class="btn ghost pkback" data-act="cancelRedo" aria-label="' + esc(TX.back) + '">‹ ' + esc(TX.backS) + '</button>' : '<button type="button" class="btn ghost pkback" data-act="toEntry" aria-label="' + esc(TX.back) + '">‹ ' + esc(TX.backS) + '</button>';
    return '<div class="scr pickscr">' + checkNote() + testTag(r) + bigTag(r) + (d.n === 2 || d.x ? '<div class="b2head"><div class="bonustag">' + esc(d.x ? TX.bptTag : d.stamp ? TX.stampTag : TX.bonusTag) + '</div><h1>' + esc(d.x ? TX.bptPickHead : TX.pick2Head) + '</h1>' + v1Line + '</div><p class="sub b2sub">' + esc(d.x ? TX.bptPickSub : TX.pick2SubT) + '</p>' : '<h1>' + esc(TX.pickHead) + '</h1>') + /* 見出しはふだん出す（詰める画面では読み上げだけ。bet.css の .os-s） */
      '<div class="pkhead">' + backB + tabs + '</div><div class="pkbody fx" data-scrollarea' + (pv === 'pop' ? ' data-long' : '') + '>' + horseView + popView + '</div>' + dock + '</div>';
  };

  /* ④ 確認: 組み合わせ・倍率・当たれば ○pt */
  R.confirm = () => {
    const r = st && st.current, d = draft; if (!r || d.first == null) return R.pick();
    if (d.multi && cartL(d).length > 1) return confirmCart(r, d);
    const o = exOdds(r, d.first, d.second), left = d.x ? (my && my.bpt ? my.bpt.left : 0) : bptLeftFor(d, r);
    /* BPT の追加の券（2026-11-18）: 足せる人だけ「BPT で券を追加（あと○枚）」の［−］［＋］。d.x ＝ 投票のあとに足す券だけをえらんでいる（1 枚から） */
    const bal = my && my.raceId === d.raceId && my.bpt ? my.bpt.bal : bptSt ? bptSt.bal : 0;
    const k = d.x ? Math.max(1, Math.min(left, d.xn || 1)) : Math.min(left, d.bptN || 0), cnt = (d.x ? 0 : 1) + k; if (d.x) d.xn = k; else d.bptN = k;
    const bptRow = left > 0 ? '<div class="bptrow"><span class="bl"><b>' + esc(fill(TX.bptHead, { n: left - k })) + '</b><small>' + esc(fill(TX.bptLeft, { b: amt(bal - k * 100) })) + '</small></span><span class="stp"><button type="button" class="btn ghost" data-act="bptDec"' + (k <= (d.x ? 1 : 0) ? ' disabled' : '') + ' aria-label="1票へらす">−</button><b>' + k + '</b><button type="button" class="btn ghost" data-act="bptInc"' + (k >= left ? ' disabled' : '') + ' aria-label="1票ふやす">＋</button></span></div>' : '';
    return '<div class="scr confirm">' + checkNote() + testTag(r) + bigTag(r) + (d.n === 2 ? '<div class="bonustag">' + esc(d.stamp ? TX.stampTag : TX.bonusTag) + '・' + esc(TX.vote2) + '</div>' : d.x ? '<div class="bonustag">' + esc(TX.bptTag) + '</div>' : '') + '<h1>' + esc(TX.confHead) + '</h1>' + pickCard(r, d.first, d.second, 'big') + /* 組み合わせの文は出さない（2026-10-21 文字帳 w0052） */
      '<div class="ifwin"><span>' + esc(TX.ifWin) + '</span><b>' + bigAmt(o ? payFor(o) * Math.max(1, cnt) : 0, 'n') + '</b>' + (cnt > 1 ? '<small class="xn">' + esc(fill(TX.bptSum, { n: cnt })) + '</small>' : '') + '</div>' + bptRow +
      (shiftOn() && TX.shiftNote ? '<p class="sub shift">' + esc(TX.shiftNote) + '</p>' : '') +
      whoLine(bill2(d.bill), d.nick) +
      '<p class="err" id="err" role="alert">' + esc(d.err && d.err !== 'bill_taken' ? d.err : '') + '</p>' +
      '<div class="dock"><p class="vstat" id="vstat" role="status">' + esc(d.sendMsg || '') + '</p><button class="btn" data-act="vote"' + (d.sendDis ? ' disabled' : '') + '>' + esc(d.sendLabel || (d.x ? fill(TX.bptGo, { n: k }) : voteLabel(d))) + '</button><button class="btn ghost" data-act="toPick2">' + esc(TX.back) + '</button></div></div>'; // 送っている途中も描き直しで消えない（d.sendLabel・d.sendMsg。2026-10-28）
  };

  /* 2026-11-24 まとめて確認（BPT で組み合わせを複数えらんだとき）: 1 行ずつ（無料／100 BPT・組み合わせ・倍率・当たれば）。行の［×］で取り消し。
     確認の画面の「BPT で票を追加」［−］［＋］（同じ組み合わせを増やす）はここでは出さない（同じ組み合わせも予想の画面で何度でもえらべる。入口を 1 つに） */
  function confirmCart(r, d) {
    const hs = horsesOf(r), cl = cartL(d), nB = cl.length - 1, bal = bptSt ? bptSt.bal : 0, lock = !!d.sendDis;
    const rows = cl.map((x, i) => { const o = exOdds(r, x.first, x.second);
      return '<div class="vr"><span class="vk' + (i ? ' b' : '') + '">' + esc(i ? TX.cartBpt : TX.cartFree) + '</span><span class="cpc">' + waku(hs[x.first], 'sm') + '<i>→</i>' + waku(hs[x.second], 'sm') + '</span><span class="cpo"><b>' + oddsTxt(o) + '</b>倍</span><span class="cpw">' + ptT(o ? payFor(o) : 0) + '</span>' +
        '<button type="button" class="cx" data-act="cartDel" data-i="' + i + '"' + (lock ? ' disabled' : '') + ' aria-label="' + esc(TX.cartDel) + ' ' + (x.first + 1) + '→' + (x.second + 1) + '">×</button></div>'; }).join('');
    return '<div class="scr confirm cartc">' + checkNote() + testTag(r) + bigTag(r) + '<h1>' + esc(fill(TX.cartHead, { n: cl.length })) + '</h1>' +
      '<div class="clh"><span></span><span></span><span>' + esc(TX.colOdds.replace(/^の/, '')) + '</span><span>' + esc(TX.ifWin) + '</span><span></span></div><div class="vlist clist fx" data-scrollarea>' + rows + '</div>' +
      '<p class="cbal">' + esc(fill(TX.cartBal, { a: amt(bal), b: amt(Math.max(0, bal - nB * 100)) })) + '</p>' +
      (shiftOn() && TX.shiftNote ? '<p class="sub shift">' + esc(TX.shiftNote) + '</p>' : '') + whoLine(bill2(d.bill), d.nick) +
      '<p class="err" id="err" role="alert">' + esc(d.err && d.err !== 'bill_taken' ? d.err : '') + '</p>' +
      '<div class="dock"><p class="vstat" id="vstat" role="status">' + esc(d.sendMsg || '') + '</p><button class="btn" data-act="vote"' + (lock ? ' disabled' : '') + '>' + esc(d.sendLabel || voteLabel(d)) + '</button><button class="btn ghost" data-act="toPick2"' + (lock ? ' disabled' : '') + '>' + esc(TX.back) + '</button></div></div>';
  }
  /* 確認へ進むとき（2026-11-24）: えらび途中の組み合わせも並べて、2 つ以上ならまとめて確認（d.multi）。1 つだけなら今までと同じ確認の画面。true ＝ 進める */
  function cartFix(d) {
    if (!d || !cartL(d).length) return false;
    const cl = d.first != null && d.second != null ? cartL(d).concat({ first: d.first, second: d.second }) : cartL(d).slice();
    if (cl.length === 1) { d.first = cl[0].first; d.second = cl[0].second; d.cart = []; d.multi = false; return true; }
    d.cart = cl; d.multi = true; d.bptN = 0; d.first = cl[0].first; d.second = cl[0].second; return true;
  }
  const voteLabel = (d) => (d.multi && cartL(d).length > 1 ? fill(TX.cartVote, { n: cartL(d).length }) : d.redo ? TX.changeBtn : d.n === 2 ? TX.vote2Btn : TX.voteBtn);
  /* 「あなたの予想」の札（⑥レース中。⑤は券が届くまで）。n: 0＝1票/1＝1票目/2＝2票目。combo: 組み合わせの文 */
  function mineCard(r, v, n, combo, who) {
    const o = exOdds(r, v.first, v.second);
    return '<div class="mine' + (n === 2 ? ' b2' : '') + '"><p class="mk">' + esc(n === 2 ? TX.vote2 : TX.yourPick) + (n === 1 ? '<span class="vn">' + esc(TX.vote1) + '</span>' : n === 2 ? '<span class="vn bt">' + esc(v.stamp ? TX.stampTag : TX.bonusTag) + '</span>' : '') + '</p>' + pickCard(r, v.first, v.second, 'mid') +
      (combo ? '<div class="combo">' + esc(comboText(r, v.first, v.second, o)) + '</div>' : '') +
      (o ? '<div class="ifwin sm"><span>' + esc(TX.ifWin) + '</span><b>' + bigAmt(payFor(o), 'n') + '</b></div>' : '') + (who ? whoLine(v.bill, v.nick) : '') + '</div>';
  }
  /* 2026-11-15: 10 個たまるたびに「2票目 獲得！」の演出（1 回だけ）。たまった回数＝付いた合計 ÷ cost を端末に覚えておき、増えたときだけ出す（初めて見る端末・数が戻った端末は覚えるだけ） */
  const STAMP_M = 'casa.derby.stampM';
  let stampRoll = false; // このあとの描き直しで、新しいカードのマスを 1 個目から押す
  function stampMile(S) {
    if (!S || !(S.cost > 0)) return;
    const m = Math.floor((Number(S.earned) || 0) / S.cost); let seen = null;
    try { const v = localStorage.getItem(STAMP_M); seen = v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v); } catch (e) { seen = null; }
    if (seen !== m) { try { localStorage.setItem(STAMP_M, String(m)); } catch (e) { /* 保存できない端末は毎回くらべるだけ */ } }
    if (seen != null && m > seen) { stampRoll = true; stampFx(S); }
  }
  function stampFx(S) {
    const app = $('app'); if (!app) return; const old = document.getElementById('stampFx'); if (old) old.remove();
    const c = S.cost, t = Math.floor(S.bal / c), have = S.bal % c, cols = c % 5 === 0 || c > 6 ? 5 : c;
    const cells = (n, cls) => '<div class="cells" style="grid-template-columns:repeat(' + cols + ',1fr)">' + Array.from({ length: c }, (_, i) => '<i class="sc' + (i < n ? ' on' + (cls || '') : '') + '" data-n="' + (i + 1) + '" style="--d:' + i + '"></i>').join('') + '</div>';
    const h = TX.stampFxH.split('|');
    const box = document.createElement('div'); box.id = 'stampFx'; box.className = 'stampfx'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', h.join(' '));
    box.innerHTML = '<div class="sfx-rays" aria-hidden="true"></div><div class="sfx-in"><p class="sfx-k">' + esc(fill(TX.stampFxK, { c })) + '</p>' +
      '<div class="sfx-deck"><div class="stampcard sfx-old">' + cells(c, ' hit') + '</div><div class="stampcard sfx-new"><p class="sh"><b>' + esc(TX.stampHead) + '</b><span class="sn"><b>' + have + '</b> / ' + c + '</span></p>' + cells(have) + '</div></div>' +
      '<h2 class="sfx-h"><span>' + esc(h[0]) + '</span><em>' + esc(h[1] || '') + '</em></h2><p class="sfx-s">' + esc(TX.stampFxS) + '</p>' +
      '<p class="sfx-n">' + esc(TX.stampFxN) + (t > 1 ? '<small>' + esc(fill(TX.stampFxHave, { t })) + '</small>' : '') + '</p><button type="button" class="btn sfx-ok">' + esc(TX.stampFxOk) + '</button></div>';
    const close = () => { clearTimeout(stampFx.h); box.classList.add('out'); setTimeout(() => { box.remove(); }, 260); };
    box.addEventListener('click', (e) => { if (e.target.closest('.sfx-ok') || e.target === box) close(); });
    app.appendChild(box); clearTimeout(stampFx.h); stampFx.h = setTimeout(close, 12000); // 押されなくても 12 秒で閉じる（次の投票のじゃまをしない）
  }
  function stampCard() {
    const S = stampSt; if (!S) return '';
    const c = S.cost, t = Math.floor(S.bal / c), have = S.bal % c; // t: 2票目の券（10 個で 1 枚。使うと 1 枚減る）・have: いまのカードのスタンプ
    const from = stampRoll ? 0 : stampShown == null ? have : Math.min(have, stampShown), hit = have > from; stampRoll = false; // from〜have が新しく押されたマス
    const cells = Array.from({ length: c }, (_, i) => '<i class="sc' + (i < have ? ' on' : '') + (hit && i >= from && i < have ? ' hit' : '') + '" data-n="' + (i + 1) + '" style="--d:' + Math.max(0, i - from) + '"></i>').join('');
    stampShown = have;
    const tkRow = t > 0 ? '<p class="stk" role="status"><span class="stk-t"><i aria-hidden="true">★</i>' + esc(TX.stampTk) + '<b>' + esc(fill(TX.stampTkN, { t })) + '</b></span><span class="stk-s">' + esc(TX.stampTkSub) + '</span></p>' : '';
    return '<div class="stampcard' + (hit ? ' hit' : '') + (t > 0 ? ' has-tk' : '') + '" role="group" aria-label="' + esc(TX.stampHead) + '"><p class="sh"><b>' + esc(TX.stampHead) + '</b><span class="sn"><b>' + have + '</b> / ' + c + '</span></p>' + tkRow + '<div class="cells">' + cells + '</div>' +
      '<p class="sl">' + esc(fill(t > 0 ? TX.stampLeft2 : TX.stampLeft, { k: c - have })) + '</p></div>'; /* 2026-11-28 オーナー「無駄に説明多い」: スタンプの付き方の行（投票 +1・当たり +3…）を消した */
  }
  const stampUseBox = (c) => '<div class="bonusbox stampuse"><b>' + esc(fill(TX.stampUseHead, { c })) + '</b>' + (TX.stampUseSub ? '<span>' + esc(TX.stampUseSub) + '</span>' : '') + '<button class="btn" data-act="stamp">' + esc(TX.stampUseBtn) + '</button></div>';
  function stampGotLine(all, res) { // 結果: このレースで付くスタンプ（発表のときに進行役のテレビが付ける。テスト・取り消しは付かない）
    const S = stampSt; if (!S || !res || res.test || res.refunded || res.first == null || res.second == null) return '';
    if (stampFor !== res.raceId) { stampFor = res.raceId; loadStamps(3000); loadStamps(12000); }
    /* 付く数は v2/core.js の stampGain と同じ決まり（スマホは core.js を読まないことがあるので、ここでも同じ計算を持つ） */
    const R0 = { first: Number(res.first), second: Number(res.second) }, gain = (x) => { if (!x || x.test || x.first == null || x.second == null) return { n: 0, vote: 0, win: 0, near: 0 }; const a = Number(x.first), b = Number(x.second), win = a === R0.first && b === R0.second, near = !win && (a === R0.first || a === R0.second || b === R0.first || b === R0.second); const o = { vote: S.vote, win: win ? S.win : 0, near: near ? S.near : 0 }; o.n = o.vote + o.win + o.near; return o; };
    const g = all.map(gain), sum = (k) => g.reduce((a, x) => a + x[k], 0), n = sum('n'); if (!n) return '';
    const parts = [[TX.stampVote, sum('vote')], [TX.stampWin, sum('win')], [TX.stampNear, sum('near')]].filter((p) => p[1] > 0).map((p) => p[0] + ' +' + p[1]).join('・');
    return '<div class="stampgot" role="status"><b>' + esc(TX.stampTag) + '<em>+' + n + '</em></b><span>' + esc(parts) + '</span></div>';
  }
  const tk = (r, v, n, c) => (window.BetTicket ? BetTicket(r, c > 1 ? Object.assign({}, v, { tickets: c }) : v, n) : mineCard(r, v, n, true, n < 2)); // ⑤ 馬券ふうの券（v2/ticket.js）。c: 券の枚数（1 票目に重ねた追加の券。2026-11-18）
  /* BPT の追加の券（2026-11-18）: my.extra（券の一覧）・my.bpt（{ bal, left } | null）。1 票目と同じ組み合わせの券は 1 票目の券に「×○枚」、別の組み合わせは小さな行 */
  const xs = () => (my && my.extra) || [], sameC = (a, b) => !!a && !!b && a.first === b.first && a.second === b.second, onMain = (v) => 1 + xs().filter((x) => sameC(x, v)).length;
  const on2 = (x) => !!(my && my.vote2) && sameC(x, my.vote2) && !sameC(x, my.vote), onV2 = () => 1 + xs().filter(on2).length; // 2 票目と同じ組み合わせの追加の券は 2 票目の券に「×○枚」（2026-11-18）
  function xRows(r, done) { // 1 票目と別の組み合わせの追加の券（組み合わせごとに ×○枚）。done: 結果の画面（当たり・はずれ）
    const g = {}; xs().forEach((x) => { if (sameC(x, my.vote) || on2(x)) return; (g[x.combo] = g[x.combo] || []).push(x); });
    const ks = Object.keys(g); if (!ks.length) return '';
    return '<div class="vlist xlist">' + ks.map((k) => { const l = g[k], x = l[0], o = exOdds(r, x.first, x.second), w = done && !!(x.result && x.result.win);
      return '<div class="vr' + (w ? ' w' : '') + '"><span class="vk">' + esc(TX.bptTag) + '</span>' + arrowNum(x.first, x.second) + '<b class="vm">' + esc(fill(TX.bptN, { n: l.length })) + (done ? ' ' + esc(w ? TX.hitMark : TX.missMark) : o ? ' <small>' + esc(TX.ifWin) + ' ' + ptT(payFor(o) * l.length) + '</small>' : '') + '</b></div>'; }).join('') + '</div>';
  }
  const bptBtn = () => (my && my.bpt && my.bpt.left > 0 && !my.lost ? '<button class="btn ghost bptbtn" data-act="bptAdd">' + esc(fill(TX.bptHead, { n: my.bpt.left })) + '<small>' + esc(fill(TX.bptLeft, { b: amt(my.bpt.bal) })) + '</small></button>' : '');
  /* 確認の画面で足せる枚数: 投票済みなら my.bpt.left、まだなら BPT の残り ÷ 100（4 枚まで・テストのレースは 0） */
  let bptSt = null, bptAt = 0;
  function loadBpt() { if (!C || !C.bpt || Date.now() - bptAt < 20000) return; bptAt = Date.now(); C.bpt().then((x) => { const k = JSON.stringify(x); if (k !== JSON.stringify(bptSt)) { bptSt = x; if (screen === 'confirm' || screen === 'pick') draw(); } }).catch(() => {}); }
  function bptLeftFor(d, r) { // 1 レースの残りの枚数（1 票目・2 票目・追加の券を合わせて 5 枚まで。2026-11-18）
    if (!d || !r || r.test) return 0;
    if (d.n === 2) { if (!my || !my.vote || my.raceId !== d.raceId || !my.bpt) return 0; return my.vote2 ? my.bpt.left : Math.max(0, Math.min(my.bpt.left, 3 - (my.vote.xn || 0))); } // 新しい 2 票目は自分で 1 枚使う
    if (my && my.vote && my.raceId === d.raceId && my.vote.bill === bill2(d.bill)) return my.bpt ? my.bpt.left : 0;
    return bptSt && bptSt.bal >= 100 ? Math.min(4, Math.floor(bptSt.bal / 100)) : 0;
  }
  /* 2026-11-24 予想の画面で組み合わせを複数えらべるか: 最初の投票（選び直し・2 票目・投票後の追加ではない）で、BPT の票を足せる人だけ。えらび途中で BPT が読めなくなっても、並べた分は見せる（消せる） */
  const cartL = (d) => (d && d.cart) || [];
  const cartOn = (d, r) => !!d && !!r && !d.redo && d.n !== 2 && !d.x && !(my && my.vote && my.raceId === d.raceId) && (cartL(d).length > 0 || bptLeftFor(d, r) > 0);
  const bonusBox = () => '<div class="bonusbox"><b>' + esc(TX.bonusHead) + '</b>' + (TX.bonusSub ? '<span>' + esc(TX.bonusSub) + '</span>' : '') + '<button class="btn" data-act="bonus">' + esc(TX.bonusBtn) + '</button></div>';
  let ownerChanged = false; // 匿名ログインの uid が変わった（client-firestore.js の onUser）
  R.voted = () => {
    const v = my && my.vote, v2 = my && my.vote2, r = (st && st.current && my && st.current.id === my.raceId ? st.current : my && my.race) || null;
    if (!v || !r) return R.boot();
    const lost = !!my.lost, can = !lost && !v2 && !!my.bonus && stageOf(r) === 'vote', sCan = !lost && !v2 && !can && !!(my.stamp && my.stamp.can) && stageOf(r) === 'vote'; // can: 初参加ボーナス（1 票目のすぐ下に「もう1票」）。sCan: スタンプで 2 票目（11-02）。lost: ログインが変わった（選び直しは出さない）
    /* 2026-11-18 オーナー「1 画面で全部」: 券（大きさはそのまま）・もう1票・締切の時計・本日のレース・スタンプ・ボタンの順。
       入らない小さい画面では「本日のレース・スタンプ」（2 票のときは券も）の欄の中だけ動く（.fx）。「選び直す」と「レースを見る」は横に並べていちばん下 */
    const clock = '<div class="clock"><div class="k">' + esc(TX.closeIn) + '</div><div class="v">' + cd(r.closeAt) + '</div></div>';
    const btns = lost ? '<div class="note" role="status">' + esc(TX.ownerChanged) + '</div>' + watchBtn(r) : v2 ? '<div class="redo2"><button class="btn ghost" data-act="redo">' + esc(TX.redo1) + '</button><button class="btn ghost" data-act="redo2">' + esc(TX.redo2) + '</button></div>' + watchBtn(r)
      : '<div class="btnrow"><button class="btn ghost" data-act="redo">' + esc(TX.redo) + '</button>' + watchBtn(r) + '</div>';
    const xb = stageOf(r) === 'vote' ? bptBtn() : '', xr = xRows(r); // BPT の追加の券（2026-11-18）: 足すボタン・別の組み合わせの券の行
    if (v2) return '<div class="scr voted two">' + testTag(r) + bigTag(r) + '<div class="vhead"><h1 class="done-h"><i aria-hidden="true">✓</i>' + esc(TX.voted) + '</h1>' + clock + '</div>' +
      '<div class="fx" data-scrollarea data-long>' + tk(r, v, 1, onMain(v)) + xr + tk(r, v2, 2, onV2()) + xb + bb('voted') + todayRow() + stampCard() + '</div>' + btns + '</div>';
    return '<div class="scr voted">' + testTag(r) + bigTag(r) + '<h1 class="done-h"><i aria-hidden="true">✓</i>' + esc(TX.voted) + '</h1>' +
      tk(r, v, 0, onMain(v)) + (can ? bonusBox() : sCan ? stampUseBox(my.stamp.cost) : xb) + clock +
      '<div class="fx" data-scrollarea>' + xr + (can || sCan ? xb : '') + bb('voted') + todayRow() + stampCard() + '</div>' + /* 本日のレース（10-27）: 時計の下・「選び直す」の上 */ btns + '</div>';
  };

  /* 「レースを見る」（2026-10-29 オーナー「投票終わった端末のみレースを観測できるように」）: このスマホに票があるレースだけ、投票済み・レース中・結果の画面に出す。
     押すとこのページの上に窓を開き、テレビと同じ画面（../index.html?store=<店>&watch=1。v2/watch.js・tv.js の見るだけ）を出す。重い部品（3D の映像）は押したときに初めて読む。
     出すのは結果の画面が終わるまで（endAt）。取り消しのレースは出さない */
  const watchEnd = (r) => r.endAt || (r.revealAt ? r.revealAt + 300000 : (r.closeAt || 0) + 15 * 60000);
  /* 読み取りの枠（2026-11-25 ②③。v2/client-firestore.js の usage）: 観戦してよいか・定期の読み直しをしてよいか（模擬クラウドはいつも良い） */
  const watchOk = () => !(C && C.usage) || C.usage.watchOk();
  const utk = (k, ms) => !(C && C.usage) || C.usage.tick(k, ms);
  let lastWok = true;
  function watchBtn(r) {
    if (!my || !my.vote || !r || r.refunded || r.status === 'void' || my.lost || now() >= watchEnd(r)) return '';
    if (!watchOk()) return '<button class="btn ghost watchbtn" disabled aria-disabled="true">' + esc(TX.watchOff) + '<small>' + esc(TX.watchOffSub) + '</small></button>'; // 読み取りの枠（2026-11-25）: 節約・最低限・この端末の上限のときは観戦を出さない
    return '<button class="btn ghost watchbtn" data-act="watch"><span aria-hidden="true">▶ </span>' + esc(TX.watchBtn) + '</button>'; /* 2026-11-28 オーナー「無駄に説明多い」: 消した */
  }
  /* 窓の見た目は開くときだけ足す（投票ページの最初の読み込みを重くしない＝bet.css には入れない） */
  const WATCH_CSS = '#watchOv{position:fixed;inset:0;z-index:100;background:#0b101b}#watchOv iframe{position:absolute;top:0;bottom:0;left:env(safe-area-inset-left);right:env(safe-area-inset-right);width:calc(100% - env(safe-area-inset-left) - env(safe-area-inset-right));height:100%;border:0;display:block;background:#0b101b}html.watching,html.watching body{overflow:hidden}#watchOv .wload{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:linear-gradient(180deg,#9be070,#5dbb3f);color:#14301a;font-size:18px;font-weight:800}#watchOv .wload p{margin:0}#watchOv .wload .btn{width:auto;min-width:160px;padding:12px 28px}.watchbtn small{display:block;font-size:12px;font-weight:500;opacity:.8}';
  function openWatch() {
    if (!my || !my.vote || $('watchOv')) return;
    if (!watchOk()) { lastSig = ''; route(); return; }
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
    /* 2026-11-28 オーナー「投票確定後にこんな画面出るんだけどバグ？」（旗と空の絵だけの画面）: 窓の中のページ（テレビと同じ画面）は部品が多く、読み込みが終わるまで
       拡大された起動画面の絵だけが出ていた（4G だと長い・閉じるボタンも無い）→ 窓の中の準備ができるまで、上に「読み込み中…」と「閉じる」を出す。
       準備できた＝窓の中のページに watch.js の印（html.watch）が付き、起動画面（#splash）が消えた。図の表示（watchmap.html）は読み込みが終わったら */
    { const ld = document.createElement('div'); ld.className = 'wload'; ld.innerHTML = '<p role="status">' + esc(TX.loading || '読み込み中…') + '</p><button type="button" class="btn ghost">' + esc(TX.watchClose || '閉じる') + '</button>';
      ld.querySelector('button').addEventListener('click', () => closeWatch(false)); ov.appendChild(ld);
      const iv = setInterval(() => {
        if (!ov.isConnected) return clearInterval(iv);
        let ok = false;
        try { const d = fr.contentDocument, here = d && d.location && /^https?:/.test(d.location.protocol); ok = !!here && (map ? d.readyState === 'complete' : d.documentElement.classList.contains('watch') && !d.getElementById('splash')); } catch (e) { ok = false; }
        if (ok) { clearInterval(iv); ld.remove(); }
      }, 200); }
    try { history.pushState(Object.assign({}, history.state || {}, { derbyWatch: 1 }), ''); } catch (e) { /* noop */ } // スマホの「戻る」で窓を閉じる
  }
  function closeWatch(fromPop) {
    const ov = $('watchOv'); if (!ov) return;
    const fr = $('watchFr');
    try { const w = fr && fr.contentWindow; if (w && w.__derbyWatchStop) w.__derbyWatchStop(); } catch (e) { /* noop: 見張りを止める（このページの Firebase の見張りを残さない） */ }
    try { if (fr) fr.src = 'about:blank'; } catch (e) { /* noop */ }
    ov.remove(); document.documentElement.classList.remove('watching');
    if (!fromPop) { try { if (history.state && history.state.derbyWatch) history.back(); } catch (e) { /* noop */ } }
    if (fxDue) { if (screen === (fxDue === 'print' ? 'voted' : 'result')) mv(fxDue); fxDue = ''; } // 動き: 窓を見ている間に出せなかった分を、戻ったときに（券が刷られる・当たり／はずれ）
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
    const xr = xRows(r); // BPT の追加の券（2026-11-18）
    return '<div class="scr racing' + (v2 ? ' two' : ' mid') + '">' + testTag(r) + bigTag(r) + (v2 || xr ? '<div class="fx" data-scrollarea data-long>' + tk(r, v, v2 ? 1 : 0, onMain(v)) + xr + (v2 ? tk(r, v2, 2, onV2()) : '') + '</div>' : tk(r, v, 0, onMain(v))) + watchBtn(r) + '</div>'; // 2 枚は券の欄の中だけ動く（2026-11-18）
  };

  /* 脱落（2026-11-04）: 「3番 ○○ は落馬のため競走中止」／「3番 ○○ は競走除外（ゲートに入れませんでした）」。無ければ空 */
  function incLine(r, res) {
    const x = (r && r.result && r.result.incident) || (res && res.incident); if (!x) return '';
    const h = horsesOf(r)[x.horse]; if (!h) return '';
    return '<p class="incline">' + esc(h.no + '番 ' + h.name + (x.type === 'fall' ? ' は落馬のため競走中止' : ' は競走除外（ゲートに入れませんでした）')) + '</p>';
  }
  /* ⑦ 結果 */
  R.result = () => {
    const v = my && my.vote, r = my && my.race, res = v && v.result; if (!v || !r) return R.boot();
    if (!res) return R.race();
    const nextBtn = (ghost) => { const c = st && st.current, vote = c && c.id !== my.raceId && stageOf(c) === 'vote'; return '<button class="btn' + (ghost ? ' ghost' : '') + '" data-act="dismiss">' + esc(vote ? TX.toNextVote : nextRace() ? TX.toNext : TX.toBack /* 2026-11-28 採点: 「本日のレースは終わりました」なのに「次のレースへ」→ 次が無いときは「もどる」（押した先は同じ） */) + '</button>'; };
    const resLine = '<div class="resline">' + pickCard(r, res.first, res.second, false) + '</div>';
    /* 返還した追加の券（2026-11-20。券に bptBack の印＝BPT を戻した。上限のための返還・取り消したレース）: 「BPT の券○枚は返還（○ BPT を戻しました）」の 1 行。券の絵・当たりはずれの一覧には入れない */
    const backs = xs().filter((x) => x.bptBack === true), lx = xs().filter((x) => x.bptBack !== true), backGot = backs.reduce((a, x) => { const g = Number(x.bptBackGot); return a + (x.bptBackGot != null && isFinite(g) && g >= 0 ? Math.min(100, g) : 100); }, 0) /* 2026-11-21 H8: 実際に戻った額（券ごとの bptBackGot。持ち上限 3,000 で減る。無い古い券は 100） */, backLine = backs.length ? '<p class="incline bptback" role="status">' + esc(fill(backGot < backs.length * 100 ? TX.bptBackCut : TX.bptBack, { n: backs.length, b: amt(backGot) })) + '</p>' : '';
    if (res.refunded) return '<div class="scr result mid">' + testTag(r) + bigTag(r) + '<div class="miss"><h1 class="t">' + esc(TX.voided) + '</h1></div>' + backLine + nextLine() + bb('result') + todayRow() + nextBtn(false) + '</div>';
    const v2 = my.vote2, all = [v].concat(v2 ? [v2] : [], lx), wins = all.filter((x) => x.result && x.result.win); // 追加の券（2026-11-18）も 1 枚ずつ数える
    /* 券の束（2026-11-18）: 1 票目＋同じ組み合わせの追加の券／2 票目／別の組み合わせの追加の券（組み合わせごと）。券は束ごとに 1 枚の絵に「×○枚」 */
    const bundles = (list) => { const g = []; list.forEach((x) => { const key = x.n === 2 || (x.bpt && on2(x)) ? '2' : x.bpt && !sameC(x, v) ? 'x' + x.combo : '1', b = g.find((y) => y.key === key); if (b) b.list.push(x); else g.push({ key, list: [x] }); }); return g; };
    const tkOf = (b) => { const x = b.list[0], n = b.list.length, rs = x.result ? Object.assign({}, x.result, { amount: b.list.reduce((a, y) => a + (Number(y.result && y.result.amount) || 0), 0) }) : x.result; return BetTicket(r, n > 1 ? Object.assign({}, x, { tickets: n }) : x, v2 || lx.length ? (b.key === '2' ? 2 : 1) : 0, rs); };
    /* 初参加ボーナスの 2 票・追加の券: 束ごとに「1票目 3→5 当たり」「2票目 2→4 はずれ」（1 票だけのときは今までどおり） */
    const perVote = v2 || lx.length ? '<div class="vlist">' + bundles(all).map((b) => { const x = b.list[0], w = !!(x.result && x.result.win); return '<div class="vr' + (w ? ' w' : '') + '"><span class="vk">' + esc(b.key === '2' ? TX.vote2 : b.key === '1' ? TX.vote1 : TX.bptTag) + '</span>' + arrowNum(x.first, x.second) + '<b class="vm">' + (b.list.length > 1 ? esc(fill(TX.bptN, { n: b.list.length })) + ' ' : '') + esc(w ? TX.hitMark : TX.missMark) + '</b></div>'; }).join('') + '</div>' : '';
    const sg = stampGotLine(all.filter((x) => !x.bpt), res) + incLine(r, res) + backLine; // 追加の券にはスタンプは付かない（v2/core.js の stampsForRace。2026-11-18）。返還の 1 行も欄の中（1 画面の作法のまま）
    if (!wins.length) {
      /* 2026-11-18 1 画面: 「はずれ」と結果を 1 行・券とスタンプと本日のレースは欄の中だけ動く（.fx）・次のレースの時刻とボタンはいちばん下 */
      return '<div class="scr result lose">' + testTag(r) + bigTag(r) + '<div class="lhead"><div class="miss"><h1 class="t">' + esc(TX.lose) + '</h1></div>' + resLine + '</div>' +
        '<div class="fx" data-scrollarea>' + sg + (window.BetTicket ? bundles(all).map(tkOf).join('') : v2 ? perVote : '<div class="mine sm"><p class="mk">' + esc(TX.yourPick) + ' ' + arrowNum(v.first, v.second) + '</p></div>') + todayRow() + '</div>' +
        nextLine() + bb('result') + '<div class="btnrow">' + watchBtn(r) + nextBtn(false) + '</div></div>'; // はずれの券（ticket.js）
    }
    /* 受け取りは 1 つのスライドで（2 票とも当たりなら 2 票分をまとめて。スタッフの操作は 1 回。2026-10-24 決め） */
    const wr = wins[0].result, total = wins.reduce((a, x) => a + (Number(x.result.amount) || 0), 0), test = wins.some((x) => x.result.test);
    const ps = wins.map((x) => x.result.payout), unpaid = ps.filter((p) => p && p.status === 'unpaid');
    let pay;
    if (test) pay = '<div class="note" role="status"><b>' + esc(TX.testNoPay) + '</b></div>';
    else if (ps.some((p) => !p)) pay = '<div class="note" role="status">' + esc(TX.loading) + '</div>';
    else if (unpaid.length) { const lb = unpaid.length >= 2 ? fill(TX.slideAll, { n: unpaid.length }) : TX.slide; pay = '<div class="payop"><p class="ops">' + esc(TX.staffOps) + '</p><div class="slider" id="slider" role="slider" aria-label="' + esc(lb) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fillbar"></div><span class="lbl">' + esc(lb) + ' ›››</span><div class="knob" aria-hidden="true">›</div></div><p class="err" id="err" role="alert"></p></div>'; } // 「スタッフが操作します」はスライドのすぐ上
    else if (ps.every((p) => p.status === 'paid')) { const at = Math.max.apply(null, ps.map((p) => p.paidAt || 0)); pay = '<div class="stamp" role="status"><b>' + esc(TX.paid) + '</b>' + (at ? '<small>' + hhmm(at) + '</small>' : '') + '</div>'; }
    else if (ps.some((p) => p.status === 'void')) pay = '<div class="note red" role="status"><b>' + esc(TX.voided) + '</b></div>';
    else pay = '<div class="note red" role="status"><b>' + esc(TX.expired) + '</b></div>';
    /* 2026-11-18 1 画面: 当たり・当選額・会計番号・スライドは必ず画面の中。判子つきの券・スタンプ・本日のレースは欄の中だけ動く（.fx。大きい画面では全部見える） */
    return '<div class="scr result win">' + testTag(r) + bigTag(r) + '<div class="hit"><h1 class="t">' + esc(TX.win) + '</h1><div class="combo">' + esc(comboText(r, wr.first, wr.second, wr.odds)) + '</div>' +
      '<div class="k">' + esc(TX.amount) + '</div><div class="a">' + bigAmt(total, 'n') + '</div>' + (wins.length >= 2 ? '<div class="x2">' + esc(fill(TX.times, { a: ptT(wr.amount), n: wins.length })) + '</div>' : '') + '</div>' + perVote +
      '<div class="billbig"><span>' + esc(TX.billHead) + '</span><b>' + esc(v.bill) + '</b><small data-fit="13">' + esc(v.nick) + '</small></div>' + pay +
      '<div class="fx" data-scrollarea>' + sg + (window.BetTicket ? bundles(wins).map(tkOf).join('') : '') + /* 的中の判子つきの券（ticket.js） */ bb('result') + todayRow() + '</div>' +
      (unpaid.length && !test ? '<div class="btnrow">' + watchBtn(r) + '</div>' + (TX.keepTill ? '<p class="keeptill">' + esc(TX.keepTill) + '</p>' : '') : '<div class="btnrow">' + watchBtn(r) + nextBtn(true) + '</div>') + '</div>';
  };

  /* ================= 描画 ================= */
  function go(name) { if (name === 'confirm' || name === 'pick') loadBpt(); if (screen !== name) { window.scrollTo(0, 0); const m = $('main'); if (m) m.scrollTop = 0; } screen = name; draw(); }
  let dragging = false, drawLater = false, drawn = ''; // drawn: 前に描いた画面（画面が変わったときだけふわっと出す。描き直しのたびに出し直すとちらつく）
  function draw() {
    if (dragging) { drawLater = true; return; } // スライドを動かしている途中は描き直さない
    drawLater = false;
    if (screen === 'boot') { const f = $('main').firstElementChild; if (f && f.classList.contains('splash') && f.dataset.slow === String(bootSlow)) { drawn = 'boot'; return drawTop(); } } // 起動の画面がもう出ている（bet.html の中）なら作り直さない（ちらつかない）
    else { const a = $('app'); if (a && a.classList.contains('booting')) a.classList.remove('booting'); }
    const mainEl = $('main'), same = drawn === screen, keepY = same ? mainEl.scrollTop : 0, fxEl = same ? mainEl.querySelector('.fx') : null, keepFx = fxEl ? fxEl.scrollTop : 0; // 2026-11-18: 同じ画面の描き直しでは、欄の中の位置をそのまま
    mainEl.innerHTML = (R[screen] || R.boot)();
    mainEl.scrollTop = keepY; if (keepFx) { const f2 = mainEl.querySelector('.fx'); if (f2) f2.scrollTop = keepFx; }
    const entered = drawn !== screen; // 動き（2026-11-28）: 画面が替わった
    if (entered) { const f = $('main').firstElementChild; if (f) f.classList.add('in'); drawn = screen; }
    drawTop(); fitText($('main')); fitLevel();
    { const f = mainEl.firstElementChild; if (f) { /* 動き: 1 画面の詰め（fitLevel）を測ったあとに印を付ける（動きの始まりのずれを「入らない」と測らない）。入り（部品が順に）・結果が出たら当たり／はずれ（レースごとに 1 回。「レースを見る」の窓が上にある間は出さず、閉じたときに出す）・合図の印 */
      if (entered) f.classList.add('mv-in');
      if (screen === 'result' && my && my.vote && my.vote.result && !my.vote.result.refunded && fxFor !== my.raceId) { fxFor = my.raceId; const k = [my.vote, my.vote2].concat(xs()).some((x) => x && x.bptBack !== true && x.result && x.result.win) ? 'win' : 'lose'; if ($('watchOv') || document.hidden) fxDue = k; else mv(k); }
      mvMark(f); } }
    if (screen === 'entry') {
      const i = $('nick');
      if (i) i.addEventListener('input', () => { if (Array.from(i.value).length > MAX_NICK) i.value = cutNick(i.value); draft.nick = i.value; const e = $('err'); if (e && e.textContent) e.textContent = ''; });
      if (i) i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); i.blur(); act('toPick'); } }); // 変換を確定する Enter では進まない
    }
    if (/^(entry|wait)$/.test(screen) && introDue() && !$('injs')) setTimeout(() => { if ($('injs')) return; document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'intro.css' + TKQ })); document.head.appendChild(Object.assign(document.createElement('script'), { id: 'injs', src: 'intro.js' + TKQ, onload: () => window.BetIntro && BetIntro.show() })); }, 250); // 初めての人への説明（2026-11-08。intro.js）: 会計番号の画面か待ち画面が出たあとに読む（受付前に開いた初めての人にも出す）（最初の表示を遅らせない）
    if (/^(confirm|voted|race|result)$/.test(screen) && !$('tkjs')) document.head.appendChild(Object.assign(document.createElement('script'), { id: 'tkjs', src: 'ticket.js' + TKQ, onload: draw }));
    if (screen === 'result') { const s = $('slider'); if (s) bindSlider(s); }
    notice = screen === 'entry' ? notice : '';
    loadBB();
  }
  /* v2/bet-boat.js は、最新の状況が届いて待ち・投票済み・結果の画面が出たあとに 1 回だけ読む（最初の表示を遅らせない） */
  function loadBB() { if (!stLive || loadBB.on || !/^(wait|voted|result)$/.test(screen)) return; loadBB.on = 1; setTimeout(() => document.head.appendChild(Object.assign(document.createElement('script'), { src: 'bet-boat.js' + TKQ, onerror() { this.remove(); setTimeout(() => { loadBB.on = 0; }, 30000); } })), 300); }
  /* 枠に入らない文字（馬名・ニックネーム）: 「…」で切らずに、まず文字を小さく（data-fit の px まで）、それでも入らなければ 2 行にする（2026-10-23 見直し） */
  /* 2026-11-18 b220 オーナー「上に寄せすぎ。過度にやらない程度で」: ふだんは前の大きさ・余白。入らない画面だけ段階的に詰める（#app に .os-s → .os-xs）。
     「入らない」＝画面の中身がはみ出す、または中だけ動く欄（.fx）がはみ出す（もともと長い一覧＝人気順の 30 通り・2 枚の券 [data-long] は数えない） */
  function fitLevel() {
    const app = $('app'), m = $('main'); if (!app || !m || !m.firstElementChild) return;
    const over = () => m.scrollHeight > m.clientHeight || Array.prototype.some.call(m.querySelectorAll('.fx:not([data-long])'), (f) => f.scrollHeight > f.clientHeight + 1);
    const before = app.className; m.firstElementChild.style.removeProperty('gap'); // 前の大きさで足した間隔（spread）を外してから測る（2026-11-18: 小さい画面から広げたとき、狭い間隔のまま測って詰め足りなかった）
    app.classList.remove('os-t', 'os-s', 'os-xs', 'os-xx');
    const LV = ['os-t', 'os-s', 'os-xs', 'os-xx']; let i = 0; // os-xx: ボートの枠（bet-boat.js）の説明を省く段
    for (; i < LV.length; i++) { if (!over()) break; app.classList.add(LV[i]); } // 軽い順: 上の帯を 1 行 → 詰める → さらに詰める
    if (app.className !== before) fitText(m);
    spread(m);
    while (over() && i < LV.length) { m.firstElementChild.style.removeProperty('gap'); app.classList.add(LV[i++]); fitText(m); spread(m); } // 2026-11-18: 間隔を足したあと・字の大きさを直したあとにはみ出したら、もう 1 段詰める
    if (over()) m.firstElementChild.style.removeProperty('gap');
    markMore(m);
  }
  /* 2026-11-28 オーナー「文字被ってたり」: 中だけ動く欄（券・スタンプなど）が入りきらないと、次の券やカードが欄の下で途中まで見えて、ボタンや字に重なって見えた
     → 入りきらない欄に .more を付け、下の端をうすく消す（続きがあると分かる・切れて見えない）。いちばん下まで動かしたら消す */
  function markMore(m) {
    Array.prototype.forEach.call((m || document).querySelectorAll('.fx'), (f) => {
      const upd = () => { const more = f.scrollHeight > f.clientHeight + 2; f.classList.toggle('more', more); f.classList.toggle('end', more && f.scrollTop + f.clientHeight >= f.scrollHeight - 4); };
      upd(); if (!f.__mm) { f.__mm = 1; f.addEventListener('scroll', upd, { passive: true }); }
    });
  }
  /* 縦の間隔（b220 オーナー「画面の縦いっぱいに自然な間隔で」）: 余った高さの 7 割を、かたまりの間の間隔に足す（前の間隔の 3 倍・40px まで）。残りは上下に（中身は真ん中寄り・ボタンは下） */
  function spread(m) {
    const sc = m && m.firstElementChild; if (!sc || !sc.classList.contains('scr')) return;
    sc.style.removeProperty('gap');
    const kids = Array.prototype.filter.call(sc.children, (k) => { const cs = getComputedStyle(k); return cs.display !== 'none' && cs.position !== 'absolute'; });
    if (kids.length < 2) return;
    const base = parseFloat(getComputedStyle(sc).rowGap) || 0;
    const used = kids.reduce((a, k) => a + k.getBoundingClientRect().height, 0) + base * (kids.length - 1);
    const free = sc.clientHeight - used; if (free <= 4) return;
    sc.style.gap = Math.min(base + (free * 0.7) / (kids.length - 1), Math.max(base * 3, 40)).toFixed(1) + 'px';
  }
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
  window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => { fitText($('main')); fitLevel(); }, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fitText($('main')); fitLevel(); }); // 文字（Noto Sans JP）が届いたら測り直す
  /* 文字（Noto Sans JP。2026-10-28）: 画面を止めないように、最初の中身が届いたあとで読む（それまでは端末の日本語の文字）。前に読めた端末は bet.html がすぐ読む（キャッシュ） */
  function loadFont() {
    if ($('webfont')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.id = 'webfont'; l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap';
    l.onload = () => { const done = () => { try { localStorage.setItem('casa.derby.font', '1'); } catch (e) { /* noop */ } fitText($('main')); fitLevel(); }; if (document.fonts && document.fonts.ready) document.fonts.ready.then(done); else done(); };
    document.head.appendChild(l);
  }
  /* 会計番号の 2 つの枠: 1 けただけなら右の枠に入れて左は薄い 0（07 の 7 と同じに見える） */
  function digitsHtml(b) { return b.length === 2 ? '<span class="dg">' + esc(b[0]) + '</span><span class="dg">' + esc(b[1]) + '</span>' : b.length === 1 ? '<span class="dg ph">0</span><span class="dg">' + esc(b) + '</span>' : '<span class="dg"></span><span class="dg"></span>'; }
  function drawDigits(pop) { const d = $('digits'); if (!d) return draw(); const b = draft.bill || ''; d.innerHTML = digitsHtml(b); d.classList.toggle('empty', !b); d.setAttribute('aria-label', '会計番号 ' + b); if (pop && b && d.lastElementChild) d.lastElementChild.classList.add('mv-pp'); /* 動き: 押した数字がはずむ */ }

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
    const m = my; // 返事を待つ間に、見ている票が替わることがある（受け取っていない別のレースの当たりへ移る）: 返事はスライドした票（m）にだけ入れる（2026-11-23。前は替わったあとの票に入れていた）
    try {
      // 当たった票の、まだ受け取っていない当たりを全部（初参加ボーナスで 2 票とも当たりなら 2 つ。1 回のスライドで）
      const todo = [m.vote, m.vote2].concat(m.extra || []).filter((x) => x && x.result && x.result.win && x.result.payout && x.result.payout.status === 'unpaid'); // 追加の券の当たりも（2026-11-18）
      for (const x of todo) { const d = await C.claimSelf(x.vid, m.key); if (d && d.vote) { if (d.vote.bpt) m.extra = (m.extra || []).map((y) => (y.vid === d.vote.vid ? d.vote : y)); else if (d.vote.n === 2) m.vote2 = d.vote; else m.vote = d.vote; } }
      busy = false; unpaidList = unpaidList.filter((x) => x.vid !== m.vid); draw();
    } catch (e) {
      busy = false;
      if (['already_paid', 'expired', 'void', 'test_race', 'no_win', 'not_revealed'].indexOf(e && e.code) >= 0) { await loadMine(true); return draw(); }
      draw(); const er = $('err'); if (er) er.textContent = e && e.status ? ((e.body && e.body.message) || TX.retry) : TX.claimNet;
    }
  }

  /* 受け取っていない当たり（テストは除く）。2026-11-17 オーナー「当たり受け取りまで、その端末が QR を開いたときは常に当たり受け取りの画面に。絶対に閉じないように」 */
  const unpaidOf = (m) => !!(m && [m.vote, m.vote2].some((x) => x && x.result && x.result.win && !x.result.test && !x.result.refunded && x.result.payout && x.result.payout.status === 'unpaid'));
  /* もう受け取るものが無い票（結果が出て、当たりは受け取り済み・期限切れ・テスト・取り消し。2 票目・追加の券も見る）。受け取り済みは元に戻らないので、手元の票がこうなったら
     探した一覧（unpaidList）の古い行を消し、読み直さない印（scanDone）を付ける。
     2026-11-23 直した: 消していなかったので、受け取った直後の「次のレースへ」で古い行から同じ結果の画面に戻っていた（もう 1 回押すと進んだ）。
     起きていたのは、受け取りの返事より先に知らせが届いた瞬間・スタッフのスマホで渡した直後・当たりを探している最中にスライドしたとき */
  const doneOne = (x) => !!(x.result && (!x.result.win || x.result.test || x.result.refunded || (x.result.payout && x.result.payout.status !== 'unpaid')));
  function settle(m) { const a = m ? [m.vote, m.vote2].concat(m.extra || []).filter(Boolean) : []; if (!a.length || !a.every((x) => x.raceId === m.raceId && doneOne(x))) return false; scanDone.add(m.raceId); unpaidList = unpaidList.filter((x) => x.vid !== m.vid); return true; } // x.raceId: そのレースの票だけで決める（守り）
  /* ================= 行き先を決める ================= */
  function focusOf() { // いま見せる自分の票（受け取っていない当たり → レース中 → 投票中 → 発表のあと）
    if (!st || !MV) return null;
    // 受け取っていない当たりがある間は、ほかの画面（次のレースの投票・待ち）へ行かない。今の当たりの画面をそのまま、無ければ見つけた当たりを開く
    if (my && unpaidOf(my)) return { kind: my.kind === 'pin' ? 'pin' : 'keep', raceId: my.raceId, vid: my.vid, key: my.key, race: my.race };
    if (settle(my) && my.kind === 'keep') pinned = { raceId: my.raceId, vid: my.vid, key: my.key, race: null }; // 受け取りの画面のまま受け取り済みになった票は、「次のレースへ」を押すまでそのまま（今までと同じ見え方）
    if (unpaidList.length) { const u = unpaidList[0]; pinned = { raceId: u.raceId, vid: u.vid, key: u.key, race: null }; dismissed.delete(u.raceId); return Object.assign({ kind: 'pin' }, pinned); }
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
      if (!my || my.vid !== f.vid) { my = { raceId: f.raceId, vid: f.vid, key: f.key, vote: null, vote2: null, bonus: false, stamp: null, race: f.race || null, kind: f.kind }; loadMine(); resubscribe(); }
      else { my.kind = f.kind; if (f.race) my.race = Object.assign({}, my.race || {}, f.race, { result: (my.race && my.race.result) || f.race.result || null }); }
      if (f.kind === 'cur' && draft && (draft.redo || draft.n === 2 || draft.x) && draft.raceId === f.raceId && ['pick', 'confirm'].indexOf(screen) >= 0) return drawTop(); // 選び直し・2 票目をえらんでいる途中
      const want = f.kind === 'cur' ? 'voted' : f.kind === 'live' ? 'race' : (my.vote && my.vote.result) || (my.race && my.race.status === 'done') ? 'result' : 'race';
      if (screen === want && sigOf() === lastSig) return drawTop();
      go(want); lastSig = sigOf(); return;
    }
    if (my) { my = null; resubscribe(); }
    const c = st.current, sg = c ? stageOf(c) : null;
    if (sg === 'vote') {
      if (draft && draft.raceId === c.id && ['entry', 'pick', 'confirm'].indexOf(screen) >= 0) return drawTop();
      if (draft && draft.raceId && draft.raceId !== c.id && ['pick', 'confirm'].indexOf(screen) >= 0) toast(TX.closed, true, 4000);
      { const sn = savedNick(), keep = draft && draft.raceId === c.id; draft = { raceId: c.id, bill: (keep && draft.bill) || '', nick: (keep && draft.nick) || sn, nickFixed: keep ? !!draft.nickFixed : !!sn, first: null, second: null, redo: false, err: null }; }
      return go('entry');
    }
    if (draft && ['entry', 'pick', 'confirm'].indexOf(screen) >= 0) toast(TX.closed, true, 4000);
    draft = null;
    if (screen === 'wait' && sigOf() === lastSig) return drawTop();
    go('wait'); lastSig = sigOf();
  }
  let lastSig = '';
  function sigOf() { const v = my && my.vote, v2 = my && my.vote2, r = my && my.race, p = v && v.result && v.result.payout, p2 = v2 && v2.result && v2.result.payout; return [my && my.vid, my && my.lost ? 'lost' : '', v && v.combo, v && v.updatedAt, v2 && v2.combo, v2 && v2.updatedAt, my && my.bonus, my && my.stamp ? my.stamp.can + ':' + my.stamp.bal : '', xs().map((x) => x.combo + (x.result ? (x.result.win ? 'w' : 'l') + (x.result.payout ? x.result.payout.status : '') : '')).join(), my && my.bpt ? my.bpt.left + ':' + my.bpt.bal : '', stampSt ? stampSt.bal : '', r && r.status, v && v.result && v.result.combo, p && p.status, p2 && p2.status, (st && st.current && st.current.id) || '', (st && st.watch && st.watch.id) || '' /* 他店だけのレースが始まった・終わった（2026-10-26） */, unpaidList.length,
    st && Array.isArray(st.today) ? st.today.map((x) => x.at).join() + '|' + st.today.filter((x) => x.at <= now()).length : '' /* 本日のレースの時刻が変わった・済みが増えた（2026-10-27。時刻表を直したときも待ち画面を描き直す） */].join('|'); }

  /* 自分の票を読む（myVote → { vote, vote2, bonus, race }）。無い（番号を空けられた・ほかのスマホ）なら覚えを消す */
  let loading = null;
  function loadMine(force) {
    if (!my) return Promise.resolve();
    if (loading && !force) return loading;
    const m = my;
    loading = C.myVote(m.vid, m.key).then((d) => {
      if (my !== m) return;
      my.vote = d.vote; my.vote2 = d.vote2 || null; my.bonus = !!d.bonus; my.stamp = d.stamp || null; my.extra = d.extra || []; my.bpt = d.bpt || null; if (d.race) my.race = d.race; online = up(); route();
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
    if (c && c.id === m.raceId && stageOf(c) === 'vote') { notice = TX.released; draft = { raceId: c.id, bill: old ? String(old.bill || '') : '', nick: (old && old.nick) || savedNick(), nickFixed: !!((old && old.nick) || savedNick()), first: null, second: null, redo: false, err: null }; return go('entry'); }
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
        const d = await C.myVote(m.vid, m.key), all = [d.vote, d.vote2].concat(d.extra || []).filter(Boolean); // 初参加ボーナスの 2 票目・追加の券（2026-11-18）の当たりも足す
        const un = all.filter((x) => x.result && x.result.win && !x.result.test && x.result.payout && x.result.payout.status === 'unpaid');
        if (un.length) out.push({ raceId, vid: m.vid, key: m.key, bill: d.vote.bill, amount: un.reduce((a, x) => a + (Number(x.result.amount) || 0), 0), at: d.race && d.race.at });
        else if (all.length && all.every(doneOne)) scanDone.add(raceId);
      } catch (e) { if (e && (e.status === 404 || e.code === 'no_vote')) { MV.clear(raceId); scanDone.add(raceId); } }
    }
    const before = unpaidList.map((x) => x.vid).join(); unpaidList = out.filter((x) => !scanDone.has(x.raceId)).sort((a, b) => (b.at || 0) - (a.at || 0)); // 探している間に受け取り済みになった票（settle が印を付けた）は入れない
    if (before !== unpaidList.map((x) => x.vid).join() && unpaidList.length && !unpaidOf(my)) { lastSig = ''; route(); } // 受け取っていない当たりを見つけた → その画面へ（2026-11-17）
    else if (before !== unpaidList.map((x) => x.vid).join() && ['wait', 'entry'].indexOf(screen) >= 0) { if (screen === 'entry') { const nk = $('nick'); if (nk) draft.nick = nk.value; } draw(); }
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
    if (a === 'editNick') { if (!draft) return; draft.nickFixed = false; draw(); const i = $('nick'); if (i) { i.focus(); try { i.select(); } catch (e) { /* noop */ } } return; }
    if (a === 'toEntry') { draft.err = null; return go('entry'); }
    if (a === 'toPick2') { draft.err = null; if (draft.multi) { draft.multi = false; draft.first = draft.second = null; } return go('pick'); } // まとめて確認から戻る: 並べた組み合わせはそのまま・えらび途中は空に
    if (a === 'cancelRedo') { draft = null; return route(); }
    /* ③ 予想（2026-11-05 出馬表の行で 1着・2着）: p1 ＝ 1 着（同じ馬が 2 着なら 2 着は外す）・p2 ＝ 2 着・pv ＝ 馬を選ぶ／人気順・toConfirm ＝ 確認へ */
    if (a === 'p1' || a === 'p2' || a === 'pv' || a === 'toConfirm') {
      if (!draft) return;
      if (a === 'pv') { draft.pv = el.dataset.v === 'pop' ? 'pop' : 'horse'; return draw(); }
      if (a === 'toConfirm') { if (!cartFix(draft) && (draft.first == null || draft.second == null)) return; shownAt = performance.now(); return go('confirm'); }
      const i = Number(el.dataset.i); if (!Number.isInteger(i)) return;
      if (a === 'p1') { draft.first = i; if (draft.second === i) draft.second = null; }
      else { if (draft.first == null || draft.first === i) return; draft.second = i; }
      draft.err = null; draft.sendLabel = draft.sendMsg = ''; draft.sendDis = false; draft.waitResend = false;
      mv(a); if (draft.first != null && draft.second != null) mv('set'); // 動き: 押した・そろった
      return draw();
    }
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
    if (a === 'stamp') { // スタンプラリー: スタンプで 2 票目をえらぶ（同じ組み合わせでもよい。2026-11-02）
      const v = my && my.vote; if (!v || my.vote2 || !(my.stamp && my.stamp.can)) return;
      draft = { raceId: my.raceId, bill: v.bill, nick: v.nick, first: null, second: null, redo: false, n: 2, stamp: true, err: null };
      return go('pick');
    }
    if (a === 'bonus') { // 初参加ボーナス: 2 票目をえらぶ（同じ組み合わせでもよい）
      const v = my && my.vote; if (!v || my.vote2 || !my.bonus) return;
      draft = { raceId: my.raceId, bill: v.bill, nick: v.nick, first: null, second: null, redo: false, n: 2, err: null };
      return go('pick');
    }
    if (a === 'bptAdd') { // BPT の追加の券をえらぶ（2026-11-18。同じ組み合わせでもよい）
      const v = my && my.vote; if (!v || !(my.bpt && my.bpt.left > 0)) return;
      draft = { raceId: my.raceId, bill: v.bill, nick: v.nick, first: null, second: null, redo: false, x: true, xn: 1, err: null };
      return go('pick');
    }
    if (a === 'cartAdd') { // 2026-11-24 えらんだ組み合わせを下に並べて、次をえらぶ（1 つ目は無料・2 つ目から 1票 100 BPT）
      const d = draft, r = st && st.current; if (!d || d.first == null || d.second == null || !cartOn(d, r) || cartL(d).length >= bptLeftFor(d, r)) return;
      d.cart = cartL(d).concat({ first: d.first, second: d.second }); d.first = d.second = null; d.bptN = 0; mv('add', d.cart.length - 1); return draw();
    }
    if (a === 'cartDel') { // 並べた組み合わせを取り消す（予想の画面・まとめて確認）
      const d = draft, i = Number(el.dataset.i); if (!d || d.sendDis || !Number.isInteger(i) || !cartL(d)[i]) return;
      d.cart = cartL(d).filter((_, j) => j !== i);
      if (d.multi) { if (d.cart.length === 1) { d.first = d.cart[0].first; d.second = d.cart[0].second; d.cart = []; d.multi = false; } else if (!d.cart.length) { d.multi = false; d.first = d.second = null; return go('pick'); } else { d.first = d.cart[0].first; d.second = d.cart[0].second; } }
      return draw();
    }
    if (a === 'bptInc' || a === 'bptDec') { if (!draft) return; const f = draft.x ? 'xn' : 'bptN'; draft[f] = Math.max(0, (draft[f] || (draft.x ? 1 : 0)) + (a === 'bptInc' ? 1 : -1)); mv('qty'); return draw(); }
    if (a === 'vote' && draft && draft.x) { const d = draft; return addExtra(d, true); }
    if (a === 'vote') {
      if (!draft) return;
      return submitVote(draft); // 同じ予想を送っている途中なら何もしない（submitVote の中）
    }
    if (a === 'reload') { try { location.reload(); } catch (e) { /* noop */ } return; }
    if (a === 'watch') return openWatch(); // レースを見る（2026-10-29）
    if (a === 'dismiss') { if (unpaidOf(my)) return; if (my) { settle(my); dismissed.add(my.raceId); } if (pinned && my && pinned.vid === my.vid) pinned = null; my = null; resubscribe(); lastSig = ''; route(); return scanUnpaid(); }
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
  const argsOf = (d) => ({ raceId: d.raceId, bill: d.bill, nick: d.nick, first: d.first, second: d.second, n: d.n === 2 ? 2 : undefined, stamp: d.n === 2 && d.stamp ? true : undefined });
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
    if (b) { b.textContent = label || voteLabel(d); b.disabled = !!dis; }
    if (d.multi) document.querySelectorAll('.cartc .cx, .cartc [data-act=toPick2]').forEach((x) => { x.disabled = !!dis; }); // まとめて確認: 送っている途中は取り消し・戻るも押せない
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
      if (v && v.first === A.first && v.second === A.second && v.nick === A.nick) return { vote: x.vote, vote2: x.vote2 || null, bonus: !!x.bonus, stamp: x.stamp || null, extra: x.extra || [], bpt: x.bpt || null, key: key === 'uid' ? 'uid' : key, race: x.race || null };
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
  /* BPT の追加の券を送る（2026-11-18）。BPT を使うので自動では送り直さない（届いたか分からないときは自分の票を読み直して確かめる） */
  async function addExtra(d, fromConfirm) {
    if (!my || !my.vote || d.busyX) return; d.busyX = true; const list = d.list || [{ first: d.first, second: d.second, xn: d.xn }], want = list.reduce((a, g) => a + g.xn, 0), before = xs().length, v = my.vote, m = my; // d.list: 組み合わせごとにまとめて足す（2026-11-24 まとめて投票）
    if (fromConfirm) setSend(d, null, TX.bptAdding, '', true); else toast(TX.bptAdding, false, 3000);
    let okN = 0;
    try { for (const g of list) { const r = await C.vote({ raceId: m.raceId, bill: v.bill, nick: v.nick, first: g.first, second: g.second, extra: g.xn, key: m.key }); if (my === m && r && r.vote) { my.vote = r.vote; my.vote2 = r.vote2 || null; my.extra = r.extra || []; my.bpt = r.bpt || null; } okN += g.xn; } }
    catch (e) {
      /* 2026-11-20（不具合一覧 B の疑い）: 届いたか分からないとき（通信の失敗）に加えて、2 枚以上を足す途中で断られたとき（本番は 1 枚ずつ書くので、締切をまたぐと先の分だけ入っている）も、
         自分の票を読み直して、増えた枚数を数える（以前は「追加できませんでした」と出て、入った券と使った BPT が分からなかった）。1 枚だけ断られたときは何も入っていないので読まない */
      if (my === m && (!e || !e.status || want > 1)) { await loadMine(true); if (my === m) okN = Math.max(0, Math.min(want, xs().length - before)); }
    }
    d.busyX = false; bptAt = 0; lastSig = '';
    if (draft === d) draft = null;
    toast(okN >= want ? fill(TX.bptDone, { n: okN }) : okN ? fill(TX.bptPart, { n: okN, m: want - okN }) : TX.bptNo, !okN, 4000);
    route();
  }
  function voted(d, r, I) {
    /* 届いた。けれど、その間に「戻る」で選び直している（予想の表・ちがう予想の確認）なら画面はそのまま（票は覚える。続きは選び直しとして送る）。2026-10-28 */
    const rechoosing = draft === d && I && (screen === 'pick' || (screen === 'confirm' && !sameArgs(argsOf(d), I.args)));
    busy = false; notice = ''; if (d && d.nick) saveNick(d.nick); if (!rechoosing && draft === d) draft = null;
    const raceId = r.vote.raceId; if (MV && !MV.get(raceId)) MV.set(raceId, r.vote.vid, r.key);
    my = { raceId, vid: r.vote.vid, key: r.key, vote: r.vote, vote2: r.vote2 || null, bonus: !!r.bonus, stamp: r.stamp || null, extra: r.extra || [], bpt: r.bpt || null, race: r.race || (st && st.current) || null, kind: 'cur' }; resubscribe();
    online = up(); lastSig = '';
    if (rechoosing) { d.multi = false; d.cart = []; d.redo = true; d.done = false; d.sendLabel = d.sendMsg = ''; d.sendDis = false; return drawTop(); }
    mv('print'); // 動き: 券が刷られて出る
    route();
    if (d && d.multi && cartL(d).length > 1) { const g = []; cartL(d).slice(1).forEach((x) => { const y = g.find((z) => z.first === x.first && z.second === x.second); if (y) y.xn++; else g.push({ first: x.first, second: x.second, xn: 1 }); }); addExtra({ list: g }); } // 2026-11-24 まとめて投票: 1 つ目（無料）が入ってから、残りを BPT の票で（今ある「追加の票」の窓口）
    else if (d && d.bptN > 0) addExtra({ first: d.first, second: d.second, xn: d.bptN }); // 確認の画面で BPT の券も足していた（2026-11-18）: 1 票目が入ってから足す
    loadStamps(); // スタンプラリー: 投票した・スタンプで 2 票目を入れた
    autoWatch(); // 投票できたら、自動で「レースを見る」（このレースで初めてのときだけ）
    if ($('watchOv')) fxDue = 'print'; // 動き: 窓が上に開いた → 券が刷られる動きは、窓を閉じて戻ったときに
  }
  async function voteFailed(d, e) { // 送り直しても変わらない答え（今までと同じ動き）
    const code = e && e.code;
    if (code === 'no_stamp') { toast(TX.noStamp, true, 5000); draft = null; if (my) my.stamp = null; lastSig = ''; loadStamps(); loadMine(true); return route(); } // スタンプが足りない・使えないレース（2026-11-02）
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
    drawDigits(/^\d$/.test(k));
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act],[data-key],.cell');
    if (!b || b.disabled) return;
    if (b.dataset.key) { e.preventDefault(); return key(b.dataset.key); }
    if (b.classList.contains('cell')) { if (!draft) return; draft.first = Number(b.dataset.a); draft.second = Number(b.dataset.b); draft.err = null; draft.sendLabel = draft.sendMsg = ''; draft.sendDis = false; draft.waitResend = false; /* 選び直した: 前の送信の知らせは消す（前の送信の返事は使わない＝submitVote） */ if (cartOn(draft, st && st.current)) { mv('p2'); mv('set'); return draw(); } /* 2026-11-24 BPT で複数えらべる人は、えらぶだけ（下の帯で「もう1つ」か「確認へ」） */ shownAt = performance.now(); return go('confirm'); }
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
        if (d.vote && d.vote.vid === my.vid) { my.vote = d.vote; my.vote2 = d.vote2 || null; my.bonus = !!d.bonus; my.stamp = d.stamp || null; my.extra = d.extra || []; my.bpt = d.bpt || null; if (d.vote.result && my.race && my.race.status !== 'done') loadMine(true); else route(); if (d.vote.result) setTimeout(scanUnpaid, 500); return; }
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
    loadFont(); loadBB();
  }
  window.addEventListener('online', () => {
    refreshState(); loadMine(true);
    flushResend(true); // 送れなかった投票: 電波が戻ったら自動で送る（待っている送信も起こす）
  });
  window.addEventListener('offline', () => { online = false; drawTop(); });
  /* 画面に戻ったとき（2026-10-28）: 裏ではタイマーが止まることがあるので、すぐ時刻・状況・自分の票（ほかのタブ・2 回読んだ QR で変えた予想もここで出る）を読み直し、送れていない投票を送る */
  document.addEventListener('visibilitychange', () => { if (!document.hidden && C) { if (fxDue && !$('watchOv')) { if (screen === (fxDue === 'print' ? 'voted' : 'result')) { mv(fxDue); draw(); } fxDue = ''; } /* 動き: 画面を消している間に結果が出ていたら、戻ったときに当たり／はずれの動き */ C.syncClock().catch(() => {}); refreshState(); loadMine(true); flushResend(true); } });

  // 1 秒ごと: 残りの数字。投票の始まり・締切・発表の時刻をまたいだら行き先を決め直す
  let lastPh = '', lastPrep = ''; // lastPrep: 準備中の印（待ちの画面は 6 秒ごとにも読み直す＝下の見回り）
  setInterval(() => {
    if (!C) return;
    const n = now();
    document.querySelectorAll('[data-cd]').forEach((x) => { const t = mmss(Number(x.dataset.cd) - n); if (x.textContent !== t) x.textContent = t; beat(x, Number(x.dataset.cd) - n); });
    const c = st && st.current, r = my && my.race;
    const ph = [c && c.id, c && stageOf(c), r && r.id, r && n >= r.closeAt, r && r.revealAt && n >= r.revealAt].join('|');
    if (ph !== lastPh) { const first = !lastPh; lastPh = ph; if (!first) { refreshState(); if (my) loadMine(true); } }
    if (screen === 'wait') { const pk = prepKey(); if (pk !== lastPrep) { const was = lastPrep; lastPrep = pk; draw(); if (pk && !was) refreshState(); } } // 準備中に入った・3 分たった・レースが届いた（2026-10-28）
    drawTop();
    { const w = watchOk(); if (w !== lastWok) { lastWok = w; if (!w && $('watchOv')) closeWatch(false); else { lastSig = ''; route(); } } } // 観戦の休止・再開（2026-11-25）
  }, 1000);
  // 通知が届かない環境の保険
  /* 2026-11-14 Firestore の無料枠（読み取り 1 日 5 万回）を超えて 14:10 からレースが作れなくなった: 保険の読み直しを 6 秒 → 30 秒に（票・状態は見張りで届く）。送れなかった投票の送り直しは 6 秒のまま */
  let insN = 0;
  setInterval(() => {
    if (document.hidden || !C || screen === 'badStore') return;
    const slow = (insN++ % 5) === 0; // 30 秒に 1 回
    /* 読み取りの枠（2026-11-25）: 保険の読み直しは utk（節約 ＝ 4 倍あける・最低限と端末の上限 ＝ しない。票・状態は見張りで届く）。送れなかった投票の送り直しは止めない */
    if (slow && my && ['voted', 'race', 'result'].indexOf(screen) >= 0 && !(my.vote && my.vote.result && [my.vote, my.vote2].every((x) => !x || !x.result || !x.result.win || (x.result.payout && x.result.payout.status !== 'unpaid'))) && utk('bet.mine', 25000)) loadMine();
    if (slow && (!online || ['wait', 'boot'].indexOf(screen) >= 0) && utk('bet.state', 25000)) refreshState();
    if (Date.now() - scanAt > 300000 && utk('bet.scan', 290000)) scanUnpaid();
    flushResend(false); // 送れなかった投票は 15 秒ごとにも（Wi-Fi はつながっているのに外へ出られないとき）
  }, 6000);

  window.BET = { get screen() { return screen; }, get st() { return st; }, get my() { return my; }, get stamps() { return stampSt; }, loadStamps, /* スタンプラリー（確認・説明のページ用） */ get draft() { return draft; }, set draft(d) { draft = d; } /* テスト用（投票できないレースへ送る） */, get unpaid() { return unpaidList; }, prepKey, C, TX, payFor, oddsTxt, route, scanUnpaid, act, hhmm, canVote, openWatch, closeWatch, draw, mv /* 確かめ用（動きの合図を出す） */, fitLevel, stampFx: (S) => stampFx(S || stampSt) /* 1 画面の確かめ（tests/onescreen-phone.plan.js）で描き直す・演出を出す */ };

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
    loadStamps(); // スタンプラリー（2026-11-02）
  }
  boot();
})();
