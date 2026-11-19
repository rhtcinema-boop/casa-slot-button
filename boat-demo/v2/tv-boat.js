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

  /* ---------- 画面の部品 ----------
     2026-11-19 オーナー「投票待ち画面、テレビ・スマホ共に終わってる。競馬の感じをかなり参考に」「映像とかはスタート展示流しておけばいい」:
     競馬のテレビ（v2/tv.js の待ち時間・投票受付中）と同じ作り＝上の札の列・左上に映像の枠・右に出走表・左下にカウントダウン・中に人気の組番・右下に QR。
     映像の枠には本物の「スタート展示」（ピット離れ → 進入 → スタートライン。ref/boat/research/28_スタート展示.md）を流す。
     スタート展示は本番とは別の種で走らせる短い走り（当たりの決め方には一切つながない＝本番の結果の手がかりにならない）。 */
  const stage = $('stage');
  const ov = document.createElement('div'); ov.id = 'boatOv'; ov.hidden = true;
  ov.innerHTML = '<div class="bo-top"><span class="bo-pill st" id="boPill"></span><span class="bo-pill tm" id="boTime"></span><span class="bo-pill pr" id="boPromo">無料で 1 票</span><span class="bo-pill ct" id="boCnt" hidden></span><b class="bo-logo">casa <i>BOAT</i></b><span class="bo-pill sn" id="boStore"></span></div>' +
    '<section id="boVote" class="bo-vote" hidden>' +
      '<div class="bo-panel bo-vid" id="boVid"><div class="bo-vfit" id="boVfit"></div><span class="bo-tag" id="boTag">スタート展示</span><div class="bo-st" id="boSt" hidden></div></div>' +
      '<div class="bo-panel bo-card2" id="boCardP"><h3>出走表</h3><div id="boCardT"></div></div>' +
      '<div class="bo-panel bo-cd" id="boCd"></div>' +
      '<div class="bo-panel bo-popp" id="boPopP"><h3>人気の組番 <small>2連単</small></h3><div id="boPop"></div></div>' +
      '<div class="bo-panel bo-qrp" id="boQrP"><h3>アプリ不要 スマホで参加</h3><div class="bo-qr" id="boQr"><span>QR を準備中…</span></div><p class="bo-qrc" id="boQrc">無料で 1 票・当たりは BPT</p></div>' +
    '</section>' +
    '<section id="boFilm" class="bo-film" hidden><div class="bo-fit" id="boFit"><canvas id="boGl" width="1000" height="480"></canvas><canvas id="boHud" width="1000" height="480"></canvas><div id="boCard" class="bo-card" hidden></div></div></section>' +
    '<section id="boRes" class="bo-res" hidden></section>' +
    '<section id="boVoid" class="bo-void" hidden><h2>このボートレースは取り消しました</h2><p>BPT の券に使った BPT は全部戻しました</p></section>';
  if (stage) stage.appendChild(ov);
  const show = (id) => ['boVote', 'boFilm', 'boRes', 'boVoid'].forEach((x) => { $(x).hidden = x !== id; });
  const boatsOf = (r) => (r && (r.boats || (Boat() && r.model && Boat().boatsOf(r)))) || [];
  const waku = (b, cls) => '<i class="bo-waku ' + (cls || '') + '" style="background:' + b.color + ';color:' + b.ink + '">' + b.no + '</i>';
  const TYPES = { nige: '逃げ', senko: 'まくり', sashi: '差し', oikomi: 'まくり差し' };
  // 映像の絵（canvas）は 1 組だけ。スタート展示の枠と本番の映像の枠の間で入れ替える（3D を 2 つ動かさない＝Fire TV を重くしない）
  function putCanvas(where) { const box = where === 'vid' ? $('boVfit') : $('boFit'); [$('boGl'), $('boHud')].forEach((c) => { if (c.parentNode !== box) box.insertBefore(c, box.firstChild && box.firstChild.id === 'boCard' ? box.firstChild : null); }); }

  // 出走表（競馬の出馬表と同じ並び: 枠・名前・得意・調子・近走）
  function cardTable(r, full) {
    const hs = (full && full.model && full.model.horses) || [], bs = boatsOf(r);
    return '<div class="bo-ct"><div class="hd"><span></span><span>選手</span><span>級</span><span>得意</span><span>調子</span><span>近3走</span></div>' + bs.map((b, i) => { const h = hs[i] || {}, cd = h.cond || null, past = (b.past || []).slice(0, 3);
      return '<div class="rw"><i class="bar" style="background:' + b.color + '"></i>' + waku(b) + '<b class="nm">' + esc(b.name) + '</b><span class="cl">' + esc(b.cls || '') + '</span><span class="ty">' + esc(TYPES[b.type] || '') + '</span><span class="cn">' + (cd ? '<b>' + esc(cd.mark) + '</b><small>' + esc(cd.label) + '</small>' : esc(b.cond || '')) + '</span><span class="ps">' + past.map((p) => '<i class="p' + (p <= 3 ? p : 'x') + '">' + p + '</i>').join('') + '</span></div>'; }).join('') + '</div>';
  }
  function popular(r) {
    const ex = r.exacta || {}, cnt = (B.count && B.count.raceId === r.id && B.count.combos) || {};
    const ks = Object.keys(ex).sort((a, b) => (cnt[b] || 0) - (cnt[a] || 0) || ex[a] - ex[b]).slice(0, 6), bs = boatsOf(r);
    return ks.map((k, i) => { const p = k.split('-').map(Number); return '<div class="pr"><span class="rk">' + (i + 1) + '</span>' + waku(bs[p[0]] || { no: p[0] + 1, color: '#888', ink: '#fff' }, 'sm') + '<b class="ar">▶</b>' + waku(bs[p[1]] || { no: p[1] + 1, color: '#888', ink: '#fff' }, 'sm') + '<span class="od">' + (Math.round(ex[k] * 10) / 10).toFixed(1) + '<small>倍</small></span></div>'; }).join('');
  }
  let storeNm = '';
  async function renderVote(r, wait) {
    const t = now(), key = r.id + (wait ? 'w' : 'v');
    if (B.voteId !== key) {
      B.voteId = key; B.popKey = '';
      $('boVote').className = 'bo-vote ' + (wait ? 'is-wait' : 'is-vote');
      $('boCardT').innerHTML = cardTable(r, B.full[r.id]);
      if (!B.qrFor || B.qrFor !== r.id) { B.qrFor = r.id; qrFor(r); }
    }
    if (B.full[r.id] && !$('boCardT').dataset.full) { $('boCardT').innerHTML = cardTable(r, B.full[r.id]); $('boCardT').dataset.full = '1'; }
    $('boPill').textContent = wait ? '● 次のボートレース' : '● 投票受付中'; $('boPill').classList.toggle('on', !wait);
    $('boTime').textContent = hm(r.at) + ' 締切';
    $('boStore').textContent = storeNm || STORE;
    const c = B.count && B.count.raceId === r.id ? B.count : null;
    $('boCnt').hidden = wait || !c; if (c) $('boCnt').innerHTML = '全店で <b>' + c.total + '</b> 人参加';
    if (wait) $('boCd').innerHTML = '<div class="l"><span class="k">次のボートレース</span><b class="big">' + hm(r.at) + '</b><span class="u">締切</span></div><div class="r"><span class="k2">投票は ' + hm(r.openAt) + ' から</span><span class="k3">投票開始まで あと</span><b class="cd">' + left(r.openAt - t) + '</b></div>';
    else $('boCd').innerHTML = '<span class="k">締切まで あと</span><b class="cd">' + left(r.closeAt - t) + '</b><span class="h">スマホで<br>1着・2着を選ぶ</span>';
    $('boCd').classList.toggle('last', !wait && r.closeAt - t <= 30000);
    if (!wait) { const pk = JSON.stringify(c && c.combos) + r.id; if (B.popKey !== pk) { B.popKey = pk; $('boPop').innerHTML = popular(r); } }
    $('boQrP').querySelector('h3').innerHTML = wait ? 'アプリ不要<br>スマホで参加' : 'アプリ不要 スマホで参加';
    $('boQrc').textContent = wait ? '投票は ' + hm(r.openAt) + ' から' : '無料で 1 票・当たりは BPT';
  }
  async function qrFor(r) {
    try {
      const k = B.key[r.id] || (B.key[r.id] = await B.C.boatKey(r.id));
      const base = (window.DerbyQR && DerbyQR.joinURL ? DerbyQR.joinURL(STORE) : location.origin + '/v2/bet.html?store=' + STORE).split('?')[0].replace(/bet\.html$/, 'boat.html');
      const url = Boat().joinURL(base, STORE, r.id, k.code); BOATTV.qr = url;
      const svg = await DerbyQR.svg(url, { size: 300, margin: 2, ecl: 'M' }); if (B.qrFor === r.id && $('boQr')) $('boQr').innerHTML = svg;
    } catch (e) {
      BOATTV.err = 'qr ' + (e && e.message); delete B.key[r.id];
      if (e && (e.code === 'tv_only' || e.status === 403)) { if ($('boQr')) $('boQr').innerHTML = '<span>このテレビは QR を出せません<br>（テレビ用アカウントでログインしてください）</span>'; return; } // 読めないテレビは読み直さない（読み取りを増やさない）
      setTimeout(() => { if (B.qrFor === r.id) qrFor(r); }, 10000);
    }
  }

  /* ---------- スタート展示（投票待ち・投票中の映像の枠） ----------
     本物の流れ（研究 28）: ピット離れ → 進入（コース取り）→ スタートラインへ（ST を計る）。展示の ST は「.09」の形（フライングは F）。
     ここでは 1 回 約 40 秒: ピット離れ（12 秒）→ 大時計の 22 秒前から助走してスタートライン（スタートの 3 秒あとで切る）→ 展示の ST の札（8 秒）→ くり返し。
     種は「レース id ＋ 'tenji'」（本番の種とは別。決める係の計算とつながらない）。描くのは 1 秒 20 コマまで（Fire TV を重くしない）。音は出さない */
  const TJ_SEG = [[-100, -88], [-22, 3]], TJ_ST = 8;
  async function tjStart(r) {
    const f = B.full[r.id]; if (!f || !f.model) return false;
    await needFilm();
    if (!B.R) makeR();
    const model = Object.assign({}, f.model), seed = Engine.hashSeed('boat-tenji', r.id), run = Engine.replayRun(model, seed);
    let desc = {}; try { desc = BoatModel.describe(model, seed); } catch (e) { desc = {}; }
    B.R.setRace(model, run, { title: 'casa BOAT', sub: 'スタート展示', weather: model.weather2 }, desc);
    B.tj = { id: r.id, seg: 0, t: 0, acc: 0, desc, boats: boatsOf(r) };
    B.R.seek(TJ_SEG[0][0]); B.film = null;
    return true;
  }
  function stBoard(T) {
    const d = T.desc || {}, entry = d.entry || [0, 1, 2, 3, 4, 5], st = d.st || [];
    const fmt = (s) => (s == null ? '' : s < 0 ? 'F.' + String(Math.round(-s * 100)).padStart(2, '0') : '.' + String(Math.round(s * 100)).padStart(2, '0'));
    return '<h4>スタート展示</h4><div class="sth"><span>コース</span><span>艇</span><span>ST</span></div>' + entry.map((b, c) => '<div class="str"><span class="c">' + (c + 1) + '</span>' + waku(T.boats[b] || { no: b + 1, color: '#888', ink: '#fff' }, 'sm') + '<b>' + fmt(st[b]) + '</b></div>').join('') + '<p>展示の ST は本番とちがうことがあります</p>';
  }
  function tjFrame(dt) {
    const T = B.tj, R = B.R; if (!T || !R) return;
    T.t += dt;
    if (T.seg < TJ_SEG.length) {
      const [a, b] = TJ_SEG[T.seg];
      if (R.tt >= b) { T.seg++; if (T.seg < TJ_SEG.length) R.seek(TJ_SEG[T.seg][0]); else { T.stT = 0; $('boSt').innerHTML = stBoard(T); $('boSt').hidden = false; $('boTag').hidden = true; } return; }
      T.acc += dt; if (T.acc < 1 / 20) return; // 1 秒 20 コマ
      R.tick(T.acc); T.acc = 0; void a;
    } else {
      T.stT += dt;
      if (T.stT > TJ_ST) { $('boSt').hidden = true; $('boTag').hidden = false; T.seg = 0; R.seek(TJ_SEG[0][0]); }
    }
  }
  function makeR() {
    B.R = new BOAT.Race($('boGl'), $('boHud'), { quality: /[?&]boatq=low\b/.test(QS) ? 'low' : 'high' });
    try { BOAT.Sound.init(); } catch (e) { /* 音が無くても映像は出す */ }
    B.R.onSay = (keys, line) => { if (B.film) { try { BOAT.Sound.say(line); } catch (e) { /* noop */ } } }; // 実況は本番の映像だけ（スタート展示は音なし）
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
    if (!B.R) makeR();
    B.tj = null; $('boSt').hidden = true; putCanvas('film');
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
  // 競馬の結果画面の最初の 2 分は守る（ボートの投票待ちの画面も出さない。2026-11-18 オーナー決定）
  function derbyGuard(t) { const L = window.DERBY && DERBY.state && DERBY.state.last; return !!(L && L.revealAt && t < L.revealAt + 120000); }
  function topFor(label, on, time) { $('boPill').textContent = label; $('boPill').classList.toggle('on', !!on); $('boTime').textContent = time || ''; $('boCnt').hidden = true; $('boStore').textContent = storeNm || STORE; }
  let tjLast = 0;
  function tjEnsure(r) {
    const pn = performance.now(), dt = tjLast ? Math.min(0.1, (pn - tjLast) / 1000) : 0; tjLast = pn;
    putCanvas('vid');
    if (!B.tj || B.tj.id !== r.id) { if (!B.tjStarting && B.full[r.id]) { B.tjStarting = true; tjStart(r).catch((e) => { BOATTV.err = 'tenji ' + (e && e.message); }).finally(() => { B.tjStarting = false; }); } return; }
    tjFrame(dt);
  }
  async function loop() {
    try {
      const r = B.live && B.live.race, t = now(), st = r && Boat() ? Boat().stageOf(r, t) : 'none';
      BOATTV.stage = st; BOATTV.race = r ? r.id : null;
      const waitOk = st === 'wait' && r.openAt - t <= 60000 && !derbyGuard(t); // 投票の 1 分前から「次のボートレース」（スタート展示つき）
      if (!r || st === 'none' || st === 'over' || (st === 'wait' && !waitOk) || derbyBusy()) { setActive(false); tjLast = 0; return; }
      setActive(true);
      if (st === 'wait' || st === 'vote') { show('boVote'); fullRace(r); await renderVote(r, st === 'wait'); tjEnsure(r); return; }
      tjLast = 0;
      if (st === 'void') { show('boVoid'); topFor('● 取り消し', false, hm(r.at)); return; }
      if (st === 'closed' || st === 'film') {
        show('boFilm'); topFor('● レース中', true, hm(r.at) + ' のレース');
        if (!B.film || B.film.id !== r.id) { if (!B.starting) { B.starting = true; startFilm(r).catch((e) => { BOATTV.err = 'film ' + (e && e.message); }).finally(() => { B.starting = false; }); } renderCard(r); $('boCard').hidden = false; return; }
        renderCard(r); filmFrame(r, t); return;
      }
      if (st === 'result') {
        if (B.film && B.film.id === r.id && B.R && (!B.R.done || r.status !== 'done') && t < r.revealAt + 20000) { show('boFilm'); filmFrame(r, t); return; } // 映像の最後（ゴール後）まで。発表（決める係が結果を書く）が届くまでは勝った艇のアップのまま
        show('boRes'); topFor('● 確定', true, 'この画面 あと ' + left(r.endAt - t)); renderResult(r);
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
    if (B.C.stores) B.C.stores().then((L) => { const s = (L || []).find((x) => x.id === STORE); if (s) storeNm = s.name + '店'; }).catch(() => {});
    await needCore();
    if (!B.C.boatWatch) return; // 古い部品
    B.C.boatWatch({ boat: (live) => { B.live = live; const r = live && live.race; if (r && B.full[r.id] && r.status !== B.full[r.id].status) { B.full[r.id] = Object.assign({}, B.full[r.id], r); if (r.status === 'decided') delete B.full[r.id].hidden; } }, count: (c) => { B.count = c; }, error: () => {} });
    if (B.C.boatState) { try { const x = await B.C.boatState(); if (!B.live) B.live = x.live; } catch (e) { /* 見張りで届く */ } }
    requestAnimationFrame(raf);
  })();
  BOATTV.debug = () => ({ tj: B.tj && { id: B.tj.id, seg: B.tj.seg, tt: B.R && B.R.tt }, stage: BOATTV.stage, race: BOATTV.race, film: B.film && { id: B.film.id, tt: B.R && B.R.tt, done: B.R && B.R.done, shot: B.R && B.R.shot }, count: B.count, err: BOATTV.err, qr: BOATTV.qr, parts: B.R && B.R.parts });
})();
