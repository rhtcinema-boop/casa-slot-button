/* casa DERBY v2 スタッフのスマホ（staff.html?store=<id> でも、店舗を選んでも可）。あとで casa SLOT の紙幣ページに合流する前提で、このファイルだけで完結させる。
   通信は v2/client.js（DerbyCloud）。API は v2/API.md。
   - 店舗を選んで PIN を 1 回入れる（このスマホに覚える）
   - 認証: お客さんの認証 QR（derby:auth:<tid>）を読む → 会計番号・ニックネーム・「チップ 3,000」 → 「リングバウンティ 600枚を受け取って認証」（交換の割合: リングバウンティ 20枚 ＝ 100チップ。中の 1 枚 = 100 チップ。管理の設定 bountyPerTicket。2026-10-17）
   - 受け取り: 当たりの QR（derby:pay:<pid>）を読む → 「当選額 18,300pt を渡す」→「当選額 18,300pt を渡した（確定）」（額は 1 枚 = 100。2026-10-16。単位 pt と「切り上げ済み」は 2026-10-20）。受け取り済みは赤で拒否（二重防止はサーバー）
   - 参加受付（2026-10-16 受付の 2 段）: 認証できるのは参加受付の締切（exchangeCloseAt）まで。認証・次への画面に「参加受付 あと m:ss」、締切のあとは赤で「参加受付は締め切りました」
   - 返却: 投票しなかった券の QR（返却）を読む → 「返却 リングバウンティ 600枚」→「リングバウンティ 600枚を返した（確定）」（認証したときの割合。返還も同じ。当選額とは別）
   - 次へ: その店のテレビの結果画面を進める。その下に「この店だけテストレース」（2026-10-19。押すと、この店のテレビだけで 1 分半後にテストのレース＝参加受付 1 分・投票 30 秒（2026-10-20 その 5。前は 1 分＝30 秒・30 秒）。集計には入らない。
     2026-10-19 その 2: 上の「テレビ」のシート（v2/staffswitch.js）からも押せる。window.STAFF.test を使う）
     2026-10-20 その 4: 押せるかは「受付の始まり〜結果画面の終わり」とぶつかるかで見る（紙幣のページと同じ。次のレースがあるだけでは止めない）。
     テレビが casa SLOT のゲーム中なら、進行役のテレビが「テレビが casa DERBY に来た」のを確かめてから作る（5 分まで。待つ間は「ゲーム中です。終わってから切り替えます」）
   - 記録: 今日の会計番号ごとの認証・当たり・受け取り
   カメラ: BarcodeDetector があれば使い、なければ jsQR（jsdelivr、版を固定）。カメラが使えないときは番号を手で入れる。
   テスト用: window.STAFF.inject('derby:auth:...') で読み取ったことにできる。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'casa.derby.staff.v1';
  const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
  const pad = (n) => ('0' + n).slice(-2);
  const hhmm = (ms) => { if (!ms) return ''; const d = new Date(ms + 9 * 3600e3); return d.getUTCHours() + ':' + pad(d.getUTCMinutes()); }; // いつも日本時間
  // 払い戻しは「額」（2026-10-16 オーナー決定。1 枚 = 100・単位なし・3 桁ごとのカンマ）。認証（リングバウンティ）は枚のまま
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  /* 金額の単位「pt」（2026-10-20 オーナー決定。以前は単位なし）: チップ・当選額・受取額などは数字のすぐ後ろに「pt」。ptT＝文字、ptH＝大きな数字の横に小さく。
     リングバウンティは「枚」のまま。当選額は 10 の位で切り上げた額（決めるときに切り上げ済み＝ここでは計算しない） */
  const ptT = (n) => amt(n) + 'pt', ptH = (n) => amt(n) + '<small>pt</small>';
  /* 交換の割合（2026-10-17）: リングバウンティ ○枚 ＝ 投票券 1 枚（state.settings.bountyPerTicket。なければ 20）。認証した券・返却・返還は券に残した割合のリングバウンティ */
  const rateNow = () => { const r = st && st.settings && Number(st.settings.bountyPerTicket); return Number.isInteger(r) && r >= 1 ? r : 20; };
  const rb = (n) => 'リングバウンティ ' + amt(n) + '枚';
  // 交換の割合の 1 行（2026-10-19 オーナー「Bounty X 枚で 100 と交換。説明のどこかに明記」。テレビの参加受付・お客さんの参加画面と同じ言葉）
  const rateLine = () => '交換 ' + esc(rb(rateNow())) + ' → 100pt';
  /* casa DERBY CHIPS（2026-10-17 オーナー「リングバウンティ20枚で casa DERBY 100チップ入る感じ」）: お客さんの投票券は「チップ」で見せる（中の 1 枚 = 100 チップ・数字だけ）。リングバウンティは本物の札なので「枚」 */
  const chips = (n) => ptT((Number(n) || 0) * 100), chipsH = (n) => ptH((Number(n) || 0) * 100); // 2026-10-20 から「3,000pt」
  // 記録 1 行のリングバウンティ（core.js の logBounty と同じ。以前の記録: 認証は枚数＝1 対 1、返却・返還は額 ÷ 100）
  const logB = (l) => (l.bounty != null ? Number(l.bounty) || 0 : l.type === 'auth' ? Number(l.count) || 0 : Math.round((Number(l.count) || 0) / 100));
  const payB = (p) => (p.bounty != null ? Number(p.bounty) || 0 : Math.round((Number(p.amount) || 0) / 100));
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + pad(s % 60); };
  const qs = new URLSearchParams(location.search);

  let saved = null; // { store, name, pin }
  let C = null, st = null, mode = 'auth', online = false, unsub = null, sheetOpen = false, logsCache = null, logFilter = null;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* noop */ } };

  function toast(t, err, ms) { const el = $('toast'); el.textContent = t; el.className = 'toast' + (err ? ' err' : ''); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.add('hidden'), ms || 2800); }
  const ERR = { no_decider: '進行役のテレビがありません', busy: 'いまはテストのレースを作れません（受付中・レース中か、もうすぐ次のレースです）', too_soon: '少し待ってからもう一度押してください', rate_changed: '交換の割合が変わりました。もう一度読み取ってください', exchange_closed: '参加受付は締め切りました', no_open_race: '受付中のレースがありません（次のレースの受付を待ってください）', wrong_store: 'ほかの店舗の QR です', already_authorized: 'もう認証されています', already_paid: '受け取り済みです', not_revealed: 'まだ結果発表の前です', count_mismatch: 'チップがお客さんの画面と合いません', not_found: '見つかりません（QR が違うか、古い可能性があります）', bad_pin: 'PIN が違います', bad_code: '読み取った QR が casa DERBY のものではありません', wrong_code: 'QR の種類が違います（認証と受け取りを確かめてください）', no_store: '店舗が見つかりません' };
  // 管理画面で PIN が変わった（401）: どの操作でも、ログインし直しの画面へ
  const pinGone = (e) => { if (!(e && (e.status === 401 || e.code === 'bad_pin'))) return false; closeSheet(); toast('PIN が変わりました。ログインし直してください', true, 4000); logout(true); return true; };
  const errText = (e) => (e && ERR[e.code]) || (e && !e.status ? '通信できませんでした。もう一度お試しください' : (e && e.body && e.body.message) || 'うまくいきませんでした');

  /* ================= 参加受付の段（2026-10-16） ================= */
  const xAt = (r) => (r ? (r.exchangeCloseAt != null ? r.exchangeCloseAt : r.closeAt) : 0);
  // いまの受付: { open: 受付中のレース, closed: 参加受付の締切を過ぎた（投票の段）, left: 参加受付の残り ms }
  function xState() {
    const o = st && st.open, n = C ? C.serverNow() : Date.now();
    if (!o || o.closeAt <= n) return { open: null, closed: true, left: 0 };
    return { open: o, closed: n >= xAt(o), left: xAt(o) - n, voteLeft: o.closeAt - n };
  }
  function xBannerHtml() {
    const x = xState(), nx = st && st.next;
    if (!x.open) return '<div class="xstage none"><b>受付中のレースがありません</b><small>' + (nx ? '次のレース ' + hhmm(nx.at) + ' 発走' : '次のレースを待っています') + '</small></div>';
    if (!x.closed) return '<div class="xstage ' + (x.left < 15000 ? 'hot' : 'on') + '"><span>参加受付 あと</span><b>' + mmss(x.left) + '</b></div>'; // 2026-10-20 オーナーの文字帳: 「発走のレース・投票締切」と「交換 リングバウンティ → 100」は消した。「参加受付 あと」は大きく（staff.css）
    return '<div class="xstage shut"><b>参加受付は締め切りました</b><small>リングバウンティは受け取らないでください。次のレース' + (nx ? '（' + hhmm(nx.at) + ' 発走）' : '') + 'の受付は ' + mmss(x.voteLeft) + ' 後から</small></div>';
  }
  function drawXBanner() { { const g = $('guide'), sm = g && mode === 'auth' && g.querySelector('small'); if (sm && sm.textContent !== rateLine()) sm.textContent = rateLine(); } /* 割合が変わったら認証の案内も直す */ const e = $('xstage'); if (!e) return; const h = xBannerHtml(); if (e.innerHTML !== h) e.innerHTML = h; e.hidden = !(mode === 'auth' || mode === 'next'); }

  /* ================= ログイン（店舗と PIN を 1 回だけ） ================= */
  const LOGO_H1 = '<h1 class="logo-h1"><img src="../art/logo-3d/B/lockup-3d-B-casaWhite.svg" width="120" height="39" alt="casa DERBY" draggable="false"><span>スタッフ</span></h1>'; /* 新しいロゴ（art/logo-3d/B/。2026-10-14） */
  async function login() {
    const box = $('login'); box.classList.remove('hidden');
    for (;;) {
      box.innerHTML = LOGO_H1 + '<p>店舗の一覧を読み込んでいます…</p>';
      let stores = null;
      try { stores = await window.DerbyCloud.create({ role: 'staff' }).stores(); } catch (e) { stores = null; }
      if (!stores || !stores.length) {
        box.innerHTML = LOGO_H1 + '<p>' + (stores ? '店舗が登録されていません。' : 'クラウドに接続できません。通信を確認してください。') + '</p><div class="row"><button class="btn ok" id="retry">再試行</button></div>';
        await new Promise((r) => { $('retry').onclick = r; }); continue;
      }
      let id = qs.get('store');
      if (!stores.some((s) => s.id === id)) {
        box.innerHTML = LOGO_H1 + '<p>このスマホで使う店舗を選んでください</p><div class="list">' + stores.map((s) => '<button class="item" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>').join('') + '</div>';
        id = await new Promise((r) => box.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => r(b.dataset.id); }));
      }
      const s = stores.find((x) => x.id === id);
      const ok = await new Promise((resolve) => {
        box.innerHTML = '<h1>' + esc(s.name) + '</h1><p>店舗の PIN（スタッフ用）</p><input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8"><div class="err" id="perr"></div><div class="row"><button class="btn ghost" id="back">戻る</button><button class="btn ok" id="go">ログイン</button></div>';
        const inp = $('pin'); setTimeout(() => inp.focus(), 100);
        const check = async () => {
          const pin = inp.value.trim(); if (!pin) return;
          $('go').disabled = true;
          try { const c = window.DerbyCloud.create({ store: id, role: 'staff' }); await (c.staffLogin ? c.staffLogin(pin) : c.logs(pin, {})); saved = { store: id, name: s.name, pin }; save(); resolve(true); }
          catch (e) { $('go').disabled = false; $('perr').textContent = e.status === 401 || e.status === 403 || e.code === 'bad_pin' ? 'PIN が正しくありません' : errText(e); inp.value = ''; inp.focus(); }
        };
        $('go').onclick = check; inp.onkeydown = (e) => { if (e.key === 'Enter') check(); };
        $('back').onclick = () => resolve(false);
      });
      if (ok) break;
      if (qs.get('store')) { history.replaceState(null, '', location.pathname); qs.delete('store'); }
    }
    box.classList.add('hidden');
  }
  async function logout(force) { // force === true: 管理画面で PIN が変わった（聞かずにログインの画面へ。「やめる」を押すと PIN が違うまま動けなくなるので）
    if (force !== true && !confirm('この店舗からログアウトしますか？')) return;
    stopCam(); if (unsub) unsub(); saved = null; try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
    $('tabs').classList.add('hidden'); hideViews(); await login(); start();
  }

  /* ================= 上の帯・タブ ================= */
  function drawTop() {
    $('store').className = 'store' + (online ? '' : ' off');
    $('storeText').innerHTML = esc(saved ? saved.name : '') + (online ? ' につながっています' : ' … 接続を待っています') + ' <button id="out">店舗を変える</button>';
    $('out').onclick = logout;
  }
  function hideViews() { ['scanView', 'nextView', 'logsView'].forEach((v) => $(v).classList.add('hidden')); }
  function setMode(m) {
    mode = m;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    hideViews();
    if (m === 'auth' || m === 'pay') {
      $('scanView').classList.remove('hidden');
      $('guide').innerHTML = m === 'auth' ? 'お客さんの<b>認証 QR</b> を枠に入れてください' /* 交換の割合の行は消した（2026-10-20 オーナーの文字帳 t0374） */ : 'お客さんの<b>当たり・返却の QR</b> を枠に入れてください<small>渡す当選額（返すリングバウンティ）が出ます</small>';
      startCam();
    } else { stopCam(); }
    if (m === 'next') { $('nextView').classList.remove('hidden'); drawNext(true); }
    drawXBanner();
    if (m === 'logs') { $('logsView').classList.remove('hidden'); drawLogs(); refreshLogs(); }
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });

  /* ================= カメラで QR を読む ================= */
  let stream = null, detector = null, raf = 0, busyScan = false, lastCode = '', lastAt = 0, cv = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = JSQR; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('jsQR')); document.head.appendChild(s); });
  }
  async function startCam() {
    if (stream) { loop(); return; }
    const msg = $('camMsg'); msg.textContent = 'カメラを起動しています…';
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const v = $('video'); v.srcObject = stream; v.setAttribute('playsinline', ''); await v.play().catch(() => {});
      detector = null;
      if ('BarcodeDetector' in window) {
        try { const f = await window.BarcodeDetector.getSupportedFormats(); if (f.indexOf('qr_code') >= 0) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }
      }
      if (!detector) await loadJsQR();
      msg.textContent = '';
      loop();
    } catch (e) {
      stopCam();
      msg.textContent = ''; /* 2026-10-20 オーナーの文字帳 t0385: カメラが使えないときの長い説明は消した（「番号を手で入れる」も消したため）。下の「カメラを再起動」で開き直す */
    }
  }
  function stopCam() {
    cancelAnimationFrame(raf); raf = 0;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    const v = $('video'); if (v) v.srcObject = null;
  }
  let lastScanT = 0;
  function loop() {
    cancelAnimationFrame(raf);
    const tick = async (t) => {
      raf = requestAnimationFrame(tick);
      if (busyScan || sheetOpen || !stream || t - lastScanT < 140) return;
      const v = $('video'); if (!v || v.readyState < 2 || !v.videoWidth) return;
      lastScanT = t; busyScan = true;
      try {
        let text = null;
        if (detector) { const r = await detector.detect(v); if (r && r.length) text = r[0].rawValue; }
        else if (window.jsQR) {
          const k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight)), w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
          cv = cv || document.createElement('canvas'); cv.width = w; cv.height = h;
          const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0, w, h);
          const r = window.jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); if (r) text = r.data;
        }
        if (text && !(text === lastCode && performance.now() - lastAt < 4000)) { lastCode = text; lastAt = performance.now(); $('cam').classList.add('hit'); setTimeout(() => $('cam').classList.remove('hit'), 500); if (navigator.vibrate) navigator.vibrate(60); handleCode(text, 'camera'); }
      } catch (e) { /* 1 コマ失敗しても続ける */ }
      busyScan = false;
    };
    raf = requestAnimationFrame(tick);
  }
  $('camBtn').onclick = () => { stopCam(); startCam(); };
  if ($('manualBtn')) $('manualBtn').onclick = manual; // 「番号を手で入れる」のボタンは消した（2026-10-20 オーナーの文字帳「この機能いらない」）。テスト用の STAFF.inject は 6 桁の番号も読める

  function manual() {
    const box = $('login'); box.classList.remove('hidden');
    box.innerHTML = '<h1>' + (mode === 'pay' ? '受け取りの番号' : '認証の番号') + '</h1><p>お客さんの QR の下に出ている番号を入れてください</p><input id="mcode" class="code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="80"><div class="err" id="merr"></div><div class="row"><button class="btn ghost" id="mback">戻る</button><button class="btn ok" id="mgo">確認</button></div>';
    const inp = $('mcode'); setTimeout(() => inp.focus(), 100);
    const done = () => box.classList.add('hidden');
    $('mback').onclick = done;
    const go = () => { const v = inp.value.trim().replace(/\s+/g, ''); if (!v) return; done(); handleCode(v, 'manual'); };
    $('mgo').onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }

  /* ================= 読み取った QR の処理 ================= */
  function parse(text) {
    const t = String(text || '').trim();
    const p = window.DerbyCloud && window.DerbyCloud.parseCode ? window.DerbyCloud.parseCode(t) : null;
    if (p && (p.kind === 'auth' || p.kind === 'pay')) return { kind: p.kind, id: p.id, code: t };
    const m = /^derby:(auth|pay):([A-Za-z0-9_-]+)$/i.exec(t); if (m) return { kind: m[1].toLowerCase(), id: m[2], code: t };
    if (/^[A-Za-z0-9_-]{3,64}$/.test(t)) { // 手入力の番号だけ: 先頭の文字（t=投票券 / p=当たり）→ なければ今のタブ
      const kind = /^p/i.test(t) ? 'pay' : /^t/i.test(t) ? 'auth' : (mode === 'pay' ? 'pay' : 'auth');
      return { kind, id: t, code: 'derby:' + kind + ':' + t };
    }
    if (/bet\.html/.test(t)) return { kind: 'join' };
    return null;
  }
  async function handleCode(text, via, retried) {
    const p = parse(text);
    if (!p) return toast('casa DERBY の QR ではありません', true);
    if (p.kind === 'join') return toast('これはテレビの参加用 QR です。お客さんのスマホの QR を読んでください', true, 4000);
    if (p.kind !== mode && (mode === 'auth' || mode === 'pay')) { mode = p.kind; document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode)); toast(p.kind === 'pay' ? '受け取りの QR（当たり・返還・返却）なので「受け取り」で開きます' : '認証の QR なので「認証」で開きます'); drawXBanner(); }
    openSheet('<div class="kind">確認しています…</div>');
    try {
      if (p.kind === 'auth') { const d = await C.staffTicket(saved.pin, p.code); showAuth(d.ticket, p); }
      else { const d = await C.staffPayout(saved.pin, p.code); showPay(d.payout, p); }
    } catch (e) {
      if (e.code === 'already_paid' && e.body && e.body.payout) return showPay(e.body.payout, p);
      if (e.status === 401 || e.code === 'bad_pin') { closeSheet(); toast('PIN が変わりました。ログインし直してください', true, 4000); return logout(true); }
      // 手入力の 6 桁の番号が、いまのタブと違う種類（認証 ↔ 受け取り）だった: 種類を切り替えて 1 回だけ読み直す
      const other = e.code === 'wrong_code' && ((e.body && e.body.kind) || (p.kind === 'auth' ? 'pay' : 'auth'));
      if (other && !retried && /^\d{6}$/.test(p.id) && other !== p.kind) { sheetOpen = false; mode = p.kind; return handleCode('derby:' + other + ':' + p.id, via, true); }
      showNg(p.kind === 'pay' ? '当たりの受け取り' : '認証', errText(e));
    }
  }

  function openSheet(html, cls) { sheetOpen = true; const s = $('sheet'); s.className = 'sheet' + (cls ? ' ' + cls : ''); s.innerHTML = '<div class="card">' + html + '</div>'; }
  // 記録できた（緑）の画面は 1.2 秒で自動で閉じて次の読み取りへ（「次を読む」で今すぐ閉じてもよい。REVIEW_TODO 8）
  function doneSheet(html, cls) { openSheet(html + '<i class="autobar"></i>', 'okk ' + cls); const card = $('sheet').firstChild; setTimeout(() => { if (sheetOpen && $('sheet').firstChild === card) closeSheet(); }, 1200); }
  function closeSheet() { sheetOpen = false; $('sheet').className = 'sheet hidden'; $('sheet').innerHTML = ''; lastCode = ''; }
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  // 読めなかった理由の札（期限切れ・処理済み・対象外。REVIEW_TODO 8）
  const cause = (t) => (/参加受付/.test(t) ? '受付締切' : /期限/.test(t) ? '期限切れ' : /済み|もう認証/.test(t) ? '処理済み' : /ほかの店舗|用の QR|使えません|見つかりません|違う|古い/.test(t) ? '対象外' : '');
  function showNg(kind, text, sub) {
    const c = cause(text + ' ' + (sub || ''));
    openSheet('<div class="kind">' + esc(kind) + '</div>' + (c ? '<div class="cause">' + c + '</div>' : '') + '<div class="verdict ng">' + esc(text) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div><button class="btn ghost big" data-x>閉じて次を読む</button>', 'bad');
    $('sheet').querySelector('[data-x]').onclick = closeSheet;
  }
  const facts = (rows) => '<dl>' + rows.filter((r) => r && r[1] !== '' && r[1] != null).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>';
  // 送ったのに返事が来なかった（通信が切れた）とき: サーバーには記録できていることがある（混む夜・電波の弱い場所。負荷テスト 2026-10-14）。
  // 読み直して、押したとき（t0）より後に認証／受け取りが記録されていれば「できた」とみなす。
  // そうしないと読み直しで「もう認証されています（リングバウンティは受け取らないで）」と出て、受け取ったリングバウンティを返してしまう。
  async function landedAfterNet(kind, code, t0) {
    for (let k = 0; k < 3; k++) {
      try {
        if (kind === 'auth') { const x = (await C.staffTicket(saved.pin, code)).ticket; return x.status !== 'pending' && x.status !== 'void' && x.authAt && x.authAt >= t0 - 5000 ? x : null; }
        const x = (await C.staffPayout(saved.pin, code)).payout; return x.status === 'paid' && x.paidAt >= t0 - 5000 && (!x.paidBy || x.paidBy === saved.store || C.backend === 'firestore') ? x : null; // Firestore 版の paidBy はスタッフのログイン id（店の id ではない）なので、店でくらべると必ず「できていない」になっていた（コードレビュー）
      } catch (e) {
        if (e.code === 'already_paid' && e.body && e.body.payout) { const x = e.body.payout; return x.paidAt >= t0 - 5000 ? x : null; }
        if (e.code !== 'network') return null;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    return null;
  }

  function showAuth(t, p) {
    const S = { pending: '認証待ち', authorized: '認証済み（まだ投票していない）', voted: '投票済み', void: '無効' };
    const rate = t.rate != null ? t.rate : rateNow(), bounty = t.bounty != null ? t.bounty : t.count * rate; // 認証前は今の割合、認証済みは券に残した割合
    const head = '<div class="kind">認証</div><div class="amtk">チップ</div><div class="amt">' + chipsH(t.count) + '</div><div class="rbline">' + esc(rb(bounty)) + '</div>' +
      facts([['会計番号', t.bill], ['ニックネーム', t.nick]]); /* 「状態」の行は消した（2026-10-20 オーナーの文字帳。認証済み・無効などは下の赤い枠で出る） */ void S;
    if (t.storeId && t.storeId !== saved.store) return showNg('認証', 'ほかの店舗の QR です', '');
    if (t.status === 'void') { openSheet(head + '<div class="cause">対象外</div><div class="verdict ng">この QR は使えません<small>お客さんが「チップを変える」でやり直したか、古い QR です。お客さんのスマホの新しい QR を読んでください</small></div><button class="btn ghost big" data-x>閉じて次を読む</button>', 'bad'); return ($('sheet').querySelector('[data-x]').onclick = closeSheet); }
    if (t.status !== 'pending') {
      openSheet(head + '<div class="cause">処理済み</div><div class="verdict ng">もう認証されています' + (t.authAt ? '（' + hhmm(t.authAt) + '）' : '') + '<small>リングバウンティは受け取らないでください</small></div><button class="btn ghost big" data-x>閉じて次を読む</button>', 'bad');
      return ($('sheet').querySelector('[data-x]').onclick = closeSheet);
    }
    if (xState().closed) { // 参加受付の締切のあと: 受け取らない（サーバー・ルールも断る）
      openSheet(head + '<div class="cause">受付締切</div><div class="verdict ng red">参加受付は締め切りました<small>リングバウンティは受け取らないでください。お客さんには次のレースの受付が始まってから、もう一度 QR を見せてもらってください</small></div><button class="btn ghost big" data-x>閉じて次を読む</button>', 'bad');
      return ($('sheet').querySelector('[data-x]').onclick = closeSheet);
    }
    openSheet(head + '<div class="xleft" id="xleft">' + esc('参加受付 あと ' + mmss(xState().left)) + '</div><button class="btn ok big" id="doAuth">' + esc(rb(bounty)) + 'を<br>受け取って認証</button><button class="btn ghost" data-x>やめる</button>', 'auth');
    $('sheet').querySelector('[data-x]').onclick = closeSheet;
    $('doAuth').onclick = async () => {
      $('doAuth').disabled = true; $('doAuth').textContent = '認証しています…';
      const t0 = C.serverNow();
      const done = (tk) => {
        doneSheet('<div class="kind">認証</div><div class="verdict ok"><i class="chk">✓</i>認証しました<small>' + esc(tk.bill) + '・' + esc(tk.nick) + ' さん チップ ' + chips(tk.count) + '（' + esc(rb(tk.bounty != null ? tk.bounty : bounty)) + '）。お客さんのスマホが投票画面になります</small></div><button class="btn ok big" data-x>次を読む</button>', 'auth');
        $('sheet').querySelector('[data-x]').onclick = closeSheet;
        logsCache = null;
      };
      try { done((await C.auth(saved.pin, p.code, t.count, rate)).ticket); }
      catch (e) {
        if (e.code === 'network') { const b = $('doAuth'); if (b) b.textContent = '通信を確かめています…'; const x = await landedAfterNet('auth', p.code, t0); if (x) return done(x); }
        if (e.code === 'exchange_closed') return showNg('認証', '参加受付は締め切りました', 'リングバウンティは受け取らないでください（記録していません）');
        if (e.code === 'rate_changed') { const r2 = e.body && Number(e.body.rate); if (st && st.settings && r2) st.settings.bountyPerTicket = r2; toast('交換の割合が変わりました（' + rb(r2 || rateNow()) + ' ＝ 100pt）', true); return showAuth(Object.assign({}, t, { rate: null, bounty: null }), p); } // 受け取る枚数を出し直す（まだ記録していない）
        if (!pinGone(e)) showNg('認証', errText(e));
      }
    };
  }

  function showPay(py, p) {
    const rf = py.kind === 'refund', nv = !!py.novote, what = nv ? '返却（投票なし）' : rf ? '返還の受け取り' : '当たりの受け取り', chip = rf ? 'リングバウンティ' : 'リングチップ', give = rf ? '返す' : '渡す', gave = rf ? '返した' : '渡した';
    const back = rf ? payB(py) : 0, lbl = nv ? '返却' : rf ? '返還' : '当選額', money = rf ? rb(back) : '当選額 ' + ptT(py.amount); // 例「当選額 18,300pt」「リングバウンティ 600枚」（返却・返還はリングバウンティ。額ではない）
    const head = '<div class="kind">' + what + '</div><div class="amtk">' + (rf ? lbl + ' リングバウンティ' : lbl) + '</div><div class="amt">' + (rf ? amt(back) + '<small>枚</small>' : ptH(py.amount) + '<small class="rup">切り上げ済み</small>') + '</div>' + /* 2026-10-20 オーナー決定: 渡す額の横に小さく「切り上げ済み」（当選額は 10 の位で切り上げた額） */
      facts([['会計番号', py.bill], ['ニックネーム', py.nick]]); /* 「馬番」「状態」の行は消した（2026-10-20 オーナーの文字帳。受け取り済み・期限切れなどは下の赤い枠で出る） */
    if (py.storeId && py.storeId !== saved.store) return showNg(what, rf ? 'ほかの店舗の返還です' : 'ほかの店舗の当たりです', '当たった店舗でお受け取りください');
    const ng = (t, sub) => { openSheet(head + '<div class="verdict ng">' + esc(t) + '<small>' + esc(sub) + '</small></div><button class="btn ghost big" data-x>閉じて次を読む</button>', 'bad'); return ($('sheet').querySelector('[data-x]').onclick = closeSheet); };
    if (py.status === 'expired') return ng('受け取りの期限が切れています', '営業日が変わったので無効です。' + chip + 'は渡さないでください');
    if (py.status === 'void') return ng('このレースは返還になりました', 'この当たりは取り消しです。お客さんのスマホの新しい QR（返還）を読んでください');
    if (py.revealed === false && py.status === 'unpaid') return ng('まだ結果発表の前です', 'テレビの結果発表のあとに読み直してください');
    if (py.status === 'paid') {
      openSheet(head + '<div class="cause">処理済み</div><div class="verdict ng red">受取済み' + (py.paidAt ? '（' + hhmm(py.paidAt) + '）' : '') + '<small>二重に渡さないでください</small></div><button class="btn ghost big" data-x>閉じて次を読む</button>', 'bad');
      return ($('sheet').querySelector('[data-x]').onclick = closeSheet);
    }
    openSheet(head + (nv ? '<p class="note">投票締切までに投票がなかった券です。認証のときに受け取ったリングバウンティを返します</p>' : '') + '<button class="btn ok big" id="doPay">' + money + (rf ? 'を' : ' を') + give + '</button><button class="btn ghost" data-x>やめる</button>', 'pay');
    $('sheet').querySelector('[data-x]').onclick = closeSheet;
    $('doPay').onclick = () => {
      openSheet(head + '<div class="verdict ok" style="color:var(--cream)">' + money + (rf ? 'を' : ' を') + '<br>お客さんに' + (rf ? '返しましたか？' : '渡しましたか？') + (rf ? '' : '<small>受取額 ' + ptT(py.amount) + '</small>') + '</div><button class="btn ok big" id="doClaim">' + money + (rf ? 'を' : ' を') + gave + '（確定）</button><button class="btn ghost" data-x>' + (rf ? '返していない' : '渡していない') + '（戻る）</button>', 'pay');
      $('sheet').querySelector('[data-x]').onclick = () => showPay(py, p);
      $('doClaim').onclick = async () => {
        $('doClaim').disabled = true; $('doClaim').textContent = '記録しています…';
        const t0 = C.serverNow();
        const done = (x) => {
          doneSheet('<div class="kind">' + what + '</div><div class="verdict ok"><i class="chk">✓</i>記録しました<small>' + esc(x.bill) + '・' + esc(x.nick) + ' さん ' + (rf ? esc(rb(payB(x))) + 'を' + gave : '受取額 ' + ptT(x.amount)) + '</small></div><button class="btn ok big" data-x>次を読む</button>', 'pay');
          $('sheet').querySelector('[data-x]').onclick = closeSheet;
          logsCache = null;
        };
        try { done((await C.claim(saved.pin, p.code)).payout); }
        catch (e) {
          // 返事が来なかったが記録はできていた（押したあとの記録）→「記録しました」。できていなければ「通信できません」→ 読み直す
          if (e.code === 'network') { const b = $('doClaim'); if (b) b.textContent = '通信を確かめています…'; const x = await landedAfterNet('pay', p.code, t0); if (x) return done(x); }
          // expired: Firestore 版は見回り（15 分ごと）の前だと payout.status が 'unpaid' のまま返る → そのまま出すと「渡す」ボタンに戻ってくり返していた。状態を期限切れにして出す（コードレビュー 2026-10-14）
          if (e.code === 'expired') return showPay(Object.assign({}, (e.body && e.body.payout) || py, { status: 'expired' }), p);
          if (e.code === 'already_paid' && e.body && e.body.payout) return showPay(e.body.payout, p);
          if (pinGone(e)) return;
          showNg(what, errText(e));
        }
      };
    };
  }

  /* ================= 次へ（その店のテレビの結果画面を進める） ================= */
  function nowText() {
    const n = C ? C.serverNow() : Date.now(), last = st && st.last, open = st && st.open, live = st && st.live;
    if (live) return hhmm(live.at) + ' のレースを走っています（結果発表 ' + hhmm(live.revealAt) + '）';
    if (last && last.endAt > n) return 'テレビは ' + hhmm(last.at) + ' のレースの結果画面です（あと ' + mmss(last.endAt - n) + ' で自動で終わります）';
    if (open) return n < xAt(open) ? hhmm(open.at) + ' のレースの参加受付中（参加受付 あと ' + mmss(xAt(open) - n) + '・投票締切 ' + hhmm(open.closeAt) + '）' : hhmm(open.at) + ' のレース: 参加受付は締切・投票中（投票締切まで ' + mmss(open.closeAt - n) + '）';
    return '次のレースを待っています';
  }
  let nextKey = '';
  function drawNext(force) {
    const v = $('nextView'); if (v.classList.contains('hidden')) return;
    const open = st && st.open, p = open && open.participants;
    // 毎秒は文字だけ書き換える（ボタンを作り直すと、押している最中のタップが消える）
    const key = [p && p.total, p && (p.byStore || {})[saved.store], st && st.next && st.next.at].join('|');
    if (!force && key === nextKey && $('nowTxt') && $('doNext')) { $('nowTxt').textContent = nowText(); return; }
    nextKey = key;
    v.innerHTML = '<div class="panel"><h4>いまのテレビ</h4><p class="note" id="nowTxt">' + esc(nowText()) + '</p>' +
      (p ? '<div class="stat"><span>参加（全店）</span><b>' + (p.total || 0) + ' 人</b></div><div class="stat"><span>参加（この店）</span><b>' + ((p.byStore || {})[saved.store] || 0) + ' 人</b></div>' : '') +
      (st && st.next ? '<div class="stat"><span>次のレース</span><b>' + hhmm(st.next.at) + '</b></div>' : '') + '</div>' +
      '<div class="panel"><h4>結果画面を次へ</h4><p class="note">この店のテレビだけ、結果画面を閉じて待ち時間の画面にします。次のレースは時刻表どおりに始まります（全店同時）。</p>' +
      '<button class="btn ok big" id="doNext">テレビを次へ進める</button></div>' +
      '<div class="panel trace"><h4>テスト用</h4><p class="note">この店のテレビだけで、テストのレースが走ります（参加受付 1 分 → 投票 → 発走。発走までの時間は下に出します。お客さんも参加・投票できます。集計には入りません）。上の「テレビ」からも押せます。</p><p class="note trs" id="trState"></p>' +
      '<button class="btn ghost" id="doTest">この店だけテストレース</button></div>';
    $('doTest').onclick = testPress;
    drawTest();
    if (Date.now() - trAt > 10000) testPoll(true); // 画面を作り直すたびには読まない（参加人数が変わるたびに作り直すので）
    $('doNext').onclick = async () => {
      if (!confirm('この店のテレビの結果画面を閉じますか？')) return;
      $('doNext').disabled = true;
      try { const d = await C.next(saved.pin); toast('テレビを次へ進めました（' + d.nextSeq + '）'); } catch (e) { if (!pinGone(e)) toast(errText(e), true); }
      $('doNext').disabled = false;
    };
  }

  /* ================= この店だけテストレース（2026-10-19） =================
     押せないとき: 進行役のテレビがいない／この店でレースの受付中・レース中・結果画面のあいだ／押したあと（準備中・そのレースが終わるまで） */
  let trS = null, trAt = 0, trBusy = false, trT = 0, trMsg = '', trExt = false; const trCbs = [];
  const TEST_SEC = 90; // 2026-10-19 その 2: 2 分 → 1 分。2026-10-20 その 5: 1 分半（参加受付 1 分・投票 30 秒＝core.js の TEST_RACE.quickSec・testStages。投票できるように）
  /* その 3（2026-10-19）: 店のテレビが casa SLOT なら、押すと casa DERBY に切り替えてすぐ走らせる（client の testRace の switchTv。終わったあと SLOT には戻さない）。
     進行役のテレビ自身の店が SLOT になっているだけのとき（trS.wake）も押せる: DERBY にして、進行役が戻ってから作る（戻るまで最大 90 秒「切り替えています…」） */
  /* その 4（2026-10-20）: 店のテレビが casa SLOT のゲーム中（回転中・CREDIT 残り・設定画面）なら、終わって casa DERBY に来てから作る（進行役のテレビが derbyTvs の名乗りで確かめる）。
     待つのは 5 分まで（Core.TEST_RACE.tvWaitSec。過ぎたら進行役が err 'tv_wait' ＝理由を出す）。押してから 20 秒は「切り替えています…」、そのあと「ゲーム中です。終わってから切り替えます」。
     押せるかの判断（その 4 の 1）: 「まだ締め切っていない次のレースがある」だけでは止めない。紙幣のページ（js/phoneswitch.js の clash）と同じく、
     店のレースの「受付の始まり〜結果画面の終わり」が、押してから走り終わるまでとぶつかるときだけ止める（時刻表のレースは 15 分先まで作ってあるため） */
  const TV_WAIT_MS = 300000, GRACE_MS = 20000, SWITCH_SEC = 120; // core.js の TEST_RACE の tvWaitSec・tvGraceSec・switchSec と同じ（このページは core.js を先に読まないことがあるので数で持つ）
  const WAIT_MS = TV_WAIT_MS + 15000; // 進行役が理由を書くまで（5 分＋少し）
  const trPending = (r, n) => !!r && !r.raceId && !r.err && n - r.at < WAIT_MS;
  const numOr = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
  /* その 6（2026-10-20）: 参加受付は必ず 1 分（core.js の TEST_RACE.exchangeSec）。投票はこの店で効く秒数（いつもの状態の settings.voteSec。店の上書きつき）。
     本番の投票が 45 秒だと 1 分 45 秒後に発走（前は 1 分半のまま参加受付が 45 秒に縮んでいた）。押してから発走までと説明の文はここで出す */
  const TEST_EX = 60;
  function testPlan(sw) { const S = (st && st.settings) || {}, vo = Math.max(0, numOr(S.voteSec, 30)), lead = Math.max(0, numOr(S.closeLeadSec, 0)); return { ex: TEST_EX, vo, total: Math.max(TEST_SEC, TEST_EX + vo + lead), wait: sw ? SWITCH_SEC - TEST_SEC : 0 }; }
  function durText(s) { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; return m ? m + ' 分' + (r === 30 ? '半' : r ? ' ' + r + ' 秒' : '') : r + ' 秒'; }
  const stagesText = (p) => '参加受付 ' + durText(p.ex) + ' → 投票 ' + durText(p.vo);
  function trClash(n, sec) { // [押せない理由] 'now' ＝受付中・レース中・結果画面／レース ＝もうすぐ次のレース／null ＝ぶつからない
    if (!st) return null;
    const S = st.settings || {}, gate = S.scenes && S.scenes.gate === false ? 0 : numOr(S.gateSec, 8), post = numOr(S.postSec, 28), res = numOr(S.resultSec, 300), bet = numOr(S.betSec, 120);
    const end = n + (sec + gate + 60 + post + res) * 1000, seen = new Set();
    const list = [st.live, st.last, st.open, st.next].filter((r) => r && !seen.has(r.id) && seen.add(r.id));
    // 時刻表の予定（st.upcoming）は見ない: 紙幣のページと同じく、作ってあるレースだけ（進行役が 15 分先まで作る。作るときに進行役も確かめる）
    for (const r of list) {
      if (r.status === 'void') continue;
      const s = r.openAt != null ? r.openAt : r.at - bet * 1000;
      const e = r.endAt || (r.revealAt ? r.revealAt + res * 1000 : (r.runAt || r.at) + 60000 + (post + res) * 1000);
      if (s < end && e > n) return s <= n ? 'now' : r;
    }
    return null;
  }
  async function testPoll(now0) {
    clearTimeout(trT);
    if ((mode !== 'next' && !trExt) || !C || !C.testRaceStatus) return; // trExt: 「テレビ」のシートを開いている間（v2/staffswitch.js）
    try { trS = await C.testRaceStatus(saved.pin); trAt = Date.now(); } catch (e) { if (pinGone(e)) return; trS = trS || null; }
    drawTest();
    const r = trS && trS.req, pending = trPending(r, C.serverNow());
    trT = setTimeout(testPoll, pending ? (C.serverNow() - r.at < GRACE_MS ? 3000 : 5000) : 30000); // 準備中は 3 秒ごと（テレビのゲームが終わるのを待つ間は 5 秒ごと。その 4）、ふだんは 30 秒ごと（この画面か「テレビ」のシートを開いているときだけ）
  }
  function testWhy() {
    const n = C ? C.serverNow() : Date.now(), r = trS && trS.req;
    if (!trS) return ['読み込み中…', true];
    if (trPending(r, n)) return [testWaitText(r, n, !!trS.decider), true];
    if (r && r.raceAt && r.raceAt > n) return ['テストのレース 発走まで ' + mmss(r.raceAt - n), true];
    const gaveUp = !!r && !r.raceId && (r.err === 'tv_wait' || !r.err) && n - r.at < WAIT_MS + 180000; // その 4: 5 分待ってやめた（押し直しはできる）
    const note = gaveUp ? (r.err === 'tv_wait' || trS.decider ? TV_GAVE_UP : '進行役のテレビが戻りませんでした。テレビを確かめてください') : '';
    if (!trS.decider && !trS.wake) return [trS.deciderStore && trS.deciderGame === 'slot' ? '進行役のテレビ（' + (trS.deciderName || trS.deciderStore) + '）が casa SLOT になっています' : '進行役のテレビがありません', true];
    const sw = trS.game === 'slot' && !trS.wake, tp = testPlan(sw), c = trClash(n, tp.total + tp.wait); // その 4 の 1: 紙幣のページと同じ判断・同じ言葉
    if (c === 'now') return ['いまはレース中です', true]; // 2026-10-20 オーナーの文字帳 t0508「受付中・レース中は押せません」を消す → 押せない理由が分からなくならないよう短い言い方に
    if (c) return ['もうすぐ次のレース（' + hhmm(c.at) + ' 発走）があるので押せません', true];
    if (r && r.err === 'busy' && n - r.at < 120000) return ['作れませんでした（もうすぐ次のレースです）', true];
    return [note || trMsg, false];
  }
  const TV_GAVE_UP = 'テレビのスロットのゲームが 5 分たっても終わらなかったので、やめました。ゲームが終わってからもう一度押してください';
  function testWaitText(r, n, alive) { // 待っている間の文（紙幣のページ js/phoneswitch.js と同じ言葉）
    if (alive && r.startIn !== SWITCH_SEC && !r.wait) return '準備中…（進行役のテレビがレースを作っています）';
    if (n - r.at < GRACE_MS || (alive && !r.wait)) return alive ? 'テレビを casa DERBY に切り替えています…' : 'テレビを casa DERBY に切り替えています…（進行役のテレビが戻るのを待っています）';
    return 'テレビはスロットのゲーム中です。終わってから切り替えます';
  }
  function testHint() { // 押せるときの説明（テレビが SLOT なら切り替えてから）
    const tp = testPlan(false);
    if (!trS || trS.game !== 'slot') return '押すと ' + durText(tp.total) + '後に発走します（' + stagesText(tp) + '）';
    return '押すとテレビを casa DERBY に切り替えて、' + (trS.wake ? '進行役のテレビが戻ってから ' : 'テレビが切り替わってから ') + durText(tp.total) + '後に発走します（スロットのゲーム中は、終わるまで待ちます）';
  }
  function drawTest() {
    trCbs.forEach((cb) => { try { cb(); } catch (e) { /* noop */ } }); // 「テレビ」のシートの同じ表示も塗り直す
    const el = $('trState'), b = $('doTest'); if (!el || !b) return;
    const [t, off] = testWhy(); el.textContent = t || testHint(); b.disabled = off || trBusy;
  }
  async function testPress() {
    const [, off] = testWhy(); if (off || trBusy) return;
    const sw = !!trS && trS.game === 'slot', tp = testPlan(false);
    if (!confirm(sw ? saved.name + 'のテレビを casa DERBY に切り替えて、テストのレースを走らせます（' + (trS.wake ? '進行役のテレビが戻ってから ' : 'テレビが切り替わってから ') + durText(tp.total) + '後に発走）。'
      : saved.name + 'のテレビだけで、' + durText(tp.total) + '後にテストのレースが走ります（' + stagesText(tp) + ' → 発走）。お客さんも参加・投票できます（集計には入りません）。')) return;
    trBusy = true; drawTest();
    try { const d = await C.testRace(saved.pin, TEST_SEC, { switchTv: true }); toast(d && d.switched ? 'テレビを casa DERBY に切り替えました' : d && d.raceId ? 'テストのレースを作りました' : 'テストのレースをお願いしました'); trMsg = ''; }
    catch (e) { if (!pinGone(e)) { toast(errText(e), true); trMsg = errText(e); } } // 理由はボタンの上にも残す（「テレビ」のシートでは知らせが隠れるため）
    trBusy = false; testPoll(true);
  }

  /* ================= 記録（今日、会計番号ごと） ================= */
  async function refreshLogs() {
    try { logsCache = await C.logs(saved.pin, {}); drawLogs(); } catch (e) { if (pinGone(e)) return; if (!logsCache) $('logsView').innerHTML = '<div class="panel"><p class="note">記録を読み込めませんでした。' + esc(errText(e)) + '</p><button class="btn" id="lr">もう一度</button></div>'; const b = $('lr'); if (b) b.onclick = refreshLogs; }
  }
  // 記録を会計番号ごとに集計（当たり・受け取り・返還・期限切れ。返還で取り消された当たりは数えない）。total=true なら { all } も
  // 額（当選額・受取額・期限切れ）とリングバウンティ（受け取った・返却・返還・返した）は別の項目（混ぜない。2026-10-17）
  function sumLogs(logs, total) {
    const Z = () => ({ auth: 0, bounty: 0, win: 0, paid: 0, refund: 0, refundPaid: 0, expired: 0, refundExpired: 0, ret: 0, retPaid: 0, retExpired: 0 });
    const refundTid = new Set(), paidPid = new Set(), out = {}, all = Object.assign(Z(), { unclaimed: 0, unreturned: 0 });
    const retTid = new Set(); logs.forEach((l) => { if (l.type === 'refund') refundTid.add(l.tid); if (l.type === 'paid') paidPid.add(l.pid); if (l.type === 'return') retTid.add(l.tid); });
    logs.forEach((l) => {
      const x = out[l.bill] = out[l.bill] || Z(), n = Number(l.count) || 0, b = logB(l);
      if (l.type === 'auth') { x.auth += n; x.bounty += b; }
      else if (l.type === 'return') x.ret += b; /* 返却（投票しなかった券）: リングバウンティ */
      else if (l.type === 'paid' && l.novote) x.retPaid += b;
      else if (l.type === 'expired' && l.kind === 'refund' && retTid.has(l.tid)) x.retExpired += b;
      else if (l.type === 'win') { if (!(refundTid.has(l.tid) && !paidPid.has(l.pid))) x.win += n; }
      else if (l.type === 'paid') { if (l.kind === 'refund') x.refundPaid += b; else x.paid += n; }
      else if (l.type === 'refund') x.refund += b;
      else if (l.type === 'expired') { if (l.kind === 'refund') x.refundExpired += b; else x.expired += n; }
    });
    Object.keys(out).forEach((k) => { const x = out[k]; x.unclaimed = Math.max(0, x.win - x.paid - x.expired); x.unreturned = Math.max(0, x.refund - x.refundPaid - x.refundExpired) + Math.max(0, x.ret - x.retPaid - x.retExpired); Object.keys(all).forEach((f) => { all[f] += x[f] || 0; }); });
    return total ? { all } : out;
  }
  let logLimit = 200;
  // 記録 1 行の数字: 認証は「30枚・リングバウンティ 600枚」、返却・返還は「リングバウンティ 600枚」、当たり・受け取りは額
  const logVal = (l) => (l.type === 'auth' ? 'チップ ' + chips(l.count) + '・' + rb(logB(l)) : (l.type === 'return' || l.type === 'refund' || ((l.type === 'paid' || l.type === 'expired') && l.kind === 'refund')) ? rb(logB(l)) : ptT(l.count)); // 当選額・受取額は「pt」
  function drawLogs() {
    const v = $('logsView'); if (v.classList.contains('hidden')) return;
    if (!logsCache) { v.innerHTML = '<div class="panel"><p class="note">読み込み中…</p></div>'; return; }
    const logs = (logsCache.logs || []).slice().sort((a, b) => b.at - a.at);
    const nick = {}; logs.forEach((l) => { if (!nick[l.bill]) nick[l.bill] = l.nick; });
    const by = sumLogs(logs), bills = Object.keys(by), sum = sumLogs(logs, true).all;
    const K = { auth: '認証', win: '当選', paid: '受け取り', refund: '返還', expired: '期限切れ', return: '返却' };
    const all = logFilter ? logs.filter((l) => l.bill === logFilter) : logs, shown = all.slice(0, logLimit);
    v.innerHTML = '<div class="panel"><h4>今日の合計</h4>' +
      '<div class="stat"><span>チップ（認証）</span><b>' + chips(sum.auth) + '</b></div><div class="stat"><span>受け取ったリングバウンティ</span><b>' + amt(sum.bounty) + ' 枚</b></div>' +
      '<div class="stat"><span>当選額</span><b>' + ptT(sum.win) + '</b></div><div class="stat"><span>受取額（渡した）</span><b>' + ptT(sum.paid) + '</b></div>' +
      (sum.ret ? '<div class="stat"><span>返却（投票なし）リングバウンティ</span><b>' + amt(sum.ret) + ' 枚（返した ' + amt(sum.retPaid) + '）</b></div>' : '') +
      (sum.refund ? '<div class="stat"><span>返還（不成立）リングバウンティ</span><b>' + amt(sum.refund) + ' 枚（返した ' + amt(sum.refundPaid) + '）</b></div>' : '') +
      (sum.expired ? '<div class="stat"><span>期限切れ（渡していない当選額）</span><b>' + ptT(sum.expired) + '</b></div>' : '') +
      (sum.unclaimed > 0 ? '<div class="stat"><span>未受け取りの当選額</span><b style="color:#ffb84d">' + ptT(sum.unclaimed) + '</b></div>' : '') +
      (sum.unreturned > 0 ? '<div class="stat"><span>まだ返していないリングバウンティ</span><b style="color:#ffb84d">' + amt(sum.unreturned) + ' 枚</b></div>' : '') + '</div>' +
      '<div class="panel"><h4>会計番号ごと</h4>' + (bills.length ? '<table class="tbl"><tr><th>会計番号</th><th>チップ</th><th>リングバウンティ</th><th>当選額</th><th>受取額</th></tr>' +
        bills.map((b) => { const x = by[b]; return '<tr data-bill="' + esc(b) + '" class="' + (logFilter === b ? 'open' : '') + '"><td><b>' + esc(b) + '</b><br><small style="color:var(--dim)">' + esc(nick[b] || '') + '</small></td><td>' + chips(x.auth) + '</td><td>' + amt(x.bounty) + '</td><td>' + ptT(x.win) + '</td><td class="' + (x.unclaimed > 0 || x.unreturned > 0 ? 'warn' : '') + '">' + ptT(x.paid) + (x.ret ? '<br><small style="color:var(--dim)">返却 リングバウンティ ' + amt(x.retPaid) + '/' + amt(x.ret) + '</small>' : '') + (x.refund ? '<br><small style="color:var(--dim)">返還 リングバウンティ ' + amt(x.refundPaid) + '/' + amt(x.refund) + '</small>' : '') + '</td></tr>'; }).join('') + '</table><p class="note" style="margin-top:8px">行を押すと、その会計番号の記録だけを下に出します。</p>' : '<p class="note">今日の記録はまだありません。</p>') + '</div>' +
      '<div class="panel"><h4>' + (logFilter ? '会計 No.' + esc(logFilter) + ' の記録 <a href="#" id="lfAll" style="color:var(--gold);font-size:12px;margin-left:8px">全部を出す</a>' : '記録（新しい順）') + '</h4><div class="hist">' +
        (shown.length ? shown.map((l) => '<div class="r"><small>' + hhmm(l.at) + '</small><span class="k ' + esc(l.type) + '">' + esc(l.type === 'paid' && l.novote ? '返却の受取' : l.type === 'paid' && l.kind === 'refund' ? '返還の受取' : K[l.type] || l.type) + '</span><span style="flex:1">No.' + esc(l.bill) + ' ' + esc(l.nick || '') + '</span><b>' + esc(logVal(l)) + '</b></div>').join('') : '<p class="note">まだありません。</p>') +
      (all.length > shown.length ? '<button class="btn ghost" id="lmore">もっと見る（あと ' + (all.length - shown.length) + ' 件）</button>' : '') +
      '</div></div><button class="btn ghost" id="lref">更新</button>';
    const more = $('lmore'); if (more) more.onclick = () => { logLimit += 200; drawLogs(); };
    v.querySelectorAll('[data-bill]').forEach((tr) => { tr.onclick = () => { logFilter = logFilter === tr.dataset.bill ? null : tr.dataset.bill; drawLogs(); }; });
    const lfAll = $('lfAll'); if (lfAll) lfAll.onclick = (e) => { e.preventDefault(); logFilter = null; drawLogs(); };
    $('lref').onclick = refreshLogs;
  }

  /* ================= 起動 ================= */
  function start() {
    C = window.DerbyCloud.create({ store: saved.store, role: 'staff' });
    C.syncClock().catch(() => {});
    C.state().then((d) => { st = d; online = true; drawTop(); drawNext(); }).catch(() => { online = false; drawTop(); });
    if (unsub) unsub();
    unsub = C.subscribe({
      open() { online = true; drawTop(); },
      error() { online = false; drawTop(); },
      state(s) { st = s; online = true; drawTop(); drawXBanner(); if (mode === 'next') drawNext(); },
      payout() { if (mode === 'logs') refreshLogs(); else logsCache = null; },
      ticket() { if (mode === 'logs') refreshLogs(); },
    });
    $('tabs').classList.remove('hidden');
    drawTop(); setMode(mode);
  }
  setInterval(() => {
    if (mode === 'next' && !$('nextView').classList.contains('hidden')) { const el = $('nowTxt'); if (el) el.textContent = nowText(); drawTest(); }
    if (saved && C) drawXBanner();
    const xl = $('xleft'); if (xl) { const x = xState(); xl.textContent = x.closed ? '参加受付は締め切りました' : '参加受付 あと ' + mmss(x.left); xl.classList.toggle('shut', x.closed); const b = $('doAuth'); if (b && x.closed && !b.disabled) { b.disabled = true; b.innerHTML = '参加受付は締め切りました<br><small>受け取らないでください</small>'; } } // 確認の画面を開いたまま締切をまたいだ
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCam(); else if (saved && (mode === 'auth' || mode === 'pay')) startCam(); });

  window.STAFF = { inject: (t) => handleCode(t, 'test'), get mode() { return mode; }, setMode, get C() { return C; }, get saved() { return saved; }, get sheetOpen() { return sheetOpen; }, closeSheet, xState, get st() { return st; },
    /* この店だけテストレース（2026-10-19 その 2）: 「テレビ」のシートが使う。watch(true) の間は状態を読み続ける・onChange で塗り直しを知らせる */
    test: { why: testWhy, hint: testHint, press: testPress, get s() { return trS; }, get busy() { return trBusy; }, sec: TEST_SEC, watch(on) { trExt = !!on; if (on) { if (Date.now() - trAt > 3000) testPoll(true); } else if (mode !== 'next') clearTimeout(trT); }, onChange(cb) { trCbs.push(cb); } } }; // sheetOpen: v2/staffswitch.js が見る（確認の画面の途中では画面を入れ替えない。2026-10-19）。st: いつもの状態（テレビの画質 settings.tvQuality を staffswitch.js が見る。2026-10-19）

  (async function boot() {
    if (!window.DerbyCloud) { $('login').classList.remove('hidden'); $('login').innerHTML = LOGO_H1 + '<p>読み込みに失敗しました。ページを開き直してください。</p>'; return; }
    saved = load();
    if (qs.get('store') && saved && saved.store !== qs.get('store')) saved = null;
    if (!saved || !saved.store || !saved.pin) await login();
    start();
  })();
})();
