/* casa BOAT スマホの「レースを見る」（v2/boat-watch.html?s=<店>&race=<レース id>。2026-11-23 オーナー「ボートにも入れる」）。
   競馬の「レースを見る」（v2/watch.js ＝ 3D・v2/watchmap.js ＝ 真上から見た図。2026-10-29〜30）と同じ役目・同じ言葉・同じ部品の見た目（v2/watch.css をそのまま読む）。
   競馬と同じ所:
   - 見られるのは、いまのレースにこのスマホの票があるときだけ。無ければ「投票した方だけ見られます」。票は投票ページ（親の窓 window.BOATWATCH）が持っている自分の票か、自分で 1 回読む（C.myBoatVote）
   - 「3Dで見る」（店のテレビと同じ映像）と「図で見る」（コースを真上から見た図。絵の部品を読まない軽い見方）を切り替え。選んだ表示はこの端末に覚える（casa.boat.watchView）
   - 時刻は店のテレビと同じ（サーバーの時計。映像の始まり runAt から数える）。着順も同じ（決める係が置いた結果の種と着順から、同じ計算で走りを作る）
   - 自分の予想（組番・当たれば○○・いま○位）と順位の表、「当たりの形！」「あと少し！」、結果（的中！・おしい！・ハズレ）。結果は発表された本物だけで判定する
   - 何も書かない（Firestore・模擬クラウドのどちらにも）。窓を閉じたら見張りと 3D の絵の記憶をすぐ手放す
   ボートだけの所（競馬の watch.js をそのまま使えない理由は報告に書いた）:
   - 映像は boat/race-boat.js の BOAT.Race（店のテレビ v2/tv-boat.js と同じ部品・同じ渡し方）。競馬の「見るだけ」は競馬のテレビのページ（index.html?watch=1 ＋ v2/tv.js）そのものなので、ボートの映像は出せない
   - 音は出さない・音のボタンも無い（ボートのスマホは無音。音の部品 boat/sound.js・fanfare-boat.js・announce-boat.js は読まない）
   - 軽さ: 画質はいちばん軽い段（'min'。?boatq= で変えられる）・1 秒 30 コマまで・絵は 1000×480 で描いて縮める（スマホの画素の細かさで重くならない）・映像が終わったら描くのを止める
   - 当たりは BPT（自動で入る。受け取りの画面は無い）
   読み取り（Firestore。1 レース・1 台）: 窓で開いたとき ＝ レースの書類 1 ＋ 結果の種 1 の 2 回（いまの状態・自分の票・時計は投票ページの物を使う）。
     直接開いたとき ＝ それに、いまの状態の見張り（最初の 1 ＋ 変わるたび 約 4）と自分の票 1〜2 を足す。くり返し読むものは無い。
   確認用に window.BoatWatch。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const QS = location.search, qp = new URLSearchParams(QS);
  const STORE = String(qp.get('s') || qp.get('store') || '').trim().toLowerCase(), RACE_Q = String(qp.get('race') || '');
  const DC = window.DerbyCloud || null, Boat = window.BoatCore || null, Core = window.DerbyCore || null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? o[k] : ''));
  const hm = (ms) => (Core ? Core.fmtBizTime(ms, 5) : new Date(ms).toTimeString().slice(0, 5));
  const left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ME = (document.currentScript && document.currentScript.src) || '';
  const ROOT = ME ? ME.replace(/v2\/[^/#?]*([?#].*)?$/, '') : '../';
  const VQ = '?v=' + ((/[?&]v=([^&#]+)/.exec(ME) || [])[1] || 'bw1'); // 版の印: あとから読む映像の部品にも同じ印を付ける（v2/tv-boat.js と同じやり方。公開のたびに boat-watch.html の V を上げる）
  /* 言葉は競馬の「レースを見る」（v2/watch.js の TX・v2/watchmap.js）と同じ。場面の札はボートのテレビ（v2/tv-boat.js）と同じ言い方。単位だけ BPT */
  const TX = {
    backBig: '投票ページへ戻る', loading: '読み込み中…', usage: '観戦は休止中です', usageSub: '混み合っているため', /* 読み取りの枠（2026-11-25） */ noVote: '投票した方だけ見られます', noVoteSub3d: '投票ページで投票すると、このレースをテレビと同じ画面で見られます', noVoteSubMap: '投票ページで投票すると、このレースを見られます',
    over: 'このレースは終わりました', overSub: '次のレースも投票すると見られます', login: '投票した方だけ見られます', loginSub: '投票したスマホのブラウザで、投票ページから開いてください',
    mine: 'あなたの予想', more: 'ほか {n} 件', now: 'いま{r}位', loadingMine: 'あなたの予想を読み込み中…', ifWin: '当たれば',
    hot: '当たりの形！', near: 'あと少し！', hit: '的中！', close: 'おしい！', miss: 'ハズレ', back: '返還', congrats: 'おめでとう！', claim: 'BPT はスマホに自動で入ります', capped: '上限で止まりました', noPay: 'このレースは払い戻しなし',
    test: 'テストレース（BPT は増えません）', voided: 'このレースは取り消しました', result: '結果', toMap: '図で見る', to3d: '3Dで見る', closeBtn: '閉じる',
    noGl: 'この端末ではレースの映像を表示できません', noGlSub: '投票ページで結果を確かめてください',
    tagVote: '投票受付中', tagLast: 'まもなく締切', tagClosed: '投票締切・まもなく発走', tagRace: 'レース中', tagReplay: 'リプレイ', tagGoal: 'ゴール', tagPend: '結果を確認中', tagDone: '確定', // tagReplay・tagGoal: ゴール後の場面（2026-11-23。競馬のテレビの「リプレイ」・競馬の図の「ゴール」と同じ言葉）
    toClose: '締切まで', toStart: 'スタートまで', holdOpen: '締切のあと レースの映像が始まります', holdClosed: '投票は締め切りました', holdSoon: 'まもなく発走・スタートまで あと {t}', holdLate: 'まもなく映像が始まります',
    flying: 'フライング', fall: '転覆', lead: '先頭', lap: '{n}周目', lapLast: '最終周',
  };

  /* ---------- 表示（3D か 図か）と画質 ---------- */
  const PREF = 'casa.boat.watchView';
  let pref = null; try { pref = localStorage.getItem(PREF); } catch (e) { pref = null; }
  const vq = qp.get('view'), VIEW = vq === 'map' || vq === '3d' ? vq : pref === 'map' ? 'map' : '3d'; // 3D（テレビと同じ映像）が先。図は ?view=map・窓の中の「図で見る」で選んだ端末
  /* 画質: スマホはいちばん軽い段から（'min' ＝ 最もなめらか: 軽い部品・細かさ 0.75 倍・観客と木と旗なし。boat/race-boat.js の 5 段）。?boatq=max / std / auto / lite / min で変えられる（確かめ用） */
  const lvOf = (v) => (v === 'max' || v === 'auto' || v === 'lite' || v === 'min' ? v : v === 'low' ? 'lite' : '');
  const lvQ = (/[?&]boatq=(\w+)/.exec(QS) || [])[1], LEVEL = lvQ && /^(max|std|auto|lite|min|high|low)$/.test(lvQ) ? lvOf(lvQ) : 'min';
  const FPS = clamp(Number(qp.get('fps')) || 30, 5, 60); // 1 秒に描く回数の上限（電池と熱。競馬のテレビも 30）
  document.documentElement.classList.add(VIEW === 'map' ? 'bw-map' : 'bw-3d');

  /* ---------- 親の窓（ボートの投票ページ）: 同じサイトのときだけ ---------- */
  function parentBoat() { try { const P = window.parent; if (P && P !== window && P.BOATWATCH) { void P.location.href; return P.BOATWATCH; } } catch (e) { /* 別のサイト */ } return null; }
  const IN_BET = !!parentBoat();
  const pclock = () => { const B = parentBoat(); let v = NaN; try { v = B && B.now ? Number(B.now()) : NaN; } catch (e) { v = NaN; } return v; };
  const C = DC && STORE ? DC.create({ store: STORE, role: 'watch', boat: true, clock: pclock }) : null; // role 'watch': 名乗らない・書かない・新しくログインしない（v2/client-firestore.js）
  // 時計: 窓で開いたときは投票ページの時計（同じ端末＝ずれない）。直接開いたときは自分で合わせた時計
  const now = () => { const v = pclock(); return v > 0 ? v : C ? C.serverNow() : Date.now(); };
  const READS = { live: 0, race: 0, hidden: 0, vote: 0 }; // 自分で読んだ回数（確かめ用）

  const keep = ['cloud', 'mute', 'boatq', 'fps'].map((k) => (qp.get(k) ? '&' + k + '=' + encodeURIComponent(qp.get(k)) : '')).join('');
  function goBack() {
    const B = parentBoat();
    if (B && B.close) { try { B.close(); return; } catch (e) { /* 下へ */ } }
    location.href = 'boat.html?s=' + encodeURIComponent(STORE) + ['cloud', 'mute'].map((k) => (qp.get(k) ? '&' + k + '=' + encodeURIComponent(qp.get(k)) : '')).join('');
  }
  function switchView(v) { try { localStorage.setItem(PREF, v); } catch (e) { /* noop */ } stop(); location.replace('boat-watch.html?s=' + encodeURIComponent(STORE) + (RACE_Q ? '&race=' + encodeURIComponent(RACE_Q) : '') + '&view=' + v + keep); }
  $('wBack').addEventListener('click', goBack); $('wLockB').addEventListener('click', goBack);
  $('wMap').textContent = VIEW === 'map' ? TX.to3d : TX.toMap;
  $('wMap').addEventListener('click', () => switchView(VIEW === 'map' ? '3d' : 'map'));

  /* ---------- 画面の合わせ方（競馬の watch.js の fit と同じ決め方。映像は 1000×480） ----------
     w-port 縦向き: 上に帯・映像は横いっぱい・その下に場面の札／順位の表／自分の予想
     w-side 横向きで右に 170px 以上空く画面（パソコンなど）: 映像を左に収め、右の列に帯と自分の予想
     w-bot  横向きのスマホ: 映像を上に収め、下の細い帯に戻るボタン・自分の予想・表示の切り替え（映像の上には何も重ねない） */
  const FW = 1000, FH = 480, TOP_H = 40, BOT_H = 50, SIDE_MIN = 170;
  /* 絵を描く大きさ（映像の枠の中の、縮める前の大きさ）: 1250×600。映像の部品はこの大きさから絵の細かさを決める（スマホの画素の細かさは見ない）＝
     3D の絵はいちばん軽い段で 938×450（0.75 倍）・字の絵は 1250×600。スマホの縦向き（幅 390 前後）でも字がつぶれず、どのスマホでも重さは同じ */
  const IN_W = 1250, IN_H = 600;
  let mode = '', stageW = 0, stageH = 0, short = false;
  function fit() {
    const sbar = Number(window.__bwSbar) || 0, vw = window.innerWidth, vh = Math.max(160, window.innerHeight - sbar), port = vh > vw;
    let s, x = 0, y = 0, m;
    if (port) { m = 'w-port'; s = vw / FW; y = TOP_H; }
    else {
      const s0 = Math.min(vw / FW, vh / FH);
      if (vw - FW * s0 >= SIDE_MIN) { m = 'w-side'; s = s0; y = Math.round((vh - FH * s) / 2); }
      else { m = 'w-bot'; s = Math.min(vw / FW, (vh - BOT_H) / FH); x = Math.round((vw - FW * s) / 2); }
    }
    const de = document.documentElement, st = de.style;
    if (m !== mode) { ['w-port', 'w-side', 'w-bot'].forEach((c) => de.classList.toggle(c, c === m)); mode = m; last.lines = last.ord = null; }
    stageW = Math.round(FW * s); stageH = Math.round(FH * s);
    st.setProperty('--wx', x + 'px'); st.setProperty('--wy', y + 'px'); st.setProperty('--ww', stageW + 'px'); st.setProperty('--wh', stageH + 'px'); st.setProperty('--ws', String(stageW / IN_W));
    { const sh = port && vh <= 620; if (sh !== short) { short = sh; de.classList.toggle('bw-short', sh); last.lines = null; } } // 背の低い画面（iPhone SE など）: 自分の予想は 2 つまで＋ほか n 件
    MAP.w = 0; // 図の絵は次のコマで大きさを合わせ直す
  }

  /* ---------- いまの状態（ボートのレース）と自分の票 ---------- */
  let LIVE = null, loginErr = false, unWatch = null, stopped = false;
  const onLive = (l) => { LIVE = l || { race: null, next: null }; };
  const liveNow = () => { const B = parentBoat(); if (B && B.live) { try { const l = B.live(); if (l) return l; } catch (e) { /* 下へ */ } } return LIVE; };
  const noteErr = (e) => { if (e && (e.status === 401 || (e.cause && e.cause.status === 401))) loginErr = true; }; // ログインが無い（投票ページと別のブラウザで開いた）
  if (C && !IN_BET) { // 直接開いたとき: いまの状態を自分で見張る（変わったときだけ届く）。3 秒たっても届かないときだけ読みに行く
    READS.live++; unWatch = C.boatWatch({ boat: onLive, error: noteErr });
    (function poll(n) { setTimeout(() => { if (LIVE || stopped) return; C.boatState().then((x) => { if (!LIVE) onLive(x.live); }, noteErr).then(() => { if (!LIVE) poll(n + 1); }); }, n ? Math.min(15000, 3000 * n) : 3000); })(0);
  }
  if (C && !IN_BET && C.backend !== 'firestore' && C.syncClock) { C.syncClock(3).catch(() => {}); setInterval(() => { if (!document.hidden && !stopped) C.syncClock(3).catch(() => {}); }, 60000); } // 模擬クラウドの時刻合わせ（ボートの投票ページと同じ）
  else if (C && !IN_BET && C.syncClock) setInterval(() => { if (!stopped && (!C.usage || C.usage.tick('bw.clock', 29 * 60000))) C.syncClock().catch(() => {}); }, 30 * 60000); /* 2026-11-25 読み取りの枠: 5 分→30 分 */

  /* 自分の票（v2/boat-core.js の voteView の形）。返り値: null（票なし）| { v, pending } */
  const own = {};
  let pv; // 確かめ用（BoatWatch.preview）: 自分の票をこの中身にして描かせる（undefined ＝ 本物）
  function voteFor(r) {
    if (pv !== undefined) return pv ? { v: pv, pending: false } : null;
    const B = parentBoat();
    if (B && B.votes) { try { const v = B.votes(r.id); return v ? { v, pending: false } : null; } catch (e) { /* 下へ */ } }
    if (!C || !C.myBoatVote) return null;
    let c = own[r.id];
    if (!c) {
      c = own[r.id] = { v: null, none: false, got: false, re: false }; READS.vote++;
      C.myBoatVote(r.id).then((x) => { c.got = true; c.v = (x && x.vote) || null; c.none = !c.v; }, (e) => { noteErr(e); setTimeout(() => { if (own[r.id] === c && !c.got) delete own[r.id]; }, 5000); });
    }
    if (c.none) return null;
    // 発表のあと: 当たり・返還のある人だけ、実際に増えた額（上限で止まった分を除く）を 1 回読み直す（ボートの投票ページと同じ決まり）
    if (c.v && !c.re && r.status === 'done' && r.result) { const x = localResult(c.v, r); if (x && (x.won > 0 || x.back)) { c.re = true; READS.vote++; C.myBoatVote(r.id).then((y) => { if (y && y.vote) c.v = y.vote; }, () => { setTimeout(() => { c.re = false; }, 5000); }); } else c.re = true; }
    return { v: c.v, pending: !c.v };
  }
  // 手元で数える結果（置き場の数え方 BoatCore.voteView をそのまま使う。読み直した票に won があればそれが本物）
  function localResult(v, r) {
    if (!v || !r || r.status !== 'done' || !r.result || !Boat) return null;
    if (v.won != null) return { hit: v.hit || 0, won: Number(v.won) || 0, gain: v.gain != null ? Number(v.gain) || 0 : Number(v.won) || 0, capped: v.capped === true, back: v.back || null };
    let o = null; try { o = Boat.voteView(Object.assign({ owner: 'x' }, v), r); } catch (e) { o = null; }
    return o ? { hit: o.hit || 0, won: o.won || 0, gain: o.won || 0, capped: false, back: o.back || null } : null;
  }

  /* いま見せるレース（見られるか）。返り値 { race, st, v, pending } | { why } */
  let focus = null, ever = false;
  function pickFocus() {
    if (C && C.usage && !C.usage.watchOk()) { if (unWatch) { try { unWatch(); } catch (e) { /* noop */ } unWatch = null; } return { why: 'usage' }; } // 読み取りの枠（2026-11-25）: 節約・最低限・この端末の上限のときは見張りを止めて案内だけ
    const L = liveNow(); if (!L) return { why: loginErr ? 'login' : 'load' };
    const t = now(), r0 = L.race || null, r = r0 && (!RACE_Q || r0.id === RACE_Q) ? r0 : null;
    const gone = loginErr ? 'login' : ever || RACE_Q ? 'over' : 'novote'; // レースを名指しで開いた（投票ページの入口から）のに、そのレースがもう無い ＝ 終わった
    if (!r || !Boat) return { why: gone };
    const st = Boat.stageOf(r, t);
    if (st === 'none' || st === 'over') return { why: gone };
    if (st === 'wait') return { why: loginErr ? 'login' : 'novote' };
    const mv = voteFor(r); if (!mv) return { why: loginErr ? 'login' : 'novote' };
    if (st === 'void') return { why: 'void' };
    if (mv.pending) return { why: 'load' }; // 自分の票が届くまでは何も読まない・出さない（投票していないスマホで、映像の部品やレースの書類を読まない）
    return { race: r, st, v: mv.v, pending: false };
  }

  /* ---------- 映像の部品（押して開いたあとに 1 回だけ読む） ----------
     3D: three.js・艇と会場の絵・進路・映像（店のテレビ v2/tv-boat.js の needFilm と同じ並びから、音の 3 つを除いたもの）
     図: 絵の部品（three.js・boat3d.js・venue3d.js）は読まない。進路の計算と映像の部品の「中身だけ」（BOAT.Race の adopt・stateAt。tests/boat-film.test.js と同じ使い方）を使う */
  const loaded = {};
  function load(src) { return loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = ROOT + src; s.async = false; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('load ' + src)); }; document.head.appendChild(s); })); }
  let partsP = null;
  function needParts() {
    if (!partsP) partsP = (async () => {
      const L = [];
      if (VIEW === '3d') { if (!window.THREE) L.push('js/vendor/three.min.js'); } else if (!window.THREE) window.THREE = {}; // 図: 絵の部品は使わない（映像の部品は読み込みのときに THREE の名前だけ見る）
      if (!window.Engine) L.push('js/engine.js' + VQ);
      if (!window.BoatModel) L.push('js/boat-model.js' + VQ);
      L.push('boat/course.js' + VQ);
      if (VIEW === '3d') L.push('boat/boat3d.js' + VQ, 'boat/venue3d.js' + VQ);
      L.push('boat/lines.js' + VQ, 'boat/race-boat.js' + VQ);
      await Promise.all(L.map(load)); // 実行は入れた順（async=false）
      return true;
    })().catch((e) => { partsP = null; throw e; });
    return partsP;
  }

  /* ---------- 映像の中身（レースの書類 1 回 ＋ 結果の種 1 回） ---------- */
  const F = { id: '', gen: 0, full: null, fullAt: -1e9, fullBusy: false, hid: null, hidAt: -1e9, hidBusy: false, R: null, ready: false, building: false, tryAt: -1e9, runAt: 0, order: null, on: false, pitAt: -1e9, frozen: false, err: '', frames: 0, prepMs: 0 };
  let noGl = false;
  function resetFilm(id) {
    if (F.id === id) return;
    F.id = id; F.gen++; F.full = null; F.hid = null; F.ready = false; F.building = false; F.order = null; F.on = false; F.frozen = false; F.err = ''; F.fullAt = F.hidAt = F.tryAt = -1e9; F.mapT = null;
    try { if (F.R && F.R.cancelPrep) F.R.cancelPrep(); } catch (e) { /* noop */ }
    if (VIEW === 'map') F.R = null;
  }
  // レースの書類（艇の走りの再現 model・倍率）。読めなかったら 3 秒あける（読み取りを増やさない）
  function needFull(r) {
    if (F.full || F.fullBusy || performance.now() - F.fullAt < 3000 || !C) return;
    const id = r.id; F.fullBusy = true; F.fullAt = performance.now(); READS.race++;
    C.boatRace(id).then((x) => { if (F.id !== id) return; F.full = x || null; if (x && x.hidden && x.hidden.seed != null) F.hid = x.hidden; }, noteErr).then(() => { F.fullBusy = false; });
  }
  /* 結果の種と着順（映像用）。置き場の決まり（boatResults）: 映像の始まりの 2 秒前から、ログインした人が読める（競馬の derbyResults と同じ。締切のあとなので、先に知っても投票はできない）。
     窓口（v2/client.js の boatRace）は、発表の前はテレビにしか種を返さない作りなので、発表の前はここで 1 件だけ読む（Firestore ＝ boatResults/<id>・模擬クラウド ＝ /api/boat/race?watch=1）。
     窓口が「見るだけ」にも種を返すようになったら（v2/boat-firestore.js の boatRace に role 'watch' を足す）、needFull の中で届くのでここは通らない */
  function fbApp() { // つないである Firebase（v2/client-firestore.js の connect が作る名前つきの app 'derby'）。窓の中で投票ページのつなぎを使っているときは、投票ページの物
    const pick = (w) => { try { const fb = w && w.firebase; return (fb && fb.apps && fb.apps.find((a) => a.name === 'derby')) || null; } catch (e) { return null; } };
    return pick(window) || (window.parent && window.parent !== window ? pick(window.parent) : null);
  }
  async function hiddenOf(id) {
    if (C.backend === 'firestore') {
      const app = fbApp();
      if (app) { const sn = await (window.DerbyFirestore && DerbyFirestore.countedDb ? DerbyFirestore.countedDb(app.firestore(), 'watch') : app.firestore()).collection('boatResults').doc(id).get(); /* countedDb: 読み取りの枠（2026-11-25）の数え方で数える */ if (!sn.exists) return null; const d = Object.assign({}, sn.data()); delete d.runAtTs; return d; }
      READS.race++; const x = await C.boatRace(id); return (x && x.hidden) || null; // Firebase の入口が見つからないとき: 窓口から（窓口が種を返す作りになっていれば届く）
    }
    const res = await fetch('/api/boat/race?id=' + encodeURIComponent(id) + '&watch=1', { cache: 'no-store' }); if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json(); return (j && j.hidden) || null;
  }
  function needHidden(r, t) {
    if (F.hid || F.hidBusy || !F.full || (r.status !== 'decided' && r.status !== 'done') || !r.runAt || t < r.runAt - 1000 || performance.now() - F.hidAt < 3000) return; // 決まりは 2 秒前から。時計のずれを見て 1 秒前から読む（早すぎて断られる読み取りを出さない）
    const id = r.id; F.hidBusy = true; F.hidAt = performance.now(); READS.hidden++;
    hiddenOf(id).then((h) => { if (F.id === id && h && h.seed != null) F.hid = h; }, () => {}).then(() => { F.hidBusy = false; });
  }
  /* 進路の計画（図のとき）: 映像の部品と同じ選び方（別の糸 Race.planPar。使えなければ画面の糸で少しずつ Race.planJob）＝テレビと同じ計画 */
  function planOf(race, run, desc, alive) {
    const Race = BOAT.Race;
    const main = () => new Promise((res) => { let g; try { g = Race.planJob(race, run, desc); } catch (e) { res(null); return; } const step = () => { if (!alive()) { res(null); return; } try { const t0 = performance.now(); for (;;) { const x = g.next(); if (x.done) { res(x.value); return; } if (performance.now() - t0 > 20) break; } } catch (e) { console.warn('plan', e); res(null); return; } setTimeout(step, 0); }; step(); });
    let par = null; try { par = Race.planPar(race, run, desc, alive, { units: 0 }); } catch (e) { par = null; }
    return par ? par.catch(() => (alive() ? main() : null)) : main();
  }
  async function build(r) {
    const id = r.id, gen = F.gen, okNow = () => F.id === id && F.gen === gen && !stopped, t0 = performance.now();
    F.building = true;
    try {
      await needParts(); if (!okNow()) return;
      const f = F.full, h = F.hid;
      // 店のテレビ（v2/tv-boat.js の startFilm）と同じ渡し方: 同じ model・同じ種と着順・同じ題
      const model = Object.assign({}, f.model, { exacta: f.exacta }, h.incident ? { incident: h.incident } : {}), run = Engine.replayRun(model, h.seed, { order: h.order });
      let desc = {}; try { desc = BoatModel.describe(model, h.seed, { swaps: run.swaps }); } catch (e) { desc = {}; }
      const info = { title: 'casa BOAT', sub: hm(r.at) + ' のレース', weather: model.weather2, odds: { exacta: f.exacta } };
      if (VIEW === '3d') {
        if (!F.R) {
          try { F.R = new BOAT.Race($('bwGl'), $('bwHud'), { level: LEVEL }); } catch (e) { noGl = true; throw e; }
          $('bwGl').addEventListener('webglcontextlost', (ev) => { try { ev.preventDefault(); } catch (x) { /* noop */ } noGl = true; });
        }
        const ok = await F.R.setRaceAsync(model, run, info, desc, { still: () => !F.ready }); // 準備の間は動く絵が無い ＝ 1 回に長く計算してよい
        if (ok === false || !okNow()) return;
      } else {
        const P = await planOf(model, run, desc, okNow); if (!okNow()) return;
        if (!P || !P.plan) throw new Error('進路を作れませんでした');
        const R = Object.create(BOAT.Race.prototype); R.adopt(model, P.run, info, P.desc, P.plan); R.tt = -BOAT.Race.PRE_T; R.live = false; R.state = null; F.R = R;
      }
      const used = F.R.run || run;
      F.runAt = h.runAt || r.runAt; F.order = used.finalOrder ? used.finalOrder() : run.finalOrder(); F.on = false; F.frozen = false; F.pitAt = -1e9; F.prepMs = Math.round(performance.now() - t0); F.ready = true;
    } catch (e) { if (okNow()) { F.err = String((e && e.message) || e); console.warn('casa BOAT watch', e); } }
    finally { if (F.gen === gen) F.building = false; }
  }
  function tryBuild(r) {
    if (F.ready || F.building || !F.full || !F.hid || noGl) return;
    const pn = performance.now(); if (pn - F.tryAt < (F.err ? 5000 : 250)) return; F.tryAt = pn;
    build(r);
  }
  /* 映像を時刻に合わせて 1 コマ進める。target ＝ サーバーの時刻から数えた映像の時刻（テレビと同じ式: 映像の始まり runAt の 100 秒あとが、大時計の 0 秒）。
     3D は映像の部品の syncTo（少しの遅れはその分だけ進める・大きなずれはその時刻へ切り替える）。図は時刻をそのまま入れて、艇の場所と順位を読む */
  function filmFrame(r, t) {
    const R = F.R, Race = BOAT.Race, target = (t - F.runAt) / 1000 - Race.PRE_T, pn = performance.now();
    if (t < F.runAt) { // 締切〜映像の前: ピットの止まった絵（1 秒 2 回だけ描く。テレビも同じ）
      F.on = false; if (pn - F.pitAt < 500) return; F.pitAt = pn;
      if (VIEW === '3d') R.seek(Race.PIT_T); else { R.live = false; R.tt = Race.PIT_T; R.state = R.stateAt(R.tt); drawMap(r); }
      F.frames++; return;
    }
    F.on = true;
    const official = r.status === 'done' && !!r.result;
    /* ゴール後の場面（2026-11-23 オーナー決定「ゴール後は競馬と同じ並び」: ゴール → リプレイ → 1 着 → 2 着 → 組番の帯。映像の終わりはゴールの 28 秒あと）:
       3D ＝ テレビと同じ映像なので、リプレイも大写しも同じ時刻に同じ絵（映像の部品の syncTo が出す）。
       図 ＝ 巻き戻さない。ゴールの見下ろしが終わる時刻（ふつうはゴールの 5 秒あと）の艇の場所で止めて、1着・2着の札を出したまま発表を待つ（競馬の「図で見る」と同じ: ゴールのあとは「ゴール」の札・着順の並びのまま発表まで） */
    if (VIEW === '3d') {
      if (R.done && (official || t > r.revealAt + 20000)) { F.frozen = true; return; } // 映像の終わりで止める。発表が届くまでは最後の絵（1 着と 2 着・組番の帯）のまま（テレビと同じ 20 秒まで）
      R.syncTo(target);
    } else {
      if (target >= R.endT && F.frozen) return;
      const tt = Math.min(target, R.endT), tm = R.post && tt > R.post.goalEnd ? R.post.goalEnd : tt; R.live = Math.abs(tt - R.tt) < 0.5; R.tt = tt;
      if (tm !== F.mapT || !MAP.w || !R.state) { F.mapT = tm; R.state = R.stateAt(tm); drawMap(r); } // 止めている間（ゴール後）は描き直さない（画面の大きさが変わった時だけ）
      if (target >= R.endT) F.frozen = true;
    }
    F.frames++;
  }
  // いまの場面（映像の部品の srcOf: 'live' 本番〜ゴールの見下ろし・'replay'・'win1'・'win2'・'pair'）。古い映像の部品（場面の無い版）では、いつも 'live'
  const sceneOf = (R) => { try { return R && R.srcOf ? R.srcOf(R.tt).k : 'live'; } catch (e) { return 'live'; } };
  /* いまの並び（映像の画面の順位の表示と同じ決め方 ＝ 映像の部品の shownOrder）。スタートの 2.1 秒あと（画面に順位が出る時刻）から、映像の終わりまで。
     返り値 { ord: 艇（0〜5）を先頭から, outs: 外れた艇（フライングの発表のあと・転覆のあと） } | null */
  function ranks() {
    const R = F.R; if (!F.ready || !F.on || !R || !R.state) return null;
    const tt = R.tt; if (tt < 2.1 || tt >= R.endT) return null;
    let ord = null;
    // ゴール後の場面（リプレイ・大写し）の間は着順のまま（ゴールの見下ろしの終わりの並び。3D はリプレイで絵が巻き戻るが、順位の表・「いま○位」は巻き戻さない）
    if (sceneOf(R) !== 'live' && R.rankState) { try { const s = R.rankState(); ord = s.ordV || s.ord; } catch (e) { ord = null; } }
    if (!ord) { try { ord = R.shownOrder(R.state); } catch (e) { ord = R.state.ordV || R.state.ord; } }
    const outs = []; for (let i = 0; i < R.n; i++) if (R.isOut(i, tt)) outs.push(i);
    return { ord: (ord || []).slice(), outs };
  }
  const incOf = () => { const R = F.R, inc = R && R.run && R.run.incident; return inc ? { boat: inc.horse, flying: inc.type === 'scratch' } : null; };

  /* ---------- 図（コースを真上から。寸法は boat/course.js ＝ 調査の数字のまま。スタンド側が下・1 マークが右 ＝ 公式の水面図と同じ向き） ---------- */
  const MAP = { cv: $('bwMap'), ctx: null, w: 0, h: 0, dpr: 1, bg: null, bgKey: '', u: 0 };
  const ZK = 1.7; // 奥行きは 1.7 倍に広げて見やすく（図だけ。競馬の図と同じ倍率）
  function mapView(u) { // u: 0 ＝ 水面の全部（ピットから。レース前）・1 ＝ レースで走る所（2 つのマークのまわり）
    const CO = BOAT.Course, A = { x0: CO.X_MIN - 6, x1: CO.X_MAX + 6, z0: CO.farZ(CO.X_MAX) - 6, z1: CO.shoreZ(CO.X_MIN) + 14 }, B = { x0: -208, x1: 208, z0: -(CO.RO + 12), z1: CO.shoreZ(CO.MARK2.x) - 2 };
    const L = (k) => A[k] + (B[k] - A[k]) * u, x0 = L('x0'), x1 = L('x1'), z0 = L('z0'), z1 = L('z1');
    const K = Math.min(MAP.w / (x1 - x0), MAP.h / ((z1 - z0) * ZK)), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    return { K, px: (x, z) => [MAP.w / 2 + (x - cx) * K, MAP.h / 2 + (z - cz) * K * ZK] };
  }
  function sizeMap() {
    const w = Math.max(120, stageW), h = Math.max(60, stageH);
    MAP.dpr = Math.min(2, window.devicePixelRatio || 1); MAP.w = w; MAP.h = h;
    MAP.cv.width = Math.round(w * MAP.dpr); MAP.cv.height = Math.round(h * MAP.dpr); MAP.ctx = MAP.cv.getContext('2d'); MAP.bgKey = '';
  }
  function drawCourse(u) {
    const key = MAP.w + 'x' + MAP.h + '|' + u.toFixed(3);
    if (MAP.bg && MAP.bgKey === key) return; MAP.bgKey = key;
    const bg = MAP.bg || (MAP.bg = document.createElement('canvas')); bg.width = MAP.cv.width; bg.height = MAP.cv.height;
    const g = bg.getContext('2d'), CO = BOAT.Course, V = mapView(u), P = V.px, FONT = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
    g.setTransform(MAP.dpr, 0, 0, MAP.dpr, 0, 0);
    g.fillStyle = '#31404a'; g.fillRect(0, 0, MAP.w, MAP.h); // 岸
    const poly = (pts, fillStyle) => { g.beginPath(); pts.forEach((q, i) => { const p = P(q[0], q[1]); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); g.fillStyle = fillStyle; g.fill(); };
    poly([[CO.X_MIN, CO.shoreZ(CO.X_MIN)], [CO.X_MAX, CO.shoreZ(CO.X_MAX)], [CO.X_MAX, CO.farZ(CO.X_MAX)], [CO.X_MIN, CO.farZ(CO.X_MIN)]], '#1f5f96'); // 競走水面（スタンド側の岸・対岸は斜め）
    poly([[CO.X_MIN, CO.shoreZ(CO.X_MIN)], [CO.X_MAX, CO.shoreZ(CO.X_MAX)], [CO.X_MAX, CO.shoreZ(CO.X_MAX) + 60], [CO.X_MIN, CO.shoreZ(CO.X_MIN) + 60]], '#c9d2dc'); // スタンド側
    const label = (t, x, z, col, dy, px) => { const p = P(x, z); g.font = '800 ' + (px || 10) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = 'rgba(6,20,36,.75)'; g.strokeText(t, p[0], p[1] + (dy || 0)); g.fillStyle = col; g.fillText(t, p[0], p[1] + (dy || 0)); };
    { const p = P(60, CO.shoreZ(60) + 7); g.fillStyle = 'rgba(40,52,66,.85)'; g.font = '800 10px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('スタンド', p[0], Math.min(MAP.h - 7, p[1] + 4)); }
    // スタート＝ゴールの線（センターポールと大時計を結ぶ線。映像の水面の線と同じ水色）と大時計
    { const a = P(0, 2), b = P(0, CO.shoreZ(0) - 1); g.strokeStyle = '#35d8ff'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); const c = P(CO.CLOCK.x, CO.CLOCK.z); g.fillStyle = '#1c1512'; g.beginPath(); g.arc(c[0], c[1] + 3, 4, 0, 7); g.fill(); g.strokeStyle = '#f08a1c'; g.lineWidth = 1.5; g.stroke(); }
    label('スタート・ゴール', 0, 0, '#bfefff', -9);
    // ターンマーク（赤と白）と名前
    [[CO.MARK1, '1マーク'], [CO.MARK2, '2マーク']].forEach(([m, t]) => { const p = P(m.x, m.z); g.fillStyle = '#e23b2e'; g.beginPath(); g.moveTo(p[0], p[1] - 7); g.lineTo(p[0] + 5, p[1] + 4); g.lineTo(p[0] - 5, p[1] + 4); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.fillRect(p[0] - 2.4, p[1] - 1.5, 4.8, 2); label(t, m.x, m.z, '#fff', 13); });
    if (u < 0.5) { const p = P(CO.PIT.x, CO.PIT.z + CO.PIT.gap * 2.5); g.globalAlpha = 1 - u * 2; g.fillStyle = '#8fa3b8'; g.fillRect(p[0] - 9, p[1] - 14, 5, 28); label('ピット', CO.PIT.x + 4, CO.PIT.z + CO.PIT.gap * 2.5, '#dfe7f3', 24); g.globalAlpha = 1; }
  }
  const boatsOf = (r) => (r && r.boats) || [];
  const boatOf = (r, i) => boatsOf(r)[i] || { no: i + 1, name: '', color: '#888', ink: '#fff' };
  let mineIdx = [];
  function drawMap(r) {
    if (!MAP.w || MAP.w !== Math.max(120, stageW) || MAP.h !== Math.max(60, stageH)) sizeMap();
    const R = F.ready ? F.R : null, tt = R ? R.tt : -100;
    const u = clamp((tt + 1) / 5, 0, 1), ue = u * u * (3 - 2 * u); // スタートの 1 秒前から 4 秒あとにかけて、走る所へ寄せる
    drawCourse(ue);
    const c = MAP.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, MAP.cv.width, MAP.cv.height); c.drawImage(MAP.bg, 0, 0); c.setTransform(MAP.dpr, 0, 0, MAP.dpr, 0, 0);
    if (!R || !R.state) return;
    const V = mapView(ue), S = R.state.S, n = S.length, rad = clamp(MAP.w / 50, 7, 12.5), FONT = 'system-ui, -apple-system, "Hiragino Sans", sans-serif';
    const rk = ranks(), ord = rk ? rk.ord : null, inc = incOf(), fin = R.run.finish || [];
    const idx = []; for (let i = 0; i < n; i++) idx.push(i);
    const rankOf = (i) => { const k = ord ? ord.indexOf(i) : -1; return k < 0 ? 99 : k; };
    idx.sort((a, b) => rankOf(b) - rankOf(a)); // 先頭を最後に（いちばん上に）描く
    /* 丸が重なるとき（図だけ）: 本物の間（1〜数 m）のままだと、小さな画面では丸が重なって番号が読めない → 重なった丸どうしを、結ぶ線の向きに半分ずつ押し広げて見せる（丸 1 つ分まで）。
       艇の本当の場所・時刻・順位はテレビと同じ（見せる丸の置き場だけ。競馬の図の「差を広げる」と同じ考え方）。いつも同じ順で計算するので、ちらつかない */
    const Q = {}; idx.forEach((i) => { const p = S[i]; if (p && p.on !== false) Q[i] = V.px(p.x, p.z); });
    { const L = Object.keys(Q).map(Number).sort((a, b) => a - b), need = rad * 2 + 1;
      for (let it = 0; it < 6; it++) for (let a = 0; a < L.length; a++) for (let b2 = a + 1; b2 < L.length; b2++) {
        const A2 = Q[L[a]], B2 = Q[L[b2]]; let dx = A2[0] - B2[0], dy = A2[1] - B2[1], d = Math.hypot(dx, dy); if (d >= need) continue;
        if (d < 0.01) { dx = 0; dy = L[a] < L[b2] ? -1 : 1; d = 1; } const k = Math.min(rad, (need - d) / 2) / d; A2[0] += dx * k; A2[1] += dy * k; B2[0] -= dx * k; B2[1] -= dy * k;
      } }
    const tags = {}; if (ord && ord.length) { if (fin[ord[0]]) { tags[ord[0]] = '1着'; if (ord[1] != null && fin[ord[1]]) tags[ord[1]] = '2着'; } else tags[ord[0]] = TX.lead; }
    idx.forEach((i) => {
      const p = S[i]; if (!p || p.on === false) return;
      const q = Q[i], b = boatOf(r, i), out = !!p.out, lead = ord && ord[0] === i, rr = lead ? rad * 1.2 : rad, mine = mineIdx.indexOf(i) >= 0;
      const hx = Math.cos(p.yaw), hz = -Math.sin(p.yaw) * ZK, hl = Math.hypot(hx, hz) || 1, dx = hx / hl, dy = hz / hl, wk = clamp((p.speed || 0) * 0.9, 0, 26) * V.K * 1.4;
      c.globalAlpha = out ? 0.45 : 1;
      if (wk > 2) { c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = Math.max(2, rr * 0.5); c.lineCap = 'round'; c.beginPath(); c.moveTo(q[0] - dx * rr, q[1] - dy * rr); c.lineTo(q[0] - dx * (rr + wk), q[1] - dy * (rr + wk)); c.stroke(); } // 航跡（速いほど長い）
      if (mine && !out) { c.beginPath(); c.arc(q[0], q[1], rr + 4.5, 0, 6.2832); c.fillStyle = 'rgba(255,216,74,.55)'; c.fill(); }
      c.beginPath(); c.moveTo(q[0] + dx * (rr + 5), q[1] + dy * (rr + 5)); c.lineTo(q[0] - dy * rr * 0.8, q[1] + dx * rr * 0.8); c.lineTo(q[0] + dy * rr * 0.8, q[1] - dx * rr * 0.8); c.closePath(); c.fillStyle = b.color; c.fill(); // 舳先（進む向き）
      c.beginPath(); c.arc(q[0], q[1], rr, 0, 6.2832); c.fillStyle = b.color; c.fill(); c.lineWidth = 1.2; c.strokeStyle = 'rgba(0,0,0,.6)'; c.stroke();
      c.fillStyle = b.ink; c.font = '900 ' + Math.round(rr * 1.25) + 'px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(b.no), q[0], q[1] + 0.5);
      const tag = out && inc && inc.boat === i ? (inc.flying ? 'Ｆ' : '転') : tags[i];
      if (tag) { c.globalAlpha = 1; c.font = '900 11px ' + FONT; const tw = c.measureText(tag).width + 10, y = q[1] - rr - 11; c.fillStyle = tag === '1着' || tag === TX.lead ? '#ffd84a' : '#dfe7f3'; c.beginPath(); if (c.roundRect) c.roundRect(q[0] - tw / 2, y - 8, tw, 16, 8); else c.rect(q[0] - tw / 2, y - 8, tw, 16); c.fill(); c.fillStyle = '#2a1c00'; c.fillText(tag, q[0], y + 0.5); }
      c.globalAlpha = 1;
    });
    if (mode === 'w-bot' && ord) { // 横向きのスマホ: 順位の表を出す場所が無いので、図の左上に順位の並びを描く
      let x = 8; const y = 14, s = 18;
      ord.forEach((i, k) => { const b = boatOf(r, i); if (k === 0) { c.fillStyle = '#ffd84a'; c.font = '900 11px ' + FONT; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('1位', x, y); x += 24; } c.fillStyle = b.color; c.fillRect(x, y - s / 2, s, s); c.strokeStyle = mineIdx.indexOf(i) >= 0 ? '#ffd84a' : 'rgba(0,0,0,.6)'; c.lineWidth = mineIdx.indexOf(i) >= 0 ? 2 : 1; c.strokeRect(x + 0.5, y - s / 2 + 0.5, s - 1, s - 1); c.fillStyle = b.ink; c.font = '900 13px ' + FONT; c.textAlign = 'center'; c.fillText(String(b.no), x + s / 2, y + 1); x += s + 4; });
    }
  }

  /* ---------- 自分の予想の行・順位の表・結果 ---------- */
  const chip = (r, i) => { const b = boatOf(r, i); return '<i class="wk" style="background:' + esc(b.color) + ';color:' + esc(b.ink) + '">' + esc(b.no) + '</i>'; };
  // 当たればもらえる額（投票ページ v2/boat-bet.js の payOf と同じ: 100 BPT × 倍率を 100 単位に切り上げ）
  const payOf = (r, k) => { const o = r && r.exacta && Number(r.exacta[k]); if (!(o > 0)) return 0; return Math.ceil(Math.max(10, Math.round(o * 10)) / 10 - 1e-9) * 100; };
  /* 自分の組番の一覧: 無料の 1 票が先頭、そのあと BPT で足した組番。同じ組番はまとめて「×N」 */
  function ticketsOf(v) {
    if (!v) return [];
    const out = [], at = {}, add = (k, n, free) => { if (!(n > 0)) return; if (at[k] == null) { at[k] = out.length; out.push({ k, n: 0, free: false, p: k.split('-').map(Number) }); } const x = out[at[k]]; x.n += n; if (free) x.free = true; };
    if (v.first != null && v.second != null) add(v.first + '-' + v.second, 1, true);
    const by = v.bets || {}; Object.keys(by).forEach((k) => add(k, Number(by[k]) || 0, false));
    return out;
  }
  /* 結果（発表された本物だけ）。映像が終わってから出す（テレビの結果の画面と同じころ）。返り値 null | { per: [{ x, hit, back, amount }], won, gain, capped, back, near, noPay, test, res } */
  function outcome(r, v, list, t) {
    const res = r.result; if (r.status !== 'done' || !res) return null;
    if (F.ready ? !(F.R && (F.R.done || F.frozen)) && t < r.revealAt + 20000 : t < r.revealAt + 1500) return null;
    const L = localResult(v, r) || { hit: 0, won: 0, gain: 0, capped: false, back: null }, inc = res.incident, all = res.bptBack === true, pay = res.noPay === true ? 0 : Number(res.pay) || 0;
    const per = list.map((x) => {
      const bn = x.n - (x.free ? 1 : 0), hitN = x.k === res.combo ? (x.free ? 1 : 0) + (all ? 0 : bn) : 0, back = (all && bn > 0) || !!(inc && inc.refund && x.p.indexOf(inc.boat) >= 0);
      return { x, hit: hitN > 0, back: !hitN && back, amount: hitN * pay };
    });
    const c = String(res.combo || '').split('-').map(Number), near = !(L.hit > 0) && list.some((x) => x.p[0] === c[0] || x.p[1] === c[1] || (x.p[0] === c[1] && x.p[1] === c[0]));
    return { per, hit: L.hit > 0, won: L.won, gain: L.gain, capped: L.capped, back: L.back, near, noPay: res.noPay === true, test: !!r.test, res, c };
  }
  const last = { lock: '', lines: null, hype: null, res: null, ord: null, tag: null, clk: null, hold: null, title: null };
  function setHtml(id, key, html) { if (last[key] === html) return false; last[key] = html; $(id).innerHTML = html; return true; }
  function lock(why) {
    const t = why === 'usage' ? [TX.usage, TX.usageSub] : why === 'nogl' ? [TX.noGl, TX.noGlSub] : why === 'load' ? [TX.loading, ''] : why === 'login' ? [TX.login, TX.loginSub] : why === 'over' ? [TX.over, TX.overSub] : why === 'void' ? [TX.voided, ''] : [TX.noVote, VIEW === 'map' ? TX.noVoteSubMap : TX.noVoteSub3d];
    const k = why + '|' + t[0];
    if (last.lock !== k) { last.lock = k; $('wLockT').textContent = t[0]; $('wLockS').textContent = t[1]; $('wLock').dataset.why = why; $('wLock').classList.add('show'); $('bwStage').classList.add('w-locked'); $('wMine').hidden = true; }
  }
  function unlock() { if (last.lock !== 'open') { last.lock = 'open'; $('wLock').classList.remove('show'); $('bwStage').classList.remove('w-locked'); $('wMine').hidden = false; } }
  const celeDone = {}; let celeT = 0;
  function hideCele() { const b = $('wCele'); if (!b.hidden) { b.hidden = true; b.innerHTML = ''; } }
  /* 結果の知らせ（短く。競馬と同じ）: 当たりは紙吹雪と「的中！ ○○BPT」、はずれは落ち着いた「おしい！」「ハズレ」。8 秒で閉じる（押しても閉じる） */
  function cele(r, oc) {
    const box = $('wCele'); clearTimeout(celeT);
    let h;
    if (oc.hit && !oc.noPay) {
      const cols = ['#ffd84a', '#ff5d5d', '#4fc3ff', '#7cff6b', '#ffffff', '#ff9bd6'];
      let cf = ''; for (let i = 0; i < 36; i++) cf += '<i style="left:' + ((i * 37) % 100) + '%;background:' + cols[i % cols.length] + ';animation-delay:' + ((i % 9) * 0.09).toFixed(2) + 's;animation-duration:' + (1.8 + (i % 5) * 0.25).toFixed(2) + 's"></i>';
      h = '<div class="cf" aria-hidden="true">' + cf + '</div><div class="box hit"><small>' + esc(TX.congrats) + '</small><b class="t">' + esc(TX.hit) + '</b><div class="am">' + amt(oc.gain) + '<small>BPT</small></div><span>' + esc(oc.test ? TX.test : oc.capped ? TX.capped : TX.claim) + '</span>';
    } else h = '<div class="box calm"><b class="t">' + esc(oc.hit ? TX.hit : oc.near ? TX.close : TX.miss) + '</b><span>' + (oc.noPay ? esc(TX.noPay) : esc(TX.result) + ' ' + chip(r, oc.c[0]) + '<em>→</em>' + chip(r, oc.c[1])) + '</span>';
    h += '<div class="bt"><button type="button" class="wbig" data-wact="back">' + esc(TX.backBig) + '</button><button type="button" class="wbig ghost" data-wact="cele">' + esc(TX.closeBtn) + '</button></div></div>';
    box.innerHTML = h; box.className = 'wcele' + (oc.hit && !oc.noPay ? ' hit' : ''); box.hidden = false;
    celeT = setTimeout(hideCele, 8000);
  }
  $('wUi').addEventListener('click', (e) => { const b = e.target.closest('[data-wact]'); if (!b) return; if (b.dataset.wact === 'back') goBack(); else if (b.dataset.wact === 'cele') hideCele(); });

  function renderUi(f, t) {
    const r = f.race, st = f.st, list = ticketsOf(f.v), R = F.ready ? F.R : null, tt = R && F.on ? R.tt : null;
    mineIdx = list.reduce((a, x) => a.concat(x.p), []);
    const rk = ranks(), oc = f.v ? outcome(r, f.v, list, t) : null, inc = incOf();
    // 場面の札と時計
    const official = r.status === 'done' && !!r.result, racing = F.ready && F.on;
    const sc = racing ? sceneOf(R) : 'live', tagRun = sc === 'live' ? TX.tagRace : sc === 'replay' && VIEW === '3d' ? TX.tagReplay : TX.tagGoal; // ゴール後: 3D のリプレイの間は「リプレイ」・大写しの間と図は「ゴール」
    const tag = st === 'vote' ? (r.closeAt - t <= 30000 ? [TX.tagLast, 'hot'] : [TX.tagVote, '']) : oc || (st === 'result' && official && (!F.ready || F.frozen)) ? [TX.tagDone, 'res'] : st === 'result' && !racing ? [TX.tagPend, ''] : racing ? [tagRun, 'live'] : [TX.tagClosed, 'hot'];
    setHtml('wTag', 'tag', '<span class="tag ' + tag[1] + '">' + esc(tag[0]) + '</span>');
    { const ph = oc ? 'res' : rk ? 'race' : 'pre'; if ($('wMine').dataset.ph !== ph) $('wMine').dataset.ph = ph; } // いまの段（横向きの細い帯は、段ごとに出す物をしぼる。boat-watch.css）
    setHtml('wTitle', 'title', esc(hm(r.at) + ' のレース') + (r.test ? '<small>テスト</small>' : ''));
    let clk = '';
    if (st === 'vote') clk = '<small>' + esc(TX.toClose) + '</small>' + left(r.closeAt - t);
    else if (racing && tt != null && tt < 0) clk = '<small>' + esc(TX.toStart) + '</small>' + left(-tt * 1000);
    else if (racing && tt != null && VIEW === 'map' && !oc) { const G = R.G, sec = clamp(tt, 0, G), LAPS = (window.BoatModel && BoatModel.LAPS) || 2, lead = R.state && R.state.lead, lap = lead ? clamp(Math.floor((lead.pos || 0) * LAPS) + 1, 1, LAPS) : 1; clk = '<small>' + esc(lap >= LAPS ? TX.lapLast : fill(TX.lap, { n: lap })) + '</small>' + Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60).toFixed(1); }
    setHtml('wClk', 'clk', clk);
    // 映像の枠の中の知らせ（映像がまだ無い間）
    const startAt = (F.runAt || r.runAt || 0) + 100000;
    const hold = F.ready && st !== 'vote' ? '' : noGl ? TX.noGl : st === 'vote' ? TX.holdOpen : !r.runAt || t < r.runAt ? TX.holdClosed : t < startAt ? fill(TX.holdSoon, { t: left(startAt - t) }) : TX.holdLate;
    setHtml('bwHold', 'hold', hold ? '<b>' + esc(hold) + '</b>' : '');
    // 順位の表: レース中はいまの順位・映像のあとは着順（発表された本物）・それより前は出走する艇の番号と名前。自分の予想の艇は金の枠
    let ord = '';
    const row = (lb, i, cls) => '<div class="r' + (cls || '') + (mineIdx.indexOf(i) >= 0 ? ' me' : '') + '">' + (lb ? '<b>' + lb + '</b>' : '') + chip(r, i) + '<span class="nm">' + esc(boatOf(r, i).name) + '</span></div>';
    if (oc && oc.res.order) { const ib = oc.res.incident ? oc.res.incident.boat : -1, fl = !!(oc.res.incident && oc.res.incident.type === 'scratch'); ord = oc.res.order.filter((i) => i !== ib).map((i, k) => row((k + 1) + '着', i, k === 0 ? ' lead' : '')).join('') + (ib >= 0 ? row(fl ? 'Ｆ' : '転', ib, ' out') : ''); }
    else if (rk) ord = rk.ord.map((i, k) => row((k + 1) + '位', i, k === 0 ? ' lead' : '')).join('') + rk.outs.map((i) => row(inc && inc.flying ? 'Ｆ' : '転', i, ' out')).join('');
    else ord = boatsOf(r).map((b, i) => row('', i, '')).join('');
    setHtml('wOrd', 'ord', ord);
    // 自分の予想の行（3 つまで＋ほか n 件。横向きの細い帯は 1 つ＋ほか n 件）
    const MAXL = mode === 'w-bot' ? 1 : short && list.length > 2 ? 2 : 3, posOf = (i) => (rk ? (rk.outs.indexOf(i) >= 0 ? (inc && inc.flying ? TX.flying : TX.fall) : fill(TX.now, { r: rk.ord.indexOf(i) + 1 })) : '');
    let lines = '';
    if (f.pending && !list.length) lines = '<div class="wv wait">' + esc(TX.loadingMine) + '</div>';
    // 結果のあとは、当たり → 返還 → はずれ の順に並べる（当たった組番が「ほか n 件」に隠れない。投票ページの結果の画面と同じ順）
    const rows = list.map((x, i) => ({ x, p: oc ? oc.per[i] : null, i })); if (oc) rows.sort((a, b) => (a.p.hit ? 0 : a.p.back ? 1 : 2) - (b.p.hit ? 0 : b.p.back ? 1 : 2) || a.i - b.i);
    rows.slice(0, MAXL).forEach((q, k) => {
      const x = q.x, p = q.p, lb = k === 0 ? TX.mine : '予想' + (k + 1), pay = payOf(r, x.k) * x.n;
      const pos = rk && !oc ? '<span class="pos"><b>' + esc(boatOf(r, x.p[0]).no) + '番</b> ' + esc(posOf(x.p[0])) + ' <b>' + esc(boatOf(r, x.p[1]).no) + '番</b> ' + esc(posOf(x.p[1])) + '</span>' : '';
      const cls = p ? (p.hit ? ' hit' : p.back ? ' back' : ' miss') : rk && rk.ord[0] === x.p[0] && rk.ord[1] === x.p[1] ? ' hot' : '';
      lines += '<div class="wv' + cls + '"><span class="k">' + esc(lb) + '</span><span class="cb"><small>1着</small>' + chip(r, x.p[0]) + '<em>→</em><small>2着</small>' + chip(r, x.p[1]) + (x.n > 1 ? '<small class="xn">×' + x.n + '</small>' : '') + '</span>' +
        (p ? '<span class="pt">' + (p.hit ? esc(TX.hit) + (oc.noPay ? '' : ' <b>' + amt(p.amount) + '</b>BPT') : p.back ? esc(TX.back) : esc(TX.miss)) + '</span>' : pay ? '<span class="pt">' + esc(TX.ifWin) + ' <b>' + amt(pay) + '</b>BPT</span>' : '') + pos + '</div>';
    });
    if (list.length > MAXL) lines += '<div class="wv more">' + esc(fill(TX.more, { n: list.length - MAXL })) + '</div>';
    setHtml('wLines', 'lines', lines);
    { const nv = String(Math.min(3, Math.max(1, Math.min(MAXL, list.length) + (list.length > MAXL ? 1 : 0)))); if ($('wLines').dataset.n !== nv) $('wLines').dataset.n = nv; }
    // 盛り上げ: 当たりの形！（どれかの組番の 1・2 着がいまの 1・2 位）／あと少し！（どちらかの艇が 2 位以内）
    let hype = '';
    if (rk && !oc && rk.ord.length >= 2) { const top = rk.ord.slice(0, 2), hot = list.some((x) => top[0] === x.p[0] && top[1] === x.p[1]), near = list.some((x) => top.indexOf(x.p[0]) >= 0 || top.indexOf(x.p[1]) >= 0); hype = hot ? '<b class="hb hot">' + esc(TX.hot) + '</b>' : near ? '<b class="hb near">' + esc(TX.near) + '</b>' : ''; }
    setHtml('wHype', 'hype', hype);
    // 結果
    let res = '';
    if (oc) {
      const bk = oc.back, bkTx = bk && (bk.n || bk.free) ? '<small class="bk">' + (bk.bpt > 0 ? esc(TX.back) + ' ＋' + amt(bk.bpt) + ' BPT' : esc(TX.back)) + '</small>' : '';
      res = '<div class="wr ' + (oc.hit && !oc.noPay ? 'hit' : 'calm') + '"><b>' + esc(oc.hit ? TX.hit : oc.near ? TX.close : TX.miss) + '</b>' +
        (oc.hit && !oc.noPay ? '<span class="am">' + amt(oc.gain) + '<small>BPT</small></span>' + (oc.capped ? '<small class="cp">' + esc(TX.capped) + '</small>' : '') : oc.noPay ? '<span class="rs">' + esc(TX.noPay) + '</span>' : '<span class="rs">' + esc(TX.result) + ' ' + chip(r, oc.c[0]) + '<em>→</em>' + chip(r, oc.c[1]) + '</span>') + bkTx + (oc.test ? '<small class="tst">' + esc(TX.test) + '</small>' : '') + '</div>';
      res += '<button type="button" class="wbig" data-wact="back">' + esc(TX.backBig) + '</button>';
      if (!celeDone[r.id]) { celeDone[r.id] = true; cele(r, oc); }
    }
    setHtml('wRes', 'res', res);
  }

  /* ---------- 1 コマ（1 秒 30 回まで）と字（1 秒 5 回） ---------- */
  let rafId = 0, lastDraw = 0, lastUi = 0, shownCanvas = '', partsAt = -1e9;
  const PERF = { ms: 0, n: 0, max: 0 }; // 1 コマを描くのにかかった時間（確かめ用。BoatWatch.perf）
  function showCanvas(k) { if (shownCanvas === k) return; shownCanvas = k; $('bwFit').hidden = k !== '3d'; $('bwMap').hidden = k !== 'map'; }
  function tick(ts) {
    if (noGl && VIEW === '3d') { if (!switching) { switching = true; switchView('map'); } return; } // 3D が使えない端末・絵の記憶を失ったとき: 図の表示へ（図は 3D の部品を使わない）
    const f = pickFocus();
    if (!f.race) { focus = null; lock(f.why); hideCele(); if (f.why !== 'load') showCanvas(''); return; }
    focus = f; ever = true; unlock();
    const r = f.race, t = now();
    resetFilm(r.id);
    if (!partsP && ts - partsAt > 3000) { partsAt = ts; needParts().catch(() => {}); } // 開いたらすぐ読み始める（締切のころには読み終わっている）。読めなかったら 3 秒あけて読み直す
    needFull(r); needHidden(r, t); tryBuild(r);
    if (F.ready && f.st !== 'vote') { showCanvas(VIEW); const p0 = performance.now(), n0 = F.frames; try { filmFrame(r, t); } catch (e) { F.err = String(e && e.message); console.error('casa BOAT watch', e); } if (F.frames !== n0) { const d = performance.now() - p0; PERF.ms += d; PERF.n++; if (d > PERF.max) PERF.max = d; } }
    else if (VIEW === 'map' && partsP && window.BOAT && BOAT.Course) { showCanvas('map'); if (ts - lastUi >= 200) drawMap(r); } // 図: 映像の前はコースの絵だけ
    else showCanvas('');
    if (ts - lastUi < 200) return; lastUi = ts;
    renderUi(f, t);
  }
  let switching = false;
  function frame(ts) {
    rafId = 0; if (stopped) return;
    rafId = requestAnimationFrame(frame);
    if (ts - lastDraw < 1000 / FPS - 3) return; lastDraw = ts;
    try { tick(ts); } catch (e) { console.error('casa BOAT watch', e); }
  }
  /* 閉じるとき: 見張りを止め、3D の絵の記憶（WebGL）もすぐ手放す（競馬の __derbyWatchStop と同じ。投票ページが窓を閉じるときに呼ぶ） */
  function stop() {
    if (stopped) return; stopped = true;
    if (rafId) cancelAnimationFrame(rafId); rafId = 0;
    if (unWatch) { try { unWatch(); } catch (e) { /* noop */ } unWatch = null; }
    try { const R = F.R; if (R && R.renderer) { const rr = R.renderer; R.dispose(); if (rr.forceContextLoss) rr.forceContextLoss(); } else if (R && R.cancelPrep) R.cancelPrep(); } catch (e) { /* noop */ }
  }
  window.__boatWatchStop = stop; window.addEventListener('pagehide', stop);
  window.addEventListener('resize', fit);

  window.BoatWatch = {
    view: VIEW, level: LEVEL, fps: FPS, inBet: IN_BET, C, now, TX, layout: fit, stop, reads: READS,
    get focus() { return focus; }, get mode() { return mode; }, get noGl() { return noGl; }, pickFocus, ranks, ticketsOf,
    get film() { const R = F.R; return { id: F.id, ready: F.ready, on: F.on, frozen: F.frozen, runAt: F.runAt, order: F.order, tt: R && F.ready ? R.tt : null, done: !!(R && F.ready && R.tt >= R.endT), endT: R && F.ready ? R.endT : null, shot: R && R.shot, level: R && R.level, parts: R && R.parts, size: R && R.renderer ? [R.renderer.domElement.width, R.renderer.domElement.height] : null, frames: F.frames, prepMs: F.prepMs, err: F.err, full: !!F.full, hid: !!F.hid }; },
    get R() { return F.R; },
    perf(reset) { const o = { frames: PERF.n, avgMs: PERF.n ? PERF.ms / PERF.n : 0, maxMs: PERF.max }; if (reset) { PERF.ms = 0; PERF.n = 0; PERF.max = 0; } return o; }, // 描いたコマの数・1 コマの平均と最長（ms）
    /* 確かめ用（tests/boat-watch.plan.js）: 自分の票を好きな中身にして描かせる（結果の知らせも出し直す）。引数なしで本物に戻す。置き場には何も書かない */
    preview(v) { pv = arguments.length ? v : undefined; Object.keys(celeDone).forEach((k) => { delete celeDone[k]; }); hideCele(); lastUi = 0; return pv; },
  };
  fit();
  if (!C || !Boat) { lock('novote'); return; }
  rafId = requestAnimationFrame(frame);
})();
