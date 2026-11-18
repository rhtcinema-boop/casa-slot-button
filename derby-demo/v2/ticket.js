/* casa DERBY スマホ（v2/bet.html）: 投票済みの「馬券ふうの投票券」を描く（2026-11-07 オーナー選定）。見た目だけ: 票の中身・決まりは bet.js のまま。
   最初の表示を重くしないように bet.js とは分けて、確認の画面か投票済みの画面を出すときに bet.js が読む。届くまでは今までの「あなたの予想」の札で出す。
   2026-11-07: bet.js の大きさを増やさないため（tests/v4-phone-reliability の S2 は 3 秒の上限ぎりぎり）、表示だけの小さな道具はここに写しを持つ（bet.js の同じ名前の道具と同じ決まり）。
   言葉・当選額・倍率・時刻・状態は window.BET（bet.js）から */
(function () {
  'use strict';
  /* 見た目（ticket.css）は自分で読む。届くまで券は隠す（bet.css）。読めない・遅いときも 2.5 秒で出す。届いたら名前の大きさを測り直す（bet.js の resize） */
  const SRC = ((document.currentScript || {}).src || ''), Q = SRC.replace(/^[^?]*/, ''), DIR = SRC.replace(/[?#].*$/, '').replace(/[^/]*$/, ''), ok = () => { document.documentElement.classList.add('tkok'); window.dispatchEvent(new Event('resize')); };
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = DIR + 'ticket.css' + Q; l.onload = ok; l.onerror = ok; setTimeout(ok, 2500); document.head.appendChild(l); /* DIR: 「レースを見る」（index.html?watch=1 → v2/watch.js）からも同じ階層の ticket.css を読む（2026-11-07） */
  /* 枠に入らない文字（馬名・ニックネーム）: bet.js の fitText と同じ決まり（「レースを見る」の窓には bet.js が無いので、ここにも持つ） */
  window.BetTicketFit = function (root) {
    if (!root) return;
    root.querySelectorAll('[data-fit]').forEach((el) => {
      el.style.fontSize = ''; el.classList.remove('wrap2');
      const w = el.clientWidth; if (!w || el.scrollWidth <= w + 1) return;
      const fs = parseFloat(getComputedStyle(el).fontSize), min = Number(el.dataset.fit) || 12;
      el.style.fontSize = Math.max(min, Math.floor((fs * w) / el.scrollWidth * 10) / 10) + 'px';
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add('wrap2');
    });
  };
  const pad = (n) => ('0' + n).slice(-2), JST = (ms) => new Date(ms + 9 * 3600e3), bill2 = (b) => String(b).padStart(2, '0');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FRAME = ['#f4f4f4', '#1a1a1e', '#d6332b', '#2459c9', '#f2c531', '#2a9a4a'], INK = ['#111', '#fff', '#fff', '#fff', '#111', '#fff'];
  const horsesOf = (r) => (r && Array.isArray(r.horses) ? r.horses.map((h, i) => ({ no: h.no || i + 1, name: h.name || '', color: h.color || FRAME[i], ink: h.ink || INK[i] })) : []);
  const waku = (h, cls) => (h ? '<span class="waku' + (cls ? ' ' + cls : '') + '" style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</span>' : '');
  const exOdds = (r, a, b) => { const v = r && r.exacta ? Number(r.exacta[a + '-' + b]) : NaN; return Number.isFinite(v) && v > 0 ? v : null; };
  const comboText = (r, a, b) => { const hs = horsesOf(r), h1 = hs[a], h2 = hs[b]; return '1着 ' + (h1 ? h1.no : a + 1) + '番 → 2着 ' + (h2 ? h2.no : b + 1) + '番'; };
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const bigAmt = (n, cls) => { const t = amt(n); return '<span class="' + cls + (t.length >= 7 ? ' l7' : t.length >= 6 ? ' l6' : '') + '">' + t + '<small class="pt">pt</small></span>'; };
  /* bet.js から: BetTicket(r, v, n, res)。n: 0＝1 票だけ／1＝1 票目／2＝2 票目（初参加ボーナス・スタンプ）。
     res（2026-11-07 オーナー決定「的中の記念画面」＝馬券に判子）: 当たった票の result（{win, odds, amount}）。あれば結果の画面用＝券に赤い丸い「的中」の判子を重ね、「当たれば」→「当選額」・「いまの倍率」→「確定の倍率」。はずれには渡さない（bet.js） */
  /* 2026-11-07 オーナー「自分の予想を見るところは全部馬券のデザインに」: res が {win:false} なら「はずれの券」（判子なし・小さな「はずれ」の札・額に線）。
     opt.cmp: 小さめの券（「レースを見る」の縦向き。映像が主役なので高さ 150px 前後）。window.BET が無い窓（watch.js）は window.BET_TK（言葉・状態・時刻・当選額・倍率）から */
  window.BetTicket = function (r, v, n, res, opt) {
    const B = window.BET || window.BET_TK, TX = B.TX, st = B.st, hhmm = B.hhmm, payFor = B.payFor, oddsTxt = B.oddsTxt, now = Date.now, who = true, cmp = !!(opt && opt.cmp);
    const dayStartHour = () => { const x = st && ((st.tuning && st.tuning.dayStartHour) != null ? st.tuning.dayStartHour : st.settings && st.settings.dayStartHour); const h = Number(x); return Number.isFinite(h) ? h : 5; };
    const shiftOn = () => { const x = st && st.settings; if (!x || x.shiftUp == null || x.shiftDown == null) return true; return Number(x.shiftUp) > 0 || Number(x.shiftDown) > 0; };
    /* ⑤ 投票済みの「馬券ふうの投票券」（2026-11-07 オーナー選定・手本は紙の馬券の写真）。見た目だけ: 票の中身・決まりは今までどおり。
       横長の白い券・緑の丸い地紋（casa DERBY と蹄鉄）・左に日付と店とレース番号・真ん中に縦の帯「2連単」・右に四角い番号と ★ と当たれば pt・下に合計と通し番号風の飾り。
       お金で買った券に見えないように「投票券（参加無料）」を必ず出す。倍率は締切まで動くので「いまの倍率」 */
    const tkHash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
    const tkDigits = (seed, n) => { let out = '', h = tkHash(seed); while (out.length < n) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; out += String(h % 10); } return out; };
    function tkQr(seed) { // QR 風の飾り（読めない。票ごとに模様が変わるだけ）
      const N = 9, h0 = tkHash(seed); let rects = '', h = h0;
      const finder = (x, y) => '<rect x="' + x + '" y="' + y + '" width="3" height="3" fill="none" stroke="currentColor" stroke-width=".9"/><rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="1" height="1"/>';
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if ((x < 4 && y < 4) || (x > 4 && y < 4) || (x < 4 && y > 4)) continue;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; if (h & 1) rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
      }
      return '<svg class="qr" viewBox="-.5 -.5 10 10" aria-hidden="true" fill="currentColor">' + finder(0, 0) + finder(6, 0) + finder(0, 6) + rects + '</svg>';
    }
    function ticketCard(r, v, n, who, res) {
      const hit = !!(res && res.win), miss = !!(res && !res.win), fin = r && r.result && r.result.finalExacta ? Number(r.result.finalExacta[v.first + '-' + v.second]) : 0;
      const o = (hit || miss) && Number(res.odds) > 0 ? Number(res.odds) : fin > 0 ? fin : exOdds(r, v.first, v.second), hs = horsesOf(r), h1 = hs[v.first], h2 = hs[v.second];
      const closed = hit || miss || !!(r && r.closeAt && now() >= r.closeAt); // 締切のあと（レース中）は倍率が動かない＝「倍率」・「締切まで動きます」なし
      const pay = hit ? Number(res.amount) || 0 : o ? payFor(o) : 0;
      const no1 = h1 ? h1.no : v.first + 1, no2 = h2 ? h2.no : v.second + 1;
      const d = JST((r.at || now()) - dayStartHour() * 3600e3), ymd = d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
      const L = st && Array.isArray(st.today) ? st.today : [], ri = L.findIndex((x) => x && (x.id === r.id || x.at === r.at));
      const store = (st && st.store && st.store.name) || '', at = hhmm(r.at || now());
      const issued = [v.updatedAt, v.votedAt].map(Number).find((x) => Number.isFinite(x) && x > 0);
      const seed = (v.vid || r.id) + '|' + v.bill + '|' + v.first + '-' + v.second + '|' + (n || 1);
      const ser = String(d.getUTCFullYear()).slice(2) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + bill2(v.bill) + no1 + no2 + tkDigits(seed, 3) + ' ' + tkDigits(seed + 'a', 13) + ' ' + tkDigits(seed + 'b', 8);
      const nm = (h, lb) => (h ? '<span class="tn"><span class="tl">' + lb + '</span>' + waku(h, 'sm') + '<span class="nmx" data-fit="7">' + esc(h.name) + '</span></span>' : '');
      /* 的中の判子（写真に撮りたくなる見た目。2026-11-07）: 赤い二重の丸・金の縁・少し傾ける・中に「的中」と casa DERBY と日付。券の右の列（番号の上）に重ねる（ticket.css .tk-hit） */
      const stamp = hit ? '<div class="tk-hit" role="img" aria-label="的中"><span class="tk-hit-in"><i>casa DERBY</i><b>的中</b><i>' + esc(ymd) + '</i></span></div>' : '';
      const rname = (r && (r.name || r.title)) || '', raceLine = ri >= 0 ? (rname ? '<span data-fit="7">' + esc(rname) + '</span>' : '') + '<span>' + esc(at) + ' 発走</span>' : rname ? '<span data-fit="7">' + esc(rname) + '</span>' : ''; // レース番号があるときは発走の時刻をここに（無いときは上の札に時刻）
      const stars = '<span class="tk-st" aria-hidden="true">★★★</span>';
      /* 2026-11-08 オーナー「馬券のデザインを本物にサイズとかも全部寄せて」: 手本の写真（1.6:1）の割合で組む（scratchpad/ticket-ref-measure.md）。
         左の列 36%＝日付・店（大）・[番号]レース・QR 風 2 つ・レース名と発走・casa DERBY 店／帯 12%＝EXACTA・2連単・EXACTA（左右に細い線）／右の列＝本物の 3 行:
         行 1 [3]-[5] ★★★ 100pt・行 2 馬名＋いまの倍率・行 3 当たれば ○pt／下＝会計番号・名前・発行（本物の合計の位置。「合計」の行は入れない＝オーナー 11/7）、通し番号。大きさは券の幅に比例（cqw） */
      return '<div class="mine tk' + (n === 2 ? ' b2' : '') + (hit ? ' hit' : miss ? ' miss' : '') + (cmp ? ' cmp' : '') + '"><p class="mk">' + esc(hit ? (n === 2 ? TX.vote2 : n === 1 ? TX.vote1 : '的中した投票券') : n === 2 ? TX.vote2 : miss && n === 1 ? TX.vote1 : TX.yourPick) + (hit ? '<span class="vn bt">' + esc(TX.hitMark) + '</span>' : miss ? '<span class="vn ms">' + esc(TX.missMark || 'はずれ') + '</span>' : n === 1 ? '<span class="vn">' + esc(TX.vote1) + '</span>' : n === 2 ? '<span class="vn bt">' + esc(v.stamp ? TX.stampTag : TX.bonusTag) + '</span>' : '') + '</p>' +
        '<div class="tkt"><div class="tkin">' +
          '<div class="tk-l"><div class="tk-date">' + esc(ymd) + '</div><div class="tk-store" data-fit="14">' + esc(store) + '</div>' +
            (ri >= 0 ? '<div class="tk-rno"><b>' + (ri + 1) + '</b><span>レース</span></div>' : '<div class="tk-rno tm"><b>' + esc(at) + '</b><span>発走</span></div>') +
            '<div class="tk-qrs">' + tkQr(seed) + tkQr(seed + 'q') + '</div>' +
            '<div class="tk-race"><span class="cb" data-fit="7">' + esc(hit ? '2連単 的中 ' + comboText(r, v.first, v.second) : comboText(r, v.first, v.second)) + '</span>' + raceLine + '</div>' /* 本物のレース名の位置: 組み合わせの文（1着 3番 → 2着 5番）と、レース番号があるときは発走の時刻 */ +
            '<div class="tk-brand"><b>casa DERBY</b><span data-fit="7">' + esc(store) + '</span></div></div>' +
          '<div class="tk-band" aria-hidden="true"><i>EXACTA</i><b>2連単</b><i>EXACTA</i></div>' +
          '<div class="tk-r"><span class="tk-free">投票券<small>（参加無料）</small></span>' +
            '<div class="tk-row r1"><span class="bx">' + no1 + '</span><i>-</i><span class="bx">' + no2 + '</span><span class="tk-pts"><span class="tk-ifw">' + (hit ? '当選額' : '当たれば') + '</span>' + stars + bigAmt(pay, 'tk-amt') + '</span></div>' + /* オーナー決定 11/8: 本物の「100円」の位置に当たりの額（1票 100pt はこの行に出さない） */
            '<div class="tk-row r2"><div class="tk-names">' + nm(h1, '1着') + nm(h2, '2着') + '</div><span class="tk-odd2"><small>' + (hit || miss ? '確定の倍率' : closed ? '倍率' : 'いまの倍率') + '</small><b>' + (o ? esc(oddsTxt(o)) : '—') + '<small>倍</small></b></span>' + stamp + '</div></div>' +
          '<div class="tk-stub"><span class="tk-who"><span class="nw">' + esc(TX.billHead) + ' <b>' + esc(v.bill) + '</b></span>' + (who ? ' <span class="nw tk-nick" data-fit="9">' + esc(v.nick) + '</span>' : '') + '</span>' + (issued ? '<span class="tk-iss">発行 ' + esc(hhmm(issued)) + '</span>' : '') + '</div>' +
          '<div class="tk-ser" aria-hidden="true">' + esc(ser) + '</div>' +
        '</div></div>' +
        (o && !closed && !cmp && shiftOn() ? '<p class="tk-note">倍率と当たりの額は、締切まで動きます</p>' : '') + '</div>';
    }
    return ticketCard(r, v, n, who, res); // 会計番号は 2 枚とも出す（券ごとに 1 枚で分かるように）
  };
})();
