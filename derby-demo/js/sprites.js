/* 写真風の馬スプライト（art/sprites/<毛色>_<向き>.png、1 行に並んだコマ）
   - 勝負服（マゼンタで描かせてある）を馬ごとの服色に、ゼッケン（シアン）を白に、明るさを保って塗り替える
   - 読み込み時に 1 回だけ、胴に丸みの陰影（背は明るく腹は暗く）を焼き込む（毎コマの画素処理はしない）
   - 用意できていない毛色・向きは null を返す（呼び出し側は図形の馬で代用）
   - コマの間は「本当の重ね合わせ」（前のコマ×(1−t)＋次のコマ×t）でつなぐ。胴は不透明のまま、動く脚だけが溶け合って
     中継映像の脚のブレ（シャッターの流れ）に近くなる */
window.Sprites = (function () {
  'use strict';
  let index = null, ready = false;
  const raw = {}, cache = {};
  function load(base) {
    base = base || '';
    return fetch(base + 'art/sprites/index.json?t=' + Date.now()).then((r) => r.json()).then((ix) => {
      index = ix;
      return Promise.all(Object.keys(ix).map((name) => new Promise((res) => { const im = new Image(); im.onload = () => { raw[name] = im; res(); }; im.onerror = () => res(); im.src = base + 'art/sprites/' + name + '.png'; })));
    }).then(() => { ready = true; }).catch(() => { ready = false; });
  }
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  function recolor(im, silk, fw, nFrames) {
    const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const c = cv.getContext('2d'); c.drawImage(im, 0, 0);
    const d = c.getImageData(0, 0, cv.width, cv.height), p = d.data, base = hex(silk.base), W = cv.width;
    const cl = Array.from({ length: nFrames }, () => ({ sx: 0, sy: 0, n: 0, x0: 1e9, x1: -1, y0: 1e9, y1: -1 }));
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 8) continue;
      const r = p[i], g = p[i + 1], b = p[i + 2];
      if (r > 90 && b > 55 && g < r * 0.55 && b > g * 1.15) {            // マゼンタ〜クリムゾン → 服色
        const l = Math.min(1.25, (r * 0.7 + b * 0.3) / 190), w = Math.min(1, (r - g) / 90);
        for (let k = 0; k < 3; k++) { const v = Math.min(255, base[k] * l + (l > 1 ? (l - 1) * 200 : 0)); p[i + k] = Math.round(p[i + k] * (1 - w) + v * w); }
      } else if (g > 90 && b > 90 && r < Math.min(g, b) * 0.65) {        // シアン → 白いゼッケン
        const l = Math.min(1, (g + b) / 2 / 220) * 245, w = Math.min(1, (Math.min(g, b) - r) / 80);
        p[i] = Math.round(r * (1 - w) + l * w); p[i + 1] = Math.round(g * (1 - w) + l * w); p[i + 2] = Math.round(b * (1 - w) + l * w);
        if (w > 0.6) { const px = (i / 4) % W, py = ((i / 4) / W) | 0, f = Math.min(nFrames - 1, (px / fw) | 0), q = cl[f]; q.sx += px - f * fw; q.sy += py; q.n++; if (px - f * fw < q.x0) q.x0 = px - f * fw; if (px - f * fw > q.x1) q.x1 = px - f * fw; if (py < q.y0) q.y0 = py; if (py > q.y1) q.y1 = py; }
      }
    }
    c.putImageData(d, 0, 0);
    cv.cloth = cl.map((q) => (q.n > 30 ? { x: q.sx / q.n, y: q.sy / q.n, w: q.x1 - q.x0, h: q.y1 - q.y0 } : null));
    return cv;
  }
  // 立体感: 光は左上。背〜肩は明るく、腹〜脚の付け根は暗く（体の丸み）。合成 1〜2 回なので軽い
  function shade(cv, ix, view) {
    const c = cv.getContext('2d'), H = cv.height, legY = ix.legY || H * 0.68, top = ix.top != null ? ix.top : ix.pad;
    const t = (y) => Math.max(0, Math.min(1, y / H));
    c.save(); c.globalCompositeOperation = 'source-atop';
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(t(top), 'rgba(255,244,225,.10)'); g.addColorStop(t(top + (legY - top) * 0.45), 'rgba(255,244,225,0)');
    g.addColorStop(t(legY - (legY - top) * 0.14), 'rgba(0,0,0,0)'); g.addColorStop(t(legY + 3), 'rgba(12,7,4,.32)'); g.addColorStop(t(legY + (H - legY) * 0.5), 'rgba(12,7,4,.12)'); g.addColorStop(1, 'rgba(12,7,4,.08)');
    c.fillStyle = g; c.fillRect(0, 0, cv.width, H);
    if (view !== 'side') {
      // 正面・後ろ: 左右の端を落として円柱らしく（光は左から）
      for (let f = 0; f < ix.frames; f++) { const x0 = f * ix.w, sg = c.createLinearGradient(x0 + ix.w * 0.25, 0, x0 + ix.w * 0.75, 0); sg.addColorStop(0, 'rgba(0,0,0,.12)'); sg.addColorStop(0.35, 'rgba(255,240,220,.06)'); sg.addColorStop(0.6, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,.24)'); c.fillStyle = sg; c.fillRect(x0, 0, ix.w, H); }
    }
    c.restore();
  }
  // coat_view のコマ帯（塗り替え済み）と寸法を返す
  function get(coat, view, silk) {
    if (!ready) return null;
    const name = coat + '_' + view, im = raw[name], ix = index && index[name];
    if (!im || !ix) return null;
    const key = name + '|' + (silk ? silk.base : '');
    if (!cache[key]) {
      let cv;
      if (silk) cv = recolor(im, silk, ix.w, ix.frames); else { cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; cv.getContext('2d').drawImage(im, 0, 0); }
      shade(cv, ix, view);
      const n = ix.frames, clear = ix.clear || [];
      // 蹄が一番低いコマ＝最後の脚で地面を蹴る瞬間。その半コマ後が宙に浮く瞬間（胴が一番高い）。上下動の山をここに合わせる
      let susp = 0; clear.forEach((v, k) => { if (v < clear[susp]) susp = k; });
      cache[key] = { cv, cloth: cv.cloth || [], n, w: ix.w, h: ix.h, pad: ix.pad, ground: ix.ground || ix.h - ix.pad, top: ix.top != null ? ix.top : ix.pad, legY: ix.legY || ix.h * 0.68, splitX: ix.splitX || ix.w / 2, neckX: ix.neckX, walkFrame: ix.walkFrame, susp: clear.length ? (susp + 0.5) / n : 0, clear };
    }
    return cache[key];
  }
  // 重ね合わせ用の作業キャンバス（全員で 1 枚を使い回す。小さくはしない）
  const tmp = document.createElement('canvas'), tc = tmp.getContext('2d');
  // 胴から上（頭・尾・騎手）は短い間で切り替え、脚は長い間で溶け合わせる（頭や尾が二重に見えないように）
  function blend(sp, f, f2, frU, frL, w, h, cut) {
    if (tmp.width < w || tmp.height < h) { tmp.width = Math.max(tmp.width, w); tmp.height = Math.max(tmp.height, h); }
    tc.globalCompositeOperation = "source-over"; tc.globalAlpha = 1; tc.clearRect(0, 0, w + 1, h + 1);
    [[0, cut, frU], [cut, h - cut, frL]].forEach(([y0, bh, t]) => {
      if (bh <= 0) return;
      tc.save(); tc.beginPath(); tc.rect(0, y0, w, bh); tc.clip();
      tc.globalCompositeOperation = "source-over"; tc.globalAlpha = 1 - t; tc.drawImage(sp.cv, f * sp.w, 0, sp.w, sp.h, 0, 0, w, h);
      tc.globalCompositeOperation = "lighter"; tc.globalAlpha = t; tc.drawImage(sp.cv, f2 * sp.w, 0, sp.w, sp.h, 0, 0, w, h);
      tc.restore();
    });
    tc.globalCompositeOperation = "source-over"; tc.globalAlpha = 1;
  }
  // 軽量モード: 重ね合わせ・脚のブレをやめて 1 枚描きに（?lite=1 で強制。描画中に 1 コマ 28ms 超えが続く遅い機械では自動で切り替え）
  let lite = /[?&]lite=1/.test(location.search), drew = 0, ema = 16, slow = 0, last = 0;
  (function watch(t) {
    if (last && drew) { ema = ema * 0.9 + Math.min(100, t - last) * 0.1; slow = ema > 28 ? slow + 1 : 0; if (slow > 120 && !lite) { lite = true; if (window.console) console.log("Sprites: 軽量モードに切り替え"); } }
    last = t; drew = 0; if (!lite) requestAnimationFrame(watch);
  })(0);
  // 1 コマ描く。x,y は足元の中心、heightPx は馬＋騎手の高さ（px）
  // frame は小数可（前後のコマを重ね合わせてなめらかに）。
  // motion: { bob: 上下(px), rock: 前後の傾き(rad), skew: 遠近の傾き,
  //           settle: 浮いたコマを地面へ下ろす割合(0〜1), lift: [左, 右]（正面・後ろで脚をたたむ量 0〜1）, legs: [前脚, 後脚]（横向きの常歩で脚を振るゆがみ）, nod: 首の上下(rad、正で頭が下がる), blur: 脚のブレ(0〜1) }
  function draw(c, sp, frame, x, y, heightPx, squash, no, flip, view, motion) {
    // 重ね合わせ: 脚はコマの間の 6 割で溶け合わせ、胴から上は 2.5 割で素早く切り替える（脚が 8 本・頭が 2 つに見える時間を短く）
    const fi = Math.floor(frame), ss = (t) => t * t * (3 - 2 * t), fr = ss(Math.max(0, Math.min(1, (frame - fi - 0.2) / 0.6))), frU = ss(Math.max(0, Math.min(1, (frame - fi - 0.38) / 0.24))), f = ((fi % sp.n) + sp.n) % sp.n, f2 = (f + 1) % sp.n, s = heightPx / (sp.ground - sp.top), sq = squash || 1;
    const dw = sp.w * s * sq, dh = sp.h * s, m = motion || {};
    // settle: 蹄が地面から浮いているコマを、その分だけ下げる（元絵ごとの浮きのばらつきを消す。コマの間はなめらかに）
    const cl = sp.clear, drop = m.settle && cl.length ? m.settle * ((cl[f] || 0) * (1 - fr) + (cl[f2] || 0) * fr) * s : 0;
    c.save(); c.translate(x, y - (m.bob || 0) + drop);
    if (m.rock) { const py = -dh * 0.4; c.translate(0, py); c.rotate(m.rock); c.translate(0, -py); }
    if (m.skew) c.transform(1, m.skew, 0, 1, 0, 0);
    const x0 = -dw / 2, y0 = -sp.ground * s;
    // 小さい絵は作業キャンバスを通さない（重ね合わせの差が見えないので軽さ優先）
    const W = Math.ceil(dw), Hh = Math.ceil(dh), small = lite || Hh < 16; drew++;
    let src = sp.cv, sx = f * sp.w, sw = sp.w, sh = sp.h;
    if (!small && sp.n > 1 && fr > 0.02) { blend(sp, f, f2, frU, fr, W, Hh, Hh > 40 ? Math.round((sp.legY - 4) * Hh / sp.h) : 0); src = tmp; sx = 0; sw = W; sh = Hh; }
    else if (small && fr >= 0.5) sx = f2 * sp.w;
    const kx = sw / sp.w, ky = sh / sp.h;
    // コマの一部（元の座標 ax..）を描画先（元の座標で bx..）へ
    const part = (ax, ay, aw, ah, bx, by, bw, bh) => c.drawImage(src, sx + ax * kx, ay * ky, aw * kx, ah * ky, x0 + bx * s * sq, y0 + by * s, bw * s * sq, bh * s);
    const legY = sp.legY, L = sp.h - legY;
    if (m.lift && !small) {
      // 正面・後ろ: 腹の線より上はそのまま、下は左右に分けて縦に縮める（脚を持ち上げてたたむ）
      const mid = sp.w / 2;
      part(0, 0, sp.w, legY + 0.5, 0, 0, sp.w, legY + 0.5);
      for (let k = 0; k < 2; k++) { const kk = 1 - Math.max(0, Math.min(1, m.lift[k])) * 0.28; part(k ? mid : 0, legY, mid, L, k ? mid : 0, legY, mid, L * kk); }
    } else if (m.legs && !small) {
      // 横向き（パドックの常歩）: 前脚・後脚を、腹の線を軸にそれぞれ前後へ振る
      const sX = sp.splitX;
      part(0, 0, sp.w, legY + 0.5, 0, 0, sp.w, legY + 0.5);
      [[0, sX, m.legs[1]], [sX, sp.w - sX, m.legs[0]]].forEach(([ax, aw, a]) => {
        const cx = x0 + (ax + aw / 2) * s * sq, cy = y0 + legY * s;
        c.save(); c.beginPath(); c.rect(x0 + ax * s * sq - (ax ? 0 : 40), cy, aw * s * sq + 40, L * s + 2); c.clip();
        c.translate(cx, cy); c.transform(1, 0, a, 1, 0, 0); c.translate(-cx, -cy);
        part(ax, legY, aw, L, ax, legY, aw, L); c.restore();
      });
    } else if (m.nod && view === "side" && !small) {
      // 首の上下動: 首の付け根（騎手の前）を軸に、首から先を回す。元の頭は描かず、付け根の近くだけ元の絵を残して継ぎ目を隠す
      const nx = sp.w * 0.653, hx = sp.w * 0.75, cy = sp.h * 0.48, px = x0 + nx * s * sq, py = y0 + sp.h * 0.385 * s;
      c.save(); c.beginPath(); c.rect(x0 - 2, y0 - 2, dw + 4, dh + 4); c.rect(x0 + hx * s * sq, y0 - 2, (sp.w - hx) * s * sq + 2, cy * s + 2); c.clip("evenodd");
      c.drawImage(src, sx, 0, sw, sh, x0, y0, dw, dh); c.restore();
      c.save(); c.translate(px, py); c.rotate(m.nod); c.translate(-px, -py);
      c.beginPath(); c.rect(px, y0 - 2, (sp.w - nx) * s * sq + 2, cy * s + 2); c.clip();
      c.drawImage(src, sx, 0, sw, sh, x0, y0, dw, dh); c.restore();
    } else {
      c.drawImage(src, sx, 0, sw, sh, x0, y0, dw, dh);
    }
    // 脚のブレ: 腹の線より下を前後に少しずらして薄く重ねる（速いほど強く）
    if (m.blur > 0.05 && Hh > 40 && !lite) {
      const a = c.globalAlpha;
      c.globalAlpha = a * 0.14 * m.blur; part(0, legY + 6, sp.w, L - 6, -6 * m.blur, legY + 6, sp.w, L - 6);
      c.globalAlpha = a * 0.08 * m.blur; part(0, legY + 6, sp.w, L - 6, 6 * m.blur, legY + 6, sp.w, L - 6);
      c.globalAlpha = a;
    }
    // ゼッケンの馬番（横向きで十分大きいときだけ）
    const q = sp.cloth[fr < 0.5 ? f : f2];
    if (no != null && q && view === 'side' && q.h * s > 9) {
      const cx = x0 + q.x * s * sq, cy = y0 + q.y * s, fs = Math.max(7, q.h * s * 0.62); c.globalAlpha = 1;
      c.save(); c.translate(cx, cy); if (flip) c.scale(-1, 1); c.scale(Math.max(0.5, sq), 1);
      c.fillStyle = '#111'; c.font = 'bold ' + Math.round(fs) + 'px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(no), 0, fs * 0.05);
      c.restore();
    }
    c.restore();
  }
  return { load, get, draw, get ready() { return ready; }, get lite() { return lite; }, set lite(v) { lite = !!v; } };
})();
