/* 抽選エンジン（純粋ロジック）。DOM・保存処理に依存しないため Node でもテスト可能。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STAGE_DEFS = [
    { stage: 1, values: [0, 500, 1000], hasNext: true },
    { stage: 2, values: [0, 1000, 2000, 3000, 5000], hasNext: true },
    { stage: 3, values: [0, 10000, 50000, 100000], hasNext: false },
  ];

  // 最終結果の一覧。在庫は「どのステージのどの結果で終了するか」単位で管理する。
  const OUTCOMES = [];
  STAGE_DEFS.forEach((d) =>
    d.values.forEach((v) => OUTCOMES.push({ key: d.stage + ':' + v, stage: d.stage, value: v }))
  );
  const OUTCOME_BY_KEY = {};
  OUTCOMES.forEach((o) => (OUTCOME_BY_KEY[o.key] = o));

  const isCount = (n) => Number.isInteger(n) && n >= 0;

  function emptyCounts() {
    const c = {};
    OUTCOMES.forEach((o) => (c[o.key] = 0));
    return c;
  }
  function sumCounts(c) {
    let s = 0;
    OUTCOMES.forEach((o) => (s += c[o.key] || 0));
    return s;
  }
  function prizeTotal(c) {
    let s = 0;
    OUTCOMES.forEach((o) => (s += o.value * (c[o.key] || 0)));
    return s;
  }
  function winCount(c) {
    let s = 0;
    OUTCOMES.forEach((o) => { if (o.value > 0) s += c[o.key] || 0; });
    return s;
  }

  /* ---------- プライズ上限ルール ---------- */
  function defaultCapRules() {
    return {
      ranges: [
        { from: 0, to: 20, cap: 15000 },
        { from: 21, to: 25, cap: 20000 },
        { from: 26, to: 30, cap: 25000 },
        { from: 31, to: 35, cap: 30000 },
      ],
      beyond: { step: 5, inc: 5000 }, // 最終範囲を超えた分: step エントリーごとに inc 加算
    };
  }
  function validateCapRules(r) {
    const errors = [];
    if (!r || !Array.isArray(r.ranges) || r.ranges.length === 0) return ['ルールが1件もありません。'];
    r.ranges.forEach((x, i) => {
      const n = i + 1;
      if (!isCount(x.from) || !isCount(x.to) || !isCount(x.cap)) errors.push(n + '行目: 0以上の整数を入力してください。');
      else {
        if (x.to < x.from) errors.push(n + '行目: 終了エントリーが開始より小さくなっています。');
        const expect = i === 0 ? 0 : r.ranges[i - 1].to + 1;
        if (x.from !== expect) errors.push(n + '行目: 開始エントリーは ' + expect + ' である必要があります。');
      }
    });
    if (!r.beyond || !Number.isInteger(r.beyond.step) || r.beyond.step < 1) errors.push('範囲超過時の加算単位（エントリー数）は1以上の整数にしてください。');
    if (!r.beyond || !isCount(r.beyond.inc)) errors.push('範囲超過時の加算額は0以上の整数にしてください。');
    return errors;
  }
  function capFor(total, rules) {
    const rs = rules.ranges;
    for (let i = 0; i < rs.length; i++) if (total >= rs[i].from && total <= rs[i].to) return rs[i].cap;
    const last = rs[rs.length - 1];
    if (total > last.to) return last.cap + Math.ceil((total - last.to) / rules.beyond.step) * rules.beyond.inc;
    return 0;
  }

  /* ---------- 営業設定の検証 ---------- */
  function validateSetup(total, counts, rules) {
    const errors = [];
    let countsOk = true;
    OUTCOMES.forEach((o) => { if (!isCount(counts[o.key])) countsOk = false; });
    if (!countsOk) errors.push('各結果の本数は0以上の整数で入力してください。');
    if (!Number.isInteger(total) || total < 1) errors.push('総本数は1以上の整数で入力してください。');
    const sum = countsOk ? sumCounts(counts) : NaN;
    const prize = countsOk ? prizeTotal(counts) : NaN;
    const cap = Number.isInteger(total) && total >= 0 ? capFor(total, rules) : NaN;
    if (countsOk && Number.isInteger(total) && sum !== total)
      errors.push('総本数（' + total + '）と各結果の合計（' + sum + '）が一致していません。');
    if (countsOk && !Number.isNaN(cap) && prize > cap)
      errors.push('プライズ総額（' + prize.toLocaleString('en-US') + '）が上限（' + cap.toLocaleString('en-US') + '）を超えています。');
    return { ok: errors.length === 0, errors, sum, prize, cap };
  }

  function createSession(id, total, counts, rules, now) {
    const v = validateSetup(total, counts, rules);
    if (!v.ok) throw new Error(v.errors.join(' / '));
    const initial = emptyCounts(), remaining = emptyCounts(), consumed = emptyCounts();
    OUTCOMES.forEach((o) => { initial[o.key] = counts[o.key]; remaining[o.key] = counts[o.key]; });
    return { id, startedAt: now, total, cap: v.cap, initial, remaining, consumed, playNo: 0, overflowCount: 0, awarded: 0 };
  }

  /* 営業途中の残存内訳調整。消化済み(consumed)には触れず、残り総本数を変えない。 */
  function validateAdjust(session, next, rules) {
    const errors = [];
    let countsOk = true;
    OUTCOMES.forEach((o) => { if (!isCount(next[o.key])) countsOk = false; });
    if (!countsOk) errors.push('各結果の本数は0以上の整数で入力してください。');
    const remain = sumCounts(session.remaining);
    const sum = countsOk ? sumCounts(next) : NaN;
    const cap = capFor(session.total, rules);
    const prize = countsOk ? session.awarded + prizeTotal(next) : NaN;
    if (countsOk && sum !== remain)
      errors.push('変更後の合計（' + sum + '）が残り総本数（' + remain + '）と一致していません。');
    if (countsOk && prize > cap)
      errors.push('プライズ総額（払出済＋残存 = ' + prize.toLocaleString('en-US') + '）が上限（' + cap.toLocaleString('en-US') + '）を超えています。');
    return { ok: errors.length === 0, errors, sum, remain, prize, cap };
  }

  /* ---------- 乱数 ---------- */
  function secureRandomInt(n) {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && c.getRandomValues) {
      const limit = Math.floor(0x100000000 / n) * n; // 剰余バイアスを排除
      const buf = new Uint32Array(1);
      do c.getRandomValues(buf); while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  /* ---------- 抽選 ----------
     残存在庫から最終結果を1本引く。在庫が無い場合は「超過プレイ」として必ず 0
     （0で終わるステージのみランダム）を返し、在庫には一切触れない。 */
  function draw(session, rng) {
    rng = rng || secureRandomInt;
    const remain = sumCounts(session.remaining);
    if (remain <= 0) return { overflow: true, key: null, stage: 1 + rng(3), value: 0 };
    let r = rng(remain);
    for (let i = 0; i < OUTCOMES.length; i++) {
      const o = OUTCOMES[i];
      const n = session.remaining[o.key] || 0;
      if (r < n) return { overflow: false, key: o.key, stage: o.stage, value: o.value };
      r -= n;
    }
    throw new Error('draw: inventory inconsistent');
  }
  function applyDraw(session, res) {
    session.playNo += 1;
    if (res.overflow) { session.overflowCount += 1; return; }
    if (!(session.remaining[res.key] > 0)) throw new Error('applyDraw: no stock for ' + res.key);
    session.remaining[res.key] -= 1;
    session.consumed[res.key] += 1;
    session.awarded += res.value;
  }
  function pathFor(stage) {
    const p = [];
    for (let i = 1; i <= stage; i++) p.push(i);
    return p;
  }

  /* ---------- SHA-256（非セキュアコンテキストでも動くよう自前実装） ---------- */
  const K = [], H0 = [];
  (function () {
    const isComp = {};
    let n = 0;
    for (let c = 2; n < 64; c++) {
      if (isComp[c]) continue;
      for (let i = c * c; i < 320; i += c) isComp[i] = true;
      if (n < 8) H0[n] = (Math.pow(c, 0.5) * 0x100000000) | 0;
      K[n++] = (Math.pow(c, 1 / 3) * 0x100000000) | 0;
    }
  })();
  function sha256(str) {
    const bytes = [];
    const s = unescape(encodeURIComponent(str));
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    const h = H0.slice();
    const w = new Array(64);
    const rr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++)
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    return h.map((x) => ('00000000' + (x >>> 0).toString(16)).slice(-8)).join('');
  }
  function randomSalt() {
    let s = '';
    for (let i = 0; i < 16; i++) s += ('0' + secureRandomInt(256).toString(16)).slice(-2);
    return s;
  }
  function hashPin(pin, salt) {
    let h = salt + ':' + pin;
    for (let i = 0; i < 1500; i++) h = sha256(h + salt);
    return h;
  }
  function makePin(pin) {
    const salt = randomSalt();
    return { salt, hash: hashPin(pin, salt) };
  }
  function checkPin(pin, rec) {
    return !!rec && hashPin(pin, rec.salt) === rec.hash;
  }

  return {
    STAGE_DEFS, OUTCOMES, OUTCOME_BY_KEY,
    emptyCounts, sumCounts, prizeTotal, winCount,
    defaultCapRules, validateCapRules, capFor,
    validateSetup, createSession, validateAdjust,
    secureRandomInt, draw, applyDraw, pathFor,
    sha256, makePin, checkPin,
  };
});
