/* casa の紙幣（b83）: 1 ドル紙幣に寄せたデザインの SVG を文字列で返す。端末のサンド演出とスマホの紙幣ページの両方で使う。
   比率は本物と同じ 2.35 : 1（470 × 200）。中央の肖像の位置に casa のエンブレム（logo-emblem.png を緑に塗る）。
   BillArt.svg(width, opts) → SVG の文字列。opts.serial = 通し番号の文字、opts.gray = 灰色（使えないとき） */
const BillArt = (function () {
  'use strict';
  const G = '#2f5e3a', G2 = '#1f4328', PAPER = '#eef1e1', PAPER2 = '#dde5cf';
  let n = 0;
  function svg(width, opts) {
    opts = opts || {};
    const w = width || 470, h = Math.round(w / 2.35), id = 'b' + (++n) + '_';
    const serial = opts.serial || 'C 00000001 A';
    const base = opts.base || '';
    const emblem = opts.emblem !== false;
    const s = [];
    s.push('<svg class="billart' + (opts.gray ? ' gray' : '') + '" viewBox="0 0 470 200" width="' + w + '" height="' + h + '" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">');
    s.push('<defs>');
    s.push('<linearGradient id="' + id + 'paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + PAPER + '"/><stop offset="1" stop-color="' + PAPER2 + '"/></linearGradient>');
    // 地紋（細かい点と斜線）
    s.push('<pattern id="' + id + 'dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r=".7" fill="' + G + '" opacity=".35"/></pattern>');
    s.push('<pattern id="' + id + 'hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="1" fill="' + G + '" opacity=".22"/></pattern>');
    // 縁のレース（半円の連なり）
    s.push('<pattern id="' + id + 'lace" width="12" height="8" patternUnits="userSpaceOnUse"><path d="M0 8 A6 6 0 0 1 12 8" fill="none" stroke="' + G + '" stroke-width="1.1"/><circle cx="6" cy="3" r="1" fill="' + G + '"/></pattern>');
    // 肖像の型抜き（エンブレム画像をマスクにして緑で塗る）
    if (emblem) s.push('<mask id="' + id + 'em" maskUnits="userSpaceOnUse" x="185" y="48" width="100" height="104"><image xlink:href="' + base + 'logo-emblem.png" href="' + base + 'logo-emblem.png" x="185" y="48" width="100" height="104" preserveAspectRatio="xMidYMid meet"/></mask>');
    s.push('</defs>');
    // 紙
    s.push('<rect x="1.5" y="1.5" width="467" height="197" rx="5" fill="url(#' + id + 'paper)" stroke="' + G2 + '" stroke-width="2.5"/>');
    s.push('<rect x="7" y="7" width="456" height="186" rx="3" fill="url(#' + id + 'dots)"/>');
    // 外枠のレース帯
    s.push('<rect x="9" y="9" width="452" height="182" rx="3" fill="none" stroke="' + G + '" stroke-width="1"/>');
    s.push('<rect x="12" y="12" width="446" height="8" fill="url(#' + id + 'lace)"/><rect x="12" y="180" width="446" height="8" fill="url(#' + id + 'lace)" transform="rotate(180 235 184)"/>');
    s.push('<rect x="20" y="20" width="430" height="160" rx="2" fill="none" stroke="' + G2 + '" stroke-width="1.6"/>');
    s.push('<rect x="23" y="23" width="424" height="154" fill="none" stroke="' + G + '" stroke-width=".6" stroke-dasharray="2 2"/>');
    // 四隅の「1」（丸い飾り）
    [[44, 44], [426, 44], [44, 156], [426, 156]].forEach((c) => {
      s.push('<circle cx="' + c[0] + '" cy="' + c[1] + '" r="17" fill="' + PAPER + '" stroke="' + G2 + '" stroke-width="1.6"/>');
      s.push('<circle cx="' + c[0] + '" cy="' + c[1] + '" r="13.5" fill="none" stroke="' + G + '" stroke-width=".8" stroke-dasharray="1.5 1.5"/>');
      s.push('<text x="' + c[0] + '" y="' + (c[1] + 8) + '" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-size="24" font-weight="700" fill="' + G2 + '">1</text>');
    });
    // 上の帯の文字
    s.push('<text x="235" y="38" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-size="12" letter-spacing="4.5" fill="' + G2 + '">AMUSEMENT BAR CASA</text>');
    s.push('<text x="235" y="52" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-size="6.5" letter-spacing="2.5" fill="' + G + '">THIS NOTE IS GOOD FOR ONE GAME AT CASA SLOT</text>');
    // 肖像の楕円と、エンブレム
    s.push('<ellipse cx="235" cy="100" rx="58" ry="54" fill="' + PAPER + '" stroke="' + G2 + '" stroke-width="2"/>');
    s.push('<ellipse cx="235" cy="100" rx="52" ry="48" fill="url(#' + id + 'hatch)" stroke="' + G + '" stroke-width=".8"/>');
    if (emblem) s.push('<rect x="185" y="48" width="100" height="104" fill="' + G2 + '" mask="url(#' + id + 'em)"/>');
    else s.push('<text x="235" y="110" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="700" fill="' + G2 + '">casa</text>');
    s.push('<text x="235" y="165" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-size="7" letter-spacing="3" fill="' + G2 + '">CASA SLOT</text>');
    // 左右の印章（財務省印の位置）
    s.push('<circle cx="120" cy="100" r="27" fill="none" stroke="' + G2 + '" stroke-width="1.4"/><circle cx="120" cy="100" r="22" fill="none" stroke="' + G + '" stroke-width=".7" stroke-dasharray="1 1.5"/>');
    s.push('<text x="120" y="96" text-anchor="middle" font-family="Georgia, serif" font-size="9" font-weight="700" letter-spacing="1" fill="' + G2 + '">casa</text><text x="120" y="108" text-anchor="middle" font-family="Georgia, serif" font-size="6" letter-spacing="2" fill="' + G2 + '">SLOT</text>');
    s.push('<circle cx="350" cy="100" r="27" fill="none" stroke="' + G2 + '" stroke-width="1.4"/><circle cx="350" cy="100" r="22" fill="none" stroke="' + G + '" stroke-width=".7" stroke-dasharray="1 1.5"/>');
    s.push('<text x="350" y="94" text-anchor="middle" font-family="Georgia, serif" font-size="8" letter-spacing="1" fill="' + G2 + '">ONE</text><text x="350" y="106" text-anchor="middle" font-family="Georgia, serif" font-size="8" letter-spacing="1" fill="' + G2 + '">GAME</text><text x="350" y="116" text-anchor="middle" font-family="Georgia, serif" font-size="5" letter-spacing="1" fill="' + G + '">TOKYO</text>');
    // 通し番号（緑の数字）
    s.push('<text x="60" y="82" font-family="\'Courier New\', monospace" font-size="9" font-weight="700" letter-spacing="1" fill="' + G + '">' + serial + '</text>');
    s.push('<text x="410" y="130" text-anchor="end" font-family="\'Courier New\', monospace" font-size="9" font-weight="700" letter-spacing="1" fill="' + G + '">' + serial + '</text>');
    // 下の帯「ONE GAME」
    s.push('<rect x="150" y="170" width="170" height="16" rx="2" fill="' + G2 + '"/>');
    s.push('<text x="235" y="182.5" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-size="13" font-weight="700" letter-spacing="6" fill="' + PAPER + '">ONE GAME</text>');
    s.push('<text x="60" y="178" font-family="Georgia, serif" font-size="8" letter-spacing="2" fill="' + G2 + '">ONE</text><text x="410" y="178" text-anchor="end" font-family="Georgia, serif" font-size="8" letter-spacing="2" fill="' + G2 + '">ONE</text>');
    s.push('</svg>');
    return s.join('');
  }
  return { svg };
})();
window.BillArt = BillArt;
