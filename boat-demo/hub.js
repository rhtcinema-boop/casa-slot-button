/* casa BOAT Web デモの舞台（入口の index.html）。サーバーなしで、ブラウザの中だけで全部が動く（2026-11-19）。
   - にせ Firestore（v2/fake-firestore.js）を 1 つ持つ（デモなので置き場の決まりは当てない。決まりの確かめは tests/boat-fs.test.js）。スマホ・テレビ（iframe）は demo-config.js 経由でこれを使う
   - 最初に管理のアカウントで店舗とボートの時刻表（6 分ごと・投票 70 秒・結果 40 秒）を入れる。レースを作る・決める・発表するのは、本番と同じ v2/boat-firestore.js の見回り（ここで動かす決める係）
   - お客さん（あなた）: 渋谷店。「今日の競馬に参加済み」（今日の競馬の票がある）・BPT 1,000 から始まる
   - ほかのお客さん（自動）: 上野・札幌・渋谷の 10 人が、投票の時間に無料の券と BPT の券を入れる
   - 「当たりやすくする」（初めは入）: 締切の 12 秒前に、あなたの無料の券の組番がちょうど目安の額になるよう、そのレースの目安を合わせる（デモだけ。本番には無い）
   - 「QR を読む」ボタン: カメラの代わりに、いまのレースの QR の中身（…/v2/boat.html?s=shibuya#<レース>.<合言葉>）をスマホで開く
   テスト用: window.BOAT_HUB */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MASTER = 'master@demo.casa-boat.invalid', MASTER_PW = 'demo1234', TV_EMAIL = 'tv@demo.casa-boat.invalid', TV_PW = 'tv-' + Math.random().toString(36).slice(2, 12);
  const STORE = 'shibuya', STORES = [{ id: 'shibuya', name: '渋谷', pin: '1234' }, { id: 'ueno', name: '上野', pin: '1234' }, { id: 'sapporo', name: '札幌', pin: '1234' }];
  const EVERY = 6, VOTE = 70, RESULT = 40, TARGET = 1500, START_BPT = 1000;
  const Core = window.DerbyCore, Boat = window.BoatCore;
  const LOG = []; const log = (m) => { LOG.push(new Date().toISOString().slice(11, 19) + ' ' + m); if (LOG.length > 200) LOG.shift(); };
  // 前に開いたときの記録（このページの中のデータとは合わない）を消す
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && (k.indexOf('casa.derby.vote.') === 0 || k === 'casa.derby.nick')) localStorage.removeItem(k); } sessionStorage.clear(); } catch (e) { /* なし */ }

  const fake = FakeFirestore.create({});
  fake.addUser(MASTER, MASTER_PW); fake.addUser(TV_EMAIL, TV_PW);
  const clients = {};
  const wrap = (c) => ({ db: c.db, auth: c.auth, FieldValue: c.FieldValue, Timestamp: c.Timestamp });
  function clientFor(kind) { return wrap(clients[kind] || (clients[kind] = fake.client(kind))); } // スマホは読み込み直しても同じログイン
  const env = (label) => ({ fb: clientFor(label), Engine: window.Engine, Outcome: window.Outcome, Core, config: { masterEmail: MASTER, tvEmail: TV_EMAIL } });
  const dbm = () => clients.master.db;

  // 時刻表: 6 分ごと（時刻 ＝ 締切）。最初のレースの投票が 20〜80 秒後に始まるように刻みをずらす
  function rules() {
    const t = Date.now() + 9 * 3600e3, inDay = t % 86400000, m0 = Math.ceil((inDay + (VOTE + 20) * 1000) / 60000), off = m0 % EVERY, p = (n) => String(n).padStart(2, '0'), last = 29 * 60 - EVERY + off;
    return [{ id: 'demo', kind: 'daily', from: '05:' + p(off), to: p(Math.floor(last / 60)) + ':' + p(last % 60), everyMin: EVERY, payout: TARGET }];
  }
  const today = () => Core.bizDate(Date.now(), 5);
  let decider = null, phoneUid = null;
  const bots = [];
  const NICKS = ['ゆうき', 'さくら', 'たけし', 'みほ', 'けんた', 'あやか', 'しょう', 'まどか', 'りく', 'なつみ'];
  const ready = (async () => {
    clients.master = fake.client('master'); await clients.master.auth.signInWithEmailAndPassword(MASTER, MASTER_PW);
    const A = DerbyFirestore.create({ role: 'admin' }, env('admin')).admin(MASTER_PW);
    await A.config(); await A.saveStores(STORES);
    await A.saveBoat({ rules: rules(), voteSec: VOTE, resultSec: RESULT, target: TARGET });
    await setBand(true);
    // 今日の競馬（デモでは票だけ。時刻は 2 日前にして競馬の見回りに入れない＝営業日 day だけ今日）
    const rid = 'demo-derby-' + today().replace(/-/g, '');
    await dbm().collection('derbyRaces').doc(rid).set({ id: rid, day: today(), at: Date.now() - 2 * 86400000, status: 'done', test: false, refunded: true, horses: [], result: null });
    const derbyVote = async (uid, store, bill, nick) => { const vid = rid + '~' + store + '~' + bill; await dbm().collection('derbyVotes').doc(vid).set({ vid, raceId: rid, storeId: store, bill, nick, first: 0, second: 1, owner: uid, test: false, votedAt: Date.now(), updatedAt: Date.now() }); return vid; };
    // あなた（渋谷）: 匿名ログイン・今日の競馬の票・BPT
    clients.phone = fake.client('phone'); await clients.phone.auth.signInAnonymously(); phoneUid = clients.phone.auth.currentUser.uid;
    const dv = await derbyVote(phoneUid, STORE, '07', 'あなた');
    try { localStorage.setItem('casa.derby.vote.' + rid, JSON.stringify({ vid: dv, key: 'demo', at: Date.now() })); localStorage.setItem('casa.derby.nick', 'あなた'); } catch (e) { /* 覚えられない端末 */ }
    await dbm().collection('derbyBpt').doc(phoneUid).set(Boat.creditDoc(null, START_BPT, Date.now()));
    // ほかのお客さん
    for (let i = 0; i < NICKS.length; i++) { const c = fake.client('bot' + i); await c.auth.signInAnonymously(); const uid = c.auth.currentUser.uid, store = STORES[i % 3].id; bots.push({ uid, store, nick: NICKS[i], dv: await derbyVote(uid, store, String(20 + i), NICKS[i]) }); await dbm().collection('derbyBpt').doc(uid).set(Boat.creditDoc(null, 2000, Date.now())); }
    // 決める係（本番の進行役のテレビと同じ見回り。v2/client-firestore.js ＋ v2/boat-firestore.js）
    decider = DerbyFirestore.create({ role: 'tv', store: null, tvPassword: TV_PW, pair: false }, env('decider'));
    await decider.ready();
    log('ready');
  })();
  ready.catch((e) => { console.error('boat demo', e); toast('準備に失敗しました。読み込み直してください'); });

  /* ---------- いまのレース（舞台の見出し・ボタン） ---------- */
  function raw(p) { const r = fake.raw.get(p); return r ? r.data : null; }
  const live = () => raw('boatLive/all') || { race: null, next: null };
  const races = () => { const out = []; for (const [p, r] of fake.raw) if (p.indexOf('boatRaces/') === 0) out.push(r.data); return out; };
  const hm = (ms) => Core.fmtBizTime(ms, 5), left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function status() {
    const L = live(), r = L.race, t = Date.now(), st = r ? Boat.stageOf(r, t) : 'none', n = L.next;
    if (r && st === 'vote') return { st, text: '投票受付中・締切まで ' + left(r.closeAt - t), qr: true };
    if (r && (st === 'closed' || st === 'film')) return { st, text: 'テレビでレース中（結果まで ' + left(r.revealAt - t) + '）', tv: true };
    if (r && st === 'result') return { st, text: '結果発表中', tv: true };
    if (r && st === 'wait') return { st, text: '次のボートレース ' + hm(r.at) + '・投票まで ' + left(r.openAt - t) };
    if (n) return { st: 'none', text: '次のボートレース ' + hm(n.at) + '・投票まで ' + left(n.openAt - t) };
    return { st: 'none', text: '準備中…' };
  }
  function qrUrl() { const r = live().race; if (!r || Boat.stageOf(r, Date.now()) !== 'vote') return null; const k = raw('boatKeys/' + r.id); return k ? 'v2/boat.html?s=' + STORE + '#' + r.id + '.' + k.code : null; }

  /* ---------- ほかのお客さん（自動） ---------- */
  const done = {};
  function pickCombo(r) { const ex = r.exacta || {}, ks = Object.keys(ex), w = ks.map((k) => 1 / ex[k]), s = w.reduce((a, b) => a + b, 0); let x = Math.random() * s; for (let i = 0; i < ks.length; i++) { x -= w[i]; if (x <= 0) return ks[i]; } return ks[0]; }
  async function botTick() {
    const r = live().race, t = Date.now(); if (!r || Boat.stageOf(r, t) !== 'vote') return;
    const k = raw('boatKeys/' + r.id); if (!k) return;
    const D = (done[r.id] = done[r.id] || {});
    for (const b of bots) {
      if (D[b.uid] || Math.random() > 0.08) continue; // 投票の時間のあいだに少しずつ
      D[b.uid] = 1;
      const f = pickCombo(r).split('-').map(Number), bets = {}; const nb = Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 4) : 0;
      for (let i = 0; i < nb; i++) { const c = pickCombo(r); bets[c] = (bets[c] || 0) + 1; }
      try {
        const vid = r.id + '~' + b.uid, w = raw('derbyBpt/' + b.uid) || {};
        await dbm().collection('boatVotes').doc(vid).set({ raceId: r.id, owner: b.uid, storeId: b.store, nick: b.nick, first: f[0], second: f[1], bets, code: k.code, dv: b.dv, votedAt: t, updatedAt: t });
        if (nb) await dbm().collection('derbyBpt').doc(b.uid).set({ spent: (w.spent || 0) + nb * 100, buse: vid }, { merge: true });
      } catch (e) { console.warn('bot', e); }
    }
  }
  // 当たりやすくする（デモだけ）: 締切の 12 秒前に、あなたの無料の券の組番の払い戻しの合計を、そのレースの目安にする
  let easy = true;
  // 当たりやすくする間は、当たりの幅を目安の ±1% にする（目安に合わせた組番だけが選ばれやすい。デモだけ。本番の幅は ±20%）
  const setBand = (on) => dbm().collection('derbyConfig').doc('boat').set(on ? { bandBelow: 0.01, bandAbove: 0.01 } : { bandBelow: 0.2, bandAbove: 0.2 }, { merge: true });
  async function easyTick() {
    if (!easy || !phoneUid) return;
    const r = live().race, t = Date.now(); if (!r || Boat.stageOf(r, t) !== 'vote' || r.closeAt - t > 12000) return;
    const D = (done[r.id] = done[r.id] || {}); if (D.easy) return;
    const me = raw('boatVotes/' + r.id + '~' + phoneUid); if (!me) return;
    D.easy = 1;
    // あなたの券（無料の券と BPT の券）の組番のうち、払い戻しの合計がいちばん大きい組番に目安を合わせる（ほかの組番と同じ額になりにくい）
    const payOf = (k) => Math.ceil(Math.max(10, Math.round(r.exacta[k] * 10)) / 10 - 1e-9) * 100;
    const cnt = {}; for (const [p, rec] of fake.raw) { if (p.indexOf('boatVotes/' + r.id + '~') !== 0) continue; const v = rec.data, f = v.first + '-' + v.second; cnt[f] = (cnt[f] || 0) + 1; Object.keys(v.bets || {}).forEach((x) => { cnt[x] = (cnt[x] || 0) + v.bets[x]; }); }
    const mine = [me.first + '-' + me.second].concat(Object.keys(me.bets || {})); let k = mine[0];
    mine.forEach((x) => { if (payOf(x) * cnt[x] > payOf(k) * cnt[k]) k = x; });
    const target = payOf(k) * cnt[k];
    await dbm().collection('boatSecrets').doc(r.id).set({ target }, { merge: true });
    log('easy ' + r.id + ' ' + k + ' target ' + target);
  }

  /* ---------- 画面 ---------- */
  let toastT = 0;
  function toast(m) { const e = $('toast'); if (!e) return; e.textContent = m; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('show'), 2600); }
  function tick() {
    const s = status(); $('st').textContent = s.text; $('st').dataset.st = s.st;
    $('qrBtn').classList.toggle('hot', !!s.qr); $('tvBtn').classList.toggle('hot', !!s.tv);
    botTick().catch(() => {}); easyTick().catch(() => {});
  }
  function openPhone(url) { const f = $('phone'); f.src = url; }
  $('qrBtn').addEventListener('click', () => { const u = qrUrl(); if (!u) { toast('いまは投票の時間ではありません。上の時刻を見てください'); return; } closeTv(); openPhone(u + ''); toast('QR を読みました'); });
  function openTv() { const w = $('tvWrap'); if (!w.hidden) return closeTv(); w.hidden = false; if (!$('tv').src) $('tv').src = 'tv.html?store=' + STORE + '&mute=1'; $('tvBtn').textContent = 'スマホに戻る'; }
  function closeTv() { $('tvWrap').hidden = true; $('tvBtn').textContent = 'テレビを見る'; }
  $('tvBtn').addEventListener('click', openTv);
  $('tvClose').addEventListener('click', closeTv);
  $('resetBtn').addEventListener('click', () => { if (confirm('最初からやり直しますか？（BPT も 1,000 に戻ります）')) location.reload(); });
  $('easy').addEventListener('change', (e) => { easy = e.target.checked; setBand(easy).catch(() => {}); });
  ready.then(() => { openPhone('v2/boat.html?s=' + STORE); setInterval(tick, 500); tick(); });
  // iOS 26 の Safari の下の浮いたバーの分（v2/bet.html と同じ見積もり）を下に空ける
  (function sbar() { const d = document.documentElement; function f() { const h = innerHeight, ua = navigator.userAgent || '', ios = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), saf = ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Line\/|FBAN|FBAV|Instagram/.test(ua); let sa = navigator.standalone === true; try { sa = sa || matchMedia('(display-mode: standalone)').matches; } catch (e) { /* なし */ } const v = /Version\/(\d+)/.exec(ua); let bar = 0; if (window.__sbarForce || (saf && !sa && v && Number(v[1]) >= 26)) { const H = Math.max(screen.width || 0, screen.height || 0), tall = H >= 800; bar = Math.max(0, (tall ? 82 : 60) - Math.max(0, H - h - (tall ? 59 : 20))); } d.style.setProperty('--sbar', bar + 'px'); d.style.setProperty('--appH', h + 'px'); } f(); addEventListener('resize', f); window.__casaVH = f; })();

  window.__boatDemo = { MASTER, TV_EMAIL, TV_PW, ready, clientFor };
  window.BOAT_HUB = { fake, races, live, status, qrUrl, log: LOG, get phoneUid() { return phoneUid; }, bpt: () => raw('derbyBpt/' + phoneUid), mine: () => { const r = live().race; return r ? raw('boatVotes/' + r.id + '~' + phoneUid) : null; }, setEasy(v) { easy = !!v; } };
})();
