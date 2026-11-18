/* casa BOAT のスマホの投票（2026-11-19）: v2/boat.html。決まりごとは v2/boat-core.js、つなぎ先は v2/client.js（模擬クラウド v2/boat-server.js・Firestore v2/boat-firestore.js）。
   画面と言葉は本物の舟券・公式のネット投票にそろえた（ref/boat/research/26_舟券と投票画面.md）:
     予想 … マークカードの 2 連単の欄（1着・2着の行に 1〜6）。組番は「1-4」（ハイフン）
     確認 … 「投票内容の確認」の表（No・勝式・組番・オッズ・購入金額）＋「合計ベット数」「購入金額」＋［投票内容を修正する］［投票する］
     投票後 … 「投票結果」「ご投票ありがとうございました。」＋舟券の形（左＝場名・発売所の帯・レース・日付／中央＝縦書きの「2連単」／右＝組番「1▶4」と選手名・金額「◆◆◆100」／下＝合計・通し番号・バーコード）
     当たり … 「的中ベットがありました。おめでとうございます！」＋額
   決まり: 2 連単だけ。無料の券 1 枚（締切まで組番を変えられる）＋ BPT 100 ごとに 1 枚（何通りにでも・同じ組番に重ねてもよい・1 レース 30 枚まで・足した券は消せない）。
   当たりは BPT（受け取りのスライドなし）。画面に「ポイント」と書かない（BPT と書く）。音は鳴らさない。
   1 画面に収める（v2/bet.css の土台・bet.html と同じ頭のスクリプト）。入らない画面だけ .os-t → .os-s → .os-xs と詰め、券の一覧（.fx）だけ中で動く。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const STORE = String(qs.get('s') || qs.get('store') || '').trim().toLowerCase();
  const Boat = window.BoatCore, Core = window.DerbyCore;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const NKEY = 'casa.derby.nick', VKEY = 'casa.derby.vote.', KKEY = 'casa.boat.key.';
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 覚えられない端末はこのページの間だけ */ } } };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } } };
  /* QR の合言葉: …/boat.html?s=<店>#<レース id>.<合言葉>。読んだらこのタブに覚え、住所からは消す（ほかの人に住所を送っても合言葉が付かない） */
  const memKey = {};
  { const h = Boat.parseHash(location.hash); if (h) { memKey[h.raceId] = h.code; ss.set(KKEY + h.raceId, h.code); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* noop */ } } }
  const keyFor = (id) => memKey[id] || ss.get(KKEY + id) || '';
  addEventListener('hashchange', () => { const h = Boat.parseHash(location.hash); if (!h) return; memKey[h.raceId] = h.code; ss.set(KKEY + h.raceId, h.code); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* noop */ } if (S.screen === 'noqr' || S.screen === 'noderby') S.screen = ''; S.err = ''; draw(); }); // 開いたまま QR を読み直した
  // その日に競馬へ参加した票の id（このスマホが覚えている競馬の票。新しい順）
  function derbyVotes() {
    const L = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(VKEY) === 0) { let v = null; try { v = JSON.parse(localStorage.getItem(k)); } catch (e) { v = null; } if (v && v.vid) L.push(v); } } } catch (e) { /* noop */ }
    return L.sort((a, b) => (b.at || 0) - (a.at || 0)).map((v) => v.vid).slice(0, 6);
  }
  const savedNick = () => { const n = String(ls.get(NKEY) || '').trim(); return n && Array.from(n).length <= 8 ? n : ''; };

  const C = window.DerbyCloud.create({ role: 'phone', store: STORE, boat: true });
  const now = () => C.serverNow();
  const S = { live: null, race: null, mine: null, bpt: null, f: null, s: null, cart: [], mode: 'buy', screen: 'boot', thanks: false, busy: false, err: '', note: '', stores: {}, minefor: '', donefor: '', online: true };

  /* ---------- 表示の部品 ---------- */
  const boats = () => (S.race && S.race.boats) || [];
  const boatOf = (i) => boats()[i] || { no: i + 1, name: '', color: '#888', ink: '#fff' };
  const waku = (i, cls) => { const b = boatOf(i); return '<i class="waku ' + (cls || '') + '" style="background:' + b.color + ';color:' + b.ink + '">' + (i + 1) + '</i>'; };
  const odds = (k) => { const o = S.race && S.race.exacta && S.race.exacta[k]; return o ? (Math.round(o * 10) / 10).toFixed(1) : '—'; };
  const payOf = (k) => { const o = S.race && S.race.exacta && Number(S.race.exacta[k]); if (!(o > 0)) return 0; const t = Math.max(10, Math.round(o * 10)); return Math.ceil(t / 10 - 1e-9) * 100; };
  const hm = (ms) => Core.fmtBizTime(ms, 5);
  const left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const dash = (n, w) => { const s = String(n); return '◆'.repeat(Math.max(0, w - s.length)) + s; }; // 本物の券の「◆◆◆100」（桁を◆で埋める）
  const storeName = (id) => S.stores[id] || id || '';
  function toast(t) { const e = $('toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), 2600); }

  // 上の帯
  function chip() {
    const r = S.race, t = now(), st = r ? Boat.stageOf(r, t) : 'none', box = $('raceChip');
    if (!r || st === 'over' || st === 'none') { const n = S.live && S.live.next; box.innerHTML = n ? '<span>次のボートレース <b>' + hm(n.at) + '</b></span>' : ''; return; }
    if (st === 'wait') box.innerHTML = '<span>' + hm(r.at) + ' 締切</span><span>投票 <b>' + hm(r.openAt) + '</b> から</span>';
    else if (st === 'vote') box.innerHTML = '<span>' + hm(r.at) + ' 締切</span><span class="hot">締切まで <b>' + left(r.closeAt - t) + '</b></span>';
    else if (st === 'closed' || st === 'film') box.innerHTML = '<span>' + hm(r.at) + '</span><span class="hot">テレビでレース中</span>';
    else if (st === 'result') box.innerHTML = '<span>' + hm(r.at) + '</span><span>結果</span>';
    else box.innerHTML = '<span>' + hm(r.at) + '</span><span>取り消し</span>';
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
      const p = x.k.split('-').map(Number), hit = res && res.combo === x.k, inc = res && res.incident, back = !!(inc && inc.refund && p.indexOf(inc.boat) >= 0);
      return '<div class="tk' + (hit ? ' hit' : '') + '"><div class="kumi">' + waku(p[0], 'sm') + '<b class="ar">▶</b>' + waku(p[1], 'sm') + (x.free ? '<em class="fr">無料</em>' : '') + (hit ? '<em class="ht">的中</em>' : '') + (back ? '<em class="bk">返還</em>' : '') + '</div>' +
        '<div class="nm">' + (p[0] + 1) + '. ' + esc(boatOf(p[0]).name) + '<br>' + (p[1] + 1) + '. ' + esc(boatOf(p[1]).name) + '</div>' +
        '<div class="am">' + dash(x.n * 100, 6) + '<small>BPT</small></div></div>';
    }).join('');
    return '<div class="fune' + (o.cls ? ' ' + o.cls : '') + '" aria-label="舟券">' +
      '<div class="fl"><div class="brand">casa <b>BOAT</b></div><div class="shop">' + esc(storeName(v.storeId || STORE)) + '</div>' +
      '<div class="rno"><b>' + (r ? hm(r.at) : '') + '</b><small>レース</small></div><div class="dt">' + d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日</div></div>' +
      '<div class="fm"><span>2連単</span></div>' +
      '<div class="fr fx" data-scrollarea>' + rows + '</div>' +
      '<div class="fb"><span class="sum">合計' + dash(total, 3) + '枚 ' + dash(total * 100, 6) + '<small>BPT</small>' + (bptN >= 0 ? '<em>（うち無料 1 枚）</em>' : '') + '</span><span class="sn">' + sn.slice(0, 4) + '-' + sn.slice(4) + '</span><span class="bc" aria-hidden="true">' + barcode(sn) + '</span></div>' +
      '</div>';
  }

  // マークカードの 2 連単の欄（1着・2着の行に 1〜6）
  function markCard() {
    const row = (lab, sel, other, key) => '<div class="mrow"><span class="ml">' + lab + '</span><div class="mb">' + [0, 1, 2, 3, 4, 5].map((i) => { const b = boatOf(i); return '<button class="bn' + (sel === i ? ' on' : '') + '" data-' + key + '="' + i + '"' + (other === i ? ' disabled' : '') + ' style="--c:' + b.color + ';--i:' + b.ink + '" aria-label="' + lab + ' ' + (i + 1) + '号艇 ' + esc(b.name) + '">' + (i + 1) + '</button>'; }).join('') + '</div></div>';
    return '<div class="mark">' + row('1着', S.f, S.s, 'f') + row('2着', S.s, S.f, 's') + '</div>';
  }
  function entryList() {
    return '<div class="ent">' + boats().map((b, i) => '<div class="er">' + waku(i) + '<span class="en">' + esc(b.name) + '</span><span class="ec">' + esc(b.cls || '') + '</span></div>').join('') + '</div>';
  }
  function selLine() {
    if (S.f == null || S.s == null) return '<div class="sel dim">1着と2着の艇番をえらんでください</div>';
    const k = S.f + '-' + S.s;
    return '<div class="sel">' + waku(S.f) + '<b class="hy">-</b>' + waku(S.s) + '<span class="so">2連単 <b>' + odds(k) + '</b><small>倍</small></span><span class="sp">当たれば <b>' + amt(payOf(k)) + '</b><small>BPT</small></span></div>';
  }
  const hasFree = () => !!(S.mine && S.mine.vote);
  const freeInCart = () => S.cart.some((x) => x.free);
  const cartN = () => S.cart.filter((x) => !x.free).reduce((a, x) => a + (x.n || 1), 0); // カートの BPT の券の枚数
  const bptLeft = () => { const bal = S.bpt ? S.bpt.bal || 0 : 0; return Math.max(0, Math.floor((bal - cartN() * 100) / 100)); }; // 上限なし（持っている BPT まで。2026-11-19）
  function cartList() {
    if (!S.cart.length) return '';
    return '<div class="cart fx" data-scrollarea>' + S.cart.map((x, i) => { const p = x.k.split('-').map(Number); return '<div class="ci">' + waku(p[0], 'sm') + '<b class="hy">-</b>' + waku(p[1], 'sm') + '<span class="co">' + odds(x.k) + '倍</span><span class="ca">' + (x.free ? '無料' : (x.n > 1 ? x.n + ' 枚 ' : '') + amt((x.n || 1) * 100) + ' BPT') + '</span><button class="cx" data-del="' + i + '" aria-label="取り消す">×</button></div>'; }).join('') + '</div>';
  }

  /* ---------- 画面 ---------- */
  function scr(cls, html) { return '<div class="scr ' + cls + '">' + html + '</div>'; }
  function vWait() {
    const r = S.race, n = S.live && S.live.next, t = now();
    if (r && Boat.stageOf(r, t) === 'wait') return scr('mid b-wait', '<h1>次のボートレース</h1><div class="waitbox"><div class="wk">締切</div><div class="wt">' + hm(r.at) + '</div><div class="wr"><p class="wv">投票は <b>' + hm(r.openAt) + '</b> から</p><div class="clock"><span class="k">あと</span><span class="v">' + left(r.openAt - t) + '</span></div></div></div><p class="sub">投票が始まったら、テレビの QR を読み直してください（QR はレースごとに変わります）</p>');
    return scr('mid b-wait', '<h1>casa BOAT</h1>' + (n ? '<div class="waitbox"><div class="wk">次のボートレース</div><div class="wt">' + hm(n.at) + '</div><div class="wr"><p class="wv">投票は <b>' + hm(n.openAt) + '</b> から</p></div></div>' : '<p class="lead">いまはボートレースの時間ではありません</p>') + '<p class="sub">投票はお店のテレビの QR から。QR はレースごとに変わります</p>');
  }
  function vNoQr(closed) {
    return scr('mid b-noqr', '<h1>' + (closed ? '締め切りました' : 'テレビの QR を読んでください') + '</h1><div class="note"><b>ボートの投票はお店の中だけ</b><br>いまテレビに出ている QR を読むと投票できます。QR はレースごとに変わります。</div>' + (S.err ? '<p class="err">' + esc(S.err) + '</p>' : ''));
  }
  function vNoDerby() {
    return scr('mid b-noderby', '<h1>今日の競馬に参加したスマホで</h1><div class="note">ボートに投票できるのは、<b>今日の casa DERBY（競馬）に会計番号で投票したスマホ</b>だけです。先に競馬に参加してから、もう一度テレビの QR を読んでください。</div><a class="btn ghost" href="bet.html?store=' + encodeURIComponent(STORE) + '">競馬の投票へ</a>');
  }
  function vNick() {
    return scr('b-nick', '<h1>ニックネーム</h1><p class="sub">当たったらテレビに出ます（競馬と同じ名前）</p><input id="nk" class="nkin" maxlength="8" autocomplete="off" placeholder="8 文字まで" value="' + esc(savedNick()) + '"><div class="dock"><button class="btn" data-act="nick">決める</button></div>');
  }
  function vPick() {
    const t = now(), r = S.race, k = S.f != null && S.s != null ? S.f + '-' + S.s : null, change = S.mode === 'change';
    const needFree = !hasFree() && !freeInCart(), bl = bptLeft();
    let head = '<div class="phead"><h1>' + (change ? '組番を変える（無料券）' : '2連単をえらぶ') + '</h1><span class="cd">締切まで <b>' + left(r.closeAt - t) + '</b></span></div>';
    let btns;
    if (change) btns = '<div class="btnrow"><button class="btn ghost" data-act="back">もどる</button><button class="btn" data-act="change"' + (k ? '' : ' disabled') + '>この組番に変える</button></div>';
    else {
      const q = Math.max(1, Math.min(S.qty || 1, Math.max(1, bl))), addLbl = needFree ? 'この組番を無料券に' : (q > 1 ? q + ' 枚' : 'BPT 100 で券を') + '追加';
      const addOk = k && (needFree || bl > 0);
      btns = '<div class="btnrow">' + (S.cart.length ? '<button class="btn ghost" data-act="add"' + (addOk ? '' : ' disabled') + '>' + addLbl + '</button><button class="btn" data-act="confirm">確認へ（' + (cartN() + (freeInCart() ? 1 : 0)) + '件）</button>' : (hasFree() ? '<button class="btn ghost" data-act="back">もどる</button>' : '') + '<button class="btn" data-act="add"' + (addOk ? '' : ' disabled') + '>' + addLbl + '</button>') + '</div>';
    }
    const qtyLine = change || needFree || bl < 2 ? '' : '<div class="qty"><span>BPT の券の枚数</span><button class="qb" data-act="qm" aria-label="へらす">−</button><b>' + Math.max(1, Math.min(S.qty || 1, bl)) + '</b><small>枚</small><button class="qb" data-act="qp" aria-label="ふやす">＋</button><button class="qb w" data-act="q10">+10</button></div>';
    const bptLine = change ? '' : '<p class="bptl">' + (S.bpt ? 'BPT 残り <b>' + amt(S.bpt.bal - S.cart.filter((x) => !x.free).length * 100) + '</b>' + (S.bpt.bal >= 100 ? '・あと <b>' + bl + '</b> 枚（1 枚 100 BPT）' : '（BPT はボートの当たりで貯まります）') : '') + '</p>';
    return scr('b-pick', head + entryList() + markCard() + selLine() + qtyLine + cartList() + bptLine + (S.err ? '<p class="err">' + esc(S.err) + '</p>' : '') + btns);
  }
  function vConfirm() {
    const rows = S.cart.map((x, i) => { const p = x.k.split('-').map(Number); return '<tr><td>' + (i + 1) + '</td><td>2連単</td><td class="kb">' + waku(p[0], 'sm') + '-' + waku(p[1], 'sm') + '</td><td class="n">' + odds(x.k) + '</td><td class="n">' + (x.free ? '無料' : amt((x.n || 1) * 100) + '<small>BPT</small>' + (x.n > 1 ? '<br><small>' + x.n + ' 枚</small>' : '')) + '</td></tr>'; }).join('');
    const nB = cartN(), nAll = nB + (freeInCart() ? 1 : 0);
    return scr('b-confirm', '<h1>投票内容の確認</h1><div class="ctab fx" data-scrollarea><table><thead><tr><th>No</th><th>勝式</th><th>組番</th><th class="n">オッズ</th><th class="n">購入金額</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="csum"><div><span>合計ベット数</span><b>' + nAll + '</b>件</div><div><span>購入金額</span><b>' + amt(nB * 100) + '</b><small>BPT</small>' + (freeInCart() ? '<em>＋無料券 1 枚</em>' : '') + '</div>' + (nB ? '<div class="dim"><span>BPT 残り</span>' + amt((S.bpt ? S.bpt.bal : 0)) + ' → <b>' + amt((S.bpt ? S.bpt.bal : 0) - nB * 100) + '</b></div>' : '') + '</div>' +
      '<p class="sub">オッズは締切のあとに少し変わることがあります</p>' + (S.err ? '<p class="err">' + esc(S.err) + '</p>' : '') +
      '<div class="btnrow"><button class="btn ghost" data-act="fix">投票内容を修正する</button><button class="btn" data-act="vote"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '送信中…' : '投票する') + '</button></div>');
  }
  function vVoted() {
    const r = S.race, t = now(), v = S.mine.vote, bl = S.bpt ? Math.floor((S.bpt.bal || 0) / 100) : 0;
    return scr('b-voted', '<div class="vhead"><h1 class="done-h">' + (S.thanks ? '投票結果' : '投票済み') + '</h1><span class="cd">締切まで <b>' + left(r.closeAt - t) + '</b></span></div>' + (S.thanks ? '<p class="thx">ご投票ありがとうございました。</p>' : '') +
      fune(v) + '<p class="sub">締切までは無料券の組番を変えられます。BPT の券は足せますが、消せません</p>' +
      '<div class="btnrow"><button class="btn ghost" data-act="tochange">組番を変える</button><button class="btn ghost" data-act="tobuy"' + (bl > 0 ? '' : ' disabled') + '>BPT で券を足す' + (S.bpt ? '<small>あと ' + bl + ' 枚</small>' : '') + '</button></div>');
  }
  function vRace() {
    return scr('b-race', '<h1>テレビでレース中</h1><p class="sub">結果はテレビとこの画面に出ます</p>' + fune(S.mine.vote));
  }
  function resLine(res) {
    const p = res.combo.split('-').map(Number);
    return '<div class="resl"><span>2連単</span>' + waku(p[0]) + '<b class="hy">-</b>' + waku(p[1]) + '<span class="po">払戻 <b>' + amt(res.pay) + '</b><small>BPT</small></span><span class="pn">' + (Math.round(res.odds * 10) / 10).toFixed(1) + '倍</span></div>';
  }
  function vResult() {
    const r = S.race, res = r.result, v = S.mine && S.mine.vote;
    if (!res) return scr('mid b-race', '<h1>結果を待っています</h1>' + (v ? fune(v) : ''));
    const won = v && v.won > 0, n = S.live && S.live.next;
    const next = n ? '<p class="nextr">次のボートレース <b>' + hm(n.at) + '</b>（投票は ' + hm(n.openAt) + ' から）</p>' : '';
    const bk = v && v.back, inc = res.incident, incLine = inc ? '<p class="incl">' + waku(inc.boat, 'sm') + ' ' + (inc.type === 'scratch' ? 'フライング' : '転覆') + '・' + (inc.refund ? 'この艇を含む券は返還' + (bk && (bk.n || bk.free) ? '（あなた: ' + (bk.n ? '＋' + amt(bk.bpt) + ' BPT 戻し' : '') + (bk.free ? (bk.n ? '・' : '') + '無料券は返還' : '') + '）' : '') : '返還なし') + '</p>' : '';
    if (won) return scr('b-result win', '<p class="hitmsg">的中ベットがありました。<br>おめでとうございます！</p><div class="gain">＋<b>' + amt(v.won) + '</b><small>BPT</small></div>' + resLine(res) + incLine + fune(v, { cls: 'small' }) +
      '<p class="bnote">BPT 残り <b>' + amt(S.bpt ? S.bpt.bal : 0) + '</b><br>競馬の「追加の券」に 1 枚 100 BPT で使えます（毎週月曜の朝 5 時にリセット）</p>' + next);
    return scr('b-result lose', '<h1>結果</h1>' + resLine(res) + incLine + (v ? fune(v, { cls: 'small' }) + '<p class="lead">' + (bk && bk.n ? '返還 ＋' + amt(bk.bpt) + ' BPT（BPT 残り ' + amt(S.bpt ? S.bpt.bal : 0) + '）' : bk && bk.free && !v.n ? '無料券は返還（はずれではありません）' : '今回ははずれ') + '</p>' : '') + next);
  }
  function vVoid() { return scr('mid b-void', '<h1>このレースは取り消しました</h1><div class="note">BPT の券に使った BPT は全部戻しました。</div>'); }

  /* ---------- いまの画面を決める ---------- */
  function decideScreen() {
    const r = S.race, t = now();
    if (!r) return 'wait';
    const st = Boat.stageOf(r, t), v = S.mine && S.mine.vote;
    if (st === 'wait' || st === 'over' || st === 'none') return 'wait';
    if (st === 'void') return 'void';
    if (st === 'vote') {
      if (S.screen === 'noderby') return 'noderby';
      if (!v && !keyFor(r.id)) return 'noqr';
      if (!savedNick() && !v) return 'nick';
      if (S.screen === 'confirm' && S.cart.length) return 'confirm';
      if (!v || S.screen === 'pick') return 'pick';
      return 'voted';
    }
    if (st === 'closed' || st === 'film') return v ? 'race' : 'noqrc';
    if (st === 'result') return 'result';
    return 'wait';
  }
  let lastHtml = '';
  function draw() {
    const sc = decideScreen(); if (sc !== S.screen) { if (S.screen === 'voted' && sc !== 'voted') S.thanks = false; S.screen = sc; }
    const html = sc === 'wait' ? vWait() : sc === 'noqr' ? vNoQr(false) : sc === 'noqrc' ? vNoQr(true) : sc === 'noderby' ? vNoDerby() : sc === 'nick' ? vNick() : sc === 'pick' ? vPick() : sc === 'confirm' ? vConfirm() : sc === 'voted' ? vVoted() : sc === 'race' ? vRace() : sc === 'result' ? vResult() : sc === 'void' ? vVoid() : vWait();
    chip();
    if (html === lastHtml) return;
    const m = $('main'), keep = sc === 'nick' && document.activeElement && document.activeElement.id === 'nk';
    if (keep) return; // 入力中は書き換えない
    const fxs = Array.prototype.map.call(m.querySelectorAll('.fx'), (e) => e.scrollTop);
    m.innerHTML = html; lastHtml = html;
    Array.prototype.forEach.call(m.querySelectorAll('.fx'), (e, i) => { if (fxs[i]) e.scrollTop = fxs[i]; });
    $('app').classList.remove('booting');
    fitLevel();
  }
  function fitLevel() {
    const app = $('app'), m = $('main'); if (!m.firstElementChild) return;
    const over = () => m.scrollHeight > m.clientHeight + 1 || Array.prototype.some.call(m.querySelectorAll('.fx:not([data-long])'), (f) => f.scrollHeight > f.clientHeight + 1 && f.clientHeight < 40);
    app.classList.remove('os-t', 'os-s', 'os-xs');
    ['os-t', 'os-s', 'os-xs'].forEach((c) => { if (over()) app.classList.add(c); });
  }

  /* ---------- 通信 ---------- */
  async function loadMine(force) {
    const r = S.race; if (!r) return;
    if (!force && S.minefor === r.id) return; S.minefor = r.id;
    try { const x = await C.myBoatVote(r.id); S.mine = x; S.bpt = x.bpt; } catch (e) { S.minefor = ''; }
    draw();
  }
  function onLive(live) {
    S.live = live || { race: null, next: null };
    const r = S.live.race;
    if (!r || !S.race || r.id !== S.race.id) { S.mine = null; S.cart = []; S.f = S.s = null; S.mode = 'buy'; S.minefor = ''; S.donefor = ''; S.err = ''; if (S.screen === 'noderby') S.screen = ''; }
    S.race = r || null;
    if (r) { loadMine(false); if (r.status === 'done' && S.donefor !== r.id) { S.donefor = r.id; loadMine(true); } }
    draw();
  }
  async function vote() {
    if (S.busy) return; const r = S.race; if (!r) return;
    const free = S.cart.find((x) => x.free), add = []; S.cart.forEach((x) => { if (!x.free) for (let i = 0; i < (x.n || 1); i++) add.push(x.k); });
    const o = { raceId: r.id, code: keyFor(r.id), nick: savedNick() || (S.mine && S.mine.vote && S.mine.vote.nick), add, dvs: derbyVotes() };
    if (free) { const p = free.k.split('-').map(Number); o.first = p[0]; o.second = p[1]; }
    S.busy = true; S.err = ''; draw();
    try {
      const x = await C.boatVote(o);
      S.mine = { vote: x.vote, bpt: x.bpt }; S.bpt = x.bpt; S.cart = []; S.f = S.s = null; S.mode = 'buy'; S.thanks = true; S.screen = 'voted';
    } catch (e) { errOf(e); }
    S.busy = false; draw();
  }
  function errOf(e) {
    const c = e && e.code;
    if (c === 'no_derby') { S.screen = 'noderby'; S.cart = []; return; }
    if (c === 'bad_code' || c === 'denied') { S.err = (e && e.message) || 'テレビの QR を読み直してください'; delete memKey[S.race.id]; ss.set(KKEY + S.race.id, ''); S.cart = []; S.screen = 'noqr'; return; }
    S.err = (e && e.message) || '送れませんでした。もう一度押してください';
    if (c === 'no_bpt' || c === 'too_many') { S.cart = S.cart.filter((x) => x.free); C.myBoatVote(S.race.id).then((x) => { S.mine = x; S.bpt = x.bpt; draw(); }, () => {}); }
  }
  async function change() {
    if (S.busy || S.f == null || S.s == null) return; S.busy = true; S.err = '';
    try { const x = await C.boatVote({ raceId: S.race.id, nick: S.mine.vote.nick, first: S.f, second: S.s }); S.mine = { vote: x.vote, bpt: x.bpt }; S.bpt = x.bpt; S.f = S.s = null; S.mode = 'buy'; S.screen = 'voted'; toast('組番を変えました'); }
    catch (e) { errOf(e); }
    S.busy = false; draw();
  }

  /* ---------- 操作 ---------- */
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button,[data-act]'); if (!b || b.disabled) return;
    if (b.dataset.f != null) { const i = Number(b.dataset.f); S.f = S.f === i ? null : i; S.err = ''; return draw(); }
    if (b.dataset.s != null) { const i = Number(b.dataset.s); S.s = S.s === i ? null : i; S.err = ''; return draw(); }
    if (b.dataset.del != null) { S.cart.splice(Number(b.dataset.del), 1); if (!S.cart.length && S.screen === 'confirm') S.screen = 'pick'; return draw(); }
    const a = b.dataset.act;
    if (a === 'nick') { const n = String(($('nk') || {}).value || '').trim(); if (!n || Array.from(n).length > 8) { toast('ニックネームは 1〜8 文字です'); return; } ls.set(NKEY, n); lastHtml = ''; S.screen = 'pick'; return draw(); }
    if (a === 'add') {
      if (S.f == null || S.s == null) return;
      const k = S.f + '-' + S.s;
      if (!hasFree() && !freeInCart()) S.cart.push({ k, free: true });
      else if (bptLeft() > 0) { const q = Math.max(1, Math.min(S.qty || 1, bptLeft())), have = S.cart.find((x) => !x.free && x.k === k); if (have) have.n = (have.n || 1) + q; else S.cart.push({ k, free: false, n: q }); S.qty = 1; }
      else { toast('BPT が足りません'); return; }
      S.f = S.s = null; return draw();
    }
    if (a === 'qm' || a === 'qp' || a === 'q10') { const L = bptLeft(); S.qty = Math.max(1, Math.min(L, (S.qty || 1) + (a === 'qm' ? -1 : a === 'qp' ? 1 : 10))); return draw(); }
    if (a === 'confirm') { S.screen = 'confirm'; return draw(); }
    if (a === 'fix') { S.screen = 'pick'; return draw(); }
    if (a === 'vote') return vote();
    if (a === 'tochange') { S.mode = 'change'; S.f = S.mine.vote.first; S.s = S.mine.vote.second; S.screen = 'pick'; return draw(); }
    if (a === 'tobuy') { S.mode = 'buy'; S.f = S.s = null; S.screen = 'pick'; return draw(); }
    if (a === 'back') { S.mode = 'buy'; S.f = S.s = null; S.cart = []; S.screen = hasFree() ? 'voted' : 'pick'; return draw(); }
    if (a === 'change') return change();
  });

  /* ---------- はじめ ---------- */
  (async () => {
    if (C.backend !== 'firestore' && C.syncClock) { try { await C.syncClock(3); } catch (e) { /* noop */ } setInterval(() => C.syncClock(3).catch(() => {}), 60000); } // 模擬クラウドの時刻合わせ（Firestore 版はつなぐときに合わせる）
    if (!STORE) { $('main').innerHTML = scr('mid', '<h1>テレビの QR を読んでください</h1>'); $('app').classList.remove('booting'); return; }
    try { const L = await C.stores(); L.forEach((s) => { S.stores[s.id] = s.name; }); const st = $('store'); st.classList.remove('off'); $('storeText').textContent = 'casa ' + (S.stores[STORE] || STORE) + '・ボートの投票'; } catch (e) { $('storeText').textContent = 'つながりません'; }
    try { const x = await C.boatState(); onLive(x.live); } catch (e) { onLive(null); }
    C.boatWatch({ boat: onLive, error: () => {} });
    if (C.bptNow) { try { const b = await C.bptNow(); if (b && !S.bpt) { S.bpt = { bal: b.bal, cost: 100, left: 0 }; draw(); } } catch (e) { /* noop */ } }
    setInterval(() => { try { draw(); } catch (e) { console.error(e); } }, 1000);
    addEventListener('resize', () => { lastHtml = ''; draw(); });
    addEventListener('online', () => $('net').classList.add('hidden')); addEventListener('offline', () => $('net').classList.remove('hidden'));
  })();
  window.BOATBET = { S, C, draw, get screen() { return S.screen; } }; // 確かめ用（tests/boat-phone.plan.js）
})();
