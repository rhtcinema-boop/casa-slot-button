/* casa BOAT（競艇）: 艇の進路を、発走前に最後まで決めておく部品。BOAT.Lines（ブラウザ）/ module.exports（node）。DOM にも three.js にも依存しない。
   2026-11-17。調査 ref/boat/research/09（方式の比較）で選んだ c 方式を、本物の寸法のコース（boat/course.js）と 02・08・01 の数字で作り直したもの。

   2026-11-17 3 回め: 線の形を、真上の固定カメラの実測（ref/boat/research/12_旋回の線の実測.md）に合わせて作り直した。横すべり・速さの形は 13 の実測。
   2026-11-17 4 回め: 3 回めの形（半径 22〜40m）は「単走の全速ターン」の実測を全部の型に当てはめた誤りだった（出口が列から 43〜56m まで流れ、本物の 2 倍）。
     レースの映像の実測（ref/boat/research/14_レースの旋回の半径.md。3 場・5 つのターン）で、どの型も半径 14〜25m・出口は列から 14〜25m に直した。
     横すべりも 14 の実測: 回り始めの 0.7 秒で艇はもう 100° 向きを変え（ずれ 約 70°）、そのまま 60〜75° のずれでマークを回り、出口を向いてから 約 2 秒かけてずれが消える。

   考え方
   1. 各艇に「自分の線」を 1 本引く（ワールド座標のなめらかな曲線。スタートの進入の筋 → 各ターン → ゴール → 1 マークを回って帰る）。
      ターンの形は「手前の直線（マークの列から w m）→ 半径 R1 の弧（マークにいちばん近い所まで。マークから a m）→ 半径 R2 の弧 → 出口の直線」。
      実測 14（レース）: 先マイは筋（列から 13m 前後）から半径 約 17m の弧で入り、マークの 2.1〜3.3m 向こうをかすめて、列から 約 21m へ出る。握って外を回る艇は半径 20〜25m・マークから 9〜12.6m。
      （実測 12 の「半径 約 31m・列から 36〜38m へ出る」は、だれもいない単走の全速ターン。レースの型には使わない。）
      形（R1・R2・a・w）は走りの計算（js/boat-model.js の describe の shape）が艇ごと・ターンごとに決める。線の長さで説明できる遅れは道のり、残りは速さ（run.speed）になっている。
   2. 艇は自分の線の上を、run.speed × V0 の速さで進む（ターン 1 つぶんの区間ごとに ±aMax まで速さを合わせ、足りない分は次の区間へ持ち越す。スタート線・ゴール線では run とぴったり合う）。
   3. 近い艇どうしは、線からの横のずれ e_i(t) で分ける。どちらが外かは前へ 1 回なぞって決め、ずれは 6 艇いっしょの二次計画でなめらかに解く（前を走る艇ほど線を守る）。
   4. 最後に全コマで船体の長方形どうしのすき間を測り、足りない所だけ直す。
   5. 艇の向きは「進む向き ＋ 横すべり」。横すべりは、進む向きがどれだけ回ったかで決まる実測の表（SLIP_TAB。山は約 74°）。立ち上がりは毎秒 125° まで（艇の向きは 0.7 秒で 約 100° 回る）。
   レース前は本物どおりの 100 秒（カットなし。PRE の説明と資料 15。plan.cuts は空、plan.segments に場面の名前と時刻）。

   使い方: const plan = BOAT.Lines.plan(race, run, info);  plan.at(t) → 艇ごとの { x, z, yaw, speed, accel（前後の加速度 m/s²）, turn, turnDir, slip（rad）, heading, phase, on }。plan.check() → 自己検査の数字。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.BOAT = root.BOAT || {}; root.BOAT.Lines = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DT = 1 / 60, HULL_L = 2.895, HULL_W = 1.316; // 船体（07・03。長さ 2.895m・幅 1.316m は coordinator の指定）
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, k) => a + (b - a) * k;
  const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const hash = function () { let h = 2166136261 >>> 0; for (let k = 0; k < arguments.length; k++) { const s = String(arguments[k]); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } h ^= 0x2c; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
  const rnd01 = function () { return (hash.apply(null, arguments) % 100003) / 100003; };

  /* ---------- 数字（出典つき。「仮」は資料に無い数字） ---------- */
  const CFG = {
    lanes: [13, 15.7, 18.2, 24.1, 27.5, 30.6], // スリットでの各コースの位置（マークの列から m）。01 ⑥-9（尼崎の実測。PRE.lanes と同じ）
    typeWide: 3,         // 型の幅の寸法をどれだけ広げるか m（映像の誤差 ±3m の上限）
    startSlope: 0.085,    // スタートから 1 マークの手前までに横へ寄せる傾きの上限（08 ④-3 のいちばん大きい値 0.11）
    laneHold: 40,        // スタート線からこの距離まで進入のコースのまま。02 ④-3 は 60m だが、6 コースが内へ寄せる01 ⑥-9「スタートのあと +3 秒まで z を変えない」（約 66m）
    winIn: 150, winOut: 150, winRamp: 45, // ターンの前後で速さに倍率をかける区間（入口の 100m 手前〜出口の 140m 先。両はし 40m でなめらかに）。スタート線・ゴール線（出口の 150m 先）は区間の外。仮
    fLeave: 50,          // フライングの艇がコースを離れる所（2 マークの入口の手前 m。boat-model.js の F_LEAVE と同じ。01 ④-2 は 40〜60m）
    marginW: 0.8,        // 横の余裕。直線の並走で中心 2.5m になる値（02 ⑦-6 規則 1 は 2.6m だが、スリットの実測の間 2.5〜2.7m（01 ⑥）で押し合わないように）
    marginL: 1.0,        // 前後の余裕（舳先と艫の間。02 ⑦-6 規則 1 は 0.8m。左右をなぞった時と解いたあとで前後の間が少し変わるので、1m 多く見込む）
    pathAllow: 0.10,     // 進路が線に対して傾く分の見込み rad。仮
    crossTaper: 0.1,     // 絞りまくりの艇が内の艇の前を横切る時だけ: 舳先どうしが 約 4.1m（艇の長さ ＋ 前後の余裕 1.0 ＋ これ）離れたら横切ってよい。実測 17 の 1 例は 5〜8m（±30%）。仮
    taper: 2.5,          // 前後がこの距離ぶん離れるあいだに、横の決まりをなめらかにゆるめる m（長くすると、前後に離れた艇が互いの線を横切れなくなる）。仮
    gapVar: 1.2,         // 並ぶ時の間合いのばらつき 0〜1.2m（等間隔に見せない）。仮
    wake: 3.5, wake0: 12, wake1: 22, cWake: 6, // 引き波よけ: 前の艇が 12m 以内なら航跡から横 3.5m（02 ⑦-5 は 4m 以上・08 は 3m 以上）。22m でゼロは仮
    stopAhead: 45,       // 止まった艇の何 m 手前からよけ始めるか。仮
    stopClear: 6.0,      // 止まった艇（転覆）からの間。02 ⑦-6 は 8m。マークぎわで帯が足りないので 6m。仮
    eps: 0.7, grace: 6, // 近づき始めた時、横がこれ以上ずれていればその並びのまま／離れても 0.33 秒は並びを覚える。仮
    adapt: false, adaptMin: 5, // describe の型が無い時だけ: 1 回めのあと、ターンの入口側・出口側で線からのずれの平均が 5m を超える艇だけ、型の寸法をその分だけ直して線を引き直す（型と位置関係が食い違った時の救い）。仮
    fitTol: 0.015, fitRounds: 0, fitScale: [0.8, 1.25], // 道のり合わせ: 線の長さのずれがこれを超えるターンだけ、回る大きさを変えて引き直す（2 回まで）。大きさの幅は仮
    outer: 3,            // 「時刻の割り付け → 左右 → ずれ」のくり返しの回数
    outerMore: 2, moreFix: 0, // 仕上げの検査ですき間が足りない時だけ、くり返しを足す回数・時刻の割り付けを動かさずにずれだけやり直す回数（2026-11-18。後者はふだん 0、作り直しを全部試しても不合格の時だけ 2 で作る＝ planGen）。計算の手順の回数で、本物の数字ではない（3,000 レースで不合格 0 になった最小の回数）
    sweepToSol: true,    // 仕上げの足しのくり返しで、左右を決めるなぞりの艇のばねを前の回の二次計画の解（E60）へ戻す（2026-11-18。false ＝ いつも線（0）へ戻す）
    st: 18,              // 計画の点の間隔（1/60 秒の枚数。18 ＝ 0.3 秒）
    wrRank: [12, 5, 2.5, 1.5, 1, 1], // 線へ戻る重みの倍率（その時の順位ごと。先頭ほど線からずれない）。仮
    wr: 0.5, wv: 1.0, wa: 5.0, wj: 0, // 二次計画の重み（線へ戻る・横の速さ・加速度・躍度）。仮
    c: 1e4, rounds: 1, newtonIter: 40, qpStop: 1e-5,
    abreast: 2.36,       // 並走（前後がほぼ重なる）の中心どうしの間の下限 m（02 ⑦-1 の最小 2.4m）
    shiftRate: 0.02, aMax: 0.06, // 速さの倍率の上限: 区間ごとの道のり合わせ ±4%・前後の調整 ±2%
    pressEase2: 40,      // 絞りの寄せ終わりを丸める長さ m（寄せ始めは実測 17 の ease 24m。寄せ終わりは入口の線へ戻る動きと重なるので長めに。仮）
    nearMark: 35,        // 1 周 1 マークの中心からこの距離 m の内では、艇どうしの間合いのばらつき（gapVar）を足さない。仮
    markClear: 3.0,      // 艇の中心がマークの中心に近づいてよい所 m（実測 14: 艇の中心はマークから 1.7〜3.3m を通る。マークの半径 0.55 ＋ 横すべり中の船体の張り出し 約 1.5 ＋ 余裕 → 3.0）
    clear: 0.30, repairMax: 2, shiftMax: 6, // 仕上げ: 船体のすき間がこれを割る所だけ直す（余裕を広げて作り直すのは 2 回まで、前後の調整は 6 回まで）
    backMax: 64,         // バック側で艇が出てよい所（マークの列から m。対岸は 70〜91m）。1 マークの出口で流れる艇のため
    inFrac: 0.25, eMax: 16,            // 線からのずれの上限 m
    vPost: 19, vPostTurn: 11.1, vPostBack: 14, // ゴール後: 22 → 19m/s、1 マークは底 40km/h、バックは 14m/s（02 ⑥-2）
    slipIn: 0.5, slipOut: 0.17, slipExit: 0.12, // 舳先の向き: 手前〜向こう側は内へ 20〜35°、後半 10° → 0、出口のあと外へ 5〜10°（02 ④-6）
    turnRate: 0.80,      // 旋回の強さ 1 にあたる「進む向き」の回る速さ rad/s（毎秒 46°。実測 14: レースの先マイは平均 毎秒 41〜61°）
    slipRise: 125, slipFall: 170, // 横すべりの角度が立ち上がる・戻る速さの上限 °/秒（実測 14: 艇の向きは回り始めの 0.4 秒で 37° → 104° ＝ 毎秒 約 170°。進む向きの分 毎秒 約 45° を引いて 125。戻る側は仮）
    slipPlan: 12,        // 線どうしの間（左右の決まり）を決める時に見込む横すべり °。仮
    slipLead: 8, slipTail: 45,    // 横すべりを許す区間: 弧の始まりの 8m 手前 〜 弧の終わりの 45m 先（直線で筋を変えるだけの時は艇を横に向けない）。仮
    smooth: 5.0,         // 線の曲がりの変わり目をならす幅（前後 m）。仮
    apexAdd: 0.7,       // ならすと向こう側が内へ寄る分を、あらかじめ外へ足す m
    leadLat: 1.5, vLine: 22, // 先頭が締める・内の艇が外へ出る時の横の加速度の上限 m/s²（08 ④-3 の案「ふだん 1.5」）と、その時に見込む速さ m/s（02 の表「直線の最高速 約 80km/h（22m/s）」）
    leadSpan: 150,       // 先頭が内へ締める長さ m（締め終わりの手前。約 7 秒。仮: 実測 21 は締め始めが未測定。横の加速度 1m/s² 前後に収まる長さ）
    behind: true,        // 1 周 1 マークで「内の艇の後ろを横切る」艇（走りの計算の shape.behind）を使う。作り直しの 2 回めからは false
    preT: 100, postT: 10, // レース前は本物どおり 100 秒（資料 15）
  };
  /* 進路の型（02 ④-2 の表。in40・in20 ＝手前 40・20m、R1 ＝マークの真横 u=0、a ＝向こう側 u=0.5、R2 ＝出口 u=1、o30・o60・o120 ＝出口のあと、settle ＝直線で落ち着く位置）
     u=0.25・0.75 の数字は使わない（丸い U 字にすると決まる）。B・F の R2 は表の 7・6 を 10・9.5 に広げた（向きの回る速さを 08 の線に寄せるため。仮）。E・G の o120 は表の 28・26 を 31・28 に（出口から戻る傾きを 08 の線に寄せるため。仮） */
  const TYPE = {
    A: { in40: 14, in20: 15, R1: 12, a: 3, R2: 15, o30: 21, o60: 23, o120: 18, settle: 18 },  // 先マイ・単走の先頭
    B: { in40: 16, in20: 17, R1: 15, a: 3, R2: 10, o30: 10.5, o60: 10.5, o120: 10.5, settle: 11 },  // 差し
    C: { in40: 20, in20: 19, R1: 17, a: 9, R2: 22, o30: 27, o60: 28, o120: 22, settle: 22 },  // まくり
    D: { in40: 22, in20: 21, R1: 18, a: 5, R2: 10, o30: 12, o60: 13, o120: 13, settle: 13 },  // まくり差し
    E: { in40: 26, in20: 26, R1: 24, a: 15, R2: 28, o30: 34, o60: 36, o120: 31, settle: 26 }, // 外マイ
    F: { in40: 18, in20: 18, R1: 16, a: 2.5, R2: 9.5, o30: 10, o60: 9.5, o120: 9, settle: 9 },   // 最内差し
    G: { in40: 14, in20: 15, R1: 12, a: 6, R2: 24, o30: 31, o60: 33, o120: 28, settle: 24 },  // 飛ぶ（まくられた・流れた）
    AG: { in40: 14, in20: 15, R1: 12, a: 3, R2: 24, o30: 31, o60: 33, o120: 28, settle: 24 }, // 先に回ったが出口で流れる（02 ④-3 差し・まくり差しの 1 コース）
    P: { in40: 16, in20: 16, R1: 14, a: 6, R2: 17, o30: 21, o60: 22, o120: 18, settle: 18 },  // ゴール後の 1 マーク（A のゆるい版。頂点 6m。02 ⑥-2）
  };

  /* レース前（ピット離れ〜待機行動〜助走）の通る点の表。2026-11-17 2 回め の作り直し（オーナー「本物どおり全部（約 100 秒）を見せる」「ブイを回る動き・待つ位置と起こし・スタートの瞬間が本物と違う」）:
     **カットなし・早回しなしの 100 秒**。数字は ref/boat/research/15_待機行動の実測.md（スタンドの上のカメラの絵を、目印から水面の座標に直して 1〜3 秒おきに読んだ表）。
     本物の形（15 で分かったこと。01 ⑥ の「ブイの先へ 1 列で 60m 進む」は誤りだった）:
       ① ピット離れ: 合図で 6 艇がいっせいに出て、2 マークのスタンド側へ（約 5 m/s² で 17.5 m/s まで。尼崎 95m を 7.2 秒・住之江 140m を 10.9 秒）
       ② ブイ: 消波装置のスタンド側を斜めの列（外の艇ほど前・外）で通り、ブイを過ぎたらすぐ左へ切って **マークの列を横切り、対岸の方（−z）へ扇形に走る**。
          1 コースはブイのすぐ先で小さく U ターン（幅 約 12m）、6 コースは列から 50m 奥まで行く（尼崎: −88 秒に列を横切り、−82 秒に z = −49）
       ③ バック: 6 艇とも 2 マークの方（−x）へ向き、消波装置と平行に **斜めの雁行**（1 コースが消波装置のすぐ脇 z = −3、外の艇ほど奥で、しかも前）で、0.5〜1 m/s の微速で流れる
       ④ 2 マーク: スローは 2 マークの円すいのすぐ奥で左へ回って舳先をスタート線へ。ダッシュは回らずにピットの前まで行き、大きく左へ回って戻る
       ⑤ 待つ: スローは 2 マークの真横で 1 m/s 前後で流れる（1 コースは消波装置のすぐ脇 z = +3.5 を、ブイの方へ流れていく。住之江: −23 秒 x = −147 → −8 秒 −132）。ダッシュは x = −215〜−225 で 1.2 m/s
       ⑥ 起こし〜スリット: 位置と時刻は走りの計算（js/boat-model.js の runup）のとおり（大時計の 0 で run の位置・速さとつながる）
     rows ＝ [本物の時刻（大時計の 0 までの秒）, x, z]。「進入のコース」ごと。x・z は course.js の座標（2 マーク −150・ブイ −130 は本物と同じ）。
     印: buoy の表は尼崎の実測（位置の誤差 ±2m。艇どうしが近い所は、艇の幅ぶん離して置き直した）。turn2 のスローは 尼崎 −43 秒と 住之江 −23 秒の実測の点をつないだ形（途中は中継がアップで測れない＝仮）。
         ダッシュの奥の U ターンは、入口（尼崎 −43 秒）と出口（住之江 −23 秒）が実測、途中の半円と時刻は仮（尼崎 −33〜−28 秒にピットの桟橋の前にいるのは絵で確かめた）。 */
  const PRE = {
    T: 100,              // 待機行動の長さ（尼崎 100.4 秒・住之江 99.9 秒。01 ⑥）
    pitOut: -99.4,       // 合図の時刻（尼崎 −100.4・住之江 −99.9。ゲームのピットは 2 マークの 112m 奥なので、ブイに着くのが尼崎より 2.5 秒おそい → shift。桐生は −87.2 秒、住之江は −89 秒にブイ）
    pit: { x: -262, z0: 4.75, gap: 2.9, acc: 5.0, accIn: 6.5, accLate: 3.0, dec: 4.0 }, // ピット（venue3d.js の桟橋と同じ場所。1 号艇が対岸寄り）。加速 5 m/s²（尼崎 95m を 7.2 秒・住之江 140m を 10.9 秒に合う）・減速 4 m/s²（仮）。巡航の速さは、ブイの手前の表の点に時刻どおり着くように決まる（約 16〜17 m/s）
    lead: 0,             // 前付けの艇の動き出し: 合図と同時（ほかの艇は 0〜react 秒おくれる）。前は 0.3 秒で、合図より前に動き出していた。強い加速 accIn と合わせて、合図の 2 秒後に 1〜2 艇身前（01 ⑥-9 (B)「半艇身〜1 艇身出る」。仮）
    /* ピット離れの反応のばらつき（2026-11-17 6 回め。オーナー「1 号艇から順番に出ているのがおかしい。普通は一斉に飛び出る」）:
       前は「となりとの差 0〜0.15 秒・内が前」を毎レース同じ順の時間差として入れていて、いつも 1 → 6 号艇の順に動き出していた。
       公式の映像 5 レース（鳴門 2 本・津 2 本・江戸川。0.2 秒おき。資料 19 の 1 章）で、動き出す時刻（しぶきが立つコマ）は 6 艇とも 0.2〜0.6 秒の幅に入り、
       内が先という決まった順は無かった（鳴門の強風の日・津の向かい風の日は 6 号艇がいちばん先、ほかの 3 本は 1 コマ（0.2 秒）の中でそろった）。
       → 艇ごとに 0〜react 秒のおくれを、レースごと・艇ごとのくじで決める（順番は毎回ちがう）。加速の強さも艇ごとに ±accVar の割合でばらつく（出足の差。量は仮） */
    react: 0.4, accVar: 0.1, yieldT: 0.25, // yieldT ＝ 前付けの艇に前を横切られる艇の、出だしのゆずり（仮。前付けの艇が前を横切る間、船体を詰めすぎない）
    lateT: 0.5, lateArrive: 1.5, // 出おくれ型（丸亀 G2 の 3 号艇: 合図の 2.5 秒後に 3 艇身・7 秒後に約 25m おくれ、外の 4・5 号艇が内へ詰めて進入 124536）: 出るのが 0.5 秒おそく、加速が弱く、ブイにも 1.5 秒おくれて着く
    shift: 2.5, shiftEnd: [-79, -61], // buoy の表の時刻をこの秒だけ後ろへ（ピットが遠い分）。−79〜−61 秒のあいだに 0 へ戻す
    seg: [['pit', -100, -93], ['buoy', -93, -79], ['back', -79, -43], ['turn2', -43, -24], ['wait', -24, -12.5], ['runup', -12.5, 0]], // 場面の名前と時刻（カメラ用）
    waitZ: [3.5, 14, 21.5, 31, 38, 43], waitZslow4: 27.5, // 舳先を向けて待つ時の z。1〜3 コースは住之江（+3・+14・+27）と尼崎（+3・+19・+24。01 ⑥）の間。ダッシュは住之江（+40・+49・+54）をスリットの幅の比（尼崎 17.6m ÷ 住之江 27m）で縮めた値（仮）
    drift: 1.5,          // 起こす時の「流れている速さ」が消えるまでの秒（仮）
    /* ② ブイ〜③ バック（尼崎の実測。時刻は尼崎の秒。0〜5 ＝ 進入の 1〜6 コース） */
    buoy: [
      [[-92.2, -142.5, 4.2], [-91.2, -137, 3.6], [-90.2, -132, 3.5], [-89.2, -127.5, 3.3], [-88.2, -124.5, 2], [-87.2, -122.5, 0.5], [-86.2, -121.5, -1.5], [-85.2, -122, -4], [-83.2, -124, -7], [-81.2, -125.5, -8.2], [-79.2, -127.3, -8.3], [-76.2, -129.3, -7.3], [-74.2, -130.8, -6.4], [-70.2, -133, -4.8], [-67.2, -134.6, -3.9], [-61.2, -139, -3.1], [-55.2, -143.5, -3], [-49.2, -147, -3], [-43.2, -152, -3]],
      [[-92.2, -136.5, 7.6], [-91.2, -128, 5.8], [-90.2, -123.5, 2.5], [-89.2, -120.5, -1.5], [-88.2, -119.5, -5.5], [-87.2, -119, -8.5], [-86.2, -119.5, -10.5], [-85.2, -121.5, -12.5], [-83.2, -124, -16], [-81.2, -127, -17.5], [-78.2, -129, -16], [-74.2, -132, -13], [-70.2, -135, -10.5], [-67.2, -138, -10], [-61.2, -144, -11], [-55.2, -149, -11], [-49.2, -153, -10], [-43.2, -159, -10]],
      [[-92.2, -134, 10.4], [-91.2, -125, 8.6], [-90.2, -120.3, 4.6], [-89.2, -117, -0.8], [-88.2, -115.5, -6.5], [-87.2, -114.5, -10.5], [-86.2, -114.5, -13.5], [-85.2, -117, -17], [-83.2, -120, -20.5], [-81.2, -122.5, -22.5], [-78.2, -126, -23], [-74.2, -131.5, -22.5], [-70.2, -135.5, -19.5], [-67.2, -138, -17.5], [-61.2, -145, -16.5], [-55.2, -152, -15.5], [-49.2, -158.5, -12], [-43.2, -164, -6.5]],
      [[-92.2, -132.5, 13.3], [-91.2, -123, 11.3], [-90.2, -117.5, 6.8], [-89.2, -113.7, 0.5], [-88.2, -111.8, -7], [-87.2, -111, -13], [-86.2, -111.5, -18], [-85.2, -114.5, -22], [-83.2, -120.5, -26.5], [-81.2, -124.5, -28.5], [-78.2, -128, -28.5], [-74.2, -134.5, -28], [-70.2, -140, -26.5], [-67.2, -143, -24.5], [-61.2, -149.5, -21.5], [-55.2, -157, -21], [-49.2, -162, -18], [-43.2, -168, -14]],
      [[-92.2, -130, 16.2], [-91.2, -120, 14], [-90.2, -114.2, 9.2], [-89.2, -109.8, 2.5], [-88.2, -108, -6], [-87.2, -107, -14], [-86.2, -108, -21], [-85.2, -112, -27], [-83.2, -119, -31.5], [-81.2, -124, -33.5], [-78.2, -128, -33.5], [-74.2, -135, -33.5], [-70.2, -140.5, -32.5], [-67.2, -145, -31.5], [-61.2, -151, -28.5], [-55.2, -159, -26.5], [-49.2, -164, -23.5], [-43.2, -171, -21]],
      [[-92.2, -131, 19.6], [-91.2, -121, 19], [-90.3, -111.5, 16.6], [-89.5, -104.8, 11.3], [-88.7, -101.8, 3.5], [-88.2, -101.3, -2.5], [-87.2, -101, -13], [-86.2, -101, -22], [-85.2, -106, -33], [-83.2, -117, -46], [-82.2, -122, -49], [-81.2, -128, -51], [-79.2, -133, -50.5], [-76.2, -137, -47.5], [-74.2, -142, -46.5], [-70.2, -148, -44.5], [-67.2, -154, -44], [-64.2, -160, -44], [-61.2, -167, -44.5], [-58.2, -174, -44.5], [-55.2, -181, -44], [-49.2, -194, -43], [-43.2, -207, -42]]],
    /* ④ スローの 2 マークの回り（−43.2 の続き。4 つめはスローが 4 艇の時の 4 コース。仮）。最後の点が「舳先を向けた所」 */
    slow: [
      [[-39, -155.5, -2.2], [-35.5, -157, 0.5], [-32, -155.5, 3], [-28, -152, 3.6], [-23, -147, 3.5]],
      [[-39, -162.5, -6.5], [-35.5, -164, 0], [-32, -162.5, 6], [-28.5, -159.5, 10.5], [-25, -157, 12.3], [-23, -155.5, 13]],
      [[-39, -168.5, -5], [-35.5, -172, 0], [-32, -173, 7], [-28.5, -170.5, 13.5], [-25, -166.5, 18], [-23, -163.5, 19.8]],
      [[-39, -174.5, -10.5], [-35.5, -180, -3], [-32, -181.5, 6.5], [-28.5, -179.5, 15.5], [-25, -175, 22], [-23, -172, 24.5]]],
    /* ④ ダッシュの奥の U ターン: t0 ＝ 引き始める時刻、t1 ＝ 回り終える時刻、tf ＝ 舳先を向けて流れ始める時刻。形は「角の丸い コ の字」: バック側を −x へ直進 → 半径 r の 1/4 円 → ピットの桟橋の前（x = cx − r）を +z へ直進 → 1/4 円 → +x 向き。
       入口（尼崎 −43 秒）と出口（住之江 −23 秒）は実測。尼崎 −33〜−28 秒に 6・5・4 号艇が桟橋の前に 1 列でいるのは絵で確かめた。半径と途中の時刻は仮 */
    dash: [{ t0: -40, t1: -25.3, tf: -23.1 }, { t0: -41.5, t1: -25.8, tf: -23.6 }, { t0: -43.2, t1: -26.3, tf: -24.1 }], dashCx: -225, dashR: 22, dashXf: -220,
    deepFace: -40,       // 前付けでスローが深くなるレース（race.deep）: スローは −40 秒にはもう舳先を向け、起こし（スタート線の 100m 手前）まで流される（01 ⑥-9 (B)。本物の映像の実測はまだ無い＝仮）
    sep: 0.45, sepFrom: -96, sepTo: -3.5, // 仕上げ: 船体のすき間がこれ（m）を割る所は、2 艇を少しずつ離す（−96〜−3.5 秒のあいだだけ。前後 1.2 秒かけてなめらかに）
    lanes: [13, 15.7, 18.2, 24.1, 27.5, 30.6], // スリットの位置（尼崎の実測◎○。CFG.lanes と同じ）
  };

  /* 横すべり（艇の向き − 進む向き）【実測 14 の 4 章。レースの 4 つのターンの先頭の艇】: 進む向きが φ° 回った時（手前の直線の向きを 0°）の横すべり °。
     艇は進む向きがまだ 15〜25° しか変わらないうちに 約 100° まで向きを変え（0.7 秒）、そのあと ずれ 60〜75°（読み取りでは 55〜100°・誤差 ±20°）のままマークを回る。
     艇の向きが出口の 10° 以内になるのは φ ≒ 105°（回り始めの 約 2.2 秒後）で、その時のずれは 約 65°。1 秒後に 約 35〜55°、2 秒後に 20° 以下、あとは出口の直線で消える。
     実測の中央の値: φ 40〜80° で 75〜80、100° で 67、115° で 60、135° で 45、145° で 38、155° で 30、165° で 17、173° で 14。山は 74° に置いた（尼崎 60〜75°、ほかの場 75〜100°）。
     φ 0〜6° は 0（直線で筋を変えるだけの時は横を向かない）。立ち上がりの速さは CFG.slipRise で抑える。
     （3 回めの表は単走 1 人ぶんで、頭が低く（φ 44° で 36°）、山が φ 110° の 1 点だった。後ろ半分は今回の実測とほぼ同じ。） */
  const SLIP_TAB = [[0, 0], [6, 0], [10, 28], [16, 60], [24, 74], [80, 74], [100, 67], [115, 60], [135, 46], [145, 37], [155, 28], [165, 17], [173, 10], [180, 0]];
  function slipDeg(phi) { if (!(phi > 0)) return 0; if (phi >= 180) return 0; let k = 0; while (k < SLIP_TAB.length - 2 && phi > SLIP_TAB[k + 1][0]) k++; const a = SLIP_TAB[k], b = SLIP_TAB[k + 1]; return a[1] + (b[1] - a[1]) * (phi - a[0]) / (b[0] - a[0]); }
  // 進む向き (tx, tz) が、ターン tk（偶数＝第 1 マーク）の手前の直線の向きから何度回ったか（0〜180）
  function turnedDeg(tx, tz, tk) { const d = tk % 2 === 0 ? 1 : -1; let a = Math.atan2(-tz * d, tx * d) * 180 / Math.PI; if (a < -90) a += 360; return clamp(a, 0, 180); }
  // 横すべりを許す区間の重み 0〜1（線 b の上の道のり L、ターン tk）: 弧の始まりの slipLead m 手前から立ち上がり、弧の終わりの slipTail m 先で 0
  function slipGate(b, tk, L) { const a0 = b.arc0[tk], a1 = b.arc1[tk]; if (a0 == null || a1 == null) return 0; return sm((L - (a0 - CFG.slipLead)) / CFG.slipLead) * sm((a1 + CFG.slipTail - L) / (CFG.slipTail * 0.5)); }
  /* ---------- 小さな数学の部品 ---------- */
  // 3 次の自然スプライン（節点 u[k] で値 y[k]。2 階微分 m を返す）
  function splineM(u, y) {
    const n = u.length, m = new Float64Array(n), c = new Float64Array(n), d = new Float64Array(n);
    for (let k = 1; k < n - 1; k++) {
      const h0 = u[k] - u[k - 1], h1 = u[k + 1] - u[k], den = 2 * (h0 + h1) - h0 * c[k - 1];
      c[k] = h1 / den; d[k] = (6 * ((y[k + 1] - y[k]) / h1 - (y[k] - y[k - 1]) / h0) - h0 * d[k - 1]) / den;
    }
    for (let k = n - 2; k >= 1; k--) m[k] = d[k] - c[k] * m[k + 1];
    return m;
  }
  function splineAt(u, y, m, k, uu) { const h = u[k + 1] - u[k], a = (u[k + 1] - uu) / h, b = (uu - u[k]) / h; return a * y[k] + b * y[k + 1] + ((a * a * a - a) * m[k] + (b * b * b - b) * m[k + 1]) * h * h / 6; }
  // 一様な 3 次 B スプライン（制御点 c、位置 u）
  function bspline(c, u) {
    const N = c.length, k = Math.floor(u), s = u - k, g = (q) => c[q < 0 ? 0 : q >= N ? N - 1 : q], s2 = s * s, s3 = s2 * s, m1 = 1 - s;
    return (m1 * m1 * m1 * g(k - 1) + (3 * s3 - 6 * s2 + 4) * g(k) + (-3 * s3 + 3 * s2 + 3 * s + 1) * g(k + 1) + s3 * g(k + 2)) / 6;
  }
  // 向きのある長方形どうしのすき間（分離軸。正＝離れている、負＝めり込みの深さ）
  function obbGap(ax, az, afx, afz, bx, bz, bfx, bfz, hl, hw) {
    const dx = bx - ax, dz = bz - az; let best = -1e9;
    for (let k = 0; k < 4; k++) {
      const ux = k === 0 ? afx : k === 1 ? -afz : k === 2 ? bfx : -bfz, uz = k === 0 ? afz : k === 1 ? afx : k === 2 ? bfz : bfx;
      const pa = hl * Math.abs(afx * ux + afz * uz) + hw * Math.abs(-afz * ux + afx * uz), pb = hl * Math.abs(bfx * ux + bfz * uz) + hw * Math.abs(-bfz * ux + bfx * uz);
      const g = Math.abs(dx * ux + dz * uz) - pa - pb; if (g > best) best = g;
    }
    return best;
  }

  /* ---------- 二次計画（帯行列・罰つきニュートン法。調査 09 の qp.js と同じ解き方） ----------
     変数 x[k * n + i]（時刻の点 k・艇 i の「線からのずれ」）。
     最小化 Σ wr x² + wv (差分/h)² + wa (2 階差分/h²)² + wj (3 階差分/h³)²
     かたい条件 rows: ca·x[a] + cb·x[b] ≥ rhs、上下限 lo ≤ x ≤ hi（lo = hi は固定）
     やわらかい条件 soft: Σ4 項 ≥ rhs（破った分の 2 乗 × cSoft） */
  function* solveQPGen(o) {
    const n = o.n, N = o.N, h = o.h, M = n * N, bw = (o.wj > 0 ? 3 : 2) * n, bw1 = bw + 1, c = o.c || 1e4, cPin = c * 1e3, cB = c * 30, maxIter = o.maxIter || 40; // cB: 岸・マーク・消波装置の上下限は、艇どうしの決まりより 30 倍強く守る（はさまれてもマークへ押し込まれない）
    const Pb = new Float64Array(M * bw1), Kb = new Float64Array(M * bw1);
    const add = (A, a, b, v) => { if (a < b) { const t = a; a = b; b = t; } A[a * bw1 + (a - b)] += v; };
    const ih2 = 1 / (h * h), ih4 = ih2 * ih2, ih6 = ih4 * ih2;
    const sten = (i, k, off, co, wgt) => { for (let a = 0; a < co.length; a++) for (let b = 0; b <= a; b++) add(Pb, (k + off + a) * n + i, (k + off + b) * n + i, wgt * co[a] * co[b]); };
    for (let i = 0; i < n; i++) for (let k = 0; k < N; k++) {
      Pb[(k * n + i) * bw1] += o.wr[i][k];
      if (k + 1 < N) sten(i, k, 0, [-1, 1], o.wv[i][k] * ih2);
      if (k >= 1 && k + 1 < N) sten(i, k, -1, [1, -2, 1], o.wa * ih4);
      if (o.wj > 0 && k >= 1 && k + 2 < N) sten(i, k, -1, [-1, 3, -3, 1], o.wj * ih6);
    }
    const lo = new Float64Array(M), hi = new Float64Array(M), pin = new Uint8Array(M);
    for (let i = 0; i < n; i++) for (let k = 0; k < N; k++) { const v = k * n + i; lo[v] = o.lo[i][k]; hi[v] = o.hi[i][k]; if (lo[v] > hi[v]) { const m = (lo[v] + hi[v]) / 2; lo[v] = hi[v] = m; } pin[v] = hi[v] - lo[v] < 1e-9 ? 1 : 0; }
    const lo0 = lo.slice(), hi0 = hi.slice();
    const R = o.rows, R2 = R.n, ra = R.a, rb = R.b, ca = R.ca, cb = R.cb, rhs0 = R.rhs, rhs = Float64Array.from(rhs0.subarray(0, R2)), sh = new Float64Array(R2);
    const SF = o.soft, S4 = SF ? SF.n : 0, cS = o.cSoft || 6;
    const x = new Float64Array(M), g = new Float64Array(M), dx = new Float64Array(M), tmp = new Float64Array(M), xn = new Float64Array(M);
    if (o.x0) for (let i = 0; i < n; i++) for (let k = 0; k < N; k++) x[k * n + i] = o.x0[i][k];
    for (let v = 0; v < M; v++) if (pin[v]) x[v] = lo[v];
    const Pmul = (xx, out) => {
      for (let r = 0; r < M; r++) { let s = Pb[r * bw1] * xx[r]; const c0 = r > bw ? r - bw : 0, rb1 = r * bw1 + r; for (let cc = c0; cc < r; cc++) s += Pb[rb1 - cc] * xx[cc]; out[r] = s; }
      for (let r = 0; r < M; r++) { const c0 = r > bw ? r - bw : 0, xr = xx[r], rb1 = r * bw1 + r; for (let cc = c0; cc < r; cc++) out[cc] += Pb[rb1 - cc] * xr; }
    };
    const fval = (xx) => {
      Pmul(xx, tmp); let f = 0;
      for (let v = 0; v < M; v++) { f += 0.5 * xx[v] * tmp[v]; const cc = pin[v] ? cPin : cB; if (xx[v] < lo[v]) { const e = lo[v] - xx[v]; f += 0.5 * cc * e * e; } else if (xx[v] > hi[v]) { const e = xx[v] - hi[v]; f += 0.5 * cc * e * e; } }
      for (let r = 0; r < R2; r++) { const e = rhs[r] - (ca[r] * xx[ra[r]] + cb[r] * xx[rb[r]]); if (e > 0) f += 0.5 * c * e * e; }
      for (let r = 0; r < S4; r++) { const b = 4 * r, e = SF.rhs[r] - (SF.c[b] * xx[SF.v[b]] + SF.c[b + 1] * xx[SF.v[b + 1]] + SF.c[b + 2] * xx[SF.v[b + 2]] + SF.c[b + 3] * xx[SF.v[b + 3]]); if (e > 0) f += 0.5 * cS * e * e; }
      return f;
    };
    let f0 = fval(x), nAct = -1, sig = -1, total = 0;
    const rounds = o.rounds == null ? 1 : o.rounds;
    for (let round = 0; round <= rounds; round++) {
      if (round > 0) { // 残った破れの分だけ条件を上乗せして解き直す（乗数法）
        let worst = 0;
        for (let r = 0; r < R2; r++) { const val = ca[r] * x[ra[r]] + cb[r] * x[rb[r]], e0 = rhs0[r] - val; if (e0 > worst) worst = e0; sh[r] = Math.max(0, sh[r] + (rhs[r] - val)); rhs[r] = rhs0[r] + sh[r]; }
        for (let v = 0; v < M; v++) { if (pin[v]) continue; const e1 = lo0[v] - x[v], e2 = x[v] - hi0[v]; if (e1 > worst) worst = e1; if (e2 > worst) worst = e2; lo[v] = lo0[v] + Math.max(0, lo[v] - lo0[v] + (lo[v] - x[v])); hi[v] = hi0[v] - Math.max(0, hi0[v] - hi[v] + (x[v] - hi[v])); if (lo[v] > hi[v]) lo[v] = hi[v] = (lo[v] + hi[v]) / 2; }
        if (worst < 2e-3) break;
        f0 = fval(x); nAct = -1;
      }
      for (let it = 1; it <= maxIter; it++) {
        yield; total++; Kb.set(Pb); Pmul(x, g); let act = 0, sg = 0;
        for (let v = 0; v < M; v++) {
          const cc = pin[v] ? cPin : cB;
          if (pin[v]) { Kb[v * bw1] += cc; g[v] += cc * (x[v] - lo[v]); }
          else if (x[v] < lo[v]) { Kb[v * bw1] += cc; g[v] -= cc * (lo[v] - x[v]); act++; sg = (sg * 31 + v) | 0; }
          else if (x[v] > hi[v]) { Kb[v * bw1] += cc; g[v] += cc * (x[v] - hi[v]); act++; sg = (sg * 31 + v + 7) | 0; }
        }
        for (let r = 0; r < R2; r++) { const a = ra[r], b = rb[r], e = rhs[r] - (ca[r] * x[a] + cb[r] * x[b]); if (e > 0) { Kb[a * bw1] += c * ca[r] * ca[r]; Kb[b * bw1] += c * cb[r] * cb[r]; Kb[(a > b ? a : b) * bw1 + Math.abs(a - b)] += c * ca[r] * cb[r]; g[a] -= c * e * ca[r]; g[b] -= c * e * cb[r]; act++; sg = (sg * 31 + r + 13) | 0; } }
        for (let r = 0; r < S4; r++) { const b = 4 * r, e = SF.rhs[r] - (SF.c[b] * x[SF.v[b]] + SF.c[b + 1] * x[SF.v[b + 1]] + SF.c[b + 2] * x[SF.v[b + 2]] + SF.c[b + 3] * x[SF.v[b + 3]]); if (e > 0) { act++; sg = (sg * 31 + r + 29) | 0; for (let u = 0; u < 4; u++) { g[SF.v[b + u]] -= cS * e * SF.c[b + u]; for (let v = 0; v <= u; v++) add(Kb, SF.v[b + u], SF.v[b + v], cS * SF.c[b + u] * SF.c[b + v]); } } }
        for (let r = 0; r < M; r++) { const c0 = r > bw ? r - bw : 0, rb1 = r * bw1 + r; for (let cc = c0; cc <= r; cc++) { let s = Kb[rb1 - cc]; const m0 = cc - bw > c0 ? cc - bw : c0, cb1 = cc * bw1 + cc; for (let m = m0; m < cc; m++) s -= Kb[rb1 - m] * Kb[cb1 - m]; if (cc === r) Kb[r * bw1] = Math.sqrt(s > 1e-12 ? s : 1e-12); else Kb[rb1 - cc] = s / Kb[cc * bw1]; } }
        for (let r = 0; r < M; r++) { let s = -g[r]; const c0 = r > bw ? r - bw : 0, rb1 = r * bw1 + r; for (let cc = c0; cc < r; cc++) s -= Kb[rb1 - cc] * dx[cc]; dx[r] = s / Kb[r * bw1]; }
        for (let r = M - 1; r >= 0; r--) { let s = dx[r]; const c1 = r + bw < M - 1 ? r + bw : M - 1; for (let cc = r + 1; cc <= c1; cc++) s -= Kb[cc * bw1 + (cc - r)] * dx[cc]; dx[r] = s / Kb[r * bw1]; }
        let al = 1, f1 = 0, mx = 0;
        for (let ls = 0; ls < 12; ls++) { for (let v = 0; v < M; v++) xn[v] = x[v] + al * dx[v]; f1 = fval(xn); if (f1 <= f0 + 1e-12 * Math.abs(f0)) break; al *= 0.5; }
        for (let v = 0; v < M; v++) { const d = Math.abs(xn[v] - x[v]); if (d > mx) mx = d; x[v] = xn[v]; }
        const same = act === nAct && sg === sig; nAct = act; sig = sg; f0 = f1;
        if (mx < (o.stop || 1e-5) || (same && al === 1 && mx < 1e-3)) break;
      }
    }
    const out = []; for (let i = 0; i < n; i++) { const a = new Float64Array(N); for (let k = 0; k < N; k++) a[k] = x[k * n + i]; out.push(a); }
    return { x: out, iters: total };
  }

  /* ---------- 自分の線（ワールド座標の曲線）を作る ---------- */
  /* ターンの線の形【実測 14】（ref/boat/research/14_レースの旋回の半径.md）: 手前の直線（マークの列から w m）→ 半径 R1 の弧（マークにいちばん近い所まで。マークの中心から a m）
     → 半径 R2 の弧 → 出口の直線（列から wOut m）。レースの実測は 半径 14〜25m・a 1.7〜12.6m・出口 14〜25m。
     走りの計算（js/boat-model.js の TUNE.shape と turnGeom・shapeOf）と同じ表・同じ式（describe の shape が来ればそれを使う。来ない時だけこの表）。wo のある型は R ＝（w ＋ wo）÷ 2。 */
  const SHAPE = [
    { A: { R1: 19, R2: 16, a: 3, dw: 0 }, B: { wo: 17, a: 3, dw: 2 }, C: { wo: 24, a: 9, dw: 0 }, D: { wo: 19, a: 3, dw: 1 }, E: { wo: 25, a: 12, dw: 0 }, F: { R1: 20, R2: 26, a: 3.5, dw: 0 }, G: { R1: 17, R2: 26, a: 5, dw: 0 } },
    { A: { wo: 19, a: 3, dw: 2, w0: 20 }, B: { wo: 14, a: 3, dw: 3, w0: 19 }, C: { wo: 20, a: 8, dw: 6, w0: 22 }, D: { wo: 15, a: 3, dw: 3, w0: 19 }, E: { wo: 22, a: 14, dw: 9, w0: 21 }, F: { wo: 12, a: 3, dw: 1, w0: 21 }, G: { wo: 19, a: 5, dw: 2, w0: 20, k1: 1, k2: 1.45 } }, // 2 個目から: 入る位置 ＝ 前の出口 ＋ dw
  ];
  SHAPE[0].AG = SHAPE[0].G; SHAPE[1].AG = SHAPE[1].G;
  const SHAPE_P = { R1: 22, R2: 24, a: 6, w: 24 }; // ゴール後の 1 マーク（02 ⑥-2 の「頂点 6m」。弧の大きさは単走の先頭の形より少しゆるく。仮）
  const R_MIN = 15; // wo から決める半径の下限（boat-model.js の TUNE.rMin と同じ）
  function shapeOf(S, w) { if (S.wo == null) return S; const R = Math.max(R_MIN, (w + S.wo) / 2, S.a + 1 + Math.abs(w - S.a) / 2); return { R1: Math.max(R * (S.k1 || 1.1), (w + S.a) / 2 + 1), R2: R * (S.k2 || 0.9), a: S.a }; }
  // 形から弧の中心・出口・道のり（座標はマークが原点。p ＝ 進む向きでマークの向こうが +、q ＝ 手前の直線の側が +）
  function turnGeom(R1, R2, a, w) {
    w = clamp(w, a + 0.5, 2 * R1 - a - 0.5);
    const qc = w - R1, pc = -Math.sqrt(Math.max(0, (R1 - a) * (R1 - a) - qc * qc)), thm = Math.atan2(-pc, -qc);
    const c2p = pc + (R1 - R2) * Math.sin(thm), c2q = qc + (R1 - R2) * Math.cos(thm), wOut = R2 - c2q;
    return { w, pc, qc, thm, c2p, c2q, wOut, geo: R1 * thm + R2 * (Math.PI - thm) + pc + c2p };
  }
  function defaultShape(type, k, lane, prevOut) { const SB = (SHAPE[k === 0 ? 0 : 1][type]) || SHAPE[1].A, w = k === 0 ? clamp(SB.w == null ? lane + (SB.dw || 0) : SB.w, lane - 9, lane + 9) : clamp((prevOut == null ? SB.w0 : prevOut) + (SB.dw || 0), 10, 40), S = shapeOf(SB, w); return { R1: S.R1, R2: S.R2, a: S.a, w: turnGeom(S.R1, S.R2, S.a, w).w }; }
  // ターン 1 回ぶんの節点。M＝マーク、dir＝手前の直線で x の進む向き、side＝手前の直線の z の符号。from ＝ { p, w }: 手前の直線のどこから（p）どの位置（w）で来るか
  function turnNodes(out, M, dir, side, S, k, from) {
    const g = turnGeom(S.R1, S.R2, S.a, S.w), P = (p, q, apex, arc) => out.push({ x: M.x + dir * p, z: side * q, apex: apex ? k : -1, arc: arc || 0, k });
    // 手前の直線: 前のターンの出口の位置（1 周 1 マークは進入の筋）から、このターンの入り方の位置へ、直線 1 本ぶんかけてなめらかに移る
    const p0 = from.p, p1 = g.pc - 4, n = Math.max(2, Math.round((p1 - p0) / 14));
    if (from.fn) { const n2 = Math.max(2, Math.round((p1 - p0) / 7)); for (let j = 1; j <= n2; j++) { const p = p0 + (p1 - p0) * j / n2; P(p, j === n2 ? g.w : from.fn(M.x + dir * p)); } } // 展開（絞り）のある艇: 横の位置の時刻表どおり（節を 7m おきに細かく）
    else if (k > 0 && (S.aim === 'lead' || S.aim === 'yield') && S.hold && -S.hold - p0 > 60) { // 'yield' ＝ 先頭より内を走ってきた艇が、同じ所で外へ出る
      /* 2026-11-17 狙いの線（走りの計算の shape.aim ＝ 'lead'）: 先頭は 2 マーク（2 周 1 マーク）の hold m 手前（実測 21: 約 5 秒前 ＝ 100m）までに、内の入る位置へ締め終える。
         締め始めは出口の 40m 先か、締め終わりの CFG.leadSpan m 手前の遅いほう（未測定のため仮。鳴門のまくりは出口から 3〜9 秒は筋のまま）。締め終わりから弧の入口までは筋のまま */
      let pe = Math.min(p1 - 6, -S.hold), ps = Math.max(p0 + 40, pe - CFG.leadSpan); const m = Math.max(3, Math.round((p1 - p0) / 10));
      /* 2026-11-18: 寄せる長さの下限。なめらかな寄せ（sm）の横の加速度のいちばん大きい所は 6 × 寄せる幅 × 速さ² ÷ 長さ²。これが CFG.leadLat（1.5 m/s²）を超えない長さ Lmin を取る:
         まず寄せ始めを前へ（出口の 10m 先まで。【仮】資料に無い。出口の直後は向きがそろう所なので 10m だけ空けた）広げ、それでも足りず、外へ出る艇（'yield'）の時だけ締め終わりを先へ延ばす（先頭（'lead'）の締め終わりは延ばさない＝ マークの手前で外に残さない）。
         走りの計算の hold が出口のすぐ近く（例 220m 手前 ＝ 出口の 64m 先）の時、寄せる区間が 24m しか取れず、直線で横の加速度 13 m/s² の急な横移動になっていた（フライングの種 1033） */
      const Lmin = Math.sqrt(6 * Math.abs(g.w - from.w) * CFG.vLine * CFG.vLine / CFG.leadLat);
      if (pe - ps < Lmin) { ps = Math.max(p0 + 10, Math.min(ps, pe - Lmin)); if (pe - ps < Lmin && S.aim === 'yield') pe = Math.min(p1 - 6, ps + Lmin); }
      for (let j = 1; j <= m; j++) { const p = p0 + (p1 - p0) * j / m; P(p, from.w + (g.w - from.w) * sm((p - ps) / Math.max(1, pe - ps))); }
    }
    else for (let j = 1; j <= n; j++) { const t = j / n; P(p0 + (p1 - p0) * t, from.w + (g.w - from.w) * sm(t)); }
    const stp = Math.PI / 30; let done = false;
    for (let j = 0; j <= 30; j++) {
      const th = j * stp, first = th <= g.thm, R = first ? S.R1 : S.R2, cp = first ? g.pc : g.c2p, cq = first ? g.qc : g.c2q;
      P(cp + R * Math.sin(th), cq + R * Math.cos(th), j === 15, j === 0 ? 1 : j === 30 ? 2 : 0); done = true;
    }
    return { p: g.c2p, w: g.wOut, g };
  }
  function buildBase(nodes) {
    const n = nodes.length, u = new Float64Array(n), xs = new Float64Array(n), zs = new Float64Array(n);
    for (let k = 0; k < n; k++) { xs[k] = nodes[k].x; zs[k] = nodes[k].z; if (k) u[k] = u[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]); }
    const mx = splineM(u, xs), mz = splineM(u, zs), du = 0.25, nd = Math.ceil(u[n - 1] / du) + 1, px = new Float64Array(nd), pz = new Float64Array(nd), cl = new Float64Array(nd), apexU = [];
    let seg = 0;
    for (let q = 0; q < nd; q++) { const uu = Math.min(u[n - 1], q * du); while (seg < n - 2 && uu > u[seg + 1]) seg++; px[q] = splineAt(u, xs, mx, seg, uu); pz[q] = splineAt(u, zs, mz, seg, uu); if (q) cl[q] = cl[q - 1] + Math.hypot(px[q] - px[q - 1], pz[q] - pz[q - 1]); }
    const ds = 0.5;
    // 道のりで等間隔に取り直す → 曲がりの変わり目をなだらかにする（前後 4m の平均を 2 回＝向きの回る速さが急に立ち上がらない。08 ④-3）→ もう一度等間隔に
    const resample = (qx, qz, qc) => { const nn = qx.length, L = qc[nn - 1], m = Math.floor(L / ds) + 1, ox = new Float64Array(m), oz = new Float64Array(m); let q = 0; for (let g = 0; g < m; g++) { const s = g * ds; while (q < nn - 2 && qc[q + 1] < s) q++; const f = (s - qc[q]) / Math.max(1e-9, qc[q + 1] - qc[q]); ox[g] = qx[q] + (qx[q + 1] - qx[q]) * f; oz[g] = qz[q] + (qz[q + 1] - qz[q]) * f; } return [ox, oz]; };
    const box = (a, w) => { const m = a.length, o = new Float64Array(m), pre = new Float64Array(m + 1); for (let g = 0; g < m; g++) pre[g + 1] = pre[g] + a[g]; for (let g = 0; g < m; g++) { const h = Math.min(w, g, m - 1 - g); o[g] = (pre[g + h + 1] - pre[g - h]) / (2 * h + 1); } return o; };
    let [sx, sz] = resample(px, pz, cl); const W = Math.round(CFG.smooth / ds);
    sx = box(box(sx, W), W); sz = box(box(sz, W), W);
    const c2 = new Float64Array(sx.length); for (let g = 1; g < sx.length; g++) c2[g] = c2[g - 1] + Math.hypot(sx[g] - sx[g - 1], sz[g] - sz[g - 1]);
    const rs = resample(sx, sz, c2), bx = rs[0], bz = rs[1], ng = bx.length, tx = new Float64Array(ng), tz = new Float64Array(ng), kp = new Float64Array(ng);
    for (let g = 0; g < ng; g++) { const a = g > 0 ? g - 1 : 0, b = g < ng - 1 ? g + 1 : g, dx = bx[b] - bx[a], dz = bz[b] - bz[a], l = Math.hypot(dx, dz) || 1; tx[g] = dx / l; tz[g] = dz / l; }
    for (let g = 0; g < ng; g++) { const a = g > 0 ? g - 1 : 0, b = g < ng - 1 ? g + 1 : g; kp[g] = -(tx[a] * tz[b] - tz[a] * tx[b]) / ((b - a) * ds); } // 左回りに曲がる向きを正
    // 各ターンの「向こう側」（x がいちばん先へ出る点）の番号
    const apex = [];
    for (let k = 0; k < n; k++) if (nodes[k].apex >= 0) { const L = cl[Math.min(nd - 1, Math.round(u[k] / du))]; let g0 = Math.min(ng - 1, Math.round(L / ds)), best = g0; const dir = nodes[k].apex % 2 === 0 ? 1 : -1; for (let g = Math.max(0, g0 - 40); g <= Math.min(ng - 1, g0 + 40); g++) if (dir * bx[g] > dir * bx[best]) best = g; apex[nodes[k].apex] = best; }
    // 各ターンの弧の始まり・終わりの道のり m（横すべりを許す区間を決めるのに使う）
    const arc0 = [], arc1 = [];
    for (let k = 0; k < n; k++) if (nodes[k].arc) { const L = cl[Math.min(nd - 1, Math.round(u[k] / du))] * (c2[c2.length - 1] / Math.max(1e-9, cl[nd - 1])); (nodes[k].arc === 1 ? arc0 : arc1)[nodes[k].k] = L; }
    return { ds, ng, len: (ng - 1) * ds, bx, bz, tx, tz, kp, apex, arc0, arc1 };
  }
  const NT = (C) => 2 * (C.LAPS || 2);
  // 艇 1 つの線の節点（スタート前の助走の線から、ゴール後に 1 マークを回って帰るまで）。shapes[k] ＝ k 個目のターンの形 { R1, R2, a, w }
  function boatNodes(C, lane, shapes, opt) {
    const nodes = [], nt = NT(C), M1 = C.MARK1, M2 = C.MARK2, P = (x, z) => nodes.push({ x, z, apex: -1 });
    P(-105, lane); P(-70, lane); P(-35, lane); P(0, lane); P(CFG.laneHold, lane);
    const count = opt.scratch ? 1 : nt + (opt.post ? 1 : 0);
    let from = { p: CFG.laneHold - M1.x, w: lane, fn: opt.approach || null }, last = null;
    for (let k = 0; k < count; k++) {
      const even = k % 2 === 0, M = even ? M1 : M2, dir = even ? 1 : -1, side = even ? 1 : -1, S = shapes[k] || SHAPE_P; // ゴール後の 1 マーク（k = nt）は SHAPE_P
      const r = turnNodes(nodes, M, dir, side, S, k, from); last = { M, dir, side, r };
      from = { p: -(C.MARK_GAP + r.p) + 6, w: r.w }; // 次のターンから見た、この出口の場所（弧の終わりの 6m 先から次の位置へ移り始める）
      nodes.push({ x: M.x + dir * (r.p - 6), z: -side * r.w, apex: -1 });
    }
    const o = last.r.w, ex = last.M.x + last.dir * last.r.p, dx = -last.dir, sz = -last.side;
    if (opt.scratch) { [[60, 0], [-35, 1], [-100, 2], [-150, 6], [-200, 12], [-235, 15], [-256, 16]].forEach((a) => { if (a[0] < ex - 20) nodes.push({ x: a[0], z: -Math.min(63, o + a[1]), apex: -1 }); }); } // フライングの艇: バックを走り、2 マークの手前で外へ離れてピットの方へ抜ける（01 1-10）
    else { nodes.push({ x: ex + dx * 120, z: sz * o, apex: -1 }); nodes.push({ x: ex + dx * 200, z: sz * o, apex: -1 }); }
    return nodes;
  }

  /* ---------- 型を当てる（BoatModel.describe の lines が無い時の仮の決め方。02 ④-3・④-5 の規則） ---------- */
  function assignTypes(ctx) {
    const n = ctx.n, C = ctx.C, nt = NT(C), types = [], crs = ctx.course, st = ctx.stSec;
    for (let i = 0; i < n; i++) types.push(new Array(nt).fill('A'));
    const byCourse = []; crs.forEach((c, i) => { byCourse[c] = i; });
    const exitRank = (k) => { const sig = ctx.E[k] + C.TURN_LEN, tt = []; for (let i = 0; i < n; i++) { let f = 0; const a = ctx.SR[i]; while (f < ctx.F - 1 && a[f] < sig) f++; tt.push(ctx.out[i] ? 1e9 + i : f + (sig - a[Math.max(0, f - 1)]) / Math.max(1e-6, a[f] - a[Math.max(0, f - 1)]) - 1); } const ord = tt.map((_, i) => i).sort((p, q) => tt[p] - tt[q]), rk = []; ord.forEach((i, r) => { rk[i] = r; }); return { rk, ord, tt }; };
    // 1 周 1 マーク
    const x0 = exitRank(0), W = x0.ord[0], cW = crs[W];
    const innerMin = (c) => { let m = 9; for (let q = 0; q < c; q++) m = Math.min(m, st[byCourse[q]]); return m; };
    let kim = 'nige';
    if (cW === 1) kim = st[W] < st[byCourse[0]] - 0.05 ? 'makuri' : 'sashi';
    else if (cW === 2 || cW === 3) kim = st[W] < innerMin(cW) - 0.05 ? 'makuri' : 'makurizashi';
    else if (cW >= 4) kim = st[W] < innerMin(cW) - 0.08 ? 'makuri' : 'makurizashi';
    for (let i = 0; i < n; i++) {
      const c = crs[i], r = x0.rk[i]; let t;
      if (kim === 'nige') t = c === 0 ? 'A' : c === 1 ? 'B' : c === 2 ? (r <= 2 ? 'D' : 'C') : c === 3 ? (r <= 3 ? 'B' : 'E') : c === 4 ? 'E' : 'F';
      else if (kim === 'sashi') t = i === W ? 'B' : c === 0 ? 'AG' : c === cW + 1 ? 'C' : c < cW ? 'F' : c === 5 ? 'F' : 'E';
      else if (kim === 'makuri') t = i === W ? 'C' : c === 0 ? 'G' : c === cW - 1 ? 'G' : c === cW + 1 ? 'D' : c < cW ? 'B' : 'E';
      else t = i === W ? 'D' : c === 0 ? 'AG' : c === cW - 1 ? 'B' : c === cW + 1 ? 'E' : c === 5 ? 'F' : c < cW ? 'B' : 'E';
      if (r >= 3 && (t === 'A' || t === 'C')) t = 'G'; // 出口で 4 位以下なのに先マイ・まくりの型 → 流れた型に
      if (r === 1 && t === 'E') t = 'D';
      types[i][0] = t;
    }
    // 2 個目からのターン（02 ④-5）: 先頭は A。前の艇と 3 艇身以内なら内から差す（B）か外を握る（C）。離れていれば A。最後尾は E か F に散らす
    for (let k = 1; k < nt; k++) {
      const sig = ctx.E[k] - 30, inn = [], f0 = (() => { let f = 0, best = 1e9; for (let i = 0; i < n; i++) { if (ctx.out[i]) continue; let q = 0; const a = ctx.SR[i]; while (q < ctx.F - 1 && a[q] < sig) q++; best = Math.min(best, q); } return best >= 1e9 ? 0 : best; })();
      const d = []; for (let i = 0; i < n; i++) d.push(ctx.SR[i][f0]);
      const ord = d.map((_, i) => i).filter((i) => !ctx.out[i] || ctx.fallBoat === i).sort((p, q) => d[q] - d[p]), xr = exitRank(k).rk;
      ord.forEach((i, r) => {
        let t = 'A';
        if (r > 0) {
          const p = ord[r - 1], gap = d[p] - d[i], prevOut = TYPE[types[i][k - 1]].o120, prevOutP = TYPE[types[p][k - 1]].o120;
          if (gap <= 9) { if (prevOut <= prevOutP) { t = 'B'; if (xr[i] < xr[p] && (types[p][k] === 'A')) types[p][k] = 'AG'; } else t = 'C'; }
          else if (r >= ord.length - 2 && ord.length >= 5) t = rnd01('tail', ctx.seed, i, k) < 0.5 ? 'E' : 'F';
        }
        types[i][k] = t;
      });
    }
    return { types, kimarite: kim, winner1M: W };
  }

  /* ---------- run を 1/60 秒ごとに読む ---------- */
  function sampleRun(ctx, race, run, info) {
    const C = ctx.C, n = ctx.n = race.horses.length, DIST = C.DIST;
    const fin = (run.finishTimes ? run.finishTimes.slice() : null), outA = Array.from(run.out || new Array(n).fill(false));
    ctx.inc = run.incident || (info && info.incident) || null;
    const dur = run.duration || 80; ctx.duration = dur; ctx.t1 = dur + ctx.postT; ctx.F = Math.ceil(ctx.t1 / DT) + 2;
    ctx.SR = []; ctx.VR = []; for (let i = 0; i < n; i++) { ctx.SR.push(new Float64Array(ctx.F)); ctx.VR.push(new Float64Array(ctx.F)); }
    const fdet = new Array(n).fill(0), V0 = (info && info.V0) || 19.4; // run.speed は「基準の速さ 19.4m/s の何倍か」（boat-model.js の V0）
    for (let f = 0; f < ctx.F; f++) { run.seek(f * DT); for (let i = 0; i < n; i++) { ctx.SR[i][f] = run.pos[i] * DIST; ctx.VR[i][f] = (run.speed[i] || 0) * V0; if (!fdet[i] && run.pos[i] >= 1) fdet[i] = f * DT; } }
    ctx.fin = []; ctx.finOk = []; ctx.out = outA.map(Boolean);
    for (let i = 0; i < n; i++) { const t = fin ? fin[i] : fdet[i]; ctx.finOk.push(!ctx.out[i] && t > 0 && t < 200); ctx.fin.push(ctx.finOk[i] ? t : 1e9); }
    ctx.scratchBoat = ctx.inc && ctx.inc.type === 'scratch' ? ctx.inc.horse : -1; ctx.fallBoat = ctx.inc && ctx.inc.type === 'fall' ? ctx.inc.horse : -1;
    ctx.fallT = run.fallT != null ? run.fallT : null;
    const entry = (info && info.entry) || run.entry || race.entry || race.horses.map((_, i) => i);
    ctx.course = (info && Array.isArray(info.course) && info.course) || (info && Array.isArray(info.courses) && info.courses) || race.horses.map((_, i) => Math.max(0, entry.indexOf(i))); // 各艇の進入のコース（0 が最内）
    ctx.v0 = []; ctx.stSec = [];
    for (let i = 0; i < n; i++) { const v = Math.max(8, (ctx.SR[i][2] - ctx.SR[i][0]) / (2 * DT)); ctx.v0.push(v); ctx.stSec.push(info && info.st ? info.st[i] : -ctx.SR[i][0] / v); }
    ctx.E = []; for (let k = 0; k < NT(C) + 1; k++) ctx.E.push((k % 2 === 0 ? C.LS - C.FINISH_S : 2 * C.LS + C.TURN_LEN - C.FINISH_S) + Math.floor(k / 2) * C.L); // 各ターンの入口（スタート線からの基準の道のり）
  }
  // 基準の道のり → 直線の上の x
  function xOfSig(C, sig) { const s = ((C.FINISH_S + sig) % C.L + C.L) % C.L; return s < C.LS + C.TURN_LEN / 2 ? C.MARK2.x + Math.min(s, C.LS + 40) : C.MARK1.x - (s - C.LS - C.TURN_LEN); }

  /* ---------- 線の上の場所 ---------- */
  function baseAt(b, ell, o) { // 格子の点のあいだは 3 次のエルミート補間（位置も向きもなめらかにつながる。横へずらした線の向きが段々にならない）
    let g = ell / b.ds; if (g < 0) g = 0; if (g > b.ng - 1.001) g = b.ng - 1.001; const k = Math.floor(g), t = g - k, t2 = t * t, t3 = t2 * t, ds = b.ds;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2, d00 = 6 * t2 - 6 * t, d10 = 3 * t2 - 4 * t + 1, d11 = 3 * t2 - 2 * t;
    o.x = h00 * b.bx[k] + h01 * b.bx[k + 1] + ds * (h10 * b.tx[k] + h11 * b.tx[k + 1]); o.z = h00 * b.bz[k] + h01 * b.bz[k + 1] + ds * (h10 * b.tz[k] + h11 * b.tz[k + 1]);
    let tx = d00 * (b.bx[k] - b.bx[k + 1]) / ds + d10 * b.tx[k] + d11 * b.tx[k + 1], tz = d00 * (b.bz[k] - b.bz[k + 1]) / ds + d10 * b.tz[k] + d11 * b.tz[k + 1]; const l = Math.hypot(tx, tz) || 1;
    o.tx = tx / l; o.tz = tz / l; o.kp = b.kp[k] + (b.kp[k + 1] - b.kp[k]) * t; return o;
  }
  // 枝 br（br 個目の「向こう側」の手前まで。x が一方向に進む区間）の上で、x がねらいの値になる道のり
  function ellAtX(b, br, x, e) {
    const g0 = br > 0 && b.apex[br - 1] != null ? b.apex[br - 1] : 0, g1 = b.apex[br] != null ? b.apex[br] : b.ng - 1, dir = br % 2 === 0 ? 1 : -1;
    let lo = g0, hi = g1, tgt = x;
    for (let pass = 0; pass < 3; pass++) {
      lo = g0; hi = g1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (dir * b.bx[m] <= dir * tgt) lo = m; else hi = m; }
      if (!e || pass === 2) break;
      const d0 = b.bx[hi] - b.bx[lo], fr = Math.abs(d0) > 1e-9 ? clamp((tgt - b.bx[lo]) / d0, 0, 1) : 0;
      tgt = x + e * (b.tz[lo] + (b.tz[hi] - b.tz[lo]) * fr); // 横へずれている分（N = (−tz, tx)）だけ、線の上のねらいを直す
    }
    const d = b.bx[hi] - b.bx[lo]; return (lo + (Math.abs(d) > 1e-9 ? clamp((tgt - b.bx[lo]) / d, 0, 1) : 0)) * b.ds;
  }

  /* ---------- 時刻 → 自分の線の上の道のり（直線は run のとおり、ターンの前後は速さをなめらかに増減） ---------- */
  function retime(ctx, i) {
    const C = ctx.C, SR = ctx.SR[i], b = ctx.base[i], e = ctx.E60[i], ell = ctx.ELL[i], F = ctx.F, nt = NT(C), o = {};
    const scr = i === ctx.scratchBoat, fall = i === ctx.fallBoat;
    let fEnd = F - 1;
    if (ctx.finOk[i]) fEnd = Math.min(F - 1, Math.floor(ctx.fin[i] / DT));
    else if (scr) { const lim = ctx.E[1] - CFG.fLeave - 2; fEnd = 0; while (fEnd < F - 1 && SR[fEnd + 1] < lim && (SR[fEnd + 1] > SR[fEnd] || fEnd < 60)) fEnd++; }
    const de = (f) => (e[Math.min(F - 1, f + 1)] - e[Math.max(0, f - 1)]) / (2 * DT);
    const rate = (f, v, L) => { baseAt(b, L, o); const d = de(f), fac = Math.max(0.35, 1 + o.kp * e[f]); return Math.sqrt(Math.max(v * v - d * d, 0.25 * v * v)) / fac; };
    const ratio = ctx.ratio[i]; ratio.fill(1);
    const kMax = scr ? 1 : nt, shift = new Array(nt + 1).fill(0), need = new Array(nt + 1).fill(0); let f = 0, k = 0, carry = false; const fb0 = -1;
    /* 1 回め: 前から順に（A を ±aMax に抑え、足りない分は次へ持ち越す）。最後の区間で A が ±aMax を超える時は、
       超える分をあらかじめ前の区間で稼いでおく（shift[k] ＝ 区間 k の終わりで run の位置より先に出ておく m）ことにして、もう 1 回だけやり直す */
    let limK = CFG.aMax;
    for (let round = 0; round < 3; round++) {
    f = 0; k = 0; carry = false; ratio.fill(1);
    while (f <= fEnd) {
      const sig = SR[f];
      if (k < kMax && sig >= (k === 0 ? 0 : ctx.E[k] - CFG.winIn)) {
        /* ターン 1 つぶんの区間（前の直線のまん中〜次の直線のまん中。1 個目はスタート線から、最後はゴール線の 4m 手前まで）。
           艇は自分の線の上を、走りの計算の速さ（run.speed × V0）× (1 + A × bump) で進む。A は「区間の終わりで run と同じ場所に着く」ように決めるが、
           ±aMax（4.5%）までに抑える。足りない分は次の区間へ持ち越す（直線のまん中で run の位置から数 m ずれる。ゴール線・スタート線では必ず合う） */
        const sa = k === 0 ? 0 : ctx.E[k] - CFG.winIn, last = k === kMax - 1 && !scr, sb = last ? C.DIST - 4 : ctx.E[k] + C.TURN_LEN + CFG.winOut;
        const fa = f; if (!carry) ell[fa] = ellAtX(b, k, xOfSig(C, sig), e[fa]);
        let fb = -1; for (let q = fa + 1; q <= fEnd; q++) if (SR[q] >= sb) { fb = q; break; }
        const bump = (s) => sm((s - sa) / CFG.winRamp) * sm((sb - s) / CFG.winRamp);
        const VR = ctx.VR[i], go = (A, end) => { let L = ell[fa]; for (let q = fa; q < end; q++) { const v = VR[q + 1] > 0 || SR[q + 1] > SR[q] ? VR[q + 1] : 0, kk = 1 + A * bump(SR[q]); L += rate(q, v * kk, L) * DT; ell[q + 1] = L; ratio[q] = kk === 1 ? 0.99999 : kk; } return L; };
        if (fb < 0) { go(0, fEnd); if (fall) for (let q = fEnd; q < F - 1; q++) ell[q + 1] = ell[q]; f = F; break; }
        const target = ellAtX(b, k + 1, xOfSig(C, SR[fb]), e[fb]) + (last ? 0 : shift[k]);
        let A0 = 0, L0 = go(A0, fb), sum = 0; for (let q = fa; q < fb; q++) sum += VR[q + 1] * DT * bump(SR[q]);
        const lim = last ? 0.5 : limK;
        let A1 = clamp((target - L0) / Math.max(1, sum), -lim, lim), L1 = go(A1, fb);
        for (let it = 0; it < 3 && Math.abs(L1 - target) > 0.02 && Math.abs(A1) < lim - 1e-9; it++) { const A2 = A1 + (target - L1) * (A1 - A0) / ((L1 - L0) || 1e-9); A0 = A1; L0 = L1; A1 = clamp(A2, -lim, lim); L1 = go(A1, fb); }
        const res = target - L1, span = fb - fa;
        if (Math.abs(res) < 0.5) { for (let q = fa + 1; q <= fb; q++) ell[q] += res * sm((q - fa) / span); carry = !last && Math.abs(shift[k]) > 1e-6; } // 残りの数 cm をなめらかに配る
        else carry = true;                                                                                                // 持ち越し
        if (last && carry) { for (let q = fa + 1; q <= fb; q++) ell[q] += res * sm((q - fa) / span); carry = false; }
        need[k] = last ? (Math.abs(A1) > limK ? (A1 - Math.sign(A1) * limK) * sum : 0) : 0;
        ctx.winA[i][k] = A1; ctx.winS[i][k] = sum; ctx.winRes[i][k] = carry ? res : 0; f = carry ? fb : fb + 1; k++;
        if (k >= kMax && carry) { for (let q = fa + 1; q <= fb; q++) ell[q] += res * sm((q - fa) / span); carry = false; f = fb + 1; } // 区間の後に持ち越す先が無い時（フライングの艇）は、残りをこの区間でなめらかに配る（配らずに捨てると、次のコマで線の上の場所が飛んでいた）
      } else { ell[f] = ellAtX(b, Math.min(k, scr ? 1 : nt + 1), xOfSig(C, sig), e[f]); f++; }
      if (scr && fb0 < 0 && f > fEnd) break;
    }
    if (round === 2 || scr || !ctx.finOk[i]) break;
    const X = need[kMax - 1]; if (!(Math.abs(X) > 0.3)) break;
    // 最後の区間で足りない分 X を、前の区間で先に稼いでおく（区間 q の終わりで run の位置より shift[q] m 先に出る）。前の区間にも余地が無ければ、上限を全部の区間で同じだけ上げる
    let rest = X, ss = 0; for (let q = kMax - 2; q >= 0 && Math.abs(rest) > 0.05; q--) { const room = Math.max(0, limK - Math.sign(rest) * ctx.winA[i][q]) * ctx.winS[i][q] * 0.9, take = Math.sign(rest) * Math.min(Math.abs(rest), room); for (let j = q; j <= kMax - 2; j++) shift[j] += take; rest -= take; }
    for (let q = 0; q < kMax; q++) ss += ctx.winS[i][q]; if (Math.abs(rest) > 0.3) limK += Math.abs(rest) / Math.max(1, ss) * 1.1;
    }
    if (f >= F) return;
    // run の外: ゴール後（全速のまま 1 マークを回って帰る）／フライングの艇（全速で 1 マークとバックを走り、外へ抜ける）／転覆（その場に止まる）
    if (ctx.finOk[i]) {
      const tf = ctx.fin[i], fe = fEnd, vf = Math.max(10, (SR[fe] - SR[Math.max(0, fe - 2)]) / (2 * DT)), Lf = ellAtX(b, nt, 0, e[Math.min(F - 1, fe + 1)]), ap = (b.apex[nt] != null ? b.apex[nt] : b.ng) * b.ds;
      const vp = (L) => { const d = L - Lf, da = ap - L; let v = vf > CFG.vPost ? lerp(vf, CFG.vPost, sm((d - 10) / 90)) : vf; if (da > 0 && da < 45) v = Math.min(v, CFG.vPostTurn + (CFG.vPost - CFG.vPostTurn) * sm(da / 45)); else if (da <= 0) v = Math.min(v, CFG.vPostTurn + (CFG.vPostBack - CFG.vPostTurn) * sm(-da / 40)); return v; };
      let L = Lf + rate(fe, vf, Lf) * ((fe + 1) * DT - tf); if (fe + 1 < F) ell[fe + 1] = L;
      for (let q = fe + 1; q < F - 1; q++) { L = Math.min(b.len - 1, L + rate(q, vp(L), L) * DT); ell[q + 1] = L; }
    } else if (scr) { // run の続きの速さから、線の終わり（ピットの方）へ向けてなめらかに止める
      const vs = Math.max(8, ctx.VR[i][fEnd] || 20), vfree = (L) => { const dEnd = b.len - L; return Math.min(vs, vs * (0.15 + 0.85 * sm((dEnd - 3) / 110))) * (dEnd < 3 ? 0 : 1); };
      let L = ell[fEnd]; for (let q = fEnd; q < F - 1; q++) { L = Math.min(b.len - 1, L + rate(q, vfree(L), L) * DT); ell[q + 1] = L; }
    } else for (let q = Math.max(0, f - 1); q < F - 1; q++) ell[q + 1] = ell[q];
  }
  // 1/60 秒ごとの線の上の場所・向き・曲がり・速さ、ずれの上下限
  function geometry(ctx) {
    const C = ctx.C, n = ctx.n, F = ctx.F, o = {}, hl = HULL_L / 2, hw = HULL_W / 2;
    for (let i = 0; i < n; i++) {
      const b = ctx.base[i], G = ctx.G[i], ell = ctx.ELL[i], nt = NT(C);
      for (let f = 0; f < F; f++) {
        baseAt(b, ell[f], o); G.x[f] = o.x; G.z[f] = o.z; G.tx[f] = o.tx; G.tz[f] = o.tz; G.kp[f] = o.kp;
        const v = (ell[Math.min(F - 1, f + 1)] - ell[Math.max(0, f - 1)]) / ((Math.min(F - 1, f + 1) - Math.max(0, f - 1)) * DT); G.v[f] = v;
        // 舳先の向きのずれ（内へ）の大きさ → 船体が横へ張り出す量
        const g = ell[f] / b.ds; let kn = 0; while (kn < b.apex.length && b.apex[kn] != null && b.apex[kn] < g) kn++; G.kn[f] = kn;
        const apN = b.apex[kn] != null ? b.apex[kn] * b.ds : 1e9, apP = kn > 0 && b.apex[kn - 1] != null ? b.apex[kn - 1] * b.ds : -1e9, tk = ell[f] - apP < apN - ell[f] ? kn - 1 : kn;
        const al = Math.min(CFG.slipPlan * Math.PI / 180, slipDeg(turnedDeg(o.tx, o.tz, tk)) * slipGate(b, tk, ell[f]) * Math.PI / 180 * clamp((v - 4) / 6, 0, 1)) + CFG.pathAllow; // 線どうしの間を決める時は、横すべりを slipPlan ° までしか見込まない（それより深い角度は、world() が近い艇を見て決める）
        G.lat[f] = hw * Math.cos(al) + hl * Math.sin(al); G.lon[f] = hl * Math.cos(al) + hw * Math.sin(al);
        G.str[f] = Math.abs(o.tz) < 0.3 ? clamp((C.MARK1.x - 25 - Math.abs(o.x)) / 25, 0, 1) : 0;
        // ずれの上下限: 岸・マーク・消波装置・ブイから離す。線の外向き N = (−tz, tx)
        let lo = -CFG.eMax, hi = CFG.eMax; const nx = -o.tz, nz = o.tx;
        if (o.kp > 0.008) lo = Math.max(lo, -CFG.inFrac / o.kp); // 曲がりの中心へ寄りすぎない（内へずらせるのは回る半径の 25% まで＝向きの回る速さが上がりすぎない）
        if (o.kp < -0.008) hi = Math.min(hi, CFG.inFrac / -o.kp);
        /* マーク: 線から外へ e ずらした点がマークの中心から markClear 以上 ＝ |D ＋ e N| ≥ r を e について解いた外側の根（D ＝ マーク → 線の点）。
           2026-11-18 直し: 前は (r − d) ÷ gg（gg ＝ D と N の向きのそろい 0.3〜1）で、gg が小さい所（マークの斜め手前・向こう）で下限が 3 倍に跳ね、艇を外へ押し出していた */
        for (let m = 0; m < 2; m++) { const M = m ? C.MARK2 : C.MARK1, dx = o.x - M.x, dz = o.z - M.z, d = Math.hypot(dx, dz), r = CFG.markClear, dn = dx * nx + dz * nz, disc = dn * dn + r * r - d * d; if (d < 40 && dn > 0 && disc >= 0) lo = Math.max(lo, -dn + Math.sqrt(disc)); } // dn > 0 ＝ マークが内側。disc < 0 ＝ 横へずらしてもマークの円に届かない
        const sz = o.z >= 0 ? 1 : -1, lim = (o.z >= 0 ? C.shoreZ(o.x) : -C.farZ(o.x)) - 3.5, cz = nz * sz;
        if (cz > 0.3) hi = Math.min(hi, (Math.min(lim, (o.z >= 0 ? C.RO : CFG.backMax) + (i === ctx.scratchBoat ? 6 : 0)) - Math.abs(o.z)) / cz); // ホーム側は艇の通れる外の端（course.js の RO）、バック側は対岸まで広いので backMax まで
        /* 第 2 マーク〜小回り防止ブイの消波装置（x が 2 マークからブイの 4m 先まで、z ＝ 0 の上）。2026-11-18 直し: 前は 2 マークの 3m 向こう（x −153〜−150。消波装置の無い所）まで入れていたため、
           2 マークを小さく回る艇（頂点がマークから 3m）の線が z ＝ 0 を横切る所で下限が 8m 余りに跳ね、先頭の艇を 8〜10m 外へ押し出していた（フライングの種 1028 の 15m の遅れの元）。2 マークの向こう側はマークの決まり（上）が守る */
        if (cz > 0.3 && o.x > C.MARK2.x && o.x < C.BUOY.x + 4 && Math.abs(o.z) < 3.0) lo = Math.max(lo, (3.0 - Math.abs(o.z)) / cz);
        if (cz > 0.3 && Math.abs(o.x) < C.MARK1.x) lo = Math.max(lo, (C.RI - Math.abs(o.z)) / cz);
        if (lo > 0) lo = Math.min(lo, hi); if (hi < 0) hi = Math.max(hi, lo);
        G.lo[f] = Math.min(lo, hi); G.hi[f] = Math.max(lo, hi);
      }
    }
  }

  /* ---------- 前へ 1 回なぞる: 「どちらが外か」を決める（決めたら変えない）＋ 引き波よけの側 ---------- */
  function reach(pairs, n, from, to, skip) {
    const seen = new Uint8Array(n), stk = [to]; seen[to] = 1;
    while (stk.length) { const a = stk.pop(); if (a === from) return true; for (let p = 0; p < pairs.length; p++) { if (p === skip) continue; const P = pairs[p]; if (!P.sgn) continue; const o = P.sgn > 0 ? P.i : P.j, q = P.sgn > 0 ? P.j : P.i; if (q === a && !seen[o]) { seen[o] = 1; stk.push(o); } } }
    return false;
  }
  function* sweepGen(ctx) {
    const n = ctx.n, F = ctx.F, G = ctx.G, C = ctx.C, nt = NT(C);
    const cur = new Float64Array(n), vel = new Float64Array(n), prev = new Float64Array(n), mob = new Float64Array(n), px = new Float64Array(n), pz = new Float64Array(n), stopped = new Uint8Array(n);
    const PX = ctx.PX, PZ = ctx.PZ, ES = ctx.ES;
    const pairs = ctx.pairs = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pairs.push({ i: a, j: b, W: new Float32Array(F), S: new Int8Array(F), s0: new Float32Array(F), ci: new Float32Array(F), cj: new Float32Array(F), WW: new Float32Array(F), WS: new Int8Array(F), WF: new Int8Array(F), WT: new Float32Array(F), W0: new Float32Array(F), sgn: 0, last: -1e9, wsgn: 0, wlast: -1e9, wfo: -1, win: 0, E: 0, extra: ctx.pressSet && ctx.pressSet[a] && ctx.pressSet[b] ? 0 : CFG.gapVar * Math.pow(rnd01('gap', ctx.seed, a, b, 0), 2), /* 絞る艇と絞られる艇の間は、間合いのばらつきを足さない（絞った所 ＝ 中心の間 2.6m まで寄れる） */ scur: 0, boost: ctx.boost[a * n + b] || null, cross: !!(ctx.scn && ctx.scn.crossed && ((a === ctx.scn.attacker && ctx.scn.crossed.indexOf(b) >= 0) || (b === ctx.scn.attacker && ctx.scn.crossed.indexOf(a) >= 0))),
      beh: ctx.behind ? (ctx.behind[a].indexOf(b) >= 0 ? a : ctx.behind[b].indexOf(a) >= 0 ? b : -1) : -1, // beh ＝ 1 周 1 マークで相手の後ろを横切る艇（いなければ −1）
      bk: ctx.behindK ? ctx.behindK[a].filter((x) => x.o === b).map((x) => ({ i: a, k: x.k })).concat(ctx.behindK[b].filter((x) => x.o === a).map((x) => ({ i: b, k: x.k }))) : [] }); // bk ＝ 2 個目からのターンで相手の後ろを横切る艇とターン
    const om = 1.6;
    /* 1 周 1 マークで内の艇の後ろを横切る艇（ctx.behind）: 自分の線がマークにいちばん近づくコマ ＋ 0.5 秒までを「横切る間」とする */
    const crossEnd = new Int32Array(n).fill(-1);
    /* 2 個目からのターンの逆転の艇: そのターンの入口の 120m 手前から、自分の線がマークにいちばん近づくコマ ＋ 0.5 秒まで */
    pairs.forEach((P) => { P.bw = P.bk.map((x) => { const i = x.i, k = x.k, M = k % 2 === 0 ? C.MARK1 : C.MARK2; let best = 1e9, f0 = -1, f1 = -1; for (let f = 0; f < F; f++) { const s = ctx.SR[i][f]; if (s < ctx.E[k] - 120) continue; if (f0 < 0) f0 = f; if (s > ctx.E[k] + C.TURN_LEN + 60) break; const d = Math.hypot(G[i].x[f] - M.x, G[i].z[f] - M.z); if (d < best) { best = d; f1 = f + 30; } } return [f0, f1]; }).filter((w) => w[0] >= 0 && w[1] > w[0]); });
    if (ctx.behind) for (let i = 0; i < n; i++) { if (!ctx.behind[i].length) continue; let best = 1e9; for (let f = 0; f < F; f++) { const s = ctx.SR[i][f]; if (s < ctx.E[0] - 60) continue; if (s > ctx.E[0] + C.TURN_LEN + 60) break; const d = Math.hypot(G[i].x[f] - C.MARK1.x, G[i].z[f] - C.MARK1.z); if (d < best) { best = d; crossEnd[i] = f + 30; } } }
    const inside = (i, f) => { const k = G[i].kn[f], t = k < nt ? ctx.types[i][k] : 'P'; return t === 'B' || t === 'F' || t === 'D' ? -1 : t === 'C' || t === 'E' ? 1 : (G[i].str[f] > 0.5 ? 1 : -1); }; // 後ろの艇が外へ出るなら +1（次のターンの型で決める。02 ④-4）
    for (let f = 0; f < F; f++) {
      if (f % 300 === 299) yield;
      for (let i = 0; i < n; i++) {
        prev[i] = cur[i]; const on = ctx.on[i][f], pinned = ctx.SR[i][f] < 0 && f < 60 || f < 18; stopped[i] = (G[i].v[f] < 1.0 && f > 60) || (i === ctx.fallBoat && ctx.fallT != null && f * DT >= ctx.fallT - 0.2) ? 1 : 0;
        mob[i] = !on || pinned || stopped[i] ? 0 : 1;
        if (pinned) { cur[i] = 0; vel[i] = 0; } else if (stopped[i]) vel[i] = 0;
        /* ばねの戻る先: ふだんは線（0）。仕上げの検査ですき間が足りず、くり返しを足す時（ctx.inMore）だけ、前の回に二次計画が出したずれ（E60）。
           2026-11-18 直し: いつも 0 へ戻していると、二次計画で横へ大きく動いた艇（例 8m）と、その先にいる艇の組が「近くない」と見なされて横の決まりが 1 本も入らず、
           そのまま重なっていた（着順指定の種 3134）。ただし、いつも前の解から始めると、一度大きくずれた艇がずれたまま残りやすい（直線の横の加速度が増えた）ので、足しのくり返しだけにした */
        else { const tgt = CFG.sweepToSol && ctx.inMore && ctx.solves ? ctx.E60[i][f] : 0; let acc = om * om * (tgt - cur[i]) - 2 * om * vel[i]; acc = clamp(acc, -4, 4); vel[i] += acc * DT; cur[i] += vel[i] * DT; cur[i] = clamp(cur[i], G[i].lo[f], G[i].hi[f]); }
        px[i] = G[i].x[f] - cur[i] * G[i].tz[f]; pz[i] = G[i].z[f] + cur[i] * G[i].tx[f];
      }
      // 横並びの決まり（かたい）
      for (let p = 0; p < pairs.length; p++) {
        const P = pairs[p], i = P.i, j = P.j; let W = 0; P.ci[f] = 0;
        if (ctx.on[i][f] && ctx.on[j][f]) {
          const dx = px[i] - px[j], dz = pz[i] - pz[j], d2 = dx * dx + dz * dz;
          if (d2 < 2025) {
            const hh = G[i].tx[f] * G[j].tx[f] + G[i].tz[f] * G[j].tz[f];
            if (hh > 0.3) {
              let hx = G[i].tx[f] + G[j].tx[f], hz = G[i].tz[f] + G[j].tz[f]; const hl = Math.hypot(hx, hz); hx /= hl; hz /= hl;
              const nx = -hz, nz = hx, along = Math.abs(dx * hx + dz * hz), s = dx * nx + dz * nz;
              const ci = -G[i].tz[f] * nx + G[i].tx[f] * nz, cj = -G[j].tz[f] * nx + G[j].tx[f] * nz;
              P.ci[f] = ci; P.cj[f] = cj; P.s0[f] = s - ci * cur[i] + cj * cur[j]; P.scur = s;
              let Wb = G[i].lat[f] + G[j].lat[f] + CFG.marginW + P.extra * sm((f * DT - 3) / 4) * (G[i].kn[f] <= 1 && Math.hypot(px[i] - C.MARK1.x, pz[i] - C.MARK1.z) < CFG.nearMark && Math.hypot(px[j] - C.MARK1.x, pz[j] - C.MARK1.z) < CFG.nearMark ? 0 : 1), /* 1 周 1 マークのそば（nearMark m 以内）では間合いのばらつきを足さない（前の艇の線のすぐ外を回る。オーナー「ターンマークぎりぎり」） */ Lon = G[i].lon[f] + G[j].lon[f] + CFG.marginL;
              if (P.boost) for (let q = 0; q < P.boost.length; q++) { const bq = P.boost[q]; if (f >= bq.f0 - 120 && f <= bq.f1 + 120) { Wb += bq.dW; Lon += bq.dL; } }
              let tp = (P.cross && f < ctx.scn.fEnd) || (P.beh >= 0 && f <= crossEnd[P.beh]) || P.bw.some((w) => f >= w[0] && f <= w[1]) ? CFG.crossTaper : CFG.taper; /* 絞りまくりの艇と、前を横切られる艇: 1 マークの手前までは、前後が Lon ＋ crossTaper 離れたら横の決まりを外す（前を横切れる） */ if (stopped[i] !== stopped[j]) { const kk = ctx.fallT != null ? sm((f * DT - ctx.fallT) / 2.5) : 1; Wb = Math.max(Wb, Wb + (CFG.stopClear - Wb) * kk); tp = lerp(CFG.taper, CFG.stopAhead, kk); } // 止まった艇（転覆）には、stopAhead m 手前から横の間を作り始める。転覆の瞬間に横にいた艇はそのまま通り、2.5 秒かけて決まりを強める
              W = along <= Lon ? Wb : along >= Lon + tp ? 0 : Wb * (0.5 + 0.5 * Math.cos(Math.PI * (along - Lon) / tp));
            }
          }
        }
        if (W > 0) {
          if (!P.sgn || f - P.last > CFG.grace) {
            const df = P.scur; let sg = df > 0 ? 1 : -1;
            if (stopped[i] !== stopped[j]) sg = stopped[j] ? (G[j].hi[f] - cur[j] > CFG.stopClear + 1 || df > 0 ? 1 : -1) : (G[i].hi[f] - cur[i] > CFG.stopClear + 1 || df < 0 ? -1 : 1); // 止まった艇は外からよける（01 1-11）。外に余地が無ければ内
            else if (Math.abs(df) <= CFG.eps) {
              const rear = (px[i] - px[j]) * G[i].tx[f] + (pz[i] - pz[j]) * G[i].tz[f] < 0 ? i : j, s = P.wsgn && P.wfo === rear && f - P.wlast <= CFG.grace ? P.wsgn : inside(rear, f), want = rear === i ? s : -s;
              if (want === sg || !reach(pairs, n, want > 0 ? i : j, want > 0 ? j : i, p)) sg = want;
            }
            P.sgn = sg; P.win++; P.nextExtra = ctx.pressSet && ctx.pressSet[i] && ctx.pressSet[j] ? 0 : CFG.gapVar * Math.pow(rnd01('gap', ctx.seed, i, j, P.win), 2);
          }
          P.last = f;
        } else if (P.sgn && f - P.last > CFG.grace) { P.sgn = 0; P.extra = P.nextExtra || 0; }
        P.W[f] = W; P.S[f] = P.sgn; P.E = W > 0 ? W : P.sgn && P.ci[f] ? 1e-6 : 0;
      }
      // 引き波よけ（やわらかい）: 直線で、前の艇の通った筋から横へずらす。後ろの艇だけが動く
      for (let p = 0; p < pairs.length; p++) {
        const P = pairs[p], i = P.i, j = P.j; P.WW[f] = 0;
        if (!ctx.on[i][f] || !ctx.on[j][f] || G[i].str[f] <= 0 || G[j].str[f] <= 0 || G[i].tx[f] * G[j].tx[f] < 0.8) { if (P.wsgn && f - P.wlast > CFG.grace) P.wsgn = 0; continue; }
        const dir = G[i].tx[f] > 0 ? 1 : -1, dd = dir * (px[j] - px[i]), g = Math.abs(dd), fo = dd > 0 ? i : j, le = dd > 0 ? j : i, sf = Math.min(G[fo].str[f], G[le].str[f]);
        let Ww = 0; if (g < CFG.wake1 && G[le].v[f] > 3) Ww = CFG.wake * sf * Math.min(1, g / 5) * (g <= CFG.wake0 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (g - CFG.wake0) / (CFG.wake1 - CFG.wake0)));
        if (!(Ww > 0)) { if (P.wsgn && f - P.wlast > CFG.grace) P.wsgn = 0; continue; }
        let q = f; while (q > 0 && f - q < 150 && dir * PX[le][q - 1] > dir * px[fo]) q--; q = Math.max(0, q - 1);
        if (G[le].str[q] <= 0) continue;
        const sz = pz[fo] >= 0 ? 1 : -1, track = sz * PZ[le][q], here = sz * pz[fo];
        if (P.sgn) P.wsgn = fo === i ? P.sgn : -P.sgn;
        else if (!P.wsgn || f - P.wlast > CFG.grace || P.wfo !== fo) { const df = here - track; P.wsgn = Math.abs(df) > CFG.eps ? (df > 0 ? 1 : -1) : inside(fo, f); }
        /* 2026-11-17: 先頭が内へ締めるターン（shape.aim ＝ 'lead'）の手前では、追う艇は「次のターンで入る位置」の側へよける（先頭より外から入る艇は外へ）【実測 21: 2 番手は 2 マークの手前で先頭の外・後ろ】。
           今いる側でよけると、内から来た艇が先頭の内に残り、先頭を外へ押し出していた */
        if (!P.sgn) { const kq = G[fo].kn[f], sl = kq > 0 && kq < nt ? ctx.shapes[le][kq] : null, sf2 = sl ? ctx.shapes[fo][kq] : null; if (sl && sf2 && sl.aim === 'lead') { if (sf2.w > sl.w + 1) P.wsgn = 1; else if (sf2.w < sl.w - 1) P.wsgn = -1; } }
        P.wfo = fo; P.wlast = f;
        const e = Ww - P.wsgn * (here - track); if (e > 0 && mob[fo]) cur[fo] = clamp(cur[fo] + P.wsgn * Math.min(e, 2.0 * DT), G[fo].lo[f], G[fo].hi[f]);
        P.WW[f] = Ww; P.WS[f] = P.wsgn; P.WF[f] = fo === i ? 1 : 2; P.WT[f] = (f - q) * DT; P.W0[f] = sz * G[fo].z[f] - sz * G[le].z[q] - 0; P.eq = q;
      }
      // 押し分け（後ろの艇が多めによける。止まった艇・スタート前の艇は動かさない）
      for (let it = 0; it < 14; it++) {
        let mxv = 0;
        for (let p = 0; p < pairs.length; p++) {
          const P = pairs[p], W = P.E; if (!(W > 0)) continue; const i = P.i, j = P.j, ci = P.ci[f], cj = P.cj[f];
          const s = P.s0[f] + ci * cur[i] - cj * cur[j], e = W - P.sgn * s; if (e <= 0) continue; if (e > mxv) mxv = e;
          const iRear = (G[i].x[f] - G[j].x[f]) * G[i].tx[f] + (G[i].z[f] - G[j].z[f]) * G[i].tz[f] < 0;
          const wi = mob[i] * (iRear ? 0.7 : 0.3), wj = mob[j] * (iRear ? 0.3 : 0.7), ws = wi + wj; if (ws <= 0) continue;
          cur[i] += P.sgn * e * (wi / ws) / Math.max(0.5, ci); cur[j] -= P.sgn * e * (wj / ws) / Math.max(0.5, cj);
        }
        for (let i = 0; i < n; i++) if (mob[i]) cur[i] = clamp(cur[i], G[i].lo[f], G[i].hi[f]);
        if (mxv < 1e-3) break;
      }
      for (let i = 0; i < n; i++) { if (mob[i]) vel[i] = clamp((cur[i] - prev[i]) / DT, -6, 6); ES[i][f] = cur[i]; PX[i][f] = G[i].x[f] - cur[i] * G[i].tz[f]; PZ[i][f] = G[i].z[f] + cur[i] * G[i].tx[f]; }
    }
  }

  /* ---------- 計画の点（0.2 秒ごと）にして、6 艇いっしょに解く ---------- */
  function* solveOffsetsGen(ctx, extraRows) {
    const n = ctx.n, F = ctx.F, G = ctx.G, st = CFG.st, N = Math.floor((F - 1) / st) + 2, VS = 22;
    const wr = [], wv = [], lo = [], hi = [], x0 = [];
    for (let i = 0; i < n; i++) {
      const a = new Float64Array(N), b = new Float64Array(N), l = new Float64Array(N), u = new Float64Array(N), x = new Float64Array(N);
      for (let k = 0; k < N; k++) {
        const f = Math.min(F - 1, k * st), v = G[i].v[f];
        { let rk = 0; for (let j = 0; j < n; j++) if (j !== i && ctx.on[j][f] && ctx.SR[j][f] > ctx.SR[i][f] + 0.5) rk++; a[k] = CFG.wr * (CFG.wrRank[rk] || 1); } // 前を走る艇ほど自分の線を守る（よけるのは後ろの艇。02 ⑦-3）
        b[k] = CFG.wv * Math.min(400, Math.pow(VS / Math.max(1.2, v), 2)); if ((v < 1.0 && f > 60) || (i === ctx.fallBoat && ctx.fallT != null && f * DT >= ctx.fallT - 0.5)) b[k] = CFG.wv * 3000;
        if (i === ctx.fallBoat && ctx.fallT != null && f * DT >= ctx.fallT - 3 && f * DT < ctx.fallT - 0.5) { b[k] = Math.max(b[k], CFG.wv * 300); a[k] *= 12; } // 転覆する艇は、その前の 3 秒は自分の線を守る（止まる場所をあけるために、転覆の前に横へ大きく振られないように。よけるのは後ろの艇）
        let l0 = -1e9, h0 = 1e9; for (let q = Math.max(0, f - Math.round(st * 1.25)); q <= Math.min(F - 1, f + Math.round(st * 1.25)); q++) { if (G[i].lo[q] > l0) l0 = G[i].lo[q]; if (G[i].hi[q] < h0) h0 = G[i].hi[q]; } // 前後 1 点ぶんより広く見る（ずれは節の間をならした曲線なので、マークぎわの狭い下限を節 3 つで守る）
        l[k] = Math.min(l0, h0); u[k] = Math.max(l0, h0);
        if ((ctx.SR[i][f] < 0 && f < 60) || k <= 2) l[k] = u[k] = 0;
        x[k] = clamp(ctx.knots && ctx.knots[i].length === N ? 0.5 * (ctx.knots[i][k] + ctx.ES[i][f]) : ctx.ES[i][f], l[k], u[k]);
      }
      wr.push(a); wv.push(b); lo.push(l); hi.push(u); x0.push(x);
    }
    // かたい行: 外の艇 − 内の艇 ≥ W（前後 1 点ぶんの間の最大）
    const cap = ctx.pairs.length * N + (extraRows ? extraRows.length : 0) + 8, rows = { n: 0, a: new Int32Array(cap), b: new Int32Array(cap), ca: new Float64Array(cap), cb: new Float64Array(cap), rhs: new Float64Array(cap) };
    const push = (a, b, ca, cb, rhs) => { const r = rows.n++; rows.a[r] = a; rows.b[r] = b; rows.ca[r] = ca; rows.cb[r] = cb; rows.rhs[r] = rhs; };
    ctx.pairs.forEach((P) => { for (let k = 0; k < N; k++) { const f = k * st; if (f >= F) break; let m = 0, s = 0; const f0 = Math.max(0, f - st), f1 = Math.min(F - 1, f + st); for (let q = f0; q <= f1; q++) if (P.W[q] > m) { m = P.W[q]; s = P.S[q]; } if (m > 0 && s && P.ci[f]) push(k * n + P.i, k * n + P.j, s * P.ci[f], -s * P.cj[f], m - s * P.s0[f]); } });
    if (extraRows) extraRows.forEach((r) => push(r.k * n + r.i, r.k * n + r.j, r.ca, r.cb, r.rhs));
    // やわらかい行: 引き波よけ
    const sc = []; ctx.pairs.forEach((P) => { for (let k = 1; k < N - 1; k++) { const f = k * st; if (f >= F) break; if (P.WW[f] > 0.05) sc.push(k, P.WF[f] === 1 ? P.i : P.j, P.WF[f] === 1 ? P.j : P.i, P.WS[f], P.WT[f], P.WW[f] - P.WS[f] * P.W0[f]); } });
    const S4 = sc.length / 6, h = st * DT, soft = { n: S4, v: new Int32Array(S4 * 4), c: new Float64Array(S4 * 4), rhs: new Float64Array(S4) };
    for (let r = 0; r < S4; r++) { const k = sc[6 * r], fo = sc[6 * r + 1], le = sc[6 * r + 2], s = sc[6 * r + 3], t = s * sc[6 * r + 4] / (2 * h), b = 4 * r; soft.v[b] = k * n + fo; soft.c[b] = s; soft.v[b + 1] = k * n + le; soft.c[b + 1] = -s; soft.v[b + 2] = (k + 1) * n + le; soft.c[b + 2] = t; soft.v[b + 3] = (k - 1) * n + le; soft.c[b + 3] = -t; soft.rhs[r] = sc[6 * r + 5]; }
    const sol = yield* solveQPGen({ n, N, h, wr, wv, wa: CFG.wa, wj: CFG.wj, lo, hi, rows, soft, cSoft: CFG.cWake, x0, c: CFG.c, rounds: CFG.rounds, maxIter: CFG.newtonIter, stop: CFG.qpStop });
    ctx.knots = sol.x; ctx.iters += sol.iters; ctx.N = N; ctx.solves = (ctx.solves || 0) + 1;
    for (let i = 0; i < n; i++) { const e = ctx.E60[i], c = sol.x[i]; for (let f = 0; f < F; f++) e[f] = bspline(c, f / st); }
  }

  /* ---------- レース中〜ゴール後のワールド座標 ---------- */
  function world(ctx) {
    const n = ctx.n, F = ctx.F, G = ctx.G, pre = ctx.preF, C = ctx.C, hl = HULL_L / 2, hw = HULL_W / 2;
    const TG = [], PH = [], TK = []; // 艇ごとの「目標の横すべり」rad（表 × 区間 × 速さ。ほかの艇を見る前の値）・進む向きが回った角度 rad・どのターンか
    for (let i = 0; i < n; i++) {
      const O = ctx.O[i], e = ctx.E60[i], b = ctx.base[i];
      /* 最後の守り: ずれが、岸・マーク・消波装置の上下限（G.lo・G.hi）を 5cm 以上破っている所があれば、その分だけ戻す。
         急に動かないよう、戻す量は前後 1 秒かけてなめらかに立ち上げる（ずれを解いたあとで時刻の割り付けが少し動くと、上下限の場所とずれることがあるため） */
      { const W = 60, need = new Float32Array(F); let any = false;
        for (let f = 0; f < F; f++) { const lo = Math.min(G[i].lo[f], G[i].hi[f]), hi = Math.max(G[i].lo[f], G[i].hi[f]); if (!ctx.on[i][f]) continue; if (e[f] < lo - 0.05) { need[f] = lo - e[f]; any = true; } else if (e[f] > hi + 0.05) { need[f] = hi - e[f]; any = true; } }
        if (any) { const D = new Float32Array(F); for (let f = 0; f < F; f++) { if (!need[f]) continue; for (let q = Math.max(0, f - W); q <= Math.min(F - 1, f + W); q++) { const w = 0.5 + 0.5 * Math.cos(Math.PI * (q - f) / W), v = need[f] * w; if (Math.abs(v) > Math.abs(D[q])) D[q] = v; } } for (let f = 0; f < F; f++) e[f] += D[f]; ctx.guards = (ctx.guards || 0) + 1; } }
      for (let f = 0; f < F; f++) { O.x[pre + f] = G[i].x[f] - e[f] * G[i].tz[f]; O.z[pre + f] = G[i].z[f] + e[f] * G[i].tx[f]; }
      let hx = 1, hz = 0;
      for (let f = 0; f < F; f++) {
        const g = pre + f, a = pre + Math.max(0, f - 1), c = pre + Math.min(F - 1, f + 1), dx = O.x[c] - O.x[a], dz = O.z[c] - O.z[a], l = Math.hypot(dx, dz), dtt = (c - a) * DT;
        O.speed[g] = l / dtt; if (l > 0.02) { hx = dx / l; hz = dz / l; } O.hd[g] = Math.atan2(-hz, hx);
      }
      const T = new Float32Array(F), ph = new Float32Array(F), tkA = new Int8Array(F); TG.push(T); PH.push(ph); TK.push(tkA);
      for (let f = 0; f < F; f++) {
        const g = pre + f, a = pre + Math.max(0, f - 1), c = pre + Math.min(F - 1, f + 1); let dy = O.hd[c] - O.hd[a]; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        const yr = O.speed[g] > 1 ? dy / ((c - a) * DT) : 0; O.yr[g] = yr;
        O.turn[g] = clamp(Math.abs(yr) / CFG.turnRate, 0, 1); O.dir[g] = yr >= 0 ? 1 : -1;
        // 目標の横すべり: 進む向きがどれだけ回ったかで、角度を表から読む（SLIP_TAB。実測 14）。弧の前後の決まった区間でだけ（slipGate）
        const kn = G[i].kn[f], apNext = b.apex[kn] != null ? b.apex[kn] * b.ds : 1e9, apPrev = kn > 0 && b.apex[kn - 1] != null ? b.apex[kn - 1] * b.ds : -1e9, L = ctx.ELL[i][f], tk = L - apPrev < apNext - L ? kn - 1 : kn;
        const phd = turnedDeg(Math.cos(O.hd[g]), -Math.sin(O.hd[g]), tk); ph[f] = phd * Math.PI / 180; tkA[f] = tk;
        T[f] = ctx.on[i][f] ? slipDeg(phd) * slipGate(b, tk, L) * Math.PI / 180 * clamp((O.speed[g] - 4) / 6, 0, 1) : 0;
      }
      { const tmp = new Float32Array(F), w = 6; let sum = 0, cnt = 0; for (let f = 0; f < F + w; f++) { if (f < F) { sum += T[f]; cnt++; } if (f >= 2 * w + 1) { sum -= T[f - 2 * w - 1]; cnt--; } if (f >= w) tmp[f - w] = sum / Math.max(1, cnt); } T.set(tmp); } // 前後 0.1 秒でならす
    }
    /* 近い艇どうしで船体が重ならない角度まで、横すべりを小さくする（本物は全艇が横を向いたまま前後にずれて回るが、ここでは並んだ艇の角度を浅くする。仮のやり方）。
       S[i][f] ＝ 目標に掛ける倍率 0〜1。2 艇の中心が 7m 以内のコマで、倍率を 1 から下げていって、船体の長方形のすき間が足りる所を取る。
       時間の方向には「前後 0.5 秒の最小」→「前後 0.5 秒の平均」（＝ 0.5 秒かけてなめらかに浅くし、0.5 秒かけて戻す。どのコマでも元の倍率を超えない） */
    const S = []; for (let i = 0; i < n; i++) S.push(new Float32Array(F).fill(1));
    const need = CFG.clear + 0.10, STEPS = [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0];
    const gapAt = (i, j, g, si, sj) => {
      const A = ctx.O[i], B = ctx.O[j], fa = A.hd[g] + si, fb = B.hd[g] + sj, ax = Math.cos(fa), az = -Math.sin(fa), bx = Math.cos(fb), bz = -Math.sin(fb), dx = A.x[g] - B.x[g], dz = A.z[g] - B.z[g];
      let gap = obbGap(A.x[g], A.z[g], ax, az, B.x[g], B.z[g], bx, bz, hl, hw);
      if (ax * bx + az * bz > 0.94 && Math.abs(dx * ax + dz * az) < 0.6 * HULL_L) { const d = Math.hypot(dx, dz); if (d < CFG.abreast + 0.05) gap = Math.min(gap, CFG.clear - (CFG.abreast + 0.05 - d)); } // 並走の決まり（検査と同じ）
      return gap;
    };
    const limit = (useS) => {
      let hit = 0;
      for (let f = 0; f < F; f++) {
        const g = pre + f;
        for (let i = 0; i < n; i++) { if (!ctx.on[i][f]) continue; for (let j = i + 1; j < n; j++) {
          if (!ctx.on[j][f]) continue; const ti = TG[i][f], tj = TG[j][f]; if (ti < 0.02 && tj < 0.02) continue;
          const dx = ctx.O[i].x[g] - ctx.O[j].x[g], dz = ctx.O[i].z[g] - ctx.O[j].z[g]; if (dx * dx + dz * dz > 49) continue;
          if (useS) { // 2 巡めから: 今の倍率（ならしたあと）で足りているかを見て、足りなければ両方を半分に
            const si = ctx.SL[i][f], sj = ctx.SL[j][f]; if (gapAt(i, j, g, si, sj) >= need - 0.05) continue;
            let k = 0.5; for (; k > 0.01; k *= 0.5) if (gapAt(i, j, g, si * k, sj * k) >= need) break; if (k <= 0.01) k = 0;
            const vi = ti > 1e-4 ? si * k / ti : 0, vj = tj > 1e-4 ? sj * k / tj : 0; if (vi < S[i][f]) S[i][f] = vi; if (vj < S[j][f]) S[j][f] = vj; hit++;
          } else { let k = 0; for (; k < STEPS.length; k++) if (gapAt(i, j, g, ti * STEPS[k], tj * STEPS[k]) >= need) break; const v = k < STEPS.length ? STEPS[k] : 0; if (v < 1) { hit++; if (v < S[i][f]) S[i][f] = v; if (v < S[j][f]) S[j][f] = v; } }
        } }
      }
      return hit;
    };
    const W = 30, dUp = CFG.slipRise * Math.PI / 180 * DT;
    const apply = () => {
      ctx.SL = ctx.SL || []; 
      for (let i = 0; i < n; i++) {
        const sI = S[i], mn = new Float32Array(F), av = new Float32Array(F);
        for (let f = 0; f < F; f++) { let m = 1; const a = Math.max(0, f - W), c = Math.min(F - 1, f + W); for (let q = a; q <= c; q++) if (sI[q] < m) m = sI[q]; mn[f] = m; } // 前後 0.5 秒の最小
        const pf = new Float64Array(F + 1); for (let f = 0; f < F; f++) pf[f + 1] = pf[f] + mn[f];
        for (let f = 0; f < F; f++) { const a = Math.max(0, f - W), c = Math.min(F - 1, f + W); av[f] = (pf[c + 1] - pf[a]) / (c - a + 1); if (av[f] > sI[f]) av[f] = sI[f]; }
        const out = ctx.SL[i] || (ctx.SL[i] = new Float32Array(F)); let prev = 0;
        for (let f = 0; f < F; f++) { const tgt = TG[i][f] * av[f], sl = tgt > prev ? Math.min(tgt, prev + dUp) : tgt; prev = sl; out[f] = sl; } // 立ち上がりは毎秒 slipRise ° まで（艇の向きは 0.7 秒で 約 100° 回る。実測 14）
        /* 回り終わったあと、いつまでも横へ滑り続けない【実測 14 の 4 章】: 進む向きが 105° 回った時（＝ 艇の向きが出口の 10° 以内になるころ）から数えて、
           横すべりは 1 秒後 52° 以下・2 秒後 26° 以下・2.6 秒後 8° 以下・3 秒後 0（本物: 1 秒後 45〜55°、2 秒後 13〜30°、そのあと消える）。
           大きく・ゆっくり回る艇（外につけた艇）も、この時刻を過ぎたら舳先を進む向きにそろえる */
        { let tkPrev = -9, T0 = -1; const P105 = 105 * Math.PI / 180, R2D = 180 / Math.PI; for (let f = 0; f < F; f++) { if (TK[i][f] !== tkPrev) { tkPrev = TK[i][f]; T0 = -1; } if (T0 < 0) { if (PH[i][f] >= P105 && out[f] > 1e-4) T0 = f; else continue; } const d = (f - T0) * DT, cap = (d < 1 ? 80 - 28 * d : d < 2 ? 52 - 26 * (d - 1) : d < 2.6 ? 26 - 30 * (d - 2) : d < 3 ? 8 - 20 * (d - 2.6) : 0) / R2D; if (out[f] > cap) out[f] = cap; } }
        /* 艇の向きは、1 つのターンの中では戻らない（ほかの艇を見て角度を浅くした所で、舳先が一度戻ってまた回る動きにしない）:
           うしろのコマから順に「この先の向きの最小」を持って来て、それを超える分だけ横すべりを浅くする（浅くするだけなので、船体のすき間は広がる側） */
        { let mMin = 1e9, tkPrev = -9; for (let f = F - 1; f >= 0; f--) { if (TK[i][f] !== tkPrev || out[f] <= 1e-4) { tkPrev = TK[i][f]; mMin = PH[i][f] + out[f]; continue; } const y = PH[i][f] + out[f]; if (y > mMin) out[f] = Math.max(0, mMin - PH[i][f]); else mMin = y; } }
      }
    };
    ctx.PH = PH; ctx.TK = TK; ctx.slipCuts = limit(false); apply();
    for (let pass = 0; pass < 3; pass++) { if (!limit(true)) break; apply(); }
    for (let i = 0; i < n; i++) {
      const O = ctx.O[i], SLi = ctx.SL[i];
      for (let f = 0; f < F; f++) { const g = pre + f; O.slip[g] = SLi[f]; O.turn[g] = Math.max(O.turn[g], clamp(SLi[f] / 0.6, 0, 1)); }
      // 旋回の強さをならす（前後 0.1 秒）。回り始めの 0.4 秒前から少し立てる（選手は向きを変える前に立つ。実測 13 の 6 章）。前後の加速度 accel
      const box = (A, w) => { const tmp = new Float64Array(F); let sum = 0, cnt = 0; for (let f = 0; f < F; f++) { sum += A[pre + f]; cnt++; if (f >= 2 * w + 1) { sum -= A[pre + f - 2 * w - 1]; cnt--; } if (f >= w) tmp[f - w] = sum / cnt; } for (let f = F - w; f < F; f++) tmp[f] = A[pre + f]; for (let f = 0; f < F; f++) A[pre + f] = tmp[f]; };
      box(O.turn, 6);
      for (let f = 0; f < F - 24; f++) { const g = pre + f; if (O.turn[g] < 0.1 && O.turn[g + 24] > 0.1) O.turn[g] = Math.max(O.turn[g], 0.1 * sm((O.turn[g + 24] - 0.1) / 0.1 + 0.5)); }
      for (let f = 0; f < F; f++) { const g = pre + f, a = pre + Math.max(0, f - 4), c = pre + Math.min(F - 1, f + 4); O.acc[g] = (O.speed[c] - O.speed[a]) / ((c - a) * DT); }
    }
  }

  /* ---------- レース前（ピット離れ → ブイ → バック → 2 マーク → 待つ → 起こし → 助走）: 100 秒の続いた動き。資料 15 ---------- */
  // 単調な 3 次の補間（Fritsch–Carlson）。通る点の間で行き過ぎない・速さがつながる
  function pchipSlopes(T, Y) {
    const n = T.length, d = new Array(n).fill(0), h = [], m = []; for (let k = 0; k < n - 1; k++) { h.push(T[k + 1] - T[k]); m.push((Y[k + 1] - Y[k]) / h[k]); }
    for (let k = 1; k < n - 1; k++) { if (m[k - 1] * m[k] > 0) { const w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1]; d[k] = (w1 + w2) / (w1 / m[k - 1] + w2 / m[k]); } }
    d[0] = m[0]; d[n - 1] = m[n - 2]; return d;
  }
  function pchipAt(T, Y, D, t, st) { const n = T.length; if (t <= T[0]) return Y[0]; if (t >= T[n - 1]) return Y[n - 1] + D[n - 1] * (t - T[n - 1]); let k = st.k || 0; if (T[k] > t) k = 0; while (k < n - 2 && T[k + 1] <= t) k++; st.k = k;
    const h = T[k + 1] - T[k], u = (t - T[k]) / h, u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * Y[k] + (u3 - 2 * u2 + u) * h * D[k] + (-2 * u3 + 3 * u2) * Y[k + 1] + (u3 - u2) * h * D[k + 1]; }
  // 進入のコース c の艇が通る点 [時刻, x, z] の並び（ピットを出てから、起こしの直前まで）
  function preWaypoints(ctx, i, pit, ru) {
    const c = Math.min(5, ctx.course[i]), slowN = ctx.slowN, isSlow = c < slowN, deep = ctx.deep && isSlow, pts = [];
    const P0 = ctx.pitOutT, moved = !!(ctx.race.moved || [])[i], rankIn = c - i; // rankIn < 0 ＝ 枠より内のコースへ入る艇
    /* 2026-11-18: 前付けの艇でも、自分より外の桟橋から自分より内のコースへ入る艇（＝ 自分の前を横切る艇）がいる時は、先に出ずにゆずる（その艇の前付けを先に通す）。
       前は 2 艇とも「合図と同時に強く出る」になり、外の艇が並んだまま前を横切って重なっていた（種 4280・9068・10608。ピット離れの 3 秒後） */
    const crossed = ctx.course.some((ck, k) => k > i && Math.min(5, ck) < c);
    const movedIn = rankIn < 0 && !ctx.preLate && !crossed, late = ctx.preLate === i + 1; // 内へ入る艇（前付け）は先に出て、強く加速して、ほかの艇の前を早いうちに横切る（01 1-6「レバーを握って前へ出る」。量は仮）
    /* ピット離れ（資料 19 の 1 章・資料 15「ピット離れ直後の並び」）: 6 艇は合図でいっせいに出る。動き出しは 0〜react 秒の幅でばらつき、順番はレースごとのくじ（内から順ではない）。
       出足（加速の強さ）も艇ごとにばらつく。ピットを出てからの「内が少し前の雁行」は、ブイの手前の表の点（尼崎の実測）へ向かう道のりの差で出る。
       前付けの艇（枠より内のコースへ入る艇）は、ほかの艇より lead 秒早く・強い加速で出る（めっちゃ飛び出る）。出おくれの艇は lateT 秒おそく・弱い加速（丸亀の実測）。種から決める（乱数は使わない） */
    const react = PRE.react * rnd01(ctx.seed, 'pit-react', i), accK = 1 + (rnd01(ctx.seed, 'pit-acc', i) - 0.5) * 2 * PRE.accVar;
    const lead = movedIn ? PRE.lead : (late ? -PRE.lateT : 0) - react - ((rankIn > 0 || crossed) && !ctx.preLate ? PRE.yieldT : 0); // 前付けの艇に前を横切られる（外へ押し出される）艇は、yieldT 秒ゆずる // 内へ入る艇は合図と同時に（反応のおくれ 0）強く出て前を横切る。ほかの艇は 0〜0.4 秒のくじ
    const zb = pit.z + pit.dirZ * pit.gap * i, xb = pit.x + pit.dirX * pit.gap * i, B = PRE.buoy[c], sh = (t) => t + (PRE.shift + (ctx.preLate === i + 1 ? PRE.lateArrive : 0)) * (1 - sm((t - PRE.shiftEnd[0]) / (PRE.shiftEnd[1] - PRE.shiftEnd[0]))); // 出おくれた艇は、ブイにも lateArrive 秒おくれて着く
    const warp = (t) => (!deep || t <= -79 ? t : t >= -23 ? PRE.deepFace + (t + 23) : -79 + (t + 79) * (PRE.deepFace + 79) / 56); // 深い進入: バック側〜2 マークを早く進む
    // ① ピット離れ（合図まで動かない → 加速 → 巡航）。横は、桟橋の並び（艇番）から、ブイの手前の列（コース）へ寄せていく
    const tB = sh(B[0][0]), xB = B[0][1], zB = B[0][2], vB = Math.hypot(B[1][1] - B[0][1], B[1][2] - B[0][2]) / (B[1][0] - B[0][0]); // 表の最初の点と、そこでの速さ
    const acc = (movedIn ? PRE.pit.accIn : late ? PRE.pit.accLate : PRE.pit.acc) * accK, dec = PRE.pit.dec, Tav = tB - (P0 - lead), Lp = Math.hypot(xB - xb, zB - zb);
    // 加速 acc → 巡航 vc → 減速 dec で、ちょうど Tav 秒で Lp m 進んで速さ vB になる vc を探す
    const prof = (vc, tau) => { const t1 = vc / acc, t3 = Math.max(0, (vc - vB) / dec), t2 = Math.max(0, Tav - t1 - t3); if (tau <= t1) return 0.5 * acc * tau * tau; if (tau <= t1 + t2) return 0.5 * acc * t1 * t1 + vc * (tau - t1); const u = Math.min(tau, Tav) - t1 - t2; return 0.5 * acc * t1 * t1 + vc * t2 + vc * u - 0.5 * dec * u * u; };
    let lo = vB, hi = 26; for (let q = 0; q < 30; q++) { const m = (lo + hi) / 2; if (prof(m, Tav) < Lp) lo = m; else hi = m; } const vc = (lo + hi) / 2, kS = Lp / Math.max(1, prof(vc, Tav));
    pts.push([P0 - lead - 30, xb, zb], [P0 - lead, xb, zb]);
    for (let tau = 0.4; tau < Tav - 0.3; tau += 0.4) { const d = prof(vc, tau) * kS, k = d / Lp, kz = movedIn ? sm((k - 0.12) / 0.38) : late ? sm((k - 0.3) / 0.5) : rankIn > 0 && !ctx.preLate ? sm((k - 0.18) / 0.4) : sm((k - 0.45) / 0.5); pts.push([P0 - lead + tau, xb + (xB - xb) * k, lerp(zb, zB, kz)]); } // 横は、桟橋の並び（艇番）からコースの列へ寄せる: 前付けの艇は道のりの 12〜50%（ほかの艇より 8m 以上前にいる間）、押し出される艇は 18〜58%（先に外へ空ける）、ほかの艇は 45〜95%
    // ②③ ブイ〜バック（尼崎の表。時刻は shift ぶん後ろへ）
    for (const r of B) pts.push([warp(sh(r[0])), r[1], r[2]]);
    const tE = B[B.length - 1][0], xE = B[B.length - 1][1], zE = B[B.length - 1][2];
    let tf, xf, zw;
    if (isSlow) { // ④ 2 マークのすぐ奥で左へ回って舳先を向ける
      const S = PRE.slow[Math.min(3, c)]; for (const r of S) pts.push([warp(r[0]), r[1], r[2]]);
      const L = S[S.length - 1]; tf = warp(L[0]); xf = L[1]; zw = c === 3 ? PRE.waitZslow4 : PRE.waitZ[c];
    } else { // ④ 回らずに奥へ走り、ピットの前で大きく左へ回って戻る（半円）
      const j = clamp(c - 3, 0, 2), Dd = PRE.dash[j]; zw = PRE.waitZ[c]; const cx = PRE.dashCx, r = Math.min(PRE.dashR, (zw - zE) / 2), mid = (zw - zE) - 2 * r, xs = xE - Math.max(0, Dd.t0 - tE) * 1.0, Ls = Math.max(1, xs - cx), La = Math.PI * r / 2, Lt = Ls + La + mid + La, N = 16;
      if (Dd.t0 > tE + 0.5) pts.push([Dd.t0, xs, zE]);
      for (let q = 1; q <= N; q++) { const u = q / N; let sd = Lt * (0.14 * u + 0.86 * u * u * (3 - 2 * u)); const t = Dd.t0 + (Dd.t1 - Dd.t0) * u; // 道のりの進み: 両はしは遅く（微速 → 約 10 m/s → 流す速さ）
        if (sd <= Ls) { pts.push([t, xs - sd, zE]); continue; } sd -= Ls;
        if (sd <= La) { const th = sd / r; pts.push([t, cx - r * Math.sin(th), zE + r - r * Math.cos(th)]); continue; } sd -= La;
        if (sd <= mid) { pts.push([t, cx - r, zE + r + sd]); continue; } sd -= mid;
        const th = sd / r; pts.push([t, cx - r * Math.cos(th), zw - r + r * Math.sin(th)]); }
      tf = Dd.tf; xf = PRE.dashXf; pts.push([tf, xf, zw]);
    }
    // ⑤ 待つ: 舳先を向けた所から、起こす所（走りの計算の助走の起点）まで、ほぼ一定の微速で流れる
    const kT = ru.kickT, xk = ru.xk; // 起こす時刻と、その時の x
    if (kT - tf > 1.2) { const m = Math.max(2, Math.round((kT - tf) / 3)), zf = pts[pts.length - 1][2]; for (let q = 1; q < m; q++) { const k = q / m; pts.push([tf + (kT - tf) * k, xf + (xk - xf) * k, lerp(zf, zw, sm(k * 1.6))]); } }
    ctx.preWaitZ[i] = zw; ctx.preFaceT[i] = tf;
    return pts;
  }
  function preRace(ctx, info) {
    const n = ctx.n, pre = ctx.preF, preT = ctx.preT, hl = HULL_L / 2, hw = HULL_W / 2;
    const pit = Object.assign({ x: PRE.pit.x, z: PRE.pit.z0, gap: PRE.pit.gap, dirX: 0, dirZ: 1, outX: 1, outZ: 0 }, (info && info.pit) || {}); if (pit.out) { pit.outX = pit.out.x; pit.outZ = pit.out.z; }
    ctx.kickT = []; ctx.waitEndT = []; ctx.preWaitZ = []; ctx.preFaceT = [];
    /* 進入が枠の順でない時の型（資料 15）: 「前付け型」＝ 内へ入る艇がピット離れで飛び出して前を横切る／「出おくれ型」＝ 1 艇がピット離れでおくれ、外の艇が 1 つずつ内へ詰める（丸亀の実測）。
       出おくれ型にするのは、外へ 2 コース以上ずれた艇が 1 艇だけで、ほかの艇の動きが 1 コース以内の時（その艇が出おくれた、と読む。振り分けの決まりは仮） */
    ctx.preLate = 0; { const out2 = []; let ok = true; for (let i = 0; i < n; i++) { const d = Math.min(5, ctx.course[i]) - i; if (d >= 2) out2.push(i); else if (d < -1) ok = false; } if (ok && out2.length === 1) ctx.preLate = out2[0] + 1;
      // となりどうしが入れ替わっただけ（例 123465）の時は、半分を「内の艇の出おくれ」、半分を「外の艇の飛び出し」にする（どちらが多いかの資料は無い＝仮）
      const sw = []; for (let i = 0; i < n; i++) if (Math.min(5, ctx.course[i]) !== i) sw.push(i); if (!ctx.preLate && sw.length === 2 && Math.abs(sw[0] - sw[1]) === 1 && rnd01(ctx.seed, 'pit-late') < 0.5) ctx.preLate = Math.min(sw[0], sw[1]) + 1; }
    ctx.slowN = ctx.race.slow == null ? 3 : clamp(Number(ctx.race.slow) || 0, 0, n); ctx.deep = !!ctx.race.deep;
    if (info && Array.isArray(info.dash) && info.dash.length === n) { let k = 0; for (let i = 0; i < n; i++) if (!info.dash[i]) k++; ctx.slowN = k; }
    const VS = (info && info.VS) || 22.6, TAU = (info && info.TAU) || 3.0, rd = (t) => (t <= 0 ? 0 : VS * (t - TAU * (1 - Math.exp(-t / TAU)))); // 助走の式（js/boat-model.js の runupDist と同じ。01 1-7）
    const launchDef = { slow: [133, 142, 145, 145, 145, 145], dash: 205, deep: 100 };
    for (let i = 0; i < n; i++) {
      const O = ctx.O[i], c = Math.min(5, ctx.course[i]), isSlow = c < ctx.slowN, lane = ctx.laneOf[i], x00 = ctx.SR[i][0], st = ctx.stSec[i];
      // 助走: 起こしの位置（線の手前 D m）と、起こしてから線までの秒 T（describe の runup。無ければ同じ式で出す）
      const rn = info && info.runup && info.runup[i]; let D = rn && rn.from > 20 ? rn.from : (isSlow ? (ctx.deep ? launchDef.deep : launchDef.slow[c]) : launchDef.dash), T = rn && rn.T > 1 ? rn.T : 0;
      if (!T) { T = D / VS + TAU; for (let k = 0; k < 8; k++) T -= (rd(T) - D) / (VS * (1 - Math.exp(-T / TAU))); }
      const kickT = st - T, vd = isSlow ? 1.0 : 1.3, tc = PRE.drift, xk = -D - vd * tc; // 起こす前の流れ（vd m/s）が tc 秒で消える分だけ、起点を後ろへ
      ctx.kickT[i] = kickT; ctx.waitEndT[i] = kickT;
      const W = preWaypoints(ctx, i, pit, { kickT, xk });
      const zw = ctx.preWaitZ[i];
      // ⑥ 起こし〜スリット: x は助走の式。z は待つ位置から進入のコースの位置へ、なめらかに寄せる（線の 15m 手前で落ち着く。スタートのあと 3 秒は横へ動かない。01 ⑥-9）
      const xr = (t) => { const tau = t - kickT; return xk + rd(tau) + vd * tc * (1 - Math.exp(-Math.max(0, tau) / tc)); };
      const fixX = x00 - xr(0), vEnd = (xr(0.02) - xr(-0.02)) / 0.04, fixV = ctx.v0[i] - vEnd; // 大時計の 0 で run の位置・速さにぴったり合わせる分
      const xa = xk + 12, xbz = -15, bb = ctx.base[i], q2 = {}; // 横の寄せは、起こして 12m 進んだ所から線の 15m 手前まで（尼崎: 1 コースは最後の 3 秒で 2 コースとの間が 15m → 2.7m に詰まる。01 ⑥-3）
      for (let t = kickT; t < 0.6; t += 0.2) { const x = xr(t) + (t > -5 ? fixX * sm((t + 5) / 5) : 0) + (t > -2.5 ? fixV * t * sm((t + 2.5) / 2.5) : 0); let zl = lane; if (x > -100 && x < 60) { baseAt(bb, ellAtX(bb, 0, x, 0), q2); zl = q2.z; } W.push([t, x, lerp(zw, zl, sm((x - xa) / (xbz - xa)))]); }
      // 時刻の順に整える（近すぎる点は捨てる）→ 補間
      const Tq = [], Xq = [], Zq = []; for (const w of W) { if (Tq.length && w[0] <= Tq[Tq.length - 1] + 0.12) continue; Tq.push(w[0]); Xq.push(w[1]); Zq.push(w[2]); }
      const dX = pchipSlopes(Tq, Xq), dZ = pchipSlopes(Tq, Zq), sx = {}, sz = {};
      for (let g = 0; g < pre; g++) { const t = -preT + g * DT; O.x[g] = pchipAt(Tq, Xq, dX, t, sx); O.z[g] = pchipAt(Tq, Zq, dZ, t, sz); }
    }
    // 通る点のつなぎ目で向きの変わり方が角ばらないよう、前後 0.25 秒の平均を 2 回かける（大時計の 0 の手前は幅をしぼる＝ run とのつなぎ目は動かさない。ピットで止まっている間も動かない）
    for (let i = 0; i < n; i++) for (const A of [ctx.O[i].x, ctx.O[i].z]) for (let passN = 0; passN < 2; passN++) { const pf = new Float64Array(pre + 1); for (let g = 0; g < pre; g++) pf[g + 1] = pf[g] + A[g]; for (let g = 0; g < pre; g++) { const h = Math.min(15, g, pre - 1 - g); A[g] = (pf[g + h + 1] - pf[g - h]) / (2 * h + 1); } }
    // 仕上げ: 船体のすき間が足りない所は、2 艇を結ぶ向きに少しずつ離す（内のコースの艇はあまり動かさない）。離す量は前後 1.2 秒かけてなめらかに立ち上げる
    const gA = clamp(Math.round((PRE.sepFrom + preT) / DT), 0, pre), gB = clamp(Math.round((PRE.sepTo + preT) / DT), 0, pre), Wn = 72; ctx.preSep = 0;
    for (let round = 0; round < 12 && gB > gA + 10; round++) {
      const HX = [], HZ = []; for (let i = 0; i < n; i++) { const O = ctx.O[i], hx = new Float32Array(pre), hz = new Float32Array(pre); let ux = pit.outX, uz = pit.outZ; for (let g = 0; g < pre; g++) { const a = Math.max(0, g - 3), c = Math.min(pre - 1, g + 3), dx = O.x[c] - O.x[a], dz = O.z[c] - O.z[a], l = Math.hypot(dx, dz); if (l > 0.02) { ux = dx / l; uz = dz / l; } hx[g] = ux; hz[g] = uz; } HX.push(hx); HZ.push(hz); }
      const NX = [], NZ = []; for (let i = 0; i < n; i++) { NX.push(new Float32Array(pre)); NZ.push(new Float32Array(pre)); } let any = 0;
      for (let g = gA; g < gB; g += 2) for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        const A = ctx.O[a], Bo = ctx.O[b], dx = A.x[g] - Bo.x[g], dz = A.z[g] - Bo.z[g], d2 = dx * dx + dz * dz; if (d2 > 30) continue;
        const gap = obbGap(A.x[g], A.z[g], HX[a][g], HZ[a][g], Bo.x[g], Bo.z[g], HX[b][g], HZ[b][g], hl, hw), d = Math.sqrt(d2) || 1e-6;
        const side = HX[a][g] * HX[b][g] + HZ[a][g] * HZ[b][g] > 0.9 && Math.abs(dx * HX[a][g] + dz * HZ[a][g]) < 0.7 * HULL_L && d < 2.5; // 並走は中心どうし 2.5m まで（02 ⑦-1）
        if (gap >= PRE.sep && !side) continue;
        const need = Math.max(PRE.sep - gap, side ? 2.5 - d : 0) + 0.15, wa = ctx.course[a] < ctx.course[b] ? 0.3 : 0.7, ux = dx / d, uz = dz / d; any++;
        for (const [arrX, arrZ, sgn, w] of [[NX[a], NZ[a], 1, wa], [NX[b], NZ[b], -1, 1 - wa]]) { const vx = sgn * ux * need * w, vz = sgn * uz * need * w; if (Math.abs(vx) > Math.abs(arrX[g])) arrX[g] = vx; if (Math.abs(vz) > Math.abs(arrZ[g])) arrZ[g] = vz; }
      }
      if (!any) break; ctx.preSep += any;
      for (let i = 0; i < n; i++) for (const [need, A] of [[NX[i], ctx.O[i].x], [NZ[i], ctx.O[i].z]]) { const Dv = new Float32Array(pre); let has = false;
        for (let g = gA; g < gB; g += 2) { const v = need[g]; if (!v) continue; has = true; for (let q = Math.max(gA, g - Wn); q <= Math.min(gB - 1, g + Wn); q++) { const w = 0.5 + 0.5 * Math.cos(Math.PI * (q - g) / Wn), u = v * w; if (Math.abs(u) > Math.abs(Dv[q])) Dv[q] = u; } }
        if (!has) continue; for (let passN = 0; passN < 2; passN++) { const pf = new Float64Array(pre + 1); for (let g = 0; g < pre; g++) pf[g + 1] = pf[g] + Dv[g]; for (let g = 0; g < pre; g++) { const h = Math.min(18, g, pre - 1 - g); Dv[g] = (pf[g + h + 1] - pf[g - h]) / (2 * h + 1); } } // 離す量そのものもならす（速さが飛ばないように）
        const fa = (g) => sm((g - gA) / 60) * sm((gB - 1 - g) / 60); for (let g = gA; g < gB; g++) A[g] += Dv[g] * fa(g); }
    }
    // 速さ・進む向き・向きの回る速さ
    const span = (g, w) => [Math.max(0, g - w), Math.min(pre + 2, g + w)];
    for (let i = 0; i < n; i++) {
      const O = ctx.O[i]; let hx = pit.outX, hz = pit.outZ;
      for (let g = 0; g < pre; g++) { const [a, c] = span(g, 2), dx = O.x[c] - O.x[a], dz = O.z[c] - O.z[a], l = Math.hypot(dx, dz); O.speed[g] = l / ((c - a) * DT); if (l > 0.004 * (c - a)) { hx = dx / l; hz = dz / l; } O.hd[g] = Math.atan2(-hz, hx); }
      // 微速の間は、位置のわずかな揺れで向きが震えないよう、向きを前後 0.4 秒でならす（速い時はそのまま）
      { const cs = new Float64Array(pre), sn = new Float64Array(pre); for (let g = 0; g < pre; g++) { cs[g] = Math.cos(O.hd[g]); sn[g] = Math.sin(O.hd[g]); } const pc = new Float64Array(pre + 1), ps = new Float64Array(pre + 1); for (let g = 0; g < pre; g++) { pc[g + 1] = pc[g] + cs[g]; ps[g + 1] = ps[g] + sn[g]; }
        for (let g = 0; g < pre; g++) { const h = Math.min(Math.round(24 * clamp((6 - O.speed[g]) / 4, 0, 1)), g, pre - 1 - g); if (h < 1) continue; const a = pc[g + h + 1] - pc[g - h], b = ps[g + h + 1] - ps[g - h]; if (a * a + b * b > 1e-6) O.hd[g] = Math.atan2(b, a); } }
      for (let g = 0; g < pre; g++) { const [a, c] = span(g, 3), c2 = Math.min(c, pre - 1); if (c2 <= a) { O.yr[g] = 0; O.turn[g] = 0; O.slip[g] = 0; O.dir[g] = 1; continue; }
        let dy = O.hd[c2] - O.hd[a]; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        const yr = dy / ((c2 - a) * DT); O.yr[g] = yr; O.turn[g] = clamp(Math.abs(yr) / CFG.turnRate, 0, 1) * clamp(O.speed[g] / 12, 0.2, 1); O.dir[g] = yr >= 0 ? 1 : -1; O.slip[g] = (yr >= 0 ? 1 : -1) * 0.25 * O.turn[g] * clamp((O.speed[g] - 3) / 5, 0, 1); } // 横すべりは速い時だけ（微速の艇は進む向きを向く）
      for (let g = 0; g < pre; g++) { const a = Math.max(0, g - 4), c = Math.min(pre + 2, g + 4); O.acc[g] = (O.speed[c] - O.speed[a]) / ((c - a) * DT); }
    }
  }
  // レース前だけの検査（資料 15 の決まり: 重ならない・飛ばない・0 秒で run とつながる・岸やマークやブイやピットの桟橋に当たらない）
  function checkPre(ctx) {
    const n = ctx.n, O = ctx.O, pre = ctx.preF, C = ctx.C, hl = HULL_L / 2, hw = HULL_W / 2, r = { preOverlap: 0, preMinGap: 99, preMinCenter: 99, preTeleports: 0, preSpeedJumps: 0, preMaxSpeed: 0, preMaxAccel: 0, preMaxYawRate: 0, preMinMark: 99, preMinBuoy: 99, preMinWave: 99, preMinShore: 99, preMinPier: 99, preJoinPos: 0, preJoinSpeed: 0, preMinMoveSpeed: 99, preMaxLatAcc: 0, at: {} };
    const fx = (i, g) => Math.cos(O[i].hd[g] + O[i].slip[g]), fz = (i, g) => -Math.sin(O[i].hd[g] + O[i].slip[g]), tOf = (g) => +((g - pre) * DT).toFixed(2), reach = Math.hypot(hl, hw);
    const gLeave = Math.round((ctx.pitOutT + 4 + ctx.preT) / DT); // ピットを出て 4 秒たってから先は、桟橋（x < X_MIN + 7.6）に近づかない
    for (let g = 0; g < pre; g++) {
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) { const dx = O[a].x[g] - O[b].x[g], dz = O[a].z[g] - O[b].z[g], d2 = dx * dx + dz * dz; if (d2 > 49) continue; const gap = obbGap(O[a].x[g], O[a].z[g], fx(a, g), fz(a, g), O[b].x[g], O[b].z[g], fx(b, g), fz(b, g), hl, hw); if (gap < 0) r.preOverlap++; if (gap < r.preMinGap) { r.preMinGap = gap; r.at.preMinGap = [a * 10 + b, tOf(g)]; } if (d2 < r.preMinCenter * r.preMinCenter) r.preMinCenter = Math.sqrt(d2); }
      for (let i = 0; i < n; i++) { const X = O[i].x, Z = O[i].z, SP = O[i].speed;
        for (let m = 0; m < 2; m++) { const M = m ? C.MARK2 : C.MARK1; if (Math.hypot(X[g] - M.x, Z[g] - M.z) < 12) { const dd = pointRect(M.x, M.z, X[g], Z[g], fx(i, g), fz(i, g), hl, hw) - 0.55; if (dd < r.preMinMark) { r.preMinMark = dd; r.at.preMinMark = [i, tOf(g)]; } } }
        if (Math.hypot(X[g] - C.BUOY.x, Z[g] - C.BUOY.z) < 12) { const dd = pointRect(C.BUOY.x, C.BUOY.z, X[g], Z[g], fx(i, g), fz(i, g), hl, hw) - 0.4; if (dd < r.preMinBuoy) { r.preMinBuoy = dd; r.at.preMinBuoy = [i, tOf(g)]; } }
        if (X[g] > C.MARK2.x - reach && X[g] < C.BUOY.x + reach && Math.abs(Z[g]) < 8) { let dmin = 99; for (let q = 0; q <= 16; q++) { const wx = C.MARK2.x + (C.BUOY.x - C.MARK2.x) * q / 16, dd = pointRect(wx, 0, X[g], Z[g], fx(i, g), fz(i, g), hl, hw); if (dd < dmin) dmin = dd; } if (dmin - 0.5 < r.preMinWave) { r.preMinWave = dmin - 0.5; r.at.preMinWave = [i, tOf(g)]; } }
        if (g >= gLeave) { const sh = Z[g] >= 0 ? C.shoreZ(X[g]) - Z[g] : Z[g] - C.farZ(X[g]), dd = Math.min(sh, C.X_MAX - X[g]) - reach; if (dd < r.preMinShore) r.preMinShore = dd; const pier = X[g] - reach - (C.X_MIN + 7.6); if (pier < r.preMinPier) { r.preMinPier = pier; r.at.preMinPier = [i, tOf(g)]; } }
        if (g < 4 || g > pre - 2) continue;
        const step = Math.hypot(X[g + 1] - X[g], Z[g + 1] - Z[g]); if (step > SP[g] * DT * 1.3 + 0.05) r.preTeleports++;
        if (g < pre - 4 && Math.abs(SP[g + 1] - SP[g]) > 0.5) r.preSpeedJumps++;
        if (SP[g] > r.preMaxSpeed) r.preMaxSpeed = SP[g]; const ac = Math.abs(SP[g + 1] - SP[g - 1]) / (2 * DT); if (g < pre - 4 && ac > r.preMaxAccel) { r.preMaxAccel = ac; r.at.preMaxAccel = [i, tOf(g)]; }
        const yr = Math.abs(O[i].yr[g]) * 180 / Math.PI; if (SP[g] > 0.3 && yr > r.preMaxYawRate) { r.preMaxYawRate = yr; r.at.preMaxYawRate = [i, tOf(g)]; } const la = Math.abs(O[i].yr[g]) * SP[g]; if (la > r.preMaxLatAcc) { r.preMaxLatAcc = la; r.at.preMaxLatAcc = [i, tOf(g)]; }
        const tt = (g - pre) * DT; if (tt > ctx.pitOutT + 1.5 && SP[g] < r.preMinMoveSpeed) { r.preMinMoveSpeed = SP[g]; r.at.preMinMoveSpeed = [i, tOf(g)]; } // 本物は止まれない（必ず前へ流れる。01 1-5）
      }
    }
    // 大時計の 0 のつなぎ目: レース前の最後のコマから 1 コマ進めた位置と、run の最初のコマの位置・速さ
    for (let i = 0; i < n; i++) { const X = O[i].x, Z = O[i].z, SP = O[i].speed, g = pre - 1, ex = X[g] + (X[g] - X[g - 1]), ez = Z[g] + (Z[g] - Z[g - 1]), e = Math.hypot(X[pre] - ex, Z[pre] - ez), ev = Math.abs(SP[pre + 1] - SP[pre - 2]); if (e > r.preJoinPos) r.preJoinPos = e; if (ev > r.preJoinSpeed) r.preJoinSpeed = ev; }
    return r;
  }

  /* ---------- 自己検査（全コマ） ---------- */
  function check(ctx, quick) {
    const n = ctx.n, NF = ctx.NF, C = ctx.C, O = ctx.O, pre = ctx.preF, hl = HULL_L / 2, hw = HULL_W / 2, gc = ctx.gPit, nearC = (g) => ctx.cutG.some((q) => Math.abs(g - q) <= 4);
    const r = { overlapFrames: 0, minGap: 99, minGapRace: 99, minGapPre: 99, bad: [], abreastMin: 99, at: {} };
    const tOf = (g) => +((g - pre) * DT).toFixed(2), mx = (key, v, i, g) => { if (v > r[key]) { r[key] = v; r.at[key] = [i, tOf(g)]; } }, mn = (key, v, i, g) => { if (v < r[key]) { r[key] = v; r.at[key] = [i, tOf(g)]; } };
    const fx = (i, g) => Math.cos(O[i].hd[g] + O[i].slip[g]), fz = (i, g) => -Math.sin(O[i].hd[g] + O[i].slip[g]);
    for (let g = 0; g < NF; g++) {
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        if (!ctx.onG(a, g) || !ctx.onG(b, g)) continue;
        const dx = O[a].x[g] - O[b].x[g], dz = O[a].z[g] - O[b].z[g], d2 = dx * dx + dz * dz; if (d2 > 49) continue;
        const ax = fx(a, g), az = fz(a, g), bx = fx(b, g), bz = fz(b, g), gap = obbGap(O[a].x[g], O[a].z[g], ax, az, O[b].x[g], O[b].z[g], bx, bz, hl, hw);
        mn('minGap', gap, a * 10 + b, g); if (g >= pre) { if (gap < r.minGapRace) r.minGapRace = gap; } else if (gap < r.minGapPre) r.minGapPre = gap;
        if (gap < 0) r.overlapFrames++;
        let bg = gap; const abreast = g >= gc && ax * bx + az * bz > 0.94 && Math.abs(dx * ax + dz * az) < 0.6 * HULL_L; if (abreast && d2 < CFG.abreast * CFG.abreast) bg = Math.min(bg, CFG.clear - (CFG.abreast - Math.sqrt(d2)) - 0.01);
        if (bg < CFG.clear && g >= pre) r.bad.push({ a, b, f: g - pre, g: bg });
        // 並走（前後がほぼ重なり、向きもほぼ同じ）の中心間。ピットに並んでいる間は数えない
        if (abreast) mn('abreastMin', Math.sqrt(d2), a * 10 + b, g);
      }
    }
    if (quick) return r;
    Object.assign(r, { maxLatAcc: 0, maxJerk: 0, maxLatRatio: 0, maxYawRateStraight: 0, maxYawRateTurn: 0, maxTurnAcc: 0, maxYawAcc: 0, speedJumps: 0, runJump: 0, teleports: 0, maxAccel: 0, speedRatioMin: 9, speedRatioMax: 0, straightSpeedErr: 0,
      finishOrderOk: true, finishTimeErr: 0, startTimeErr: 0, orderMismatch: 0, minMark: 99, minShore: 99, minBuoy: 99, minWave: 99, maxSlipDeg: 0 });
    const rad = 180 / Math.PI;
    for (let i = 0; i < n; i++) {
      const X = O[i].x, Z = O[i].z, SP = O[i].speed, YR = O[i].yr, fEndRace = ctx.finOk[i] ? Math.floor(ctx.fin[i] / DT) : ctx.F - 1;
      for (let g = 4; g < NF - 4; g++) {
        if (!ctx.onG(i, g)) continue; const nearCut = nearC(g);
        // 岸・マーク・ブイ・消波装置（船体のいちばん遠い角まで見込む）
        const reach2 = Math.hypot(hl, hw);
        for (let m = 0; m < 2; m++) { const M = m ? C.MARK2 : C.MARK1, d = Math.hypot(X[g] - M.x, Z[g] - M.z) - 0.55; if (d < 12) { const dd = pointRect(M.x, M.z, X[g], Z[g], fx(i, g), fz(i, g), hl, hw) - 0.55; mn('minMark', dd, i, g); } }
        { const d = Math.hypot(X[g] - C.BUOY.x, Z[g] - C.BUOY.z); if (d < 12) { const dd = pointRect(C.BUOY.x, C.BUOY.z, X[g], Z[g], fx(i, g), fz(i, g), hl, hw) - 0.4; if (dd < r.minBuoy) r.minBuoy = dd; } }
        if (X[g] > C.MARK2.x - reach2 && X[g] < C.BUOY.x + reach2 && Math.abs(Z[g]) < 8) { let dmin = 99; for (let q = 0; q <= 8; q++) { const wx = C.MARK2.x + (C.BUOY.x - C.MARK2.x) * q / 8, dd = pointRect(wx, 0, X[g], Z[g], fx(i, g), fz(i, g), hl, hw); if (dd < dmin) dmin = dd; } if (dmin - 0.5 < r.minWave) r.minWave = dmin - 0.5; }
        { const sh = Z[g] >= 0 ? C.shoreZ(X[g]) - Z[g] : Z[g] - C.farZ(X[g]), dd = Math.min(sh, X[g] - C.X_MIN, C.X_MAX - X[g]) - reach2; if (g >= gc && dd < r.minShore) r.minShore = dd; }
        if (nearCut) continue;
        const step = Math.hypot(X[g + 1] - X[g], Z[g + 1] - Z[g]); if (step > SP[g] * DT * 1.3 + 0.05) r.teleports++;
        const acc = Math.abs(SP[g + 1] - SP[g - 1]) / (2 * DT); mx('maxAccel', acc, i, g);
        { const dv = Math.abs(SP[g + 1] - SP[g]), f = g - pre; let dr = 0; if (f > 1 && f < ctx.F - 3 && f < (ctx.finOk[i] ? ctx.fin[i] / DT - 2 : 1e9)) { const S = ctx.SR[i]; dr = ctx.ratio[i][f] !== 1 ? Math.max(Math.abs(ctx.VR[i][f + 2] - ctx.VR[i][f + 1]), Math.abs(ctx.VR[i][f + 1] - ctx.VR[i][f])) : Math.max(Math.abs(S[f + 2] - 2 * S[f + 1] + S[f]), Math.abs(S[f + 1] - 2 * S[f] + S[f - 1]), Math.abs(S[f + 3] - 2 * S[f + 2] + S[f + 1])) / DT; } // run そのものが 1 コマで変える速さ
          if (dv > 0.5 && dv > dr * 1.3 + 0.25) r.speedJumps++; if (dr > r.runJump) r.runJump = dr; }
        if (g < pre) continue; // ここから下はレース中〜ゴール後だけ
        if (i === ctx.fallBoat && ctx.fallT != null && (g - pre) * DT >= ctx.fallT - 0.1) continue; // 転覆した艇（ひっくり返って止まる）は、なめらかさの物差しから外す
        const f = g - pre, straight = Math.abs(X[g]) < C.MARK1.x - 45 && SP[g] > 8 && Math.abs(Math.sin(O[i].hd[g])) < 0.35;
        const yr = Math.abs(YR[g]) * rad, ya = Math.abs(YR[g + 1] - YR[g - 1]) / (2 * DT) * rad;
        if (straight) {
          const h3 = 3 * DT, acc3 = (q) => (Z[q + 3] - 2 * Z[q] + Z[q - 3]) / (h3 * h3), la = Math.abs(acc3(g)), lj = g > 6 && g < NF - 7 ? Math.abs(acc3(g + 3) - acc3(g - 3)) / (2 * h3) : 0, lr = Math.abs((Z[g + 1] - Z[g - 1]) / ((X[g + 1] - X[g - 1]) || 1e-9));
          mx('maxLatAcc', la, i, g); mx('maxJerk', lj, i, g); mx('maxLatRatio', lr, i, g); mx('maxYawRateStraight', yr, i, g);
        } else if (SP[g] > 6) { mx('maxYawRateTurn', yr, i, g); mx('maxTurnAcc', Math.abs(YR[g]) * SP[g], i, g); }
        if (SP[g] > 6) mx('maxYawAcc', ya, i, g);
        const sd = Math.abs(O[i].slip[g]) * rad; if (sd > r.maxSlipDeg) r.maxSlipDeg = sd;
        // 画面上の速さ ÷ 走りの計算の速さ（run のとおりに走っている間だけ）
        if (f > 2 && f < fEndRace - 2 && !ctx.out[i]) { const vr = ctx.VR[i][f]; if (vr > 5) { const q = SP[g] / vr; if (q < r.speedRatioMin) r.speedRatioMin = q; if (q > r.speedRatioMax) r.speedRatioMax = q; if (ctx.ratio[i][f] === 1 && ctx.ratio[i][f - 1] === 1 && ctx.ratio[i][f + 1] === 1) { const e = Math.abs(q - 1); if (e > r.straightSpeedErr) r.straightSpeedErr = e; } } }
      }
    }
    /* 横すべりの時刻表の検査【実測 14 の 4 章】: ターンごとに「艇の向きが出口の向きの 10° 以内になった時刻 Ty」を取り、その時・1 秒後・2 秒後・2.8 秒後の横すべり（°）のいちばん大きい値を出す。
       本物（レースの先頭の艇 4 例）: Ty で 60〜88°、1 秒後 45〜55°、2 秒後 13〜30°。回り終わったあと、いつまでも横へ滑り続けないことを見る */
    Object.assign(r, { slipFacing: 0, slipAfter1: 0, slipAfter2: 0, slipAfter28: 0, slipTurns: 0 });
    if (ctx.PH && ctx.SL) for (let i = 0; i < n; i++) { let tk = -9, Ty = -1; const lim = 170 * Math.PI / 180, fEnd = Math.min(ctx.F - 1, ctx.finOk[i] ? Math.floor(ctx.fin[i] / DT) + 600 : (i === ctx.fallBoat && ctx.fallT != null ? Math.floor(ctx.fallT / DT) - 30 : ctx.F - 1));
      for (let f = 0; f <= fEnd; f++) { if (!ctx.on[i][f]) continue; if (ctx.TK[i][f] !== tk) { tk = ctx.TK[i][f]; Ty = -1; } const sl = ctx.SL[i][f] * rad;
        if (Ty < 0) { if (sl > 1 && ctx.PH[i][f] + ctx.SL[i][f] >= lim) { Ty = f; r.slipTurns++; if (sl > r.slipFacing) r.slipFacing = sl; } continue; }
        const d = f - Ty; if (d === 60 && sl > r.slipAfter1) { r.slipAfter1 = sl; r.at.slipAfter1 = [i, +(f * DT).toFixed(2)]; } if (d === 120 && sl > r.slipAfter2) { r.slipAfter2 = sl; r.at.slipAfter2 = [i, +(f * DT).toFixed(2)]; } if (d >= 168 && sl > r.slipAfter28) { r.slipAfter28 = sl; r.at.slipAfter28 = [i, +(f * DT).toFixed(2)]; } } }
    // ゴール線・スタート線を切る時刻と順（x = 0 を +x 向きに切る時刻を、線の補間で求める）
    const ft = [];
    for (let i = 0; i < n; i++) {
      const X = O[i].x;
      if (!ctx.out[i] || i === ctx.fallBoat) { let g = pre; while (g < NF - 1 && !(X[g] < 0 && X[g + 1] >= 0)) g++; if (g < NF - 1) { const t = (g - pre + (0 - X[g]) / (X[g + 1] - X[g])) * DT, e = Math.abs(t - ctx.stSec[i]); if (ctx.SR[i][0] < 0 && e > r.startTimeErr) r.startTimeErr = e; } }
      if (ctx.finOk[i]) { let g = pre + Math.max(1, Math.floor(ctx.fin[i] / DT) - 30); while (g < NF - 1 && !(X[g] < 0 && X[g + 1] >= 0)) g++; const t = g < NF - 1 ? (g - pre + (0 - X[g]) / (X[g + 1] - X[g])) * DT : 1e9; ft[i] = t; const e = Math.abs(t - ctx.fin[i]); if (e > r.finishTimeErr) r.finishTimeErr = e; } else ft[i] = 1e9 + i;
    }
    const o1 = ft.map((_, i) => i).filter((i) => ctx.finOk[i]).sort((a, b) => ft[a] - ft[b]), o2 = o1.slice().sort((a, b) => ctx.fin[a] - ctx.fin[b]);
    r.finishOrderOk = o1.every((v, k) => v === o2[k]);
    // 途中の順（各直線のまん中の通過順が run と同じか）
    const nt = NT(C);
    for (let k = 0; k < nt; k++) {
      const sig = ctx.E[k] + C.TURN_LEN + CFG.winOut + 8, xs = xOfSig(C, sig), dir = k % 2 === 0 ? -1 : 1, ta = [], tb = [], ids = [];
      for (let i = 0; i < n; i++) { if (ctx.out[i]) continue; const a = ctx.SR[i]; let f = 1; while (f < ctx.F - 1 && a[f] < sig) f++; if (a[f] < sig) continue; let g = pre + Math.max(1, f - 40); const X = O[i].x; while (g < pre + f + 40 && !(dir * (X[g] - xs) < 0 && dir * (X[g + 1] - xs) >= 0)) g++; ids.push(i); ta.push(f - 1 + (sig - a[f - 1]) / (a[f] - a[f - 1])); tb.push(g - pre + (xs - X[g]) / ((X[g + 1] - X[g]) || 1e-9)); }
      const oa = ids.map((_, q) => q).sort((p, q) => ta[p] - ta[q]), ob = ids.map((_, q) => q).sort((p, q) => tb[p] - tb[q]); for (let q = 0; q < oa.length; q++) if (oa[q] !== ob[q]) { r.orderMismatch++; break; }
    }
    return r;
  }
  // 点と、向きのある長方形の距離（中なら負）
  function pointRect(px, pz, cx, cz, fx, fz, hl, hw) { const dx = px - cx, dz = pz - cz, a = Math.abs(dx * fx + dz * fz) - hl, b = Math.abs(-dx * fz + dz * fx) - hw; return a > 0 || b > 0 ? Math.hypot(Math.max(a, 0), Math.max(b, 0)) : Math.max(a, b); }

  /* ---------- 計画を作る ---------- */
  // 計画を作る。万一、最後の検査に通らなかった時は、横と前後の余裕を広げてもう 1 回だけ作り直す（それでも通らなければ plan.ok = false のまま返す。呼ぶ側は今までの置き方に戻す）
  function* planGen(race, run, info) {
    let P = yield* planOnceGen(race, run, info, null);
    /* 作り直しの順: ①横と前後の余裕を広げる ②「内の艇の後ろを横切る」をやめる（直す前の入れ子の線）③ ② で余裕も広げる。最初に合格した物を使う（どれも不合格なら最初の物） */
    const tries = [{ marginW: CFG.marginW + 0.5, marginL: CFG.marginL + 1.5, gapVar: 0, wake: 2.5 }, { behind: false }, { behind: false, marginW: CFG.marginW + 0.5, marginL: CFG.marginL + 1.5, gapVar: 0, wake: 2.5 }];
    /* 合格でも「急な動き」（瞬間移動・速さの飛び・ターンの向きの回る速さが毎秒 80° 超え）がある時は、同じ順で作り直して、いちばん良い物を使う（オーナーの決まり「急にずれる動きもなし」） */
    const score = (Q) => { if (!Q.ok) return 1e9; const c = check(Q._ctx, false); return (c.teleports + c.speedJumps) * 1000 + Math.max(0, c.maxYawRateTurn - 80); };
    let best = P, bs = score(P), ms = P.ms;
    /* 2026-11-18: 横切り（behind・behindK）が 1 つも無いレース（着順指定・形を配り直したレースなど）では、「横切りをやめる」作り直しは前の段と同じ計算になるので飛ばす */
    const cx = P._ctx, hasBeh = (cx.behind && cx.behind.some((a) => a.length)) || (cx.behindK && cx.behindK.some((a) => a.length));
    if (!hasBeh) tries.splice(1, 2);
    for (let q = 0; q < tries.length && bs > 0; q++) { const P2 = yield* planOnceGen(race, run, info, tries[q]); ms += P2.ms; P2.retried = q + 1; const s2 = score(P2); if (s2 < bs) { best = P2; bs = s2; } else best.retried = q + 1; }
    /* 2026-11-18 最後の手: 作り直しを全部試しても不合格の時だけ、「時刻の割り付けを動かさずに、なぞり → ずれだけやり直す」仕上げ（moreFix）を入れてもう 1 回作る。
       決まりと実際の位置が必ず合うので重なりは消えやすいが、ずれが変わった分は道のりに合わせ直さないので、その艇の画面の速さが run と違う（速さの比が崩れる）ため、最後にだけ使う。
       それでも不合格なら、横と前後の余裕を大きく取って（横 ＋1.0m・前後 ＋3.0m。【仮】着順指定の種 3573・4563 で合格した値）もう 1 回（4 艇が 1 つのマークで固まる着順指定のレース） */
    const last = [{ moreFix: 2 }, { moreFix: 3, marginW: CFG.marginW + 1.0, marginL: CFG.marginL + 3.0, gapVar: 0, wake: 1.5 }];
    for (let q = 0; q < last.length && !best.ok; q++) { const P3 = yield* planOnceGen(race, run, info, last[q]); ms += P3.ms; P3.retried = tries.length + 1 + q; if (score(P3) < bs) { best = P3; bs = score(P3); } }
    best.ms = ms; return best;
  }
  function plan(race, run, info) { const g = planGen(race, run, info); let r = g.next(); while (!r.done) r = g.next(); return r.value; }
  /* 時間を分けて計画する（Fire TV 向け）: 1 回に budgetMs ミリ秒ぶんだけ進めて、残りは次の順番に回す。答えは plan() とまったく同じ。
     返り値は Promise。opt.budgetMs（既定 6）、opt.gapMs（区切りの間に空ける ms。既定 0）、opt.onProgress(進んだ区切りの数)。
     区切りは「二次計画の 1 反復」「なぞりの 5 秒ぶん」「艇 1 つの時刻の割り付け」など（Mac で 1 つ 0.5〜4ms）。1 区切りが budgetMs より長いこともある。
     ほかの plan() / planAsync() と同時に走らせない（計算のあいだ CFG を共有するため、前のものが終わってから次を呼ぶ） */
  function planAsync(race, run, info, opt) {
    opt = opt || {}; const budget = opt.budgetMs != null ? opt.budgetMs : 6, now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    const later = (fn) => (typeof setTimeout === 'function' ? setTimeout(fn, opt.gapMs || 0) : fn());
    return new Promise((resolve, reject) => {
      const g = planGen(race, run, info); let steps = 0;
      const tick = () => { try { const t0 = now(); for (;;) { const r = g.next(); steps++; if (r.done) { r.value.steps = steps; resolve(r.value); return; } if (now() - t0 >= budget) break; } if (opt.onProgress) opt.onProgress(steps); later(tick); } catch (e) { reject(e); } };
      later(tick);
    });
  }
  function* planOnceGen(race, run, info, over) {
    const keepCfg = over ? {} : null; if (over) for (const k in over) { keepCfg[k] = CFG[k]; }
    const useCfg = () => { if (over) Object.assign(CFG, over); }, freeCfg = () => { if (over) Object.assign(CFG, keepCfg); };
    useCfg(); try { return yield* planBody(race, run, info, useCfg, freeCfg); } finally { freeCfg(); }
  }
  function* planBody(race, run, info, useCfg, freeCfg) {
    const brk = function* () { freeCfg(); yield; useCfg(); }; // 区切り（その間はほかの計画に CFG を返す）
    info = info || {};
    const C = (info.Course && info.Course.pointAt && info.Course) || (info.course && info.course.pointAt && info.course) || (typeof self !== 'undefined' && self.BOAT && self.BOAT.Course) || (typeof globalThis !== 'undefined' && globalThis.BOAT && globalThis.BOAT.Course);
    if (!C) throw new Error('BOAT.Lines.plan: コース（BOAT.Course）が要る');
    const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()), tStart = now();
    const ctx = { C, race, preT: info.preT != null ? info.preT : CFG.preT, postT: info.postT != null ? info.postT : CFG.postT, seed: info.seed != null ? info.seed : (run.seed != null ? run.seed : 1), iters: 0, repairs: 0, warnings: [] };
    /* レース前はカットなしの続いた動き（資料 15）。cuts は空。info.pitOutT（合図の時刻）だけ外から渡せる。preT が 100 より短い時は、その時刻から途中の場面で始まる */
    ctx.cuts = []; ctx.cutG = []; ctx.pitOutT = info.pitOutT != null ? info.pitOutT : PRE.pitOut; ctx.cutT = PRE.seg[0][2];
    ctx.preF = Math.round(ctx.preT / DT); ctx.gPit = clamp(Math.round((ctx.cutT + ctx.preT) / DT), 0, ctx.preF); ctx.boost = {}; ctx.adapted = 0;
    sampleRun(ctx, race, run, info);
    const n = ctx.n, F = ctx.F, nt = NT(C); ctx.NF = ctx.preF + F;
    if ((run.dist || race.dist) && Math.abs((run.dist || race.dist) - C.DIST) > 1) ctx.warnings.push('run の距離（' + (run.dist || race.dist) + 'm）がコースの道のり（' + C.DIST.toFixed(1) + 'm）と違う。進み具合の割合で合わせた');
    // 型
    const auto = assignTypes(ctx);
    /* describe の型（lines）と余分の道のり（extra） */
    const srcAt = (i) => i; // 着順を指定した再現は、呼ぶ側が BoatModel.describe(race, seed, { swaps: run.swaps }) を渡す（入れ替えのあとの型になっている）
    const hasLines = info.lines && info.lines.length === n; ctx.extraOf = [];
    ctx.types = auto.types.map((au, i) => { const t = [], ex = []; for (let k = 0; k < nt; k++) { const src = hasLines ? srcAt(i, k) : i, a = hasLines ? info.lines[src] : null; t.push(a && TYPE[a[k]] ? a[k] : (a && a[k] === null ? 'A' : au[k])); ex.push(hasLines && info.extra && info.extra[src] ? info.extra[src][k] : null); } ctx.extraOf.push(ex); return t; });
    ctx.kimarite = info.kimarite || auto.kimarite;
    // 線
    ctx.adj = []; ctx.laneOf = [];
    /* 形: 走りの計算が決めた形（describe の shape）をそのまま引く。無い時は型の表から */
    const hasShape = info.shape && info.shape.length === n;
    ctx.shapes = ctx.types.map((tp, i) => { let prevOut = null; return tp.map((t, k) => { const lane = CFG.lanes[ctx.course[i]] != null ? CFG.lanes[ctx.course[i]] : 8 + 5.5 * ctx.course[i], h = hasShape && info.shape[i] && info.shape[i][k], S = h && h.R1 ? { R1: h.R1, R2: h.R2, a: h.a, w: h.w, aim: run.swaps && run.swaps.length ? null : h.aim || null, hold: h.hold || null } : defaultShape(t, k, lane, prevOut); prevOut = turnGeom(S.R1, S.R2, S.a, S.w).wOut; return S; }); });
    /* 着順を指定した再現（run.swaps）で、1 周 1 マークより前に 2 艇の走りを入れ替えたレースは、describe の 1 個目の形が「入れ替えた相手のコース」の物になる
       （例: 1 コースの艇に、5 コースから外を回る形）。そのまま引くと、スタートから 1 マークまでの間に線がほかの艇の筋を横切って押し合いになるので、
       6 艇の形を「入る位置 w の小さい順」に、進入のコースの内から順に配り直す（時刻は run のまま。その 2 艇は 1 マークの前後で画面の速さが run と合わなくなる） */
    if (hasShape) { const ln = (i) => (CFG.lanes[ctx.course[i]] != null ? CFG.lanes[ctx.course[i]] : 8 + 5.5 * ctx.course[i]); let off = false; const sqW = info.scenario && info.scenario.kind === 'shibori-makuri' && !(run.swaps && run.swaps.length) ? info.scenario.attacker : -1; /* 絞りまくりの艇は、入る位置が筋より 5m 以上内でも正しい（走りの計算が、横切った艇の筋へ入る先マイの形にしている）ので、配り直しの理由にしない */ for (let i = 0; i < n; i++) if (i !== sqW && ctx.shapes[i][0] && Math.abs(ctx.shapes[i][0].w - ln(i)) > 5) off = true;
      if (off) { const byLane = ctx.shapes.map((_, i) => i).sort((p, q) => ln(p) - ln(q)), byW = ctx.shapes.map((sh) => sh[0]).sort((p, q) => p.w - q.w), ty = ctx.types.map((t) => t[0]), tyW = ctx.shapes.map((_, i) => i).sort((p, q) => ctx.shapes[p][0].w - ctx.shapes[q][0].w).map((i) => ty[i]); byLane.forEach((i, r) => { ctx.shapes[i][0] = byW[r]; ctx.types[i][0] = tyW[r]; }); ctx.reshaped = true; } }
    /* 1 周 1 マークで「内の艇の後ろを横切ってマークのそばへ入る」艇（走りの計算の shape[i][0].behind ＝ 後ろを通る艇の番号）。
       本物の外の艇は、内の艇の 0.7〜1.2 秒あとに、その後ろを通ってマークのそばを回る【実測 18】。その 2 艇だけ、後ろの艇がマークにいちばん近い所を過ぎるまでは、
       前後が「艇の長さ ＋ 前後の余裕 ＋ crossTaper」離れたら横の決まりを外す（ふだんは ＋ taper）。着順を指定した再現・形を配り直したレースは入れない */
    /* 2026-11-18: 着順を指定した再現でも、入れ替えに関わらない艇どうしには使う（前は全艇で切っていたため、6 コースの最内差しの艇が外の艇の後ろを通れず、線の外 16m まで押し出されて重なった。着順指定の種 3423） */
    // swT[i] ＝ 艇 i が入れ替えに入るいちばん早い時刻。ターン k の出口の 60m 先を過ぎてからの入れ替えは、そのターンの線に関係しない
    const swT = new Array(n).fill(1e9); (run.swaps || []).forEach((q) => { swT[q.a] = Math.min(swT[q.a], q.t); swT[q.b] = Math.min(swT[q.b], q.t); });
    const turnEndT = (i, k) => { const s = ctx.E[k] + C.TURN_LEN + 60, a = ctx.SR[i]; let f = 0; while (f < F - 1 && a[f] < s) f++; return f * DT; }, noSw = (i, k) => CFG.swapAll || swT[i] > turnEndT(i, k || 0);
    ctx.behind = CFG.behind && hasShape && !ctx.reshaped ? info.shape.map((sh, i) => (i === ctx.scratchBoat || i === ctx.fallBoat || !noSw(i, 0) ? [] : ((sh && sh[0] && sh[0].behind) || []).filter((o) => o !== ctx.scratchBoat && o !== ctx.fallBoat && noSw(o, 0)))) : null; // フライング・転覆・入れ替えた艇は入れない
    /* 2026-11-17: 2 個目からのターンで「先頭の後ろへ回り込んで内を差す」逆転の艇（走りの計算の shape[i][k].behind。実測 21 の逆転の型）も同じように扱う（ctx.behindK[i] ＝ [{ o, k }]）。
       着順を指定した再現（入れ替えたあとの型）・フライング・転覆の艇は入れない */
    ctx.behindK = hasShape && !ctx.reshaped ? info.shape.map((sh, i) => { const L = []; if (i === ctx.scratchBoat || i === ctx.fallBoat || !sh) return L; for (let k = 1; k < sh.length; k++) ((sh[k] && sh[k].behind) || []).forEach((o) => { if (o !== ctx.scratchBoat && o !== ctx.fallBoat && noSw(i, k) && noSw(o, k)) L.push({ o, k }); }); return L; }) : null;
    /* 展開（スリットの並びで決まる 1 マークの攻め方）を、スリット〜1 マーク入口の横の位置に入れる【実測 17: ref/boat/research/17_スリットから1マークの実測.md】。
       走りの計算（describe の scenario）が決めた「攻める艇・種類」を使う。動かすのは攻める艇の線だけ（内の艇は、艇どうしの決まり（左右 → ずれ）で内へ押される ＝ 絞られる）。
       ・絞りまくり（shibori-makuri）: スリットから from（38〜40m）まで筋のまま → 傾き rate（0.15 ＝ 横 3.3 m/s）で内へ → 走りの計算が決めた入る位置（横切った艇のうち、いちばん内の艇の筋）で落ち着いて 1 マークへ。
       ・まくり（makuri。前を横切れず、内の艇と並んだまま回る）: 変えない（内へ詰める形も試したが、走りの計算の線では すぐ内の差しの艇が外へ 2m 開くので詰める幅が 約 1m しか無く、そのわりに 1 マークより後ろの並びが変わるレースが出たので入れていない）。
       ・逃げ・差し・まくり差し: 変えない（直す前とまったく同じ線。実測 17 の逃げ: スリットの +1.6 秒から +5.2 秒まで、6 艇の横の並びは ±1m しか動かない）。
       着順を指定した再現で 1 個目の形を配り直したレース（ctx.reshaped）・攻める艇がフライングの艇の時は入れない */
    ctx.approach = []; ctx.scn = null; ctx.press = [];
    { const sc = info.scenario, W = sc && sc.attacker;
      if (sc && W != null && W >= 0 && W < n && !ctx.reshaped && W !== ctx.scratchBoat && sc.kind === 'shibori-makuri' && ctx.shapes[W][0]) {
        const lane = ctx.laneOf.length > W ? ctx.laneOf[W] : (CFG.lanes[ctx.course[W]] != null ? CFG.lanes[ctx.course[W]] : 8 + 5.5 * ctx.course[W]), S = ctx.shapes[W][0];
        const g = turnGeom(S.R1, S.R2, S.a, S.w), dz = lane - g.w, x0 = Math.max(CFG.laneHold, sc.from || 38), xEnd = C.MARK1.x + g.pc - 4 - 6, e = sc.ease || 24, rate0 = sc.rate || 0.15;
        if (dz > 0.5 && xEnd - x0 > 30) {
          const L = Math.min(xEnd - x0, Math.max(2 * e, dz / rate0 + e)), rate = dz / (L - e); // 傾きが 0 → rate（e m かけて）→ rate のまま → 0（e m かけて）。長さ L で dz 寄る
          ctx.approach[W] = (x) => { const u = x - x0; return lane - (u <= 0 ? 0 : u >= L ? dz : u < e ? rate * u * u / (2 * e) : u <= L - e ? rate * (u - e / 2) : dz - rate * (L - u) * (L - u) / (2 * e)); };
          let fEnd = 0; while (fEnd < ctx.F - 1 && ctx.SR[W][fEnd] < xEnd) fEnd++;
          ctx.scn = { kind: sc.kind, attacker: W, from: x0, to: x0 + L, dz, rate, crossed: (sc.crossed || []).slice(), fEnd };
        }
      }
      /* 絞り（2026-11-17 6 回め。オーナー「スタート飛び出た場合は、基本的に内側に絞っていって、進路を 1 マークに向かうにつれて斜めに絞っていく」）:
         走りの計算の scenario.press（内の隣より ST が 0.03 秒以上早い艇は、勝ち負けに関係なく内へ絞る。押された内の艇も寄る）を、スリット〜1 マーク入口の横の位置に入れる。
         形: スリットから from（40m）まで筋のまま → 傾き rate（0.15。実測 17）で dz まで内へ（全艇が同じ所でいちばん寄るよう、いちばん大きい dz の艇の長さにそろえる＝ 押す艇と押される艇の間が詰まりすぎない）
         （着順を指定した再現は入れない: 入れ替えた艇の時刻が scenario と合わない）
         → そこから 1 マークの入口の線（走りの計算が、寄った所から決めた形 shape[0].w）へなめらかに。止められた艇は、ここで引いて差しに回る・外を回る */
      const PR = sc && Array.isArray(sc.press) && !ctx.reshaped && !(run.swaps && run.swaps.length) ? sc.press.filter((q) => q && q.i >= 0 && q.i < n && q.i !== ctx.scratchBoat && !ctx.approach[q.i] && q.dz > 0.05 && ctx.shapes[q.i][0]) : [];
      if (PR.length) {
        const x0 = Math.max(CFG.laneHold, (sc && sc.from) || 38), e = (sc && sc.ease) || 24, e2 = CFG.pressEase2, rate0 = (sc && sc.rate) || 0.15, dzM = Math.max.apply(null, PR.map((q) => q.dz)), L = Math.max(e + e2, dzM / rate0 + (e + e2) / 2);
        const Lr = L - (e + e2) / 2, ramp = (u) => (u <= 0 ? 0 : u >= L ? 1 : u < e ? u * u / (2 * e) / Lr : u <= L - e2 ? (u - e / 2) / Lr : 1 - (L - u) * (L - u) / (2 * e2) / Lr); // 0 → 1（傾きは 0 →（e m）→ 一定 →（e2 m）→ 0）
        ctx.press = [];
        for (const q of PR) { const i = q.i, lane = CFG.lanes[ctx.course[i]] != null ? CFG.lanes[ctx.course[i]] : 8 + 5.5 * ctx.course[i], S = ctx.shapes[i][0], g = turnGeom(S.R1, S.R2, S.a, S.w), xEnd = C.MARK1.x + g.pc - 4, xP = x0 + L, wP = lane - q.dz;
          if (xEnd - xP < 12) continue; // 入口までに戻る道のりが無い（形が大きく手前から回る）時は入れない
          const xm = Math.max(x0, xP - e2); ctx.approach[i] = (x) => lane - q.dz * ramp(x - x0) + (g.w - wP) * sm((x - xm) / (xEnd - xm)); // 入口の線との差（入れ子・型の開く分）は、寄せ終わりの少し手前から入口までかけてなめらかに（急に戻さない）
          ctx.press.push({ i, c: ctx.course[i], dz: q.dz, role: q.role, win: !!q.win, by: q.by, from: x0, to: xP, wIn: g.w }); }
        ctx.pressSet = {}; ctx.press.forEach((q) => { ctx.pressSet[q.i] = true; const cIn = q.c - 1, j = ctx.course.indexOf(cIn); if (q.role === 'press' && j >= 0) ctx.pressSet[j] = true; }); // 絞る艇と、そのすぐ内の艇
      } }
    const makeBase = (i) => { ctx.base[i] = buildBase(boatNodes(C, ctx.laneOf[i], ctx.shapes[i], { scratch: i === ctx.scratchBoat, post: true, approach: ctx.approach[i] })); };
    ctx.base = []; ctx.ELL = []; ctx.E60 = []; ctx.ES = []; ctx.PX = []; ctx.PZ = []; ctx.G = []; ctx.O = []; ctx.on = []; ctx.ratio = []; ctx.winA = []; ctx.winS = []; ctx.winRes = [];
    const f32 = () => new Float32Array(F), f64 = () => new Float64Array(F);
    for (let i = 0; i < n; i++) {
      const lane = CFG.lanes[ctx.course[i]] != null ? CFG.lanes[ctx.course[i]] : 8 + 5.5 * ctx.course[i];
      ctx.adj.push([]); ctx.laneOf.push(lane); ctx.base.push(null); makeBase(i);
      ctx.ELL.push(f64()); ctx.E60.push(f64()); ctx.ES.push(f64()); ctx.PX.push(f64()); ctx.PZ.push(f64()); ctx.ratio.push(f32()); ctx.winA.push(new Array(nt).fill(0)); ctx.winS.push(new Array(nt).fill(0)); ctx.winRes.push(new Array(nt).fill(0));
      ctx.G.push({ x: f64(), z: f64(), tx: f64(), tz: f64(), kp: f64(), v: f64(), lat: f32(), lon: f32(), str: f32(), lo: f32(), hi: f32(), kn: new Uint8Array(F) });
      const NF = ctx.NF; ctx.O.push({ x: new Float64Array(NF), z: new Float64Array(NF), hd: new Float64Array(NF), speed: new Float64Array(NF), yr: new Float64Array(NF), turn: new Float32Array(NF), slip: new Float32Array(NF), acc: new Float32Array(NF), dir: new Int8Array(NF) });
      ctx.on.push(new Uint8Array(F).fill(1));
    }
    const pass = function* () { for (let i = 0; i < n; i++) { retime(ctx, i); yield* brk(); } geometry(ctx); yield* brk(); if (ctx.scratchBoat >= 0) { const i = ctx.scratchBoat, b = ctx.base[i]; for (let f = 0; f < F; f++) ctx.on[i][f] = ctx.ELL[i][f] < b.len - 4 ? 1 : 0; } };
    ctx.onG = (i, g) => (g < ctx.preF ? 1 : ctx.on[i][g - ctx.preF]);
    // 線の上の時刻の割り付け → 左右を決める → ずれを解く、を CFG.outer 回くり返す（ずれると道のりが変わり、時刻の割り付けも少し変わるため）
    /* 1 回めのあと: ターンの入口側・出口側で線からのずれがずっと大きい艇は、型の寸法そのものをその分だけ直して線を引き直す
       （例: 先に回った艇の内へ入るはずの型なのに外にいる → 外を回る線に。こうすると、ずれが小さくなって線がなめらかになる） */
    const adapt = () => {
      let any = false;
      for (let i = 0; i < n; i++) {
        const b = ctx.base[i], e = ctx.E60[i], ell = ctx.ELL[i]; let ch = false;
        for (let k = 0; k < (i === ctx.scratchBoat ? 1 : nt); k++) {
          if (b.apex[k] == null) continue; const ap = b.apex[k] * b.ds; let s1 = 0, n1 = 0, s2 = 0, n2 = 0;
          for (let f = 0; f < F; f += 3) { const d = ell[f] - ap; if (d < -70) continue; if (d > 130) break; if (!ctx.on[i][f] || ctx.G[i].v[f] < 3) continue; if (d < 0) { s1 += e[f]; n1++; } else { s2 += e[f]; n2++; } }
          const m1 = n1 > 5 ? s1 / n1 : 0, m2 = n2 > 5 ? s2 / n2 : 0;
          if (Math.abs(m1) > CFG.adaptMin || Math.abs(m2) > CFG.adaptMin) { const a = ctx.adj[i][k] || (ctx.adj[i][k] = { din: 0, dout: 0 }); a.din = clamp(a.din + 0.7 * m1, -8, 12); a.dout = clamp(a.dout + 0.7 * m2, -16, 12); ch = true; ctx.adapted++; }
        }
        if (ch) { makeBase(i); ctx.E60[i].fill(0); ctx.ES[i].fill(0); any = true; }
      }
      if (any) ctx.knots = null; return any;
    };
    /* 道のり合わせ: ほかの艇をよけた分・線をならした分で、線の長さが走りの計算の道のり（物差し ＋ shape.geo）からずれる。
       ずれが 1.5% を超えるターンは、回る大きさ（R1・R2。内へ切り込む型は入る位置も）をその分だけ変えて線を引き直す → 画面の速さが run の速さと合う */
    const INSIDE_T = { B: 1, D: 1, F: 1 };
    const fitLen = () => {
      let any = false;
      for (let i = 0; i < n; i++) {
        let ch = false;
        for (let k = 0; k < (i === ctx.scratchBoat ? 1 : nt); k++) {
          const A = ctx.winA[i][k]; if (!(Math.abs(A) > CFG.fitTol) || !ctx.winS[i][k]) continue;
          const S = ctx.shapes[i][k], S0 = S.base || (S.base = { R1: S.R1, R2: S.R2, w: S.w, sc: 1 }), inn = INSIDE_T[ctx.types[i][k]] ? 1 : 0;
          const geoAt = (sc) => turnGeom(S0.R1 * sc, S0.R2 * sc, S.a, S0.w + inn * S0.R1 * (sc - 1)), want = geoAt(S0.sc).geo - 0.8 * A * ctx.winS[i][k];
          let lo = CFG.fitScale[0], hi = CFG.fitScale[1]; for (let q = 0; q < 14; q++) { const m = (lo + hi) / 2; if (geoAt(m).geo < want) lo = m; else hi = m; }
          let sc = (lo + hi) / 2; const cap = k % 2 === 0 ? 62 : 37; while (sc > CFG.fitScale[0] && geoAt(sc).wOut > cap) sc -= 0.01;
          if (Math.abs(sc - S0.sc) < 0.004) continue;
          S0.sc = sc; S.R1 = S0.R1 * sc; S.R2 = S0.R2 * sc; S.w = S0.w + inn * S0.R1 * (sc - 1); ch = true;
        }
        if (ch) { makeBase(i); any = true; }
      }
      return any;
    };
    yield* pass();
    /* 2026-11-18: 先頭が内へ締めるターン（shape.aim ＝ 'lead'）で、絵の上で締める区間（マークの hold ＋ leadSpan m 手前〜hold m 手前）に、内側に並んでいる艇（前後が船体 1 つ＋1.5m 以内）がいたら、
       そのターンは締めない（前の出口の筋のまま入る）。走りの計算の時刻と絵の位置が数 m ずれるレースで、締めた先頭が内の艇を押しのけて横に大きく揺れていた（フライング・前付けのレースで横の加速度 6〜7 m/s²）【規程 19 条: 並ばれてから寄せない】 */
    { let any = false;
      for (let i = 0; i < n; i++) for (let k = 1; k < nt; k++) { const S = ctx.shapes[i][k]; if (!S || S.aim !== 'lead' || !S.hold) continue;
        const s0 = ctx.E[k] - S.hold - CFG.leadSpan - 10, s1 = ctx.E[k] - S.hold, G = ctx.G; let hit = false;
        for (let f = 0; f < F && !hit; f += 3) { const sg = ctx.SR[i][f]; if (sg < s0) continue; if (sg > s1) break;
          for (let j = 0; j < n && !hit; j++) { if (j === i || !ctx.on[j][f]) continue; const dx = G[j].x[f] - G[i].x[f], dz = G[j].z[f] - G[i].z[f], along = dx * G[i].tx[f] + dz * G[i].tz[f];
            if (Math.abs(along) < HULL_L + 1.5 && Math.sign(G[j].z[f]) === Math.sign(G[i].z[f]) && Math.abs(G[j].z[f]) < Math.abs(G[i].z[f]) - 0.5) hit = true; } }
        if (hit) { const prev = ctx.shapes[i][k - 1], pw = prev ? turnGeom(prev.R1, prev.R2, prev.a, prev.w).wOut : S.w; ctx.shapes[i][k] = Object.assign({}, S, { aim: null, hold: null, w: Math.max(S.w, Math.min(pw, 2 * S.R1 - S.a - 1)) }); makeBase(i); any = true; ctx.leadDropped = (ctx.leadDropped || 0) + 1; } }
      if (any) yield* pass(); }
    /* 転覆した艇がマークのそばに止まっている時: そのあと同じマークを回る艇（次の周・ゴール後）は、止まった艇の外を回る形にしておく（01 1-11「事故艇の外を回る」）。
       マークから止まった艇まで d m なら、マークから d ＋ stopClear ＋ 0.5 m より外を通る（a を広げ、弧もその分だけ大きく）。d ＋ 間 が 24m を超える時は形を変えない（左右の決まりがよける） */
    if (ctx.fallBoat >= 0 && ctx.fallT != null) {
      const fb = ctx.fallBoat, wx = ctx.G[fb].x[F - 1], wz = ctx.G[fb].z[F - 1]; let any = false;
      for (let par = 0; par < 2; par++) { const M = par === 0 ? C.MARK1 : C.MARK2, d = Math.hypot(wx - M.x, wz - M.z); if (d > 30) continue; const aMin = d + CFG.stopClear + 0.5; if (aMin > 24) continue;
        let kf = 0; while (kf < nt && ctx.E[kf] + C.TURN_LEN + 60 < ctx.SR[fb][F - 1]) kf++;
        for (let i = 0; i < n; i++) { if (i === fb) continue; for (let k = kf + 1; k <= nt; k++) { if (k % 2 !== par) continue; /* 転覆したそのターンを後から回る艇の形は変えない（変えると、転覆の前から外へ逃げる動きになり、線も荒れた）。左右の決まりがよける */ const S0 = ctx.shapes[i][k] || Object.assign({}, SHAPE_P); if (S0.a >= aMin) { ctx.shapes[i][k] = S0; continue; }
          const ratio = S0.R2 / S0.R1, a = aMin, w = Math.max(S0.w, a + 4), R1 = Math.max(S0.R1 + (a - S0.a) * 0.5, (w + a) / 2 + 1); ctx.shapes[i][k] = { R1, R2: R1 * ratio, a, w }; any = true; } } }
      if (any) { for (let i = 0; i < n; i++) if (i !== fb) makeBase(i); ctx.wreckShapes = true; yield* pass(); }
    }
    for (let it = 0; it < CFG.outer; it++) { yield* sweepGen(ctx); yield* solveOffsetsGen(ctx, null); yield* pass(); if (it === 0 && CFG.adapt && !hasLines && adapt()) yield* pass(); }
    for (let it = 0; it < CFG.fitRounds; it++) { if (!fitLen()) break; ctx.fits = (ctx.fits || 0) + 1; yield* pass(); yield* sweepGen(ctx); yield* solveOffsetsGen(ctx, null); yield* pass(); }
    world(ctx); yield* brk(); preRace(ctx, info); yield* brk();
    /* 仕上げ: 全コマ検査して、すき間が足りなかった 2 艇・その時刻の前後だけ「横の間を広く・前後の見込みを長く」して、もう 1 回同じ手順（左右 → ずれ → 時刻）で作り直す。
       その場しのぎの押し分けはしない（線が荒れるため）。最大 CFG.repairMax 回 */
    const pre0 = ctx.preF; let chk = check(ctx, true); ctx.bad0 = chk.bad.length;
    /* 2026-11-18: すき間が足りない所がある時は、まず同じ手順（左右 → ずれ → 時刻）をあと outerMore 回くり返す（なぞりが前の回の解から始まるので、くり返すほど決まりが実際の位置に合う）。
       合格しているレースは何もしない（計算の時間は増えない） */
    ctx.more = 0; ctx.inMore = true;
    const badScore = (q) => q.overlapFrames * 1000 + q.bad.length;
    // いちばん良かった状態（線の上の進み・ずれ）を覚えておき、悪くなったら戻す（くり返しが行ったり来たりする時。着順指定の種 3139）
    const snap = () => ({ ELL: ctx.ELL.map((a) => a.slice()), E60: ctx.E60.map((a) => a.slice()), ratio: ctx.ratio.map((a) => a.slice()), on: ctx.on.map((a) => a.slice()), knots: ctx.knots, chk });
    const back = function* (S) { for (let i = 0; i < n; i++) { ctx.ELL[i].set(S.ELL[i]); ctx.E60[i].set(S.E60[i]); ctx.ratio[i].set(S.ratio[i]); ctx.on[i].set(S.on[i]); } ctx.knots = S.knots; geometry(ctx); yield* brk(); world(ctx); yield* brk(); chk = S.chk; };
    let best = snap();
    while (chk.bad.length && ctx.more < CFG.outerMore) { ctx.more++; yield* sweepGen(ctx); yield* solveOffsetsGen(ctx, null); yield* pass(); world(ctx); yield* brk(); chk = check(ctx, true); yield* brk(); if (badScore(chk) < badScore(best.chk)) best = snap(); }
    if (badScore(chk) > badScore(best.chk)) yield* back(best);
    while (chk.bad.length && ctx.repairs < CFG.repairMax) {
      ctx.repairs++;
      for (const v of chk.bad) {
        const key = v.a * n + v.b, list = ctx.boost[key] || (ctx.boost[key] = []); let hit = null;
        for (const q of list) if (v.f >= q.f0 - 30 && v.f <= q.f1 + 30 && q.rep === ctx.repairs) { hit = q; break; }
        if (hit) { hit.f0 = Math.min(hit.f0, v.f); hit.f1 = Math.max(hit.f1, v.f); hit.dW = Math.max(hit.dW, CFG.clear - v.g + 0.25); }
        else list.push({ f0: v.f, f1: v.f, dW: CFG.clear - v.g + 0.25, dL: 2.5, rep: ctx.repairs });
      }
      yield* sweepGen(ctx); yield* solveOffsetsGen(ctx, null); yield* pass(); world(ctx); yield* brk(); chk = check(ctx, true); yield* brk(); if (badScore(chk) < badScore(best.chk)) best = snap();
    }
    if (badScore(chk) > badScore(best.chk)) yield* back(best); // 作り直しで悪くなっていたら、いちばん良かった状態へ
    /* それでも残った所（左右をなぞった時の前後の間と、解いたあとの前後の間が食い違った所）は、後ろの艇の「線の上の進み」を少しだけ遅らせて前後に離す。
       2.5 秒かけてなめらかに遅らせ、2.5 秒かけて戻す（見た目だけの前後の調整。最大でも数 m。線・順番・ゴールの時刻は変えない） */
    ctx.shifts = 0; ctx.shiftMax = 0; const nShift = {};
    /* 2026-11-18: 前後の調整の 1 回ごとに、良くなったかを見る（重なりのコマ × 1000 ＋ すき間の足りないコマ）。悪くなった回は元に戻してやめる
       （前は、すき間が少し足りないだけの所を調整して、別の所で本物の重なりを作ったまま終わることがあった。着順指定の種 3211） */
    for (let round = 0; chk.bad.length && round < CFG.shiftMax; round++) {
      const keepELL = ctx.ELL.map((a) => a.slice()), keepRatio = ctx.ratio.map((a) => a.slice()), keepShifts = [ctx.shifts, ctx.shiftMax], keepN = Object.assign({}, nShift), chk0 = chk;
      const groups = {};
      for (const v of chk.bad) { const key = v.a * n + v.b, gq = groups[key] || (groups[key] = []); let hit = null; for (const q of gq) if (v.f <= q.f1 + 20) { hit = q; break; } if (hit) { hit.f1 = Math.max(hit.f1, v.f); if (v.g < hit.g) { hit.g = v.g; hit.fm = v.f; } } else gq.push({ a: v.a, b: v.b, f0: v.f, f1: v.f, fm: v.f, g: v.g }); }
      for (const key in groups) for (const q of groups[key]) {
        const g = pre0 + q.fm, A = ctx.O[q.a], Bo = ctx.O[q.b], hx = Math.cos(A.hd[g]) + Math.cos(Bo.hd[g]), hz = -Math.sin(A.hd[g]) - Math.sin(Bo.hd[g]), hl = Math.hypot(hx, hz) || 1;
        const al = ((A.x[g] - Bo.x[g]) * hx + (A.z[g] - Bo.z[g]) * hz) / hl; // 正なら a が前
        const rear0 = al >= 0 ? q.b : q.a, front0 = al >= 0 ? q.a : q.b;
        const need = Math.max(0.8, Math.min(HULL_L + CFG.clear + 0.5 - Math.abs(al), 4.5), CFG.clear - q.g + 0.5);
        const R = clamp(Math.round(need * 1.5 / (CFG.shiftRate * Math.max(8, ctx.G[rear0].v[q.fm])) * 60), 150, 900); // 遅らせる・戻す長さ: 速さの変わりが shiftRate（2%）までになるように
        // 動かしてよい艇と範囲: 止まった艇は動かさない。ゴール線を切る時刻（とスタート線）をまたぐ範囲は動かさない
        const span = (i) => { if (ctx.G[i].v[q.fm] < 2 || (i === ctx.fallBoat && ctx.fallT != null && q.fm * DT > ctx.fallT - 0.3)) return null; const R2 = R + 60 * (nShift[i] || 0), ff = ctx.finOk[i] ? Math.floor(ctx.fin[i] / DT) : 1e9, fs = Math.ceil(Math.max(0, ctx.stSec[i]) / DT) + 2; let fa = Math.max(1, q.f0 - R2), fb = q.f1 + R2;
          if (q.f0 <= ff + 1 && q.f1 >= ff - 1) return null; if (q.f0 <= fs) return null;
          if (q.f0 > ff) fa = Math.max(fa, ff + 2); else if (fb >= ff - 1) fb = ff - 2; if (fa < fs) fa = fs; if (q.f0 - fa < 20 || (fb - q.f1 < 20 && fb < F - 1)) return null; return { fa, fb }; };
        let who = rear0, sgn = -1, sp = span(rear0); if (!sp) { who = front0; sgn = 1; sp = span(front0); } if (!sp) continue;
        nShift[who] = (nShift[who] || 0) + 1; const ell = ctx.ELL[who], fa = sp.fa, fb = sp.fb;
        for (let f = fa; f < F; f++) { const w = f < q.f0 ? sm((f - fa) / (q.f0 - fa)) : f > q.f1 ? (fb >= F - 1 ? 1 : sm((fb - f) / (fb - q.f1))) : 1; if (w <= 0 && f > q.f1) break; ell[f] += sgn * need * w; if (ctx.ratio[who][f] === 1) ctx.ratio[who][f] = 0.9999; } // 計画の終わりにかかる時は、戻さずそのまま
        ctx.shifts++; if (need > ctx.shiftMax) ctx.shiftMax = need;
      }
      geometry(ctx); yield* brk(); world(ctx); yield* brk(); chk = check(ctx, true); yield* brk();
      if (badScore(chk) >= badScore(chk0)) { // 良くならなかった: この回の調整を捨てて元に戻す
        for (let i = 0; i < n; i++) { ctx.ELL[i].set(keepELL[i]); ctx.ratio[i].set(keepRatio[i]); } ctx.shifts = keepShifts[0]; ctx.shiftMax = keepShifts[1]; for (const k in nShift) delete nShift[k]; Object.assign(nShift, keepN);
        geometry(ctx); yield* brk(); world(ctx); yield* brk(); chk = chk0; ctx.shiftUndo = (ctx.shiftUndo || 0) + 1; break;
      }
    }
    /* 最後の手（ここまでで足りない時だけ）: 時刻の割り付け（線の上の進み）は動かさずに、なぞり → ずれだけをやり直す（moreFix 回まで）。時刻の割り付けを変えないので、なぞりで作った横の決まりが
       そのまま最後の位置の決まりになる（くり返しのたびに割り付けが数十 m 動いて、決まりと実際の位置が食い違う行ったり来たりを止める。転覆の種 2210）。
       代わりに、ずれが変わった分は道のりに合わせ直さないので、その艇の画面の速さが run と少し違う（速さの比が 0.95〜1.05 を外れることがある） */
    ctx.fixN = 0;
    while (chk.bad.length && ctx.fixN < CFG.moreFix) { ctx.fixN++; const keepE = ctx.E60.map((a) => a.slice()), keepK = ctx.knots, chk0 = chk; yield* sweepGen(ctx); yield* solveOffsetsGen(ctx, null); world(ctx); yield* brk(); chk = check(ctx, true); yield* brk();
      if (badScore(chk) >= badScore(chk0)) { for (let i = 0; i < n; i++) ctx.E60[i].set(keepE[i]); ctx.knots = keepK; world(ctx); yield* brk(); chk = chk0; break; } } // 良くならなければ元に戻す
    ctx.ok = chk.bad.length === 0 && chk.overlapFrames === 0; ctx.ms = now() - tStart;
    return makePlan(ctx);
  }
  function makePlan(ctx) {
    const n = ctx.n, O = ctx.O, pre = ctx.preF, NF = ctx.NF, cgs = ctx.cutG, outArr = [];
    for (let i = 0; i < n; i++) outArr.push({ x: 0, z: 0, yaw: 0, speed: 0, accel: 0, turn: 0, turnDir: 1, slip: 0, phase: 'pit', on: true });
    const lineT = ctx.stSec.slice();
    const phaseOf = (i, t) => {
      if (t < ctx.cutT) return 'pit';
      if (t < ctx.kickT[i]) return 'wait';
      if (t < lineT[i]) return 'runup';
      if (i === ctx.scratchBoat) return t < lineT[i] + 13 ? 'race' : 'out'; // フライング: +13 秒ごろ「返還艇」（01 1-10）
      if (i === ctx.fallBoat && ctx.fallT != null && t >= ctx.fallT) return 'out';
      return ctx.finOk[i] && t >= ctx.fin[i] ? 'after' : 'race';
    };
    const P = {
      t0: -ctx.preT, t1: ctx.t1, dt: DT, n, cuts: ctx.cuts.slice(), pitOutT: ctx.pitOutT,
      /* 場面（カメラの台本用）: name ＝ pit／buoy／back／turn2／wait／runup、t0〜t1 ＝ ゲームの秒（＝ 本物の時刻。real0 も同じ。カットで飛ばさない） */
      segments: PRE.seg.filter((q) => q[2] > -ctx.preT).map((q) => ({ name: q[0], t0: Math.max(-ctx.preT, q[1]), t1: q[2], real0: Math.max(-ctx.preT, q[1]) })), faceT: (ctx.preFaceT || []).slice(), waitZ: (ctx.preWaitZ || []).slice(), preSep: ctx.preSep || 0,
      ok: ctx.ok, ms: ctx.ms, repairs: ctx.repairs, shifts: ctx.shifts, shiftMax: ctx.shiftMax, solves: ctx.solves, adapted: ctx.adapted, iters: ctx.iters, warnings: ctx.warnings,
      types: ctx.types, kimarite: ctx.kimarite, scenario: ctx.scn, press: ctx.press || [], course: ctx.course.slice(), st: ctx.stSec.slice(), kickT: ctx.kickT.slice(), finish: ctx.fin.slice(), speedScale: ctx.winA,
      at(t) {
        let g = (t - P.t0) / DT; if (g < 0) g = 0; if (g > NF - 1.001) g = NF - 1.001; let k = Math.floor(g), f = g - k;
        if (cgs.indexOf(k + 1) >= 0) f = 0; // カットをまたいで補間しない
        for (let i = 0; i < n; i++) {
          const o = outArr[i], A = O[i], a = A.hd[k] + A.slip[k]; let b = A.hd[k + 1] + A.slip[k + 1] - a; while (b > Math.PI) b -= 2 * Math.PI; while (b < -Math.PI) b += 2 * Math.PI;
          o.x = A.x[k] + (A.x[k + 1] - A.x[k]) * f; o.z = A.z[k] + (A.z[k + 1] - A.z[k]) * f; o.yaw = a + b * f; o.speed = A.speed[k] + (A.speed[k + 1] - A.speed[k]) * f;
          o.turn = A.turn[k] + (A.turn[k + 1] - A.turn[k]) * f; o.turnDir = A.dir[k]; o.slip = A.slip[k] + (A.slip[k + 1] - A.slip[k]) * f; o.heading = A.hd[k]; o.accel = A.acc[k] + (A.acc[k + 1] - A.acc[k]) * f; o.phase = phaseOf(i, t); o.on = !!ctx.onG(i, k);
        }
        return outArr;
      },
      check() { const r = check(ctx, false); delete r.bad; { const q = checkPre(ctx), at = q.at; delete q.at; Object.assign(r, q); Object.assign(r.at, at); } r.ms = ctx.ms; r.repairs = ctx.repairs; r.shifts = ctx.shifts; r.shiftMax = ctx.shiftMax; r.ok = ctx.ok; return r; },
      _ctx: ctx,
    };
    return P;
  }
  // 型の形の「物差し（直線 ＋ 半径 RC の半円）より長い道のり」m（マイナスは近道）。走りの計算の shape.geo と同じ数
  function typeExcess(C, type, k, lane) { const S = defaultShape(type, k || 0, lane == null ? CFG.lanes[0] : lane, null); return turnGeom(S.R1, S.R2, S.a, S.w).geo - C.TURN_LEN; }
  return { plan, planAsync, CFG, TYPE, SHAPE, turnGeom, PRE, HULL_L, HULL_W, DT, assignTypes, typeExcess, obbGap, _buildBase: buildBase, _boatNodes: boatNodes };
});
