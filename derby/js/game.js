/* casa DERBY 画面まわり（みんなでダービー風の流れ）
   ベット時間 30 秒 → レース → 結果・払い戻し → チャンスボール → （貯まったら）ボーナスルーレット → ボーナス牧場 → 次のレース */
(function () {
  'use strict';
  const APP_V = 'k3';
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stageEl = $('stage');
  const BET_SEC = 30;
  if (/[?&]mute=1/.test(location.search)) Sfx.mute(true); // テスト用: ?mute=1 で無音
  // 音のオン・オフのボタン（ヘッダー右・常に表示）。選んだ状態は端末に保存して次回も使う。S キーでも切り替え
  (function soundButton() {
    const KEY = 'casaDerby.sound', btns = Array.from(document.querySelectorAll('.soundbtn')); if (!btns.length) return;
    let saved = null; try { saved = localStorage.getItem(KEY); } catch (e) { }
    if (saved === 'off') Sfx.mute(true);
    const show = () => { const off = Sfx.isMuted(); btns.forEach((btn) => { btn.classList.toggle('off', off); btn.setAttribute('aria-label', off ? '音を出す' : '音を消す'); btn.querySelector('small').textContent = off ? '音OFF' : '音ON'; }); };
    const toggle = () => { const off = !Sfx.isMuted(); Sfx.mute(off); if (!off) { Sfx.unlock(); Sfx.play('button'); } try { localStorage.setItem(KEY, off ? 'off' : 'on'); } catch (e) { } show(); };
    btns.forEach((btn) => { btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); btn.blur(); }); btn.addEventListener('keydown', (e) => e.stopPropagation()); });
    document.addEventListener('keydown', (e) => { if ((e.key === 's' || e.key === 'S') && !e.repeat && !e.ctrlKey && !e.metaKey) toggle(); });
    show();
  })();
  const SPEED = Number((location.search.match(/[?&]speed=(\d+)/) || [])[1] || 1); // テスト用: ?speed=8 で早送り
  if (SPEED > 1) { const _st = window.setTimeout; window.setTimeout = (f, ms, ...a) => _st(f, (ms || 0) / SPEED, ...a); const _si = window.setInterval; window.setInterval = (f, ms, ...a) => _si(f, (ms || 0) / SPEED, ...a); }

  // ---------- 保存 ----------
  const KEY = 'casa.derby.v2';
  const store = { medals: 300, balls: 0, raceNo: 0, best: 0, history: [] };
  try { Object.assign(store, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  // 壊れた値を直す（NaN・負の数・型違い）。ベット中（発走前）に閉じた・再読み込みしたときは、賭けていたメダルを戻す
  ['medals', 'balls', 'raceNo', 'best', 'pend'].forEach((k) => { if (!Number.isFinite(store[k]) || store[k] < 0) store[k] = k === 'medals' ? 300 : 0; });
  if (!Array.isArray(store.history)) store.history = [];
  if (store.pend > 0) { store.medals += store.pend; store.pend = 0; save(); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }

  // ---------- 拡縮 ----------
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight, s = Math.min(vw / 1600, vh / 900);
    stageEl.style.transform = 'translate(' + (vw - 1600 * s) / 2 + 'px,' + (vh - 900 * s) / 2 + 'px) scale(' + s + ')';
    $('rotate').style.display = vh > vw && vw < 700 ? 'grid' : 'none';
  }
  window.addEventListener('resize', layout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  layout();

  // ---------- 状態 ----------
  let race = null, odds = null, bets = null, phase = 'splash', timerLeft = BET_SEC, timerId = 0;
  let cursor = { kind: 'cell', r: 0, c: 0 };   // 馬券のマス目のカーソル（r=0 単勝、r=1..5 馬連 r-x）／ボタン
  const raceView = new Race($('race'));
  raceView.timeScale = SPEED;
  // 出走馬紹介の字幕（脚質・能力・調子・単勝）
  raceView.info = (i) => { const h = race.horses[i], t = T[h.type]; return { line1: t.label + '　' + '★'.repeat(h.stars) + '☆'.repeat(5 - h.stars) + '　調子 ' + h.cond.mark + h.cond.label, line2: '単勝 ' + odds.tansho[i].toFixed(1) + ' 倍　前走 ' + h.past.join('-') + ' 着' }; };
  const T = Engine.TYPES;

  // ---------- メダル表示 ----------
  let shownMedals = store.medals;
  function renderMedals(animate) {
    if (!animate) { shownMedals = store.medals; $('medals').textContent = store.medals.toLocaleString('ja-JP'); return; }
    const from = shownMedals, to = store.medals, t0 = performance.now(), dur = Math.min(2500, 400 + Math.abs(to - from) * 6) / SPEED;
    if (to > from) $('medalPod').classList.add('gain');
    (function tick(now) {
      const u = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - u, 3);
      shownMedals = Math.round(from + (to - from) * e); $('medals').textContent = shownMedals.toLocaleString('ja-JP');
      if (u < 1) requestAnimationFrame(tick); else { Sfx.play('coinEnd'); $('medalPod').classList.remove('gain'); }
    })(t0);
  }
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.className = 'show'; clearTimeout(toast.id); toast.id = setTimeout(() => (t.className = ''), ms || 1800); }

  // ---------- 新しいレース ----------
  function newRace() {
    race = Engine.makeRace(); odds = Engine.calcOdds(race);
    bets = { tansho: [0, 0, 0, 0, 0, 0], umaren: {} };
    store.raceNo += 1; save();
    $('raceNo').textContent = '第' + store.raceNo + 'レース';
    $('raceDist').textContent = race.dist + 'm';
    $('raceSurf').textContent = race.surface === 'turf' ? '芝' : 'ダート';
    $('raceSurf').className = 'chip ' + race.surface;
    $('raceWeather').textContent = { sunny: '☀ 晴れ', cloudy: '☁ くもり', rain: '☂ 雨' }[race.weather];
    raceView.setRace(race);
    Race.drawTenkai($('tenkai'), race, odds.tenkai, drawPic, { scale: 2.7 }); // 展開予想: 前の 1.35 倍の大きさ（キャンバスは 2 倍の細かさ）
    renderHorses(); buildGrid(); renderBalls(); renderCarrots();
    cursor = { kind: 'cell', r: 0, c: 0 }; renderCursor();
    $('result').hidden = true; $('cheer').hidden = true; $('announce').textContent = ''; bcPhase('reset');
    setMsg('馬券を選んで BET！　締切まで ' + BET_SEC + ' 秒');
    phase = 'bet'; startTimer();
  }

  // ---------- 出馬表 ----------
  // 馬の絵は、レース映像で走る馬と同じ見た目にする（3D のときは 3D の馬そのものを撮った絵。2D のときは 2D の馬）
  function horsePic(i, kind) { try { return raceView.portrait ? raceView.portrait(i, kind) : null; } catch (e) { return null; } }
  // 全身の絵を、蹄の位置 (x, y)・1m あたり ppm px で描く。描けたら true
  function drawPic(c, x, y, ppm, i) { const pic = horsePic(i, 'full'); if (!pic || !pic.ppm) return false; const k = ppm / pic.ppm; c.drawImage(pic, x - pic.foot.x * k, y - pic.foot.y * k, pic.width * k, pic.height * k); return true; }
  function renderHorses() {
    const box = $('horses'); box.innerHTML = '';
    race.horses.forEach((h, i) => {
      const t = T[h.type], d = document.createElement('div');
      d.className = 'horse'; d.dataset.i = i; d.style.setProperty('--fc', h.color);
      // 2 段組: 上=馬番と馬名、下=脚質・能力（★）・前走 5 走。右に調子と単勝オッズ
      d.innerHTML =
        '<canvas class="face" width="128" height="128"></canvas>' + (h.mark ? '<i class="mk">' + h.mark + '</i>' : '') +
        '<div class="main"><div class="l1"><span class="no" style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</span><b>' + h.name + '</b></div>' +
        '<div class="l2"><i class="ty" style="background:' + t.color + '">' + t.label + '</i><span class="st">' + '★'.repeat(h.stars) + '<em>' + '★'.repeat(5 - h.stars) + '</em></span>' +
        '<span class="past">' + h.past.map((p) => '<i class="p' + p + '">' + p + '</i>').join('') + '</span></div></div>' +
        '<span class="cond c' + ['◎', '○', '△', '▲', '×'].indexOf(h.cond.mark) + '"><b>' + h.cond.mark + '</b><small>' + h.cond.label + '</small></span>' +
        '<span class="odds"><small>単勝</small><b class="' + Engine.oddsColor(odds.tansho[i]) + '">' + odds.tansho[i].toFixed(1) + '</b></span><em class="hb"></em>';
      const cv = d.querySelector('.face'), c = cv.getContext('2d'), pic = horsePic(i, 'face'); if (pic) c.drawImage(pic, 0, 0, cv.width, cv.height); else { c.scale(2, 2); Horse.face(c, 30, 32, 44, h); }
      d.addEventListener('click', () => { if (phase !== 'bet') return; cursor = { kind: 'cell', r: 0, c: i }; renderCursor(); Sfx.play('select'); });
      box.appendChild(d);
    });
  }

  // ---------- 馬券のマス目 ----------
  // 行 0: 単勝 1〜6。行 r(1..5): 馬連 r-x（x = r+1..6）。列は相手の馬番（1..6）
  function cellKey(r, c) { return r === 0 ? 't' + c : Engine.qkey(r - 1, c); }
  function cellExists(r, c) { return c >= 0 && c < 6 && (r === 0 || (r >= 1 && r <= 5 && c >= r)); }
  function cellBet(r, c) { return r === 0 ? bets.tansho[c] : (bets.umaren[Engine.qkey(r - 1, c)] || 0); }
  function cellOdds(r, c) { return r === 0 ? odds.tansho[c] : odds.umaren[Engine.qkey(r - 1, c)]; }
  function cellLabel(r, c) { return r === 0 ? '単勝 ' + (c + 1) : '馬連 ' + r + '-' + (c + 1); }
  function buildGrid() {
    const g = $('grid'); g.innerHTML = '';
    // 見出し行
    const head = document.createElement('div'); head.className = 'row head';
    head.innerHTML = '<span class="lab">馬番</span>' + race.horses.map((h, c) => '<span class="hd" data-c="' + c + '"><i style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</i></span>').join('');
    g.appendChild(head);
    for (let r = 0; r <= 5; r++) {
      const row = document.createElement('div'); row.className = 'row' + (r === 0 ? ' tan-row' : '');
      let html = '<span class="lab' + (r === 0 ? ' tan' : '') + '" data-r="' + r + '">' + (r === 0 ? '単勝' : '<i style="background:' + race.horses[r - 1].color + ';color:' + race.horses[r - 1].ink + '">' + r + '</i>') + '</span>';
      for (let c = 0; c < 6; c++) {
        if (!cellExists(r, c)) { html += '<span class="cell none"></span>'; continue; }
        const o = cellOdds(r, c);
        html += '<span class="cell" data-r="' + r + '" data-c="' + c + '"><b class="o ' + Engine.oddsColor(o) + '">' + o.toFixed(1) + '</b><em class="b"></em></span>';
      }
      row.innerHTML = html; g.appendChild(row);
    }
    g.querySelectorAll('.cell[data-r]').forEach((el) => el.addEventListener('click', () => { if (phase !== 'bet') return; cursor = { kind: 'cell', r: +el.dataset.r, c: +el.dataset.c }; renderCursor(); Sfx.play('select'); }));
    renderBets();
  }
  function renderBets() {
    $('grid').querySelectorAll('.cell[data-r]').forEach((el) => { const b = cellBet(+el.dataset.r, +el.dataset.c); el.querySelector('.b').textContent = b ? b : ''; el.classList.toggle('has', b > 0); });
    const total = Engine.totalBet(bets);
    $('totalBet').textContent = total;
    document.querySelectorAll('#horses .horse').forEach((el, i) => { el.classList.toggle('bet', bets.tansho[i] > 0); el.querySelector('.hb').textContent = bets.tansho[i] || ''; });
    $('btns').querySelector('.bgo').classList.toggle('ready', total > 0);
    renderCarrots(); renderSel();
  }
  function renderSel() {
    const cc = cursor.kind === 'cell' ? cursor : cursor.cell; if (!cc) return; // ボタンにいるときは直前のマス
    $('selLabel').textContent = cellLabel(cc.r, cc.c);
    const o = cellOdds(cc.r, cc.c), b = cellBet(cc.r, cc.c);
    $('selOdds').innerHTML = o.toFixed(1) + '<small>倍</small>'; $('selOdds').className = 'sel-odds ' + Engine.oddsColor(o);
    $('selBet').textContent = b;
    $('selWin').textContent = b ? Math.floor(b * o).toLocaleString('ja-JP') : '—';
  }
  // カーソルのマスに関係する見出し（馬番）と出馬表の馬を強調
  function renderCursor() {
    $('grid').querySelectorAll('.cell').forEach((el) => el.classList.toggle('cur', cursor.kind === 'cell' && +el.dataset.r === cursor.r && +el.dataset.c === cursor.c));
    $('btns').querySelectorAll('.bbtn').forEach((el, i) => el.classList.toggle('cur', cursor.kind === 'btn' && cursor.i === i));
    const on = cursor.kind === 'cell', focus = !on ? [] : cursor.r === 0 ? [cursor.c] : [cursor.r - 1, cursor.c];
    $('grid').querySelectorAll('.hd').forEach((el) => el.classList.toggle('hl', on && +el.dataset.c === cursor.c));
    $('grid').querySelectorAll('.lab[data-r]').forEach((el) => el.classList.toggle('hl', on && +el.dataset.r === cursor.r));
    document.querySelectorAll('#horses .horse').forEach((el, i) => el.classList.toggle('focus', focus.indexOf(i) >= 0));
    renderSel();
  }
  // 賭けたときの手ごたえ: マスが弾み、「+10」が浮かぶ
  function betFx(n) {
    const el = $('grid').querySelector('.cell.cur'); if (!el) return;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    const sr = stageEl.getBoundingClientRect(), er = el.getBoundingClientRect(), k = sr.width / 1600;
    const f = document.createElement('b'); f.className = 'fly'; f.textContent = '+' + n;
    f.style.left = ((er.left + er.width / 2 - sr.left) / k) + 'px'; f.style.top = ((er.top - sr.top) / k - 8) + 'px';
    stageEl.appendChild(f); setTimeout(() => f.remove(), 950);
    const m = $('medalPod'); m.classList.remove('spend'); void m.offsetWidth; m.classList.add('spend');
  }
  function addBet(n) {
    if (phase !== 'bet' || cursor.kind !== 'cell') return;
    const cur = cellBet(cursor.r, cursor.c), room = Engine.MAX_BET - cur;
    if (room <= 0) { Sfx.play('deny'); setMsg('このマスは 99 枚までです', true); return; }
    n = Math.min(n, room, store.medals);
    if (n <= 0) { Sfx.play('deny'); setMsg('メダルが足りません（M キーで補充）', true); return; }
    const shownCarrotsBefore = Engine.carrotCount(bets);
    if (cursor.r === 0) bets.tansho[cursor.c] += n; else bets.umaren[Engine.qkey(cursor.r - 1, cursor.c)] = cur + n;
    store.medals -= n; store.pend = Engine.totalBet(bets); save(); renderMedals(false); Sfx.play(n >= 10 ? 'bet10' : 'bet1'); renderBets(); betFx(n);
    setMsg(cellLabel(cursor.r, cursor.c) + ' に ' + n + ' 枚 BET！　（このマス ' + cellBet(cursor.r, cursor.c) + ' 枚）' + (Engine.carrotCount(bets) > shownCarrotsBefore ? '　応援チャンス +1' : ''));
  }
  function clearBet(all) {
    if (phase !== 'bet') return;
    let back = 0;
    if (all) { back = Engine.totalBet(bets); bets = { tansho: [0, 0, 0, 0, 0, 0], umaren: {} }; }
    else if (cursor.kind === 'cell') { back = cellBet(cursor.r, cursor.c); if (cursor.r === 0) bets.tansho[cursor.c] = 0; else delete bets.umaren[Engine.qkey(cursor.r - 1, cursor.c)]; }
    if (!back) { Sfx.play('deny'); return; }
    store.medals += back; store.pend = Engine.totalBet(bets); save(); renderMedals(false); Sfx.play('cancel'); renderBets(); setMsg(back + ' 枚を戻しました');
  }
  function setMsg(s, warn) { const m = $('msg'); m.textContent = s; m.className = 'msg' + (warn ? ' warn' : ''); void m.offsetWidth; m.classList.add('flash'); }
  let shownCarrots = 0, shownBalls = store.balls;
  function renderCarrots() {
    const n = Engine.carrotCount(bets), box = $('carrots');
    if (n !== shownCarrots || !box.children.length) box.innerHTML = [0, 1, 2].map((k) => '<i class="carrot' + (k < n ? ' on' : '') + '"></i>').join('');
    shownCarrots = n;
  }
  // 新しく点いたボールだけ弾ませる
  function renderBalls(upto) {
    const n = upto == null ? store.balls : upto;
    $('balls').innerHTML = Array.from({ length: Engine.BALLS_MAX }, (_, k) => '<i class="ball' + (k < n ? ' on' : '') + (k < n && k >= shownBalls ? ' new' : '') + '"></i>').join('');
    shownBalls = n;
  }

  // ---------- ベット時間 ----------
  function startTimer() {
    timerLeft = BET_SEC; clearInterval(timerId); $('timer').classList.remove('hot');
    timerId = setInterval(() => {
      timerLeft -= 1; renderTimer();
      if (timerLeft <= 5 && timerLeft > 0) Sfx.play('tick');
      if (timerLeft <= 0) { clearInterval(timerId); if (Engine.totalBet(bets) > 0) startRace(); else { setMsg('馬券がないので もう一度 ' + BET_SEC + ' 秒待ちます'); startTimer(); } }
    }, 1000);
    renderTimer();
  }
  function renderTimer() { $('timerNum').textContent = timerLeft; $('timerBar').style.width = (timerLeft / BET_SEC * 100) + '%'; $('timer').classList.toggle('hot', timerLeft <= 5); }

  // ---------- レース ----------
  let boosts = [], cheerLeft = 0, cheerBusy = false;
  function boost(i, t) { let m = 1; boosts.forEach((b) => { if (b.i === i && t >= b.from && t <= b.to) m *= b.mul; }); return m; }
  async function startRace() {
    if (phase !== 'bet') return;
    if (Engine.totalBet(bets) <= 0) { Sfx.play('deny'); setMsg('馬券を買ってから スタートしてください'); return; }
    phase = 'race'; store.pend = 0; save(); clearInterval(timerId); $('timer').classList.add('off');
    renderMyBets(); stageEl.classList.add('racing');
    boosts = []; cheerLeft = Engine.carrotCount(bets); cheerBusy = false;
    setMsg('まもなく スタート！');
    Sfx.play('fanfare');
    if (window.Commentary) Commentary.begin(raceView, race, odds); // 実況エンジン（録音した声で本物の実況のように話す。使えないときは従来の読み上げ）
    await sleep(900);
    // 本物どおり: ゲートイン（3D は奇数番 → 偶数番の順に係員が枠へ。2 頭ずつ並行して約 8 秒、?speed= で早送り）→ 体勢完了 → ゲートが開く（カウントダウンはしない）
    if (raceView.gateIn && !/[?&]gatein=0/.test(location.search)) {
      // オーナー「ゲートインの実況はいらないかもね」（10/13）: ゲートイン中は声もテロップも出さない（効果音と観客のざわめきだけ）
      try { await raceView.gateIn({ onEvent: () => {} }); } catch (e) { console.error(e); }
    } else { // 2D の映像・?gatein=0: 馬はもう枠の中（前のまま）
      raceView.gateShot = true; try { raceView.cam.mode = ''; raceView.placeCamera(0, true); raceView.draw(); } catch (e) { console.error(e); }
      await sleep(1300); await sleep(900); // ゲートイン・体勢完了の間（声・テロップは出さない）
    }
    raceView.gateShot = false;
    Sfx.play('gate');
    if (cheerLeft > 0) { $('cheer').hidden = false; $('cheerLeft').textContent = 'あと ' + cheerLeft + ' 回'; }
    let hoof = 0, saidGoal = false;
    const res = await raceView.start({
      boost,
      onEvent: (text) => announce(text),
      onPhase: bcPhase, // リプレイ・勝ち馬のアップ（3D の映像だけが呼ぶ）
      onTick: (st) => {
        renderRank(st);
        // 先頭の残り約 70m（ゴールの約 4 秒前）からは、本物の中継と同じく画面の表示を減らす（下の馬券の帯・左上の順位・応援ボタンを 0.8 秒で片付ける。ref/STRAIGHT_STUDY.md 2-3）
        if (!stageEl.classList.contains('bc-final') && raceView.glcv && (Math.max.apply(null, st.pos) > 1 - 70 / race.dist || st.finish.some((f) => f > 0))) { stageEl.classList.add('bc-final'); $('cheer').hidden = true; $('rankPanel').classList.remove('show'); }
        if (st.t - hoof > 0.18 && !st.finish[st.leader]) { hoof = st.t; Sfx.play('hoof'); } if (st.finish[st.leader]) $('cheer').hidden = true;
        // ゴール: 1 着の馬が線を越えたその瞬間に出す（全馬のゴール・リプレイを待つと遅すぎる）
        if (!saidGoal && st.finish.some((x) => x > 0)) {
          saidGoal = true; let w = -1; st.finish.forEach((f, i) => { if (f > 0 && (w < 0 || f < st.finish[w])) w = i; });
          announce('ゴール！　1着は ' + (w + 1) + '番 ' + race.horses[w].name + '！'); Sfx.play('goal');
        }
      },
    });
    $('cheer').hidden = true; bcPhase('done');
    announce('勝ったのは ' + (res.order[0] + 1) + '番 ' + race.horses[res.order[0]].name); // リプレイ・勝ち馬のアップのあと（確認のテロップ）
    await sleep(900);
    await showResult(res);
  }
  // レース中に映像の下へ出す「自分の馬券」
  function badgeHtml(i) { const h = race.horses[i]; return '<i style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</i>'; }
  function renderMyBets() {
    // 点数が多いときは倍率を省き、さらに多いときは馬連をまとめて「馬連 n点」にする
    const tk = [0, 1, 2, 3, 4, 5].filter((i) => bets.tansho[i] > 0), uk = Object.keys(bets.umaren).filter((k) => bets.umaren[k] > 0).sort();
    const n = tk.length + uk.length, dense = n > 5, sumU = n > 8;
    let html = '<small>あなたの馬券</small>';
    tk.forEach((i) => { html += '<span class="mb" data-k="t' + i + '"><em>単勝</em>' + badgeHtml(i) + '<b>' + bets.tansho[i] + '</b>枚' + (dense ? '' : '<em>×' + odds.tansho[i].toFixed(1) + '</em>') + '</span>'; });
    if (sumU) html += '<span class="mb" data-k="u"><em>馬連</em><b>' + uk.length + '</b>点<b>' + uk.reduce((a, k) => a + bets.umaren[k], 0) + '</b>枚</span>';
    else uk.forEach((k) => { const p = k.split('-').map(Number); html += '<span class="mb" data-k="' + k + '"><em>馬連</em>' + badgeHtml(p[0]) + badgeHtml(p[1]) + '<b>' + bets.umaren[k] + '</b>枚' + (dense ? '' : '<em>×' + odds.umaren[k].toFixed(1) + '</em>') + '</span>'; });
    html += '<span class="mbt">合計<b>' + Engine.totalBet(bets) + '</b>枚</span>';
    $('myBets').innerHTML = html; $('myBets').classList.toggle('dense', dense);
  }
  let announceId = 0;
  // テロップを出す。声は実況エンジンが動いていればそちらへ（ゲートイン・体勢完了・応援だけ拾う）、動いていなければ従来の読み上げ
  // テロップは 1.6 秒（講評 r2 の 4）。最大幅（ステージで 760px）に入らない長い文は字を小さくする
  function announce(text) {
    if (window.Commentary && Commentary.active) Commentary.caption(text); else if (window.Voice) Voice.say(text, { urgent: /ゴール|残り 200m|写真判定|大接戦/.test(text) });
    const a = $('announce'); a.style.fontSize = ''; a.textContent = text; a.classList.add('show');
    const max = 506, w = a.scrollWidth; if (w > max) a.style.fontSize = Math.max(14, 22.67 * (max - 40) / (w - 40)).toFixed(1) + 'px';
    clearTimeout(announceId); announceId = setTimeout(() => a.classList.remove('show'), 1600);
  }

  // ---------- 中継のグラフィックス（講評 r2 の 2・5・7） ----------
  // 左上のミニ順位: 上位 3 頭（ゴールした馬は着順、ほかは進んだ距離）。入れ替わりは 0.3 秒続いたら反映（発走直後のちらつき防止）
  let rankKey = '', rankCand = '', rankSince = 0;
  function renderRank(st) {
    const el = $('rankPanel'); if (!el || !race || !raceView.glcv) return; // 2D の映像は自分で順位を描く
    if (!(st.t > 11)) return; // 通過順と同じく発走から約 11 秒で出す（ref/START_STUDY.md 3-3）
    const n = st.pos.length, idx = []; for (let i = 0; i < n; i++) idx.push(i);
    idx.sort((a, b) => { const fa = st.finish[a] > 0, fb = st.finish[b] > 0; if (fa && fb) return st.finish[a] - st.finish[b]; if (fa !== fb) return fa ? -1 : 1; return st.pos[b] - st.pos[a]; });
    const top = idx.slice(0, 3), key = top.join(',');
    if (key !== rankCand) { rankCand = key; rankSince = st.t; }
    if (key === rankKey || (rankKey && st.t - rankSince < 0.3 && !st.finish.some((f) => f > 0))) { if (!el.classList.contains('show') && !stageEl.classList.contains('bc-clean') && !stageEl.classList.contains('bc-final') && !$('tagPhoto').classList.contains('show')) el.classList.add('show'); return; }
    const prev = rankKey ? rankKey.split(',').map(Number) : [];
    rankKey = key;
    if (el.children.length !== 3) el.innerHTML = [1, 2, 3].map((k) => '<div class="rr"><b>' + k + '<small>位</small></b><i></i></div>').join('');
    top.forEach((i, k) => {
      const row = el.children[k], h = race.horses[i], c = row.querySelector('i');
      if (prev[k] === i) return;
      c.textContent = h.no; c.style.background = h.color; c.style.color = h.ink; c.title = h.name;
      if (prev.length) { c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
    });
    if (!stageEl.classList.contains('bc-clean') && !stageEl.classList.contains('bc-final') && !$('tagPhoto').classList.contains('show')) el.classList.add('show');
  }
  let gainId = 0;
  // 3D の映像が段階の変わり目で呼ぶ: 'photo'（写真判定）→ 'replay' → 'winner'（{ winner, order }）→ 'done'。'reset' は次のレースの準備
  function bcPhase(ph, info) {
    const show = (id, on) => { const el = $(id); if (el) el.classList.toggle('show', !!on); };
    info = info || {};
    if (ph === 'photo') { show('rankPanel', false); show('tagPhoto', true); return; }
    if (ph === 'winback') { stageEl.classList.add('bc-clean'); ['rankPanel', 'tagReplay', 'tagPhoto', 'winCard', 'gainBadge'].forEach((id) => show(id, false)); return; } // ゴール後に勝ち馬を後ろから追う間: 何も出さない
    if (ph === 'replay') { stageEl.classList.add('bc-clean'); show('rankPanel', false); show('tagReplay', true); show('tagPhoto', !!info.photo); show('winCard', false); show('gainBadge', false); return; }
    // v4（2026-10-21）: 勝ち馬のアップのあとに 2 着のアップ（'winner2'。カードを銀の「2着」に）→ 2 頭の絵（'winboth'。カードをしまい、映像の下の組み合わせの帯だけ）。「獲得 ○枚」はそのまま
    if (ph === 'winner2') {
      const h2 = race && race.horses[info.second], card = $('winCard'), tag = card && card.querySelector('.w1 b');
      if (h2 && card) { card.classList.add('second'); if (tag) tag.textContent = '2着'; $('wcNo').textContent = h2.no; $('wcNo').style.background = h2.color; $('wcNo').style.color = h2.ink; $('wcName').textContent = h2.name; $('wcOdds').textContent = odds ? '単勝 ' + odds.tansho[info.second].toFixed(1) + ' 倍' : ''; show('winCard', true); const nm = $('wcName'); nm.classList.remove('pop'); setTimeout(() => nm.classList.add('pop'), 400); }
      return;
    }
    if (ph === 'winboth') { show('winCard', false); return; }
    if (ph === 'winner') {
      stageEl.classList.add('bc-clean'); show('rankPanel', false); show('tagReplay', false); show('tagPhoto', false);
      const w = info.winner, h = race && race.horses[w];
      { const card = $('winCard'), tag = card && card.querySelector('.w1 b'); if (card) card.classList.remove('second'); if (tag) tag.textContent = '1着'; }
      if (h) {
        $('wcNo').textContent = h.no; $('wcNo').style.background = h.color; $('wcNo').style.color = h.ink; $('wcName').textContent = h.name;
        $('wcOdds').textContent = odds ? '単勝 ' + odds.tansho[w].toFixed(1) + ' 倍' : '';
        show('winCard', true);
        let pay = 0; try { pay = info.order ? Engine.payout(bets, odds, info.order).total : 0; } catch (e) { pay = 0; }
        clearTimeout(gainId);
        if (pay > 0) gainId = setTimeout(() => { if (!stageEl.classList.contains('bc-clean')) return; $('gainNum').textContent = '0'; show('gainBadge', true); countUp($('gainNum'), pay, 0, 850); Sfx.play('coin'); }, 800); // 0.8 秒後に出して 0.85 秒で数え上げる
        // 馬名は 0.5 秒後に強調（講評 r3 の 6）・観客の歓声（勝ち馬への歓声。プレイヤーの大当たりの歓声とは別に小さく）
        const nm = $('wcName'); nm.classList.remove('pop'); setTimeout(() => nm.classList.add('pop'), 500); Sfx.play('cheer', false);
      }
      return;
    }
    // done / reset: 全部しまう
    clearTimeout(gainId); stageEl.classList.remove('bc-clean', 'bc-final');
    ['rankPanel', 'tagReplay', 'tagPhoto', 'winCard', 'gainBadge'].forEach((id) => show(id, false));
    if (ph === 'reset') { rankKey = ''; rankCand = ''; const el = $('rankPanel'); if (el) el.innerHTML = ''; }
  }

  // 応援: ルーレットで賭けている馬から 1 頭 → 食べ物で加速
  async function cheer() {
    if (phase !== 'race' || cheerBusy || cheerLeft <= 0 || !raceView.run || raceView.run.done >= 6) return;
    const run0 = raceView.run, cands = Engine.betHorses(bets).filter((i) => !run0.finish[i]), rl = $('cheerRoulette'); // ゴールした馬は選ばない
    if (!cands.length) return;
    cheerBusy = true; cheerLeft -= 1; $('cheerLeft').textContent = cheerLeft ? 'あと ' + cheerLeft + ' 回' : '';
    rl.innerHTML = race.horses.map((h) => '<i style="background:' + h.color + ';color:' + h.ink + '" class="' + (cands.indexOf(h.no - 1) >= 0 ? 'lit' : '') + '">' + h.no + '</i>').join('');
    rl.classList.add('show');
    const pickI = cands[Math.floor(Math.random() * cands.length)];
    let k = 0; const total = 13 + pickI; // 最後のコマ（s = total-1）が選ばれた馬で止まる
    for (let s = 0; s < total; s++) { rl.querySelectorAll('i').forEach((el, j) => el.classList.toggle('on', j === s % 6)); Sfx.play('tick'); await sleep(50 + s * s * 1.1); k = s % 6; }
    rl.querySelectorAll('i').forEach((el, j) => el.classList.toggle('on', j === pickI));
    if (phase !== 'race' || raceView.run !== run0 || run0.finish[pickI]) { rl.classList.remove('show'); cheerLeft += 1; cheerBusy = false; return; } // 演出の間にゴールした: 使った回数を戻す
    const food = Engine.spinFood();
    const t = raceView.run.t; if (food.boost > 1) boosts.push({ i: pickI, from: t, to: t + food.sec, mul: food.boost });
    const tag = document.createElement('b'); tag.className = 'food ' + food.key; tag.textContent = food.label + (food.boost > 1 ? '！' : '…'); rl.appendChild(tag);
    Sfx.play(food.boost > 1 ? 'yum' : 'deny');
    announce((pickI + 1) + '番に ' + food.label + (food.key === 'daikon' ? '…効果なし' : food.key === 'corn' ? '！大加速！' : '！加速！'));
    await sleep(900); rl.classList.remove('show'); cheerBusy = false;
    if (cheerLeft <= 0) $('cheer').hidden = true;
  }

  // ---------- 結果 ----------
  // 着差（タイム差を馬身に。1 馬身 ≒ 0.14 秒）
  function margin(dt) {
    // 1 馬身＝0.14 秒で馬身に直してから決める（以前は 1〜1.36 馬身も「3/4」と出て、「1」馬身が出なかった）
    const L = dt / 0.14; if (L > 10) return '大差';
    if (L < 0.15) return 'ハナ'; if (L < 0.3) return 'アタマ'; if (L < 0.45) return 'クビ'; if (L < 0.625) return '1/2'; if (L < 0.875) return '3/4';
    const q = Math.round(L * 4) / 4, whole = Math.floor(q), fr = q - whole;
    if (whole >= 3) return String(Math.round(L));
    return (whole ? whole : '') + (fr === 0.25 ? (whole ? ' ' : '') + '1/4' : fr === 0.5 ? (whole ? ' ' : '') + '1/2' : fr === 0.75 ? (whole ? ' ' : '') + '3/4' : '') || '1';
  }
  const fmtTime = (t0) => { const t = Math.round(t0 * 10) / 10; return fmtTime0(t); }; // 先に 0.1 秒に丸める（59.96 秒が 0:60.0 と出ないように）
  const fmtTime0 = (t) => Math.floor(t / 60) + ':' + ((t % 60) < 10 ? '0' : '') + (t % 60).toFixed(1);
  async function showBoard(res) {
    const f = res.finish, ord = res.order, top = ord.slice(0, 5);
    $('bdRace').textContent = '第' + store.raceNo + 'レース';
    $('bdCond').textContent = (race.surface === 'turf' ? '芝 ' : 'ダート ') + race.dist + 'm　' + { sunny: '晴', cloudy: '曇', rain: '雨' }[race.weather] + '　' + (race.weather === 'rain' ? '重' : race.weather === 'cloudy' ? '稍重' : '良');
    $('bdRows').innerHTML = top.map((i, k) => '<div class="bd-row"><span class="rk">' + (k + 1) + '</span><span class="fc" style="background:' + race.horses[i].color + '"></span><span class="num">' + (i + 1) + '</span><span class="nm">' + race.horses[i].name + '</span><span class="mg">' + (k ? margin(f[i] - f[top[k - 1]]) : '') + '</span></div>').join('');
    $('bdTime').textContent = fmtTime(f[ord[0]]);
    $('bdLast').textContent = (raceView.last3f || 0).toFixed(1);
    const lamp = $('bdLamp'); lamp.className = 'lamp'; lamp.textContent = '確定';
    $('bdPay').className = 'bd-pay'; $('board').hidden = false;
    // 下の着から順に点灯（本物の掲示板は 1 着から出るが、見やすさで上から）
    const rows = $('bdRows').children;
    for (let k = 0; k < rows.length; k++) { rows[k].classList.add('on'); Sfx.play('tick'); await sleep(260); }
    // 僅差なら審議ランプを点滅させてから確定
    const close = f[ord[1]] - f[ord[0]] < 0.05;
    if (close) { lamp.textContent = '審議'; lamp.className = 'lamp shingi'; await sleep(2200); lamp.textContent = '確定'; }
    else await sleep(900);
    lamp.className = 'lamp kakutei'; Sfx.play('bell'); await sleep(900);
    // 払戻金（100 円あたり＝倍率×100）
    const w = ord[0], k2 = Engine.qkey(ord[0], ord[1]);
    $('bdPay').innerHTML = '<div><span><small>単勝</small>' + (w + 1) + '</span><b>' + (Math.floor(odds.tansho[w] * 100)).toLocaleString('ja-JP') + '<small>円</small></b></div><div><span><small>馬連</small>' + (Math.min(ord[0], ord[1]) + 1) + '-' + (Math.max(ord[0], ord[1]) + 1) + '</span><b>' + (Math.floor(odds.umaren[k2] * 100)).toLocaleString('ja-JP') + '<small>円</small></b></div>';
    // 下の帯の自分の馬券で、当たったものを光らせる
    $('myBets').querySelectorAll('.mb').forEach((el) => el.classList.toggle('won', el.dataset.k === 't' + w || el.dataset.k === k2 || (el.dataset.k === 'u' && bets.umaren[k2] > 0)));
    $('bdPay').className = 'bd-pay on'; Sfx.play('chest');
    await sleep(2600);
    $('board').hidden = true;
  }
  async function showResult(res) {
    phase = 'result';
    // 払い戻し・履歴・チャンスボールは先に記録して保存する（掲示板などの演出の途中で閉じても失わない。画面の数字は演出に合わせて後で動かす）
    const pay = Engine.payout(bets, odds, res.order), top3 = res.order.slice(0, 3), earned = Engine.ballsEarned(bets);
    store.medals += pay.total; store.balls += earned;
    store.history.unshift({ no: store.raceNo, order: top3.map((i) => i + 1), bet: Engine.totalBet(bets), pay: pay.total });
    store.history = store.history.slice(0, 50);
    if (pay.total > store.best) store.best = pay.total;
    save();
    if (window.Commentary) Commentary.finish(res); // 実況: 勝ちタイムを言って終わる
    await showBoard(res);
    $('podium').innerHTML = top3.map((i, k) => '<div class="pl p' + (k + 1) + '"><small>' + (k + 1) + '着</small><canvas width="90" height="90"></canvas><i class="no" style="background:' + race.horses[i].color + ';color:' + race.horses[i].ink + '">' + race.horses[i].no + '</i><b>' + race.horses[i].name + '</b></div>').join('');
    $('podium').querySelectorAll('canvas').forEach((cv, k) => { if (!drawPic(cv.getContext('2d'), 45, 86, 30, top3[k])) Horse.draw(cv.getContext('2d'), 44, 84, 34, race.horses[top3[k]], -1, {}); });
    const hitKey = (h) => h.kind === 'tansho' ? '<em>単勝</em>' + badgeHtml(res.order[0]) : '<em>馬連</em>' + badgeHtml(Math.min(res.order[0], res.order[1])) + badgeHtml(Math.max(res.order[0], res.order[1]));
    // 大当たり（講評 r3 の 6）: 100 枚以上、または賭けた枚数の 10 倍以上。紙吹雪（メダルの雨）・光の筋・歓声は大当たりだけ。ふつうの当たりは控えめにしてテンポを保つ
    const betSum = Engine.totalBet(bets), big = pay.total >= 100 || (betSum > 0 && pay.total >= betSum * 10);
    $('hits').innerHTML = pay.hits.length
      ? '<div class="winbig' + (big ? ' big' : '') + '"><b>WIN!</b><em><span id="winNum">0</span><small>枚</small></em><span class="pyr">' + [1, 2, 3, 4].slice(0, Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, pay.total))))).map((n) => '<i style="width:' + (n * 16) + 'px"></i>').join('') + '</span></div>' + pay.hits.map((h) => '<div class="hit"><span class="hk">' + hitKey(h) + '</span><span class="hm">' + h.bet + '枚 × ' + h.odds.toFixed(1) + '倍</span><b>' + h.amt.toLocaleString('ja-JP') + ' 枚</b></div>').join('')
      : '<div class="hit miss">ハズレ…<small>次のレースに期待！</small></div>';
    $('result').hidden = false; $('result').className = 'result show' + (pay.total > 0 ? ' win' : '') + (big ? ' big' : '');
    if (pay.total > 0) countUp($('winNum'), pay.total, 450, 850); // 獲得枚数は 0.85 秒で数え上げる
    $('coinRain').innerHTML = ''; if (big) coinRain(46);
    if (pay.total > 0) { Sfx.play('win', big); if (big) Sfx.play('cheer', true); await sleep(400); renderMedals(true); Sfx.play('coins'); }
    else { Sfx.play('lose'); }
    await sleep(pay.total > 0 ? (big ? 2600 : 2100) : 1300); // 当たり 約 2.5 秒（大当たり 3 秒）・外れ 約 1.3 秒
    // チャンスボール
    for (let k = 0; k < earned; k++) { Sfx.play('ball'); renderBalls(Math.min(store.balls, shownBalls + 1)); await sleep(250); }
    renderBalls();
    if (store.balls >= Engine.BALLS_MAX) { store.balls = 0; save(); await bonusRoulette(); renderBalls(); }
    $('result').hidden = true; stageEl.classList.remove('racing'); $('timer').classList.remove('off');
    newRace();
  }

  // WIN の演出: メダルが降る／枚数を数え上げる
  function coinRain(n) {
    const box = $('coinRain'); let html = '';
    for (let k = 0; k < n; k++) { const s = 18 + Math.random() * 18; html += '<i style="left:' + (Math.random() * 980).toFixed(0) + 'px;width:' + s.toFixed(0) + 'px;height:' + s.toFixed(0) + 'px;animation-duration:' + ((1.4 + Math.random() * 1.4) / SPEED).toFixed(2) + 's;animation-delay:' + ((0.6 + Math.random() * 1.6) / SPEED).toFixed(2) + 's"></i>'; }
    box.innerHTML = html;
  }
  function countUp(el, to, delay, ms) {
    setTimeout(() => {
      const t0 = performance.now(), dur = (ms || Math.min(1600, 500 + to * 3)) / SPEED;
      (function tick(now) { const u = Math.min(1, (now - t0) / dur); if (el.isConnected) el.textContent = Math.round(to * (1 - Math.pow(1 - u, 3))).toLocaleString('ja-JP'); if (u < 1) requestAnimationFrame(tick); })(t0);
    }, delay);
  }

  // ---------- ボーナスルーレットと牧場 ----------
  async function bonusRoulette() {
    const box = $('broulette'), wheel = $('wheel');
    const items = []; Engine.ROULETTE.forEach((it) => { for (let k = 0; k < it.w; k++) items.push(it); });
    const seq = shuffle(items);
    wheel.innerHTML = seq.map((it) => '<i class="' + it.key + '">' + it.label + '</i>').join('');
    $('brouletteMsg').textContent = ''; $('result').hidden = true; box.hidden = false; Sfx.play('fanfare');
    await sleep(600);
    const hit = Engine.spinRoulette(); const target = seq.findIndex((it) => it.key === hit.key);
    const n = seq.length, total = n * 3 + target;
    for (let s = 0; s <= total; s++) { wheel.querySelectorAll('i').forEach((el, j) => el.classList.toggle('on', j === s % n)); Sfx.play('tick'); await sleep(s < total - 10 ? 60 : 60 + (s - (total - 10)) * 45); }
    $('brouletteMsg').textContent = hit.key === 'miss' ? 'ざんねん…' : hit.label + ' に当選！';
    Sfx.play(hit.key === 'miss' ? 'lose' : 'win', hit.key === 'ultra');
    await sleep(1600); box.hidden = true;
    if (hit.key === 'miss') return;
    phase = 'bonus';
    const my = Engine.betHorses(bets)[0] || 0;
    const got = await Bonus.play($('race'), hit, race.horses[my], (score, v) => Sfx.play(v >= 20 ? 'chest' : 'coin'), (c, x, y, ppm) => drawPic(c, x, y, ppm, my));
    store.medals += got; save(); renderMedals(true); toast('ボーナス牧場で ' + got + ' 枚 GET！', 2500);
    await sleep(1200);
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ---------- 操作 ----------
  const BTN_ACTS = ['bet1', 'bet10', 'clear', 'clearAll', 'go'];
  function doAct(act) {
    // リモコン（矢印キー）でボタンに移ったときは、直前に選んでいたマスに賭ける・取り消す（以前はボタンの 1枚・10枚・取消が効かなかった）
    if (cursor.kind === 'btn' && cursor.cell && /^(bet1|bet10|clear)$/.test(act)) { const btn = cursor; cursor = btn.cell; try { doAct(act); } finally { btn.cell = cursor; cursor = btn; renderCursor(); } return; }
    if (act === 'bet1') addBet(1); else if (act === 'bet10') addBet(10); else if (act === 'clear') clearBet(false); else if (act === 'clearAll') clearBet(true); else if (act === 'go') startRace();
  }
  $('btns').addEventListener('click', (e) => { const b = e.target.closest('.bbtn'); if (b) { doAct(b.dataset.act); } });
  $('cheerBtn').addEventListener('click', cheer);
  function move(dr, dc) {
    if (cursor.kind === 'btn') {
      if (dc) { cursor.i = (cursor.i + dc + BTN_ACTS.length) % BTN_ACTS.length; }
      else if (dr < 0) { cursor = cursor.cell || { kind: 'cell', r: 5, c: 5 }; }
      renderCursor(); Sfx.play('select'); return;
    }
    let r = cursor.r, c = cursor.c;
    if (dc) { c += dc; if (!cellExists(r, c)) { if (dc > 0 && c > 5) c = r; /* 行の右端から右へ → その行の先頭（単勝の行も。以前は単勝 6 の右で止まって例外になった） */ else if (dc < 0 && c < r) c = 5; else if (dc < 0 && c < 0) c = 5; } }
    if (dr) { r += dr; if (r > 5) { cursor = { kind: 'btn', i: 0, cell: { kind: 'cell', r: cursor.r, c: cursor.c } }; renderCursor(); Sfx.play('select'); return; } if (r < 0) r = 5; if (!cellExists(r, c)) c = Math.max(c, r); if (!cellExists(r, c)) c = 5; }
    cursor = { kind: 'cell', r, c }; renderCursor(); Sfx.play('select');
  }
  document.addEventListener('keydown', (e) => {
    if (phase === 'splash') { if (e.key === 'Enter' || e.key === ' ') dismissSplash(); return; }
    if (phase === 'race') { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cheer(); } return; }
    if (phase !== 'bet') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); move(0, -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); move(0, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1, 0); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1, 0); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (cursor.kind === 'btn') doAct(BTN_ACTS[cursor.i]); else addBet(1); }
    else if (e.key === '0') addBet(10);
    else if (e.key === 'Backspace' || e.key === 'Delete') clearBet(false);
    else if (e.key === 's' || e.key === 'S') startRace();
    else if (e.key === 'm' || e.key === 'M') { store.medals += 100; save(); renderMedals(true); toast('メダルを 100 枚 追加しました'); }
  });
  // ロゴ長押しでメダル補充（テレビ向けには M キー）
  let holdId = 0;
  $('stage').querySelector('.logo').addEventListener('pointerdown', () => { holdId = setTimeout(() => { store.medals += 100; save(); renderMedals(true); toast('メダルを 100 枚 追加しました'); }, 1500); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('stage').querySelector('.logo').addEventListener(ev, () => clearTimeout(holdId)));

  // ---------- 起動画面 ----------
  // 走る馬はレースと同じ 3D のかわいい馬（js/splash3d.js）。WebGL が無い・?r2d=1・作れないときは 2D の絵（Horse.draw）
  let splashRun = null;
  function splashArt() {
    const demo = splashArt.demo || (splashArt.demo = Engine.makeRace().horses);
    const box = $('splashRun');
    if (!splashRun && !splashArt.no3d && box && window.Splash3D && window.Race && window.Race.Race3D && !/[?&]r2d=1/.test(location.search)) {
      try { splashRun = Splash3D.start(box, demo, { quality: (window.R3D && R3D.quality) || 'high', onFail: () => { splashRun = null; splashArt.no3d = true; if (box) box.classList.remove('is3d'); splashArt(); } }); } catch (e) { splashRun = null; }
      if (splashRun) { box.classList.add('is3d'); window.DERBY_SPLASH = splashRun; } else splashArt.no3d = true;
    }
    if (splashRun) return;
    const cv = $('splashHorses'); if (!cv) return; const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height); demo.forEach((h, i) => Horse.draw(c, 110 + i * 156, 238 - (i % 2) * 26, 70, h, 0.15 * i, {}));
  }
  splashArt();
  function dismissSplash() {
    const sp = $('splash'); if (!sp) return;
    Sfx.unlock(); Sfx.play('button'); if (window.Voice) Voice.unlock(); if (window.Commentary) Commentary.unlock();
    sp.id = ''; sp.classList.add('bye'); setTimeout(() => { sp.remove(); if (splashRun) { splashRun.stop(); splashRun = null; } }, 520); // 消えたら 3D の馬・レンダラーも片付ける
    renderMedals(false); newRace();
  }
  $('splash').addEventListener('click', dismissSplash);
  // 音のボタンを指で押したときは起動画面を閉じない（touchend の preventDefault でボタンの click が消えていた）
  $('splash').addEventListener('touchend', (e) => { if (e.target.closest && e.target.closest('.soundbtn')) return; e.preventDefault(); dismissSplash(); }, { passive: false });
  renderMedals(false); renderBalls();
  Sprites.load().then(() => { splashArt(); if (race) { raceView.draw(); renderHorses(); renderBets(); renderCursor(); } });
  window.DERBY = { store, raceView, Engine, version: APP_V, get race() { return race; }, get odds() { return odds; }, get bets() { return bets; }, get phase() { return phase; }, startRace, cheer,
    // テスト用: マス (r,c) に n 枚
    testBet(r, c, n) { if (!cellExists(r, c)) return false; cursor = { kind: 'cell', r, c }; renderCursor(); addBet(n); return true; } };
})();
