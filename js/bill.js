/* スマホの紙幣ページ（b83）。スタッフのスマホで開き、店舗にログインしておく。
   紙幣を上にスライドすると、クラウド（stores/{id}/inserts）に 1 件書く → 店舗の端末がお札の演出をして回す。
   端末からの返事（state: 'ok' / 'busy'）を見て「投入しました」「ゲーム中」を出す。返事が無ければ 5 秒で「届きませんでした」。 */
(function () {
  'use strict';
  const KEY = 'casa-slot-bill.v1';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let saved = null;      // { storeId, name, phone, seq }
  let storeDoc = null;   // 店舗ドキュメントの最新（phase を見る）
  let unwatchStore = null, sending = false, lastSent = 0, armed = true;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* noop */ } };
  const phoneId = () => { let s = load(); if (s && s.phone) return s.phone; return 'p' + Math.random().toString(36).slice(2, 10); };

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
  function render() {
    const st = $('store'), bill = $('bill'), hint = $('hint');
    const busy = !!(storeDoc && storeDoc.phase === 'busy');
    const stale = !storeDoc || !storeDoc.lastSeen || Date.now() - storeDoc.lastSeen > 25 * 60 * 1000; // 生存報告は 10 分ごと
    if (!saved) return;
    if (!storeDoc) { st.className = 'store off'; $('storeText').textContent = saved.name + ' … 接続中'; }
    else if (stale) { st.className = 'store off'; $('storeText').textContent = saved.name + ' の端末が見つかりません'; }
    else if (busy) { st.className = 'store busy'; $('storeText').textContent = saved.name + ' の端末はゲーム中'; }
    else { st.className = 'store'; $('storeText').textContent = saved.name + ' の端末につながっています'; }
    armed = !busy && !sending;
    bill.classList.toggle('gray', busy); // 送信中は色のまま（吸い込まれていく途中で灰色にしない）
    hint.classList.toggle('busy', !armed);
    hint.innerHTML = '<span class="arr"></span>'; // 三角だけ（文字は出さない。b89）
  }

  /* ---------- スライド ---------- */
  const setY = (y) => { $('bill').style.setProperty('--y', y + 'px'); };
  /* 紙幣の大きさと置き場所（b87）: 縦の長さは画面の 92%、待機中は上の 65% だけ見える。口の幅は紙幣の幅に合わせる */
  const geo = { bh: 0, bw: 0, restTop: 0 };
  function layoutBill() {
    const clip = $('feedClip'), bill = $('bill'), svg = bill.querySelector('svg');
    const H = window.innerHeight, clipH = clip.clientHeight;
    const bh = Math.round(H * 0.92), bw = Math.round(bh / 2.35);
    geo.bh = bh; geo.bw = bw; geo.restTop = Math.round(clipH - bh * 0.65);
    bill.style.width = bw + 'px'; bill.style.height = bh + 'px'; bill.style.top = geo.restTop + 'px';
    if (svg) { svg.setAttribute('width', bh); svg.setAttribute('height', bw); svg.style.width = bh + 'px'; svg.style.height = bw + 'px'; svg.style.left = (bw / 2 - bh / 2) + 'px'; svg.style.top = (bh / 2 - bw / 2) + 'px'; }
    $('slit').style.width = (bw + 18) + 'px';
  }
  function initSwipe() {
    const bill = $('bill'), clip = $('feedClip');
    let y0 = 0, dy = 0, dragging = false, pid = null;
    const H = () => window.innerHeight;
    clip.addEventListener('pointerdown', (e) => { // 紙幣の周り（枠の中）どこを触ってもよい
      unlockAudio();
      if (!armed) { buzz(40); return; }
      dragging = true; pid = e.pointerId; y0 = e.clientY; dy = 0;
      bill.classList.add('drag'); bill.classList.remove('back', 'enter', 'suck');
      try { clip.setPointerCapture(pid); } catch (x) { /* noop */ }
    });
    clip.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pid) return;
      dy = Math.min(0, e.clientY - y0); // 上方向だけ
      setY(dy);
      $('slit').classList.toggle('hot', -dy > H() / 3);
    });
    const end = (e) => {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false;
      bill.classList.remove('drag');
      $('slit').classList.remove('hot');
      if (-dy > H() / 3) insert(dy);
      else { bill.classList.add('back'); setY(0); }
    };
    clip.addEventListener('pointerup', end);
    clip.addEventListener('pointercancel', end);
    window.addEventListener('resize', layoutBill);
  }

  /* ---------- 投入 ---------- */
  /* 吸い込み: 紙幣の上端が口に届いたところから、口の中へ引き込まれていく（口より上は #feedClip で隠れる）。約 1 秒 */
  async function insert() {
    const bill = $('bill'), clip = $('feedClip');
    if (!armed || sending || Date.now() - lastSent < 3000) { bill.classList.add('back'); setY(0); return; }
    sending = true; lastSent = Date.now();
    render();
    const target = -(geo.restTop + geo.bh + 16); // 紙幣が口の中へ完全に入る位置
    bill.classList.add('suck');
    $('slit').classList.add('hot');
    setY(target);
    buzz([20, 30, 20, 30, 60]);
    setMsg('投入中…');
    await new Promise((r) => setTimeout(r, 950));
    $('slit').classList.remove('hot');
    saved.seq = (saved.seq || 0) + 1; save();
    let id = null;
    try { id = await Cloud.pushInsert(saved.storeId, { ts: Date.now(), phone: saved.phone, seq: saved.seq }); }
    catch (e) { finish(false, '届きませんでした。通信を確認してもう一度'); return; }
    // 端末の返事を待つ（最長 5 秒）
    let done = false;
    const un = Cloud.watchInsert(saved.storeId, id, (d) => {
      if (done || !d || d.state === 'new') return;
      done = true; un();
      if (d.state === 'ok') finish(true, '投入しました。ゲームが始まります');
      else finish(false, d.reason === 'credit' ? '端末は FREE SPIN の消化中です。終わってからもう一度' : 'ゲーム中のため入りませんでした。終わってからもう一度');
    });
    setTimeout(() => { if (!done) { done = true; un(); finish(false, '端末から返事がありません。端末の画面と通信を確認してください'); } }, 5000);
  }
  function finish(ok, text) {
    const bill = $('bill');
    setMsg(text, ok ? 'ok' : 'err');
    beep(ok);
    if (ok) buzz([20, 30, 60]); else buzz([80, 60, 80]);
    setTimeout(() => {
      sending = false;
      drawBill();
      // 次の紙幣は下から出てくる（失敗したときは口から戻ってくる）
      bill.classList.remove('suck', 'back', 'enter');
      bill.classList.add('drag'); setY(ok ? geo.bh : -(geo.restTop + geo.bh)); // 次の紙幣は下から（失敗は口から戻る）
      void bill.offsetHeight;
      bill.classList.remove('drag'); bill.classList.add('enter'); setY(0);
      render();
      setTimeout(() => setMsg(''), 3000);
    }, ok ? 900 : 300);
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
        await new Promise((r) => $('retry').onclick = r);
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
      if (!doc || !doc.pin) { box.innerHTML = '<h1>' + esc(st.name) + '</h1><p>店舗の情報を読み込めませんでした。通信を確認してもう一度お試しください。</p><div class="row"><button class="ok" id="retry">もう一度</button></div>'; await new Promise((r) => { document.getElementById('retry').onclick = r; }); continue; }
      const ok = await new Promise((resolve) => {
        box.innerHTML = '<h1>' + esc(st.name) + '</h1><p>店舗のパスワード（端末と同じ）</p><input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8"><div class="err" id="perr"></div><div class="row"><button class="ghost" id="back">戻る</button><button class="ok" id="go">ログイン</button></div>';
        const inp = $('pin'); setTimeout(() => inp.focus(), 100);
        const check = () => { const p = inp.value.trim(); if (!Engine.checkPin(p, doc.pin)) { $('perr').textContent = 'パスワードが正しくありません。'; inp.value = ''; inp.focus(); return; } resolve(true); };
        $('go').onclick = check; inp.onkeydown = (e) => { if (e.key === 'Enter') check(); };
        $('back').onclick = () => resolve(false);
      });
      if (!ok) continue;
      saved = { storeId: id, name: st.name, phone: phoneId(), seq: (load() && load().seq) || 0 };
      save();
      box.classList.add('hidden');
      return;
    }
  }

  function watchStore() {
    if (unwatchStore) unwatchStore();
    storeDoc = null; render();
    unwatchStore = Cloud.watchStore(saved.storeId, (d) => {
      if (!d) { storeDoc = null; setMsg('この店舗はマスターで削除されました', 'err'); return; }
      storeDoc = d; render();
    });
  }

  async function init() {
    $('bill').innerHTML = BillArt.svg(470);
    layoutBill();
    initSwipe();
    $('btnLogout').onclick = async () => { if (unwatchStore) { unwatchStore(); unwatchStore = null; } saved = null; try { localStorage.removeItem(KEY); } catch (e) { /* noop */ } await login(); drawBill(); watchStore(); };
    $('btnReload').onclick = () => location.reload();
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    if (!Cloud.enabled) { $('login').classList.remove('hidden'); $('login').innerHTML = '<h1>casa SLOT 紙幣</h1><p>この公開先は店舗モードではないため、紙幣ページは使えません。</p>'; return; }
    document.getElementById('login').classList.remove('hidden'); document.getElementById('login').innerHTML = '<h1>casa SLOT 紙幣</h1><p class="wait">クラウドに接続しています…</p>';
    try { await Promise.race([Cloud.ready(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]); } catch (e) { /* ログイン画面で再試行できる */ }
    document.getElementById('login').classList.add('hidden'); // 接続できたら（ログイン済みなら）画面を戻す
    saved = load();
    if (!saved || !saved.storeId) await login();
    drawBill();
    watchStore();
    setInterval(render, 30000); // 端末の生存確認の表示を更新
  }
  document.addEventListener('DOMContentLoaded', init);
})();
