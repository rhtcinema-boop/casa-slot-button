/* casa DERBY のスマホに「次のボートレース」と「あなたの BPT」を出す（2026-11-23 オーナー決定「競馬とボートを 1 つの番組としてつなぐ」の④。絵は ref/boat/つなぐ設計案_2026-11-23.jpg）。
   最初の表示を重くしないよう bet.js とは分けて、待ち・投票済み・結果の画面が出たあとに bet.js が読む（v2/ticket.js と同じやり方）。見た目もここから足す（bet.css を大きくしない）。
   出すもの（window.BetBoat.card(場面) が HTML を返す。bet.js の R.wait・R.voted・R.result が呼ぶ）:
     ・次のボートレース 15:30（テレビの QR から・無料で 1 票）＋「受付開始まで あと ○:○○」（投票中は「投票受付中・締切まで あと ○:○○」）
     ・あなたの BPT 800（競馬の票を あと 4 票 増やせます）… BPT を持っている人だけ。数え方は bet.js の「BPT で票を追加（あと○票）」と同じ（1 レース合わせて 5 票まで ＝ 増やせるのは 4 まで）。
       投票済みの画面で「BPT で票を追加」のボタンが出ているときは、同じ中身を 2 回書かない（ボタンに残りが出ている）
   読み取り（スマホ 1 台）:
     ・ボートのいまの状態（boatLive/all）を 1 回。見張らない。5 分は端末に覚える（casa.derby.boatnx。ボートの投票ページ v2/boat-bet.js も同じ置き場に書くので、ボートから来た人は読まない）。
       ボートの部品（boat-core.js・boat-firestore.js ＝ 合わせて 116KB と、2 つ目のつなぎの時刻合わせ）は読まない。つないである Firestore から 1 件だけ読む。模擬クラウドは /api/boat/state
     ・BPT は、ボートの投票ページを開いたことのあるスマホだけ 1 回（casa.boat.* の覚えがある）。5 分は覚える。投票済みの画面は bet.js が読んだ数（my.bpt）を使う＝読まない
     ・読み直すのは画面を描くときだけ（時計では読まない。開きっぱなしのスマホの読み取りを増やさない）
   言葉: BPT と pt をどちらも「ポイント」と書かない。お客さん向けは「票」。裏の決まりの数字は出さない。音は鳴らさない */
(function () {
  'use strict';
  const B = window.BET; if (!B || !B.C || window.BetBoat) return;
  const C = B.C;
  const TX = { next: '次のボートレース', how: 'テレビの QR から・無料で 1 票', openIn: '受付開始まで あと', open: '投票受付中', closeIn: '締切まで あと', bpt: 'あなたの BPT', more: '競馬の票を あと {n} 票 増やせます', label: 'ボートレースと BPT' };
  const NKEY = 'casa.derby.boatnx', TTL = 5 * 60000, RETRY = 60000, SCREENS = ['wait', 'voted', 'result'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => C.serverNow(), amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP'), p2 = (n) => ('0' + n).slice(-2);
  const left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return (s >= 3600 ? Math.floor(s / 3600) + ':' + p2(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ':' + p2(s % 60); }; // bet.js の残り時間と同じ形（1 秒ごとの書き換えは bet.js の data-cd）
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 覚えられない端末は毎回読む */ } };

  /* 見た目（このファイルが届いたときに 1 回だけ足す）。色はボートの水色（bet.css の .bptrow と同じ系統）。入らない画面だけ詰める（下の .os-s〜.os-xx） */
  const st = document.createElement('style'); st.id = 'bbCss';
  st.textContent = '.bbc{flex:none;display:flex;flex-direction:column;gap:5px;padding:10px 14px;border-radius:14px;border:1.5px solid #4fb0e2;background:linear-gradient(135deg,#12365a,#0d1f36);text-align:left;line-height:1.3}' +
    '.bbc p{margin:0}.bbc .bb1{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 10px}' +
    '.bbc .bbt{font-size:14px;font-weight:700;color:#d8f3ff;white-space:nowrap}.bbc .bbt b{margin-left:2px;font-family:var(--display);font-size:22px;font-weight:900;color:#fff;font-variant-numeric:tabular-nums}' +
    '.bbc .bbcd{margin-left:auto;font-size:11.5px;color:#a9c4dc;white-space:nowrap}.bbc .bbcd b{margin-left:1px;font-family:var(--display);font-size:18px;font-weight:900;color:#d8f3ff;font-variant-numeric:tabular-nums}.bbc .bbcd.hot,.bbc .bbcd.hot b{color:#ffe08a}' +
    '.bbc .bbh{font-size:12.5px;color:#a9c4dc}' +
    '.bbc .bb3{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 8px;font-size:13px;font-weight:700;color:#8fdcff}.bbc .bb1~.bb3{padding-top:5px;border-top:1px dashed rgba(143,220,255,.35)}' +
    '.bbc .bb3 b{margin-left:2px;font-family:var(--display);font-size:21px;font-weight:900;color:#fff;font-variant-numeric:tabular-nums}.bbc .bb3 small{font-size:12.5px;font-weight:600;color:#d8f3ff}' +
    /* 入らない画面だけ詰める（bet.js の fitLevel）: .os-s 余白 → .os-xs 字を少し小さくして時刻と残り時間を 1 行に → .os-xx（それでも入らないときだけ）説明を省く＝「（テレビの QR から…）」「投票受付中・」「（競馬の票を…）」と、BPT の行があるときのスタンプカードの下の 1 文（数は上に出ている） */
    '.scr.lose>.bbc+.btnrow{margin-top:0}' + /* はずれの結果: 「次のレース」→ この枠 → ボタンを下にまとめる（bet.css の .scr.lose > .nextr + .btnrow と同じ並び） */
    '.os-s .bbc{gap:3px;padding:7px 12px}.os-s .bbc .bb1~.bb3{padding-top:3px}' +
    '.os-xs .bbc{padding:6px 10px}.os-xs .bbc .bb1{gap:0 6px}.os-xs .bbc .bbt{font-size:13px}.os-xs .bbc .bbt b{font-size:20px}.os-xs .bbc .bbcd{font-size:10.5px}.os-xs .bbc .bbcd b{font-size:17px}.os-xs .bbc .bb3 b{font-size:19px}.os-xs .bbc .bbh,.os-xs .bbc .bb3 small{font-size:12px}' +
    '.os-xx .scr.mid .bbc .bbh,.os-xx .scr.mid .bbc .bbo,.os-xx .scr.mid .bbc .bb3 small{display:none}.os-xx .scr.mid:has(.bb3) .stampcard .sl{display:none}'; // 省くのは待ちの画面だけ（投票済み・結果は中だけ動く欄の中なので省かない）
  document.head.appendChild(st);

  /* ---------- ボートのいまの状態（軽い形だけ覚える: いまのレースの時刻と、このあとの 3 件） ---------- */
  const liteOf = (l) => {
    l = l || {}; const r = l.race, ns = Array.isArray(l.nexts) && l.nexts.length ? l.nexts : l.next ? [l.next] : [];
    return { race: r && r.at > 0 ? { id: r.id, at: r.at, openAt: r.openAt, st: r.status || '', off: !!(r.test || r.refunded === true || r.status === 'void') } : null, nexts: ns.filter((x) => x && x.test !== true && x.at > 0).slice(0, 3).map((x) => ({ id: x.id, at: x.at, openAt: x.openAt })) }; // テストのレースは「次のボートレース」に出さない（2026-11-23。いまのレースは off。このあとの分は、置き場が test の印を付けて届けたらここで外れる）
  };
  let live = null, liveAt = 0, liveBusy = false;
  (function () { let x = null; try { x = JSON.parse(lsGet(NKEY) || 'null'); } catch (e) { x = null; } if (x && x.v && Date.now() - x.at < TTL && x.at <= Date.now() + 60000) { live = x.v; liveAt = x.at; } })();
  const timed = (p, ms) => Promise.race([p, new Promise((res, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  async function readLive() {
    if (C.backend === 'firestore') {
      const F = window.DerbyFirestore, cfg = window.DERBY_FIREBASE; if (!F || !cfg) throw new Error('no firestore');
      const env = await F.connect(cfg, { role: 'phone' }); // bet.js がもうつないである（同じ約束が返る。ログインは増えない）
      if (!env.fb.auth.currentUser) throw new Error('no user'); // 匿名ログインがまだ: 次に描くときにもう一度
      const s = await env.fb.db.collection('boatLive').doc('all').get(); return s.exists ? s.data() : {};
    }
    return ((await C.boatState()) || {}).live;
  }
  function loadLive() {
    if (liveBusy || Date.now() - liveAt < TTL) return; liveBusy = true; reads.live++;
    timed(readLive(), 10000).then((l) => { const v = liteOf(l), ch = JSON.stringify(v) !== JSON.stringify(live); live = v; liveAt = Date.now(); liveBusy = false; lsSet(NKEY, JSON.stringify({ at: liveAt, v })); if (ch) redraw(); },
      () => { liveBusy = false; liveAt = Date.now() - TTL + RETRY; /* 読めない（電波・ボートの決まりがまだ）: 1 分はあける */ });
  }
  // いま出すボートのレース: 投票の前・投票中のいちばん早い 1 件（テスト・取り消しは出さない）。ボートは締切の時刻 ＝ レースの時刻（v2/boat-core.js）
  function nextBoat(t) {
    if (!live) return null; const r = live.race, L = [], seen = {};
    if (r && !r.off && r.st === 'upcoming') { L.push(r); seen[r.id] = 1; }
    else if (r) seen[r.id] = 1; // 締め切った・テストのレースは、覚えた「このあと」に同じ物があっても出さない
    live.nexts.forEach((x) => { if (!seen[x.id]) { seen[x.id] = 1; L.push(x); } });
    const e = L.filter((x) => x.at > t).sort((a, b) => a.at - b.at)[0];
    return e ? { at: e.at, openAt: e.openAt || e.at, vote: t >= (e.openAt || e.at) } : null;
  }

  /* ---------- BPT ---------- */
  const boatUser = () => ['casa.boat.stores', 'casa.boat.intro', 'casa.boat.mine', 'casa.boat.cart'].some((k) => lsGet(k) != null); // ボートの投票ページを開いたことがあるスマホ（BPT はボートの当たりでしか増えない）
  let bal = null, balAt = 0, balBusy = false; const reads = { live: 0, bpt: 0 }; // reads: このファイルが読んだ回数（確かめ用）
  const rawBpt = C.bpt ? C.bpt.bind(C) : null;
  if (rawBpt) { C.bpt = function () { const p = rawBpt.apply(null, arguments); Promise.resolve(p).then((x) => { bal = x ? Number(x.bal) || 0 : 0; balAt = Date.now(); }, () => {}); return p; }; } // bet.js が確認の画面で読んだ BPT も覚える（同じ物をこちらでもう 1 回読まない）
  function loadBpt() {
    if (balBusy || !rawBpt || Date.now() - balAt < TTL || !boatUser()) return; balBusy = true; reads.bpt++;
    timed(rawBpt(), 10000).then((x) => { const n = x ? Number(x.bal) || 0 : 0, ch = n !== bal; bal = n; balAt = Date.now(); balBusy = false; if (ch) redraw(); }, () => { balBusy = false; balAt = Date.now() - TTL + RETRY; });
  }
  function bptLine(k) {
    const m = B.my, voted = k === 'voted', mb = voted && m && m.bpt ? m.bpt : null; let n = 0;
    if (mb) { bal = Number(mb.bal) || 0; balAt = Date.now(); if (mb.left > 0 && !m.lost) return ''; } // 投票済み: bet.js が読んだ数。「BPT で票を追加（あと○票）」のボタンが出ているときは書かない
    else { loadBpt(); if (!voted) n = Math.min(4, Math.floor((bal || 0) / 100)); } // 「あと○票」は次のレースの話（待ち・結果）。投票済みの画面では数だけ
    if (!(bal > 0)) return '';
    return '<p class="bb3"><span>' + esc(TX.bpt) + ' <b>' + amt(bal) + '</b></span>' + (n > 0 ? '<small>（' + esc(TX.more.replace('{n}', n)) + '）</small>' : '') + '</p>';
  }

  /* ---------- 描く ---------- */
  function redraw() {
    if (SCREENS.indexOf(B.screen) < 0) return;
    if (document.querySelector('.slider.busy, .slider.drag')) { setTimeout(redraw, 1500); return; } // 受け取りのスライドの途中は待つ
    try { B.draw(); } catch (e) { /* 次の描き直しで出る */ }
  }
  let edgeT = 0;
  function arm(e, t) { // 投票の始まり・締切ちょうどに描き直す（読み取りなし。覚えた時刻だけで切り替える）
    clearTimeout(edgeT); if (!e) return; const at = e.vote ? e.at : e.openAt, d = at - t;
    if (d > 0 && d < 6 * 3600000) edgeT = setTimeout(redraw, d + 80);
  }
  function card(k) {
    if (SCREENS.indexOf(k) < 0) return '';
    loadLive();
    const t = now(), e = nextBoat(t), bl = bptLine(k); arm(e, t);
    if (!e && !bl) return '';
    const cd = e ? (e.vote ? '<span class="bbcd hot"><span class="bbo">' + esc(TX.open) + '・</span>' + esc(TX.closeIn) + ' <b data-cd="' + e.at + '">' + left(e.at - t) + '</b></span>' : '<span class="bbcd">' + esc(TX.openIn) + ' <b data-cd="' + e.openAt + '">' + left(e.openAt - t) + '</b></span>') : '';
    return '<div class="bbc" role="group" aria-label="' + esc(TX.label) + '">' +
      (e ? '<p class="bb1"><span class="bbt">' + esc(TX.next) + ' <b>' + B.hhmm(e.at) + '</b></span>' + cd + '</p><p class="bbh">（' + esc(TX.how) + '）</p>' : '') + bl + '</div>';
  }
  window.BetBoat = { card, TX, reads, get live() { return live; }, get bal() { return bal; }, reload() { liveAt = 0; balAt = 0; redraw(); } /* 確かめ用（tests/boat-phone-tsunagu.plan.js） */ };
  redraw();
})();
