/* プレイヤー画面の進行制御: レイアウト、レバー、抽選確定、ステージ演出、スタッフ認証。 */
const Game = (function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const CX = 800, CY = 420;          // リール窓の中心（#content 座標。左右は画面の中央）
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
  /* 上下の電飾（電球の列）のぶん、中身（#content）と演出の層（#fxwrap）を同じ倍率で少し内側へ寄せる。
     EDGE_K = 縮める倍率、EDGE_DY = 上下の余白をそろえるための縦のずらし（px） */
  const EDGE_K = 0.955, EDGE_DY = 4;
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight, sr = screenRect();
    const w = Math.max(1, (sr.x1 - sr.x0) * vw), h = Math.max(1, (sr.y1 - sr.y0) * vh);
    // 画面サイズ調整で枠を決めてあるとき: その枠にぴったり合わせて固定する（縦と横を別々に伸縮。自動の拡大・縮小や 4:3 用の行間調整はしない）
    const fixed = !(sr.x0 <= 0 && sr.y0 <= 0 && sr.x1 >= 1 && sr.y1 >= 1);
    const H = fixed ? 900 : Math.min(1200, Math.max(900, Math.round(1600 * h / w)));
    scale = Math.min(w / 1600, h / H);
    stageEl.style.height = H + 'px';
    stageEl.style.transform = fixed
      ? 'translate(' + sr.x0 * vw + 'px,' + sr.y0 * vh + 'px) scale(' + w / 1600 + ',' + h / 900 + ')'
      : 'translate(' + (sr.x0 * vw + (w - 1600 * scale) / 2) + 'px,' + (sr.y0 * vh + (h - H * scale) / 2) + 'px) scale(' + scale + ')';
    // 縦に余裕がある画面（4:3 の iPad など）では全体を最大15%拡大して上下の余白を減らす
    // 4:3 では縮めずに行の間隔を広げて縦を使い切る（CSS の --t で各行が下へずれる。最下段は 110px 下がる）。横は 6% だけ拡大
    const t = (H - 900) / 300, f = (1 + 0.06 * t) * EDGE_K;
    [$('content'), $('fxwrap')].forEach((el) => {
      el.style.left = '0px';                          // 拡大の基準点（リール中心）は画面の左右中央なので、横の補正は不要
      el.style.top = (H - 900) / 2 - 55 * t + 30 * (1 - f / EDGE_K) + EDGE_DY + 'px';
      el.style.transform = 'scale(' + f + ')'; // scale プロパティは古い WebView が非対応なので transform を使う
      el.style.setProperty('--t', t.toFixed(3));
    });
    scale *= f;
    stageH = H;
    if (typeof FX !== 'undefined') FX.setGround(420 + (30 + H / 2 / (1 + 0.06 * (H - 900) / 300) + 6 - EDGE_DY) / EDGE_K, () => Sfx.play('chip')); // 画面の下端のすぐ下（内側へ寄せたぶんを戻して計算）
  }

  /* ---------- 画面サイズ調整 ----------
     テレビによっては画面の端が切れて映る。左上と右下の角を動かして「見えている範囲」を決めると、その中に全体が収まる。
     十字キー: 角を動かす / 決定: 動かす角を切り替え / メニュー: 全画面に戻す / 戻る: 保存して終了。タッチは角をドラッグ。 */
  function calibrate() {
    return new Promise((resolve) => {
      const before = Object.assign({}, screenRect());
      calib = Object.assign({}, before);
      let active = 0; // 動かす角: 0 = 左上, 1 = 右上, 2 = 右下, 3 = 左下
      const CN = ['左上', '右上', '右下', '左下'], CK = ['tl', 'tr', 'br', 'bl'];
      const MIN = 0.5; // 幅・高さは画面の半分より小さくしない
      const cl = (v, a, b) => Math.min(b, Math.max(a, v));
      const el = document.createElement('div');
      el.id = 'calib';
      el.innerHTML = '<div class="cal-frame"><i class="cal-c tl" data-c="0"></i><i class="cal-c tr" data-c="1"></i><i class="cal-c br" data-c="2"></i><i class="cal-c bl" data-c="3"></i>' +
        '<div class="cal-panel"><h3>画面サイズ調整</h3>' +
        '<p>四隅の<b>「 マーク</b>が、画面の角にちょうど見える位置に合わせてください。決めた枠いっぱいに、<b>その大きさのまま固定</b>して映します（自動で拡大・縮小しません）。</p>' +
        '<ul><li><b>十字キー</b>：角を動かす（押しっぱなしで速く）</li><li><b>決定</b>：動かす角を切り替え（左上 → 右上 → 右下 → 左下）</li><li><b>メニュー（≡）</b>：全画面に戻す</li><li><b>戻る</b>：保存して終了</li><li>タッチの場合は、角を指で動かせます</li></ul>' +
        '<div class="cal-val"></div>' +
        '<div class="cal-btns"><button data-b="c0">左上</button><button data-b="c1">右上</button><button data-b="c2">右下</button><button data-b="c3">左下</button><button data-b="reset">全画面に戻す</button><button data-b="cancel">キャンセル</button><button data-b="save" class="go">保存して閉じる</button></div></div></div>';
      const frame = el.firstChild, val = el.querySelector('.cal-val');
      const pct = (v) => (Math.round(v * 1000) / 10).toFixed(1) + '%';
      function draw() {
        const vw = window.innerWidth, vh = window.innerHeight;
        frame.style.left = calib.x0 * vw + 'px'; frame.style.top = calib.y0 * vh + 'px';
        frame.style.width = (calib.x1 - calib.x0) * vw + 'px'; frame.style.height = (calib.y1 - calib.y0) * vh + 'px';
        CK.forEach((k, i) => { el.querySelector('.cal-c.' + k).classList.toggle('on', active === i); el.querySelector('[data-b="c' + i + '"]').classList.toggle('on', active === i); });
        val.textContent = 'いま動かす角: ' + CN[active] + '　｜　左上 ' + pct(calib.x0) + ', ' + pct(calib.y0) + '　右下 ' + pct(calib.x1) + ', ' + pct(calib.y1);
        layout();
      }
      // 角ごとに、となり合う2辺を動かす（左上 = 左と上、右上 = 右と上、右下 = 右と下、左下 = 左と下）
      const isLeft = (c) => c === 0 || c === 3, isTop = (c) => c === 0 || c === 1;
      function setCorner(c, x, y) { // x, y は画面に対する割合
        if (isLeft(c)) calib.x0 = cl(x, 0, calib.x1 - MIN); else calib.x1 = cl(x, calib.x0 + MIN, 1);
        if (isTop(c)) calib.y0 = cl(y, 0, calib.y1 - MIN); else calib.y1 = cl(y, calib.y0 + MIN, 1);
        draw();
      }
      function nudge(dx, dy, fast) {
        const d = fast ? 4 : 1, c = active;
        setCorner(c, (isLeft(c) ? calib.x0 : calib.x1) + dx * d / window.innerWidth, (isTop(c) ? calib.y0 : calib.y1) + dy * d / window.innerHeight);
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
        else if (k === 'Enter') { if (!repeat) { active = (active + 1) % 4; Sfx.play('button'); draw(); } }
        else if (k === 'Menu') { calib = Object.assign({}, FULL); draw(); }
        else if (k === 'Back') finish(true);
      }
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-b]');
        if (!b) return;
        Sfx.play('button');
        const k = b.dataset.b;
        if (/^c[0-3]$/.test(k)) { active = +k.slice(1); draw(); }
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

  /* 画面の上下の電飾（電球の列）。電球を 41 個ずつ並べる（光り方は CSS） */
  function buildEdges() {
    ['edgeT', 'edgeB'].forEach((id) => { const el = $(id); if (!el) return; let h = ''; for (let i = 0; i < 41; i++) h += '<i></i>'; el.innerHTML = h; });
  }
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
  /* ---------- 自動アップデート ----------
     開きっぱなしでも 1 時間に 1 回、新しい版があるか確認する（起動時と、アプリに戻ってきたときにも確認する）。
     テレビ版はアプリ本体が公開サイトから取り込み（/__update）、ブラウザ版は読み直すだけ。
     新しい版があれば、ゲームが終わり次第（結果を 2 秒見せてから）読み直す。回転中・設定中は待つ。
     読み直したあとは起動画面を自動で閉じて元の画面に戻る（CREDIT が残っていれば、続きから自動で回る）。 */
  const UPDATE_CHECK_MS = 60 * 60 * 1000;
  const APP_V = ((document.getElementById('ver') || {}).textContent || '').trim();
  // 演出確認用のフック。テスト用の環境（localhost・模擬）でだけ効く。本番では常に無効（b76）
  const FXT = () => ((/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || (window.Cloud && Cloud.isLocal)) ? window.__fxTest : null);
  const verNum = (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0;
  let updChecking = false, updLast = 0, updPending = false;
  const newerOnDisk = (st) => !!st && (st.state === 'done' || (st.state === 'latest' && verNum(st.v) > verNum(APP_V)));
  async function autoUpdate(force) { // force: マスターの「全店舗をいますぐアップデート」から。間隔あけを飛ばして、すぐ確認する
    if (updChecking || (!force && Date.now() - updLast < 60000)) return;
    updChecking = true; updLast = Date.now();
    try {
      if (location.hostname === 'appassets.androidplatform.net') {
        let st = await (await fetch('/__update?t=' + Date.now(), { cache: 'no-store' })).json();
        for (let i = 0; i < 180 && st.state === 'running'; i++) { await wait(1000); st = await (await fetch('/__update_status?t=' + Date.now(), { cache: 'no-store' })).json(); }
        if (newerOnDisk(st)) updPending = true;
      } else if (/^https?:$/.test(location.protocol)) {
        const man = await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json();
        if (man && verNum(man.v) > verNum(APP_V)) {
          try { const ks = await caches.keys(); await Promise.all(ks.filter((k) => k.indexOf('casa-slot-button-') === 0).map((k) => caches.delete(k))); } catch (err) { /* キャッシュ無しの環境 */ }
          updPending = true;
        }
      }
    } catch (err) { /* 圏外・更新に未対応の古いアプリなど: 何もしない（手動の「最新版に更新」は別に使える） */ }
    updChecking = false;
  }
  function updWatch() {
    if (!updPending) return;
    const onSplash = !!document.getElementById('splash');
    if (!onSplash) {
      if (busy || pressing || $('ui').children.length || $('calib')) return;               // 回転中・設定中は待つ
      const p = Store.state && Store.state.play;
      if (p && p.phase !== 'shown') return;                                                  // ゲームの途中
      if (p && resultSince && Date.now() - resultSince < 2000) return;                       // 結果は 2 秒見せてから
    }
    updPending = false;
    try { if (!onSplash) sessionStorage.setItem('casa.skipSplash', '1'); } catch (err) { /* 保存できない環境では起動画面を出す */ }
    location.reload();
  }

  /* 待機中の見せ回し: 待機画面（STAGE 1）で、リールが約5秒回る → ゆっくり止まって READY TO SPIN を3秒見せる → また回る、を繰り返す。
     音は鳴らさない。NEXT GAME を押せばすぐ本番の回転に切り替わる。設定やダイアログを開いている間・画面が隠れている間は回さない。 */
  const ATTRACT_REST_MS = 3000; // READY TO SPIN で止まっている時間
  const ATTRACT_LOGO_EVERY = 5; // 5回に1回は、READY TO SPIN の代わりに casa ロゴ（真ん中だけ）で止まる
  let attractAt = 0, attracting = false, attractN = 0;
  function attractWatch() {
    const s = Store.state;
    const idle = !busy && !pressing && s && s.pins && !s.play && curStage === 1 && !$('ui').children.length && !$('calib') && !document.getElementById('splash') && !document.hidden;
    if (!idle) { attractAt = 0; return; }
    if (attracting) return;
    if (!attractAt) { attractAt = Date.now() + ATTRACT_REST_MS; return; }
    if (Date.now() < attractAt) return;
    attracting = true;
    attractN += 1;
    Reel.attract(attractN % ATTRACT_LOGO_EVERY === 0 ? 'logo' : '').then(() => { attracting = false; attractAt = 0; });
  }
  /* CREDIT（獲得した FREE SPIN）が残っている間は、自動で回り続ける。結果を 2.5 秒見せてから、NEXT GAME を押したのと同じ動きで次へ進む。
     設定やダイアログを開いている間は止まる（閉じると再開）。 */
  const CREDIT_NEXT_MS = 2500;
  let creditAt = 0;
  function creditWatch() {
    const s = Store.state;
    if (updPending) { creditAt = 0; return; } // アップデート待ちのときは、次の FREE SPIN を始めずに読み直しを先にする（CREDIT は残る）
    if (busy || pressing || !s || !s.pins || !((s.credits || 0) + (s.dud || 0) > 0) || (s.play && s.play.phase !== 'shown')) { creditAt = 0; return; }
    if ($('ui').children.length || $('calib') || document.getElementById('splash')) { creditAt = 0; return; }
    if (!creditAt) { creditAt = Date.now() + CREDIT_NEXT_MS; return; }
    if (Date.now() < creditAt) return;
    creditAt = 0;
    const b = lockbar.classList.contains('show') && lockbar.querySelector('[data-act="next"]');
    if (b) b.click();
  }
  /* リールの描き直しの見張り（b76）: 回転していない間、3 秒ごとに静止画を描き直す（キャンバスの中身が消えても 3 秒以内に戻る。描くのは 3 枚だけなので軽い） */
  let reelAt = 0;
  function reelWatch() {
    stageEl.classList.toggle('inplay', busy || !!(Store.state && Store.state.play)); // ゲーム中・結果の表示中（「テスト中」の大きな表示を小さくする）
    const now = Date.now();
    if (now - reelAt < 3000) return;
    reelAt = now;
    if (!document.hidden) Reel.redraw();
  }
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
      setNotes(false);
      const st = s.play.cur || 1;
      if (showingResult || curStage !== st) { showingResult = false; setStage(st); }
      return idleBar();
    }
    clearSure();
    if (showingResult || curStage !== 1) { showingResult = false; setStage(1); }
    if (!s.pins) { lockbar.classList.remove('show'); return setPlate('idle', 'WELCOME', ''); }
    setNotes(true); // 待機画面に戻るたびに、左側を説明に切り替える（説明が入力されている店舗だけ）
    idleBar();
  }
  /* 待機中の説明: リールが回っていない待機画面のときだけ、左のステージの場所に、店舗ごとの説明を出す。
     説明はマスターの「店舗の編集」で 3 つまで入力する。1つなら大きく1枠、2つなら2分割、3つなら3分割。
     ゲームが始まるとステージの表示に戻る（結果を見せている間もステージのまま）。説明が無い店舗は、いつもステージを出す */
  let notesWanted = false;
  function setNotes(on) { notesWanted = !!on; showNotes(); }
  function showNotes() {
    const el = $('notes'), s = Store.state, list = (s && s.store && s.notesFor === s.store.id && s.notes) || []; // 別の店舗に切り替えた直後は、前の店舗の説明を出さない
    if (!el) return;
    const on = notesWanted && list.length > 0;
    stageEl.classList.toggle('show-notes', on);
    if (!on) return;
    const sig = JSON.stringify(list);
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = list.map((t) => '<div class="note"><p>' + escH(t) + '</p></div>').join('');
    }
    // 高さはステージの列と同じ。文字は、枠に収まる一番大きい大きさにする
    el.style.height = $('ladder').offsetHeight + 'px';
    el.querySelectorAll('.note').forEach((box) => {
      const p = box.querySelector('p');
      const maxW = box.clientWidth - 28, maxH = box.clientHeight - 28, text = p.textContent;
      const start = [0, 50, 40, 32][list.length] || 32;
      let size = start;
      p.style.fontSize = size + 'px';
      // 入力された 1 行ずつの幅を測って、途中で切れる行がいちばん少なくなる大きさを選ぶ（同じなら大きいほう。小さくしすぎない）
      p.style.whiteSpace = 'pre'; p.style.maxWidth = 'none';
      const widths = text.split('\n').map((ln) => { p.textContent = ln || ' '; return p.offsetWidth; });
      p.textContent = text; p.style.whiteSpace = ''; p.style.maxWidth = '';
      for (let sz = start, best = Infinity; sz >= Math.max(26, Math.round(start * 0.6)); sz -= 2) {
        const broken = widths.filter((w) => w * sz / start > maxW).length;
        if (broken < best) { best = broken; size = sz; }
      }
      p.style.fontSize = size + 'px';
      while (size > 14 && (p.scrollHeight > maxH || p.scrollWidth > maxW)) { size -= 2; p.style.fontSize = size + 'px'; }
    });
  }
  const WDAY = ['日', '月', '火', '水', '木', '金', '土'];
  // 配当履歴の日時: 日付（曜日つき）を大きく、時刻は小さく
  const hhmm = (ts) => { const d = new Date(ts), p = (n) => ('0' + n).slice(-2); return '<span>' + (d.getMonth() + 1) + '/' + d.getDate() + '<em>(' + WDAY[d.getDay()] + ')</em></span><i>' + p(d.getHours()) + ':' + p(d.getMinutes()) + '</i>'; };
  /* 画面右: 配当の履歴（日付・時刻と金額。新しい順に 40 件。待機中は、上へゆっくり流れ続ける）。
     店舗モードでは全店舗ぶん（Cloud の feed）を店舗名つきで出す。読めないとき（圏外・データベースの決まりが古い・1台運用）は、この端末の履歴を出す */
  let recentShown = -1, feed = null, feedTop = 0, unFeed = null;
  const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 配当履歴の店舗名の横に付ける絵文字（店舗名に含まれる文字で決める）: 上野 = パンダ / 渋谷 = 犬 / 札幌 = 雪
  const STORE_EMOJI = [['上野', '\u{1F43C}'], ['渋谷', '\u{1F436}'], ['札幌', '\u2744\uFE0F']];
  const storeLabel = (name) => { const e = STORE_EMOJI.find((x) => String(name).indexOf(x[0]) >= 0); return (e ? '<em>' + e[1] + '</em>' : '') + escH(name); };
  function renderRecent() {
    const list = $('recentList');
    const row = (x, isNew) => '<div class="rc' + (isNew ? ' new' : '') + (x.value >= 1000000 ? ' wider' : x.value >= 100000 ? ' wide' : '') + '"><small>' + hhmm(x.ts).replace(/<\/i>$/, (x.store ? '<u>' + storeLabel(x.store) + '</u>' : '') + '</i>') + '</small><b>' + fmtN(x.value) + '</b></div>'; // 店舗名は時刻の横に小さく
    $('recent').classList.toggle('all', !!feed);
    if (feed) { // 全店舗ぶん
      const top = feed.length ? feed[0].ts : 0, grew = feedTop > 0 && top > feedTop;
      feedTop = top || feedTop;
      return putRecent(list, feed.length ? feed.map((x, i) => row(x, grew && i === 0)).join('') : '<div class="rc none">—</div>', feed.length);
    }
    const all = Store.state.recent || [];
    const r = all.slice(-RECENT_MAX).reverse();
    const grew = recentShown >= 0 && all.length > recentShown;
    recentShown = all.length;
    putRecent(list, r.length ? r.map((x, i) => row(x, grew && i === 0)).join('') : '<div class="rc none">—</div>', r.length);
  }
  /* 配当履歴の流れ（b69）: 40 件は一度に入らないので、待機中は上へゆっくり流し続ける（b68 のページ送りから、オーナーの指示で変更）。
     同じ行をうしろにもう一度並べて、1 周ぶん動かしたら最初に戻す。見た目は切れ目なくつながる（2 周目の先頭には細い線を入れる）。
     動くのは待機画面のときだけ。ゲーム中と結果を見せている間は、流れを止めて、いちばん新しい行を先頭に出す。
     中身が変わったとき（新しい当たりが入ったとき）も先頭に戻す。全部が枠に入る件数のときは流さない。
     動きは transform のアニメだけ（描き直しが起きないので軽い）。移動量は件数で変わるので、keyframes は数字を入れて作る */
  const RECENT_MAX = 40, RECENT_HOLD_SEC = 5, RECENT_ROW_SEC = 2; // 先頭で止めておく秒数 / 1 行ぶん流れるのにかける秒数
  let recentHtml = null, recentN = 0, recentFlowing = false;
  const recentPlain = () => (recentHtml || '').split('class="rc new').join('class="rc'); // 「新しい行」の動きは、流すときには付けない
  function putRecent(list, html, n) {
    recentN = n;
    if (html === recentHtml) return; // 同じ内容なら描き直さない（流れている途中で先頭に戻さないため）
    recentHtml = html;
    recentFlowing = false;
    list.style.animation = '';
    list.innerHTML = html;
  }
  function startRecentFlow() {
    const list = $('recentList'), view = list.parentNode, first = list.firstElementChild;
    if (!first || recentN < 2) return;
    const rowH = first.offsetHeight || 60, total = recentN * rowH;
    if (total <= view.clientHeight + 4) return; // 全部入っている
    const marked = recentPlain().replace('class="rc', 'class="rc loop'); // 先頭の行に目印（細い線）。1 周目と 2 周目を同じ見た目にして、戻る瞬間に何も変わらないようにする
    list.innerHTML = marked + marked;
    let st = document.getElementById('rcflowStyle');
    if (!st) { st = document.createElement('style'); st.id = 'rcflowStyle'; document.head.appendChild(st); }
    st.textContent = '@keyframes rcflow{from{transform:translate3d(0,0,0)}to{transform:translate3d(0,-' + total + 'px,0)}}';
    list.style.animation = 'rcflow ' + (recentN * RECENT_ROW_SEC) + 's linear ' + RECENT_HOLD_SEC + 's infinite';
    recentFlowing = true;
  }
  function stopRecentFlow() {
    if (!recentFlowing) return;
    recentFlowing = false;
    const list = $('recentList');
    list.style.animation = '';
    list.innerHTML = recentPlain();
  }
  function recentWatch() {
    const s = Store.state;
    const idle = !busy && !pressing && s && s.pins && !s.play && !$('ui').children.length && !$('calib') && !document.getElementById('splash') && !document.hidden; // 画面が隠れている間（スクリーンセーバー等）は流さない（b75）
    if (!idle) return stopRecentFlow();
    if (!recentFlowing) startRecentFlow();
  }
  function startFeed() {
    stopFeed();
    if (!storeMode()) return;
    unFeed = Cloud.watchFeed(RECENT_MAX + 20, (listOrNull) => { // 二重の行をまとめると減るので、少し多めに読む
      feed = Array.isArray(listOrNull) ? dedupeFeed(listOrNull.filter((x) => x && x.value > 0 && x.ts)).slice(0, RECENT_MAX) : null;
      if (feed && !feed.length && (Store.state.recent || []).length) feed = null; // 全店舗の履歴がまだ空なら、この端末の履歴を出す（空の枠を見せない。b75）
      if (feed) { clearTimeout(feedRetry); seedFeed(); } // 読めたら、予約していた再試行は消す（b75）
      // 読めなかったら 10 分後にもう一度試す（データベースの決まりを変えたあと、端末を触らなくても全店舗の表示に切り替わる）
      if (!feed) { clearTimeout(feedRetry); feedRetry = setTimeout(startFeed, 10 * 60 * 1000); }
      renderRecent();
    });
  }
  /* 同じ当たりが二重に入っていても1行にまとめる（同じ店舗・同じ金額で、時刻の差が 8 秒以内のもの。b60・b61 の端末が送った分と、あとから入れた過去ぶんが重なる場合がある） */
  function dedupeFeed(list) {
    const out = [];
    list.slice().sort((a, b) => b.ts - a.ts).forEach((x) => { if (!out.some((y) => y.storeId === x.storeId && y.value === x.value && Math.abs(y.ts - x.ts) <= 8000)) out.push(x); });
    return out;
  }
  /* これまでの当たり（この端末に残っている配当履歴。最大 200 件）を、全店舗の配当履歴に入れる。端末ごとに1回だけ。
     全店舗の履歴が読めることを確かめてから送る（読めないうちは送らない）。途中で失敗したら、次に読めたときにやり直す（同じ当たりは増えない） */
  let seeding = false;
  async function seedFeed() {
    const s = Store.state, me = s.store;
    if (seeding || !me || s.feedSeeded || s.testMode) return;
    seeding = true;
    try {
      const wins = (s.recent || []).filter((x) => x && x.value > 0 && x.ts).map((x) => ({ ts: x.ts, value: x.value }));
      await Cloud.pushWins(me.id, (cloudStore && cloudStore.name) || me.name, wins);
      Store.transact((st) => { st.feedSeeded = true; Store.log('FEED_SEED', { count: wins.length }); });
    } catch (err) { /* 圏外など: 次に読めたときにやり直す */ }
    seeding = false;
  }
  let feedRetry = 0;
  function stopFeed() { clearTimeout(feedRetry); if (unFeed) { unFeed(); unFeed = null; } feed = null; feedTop = 0; }

  /* 画面に出す合計当選額。演出中のプレイの分は、結果が出るまで含めない */
  function shownTotal() {
    const s = Store.state;
    return (s.wonTotal || 0) - (s.play && s.play.phase === 'drawn' && !s.play.test ? s.play.value : 0);
  }
  /* 最高額配当（集計をリセットしてからの、1回の当たりの最高額）。まだ記録が無い端末は、配当履歴の中の最高額から始める */
  function bestOf(s) {
    if (typeof s.bestValue === 'number') return s.bestValue;
    return (s.recent || []).reduce((m, r) => Math.max(m, Number(r.value) || 0), 0);
  }
  function showCredits() {
    showPreset();
    $('credit').textContent = fmtN(Store.state.session.playNo); // ボタン版: プレイ回数
    // 右上の2段目は「最高額配当」。回転中のプレイの分は、結果が出るまで反映しない（b53 で「合計当選額」から変更）
    { const st = Store.state, p = st.play; $('total').textContent = fmtN(p && p.phase === 'drawn' && !p.test && typeof p.bestBefore === 'number' ? p.bestBefore : bestOf(st)); stageEl.classList.toggle('testmode', !!st.testMode);
      // CREDIT: 残っている FREE SPIN（casa ロゴの 10 回と FREE SPIN ×1〜×3 の、当たりなしの回 ＋ スタッフが入れたクレジット）
      const cr = $('crd'), n = String((st.credits || 0) + (st.dud || 0));
      if (cr && cr.textContent !== n) { const up = +n > +cr.textContent; cr.textContent = n; if (up) restart(cr, 'bump'); }
      stageEl.classList.toggle('has-info', logoOn()); } // 合計当選額（演出中の分は結果が出てから）
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
    setNotes(false); // 結果を見せている間は、ステージの表示のまま
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
  /* 結果表示中のプレイを片付けて STAGE 1 に戻す（CREDIT の FREE SPIN も、毎回 STAGE 1 から回す） */
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
    // 抽選の前に、マスターから配られている今のプリセットをもう一度当てる（端末側の保存を書き換えられていても、配られた設定で抽選する。同じなら何もしない。b76）
    if (storeMode() && cloudStore && cloudStore.activePresetId && cloudPresets[cloudStore.activePresetId]) applyPreset(cloudPresets[cloudStore.activePresetId]);
    syncTable(); // 念のため、抽選の前に配当表をそろえる（変わっていなければ何もしない）
    try {
      Store.transact((s) => {
        const ses = s.session;
        if ((s.dud || 0) > 0) { // FREE SPIN ×1〜×3 で増えた回: 抽選しない。必ず 0。回転数・集計・当たり本数のどれにも数えない
          s.dud -= 1;
          s.play = { playNo: ses.playNo, stage: 1, value: 0, overflow: false, phase: 'drawn', cur: 1, ts: Date.now(), free: true, dud: true };
          s.locked = true;
          Store.log('FREE_PLAY', { left: s.dud });
          return;
        }
        const v = Engine.validateProbs(s.probs);
        if (!v.ok) throw new Error('probs');
        const now = Date.now();
        s.hits = Engine.pruneHits(s.hits, now, s.limits && s.limits.resetHour);
        const blocked = Engine.blockedKeys(s.limits, s.hits, now, s.probs);
        // 開始直後の高額制限: その営業日の最初の X 回は、Y 以上の金額を出さない（回数は毎日のリセット時刻から数え直す）
        const from = Engine.windowStart(now, s.limits && s.limits.resetHour);
        if (!s.dayPlays || s.dayPlays.from !== from) s.dayPlays = { from, n: 0 };
        Engine.earlyBlocked(s.limits && s.limits.early, s.dayPlays.n, s.probs).forEach((k) => { if (blocked.indexOf(k) < 0) blocked.push(k); });
        // オフライン対策（b74、オーナー指示）: ネットにつながっていない間は抽選せず、必ず STAGE 1 の 0 で終わる（画面には何も出さない。設定画面にだけ出す）
        if (storeMode() && !netOk) { res = { overflow: false, key: '1:0', stage: 1, value: 0 }; Store.log('OFFLINE_PLAY', {}); }
        else res = Engine.drawProb(s.probs, undefined, blocked);
        // テスト用プリセット: 回転数・当選額・当たり本数の制限・配当履歴・マスターの集計のどれにも数えない（全履歴には「テスト」として残す）
        const test = !!s.testMode;
        const bestBefore = bestOf(s); // 今回の結果が出る前の最高額配当（回転中はこちらを表示する）
        if (!test) {
          if (res.value > bestBefore) s.bestValue = res.value; else s.bestValue = bestBefore;
          s.dayPlays.n += 1;
          if (res.value > 0) s.hits.push({ ts: now, key: res.key });
          ses.playNo += 1;
          ses.awarded += res.value;
          s.wonTotal = (s.wonTotal || 0) + res.value; // 合計当選額も同じ書き込みで加算（表示は結果が出てから）
        }
        s.play = { playNo: ses.playNo, stage: res.stage, value: res.value, overflow: false, phase: 'drawn', cur: 1, ts: Date.now() };
        if (test) s.play.test = true; else s.play.bestBefore = bestBefore;
        if ((s.credits || 0) > 0) { s.credits -= 1; s.play.free = true; } // CREDIT（獲得した FREE SPIN）を 1 使って回す（テスト用プリセットでも同じ）
        s.locked = true;
        Store.log('PLAY', { playNo: ses.playNo, stage: res.stage, value: res.value, key: res.key, path: Engine.pathFor(res.stage), blocked: blocked.length ? blocked : undefined, test: test || undefined, free: s.play.free || undefined });
      });
    } catch (err) {
      UI.toast(err.message === 'probs' ? '確率の設定に誤りがあります。設定画面で確認してください。' : '抽選を開始できませんでした（保存エラー）。', 'err');
      return refresh();
    }
    oneMore = false; skipSpecial = false;
    showCredits();
    lockbar.classList.remove('show');
    if (storeMode() && !Store.state.play.test && !Store.state.play.dud) { const p = Store.state.play, me = Store.state.store; Cloud.pushPlay(me.id, { ts: p.ts, stage: p.stage, value: p.value, key: p.stage + ':' + p.value, playNo: p.playNo, presetId: Store.state.presetId || null, free: !!p.free }, Store.state.limits && Store.state.limits.resetHour).catch(() => {}); }
    runStage(Store.state.play, 1);
  }

  /* ---------- 停止パターンの抽選（結果は確定済み。見せ方だけを変える） ----------
     ハズレ(0)で止まるとき …「当たりと思いきやハズレ」: 当たり絵柄で止まりかけて滑る／行きかけて戻される
     当たり・NEXT で止まるとき …「ハズレと思いきや当たり」: 0 で止まりかけて滑る／0 に行きかけて戻る／0 で一度止まって再始動
     DRAMA はその演出が出る割合（ステージ別）。 */
  const DRAMA = { lose: [0, 0.55, 0.7, 0.9], win: [0, 0.5, 0.65, 0.85] };
  /* FREE SPIN ×1 / ×2 / ×3: リールに同じ FREE SPIN が3本そろい、その回数だけ自動で回り直す。演出だけで、結果（確率で確定済み）や回転数は変わらない。
     本当の結果は最後の回に出る（×2・×3 の途中の回は 0 で止まる）。
     出る割合（1スピンあたりの %）はプリセットごとにマスター画面で決める（state.freeRate / freeRate2 / freeRate3。未設定は 8 / 3 / 1 %）。
     0% の種類は、絵柄そのものを出さない（そろわない絵柄で期待させないため）。 */
  const FREE_DEFAULTS = [8, 3, 1], FREE_MAX = [50, 25, 25];
  const FREE_SYM = { 1: 'FREE', 2: 'FREE2', 3: 'FREE3' };
  const freeRates = () => ['freeRate', 'freeRate2', 'freeRate3'].map((k, i) => { const v = Store.state[k]; return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(FREE_MAX[i], v)) : FREE_DEFAULTS[i]; });
  /* casa ロゴが3本そろうと 10 FREE SPIN を獲得: CREDIT が 10 増え、自動で 10 回まわる。この 10 回は当たりなしの回（抽選しない。必ず 0。b66 から）。
     出る割合（1スピンあたりの %。state.logoRate）は未設定なら 0 = 出ない。マスター画面のプリセットで決める。 */
  const LOGO_SPINS = 10, LOGO_MAX = 5;
  const logoRate = () => { const v = Store.state && Store.state.logoRate; return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(LOGO_MAX, v)) : 0; };
  const logoOn = () => logoRate() > 0 && Reel.hasLogo;
  let skipSpecial = false; // casa ロゴがそろった直後の回り直しでは、FREE SPIN やロゴをもう一度出さない
  function rollLogo() {
    if (FXT() && FXT().logo !== undefined) return !!FXT().logo && Reel.hasLogo; // 演出確認用
    return logoOn() && Math.random() * 100 < logoRate();
  }
  /* このスピンで FREE SPIN を出すか。0 = 出さない、1〜3 = ×1〜×3 */
  function rollFree() {
    if (FXT() && FXT().free !== undefined) return FXT().free === true ? 1 : (+FXT().free || 0); // 演出確認用
    const r = Math.random() * 100, rates = freeRates();
    let acc = 0;
    for (let i = 0; i < 3; i++) { acc += rates[i]; if (r < acc) return i + 1; }
    return 0;
  }
  /* 確定演出（WARP・逆回転）は、普通に回り始めてからこの時間がたってから出す（いきなり出さない） */
  const EFFECT_DELAY_MS = 5000;
  /* 逆回転（当たり確定の演出）: 金額が当たるプレイの最後のステージで、たまに、回っている途中で突然3本とも逆回転を始める */
  const REVERSE_RATE = 0.12;
  function rollReverse() {
    if (FXT() && FXT().reverse !== undefined) return !!FXT().reverse; // 演出確認用
    return Math.random() < REVERSE_RATE;
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
  function pickPattern(st, sym, holdSt) { // holdSt: 止まりかけの間の長さに使うステージ（FREE SPIN で回る分は 1）
    if (FXT() && FXT().pat) return FXT().pat; // 演出確認用（結果には影響しない）
    const isWin = sym !== 0;
    if (Math.random() > (isWin ? DRAMA.win : DRAMA.lose)[st]) return { type: 'plain' };
    if (isWin && Math.random() < RESPIN_RATE[st]) return { type: 'respin' };
    const p = pickCatalog();
    // 止まりかけで見せる「惜しい絵柄」は spinReel 側で、先に止まった2本との合計が別の結果になる絵柄から選ぶ
    return { type: 'seq', pre: p.pre, holds: p.holds.map((h) => HOLD_SEC[h][(holdSt || st) - 1]), over: p.over, crawl: p.crawl, id: p.id };
  }

  /* ---------- 確定演出（虹） ----------
     最終結果が 0 以外に確定しているプレイでだけ、ステージが上がった瞬間に突然すべてが虹色になる。
     ハズレのプレイでは絶対に出ない。1プレイで1回まで。発生後は結果が出るまで虹色のまま。
     SURE_RATE はステージアップ1回あたりの発生率（たまに出る程度）。 */
  const SURE_RATE = 0.08;
  /* プチュン: ブラウン管が消えるように突然暗転（または白飛び）→ 復帰。
     画面が消える演出は「金額が当たることが確定しているプレイ」でしか出さない（出たのに 0 で終わることは無い）。
       real … 2,000 以上の当たりが確定しているプレイの、最後のステージで 1/2。復帰と同時に虹色モード
       fake … それ以外の当たりのプレイでたまに（PUCHUN_FAKE）。色は変わらないが、最終的に必ず金額が当たる */
  const PUCHUN_MIN = 2000, PUCHUN_REAL = 0.5, PUCHUN_FAKE = 0.15;
  let puchunPlan = null; // このステージのスピンで実行する予定 { kind:'real'|'fake', fx:'crt'|'flash' }
  const pickFx = () => (Math.random() < 0.5 ? 'crt' : 'flash'); // 暗転（プチュン）か白飛び（フラッシュ）か半々
  function planPuchun(play, st) {
    puchunPlan = null;
    if (FXT() && FXT().puchun) { puchunPlan = { kind: FXT().puchun, fx: FXT().fx || pickFx() }; return; }
    if (!(play.value > 0)) return; // ハズレで終わるプレイでは、画面が消える演出を出さない
    const finalStage = st === play.stage;
    if (finalStage && play.value >= PUCHUN_MIN && !sureShown && !play.overflow) { if (Math.random() < PUCHUN_REAL) puchunPlan = { kind: 'real', fx: pickFx() }; return; }
    if (Math.random() < PUCHUN_FAKE) puchunPlan = { kind: 'fake', fx: pickFx() };
  }
  /* 画面が消える（crt）／白く飛ぶ（flash）。during() は真っ暗・真っ白の間に呼ばれる（ステージ切替などに使う）。
     freeze = true のとき、画面が消えている間はリールの時計を止め、消え始めた分も巻き戻して再開する
     （確定演出の時間を回転時間に数えない。画面が戻ってから、リールは本来の長さだけ回る）。 */
  /* afterSec を渡すと（freeze のときだけ）、画面が戻ってから afterSec 秒は3本目が回り続ける
     （確定演出のあと、すぐに結果が決まってしまわないように、消えている間に3本目を回し直す）。 */
  async function blink(fx, holdMs, during, freeze, afterSec) {
    const back = (sec) => { if (!freeze) return; if (afterSec > 0) { Reel.relaunch(sec + afterSec); Reel.resume(0); } else Reel.resume(sec); };
    const crt = $('crt');
    // ゆっくり: 消えるのに約1秒、消えたまま holdMs、戻るのに約0.7秒
    if (fx === 'flash') {
      Sfx.play('warp');
      crt.className = 'white-in';
      await wait(600);
      crt.className = 'white';
      Sfx.spin(0);
      if (freeze) Reel.hold();
      if (during) await during();
      await wait(holdMs);
      back(1.0);
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
    if (freeze) Reel.hold();
    if (during) await during();
    await wait(holdMs);
    back(0.7);
    Sfx.play('crtOn');
    crt.className = 'on';
    await wait(700);
    crt.className = '';
  }
  /* 画面が戻ったあと、3本目は「確定の演出が落ち着くまで」＋「2本目から3本目までの本来の時間」をまるごと回ってから止まる */
  let lastWindow = 4.5; // 直近のスピンで、2本目が止まってから3本目が止まるまでの秒数
  async function puchun(plan) {
    const real = plan.kind === 'real';
    await blink(plan.fx, real ? 2200 : 1600, null, true, (real ? 2.5 : 1.0) + lastWindow);
    if (real) announceSure();
  }
  /* ワープ開始: NEXT GAME 直後、結果が STAGE 2 以上で「金額が当たる」プレイでたまに、いきなり上のステージから始まる。
     画面が消える（白く飛ぶ）演出を使うので、ハズレで終わるプレイでは出さない */
  const WARP_RATE = 0.18;
  function pickWarp(play, st) {
    if (st !== 1 || play.stage < 2 || play.overflow || !(play.value > 0)) return 0;
    if (FXT() && FXT().warp !== undefined) return FXT().warp;
    if (Math.random() >= WARP_RATE) return 0;
    return play.stage === 3 && Math.random() < 0.5 ? 3 : Math.min(play.stage, 2); // 3 まで行けるときは半々で 3 に直行
  }
  let pendingSure = false;
  function pickSure(play) {
    if (sureShown || !play || !(play.value > 0) || play.overflow) return false;
    if (FXT() && FXT().sure !== undefined) return !!FXT().sure;
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

  /* CREDIT を n 増やす。右上の数字が 1 ずつ増える。
       by = 'LOGO'（casa ロゴの 10 回）も、by = 'FREE'（FREE SPIN ×1〜×3）も、当たりなしの FREE SPIN（state.dud。抽選せず、必ず 0 で止まる）。
       b65 までは、ロゴの 10 回だけ本物の追加プレイ（state.credits）だった。b66 でオーナーの指示により、ロゴも当たりなしに変更。
       state.credits（本物の追加プレイ）に入るのは、スタッフが設定画面で入れたクレジットだけ。
     画面の CREDIT は、その2つの合計を出す。テスト用プリセットでも増える（動きを確認できるように） */
  const creditsLeft = () => (Store.state.credits || 0) + (Store.state.dud || 0);
  async function addCredits(n, by) {
    const key = 'dud', before = creditsLeft();
    try { Store.transact((s) => { s[key] = (s[key] || 0) + n; Store.log('CREDIT_ADD', { amount: n, before, after: before + n, by }); }); } catch (err) { /* 保存に失敗したら増やさない */ }
    const after = creditsLeft(), cr = $('crd');
    for (let k = before + 1; k <= after; k++) { if (cr) { cr.textContent = String(k); restart(cr, 'bump'); } Sfx.play('count'); await wait(n > 3 ? 110 : 260); } // 1 ずつ増える
  }

  /* 1ステージ分の演出。NEXT STAGE なら次のステージへ移り、再びレバー待ちに戻る。 */
  async function runStage(play, st) {
    try { return await runStageInner(play, st); }
    catch (err) {
      // 演出の途中でエラー（b76）: ボタンが効かないまま固まらないように戻す。抽選結果は保存済みなので、NEXT GAME で続きから再開できる
      busy = false; pressing = false;
      try { Store.transact(() => Store.log('FX_ERROR', { stage: st, message: String(err && err.message || err).slice(0, 120) })); } catch (e) { /* ログのみ */ }
      try { tense(0); Lever.setEnabled(true); } catch (e) { /* noop */ }
      refresh();
    }
  }
  async function runStageInner(play, st) {
    busy = true;
    setNotes(false); // ゲーム中は、左側をステージの表示に戻す
    tense(0); // 念のため（前の回の期待の演出が残らないように）
    lockbar.classList.remove('show');
    const sym = st < play.stage ? 'NEXT' : play.value;
    const noSp = skipSpecial; skipSpecial = false;
    // 獲得した FREE SPIN（CREDIT）で回しているゲームでは、さらに FREE SPIN を出さない設定（プリセットで ON/OFF。未設定は ON）
    const lockFree = (!!play.free && (!!play.dud || Store.state.noRetrigger !== false)) || (storeMode() && !netOk); // 当たりなしの FREE SPIN（dud）の回と、オフラインの間は、FREE SPIN もロゴも出さない（b75）
    const logoHit = !oneMore && !noSp && !lockFree && rollLogo();           // casa ロゴ3本 → 10 FREE SPIN（当たりなしの回）
    const freeN = !oneMore && !noSp && !logoHit && !lockFree ? rollFree() : 0; // FREE SPIN ×N 3本 → N 回の FREE SPIN（当たりなし）
    // 逆回転: 金額が当たるプレイの、結果が出るスピンでだけ。ほかの演出とは重ねない
    const rev = !oneMore && !freeN && !logoHit && sym !== 'NEXT' && play.value > 0 && rollReverse();
    const pat = oneMore || freeN || logoHit ? { type: 'plain' } : rev ? { type: 'plain', reverse: true } : pickPattern(st, sym, play.free ? 1 : st); // 回り直しのときは引かない（未使用のパターン id を記録しないため）
    if (!oneMore && !freeN && !logoHit && !rev && pat.type !== 'respin') planPuchun(play, st); else puchunPlan = null;
    const warpTo = oneMore || freeN || logoHit || noSp ? 0 : pickWarp(play, st);
    showCredits();
    if (warpTo) { // 普通に回り始めて 5 秒たったところで、いきなり上のステージへ（途中のステージは回さない）
      puchunPlan = null;
      setPlate('spin', 'GOOD LUCK', 'STAGE ' + st);
      if (!window.LITE) FX.cards(10, 0.3, { sweep: true });
      Sfx.play('shuffle');
      // 止まる前にワープするので、停止時刻はずっと先にしておく（画面が消えている間に setStage が回転を止める）
      Reel.spin(st, ['BAR', 'BAR', 'BAR'], [0, 1, 2], [60, 61, 62], { type: 'plain' }, { onStart: () => Sfx.play('reelStart'), onTick: (n) => Sfx.tick(n), onSpeed: (n) => Sfx.spin(n) });
      await wait(EFFECT_DELAY_MS);
      Sfx.spin(0);
      await blink(pickFx(), 1800, async () => { setStage(warpTo); });
      try { Store.transact((s) => { if (s.play) s.play.cur = warpTo; }); } catch (err) { /* 進行位置のみ */ }
      Sfx.play('stageReady');
      showBanner('next', 'WARP', 'STAGE ' + warpTo);
      await wait(5000); // 「いきなり飛んだ」余韻
      await hideBanner();
      return runStage(play, warpTo);
    }
    if (play.free && !sureShown) setPlate('spin', 'FREE SPIN', 'CREDIT 残り ' + creditsLeft()); // CREDIT を使って回している
    else setPlate(sureShown ? 'spin sure' : 'spin', sureShown ? sureText[0] : 'GOOD LUCK', sureShown ? sureText[1] : 'STAGE ' + st);

    const extra = { fast: !!play.free, noFree: lockFree, noTension: !!play.dud }; // FREE SPIN で回る分は、どのステージでも STAGE 1 と同じ速さ。noFree: FREE SPIN の絵柄も出さない
    if (!window.LITE) FX.cards(10, 0.3, { sweep: true });
    Sfx.play('shuffle');

    if (oneMore) {
      // ワンモアチャンス後の引き直し: 短めの回転で本当の結果へ
      oneMore = false;
      await spinReel(st, sym, { type: Math.random() < 0.5 ? 'slip' : 'plain' }, extra); // 回り直しも通常と同じ速さ・間隔
    } else if (logoHit) {
      // casa ロゴが3本そろう → 10 FREE SPIN（当たりなしの回）を獲得。CREDIT が増える。このゲームは続けて回り、結果を出す
      await spinReel(st, 'LOGO', { type: Math.random() < 0.6 ? 'slip' : 'plain' }, extra);
      win.classList.add('win');
      Sfx.play('revive');
      Sfx.play('kyuin');
      flash(true);
      quake();
      FX.ring(CX, CY, 'gold', 1200, 0.9);
      FX.burst(CX, CY, 260, { max: 1400, life: 1.7 });
      showBanner('next omc', '', LOGO_SPINS + ' FREE SPIN');
      await wait(1300);
      await addCredits(LOGO_SPINS, 'LOGO');
      await wait(900);
      await hideBanner();
      skipSpecial = true;
      win.classList.remove('win', 'lose');
      showCredits();
      await wait(300);
      return runStage(play, st);
    } else if (freeN) {
      // FREE SPIN ×N が3本そろう → CREDIT が N 増える。このゲームは続けて回って結果を出し、そのあと N 回、自動で回る。
      // その N 回は演出で、抽選しない。必ず 0 で止まる（当たりは出ない。出る金額の合計は変わらない）
      await spinReel(st, FREE_SYM[freeN], { type: Math.random() < 0.6 ? 'slip' : 'plain' }, extra);
      win.classList.add('win');
      Sfx.play('revive');
      flash(false);
      FX.ring(CX, CY, 'gold', 1100, 0.8);
      FX.burst(CX, CY, 140 + 60 * (freeN - 1), { max: 1200, life: 1.5 });
      showBanner('next omc', '', 'FREE SPIN \u00d7' + freeN);
      await wait(1300);
      await addCredits(freeN, 'FREE');
      await wait(700);
      await hideBanner();
      skipSpecial = true;
      win.classList.remove('win', 'lose');
      showCredits();
      await wait(300);
      return runStage(play, st);
    } else if (pat.type === 'respin') {
      // ハズレと思いきや当たり: 0 で完全に止まる → 暗転 → ONE MORE CHANCE → もう一度レバーを引かせる
      await spinReel(st, 0, { type: 'plain' }, Object.assign({ noTension: true }, extra));
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
      await wait(800);
      return runStage(Store.state.play, st + 1);
    }
    await resultFx(play);
    clearSure();
    const out = false; // ボタン版: クレジット制なし（PINなしで何回でも回せる）
    try { Store.transact((s) => { if (s.play) { s.play.phase = 'shown'; if (lastCombo) s.play.combo = lastCombo.combo; if (s.play.value > 0 && !s.play.test) s.recent = (s.recent || []).concat({ ts: Date.now(), value: s.play.value }).slice(-200); } if (out) Store.log('TOTAL', { total: s.wonTotal || 0 }); }); } catch (err) { /* 表示済みフラグのみ。失敗しても整合性に影響なし */ }
    showCredits();
    renderRecent();
    if (storeMode() && play.value > 0 && !play.test) { const me = Store.state.store, last = (Store.state.recent || []).slice(-1)[0]; Cloud.pushWin(me.id, (cloudStore && cloudStore.name) || me.name, { ts: last && last.value === play.value ? last.ts : Date.now(), value: play.value }).catch(() => {}); } // 全店舗の配当履歴へ（時刻は端末の履歴と同じにする）
    if (out) await totalFx(Store.state.wonTotal || 0);
    busy = false;
    if (Store.state.play) showLocked(Store.state.play, true); else refresh();
  }

  /* ---------- 期待の段階化 ----------
     先に止まった2本が「NEXT STAGE 2本」「同じ FREE SPIN 2本」「casa ロゴ 2本」、または2本の合計が大きいときだけ、
     3本目が回っている間に、音・枠の光・減速を 1 → 2 → 3 段階と強くする（Engine.tensionOf が場面を判定）。
     結果は確定済みで、ここで決めるのは見せ方だけ。来る時ほど高い段階まで上がりやすく、3段階目は来る時にしか出ない。
     来ない時はほとんど出さない（出ても 1〜2 段階まで）。「惜しい」などの文字は出さない。
     FREE SPIN ×1・×2 と STAGE 1 の合計は小さな場面なので、控えめに出す（出しすぎると効かなくなる）。 */
  const TENSE_V = [0.72, 0.5, 0.3]; // 段階ごとの3本目の速さ（最高速に対する割合）
  const TENSE_RATE = { // [出さない, 1段階, 2段階, 3段階] の割合。添字 = その場面で上がれる上限（cap）
    big: { // NEXT STAGE・casa ロゴ・FREE SPIN ×3・STAGE 2 以上の合計
      hit: { 1: [0.15, 0.85], 2: [0.08, 0.27, 0.65], 3: [0.06, 0.12, 0.30, 0.52] },
      miss: { 1: [0.80, 0.20], 2: [0.76, 0.19, 0.05], 3: [0.76, 0.18, 0.06, 0] },
    },
    small: { // FREE SPIN ×1・×2、STAGE 1 の合計
      hit: { 1: [0.60, 0.40], 2: [0.60, 0.25, 0.15], 3: [0.60, 0.20, 0.12, 0.08] },
      miss: { 1: [0.93, 0.07], 2: [0.93, 0.06, 0.01], 3: [0.93, 0.06, 0.01, 0] },
    },
    sum: { 1: [0.50, 0.50], 2: [0.40, 0.45, 0.15], 3: [0.30, 0.40, 0.30, 0] }, // 合計が大きいが最高額ではない回（当たりではあるので、よく出す。3段階目は最高額の時だけ）
  };
  function planTension(st, combo, order) {
    const t = Engine.tensionOf(st, combo, order);
    if (!t) return null;
    let steps = 0;
    if (FXT() && FXT().tension !== undefined) steps = Math.min(t.cap, +FXT().tension || 0); // 演出確認用
    else {
      const w = t.kind === 'sum' && t.big && !t.hit ? TENSE_RATE.sum[t.cap] : TENSE_RATE[t.big ? 'big' : 'small'][t.hit ? 'hit' : 'miss'][t.cap];
      let r = Math.random();
      for (let i = 0; i < w.length; i++) { if (r < w[i]) { steps = i; break; } r -= w[i]; }
    }
    return steps > 0 ? { kind: t.kind, steps, hit: t.hit } : null;
  }
  /* 途中経過の合計: 金額のリールが止まるたびに「ここまでの合計」をリールの下のプレートに出し、止まるたびに高くなる音を鳴らす。
     合計方式（3本の金額を足す）をそのまま見せ場にする。金額がまだ出ていないとき（0 や NEXT STAGE だけ）は何も出さない */
  function runningSum(combo, order, kk) {
    if (typeof combo[order[kk]] !== 'number') return; // いま止まったのが金額のリールのときだけ
    let sum = 0, nums = 0;
    for (let i = 0; i <= kk; i++) { const x = combo[order[i]]; if (typeof x === 'number') { sum += x; nums++; } }
    if (!(sum > 0)) return;
    setPlate(sureShown ? 'spin sure' : 'spin', fmtN(sum), 'ここまでの合計');
    restart($('plateMain'), 'sumpop'); // 数字がぽんと出る
    Sfx.play('sumUp', nums - 1);
  }
  let tenseLv = 0;
  function tense(lv) {
    if (lv === tenseLv) return;
    tenseLv = lv;
    stageEl.classList.toggle('tense', lv > 0);
    if (lv > 0) stageEl.dataset.tense = String(lv); else delete stageEl.dataset.tense;
    Sfx.tension(lv);
    if (lv > 0) { Sfx.play('tenseUp', lv); restart(cabinet, 'thud'); FX.ring(CX, CY, STAGE_ACC[curStage], 470 + 50 * lv, 0.55); } // 光の輪は筐体のまわりだけ（画面いっぱいには広げない）
  }

  /* 3本リールを回す。結果 sym（金額 / 0 / 'NEXT'）は確定済み。ここで決めるのは見せ方だけ:
       組み合わせ … その結果になる3本の並びから、直近20回と被らないものを選ぶ
       止まる順番 … 6通りからランダム。ただし「最後の1本で結果が変わる」順番を優先（最後まで分からない）。
                    NEXT STAGE が1〜2本入る並びでは、NEXT STAGE のリールを先に止める
       惜しい絵柄 … 最後の1本が止まりかけで見せる絵柄は、先に止まった2本との合計が別の正規の結果になるもの
       停止時刻   … 1本目 → 2本目は一定間隔、3本目はその 1.5 倍。ステージが上がるごとに全体が 1.5 倍 */
  const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  function spinReel(st, sym, pat, extra) {
    const beats = [];
    extra = extra || {};
    pat = pat || { type: 'plain' };
    // 0% にしている FREE SPIN の種類は、絵柄も出さない（いま止めようとしている絵柄そのものは除く）
    const fr = extra.noFree ? [0, 0, 0, 0] : freeRates().concat([logoOn() ? 1 : 0]), off = Engine.FREE_SYMS.filter((s, i) => fr[i] <= 0 && s !== sym);
    const combos = off.length ? Engine.reelCombos(st, sym).filter((c) => !c.some((x) => off.indexOf(x) >= 0)) : Engine.reelCombos(st, sym);
    const usedC = Store.state.comboHist || [];
    let pool = combos.filter((c) => usedC.indexOf(st + ':' + c.join('/')) < 0);
    if (!pool.length) { // 候補が少なくて20回ぶん避けきれないときは、同じ結果の直近ぶん（候補数の半分まで）だけ避ける
      const keys = combos.map((c) => st + ':' + c.join('/'));
      const recent = usedC.filter((k) => keys.indexOf(k) >= 0).slice(-Math.floor(combos.length / 2));
      pool = combos.filter((c) => recent.indexOf(st + ':' + c.join('/')) < 0);
      if (!pool.length) pool = combos;
    }
    const combo = pool[Math.floor(Math.random() * pool.length)];
    // 止まる順番は NEXT STAGE → FREE SPIN → ハズレ（BAR）→ 金額。金額が当たる時は、金額のリールが最後に止まる（先にハズレ側が止まる）
    const rank = (s) => (s === 'NEXT' ? 0 : Engine.FREE_SYMS.indexOf(s) >= 0 ? 1 : typeof s === 'number' ? 3 : 2);
    const cand = ORDERS.filter((o) => rank(combo[o[0]]) <= rank(combo[o[1]]) && rank(combo[o[1]]) <= rank(combo[o[2]]));
    const deciding = cand.filter((o) => Engine.reelAlternatives(st, combo, o[2]).length > 0);
    const ordPool = deciding.length ? deciding : cand;
    const order = ordPool[Math.floor(Math.random() * ordPool.length)];
    const alts = Engine.reelAlternatives(st, combo, order[2]).filter((s) => off.indexOf(s) < 0);
    const nb = pat.type === 'seq' ? pat.pre + (pat.over ? 1 : 0) : pat.type === 'slip2' ? 2 : pat.type === 'slip' || pat.type === 'back' ? 1 : 0;
    const bait = [];
    for (let i = 0; i < nb; i++) bait.push(alts.length && Math.random() < 0.85 ? alts[Math.floor(Math.random() * alts.length)] : null);
    const p = Object.assign({}, pat, { bait });
    // 回る時間: STAGE 1 は 1本目 4.8秒 → 2本目 +3秒 → 3本目 +4.5秒（計 約12.3秒）。ステージが上がるごとに全体が 1.5 倍
    // （3本目が止まるまで: STAGE 1 約12.3秒 / STAGE 2 約18.5秒 / STAGE 3 約27.7秒）
    const kst = extra.fast ? 1 : st; // FREE SPIN は STAGE 1 の速さ
    p.timingStage = kst;
    const k = Math.pow(1.5, kst - 1);
    const iv = (pat.quick ? 0.7 : 3.0) * k;
    const first = (pat.quick ? 1.4 : 4.8) * k; // 1本目が止まるまで（回り出し＋減速ぶんを含む）
    let stops = [first, first + iv, first + iv + iv * 1.5];
    if (pat.reverse) { // 逆回転は回り始めて 5 秒後。逆回転してから、そのステージの通常と同じ時間（1本目・2本目・3本目の間隔もそのまま）をかけて止める
      p.reverse = EFFECT_DELAY_MS / 1000;
      stops = stops.map((x) => x + p.reverse);
    }
    // 期待の段階化: 先に止まる2本が「来るかも」の形のときだけ、3本目が回っている間に一段ずつ盛り上げる（結果は変えない）。
    // 確定演出（逆回転・画面が消える・虹）と重なる回では出さない
    const tn = extra.noTension || pat.reverse || pat.quick || puchunPlan || sureShown ? null : planTension(st, combo, order);
    if (tn) {
      p.gears = { from: stops[1], v: TENSE_V.slice(0, tn.steps), minGap: 1.1 }; // 一段ごとに 1.1 秒以上（足りなければ、3本目が止まるのを少し遅らせる）
      if (p.type === 'seq' && p.pre > 1) p.pre = 1; // 段階的な減速のあとの「止まりかけ」は 1 回だけ（重ねすぎると長く、くどくなる）
    }
    lastWindow = stops[2] - stops[1];
    const calm = () => { beats.forEach(clearTimeout); beats.length = 0; stageEl.classList.remove('reach'); $('dim').classList.remove('on'); $('content').querySelector('.spot').style.opacity = ''; };
    lastCombo = { st, read: sym, combo };
    try { Store.transact((s) => { s.comboHist = (s.comboHist || []).concat(st + ':' + combo.join('/')).slice(-20); }); } catch (err) { /* 記録のみ */ }
    return Reel.spin(st, combo, order, stops, p, {
      onStart: () => { Sfx.play('reelStart'); extra.onStart && extra.onStart(); },
      onTick: (n) => Sfx.tick(n),
      onSpeed: (n) => Sfx.spin(n),
      onNear: () => { extra.onNear && extra.onNear(); },
      onReverse: () => { Sfx.play('kyuin'); flash(true); quake(); stageEl.classList.add('reach'); setPlate('spin', 'REVERSE', '当選確定'); }, // 突然の逆回転（当たり確定）
      onReelStop: (ri, kk) => { if (kk < 2) { Sfx.play('stop'); restart(cabinet, 'thud'); runningSum(combo, order, kk); } if (kk === 1 && puchunPlan) { const pl = puchunPlan; puchunPlan = null; calm(); puchun(pl); } }, // 1本目・2本目の停止。2本目のあとにプチュン
      onGear: (g) => { if (tn) tense(g + 1); }, // 期待の段階が一段上がる（3本目が一段ゆっくりになる瞬間）
      onTease: (dur) => {
        Sfx.play('tease', dur);
        stageEl.classList.add('reach'); // 集中線で緊張感を出す
        $('content').querySelector('.spot').style.opacity = 1;
        if (st >= 2) for (let t = 0; t < dur - 0.2; t += st === 3 ? 0.5 : 0.62) beats.push(setTimeout(() => Sfx.play('heartbeat'), t * 1000));
        if (st === 3) $('dim').classList.add('on');
      },
      onStop: () => {
        beats.forEach(clearTimeout);
        tense(0);
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
    await wait(650);
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
    await wait(760); // チップが飛んできて着地するまで（CSS の chip-in と同じ長さ）
    Sfx.play('stamp');
    quake();
    flash(true);
    FX.ring(800, 450, STAGE_ACC[to], 1000, 0.9);
    // 重い処理が同じ瞬間に重ならないよう、少しずつずらして出す
    setTimeout(() => FX.burst(800, 450, fin ? 260 : 180, { max: 1300, life: 1.4, colors: STAGE_COL[to] }), 90);
    setTimeout(() => FX.streaks(800, 450, 100, 0.4, { colors: STAGE_COL[to] }), 220);
    await wait(hold);
  }
  async function hideStamp() { // チップはカメラ手前へ飛び去る
    const label = $('shutterLabel');
    label.classList.add('out');
    await wait(340);
    label.classList.remove('show', 'stamp', 'out', 'rainbow');
    stageEl.classList.remove('named');
  }

  /* 新しいステージに到着: 奥から飛び込むカメラ（指数減速）と同時に全体が弾ける */
  async function arrive(to, title) {
    const fin = to === 3, colors = STAGE_COL[to], ACC = STAGE_ACC[to];
    if (curStage !== to) setStage(to); else FX.setAmbient([0, 0, 14, 30][to], colors);
    const sure = pendingSure;
    if (sure) { pendingSure = false; announceSure(); }
    Sfx.play('open', fin);
    // 重い処理が同じ瞬間に重ならないよう、間を空けて1つずつ出す（虹の演出が出る回は、それが落ち着いてから）
    const d0 = sure ? 900 : 0, at = (ms, fn) => setTimeout(fn, d0 + ms);
    at(0, () => FX.ring(CX, CY, 'white', 1300, 1.0));
    at(200, () => FX.burst(CX, CY, fin ? 160 : 120, { max: 1700, life: 1.6, size: 26, colors }));
    at(450, () => { FX.ring(CX, CY, ACC, 1500, 1.2); if (!window.LITE) FX.streaks(CX, CY, fin ? 70 : 50, 0.7, { colors }); });
    if (!window.LITE) { // 軽量モードでは噴水・紙吹雪を省略
      at(720, () => [300, 1300].forEach((x) => FX.fountain(x, 930, fin ? 40 : 30, 0.6, colors)));
      at(980, () => FX.flakes(fin ? 60 : 40, 0.8, colors));
    }
    const y1 = RUNG_Y[to];
    at(1200, () => { FX.ring(180, y1, ACC, 260, 0.6); FX.burst(180, y1, 50, { max: 600, colors }); });
    if (title) { await wait(420); await stampStage(to, 380); await hideStamp(); await wait(80); }
    else await wait(d0 + 1500); // 新しいステージの画面をしっかり見せてから、次の回転へ
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
    const gap = n === 8 ? 360 : 480; // 扉1枚ごとの間（扉が閉まり切るのを見せる）
    const layers = buildDoors(n, rb ? DOOR_RGB.rainbow : fin ? DOOR_RGB.fin : null);
    $('doors').style.setProperty('--dt', n === 8 ? '.34s' : '.46s'); // 扉が閉まる速さ（8枚のときだけ少し速く）
    stageEl.classList.remove('opening', 'opening-slow', 'blast');
    stageEl.classList.toggle('fin', fin);
    await frame();

    fxMode(true);
    const content = $('content');
    // 閉門: 1枚ずつ叩きつける。下に隠れた扉は描画から外す（同時に描くのは最大2組）
    for (let i = 0; i < n; i++) {
      layers[i].pair.forEach((d) => d.classList.add('in'));
      if (i === 0) { Sfx.play('shutterClose'); await wait(480); } else { await wait(gap - 40); Sfx.play('slam', i / (n - 1)); await wait(40); }
      if (i >= 2) layers[i - 2].pair.forEach((d) => { d.style.display = 'none'; });
      quake();
      flash(true);
      seamSparks(layers[i].horiz, rb ? [RAINBOW[i % RAINBOW.length], 'white'] : colors);
    }
    // 閉まった衝撃の演出が終わるのを待ってから、扉の裏を非表示にして色を切り替え、描き直しが落ち着くのを待つ
    // （ステージの切り替えは重いので、ほかの演出と同じ瞬間に重ねない）
    await wait(280);
    content.style.visibility = 'hidden';
    setStage(to);
    await raf2();
    stageEl.classList.add('ceremony');
    await raf2();
    await wait(260);
    await stampStage(to, 700, rb);

    // 溜め（約2秒）: ドラムロール。継ぎ目の光が速く脈打ち、光が扉へ吸い込まれていく
    const roll = 2.1;
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
    await wait(120);
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
    setTimeout(() => { stageEl.classList.remove('blast'); $('doors').innerHTML = ''; }, 1100);
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

  /* 当選演出。金額ごとに1段ずつ強くなる（WIN_LEVELS の並び順がそのまま演出レベル 1〜8）。
     b59〜 当選額の「格」: 長さと派手さを、金額の帯ではっきり分ける。
       小（レベル 1〜2、〜1,000）   … ためなしで、あっさり約 2 秒
       中（レベル 3〜5、2,000〜5,000）… ため 1 秒 ＋ 約 2.5 秒（b58 までと同じ）
       大（レベル 6、10,000）        … ため 1.5 秒 ＋ 5.5 秒（約 7 秒）
       特大（レベル 7〜8、50,000〜） … 長いため ＋ 長いカウントアップ ＋ 花火と衝撃波が続く（約 11 秒） */
  const WIN_LEVELS = [500, 1000, 2000, 3000, 5000, 10000, 50000, 100000];
  const CHIP_LV = [['red'], ['blue', 'red'], ['green', 'red', 'blue'], ['black', 'green', 'blue'], ['purple', 'black', 'red'], ['gold', 'black', 'purple'], ['gold', 'black', 'white', 'purple'], ['gold', 'gold', 'black', 'white']];
  const WIN_FX = [
    //  ため(秒)    秒数  ラベル        粒子  金粉  花火間隔(秒)  揺れ回数  カウントアップ(秒)
    { charge: 0,   dur: 1.8, label: 'WIN',       burst: 70,  rain: 0,   fire: 0,    shake: 0, count: 0 },
    { charge: 0,   dur: 2.0, label: 'WIN',       burst: 110, rain: 0,   fire: 0,    shake: 0, count: 0 },
    { charge: 1.0, dur: 2.2, label: 'NICE WIN',  burst: 150, rain: 70,  fire: 0,    shake: 0, count: 0.5 },
    { charge: 1.0, dur: 2.5, label: 'BIG WIN',   burst: 190, rain: 130, fire: 0.7,  shake: 0, count: 0.6 },
    { charge: 1.0, dur: 2.8, label: 'BIG WIN',   burst: 230, rain: 200, fire: 0.5,  shake: 1, count: 0.7 },
    { charge: 1.5, dur: 5.5, label: 'SUPER WIN', burst: 280, rain: 420, fire: 0.45, shake: 2, count: 1.4 },
    { charge: 2.2, dur: 8.3, label: 'MEGA WIN',  burst: 340, rain: 700, fire: 0.42, shake: 4, count: 2.2 },
    { charge: 2.4, dur: 9.0, label: 'JACKPOT',   burst: 420, rain: 900, fire: 0.36, shake: 5, count: 2.6 },
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

    // ため（チャージ）: 周囲が暗くなり、カメラがリールへ寄っていく（指数的に加速）。光が中心へ吸い込まれる。
    // 小さい当たり（レベル 1〜2）はためを入れず、すぐ結果を出す。高額ほど長くためる
    const C = fx.charge;
    win.classList.add('win');
    cabinet.classList.add('party');
    if (C > 0) {
      cabinet.classList.add('tremble');
      $('dim').classList.add('on');
      fxMode(true);
      Sfx.play('riser', C);
      Sfx.play('warp');
      if (L >= 7) { Sfx.play('heartbeat'); later(0.7, () => Sfx.play('heartbeat')); } // 特大: 鼓動から始まる
      FX.converge(CX, CY, 140 + L * 20, C);
      FX.streaks(CX, CY, 80 + L * 10, C * 0.9, { inward: true, colors });
      [0.5, 0.75, 0.9].slice(0, L >= 6 ? 3 : L >= 3 ? 2 : 1).forEach((u) => later(u * C, () => { const an = Math.random() * 6.28; FX.lightning(CX + Math.cos(an) * 760, CY + Math.sin(an) * 460, CX, CY, 'white', 4); Sfx.play('zap'); }));
      await wait(C * 1000);

      // 爆発: カメラが一瞬で引いて戻り、放射状の稲妻が走る
      cabinet.classList.remove('tremble');
      if (L < 6) $('dim').classList.remove('on');
      quake();
      for (let i = 0; i < 4 + L; i++) { const an = (i / (4 + L)) * 6.28 + Math.random() * 0.4; FX.lightning(CX, CY, CX + Math.cos(an) * 900, CY + Math.sin(an) * 560, i % 2 ? STAGE_ACC[curStage] : 'white', 5); }
      FX.streaks(CX, CY, 100 + L * 12, 0.8, { colors });
    }
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
    else FX.chips(Math.round((30 + L * 14) * Math.max(1, fx.dur / 3)), fx.dur - 1.6, chipCols, { land: true, size: 22 }); // 長い演出では、そのぶん枚数を増やす
    if (L >= 6) {
      const founts = [];
      for (let t = 0.5; t < fx.dur - 1.2; t += L >= 7 ? 1.5 : 2.2) founts.push(t); // 大・特大: 演出の間じゅう、左右からチップが噴き上がる
      founts.forEach((t) => later(t, () => {
        FX.chipFountain(240, 930, 22, 0.8, chipCols, { land: true, vx: 220 });
        FX.chipFountain(1360, 930, 22, 0.8, chipCols, { land: true, vx: -220 });
        Sfx.play('chipfall', 1.2);
      }));
    }
    if (L >= 3) FX.cards(6 + L * 2, 0.5, { x: CX, y: CY });
    if (L >= 5) FX.flakes(Math.round(L * 8 * Math.max(1, fx.dur / 3)), fx.dur - 1.5, colors);
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
        Sfx.play('impact');
        flash(false);
        restart(cabinet, 'shake');
        FX.ring(CX, CY, 'white', 1300, 0.9);
        FX.burst(CX, CY, 260, { max: 1500, life: 2, size: 28, colors });
      });
    }

    // 連続フラッシュ・途中の暗転 → 再点火・締めの一撃
    if (L >= 4) for (let t = 1.0; t < fx.dur - 1.2; t += L >= 6 ? 1.1 : 0.8) later(t, () => flash(true)); // 長い演出では間隔を空ける（ちかちかさせない）
    if (L === 7) later(5.0, () => Sfx.play('win', 6)); // 特大: ファンファーレをもう一度（レベル 8 は元の音が最後まで続く）
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
          '<li><b>FREE SPIN ×1・×2・×3 が3本そろう</b>と、右上の <b>CREDIT</b> が 1・2・3 増え、その回数だけ自動でまわります。そろわなかったときは 0 として合計します。</li>' +
          '<li><b>casa のロゴが3本そろう</b>と <b>10 FREE SPIN</b> を獲得し、右上の <b>CREDIT</b> が 10 増えます。CREDIT が残っている間は、<b>自動で回り続けます</b>（1回ごとに 1 減ります）。FREE SPIN は毎回 STAGE 1 から始まり、どのステージでも STAGE 1 と同じ速さで回ります。</li>' +
          '<li>金額が当たるときは、金額のリールが最後に止まります。3本目は少し長く回ります。</li>' +
          '<li>先に止まった2本がそろいかけた時や、合計が大きい時は、3本目が回っている間に<b>音と光が一段ずつ強くなり、回転がゆっくりになる</b>ことがあります。</li></ul>' +
          '<h5>ゲームの流れ</h5><ol>' +
          '<li><b>NEXT GAME</b> を押すだけ。あとは自動で進みます。</li>' +
          '<li>STAGE 1 → STAGE 2 → STAGE 3 の順に上がり、上のステージほど大きな金額が出ます。STAGE 3 が最後です。</li>' +
          '<li>結果が出たら左下の <b>LAST</b> と右の<b>配当履歴</b>に記録され、右上の合計にも足されます。</li>' +
          '<li>もう一度 <b>NEXT GAME</b> で次のゲームへ。</li></ol>' +
          '<h5>当たる金額</h5><p>金額はランダムです。' + Engine.STAGE_DEFS.map((d) => 'STAGE ' + d.stage + ' は最大 <b>' + fmtN(Math.max.apply(null, d.values)) + '</b>').join('、') + '。</p>' +
          '<h5>演出について</h5><ul>' +
          '<li>止まりかけてから、もう1コマ滑ったり戻ったりすることがあります。最後の1本が止まるまで結果は分かりません。</li>' +
          '<li><b>ONE MORE CHANCE</b> が出たら、自動でもう一度回ります。</li>' +
          '<li><b>リールが突然、逆回転を始めたら当選が確定</b>です。</li>' +
          '<li><b>画面が突然消えたり白く光ったりしたら、当選が確定</b>です（必ず金額が当たります）。戻ったときに画面全体が虹色なら大きな当たりです。</li>' +
          '<li>ゲームの最初にいきなり <b>STAGE 2 / STAGE 3</b> から始まることがあります（<b>WARP</b>）。このときも当選が確定しています。</li></ul>' +
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
  const storeMode = () => Cloud.enabled && !cloudDown && !!(Store.state && Store.state.store); // 起動直後（状態の読み込み前）に呼ばれても落ちない（b75）
  let cloudPresets = {};   // 配布されたプリセット { id: { name, probs, limits } }
  let cloudStore = null;   // 店舗ドキュメントの最新
  let updSeen = null;      // この端末が見た、マスターの「いますぐアップデート」の時刻（最初に読んだ値は実行しない）
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
  /* 配当表（確率表に書かれた金額）を、エンジン・リールの絵柄・画面下の MAX 表示に反映する。
     起動時と、確率が変わったとき（プリセットの切り替え・端末での変更）に呼ぶ。金額の一覧が同じなら何もしない。 */
  let tableSig = null;
  function syncTable(force) {
    const probs = Store.state.probs, sig = JSON.stringify(Engine.tableOf(probs).map((d) => d.values));
    if (!force && sig === tableSig) return;
    tableSig = sig;
    const T = Engine.setTable(probs), pays = [];
    T.forEach((d) => d.values.forEach((v) => { if (v > 0 && pays.indexOf(v) < 0) pays.push(v); }));
    Reel.setTable(Engine.REEL_SYMS, pays);
    // 最下段: ステージごとの最大金額だけを見せる（内訳は見せない）
    const pt = $('paytable');
    if (pt) {
      const on = pt.querySelector('.ps.on'), cur = on && on.dataset.s;
      pt.innerHTML = T.map((d) => { const mx = Math.max.apply(null, d.values); return '<div class="ps' + (cur === String(d.stage) ? ' on' : '') + '" data-s="' + d.stage + '"><em>STAGE ' + d.stage + '</em><span><i>MAX</i><b class="amt lv' + Math.max(1, WIN_LEVELS.filter((x) => x <= mx).length) + '">' + fmtN(mx) + '</b></span></div>'; }).join('');
    }
  }
  /* 配布されたプリセットを端末の確率・制限に反映（結果には「次のプレイから」効く） */
  /* 設定に誤りのあるプリセット（確率の合計が 100% でない、金額が多すぎる等）は使えない。b70 までは黙って前の設定のまま動いていた
     （本番で RING の STAGE 3 が 185% になっていて、渋谷が TEST のまま動いていた）。b71 から、画面に一言出して、設定画面に理由を出す */
  let presetWarn = null, presetWarnSig = '';
  function applyPreset(p) {
    if (!p) return;
    const v = p.probs ? Engine.validateProbs(p.probs) : { ok: false, errors: ['確率表がありません。'] };
    if (!v.ok) {
      presetWarn = { id: p.id, name: String(p.name || ''), errors: v.errors.slice() };
      const sig = p.id + '|' + v.errors.join('|');
      if (sig !== presetWarnSig) { presetWarnSig = sig; try { UI.toast('プリセット「' + presetWarn.name + '」は設定に誤りがあるため使えません。前の設定のまま動きます（設定画面に詳細）。', 'err'); } catch (err) { /* 表示のみ */ } }
      if (Admin.isOpen()) Admin.rerender();
      return;
    }
    presetWarn = null; presetWarnSig = '';
    const same = JSON.stringify(Store.state.probs) === JSON.stringify(p.probs) && JSON.stringify(Store.state.limits) === JSON.stringify(Object.assign({ on: false, total: 0, max: {}, resetHour: 19 }, p.limits || {}));
    const num = (v, d) => (typeof v === 'number' ? v : d);
    const fr = [num(p.freeRate, FREE_DEFAULTS[0]), num(p.freeRate2, FREE_DEFAULTS[1]), num(p.freeRate3, FREE_DEFAULTS[2])], test = !!p.test, lg = num(p.logoRate, 0), noRe = p.noRetrigger !== false;
    const st0 = Store.state;
    const pname = String(p.name || '').slice(0, 20), pcolor = /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : ''; // 画面に出すプリセット名と、その色（マスターで選ぶ）
    if (same && st0.presetId === p.id && st0.freeRate === fr[0] && st0.freeRate2 === fr[1] && st0.freeRate3 === fr[2] && !!st0.testMode === test && (st0.logoRate || 0) === lg && (st0.noRetrigger !== false) === noRe && st0.presetName === pname && (st0.presetColor || '') === pcolor) return;
    try {
      Store.transact((s) => {
        s.probs = JSON.parse(JSON.stringify(p.probs));
        s.limits = Object.assign({ on: false, total: 0, max: {}, resetHour: 19 }, p.limits || {});
        s.presetId = p.id;
        s.freeRate = fr[0]; s.freeRate2 = fr[1]; s.freeRate3 = fr[2]; s.logoRate = lg; s.noRetrigger = noRe;
        s.testMode = test;
        s.presetName = pname; s.presetColor = pcolor;
        Store.log('PRESET_APPLY', { id: p.id, name: p.name });
      });
    } catch (err) { /* 保存のみ */ }
    syncTable();
    showCredits(); // プリセット名と、TEST の帯（#stage.testmode）をその場で描き直す。b69 までは showPreset() だけで、帯は次の描き直しまで前のプリセットのまま残っていた
    if (Admin.isOpen()) Admin.rerender();
  }
  /* いま使っているプリセットの名前を、左上（casa のエンブレムの右）に出す。色はマスターのプリセット編集で選んだ色。店舗モードのときだけ */
  function showPreset() {
    const el = $('presetTag'), s = Store.state;
    if (!el) return;
    const nm = s.store && s.presetName ? s.presetName : '';
    el.hidden = !nm;
    el.querySelector('b').textContent = nm;
    if (s.presetColor) el.style.setProperty('--pc', s.presetColor); else el.style.removeProperty('--pc');
  }
  /* オフラインの見張り（b74）: 30 秒ごとに version.json を取りに行き、2 回続けて取れなければオフラインとみなす。navigator.onLine が false のときも即オフライン。
     オフラインの間は、当たりを出さない（上の startPlay）。模擬（'local'）と店舗モード以外は常にオンライン扱い。
     取れた中身が JSON で v があることまで確かめる（オフライン時に service worker が index.html を返してくることがあるため） */
  let netOk = true, netFail = 0;
  async function netCheck() {
    if (!Store.state || !storeMode() || Cloud.isLocal) { netOk = true; netFail = 0; return; }
    if (navigator.onLine === false) { netOk = false; return; }
    try {
      const c = typeof AbortController === 'function' ? new AbortController() : null, t = c && setTimeout(() => c.abort(), 5000);
      // Fire TV のアプリでは、画面のファイルはアプリの中（appassets）から読むので、相対の version.json はネットが無くても取れてしまう。
      // 公開先（GitHub Pages）の version.json を直接取りに行く（b77）。iPad などはいつもどおり同じ場所の version.json
      const probe = location.hostname === 'appassets.androidplatform.net' ? 'https://rhtcinema-boop.github.io/casa-slot-button/version.json' : 'version.json';
      const r = await fetch(probe + '?t=' + Date.now(), Object.assign({ cache: 'no-store', mode: 'cors' }, c ? { signal: c.signal } : {}));
      if (t) clearTimeout(t);
      const j = r.ok ? await r.json() : null;
      if (j && j.v) { netFail = 0; netOk = true; return; }
    } catch (err) { /* 取れなかった */ }
    netFail += 1;
    if (netFail >= 2) netOk = false;
  }
  const netState = () => netOk;
  function startCloudSync() {
    const me = Store.state.store;
    if (!me) return;
    const beat = () => Cloud.updateStoreFields(me.id, { lastSeen: Date.now(), deviceVersion: APP_V }).catch(() => {}); // 版は起動直後に控えた APP_V（起動画面の #ver はあとで消えるので、ここで読むと空になる＝b69 までマスターの一覧に版が出なかった）
    beat(); setInterval(beat, 10 * 60 * 1000);
    startFeed();
    unwatch = Cloud.watchStore(me.id, (doc) => {
      if (!doc) return unbindStore('この店舗はマスターで削除されました。');
      if (doc.logoutAt && doc.logoutAt > me.boundAt) return unbindStore();
      cloudStore = doc;
      { // 待機中に左側へ出す説明（マスターの店舗の編集で入力。3つまで）。変わったら端末に覚えて、すぐ画面に反映する
        const nt = (Array.isArray(doc.notes) ? doc.notes : []).map((x) => String(x || '').slice(0, 80)).filter(Boolean).slice(0, 3);
        const sid = Store.state.store && Store.state.store.id;
        if (JSON.stringify(nt) !== JSON.stringify(Store.state.notes || []) || Store.state.notesFor !== sid) { try { Store.transact((s) => { s.notes = nt; s.notesFor = sid; }); } catch (err) { /* 保存のみ */ } showNotes(); }
      }
      // マスターの「全店舗をいますぐアップデート」: 押された時刻（updateAt）が新しくなったら、すぐに新しい版を確認する。
      // 新しい版があれば、待機中ならすぐ、ゲーム中ならそのゲームが終わり次第、読み直す（updWatch）
      if (updSeen === null) updSeen = doc.updateAt || 0;
      else if ((doc.updateAt || 0) > updSeen) { updSeen = doc.updateAt; autoUpdate(true); }
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
  const storeInfo = () => ({ store: Store.state.store, presets: (cloudStore && cloudStore.presetIds || []).map((id) => cloudPresets[id]).filter(Boolean), activeId: Store.state.presetId || (cloudStore && cloudStore.activePresetId) || null, warn: presetWarn, appliedName: Store.state.presetName || '' });

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
    setInterval(() => { creditWatch(); idleWatch().catch(() => {}); attractWatch(); updWatch(); recentWatch(); reelWatch(); }, 500);
    // リールの描き直し（b76）: 画面が戻ってきたとき・大きさが変わったときに、いま見えているべき絵柄を描き直す
    document.addEventListener('visibilitychange', () => { if (!document.hidden) Reel.redraw(); });
    window.addEventListener('pageshow', () => Reel.redraw());
    window.addEventListener('focus', () => Reel.redraw());
    window.addEventListener('resize', () => setTimeout(() => Reel.redraw(), 100));
    netCheck(); setInterval(netCheck, 30 * 1000); // オフラインの見張り（b74）
    window.addEventListener('offline', () => { netOk = false; });
    window.addEventListener('online', () => { netFail = 0; netCheck(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) autoUpdate(); }); // アプリに戻ってきたときに新しい版を確認
    setInterval(() => { autoUpdate(); }, UPDATE_CHECK_MS);                                          // 開きっぱなしでも 1 時間に 1 回確認
    if (window.__autoUpdate) window.__autoUpdate.then((st) => { if (newerOnDisk(st)) updPending = true; });
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
    buildEdges();
    FX.init($('fx'));
    Reel.init($('reel'));
    $('shutterLabel').innerHTML = '<div class="medal"><div class="face front"><small>STAGE</small><b>2</b><em></em></div></div>'; // 平面1枚（立体の層は重いので廃止）
    lockbar.addEventListener('click', onLockbar);
    initSecret();
    initHelp();
    // 画面下: 各ステージの最大金額（配当表から作る）
    syncTable(true);
    buildLightSprites();
    applyPerf();
    setStage(1);
    refresh();
    // 前回起動したときより版が上がっていたら知らせる（自動・手動どちらのアップデートでも）
    let updated = false;
    try { const k = 'casa-slot-button.ver', prev = localStorage.getItem(k); updated = !!prev && verNum(APP_V) > verNum(prev); localStorage.setItem(k, APP_V); } catch (err) { /* 保存できない環境 */ }
    await new Promise((resolve) => {
      const sp = $('splash');
      if (updated) { const m = document.createElement('p'); m.className = 'upd'; m.textContent = '✓ 新しいバージョン ' + APP_V + ' にアップデートしました'; sp.querySelector('.splash-in').appendChild(m); }
      let gone = false;
      const go = (byUser) => {
        if (gone) return;
        gone = true;
        if (byUser) { Sfx.unlock(); Sfx.play('ok'); }
        sp.classList.add('bye');
        setTimeout(() => sp.remove(), 600);
        resolve();
      };
      sp.addEventListener('click', () => go(true));
      // 待機中に自動アップデートで読み直したときは、起動画面を自動で閉じて待機画面に戻る
      let skip = false;
      try { skip = sessionStorage.getItem('casa.skipSplash') === '1'; sessionStorage.removeItem('casa.skipSplash'); } catch (err) { /* 保存できない環境 */ }
      if (skip) setTimeout(() => go(false), 2200);
    });
    if (updated) UI.toast('新しいバージョン ' + APP_V + ' にアップデートしました。', 'ok');
    if (Cloud.enabled) {
      try { await Cloud.ready(); } catch (err) { cloudDown = true; UI.toast('クラウドに接続できません。端末内の設定で動作します。', 'err'); }
      if (!cloudDown && !Store.state.store) { await chooseStore(); refresh(); }
      if (!cloudDown && Store.state.store) startCloudSync();
      if (!Store.state.pins) { await firstRun(); refresh(); } // クラウド無しで使うときは従来どおり端末の PIN
    } else if (!Store.state.pins) { await firstRun(); refresh(); }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !(window.TV && TV.isTV)) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
  return { refresh, applyPerf, syncTable, openSettings: () => openSettings && openSettings(), storeMode, storeInfo, choosePreset, logoutStore, calibrate, screenInfo, netState };
})();
window.Game = Game;
