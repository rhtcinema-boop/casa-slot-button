/* スマホの紙幣ページ（b83〜）。スタッフのスマホで開き、店舗にログインしておく。
   紙幣を上にスライドすると、クラウド（stores/{id}/inserts）に 1 件書く → 店舗の端末がお札の演出をして回す。
   端末からの返事（state: 'ok' / 'busy'）を見て「投入しました」「ゲーム中」を出す。返事が無ければ 5 秒で「届きませんでした」。
   b91: casa SLOT のロゴ 5 回タップで、端末の設定画面と同じ項目を遠隔で操作する（stores/{id}/cmds に指示を書き、端末が実行して返事を書く。
        端末の状態は店舗ドキュメントの stat（端末が 1 分ごと・変化時に書く）を見て表示する） */
(function () {
  'use strict';
  const KEY = 'casa-slot-bill.v1';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (n) => (Number(n) || 0).toLocaleString('ja-JP');
  let saved = null;      // { storeId, name, phone, seq, check }  check = いま入力されている会計番号（b97）
  let storeDoc = null;   // 店舗ドキュメントの最新（phase / stat を見る）
  let unwatchStore = null, sending = false, lastSent = 0, armed = true;
  let meter = null; // b101: ハズレメーター（全店舗共有）。スタッフには残り回数も見せる
  const meterText = () => { if (!meter || !meter.enabled) return ''; if (meter.superLeft > 0) return '★ SUPER MODE 残り ' + meter.superLeft + ' 回'; const left = Math.max(0, (meter.target || 300) - (meter.miss || 0)); return 'SUPER METER あと ' + left + ' 回で満タン'; };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* noop */ } };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); // b99: 圏外で永久に待たない
  let deleted = false; // b99: 店舗がマスターで削除された
  const phoneId = () => { const s = load(); if (s && s.phone) return s.phone; return 'p' + Math.random().toString(36).slice(2, 10); };

  /* ---------- 音と振動 ---------- */
  let ac = null;
  function unlockAudio() { try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { ac = null; } }
  function beep(ok) {
    if (!ac) return;
    try {
      const t = ac.currentTime;
      const mk = (type, f, f2, at, d, g) => { const o = ac.createOscillator(), gn = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t + at); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + at + d); gn.gain.setValueAtTime(0.0001, t + at); gn.gain.exponentialRampToValueAtTime(g, t + at + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + at + d); o.connect(gn); gn.connect(ac.destination); o.start(t + at); o.stop(t + at + d + 0.05); };
      if (ok) { mk('sawtooth', 110, 160, 0, 0.5, 0.08); mk('sine', 660, 0, 0.5, 0.12, 0.18); mk('sine', 880, 0, 0.62, 0.25, 0.18); }
      else { mk('square', 180, 0, 0, 0.12, 0.12); mk('square', 140, 0, 0.16, 0.2, 0.12); }
    } catch (e) { /* 音は無くてもよい */ }
  }
  const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* noop */ } };

  /* ---------- 画面 ---------- */
  function drawBill() {
    const n = (saved && saved.seq) || 0;
    $('bill').innerHTML = BillArt.svg(470, { serial: 'C ' + String(10000000 + n).slice(1) + ' A' });
    layoutBill();
  }
  function setMsg(text, cls) { const m = $('msg'); m.textContent = text || ''; m.className = 'msg' + (cls ? ' ' + cls : ''); }
  const isStale = () => !storeDoc || !storeDoc.lastSeen || Date.now() - storeDoc.lastSeen > 25 * 60 * 1000; // 生存報告は 10 分ごと
  function render() {
    const st = $('store'), bill = $('bill'), hint = $('hint');
    const door = doorPhase(); // b108: 端末が扉を選ぶのを待っている
    const busy = !!(storeDoc && storeDoc.phase === 'busy') || !!door;
    if (!saved) return;
    showDoor(door && !deleted && !isStale() ? door : null);
    if (deleted) { st.className = 'store off'; $('storeText').textContent = saved.name + ' はマスターで削除されました'; }
    else if (!storeDoc) { st.className = 'store off'; $('storeText').textContent = saved.name + ' … 接続中'; }
    else if (isStale()) { st.className = 'store off'; $('storeText').textContent = saved.name + ' の端末が見つかりません'; }
    else if (busy) { st.className = 'store busy'; $('storeText').textContent = saved.name + (door ? ' の端末は扉を選んでいます' : ' の端末はゲーム中'); }
    else { st.className = 'store'; $('storeText').textContent = saved.name + ' の端末につながっています'; }
    armed = !busy && !sending && !deleted && !isStale(); // b99: 端末が見つからないときも入れない
    bill.classList.toggle('gray', busy || deleted || isStale());
    hint.classList.toggle('busy', !armed);
    const chk = $('chk');
    if (saved.check) { chk.classList.remove('hidden'); chk.innerHTML = '会計 No.<b>' + esc(saved.check) + '</b>' + (saved.stage ? '<span class="stg s' + saved.stage + '">STAGE ' + saved.stage + '</span>' : ''); } else chk.classList.add('hidden');
    ['acc', 'bill', 'hint'].forEach((id) => { const el = $(id); [1, 2, 3].forEach((n) => el.classList.toggle('s' + n, saved.stage === n)); }); // b107: 選んだステージの色
    if (!$('adm').classList.contains('hidden')) renderAdmIfChanged();
  }

  /* ---------- 3つの扉（b108） ----------
     端末が当たりの回を扉で見せるとき、店舗ドキュメントの phase が 'door|会計番号|ステージ' になる。その間は画面いっぱいに扉を 3 つ出し、
     タップした扉を端末に送る（cmds の type 'door'）。端末が扉を開けると phase が戻るので、扉の画面を閉じる */
  function doorPhase() {
    const ph = storeDoc && typeof storeDoc.phase === 'string' ? storeDoc.phase : '';
    if (ph.indexOf('door') !== 0) return null;
    const a = ph.split('|');
    return { key: ph + '@' + (storeDoc.phaseAt || 0), check: a[1] || '', stage: Number(a[2]) || 0 };
  }
  let doorKey = '', doorSent = false;
  function showDoor(d) {
    const old = $('doorpick');
    if (!d) { if (old) old.remove(); doorKey = ''; doorSent = false; return; }
    if (old && doorKey === d.key) return;
    if (old) old.remove();
    doorKey = d.key; doorSent = false;
    const w = document.createElement('div'); w.id = 'doorpick';
    let cf = '';
    const cols = ['#ffd040', '#ff4040', '#fff', '#40c0ff', '#ff80d0', '#80ff80'];
    for (let k = 0; k < 24; k++) cf += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;animation-delay:-' + (Math.random() * 4).toFixed(2) + 's;background:' + cols[k % 6] + '"></i>';
    w.innerHTML = '<div class="rays"></div><div class="cf">' + cf + '</div><div class="dwrap"><div class="top">casa SLOT</div><div class="tag">DOOR CHANCE!</div><h1>扉をタップ</h1>' +
      '<div class="doors">' + [0, 1, 2].map((i) => '<button class="dr" data-i="' + i + '"><b class="q">?</b><em>' + (i + 1) + '</em><i></i></button>').join('') + '</div>' +
      '<p class="dmsg" id="dmsg"></p>' +
      (d.check || d.stage ? '<div class="foot">' + (d.check ? '会計 No. <b>' + esc(d.check) + '</b>' : '') + (d.stage ? '<span>STAGE ' + d.stage + '</span>' : '') + '</div>' : '') + '</div>';
    document.body.appendChild(w);
    buzz([30, 40, 30]);
    w.querySelector('.doors').onclick = (e) => { const b = e.target.closest('.dr'); if (b) sendDoor(Number(b.dataset.i), b); };
  }
  async function sendDoor(i, btn) {
    if (doorSent || !saved) return;
    doorSent = true; unlockAudio(); buzz(40);
    const w = $('doorpick'), key = doorKey;
    if (w) w.classList.add('sent');
    btn.classList.add('tap');
    const msg = (t) => { const m = $('dmsg'); if (m) m.textContent = t || ''; };
    const fail = (t) => { if (doorKey !== key) return; doorSent = false; btn.classList.remove('tap'); if (w) w.classList.remove('sent'); msg(t); buzz([80, 60, 80]); };
    msg('');
    let id = null;
    try { id = await withTimeout(Cloud.pushCmd(saved.storeId, { ts: Date.now(), phone: saved.phone, type: 'door', data: { i } }), 8000); }
    catch (e) { fail('送れませんでした。通信を確認してもう一度タップ'); return; }
    let done = false;
    const un = Cloud.watchCmd(saved.storeId, id, (d) => {
      if (done || !d || d.state === 'new') return;
      done = true; un();
      if (d.state === 'ok') { beep(true); return; } // 扉の画面は phase が戻ったら閉じる
      fail(d.reason === 'nodoor' ? '扉はもう開いています' : 'もう一度タップしてください');
    });
    setTimeout(() => { if (!done) { done = true; un(); fail('端末から返事がありません。もう一度タップ'); } }, 8000);
  }

  /* ---------- 紙幣の大きさと置き場所 ---------- */
  const setY = (y) => { $('bill').style.setProperty('--y', y + 'px'); };
  const geo = { bh: 0, bw: 0, restTop: 0 };
  function layoutBill() {
    const clip = $('feedClip'), bill = $('bill'), svg = bill.querySelector('svg');
    const H = window.innerHeight, clipH = clip.clientHeight;
    let bw = Math.min(Math.round(H * 0.9 / 2.35), window.innerWidth - 76); // b99: 狭い画面ではサンドの枠（+60、外枠 +14）が画面に収まる幅まで
    const bh = Math.round(bw * 2.35); bw = Math.round(bw);
    geo.bh = bh; geo.bw = bw; geo.restTop = Math.max(60, Math.round(clipH - bh * 0.62));
    { // b99: 三角とメッセージは紙幣の上端を基準に（小さい画面で紙幣に重ならない）
      const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
      const billTop = clip.getBoundingClientRect().top + geo.restTop;
      const hintTop = Math.max(sat + 200, billTop - 116);
      $('hint').style.top = hintTop + 'px'; $('msg').style.top = (hintTop + 66) + 'px';
    }
    bill.style.width = bw + 'px'; bill.style.height = bh + 'px'; bill.style.top = geo.restTop + 'px';
    if (svg) { svg.setAttribute('width', bh); svg.setAttribute('height', bw); svg.style.width = bh + 'px'; svg.style.height = bw + 'px'; svg.style.left = (bw / 2 - bh / 2) + 'px'; svg.style.top = (bh / 2 - bw / 2) + 'px'; }
    $('acc').style.setProperty('--w', (bw + 60) + 'px'); // サンドの幅は紙幣に合わせる
  }
  function initSwipe() {
    const bill = $('bill'), clip = $('feedClip');
    let y0 = 0, dy = 0, dragging = false, pid = null;
    // b94: 指で動かせるのは口の手前（溝の 100px 下）まで。そこまでの半分を越えて離すと投入。入る動きはテレビと同じ（せり上がる → 一拍 → 吸い込み）
    const stopY = () => Math.min(-40, -(geo.restTop - 100)); // b99: 画面が低くても必ず上に動かせる
    const need = () => Math.max(24, -stopY() * 0.5);
    clip.addEventListener('pointerdown', (e) => { // 紙幣の周り（枠の中）どこを触ってもよい
      unlockAudio();
      if (dragging) return; // b99: 2 本目の指は無視
      if (!armed) { buzz(40); touchMsg(); return; } // b99: iPhone は振動しないので文字でも知らせる
      dragging = true; pid = e.pointerId; y0 = e.clientY; dy = 0;
      bill.classList.add('drag'); bill.classList.remove('back', 'enter', 'suck');
      try { clip.setPointerCapture(pid); } catch (x) { /* noop */ }
    });
    clip.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pid) return;
      dy = Math.max(stopY(), Math.min(0, e.clientY - y0)); // 上方向だけ、口の手前で止まる
      setY(dy);
      $('acc').classList.toggle('hot', -dy > need());
    });
    const end = (e) => {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false;
      bill.classList.remove('drag');
      $('acc').classList.remove('hot');
      if (-dy > need()) insert();
      else { bill.classList.add('back'); setY(0); }
    };
    clip.addEventListener('pointerup', end);
    clip.addEventListener('pointercancel', (e) => { if (!dragging || e.pointerId !== pid) return; dragging = false; bill.classList.remove('drag'); $('acc').classList.remove('hot'); bill.classList.add('back'); setY(0); }); // b99: OS に取られたときは投入しない
    clip.addEventListener('pointerup', unlockAudio);
    window.addEventListener('resize', layoutBill);
  }

  /* ---------- 投入 ---------- */
  async function insert() {
    const bill = $('bill');
    staleCheck();
    if (!armed || sending || Date.now() - lastSent < 3000 || !saved.check || !saved.stage) { bill.classList.add('back'); setY(0); if (!saved.check || !saved.stage) gameStart(); else if (Date.now() - lastSent < 3000) setMsg('少し待ってからもう一度', 'err'); return; }
    const who = { storeId: saved.storeId, phone: saved.phone, check: saved.check, stage: saved.stage }; // b99: 途中で「終了」やログアウトをされても、この 1 枚の値は変えない
    sending = true; lastSent = Date.now();
    render();
    const target = -(geo.restTop + geo.bh + 16); // 紙幣が口の中へ完全に入る位置
    // b94: テレビと同じ動き。指を離した位置からせり上がり、口の手前で一拍止まってから、奥へ吸い込まれる（約 2.2 秒）
    const startY = parseFloat(getComputedStyle(bill).getPropertyValue('--y')) || 0;
    const yMouth = -geo.restTop; // 紙幣の上端が溝に届く位置
    const tx = (y, s) => 'translateX(-50%) translateY(' + y + 'px) scale(' + s + ')';
    bill.classList.add('drag'); bill.classList.remove('back', 'enter', 'suck');
    $('acc').classList.add('feeding');
    buzz([20, 30, 20, 30, 60]);
    setMsg('');
    try {
      const anim = bill.animate([
        { transform: tx(startY, 1), filter: 'brightness(1)', offset: 0 },
        { transform: tx(yMouth + 40, 1), filter: 'brightness(1)', offset: 0.35 },
        { transform: tx(yMouth + 26, 1), filter: 'brightness(1)', offset: 0.55 },
        { transform: tx(yMouth + 22, 1), filter: 'brightness(1)', offset: 0.62 },
        { transform: tx(target, 0.94), filter: 'brightness(.6)', offset: 1 },
      ], { duration: 2200, easing: 'cubic-bezier(.3, .05, .3, 1)', fill: 'forwards' });
      await anim.finished; anim.cancel();
    } catch (e) { /* 古いブラウザ: 動きなしで続ける */ }
    setY(target); bill.style.setProperty('--s', '.94'); bill.style.setProperty('--b', '.6');
    $('acc').classList.remove('feeding');
    if (saved) { saved.seq = (saved.seq || 0) + 1; save(); }
    const seq = (saved && saved.seq) || 0;
    let id = null;
    let sent = null;
    try { const r = await withTimeout(Cloud.pushInsertNow(who.storeId, { ts: Date.now(), phone: who.phone, seq, check: who.check, stage: who.stage }), 8000); id = r.id; sent = r.sent; }
    catch (e) { finish(false, navigator.onLine === false ? '通信できません。電波を確認してもう一度' : '届きませんでした。通信を確認してもう一度'); return; }
    let slow = false; // b105: 書き込みが 8 秒で終わらないときは「確認中」にして、返事を待ち続ける（あとから届いて二重に入るのを防ぐ）
    withTimeout(sent, 8000).catch(() => { if (!done) { slow = true; setMsg('通信が遅れています… 届いたら自動で反映されます（もう一度入れないでください）', 'err'); } });
    let done = false;
    const un = Cloud.watchInsert(who.storeId, id, (d) => {
      if (done || !d || d.state === 'new') return;
      done = true; un();
      if (d.state === 'ok') finish(true, '投入しました。ゲームが始まります');
      else finish(false, { credit: '端末は FREE SPIN（無料回転）の消化中です。終わってからもう一度', settings: '端末で設定画面が開いています。閉じてからもう一度', update: '端末が更新中です。少し待ってからもう一度', stale: '届くのが遅すぎました（スマホか端末の時計がずれています）', nobill: 'この店舗は紙幣モードが OFF です（マスターで ON にしてください）' }[d.reason] || 'ゲーム中のため入りませんでした。終わってからもう一度');
    });
    const giveUp = () => { if (done) return; if (slow && Date.now() - lastSent < 40000) { setTimeout(giveUp, 2000); return; } done = true; un(); finish(false, slow ? '届きませんでした（端末は 30 秒より古い紙幣を受け付けません）。もう一度入れてください' : '端末から返事がありません。端末の画面と通信を確認してください'); };
    setTimeout(giveUp, 9000); // b99: 端末の片付け待ち（最長 5 秒）＋往復分。b105: 通信が遅いときは最長 40 秒まで待つ
  }
  let msgTimer = 0;
  function touchMsg() { // 触ったのに動かないときの理由（1.5 秒）
    const t = sending ? '送信中です' : deleted ? '店舗が削除されています' : isStale() ? '端末が見つかりません' : doorPhase() ? '端末で扉を選んでいます' : (storeDoc && storeDoc.phase === 'busy') ? '端末はゲーム中です' : '';
    if (!t) return; setMsg(t, 'err'); clearTimeout(msgTimer); msgTimer = setTimeout(() => setMsg(''), 1500);
  }
  function finish(ok, text) {
    const bill = $('bill');
    clearTimeout(msgTimer);
    setMsg('');
    if (!ok) showFail(text); // b107: 入らなかったときは画面いっぱいに赤で（入ったときは文字なし）
    beep(ok);
    if (ok) buzz([20, 30, 60]); else buzz([80, 60, 80]);
    setTimeout(() => {
      sending = false;
      drawBill();
      bill.classList.remove('suck', 'back', 'enter');
      bill.classList.add('drag'); setY(ok ? geo.bh : -(geo.restTop + geo.bh)); // 次の紙幣は下から（失敗は口から戻る）
      bill.style.setProperty('--s', '1'); bill.style.setProperty('--b', '1');
      void bill.offsetHeight;
      bill.classList.remove('drag'); bill.classList.add('enter'); setY(0);
      render();
      if (ok) nextCustomer(); // b107: 紙幣が入ったら、毎回まっさらな会計番号入力へ
    }, ok ? 900 : 300);
  }

  /* ---------- 設定（端末の設定を遠隔で） ---------- */
  let admTab = 'stats', todayShown = 0, cmdBusy = false;
  function toast(text, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = text; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      const w = document.createElement('div'); w.className = 'confirm';
      w.innerHTML = '<div class="card"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="row"><button class="ghost">やめる</button><button class="ok">' + esc(okLabel || 'はい') + '</button></div></div>';
      w.querySelector('.ghost').onclick = () => { w.remove(); resolve(false); };
      w.querySelector('.ok').onclick = () => { w.remove(); resolve(true); };
      document.body.appendChild(w);
    });
  }
  /* 端末に指示を送り、返事（state: ok / error）を最長 8 秒待つ */
  async function sendCmd(type, data, label) {
    if (cmdBusy) return false;
    if (isStale()) { toast('端末が見つかりません（電源・通信を確認）', true); return false; }
    cmdBusy = true; renderAdm();
    let id = null, result = false;
    try { id = await withTimeout(Cloud.pushCmd(saved.storeId, { ts: Date.now(), phone: saved.phone, type, data: data || {} }), 8000); }
    catch (e) { cmdBusy = false; renderAdm(); toast('送れませんでした。通信を確認してください', true); return false; }
    try { await new Promise((resolve) => {
      let done = false;
      const un = Cloud.watchCmd(saved.storeId, id, (d) => {
        if (done || !d || d.state === 'new') return;
        done = true; un();
        if (d.state === 'ok') { toast(label + '：端末に反映しました'); result = true; }
        else toast(label + '：端末が受け付けませんでした' + (d.reason ? '（' + ({ playing: 'ゲーム中です。終わってからもう一度', preset: 'そのプリセットは使えません' }[d.reason] || d.reason) + '）' : ''), true);
        resolve();
      });
      setTimeout(() => { if (!done) { done = true; un(); toast(label + '：端末から返事がありません', true); resolve(); } }, 8000);
    }); } finally { cmdBusy = false; }
    renderAdm();
    return result;
  }
  const stat = () => (storeDoc && storeDoc.stat) || null;
  let admSig = '';
  function renderAdmIfChanged() { // b99: 端末の状態が変わったときだけ描き直す（スクロール位置や音量スライダーを守る）
    const st = stat(); const sig = JSON.stringify([st && st.at, storeDoc && storeDoc.phase, storeDoc && storeDoc.lastSeen, deleted, meter && [meter.enabled, meter.miss, meter.superLeft]]);
    if (sig === admSig) return;
    const a = document.activeElement; if (a && a.id === 'vol') return; // 音量を動かしている最中は触らない
    renderAdm();
  }
  const PHONE_PANEL = '<div class="panel"><h4>このスマホ</h4><button class="btn ghost" data-act="reload">画面を読み直す（再接続）</button><button class="btn ghost" data-act="phoneLogout">店舗を切り替える（ログアウト）</button></div>';
  function renderAdm() {
    const box = $('adm'), st = stat();
    admSig = JSON.stringify([st && st.at, storeDoc && storeDoc.phase, storeDoc && storeDoc.lastSeen, deleted, meter && [meter.enabled, meter.miss, meter.superLeft]]);
    const keep = box.querySelector('.body') ? box.querySelector('.body').scrollTop : 0;
    const tab = (id, name) => '<button data-tab="' + id + '" class="' + (admTab === id ? 'on' : '') + '">' + name + '</button>';
    let body = '';
    if (!st) body = '<div class="panel"><p class="note">' + (deleted ? 'この店舗はマスターで削除されました。別の店舗に切り替えてください。' : '端末からの状態がまだ届いていません。端末が最新版（b91 以降）で起動していて、通信できているか確認してください。') + '</p></div>' + PHONE_PANEL;
    else if (admTab === 'stats') {
      const today = st.today || {};
      body = '<div class="panel"><h4>画面の集計（端末）</h4>' +
        '<div class="stat"><span>合計回転数</span><b>' + fmtN(st.playNo) + '</b></div>' +
        '<div class="stat"><span>当選額の合計</span><b>' + fmtN(st.awarded) + '</b></div>' +
        '<div class="stat"><span>合計当たり本数</span><b>' + (typeof st.winCount === 'number' ? fmtN(st.winCount) + ' 本' : '—') + '</b></div>' +
        '<div class="stat"><span>CREDIT（残り）</span><b>' + fmtN((st.credits || 0) + (st.dud || 0)) + '</b></div>' +
        '<button class="btn danger" data-act="reset">画面の集計をリセット</button></div>' +
        (false ? '<div class="panel"><h4>スーパーメーター（全店舗共有）</h4><div class="stat"><span>溜まったハズレ</span><b>' + fmtN(meter.miss) + ' / ' + fmtN(meter.target) + '</b></div><div class="stat"><span>スーパーモード</span><b>' + (meter.superLeft > 0 ? '残り ' + meter.superLeft + ' 回' : '—') + '</b></div></div>' : '') +
        '<div class="panel"><h4>今日の当たり</h4><p class="note">毎日 ' + (Number.isInteger(st.resetHour) ? st.resetHour : 19) + ':00 からの合計。テストの回と当たりなしの回は入りません。</p>' +
        '<div class="stat"><span>今日の当たり本数</span><b>' + fmtN(today.wins) + '</b></div>' +
        '<div class="stat"><span>今日の当たり合計</span><b class="' + (Date.now() < todayShown ? '' : 'mask') + '">' + (Date.now() < todayShown ? fmtN(today.awarded) : '＊＊＊＊＊') + '</b></div>' +
        '<button class="btn sm" data-act="today">10 秒だけ見る</button></div>' +
        '<div class="panel"><h4>会計番号ごとの当たり（端末）</h4><div class="hist">' +
        ((st.checks || []).length ? st.checks.map((c) => { const d = new Date(c.ts); return '<div class="row"><small>' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + '</small><span>No.' + esc(c.check) + '</span><b>' + fmtN(c.value) + '</b></div>'; }).join('') : '<p class="note">まだありません。当たりが出ると、そのとき入力されていた会計番号と金額がここに並びます。</p>') +
        '</div></div>';
    } else if (admTab === 'preset') {
      const list = (st.presets || []).filter((p) => !(meter && meter.superPresetId && p.id === meter.superPresetId)); // b107: スーパーモード用のプリセットはマスター画面だけで扱う
      body = '<div class="panel"><h4>プリセットを選ぶ</h4><p class="note">マスターから配られたプリセットの中から選びます。選ぶと端末の次のプレイから反映されます。</p><div class="plist">' +
        (list.length ? list.map((p) => '<button data-act="preset" data-id="' + esc(p.id) + '" class="' + (p.id === st.presetId ? 'on' : '') + '"><span>' + esc(p.name) + '</span><span class="chip">' + (p.id === st.presetId ? '使用中' : '') + '</span></button>').join('') : '<p class="note">配られているプリセットがありません。</p>') +
        '</div></div>';
    } else {
      const rec = st.recent || [];
      body = '<div class="panel"><h4>直近のプレイ（端末）</h4><div class="hist">' +
        (rec.length ? rec.map((r) => { const d = new Date(r.ts); return '<div class="row"><small>' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + (r.free ? ' FREE' : '') + (r.test ? ' テスト' : '') + '</small><span>STAGE ' + r.stage + '</span><b class="' + (r.value ? '' : 'zero') + '">' + fmtN(r.value) + '</b></div>'; }).join('') : '<p class="note">まだありません。</p>') +
        '</div></div>' +
        '<div class="panel"><h4>音量（端末）</h4><div class="slider"><span>小</span><input type="range" min="0" max="1" step="0.05" value="' + (typeof st.volume === 'number' ? st.volume : 0.5) + '" id="vol"><span>大</span></div><button class="btn sm" data-act="volume">この音量にする</button></div>' +
        '<div class="panel"><h4>端末</h4><p class="note">端末の版: ' + esc(st.ver || '—') + '　最終更新: ' + (st.at ? new Date(st.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '—') + '</p>' +
        '<button class="btn" data-act="update">端末を最新版に更新</button>' +
        '<button class="btn danger" data-act="logout">端末をこの店舗からログアウト</button></div>' +
        PHONE_PANEL;
    }
    box.innerHTML = '<div class="head"><h2>設定 ・ ' + esc(saved ? saved.name : '') + '</h2><button data-act="close">閉じる</button></div><div class="tabs">' + tab('stats', '集計') + tab('preset', 'プリセット') + tab('other', '履歴・その他') + '</div><div class="body">' + body + '</div>';
    const bodyEl = box.querySelector('.body'); if (bodyEl && keep) bodyEl.scrollTop = keep;
    box.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { admTab = b.dataset.tab; renderAdm(); const be = box.querySelector('.body'); if (be) be.scrollTop = 0; }; });
    box.querySelectorAll('.btn, .plist button').forEach((b) => { if (cmdBusy && b.dataset.act !== 'close') b.disabled = true; });
    box.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'close') { box.classList.add('hidden'); return; }
      if (act === 'today') { todayShown = Date.now() + 10000; renderAdm(); setTimeout(renderAdm, 10100); return; }
      if (act === 'reload') { location.reload(); return; }
      if (act === 'phoneLogout') { if (sending) { toast('送信中です。少し待ってください', true); return; } box.classList.add('hidden'); await phoneLogout(); return; }
      if (act === 'preset') { const p = (st.presets || []).find((x) => x.id === b.dataset.id); if (!p || p.id === st.presetId) return; if (await confirmBox('プリセットを切り替え', '端末のプリセットを「' + p.name + '」にします。次のプレイから反映されます。', '切り替える')) await sendCmd('preset', { id: p.id }, 'プリセット'); return; }
      if (act === 'reset') { if (await confirmBox('集計をリセット', '端末のプレイ回数・合計当たり本数・当たりの記録を 0 に戻します。残っている CREDIT も 0 になります。全履歴と全店舗の配当履歴は消えません。', 'リセットする')) await sendCmd('statsReset', {}, '集計のリセット'); return; }
      if (act === 'volume') { const v = Number($('vol').value); await sendCmd('volume', { v }, '音量'); return; }
      if (act === 'update') { if (await confirmBox('最新版に更新', '端末が新しい版を確認して、ゲームが終わり次第読み直します。', '更新する')) await sendCmd('update', {}, '更新'); return; }
      if (act === 'logout') { if (await confirmBox('端末をログアウト', '端末は店舗の選び直しとパスワード入力が必要になります。', 'ログアウトする')) await sendCmd('logout', {}, 'ログアウト'); return; }
    };
  }

  /* ---------- b107: GAME START → 会計番号入力（数字ボタン）→ どのステージから？ → 紙幣。紙幣を入れたら毎回、空っぽの会計番号入力に戻る ---------- */
  let starting = false;
  async function gameStart(skipStart) {
    if (starting) return; starting = true;
    const box = $('start');
    box.classList.remove('hidden');
    try {
      for (;;) {
        if (!skipStart) {
          await new Promise((resolve) => {
            box.classList.remove('stagepick');
            box.innerHTML = '<h1>' + esc(saved.name) + '</h1><button class="big2" id="gs">GAME<br>START</button><div class="sw"><button id="gsw">店舗を切り替える</button></div>';
            $('gsw').onclick = async () => { if (await confirmBox('店舗を切り替え', 'このスマホをいまの店舗からログアウトして、店舗を選び直します。', '切り替える')) { box.classList.add('hidden'); starting = false; await phoneLogout(); } };
            $('gs').onclick = () => { buzz(20); unlockAudio(); resolve(); };
          });
        }
        skipStart = false;
        const no = await askCheck(box);
        if (no === null) continue;
        const stg = await askStage(box, no);
        if (stg === null) { skipStart = true; continue; } // ステージ選びの［戻る］は会計番号入力へ
        saved.check = no; saved.checkAt = Date.now(); saved.stage = stg; save();
        break;
      }
    } finally { starting = false; box.classList.add('hidden'); box.classList.remove('stagepick'); }
    render();
  }
  function askCheck(box) { // 数字ボタンで会計番号（数字だけ、10 桁まで）
    return new Promise((resolve) => {
      let v = '';
      box.classList.remove('stagepick');
      box.innerHTML = '<h1>会計番号入力</h1><div class="numbox" id="nb"></div><div class="pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<button data-k="' + n + '">' + n + '</button>').join('') +
        '<button data-k="clr" class="del">全部消す</button><button data-k="0">0</button><button data-k="bs" class="del">← 1文字</button></div><div class="nrow"><button class="bk" id="cback">戻る</button><button class="nx" id="cgo">次へ</button></div>';
      const show = () => { $('nb').textContent = v; $('cgo').disabled = !v; };
      box.querySelector('.pad').onclick = (e) => { const k = e.target.closest('[data-k]'); if (!k) return; buzz(8); const x = k.dataset.k; if (x === 'clr') v = ''; else if (x === 'bs') v = v.slice(0, -1); else if (v.length < 10) v += x; show(); };
      $('cback').onclick = () => resolve(null);
      $('cgo').onclick = () => { if (v) { buzz(15); resolve(v); } };
      show();
    });
  }
  let presetCache = null, presetCacheId = '';
  function stageMax() { // 使用中のプリセットで、各ステージの一番高い金額（確率が 0 より大きいもの）
    const out = {}, p = presetCache && presetCache.probs;
    if (!p) return out;
    [1, 2, 3].forEach((n) => { const row = p[n] || {}; const vals = Object.keys(row).filter((k) => k !== '0' && k !== 'NEXT' && Number(row[k]) > 0).map(Number); if (vals.length) out[n] = Math.max.apply(null, vals); });
    return out;
  }
  function askStage(box, no) {
    return new Promise((resolve) => {
      box.classList.add('stagepick'); // b109: MAX 金額は出さない（オーナー指示）
      box.innerHTML = '<h1>どのステージから？</h1><p class="chkno">会計 No.<b>' + esc(no) + '</b>　紙幣1枚でどれでも同じ</p><div class="stg">' +
        [1, 2, 3].map((n) => '<button class="s' + n + '" data-s="' + n + '"><b>STAGE ' + n + '</b></button>').join('') +
        '</div><div class="nrow"><button class="bk" id="sback">戻る</button></div>';
      box.querySelector('.stg').onclick = (e) => { const s = e.target.closest('[data-s]'); if (!s) return; buzz(20); resolve(Number(s.dataset.s)); };
      $('sback').onclick = () => resolve(null);
    });
  }
  function nextCustomer() { // 紙幣が入ったら、毎回まっさらな会計番号入力へ
    if (!saved) return;
    saved.check = null; saved.stage = null; save(); render();
    gameStart(true);
  }
  function showFail(text) { // 入らなかったとき: 画面いっぱいに赤で。タップで紙幣の画面に戻る（同じ会計番号・ステージのまま）
    const old = document.querySelector('.fail'); if (old) old.remove();
    const f = document.createElement('div'); f.className = 'fail';
    f.innerHTML = '<div class="x">×</div><h2>入りませんでした</h2><p>' + esc(text) + '</p><small>画面をタップすると紙幣の画面に戻ります（同じ会計番号・ステージのまま）</small>';
    f.onclick = () => f.remove();
    document.body.appendChild(f);
  }
  function staleCheck() { // b105: 6 時間以上前の会計番号は使わない（裏に置いたまま翌日になった場合も）
    if (saved && saved.check && (!saved.checkAt || Date.now() - saved.checkAt > 6 * 60 * 60 * 1000)) { saved.check = null; saved.stage = null; save(); render(); if (!starting) gameStart(); return true; }
    return false;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) staleCheck(); });
  async function endCheck() {
    if (sending) { toast('送信中です。少し待ってください', true); return; }
    if (!(await confirmBox('会計 No.' + saved.check + ' を終了', 'このお客様の分を終わります。次は GAME START から会計番号を入れ直します。', '終了する'))) return;
    saved.check = null; save(); render(); gameStart();
  }

  /* ---------- 店舗へのログイン ---------- */
  async function login() {
    const box = $('login');
    box.classList.remove('hidden');
    for (;;) {
      let stores = null;
      box.innerHTML = '<h1>casa SLOT 紙幣</h1><p class="wait">店舗の一覧を読み込んでいます…</p>';
      try { stores = await Promise.race([Cloud.listStores(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))]); } catch (e) { stores = null; }
      if (!stores || !stores.length) {
        box.innerHTML = '<h1>casa SLOT 紙幣</h1><p>' + (stores ? '店舗が登録されていません。マスター画面で店舗を登録してください。' : 'クラウドに接続できません。通信を確認してください。') + '</p><div class="row"><button class="ok" id="retry">再試行</button></div>';
        await new Promise((r) => { $('retry').onclick = r; });
        continue;
      }
      const id = await new Promise((resolve) => {
        box.innerHTML = '<h1>casa SLOT 紙幣</h1><p>このスマホで紙幣を入れる店舗を選んでください</p><div class="list">' + stores.map((s) => '<button class="item" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>').join('') + '</div>';
        box.querySelectorAll('.item').forEach((b) => { b.onclick = () => resolve(b.dataset.id); });
      });
      const st = stores.find((s) => s.id === id);
      box.innerHTML = '<h1>' + esc(st.name) + '</h1><p class="wait">店舗の情報を読み込んでいます…</p>';
      let doc = null;
      try { doc = await Promise.race([Cloud.getStore(id), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))]); } catch (e) { doc = null; }
      if (!doc || !doc.pin) { box.innerHTML = '<h1>' + esc(st.name) + '</h1><p>店舗の情報を読み込めませんでした。通信を確認してもう一度お試しください。</p><div class="row"><button class="ok" id="retry">もう一度</button></div>'; await new Promise((r) => { $('retry').onclick = r; }); continue; }
      const ok = await new Promise((resolve) => {
        box.innerHTML = '<h1>' + esc(st.name) + '</h1><p>店舗のパスワード（端末と同じ）</p><input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8"><div class="err" id="perr"></div><div class="row"><button class="ghost" id="back">戻る</button><button class="ok" id="go">ログイン</button></div>';
        const inp = $('pin'); setTimeout(() => inp.focus(), 100);
        const check = () => { const p = inp.value.trim(); if (!Engine.checkPin(p, doc.pin)) { $('perr').textContent = 'パスワードが正しくありません。'; inp.value = ''; inp.focus(); return; } resolve(true); };
        $('go').onclick = check; inp.onkeydown = (e) => { if (e.key === 'Enter') check(); };
        $('back').onclick = () => resolve(false);
      });
      if (!ok) continue;
      saved = { storeId: id, name: st.name, phone: phoneId(), seq: (load() && load().seq) || 0, check: null };
      save();
      box.classList.add('hidden');
      return;
    }
  }
  async function phoneLogout() {
    if (unwatchStore) { unwatchStore(); unwatchStore = null; }
    saved = null; storeDoc = null;
    try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
    await login(); drawBill(); watchStore(); gameStart();
  }
  function watchStore() {
    if (unwatchStore) unwatchStore();
    storeDoc = null; render();
    deleted = false;
    unwatchStore = Cloud.watchStore(saved.storeId, (d) => {
      if (!d) { storeDoc = null; deleted = true; render(); setMsg('この店舗はマスターで削除されました', 'err'); return; }
      deleted = false; storeDoc = d; render();
      if (d.activePresetId && d.activePresetId !== presetCacheId) { presetCacheId = d.activePresetId; Cloud.getPreset(d.activePresetId).then((p) => { presetCache = p; }).catch(() => {}); } // b107: ステージ選びの MAX 金額
    });
  }
  window.addEventListener('online', () => { if (saved && !storeDoc) watchStore(); }); // b99: 起動時に圏外だったら、戻ったときに見張り直す

  async function init() {
    $('bill').innerHTML = BillArt.svg(470);
    layoutBill();
    initSwipe();
    { // casa SLOT のロゴを 2.5 秒以内に 5 回タップで設定（端末と同じ流儀）
      let taps = [];
      $('crest').addEventListener('pointerdown', (e) => { e.preventDefault(); const now = Date.now(); taps = taps.filter((t) => now - t < 2500).concat(now); if (taps.length >= 5) { taps = []; admTab = 'stats'; renderAdm(); $('adm').classList.remove('hidden'); } });
    }
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    if (!Cloud.enabled) { $('login').classList.remove('hidden'); $('login').innerHTML = '<h1>casa SLOT 紙幣</h1><p>この公開先は店舗モードではないため、紙幣ページは使えません。</p>'; return; }
    $('login').classList.remove('hidden'); $('login').innerHTML = '<h1>casa SLOT 紙幣</h1><p class="wait">クラウドに接続しています…</p>';
    try { await Promise.race([Cloud.ready(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]); } catch (e) { /* ログイン画面で再試行できる */ }
    $('login').classList.add('hidden');
    saved = load();
    if (!saved || !saved.storeId) await login();
    drawBill();
    watchStore();
    $('chk').addEventListener('click', (e) => { if (e.target.closest('[data-act="end"]')) endCheck(); });
    if (saved.check && (!saved.checkAt || Date.now() - saved.checkAt > 6 * 60 * 60 * 1000)) { saved.check = null; save(); render(); } // b99: 6 時間以上前の会計番号は使わない（翌日に前の客の番号で入れない）
    if (!saved.check || !saved.stage) gameStart();
    Cloud.watchMeter((m) => { meter = m; render(); }); // b101
    setInterval(() => { if (saved && !storeDoc && !deleted) watchStore(); }, 20000); // b105: 店舗の情報が届かないままなら、20 秒ごとに見張り直す
    setInterval(render, 30000);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
