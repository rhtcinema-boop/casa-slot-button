/* casa DERBY v2 お客さんのスマホ（bet.html?store=<id>）。API は v2/API.md、通信は v2/client.js（DerbyCloud）だけを使う。
   流れ: 会計番号 → ニックネーム → チップ（＋100/＋1,000/＋10,000。下に小さく「リングバウンティ 600」）→ 認証 QR（スタッフ待ち）
   casa DERBY CHIPS（2026-10-17 オーナー「リングバウンティ20枚で casa DERBY 100チップ入る感じ」）: 中の単位（券の count・割り振り）は今までの「枚」のまま、
   見せるのはチップ＝枚 × 100（数字だけ・単位の字は付けない）。ボタンは 100 刻み（＋100＝1 枚）。当たったら = チップ × オッズ（今までの額と同じ数）
        → 投票（単勝・複数の馬に割り振り・合計ちょうど）→ 確認 → 確定（取り消し不可）→ レース待ち → 結果（当たりなら受け取り QR）→ 次のレースへ
   受付は 2 段（2026-10-16）: 参加受付（番号・名前・枚数 → スタッフの認証）は exchangeCloseAt まで、投票は締切（closeAt）まで。
   認証した券はそのレースにだけ投票できる。投票しないまま締切を過ぎた券は「返却」（認証した枚数を返す QR が出る）。
   保存: localStorage にその場のセッションだけ（会計番号・ニックネーム・いまの投票券・未受け取りの当たり）。営業日が変わったら消す。
   音: 鳴らさない（スマホは無音）。テスト用に window.BET を出す。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = new URLSearchParams(location.search);
  const STORE = (qs.get('store') || '').trim().toLowerCase(); // 店舗 ID は英小文字だけ（手で打った大文字も通す）
  const KEY = 'casa.derby.bet.v3';
  const MAX_NICK = 8, MAX_COUNT = 9999, RESET_HOUR = 5;
  const FRAME = ['#f4f4f4', '#1a1a1e', '#d6332b', '#2459c9', '#f2c531', '#2a9a4a'];
  const INK = ['#111', '#fff', '#fff', '#fff', '#111', '#fff'];
  const TYPES = { nige: ['逃げ', '#ff8a65'], senko: ['先行', '#ffd54f'], sashi: ['差し', '#81d4fa'], oikomi: ['追込', '#ce93d8'] };
  const C = window.DerbyCloud && STORE ? window.DerbyCloud.create({ store: STORE, role: 'phone' }) : null;
  const now = () => (C ? C.serverNow() : Date.now());

  /* ================= セッション（その場だけ） ================= */
  const pad = (n) => ('0' + n).slice(-2);
  const JST = (ms) => new Date(ms + 9 * 3600e3); // 時刻はいつも日本時間で出す（海外の時間帯のままのスマホでも、テレビと同じ時刻）
  function dayKey(ms) { const h = st && st.settings && st.settings.dayStartHour != null ? Number(st.settings.dayStartHour) : RESET_HOUR, d = JST(ms - h * 3600e3); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()); }
  // { v, store, day, bill, nick, count, tid, key, authCode, alloc:{馬の添字:枚数}, allocRace, unpaid:[{ tid, key, code, amount, at }] }
  let S = null;
  const fresh = () => ({ v: 3, store: STORE, day: null, bill: '', nick: '', count: 0, tid: null, key: null, authCode: null, alloc: {}, allocRace: null, unpaid: [] });
  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* noop */ } }
  function dropTicket() { S.tid = null; S.key = null; S.authCode = null; S.alloc = {}; S.allocRace = null; tk = null; sel = null; }

  /* ================= 状態 ================= */
  const up = () => navigator.onLine !== false; // 端末がオフラインと言っている間は「つながっている」にしない
  let screen = 'boot', st = null, tk = null, online = true, sel = null, busy = false, unsub = null, backTo = null;
  window.BET = { get S() { return S; }, get screen() { return screen; }, get tk() { return tk; }, get st() { return st; }, C, reset() { try { localStorage.removeItem(KEY); } catch (e) { /* noop */ } }, payEst: (n, o) => payEst(n, o), oddsTxt: (o) => oddsTxt(o), ifRange: (rows) => ifRange(rows) };

  const hhmm = (ms) => { const d = JST(ms); return d.getUTCHours() + ':' + pad(d.getUTCMinutes()); };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return (s >= 3600 ? Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ':' + pad(s % 60); };
  const raceLabel = (r) => (r ? hhmm(r.at) + ' のレース' : '');
  const openRace = () => (st && st.open && st.open.status === 'open' ? st.open : null);
  const xAt = (r) => (r ? (r.exchangeCloseAt != null ? r.exchangeCloseAt : r.closeAt) : 0); // 参加受付の締切（なければ 1 段＝締切）
  const xClosed = () => { const o = openRace(); return !!o && now() >= xAt(o); }; // いまのレースの参加受付が締め切られた（投票の段）
  // 認証した券が投票できるレース（認証したレースが受付中のときだけ）
  const voteRace = () => { const o = openRace(), a = tk && tk.ticket && tk.ticket.authRaceId; return o && (!a || a === o.id) ? o : null; };
  // 参加受付の締切のあと: 次のレースの案内（次のレースの受付はこのレースの締切のあとに始まる）
  /* とことんシンプルに（2026-10-17 オーナー「細かい説明がいらない」）: 締切などの案内は 1 行（＋次のレースの時刻）だけ */
  function nextRace() { /* 次のレース: st.next、なければ時刻表の予定（いまのレースより後で、まだ来ていないもの） */
    if (!st) return null; if (st.next) return st.next;
    const o = openRace(), t = Math.max(now(), o ? o.at : 0);
    return (st.upcoming || []).filter((x) => x && x.at > t).sort((x, y) => x.at - y.at)[0] || null;
  }
  const nextAt = () => { const nx = nextRace(); return nx ? '<span>次のレース ' + hhmm(nx.at) + '</span>' : ''; };
  function nextInfo() { const nx = st && st.next; return nx ? '次のレース ' + hhmm(nx.at) : ''; }
  const closedNote = () => '<div class="note red xclosed" role="status"><b>受付は締め切りました</b>' + nextAt() + '</div>';
  const tkRace = () => (tk && tk.race) || null;
  function chipRace() {
    if (screen === 'wait' || screen === 'result') return tkRace();
    return openRace() || (st && st.next) || null;
  }
  function horsesOf(r) {
    if (!r || !r.horses) return [];
    const fo = r.result && r.result.finalOdds;
    return r.horses.map((h, i) => {
      const t = TYPES[h.type] || ['', '#999'];
      return { i, no: h.no || i + 1, name: h.name, typeLabel: t[0], typeColor: t[1], color: h.color || FRAME[i], ink: h.ink || INK[i], odds: Number((r.odds || [])[i]) || 0, finalOdds: fo ? Number(fo[i]) : null };
    });
  }
  const horse = (r, i) => horsesOf(r)[Number(i)] || null;
  /* 払い戻しは「額」で見せる（2026-10-16 オーナー決定。1 枚 = 100・単位なし・3 桁ごとのカンマ）。投票は枚のまま。
     オッズは倍率（2026-10-19 オーナー「オッズ表記は倍率にしよう」。いつも小数 1 桁、例 2.4 倍。以前は 100あたりの額 240）。
     当選額 = 枚数 × オッズ × 100（outcome.js の stakePayout と同じ整数の計算）は今までどおり額で出す */
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const CHIP = 100, chips = (n) => amt((Number(n) || 0) * CHIP); // 中の枚数 → 見せるチップ（1 枚 = 100 チップ）
  const oddsTxt = (o) => (!o ? '—' : (Math.round(Number(o) * 10) / 10).toFixed(1)); // 倍率の数字（小数 1 桁。「倍」は横に小さく）
  /* 出馬表と同じ「脚質」と「近 3 走」（2026-10-19。v2/form.js。テレビと同じ値＝馬名＋営業日の種）。スマホでは馬名の下に小さく */
  const FORM = window.DerbyForm || null;
  const formLine = (r, h) => { const raw = r && r.horses && r.horses[h.i]; if (!raw) return ''; const fm = FORM ? FORM.formOf(raw, r.at, st && st.settings && st.settings.dayStartHour, r.horses.length) : null;
    return '<div class="hsub">' + (h.typeLabel ? '<i style="background:' + h.typeColor + '">' + esc(h.typeLabel) + '</i>' : '') + (fm ? '<span>近走 ' + fm.recent.join('-') + '</span>' : '') + '</div>'; };
  // 当たったときの当選額の目安。サーバー（outcome.js の stakePayout）と同じく整数で計算する
  // （Math.floor(45 * 1.4) は 62.999… → 62 枚になり、実際の 63 枚より 1 枚少なく出ていた。コードレビュー 2026-10-14）
  /* 交換の割合（2026-10-17「リングバウンティ20枚につき投票権1枚」）: 投票券 1 枚 = リングバウンティ ○枚（店舗の設定 state.settings.bountyPerTicket。なければ 20）。
     認証した券は券に残した割合（ticket.bounty）。返却・返還はリングバウンティで返す（res.bounty）。当選額（1 枚 = 100）とは混ぜない */
  const rate = () => { const r = st && st.settings && Number(st.settings.bountyPerTicket); return Number.isInteger(r) && r >= 1 ? r : 20; };
  const bountyOf = (n) => { const t = tk && tk.ticket; return t && t.bounty != null && t.count === n ? t.bounty : (n | 0) * rate(); };
  const rbTxt = (n) => 'リングバウンティ ' + amt(n);
  // 交換の割合（2026-10-19 オーナー「Bounty X 枚で 100 と交換できる感じ。説明のどこかに明記」）: 参加画面（チップ）の見出しの下に「リングバウンティ 20枚 → 100」
  const rateTxt = () => 'リングバウンティ <b>' + amt(rate()) + '枚</b> → <b>100</b>';
  const has = (res) => !!res && ((res.amount | 0) > 0 || (res.bounty | 0) > 0); // 渡す・返すものがある（当選額か、返却・返還のリングバウンティ）
  const isRb = (x) => !!x && (x.novote || x.refund || (x.payout && x.payout.kind === 'refund') || ((x.bounty | 0) > 0 && !((x.amount | 0) > 0)));
  const rbOf = (x) => (x.bounty != null ? x.bounty | 0 : Math.round((x.amount | 0) / 100)); // 以前のスマホに覚えた返却・返還（額 = 枚数 × 100）は 1 対 1
  const valTxt = (x) => (isRb(x) ? rbTxt(rbOf(x)) : amt(x.amount)); // 未受け取りの一覧・お知らせ
  const payEst = (n, o) => Math.floor(n) * Math.round(Number(o) * 10) * 10; // 当選額（額。整数）
  const sumAlloc = () => Object.keys(S.alloc || {}).reduce((a, k) => a + (S.alloc[k] | 0), 0);
  const picksOf = () => { const t = tk && tk.ticket; if (t && t.picks && t.picks.length) return t.picks; return Object.keys(S.alloc || {}).filter((k) => S.alloc[k] > 0).map((k) => ({ horse: Number(k), count: S.alloc[k] })); };

  // ニックネームの言葉の規制はしない（オーナー決定 2026-10-14。使っていなかった禁止語の一覧は消した）。8 文字までだけ
  const badNick = () => false; // オーナー決定（2026-10-14）: ニックネームの言葉の規制は入れない（NG 一覧は使わない）
  // 8 文字（コードポイント＝サーバーと同じ数え方）まで。絵文字の途中（👨‍👩‍👧 など）では切らない
  function cutNick(s) {
    if (Array.from(s).length <= MAX_NICK) return s;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) { let out = '', n = 0; for (const g of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s)) { const c = Array.from(g.segment).length; if (n + c > MAX_NICK) break; out += g.segment; n += c; } return out; }
    return Array.from(s).slice(0, MAX_NICK).join('');
  }
  const cleanNick = (s) => cutNick(String(s || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim());
  const cleanBill = (s) => String(s || '').normalize('NFKC').replace(/[\s　]/g, '').replace(/[‐－―−ー]/g, '-').trim();

  /* ================= 画面の部品 ================= */
  function toast(text, err, ms) {
    const t = $('toast'); t.textContent = text; t.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms || 3200);
  }
  function modal(title, html, okText, cancelText) {
    return new Promise((res) => {
      const m = document.createElement('div'); m.className = 'modal';
      m.innerHTML = '<div class="box"><h3>' + esc(title) + '</h3>' + html + '<div class="row">' + (cancelText ? '<button class="btn ghost" data-r="0">' + esc(cancelText) + '</button>' : '') + '<button class="btn" data-r="1">' + esc(okText) + '</button></div></div>';
      m.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (!b) return; m.remove(); res(b.dataset.r === '1'); });
      document.body.appendChild(m);
    });
  }
  const waku = (h) => '<div class="waku" style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</div>';
  function errText(e, fallback) {
    const M = { exchange_closed: '受付は締め切りました', closed: '締め切りました', no_open_race: '受付中のレースがありません', already_voted: '投票済みです', not_authorized: 'まだ認証されていません', count_mismatch: 'チップが合いません', bad_nick: 'その名前は使えません', bad_bill: '数字か英字で入れてください', bad_count: 'チップが正しくありません', not_found: '投票券がありません' };
    if (e && M[e.code]) return M[e.code];
    if (e && !e.status) return '通信できませんでした';
    return (e && e.body && e.body.message) || fallback || 'もう一度お試しください';
  }

  /* ---------- 上の帯 ---------- */
  function drawTop() {
    { const c = $('crb'), a = $('arb'); if (c) { const v = rbTxt((S.count | 0) * rate()); if (c.textContent !== v) c.textContent = v; } if (a) { const v = rbTxt(bountyOf(S.count)); if (a.textContent !== v) a.textContent = v; } const x = $('xrate'); if (x) { const v = rateTxt(); if (x.innerHTML !== v) x.innerHTML = v; } } // 交換の割合が変わったら直す
    const name = (st && st.store && st.store.name) || '';
    $('store').className = 'store' + (online ? '' : ' off');
    const test = !!(st && st.settings && st.settings.test); // テストモードの店（管理画面の説明どおり、スマホにも「TEST」と出す）
    $('storeText').textContent = (test ? '【TEST】' : '') + (name || '') + (online ? '' : (name ? '・' : '') + '接続待ち');
    const sEl = $('store'); if (sEl.setAttribute) sEl.setAttribute('aria-label', (name ? name + '・' : '') + (online ? 'つながっています' : '接続を待っています'));
    $('net').classList.toggle('hidden', online);
    drawChip();
  }
  function drawChip() {
    const r = chipRace(), el = $('raceChip'); if (!r) { el.innerHTML = ''; return; }
    const n = now(); let h = '<span>発走 <b>' + hhmm(r.at) + '</b></span>';
    if (r.status === 'upcoming' && r.openAt > n) h += '<span>受付開始まで <b>' + mmss(r.openAt - n) + '</b></span>';
    else if (r.closeAt > n) {
      const voting = ['vote', 'confirm', 'wait'].indexOf(screen) >= 0 || (tk && tk.ticket && tk.ticket.status === 'authorized'), x = xAt(r);
      if (!voting && n < x) h += '<span class="' + (x - n < 15000 ? 'hot' : '') + '">参加受付 あと <b>' + mmss(x - n) + '</b></span>';
      else if (!voting) h += '<span class="hot">参加受付は締切</span>';
      else h += '<span class="' + (r.closeAt - n < 15000 ? 'hot' : '') + '">投票締切まで <b>' + mmss(r.closeAt - n) + '</b></span>';
    }
    else if (r.at > n) h += '<span>締切ました</span>';
    el.innerHTML = h;
  }

  /* ---------- 未受け取りの当たり（どの画面でも出す） ---------- */
  function unpaidNote() { /* 未受け取りの当たり・返却: ボタン 1 つだけ */
    const u = (S.unpaid || []).filter((x) => x.tid !== S.tid);
    if (!u.length) return '';
    return '<button class="btn ghost unpaid" data-act="showUnpaid">未受け取り ' + u.map(valTxt).join('・') + '</button>';
  }
  // 今日（営業日）のレースがもうない: 認証しても投票できないまま 5 時にスマホの記録が消える → 認証へ進ませない
  function dayOver() {
    if (!st || openRace() || st.live) return false;
    const at = (st.next && st.next.at) || ((st.upcoming || [])[0] || {}).at;
    return !at || (!!st.day && dayKey(at) !== st.day);
  }
  function lateNote() { // 締切後に来た人は次のレースへ（1 行）
    const o = openRace(), n = now();
    if (dayOver()) return '<div class="note red" role="status"><b>本日のレースは終了しました</b></div>';
    if (o && n >= xAt(o)) return closedNote();
    if (!o && st) return '<div class="note" role="status"><b>受付待ち</b>' + nextAt() + '</div>';
    return '';
  }

  /* 進み具合の丸・次のレースの札・遊び方の折りたたみは出さない（2026-10-17「細かい説明がいらない」。時刻と締切は上の帯にある） */
  function drawRaceCard() { /* 札はなくした */ }
  const cntBtn = () => '次へ';

  /* ================= 各画面 ================= */
  const R = {};
  const LOGO_H1 = '<h1 class="logo-h1"><img src="../art/logo-3d/B/lockup-3d-B-casaWhite.svg" width="148" height="48" alt="casa DERBY" draggable="false"></h1>'; /* 新しいロゴ（art/logo-3d/B/。2026-10-14） */
  R.noStore = () => '<div class="scr">' + LOGO_H1 + '<p class="lead">テレビの QR から開いてください</p></div>';
  R.badStore = () => '<div class="scr">' + LOGO_H1 + '<p class="lead">お店が見つかりません</p></div>';
  R.boot = () => '<div class="scr"><p class="lead" style="margin-top:40px">読み込み中…</p></div>';

  /* 各画面 = 短い見出し ＋ 入力か数字 ＋ 主なボタン 1 つ（2026-10-17） */
  R.bill = () => '<div class="scr min">' + unpaidNote() + '<h1>会計番号</h1>' +
    '<input class="big" id="bill" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" autocomplete="off" autocapitalize="off" maxlength="12" value="' + esc(S.bill) + '" aria-label="会計番号">' +
    '<p class="err" id="err" role="alert"></p><button class="btn" data-act="bill">次へ</button></div>';

  R.nick = () => '<div class="scr min"><h1>ニックネーム</h1>' +
    '<input class="big nick" id="nick" type="text" autocomplete="off" autocapitalize="off" enterkeyhint="done" value="' + esc(S.nick) + '" aria-label="ニックネーム（' + MAX_NICK + '文字まで）">' +
    '<p class="err" id="err" role="alert"></p><button class="btn" data-act="nick">次へ</button><button class="link" data-act="toBill">戻る</button></div>';

  R.count = () => {
    const c = S.count || 0;
    return '<div class="scr min">' + unpaidNote() + '<div id="late">' + lateNote() + '</div>' +
      '<h1>チップ</h1><p class="xrate" id="xrate">' + rateTxt() + '</p>' +
      '<div class="counter" aria-live="polite"><span class="num" id="cnum">' + chips(c) + '</span><div class="eq rb" id="crb">' + rbTxt(c * rate()) + '</div></div>' +
      '<div class="plus"><button data-add="1" aria-label="100 ふやす">＋100</button><button data-add="10" aria-label="1,000 ふやす">＋1,000</button><button data-add="100" aria-label="10,000 ふやす">＋10,000</button></div>' +
      '<div class="minor"><button data-act="cnt0" aria-label="0 にもどす">0</button></div>' +
      '<p class="err" id="err" role="alert"></p><button class="btn" data-act="count" ' + (c > 0 && !dayOver() && !xClosed() ? '' : 'disabled') + '>' + cntBtn(c) + '</button>' +
      '<button class="link" data-act="toBill">' + esc(S.bill) + '・' + esc(S.nick) + '　変更</button></div>';
  };

  /* スタッフに見せる QR: 「スタッフに見せる」＋ QR を大きく ＋ チップ（数字だけ）＋ 小さくリングバウンティ */
  R.auth = () => '<div class="scr min">' +
    (xClosed() ? closedNote() : '<h1 class="show">スタッフに見せる</h1>') +
    '<div class="qrbox big' + (xClosed() ? ' wait' : '') + '" id="qr" role="img" aria-label="認証の QR コード"></div>' +
    '<div class="authn"><b>' + chips(S.count) + '</b></div><div class="eq rb authrb" id="arb">' + rbTxt(bountyOf(S.count)) + '</div>' +
    '<button class="link" data-act="redo">チップを変える</button></div>';

  /* 確定オッズが見せていたオッズから動くか（管理の「確定オッズを上げる幅・下げる幅」。両方 0% なら動かない＝注意書きを出さない）。古いサーバーで値がなければ動く扱い */
  function oddsMove() { const x = st && st.settings; if (!x || x.shiftUp == null || x.shiftDown == null) return true; return Number(x.shiftUp) > 0 || Number(x.shiftDown) > 0; }
  /* 当たったら（2026-10-17 オーナー「投票中は払い戻し額がわかるように・出走中も手元で当選したらいくらが見えるように」）
     額 = 枚数 × 1枚あたり（payEst）。確定オッズはスマホには発表（done）まで届かない（API.md: phone は revealAt まで result を伏せる）
     → 締切後・レース中も「目安」のまま。結果に finalOdds が入っていればそれを使い「目安」を外す */
  const oddsOf = (h) => (h.finalOdds ? h.finalOdds : h.odds);
  const meyasu = (h) => (oddsMove() && !h.finalOdds ? '<i class="mey">目安</i>' : '');
  function ifRange(rows) { /* rows: [[horse, 枚数]] → { max, min, n }（1 頭なら max = min） */
    const v = rows.filter((x) => x[1] > 0).map(([h, n]) => payEst(n, oddsOf(h)));
    return v.length ? { max: Math.max.apply(null, v), min: Math.min.apply(null, v), n: v.length } : null;
  }
  function ifSumHtml(rows, anyMey) {
    const g = ifRange(rows); if (!g) return '';
    const m = anyMey ? '<i class="mey">目安</i>' : '';
    return g.n === 1 ? '<span class="k">当たったら</span><b>' + amt(g.max) + '</b>' + m
      : '<span class="k">当たったら 最大</span><b>' + amt(g.max) + '</b>' + m + '<small>最小 ' + amt(g.min) + '</small>';
  }
  const allocRows = (r) => horsesOf(r).map((h) => [h, (S.alloc && S.alloc[h.i]) | 0]);
  R.vote = () => {
    const r = voteRace();
    if (!r && tk && tk.ticket && tk.ticket.authRaceId) return '<div class="scr min"><h1>締め切りました</h1><div class="note" role="status"><b>返却します</b></div>' + unpaidNote() + '</div>';
    if (!r) return '<div class="scr min"><h1>受付待ち</h1>' + (dayOver() ? '<div class="note red" role="status"><b>本日のレースは終了しました</b></div>' : st && st.next ? '<div class="note" role="status"><b>次のレース ' + hhmm(st.next.at) + '</b></div>' : '') + unpaidNote() + '</div>';
    /* 投票画面: 上に「残り ○枚」と当たったら額、6 頭の一覧（枠色の番号・馬名・1枚あたりを大きく）、下に －1 / ＋1 / ＋10 / ＋100 / 0 と「投票を確認」。説明の文はなし（額の横に小さく「目安」だけ） */
    const hs = horsesOf(r), left = S.count - sumAlloc();
    return '<div class="scr vote">' +
      '<div class="left' + (left === 0 ? ' zero' : '') + '"><div class="lt" aria-live="polite"><span class="l1">残り</span> <b id="left">' + chips(left) + '</b></div>' +
      '<div class="ifsum" id="ifsum">' + ifSumHtml(allocRows(r), oddsMove()) + '</div></div>' +
      '<div class="list" id="cards">' + hs.map(cardHtml).join('') + '</div>' +
      '<div class="dock"><div class="who" id="who">' + whoText(r) + '</div>' +
      '<div class="plus five"><button data-act="vMinus" aria-label="100 へらす">－100</button><button data-va="1" aria-label="100 ふやす">＋100</button><button data-va="10" aria-label="1,000 ふやす">＋1,000</button><button data-va="100" aria-label="10,000 ふやす">＋10,000</button><button data-act="vClr" aria-label="この馬を 0 に">0</button></div>' +
      '<button class="btn" data-act="toConfirm" ' + (left === 0 ? '' : 'disabled') + '>' + goText(left) + '</button></div></div>';
  };
  const goText = (left) => (left === 0 ? '投票を確認' : 'あと ' + chips(left) + ' えらんでください');
  function cardHtml(h) {
    const n = (S.alloc && S.alloc[h.i]) | 0;
    return '<div class="card' + (sel === h.i ? ' sel' : '') + (n ? ' has' : '') + '" data-h="' + h.i + '" role="button" aria-pressed="' + (sel === h.i) + '">' + waku(h) +
      '<div class="cm"><div class="hname">' + esc(h.name) + '</div>' + formLine(voteRace(), h) + '</div>' +
      '<div class="per"><b>' + oddsTxt(oddsOf(h)) + '</b><small>倍</small></div>' +
      (n ? '<div class="if"><b>' + chips(n) + '</b> → 当たったら <em>' + amt(payEst(n, oddsOf(h))) + '</em>' + meyasu(h) + '</div>' : '') + '</div>';
  }
  function whoText(r) {
    if (sel == null) return '<span class="wn">馬をえらぶ</span>';
    const h = horse(r, sel); if (!h) return '';
    return '<span class="wn"><b>' + h.no + '番 ' + esc(h.name) + '</b>　' + chips((S.alloc && S.alloc[sel]) | 0) + '</span><button class="rest" data-act="vRest">残り全部</button>';
  }

  let shownRaceId = null; // 確認画面に出したレース（投票はこのレースにだけ入れる。締切で次に移っていたらサーバーが closed を返す）
  R.confirm = () => {
    const r = voteRace(); if (!r) return R.vote();
    shownRaceId = r.id;
    const rows = picksOf().map((p) => [horse(r, p.horse), p.count]).filter((x) => x[0]);
    const go1 = rows.length === 1 ? rows[0][0].no + '番に ' + chips(rows[0][1]) + ' 投票する' : rows.length + '頭に ' + chips(S.count) + ' 投票する'; // 確定ボタンは具体的に（REVIEW_TODO 7）
    /* 確認: 1 頭ごとに 枚数 と 当たったら額。合計の枚数と「当たったら 最大」。取り消せないことはボタンの読み上げに入れる */
    return '<div class="scr confirm"><h1>投票の確認</h1><div class="list picks">' +
      rows.map(([h, n]) => '<div class="pick">' + waku(h) + '<div class="nm"><span class="no">' + h.no + '番</span>' + esc(h.name) + '<small>オッズ ' + oddsTxt(oddsOf(h)) + '倍</small></div><div class="n">' + chips(n) + '</div>' +
        '<div class="pif"><span>当たったら</span><b>' + amt(payEst(n, oddsOf(h))) + '</b>' + meyasu(h) + '</div></div>').join('') +
      '</div><div class="total"><span>合計 <b>' + chips(S.count) + '</b></span>' + (rows.length > 1 ? '<span class="ifsum">' + ifSumHtml(rows, oddsMove()) + '</span>' : '') + '</div>' +
      // 確定ボタンは画面の下に固定（投票画面の「確認へ」と同じ場所。2 度押しの 2 回目は 0.6 秒の守りで止める＝tests/v2-mobile.plan.js）
      '<div class="dock cdock"><p class="err" id="err" role="alert"></p><button class="btn ghost" data-act="toVote">戻る</button><button class="btn" data-act="vote" aria-label="' + go1 + '（取り消しできません）">' + go1 + '</button></div></div>';
  };

  /* 投票のあと〜レース中（2026-10-17）: 1 頭ごとの小さな札「2番 ウエノパンダ 30枚 → 当たったら 18,300」。
     確定オッズはスマホには結果の発表まで来ない（勝ち馬を決めたデータを先に出さない）→ 発表までは「目安」のまま。
     レース中も勝ち馬につながる目立たせ方はしない（額だけ） */
  function myCards(r, rows) {
    return rows.map(([h, n]) => '<div class="mycard">' + waku(h) + '<div class="mc"><div class="mc-h">' + h.no + '番 ' + esc(h.name) + '</div>' +
      '<div class="mc-b"><b>' + chips(n) + '</b> → 当たったら <em>' + amt(payEst(n, oddsOf(h))) + '</em>' + meyasu(h) + '</div></div></div>').join('');
  }
  R.wait = () => {
    const r = tkRace(), rows = picksOf().map((p) => [horse(r, p.horse), p.count]).filter((x) => x[0]);
    const anyMey = rows.some(([h]) => !!meyasu(h));
    return '<div class="scr min"><h1 class="done-h"><i aria-hidden="true">✓</i>投票しました</h1>' +
      '<div class="betsum"><div class="mycards" id="mycards" data-at="' + (r ? r.at : '') + '">' + myCards(r, rows) + '</div>' +
      (rows.length > 1 ? '<div class="ifsum wide">' + ifSumHtml(rows, anyMey) + '</div>' : '') + '</div>' +
      '<div class="nexta" aria-live="polite"><div class="clock"><div class="k" id="wk"></div><div class="v" id="wv"></div></div></div>' + unpaidNote() + '</div>';
  };
  function waitClock() {
    const r = tkRace(), k = $('wk'), v = $('wv'); if (!k || !r) return;
    const n = now();
    if (r.closeAt > n) { k.textContent = '締切まで'; v.textContent = mmss(r.closeAt - n); }
    else if (r.at > n) { k.textContent = '発走まで'; v.textContent = mmss(r.at - n); }
    else if (r.revealAt > n) { k.textContent = 'レース中・結果まで'; v.textContent = mmss(r.revealAt - n); }
    else { k.textContent = ''; v.textContent = '結果待ち'; }
  }

  /* 結果: 当たり ＝「当たり」＋当選額＋QR／はずれ ＝「はずれ」＋次のレースの時刻／返却 ＝「返却」＋返却額＋QR（説明の文はなし） */
  const nextRaceLine = () => (nextRace() ? '<p class="nextr">次のレース ' + hhmm(nextRace().at) + '</p>' : '');
  function payBlock(p, paid, expired) {
    if (expired) return '<div class="note red" role="status"><b>受け取り期限切れ</b></div>';
    return '<div class="qrbox big' + (paid ? ' done' : '') + '" id="qr" role="img" aria-label="' + (paid ? '受け取り済み' : 'スタッフに見せる QR コード') + '"></div>';
  }
  R.result = () => {
    const t = tk.ticket, res = t.result || {}, p = res.payout || null, amount = res.amount | 0;
    const paid = !!(p && p.status === 'paid'), expired = !!(p && p.status === 'expired'), back = res.bounty | 0;
    const nextBtn = '<button class="btn' + (has(res) && p && p.status === 'unpaid' ? ' ghost' : '') + '" data-act="next">次のレースへ</button>';
    const rbBlock = '<div class="k">リングバウンティ</div><div class="a">' + amt(back) + '</div>'; // 返却・返還はリングバウンティ（額ではない）
    if (res.novote) return '<div class="scr min"><div class="hit ret"><h1 class="t">返却</h1>' + rbBlock + '</div>' + payBlock(p, paid, expired) + nextBtn + '</div>';
    const refunded = !!res.refunded; // 返還（レースが成立しなかった）: 当たりではなく、賭けた枚数を返す
    let body;
    if (refunded && back > 0) body = '<div class="hit ret"><h1 class="t">返還</h1>' + rbBlock + '</div>' + payBlock(p, paid, expired);
    else if (!refunded && amount > 0) body = '<div class="hit"><h1 class="t">当たり</h1><div class="k">当選額</div><div class="a">' + amt(amount) + '</div></div>' + payBlock(p, paid, expired);
    else if (refunded) body = '<div class="miss"><h1 class="t">返還</h1></div><p class="nextr">お返しはありません</p>';
    else body = '<div class="miss"><h1 class="t">はずれ</h1></div>' + nextRaceLine();
    return '<div class="scr min">' + body + nextBtn + '</div>';
  };

  R.unpaid = () => {
    const u = (S.unpaid || []).filter((x) => x.tid !== S.tid)[0]; if (!u) return R.count();
    return '<div class="scr min"><div class="hit' + (isRb(u) ? ' ret' : '') + '"><h1 class="t">' + (u.novote ? '返却' : u.refund ? '返還' : '当たり') + '</h1>' + (isRb(u) ? '<div class="k">リングバウンティ</div><div class="a">' + amt(rbOf(u)) + '</div>' : '<div class="k">当選額</div><div class="a">' + amt(u.amount) + '</div>') + '</div>' +
      '<div class="qrbox big" id="qr" role="img" aria-label="スタッフに見せる QR コード"></div><button class="btn ghost" data-act="back">もどる</button></div>';
  };

  /* ================= 描画 ================= */
  let shownAt = 0; // 画面が変わった時刻（2 度押しの 2 回目が、次の画面の同じ場所のボタンに当たらないように）
  function go(name) { if (screen !== name) { window.scrollTo(0, 0); shownAt = performance.now(); } screen = name; draw(); }
  function qr(code, paid, short) { // short: 手入力用の 6 桁の番号（サーバーが付けたもの。なければ QR の id）
    const el = $('qr'); if (!el) return; // 描いている間に画面が変わったら、新しい画面の QR を古い中身で上書きしない
    const num = () => { // カメラが使えない・QR が出せないときにスタッフが手で入れる番号（QR が出せなくても出す）
      const id = short || (DerbyQR.parse(code) || {}).id;
      if (id && !paid && el.isConnected && !$('qrid')) el.insertAdjacentHTML('afterend', '<p class="qrid" id="qrid">番号 ' + esc(id) + '</p>');
    };
    DerbyQR.render(el, code).then(() => {
      if (!el.isConnected) return;
      if (paid) el.insertAdjacentHTML('beforeend', '<div class="stamp"><b>受け取り済み</b></div>');
      num();
    })
      .catch(() => { if (!el.isConnected) return; el.innerHTML = '<p style="color:#000;text-align:center;font-size:14px">QR を表示できません</p>'; num(); });
  }
  function draw() {
    $('main').innerHTML = (R[screen] || R.boot)(); drawTop();
    if (screen === 'auth') qr(S.authCode || DerbyQR.payload('auth', S.tid), false, tk && tk.ticket && tk.ticket.short);
    if (screen === 'result') { const p = tk.ticket.result && tk.ticket.result.payout; if (p && has(tk.ticket.result) && p.status !== 'expired') qr(p.code || DerbyQR.payload('pay', p.pid), p.status === 'paid', p.short); }
    if (screen === 'unpaid') { const u = S.unpaid.filter((x) => x.tid !== S.tid)[0]; if (u) qr(u.code, false, u.short); }
    if (screen === 'wait') waitClock();
    if (screen === 'vote') drawVoteParts();
    if (screen === 'nick') { const i = $('nick'); i.addEventListener('input', () => { if (Array.from(i.value).length > MAX_NICK) i.value = cutNick(i.value); }); }
    const inp = $('bill') || $('nick'); if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); act(screen, null); } }); // 日本語の変換を確定する Enter では進まない
  }
  function drawVoteParts() { // 投票画面は全部描き直さず、数字と選択だけ更新（スクロール位置を保つ）
    const r = voteRace(); if (!r || !$('left')) return;
    const left = S.count - sumAlloc();
    document.querySelectorAll('.card').forEach((c) => { c.outerHTML = cardHtml(horse(r, c.dataset.h)); });
    $('left').textContent = chips(left); document.querySelector('.left').classList.toggle('zero', left === 0);
    $('who').innerHTML = whoText(r);
    const fs = $('ifsum'), fh = ifSumHtml(allocRows(r), oddsMove()); if (fs && fs.innerHTML !== fh) fs.innerHTML = fh;
    const b = document.querySelector('[data-act=toConfirm]');
    b.disabled = left !== 0; b.textContent = goText(left);
    const mine = sel == null ? 0 : (S.alloc[sel] | 0);
    document.querySelectorAll('[data-va]').forEach((x) => { x.disabled = sel == null || left <= 0; });
    document.querySelectorAll('[data-act=vMinus],[data-act=vClr]').forEach((x) => { x.disabled = sel == null || mine <= 0; });
  }
  function syncMyCards() { /* 待ちの画面: 結果に確定オッズが入ったら額を確定の値にして「目安」を外す（スマホに届くのは発表のとき） */
    const e = $('mycards'), r = tkRace(); if (!e || !r) return;
    const h = myCards(r, picksOf().map((p) => [horse(r, p.horse), p.count]).filter((x) => x[0])); if (e.innerHTML !== h || e.dataset.at !== String(r.at)) draw(); /* 発走時刻が変わった（早めの締切）ときも描き直す */
  }

  /* ================= 行き先を決める（再読み込み・通知のたびに） ================= */
  function syncCount() { // 枚数の画面: 案内と「認証へ」のボタン（今日のレースが終わったら押せない）
    const l = $('late'); if (l) { const h = lateNote(); if (l.innerHTML !== h) l.innerHTML = h; }
    const k = document.querySelector('[data-act=count]'); if (k && !busy) { k.disabled = !(S.count > 0) || dayOver() || xClosed(); const tx = cntBtn(S.count); if (k.textContent !== tx) k.textContent = tx; }
  }
  // 営業日が変わった（ページを開いたまま朝 5 時をまたいだ・前の日のタブに戻ってきた）: 起動のときと同じく記録を消す
  function newDay() {
    if (!st || !st.day || st.day === S.day) return false;
    if (!S.day) { S.day = st.day; save(); return false; } // 起動のときに通信できなかった
    if (S.tid && !(tk && tk.ticket)) return false; // 投票券をまだ読めていない（起動の途中・通信待ち）: 読めてから決める
    // 使いかけの投票券は残す（認証待ち・投票前、と新しい営業日のレースに投票して結果待ち・受け取り前）。残すときは営業日を進める。
    // 以前は営業日を進めずに残していたので、5 時をまたいで投票した直後（5:00 のレースなど）に消えて、結果と受け取り QR が出なくなっていた（コードレビュー 2026-10-14）
    const t = tk && tk.ticket, r = tkRace(), res = t && t.result, p = res && res.payout;
    const inUse = t && (t.status === 'pending' || t.status === 'authorized' || (t.novote && p && p.status === 'unpaid') || (t.status === 'voted' && r && dayKey(r.at) === st.day && (!res || (p && p.status === 'unpaid' && has(res)))));
    if (S.tid && inUse) { S.day = st.day; save(); return false; }
    S = fresh(); S.day = st.day; tk = null; sel = null; save(); resubscribe(); go('bill'); return true;
  }
  function route() {
    if (!STORE || !C) return go('noStore');
    if (screen === 'badStore') return;
    if (newDay()) return;
    if (!S.tid || !tk || !tk.ticket) {
      if (S.tid) return draw();
      if (['bill', 'nick', 'count', 'unpaid'].indexOf(screen) >= 0) { if (screen === 'count') syncCount(); drawTop(); return; }
      return go(!S.bill ? 'bill' : !S.nick ? 'nick' : 'count');
    }
    const t = tk.ticket;
    if (t.status === 'void' && !t.novote) { dropTicket(); save(); toast('投票券が使えません', true, 5000); return go('count'); }
    if (t.status === 'pending') return screen === 'auth' ? drawTop() : go('auth');
    if (t.status === 'authorized') {
      if (screen === 'auth') authDone(S.count); // 認証の画面から来た: 「30 枚の認証が完了」を 2 秒（REVIEW_TODO 7）
      const r = voteRace();
      if (r && S.allocRace !== r.id) { // 新しいレース（認証したレース。以前の券は締切に間に合わなかったときも含む）: 割り振りを白紙に
        if (S.allocRace && sumAlloc() > 0 && !t.authRaceId) toast('次のレースに投票できます', false, 5000);
        S.alloc = {}; S.allocRace = r.id; sel = null; save();
        if (screen === 'confirm') return go('vote');
      }
      if (screen === 'vote' || screen === 'confirm') { if ((screen === 'vote') !== !!$('left') || !r) draw(); else drawTop(); return; } // 受付の有無が変わったら描き直す
      return go('vote');
    }
    if (t.status === 'voted' || t.novote) { // 返却（投票しなかった券）も結果の画面で QR を出す
      const res = t.result;
      if (res) {
        const p = res.payout, i = S.unpaid.findIndex((x) => x.tid === t.tid);
        if (p && has(res) && p.status === 'unpaid') { // まだ受け取っていない当たり・返還（返還で当たりが取り消されたら QR を差し替える）
          const u = { tid: t.tid, key: S.key, code: p.code || DerbyQR.payload('pay', p.pid), short: p.short || null, amount: res.amount | 0, bounty: res.bounty | 0, at: tkRace() && tkRace().at, refund: p.kind === 'refund' || undefined, novote: res.novote || undefined };
          if (i < 0) S.unpaid.push(u); else S.unpaid[i] = u;
          save();
        } else if (i >= 0) { S.unpaid.splice(i, 1); save(); } // 受け取り済み・期限切れ・取り消し
        const sig = [t.tid, res.amount, res.bounty, p && p.status, p && p.pid, res.refunded].join('|');
        if (screen === 'result' && resultSig === sig) return drawTop();
        resultSig = sig; return go('result');
      }
      return screen === 'wait' ? (drawTop(), waitClock(), syncMyCards()) : go('wait');
    }
  }

  function authDone(n) {
    const d = document.createElement('div'); d.className = 'okfx'; d.setAttribute('role', 'status'); d.innerHTML = '<div><i aria-hidden="true">✓</i><b>認証OK ' + chips(n) + '</b></div>';
    document.body.appendChild(d); setTimeout(() => d.classList.add('bye'), 1700); setTimeout(() => d.remove(), 2100);
  }
  let refreshing = null, resultSig = '';
  function refreshTicket() {
    if (!S.tid) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = C.getTicket(S.tid, S.key).then((d) => { tk = d; online = up(); route(); })
      .catch((e) => { if (e.status === 404 || e.status === 403) { dropTicket(); save(); route(); } else { online = false; drawTop(); } })
      .then(() => { refreshing = null; });
    return refreshing;
  }
  function badStore() { if (unsub) { try { unsub(); } catch (e) { /* noop */ } unsub = null; } go('badStore'); } // 店舗 ID がちがう（古い QR・打ちまちがい）
  function refreshState() {
    return C.state().then((d) => { st = d; online = up(); }).catch((e) => { if (e && e.code === 'no_store') return badStore(); online = false; }).then(() => route());
  }
  async function refreshUnpaid() { // 前のレースの当たりが受け取り済みになったか
    for (const u of (S.unpaid || []).slice()) {
      if (u.tid === S.tid) continue;
      try {
        const d = await C.getTicket(u.tid, u.key), res = d && d.ticket && d.ticket.result, p = res && res.payout;
        if (!res) continue;
        if (!p || p.status !== 'unpaid' || !has(res)) { // 受け取り済み・期限切れ（5 時の区切り）・取り消し
          S.unpaid = S.unpaid.filter((x) => x.tid !== u.tid); save();
          toast(p && p.status === 'paid' ? (u.novote ? '返却 ' : u.refund ? '返還 ' : '当選額 ') + valTxt(u) + ' を受け取りました' : p && p.status === 'expired' ? '受け取り期限切れ' : '受け取りを更新しました', p && p.status === 'expired');
          if (screen === 'unpaid') go(backTo || 'count'); else if (['bill', 'nick', 'vote', 'confirm'].indexOf(screen) < 0) draw(); // 入力中・割り振り中の画面は描き直さない
        } else if (('derby:pay:' + p.pid) !== u.code || (res.amount | 0) !== (u.amount | 0) || (res.bounty | 0) !== (u.bounty | 0)) { Object.assign(u, { code: p.code || DerbyQR.payload('pay', p.pid), short: p.short || null, amount: res.amount | 0, bounty: res.bounty | 0, refund: p.kind === 'refund' || undefined }); save(); if (screen === 'unpaid') draw(); }
      } catch (e) { if (e.status === 404) { S.unpaid = S.unpaid.filter((x) => x.tid !== u.tid); save(); } }
    }
  }

  /* ================= 操作 ================= */
  async function act(a, el) {
    const err = (t) => { const e = $('err'); if (e) e.textContent = t || ''; };
    if (a === 'bill') {
      const v = cleanBill($('bill').value);
      if (!v) return err('会計番号を入れてください');
      if (!/^[0-9A-Za-z-]{1,12}$/.test(v)) return err('数字か英字で 12 文字までにしてください');
      S.bill = v; save(); return go(S.nick ? 'count' : 'nick');
    }
    if (a === 'toBill') return go('bill');
    if (a === 'nick') {
      const v = cleanNick($('nick').value);
      if (!v) return err('ニックネームを入れてください');
      if (badNick(v)) return err('そのニックネームは使えません。ほかの名前にしてください');
      S.nick = v; save(); return go('count');
    }
    if (a === 'cnt0') { S.count = 0; save(); return draw(); }
    if (a === 'count') {
      if (busy || !(S.count > 0)) return;
      if (xClosed()) { syncCount(); return err(errText({ code: 'exchange_closed' })); }
      busy = true; if (el) { el.disabled = true; el.textContent = '準備しています…'; }
      try {
        const d = await C.createTicket({ bill: S.bill, nick: S.nick, count: S.count });
        dropTicket(); S.tid = d.tid; S.key = d.key; S.authCode = d.authCode; save();
        tk = { ticket: d.ticket, race: null };
        busy = false; resubscribe(); go('auth');
      } catch (e) {
        busy = false; if (e.code === 'no_store') return badStore(); if (e.code === 'exchange_closed') await refreshState(); draw(); err(errText(e));
        if (e.code === 'bad_nick') { S.nick = ''; save(); setTimeout(() => go('nick'), 1500); }
      }
      return;
    }
    if (a === 'redo') { // 認証前なら作り直す（古い QR は認証されないまま残るだけ）
      if (!(await modal('チップを変えますか？', '', '変える', 'やめる'))) return;
      try { await C.cancelTicket(S.tid, S.key); }
      catch (e) { if (e.status === 409 || e.code === 'already_authorized') { toast('もう認証されています', true); return refreshTicket(); } if (!e.status) return toast(errText(e), true); }
      dropTicket(); save(); resubscribe(); return go('count');
    }
    if (a === 'vClr') { if (sel != null) { delete S.alloc[sel]; save(); drawVoteParts(); } return; }
    if (a === 'vMinus') { if (sel != null && (S.alloc[sel] | 0) > 0) { S.alloc[sel] = (S.alloc[sel] | 0) - 1; if (!S.alloc[sel]) delete S.alloc[sel]; save(); drawVoteParts(); } return; }
    if (a === 'vAll0') { S.alloc = {}; save(); return drawVoteParts(); }
    if (a === 'vRest') { if (sel == null) return toast('馬をえらんでください'); const left = S.count - sumAlloc(); if (left > 0) { S.alloc[sel] = (S.alloc[sel] | 0) + left; save(); } return drawVoteParts(); }
    if (a === 'toConfirm') { if (S.count - sumAlloc() !== 0) return; return go('confirm'); }
    if (a === 'toVote') return go('vote');
    if (a === 'vote') {
      if (busy) return; busy = true; if (el) { el.disabled = true; el.textContent = '送っています…'; }
      const picks = Object.keys(S.alloc).filter((k) => S.alloc[k] > 0).map((k) => ({ horse: Number(k), count: S.alloc[k] }));
      try {
        tk = await C.vote(S.tid, S.key, picks, S.allocRace || shownRaceId || (voteRace() || {}).id); busy = false; save(); route(); // 割り振りを決めたレースだけに入れる（締切で次に移っていたら closed）
      } catch (e) {
        busy = false;
        if (e.code === 'already_voted') return refreshTicket();
        if (e.code === 'closed' || e.code === 'no_open_race') { toast(errText(e), true, 5000); await refreshState(); return refreshTicket(); }
        draw(); err(errText(e));
      }
      return;
    }
    if (a === 'next') { dropTicket(); S.count = 0; save(); resubscribe(); go('count'); return refreshState(); }
    if (a === 'showUnpaid') { backTo = screen; return go('unpaid'); }
    if (a === 'back') return go(backTo && backTo !== 'unpaid' ? backTo : 'count');
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act],[data-add],[data-va],.card');
    if (!b || b.disabled) return;
    if (b.dataset.act) {
      e.preventDefault();
      // 「確認へ」の 2 度押し: 2 回目が確認画面の「投票を確定する」に当たると、見ないまま確定してしまう（取り消し不可）→ 画面が出て 0.6 秒は受け付けない（指のタップだけ）
      if (b.dataset.act === 'vote' && e.isTrusted && e.timeStamp - shownAt < 600) return; // timeStamp＝指が触れた時刻（端末が重くて処理が遅れても 2 回目を見分ける）
      act(b.dataset.act, b); return;
    }
    if (b.dataset.add) { S.count = Math.min(MAX_COUNT, (S.count | 0) + Number(b.dataset.add)); save(); $('cnum').textContent = chips(S.count); if ($('crb')) $('crb').textContent = rbTxt(S.count * rate()); const k = document.querySelector('[data-act=count]'); if (k) { k.disabled = !(S.count > 0) || dayOver() || xClosed(); k.textContent = cntBtn(S.count); } return; }
    if (b.dataset.va) { if (sel == null) return toast('馬をえらんでください'); const left = S.count - sumAlloc(), add = Math.min(left, Number(b.dataset.va)); if (add <= 0) return toast('残り 0'); S.alloc[sel] = (S.alloc[sel] | 0) + add; save(); drawVoteParts(); return; }
    if (b.classList.contains('card')) { sel = Number(b.dataset.h); drawVoteParts(); }
  });

  /* ================= リアルタイム ================= */
  function resubscribe() {
    if (unsub) { try { unsub(); } catch (e) { /* noop */ } }
    unsub = C.subscribe({
      open() { if (!online && up()) { online = true; drawTop(); } refreshTicket(); },
      error() { online = false; drawTop(); },
      state(s) { st = s; online = up(); route(); },
      race() { /* state が続けて来る */ },
      ticket() { refreshTicket(); }, // race も要るので取り直す
    }, S.tid ? { tid: S.tid, key: S.key } : undefined);
  }
  // 同じスマホで 2 つのタブを開いている: ほかのタブが保存したら、こちらも同じ内容にそろえる（古いタブの保存で、新しい投票券を消さない）
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !C || !S || screen === 'badStore') return;
    let n = null; try { n = JSON.parse(e.newValue); } catch (x) { n = null; }
    if (!n || n.v !== 3 || n.store !== STORE) return;
    const other = n.tid !== S.tid; S = n;
    if (!other) { if (screen === 'vote') drawVoteParts(); return; }
    tk = null; sel = null; resubscribe();
    if (S.tid) refreshTicket(); else go(!S.bill ? 'bill' : !S.nick ? 'nick' : 'count');
  });
  window.addEventListener('online', () => { refreshState(); refreshTicket(); });
  window.addEventListener('offline', () => { online = false; drawTop(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { C.syncClock().catch(() => {}); refreshState(); refreshTicket(); refreshUnpaid(); } });

  // 1 秒ごと: 時計。締切・発表の時刻をまたいだら取り直す（SSE の保険）
  let lastPh = '', lastAuthClosed = false;
  setInterval(() => {
    if (!C) return;
    drawChip(); drawRaceCard(); if (screen === 'wait') waitClock();
    if (screen === 'count') syncCount();
    if (screen === 'auth') { const xc = xClosed(); if (xc !== lastAuthClosed) { lastAuthClosed = xc; draw(); } else if (xc) { const e = document.querySelector('.xclosed span'); if (e) e.innerHTML = nextInfo(); } } // 参加受付が締め切られた・次のレースの受付が始まった
    const r = screen === 'wait' ? tkRace() : openRace(), n = now();
    const ph = r ? [r.id, n >= xAt(r), n >= r.closeAt, n >= r.revealAt].join('|') : '-';
    if (ph !== lastPh) { const first = !lastPh; lastPh = ph; if (!first) { refreshState(); refreshTicket(); } }
  }, 1000);
  // SSE が届かない環境の保険
  setInterval(() => {
    if (document.hidden || !C) return;
    if (S.tid && ['auth', 'wait', 'result'].indexOf(screen) >= 0) refreshTicket();
    if (screen !== 'badStore' && (!online || ['count', 'vote'].indexOf(screen) >= 0)) refreshState();
    if ((S.unpaid || []).length) refreshUnpaid();
  }, 6000);

  /* ================= 起動 ================= */
  async function boot() {
    S = load();
    if (!S || S.v !== 3 || S.store !== STORE) S = fresh();
    if (!STORE || !C) return go('noStore');
    go('boot');
    try { await C.syncClock(); } catch (e) { online = false; }
    try { st = await C.state(); } catch (e) { online = false; if (e && e.code === 'no_store') return go('badStore'); }
    const today = st && st.day; // 営業日はサーバーのもの（スマホの時計がずれていても消しすぎない。通信できなければあとで newDay が見る）
    if (today && !S.day) { S.day = today; save(); } // 営業日が変わっていたら、投票券を読んでから newDay（route の中）が消す（使いかけの投票券は残す）
    resubscribe();
    if (S.tid) await refreshTicket();
    route();
    if ((S.unpaid || []).length) refreshUnpaid();
  }
  boot();
})();
