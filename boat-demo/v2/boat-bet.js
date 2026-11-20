/* casa BOAT のスマホの投票（2026-11-19）: v2/boat.html。決まりごとは v2/boat-core.js、つなぎ先は v2/client.js（模擬クラウド v2/boat-server.js・Firestore v2/boat-firestore.js）。
   画面と言葉は本物の舟券・公式のネット投票にそろえた（ref/boat/research/26_舟券と投票画面.md）:
     予想 … マークカードの 2 連単の欄（1着・2着の行に 1〜6）。組番は「1-4」（ハイフン）
     確認 … 「投票内容の確認」の表（No・勝式・組番・オッズ・購入金額）＋「合計ベット数」「購入金額」＋［投票内容を修正する］［投票する］
     投票後 … 「投票結果」「ご投票ありがとうございました。」＋舟券の形（左＝場名・発売所の帯・レース・日付／中央＝縦書きの「2連単」／右＝組番「1▶4」と選手名・金額「◆◆◆100」／下＝合計・通し番号・バーコード）
     当たり … 「的中ベットがありました。おめでとうございます！」＋額
   決まり: 2 連単だけ。無料の券 1 枚（締切まで組番を変えられる）＋ BPT 100 ごとに 1 枚（何通りにでも・同じ組番に重ねてもよい・持っている BPT まで何枚でも（2026-11-19 オーナー決定）・足した券は消せない）。BPT は 3,000 まで（2026-11-20）。
   当たりは BPT（受け取りのスライドなし）。画面に「ポイント」と書かない（BPT と書く）。音は鳴らさない。
   1 画面に収める（v2/bet.css の土台・bet.html と同じ頭のスクリプト）。入らない画面だけ .os-t → .os-s → .os-xs と詰め、券の一覧（.fx）だけ中で動く。
   2026-11-20 不具合の直し（ref/boat/不具合一覧_2026-11-20.md の B・C3・C5・F。確かめは tests/boat-phone-bugs.plan.js）:
     ・返事は「送ったときのレース」と見比べる。送信中・読み込み中にレースが切り替わったら、古い返事で今の画面を書き換えない（S.send・S.ver・mineSeq）。古い読み取りが新しい中身を上書きしない
     ・投票が届いたか分からない失敗（電波切れ・返事なし）のあとは、自分の票を読み直してから案内する（S.pend・verify。確かめが済むまで「投票する」を押させない＝BPT を 2 回使わせない）
     ・読み取りを減らす: 自分の票と BPT を読むのは「このレースの QR を読んだ・このレースで投票した（しようとした）」スマホだけ（needMine）。開きっぱなしのスマホはレースごとに読み直さない。
       発表のあとの読み直しは当たり・返還のある人だけ。店の名前は 1 日覚える。いまの状態は見張りで届くものを使う。画面を消している間（1 分より長く）は見張りを止める
     ・画面を消して戻った・電波が戻ったときは、時刻合わせと自分の票・BPT の読み直しを 1 回だけ（resync。5 秒に 1 回まで）
     ・えらんだ券はスマホに覚える（casa.boat.cart。QR を読み直しても・競馬へ行って戻っても消えない）。投票が通ったら消す
   2026-11-21 2 回目の直し（ref/boat/直しの依頼_2回目_2026-11-21.md の B。確かめは tests/boat-phone-bugs.plan.js の場面 9〜）:
     ・投票に操作の番号（opId）。1 回の「投票する」に 1 つ、打ち切り後の押し直し（中身が同じ）は同じ番号。届いたかは番号で確かめる（票に番号が無い古い置き場では枚数で）。古い返事は捨てる（H1・J11・J12）
     ・画面が替わる直後 0.4 秒は指の早押しを受けない（H2・H9）／待ちの画面の長い時間（H3）／消して戻ったときの前のレースの知らせ（H4）／送信中も確認の画面（H5）
     ・BPT がマイナスにならない（H6）／上限 3,000 の文（H7）／返還は実際に戻った額（H8・J16）／ニックネームの見えない字（H10）／BPT の読み直しの時間切れ（J13）
   2026-11-21 3 回目の直し（ref/boat/直しの依頼_3回目_2026-11-21.md の B。確かめは tests/boat-phone-bugs3.plan.js・横向きは tests/boat-phone.plan.js の ROWS）:
     ・番号ごとの決着（ops・dead）。打ち切りのあと中身を変えた押し直しは前の番号を prevOps に（L1）／届いた番号の券はカートから引く・読み込み直したあとも（L2）
     ・横向きの予想の画面は 2 列（L3・boat-bet.css）／カートの「×」も早押しよけ（L4）／「前の結果」は直前のレースだけ（L5）／ニックネームの整え方を競馬とそろえた（L6）／取り消しは戻し終えた合図（backDone）で読み直す */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const STORE = String(qs.get('s') || qs.get('store') || '').trim().toLowerCase();
  const Boat = window.BoatCore, Core = window.DerbyCore;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  /* BPT は 3,000 を超えて貯められない（2026-11-20 オーナー決定。当たりで超える分は 3,000 で止まり、消える）。数は決まりごと（v2/core.js の BPT_MAX）と同じ */
  const BPT_CAP = Number(Core && Core.BPT_MAX) || 3000; // v2/core.js の BPT_MAX
  const NKEY = 'casa.derby.nick', VKEY = 'casa.derby.vote.', KKEY = 'casa.boat.key.', MKEY = 'casa.boat.mine', CKEY = 'casa.boat.cart', SKEY = 'casa.boat.stores';
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 覚えられない端末はこのページの間だけ */ } } };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } } };
  let lsOk = false; try { localStorage.setItem('casa.boat.t', '1'); lsOk = localStorage.getItem('casa.boat.t') === '1'; localStorage.removeItem('casa.boat.t'); } catch (e) { lsOk = false; } // 覚えの置き場が使えるか（使えないブラウザでは、いつも自分の票を読んで確かめる）
  /* QR の合言葉: …/boat.html?s=<店>#<レース id>.<合言葉>。読んだらこのタブに覚え、住所からは消す（ほかの人に住所を送っても合言葉が付かない） */
  const memKey = {};
  function readHash() { const h = Boat.parseHash(location.hash); if (!h) return null; memKey[h.raceId] = h.code; ss.set(KKEY + h.raceId, h.code); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* noop */ } return h; }
  const bootHash = readHash();
  const keyFor = (id) => memKey[id] || ss.get(KKEY + id) || '';
  const dropKey = (id) => { delete memKey[id]; ss.set(KKEY + id, ''); };
  // その日に競馬へ参加した票の id（このスマホが覚えている競馬の票。新しい順）
  function derbyVotes() {
    const L = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(VKEY) === 0) { let v = null; try { v = JSON.parse(localStorage.getItem(k)); } catch (e) { v = null; } if (v && v.vid) L.push(v); } } } catch (e) { /* noop */ }
    return L.sort((a, b) => (b.at || 0) - (a.at || 0)).map((v) => v.vid).slice(0, 6);
  }
  const introSeen = () => ls.get('casa.boat.intro') === '1' || /[?&]intro=0\b/.test(location.search); // 初めての人への案内を見たか（2026-11-19）
  /* ニックネーム（2026-11-20 B7）: 競馬（v2/bet.js の cutNick・cleanNick）と同じ扱い。8 文字まで（サーバーと同じ「文字」の数え方。絵文字も 1 つで 1 文字）・絵文字の途中では切らない。
     入力欄の maxlength は内部の単位（絵文字 1 つ ＝ 2）で数えるので使わず、入力のたびにここで切る */
  const MAX_NICK = 8;
  function cutNick(s) {
    if (Array.from(s).length <= MAX_NICK) return s;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) { let out = '', n = 0; for (const g of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s)) { const c = Array.from(g.segment).length; if (n + c > MAX_NICK) break; out += g.segment; n += c; } return out; }
    return Array.from(s).slice(0, MAX_NICK).join('');
  }
  /* 見えない字・向きを変える印（2026-11-21 H10）: 幅のない字・向きの印・ハングルの空き字・言葉の印など。取りのぞいて空なら通さない */
  /* 絵文字をつなぐ字（‍）・絵文字の形の印（︎・️）は絵文字の一部なので残す。ただしそれだけ（見える字が無い）なら空 */
  /* 2026-11-21 3 回目 L6: 競馬（v2/bet.js の cleanNick）と同じ 1 つの決まりにそろえた。U+0080〜U+009F の見えない制御文字（U+0085 など）も取りのぞく。
     結合文字（濁点・囲みの印など \p{M}）と絵文字をつなぐ字だけ（見える字が無い）なら空＝通さない */
  const INVIS = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0\ufff0-\ufffb]/g;
  const cleanNick = (s) => { const n = cutNick(String(s || '').normalize('NFKC').replace(INVIS, '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim()); return /[^\s\p{M}\u200d]/u.test(n) ? n : ''; };
  let memNick = ''; // 覚えの置き場が使えないブラウザ用（このページの間だけ）
  const savedNick = () => cleanNick(ls.get(NKEY) || memNick);
  /* このレースで投票した（しようとした）印（2026-11-20 C3・B1）: 印のあるレースだけ、開いたときに自分の票を読んでから画面を決める。印の無いスマホは読まない */
  let memMark = '';
  const mark = (id) => { memMark = id; ls.set(MKEY, id); };
  const unmark = () => { memMark = ''; ls.set(MKEY, ''); };
  const marked = (id) => !!id && (memMark === id || ls.get(MKEY) === id);

  const C = window.DerbyCloud.create({ role: 'phone', store: STORE, boat: true });
  const now = () => C.serverNow();
  /* S.known: 自分の票が分かっているレースの id／S.pend: 届いたか分からない投票（確かめ中）／S.ver: 自分の票の中身の版（読み取りより新しい中身が入ったら増える）／S.send: 送信の番号（レースが変わったら増やして古い返事を捨てる） */
  const S = { live: null, race: null, mine: null, bpt: null, bptWk: null, f: null, s: null, qty: 1, cart: [], mode: 'buy', screen: 'boot', thanks: false, busy: false, pend: null, err: '', stores: {}, minefor: '', known: '', donefor: '', doneAsk: '', noderby: '', dvSig: '', scanMiss: '', gotLive: false, slow: false, ver: 0, send: 0, introPage: 0, introAgain: false, online: true, pre: null };

  /* ---------- 表示の部品 ---------- */
  const boats = () => (S.race && S.race.boats) || [];
  const boatOf = (i) => boats()[i] || { no: i + 1, name: '', color: '#888', ink: '#fff' };
  const waku = (i, cls) => { const b = boatOf(i); return '<span class="waku' + (cls ? ' ' + cls : '') + '" style="background:' + b.color + ';color:' + b.ink + '">' + (i + 1) + '</span>'; }; // 競馬の bet.css の .waku（艇の色）
  const odds = (k) => { const o = S.race && S.race.exacta && S.race.exacta[k]; return o ? (Math.round(o * 10) / 10).toFixed(1) : '—'; };
  const payOf = (k) => { const o = S.race && S.race.exacta && Number(S.race.exacta[k]); if (!(o > 0)) return 0; const t = Math.max(10, Math.round(o * 10)); return Math.ceil(t / 10 - 1e-9) * 100; };
  const hm = (ms) => Core.fmtBizTime(ms, 5);
  const left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), p2 = (n) => String(n).padStart(2, '0'); return s >= 3600 ? Math.floor(s / 3600) + ':' + p2(Math.floor(s / 60) % 60) + ':' + p2(s % 60) : Math.floor(s / 60) + ':' + p2(s % 60); }; // 1 時間以上は 2:10:00（2026-11-21 H3）
  const dash = (n, w) => { const s = String(n); return '◆'.repeat(Math.max(0, w - s.length)) + s; }; // 本物の券の「◆◆◆100」（桁を◆で埋める）
  const storeName = (id) => S.stores[id] || id || '';
  /* 知らせ。o.ms: 出す長さ（既定 2.6 秒）・o.btn: [文, data-act] のボタン（前のレースの結果を見る入口。2026-11-21 H4） */
  function toast(t, o) {
    o = o || {}; const e = $('toast');
    if (o.btn) e.innerHTML = '<span>' + esc(t) + '</span><button type="button" class="tbtn" data-act="' + o.btn[1] + '">' + esc(o.btn[0]) + '</button>'; else e.textContent = t;
    e.classList.toggle('act', !!o.btn); e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), o.ms || 2600);
  }

  // 上の帯
  function chip() { // 上の帯の右（競馬と同じ「締切まで 2:35」の 1 つだけ）
    const r = S.race, t = now(), st = r ? Boat.stageOf(r, t) : 'none', box = $('raceChip');
    const one = (h) => { if (box.innerHTML !== h) box.innerHTML = h; };
    if (!r || st === 'over' || st === 'none') { const n = S.live && S.live.next; return one(n ? '<span>次 <b>' + hm(n.at) + '</b></span>' : ''); }
    if (st === 'wait') return one('<span>投票まで <b>' + left(r.openAt - t) + '</b></span>');
    if (st === 'vote') return one('<span class="' + (r.closeAt - t <= 30000 ? 'hot' : '') + '">締切まで <b>' + left(r.closeAt - t) + '</b></span>');
    if (st === 'closed' || st === 'film') return one('<span class="hot">レース中</span>');
    if (st === 'result') return one('<span>結果</span>');
    return one('<span>取り消し</span>');
  }

  /* 舟券の形（本物の券の並び。研究 26 の「casa の画面に写すときの要点」1〜6）。tickets: [{ k: 'a-b', free, n }] */
  function ticketsOfMine(v) {
    if (!v) return [];
    const out = [{ k: v.first + '-' + v.second, free: true, n: 1 }];
    const by = v.bets || {}; Object.keys(by).forEach((k) => { if (by[k] > 0) out.push({ k, free: false, n: by[k] }); });
    return out;
  }
  function serial(v) { const s = String((v && (v.id || v.raceId + v.votedAt)) || ''); let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return String(h % 100000000).padStart(8, '0'); }
  function barcode(sn) { let x = Number(sn) || 1, out = ''; for (let i = 0; i < 46; i++) { x = (x * 1103515245 + 12345) % 2147483648; const w = 1 + (x % 3); out += '<i style="width:' + w + 'px;margin-right:' + (1 + ((x >> 3) % 2)) + 'px"></i>'; } return out; }
  function fune(v, o) {
    o = o || {}; const r = S.race, T = ticketsOfMine(v), d = new Date((r ? r.at : now()) + 9 * 3600000 - 5 * 3600000);
    const total = T.reduce((a, x) => a + x.n, 0), bptN = total - 1, sn = serial(v), res = r && r.result;
    if (res) T.sort((a, b) => (b.k === res.combo) - (a.k === res.combo)); // 結果のあとは当たりの組番を上に
    const rows = T.map((x) => {
      const p = x.k.split('-').map(Number), capB = !!(res && res.bptBack === true && !x.free), /* 上限のため BPT の券は全部返還（2026-11-20）: 当たりの組番でも「的中」ではなく「返還」 */ hit = !!(res && res.combo === x.k && !capB), inc = res && res.incident, back = capB || !!(inc && inc.refund && p.indexOf(inc.boat) >= 0);
      return '<div class="tk' + (hit ? ' hit' : '') + '"><div class="kumi"><span class="kn">' + waku(p[0], 'sm') + '<b class="ar">▶</b>' + waku(p[1], 'sm') + '</span>' + (x.free ? '<em class="fr">無料</em>' : '') + (hit ? '<em class="ht">的中</em>' : '') + (back ? '<em class="bk">返還</em>' : '') + '</div>' +
        '<div class="nm">' + (p[0] + 1) + '. ' + esc(boatOf(p[0]).name) + '<br>' + (p[1] + 1) + '. ' + esc(boatOf(p[1]).name) + '</div>' +
        '<div class="am">' + dash(x.n * 100, 6) + '<small>BPT</small></div></div>';
    }).join('');
    return '<div class="fune' + (o.cls ? ' ' + o.cls : '') + '" aria-label="舟券">' +
      '<div class="fl"><div class="brand">casa <b>BOAT</b></div><div class="shop">' + esc(storeName(v.storeId || STORE)) + '</div>' +
      '<div class="rno"><b>' + (r ? hm(r.at) : '') + '</b><small>レース</small></div><div class="dt">' + d.getUTCFullYear() + '.' + (d.getUTCMonth() + 1) + '.' + d.getUTCDate() + '</div></div>' +
      '<div class="fm"><span>2連単</span></div>' +
      '<div class="fr fx" data-scrollarea>' + rows + '</div>' +
      '<div class="fb"><span class="sum">合計' + dash(total, 3) + '枚 ' + dash(total * 100, 6) + '<small>BPT</small>' + (bptN >= 0 ? '<em>（うち無料 1 枚）</em>' : '') + '</span><span class="sn">' + sn.slice(0, 4) + '-' + sn.slice(4) + '</span><span class="bc" aria-hidden="true">' + barcode(sn) + '</span></div>' +
      '</div>';
  }

  /* 2026-11-19 オーナー「投票待ち画面、テレビ・スマホ共に終わってる。競馬の感じをかなり参考に」: 競馬のスマホ（v2/bet.js）と同じ作り・同じ部品（bet.css の .waitbox・.bt／.btr の表・.pickdock）。
     予想は競馬と同じ「出走表の行ごとに［1着］［2着（倍率）］を押す」形（本物の投票アプリの 2 連単の見方。マークカードの形はやめた）。色はボートの水色 */
  const TYPES = { nige: '逃げ', senko: 'まくり', sashi: '差し', oikomi: 'まくり差し' };
  const condOf = (i) => { const h = S.race && S.race.boats && S.race.boats[i]; return h && h.cond ? h.cond : ''; };
  function boatTable() {
    const k1 = S.f, step = k1 == null ? 1 : S.s == null ? 2 : 0;
    const rows = boats().map((b, i) => {
      const is1 = S.f === i, is2 = S.s === i, o = k1 != null && !is1 ? odds(k1 + '-' + i) : null;
      const sub = [b.cls, condOf(i), TYPES[b.type] || '', (b.past || []).length ? '近走 ' + (b.past || []).slice(0, 3).join('-') : ''].filter(Boolean).map((x) => '<span class="nw">' + esc(x) + '</span>').join('<i>・</i>');
      return '<div class="btr' + (is1 ? ' s1' : '') + (is2 ? ' s2' : '') + '" role="row">' + waku(i, 'lg') + '<span class="bn"><b>' + esc(b.name) + '</b><small>' + sub + '</small></span>' +
        '<button type="button" class="pk k1' + (is1 ? ' on' : '') + '" data-f="' + i + '" aria-pressed="' + is1 + '">' + (is1 ? '<span class="ck" aria-hidden="true">✓</span><b>1着</b>' : '1着') + '</button>' +
        '<button type="button" class="pk k2' + (is2 ? ' on' : '') + (o != null ? ' od' : '') + '" data-s="' + i + '"' + (k1 == null || is1 ? ' disabled' : '') + ' aria-pressed="' + is2 + '">' + (is2 ? '<span class="ck" aria-hidden="true">✓</span>' : '') + (o != null ? '<b>' + o + '</b><i>倍</i>' : is1 ? '<small>1着</small>' : '2着') + '</button></div>';
    }).join('');
    return '<div class="bt step' + step + '" role="table" aria-label="2連単 1着と2着をえらぶ"><div class="bth" role="row"><span>艇番</span><span>選手</span><span class="c' + (step === 1 ? ' now' : '') + '">1着</span><span class="c' + (step === 2 ? ' now' : '') + '">2着' + (k1 != null ? '<small>の倍率</small>' : '') + '</span></div>' + rows + '</div>';
  }
  const myVote = () => (S.mine && S.mine.vote) || null;
  const hasFree = () => !!myVote();
  const freeInCart = () => S.cart.some((x) => x.free);
  const comboTx = (k) => { const p = String(k).split('-').map(Number); return (p[0] + 1) + '-' + (p[1] + 1); };
  /* 無料券がまだ無いのに BPT の券だけある（下の帯で無料券だけ消した）→ 先頭の券の 1 枚を無料券にする（無料の 1 票を使わずに BPT を払わせない・無料券なしでは投票できない。2026-11-20 B2） */
  function fixFree() {
    if (hasFree() || freeInCart() || !S.cart.length) return '';
    const x = S.cart[0]; if ((x.n || 1) > 1) { x.n -= 1; S.cart.unshift({ k: x.k, free: true }); } else { x.free = true; delete x.n; }
    return x.k;
  }
  /* えらんだ券をスマホに覚える（2026-11-20 B9）: QR を読み直した（新しいタブ）・競馬へ行って戻った・読み込み直したあとも続きから。いまのレースの分だけ（1 件）。投票が通ったら消す */
  function saveCart() {
    const r = S.race; if (!lsOk) return;
    if (!r || !S.cart.length) { if (ls.get(CKEY)) ls.set(CKEY, ''); return; }
    ls.set(CKEY, JSON.stringify({ id: r.id, cart: S.cart.map((x) => (x.free ? { k: x.k, free: true } : { k: x.k, n: x.n || 1 })) }));
  }
  function loadCart(r) {
    try { const x = JSON.parse(ls.get(CKEY) || 'null'); if (!r || !x || x.id !== r.id || !Array.isArray(x.cart)) return [];
      const out = []; x.cart.slice(0, 40).forEach((c) => { if (!c || Boat.ALL.indexOf(c.k) < 0) return; if (c.free) { if (!out.some((y) => y.free)) out.unshift({ k: c.k, free: true }); } else out.push({ k: c.k, free: false, n: Math.max(1, Math.min(9999, Math.floor(Number(c.n) || 1))) }); });
      return out;
    } catch (e) { return []; }
  }
  const cartSig = (L) => JSON.stringify((L || []).map((x) => [x.k, !!x.free, x.free ? 1 : x.n || 1]));
  /* 自分の券の結果（発表のあと）: 読み直しの前でも出せるよう手元で数える（v2/boat-core.js の voteView・refundOf と同じ数え方。読み直した票に won があればそれを使う）。
     返り値 { hit: 当たった券の枚数, won: 増える BPT, back: 返還 { n: BPT の券の枚数, bpt, free: 無料券も返還, cap?: 上限のための返還 } | null }
     2026-11-20: 結果に「BPT の券は返還」（result.bptBack。上限のため、そのレースの BPT の券を全部返還）と「払い戻しなし」（result.noPay。ごくまれ）の印が付く */
  /* 返還で実際に戻った BPT（2026-11-21 H8・J6: 3,000 を超える分は戻らない）。お金の係が票に書く実際の額があればそれ、無ければ予定の額（枚数 × 100） */
  const numOf = (n) => (typeof n === 'number' && isFinite(n) && n >= 0 ? n : null);
  function backGot(v) {
    const b = v && v.back; if (!b) return 0;
    return numOf(Number(b.bpt)) || 0; // 票の back.bpt ＝ 実際に戻った額（plan ＝ 予定の額・cut ＝ 上限で減った。ref/boat/opId_の使い方.md）
  }
  function resOf(v, r) {
    const res = r && r.result; if (!v || !res) return null;
    if (v.won != null) return { hit: v.hit || 0, won: Number(v.won) || 0, back: v.back ? Object.assign({}, v.back, { bpt: backGot(v) }) : null };
    const k = res.combo, bets = v.bets || {}, all = res.bptBack === true, inc = res.incident, hasInc = !!(inc && inc.refund);
    const hit = (v.first + '-' + v.second === k ? 1 : 0) + (all ? 0 : Number(bets[k]) || 0); // 上限のため BPT の券が全部返還のとき（bptBack）は、無料券だけ数える
    let bn = 0; Object.keys(bets).forEach((c) => { if (all || (hasInc && c.split('-').map(Number).indexOf(inc.boat) >= 0)) bn += Number(bets[c]) || 0; });
    const free = hasInc && (v.first === inc.boat || v.second === inc.boat), back = bn || free ? Object.assign({ n: bn, bpt: bn * 100, free }, all ? { cap: true } : {}) : null;
    return { hit, won: res.noPay === true ? 0 : hit * (Number(res.pay) || 0), back }; // noPay: 上限のため払い戻しなし
  }
  const gained = (r) => { const x = resOf(myVote(), r); return !!(x && (x.won > 0 || (x.back && x.back.bpt > 0))); }; // 発表で BPT が増えた（当たり・返還）
  // BPT の残りと、それを読んだ週（毎週月曜の朝 5 時にリセット。週が変わったら、開いたままの画面も 0 にする。2026-11-20 F17）
  function setBpt(b) { if (!b) return; S.bpt = b; S.bptWk = Core.bptWeek && C.synced !== false ? Core.bptWeek(now()) : null; }
  const cartN = () => S.cart.filter((x) => !x.free).reduce((a, x) => a + (x.n || 1), 0); // カートの BPT の券の枚数
  const bptLeft = () => { const bal = S.bpt ? S.bpt.bal || 0 : 0; return Math.max(0, Math.floor((bal - cartN() * 100) / 100)); }; // 上限なし（持っている BPT まで。2026-11-19）
  const bptRest = () => Math.max(0, (S.bpt ? S.bpt.bal || 0 : 0) - cartN() * 100); // カートの分を引いた BPT の残り（0 より下は出さない）
  /* BPT がカートの分より少なくなった（競馬で券を買って戻った・週が変わった。2026-11-21 H6）→ カートの BPT の券を後ろから減らして知らせる。送信中・確かめ中は触らない */
  function fitCart() {
    if (!S.bpt || S.busy || S.pend || !cartN()) return;
    const rt = S.race && retryOf(S.race.id); if (rt && rt.op) return; // まだ決着していない送信がある: 中身を変えない（同じ番号で押し直せるように。届いていたら settle がカートから引く。2026-11-21 3 回目 L2）
    let over = cartN() - Math.floor((S.bpt.bal || 0) / 100); if (over <= 0) return;
    const cut = over;
    for (let i = S.cart.length - 1; i >= 0 && over > 0; i--) { const x = S.cart[i]; if (x.free) continue; const n = x.n || 1, d = Math.min(n, over); over -= d; if (d >= n) S.cart.splice(i, 1); else x.n = n - d; }
    saveCart(); if (!S.cart.length && S.screen === 'confirm') S.screen = 'pick';
    toast('BPT の残りに合わせて、えらんだ券を ' + cut + ' 枚へらしました', { ms: 5000 });
  }
  function cartLine() { // えらんだ券（下の帯の上に 1 行・押すと消せる）
    if (!S.cart.length) return '';
    return '<div class="cartl" data-scrollarea>' + S.cart.map((x, i) => { const p = x.k.split('-').map(Number); return '<button type="button" class="cc" data-del="' + i + '" aria-label="取り消す">' + waku(p[0], 'sm') + '<i>→</i>' + waku(p[1], 'sm') + '<small>' + (x.free ? '無料' : '×' + (x.n || 1)) + '</small><em>×</em></button>'; }).join('') + '</div>';
  }

  /* ---------- 画面 ---------- */
  function scr(cls, html) { return '<div class="scr ' + cls + '">' + html + '</div>'; }
  function bptCard() {
    if (!S.bpt) return '';
    return '<div class="bptcard"><div class="bh"><span>あなたの BPT</span><b>' + amt(S.bpt.bal) + '</b></div><p>ボートの当たりで貯まります（' + amt(BPT_CAP) + ' BPT まで）。競馬の「追加の券」に 1 枚 100 BPT で使えます（毎週月曜の朝 5 時にリセット）</p></div>';
  }
  function howCard() {
    return '<div class="howcard"><div class="hw"><b>1</b><span><em>無料で 1 票</em>今日の競馬に参加したスマホなら、ボートも無料で 1 票</span></div><div class="hw"><b>2</b><span><em>1着と2着を順番に</em>6 艇から 2連単。BPT 100 で券を何枚でも追加</span></div><div class="hw"><b>3</b><span><em>当たりは BPT</em>この画面に自動で入ります（受け取りなし・' + amt(BPT_CAP) + ' BPT まで）</span></div></div>';
  }
  const bootMsg = () => '<p class="lead" role="status" data-wrap>' + (S.slow && !S.gotLive ? '通信に時間がかかっています。自動でつなぎ直しています' : '読み込み中…') + '</p>';
  function vBoot() { return scr('mid splash', bootMsg()); } // まだ「いまの状態」が届いていない
  function vLoad() { return scr('mid splash', '<p class="lead" role="status">読み込み中…</p>'); } // このレースで投票した印があるスマホ: 自分の票が届くまで（届く前に予想の画面に決めない。B1）
  const howBtn0 = '<button class="btn ghost howb" data-act="howto">あそびかた</button>';
  const howRow = () => S.prev && S.prev.race && S.prev.race.result ? '<div class="btnrow howr"><button class="btn ghost howb" data-act="prevres">前の結果</button>' + howBtn0 + '</div>' : howBtn0; // 前のレースの結果を見る入口（H4）
  /* 残りの時間は data-cd（その時刻）の付いた所だけ毎秒書き換える（画面全体は作り直さない。2026-11-20: 毎秒の作り直しで、押している途中のボタンが効かないことがあった） */
  const cd = (at, t) => ' data-cd="' + Math.round(at) + '">' + left(at - t);
  function vWait() {
    const r = S.race, n = S.live && S.live.next, t = now();
    const nx = r && Boat.stageOf(r, t) === 'wait' ? { at: r.at, openAt: r.openAt } : n;
    if (!nx) return scr('mid b-wait', '<div class="waitbox"><p class="wk">次のボートレース</p><p class="wv" data-wrap>いまはボートレースの時間ではありません</p></div>' + bptCard() + howCard());
    return scr('mid b-wait', '<div class="waitbox"><p class="wk">次のボートレース</p><p class="wt">' + hm(nx.at) + '<small>締切</small></p>' +
      '<div class="wr"><p class="wv">投票は ' + hm(nx.openAt) + ' から</p><div class="clock"><div class="k">始まりまで あと</div><div class="v"' + cd(nx.openAt, t) + '</div></div></div></div>' + bptCard() +
      '<p class="sub">投票が始まったら、お店のテレビの QR を読んでください（QR はレースごとに変わります）</p>' + howRow());
  }
  function vNoQr() { // 投票中・このレースの QR をまだ読んでいない
    const r = S.race, t = now(), miss = !S.err && r && S.scanMiss === r.id;
    return scr('mid b-noqr', '<div class="waitbox hot"><p class="wk">投票受付中</p><p class="wt">' + (r ? hm(r.at) : '') + '<small>締切</small></p><div class="wr"><p class="wv">締切まで</p><div class="clock"><div class="v"' + (r ? cd(r.closeAt, t) : '>') + '</div></div></div></div>' +
      '<div class="note qrnote"><b>テレビの QR を読んでください</b>ボートの投票はお店の中だけ。いまテレビに出ている QR を、スマホのカメラで読むと投票できます。</div>' +
      (S.err ? '<p class="err" data-wrap>' + esc(S.err) + '</p>' : miss ? '<p class="err" data-wrap>読んだ QR は、いまのレースのものではありません</p>' : '') + bptCard() + howRow());
  }
  function vClosed() { // 締切のあと・投票していない人（2026-11-20 B3: 「QR を読むと投票できます」は出さない・「締め切りました」は 1 回）
    const n = S.live && S.live.next;
    return scr('mid b-noqr', '<div class="waitbox"><p class="wk">締め切りました</p><p class="wv" data-wrap>' + (S.pend ? '投票が届いたか確かめています…' : '次のボートレースを待ってください') + '</p></div>' +
      (n ? '<p class="nextr">次のボートレース <b>' + hm(n.at) + '</b><br>（投票は ' + hm(n.openAt) + ' から）</p>' : '') + bptCard() + howRow());
  }
  function vNoDerby() { // 競馬に参加していない: 競馬に投票したら自動で投票に戻る（F10。えらんだ券はそのまま）
    return scr('mid b-noderby', '<div class="waitbox"><p class="wk">ボートの投票</p><p class="wv" data-wrap>今日の競馬に参加したスマホで投票できます</p></div><div class="note">ボートに投票できるのは、<b>今日の casa DERBY（競馬）に会計番号で投票したスマホ</b>だけです。競馬に投票すると、この画面は自動でボートの投票に戻ります' + (S.cart.length ? '（えらんだ券はそのまま）' : '') + '。</div><a class="btn ghost" href="bet.html?store=' + encodeURIComponent(STORE) + '">競馬の投票へ</a>');
  }
  function vNick() {
    return scr('b-nick', '<h1>ニックネーム</h1><p class="sub">当たったらテレビに出ます（競馬と同じ名前）</p><input id="nk" class="nkin" type="text" maxlength="40" autocomplete="off" autocapitalize="off" enterkeyhint="done" placeholder="8 文字まで" value="' + esc(savedNick()) + '"><div class="dock"><button class="btn" data-act="nick">決める</button></div>');
  }
  /* 初めての人への説明（2026-11-20 オーナー「競馬の初めての人への案内と同じ形で、絵つきで 3〜4 枚めくる」）: v2/intro.js（競馬）と同じ言い方・同じ絵の作り。4 枚をめくる。
     1 回だけ出す（casa.boat.intro）。あとで見返す入口は待ちの画面などの「あそびかた」（S.introAgain）。文言は ref/boat/説明の文言_2026-11-20.md と同じ */
  const INTRO = [
    { h: '無料で 1 票', p: '今日の競馬に会計番号で参加したスマホなら、ボートも無料で 1 票。',
      pic: '<svg viewBox="0 0 92 78" aria-hidden="true"><ellipse cx="46" cy="66" rx="30" ry="6" class="ln"/><g transform="translate(46 36)"><circle r="28" class="b2"/><circle r="23" class="b1"/><circle r="17" class="cr"/><text y="5" text-anchor="middle" font-size="13" font-weight="900" fill="#06233a" font-family="inherit">FREE</text></g></svg>' },
    { h: '1着と2着を、順番に当てる', p: '6 艇から、1着と2着になる艇を順番に選びます（2連単）。',
      pic: '<svg viewBox="0 0 92 78" aria-hidden="true"><rect x="2" y="12" width="88" height="54" rx="5" class="pp"/><rect x="2" y="12" width="8" height="54" rx="2" class="b1"/><text x="18" y="27" font-size="9" font-weight="900" fill="#14203a" font-family="inherit">1着</text><text x="60" y="27" font-size="9" font-weight="900" fill="#14203a" font-family="inherit">2着</text><rect x="18" y="32" width="24" height="24" rx="3" fill="#f4f4f4" stroke="#14203a"/><text x="30" y="50" text-anchor="middle" font-size="17" font-weight="900" fill="#111" font-family="inherit">1</text><path d="M46 44 h8 m-3 -4 l4 4 l-4 4" fill="none" stroke="#14203a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="60" y="32" width="24" height="24" rx="3" fill="#d6332b"/><text x="72" y="50" text-anchor="middle" font-size="17" font-weight="900" fill="#fff" font-family="inherit">3</text></svg>' },
    { h: '当たりは BPT', p: '当たると 100 BPT × 倍率の BPT がこのスマホに入ります（貯められるのは ' + amt(BPT_CAP) + ' BPT まで）。受け取りの手続きはいりません。',
      pic: '<svg viewBox="0 0 92 78" aria-hidden="true"><rect x="8" y="6" width="34" height="66" rx="6" class="ink"/><rect x="11" y="11" width="28" height="56" rx="3" class="bg"/><text x="25" y="44" text-anchor="middle" font-size="9" font-weight="900" fill="#8fdcff" font-family="inherit">+BPT</text><path d="M48 40 h10 m-4 -5 l5 5 l-5 5" fill="none" stroke="#8fdcff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><g transform="translate(74 40)"><circle r="15" class="b2"/><circle r="12" class="b1"/><text y="4" text-anchor="middle" font-size="9" font-weight="900" fill="#06233a" font-family="inherit">BPT</text></g></svg>' },
    { h: 'BPT で競馬の券を足せる', p: '100 BPT で競馬の券を 1 枚足せます（1 レース 合わせて 5 枚まで）。BPT は毎週月曜の朝 5 時にリセット。',
      pic: '<svg viewBox="0 0 92 78" aria-hidden="true"><g transform="translate(18 40)"><circle r="15" class="b2"/><circle r="12" class="b1"/><text y="4" text-anchor="middle" font-size="9" font-weight="900" fill="#06233a" font-family="inherit">BPT</text></g><path d="M37 40 h10 m-4 -5 l5 5 l-5 5" fill="none" stroke="#ffd773" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="54" y="20" width="34" height="40" rx="4" class="pp"/><rect x="54" y="20" width="34" height="9" rx="3" fill="#c9a03e"/><text x="71" y="45" text-anchor="middle" font-size="9" font-weight="900" fill="#14203a" font-family="inherit">競馬</text><text x="71" y="55" text-anchor="middle" font-size="7" font-weight="900" fill="#14203a" font-family="inherit">追加の券</text></svg>' },
  ];
  function vIntro() {
    const k = Math.max(0, Math.min(INTRO.length - 1, S.introPage || 0)), c = INTRO[k], last = k === INTRO.length - 1;
    return scr('b-intro', '<div class="introh"><b>casa <i>BOAT</i></b><h1>casa BOAT のあそびかた</h1><p class="sub">' + (k + 1) + ' / ' + INTRO.length + '</p></div>' +
      '<div class="icard"><div class="ipic">' + c.pic + '</div><h2>' + esc(c.h) + '</h2><p data-wrap>' + esc(c.p) + '</p></div>' +
      '<div class="idots">' + INTRO.map((_, i) => '<i class="' + (i === k ? 'on' : '') + '"></i>').join('') + '</div>' +
      '<div class="btnrow">' + (k > 0 ? '<button class="btn ghost" data-act="introPrev">もどる</button>' : '') + '<button class="btn" data-act="' + (last ? 'intro' : 'introNext') + '">' + (last ? (S.introAgain ? 'とじる' : 'はじめる') : '次へ') + '</button></div>' +
      (S.introAgain ? '' : '<p class="sub">この案内は、次からは出ません（待ちの画面の「あそびかた」でいつでも見られます）</p>'));
  }
  function vPick() {
    const k = S.f != null && S.s != null ? S.f + '-' + S.s : null, change = S.mode === 'change';
    const needFree = !hasFree() && !freeInCart(), bl = bptLeft();
    const head = '<div class="pkh2"><h1>' + (change ? '組番を変える（無料券）' : needFree ? '2連単をえらぶ' : 'BPT で券を追加') + '</h1>' + (change || needFree ? '' : '<span class="bpts">BPT 残り <b>' + (S.bpt ? amt(bptRest()) : '…') + '</b></span>') + '</div>';
    let dock;
    if (!k) dock = '<p class="pdh">' + (S.f == null ? '1着の艇をえらんでください' : '2着の艇をえらんでください') + '</p>' + (S.cart.length && !change ? '<button class="btn" data-act="confirm">確認へ（' + (cartN() + (freeInCart() ? 1 : 0)) + '件）</button>' : hasFree() ? '<button class="btn ghost" data-act="back">もどる</button>' : '');
    else {
      const o = odds(k), q = Math.max(1, Math.min(S.qty || 1, Math.max(1, bl))), n = change || needFree ? 1 : q;
      /* 当たれば増える BPT は 3,000 までの空きで（2026-11-21 H7）: 空き ＝ 3,000 −（この券まで買ったあとの残り）。空きが足りないときは「上限」と分かる文 */
      const pay = payOf(k) * n, room = S.bpt ? Math.max(0, BPT_CAP - Math.max(0, bptRest() - (change || needFree ? 0 : n * 100))) : pay, gw = Math.min(pay, room);
      const pdw = !S.bpt || gw >= pay ? '<small>当たれば</small><span><b>' + amt(pay) + '</b> BPT</span>' : gw > 0 ? '<small>当たれば（上限まで）</small><span><b>' + amt(gw) + '</b> BPT</span>' : '<small>上限 ' + amt(BPT_CAP) + ' BPT</small><span>増えません</span>';
      const sel = '<div class="pdsel"><span class="pdc">' + waku(S.f, '') + '<i>→</i>' + waku(S.s, '') + '</span><span class="pdo"><b>' + o + '</b>倍</span><span class="pdw' + (gw < pay ? ' capw' : '') + '">' + pdw + '</span></div>';
      const qty = change || needFree || bl < 2 ? '' : '<div class="qty"><span>枚数</span><button class="qb" data-act="qm" aria-label="へらす">−</button><b>' + q + '</b><small>枚</small><button class="qb" data-act="qp" aria-label="ふやす">＋</button><button class="qb w" data-act="q10">+10</button></div>';
      const main = change ? '<button class="btn" data-act="change"' + (S.busy || S.pend ? ' disabled' : '') + '>' + (S.busy ? '送信中…' : S.pend ? '確かめ中…' : 'この組番に変える') + '</button>' : needFree ? '<button class="btn" data-act="add">この組番を無料券に</button>' : '<button class="btn" data-act="add"' + (bl > 0 ? '' : ' disabled') + '>' + (bl > 0 ? 'BPT ' + amt(q * 100) + ' で追加' : S.bpt ? 'BPT が足りません' : 'BPT を確かめています…') + '</button>';
      dock = sel + qty + (S.cart.length && !change ? '<div class="btnrow">' + main.replace('class="btn"', 'class="btn ghost"') + '<button class="btn" data-act="confirm">確認へ（' + (cartN() + (freeInCart() ? 1 : 0)) + '件）</button></div>' : main);
    }
    return scr('pickscr b-pick', head + '<div class="pkbody fx" data-scrollarea>' + boatTable() + '</div>' + (change ? '' : cartLine()) + (S.err ? '<p class="err" data-wrap>' + esc(S.err) + '</p>' : '') + '<div class="pickdock" aria-live="polite">' + dock + '</div>');
  }
  function vConfirm() {
    const rows = S.cart.map((x, i) => { const p = x.k.split('-').map(Number); return '<tr><td>' + (i + 1) + '</td><td>2連単</td><td class="kb">' + waku(p[0], 'sm') + '-' + waku(p[1], 'sm') + '</td><td class="n">' + odds(x.k) + '</td><td class="n">' + (x.free ? '無料' : amt((x.n || 1) * 100) + '<small>BPT</small>' + (x.n > 1 ? '<br><small>' + x.n + ' 枚</small>' : '')) + '</td></tr>'; }).join('');
    const nB = cartN(), nAll = nB + (freeInCart() ? 1 : 0), lock = S.busy || !!S.pend; // 送信中・届いたか確かめ中は、修正も投票もできない（B4・F3）
    return scr('b-confirm', '<h1>投票内容の確認</h1><div class="ctab fx" data-scrollarea><table><thead><tr><th>No</th><th>勝式</th><th>組番</th><th class="n">オッズ</th><th class="n">購入金額</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="csum"><div><span>合計ベット数</span><b>' + nAll + '</b>件</div><div><span>購入金額</span><b>' + amt(nB * 100) + '</b><small>BPT</small>' + (freeInCart() ? '<em>＋無料券 1 枚</em>' : '') + '</div>' + (nB ? '<div class="dim"><span>BPT 残り</span>' + amt((S.bpt ? S.bpt.bal : 0)) + ' → <b>' + amt(Math.max(0, (S.bpt ? S.bpt.bal : 0) - nB * 100)) + '</b></div>' : '') + '</div>' +
      (S.pend ? '<p class="sub" role="status" data-wrap>投票が届いたか確かめています…（電波が戻ると自動で確かめます）</p>' : '<p class="sub">オッズは締切のあとに少し変わることがあります</p>') + (S.err ? '<p class="err" data-wrap>' + esc(S.err) + '</p>' : '') +
      '<div class="btnrow"><button class="btn ghost" data-act="fix"' + (lock ? ' disabled' : '') + '>投票内容を修正する</button><button class="btn" data-act="vote"' + (lock ? ' disabled' : '') + '>' + (S.busy ? '送信中…' : S.pend ? '確かめ中…' : '投票する') + '</button></div>');
  }
  function vVoted() {
    const r = S.race, t = now(), v = myVote(), bl = S.bpt ? Math.floor((S.bpt.bal || 0) / 100) : 0;
    return scr('b-voted', '<div class="vhead"><h1 class="done-h">' + (S.thanks ? '投票結果' : '投票済み') + '</h1><span class="cd">締切まで <b' + cd(r.closeAt, t) + '</b></span></div>' + (S.thanks ? '<p class="thx">ご投票ありがとうございました。</p>' : '') +
      fune(v) + '<p class="sub">締切までは無料券の組番を変えられます。BPT の券は足せますが、消せません</p>' +
      '<div class="btnrow"><button class="btn ghost" data-act="tochange">組番を変える</button><button class="btn ghost" data-act="tobuy"' + (bl > 0 ? '' : ' disabled') + '>BPT で券を足す' + (S.bpt ? '<small>あと ' + bl + ' 枚</small>' : '') + '</button></div>');
  }
  function vRace() {
    return scr('b-race', '<h1>テレビでレース中</h1><p class="sub">' + (S.pend ? '投票が届いたか確かめています…' : '結果はテレビとこの画面に出ます') + '</p>' + fune(myVote()));
  }
  function resLine(res) {
    const p = String((res && res.combo) || '').split('-').map(Number), ok = p.length === 2 && p.every((i) => i >= 0 && i < 6), od = Number(res && res.odds); // 結果の中身が欠けても落ちない（2026-11-21 J16）
    return '<div class="resl"><span>2連単</span>' + (ok ? waku(p[0]) + '<b class="hy">-</b>' + waku(p[1]) : '<b class="hy">—</b>') + (res && res.noPay === true ? '<span class="po">払い戻しなし</span>' : '<span class="po">払戻 <b>' + amt(res && res.pay) + '</b><small>BPT</small></span>') + (od > 0 ? '<span class="pn">' + (Math.round(od * 10) / 10).toFixed(1) + '倍</span>' : '') + '</div>';
  }
  /* 当たりで実際に増えた BPT（2026-11-20 オーナー決定「BPT は 3,000 まで」）: { real: 当たりで実際に増えた BPT, capped: 上限で止まった } | null（止まっていない・分からない＝今までどおり）
     ① 票に付く印（発表のあとに読み直した自分の票。v2/boat-core.js の voteView: won ＝ 当たりの額・gain ＝ 実際に増えた分・capped ＝ 上限で止まった。置き場の票そのものは got）
     ② 印が無いときは手元で: 発表の前の残り（S.pre）と、読み直した残り（読み直す前は見込み）を見比べる。3,000 に届いていて、増えた分が当たり＋返還より少なければ止まっている */
  function capInfo(v, r, x) {
    if (!v || !x || !(x.won > 0)) return null;
    const backB = x.back ? x.back.bpt || 0 : 0, due = x.won + backB;
    /* 2026-11-21 J16: 内訳はお金の係が票に書いた値（gain・got・capped）だけを使う（残りの差から推測しない）。
       読み直す前（票に won が無い＝手元で数えた）で、上限に届くかもしれないときは額を「…」（real: null） */
    if (v.won != null) {
      const got = [v.gain, v.got].map(numOf).find((n) => n != null);
      if (v.capped === true || (got != null && got < x.won)) return { real: got != null ? Math.min(got, x.won) : null, capped: true };
      return null; // 全部入っている
    }
    const pre = S.pre && S.pre.id === r.id && typeof S.pre.bal === 'number' ? S.pre.bal : S.bpt ? S.bpt.bal : null;
    if (pre != null && pre + due > BPT_CAP) return { real: null, capped: false, unknown: true };
    return null;
  }
  function vResult() {
    const r = S.race, res = r.result, v = myVote();
    if (!res) return scr('mid b-race', '<h1>結果を待っています</h1>' + (v ? fune(v) : ''));
    const x = resOf(v, r), won = !!(x && x.won > 0), n = S.live && S.live.next;
    const next = n ? '<p class="nextr">次のボートレース <b>' + hm(n.at) + '</b><br>（投票は ' + hm(n.openAt) + ' から）</p>' : '';
    const bk = x && x.back, inc = res.incident, incBpt = bk && !bk.cap ? bk.n : 0; // フライング・転覆で返還の BPT の券（上限のための返還は下の行に出す）
    const incLine = inc ? '<p class="incl">' + waku(inc.boat, 'sm') + ' ' + (inc.type === 'scratch' ? 'フライング' : '転覆') + '・' + (inc.refund ? 'この艇を含む券は返還' + (bk && (incBpt || bk.free) ? '（あなた: ' + (incBpt ? '＋' + amt(bk.bpt) + ' BPT 戻し' : '') + (bk.free ? (incBpt ? '・' : '') + '無料券は返還' : '') + '）' : '') : '返還なし') + '</p>' : '';
    /* 2026-11-20: 上限のため、このレースの BPT の券を全部返還にした（result.bptBack）／上限のため払い戻しなし（result.noPay。ごくまれ） */
    const capLine = (res.bptBack === true ? '<p class="incl capl">上限のため BPT の券は返還' + (bk && bk.cap && bk.n ? ' <b>＋' + amt(bk.bpt) + ' BPT</b>' : '') + '</p>' : '') + (res.noPay === true ? '<p class="incl capl">上限のため、このレースは払い戻しなし</p>' : '');
    const fresh = !!S.bpt && (S.donefor === r.id || !(won || (bk && bk.bpt > 0))); // BPT の残りは、当たり・返還のあとに読み直した数だけ出す（読み直す前の古い数を出さない）
    const cp = won ? capInfo(v, r, x) : null; // 上限（3,000 BPT）で止まった: 実際に増えた分と「上限 3,000 BPT」を出す
    /* 2026-11-21 H7: 上限で 1 BPT も増えなかったときは「おめでとう ＋0」と出さず「的中しましたが、上限 3,000 BPT のため BPT は増えません」。読み直す前で上限に届くかもしれないときは額を「…」 */
    const zero = !!(cp && cp.capped && cp.real === 0);
    const gainH = zero ? '<p class="hitmsg">的中しました</p><div class="gain zero"><em>上限 ' + amt(BPT_CAP) + ' BPT のため BPT は増えません</em></div>'
      : '<p class="hitmsg">的中ベットがありました。<br>おめでとうございます！</p><div class="gain">＋<b>' + (cp && cp.real == null ? '…' : amt(cp && cp.real != null ? cp.real : x.won)) + '</b><small>BPT</small>' + (cp && cp.capped ? '<em>上限 ' + amt(BPT_CAP) + ' BPT で止まりました</em>' : '') + '</div>';
    if (won) return scr('b-result win', gainH + resLine(res) + incLine + capLine + fune(v, { cls: 'small' }) +
      '<p class="bnote">BPT 残り <b>' + (fresh ? amt(S.bpt.bal) : '…') + '</b><small>（持てるのは ' + amt(BPT_CAP) + ' BPT まで）</small><span class="bn2"><br>この BPT で競馬の券を足せます（100 BPT で 1 枚）</span></p><a class="btn tokeiba" href="bet.html?store=' + encodeURIComponent(STORE) + '">競馬の投票へ（BPT で券を足す）</a>' + next);
    const lead = !v ? '' : x && x.hit > 0 && res.noPay === true ? '的中（上限のため払い戻しなし）' : bk && bk.n && !(bk.bpt > 0) && v.won != null ? '返還（上限 ' + amt(BPT_CAP) + ' BPT のため BPT は増えません）' : bk && bk.n ? '返還 ＋' + amt(bk.bpt) + ' BPT' + (fresh ? '（BPT 残り ' + amt(S.bpt.bal) + '）' : '') : bk && bk.free && !v.n ? '無料券は返還（はずれではありません）' : '今回ははずれ';
    return scr('b-result lose', '<h1>結果</h1>' + resLine(res) + incLine + capLine + (v ? fune(v, { cls: 'small' }) + '<p class="lead">' + lead + '</p>' : '') + next);
  }
  /* 取り消し（2026-11-21: 戻る BPT も 3,000 まで。実際に戻った額を出す。お金の係が票に書く額があればそれ、無ければ枚数 × 100） */
  function vPrev() { // 前のレースの結果（「前の結果を見る」。H4）: 今の画面の中身を前のレースに一時的に入れ替えて、結果画面と同じ作りで出す
    const keep = [S.race, S.mine, S.donefor]; let h = '';
    try { S.race = S.prev.race; S.mine = { vote: S.prev.vote, bpt: S.bpt }; S.donefor = S.prev.race.id; h = vResult(); } finally { S.race = keep[0]; S.mine = keep[1]; S.donefor = keep[2]; }
    return h.replace(/<a class="btn tokeiba"[^>]*>[^<]*<\/a>/, '').replace(/<\/div>$/, '<button class="btn ghost" data-act="prevclose">とじる</button></div>').replace('class="scr ', 'class="scr b-prev ');
  }
  function vVoid() {
    // 実際に戻った額は票の voidBack.bpt（ref/boat/opId_の使い方.md。戻し終わる前は無い）
    const v = myVote(), n = v ? Number(v.n) || 0 : 0, real = v && v.voidBack ? numOf(Number(v.voidBack.bpt)) : null;
    const msg = !n ? 'BPT の券はありませんでした。' : real == null ? 'BPT の券に使った BPT を戻します（持てるのは ' + amt(BPT_CAP) + ' BPT まで）。' : real >= n * 100 && !v.voidBack.cut ? 'BPT の券に使った ' + amt(real) + ' BPT を戻しました。' : '戻した BPT は ' + amt(real) + ' BPT です（持てるのは ' + amt(BPT_CAP) + ' BPT まで）。';
    return scr('mid b-void', '<h1>このレースは取り消しました</h1><div class="note">' + (v ? msg : 'BPT の券に使った BPT は戻しました（持てるのは ' + amt(BPT_CAP) + ' BPT まで）。') + '</div>');
  }

  /* ---------- いまの画面を決める ---------- */
  /* このレースで自分の票を読む必要があるか（2026-11-20 C3）: このレースで投票した（しようとした）印がある・覚えの置き場が使えない。どちらでもないスマホは読まない
     （印は送る前に付けるので、印が無い ＝ まだ投票していない。QR を読んだだけのスマホは BPT の残りだけ読む＝loadBpt） */
  const needMine = (r) => !!r && (marked(r.id) || !lsOk);
  // 自分の票が分かっているか: 読んだ／印が無い（＝まだ投票していない）。印があるのに届いていない間は「読み込み中」
  const mineKnown = (r) => S.known === r.id || (lsOk && !marked(r.id));
  function decideScreen() {
    if (!S.gotLive) return 'boot';
    if (S.introAgain) return 'intro'; // 「あそびかた」で見返している間
    if (S.viewPrev && S.prev && S.prev.race && S.prev.race.result) return 'prev'; // 前のレースの結果を見ている間（H4）
    const r = S.race, t = now();
    if (!r) return 'wait';
    const st = Boat.stageOf(r, t), v = myVote();
    if (st === 'wait' || st === 'over' || st === 'none') return 'wait';
    if (st === 'void') return 'void';
    if (st === 'result') return 'result';
    if (st === 'vote' && S.sendCtx && S.sendCtx.id === r.id && (S.busy || S.pend)) return S.sendCtx.kind === 'change' ? 'pick' : 'confirm'; // 送信中・確かめ中は送った画面のまま「送信中…」（初めての 1 票も。2026-11-21 H5）
    if (!mineKnown(r)) return 'load';
    if (st === 'vote') {
      if (S.noderby === r.id) return 'noderby';
      if (!v && !keyFor(r.id)) return 'noqr';
      if (!savedNick() && !v) return 'nick';
      if (S.screen === 'confirm' && S.cart.length) return 'confirm';
      if (!v && !introSeen()) return 'intro';
      if (!v || S.screen === 'pick') return 'pick';
      return 'voted';
    }
    if (st === 'closed' || st === 'film') return v ? 'race' : 'closed';
    return 'wait';
  }
  /* 毎回の描く前に見るもの（通信なし）:
     ・場面が変わった（投票が始まった・締め切った・発表・次のレース）→ 開いたままの「あそびかた」を閉じる（B5）
     ・月曜の朝 5 時を過ぎた → 開いたままの画面の BPT を 0 に（F17。置き場の数も 0 になっている）
     ・「競馬に参加してください」の間に、このスマホに競馬の票が増えた → 自動で投票に戻る（F10） */
  let stKey = '';
  function tickState() {
    const r = S.race, t = now(), k = (r ? r.id : '') + ':' + (r ? Boat.stageOf(r, t) : 'none');
    if (k !== stKey) { stKey = k; if (S.introAgain) { S.introAgain = false; S.introPage = 0; } S.viewPrev = false; }
    if (S.bpt && Core.bptWeek && C.synced !== false) { const wk = Core.bptWeek(t); if (S.bptWk == null) S.bptWk = wk; else if (wk !== S.bptWk) { S.bpt = Object.assign({}, S.bpt, { bal: 0, left: 0 }); S.bptWk = wk; } }
    fitCart(); // BPT が足りなくなったカート（H6）
    if (S.noderby && (!r || S.noderby !== r.id)) S.noderby = '';
    if (S.noderby && derbyVotes().join(',') !== S.dvSig) { S.noderby = ''; S.err = ''; S.screen = S.cart.length ? 'confirm' : 'pick'; }
  }
  const VIEW = { prev: vPrev, boot: vBoot, load: vLoad, wait: vWait, noqr: vNoQr, closed: vClosed, noderby: vNoDerby, nick: vNick, intro: vIntro, pick: vPick, confirm: vConfirm, voted: vVoted, race: vRace, result: vResult, void: vVoid };
  const cdKey = (h) => h.replace(/( data-cd="\d+"[^>]*>)[^<]*/g, '$1'); // 残りの時間の数字を除いた中身（これが同じなら数字だけ書き換える）
  let lastKey = '', edgeT = null;
  function draw() {
    tickState();
    const sc = decideScreen(); if (sc !== S.screen) { if (S.screen === 'voted' && sc !== 'voted') S.thanks = false; S.screen = sc; holdTaps(); }
    const html = (VIEW[sc] || vWait)(), key = cdKey(html), m = $('main');
    chip(); armEdge();
    if (key === lastKey) { // 中身は同じ: 残りの時間だけ
      const t = now(); Array.prototype.forEach.call(m.querySelectorAll('[data-cd]'), (e) => { const x = left(Number(e.dataset.cd) - t); if (e.textContent !== x) e.textContent = x; });
      return;
    }
    if (sc === 'nick' && document.activeElement && document.activeElement.id === 'nk') return; // 入力中は書き換えない
    const fxs = Array.prototype.map.call(m.querySelectorAll('.fx'), (e) => e.scrollTop);
    m.innerHTML = html; lastKey = key;
    Array.prototype.forEach.call(m.querySelectorAll('.fx'), (e, i) => { if (fxs[i]) e.scrollTop = fxs[i]; });
    $('app').classList.remove('booting');
    fitLevel();
  }
  // 場面の変わり目（投票の始まり・締切・映像・発表・終わり）ちょうどに描き直す（1 秒ごとの描き直しを待たない。2026-11-20 B3: 締切のあと 1 秒ほど「投票する」が押せた）
  function armEdge() {
    clearTimeout(edgeT); const r = S.race; if (!r) return;
    const t = now(), nx = [r.openAt, r.closeAt, r.runAt, r.revealAt, r.endAt].filter((x) => x > t).sort((a, b) => a - b)[0];
    if (nx && nx - t < 3600000) edgeT = setTimeout(() => { try { draw(); } catch (e) { console.error(e); } }, nx - t + 15);
  }
  function fitLevel() {
    const app = $('app'), m = $('main'); if (!m.firstElementChild) return;
    const over = () => m.scrollHeight > m.clientHeight + 1 || Array.prototype.some.call(m.querySelectorAll('.fx:not([data-long])'), (f) => f.scrollHeight > f.clientHeight + 1 && f.clientHeight < 40);
    app.classList.remove('os-t', 'os-s', 'os-xs');
    ['os-t', 'os-s', 'os-xs'].forEach((c) => { if (over()) app.classList.add(c); }); // 中身の送りの棒は幅を取らない（boat-bet.css で消してある）ので、詰めても幅は変わらない
  }

  /* ---------- 通信 ---------- */
  // 返事を待つのは ms まで（本番の置き場は、電波が切れると返事が来ないまま待ち続ける）。時間切れは code 'timeout'（e.late ＝ あとから届くかもしれない元の約束）
  function timed(p, ms) {
    return new Promise((res, rej) => {
      let end = false;
      const h = setTimeout(() => { if (end) return; end = true; const e = new Error('通信に時間がかかっています'); e.code = 'timeout'; e.late = p; rej(e); }, ms);
      Promise.resolve(p).then((v) => { if (end) return; end = true; clearTimeout(h); res(v); }, (e) => { if (end) return; end = true; clearTimeout(h); rej(e); });
    });
  }
  // 読んだ自分の票と BPT を画面に入れる
  function applyMine(x, id) {
    if (S.known === id && olderVote(x.vote, myVote())) x = Object.assign({}, x, { vote: myVote() }); // 今の票より古い読み取りは票に使わない（J11）
    S.mine = { vote: x.vote || null, bpt: x.bpt }; setBpt(x.bpt); S.known = id; S.ver++;
    if (x.vote) {
      mark(id);
      if (x.vote.won != null) S.donefor = id; // 発表のあとの中身（BPT も増えたあと）
      if (!S.busy && !S.pend && settle(x.vote, id).landed) { S.err = ''; toast('投票は届いていました'); } // 読み込み直す前に送った投票が届いていた: その券をカートから引く（2026-11-21 3 回目 L2）
      if (freeInCart()) { S.cart = S.cart.filter((c) => !c.free); saveCart(); } // 無料券はもう使ってある（覚えていた券に無料券が残っていた）
      if (S.screen === 'pick' && S.mode === 'buy' && !S.cart.length && S.f == null) S.screen = 'voted';
    }
  }
  /* 自分の票と BPT を読む。force: このレースでもう読んでいても読み直す。fresh: BPT も置き場から読み直す（本番の置き場は BPT を 60 秒手元に覚えている）
     ・読んでいる間にレースが変わった・もっと新しい読み取りを始めた → 捨てる
     ・読んでいる間に投票した・送信中 → 捨てる（投票の返事のほうが新しい。古い読み取りで上書きしない。F4）
     ・読めなかった → 要るときだけ、間をあけて読み直す */
  let mineSeq = 0, mineTry = 0, mineT = null;
  const wantMine = () => { const r = S.race; return !!r && ((needMine(r) && S.known !== r.id) || (r.status === 'done' && S.donefor !== r.id && gained(r))); };
  async function loadMine(force, fresh) {
    const r = S.race; if (!r) return;
    if (!force && S.minefor === r.id) return;
    S.minefor = r.id; clearTimeout(mineT);
    const id = r.id, ver = S.ver, seq = ++mineSeq;
    let x = null;
    try { x = await timed(C.myBoatVote(id, fresh ? { fresh: true } : undefined), 12000); } catch (e) { x = null; }
    if (!S.race || S.race.id !== id || seq !== mineSeq) return;
    if (!x) { S.minefor = ''; if (wantMine()) mineT = setTimeout(() => { if (S.race && S.race.id === id && wantMine() && !document.hidden) loadMine(true, fresh); }, Math.min(15000, 2000 * Math.pow(2, mineTry++))); return; }
    mineTry = 0;
    if (S.ver !== ver || S.busy || S.pend) return;
    applyMine(x, id); draw();
  }
  // BPT だけ読む（自分の票を読まないスマホの「あなたの BPT」・QR を読んだスマホの BPT の残り）。読んでいる間に投票の返事などもっと新しい中身が入ったら捨てる
  // 返事が来ないときは 12 秒で打ち切る（2026-11-21 J13: 打ち切りが無いと、返事が来ないまま二度と読み直せなかった）。force: 読んでいる途中でも読み直す（古い読み取りは捨てる）
  let bptBusy = false, bptSeq = 0, bptStale = false;
  function loadBpt(force) {
    if (!C.bptNow || (bptBusy && !force)) return; const ver = S.ver, seq = ++bptSeq; bptBusy = true;
    timed(C.bptNow(), 12000).then((b) => { if (seq !== bptSeq) return; bptBusy = false; if (!b || S.ver !== ver || S.busy || S.pend) return; setBpt({ bal: b.bal, cost: 100, left: 0 }); draw(); }, () => { if (seq === bptSeq) bptBusy = false; });
  }
  function onLive(live) {
    const first = !S.gotLive; S.gotLive = true; S.online = true;
    S.live = live || { race: null, next: null };
    const r = S.live.race || null, changed = !r || !S.race || r.id !== S.race.id;
    let prevHad = false;
    if (changed && S.race && !myVote()) { S.prev = null; S.viewPrev = false; prevTok++; } // 直前のレースに票が無い: 「前の結果」の入口は消す（2 レース前を残さない。2026-11-21 L5）
    /* 2026-11-20: 次のレースの投票が始まると、前の結果画面の途中でも切り替わる → 前の結果を知らせ、BPT は読み直す。
       2026-11-21 H4: 画面を消していて前のレースの発表を見ていない（結果がまだ手元に無い）ときは、前のレースの自分の票を 1 回だけ読んで知らせる。
       知らせは 8 秒・「前の結果を見る」ボタン付き（S.prev。待ちの画面などにも入口） */
    if (changed && S.race && myVote()) {
      prevHad = true; const old = S.race, ov = myVote();
      if (old.status === 'done' && old.result) prevShow(old, ov);
      else if (old.status === 'void' || old.refunded === true) prevShow(old, ov);
      else prevFetch(old);
    }
    if (changed) { // レースが変わった: 前のレースの中身・送信中の返事・読み取り・確かめを全部捨てる（F1）
      S.mine = null; S.cart = []; S.f = S.s = null; S.qty = 1; S.mode = 'buy'; S.minefor = ''; S.known = ''; S.donefor = ''; S.doneAsk = ''; S.err = ''; S.noderby = ''; S.thanks = false;
      if (S.busy || S.pend) bptStale = true; // 送信中・確かめ中のままレースが変わった: 使った BPT が分からない → 読み直す（2 回目の疑い）
      S.pend = null; S.sendCtx = null; clearTimeout(verT); clearTimeout(mineT); mineTry = 0; mineSeq++; S.send++; S.busy = false; S.ver++;
    }
    S.race = r;
    if (changed && r && lsOk) { const st = Boat.stageOf(r, now()); if (st === 'wait' || st === 'vote') S.cart = loadCart(r); else saveCart(); }
    if (first) { $('store').classList.remove('off'); if (bootHash && r && bootHash.raceId !== r.id && Boat.stageOf(r, now()) === 'vote') S.scanMiss = r.id; }
    if (r && needMine(r)) loadMine(false);
    else if (first || prevHad || bptStale || (r && !S.bpt && keyFor(r.id))) { bptStale = false; loadBpt(true); } // 開いたとき 1 回（＋ QR を読んだのに BPT がまだ分からないとき）
    if (r && r.status === 'done' && S.doneAsk !== r.id && S.donefor !== r.id && S.known === r.id && gained(r)) { S.doneAsk = r.id; S.pre = { id: r.id, bal: S.bpt ? S.bpt.bal : null }; loadMine(true, true); } // 発表: 当たり・返還のある人だけ読み直す（BPT が増えた）
    /* 取り消し: BPT の券を足していた人だけ読み直す（BPT が戻った）。戻し終えた合図（race.backDone。ref/boat/opId_の使い方.md）が来たら、まだ戻った額が無いときもう 1 回（2026-11-21 3 回目の疑い） */
    if (r && (r.status === 'void' || r.refunded === true) && S.known === r.id && myVote() && myVote().n > 0) {
      const bd = r.backDone === true, ak = r.id + (bd ? ':bd' : '');
      if (S.doneAsk !== ak && !(bd && myVote().voidBack)) { S.doneAsk = ak; loadMine(true, true); }
    }
    draw();
  }
  /* 前のレースの結果（2026-11-21 H4）: S.prev ＝ { race（結果つき）, vote（そのときの自分の票） }。S.viewPrev ＝ 前の結果を見ている */
  function prevLine(race, v) {
    if (race.status === 'void' || race.refunded === true) return '前のレースは取り消し' + (v && v.n > 0 ? '（BPT を戻しました）' : '');
    const x = resOf(v, race); if (!x) return '';
    if (x.won > 0) { const cp = capInfo(v, race, x); return cp && cp.capped && cp.real === 0 ? '前のレース: 的中（上限 ' + amt(BPT_CAP) + ' BPT のため増えません）' : '前のレース: 的中 ＋' + (cp && cp.real == null ? '…' : amt(cp && cp.real != null ? cp.real : x.won)) + ' BPT'; }
    if (x.hit > 0 && race.result && race.result.noPay === true) return '前のレース: 的中（上限のため払い戻しなし）';
    return '前のレース: ' + (x.back && x.back.bpt > 0 ? '返還 ＋' + amt(x.back.bpt) + ' BPT' : x.back && x.back.n ? '返還' : 'はずれ');
  }
  let prevTok = 0; // 前のレースが替わったら増える（読んでいる間に次のレースへ進んだら、古いレースを「前の結果」にしない。L5）
  function prevShow(race, v) {
    prevTok++; S.prev = { race, vote: v }; const t = prevLine(race, v);
    if (t) toast(t, { ms: 8000, btn: race.result ? ['前の結果を見る', 'prevres'] : null });
  }
  async function prevFetch(old) {
    const tok = ++prevTok; S.prev = null; // 読み終わるまでは前の前のレースの入口を出さない
    let x = null; try { x = await timed(C.myBoatVote(old.id, { fresh: true }), 12000); } catch (e) { x = null; }
    if (tok !== prevTok || !x || !x.vote || !x.race) return;
    const race = Object.assign({}, old, x.race, { boats: (x.race.boats && x.race.boats.length ? x.race.boats : old.boats) });
    if (race.status !== 'done' && race.status !== 'void' && race.refunded !== true) return; // まだ発表されていない（ふつうは無い）
    if (x.bpt && !S.busy && !S.pend) setBpt(x.bpt);
    prevShow(race, x.vote); draw();
  }
  /* 操作の番号（opId）の道具（2026-11-21 H1・J11・J12。置き場の側は ref/boat/opId_の使い方.md）
     ・newOp: 新しい番号／retryOf・setRetry: まだ決着していない送信（レース・種類・中身・番号）。スマホに覚える（読み込み直しても同じ番号で押し直せる）
     ・opsOf・deadOf・lastOpOf: 票に残った番号（ops ＝ 通った番号の一覧・dead ＝ 取り消した番号の一覧・op ＝ 最後の番号。一覧の無い古い置き場では null）
     ・olderVote(a, b): 票 a が票 b より古いか（BPT の券の枚数は減らない・更新の時刻があれば時刻で）
     2026-11-21 3 回目 L1・L2（opId_の使い方.md の「深夜の書き足し」）: 送った番号ごとに決着（ops ＝ 届いた・dead ＝ 取り消した）を見る。
       打ち切りのあと中身を変えて押し直すときは新しい番号にし、まだ決着していない前の番号を全部 prevOps に入れて送る（前のが届いていたら置き場は何も足さない＝prevLanded。
       届いていなければ置き場が前の番号を取り消す＝あとから届いても足さない）。届いた番号の券はカートから引く（読み込み直したあとも。fitCart で中身を変えない） */
  const RKEY = 'casa.boat.retry', PREV_MAX = 5;
  let memRetry = null;
  function newOp() { let r = ''; try { const a = new Uint32Array(3); crypto.getRandomValues(a); r = Array.from(a, (x) => x.toString(36)).join(''); } catch (e) { r = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); } return ('o' + Date.now().toString(36) + r).replace(/[^a-z0-9]/g, '').slice(0, 32); }
  /* 覚える中身: { id, kind, sig, op（押し直しで使い回す番号。無いときは null）, sent（その番号で送った券）, olds（それより前の、まだ決着していない番号 [{ op, kind, sent }]） } */
  const plainCart = (L) => (L || []).map((x) => (x.free ? { k: x.k, free: true } : { k: x.k, n: x.n || 1 }));
  function retryOf(id) {
    let x = memRetry; if (lsOk) { try { x = JSON.parse(ls.get(RKEY) || 'null'); } catch (e) { x = null; } }
    if (!x || x.id !== id) return null; x = Object.assign({ sent: [], olds: [] }, x); if (typeof x.op !== 'string') x.op = null; if (!Array.isArray(x.olds)) x.olds = [];
    x.olds = x.olds.filter((o) => o && typeof o.op === 'string');
    return x.op || x.olds.length ? x : null;
  }
  function setRetry(ctx) {
    const olds = ctx ? (ctx.olds || []).filter((o) => o && o.op).map((o) => ({ op: o.op, kind: o.kind, sent: plainCart(o.sent) })) : [];
    memRetry = ctx && (ctx.op || olds.length) ? { id: ctx.id, kind: ctx.kind, sig: ctx.op ? ctx.sig : '', op: ctx.op || null, sent: ctx.op ? plainCart(ctx.sent) : [], olds } : null;
    if (lsOk) ls.set(RKEY, memRetry ? JSON.stringify(memRetry) : '');
  }
  // この番号は決着した（返事が来た・はっきり断られた）: 使い回す番号から外し、まだ決着していない前の番号（olds）だけ残す
  function dropOp(ctx, keepOlds) { setRetry(keepOlds ? { id: ctx.id, kind: ctx.kind, op: null, olds: ctx.olds } : null); }
  /* 置き場が自分の番号を受け取っているか（返事の票の op が送った番号と同じだったことがある）。受け取らない古いつなぎ（番号を渡さない）では、置き場が別の番号を付けるので、番号では決めず枚数で */
  let opOkMem = false;
  const opWorks = () => opOkMem || ls.get('casa.boat.opok') === '1';
  function opSeen(ctx, v) { if (ctx && ctx.op && v && (lastOpOf(v) === ctx.op || (opsOf(v) || []).indexOf(ctx.op) >= 0) && !opWorks()) { opOkMem = true; ls.set('casa.boat.opok', '1'); } }
  const opsOf = (v) => { const L = v && (v.ops || v.opIds); return Array.isArray(L) ? L.map(String) : null; };
  const deadOf = (v) => (v && Array.isArray(v.dead) ? v.dead.map(String) : []);
  const lastOpOf = (v) => { const o = v && (v.op != null ? v.op : v.opId != null ? v.opId : v.lastOp); return o != null && o !== '' ? String(o) : null; };
  function olderVote(a, b) {
    if (!b) return false; if (!a) return true; // 票は消えない（同じレースで今の票があるのに「無い」は古い読み取り）
    if (a.raceId && b.raceId && a.raceId !== b.raceId) return false;
    const na = Number(a.n) || 0, nb = Number(b.n) || 0; if (na !== nb) return na < nb;
    const ta = Number(a.updatedAt) || 0, tb = Number(b.updatedAt) || 0; return !!(ta && tb && ta < tb);
  }
  // 届いた券をカートから引く（数で引く。読み込み直したあとのカートは別の入れ物なので、同じ物かでは見ない）
  function minusCart(sent) {
    (sent || []).forEach((x) => {
      if (x.free) { const i = S.cart.findIndex((c) => c.free); if (i >= 0) S.cart.splice(i, 1); return; }
      let left = x.n || 1;
      for (let i = S.cart.length - 1; i >= 0 && left > 0; i--) { const c = S.cart[i]; if (c.free || c.k !== x.k) continue; const n = c.n || 1, d = Math.min(n, left); left -= d; if (d >= n) S.cart.splice(i, 1); else c.n = n - d; }
    });
  }
  /* 読んだ票で、覚えている番号の決着を見る（L1・L2）。届いた番号の券はカートから引き、決着した番号は忘れる。返り値 { landed: 届いていた番号の数, cur: 使い回す番号が届いていた }。
     番号の一覧（ops）の無い古い置き場では何もしない（今までどおり verify の arrived で見る） */
  function settle(v, id) {
    const rt = retryOf(id), ops = opsOf(v); if (!rt || !v || !ops) return { landed: 0, cur: false };
    const dead = deadOf(v); let landed = 0, cur = false;
    const olds = rt.olds.filter((o) => { if (ops.indexOf(o.op) >= 0) { landed++; minusCart(o.sent); return false; } return dead.indexOf(o.op) < 0; });
    let op = rt.op;
    if (op && ops.indexOf(op) >= 0) { landed++; cur = true; minusCart(rt.sent); op = null; } else if (op && dead.indexOf(op) >= 0) op = null;
    if (cur) olds.length = 0; // 使い回す番号が通った ＝ そのとき前の番号は置き場が取り消している
    setRetry({ id, kind: rt.kind, sig: rt.sig, op, sent: rt.sent, olds });
    if (landed) { saveCart(); if (!S.cart.length && S.screen === 'confirm') S.screen = 'pick'; }
    return { landed, cur };
  }
  /* 投票（kind 'vote' ＝ カートの券）・無料券の組番を変える（kind 'change'）。
     返事が届いたとき、送ったときのレースのままなら入れる。レースが切り替わっていたら捨てる（S.send が変わっている。F1）。
     届いたか分からない失敗（電波切れ・返事なし・時間切れ）は、自分の票を読み直して確かめる（verify。F3） */
  async function send(kind) {
    if (S.busy || S.pend) return; const r = S.race; if (!r) return;
    if (r.status !== 'upcoming' || now() >= r.closeAt) { S.cart = []; saveCart(); S.f = S.s = null; S.mode = 'buy'; S.err = ''; toast('締め切りました'); return draw(); } // 締切のあとは送らない（B3）
    const v0 = myVote(), o = { raceId: r.id, dvs: derbyVotes() }; let sent = [];
    if (kind === 'change') { if (!v0 || S.f == null || S.s == null) return; o.nick = v0.nick; o.first = S.f; o.second = S.s; }
    else {
      if (!v0 && fixFree()) saveCart();
      sent = S.cart.slice(); if (!sent.length) return;
      const free = sent.find((x) => x.free), add = []; sent.forEach((x) => { if (!x.free) for (let i = 0; i < (x.n || 1); i++) add.push(x.k); });
      if (!v0 && !free) { S.err = '先に無料券の組番をえらんでください'; S.screen = 'pick'; return draw(); }
      o.code = keyFor(r.id); o.nick = savedNick() || (v0 && v0.nick); o.add = add;
      if (free) { const p = free.k.split('-').map(Number); o.first = p[0]; o.second = p[1]; }
    }
    /* 操作の番号（opId。2026-11-21 H1・J11）: 1 回の「投票する」に 1 つ。まだ決着していない送信と同じ中身の押し直しは、同じ番号（置き場が同じ番号を 2 回は数えない）。
       中身を変えたら新しい番号にして、まだ決着していない前の番号を prevOps に入れる（3 回目 L1） */
    const sig = kind + '|' + JSON.stringify([o.first, o.second, (o.add || []).slice().sort()]), rt = retryOf(r.id);
    const reused = !!(rt && rt.op && rt.kind === kind && rt.sig === sig); o.opId = reused ? rt.op : newOp();
    const olds = rt ? rt.olds.concat(rt.op && !reused ? [{ op: rt.op, kind: rt.kind, sent: rt.sent }] : []) : [];
    if (olds.length) o.prevOps = olds.slice(-PREV_MAX).map((x) => x.op);
    const ctx = { id: r.id, kind, sent, sig, op: o.opId, reused, olds, base: v0 ? { n: v0.n || 0, first: v0.first, second: v0.second } : null, addN: (o.add || []).length, want: o.first != null ? { first: o.first, second: o.second } : null, tries: 0, wasMarked: marked(r.id), checking: false };
    setRetry(ctx); // 返事が来るまでは「届いたか分からない」扱い（読み込み直しても同じ番号で押し直せる）
    const my = ++S.send; S.busy = true; S.sendCtx = ctx; S.err = ''; S.ver++; mark(r.id); draw();
    let x = null, err = null;
    try { x = await timed(C.boatVote(o), 20000); } catch (e) { err = e || new Error('送れませんでした'); }
    if (S.send !== my) return;
    S.busy = false;
    if (x) sendDone(ctx, x); else sendFail(ctx, err);
    draw();
  }
  function useVote(x) { if (x && !olderVote(x.vote, myVote())) { S.mine = { vote: x.vote || null, bpt: x.bpt }; setBpt(x.bpt); } } // 今の票より古い返事（遅れて届いた）は票の中身に使わない
  function sendDone(ctx, x) {
    S.pend = null; clearTimeout(verT); S.sendCtx = null; opSeen(ctx, x.vote);
    useVote(x); S.known = ctx.id; S.ver++; mark(ctx.id);
    if (x.vote && x.vote.won != null) S.donefor = ctx.id;
    /* 前の押し直しが届いていた（prevLanded）・この番号はもう取り消してあった（dead）: 今回は何も足されていない（3 回目 L1） */
    if (x.prevLanded || x.dead === true) {
      dropOp(ctx, true); settle(x.vote, ctx.id); S.err = '';
      if (x.prevLanded) toast('前の投票が届いていました。' + (S.cart.length ? '残りの券を確かめて、もう一度押してください' : ''), { ms: 6000 });
      else S.err = '送れませんでした。もう一度押してください';
      if (!S.cart.length) { S.f = S.s = null; S.mode = 'buy'; S.screen = 'voted'; } else S.screen = 'confirm';
      return;
    }
    setRetry(null); // この番号が通った ＝ 前の番号は置き場が取り消した（あとから届いても足さない）
    minusCart(ctx.sent); saveCart(); // 送った券だけカートから消す
    S.f = S.s = null; S.mode = 'buy'; S.qty = 1; S.err = '';
    if (ctx.kind === 'change') toast('組番を変えました'); else S.thanks = true;
    S.screen = 'voted';
  }
  function sendFail(ctx, e) {
    const c = e && e.code;
    if (!e || c === 'timeout' || c === 'network' || !e.status || e.status >= 500 || (c === 'denied' && ctx.op && ctx.reused)) { // 届いたか分からない → 確かめる（同じ番号の押し直しが断られた＝前の書き込みが届いていたかもしれない。opId_の使い方.md）
      S.pend = ctx; if (c === 'denied') ctx.denied = e;
      /* 打ち切ったあとに届いた返事: 確かめ中ならそれで済ませる。もう確かめが済んでいたら（中身を変えて押し直した・カートを触っている）、
         返事の票で番号の決着を見て、今の票より古くないときだけ入れる（古い返事で新しい票を上書きしない。J11）。送信中・確かめ中はその流れに任せる */
      if (e && e.late) e.late.then((x) => {
        if (!S.race || S.race.id !== ctx.id || !x) return;
        if (S.pend === ctx) sendDone(ctx, x);
        else if (!S.busy && !S.pend) {
          useVote(x); S.ver++;
          if (opsOf(x.vote)) { const st = settle(x.vote, ctx.id); if (st.landed) { S.err = ''; toast('投票は届いていました'); } }
          else { const rt = retryOf(ctx.id); if (rt && rt.op === ctx.op) setRetry(null); if (S.err && arrived(ctx, x.vote)) { S.err = ''; minusCart(ctx.sent); saveCart(); toast('投票は届いていました'); } }
        }
        draw();
      }, () => { if (!S.race || S.race.id !== ctx.id) return; if (S.pend === ctx) verify(); else if (!S.busy && !S.pend) loadMine(true, true); });
      verify(); return;
    }
    S.sendCtx = null; dropOp(ctx, true); // はっきり断られた（この番号は届いていない）: 次は新しい番号。前の決着していない番号は残す（次の押し直しで prevOps に）
    if (!ctx.wasMarked && !myVote()) unmark();
    errOf(e, ctx);
    if (S.race && S.known !== ctx.id && needMine(S.race)) loadMine(true, true);
  }
  // 送った票が届いていたか（読み直した自分の票 v と、送る前の中身を見比べる）
  function arrived(ctx, v) {
    if (!v) return false;
    /* 操作の番号で確かめる（2026-11-21 J12: 枚数だけで見ると、ほかのタブの追加を自分の成功と取り違える）。
       番号の一覧（ops）があればそれだけで決める（3 回目: vote.op === 自分の番号 では見ない。A のあとに B が通ると op は B）。番号の無い古い置き場だけ今までどおり */
    const ops = opsOf(v);
    if (ops && ctx.op) return ops.indexOf(ctx.op) >= 0;
    const lo = lastOpOf(v); if (lo && ctx.op) { if (lo === ctx.op) return true; if (opWorks()) return false; } // 番号が置き場まで届くと分かっている（前に返事の op が自分の番号だった）ときだけ「ちがう＝届いていない」と決める
    if (ctx.kind === 'change') return v.first === ctx.want.first && v.second === ctx.want.second;
    if (!ctx.base) return true; // 初めての 1 票: 票ができていれば届いている（無料券と BPT の券は 1 回の書き込み）
    if (ctx.addN > 0) return (v.n || 0) >= ctx.base.n + ctx.addN;
    return !!ctx.want && v.first === ctx.want.first && v.second === ctx.want.second;
  }
  let verT = null;
  async function verify() {
    const p = S.pend; if (!p || p.checking) return; clearTimeout(verT); p.checking = true; draw();
    let x = null;
    try { x = await timed(C.myBoatVote(p.id, { fresh: true }), 12000); } catch (e) { x = null; }
    if (S.pend !== p) return; // レースが変わった・返事が遅れて届いた
    p.checking = false;
    if (x && olderVote(x.vote, myVote())) x = { vote: myVote(), bpt: S.bpt }; // 読み取りが今の票より古い（ありえないはずの順の入れ替わり）: 今の票で判定
    if (!x) { verT = setTimeout(verify, Math.min(15000, 2000 * Math.pow(2, p.tries++))); return draw(); } // まだ読めない: 間をあけてもう一度（電波が戻ったとき・画面に戻ったときも）
    S.pend = null;
    if (arrived(p, x.vote)) { sendDone(p, x); if (p.kind !== 'change') toast('投票は届いていました'); }
    else {
      S.mine = { vote: x.vote || null, bpt: x.bpt }; setBpt(x.bpt); S.known = p.id; S.ver++; S.sendCtx = null;
      setRetry(p); // まだ届いていない: 同じ中身の押し直しは同じ番号（遅れて届いても 2 回は数えない。H1）
      const st = settle(x.vote, p.id); // 前の番号（prevOps）のどれかが届いていた → その券はカートから引く。取り消しずみの番号は忘れる（3 回目 L1）
      if (!x.vote && !p.wasMarked) unmark();
      const r = S.race;
      if (r.status !== 'upcoming' || now() >= r.closeAt) { S.cart = []; saveCart(); S.err = ''; setRetry(null); toast('締め切りました（投票は届いていません）'); }
      else if (p.denied) { dropOp(Object.assign({}, p, { olds: (retryOf(p.id) || { olds: [] }).olds }), true); errOf(p.denied, p); } // 断られていて、前の書き込みも届いていない: 断られた理由を出す（次は新しい番号）
      else if (st.landed) { S.err = ''; toast('前の投票が届いていました。' + (S.cart.length ? '残りの券を確かめて、もう一度押してください' : ''), { ms: 6000 }); if (!S.cart.length) { S.f = S.s = null; S.mode = 'buy'; S.screen = 'voted'; } }
      else S.err = '送れませんでした。もう一度押してください';
    }
    draw();
  }
  // はっきり断られたとき
  function errOf(e, ctx) {
    const c = e && e.code, r = S.race, first = !ctx.base;
    if (c === 'no_derby') { S.noderby = r.id; S.dvSig = derbyVotes().join(','); return; } // えらんだ券は残す（競馬に参加したら自動で戻る。F10）
    if (c === 'closed' || r.status !== 'upcoming' || now() >= r.closeAt) { S.cart = []; saveCart(); S.f = S.s = null; S.mode = 'buy'; S.err = ''; toast('締め切りました'); return; }
    if (c === 'bad_code' || (c === 'denied' && first)) { // 合言葉ちがい: QR を読み直してもらう。えらんだ券は消さない（B9）
      dropKey(r.id); S.err = (c === 'bad_code' ? 'QR の合言葉がちがいました。' : '投票できませんでした。') + 'テレビの QR を読み直すと、えらんだ券のまま投票できます'; return;
    }
    if (c === 'bad_nick') { ls.set(NKEY, ''); memNick = ''; toast('ニックネームを入れ直してください'); return; }
    if (c === 'denied') { S.err = 'BPT の券を追加できませんでした。BPT の残りを確かめてください'; loadMine(true, true); return; } // 投票済みの人（合言葉は要らない）が断られた ＝ BPT
    S.err = (e && e.message) || '送れませんでした。もう一度押してください';
    if (c === 'bad_pick') S.screen = 'pick';
    if (c === 'no_bpt' || c === 'too_many') { S.cart = S.cart.filter((x) => x.free); saveCart(); loadMine(true, true); }
  }
  /* 画面を消して戻った・電波が戻った（2026-11-20。競馬 v2/bet.js と同じ作法）: 時刻合わせと、自分の票・BPT の読み直しを 1 回だけ（5 秒に 1 回まで。合図が重なっても読み取りを増やさない）。
     確かめ待ちの投票があれば先に確かめる。ほかのタブで投票していたら、えらんだ券の覚えもそれに合わせる */
  let syncAt = -1e9;
  function resync() {
    if (S.pend) verify();
    const n = Date.now(); if (n - syncAt < 5000) return draw(); syncAt = n;
    if (C.syncClock) C.syncClock(1).then(() => draw(), () => {});
    const r = S.race;
    if (r && lsOk && !S.busy && !S.pend) { const L = loadCart(r); if (cartSig(L) !== cartSig(S.cart)) S.cart = L; }
    if (r && needMine(r)) { if (!S.busy && !S.pend) loadMine(true, true); } else if (S.gotLive) loadBpt();
    draw();
  }
  // 見張り（いまの状態）。画面を 1 分より長く消している間は止める（開きっぱなしのスマホの読み取りを減らす。戻ったらつなぎ直して最新を受け取る）
  let unWatch = null, hideT = null;
  function startWatch() { if (!unWatch) unWatch = C.boatWatch({ boat: onLive, error: () => {} }); }
  function stopWatch() { if (unWatch) { try { unWatch(); } catch (e) { /* noop */ } unWatch = null; } }

  /* ---------- 操作 ---------- */
  /* 指の早押しよけ（2026-11-21 H2・H9）: 画面が替わった直後と、画面・下の帯が替わるボタン（確認へ・投票する・組番を変える・この組番を無料券に など）を押した直後 0.4 秒は、
     指の押し（isTrusted）を受けない。2 回目の指が、同じ場所に出た次のボタン（「投票する」など）を押さないように。スクリプトの押し（試験の el.click()）には効かない */
  const HOLD_MS = 400, MOVE = ['add', 'confirm', 'fix', 'vote', 'tochange', 'tobuy', 'back', 'change', 'nick', 'intro', 'howto', 'prevres', 'prevclose'];
  let holdUntil = 0;
  function holdTaps() { holdUntil = Math.max(holdUntil, performance.now() + HOLD_MS); }
  let tapLock = 0, introAt = 0; // 画面が替わった直後の早押しが、次の画面のボタンを押さないように（B8）
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button,[data-act]'); if (!b || b.disabled) return;
    const a = b.dataset.act, tn = performance.now();
    if (tn < tapLock) return;
    if (ev.isTrusted && tn < holdUntil) return; // 指の早押し（H2・H9）
    if (MOVE.indexOf(a) >= 0 || b.dataset.del != null) holdTaps(); // カートの「×」も（2026-11-21 L4: 早押しで、詰まって同じ場所に来た次の券まで消えていた）
    const edit = b.dataset.f != null || b.dataset.s != null || b.dataset.del != null || ['add', 'qm', 'qp', 'q10', 'confirm', 'fix', 'vote', 'tochange', 'tobuy', 'back', 'change'].indexOf(a) >= 0;
    if ((S.busy || S.pend) && edit) return; // 送信中・届いたか確かめ中は券を動かさない（入れた券が黙って消えない。B4）
    if (b.dataset.f != null) { const i = Number(b.dataset.f); S.f = S.f === i ? null : i; if (S.s === S.f) S.s = null; S.qty = 1; S.err = ''; return draw(); } // 組番を選び直したら枚数は 1 に戻す（B6）
    if (b.dataset.s != null) { const i = Number(b.dataset.s); S.s = S.s === i ? null : i; S.qty = 1; S.err = ''; return draw(); }
    if (b.dataset.del != null) { S.cart.splice(Number(b.dataset.del), 1); const k = fixFree(); saveCart(); if (k) toast('無料券を ' + comboTx(k) + ' にしました'); if (!S.cart.length && S.screen === 'confirm') S.screen = 'pick'; return draw(); }
    if (a === 'introNext' || a === 'introPrev') { if (tn - introAt < 300) return; introAt = tn; S.introPage = Math.max(0, Math.min(INTRO.length - 1, (S.introPage || 0) + (a === 'introNext' ? 1 : -1))); return draw(); }
    if (a === 'intro') { if (tn - introAt < 300) return; introAt = tn; tapLock = tn + 300; const again = S.introAgain; if (!again) ls.set('casa.boat.intro', '1'); lastKey = ''; S.introPage = 0; S.introAgain = false; S.screen = again ? '' : 'pick'; return draw(); }
    if (a === 'prevres') { if (!S.prev || !S.prev.race || !S.prev.race.result) return; $('toast').classList.add('hidden'); S.viewPrev = true; S.introAgain = false; return draw(); }
    if (a === 'prevclose') { S.viewPrev = false; return draw(); }
    if (a === 'howto') { S.introAgain = true; S.introPage = 0; introAt = tn; return draw(); }
    if (a === 'nick') { const n = cleanNick(($('nk') || {}).value); if (!n) { toast('ニックネームは 1〜8 文字です'); return; } ls.set(NKEY, n); memNick = n; lastKey = ''; S.screen = 'pick'; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return draw(); }
    if (a === 'add') {
      if (S.f == null || S.s == null) return;
      const k = S.f + '-' + S.s;
      if (!hasFree() && !freeInCart()) S.cart.unshift({ k, free: true });
      else if (bptLeft() > 0) { const q = Math.max(1, Math.min(S.qty || 1, bptLeft())), have = S.cart.find((x) => !x.free && x.k === k); if (have) have.n = (have.n || 1) + q; else S.cart.push({ k, free: false, n: q }); }
      else { toast(S.bpt ? 'BPT が足りません' : 'BPT を確かめています…'); return; }
      S.f = S.s = null; S.qty = 1; saveCart(); return draw();
    }
    if (a === 'qm' || a === 'qp' || a === 'q10') { const L = bptLeft(); S.qty = Math.max(1, Math.min(L, (S.qty || 1) + (a === 'qm' ? -1 : a === 'qp' ? 1 : 10))); return draw(); }
    if (a === 'confirm') { if (!S.cart.length) return; if (fixFree()) saveCart(); S.err = ''; S.screen = 'confirm'; return draw(); }
    if (a === 'fix') { S.qty = 1; S.screen = 'pick'; return draw(); }
    if (a === 'vote') return send('vote');
    if (a === 'tochange') { const v = myVote(); if (!v) return; S.mode = 'change'; S.f = v.first; S.s = v.second; S.err = ''; S.screen = 'pick'; return draw(); }
    if (a === 'tobuy') { S.mode = 'buy'; S.f = S.s = null; S.qty = 1; S.err = ''; S.screen = 'pick'; return draw(); }
    if (a === 'back') { S.mode = 'buy'; S.f = S.s = null; S.qty = 1; S.cart = []; saveCart(); S.err = ''; S.screen = hasFree() ? 'voted' : 'pick'; return draw(); }
    if (a === 'change') return send('change');
  });
  // ニックネーム: 8 文字で止める（日本語の変換中は切らない）・Enter で決める
  // 半角カナの濁点（ｶﾞ ＝ 2 字）は先に全角（ガ ＝ 1 字）へまとめてから数える（濁点の途中で切らない。2026-11-21 H10）
  const nickCut = (ev) => { const i = ev.target; if (!i || i.id !== 'nk') return; let s = i.value; if (/[｡-ﾟ]/.test(s)) s = s.replace(/[｡-ﾟ]+/g, (m) => m.normalize('NFKC')); if (Array.from(s).length > MAX_NICK) s = cutNick(s); if (s !== i.value) i.value = s; };
  document.addEventListener('input', (ev) => { if (!ev.isComposing) nickCut(ev); });
  document.addEventListener('compositionend', nickCut);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.target && ev.target.id === 'nk') { const b = document.querySelector('[data-act="nick"]'); if (b) b.click(); } });
  // QR を読み直した（開いたまま # が変わる）: 合言葉を覚えて続きから。開いていた「あそびかた」は閉じる（B5）
  addEventListener('hashchange', () => {
    const h = readHash(); if (!h) return;
    S.noderby = ''; S.err = ''; S.introAgain = false; S.introPage = 0;
    const r = S.race; S.scanMiss = r && r.id !== h.raceId && Boat.stageOf(r, now()) === 'vote' ? r.id : '';
    if (r && r.id === h.raceId) { if (S.cart.length && S.screen !== 'pick') S.screen = 'confirm'; if (needMine(r)) loadMine(false); else if (!S.bpt) loadBpt(); }
    draw();
  });

  /* ---------- はじめ ---------- */
  // 店の名前: スマホに 1 日覚える（開くたびに店の一覧を読まない。2026-11-20 C5）
  function loadStores() {
    let c = null; try { c = JSON.parse(ls.get(SKEY) || 'null'); } catch (e) { c = null; }
    const ok = c && c.m && typeof c.m === 'object', show = () => { $('storeText').textContent = S.stores[STORE] || STORE; /* 競馬と同じく店の名前だけ */ };
    if (ok) { S.stores = c.m; show(); if (c.m[STORE] && Date.now() - c.at < 24 * 3600000 && c.at <= Date.now() + 60000) return; }
    C.stores().then((L) => { const m = {}; L.forEach((x) => { m[x.id] = x.name; }); S.stores = m; ls.set(SKEY, JSON.stringify({ at: Date.now(), m })); show(); lastKey = ''; if (S.gotLive) draw(); }, () => { if (!ok) $('storeText').textContent = S.gotLive ? STORE : 'つながりません'; });
  }
  (async () => {
    if (C.backend !== 'firestore' && C.syncClock) { try { await C.syncClock(3); } catch (e) { /* noop */ } setInterval(() => { if (!document.hidden) C.syncClock(3).then(() => draw(), () => {}); }, 60000); } // 模擬クラウドの時刻合わせ（Firestore 版はつなぐときに合わせる）
    if (!STORE) { $('main').innerHTML = scr('mid', '<h1>テレビの QR を読んでください</h1>'); $('app').classList.remove('booting'); return; }
    loadStores();
    startWatch(); // いまの状態は見張りで届く（別に読まない）。3 秒たっても届かないときだけ読みに行く（届くまで間をあけてくり返す）
    (function poll(n) { setTimeout(() => { if (S.gotLive) return; C.boatState().then((x) => { if (!S.gotLive) onLive(x.live); }, () => {}).then(() => { if (!S.gotLive) poll(n + 1); }); }, n ? Math.min(15000, 3000 * n) : 3000); })(0);
    setTimeout(() => { if (!S.gotLive) { S.slow = true; draw(); } }, 6000);
    setInterval(() => { if (document.hidden) return; try { draw(); } catch (e) { console.error(e); } }, 1000);
    addEventListener('resize', () => { lastKey = ''; draw(); });
    addEventListener('online', () => { $('net').classList.add('hidden'); resync(); });
    addEventListener('offline', () => $('net').classList.remove('hidden'));
    document.addEventListener('visibilitychange', () => {
      clearTimeout(hideT);
      if (document.hidden) { hideT = setTimeout(stopWatch, 60000); return; }
      startWatch(); resync();
    });
    addEventListener('pageshow', (ev) => { if (ev.persisted) { stopWatch(); startWatch(); resync(); } }); // 競馬のページから「戻る」で戻った
    addEventListener('storage', (ev) => { if (ev.key && ev.key.indexOf(VKEY) === 0) draw(); }); // ほかのタブで競馬に投票した（F10）
  })();
  window.BOATBET = { S, C, draw, dropKey, loadBpt /* 確かめ用（J13） */, cleanNick /* 確かめ用（H10） */, get screen() { return S.screen; } }; // 確かめ用（tests/boat-phone.plan.js・tests/boat-phone-bugs.plan.js。dropKey: 覚えた合言葉を忘れさせる）
})();
