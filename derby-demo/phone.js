/* casa DERBY Web デモ「スマホだけ」の試しのページ（phone.html。2026-10-30）。
   デモの舞台（hub.js）からテレビ・スタッフ・管理の画面を外し、スマホ 1 台分だけにしたもの:
   - にせ Firestore（v2/fake-firestore.js）・ルール（demo-rules.js）・店舗と時刻表（3 分ごと・投票 60 秒・全店同じ）は hub.js と同じやり方で入れる
   - レースを作る・決める・発表するのは、このページの中の決める係（テレビ用アカウントの DerbyFirestore。テレビの画面は出さない）
   - ほかのお客さん（上野）が毎レース 6 票（でたらめの組み合わせ）入れる（当たり・はずれのどちらも起きるように）
   - 投票の時間になったら、あなたのスマホ（投票ページ）で自動で 1 票: 渋谷・会計番号はでたらめ・ニックネーム「テスト」・1着→2着はでたらめ
   - 投票ページは ?view=3d（見る窓は 3D が先。デモだけ「図で見る」「3Dで見る」で切り替え）。窓の中は本番と同じ v2/bet.js → index.html?watch=1（tv.html）／v2/watchmap.html
   画面の入口は hub.js と同じ window.__derbyDemo（demo-config.js が親をたどって見つける）。確認用に window.PHONE_TEST */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MASTER = 'master@demo.casa-derby.invalid', MASTER_PW = 'demo1234';
  const TV_EMAIL = 'tv@demo.casa-derby.invalid', TV_PW = 'tv-' + Math.random().toString(36).slice(2, 12);
  const PIN = '1234', STORE = 'shibuya';
  const STORES = [{ id: 'shibuya', name: '渋谷', pin: PIN }, { id: 'ueno', name: '上野', pin: PIN }, { id: 'sapporo', name: '札幌', pin: PIN }];
  // 3 分（180 秒）ごと・投票 60 秒。間隔の目安（Core.minGapSec）＝ 投票 60 ＋ ゲート 8 ＋ 走り 60 ＋ ゴール後 28 ＋ 写真判定 12 ＝ 168 秒 ≦ 180。結果の画面は 20 秒
  const EVERY_MIN = 3, VOTE_SEC = 60, RESULT_SEC = 20, TARGET = 5000;
  const LOG = []; const log = (m) => { LOG.push(new Date().toISOString().slice(11, 19) + ' ' + m); if (LOG.length > 200) LOG.shift(); };
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ms) => { const d = new Date(ms + 9 * 3600e3), h = d.getUTCHours(); return (h < 5 ? h + 24 : h) + ':' + pad(d.getUTCMinutes()); };
  const left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + pad(s % 60); };

  // 前に開いたときの記録（このページの中のデータとは合わない）を消す
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && (k.indexOf('casa.derby.vote.') === 0 || k.indexOf('casa.derby.st.') === 0)) localStorage.removeItem(k); } } catch (e) { /* 保存が使えない */ }

  /* ---------- にせ Firestore と画面の入口（hub.js と同じ） ---------- */
  const fake = FakeFirestore.create({ rules: window.DemoRules(MASTER, TV_EMAIL) });
  fake.addUser(MASTER, MASTER_PW); fake.addUser(TV_EMAIL, TV_PW);
  const keepAuth = {};
  function clientFor(win, label) {
    const keep = win && win !== window && label === 'bet';
    const c = keep ? (keepAuth[label] = keepAuth[label] || fake.client(label)) : fake.client(label), reg = new Set();
    const track = (u) => { reg.add(u); return () => { reg.delete(u); u(); }; };
    const wq = (q) => Object.assign({}, q, { where: (...a) => wq(q.where(...a)), orderBy: (...a) => wq(q.orderBy(...a)), limit: (n) => wq(q.limit(n)), onSnapshot: (...a) => track(q.onSnapshot(...a)), doc: q.doc ? (id) => wd(q.doc(id)) : undefined, add: q.add ? async (d) => wd(await q.add(d)) : undefined });
    const wd = (r) => Object.assign({}, r, { collection: (x) => wq(r.collection(x)), onSnapshot: (...a) => track(r.onSnapshot(...a)) });
    const db = { collection: (x) => wq(c.db.collection(x)), doc: (p) => wd(c.db.doc(p)), runTransaction: c.db.runTransaction, batch: c.db.batch, enablePersistence: c.db.enablePersistence };
    if (win && win !== window) { try { win.addEventListener('pagehide', () => { reg.forEach((u) => { try { u(); } catch (e) { /* なし */ } }); reg.clear(); }); } catch (e) { /* なし */ } }
    return { db, auth: c.auth, FieldValue: c.FieldValue, Timestamp: c.Timestamp };
  }
  const env = (label) => ({ fb: clientFor(window, label), Engine: window.Engine, Outcome: window.Outcome, Core: window.DerbyCore, config: { masterEmail: MASTER, tvEmail: TV_EMAIL } });
  const mk = (opts, label) => DerbyFirestore.create(opts, env(label));

  /* ---------- 最初の設定 ---------- */
  function timetable() { // 時刻表の時刻（営業日の時計 05:00〜28:59。05:00＝300 分・24 時＝1440 分はどちらも 3 で割り切れる＝深夜も同じ刻み）。最初のレースは開いてから 80〜260 秒あとに走り出す
    const t = Date.now() + 9 * 3600e3, inDay = t % 86400000, m0 = Math.ceil((inDay + 80000) / 60000), off = m0 % EVERY_MIN, lastMin = 1739 - ((1739 - off) % EVERY_MIN);
    return [{ id: 'phone', name: '試し', kind: 'daily', from: '05:' + pad(off), to: pad(Math.floor(lastMin / 60)) + ':' + pad(lastMin % 60), everyMin: EVERY_MIN, payout: TARGET, scope: 'all', storeId: null }];
  }
  let decider = null;
  const ready = (async () => {
    const A = mk({ role: 'admin' }, 'hub-admin').admin(MASTER_PW);
    await A.config();
    await A.saveStores(STORES);
    await A.saveTuning(Object.assign({ voteSec: VOTE_SEC, resultSec: RESULT_SEC, oddsSims: 300 }, window.__STAMP_DEMO ? { stamp: { on: true } } : {})); // oddsSims: 倍率の計算を軽く（スマホの中で決める係も動くため）。stamp: スタンプラリーの試し（stamp.html。2026-11-02）
    await A.saveTimetable(timetable());
    decider = mk({ role: 'tv', store: null, tvPassword: TV_PW }, 'decider'); // 決める係（テレビ用アカウント。画面は出さない）
    await decider.ready();
    log('ready');
  })();
  ready.catch((e) => { console.error('phone test seed', e); $('pStatus').textContent = '準備に失敗しました。読み込み直してください'; });

  window.__derbyDemo = {
    MASTER, TV_EMAIL, ready, clientFor,
    tvPassFor: () => null, // テレビの画面は無い（見る窓の tv.html はテレビ用アカウントを使わない）
    pageStart() { /* テレビの画面は無いので何もしない */ },
  };

  /* ---------- 投票ページ ---------- */
  const F = $('fCu');
  const VIEW = /[?&]view=map\b/.test(location.search) ? 'map' : '3d'; // phone.html?view=map で図の表示から（くらべる・測るため）
  ready.then(() => { F.src = 'v2/bet.html?store=' + STORE + '&view=' + (window.__STAMP_DEMO ? 'map&watchauto=0' : VIEW); }); // 説明ページ: 「レースを見る」の窓を自動で開かない（カードと案内を隠さない） // スタンプの試しは軽い「図」の表示から
  /* スタンプラリーの試し（stamp.html）: 上の帯の「スタンプ +5」。マスターのログインで derbyStamps/<このスマホの端末 ID> の earned を 5 足す（レースで付く数とは別。h には入れない） */
  const stampBtn = $('pStampBtn');
  if (stampBtn) {
    const sc = fake.client('hub-stamp'); let signed = null;
    const toast = (t) => { const el = $('pToast'); if (!el) return; el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2500); };
    const addStamps = async (n) => {
      const cu = keepAuth.bet && keepAuth.bet.auth.currentUser; if (!cu) return toast('投票ページがまだ開いていません。少し待ってください');
      try {
        if (!signed) signed = sc.auth.signInWithEmailAndPassword(MASTER, MASTER_PW); await signed;
        const ref = sc.db.doc('derbyStamps/' + cu.uid), sn = await ref.get(), d = sn.exists ? sn.data() : {};
        await ref.set(Object.assign({}, d, { earned: (Number(d.earned) || 0) + n, spent: Number(d.spent) || 0, h: d.h || {} }));
        log('stamps +' + n);
        try { const w = F.contentWindow; if (w && w.BET && w.BET.loadStamps) w.BET.loadStamps(); else w.location.reload(); } catch (e) { /* なし */ } // 読み直さずにカードだけ（押される動きが見える）
      } catch (e) { console.error('stamps', e); toast('足せませんでした'); }
    };
    stampBtn.addEventListener('click', () => addStamps(5));
    const b1 = $('pStamp1Btn'); if (b1) b1.addEventListener('click', () => addStamps(1));
    window.__addStamps = addStamps;
  }
  /* ---------- 案内役（stamp.html。2026-11-02 オーナー「全く理解していない想定で説明するデモに」）: 7 つの段。お客さんのスマホの様子（スタンプの数・投票・2 票目・結果）を見て自動で進む ---------- */
  const G = window.__STAMP_DEMO && $('pGuide') ? { i: 0, max: 0, auto: true } : null;
  const STEPS = [
    { t: 'スタンプラリーって？', p: '何回も投票してくれるお客さんへの<b>ごほうび</b>です。<br>お客さんのスマホにスタンプがたまり、<b>10 個</b>たまると、そのレースで<b>2 票目</b>が入れられます（当たるチャンスが 2 倍）。' },
    { t: 'どうやってたまる？', p: '1 票入れるたびに <b>+1</b>。<b>当たったら +3</b>。はずれても、選んだ 2 頭のどちらかが 1 着か 2 着に入っていれば <b>+1</b>。<br>1 レースで最大 4 個。付くのは<b>結果の発表のとき</b>です。' },
    { t: 'まず、ふつうに投票', p: 'これがお客さんのスマホです。下にスクロールすると<b>スタンプのカード</b>（10 マス・いまは 0 個）があります。<br>投票の時間になると、この説明ページが自動で 1 票入れます。<span id="gWait"></span>', wait: true },
    { t: '投票した。でもまだ 0 個', p: '投票しただけではスタンプは付きません。<b>結果の発表</b>のときに付きます。<br>このままレースと結果を待ちます。<span id="gWait"></span>', wait: true },
    { t: 'スタンプが付いた！', p: '結果の画面に<b>「スタンプ +○」</b>と内わけ（投票・当たり・1 頭からみ）。カードを見ると、その数だけ押されています。<br>本番ではこれを<b>レースのたびに繰り返して</b>ためます。ここでは時間を省いて、残りをまとめて足します。', wait: true, btn: '残りをまとめて足す' },
    { t: '10 個たまった！', p: '10 個たまると<b>「2票目 獲得！」</b>の演出が出て、スタンプ 10 個が<b>「2票目の券」1 枚</b>に替わります（カードは新しい 1 枚になります）。<br>次のレースで投票したあとに<b>「2票目の券で もう1票」</b>が出ます。次の投票の時間を待ちます（自動で 1 票入ります）。<span id="gWait"></span>', wait: true },
    { t: '2 票目を入れてみよう', p: '金の枠の<b>「券を使って2票目をえらぶ」</b>を押して、1 着と 2 着を選んでください（同じ組み合わせでも OK）。<br>使うと券が <b>1 枚減ります</b>。', wait: true },
    { t: '2 票で結果を待つ', p: '2 票目には<b>「スタンプ」</b>の札が付き、2票目の券は 1 枚減っています。<br>当たれば 2 票とも払われます。結果を待ちます。<span id="gWait"></span>', wait: true },
    { t: 'また たまり始める', p: '2 票分の結果と、このレースで付いた<b>「スタンプ +○」</b>が出ました。使ったあとも、投票するたびにまたたまっていきます。<br><b>説明は以上です。</b>このまま遊べます。' },
  ];
  function guideShow(i, by) {
    if (!G) return; G.i = Math.max(0, Math.min(STEPS.length - 1, i)); if (by === 'auto') G.max = Math.max(G.max, G.i);
    const st = STEPS[G.i]; $('gNum').textContent = G.i + 1; $('gTitle').textContent = st.t; $('gText').innerHTML = st.p;
    $('gDots').innerHTML = STEPS.map((_, k) => '<i' + (k === G.i ? ' class="on"' : '') + '></i>').join('');
    $('gPrev').disabled = G.i === 0; const nx = $('gNext'); const last = G.i === STEPS.length - 1, pending = !!st.wait && G.max <= G.i;
    nx.textContent = last ? '最初から' : st.btn && pending ? st.btn : pending ? '待っています…' : '次へ'; nx.disabled = pending && !st.btn; // 自動で進む段は、起きるまで「次へ」を押せない（起きたら進む）。btn の段はボタンで進む
  }
  if (G) {
    $('gPrev').addEventListener('click', () => guideShow(G.i - 1, 'user'));
    $('gNext').addEventListener('click', async () => {
      if (G.i === STEPS.length - 1) { G.max = 0; return guideShow(0, 'user'); }
      const st = STEPS[G.i];
      if (st.btn && G.max <= G.i) { // 「残りをまとめて足す」: 10 個になるまで足す（説明ページだけ）
        const B = F.contentWindow && F.contentWindow.BET, bal = B && B.stamps ? B.stamps.bal : 0, need = Math.max(0, 10 - bal);
        if (need > 0 && window.__addStamps) await window.__addStamps(need);
        G.max = Math.max(G.max, G.i + 1); return guideShow(G.i + 1, 'auto');
      }
      guideShow(G.i + 1, 'user');
    });
    guideShow(0, 'user');
    // お客さんのスマホの様子で進む: 3→4 投票した／4→5 結果が出た（スタンプが付いた）／5→6 ボタン／6→7 「スタンプで もう1票」が出た／7→8 2 票目が入った／8→9 結果が出た
    setInterval(() => {
      const w = F.contentWindow, B = w && w.BET; if (!B || !B.st) return;
      const d = w.document, voted = !!(B.my && B.my.vote), use = !!d.querySelector('.stampuse'), v2 = !!(B.my && B.my.vote2), res = B.screen === 'result' && !!d.querySelector('.stampgot');
      const at = (k) => { if (G.max < k) { G.max = k; if (G.i === k - 1 || G.i < k) guideShow(k, 'auto'); } };
      if (voted) at(3); if (res && G.max < 5) at(4); if (use) at(6); if (v2) at(7); if (res && G.max >= 7) at(8);
      const gw = $('gWait'); if (gw) gw.innerHTML = '<span class="wait"></span>' + ($('pStatus').textContent || '');
    }, 700);
  }
  const BET = () => { try { return F.contentWindow && F.contentWindow.BET; } catch (e) { return null; } };
  $('pIntroBtn').addEventListener('click', () => { $('pIntro').hidden = true; });
  if (window.__STAMP_DEMO) $('pIntro').hidden = true;

  /* ---------- ほかのお客さん（上野・毎レース 6 票） ---------- */
  const bot = { cs: [], done: {} }; // 1 人 1 台（1 台で番号を 4 つ以上使うと決め方に数えない決まりがあるため）
  async function botVotes(r) {
    if (bot.done[r.id]) return; bot.done[r.id] = true;
    for (let k = 0; k < 6; k++) {
      if (!bot.cs[k]) { bot.cs[k] = mk({ role: 'phone', store: 'ueno' }, 'bot' + k); await bot.cs[k].ready(); }
      const a = Math.floor(Math.random() * 6); let b = Math.floor(Math.random() * 5); if (b >= a) b++;
      try { await bot.cs[k].vote({ raceId: r.id, bill: String(30 + k * 10 + Math.floor(Math.random() * 10)), nick: 'ほか' + (k + 1), first: a, second: b }); } catch (e) { log('bot ' + (e && e.code)); }
    }
  }
  /* ---------- あなたの 1 票（自動） ---------- */
  const mine = { done: {}, last: null };
  async function myVote(r) {
    const B = BET(); if (!B || !B.C || mine.done[r.id]) return;
    mine.done[r.id] = true;
    const a = Math.floor(Math.random() * 6); let b = Math.floor(Math.random() * 5); if (b >= a) b++;
    const bill = String(10 + Math.floor(Math.random() * 89));
    try { await B.C.vote({ raceId: r.id, bill, nick: 'テスト', first: a, second: b }); B.route(); mine.last = { raceId: r.id, bill, first: a, second: b }; log('my vote ' + r.id + ' ' + (a + 1) + '→' + (b + 1)); }
    catch (e) { mine.done[r.id] = false; log('my vote fail ' + (e && e.code)); }
  }

  /* ---------- 上の 1 行（次のレース・いまの場面）と、自動の投票 ---------- */
  /* スタンプラリーの試し: 初参加ボーナス（無料の 2 票目）が先に出るとスタンプの 2 票目が見えないので、このスマホは「今日はもうボーナスを使った」印を先に入れておく（にせ Firestore に直接。試しのページだけ） */
  let bonusMarked = '';
  function markBonusUsed() {
    if (!window.__STAMP_DEMO || !decider) return; const cu = keepAuth.bet && keepAuth.bet.auth.currentUser; if (!cu) return;
    const day = window.DerbyCore.bizDate(decider.serverNow(), 5), k = 'derbyBonusDev/' + day + '~' + cu.uid; if (bonusMarked === k) return; bonusMarked = k;
    if (!fake.raw.get(k)) fake.raw.set(k, { data: { day, owner: cu.uid, raceId: 'demo', storeId: STORE, bill: '00', at: Date.now() }, v: 1 });
  }
  setInterval(async () => {
    if (!decider) return; markBonusUsed();
    let s = null; try { s = await decider.state(STORE); } catch (e) { return; }
    const t = decider.serverNow(), o = s.open && t >= (s.open.openAt || 0) && t < s.open.closeAt ? s.open : null, L = s.live, nx = s.next || (s.upcoming || [])[0] || null;
    let txt;
    if (L && t < (L.revealAt || 0)) txt = hm(L.at) + ' のレース ' + (t < L.runAt ? 'まもなく発走' : 'レース中');
    else if (o) txt = hm(o.at) + ' のレース 投票中・締切まで ' + left(o.closeAt - t);
    else if (s.last && t < (s.last.endAt || 0)) txt = hm(s.last.at) + ' のレース 結果発表';
    else if (nx) txt = '次のレース ' + hm(nx.at) + ' 発走・投票は ' + hm(nx.openAt || nx.at) + ' から（あと ' + left((nx.openAt || nx.at) - t) + '）';
    else txt = '本日のレースは終わりました';
    if ($('pStatus').textContent !== txt) $('pStatus').textContent = txt;
    if (!$('pIntro').hidden) $('pIntroSt').textContent = mine.last ? '1 票入れました（' + (mine.last.first + 1) + '→' + (mine.last.second + 1) + '）' : o ? 'まもなく自動で投票します' : txt;
    if (o && o.closeAt - t > 8000) { botVotes(o).catch(() => {}); if (t - (o.openAt || 0) > 3000) myVote(o).then(() => { if (mine.last && mine.last.raceId === o.id) setTimeout(() => { $('pIntro').hidden = true; }, 1500); }); }
  }, 1000);

  window.PHONE_TEST = { fake, ready, get decider() { return decider; }, get mine() { return mine.last; }, log: () => LOG.slice() };
})();
