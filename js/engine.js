/* 抽選エンジン（純粋ロジック）。DOM・保存処理に依存しないため Node でもテスト可能。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 各ステージの配当（金額の一覧）。下は初期値で、b52 からは確率表（probs）に書かれた金額がそのまま配当になる。
     setTable(probs) を呼ぶと STAGE_DEFS / OUTCOMES / OUTCOME_BY_KEY / REEL_SYMS が「いま使っている表」に入れ替わる
     （同じ配列・オブジェクトを書き換えるので、参照している側はそのまま使える）。 */
  const DEFAULT_VALUES = { 1: [0, 500, 1000], 2: [0, 1000, 2000, 3000, 5000], 3: [0, 10000, 50000, 100000] };
  const MAX_AMOUNTS = 8, MAX_VALUE = 10000000; // 1ステージの金額の種類の上限／金額の上限
  const STAGE_DEFS = [
    { stage: 1, values: DEFAULT_VALUES[1].slice(), hasNext: true },
    { stage: 2, values: DEFAULT_VALUES[2].slice(), hasNext: true },
    { stage: 3, values: DEFAULT_VALUES[3].slice(), hasNext: false },
  ];
  // 確率表の1ステージぶん（{ 金額: %, NEXT: % }）から金額の一覧を作る（0 を必ず含め、小さい順）
  function rowValues(row) {
    const out = [0];
    Object.keys(row || {}).forEach((k) => { const v = Number(k); if (k !== 'NEXT' && k !== '' && Number.isInteger(v) && v > 0 && out.indexOf(v) < 0) out.push(v); });
    return out.sort((a, b) => a - b);
  }
  // 確率表 p での各ステージの定義（p に無いステージは初期値）
  function tableOf(p) {
    return STAGE_DEFS.map((d) => ({ stage: d.stage, values: p && p[d.stage] ? rowValues(p[d.stage]) : DEFAULT_VALUES[d.stage].slice(), hasNext: d.hasNext }));
  }
  function outcomesOf(p) {
    const o = [];
    tableOf(p).forEach((d) => d.values.forEach((v) => o.push({ key: d.stage + ':' + v, stage: d.stage, value: v })));
    return o;
  }

  // 最終結果の一覧。在庫は「どのステージのどの結果で終了するか」単位で管理する。
  const OUTCOMES = [];
  const OUTCOME_BY_KEY = {};
  function rebuildOutcomes() {
    OUTCOMES.length = 0;
    Object.keys(OUTCOME_BY_KEY).forEach((k) => delete OUTCOME_BY_KEY[k]);
    STAGE_DEFS.forEach((d) => d.values.forEach((v) => { const o = { key: d.stage + ':' + v, stage: d.stage, value: v }; OUTCOMES.push(o); OUTCOME_BY_KEY[o.key] = o; }));
  }
  rebuildOutcomes();

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
  /* ---------- 確率抽選（ボタン版） ----------
     probs[stage][key] は％（小数第2位まで）。key は金額の文字列か 'NEXT'。各ステージの合計は 100。 */
  function probKeys(d) { return d.values.map(String).concat(d.hasNext ? ['NEXT'] : []); }
  function defaultProbs() {
    return {
      1: { 0: 60, 500: 20, 1000: 10, NEXT: 10 },
      2: { 0: 50, 1000: 20, 2000: 10, 3000: 6, 5000: 4, NEXT: 10 },
      3: { 0: 70, 10000: 20, 50000: 8, 100000: 2 },
    };
  }
  const units = (x) => Math.round(Number(x) * 100); // 0.01% 単位の整数
  function validateProbs(p) {
    const errors = [];
    tableOf(p).forEach((d) => {
      const row = (p && p[d.stage]) || {};
      let ok = true, sum = 0;
      // 金額の書き方: 0 以上の整数（先頭の 0 や小数は不可）。NEXT は次のステージがある段だけ
      const bad = Object.keys(row).filter((k) => (k === 'NEXT' ? !d.hasNext && Number(row[k]) > 0 : !(String(Number(k)) === k && Number.isInteger(Number(k)) && Number(k) >= 0 && Number(k) <= MAX_VALUE)));
      if (bad.length) errors.push('STAGE ' + d.stage + ': 金額は 1 以上の整数で入力してください（' + bad.join('、') + '）。');
      if (d.values.length - 1 > MAX_AMOUNTS) errors.push('STAGE ' + d.stage + ': 金額は ' + MAX_AMOUNTS + ' 種類までです。');
      probKeys(d).forEach((k) => {
        const v = Number(row[k]);
        if (!Number.isFinite(v) || v < 0 || v > 100 || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) ok = false;
        else sum += units(v);
      });
      if (!ok) errors.push('STAGE ' + d.stage + ': 0〜100 の数字（小数第2位まで）で入力してください。');
      else if (sum !== 10000) errors.push('STAGE ' + d.stage + ': 合計が ' + sum / 100 + '% です。ちょうど 100% にしてください。');
    });
    return { ok: errors.length === 0, errors };
  }
  function probStats(p) {
    const sums = {}, reach = { 1: 1 }, outcome = {};
    let ev = 0, win = 0;
    tableOf(p).forEach((d) => {
      const row = (p && p[d.stage]) || {};
      let sum = 0;
      probKeys(d).forEach((k) => { const v = Number(row[k]); sum += Number.isFinite(v) ? units(v) : 0; });
      sums[d.stage] = sum / 100;
      const r = reach[d.stage] || 0;
      d.values.forEach((v) => {
        const q = r * (Number(row[v]) || 0) / 100;
        outcome[d.stage + ':' + v] = q;
        ev += q * v;
        if (v > 0) win += q;
      });
      if (d.hasNext) reach[d.stage + 1] = r * (Number(row.NEXT) || 0) / 100;
    });
    return { sums, reach, outcome, ev, win: Math.min(1, Math.max(0, win)) }; // 浮動小数の丸めで 1 をごくわずかに超えることがある（b77）
  }
  /* 24時間の当たり本数制限。limits = { on, total, max: { 'stage:value': n } }
     total = 直近24時間の当たり本数（合計）の上限、max = 金額ごとの上限（任意）。0 は無制限。hits = [{ ts, key }]。
     上限に達した金額は、その分の確率をそのステージの「0」に回す（他の当たりは増えない）。 */
  /* 営業日の区切り: 毎日 resetHour 時（既定 19:00）にカウントが 0 に戻る。直近の区切り時刻を返す */
  function windowStart(now, resetHour) {
    const h = Number.isInteger(resetHour) ? resetHour : 19;
    const d = new Date(now);
    d.setHours(h, 0, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  }
  function pruneHits(hits, now, resetHour) { const from = windowStart(now, resetHour); return (hits || []).filter((h) => h.ts >= from); }
  function hitCounts(hits, now, resetHour) {
    const c = { total: 0 };
    pruneHits(hits, now, resetHour).forEach((h) => { c[h.key] = (c[h.key] || 0) + 1; c.total += 1; });
    return c;
  }
  function blockedKeys(limits, hits, now, p) {
    if (!limits || !limits.on) return [];
    const c = hitCounts(hits, now, limits.resetHour), out = [];
    const total = Number(limits.total) || 0;
    (p ? outcomesOf(p) : OUTCOMES).forEach((o) => {
      if (!(o.value > 0)) return;
      const m = Number(limits.max && limits.max[o.key]) || 0;
      if ((total > 0 && c.total >= total) || (m > 0 && (c[o.key] || 0) >= m)) out.push(o.key);
    });
    return out;
  }
  /* 開始直後の高額制限: 営業日（毎日 resetHour 時から）の最初の plays 回は、min 以上の金額を出さない。
     early = { on, plays, min }、played = その営業日にこの端末ですでに回した回数。止める目の一覧を返す（確率はそのステージの 0 に回る） */
  function earlyBlocked(early, played, p) {
    if (!early || !early.on) return [];
    const n = Number(early.plays) || 0, min = Number(early.min) || 0;
    if (n <= 0 || min <= 0 || (Number(played) || 0) >= n) return [];
    return (p ? outcomesOf(p) : OUTCOMES).filter((o) => o.value >= min).map((o) => o.key);
  }
  function drawProb(p, rng, blocked) {
    rng = rng || secureRandomInt;
    blocked = blocked || [];
    const T = tableOf(p);
    for (let i = 0; i < T.length; i++) {
      const d = T[i], row = p[d.stage] || {}, keys = probKeys(d); // b81: ステージの行が無い表でも落ちない（validateProbs で弾いているが念のため）
      const w = keys.map((k) => Math.max(0, units(row[k]) || 0));
      keys.forEach((k, j) => { if (k !== '0' && k !== 'NEXT' && blocked.indexOf(d.stage + ':' + k) >= 0) { w[0] += w[j]; w[j] = 0; } });
      const total = w.reduce((a, b) => a + b, 0);
      let pick = '0';
      if (total > 0) {
        let r = rng(total);
        for (let j = 0; j < keys.length; j++) { if (r < w[j]) { pick = keys[j]; break; } r -= w[j]; }
      }
      if (pick !== 'NEXT') return { overflow: false, key: d.stage + ':' + pick, stage: d.stage, value: Number(pick) };
    }
    throw new Error('drawProb: unreachable');
  }
  /* ---------- 3本リールの見せ方（合計方式） ----------
     各リールは「金額」「BAR（0円）」「NEXT」のどれか。NEXT が3本そろえば次のステージ、それ以外は金額の合計が当選額（NEXT 1〜2本は 0 扱い）。
     結果は確率で先に決まっていて、その結果になる組み合わせの中から見せ方を選ぶだけ。 */
  const REEL_BASE = {
    1: [100, 200, 300, 400, 500],
    2: [500, 1000, 2000, 3000, 5000],
    3: [5000, 10000, 20000, 30000, 50000, 100000],
  };
  const REEL_SYMS = { 1: REEL_BASE[1].slice(), 2: REEL_BASE[2].slice(), 3: REEL_BASE[3].slice() };
  // S の絵柄 1〜3 個（同じ絵柄の繰り返し可）の合計で t を作れるか
  function canMake(S, t) {
    for (let i = 0; i < S.length; i++) {
      if (S[i] === t) return true;
      for (let j = i; j < S.length; j++) {
        if (S[i] + S[j] === t) return true;
        for (let k = j; k < S.length; k++) if (S[i] + S[j] + S[k] === t) return true;
      }
    }
    return false;
  }
  /* そのステージのリールに出す数字の絵柄を、配当の一覧から決める。
     もとの絵柄（REEL_BASE）を土台に、それでは作れない金額だけ「その金額そのもの」と「半分」を足す。
     最後に、どの配当の合計にも使えない絵柄（出ても当たりにならない数字）は外す。初期の配当表ではもとの絵柄と同じになる。 */
  function symsFor(stage, values) {
    const A = (values || []).filter((v) => v > 0);
    const S = REEL_BASE[stage].slice();
    A.forEach((v) => {
      if (canMake(S, v)) return;
      S.push(v);
      const h = v / 2;
      if (Number.isInteger(h) && h >= 100 && h % 100 === 0 && S.indexOf(h) < 0) S.push(h);
    });
    const used = {};
    const mark = (list) => { const sum = list.reduce((a, b) => a + b, 0); if (A.indexOf(sum) >= 0) list.forEach((s) => { used[s] = true; }); };
    for (let i = 0; i < S.length; i++) {
      mark([S[i]]);
      for (let j = i; j < S.length; j++) {
        mark([S[i], S[j]]);
        for (let k = j; k < S.length; k++) mark([S[i], S[j], S[k]]);
      }
    }
    return S.filter((s, i) => used[s] && S.indexOf(s) === i).sort((a, b) => a - b);
  }
  const FREES = ['FREE', 'FREE2', 'FREE3', 'LOGO']; // FREE SPIN ×1 / ×2 / ×3、casa ロゴ（3本そろうと 10 FREE SPIN を獲得）
  function readReels(stage, syms) {
    let nexts = 0, sum = 0;
    syms.forEach((s) => { if (s === 'NEXT') nexts++; else if (typeof s === 'number') sum += s; });
    if (nexts >= 3 && STAGE_DEFS[stage - 1].hasNext) return 'NEXT';
    // FREE SPIN ×1 / ×2 / ×3: 同じものが3本そろったら、その回数だけ回り直す（演出。結果は確定済み）。種類が混ざったら 0 扱い
    if (FREES.indexOf(syms[0]) >= 0 && syms[1] === syms[0] && syms[2] === syms[0]) return syms[0];
    return sum;
  }
  // 配列の要素の並び替え（重複を除く）
  function perms(arr) {
    const out = [], seen = {};
    (function go(rest, acc) {
      if (!rest.length) { const k = acc.join('|'); if (!seen[k]) { seen[k] = true; out.push(acc.slice()); } return; }
      for (let i = 0; i < rest.length; i++) go(rest.slice(0, i).concat(rest.slice(i + 1)), acc.concat([rest[i]]));
    })(arr, []);
    return out;
  }
  const comboCache = {};
  /* 使う配当表を切り替える（端末: 確率を読み込んだ時・プリセットが変わった時／マスター: 編集中のプリセット）。
     p を省略すると初期の配当表に戻る。 */
  function setTable(p) {
    const T = tableOf(p);
    T.forEach((d, i) => { STAGE_DEFS[i].values = d.values; REEL_SYMS[d.stage] = symsFor(d.stage, d.values); });
    rebuildOutcomes();
    Object.keys(comboCache).forEach((k) => delete comboCache[k]);
    return T;
  }
  /* target（金額 / 0 / 'NEXT'）になる3本の組み合わせをすべて返す（左中右の並びも別物として数える） */
  function reelCombos(stage, target) {
    const key = stage + ':' + target;
    if (comboCache[key]) return comboCache[key];
    const D = REEL_SYMS[stage], hasNext = STAGE_DEFS[stage - 1].hasNext;
    const out = [], seen = {};
    const add = (c) => { const k = c.join('|'); if (!seen[k]) { seen[k] = true; out.push(c); } };
    const fill = (hasNext ? ['NEXT'] : []).concat(FREES); // そろわなければ 0 扱いの絵柄（1〜2本だけ混ぜる）
    if (target === 'NEXT') {
      if (hasNext) add(['NEXT', 'NEXT', 'NEXT']); // 次のステージは3本そろいだけ
    } else if (FREES.indexOf(target) >= 0) {
      add([target, target, target]);
    } else if (target === 0) {
      add(['BAR', 'BAR', 'BAR']);
      fill.forEach((a) => { perms([a, 'BAR', 'BAR']).forEach(add); perms([a, a, 'BAR']).forEach(add); });
      if (hasNext) { perms(['NEXT', 'FREE', 'BAR']).forEach(add); perms(['NEXT', 'NEXT', 'FREE']).forEach(add); perms(['NEXT', 'FREE', 'FREE']).forEach(add); }
    } else {
      // 金額を 1〜3 個の絵柄の和で作る（同じ絵柄の繰り返し可）。残りは BAR、または NEXT（1〜2本。3本そろわなければ 0 扱い）
      const sets = [];
      for (let i = 0; i < D.length; i++) {
        if (D[i] === target) sets.push([D[i]]);
        for (let j = i; j < D.length; j++) {
          if (D[i] + D[j] === target) sets.push([D[i], D[j]]);
          for (let k = j; k < D.length; k++) if (D[i] + D[j] + D[k] === target) sets.push([D[i], D[j], D[k]]);
        }
      }
      sets.forEach((s) => {
        const pad = 3 - s.length;
        perms(s.concat(new Array(pad).fill('BAR'))).forEach(add);
        if (pad >= 1) fill.forEach((a) => perms(s.concat([a]).concat(new Array(pad - 1).fill('BAR'))).forEach(add));
        if (pad >= 2) { fill.forEach((a) => perms(s.concat([a, a])).forEach(add)); if (hasNext) perms(s.concat(['NEXT', 'FREE'])).forEach(add); }
      });
    }
    // 念のため、読み取り結果が target と一致するものだけを残す
    const ok = out.filter((c) => readReels(stage, c) === target);
    comboCache[key] = ok;
    return ok;
  }
  /* 最後に止まるリール idx に「別の絵柄」を入れたとき、その段の正規の結果（0・各金額・NEXT）になる絵柄の一覧
     （止まりかけで見せる「惜しい」絵柄の候補）。actual と同じ読みになるものは除く */
  function reelAlternatives(stage, combo, idx) {
    const d = STAGE_DEFS[stage - 1];
    const valid = d.values.concat(d.hasNext ? ['NEXT'] : []).concat(FREES);
    const actual = readReels(stage, combo);
    const cands = ['BAR'].concat(REEL_SYMS[stage]).concat(d.hasNext ? ['NEXT'] : []).concat(FREES);
    return cands.filter((s) => {
      if (s === combo[idx]) return false;
      const c = combo.slice(); c[idx] = s;
      const v = readReels(stage, c);
      return v !== actual && valid.indexOf(v) >= 0;
    });
  }
  /* 期待の段階化（見せ方だけ。結果は変えない）: 先に止まる2本を見て、3本目が回っている間に盛り上げてよい場面かを返す。
       next … NEXT STAGE が2本 / free … 同じ FREE SPIN が2本 / logo … casa ロゴが2本
       sum  … 2本目までの合計が大きい（そのステージの金額のうち上位半分が当たる回で、2本の合計がその当選額の半分以上）
     cap = 上がれる段階の上限（1〜3）、hit = 3本目で本当に「来る」か（sum は、そのステージの最高額になるか）、
     big = 大きな場面か（NEXT STAGE・casa ロゴ・FREE SPIN ×3・STAGE 2 以上の合計。false の場面は控えめに出す）。当てはまらなければ null */
  function tensionOf(stage, combo, order) {
    const d = STAGE_DEFS[stage - 1];
    if (!d || !combo || !order) return null;
    const a = combo[order[0]], b = combo[order[1]], c = combo[order[2]];
    if (a === 'NEXT' && b === 'NEXT' && d.hasNext) return { kind: 'next', cap: stage >= 2 ? 3 : 2, hit: c === 'NEXT', big: true };
    if (a === b && a === 'LOGO') return { kind: 'logo', cap: 3, hit: c === a, big: true };
    if (a === b && FREES.indexOf(a) >= 0) return { kind: 'free', cap: FREES.indexOf(a) + 1, hit: c === a, big: a === 'FREE3' };
    const num = (x) => (typeof x === 'number' ? x : 0);
    const sum2 = num(a) + num(b), total = readReels(stage, combo);
    if (sum2 > 0 && typeof total === 'number' && total > 0 && sum2 * 2 >= total) {
      const vals = d.values.filter((v) => v > 0).sort((x, y) => x - y);
      const upper = vals.slice(Math.floor(vals.length / 2)); // 上位半分の金額（奇数個なら真ん中を含む）
      if (upper.indexOf(total) >= 0) return { kind: 'sum', cap: Math.min(3, stage), hit: total === vals[vals.length - 1], big: stage >= 2, sum: sum2 };
    }
    return null;
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
    STAGE_DEFS, OUTCOMES, OUTCOME_BY_KEY, DEFAULT_VALUES, MAX_AMOUNTS, MAX_VALUE, tableOf, setTable, symsFor,
    emptyCounts, sumCounts, prizeTotal, winCount,
    defaultCapRules, validateCapRules, capFor,
    validateSetup, createSession, validateAdjust,
    secureRandomInt, draw, applyDraw, pathFor,
    probKeys, defaultProbs, validateProbs, probStats, drawProb, windowStart, pruneHits, hitCounts, blockedKeys, earlyBlocked, FREE_SYMS: FREES,
    REEL_SYMS, readReels, reelCombos, reelAlternatives, tensionOf,
    sha256, makePin, checkPin,
  };
});
