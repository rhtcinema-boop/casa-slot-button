/* casa BOAT（競艇）のレース映像（統合）。2026-11-17 作り直し（2 回目）。
   1 回目は想像で作っていたので全部捨てた（オーナー「想像で作るのは一個もやらないで」「全部実際のものに近くする」）。この版は調査の資料だけで作る:
     艇の場所・向き・速さ … boat/lines.js（発走前にレース全体の進路を計算。その場でよけない。重なり 0）。ここでは plan.at(t) を読んで置くだけ
     カメラ          … ref/boat/research/04 ⑦ 精密版の 7-2（カメラの位置 K1〜K8）と 7-5（台本）。カメラは岸に固定で、カットの間は「向ける先」と「画角」だけが動く
     テロップ        … 04 ⑦ 7-3 の実測（位置は画面の %）。本物に無いが残す物（周回と時計・順位の表）は 7-5 の置き場所。オーナーの決定
   部品: BOAT.Course・BOAT.Boat・BOAT.Wake・BOAT.Venue・BOAT.Lines・BoatModel（js/boat-model.js）。
   時刻 tt: 大時計が 0 になる瞬間（スタート）が 0。レース前は −30 から、終わりは 1 着のゴール G の 8 秒後。画面は 1000×480 の決まった座標で考える。 */
window.BOAT = window.BOAT || {};
BOAT.Race = (function () {
  'use strict';
  const T = window.THREE, C = BOAT.Course, M = window.BoatModel;
  const W = 1000, H = 480;
  const PRE_T = 100, POST_T = 8;
  const F_ANNOUNCE = 16.5; // フライングの発表の時刻（字幕・実況の「お知らせいたします」と同じ）。ここまでは、フライングの艇も順位・札にふつうに出す
  const STEP_MAX = 0.1;    // 艇・カメラ・航跡を 1 回に進める長さの上限（秒）。これより長く進める時は細かく分ける
  const SOFT_SEEK = 2.0;   // 映像を流している途中の「少しだけ先へ」の飛ばし（この秒数まで）は、カメラも航跡も切らずにつなぐ
  const PIP_Y = 0.12; // 小窓の上の端（画面の高さの割合）。右上の TIME の札の下に置く（2026-11-19 画面の表示を競馬にそろえた。前は 5.2%） // レース前は本物どおり全部（待機行動 約 100 秒。オーナー 2026-11-17）
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, k) => a + (b - a) * k;
  const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const FONT = '"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';
  /* 画面の上での進み（スタート線からの道のり m）。順位の表示（左上の 1〜3 位・下の順位の丸・オッズの札）の並びに使う（2026-11-20 直し・不具合 E4）。
     直線: 艇が見えている場所の x の前後そのまま（＝ 画面で前にいる艇が、表示でも前）。
     マークを回っている間（マークの列の外側）: 走りの計算の進み sig のまま（回っている最中は、内の艇と外の艇の前後が目では決まらないので、計算の順で落ち着かせる）。
     その間（マークの手前 20m）はなめらかに混ぜる。30 レースで測った: 前の「計算の順だけ」は、直線で画面と 1.5m より大きく食い違う時間が 1 レース 2.1 秒（最大 9m）→ これは 0 秒（最大 1.5m）。
     x の進みは boat/course.js の pointAt の逆（何周目かは sig にいちばん近いもの） */
  const DIST_M = (M && M.DIST) || C.DIST, VIS_X0 = C.MARK1.x - 20, VIS_X1 = C.MARK1.x;
  function visM(x, z, sig) {
    const ax = Math.abs(x); if (ax >= VIS_X1) return sig;
    const s = z >= 0 ? x - C.MARK2.x : C.LS + C.TURN_LEN + (C.MARK1.x - x), v0 = s - C.FINISH_S, v = v0 + C.L * Math.round((sig - v0) / C.L);
    return ax <= VIS_X0 ? v : sig + (1 - sm((ax - VIS_X0) / (VIS_X1 - VIS_X0))) * (v - sig);
  }
  const ORD_H = 1.0, ORD_H_GOAL = 0.25, ORD_GOAL_M = 80; // 表示の順を入れ替えるのは、後ろの艇が ORD_H m より前に出た時（並んだ艇がちらちら入れ替わらない）。ゴールの手前 80m からは 0.25m
  // カメラの位置（04 ⑦ 7-2。K1 ＝スタート線の上のスタンドの屋根、K2 ＝ 1 マーク寄りの高所、K3 ＝ 2 マーク寄りの高所、K4 ＝バックの横）
  const KZ = (x) => C.shoreZ(x) + 2.5; // 屋根の前の端は水ぎわの 4m 奥（会場の部品）。その 1.5m 前に置く＝屋根が映らない（オーナー 2026-11-17「建物の屋根が映らないようにして」）
  const K1 = [-5, 26, KZ(-5)], K2 = [110, 26, KZ(110)], K3 = [-110, 26, KZ(-110)], K4 = [0, 10, 62];

  /* ---------- 無い部品の代わり（部品が壊れていても止まらないように） ---------- */
  const Stub = {
    boat(h) { const g = new T.Group(), hull = new T.Mesh(new T.BoxGeometry(2.9, 0.3, 1.3), new T.MeshLambertMaterial({ color: 0xffffff })); hull.position.y = 0.15; g.add(hull); const man = new T.Mesh(new T.BoxGeometry(0.5, 0.7, 0.5), new T.MeshLambertMaterial({ color: h.color })); man.position.set(-0.5, 0.6, 0); g.add(man); return { object3d: g, update() { }, setQuality() { }, dispose() { } }; },
    wake() { return { update() { }, reset() { }, dispose() { } }; },
    venue(scene) { scene.background = new T.Color(0x9fc4e6); scene.add(new T.HemisphereLight(0xffffff, 0x4a6a80, 1.0)); const w = new T.Mesh(new T.PlaneGeometry(1200, 600), new T.MeshLambertMaterial({ color: 0x2f5f70 })); w.rotation.x = -Math.PI / 2; scene.add(w); return { update() { }, setClock() { }, setBoard() { }, dispose() { } }; },
  };

  class Race {
    constructor(glCanvas, hudCanvas, opts) {
      opts = opts || {};
      this.gl = glCanvas; this.hud = hudCanvas; this.ctx = hudCanvas.getContext('2d');
      /* 画質の 5 段（2026-11-23 オーナー「ボートの画質 競馬と同じぐらい細かく」。opts.level）: 'max' きれい優先（細かさ 1.5 倍）・'' 標準・'auto' なめらか優先（重いときは自動で粗く）・
         'lite' さらになめらか（軽い部品・影なし）・'min' 最もなめらか（軽い部品・細かさ 0.75 倍・観客と木と旗なし）。部品へ渡すのは今までどおり quality（'high' | 'low'）。
         level が無ければ quality から（'low' → 'lite'、ほか → 標準）＝今までと同じ絵 */
      this.level = Race.levelOf(opts.level != null ? opts.level : opts.quality === 'low' ? 'lite' : '');
      this.quality = this.level === 'lite' || this.level === 'min' ? 'low' : 'high'; this.parts = {}; this.autoK = 1; this.perfQ = { last: 0, sum: 0, n: 0, good: 0 };
      const r = this.renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: this.quality === 'high', powerPreference: 'high-performance' });
      r.setPixelRatio(1);
      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(21.4, W / H, 0.5, 2600);
      this.cam2 = new T.PerspectiveCamera(1.6, 37.5 * W / (37 * H), 0.5, 2600); // 小窓（ゴール前の先頭の正面ドアップ）
      this.venue = this.part('Venue', () => BOAT.Venue.build(this.scene, r, { quality: this.quality }), () => Stub.venue(this.scene));
      this.wake = this.part('Wake', () => BOAT.Wake.create(this.scene, { quality: this.quality }), () => Stub.wake());
      this.PIT = (this.venue && this.venue.PIT) || { x: C.PIT.x, z: C.PIT.z, dirX: 0, dirZ: 1, gap: C.PIT.gap, out: { x: 1, z: 0 } };
      this.boats = []; this.vis = []; this.rank = [];
      this.buildMarks();
      this.tt = -PRE_T; this.speedK = 1; this.cam = null; this.shot = ''; this.shots = []; this.capList = []; this.capCur = null;
      if (this.level === 'min') this.scene.traverse((o) => { if (o.name === 'boat-crowd' || o.name === 'boat-crowd-standing' || o.name === 'boat-trees' || o.name === 'boat-venue-flags') o.visible = false; }); // 最もなめらか: 観客・木・旗を描かない
      this.resize();
    }
    static levelOf(v) { return v === 'max' || v === 'auto' || v === 'lite' || v === 'min' ? v : v === 'low' ? 'lite' : ''; } // 'std'・'high'・空 ＝ 標準
    /* 細かさの倍率（画面の画素に対して）。きれい優先は 1.5 倍（横 3840 まで）、最もなめらかは 0.75 倍、なめらか優先は autoK（1 から始めて、重いと 0.1 ずつ 0.6 まで下げる） */
    resK(base) { return this.level === 'max' ? Math.max(1, Math.min(1.5, 3840 / Math.max(1, base))) : this.level === 'min' ? 0.75 : this.level === 'auto' ? this.autoK : 1; }
    /* なめらか優先: コマの間の平均を 2 秒ごとに見て、40ms より長ければ（1 秒 25 コマ未満）細かさを 0.1 下げる。25ms より短いのが 60 秒続いたら 0.1 戻す */
    perfTick() {
      if (this.level !== 'auto') return;
      const q = this.perfQ, now = performance.now(), gap = now - q.last; q.last = now;
      if (!(gap > 0 && gap < 500)) return; // 最初のコマ・止まっていた間は数えない
      q.sum += gap; q.n++;
      if (q.sum < 2000) return;
      const avg = q.sum / q.n; q.sum = 0; q.n = 0;
      if (avg > 40) { q.good = 0; if (this.autoK > 0.6) { this.autoK = Math.max(0.6, Math.round((this.autoK - 0.1) * 10) / 10); this.resize(); } }
      else if (avg < 25) { if (++q.good >= 30 && this.autoK < 1) { q.good = 0; this.autoK = Math.min(1, Math.round((this.autoK + 0.1) * 10) / 10); this.resize(); } }
      else q.good = 0;
    }
    part(name, make, stub) {
      try { if (BOAT[name]) { const p = make(); if (p) { this.parts[name] = 'real'; return p; } } } catch (e) { console.warn('BOAT.' + name, e); }
      this.parts[name] = 'stub'; return stub ? stub() : null;
    }
    resize() {
      const cw = this.gl.clientWidth || W, ch = this.gl.clientHeight || H, dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1);
      const rk = this.resK(cw * dpr); this.renderer.setSize(Math.round(cw * dpr * rk), Math.round(ch * dpr * rk), false); // rk: 画質の段ごとの細かさ（3D の絵だけ。字の絵 hud は変えない）
      const k = Math.min(2, Math.max(1, cw * dpr / W)); this.hud.width = Math.round(W * k); this.hud.height = Math.round(H * k); this.hudK = k;
    }
    /* スタート前だけ水面に重ねる距離の線と字（中継の合成。04 ⑦ 7-3: 白〜水色の細い線、水面に寝かせた半透明の白い字 150m・130m・100m・80m・45m、スタート線だけ太いシアンの光る線、
       線の先にからし色の「START」）。本物の標識ポール・空中線は会場の部品が作る */
    buildMarks() {
      const g = this.marks = new T.Group(); g.visible = false; this.scene.add(g);
      const z0 = 2, z1 = C.shoreZ(0) - 1, zm = (z0 + z1) / 2;
      const line = (x, col, w, op) => { const m = new T.Mesh(new T.PlaneGeometry(w, z1 - z0), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, zm); g.add(m); };
      const label = (txt, x, z, w, h, col, tilt) => {
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const c = cv.getContext('2d');
        c.font = (tilt ? 'italic ' : '') + '900 96px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = col; c.fillText(txt, 256, 68);
        const tx = new T.CanvasTexture(cv); tx.encoding = T.sRGBEncoding;
        const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 2; m.position.set(x, 0.07, z); g.add(m); // K1（スタンド側・2 マーク寄り）から読める向き
      };
      line(0, 0x35d8ff, 0.7, 0.95);
      [150, 130, 100, 80, 45].forEach((d) => { line(-d, 0xdff4ff, 0.3, 0.6); label(d + 'm', -d - 5, z1 - 9, 20, 5, 'rgba(255,255,255,.8)'); });
      label('START', 15, zm, 34, 8.5, 'rgba(214,178,52,.7)', true);
    }
    /* race: BoatModel.makeRace、run: Engine.replayRun、desc: BoatModel.describe(race, 種, { swaps: run.swaps })、info: { title, sub, hour, odds }
       ここで全部を一度に準備する（進路の計算のあいだ画面は止まる。Mac で 0.3〜3 秒）。テレビは下の setRaceAsync を使う。
       着順を指定した再現で進路の計画が不合格だった時は、入れ替え方を変えた走りに取りかえる（Race.planJob）。使った走りと中身は this.run・this.desc に入る */
    setRace(race, run, info, desc) {
      this.cancelPrep(); // 準備中の setRaceAsync があれば、その結果は捨てる（あとから頼まれた方を使う）
      let P = null;
      try { const g = Race.planJob(race, run, desc || {}); let r = g.next(); while (!r.done) r = g.next(); P = r.value; } catch (e) { console.warn('BOAT.Lines', e); }
      this.dropBoats();
      const boats = race.horses.map((h) => this.makeBoat(h));
      this.applyRace(race, P ? P.run : run, info, P ? P.desc : desc, P ? P.plan : null, boats, null);
    }
    /* 画面を止めずに準備する（2026-11-20。不具合 E の疑い・D7）。全部そろってから一度に入れ替える。それまでは前のレース（スタート展示など）がそのまま動く（tick・seek を呼び続けてよい）。
       返り値は Promise（入れ替えたら true。あとから別の setRace / setRaceAsync・cancelPrep・dispose で捨てられたら false）。
       2026-11-21 作り直し（不具合 I3「遅いテレビで、作り直しになるレースの準備が 6 倍遅い機械で 27 秒・20 倍で 85 秒」）:
         ① 進路の計算は、画面とは別の糸（Web Worker。boat/plan-worker.js）2〜3 本で、作り直しの候補を同時に計算する（Race.planPar）。選び方は Race.planJob と同じ順なので答えは同じ。
            別の糸が使えないブラウザ・読み込めない時は、前と同じく画面の糸で少しずつ計算する。
         ② その間に、画面の糸で艇の絵・札・絵の下描き（着順に関係ない物）を進める。
         ③ 少しずつ進める区切りの間を、setTimeout（続けると 4ms 以上あく）でなく MessageChannel でつなぐ（前は「4ms 働いて 4ms 待つ」で計算の約 2 倍かかっていた）。
         ④ 「いまは動かない場面」（出走表だけを出している など）の時は、1 回に長く（40ms）働く。知らせ方は 2 つ: opt.still（true か、true/false を返す関数）か、this.idle = true。
         ⑤ 時間切れの切り上げはやめた（どのテレビでも同じ計画になるように。前は opt.deadlineMs を過ぎると作り直しを切り上げ、そのテレビだけ艇の位置が少しちがった）。opt.deadlineMs は受け取るが使わない。
       opt.budgetMs: 動いている場面で 1 回に使う時間（既定 4）、opt.stillMs: 動かない場面で 1 回に使う時間（既定 40）、opt.gapMs: 区切りの間に空ける時間（既定 0）、opt.onProgress(0〜1)、opt.worker: false で別の糸を使わない。
       途中でやめる: this.cancelPrep()（返り値の Promise は false で終わる。作りかけの絵も片付ける）。
       終わったあと this.prepStat ＝ { ms: かかった時間, planMs: 進路の計算が終わるまで, maxMs: 画面の糸でいちばん長かった 1 回, alt: 使った入れ替え方, worker: 別の糸で計算したか, units: 計算した計画の数 }、
       this.run・this.desc ＝ 実際に使った走りと中身（入れ替え方を変えた時は、もらった物と違う） */
    setRaceAsync(race, run, info, desc, opt) {
      opt = opt || {};
      this.cancelPrep();
      const self = this, job = this.prepJob = { t0: performance.now(), bail: null }, alive = () => this.prepJob === job;
      const still = () => { try { return !!(self.idle || (typeof opt.still === 'function' ? opt.still() : opt.still)); } catch (e) { return false; } };
      const budget = () => (still() ? (opt.stillMs != null ? opt.stillMs : 40) : (opt.budgetMs != null ? opt.budgetMs : 4)), gap = opt.gapMs || 0;
      const made = { boats: [], tags: null }; // 作った絵（途中で捨てられた時はここから片付ける）
      const stat = this.prepStat = { maxMs: 0, maxAt: '', slices: 0, ms: 0, planMs: 0, alt: 0, worker: false, units: 0 };
      const drop = () => { made.boats.forEach((b) => { try { this.scene.remove(b.object3d); b.dispose(); } catch (e) { } }); try { if (made.tags) made.tags.dispose(); } catch (e) { } made.boats = []; made.tags = null; };
      // 着順に関係ない物: 艇の絵を 1 艇ずつ → 札 → 絵を先に 1 回描いておく（見えない大きさで。最初の 1 コマで止まらないように）
      function* pieces() {
        for (const h of race.horses) { made.boats.push(self.makeBoat(h)); yield 'wait:boat'; }
        try { if (BOAT.Tags) made.tags = BOAT.Tags.create(self.scene, race.horses); } catch (e) { console.warn('BOAT.Tags', e); made.tags = null; }
        if (made.tags) { try { made.tags.setVisible(false); } catch (e) { } } // 入れ替えるまでは出さない
        yield 'wait:tags';
        yield* self.warmGen(made.boats, made.tags);
      }
      return new Promise((resolve, reject) => {
        let done = false, P = null, planOk = false, piecesOk = false;
        const end = (v, err) => { if (done) return; done = true; if (v !== true) drop(); if (err) reject(err); else resolve(v); };
        job.bail = () => end(false);
        const finish = () => {
          if (!planOk || !piecesOk || done || !alive()) return;
          try {
            const t0 = performance.now(); this.prepJob = null; this.prepMs = t0 - job.t0;
            this.applyRace(race, P ? P.run : run, info, P ? P.desc : desc, P ? P.plan : null, made.boats, made.tags);
            const ms = performance.now() - t0; if (ms > stat.maxMs) { stat.maxMs = ms; stat.maxAt = 'apply'; }
            stat.ms = this.prepMs; stat.alt = P ? P.alt || 0 : -1; done = true;
            if (opt.onProgress) opt.onProgress(1); resolve(true);
          } catch (e) { end(false, e); }
        };
        // 画面の糸で少しずつ進める（1 回 budget() ms。'wait…' の区切りのあとは必ず次の順番へ）
        const sliced = (g, onDone, prog) => {
          const step = () => {
            if (!alive() || done) { try { g.return(); } catch (e) { } end(false); return; }
            try {
              const t0 = performance.now(), B = budget(); let lab = '';
              for (;;) {
                const r = g.next();
                if (r.done) { onDone(r.value); return; }
                if (prog && typeof r.value === 'number' && opt.onProgress) opt.onProgress(r.value);
                lab = typeof r.value === 'string' ? r.value : lab;
                if ((typeof r.value === 'string' && r.value.slice(0, 4) === 'wait') || performance.now() - t0 >= B) break;
              }
              const ms = performance.now() - t0; if (ms > stat.maxMs) { stat.maxMs = ms; stat.maxAt = lab; } stat.slices++;
              if (gap) setTimeout(step, gap);
              else if (!still() && ms > 10) setTimeout(step, 10); // 遅い機械（1 回が 10ms を超える）で動いている場面では、次の 1 回の前に 10ms あけて、間に画面を 1 コマ描かせる
              else soon(step);
            } catch (e) { if (alive()) this.prepJob = null; end(false, e); }
          };
          soon(step);
        };
        const planDone = (v) => { P = v; planOk = true; stat.planMs = performance.now() - job.t0; if (opt.onProgress) opt.onProgress(0.7); finish(); };
        const onMain = () => sliced((function* () { let v = null; try { v = yield* Race.planJob(race, run, desc || {}); } catch (e) { console.warn('BOAT.Lines', e); } return v; })(), planDone, true);
        let par = null;
        if (opt.worker !== false) { try { par = Race.planPar(race, run, desc || {}, alive, stat); } catch (e) { console.warn('BOAT.planPar', e); par = null; } }
        if (par) { stat.worker = true; par.then((v) => { if (alive() && !done) planDone(v); }, (e) => { if (!alive() || done) return; console.warn('BOAT.planPar', e); stat.worker = false; onMain(); }); }
        else onMain();
        sliced(pieces(), () => { piecesOk = true; finish(); }, false);
      });
    }
    /* 準備中の setRaceAsync をやめる（2026-11-21。テレビの係の頼み）。返り値の Promise は false で終わり、作りかけの絵は片付ける。準備中でなければ何もしない */
    cancelPrep() { const j = this.prepJob; this.prepJob = null; if (j && j.bail) j.bail(); if (j) { try { poolPump(); } catch (e) { } } } // 別の糸で計算中の、このレースの分も止める（2026-11-21 N1）
    get preparing() { return !!this.prepJob; }
    /* 艇の絵を 1 艇作る（部品が壊れていても止まらないよう、だめなら代わりの箱）。まだ水面には置かない */
    makeBoat(h) { let b = null; try { if (BOAT.Boat) { b = BOAT.Boat.create(h, { quality: this.quality }); this.parts.Boat = 'real'; } } catch (e) { console.warn('BOAT.Boat', e); } if (!b || !b.object3d) { b = Stub.boat(h); this.parts.Boat = this.parts.Boat || 'stub'; } return b; }
    dropBoats() { this.boats.forEach((b) => { this.scene.remove(b.object3d); try { b.dispose(); } catch (e) { } }); this.boats = []; }
    /* 新しい絵（艇・札）を、入れ替える前に 1 回ずつ描いておく: 絵の具（1024×1024 の絵）と形を、見えない大きさ・画面の隅の 2×2 の点の中だけで描いて、先に映像の機械へ送っておく。
       入れ替えた最初の 1 コマで 6 艇ぶんをまとめて送ると、遅いテレビで 0.1 秒を超えて止まるため。1 つ送るごとに次の順番へ回す。うまくいかなくても走りは止めない（最初の 1 コマが重くなるだけ） */
    *warmGen(boats, tags) {
      const r = this.renderer, cam = this.camera, sc = this.scene;
      const texOf = (root) => { const L = []; root.traverse((m) => { const ms = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []; ms.forEach((mt) => ['map', 'specularMap', 'bumpMap', 'alphaMap'].forEach((k) => { if (mt[k] && mt[k].isTexture && L.indexOf(mt[k]) < 0) L.push(mt[k]); })); }); return L; };
      const seen = [];
      const roots = boats.map((b) => b.object3d).concat(tags ? [tags.rings, tags.badges].filter(Boolean) : []);
      try { if (r.initTexture) for (const o of roots) for (const tx of texOf(o)) { if (seen.indexOf(tx) >= 0) continue; seen.push(tx); r.initTexture(tx); yield 'wait:tex'; } } catch (e) { console.warn('warm tex', e); }
      const dir = new T.Vector3(), size = r.getSize(new T.Vector2());
      for (const b of boats) {
        const o = b.object3d;
        try {
          cam.getWorldDirection(dir); o.position.copy(cam.position).addScaledVector(dir, 30); o.scale.setScalar(1e-4); sc.add(o);
          r.setScissorTest(true); r.setScissor(0, 0, 2, 2); r.setViewport(0, 0, size.x, size.y); r.render(sc, cam);
        } catch (e) { console.warn('warm boat', e); }
        try { r.setScissorTest(false); sc.remove(o); o.scale.setScalar(1); o.position.set(0, 0, 0); } catch (e) { }
        yield 'wait:warm';
      }
    }
    /* レースの中身（絵を除く）を入れる: 走り・進路・着順・外れる艇の時刻。絵の部品を使わないので、試験（tests/boat-film.test.js）は node からここだけ呼ぶ */
    adopt(race, run, info, desc, plan) {
      this.race = race; this.run = run; this.info = info || {}; this.desc = desc || {}; this.parts = this.parts || {};
      this.n = race.horses.length;
      this.entry = Array.isArray(this.desc.entry) ? this.desc.entry : Array.isArray(race.entry) ? race.entry : race.horses.map((_, i) => i);
      this.G = run.winTime || 72; this.endT = this.G + POST_T; this.finalOrder = run.finalOrder ? run.finalOrder() : race.horses.map((_, i) => i);
      // 進路（発走前に最後まで計算した物）
      this.plan = plan || null; this.parts.Lines = plan ? (plan.ok !== false ? 'real' : 'ng') : 'err';
      // 外れる艇と、その時刻（ここからは順位・札に出さない）。フライング ＝ 発表の時刻、転覆 ＝ 転覆した時刻
      this.outT = race.horses.map((_, i) => { if (!(run.out && run.out[i])) return null; const inc = run.incident; if (inc && inc.type === 'fall' && run.fallT != null) return run.fallT; return F_ANNOUNCE; });
      this.ordK = null; this.ordShown = null; this.rk = null;
    }
    /* 準備した物を一度に入れ替える（短い）。boats: 新しい艇の絵（まだ水面に置いていない）、tags: 新しい札（null ならここで作る） */
    applyRace(race, run, info, desc, plan, boats, tags) {
      this.boats.forEach((b) => { if (boats.indexOf(b) < 0) { this.scene.remove(b.object3d); try { b.dispose(); } catch (e) { } } });
      this.boats = boats; boats.forEach((b) => this.scene.add(b.object3d));
      this.adopt(race, run, info, desc, plan);
      this.vis = race.horses.map(() => ({ x: 0, z: 0, yaw: 0, speed: 0, turn: 0, flip: 0, on: true }));
      // 艇番の輪と札（競馬の足元の輪・馬番の札と同じ考え方。boat3d.js の BOAT.Tags。無くても走りは止めない）
      if (this.tags) { try { this.tags.dispose(); } catch (e) { } this.tags = null; }
      if (tags) { this.tags = tags; this.parts.Tags = 'real'; try { tags.setVisible(true); } catch (e) { } }
      else { try { if (BOAT.Tags) { this.tags = BOAT.Tags.create(this.scene, race.horses); this.parts.Tags = 'real'; } } catch (e) { console.warn('BOAT.Tags', e); this.tags = null; } }
      this.tagK = 0; this.ordX = null; this.rk = null; this.ordK = null; this.ordShown = null;
      this.rank = race.horses.map((_, i) => i);
      try { this.wake.reset(); } catch (e) { }
      try { if (this.venue.setTime) { const dn = new Date(); this.venue.setTime(this.info.hour != null ? this.info.hour : dn.getHours() + dn.getMinutes() / 60); } } catch (e) { console.warn('setTime', e); }
      try { if (this.venue.setWeather && this.info.weather) this.venue.setWeather(this.info.weather); } catch (e) { console.warn('setWeather', e); }
      try { this.timeline(); } catch (e) { console.warn('timeline', e); this.shots = [{ t: -PRE_T, id: 'approach', ev: {} }]; }
      try { this.script(); } catch (e) { console.warn('script', e); this.capList = []; }
      this.live = false; this.seek(-PRE_T);
    }
    get done() { return this.tt >= this.endT; }
    /* 外れた艇（フライング・転覆）か。2026-11-20 直し（不具合 E1）: run.out は最初から最後の値（走りの再現が、終わったあとの値で持つ）なので、そのまま見ると
       転覆する艇がスタート直後から順位・札から消えて結果が先に分かってしまっていた。出来事の時刻（フライングは発表の +16.5 秒、転覆は転覆した時刻 run.fallT）までは、ふつうの艇と同じに扱う */
    isOut(i, t) { const o = this.outT; return !!(o && o[i] != null && t >= o[i]); }
    /* ---------- 時刻 t の様子（艇の場所は進路の計画から、順位は走りの計算から） ---------- */
    stateAt(t) {
      const run = this.run, n = this.n, P = this.plan ? this.plan.at(t) : null, S = [];
      if (run.seek) run.seek(Math.max(0, t));
      for (let i = 0; i < n; i++) { const p = P && P[i]; S.push(p ? { x: p.x, z: p.z, yaw: p.yaw, speed: p.speed, turn: p.turn || 0, slip: p.slip || 0, turnDir: p.turnDir || 0, on: p.on !== false, phase: p.phase, out: this.isOut(i, t), pos: run.pos[i], vis: visM(p.x, p.z, run.pos[i] * DIST_M) } : { x: C.PIT.x, z: C.PIT.z + i * 3, yaw: 0, speed: 0, turn: 0, on: true, out: false, pos: 0, vis: 0 }); }
      const alive = S.map((_, i) => i).filter((i) => !S[i].out && S[i].on);
      const fin = (i) => run.finish[i] && !S[i].out;
      const ord = alive.slice().sort((a, b) => (fin(a) || fin(b) ? (fin(a) ? this.finalOrder.indexOf(a) : 99) - (fin(b) ? this.finalOrder.indexOf(b) : 99) || S[b].pos - S[a].pos : S[b].pos - S[a].pos));
      /* 画面で見える前後の順（2026-11-20 直し・不具合 E4）: 順位の表示（左上の 1〜3 位・下の順位の丸・オッズの札）はこちらを元にする（shownOrder）。
         ord（走りの計算の進み run.pos の順）は、直線の途中で画面の艇の前後と数 m 食い違うことがある（艇は自分の線の上を、ターンごとの区間の終わりで計算と合うように進むため。
         例: 種 14 の 5 秒目、4 号艇は画面でいちばん後ろなのに計算では 3 番手）。カメラと実況は今までどおり ord（映像・音を変えない） */
      const ordV = alive.slice().sort((a, b) => (fin(a) || fin(b) ? (fin(a) ? this.finalOrder.indexOf(a) : 99) - (fin(b) ? this.finalOrder.indexOf(b) : 99) || S[b].vis - S[a].vis : S[b].vis - S[a].vis));
      const mean = (idx) => { const o = { x: 0, z: 0 }; idx.forEach((i) => { o.x += S[i].x / idx.length; o.z += S[i].z / idx.length; }); return o; };
      const onAll = S.map((_, i) => i).filter((i) => S[i].on);
      return { t, S, ord, ordV, lead: S[ord[0]] || S[0], second: S[ord[1]] || S[ord[0]] || S[0], third: S[ord[2]] || S[ord[1]] || S[0], last: S[ord[ord.length - 1]] || S[0], cen: mean(ord.slice(0, 4).length ? ord.slice(0, 4) : [0]), all: mean(onAll.length ? onAll : [0]) };
    }
    /* ---------- カットの時刻表を先に作る（04 ⑦ 7-5 の「始まる条件」を 0.1 秒きざみで調べる。途中から見ても同じカットになる） ---------- */
    timeline() {
      const G = this.G, cuts = (this.plan && this.plan.cuts) || [-27, -22.5], list = [];
      // レース前は進路の計画のカット（艇の位置が飛ぶ時刻）に合わせる: ピット → 待機行動（高い所 → 浮き越しの低い所）→ 助走
      const steps = [
        /* レース前（100 秒・カットで飛ばさない）。場面は進路の計画の plan.segments: pit −100〜−93（−99.4 に合図）／buoy −93〜−79／back −79〜−43／turn2 −43〜−24／wait −24〜−12.5／runup −12.5〜0。
           カメラは本物の中継の作り（04 ⑦ 7-1・7-2）: ピットの 6 人 → 正面から出てくる 6 艇 → スタンドの高い所からの引き（待機行動）と、ときどき選手の寄り → −14.6 から屋根のカメラで助走 */
        { id: 'pit', when: () => true },
        { id: 'pit-front', when: (s) => s.t >= -97.6 },
        { id: 'wait-high', when: (s) => s.t >= -93 },
        // 待機行動はスタンドの高い所の 1 台で長く追う（オーナー 2026-11-17「カメラの切り替えが多い」。選手の寄りは入れない）
        { id: 'approach', when: (s) => s.t >= -14.6 },
        { id: 'm1-A', when: (s) => s.t >= 1.5 && (s.last.x >= 30 || s.t >= 2.4) },
        { id: 'back-A', when: (s) => (s.last.z < 0 && s.last.x <= 142) || (s.lead.z < 0 && s.lead.x <= 10) }, // 最後の艇が 1 マークを回りきってから（先頭がバックの半ばまで行ったら待たない）
        { id: 'm2-A', when: (s) => s.lead.z < 0 && s.lead.x <= -40 },
        { id: 'home-wide', when: (s) => s.lead.z > 0 && s.lead.x >= -135 },
        { id: 'lead-front', when: (s, t0) => s.t >= t0 + 1.2 },
        { id: 'home-in', when: (s, t0) => s.t >= t0 + 1.8 },
        { id: 'm1-B', when: (s) => s.lead.z > 0 && s.lead.x >= -20 },
        { id: 'back-B', when: (s) => s.lead.z < 0 && s.lead.x <= 135 },
        { id: 'side-123', when: (s) => s.lead.z < 0 && s.lead.x <= 45 },
        { id: 'm2-B', when: (s) => s.lead.z < 0 && s.lead.x <= -55 },
        { id: 'finish', when: (s) => s.t >= G - 9 && (s.second.x <= C.MARK2.x || s.second.z > 0 || s.t >= G - 6.5) },
        { id: 'winner', when: (s) => s.t >= G + 5 },
      ];
      if (PRE_T < 90) steps.splice(1, 2, { id: 'wait-high', when: (s) => s.t >= cuts[0] }, { id: 'wait-low', when: (s) => s.t >= -16.8 }); // 短いレース前（テスト用）
      let k = 0, t0 = -PRE_T; list.push({ t: -PRE_T, id: steps[0].id, ev: {} });
      for (let t = -PRE_T; t <= G + POST_T; t += 0.1) {
        const s = this.stateAt(t), cur = list[list.length - 1];
        // カットの中のきっかけ（画角を変える時刻）を覚える
        if (cur.id === 'm1-A' && cur.ev.pass == null && s.lead.x >= 110) cur.ev.pass = t;
        if ((cur.id === 'm2-A' || cur.id === 'm2-B') && cur.ev.mark == null && s.lead.x <= C.MARK2.x) cur.ev.mark = t;
        if (cur.id === 'm2-B' && cur.ev.out == null && cur.ev.mark != null && s.lead.z > 0 && s.lead.x >= C.MARK2.x) cur.ev.out = t;
        if (cur.id === 'm1-B' && cur.ev.pass == null && s.lead.x >= 115) cur.ev.pass = t;
        if (k + 1 < steps.length && steps[k + 1].when(s, t0)) { k++; t0 = t; list.push({ t, id: steps[k].id, ev: { lx: s.lead.x, lz: s.lead.z, boat: steps[k].boat ? steps[k].boat() : -1 } }); }
      }
      this.shots = list;
    }
    shotAt(tt) { let cur = this.shots[0]; for (const s of this.shots) if (tt >= s.t) cur = s; return cur; }
    /* ---------- カメラ（04 ⑦ 7-5。位置はカットの間ずっと固定。向ける先と画角だけ動く） ---------- */
    direct(dt) {
      const tt = this.tt, s = this.state, sh = this.shotAt(tt), e = tt - sh.t, G = this.G, P = this.PIT, g = P.gap, ox = P.out ? P.out.x : 1, oz = P.out ? P.out.z : 0;
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      /* 画角を「映したい艇の集まりが、画面の幅の frac を占める」ように決める（04 ⑦ の実測は、画角そのものより「集団が幅の何 %・艇 1 つが幅の何 %」で書いてある）。
         p: カメラの位置、L: 向ける先、pts: 映したい艇、frac: 幅に占める割合、lo〜hi: 実測の画角の範囲（縦の画角・度）。艇の長さ 2.9m ぶんの余白を足す */
      const fit = (p, L, pts, frac, lo, hi) => {
        const fx = L[0] - p[0], fz = L[2] - p[2], fl = Math.hypot(fx, fz) || 1, rx = -fz / fl, rz = fx / fl; let a0 = 1e9, a1 = -1e9;
        pts.forEach((b) => { const dx = b.x - p[0], dz = b.z - p[2], f = (dx * fx + dz * fz) / fl, r = dx * rx + dz * rz, d = Math.hypot(f, p[1]) || 1; [-1.6, 1.6].forEach((m) => { const a = Math.atan2(r + m, d); if (a < a0) a0 = a; if (a > a1) a1 = a; }); });
        const hfov = (a1 - a0) / frac; let v = 2 * Math.atan(Math.tan(hfov / 2) * H / W) * 180 / Math.PI;
        // 上下にも入るように（画面の上 14% と下 12% はテロップなので、真ん中の 6 割に収める）: 向ける先の見下ろしの角度と、各艇の見下ろしの角度の差
        const pc = Math.atan2(p[1] - (L[1] || 0), fl); let dv = 0; pts.forEach((b) => { const f = Math.hypot(b.x - p[0], b.z - p[2]) || 1; [-1.6, 1.6].forEach((m) => { dv = Math.max(dv, Math.abs(Math.atan2(p[1], Math.max(1, f + m)) - pc)); }); });
        v = Math.max(v, 2 * dv / 0.6 * 180 / Math.PI); return clamp(v, lo, hi);
      };
      const everyB = s.S.filter((b) => b.on); // 映っている艇ぜんぶ（フライング・転覆の艇も）
      const top = (k) => s.ord.slice(0, k).map((i) => s.S[i]), allB = s.ord.map((i) => s.S[i]);
      const ctr = (pts) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; pts.forEach((b) => { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x); z0 = Math.min(z0, b.z); z1 = Math.max(z1, b.z); }); return [(x0 + x1) / 2, 0, (z0 + z1) / 2]; }; // 集まりの真ん中（順位が入れ替わっても跳ねない）
      let pos, look, fov;
      switch (sh.id) {
        case 'pit': pos = [P.x + ox * 6 + P.dirX * (5 * g + 7), 2.2, P.z + oz * 6 + P.dirZ * (5 * g + 7)]; look = [P.x + ox * 1 + P.dirX * 2 * g, 1.0, P.z + oz * 1 + P.dirZ * 2 * g]; fov = 19.8; break;
        case 'pit-front': { const on = s.S.filter((b) => b.on); pos = [P.x + ox * 60 + P.dirX * 2.5 * g, 9, P.z + oz * 60 + P.dirZ * 2.5 * g]; look = ctr(on); look[1] = 1.0; fov = fit(pos, look, on, 0.4, 6, 11.7); break; } // 正面から出てくる 6 艇（集団が幅の 30 → 45%）
        case 'wait-close': { const b = s.S[sh.ev.boat >= 0 ? sh.ev.boat : this.entry[0]]; pos = [C.X_MIN + 6, 3, 30]; look = [b.x, 0.9, b.z]; fov = fit(pos, look, [b], 0.3, 1.0, 5); break; } // 待機中の選手の寄り（低い位置の望遠）
        case 'wait-split': case 'wait-high': { const on = s.S.filter((b) => b.on); pos = K3; look = ctr(on); { let nb = on[0], nd = 1e9; on.forEach((b) => { const d = Math.hypot(b.x - pos[0], b.z - pos[2]); if (d < nd) { nd = d; nb = b; } }); if (nb) { look[0] = lerp(look[0], nb.x, 0.35); look[2] = lerp(look[2], nb.z, 0.35); } } /* 手前の艇が名前の列に隠れないよう、少し手前を見る */ fov = fit(pos, look, on, 0.7, 4, 34); break; } // 内 3 艇と外 3 艇が大きく離れる（80m 以上）ので、全部入る画角まで引く
        case 'wait-low': { const sl = this.entry.slice(0, 3).map((i) => s.S[i]); pos = [C.X_MIN + 6, 3, 30]; look = ctr(sl); look[1] = 0.9; fov = fit(pos, look, sl, 0.55, 1.5, 8); break; } // 舳先を向けて待つ内 3 艇
        case 'approach': { const on = s.S.filter((b) => b.on); pos = K1; look = ctr(on); look[2] = lerp(look[2], 27, 0.5); fov = fit(pos, look, on, tt > -2 ? 0.5 : 0.6, 7, 60); break; } // 助走（スタートの瞬間は真下を通るので余白を広く）: 6 艇が幅の 6 割（本物は固定の画角で、前半は艇がとても小さい。オーナー「まだ遠い場面がある」）
        case 'm1-A': pos = K2; look = ctr(everyB); fov = fit(pos, look, everyB, 0.72, 6, 60); break; // スタートから 1 マークを回りきるまでは、全部の艇が常に映る（オーナー 2026-11-17） // 向かってくる 6 艇が幅の 80〜90% → 1 マークは艇 1 つが幅の 7〜8%
        case 'back-A': { pos = K4; look = ctr(allB); look[1] = 0.5; fov = fit(pos, look, allB, lerp(0.55, 0.7, sm(e / 6)), 4, 14.7); break; } // 集団が幅の 55 → 82%
        case 'm2-A': { const t4 = top(4); pos = K3; look = ctr(t4); fov = sh.ev.mark != null && tt >= sh.ev.mark && tt < sh.ev.mark + 1.5 ? fit(pos, look, top(3), 0.55, 5, 10) : fit(pos, look, t4, 0.65, 5, 15.2); break; } // 先頭がマークの真横の 1.5 秒は寄る（艇 1 つが幅の 14%）
        case 'home-wide': { const t4 = top(4); pos = K1; look = ctr(t4); fov = fit(pos, look, t4, 0.6, 6, 17.2); break; }
        case 'lead-front': pos = [sh.ev.lx + 150, 2.5, sh.ev.lz]; look = [s.lead.x, 0.8, s.lead.z]; fov = 1.2; break;
        case 'home-in': pos = K1; look = ctr(allB); fov = fit(pos, look, allB, 0.68, 6, 21.4); break; // 列が幅の 80%
        case 'm1-B': {
          pos = K2; const far = Math.hypot(s.lead.x - s.second.x, s.lead.z - s.second.z) > 15, m23 = mid(s.second, s.third);
          if (sh.ev.pass != null && tt >= sh.ev.pass) { const pts = far ? s.ord.slice(1, 4).map((i) => s.S[i]) : top(4); look = ctr(pts); fov = fit(pos, look, pts, 0.62, 6, 18); }
          else if (e > 3) { look = [m23.x, 0, m23.z]; fov = fit(pos, look, [s.second, s.third], 0.4, 3.5, 8); } else { look = ctr(allB); fov = fit(pos, look, allB, 0.68, 5, 12); }
          break;
        }
        case 'back-B': { const t3 = top(3); pos = K4; look = ctr(t3); look[1] = 0.5; fov = fit(pos, look, t3, 0.6, 4, 14.7); break; }
        case 'side-123': { const a = s.lead, b = s.second, k = sm((e - 2.3) / 0.5); pos = K4; look = [lerp(a.x, b.x, k), 0.8, lerp(a.z, b.z, k)]; fov = 1.9; break; }
        case 'm2-B': pos = K3; if (sh.ev.out != null && tt >= sh.ev.out) { look = [s.second.x, 0, s.second.z]; fov = 9.7; } else { look = [s.lead.x, 0, s.lead.z]; fov = sh.ev.mark != null && tt >= sh.ev.mark ? 6.7 : 4.8; } break;
        case 'finish': {
          pos = K1;
          if (e < 1.2) { const t3 = top(3); look = ctr(t3); fov = fit(pos, look, t3, 0.6, 6, 17.2); }
          else if (tt < G - 2) { look = [s.lead.x, 0, s.lead.z]; fov = 3.8; }
          else { const k = sm((tt - (G - 2)) / 1.6); look = [lerp(s.lead.x, 0, k), 0, lerp(s.lead.z, 24, k)]; fov = lerp(3.8, 17, k); if (k >= 1) { look = [0, 0, 24]; fov = 17; } }
          break;
        }
        default: { const w = s.S[this.finalOrder[0]]; pos = K4; look = [w.x, 1.0, w.z]; fov = lerp(1.9, 1.0, sm(e / 3)); }
      }
      const Q = this.cam, cut = !Q || Q.id !== sh.id || Q.t0 !== sh.t || dt <= 0;
      if (cut) this.cam = { id: sh.id, t0: sh.t, look: look.slice(), raw: look.slice(), vel: [0, 0, 0], fov, fovT: fov };
      else { // ゆっくり追うが、置いていかれないよう「狙いの動く速さ」ぶん先を見る（全速の艇は 1 秒に 22m 進むので、遅れると画面から出てしまう）
        const TAU = 0.7, k = 1 - Math.exp(-dt / TAU), kf = 1 - Math.exp(-dt / 1.6), kv = 1 - Math.exp(-dt / 0.35);
        for (let a = 0; a < 3; a++) { const vel = clamp((look[a] - Q.raw[a]) / dt, -40, 40); Q.vel[a] += (vel - Q.vel[a]) * kv; Q.raw[a] = look[a]; Q.look[a] += (look[a] + Q.vel[a] * TAU - Q.look[a]) * k; } if (Math.abs(fov - Q.fovT) > Q.fovT * 0.04) Q.fovT = fov; Q.fov += (Q.fovT - Q.fov) * kf; }
      // スタートの 3 秒前〜1 マークを回りきるまでは、全部の艇が常に映る: いま向いている先のままで全艇が入る画角を出し、足りなければ待たずにすぐ引く（寄るのはゆっくり）
      if (sh.id === 'm1-A' || (sh.id === 'approach' && tt > -3)) { const need = fit(pos, this.cam.look, everyB, 0.86, 6, 75); if (need > this.cam.fov) { this.cam.fov = need; this.cam.fovT = Math.max(this.cam.fovT, need); } }
      const cam = this.camera, Z = this.cam;
      cam.position.set(pos[0], pos[1], pos[2]); cam.fov = Z.fov; cam.updateProjectionMatrix(); cam.lookAt(Z.look[0], Z.look[1], Z.look[2]);
      this.shot = sh.id; this.cutNow = cut;
      this.marksOn = sh.id === 'approach';
      // 小窓（G−4.3〜G+5）: 先頭の正面ドアップ（04 ⑦ 7-3）
      this.pip = tt >= G - 4.3 && tt < G + 5 && sh.id === 'finish';
      if (this.pip) { const w = s.S[this.finalOrder[0]], c2 = this.cam2, hx = Math.cos(w.yaw), hz = -Math.sin(w.yaw); c2.position.set(w.x + hx * 120, 2.5, w.z + hz * 120); c2.lookAt(w.x, 0.8, w.z); }
    }
    /* 順位の表示に使う並び: 画面で見える前後（state.ordV）を元に、いま出している並びの隣どうしを「後ろの艇が ORD_H m より前に出た時」だけ入れ替える。
       ゴールした艇は着順のまま先頭へ。止めている時・時刻が飛んだ時・艇の顔ぶれが変わった時（フライングの発表・転覆）は、その時の並びに合わせ直す */
    shownOrder(s) {
      const V = s.ordV || s.ord, run = this.run, tt = this.tt, K = this.ordK;
      const same = K && this.live && Math.abs(tt - K.t) < 0.5 && K.ord.length === V.length && K.ord.every((i) => V.indexOf(i) >= 0);
      let o;
      if (!same) o = V.slice();
      else {
        const fin = (i) => !!run.finish[i], done = V.filter(fin), rest = K.ord.filter((i) => !fin(i)); // V の中でゴールした艇は、もう着順の並び
        const lead = rest.length ? s.S[rest[0]] : null, H = lead && DIST_M - lead.pos * DIST_M < ORD_GOAL_M ? ORD_H_GOAL : ORD_H;
        for (let pass = 0; pass < rest.length; pass++) { let any = false; for (let k = 0; k + 1 < rest.length; k++) if (s.S[rest[k + 1]].vis > s.S[rest[k]].vis + H) { const x = rest[k]; rest[k] = rest[k + 1]; rest[k + 1] = x; any = true; } if (!any) break; }
        o = done.concat(rest);
      }
      this.ordK = { t: tt, ord: o }; this.ordShown = o;
      return o;
    }
    /* ---------- 艇を置く ---------- */
    place(dt) {
      const s = this.state = this.stateAt(this.tt), run = this.run, n = this.n, inc = run.incident, list = [];
      s.ord.forEach((i, k) => { this.rank[i] = k; });
      for (let i = 0; i < n; i++) {
        const p = s.S[i], v = this.vis[i]; let flip = 0;
        if (p.out && inc && inc.type === 'fall' && run.fallT != null) flip = sm((this.tt - run.fallT) / 0.9);
        const accel = dt > 0 && v.sp0 != null ? clamp((p.speed - v.sp0) / dt, -30, 30) : 0; v.acc = v.acc == null || dt <= 0 ? accel : v.acc + (accel - v.acc) * Math.min(1, dt / 0.12); v.sp0 = p.speed; // 前後の加速度（減速がマイナス）。艇の姿勢（舳先の上下・しぶき）に使う
        v.x = p.x; v.z = p.z; v.yaw = p.yaw; v.speed = p.speed; v.turn = Math.abs(p.turn || 0); v.flip = flip; v.on = p.on;
        const o = this.boats[i].object3d; o.visible = p.on; o.position.set(p.x, 0, p.z); o.rotation.y = p.yaw;
        try { this.boats[i].update(dt, { speed: p.speed, turn: v.turn * (1 - flip), flip, t: this.tt, accel: v.acc || 0, slip: p.slip || 0, turnDir: p.turnDir || 0, phase: p.phase }); } catch (e) { }
        list.push({ x: p.x, z: p.z, hx: Math.cos(p.yaw), hz: -Math.sin(p.yaw), speed: p.speed, turn: v.turn, flip, on: p.on });
      }
      // 進路の計画のカット（レース前の時刻の飛び）をまたいだら、航跡を消す
      const cuts = (this.plan && this.plan.cuts) || []; let jumped = dt <= 0;
      cuts.forEach((c) => { if (this.prevT != null && this.prevT < c && this.tt >= c) jumped = true; });
      if (jumped) { try { this.wake.reset(); } catch (e) { } }
      try { this.wake.update(Math.max(0, dt), list); } catch (e) { }
      this.prevT = this.tt;
    }
    /* 時刻を飛ばす。2026-11-20 直し（不具合 D6・E の疑い）: 映像を流している途中（直前が tick）の「少しだけ先へ」（SOFT_SEEK 秒まで）は、カメラを寄せ直さず・航跡も消さずに、
       その間を細かく進めてつなぐ（遅いテレビが時刻合わせで 0.6 秒ずつ飛ばすたびに、カメラが切り替わり航跡が消えていた）。大きく飛ぶ・戻る・止めている時は今までどおり、その時刻の絵に切り替える */
    seek(tt) {
      const d = tt - this.tt;
      if (this.live && this.prevT != null && d > 0 && d <= SOFT_SEEK) { this.advance(d); return; }
      this.live = false; this.capCur = null; this.cam = null; this.prevT = null; this.tt = tt; this.place(0); this.direct(0); this.draw(0);
    }
    tick(dt) { this.advance(clamp(dt, 0, 0.1) * this.speedK); }
    /* dt 秒進めて 1 回描く。STEP_MAX（0.1 秒）より長い時は、艇・カメラ・航跡だけ細かく分けて進める（描くのは最後の 1 回。早回し speedK・遅いテレビの追いつき） */
    advance(dt) {
      this.live = dt > 0;
      const n = Math.max(1, Math.ceil(dt / STEP_MAX - 1e-9)), h = dt / n;
      for (let q = 0; q < n; q++) { this.tt += h; this.place(h); this.direct(h); }
      this.draw(dt);
    }
    /* テレビ用: 映像の時刻を target（秒）に合わせる。毎コマ呼ぶ。少し遅れているだけなら、その分だけ進める（遅いテレビでも時計どおりに進み、飛ばない）。
       少し進みすぎ（0.25 秒まで）は 1 コマ待つ。大きくずれた時（読み込み直し・時計の合わせ直し）だけ、その時刻へ切り替える */
    syncTo(target) {
      const d = target - this.tt;
      if (this.prevT != null && d > 1e-4 && d <= SOFT_SEEK) this.advance(d);
      else if (this.prevT != null && d <= 1e-4 && d >= -0.25) { /* 待つ（描き直さない） */ }
      else { this.live = false; this.seek(target); }
    }
    draw(dt) {
      const tt = this.tt, r = this.renderer; this.perfTick();
      // 大時計: 黄色い針は 12 秒で 1 周・スタートで真上（止めずに回し続ける）、白い針は 60 秒で 1 周
      try { if (tt < 1) { this.venue.setClock((((-tt) % 12) + 12) % 12); if (this.venue.setClock60) this.venue.setClock60(Math.max(0, -tt)); } else this.venue.setClock(null); } catch (e) { }
      try { this.venue.update(dt, tt + PRE_T, this.camera); } catch (e) { }
      const size = r.getSize(new T.Vector2());
      this.marks.visible = !!this.marksOn;
      this.updateTags(dt);
      r.setScissorTest(false); r.setViewport(0, 0, size.x, size.y); r.render(this.scene, this.camera);
      if (this.pip) { // 小窓: x60.2〜97.7%・y5.2〜42%
        const x = 0.602 * size.x, w = 0.375 * size.x, h = 0.368 * size.y, y = size.y - PIP_Y * size.y - h;
        r.setScissorTest(true); r.setScissor(x, y, w, h); r.setViewport(x, y, w, h); this.marks.visible = false;
        const tv = this.tags && this.tags.visible; if (tv) this.tags.setVisible(false); // 小窓（先頭の正面の大写し）には輪と札を出さない
        r.render(this.scene, this.cam2); if (tv) this.tags.setVisible(true); r.setScissorTest(false); r.setViewport(0, 0, size.x, size.y);
      }
      this.drawHud();
    }
    /* ---------- 艇番の輪と札（BOAT.Tags）: 出す艇と全体の濃さを決めて、毎コマ置き直す ----------
       出さない: ピットに止まっている間（'pit'）・ゴールの 3 秒後から（勝者の大写し・結果）・フライングで外れた艇・転覆した艇・映っていない艇 */
    updateTags(dt) {
      const tg = this.tags; if (!tg || !this.state) return;
      const tt = this.tt, sh = this.shot, want = sh === 'pit' || tt >= this.G + 3 ? 0 : 1;
      this.tagK = dt <= 0 ? want : this.tagK + clamp(want - this.tagK, -dt / 0.6, dt / 0.6);
      const list = this.vis.map((v, i) => { const p = this.state.S[i]; return { x: v.x, z: v.z, yaw: v.yaw, show: !!(v.on && p && !p.out && !(v.flip > 0.02)) }; });
      try { tg.update(this.camera, list, this.tagK, dt); } catch (e) { if (!this.tagErr) { this.tagErr = 1; console.warn('BOAT.Tags.update', e); } }
    }
    /* ---------- レース中の画面表示（2026-11-19 オーナー「割と競馬に寄せていい。レース中の画面下の順位の表示とか」）。js/race3d.js の drawHud・clockBox と v2 のテレビの左上の順位の札に合わせた:
       左上 … 1〜3 位（「1位」の字・艇番の丸・選手名）。入れ替わりは 0.3 秒続いたら（ちらつかない）
       右上 … 「TIME 0:22.0」の紺の札（ゴールで止めて金色）。下に周回（1周目・2周目＝最終周は金色）。小窓（先頭の大写し）が出ている間は TIME だけ
       下   … 順位の丸の列（色の艇番の丸が順位順。間は艇の差で広がる。1 位は金・2 位は銀の縁と「1位」「2位」の札。順位が変わると丸がすべって入れ替わる。画面で艇が走る向きに先頭）
       左下 … casa BOAT のロゴとレースの名前・距離・天気。右下 … コースの小さな図（1 マーク・2 マーク・スタートの線・先頭の位置）と距離・先頭の速さ */
    drawRaceHud(c) {
      const tt = this.tt, race = this.race, run = this.run, G = this.G, s = this.state, Hh = race.horses, LAPS = (M && M.LAPS) || 2, DIST = (M && M.DIST) || 1401;
      const NOTO = '"Noto Sans JP",' + FONT, nowMs = performance.now();
      const rr = (x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
      const tvText = (txt, x, y, size, col, align, maxW) => { c.font = 'bold ' + Math.round(size) + 'px ' + NOTO; c.textAlign = align || 'left'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = Math.max(3, size * 0.26); c.strokeStyle = 'rgba(0,0,0,.75)'; c.strokeText(txt, x, y, maxW); c.fillStyle = col || '#fff'; c.fillText(txt, x, y, maxW); };
      const chip = (x, y, r, h) => { c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r + 1.6, 0, 6.2832); c.fill(); c.fillStyle = h.color; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1; c.stroke();
        c.fillStyle = h.ink; c.font = '900 ' + Math.round(r * 1.3) + 'px ' + NOTO; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(h.no, x, y + 0.5); };
      const out = (i) => !!(s.S[i] && s.S[i].out); // 外れた艇（その出来事の時刻から）
      const ordV = this.shownOrder(s);             // 画面で見える前後の順（並んだ艇がちらちら入れ替わらないようにした物）
      // 消えるとき: ゴールの 4 秒後から 0.8 秒で（勝者の名札の前に片付ける）
      const fa = clamp((G + 5 - tt) / 0.8, 0, 1), sa = clamp((tt - 2.1) / 0.5, 0, 1);
      // 下の帯（うすい黒のグラデーション）
      c.globalAlpha = fa; if (!this.hudBand) { this.hudBand = c.createLinearGradient(0, H - 92, 0, H); this.hudBand.addColorStop(0, 'rgba(0,0,0,0)'); this.hudBand.addColorStop(1, 'rgba(0,0,0,.42)'); } c.fillStyle = this.hudBand; c.fillRect(0, H - 92, W, 92);
      // ---- 左下: ロゴとレースの名前 ----
      { const lx = 14, ly = H - 52; c.fillStyle = '#e9c24a'; c.beginPath(); c.arc(lx + 16, ly, 16, 0, 6.2832); c.fill(); c.strokeStyle = '#a8842a'; c.lineWidth = 1.5; c.stroke();
        c.fillStyle = '#5a4210'; c.font = '900 11px ' + NOTO; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('casa', lx + 16, ly + 0.5, 28);
        c.save(); c.translate(lx + 38, ly + 1); c.transform(1, 0, -0.18, 1, 0, 0); tvText('BOAT', 0, 0, 24, '#ffffff', 'left'); c.restore();
        const sky = { sunny: '晴', cloudy: '曇', rain: '雨' }[race.weather] || '';
        tvText('casa競艇場  ' + (race.distLabel || 1200) + 'm  ' + sky, 18, H - 17, 14, '#eeeeee', 'left', 190); }
      if (!ordV.length) { c.globalAlpha = 1; return; }
      // ---- 右上: TIME の札（js/race3d.js の clockBox と同じ形） ----
      { let ld = 0; for (let i = 0; i < this.n; i++) if (!out(i)) ld = Math.max(ld, run.pos[i]);
        const lap = Math.min(LAPS, 1 + Math.floor(Math.max(0, ld) * LAPS + 1e-6)), fin = tt >= G, t = Math.max(0, Math.min(tt, G));
        const bw = 176, bx = W - 14 - bw; let y = 10;
        const panel = (h) => { c.fillStyle = 'rgba(20,36,54,.86)'; rr(bx, y, bw, h, 4); c.fill(); c.fillStyle = '#f2b705'; c.fillRect(bx, y, 4, h); };
        panel(40); c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = '900 11px ' + NOTO; c.fillStyle = '#9fb3d9'; c.fillText('TIME', bx + 12, y + 21);
        const tf = (fin ? Math.round(t * 10) : Math.floor(t * 10)) / 10, mm = Math.floor(tf / 60), ss = tf - mm * 60;
        c.textAlign = 'right'; c.font = '900 26px ' + NOTO; c.fillStyle = fin ? '#ffd54f' : '#ffffff'; c.fillText(mm + ':' + (ss < 10 ? '0' : '') + ss.toFixed(1), bx + bw - 10, y + 21.5, bw - 58);
        y += 44;
        if (!this.pip) { panel(28); const last = lap >= LAPS && !fin; c.textAlign = 'left'; c.font = 'bold 13px ' + NOTO; c.fillStyle = '#9fb3d9'; c.fillText(fin ? 'ゴール' : last ? '最終周' : '周回', bx + 14, y + 14.5);
          c.textAlign = 'right'; c.font = '900 20px ' + NOTO; c.fillStyle = last || fin ? '#ffe14a' : '#ffffff'; c.fillText(lap + '周目', bx + bw - 12, y + 15); } }
      // ---- 左上: 1〜3 位（v2 のテレビの順位の札と同じ紺の札・金の線） ----
      { const top = ordV.slice(0, 3), key = top.join(','), R = this.rk || (this.rk = { key: '', cand: '', since: 0 }), fins = ordV.some((i) => run.finish[i]);
        if (key !== R.cand) { R.cand = key; R.since = tt; }
        if (!R.key || (key !== R.key && (tt - R.since >= 0.3 || fins)) || Math.abs(tt - (R.at || tt)) > 1) R.key = key; R.at = tt;
        const show = R.key.split(',').map(Number).filter((i) => i >= 0 && i < this.n), px = 14, py = 12, pw = 206, rh = 32, ph = 10 + rh * show.length;
        c.globalAlpha = fa * sa; c.fillStyle = 'rgba(20,36,54,.88)'; rr(px, py, pw, ph, 8); c.fill(); c.fillStyle = '#f2b705'; rr(px, py, 4, ph, 2); c.fill();
        show.forEach((i, k) => { const y = py + 5 + rh * k + rh / 2, h = Hh[i];
          c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = '900 22px ' + NOTO; c.fillStyle = k === 0 ? '#f2b705' : '#e8eef8'; c.fillText(String(k + 1), px + 16, y + 1);
          c.font = '800 13px ' + NOTO; c.fillStyle = '#9fb3d9'; c.fillText('位', px + 31, y + 3);
          chip(px + 64, y, 12, h); c.font = 'bold 16px ' + NOTO; c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(h.name, px + 84, y + 1, pw - 96); }); }
      // ---- 下: 順位の丸の列（js/race3d.js の通過順の帯と同じ動き） ----
      c.globalAlpha = fa * sa;
      const order = ordV.slice(), gone = []; for (let i = 0; i < this.n; i++) if (order.indexOf(i) < 0 && (s.S[i].on || out(i))) gone.push(i);
      const nn = order.length - 1, EMK = [1.2, 1.1], RANK_COL = ['#f2b705', '#c9d3de'], xo = (k) => (k >= 1 ? 3 : 0) + (k >= 2 ? 7 : 0), cap = 420 - xo(nn);
      const ex = [0]; for (let k = 1; k < order.length; k++) ex.push(ex[k - 1] + Math.min(40, Math.max(0, s.S[order[k - 1]].vis - s.S[order[k]].vis) * 4)); // 間は画面で見える前後の差（m）
      const stp = nn > 0 ? Math.min(25, cap / nn) : 0, esc = Math.min(1, Math.max(0, cap - stp * nn) / (ex[ex.length - 1] || 1)), x0 = 240;
      // 画面で艇が走っている向きに先頭を置く（先頭の進む向きをカメラの右に投影。カットが変わったらすぐ、同じカットの中でははっきり傾いたときだけ）
      const L0 = s.S[order[0]], cr = new T.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0), along = Math.cos(L0.yaw) * cr.x - Math.sin(L0.yaw) * cr.z, ck = (this.cam ? this.cam.id + this.cam.t0 : '') + '';
      if (this.ordDir == null || ck !== this.ordMode) { this.ordDir = along >= 0 ? 1 : -1; this.ordMode = ck; } else if (Math.abs(along) > 0.3) this.ordDir = along > 0 ? 1 : -1;
      const span = stp * nn + (ex[ex.length - 1] || 0) * esc + xo(nn), toR = this.ordDir > 0, chipX = (k) => (toR ? x0 + span - (k * stp + ex[k] * esc + xo(k)) : x0 + k * stp + ex[k] * esc + xo(k));
      const r0 = 11.5, aw = r0 * EMK[0] + 9.5; c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath();
      if (toR) { const ax = chipX(0) + aw; c.moveTo(ax, H - 31); c.lineTo(ax - 7, H - 37); c.lineTo(ax - 7, H - 25); } else { const ax = x0 - aw; c.moveTo(ax, H - 31); c.lineTo(ax + 7, H - 37); c.lineTo(ax + 7, H - 25); }
      c.fill();
      const dtO = this.ordT && this.live ? Math.min(0.1, Math.max(0, (nowMs - this.ordT) / 1000)) : 1; this.ordT = nowMs;
      if (!this.ordX || this.ordSnap !== ck + ':' + toR) { this.ordX = []; this.ordS = []; this.ordSnap = ck + ':' + toR; }
      const fol = 1 - Math.exp(-dtO * 11), slots = [];
      order.forEach((bi, k) => { const tx = chipX(k), ts = EMK[k] || 1; if (this.ordX[bi] == null) { this.ordX[bi] = tx; this.ordS[bi] = ts; } const mv = tx - this.ordX[bi]; this.ordX[bi] += mv * fol; this.ordS[bi] += (ts - this.ordS[bi]) * fol; slots.push({ bi, k, x: this.ordX[bi], s: this.ordS[bi], lift: Math.min(7, Math.abs(mv) * 0.35) }); });
      slots.sort((a, b) => (a.lift > 1 ? 1 : 0) - (b.lift > 1 ? 1 : 0) || b.k - a.k);
      for (const sl of slots) {
        const k = sl.k, r = r0 * sl.s, y = H - 31 - sl.lift;
        if (k < 2) { c.fillStyle = RANK_COL[k]; c.beginPath(); c.arc(sl.x, y, r + 2.2, 0, 6.2832); c.fill(); }
        chip(sl.x, y, r, Hh[sl.bi]);
        if (k < 2) { const fs2 = 8, pw = fs2 * 2.3, ph2 = fs2 + 4, py = y - r - 2.2 - ph2 - 1.5; c.fillStyle = RANK_COL[k]; rr(sl.x - pw / 2, py, pw, ph2, ph2 / 2); c.fill(); c.fillStyle = '#142436'; c.font = '900 ' + fs2 + 'px ' + NOTO; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText((k + 1) + '位', sl.x, py + ph2 / 2 + 0.5); }
      }
      // 外れた艇（フライング・転覆）は列の後ろに薄く
      gone.forEach((bi, j) => { const x = toR ? x0 - 30 - j * 24 : x0 + span + 30 + j * 24; c.globalAlpha = fa * sa * 0.4; chip(x, H - 31, 9, Hh[bi]); });
      c.globalAlpha = fa;
      // ---- 右下: コースの小さな図（マークの間 300m を横に。スタンド側が下）と距離・速さ ----
      { const mx = W - 92, my = H - 42, sx = 0.4, rz = 9, zk = (z) => clamp(z / 40, -1, 1) * rz;
        c.lineCap = 'round'; c.lineJoin = 'round';
        const path = () => { c.beginPath(); c.moveTo(mx - 150 * sx, my + rz); c.lineTo(mx + 150 * sx, my + rz); c.arc(mx + 150 * sx, my, rz, Math.PI / 2, -Math.PI / 2, true); c.lineTo(mx - 150 * sx, my - rz); c.arc(mx - 150 * sx, my, rz, -Math.PI / 2, Math.PI / 2, true); c.closePath(); };
        path(); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 7; c.stroke(); c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 3.5; c.stroke();
        c.fillStyle = '#ff5252'; c.fillRect(mx - 1.5, my + rz - 7, 3, 14); // スタート＝ゴールの線
        [[150, '1M'], [-150, '2M']].forEach((m) => { const x = mx + m[0] * sx; c.fillStyle = '#ff8a1e'; c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.beginPath(); c.arc(x, my, 3.2, 0, 6.2832); c.fill(); c.stroke(); tvText(m[1], x + (m[0] > 0 ? -14 : 14), my - rz - 9, 10, '#ffffff', 'center'); });
        const lp = s.S[order[0]]; c.fillStyle = '#ffd54f'; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(mx + clamp(lp.x, -166, 166) * sx, my + zk(lp.z), 4.5, 0, 6.28); c.fill(); c.stroke();
        tvText(LAPS + '周 ' + (race.distLabel || 1200).toLocaleString() + 'm', W - 186, H - 13, 14, '#fff', 'left');
        tvText((Math.max(0, lp.speed || 0) * 3.6).toFixed(1) + 'km/h', W - 16, H - 13, 14, '#fff', 'right'); }
      c.globalAlpha = 1;
    }
    /* ---------- テロップ（04 ⑦ 7-3 の実測の位置。% は画面の幅・高さに対して） ---------- */
    drawHud() {
      const c = this.ctx, k = this.hudK || 1, tt = this.tt, race = this.race, run = this.run, n = this.n, G = this.G;
      c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, W, H);
      if (!race) return;
      const X = (p) => p * W / 100, Y = (p) => p * H / 100, Hh = race.horses, LAPS = (M && M.LAPS) || 2;
      const sq = (x, y, s, h) => { c.fillStyle = h.color; c.fillRect(x, y, s, s); c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1); c.fillStyle = h.ink; c.font = '900 ' + Math.round(s * 0.82) + 'px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(h.no, x + s / 2, y + s / 2 + 1); };
      const outline = (txt, x, y, px, align, col, maxW) => { c.font = '800 ' + px + 'px ' + FONT; c.textAlign = align || 'left'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = Math.max(2.5, px * 0.2); c.strokeStyle = 'rgba(0,0,0,.85)'; c.strokeText(txt, x, y, maxW); c.fillStyle = col || '#fff'; c.fillText(txt, x, y, maxW); };
      const band = (x0, x1, y0, y1, c0, c1) => { const gr = c.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, c0); gr.addColorStop(1, c1); c.fillStyle = gr; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y0); c.lineTo(x1 - (y1 - y0) * 0.45, y1); c.lineTo(x0, y1); c.closePath(); c.fill(); };
      const sh = this.shot;
      // レース名の帯（x9.6〜46.6%・y5.1〜11.3%。青のグラデーション、右の端はななめ）と、金の丸い印
      const RACE = tt >= 2.1 && tt < G + 5; // レース中は競馬と同じ並び（左上 1〜3 位・右上 TIME・下に順位の丸・右下のコース図・左下のロゴ）。drawRaceHud
      if (tt < 2.1) {
        band(X(9.6), X(46.6), Y(5.1), Y(11.3), '#2b5fb0', '#0c2a5e');
        c.fillStyle = '#e9c24a'; c.beginPath(); c.arc(X(7.8), Y(10.2), Y(4.85), 0, 7); c.fill(); c.strokeStyle = '#a8842a'; c.lineWidth = 2; c.stroke();
        c.fillStyle = '#5a4210'; c.font = '900 ' + Math.round(Y(3.4)) + 'px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('casa', X(7.8), Y(10.3), Y(8.4));
        c.fillStyle = '#fff'; c.font = '800 ' + Math.round(Y(4.2)) + 'px ' + FONT; c.textAlign = 'left'; c.fillText((this.info.title || 'casa BOAT') + '　' + (this.info.sub || ''), X(13.6), Y(8.3), X(30));
      }
      // 6 人の名前（y89.5〜94.9%、x5.0〜91.9% を 6 等分。枠色の正方形＋白い字に黒い縁取り。地の帯は無い）
      if (tt < 2.1) { // レースが始まったら下の順位の丸に替わる（競馬と同じ）
        const x0 = X(5), cw = X(86.9) / n, s = Y(5.1);
        Hh.forEach((h, i) => { const x = x0 + i * cw, out = run.out && run.out[i] && tt > 14; sq(x, Y(89.5), s, h); outline(h.name, x + s + 6, Y(92.3), Math.round(Y(3.6)), 'left', out ? 'rgba(255,255,255,.45)' : '#fff', cw - s - 14); });
      }
      // 大時計（中心 x91.5% y13.0%・直径 20.6%。tt −14.6〜+1.0。橙の針が 12 秒で 1 周・スタートで真上）
      if (tt >= -14.6 && tt < 1.0) {
        const cx = X(91.5), cy = Y(13.0), R = Y(10.3), al = clamp((tt + 14.6) / 0.2, 0, 1) * clamp((1.0 - tt) / 0.4, 0, 1);
        c.globalAlpha = al;
        c.fillStyle = '#1c1512'; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill(); c.strokeStyle = '#3f8fe0'; c.lineWidth = 2; c.stroke();
        for (let j = 0; j < 12; j++) { const a = j / 12 * 6.2832, w = 0.07; c.fillStyle = '#f08a1c'; c.beginPath(); c.moveTo(cx + Math.sin(a - w) * R * 0.95, cy - Math.cos(a - w) * R * 0.95); c.lineTo(cx + Math.sin(a + w) * R * 0.95, cy - Math.cos(a + w) * R * 0.95); c.lineTo(cx + Math.sin(a) * R * 0.78, cy - Math.cos(a) * R * 0.78); c.closePath(); c.fill(); }
        c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx, cy - R * 0.98); c.lineTo(cx, cy - R * 0.74); c.stroke();
        c.fillStyle = '#fff'; c.font = '800 ' + Math.round(R * 0.3) + 'px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('10', cx + Math.sin(1.047) * R * 0.55, cy - Math.cos(1.047) * R * 0.55); c.fillText('5', cx + Math.sin(3.665) * R * 0.55, cy - Math.cos(3.665) * R * 0.55);
        const a = -((((-tt) % 12) + 12) % 12) / 12 * 6.2832; // 残り秒 → 針の角度（時計回りに進み、0 で真上）
        c.fillStyle = '#f08a1c'; c.beginPath(); c.moveTo(cx + Math.cos(a) * R * 0.07, cy + Math.sin(a) * R * 0.07); c.lineTo(cx + Math.sin(a) * R * 0.86, cy - Math.cos(a) * R * 0.86); c.lineTo(cx - Math.cos(a) * R * 0.07, cy - Math.sin(a) * R * 0.07); c.closePath(); c.fill(); c.beginPath(); c.arc(cx, cy, R * 0.09, 0, 7); c.fill();
        c.globalAlpha = 1;
      }
      // 進入の札（x4.0〜8.5%・y20〜83%。上にターンマークの絵、下に右がとがった五角形を進入の内から順に。tt −7.7〜+2.0）
      if (tt >= -7.7 && tt < 2.0) {
        const x = X(4.0), w = X(4.5), hh = Y(7), gap = Y(9.1), y0 = Y(29.5);
        c.fillStyle = '#e23b2e'; c.beginPath(); c.moveTo(x + w / 2, Y(20)); c.lineTo(x + w * 0.9, Y(28)); c.lineTo(x + w * 0.1, Y(28)); c.closePath(); c.fill(); c.fillStyle = '#fff'; c.fillRect(x + w * 0.3, Y(23.5), w * 0.4, Y(1.8));
        this.entry.forEach((bi, cix) => { const h = Hh[bi], y = y0 + cix * gap; c.fillStyle = h.color; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w * 0.72, y); c.lineTo(x + w, y + hh / 2); c.lineTo(x + w * 0.72, y + hh); c.lineTo(x, y + hh); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1; c.stroke(); c.fillStyle = h.ink; c.font = '900 ' + Math.round(hh * 0.8) + 'px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(h.no, x + w * 0.4, y + hh / 2 + 1); });
      }
      // スタートの判定（x74.5〜94.3%・中心 y9.1%。白い字・箱なし。tt +2.1〜+22.0）。フライングの表示は本物の映像で確かめられていない（04 ⑦ 7-7）ので、01 1-10 の流れ（判定中 → 発表）に合わせた仮
      if (tt >= 2.1 && tt < 22.0) {
        const f = run.incident && run.incident.type === 'scratch' ? run.incident.horse : -1, px = Math.round(Y(5.6)); // 判定中 → +16.5 秒に発表（実況と同じ）
        if (f < 0) outline('スタート正常', X(98.6), Y(23), px, 'right', '#fff'); // 右上の TIME の札の下（2026-11-19。前は y18%）
        else if (tt < 16.5) outline('スタート判定中', X(98.6), Y(23), px, 'right', '#fff');
        else outline('フライング ' + (f + 1) + '号艇　返還', X(98.6), Y(23), px, 'right', '#ffd24a');
      }
      // 周回と時計・順位（本物に無いが残す）: 2026-11-19 競馬の画面にそろえた（右上の TIME の札に周回、下に順位の丸、左上に 1〜3 位）
      if (RACE && this.state) this.drawRaceHud(c);
      // オッズの札（x70.9〜95.3%・y4.9〜。えんじ色、右の端ななめ。最終周の 1 マークを出て数秒〜最後の 2 マークに入るまで）。ゲームは 2 連単なので、いまの 1・2 番手の組とその逆の 2 行
      if ((sh === 'back-B' || sh === 'side-123') && this.state && this.info.odds && this.state.ord.length >= 2 && tt >= 22) {
        const oV = this.ordShown && this.ordShown.length >= 2 ? this.ordShown : this.state.ordV || this.state.ord, a = oV[0], b = oV[1], ex = this.info.odds.exacta || {}, rows = [[a, b], [b, a]], rh = Y(6.2), s = Y(4.4);
        const oy = 7; // TIME の札の下へ（2026-11-19。前は y13% から）
        band(X(70.9), X(95.3), Y(13 + oy), Y(18.5 + oy), '#8a1f3a', '#5c1226'); c.fillStyle = '#fff'; c.font = '800 ' + Math.round(Y(3.6)) + 'px ' + FONT; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('2連単 オッズ', X(72), Y(15.9 + oy));
        rows.forEach((r2, k2) => { const y = Y(18.5 + oy) + k2 * rh; band(X(70.9), X(95.3) - (k2 + 1) * rh * 0.45, y, y + rh, 'rgba(110,26,48,.92)', 'rgba(84,18,36,.92)'); sq(X(72), y + (rh - s) / 2, s, Hh[r2[0]]); sq(X(72) + s + 4, y + (rh - s) / 2, s, Hh[r2[1]]); const o = ex[r2[0] + '-' + r2[1]]; c.fillStyle = '#fff'; c.font = '800 ' + Math.round(Y(4.2)) + 'px ' + FONT; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(o != null ? o.toFixed(1) : '-', X(89), y + rh / 2 + 1); });
      }
      // 小窓の白い細い枠
      if (this.pip) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.strokeRect(X(60.2), Y(PIP_Y * 100), X(37.5), Y(36.8)); }
      // 勝者の名札（x28.4〜71.6%・y78〜93%。金の帯に黒い字。G+5.5〜G+8）
      if (tt >= G + 5.5 && tt < G + POST_T) {
        const w = Hh[this.finalOrder[0]];
        outline('1着', X(50), Y(80.2), Math.round(Y(4.6)), 'center', '#f3d67a');
        const gr = c.createLinearGradient(0, Y(83.7), 0, Y(89.2)); gr.addColorStop(0, '#f6e08a'); gr.addColorStop(1, '#c9a23a'); c.fillStyle = gr; c.fillRect(X(28.4), Y(83.7), X(43.2), Y(5.5));
        sq(X(30), Y(84.1), Y(4.7), w); c.fillStyle = '#1a1205'; c.font = '900 ' + Math.round(Y(4.4)) + 'px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(w.name, X(51), Y(86.6));
      }
      // 実況の字幕（y80〜86% の中央。勝者の名札の間は出さない）
      const cap = this.captionAt(tt);
      if (cap && !(tt >= G + 5.5)) outline(cap, X(50), Y(83), Math.round(Y(4.6)), 'center', '#fff', X(84));
    }
    /* ---------- 実況（字幕と声）。台本の 1 行は { t, d, keys, s }。声の部品は tools/make-boat-voice.js（boat/voice/）。台本の作り込みは音の段でやる（05・10 の資料） ---------- */
    captionAt(tt) {
      if (!this.capList) return null;
      let cur = null; for (const x of this.capList) if (tt >= x.t && tt < x.t + x.d) cur = x;
      if (cur !== this.capCur) { this.capCur = cur; if (cur && this.live && this.onSay) { try { this.onSay(cur.keys, cur); } catch (e) { } } }
      return cur ? cur.s : null;
    }
    /* 実況の台本（2026-11-17 作り直し）。ref/boat/research/05 の「3-2 間の取り方」「4-3 台本の案」「⑤ 今のゲームの間違い 19〜30」に合わせる:
       ・スタート前は −40 秒からコースごとの紹介を途切れずに、−4.5〜0 秒だけ黙る。スタートからゴールまでは 5 秒以上黙らない（本物の 7 割くらいの量）
       ・「先頭・2 番手・3 番手」を言い続ける（2 連単なので 2 着争いを必ず）。1 マークは 3〜4 艇を早口で並べる。決まり手を言う。最終周回で倍率を読む
       ・言い方は「〜号艇＋姓」、順位と着順は「〜番」。フライングは「早いスタートがあった模様」→「判定中」→ +16.5 秒に発表
       ・場面と合わない字幕を出さないよう、どの艇が何をしたかは走りの計算（describe の lines・kimarite・scenario・st）と、その時刻の順位（stateAt）から決める
       ・待機行動の −100〜−40 秒の実況は資料に無いので「ピット離れ」と前付けの 1 行だけ（−40 秒より前の本物の実況は未調査）
       1 行は { t, d, s, keys }。keys は声の部品の並び（声は音の段で作り直す。今は無い部品は鳴らない） */
    script() {
      const race = this.race, run = this.run, n = this.n, list = [], ent = this.entry, D = this.desc || {}, G = this.G, H = race.horses;
      const sur = (i) => String(H[i].name).split(/\s+/)[0], no = (i) => H[i].no;
      const B = (i) => no(i) + '号艇', BN = (i) => no(i) + '号艇 ' + sur(i), U = (i) => no(i) + '番', UN = (i) => no(i) + '番 ' + sur(i);
      const say = (t, s, d) => list.push({ t, s, d: d || Math.max(1.6, s.length / 5.2), keys: [] });
      const ordAt = (t) => this.stateAt(t).ord, posM = (t, i) => { this.stateAt(t); return run.pos[i] * M.DIST; };
      const minT = (arr, k) => { let m = Infinity; (arr || []).forEach((a) => { if (a && a[k] != null && a[k] < m) m = a[k]; }); return m; };
      const inc = run.incident, F = inc && inc.type === 'scratch' ? inc.horse : -1;
      const slow = Math.max(1, Math.min(n - 1, Number(race.slow) || 3)), waku = ent.every((b, c) => b === c), mv = ent.findIndex((b, c) => b > c);
      // ---- スタート前 ----
      // ピットアウトから約 18 秒はファンファーレ。実況はそれが終わってから話し始める（資料 10 ⑧ 8-3: 終わりの 0.5 秒後。boat/sound.js が −100 で鳴らす）
      say(-81.2, 'ピット離れ', 2.2);
      if (!waku && mv >= 0) say(-78.6, B(ent[mv]) + 'が動きを見せます。' + (ent.indexOf(ent[mv]) + 1) + 'コースに入ります', 4);
      say(-40, waku ? 'コース取り、動きはありません。枠なりです' : '進入は ' + ent.map((b) => no(b)).join(' ') + ' となりました');
      say(-35.5, 'インコースには ' + BN(ent[0]));
      say(-30.5, '2コース ' + BN(ent[1]) + '、3コース ' + BN(ent[2]));
      say(-24.5, (slow === 3 ? '引っ張って、カド 4コースに ' : (slow + 1) + 'コースに ') + BN(ent[3]));
      say(-19, '5コース ' + BN(ent[4]) + '、大外 6コース ' + BN(ent[5]));
      say(-14, (waku ? '枠なり ' : '') + slow + ' 対 ' + (n - slow) + '。12秒針が回ります');
      say(-9.6, '進入は、インコースから ' + ent.slice(0, slow).map(U).join(' ') + '、ダッシュ ' + ent.slice(slow).map(U).join(' ') + 'です', 5);
      // −4.5〜0 は黙る（モーターの音と大時計だけ）
      // ---- スタート ----
      say(0.2, 'スタートしました！', 1.4);
      const st = Array.isArray(D.st) ? D.st : [], okST = st.map((v, i) => (i === F ? 9 : v)), top = okST.indexOf(Math.min.apply(null, okST.length ? okST : [0]));
      const spread = okST.length ? Math.max.apply(null, okST.filter((v) => v < 9)) - Math.min.apply(null, okST) : 0, tc = ent.indexOf(top);
      if (F >= 0) { say(1.6, 'おっと、早いスタートがあった模様です'); say(5.2, 'ただいまスタート判定中です'); }
      else if (spread <= 0.04) say(1.6, 'そろったスタート');
      else if (tc === 0) say(1.6, 'インコース ' + B(top) + 'がトップスタート');
      else if (tc === slow) say(1.6, 'カドから ' + B(top) + 'がのぞいた');
      else if (tc > slow) say(1.6, '外から ' + B(top) + 'がのぞいた');
      else say(1.6, B(top) + 'がトップスタート');
      // ---- 1 周 1 マーク ----
      const in1 = minT(D.turnIn, 0), out1 = minT(D.turnOut, 0), in2 = minT(D.turnIn, 1), out2 = minT(D.turnOut, 1), in3 = minT(D.turnIn, 2), out3 = minT(D.turnOut, 2), in4 = minT(D.turnIn, 3), out4 = minT(D.turnOut, 3);
      const L = Array.isArray(D.lines) ? D.lines : [], act = (i) => { const t = (L[i] || [])[0]; return t === 'B' || t === 'F' ? '差して ' + B(i) : t === 'C' ? '握って ' + B(i) : t === 'D' ? '切り込んで ' + B(i) : t === 'E' ? '外を回って ' + B(i) : t === 'G' ? B(i) + 'は流れた' : B(i); };
      // 先頭が入れ替わった時刻（t0〜t1 で順位の 1 番目が変わった最初の時刻。無ければ -1）
      const leadChange = (t0, t1) => { let p = ordAt(t0)[0]; for (let t = t0 + 0.25; t <= t1; t += 0.25) { const st = this.stateAt(t), q = st.ord[0]; if (q !== p) { if (st.S[p] && st.S[p].out) { p = q; continue; } /* 先頭の艇が外れた（フライングの発表・転覆）のは「抜いた」ではない */ return { t, who: q }; } } return null; };
      const sc = D.scenario || {}, att = sc.attacker != null && sc.attacker >= 0 ? sc.attacker : -1;
      if (isFinite(in1) && isFinite(out1)) {
        const a = ordAt(in1 + 0.2), e1 = ordAt(out1 + 0.4);
        if (att >= 0 && /makuri|shibori/.test(sc.kind || '')) say(in1 - 1.8, '1周1マーク、' + (ent.indexOf(att) === slow ? 'カドから' : '') + 'まくっていく ' + B(att) + '！');
        else say(in1 - 1.6, '1周1マーク。' + (a[0] === ent[0] ? '逃げる ' + BN(a[0]) : '先に回って ' + BN(a[0])));
        const others = e1.filter((i) => i !== e1[0]).slice(0, 2); say(in1 + 1.2, others.map(act).join('、') + '！', 2.6);
        const k1 = D.kimarite1 || D.kimarite, w = e1[0];
        say(out1 + 0.2, w === F ? '先頭は ' + BN(w) /* 発表の前のフライングの艇が先頭（決まり手は残りの艇のものなので言わない） */ : k1 === 'nige' ? '押し切った ' + BN(w) : k1 === 'sashi' ? '差しが届いた ' + BN(w) : k1 === 'makuri' ? 'まくり切った ' + BN(w) + '！' : k1 === 'makurizashi' ? 'まくり差しが入った ' + BN(w) + '！' : '先頭は ' + BN(w));
        const b1 = ordAt(out1 + 3); say(out1 + 3, 'バックストレッチ、先頭は ' + BN(b1[0]) + '。2番手 ' + B(b1[1]) + '、3番手 ' + B(b1[2]), 4.6);
      }
      say(16.5, F >= 0 ? 'お知らせいたします。' + BN(F) + '、フライング。返還欠場です' : 'スタートは正常です', F >= 0 ? 4.5 : 2);
      // ---- 1 周 2 マーク〜2 周目 ----
      let lead = -1;
      if (isFinite(in2)) {
        const o = ordAt(in2 + 0.2); lead = o[0]; say(in2 - 1.4, '1周2マーク、先頭 ' + B(o[0]) + 'が回る');
        const lc = leadChange(in2 - 1, out2 + 6); if (lc) { say(lc.t, '差した ' + BN(lc.who) + '！先頭が入れ替わった'); lead = lc.who; } else { const o2 = ordAt(out2 + 0.3); say(out2 + 0.3, '2番手 ' + B(o2[1]) + '、3番手 ' + B(o2[2])); }
        const th = out2 + 4.2, h = ordAt(th), gap = Math.max(0, Math.round((posM(th, h[0]) - posM(th, h[1])) / 2.9));
        say(th, '先頭 ' + BN(h[0]) + (gap >= 2 ? '、リードは ' + gap + ' 艇身' : '') + '。2番手 ' + BN(h[1]) + '、3番手 ' + B(h[2]), 5);
      }
      if (isFinite(in3)) {
        const tl = in3 - 6.5, o = ordAt(tl); say(tl, '上位は ' + o.slice(0, 3).map(U).join('、') + '。最終周回に入ります', 4);
        const a3 = ordAt(in3 + 0.2); say(in3 - 1.4, '2周1マーク、先頭 ' + BN(a3[0]));
        const lc3 = leadChange(in3 - 1, out3 + 4), e3 = ordAt(out3 + 0.4); if (lc3) say(lc3.t, '内から捉えた ' + BN(lc3.who) + '！先頭が入れ替わった'); else say(out3 + 0.4, e3[1] !== o[1] ? B(e3[1]) + 'が2番手に上がった！' : '2番手 ' + B(e3[1]) + '、その内をついて ' + B(e3[2]));
        const bt = out3 + 3.6, bo = ordAt(bt), d23 = Math.abs(posM(bt, bo[1]) - posM(bt, bo[2]));
        say(bt, d23 < 8 ? '2番手は並走。' + B(bo[1]) + 'と ' + B(bo[2]) : '2番手は ' + B(bo[1]) + 'が守っています');
        const ex = (this.info.odds && this.info.odds.exacta) || {}, kk = (x, y) => ex[x + '-' + y];
        if (kk(bo[0], bo[1]) != null) say(out3 + 7.2, '2連単、' + no(bo[0]) + '-' + no(bo[1]) + ' なら ' + kk(bo[0], bo[1]).toFixed(1) + '倍' + (kk(bo[0], bo[2]) != null ? '、' + no(bo[0]) + '-' + no(bo[2]) + ' なら ' + kk(bo[0], bo[2]).toFixed(1) + '倍' : ''), 4.6);
        if (isFinite(in4)) {
          const a4 = ordAt(in4 + 0.2); say(in4 - 1.4, '最終ターンマーク。先頭 ' + BN(a4[0]));
          const lc4 = leadChange(in4 - 1, out4 + 4), e4 = ordAt(out4 + 0.4); if (lc4) say(lc4.t, '差し返して ' + BN(lc4.who) + '！先頭に'); else if (e4[1] !== bo[1]) say(out4 + 0.3, '差し返して ' + B(e4[1]) + '、2番手に！'); else say(out4 + 0.3, '2番手争い、先に回って ' + B(e4[1]));
          const ft = out4 + 3, fo = ordAt(ft), close = Math.abs(posM(ft, fo[1]) - posM(ft, fo[2])) < 6;
          say(ft, close ? B(fo[2]) + '、届くか' : '2番手は ' + B(fo[1]) + 'が取り切った');
        }
      }
      if (inc && inc.type === 'fall' && run.fallT != null) { say(run.fallT, 'おっと、' + B(inc.horse) + 'バランスを崩した！'); say(run.fallT + 3, BN(inc.horse) + 'は転覆のため失格です', 3); }
      // ---- ゴール ----
      const fo = this.finalOrder, ftm = Array.isArray(run.finishTimes) ? run.finishTimes : [];
      say(G - 3, '上位は ' + U(fo[0]) + '、' + U(fo[1]) + '。まもなくゴールです', 2.6);
      say(G - 0.1, '先頭 ' + UN(fo[0]) + '、ゴールイン！', 2);
      const t2 = ftm[fo[1]] && ftm[fo[1]] < G + 8 ? ftm[fo[1]] : G + 1.4; say(Math.max(G + 1.6, t2), '2着 ' + UN(fo[1]) + '、ゴールイン', 2);
      say(G + 3.6, '着順確定。1着 ' + U(fo[0]) + '、2着 ' + U(fo[1]) + '。2連単 ' + no(fo[0]) + '-' + no(fo[1]), 2.2);
      // 重なりの整理: 前の行が終わる前に次が来たら、次を少し待たせる（1.2 秒まで）。それでも重なれば前の行を短く
      list.sort((x, y) => x.t - y.t);
      for (let k = 1; k < list.length; k++) { const p = list[k - 1], c = list[k], end = p.t + p.d; if (c.t < end) { const push = Math.min(1.2, end - c.t); c.t += push; if (c.t < p.t + p.d) p.d = Math.max(1.0, c.t - p.t - 0.05); } }
      list.sort((x, y) => x.t - y.t);
      this.capList = list; this.capCur = null;
    }
    dispose() { this.cancelPrep(); /* 準備中の setRaceAsync は捨てる */ try { this.dropBoats(); } catch (e) { } try { if (this.tags) this.tags.dispose(); } catch (e) { } try { this.wake.dispose(); this.venue.dispose(); } catch (e) { } this.renderer.dispose(); }
  }
  /* 進路の計画を作る仕事（少しずつ進められる形。yield のたびに止めてよい）。返り値 { plan, run, desc, alt }（alt ＝ 何番目の入れ替え方を使ったか。0 ＝ もらった走りのまま）。
     2026-11-20 直し（不具合 E2）: 着順を指定した再現（run.swaps ＝ 途中で 2 艇の走りを入れ替えた）で、計画が不合格（艇が重なる・すき間が足りない）や急な動き（ターンで毎秒 80° より速く回るなど）になった時は、
     入れ替える時刻を後ろへずらした走り（Engine.replayRun の opt.swapFrom）で作り直す。着順とゴールの時刻は変わらない（入れ替えは 2 艇の「ゴールまでの残りの走り」を取りかえるだけなので、いつ入れ替えても同じ）。
     調べる順（最初に「合格で急な動きも無い」物が出たら、そこで終わり）:
       ① もらった走りで 1 回（ふつうのレース・ほとんどの着順指定はここで終わり ＝ 前と同じ答え）
       ② 入れ替え方を変えた走りで 1 回ずつ: 全艇が 1 周 1 マークを回り終えてから入れ替える → 1 周 2 マークのあと → 2 周 1 マークのあと
       ③ 進路の部品の作り直しの段（横と前後の余裕を広げる など。boat/lines.js の planGen）を、もらった走り → 入れ替え方 1〜3 の順に
     どれも合格しなかった時だけ、足りない所のいちばん少ない物を使う（parts.Lines は 'ng'。tests/boat-order.test.js が、この道に落ちるレースが無いことを見張る）。
     計算は全部のテレビで同じ順・同じ答え（乱数を使わない）なので、どの店でも同じ映像になる。
     stop（省ける）: 時間切れなら true を返す関数。true になったら、合格している計画があればそこでやめる（急な動きを減らす作り直しを切り上げる。重なりのある計画では切り上げない）。
       時間切れで切り上げたテレビは、ほかの店と少しちがう映像になりうる（着順とゴールの時刻は同じ） */
  Race.planJob = function* (race, run, desc, stop) {
    const L = BOAT.Lines, E = window.Engine, info = (d, more) => Object.assign({}, d, { Course: C, preT: PRE_T, postT: POST_T + 2 }, stop ? { stop } : {}, more || {});
    const rank = (c) => (c.plan.ok !== false ? c.plan.score || 0 : 1e9 + (c.plan.overlapFrames || 0) * 1000 + (c.plan.badFrames || 0));
    const bestOf = (L2) => { let b = L2[0]; L2.forEach((c) => { if (rank(c) < rank(b)) b = c; }); return b; }, late = (L2) => !!(stop && stop() && L2.some((c) => c.plan && c.plan.ok !== false));
    if (!L._planGen) return { plan: L.plan(race, run, info(desc)), run, desc, alt: 0 }; // 古い進路の部品: 前のまま
    const cands = [{ run, desc, alt: 0, plan: null }];
    cands[0].plan = yield* L._planGen(race, run, info(desc, { quick: true }));
    if (cands[0].plan.score === 0) return cands[0];
    // ② 入れ替え方を変えた走り
    const order = run.finalOrder ? run.finalOrder() : null, seed = run.seed;
    if (run.swaps && run.swaps.length && order && seed != null && E && E.replayRun && M && M.describe) {
      let outs = []; try { outs = M.describe(race, seed).turnOut || []; } catch (e) { outs = []; }
      const tried = [JSON.stringify(run.swaps)];
      for (let k = 0; k < 3; k++) {
        if (late(cands)) return bestOf(cands);
        let from = 0; outs.forEach((a) => { if (a && a[k] != null && a[k] > from) from = a[k]; }); if (!(from > 0)) continue;
        let r2 = null, d2 = null;
        try { r2 = E.replayRun(race, seed, { order, swapFrom: from + 1 }); if (!r2.swaps || !r2.swaps.length) continue; const key = JSON.stringify(r2.swaps); if (tried.indexOf(key) >= 0) continue; tried.push(key); d2 = M.describe(race, seed, { swaps: r2.swaps }); } catch (e) { console.warn('planJob', e); continue; }
        yield 'L:alt';
        const c = { run: r2, desc: d2, alt: k + 1, plan: yield* L._planGen(race, r2, info(d2, { quick: true })) };
        if (c.plan.score === 0) return c;
        cands.push(c);
      }
    }
    // ③ 作り直しの段
    for (const c of cands) { if (late(cands)) break; c.plan = yield* L._planGen(race, c.run, info(c.desc, { first: c.plan })); if (c.plan.score === 0) return c; }
    return bestOf(cands);
  };
  /* ---------- 別の糸（Web Worker）で進路を計算する（2026-11-21。不具合 I3） ----------
     計画の「1 回分」（BOAT.Lines.planUnit ＝ 走り 1 つ × 作り直しの設定 1 つ）を、boat/plan-worker.js 2〜3 本に同時に配り、Race.planJob とまったく同じ順で選ぶ。
     1 回分の答えは計算する糸に関係なく同じ（乱数なし・時間で切り上げない）なので、選ばれる計画も Race.planJob と同じ（＝ どのテレビでも、別の糸があっても無くても同じ映像）。
     先に要りそうな 1 回分（入れ替え方を変えた走り・作り直し）も、空いている糸で先回りして計算しておく（使わなければ捨てる）。
     別の糸が作れない・読み込めない・答えがおかしい（走りの印が合わない）時は Promise が失敗し、setRaceAsync は画面の糸の計算（前と同じ）に切りかえる */
  const ME_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  const runPrint = (r) => JSON.stringify([r.natural, r.duration, r.winTime, r.finishTimes, r.swaps, r.out, r.fallT]); // boat/plan-worker.js にも同じ物
  // 区切りの間を 4ms あけずにつなぐ（setTimeout は 5 回続けると 4ms 以上あく）
  let ch = null; const chQ = []; // 使う時に作る（node の試験で読み込んだだけの時に、口が開いたままで終わらなくならないように）
  const soon = (f) => {
    if (!ch && typeof MessageChannel === 'function') { ch = new MessageChannel(); ch.port1.onmessage = () => { const g = chQ.shift(); if (g) g(); }; if (ch.port1.unref) ch.port1.unref(); }
    if (!ch) { setTimeout(f, 0); return; } chQ.push(f); ch.port2.postMessage(0);
  };
  /* 2026-11-21（不具合 N1「重いレースは別の糸を使うほうが遅い」）:
     ・先回りの 1 回分が、本当に要る 1 回分（選ぶ順で次に待っている物）より先に並ばないように、待ち始めた 1 回分は「いま要る」として列の先頭へ（need）。
       1 回めの答えで作り直しの並び（横切りの有無で変わる）が分かったら、先回り分の並びもその順に付け直す（前は「横切りをやめる」2 つが、要らないかもしれない先回り 5 つの後ろに回っていた）。
     ・計画が決まったら（または準備をやめたら）、そのレースの先回り分は列から捨て、計算中の物も糸ごと止めて作り直す（前は最後まで計算を続け、走りの映像の間も糸が埋まっていた）。
     ・どの 1 回分も答えは糸に関係なく同じで、選ぶ順も前と同じなので、映像は前と同じ（別の糸があっても無くても同じ） */
  const Pool = { ws: null, broken: false, seq: 0, queue: [], UNIT_MS: 120000, url: '', killed: 0 };
  function poolSpawn(s) { // 糸を 1 本作る（前の糸の返事が後から来ても、作り直したあとの糸の物でなければ無視する）
    const w = new Worker(Pool.url); s.w = w; s.u = null;
    w.onmessage = (e) => { if (s.w === w) poolDone(s, e.data); };
    w.onerror = (e) => { try { e.preventDefault(); } catch (x) { } if (s.w === w) poolBreak('別の糸のエラー ' + ((e && e.message) || '')); };
  }
  function poolOk() {
    if (Pool.broken || Race.useWorker === false) return false; if (Pool.ws) return true;
    if (typeof Worker !== 'function' || !ME_SRC || !/^https?:/.test(ME_SRC)) return false;
    const url = ME_SRC.replace(/race-boat\.js(?=[?#]|$)/, 'plan-worker.js'); if (url === ME_SRC) return false;
    try {
      const N = Math.max(1, Math.min(3, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1));
      Pool.url = url; Pool.ws = [];
      for (let i = 0; i < N; i++) { const s = { w: null, u: null }; poolSpawn(s); Pool.ws.push(s); }
    } catch (e) { poolBreak('別の糸を作れない ' + e.message); return false; }
    return true;
  }
  function poolBreak(why) { // こわれたら全部やめて、以後は画面の糸で計算する
    Pool.broken = true; const ws = Pool.ws || []; Pool.ws = null;
    ws.forEach((s) => { try { s.w.terminate(); } catch (e) { } if (s.u) { clearTimeout(s.u.timer); s.u.reject(new Error(why)); } });
    Pool.queue.splice(0).forEach((u) => u.reject(new Error(why)));
  }
  function poolDone(s, d) {
    const u = s.u; s.u = null; if (u) { clearTimeout(u.timer); if (!d || d.err || d.id !== u.id) u.reject(new Error('計算の失敗 ' + ((d && d.err) || ''))); else u.resolve(d); }
    pumpSoon();
  }
  /* 列を回すのは、いまの仕事（答えを受け取った続きの処理）が全部終わってから 1 回だけ（2026-11-21 N1。1 回めの答えで先回りの順を付け直す前に、古い順で次の物を配らないように） */
  function pumpSoon() { if (Pool.pumpAt) return; Pool.pumpAt = true; soon(() => { Pool.pumpAt = false; poolPump(); }); }
  function poolPump() {
    if (!Pool.ws) return;
    const dead = (u) => { try { return !u.alive(); } catch (e) { return true; } };
    Pool.queue = Pool.queue.filter((u) => { if (!dead(u)) return true; u.reject(new Error('捨てた')); return false; });
    // 計算中でも、もう要らない物（計画が決まった・準備をやめたレースの先回り分）は糸ごと止めて作り直す
    for (const s of Pool.ws) {
      if (!s.u || !dead(s.u)) continue;
      const u = s.u; clearTimeout(u.timer); try { s.w.terminate(); } catch (e) { }
      Pool.killed++; u.reject(new Error('捨てた'));
      try { poolSpawn(s); } catch (e) { poolBreak('別の糸を作れない ' + e.message); return; }
    }
    Pool.queue.sort((a, b) => a.pri - b.pri || a.id - b.id);
    for (const s of Pool.ws) {
      if (s.u || !Pool.queue.length) continue;
      const u = Pool.queue.shift(); s.u = u;
      try { s.w.postMessage(Object.assign({ id: u.id }, u.msg)); } catch (e) { s.u = null; u.reject(e); continue; }
      u.timer = setTimeout(() => poolBreak('別の糸の返事が来ない'), Pool.UNIT_MS);
    }
  }
  // 返り値は列の 1 件（u.p が答えの Promise。u.pri はあとから付け直せる）
  function poolRun(msg, pri, alive) { const u = { id: ++Pool.seq, msg, pri, alive }; u.p = new Promise((resolve, reject) => { u.resolve = resolve; u.reject = reject; }); Pool.queue.push(u); pumpSoon(); return u; }
  /* Race.planJob と同じ選び方を、別の糸の答えで行う。返り値は Promise（{ plan, run, desc, alt }）か、別の糸が使えない時は null */
  Race.planPar = function (race, run, desc, alive, stat) {
    if (!poolOk() || !run || run.seed == null) return null;
    const L = BOAT.Lines, E = window.Engine; if (!L || !L.planUnit || !L.unpackPlan || !L.retryList) return null;
    const order = run.finalOrder ? run.finalOrder() : null; if (!run.natural && !order) return null;
    let fin = false; // 計画が決まった（または失敗した）ら true。このレースの先回り分は捨てる
    const live0 = alive || (() => true), live = () => !fin && live0(), base = { race, seed: run.seed, preT: PRE_T, postT: POST_T + 2 };
    /* 1 回分（同じ設定の物は 1 回だけ計算。設定の中身で見分ける）。pri: 列の順（小さいほど先）。まだ列で待っている物は、あとから呼ばれた時の pri に付け直す（「いま要る」物は付け直さない）。
       need: 選ぶ順で、いま答えを待つ物 → 列の先頭へ */
    const one = (c, over, pri, need) => {
      const key = over ? JSON.stringify(over) : 'b';
      let e = c.got[key];
      if (e && e.drop) e = null; // 先回りをやめた物がやっぱり要る時は、もう一度頼む（ふつうは起きない）
      if (!e) {
        const x = { drop: false }, u = poolRun(Object.assign({ order: c.order, swapFrom: c.swapFrom, desc: c.desc, over: over || null }, base), need ? -1 : pri, () => !x.drop && live());
        const p = u.p.then((d) => { if (d.fp !== c.fp) throw new Error('走りの印が合わない'); if (stat) stat.units++; return d; });
        p.catch(() => { }); e = c.got[key] = Object.assign(x, { u, p, key });
      } else if (Pool.queue.indexOf(e.u) >= 0 && e.u.pri !== -1) { e.u.pri = need ? -1 : pri; pumpSoon(); }
      return e.p;
    };
    const plan = (d) => { const P = L.unpackPlan(d.plan); return P; };
    const c0 = { run, desc, alt: 0, order: run.natural ? null : order, swapFrom: null, fp: runPrint(run), got: {}, idx: 0 };
    // 入れ替え方を変えた走り（Race.planJob の②と同じ物を同じ順で。画面の糸で作る。軽い）
    const alts = [];
    if (run.swaps && run.swaps.length && order && E && E.replayRun && M && M.describe) {
      let outs = []; try { outs = M.describe(race, run.seed).turnOut || []; } catch (e) { outs = []; }
      const tried = [JSON.stringify(run.swaps)];
      for (let k = 0; k < 3; k++) {
        let from = 0; outs.forEach((a) => { if (a && a[k] != null && a[k] > from) from = a[k]; }); if (!(from > 0)) continue;
        let r2 = null, d2 = null;
        try { r2 = E.replayRun(race, run.seed, { order, swapFrom: from + 1 }); if (!r2.swaps || !r2.swaps.length) continue; const key = JSON.stringify(r2.swaps); if (tried.indexOf(key) >= 0) continue; tried.push(key); d2 = M.describe(race, run.seed, { swaps: r2.swaps }); } catch (e) { console.warn('planPar', e); continue; }
        alts.push({ run: r2, desc: d2, alt: k + 1, order, swapFrom: from + 1, fp: runPrint(r2), got: {}, idx: alts.length + 1 });
      }
    }
    const all = [c0].concat(alts);
    // 先回り: 1 回めの答えで作り直しの並び（横切りの有無で変わる）が分かったら、その順に付け直す（選ぶ時に待つ順と同じ）
    const retries = (c, d) => {
      if (!live()) return;
      const keep = d.score === 0 ? [] : L.retryList(d.hasBeh).tries;
      keep.forEach((o, q) => one(c, o, 10 + c.idx * 20 + q));
      // 合格なら作り直しは要らない・横切りの無いレースなら「横切りをやめる」は要らない → その先回りはやめる
      const ks = keep.map((o) => JSON.stringify(o)); let n = 0;
      Object.keys(c.got).forEach((k) => { const e = c.got[k]; if (k !== 'b' && ks.indexOf(k) < 0 && !e.drop) { e.drop = true; n++; } });
      if (n) pumpSoon();
    };
    all.forEach((c) => one(c, null, c.idx).then((d) => retries(c, d), () => { }));
    /* 事故のあるレース・着順を指定したレースは、作り直しになりやすい（ふつうのレースはほとんど 1 回め で合格）。別の糸が 3 本以上ある時だけ、1 回めの答えを待たずに
       もらった走りの作り直しも先回りで計算しておく（使わなければ捨てる。答えは変わらない）。
       2026-11-21 N1: 並びは「横切りあり」の時の順（作り直しになったレースはほとんど横切りあり）。1 回めの答えで横切りが無いと分かったら、横切りをやめる 2 つは捨てて順を付け直す（上の retries）。
       入れ替え方を変えた走りの 1 回め（列の順 1〜3）より後 */
    if ((race.incident || !run.natural) && Pool.ws.length >= 3) L.retryList(true).tries.forEach((o, q) => one(c0, o, 4 + q)); // 作り直しになるレースは、ほとんど横切りあり（その時に要る順）
    return (async () => {
      const cands = [];
      for (const c of all) {
        const d = await one(c, null, c.idx, true), P = plan(d); P.score = d.score;
        const cand = { run: c.run, desc: c.desc, alt: c.alt, plan: P, src: c, hasBeh: d.hasBeh };
        if (d.score === 0) return cand;
        cands.push(cand);
      }
      // 作り直しの段（BOAT.Lines の planGen を info.first で続けた時と同じ）
      for (const cand of cands) {
        const c = cand.src, RL = L.retryList(cand.hasBeh), tries = RL.tries, last = RL.last;
        let best = cand.plan, bs = best.score;
        for (let q = 0; q < tries.length && bs > 0; q++) { const d = await one(c, tries[q], 10 + c.idx * 20 + q, true), P2 = plan(d); P2.retried = q + 1; if (d.score < bs) { best = P2; bs = d.score; } else best.retried = q + 1; }
        for (let q = 0; q < last.length && !best.ok; q++) { const d = await one(c, last[q], 10 + c.idx * 20 + 10 + q, true), P3 = plan(d); P3.retried = tries.length + 1 + q; if (d.score < bs) { best = P3; bs = d.score; } }
        best.score = bs; cand.plan = best;
        if (bs === 0) return cand;
      }
      const rank = (x) => (x.plan.ok !== false ? x.plan.score || 0 : 1e9 + (x.plan.overlapFrames || 0) * 1000 + (x.plan.badFrames || 0));
      let b = cands[0]; cands.forEach((x) => { if (rank(x) < rank(b)) b = x; }); return b;
    })().then((x) => { fin = true; poolPump(); return { plan: x.plan, run: x.run, desc: x.desc, alt: x.alt }; },
      (e) => { fin = true; poolPump(); throw e; }); // 決まったら（失敗でも）、このレースの先回り分を捨てる
  };
  Race.workerPool = () => ({ n: Pool.ws ? Pool.ws.length : 0, broken: Pool.broken, queued: Pool.queue.length, busy: Pool.ws ? Pool.ws.filter((s) => s.u).length : 0, killed: Pool.killed }); // 試験で見る用（busy: 計算中の糸の数、killed: 要らなくなって止めた数）
  // 声の部品の鍵 → 字幕の文（tools/make-boat-voice.js の P と同じ鍵）
  Race.PHRASES = { pitout: 'ピットアウト', moved: 'が動いた！　内のコースを取りに行く', turnto: '各艇、スタートラインへ艇を向けます', wakunari: '進入は枠なり 3 対 3', shinnyu: '進入は', santai: '3 対 3', clock: '大時計が回って、各艇 スタートへ',
    start: 'スタートしました！', flying: 'フライング', m1: '1周 1マーク、', sakini: 'が先に回る', semeru: 'が攻める！', innige: 'イン逃げ態勢', nukeda: 'が抜け出した！', niban: '2番手', back: 'バックストレッチ、先頭は', m2: '1周 2マーク', sashita: 'が差した！',
    lastlap: '最終周に入ります。先頭', m1b: '2周 1マーク', gyakuten: 'が逆転！', lastmark: '最終ターンマーク', sento: '先頭は', ato: '、あとは直線', tenpuku: '転覆！', goal: 'ゴールイン！', ichaku: '1着', nichaku: '2着' };
  Race.PRE_T = PRE_T; Race.POST_T = POST_T; Race.PIT_T = -PRE_T; Race.LEAVE_T = -PRE_T; Race.F_ANNOUNCE = F_ANNOUNCE; Race.SOFT_SEEK = SOFT_SEEK;
  return Race;
})();
