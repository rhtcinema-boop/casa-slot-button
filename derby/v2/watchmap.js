/* casa DERBY スマホの「レースを見る」の図の表示（v2/watchmap.html。2026-10-30 オーナー「簡単なレース上の絵と、図が動く感じで」
   「競馬場を真上から見た感じで、数字の書いてある丸い図形が動いて誰が先頭走ってるかわかる」）
   - コースを真上から見た絵（芝・ダートの色・スタート・ゴール・残り 400m／200m）は 1 回だけ描いて覚える。馬は番号の丸（枠の色・勝負服の色の輪）。
     先頭の丸は少し大きく、上に「先頭」の札。自分の予想の馬は金の光。1 秒に 30 回まで描き直す（小さなキャンバス 1 枚）。
   - 走りはテレビと同じ: 決める係の本物の結果（seed と着順）から Engine.replayRun で同じ走りを作り、ゲートが開いてからの時刻（サーバーの時計）に合わせる。
     ゴール前のスロー（テレビの 3D と同じ式 slowStep。js/race3d.js の slowStep の写し）も同じに進めるので、テレビの映像と同じ瞬間に同じ位置。
   - 場面: 投票中＝パドックの代わりに出馬表の札（番号・名前・脚質・調子・人気の組み合わせ）／締切〜発走＝丸がゲートに並ぶ／レース＝動く／
     ゴール＝1 着・2 着の札／発表のあと＝「的中！ ○○pt」かハズレ（決まった本物の結果だけで判定。当選額は投票ページの票の額か DerbyForm.payFor）
   - 見られるかの確かめ・自分の票・何も書かないこと・ログインは v2/watch.js（3D の表示）と同じ（role 'watch'。投票ページの Firebase をそのまま使う）。
   - 3D の部品・テレビの画面・音・大きな文字のファイルは読まない（メモリーを少なく）。「3Dで見る」で 3D の表示へ切り替えられる（2026-10-30 本番も）。確認用に window.DerbyMap */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const QS = location.search, qp = new URLSearchParams(QS);
  const STORE = (qp.get('store') || '').trim().toLowerCase();
  const DC = window.DerbyCloud || null, F = window.DerbyForm || null, E = window.Engine, CO = window.R3D && R3D.Course;
  const DEMO = !!(window.DERBY_FIREBASE && window.DERBY_FIREBASE.demo);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const payFor = (o) => (F ? F.payFor(o) : Math.ceil(Math.max(10, Math.round(Number(o) * 10)) / 10 - 1e-9) * 100);
  const oddsTxt = (o) => (F ? F.odds(o) : (Number(o) > 0 ? (Math.round(Number(o) * 10) / 10).toFixed(1) : '—'));
  const pad2 = (n) => ('0' + n).slice(-2);
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + pad2(s % 60); };
  const C = DC && STORE ? DC.create({ store: STORE, role: 'watch' }) : null;
  const now = () => (C ? C.serverNow() : Date.now());

  /* ---------- 戻る・3D へ（デモだけ） ---------- */
  function parentBet() { try { const P = window.parent; if (P && P !== window && P.BETWATCH) { void P.location.href; return P.BETWATCH; } } catch (e) { /* 別のサイト */ } return null; }
  const keep = ['cloud', 'mute'].map((k) => (qp.get(k) ? '&' + k + '=' + encodeURIComponent(qp.get(k)) : '')).join('');
  function goBack() { const B = parentBet(); if (B && B.close) { try { B.close(); return; } catch (e) { /* 下へ */ } } location.href = 'bet.html?store=' + encodeURIComponent(STORE) + keep; }
  $('mBack').addEventListener('click', goBack); $('mLockB').addEventListener('click', goBack);
  // 「3Dで見る」（2026-10-30 本番も）: テレビと同じ画面（本番は ../index.html?watch=1・Web デモは ../tv.html）。選んだ表示はこの端末に覚える（casa.derby.watchView）
  $('m3d').hidden = false; $('m3d').addEventListener('click', () => { try { localStorage.setItem('casa.derby.watchView', '3d'); } catch (e) { /* noop */ } location.replace((DEMO ? '../tv.html' : '../index.html') + '?store=' + encodeURIComponent(STORE) + '&watch=1' + (qp.get('race') ? '&race=' + encodeURIComponent(qp.get('race')) : '') + keep); });

  /* ---------- 状態 ---------- */
  let S = null, loginErr = false;
  const cache = {};
  const keepRace = (r) => { if (!r || !r.id) return r; const o = cache[r.id]; cache[r.id] = o ? Object.assign(o, r, { result: r.result || o.result || null }) : r; return cache[r.id]; };
  function gotState(s) { if (!s) return; S = s; ['open', 'live', 'last', 'next', 'watch'].forEach((k) => { if (s[k]) s[k] = keepRace(s[k]); }); }
  let stopSub = null;
  if (C) {
    C.state().then(gotState, (e) => { if (e && e.status === 401) loginErr = true; });
    try { stopSub = C.subscribe({ state: gotState, race: keepRace, error() {} }); } catch (e) { /* 下の読み直しで */ }
    setInterval(() => { C.state().then(gotState, () => {}); }, 10000);
    if (C.syncClock) setInterval(() => { C.syncClock().catch(() => {}); }, 5 * 60000);
  }
  window.__derbyWatchStop = () => { const f = stopSub; stopSub = null; if (f) { try { f(); } catch (e) { /* noop */ } } };
  window.addEventListener('pagehide', () => window.__derbyWatchStop());
  // 結果（seed）: ゲートが開く 2 秒前から読める。状態に付いていなければ 1 秒ごとに読みに行く
  let fetching = false;
  function needResult(R) {
    if (!C || fetching || !R || (R.result && R.result.seed != null) || now() < R.runAt - 2000 || R.refunded) return;
    fetching = true; C.race(R.id).then((r) => { keepRace(r); }, () => {}).then(() => { setTimeout(() => { fetching = false; }, 1000); });
  }

  /* ---------- 自分の票（v2/watch.js と同じ） ---------- */
  const norm = (v) => (v ? { first: v.first, second: v.second, bill: v.bill, nick: v.nick, n: v.n === 2 ? 2 : 1, result: v.result ? { win: !!v.result.win, amount: Number(v.result.amount) || 0, test: !!v.result.test } : null } : null);
  const own = {};
  function votesFor(R) {
    const id = R.id, B = parentBet();
    if (B) { try { const L = B.votes(id); if (L && L.length) return { list: L.map(norm).filter(Boolean), pending: false }; } catch (e) { /* 下へ */ } }
    let m = null; try { m = (B && B.mv && B.mv(id)) || (DC && DC.myVotes && DC.myVotes.get(id)); } catch (e) { m = null; }
    if (!m || !m.vid || !C) return null;
    const c = own[id], needRe = c && c.list && !c.revealed && R.revealAt && now() > R.revealAt + 2500 && !c.p;
    if (!c || needRe) {
      const o = own[id] = Object.assign(c || {}, { p: true });
      C.myVote(m.vid, m.key).then((d) => { o.p = false; o.list = [d && d.vote, d && d.vote2].filter(Boolean).map(norm); o.revealed = !!(R.revealAt && now() > R.revealAt); }, (e) => { o.p = false; if (e && (e.status === 404 || e.code === 'no_vote')) { o.list = []; o.gone = true; } else setTimeout(() => { if (own[id] === o && !o.list) delete own[id]; }, 5000); });
    }
    const cc = own[id]; if (cc && cc.gone) return null;
    return { list: (cc && cc.list) || [], pending: !(cc && cc.list) };
  }
  const endOf = (r) => r.endAt || (r.revealAt ? r.revealAt + 300000 : (r.closeAt || 0) + 15 * 60000);
  let focus = null, ever = false;
  function pickFocus() {
    if (!S) return { why: loginErr ? 'login' : 'load' };
    const t = now(), L = [S.live, S.open && t < S.open.closeAt ? S.open : null, S.last && S.last.revealAt && t < endOf(S.last) ? S.last : null];
    if (focus && t < endOf(focus.race)) L.push(focus.race);
    const seen = {};
    for (const r0 of L) { if (!r0 || !r0.id || seen[r0.id]) continue; seen[r0.id] = 1; const r = cache[r0.id] || r0, v = votesFor(r); if (v) return { race: r, votes: v }; }
    return { why: loginErr ? 'login' : ever ? 'over' : 'novote' };
  }

  /* ---------- 走り（テレビと同じ） ---------- */
  /* ゴール前のスロー: js/race3d.js の slowStep と同じ式（テレビの 3D の映像と同じ時間割にするため。あちらを変えたらここも） */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), BASHIN = 2.4, SIM_DT = 1 / 60;
  function slowStep(st, run, race, real) {
    let a = -1, b = -1, c = -1; for (let i = 0; i < run.n; i++) { const p = run.pos[i]; if (a < 0 || p > run.pos[a]) { c = b; b = a; a = i; } else if (b < 0 || p > run.pos[b]) { c = b; b = i; } else if (c < 0 || p > run.pos[c]) c = i; }
    if (run.done === 1 && c >= 0) {
      const left2 = (1 - run.pos[b]) * race.dist, g23 = (run.pos[b] - run.pos[c]) * race.dist;
      if (!st.lock2 && !st.lock2Done && left2 < 20 && g23 < BASHIN) st.lock2 = true;
      if (st.lock2 && g23 > BASHIN * 1.5) { st.lock2 = false; st.lock2Done = true; }
      if (st.lock2) { st.slowLock = true; const u2 = clamp((23 - left2) / 11.5, 0, 1), t2 = 1 - 0.58 * u2 * u2 * (3 - 2 * u2); st.slow += (t2 - st.slow) * Math.min(1, real * (t2 < st.slow ? 7 : 4)); return; }
    } else if (run.done >= 2 && st.lock2) { st.lock2 = false; st.lock2Done = true; }
    const leadLeft = (1 - run.pos[a]) * race.dist;
    if (run.done || leadLeft >= 45) st.slowLock = false; else st.slowLock = true;
    const slowU = clamp((23 - leadLeft) / 11.5, 0, 1), targetSlow = (!run.done && leadLeft < 45 && st.slowLock) ? 1 - 0.58 * slowU * slowU * (3 - 2 * slowU) : 1;
    st.slow += (targetSlow - st.slow) * Math.min(1, real * (targetSlow < 1 ? 7 : 4));
  }
  /* レース 1 つ分の走り: run（位置）と、ゲートが開いてからの実時間（1/60 秒ごと）→ 走りの時刻 の表 */
  let SIM = null;
  function simFor(R) {
    const res = R.result; if (!res || res.seed == null || !E) return null;
    if (SIM && SIM.id === R.id) return SIM;
    const run = E.replayRun(R, res.seed, { order: res.order }), tl = E.replayRun(R, res.seed, { order: res.order }), st = { slow: 1, slowLock: false }, T = [];
    for (let k = 0; k < 60 * 300; k++) { T.push(tl.t); slowStep(st, tl, R, SIM_DT); const all = tl.step(SIM_DT * st.slow); if (all && tl.t > tl.duration + 0.5) break; }
    SIM = { id: R.id, run, T, finishTimes: run.finishTimes };
    return SIM;
  }
  function simAt(sim, wall) { const T = sim.T, x = wall / SIM_DT, k = Math.floor(x); if (k < 0) return 0; if (k >= T.length - 1) return T[T.length - 1] + (x - (T.length - 1)) * SIM_DT; return T[k] + (T[k + 1] - T[k]) * (x - k); }

  /* ---------- コースの絵（真上から。1 回だけ描く） ---------- */
  const cv = $('mCv'), ctx = cv.getContext('2d');
  const XR = CO ? CO.LS / 2 + CO.RO + 12 : 290, ZR = CO ? CO.RO + 10 : 82, ZK = 1.7; // 横 ±XR m・縦 ±ZR m（縦は 1.7 倍にして見やすく）
  let W = 0, H = 0, K = 1, dpr = 1, bg = null, bgKey = '';
  const toPx = (x, z) => [W / 2 + x * K, H / 2 + 8 + z * K * ZK]; // 上に「先頭」の札の分の余白
  function sizeCanvas() {
    const w = Math.max(200, Math.round(cv.parentNode.clientWidth || 360));
    dpr = Math.min(2, window.devicePixelRatio || 1); W = w; K = (w - 16) / (2 * XR); H = Math.round(2 * ZR * K * ZK + 32);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
    bgKey = '';
  }
  function drawCourse(R) {
    const key = W + 'x' + H + '|' + (R && R.surface) + '|' + (R && R.dist);
    if (bg && bgKey === key) return; bgKey = key;
    bg = document.createElement('canvas'); bg.width = cv.width; bg.height = cv.height;
    const g = bg.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = '#2d6a2a'; g.fillRect(0, 0, W, H);
    if (!CO) return;
    const ring = (r) => { g.beginPath(); for (let s = 0; s <= CO.L; s += 6) { const p = CO.pointAt(s, r), q = toPx(p.x, p.z); if (s === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); } g.closePath(); };
    const dirt = R && R.surface === 'dirt';
    g.fillStyle = dirt ? '#b98a55' : '#4fae45'; ring(CO.RO); g.fill(); // 走路
    g.fillStyle = '#3a8a35'; ring(CO.RI); g.fill(); // 内馬場
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; ring(CO.RO); g.stroke(); ring(CO.RI); g.stroke();
    // スタンド（ホームストレッチの外）
    const st0 = toPx(-130, CO.RO + 3), st1 = toPx(130, CO.RO + 8); g.fillStyle = '#d9dee6'; g.fillRect(st0[0], st0[1], st1[0] - st0[0], Math.max(4, st1[1] - st0[1]));
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('スタンド', (st0[0] + st1[0]) / 2, Math.min(H - 3, st1[1] + 11));
    const across = (s, color, w) => { const a = CO.pointAt(s, CO.RI), b = CO.pointAt(s, CO.RO), p = toPx(a.x, a.z), q = toPx(b.x, b.z); g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); return [p, q]; };
    const label = (s, text, color, out) => { const b = CO.pointAt(s, out ? CO.RO + 9 : CO.RI - 9), q = toPx(b.x, b.z); g.fillStyle = color; g.font = '900 10px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(text, q[0], q[1] + 4); };
    // 残り 400m・200m・ゴール
    [[400, '残り400m'], [200, '残り200m']].forEach(([m, t]) => { if (!R || m < R.dist) { across(CO.FINISH_S - m, 'rgba(255,255,255,.85)', 1.5); label(CO.FINISH_S - m, t, '#fff', false); } });
    across(CO.FINISH_S, '#ff3b30', 3); label(CO.FINISH_S, 'ゴール', '#ffd84a', false);
    if (R && R.dist) { const s = CO.gateS(R.dist); across(s, '#1d2433', 4); label(s, 'スタート', '#fff', false); }
  }

  /* ---------- 丸（馬）を描く ---------- */
  const horseOf = (R, i) => (R && R.horses && R.horses[i]) || { no: i + 1, color: '#555', ink: '#fff', name: '' };
  const laneR = (i) => (CO ? CO.laneR(i) : 40);
  /* 丸の置き場所。p: 見せる進み（0〜1。下の「差を広げる」をしたあと）・rank: いまの順位（0 が先頭）。
     ゲートの前は、ゲートの後ろに 1 列に並べる（同じ所に重ねない）。走り出したら順位で内・中・外に分けて重なりを減らす */
  function placeOf(R, i, p, gate, rank, rad) {
    if (!CO) return [0, 0];
    if (gate) { const back = (i + 0.6) * (2.3 * rad / K); const pt = CO.pointAt(CO.gateS(R.dist) - back, CO.RI + 7); return toPx(pt.x, pt.z); }
    const d = Math.max(0, p) * R.dist, s = CO.gateS(R.dist) + Math.min(p, 1.25) * R.dist;
    const r0 = laneR(i), lane = CO.RI + 2 + (rank % 3) * 5, k = Math.min(1, d / 160);
    const pt = CO.pointAt(s, r0 + (lane - r0) * k);
    return toPx(pt.x, pt.z);
  }
  /* 差を広げる（図だけ）: 本物の差のままだと小さな画面では丸が重なって誰が先頭か分からない → 先頭からの差を何倍かにして見せる。
     順位・時刻・走りはテレビと同じ（見せる間隔だけ）。倍率は群れの長さに合わせて 1〜10 倍（ゆっくり変える）。
     ゴールした馬は、ゴールの先に着順の順で並べる（1 着がいちばん先。同じ所に重ねない） */
  let EXs = 1;
  function spread(pos, fin, gapM) {
    const n = pos.length; if (!n) return pos;
    const fo = (fin || []).map((f, i) => [f, i]).filter((x) => x[0] > 0).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    let hi = -1, lo = 9; for (let i = 0; i < n; i++) { hi = Math.max(hi, pos[i]); lo = Math.min(lo, pos[i]); }
    const lead = Math.min(hi, 1.05), field = Math.max(1, (Math.min(hi, 1) - lo) * (curDist || 1000)), want = clamp(300 / field, 1, 10);
    EXs += (want - EXs) * 0.06;
    const lead1 = fo.length ? 1 : lead;
    return pos.map((p, i) => { const k = fo.indexOf(i); if (k >= 0) return 1 + (fo.length - k - 0.5) * gapM / (curDist || 1000); return Math.max(-0.02, Math.min(0.995, lead1 - (lead1 - Math.min(p, 1)) * EXs)); });
  }
  let curDist = 1000;
  /* ゴールした馬（2026-10-30 見直し）: ゴール板の内側（内馬場のゴールのすぐ手前）に、着順の 2 段の並び（上の段 1〜3 着・下の段 4〜6 着。1 着がいちばんゴール寄り）へ
     0.8 秒かけて寄せる。以前はゴールの先のコースに並べたので、6 頭だと最初のコーナーを回ってスタートの近くまで届いていた。札（1着・2着）は丸の上に重ならずに出る */
  function finSlot(R, i, info, rad) {
    if (!CO || info.gate || !info.fin || !(info.fin[i] > 0)) return null;
    const order = info.fin.map((f, j) => [f, j]).filter((x) => x[0] > 0).sort((a, b) => a[0] - b[0]).map((x) => x[1]), k = order.indexOf(i);
    const gx = 2.5 * rad / K, gz = (2.4 * rad + 14) / (K * ZK); // 横の間（丸 1 つ＋すき間）・縦の間（丸 1 つ＋札の高さ）
    const x = CO.LS / 2 - 0.9 * gx - (k % 3) * gx, z = CO.RI - 0.55 * gz - Math.floor(k / 3) * gz;
    const slot = toPx(x, z), line = placeOf(R, i, 1, false, k, rad), u = clamp(((info.t || 0) - info.fin[i]) / 0.8, 0, 1), e = u * u * (3 - 2 * u);
    return [line[0] + (slot[0] - line[0]) * e, line[1] + (slot[1] - line[1]) * e];
  }
  let mineNos = [];
  function drawFrame(R, pos, info) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    if (bg) ctx.drawImage(bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!R || !R.horses) return;
    const n = R.horses.length, idx = []; for (let i = 0; i < n; i++) idx.push(i);
    idx.sort((a, b) => pos[a] - pos[b]); // 先頭を最後に（いちばん上に）描く
    const rad = Math.max(8, Math.min(12, W / 36)), rankOf = {}; (info.order || idx.slice().reverse()).forEach((i, k) => { rankOf[i] = k; });
    curDist = R.dist || 1000; const shown = info.gate ? pos : spread(pos, info.fin, 2.3 * rad / K);
    idx.forEach((i) => {
      const h = horseOf(R, i), q = finSlot(R, i, info, rad) || placeOf(R, i, shown[i], info.gate, rankOf[i] || 0, rad), lead = info.leader === i, r = lead ? rad * 1.28 : rad, mine = mineNos.indexOf(i) >= 0;
      if (mine) { ctx.beginPath(); ctx.arc(q[0], q[1], r + 5, 0, 6.2832); ctx.fillStyle = 'rgba(255,216,74,.45)'; ctx.fill(); }
      ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 6.2832); ctx.fillStyle = (h.silk && h.silk.base) || h.color; ctx.fill(); // 外の輪: 勝負服の色
      ctx.beginPath(); ctx.arc(q[0], q[1], r - 2.6, 0, 6.2832); ctx.fillStyle = h.color; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.stroke(); // 中: 枠の色
      ctx.fillStyle = h.ink; ctx.font = '900 ' + Math.round(r * 1.15) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(h.no), q[0], q[1] + 0.5);
      const tag = info.tags && info.tags[i];
      if (tag) { ctx.font = '900 11px system-ui, sans-serif'; const tw = ctx.measureText(tag).width + 10, y = q[1] - r - 11; ctx.fillStyle = tag === '1着' || tag === '先頭' ? '#ffd84a' : tag === '2着' ? '#dfe7f3' : '#fff'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(q[0] - tw / 2, y - 8, tw, 16, 8); else ctx.rect(q[0] - tw / 2, y - 8, tw, 16); ctx.fill(); ctx.fillStyle = '#2a1c00'; ctx.fillText(tag, q[0], y + 0.5); }
    });
  }

  /* ---------- 画面 ---------- */
  const chip = (R, i) => { const h = horseOf(R, i); return '<i class="wk" style="background:' + esc(h.color) + ';color:' + esc(h.ink) + '">' + esc(h.no) + '</i>'; };
  const last = {};
  const setHtml = (id, html) => { if (last[id] === html) return; last[id] = html; $(id).innerHTML = html; };
  const setTxt = (id, t) => { if (last[id] === t) return; last[id] = t; $(id).textContent = t; };
  function lock(why) {
    const t = why === 'load' ? ['読み込み中…', ''] : why === 'login' ? ['投票した方だけ見られます', '投票したスマホのブラウザで、投票ページから開いてください'] : why === 'over' ? ['このレースは終わりました', '次のレースも投票すると見られます'] : ['投票した方だけ見られます', '投票ページで投票すると、このレースを見られます'];
    $('mLock').dataset.why = why; setTxt('mLockT', t[0]); setTxt('mLockS', t[1]); $('mLock').classList.add('show');
  }
  function oddsOf(R, v) { const res = R.result, k = v.first + '-' + v.second; if (res && res.finalExacta && Number(res.finalExacta[k]) > 0) return Number(res.finalExacta[k]); const o = R.exacta && Number(R.exacta[k]); return o > 0 ? o : null; }
  function outcome(R, list) {
    const res = R.result, t = now();
    if (!res || res.seed == null || !(R.revealAt && t >= R.revealAt + 3200)) return null;
    if (R.refunded) return { voided: true, per: [], wins: [] };
    const per = list.map((v) => { const win = v.result ? v.result.win : v.first === res.winner && v.second === res.second; const amount = win ? (v.result && v.result.amount) || payFor(res.comboOdds || (res.finalExacta && res.finalExacta[res.winner + '-' + res.second])) : 0; const near = !win && (v.first === res.winner || v.second === res.second || (v.first === res.second && v.second === res.winner)); return { v, win, amount, near }; });
    const wins = per.filter((x) => x.win);
    return { per, wins, total: wins.reduce((a, x) => a + x.amount, 0), near: !wins.length && per.some((x) => x.near), test: !!R.test, res };
  }
  const celeDone = {};
  let celeT = 0;
  function cele(R, oc) {
    let h;
    if (oc.voided) h = '<div class="box"><b class="t">このレースは取り消しになりました</b>';
    else if (oc.wins.length) { const cols = ['#ffd84a', '#ff5d5d', '#4fc3ff', '#7cff6b', '#ffffff', '#ff9bd6']; let cf = ''; for (let i = 0; i < 36; i++) cf += '<i style="left:' + ((i * 37) % 100) + '%;background:' + cols[i % 6] + ';animation-delay:' + ((i % 9) * 0.09).toFixed(2) + 's;animation-duration:' + (1.8 + (i % 5) * 0.25).toFixed(2) + 's"></i>'; h = '<div class="cf" aria-hidden="true">' + cf + '</div><div class="box hit"><small>おめでとう！</small><b class="t">的中！</b><div class="am">' + amt(oc.total) + '<small>pt</small></div><span>' + (oc.test ? 'テストレース（受け取りはありません）' : '投票ページで受け取りの画面を出せます') + '</span>'; }
    else h = '<div class="box"><b class="t">' + (oc.near ? 'おしい！' : 'ハズレ') + '</b><span>結果 ' + chip(R, oc.res.winner) + '<em>→</em>' + chip(R, oc.res.second) + '</span>';
    h += '<div class="bt"><button type="button" class="wbig" data-act="back">投票ページへ戻る</button><button type="button" class="wbig ghost" data-act="close">閉じる</button></div></div>';
    const box = $('mCele'); box.innerHTML = h; box.hidden = false; clearTimeout(celeT); celeT = setTimeout(() => { box.hidden = true; box.innerHTML = ''; }, 8000);
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (!b) return; if (b.dataset.act === 'back') goBack(); else if (b.dataset.act === 'close') { $('mCele').hidden = true; $('mCele').innerHTML = ''; } });

  function padHtml(R) {
    const rows = (R.horses || []).map((h, i) => { const ty = F && F.typeOf ? F.typeOf(h) : { label: '', color: '#ccc' }; return '<div class="h">' + chip(R, i) + '<span class="nm">' + esc(h.name) + '</span>' + (ty.label ? '<span class="ty" style="background:' + esc(ty.color) + '">' + esc(ty.label) + '</span>' : '') + '<span class="cd">' + esc(h.cond && h.cond.mark ? h.cond.mark + (h.cond.label || '') : '') + '</span></div>'; }).join('');
    const top = (R.exactaTop || []).slice(0, 6).map((x) => '<span>' + chip(R, x.first) + '<em>→</em>' + chip(R, x.second) + ' ' + esc(oddsTxt(x.odds)) + '倍</span>').join('');
    return '<h3>出馬表</h3>' + rows + (top ? '<div class="x6"><b>人気の組み合わせ</b>' + top + '</div>' : '');
  }

  /* ---------- 1 コマ（30 回/秒）と 文字（5 回/秒） ---------- */
  let lastUi = 0, lastDraw = 0, curPos = null, curInfo = { gate: true };
  function frame(ts) {
    requestAnimationFrame(frame);
    if (ts - lastDraw < 30) return; lastDraw = ts;
    try { tick(ts); } catch (e) { console.error(e); }
  }
  function tick(ts) {
    const f = pickFocus();
    if (!f.race) { focus = null; lock(f.why); return; }
    focus = f; ever = true; $('mLock').classList.remove('show');
    const R = f.race, t = now(), list = f.votes.list;
    mineNos = list.reduce((a, v) => a.concat([v.first, v.second]), []);
    needResult(R);
    if (!W || Math.abs((cv.parentNode.clientWidth || 0) - W) > 2) sizeCanvas();
    drawCourse(R);
    const n = (R.horses || []).length, sim = simFor(R);
    let pos = new Array(n).fill(0), info = { gate: true, tags: {} }, phase, rk = null, leftM = null;
    if (t < R.closeAt) phase = 'open';
    else if (t < R.runAt || !sim) phase = t < R.runAt ? 'gate' : 'hold';
    else {
      const wall = (t - R.runAt) / 1000, st = simAt(sim, wall); sim.run.seek(st);
      pos = sim.run.pos.slice(); info.gate = false;
      const fin = sim.run.finish, idx = pos.map((_, i) => i).sort((a, b) => { const fa = fin[a] > 0, fb = fin[b] > 0; if (fa && fb) return fin[a] - fin[b]; if (fa !== fb) return fa ? -1 : 1; return pos[b] - pos[a]; });
      rk = []; idx.forEach((i, k) => { rk[i] = k + 1; });
      info.fin = fin.slice(); info.t = sim.run.t; const anyFin = fin.some((x) => x > 0);
      if (anyFin) { info.tags[idx[0]] = '1着'; if (fin[idx[1]] > 0) info.tags[idx[1]] = '2着'; phase = t >= R.revealAt ? 'result' : 'finish'; }
      else { info.leader = idx[0]; info.tags[idx[0]] = '先頭'; leftM = Math.max(0, Math.round((1 - pos[idx[0]]) * R.dist)); phase = 'run'; }
      if (wall < 1.5) rk = null;
      info.order = idx;
    }
    curPos = pos; curInfo = info;
    drawFrame(R, pos, info);
    if (ts - lastUi < 200) return; lastUi = ts;
    // 上の札と時計
    const TAG = { open: ['投票受付中', ''], gate: ['締切・まもなく発走', 'hot'], hold: ['まもなく スタート', 'hot'], run: ['LIVE レース中', 'live'], finish: ['ゴール', 'live'], result: ['レース結果', 'res'] }[phase];
    setTxt('mTag', TAG[0]); $('mTag').className = 'tag ' + TAG[1];
    setTxt('mTitle', (R.surface === 'dirt' ? 'ダート' : '芝') + R.dist + 'm');
    setHtml('mClk', phase === 'open' ? '<small>締切まで</small>' + mmss(R.closeAt - t) : phase === 'gate' ? '<small>発走まで</small>' + mmss(R.runAt - t) : phase === 'run' || phase === 'finish' ? (Math.max(0, (t - R.runAt) / 1000)).toFixed(1) + '<small>秒</small>' : '');
    setTxt('mHold', phase === 'hold' ? 'まもなく スタート（そのまま お待ちください）' : phase === 'gate' ? 'ゲートに入りました' : '');
    // 出馬表（投票中）
    $('mPad').hidden = phase !== 'open'; if (phase === 'open') setHtml('mPad', padHtml(R));
    // 順位（1位〜6位）と先頭の残り
    const order = info.order || (R.horses || []).map((_, i) => i);
    setHtml('mOrd', info.order ? order.map((i, k) => '<div class="r' + (k === 0 ? ' lead' : '') + (mineNos.indexOf(i) >= 0 ? ' me' : '') + '"><b>' + (k + 1) + '位</b>' + chip(R, i) + '<span class="nm">' + esc(horseOf(R, i).name) + '</span></div>').join('') : '');
    setHtml('mLeft', leftM != null ? '先頭 ' + chip(R, info.leader) + ' ゴールまで <b>' + leftM + '</b>m' : '');
    // 自分の予想・盛り上げ・結果
    const oc = outcome(R, list);
    let mine = f.votes.pending && !list.length ? '<div class="wv">あなたの予想を読み込み中…</div>' : '';
    list.slice(0, 3).forEach((v, k) => {
      const o = oddsOf(R, v), p = oc && oc.per ? oc.per[k] : null, lb = list.length > 1 ? (v.n === 2 ? '2票目' : k === 0 ? 'あなたの予想' : '予想' + (k + 1)) : 'あなたの予想';
      const pos2 = rk && !oc ? '<span class="pos"><b>' + esc(horseOf(R, v.first).no) + '番</b> いま' + rk[v.first] + '位 <b>' + esc(horseOf(R, v.second).no) + '番</b> いま' + rk[v.second] + '位</span>' : '';
      const cls = p ? (p.win ? ' hit' : ' miss') : rk && rk[v.first] === 1 && rk[v.second] === 2 ? ' hot' : '';
      mine += '<div class="wv' + cls + '"><span class="k">' + esc(lb) + '</span><span class="cb"><small>1着</small>' + chip(R, v.first) + '<em>→</em><small>2着</small>' + chip(R, v.second) + '</span>' + '<span class="od">' + (o ? '<b>' + esc(oddsTxt(o)) + '</b>倍' : '') + '</span>' + (p ? '<span class="pt">' + (p.win ? '的中！ <b>' + amt(p.amount) + '</b>pt' : 'ハズレ') + '</span>' : o ? '<span class="pt">当たれば <b>' + amt(payFor(o)) + '</b>pt</span>' : '') + pos2 + '</div>';
    });
    if (list.length > 3) mine += '<div class="wv">ほか ' + (list.length - 3) + ' 件</div>';
    setHtml('mMine', mine);
    { const nv = String(Math.min(3, Math.max(1, list.length))); if ($('mMine').dataset.n !== nv) $('mMine').dataset.n = nv; } // 票の数で大きさを変える（watchmap.html の <style>）
    let hype = '';
    if (rk && !oc && phase === 'run') { const hot = list.some((v) => rk[v.first] === 1 && rk[v.second] === 2), near = list.some((v) => rk[v.first] <= 2 || rk[v.second] <= 2); hype = hot ? '<b class="hb hot">当たりの形！</b>' : near ? '<b class="hb near">あと少し！</b>' : ''; }
    setHtml('mHype', hype);
    let res = '';
    if (oc) {
      res = oc.voided ? '<div class="wr"><b>このレースは取り消しになりました</b></div>' : '<div class="wr' + (oc.wins.length ? ' hit' : '') + '"><b>' + (oc.wins.length ? '的中！' : oc.near ? 'おしい！' : 'ハズレ') + '</b>' + (oc.wins.length ? '<span class="am">' + amt(oc.total) + 'pt</span>' : '<span>結果 ' + chip(R, oc.res.winner) + '<em>→</em>' + chip(R, oc.res.second) + '</span>') + '</div>';
      res += '<button type="button" class="wbig" data-act="back">投票ページへ戻る</button>';
      if (!celeDone[R.id]) { celeDone[R.id] = true; cele(R, oc); }
    }
    setHtml('mRes', res);
    // 初参加ボーナス（2 票目）がまだ入れられる: 投票ページへ戻るボタン（自動で開いた窓でも 2 票目を逃さない）
    let bn = ''; try { const B = parentBet(); if (B && B.bonus && B.bonus(R.id)) bn = '<button type="button" class="wbonus" data-act="back"><b>初参加ボーナス：もう1票</b><span>投票ページで選ぶ ›</span></button>'; } catch (e) { bn = ''; }
    setHtml('mBonus', bn);
  }
  window.addEventListener('resize', () => { W = 0; });
  requestAnimationFrame(frame);
  window.DerbyMap = { get focus() { return focus; }, get phase() { return last.mTag; }, get pos() { return curPos; }, get info() { return curInfo; }, simFor, simAt, outcome, now, cloud: C };
})();
