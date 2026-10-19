/* casa DERBY v2 テレビ（index.html?store=<id>）。js/game.js の代わりに動く。
   全店同じレースを同じ瞬間に流す: サーバーの時刻（DerbyCloud.serverNow）と /api/state・SSE に従って場面を進める。
   場面（#stage のクラス）:
     m-wait   待ち時間: 次のレースのパドック＋QR＋「発走まで mm:ss」。前のレースのハイライト（m-hl）と交互
     m-hl     前のレースのハイライト（ゴール前〜リプレイ〜勝ち馬を seed から再現）＋全店の当たった人
     m-open   受付: パドック＋出馬表＋単勝オッズ＋大きな QR＋全店の参加人数。受付は 2 段（2026-10-16）:
              参加受付中は「参加受付 あと m:ss」（大）＋「投票締切 hh:mm」（小）、参加受付の締切のあとは「参加受付は締切」＋「投票 あと m:ss」（大）。
              QR は大きいまま出し続け、説明を「投票はスマホで」に変える（認証済みの人のスマホはもう開いている。新しく読んだ人のスマホには次のレースの案内が出る）
     m-live   締切 → ゲートイン → レース（右に最終確定オッズ）→ ゴール → リプレイ・写真判定 → 勝ち馬 → 着順掲示板
     m-result 結果: 着順と払戻金（単勝）・全店の当たった人。resultSec（既定 300 秒）か、スタッフの「次へ」で待ち時間へ
   走りはサーバーが決めた seed を Engine.replayRun で再現し、ゲートが開いてからの時間（serverNow − runAt）に合わせて進める
   （js/race3d.js の start({ run, clock })。途中から見始めたテレビは絵を描かずに追いつく。ゴール後なら結果へ）。
   一人用（?store= なし）は今までどおり js/game.js（index.html がどちらを読むか決める）。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const QS = location.search;
  const STORE = decodeURIComponent((QS.match(/[?&]store=([^&#]+)/) || [])[1] || '');
  const MUTE = /[?&]mute=1/.test(QS);
  const stageEl = $('stage');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  if (MUTE) Sfx.mute(true);
  /* 2026-10-19 オーナー「レース中以外は音を出さない」: 音の出口（js/audio.js の scene）は場面が「レース」（m-live）のときだけ開ける（setMode）。
     レース＝締切（「締切ました」）→ ファンファーレ → ゲートイン → 発走 → レース → ゴール → リプレイ・写真判定 → 勝ち馬のアップ → 着順掲示板（確定）まで。
     待ち受け・前のレースのハイライト・参加受付・投票・結果発表の画面は無音（パドックの蹄・結果の音・音ボタンの「ピッ」も鳴らさない） */
  if (Sfx.scene) Sfx.scene(false);
  stageEl.classList.add('v2');

  // ---------- 音のオン・オフ（game.js と同じ。状態は端末に保存） ----------
  (function soundButton() {
    const KEY = 'casaDerby.sound', btns = Array.from(document.querySelectorAll('.soundbtn')); if (!btns.length) return;
    let saved = null; try { saved = localStorage.getItem(KEY); } catch (e) { }
    if (saved === 'off') Sfx.mute(true);
    const show = () => { const off = Sfx.isMuted(); btns.forEach((btn) => { btn.classList.toggle('off', off); btn.setAttribute('aria-label', off ? '音を出す' : '音を消す'); btn.querySelector('small').textContent = off ? '音OFF' : '音ON'; }); };
    const toggle = () => { const off = !Sfx.isMuted(); Sfx.mute(off); if (!off) { unlockAudio(); Sfx.play('button'); } try { localStorage.setItem(KEY, off ? 'off' : 'on'); } catch (e) { } show(); };
    btns.forEach((btn) => { btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); btn.blur(); }); btn.addEventListener('keydown', (e) => e.stopPropagation()); });
    document.addEventListener('keydown', (e) => { if ((e.key === 's' || e.key === 'S') && !e.repeat && !e.ctrlKey && !e.metaKey) toggle(); });
    show();
  })();

  // ---------- 拡縮（game.js と同じ。2026-10-18: casa SLOT の「画面サイズ調整」をそのまま使う） ----------
  // SLOT はこのテレビで調整した枠を localStorage 'casa-slot-button.state.v1' の settings.screen（画面に対する割合 0〜1 の { x0, y0, x1, y1 }）に保存している。
  // Fire TV のアプリでは SLOT と DERBY が同じ場所から開くので、同じ値を読める。DERBY は読むだけで、書き換えない。
  // Web デモ（demo-config.js が先に読まれる）では使わない。枠があるときは SLOT と同じ計算（枠の左上へ動かし、縦と横を別々に伸縮して枠にぴったり合わせる）。枠が無い・小さすぎる・全画面なら今までどおり。
  const SLOT_KEY = 'casa-slot-button.state.v1';
  const IS_DEMO = !!(window.DERBY_FIREBASE && window.DERBY_FIREBASE.demo) || !!window.__derbyDemoPage;
  function slotScreen() {
    if (IS_DEMO) return null;
    let s = null;
    try { const raw = localStorage.getItem(SLOT_KEY); const st = raw ? JSON.parse(raw) : null; s = st && st.settings && st.settings.screen; } catch (e) { s = null; }
    if (!s || !(s.x1 - s.x0 >= 0.3 && s.y1 - s.y0 >= 0.3)) return null;
    if (s.x0 <= 0 && s.y0 <= 0 && s.x1 >= 1 && s.y1 >= 1) return null;
    return s;
  }
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight, sr = slotScreen();
    if (sr) {
      const w = Math.max(1, (sr.x1 - sr.x0) * vw), h = Math.max(1, (sr.y1 - sr.y0) * vh);
      stageEl.style.transform = 'translate(' + sr.x0 * vw + 'px,' + sr.y0 * vh + 'px) scale(' + w / 1600 + ',' + h / 900 + ')';
      stageEl.dataset.calib = '1';
    } else {
      const s = Math.min(vw / 1600, vh / 900);
      stageEl.style.transform = 'translate(' + (vw - 1600 * s) / 2 + 'px,' + (vh - 900 * s) / 2 + 'px) scale(' + s + ')';
      delete stageEl.dataset.calib;
    }
    $('rotate').style.display = vh > vw && vw < 700 ? 'grid' : 'none';
  }
  window.addEventListener('storage', (e) => { if (!e.key || e.key === SLOT_KEY) layout(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) layout(); });
  window.addEventListener('resize', layout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  layout();

  // ---------- 画面の部品（v2 だけのもの）を足す ----------
  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  const top = stageEl.querySelector('.top'), sndBtn = top.querySelector('.soundbtn');
  // 状態の札（2026-10-19 店内モニターの見やすさ）: どの場面も左上の同じ位置・同じ形で「いま何の時間か」を出す。色は 5 つ（緑＝受付・青＝投票・赤＝締切・紺＝レース・金＝結果）
  top.insertBefore(el('<div class="v2st" id="v2st"><i></i><b id="v2stT"></b></div>'), top.firstChild);
  top.insertBefore(el('<div class="v2clock" id="v2clock"><small id="v2clockLbl">発走まで</small><b id="v2clockNum">--:--</b></div>'), sndBtn);
  top.insertBefore(el('<div class="v2ppl" id="v2ppl"><small>全店で</small><b id="v2pplNum">0</b><small>人が参加</small></div>'), sndBtn);
  top.insertBefore(el('<span class="v2store" id="v2store"></span>'), sndBtn);
  stageEl.appendChild(el('<div class="v2info" id="v2info"><div class="cd" id="v2cd"><small id="v2cdLbl">発走まで</small><b id="v2cdNum">--:--</b><div class="cdl"><i id="v2cdSt"></i><span id="v2cdSub"></span></div></div>' +
    '<div class="how" id="v2how"><h4>参加方法</h4><ol><li>画面右下のQRを読む</li><li>投票枚数を決めて、スタッフ認証を待つ</li><li>スマホで投票</li></ol>' +
    // 交換の割合（2026-10-19 オーナー「Bounty X 枚で 100 と交換。参加受付中の画面にはっきりと。X はマスターからいじれるように」）: 数字は tickLabels が設定（settings.bountyPerTicket）から入れる
    '<div class="v2rate" id="v2rate"><i>交換</i><span>リングバウンティ</span><b id="v2rateX">20</b><span class="u">枚</span><em>→</em><b>100<small class="pt">pt</small></b></div></div></div>')); /* 2026-10-20: 100 → 100pt */
  // QR の下の URL は出さない（テレビでは途中で折り返して読めない。2026-10-14 見た目の講評）。#v2qrUrl は中身だけ持つ（確認用）
  stageEl.appendChild(el('<div class="v2qr" id="v2qr"><div class="code" id="v2qrCode"></div><div class="tx" id="v2qrTx"><b>アプリ不要 スマホで参加</b><span>スマホのカメラで<br>読み取ってください</span><em>アプリは不要です</em><small id="v2qrUrl" hidden></small></div></div>'));
  stageEl.appendChild(el('<div class="v2odds" id="v2odds"><h5><small>確定</small>オッズ</h5><ol id="v2oddsList"></ol></div>')); // 2026-10-19: 「100あたりの額」→ 倍率
  stageEl.appendChild(el('<div class="v2strip" id="v2strip"><div class="ttl" id="v2stripTtl"></div><div class="sep"></div><div class="ppl">全店で<b id="v2stripPpl">0</b>人が参加</div><div class="stores" id="v2stripStores"></div><div class="nx" id="v2stripNx"><small id="v2stripNxL"></small><b id="v2stripNxN"></b></div><div class="soon">結果はまもなく</div></div>'));
  stageEl.appendChild(el('<div class="v2hl-tag" id="v2hlTag">前のレースのハイライト<small id="v2hlTagSub"></small></div>'));
  stageEl.appendChild(el('<div class="v2hlw" id="v2hlw"><h5>全店の当たった人<small id="v2hlwSub"></small><span class="pg"></span></h5><div class="win1" id="v2hlwWin"></div><div class="v2wl" id="v2hlwList"><div class="inner"></div></div></div>'));
  stageEl.appendChild(el('<div class="v2closed" id="v2closed">締切ました</div>'));
  stageEl.appendChild(el('<div class="v2res" id="v2res"><div class="col l"><div class="rhd"><div class="v2st" id="v2st2"><i></i><b id="v2st2T"></b></div><h2 id="v2resTtl">レース結果</h2></div><div class="ord" id="v2resOrd"></div><div class="pay" id="v2resPay"></div><div class="foot" id="v2resFoot"><div class="nx" id="v2resNx"></div><div class="cdn"><small id="v2resNxL"></small><b id="v2resNxN"></b></div><div class="rest"><span id="v2resRestL"></span><span class="bar"><i id="v2resBar"></i></span><b id="v2resRestN"></b></div></div></div>' +
    '<div class="col r"><div class="head"><h3>全店の当たった人<small>当選額</small></h3><span id="v2resCnt"></span><span class="pg"></span></div><div class="v2wl" id="v2resList"><div class="inner"></div></div><div class="ract" id="v2resAct"><i class="phone" aria-hidden="true"><s></s></i><div><b>当たった方は</b><span>スマホの<em>受け取り QR</em>を</span><span>スタッフへ見せてください</span></div></div><div class="rnote" id="v2resNote">当選額は10の位を切り上げ リングチップでお渡し</div><div class="rsub" id="v2resSub"></div></div></div>'));
  // 通信が 15 秒以上切れたとき: 上に大きな帯（レース映像の真ん中は覆わない。QR はそのまま＝お客さんのスマホはテレビと別に通信している）
  stageEl.appendChild(el('<div class="v2down" id="v2down"><b>通信が切れています</b><span>自動でつなぎ直します</span></div>'));
  stageEl.appendChild(el('<div class="v2net" id="v2net">通信中…</div>'));
  stageEl.appendChild(el('<div class="v2net v2key" id="v2key"><b>このテレビは設定が必要です</b><span>スタッフにお知らせください</span><small>（スタッフの方へ）テレビの合言葉がありません。管理画面のテレビの URL で開き直すか、管理画面の「進行役にする」で選んでください</small></div>'));
  stageEl.appendChild(el('<div class="v2snd" id="v2snd">決定ボタン（OK）を押すと音が出ます</div>'));
  // 進行役のテレビ（2026-10-19）: 管理画面で「進行役にする」を押されている間だけ、上の帯のまん中に確認の 4 けたの数字（オーナーが管理画面の数字と見くらべる）
  stageEl.appendChild(el('<div class="v2pair" id="v2pair" aria-live="polite"><small id="v2pairLbl">進行役の確認</small><b id="v2pairCode"></b></div>'));

  // ---------- クラウド ----------
  if (!window.DerbyCloud || !DerbyCloud.create) { console.error('casa DERBY v2: v2/client.js が読めません'); }
  // テレビの合言葉（RED TEAM 2026-10-14）: 発表前の結果（seed）はこれを持つテレビにだけ届く（スマホがテレビを名乗っても読めない）。
  // Firestore 版のテレビ用パスワードと同じく ?tvkey=...（別名 tv=）で 1 回開くと、そのテレビに覚えてアドレスから消す（管理画面の「店舗」のテレビの URL に入っている）。
  // 無い・違うと、結果はスマホと同じく発表のときにしか届かない（画面の隅に注意を出す）
  const TVKEY = (function () {
    const K = 'casa.derby.tvkey', m = QS.match(/[?&](?:tvkey|tv)=([^&#]+)/);
    let v = null; try { v = m ? decodeURIComponent(m[1]) : null; } catch (e) { v = null; }
    // アドレスから消したあとも、ページの履歴（history.state）にも持っておく: 端末の保存（localStorage）が消えても、読み込み直し（reload）で合言葉を失わない
    //（2026-10-14 回帰: 通しテストが保存を消して読み込み直すと、最初からいたテレビ 3 台が合言葉を失い、発表まで結果（seed）が届かずレースを描けなかった）
    let hs = null; try { hs = history.state && history.state.tvkey ? String(history.state.tvkey) : null; } catch (e) { hs = null; }
    try {
      if (v) {
        localStorage.setItem(K, v);
        if (localStorage.getItem(K) === v) history.replaceState(Object.assign({}, history.state || {}, { tvkey: v }), '', location.href.replace(/([?&])(?:tvkey|tv)=[^&#]*&?/g, '$1').replace(/[?&](#|$)/, '$1')); // 覚えられたときだけ消す（覚えられない端末では URL に残す）
      } else {
        v = localStorage.getItem(K) || hs;
        if (v && !localStorage.getItem(K)) localStorage.setItem(K, v); // 履歴から戻せたら保存し直す
        if (v && !hs) history.replaceState(Object.assign({}, history.state || {}, { tvkey: v }), '', location.href);
      }
    } catch (e) { v = v || hs; }
    return v || null;
  })();
  let tvAuth = null; // サーバーの答え: true（合言葉 OK）/ false（無い・違う）/ null（Firestore 版など、使わない）
  const C = window.DerbyCloud && DerbyCloud.create ? DerbyCloud.create({ store: STORE, role: 'tv', tvKey: TVKEY }) : null;
  const now = () => (C && C.serverNow ? C.serverNow() : Date.now());
  /* 進行役のテレビ（2026-10-19）: 数字は「確認中」の間だけ（最長 3 分）。選ばれた・外れたときは 8 秒だけ知らせる（ふだんは何も出さない） */
  {
    let was = null, msgT = 0; window.__derbyPair = null;
    // 置き場所: 上の帯の「発走の時刻」の札のすぐ右（左の状態の札の長さで動くので、出すたびと 1 秒ごとに合わせる）。ロゴには重ねない
    const place = () => {
      const b = $('v2pair'); if (!b.classList.contains('show')) return;
      const sr = stageEl.getBoundingClientRect(), k = sr.width / 1600 || 1, ri = stageEl.querySelector('.top .raceinfo'), lg = stageEl.querySelector('.top .logo');
      const r = ri && ri.getBoundingClientRect(), lr = lg && lg.getBoundingClientRect(), w = b.offsetWidth || 170;
      let x = r && r.width ? (r.right - sr.left) / k + 14 : 700; if (lr && lr.width) x = Math.min(x, (lr.left - sr.left) / k - 14 - w);
      b.style.left = Math.max(20, Math.round(x)) + 'px';
    };
    setInterval(place, 1000);
    const show = (lbl, code, cls) => { const b = $('v2pair'); $('v2pairLbl').textContent = lbl; $('v2pairCode').textContent = code || ''; b.className = 'v2pair show' + (cls ? ' ' + cls : ''); place(); };
    const hide = () => { $('v2pair').className = 'v2pair'; };
    if (C && C.onPair) C.onPair((p) => {
      window.__derbyPair = p; // テスト用（window.DERBY.pair）
      clearTimeout(msgT);
      if (p.asking && p.code) show('進行役の確認', p.code);
      else if (was !== null && p.decider !== was) { show(p.decider ? '進行役になりました' : '進行役を外れました', '', 'msg'); msgT = setTimeout(hide, 8000); }
      else hide();
      was = !!p.decider;
    });
  }
  let S = null;                    // いちばん新しい /api/state
  // 店ごとの設定（/api/state の settings）: 場面の有無と長さ・回し方・テストモード
  const ST = () => (S && S.settings) || {};
  const scene = (k) => !(ST().scenes && ST().scenes[k] === false);
  const sceneSec = (k) => { const v = ST().sceneSec && Number(ST().sceneSec[k]); return v > 0 ? v : null; };
  const runMode = () => ST().mode || 'auto';
  const cache = {};                // レース id → Race（state・race イベントで更新）
  let lastOk = performance.now(), sseErr = false;
  let seenSeq = null;              // store.nextSeq（スタッフの「次へ」）
  let seenReload = null;           // store.reloadSeq（管理画面の「テレビを読み込み直す」）
  // 管理画面からの読み込み直し: アドレスに _r=（時刻）を付けて開き直す（index.html が v2 のファイルの版にも使う＝古いファイルを使わない）
  // 合図（reloadSeq・reload）は reloadWithUpdate へ: Fire TV のアプリの中なら、先に新しい版を取り込んでから開き直す（下の「自動アップデート」）
  function doReload() { if (TV.reloading) return; TV.reloading = true; try { const u = new URL(location.href); u.searchParams.set('_r', Date.now().toString(36)); let kept = null; try { kept = localStorage.getItem('casa.derby.tvkey'); } catch (e) { } if (TVKEY && kept !== TVKEY) u.searchParams.set('tvkey', TVKEY); location.replace(u.toString()); } catch (e) { location.reload(); } } // 保存に合言葉が無い端末は URL で渡す（開いたらまた消える）
  function keepRace(r) { if (!r || !r.id) return r; const o = cache[r.id]; cache[r.id] = o ? Object.assign(o, r) : r; if (view && view.id === r.id && cache[r.id].cues) applyCues(cache[r.id]); /* 結果と一緒に演出が届いた: 映しているレースならすぐ渡す（ゲートインの前） */ return cache[r.id]; }
  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    S = s; lastOk = performance.now(); sseErr = false;
    // 馬の見た目（全店共通の設定）: 本物寄りを使うかもしれないなら、レースの区切りより前に部品を読み込んでおく（v2/core.js の horseLookFor）
    { const hs = s.settings || {}; if ((hs.horseLook === 'real' || hs.horseLookPrev === 'real' || /[?&]horse=real\b/.test(QS)) && window.Race3D && Race3D.loadHorseReal) Race3D.loadHorseReal(); }
    if (typeof s.tvAuth === 'boolean') tvAuth = s.tvAuth;
    ['open', 'live', 'last', 'next'].forEach((k) => { if (s[k]) s[k] = keepRace(s[k]); });
    const seq = s.store && s.store.nextSeq;
    if (seq != null) { if (seenSeq != null && seq > seenSeq) onNext(); seenSeq = seq; }
    const rs = s.store && s.store.reloadSeq;
    if (rs != null) { if (seenReload != null && rs > seenReload) reloadWithUpdate(); seenReload = rs; }
    if (s.store && s.store.name) { $('v2store').textContent = s.store.name + (/店$/.test(s.store.name) ? '' : '店') + (ST().test || (s.open && s.open.test) || (s.live && s.live.test) ? '（テスト）' : ''); $('v2store').classList.toggle('test', !!(ST().test || (s.open && s.open.test) || (s.live && s.live.test))); } /* テストのレース（2026-10-19。スタッフの「この店だけテストレース」）もテストモードの店と同じ印 */
    renderQR();
  }
  function onNext() { // スタッフの「次へ」: いま出している結果画面を閉じる。回し方が「スタッフが開始」の店では、次のレース（走っていれば今のレース）を流す合図
    if (TV.resultRace) { TV.dismissed[TV.resultRace.id] = true; }
    TV.armed = true;
    TV.nextAt = performance.now();
  }
  let badStore = false; // URL の store= が登録にない（打ちまちがい・削除した店舗）: 「通信中…」のままにせず、直し方を出す
  async function refresh() {
    if (!C) return;
    try { applyState(await C.state()); badStore = false; }
    catch (e) { sseErr = true; badStore = !!(e && e.code === 'no_store'); if (badStore) { const n = $('v2net'); n.classList.add('show', 'full'); n.innerHTML = '<b>このテレビは設定が必要です</b><span>スタッフにお知らせください</span><small>（スタッフの方へ）店舗「' + esc(STORE) + '」が見つかりません。管理画面のテレビの URL で開き直してください</small>'; } } // 画面全体を覆う（ふつうの画面や QR を出さない）
  }
  // 古いレースは捨てる（何日もつけっぱなしのテレビでメモリが増え続けないように）
  function pruneCache() {
    const lim = now() - 2 * 3600e3, keep = {};
    ['open', 'live', 'last', 'next'].forEach((k) => { if (S && S[k]) keep[S[k].id] = 1; });
    if (view) keep[view.id] = 1; if (TV.resultRace) keep[TV.resultRace.id] = 1; if (TV.playing) keep[TV.playing] = 1;
    Object.keys(cache).forEach((id) => { const r = cache[id]; if (!keep[id] && r && (r.endAt || r.at || 0) < lim) { delete cache[id]; delete TV.done[id]; delete TV.dismissed[id]; delete TV.skipped[id]; delete missing[id]; } });
  }
  const missing = {};
  async function getRace(id) { if (!C || !id || missing[id] > performance.now()) return null; try { return keepRace(await C.race(id)); } catch (e) { if (e && e.status === 404) missing[id] = performance.now() + 60000; return null; } }
  if (C) {
    (async () => { try { await C.syncClock(); } catch (e) { } await refresh(); })();
    setInterval(() => { if (C.syncClock) C.syncClock().catch(() => {}); }, 5 * 60 * 1000);
    setInterval(refresh, 10000); // SSE が黙って止まっていても 10 秒ごとに取り直す
    setInterval(() => { try { pruneCache(); } catch (e) { console.error(e); } }, 10 * 60 * 1000);
    try {
      C.subscribe({
        hello(h) { lastOk = performance.now(); sseErr = false; if (h && typeof h.tvAuth === 'boolean') tvAuth = h.tvAuth; },
        open() { lastOk = performance.now(); sseErr = false; },
        state(s) { applyState(s); },
        race(r) { keepRace(r); lastOk = performance.now(); },
        next(n) { lastOk = performance.now(); if (!n || !n.store || n.store === STORE) { if (n && n.nextSeq != null) seenSeq = n.nextSeq; onNext(); } },
        reload(x) { lastOk = performance.now(); if (!x || !x.store || x.store === STORE) reloadWithUpdate(); },
        error() { sseErr = true; },
      });
    } catch (e) { console.error(e); }
  }
  // 通信の印: 15 秒以上なにも届かない、または接続が切れている
  // 2026-10-19: 段階的に。切れてすぐ〜15 秒は右下の小さな「通信中…」、15 秒以上なにも届かなければ上に大きな帯（#v2down）
  setInterval(() => { const quiet = performance.now() - lastOk, bad = !C || sseErr || badStore || quiet > 15000; $('v2net').classList.toggle('show', bad); if (!badStore && $('v2net').textContent !== '通信中…') { $('v2net').textContent = '通信中…'; $('v2net').classList.remove('full'); } $('v2down').classList.toggle('show', !badStore && (!C || quiet > 15000)); stageEl.classList.toggle('v2bad', badStore || tvAuth === false); $('v2key').classList.toggle('show', tvAuth === false && !badStore); }, 1000);

  // ---------- レース映像 ----------
  const raceView = new Race($('race'));
  raceView.timeScale = 1;
  raceView.no800 = true; // 2026-10-20 オーナー「消して」: 残り 800m の縦の札（js/race3d.js）は店内モニターでは出さない
  const T = Engine.TYPES;
  let view = null;                 // いま映像に入っているレース（Race オブジェクト）
  let viewOdds = null;             // 出馬表・字幕のオッズ（受付中は表示用、締切後は確定）
  // パドックの字幕（映像の左下）: 脚質・能力・調子／単勝の倍率・近 5 走（出馬表と同じ成績＝v2/form.js）
  raceView.info = (i) => { const h = view.horses[i], t = T[h.type] || { label: '' }, o = viewOdds && viewOdds[i]; return { line1: t.label + '　' + '★'.repeat(h.stars) + '☆'.repeat(Math.max(0, 5 - h.stars)) + '　調子 ' + h.cond.mark + h.cond.label, line2: (o ? '単勝 ' + ox(o) + '倍　' : '') + '近走 ' + formOf(h, view).past.join('-') }; };
  const is3D = () => !!(raceView.glcv && window.Race3D && Race3D.timeline);
  function giEnd() { return (raceView.giPlan && raceView.giPlan.end) || 8; }   // ゲートインの長さ（js/race3d.js の台本。2026-10-14 に約 13 秒 → 約 8 秒）
  // 映像にレース R を入れる（同じなら何もしない）。パドックは受付の間ずっと（paddockSec を大きく）
  /* レース R の馬の見た目（'cute' | 'real'）: サーバーがレースごとに決めた R.horseLook。無ければ設定から同じ決まりで
     （受付の始まり openAt が「変えた時刻＋猶予」horseLookFrom より後なら新しい見た目、前なら前の見た目＝全店そろう・途中で変わらない） */
  function lookOf(R) {
    if (R && (R.horseLook === 'cute' || R.horseLook === 'real')) return R.horseLook;
    const hs = ST(), from = Number(hs.horseLookFrom) || 0, open = R ? Number(R.openAt != null ? R.openAt : R.at) || 0 : 0;
    return (!from || open >= from ? hs.horseLook : hs.horseLookPrev) === 'real' ? 'real' : 'cute';
  }
  /* 確定演出（2026-10-16 オーナー決定。木の実・観客の服・看板・雲・ゲートインの遅れ・最終コーナーの目の光で勝ち馬をほのめかす）:
     サーバー／決める係が結果と一緒に決めた R.cues（合言葉のあるテレビにだけ届く）を、映像に渡す（js/race3d.js の setCues。無い版は何もしない）。
     形は { fruit: { horse: 2 } | null, crowd, sign, cloud, gateLate, eye }（horse は 0 始まり）。結果がまだ無いレース・リセットは null。
     確認用の上書き ?cues=fruit:2,eye:2（0 始まりの馬の添字。結果が無いときだけ＝写真を撮るため） */
  const CUE_Q = (() => { const m = QS.match(/[?&]cues=([^&#]*)/); if (!m) return null; const o = {}; decodeURIComponent(m[1]).split(',').forEach((p) => { const kv = /^([A-Za-z]+):(\d)$/.exec(p.trim()); if (kv) o[kv[1]] = { horse: Number(kv[2]) }; }); return Object.keys(o).length ? o : null; })();
  const cuesOf = (R) => (R && R.cues) || (R && R.result && R.result.cues) || null;
  function applyCues(R) {
    const c = cuesOf(R) || (R && R.result ? null : CUE_Q) || null, key = JSON.stringify(c);
    if (TV.cuesKey === key && TV.cuesId === (R && R.id)) return;
    TV.cues = c; TV.cuesKey = key; TV.cuesId = R && R.id;
    if (raceView.setCues) { try { raceView.setCues(c); } catch (e) { console.error(e); } }
  }
  function useRace(R, odds, force) {
    viewOdds = odds || R.odds || null;
    // 同じレースでも、まだ走り出す前（パドック）で馬の見た目の決まりが変わった・本物寄りの部品が読み終わったときは作り直す（待ち時間のパドックで先に作ったレースを、設定が届いたあと全店そろえるため）
    const want = lookOf(R), lookStale = raceView.setHorseLook && raceView.phase === 'idle' && (want !== (raceView.horseLookReq || 'cute') || (want === 'real' && raceView.horseLook !== 'real' && window.R3D && R3D.HorseReal));
    if (!force && view && view.id === R.id && !lookStale) { applyCues(R); renderHorses(); return; }
    view = R; raceView.paddockSec = 1e9; raceView.gateShot = false;
    if (raceView.setHorseLook) raceView.setHorseLook(lookOf(R)); // 馬の見た目はレースを入れるときだけ決める（走っている途中では変えない）
    applyCues(R); // 映像を作る前に渡す（結果がまだなら null か ?cues= の上書き。結果が届いたら keepRace・playRace でもう一度）
    raceView.setRace(R);
    bcPhase('reset');
    renderHeader(R); renderHorses();
  }
  // 文字が枠に入りきらないときだけ小さくする（途中で切らない・折り返さない。2026-10-14 見た目の講評: 9 文字の馬名が「…」で切れていた）
  function fitText(e, max, min) {
    if (!e) return; e.style.fontSize = max + 'px'; if (!e.clientWidth) return;
    let f = max; while (f > min && e.scrollWidth > e.clientWidth + 1) { f -= 1; e.style.fontSize = f + 'px'; }
  }
  function fitNames() { document.querySelectorAll('#horses .horse .l1 b').forEach((b) => fitText(b, 36, 22)); document.querySelectorAll('#horses .horse .odds b').forEach((b) => fitText(b, 38, 24)); } // 2026-10-19: 店内モニター向けに大きく（36px まで）
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitNames()).catch(() => {});
  function horsePic(i, kind) { try { return raceView.portrait ? raceView.portrait(i, kind) : null; } catch (e) { return null; } }
  /* 出馬表（2026-10-19 オーナー「出走表には直近の成績と、逃げとかの特徴は書いていいよ」「オッズ表記は倍率にしよう」）:
     番号・馬名（主役）｜脚質（色の札）｜近 3 走の着順（左が前走。1〜3 着は金・銀・銅の四角）｜単勝の倍率（小数 1 桁＋「倍」）。
     見出しも同じ列に「脚質」「近3走」「単勝オッズ」。顔・★・調子は出さない（遠くから読む文字を増やしすぎない） */
  function cardHead() {
    const h4 = stageEl.querySelector('.side .card h4'); if (!h4 || h4.dataset.v3) return;
    h4.dataset.v3 = '1'; h4.innerHTML = '<span class="t">出馬表</span><span class="c">脚質</span><span class="c">調子</span><span class="c">近3走</span><span class="c o">単勝オッズ</span>'; // 2026-10-20 オーナー「馬の調子を出馬表にも」
  }
  function renderHorses() {
    const box = $('horses'); if (!view) return; box.innerHTML = ''; cardHead();
    view.horses.forEach((h, i) => {
      const t = T[h.type] || { label: '?', color: '#ccc' }, d = document.createElement('div'), o = viewOdds ? viewOdds[i] : null, fm = formOf(h, view);
      d.className = 'horse v3'; d.style.setProperty('--fc', h.color);
      d.innerHTML =
        '<div class="main"><div class="l1"><span class="no" style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</span><b>' + esc(h.name) + '</b></div></div>' +
        '<i class="v3ty" style="background:' + t.color + '">' + t.label + '</i>' +
        /* 調子（2026-10-20）: パドックの字幕と同じ h.cond（js/engine.js の CONDS）。大きな印＋下に小さく言葉。色は 良い＝赤・普通＝茶・悪い＝青 */
        (h.cond ? '<span class="v3cd c' + (h.cond.mul > 1 ? 'u' : h.cond.mul < 1 ? 'w' : 'n') + '" aria-label="調子 ' + esc(h.cond.mark + h.cond.label) + '"><b>' + esc(h.cond.mark) + '</b><small>' + esc(h.cond.label) + '</small></span>' : '<span class="v3cd"></span>') +
        '<span class="v3fm" aria-label="近3走 ' + fm.recent.join('・') + '着">' + fm.recent.map((p) => '<i class="p' + p + '">' + p + '</i>').join('') + '</span>' +
        '<span class="odds"><b class="' + (o ? Engine.oddsColor(o) : 'white') + '">' + oxH(o) + '</b></span>';
      box.appendChild(d);
    });
    fitNames();
  }
  /* casa DERBY CHIPS（2026-10-17）: お客さんに見せる単位はチップ（1 枚 = 100 チップ）。例は「1,000 → ○○」。
     払い戻しは「額」で見せる（2026-10-16 オーナー決定。1 枚 = 100・3 桁ごとのカンマ。2026-10-20 から単位「pt」）。オッズは 2026-10-19 から倍率（下の ox） */
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  /* 金額の単位「pt」（2026-10-20 オーナー決定。以前は単位なし）: 数字のすぐ後ろに小さく。当選額は 10 の位で切り上げた額（v2/outcome.js の roundPay と同じ） */
  const ptH = (n) => amt(n) + '<small class="pt">pt</small>';
  const roundPay = (v) => { const x = Math.round((Number(v) || 0) * 1000) / 1000; return x > 0 ? Math.ceil(x / 10) * 10 : 0; };
  /* オッズは倍率（2026-10-19 オーナー「オッズ表記は倍率にしよう」）: いつも小数 1 桁（1.1〜999.9）。ox＝数字だけ、oxH＝数字＋小さな「倍」。
     当選額（チップ × 倍率。結果の「例 1,000 → 2,400」・当たった人）は今までどおり額 */
  const FORM = window.DerbyForm || { odds: (o) => (Number(o) > 0 ? (Math.round(Number(o) * 10) / 10).toFixed(1) : '—'), formOf: (h) => ({ past: h.past || [], recent: (h.past || []).slice(0, 3) }) };
  const ox = (o) => FORM.odds(o);
  const oxH = (o) => (Number(o) > 0 ? ox(o) + '<small class="bai">倍</small>' : '—');
  // 近走の着順（v2/form.js。馬名＋営業日の種。営業日の区切りは設定の dayStartHour）
  const formOf = (h, R) => FORM.formOf(h, (R && R.at) || now(), ST().dayStartHour, (R && R.horses && R.horses.length) || 6);
  const hhmm = (ms) => { const d = new Date(ms + 9 * 3600e3); return d.getUTCHours() + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }; // いつも日本時間（Fire TV の時間帯の設定がずれていても）
  const raceTitle = (R) => (R.no ? '第' + R.no + 'レース' : hhmm(R.at) + ' 発走');
  function renderHeader(R) {
    $('raceNo').textContent = raceTitle(R);
    $('raceDist').textContent = R.dist + 'm';
    $('raceSurf').textContent = R.surface === 'turf' ? '芝' : 'ダート'; $('raceSurf').className = 'chip ' + R.surface;
    $('raceWeather').textContent = { sunny: '☀ 晴れ', cloudy: '☁ くもり', rain: '☂ 雨' }[R.weather] || '';
  }
  function fmtLeft(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
  }
  function storeName(id) { const L = (S && S.stores) || []; const s = L.find((x) => x.id === id); return s ? s.name : id || ''; }
  function ppl(R) { const p = R && R.participants; return p ? p.total || 0 : 0; }

  // ---------- QR（店ごとの参加 URL） ----------
  let qrFor = '';
  function renderQR() {
    if (!window.DerbyQR || !STORE) return;
    const url = DerbyQR.joinURL(STORE); if (url === qrFor) return; qrFor = url;
    $('v2qrUrl').textContent = url.replace(/^https?:\/\//, '');
    Promise.resolve(DerbyQR.render($('v2qrCode'), url, { size: 236, margin: 3, ecl: 'M' })).then(sizeQR).catch((e) => { qrFor = ''; console.warn('QR', e); });
  }
  renderQR();
  /* QR の大きさ（オーナー 2026-10-14「QRはかなり大きくしていいかも」）: 1 マスが整数の画素になる大きさを場面ごとに選ぶ（にじまない）。
     受付・待ち時間 340〜360px、ハイライト 260〜280、結果 240〜260 をねらう（その範囲に整数のマスが無ければいちばん近いもの）。
     SVG の中の白い余白は 3 マス。まわりの白い枠（10px 以上）と合わせて 4 マス以上の余白になる。CSS の --qo / --qh / --qr で使う */
  const QR_RANGE = { qo: [340, 360], qh: [260, 280], qr: [240, 260] };
  function qrPx(w, lo, hi) { const a = Math.floor(hi / w), b = Math.ceil(lo / w); if (a >= b) return a * w; const lo2 = Math.max(1, a) * w, hi2 = b * w; return lo - lo2 <= hi2 - hi ? lo2 : hi2; }
  function sizeQR() { const sv = $('v2qrCode').querySelector('svg'), vb = sv && sv.viewBox && sv.viewBox.baseVal, w = vb ? vb.width : 0; if (!w) return; const q = $('v2qr'); Object.keys(QR_RANGE).forEach((k) => q.style.setProperty('--' + k, qrPx(w, QR_RANGE[k][0], QR_RANGE[k][1]) + 'px')); q.dataset.modules = w; }

  // ---------- 場面の切り替え ----------
  const TV = { mode: '', playing: null, done: {}, dismissed: {}, skipped: {}, armed: false, resultRace: null, resultFrom: 0, hl: null, waitPhase: 'pad', waitSince: 0, hlShownFor: null, nextAt: 0, log: [] };
  function setMode(m) {
    if (TV.mode === m) return;
    TV.mode = m; TV.log.push([Math.round(now()), m]); if (TV.log.length > 50) TV.log.shift();
    if (Sfx.scene) Sfx.scene(m === 'live'); // 音はレースの場面だけ（上の説明）
    ['m-wait', 'm-hl', 'm-open', 'm-live', 'm-result'].forEach((c) => stageEl.classList.toggle(c, c === 'm-' + m));
    if (m === 'wait' || m === 'open') setTimeout(() => { try { fitHow(); } catch (e) { } }, 700); // 参加方法の文字の大きさ（QR が動き終わってから測る）
  }
  // 時刻からいまの場面を決める（4 回/秒）。レースの再生（playRace）・ハイライトは自分で続きを進める
  function decide() {
    if (!S) return;
    const t = now();
    const races = Object.keys(cache).map((k) => cache[k]).filter((r) => r && r.closeAt && (!r.storeId || r.storeId === STORE));
    // 1) 走っているレース（締切〜結果発表）。ハイライト中なら止めて切り替える
    const live = (S.live && !TV.done[S.live.id]) ? S.live : races.find((r) => !TV.done[r.id] && r.closeAt <= t && r.revealAt && t < r.revealAt && r.status !== 'upcoming' && r.status !== 'open');
    if (TV.playing) return;
    if (live && t >= live.closeAt) { const sk = skipLive(live, t); if (sk === 'hold') return; if (!sk) { stopHighlight(); playRace(live); return; } } // hold: 参加人数が決まるまで今の画面のまま
    const open = S.open && t < S.open.closeAt ? S.open : null;
    // 2) 結果画面（終わったばかりのレース。途中から見始めたテレビは結果発表〜endAt の間なら最後の結果）
    let R = TV.resultRace;
    if (!R && S.last && S.last.result && S.last.revealAt <= t && t < S.last.endAt && !TV.dismissed[S.last.id] && !TV.skipped[S.last.id] && TV.resultShownFor !== S.last.id) { R = TV.resultRace = S.last; TV.resultFrom = performance.now(); }
    if (R) {
      const cur = cache[R.id] || R, urgent = open && t >= (open.openAt || 0); // 次のレースの受付が始まったら受付の画面を優先（結果画面で時刻表を止めない。2026-10-14 リーダーの決め）
      if (!TV.dismissed[R.id] && t < (cur.endAt || Infinity) && !urgent) { showResult(cur); return; }
      TV.resultShownFor = R.id; TV.resultRace = null; // 一度閉じた結果は出し直さない（レースごと。映像を見逃したレース＝結果が遅れて届いた等も結果画面は出す。QA3）
    }
    // 3) 受付（openAt から。それより前は待ち時間。サーバーは次のレースをずっと open にしている＝投票はできる）
    if (open && t >= (open.openAt || 0)) { stopHighlight(); showOpen(open); return; }
    // 4) 待ち時間: 次のレースのパドック と 前のレースのハイライト を交互に
    showWait(t);
  }
  /* 回し方（settings.mode）: レースの時刻は全店共通のまま、この店のテレビで流すかどうかだけ決める。
     bet＝この店の参加が 0 人なら流さず待ち時間（結果も出さない）、staff＝スタッフの「次へ」があるまで待ち時間（押されたら今のレースから流す。1 レースごと）。auto＝いつも流す */
  function skipLive(R, t) {
    const m = runMode(); let skip = false;
    // bet: 締切直後（closed＝結果を決めている途中）は参加人数がまだ 0 のことがある（Firestore 版は決まるまでレースの participants が空）→ 最大 15 秒は決めずに待つ
    //（以前は一瞬「待ち時間」に切り替わってから流れ始めた。コードレビュー 2026-10-14）
    if (m === 'bet' && R.status === 'closed' && !(R.participants && R.participants.total > 0) && (t || now()) < R.closeAt + 15000) return 'hold';
    if (m === 'bet') { const by = R.participants && R.participants.byStore; skip = !!by && !(by[STORE] > 0); }
    else if (m === 'staff') skip = !TV.armed;
    if (skip) TV.skipped[R.id] = true; else delete TV.skipped[R.id];
    return skip;
  }
  setInterval(() => { try { decide(); tickLabels(); } catch (e) { console.error(e); } }, 250);

  // ---------- 受付 ----------
  function showOpen(R) {
    if (TV.mode !== 'open' || !view || view.id !== R.id) { useRace(R, R.odds); }
    setMode('open');
    // 締切の 8 秒前からは発走地点へ（「まもなく発走」）。パドックを切った店はずっと発走地点、長さの設定があれば受付開始からその秒数だけ
    const t = now(), left = R.closeAt - t, ps = sceneSec('paddock');
    const fullGate = scene('gate') && (sceneSec('gate') || 99) >= giEnd() - 0.5; // ゲートインを切った・短くした店は締切のあともパドックのまま
    if (raceView.paddockSec > 1e8 && raceView.phase === 'idle' && ((left < 8000 && fullGate) || !scene('paddock') || (ps && t > (R.openAt || 0) + ps * 1000))) raceView.paddockSec = Math.max(0, raceView.t);
  }
  // ---------- 待ち時間 ----------
  function nextRaceOf() {
    if (S.open) return S.open;
    if (S.next) return S.next;
    const u = (S.upcoming || []).find((x) => !x.storeId || x.storeId === STORE);
    if (u) { const r = cache[u.id]; if (r && r.horses) return r; if (!TV.fetching) { TV.fetching = true; getRace(u.id).finally(() => { TV.fetching = false; }); } }
    return null;
  }
  const PAD_SEC = Number((QS.match(/[?&]hlwait=(\d+)/) || [])[1] || 30);   // 待ち時間のパドックを見せる秒数（そのあとハイライト。テスト用に ?hlwait=秒）
  function showWait(t) {
    const N = nextRaceOf(), P = S.last && S.last.result && S.last.winners && !S.last.refunded ? S.last : null; // 返還（不成立）のレースはハイライトしない
    if (TV.hl) return; // ハイライト中（終わったら自分で戻る）
    const soon = N && N.openAt && N.openAt - t < 45000; // 次の受付がもうすぐならパドックのまま
    if (TV.mode !== 'wait' && TV.mode !== 'hl') TV.waitSince = performance.now();
    if (P && is3D() && !soon && performance.now() - TV.waitSince > PAD_SEC * 1000) { playHighlight(P); return; }
    if (N && N.horses) { if (!view || view.id !== N.id || raceView.phase !== 'idle') useRace(N, N.odds, true); }
    else if (S.last && S.last.horses && (!view || raceView.phase !== 'idle')) useRace(S.last, S.last.result ? S.last.result.finalOdds : S.last.odds, true); // 今日のレースが終わった: 最後のレースのパドック
    setMode('wait');
  }
  // ---------- 前のレースのハイライト（ゴール前 9 秒から。リプレイ・勝ち馬のアップまで） ----------
  function stopHighlight() { const h = TV.hl; if (!h) return; TV.hl = null; h.abort(); }
  async function playHighlight(P) {
    const H = TV.hl = { id: P.id }; let abort; const abortP = new Promise((r) => (abort = r)); H.abort = abort;
    try {
      view = null; useRace(P, P.result.finalOdds); raceView.gateShot = true; // 枠の中から（ゲートインはしない）
      renderHlWinners(P); renderStrip(P, '前のレースのハイライト');
      setMode('hl');
      const tl = Race3D.timeline(P, Engine.replayRun(P, P.result.seed, { order: P.result.order }));
      const base = Math.max(0, tl.finishWall - 9), t0 = performance.now();
      const run = Engine.replayRun(P, P.result.seed, { order: P.result.order });
      raceView.gateShot = false;
      const res = await Promise.race([raceView.start({ run, clock: () => base + (performance.now() - t0) / 1000, onEvent: () => {}, onPhase: bcPhase, onTick: () => {} }), abortP]);
      if (TV.hl !== H) return;
      bcPhase('done');
      if (res) await Promise.race([sleep(5000), abortP]);
    } catch (e) { console.error(e); }
    if (TV.hl === H) { TV.hl = null; view = null; TV.waitSince = performance.now(); setMode('wait'); }
  }
  function renderHlWinners(P) {
    const w = P.result.winner, h = P.horses[w];
    $('v2hlTagSub').textContent = raceTitle(P);
    $('v2hlwSub').textContent = raceTitle(P) + 'のレース'; // 2026-10-19: 見出しは「全店の当たった人」（結果画面と同じ言葉・1 行に収まる）
    $('v2hlwWin').innerHTML = '<small>1着</small><i style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</i><span>' + esc(h.name) + '</span><em>単勝 ' + oxH(P.result.finalOdds[w]) + '</em>';
    fitText($('v2hlwWin').querySelector('span'), 26, 16);
    fillWinners($('v2hlwList'), P.winners || [], { max: 64, normal: 48, dense: 40 });
  }
  /* 当たった人の一覧。行の高さを人数に合わせて決める（2026-10-14 見た目の講評: 流していると 10 人目が見えない時間が長かった）
     o = { max: いちばん高い行, normal: ふつうの行, dense: 詰めた行 }。normal で入る → そのまま、dense までに詰めれば入る（12 人くらい）→ 詰めて全員、
     それより多い → normal の行で何人かずつのページにして 6 秒ごとにめくる（行は全員ぶん並べたまま＝どのテレビも中身は同じ。見せる位置だけ動かす） */
  const pagers = new Map(), pagerCtl = new Map(); // pagerCtl: 一覧ごとの { per: 1 ページの人数, goto(ページ), hold: 自動でめくらない }（結果画面で 1 人ずつ見せるとき、その人のページへ）
  function fillWinners(box, list, o) {
    const inner = box.querySelector('.inner'), pg = box.parentNode.querySelector('.pg');
    clearInterval(pagers.get(box)); pagers.delete(box); pagerCtl.delete(box); box.classList.remove('scroll', 'dense', 'paged', 'big'); inner.style.transform = ''; if (pg) pg.textContent = '';
    if (!list.length) { inner.innerHTML = '<div class="none">当たった人は<br>いませんでした</div>'; return; }
    const row = (w) => '<div class="row"><span class="st' + (w.storeId === STORE ? ' me' : '') + '">' + esc(w.storeName || storeName(w.storeId)) + '</span><span class="nk">' + esc(w.nick) + '</span><b>' + ptH(w.amount) + '</b></div>'; // 当選額（2026-10-20 から「pt」つき）
    inner.innerHTML = list.map(row).join('');
    const n = list.length, avail = box.clientHeight || 500;
    let rh = Math.min(o.max, Math.floor(avail / n));
    if (rh >= o.dense) { box.style.setProperty('--rh', rh + 'px'); box.classList.toggle('dense', rh < o.normal); box.classList.toggle('big', rh >= o.max - 4); /* 2026-10-19: 当たった人が少ないときは行も文字も大きく（遠くから読める） */ pagerCtl.set(box, { per: n, pages: 1, hold: false, goto() {} }); return; }
    const per = Math.max(1, Math.floor(avail / o.normal)), pages = Math.ceil(n / per); rh = Math.floor(avail / per);
    box.style.setProperty('--rh', rh + 'px'); box.classList.add('paged');
    const ctl = { per, pages, p: 0, hold: false, goto(q) { q = ((q % pages) + pages) % pages; if (q !== ctl.p) { ctl.p = q; show(); } } };
    const show = () => { inner.style.transform = 'translateY(' + (-ctl.p * per * rh) + 'px)'; if (pg) pg.textContent = (ctl.p + 1) + ' / ' + pages; };
    show(); pagerCtl.set(box, ctl); pagers.set(box, setInterval(() => { if (!box.isConnected || ctl.hold) return; ctl.p = (ctl.p + 1) % pages; show(); }, 6000));
  }

  // ---------- レース（締切 → ゲートイン → レース → ゴール → リプレイ → 勝ち馬 → 掲示板 → 結果） ----------
  async function until(cond, every) { while (!cond()) await sleep(every || 100); }
  async function playRace(R0) {
    const id = R0.id; if (TV.playing) return; TV.playing = id;
    let R = cache[id] || R0;
    try {
      const t = now();
      useRace(R, R.result ? R.result.finalOdds : R.odds);
      setMode('live'); stageEl.classList.remove('bc-final', 'bc-clean');
      renderStrip(R); renderOddsCol(R, R.result ? R.result.finalOdds : R.odds, false); oddsState('');
      // ゲートイン: 全店共通の時刻（runAt にゲートが開く）のまま、この店で見せる長さだけ変える。切った店・短くした店は、それまでパドック（または発走地点）を見せる
      const gate = scene('gate') && (R.runAt - R.at) > 1000 && raceView.gateIn;
      const gateStart = R.runAt - giEnd() * 1000, gSec = Math.min(giEnd(), sceneSec('gate') || giEnd()), showFrom = R.runAt - gSec * 1000;
      if (raceView.phase === 'idle' && raceView.paddockSec > 1e8 && (gate && gSec >= giEnd() - 0.5 || !scene('paddock'))) raceView.paddockSec = Math.max(0, raceView.t); // パドックから発走地点へ
      if (t < R.closeAt + 2500) { const c = $('v2closed'); c.classList.remove('show'); void c.offsetWidth; c.classList.add('show'); Sfx.play('bell'); }
      if (t < R.runAt - 3000) Sfx.play('fanfare');
      // 結果（seed）を待つ（ふつうは締切の直後に決まる）
      // 結果が来ないまま返還された・決定が止まった（結果なしで発表）レースで、ここを回り続けて次のレースに進めなかった → 発表＋30 秒で諦める（コードレビュー 2026-10-14）
      const giveUp = () => { const c = cache[id] || R0; return !!c && ((c.status === 'done' || c.refunded) && !c.result || now() > (c.revealAt || c.runAt + 120000) + 30000); };
      const needResult = async () => { while (!(cache[id] && cache[id].result && cache[id].result.seed != null)) { await getRace(id); if (cache[id] && cache[id].result) break; if (giveUp()) throw new Error('casa DERBY v2: 結果が届かない ' + id); await sleep(700); } return cache[id]; };
      const resP = needResult();
      const prepP = resP.then((r) => { applyCues(r); /* 確定演出（ふつうは keepRace で渡し済み。ここは念のため） */ const rs = r.result, run = Engine.replayRun(r, rs.seed, { order: rs.order }); const tl = is3D() ? Race3D.timeline(r, Engine.replayRun(r, rs.seed, { order: rs.order })) : null; return { run, tl }; });
      resP.catch(() => {}); prepP.catch(() => {}); // 諦めたときの失敗は下の await で受ける（ここでは「受け手なし」の警告を出さない）
      // ゲートイン（ゲートが開く時刻 runAt にちょうど終わるように始める。遅れて見始めたらその分進んだところから）
      if (gate && now() < R.runAt - 500) {
        await until(() => now() >= Math.max(R.closeAt, showFrom) - 50);
        if (now() < R.runAt - 500) {
          await raceView.gateIn({ onEvent: () => {}, clock: () => (now() - gateStart) / 1000 });
        }
      } else { await until(() => now() >= R.runAt - 1200); raceView.gateShot = true; } // ゲートインなし: 発走の直前まで今の絵のまま → 枠の中
      R = await resP;
      const res = R.result;
      viewOdds = res.finalOdds; renderHorses(); renderOddsCol(R, res.finalOdds, false);
      const { run, tl } = await prepP;
      await until(() => now() >= R.runAt - 30, 30);
      if (tl) {
        TV.timeline = tl;
        if (now() > (cache[id].revealAt || R.runAt + tl.totalSec * 1000) - 3000) { // 結果発表の直前・あとに見始めた → 結果へ（ゴール後〜発表の間なら、追いついてリプレイ・勝ち馬から見せる）
          finishRace(R); return;
        }
      } else { // 2D（WebGL なし）: ゴール近くまで遅れて見始めたら結果へ。ただし発表（revealAt）までは今の絵のまま
        // （以前はすぐ結果画面になり、サーバーの再起動などで結果が遅れて届いた店のテレビだけ、発表の 20〜35 秒前に勝ち馬・払戻金を出していた。負荷テスト 2026-10-14）
        const el0 = (now() - R.runAt) / 1000;
        if (el0 > 50) { await until(() => now() >= ((cache[id] && cache[id].revealAt) || R.revealAt || 0) - 900); finishRace(R); return; }
        if (el0 > 0.5) run.seek(el0);
      }
      const late = (now() - R.runAt) / 1000;
      if (late < 1.5) Sfx.play('gate');
      raceView.gateShot = false;
      if (window.Commentary && late < 20) Commentary.begin(raceView, R, { tansho: res.finalOdds }); // 実況（途中から見始めたときは 20 秒まで）
      let hoof = 0, saidGoal = false;
      const rsec = sceneSec('replay');
      // 結果発表（revealAt。スマホに結果が出る時刻）にちょうど着順掲示板が出るよう、勝ち馬のアップをそれまで続ける
      const revealMs = () => (cache[id] && cache[id].revealAt) || R.revealAt || 0;
      const out = await raceView.start({
        hold: () => (revealMs() - 900 - now()) / 1000,
        replay: scene('replay') ? (rsec && rsec < 8 ? 'short' : true) : false, winner: scene('winner'),
        run, clock: is3D() ? () => (now() - R.runAt) / 1000 : null,
        onEvent: (text) => announce(text),
        onPhase: bcPhase,
        onTick: (st) => {
          renderRank(st);
          // 右の確定オッズ: 発走から 5 秒はそのまま → 道中は小さく → ゴール前（.bc-final）は薄く → 1 着が決まったら戻す（REVIEW_TODO 3）
          if (!$('v2odds').classList.contains('won')) oddsState(stageEl.classList.contains('bc-final') ? 'fade' : st.t > 5 ? 'cmp' : '');
          if (!stageEl.classList.contains('bc-final') && raceView.glcv && (Math.max.apply(null, st.pos) > 1 - 70 / R.dist || st.finish.some((f) => f > 0))) { stageEl.classList.add('bc-final'); $('rankPanel').classList.remove('show'); }
          if (st.t - hoof > 0.18 && !st.finish[st.leader]) { hoof = st.t; Sfx.play('hoof'); }
          if (!saidGoal && st.finish.some((x) => x > 0)) {
            saidGoal = true; let w = -1; st.finish.forEach((f, i) => { if (f > 0 && (w < 0 || f < st.finish[w])) w = i; });
            announce('ゴール！　1着は ' + (w + 1) + '番 ' + R.horses[w].name + '！'); Sfx.play('goal');
            markWinnerOdds(w);
          }
        },
      });
      await until(() => now() >= revealMs() - 900); // 勝ち馬のアップを切った店など: 発表まで今の絵のまま
      bcPhase('done');
      if (out && out.order && out.order[0] !== res.winner) console.warn('casa DERBY v2: 映像の 1 着がサーバーと違う', out.order[0], res.winner);
      announce('勝ったのは ' + (res.winner + 1) + '番 ' + R.horses[res.winner].name);
      if (window.Commentary) Commentary.finish({ order: res.order, finish: res.finishTimes || run.finishTimes || out.finish });
      await sleep(900);
      await showBoard(R, out && out.finish ? out.finish : run.finishTimes);
      finishRace(R);
    } catch (e) { console.error(e); TV.done[id] = true; TV.playing = null; }
  }
  function finishRace(R) {
    TV.done[R.id] = true; TV.playing = null; TV.armed = false;
    stageEl.classList.remove('bc-final', 'bc-clean');
    TV.resultRace = R; TV.resultFrom = performance.now();
    decide();
  }
  // 右の確定オッズの列
  function renderOddsCol(R, odds, final) {
    $('v2oddsList').innerHTML = R.horses.map((h, i) => '<li data-i="' + i + '"><i style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</i><b>' + (odds && odds[i] ? oxH(odds[i]) : '—') + '</b></li>').join('');
    $('v2odds').querySelector('h5 small').textContent = R.result ? '確定' : '単勝';
  }
  function markWinnerOdds(w) { $('v2oddsList').querySelectorAll('li').forEach((li) => li.classList.toggle('win', +li.dataset.i === w)); oddsState('won'); }
  function oddsState(s) { const o = $('v2odds'); ['cmp', 'fade', 'won'].forEach((c) => o.classList.toggle(c, c === s)); }
  function renderStrip(R, head) {
    // 2026-10-19: 短く（距離・馬場は映像の左下に出ている）
    $('v2stripTtl').innerHTML = head ? '<small class="pre">前のレース</small>' + esc(raceTitle(R)) : esc(raceTitle(R)); // 2026-10-19: 補足を減らす。ハイライトは「前のレース」と分かるように上に小さく
    $('v2stripPpl').textContent = ppl(R);
    const by = (R.participants && R.participants.byStore) || {};
    $('v2stripStores').innerHTML = ((S && S.stores) || []).map((s) => '<span class="' + (s.id === STORE ? 'me' : '') + '">' + esc(s.name) + '<b>' + (by[s.id] || 0) + '</b></span>').join('');
  }

  // ---------- テロップ・中継のグラフィックス（game.js と同じ） ----------
  let announceId = 0;
  function announce(text) {
    if (window.Commentary && Commentary.active) Commentary.caption(text); else if (window.Voice && !MUTE) Voice.say(text, { urgent: /ゴール|残り 200m|写真判定|大接戦/.test(text) });
    // 実況テロップ（REVIEW_TODO 5）: 1 文 3 秒。ゴール前（.bc-final）は「ゴール」以外は出さない。残り 200m などの節目は黄色で 1.4 秒
    const goal = /ゴール！|勝ったのは/.test(text), mark = /残り\s*\d+\s*m|残り\s*\d+メートル/.test(text);
    if (stageEl.classList.contains('bc-final') && !goal) return;
    const a = $('announce'); a.style.fontSize = ''; a.textContent = text; a.classList.toggle('mark', mark); a.classList.add('show');
    const max = 493, w = a.scrollWidth; if (w > max) a.style.fontSize = Math.max(14, 20 * (max - 40) / (w - 40)).toFixed(1) + 'px';
    clearTimeout(announceId); announceId = setTimeout(() => a.classList.remove('show'), mark ? 1400 : 3000);
  }
  let rankKey = '', rankCand = '', rankSince = 0;
  function renderRank(st) {
    const el2 = $('rankPanel'); if (!el2 || !view || !raceView.glcv) return;
    if (!(st.t > 11)) return;
    const n = st.pos.length, idx = []; for (let i = 0; i < n; i++) idx.push(i);
    idx.sort((a, b) => { const fa = st.finish[a] > 0, fb = st.finish[b] > 0; if (fa && fb) return st.finish[a] - st.finish[b]; if (fa !== fb) return fa ? -1 : 1; return st.pos[b] - st.pos[a]; });
    const top3 = idx.slice(0, 3), key = top3.join(',');
    if (key !== rankCand) { rankCand = key; rankSince = st.t; }
    const can = () => !stageEl.classList.contains('bc-clean') && !stageEl.classList.contains('bc-final') && !$('tagPhoto').classList.contains('show');
    if (key === rankKey || (rankKey && st.t - rankSince < 0.3 && !st.finish.some((f) => f > 0))) { if (!el2.classList.contains('show') && can()) el2.classList.add('show'); return; }
    const prev = rankKey ? rankKey.split(',').map(Number) : [];
    rankKey = key;
    if (el2.children.length !== 3) el2.innerHTML = [1, 2, 3].map((k) => '<div class="rr"><b>' + k + '<small>位</small></b><i></i></div>').join('');
    top3.forEach((i, k) => {
      const row = el2.children[k], h = view.horses[i], c = row.querySelector('i');
      if (prev[k] === i) return;
      c.textContent = h.no; c.style.background = h.color; c.style.color = h.ink;
      if (prev.length) { c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
    });
    if (can()) el2.classList.add('show');
  }
  function bcPhase(ph, info) {
    const show = (id, on) => { const e = $(id); if (e) e.classList.toggle('show', !!on); };
    info = info || {};
    if (ph === 'photo') { show('rankPanel', false); show('tagPhoto', true); return; }
    if (ph === 'winback') { stageEl.classList.add('bc-clean'); ['rankPanel', 'tagReplay', 'tagPhoto', 'winCard'].forEach((id) => show(id, false)); return; }
    if (ph === 'replay') { stageEl.classList.add('bc-clean'); show('rankPanel', false); show('tagReplay', true); show('tagPhoto', !!info.photo); show('winCard', false); return; }
    if (ph === 'winner') {
      stageEl.classList.add('bc-clean'); show('rankPanel', false); show('tagReplay', false); show('tagPhoto', false);
      const w = info.winner, h = view && view.horses[w];
      if (h) {
        $('wcNo').textContent = h.no; $('wcNo').style.background = h.color; $('wcNo').style.color = h.ink; $('wcName').textContent = h.name;
        $('wcOdds').textContent = viewOdds && viewOdds[w] ? '単勝 ' + ox(viewOdds[w]) + '倍' : '';
        show('winCard', true); markWinnerOdds(w);
        const nm = $('wcName'); nm.classList.remove('pop'); setTimeout(() => nm.classList.add('pop'), 500); Sfx.play('cheer', false);
      }
      return;
    }
    stageEl.classList.remove('bc-clean', 'bc-final');
    ['rankPanel', 'tagReplay', 'tagPhoto', 'winCard', 'gainBadge'].forEach((id) => show(id, false));
    if (ph === 'reset') { rankKey = ''; rankCand = ''; const e = $('rankPanel'); if (e) e.innerHTML = ''; }
  }

  // ---------- 着順掲示板（game.js と同じ見た目。払戻金は単勝だけ） ----------
  function margin(dt) {
    const L = dt / 0.14; if (L > 10) return '大差';
    if (L < 0.15) return 'ハナ'; if (L < 0.3) return 'アタマ'; if (L < 0.45) return 'クビ'; if (L < 0.625) return '1/2'; if (L < 0.875) return '3/4';
    const q = Math.round(L * 4) / 4, whole = Math.floor(q), fr = q - whole;
    if (whole >= 3) return String(Math.round(L));
    return (whole ? whole : '') + (fr === 0.25 ? (whole ? ' ' : '') + '1/4' : fr === 0.5 ? (whole ? ' ' : '') + '1/2' : fr === 0.75 ? (whole ? ' ' : '') + '3/4' : '') || '1';
  }
  const fmtTime = (t0) => { const t = Math.round(t0 * 10) / 10; return Math.floor(t / 60) + ':' + ((t % 60) < 10 ? '0' : '') + (t % 60).toFixed(1); };
  async function showBoard(R, fin) {
    TV.boardAt = Math.round(now()); TV.boardRace = R.id; // 確認用: 着順掲示板を出した時刻（結果発表 revealAt とそろっているか）
    const res = R.result, ord = res.order, f = fin || res.finishTimes, top5 = ord.slice(0, 5);
    $('bdRace').textContent = raceTitle(R);
    $('bdCond').textContent = (R.surface === 'turf' ? '芝 ' : 'ダート ') + R.dist + 'm　' + { sunny: '晴', cloudy: '曇', rain: '雨' }[R.weather] + '　' + (R.weather === 'rain' ? '重' : R.weather === 'cloudy' ? '稍重' : '良');
    $('bdRows').innerHTML = top5.map((i, k) => '<div class="bd-row"><span class="rk">' + (k + 1) + '</span><span class="fc" style="background:' + R.horses[i].color + '"></span><span class="num">' + (i + 1) + '</span><span class="nm">' + esc(R.horses[i].name) + '</span><span class="mg">' + (k ? margin(f[i] - f[top5[k - 1]]) : '') + '</span></div>').join('');
    $('bdTime').textContent = fmtTime(f[ord[0]]);
    $('bdLast').textContent = (raceView.last3f || 0).toFixed(1);
    const lamp = $('bdLamp'); lamp.className = 'lamp'; lamp.textContent = '確定';
    $('bdPay').className = 'bd-pay'; $('board').hidden = false;
    const rows = $('bdRows').children;
    for (let k = 0; k < rows.length; k++) { rows[k].classList.add('on'); Sfx.play('tick'); await sleep(220); }
    if (f[ord[1]] - f[ord[0]] < 0.05) { lamp.textContent = '審議'; lamp.className = 'lamp shingi'; await sleep(1800); lamp.textContent = '確定'; } else await sleep(700);
    lamp.className = 'lamp kakutei'; Sfx.play('bell'); await sleep(700);
    const w = ord[0];
    // 払戻は額（1 枚 = 100。単位なし）。投票は枚のまま
    $('bdPay').innerHTML = '<div><span><small>単勝</small>' + (w + 1) + '番</span><b>' + ox(res.finalOdds[w]) + '<small>倍</small></b></div>';
    $('bdPay').className = 'bd-pay on'; Sfx.play('chest');
    await sleep(2400);
    $('board').hidden = true;
  }

  // ---------- 結果画面 ----------
  let resKey = '';
  function showResult(R) {
    const res = R.result; if (!res) { TV.resultRace = null; return; }
    const first = TV.mode !== 'result';
    setMode('result'); // 先に場面を変える（2026-10-19「レース中以外は音を出さない」: 結果発表の画面の音は鳴らさない＝出口が閉じてから呼ぶ）
    if (first) { resKey = ''; Sfx.play(R.winners && R.winners.length ? 'win' : 'chest'); }
    if (!TV.resBase || TV.resBase.id !== R.id) TV.resBase = { id: R.id, t: R.revealAt ? R.revealAt + RES_LEAD : now() }; // 5 分の流れの 0:00（発表の時刻から。どのテレビも同じ場面になる）
    const key = R.id + '|' + (R.winners ? R.winners.length : 'x') + '|' + ((S && S.stores) || []).length + '|' + !!R.refunded;
    if (key !== resKey) {
      resKey = key;
      $('v2resTtl').innerHTML = esc(raceTitle(R)) + '<small>' + (R.surface === 'dirt' ? 'ダート' : '芝') + R.dist + 'm</small>'; // 「結果」は左の札（結果画面は画面全体を覆うので、上の札と同じものをここにも置く）
      const f = res.finishTimes || [], ord = res.order;
      // 着差は単位つき（「2 馬身」「1 3/4 馬身」。ハナ・アタマ・クビ・大差はそのまま）。1 着はタイム
      const mgU = (s) => (/^[0-9]/.test(s) ? esc(s) + '<small>馬身</small>' : esc(s));
      $('v2resOrd').innerHTML = ord.map((i, k) => { const h = R.horses[i]; return '<div class="o"><span class="rk">' + (k + 1) + '<small>着</small></span><i style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</i><span class="nm">' + esc(h.name) + '</span><span class="mg">' + (k === 0 ? (f[i] ? '<small>タイム</small>' + fmtTime(f[i]) : '') : f[i] && f[ord[k - 1]] ? mgU(margin(f[i] - f[ord[k - 1]])) : '') + '</span><span class="od">' + (res.finalOdds[i] ? oxH(res.finalOdds[i]) : '') + '</span></div>'; }).join('');
      $('v2resOrd').querySelectorAll('.nm').forEach((e, k) => fitText(e, k ? 30 : 42, 20));
      const w = res.winner, h = R.horses[w], o = res.finalOdds[w];
      // 払戻: 単勝の倍率（2026-10-19。以前は 100あたりの額）と「例 1,000 → 4,000」（当選額。出てから 0.6 秒だけ 1.08 倍に弾む）
      $('v2resPay').innerHTML = '<span class="k">配当<small>単勝</small></span><i style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</i><span class="hn">' + esc(h.name) + '</span><span class="x"><small>例</small><span class="n">1,000<small class="pt">pt</small></span> → <b>' + ptH(roundPay(10 * Math.round(o * 10) * 10)) + '</b></span><b class="o"><small>単勝</small>' + ox(o) + '<small class="bai">倍</small></b>';
      fitText($('v2resPay').querySelector('.hn'), 32, 18);
      const list = R.winners || [];
      $('v2resCnt').innerHTML = R.refunded ? '' : R.winners ? '全店で<b>' + list.length + '</b>人' : '集計中…';
      $('v2res').classList.toggle('has-w', !R.refunded && list.length > 0); // 当たった人がいるときだけ「当たった方は スマホの QR をスタッフへ」（一覧の高さが変わるので先に）
      fillResWinners(R);
    }
    // 下の帯: 次のレース（発走時刻と発走までの時間）と、この結果の画面があと何分出ているか（どちらの時間か分かるように名前をつける。2026-10-14 見た目の講評）
    const t = resClock(), endAt = R.endAt || (TV.resBase.t + 300000), N = S && (S.open || S.next);
    const until = Math.min(endAt, S && S.open && S.open.openAt > t ? S.open.openAt : Infinity); // 次のレースの受付の画面が始まったら結果の画面は閉じる（decide と同じ）
    const total = Math.max(1, until - (R.revealAt || until - 300000)), left = Math.max(0, until - t);
    $('v2resNx').innerHTML = N ? '<small>次のレース</small><b>' + hhmm(N.at) + '</b> 発走' + (S.open ? '<em>受付中</em>' : '') : '<small>本日のレースは</small>終了しました';
    $('v2resNxL').textContent = N ? '発走まで' : ''; $('v2resNxN').textContent = N ? fmtLeft(N.at - t) : '';
    $('v2resRestL').textContent = 'この画面 あと'; $('v2resRestN').textContent = fmtLeft(left); $('v2resBar').style.width = (100 * left / total).toFixed(1) + '%';
    resStage(R, resPhase(R, t, until, endAt), N, t, until);
  }
  function fillResWinners(R) {
    const L = $('v2resList');
    if (R.refunded) { L.classList.remove('scroll', 'paged', 'dense'); pagerCtl.delete(L); clearInterval(pagers.get(L)); L.querySelector('.inner').style.transform = ''; L.querySelector('.inner').innerHTML = '<div class="none">このレースは不成立のため<br>返還します<br><small>リングバウンティをお返しします。スマホの QR をスタッフへ</small></div>'; } // 管理画面の「返還」: 払い戻しの当たりは取り消し
    else if (R.winners) fillWinners(L, R.winners, { max: 84, normal: 54, dense: 44 }); else L.querySelector('.inner').innerHTML = '<div class="none">集計中…</div>';
    RT.hi = -2; // 行を作り直した → 1 人ずつの印を付け直す
  }

  /* 結果画面の 5 分の流れ（REVIEW_TODO「92→95」の 4。長さ 5 分は店の方針で固定）。配置は変えない（左に着順・右に当たった人・下に払戻・右下に QR）。
     時間で見せ場だけ移す（場面が変わるのは 10〜30 秒に 1 回。当たった人の印だけ 5〜7 秒ごと）:
       0:00〜0:20 top  1 着と払戻を強調（出た瞬間に倍率が 1.0→1.08→1.0 を 0.6 秒）
       0:20〜1:30 win  全店の当たった人を 1 人ずつ（1 人 5〜7 秒・0.3 秒で移る。多ければその人のページへ）。当たりなしなら振り返りを早めに
       1:30〜2:30 look 振り返り（右下の小さな枠: 1〜3 着・着差・タイム・写真判定）
       2:30〜残り 1 分 next 次のレース（発走時刻・受付中・QR を強調）
       最後の 1 分 cd  カウントダウン（残り 60 秒からは数字を強く）
     下の帯（次のレース）は 30 秒に 1 回 0.4 秒だけ光る。時刻はサーバーの時計で、発表（revealAt）から数える。結果画面が 5 分より短い店は同じ割合で縮める */
  const RES_LEAD = 5000; // 発表（着順掲示板）から結果画面が出るまでのおよその秒数
  const RT = { id: null, ph: '', hi: -1, glowN: -1, sub: '' };
  const resClock = () => now() + (TV.resSkew || 0); // TV.resSkew: 確認用に時間を進める（DERBY.resultAt）
  function resPhase(R, t, until, endAt) {
    const base = TV.resBase.t, el = Math.max(0, (t - base) / 1000);
    const plan = Math.max(30, (endAt - (R.revealAt || base)) / 1000), k = Math.min(1, plan / 300);
    const b0 = 20 * k, b1 = 90 * k, b2 = 150 * k, cd = (until - base) / 1000 - 60 * k;
    const wins = !R.refunded && R.winners ? R.winners.length : 0;
    let ph = el < b0 ? 'top' : el < b1 ? (wins ? 'win' : 'look') : el < b2 ? 'look' : 'next';
    if (el >= b0 && el >= cd) ph = 'cd';
    let hi = -1;
    if (ph === 'win') { const per = Math.min(7, Math.max(5, (b1 - b0) / wins)); hi = Math.floor((el - b0) / per) % wins; }
    return { el, ph, hi, left: until - t };
  }
  function resStage(R, tl, N, t, until) {
    const box = $('v2res'), ph = tl.ph, subOn = ph === 'look' || ph === 'next' || ph === 'cd';
    if (RT.id !== R.id) { RT.id = R.id; RT.ph = ''; RT.hi = -1; RT.glowN = Math.floor(tl.el / 30); RT.sub = ''; }
    if (ph !== RT.ph) {
      const wasSub = box.classList.contains('sub-on');
      ['top', 'win', 'look', 'next', 'cd'].forEach((p) => box.classList.toggle('ph-' + p, p === ph));
      box.classList.toggle('sub-on', subOn); stageEl.dataset.resph = ph;
      RT.ph = ph;
      if (wasSub !== subOn) fillResWinners(R); // 一覧の高さが変わる → 行の高さ・ページを決め直す
    }
    // 当たった人を 1 人ずつ（行の印。ページに分かれているときは、その人のページを出して自動でめくらない）
    if (tl.hi !== RT.hi) {
      RT.hi = tl.hi;
      const L = $('v2resList'), ctl = pagerCtl.get(L);
      L.querySelectorAll('.row').forEach((r, i) => r.classList.toggle('hi', i === tl.hi));
      if (ctl) { ctl.hold = tl.hi >= 0; if (tl.hi >= 0) ctl.goto(Math.floor(tl.hi / ctl.per)); }
    }
    // 右下の小さな枠（振り返り・次のレース・カウントダウン）。形が変わるときだけ作り直し（0.3 秒で出る）、数字は 4 回/秒
    const sub = $('v2resSub'), sk = subOn ? ph + '|' + (N ? N.id + '|' + !!S.open : '-') + '|' + R.id : '';
    if (sk !== RT.sub) {
      RT.sub = sk;
      if (subOn) { sub.innerHTML = ph === 'look' ? lookHtml(R) : ph === 'next' ? nextHtml(N) : cdHtml(N, until); if (ph === 'look') { drawLookFaces(R); sub.querySelectorAll('.lb b').forEach((b) => fitText(b, 24, 15)); } sub.classList.remove('swap'); void sub.offsetWidth; sub.classList.add('swap'); }
    }
    if (subOn && ph !== 'look') {
      const n = $('v2subN'); if (n) n.textContent = ph === 'cd' ? fmtLeft(tl.left) : N ? fmtLeft(N.at - t) : '';
      const ul = $('v2subUl'); if (ul) ul.textContent = cdLabel(N, until);
    }
    box.classList.toggle('cd-hot', ph === 'cd' && tl.left <= 60000);
    // 下の帯が 30 秒に 1 回 0.4 秒だけ光る（次のレースへ目を戻す）
    const g = Math.floor(tl.el / 30);
    if (g !== RT.glowN) { RT.glowN = g; if (g > 0) { const f = $('v2resFoot'); f.classList.remove('glow'); void f.offsetWidth; f.classList.add('glow'); clearTimeout(RT.glowT); RT.glowT = setTimeout(() => f.classList.remove('glow'), 450); } }
  }
  const mgText = (s) => (/^[0-9]/.test(s) ? s + ' 馬身' : s);
  function lookHtml(R) {
    const res = R.result, ord = res.order, f = res.finishTimes || [], top3 = ord.slice(0, 3);
    const gap = f[ord[0]] && f[ord[1]] ? f[ord[1]] - f[ord[0]] : null, g12 = gap != null ? mgText(margin(gap)) : '';
    const cell = (i, k) => { const h = R.horses[i]; return '<div class="lb' + (k ? '' : ' w') + '"><canvas class="fc" width="96" height="96" data-i="' + i + '"></canvas><div class="lt"><span class="rk">' + (k + 1) + '<small>着</small></span><i style="background:' + h.color + ';color:' + h.ink + '">' + h.no + '</i></div><b>' + esc(h.name) + '</b><em>' + (k === 0 ? (f[i] ? 'タイム ' + fmtTime(f[i]) : '') : f[i] && f[ord[k - 1]] ? mgText(margin(f[i] - f[ord[k - 1]])) + '差' : '') + '</em></div>'; };
    const photo = R.photo || (gap != null && gap <= 0.05);
    return '<h4>レースの振り返り<small>' + esc(raceTitle(R)) + '　' + (R.surface === 'dirt' ? 'ダート' : '芝') + R.dist + 'm</small></h4><div class="lbs">' + top3.map(cell).join('') + '</div>' +
      '<div class="lf">' + (photo ? '<span class="ph">写真判定</span><span>' + esc(g12 || 'ハナ') + ' 差の大接戦を制しました</span>' : '<span class="ph n">着差</span><span>2着に ' + esc(g12) + ' の差をつけて 1着</span>') + '</div>';
  }
  function drawLookFaces(R) {
    $('v2resSub').querySelectorAll('canvas.fc').forEach((cv) => {
      const i = +cv.dataset.i, h = R.horses[i], c = cv.getContext('2d'); if (!c || !h) return;
      const pic = view && view.id === R.id ? horsePic(i, 'face') : null; // 映像に入っているレースなら 3D の顔、そうでなければ 2D の顔
      try { if (pic) c.drawImage(pic, 0, 0, cv.width, cv.height); else if (window.Horse) { c.save(); c.scale(1.5, 1.5); Horse.face(c, 30, 32, 44, h); c.restore(); } } catch (e) { }
    });
  }
  function nextHtml(N) {
    if (!N) return '<h4>本日のレースは終了しました</h4><p class="thx">ご参加ありがとうございました。<br>またのお越しをお待ちしています。</p>';
    const p = ppl(N);
    return '<h4>次のレース' + (S.open ? '<em>受付中</em>' : '') + (N.no ? '<small>第' + N.no + 'レース</small>' : '') + '</h4>' +
      '<div class="nr"><div class="at"><b>' + hhmm(N.at) + '</b><span>発走</span></div><div class="cdn"><small>発走まで</small><b id="v2subN"></b></div></div>' +
      '<p class="go">' + (S.open ? (xShut(S.open, now()) ? '参加受付は締切・投票中' : 'いまからスマホで参加できます') : hhmm(N.openAt || N.at) + ' から受付') + (p ? '・全店で <b>' + p + '</b> 人が参加中' : '') + '<span class="arr">右下の QR へ</span></p>';
  }
  function cdLabel(N, until) { return !N ? 'この画面 あと' : S.open && S.open.openAt <= until + 500 ? '次のレースの受付画面まで' : '次のレースの案内まで'; }
  function cdHtml(N, until) {
    return '<h4>' + (N ? 'まもなく次のレース' : '本日のレースは終了しました') + '</h4><div class="cdw"><small id="v2subUl">' + esc(cdLabel(N, until)) + '</small><b id="v2subN"></b></div>' +
      '<p class="go">' + (N ? hhmm(N.at) + ' 発走' + (S.open ? '・<em>受付中</em>' : '') + '<span class="arr">右下の QR から投票</span>' : 'ご参加ありがとうございました') + '</p>';
  }

  // ---------- 受付の 2 段（参加受付 → 投票）の見せ方 ----------
  const xAt = (r) => (r ? (r.exchangeCloseAt != null ? r.exchangeCloseAt : r.closeAt) : 0);
  // 交換の割合（リングバウンティ ○枚 ＝ 100。v2/core.js の bountyRate と同じ: 整数 1〜1000、なければ 20）
  const rateNow = () => { const r = Number(ST().bountyPerTicket); return Number.isInteger(r) && r >= 1 && r <= 1000 ? r : 20; };
  const xShut = (r, t) => !!r && t >= xAt(r) && t < r.closeAt; // 参加受付は締め切った・投票はまだ
  let howOrig = null, xShown = null;
  /* 参加方法の 3 行（2026-10-20）: いちばん長い行が枠に入る大きさに 3 行そろえる（48px から 30px まで。折り返さない・QR の下にもぐらない） */
  function fitHow() {
    const L = Array.from(document.querySelectorAll('#v2how ol li')); if (!L.length || !L[0].clientWidth) return;
    // 枠の右側は QR の札が重なっている（QR が出ている間）→ 使える幅は QR の左端まで。画面は拡縮されているので、測った幅を 1600 の座標に直す
    const k = (stageEl.getBoundingClientRect().width / 1600) || 1, q = $('v2qr'), qr = q && getComputedStyle(q).opacity !== '0' ? q.getBoundingClientRect() : null;
    const room = (li) => { const r = li.getBoundingClientRect(); return Math.min(li.clientWidth, qr && qr.left > r.left ? (qr.left - r.left) / k - 20 : 1e9); };
    const over = (li) => { const r = document.createRange(); r.selectNodeContents(li); const w = (r.getBoundingClientRect().right - li.getBoundingClientRect().left) / k; return w > room(li) + 1; };
    let f = 48; L.forEach((li) => { li.style.fontSize = ''; });
    L.forEach((li) => { li.style.fontSize = f + 'px'; while (f > 30 && (li.scrollWidth > li.clientWidth + 1 || over(li))) { f -= 1; li.style.fontSize = f + 'px'; } });
    L.forEach((li) => { li.style.fontSize = f + 'px'; });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHow).catch(() => {});
  setTimeout(fitHow, 1500);
  function stageTexts(closed) { // 参加受付の締切のあと: QR の説明と遊び方を「投票はスマホで」に（QR は大きいまま）
    if (xShown === closed) return; xShown = closed;
    const how = $('v2how'), qt = $('v2qrTx'); if (!how || !qt) return;
    if (howOrig == null) howOrig = how.innerHTML;
    const T3 = closed ? ['次のレースの案内', '参加受付は<br>締め切りました', '次のレースをお待ちください'] /* 2026-10-19: QR は次のレースの案内（新しく読んだ人のスマホには次のレースの時刻が出る） */ : ['アプリ不要 スマホで参加', 'スマホのカメラで<br>読み取ってください', 'アプリは不要です'];
    ['b', 'span', 'em'].forEach((k, i) => { const e = qt.querySelector(k); if (e) e.innerHTML = T3[i]; }); // #v2qrUrl（確認用の URL）はそのまま
    // 2026-10-19: 見出しは「投票受付中」（上の札と同じ）。短い 3 行だけ（小さな補足は出さない）
    how.innerHTML = closed ? '<h4>参加済みの方は<br>スマホで投票</h4><ul><li>参加受付は締め切りました</li></ul>' : howOrig;
    $('v2qr').classList.toggle('xshut', closed); how.classList.toggle('xshut', closed);
    /* 2026-10-20 オーナー「（投票の時間の）次のレースの案内はいらない」「ここを大きく表示して」: 投票の段だけ QR を出さず、残り時間と案内を横いっぱいに大きく（#stage.v2-xshut）。
       参加受付の間・待ち受け・結果・ハイライトの QR はそのまま（この段は参加受付が締め切ったあとで、新しく読んでも次のレースの時刻が出るだけ） */
    stageEl.classList.toggle('v2-xshut', closed);
    if (!closed) fitHow();
  }

  // ---------- 時刻の表示（4 回/秒） ----------
  function tickLabels() {
    if (!S) return;
    const t = now(), m = TV.mode;
    let R = null, lbl = '', target = 0, sub = '';
    // 下の時刻: 時刻は 1 つ＋状態の札（「締切 8:04 発走 8:04 ただいま受付中」が途中で折り返していた。2026-10-14 見た目の講評）
    let stx = '', stc = '';
    if (m === 'open') {
      R = S.open;
      if (R && !xShut(R, t) && t < xAt(R)) { // 参加受付: 大きく「参加受付 あと」、小さく「投票締切」
        lbl = '参加受付締め切りまで あと'; target = xAt(R); sub = '投票締切 ' + hhmm(R.closeAt) + (hhmm(R.closeAt) === hhmm(R.at) ? '' : '・' + hhmm(R.at) + ' 発走');
        const xl = xAt(R) - t; stx = xl < 15000 ? 'まもなく参加受付の締切' : '参加受付中'; stc = xl < 15000 ? 'hot' : 'on';
      } else if (R) { // 投票: 参加受付は締切。大きく「投票 あと」
        lbl = '投票 あと'; target = R.closeAt; sub = ''; stx = '参加受付は締切'; stc = 'shut'; // 発走時刻は上の帯（同じ時刻を 2 回出さない）
      }
    }
    else if (m === 'wait' || m === 'hl') { R = nextRaceOf(); lbl = '次のレースの発走まで'; target = R && R.at; sub = R ? hhmm(R.at) + ' 発走' : '本日のレースは終了しました'; if (R) { const can = S.open && R.id === S.open.id && t < xAt(R); if (can && m === 'wait') { lbl = '参加受付締め切りまで あと'; target = xAt(R); sub = ''; } /* 2026-10-19: 次のレースが受付中なら、受付の画面と同じく「参加受付 あと」（上の札「次のレース 受付中」とそろえる。発走時刻は小さな行） */ stx = can || R.openAt <= t ? '参加受付中' : hhmm(R.openAt) + ' 受付開始'; stc = can || R.openAt <= t ? 'on' : ''; } } // 次のレースが受付中（スマホで参加できる）なら、そう出す（上の札とそろえる）
    else if (m === 'result') { R = S.open || nextRaceOf(); lbl = '次のレースまで'; target = R && R.at; }
    const left = target ? target - t : 0, hot = !!target && left < (lbl === '参加受付締め切りまで あと' ? 15000 : 30000) && m === 'open';
    stageTexts(m === 'open' && xShut(S.open, t));
    // 交換の割合「リングバウンティ X枚 → 100」（管理画面の設定。全店共通）。参加のしかたの枠の下（投票の段＝参加受付の締切のあとは枠ごと入れ替わるので出ない）
    { const xe = $('v2rateX'), x = rateNow(); if (xe && xe.textContent !== String(x)) xe.textContent = String(x); }
    { const qb = $('v2qrTx').querySelector('b'), want = m === 'open' && xShut(S.open, t) ? '次のレースの案内' : m === 'result' || m === 'hl' ? '次のレースに スマホで参加' : 'アプリ不要 スマホで参加'; if (qb && qb.textContent !== want) qb.textContent = want; }
    const ca = m === 'open' && S.open ? S.open.at : target; // 上の時計はいつも発走まで
    $('v2clockLbl').textContent = m === 'open' ? '発走まで' : '次の発走まで';
    $('v2clockNum').textContent = ca ? fmtLeft(ca - t) : '--:--';
    $('v2clock').classList.toggle('hot', m === 'open' && !!S.open && S.open.closeAt - t < 30000);
    const mh = runMode() === 'staff' && !TV.armed ? 'スタッフの「次へ」でレースを流します' : runMode() === 'bet' ? 'この店で投票があるとレースを流します' : '';
    if (mh && (m === 'wait' || m === 'open')) sub = sub ? sub + '\n' + mh : mh;
    /* 2026-10-20 オーナー「参加受付 あと を、もっと大きく」: 「参加受付締め切り／まで あと」の 2 行にして文字を大きく（.cd.xlbl。読み上げの中身は同じ文） */
    { const xl = lbl === '参加受付締め切りまで あと', lh = xl ? '参加受付締め切り<br>まで あと' : esc(lbl), le = $('v2cdLbl'); if (le.innerHTML !== lh) le.innerHTML = lh; $('v2cd').classList.toggle('xlbl', xl); }
    $('v2cdNum').textContent = target ? fmtLeft(left) : '—';
    if ($('v2cdSub').textContent !== sub) { $('v2cdSub').textContent = sub; fitText($('v2cdSub'), 24, 15); }
    const se = $('v2cdSt'); if (se.textContent !== stx) se.textContent = stx; se.className = stc; se.hidden = !stx;
    // ハイライト中は上の時計が消えるので、下の帯に次のレースの発走までを出す
    if (m === 'hl') { $('v2stripNxL').textContent = R ? '次のレース ' + hhmm(R.at) + ' 発走まで' : '本日のレースは終了しました'; $('v2stripNxN').textContent = target ? fmtLeft(left) : ''; }
    $('v2cd').classList.toggle('hot', hot);
    const P = m === 'live' || m === 'result' ? (view || R) : (R || view);
    $('v2pplNum').textContent = ppl(m === 'open' ? S.open : P);
    if (m === 'live' && view) { const r = cache[view.id] || view; $('v2stripPpl').textContent = ppl(r); }
    setStatus(m, t);
  }
  /* 状態の札（左上・どの場面も同じ位置と形）。色は 5 つだけ: on＝緑（参加受付）・vote＝青（投票）・hot＝赤（締切）・race／live＝紺（レース・リプレイ・ハイライト）・res＝金（結果） */
  let stKey = '';
  function setStatus(m, t) {
    let tx = '', c = 'race';
    if (m === 'open' && S.open) { const R = S.open; if (xShut(R, t)) { const hot = R.closeAt - t < 30000; tx = hot ? 'まもなく投票締切' : '投票受付中'; c = hot ? 'hot' : 'vote'; } else { const hot = xAt(R) - t < 15000; tx = hot ? 'まもなく受付締切' : '参加受付中'; c = hot ? 'hot' : 'on'; } }
    else if (m === 'wait') { const N = nextRaceOf(); if (!N) tx = '本日のレースは終了'; else if (S.open && N.id === S.open.id && t < xAt(N)) { tx = '次のレース 受付中'; c = 'on'; } else tx = '次のレース'; }
    else if (m === 'hl') tx = '前のレースのハイライト';
    else if (m === 'live') {
      const ph = raceView.phase, pre = view && view.runAt && t < view.runAt;
      if (!$('board').hidden || ph === 'winner') { tx = 'レース結果'; c = 'res'; }
      else if (ph === 'replay') tx = $('tagPhoto').classList.contains('show') ? '写真判定中' : 'リプレイ';
      else if (pre || ph === 'idle') { tx = '投票締切・まもなく発走'; c = 'race'; } // 赤のままだと警告に見える（締切の瞬間は「締切ました」が出る）
      else { tx = stageEl.classList.contains('bc-final') ? 'LIVE　ゴール前' : 'LIVE　レース中'; c = 'live'; }
      stageEl.classList.toggle('st-soon', ph === 'replay' && $('board').hidden); // リプレイ・写真判定のあいだは下の帯を「結果はまもなく」に（途中から見た人にも分かる）
    } else if (m === 'result') { tx = '結果発表'; c = 'res'; } // 結果画面の札はずっと「結果発表」（札の右が前のレースの発走時刻なので、次のレースの案内は右下の枠で出す）
    if (m !== 'live') stageEl.classList.remove('st-soon');
    const k = tx + '|' + c; if (k === stKey) return; stKey = k;
    ['v2st', 'v2st2'].forEach((id) => { const e = $(id); e.className = 'v2st ' + c; e.hidden = !tx; $(id + 'T').textContent = tx; });
  }

  // ---------- 起動画面: 全店同時なので自動で閉じる（音は決定ボタン・タップで出る） ----------
  let audioOn = false;
  function unlockAudio() {
    if (audioOn) return; audioOn = true;
    try { Sfx.unlock(); if (window.Voice) Voice.unlock(); if (window.Commentary) Commentary.unlock(); } catch (e) { }
    $('v2snd').classList.remove('show');
  }
  (function splash() {
    const sp = $('splash'); if (!sp) return;
    const sub = sp.querySelector('.sub'); if (sub) sub.textContent = '参加費無料 スマホでカンタン投票';
    const go = sp.querySelector('.splash-go'); if (go) go.innerHTML = '<p class="tap">スタート</p><p class="keys">決定ボタン（OK）を押すと音が出ます</p>';
    let splashRun = null;
    try { if (window.Splash3D && window.Race && window.Race.Race3D && !/[?&]r2d=1/.test(QS)) { splashRun = Splash3D.start($('splashRun'), Engine.makeRace().horses, { quality: (window.R3D && R3D.quality) || 'high' }); if (splashRun) $('splashRun').classList.add('is3d'); } } catch (e) { splashRun = null; }
    const bye = () => { if (!sp.parentNode) return; sp.id = ''; sp.classList.add('bye'); setTimeout(() => { sp.remove(); if (splashRun) { try { splashRun.stop(); } catch (e) { } } }, 520); if (!audioOn && !MUTE && !Sfx.isMuted()) $('v2snd').classList.add('show'); };
    sp.addEventListener('click', () => { unlockAudio(); bye(); });
    setTimeout(bye, MUTE ? 600 : 4000);
  })();
  ['keydown', 'pointerdown', 'touchend'].forEach((ev) => document.addEventListener(ev, () => unlockAudio(), { passive: true }));
  Sprites.load().then(() => { if (view) { raceView.draw(); renderHorses(); } }).catch(() => {});

  /* ---------- 自動アップデート（Fire TV のアプリの中だけ。2026-10-18） ----------
     アプリ（casa SLOT の APK）は、ページが /__update を呼んだときだけ公開サイトの version.json に並んだファイル（derby/ も入っている）を端末に取り込む。
     casa SLOT の画面（js/game.js の autoUpdate）と同じ考え方で、DERBY のテレビも 起動して少したったら・1 時間ごと・画面に戻ってきたときに呼ぶ。
     新しい版が端末に入ったら（done、または latest で今の版より新しい）、読み直してよい時（待ち時間・前のレースのハイライト）まで待って開き直す。
     受付・発走前・レース中・結果の画面では読み直さない。ただし待ち時間が来ないまま 20 分たったら（レースの間隔が詰まっている日）、
     結果の画面が出て 30 秒たったあと（次の受付の 15 秒前まで）か、受付が始まったばかり（参加受付の締切まで 75 秒以上）のときにも開き直す。
     今の版: アプリの中の ../version.json（casa SLOT の版。例 b122。アプリが取り込んだ版を出す）を起動のときに読んで覚える。読めなければ done のときだけ開き直す。
     ブラウザ・Web デモ・模擬では何もしない。圏外・更新に未対応の古いアプリ（/__update が無い・json でない）は黙って何もしない。 */
  const IN_APP = location.hostname === 'appassets.androidplatform.net';
  const UPD_EVERY_MS = 60 * 60 * 1000, UPD_LONG_MS = 20 * 60 * 1000;
  const UPD = { running: false, run: null, last: 0, pending: false, pendingSince: 0, pageV: null, st: null, n: 0, why: '' };
  const verNum = (v) => parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10) || 0;
  const getJson = async (u) => { const r = await fetch(u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('http ' + r.status); return r.json(); };
  let pageVP = null;
  function pageVersion() { // 今このページに入っている版（起動のときの 1 回だけ読む）
    if (!pageVP) pageVP = Promise.resolve().then(() => getJson(new URL('../version.json', location.href).href)).then((j) => { UPD.pageV = (j && j.v) || ''; return UPD.pageV; }, () => { UPD.pageV = ''; return ''; });
    return pageVP;
  }
  const newerOnDisk = (st, pv) => !!st && (st.state === 'done' || (st.state === 'latest' && !!pv && verNum(st.v) > verNum(pv)));
  function autoUpdate(force) { // force: 管理画面の「テレビの再読み込み」から。間隔あけ（60 秒）を飛ばす。走っている途中なら、その終わりを待つ
    if (!IN_APP) return Promise.resolve(false);
    if (UPD.running) return UPD.run;
    if (!force && Date.now() - UPD.last < 60000) return Promise.resolve(UPD.pending);
    UPD.running = true; UPD.last = Date.now(); UPD.n++;
    UPD.run = (async () => {
      try {
        const pv = await pageVersion();
        let st = await getJson('/__update');
        for (let i = 0; i < 180 && st && st.state === 'running'; i++) { await sleep(1000); st = await getJson('/__update_status'); }
        UPD.st = st;
        if (newerOnDisk(st, pv) && !UPD.pending) { UPD.pending = true; UPD.pendingSince = Date.now(); }
      } catch (e) { UPD.st = { state: 'fail' }; /* 圏外・古いアプリ: 何もしない（次の確認でまた試す） */ }
      UPD.running = false;
      return UPD.pending;
    })();
    return UPD.run;
  }
  // 読み直してよい時か（longWait: 待ち時間が来ないまま長く待った）
  function updSafe(longWait) {
    if (TV.reloading || TV.playing || document.getElementById('tvkeyBox')) return false;
    const m = TV.mode;
    if (!S || !m) return true; // まだ何も映していない
    const t = now(), open = S.open, openSoon = !!open && t >= (open.openAt || 0) - 10000;
    if (m === 'wait' || m === 'hl') return !openSoon; // 次の受付の 10 秒前からは待つ
    if (!longWait) return false;
    if (m === 'result') return !!TV.resBase && t - TV.resBase.t >= 30000 && !(open && t >= (open.openAt || 0) - 15000);
    if (m === 'open' && open) return xAt(open) - t >= 75000;
    return false;
  }
  function updWatch() {
    if (!UPD.pending || TV.reloading) return;
    const long = Date.now() - UPD.pendingSince >= UPD_LONG_MS;
    if (!updSafe(long)) return;
    UPD.pending = false; UPD.why = long ? 'long' : 'safe';
    doReload();
  }
  // 管理画面の「テレビの再読み込み」: アプリの中なら先に取り込み（終わるまで最大 180 秒）→ 取り込めても・失敗しても・未対応でも開き直す
  let reloadAsked = false;
  async function reloadWithUpdate() {
    if (TV.reloading || reloadAsked) return; reloadAsked = true;
    if (IN_APP) { try { await autoUpdate(true); } catch (e) { } }
    UPD.pending = false; UPD.why = 'signal';
    doReload();
  }
  if (IN_APP) {
    pageVersion();
    setTimeout(() => autoUpdate(), 20000 + Math.floor(Math.random() * 40000)); // 起動して 20〜60 秒後（全店のテレビが同時に取りに行かないようにばらす）
    setInterval(() => autoUpdate(), UPD_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) autoUpdate(); });
    setInterval(() => { try { updWatch(); } catch (e) { console.error(e); } }, 1000);
  }

  // ---------- テスト・確認用 ----------
  window.DERBY = {
    get pair() { return window.__derbyPair; }, // 進行役のテレビ（2026-10-19）
    v2: true, store: STORE, raceView, Engine, cloud: C, tv: TV,
    upd: UPD, updCheck: (force) => autoUpdate(force), updSafe, // 自動アップデート（tests/v2-tv-update.test.js）
    get race() { return view; }, get phase() { return TV.mode; }, get state() { return S; }, now,
    get cues() { return TV.cues || null; }, cueOverride: CUE_Q, // 確定演出: いま映像に渡しているもの（tests/v2-tv.plan.js）と ?cues= の上書き
    // 結果画面の 5 分の流れの確認用: resultAt(秒) で「結果画面が出てから 秒」の場面にする（表示の時計だけ進める。閉じる時刻は本物のまま）。resultAt(null) で戻す
    resultAt(sec) { if (sec == null) { TV.resSkew = 0; return 0; } const b = TV.resBase; if (!b) return null; TV.resSkew = b.t + sec * 1000 - now(); if (TV.resultRace && TV.mode === 'result') showResult(cache[TV.resultRace.id] || TV.resultRace); return RT.ph; },
    get resTimeline() { const L = document.getElementById('v2resList'); return { ph: RT.ph, hi: RT.hi, el: TV.resBase ? Math.round((resClock() - TV.resBase.t) / 100) / 10 : null, sub: !!document.querySelector('#v2res.sub-on'), hiRow: L ? Array.prototype.findIndex.call(L.querySelectorAll('.row'), (r) => r.classList.contains('hi')) : -1 }; },
    // 2 台のテレビの比べっこ用: いま映しているもの
    snap() {
      const rv = raceView, run = rv.run;
      return { mode: TV.mode, viewId: view && view.id, playing: TV.playing, rvPhase: rv.phase, gate: !!rv.gi, giT: rv.gi ? +rv.gi.t.toFixed(2) : null, runT: run ? +run.t.toFixed(3) : null, simWall: rv.simWall != null ? +rv.simWall.toFixed(3) : null,
        pos: run ? run.pos.map((p) => +p.toFixed(4)) : null, lag: run && TV.mode === 'live' && rv.phase === 'run' && !rv.endHold && view && view.runAt && rv.simWall != null ? +((now() - view.runAt) / 1000 - rv.simWall).toFixed(3) : null, winner: rv.winnerIdx, tvAuth, now: Math.round(now()), resultId: TV.resultRace && TV.resultRace.id, hl: TV.hl && TV.hl.id, catchUps: rv.catchUps || 0 };
    },
  };
})();
