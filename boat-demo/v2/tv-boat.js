/* 店のテレビの casa BOAT（2026-11-19）: 競馬のテレビのページ（ルートの index.html ＋ v2/tv.js）の中で、ボートの投票〜映像〜結果を重ねて出す。ページは移らない（読み込み直し＝競馬のレースの一覧の読み直しをしない）。
   流れ（時刻は v2/boat-core.js の timesOf）: 投票（openAt〜closeAt。QR・出走表・参加人数 15 秒ごと）→ 締切（closeAt〜runAt の 6 秒。出走表とブザー）→ 映像（runAt から。ピット離れ 100 秒＋走り＋ゴール後 8 秒。
     boat/race-boat.js の BOAT.Race をそのまま使う。艇の動き・音の中身は変えない）→ 結果（revealAt〜endAt の 2 分。確定の組番・払戻・当たった人の名前）→ 競馬の画面に戻る。
   競馬の画面は下で動いたまま（受け取り待ちの結果画面も、ボートが終われば元のとおり見える）。ボートの間は競馬の 3D を描かない（js/race3d.js の boatHold）・受け取り待ちの声も出さない（tv.js の DERBY.hold）。
   競馬のレースを流している間（投票・レース）はボートを出さない（時刻表で被らないようにしてあるが、念のため競馬が勝つ）。
   見張り: いまの状態 boatLive/all（変わったときだけ）と、投票中だけ参加人数 boatCounts/live（15 秒ごと）。QR の合言葉はレースごとに 1 回だけ読む。 */
(function () {
  'use strict';
  const QS = location.search, MUTE = /[?&]mute=1/.test(QS);
  const STORE = decodeURIComponent((QS.match(/[?&]store=([^&#]+)/) || [])[1] || '');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const BOATTV = (window.BOATTV = { active: false, stage: '', race: null, log: [], err: '' });
  const B = { C: null, live: null, race: null, full: {}, fetchAt: {}, key: {}, count: null, R: null, film: null, loading: null, lastFrame: 0, scripts: false, resId: '', voteId: '' };
  const Boat = () => window.BoatCore;
  const now = () => (B.C && B.C.serverNow ? B.C.serverNow() : Date.now());
  const hm = (ms) => (window.DerbyCore ? DerbyCore.fmtBizTime(ms, 5) : new Date(ms).toTimeString().slice(0, 5));
  const left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ROOT = (() => { const me = document.currentScript && document.currentScript.src; return me ? me.replace(/v2\/[^/]*$/, '') : ''; })();
  function load(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = ROOT + src; s.async = false; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); }); }
  async function needCore() { if (!window.DerbyCore) await load('v2/core.js?v=b1'); if (!window.BoatCore) await load('v2/boat-core.js?v=b1'); }
  // 映像の部品（初めて使うときに 1 回だけ読む。three.js・js/engine.js はテレビのページにもうある）
  function needFilm() {
    if (!B.loading) B.loading = (async () => {
      const L = ['js/boat-model.js?v=b1', 'boat/course.js?v=b1', 'boat/boat3d.js?v=b1', 'boat/venue3d.js?v=b1', 'boat/lines.js?v=b1', 'boat/race-boat.js?v=b1', 'boat/announce-boat.js?v=b1', 'boat/fanfare-boat.js?v=b1', 'boat/sound.js?v=b1'];
      for (const u of L) { if (u.indexOf('boat-model') >= 0 && window.BoatModel) continue; await load(u); }
      return true;
    })().catch((e) => { B.loading = null; BOATTV.err = String(e.message || e); throw e; });
    return B.loading;
  }

  /* ---------- 画面の部品 ---------- */
  const stage = $('stage');
  const ov = document.createElement('div'); ov.id = 'boatOv'; ov.hidden = true;
  ov.innerHTML = '<div class="bo-head"><b class="bo-logo">casa <i>BOAT</i></b><span id="boTitle"></span><span id="boClock" class="bo-clock"></span></div>' +
    '<section id="boVote" class="bo-vote" hidden></section>' +
    '<section id="boFilm" class="bo-film" hidden><div class="bo-fit"><canvas id="boGl" width="1000" height="480"></canvas><canvas id="boHud" width="1000" height="480"></canvas><div id="boCard" class="bo-card" hidden></div></div></section>' +
    '<section id="boRes" class="bo-res" hidden></section>' +
    '<section id="boVoid" class="bo-void" hidden><h2>このボートレースは取り消しました</h2><p>BPT の券に使った BPT は全部戻しました</p></section>';
  if (stage) stage.appendChild(ov);
  const show = (id) => ['boVote', 'boFilm', 'boRes', 'boVoid'].forEach((x) => { $(x).hidden = x !== id; });
  const boatsOf = (r) => (r && (r.boats || (Boat() && r.model && Boat().boatsOf(r)))) || [];
  const waku = (b, cls) => '<i class="bo-waku ' + (cls || '') + '" style="background:' + b.color + ';color:' + b.ink + '">' + b.no + '</i>';
  const TYPES = { nige: '逃げ', senko: 'まくり', sashi: '差し', oikomi: 'まくり差し' };

  function cardTable(r, full) {
    const hs = (full && full.model && full.model.horses) || [], bs = boatsOf(r);
    return '<table class="bo-tbl"><tr><th>艇</th><th>選手</th><th>級</th><th>得意</th><th>平均ST</th><th>モーター</th><th>近5走</th></tr>' + bs.map((b, i) => { const h = hs[i] || {}; return '<tr><td>' + waku(b) + '</td><td class="nm">' + esc(b.name) + '</td><td>' + esc(b.cls || '') + '</td><td>' + esc(TYPES[b.type] || '') + '</td><td>' + (b.st != null ? Number(b.st).toFixed(2) : '') + '</td><td>' + esc(h.cond ? h.cond.mark + ' ' + h.cond.label : b.cond || '') + '</td><td class="ps">' + esc((b.past || []).join(' ')) + '</td></tr>'; }).join('') + '</table>';
  }
  function popular(r) {
    const ex = r.exacta || {}, cnt = (B.count && B.count.raceId === r.id && B.count.combos) || {};
    const ks = Object.keys(ex).sort((a, b) => (cnt[b] || 0) - (cnt[a] || 0) || ex[a] - ex[b]).slice(0, 6), bs = boatsOf(r);
    return '<div class="bo-pop"><h3>人気の組番</h3>' + ks.map((k, i) => { const p = k.split('-').map(Number); return '<div class="pr"><span class="rk">' + (i + 1) + '</span>' + waku(bs[p[0]] || { no: p[0] + 1, color: '#888', ink: '#fff' }, 'sm') + '<b>-</b>' + waku(bs[p[1]] || { no: p[1] + 1, color: '#888', ink: '#fff' }, 'sm') + '<span class="od">' + (Math.round(ex[k] * 10) / 10).toFixed(1) + '<small>倍</small></span></div>'; }).join('') + '</div>';
  }
  async function renderVote(r) {
    const t = now(), first = B.voteId !== r.id;
    if (first) {
      B.voteId = r.id;
      $('boVote').innerHTML = '<div class="bo-left"><h1>投票受付中</h1><p class="bo-sub">2連単・お店の中だけ（このテレビの QR から）</p><div id="boCardT"></div></div>' +
        '<div class="bo-right"><div class="bo-qr" id="boQr"><span>QR を準備中…</span></div><p class="bo-qrc">スマホのカメラで QR を読んで投票</p>' +
        '<ul class="bo-rule"><li><b>無料で 1 票</b>（今日の競馬に参加したスマホ）</li><li>当たりは <b>BPT</b>。競馬の追加の券に使えます</li><li>BPT 100 で券を何枚でも追加</li></ul>' +
        '<div class="bo-cnt"><span>参加</span><b id="boPpl">0</b><small>人</small><span>券</span><b id="boTk">0</b><small>枚</small></div><div class="bo-left2"><span>締切まで</span><b id="boLeft"></b></div><div id="boPop"></div></div>';
      qrFor(r);
    }
    if (!$('boCardT').firstChild && B.full[r.id]) $('boCardT').innerHTML = cardTable(r, B.full[r.id]);
    else if (!$('boCardT').firstChild) $('boCardT').innerHTML = cardTable(r, null);
    $('boLeft').textContent = left(r.closeAt - t);
    const c = B.count && B.count.raceId === r.id ? B.count : null;
    $('boPpl').textContent = c ? c.total : 0; $('boTk').textContent = c ? c.tickets : 0;
    const pk = JSON.stringify(c && c.combos) + r.id; if (B.popKey !== pk) { B.popKey = pk; $('boPop').innerHTML = popular(r); }
  }
  async function qrFor(r) {
    try {
      const k = B.key[r.id] || (B.key[r.id] = await B.C.boatKey(r.id));
      const base = (window.DerbyQR && DerbyQR.joinURL ? DerbyQR.joinURL(STORE) : location.origin + '/v2/bet.html?store=' + STORE).split('?')[0].replace(/bet\.html$/, 'boat.html');
      const url = Boat().joinURL(base, STORE, r.id, k.code); BOATTV.qr = url;
      const svg = await DerbyQR.svg(url, { size: 300, margin: 2, ecl: 'M' }); if (B.voteId === r.id && $('boQr')) $('boQr').innerHTML = svg;
    } catch (e) {
      BOATTV.err = 'qr ' + (e && e.message); delete B.key[r.id];
      if (e && (e.code === 'tv_only' || e.status === 403)) { if ($('boQr')) $('boQr').innerHTML = '<span>このテレビは QR を出せません<br>（テレビ用アカウントでログインしてください）</span>'; return; } // 読めないテレビは読み直さない（読み取りを増やさない）
      setTimeout(() => { if (B.voteId === r.id) qrFor(r); }, 10000);
    }
  }

  /* ---------- 映像 ---------- */
  async function fullRace(r) {
    const have = B.full[r.id], dec = r.status === 'decided' || r.status === 'done';
    if (have && (have.hidden || !dec)) return have; // 決める前はレースの書類を 1 回だけ読む・決めたら種つきでもう 1 回
    if (B.fetching === r.id || performance.now() - (B.fetchAt[r.id] || -1e9) < 3000) return have || null; // 読めなかったら 3 秒あける（読み取りを増やさない）
    B.fetching = r.id; B.fetchAt[r.id] = performance.now();
    try { const x = await B.C.boatRace(r.id); B.full[r.id] = x; return x; } catch (e) { return have || null; } finally { B.fetching = null; }
  }
  async function startFilm(r) {
    if (r.status !== 'decided' && r.status !== 'done') return false; // 決めるまで（締切の 2 秒ほどあと）は出走表のまま
    const f = await fullRace(r); if (!f || !f.hidden) return false;
    await needFilm();
    if (!B.R) {
      B.R = new BOAT.Race($('boGl'), $('boHud'), { quality: /[?&]boatq=low\b/.test(QS) ? 'low' : 'high' });
      try { BOAT.Sound.init(); } catch (e) { /* 音が無くても映像は出す */ }
      B.R.onSay = (keys, line) => { try { BOAT.Sound.say(line); } catch (e) { /* noop */ } };
    }
    const model = Object.assign({}, f.model, { exacta: f.exacta }, f.hidden.incident ? { incident: f.hidden.incident } : {}), run = Engine.replayRun(model, f.hidden.seed, { order: f.hidden.order });
    let desc = {}; try { desc = BoatModel.describe(model, f.hidden.seed, { swaps: run.swaps }); } catch (e) { desc = {}; }
    B.R.setRace(model, run, { title: 'casa BOAT', sub: hm(r.at) + ' のレース', weather: model.weather2, odds: { exacta: f.exacta } }, desc);
    B.film = { id: r.id, runAt: f.hidden.runAt || r.runAt, closeAt: r.closeAt, desc, order: run.finalOrder() };
    return true;
  }
  function filmFrame(r, t) {
    const F = B.film, R = B.R; if (!F || !R || F.id !== r.id) return;
    const perf = performance.now(), dt = B.lastFrame ? Math.min(0.1, (perf - B.lastFrame) / 1000) : 0; B.lastFrame = perf;
    if (t < F.runAt) { // 締切〜映像の前（6 秒）: 出走表とブザー（ボートのページの「出走表 → ピット離れ」と同じ）
      const cardT = Math.max(0, (t - F.closeAt) / 1000);
      R.tick(0); R.seek(BOAT.Race.PIT_T); $('boCard').hidden = false;
      try { BOAT.Sound.frame(R, { state: 'card', cardT, cardLen: Math.max(1, (F.runAt - F.closeAt) / 1000) }); } catch (e) { /* noop */ }
      return;
    }
    $('boCard').hidden = true;
    const target = (t - F.runAt) / 1000 - BOAT.Race.PRE_T;
    if (Math.abs(R.tt - target) > 0.6) R.seek(target); else R.tick(dt);
    try { BOAT.Sound.frame(R, { state: R.done ? 'result' : 'race' }); } catch (e) { /* noop */ }
  }
  function renderCard(r) {
    const f = B.full[r.id]; if (!f) return;
    const c = $('boCard'); if (c.dataset.id === r.id) return; c.dataset.id = r.id;
    c.innerHTML = '<h2>出走表<small>' + hm(r.at) + ' のレース・2周 1200m</small></h2>' + cardTable(r, f) + '<p class="bo-closed">投票は締め切りました</p>';
  }

  /* ---------- 結果 ---------- */
  function renderResult(r) {
    if (B.resId === r.id + (r.winners ? r.winners.length : '')) return; B.resId = r.id + (r.winners ? r.winners.length : '');
    const res = r.result || {}, bs = boatsOf(r), a = bs[res.first] || {}, b = bs[res.second] || {};
    const desc = B.film && B.film.id === r.id ? B.film.desc : null, kim = desc && desc.kimarite ? (window.BoatModel && BoatModel.KIMARITE[desc.kimarite]) || desc.kimarite : '';
    const ws = (r.winners || []).slice(0, 12), mine = (r.winners || []).filter((w) => w.storeId === STORE).length;
    $('boRes').innerHTML = '<div class="bo-kakutei"><span class="bo-k">確定</span>' + waku(a, 'lg') + '<b class="bo-ar">-</b>' + waku(b, 'lg') + '<div class="bo-nm">1着 ' + esc(a.name) + '<br>2着 ' + esc(b.name) + (kim ? '<br><small>決まり手 ' + esc(kim) + '</small>' : '') + '</div></div>' +
      '<div class="bo-pay"><span>2連単</span><b>' + (res.combo ? res.combo.split('-').map((x) => Number(x) + 1).join('-') : '') + '</b><span>払戻</span><b class="y">' + amt(res.pay) + '</b><small>BPT</small><span class="od">' + (res.odds ? (Math.round(res.odds * 10) / 10).toFixed(1) + '倍' : '') + '</span></div>' +
      (res.incident ? '<div class="bo-inc">' + waku(bs[res.incident.boat] || { no: res.incident.boat + 1, color: '#888', ink: '#fff' }, 'sm') + '<b>' + (res.incident.type === 'scratch' ? 'フライング' : '転覆') + '</b><span>' + (res.incident.refund ? 'この艇を含む券は返還（BPT の券は BPT を戻します）' + (r.refunded ? '・返還 ' + amt(r.refunded) + ' BPT' : '') : '返還なし') + '</span></div>' : '') +
      '<div class="bo-wins"><h3>的中 ' + (r.people || 0) + ' 人' + (mine ? '（この店 ' + mine + ' 人）' : '') + '</h3>' + (ws.length ? '<ol>' + ws.map((w) => '<li class="' + (w.storeId === STORE ? 'me' : '') + '"><span class="nk">' + esc(w.nick) + '</span><span class="st">' + esc(w.storeName || w.storeId) + '</span><b>＋' + amt(w.amount) + '<small>BPT</small></b></li>').join('') + '</ol>' : '<p class="bo-none">今回は的中なし</p>') + '</div>' +
      '<div class="bo-order"><h3>着順</h3>' + (res.order || []).map((i, k) => { const x = bs[i] || {}; return '<div class="or"><span class="rk">' + (k + 1) + '着</span>' + waku(x, 'sm') + '<span class="nm">' + esc(x.name) + '</span></div>'; }).join('') + '</div>' +
      '<p class="bo-note">当たった BPT は競馬の「追加の券」に使えます（1 枚 100 BPT）</p><p class="bo-next" id="boNext"></p>';
  }

  /* ---------- いまの場面 ---------- */
  function derbyBusy() { const D = window.DERBY; if (!D) return false; const ph = D.phase; return ph === 'live' || ph === 'open' || !!(D.tv && D.tv.playing); } // 競馬が投票中・レース中ならボートは出さない
  function setActive(on) {
    if (BOATTV.active === on) return; BOATTV.active = on; ov.hidden = !on;
    stage.classList.toggle('m-boat', on);
    const rv = window.DERBY && DERBY.raceView; if (rv) { rv.boatHold = on; if (!on) rv.offWas = true; }
    if (!on) { try { if (window.BOAT && BOAT.Sound) BOAT.Sound.stop(); } catch (e) { /* noop */ } B.lastFrame = 0; }
  }
  async function loop() {
    try {
      const r = B.live && B.live.race, t = now(), st = r && Boat() ? Boat().stageOf(r, t) : 'none';
      BOATTV.stage = st; BOATTV.race = r ? r.id : null;
      if (!r || st === 'none' || st === 'wait' || st === 'over' || derbyBusy()) { setActive(false); return; }
      setActive(true);
      $('boTitle').textContent = hm(r.at) + ' のレース' + (r.test ? '（テスト）' : '');
      if (st === 'vote') { show('boVote'); $('boClock').textContent = '締切 ' + hm(r.closeAt); fullRace(r); await renderVote(r); return; }
      if (st === 'void') { show('boVoid'); $('boClock').textContent = ''; return; }
      if (st === 'closed' || st === 'film') {
        show('boFilm'); $('boClock').textContent = '';
        if (!B.film || B.film.id !== r.id) { if (!B.starting) { B.starting = true; startFilm(r).catch((e) => { BOATTV.err = 'film ' + (e && e.message); }).finally(() => { B.starting = false; }); } renderCard(r); $('boCard').hidden = false; return; }
        renderCard(r); filmFrame(r, t); return;
      }
      if (st === 'result') {
        if (B.film && B.film.id === r.id && B.R && (!B.R.done || r.status !== 'done') && t < r.revealAt + 20000) { show('boFilm'); filmFrame(r, t); return; } // 映像の最後（ゴール後）まで。発表（決める係が結果を書く）が届くまでは勝った艇のアップのまま
        show('boRes'); $('boClock').textContent = 'この画面 あと ' + left(r.endAt - t); renderResult(r);
        const n = B.live && B.live.next; $('boNext').textContent = n ? '次のボートレース ' + hm(n.at) + '（投票は ' + hm(n.openAt) + ' から）' : '';
        try { if (B.R) BOAT.Sound.frame(B.R, { state: 'result' }); } catch (e) { /* noop */ }
        return;
      }
      setActive(false);
    } catch (e) { BOATTV.err = String(e && e.message); console.error('casa BOAT', e); }
  }
  function raf() { loop(); requestAnimationFrame(raf); }

  /* ---------- はじめ: 競馬のテレビ（v2/tv.js）の DerbyCloud をそのまま使う（つなぎ・ログイン・時計は 1 つ） ---------- */
  (async () => {
    for (let i = 0; i < 600 && !(window.DERBY && DERBY.cloud); i++) await new Promise((r) => setTimeout(r, 100));
    if (!(window.DERBY && DERBY.cloud) || DERBY.watch || !STORE) return;
    B.C = DERBY.cloud;
    await needCore();
    if (!B.C.boatWatch) return; // 古い部品
    B.C.boatWatch({ boat: (live) => { B.live = live; const r = live && live.race; if (r && B.full[r.id] && r.status !== B.full[r.id].status) { B.full[r.id] = Object.assign({}, B.full[r.id], r); if (r.status === 'decided') delete B.full[r.id].hidden; } }, count: (c) => { B.count = c; }, error: () => {} });
    if (B.C.boatState) { try { const x = await B.C.boatState(); if (!B.live) B.live = x.live; } catch (e) { /* 見張りで届く */ } }
    requestAnimationFrame(raf);
  })();
  BOATTV.debug = () => ({ stage: BOATTV.stage, race: BOATTV.race, film: B.film && { id: B.film.id, tt: B.R && B.R.tt, done: B.R && B.R.done, shot: B.R && B.R.shot }, count: B.count, err: BOATTV.err, qr: BOATTV.qr, parts: B.R && B.R.parts });
})();
