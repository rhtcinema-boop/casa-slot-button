/* ボーナス牧場（みんなでダービーのボーナスゲーム風）。
   同じ canvas で遊ぶ。自分の馬を左右に動かして、上から落ちてくるメダルと宝箱を集める。
   Bonus.play(canvas, tier, horse) → Promise<獲得メダル>。tier は Engine.ROULETTE の項目（sec, chest） */
window.Bonus = (function () {
  'use strict';
  const W = 1000, H = 480;
  // drawHorse(c, x, y, pxPerM) を渡すと自分の馬をその絵で描く（3D のときはレースで走った 3D の馬と同じ見た目）。false なら 2D の馬
  function play(canvas, tier, horse, onScore, drawHorse) {
    const c = canvas.getContext('2d');
    return new Promise((resolve) => {
      let x = W / 2, dir = 0, t = 0, endT = 0, left = tier.sec, score = 0, items = [], pops = [], last = performance.now(), spawnAt = 0, over = false;
      const speed = tier.key === 'ultra' ? 1.35 : tier.key === 'special' ? 1.15 : 1;
      function key(e) { if (e.key === 'ArrowLeft') dir = -1; else if (e.key === 'ArrowRight') dir = 1; else return; e.preventDefault(); }
      function keyup(e) { if (e.key === 'ArrowLeft' && dir < 0 || e.key === 'ArrowRight' && dir > 0) dir = 0; }
      function ptr(e) { const r = canvas.getBoundingClientRect(); const px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; dir = px < r.width / 2 ? -1 : 1; e.preventDefault(); }
      function ptrUp() { dir = 0; }
      document.addEventListener('keydown', key); document.addEventListener('keyup', keyup);
      canvas.addEventListener('pointerdown', ptr); canvas.addEventListener('pointerup', ptrUp); canvas.addEventListener('pointercancel', ptrUp); canvas.addEventListener('pointerleave', ptrUp);
      function cleanup() { document.removeEventListener('keydown', key); document.removeEventListener('keyup', keyup); canvas.removeEventListener('pointerdown', ptr); canvas.removeEventListener('pointerup', ptrUp); canvas.removeEventListener('pointercancel', ptrUp); canvas.removeEventListener('pointerleave', ptrUp); }
      function frame(now) {
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; t += dt;
        if (!over) left -= dt; else endT += dt;
        if (left <= 0 && !over) { over = true; setTimeout(() => { cleanup(); resolve(score); }, 1600); }
        x = Math.max(40, Math.min(W - 40, x + dir * 420 * dt));
        // 落ちてくるもの
        spawnAt -= dt;
        if (spawnAt <= 0 && !over) {
          spawnAt = (0.32 / speed) + Math.random() * 0.2;
          const r = Math.random();
          items.push({ x: 40 + Math.random() * (W - 80), y: -30, vy: (170 + Math.random() * 120) * speed, kind: r < tier.chest ? 'chest' : r < tier.chest + 0.18 ? 'gold' : 'medal', rot: Math.random() * 6.28 });
        }
        items.forEach((it) => { it.y += it.vy * dt; it.rot += dt * 4; });
        items = items.filter((it) => {
          if (it.y > H - 46 && Math.abs(it.x - x) < 44) {
            const v = it.kind === 'chest' ? 20 : it.kind === 'gold' ? 5 : 1; score += v; pops.push({ x: it.x, y: H - 70, v, t: 0 });
            if (onScore) onScore(score, v);
            return false;
          }
          return it.y < H + 40;
        });
        pops.forEach((p) => (p.t += dt)); pops = pops.filter((p) => p.t < 0.8);
        draw();
        // 終わってから 1.6 秒（結果表示のぶん）で描くのをやめる（止めないとレース画面と取り合いになる）
        if (!over || endT < 1.6) requestAnimationFrame(frame);
      }
      // テレビで読めるよう太い丸ゴシックで描く
      const F = '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
      function panel(x, y, w, h, r, fill) { c.fillStyle = fill || 'rgba(10,30,60,.72)'; Race.roundRect(c, x, y, w, h, r); c.fill(); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 3; c.stroke(); }
      function medalIcon(x, y, r) { c.fillStyle = '#b07400'; c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fill(); c.fillStyle = '#ffd54f'; c.beginPath(); c.arc(x, y, r * 0.82, 0, 6.28); c.fill(); c.fillStyle = '#fff6c8'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.25, 0, 6.28); c.fill(); }
      function draw() {
        // 牧場: 空・雲・丘・柵・芝の縞
        const sky = c.createLinearGradient(0, 0, 0, 300); sky.addColorStop(0, '#4aa8ee'); sky.addColorStop(1, '#d7effc'); c.fillStyle = sky; c.fillRect(0, 0, W, H);
        c.fillStyle = 'rgba(255,250,200,.9)'; c.beginPath(); c.arc(560, 80, 34, 0, 6.28); c.fill();
        c.fillStyle = 'rgba(255,255,255,.9)'; [[180, 150], [470, 190], [800, 140]].forEach(([cx, cy]) => { const bx = ((cx + t * 12) % (W + 200)) - 100; [[0, 0, 26], [24, -8, 30], [52, 0, 24]].forEach(([dx, dy, r]) => { c.beginPath(); c.arc(bx + dx, cy + dy, r, 0, 6.28); c.fill(); }); });
        c.fillStyle = '#7fcf62'; c.beginPath(); c.moveTo(0, 300); c.quadraticCurveTo(250, 200, 500, 290); c.quadraticCurveTo(750, 220, W, 300); c.lineTo(W, H); c.lineTo(0, H); c.fill();
        c.fillStyle = '#8ad45a'; c.fillRect(0, 330, W, H);
        c.fillStyle = 'rgba(255,255,255,.12)'; for (let k = 0; k < 10; k += 2) c.fillRect(k * 100, 330, 100, H);
        c.fillStyle = '#fff'; for (let k = 0; k < 14; k++) { c.fillRect(30 + k * 72, 296, 8, 44); } c.fillRect(0, 306, W, 6); c.fillRect(0, 324, W, 6);
        // 看板: 左=種類と残り時間（バー）、右=獲得枚数
        panel(16, 12, 440, 62, 14);
        c.fillStyle = tier.key === 'ultra' ? '#ff8a80' : tier.key === 'special' ? '#ffe082' : '#b9f6ca'; c.font = '900 26px ' + F; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(tier.label, 34, 36);
        c.fillStyle = '#fff'; c.textAlign = 'right'; c.font = '900 26px ' + F; c.fillText('残り ' + Math.max(0, Math.ceil(left)) + ' 秒', 440, 36);
        c.fillStyle = 'rgba(255,255,255,.25)'; Race.roundRect(c, 34, 56, 406, 8, 4); c.fill();
        c.fillStyle = left < 4 ? '#ff5252' : '#ffd54f'; Race.roundRect(c, 34, 56, Math.max(0, 406 * left / tier.sec), 8, 4); c.fill();
        panel(W - 300, 12, 284, 62, 14);
        medalIcon(W - 268, 43, 18);
        c.fillStyle = '#ffe36b'; c.font = '900 40px ' + F; c.textAlign = 'right'; c.fillText(score + ' 枚', W - 34, 45);
        // 落ちもの
        items.forEach((it) => drawItem(c, it));
        // 自分の馬（カゴを持っているつもりで下に受け皿）
        c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(x, H - 24, 56, 10, 0, 0, 6.28); c.fill();
        c.fillStyle = '#8d5a2b'; Race.roundRect(c, x - 48, H - 50, 96, 26, 9); c.fill(); c.fillStyle = '#d9a35c'; Race.roundRect(c, x - 42, H - 47, 84, 8, 4); c.fill();
        if (!(drawHorse && drawHorse(c, x, H - 52 - Math.abs(Math.sin(t * 9)) * 5, 1.25 * 38))) Race.drawChibi(c, x, H - 52, 1.25, horse, t * 10, { shadow: false });
        // 得点の飛び出し
        pops.forEach((p) => { c.globalAlpha = 1 - p.t / 0.8; c.font = '900 ' + (p.v >= 20 ? 40 : p.v >= 5 ? 30 : 24) + 'px ' + F; c.textAlign = 'center'; c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeText('+' + p.v, p.x, p.y - p.t * 60); c.fillStyle = p.v >= 20 ? '#ff5252' : p.v >= 5 ? '#ffd54f' : '#fff'; c.fillText('+' + p.v, p.x, p.y - p.t * 60); c.globalAlpha = 1; });
        if (over) {
          c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(0, 0, W, H);
          panel(W / 2 - 300, H / 2 - 90, 600, 180, 24, 'rgba(255,214,79,.96)');
          c.fillStyle = '#7a4a00'; c.font = '900 30px ' + F; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('ボーナス終了！', W / 2, H / 2 - 44);
          medalIcon(W / 2 - 150, H / 2 + 26, 26);
          c.fillStyle = '#b33a00'; c.font = '900 64px ' + F; c.fillText(score + ' 枚 GET', W / 2 + 24, H / 2 + 28);
        } else if (t < 2.5) {
          panel(W / 2 - 330, 96, 660, 70, 18, 'rgba(0,0,0,.6)');
          c.fillStyle = '#fff'; c.font = '900 26px ' + F; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('← → か 画面の左右をタッチして メダルを集めよう！', W / 2, 131);
        }
      }
      function drawItem(c, it) {
        c.save(); c.translate(it.x, it.y);
        if (it.kind === 'chest') {
          c.fillStyle = 'rgba(255,230,120,.35)'; c.beginPath(); c.arc(0, 0, 30, 0, 6.28); c.fill();
          c.fillStyle = '#6d3f17'; Race.roundRect(c, -22, -16, 44, 32, 6); c.fill(); c.fillStyle = '#9a5d26'; Race.roundRect(c, -19, -13, 38, 12, 4); c.fill(); Race.roundRect(c, -19, 2, 38, 11, 3); c.fill();
          c.fillStyle = '#ffd54f'; c.fillRect(-22, -2, 44, 5); c.fillRect(-4, -16, 8, 32); c.fillStyle = '#7a4a00'; c.fillRect(-2, 0, 4, 5);
        } else {
          const w = Math.abs(Math.cos(it.rot)) * 18 + 2, g = it.kind === 'gold';
          c.fillStyle = g ? '#a86e00' : '#7b8790'; c.beginPath(); c.ellipse(0, 0, w + 2, 20, 0, 0, 6.28); c.fill();
          c.fillStyle = g ? '#ffb300' : '#cfd8dc'; c.beginPath(); c.ellipse(0, 0, w, 18, 0, 0, 6.28); c.fill();
          c.fillStyle = g ? '#ffe082' : '#f5f7f8'; c.beginPath(); c.ellipse(0, 0, w * 0.6, 11, 0, 0, 6.28); c.fill();
        }
        c.restore();
      }
      requestAnimationFrame(frame);
    });
  }
  return { play };
})();
