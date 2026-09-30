/* リール描画とスピン運動。
   位置 p（セル単位）は区間ごとの速度曲線を解析的に積分して求めるので、フレームレートに
   依存せず必ず目標セルの中心で止まる。停止直前は「手前の絵柄で止まりかけ → もう1コマ
   倒れ込む → デテントにバネで収まる」という動きになる。 */
const Reel = (function () {
  'use strict';
  const IS_TV = /casaTV/.test(navigator.userAgent);
  const W = 720, H = 440, CH = 220, SW = 680, S = IS_TV ? 1 : 2; // 設計px。S はキャンバス解像度倍率（テレビ版は1で軽く）
  const MIN_FRAME = IS_TV ? 1000 / 24 - 2 : 0; // テレビ版は24フレーム上限
  const BLUR_S = 0.5, PAD = 80;
  const STRIPS = {
    1: [500, 'NEXT', 0, 1000],
    2: [1000, 'NEXT', 0, 3000, 2000, 5000],
    3: [10000, 100000, 0, 50000],
  };
  /* ステージ別の回転設定（ここを変えると止まるまでの時間を調整できる）
       speed  : 最高速（1秒あたりのコマ数）
       cruise : 最高速で回り続ける秒数 [最短, 最長]
       decel  : 減速にかける秒数
       pause  : 停止直前に「止まりかけ」で粘る秒数
       tease  : 「止まりかけ → もう1コマ進む」演出が出る割合（0〜1）
     停止までの目安: STAGE 1 約4秒 / STAGE 2 約6.5秒 / STAGE 3 約9.5秒 */
  const TIMING = {
    1: { speed: 30, cruise: [0.5, 0.8], decel: 2.1, pause: 0.35, tease: 0.5 },
    2: { speed: 32, cruise: [1.0, 1.4], decel: 3.3, pause: 0.75, tease: 0.85 },
    3: { speed: 34, cruise: [1.6, 2.1], decel: 4.6, pause: 1.3, tease: 1 },
  };
  const LINE_RGB = { 1: '233,194,94', 2: '110,200,255', 3: '255,110,90' }; // コマ境界線の色
  // 極太書体（iPad 標準搭載の Impact）。数字もラベルも同じ書体でそろえる
  const NUM_FONT = 'Impact,"Haettenschweiler","Arial Narrow Bold","Arial Black",sans-serif';
  const LBL_FONT = NUM_FONT;
  /* 彫金クロームの配色。face: 文字の面（上半分=空の映り込み / 中央の暗い水平線 / 下半分=地面の照り返し）
     ext: 側面の厚み [奥, 手前] / rim: 縁のハイライト */
  const STOPS = [0, 0.18, 0.38, 0.49, 0.51, 0.58, 0.78, 1];
  const PAL = {
    gold: { face: ['#fffef5', '#ffe9a3', '#f2c34f', '#b07a1a', '#5a3706', '#a86f18', '#f0c65a', '#fff3c4'], ext: ['#1c1002', '#a87a1e'], edge: '#0d0700', rim: '#fff3c4', glow: null },
    rich: { face: ['#ffffff', '#fff2b8', '#ffd04f', '#c48a1a', '#6a4206', '#c08418', '#ffd76a', '#fffbe6'], ext: ['#241403', '#c8922e'], edge: '#0d0700', rim: '#ffffff', glow: 'rgba(255,205,90,.6)' },
    silver: { face: ['#ffffff', '#e6ebf0', '#aeb8c4', '#5d6874', '#1c2128', '#56606c', '#b6c0cb', '#f4f7fa'], ext: ['#0c0e11', '#6a7480'], edge: '#050607', rim: '#ffffff', glow: null },
    // NEXT STAGE は「次のステージの色」で描く（STAGE 1 では青、STAGE 2 では赤）
    nextBlue: { face: ['#ffffff', '#d2efff', '#6cbcf5', '#1f66b0', '#06224a', '#1d5ea6', '#79c6f7', '#e6f6ff'], ext: ['#030d1c', '#2f7fd0'], edge: '#020810', rim: '#ffffff', glow: 'rgba(90,180,255,.8)' },
    nextRed: { face: ['#ffffff', '#ffdcd0', '#ff7a62', '#b3261a', '#3d0604', '#a8221a', '#ff8e76', '#ffe9e0'], ext: ['#1a0302', '#d0402c'], edge: '#0d0101', rim: '#ffffff', glow: 'rgba(255,80,50,.85)' },
  };
  PAL.next = PAL.nextBlue;
  /* 金額ごとの素材色: 500=ブロンズ / 1,000=ゴールド / 2,000=エメラルド / 3,000=サファイア / 5,000=アメジスト
     / 10,000=ルビー / 50,000=ダイヤモンド / 100,000=レインボー */
  const PAL_BY_VALUE = {
    500: { face: ["#fff4e6","#f3c99c","#cf8846","#8c4c1e","#3d1d08","#8c4c1e","#dba061","#ffe8cc"], ext: ["#1f0e03","#a3622c"], edge: '#0a0603', rim: '#ffffff', glow: null },
    1000: { face: ["#fffef5","#ffe9a3","#f2c34f","#b07a1a","#5a3706","#a86f18","#f0c65a","#fff3c4"], ext: ["#1c1002","#a87a1e"], edge: '#0a0603', rim: '#ffffff', glow: null },
    2000: { face: ["#f2fff6","#b9f7cb","#41d67c","#12803d","#043d1a","#167a3c","#62e291","#e2ffea"], ext: ["#021c0c","#1f9a50"], edge: '#0a0603', rim: '#ffffff', glow: 'rgba(70,230,130,.55)' },
    3000: { face: ["#ffffff","#d2efff","#6cbcf5","#1f66b0","#06224a","#1d5ea6","#79c6f7","#e6f6ff"], ext: ["#030d1c","#2f7fd0"], edge: '#0a0603', rim: '#ffffff', glow: 'rgba(90,180,255,.6)' },
    5000: { face: ["#fbf2ff","#e5c6ff","#b86ff7","#6a22b0","#2a0650","#6a24a8","#c78ef9","#f5e8ff"], ext: ["#14022a","#8a3fd6"], edge: '#0a0603', rim: '#ffffff', glow: 'rgba(190,110,255,.65)' },
    10000: { face: ["#ffffff","#ffdcd0","#ff6a55","#c01d16","#4a0604","#b31b14","#ff8e76","#fff0e8"], ext: ["#1a0302","#e0a62f"], edge: '#0a0603', rim: '#ffffff', glow: 'rgba(255,80,50,.75)' },
    50000: { face: ["#ffffff","#f4fcff","#cfeaf8","#86aec6","#2f4a5c","#8ab4cc","#e2f5ff","#ffffff"], ext: ["#0c1a24","#9fd0ea"], edge: '#0a0603', rim: '#ffffff', glow: 'rgba(210,240,255,.9)' },
    100000: { face: ["#ffffff","#ffffff","#ffffff","#ffffff","#ffffff","#ffffff","#ffffff","#ffffff"], ext: ["#1c1002","#f0c65a"], edge: '#0a0603', rim: '#ffffff', glow: 'rgba(255,255,255,.95)', rainbow: true },
  };

  let frameMs = 16.7, slow = false; // リール描画のコマ間隔の平均と、30フレームに落としているか
  let cv, ctx, stage = 1, strip = STRIPS[1], pos = 0, raf = 0;
  const imgs = {};

  const mod = (a, n) => ((a % n) + n) % n;
  // 停止位置の隣に見せる絵柄（「惜しい」演出用）を位置指定で差し替える
  let ov = {};
  const symAt = (i) => (ov[i] !== undefined ? ov[i] : strip[mod(i, strip.length)]);
  const fmt = (v) => Number(v).toLocaleString('en-US');

  let faceCv = null;
  const mix = (a, b, t) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
    return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
  };
  /* 彫金クロームの文字を描く:
     落ち影 → 側面の厚み（奥ほど暗い）→ 黒い縁 → 明るい縁 → 面（2段の映り込み）→ 内側の面取り → 斜めの光沢 */
  function metalText(c, text, cx, cy, px, font, pal, maxW, italic) {
    const setFont = (k) => { k.font = (italic ? 'italic ' : '') + '400 ' + px + 'px ' + font; k.textAlign = 'center'; k.textBaseline = 'alphabetic'; k.lineJoin = 'round'; };
    setFont(c);
    const w0 = c.measureText(text).width;
    if (w0 > maxW) { px = Math.floor(px * maxW / w0); setFont(c); }
    const m = c.measureText(text);
    const asc = m.actualBoundingBoxAscent || px * 0.75, desc = m.actualBoundingBoxDescent || 0;
    const y = cy + (asc - desc) / 2;
    const depth = Math.max(5, Math.round(px * 0.075));
    if (pal.glow) { c.save(); c.shadowColor = pal.glow; c.shadowBlur = px * 0.25; c.fillStyle = pal.glow; c.fillText(text, cx, y); c.restore(); }
    c.save(); c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 16; c.shadowOffsetY = depth + 8; c.fillStyle = pal.edge; c.fillText(text, cx, y + depth); c.restore();
    c.lineWidth = px * 0.06;
    for (let i = depth; i >= 1; i--) { // 側面
      const col = mix(pal.ext[0], pal.ext[1], 1 - i / depth);
      c.strokeStyle = col; c.fillStyle = col;
      c.strokeText(text, cx, y + i); c.fillText(text, cx, y + i);
    }
    c.lineWidth = px * 0.1; c.strokeStyle = pal.edge; c.strokeText(text, cx, y);
    c.lineWidth = px * 0.035; c.strokeStyle = pal.rim; c.strokeText(text, cx, y);
    // 面は別キャンバスで作り、文字の内側だけに面取りと光沢を重ねる
    if (!faceCv) { faceCv = document.createElement('canvas'); faceCv.width = SW * S; faceCv.height = CH * S; }
    const o = faceCv.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, faceCv.width, faceCv.height);
    o.setTransform(S, 0, 0, S, 0, 0);
    setFont(o);
    const g = o.createLinearGradient(0, y - asc, 0, y + desc);
    STOPS.forEach((s, i) => g.addColorStop(s, pal.face[i]));
    o.fillStyle = g; o.fillText(text, cx, y);
    o.globalCompositeOperation = 'source-atop';
    if (pal.rainbow) { // 虹色: 横に色を流し、その上に金属の明暗（上が明るく、中央に暗い線）を重ねる
      const wText = o.measureText(text).width;
      const rg = o.createLinearGradient(cx - wText / 2, 0, cx + wText / 2, 0);
      ['#ff3b30', '#ff9500', '#ffe600', '#34e36a', '#32d4ff', '#3a6bff', '#c15cff'].forEach((c, i) => rg.addColorStop(i / 6, c));
      o.fillStyle = rg; o.fillRect(0, y - asc - 10, SW, asc + desc + 20);
      const vg = o.createLinearGradient(0, y - asc, 0, y + desc);
      vg.addColorStop(0, 'rgba(255,255,255,.8)'); vg.addColorStop(0.36, 'rgba(255,255,255,0)'); vg.addColorStop(0.49, 'rgba(0,0,0,.4)'); vg.addColorStop(0.53, 'rgba(0,0,0,.4)'); vg.addColorStop(0.6, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(255,255,255,.55)');
      o.fillStyle = vg; o.fillRect(0, y - asc - 10, SW, asc + desc + 20);
    }
    o.lineWidth = px * 0.04;
    o.strokeStyle = 'rgba(255,255,255,.95)'; o.strokeText(text, cx - px * 0.012, y - px * 0.022); // 左上の面取り（光）
    o.strokeStyle = 'rgba(0,0,0,.5)'; o.strokeText(text, cx + px * 0.012, y + px * 0.024);       // 右下の面取り（影）
    const sg = o.createLinearGradient(cx - px, y - asc, cx + px, y + desc); // 斜めに走る光沢
    sg.addColorStop(0.3, 'rgba(255,255,255,0)'); sg.addColorStop(0.36, 'rgba(255,255,255,.55)'); sg.addColorStop(0.41, 'rgba(255,255,255,0)');
    sg.addColorStop(0.62, 'rgba(255,255,255,0)'); sg.addColorStop(0.66, 'rgba(255,255,255,.3)'); sg.addColorStop(0.7, 'rgba(255,255,255,0)');
    o.fillStyle = sg; o.fillRect(0, y - asc - 10, SW, asc + desc + 20);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(faceCv, 0, 0); c.restore();
  }

  function chevrons(c, cx, cy, dir, pal) {
    for (let i = 0; i < 3; i++) {
      const x = cx + dir * i * 26;
      c.beginPath();
      c.moveTo(x - dir * 12, cy - 34); c.lineTo(x + dir * 12, cy); c.lineTo(x - dir * 12, cy + 34);
      c.lineWidth = 9; c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = pal.edge; c.stroke();
      c.lineWidth = 5; c.strokeStyle = pal.face[i === 2 ? 0 : 2]; c.globalAlpha = 0.45 + i * 0.27; c.stroke();
      c.globalAlpha = 1;
    }
  }

  function renderSharp(sym, nextPal) {
    const c = document.createElement('canvas');
    c.width = SW * S; c.height = CH * S;
    const x = c.getContext('2d');
    x.scale(S, S);
    if (sym === 'PULL') { // レバー待ちの案内（金額を見せない）
      metalText(x, 'READY', SW / 2, CH / 2 - 34, 132, LBL_FONT, nextPal || PAL.gold, 520, true);
      metalText(x, 'TO SPIN', SW / 2, CH / 2 + 62, 62, LBL_FONT, nextPal || PAL.gold, 520, true);
    } else if (sym === 'NEXT') {
      metalText(x, 'NEXT', SW / 2, CH / 2 - 47, 100, LBL_FONT, nextPal || PAL.next, 440, true);
      metalText(x, 'STAGE', SW / 2, CH / 2 + 49, 100, LBL_FONT, nextPal || PAL.next, 440, true);
      chevrons(x, 66, CH / 2, 1, nextPal || PAL.next);
      chevrons(x, SW - 66, CH / 2, -1, nextPal || PAL.next);
    } else {
      const pal = sym === 0 ? PAL.silver : PAL_BY_VALUE[sym] || PAL.gold;
      metalText(x, fmt(sym), SW / 2, CH / 2, 190, NUM_FONT, pal, 600);
    }
    return c;
  }
  // 縦方向のモーションブラー画像を事前生成（毎フレームのフィルタ処理を避ける）
  function renderBlur(sharp, smear, n) {
    const c = document.createElement('canvas');
    c.width = SW * BLUR_S; c.height = (CH + PAD * 2) * BLUR_S;
    const x = c.getContext('2d');
    x.globalCompositeOperation = 'lighter';
    x.globalAlpha = 1 / n;
    for (let i = 0; i < n; i++) {
      const off = (i / (n - 1) - 0.5) * 2 * smear;
      x.drawImage(sharp, 0, (PAD + off) * BLUR_S, SW * BLUR_S, CH * BLUR_S);
    }
    return c;
  }
  function build() {
    [PAL.gold, PAL.nextBlue, PAL.nextRed].forEach((pal, i) => {
      const sharp = renderSharp('PULL', pal);
      imgs['PULL@' + (i + 1)] = { sharp, mid: renderBlur(sharp, 20, 9), heavy: renderBlur(sharp, 70, 19) };
    });
    const seen = {};
    Object.keys(STRIPS).forEach((k) => STRIPS[k].forEach((sym) => {
      const key = sym === 'NEXT' ? 'NEXT@' + k : sym;
      if (seen[key]) return;
      seen[key] = true;
      const sharp = renderSharp(sym, k === '1' ? PAL.nextBlue : PAL.nextRed);
      imgs[key] = { sharp, mid: renderBlur(sharp, 20, 9), heavy: renderBlur(sharp, 70, 19) };
    }));
  }

  function drawLayer(img, blurred, y, k, alpha) {
    if (alpha <= 0.01) return;
    ctx.globalAlpha = alpha;
    const w = SW * k;
    if (blurred) { const h = (CH + PAD * 2) * k; ctx.drawImage(img, (W - w) / 2, y - h / 2, w, h); }
    else { const h = CH * k; ctx.drawImage(img, (W - w) / 2, y - h / 2, w, h); }
  }

  function draw(p, speed) {
    ctx.clearRect(0, 0, W, H);
    const sp = Math.abs(speed);
    // 速度に応じて シャープ → 弱ブラー → 強ブラー をクロスフェード
    let aS = 0, aM = 0, aH = 0;
    if (sp < 2.5) aS = 1;
    else if (sp < 9) { aM = (sp - 2.5) / 6.5; aS = 1 - aM; }
    else if (sp < 20) { aH = (sp - 9) / 11; aM = 1 - aH; }
    else aH = 1;
    const base = Math.floor(p);
    const n = strip.length;
    for (let i = base - 1; i <= base + 2; i++) {
      const d = p - i;                 // 0 で中央。p が増えると絵柄は下へ流れる
      const y = H / 2 + d * CH;
      const k = 1 - 0.1 * Math.min(1, d * d); // ドラム曲面の擬似遠近
      const sy = symAt(i);
      if (sy === 'BLANK') continue;
      const im = imgs[sy === 'NEXT' || sy === 'PULL' ? sy + '@' + stage : sy];
      drawLayer(im.heavy, true, y, k, aH * 0.92);
      drawLayer(im.mid, true, y, k, aM);
      drawLayer(im.sharp, false, y, k, aS);
      // セル境界の細いライン
      ctx.globalAlpha = 0.28 * (1 - aH);
      const ly = y + CH / 2;
      const g = ctx.createLinearGradient(40, 0, W - 40, 0);
      const lc = LINE_RGB[stage];
      g.addColorStop(0, 'rgba(' + lc + ',0)'); g.addColorStop(0.5, 'rgba(' + lc + ',1)'); g.addColorStop(1, 'rgba(' + lc + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(40, ly - 1, W - 80, 2);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- 運動プロファイル ---------- */
  // 速度 v0→v1 の区間。k あり: v = v1+(v0-v1)(1-u)^k（ブレーキ的減速）/ なし: smoothstep
  function segDist(s, u) {
    if (s.e) { // 指数関数的に減速: 最初に一気に落ち、長く尾を引く
      const q = Math.exp(-s.e);
      return s.d * (s.v1 * u + ((s.v0 - s.v1) / (1 - q)) * ((1 - Math.exp(-s.e * u)) / s.e - q * u));
    }
    if (s.g) { // 指数関数的に加速: じわっと動き出して一気に最高速へ
      return s.d * (s.v0 * u + ((s.v1 - s.v0) / (Math.exp(s.g) - 1)) * ((Math.exp(s.g * u) - 1) / s.g - u));
    }
    if (s.k) return s.d * (s.v1 * u + (s.v0 - s.v1) * (1 - Math.pow(1 - u, s.k + 1)) / (s.k + 1));
    return s.d * (s.v0 * u + (s.v1 - s.v0) * (u * u * u - (u * u * u * u) / 2));
  }
  const seg = (d, v0, v1, k) => ({ d, v0, v1, k });

  /* 停止パターン（o.type）
       plain : そのまま止まる
       slip  : 1コマ手前で止まりかけ → もう1コマ滑って止まる
       slip2 : 2コマ手前・1コマ手前の2回止まりかけてから止まる
       back  : 目標を通り過ぎて次の絵柄に行きかけ → 引き戻されて止まる
     o.bait  : 止まりかけた位置に見せる絵柄（slip: [手前], slip2: [2つ手前, 手前], back: [次]）
     o.quick : 再始動用の短い回転 */
  function buildProfile(p0, st, sym, o) {
    const cfg = TIMING[st];
    const V = cfg.speed;
    const type = o.type || 'plain';
    const decT = o.quick ? 1.3 : cfg.decel, pauseT = o.quick ? 0.35 : cfg.pause;
    const TW = 0.2, AW = 0.11;                 // 始動時の「溜め」（わずかに逆方向へ引く）
    const vW = (AW * Math.PI) / TW;
    const vP = 0.2, vPk = 1.55, vL = 1.15;     // 止まりかけ速度 / 倒れ込み最高速 / デテントに落ちる速度
    let vEnd = vL, teaseIdx = -1;
    const accel = { d: 0.6, v0: vW, v1: V, g: 3.4 };
    const decay = (d, v0, v1, e) => ({ d, v0, v1, e });
    const tail = [];
    // 止まりかけ(vP)から dist セルを倒れ込み、速度 vOut で抜ける
    const tip = (dist, vOut) => {
      const sc = dist / (0.55 * (vP + vPk) / 2 + 0.34 * (vPk + vOut) / 2);
      tail.push(seg(0.55 * sc, vP, vPk), seg(0.34 * sc, vPk, vOut));
    };
    if (type === 'slip') {
      tail.push(decay(decT, V, vP, 4.4)); teaseIdx = tail.length;
      tail.push(seg(pauseT, vP, vP)); tip(1.05 - pauseT * vP, vL);
    } else if (type === 'slip2') {
      const p1 = pauseT * 0.7;
      tail.push(decay(decT, V, vP, 4.4)); teaseIdx = tail.length;
      tail.push(seg(p1, vP, vP)); tip(1.0 - p1 * vP, vP);
      tail.push(seg(pauseT, vP, vP)); tip(1.05 - pauseT * vP, vL);
    } else if (type === 'back') {
      tail.push(decay(decT, V, 0.9, 4.4)); teaseIdx = tail.length;
      tail.push(seg(0.85 / 0.45, 0.9, 0));     // 目標を 0.55 コマ通り過ぎて失速
      tail.push(seg(pauseT + 0.3, 0, 0));      // 宙づり
      tail.push(seg(0.5, 0, -2.2));            // 引き戻し
      vEnd = -2.2;
    } else {
      tail.push(decay(decT + pauseT, V, vL + 0.5, 3.8), seg(0.45, vL + 0.5, vL));
    }
    let fixed = segDist(accel, 1);
    tail.forEach((s) => (fixed += segDist(s, 1)));
    const cr = o.quick ? [0.25, 0.4] : cfg.cruise;
    const minCruise = cr[0] + Math.random() * (cr[1] - cr[0]);
    const n = STRIPS[st].length;
    let T = Math.ceil(p0 + fixed + V * minCruise);
    // 帯に無い絵柄が来ても止まらなくならないよう、探すのは1周ぶんまで
    for (let k = 0; k < n && STRIPS[st][mod(T, n)] !== sym; k++) T++;
    const cruise = seg((T - p0 - fixed) / V, V, V);
    const segs = [accel, cruise].concat(tail);
    let t = TW, p = p0, teaseAt = -1;
    segs.forEach((s, i) => { s.t0 = t; s.p0 = p; t += s.d; p += segDist(s, 1); if (i === teaseIdx + 2 && teaseIdx >= 0) teaseAt = s.t0; });
    const tStop = t;
    const SET = 0.75, OM = 19, ZE = 7;
    function at(time) {
      if (time <= 0) return p0;
      if (time < TW) return p0 - AW * Math.sin((Math.PI * time) / TW);
      if (time >= tStop) {
        const u = time - tStop;
        if (u >= SET) return T;
        return T + (vEnd / OM) * Math.exp(-ZE * u) * Math.sin(OM * u) * (1 - u / SET);
      }
      for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i];
        if (time >= s.t0) return s.p0 + segDist(s, Math.min(1, (time - s.t0) / s.d));
      }
      return p0;
    }
    // 止まりかける位置に見せる絵柄
    const bait = o.bait || [];
    const put = (i, s) => { if (s !== undefined && s !== null) ov[i] = s; };
    Object.keys(ov).forEach((k) => { if (Math.abs(k - p0) > 2) delete ov[k]; });
    [T - 2, T - 1, T, T + 1].forEach((i) => delete ov[i]);
    if (STRIPS[st][mod(T, n)] !== sym) ov[T] = sym; // 万一、帯に無い絵柄が指定されたら、その位置にそのまま表示する
    if (type === 'slip') put(T - 1, bait[0]);
    else if (type === 'slip2') { put(T - 2, bait[0]); put(T - 1, bait[1]); }
    else if (type === 'back') put(T + 1, bait[0]);
    return { at, T, V, tStop, total: tStop + SET, startAt: TW, teaseAt, teaseDur: teaseAt >= 0 ? tStop - teaseAt : 0 };
  }

  /* hooks: onStart, onTick(speedNorm), onSpeed(speedNorm), onTease(sec), onNear（停止1秒前）, onStop */
  function spin(st, sym, hooks, opts) {
    hooks = hooks || {};
    return new Promise((resolve) => {
      const prof = buildProfile(pos, st, sym, opts || {});
      const t0 = performance.now();
      let lastP = pos, lastT = 0, lastCell = Math.round(pos);
      let lastNow = t0, frameNo = 0; let lastDrawn = 0;
      let started = false, teased = false, neared = false, stopped = false;
      cancelAnimationFrame(raf);
      function frame(now) {
        const t = (now - t0) / 1000;
        const p = prof.at(t);
        const dt = Math.max(0.001, t - lastT);
        const speed = (p - lastP) / dt;
        const norm = Math.min(1, Math.abs(speed) / prof.V);
        if (!started && t >= prof.startAt) { started = true; hooks.onStart && hooks.onStart(); }
        const cell = Math.round(p);
        if (cell !== lastCell && t < prof.tStop) { lastCell = cell; hooks.onTick && hooks.onTick(norm); }
        if (started && !stopped) hooks.onSpeed && hooks.onSpeed(norm);
        if (!teased && prof.teaseAt >= 0 && t >= prof.teaseAt) { teased = true; hooks.onTease && hooks.onTease(prof.teaseDur); }
        if (!neared && t >= prof.tStop - 1.0) { neared = true; hooks.onNear && hooks.onNear(); }
        if (!stopped && t >= prof.tStop) { stopped = true; hooks.onSpeed && hooks.onSpeed(0); hooks.onStop && hooks.onStop(); }
        lastP = p; lastT = t;
        if (t >= prof.total) {
          pos = prof.T;
          draw(pos, 0);
          resolve();
          return;
        }
        // 端末が60フレームを保てないときは、描くのを1コマおきにする（不安定に上下するより30で安定させる）。
        // 位置は時刻から計算しているので、止まる位置や音のタイミングは変わらない。
        if (MIN_FRAME && now - lastDrawn < MIN_FRAME) { raf = requestAnimationFrame(frame); return; } // 24fps 上限（位置は時刻から計算するので結果は変わらない）
        lastDrawn = now;
        frameMs += (Math.min(100, now - lastNow) - frameMs) * 0.08;
        lastNow = now;
        if (!slow && frameMs > 21) slow = true; else if (slow && frameMs < 12) slow = false;
        if (MIN_FRAME || !slow || (frameNo++ & 1) === 0) draw(p, speed);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
    });
  }

  /* ステージ切替。show を指定するとその絵柄を中央に静止表示する。 */
  function setStage(st, show) {
    cancelAnimationFrame(raf);
    stage = st;
    strip = STRIPS[st];
    ov = {};
    let idx = 0;
    if (show !== undefined) { const i = strip.indexOf(show); if (i >= 0) idx = i; }
    pos = idx;
    // 絵柄の指定がないとき（レバー待ち）は、金額の代わりに案内だけを中央に出す
    if (show === undefined) { ov[pos] = 'PULL'; ov[pos - 1] = 'BLANK'; ov[pos + 1] = 'BLANK'; }
    draw(pos, 0);
  }

  function init(canvas) {
    cv = canvas;
    cv.width = W * S; cv.height = H * S;
    ctx = cv.getContext('2d');
    ctx.setTransform(S, 0, 0, S, 0, 0);
    build();
    setStage(1);
  }

  /* 当選金額などの大きな文字を、リールと同じ金属の質感で1枚の画像として描く（DOMの文字＋影より軽い） */
  function drawText(canvas, text, value) {
    canvas.width = SW * S; canvas.height = CH * S; // 幅の再設定で全消去される
    const x = canvas.getContext('2d');
    x.scale(S, S);
    const pal = value === 0 ? PAL.silver : PAL_BY_VALUE[value] || PAL.gold;
    metalText(x, text, SW / 2, CH / 2, 190, NUM_FONT, pal, 640, true);
  }

  return { init, spin, setStage, drawText, get stage() { return stage; } };
})();
