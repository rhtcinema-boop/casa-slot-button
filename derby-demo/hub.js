/* casa DERBY Web デモの舞台（index.html）。サーバーなしで、ブラウザの中だけで全部が動く。v4（2026-10-21）: 参加無料・1 票 ＝ 会計番号 2 けた・2 連単だけ。
   - にせ Firestore（v2/fake-firestore.js）を 1 つ持ち、ルール（demo-rules.js ＝ v2/firestore.rules の JS の写し）を当てる。テレビ・スマホ・スタッフ・管理画面（iframe）は demo-config.js 経由でこれを使う
   - 最初に管理のアカウントで店舗（渋谷・上野・札幌、PIN 1234）・投票の時間（90 秒）・時刻表（4 分ごと・全店同じ）を入れる。レースを作って決めるのは、ふつうどおりテレビ（決める係）
   - テレビが止まったときの控えとして、舞台も決める係の順番待ちに入る（テレビが 25 秒たっても始めないとき・止まって期限が切れたとき）
   - ほかのお客さん（自動）: 上野・札幌・渋谷のお客さんが、投票の時間に 2 連単で投票する（会計番号・ニックネーム・1 着・2 着）。何人かは選び直す
     「当たりを体験しやすくする」（初めは入）: 渋谷店のお客さん（あなた）が投票したレースは、締切の 30 秒前から、ほかのお客さんがあなたと同じ組み合わせに選び直す
     （そのあとに投票するお客さんも同じ組み合わせ。あなたが選び直したら、また寄せる。締切の 3 秒前まで）＝ほぼ必ず当たる
   - 「QR を読む」ボタン: カメラの代わりに、テレビの QR の中身（…/v2/bet.html?store=shibuya）をお客さんのスマホで開く
   - スタッフのスマホのボタン: 今日の当たり一覧・番号を空ける（お客さんの番号を入れておく）・テストレース
   - お客さんのスマホ・スタッフのスマホは、読み込み直しても同じ「ログイン」（本物のスマホと同じ。選び直し・受け取りができるのは最初に投票したスマホだけ）
   テスト用: window.DEMO_HUB */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MASTER = 'master@demo.casa-derby.invalid', MASTER_PW = 'demo1234';
  const TV_EMAIL = 'tv@demo.casa-derby.invalid', TV_PW = 'tv-' + Math.random().toString(36).slice(2, 12);
  const PIN = '1234', STORE = 'shibuya';
  const STORES = [{ id: 'shibuya', name: '渋谷', pin: PIN }, { id: 'ueno', name: '上野', pin: PIN }, { id: 'sapporo', name: '札幌', pin: PIN }];
  // 4 分（240 秒）ごと・投票 90 秒。間隔の目安（Core.minGapSec）＝ 投票 90 ＋ ゲート 8 ＋ 走り 60 ＋ ゴール後 28 ＋ 写真判定 12 ＝ 198 秒 ≦ 240
  const EVERY_MIN = 4, VOTE_SEC = 90, TARGET = 5000; // TARGET: 1 レースの当選額の目標（pt）
  const LOG = [];
  const log = (m) => { LOG.push(new Date().toISOString().slice(11, 19) + ' ' + m); if (LOG.length > 300) LOG.shift(); };

  // 前に開いたときのスマホ・スタッフの記録（このページの中のデータとは合わない）を消す
  try {
    ['casa.derby.bet.v3', 'casa.derby.staff.v1', 'casa.derby.tvkey'].forEach((k) => localStorage.removeItem(k));
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.indexOf('casa.derby.vote.') === 0) localStorage.removeItem(k); } // 票の持ち主のしるし（v2/client.js の myVotes）
    sessionStorage.removeItem('casa.derby.admin.pw');
  } catch (e) { /* 保存が使えない */ }

  /* ---------- にせ Firestore ---------- */
  const fake = FakeFirestore.create({ rules: window.DemoRules(MASTER, TV_EMAIL) });
  fake.addUser(MASTER, MASTER_PW); fake.addUser(TV_EMAIL, TV_PW);

  // 画面ごとの入口。見張り（onSnapshot）を覚えておき、その画面が閉じたら止める（読み込み直した古い画面に通知し続けないように）。
  // お客さんのスマホ・スタッフのスマホは、読み込み直しても同じログイン（本物の Firebase は匿名ログインを端末に覚える）
  const keepAuth = {};
  function clientFor(win, label) {
    const keep = win && win !== window && (label === 'bet' || label === 'staff');
    const c = keep ? (keepAuth[label] = keepAuth[label] || fake.client(label)) : fake.client(label), reg = new Set();
    const track = (u) => { reg.add(u); return () => { reg.delete(u); u(); }; };
    const wq = (q) => Object.assign({}, q, {
      where: (...a) => wq(q.where(...a)), orderBy: (...a) => wq(q.orderBy(...a)), limit: (n) => wq(q.limit(n)),
      onSnapshot: (...a) => track(q.onSnapshot(...a)),
      doc: q.doc ? (id) => wd(q.doc(id)) : undefined,
      add: q.add ? async (d) => wd(await q.add(d)) : undefined,
    });
    const wd = (r) => Object.assign({}, r, { collection: (x) => wq(r.collection(x)), onSnapshot: (...a) => track(r.onSnapshot(...a)) });
    const db = { collection: (x) => wq(c.db.collection(x)), doc: (p) => wd(c.db.doc(p)), runTransaction: c.db.runTransaction, batch: c.db.batch, enablePersistence: c.db.enablePersistence };
    if (win && win !== window) {
      const kill = () => { reg.forEach((u) => { try { u(); } catch (e) { /* なし */ } }); reg.clear(); };
      try { win.addEventListener('pagehide', kill); } catch (e) { /* なし */ }
    }
    return { db, auth: c.auth, FieldValue: c.FieldValue, Timestamp: c.Timestamp };
  }
  const env = (label) => ({ fb: clientFor(window, label), Engine: window.Engine, Outcome: window.Outcome, Core: window.DerbyCore, config: { masterEmail: MASTER, tvEmail: TV_EMAIL } });
  const mk = (opts, label) => DerbyFirestore.create(opts, env(label));

  /* ---------- 最初の設定（管理画面と同じ手順） ---------- */
  function timetable() {
    // 時刻表の時刻 ＝ 走り出す時刻（投票はその 90 秒前から）。最初のレースが開いてから 100〜160 秒後に走り出すように 4 分の刻みをずらす（＝投票は 10〜70 秒後から）
    const t = Date.now() + 9 * 3600e3, inDay = t % 86400000, m0 = Math.ceil((inDay + 100000) / 60000), off = m0 % EVERY_MIN;
    // 2026-10-30: 時刻表の時刻は営業日の時計（05:00〜28:59。深夜は 24:00〜）になったので、05:xx から 28:5x まで（4 分の刻みのずれは 5 時ちょうどでも同じ。300 も 1440 も 4 で割り切れる）。以前の '00:xx' は「時刻は 05:00〜28:59 で」で止まっていた
    const p = (n) => String(n).padStart(2, '0'), last = 29 * 60 - EVERY_MIN + off;
    return [{ id: 'demo', name: 'デモ', kind: 'daily', from: '05:' + p(off), to: p(Math.floor(last / 60)) + ':' + p(last % 60), everyMin: EVERY_MIN, payout: TARGET, scope: 'all', storeId: null }]; // 全店同じ
  }
  let standby = null;
  const ready = (async () => {
    const adm = mk({ role: 'admin' }, 'hub-admin'), A = adm.admin(MASTER_PW);
    await A.config();
    await A.saveStores(STORES);
    await A.saveTuning({ voteSec: VOTE_SEC, stamp: { on: true } }); // スタンプラリー（2026-11-02。仮・デモで確かめる）
    await A.saveTimetable(timetable());
    log('seeded');
  })();
  ready.catch((e) => { console.error('demo seed', e); toast('準備に失敗しました。読み込み直してください', true); });

  // 決める係の控え（舞台）。テレビが先に決める係になる。テレビが 25 秒たっても始めない・止まったら、こちらが続ける
  function startStandby() {
    if (standby) return;
    standby = mk({ role: 'tv', store: null, tvPassword: TV_PW }, 'hub-decider');
    standby.ready().then(() => log('standby ready')).catch((e) => console.error('standby', e));
  }
  ready.then(() => setTimeout(startStandby, 25000));

  /* ---------- 舞台の入口（demo-config.js が使う） ---------- */
  window.__derbyDemo = {
    MASTER, TV_EMAIL, ready, clientFor,
    tvPassFor: (w) => (F.tv && w === F.tv.contentWindow ? TV_PW : null),
    pageStart(w, kind) {
      // テレビを読み込み直したとき: 前のテレビが持っていた「決める係」の鍵を外す（60 秒待たずに新しいテレビが続ける）
      if (kind !== 'tv') return;
      const rec = fake.raw.get('derbyLock/decider');
      if (rec && !(standby && standby.decider && rec.data.holder === standby.decider.me)) fake.raw.delete('derbyLock/decider');
    },
  };

  /* ---------- ほかのお客さん（自動・2 連単） ---------- */
  const NICKS = ['ゆうき', 'さくら', 'たけし', 'みほ', 'けんた', 'あやか', 'しょう', 'まどか', 'りく', 'なつみ', 'こうじ', 'はるか', 'だいすけ', 'えみ', 'そうた', 'ひなた', 'つよし', 'まい', 'れん', 'ゆい', 'ごろう', 'ちひろ', 'カズ', 'ミキ'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pad2 = (n) => String(n).padStart(2, '0');
  const bots = { planned: 0, voted: 0, revoted: 0, followed: 0, failed: 0 };
  const plans = {}; // レース id → { r, list: [{ store, bill, nick, ph, combo }], used: { store: Set(bill) }, follow: '' }
  const botVids = new Set();
  let follow = true; // 当たりを体験しやすくする
  const FOLLOW_MS = 30000; // 締切の 30 秒前から寄せる
  const nowMs = () => Date.now();
  function racesNow() { const out = []; for (const [p, rec] of fake.raw) if (p.startsWith('derbyRaces/')) out.push(rec.data); return out; }
  function openRaces() { const t = nowMs(); return racesNow().filter((r) => r.status === 'upcoming' && r.openAt != null && r.openAt <= t && t < r.closeAt - 6000); }
  // 人気の組み合わせほど選ばれやすい（倍率の逆数の重み）
  function chooseCombo(r) {
    const ex = r.exacta || {}, ks = Object.keys(ex).filter((k) => Number(ex[k]) > 0);
    if (!ks.length) { const a = Math.floor(Math.random() * 6), b = (a + 1 + Math.floor(Math.random() * 5)) % 6; return [a, b]; }
    const w = ks.map((k) => Math.pow(1 / Number(ex[k]), 1.1)), sum = w.reduce((a, b) => a + b, 0);
    let x = Math.random() * sum; for (let i = 0; i < ks.length; i++) { x -= w[i]; if (x <= 0) return ks[i].split('-').map(Number); }
    return ks[0].split('-').map(Number);
  }
  function newBill(P, store) {
    const used = P.used[store] = P.used[store] || new Set();
    // 渋谷店のほかのお客さんは 81〜99 番（あなたが入れそうな番号とぶつかりにくく）。上野・札幌は 01〜99 番
    const lo = store === STORE ? 81 : 1, hi = 99;
    for (let i = 0; i < 200; i++) { const b = pad2(lo + Math.floor(Math.random() * (hi - lo + 1))); if (!used.has(b)) { used.add(b); return b; } }
    return null;
  }
  function planRace(r) {
    if (plans[r.id]) return;
    const P = plans[r.id] = { r, list: [], used: {}, follow: '' };
    const n = 7 + Math.floor(Math.random() * 6), t = nowMs(), from = Math.max(t + 1500, r.openAt + 3000), to = Math.max(from + 1000, r.closeAt - 15000);
    for (let i = 0; i < n; i++) {
      const store = i === 0 ? STORE : pick(['ueno', 'sapporo', 'ueno', 'sapporo', STORE]); // 渋谷店にも 1 人以上（スタッフの「今日の当たり」に出るように）
      const at = rnd(from, to);
      setTimeout(() => runBot(P, store).catch((e) => { bots.failed++; log('bot ' + (e.code || e.message)); }), at - t);
    }
    bots.planned += n;
    log('plan ' + r.id + ' x' + n);
  }
  async function runBot(P, store) {
    const r = P.r, bill = newBill(P, store); if (!bill) return;
    const ph = mk({ role: 'phone', store }, 'bot'), nick = pick(NICKS), [first, second] = P.follow ? P.follow.split('-').map(Number) : chooseCombo(r);
    const res = await ph.vote({ raceId: r.id, bill, nick, first, second });
    const me = { store, bill, nick, ph, combo: first + '-' + second };
    P.list.push(me); botVids.add(res.vote.vid); bots.voted++;
    // 3 人に 1 人くらいは、締切の前に選び直す
    if (Math.random() < 0.35) {
      const at = rnd(nowMs() + 5000, r.closeAt - 12000);
      if (at > nowMs() + 2000) setTimeout(() => { if (P.follow) return; const c = chooseCombo(r); revote(P, me, c[0], c[1]).then(() => { bots.revoted++; }).catch((e) => { bots.failed++; log('revote ' + (e.code || e.message)); }); }, at - nowMs());
    }
  }
  async function revote(P, me, first, second) {
    await me.ph.vote({ raceId: P.r.id, bill: me.bill, nick: me.nick, first, second }); // 同じスマホ・同じ番号 ＝ 選び直し
    me.combo = first + '-' + second;
  }
  // 渋谷店のお客さん（あなた）の票: ほかのお客さんの票（botVids）以外
  function humanVote(raceId) {
    let best = null;
    for (const [p, rec] of fake.raw) {
      if (!p.startsWith('derbyVotes/' + raceId + '~')) continue;
      const v = rec.data; if (botVids.has(v.vid)) continue;
      if (!best || (v.updatedAt || 0) > (best.updatedAt || 0)) best = v;
    }
    return best;
  }
  async function followTick() {
    if (!follow) return;
    const t = nowMs();
    for (const id of Object.keys(plans)) {
      const P = plans[id], r = P.r;
      if (t < r.closeAt - FOLLOW_MS || t > r.closeAt - 3000) continue;
      const h = humanVote(id); if (!h) continue;
      const c = h.first + '-' + h.second; if (P.follow === c) continue;
      P.follow = c; let n = 0;
      await Promise.all(P.list.map((me) => (me.combo === c ? null : revote(P, me, h.first, h.second).then(() => { n++; bots.followed++; }).catch((e) => { bots.failed++; log('follow ' + (e.code || e.message)); }))));
      log('follow ' + id + ' ' + c + ' x' + n);
    }
  }
  let tickAt = 0;
  ready.then(() => setInterval(() => {
    const lag = tickAt ? Date.now() - tickAt - 1000 : 0; tickAt = Date.now(); if (lag > 3000) log('lag ' + lag + 'ms'); // ページが重くて止まっていた（確認用）
    try { openRaces().forEach(planRace); } catch (e) { console.error(e); }
    followTick().catch((e) => console.error(e));
    const t = nowMs(); Object.keys(plans).forEach((id) => { if (plans[id].r.closeAt < t - 60000) delete plans[id]; }); // 締め切ったレースのお客さん（スマホ）は手放す
  }, 1000));
  // 古いデータを捨てる（つけっぱなしでも重くならないように。3 時間より前。まだ渡していない当たりは残す）
  setInterval(() => {
    const lim = Date.now() - 3 * 3600e3, gone = new Set();
    for (const [p, rec] of Array.from(fake.raw)) {
      const c = p.split('/')[0], d = rec.data || {};
      const at = c === 'derbyRaces' ? d.endAt || d.at : c === 'derbyVotes' ? d.votedAt : c === 'derbyPayouts' ? d.raceAt : c === 'derbyLogs' ? d.at : c === 'derbyClock' ? (d.t && d.t.toMillis ? d.t.toMillis() : 0) : null;
      if (at != null && at < lim && !(c === 'derbyPayouts' && d.status === 'unpaid')) { fake.raw.delete(p); if (c === 'derbyRaces') gone.add(p.split('/')[1]); }
    }
    gone.forEach((id) => ['derbyResults/', 'derbyRaceSecrets/', 'derbyCounts/'].forEach((c) => fake.raw.delete(c + id)));
    Array.from(botVids).forEach((v) => { if (!fake.raw.has('derbyVotes/' + v)) botVids.delete(v); });
  }, 10 * 60 * 1000);

  /* ---------- 画面（iframe） ---------- */
  const F = { tv: $('fTv'), cu: $('fCu'), st: $('fSt'), ad: $('fAd') };
  const W = (k) => { try { return F[k].contentWindow; } catch (e) { return null; } };
  const D = (k) => { try { return F[k].contentDocument; } catch (e) { return null; } };
  const q = (k, s) => { const d = D(k); return d ? d.querySelector(s) : null; };
  F.tv.src = 'tv.html?store=' + STORE + '&mute=1'; // デモは音なし（オーナー指示「音を出すのはやめて」）
  F.st.src = 'v2/staff.html?store=' + STORE;

  function toast(t, err, ms) { const el = $('toast'); el.textContent = t; el.className = 'toast' + (err ? ' err' : ''); el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { el.hidden = true; }, ms || 4200); }

  /* ---------- 大きさ ---------- */
  let mode = '';
  function layout() {
    const stage = $('stage'), A = stage.clientWidth, g = 18;
    let m, s;
    const sw = ((A - 40 - 2 * g) * 0.5625 - 16) / (844 + 390 * 0.5625 * 2);
    if (A >= 1100 && sw >= 0.46) { m = 'wide'; s = Math.min(0.8, sw); }
    else if (A >= 640) { m = 'mid'; s = Math.min(0.9, (A - g) / 2 / 390 - 0.05, Math.max(0.56, (window.innerHeight - 150) / 844)); } // 2026-10-23: スマホの枠が画面の高さより大きくならない（1024×768 で 1 台が 1 画面に入る）
    else { m = 'narrow'; s = Math.min(1, (A - 16) / 390); }
    stage.style.setProperty('--s', s.toFixed(4));
    if (m !== mode) {
      mode = m; stage.className = 'stage ' + m;
      // 狭い画面: 進め方をテレビのすぐ下へ（テレビ → 進め方 → スマホ）
      const gd = $('guide');
      if (m === 'narrow') $('tvDev').after(gd); else document.querySelector('.wrap').insertBefore(gd, stage);
    }
  }
  window.addEventListener('resize', layout); layout();

  /* ---------- 時刻・テレビの状態 ---------- */
  const jst = (ms) => { const d = new Date(ms + 9 * 3600e3); return d.getUTCHours() + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
  const left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ptT = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP') + 'pt';
  function tvInfo() {
    const TV = W('tv') && W('tv').DERBY, S0 = TV && TV.state, now = TV && TV.now ? TV.now() : Date.now();
    const o = S0 && S0.open, open = o && now >= (o.openAt || 0) && now < o.closeAt ? o : null;
    const nx = (S0 && (S0.next || (S0.upcoming && S0.upcoming[0]))) || null;
    return { TV, S0, now, open, next: nx, phase: TV && TV.phase };
  }

  /* ---------- お客さん: テレビの QR を読む ---------- */
  let scanning = false;
  async function camShow(camId, qrId, svg, ms) {
    const cam = $(camId); $(qrId).innerHTML = svg || ''; cam.hidden = false;
    await sleep(ms || 1100); cam.hidden = true; $(qrId).innerHTML = '';
  }
  async function scanTv() {
    if (scanning) return false; scanning = true;
    try {
      const tw = W('tv'), svgEl = q('tv', '#v2qrCode svg');
      if (!tw || !tw.DerbyQR || !svgEl) { toast('テレビの QR がまだ出ていません。テレビの画面が出るまで少し待ってください', true); return false; }
      const url = tw.DerbyQR.joinURL(STORE); // テレビの QR の中身（…/v2/bet.html?store=shibuya）
      const ti = tvInfo();
      if (!ti.open && ti.next) toast('いまは投票の時間ではありません。スマホに「次のレース ' + jst(ti.next.at) + '・投票は ' + jst(ti.next.openAt || ti.next.at) + ' から」と出て、始まると自動で投票の画面になります', false, 6500);
      await camShow('cuCam', 'cuCamQr', svgEl.outerHTML, 1200);
      $('cuIdle').hidden = true;
      F.cu.src = url;
      log('scan tv ' + url);
      return true;
    } finally { scanning = false; }
  }
  $('scanTvBtn').addEventListener('click', scanTv);

  /* ---------- スタッフのスマホ: 今日の当たり・番号を空ける・テストレース ---------- */
  function staffReady() {
    const ST = W('st') && W('st').STAFF;
    if (!ST || !ST.saved) { toast('先にスタッフのスマホで PIN（1234）を入れて「ログイン」を押してください', true); const p = q('st', '#pin'); if (p) try { p.focus({ preventScroll: true }); } catch (e) { /* なし */ } return null; }
    return ST;
  }
  // お客さんのスマホの会計番号（入力中・投票済み）
  function customerBill() {
    const B = W('cu') && W('cu').BET; if (!B) return '';
    const v = B.my && B.my.vote, d = B.draft;
    const b = (v && v.bill) || (d && d.bill) || ''; return /^\d{1,2}$/.test(b) ? b.padStart(2, '0') : '';
  }
  function staffWins() {
    const ST = staffReady(); if (!ST) return false;
    ST.closeSheet(); ST.loadWins();
    const d = D('st'); if (d) { const m = d.getElementById('main'); if (m) m.scrollTop = 0; d.defaultView.scrollTo(0, 0); }
    toast('スタッフのスマホの「今日の当たり」: まだ渡していない人が上。「スライドして渡した」を右へすべらせると渡したことになります', false, 6000);
    return true;
  }
  function staffRelease() {
    const ST = staffReady(); if (!ST) return false;
    ST.openSheet('release');
    const b = customerBill(), d = D('st');
    if (b && d) { setTimeout(() => { const clr = d.querySelector('[data-rkey="clr"]'); if (clr) clr.click(); for (const k of b) { const e = d.querySelector('[data-rkey="' + k + '"]'); if (e) e.click(); } }, 60); }
    toast(b ? 'お客さんの会計番号 ' + b + ' を入れました。「空ける」を押すと、その番号の票が消えて、もう一度投票できます' : '会計番号を 2 けたで入れて「空ける」。ほかの人に番号を先に使われたときに使います', false, 6000);
    return true;
  }
  function staffTest() {
    const ST = staffReady(); if (!ST) return false;
    ST.openSheet('test');
    toast('この店のテレビだけのテストレース（投票 1 分・当たっても払いません）。投票中・レース中・次のレースが近いときは押せません', false, 6000);
    return true;
  }
  /* スタンプラリー（デモだけ）: お客さんのスマホの端末にスタンプを足す（10 個たまるまで何レースも待たなくても「スタンプで 2 票目」を試せるように）。
     足すのはマスターのログイン（決める係と同じく derbyStamps を書ける）。h には入れない＝レースで付く数とは別 */
  const stampClient = fake.client('hub-stamp'); let stampSigned = null;
  async function addStamps() {
    const cu = keepAuth.bet && keepAuth.bet.auth.currentUser;
    if (!cu) return toast('先にお客さんのスマホでテレビの QR を読んでください', true);
    try {
      if (!stampSigned) stampSigned = stampClient.auth.signInWithEmailAndPassword(MASTER, MASTER_PW); await stampSigned;
      const ref = stampClient.db.doc('derbyStamps/' + cu.uid), sn = await ref.get(), d = sn.exists ? sn.data() : {};
      await ref.set(Object.assign({}, d, { earned: (Number(d.earned) || 0) + 5, spent: Number(d.spent) || 0, h: d.h || {} }));
      toast('お客さんのスマホにスタンプを 5 個足しました（デモだけ）'); log('stamps +5 ' + cu.uid);
      try { const w = F.cu.contentWindow; if (w && w.location) w.location.reload(); } catch (e) { /* なし */ }
    } catch (e) { console.error('addStamps', e); toast('足せませんでした', true); }
  }
  $('stampAddBtn').addEventListener('click', addStamps);
  $('stWinsBtn').addEventListener('click', staffWins);
  $('stRelBtn').addEventListener('click', staffRelease);
  $('stTestBtn').addEventListener('click', staffTest);

  /* ---------- 当たりを体験しやすくする ---------- */
  const fc = $('followChk');
  if (fc) { fc.checked = follow; fc.addEventListener('change', () => { follow = fc.checked; }); }

  /* ---------- 管理画面 ---------- */
  function openAdmin() { if (!F.ad.src) F.ad.src = 'v2/admin.html'; $('adminModal').hidden = false; $('adminClose').focus(); }
  function closeAdmin() { $('adminModal').hidden = true; $('adminBtn').focus(); }
  $('adminBtn').addEventListener('click', openAdmin);
  $('adminClose').addEventListener('click', closeAdmin);
  $('adminModal').addEventListener('click', (e) => { if (e.target.id === 'adminModal') closeAdmin(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('adminModal').hidden) closeAdmin(); });

  /* ---------- やり直す ---------- */
  let resetArm = 0;
  $('resetBtn').addEventListener('click', () => {
    if (Date.now() - resetArm > 4000) { resetArm = Date.now(); $('resetBtn').textContent = 'もう一度押すと最初から'; setTimeout(() => { if (Date.now() - resetArm >= 4000) $('resetBtn').textContent = '最初からやり直す'; }, 4100); return; }
    location.reload();
  });

  /* ---------- 進め方（いまの段） ---------- */
  const STEPS = ['テレビの QR を読む', '会計番号・ニックネーム', '1着・2着をえらぶ', '確かめて投票', 'テレビでレース', '当たりを受け取る'];
  $('steps').innerHTML = STEPS.map((s, i) => '<li data-n="' + (i + 1) + '"><i>' + (i + 1) + '</i>' + s + '</li>').join('');
  const PH = { wait: '待ち時間', hl: '前のレースのリプレイ', open: '投票中', live: 'レース中', result: '結果発表' };
  let paidSeen = false;
  function progress() {
    const ti = tvInfo(), B = W('cu') && W('cu').BET, now = ti.now, open = ti.open, nx = ti.next;
    $('tvPhase').textContent = PH[ti.phase] || '';
    const d = new Date(Date.now() + 9 * 3600e3); $('idleClock').textContent = d.getUTCHours() + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    const sc = B && B.screen, v = B && B.my && B.my.vote, res = v && v.result, pay = res && res.payout;
    const raceTxt = open ? jst(open.at) + ' のレース 投票中・締切まで ' + left(open.closeAt - now) : nx ? '次のレースは ' + jst(nx.at) + ' 発走（投票は ' + jst(nx.openAt || nx.at) + ' から）' : '';
    let n = 1, main = '', sub = '';
    if (!B || sc === 'boot') { n = 1; main = '「お客さんのスマホでテレビの QR を読む」を押してください'; sub = raceTxt; }
    else if (sc === 'wait' || sc === 'noStore' || sc === 'badStore') { n = 2; main = '投票の時間になると、お客さんのスマホが自動で会計番号の画面になります'; sub = raceTxt; }
    else if (sc === 'entry') {
      n = 2;
      if (B.draft && B.draft.err === 'bill_taken') { main = 'この会計番号はほかのスマホが先に使っています。別の番号にするか、スタッフのスマホの「番号を空ける」で空けてください'; sub = raceTxt; }
      else { main = 'お客さんのスマホで会計番号（2 けた・例 12）とニックネーム（8 文字まで）を入れて「予想をえらぶ」'; sub = raceTxt; }
    }
    else if (sc === 'pick') { n = 3; main = '表から 1 着と 2 着の組み合わせを 1 マス押してください（縦が 1 着・横が 2 着・マスの数字は倍率）'; sub = raceTxt; }
    else if (sc === 'confirm') { n = 4; main = '組み合わせと「当たれば ○pt」を確かめて「投票する」'; sub = '当選額 ＝ 100pt × 2連単の倍率（100pt 単位に切り上げ）'; }
    else if (sc === 'voted') { n = 5; main = B.my && B.my.bonus && !B.my.vote2 ? '投票しました。このスマホは初めてなので「もう1票えらぶ」で 2 票目も入れられます（初参加ボーナス・同じ組み合わせでも OK）' : '投票しました。締切までは「選び直す」で予想を変えられます'; const r = B.my && B.my.race; sub = r && now < r.closeAt ? '締切まで ' + left(r.closeAt - now) + '・' + jst(r.at) + ' 発走' : raceTxt; }
    else if (sc === 'race') { n = 5; main = 'テレビでレース中です。結果はスマホにも出ます'; const r = B.my && B.my.race; sub = r && r.revealAt > now ? '結果まで あと ' + left(r.revealAt - now) : '結果を待っています'; }
    else if (sc === 'result') {
      n = 6;
      if (res && res.win && res.test) { main = 'テストレースなので、当たっても受け取りはありません'; sub = 'お客さんのスマホの「次のレースへ」で次のレースに投票できます'; }
      else if (res && res.win && pay && pay.status === 'paid') { main = '受け取りまで終わりました（' + (pay.paidVia === 'staff' ? 'スタッフのスマホ' : 'お客さんのスマホのスライド') + '）'; sub = 'お客さんのスマホの「次のレースへ」で次のレースに投票できます'; paidSeen = true; }
      else if (res && res.win && pay && pay.status === 'unpaid') { main = '当たり！ スタッフがお客さんのスマホの「スライドして受け取り」を右端まですべらせます（スタッフのスマホの「今日の当たり」からも渡せます）'; sub = '当選額 ' + ptT(res.amount) + '・会計番号 ' + v.bill + '（受け取りはその日のうち）'; }
      else if (res && res.win) { main = '当たりでした'; sub = pay ? (pay.status === 'expired' ? '受け取りの期限が切れています' : 'このレースは取り消しになりました') : ''; }
      else { main = '今回ははずれでした'; sub = 'お客さんのスマホの「次のレースへ」で次のレースに投票できます'; }
    }
    else { n = 1; main = '「お客さんのスマホでテレビの QR を読む」を押してください'; sub = raceTxt; }
    const doneAll = n === 6 && paidSeen && pay && pay.status === 'paid';
    document.querySelectorAll('#steps li').forEach((li) => { const k = Number(li.dataset.n); li.className = k < n || (k === 6 && doneAll) ? 'done' : k === n ? 'now' : ''; });
    if ($('nextMain').textContent !== main) $('nextMain').textContent = main;
    if ($('nextSub').textContent !== sub) $('nextSub').textContent = sub;
    const bill = customerBill(), nick = (v && v.nick) || (B && B.draft && B.draft.nick) || '';
    $('cuSub').textContent = bill ? '会計番号 ' + bill + (nick ? '・' + nick + ' さん' : '') : '渋谷店のお客さん';
  }
  setInterval(() => { try { progress(); } catch (e) { /* 画面の読み込み中 */ } }, 500);

  /* ---------- テスト・確認用 ---------- */
  window.DEMO_HUB = {
    fake, LOG, bots, ready, plans, botVids, scanTv, staffWins, staffRelease, staffTest, openAdmin, closeAdmin, customerBill, tvInfo, humanVote,
    get follow() { return follow; }, set follow(v) { follow = !!v; if (fc) fc.checked = follow; },
    get standby() { return standby; }, get mode() { return mode; },
    deciderLog: () => { const tw = W('tv'); const c = tw && tw.DERBY && tw.DERBY.cloud; return { tv: c && c.decider ? { leader: c.decider.leader, log: c.decider.log.slice(-20) } : null, hub: standby && standby.decider ? { leader: standby.decider.leader, log: standby.decider.log.slice(-20) } : null }; },
    count: () => { const o = {}; for (const p of fake.raw.keys()) { const c = p.split('/')[0]; o[c] = (o[c] || 0) + 1; } return o; },
  };
})();

/* お客さんの画面だけ（cu.html）: テレビの QR が出たら自動で読む（ボタンは隠している） */
(function () {
  if (!document.documentElement.classList.contains('cuonly')) return;
  const dev = document.getElementById('cuDev'); if (dev && dev.parentNode !== document.body) document.body.appendChild(dev); // 枠の外の余白（親の中で固定されてしまう）をなくす
  let n = 0;
  const t = setInterval(() => { const b = document.getElementById('scanTvBtn'), f = document.getElementById('fCu'); if (f && f.getAttribute('src')) { clearInterval(t); return; } if (++n > 120) { clearInterval(t); return; } if (b) b.click(); }, 1500);
})();
