/* casa DERBY 3D 版の照明・画作り（ライティング担当）。
   R3D.Look.setup(renderer, scene, { quality, style }) -> look
     look.setWeather('sunny'|'cloudy'|'rain')   空・霧・光・雨の粒をまとめて切り替える
     look.update(dt, camera)                    影の範囲をカメラの見ている所へ追従、霧の距離、雲と雨を動かす
     look.render(renderer, scene, camera)       描画（'high' のときだけ軽い仕上げを 1 枚重ねる。'low' は後処理なし）
     look.setStyle('arcade'|'broadcast')        画作りの方針の切り替え（任意。既定は 'arcade'。?look=broadcast でも切り替え可）
     look.setCues(cues)                         隠れた確定演出（2026-10-16）: cues = { cloud: { horse: 0..5 }, … }。このファイルが受け持つのは cloud だけ
                                                （空の雲の 1 つが、馬番 horse+1 の数字の形に見える。縁がくっきり・まわりより明るい雲。置き場所は placeDigit。高さは 5.2 度より小さくしない）。
                                                ほかの鍵（fruit / crowd / sign）は無視（会場 venue.setCues の担当）。いつ呼んでもよく、すぐ効く。
                                                cues が null、または cloud が無い・null なら、ふつうの雲に戻る。look.cues で今の値を読める
   画作りの方針
   - 'arcade'（既定）: 「みんなでダービー」風。明るく鮮やかな昼、青い空にふんわりした白い雲、柔らかく薄い影、霞はほとんど無し。
   - 'broadcast': 日本の競馬中継風。少し暖かい日差し、落ち着いた芝の色、遠くが青白く霞む望遠の絵。

   色の約束（全員に効く。このファイルは r3d の部品より先に読み込むこと）
   - THREE.ColorManagement.legacyMode = false … '#7fae4a' のような色指定は sRGB として扱われ、画面にはほぼその色で出る。
   - 出力は sRGB。色のテクスチャ（map / emissiveMap）は sRGBEncoding にする（設定し忘れはこのファイルが見回って直す）。
   - 明るさの基準: 日なたの水平な地面は、指定した色とほぼ同じ明るさで出る（arcade は少し明るく鮮やか）。 */
window.R3D = window.R3D || {};
(function () {
  'use strict';
  if (window.THREE && THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
  if (!window.THREE) return;
  // 霧: 「near より先で指数的にかすむ」空気遠近に（far-near が 63% かすむ距離）。THREE.Fog のときだけ
  const ff = THREE.ShaderChunk.fog_fragment;
  if (ff.indexOf('smoothstep( fogNear, fogFar, vFogDepth )') >= 0) {
    THREE.ShaderChunk.fog_fragment = ff.replace('float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );',
      'float fogFactor = 1.0 - exp( - max( vFogDepth - fogNear, 0.0 ) / max( fogFar - fogNear, 1.0 ) );');
  }
})();

R3D.Look = (function () {
  'use strict';

  /* ---------- トーンマップ（全体のシェーダの部品を差し替え。方針ごとに定数を焼き込む） ----------
     ACES の近似（Narkowicz）の曲線を「明るさ」にかけて色味（色相・彩度）を保ち、明るい所だけ色ごとの曲線に寄せて白く飛ばす。
     ACES をそのまま色ごとにかけると芝が蛍光色になるのを避けるため。sat は彩度、warm は色温度、lift は黒の浮き */
  const TP0 = THREE.ShaderChunk.tonemapping_pars_fragment;
  const TM_DEFAULT = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  const f3 = (v) => (Math.round(v * 1e4) / 1e4).toFixed(4);
  function applyTone(tm) {
    const fn = [
      'vec3 lookAces( vec3 x ) { return ( x * ( 2.51 * x + 0.03 ) ) / ( x * ( 2.43 * x + 0.59 ) + 0.14 ); }',
      'vec3 CustomToneMapping( vec3 color ) {',
      '  color = max( color * toneMappingExposure * vec3( ' + tm.warm.map(f3).join(', ') + ' ), 0.0 );',
      '  float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );',
      '  color = max( mix( vec3( l ), color, ' + f3(tm.sat) + ' ), 0.0 );',
      '  vec3 a = color * ( lookAces( vec3( l ) ).x / max( l, 1e-4 ) );',
      '  vec3 b = lookAces( color );',
      '  float k = smoothstep( 0.35, 1.2, max( max( a.r, a.g ), a.b ) );',
      '  color = mix( a, b, ' + f3(tm.pc) + ' + ' + f3(1 - tm.pc) + ' * k );',
      '  color = color * ' + f3(1 - tm.lift) + ' + ' + f3(tm.lift) + ';',
      '  return clamp( color, 0.0, 1.0 );',
      '}'].join('\n');
    if (TP0.indexOf(TM_DEFAULT) >= 0) THREE.ShaderChunk.tonemapping_pars_fragment = TP0.replace(TM_DEFAULT, fn);
  }

  /* ---------- 方針と天気ごとの値 ----------
     光の色は sRGB の指定、強さは physicallyCorrectLights=false の値。
     空・霧の色（zenith / horizon / below / cloud*）は「画面にそのまま出る色」（霧は r149 では色の変換のあとに混ぜるため）。
     soft は雲の縁の柔らかさ、fogOff/fogRange はカメラから fogOff 先で霞み始め fogRange で 63% 霞む距離、fog は霞の色（無ければ horizon）、fill は補助光の強さ（無ければ方針の値）。 */
  const STYLES = {
    // みんなでダービー風: 明るく鮮やか、霞はほとんど無し
    // 2026-10-14 質感とライティングの統一（ChatGPT v2 講評 1 の 2）: 太陽は 5800K 前後の昼光、環境光（空の光）は太陽の 4〜5 割に下げて形の陰影を出す
    // （前は空の光が太陽とほぼ同じ強さで、白いラチ・ゲートがのっぺり白く飛んでいた）。日なたの地面の明るさは前と同じ（太陽を強めたぶん空の光を減らした）
    arcade: {
      tm: { sat: 1.02, warm: [1.0, 1.0, 1.0], pc: 0.12, lift: 0.0 },
      grain: 0.0,
      shadowMap: 2048,
      fill: 0.26,        // カメラ側からの補助光（逆光でも馬の顔が暗くならないように。地面にはほとんど当たらない低い角度）。強いと手前の面がのっぺりするので控えめ
      backlit: 0.28,     // 太陽の方を向いたときに露出を上げる量（カメラの絞りを開けるのと同じ）
      weathers: {
        sunny: {
          // 水平な地面: 太陽 1.52×0.775＝1.18、空の光 0.55×（空の色の明るさ 約 0.9）＝0.50 → 環境光は太陽の約 42%（2026-10-14 92→95 の 6: 48% と 40〜45% を撮りくらべ、
          // 形の陰影が少し締まる 42% に。太陽は 1.05 倍、日なたの地面の明るさは前と同じ。馬の顔が暗くならないよう補助光を 0.26→0.32）
          exposure: 0.6,
          sun: '#fff1e4', sunI: 1.52,
          sky: '#d6e6fb', gnd: '#9cbf80', hemiI: 0.55, fill: 0.32,
          amb: '#ffffff', ambI: 0.03,
          zenith: '#2d84ea', horizon: '#bfe4ff', below: '#b3d98f',
          glow: 0.7, disk: 1.0,
          cover: 0.54, soft: 0.07, cloudLit: '#ffffff', cloudShade: '#c7d6ee', cloudA: 1.0,
          fogOff: 140, fogRange: 1400, fog: '#b0c4c2',   // 空気遠近: 140m までは無し（コースの手前・馬はくっきり）、奥の直線（約 350m）で 14%、遠くの街（約 600m）で 28%、灰緑（#A6B9B3 寄り）へ寄せて彩度を落とす
          rain: 0, wet: 0, vignette: 0.07, tint: [1.0, 1.0, 1.0],
        },
        cloudy: {
          // 曇りは空の光が主（環境光は太陽の約 1.4 倍）。前より少しだけ太陽を足して形を出す
          exposure: 0.64,
          sun: '#f9f6f1', sunI: 0.72,
          sky: '#e6edf6', gnd: '#a3bb82', hemiI: 0.98,
          amb: '#ffffff', ambI: 0.04,
          zenith: '#86a9d6', horizon: '#d8e7f4', below: '#b7cfa6',
          glow: 0.3, disk: 0.0,
          cover: 0.30, soft: 0.12, cloudLit: '#f7f9fc', cloudShade: '#b5c3d6', cloudA: 1.0,
          fogOff: 120, fogRange: 1500, fog: '#b8c7ca',
          rain: 0, wet: 0, vignette: 0.07, tint: [1.0, 1.0, 1.0],
        },
        rain: {
          // 2026-10-14: 雨の明るさは晴れの 85〜90%（地面は 12〜18% 暗く）に。前は地面が晴れの 7〜8 割で暗すぎた
          exposure: 0.64,
          sun: '#e6ebf2', sunI: 0.42,
          sky: '#d2dce8', gnd: '#8ea476', hemiI: 1.06,
          amb: '#ffffff', ambI: 0.04,
          zenith: '#7b8da4', horizon: '#bac8d6', below: '#9fb29a',
          glow: 0.1, disk: 0.0,
          cover: 0.12, soft: 0.18, cloudLit: '#ccd4de', cloudShade: '#8794a6', cloudA: 1.0,
          fogOff: 80, fogRange: 1000, fog: '#a9b8bb',   // 雨: 手前 80m はくっきり、奥は晴れより早めに霞む（200m で 11%、400m で 27%）
          rain: 1, wet: 1, vignette: 0.1, tint: [0.99, 1.0, 1.02],
        },
      },
    },
    // 中継風: 日なたの水平な地面がほぼ指定した色、日陰が日なたの 3 割ほど。遠くが青白く霞む
    broadcast: {
      tm: { sat: 1.0, warm: [1.02, 1.0, 0.97], pc: 0.25, lift: 0.006 },
      grain: 0.025,
      shadowMap: 2048,
      fill: 0.0,
      backlit: 0.22,
      weathers: {
        sunny: {
          exposure: 0.62,
          sun: '#fff0d8', sunI: 1.3,                         // 日差し（少し暖かい）
          sky: '#cfe0ff', gnd: '#9fae6e', hemiI: 0.56,         // 空からの青い光と、芝の照り返し
          amb: '#ffffff', ambI: 0.03,
          zenith: '#6c9bdc', horizon: '#c9d7e2', below: '#a9b6a6', // 空の色・地平線（＝霧の色）
          glow: 1.0, disk: 1.0,
          cover: 0.56, soft: 0.22, cloudLit: '#ffffff', cloudShade: '#c3ccd8', cloudA: 0.92,
          fogOff: 100, fogRange: 1500,
          rain: 0, wet: 0, vignette: 0.16, tint: [1.0, 1.0, 0.985],
        },
        cloudy: {
          exposure: 0.64,
          sun: '#f6f3ee', sunI: 0.55,
          sky: '#e6ebf2', gnd: '#96a07a', hemiI: 1.0,
          amb: '#ffffff', ambI: 0.04,
          zenith: '#b4bfcb', horizon: '#dde2e6', below: '#b5bcb4',
          glow: 0.35, disk: 0.0,
          cover: 0.30, soft: 0.22, cloudLit: '#f2f4f6', cloudShade: '#aab2bd', cloudA: 0.95,
          fogOff: 100, fogRange: 1000,
          rain: 0, wet: 0, vignette: 0.14, tint: [0.995, 1.0, 1.01],
        },
        rain: {
          exposure: 0.55,
          sun: '#e0e6ee', sunI: 0.22,
          sky: '#cdd5df', gnd: '#727c64', hemiI: 1.0,
          amb: '#ffffff', ambI: 0.04,
          zenith: '#8a949f', horizon: '#b4bcc3', below: '#9aa29c',
          glow: 0.12, disk: 0.0,
          cover: 0.12, soft: 0.22, cloudLit: '#c4cad1', cloudShade: '#7d858f', cloudA: 1.0,
          fogOff: 60, fogRange: 430,
          rain: 1, wet: 1, vignette: 0.2, tint: [0.98, 0.995, 1.02],
        },
      },
    },
  };
  let WEATHERS = STYLES.arcade.weathers;

  /* ---------- 空のシェーダ（ドームはカメラに付いて回り、奥行きは遠方の面に固定） ---------- */
  const SKY_VS = [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = position;',
    '  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
    '  gl_Position = p.xyww;',
    '  gl_Position.z = p.w * 0.99999;',
    '}'].join('\n');
  const SKY_FS = [
    'uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uBelow;',
    'uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uGlow; uniform float uDisk;',
    'uniform float uCover; uniform float uSoft; uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uCloudA;',
    'uniform vec2 uWind;',
    /* 数字の雲（隠れた確定演出）: uDigit = 0 なし / 1〜6 その数字。uDigitF/R/U は雲の向き（前・右・上の単位ベクトル）、uDigitS は大きさ（数字の高さ 1 ＝ tan で uDigitS） */
    'uniform float uDigit; uniform vec3 uDigitF; uniform vec3 uDigitR; uniform vec3 uDigitU; uniform float uDigitS;',
    'varying vec3 vDir;',
    'float hash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }',
    'float vnoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );',
    '  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }',
    'float fbm( vec2 p ) { float a = 0.5, s = 0.0; for ( int i = 0; i < OCT; i++ ) { s += a * vnoise( p ); p = p * 2.03 + vec2( 1.7, 9.2 ); a *= 0.5; } return s; }',
    /* 数字の形（線分と円弧までの距離）。p は数字の箱の座標（横 -0.5〜0.5・縦 0〜1） */
    'float sdSeg( vec2 p, vec2 a, vec2 b ) { vec2 pa = p - a, ba = b - a; float h = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 ); return length( pa - ba * h ); }',
    'float sdArc( vec2 p, vec2 c, float r, float a0, float a1 ) { vec2 q = p - c; float t = mod( atan( q.y, q.x ) - a0, 6.2831853 );',
    '  if ( t <= a1 - a0 ) return abs( length( q ) - r );',
    '  return min( length( q - r * vec2( cos( a0 ), sin( a0 ) ) ), length( q - r * vec2( cos( a1 ), sin( a1 ) ) ) ); }',
    'float sdDigit( vec2 p, float n ) {',
    '  float d = 1e3;',
    '  if ( n < 1.5 ) { d = min( sdSeg( p, vec2( 0.06, 0.0 ), vec2( 0.06, 1.0 ) ), sdSeg( p, vec2( 0.06, 1.0 ), vec2( -0.24, 0.72 ) ) ); }',
    '  else if ( n < 2.5 ) { d = min( sdArc( p, vec2( 0.0, 0.7 ), 0.3, -0.61, 3.32 ), sdSeg( p, vec2( 0.246, 0.528 ), vec2( -0.3, 0.0 ) ) ); d = min( d, sdSeg( p, vec2( -0.3, 0.0 ), vec2( 0.32, 0.0 ) ) ); }',
    '  else if ( n < 3.5 ) { d = min( sdArc( p, vec2( 0.0, 0.72 ), 0.27, -1.4, 2.79 ), sdArc( p, vec2( 0.0, 0.27 ), 0.29, -2.79, 1.4 ) ); }',
    '  else if ( n < 4.5 ) { d = min( sdSeg( p, vec2( 0.18, 0.0 ), vec2( 0.18, 1.0 ) ), sdSeg( p, vec2( 0.18, 1.0 ), vec2( -0.34, 0.3 ) ) ); d = min( d, sdSeg( p, vec2( -0.34, 0.3 ), vec2( 0.36, 0.3 ) ) ); }',
    '  else if ( n < 5.5 ) { d = min( sdSeg( p, vec2( -0.26, 1.0 ), vec2( 0.3, 1.0 ) ), sdSeg( p, vec2( -0.26, 1.0 ), vec2( -0.3, 0.56 ) ) ); d = min( d, sdArc( p, vec2( -0.02, 0.31 ), 0.31, -2.62, 2.18 ) ); }',
    '  else { d = min( sdArc( p, vec2( 0.0, 0.3 ), 0.3, 0.0, 6.2831853 ), sdArc( p, vec2( 0.1, 0.62 ), 0.4, 1.22, 3.1416 ) ); }',
    '  return d;',
    '}',
    'void main() {',
    '  vec3 d = normalize( vDir );',
    '  float h = d.y;',
    '  vec3 col = mix( uHorizon, uZenith, pow( clamp( h, 0.0, 1.0 ), 0.5 ) );',
    '  col = mix( col, uBelow, smoothstep( 0.0, -0.06, h ) );',
    '  float sd = max( dot( d, uSunDir ), 0.0 );',
    '  col += uSunCol * uGlow * ( pow( sd, 6.0 ) * 0.18 + pow( sd, 60.0 ) * 0.45 );',
    '  col += uSunCol * uDisk * smoothstep( 0.9993, 0.9997, sd );',
    '  if ( h > 0.0 ) {',
    '    vec2 uv = d.xz / ( h + 0.10 ) * 1.4 + uWind;',
    '    float n = fbm( uv );',
    '    float c = smoothstep( uCover, uCover + uSoft, n ) * smoothstep( 0.0, 0.12, h );',
    '#ifdef HQ',
    '    float n2 = fbm( uv + uSunDir.xz * 0.12 );',   // 太陽側にずらして、雲の厚みの陰を付ける
    '    float lit = clamp( 0.55 + ( n2 - n ) * 3.5, 0.0, 1.0 );',
    '#else',
    '    float lit = clamp( 1.25 - n, 0.0, 1.0 );',
    '#endif',
    '    vec3 cc = mix( uCloudShade, uCloudLit, lit ) + uSunCol * uGlow * pow( sd, 8.0 ) * 0.25;',
    /* 数字の雲: 向き uDigitF のまわりだけ。数字の線を芯に、縁をノイズでふくらませた雲。まわりのふつうの雲はかなり減らして数字が埋もれないように。
       2026-10-16 オーナー「もっとわかりやすく」: 縁をくっきり（ノイズのふくらみ 0.30→0.20、境目 0.11→0.07）、ほかの雲より明るく（lit2 +0.2、不透明 0.92→1.0）、まわりの雲を広く薄く（0.65→0.9） */
    '    float df = dot( d, uDigitF );',
    '    if ( uDigit > 0.5 && df > 0.6 ) {',
    '      vec2 q = vec2( dot( d, uDigitR ), dot( d, uDigitU ) ) / ( df * uDigitS ); q.y += 0.5;',
    '      float halo = 1.0 - smoothstep( 0.9, 2.0, length( ( q - vec2( 0.0, 0.5 ) ) * vec2( 1.0, 0.8 ) ) );',
    '      c *= 1.0 - 0.97 * halo;',
    '      float n1 = fbm( q * 2.6 + vec2( 3.1, 7.7 ) ), n3 = fbm( q * 7.0 + vec2( 1.3, 2.9 ) );',
    '      float e = sdDigit( q, uDigit ) - 0.18 - ( n1 - 0.5 ) * 0.20 - ( n3 - 0.5 ) * 0.07;',
    '      float cd = 1.0 - smoothstep( -0.045, 0.025, e );',
    '      float lit2 = clamp( 0.62 + ( fbm( q * 2.6 + vec2( 3.1, 7.7 ) + vec2( 0.35, 0.45 ) ) - n1 ) * 2.4 - e * 1.5, 0.0, 1.0 );',
    '      vec3 cd3 = mix( mix( uCloudShade, uCloudLit, lit2 ), vec3( 1.0 ), 0.6 ) + uSunCol * uGlow * pow( sd, 8.0 ) * 0.25;',   /* ほぼ真っ白（2 回目。くもり・雨の灰色の空でも沈まない） */
    '      col = mix( col, vec3( 1.0 ), 0.4 * ( 1.0 - smoothstep( -0.02, 0.26, e ) ) );',   /* 縁のやわらかな光 */
    '      col = mix( col, cd3, cd * uCloudA );',
    '    }',
    '    col = mix( col, cc, c * uCloudA );',
    '  }',
    '  col = mix( col, uHorizon, ( 1.0 - smoothstep( 0.0, 0.10, abs( h ) ) ) * 0.7 );', // 地平線のかすみ（霧の色とつなぐ）
    '  gl_FragColor = vec4( col, 1.0 );',                   // 画面にそのまま出す（霧の色と同じ扱い）
    '}'].join('\n');

  /* ---------- 雨: 奥行きのある 3 層（2026-10-14 ChatGPT 92→95 の 1）。1 つの形＋1 つのシェーダで 1 回の描画、落ちる動きは頂点シェーダ ----------
     見える粒は 400〜650: 近景 15%（太さ 1.2〜1.6px・不透明 0.35）/ 中景 35%（0.7〜1.0px・0.22）/ 遠景 50%（0.3〜0.6px・0.10）。色 #C4DAE5。
     垂直から 8〜14° 傾け、長さは ±25% ばらつかせる。粒の大きさ・長さ・落ちる速さは「画面に対する割合」で決める（望遠でも広角でも同じ見え方）。
     奥行き（m）は層ごとにカメラの近い面と注視点から決め、深度で隠す（遠景の粒は手前の馬・ラチの後ろに隠れる）。カメラが横へ動くと近い層ほど大きく流れる（視差）。
     1 粒＝細長い四角（aCorner.x＝左右 -1/+1、aCorner.y＝0 頭・1 尾）。aSeed＝(横, 縦, 奥行き, ばらつき)。1px より細い線は 1px で描いて薄くする（ちらつかない） */
  const RAIN_VS = [
    'attribute vec4 aSeed; attribute vec2 aCorner; attribute float aLayer;',
    'uniform float uTime; uniform float uTanH; uniform float uAspect; uniform float uPxH;',
    'uniform vec2 uSlant; uniform vec4 uL0[ 3 ]; uniform vec4 uL1[ 3 ]; uniform vec2 uShift[ 3 ];',
    'varying float vA; varying float vY; varying float vPx; varying float vCore;',
    'void main() {',
    '  int li = aLayer < 0.5 ? 0 : aLayer < 1.5 ? 1 : 2;',
    '  vec4 L0 = li == 0 ? uL0[ 0 ] : li == 1 ? uL0[ 1 ] : uL0[ 2 ];',     /* 奥行きの手前・奥 m、落ちる速さ（画面の高さ/秒）、長さ（画面の高さに対する割合） */
    '  vec4 L1 = li == 0 ? uL1[ 0 ] : li == 1 ? uL1[ 1 ] : uL1[ 2 ];',     /* 太さ px の最小・最大、不透明度、未使用 */
    '  vec2 sh = li == 0 ? uShift[ 0 ] : li == 1 ? uShift[ 1 ] : uShift[ 2 ];',
    '  float r1 = aSeed.w, r2 = fract( r1 * 7.123 + aSeed.x * 3.71 ), r3 = fract( r1 * 13.37 + aSeed.y * 5.29 );',
    '  float z = mix( L0.x, L0.y, aSeed.z );',
    '  float hh = z * uTanH;',                                         /* その奥行きでの画面の半分の高さ（m） */
    '  float len = L0.w * ( 0.75 + 0.5 * r1 ) * 2.0 * hh;',            /* 長さ ±25% */
    '  float sl = mix( uSlant.x, uSlant.y, r2 );',                      /* 傾き（tan） */
    '  float sp = L0.z * ( 0.88 + 0.24 * r3 );',
    '  float span = 2.0 * hh * 1.04 + len;',                            /* 頭が画面の上から下＋尾の長さ分まで動いてから折り返す（画面の中で消えない） */
    '  float v = fract( aSeed.y - uTime * sp * 2.0 * hh / span + sh.y );',
    '  float yh = -hh * 1.02 - len + v * span;',
    '  float u = fract( aSeed.x + sh.x + uTime * sp * sl / ( uAspect * 1.25 ) );',
    '  float xw = hh * uAspect * 1.25;',
    '  vec3 dir = normalize( vec3( -sl, 1.0, 0.0 ) );',                 /* 尾へ向かう向き（頭は下・右へ進む） */
    '  vec3 p = vec3( ( u * 2.0 - 1.0 ) * xw, yh, -z ) + dir * len * aCorner.y;',
    '  float w = mix( L1.x, L1.y, r3 );',                               /* 太さ px */
    '  float core = max( w, 1.0 ) * 0.5;',
    '  float halfPx = core + 0.75;',
    '  p.x += aCorner.x * halfPx * z * uPxH;',                          /* 太さ（画面の px をその奥行きの m に） */
    '  vPx = aCorner.x * halfPx; vCore = core; vY = aCorner.y;',
    '  vA = L1.z * ( 0.45 + 0.55 * min( w, 1.0 ) );',   /* 1px より細い線は 1px で描いて薄くする（細すぎて消えないよう半分までに） */
    '  gl_Position = projectionMatrix * vec4( p, 1.0 );',
    '}'].join('\n');
  const RAIN_FS = [
    'uniform vec3 uColor; uniform float uAlpha;',
    'varying float vA; varying float vY; varying float vPx; varying float vCore;',
    'void main() {',
    '  float cov = clamp( vCore + 0.5 - abs( vPx ), 0.0, 1.0 );',         /* 横: 1px のなめらかな縁 */
    '  float lenA = smoothstep( 0.0, 0.08, vY ) * ( 1.0 - smoothstep( 0.6, 1.0, vY ) );', /* 縦: 頭は少しぼかし、尾へ細く消える */
    '  gl_FragColor = vec4( uColor, uAlpha * vA * cov * lenA );',
    '  #include <encodings_fragment>',
    '}'].join('\n');
  /* 層ごとの値: [落ちる速さ（画面の高さ/秒）, 長さ（画面の高さに対する割合）, 太さ px 最小, 最大, 不透明度, 割合, 視差の強さ]。粒の数は RAIN_N（ふつう / 軽い・Fire TV） */
  const RAIN_LAYERS = [
    [2.3, 0.2, 1.2, 1.6, 0.35, 0.15, 0.3],   /* 近景: 太く長く速い */
    [1.55, 0.11, 0.7, 1.0, 0.22, 0.35, 0.7], /* 中景 */
    [1.05, 0.06, 0.3, 0.6, 0.10, 0.50, 1.0], /* 遠景: 細く短くゆっくり */
  ];
  const RAIN_N = { high: 650, low: 480, xlite: 180 }; // xlite: テレビの画質「さらになめらか（最軽量）」（R3D.xlite。2026-10-28）
  const RAIN_COLOR = '#c4dae5';
  const RAIN_SLANT = [Math.tan(8 * Math.PI / 180), Math.tan(14 * Math.PI / 180)];
  /* 足元の水しぶき（雨の日だけ）: 蹄が着いた所から小さな白い粒が跳ねる。全体で 36 粒まで・寿命 0.25〜0.45 秒・1 回の描画（点） */
  const SPLASH_MAX = 36;
  const SPLASH_VS = [
    'attribute vec4 aLife;',                                             /* (経過 0..1, 大きさ m, 不透明度, 未使用) */
    'uniform float uScale;',
    'varying float vA;',
    'void main() {',
    '  vec4 mv = modelViewMatrix * vec4( position, 1.0 );',
    '  float k = aLife.x;',
    '  vA = aLife.z * ( 1.0 - k ) * ( 1.0 - k ) * step( k, 0.999 );',
    '  gl_PointSize = clamp( aLife.y * ( 0.6 + 0.8 * k ) * uScale / max( -mv.z, 0.1 ), 0.0, 48.0 );',
    '  gl_Position = projectionMatrix * mv;',
    '}'].join('\n');
  const SPLASH_FS = [
    'uniform vec3 uColor;',
    'varying float vA;',
    'void main() {',
    '  vec2 q = gl_PointCoord * 2.0 - 1.0;',
    '  float r = dot( q, q );',
    '  if ( r > 1.0 || vA <= 0.0 ) discard;',
    '  gl_FragColor = vec4( uColor, vA * ( 1.0 - r ) );',
    '  #include <encodings_fragment>',
    '}'].join('\n');
  /* ---------- 仕上げ（'high' だけ）: 周辺減光・ごく弱い粒子・色味を、画面に 1 枚かけ合わせるだけ（描画先の切り替えなし） ---------- */
  const POST_VS = 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
  const POST_FS = [
    'uniform float uVig; uniform float uGrain; uniform float uTime; uniform vec3 uTint; uniform float uAspect;',
    'varying vec2 vUv;',
    'float hash( vec2 p ) { p = fract( p * vec2( 443.897, 441.423 ) ); p += dot( p, p.yx + 19.19 ); return fract( ( p.x + p.y ) * p.x ); }',
    'void main() {',
    '  vec2 q = ( vUv - 0.5 ) * vec2( uAspect, 1.0 ) / max( uAspect, 1.0 ) * 2.0;',
    '  float vig = 1.0 - uVig * smoothstep( 0.35, 1.45, dot( q, q ) );',
    '  float g = ( hash( gl_FragCoord.xy + fract( uTime * 7.13 ) * 113.0 ) - 0.5 ) * uGrain;',
    '  gl_FragColor = vec4( 0.5 * vig * uTint * ( 1.0 + g ), 1.0 );', // 合成: 画面の色 × (2 × この色)
    '}'].join('\n');

  /* ---------- 映り込み用の環境（'high' だけ）: 空と地面の明るさを PMREM にして scene.environment へ ----------
     毛づやのある馬・塗装面・屋根に空が映ると、CG っぽさがかなり減る。拡散の明るさが二重にならないよう弱め（ENV_SCALE）にする */
  const ENV_VS = 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }';
  const ENV_FS = [
    'uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGnd; uniform vec3 uSun; uniform vec3 uSunDir;',
    'varying vec3 vDir;',
    'void main() {',
    '  vec3 d = normalize( vDir );',
    '  float h = d.y;',
    '  vec3 sky = mix( uHor, uZen, pow( clamp( h, 0.0, 1.0 ), 0.6 ) );',
    '  float sd = max( dot( d, uSunDir ), 0.0 );',
    '  sky += uSun * ( pow( sd, 48.0 ) * 1.5 + pow( sd, 5.0 ) * 0.25 );',
    '  vec3 col = mix( sky, uGnd, smoothstep( 0.02, -0.12, h ) );',
    '  gl_FragColor = vec4( col, 1.0 );',
    '}'].join('\n');

  function setup(renderer, scene, opts) {
    opts = opts || {};
    let quality = opts.quality || R3D.quality || 'high';
    const hq = () => quality !== 'low';
    const qs = (location.search.match(/[?&]look=(\w+)/) || [])[1];
    let style = STYLES[opts.style] ? opts.style : STYLES[R3D.lookStyle] ? R3D.lookStyle : STYLES[qs] ? qs : 'arcade';
    WEATHERS = STYLES[style].weathers;
    applyTone(STYLES[style].tm);

    /* --- 描画の設定 --- */
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.CustomToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.physicallyCorrectLights = false;     // 全員が同じ強さの感覚で作れるよう、従来の光の強さのまま
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = true;
    // 画素密度は統合側（race3d.js の fitRes）が決めるので、ここでは上限を超えているときだけ下げる
    const maxPixelRatio = () => (hq() ? 2 : 1.2); // 軽い描き方でも 1.2 倍まで（Fire TV は画面と同じ細かさ＝1920 の幅で描く。2026-10-19、以前は 1 倍で止めていて 3D だけ荒かった）
    function applyQuality() {
      renderer.shadowMap.type = hq() ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
      if (renderer.getPixelRatio() > maxPixelRatio()) renderer.setPixelRatio(maxPixelRatio());
    }
    applyQuality();

    /* --- 光 --- */
    const SUN = R3D.Course.SUN, sunDir = new THREE.Vector3(SUN.x, SUN.y, SUN.z).normalize();
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.name = 'look-sun';
    sun.castShadow = true;
    const sh = sun.shadow;
    sh.camera.near = 1; sh.camera.far = 800;
    const target = new THREE.Object3D(); target.name = 'look-sun-target';
    sun.target = target;
    scene.add(sun); scene.add(target);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x808080, 1); hemi.name = 'look-hemi';
    const amb = new THREE.AmbientLight(0xffffff, 0.05); amb.name = 'look-amb';
    scene.add(hemi); scene.add(amb);
    const fill = new THREE.DirectionalLight(0xffffff, 0); fill.name = 'look-fill';
    const fillTarget = new THREE.Object3D(); fill.target = fillTarget;
    scene.add(fill); scene.add(fillTarget);
    let expBase = 1, expMul = 1, expSnap = true;
    function setShadowSize() {
      const n = hq() ? 2048 : 1024;
      if (sh.mapSize.x !== n) { sh.mapSize.set(n, n); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    }
    setShadowSize();

    // 影の地図の向き（太陽から見た平面の 2 軸）。太陽は動かないので固定
    const lf = sunDir.clone().negate();
    const lr = new THREE.Vector3().crossVectors(lf, new THREE.Vector3(0, 1, 0)).normalize();
    const lu = new THREE.Vector3().crossVectors(lr, lf).normalize();

    /* --- 空 --- */
    const skyU = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBelow: { value: new THREE.Color() },
      uSunDir: { value: sunDir.clone() }, uSunCol: { value: new THREE.Color() }, uGlow: { value: 1 }, uDisk: { value: 1 },
      uCover: { value: 0.5 }, uSoft: { value: 0.22 }, uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() }, uCloudA: { value: 1 },
      uWind: { value: new THREE.Vector2() },
      uDigit: { value: 0 }, uDigitF: { value: new THREE.Vector3(0, 0, -1) }, uDigitR: { value: new THREE.Vector3(1, 0, 0) }, uDigitU: { value: new THREE.Vector3(0, 1, 0) }, uDigitS: { value: 0.15 },
    };
    /* 数字の雲の置き場所: 向正面の奥（4 コーナー寄り）の上空。スタンド側・内馬場のカメラが向正面〜4 コーナーを撮るとき画面の上に入る向き。
       az = 水平の向き（x, z）、el = 仰角（度）、size = 数字の高さ（度） */
    const DIGIT_MIN = 5.2;   /* 数字の高さの下限（度）。2026-10-16 オーナー「もっとわかりやすく」: 呼び出し側（race3d は 3.6）がもっと小さく頼んでも、これより小さくしない。
                                大きくした分は下へ伸ばす（上端は頼まれた位置の 0.3 度上。ゲートインの全景は空が仰角 9.5 度ほどまでしか入らず、
                                下は街のビルに隠れるので、6〜7 度にするにはカメラ担当が仰角を上げる必要がある） */
    function placeDigit(azx, azz, el, size) {
      const req = +size || 0; size = Math.max(req, DIGIT_MIN); el = (+el || 0) + 0.3 - (size - req) / 2;
      const F = skyU.uDigitF.value, R = skyU.uDigitR.value, U = skyU.uDigitU.value, n = Math.hypot(azx, azz) || 1, c = Math.cos(el * Math.PI / 180), s = Math.sin(el * Math.PI / 180);
      F.set(azx / n * c, s, azz / n * c);
      R.crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();   /* 右 = 前×上（F=(0,0,-1) のとき (1,0,0)。数字が裏返らない） */
      U.crossVectors(R, F).normalize();                            /* 上 = 右×前（F=(0,0,-1), R=(1,0,0) のとき (0,1,0)） */
      skyU.uDigitS.value = Math.tan(size * Math.PI / 360) * 2;
    }
    placeDigit(-0.42, -1, 19, 9);
    let cues = null;
    function setCues(c) {
      cues = c && typeof c === 'object' ? c : null;
      const h = cues && cues.cloud && cues.cloud.horse != null ? Math.floor(+cues.cloud.horse) : -1;
      skyU.uDigit.value = h >= 0 && h <= 5 ? h + 1 : 0;
    }
    function makeSkyMat() {
      return new THREE.ShaderMaterial({
        uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS,
        defines: hq() ? { OCT: 4, HQ: 1 } : { OCT: 2 },
        side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
      });
    }
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), makeSkyMat());
    sky.name = 'look-sky'; sky.frustumCulled = false; sky.renderOrder = 1000; // 不透明な物のあとに描く（隠れた所は塗らない）
    sky.castShadow = false; sky.receiveShadow = false;
    scene.add(sky);

    /* --- 霧 --- */
    scene.fog = new THREE.Fog(0xc7d8e6, 100, 1000);

    /* --- 雨 --- */
    let rain = null;
    const rainU = {
      uTime: { value: 0 }, uTanH: { value: 0.4 }, uAspect: { value: 16 / 9 }, uPxH: { value: 0.001 },
      uSlant: { value: new THREE.Vector2(RAIN_SLANT[0], RAIN_SLANT[1]) },
      uL0: { value: RAIN_LAYERS.map((L) => new THREE.Vector4(2, 10, L[0], L[1])) },
      uL1: { value: RAIN_LAYERS.map((L) => new THREE.Vector4(L[2], L[3], L[4], 0)) },
      uShift: { value: RAIN_LAYERS.map(() => new THREE.Vector2(0, 0)) },
      uColor: { value: new THREE.Color(RAIN_COLOR) }, uAlpha: { value: 0.0 },
    };
    function buildRain() {
      if (rain) { scene.remove(rain); rain.geometry.dispose(); rain.material.dispose(); }
      const total = hq() ? RAIN_N.high : R3D.xlite ? RAIN_N.xlite : RAIN_N.low;
      const counts = RAIN_LAYERS.map((L) => Math.round(total * L[5])), N = counts.reduce((a, b) => a + b, 0);
      const seed = new Float32Array(N * 16), corner = new Float32Array(N * 8), layer = new Float32Array(N * 4), pos = new Float32Array(N * 12), idx = new Uint16Array(N * 6);   /* 4 頂点 × 粒の数 < 65536 */
      const CR = [-1, 0, 1, 0, 1, 1, -1, 1];
      let i = 0;
      counts.forEach((n, li) => {
        for (let k = 0; k < n; k++, i++) {
          /* 横は層ごとに少しずつずらして並べる（完全な乱数より偏りが少なく、粒の数が少なくても画面全体に散る） */
          const a = (k + Math.random() * 0.9) / n, b = Math.random(), c = Math.random(), d = Math.random();
          for (let q = 0; q < 4; q++) { seed.set([a, b, c, d], i * 16 + q * 4); layer[i * 4 + q] = li; }
          corner.set(CR, i * 8);
          idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
      g.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      const m = new THREE.ShaderMaterial({ uniforms: rainU, vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
      rain = new THREE.Mesh(g, m);
      rain.name = 'look-rain'; rain.frustumCulled = false; rain.renderOrder = 2000; rain.visible = false;
      rain.castShadow = false; rain.receiveShadow = false;
      scene.add(rain);
    }
    buildRain();

    /* --- 足元の水しぶき（雨の日だけ。look.splash({ x, z, speed }) を馬の蹄が着いたときに呼ぶ） --- */
    const splashU = { uScale: { value: 500 }, uColor: { value: new THREE.Color('#e4edf2') } };
    const spPos = new Float32Array(SPLASH_MAX * 3), spLife = new Float32Array(SPLASH_MAX * 4);
    const spV = new Float32Array(SPLASH_MAX * 3), spT = new Float32Array(SPLASH_MAX), spL = new Float32Array(SPLASH_MAX);
    for (let i = 0; i < SPLASH_MAX; i++) { spLife[i * 4] = 1; spT[i] = 1; spL[i] = 1; }
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3).setUsage(THREE.DynamicDrawUsage));
    spGeo.setAttribute('aLife', new THREE.BufferAttribute(spLife, 4).setUsage(THREE.DynamicDrawUsage));
    const splashPts = new THREE.Points(spGeo, new THREE.ShaderMaterial({ uniforms: splashU, vertexShader: SPLASH_VS, fragmentShader: SPLASH_FS, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    splashPts.name = 'look-splash'; splashPts.frustumCulled = false; splashPts.renderOrder = 1990; splashPts.visible = false;
    scene.add(splashPts);
    let spNext = 0, spAlive = 0;
    function splash(e) {
      if (R3D.xlite || !rain || !rain.visible || !e || !(e.speed > 5)) return; // さらになめらか: 水しぶきなし
      const n = Math.random() < 0.5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const i = spNext; spNext = (spNext + 1) % SPLASH_MAX;
        spPos[i * 3] = e.x + (Math.random() - 0.5) * 0.2; spPos[i * 3 + 1] = 0.04; spPos[i * 3 + 2] = e.z + (Math.random() - 0.5) * 0.2;
        const an = Math.random() * Math.PI * 2, hs = 0.3 + Math.random() * 0.6;
        spV[i * 3] = Math.cos(an) * hs; spV[i * 3 + 1] = 1.0 + Math.random() * 0.8; spV[i * 3 + 2] = Math.sin(an) * hs;
        spT[i] = 0; spL[i] = 0.25 + Math.random() * 0.2;
        spLife[i * 4 + 1] = 0.09 + Math.random() * 0.07; spLife[i * 4 + 2] = 0.5;
      }
    }
    function updateSplash(dt) {
      spAlive = 0;
      for (let i = 0; i < SPLASH_MAX; i++) {
        if (spT[i] >= spL[i]) { spLife[i * 4] = 1; continue; }
        spT[i] += dt; spAlive++;
        spV[i * 3 + 1] -= 9.8 * dt;
        spPos[i * 3] += spV[i * 3] * dt; spPos[i * 3 + 2] += spV[i * 3 + 2] * dt;
        spPos[i * 3 + 1] = Math.max(0.02, spPos[i * 3 + 1] + spV[i * 3 + 1] * dt);
        spLife[i * 4] = Math.min(1, spT[i] / spL[i]);
      }
      splashPts.visible = spAlive > 0 && rain.visible;
      if (splashPts.visible) { spGeo.attributes.position.needsUpdate = true; spGeo.attributes.aLife.needsUpdate = true; }
    }

    /* --- 仕上げの 1 枚 --- */
    const postU = { uVig: { value: 0.16 }, uGrain: { value: STYLES[style].grain }, uTime: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uAspect: { value: 16 / 9 } };
    const postMat = new THREE.ShaderMaterial({
      uniforms: postU, vertexShader: POST_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
    });
    const postTri = new THREE.Mesh(new THREE.BufferGeometry(), postMat);
    postTri.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    postTri.frustumCulled = false;
    const postScene = new THREE.Scene(); postScene.add(postTri);
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    let postOn = true;

    /* --- 映り込みの環境 --- */
    let pmrem = null, envRT = null, envOn = true;
    const ENV_SCALE = 0.3;   // 映り込みの環境は拡散光にも足される（Standard の材質だけ）。強いと Lambert の木・観客と明るさがずれるので弱め（前 0.45）
    const envU = { uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGnd: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uSunDir: { value: sunDir.clone() } };
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ uniforms: envU, vertexShader: ENV_VS, fragmentShader: ENV_FS, side: THREE.BackSide, depthWrite: false, toneMapped: false })));
    function buildEnv(P) {
      if (envRT) { envRT.dispose(); envRT = null; }
      if (!hq() || !envOn) { if (scene.environment && scene.environment.userData.look) scene.environment = null; return; }
      // 空の明るさ ≒ 半球光の空の色 × 強さ（照明の単位にそろえる）。地面は日なたの芝の明るさ
      const k = P.hemiI * ENV_SCALE;
      envU.uZen.value.set(P.sky).multiplyScalar(k * 0.85);
      envU.uHor.value.set(P.horizon).multiplyScalar(k * 1.1);
      envU.uGnd.value.set(P.gnd).multiplyScalar((P.sunI * SUN.y + P.hemiI) * 0.32 * ENV_SCALE);
      envU.uSun.value.set(P.sun).multiplyScalar(P.sunI * P.glow * ENV_SCALE);
      if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
      const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
      envRT = pmrem.fromScene(envScene, 0, 0.1, 100);
      renderer.setClearColor(cc, ca);
      envRT.texture.userData.look = true;
      scene.environment = envRT.texture;
    }

    /* --- 天気 --- */
    const cur = {};
    let weather = 'sunny';
    function setWeather(w) {
      if (!WEATHERS[w]) w = 'sunny';
      weather = w;
      const P = WEATHERS[w];
      Object.assign(cur, P);
      expBase = P.exposure; renderer.toneMappingExposure = expBase * expMul;
      fill.color.set(P.sky); fill.intensity = (P.fill != null ? P.fill : STYLES[style].fill) * (0.6 + 0.4 * Math.min(1, P.hemiI));   /* P.fill: 天気ごとの補助光（無ければ方針の値） */
      sun.color.set(P.sun); sun.intensity = P.sunI;
      hemi.color.set(P.sky); hemi.groundColor.set(P.gnd); hemi.intensity = P.hemiI;
      amb.color.set(P.amb); amb.intensity = P.ambI;
      const D = (c, hex) => c.set(hex).convertLinearToSRGB();   // 画面にそのまま出す色として持つ
      D(skyU.uZenith.value, P.zenith); D(skyU.uHorizon.value, P.horizon); D(skyU.uBelow.value, P.below);
      D(skyU.uSunCol.value, P.sun); skyU.uGlow.value = P.glow; skyU.uDisk.value = P.disk;
      skyU.uCover.value = P.cover; skyU.uSoft.value = P.soft || 0.22; D(skyU.uCloudLit.value, P.cloudLit); D(skyU.uCloudShade.value, P.cloudShade); skyU.uCloudA.value = P.cloudA;
      D(scene.fog.color, P.fog || P.horizon);   /* P.fog: 空気遠近の色（遠くの木・建物を寄せる色。無ければ地平線の色） */
      renderer.setClearColor(scene.fog.color, 1);
      rain.visible = P.rain > 0; rainU.uAlpha.value = P.rain;   /* 層ごとの不透明度は RAIN_LAYERS */
      if (!rain.visible) { splashPts.visible = false; for (let i = 0; i < SPLASH_MAX; i++) spT[i] = spL[i]; }
      postU.uVig.value = P.vignette; postU.uTint.value.set(P.tint[0], P.tint[1], P.tint[2]);
      buildEnv(P);
      sweepAll();
    }

    /* --- 材質の見回り: 色テクスチャの sRGB 指定忘れを直す・雨の日は濡れた艶（MeshStandardMaterial の粗さを下げる） --- */
    const seen = new WeakSet();
    function fixMat(m) {
      if (!m || m.isShaderMaterial) return;
      if (!seen.has(m)) {
        seen.add(m);
        let changed = false;
        ['map', 'emissiveMap'].forEach((k) => {
          const t = m[k];
          if (t && t.encoding === THREE.LinearEncoding && !(t.userData && t.userData.linear)) { t.encoding = THREE.sRGBEncoding; t.needsUpdate = true; changed = true; }
        });
        if (changed) m.needsUpdate = true;
      }
      if (m.isMeshStandardMaterial && !(m.userData && m.userData.noWet)) {
        if (m.userData.dryRough === undefined) m.userData.dryRough = m.roughness;
        const r = cur.wet ? Math.max(0.12, m.userData.dryRough * 0.55) : m.userData.dryRough;
        if (m.roughness !== r) m.roughness = r;
      }
    }
    function sweepAll() {
      scene.traverse((o) => {
        if (o === sky || o === rain || o === splashPts) return;
        const m = o.material; if (!m) return;
        if (Array.isArray(m)) m.forEach(fixMat); else fixMat(m);
      });
    }

    /* --- 毎コマ: 見ている所（注視点）を求め、影の箱・霧・雨を合わせる --- */
    const v = new THREE.Vector3(), fwd = new THREE.Vector3(), camPos = new THREE.Vector3();
    const focus = new THREE.Vector3();
    let focusDist = 100, t = 0, frame = 0;
    const NDC = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];
    const rF = new THREE.Vector3(), rainPrev = { ok: false };
    let rainNearK = 1;
    function update(dt, camera, info) {
      dt = Math.min(Math.max(dt || 0, 0), 0.1);
      t += dt; frame++;
      if (!camera) return;
      if (R3D.Look.active === look) look.camera = camera;
      camera.updateMatrixWorld();
      camera.getWorldPosition(camPos);
      camera.getWorldDirection(fwd);
      // 注視点 = 画面の中心の向きが地面（y=0）に当たる所
      let ft;
      if (fwd.y < -0.004) ft = Math.min(-camPos.y / fwd.y, 900); else ft = 300;
      ft = Math.max(ft, 4);
      focusDist = ft;
      focus.copy(camPos).addScaledVector(fwd, ft); focus.y = 0;

      // 逆光の補正: 太陽の方を向くほど露出を上げる（晴れほど強く）。カメラの切り替えで急に向きが変わったら即座に合わせる
      const fh = Math.hypot(fwd.x, fwd.z) || 1, sh2 = Math.hypot(sunDir.x, sunDir.z) || 1;
      const toward = Math.max(0, (fwd.x * sunDir.x + fwd.z * sunDir.z) / (fh * sh2));
      const sunFrac = cur.sunI / (cur.sunI + cur.hemiI);
      const want = 1 + STYLES[style].backlit * toward * toward * sunFrac * 1.6;
      if (expSnap || Math.abs(want - expMul) > 0.25) expMul = want; else expMul += (want - expMul) * Math.min(1, dt * 2.5);
      expSnap = false;
      renderer.toneMappingExposure = expBase * expMul;
      // 補助光: カメラの後ろ少し上から（仰角 15°）
      if (fill.intensity > 0) {
        fillTarget.position.copy(focus);
        fill.position.set(focus.x - fwd.x / fh * 100, 27, focus.z - fwd.z / fh * 100);
        fillTarget.updateMatrixWorld(); fill.updateMatrixWorld();
      }

      // 影の箱: 画面の四隅と辺の中点の向きが地面に当たる所（遠すぎる所は切る）を太陽から見て囲む
      const maxT = ft * 1.45 + 30;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, d0 = 1e9, d1 = -1e9;
      const addPt = (p) => {
        const a = p.dot(lr), b = p.dot(lu), d = p.dot(sunDir);
        if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; if (d < d0) d0 = d; if (d > d1) d1 = d;
      };
      for (let i = 0; i < NDC.length; i++) {
        v.set(NDC[i][0], NDC[i][1], 0.5).unproject(camera).sub(camPos).normalize();
        let tt = v.y < -1e-4 ? -camPos.y / v.y : maxT;
        tt = Math.min(tt, maxT);
        v.multiplyScalar(tt).add(camPos); v.y = 0;
        addPt(v);
      }
      // 手前の地面（カメラの真下あたり）も少し含める
      v.copy(camPos); v.y = 0; v.addScaledVector(fwd.set(fwd.x, 0, fwd.z).normalize(), Math.min(ft * 0.3, 10)); addPt(v);
      let half = Math.max(x1 - x0, y1 - y0) * 0.5 + 4;          // 馬の背丈ぶんの余白
      half = Math.min(Math.max(half, 10), hq() ? 170 : 150);
      half = Math.pow(1.12, Math.ceil(Math.log(half) / Math.log(1.12))); // 段階的にして、大きさの細かい揺れでちらつかないように
      const size = sh.mapSize.x, texel = (half * 2) / size;
      let cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5;
      cx = Math.round(cx / texel) * texel; cy = Math.round(cy / texel) * texel; // 影の升目に合わせる（ちらつき防止）
      const R = d1 + 120;                                        // 太陽側へどれだけ離すか（スタンドの屋根まで入る高さ）
      target.position.set(0, 0, 0).addScaledVector(lr, cx).addScaledVector(lu, cy);
      sun.position.copy(target.position).addScaledVector(sunDir, R);
      target.updateMatrixWorld(); sun.updateMatrixWorld();
      const cam = sh.camera;
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.near = Math.max(0.5, R - d1 - 110); cam.far = R - d0 + 10;
      cam.updateProjectionMatrix();
      const range = cam.far - cam.near;
      sh.bias = -0.04 / range;                                   // 約 4cm 手前にずらす（しま模様の防止）
      sh.normalBias = texel * (hq() ? 1.2 : 1.6);                // 升目の大きさに合わせて（浮き上がりは最小限）

      // 霧（空気遠近）: カメラからの距離だけで決める。望遠で遠くから撮ると馬も少し霞む（本物の中継と同じ）
      const fog = scene.fog;
      if (fog && fog.isFog) { fog.near = cur.fogOff; fog.far = fog.near + cur.fogRange; }

      // 空: カメラに付いて回る。雲は風で流れる
      sky.position.copy(camPos);
      sky.scale.setScalar(Math.max(1, camera.near * 4));
      skyU.uWind.value.set(t * 0.006, t * 0.0025);

      // 雨: 層ごとの奥行きをカメラの近い面と注視点から決め、カメラの向き・位置の変化ぶん粒を画面上で逆へ流す
      if (rain.visible) {
        rainU.uTime.value = t;
        camera.getWorldDirection(rF);   /* fwd は影の計算で水平にされているので取り直す */
        const tanH = Math.tan((camera.isPerspectiveCamera ? camera.fov : 50) * Math.PI / 360), asp = camera.aspect || 16 / 9;
        rainU.uTanH.value = tanH; rainU.uAspect.value = asp;
        rainU.uPxH.value = 2 * tanH / Math.max(1, renderer.getDrawingBufferSize(v).y);   /* 奥行き 1m での 1px の大きさ */
        const L0 = rainU.uL0.value;
        const n0 = Math.max(1.4, camera.near * 1.6), n1 = n0 * 3.2, m1 = Math.max(n1 * 3.5, 22), f1 = Math.max(m1 * 1.6, Math.min(ft * 0.95, 180));
        L0[0].x = n0; L0[0].y = n1; L0[1].x = n1; L0[1].y = m1; L0[2].x = m1; L0[2].y = f1;
        /* ゴール前（スロー・残りわずか）はカメラのすぐ前の粒を約 2 割薄く（馬の顔を雨で隠さない） */
        const fin = info && ((info.slow != null && info.slow < 0.95) || (info.remain != null && info.remain < 60)) ? 0.8 : 1;
        rainNearK += (fin - rainNearK) * Math.min(1, dt * 4);
        rainU.uL1.value[0].z = RAIN_LAYERS[0][4] * rainNearK;
        const me = camera.matrixWorld.elements;
        const rx = me[0], ry = me[1], rz = me[2], ux = me[4], uy = me[5], uz = me[6];
        if (rainPrev.ok) {
          const P = rainPrev, dx = camPos.x - P.x, dy = camPos.y - P.y, dz = camPos.z - P.z;
          const rot = Math.hypot(rF.x - P.fx, rF.y - P.fy, rF.z - P.fz), mv = Math.hypot(dx, dy, dz);
          if (rot < 0.35 && mv < 8) {   /* カメラの切り替え（大きく飛んだ）ときは流さない */
            const turnX = rF.x * P.rx + rF.y * P.ry + rF.z * P.rz, turnY = rF.x * P.ux + rF.y * P.uy + rF.z * P.uz;
            const movX = dx * P.rx + dy * P.ry + dz * P.rz, movY = dx * P.ux + dy * P.uy + dz * P.uz;
            for (let li = 0; li < 3; li++) {
              const S = rainU.uShift.value[li], zm = (L0[li].x + L0[li].y) * 0.5, par = RAIN_LAYERS[li][6];
              const xw = 2 * tanH * asp * 1.25, yh = 2 * tanH * (1.04 + RAIN_LAYERS[li][1]);
              let du = -turnX / xw - par * movX / (zm * xw), dv = -turnY / yh - par * movY / (zm * yh);
              du = Math.max(-0.05, Math.min(0.05, du)); dv = Math.max(-0.05, Math.min(0.05, dv));
              S.x = (S.x + du + 1) % 1; S.y = (S.y + dv + 1) % 1;
            }
          }
        }
        Object.assign(rainPrev, { ok: true, x: camPos.x, y: camPos.y, z: camPos.z, fx: rF.x, fy: rF.y, fz: rF.z, rx, ry, rz, ux, uy, uz });
        splashU.uScale.value = renderer.getDrawingBufferSize(v).y / (2 * tanH);
      } else rainPrev.ok = false;
      updateSplash(dt);

      postU.uTime.value = t;
      // ほかの担当があとから足した材質も見回る（30 コマに 1 回）
      if (frame % 30 === 1) sweepAll();
    }

    function render(rend, scn, camera) {
      rend.render(scn, camera);
      if (hq() && postOn) {
        const ac = rend.autoClear;
        rend.autoClear = false;
        const sz = rend.getDrawingBufferSize(v);
        postU.uAspect.value = sz.x / Math.max(1, sz.y);
        rend.render(postScene, postCam);
        rend.autoClear = ac;
      }
    }

    function setQuality(q) {
      quality = q === 'low' ? 'low' : 'high';
      applyQuality(); setShadowSize();
      const old = sky.material; sky.material = makeSkyMat(); old.dispose();
      buildRain(); setWeather(weather);
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); }); // 影の方式の切り替えを反映
    }

    function setStyle(st) {
      if (!STYLES[st] || st === style) return;
      style = st; WEATHERS = STYLES[style].weathers; look.params = WEATHERS;
      applyTone(STYLES[style].tm); postU.uGrain.value = STYLES[style].grain;
      setWeather(weather);
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); }); // トーンマップの焼き直し
    }

    function dispose() {
      [sun, target, hemi, amb, fill, fillTarget, sky, rain, splashPts].forEach((o) => scene.remove(o)); spGeo.dispose(); splashPts.material.dispose();
      sky.geometry.dispose(); sky.material.dispose(); rain.geometry.dispose(); rain.material.dispose();
      postTri.geometry.dispose(); postMat.dispose(); if (sh.map) sh.map.dispose();
      if (envRT) { envRT.dispose(); if (scene.environment === envRT.texture) scene.environment = null; } if (pmrem) pmrem.dispose();
      scene.fog = null;
    }

    setWeather(opts.weather || 'sunny');
    const look = {
      setWeather, update, render, setQuality, setStyle, dispose, splash,
      setCues, get cues() { return cues; }, placeDigit,   /* placeDigit(azx, azz, 仰角, 高さの度) は確認用（数字の雲の置き場所を試す） */
      get style() { return style; },
      sun, hemi, amb, fill, sky, focus,
      get exposure() { return renderer.toneMappingExposure; },
      get weather() { return weather; }, get quality() { return quality; }, get focusDist() { return focusDist; },
      get post() { return postOn; }, set post(b) { postOn = !!b; },
      get maxPixelRatio() { return maxPixelRatio(); },
      get env() { return envOn; }, set env(b) { envOn = !!b; buildEnv(WEATHERS[weather]); },
      params: WEATHERS, renderer, scene, camera: null, rainU,
    };
    R3D.Look.active = look;   // 確認用（コンソールから R3D.Look.active で触れる）
    return look;
  }

  return { setup, STYLES };
})();
