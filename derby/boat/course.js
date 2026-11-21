/* casa BOAT（競艇）の共通の土台: 競走水面の形と寸法（単位 m、y が上、three.js と同じ座標系）。window.BOAT.Course。
   2026-11-17 作り直し: 想像の寸法をやめ、調査の数字だけで作る（オーナー「想像で作るのは一個もやらないで」「全国の真ん中の寸法で」）。
   出典は ref/boat/research/03_競走水面の実寸と設備.md（告示・水上施設統一基準・公式の水面図 24 場の中央値）と 02_1マークの攻防と旋回.md（旋回の道のり）。

   座標: 原点＝2 つのターンマークの中点（＝センターポール）。x＝マークを結ぶ線（第 1 マークが +150、第 2 マークが −150。マークの間 300m）。
         z＝スタンド側が +。艇は左回り（上から見て反時計回り）: ホームストレッチ（z > 0）を +x へ走り、第 1 マークを左へ回り、バックストレッチ（z < 0）を −x へ戻る。
   スタート＝ゴールの線: x = 0（両マークから 150m。全場共通）。センターポール（原点）と大時計（スタンド側の水ぎわ）を結ぶ線。
   岸はマークの線と平行ではない（第 1 マークがスタンドに寄る「振り」。24 場の中央値で 300m に 22m ＝ 約 4.2°）:
     スタンド側の水ぎわ shoreZ(x): 第 2 マークの所 66m → スタート線 55m → 第 1 マークの所 44m
     対岸 farZ(x)            : 第 2 マークの所 70m → スタート線 80.5m → 第 1 マークの所 91m
     水面の端: 第 1 マークの奥 78m（x = +228）、第 2 マークの奥 118m（x = −268。ここにピット）

   艇の道のり: 公称は「マークの間 300m の往復 ＝ 1 周 600m」だが、実際に走る道のりは 1 周 約 700m（単走の GPS で 3 周 2099m）。
     ターン 1 回の余分 約 50m ＝ マークから半径 16m の半円の長さ。→ 進み具合の物差しは「直線 300m ×2 ＋ 半径 RC=16m の半円 ×2 ＝ 1 周 約 700.5m」。
     pointAt(s, r): 周回の距離 s（0 ＝ 第 2 マークの真横のホーム側）と、マークの列からの距離 r（艇の横の位置）→ 場所と進む向き。
     艇が通れる r: マークぎわ 2.5m（最接近は 1 艇身前後）〜 外 40m（ホームは岸があるので、第 1 マークの所で 44m − 余裕）。 */
window.BOAT = window.BOAT || {};
BOAT.Course = (function () {
  'use strict';
  const MARK_GAP = 300, LS = MARK_GAP, RC = 16, TURN_LEN = Math.PI * RC, L = 2 * LS + 2 * TURN_LEN; // 1 周の道のり 約 700.5m
  const NOMINAL_LAP = 600;                        // 公称の 1 周（画面の「1200m」などの表示用）
  const RI = 2.5, RO = 40;
  const FINISH_S = LS / 2;                        // スタート＝ゴールの線（s = 150 ＝ x = 0）
  const LINE_X = 0;
  const MARK1 = { x: MARK_GAP / 2, z: 0 }, MARK2 = { x: -MARK_GAP / 2, z: 0 };
  const X_MIN = MARK2.x - 118, X_MAX = MARK1.x + 78; // 水面の端（第 2 マークの奥がピット）
  const shoreZ = (x) => 55 - (22 / MARK_GAP) * x;     // スタンド側の水ぎわ（+z）
  const farZ = (x) => -(80.5 + (21 / MARK_GAP) * x);  // 対岸（−z）
  const CENTER_POLE = { x: 0, z: 0 };
  const CLOCK = { x: 0, z: shoreZ(0) };               // 大時計: スタート線の上・スタンド側の水ぎわ（文字盤は直径 3m・軸の高さ 2.5m 以内・黒。助走の艇のほうへ向く）
  const BUOY = { x: MARK2.x + 20, z: 0 };             // 小回り防止ブイ: 第 2 マークから 20m（マークの線の上・スタート線寄り）
  const POLES = [5, 45, 80, 100];                     // 標識ポール（スタート線の手前 m。マークの線の上）。空中線は 5・45・80 の 3 本だけ
  const BOARDS = [5, 45, 85, 100, 150];               // 距離の標識板（スタンド側の岸ぞい）
  const PIT = { x: X_MIN + 6, z: 12, gap: 2.2, n: 6 }; // ピット（第 2 マークの奥 118m）。艇は +x 向きに出る。1 号艇が対岸寄りか・間隔は映像で要確認（venue が決めて公開する）
  const SUN = (function () { const v = { x: -0.45, y: 0.82, z: 0.36 }, n = Math.hypot(v.x, v.y, v.z); return { x: v.x / n, y: v.y / n, z: v.z / n }; })();
  // 周回の距離 s、マークの列からの距離 r の地点と、進む向き (hx,hz)
  function pointAt(s, r) {
    s = ((s % L) + L) % L;
    if (s < LS) return { x: MARK2.x + s, z: r, hx: 1, hz: 0 };
    if (s < LS + TURN_LEN) { const th = (s - LS) / RC; return { x: MARK1.x + r * Math.sin(th), z: r * Math.cos(th), hx: Math.cos(th), hz: -Math.sin(th) }; }
    if (s < 2 * LS + TURN_LEN) { const d = s - LS - TURN_LEN; return { x: MARK1.x - d, z: -r, hx: -1, hz: 0 }; }
    const th = (s - 2 * LS - TURN_LEN) / RC; return { x: MARK2.x - r * Math.sin(th), z: -r * Math.cos(th), hx: -Math.cos(th), hz: Math.sin(th) };
  }
  // s がターンの中か（0 = 直線, 1 = 第 1 マーク, 2 = 第 2 マーク）と、ターンの中の進み具合 0〜1
  function turnAt(s) {
    s = ((s % L) + L) % L;
    if (s >= LS && s < LS + TURN_LEN) return { turn: 1, u: (s - LS) / TURN_LEN };
    if (s >= 2 * LS + TURN_LEN) return { turn: 2, u: (s - 2 * LS - TURN_LEN) / TURN_LEN };
    return { turn: 0, u: 0 };
  }
  // 直線にいるとき: 次のターンの入口までの距離と、前のターンの出口からの距離
  function turnDist(s) {
    s = ((s % L) + L) % L;
    if (s < LS) return { toIn: LS - s, fromOut: s };
    if (s >= LS + TURN_LEN && s < 2 * LS + TURN_LEN) return { toIn: 2 * LS + TURN_LEN - s, fromOut: s - LS - TURN_LEN };
    return { toIn: 0, fromOut: 0 };
  }
  // 以前の名前（会場の部品が使う。岸がななめになったので、いちばん近い所の値）
  const SHORE_Z = shoreZ(MARK1.x), FAR_Z = farZ(MARK2.x), END_X = X_MAX, STAND_Z = shoreZ(0) + 4;
  return { MARK_GAP, LS, RC, TURN_LEN, L, NOMINAL_LAP, RI, RO, HALF: (RO - RI) / 2, FINISH_S, LINE_X, MARK1, MARK2, X_MIN, X_MAX, shoreZ, farZ, CENTER_POLE, CLOCK, BUOY, POLES, BOARDS, PIT, SUN,
    pointAt, turnAt, turnDist, DIST: 2 * L, LAPS: 2, SHORE_Z, FAR_Z, END_X, STAND_Z };
})();
