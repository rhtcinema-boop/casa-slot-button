/* 店のテレビの casa BOAT（2026-11-19）: 競馬のテレビのページ（ルートの index.html ＋ v2/tv.js）の中で、ボートの投票〜映像〜結果を重ねて出す。ページは移らない（読み込み直し＝競馬のレースの一覧の読み直しをしない）。
   流れ（時刻は v2/boat-core.js の timesOf）: 投票（openAt〜closeAt。QR・出走表・参加人数 15 秒ごと）→ 締切（closeAt〜runAt の 6 秒。出走表とブザー）→ 映像（runAt から。ピット離れ 100 秒＋走り＋ゴール後 8 秒。
     boat/race-boat.js の BOAT.Race をそのまま使う。艇の動き・音の中身は変えない）→ 結果（revealAt〜endAt の 2 分。確定の組番・払戻・当たった人の名前）→ 競馬の画面に戻る。
   競馬の画面は下に残したまま（受け取り待ちの結果画面も、ボートが終われば元のとおり見える）。ボートの間は競馬の 3D を一切描かない（待機は js/race3d.js の boatHold、リプレイは v2/tv.js の DERBY.boatHold が止める。
     2026-11-20）・受け取り待ちの声も出さない（tv.js の DERBY.hold）。競馬の結果画面の最初の 2 分は、ボートの投票待ち・投票受付中の画面を出さない。
   競馬のレースを流している間（投票・レース）はボートを出さない（時刻表で被らないようにしてあるが、念のため競馬が勝つ）。
   見張り: いまの状態 boatLive/all（変わったときだけ）と、投票中だけ参加人数 boatCounts/live（15 秒ごと）。QR の合言葉はレースごとに 1 回だけ読む。 */
(function () {
  'use strict';
  const QS = location.search, MUTE = /[?&]mute=1/.test(QS);
  const STORE = decodeURIComponent((QS.match(/[?&]store=([^&#]+)/) || [])[1] || '');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const BOATTV = (window.BOATTV = { active: false, stage: '', race: null, log: [], err: '' });
  /* B.want: いま欲しい映像（'tj:<レース>' ＝ スタート展示・'film:<レース>' ＝ 本番・'' ＝ なし）。毎コマ loop が決める。映像の準備（待ちが入る）は、待ちのあとでこれが変わっていないか必ず確かめる（2026-11-20 F2）
     B.q: 映像の準備の列（1 つずつ。展示と本番は同じ B.R を使う）。B.snd: ボートの音を鳴らしている（映像をやめる所で必ず止める。D5） */
  const B = { C: null, live: null, race: null, full: {}, fetchAt: {}, key: {}, count: null, R: null, film: null, tj: null, loading: null, lastFrame: 0, scripts: false, resKey: '', voteId: '', want: '', q: null, snd: false, sndAt: 0, tryAt: 0, tjTryAt: 0, nTry: 0, nPrep: 0, nSkip: 0, nSeek: 0 };
  const Boat = () => window.BoatCore;
  const now = () => (B.C && B.C.serverNow ? B.C.serverNow() : Date.now());
  const hm = (ms) => (window.DerbyCore ? DerbyCore.fmtBizTime(ms, 5) : new Date(ms).toTimeString().slice(0, 5));
  const left = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ME = (document.currentScript && document.currentScript.src) || '';
  const ROOT = ME ? ME.replace(/v2\/[^/#?]*([?#].*)?$/, '') : '';
  /* 版の印（2026-11-20）: 自分（tv-boat.js?v=…）の印を、あとから読むボートの部品にも付ける（v2/client.js と同じやり方）。index.html が、競馬のテレビ（v2/tv.js）と同じ印
     （公開のたびに変わる印＋管理画面の「テレビを読み込み直す」の印 _r）を付けてくれるので、公開・読み込み直しのたびに古いファイル（キャッシュ）を使わない（前は ?v=b1 の決め打ちで古いままだった） */
  const VQ = '?v=' + ((/[?&]v=([^&#]+)/.exec(ME) || [])[1] || 'b2');
  function load(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = ROOT + src; s.async = false; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); }); }
  async function needCore() { if (!window.DerbyCore) await load('v2/core.js' + VQ); if (!window.BoatCore) await load('v2/boat-core.js' + VQ); }
  // 映像の部品（初めて使うときに 1 回だけ読む。three.js・js/engine.js はテレビのページにもうある）
  function needFilm() {
    if (!B.loading) B.loading = (async () => {
      const L = ['js/boat-model.js', 'boat/course.js', 'boat/boat3d.js', 'boat/venue3d.js', 'boat/lines.js', 'boat/race-boat.js', 'boat/announce-boat.js', 'boat/fanfare-boat.js', 'boat/sound.js'];
      for (const u of L) { if (u.indexOf('boat-model') >= 0 && window.BoatModel) continue; await load(u + VQ); }
      return true;
    })().catch((e) => { B.loading = null; BOATTV.err = String(e.message || e); throw e; });
    return B.loading;
  }
  /* 画面の字は「変わったときだけ」書き換える（2026-11-20: 前は毎コマ同じ字を書き直していて、映像中に 1 秒 180 回の書き換えになっていた）。el.__s に最後に書いた中身を覚える */
  const setT = (el, s) => { if (el && el.__s !== s) { el.__s = s; el.textContent = s; } };
  const setH = (el, s) => { if (el && el.__s !== s) { el.__s = s; el.innerHTML = s; } };
  const hide = (el, on) => { on = !!on; if (el && el.hidden !== on) el.hidden = on; };

  /* ---------- 画面の部品 ----------
     2026-11-19 オーナー「投票待ち画面、テレビ・スマホ共に終わってる。競馬の感じをかなり参考に」「映像とかはスタート展示流しておけばいい」:
     競馬のテレビ（v2/tv.js の待ち時間・投票受付中）と同じ作り＝上の札の列・左上に映像の枠・右に出走表・左下にカウントダウン・中に人気の組番・右下に QR。
     映像の枠には本物の「スタート展示」（ピット離れ → 進入 → スタートライン。ref/boat/research/28_スタート展示.md）を流す。
     スタート展示は本番とは別の種で走らせる短い走り（当たりの決め方には一切つながない＝本番の結果の手がかりにならない）。 */
  const stage = $('stage');
  const ov = document.createElement('div'); ov.id = 'boatOv'; ov.hidden = true;
  ov.innerHTML = '<div class="bo-top"><span class="bo-pill st" id="boPill"></span><span class="bo-pill tm" id="boTime"></span><span class="bo-pill pr" id="boPromo">無料で 1 票</span><span class="bo-pill ct" id="boCnt" hidden></span><b class="bo-logo">casa <i>BOAT</i></b><span class="bo-pill sn" id="boStore"></span></div>' +
    '<section id="boVote" class="bo-vote" hidden>' +
      '<div class="bo-panel bo-vid" id="boVid"><div class="bo-vfit" id="boVfit"></div><div class="bo-st" id="boSt" hidden></div><div class="bo-how" id="boHow" hidden></div></div>' +
      '<div class="bo-panel bo-card2" id="boCardP"><h3>出走表</h3><div id="boCardT"></div></div>' +
      '<div class="bo-panel bo-cd" id="boCd"></div>' +
      '<div class="bo-panel bo-popp" id="boPopP"><h3>人気の組番 <small>2連単</small></h3><div id="boPop"></div></div>' +
      '<div class="bo-panel bo-qrp" id="boQrP"><h3>アプリ不要 スマホで参加</h3><div class="bo-qr" id="boQr"><span>QR を準備中…</span></div><p class="bo-qrc" id="boQrc">無料で 1 票・当たりは BPT</p></div>' +
    '</section>' +
    '<section id="boFilm" class="bo-film" hidden><div class="bo-fit" id="boFit"><canvas id="boGl" width="1000" height="480"></canvas><canvas id="boHud" width="1000" height="480"></canvas><div id="boCard" class="bo-card" hidden></div></div></section>' +
    '<section id="boRes" class="bo-res" hidden></section>' +
    '<section id="boVoid" class="bo-void" hidden><h2>このボートレースは取り消しました</h2><p>BPT の券に使った BPT は全部戻しました</p></section>';
  if (stage) stage.appendChild(ov);
  const show = (id) => ['boVote', 'boFilm', 'boRes', 'boVoid'].forEach((x) => hide($(x), x !== id));
  const boatsOf = (r) => (r && (r.boats || (Boat() && r.model && Boat().boatsOf(r)))) || [];
  const waku = (b, cls) => '<i class="bo-waku ' + (cls || '') + '" style="background:' + b.color + ';color:' + b.ink + '">' + b.no + '</i>';
  const TYPES = { nige: '逃げ', senko: 'まくり', sashi: '差し', oikomi: 'まくり差し' };
  // 映像の絵（canvas）は 1 組だけ。スタート展示の枠と本番の映像の枠の間で入れ替える（3D を 2 つ動かさない＝Fire TV を重くしない）
  /* 2026-11-21 I1: 並びは必ず「映像の絵 → 字の絵 → 出走表の板」（後ろほど手前）。前は展示の枠から戻すとき、字の絵（boHud）が出走表の板（boCard）の手前に入り、締切の出走表の上に映像の字が重なっていた。
     並びが合っているときは何もしない（毎コマ呼ばれる。部品を動かし直さない） */
  function putCanvas(where) {
    const box = where === 'vid' ? $('boVfit') : $('boFit'), gl = $('boGl'), hud = $('boHud'), card = $('boCard'), ref = card && card.parentNode === box ? card : null;
    if (gl.parentNode === box && hud.parentNode === box && gl.nextSibling === hud && hud.nextSibling === ref) return;
    box.insertBefore(gl, ref); box.insertBefore(hud, ref);
  }
  /* 2026-11-21 I4: 映像の絵（boGl・boHud）は「いまの場面の映像の準備ができているときだけ」見せる（#boatOv の印 bo-ready。tv-boat.css が隠す）。
     前は次のレースの投票が前の結果の途中で始まると、展示の枠に前のレースの最後の絵が残っていた */
  const setReady = (on) => { on = !!on; if (ov.__ready !== on) { ov.__ready = on; ov.classList.toggle('bo-ready', on); } };
  // 準備を打ち切る（映像の係の入口 cancelPrep があれば使う。無ければ準備の印 prepJob を外す＝setRaceAsync は次の区切りで「捨てられた」で終わる）
  function dropPrep() { const R = B.R; if (!R) return; try { if (typeof R.cancelPrep === 'function') R.cancelPrep(); else if (R.prepJob) R.prepJob = null; } catch (e) { /* noop */ } }
  /* いまは動かない場面か（映像の係への知らせ。setRaceAsync の opt.still ＝ この関数。映像の係は毎回これを見て、動かない場面では 1 回に長く（40ms）計算する。ref/boat/opId_の使い方.md の末尾）: B.R の絵を動かしていない（展示も本番もまだ）＝画面は字だけ。
     このときは準備を 1 回に長く進めてよい（字は 1 秒に 1 回しか変わらない） */
  const stillNow = () => !ov.__ready || !BOATTV.active;

  // 出走表（競馬の出馬表と同じ並び: 枠・名前・得意・調子・近走）
  function cardTable(r, full) {
    const hs = (full && full.model && full.model.horses) || [], bs = boatsOf(r);
    return '<div class="bo-ct"><div class="hd"><span></span><span>選手</span><span>級</span><span>得意</span><span>調子</span><span>近3走</span></div>' + bs.map((b, i) => { const h = hs[i] || {}, cd = h.cond || null, past = (b.past || []).slice(0, 3);
      return '<div class="rw"><i class="bar" style="background:' + b.color + '"></i>' + waku(b) + '<b class="nm">' + esc(b.name) + '</b><span class="cl">' + esc(b.cls || '') + '</span><span class="ty">' + esc(TYPES[b.type] || '') + '</span><span class="cn">' + (cd ? '<b>' + esc(cd.mark) + '</b><small>' + esc(cd.label) + '</small>' : esc(b.cond || '')) + '</span><span class="ps">' + past.map((p) => '<i class="p' + (p <= 3 ? p : 'x') + '">' + p + '</i>').join('') + '</span></div>'; }).join('') + '</div>';
  }
  function popular(r) {
    const ex = r.exacta || {}, cnt = (B.count && B.count.raceId === r.id && B.count.combos) || {};
    const ks = Object.keys(ex).sort((a, b) => (cnt[b] || 0) - (cnt[a] || 0) || ex[a] - ex[b]).slice(0, 6), bs = boatsOf(r);
    return ks.map((k, i) => { const p = k.split('-').map(Number); return '<div class="pr"><span class="rk">' + (i + 1) + '</span>' + waku(bs[p[0]] || { no: p[0] + 1, color: '#888', ink: '#fff' }, 'sm') + '<b class="ar">▶</b>' + waku(bs[p[1]] || { no: p[1] + 1, color: '#888', ink: '#fff' }, 'sm') + '<span class="od">' + (Math.round(ex[k] * 10) / 10).toFixed(1) + '<small>倍</small></span></div>'; }).join('');
  }
  let storeNm = '';
  function renderVote(r, wait, t) {
    const key = r.id + (wait ? 'w' : 'v');
    if (B.voteId !== key) {
      B.voteId = key; B.popKey = '';
      $('boVote').className = 'bo-vote ' + (wait ? 'is-wait' : 'is-vote');
      // QR はレースごと: 次のレースに変わったら、前のレースの QR をすぐ消して「準備中」にする（2026-11-20 F8: 合言葉を読む間、前のレースの QR が残っていた＝読むと「読み直してください」になる）
      if (B.qrFor !== r.id) { B.qrFor = r.id; BOATTV.qr = ''; setH($('boQr'), '<span>QR を準備中…</span>'); qrFor(r); }
    }
    // 出走表: レースが変わったとき・くわしい中身（調子の言葉）が届いたときに描き直す（2026-11-20 F7: 「届いた」の印が前のレースのまま残り、2 レース目からは描き直さなかった）
    const full = B.full[r.id] || null, ck = r.id + (full && full.model ? '+' : '-');
    if (B.cardKey !== ck) { B.cardKey = ck; setH($('boCardT'), cardTable(r, full)); }
    // 字は 1 秒に 1 回（残り時間が変わったとき）と、参加人数が届いたときだけ組み直す（毎コマは何もしない）
    const c = B.count && B.count.raceId === r.id ? B.count : null, sec = Math.max(0, Math.ceil(((wait ? r.openAt : r.closeAt) - t) / 1000)), sig = key + '|' + sec + '|' + storeNm;
    if (B.voteSig === sig && B.voteC === c) return; B.voteSig = sig; B.voteC = c;
    setT($('boPill'), wait ? '● 次のボートレース' : '● 投票受付中'); $('boPill').classList.toggle('on', !wait);
    setT($('boTime'), hm(r.at) + ' 締切');
    setT($('boStore'), storeNm || STORE);
    hide($('boCnt'), wait || !c); if (c) setH($('boCnt'), '全店で <b>' + c.total + '</b> 人参加');
    if (wait) setH($('boCd'), '<div class="l"><span class="k">次のボートレース</span><div class="lt"><b class="big">' + hm(r.at) + '</b><span class="u">締切</span></div></div><div class="r"><span class="k2">投票は ' + hm(r.openAt) + ' から</span><span class="k3">投票開始まで あと</span><b class="cd">' + left(r.openAt - t) + '</b></div>');
    else setH($('boCd'), '<span class="k">締切まで あと</span><b class="cd">' + left(r.closeAt - t) + '</b><span class="h">スマホで<br>1着・2着を選ぶ</span>');
    $('boCd').classList.toggle('last', !wait && r.closeAt - t <= 30000);
    if (!wait && (B.popKey !== r.id || B.popC !== c)) { B.popKey = r.id; B.popC = c; setH($('boPop'), popular(r)); } // 人気の組番: レースが変わったとき・参加人数（15 秒ごと）が届いたとき
    setH(B.qrH3 || (B.qrH3 = $('boQrP').querySelector('h3')), wait ? 'アプリ不要<br>スマホで参加' : 'アプリ不要 スマホで参加');
    setT($('boQrc'), wait ? '投票は ' + hm(r.openAt) + ' から' : '無料で 1 票・当たりは BPT');
  }
  async function qrFor(r) {
    try {
      const k = B.key[r.id] || (B.key[r.id] = await B.C.boatKey(r.id));
      const base = (window.DerbyQR && DerbyQR.joinURL ? DerbyQR.joinURL(STORE) : location.origin + '/v2/bet.html?store=' + STORE).split('?')[0].replace(/bet\.html$/, 'boat.html');
      const url = Boat().joinURL(base, STORE, r.id, k.code);
      const svg = await DerbyQR.svg(url, { size: 300, margin: 2, ecl: 'M' });
      if (B.qrFor === r.id && $('boQr')) { BOATTV.qr = url; setH($('boQr'), svg); } // 待っている間に次のレースへ変わっていたら書かない
    } catch (e) {
      BOATTV.err = 'qr ' + (e && e.message); delete B.key[r.id];
      if (B.qrFor !== r.id) return;
      if (e && (e.code === 'tv_only' || e.status === 403)) { setH($('boQr'), '<span>このテレビは QR を出せません<br>（テレビ用アカウントでログインしてください）</span>'); return; } // 読めないテレビは読み直さない（読み取りを増やさない）
      setTimeout(() => { if (B.qrFor === r.id) qrFor(r); }, 10000);
    }
  }

  /* ---------- スタート展示（投票待ち・投票中の映像の枠） ----------
     本物の流れ（研究 28）: ピット離れ → 進入（コース取り）→ スタートラインへ（ST を計る）。展示の ST は「.09」の形（フライングは F）。
     ここでは 1 回 約 40 秒: ピット離れ（12 秒）→ 大時計の 22 秒前から助走してスタートライン（スタートの 3 秒あとで切る）→ 展示の ST の札（8 秒）→ くり返し。
     種は「レース id ＋ 'tenji'」（本番の種とは別。決める係の計算とつながらない）。描くのは 1 秒 20 コマまで（Fire TV を重くしない）。音は出さない */
  const TJ_SEG = [[-100, -88], [-22, 3]], TJ_ST = 8;
  /* 映像の準備（進路の計算。重い・待ちが入る）は 1 つずつ（2026-11-20 F2）。展示と本番は同じ B.R を使い、進路の計算（BOAT.Lines）は同時に 2 つ走らせられない。
     自分の番が来たとき・終わったときに「まだその映像が欲しいか（B.want）」を確かめ、ちがえば何も書かずにやめる（古い準備が後から割り込んで、展示と本番が混ざらない）。
     映像の係の「画面を止めずに準備する入口」（BOAT.Race の setRaceAsync）があればそれを使い、無ければ今までの setRace（どちらでも動く） */
  function prep(key, args, before) {
    const job = async () => {
      if (B.want !== key) { B.nSkip++; return false; }
      B.tj = null; B.film = null; hide($('boSt'), true); hide($('boHow'), true); // ここから B.R の中身が入れ替わる（終わるまで展示も本番も「無い」）
      if (before) before();
      B.nPrep++; B.prepKey = key;
      const R = B.R, a = args.slice(); if (R.setRaceAsync) { a[4] = Object.assign({}, a[4] || {}, { still: stillNow }); }
      const out = (R.setRaceAsync || R.setRace).apply(R, a);
      let ok; try { ok = out && typeof out.then === 'function' ? await out : true; } finally { if (B.prepKey === key) B.prepKey = ''; } // setRaceAsync は、入れ替えたら true・捨てられたら false を返す
      return ok !== false && B.want === key;
    };
    const p = (B.q || Promise.resolve()).then(job, job); B.q = p.catch(() => {});
    return p;
  }
  async function tjStart(r) {
    const key = 'tj:' + r.id, f = B.full[r.id]; if (!f || !f.model) return false;
    await needFilm(); if (B.want !== key) return false;
    needR();
    const model = Object.assign({}, f.model), seed = Engine.hashSeed('boat-tenji', r.id), run = Engine.replayRun(model, seed);
    let desc = {}; try { desc = BoatModel.describe(model, seed); } catch (e) { desc = {}; }
    if (!(await prep(key, [model, run, { title: 'casa BOAT', sub: 'スタート展示', weather: model.weather2 }, desc], () => putCanvas('vid')))) return false;
    B.tj = { id: r.id, seg: 0, t: 0, acc: 0, desc: B.R.desc || desc, boats: boatsOf(r) };
    B.R.seek(TJ_SEG[0][0]);
    return true;
  }
  function stBoard(T) {
    const d = T.desc || {}, entry = d.entry || [0, 1, 2, 3, 4, 5], st = d.st || [];
    const fmt = (s) => (s == null ? '' : s < 0 ? 'F.' + String(Math.round(-s * 100)).padStart(2, '0') : '.' + String(Math.round(s * 100)).padStart(2, '0'));
    return '<h4>スタート展示</h4><div class="sth"><span>コース</span><span>艇</span><span>ST</span></div>' + entry.map((b, c) => '<div class="str"><span class="c">' + (c + 1) + '</span>' + waku(T.boats[b] || { no: b + 1, color: '#888', ink: '#fff' }, 'sm') + '<b>' + fmt(st[b]) + '</b></div>').join('') + '<p>展示の ST は本番とちがうことがあります</p>';
  }
  /* 遊び方の画面（2026-11-20 オーナー「投票待ちの間に、スタート展示と交互に遊び方の画面を数秒ずつ」）: 展示の ST の札のあとに 2 枚を 6 秒ずつ。文言は ref/boat/説明の文言_2026-11-20.md */
  const HOW = [
    '<h4>casa BOAT のあそびかた</h4><div class="hw"><b>1</b><div><em>テレビの QR をスマホで読む</em><small>今日の競馬に会計番号で参加したスマホなら、無料で 1 票</small></div></div>' +
      '<div class="hw"><b>2</b><div><em>1着と2着を、順番に当てる</em><small>6 艇から 2連単。BPT 100 でボートの券も足せます</small></div></div>' +
      '<div class="hw"><b>3</b><div><em>当たりは BPT</em><small>100 BPT × 倍率。スマホに自動で入ります</small></div></div>',
    // 2026-11-20 オーナー決定: BPT は 3,000 を超えて貯められない（当たりで超える分は 3,000 で止まる）→ 1 行足した。数は bptMax()（下）
    () => '<h4>BPT は競馬の券に使えます</h4><div class="big"><span class="c">100<small>BPT</small></span><span class="ar">▶</span><span class="t">競馬の券 1 枚</span></div>' +
      '<p class="l">無料の券と合わせて 1 レース 5 枚まで</p><p class="l">貯められる BPT は ' + amt(bptMax()) + ' まで</p><p class="l">BPT は毎週月曜の朝 5 時にリセット</p>',
  ], HOW_SEC = 6;
  const howHtml = (i) => (typeof HOW[i] === 'function' ? HOW[i]() : HOW[i]);
  /* BPT の持ち上限（2026-11-20 オーナー決定「3,000 まで」）。数の置き場は v2/core.js の BPT_MAX（お金の係）。読めなければ 3,000 */
  const bptMax = () => { const v = Number((window.DerbyCore && DerbyCore.BPT_MAX) || (Boat() && Boat().BPT_MAX)); return v > 0 ? v : 3000; };
  function tjFrame(dt) {
    const T = B.tj, R = B.R; if (!T || !R) return;
    T.t += dt;
    if (T.seg < TJ_SEG.length) {
      const [a, b] = TJ_SEG[T.seg];
      if (R.tt >= b) { T.seg++; if (T.seg < TJ_SEG.length) R.seek(TJ_SEG[T.seg][0]); else { T.stT = 0; setH($('boSt'), stBoard(T)); hide($('boSt'), false); } return; }
      T.acc += dt; if (T.acc < 1 / 20) return; // 1 秒 20 コマ
      R.tick(T.acc); T.acc = 0; void a;
    } else {
      T.stT += dt;
      const hi = T.stT < TJ_ST ? -1 : Math.floor((T.stT - TJ_ST) / HOW_SEC);
      if (hi >= 0 && hi < HOW.length) { if (T.howI !== hi) { T.howI = hi; hide($('boSt'), true); setH($('boHow'), howHtml(hi)); $('boHow').className = 'bo-how h' + hi; hide($('boHow'), false); } }
      else if (hi >= HOW.length) { hide($('boSt'), true); hide($('boHow'), true); T.howI = -1; T.seg = 0; R.seek(TJ_SEG[0][0]); }
    }
  }
  /* 画質（2026-11-22 オーナー「画質を選べるようにしたい」）: 管理画面のボートの設定（boatLive/all の q。'low' ＝ 軽い）。アドレスの ?boatq=low / ?boatq=high があればそちら。
     設定が変わったら、次の映像（スタート展示・本番）を始めるときに作り直す（映像の途中では変えない） */
  const wantQ = () => (/[?&]boatq=low\b/.test(QS) ? 'low' : /[?&]boatq=high\b/.test(QS) ? 'high' : B.live && B.live.qs && (B.live.qs[STORE] === 'low' || B.live.qs[STORE] === 'high') ? B.live.qs[STORE] : B.live && B.live.q === 'low' ? 'low' : 'high'); // qs: 店ごとの画質（管理画面のボートの「テレビ」。2026-11-22）
  function needR() { if (B.R && B.R.quality !== wantQ()) { try { B.R.dispose(); } catch (e) { /* 作り直す */ } B.R = null; B.tj = null; B.film = null; } if (!B.R) makeR(); }
  function makeR() {
    B.R = new BOAT.Race($('boGl'), $('boHud'), { quality: wantQ() });
    try { BOAT.Sound.init(); } catch (e) { /* 音が無くても映像は出す */ }
    B.R.onSay = (keys, line) => { if (B.film) { try { BOAT.Sound.say(line); } catch (e) { /* noop */ } } }; // 実況は本番の映像だけ（スタート展示は音なし）
  }

  /* ---------- 映像 ---------- */
  async function fullRace(r) {
    const have = B.full[r.id], dec = r.status === 'decided' || r.status === 'done';
    if (have && (have.hidden || !dec)) return have; // 決める前はレースの書類を 1 回だけ読む・決めたら種つきでもう 1 回
    if (B.fetching === r.id || performance.now() - (B.fetchAt[r.id] || -1e9) < 3000) return have || null; // 読めなかったら 3 秒あける（読み取りを増やさない）
    B.fetching = r.id; B.fetchAt[r.id] = performance.now();
    try { const x = await B.C.boatRace(r.id); B.full[r.id] = x; return x; } catch (e) { return have || null; } finally { if (B.fetching === r.id) B.fetching = null; }
  }
  // レースごとの控え（書類・QR の合言葉・読んだ時刻）は、いまのレースと次のレースの分だけ残す（2026-11-20 C6: 消さずにたまり続けていた）
  function prune() {
    const L = B.live || {}, keep = {};
    [L.race && L.race.id, L.next && L.next.id, B.film && B.film.id, B.tj && B.tj.id].forEach((id) => { if (id) keep[id] = 1; });
    ['full', 'fetchAt', 'key'].forEach((k) => Object.keys(B[k]).forEach((id) => { if (!keep[id]) delete B[k][id]; }));
  }
  async function startFilm(r) {
    const key = 'film:' + r.id;
    if (r.status !== 'decided' && r.status !== 'done') return false; // 決めるまで（締切の 2 秒ほどあと）は出走表のまま
    const f = await fullRace(r); if (!f || !f.hidden || B.want !== key) return false; // 待ちのあと: 同じレース・同じ場面のままか（取り消し・次のレースに変わっていたらやめる）
    await needFilm(); if (B.want !== key) return false;
    needR();
    const model = Object.assign({}, f.model, { exacta: f.exacta }, f.hidden.incident ? { incident: f.hidden.incident } : {}), run = Engine.replayRun(model, f.hidden.seed, { order: f.hidden.order });
    let desc = {}; try { desc = BoatModel.describe(model, f.hidden.seed, { swaps: run.swaps }); } catch (e) { desc = {}; }
    // 5 番目（映像の係の入口 setRaceAsync）: 発走（大時計の 0 秒＝映像の 100 秒目）の 20 秒前までに終わらなければ、進路の作り直しを切り上げて始める（作り直しになるレースは準備が長い）
    const runAt0 = f.hidden.runAt || r.runAt, deadlineMs = Math.max(3000, runAt0 + (BOAT.Race.PRE_T - 20) * 1000 - now());
    if (!(await prep(key, [model, run, { title: 'casa BOAT', sub: hm(r.at) + ' のレース', weather: model.weather2, odds: { exacta: f.exacta } }, desc, { deadlineMs }], () => putCanvas('film')))) return false;
    const used = B.R.run || run; // 映像の部品が、進路の作れない走りを別の入れ替え方に取りかえることがある（着順は同じ）。決まり手などは実際に使った方から
    B.film = { id: r.id, runAt: f.hidden.runAt || r.runAt, closeAt: r.closeAt, desc: B.R.desc || desc, order: used.finalOrder ? used.finalOrder() : run.finalOrder(), on: false, cardAt: 0 };
    return true;
  }
  // 映像の準備を始める。決まるまで・読めるまでは 0.25 秒おきに確かめるだけ（2026-11-20 F9: 始められない間、毎コマ開始の処理を呼び直していた）
  function tryFilm(r) {
    if (B.starting || (r.status !== 'decided' && r.status !== 'done')) return;
    const pn = performance.now(); if (pn - B.tryAt < 250) return; B.tryAt = pn; B.nTry++;
    B.starting = true; startFilm(r).catch((e) => { BOATTV.err = 'film ' + (e && e.message); }).finally(() => { B.starting = false; });
  }
  // ボートの音: 鳴らした（BOAT.Sound.frame を呼んだ）あとは、映像をやめる所で必ず止める（2026-11-20 D5: 映像の途中で取り消すと実況・ファンファーレが鳴り続けた）
  function sound(st) { try { BOAT.Sound.frame(B.R, st); B.snd = true; B.sndAt = performance.now(); } catch (e) { /* noop */ } }
  function quiet() { if (!B.snd) return; B.snd = false; try { if (window.BOAT && BOAT.Sound) BOAT.Sound.stop(); } catch (e) { /* noop */ } }
  /* 映像を 1 回の描画で adv 秒進める。映像の係の入口（BOAT.Race の advance: 長いコマは中で細かく分けて進め、描くのは 1 回）があればそれを使う。
     無ければ tick（1 回 0.1 秒まで）で、コマの間が長い（遅いテレビ）ときは早送りの倍率（speedK）で 1 回ぶんを伸ばす（何回も描かない） */
  function advance(R, adv) {
    if (typeof R.advance === 'function') { R.advance(adv); return; }
    if (adv <= 0.1) { R.tick(adv); return; }
    const k0 = R.speedK || 1; R.speedK = k0 * adv / 0.1;
    try { R.tick(0.1); } finally { R.speedK = k0; }
  }
  function filmFrame(r, t) {
    const F = B.film, R = B.R; if (!F || !R || F.id !== r.id) return;
    const perf = performance.now(), real = B.lastFrame ? Math.min(1, (perf - B.lastFrame) / 1000) : 0; B.lastFrame = perf;
    if (t < F.runAt) { // 締切〜映像の前（6 秒）: 出走表とブザー（ボートのページの「出走表 → ピット離れ」と同じ）
      const cardT = Math.max(0, (t - F.closeAt) / 1000);
      if (perf - F.cardAt > 500) { F.cardAt = perf; R.seek(BOAT.Race.PIT_T); } // 出走表の板の下は止まった絵（ピット）: 1 秒 2 回だけ描く（前は毎コマ 2 回描いていた）
      F.on = false; hide($('boCard'), false);
      sound({ state: 'card', cardT, cardLen: Math.max(1, (F.runAt - F.closeAt) / 1000) });
      return;
    }
    hide($('boCard'), true);
    /* サーバーの時刻に合わせる（2026-11-20 D6）: 前は 1 コマ 0.1 秒までしか進めず、0.6 秒遅れるたびに位置を飛ばしていた（1 秒 10 コマ未満のテレビで約 3 秒ごとに映像が飛ぶ・カメラと航跡が消える）。
       → コマの間の実時間だけ進め（長いコマも 1 回で）、サーバーの時刻との差は速さを 0.5〜2 倍の間で変えて寄せる。飛ばすのは、始まり・読み込み直し・時計の大きな合わせ直しだけ */
    const target = (t - F.runAt) / 1000 - BOAT.Race.PRE_T, need = target - R.tt;
    if (!F.on || need > 3 || need < -1.5 || real <= 0) { F.on = true; if (Math.abs(need) > 0.02) { R.seek(target); B.nSeek++; } else R.tick(0); }
    else { const e = need - real, c = clamp(e * (1 - Math.exp(-1.5 * real)), -0.5 * real, real); advance(R, real + c); }
    sound({ state: R.done ? 'result' : 'race' });
  }
  function renderCard(r) {
    const f = B.full[r.id]; if (!f) return;
    const c = $('boCard'); if (c.dataset.id === r.id) return; c.dataset.id = r.id;
    c.innerHTML = '<h2>出走表<small>' + hm(r.at) + ' のレース・2周 1200m</small></h2>' + cardTable(r, f) + '<p class="bo-closed">投票は締め切りました</p>';
  }
  /* 出走表の板の下の字（2026-11-21 I3）: 映像の準備が発走（映像の始まり runAt）に間に合わないテレビ（遅いテレビ・作り直しになるレース）は、固まって見えないように
     「まもなく発走・スタートまで あと m:ss」（毎秒動く）。準備ができたら、ほかの店と同じ時刻の位置から始める（ピット離れ・ブザー・ファンファーレはそのテレビだけ飛ぶ＝途中から鳴らすとほかの店とずれるため） */
  function cardNote(r, t, ready) {
    const e = $('boCard').querySelector('.bo-closed'); if (!e) return;
    const f = B.full[r.id], runAt = (f && f.hidden && f.hidden.runAt) || r.runAt, startAt = runAt + ((window.BOAT && BOAT.Race && BOAT.Race.PRE_T) || 100) * 1000;
    const late = !ready && runAt && t >= runAt;
    setT(e, !late ? '投票は締め切りました' : t < startAt ? 'まもなく発走・スタートまで あと ' + left(startAt - t) : 'まもなく映像が始まります');
    if (e.__late !== late) { e.__late = late; e.classList.toggle('soon', late); }
  }

  /* ---------- 結果 ---------- */
  // 発表（決める係が結果を書く）がまだ届いていない間（2026-11-20 D2）: 前は中身が空のまま「確定 undefined - undefined 払戻 0 BPT 的中なし」と出ていた
  function renderPending(r) {
    const key = r.id + '|pend'; if (B.resKey === key) return; B.resKey = key; B.resObj = null;
    const e = $('boRes'); e.className = 'bo-res is-pend';
    setH(e, '<div class="bo-pend"><h2>結果を確認中</h2><p>確定まで しばらくお待ちください</p></div>');
  }
  /* 当たった人の額（2026-11-20 夜 オーナー決定「BPT は 3,000 まで」）: 当たった人の行に「実際に増えた分」（gain。v2/boat-core.js の decide）があればそれを出す
     （当たりの額 amount のうち、3,000 で止まって消えた分は出さない）。無い（前の形）ときは今までどおり amount。上限で止まった人には小さく「上限」の印 */
  const gainOf = (w) => (w && w.gain != null ? Math.max(0, Number(w.gain) || 0) : Number(w && w.amount) || 0);
  const cappedOf = (w) => !!w && (w.capped === true || (w.gain != null && Number(w.gain) < Number(w.amount)));
  function renderResult(r) {
    const res = r.result || {}, bs = boatsOf(r), a = bs[res.first] || {}, b = bs[res.second] || {};
    const desc = B.film && B.film.id === r.id ? B.film.desc : null, kim = desc && desc.kimarite ? (window.BoatModel && BoatModel.KIMARITE[desc.kimarite]) || desc.kimarite : '';
    // 描き直すのは中身が変わったとき（2026-11-20 F5: 前は「当たった人の数」しか見ていなかった。発表が届いたら、人数が同じでも描き直す）
    const key = [r.id, r.status, res.combo, res.odds, res.pay, r.people || 0, r.paid || 0, r.backBpt || 0, r.winners ? r.winners.length : -1, kim, res.noPay === true, res.bptBack === true, (r.winners || []).reduce((a, w) => a + gainOf(w), 0)].join('|');
    if (B.resKey === key && B.resObj === r) return; B.resKey = key; B.resObj = r;
    const ws = (r.winners || []).slice(0, 12), mine = (r.winners || []).filter((w) => w.storeId === STORE).length;
    /* 着順（2026-11-20 D8）: フライング・転覆の艇は着順に並べない（前は「6着」と出ていた）。本物の結果の書き方（ref/boat/research/27_返還のルール.md 4:
       着の欄に数字の代わりの記号「Ｆ」「転」が入り、完走した艇の後ろに並ぶ）に合わせる。競馬の落馬の「中止」と同じ考え方 */
    const inc = res.incident || null, outB = inc ? inc.boat : -1, fl = !!inc && inc.type === 'scratch';
    const row = (rk, i, out) => { const x = bs[i] || { no: i + 1, color: '#888', ink: '#fff' }; return '<div class="or' + (out ? ' out' : '') + '"><span class="rk">' + rk + '</span>' + waku(x, 'sm') + '<span class="nm">' + esc(x.name) + '</span></div>'; };
    /* 上限の印（2026-11-20。v2/boat-core.js の decide）: result.bptBack ＝ 上限のため、このレースの BPT の券は全部返還（無料の券だけで決めた）。result.noPay ＝ 上限のため払い戻しなし（ごくまれ）。
       事故の艇の知らせと同じ段に 1 行ずつ短く出す（言い方はスマホの結果の画面と同じ）。戻した BPT の合計（r.backBpt）は、上限の返還があればその行に、無ければ事故の艇の行に付ける */
    const noPay = res.noPay === true, capBack = res.bptBack === true;
    const notes = (inc ? '<div class="bo-inc">' + waku(bs[outB] || { no: outB + 1, color: '#888', ink: '#fff' }, 'sm') + '<b>' + (fl ? 'フライング' : '転覆') + '</b><span>' + (inc.refund ? 'この艇を含む券は返還（BPT の券は BPT を戻します）' + (r.backBpt && !capBack ? '・返還 ' + amt(r.backBpt) + ' BPT' : '') : '返還なし') + '</span></div>' : '') +
      (capBack ? '<div class="bo-inc cap"><b>返還</b><span>上限のため BPT の券は返還（BPT を戻します）' + (r.backBpt ? '・返還 ' + amt(r.backBpt) + ' BPT' : '') + '</span></div>' : '') +
      (noPay ? '<div class="bo-inc cap"><b>払い戻しなし</b><span>上限のため、このレースは払い戻しなし</span></div>' : '');
    const e = $('boRes'); e.className = 'bo-res';
    setH(e, '<div class="bo-kakutei"><span class="bo-k">確定</span>' + waku(a, 'lg') + '<b class="bo-ar">-</b>' + waku(b, 'lg') + '<div class="bo-nm">1着 ' + esc(a.name) + '<br>2着 ' + esc(b.name) + (kim ? '<br><small>決まり手 ' + esc(kim) + '</small>' : '') + '</div></div>' +
      '<div class="bo-pay"><span>2連単</span><b>' + (res.combo ? res.combo.split('-').map((x) => Number(x) + 1).join('-') : '') + '</b>' + (noPay ? '<b class="y np">払い戻しなし</b>' : '<span>払戻</span><b class="y">' + amt(res.pay) + '</b><small>BPT</small>') + '<span class="od">' + (res.odds ? (Math.round(res.odds * 10) / 10).toFixed(1) + '倍' : '') + '</span></div>' +
      (notes ? '<div class="bo-notes">' + notes + '</div>' : '') +
      '<div class="bo-wins"><h3>的中 ' + (r.people || 0) + ' 人' + (mine ? '（この店 ' + mine + ' 人）' : '') + '</h3>' + (ws.length ? '<ol>' + ws.map((w) => '<li class="' + (w.storeId === STORE ? 'me' : '') + '"><span class="nk">' + esc(w.nick) + '</span><span class="st">' + esc(w.storeName || w.storeId) + '</span><b>＋' + amt(gainOf(w)) + '<small>BPT</small></b>' + (cappedOf(w) ? '<i class="cp">上限</i>' : '') + '</li>').join('') + '</ol>' : '<p class="bo-none">' + (noPay ? '上限のため払い戻しなし' : '今回は的中なし') + '</p>') + '</div>' +
      '<div class="bo-order"><h3>着順</h3>' + (res.order || []).filter((i) => i !== outB).map((i, k) => row((k + 1) + '着', i)).join('') + (inc ? row(fl ? 'Ｆ' : '転', outB, true) : '') + '</div>' +
      '<p class="bo-note">当たった BPT は競馬の「追加の券」に使えます（1 枚 100 BPT）</p><p class="bo-next" id="boNext"></p>');
  }

  /* ---------- いまの場面 ---------- */
  function derbyBusy() { const D = window.DERBY; if (!D) return false; const ph = D.phase; return ph === 'live' || ph === 'open' || !!(D.tv && D.tv.playing); } // 競馬が投票中・レース中ならボートは出さない
  function setActive(on) {
    if (BOATTV.active === on) return; BOATTV.active = on; hide(ov, !on);
    stage.classList.toggle('m-boat', on);
    // ボートの画面の間は競馬の 3D を一切描かない（待機だけでなくリプレイも止める。v2/tv.js の DERBY.boatHold。2026-11-20 D1）。古い tv.js には印だけ立てる
    const D = window.DERBY; if (D && D.boatHold) D.boatHold(on); else if (D && D.raceView) { D.raceView.boatHold = on; if (!on) D.raceView.offWas = true; }
    if (!on) { B.snd = true; quiet(); B.lastFrame = 0; if (B.film) B.film.on = false; } // 競馬に戻るときは音を必ず止める
  }
  /* 競馬の結果画面の最初の 2 分は守る（2026-11-18 オーナー決定）。ボートの「投票待ち」だけでなく「投票受付中」の画面も出さない
     （2026-11-20 F6: 競馬が遅れて結果発表がずれると、ボートの投票受付中の画面が競馬の結果の最初の 2 分を覆っていた）。締切のあと（映像）は止めない */
  function derbyGuard(t) { const L = window.DERBY && DERBY.state && DERBY.state.last; return !!(L && L.revealAt && t < L.revealAt + 120000); }
  function topFor(label, on, time) { setT($('boPill'), label); $('boPill').classList.toggle('on', !!on); setT($('boTime'), time || ''); hide($('boCnt'), true); setT($('boStore'), storeNm || STORE); }
  // いま欲しい映像（B.want）とちがう準備が走っていたら打ち切る（展示の準備の途中で締切・取り消し・競馬に戻る など。2026-11-21 I3）
  function dropOld() { if (B.prepKey && B.prepKey !== B.want) { B.nDrop = (B.nDrop || 0) + 1; dropPrep(); B.prepKey = ''; } }
  /* 発表が届かないまま時間が過ぎたら（2026-11-21 J14）: 発表予定の 10 秒後・30 秒後・あとは 60 秒おきに、見張りをつなぎ直していまの状態を読み直す
     （前は見張りが戻らないと「結果を確認中」のままで、読み直す道が無かった） */
  const PEND_AT = (k) => (k === 0 ? 10000 : k === 1 ? 30000 : 30000 + 60000 * (k - 1));
  function pendRetry(r, t) {
    if (!B.pend || B.pend.id !== r.id) B.pend = { id: r.id, k: 0 };
    if (t < r.revealAt + PEND_AT(B.pend.k)) return;
    B.pend.k++; B.nRewatch = (B.nRewatch || 0) + 1; rewatch();
  }
  let tjLast = 0;
  function tjEnsure(r) {
    const pn = performance.now(), dt = tjLast ? Math.min(0.1, (pn - tjLast) / 1000) : 0; tjLast = pn;
    putCanvas('vid');
    if (!B.tj || B.tj.id !== r.id) {
      if (!B.tjStarting && B.full[r.id] && pn - B.tjTryAt >= 250) { B.tjTryAt = pn; B.tjStarting = true; tjStart(r).catch((e) => { BOATTV.err = 'tenji ' + (e && e.message); }).finally(() => { B.tjStarting = false; }); }
      return;
    }
    tjFrame(dt);
  }
  function loop() {
    try {
      const r = B.live && B.live.race, t = now(), st = r && Boat() ? Boat().stageOf(r, t) : 'none';
      BOATTV.stage = st; BOATTV.race = r ? r.id : null;
      const pre = st === 'wait' || st === 'vote';
      const waitOk = st !== 'wait' || r.openAt - t <= 60000; // 投票の 1 分前から「次のボートレース」（スタート展示つき）
      if (!r || st === 'none' || st === 'over' || !waitOk || (pre && derbyGuard(t)) || derbyBusy()) { B.want = ''; dropOld(); setActive(false); tjLast = 0; return; }
      setActive(true);
      if (pre) { B.want = 'tj:' + r.id; dropOld(); quiet(); show('boVote'); if (!B.full[r.id]) fullRace(r); renderVote(r, st === 'wait', t); tjEnsure(r); setReady(B.tj && B.tj.id === r.id); return; }
      tjLast = 0;
      if (st === 'void') { B.want = ''; dropOld(); setReady(false); quiet(); B.lastFrame = 0; show('boVoid'); topFor('● 取り消し', false, hm(r.at)); return; } // 映像の途中の取り消しでも音を止める（D5）
      if (st === 'closed' || st === 'film') {
        B.want = 'film:' + r.id; dropOld(); // 展示の準備が走っていたら、本番を頼んだ時点で打ち切る（2026-11-21 I3）
        show('boFilm'); topFor('● レース中', true, hm(r.at) + ' のレース'); renderCard(r);
        const ready = !!(B.film && B.film.id === r.id); setReady(ready); putCanvas('film'); cardNote(r, t, ready);
        if (!ready) { hide($('boCard'), false); tryFilm(r); return; }
        filmFrame(r, t); return;
      }
      if (st === 'result') {
        const done = r.status === 'done' && !!r.result, mine = !!(B.film && B.film.id === r.id && B.R);
        B.want = mine ? 'film:' + r.id : ''; dropOld(); setReady(mine);
        if (mine && (!B.R.done || !done) && t < r.revealAt + 20000) { show('boFilm'); filmFrame(r, t); return; } // 映像の最後（ゴール後）まで。発表（決める係が結果を書く）が届くまでは勝った艇のアップのまま（20 秒まで）
        show('boRes'); B.lastFrame = 0;
        if (!done) { topFor('● 結果を確認中', false, hm(r.at) + ' のレース'); renderPending(r); quiet(); pendRetry(r, t); return; } // 発表がまだ: 中身が届いたら下で描き直す（D2）。音は止める・届かなければ読み直す（2026-11-21 J14）
        const n = B.live && B.live.next, endShow = n && n.openAt > t && n.openAt < r.endAt ? n.openAt : r.endAt; // 「あと ○:○○」は次の投票開始が先ならそちらまで（2026-11-21 I4: 前は途中で次の投票に替わり「あと 1:10」で切れていた）
        topFor('● 確定', true, 'この画面 あと ' + left(endShow - t)); renderResult(r); setT($('boNext'), n ? '次のボートレース ' + hm(n.at) + '（投票は ' + hm(n.openAt) + ' から）' : '');
        if (mine && performance.now() - B.sndAt > 300) sound({ state: 'result' }); // 音は今までどおり（この映像を流したテレビだけ）。毎コマは呼ばない（1 秒 3 回。F18）
        return;
      }
      B.want = ''; dropOld(); setActive(false);
    } catch (e) { BOATTV.err = String(e && e.message); console.error('casa BOAT', e); }
  }
  // 画面を出している間は毎コマ。出していない間（ボートの無い時間）は 1 秒 4 回だけ場面を確かめる（F18: 何も無い間も毎コマ回していた）
  let stopped = false, unwatch = null, timer = 0, rafId = 0, onLive = null, onCount = null;
  function raf() { rafId = 0; timer = 0; if (stopped) return; loop(); if (stopped) return; if (BOATTV.active) rafId = requestAnimationFrame(raf); else timer = setTimeout(raf, 250); }
  // 見張りとくり返しを止める（確かめ・片付け用）。予約ずみのコマも取り消す・準備中（はじめの待ちの途中）に止めたら見張りを始めない（2026-11-21 J14）
  BOATTV.stop = () => { stopped = true; clearTimeout(timer); if (rafId) cancelAnimationFrame(rafId); rafId = 0; timer = 0; if (unwatch) { try { unwatch(); } catch (e) { /* noop */ } unwatch = null; } B.want = ''; dropOld(); setActive(false); };
  // 見張りをつなぎ直して、いまの状態を読み直す（発表が届かないとき）
  function rewatch() {
    if (stopped || !B.C || !onLive) return;
    if (unwatch) { try { unwatch(); } catch (e) { /* noop */ } unwatch = null; }
    unwatch = B.C.boatWatch({ boat: onLive, count: onCount, error: () => {} });
    if (B.C.boatState) B.C.boatState().then((x) => { if (!stopped && x && x.live) onLive(x.live); }).catch(() => {});
  }

  /* ---------- はじめ: 競馬のテレビ（v2/tv.js）の DerbyCloud をそのまま使う（つなぎ・ログイン・時計は 1 つ） ---------- */
  (async () => {
    for (let i = 0; i < 600 && !(window.DERBY && DERBY.cloud) && !stopped; i++) await new Promise((r) => setTimeout(r, 100));
    if (stopped || !(window.DERBY && DERBY.cloud) || DERBY.watch || !STORE) return;
    B.C = DERBY.cloud;
    if (B.C.stores) B.C.stores().then((L) => { const s = (L || []).find((x) => x.id === STORE); if (s) storeNm = s.name + '店'; }).catch(() => {});
    await needCore();
    if (stopped || !B.C.boatWatch) return; // 古い部品・待ちの間に止められた
    onLive = (live) => { B.live = live; const r = live && live.race; if (r && B.full[r.id] && r.status !== B.full[r.id].status) { B.full[r.id] = Object.assign({}, B.full[r.id], r); if (r.status === 'decided') delete B.full[r.id].hidden; } prune(); };
    onCount = (c) => { B.count = c; };
    unwatch = B.C.boatWatch({ boat: onLive, count: onCount, error: () => {} });
    BOATTV.preview = (live) => { if (live) onLive(live); return B.live; }; // 確かめ用（tests/boat-tv-bugs.plan.js）: いまの状態を好きな中身にして描かせる（見張りの次の知らせで本物に戻る）。引数なしなら今の状態を返す
    if (B.C.boatState) { try { const x = await B.C.boatState(); if (!B.live) onLive(x.live); } catch (e) { /* 見張りで届く */ } }
    if (!stopped) raf();
  })();
  BOATTV.debug = () => ({ q: B.R ? B.R.quality : null, tj: B.tj && { id: B.tj.id, seg: B.tj.seg, tt: B.R && B.R.tt }, stage: BOATTV.stage, race: BOATTV.race, film: B.film && { id: B.film.id, tt: B.R && B.R.tt, done: B.R && B.R.done, shot: B.R && B.R.shot }, count: B.count, err: BOATTV.err, qr: BOATTV.qr, parts: B.R && B.R.parts,
    want: B.want, prepKey: B.prepKey || '', drops: B.nDrop || 0, rewatch: B.nRewatch || 0, ready: !!ov.__ready, sub: B.R && B.R.info && B.R.info.sub, tries: B.nTry, preps: B.nPrep, skips: B.nSkip, seeks: B.nSeek, kept: { full: Object.keys(B.full), key: Object.keys(B.key), fetchAt: Object.keys(B.fetchAt) }, vq: VQ });
})();
