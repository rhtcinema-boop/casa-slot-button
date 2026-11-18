/* casa DERBY 3D 版の共通の土台: コースの形と寸法（単位はメートル、y が上、three.js と同じ座標系）。
   2D 版（js/race.js）と同じ数字なので、着順・タイム・カメラの考え方はそのまま使える。
   コース: 直線 400m ×2 ＋ 半円（半径 63.66m）×2 ＝ 1 周 1200m。中心が原点。
   ホームストレッチ（スタンド前の直線）は z = +r 側を x の正の向きに走り、x = +200 がゴール。スタンドは z ≒ RO+44 より外。 */
window.R3D = window.R3D || {};
R3D.Course = (function () {
  'use strict';
  const LS = 400, RC = 200 / Math.PI, L = 1200, HALF = 7;
  const RI = RC - HALF, RO = RC + HALF;   // 内ラチ・外ラチの半径
  const FINISH_S = LS;                    // ゴールの位置（周回の距離 s）
  const SUN = (function () { const v = { x: -0.5, y: 0.8, z: 0.42 }, n = Math.hypot(v.x, v.y, v.z); return { x: v.x / n, y: v.y / n, z: v.z / n }; })(); // 太陽の向き（地面→太陽）
  // 周回の距離 s、中心からの距離 r の地点と、進む向き (hx,hz)
  function pointAt(s, r) {
    s = ((s % L) + L) % L;
    if (s < LS) return { x: -LS / 2 + s, z: r, hx: 1, hz: 0 };
    if (s < LS + Math.PI * RC) { const th = (s - LS) / RC; return { x: LS / 2 + r * Math.sin(th), z: r * Math.cos(th), hx: Math.cos(th), hz: -Math.sin(th) }; }
    if (s < 2 * LS + Math.PI * RC) { const d = s - LS - Math.PI * RC; return { x: LS / 2 - d, z: -r, hx: -1, hz: 0 }; }
    const th = (s - 2 * LS - Math.PI * RC) / RC; return { x: -LS / 2 - r * Math.sin(th), z: -r * Math.cos(th), hx: -Math.cos(th), hz: Math.sin(th) };
  }
  // コースの外向き（スタンド・外ラチの方向）
  function outward(p) {
    if (Math.abs(p.x) <= LS / 2) return { x: 0, z: p.z >= 0 ? 1 : -1 };
    const cx = p.x > 0 ? LS / 2 : -LS / 2, dx = p.x - cx, dz = p.z, n = Math.hypot(dx, dz) || 1; return { x: dx / n, z: dz / n };
  }
  const laneR = (i) => RI + 1.6 + i * 1.95; // 枠順ごとのスタート時の進路
  // 発走地点（距離 dist のレース）
  const startS = (dist) => ((FINISH_S - dist) % L + L) % L;
  // 発走ゲートを置く位置（周回の s）。ふつうは発走地点そのもの。発走地点がゴールの真上（1200m＝1 周）のときは、
  // ゲートがゴール板（内ラチ側の柱）・ハロン棒とぶつかるので 2.4m 手前に置く（馬はゲートから出て最初の 40m で本来の位置に追いつく）
  const gateOff = (dist) => { const d = ((startS(dist) - FINISH_S) % L + L) % L; return Math.min(d, L - d) < 4 ? -2.4 : 0; };
  const gateS = (dist) => startS(dist) + gateOff(dist);
  // パドック（コースとは別の場所。楕円の周回路）: 中心と半径
  const PADDOCK = { cx: 0, cz: RO + 140, a: 26, b: 12, w: 3.2 };
  return { LS, RC, L, HALF, RI, RO, FINISH_S, SUN, pointAt, outward, laneR, startS, gateOff, gateS, PADDOCK };
})();
