/* casa BOAT の実況の声: 字幕の文（boat/race-boat.js の script() が作る 1 行）を、声の部品の並びに分ける。
   声の部品は tools/make-boat-announce.js が作る（art/voice-boat/announce.m4a と index.json。VOICEVOX:玄野武宏）。
   分け方: 文の中の「変わる所」（艇番・選手の姓・番・倍率・組番・艇身・○対○・進入の数字）を部品にし、その間の決まった言い回しは丸ごと 1 部品。
     例「バックストレッチ、先頭は 5号艇 満家。2番手 1号艇、3番手 2号艇」→ [バックストレッチ、先頭は][5号艇][満家][。の間][2番手][1号艇][、の間][3番手][2号艇]
   段（tier）: 0 = レース前（落ち着いた）・1 = レース中・2 = 「！」のある文（盛り上がり）。部品が無い段は近い段で代わりに鳴らす。
   ブラウザ（BOAT.Announce）と node（require）の両方で使う（声づくりの道具が同じ分け方で部品の一覧を作るため）。 */
(function (root) {
  'use strict';
  const PUNCT = /^[、。！!？?\s]+|[、。！!？?\s]+$/g;
  // 句読点の間（秒）
  const PAUSE = { '、': 0.1, '。': 0.22, '！': 0.18 };
  function tierOf(line) { return /！|!/.test(line.s) ? 2 : line.t >= 0 ? 1 : 0; }
  // 文 → [{ type, v }]。type: 'say'（決まった言い回し）・'pause'（秒）・'B'（N号艇）・'U'（N番）・'S'（姓）・'D'（数字 1 つ）・'V'（a 対 b）・'G'（N 艇身）・'C'（組番 a-b）・'O'（倍率）
  function parse(text, names) {
    const out = [];
    const nameAlt = (names || []).filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|');
    const NM = nameAlt ? '(?: (' + nameAlt + '))?' : '()';
    const re = new RegExp('進入は ((?:[1-6] )+[1-6]) となりました|([1-6])号艇' + NM + '|([1-6])番(?!手)' + NM + '|(\\d+)\\.(\\d)倍|([1-6])-([1-6])|(\\d+) 艇身|([1-5]) 対 ([1-5])', 'g');
    let last = 0, m;
    const fixed = (s) => {
      // 決まった言い回し: 頭と終わりの句読点は「間」に、中はそのまま（読みの抑揚に使う）
      const lead = (s.match(/^[、。！!？?\s]+/) || [''])[0], tail = (s.match(/[、。！!？?\s]+$/) || [''])[0];
      const p = (x) => { const c = x.replace(/\s/g, ''); if (!c) return; let sec = 0; for (const ch of c) sec = Math.max(sec, PAUSE[ch] || 0.1); out.push({ type: 'pause', v: sec }); };
      p(lead);
      // 中の句読点でも区切る（「は流れた、差して」のような組み合わせを部品 2 つで言えるように）
      const body = s.replace(PUNCT, '').replace(/\s+/g, '');
      body.split(/([、。！!？?]+)/).forEach((seg, k) => { if (!seg) return; if (k % 2) p(seg); else out.push({ type: 'say', v: seg }); });
      p(tail);
    };
    while ((m = re.exec(text))) {
      if (m.index > last) fixed(text.slice(last, m.index));
      if (m[1]) { out.push({ type: 'say', v: '進入は' }); m[1].split(' ').forEach((d) => out.push({ type: 'D', v: +d })); out.push({ type: 'say', v: 'となりました' }); }
      else if (m[2]) { out.push({ type: 'B', v: +m[2] }); if (m[3]) out.push({ type: 'S', v: m[3] }); }
      else if (m[4]) { out.push({ type: 'U', v: +m[4] }); if (m[5]) out.push({ type: 'S', v: m[5] }); }
      else if (m[6]) out.push({ type: 'O', v: [+m[6], +m[7]] });
      else if (m[8]) out.push({ type: 'C', v: [+m[8], +m[9]] });
      else if (m[10]) out.push({ type: 'G', v: +m[10] });
      else if (m[11]) out.push({ type: 'V', v: [+m[11], +m[12]] });
      last = re.lastIndex;
    }
    if (last < text.length) fixed(text.slice(last));
    // 「間」の連続はまとめる
    const res = [];
    out.forEach((x) => { const p = res[res.length - 1]; if (x.type === 'pause' && p && p.type === 'pause') p.v = Math.max(p.v, x.v); else res.push(x); });
    while (res.length && res[0].type === 'pause') res.shift();
    while (res.length && res[res.length - 1].type === 'pause') res.pop();
    return res;
  }
  // 部品 → 声の部品の名前（tier なし）。倍率は 整数の部分（1〜99・100 の位）＋「てん○倍」に分ける
  function partKeys(p) {
    switch (p.type) {
      case 'say': return ['=' + p.v];
      case 'B': return ['#B' + p.v];
      case 'U': return ['#U' + p.v];
      case 'S': return ['#S' + p.v];
      case 'D': return ['#D' + p.v];
      case 'V': return ['#V' + p.v[0]];
      case 'G': return ['#G' + Math.min(30, p.v)];
      case 'C': return ['#C' + p.v[0] + p.v[1]];
      case 'O': { const n = p.v[0], k = []; if (n >= 100) k.push('#H' + Math.floor(n / 100)); if (n % 100) k.push('#I' + (n % 100)); k.push('#P' + p.v[1]); return k; }
      default: return [];
    }
  }
  // 1 行 → [{ key, tier } または { pause }]
  function plan(line, names) {
    const tier = tierOf(line), out = [];
    parse(line.s, names).forEach((p) => { if (p.type === 'pause') out.push({ pause: p.v }); else partKeys(p).forEach((k) => out.push({ key: k, tier })); });
    return out;
  }
  const API = { parse, partKeys, plan, tierOf, PAUSE };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { root.BOAT = root.BOAT || {}; root.BOAT.Announce = API; }
})(typeof window !== 'undefined' ? window : globalThis);
