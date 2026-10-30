/* casa DERBY 見るだけ（index.html?store=<店>&watch=1。2026-10-29 オーナー「投票終わった端末のみレースを観測できるように作って」「激アツな感じで」）
   スマホの投票ページ（v2/bet.html）の「レースを見る」で開く窓。中身はテレビと同じ（v2/tv.js が ?watch=1 で動く＝名乗らない・書かない・読み込み直さない）。ここで足すもの:
   - 見られるかの確かめ: いまのレース（締切まで・レース中・結果の画面の間）に、この端末の票があるときだけ。無ければ「投票した方だけ見られます」（画面は出さない）。
     票は投票ページ（親の窓）が持っている自分の票（window.BETWATCH）か、この端末に覚えた票の持ち主の印（DerbyCloud.myVotes）。どちらも端末の中だけで確かめる
   - 画面の合わせ方（DerbyWatch.fit。v2/tv.js の layout が呼ぶ）: 横向き＝テレビの画面をまるごと収めて、空いた横（か下）に自分の予想。「横いっぱい」ボタンで横いっぱい（上下に動かして見る）。
     縦向き＝横いっぱい（上に帯・下に自分の予想・「横向きにすると大きく見られます」）
   - 自分の予想（「あなたの予想 1着 3番 → 2着 5番 12.4倍 1,300pt」）。倍率は締切までは表の倍率、結果が出たら確定の倍率。当選額は DerbyForm.payFor（アプリと同じ切り上げ）。3 票まで＋「ほか n 件」
   - レース中: 自分の馬の「いま何位」（1 秒に 5 回まで書き換え）・「当たりの形！」（1・2 着が予想どおりの順）・「あと少し！」（どちらかが 2 着以内）・左上の順位の札の自分の馬に光る輪
   - 結果: 「的中！ ○○pt」（紙吹雪・短く）か「おしい！」「ハズレ」。決まった結果（決める係の本物）だけで判定する。投票ページへ戻るボタン
   - 音: 最初は消してある。🔇 を押すと出る（テレビの音のボタンを押すのと同じ）
   何も書かない（Firestore・模擬クラウドのどちらにも）。確認用に window.DerbyWatch を出す。 */
(function () {
  'use strict';
  const D = window.DERBY;
  if (!D || !D.watch) return;
  const $ = (id) => document.getElementById(id);
  const QS = location.search, STORE = D.store, F = window.DerbyForm || null, DC = window.DerbyCloud || null, C = D.cloud;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const payFor = (o) => (F ? F.payFor(o) : Math.ceil(Math.max(10, Math.round(Number(o) * 10)) / 10 - 1e-9) * 100);
  const oddsTxt = (o) => (F ? F.odds(o) : (Number(o) > 0 ? (Math.round(Number(o) * 10) / 10).toFixed(1) : '—'));
  const TX = {
    title: 'レースを見る', back: '投票ページ', backBig: '投票ページへ戻る', loading: '読み込み中…',
    noVote: '投票した方だけ見られます', noVoteSub: '投票ページで投票すると、このレースをテレビと同じ画面で見られます',
    over: 'このレースは終わりました', overSub: '次のレースも投票すると見られます', login: '投票した方だけ見られます', loginSub: '投票したスマホのブラウザで、投票ページから開いてください',
    mine: 'あなたの予想', vote2: '2票目', more: 'ほか {n} 件', ifWin: '', now: 'いま{r}位', loadingMine: 'あなたの予想を読み込み中…',
    hot: '当たりの形！', near: 'あと少し！', hit: '的中！', close: 'おしい！', miss: 'ハズレ', congrats: 'おめでとう！', claim: '投票ページで受け取りの画面を出せます',
    test: 'テストレース（受け取りはありません）', voided: 'このレースは取り消しになりました', result: '結果', rotate: '横向きにすると大きく見られます',
    fitAll: '全体', fitWide: '横いっぱい', sndOn: '音を出す', sndOff: '音を消す', closeBtn: '閉じる', noGl: 'この端末ではレースの映像を表示できません', noGlSub: '投票ページで結果を確かめてください',
  };
  const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? o[k] : ''));
  document.documentElement.classList.add('watch');

  /* ---------- 親の窓（投票ページ）: 同じサイトのときだけ ---------- */
  function parentBet() { try { const P = window.parent; if (P && P !== window && P.BETWATCH) { void P.location.href; return P.BETWATCH; } } catch (e) { /* 別のサイト */ } return null; }
  const IN_BET = !!parentBet();

  /* ---------- 部品 ---------- */
  const ui = document.createElement('div'); ui.id = 'wUi';
  ui.innerHTML = '<div class="wtop" id="wTop"><button type="button" class="wb back" id="wBack"><i aria-hidden="true">‹</i>' + esc(TX.back) + '</button><span class="wt">' + esc(TX.title) + '</span>' +
    '<button type="button" class="wb fit" id="wFit">' + esc(TX.fitWide) + '</button><button type="button" class="wb snd off" id="wSnd" aria-label="' + esc(TX.sndOn) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="spk" d="M4 9h4l5-4v14l-5-4H4z"/><path class="wave" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path class="x" d="M16 9l6 6M22 9l-6 6"/></svg></button></div>' +
    '<div class="wmine" id="wMine" hidden><div class="wbn" id="wBonus"></div><div class="word" id="wOrd"></div><div class="wh" id="wHype" aria-live="polite"></div><div class="wl" id="wLines"></div><div class="wres" id="wRes"></div></div>' +
    '<div class="wrot" id="wRot"><i aria-hidden="true">⟳</i>' + esc(TX.rotate) + '</div>' +
    '<div class="wlock show" id="wLock" role="status"><div class="in"><b id="wLockT">' + esc(TX.loading) + '</b><span id="wLockS"></span><button type="button" class="wbig" id="wLockB">' + esc(TX.backBig) + '</button></div></div>' +
    '<div class="wcele" id="wCele" hidden></div>';
  document.body.appendChild(ui);
  const sizer = document.createElement('div'); sizer.id = 'wSizer'; const vp = $('viewport'); if (vp) vp.appendChild(sizer);

  function goBack() {
    const B = parentBet();
    if (B && B.close) { try { B.close(); return; } catch (e) { /* 下へ */ } }
    const keep = ['cloud', 'mute'].map((k) => { const m = QS.match(new RegExp('[?&]' + k + '=([^&#]*)')); return m ? k + '=' + m[1] : ''; }).filter(Boolean).join('&');
    location.href = 'v2/bet.html?store=' + encodeURIComponent(STORE) + (keep ? '&' + keep : '');
  }
  $('wBack').addEventListener('click', goBack); $('wLockB').addEventListener('click', goBack);
  // 図の表示（v2/watchmap.html）へ切り替える（2026-10-30 本番も。選んだ表示はこの端末に覚える＝次に開くときもその表示。casa.derby.watchView）
  { const b = document.createElement('button'); b.type = 'button'; b.className = 'wb'; b.id = 'wMap'; b.textContent = '図で見る'; $('wFit').parentNode.insertBefore(b, $('wFit')); b.addEventListener('click', () => { const keep2 = ['cloud', 'mute', 'race'].map((k) => { const m = QS.match(new RegExp('[?&]' + k + '=([^&#]*)')); return m ? '&' + k + '=' + m[1] : ''; }).join(''); try { localStorage.setItem('casa.derby.watchView', 'map'); } catch (e) { /* noop */ } location.replace('v2/watchmap.html?store=' + encodeURIComponent(STORE) + keep2); }); }
  // 音: テレビの音のボタン（#soundBtn。v2/tv.js の soundButton）を押す。押した操作の中で鳴らすので、スマホでも音が出る
  function sndShow() { const off = !window.Sfx || Sfx.isMuted(), b = $('wSnd'); b.classList.toggle('off', off); b.setAttribute('aria-label', off ? TX.sndOn : TX.sndOff); }
  $('wSnd').addEventListener('click', (e) => { e.stopPropagation(); const b = document.getElementById('soundBtn'); if (b) b.click(); else if (window.Sfx) { Sfx.mute(!Sfx.isMuted()); if (!Sfx.isMuted() && Sfx.unlock) Sfx.unlock(); } sndShow(); });
  sndShow();
  /* 映像は 3D だけ（2026-10-29 オーナー決定）。WebGL が使えない端末（js/race3d.js が 3D にしなかった）・3D の絵が使えなくなった（文脈が失われた）ときは「この端末ではレースの映像を表示できません」 */
  let noGl = !(window.Race && window.Race.Race3D);
  { const gl = document.querySelector('canvas.race3d'); if (gl) gl.addEventListener('webglcontextlost', () => { noGl = true; }); }
  let wide = false; // 横向きで「横いっぱい」（上下に動かして見る）
  $('wFit').addEventListener('click', () => { wide = !wide; relayout(); });

  /* ---------- 画面の合わせ方（v2/tv.js の layout から呼ばれる） ---------- */
  const TOP_H = 40, SIDE_MIN = 170, BOT_H = 50;
  let mode = '';
  function fit(vw, vh) {
    const port = vh > vw;
    let s, x = 0, y = 0, m;
    if (port) { m = 'w-port'; s = vw / 1600; y = TOP_H; }
    else if (wide) { m = 'w-fill'; s = vw / 1600; }
    else {
      const s0 = Math.min(vw / 1600, vh / 900);
      if (vw - 1600 * s0 >= SIDE_MIN) { m = 'w-side'; s = s0; y = Math.round((vh - 900 * s) / 2); }
      else { m = 'w-bot'; s = Math.min(vw / 1600, (vh - BOT_H) / 900); x = Math.round((vw - 1600 * s) / 2); }
    }
    const de = document.documentElement, st = de.style;
    if (m !== mode) { ['w-port', 'w-fill', 'w-side', 'w-bot'].forEach((c) => de.classList.toggle(c, c === m)); mode = m; }
    de.classList.toggle('w-cols', m === 'w-bot' && x >= 104); // 左右の空きに戻る・音のボタンが入る
    st.setProperty('--wx', x + 'px'); st.setProperty('--wy', y + 'px'); st.setProperty('--ww', Math.round(1600 * s) + 'px'); st.setProperty('--wh', Math.round(900 * s) + 'px');
    $('wFit').textContent = wide ? TX.fitAll : TX.fitWide; $('wFit').hidden = port;
    return { s, x, y };
  }
  function relayout() { try { window.dispatchEvent(new Event('resize')); } catch (e) { /* noop */ } }

  /* ---------- 自分の票 ---------- */
  const norm = (v) => (v ? { first: v.first, second: v.second, bill: v.bill, nick: v.nick, n: v.n === 2 ? 2 : 1, result: v.result ? { win: !!v.result.win, amount: Number(v.result.amount) || 0, test: !!v.result.test, refunded: !!v.result.refunded } : null } : null);
  const own = {}; // レース id → { list, at, p, revealed }（このページで読んだ自分の票。親の窓が無いときだけ）
  /* 返り値: null（この端末の票はない）| { list: [票…], pending: 読み込み中 } */
  function votesFor(R) {
    const id = R.id, B = parentBet();
    if (B) { try { const L = B.votes(id); if (L && L.length) return { list: L.map(norm).filter(Boolean), pending: false }; } catch (e) { /* 下へ */ } }
    let m = null; try { m = (B && B.mv && B.mv(id)) || (DC && DC.myVotes && DC.myVotes.get(id)); } catch (e) { m = null; }
    if (!m || !m.vid || !C || !C.myVote) return null;
    const c = own[id], t = D.now(), needRe = c && c.list && !c.revealed && R.revealAt && t > R.revealAt + 2500 && !c.p;
    if (!c || needRe) {
      const o = own[id] = Object.assign(c || {}, { p: true });
      C.myVote(m.vid, m.key).then((d) => { o.p = false; o.list = [d && d.vote, d && d.vote2].filter(Boolean).map(norm); o.revealed = !!(R.revealAt && D.now() > R.revealAt); }, (e) => { o.p = false; if (e && (e.status === 404 || e.code === 'no_vote')) { o.list = []; o.gone = true; } else setTimeout(() => { if (own[id] === o && !o.list) delete own[id]; }, 5000); });
    }
    const cc = own[id];
    if (cc && cc.gone) return null; // 番号を空けられた（票が無い）
    return { list: (cc && cc.list) || [], pending: !(cc && cc.list) };
  }

  /* ---------- いま見せるレース（見られるか） ---------- */
  const endOf = (r) => r.endAt || (r.revealAt ? r.revealAt + 300000 : (r.closeAt || 0) + 15 * 60000);
  let focus = null, loginErr = false, ever = false;
  function pickFocus() {
    const S = D.state, t = D.now(); if (!S) return { why: loginErr ? 'login' : 'load' };
    const ph = D.phase, view = D.race, tv = D.tv || {};
    const L = [S.live, (ph === 'live' || ph === 'result') ? view : null, tv.resultRace, S.open && t < S.open.closeAt ? S.open : null, S.last && S.last.revealAt && t < endOf(S.last) ? S.last : null];
    if (focus && t < endOf(focus.race)) L.push(focus.race); // 締切の直後・発表の直後に状態が届くまでの間も、見ていたレースを続ける
    const seen = {};
    for (const r0 of L) {
      if (!r0 || !r0.id || seen[r0.id] || r0.refunded && t >= (r0.revealAt || 0)) continue; seen[r0.id] = 1;
      const r = view && view.id === r0.id ? view : r0, v = votesFor(r);
      if (v) return { race: r, votes: v };
    }
    return { why: loginErr ? 'login' : ever ? 'over' : 'novote' };
  }

  /* ---------- レース中: 自分の馬の順位 ---------- */
  function ranks(R) {
    const rv = D.raceView, run = rv && rv.run;
    if (!(D.phase === 'live' && D.race && D.race.id === R.id && run && run.pos && rv.phase !== 'idle')) return null;
    if (R.runAt && D.now() < R.runAt + 1500) return null; // ゲートが開いた直後は横一線
    const n = run.pos.length, idx = [], fin = run.finish || [];
    for (let i = 0; i < n; i++) idx.push(i);
    idx.sort((a, b) => { const fa = fin[a] > 0, fb = fin[b] > 0; if (fa && fb) return fin[a] - fin[b]; if (fa !== fb) return fa ? -1 : 1; return run.pos[b] - run.pos[a]; });
    const rk = []; idx.forEach((i, k) => { rk[i] = k + 1; });
    return rk;
  }
  const horseOf = (R, i) => (R && R.horses && R.horses[i]) || { no: i + 1, color: '#555', ink: '#fff', name: '' };
  const chip = (R, i) => { const h = horseOf(R, i); return '<i class="wk" style="background:' + esc(h.color) + ';color:' + esc(h.ink) + '">' + esc(h.no) + '</i>'; };
  function oddsOf(R, v) {
    const res = R.result, key = v.first + '-' + v.second;
    if (res && res.finalExacta && Number(res.finalExacta[key]) > 0) return { o: Number(res.finalExacta[key]), fixed: true };
    const o = R.exacta && Number(R.exacta[key]); return { o: o > 0 ? o : null, fixed: false };
  }
  /* 結果（決める係の本物だけ）: 票ごとに当たり・おしい・はずれ。発表（revealAt）のあと、着順掲示板の「確定」が出るころから */
  function outcome(R, list) {
    const res = R.result, t = D.now();
    if (!res || res.seed == null || !(R.revealAt && t >= R.revealAt + 3200)) return null;
    if (R.refunded) return { voided: true };
    const per = list.map((v) => {
      const win = v.result ? v.result.win : v.first === res.winner && v.second === res.second;
      const amount = win ? (v.result && v.result.amount) || payFor(res.comboOdds || (res.finalExacta && res.finalExacta[res.winner + '-' + res.second])) : 0;
      const near = !win && (v.first === res.winner || v.second === res.second || (v.first === res.second && v.second === res.winner));
      return { v, win, amount, near };
    });
    const wins = per.filter((x) => x.win);
    return { per, wins, total: wins.reduce((a, x) => a + x.amount, 0), near: !wins.length && per.some((x) => x.near), test: !!R.test || list.some((v) => v.result && v.result.test), res };
  }

  /* ---------- 描く（1 秒に 5 回まで。中身が変わったときだけ書き換える） ---------- */
  const last = { lock: '', lines: '', hype: '', res: '', rk: '', ord: '', bonus: '' };
  const celeDone = {};
  function setHtml(id, key, html) { if (last[key] === html) return; last[key] = html; $(id).innerHTML = html; }
  function lock(why) {
    const t = why === 'nogl' ? [TX.noGl, TX.noGlSub] : why === 'load' ? [TX.loading, ''] : why === 'login' ? [TX.login, TX.loginSub] : why === 'over' ? [TX.over, TX.overSub] : [TX.noVote, TX.noVoteSub];
    const k = why + '|' + t[0];
    if (last.lock !== k) { last.lock = k; $('wLockT').textContent = t[0]; $('wLockS').textContent = t[1]; $('wLock').dataset.why = why; $('wLock').classList.add('show'); document.getElementById('stage').classList.add('w-locked'); $('wMine').hidden = true; }
  }
  function unlock() { if (last.lock !== 'open') { last.lock = 'open'; $('wLock').classList.remove('show'); document.getElementById('stage').classList.remove('w-locked'); $('wMine').hidden = false; } }
  function render() {
    if (noGl) { lock('nogl'); return; }
    const f = pickFocus();
    if (!f.race) { if (focus && f.why !== 'over') { /* そのまま */ } focus = null; lock(f.why); hideCele(); markRank([]); return; }
    focus = f; ever = true; unlock();
    const R = f.race, list = f.votes.list, rk = ranks(R), oc = outcome(R, list);
    // 自分の予想の行（3 票まで＋ほか n 件）
    let lines = '';
    if (f.votes.pending && !list.length) lines = '<div class="wv wait">' + esc(TX.loadingMine) + '</div>';
    list.slice(0, 3).forEach((v, k) => {
      const od = oddsOf(R, v), p = oc && oc.per ? oc.per[k] : null;
      const lb = list.length > 1 ? (v.n === 2 ? TX.vote2 : k === 0 ? TX.mine : '予想' + (k + 1)) : TX.mine;
      const pos = rk && !oc ? '<span class="pos"><b>' + esc(horseOf(R, v.first).no) + '番</b> ' + esc(fill(TX.now, { r: rk[v.first] })) + ' <b>' + esc(horseOf(R, v.second).no) + '番</b> ' + esc(fill(TX.now, { r: rk[v.second] })) + '</span>' : '';
      const st = p ? (p.win ? ' hit' : ' miss') : rk && rk[v.first] === 1 && rk[v.second] === 2 ? ' hot' : '';
      lines += '<div class="wv' + st + '"><span class="k">' + esc(lb) + '</span><span class="cb"><small>1着</small>' + chip(R, v.first) + '<em>→</em><small>2着</small>' + chip(R, v.second) + '</span>' +
        '<span class="od">' + (od.o ? '<b>' + esc(oddsTxt(od.o)) + '</b>倍' : '') + '</span>' +
        (p ? '<span class="pt">' + (p.win ? esc(TX.hit) + ' <b>' + amt(p.amount) + '</b>pt' : esc(TX.miss)) + '</span>' : od.o ? '<span class="pt">当たれば <b>' + amt(payFor(od.o)) + '</b>pt</span>' : '') + pos + '</div>';
    });
    if (list.length > 3) lines += '<div class="wv more">' + esc(fill(TX.more, { n: list.length - 3 })) + '</div>';
    setHtml('wLines', 'lines', lines);
    { const nv = String(Math.min(3, Math.max(1, list.length))); if ($('wLines').dataset.n !== nv) $('wLines').dataset.n = nv; } // 票の数で大きさを変える（watch.css）
    /* 順位の表（2026-10-30 オーナー「上がレースの絵・まん中に順位の表・下に大きく自分の予想」）: レース中はいまの順位（1 秒に 5 回まで）、ゴールのあとは着順、
       それより前（投票中・ゲート）は出走馬の番号と名前。自分の予想の馬は金の枠 */
    const mineIdx = list.reduce((a, v) => a.concat([v.first, v.second]), []);
    let ordIdx = null, ordHead = '';
    if (rk) { ordIdx = rk.map((r, i) => [r, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); ordHead = '位'; }
    else if (R.result && R.result.order && (D.phase === 'result' || (R.revealAt && D.now() >= R.revealAt))) { ordIdx = R.result.order.slice(); ordHead = '着'; }
    const ord = ordIdx ? ordIdx.map((i, k) => '<div class="r' + (k === 0 ? ' lead' : '') + (mineIdx.indexOf(i) >= 0 ? ' me' : '') + '"><b>' + (k + 1) + ordHead + '</b>' + chip(R, i) + '<span class="nm">' + esc(horseOf(R, i).name) + '</span></div>').join('')
      : (R.horses || []).map((h, i) => '<div class="r' + (mineIdx.indexOf(i) >= 0 ? ' me' : '') + '">' + chip(R, i) + '<span class="nm">' + esc(h.name) + '</span></div>').join('');
    setHtml('wOrd', 'ord', ord);
    // 初参加ボーナス（2 票目）がまだ入れられる: 投票ページへ戻るボタン（自動で開いた窓でも 2 票目を逃さない）
    let bn = ''; try { const B = parentBet(); if (B && B.bonus && B.bonus(R.id)) bn = '<button type="button" class="wbonus" data-wact="back"><b>初参加ボーナス：もう1票</b><span>投票ページで選ぶ ›</span></button>'; } catch (e) { bn = ''; }
    setHtml('wBonus', 'bonus', bn);
    // 盛り上げ: 当たりの形！（どれかの票の 1・2 着が予想どおり）／あと少し！（どれかの馬が 2 着以内）
    let hype = '';
    if (rk && !oc) {
      const hot = list.some((v) => rk[v.first] === 1 && rk[v.second] === 2), near = list.some((v) => rk[v.first] <= 2 || rk[v.second] <= 2);
      hype = hot ? '<b class="hb hot">' + esc(TX.hot) + '</b>' : near ? '<b class="hb near">' + esc(TX.near) + '</b>' : '';
    }
    setHtml('wHype', 'hype', hype);
    // 結果
    let res = '';
    if (oc) {
      if (oc.voided) res = '<div class="wr calm"><b>' + esc(TX.voided) + '</b></div>';
      else res = '<div class="wr ' + (oc.wins.length ? 'hit' : 'calm') + '"><b>' + esc(oc.wins.length ? TX.hit : oc.near ? TX.close : TX.miss) + '</b>' + (oc.wins.length ? '<span class="am">' + amt(oc.total) + '<small>pt</small></span>' : '<span class="rs">' + esc(TX.result) + ' ' + chip(R, oc.res.winner) + '<em>→</em>' + chip(R, oc.res.second) + '</span>') + (oc.test ? '<small class="tst">' + esc(TX.test) + '</small>' : '') + '</div>';
      res += '<button type="button" class="wbig" data-wact="back">' + esc(TX.backBig) + '</button>';
      if (!celeDone[R.id]) { celeDone[R.id] = true; cele(R, oc); }
    }
    setHtml('wRes', 'res', res);
    markRank(list.reduce((a, v) => a.concat([horseOf(R, v.first).no, horseOf(R, v.second).no]), []).map(String));
  }
  // 左上の順位の札（v2/tv.js の #rankPanel）で、自分の馬に光る輪
  function markRank(nos) {
    const k = nos.join(','); const L = document.querySelectorAll('#rankPanel .rr i');
    L.forEach((e) => { const on = nos.indexOf(e.textContent) >= 0; if (e.classList.contains('wme') !== on) e.classList.toggle('wme', on); });
    last.rk = k;
  }
  /* 結果の知らせ（短く）: 当たりは紙吹雪と「的中！ ○○pt」、はずれは落ち着いた「おしい！」「ハズレ」。8 秒で閉じる（押しても閉じる） */
  let celeT = 0;
  function cele(R, oc) {
    const box = $('wCele'); clearTimeout(celeT);
    let h;
    if (oc.voided) h = '<div class="box calm"><b class="t">' + esc(TX.voided) + '</b>';
    else if (oc.wins.length) {
      const cols = ['#ffd84a', '#ff5d5d', '#4fc3ff', '#7cff6b', '#ffffff', '#ff9bd6'];
      let cf = ''; for (let i = 0; i < 36; i++) cf += '<i style="left:' + ((i * 37) % 100) + '%;background:' + cols[i % cols.length] + ';animation-delay:' + ((i % 9) * 0.09).toFixed(2) + 's;animation-duration:' + (1.8 + (i % 5) * 0.25).toFixed(2) + 's"></i>';
      h = '<div class="cf" aria-hidden="true">' + cf + '</div><div class="box hit"><small>' + esc(TX.congrats) + '</small><b class="t">' + esc(TX.hit) + '</b><div class="am">' + amt(oc.total) + '<small>pt</small></div>' + (oc.test ? '<span>' + esc(TX.test) + '</span>' : '<span>' + esc(TX.claim) + '</span>');
    } else h = '<div class="box calm"><b class="t">' + esc(oc.near ? TX.close : TX.miss) + '</b><span>' + esc(TX.result) + ' ' + chip(R, oc.res.winner) + '<em>→</em>' + chip(R, oc.res.second) + '</span>';
    h += '<div class="bt"><button type="button" class="wbig" data-wact="back">' + esc(TX.backBig) + '</button><button type="button" class="wbig ghost" data-wact="cele">' + esc(TX.closeBtn) + '</button></div></div>';
    box.innerHTML = h; box.className = 'wcele' + (oc.wins.length ? ' hit' : ''); box.hidden = false;
    celeT = setTimeout(hideCele, 8000);
  }
  function hideCele() { const b = $('wCele'); if (!b.hidden) { b.hidden = true; b.innerHTML = ''; } }
  ui.addEventListener('click', (e) => { const b = e.target.closest('[data-wact]'); if (!b) return; if (b.dataset.wact === 'back') goBack(); else if (b.dataset.wact === 'cele') hideCele(); });

  // ログインが無い（投票ページの匿名ログインが無いブラウザ）: 1 回だけ確かめる
  if (C && C.state) C.state().catch((e) => { if (e && e.status === 401) loginErr = true; });
  setInterval(() => { try { render(); } catch (e) { console.error(e); } }, 200);
  window.DerbyWatch = { get noGl() { return noGl; }, fit, layout: relayout, render, pickFocus, ranks, outcome, get focus() { return focus; }, inBet: IN_BET, TX };
  relayout();
})();
