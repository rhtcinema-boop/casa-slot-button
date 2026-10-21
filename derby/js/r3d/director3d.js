/* casa DERBY 3D 版のカメラ監督（R3D.Director）。
   JRA の中継（ref/derby2025 の 2025 年ダービー）と 2D 版 js/race.js の台本をもとに、
   「決まった場所に据えたカメラ」を「区間ごとに切り替える」。各カメラは
     ・その場で首を振る（パン・ティルト）… 先頭の集団を追う。遅れた馬は捨てる（馬群が長いとき）
     ・ズームが自動 … 先頭の馬が画面の決まった高さ（size）になるように。集団の幅が入りきらなければ引く
     ・操作の手触り … 臨界減衰ばねでなめらかに追い、望遠ほど目立つ手持ちの小さな揺れを足す
   切り替え（カット）は「区間の台本」「最低の持続時間」「映らない・隠れるなら別のカメラ」で決める。
   使い方: const d = R3D.Director.create(); 毎コマ d.update(dt, ctx) → { pos, target, fov(縦の画角・度), label, cut }
   戻り値のオブジェクトは使い回す（毎コマ新しく作らない）。値はその場で写して使うこと。
   任意: d.setAspect(横/縦)、d.setOccluders([...])（ターフビジョン・木など。箱 {minx,maxx,miny,maxy,minz,maxz} か THREE.Object3D）。
   d.shot（いまのカメラの名前）・d.desc（日本語の説明）は確認用。 */
window.R3D = window.R3D || {};
R3D.Director = (function () {
  'use strict';
  const C = R3D.Course;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const HORSE_H = 2.45;           // 騎手の頭まで（m）
  const BODY = 1.25;              // 鼻先・尾までの半分（m）
  // 体型（engine の h.type）ごとの騎手の頭までの高さと体の長さの半分。ctx.horses[i].height / .type があれば使う
  // チビィ（逃げ）き甲 1.25m、ノマール（先行）1.62m、ノッポン（差し）2.0m、ヨコヅナ（追込）低く丸い（STYLE.md 1-2）
  const TYPE_H = { nige: 1.95, senko: 2.45, sashi: 2.95, oikomi: 2.55 }, TYPE_B = { nige: 1.0, senko: 1.25, sashi: 1.3, oikomi: 0.95 };
  const hgtOf = (h) => h.height || TYPE_H[h.type] || HORSE_H; // h.height: 実際の馬の背の高さ（race3d が渡す）。TYPE_H/TYPE_B は渡されないときの予備（2026-10-14 から馬の体は全頭同じ）
  const bodyOf = (h) => h.body || TYPE_B[h.type] || BODY; // h.body: 実際の馬の大きさ（race3d の dirCtx が渡す）。無ければ脚質ごとの昔の値
  const MIN_HOLD = 2.6;           // 台本どおりの切り替えは、最低この秒数は同じカメラを続けてから
  /* 手持ちの揺れの上限（v2 講評 92→95 の 6「通常の揺れは最大 1〜2px・ゴール前は減らす」）。sway は縦の半画角に対する割合で、
     揺れの幅は画面（1000x480）の横で約 300×sway px・縦で約 170×sway px。テレビ（1600x900 の中に約 1.43 倍）で横 2px ≒ 0.0047、1px ≒ 0.0023。
     ゴールの 200m 前からは 1px まで（ゴール前の 2 カットはもともと 0.003・0 なのでほぼそのまま） */
  const SWAY_MAX = 0.0047, SWAY_FIN = 0.0023, SWAY_FIN_R = 200;
  const SHAKE_PX = 1.75, SHAKE_T = 0.1;   // ゲートが開く瞬間の揺れ: 0.1 秒だけ縦に約 1.75px（テレビで約 2.5px）・横はその半分。レースの時計（raceT）だけで決まる＝どのテレビでも同じ
  const ASPECT0 = 1000 / 480;     // レース画面の縦横比（setAspect で変えられる）
  // 既定の撮り方: 'live'（本物の中継寄り＋少しみんなでダービー）。前の既定のジオラマは ?camstyle=dio（= arcade）、
  // カットの多い JRA 中継風は ?camstyle=broadcast。create({ style }) か R3D.cameraStyle でも選べる
  let DEFAULT_STYLE = 'live';
  const STZ = C.RO + 50;          // スタンド上段のカメラの z（スタンド前面 ≒ RO+44 の少し奥・上）

  /* ---------- 固定カメラ（位置・向き・首振りの範囲・レンズ） ----------
     face: 据えた向き（水平の単位ベクトル）、pan: そこから首を振れる角度（度）、
     fmin/fmax: 縦の画角の範囲（度。望遠ほど小さい）、dmax: 撮れる距離 */
  function rig(name, x, y, z, fx, fz, pan, fmin, fmax, dmax) { const n = Math.hypot(fx, fz) || 1; return { name, x, y, z, fx: fx / n, fz: fz / n, pan, fmin, fmax, dmax }; }
  const STAND = [
    rig('SA', -110, 30, STZ, 0, -1, 86, 0.6, 50, 560),       // スタンド上段・3〜4 コーナー寄り
    rig('SB', 30, 33, STZ, 0, -1, 86, 0.6, 50, 600),         // 1 カメ（スタンド最上段の中央）
    rig('SC', 160, 27, STZ, 0, -1, 86, 0.6, 50, 560),        // スタンド上段・ゴール寄り（2 カメの上）
    rig('SL', -215, 31, STZ - 4, 0, -1, 88, 0.6, 50, 480),   // スタンド左端（3〜4 コーナーを見下ろす）
    rig('SR', 235, 27, STZ - 4, 0, -1, 88, 0.6, 50, 480),    // スタンド右端（1〜2 コーナー）
  ];
  const RIGS = {};
  STAND.forEach((r) => { RIGS[r.name] = r; });
  (function () {
    const add = (r) => { RIGS[r.name] = r; };
    add(rig('HOME', 60, 13, C.RO + 38, 0, -1, 86, 1.5, 55, 300));              // スタンド下段（1 周目のスタンド前）
    add(rig('FAN', -80, 34, STZ, -0.35, -1, 86, 0.8, 50, 420));                // 直線入口を高い所から（扇形に広がる馬群）
    const pc = { x: -170, z: -(C.RI - 32) };                                    // 3 コーナー手前の内馬場（ダートの内側）
    add(rig('POLE', pc.x, 4, pc.z, 0, -1, 90, 1.5, 55, 220));
    const b = C.pointAt(2 * C.LS + Math.PI * C.RC + 35, C.RO + 14);               // 3 コーナーの外から向こう正面を正面に
    add(rig('BACKHEAD', b.x, 10, b.z, 1, 0, 60, 0.5, 40, 520));
    const c4 = C.pointAt(C.FINISH_S - 220, C.RO + 36);                         // スタンド前（下段）から 4 コーナーを正面に。遠いので馬群が詰まって見える
    add(rig('C4', c4.x, 12, c4.z, -1, -0.5, 85, 0.6, 45, 360));
    add(rig('HEADON', C.LS / 2 + 25, 6, C.RI - 32, -1, 0.25, 70, 0.8, 45, 420)); // 内馬場（1 コーナー側）から直線を正面に
    add(rig('GOAL', C.LS / 2 + 15, 30, STZ - 6, -0.6, -0.8, 88, 0.8, 50, 360));  // 2 カメ: ゴール側のスタンドから向かってくる馬群
    add(rig('FINISH', C.LS / 2 - 12, 9, C.RO + 30, 0, -1, 88, 1.5, 55, 200));    // ゴール板の手前・外から横に追う（やや上から）
    const rs = C.pointAt(C.FINISH_S - 4, C.RI - 2.5);                           // リプレイ: ゴール前の内ラチの内側・低い
    add(rig('REPLAY_SIDE', rs.x, 1.3, rs.z, 0, 1, 88, 4, 70, 140));
    const wn = C.pointAt(C.FINISH_S + 95, C.RO + 12);                           // 勝ち馬: 1 コーナーの外の広場から低い望遠
    add(rig('WIN', wn.x, 3, wn.z, -0.6, 0.8, 100, 1.2, 40, 260));
    const rh = C.pointAt(C.FINISH_S + 30, C.RC + 4);                            // リプレイ: ゴールの先（1 コーナーの入口の外寄り）から正面・低い（騎手の顔）
    add(rig('REPLAY_HEAD', rh.x, 1.6, rh.z, -1, 0, 75, 1.5, 50, 200));
    // パドック: 楕円の内側の芝に 4 台（外の観客を背景に）
    const P = C.PADDOCK;
    add(rig('PAD1', P.cx - P.a * 0.52, 1.75, P.cz, 0, 0, 180, 6, 60, 60));
    add(rig('PAD2', P.cx + P.a * 0.52, 1.75, P.cz, 0, 0, 180, 6, 60, 60));
    add(rig('PAD3', P.cx, 1.75, P.cz - P.b * 0.35, 0, 0, 180, 6, 60, 60));
    add(rig('PAD4', P.cx, 1.75, P.cz + P.b * 0.35, 0, 0, 180, 6, 60, 60));
  })();
  const PADS = ['PAD1', 'PAD2', 'PAD3', 'PAD4'];

  /* ---------- 撮り方（ショット） ----------
     rig    : 固定カメラの名前（'STAND' は スタンドの中で一番よい 1 台を選ぶ、'GATE' 'WINNER' 'CLOSE' は動く）
     k, gap : 先頭から何頭まで・先頭から何 m 以内を「映すべき集団」にするか
     size   : 先頭集団の馬（騎手まで）を画面の高さの何割にするか（s0→s1 でショットの間に寄る/引く）
     margin : 集団の幅の左右に足す余白（m）
     lead   : 進む向きの空き（画面の半分の幅に対する割合）
     aimY   : 狙う高さの補正（m。+ で上を向く＝馬が画面の下寄り）
     sway   : 手持ちの揺れ（縦の半画角に対する割合）
     wp/wz  : 首振り・ズームの追従の速さ（ばねの角周波数） */
  function shot(o) { return Object.assign({ k: 3, gap: 10, s0: 0.3, s1: 0.3, margin: 6, lead: 0.16, aimY: 0, sway: 0.02, wp: 3.2, wz: 1.6, alts: null, desc: '' }, o); }
  const SHOTS = {
    GATE: shot({ rig: 'GATE', k: 18, gap: 80, s0: 0.5, s1: 0.5, margin: 8, lead: 0, sway: 0.015, wp: 2.6, wz: 1.8, desc: 'ゲート（発走地点の斜め前・外の台）' }),
    WIDE: shot({ rig: 'STAND', k: 18, gap: 60, s0: 0.07, s1: 0.16, margin: 26, lead: 0.12, sway: 0.03, wp: 2.4, wz: 0.9, desc: 'スタンド最上段から馬群全体（だんだん寄る）' }),
    HOME: shot({ rig: 'HOME', k: 4, gap: 9, s0: 0.3, s1: 0.32, margin: 6, lead: 0.2, sway: 0.03, wp: 3.4, desc: 'スタンド下段から 1 周目のスタンド前を横に追う' }),
    C1: shot({ rig: 'SR', k: 18, gap: 30, s0: 0.17, s1: 0.2, margin: 10, lead: 0.12, sway: 0.025, desc: 'スタンド右端から 1〜2 コーナー' }),
    TELE: shot({ rig: 'STAND', k: 3, gap: 8, s0: 0.3, s1: 0.3, margin: 5, lead: 0.2, sway: 0.03, wp: 3.0, wz: 1.0, tele: 1, desc: 'スタンドから望遠で横からの追い（ときどき引き）' }),
    BACKHEAD: shot({ rig: 'BACKHEAD', k: 4, gap: 10, s0: 0.26, s1: 0.3, margin: 4, lead: 0.05, sway: 0.025, desc: '3 コーナーの外から向こう正面を斜め前から' }),
    TELE2: shot({ rig: 'STAND', k: 3, gap: 8, s0: 0.28, s1: 0.28, margin: 5, lead: 0.2, sway: 0.03, wp: 3.0, wz: 1.0, tele: 1, desc: 'スタンドから望遠で横からの追い（別のカメラ）' }),
    POLE: shot({ rig: 'POLE', k: 18, gap: 22, s0: 0.17, s1: 0.2, margin: 12, lead: 0.15, aimY: 0.6, sway: 0.02, desc: '3 コーナー手前の内馬場（手前にハロン棒）' }),
    FAR: shot({ rig: 'SB', k: 18, gap: 40, s0: 0.085, s1: 0.1, margin: 26, lead: 0.1, aimY: 5, sway: 0.03, wp: 2.4, wz: 1.0, desc: '1 カメの超望遠で 3 コーナー（馬群が一本の線）' }),
    C34HIGH: shot({ rig: 'SL', k: 18, gap: 35, s0: 0.12, s1: 0.14, margin: 18, lead: 0.12, sway: 0.025, desc: 'スタンド左端の高い所から 3〜4 コーナーを見下ろす' }),
    C4: shot({ rig: 'C4', k: 6, gap: 16, s0: 0.24, s1: 0.26, margin: 8, lead: 0.06, sway: 0.025, desc: '4 コーナーを斜め前から（圧縮された馬群）' }),
    FAN: shot({ rig: 'FAN', k: 18, gap: 40, s0: 0.1, s1: 0.16, margin: 16, lead: 0.12, sway: 0.03, wz: 1.2, desc: '直線入口を高い所から（扇形に広がる馬群）' }),
    HEADON: shot({ rig: 'HEADON', k: 4, gap: 10, s0: 0.24, s1: 0.32, margin: 6, lead: 0.04, aimY: 0.2, sway: 0.025, desc: '内馬場から直線を正面に（向かってくる馬群）' }),
    GOAL: shot({ rig: 'GOAL', k: 3, gap: 8, s0: 0.18, s1: 0.28, margin: 5, lead: 0.1, sway: 0.025, wp: 3.6, wz: 1.5, desc: '2 カメ: ゴール側のスタンドから先頭に寄る' }),
    FINISH: shot({ rig: 'FINISH', k: 2, gap: 5, s0: 0.32, s1: 0.32, margin: 5, lead: 0.12, sway: 0.02, wp: 4.0, wz: 1.6, desc: 'ゴール前を横から（やや上から）' }),
    REPLAY_HEAD: shot({ rig: 'REPLAY_HEAD', k: 3, gap: 6, s0: 0.45, s1: 0.55, margin: 2, lead: 0, aimY: 0.25, sway: 0.012, wp: 4, wz: 2, desc: 'リプレイ: ゴールの先から低い正面（騎手のアップ）' }),
    REPLAY_SIDE: shot({ rig: 'REPLAY_SIDE', k: 2, gap: 4, s0: 0.5, s1: 0.55, margin: 2, lead: 0.15, aimY: 0.1, sway: 0.012, wp: 4.5, wz: 2, desc: 'リプレイ: ゴール前の低い内側から横に' }),
    WINNER: shot({ rig: 'WIN', k: 1, gap: 0, s0: 0.55, s1: 0.6, margin: 1.5, lead: 0.1, aimY: 0.15, sway: 0.03, wp: 3.5, wz: 1.5, desc: '勝ち馬のアップ（1 コーナーの外から望遠）' }),
    PADDOCK: shot({ rig: 'PAD', k: 1, gap: 0, s0: 0.56, s1: 0.58, margin: 2.5, lead: 0.12, aimY: 0.05, sway: 0.035, wp: 3.5, wz: 2, desc: 'パドック: 1 頭ずつ（後ろに観客）' }),
    CLOSE: shot({ rig: 'CLOSE', k: 1, gap: 0, s0: 0.5, s1: 0.56, margin: 2.5, lead: 0, aimY: 0.05, sway: 0.025, wp: 3, wz: 1.2, desc: '発走前: 発走地点の外から 1 頭ずつ望遠' }),
    PRE: shot({ rig: 'STAND', k: 18, gap: 200, s0: 0.06, s1: 0.1, margin: 30, lead: 0, sway: 0.02, wp: 1.5, wz: 0.5, desc: '発走前: スタンドから発走地点' }),
  };
  for (const k in SHOTS) SHOTS[k].name = k;
  SHOTS.GATE.subject = 'gate'; SHOTS.WINNER.subject = 'winner'; SHOTS.PADDOCK.subject = 'horse'; SHOTS.CLOSE.subject = 'horse';
  // 隠れた・映らないときの代わり
  SHOTS.POLE.alts = ['TELE2'];
  SHOTS.BACKHEAD.alts = ['TELE2'];
  SHOTS.C4.alts = ['C34HIGH', 'FAN'];
  SHOTS.HEADON.alts = ['GOAL', 'FAN'];
  SHOTS.GOAL.alts = ['HEADON', 'FINISH'];
  SHOTS.FINISH.alts = ['GOAL'];
  SHOTS.C34HIGH.alts = ['FAR'];
  SHOTS.FAR.alts = ['C34HIGH'];
  SHOTS.HOME.alts = ['WIDE'];
  SHOTS.C1.alts = ['TELE'];
  SHOTS.REPLAY_HEAD.alts = ['REPLAY_SIDE'];
  SHOTS.REPLAY_SIDE.alts = ['FINISH'];

  /* ---------- 区間の台本（先頭の残り距離 remain で決める。ゴールの位置は同じなので 1000m も 1600m も同じ物差し） ---------- */
  function scheduledBroadcast(ctx) {
    const gone = ctx.gone || 0, R = ctx.remain == null ? (ctx.dist || 1000) - gone : ctx.remain, long = (ctx.dist || 1000) > 1200;
    if (gone < 35) return 'GATE';
    if (gone < 140) return 'WIDE';
    if (R > 1200) return 'HOME';
    if (R > 1030) return 'C1';
    if (long) { if (R > 880) return 'TELE'; if (R > 780) return 'BACKHEAD'; if (R > 680) return 'TELE2'; }
    else if (R > 680) return 'TELE';
    if (R > 580) return 'POLE';
    if (R > 500) return 'FAR';
    if (R > 420) return 'C34HIGH';
    if (R > 330) return 'C4';
    if (R > 230) return 'FAN';
    if (R > 130) return 'HEADON';
    if (R > 45) return 'GOAL';
    return 'FINISH';
  }

  /* ---------- 撮り方の流儀（style）: 撮り方の表と、段階ごとの台本 ----------
     broadcast: JRA の中継（据え置きの望遠カメラ）。arcade: みんなでダービー風（下で足す）。 */
  const STYLES = {
    broadcast: {
      shots: SHOTS,
      race: scheduledBroadcast,
      gate: () => 'GATE',
      replay: (phT) => (phT < 2.4 ? 'REPLAY_HEAD' : 'REPLAY_SIDE'),
      winner: () => 'WINNER',
      paddock: () => 'PADDOCK',
      pre: (idx) => (idx % 3 === 2 ? 'PRE' : 'CLOSE'),
      fallback: ['TELE2', 'TELE'],
    },
  };
  const scheduled = scheduledBroadcast;

  /* ---------- arcade: みんなでダービー風（ref/minnade/STYLE.md 4 章） ----------
     卓の画面（メインのレース映像）は「真上からのジオラマ」:
       ・ベット中: コース全体が模型のように見える真上の全景
       ・ゲート: 高い所から斜めに見下ろしてゲートに寄る
       ・レース中: 高い位置から 55〜75° 見下ろす追いかけカメラ。馬群は画面の 1/3 くらい。コースに沿ってなめらかに動き、
         コーナーでは曲線が見えるよう少し引く。カットはほとんど無く 1 台でつなぐ（画面の下＝スタンド側、卓を囲んで見る向き）
       ・最後の直線で下がって寄り、ゴールは地上 15〜25m からほぼ真上の大写しへ「急に降りる」。ゴール後はすっと引く
     上モニターの「正面からの追い」（低い位置・馬の前から 2 頭くらいを大きく）を道中に 1〜2 回だけ挟む。
     リプレイは正面の追い → ゴール線の真上の大写し。勝ち馬は正面から（後ろ脚で立ち上がるので頭上を空ける）。
     ジオラマの横幅はふだん 32m 前後（先頭集団が画面の 1/3〜1/2。足元のリング直径 ≒ 3m は 1000px で 90px 前後）。 */
  RIGS.OVER = rig('OVER', 0, 430, C.RO + 120, 0, -1, 180, 8, 70, 1200);             // コース全体の真上（少しだけスタンド側から）
  function ashot(o) { return shot(Object.assign({ sway: 0.004, wp: 2.4, wz: 1.3 }, o)); }
  // dio: ジオラマのカメラ。y 高さ / pitch 見下ろし角（度）/ minW 映す横幅の下限（m）。Low はゴールで降りたとき、Gate はゲート
  const DIO = { y: 40, pitch: 64, minW: 32, yLow: 14, pitchLow: 80, minWLow: 13, yGate: 30, pitchGate: 52, minWGate: 28, drop: 55, near: 260, yNear: 30, pitchNear: 68, minWNear: 24, ahead: 0.12, w: 1.6 };
  const ASHOTS = {
    A_DIO: ashot({ rig: 'DIO', subject: 'gate', dio: DIO, k: 18, gap: 14, s0: 1, s1: 1, margin: 10, lead: 0.22, wp: 2.2, wz: 1.1, desc: 'ジオラマ: 高い所から見下ろして馬群を追う（カットなし。ゴールで急に降りて真上の大写し）' }),
    A_FRONT: ashot({ rig: 'TRACK', track: { ds: 13, ref: 'head', r: 'lane', off: 0.8, y: 1.9, w: 2.4, fmax: 34 }, k: 2, gap: 4, s0: 0.4, s1: 0.46, margin: 3, lead: 0, aimY: 0.25, sway: 0.008, desc: '正面からの追い（上モニター風。先頭 2 頭の顔）' }),
    A_REPLAY: ashot({ rig: 'TRACK', track: { ds: 9, ref: 'head', r: 'lane', off: 1.2, y: 1.6, w: 3 }, k: 2, gap: 4, s0: 0.48, s1: 0.55, margin: 2, lead: 0, aimY: 0.2, sway: 0.008, desc: 'リプレイ: 正面から低く（顔と勝負服）' }),
    A_REPLAY_TOP: ashot({ rig: 'DIO', dio: Object.assign({}, DIO, { fixedLow: 1 }), k: 3, gap: 6, s0: 1, s1: 1, margin: 6, lead: 0.15, wp: 3, desc: 'リプレイ: ゴール線の真上から大写し' }),
    A_WINNER: ashot({ rig: 'TRACK', subject: 'winner', track: { ds: 'win', r: 'lane', off: 'win', y: 'win', w: 2.6 }, k: 1, gap: 0, s0: 0.34, s1: 0.38, margin: 2.5, lead: 0, aimY: 0.9, sway: 0.01, desc: '勝ち馬のアップ（正面寄りから。立ち上がっても頭が切れないよう上を空ける）' }),
    A_PADDOCK: shot(Object.assign({}, SHOTS.PADDOCK, { s0: 0.6, s1: 0.64 })),
    A_CLOSE: ashot({ rig: 'TRACK', subject: 'horse', track: { ds: 7, r: 'lane', off: 0.6, y: 4.6, w: 2 }, k: 1, gap: 0, s0: 0.5, s1: 0.56, margin: 2, lead: 0, aimY: 0.3, sway: 0.01, perHorse: 1, desc: '発走前: ゲートの前の上から 1 頭ずつ顔のアップ' }),
    A_PRE: ashot({ rig: 'OVER', subject: 'course', k: 18, gap: 999, s0: 0.01, s1: 0.01, margin: 0, lead: 0, wp: 1, wz: 0.6, perHorse: 1, desc: '発走前: コース全体の真上（模型のように）' }),
  };
  for (const k in ASHOTS) ASHOTS[k].name = k;
  ASHOTS.A_FRONT.alts = ['A_DIO'];
  // 区間の台本（残り距離）。ほとんどジオラマ 1 台。正面の追いを 1600m は 2 回、1000m は 1 回だけ挟む
  function scheduledArcade(ctx) {
    const gone = ctx.gone || 0, R = ctx.remain == null ? (ctx.dist || 1000) - gone : ctx.remain, long = (ctx.dist || 1000) > 1200;
    if (long && R < 1330 && R > 1220) return 'A_FRONT';                 // 1 周目のスタンド前
    if (R < (long ? 900 : 800) && R > (long ? 790 : 690)) return 'A_FRONT'; // 向こう正面
    return 'A_DIO';
  }
  STYLES.arcade = {
    shots: ASHOTS,
    race: scheduledArcade,
    gate: () => 'A_DIO',
    replay: (phT) => (phT < 2.6 ? 'A_REPLAY' : 'A_REPLAY_TOP'),
    winner: () => 'A_WINNER',
    paddock: () => 'A_PADDOCK',
    pre: (idx) => (idx % 3 === 2 ? 'A_PRE' : 'A_CLOSE'),
    fallback: ['A_DIO', 'A_DIO'],
  };
  STYLES.dio = STYLES.arcade;   // ?camstyle=dio でも前の既定（ジオラマ）

  /* ---------- live: 本物の中継寄り（既定）＋少しだけみんなでダービー ----------
     JRA・地方競馬の中継の文法（ref/derby2025）と、美術監督の講評（ref/review/chatgpt-2026-10-13.md）から:
       ・カットは少なく、1 カット 4〜15 秒。画面の中の走る向きを守る（スタンド側から見た向き:
         ホームストレッチは左→右、向こう正面・3〜4 コーナーは右→左。外から撮るカメラは直線だけ）
       ・ゲートイン: 発走地点の斜め前（約 33 度）・低めから、6 頭の顔とゲート。開いた瞬間もそのまま（向かってくる飛び出し）
       ・飛び出したら横からの追い（基本の絵）: 馬群と一緒に動くカメラ。見下ろし 20〜30 度、先頭の馬が画面の高さの 2 割前後、
         馬群は画面の真ん中に（向こう正面・コーナーは内馬場側から、1600m の 1 周目のスタンド前は外から）
       ・ときどき補助の絵: スタンド最上段の 1 カメ（内馬場越しの望遠で馬群全体）、3 コーナーの外から斜め前
       ・最後のコーナー: スタンド下段から斜め前に馬群全体
       ・直線: ゴールの先から正面寄りの望遠（遠近が詰まる）→ 残り 200m は先頭の 2〜4 頭に寄った横の追い（手前に外ラチ）
       ・残り 58m（スロー＝残り約 45m の前）からゴール板の真横に据えたカメラ。先頭を追って振り、先頭がゴール板の
         手前に来たら止まる（ゴール板が画面の右 4 分の 3 あたり）。ゴールしたら勝ち馬を追って流す
     みんなでダービーらしさ: 本物より近く・大きく（先頭が画面の高さの 2〜3 割）。応援の加速（ニンジン）が見えたら、
     その馬を外ラチ際の低い位置から 2.8 秒だけ（1 レース 2 回まで）。リプレイの最初（正面の低い追い）・勝ち馬（立ち上がる）・
     パドック・発走前の顔のアップは arcade のものを大きめにして使う。 */
  RIGS.MAIN = rig('MAIN', 40, 31, STZ, 0, -1, 89, 0.4, 50, 640);                        // 1 カメ（スタンド最上段・ゴール寄りの中央）
  RIGS.HEAD2 = rig('HEAD2', C.LS / 2 + 40, 10, C.RO + 24, -1, -0.12, 60, 0.5, 45, 480);  // ゴールの先・スタンド側から直線を正面寄りに（走る向きを守るため外側）
  RIGS.POST = rig('POST', C.LS / 2 - 4.5, 22, C.RO + 18, 0, -1, 88, 1.2, 50, 260);     // ゴール板の真横（線の 4.5m 手前・外ラチの 18m 外・高さ 22m。ゴール板の円板と審判台が馬の下に外れる）
  { const c4 = C.pointAt(C.FINISH_S - 220, C.RO + 36); RIGS.C4L = rig('C4L', c4.x, 17, c4.z, -1, -0.5, 85, 0.6, 45, 380); }  // 4 コーナー（内馬場の木の上を越す高さ）
  /* 残り 600m〜ゴール〜ゴール後（ref/STRAIGHT_STUDY.md の 3 章: JRA 公式映像 11 レースの研究。スタンドから見て馬は左→右＝東京・中京と同じ）
     （A 残り 600→480 の遠景の真横は、このコースでは 3〜4 コーナーの内の木立に隠れるので省く） B 480→400 4 コーナーの正面寄り（望遠で馬群が詰まって向かってくる）
     C 400→190 直線入口のスタンド高所（切らずにゆっくり寄る。斜め前→横） D 190→45 スタンド上部の真横（下に観客の頭。連続で寄る）
     E 45m→ゴール後 0.6 秒 スタンド前の低い真横の望遠（先頭 2〜5 頭が画面の 2〜4 割、ゴールの瞬間にゴール板が馬のすぐ奥を通る。接戦でも切らない）
     ゴール後: ゴールの真横の固定カメラで 0.5 倍の再生（接戦は 0.15 倍でもう 1 回・鼻で止める）→ ゴールの先から真正面のスロー → 減速する勝ち馬を正面から → 喜ぶ勝ち馬 */
  /* 2026-10-16: 上の B〜E の 4 カットは、1 台の動くカメラ（L_SWING）に置き換えた。カメラの置き場所と画角は、その瞬間の馬の位置と
     先頭の残り距離 R だけで決まる（ばね・前のコマの値を使わない＝どのテレビでも、途中から見始めても、同じ瞬間は同じ絵）。
       ・進む向きに対するカメラの向き a: 4 コーナーに入る所（R0）で正面から a0 度（斜め前・スタンド側の外）→ R1（残り 100m）で 90 度（真横）。
         あいだは 5 次のなめらかな曲線（始めと終わりで速さも加速度も 0）。R1 からはずっと真横のまま
       ・馬群からの水平の距離 d0 → d1、高さ y0 → y1 も同じ曲線で（4 コーナーは 4 コーナー外の広場の木（高さ 10m まで）の上・終わりは外ラチの 20m 外・高さ 8m）
       ・映す馬: R1 までは 6 頭全部（離れたら引く。狙いは先頭 3 頭寄り）。R1 から tight m かけて先頭 3 頭へ寄る
       ・ゴールの外のゴール板（外ラチ際の柱）は、真横のカメラが先頭と一緒に動くと、ちょうどゴールする鼻先の前を横切る。
         カメラの x はゴールの xStop（m 手前）で「なめらかに止まる」（kStop m の幅でゆっくり減速。残り約 15m までは真横のまま、
         ゴールの瞬間は真横から約 8 度だけ前向き）。柱が先頭に重なるのはゴールの 2〜3m 先になる */
  const SWING = { R0: 480, R1: 100, a0: 30, d0: 56, d1: 30, y0: 13, y1: 8, rRef: C.RI + 4.5, bias: 0.6, ahead: 1.2, rk: 1.5, tight: 22, focusK: 0.3, tw: 30, fovK: 2,
    sA: 0.27, sB: 0.29, s1: 0.33, limX: 0.8, limY: 0.76, xStop: C.LS / 2 - 10, kStop: 4, fmin: 2, fmax: 50 };
  // v4（2 連単。2026-10-21 仕様書「最後の直線は上位 3 頭が入るように少し引く」）: 寄りきった大きさ s1 0.38 → 0.33（先頭が画面の高さの約 3 割）、
  // 上位 3 頭を入れる枠を画面の端から 10%（横 limX 0.86 → 0.8）・12%（縦 0.8 → 0.76）内側に。1 着争いと 2 着争い（2・3 番手）が両方、端に寄らずに見える。
  // 止まる所 xStop もゴールの 5m 手前 → 10m 手前に: 5m だと、1 着より遅れてゴールする 2 着争いの鼻先が、外ラチのゴール板の脇の旗（RO+1）の後ろに入った（v4race の写真）
  // E: ゴール線の 3m 先・外ラチの 24m 外（手前の観客の帯 RO+4〜14 の頭越し・奥の観客の帯より前）・高さ 9m（視線は手前の観客の頭と決勝審判の小屋のガラスの間を抜ける）。真上だと小屋の柱が先頭のすぐ前に重なる
  // v2 講評 1 回目の TOP1（2026-10-14）: ゴール線の 3m 先・外ラチの 24m 外・高さ 9m → 8m 手前・20m 外・高さ 8m へ。線の先にいると、手前（外）のゴール板の柱が、ちょうどゴールする先頭の鼻先の前に重なっていた。
  // 手前に置くと、外の柱は馬の奥行きで線の 1.5m（外の進路）〜4m（真ん中の進路）先に重なる（5m 手前では外の進路で 0.9m 先＝2 着の頭に重なった）。内のゴール板は先頭がゴールする直前に馬のすぐ奥を通る（研究 E の絵）。決勝審判の小屋はいまはスタンドの中なので邪魔にならない
  RIGS.FINE = rig('FINE', C.LS / 2 - 8, 8, C.RO + 20, 0, -1, 180, 0.6, 45, 400);
  RIGS.RGOAL = rig('RGOAL', C.LS / 2, 12, C.RO + 5.2, 0, -1, 180, 1, 45, 300);    // 再生・写真判定: 決勝審判の小屋の屋根の上（ゴール線の真上・高さ 12m）から真下へ向けてゴール線を見る。ゴール線が画面で真っすぐ縦になり、内のゴール板は馬の奥。手前の外のゴール板の円板の上を越す

  { const p = C.pointAt(C.FINISH_S + 75, C.RO + 4); RIGS.WINF = rig('WINF', p.x, 3, p.z, -1, 0, 180, 0.6, 45, 300); }   // ゴール後: 1 コーナーの外ラチ沿いから、減速して向かってくる勝ち馬を正面に
  function lshot(o) { return shot(Object.assign({ sway: 0.016, wp: 2.6, wz: 1.0 }, o)); }
  const LSHOTS = {
    // v2 講評 92→95 の 2（ゲートイン 86 点「ゲートと柵ばかりで馬の顔と緊張が弱い」）: 前はゲートの 35m 前・内馬場の 25m 内・高さ 7m から（ゲートが画面の横 35%）。
    // ゲートの 32m 前・ゲートの真ん中から内へ約 10m（約 18 度の斜め前）・高さ 3.5m の中望遠へ。ゲートが画面の横 7〜8 割、閉じた前扉の上に 6 頭の顔と騎手が並ぶ。
    // 最後の馬が枠に入るところから使い（ゲートインの front）、体勢完了・開く瞬間・飛び出しまで切らない（G3・G4 と同じく 1 台のまま）。tight: 正面になってから 2 秒で 5% だけゆっくり寄る（緊張。ゲートインは約 8 秒＝正面は開くまで約 2.3 秒）
    L_GATE: lshot({ rig: 'GATE', subject: 'gate', gateCam: { ds: 32, r: -17.9, y: 3.5 }, tight: 0.05, k: 3, gap: 999, top3: true, s0: 0.3, s1: 0.3, margin: -1.2, lead: 0, sway: 0.003, wp: 2.8, wz: 1.4, desc: '最後の枠入り〜体勢完了〜発馬（ref/START_STUDY.md G1・G3・G4）: ゲートの斜め前（約 18 度）・低い所から中望遠。6 頭の顔が並び、開いても切らずに飛び出しを追う' }),
    L_TRACK: lshot({ rig: 'TRACK', track: { ds: 3, ref: 'mid', r: 'in', off: -19, y: 11, w: 1.4, fmax: 42, side: 1 }, k: 3, gap: 999, top3: true, s0: 0.28, s1: 0.3, margin: 6, lead: 0.16, sway: 0.01, desc: '基本の絵: 内馬場側から横に追う（見下ろし約 25 度。向こう正面・コーナーは右→左）' }),
    L_HOMET: lshot({ rig: 'TRACK', track: { ds: 3, ref: 'mid', r: 'out', off: 22, y: 11, w: 1.4, fmax: 42, side: 1 }, k: 3, gap: 999, top3: true, s0: 0.28, s1: 0.3, margin: 6, lead: 0.16, sway: 0.01, desc: '1600m の 1 周目: スタンド前を外から横に追う（左→右）' }),
    L_MAIN: lshot({ rig: 'MAIN', k: 3, gap: 999, top3: true, s0: 0.13, s1: 0.15, margin: 10, lead: 0.15, desc: '補助: 1 カメ（スタンド最上段から内馬場越しの望遠で馬群全体）' }),
    L_MAIN2: lshot({ rig: 'STAND', k: 3, gap: 999, top3: true, s0: 0.13, s1: 0.15, margin: 10, lead: 0.15, desc: '1 カメが隠れたときのスタンドの別のカメラ' }),
    L_BACK: lshot({ rig: 'BACKHEAD', k: 3, gap: 999, top3: true, s0: 0.2, s1: 0.26, margin: 5, lead: 0.04, desc: '補助: 向こう正面を 3 コーナーの外から斜め前に（望遠で詰まった馬群）' }),
    L_C4: lshot({ rig: 'C4L', k: 3, gap: 999, top3: true, s0: 0.2, s1: 0.24, margin: 7, lead: 0.08, desc: '最後のコーナー: スタンド下段から斜め前に馬群全体' }),
    L_HEAD: lshot({ rig: 'HEAD2', k: 3, gap: 999, top3: true, s0: 0.2, s1: 0.28, margin: 5, lead: 0.03, aimY: 0.2, wp: 3.0, wz: 1.2, desc: '直線: ゴールの先から正面寄りの望遠（向かってくる馬群）' }),
    L_RAIL: lshot({ rig: 'TRACK', track: { ds: 4, ref: 'head', r: 'out', off: 20, y: 9, w: 1.8, fmax: 32 }, k: 3, gap: 999, top3: true, s0: 0.26, s1: 0.3, margin: 4, lead: 0.18, sway: 0.01, desc: '残り 200m: 先頭の 2〜4 頭に寄って外ラチ越しに横から' }),
    L_POST: lshot({ rig: 'POST', post: 0.78, k: 3, gap: 999, top3: true, s0: 0.33, s1: 0.35, margin: 4, lead: 0.1, wp: 3.0, wz: 1.2, sway: 0.006, desc: 'ゴール板の真横（スロー・写真判定）。先頭がゴール板に来たら止め、ゴール後は勝ち馬を追う' }),
    L_BACKSIDE: lshot({ rig: 'TRACK', track: { ds: -6, ref: 'head', r: 'in', off: -13.7, y: 4.5, w: 1.6, fmax: 30, side: 1 }, k: 4, gap: 999, top3: true, s0: 0.12, s1: 0.26, zt: 16, margin: 6, lead: 0.1, wp: 2.4, wz: 0.6, sway: 0.004, desc: '向こう正面（ref/START_STUDY.md S1・S2）: 内馬場の中を並走するカメラで真横に（右→左）。全頭が画面の 1 割強 → 先頭集団 2〜3 割へゆっくり寄る。切らない' }),
    // 最後の 4 コーナー〜ゴール（2026-10-16 オーナー「最終コーナーは入ってからの正面寄りの画になって、そのあとはゴール直前に真横になるようにスムーズに画角が変わる感じ」）:
    // 前の B（4 コーナーの正面寄り）・C（スタンド高所）・D（スタンド上部の真横）・E（低い真横）の 4 カットをやめ、動くカメラ 1 台で切らずにつなぐ（下の SWING と swingPose）
    L_SWING: lshot({ rig: 'SWING', swing: 1, k: 6, gap: 999, s0: 0.2, s1: 0.33, margin: 0, lead: 0, sway: 0, desc: '残り 480m〜ゴール: 1 台の動くカメラ（クレーン）。4 コーナーは斜め前（正面から 35 度）から 6 頭 → 回り込んで残り 100m で真横 → 先頭 3 頭に寄ってゴール（切らない・スローもこのまま）' }),
    L_FIN: lshot({ rig: 'FINE', fin: 1, k: 2, gap: 5, minK: 2, topN: 6, s0: 0.35, s1: 0.38, sizeR: [[45, 0.33], [20, 0.355], [0, 0.375]], ffk: 14, margin: 2.5, lead: 0.1, wp: 4.6, wz: 0.8, sway: 0, desc: 'E 残り 45m〜ゴール後: スタンド前の低い真横の望遠（先頭 2 頭＋6m 以内の 3 番手が主役。内のゴール板が先頭のすぐ奥を通る。接戦・スローもこの絵のまま切らない）' }),
    // ゴール後の再生（v2 講評 1 回目の TOP1）: ゴール線の上から真横に固定。狙う進路は区間の頭の上位 2 頭の進路（どのテレビでも同じ）、
    // ゴール線は画面の横 lineX（NDC。+0.2 ＝ 中央の少し右。yaw をずらすので線は約 2 度傾く。写真判定の区間だけは真ん中でまっすぐ縦）に通す（向かってくる上位の馬が画面の左〜中央に入り、鼻先が線に届く所がよく見える）
    L_RGOAL: lshot({ rig: 'RGOAL', fixAim: { ds: 0, r: 'lead', y: 1.0, fov: 19, lineX: 0.2 }, k: 3, gap: 999, s0: 0.3, s1: 0.3, margin: 3, lead: 0, sway: 0, desc: 'ゴール後の再生: ゴールの真横に固定（ゴール線が画面の中央の少し右を縦に通る・動かない）' }),
    // 正面の再生は短く・少し斜めから（真正面だと丸い馬が団子に見えた）: ゴールの 28m 先・上位 2 頭の進路から外へ 7.5m・高さ 2m に据えた望遠（約 15 度の斜め前）。replay の head 区間（race3d.js）
    L_RHEAD: lshot({ rig: 'RHD', k: 2, gap: 4, s0: 0.46, s1: 0.52, zt: 2, margin: 2, lead: 0, aimY: 0.2, wp: 4, wz: 1.6, sway: 0.006, desc: 'ゴール後の再生: ゴールの先の少し斜め前・低い所から（先頭 2 頭の顔と勝負服と体の横が見える。スロー・短く）' }),
    L_WINFRONT: lshot({ rig: 'WINF', subject: 'winner', k: 1, gap: 0, s0: 0.5, s1: 0.56, margin: 2, lead: 0, aimY: 0.3, wp: 3.0, wz: 1.2, sway: 0.004, desc: 'ゴール後: 1 コーナーの外ラチ沿いから、減速して向かってくる勝ち馬を正面に' }),
    L_RPOST: lshot({ rig: 'POST', post: 0.72, k: 2, gap: 4, s0: 0.36, s1: 0.4, margin: 3, lead: 0.1, wp: 3.4, wz: 1.6, sway: 0.006, desc: 'リプレイ: ゴール板の真横から' }),
    L_BOOST: lshot({ rig: 'TRACK', subject: 'boost', maxX: 0.1, track: { ds: 12, r: 'lane', off: 'auto', y: 1.5, w: 2.8, fmax: 42 }, k: 3, gap: 999, top3: true, s0: 0.42, s1: 0.48, margin: 2.5, lead: 0, aimY: 0.35, sway: 0.006, wp: 4, wz: 1.8, desc: '応援の加速: ラチ際の低い位置から斜め前に（みんなでダービー風）' }),
    L_WINNER: shot(Object.assign({}, ASHOTS.A_WINNER, { track: { ds: 'win', r: 'lane', off: 'win', y: 'win', w: 2.6 }, s0: 0.56, s1: 0.6, aimY: 0.6, desc: '勝ち馬: 低い斜め前から画面の真ん中に大きく（立ち上がっても頭が切れない。講評 r2 の 7）' })),
    L_PADDOCK: shot(Object.assign({}, ASHOTS.A_PADDOCK, { s0: 0.7, s1: 0.74 })),
  };
  /* v4（2 連単。2026-10-21 オーナー「1着 → 2着 → 2頭いっしょ」）: 勝ち馬のアップのあとに 2 着のアップと 2 頭の絵。
     どちらも勝ち馬のアップと同じ低い斜め前の動くカメラ（置き場所は pickWin）。主役は統合側が渡す ctx.winFocus（2 着）・ctx.winPair（[1 着, 2 着]）。
     2 頭の絵は 2 頭の間を主役にして、2 頭の鼻先・尾が全部入るように引く（少し小さめ） */
  LSHOTS.L_WIN2 = shot(Object.assign({}, LSHOTS.L_WINNER, { desc: '2 着: 勝ち馬のアップと同じ低い斜め前から 2 着を大きく（勝ち馬のすぐ後ろ・隣で速歩）' }));
  LSHOTS.L_WINPAIR = shot(Object.assign({}, LSHOTS.L_WINNER, { s0: 0.44, s1: 0.47, margin: 3.5, aimY: 0.1, desc: '1 着と 2 着: 並んで速歩する 2 頭を低い斜め前からいっしょに（下に組み合わせの帯）' }));
  /* ゲートイン（枠入り。ctx.phase === 'gatein'）: 統合側の台本 ctx.gateIn.cue（wide → close → front）で切り替える。front は L_GATE（体勢完了・発走もそのまま）。
     gi: { ds: ゲートの位置からの m（− が後ろ）, r: 'out' 外ラチ | 'in' 内ラチ | 'mid' ゲートの真ん中 | 'focus' 主役の枠, off: そこからの m（+ が外）, y }
     v2 講評 92→95 の 2: 前は「後ろ斜めの高い所（34m 後ろ・高さ 8m）→ 内の低い後ろから → 真後ろの高い所」で、ゲートの裏と柵ばかり・馬は後ろ姿だった */
  Object.assign(LSHOTS, {
    // 画角は横 約 46 度（講評の「通常 45〜55 度」）。ゲート（の四隅）だけで枠を決め、ゲートが画面の横 7〜8 割（margin）。手前の待つ馬と係員ははみ出してよい（奥行き）
    GI_WIDE: lshot({ rig: 'GI', subject: 'giwide', gi: { ds: -22, r: 'mid', off: 11, y: 4.5 }, k: 18, gap: 999, s0: 1, s1: 1, margin: 5.5, minFov: 26, tilt: -0.4, lead: 0, sway: 0.004, wp: 2.8, wz: 1.2, desc: 'ゲートイン: ゲートの後ろ斜め・外から全体（ゲートが画面の横 7〜8 割）。手前で待つ馬と、係員に引かれて枠に入る馬。2026-10-16 確定演出の数字の雲のため少し低く・遠く（高さ 6.2→4.5m、22m 後ろ・11m 外）して少し上を向き、向正面の奥の空とスタンド・街を画面の上 3 分の 1 に入れる' }),
    // 外（主役＝最後に入る大外の馬の枠から 9m 外・ゲートの 4.5m 後ろ。約 8 秒の台本では主役は約 3.8 秒で枠に入るので、近づいてくる顔を長く映す。3m だと係員が顔の前に重なった）の目の高さ 2.1m から中望遠。主役が待つ・歩き出す所は斜め前（顔が見える）→ 真横 → 枠へ入っていく後ろ斜め。
    // 内からだと係員（馬の左＝内で頭を持つ）が顔の前に重なる。外からなら係員は馬の向こう側、間に馬もいない（大外が最後）
    // 膝から上（首・顔・騎手）で画面の高さの 9 割前後＝顔が 1600x900 で約 120〜150px（gatherFocus）
    GI_CLOSE: lshot({ rig: 'GI', subject: 'gifocus', gi: { ds: -4.5, r: 'focus', off: 9, y: 2.1 }, k: 1, gap: 0, s0: 0.86, s1: 0.94, zt: 2.5, margin: 0.4, lead: 0.1, aimY: 0, sway: 0.004, wp: 2.8, wz: 1.2, desc: 'ゲートイン: 外の目の高さから中望遠で 1 頭（最後に入る大外の馬）。待つ顔 → 歩き出して真横 → 枠に入るまで' }),
    // 確定演出 gateLate（ctx.gateIn.side が 'out' | 'in'）: 横のカメラは遅れる馬（ctx.gateIn.focus＝統合側の sideFocus）を、止まる所（ゲートの 4.4m 後ろ）の少し前・7.5m 外・高さ 4m から見下ろし気味の斜め前
    // （隣の枠の馬が間を通っても騎手の頭より上から顔が見える。綱を引いてのけぞる係員は馬の向こう側だが、上から見るので首ごしに見える）。少し引き（s0 0.74）で係員と足もとも入れる。'in' は内側版（いまは使わない）
    GI_LATE_OUT: lshot({ rig: 'GI', subject: 'gifocus', gi: { ds: -2.6, r: 'focus', off: 7.5, y: 4.0 }, k: 1, gap: 0, s0: 0.72, s1: 0.78, push: 0.14, zt: 2.5, margin: 0.4, lead: 0.1, aimY: 0, sway: 0.004, wp: 2.8, wz: 1.2, desc: 'ゲートイン（確定演出 gateLate）: 外の少し高い所から斜め前。枠の口でいやがって止まる馬と綱を引く係員' }),
    GI_LATE_IN: lshot({ rig: 'GI', subject: 'gifocus', gi: { ds: -2.6, r: 'focus', off: -7.5, y: 2.1 }, k: 1, gap: 0, s0: 0.74, s1: 0.82, zt: 2.5, margin: 0.4, lead: 0.1, aimY: 0, sway: 0.004, wp: 2.8, wz: 1.2, desc: 'ゲートイン（確定演出 gateLate）: 内側の目の高さから斜め前。枠の口でいやがって止まる馬と綱を引く係員' }),
  });
  for (const k in LSHOTS) LSHOTS[k].name = k;
  LSHOTS.L_TRACK.alts = ['L_MAIN'];
  LSHOTS.L_HOMET.alts = ['L_MAIN2'];
  LSHOTS.L_MAIN.alts = ['L_MAIN2'];
  LSHOTS.L_BACK.alts = ['L_TRACK'];
  LSHOTS.L_C4.alts = ['L_TRACK'];
  LSHOTS.L_HEAD.alts = ['L_RAIL'];
  LSHOTS.L_POST.alts = ['L_RAIL'];
  LSHOTS.L_RPOST.alts = ['A_REPLAY'];
  LSHOTS.L_RHEAD.alts = ['A_REPLAY'];
  LSHOTS.L_BACKSIDE.alts = ['L_TRACK', 'L_MAIN'];
  LSHOTS.L_FIN.alts = ['L_RAIL'];
  ['L_TRACK', 'L_HOMET', 'L_MAIN', 'L_MAIN2', 'L_BACKSIDE'].forEach((k) => { LSHOTS[k].mainish = true; });
  function scheduledLive(ctx) {
    const gone = ctx.gone || 0, R = ctx.remain == null ? (ctx.dist || 1000) - gone : ctx.remain, long = (ctx.dist || 1000) > 1200;
    if (gone < 20) return 'L_GATE';                 // 開いた瞬間は正面寄りのまま（切らない）。馬がカメラの横に来る前に横の追いへ
    if ((ctx.dist || 1000) <= 600) {                // 500m（約 30 秒。4 コーナーの途中から発走。いまは抽選されない）: カットは少なく
      if (R > 300) return 'L_C4';                   // コーナーを回って直線に向くまで（隠れるときは内からの追い L_TRACK → 1 カメ）
      if (R > 45) return 'L_RAIL';                  // 直線: 外ラチ越しに横から先頭の 2〜4 頭
      return 'L_FIN';                               // 残り 110m からゴール: スタンド側から横に振る（スロー・写真判定もこの絵）
    }
    if (long) {
      if (R > 1230) return 'L_HOMET';               // 1 周目のスタンド前
      if (R > 1040) return 'L_MAIN';                // 1〜2 コーナー: 1 カメ（向こう正面の入口はターフビジョンの陰になる）
      if (R < 860 && R > 760) return 'L_BACK';      // 向こう正面の斜め前
    } else {                                        // 1000m（ref/START_STUDY.md 3-2）
      if (R > 650) return 'L_BACKSIDE';             // S1・S2: 向こう正面を内馬場の並走カメラで真横に（切らずに寄る）
      // （S3 のスタンド高所からの遠景は、このコースでは内馬場の木立が画面の大半をふさぐので使わない。残り 650m から内からの追い L_TRACK）
    }
    if (R > SWING.R0) return 'L_TRACK';             // 3〜4 コーナー: 内馬場側から横に追う（A の遠景の真横は、このコースでは 3〜4 コーナーの内の木立に隠れるので使わない。1000m は A を省く: ref/STRAIGHT_STUDY.md 3-3）
    return 'L_SWING';                               // 4 コーナー〜ゴール: 1 台の動くカメラで切らない（斜め前 → 残り 100m で真横 → ゴール）
  }
  STYLES.live = {
    shots: Object.assign({}, SHOTS, ASHOTS, LSHOTS),
    race: scheduledLive,
    gate: () => 'L_GATE',
    // ゲートイン: wide → close → front。front は体勢完了（gate）・発走と同じカメラ（切らない）。確定演出 gateLate のとき（ctx.gateIn.side）の横は GI_LATE_*（遅れる馬を追う）
    gatein: (phT, ctx) => ({ wide: 'GI_WIDE', close: ctx.gateIn && ctx.gateIn.side === 'in' ? 'GI_LATE_IN' : ctx.gateIn && ctx.gateIn.side === 'out' ? 'GI_LATE_OUT' : 'GI_CLOSE', front: 'L_GATE', back: 'L_GATE' })[ctx.gateIn && ctx.gateIn.cue] || 'GI_WIDE',
    replay: (phT, ctx) => (ctx && ctx.replayStage === 'head' ? 'L_RHEAD' : 'L_RGOAL'),   // 固定のゴールの真横（接戦は 2 回）→ 真正面のスロー                       // ゴール直後のスローのアップ（低い正面寄り。約 2 秒）
    winner: (phT, ctx) => (ctx && ctx.winStage === 'back' ? 'L_WINFRONT' : ctx && ctx.winStage === 'second' ? 'L_WIN2' : ctx && ctx.winStage === 'both' ? 'L_WINPAIR' : 'L_WINNER'),   // 勝ち馬を後ろから追う → 喜ぶ勝ち馬のアップ → 2 着のアップ → 2 頭（v4）
    paddock: () => 'L_PADDOCK',
    pre: (idx) => ['CLOSE', 'A_CLOSE', 'A_PRE'][idx % 3],
    boostShot: 'L_BOOST',
    strict: true,
    minHold: 2.0,                                   // 1 カット最低 2 秒（ref/STRAIGHT_STUDY.md 3 章）
    fallback: ['L_MAIN2', 'L_MAIN'],
  };

  /* ---------- 小さな道具（毎コマの new を避ける） ---------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function wrapPI(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  // 臨界減衰ばね（厳密解）: st[i] = 値, st[i+1] = 速さ
  function spring(st, i, target, w, dt) {
    const y = st[i] - target, ex = Math.exp(-w * dt), tmp = (st[i + 1] + w * y) * dt;
    st[i] = target + (y + tmp) * ex; st[i + 1] = (st[i + 1] - w * tmp) * ex;
  }
  // 線分（P→Q）が箱に当たるか（スラブ法）
  const SLAB = [0, 1];
  function slab(o, d, mn, mx) {
    if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
    let ta = (mn - o) / d, tb = (mx - o) / d; if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > SLAB[0]) SLAB[0] = ta; if (tb < SLAB[1]) SLAB[1] = tb; return SLAB[0] <= SLAB[1];
  }
  function segBox(px, py, pz, qx, qy, qz, b) {
    SLAB[0] = 0; SLAB[1] = 1;
    return slab(px, qx - px, b.minx, b.maxx) && slab(py, qy - py, b.miny, b.maxy) && slab(pz, qz - pz, b.minz, b.maxz);
  }
  // 決まった周波数の和で作る揺れ（乱数を使わないので同じ ctx・dt なら同じ絵）
  const wob = (t, a, b, c) => 0.55 * Math.sin(t * a + 0.3) + 0.3 * Math.sin(t * b + 1.7) + 0.15 * Math.sin(t * c + 4.1);

  function create(opts) {
    opts = opts || {};
    const out = { pos: { x: 0, y: 30, z: 120 }, target: { x: 0, y: 0, z: 0 }, fov: 30, label: '', cut: false };
    // ばねの状態: [yaw, v, pitch, v, ln(fov), v, px, v, py, v, pz, v]
    const st = new Float64Array(12);
    const rt = new Float64Array(6);   // 狙いの前の値と動く速さ（先読み用）
    let aspect = ASPECT0, occ = [];
    // 既定の隠れ物: ゴール板の外の決勝審判の小屋（会場の担当と同じ置き方: 外ラチ+1m のゴール板から外へ約 4m、高さ約 8m）
    // 柱（幅 0.9m・高さ 5.2m）と上のガラスの小屋（約 3m 角・5.2〜7.7m）に分ける（1 つの大きな箱だと、柱の横を抜ける視線まで「隠れる」になる）
    const BASE_OCC = (function () { const p = C.pointAt(C.FINISH_S, C.RO + 5.2); return [{ minx: p.x - 0.55, maxx: p.x + 0.55, miny: 0, maxy: 5.3, minz: p.z - 0.55, maxz: p.z + 0.55 }, { minx: p.x - 1.5, maxx: p.x + 1.5, miny: 5.2, maxy: 7.7, minz: p.z - 1.5, maxz: p.z + 1.5 }]; })();
    occ = BASE_OCC.slice();
    let cur = null, curRig = null, curSched = '', shotT = 0, phT = 0, phase = '', lastIdx = -1, lost = 0, bad = 0, tPrev = null, photoT = -1, finishSeen = false, teleRig = null;
    let cap = 0, order = null, sPrev = null, vel = null, pts = null;
    const closeRig = { x: 0, y: 3, z: 0, name: 'START_A', fx: 0, fz: 0, pan: 180, fmin: 1.2, fmax: 40, dmax: 200 };   // 発走前のアップ用（発走地点で決まる）
    const gateRig = { name: 'GATE', x: 0, y: 9, z: 0, fx: 0, fz: 0, pan: 180, fmin: 2, fmax: 60, dmax: 400 };
    const giRig = { name: 'GI', x: 0, y: 8, z: 0, fx: 0, fz: 0, pan: 180, fmin: 3, fmax: 62, dmax: 300 };   // ゲートイン用（ゲートの位置で決まる）
    const rhdRig = { name: 'RHD', x: 0, y: 2, z: 0, fx: -1, fz: 0, pan: 180, fmin: 1.5, fmax: 40, dmax: 300 };   // 再生の正面（少し斜め）。区間の頭の上位 2 頭の進路で決まる
    let fixR = C.RI + 3.5, remNow = 1e9, giBalkK = 0, eyeGlow = 0, eyeHorse = -1;   // giBalkK: 遅れる馬が止まっている度合い（横のカメラが push だけ寄る）、eyeGlow: 目の光の度合い（最終コーナーのカメラが 1 割寄る）   // fixAim の r: 'lead' の進路（区間の頭で決める）／先頭の残り距離（sizeR の物差し）
    const gateSOf = (ctx) => (ctx.gateS != null ? ctx.gateS : ctx.startS != null ? ctx.startS : C.startS(ctx.dist || 1000));   // ゲートの位置（1200m はゴール板の少し手前）
    const aim = { yaw: 0, pitch: 0, fov: 30, dist: 50, ok: true, n: 0 };
    const subj = { x: 0, z: 0 };
    const self = { out, shot: '', desc: '', rig: '', style: '' };
    let STY = STYLES.broadcast, SH = STY.shots;
    // 動くカメラ（カメラカー・クレーン）: コースに沿って集団と一緒に動く。位置は周回の距離 s をばねでなめらかに
    const trackRig = { name: 'TRACK', x: 0, y: 3, z: 0, fx: 0, fz: 0, pan: 180, fmin: 2, fmax: 70, dmax: 600 };
    const trk = new Float64Array(3);   // [カメラの s, 速さ, 先頭からの遅れ（なめらか）]
    // ジオラマのカメラ: 狙う地点の x,z と高さ・見下ろし角・横幅をそれぞればねでなめらかに（ゴールで「急に降りる」もこの中で）
    const dioRig = { name: 'DIO', x: 0, y: 60, z: 0, fx: 0, fz: 0, pan: 180, fmin: 3, fmax: 75, dmax: 1500, minW: 60 };
    const dio = new Float64Array(10);  // [x, vx, z, vz, y, vy, 横幅, v, 見下ろし角, v]
    let dioLow = false;
    let boostI = -1, boostOff = 4, boostUntil = -1, boostN = 0, ctxS0 = 0, postRest = null, postPassed = false, sideScore = 0;   // 応援の加速の差し込み（live）                // ゴールで降りている間は先頭の 3 頭（6m 以内）だけを映す
    function setStyle(name) {
      const q = STYLES[name] ? name : 'broadcast';
      if (STY === STYLES[q] && self.style === q) return;
      STY = STYLES[q]; SH = STY.shots; self.style = q; cur = null; curRig = null; phase = '';
    }
    {
      let want = opts.style || (window.R3D && R3D.cameraStyle) || '';
      try { const m = /[?&]camstyle=(\w+)/.exec(location.search); if (m) want = m[1]; } catch (e) { /* location が無い環境 */ }
      setStyle(want || DEFAULT_STYLE);
    }
    self.setStyle = setStyle;

    function ensure(n) {
      if (n <= cap) return;
      cap = Math.max(n, 18); order = new Int32Array(cap); sPrev = new Float64Array(cap); vel = new Float64Array(cap); pts = new Float64Array(cap * 2 * 4 + 16); swR = new Float64Array(cap);
    }
    /* ---------- 最後の 4 コーナー〜ゴールの動くカメラ（L_SWING。上の SWING の説明） ----------
       毎コマ、馬の位置と残り距離だけから out を直接決める（ばねを通さない）。order（s の大きい順）は並べ終わっていること */
    const swingRig = { name: 'SWING', x: 0, y: 10, z: 0, fx: 0, fz: 0, pan: 180, fmin: SWING.fmin, fmax: SWING.fmax, dmax: 900 };
    let swR = null;   // 馬ごとの「先頭 3 頭の重み」（0..1。順位の入れ替わりで跳ばないよう、3 番手との差 rk m でなめらかに）
    const swInfo = { R: 0, e: 0, wT: 0, a: 0, d: 0, y: 0, fov: 0, need: 0, fovSize: 0, rel: 0 };   // 確認用（d.swing）
    const smin = (a, b, k) => { const m = (b - a) / k; return m > 30 ? a : b - k * Math.log1p(Math.exp(m)); };   // なめらかな min（b に近づくとゆっくり止まる）
    function swingPose(ctx, H, n) {
      const W = SWING, R = Math.max(0, remNow);
      const u = clamp((W.R0 - R) / (W.R0 - W.R1), 0, 1), e = u * u * u * (u * (u * 6 - 15) + 10);
      const kt = clamp((W.R1 - R) / W.tight, 0, 1), wT = kt * kt * (3 - 2 * kt);
      const k3 = Math.min(3, n), s3 = H[order[k3 - 1]].s || 0;
      let sAll = 0, sTop = 0, cx = 0, cz = 0, ws = 0;
      for (let i = 0; i < n; i++) {
        const si = H[i].s || 0, g = clamp((si - s3) / W.rk + 1, 0, 1), wr = g * g * (3 - 2 * g);
        swR[i] = wr; sAll += si; cx += H[i].x * wr; cz += H[i].z * wr; ws += wr;
      }
      for (let r = 0; r < k3; r++) sTop += H[order[r]].s || 0;
      sAll /= n; sTop /= k3; cx /= ws; cz /= ws;
      // カメラの置き場所: 馬群の基準点 F（コースの s・決まった進路 rRef）から、進む向き T と外向き N の間の角 a の方へ d m
      const sF = sAll + (sTop - sAll) * (W.bias + (1 - W.bias) * wT) + W.ahead;
      // 進む向き T は、前後 tw m の 2 点を結ぶ向き（円の上では真ん中の接線と同じ。コーナーと直線のつなぎ目で向きの回る速さが急に変わらない＝カメラの速さが跳ばない）
      const F = C.pointAt(ctxS0 + sF, W.rRef), Fa = C.pointAt(ctxS0 + sF - W.tw, W.rRef), Fb = C.pointAt(ctxS0 + sF + W.tw, W.rRef);
      let Tx = Fb.x - Fa.x, Tz = Fb.z - Fa.z; { const tl = Math.hypot(Tx, Tz) || 1; Tx /= tl; Tz /= tl; }
      const Nx = -Tz, Nz = Tx;
      const a = (W.a0 + (90 - W.a0) * e) * D2R, d = W.d0 + (W.d1 - W.d0) * e, y = W.y0 + (W.y1 - W.y0) * e;
      let px = F.x + d * (Math.cos(a) * Tx + Math.sin(a) * Nx);
      const pz = F.z + d * (Math.cos(a) * Tz + Math.sin(a) * Nz);
      px = smin(px, W.xStop, W.kStop);   // ゴールの少し手前でなめらかに止まる（外のゴール板の柱がゴールの瞬間の鼻先に重ならない）
      swingRig.x = px; swingRig.y = y; swingRig.z = pz;
      // 狙いと画角: 「6 頭全部」と「先頭 3 頭」の 2 通りを別々に決め、寄りの重み wT でなめらかにまぜる（まぜずに 1 つの式で重みを変えると、
      // 画角を決める条件（馬の大きさ／全頭を入れる）の切り替わりで寄る速さが急に変わった）
      const fx0 = cx + Tx * W.ahead, fz0 = cz + Tz * W.ahead, fy0 = HORSE_H / 2, Dc = Math.hypot(fx0 - px, fy0 - y, fz0 - pz);
      const sizeA = W.sA + (W.sB - W.sA) * e;
      let yaw, pitch, lf;
      if (wT < 1) { swAim(H, n, px, y, pz, fx0, fy0, fz0, null, sizeA, Dc); yaw = SWA[0]; pitch = SWA[1]; lf = Math.log(SWA[2]); swInfo.need = SWA[3]; }
      if (wT > 0) {
        swAim(H, n, px, y, pz, fx0, fy0, fz0, swR, W.s1, Dc);
        if (wT >= 1) { yaw = SWA[0]; pitch = SWA[1]; lf = Math.log(SWA[2]); }
        else { yaw += wrapPI(SWA[0] - yaw) * wT; pitch += (SWA[1] - pitch) * wT; lf += (Math.log(SWA[2]) - lf) * wT; }
        swInfo.need = SWA[3];
      }
      let fov = clamp(Math.exp(lf), W.fmin, W.fmax);
      // 確定演出 eye: 目が光っている間（eyeGlow 0〜1。共有の時計から）、その馬が画面の中にいれば画角を 1 割だけ狭める（寄る）。終われば元の「6 頭全部」の決まりに戻る
      if (eyeGlow > 0 && eyeHorse >= 0 && eyeHorse < n) { const h = H[eyeHorse], hy = Math.atan2(h.x - px, h.z - pz), hf = Math.atan(Math.tan(fov * D2R / 2) * 1.78); if (Math.abs(wrapPI(hy - yaw)) < hf * 0.85) fov *= 1 - 0.1 * eyeGlow; }
      const fovSize = 2 * Math.atan(HORSE_H / (sizeA + (W.s1 - sizeA) * wT) / 2 / Dc) * R2D;
      // 出力（ばねの状態も合わせておく: この後に別のショットへ切り替わっても困らないように）
      const cp = Math.cos(pitch);
      out.pos.x = px; out.pos.y = y; out.pos.z = pz;
      out.target.x = px + Math.sin(yaw) * cp * Dc; out.target.y = y + Math.sin(pitch) * Dc; out.target.z = pz + Math.cos(yaw) * cp * Dc;
      out.fov = fov;
      st[0] = yaw; st[1] = 0; st[2] = pitch; st[3] = 0; st[4] = Math.log(fov); st[5] = 0;
      rt[0] = yaw; rt[1] = pitch; rt[2] = st[4]; rt[3] = rt[4] = rt[5] = 0; aim.dist = Dc; lost = 0; bad = 0;
      swInfo.R = R; swInfo.e = e; swInfo.wT = wT; swInfo.a = a * R2D; swInfo.d = d; swInfo.y = y; swInfo.fov = fov; swInfo.fovSize = fovSize;
      swInfo.rel = Math.acos(clamp(-(Math.sin(yaw) * Tx + Math.cos(yaw) * Tz), -1, 1)) * R2D;   // 進む向きの逆（正面）から見た向きの角（0 = 真正面・90 = 真横）
    }
    /* L_SWING の狙いと画角（1 通り）: (px, y, pz) のカメラから、狙いの点 (fx0, fy0, fz0)＝先頭 3 頭の中心を基準に、映す馬（wts: 馬ごとの重み 0..1。null は全頭）の
       鼻先・尾 × 足元・頭が画面の limX・limY の内側に入る向きと画角。向きは「範囲の真ん中」へ (1 - focusK) だけ寄せる（先頭を画面の真ん中寄りに）。
       画角は「先頭の馬が画面の高さの size」と「全部が入る」の大きいほう（なめらかな max）。結果は SWA = [yaw, pitch, fov, need] */
    const SWA = new Float64Array(4);
    function swAim(H, n, px, y, pz, fx0, fy0, fz0, wts, size, Dc) {
      const W = SWING;
      let yaw = Math.atan2(fx0 - px, fz0 - pz), pitch = Math.atan2(fy0 - y, Math.hypot(fx0 - px, fz0 - pz)), need = 0;
      for (let pass = 0; pass < 2; pass++) {
        projOn(swingRig, yaw, pitch, fx0, fy0, fz0); const cX = PJ[0], cY = PJ[1];
        let x0 = cX, x1 = cX, y0 = cY, y1 = cY;
        for (let i = 0; i < n; i++) {
          const h = H[i], w = wts ? wts[i] : 1; if (w <= 0) continue;
          const bb = bodyOf(h), hh = hgtOf(h);
          for (let q = 0; q < 4; q++) {
            const sg = q & 1 ? -bb : bb, yy = q & 2 ? hh : 0;
            projOn(swingRig, yaw, pitch, h.x + h.hx * sg, yy, h.z + h.hz * sg); if (PJ[2] < 0.5) continue;
            const tx = cX + (PJ[0] - cX) * w, ty = cY + (PJ[1] - cY) * w;   // 重みの小さい馬は、狙いの点の方へ寄せて数える（順位の入れ替わりで跳ばない）
            if (pass === 0) { if (tx < x0) x0 = tx; if (tx > x1) x1 = tx; if (ty < y0) y0 = ty; if (ty > y1) y1 = ty; }
            else { const v = Math.max(Math.abs(tx) / (aspect * W.limX), Math.abs(ty) / W.limY); if (v > need) need = v; }
          }
        }
        if (pass === 1) break;
        // 範囲の真ん中（と狙いの間）へ向きを直す: 向き f + 右 r × mx + 上 u × my
        const mx = cX + ((x0 + x1) / 2 - cX) * (1 - W.focusK), my = cY + ((y0 + y1) / 2 - cY) * (1 - W.focusK);
        const cp = Math.cos(pitch), f0 = Math.sin(yaw) * cp, f1 = Math.sin(pitch), f2 = Math.cos(yaw) * cp;
        let rx = -f2, rz = f0; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
        const ux = -rz * f1, uy = rz * f0 - rx * f2, uz = rx * f1;
        const vx = f0 + rx * mx + ux * my, vy = f1 + uy * my, vz = f2 + rz * mx + uz * my;
        yaw = Math.atan2(vx, vz); pitch = Math.atan2(vy, Math.hypot(vx, vz));
      }
      const a = 2 * Math.atan(HORSE_H / size / 2 / Dc) * R2D, b = 2 * Math.atan(need) * R2D, k = W.fovK;
      SWA[0] = yaw; SWA[1] = pitch; SWA[2] = (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2; SWA[3] = need;   // なめらかな max（差が k 度より小さい所で丸める）
    }
    self.swing = swInfo;
    // 進んだ距離 s の大きい順に並べる（挿入ソート）
    function sortOrder(H, n) {
      for (let i = 0; i < n; i++) order[i] = i;
      for (let i = 1; i < n; i++) { const v = order[i], sv = H[v].s || 0; let j = i - 1; while (j >= 0 && (H[order[j]].s || 0) < sv) { order[j + 1] = order[j]; j--; } order[j + 1] = v; }
    }
    // 映すべき馬（先頭から k 頭・gap m 以内）を点の列にする: [x, z, y0, y1] × (鼻先・尾)
    function gatherGroup(H, n, k, gap, ahead, minS, minK) {
      let m = 0; const s0 = H[order[0]].s || 0;
      for (let r = 0; r < n && r < k; r++) {
        const i = order[r], h = H[i]; if (r > 0 && s0 - (h.s || 0) > gap && r >= (minK || 1)) break;   // minK: 少なくともこの頭数（離れていても）
        if (r > 0 && minS != null && (h.s || 0) < minS) break;   // 後ろから追うカメラより後ろ（真下）の馬は入れない
        const px = h.x + (ahead ? h.hx * vel[i] * ahead : 0), pz = h.z + (ahead ? h.hz * vel[i] * ahead : 0);
        const hh = hgtOf(h), bb = bodyOf(h);
        pts[m++] = px + h.hx * bb; pts[m++] = pz + h.hz * bb; pts[m++] = 0; pts[m++] = hh;
        pts[m++] = px - h.hx * bb; pts[m++] = pz - h.hz * bb; pts[m++] = 0; pts[m++] = hh;
      }
      return m >> 2;
    }
    function gatherOne(h) {
      const hh = hgtOf(h), bb = bodyOf(h);
      pts[0] = h.x + h.hx * bb * 1.1; pts[1] = h.z + h.hz * bb * 1.1; pts[2] = 0; pts[3] = hh;
      pts[4] = h.x - h.hx * bb; pts[5] = h.z - h.hz * bb; pts[6] = 0; pts[7] = hh;
      return 2;
    }
    // v4: 2 頭の絵（1 着・2 着の鼻先・尾 × 足元・頭）
    function gatherPair(H) {
      let m = 0;
      for (const h of [H[pairA], H[pairB]]) { const hh = hgtOf(h), bb = bodyOf(h); pts[m++] = h.x + h.hx * bb * 1.1; pts[m++] = h.z + h.hz * bb * 1.1; pts[m++] = 0; pts[m++] = hh; pts[m++] = h.x - h.hx * bb; pts[m++] = h.z - h.hz * bb; pts[m++] = 0; pts[m++] = hh; }
      return m >> 2;
    }
    // コース全体（外ラチの少し外を 8 点）
    function gatherCourse() {
      let m = 0;
      for (let k = 0; k < 8; k++) { const p = C.pointAt(k * C.L / 8 + 50, C.RO + 4); pts[m++] = p.x; pts[m++] = p.z; pts[m++] = 0; pts[m++] = 2; }
      return 8;
    }
    // 発走前のゲート全体（内の端・外の端）
    function gatherGate(ctx, n) {
      const s = gateSOf(ctx);
      const a = C.pointAt(s - 0.4, C.laneR(0) - 2.5), b = C.pointAt(s - 0.4, C.laneR(Math.max(0, n - 1)) + 2.5);
      pts[0] = a.x; pts[1] = a.z; pts[2] = 0; pts[3] = 3.4; pts[4] = b.x; pts[5] = b.z; pts[6] = 0; pts[7] = 3.4;
      // 枠入りした馬（ゲートの前後にはみ出していても入れる）
      let m = 8; const H = ctx.horses;
      for (let i = 0; i < n; i++) { const h = H[i], hh = hgtOf(h), bb = bodyOf(h); pts[m++] = h.x + h.hx * bb; pts[m++] = h.z + h.hz * bb; pts[m++] = 0; pts[m++] = hh; pts[m++] = h.x - h.hx * bb; pts[m++] = h.z - h.hz * bb; pts[m++] = 0; pts[m++] = hh; }
      return m >> 2;
    }
    // ゲートインの主役: 膝から上（鼻先・尾 × 高さ 0.75m〜頭の上）
    function gatherFocus(h) { const m = gatherOne(h); pts[2] = pts[6] = 0.75; return m; }
    // ゲートインの全景: ゲートの四隅（後ろの扉の外端〜前扉、内の端〜外の端、地面〜上の桁）だけ。待つ馬・係員は枠に入れない（手前にはみ出してよい）
    function gatherGateBox(ctx, n) {
      const s = gateSOf(ctx), r0 = C.laneR(0) - 1.2, r1 = C.laneR(Math.max(0, n - 1)) + 1.2; let m = 0;
      for (const ds of [-1.75, 0.95]) for (const r of [r0, r1]) { const p = C.pointAt(s + ds, r); pts[m++] = p.x; pts[m++] = p.z; pts[m++] = 0; pts[m++] = 3.45; }
      return m >> 2;
    }
    /* 点の列をカメラ P から見て、向き（yaw/pitch）と画角を決める。どんな見下ろし角でも使えるよう、カメラの向きの座標で計る。
       size: 馬の大きさが画面の高さの何割か（遠いほど望遠）。幅・奥行きが入らなければ引く。
       lead: 進む向きの空き。世界の中で先頭の進む向きへ狙いをずらす（画面の横に動く成分の分だけ）。 */
    function frame(P, np, sh, size, cfov, lead) {
      let ax = 0, az = 0;
      for (let q = 0; q < np; q++) { ax += pts[q * 4]; az += pts[q * 4 + 1]; }
      ax /= np; az /= np;
      const ay = HORSE_H / 2 + (sh.aimY || 0);
      let fx = ax - P.x, fy = ay - P.y, fz = az - P.z, D = Math.hypot(fx, fy, fz) || 1;
      fx /= D; fy /= D; fz /= D;
      // 進む向きの空き（世界の m）: 見える横幅の半分 × lead × 画面の横に動く割合
      if (lead && sh.lead) {
        const hfH = Math.tan(Math.atan(Math.tan(cfov * D2R / 2) * aspect)), dot = lead.hx * fx + lead.hz * fz, side = Math.sqrt(Math.max(0, 1 - dot * dot));
        const m = sh.lead * hfH * D * side;
        ax += lead.hx * m; az += lead.hz * m;
        fx = ax - P.x; fy = ay - P.y; fz = az - P.z; D = Math.hypot(fx, fy, fz) || 1; fx /= D; fy /= D; fz /= D;
      }
      subj.x = ax; subj.z = az;
      // カメラの右・上
      let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;   // u = r × f
      let xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9;
      for (let q = 0; q < np; q++) {
        const dx = pts[q * 4] - P.x, dz = pts[q * 4 + 1] - P.z;
        for (let e = 0; e < 2; e++) {
          const dy = pts[q * 4 + 2 + e] - P.y, z = dx * fx + dy * fy + dz * fz;
          if (z < 0.5) continue;
          const tx = (dx * rx + dz * rz) / z, ty = (dx * ux + dy * uy + dz * uz) / z;
          if (tx < xmin) xmin = tx; if (tx > xmax) xmax = tx; if (ty < ymin) ymin = ty; if (ty > ymax) ymax = ty;
        }
      }
      if (xmin > xmax) { xmin = xmax = ymin = ymax = 0; }
      const mx = (xmin + xmax) / 2, my = (ymin + ymax) / 2;
      // 狙いの向き = f + r*mx + u*my
      const tx = fx + rx * mx + ux * my, ty = fy + uy * my, tz = fz + rz * mx + uz * my;
      aim.yaw = Math.atan2(tx, tz); aim.pitch = Math.atan2(ty, Math.hypot(tx, tz));
      aim.dist = D;
      const sf = sh.top3 ? 0.86 : 1;   // 先頭 3 頭のショット: 端から 7% 内側に
      const halfX = Math.max((xmax - xmin) / 2 / sf + sh.margin / 2 / D, (P.minW || 0) / 2 / D), halfY = (ymax - ymin) / 2 * (sh.top3 ? 1 / sf : 1.12);
      const fovSize = 2 * Math.atan(HORSE_H / size / 2 / D) * R2D;
      const fovW = 2 * Math.atan(Math.min(halfX, 20) / aspect) * R2D;
      const fovV = 2 * Math.atan(Math.min(halfY, 20)) * R2D;
      aim.fov = Math.max(fovSize, fovW, fovV);
    }
    /* frame ＋ live の決まり:
       minSize … 先頭の馬が画面の高さのこの割合より小さくなるほど引かない。入りきらなければ後ろの馬から外す（集団を先頭寄りに絞る）
       post    … ゴール板の真横のカメラ。先頭がゴールするまでは、ゴール板が画面の横 post の位置より左へは行かない（そこで止まる） */
    function fitFrame(P, np, sh, cfov, subjH, H, n, grp, ctx) {
      frame(P, np, sh, sizeNow(sh), cfov, subjH);
      if (grp && sh.minSize) {
        const gaps = [sh.gap * 0.55, 5, 0], hL = hgtOf(H[order[0]]);
        for (let g = 0; g < gaps.length; g++) {
          if (aim.fov <= 2 * Math.atan(hL / sh.minSize / 2 / Math.max(1, aim.dist)) * R2D * 1.03) break;
          np = gatherGroup(H, n, sh.k, gaps[g], 0, null);
          frame(P, np, sh, sizeNow(sh), cfov, subjH);
        }
      }
      // maxX: 主役（応援の馬）を画面の横 maxX（NDC）より右に置かない（右下の「応援！」ボタン・ルーレットの下に入れない）
      if (sh.maxX != null) {
        projOn(P, aim.yaw, aim.pitch, subjH.x, 1.2, subjH.z);
        const hh = Math.atan(Math.tan(clamp(aim.fov, P.fmin, P.fmax) * D2R / 2) * aspect), lim = Math.atan(sh.maxX * Math.tan(hh));
        if (PJ[2] > 0.5 && Math.atan(PJ[0]) > lim) aim.yaw -= (Math.atan(PJ[0]) - lim) / Math.max(0.3, Math.cos(aim.pitch));
      }
      postRest = null;
      if (sh.post) {
        const L = H[order[0]];
        if ((L.s || 0) < (ctx.dist || 1000)) {
          const gp = C.pointAt(C.FINISH_S, radiusOf(L)), fv = clamp(aim.fov, P.fmin, P.fmax) * D2R / 2;
          const hh = Math.atan(Math.tan(fv) * aspect), yp = Math.atan2(gp.x - P.x, gp.z - P.z);
          const yRest = yp + Math.atan((2 * sh.post - 1) * Math.tan(hh)) / Math.max(0.3, Math.cos(aim.pitch));
          postRest = yRest;   // yaw が小さいほど右を向く。ここより右へは振らない（ばねの所でなめらかに止める）
        }
      }
    }
    /* 先頭 3 頭（いまの順位。ゴールした馬も走り続けているので s の大きい順）の鼻先・尾 × 足元・頭が、
       画面の端から 6% 内側（NDC で ±0.88）に入るのに要る tan(縦の半画角)。カメラの真横・後ろの点は数えない */
    function top3Need(P, yaw, pitch, H, n, lim, cnt) {
      lim = lim || 0.88; cnt = cnt || 3;
      let need = 0;
      for (let r = 0; r < cnt && r < n; r++) {
        const h = H[order[r]], bb = bodyOf(h), hh = hgtOf(h);
        for (let e = 0; e < 4; e++) {
          const sg = e & 1 ? -bb : bb, y = e & 2 ? hh : 0;
          projOn(P, yaw, pitch, h.x + h.hx * sg, y, h.z + h.hz * sg);
          if (PJ[2] < 0.5) continue;
          const v = Math.max(Math.abs(PJ[0]) / (aspect * lim), Math.abs(PJ[1]) / lim);
          if (v > need) need = v;
        }
      }
      return need;
    }
    // 向き（yaw, pitch）のカメラから見た点の位置: PJ = [横 tan, 縦 tan, 奥行き]
    const PJ = new Float64Array(3);
    function projOn(P, yaw, pitch, x, y, z) {
      const cp = Math.cos(pitch), fx = Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = Math.cos(yaw) * cp;
      let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
      const dx = x - P.x, dy = y - P.y, dz = z - P.z, d = dx * fx + dy * fy + dz * fz;
      PJ[2] = d; PJ[0] = d > 1e-3 ? (dx * rx + dz * rz) / d : 0; PJ[1] = d > 1e-3 ? (dx * ux + dy * uy + dz * uz) / d : 0;
    }
    function occluded(P, x, z, y) {
      for (let k = 0; k < occ.length; k++) if (segBox(P.x, P.y, P.z, x, y, z, occ[k])) { self.failBox = occ[k]; return true; }
      return false;
    }
    // このカメラで、いまの（と少し先の）集団がちゃんと撮れるか。look: 何秒先まで見るか（切り替えるときは長めに）
    const LOOKS = [0, 1.2, 1.2];
    function usable(r, ctx, H, n, sh, look) {
      LOOKS[2] = look || 1.2;
      const np = gatherGroup(H, n, sh.k, sh.gap, 0);
      if (!np) return false;
      let ax = 0, az = 0; for (let q = 0; q < np; q++) { ax += pts[q * 4]; az += pts[q * 4 + 1]; } ax /= np; az /= np;
      const L = H[order[0]];
      const passes = r === trackRig || r === dioRig ? 1 : 3;   // 動くカメラは一緒に進むので先読みしない
      for (let pass = 0; pass < passes; pass++) {
        const tt = LOOKS[pass], vl = vel[order[0]] * tt, fx = ax + L.hx * vl, fz = az + L.hz * vl;
        const dx = fx - r.x, dz = fz - r.z, d = Math.hypot(dx, dz);
        if (d > r.dmax || d < 3) { self.fail = r.name + ' 距離 ' + d.toFixed(0); return false; }
        if (r.pan < 180 && (dx * r.fx + dz * r.fz) / (d || 1) < Math.cos(r.pan * D2R)) { self.fail = r.name + ' 首振り'; return false; }
        if (occ.length && (occluded(r, fx, fz, 1.3) || occluded(r, L.x + L.hx * vl, L.z + L.hz * vl, 2.0))) { self.fail = r.name + ' 隠れる ' + pass; return false; }
      }
      return true;
    }
    // スタンドの中から一番よい 1 台（隠れない・集団の真正面に近い）
    function bestStand(ctx, H, n, sh) {
      const np = gatherGroup(H, n, sh.k, sh.gap, 0);
      let ax = 0; for (let q = 0; q < np; q++) ax += pts[q * 4]; ax /= (np || 1);
      let best = null, bd = 1e9;
      for (let k = 0; k < STAND.length; k++) {
        const r = STAND[k]; if (r === teleRig && sh.name === 'TELE2') continue;   // 2 回目の望遠は別のカメラで
        if (!usable(r, ctx, H, n, sh, 3)) continue;
        const d = Math.abs(r.x - ax * 0.75); if (d < bd) { bd = d; best = r; }
      }
      return best || RIGS.SB;
    }
    function padRig(h) {
      // 馬を斜め前（30〜50 度）から 15m 前後の望遠で撮れる台。外の観客が背景になる
      let best = RIGS.PAD1, bs = -1e9;
      for (let k = 0; k < PADS.length; k++) {
        const r = RIGS[PADS[k]], dx = r.x - h.x, dz = r.z - h.z, d = Math.hypot(dx, dz) || 1;
        const front = (dx * h.hx + dz * h.hz) / d;                       // 1 = 真正面
        const sc = -Math.abs(d - 15) * 0.3 - Math.abs(front - 0.62) * 4;
        if (sc > bs) { bs = sc; best = r; }
      }
      return best;
    }
    // 動くカメラの置き場所。tr = { ds: 集団の中心から前(+)/後ろ(-)の m, r: 'in'|'out'|'mid' と off（m）, y, w: 追従の速さ }
    function placeDio(sh, ctx, H, n, dt, snap) {
      const d = sh.dio, ph = ctx.phase, L = H[order[0]], s0 = L.s || 0, dist = ctx.dist || 1000;
      let cx = 0, cz = 0, c = 0;
      const atGate = sh.subject === 'gate' && (ph === 'gate' || ph === 'prerace' || (ctx.gone || 0) < 2);
      if (atGate) { const S0 = gateSOf(ctx), g = C.pointAt(S0 - 0.4, (C.laneR(0) + C.laneR(Math.max(0, n - 1))) / 2); cx = g.x; cz = g.z; c = 1; }
      else { const kk = dioLow ? 3 : sh.k, gg = dioLow ? 6 : sh.gap; for (let r = 0; r < n && r < kk; r++) { const h = H[order[r]]; if (r > 0 && s0 - (h.s || 0) > gg) break; cx += h.x; cz += h.z; c++; } }
      cx /= c || 1; cz /= c || 1;
      // 先頭寄りに: 集団の中心と先頭の間（先頭 6 割）を狙う
      if (!atGate) { cx = cx * 0.4 + L.x * 0.6; cz = cz * 0.4 + L.z * 0.6; }
      // 高さ・角度・横幅の目標: ふだん / ゲート / ゴールで降りる（ゴールを過ぎて 20m で戻る）
      const R = ctx.remain == null ? dist - (ctx.gone || 0) : ctx.remain;
      let y = d.y, pt = d.pitch, mw = d.minW; dioLow = false;
      if (atGate) { y = d.yGate; pt = d.pitchGate; mw = d.minWGate; }
      else if (d.fixedLow || (ph === 'race' && R < d.drop && s0 - dist < 32)) { y = d.yLow; pt = d.pitchLow; mw = d.minWLow; dioLow = true; }
      else if (ph === 'race' && R < d.near && s0 < dist) { y = d.yNear; pt = d.pitchNear; mw = d.minWNear; }   // 最後の直線: 下がって寄る
      else if (Math.abs(L.x) > C.LS / 2 + 10) mw *= 0.9;   // コーナー: 馬が縦向きに走って小さく見えるので、引かずに少し寄る
      // 進む向きの空き: 見える横幅の ahead 割だけ先を狙う（画面は回さず、カメラごと前へ）
      if (!atGate) { cx += L.hx * mw * (d.ahead || 0); cz += L.hz * mw * (d.ahead || 0); }
      if (snap) { dio[0] = cx; dio[2] = cz; dio[4] = y; dio[6] = mw; dio[8] = pt; dio[1] = dio[3] = dio[5] = dio[7] = dio[9] = 0; }
      else {
        const v = atGate ? 0 : vel[order[0]] || 0, w = d.w || 1.4, wy = y < dio[4] ? 3.2 : 1.0;   // 降りるのは速く、上がるのはゆっくり
        spring(dio, 0, cx + L.hx * v * 2 / w, w, dt); spring(dio, 2, cz + L.hz * v * 2 / w, w, dt);
        spring(dio, 4, y, wy, dt); spring(dio, 6, mw, wy, dt); spring(dio, 8, pt, wy, dt);
      }
      // 先頭は必ず画面の内側（横 76%・縦 72% の枠）に: ばねが遅れても、はみ出す分だけ狙いごと押す
      if (!atGate) {
        const W = Math.max(8, dio[6]), Hg = W / aspect / Math.max(0.3, Math.sin(clamp(dio[8], 20, 88) * D2R));
        const lx = L.x - dio[0], lz = L.z - dio[2], mx = W * 0.38, mz = Hg * 0.36;
        if (lx > mx) dio[0] = L.x - mx; else if (lx < -mx) dio[0] = L.x + mx;
        if (lz > mz) dio[2] = L.z - mz; else if (lz < -mz) dio[2] = L.z + mz;
      }
      // カメラは狙う地点からスタンド側（+z）へ、高さ ÷ tan(見下ろし角) だけ下がった所。卓を囲んで見る向きのまま動く
      const back = dio[4] / Math.tan(clamp(dio[8], 20, 88) * D2R);
      dioRig.x = dio[0]; dioRig.y = dio[4]; dioRig.z = dio[2] + back; dioRig.minW = dio[6];
    }
    function radiusOf(h) { return Math.abs(h.x) <= C.LS / 2 ? Math.abs(h.z) : Math.hypot(h.x - Math.sign(h.x) * C.LS / 2, h.z); }
    /* v4（2 連単）: 勝ち馬の場面の主役。subject 'winner' のショットは ctx.winFocus（2 着のアップ）があればその馬、ctx.winPair（[1 着, 2 着]）があれば 2 頭の間（pairH）
       を主役にする（流儀を問わず。live は L_WIN2・L_WINPAIR で絵の大きさも変える） */
    const pairH = { x: 0, z: 0, hx: 1, hz: 0, s: 0, height: HORSE_H, body: BODY, type: '' }; let pairA = -1, pairB = -1;
    function winIdx(ctx, n) { const f = ctx.winFocus; if (f >= 0 && f < n) return f | 0; return ctx.winnerIdx >= 0 && ctx.winnerIdx < n ? ctx.winnerIdx : order[0]; }
    function pairOf(ctx, H, n) {
      const p = ctx.winPair; if (!p || p.length < 2) return null; const a = p[0] | 0, b = p[1] | 0; if (a === b || a < 0 || b < 0 || a >= n || b >= n) return null;
      pairA = a; pairB = b; const A = H[a], B = H[b]; pairH.x = (A.x + B.x) / 2; pairH.z = (A.z + B.z) / 2;
      const hx = (A.hx || 0) + (B.hx || 0), hz = (A.hz || 0) + (B.hz || 0), l = Math.hypot(hx, hz) || 1; pairH.hx = hx / l; pairH.hz = hz / l;
      pairH.s = ((A.s || 0) + (B.s || 0)) / 2; pairH.height = Math.max(hgtOf(A), hgtOf(B)); pairH.body = Math.max(bodyOf(A), bodyOf(B)); return pairH;
    }
    /* 勝ち馬のアップ: 止まった勝ち馬の前のどこに置くか。後ろから来て追い越していく負けた馬が、カメラと勝ち馬の間を
       横切らない所を選ぶ（この先 1.8 秒の動きを、いまの向きと速さ（少なくとも 7m/秒）で先読みして数える）。
       どこも横切られるなら、見下ろし約 38 度の高さから（勝ち馬の 2m 手前を通る馬でも騎手の頭の上を視線が越す） */
    const winCam = { ds: 12, off: 2.5, y: 1.8 };
    const WIN_DS = [7, 10, 13], WIN_OFF = [2.2, -2.2, 1.0, -1.0, 3.8, -3.8, 0, 0];
    function pickWin(h, H, n, skipA, skipB) {   // skipA/skipB: 2 頭の絵の 1 着・2 着（主役の 2 頭は横切りに数えない）
      const r = radiusOf(h), sW = ctxS0 + (h.s || 0);
      // 横の候補に「内ラチの内側」と「ほかの馬より外」を足す（そちら側からは誰も間を通れない）
      let rMax = r; for (let i = 0; i < n; i++) { const o = H[i]; if (o !== h && Math.abs((o.s || 0) - (h.s || 0)) < 30) rMax = Math.max(rMax, radiusOf(o)); }
      WIN_OFF[6] = -(r - C.RI) - 1.3; WIN_OFF[7] = rMax - r + 3;
      let best = 1e9, bd = 10, bo = 2.2;
      for (let a = 0; a < WIN_DS.length; a++) for (let b = 0; b < WIN_OFF.length; b++) {
        const ds = WIN_DS[a], off = WIN_OFF[b], p = C.pointAt(sW + ds, r + off), ang = Math.atan2(Math.abs(off), ds) * R2D;
        if (r + off > C.RO - 0.8 || r + off < C.RI + 0.8) continue;   // 低いカメラはコースの中だけ（ラチの外・内からだとラチの横木が勝ち馬の前を横切る）
        let cost = Math.abs(ang - 22) * 0.025 + (off < 0 ? 0.2 : 0) + Math.abs(ds - 10) * 0.06;   // 斜め前（約 20 度）・外寄り・10m を好む
        for (let i = 0; i < n; i++) {
          const o = H[i]; if (o === h || i === skipA || i === skipB) continue;
          const v = Math.max(0, vel[i] || 0), stopAt = 2.5;   // 手前に来る負けた馬は統合側（race3d.js の winnerClear）がこのカットの間は映さないので、横切りはすぐそばの分だけ数える（数えすぎると高い所から見下ろす絵になる）
          for (let k = 0; k <= 6; k++) {
            const tt = k * 0.3, dd = Math.min(v * tt, stopAt), ox = o.x + o.hx * dd, oz = o.z + o.hz * dd;
            const ex = p.x - h.x, ez = p.z - h.z, L2 = ex * ex + ez * ez || 1, u = ((ox - h.x) * ex + (oz - h.z) * ez) / L2;
            const dO = Math.hypot(ox - p.x, oz - p.z), dW = Math.hypot(h.x - p.x, h.z - p.z);
            if (dO < 2.2) cost += 6;                                                         // カメラにぶつかる
            else if (dO < dW - 1.2) {                                                        // 勝ち馬より手前で画角（左右約 25 度）に入る
              const ca = ((ox - p.x) * (h.x - p.x) + (oz - p.z) * (h.z - p.z)) / (dO * dW || 1);
              if (ca > 0.9) cost += 1 + 2 * (1 - dO / dW);
            }
            if (u < 0.04 || u > 0.98) continue;
            const dl = Math.hypot(h.x + ex * u - ox, h.z + ez * u - oz);
            if (dl < 1.1) cost += 3 + 4 * u;                                              // 勝ち馬の前を横切る（カメラに近いほど大きく隠す）
          }
        }
        if (skipA >= 0 && skipB >= 0) {   // 2 頭の絵: カメラから見て 2 頭が重ならない向き（2 頭への向きの差が 12 度より小さいと奥の馬が手前の馬に隠れる）
          const A = H[skipA], B = H[skipB], sep = Math.abs(Math.atan2(A.x - p.x, A.z - p.z) - Math.atan2(B.x - p.x, B.z - p.z)) * R2D, sp = Math.min(sep, 360 - sep);
          if (sp < 12) cost += (12 - sp) * 0.4;
        }
        if (cost < best) { best = cost; bd = ds; bo = off; }
      }
      winCam.ds = bd; winCam.off = bo; if (best > 1.5) { winCam.y = Math.min(3.2, 1.5 + Math.hypot(bd, bo) * 0.78); } else winCam.y = 1.8;   // 横切られるなら見下ろし約 38 度（すぐそばを通る馬の頭の上を越して勝ち馬が見える）
      self.winPick = { ds: bd, off: bo, y: winCam.y, cost: +best.toFixed(2) };   // 確認用
    }
    // 低い横のカメラ（応援の加速）を馬の外・内のどちらに置くか: ほかの馬とぶつからず、主役との間に馬が入らない側
    function sideFor(h, H, n, ds) {
      const r = radiusOf(h), S0 = h.s || 0, cand = [5.5, -Math.max(2.5, r - C.RI + 1.3)];
      let best = cand[0], bs = -1e9;
      for (let c = 0; c < cand.length; c++) {
        const cs = (ctxS0 || 0) + S0 + ds, p = C.pointAt(cs, r + cand[c]);
        let sc = cand[c] > 0 ? 4 : 0;     // 外を優先（内はハロン棒が目の前に来る）
        for (let i = 0; i < n; i++) {
          const o = H[i]; if (o === h) continue;
          const dv = (vel[i] || 0) - (vel[H.indexOf(h)] || 0), dc = Math.min(Math.hypot(o.x - p.x, o.z - p.z), Math.hypot(o.x + o.hx * dv * 1.5 - p.x, o.z + o.hz * dv * 1.5 - p.z));   // カメラとの近さ（いまと 1.5 秒後）
          const ex = p.x - h.x, ez = p.z - h.z, L2 = ex * ex + ez * ez || 1;    // 主役→カメラの線分との近さ
          const u = clamp(((o.x - h.x) * ex + (o.z - h.z) * ez) / L2, 0, 1), dl = Math.hypot(h.x + ex * u - o.x, h.z + ez * u - o.z);
          sc -= Math.max(0, 6 - dc) * 2 + Math.max(0, 2.2 - dl) * 3;
        }
        if (sc > bs) { bs = sc; best = cand[c]; }
      }
      sideScore = bs;
      return best;
    }
    function placeTrack(sh, ctx, H, n, subjH, dt, snap) {
      const tr = sh.track, S0 = ctx.startS != null ? ctx.startS : C.startS(ctx.dist || 1000);
      let base0, v;
      if (sh.subject === 'winner' || sh.subject === 'horse' || sh.subject === 'boost') { base0 = subjH.s || 0; v = subjH === pairH ? (vel[pairA] + vel[pairB]) / 2 : subjH === H[order[0]] ? vel[order[0]] : vel[Math.max(0, H.indexOf(subjH))]; trk[2] = 0; }
      else {
        // ref: 'head' 先頭から / 'tail' 集団の最後尾から / それ以外は集団の平均から。
        // 先頭からの「遅れ」をなめらかにして使う（集団の顔ぶれが変わってもカメラが跳ばない）
        const np = Math.min(n, sh.k), s0 = H[order[0]].s || 0; let c = 0, last = s0, sum = 0;
        for (let r = 0; r < np; r++) { const h = H[order[r]]; if (r > 0 && s0 - (h.s || 0) > sh.gap) break; sum += h.s || 0; last = h.s || 0; c++; }
        let back = tr.ref === 'head' ? 0 : tr.ref === 'tail' ? s0 - last : s0 - sum / (c || 1);
        // 後ろから追うカメラは、先頭より必ず minBack m 以上後ろ
        if (tr.ds < 0 && tr.minBack) back = Math.max(back, tr.minBack + tr.ds);
        if (snap) trk[2] = back; else trk[2] += (back - trk[2]) * Math.min(1, dt * (back > trk[2] ? 2.5 : 0.8));
        base0 = s0 - trk[2]; v = vel[order[0]];
      }
      const want = S0 + base0 + (tr.ds === 'win' ? winCam.ds : tr.ds);
      if (snap) { trk[0] = want; trk[1] = sh.subject === 'boost' || sh.track.side ? v || 0 : 0; }
      else { if (Math.abs(want - trk[0]) > 400) trk[0] = want; spring(trk, 0, want + (v || 0) * 2 / (tr.w || 2), tr.w || 2, dt); }
      // r: 'in' 内ラチ / 'out' 外ラチ / 'lane' 主役の馬の進路 / それ以外はコースの真ん中
      const base = tr.r === 'in' ? C.RI : tr.r === 'out' ? C.RO : tr.r === 'lane' ? radiusOf(subjH) : C.RC;
      const p = C.pointAt(trk[0], base + (tr.off === 'auto' ? boostOff : tr.off === 'win' ? winCam.off : tr.off || 0));
      trackRig.x = p.x; trackRig.z = p.z; trackRig.y = tr.y === 'win' ? winCam.y : tr.y; trackRig.fmin = tr.fmin || 2; trackRig.fmax = tr.fmax || 70;
    }
    function rigFor(sh, ctx, H, n) {
      if (sh.rig === 'DIO') { placeDio(sh, ctx, H, n, 0, true); return dioRig; }
      if (sh.rig === 'TRACK') {
        const pr = sh.subject === 'winner' ? pairOf(ctx, H, n) : null;
        const sj = pr || (sh.subject === 'winner' ? H[winIdx(ctx, n)] : sh.subject === 'horse' ? H[clamp(ctx.paddockIdx | 0, 0, n - 1)] : sh.subject === 'boost' ? H[clamp(boostI, 0, n - 1)] : H[order[0]]);
        if (sh.track.off === 'auto') boostOff = sideFor(sj, H, n, sh.track.ds);
        if (sh.track.off === 'win') pickWin(sj, H, n, pr ? pairA : ctx.winFocus >= 0 && ctx.winnerIdx >= 0 ? ctx.winnerIdx : -1, pr ? pairB : -1);   // 2 着のアップ: 勝ち馬はそばなら統合側が映さないので横切りに数えない
        placeTrack(sh, ctx, H, n, sj, 0, true); return trackRig;
      }
      if (sh.rig === 'STAND') return bestStand(ctx, H, n, sh);
      if (sh.rig === 'SWING') return swingRig;   // 置き場所は毎コマ swingPose で決める
      // fixAim の進路: ふつうは上位 2 頭の進路の間。写真判定の区間（ctx.photoPair＝統合側が渡す小窓の馬。v4 の 2 着争いなら 2・3 着）はその馬たちの進路の間
      if (sh.fixAim && sh.fixAim.r === 'lead') { const pp = ctx.photoPair && ctx.photoPair.length >= 2 && ctx.photoPair.every((i) => i >= 0 && i < n) ? ctx.photoPair : null, a = H[pp ? pp[0] : order[0]], b = H[pp ? pp[pp.length - 1] : order[Math.min(1, n - 1)]]; fixR = clamp((radiusOf(a) + radiusOf(b)) / 2, C.RI + 1.2, C.RO - 1.2); }
      if (sh.rig === 'RHD') {
        // ゴールの 28m 先（直線をそのまま延ばした所。コースはすぐ 1 コーナーに曲がるので、その外の芝）・上位 2 頭の進路から外へ 7.5m・高さ 2m。
        // 斜め約 15 度から、ゴールへ向かってくる上位の馬の顔と体の横が両方見える。外のゴール板は画面の外（反対側 20 度以上）
        const a = H[order[0]], b = H[order[Math.min(1, n - 1)]], rb = (radiusOf(a) + radiusOf(b)) / 2;
        rhdRig.x = C.LS / 2 + 28; rhdRig.z = Math.min(rb + 7.5, C.RO + 6); rhdRig.y = 2.0; return rhdRig;
      }
      if (sh.rig === 'GI') {
        const g = sh.gi, gs = gateSOf(ctx), fi = clamp(ctx.gateIn ? ctx.gateIn.focus | 0 : 0, 0, n - 1);
        const base = g.r === 'out' ? C.RO : g.r === 'in' ? C.RI : g.r === 'focus' ? C.laneR(fi) : (C.laneR(0) + C.laneR(n - 1)) / 2;
        const p = C.pointAt(gs + g.ds, base + g.off); giRig.x = p.x; giRig.z = p.z; giRig.y = g.y; giRig.name = sh.name; return giRig;
      }
      if (sh.rig === 'GATE') {
        const s = gateSOf(ctx), gc = sh.gateCam, g = C.pointAt(s + (gc ? gc.ds : 46), C.RO + (gc ? gc.r : 15));
        gateRig.x = g.x; gateRig.z = g.z; gateRig.y = gc ? gc.y : 9; return gateRig;
      }
      if (sh.rig === 'PAD') { const h = H[clamp(ctx.paddockIdx | 0, 0, n - 1)]; return padRig(h); }
      if (sh.rig === 'CLOSE') {
        // 発走地点の外の芝（スタンド前の広場・外ラチの外）に据えた望遠。1 頭ごとに前寄り・後ろ寄りの 2 台を交互に
        // ゲートの後ろで待つ馬（s が負）は、その馬の位置から: 後ろ寄り 26m と、斜め前 6m（ゲートより手前なのでゲート越しにならない）
        const s = ctx.startS != null ? ctx.startS : C.startS(ctx.dist || 1000), k = (ctx.paddockIdx | 0) % 2, hs = H[clamp(ctx.paddockIdx | 0, 0, n - 1)].s || 0;
        const g = hs < -1 ? C.pointAt(s + hs + (k ? -26 : 6), C.RO + 9) : C.pointAt(s + (k ? -38 : 34), C.RO + 9);
        closeRig.x = g.x; closeRig.z = g.z; closeRig.y = k ? 2.2 : 3.2; closeRig.name = k ? 'START_B' : 'START_A'; return closeRig;
      }
      return RIGS[sh.rig];
    }
    // ショットに切り替え（カット）。使えなければ代わりを順に
    function choose(name, ctx, H, n, force) {
      let sh = SH[name] || SH[STY.fallback[0]], r = rigFor(sh, ctx, H, n);
      const isFixed = sh.rig !== 'PAD' && sh.rig !== 'GATE' && sh.rig !== 'CLOSE' && ctx.phase === 'race';
      if (isFixed && !sh.fin && !sh.trust && !sh.swing && !usable(r, ctx, H, n, sh, 3)) {   // ゴールの低い真横（fin）は場所を確かめてあるので、先読みで隠れても切り替える（3 秒先はもう 1 コーナー）
        let found = false;
        const alts = sh.alts;
        if (alts) for (let k = 0; k < alts.length && !found; k++) { const s2 = SH[alts[k]], r2 = rigFor(s2, ctx, H, n); if (usable(r2, ctx, H, n, s2, 3)) { sh = s2; r = r2; found = true; } }
        if (!found && STY.strict) {   // live: 代わりも使えるものだけ。どれも駄目なら頼まれたショットのまま（何度も切らない）
          const f = STY.fallback;
          for (let k = 0; k < f.length && !found; k++) { const s2 = SH[f[k]]; if (s2 === sh) continue; const r2 = rigFor(s2, ctx, H, n); if (usable(r2, ctx, H, n, s2, 3)) { sh = s2; r = r2; found = true; } }
          if (!found) { sh = SH[name] || sh; r = rigFor(sh, ctx, H, n); found = true; }
        }
        if (!found) { sh = fallbackShot(name); r = rigFor(sh, ctx, H, n); }
      }
      const changed = force || sh !== cur || r !== curRig;
      cur = sh; curRig = r; curSched = name; self.shot = sh.name; self.desc = sh.desc; self.rig = r.name;
      if (sh.name === 'TELE') teleRig = r;
      if (changed) { shotT = 0; lost = 0; bad = 0; }
      return changed;
    }
    // どれも使えないときの最後の頼み（流儀ごと）
    function fallbackShot(name) { const f = STY.fallback; return SH[f[0] === name && f[1] ? f[1] : f[0]]; }
    function sizeNow(sh) {
      let sz = sh.s0 + (sh.s1 - sh.s0) * clamp(shotT / (sh.zt || 6), 0, 1);   // zt: 何秒かけて寄るか
      if (sh.sizeR && phase === 'race') {   // sizeR: 先頭の残り距離 m で決める大きさの折れ線 [[R, size], ...]（R の大きい順）。時間でなく地点で決まるので、どのテレビでも同じ寄り
        const T = sh.sizeR, R = Math.max(0, remNow);
        if (R >= T[0][0]) sz = T[0][1]; else { sz = T[T.length - 1][1]; for (let k = 1; k < T.length; k++) if (R >= T[k][0]) { const u = (R - T[k][0]) / (T[k - 1][0] - T[k][0]); sz = T[k][1] + (T[k - 1][1] - T[k][1]) * u; break; } }
      }
      if (sh.tele) { const c = shotT % 15; if (c > 9.5) sz = 0.11; }   // 望遠の追い: 9.5 秒寄って 5.5 秒引く
      if (sh.push && giBalkK > 0) sz *= 1 + sh.push * giBalkK;   // 確定演出 gateLate: 止まっている間だけ少し寄る（なめらかに入って戻る）
      if (sh.post && postPassed) sz = Math.min(sz, 0.21);
          // ゴール固定: 1 着がゴールしたら少し引いて追う              // ゴール板の横: ゴールしたら少し引いて勝ち馬を追う
      return sz;
    }

    self.setAspect = function (a) { if (a > 0.2 && a < 6) aspect = a; };
    self.setOccluders = function (list) {
      occ = BASE_OCC.slice();
      if (!list) return;
      const T = window.THREE;
      list.forEach((o) => {
        if (!o) return;
        if (o.minx != null) { occ.push(o); return; }
        if (!T || !o.isObject3D) return;
        o.updateMatrixWorld(true);
        // InstancedMesh（木立など）は 1 本ずつ箱にする
        if (o.isInstancedMesh && o.geometry) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const m = new T.Matrix4(), bb = new T.Box3();
          for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m); m.premultiply(o.matrixWorld); bb.copy(o.geometry.boundingBox).applyMatrix4(m); occ.push({ minx: bb.min.x, maxx: bb.max.x, miny: bb.min.y, maxy: bb.max.y, minz: bb.min.z, maxz: bb.max.z }); }
          return;
        }
        const bb = new T.Box3().setFromObject(o);
        if (isFinite(bb.min.x)) occ.push({ minx: bb.min.x, maxx: bb.max.x, miny: bb.min.y, maxy: bb.max.y, minz: bb.min.z, maxz: bb.max.z });
      });
    };
    self.occluders = function () { return occ; };   // 確認用
    self.reset = function () { cur = null; curRig = null; phase = ''; tPrev = null; };

    self.update = function (dt, ctx) {
      dt = clamp(+dt || 0, 0, 0.1);
      const H = ctx.horses || [], n = H.length; out.cut = false;
      if (!n) { out.label = ''; return out; }
      ensure(n);
      if (ctx.aspect) aspect = ctx.aspect;
      const t = ctx.t || 0, ph = ctx.phase || 'idle';
      ctxS0 = ctx.startS != null ? ctx.startS : C.startS(ctx.dist || 1000);
      remNow = ctx.remain == null ? (ctx.dist || 1000) - (ctx.gone || 0) : ctx.remain;
      giBalkK = ctx.gateIn && ctx.gateIn.balkK > 0 ? Math.min(1, ctx.gateIn.balkK) : 0; eyeGlow = ctx.eyeGlow > 0 ? Math.min(1, ctx.eyeGlow) : 0; eyeHorse = ctx.eyeHorse >= 0 ? ctx.eyeHorse | 0 : -1;
      { let sMax = 0; for (let i = 0; i < n; i++) if ((H[i].s || 0) > sMax) sMax = H[i].s || 0; postPassed = sMax >= (ctx.dist || 1000); }
      sortOrder(H, n);
      // 速さ（m/秒）の見積もり: 前のコマとの差。段階の変わり目・スナップのコマは前の値を使う
      const fresh = ph !== phase || !!ctx.snap || !dt;
      let jumped = false;   // 馬が瞬間移動した（リプレイの頭出しなど）→ 撮り直す
      for (let i = 0; i < n; i++) {
        const s = H[i].s || 0;
        if (!fresh) { if (Math.abs(s - sPrev[i]) > 6 + vel[i] * dt * 2) jumped = true; else { const v = (s - sPrev[i]) / dt; vel[i] += (clamp(v, 0, 70) - vel[i]) * Math.min(1, dt * 4); } }
        sPrev[i] = s;
      }
      // --- どのショットにするか ---
      let cutNow = false;
      if (ph !== phase || ctx.snap || !cur) {
        // ゲートの絵のままスタートする（ゲートが開いても切らない）
        const keepGate = cur && ((phase === 'gate' && ph === 'race' && cur.subject === 'gate') || (phase === 'gatein' && ph === 'gate' && SH[STY.gate(0, ctx)] === cur));   // ゲートインの front から体勢完了へも同じカメラなら切らない（白い切り替えを出さない）
        if (ph !== phase) { phT = 0; photoT = -1; finishSeen = false; lastIdx = -1; boostUntil = -1; if (ph === 'gate' || ph === 'gatein' || ph === 'paddock' || ph === 'prerace') boostN = 0; if (ph === 'race' || ph === 'gate') for (let i = 0; i < n; i++) vel[i] = 0; }
        phase = ph;
        cutNow = !keepGate;
      }
      if (jumped) cutNow = true;
      shotT += dt; phT += dt;
      let want;
      const idx = ctx.paddockIdx | 0;
      if (ctx.style && ctx.style !== self.style && STYLES[ctx.style]) { setStyle(ctx.style); cutNow = true; }
      if (ph === 'race') {
        want = STY.race(ctx, shotT);
        // 応援の加速（ニンジン）が見えたら、その馬を低い横から少しだけ（ふだんの追いの間・先頭から 5 番手まで・1 レース 2 回まで）
        if (STY.boostShot) {
          if (boostUntil > phT && boostI >= 0) want = STY.boostShot;
          else if (ctx.boost && boostN < 2 && cur && cur.mainish && SH[want] && SH[want].mainish && shotT > 3 && (ctx.gone || 0) > 60) {
            const R = ctx.remain == null ? (ctx.dist || 1000) - (ctx.gone || 0) : ctx.remain;
            if (R > 540) for (let r = 0; r < n && r < 3; r++) {
              const i = order[r]; if ((ctx.boost[i] || 0) <= 0.4) continue;
              sideFor(H[i], H, n, SH[STY.boostShot].track.ds); if (sideScore < -6) break;   // 低いカメラのそばを別の馬が通るなら差し込まない
              boostI = i; boostUntil = phT + 2.8; boostN++; want = STY.boostShot; break;
            }
          }
        }
      }
      else if (ph === 'gate') want = STY.gate(phT, ctx);
      else if (ph === 'gatein') want = STY.gatein ? STY.gatein(phT, ctx) : STY.gate(phT, ctx);   // ゲートイン（枠入り）。台本の無い流儀はゲートの絵
      else if (ph === 'replay') want = STY.replay(phT, ctx);
      else if (ph === 'winner') want = STY.winner(phT, ctx);
      else if (ph === 'paddock') want = STY.paddock(idx);
      else { // prerace / idle: パドックにいればパドック、そうでなければ発走前（1 頭ずつ・ときどき全景）
        const pd = C.PADDOCK, h0 = H[0], inPad = Math.hypot(h0.x - pd.cx, h0.z - pd.cz) < pd.a + 20;
        want = inPad ? STY.paddock(idx) : STY.pre(idx);
      }
      if (!SH[want]) want = STY.fallback[0];
      if ((SH[want].rig === 'PAD' || SH[want].rig === 'CLOSE' || SH[want].perHorse) && idx !== lastIdx) { lastIdx = idx; cutNow = true; }
      if (cutNow) { choose(want, ctx, H, n, true); out.cut = true; }
      else if (want !== curSched && (shotT >= (STY.minHold || MIN_HOLD) || ph !== 'race' && ph !== 'replay' || SH[want].fin)) { if (choose(want, ctx, H, n, false)) out.cut = true; }   // ゴールの横のカメラ（残り 110m）は待たずに切り替える
      else if (ph === 'race' && cur.rig !== 'GATE' && !cur.swing) {   // 動くカメラ（L_SWING）は代わりへ切り替えない（いつも馬群を映すように決まる）
        // いまのカメラで撮れなくなった（隠れた・首が回らない）・馬が画面から外れた → 代わりへ
        if (!cur.fin && !usable(curRig, ctx, H, n, cur)) bad += dt; else bad = 0;   // ゴールの低い真横はゴール後も切らない
        if (STY.strict ? (bad > 0.5 && shotT > 1.2) || (lost > 0.5 && shotT > 0.4) : (bad > 0.15 || lost > 0.5) && shotT > 0.4) {
          self.why = (bad > 0.15 ? "撮れない" : "外れた") + "→代わり";   // 確認用
          const prevRig = curRig, prevShot = cur;
          const alts = cur.alts;
          if (alts) { for (let k = 0; k < alts.length; k++) { const s2 = SH[alts[k]], r2 = rigFor(s2, ctx, H, n); if (usable(r2, ctx, H, n, s2, 3)) { cur = s2; curRig = r2; break; } } }
          if (cur === prevShot && STY.strict) {   // live: 使える代わりが無ければ切らずに続ける（外れたときだけは切る）
            const f = STY.fallback;
            for (let k = 0; k < f.length; k++) { const s2 = SH[f[k]]; if (s2 === prevShot) continue; const r2 = rigFor(s2, ctx, H, n); if (usable(r2, ctx, H, n, s2, 3)) { cur = s2; curRig = r2; break; } }
            if (cur === prevShot) { bad = 0; if (lost > 0.5) { const s2 = fallbackShot(prevShot.name); cur = s2; curRig = rigFor(s2, ctx, H, n); } }
          }
          else if (cur === prevShot) { const s2 = fallbackShot(cur.name); cur = s2; curRig = rigFor(s2, ctx, H, n); }
          if (cur !== prevShot || curRig !== prevRig) { shotT = 0; lost = 0; bad = 0; out.cut = true; self.shot = cur.name; self.desc = cur.desc; self.rig = curRig.name; }
        }
      }
      const sh = cur;
      const L = H[order[0]];
      if (sh.swing && ph === 'race') { swingPose(ctx, H, n); tPrev = t; }
      else {
      // --- 被写体 ---
      let np;
      const wI = winIdx(ctx, n), pr = sh.subject === 'winner' ? pairOf(ctx, H, n) : null;
      const fI = clamp(ctx.gateIn ? ctx.gateIn.focus | 0 : 0, 0, n - 1);
      const one = pr ? null : sh.subject === 'winner' ? H[wI] : sh.subject === 'horse' ? H[clamp(idx, 0, n - 1)] : sh.subject === 'gifocus' ? H[fI] : null;
      if (sh.subject === 'course') np = gatherCourse();
      else if (sh.subject === 'gifocus') np = gatherFocus(one);
      else if (sh.subject === 'giwide') np = gatherGateBox(ctx, n);
      else if (sh.subject === 'gate' && (ph === 'gate' || ph === 'prerace' || (ctx.gone || 0) < 2)) np = gatherGate(ctx, n);
      else if (pr) np = gatherPair(H);
      else if (one) np = gatherOne(one);
      else if (sh.tele && sizeNow(sh) < 0.2) np = gatherGroup(H, n, 18, 30, 0);   // 引きの間は馬群全体
      else if (curRig === dioRig && dioLow) np = gatherGroup(H, n, 3, 6, 0);
      else np = gatherGroup(H, n, sh.k, sh.gap, 0, curRig === trackRig && sh.track.ds < 0 && !sh.track.side ? trk[0] - (ctx.startS != null ? ctx.startS : C.startS(ctx.dist || 1000)) + 8 : null, sh.minK);
      // （前は最後の低い真横で、先頭がゴールの 25m 手前から内のゴール板（柱と円板の上まで）も画面に入れていた。ゴールの 25〜8m 手前でゴール板まで引いて先頭が小さくなるのでやめた（v2 講評 1 回目の TOP1）。
      //  カメラをゴール線の 8m 手前に置いたので、内のゴール板の柱と赤い帯は先頭がゴールする直前に自然に画面の右から入り、馬のすぐ奥を通る）
      // 先頭の横向きの動き（空きの向き）
      const subjH = one || pr || (sh.subject === 'boost' ? H[clamp(boostI, 0, n - 1)] : L);
      // 動くカメラ: 集団（または主役）の s から決まった距離だけ前／後ろ、決まった半径・高さ
      if (curRig === trackRig) placeTrack(sh, ctx, H, n, subjH, dt, out.cut || !tPrev);
      else if (curRig === dioRig) placeDio(sh, ctx, H, n, dt, out.cut || !tPrev);
      const P = curRig;
      const curFov = out.cut || !tPrev ? 30 : Math.exp(st[4]);
      const grp = !one && !pr && sh.subject !== 'course' && !(sh.subject === 'gate' && (ph === 'gate' || ph === 'prerace' || (ctx.gone || 0) < 2)) && !(curRig === dioRig && dioLow);
      fitFrame(P, np, sh, curFov, subjH, H, n, grp, ctx);
      if (out.cut || !tPrev) fitFrame(P, np, sh, clamp(aim.fov, curRig.fmin, curRig.fmax), subjH, H, n, grp, ctx);   // カットの直後は画角が決まってから空きを計り直す
      if (sh.minFov) aim.fov = Math.max(aim.fov, sh.minFov);   // minFov: 縦の画角をこれより狭くしない（度。ゲートインの全景で空を入れる）
      if (sh.tilt) aim.pitch -= sh.tilt * clamp(aim.fov, curRig.fmin, curRig.fmax) * D2R / 2;   // tilt: 狙いを縦の半画角の割合だけ下へ（ゲートを画面の少し上に、手前の待つ馬・係員を下に）。負なら上へ（ゲートインの全景は空を入れる）
      if (curRig === dioRig) {   // ジオラマは画面を回さない（卓を囲んで見る向きのまま）。カメラごと動いて狙う
        aim.yaw = Math.PI; aim.pitch = -clamp(dio[8], 20, 88) * D2R;
        aim.fov = Math.max(2 * Math.atan(dioRig.minW / 2 / Math.max(1, aim.dist) / aspect) * R2D, aim.fov);
      }
      let fov = clamp(aim.fov, curRig.fmin, curRig.fmax);
      if (sh.tight && (ph === 'gatein' || ph === 'gate')) { const u = clamp(shotT / 2.0, 0, 1); fov *= 1 - sh.tight * u * u * (3 - 2 * u); }   // 体勢完了までゆっくり寄る（開いたら戻る＝飛び出しで少し引く）
      // 先頭（主役）は、いまのズームのままでも画面の 7 割の内側に置く（引きながら振るときに先頭を見失わない）
      if (!out.cut && tPrev && sh.subject !== 'course' && curRig !== trackRig && curRig !== dioRig && aim.pitch > -0.6) {
        projOn(P, aim.yaw, aim.pitch, subjH.x, 1.2, subjH.z);
        const lim = Math.tan(curFov * D2R / 2) * aspect * 0.7;
        // yaw が増えると画面は左へ回る（右の点を寄せるには yaw を減らす）
        if (PJ[2] > 1 && Math.abs(PJ[0]) > lim) { const cp = Math.max(0.2, Math.cos(aim.pitch)); aim.yaw -= (Math.atan(PJ[0]) - Math.sign(PJ[0]) * Math.atan(lim)) / cp; }
      }
      const keepIn = !out.cut && tPrev && sh.subject !== 'course' && curRig !== trackRig && curRig !== dioRig && aim.pitch > -0.6;
      // --- ばねで追う（カットの直後はぴたりと合わせる） ---
      if (postRest != null && (out.cut || !tPrev) && wrapPI(aim.yaw - postRest) < 0) aim.yaw = postRest;
      if (out.cut || !tPrev) {
        st[0] = aim.yaw; st[1] = 0; st[2] = aim.pitch; st[3] = 0; st[4] = Math.log(fov); st[5] = 0;
        rt[0] = aim.yaw; rt[1] = aim.pitch; rt[2] = Math.log(fov); rt[3] = rt[4] = rt[5] = 0;
      } else {
        // 狙いの動く速さ（rad/秒）。カメラマンは馬の動きを先読みして振るので、ばねの遅れ（2×速さ/ω）を先に足しておく
        const lf = Math.log(fov);
        if (dt > 0) {
          const k = Math.min(1, dt * (sh.ffk || 5)) * clamp((shotT - 0.15) / 0.5, 0, 1);   // カット直後は先読みしない。ffk: 振る速さの見積もりのなめらかさ（大きいほど遅れが少ない。ゴール前の 2 カット）
          rt[3] += (wrapPI(aim.yaw - rt[0]) / dt - rt[3]) * k; rt[4] += ((aim.pitch - rt[1]) / dt - rt[4]) * k; rt[5] += ((lf - rt[2]) / dt - rt[5]) * k;
        }
        rt[0] = aim.yaw; rt[1] = aim.pitch; rt[2] = lf;
        const tyaw = st[0] + wrapPI(aim.yaw - st[0]);
        const halfH = Math.atan(Math.tan(curFov * D2R / 2) * aspect);
        const err = Math.abs(tyaw - st[0]) / Math.max(1e-4, halfH);
        const boost = 1 + Math.max(0, err - 0.4) * 5;                            // 外れかけたら急いで振る
        projOn(P, st[0], st[2], subjH.x, 1.2, subjH.z);
        const errV = Math.abs(PJ[1]) / Math.max(1e-4, Math.tan(curFov * D2R / 2));   // 縦のはみ出しかけ
        const wy = sh.wp * boost * (sh.post && postPassed ? 2.6 : 1), wpt = sh.wp * (1 + Math.max(0, Math.max(err, errV) - 0.4) * 4);
        let ty = tyaw + clamp(rt[3], -1.5, 1.5) * 2 / wy;
        if (keepIn) {   // 先読みを足した狙いでも、主役が画面の 8 割の内側に残るように
          projOn(P, ty, aim.pitch, subjH.x, 1.2, subjH.z);
          const lim = Math.tan(curFov * D2R / 2) * aspect * 0.8;
          if (PJ[2] > 1 && Math.abs(PJ[0]) > lim) { const cp = Math.max(0.2, Math.cos(aim.pitch)); ty -= (Math.atan(PJ[0]) - Math.sign(PJ[0]) * Math.atan(lim)) / cp; }
        }
        if (postRest != null) {   // ゴール板の止め位置へ: 手前 m からなめらかに減速して止まる（行き過ぎない）
          const m = 0.07, d = wrapPI(ty - postRest);
          if (d < m) ty += m * Math.exp((d - m) / m) - d;   // 差の形で足す（±180 度の境目で値が飛んでカメラが一回転しないように）
        }
        spring(st, 0, ty, wy, dt);
        spring(st, 2, aim.pitch + clamp(rt[4], -1.2, 1.2) * 2 / wpt, wpt, dt);
        const wz = lf > st[4] ? sh.wz * 2.2 : sh.wz;                                // 引くのは早く、寄るのはゆっくり
        const f0 = st[4]; spring(st, 4, lf + clamp(rt[5], -0.6, 0.6) * 2 / wz, wz, dt);
        if (sh.zin && f0 - st[4] > sh.zin * dt) { st[4] = f0 - sh.zin * dt; if (st[5] < -sh.zin) st[5] = -sh.zin; }   // zin: 寄る速さの上限（画角の対数/秒。ゆっくり寄る）
        // 先頭が画面からはみ出していないか
        if (sh.subject !== 'course') {
          projOn(P, st[0], st[2], subjH.x, 1.2, subjH.z);
          const tH = Math.tan(curFov * D2R / 2);
          lost = (PJ[2] < 0.5 || Math.abs(PJ[0]) > tH * aspect * 0.98 || Math.abs(PJ[1]) > tH * 0.98) ? lost + dt : 0;
        }
      }
      tPrev = t;
      // 固定のカメラ（fixAim: ゴール線の上の 1 点を、決まった画角で。振らない・寄らない）
      if (sh.fixAim) {
        const fa = sh.fixAim, q = C.pointAt(C.FINISH_S + (fa.ds || 0), fa.r === 'lead' ? fixR : C.RI + fa.r), dx = q.x - P.x, dy = fa.y - P.y, dz = q.z - P.z;
        st[0] = Math.atan2(dx, dz); st[2] = Math.atan2(dy, Math.hypot(dx, dz)); st[4] = Math.log(fa.fov); st[1] = st[3] = st[5] = 0;
        if (fa.lineX && ctx.replayStage !== 'photo') st[0] += Math.atan(fa.lineX * Math.tan(fa.fov * D2R / 2) * aspect) / Math.max(0.3, Math.cos(st[2]));   // yaw を増やすと画面の中の物は右へ
        rt[0] = st[0]; rt[1] = st[2]; rt[2] = st[4]; rt[3] = rt[4] = rt[5] = 0; aim.dist = Math.hypot(dx, dy, dz); lost = 0;
      }
      // --- 手持ちの揺れ（望遠ほど目立つ。画角に比例） ---
      const swK = Math.min(sh.sway, ph === 'race' && remNow < SWAY_FIN_R ? SWAY_FIN : SWAY_MAX);
      const vf = Math.exp(st[4]), half = vf * D2R / 2, sw = swK * half;
      let yaw = st[0] + sw * wob(t, 0.73, 1.91, 4.3) * aspect * 0.6, pitch = st[2] + sw * 0.7 * wob(t + 7.7, 0.61, 2.33, 5.1);
      if (ph === 'race' && sh.rig === 'GATE') {   // ゲートが開く瞬間（発走の 0〜0.1 秒）だけ小さく揺らす
        const rt = ctx.raceT || 0;
        if (rt >= 0 && rt < SHAKE_T) { const k = 1 - rt / SHAKE_T, ph2 = rt * 2 * Math.PI / 0.04, tn = Math.tan(half); pitch += Math.atan(SHAKE_PX / 240 * tn) * Math.sin(ph2) * k; yaw += Math.atan(SHAKE_PX * 0.5 / 240 * tn) * Math.cos(ph2 * 0.75) * k / Math.max(0.3, Math.cos(pitch)); }
      }
      const cp = Math.cos(pitch), D = aim.dist;
      out.pos.x = P.x; out.pos.y = P.y; out.pos.z = P.z;
      out.target.x = P.x + Math.sin(yaw) * cp * D; out.target.y = P.y + Math.sin(pitch) * D; out.target.z = P.z + Math.cos(yaw) * cp * D;
      let vfo = vf;
      if ((sh.top3 || sh.topN) && ph === 'race') {
        const cnt = sh.topN ? (n > 2 && (H[order[0]].s || 0) - (H[order[2]].s || 0) <= sh.topN ? 3 : 2) : 3;   // topN: 3 番手は先頭から topN m 以内のときだけ（最後の低い真横は先頭 2〜3 頭が主役）
        const need = top3Need(P, yaw, pitch, H, n, sh.fin ? 0.92 : 0.88, cnt), tn = Math.tan(vf * D2R / 2);   // 低い真横（先頭が大きい）は端の余白を小さく
        if (sh.zin && need > tn * 0.97 && need <= tn * 1.06) {   // ゆっくり寄るショット: 端に近づいたら先回りしてなめらかに引く（いきなり引かない）
          const want = Math.log(Math.min(100, 2 * Math.atan(need * 1.06) * R2D)); st[4] = Math.min(want, st[4] + 1.0 * dt); if (st[5] < 0) st[5] = 0;
        } else if (need > tn) { vfo = Math.min(100, 2 * Math.atan(need) * R2D); st[4] = Math.log(vfo); if (st[5] < 0) st[5] = 0; }
      }
      out.fov = vfo;
      if (self.debug) self.dbg = { aimFov: +aim.fov.toFixed(2), fov: +vf.toFixed(2), dist: +aim.dist.toFixed(1), size: +sizeNow(sh).toFixed(3), rest: postRest == null ? null : +postRest.toFixed(3), yaw: +st[0].toFixed(3), aimYaw: +aim.yaw.toFixed(3) };   // 確認用
      }   // （L_SWING 以外）
      // --- 字幕 ---
      let label = '';
      if (ph === 'replay') label = 'REPLAY';
      else if (ph === 'winner') label = ctx.winFocus >= 0 ? '2着 ' + (ctx.winFocus + 1) + '番' : '1着 ' + ((ctx.winnerIdx >= 0 ? ctx.winnerIdx : order[0]) + 1) + '番' + (ctx.winPair ? ' → 2着 ' + (ctx.winPair[1] + 1) + '番' : '');
      else if (ph === 'race') {
        const dist = ctx.dist || 1000;
        if (!finishSeen && (L.s || 0) >= dist && n > 1) {
          finishSeen = true; const s2 = H[order[1]].s || 0;
          if ((L.s || 0) - s2 < 0.7) photoT = t;
        }
        if (photoT >= 0 && t - photoT < 2.2) label = 'PHOTO FINISH';
        else if (ctx.slow === true || (typeof ctx.slow === 'number' && ctx.slow < 0.7)) label = 'SLOW';
      }
      out.label = label;
      return out;
    };
    return self;
  }
  return { create, RIGS, SHOTS, STYLES, scheduled, setDefaultStyle: (s) => { if (STYLES[s]) DEFAULT_STYLE = s; } };
})();
