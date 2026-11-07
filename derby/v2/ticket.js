/* casa DERBY スマホ（v2/bet.html）: 投票済みの「馬券ふうの投票券」を描く（2026-11-07 オーナー選定）。見た目だけ: 票の中身・決まりは bet.js のまま。
   最初の表示を重くしないように bet.js とは分けて、確認の画面か投票済みの画面を出すときに bet.js が読む。届くまでは今までの「あなたの予想」の札で出す。
   2026-11-07: bet.js の大きさを増やさないため（tests/v4-phone-reliability の S2 は 3 秒の上限ぎりぎり）、表示だけの小さな道具はここに写しを持つ（bet.js の同じ名前の道具と同じ決まり）。
   言葉・当選額・倍率・時刻・状態は window.BET（bet.js）から */
(function () {
  'use strict';
  /* 見た目（ticket.css）は自分で読む。届くまで券は隠す（bet.css）。読めない・遅いときも 2.5 秒で出す。届いたら名前の大きさを測り直す（bet.js の resize） */
  const Q = ((document.currentScript || {}).src || '').replace(/^[^?]*/, ''), ok = () => { document.documentElement.classList.add('tkok'); window.dispatchEvent(new Event('resize')); };
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'ticket.css' + Q; l.onload = ok; l.onerror = ok; setTimeout(ok, 2500); document.head.appendChild(l);
  const pad = (n) => ('0' + n).slice(-2), JST = (ms) => new Date(ms + 9 * 3600e3), bill2 = (b) => String(b).padStart(2, '0');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FRAME = ['#f4f4f4', '#1a1a1e', '#d6332b', '#2459c9', '#f2c531', '#2a9a4a'], INK = ['#111', '#fff', '#fff', '#fff', '#111', '#fff'];
  const horsesOf = (r) => (r && Array.isArray(r.horses) ? r.horses.map((h, i) => ({ no: h.no || i + 1, name: h.name || '', color: h.color || FRAME[i], ink: h.ink || INK[i] })) : []);
  const waku = (h, cls) => (h ? '<span class="waku' + (cls ? ' ' + cls : '') + '" style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</span>' : '');
  const exOdds = (r, a, b) => { const v = r && r.exacta ? Number(r.exacta[a + '-' + b]) : NaN; return Number.isFinite(v) && v > 0 ? v : null; };
  const comboText = (r, a, b) => { const hs = horsesOf(r), h1 = hs[a], h2 = hs[b]; return '1着 ' + (h1 ? h1.no : a + 1) + '番 → 2着 ' + (h2 ? h2.no : b + 1) + '番'; };
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const bigAmt = (n, cls) => { const t = amt(n); return '<span class="' + cls + (t.length >= 7 ? ' l7' : t.length >= 6 ? ' l6' : '') + '">' + t + '<small class="pt">pt</small></span>'; };
  /* bet.js から: BetTicket(r, v, n)。n: 0＝1 票だけ／1＝1 票目／2＝2 票目（初参加ボーナス・スタンプ） */
  window.BetTicket = function (r, v, n) {
    const B = window.BET, TX = B.TX, st = B.st, hhmm = B.hhmm, payFor = B.payFor, oddsTxt = B.oddsTxt, now = Date.now, who = true;
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
    function ticketCard(r, v, n, who) {
      const o = exOdds(r, v.first, v.second), hs = horsesOf(r), h1 = hs[v.first], h2 = hs[v.second];
      const no1 = h1 ? h1.no : v.first + 1, no2 = h2 ? h2.no : v.second + 1;
      const d = JST((r.at || now()) - dayStartHour() * 3600e3), ymd = d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
      const L = st && Array.isArray(st.today) ? st.today : [], ri = L.findIndex((x) => x && (x.id === r.id || x.at === r.at));
      const store = (st && st.store && st.store.name) || '', at = hhmm(r.at || now());
      const issued = [v.updatedAt, v.votedAt].map(Number).find((x) => Number.isFinite(x) && x > 0);
      const seed = (v.vid || r.id) + '|' + v.bill + '|' + v.first + '-' + v.second + '|' + (n || 1);
      const ser = String(d.getUTCFullYear()).slice(2) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + bill2(v.bill) + no1 + no2 + tkDigits(seed, 3) + ' ' + tkDigits(seed + 'a', 13) + ' ' + tkDigits(seed + 'b', 8);
      const nm = (h, lb) => (h ? '<span class="tn"><span class="tl">' + lb + '</span>' + waku(h, 'sm') + '<span class="nmx" data-fit="9">' + esc(h.name) + '</span></span>' : '');
      return '<div class="mine tk' + (n === 2 ? ' b2' : '') + '"><p class="mk">' + esc(n === 2 ? TX.vote2 : TX.yourPick) + (n === 1 ? '<span class="vn">' + esc(TX.vote1) + '</span>' : n === 2 ? '<span class="vn bt">' + esc(v.stamp ? TX.stampTag : TX.bonusTag) + '</span>' : '') + '</p>' +
        /* 横長の券（手本の写真と同じ 1.6:1 くらい。2026-11-07 オーナー「縦に長い」）: 左の列＝日付・店・レース番号・QR 風・casa DERBY／真ん中＝帯／右の列＝無料の札・組み合わせ・馬名・★と額。下に合計と倍率、ミシン目の下に会計番号・名前・発行・通し番号 */
        '<div class="tkt"><div class="tkin">' +
          '<div class="tk-body">' +
            '<div class="tk-l"><div class="tk-date">' + esc(ymd) + '</div><div class="tk-store" data-fit="14">' + esc(store) + '</div>' +
              (ri >= 0 ? '<div class="tk-rno"><b>' + (ri + 1) + '</b><span>レース</span></div>' : '<div class="tk-rno tm"><b>' + esc(at) + '</b><span>発走</span></div>') +
              '<div class="tk-foot"><div class="tk-qrs">' + tkQr(seed) + tkQr(seed + 'q') + '</div>' + (ri >= 0 ? '<div class="tk-race"><b>' + esc(at) + '</b><br>発走</div>' : '') + '</div></div>' +
            '<div class="tk-band" aria-hidden="true"><i>EXACTA</i><b>2連単</b><i>EXACTA</i></div>' +
            '<div class="tk-r"><div class="tk-cap"><span data-fit="9">' + esc(comboText(r, v.first, v.second)) + '</span><span class="tk-free">投票券<small>（参加無料）</small></span></div>' +
              '<div class="tk-combo"><span class="bx">' + no1 + '</span><i>→</i><span class="bx">' + no2 + '</span></div>' +
              '<div class="tk-names">' + nm(h1, '1着') + nm(h2, '2着') + '</div>' +
              '<div class="tk-pay"><span class="tk-ifw">当たれば</span><span class="tk-st" aria-hidden="true">★★★</span>' + bigAmt(o ? payFor(o) : 0, 'tk-amt') + '</div></div>' +
          '</div>' +
          '<div class="tk-sum"><span>合計</span><span class="tk-st" aria-hidden="true">★★★★</span><b>1</b><span>票</span><span class="tk-st" aria-hidden="true">★★★★</span><span class="tk-odd">いまの倍率 <b>' + (o ? esc(oddsTxt(o)) : '—') + '</b>倍</span></div>' +
          '<div class="tk-stub"><span class="tk-who"><span class="nw">' + esc(TX.billHead) + ' <b>' + esc(v.bill) + '</b></span>' + (who ? ' <span class="nw tk-nick" data-fit="11">' + esc(v.nick) + '</span>' : '') + '</span>' +
            (issued ? '<span class="tk-iss">発行 ' + esc(hhmm(issued)) + '</span>' : '') + '</div><div class="tk-ser" aria-hidden="true">' + esc(ser) + '</div>' +
        '</div></div>' +
        (o && shiftOn() ? '<p class="tk-note">倍率と当たりの額は、締切まで動きます</p>' : '') + '</div>';
    }
    return ticketCard(r, v, n, who); // 会計番号は 2 枚とも出す（券ごとに 1 枚で分かるように）
  };
})();
