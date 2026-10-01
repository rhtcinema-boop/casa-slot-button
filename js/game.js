/* プレイヤー画面の進行制御: レイアウト、レバー、抽選確定、ステージ演出、スタッフ認証。 */
const Game = (function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const CX = 765, CY = 420;          // リール窓の中心（#content 座標）
  /* ステージごとのテーマカラー（粒子・稲妻・衝撃波の色）: 1=ゴールド / 2=サファイア / 3=ルビー */
  const STAGE_COL = { 1: ['gold', 'gold', 'white'], 2: ['blue', 'cyan', 'white', 'violet'], 3: ['red', 'gold', 'white', 'red'] };
  const STAGE_ACC = { 1: 'gold', 2: 'cyan', 3: 'red' };
  let oneMore = false;
  let openSettings = null; // 設定画面を開く（ロゴ3回タップ／テレビのメニューボタン3回） // ワンモアチャンスでレバーの引き直し待ちか
  let sureShown = false, sureText = ['WIN CONFIRMED', '当選確定！']; // 確定演出が発生中か
  const RAINBOW = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet'];
  const MSG_EMPTY = '抽選可能回数がありません。設定を確認してください。';
  let stageH = 900, lastTrans = '';
  let scale = 1, busy = false, curStage = 1, showingResult = false;
  let stageEl, cabinet, win, plate, lockbar, banner;

  /* ---------- レイアウト（16:9 基準・上下は背景で埋める） ---------- */
  /* 表示範囲: 画面サイズ調整で決めた四角（左上と右下の角。画面に対する割合 0〜1）。未設定なら全画面 */
  const FULL = { x0: 0, y0: 0, x1: 1, y1: 1 };
  let calib = null; // 調整中の値
  function screenRect() {
    if (calib) return calib;
    let s = null;
    try { s = Store.state && Store.state.settings && Store.state.settings.screen; } catch (err) { /* 起動直後 */ }
    return s && s.x1 - s.x0 >= 0.3 && s.y1 - s.y0 >= 0.3 ? s : FULL;
  }
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight, sr = screenRect();
    const w = Math.max(1, (sr.x1 - sr.x0) * vw), h = Math.max(1, (sr.y1 - sr.y0) * vh);
    const H = Math.min(1200, Math.max(900, Math.round(1600 * h / w)));
    scale = Math.min(w / 1600, h / H);
    stageEl.style.height = H + 'px';
    stageEl.style.transform = 'translate(' + (sr.x0 * vw + (w - 1600 * scale) / 2) + 'px,' + (sr.y0 * vh + (h - H * scale) / 2) + 'px) scale(' + scale + ')';
    // 縦に余裕がある画面（4:3 の iPad など）では全体を最大15%拡大して上下の余白を減らす
    // 4:3 では縮めずに行の間隔を広げて縦を使い切る（CSS の --t で各行が下へずれる。最下段は 110px 下がる）。横は 6% だけ拡大
    const t = (H - 900) / 300, f = 1 + 0.06 * t;
    [$('content'), $('fxwrap')].forEach((el) => {
      el.style.left = 30 * (1 - f) + 'px';            // 拡大の基準点（リール中心）のずれを補正して中央に保つ
      el.style.top = (H - 900) / 2 - 55 * t + 30 * (1 - f) + 'px';
      el.style.transform = 'scale(' + f + ')'; // scale プロパティは古い WebView が非対応なので transform を使う
      el.style.setProperty('--t', t.toFixed(3));
    });
    scale *= f;
    stageH = H;
    if (typeof FX !== 'undefined') FX.setGround(450 + H / 2 / (1 + 0.06 * (H - 900) / 300) + 6, () => Sfx.play('chip'));
  }

  /* ---------- 画面サイズ調整 ----------
     テレビによっては画面の端が切れて映る。左上と右下の角を動かして「見えている範囲」を決めると、その中に全体が収まる。
     十字キー: 角を動かす / 決定: 動かす角を切り替え / メニュー: 全画面に戻す / 戻る: 保存して終了。タッチは角をドラッグ。 */
  function calibrate() {
    return new Promise((resolve) => {
      const before = Object.assign({}, screenRect());
      calib = Object.assign({}, before);
      let active = 0; // 0 = 左上, 1 = 右下
      const MIN = 0.5; // 幅・高さは画面の半分より小さくしない
      const cl = (v, a, b) => Math.min(b, Math.max(a, v));
      const el = document.createElement('div');
      el.id = 'calib';
      el.innerHTML = '<div class="cal-frame"><i class="cal-c tl" data-c="0"></i><i class="cal-c br" data-c="1"></i>' +
        '<div class="cal-panel"><h3>画面サイズ調整</h3>' +
        '<p>白い枠の<b>角</b>が、画面のふちにちょうど見える位置に合わせてください。枠の中に全体が収まります。</p>' +
        '<ul><li><b>十字キー</b>：角を動かす（押しっぱなしで速く）</li><li><b>決定</b>：動かす角を切り替え（左上 ⇄ 右下）</li><li><b>メニュー（≡）</b>：全画面に戻す</li><li><b>戻る</b>：保存して終了</li><li>タッチの場合は、角を指で動かせます</li></ul>' +
        '<div class="cal-val"></div>' +
        '<div class="cal-btns"><button data-b="tl">左上の角</button><button data-b="br">右下の角</button><button data-b="reset">全画面に戻す</button><button data-b="cancel">キャンセル</button><button data-b="save" class="go">保存して閉じる</button></div></div></div>';
      const frame = el.firstChild, val = el.querySelector('.cal-val');
      const pct = (v) => (Math.round(v * 1000) / 10).toFixed(1) + '%';
      function draw() {
        const vw = window.innerWidth, vh = window.innerHeight;
        frame.style.left = calib.x0 * vw + 'px'; frame.style.top = calib.y0 * vh + 'px';
        frame.style.width = (calib.x1 - calib.x0) * vw + 'px'; frame.style.height = (calib.y1 - calib.y0) * vh + 'px';
        el.querySelector('.tl').classList.toggle('on', active === 0);
        el.querySelector('.br').classList.toggle('on', active === 1);
        el.querySelector('[data-b="tl"]').classList.toggle('on', active === 0);
        el.querySelector('[data-b="br"]').classList.toggle('on', active === 1);
        val.textContent = 'いま動かす角: ' + (active === 0 ? '左上' : '右下') + '　｜　左上 ' + pct(calib.x0) + ', ' + pct(calib.y0) + '　右下 ' + pct(calib.x1) + ', ' + pct(calib.y1);
        layout();
      }
      function setCorner(c, x, y) { // x, y は画面に対する割合
        if (c === 0) { calib.x0 = cl(x, 0, calib.x1 - MIN); calib.y0 = cl(y, 0, calib.y1 - MIN); }
        else { calib.x1 = cl(x, calib.x0 + MIN, 1); calib.y1 = cl(y, calib.y0 + MIN, 1); }
        draw();
      }
      function nudge(dx, dy, fast) {
        const d = fast ? 4 : 1;
        if (active === 0) setCorner(0, calib.x0 + dx * d / window.innerWidth, calib.y0 + dy * d / window.innerHeight);
        else setCorner(1, calib.x1 + dx * d / window.innerWidth, calib.y1 + dy * d / window.innerHeight);
      }
      function finish(save) {
        const v = calib, full = v.x0 <= 0 && v.y0 <= 0 && v.x1 >= 1 && v.y1 >= 1;
        calib = null;
        if (save) { try { Store.transact((s) => { s.settings.screen = full ? null : { x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1 }; }); } catch (err) { UI.toast('保存に失敗しました: ' + err.message, 'err'); } }
        if (window.TV) TV.setCapture(null);
        window.removeEventListener('resize', draw);
        el.remove();
        layout();
        if (save) UI.toast(full ? '全画面に戻しました。' : '画面サイズを保存しました。', 'ok');
        resolve(save);
      }
      function onKey(k, repeat) {
        if (k === 'ArrowLeft') nudge(-1, 0, repeat); else if (k === 'ArrowRight') nudge(1, 0, repeat);
        else if (k === 'ArrowUp') nudge(0, -1, repeat); else if (k === 'ArrowDown') nudge(0, 1, repeat);
        else if (k === 'Enter') { if (!repeat) { active = 1 - active; Sfx.play('button'); draw(); } }
        else if (k === 'Menu') { calib = Object.assign({}, FULL); draw(); }
        else if (k === 'Back') finish(true);
      }
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-b]');
        if (!b) return;
        Sfx.play('button');
        const k = b.dataset.b;
        if (k === 'tl') { active = 0; draw(); } else if (k === 'br') { active = 1; draw(); }
        else if (k === 'reset') { calib = Object.assign({}, FULL); draw(); }
        else if (k === 'cancel') { calib = before; finish(false); }
        else if (k === 'save') finish(true);
      });
      // 角を指（マウス）でつかんで動かす
      let drag = -1;
      el.addEventListener('pointerdown', (e) => { const c = e.target.closest('.cal-c'); if (!c) return; drag = +c.dataset.c; active = drag; try { c.setPointerCapture(e.pointerId); } catch (err) { /* 古い環境 */ } e.preventDefault(); draw(); });
      el.addEventListener('pointermove', (e) => { if (drag >= 0) setCorner(drag, e.clientX / window.innerWidth, e.clientY / window.innerHeight); });
      const up = () => { drag = -1; };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      window.addEventListener('resize', draw);
      $('viewport').appendChild(el);
      if (window.TV) TV.setCapture(onKey);
      draw();
    });
  }
  const screenInfo = () => { const s = screenRect(); return s === FULL ? null : s; };

  /* 時間の速さを from → to へ指数関数的に変える（粒子と画面上のアニメーション全体が対象）。
     例: bulletTime(0.15, 0.5) … 0.15秒ほぼ止まり、0.5秒かけて指数的に等速へ戻る */
  let warpRaf = 0;
  function applyRate(rate) { FX.setTimeScale(rate); } // スローは粒子だけに掛ける
  function timeWarp(from, to, dur) {
    cancelAnimationFrame(warpRaf);
    const t0 = performance.now();
    let lastSet = 0;
    const step = (now) => {
      const u = Math.min(1, (now - t0) / (dur * 1000));
      if (now - lastSet > 70 || u >= 1) { lastSet = now; applyRate(from * Math.pow(to / from, u)); }
      if (u < 1) warpRaf = requestAnimationFrame(step);
    };
    applyRate(from);
    warpRaf = requestAnimationFrame(step);
  }
  function bulletTime(hold, ramp, slow) {
    cancelAnimationFrame(warpRaf);
    applyRate(slow || 0.06);
    const iv = setInterval(() => applyRate(slow || 0.06), 70); // 止まっている間に生まれたアニメにも適用
    setTimeout(() => { clearInterval(iv); timeWarp(slow || 0.06, 1, ramp); }, hold * 1000);
  }
  /* 筐体を奥へ叩き込む（3D） */
  function bump() { /* 筐体は固定（立体的には動かさない） */ }

  /* 連続フラッシュ */
  function strobe(n, gap) { for (let i = 0; i < n; i++) setTimeout(() => flash(true), i * (gap || 130)); }
  function quake() { restart(cabinet, 'shake'); } // 揺らすのはリールの筐体だけ（画面全体を揺らすと重い）
  const raf2 = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  /* 演出中は背景の常時アニメ（光条・ライト・外周光・LED）を非表示にして描画負荷を空ける */
  function fxMode(on) { stageEl.classList.toggle('fxmode', on); }
  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function flash(soft) { const f = $('flash'); f.className = ''; void f.offsetWidth; f.className = soft ? 'go-soft' : 'go'; }

  function buildBulbs() {
    const box = $('bulbs'), pts = [];
    // 筐体 810×540 の外周に沿って並べる（上下13個・左右8個）
    const W = 810, H = 540, L = 31, T = 31, R = W - 31, B = H - 31;
    const xs = [], ys = [];
    for (let i = 0; i < 13; i++) xs.push(Math.round(78 + (W - 156) * i / 12));
    for (let i = 0; i < 8; i++) ys.push(Math.round(84 + (H - 168) * i / 7));
    xs.forEach((x) => pts.push([x, T]));
    ys.forEach((y) => pts.push([R, y]));
    xs.slice().reverse().forEach((x) => pts.push([x, B]));
    ys.slice().reverse().forEach((y) => pts.push([L, y]));
    pts.forEach((p, i) => {
      const b = document.createElement('i');
      b.style.left = p[0] + 'px'; b.style.top = p[1] + 'px';
      b.style.animationDelay = 'calc(var(--bulb) * ' + (-(i / pts.length) * 4).toFixed(3) + ')';
      box.appendChild(b);
    });
  }

  /* 結果 val を静止表示するときの3本の絵柄（直前に回した組み合わせがあればそれ、無ければ代表的なもの） */
  let lastCombo = null;
  function comboFor(st, val) {
    const p = Store.state.play;
    if (p && p.combo && p.stage === st && p.value === val) return p.combo;
    if (lastCombo && lastCombo.st === st && lastCombo.read === val) return lastCombo.combo;
    return Engine.reelCombos(st, val)[0];
  }
  function setStage(n, show) {
    curStage = n;
    stageEl.dataset.stage = n;
    document.querySelectorAll('#ladder .rung').forEach((r) => {
      const s = +r.dataset.s;
      r.classList.toggle('on', s === n);
      r.classList.toggle('done', s < n);
    });
    if (sureShown) FX.setAmbient(40, RAINBOW); else FX.setAmbient([0, 0, 14, 30][n], STAGE_COL[n]);
    Reel.setStage(n, show === undefined ? undefined : comboFor(n, show));
    Sfx.setStage(n);
  }

  function setPlate(mode, main, sub) {
    plate.className = 'plate ' + mode;
    $('plateMain').textContent = main || '';
    $('plateSub').textContent = sub || '';
    $('plateSub').style.display = sub ? '' : 'none';
  }

  /* ---------- レバー ---------- */
  const Lever = { init() {}, setEnabled() {} }; // ボタン版: レバーは無い

  /* ---------- 状態 → 画面 ---------- */
  /* 待機中: 下の大きな NEXT GAME ボタンだけを出す */
  const lastBox = (v) => '<div class="res"><small>LAST</small><b class="' + (v === 0 ? 'zero' : 'amt lv' + Math.max(1, WIN_LEVELS.filter((x) => x <= v).length)) + '">' + fmtN(v) + '</b></div>';
  function idleBar() {
    plate.classList.add('hidden');
    const lv = Store.state.lastValue; // 直前のゲームの結果（自動で待機画面に戻ったあとも LAST に残す）
    const has = typeof lv === 'number';
    lockbar.innerHTML = (has ? lastBox(lv) : '') + '<div class="side' + (has ? '' : ' solo') + '"><button class="btn" data-act="next">NEXT GAME</button></div>';
    lockbar.classList.add('show');
    resultSince = 0;
  }
  /* 結果を出したまま 10 秒たったら、最初の待機画面（STAGE 1・READY TO SPIN）へ自動で戻す。
     設定やダイアログを開いている間は数えない（閉じてから 10 秒）。 */
  const IDLE_BACK_MS = 10000;
  let resultSince = 0;
  async function idleWatch() {
    const p = Store.state && Store.state.play;
    if (!resultSince || busy || pressing || !p || p.phase !== 'shown') return;
    if ($('ui').children.length || $('calib') || document.getElementById('splash')) { resultSince = Date.now(); return; }
    if (Date.now() - resultSince < IDLE_BACK_MS) return;
    resultSince = 0;
    if (await clearShown()) refresh();
  }
  function refresh() {
    if (busy) return;
    const s = Store.state;
    showCredits();
    renderRecent();
    if (s.play && s.play.phase === 'shown') return showLocked(s.play, false);
    win.classList.remove('win', 'lose');
    cabinet.classList.remove('party');
    if (s.play) { // 演出の途中で閉じた: NEXT GAME で続きから再開（再抽選はしない）
      const st = s.play.cur || 1;
      if (showingResult || curStage !== st) { showingResult = false; setStage(st); }
      return idleBar();
    }
    clearSure();
    if (showingResult || curStage !== 1) { showingResult = false; setStage(1); }
    if (!s.pins) { lockbar.classList.remove('show'); return setPlate('idle', 'WELCOME', ''); }
    idleBar();
  }
  const hhmm = (ts) => { const d = new Date(ts), p = (n) => ('0' + n).slice(-2); return '<i>' + d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + '</i>' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
  /* 画面右: 配当の履歴（日付・時刻と金額。新しい順、直近200件）。はみ出す数になったら自動でゆっくり上下にスクロールする */
  let recentShown = -1;
  function renderRecent() {
    const list = $('recentList');
    const all = Store.state.recent || [];
    const r = all.slice(-10).reverse();
    const grew = recentShown >= 0 && all.length > recentShown;
    recentShown = all.length;
    list.innerHTML = r.length
      ? r.map((x, i) => '<div class="rc' + (grew && i === 0 ? ' new' : '') + '"><small>' + hhmm(x.ts) + '</small><b>' + fmtN(x.value) + '</b></div>').join('')
      : '<div class="rc none">—</div>';
  }

  /* 画面に出す合計当選額。演出中のプレイの分は、結果が出るまで含めない */
  function shownTotal() {
    const s = Store.state;
    return (s.wonTotal || 0) - (s.play && s.play.phase === 'drawn' ? s.play.value : 0);
  }
  function showCredits() {
    $('credit').textContent = fmtN(Store.state.session.playNo); // ボタン版: プレイ回数
    { const st = Store.state, p = st.play; $('total').textContent = fmtN(st.session.awarded - (p && p.phase === 'drawn' ? p.value : 0)); } // 合計当選額（演出中の分は結果が出てから）
  }
  /* クレジットを使い切ったとき: 合計当選額を大きく見せる */
  async function totalFx(total) {
    fxMode(true);
    showBanner('win lv3 total', 'TOTAL WIN', fmtN(total), 1000);
    flash(true);
    if (total > 0) { Sfx.play('win', 3); FX.burst(CX, CY, 160, { max: 1200, life: 1.5 }); FX.ring(CX, CY, 'gold', 1000, 0.8); FX.chips(50, 1.0, ['gold', 'black', 'red']); }
    else Sfx.play('stop');
    await wait(2300);
    await hideBanner();
    fxMode(false);
  }
  /* PIN認証 → 何クレジット入れるか入力 → 加算。成功したら true */
  async function addCredits() {
    const role = await UI.auth('認証が必要です', ['staff', 'admin'], 'クレジット追加', 'PINを入力してください');
    if (!role) return false;
    const n = await UI.askNumber({ title: 'クレジットを入れる', sub: '入れるクレジット数（1〜99）', min: 1, max: 99 });
    if (!n) return false;
    try {
      Store.transact((s) => {
        const before = s.credits || 0;
        const prevTotal = s.wonTotal || 0;
        if (before === 0) s.wonTotal = 0;   // 0 から入れ直したら、合計当選額は新しく数え始める
        s.credits = before + n;
        Store.log('CREDIT_ADD', { amount: n, before, after: s.credits, prevTotal: before === 0 ? prevTotal : undefined }, role);
      });
    } catch (err) { UI.toast('保存に失敗しました: ' + err.message, 'err'); return false; }
    Sfx.play('ok');
    showCredits();
    return true;
  }

  /* 確定済みプレイの途中: このステージのレバーを客自身が引くのを待つ（再起動時の復元にも使用） */
  function awaitLever(st, fresh) {
    win.classList.remove('win', 'lose');
    cabinet.classList.remove('party');
    if (showingResult || curStage !== st) { showingResult = false; setStage(st); }
    Lever.setEnabled(true);
    setPlate('idle', 'PRESS TO SPIN', st === 1 ? '「スロットを回す」を押してください' : 'STAGE ' + st + ' ― 「スロットを回す」で続きから再開します');
    if (fresh) Sfx.play('stageReady');
  }

  /* 結果表示＋レバー完全ロック（再起動時の復元にも使用） */
  function showLocked(play, animate) {
    showingResult = true;
    Lever.setEnabled(false);
    if (!animate) {
      setStage(play.stage, play.value);
      win.classList.toggle('win', play.value > 0);
      win.classList.toggle('lose', play.value === 0);
    }
    plate.classList.add('hidden');
    renderLockbar();
    lockbar.classList.add('show');
  }
  function renderLockbar() {
    const p = Store.state.play;
    lockbar.innerHTML = lastBox(p.value) + '<div class="side"><button class="btn" data-act="next">NEXT GAME</button></div>';
    resultSince = Date.now(); // ここから 10 秒で待機画面へ戻す
  }
  /* 結果表示中のプレイを片付けて STAGE 1 に戻す */
  async function clearShown() {
    if (!Store.state.play) return true;
    try {
      Store.transact((s) => {
        Store.log('NEXT_PLAY', { playNo: s.play ? s.play.playNo : null, credits: s.credits });
        if (s.play) s.lastValue = s.play.value;
        s.play = null; s.locked = false;
      });
    } catch (err) { UI.toast('保存に失敗しました: ' + err.message, 'err'); return false; }
    busy = true;
    lockbar.classList.remove('show');
    if (curStage !== 1) await transition(1); else setStage(1);
    win.classList.remove('win', 'lose');
    showingResult = false;
    // 次のゲームの前に、リールに READY TO SPIN を一拍見せる
    setPlate('idle', 'NEXT GAME', '');
    await wait(900);
    busy = false;
    return true;
  }
  let pressing = false;
  /* ボタンは NEXT GAME の1個だけ。押すと1回で最後のステージまで自動で進む */
  async function onLockbar(e) {
    const b = e.target.closest('[data-act]');
    if (!b || busy || pressing) return;
    Sfx.unlock();
    Sfx.play('button');
    // 押し込んだ見た目を一瞬見せてから進む（面が土台に沈む。土台の位置は動かない）
    pressing = true;
    b.classList.add('pressed');
    await wait(190);
    pressing = false;
    if (busy) return;
    const s = Store.state;
    if (s.play && s.play.phase === 'drawn') { lockbar.classList.remove('show'); return runStage(s.play, s.play.cur || 1); }
    if (!(await clearShown())) return;
    startPlay();
  }

  /* ---------- 抽選確定 ----------
     レバーを引き切った瞬間に「抽選・在庫消費・ロック・履歴」を1回の書き込みで確定する。
     以降の演出は確定済みの結果をなぞるだけなので、途中で落ちても再抽選は起きない。 */
  function startPlay() {
    const s0 = Store.state;
    if (busy || s0.locked || s0.play) return refresh();
    let res;
    try {
      Store.transact((s) => {
        const ses = s.session;
        const v = Engine.validateProbs(s.probs);
        if (!v.ok) throw new Error('probs');
        const now = Date.now();
        s.hits = Engine.pruneHits(s.hits, now, s.limits && s.limits.resetHour);
        const blocked = Engine.blockedKeys(s.limits, s.hits, now);
        res = Engine.drawProb(s.probs, undefined, blocked);
        if (res.value > 0) s.hits.push({ ts: now, key: res.key });
        ses.playNo += 1;
        ses.awarded += res.value;
        s.wonTotal = (s.wonTotal || 0) + res.value; // 合計当選額も同じ書き込みで加算（表示は結果が出てから）
        s.play = { playNo: ses.playNo, stage: res.stage, value: res.value, overflow: false, phase: 'drawn', cur: 1, ts: Date.now() };
        s.locked = true;
        Store.log('PLAY', { playNo: ses.playNo, stage: res.stage, value: res.value, key: res.key, path: Engine.pathFor(res.stage), blocked: blocked.length ? blocked : undefined });
      });
    } catch (err) {
      UI.toast(err.message === 'probs' ? '確率の設定に誤りがあります。設定画面で確認してください。' : '抽選を開始できませんでした（保存エラー）。', 'err');
      return refresh();
    }
    oneMore = false; freeSpun = false;
    showCredits();
    lockbar.classList.remove('show');
    if (storeMode()) { const p = Store.state.play, me = Store.state.store; Cloud.pushPlay(me.id, { ts: p.ts, stage: p.stage, value: p.value, key: p.stage + ':' + p.value, playNo: p.playNo, presetId: Store.state.presetId || null }, Store.state.limits && Store.state.limits.resetHour).catch(() => {}); }
    runStage(Store.state.play, 1);
  }

  /* ---------- 停止パターンの抽選（結果は確定済み。見せ方だけを変える） ----------
     ハズレ(0)で止まるとき …「当たりと思いきやハズレ」: 当たり絵柄で止まりかけて滑る／行きかけて戻される
     当たり・NEXT で止まるとき …「ハズレと思いきや当たり」: 0 で止まりかけて滑る／0 に行きかけて戻る／0 で一度止まって再始動
     DRAMA はその演出が出る割合（ステージ別）。 */
  const DRAMA = { lose: [0, 0.55, 0.7, 0.9], win: [0, 0.5, 0.65, 0.85] };
  /* FREE SPIN ×1: リールに FREE SPIN が3本そろい、自動でもう一度回る。演出だけで、結果（確率で確定済み）や回転数は変わらない。
     出る割合は、最終結果がハズレのスピンで 6%、当たり・NEXT STAGE のスピンで 12%。1回のスピンにつき1回まで。 */
  const FREE_RATE = { lose: 0.06, win: 0.12 };
  let freeSpun = false; // FREE SPIN のあとの回り直し中
  function rollFree(sym) {
    if (window.__fxTest && window.__fxTest.free !== undefined) return !!window.__fxTest.free; // 演出確認用
    return Math.random() < (sym === 0 ? FREE_RATE.lose : FREE_RATE.win);
  }
  const RESPIN_RATE = [0, 0.1, 0.12, 0.15]; // 当たりのとき ONE MORE CHANCE になる割合（ステージ別）

  /* 停止パターンのカタログ（100通り）。止まりかけ回数(1〜3) × 各回の間(短/普通/長) × 行き過ぎて戻る × じわじわ入る の
     組み合わせを、固定の乱数で並べ替えて先頭100個を使う（毎回同じ100通り）。重さは変わらない（数値の組み合わせだけ）。 */
  const PATTERNS = (function () {
    let seed = 20260930;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const all = [];
    [1, 2, 3].forEach((pre) => {
      const combos = [[]];
      for (let i = 0; i < pre; i++) { const next = []; combos.forEach((c) => ['s', 'n', 'l'].forEach((h) => next.push(c.concat(h)))); combos.length = 0; combos.push(...next); }
      combos.forEach((holds) => [0, 1].forEach((over) => [0, 1].forEach((crawl) => { if (!(over && crawl)) all.push({ pre, holds, over: !!over, crawl: !!crawl }); })));
    });
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = all[i]; all[i] = all[j]; all[j] = t; }
    return all.slice(0, 100).map((p, i) => Object.assign({ id: i + 1 }, p));
  })();
  const HOLD_SEC = { s: [0.25, 0.3, 0.35], n: [0.45, 0.6, 0.8], l: [0.7, 1.0, 1.3] }; // ステージ別（1,2,3）

  /* 直近20回に使ったパターンは避けて選ぶ。使ったパターンは端末に記録する */
  function pickCatalog() {
    const used = Store.state.patHist || [];
    const pool = PATTERNS.filter((p) => used.indexOf(p.id) < 0);
    const p = (pool.length ? pool : PATTERNS)[Math.floor(Math.random() * (pool.length ? pool.length : PATTERNS.length))];
    try { Store.transact((s) => { s.patHist = (s.patHist || []).concat(p.id).slice(-20); }); } catch (err) { /* 記録のみ */ }
    return p;
  }
  function pickPattern(st, sym) {
    if (window.__fxTest && window.__fxTest.pat) return window.__fxTest.pat; // 演出確認用（結果には影響しない）
    const isWin = sym !== 0;
    if (Math.random() > (isWin ? DRAMA.win : DRAMA.lose)[st]) return { type: 'plain' };
    if (isWin && Math.random() < RESPIN_RATE[st]) return { type: 'respin' };
    const p = pickCatalog();
    // 止まりかけで見せる「惜しい絵柄」は spinReel 側で、先に止まった2本との合計が別の結果になる絵柄から選ぶ
    return { type: 'seq', pre: p.pre, holds: p.holds.map((h) => HOLD_SEC[h][st - 1]), over: p.over, crawl: p.crawl, id: p.id };
  }

  /* ---------- 確定演出（虹） ----------
     最終結果が 0 以外に確定しているプレイでだけ、ステージが上がった瞬間に突然すべてが虹色になる。
     ハズレのプレイでは絶対に出ない。1プレイで1回まで。発生後は結果が出るまで虹色のまま。
     SURE_RATE はステージアップ1回あたりの発生率（たまに出る程度）。 */
  const SURE_RATE = 0.08;
  /* プチュン: ブラウン管が消えるように突然暗転 → 復帰。
       real … 2,000 以上の当たりが確定しているプレイで 1/2。復帰と同時に虹色モード（当選確定）
       fake … それ以外でたまに（PUCHUN_FAKE）。色は変わらず、そのまま当たりにも 0 にもなる「じらし」 */
  const PUCHUN_MIN = 2000, PUCHUN_REAL = 0.5, PUCHUN_FAKE = 0.06;
  let puchunPlan = null; // このステージのスピンで実行する予定 { kind:'real'|'fake', fx:'crt'|'flash' }
  const pickFx = () => (Math.random() < 0.5 ? 'crt' : 'flash'); // 暗転（プチュン）か白飛び（フラッシュ）か半々
  function planPuchun(play, st) {
    puchunPlan = null;
    if (window.__fxTest && window.__fxTest.puchun) { puchunPlan = { kind: window.__fxTest.puchun, fx: window.__fxTest.fx || pickFx() }; return; }
    const finalStage = st === play.stage;
    if (finalStage && play.value >= PUCHUN_MIN && !sureShown && !play.overflow) { if (Math.random() < PUCHUN_REAL) puchunPlan = { kind: 'real', fx: pickFx() }; return; }
    if (Math.random() < PUCHUN_FAKE) puchunPlan = { kind: 'fake', fx: pickFx() };
  }
  /* 画面が消える（crt）／白く飛ぶ（flash）。during() は真っ暗・真っ白の間に呼ばれる（ステージ切替などに使う） */
  async function blink(fx, holdMs, during) {
    const crt = $('crt');
    // ゆっくり: 消えるのに約1秒、消えたまま holdMs、戻るのに約0.7秒
    if (fx === 'flash') {
      Sfx.play('warp');
      crt.className = 'white-in';
      await wait(600);
      crt.className = 'white';
      Sfx.spin(0);
      if (during) await during();
      await wait(holdMs);
      crt.className = 'white-out';
      await wait(1000);
      crt.className = '';
      return;
    }
    Sfx.play('crtOff');
    crt.className = 'off';
    await wait(950);
    crt.className = 'dark';
    Sfx.spin(0);
    if (during) await during();
    await wait(holdMs);
    Sfx.play('crtOn');
    crt.className = 'on';
    await wait(700);
    crt.className = '';
  }
  async function puchun(plan) {
    await blink(plan.fx, plan.kind === 'real' ? 2200 : 1600);
    if (plan.kind === 'real') announceSure();
  }
  /* ワープ開始: NEXT GAME 直後、結果が STAGE 2 以上のプレイでたまに、いきなり上のステージから始まる */
  const WARP_RATE = 0.18;
  function pickWarp(play, st) {
    if (st !== 1 || play.stage < 2 || play.overflow) return 0;
    if (window.__fxTest && window.__fxTest.warp !== undefined) return window.__fxTest.warp;
    if (Math.random() >= WARP_RATE) return 0;
    return play.stage === 3 && Math.random() < 0.5 ? 3 : Math.min(play.stage, 2); // 3 まで行けるときは半々で 3 に直行
  }
  let pendingSure = false;
  function pickSure(play) {
    if (sureShown || !play || !(play.value > 0) || play.overflow) return false;
    if (window.__fxTest && window.__fxTest.sure !== undefined) return !!window.__fxTest.sure;
    return Math.random() < SURE_RATE;
  }
  function announceSure(main, sub) {
    sureShown = true;
    stageEl.classList.add('sure');
    Sfx.play('kyuin');
    flash(false);
    restart(cabinet, 'shake');
    FX.ring(CX, CY, 'white', 1200, 0.9);
    RAINBOW.forEach((c, i) => setTimeout(() => FX.ring(CX, CY, c, 900 + i * 90, 0.8), 60 + i * 70)); // 虹の輪が次々に広がる
    FX.burst(CX, CY, 360, { max: 1600, life: 2, size: 26, colors: RAINBOW });
    FX.rain(240, 1.6, RAINBOW);
    FX.flakes(160, 1.6, RAINBOW);
    FX.streaks(CX, CY, 160, 1.0, { colors: RAINBOW });
    FX.setAmbient(40, RAINBOW);
    sureText = [main || 'WIN CONFIRMED', sub || '当選確定！'];
    setPlate('spin sure', sureText[0], sureText[1]);
  }
  function clearSure() {
    if (!sureShown) return;
    sureShown = false;
    stageEl.classList.remove('sure');
    FX.setAmbient([0, 0, 14, 30][curStage], STAGE_COL[curStage]);
  }

  /* 1ステージ分の演出。NEXT STAGE なら次のステージへ移り、再びレバー待ちに戻る。 */
  async function runStage(play, st) {
    busy = true;
    lockbar.classList.remove('show');
    const sym = st < play.stage ? 'NEXT' : play.value;
    const afterFree = freeSpun; freeSpun = false;
    const free = !oneMore && !afterFree && rollFree(sym);
    const pat = oneMore || free ? { type: 'plain' } : pickPattern(st, sym); // 回り直しのときは引かない（未使用のパターン id を記録しないため）
    if (!oneMore && !free && pat.type !== 'respin') planPuchun(play, st); else puchunPlan = null;
    const warpTo = oneMore || free || afterFree ? 0 : pickWarp(play, st);
    if (warpTo) { // いきなり上のステージへ（途中のステージは回さない）
      puchunPlan = null;
      setPlate('spin', 'GOOD LUCK', 'STAGE ' + st);
      await wait(350);
      await blink(pickFx(), 1800, async () => { setStage(warpTo); });
      try { Store.transact((s) => { if (s.play) s.play.cur = warpTo; }); } catch (err) { /* 進行位置のみ */ }
      Sfx.play('stageReady');
      showBanner('next', 'WARP', 'STAGE ' + warpTo);
      await wait(5000); // 「いきなり飛んだ」余韻
      await hideBanner();
      return runStage(play, warpTo);
    }
    setPlate(sureShown ? 'spin sure' : 'spin', sureShown ? sureText[0] : 'GOOD LUCK', sureShown ? sureText[1] : 'STAGE ' + st);

    const extra = {};
    if (!window.LITE) FX.cards(10, 0.3, { sweep: true });
    Sfx.play('shuffle');

    if (oneMore) {
      // ワンモアチャンス後の引き直し: 短めの回転で本当の結果へ
      oneMore = false;
      await spinReel(st, sym, { type: Math.random() < 0.5 ? 'slip' : 'plain' }, extra); // 回り直しも通常と同じ速さ・間隔
    } else if (free) {
      // FREE SPIN ×1 が3本そろう → 自動でもう一度回る（結果は確定済み。再抽選はしない）
      await spinReel(st, 'FREE', { type: Math.random() < 0.6 ? 'slip' : 'plain' }, extra);
      win.classList.add('win');
      Sfx.play('revive');
      flash(false);
      FX.ring(CX, CY, 'gold', 1100, 0.8);
      FX.burst(CX, CY, 140, { max: 1200, life: 1.5 });
      showBanner('next omc', '', 'FREE SPIN');
      await wait(1800);
      await hideBanner();
      freeSpun = true;
      win.classList.remove('win', 'lose');
      await wait(300);
      return runStage(play, st);
    } else if (pat.type === 'respin') {
      // ハズレと思いきや当たり: 0 で完全に止まる → 暗転 → ONE MORE CHANCE → もう一度レバーを引かせる
      await spinReel(st, 0, { type: 'plain' }, extra);
      win.classList.add('lose');
      Sfx.play('zero');
      if (!sureShown) setPlate('result zero', '0', '');
      await wait(1500);
      $('blackout').classList.add('on');                 // 暗転
      Sfx.play('heartbeat');
      await wait(900);
      $('blackout').classList.remove('on');
      win.classList.remove('lose');
      Sfx.play('revive');
      flash(false);
      restart(cabinet, 'shake');
      FX.ring(CX, CY, 'gold', 1100, 0.8);
      FX.burst(CX, CY, 200, { max: 1300, life: 1.6 });
      showBanner('next omc', '', 'ONE MORE CHANCE');
      await wait(1500);
      await hideBanner();
      // レバー待ちに戻す（結果は確定済み。引き直しても再抽選はしない）
      // ボタン版: 押し直しは不要。そのまま自動でもう一度回る（結果は確定済み。再抽選はしない）
      oneMore = true;
      win.classList.remove('win', 'lose');
      await wait(300);
      return runStage(play, st);
    } else {
      await spinReel(st, sym, pat, extra);
    }

    if (sym === 'NEXT') {
      // どこまで進んだかを保存（ここで落ちても次のステージのレバー待ちから再開）
      try { Store.transact((s) => { if (s.play) s.play.cur = st + 1; }); } catch (err) { /* 進行位置のみ */ }
      await nextStageFx(st);
      // ボタン版: 次のステージは自動で回り始める
      if (!Store.state.play) { busy = false; return refresh(); }
      Sfx.play('stageReady');
      await wait(500);
      return runStage(Store.state.play, st + 1);
    }
    await resultFx(play);
    clearSure();
    const out = false; // ボタン版: クレジット制なし（PINなしで何回でも回せる）
    try { Store.transact((s) => { if (s.play) { s.play.phase = 'shown'; if (lastCombo) s.play.combo = lastCombo.combo; if (s.play.value > 0) s.recent = (s.recent || []).concat({ ts: Date.now(), value: s.play.value }).slice(-200); } if (out) Store.log('TOTAL', { total: s.wonTotal || 0 }); }); } catch (err) { /* 表示済みフラグのみ。失敗しても整合性に影響なし */ }
    showCredits();
    renderRecent();
    if (out) await totalFx(Store.state.wonTotal || 0);
    busy = false;
    if (Store.state.play) showLocked(Store.state.play, true); else refresh();
  }

  /* 3本リールを回す。結果 sym（金額 / 0 / 'NEXT'）は確定済み。ここで決めるのは見せ方だけ:
       組み合わせ … その結果になる3本の並びから、直近20回と被らないものを選ぶ
       止まる順番 … 6通りからランダム。ただし「最後の1本で結果が変わる」順番を優先（最後まで分からない）。
                    NEXT STAGE が1〜2本入る並びでは、NEXT STAGE のリールを先に止める
       惜しい絵柄 … 最後の1本が止まりかけで見せる絵柄は、先に止まった2本との合計が別の正規の結果になるもの
       停止時刻   … 1本目 → 2本目は一定間隔、3本目はその 1.5 倍。ステージが上がるごとに 1.3 倍。
                    ただし2本目までで負けが決まっているときは、3本目は 0.6 秒後にすぐ止める */
  const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  function spinReel(st, sym, pat, extra) {
    const beats = [];
    extra = extra || {};
    pat = pat || { type: 'plain' };
    const combos = Engine.reelCombos(st, sym);
    const usedC = Store.state.comboHist || [];
    let pool = combos.filter((c) => usedC.indexOf(st + ':' + c.join('/')) < 0);
    if (!pool.length) { // 候補が少なくて20回ぶん避けきれないときは、同じ結果の直近ぶん（候補数の半分まで）だけ避ける
      const keys = combos.map((c) => st + ':' + c.join('/'));
      const recent = usedC.filter((k) => keys.indexOf(k) >= 0).slice(-Math.floor(combos.length / 2));
      pool = combos.filter((c) => recent.indexOf(st + ':' + c.join('/')) < 0);
      if (!pool.length) pool = combos;
    }
    const combo = pool[Math.floor(Math.random() * pool.length)];
    // NEXT STAGE や FREE SPIN が入る並びでは、それを先に止める（最初に 0 が見えてしまわないように）。順番は NEXT STAGE → FREE SPIN → それ以外
    const rank = (s) => (s === 'NEXT' ? 0 : s === 'FREE' ? 1 : 2);
    const cand = ORDERS.filter((o) => rank(combo[o[0]]) <= rank(combo[o[1]]) && rank(combo[o[1]]) <= rank(combo[o[2]]));
    const deciding = cand.filter((o) => Engine.reelAlternatives(st, combo, o[2]).length > 0);
    const ordPool = deciding.length ? deciding : cand;
    const order = ordPool[Math.floor(Math.random() * ordPool.length)];
    const alts = Engine.reelAlternatives(st, combo, order[2]);
    const nb = pat.type === 'seq' ? pat.pre + (pat.over ? 1 : 0) : pat.type === 'slip2' ? 2 : pat.type === 'slip' || pat.type === 'back' ? 1 : 0;
    const bait = [];
    for (let i = 0; i < nb; i++) bait.push(alts.length && Math.random() < 0.85 ? alts[Math.floor(Math.random() * alts.length)] : null);
    // 負け確定の早止め: 2本目が止まった時点でハズレが決まっている（NEXT STAGE / FREE SPIN が2本そろっていない）ときは、3本目をすぐ止める
    const s1 = combo[order[0]], s2 = combo[order[1]];
    const reach = s1 === s2 && (s1 === 'NEXT' || s1 === 'FREE');
    const dead = sym === 0 && !reach && !puchunPlan;
    const p = dead ? { type: 'plain', decel: 1.2 } : Object.assign({}, pat, { bait });
    const k = Math.pow(1.3, st - 1);
    const iv = (pat.quick ? 0.7 : 2.0) * k;
    const first = (pat.quick ? 1.4 : 3.2) * Math.pow(1.12, st - 1); // 1本目が止まるまで（回り出し＋減速ぶんを含む）
    const stops = [first, first + iv, first + iv + (dead ? 0.6 : iv * 1.5)];
    lastCombo = { st, read: sym, combo };
    try { Store.transact((s) => { s.comboHist = (s.comboHist || []).concat(st + ':' + combo.join('/')).slice(-20); }); } catch (err) { /* 記録のみ */ }
    return Reel.spin(st, combo, order, stops, p, {
      onStart: () => { Sfx.play('reelStart'); extra.onStart && extra.onStart(); },
      onTick: (n) => Sfx.tick(n),
      onSpeed: (n) => Sfx.spin(n),
      onNear: () => { extra.onNear && extra.onNear(); },
      onReelStop: (ri, kk) => { if (kk < 2) { Sfx.play('stop'); restart(cabinet, 'thud'); } if (kk === 1 && puchunPlan) { const pl = puchunPlan; puchunPlan = null; puchun(pl); } }, // 1本目・2本目の停止。2本目のあとにプチュン
      onTease: (dur) => {
        Sfx.play('tease', dur);
        stageEl.classList.add('reach'); // 集中線で緊張感を出す
        $('content').querySelector('.spot').style.opacity = 1;
        if (st >= 2) for (let t = 0; t < dur - 0.2; t += st === 3 ? 0.5 : 0.62) beats.push(setTimeout(() => Sfx.play('heartbeat'), t * 1000));
        if (st === 3) $('dim').classList.add('on');
      },
      onStop: () => {
        beats.forEach(clearTimeout);
        stageEl.classList.remove('reach');
        $('dim').classList.remove('on');
        $('content').querySelector('.spot').style.opacity = '';
        Sfx.play('stop');
        restart(cabinet, 'thud');
        bump();
      },
    });
  }

  /* NEXT STAGE 突入: 停止 → 移行パターン → 到着（チャージと爆発は金額当選の演出で使う） */
  const RUNG_Y = { 1: 620, 2: 430, 3: 240 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  async function nextStageFx(st) {
    const to = st + 1;
    // NEXT STAGE で停止 → 一拍 → 移行（ガラスが割れる／金庫扉）→ 到着
    setPlate('spin', 'NEXT STAGE', '');
    win.classList.add('win');
    cabinet.classList.add('party');
    await wait(450);
    pendingSure = pickSure(Store.state.play); // 当選確定のプレイでは、たまに到着の瞬間に虹色になる
    await stageTransition(to);
    win.classList.remove('win');
    cabinet.classList.remove('party');
  }

  const STAGE_NAMES = { 2: 'SAPPHIRE STAGE', 3: 'RUBY FINAL' };
  const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  function mk(cls, html) { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; $('trans').appendChild(d); return d; }

  /* ステージ移行: 金庫扉が閉まり、立体チップ（ステージ名）が叩きつけられ、ドラムロールのあと開く */
  async function stageTransition(to) {
    $('trans').innerHTML = '';
    await transVault(to);
    $('trans').innerHTML = '';
  }

  /* ステージ名の立体チップが、回転しながら奥から飛んできて叩きつけられる（約0.5秒）→ hold ミリ秒見せる */
  async function stampStage(to, hold, rainbow) {
    const label = $('shutterLabel'), fin = to === 3;
    label.classList.toggle('rainbow', !!rainbow); // 虹（当選確定）のときはチップも虹色
    label.querySelector('b').textContent = to;
    label.querySelector('em').textContent = STAGE_NAMES[to] || '';
    label.classList.remove('stamp', 'out'); void label.offsetWidth;
    label.classList.add('show', 'stamp');
    stageEl.classList.add('named');
    stageEl.classList.toggle('fin', fin);
    Sfx.play('warp');
    await wait(500);
    Sfx.play('stamp');
    quake();
    flash(true);
    FX.ring(800, 450, STAGE_ACC[to], 1000, 0.9);
    FX.burst(800, 450, fin ? 260 : 180, { max: 1300, life: 1.4, colors: STAGE_COL[to] });
    FX.streaks(800, 450, 100, 0.4, { colors: STAGE_COL[to] });
    await wait(hold);
  }
  async function hideStamp() { // チップはカメラ手前へ飛び去る
    const label = $('shutterLabel');
    label.classList.add('out');
    await wait(220);
    label.classList.remove('show', 'stamp', 'out', 'rainbow');
    stageEl.classList.remove('named');
  }

  /* 新しいステージに到着: 奥から飛び込むカメラ（指数減速）と同時に全体が弾ける */
  async function arrive(to, title) {
    const fin = to === 3, colors = STAGE_COL[to], ACC = STAGE_ACC[to];
    if (curStage !== to) setStage(to); else FX.setAmbient([0, 0, 14, 30][to], colors);
    if (pendingSure) { pendingSure = false; announceSure(); }
    Sfx.play('open', fin);
    // 重い処理が同じ瞬間に重ならないよう、少しずつずらして出す
    FX.ring(CX, CY, 'white', 1300, 1.0);
    FX.burst(CX, CY, fin ? 160 : 120, { max: 1700, life: 1.6, size: 26, colors });
    setTimeout(() => { FX.ring(CX, CY, ACC, 1500, 1.2); if (!window.LITE) FX.streaks(CX, CY, fin ? 70 : 50, 0.7, { colors }); }, 120);
    if (!window.LITE) { // 軽量モードでは噴水・紙吹雪を省略
      setTimeout(() => [300, 1300].forEach((x) => FX.fountain(x, 930, fin ? 40 : 30, 0.6, colors)), 240);
      setTimeout(() => FX.flakes(fin ? 60 : 40, 0.8, colors), 360);
    }
    const y1 = RUNG_Y[to];
    setTimeout(() => { FX.ring(180, y1, ACC, 260, 0.6); FX.burst(180, y1, 50, { max: 600, colors }); }, 480);
    if (title) { await wait(420); await stampStage(to, 380); await hideStamp(); await wait(80); }
    else await wait(750);
    stageEl.classList.remove('fin');
  }

  /* 金庫扉。枚数: 通常 1 枚 / STAGE 3 へは 3 枚 / 虹（当選確定）のときは 8 枚。
     上下に閉まる扉と左右に閉まる扉を交互に重ね、1枚ずつ「ドン」と閉めて、逆順に1枚ずつ開ける。 */
  const DOOR_RGB = {
    rainbow: ['255,59,48', '255,149,0', '255,230,0', '52,227,106', '50,212,255', '58,107,255', '193,92,255', '255,255,255'],
    fin: ['255,215,120', '255,255,255', '255,95,75'],
  };
  function buildDoors(n, colors) {
    const box = $('doors');
    box.innerHTML = '';
    const layers = [];
    for (let i = 0; i < n; i++) {
      const horiz = (n - 1 - i) % 2 === 0; // いちばん手前の扉は必ず上下（継ぎ目の光と合わせる）
      const pair = (horiz ? ['t', 'b'] : ['l', 'r']).map((side) => {
        const d = document.createElement('div');
        d.className = 'door ' + side;
        if (colors) d.style.setProperty('--dc', colors[i % colors.length]);
        box.appendChild(d);
        return d;
      });
      layers.push({ pair, horiz });
    }
    return layers;
  }
  function seamSparks(horiz, colors) {
    if (horiz) for (let x = 100; x <= 1500; x += 200) FX.burst(x, 450, 8, { max: 460, life: 0.7, size: 14, colors });
    else for (let y = 60; y <= 840; y += 195) FX.burst(800, y, 8, { max: 460, life: 0.7, size: 14, colors });
  }
  async function transVault(to) {
    const fin = to === 3, rb = pendingSure;
    const colors = rb ? RAINBOW : STAGE_COL[to];
    const n = window.LITE ? 1 : rb ? 8 : fin ? 3 : 1; // 軽量モードは常に1組
    const gap = n === 8 ? 170 : 300;
    const layers = buildDoors(n, rb ? DOOR_RGB.rainbow : fin ? DOOR_RGB.fin : null);
    stageEl.classList.remove('opening', 'opening-slow', 'blast');
    stageEl.classList.toggle('fin', fin);
    await frame();

    fxMode(true);
    const content = $('content');
    // 閉門: 1枚ずつ叩きつける。下に隠れた扉は描画から外す（同時に描くのは最大2組）
    for (let i = 0; i < n; i++) {
      layers[i].pair.forEach((d) => d.classList.add('in'));
      if (i === 0) { Sfx.play('shutterClose'); await wait(440); } else { await wait(gap - 40); Sfx.play('slam', i / (n - 1)); await wait(40); }
      if (i >= 2) layers[i - 2].pair.forEach((d) => { d.style.display = 'none'; });
      quake();
      flash(true);
      seamSparks(layers[i].horiz, rb ? [RAINBOW[i % RAINBOW.length], 'white'] : colors);
    }
    // 扉の裏を非表示にしてから色を切り替え、描き直しが落ち着くのを待つ
    content.style.visibility = 'hidden';
    setStage(to);
    await raf2();
    stageEl.classList.add('ceremony');
    await raf2();
    await stampStage(to, 300, rb);

    // 溜め（約2秒）: ドラムロール。継ぎ目の光が速く脈打ち、光が扉へ吸い込まれていく
    const roll = 1.9;
    Sfx.play('roll', roll);
    stageEl.classList.add('rolling');
    FX.converge(800, 450, fin ? 60 : 40, roll);
    const tm = [];
    for (let t = 0.25; t < roll; t += 0.5) tm.push(setTimeout(() => FX.burst(200 + Math.random() * 1200, 450, 14, { max: 500, life: 0.8, size: 12, colors }), t * 1000));
    if (fin) [0.7, 1.4].forEach((t) => tm.push(setTimeout(() => { flash(true); Sfx.play('thunder'); FX.lightning(rnd(100, 1500), -100, rnd(300, 1300), 450, STAGE_ACC[to], 6); }, t * 1000)));
    await wait(roll * 1000);
    tm.forEach(clearTimeout);
    stageEl.classList.remove('rolling');

    // 開門: 裏の画面を表示に戻してから、手前の扉から1枚ずつ開く
    await hideStamp();
    content.style.visibility = '';
    await raf2();
    stageEl.classList.add('blast');
    stageEl.classList.remove('ceremony');
    for (let i = n - 1; i >= 1; i--) {
      if (i >= 2) layers[i - 2].pair.forEach((d) => { d.style.display = ''; }); // 次に見える扉を戻す
      layers[i].pair.forEach((d) => { d.classList.add('opening'); d.classList.remove('in'); });
      Sfx.play('slam', (n - 1 - i) / (n - 1));
      flash(true);
      quake();
      seamSparks(layers[i].horiz, rb ? [RAINBOW[i % RAINBOW.length], 'white'] : colors);
      await wait(gap);
    }
    layers[0].pair.forEach((d) => { d.style.display = ''; d.classList.add('opening'); d.classList.remove('in'); });
    flash(false);
    quake();
    fxMode(false);
    await arrive(to, false);
    setTimeout(() => { stageEl.classList.remove('blast'); $('doors').innerHTML = ''; }, 700);
  }

  /* 次のプレイへ戻るときの短いシャッター */
  async function transition(to) {
    const label = $('shutterLabel');
    label.querySelector('b').textContent = to;
    label.querySelector('em').textContent = '';
    label.classList.remove('show', 'stamp', 'out');
    stageEl.classList.remove('opening');
    stageEl.classList.add('shut');
    Sfx.play('shutterClose');
    await wait(440);
    flash(true);
    label.classList.add('show', 'stamp');
    FX.clear();
    setStage(to);
    await wait(900);
    Sfx.play('shutterOpen');
    stageEl.classList.add('opening');
    stageEl.classList.remove('shut');
    label.classList.remove('show', 'stamp');
    await wait(720);
    stageEl.classList.remove('opening');
  }

  function showBanner(kind, label, value, amount) {
    const isWin = kind.indexOf('win') >= 0;
    banner.className = 'banner ' + kind + (isWin ? ' cv' : '');
    $('bannerLabel').textContent = label;
    if (isWin) { bannerAmount = amount === undefined ? 1000 : amount; Reel.drawText($('bannerCv'), value, bannerAmount); $('bannerValue').textContent = ''; }
    else $('bannerValue').innerHTML = value.split('').map((ch, i) => '<span style="--i:' + i + '">' + (ch === ' ' ? '&nbsp;' : ch) + '</span>').join('');
    $('bannerCv').classList.remove('slam');
    void banner.offsetWidth;
    banner.classList.add('show');
    win.classList.add('veil'); // リール上の同じ文字と重ならないよう一時的に沈める
  }
  let bannerAmount = 1000;
  function setBannerText(text) { Reel.drawText($('bannerCv'), text, bannerAmount); }
  async function hideBanner() {
    $('bannerCv').classList.remove('slam');
    banner.classList.add('out');
    win.classList.remove('veil');
    await wait(360);
    banner.className = 'banner';
  }

  /* 当選演出。金額ごとに1段ずつ強くなる（WIN_LEVELS の並び順がそのまま演出レベル 1〜8）。 */
  const WIN_LEVELS = [500, 1000, 2000, 3000, 5000, 10000, 50000, 100000];
  const CHIP_LV = [['red'], ['blue', 'red'], ['green', 'red', 'blue'], ['black', 'green', 'blue'], ['purple', 'black', 'red'], ['gold', 'black', 'purple'], ['gold', 'black', 'white', 'purple'], ['gold', 'gold', 'black', 'white']];
  const WIN_FX = [
    //  秒数  ラベル        粒子  金粉  花火間隔(秒)  揺れ回数  カウントアップ(秒)
    { dur: 1.8, label: 'WIN',       burst: 70,  rain: 0,   fire: 0,    shake: 0, count: 0 },
    { dur: 2.0, label: 'WIN',       burst: 110, rain: 0,   fire: 0,    shake: 0, count: 0 },
    { dur: 2.2, label: 'NICE WIN',  burst: 150, rain: 70,  fire: 0,    shake: 0, count: 0.5 },
    { dur: 2.5, label: 'BIG WIN',   burst: 190, rain: 130, fire: 0.7,  shake: 0, count: 0.6 },
    { dur: 2.8, label: 'BIG WIN',   burst: 230, rain: 200, fire: 0.5,  shake: 1, count: 0.7 },
    { dur: 3.0, label: 'SUPER WIN', burst: 280, rain: 320, fire: 0.38, shake: 1, count: 0.9 },
    { dur: 3.2, label: 'MEGA WIN',  burst: 340, rain: 480, fire: 0.3,  shake: 2, count: 1.1 },
    { dur: 3.3, label: 'JACKPOT',   burst: 420, rain: 640, fire: 0.22, shake: 3, count: 1.3 },
  ];

  async function resultFx(res) {
    const v = res.value;
    if (v === 0) {
      await wait(250);
      win.classList.add('lose');
      Sfx.play('zero');
      setPlate('result zero', '0', '');
      await wait(1700);
      return;
    }
    const L = Math.max(1, WIN_LEVELS.filter((x) => x <= v).length);
    const fx = WIN_FX[L - 1];
    const timers = [];
    const later = (sec, fn) => timers.push(setTimeout(fn, sec * 1000));
    const content = $('content');
    await wait(200); // 一拍置いてから
    const colors = sureShown ? RAINBOW.concat(['white']) : ['gold', 'white'].concat(STAGE_COL[curStage]); // 金＋そのステージの色（確定中は虹）

    // チャージ: 周囲が暗くなり、カメラがリールへ寄っていく（指数的に加速）。光が中心へ吸い込まれる
    win.classList.add('win');
    cabinet.classList.add('party', 'tremble');
    $('dim').classList.add('on');
    fxMode(true);
    Sfx.play('riser', 1.0);
    Sfx.play('warp');
    FX.converge(CX, CY, 140 + L * 20, 1.0);
    FX.streaks(CX, CY, 80 + L * 10, 0.9, { inward: true, colors });
    [0.5, 0.75, 0.9].slice(0, L >= 6 ? 3 : L >= 3 ? 2 : 1).forEach((t) => later(t, () => { const an = Math.random() * 6.28; FX.lightning(CX + Math.cos(an) * 760, CY + Math.sin(an) * 460, CX, CY, 'white', 4); Sfx.play('zap'); }));
    await wait(1000);

    // 爆発: カメラが一瞬で引いて戻り、放射状の稲妻が走る
    cabinet.classList.remove('tremble');
    if (L < 6) $('dim').classList.remove('on');
    quake();
    for (let i = 0; i < 4 + L; i++) { const an = (i / (4 + L)) * 6.28 + Math.random() * 0.4; FX.lightning(CX, CY, CX + Math.cos(an) * 900, CY + Math.sin(an) * 560, i % 2 ? STAGE_ACC[curStage] : 'white', 5); }
    FX.streaks(CX, CY, 100 + L * 12, 0.8, { colors });
    stageEl.dataset.win = L;
    setPlate('spin', fx.label, '');
    showBanner('win lv' + L, fx.label, fx.count ? '0' : fmtN(v), v);
    Sfx.play('win', L);

    // 開幕の一撃
    flash(L < 5);
    FX.burst(CX, CY, fx.burst, { max: 700 + L * 110, life: 1.3 + L * 0.1, size: 20 + L, colors });
    if (L >= 2) FX.ring(CX, CY, L >= 6 ? 'white' : STAGE_ACC[curStage], 800 + L * 50, 0.75);
    if (L >= 4) later(0.16, () => FX.ring(CX, CY, 'gold', 1000 + L * 40, 0.95));
    if (fx.shake) restart(cabinet, 'shake');
    bump();
    if (L >= 3) bulletTime(0.12, 0.45); // 弾けた瞬間に一瞬止まり、指数的に加速
    if (L >= 6) $('dim').classList.add('on');

    // 金額カウントアップ → 確定の一撃
    if (fx.count) {
      const t0 = performance.now(), el = $('bannerValue');
      let lastTick = 0;
      const step = (now) => {
        const u = Math.min(1, (now - t0) / (fx.count * 1000));
        const e = 1 - Math.pow(1 - u, 3);
        if (now - lastTick > 70 && u < 1) { lastTick = now; setBannerText(fmtN(Math.round((v * e) / 100) * 100)); Sfx.play('count', u); }
        if (u < 1 && stageEl.dataset.win) return requestAnimationFrame(step);
        setBannerText(fmtN(v));
      };
      requestAnimationFrame(step);
      later(fx.count, () => {
        restart($('bannerCv'), 'slam');
        Sfx.play('stop');
        FX.burst(CX, CY, 60 + L * 20, { max: 900, colors });
        if (L >= 5) flash(true);
      });
    }

    // 金粉と花火（レベルが上がるほど多く・速く・長く）
    if (fx.rain) FX.rain(fx.rain, fx.dur - 1.2, colors);
    // カジノチップ: 低額は雨、中額から画面下に積み上がり、高額は噴水も加わる。色は金額で変わる
    const chipCols = CHIP_LV[L - 1];
    Sfx.play('chipfall', fx.dur - 1.5);
    if (L <= 2) FX.chips(20 + L * 20, fx.dur - 1.4, chipCols);
    else FX.chips(30 + L * 14, fx.dur - 1.6, chipCols, { land: true, size: 22 });
    if (L >= 6) {
      [0.5, fx.dur * 0.4, fx.dur * 0.68, fx.dur * 0.82].slice(0, L - 4).forEach((t) => later(t, () => {
        FX.chipFountain(240, 930, 22, 0.8, chipCols, { land: true, vx: 220 });
        FX.chipFountain(1360, 930, 22, 0.8, chipCols, { land: true, vx: -220 });
        Sfx.play('chipfall', 1.2);
      }));
    }
    if (L >= 3) FX.cards(6 + L * 2, 0.5, { x: CX, y: CY });
    if (L >= 5) FX.flakes(L * 8, fx.dur - 1.5, colors);
    if (fx.fire) {
      for (let t = 0.6; t < fx.dur - 0.9; t += fx.fire) {
        later(t, () => {
          const x = 220 + Math.random() * 1160, y = 120 + Math.random() * 560;
          FX.burst(x, y, 50 + L * 8, { max: 500 + L * 40, colors });
          FX.ring(x, y, Math.random() < 0.4 ? STAGE_ACC[curStage] : 'gold', 220 + L * 15, 0.5);
        });
      }
    }
    // 追撃の衝撃波（SUPER WIN 以上）
    for (let i = 1; i < fx.shake; i++) {
      later((fx.dur / fx.shake) * i, () => {
        flash(false);
        restart(cabinet, 'shake');
        FX.ring(CX, CY, 'white', 1300, 0.9);
        FX.burst(CX, CY, 260, { max: 1500, life: 2, size: 28, colors });
      });
    }

    // 連続フラッシュ・途中の暗転 → 再点火・締めの一撃
    if (L >= 4) for (let t = 1.0; t < fx.dur - 1.2; t += L >= 6 ? 0.5 : 0.8) later(t, () => flash(true));
    if (L >= 5) later(fx.dur * 0.5, () => { // 中盤の追撃
      flash(false); quake(); bump(); Sfx.play('impact'); FX.ring(CX, CY, 'white', 1400, 1.0); FX.burst(CX, CY, 300, { max: 1700, life: 2, size: 26, colors }); strobe(3); bulletTime(0.1, 0.35);
    });
    if (L >= 3) later(fx.dur - 1.0, () => {
      restart($('bannerCv'), 'slam'); Sfx.play('stamp'); flash(false); quake();
      FX.ring(CX, CY, 'gold', 1300, 1.0); FX.burst(CX, CY, 200 + L * 30, { max: 1600, life: 1.6, colors });
    });
    await wait(fx.dur * 1000);
    timers.forEach(clearTimeout);
    fxMode(false);
    delete stageEl.dataset.win;
    $('dim').classList.remove('on');
    FX.releasePile(); // 積み上がったチップを弾き飛ばして片付ける
    await hideBanner();
    cabinet.classList.remove('party');
    setPlate('result lv' + L, fmtN(v), ''); // 金額に応じた色
  }

  /* 光条とサーチライトは、起動時に小さな画像を1枚ずつ作って回すだけにする
     （CSS のマスクや切り抜きは、iPad では毎コマ別処理になって重い） */
  function buildLightSprites() {
    const put = (canvas, name) => canvas.toBlob((blob) => { if (blob) stageEl.style.setProperty(name, 'url(' + URL.createObjectURL(blob) + ')'); });
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    let x = c.getContext('2d');
    const g1 = x.createRadialGradient(256, 256, 18, 256, 256, 256);
    g1.addColorStop(0, 'rgba(255,245,225,0)'); g1.addColorStop(0.12, 'rgba(255,245,225,.55)'); g1.addColorStop(0.55, 'rgba(255,245,225,.18)'); g1.addColorStop(1, 'rgba(255,245,225,0)');
    x.fillStyle = g1;
    for (let i = 0; i < 24; i++) { // 24本の光条
      const a0 = (i * 15 * Math.PI) / 180, a1 = ((i * 15 + 5) * Math.PI) / 180;
      x.beginPath(); x.moveTo(256, 256); x.arc(256, 256, 256, a0, a1); x.closePath(); x.fill();
    }
    put(c, '--rays-img');
    const b = document.createElement('canvas');
    b.width = 128; b.height = 512;
    x = b.getContext('2d');
    const g2 = x.createLinearGradient(0, 512, 0, 0);
    g2.addColorStop(0, 'rgba(255,245,225,.55)'); g2.addColorStop(0.45, 'rgba(255,245,225,.12)'); g2.addColorStop(0.9, 'rgba(255,245,225,0)');
    x.fillStyle = g2;
    x.beginPath(); x.moveTo(58, 512); x.lineTo(70, 512); x.lineTo(128, 0); x.lineTo(0, 0); x.closePath(); x.fill();
    put(b, '--beam-img');
  }

  /* ---------- 診断: コマ時間の表示と、負荷の切り分け用スイッチ（設定画面の「その他」） ---------- */
  function applyPerf() {
    const p = Store.state.settings.perf || {};
    if (!(window.TV && TV.isTV) && !!p.lite !== !!window.LITE) { location.reload(); return; }
    stageEl.classList.toggle('no-bg', !!p.noBg);
    FX.setEnabled(!p.noFx);
    const m = $('meter');
    m.style.display = p.meter ? 'block' : 'none';
    if (p.meter && !applyPerf.on) {
      applyPerf.on = true;
      let last = performance.now(), buf = [];
      const tick = (now) => {
        buf.push([now, now - last]); last = now;
        while (buf.length && now - buf[0][0] > 5000) buf.shift();
        if (buf.length % 20 === 0) {
          const d = buf.map((e) => e[1]).sort((a, c2) => a - c2);
          m.textContent = 'max ' + Math.round(d[d.length - 1]) + 'ms / >33ms ' + d.filter((v) => v > 33).length + ' / >50ms ' + d.filter((v) => v > 50).length + ' (5s)';
        }
        if (applyPerf.on) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else if (!p.meter) applyPerf.on = false;
  }

  /* ---------- 「？」ボタン: 遊び方の簡単な説明（確率や残り本数は載せない） ---------- */
  function initHelp() {
    const fmtList = (d) => d.values.map((v) => '<span class="hv' + (v === 0 ? ' z' : '') + '">' + fmtN(v) + '</span>').join('') + (d.hasNext ? '<span class="hv n">NEXT STAGE</span>' : '');
    $('helpBtn').addEventListener('click', () => {
      if (busy) return;
      Sfx.play('button');
      UI.confirm({
        title: '遊び方', ok: '閉じる', cancel: false,
        html:
          '<div class="help">' +
          '<h5>リールの見方</h5><ul>' +
          '<li>リールは3本。止まった<b>3本の金額を足した合計</b>が当選額です（例: 100 + 400 + 0 = 500）。</li>' +
          '<li>3本とも <b>0</b> ならハズレです。</li>' +
          '<li><b>NEXT STAGE が3本そろう</b>と次のステージへ。1〜2本だけのときは 0 として合計します。</li>' +
          '<li><b>FREE SPIN ×1 が3本そろう</b>と、自動でもう1回まわります。1〜2本だけのときは 0 として合計します。</li>' +
          '<li>止まる順番は毎回変わります。3本目は少し長く回ります（2本目までで結果が決まったときは、すぐ止まります）。</li></ul>' +
          '<h5>ゲームの流れ</h5><ol>' +
          '<li><b>NEXT GAME</b> を押すだけ。あとは自動で進みます。</li>' +
          '<li>STAGE 1 → STAGE 2 → STAGE 3 の順に上がり、上のステージほど大きな金額が出ます。STAGE 3 が最後です。</li>' +
          '<li>結果が出たら左下の <b>LAST</b> と右の<b>配当履歴</b>に記録され、右上の合計にも足されます。</li>' +
          '<li>もう一度 <b>NEXT GAME</b> で次のゲームへ。</li></ol>' +
          '<h5>当たる金額</h5><p>金額はランダムです。' + Engine.STAGE_DEFS.map((d) => 'STAGE ' + d.stage + ' は最大 <b>' + fmtN(Math.max.apply(null, d.values)) + '</b>').join('、') + '。</p>' +
          '<h5>演出について</h5><ul>' +
          '<li>止まりかけてから、もう1コマ滑ったり戻ったりすることがあります。最後の1本が止まるまで結果は分かりません。</li>' +
          '<li><b>ONE MORE CHANCE</b> が出たら、自動でもう一度回ります。</li>' +
          '<li>画面が突然消えたり白く光ったりすることがあります。戻ったときに<b>画面全体が虹色</b>なら当選が確定しています（そのまま戻ることもあります）。</li>' +
          '<li>ゲームの最初にいきなり <b>STAGE 2 / STAGE 3</b> から始まることがあります（<b>WARP</b>）。</li></ul>' +
          '<h5>設定（お店の方へ）</h5><ul>' +
          '<li>左上の casa ロゴを続けて5回タップ → パスワードで設定画面が開きます。</li>' +
          '<li>お客さまの画面に確率は表示されません。</li></ul>' +
          '<h5>テレビ（リモコン）の操作</h5><ul><li>決定ボタン = NEXT GAME。十字キーで左上のロゴに枠を合わせて決定を5回で設定（メニューボタン3回、戻る長押しでも可）。</li></ul>' +
          '</div>',
      });
    });
  }

  /* ---------- 設定画面への隠し入口（左上エンブレム長押し） ---------- */
  /* ---------- 店舗モード（クラウド同期） ----------
     初回は店舗を選んでその店舗のパスワードを入れる。以後はマスターが配ったプリセットだけを使う。 */
  let cloudDown = false; // クラウドに接続できず、端末内の設定で動いている
  const storeMode = () => Cloud.enabled && !cloudDown && !!Store.state.store;
  let cloudPresets = {};   // 配布されたプリセット { id: { name, probs, limits } }
  let cloudStore = null;   // 店舗ドキュメントの最新
  let unwatch = null, presetWatch = {};
  async function chooseStore() {
    for (;;) {
      let stores = [];
      try { stores = await Cloud.listStores(); } catch (err) { stores = null; }
      if (!stores || !stores.length) {
        const retry = await UI.confirm({ title: stores ? '店舗が登録されていません' : 'クラウドに接続できません', ok: '再試行', cancelLabel: 'このまま1台で使う',
          html: '<p>' + (stores ? 'マスター画面で店舗を登録してから、もう一度お試しください。' : 'インターネット接続と、Firebase の設定（Authentication・Firestore）を確認してください。') + '</p><p style="color:#8e8672;font-size:15px">「このまま1台で使う」を選ぶと、端末内の設定で今までどおり動きます（次回起動時にまた店舗を選べます）。</p>' });
        if (!retry) { cloudDown = true; return; }
        continue;
      }
      const id = await new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'scrim solid';
        wrap.innerHTML = '<div class="card dialog"><h2>店舗を選んでください</h2><div class="body"><div class="store-list">' +
          stores.map((s) => '<button class="btn store-btn" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>').join('') + '</div></div></div>';
        wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (!b) return; Sfx.play('button'); wrap.remove(); resolve(b.dataset.id); });
        $('ui').appendChild(wrap);
      });
      const st = stores.find((s) => s.id === id);
      let doc = null;
      try { doc = await Cloud.getStore(id); } catch (err) { /* 下で扱う */ }
      if (!doc || !doc.pin) { UI.toast('店舗の情報を取得できませんでした。', 'err'); continue; }
      const pin = await UI.askPin({ title: st.name, sub: '店舗のパスワード', solid: true, check: (p) => (Engine.checkPin(p, doc.pin) ? null : 'パスワードが正しくありません。') });
      if (pin === null) continue;
      Store.transact((s) => {
        s.store = { id, name: st.name, boundAt: Date.now() };
        s.pins = { admin: doc.pin };
        Store.log('STORE_LOGIN', { storeId: id, name: st.name });
      });
      Sfx.play('ok');
      return;
    }
  }
  function unbindStore(msg, kind) {
    if (unwatch) { unwatch(); unwatch = null; }
    try { Store.transact((s) => { s.store = null; s.pins = null; Store.log('STORE_LOGOUT', {}); }); } catch (err) { /* 保存のみ */ }
    UI.toast(msg || 'マスターからログアウトされました。', kind || 'err');
    setTimeout(() => location.reload(), 1500);
  }
  /* 店舗の設定画面から自分でログアウト（店舗のパスワードで設定を開いた人だけが押せる）。再読み込み後は店舗選択に戻る */
  const logoutStore = () => unbindStore('ログアウトしました。店舗を選び直します。', 'ok');
  /* 配布されたプリセットを端末の確率・制限に反映（結果には「次のプレイから」効く） */
  function applyPreset(p) {
    if (!p || !p.probs || !Engine.validateProbs(p.probs).ok) return;
    const same = JSON.stringify(Store.state.probs) === JSON.stringify(p.probs) && JSON.stringify(Store.state.limits) === JSON.stringify(Object.assign({ on: false, total: 0, max: {}, resetHour: 19 }, p.limits || {}));
    if (same && Store.state.presetId === p.id) return;
    try {
      Store.transact((s) => {
        s.probs = JSON.parse(JSON.stringify(p.probs));
        s.limits = Object.assign({ on: false, total: 0, max: {}, resetHour: 19 }, p.limits || {});
        s.presetId = p.id;
        Store.log('PRESET_APPLY', { id: p.id, name: p.name });
      });
    } catch (err) { /* 保存のみ */ }
    if (Admin.isOpen()) Admin.rerender();
  }
  function startCloudSync() {
    const me = Store.state.store;
    if (!me) return;
    const beat = () => Cloud.updateStoreFields(me.id, { lastSeen: Date.now(), deviceVersion: ($('ver') && $('ver').textContent) || '' }).catch(() => {});
    beat(); setInterval(beat, 10 * 60 * 1000);
    unwatch = Cloud.watchStore(me.id, (doc) => {
      if (!doc) return unbindStore('この店舗はマスターで削除されました。');
      if (doc.logoutAt && doc.logoutAt > me.boundAt) return unbindStore();
      cloudStore = doc;
      if (doc.pin && JSON.stringify(doc.pin) !== JSON.stringify(Store.state.pins && Store.state.pins.admin)) {
        try { Store.transact((s) => { s.pins = { admin: doc.pin }; }); } catch (err) { /* 保存のみ */ }
      }
      const ids = (doc.presetIds || []).slice();
      if (doc.activePresetId && ids.indexOf(doc.activePresetId) < 0) ids.push(doc.activePresetId);
      ids.forEach((pid) => {
        if (presetWatch[pid]) return;
        presetWatch[pid] = true;
        Cloud.watchPreset(pid, (p) => {
          if (!p) { delete cloudPresets[pid]; return; }
          cloudPresets[pid] = p;
          if (cloudStore && cloudStore.activePresetId === pid) applyPreset(p);
          if (Admin.isOpen()) Admin.rerender();
        });
      });
      if (doc.activePresetId && cloudPresets[doc.activePresetId]) applyPreset(cloudPresets[doc.activePresetId]);
      if (Admin.isOpen()) Admin.rerender();
    });
  }
  /* 設定画面から: 店舗がプリセット名を選ぶ */
  async function choosePreset(pid) {
    const me = Store.state.store;
    if (!me || !cloudPresets[pid]) return false;
    applyPreset(cloudPresets[pid]);
    try { await Cloud.updateStoreFields(me.id, { activePresetId: pid }); } catch (err) { UI.toast('クラウドへの保存に失敗しました（端末には反映済み）。', 'err'); }
    return true;
  }
  const storeInfo = () => ({ store: Store.state.store, presets: (cloudStore && cloudStore.presetIds || []).map((id) => cloudPresets[id]).filter(Boolean), activeId: Store.state.presetId || (cloudStore && cloudStore.activePresetId) || null });

  function initSecret() {
    // casa ロゴ（左上のエンブレム／中央上の casa SLOT）を続けて3回タップ → PIN → 設定画面
    let n = 0, last = 0, opening = false;
    openSettings = async () => {
      if (busy || opening || !Store.state.pins || Admin.isOpen()) return;
      opening = true;
      Sfx.play('button');
      const role = await UI.auth(storeMode() ? '設定を開く' : 'PINを入力', ['admin'], '設定画面', storeMode() ? '店舗のパスワード' : '管理者PIN');
      opening = false;
      if (!role || busy) return;
      try { Store.transact(() => Store.log('ADMIN_LOGIN', {}, role)); } catch (err) { /* ログのみ */ }
      Admin.open(role);
    };
    const tap = (e) => {
      e.preventDefault();
      const now = performance.now();
      n = now - last < 900 ? n + 1 : 1;
      last = now;
      if (n < 5) return;
      n = 0;
      openSettings();
    };
    $('crest').addEventListener('pointerdown', tap);
    document.querySelector('.marquee .brand').addEventListener('pointerdown', tap);
  }

  async function firstRun() {
    await UI.confirm({
      title: '初期設定', ok: '登録を始める', cancel: false,
      html: '<p>ご利用の前に、管理者PIN（4〜8桁の数字）を登録してください。</p>' +
        '<p>PINが必要なのは設定画面を開くときだけです。ゲームはPINなしで遊べます。</p>' +
        '<p style="color:#8e8672;font-size:16px">登録後、設定画面は casa のロゴを続けて5回タップして開きます。</p>',
    });
    const admin = await UI.askNewPin('管理者PINの登録', { solid: true, cancelable: false });
    Store.transact((s) => {
      s.pins = { admin: Engine.makePin(admin) };
      Store.log('PIN_SETUP', {});
    });
    UI.toast('PINを登録しました。casa のロゴを5回タップすると確率を設定できます。', 'ok');
  }

  function guardGestures() {
    const scrollable = (t) => t.closest && t.closest('.adm-body, .dialog .body');
    document.addEventListener('touchmove', (e) => { if (!scrollable(e.target)) e.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick', 'selectstart'].forEach((ev) =>
      document.addEventListener(ev, (e) => { if (!(e.target.tagName === 'INPUT')) e.preventDefault(); }));
    // 画面スリープ防止（対応端末のみ）
    const lock = () => { if (navigator.wakeLock && !document.hidden) navigator.wakeLock.request('screen').catch(() => {}); };
    document.addEventListener('visibilitychange', lock);
    window.addEventListener('pointerdown', lock, { once: true });
  }

  async function init() {
    stageEl = $('stage'); cabinet = $('cabinet'); win = $('window'); plate = $('plate'); lockbar = $('lockbar'); banner = $('banner');
    layout();
    window.addEventListener('resize', layout);
    setInterval(() => { idleWatch().catch(() => {}); }, 1000);
    if (window.ResizeObserver) new ResizeObserver(layout).observe($('viewport'));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 300));
    guardGestures();
    try { Store.init(); layout(); } // 保存してある表示範囲（画面サイズ調整）を反映
    catch (err) {
      document.body.innerHTML = '<p style="color:#ff9d8c;padding:40px;font-size:20px">保存領域を利用できないため起動できません。プライベートブラウズを解除するか、ブラウザの設定を確認してください。<br>' + esc(err.message) + '</p>';
      return;
    }
    { const v = $('ver'); if (v) v.textContent += Cloud.enabled ? (Cloud.isLocal ? ' · 店舗モード(模擬)' : ' · 店舗モード') : ' · 1台運用'; } // 起動画面でモードが分かるように
    if (window.TV && TV.isTV) { const m = /Chrome\/(\d+)/.exec(navigator.userAgent); const v = $('ver'); if (v && m) v.textContent += ' · TV/Chrome ' + m[1]; }
    // 軽量モード: テレビ版は常にON。iPad でも設定→その他でONにできる（各モジュールは window.LITE を見る）
    window.LITE = !!((window.TV && TV.isTV) || (Store.state.settings.perf && Store.state.settings.perf.lite));
    document.body.classList.toggle('lite', window.LITE);
    if (window.TV && TV.isTV && !Store.state.settings.perf) { try { Store.transact((s) => { s.settings.perf = { noBg: true }; }); } catch (e) { /* 設定のみ */ } }
    Sfx.init(Store.state.settings.volume);
    buildBulbs();
    FX.init($('fx'));
    Reel.init($('reel'));
    $('shutterLabel').innerHTML = '<div class="medal"><div class="face front"><small>STAGE</small><b>2</b><em></em></div></div>'; // 平面1枚（立体の層は重いので廃止）
    lockbar.addEventListener('click', onLockbar);
    initSecret();
    initHelp();
    // 画面下: 各ステージで当たる金額の一覧
    // 最下段: ステージごとの最大金額だけを見せる（内訳は見せない）
    $('paytable').innerHTML = Engine.STAGE_DEFS.map((d) => { const mx = Math.max.apply(null, d.values); return '<div class="ps" data-s="' + d.stage + '"><em>STAGE ' + d.stage + '</em><span><i>MAX</i><b class="amt lv' + Math.max(1, WIN_LEVELS.filter((x) => x <= mx).length) + '">' + fmtN(mx) + '</b></span></div>'; }).join('');
    buildLightSprites();
    applyPerf();
    setStage(1);
    refresh();
    await new Promise((resolve) => {
      const sp = $('splash');
      sp.addEventListener('click', () => {
        Sfx.unlock();
        Sfx.play('ok');
        sp.classList.add('bye');
        setTimeout(() => sp.remove(), 600);
        resolve();
      }, { once: true });
    });
    if (Cloud.enabled) {
      try { await Cloud.ready(); } catch (err) { cloudDown = true; UI.toast('クラウドに接続できません。端末内の設定で動作します。', 'err'); }
      if (!cloudDown && !Store.state.store) { await chooseStore(); refresh(); }
      if (!cloudDown && Store.state.store) startCloudSync();
      if (!Store.state.pins) { await firstRun(); refresh(); } // クラウド無しで使うときは従来どおり端末の PIN
    } else if (!Store.state.pins) { await firstRun(); refresh(); }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !(window.TV && TV.isTV)) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
  return { refresh, applyPerf, openSettings: () => openSettings && openSettings(), storeMode, storeInfo, choosePreset, logoutStore, calibrate, screenInfo };
})();
window.Game = Game;
