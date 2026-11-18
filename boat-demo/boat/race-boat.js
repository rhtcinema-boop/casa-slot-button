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
  const PRE_T = 100, POST_T = 8; // レース前は本物どおり全部（待機行動 約 100 秒。オーナー 2026-11-17）
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, k) => a + (b - a) * k;
  const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const FONT = '"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';
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
      this.quality = opts.quality || 'high'; this.parts = {};
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
      this.resize();
    }
    part(name, make, stub) {
      try { if (BOAT[name]) { const p = make(); if (p) { this.parts[name] = 'real'; return p; } } } catch (e) { console.warn('BOAT.' + name, e); }
      this.parts[name] = 'stub'; return stub ? stub() : null;
    }
    resize() {
      const cw = this.gl.clientWidth || W, ch = this.gl.clientHeight || H, dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1);
      this.renderer.setSize(Math.round(cw * dpr), Math.round(ch * dpr), false);
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
    /* race: BoatModel.makeRace、run: Engine.replayRun、desc: BoatModel.describe(race, 種, { swaps: run.swaps })、info: { title, sub, hour, odds } */
    setRace(race, run, info, desc) {
      this.race = race; this.run = run; this.info = info || {}; this.desc = desc || {};
      this.boats.forEach((b) => { this.scene.remove(b.object3d); try { b.dispose(); } catch (e) { } });
      this.boats = race.horses.map((h) => { let b = null; try { if (BOAT.Boat) { b = BOAT.Boat.create(h, { quality: this.quality }); this.parts.Boat = 'real'; } } catch (e) { console.warn('BOAT.Boat', e); } if (!b || !b.object3d) { b = Stub.boat(h); this.parts.Boat = this.parts.Boat || 'stub'; } this.scene.add(b.object3d); return b; });
      const n = this.n = race.horses.length;
      this.entry = Array.isArray(this.desc.entry) ? this.desc.entry : Array.isArray(race.entry) ? race.entry : race.horses.map((_, i) => i);
      this.G = run.winTime || 72; this.endT = this.G + POST_T; this.finalOrder = run.finalOrder ? run.finalOrder() : race.horses.map((_, i) => i);
      // 進路を最後まで計算する（発走前に 1 回）
      this.plan = null;
      try { this.plan = BOAT.Lines.plan(race, run, Object.assign({}, this.desc, { Course: C, preT: PRE_T, postT: POST_T + 2 })); this.parts.Lines = this.plan && this.plan.ok !== false ? 'real' : 'ng'; } catch (e) { console.warn('BOAT.Lines', e); this.parts.Lines = 'err'; }
      this.vis = race.horses.map(() => ({ x: 0, z: 0, yaw: 0, speed: 0, turn: 0, flip: 0, on: true }));
      this.rank = race.horses.map((_, i) => i);
      try { this.wake.reset(); } catch (e) { }
      try { if (this.venue.setTime) { const dn = new Date(); this.venue.setTime(this.info.hour != null ? this.info.hour : dn.getHours() + dn.getMinutes() / 60); } } catch (e) { console.warn('setTime', e); }
      try { if (this.venue.setWeather && this.info.weather) this.venue.setWeather(this.info.weather); } catch (e) { console.warn('setWeather', e); }
      try { this.timeline(); } catch (e) { console.warn('timeline', e); this.shots = [{ t: -PRE_T, id: 'approach', ev: {} }]; }
      try { this.script(); } catch (e) { console.warn('script', e); this.capList = []; }
      this.seek(-PRE_T);
    }
    get done() { return this.tt >= this.endT; }
    /* ---------- 時刻 t の様子（艇の場所は進路の計画から、順位は走りの計算から） ---------- */
    stateAt(t) {
      const run = this.run, n = this.n, P = this.plan ? this.plan.at(t) : null, S = [];
      if (run.seek) run.seek(Math.max(0, t));
      for (let i = 0; i < n; i++) { const p = P && P[i]; S.push(p ? { x: p.x, z: p.z, yaw: p.yaw, speed: p.speed, turn: p.turn || 0, slip: p.slip || 0, turnDir: p.turnDir || 0, on: p.on !== false, phase: p.phase, out: !!(run.out && run.out[i] && t > 0), pos: run.pos[i] } : { x: C.PIT.x, z: C.PIT.z + i * 3, yaw: 0, speed: 0, turn: 0, on: true, out: false, pos: 0 }); }
      const alive = S.map((_, i) => i).filter((i) => !S[i].out && S[i].on);
      const fin = (i) => run.finish[i] && !S[i].out;
      const ord = alive.slice().sort((a, b) => (fin(a) || fin(b) ? (fin(a) ? this.finalOrder.indexOf(a) : 99) - (fin(b) ? this.finalOrder.indexOf(b) : 99) || S[b].pos - S[a].pos : S[b].pos - S[a].pos));
      const mean = (idx) => { const o = { x: 0, z: 0 }; idx.forEach((i) => { o.x += S[i].x / idx.length; o.z += S[i].z / idx.length; }); return o; };
      const onAll = S.map((_, i) => i).filter((i) => S[i].on);
      return { t, S, ord, lead: S[ord[0]] || S[0], second: S[ord[1]] || S[ord[0]] || S[0], third: S[ord[2]] || S[ord[1]] || S[0], last: S[ord[ord.length - 1]] || S[0], cen: mean(ord.slice(0, 4).length ? ord.slice(0, 4) : [0]), all: mean(onAll.length ? onAll : [0]) };
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
    seek(tt) { this.live = false; this.capCur = null; this.cam = null; this.prevT = null; this.tt = tt; this.place(0); this.direct(0); this.draw(0); }
    tick(dt) {
      dt = clamp(dt, 0, 0.1) * this.speedK; this.live = dt > 0; this.tt += dt;
      this.place(dt); this.direct(dt); this.draw(dt);
    }
    draw(dt) {
      const tt = this.tt, r = this.renderer;
      // 大時計: 黄色い針は 12 秒で 1 周・スタートで真上（止めずに回し続ける）、白い針は 60 秒で 1 周
      try { if (tt < 1) { this.venue.setClock((((-tt) % 12) + 12) % 12); if (this.venue.setClock60) this.venue.setClock60(Math.max(0, -tt)); } else this.venue.setClock(null); } catch (e) { }
      try { this.venue.update(dt, tt + PRE_T, this.camera); } catch (e) { }
      const size = r.getSize(new T.Vector2());
      this.marks.visible = !!this.marksOn;
      r.setScissorTest(false); r.setViewport(0, 0, size.x, size.y); r.render(this.scene, this.camera);
      if (this.pip) { // 小窓: x60.2〜97.7%・y5.2〜42%
        const x = 0.602 * size.x, w = 0.375 * size.x, h = 0.368 * size.y, y = size.y - 0.052 * size.y - h;
        r.setScissorTest(true); r.setScissor(x, y, w, h); r.setViewport(x, y, w, h); this.marks.visible = false; r.render(this.scene, this.cam2); r.setScissorTest(false); r.setViewport(0, 0, size.x, size.y);
      }
      this.drawHud();
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
      if (tt < G + POST_T) {
        band(X(9.6), X(46.6), Y(5.1), Y(11.3), '#2b5fb0', '#0c2a5e');
        c.fillStyle = '#e9c24a'; c.beginPath(); c.arc(X(7.8), Y(10.2), Y(4.85), 0, 7); c.fill(); c.strokeStyle = '#a8842a'; c.lineWidth = 2; c.stroke();
        c.fillStyle = '#5a4210'; c.font = '900 ' + Math.round(Y(3.4)) + 'px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('casa', X(7.8), Y(10.3), Y(8.4));
        c.fillStyle = '#fff'; c.font = '800 ' + Math.round(Y(4.2)) + 'px ' + FONT; c.textAlign = 'left'; c.fillText((this.info.title || 'casa BOAT') + '　' + (this.info.sub || ''), X(13.6), Y(8.3), X(30));
      }
      // 6 人の名前（y89.5〜94.9%、x5.0〜91.9% を 6 等分。枠色の正方形＋白い字に黒い縁取り。地の帯は無い）
      if (tt < G + 5) {
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
        if (f < 0) outline('スタート正常', X(94.3), Y(18), px, 'right', '#fff');
        else if (tt < 16.5) outline('スタート判定中', X(94.3), Y(18), px, 'right', '#fff');
        else outline('フライング ' + (f + 1) + '号艇　返還', X(94.3), Y(18), px, 'right', '#ffd24a');
      }
      // 周回と時計（本物に無いが残す。上の真ん中 x49〜68%・y5.1〜11.3%。tt +2.1 から）
      if (tt >= 2.1 && tt < G + 5) {
        let ld = 0; for (let i = 0; i < n; i++) if (!(run.out && run.out[i])) ld = Math.max(ld, run.pos[i]);
        const lap = Math.min(LAPS, 1 + Math.floor(Math.max(0, ld) * LAPS + 1e-6)), fin = tt >= G, t = Math.min(tt, G);
        band(X(49), X(68), Y(5.1), Y(11.3), '#2b5fb0', '#0c2a5e');
        c.fillStyle = lap >= LAPS && !fin ? '#ffd966' : '#fff'; c.font = '800 ' + Math.round(Y(4.0)) + 'px ' + FONT; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(fin ? 'ゴール' : lap >= LAPS ? '最終周' : lap + ' / ' + LAPS + ' 周', X(50.2), Y(8.3));
        c.fillStyle = '#fff'; c.textAlign = 'right'; c.fillText(Math.floor(t / 60) + "'" + ('0' + Math.floor(t % 60)).slice(-2) + '"' + Math.floor((t * 10) % 10), X(65.6), Y(8.3));
      }
      // 順位の表（本物に無いが残す。右の端の下半分 x93.0〜97.5%・y46〜86%。tt +2.1 から）
      if (tt >= 2.1 && tt < G + 5 && this.state) { const s = Y(5.1), gap = Y(6.6); this.state.ord.forEach((i, kk) => sq(X(93.0), Y(46) + kk * gap, s, Hh[i])); }
      // オッズの札（x70.9〜95.3%・y4.9〜。えんじ色、右の端ななめ。最終周の 1 マークを出て数秒〜最後の 2 マークに入るまで）。ゲームは 2 連単なので、いまの 1・2 番手の組とその逆の 2 行
      if ((sh === 'back-B' || sh === 'side-123') && this.state && this.info.odds && this.state.ord.length >= 2 && tt >= 22) {
        const a = this.state.ord[0], b = this.state.ord[1], ex = this.info.odds.exacta || {}, rows = [[a, b], [b, a]], rh = Y(6.2), s = Y(4.4);
        band(X(70.9), X(95.3), Y(13), Y(18.5), '#8a1f3a', '#5c1226'); c.fillStyle = '#fff'; c.font = '800 ' + Math.round(Y(3.6)) + 'px ' + FONT; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('2連単 オッズ', X(72), Y(15.9));
        rows.forEach((r2, k2) => { const y = Y(18.5) + k2 * rh; band(X(70.9), X(95.3) - (k2 + 1) * rh * 0.45, y, y + rh, 'rgba(110,26,48,.92)', 'rgba(84,18,36,.92)'); sq(X(72), y + (rh - s) / 2, s, Hh[r2[0]]); sq(X(72) + s + 4, y + (rh - s) / 2, s, Hh[r2[1]]); const o = ex[r2[0] + '-' + r2[1]]; c.fillStyle = '#fff'; c.font = '800 ' + Math.round(Y(4.2)) + 'px ' + FONT; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(o != null ? o.toFixed(1) : '-', X(89), y + rh / 2 + 1); });
      }
      // 小窓の白い細い枠
      if (this.pip) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.strokeRect(X(60.2), Y(5.2), X(37.5), Y(36.8)); }
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
      const leadChange = (t0, t1) => { let p = ordAt(t0)[0]; for (let t = t0 + 0.25; t <= t1; t += 0.25) { const q = ordAt(t)[0]; if (q !== p) return { t, who: q }; } return null; };
      const sc = D.scenario || {}, att = sc.attacker != null && sc.attacker >= 0 ? sc.attacker : -1;
      if (isFinite(in1) && isFinite(out1)) {
        const a = ordAt(in1 + 0.2), e1 = ordAt(out1 + 0.4);
        if (att >= 0 && /makuri|shibori/.test(sc.kind || '')) say(in1 - 1.8, '1周1マーク、' + (ent.indexOf(att) === slow ? 'カドから' : '') + 'まくっていく ' + B(att) + '！');
        else say(in1 - 1.6, '1周1マーク。' + (a[0] === ent[0] ? '逃げる ' + BN(a[0]) : '先に回って ' + BN(a[0])));
        const others = e1.filter((i) => i !== e1[0]).slice(0, 2); say(in1 + 1.2, others.map(act).join('、') + '！', 2.6);
        const k1 = D.kimarite1 || D.kimarite, w = e1[0];
        say(out1 + 0.2, k1 === 'nige' ? '押し切った ' + BN(w) : k1 === 'sashi' ? '差しが届いた ' + BN(w) : k1 === 'makuri' ? 'まくり切った ' + BN(w) + '！' : k1 === 'makurizashi' ? 'まくり差しが入った ' + BN(w) + '！' : '先頭は ' + BN(w));
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
    dispose() { try { this.wake.dispose(); this.venue.dispose(); } catch (e) { } this.renderer.dispose(); }
  }
  // 声の部品の鍵 → 字幕の文（tools/make-boat-voice.js の P と同じ鍵）
  Race.PHRASES = { pitout: 'ピットアウト', moved: 'が動いた！　内のコースを取りに行く', turnto: '各艇、スタートラインへ艇を向けます', wakunari: '進入は枠なり 3 対 3', shinnyu: '進入は', santai: '3 対 3', clock: '大時計が回って、各艇 スタートへ',
    start: 'スタートしました！', flying: 'フライング', m1: '1周 1マーク、', sakini: 'が先に回る', semeru: 'が攻める！', innige: 'イン逃げ態勢', nukeda: 'が抜け出した！', niban: '2番手', back: 'バックストレッチ、先頭は', m2: '1周 2マーク', sashita: 'が差した！',
    lastlap: '最終周に入ります。先頭', m1b: '2周 1マーク', gyakuten: 'が逆転！', lastmark: '最終ターンマーク', sento: '先頭は', ato: '、あとは直線', tenpuku: '転覆！', goal: 'ゴールイン！', ichaku: '1着', nichaku: '2着' };
  Race.PRE_T = PRE_T; Race.POST_T = POST_T; Race.PIT_T = -PRE_T; Race.LEAVE_T = -PRE_T;
  return Race;
})();
