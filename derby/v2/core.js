/* casa DERBY v2 の決まりごと（DOM・通信なし。node とブラウザの両方で動く）: window.DerbyCore
   v2/server.js（模擬クラウド）と同じ計算を、データを引数で受け取る形にしたもの。Firestore 版（v2/client-firestore.js）と
   「結果を決めるテレビ」はこれを使う。中身は server.js と同じ決まり（API.md・DESIGN.md）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DerbyCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const JST = 9 * 3600 * 1000, DAY = 86400000;
  /* お金の単位（2026-10-16 オーナー決定）: 投票は枚（リングバウンティ 1 枚）のまま、払い戻し・設定額・上限・集計の払い出しは「額」（1 枚 = 100）。
     当選額 = 枚数 × オッズ × 100（outcome.js の stakePayout。0.1 刻みなので整数）。返還・返却はリングバウンティで返す（下の bountyPerTicket。2026-10-17） */
  const MONEY_PER_TICKET = 100;
  const roundAmount = (v) => Math.max(0, Math.round((Number(v) || 0) / MONEY_PER_TICKET) * MONEY_PER_TICKET); // 管理画面で入れた額は 100 単位に丸める
  /* リングバウンティ → 投票券の交換の割合（2026-10-17 オーナー「リングバウンティ20枚につき投票権1枚と交換する感じにして」）:
     bountyPerTicket ＝ 投票券 1 枚に必要なリングバウンティの枚数（初期 20・整数 1〜1000。公開してよい）。
     認証したときの割合を券に残す（tk.rate・tk.bounty = 枚数 × 割合）。あとで割合を変えても前の券・記録・返却は変わらない。
     割合のない以前の券・受け取り・記録は 1 対 1（rate 1）。返却・返還はリングバウンティで返す（受け取りの bounty。amount は 0）。
     当選額・受取額（1 枚 = 100）はこれまでどおり（混ぜない） */
  const BOUNTY_DEFAULT = 20, BOUNTY_MAX = 1000;
  const rateOf = (x) => { const r = x && Number(x.rate); return Number.isInteger(r) && r >= 1 ? r : 1; };
  const bountyRate = (t) => { const r = t && Number(t.bountyPerTicket); return Number.isInteger(r) && r >= 1 && r <= BOUNTY_MAX ? r : BOUNTY_DEFAULT; };
  const ticketBounty = (tk) => (tk && tk.bounty != null && Number.isFinite(Number(tk.bounty)) ? Number(tk.bounty) : ((tk && Number(tk.count)) || 0) * rateOf(tk));
  // 返却・返還の受け取りのリングバウンティ（以前の受け取りは amount が額＝枚数 × 100 だったので ÷100。当たりは 0）
  const payoutBounty = (p) => (!p || p.kind !== 'refund' ? 0 : p.bounty != null ? Number(p.bounty) || 0 : Math.round((Number(p.amount) || 0) / MONEY_PER_TICKET));
  // 記録 1 行のリングバウンティ（認証・返却・返還・返却/返還の受け取りと期限切れ）。以前の記録: 認証は枚数（1 対 1）、ほかは額 ÷100
  const isBountyLog = (l) => !!l && (l.type === 'auth' || l.type === 'return' || l.type === 'refund' || ((l.type === 'paid' || l.type === 'expired') && l.kind === 'refund'));
  const logBounty = (l) => (!isBountyLog(l) ? 0 : l.bounty != null ? Number(l.bounty) || 0 : l.type === 'auth' ? Number(l.count) || 0 : Math.round((Number(l.count) || 0) / MONEY_PER_TICKET));
  /* 会計番号ごとの集計（server.js・Firestore 版の記録 API の byBill）: auth＝認証した投票券の枚数・bounty＝受け取ったリングバウンティ・win/paid/expired＝当選額・受取額・期限切れ（額）・
     refund／return＝返還／返却するリングバウンティ・paidBack＝返したリングバウンティ・expiredBack＝期限切れのリングバウンティ */
  function sumBill(logs) {
    const by = {};
    (logs || []).forEach((l) => {
      const x = (by[l.bill] = by[l.bill] || { auth: 0, bounty: 0, win: 0, paid: 0, expired: 0, refund: 0, return: 0, paidBack: 0, expiredBack: 0, nick: l.nick }), n = Number(l.count) || 0, b = logBounty(l);
      if (l.type === 'auth') { x.auth += n; x.bounty += b; }
      else if (l.type === 'win') x.win += n;
      else if (l.type === 'paid') { if (l.kind === 'refund') x.paidBack += b; else x.paid += n; }
      else if (l.type === 'expired') { if (l.kind === 'refund') x.expiredBack += b; else x.expired += n; }
      else if (l.type === 'refund') x.refund += b;
      else if (l.type === 'return') x.return += b;
    });
    return by;
  }
  /* 集計 1 日（または店ごと）のリングバウンティ: 新しい項目（bountyBet・betRated・bountyReturned・returnedTickets・bountyRefund…）と、以前の項目（returned・refund は額）を合わせる。
     bountyIn＝受け取ったリングバウンティ（投票した券＋返却した券）、exchanged＝引き換えた投票券の枚数 */
  function statBounty(s) {
    s = s || {}; const n = (k) => Number(s[k]) || 0, old = (k) => Math.round(n(k) / MONEY_PER_TICKET);
    const retT = n('returnedTickets') + old('returned'), ret = n('bountyReturned') + old('returned');
    return { bountyIn: n('bountyBet') + Math.max(0, n('bet') - n('betRated')) + ret, exchanged: n('bet') + retT, bountyReturned: ret, bountyReturnedPaid: n('bountyReturnedPaid') + old('returnedPaid'), bountyReturnedExpired: n('bountyReturnedExpired') + old('returnedExpired'), bountyRefund: n('bountyRefund') + old('refund'), bountyRefundPaid: n('bountyRefundPaid'), bountyRefundExpired: n('bountyRefundExpired') + old('refundExpired') };
  }
  const RUN_LEAD_MS = 2000, LATE_CAP_MS = 60000; // 遅れて決めたとき: ゲートは「決めた 2 秒後」より前に開けない／60 秒より大きく遅れたらすぐ発表
  /* 確定演出（2026-10-16 オーナー決定。パチンコの確定演出のように、レースの中に勝ち馬のヒントを隠す。店舗には見せない裏の調整）:
     6 つの演出 CUE_KEYS。それぞれ show＝出す割合（%）・hit＝出たとき本当の勝ち馬を指す割合（%。100 = 確定。外れたときは別の馬を指す）。
     決め方は cuesFor（seed から決まるので、どの決める係・サーバーでも同じ）。テレビに届くのは合言葉のあるテレビだけ（publicRace の out.cues） */
  const CUE_KEYS = ['fruit', 'crowd', 'sign', 'cloud', 'gateLate', 'eye'];
  const DEFAULT_CUES = { fruit: { show: 30, hit: 100 }, crowd: { show: 40, hit: 70 }, sign: { show: 30, hit: 100 }, cloud: { show: 30, hit: 100 }, gateLate: { show: 25, hit: 70 }, eye: { show: 20, hit: 100 } };
  const DEFAULT_TUNING = { payoutRate: 0.85, volatility: 1.0, payoutCap: 0, payoutCapDay: 0, shiftUp: 0.1, shiftDown: 0.1, bandBelow: 0.2, bandAbove: 0.2, exchangeSec: 90, voteSec: 30, betSec: 120, resultSec: 300, gateSec: 8, postSec: 28, photoExtraSec: 6, closeLeadSec: 0, scenes: { paddock: true, gate: true, replay: true, winner: true }, oddsSims: 1500, horizonMin: 15, dayStartHour: 5, horseLook: 'cute', horseLookPrev: 'cute', horseLookAt: 0, cues: DEFAULT_CUES, bountyPerTicket: BOUNTY_DEFAULT };
  const PUBLIC_TUNING_KEYS = ['shiftUp', 'shiftDown', 'exchangeSec', 'voteSec', 'betSec', 'resultSec', 'gateSec', 'postSec', 'photoExtraSec', 'closeLeadSec', 'scenes', 'dayStartHour', 'horizonMin', 'horseLook', 'horseLookPrev', 'horseLookAt', 'bountyPerTicket']; /* bountyPerTicket（交換の割合）は公開してよい。cues（演出の割合）は裏＝入れない */
  const pct = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : d; };
  // 保存されている演出の割合 → 6 つぶんそろえた形（足りない演出は初期値）
  function cuesOf(stored) {
    const src = stored && typeof stored === 'object' ? stored : {}, out = {};
    CUE_KEYS.forEach((k) => { const s = src[k] && typeof src[k] === 'object' ? src[k] : {}, d = DEFAULT_CUES[k]; out[k] = { show: pct(s.show, d.show), hit: pct(s.hit, d.hit) }; });
    return out;
  }
  // 種から決まる乱数（js/engine.js の rng と同じ mulberry32。core.js は Engine を持たないので写し）
  function mulberry(seed) { let a = (seed >>> 0) || 0x9e3779b9; return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /* 演出を決める。winner: 勝ち馬（0〜5）。演出ごとに別の種（salt・レース id・'cues'・演出名）なので、1 つの割合を変えてもほかの演出の出方は変わらない。
     返り値 { fruit: { horse: 2 } | null, crowd, sign, cloud, gateLate, eye }（null = 出さない。horse は 0 始まりの馬の添字） */
  function cuesFor(Outcome, salt, raceId, winner, tuning, n) {
    const C = cuesOf(tuning && tuning.cues), out = {}, N = n || 6, w = Number(winner);
    CUE_KEYS.forEach((k) => {
      const rnd = mulberry(Outcome.hash(salt, raceId, 'cues', k)), c = C[k];
      if (!(rnd() * 100 < c.show) || !(w >= 0 && w < N)) { out[k] = null; return; }
      if (rnd() * 100 < c.hit) { out[k] = { horse: w }; return; }
      const others = []; for (let i = 0; i < N; i++) if (i !== w) others.push(i);
      out[k] = { horse: others[Math.min(others.length - 1, Math.floor(rnd() * others.length))] };
    });
    return out;
  }
  const withoutCues = (result) => { if (!result || result.cues === undefined) return result; const o = Object.assign({}, result); delete o.cues; return o; };
  /* 馬の見た目（全店共通。2026-10-14 オーナー「全店でそろえる」）: 'cute'＝かわいい（標準・js/r3d/horse3d.js）| 'real'＝本物寄り（js/r3d/horse3d-real.js）。
     切り替えはレースの区切りで: 変えた時刻 horseLookAt から HORSE_LOOK_GRACE_MS 後より後に受付が始まる（openAt）レースから新しい見た目、それより前のレースは前の見た目（horseLookPrev）。
     どのテレビも同じ決まりで決めるので全店そろう（受付中・走っている途中のレースは変わらない）。猶予はテレビに設定が届いて本物寄りの馬を読み込むための時間 */
  const HORSE_LOOKS = ['cute', 'real'], HORSE_LOOK_GRACE_MS = 30000;
  function horseLookFor(s, race) {
    s = s || {}; const cur = HORSE_LOOKS.indexOf(s.horseLook) >= 0 ? s.horseLook : 'cute', prev = HORSE_LOOKS.indexOf(s.horseLookPrev) >= 0 ? s.horseLookPrev : 'cute', at = Number(s.horseLookAt) || 0;
    if (!at || !race) return cur;
    const open = Number(race.openAt != null ? race.openAt : race.at) || 0;
    return open >= at + HORSE_LOOK_GRACE_MS ? cur : prev;
  }

  /* ---------- 受付の 2 段（2026-10-16 オーナー決定） ----------
     参加受付（引き換え）: 会計番号・ニックネーム・枚数 → スタッフがリングバウンティと引き換えて認証。exchangeCloseAt まで。
     投票: 認証済みのお客さんが馬を選ぶ。voteCloseAt（＝これまでの closeAt）まで。認証済みなら参加受付の間も投票できる。
     exchangeCloseAt = closeAt − voteSec、openAt（テレビの受付画面の始まり）= exchangeCloseAt − exchangeSec。
     以前の betSec（1 つだけ）は exchangeSec = max(betSec − 30, 10)・voteSec = 30 に読み替える（betSec には合計を写す＝古い画面用） */
  const STAGE_DEFAULT = { exchangeSec: 90, voteSec: 30 };
  const secOf = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
  function stageSecs(src, base) {
    src = src || {}; base = base || STAGE_DEFAULT;
    let ex = secOf(src.exchangeSec), vo = secOf(src.voteSec);
    const bet = secOf(src.betSec);
    if (ex == null && vo == null && bet != null) { ex = Math.max(bet - 30, 10); vo = 30; } /* 以前の betSec だけ */
    return { exchangeSec: ex != null ? ex : base.exchangeSec, voteSec: vo != null ? vo : base.voteSec };
  }
  const hasStage = (s) => !!s && (secOf(s.exchangeSec) != null || secOf(s.voteSec) != null || secOf(s.betSec) != null);
  /* レースの 2 段の時刻（店ごとの上書きつき）。レースの exchangeSec・voteSec は作った時点の全体の値。店の設定があればそちら（betSec と同じく、見せるときに計算）。
     古いレース（exchangeCloseAt なし）は 1 段のまま（参加受付も投票も closeAt まで）。v2/firestore.rules の exchangeCloseMs と同じ決まり */
  function stagesFor(r, ss) {
    if (!r) return null;
    const close = Number(r.closeAt) || 0, xr = r.exchangeCloseAt != null ? Number(r.exchangeCloseAt) : close;
    const base = { exchangeSec: r.exchangeSec != null ? Number(r.exchangeSec) : Math.max(0, (xr - (Number(r.openAt) || xr)) / 1000), voteSec: r.voteSec != null ? Number(r.voteSec) : Math.max(0, (close - xr) / 1000) };
    const sg = hasStage(ss) ? stageSecs(ss, base) : base;
    const voteFixed = !(ss && (secOf(ss.voteSec) != null || (secOf(ss.exchangeSec) == null && secOf(ss.betSec) != null)));
    const x = voteFixed ? xr : close - sg.voteSec * 1000;
    return { exchangeSec: sg.exchangeSec, voteSec: voteFixed ? Math.max(0, (close - xr) / 1000) : sg.voteSec, exchangeCloseAt: x, voteCloseAt: close, openAt: x - sg.exchangeSec * 1000 };
  }
  /* 手動のレース（管理のテスト用 createRace）: exchangeSec・voteSec（または以前の betSec）を渡せる。voteSec を渡さないときは投票の秒数を inSec の半分までにする
     （すぐ締め切る確かめ用のレースでも参加受付が少しはできるように）。betSec だけなら受付の合計の長さ（openAt）はそのまま */
  function manualStages(b, inSec, tuning) {
    b = b || {}; const T = tuningOf(tuning), given = (v) => v != null && v !== '';
    const sg = stageSecs({ exchangeSec: b.exchangeSec, voteSec: b.voteSec, betSec: b.betSec }, T);
    const vo = given(b.voteSec) ? sg.voteSec : Math.min(sg.voteSec, Math.floor(Math.max(0, Number(inSec) || 0) / 2));
    const ex = given(b.exchangeSec) ? sg.exchangeSec : given(b.betSec) ? Math.max(0, Number(b.betSec) - vo) : sg.exchangeSec;
    return { exchangeSec: ex, voteSec: vo, sims: b.sims };
  }
  // いま新しい参加受付（券を作る・認証）ができるか
  const exchangeOpen = (r, ss, t) => { const g = stagesFor(r, ss); return !!g && t < g.exchangeCloseAt; };

  /* ---------- エラー（DerbyCloud と同じ形: err.code / err.status / err.body） ---------- */
  function err(status, code, message, extra) { const e = new Error(message || code); e.status = status; e.code = code; e.body = Object.assign({ error: code, message: message || code }, extra || {}); return e; }

  /* ---------- 日付（日本時間・営業日） ---------- */
  const dateStr = (ms) => new Date(ms + JST).toISOString().slice(0, 10);
  const dayStart = (ds) => { const p = ds.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) - JST; };
  const weekday = (ds) => { const p = ds.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); };
  const hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null; }; // 分は 0〜59（"10:75" を 11:15 として通していた）。時は 24 以上も可（深夜 25:30 など）
  const fmtTime = (ms) => new Date(ms + JST).toISOString().slice(11, 16);
  const compact = (ds) => ds.replace(/-/g, '');
  const bizDate = (ms, h) => dateStr(ms - (h == null ? 5 : h) * 3600000);
  const bizDay = (ms, h) => compact(bizDate(ms, h));
  // 当たり・返還の受け取りの期限: 時刻 ms（発表・返還を作った時刻のうち遅いほう）が入る営業日の終わり（次の区切り h 時）
  const expireAtFor = (ms, h) => { h = h == null ? 5 : h; return dayStart(bizDate(ms, h)) + DAY + h * 3600000; };

  /* ---------- 時刻表 ---------- */
  function ruleTimes(rule) {
    if (Array.isArray(rule.times)) return rule.times.map(hhmm).filter((x) => x != null);
    const from = hhmm(rule.from), to = hhmm(rule.to), ev = Math.max(1, Number(rule.everyMin) || 0);
    if (from == null || to == null || !ev) return [];
    const out = []; for (let m = from; m <= to && out.length < 2000; m += ev) out.push(m);
    return out;
  }
  function ruleSlots(rule) {
    const pay = Math.max(0, Math.floor(Number(rule.payout) || 0)); // 額（1 枚 = 100）
    if (Array.isArray(rule.races)) return rule.races.map((x) => ({ min: hhmm(x.time), payout: x.payout != null ? Math.max(0, Math.floor(Number(x.payout) || 0)) : pay })).filter((x) => x.min != null);
    return ruleTimes(rule).map((min) => ({ min, payout: pay }));
  }
  function ruleMatches(rule, ds) {
    if (rule.enabled === false) return false;
    if (rule.kind === 'date') return rule.date === ds;
    if (rule.kind === 'weekday') return Array.isArray(rule.weekdays) && rule.weekdays.map(Number).includes(weekday(ds));
    return rule.kind === 'daily' || !rule.kind;
  }
  // その日の出走の一覧（全店の決まりと店舗ごとの決まりは別々に判定。優先: 日付 > 曜日 > 毎日）
  function expandDate(ds, rules) {
    const groups = {};
    (rules || []).forEach((r, idx) => { const g = r.storeId || ''; (groups[g] = groups[g] || []).push(Object.assign({ _idx: idx }, r)); });
    const out = {};
    Object.keys(groups).forEach((g) => {
      const rs = groups[g].filter((r) => ruleMatches(r, ds));
      const pri = rs.some((r) => r.kind === 'date') ? 'date' : rs.some((r) => r.kind === 'weekday') ? 'weekday' : 'daily';
      rs.filter((r) => (r.kind || 'daily') === pri).forEach((r) => {
        ruleSlots(r).forEach(({ min, payout }) => {
          const at = dayStart(ds) + min * 60000, h = Math.floor(min / 60), mm = min % 60;
          const id = compact(ds) + '-' + String(h).padStart(2, '0') + String(mm).padStart(2, '0') + (g ? '-' + g : '');
          out[id] = { id, at, time: String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0'), payout, scope: r.scope === 'store' ? 'store' : 'all', storeId: g || null, ruleId: r.id || String(r._idx), tpl: r.tpl || null };
        });
      });
    });
    return Object.values(out).sort((a, b) => a.at - b.at);
  }
  // 昨日〜明日。前の日の「24:30」と次の日の「00:30」は同じ時刻なので 1 つにする（前の日のほうを残す。以前は同じ時刻にレースが 2 つできた。QA 2026-10-14）
  function scheduleAround(t, rules) {
    const all = [].concat(expandDate(dateStr(t - DAY), rules), expandDate(dateStr(t), rules), expandDate(dateStr(t + DAY), rules)), seen = {};
    return all.filter((e) => { const k = (e.storeId || '') + '|' + e.at; if (seen[k]) return false; seen[k] = 1; return true; }).sort((a, b) => a.at - b.at);
  }
  // 管理画面から来た決まりを確かめて整える（server.js の POST /api/admin/timetable と同じ）
  function normalizeRules(input, storeIds, storeName) {
    if (!Array.isArray(input)) throw err(400, 'bad_rules', '時刻表の決まりがありません');
    const rules = input.map((r, i) => {
      const kind = ['daily', 'weekday', 'date'].includes(r.kind) ? r.kind : 'daily';
      if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) throw err(400, 'bad_rule', '日付の形がちがいます（' + (i + 1) + ' 行目）');
      const rule = { id: String(r.id || 'r' + (i + 1)), enabled: r.enabled !== false, kind, payout: roundAmount(r.payout), /* 払い戻しの合計は額（100 単位に丸める） */ scope: r.scope === 'store' ? 'store' : 'all', storeId: r.storeId || null };
      if (kind === 'weekday') rule.weekdays = (r.weekdays || []).map(Number).filter((d) => d >= 0 && d <= 6);
      if (kind === 'date') rule.date = r.date;
      if (r.tpl != null) rule.tpl = String(r.tpl).slice(0, 64);
      if (r.name != null) rule.name = String(r.name).slice(0, 40);
      if (Array.isArray(r.races)) {
        rule.races = r.races.map((x) => ({ time: String(x.time), payout: roundAmount(x.payout != null ? x.payout : r.payout) }));
        if (rule.races.some((x) => hhmm(x.time) == null)) throw err(400, 'bad_rule', '時刻は HH:MM で（' + (i + 1) + ' 行目）');
      } else if (Array.isArray(r.times)) { rule.times = r.times.map(String); if (rule.times.some((x) => hhmm(x) == null)) throw err(400, 'bad_rule', '時刻は HH:MM で（' + (i + 1) + ' 行目）'); }
      else { rule.from = r.from; rule.to = r.to; rule.everyMin = Number(r.everyMin); if (hhmm(r.from) == null || hhmm(r.to) == null || !(rule.everyMin >= 1)) throw err(400, 'bad_rule', '開始・終了・間隔を入れてください（' + (i + 1) + ' 行目）'); }
      if (rule.storeId && storeIds && !storeIds.includes(rule.storeId)) throw err(400, 'bad_rule', '店舗がありません: ' + rule.storeId);
      return rule;
    });
    const seen = {};
    rules.forEach((r) => {
      if (!r.enabled) return;
      const days = r.kind === 'date' ? ['D' + r.date] : r.kind === 'weekday' ? (r.weekdays || []).map((d) => 'W' + d) : ['daily'];
      ruleSlots(r).forEach(({ min }) => days.forEach((d) => {
        const k = (r.storeId || '') + '|' + d + '|' + min;
        if (seen[k] && seen[k] !== r.id) throw err(400, 'duplicate_time', '同じ時刻のレースが 2 つあります（' + String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0') + (r.storeId ? '・' + (storeName ? storeName(r.storeId) : r.storeId) : '') + '・' + (r.name || r.id) + ' と ' + seen[k] + '）');
        seen[k] = r.id;
      }));
    });
    return rules;
  }
  /* 保存されている調整値 → 初期値で埋めた調整値。
     確定オッズのずらし幅は上下別々（shiftUp＝上げてよい幅・shiftDown＝下げてよい幅。2026-10-16）。以前の保存データ（shiftWidth だけ）は両方に使う。
     shiftWidth は古いテレビ（決める係）のために max(shiftUp, shiftDown) を写しておく（読むのは新しい 2 つ） */
  function tuningOf(stored) {
    const src = stored || {}, t = Object.assign(JSON.parse(JSON.stringify(DEFAULT_TUNING)), src);
    if (src.shiftWidth != null) { const w = Math.min(0.5, Math.max(0, Number(src.shiftWidth) || 0)); if (src.shiftUp == null) t.shiftUp = w; if (src.shiftDown == null) t.shiftDown = w; }
    const sg = stageSecs(src, STAGE_DEFAULT); t.exchangeSec = sg.exchangeSec; t.voteSec = sg.voteSec; t.betSec = sg.exchangeSec + sg.voteSec; /* 以前の betSec だけのデータは 2 段に読み替え */
    t.cues = cuesOf(src.cues); /* 演出の割合: 足りない演出は初期値 */
    t.bountyPerTicket = bountyRate(src); /* 交換の割合（ない・おかしい値は 20） */
    return t;
  }
  // 調整値の確かめ（server.js の POST /api/admin/tuning と同じ範囲）
  function mergeTuning(cur, b, now) {
    const t = tuningOf(cur);
    const num = (k, lo, hi) => { if (b[k] == null) return; const v = Number(b[k]); if (!Number.isFinite(v) || v < lo || v > hi) throw err(400, 'bad_tuning', k + ' は ' + lo + '〜' + hi + ' です'); t[k] = v; };
    num('payoutRate', 0.3, 1.2); num('volatility', 0.2, 3); num('payoutCap', 0, 1e11); num('payoutCapDay', 0, 1e12); /* 上限は額 */
    num('shiftWidth', 0, 0.5); if (b.shiftWidth != null) { t.shiftUp = Math.min(0.3, t.shiftWidth); t.shiftDown = Math.min(0.3, t.shiftWidth); } /* 以前の形（±1 つ）で来たら両方に */
    num('shiftUp', 0, 0.3); num('shiftDown', 0, 0.3); t.shiftWidth = Math.max(t.shiftUp, t.shiftDown);
    num('bandBelow', 0, 0.5); num('bandAbove', 0, 0.5);
    num('betSec', 0, 3600); num('exchangeSec', 0, 3600); num('voteSec', 0, 600); num('resultSec', 0, 3600); num('gateSec', 0, 60); num('postSec', 0, 120); num('photoExtraSec', 0, 60); num('closeLeadSec', 0, 600); num('oddsSims', 100, 10000); num('horizonMin', 1, 120); num('dayStartHour', 0, 12);
    if (b.betSec != null && b.exchangeSec == null && b.voteSec == null) { const sg = stageSecs({ betSec: t.betSec }); t.exchangeSec = sg.exchangeSec; t.voteSec = sg.voteSec; } /* 以前の形（締切までの秒数 1 つ）で来たら 2 段に */
    t.betSec = t.exchangeSec + t.voteSec;
    if (b.bountyPerTicket != null) { const raw = b.bountyPerTicket, v = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN; if (!Number.isInteger(v) || v < 1 || v > BOUNTY_MAX) throw err(400, 'bad_tuning', '交換の割合（bountyPerTicket）は 1〜' + BOUNTY_MAX + ' の整数です'); t.bountyPerTicket = v; }
    if (b.scenes && typeof b.scenes === 'object') t.scenes = Object.assign({}, t.scenes, b.scenes);
    if (b.horseLook != null) { // 馬の見た目: 変わったときだけ、前の見た目と変えた時刻を残す（レースの区切りで切り替えるため。horseLookFor）
      if (HORSE_LOOKS.indexOf(b.horseLook) < 0) throw err(400, 'bad_tuning', 'horseLook は cute か real です');
      const old = HORSE_LOOKS.indexOf(t.horseLook) >= 0 ? t.horseLook : 'cute';
      if (b.horseLook !== old) { t.horseLookPrev = horseLookFor(t, { openAt: Number(now) || Date.now() }); t.horseLook = b.horseLook; t.horseLookAt = Number(now) || Date.now(); }
    }
    if (b.cues != null) { /* 演出の割合: 送られた演出・項目だけ変える。0〜100 の数字以外は 400。知らない演出名は無視 */
      if (typeof b.cues !== 'object' || Array.isArray(b.cues)) throw err(400, 'bad_tuning', 'cues は { fruit: { show, hit }, ... } です');
      const next = cuesOf(t.cues);
      CUE_KEYS.forEach((k) => {
        const c = b.cues[k]; if (c == null) return;
        if (typeof c !== 'object') throw err(400, 'bad_tuning', 'cues.' + k + ' は { show, hit } です');
        ['show', 'hit'].forEach((f) => { if (c[f] == null) return; const v = Number(c[f]); if (!Number.isFinite(v) || v < 0 || v > 100) throw err(400, 'bad_tuning', 'cues.' + k + '.' + f + ' は 0〜100 です'); next[k][f] = Math.round(v); });
      });
      t.cues = next;
    }
    return t;
  }
  const publicTuning = (t) => { const o = {}; PUBLIC_TUNING_KEYS.forEach((k) => { if (t[k] !== undefined) o[k] = t[k]; }); return o; };

  /* ---------- 店舗の設定 ---------- */
  function modeNow(s, t) {
    const m = new Date(t + JST), min = m.getUTCHours() * 60 + m.getUTCMinutes();
    for (const x of Array.isArray(s.modes) ? s.modes : []) {
      const a = hhmm(x.from), b = hhmm(x.to); if (a == null || b == null) continue;
      const am = a % 1440, bm = b % 1440;
      if (am <= bm ? min >= am && min < bm : min >= am || min < bm) return x.mode || 'auto';
    }
    return s.modeDefault || 'auto';
  }
  function settingsFor(tuning, storeSettings, t) {
    const T = tuningOf(tuning), s = storeSettings || {};
    const sg = stageSecs(s, T);
    return { exchangeSec: sg.exchangeSec, voteSec: sg.voteSec, betSec: sg.exchangeSec + sg.voteSec, resultSec: s.resultSec != null ? s.resultSec : T.resultSec, gateSec: T.gateSec, postSec: T.postSec, closeLeadSec: T.closeLeadSec,
      scenes: Object.assign({}, T.scenes, s.scenes || {}), sceneSec: Object.assign({ gate: T.gateSec, replay: T.postSec }, s.sceneSec || {}),
      modes: Array.isArray(s.modes) ? s.modes : [], modeDefault: s.modeDefault || 'auto', mode: modeNow(s, t), test: !!s.test, dayStartHour: T.dayStartHour,
      horseLook: T.horseLook || 'cute', horseLookPrev: T.horseLookPrev || 'cute', horseLookAt: Number(T.horseLookAt) || 0, horseLookFrom: (Number(T.horseLookAt) || 0) ? Number(T.horseLookAt) + HORSE_LOOK_GRACE_MS : 0,
      shiftUp: Number(T.shiftUp) || 0, shiftDown: Number(T.shiftDown) || 0, bountyPerTicket: bountyRate(T) }; /* スマホの「オッズは締切で確定します」の表示用（当たりの幅・設定額は出さない） */
  }

  /* ---------- レースを作る ---------- */
  function tuneOf(Engine, t) { return { sigmaMul: Math.round(Engine.TUNE.sigmaMul * Math.max(0.2, Math.min(3, Number(t.volatility) || 1)) * 1000) / 1000, payoutRate: Math.max(0.3, Math.min(1.2, Number(t.payoutRate) || 0.85)) }; }
  const engineRace = (r) => ({ dist: r.dist, weather: r.weather, surface: r.surface, horses: r.horses, tune: r.tune, odds: r.odds });
  function hashOf(Outcome) { return Outcome.hash; }
  // 出走馬（seed から決まる）。オッズは重いので別（oddsFor。テレビは Worker で計算してよい）
  function raceBase(Engine, Outcome, salt, id, tuning) {
    const base = Engine.makeRace(Engine.rng(hashOf(Outcome)(salt, id, 'horses')));
    return Object.assign(base, { tune: tuneOf(Engine, tuning) });
  }
  function oddsFor(Engine, Outcome, salt, id, base, sims) { const o = Engine.calcOdds(base, Engine.rng(hashOf(Outcome)(salt, id, 'odds')), sims || 1500); return { tansho: o.tansho, winProb: o.winProb, tenkai: o.tenkai }; }
  /* entry: { id, at, payout, scope, storeId, ruleId }。返り値 { race（公開してよい部分）, secret（設定額など。マスターと決める係だけ） } */
  function buildRace(Engine, Outcome, entry, tuning, salt, t, opt) {
    opt = opt || {};
    const T = tuningOf(tuning);
    const base = raceBase(Engine, Outcome, salt, entry.id, T);
    const odds = opt.odds || oddsFor(Engine, Outcome, salt, entry.id, base, opt.sims || T.oddsSims);
    const sg = hasStage(opt) ? stageSecs(opt, T) : stageSecs(T), gateSec = T.scenes && T.scenes.gate === false ? 0 : T.gateSec; /* opt.betSec（以前の形）も読む */
    const closeAt = entry.at - T.closeLeadSec * 1000, xAt = closeAt - sg.voteSec * 1000;
    const race = {
      id: entry.id, storeId: entry.storeId || null, at: entry.at, openAt: xAt - sg.exchangeSec * 1000, exchangeCloseAt: xAt, exchangeSec: sg.exchangeSec, voteSec: sg.voteSec, closeAt, runAt: entry.at + gateSec * 1000, revealAt: 0, endAt: 0,
      gateSec, postSec: T.postSec, resultSec: T.resultSec, status: 'upcoming', createdAt: t,
      dist: base.dist, weather: base.weather, surface: base.surface, horses: base.horses, tune: base.tune,
      odds: odds.tansho, tenkai: odds.tenkai, participants: { total: 0, byStore: {}, medals: 0 }, refunded: false, day: bizDate(entry.at, T.dayStartHour),
    };
    if (entry.test) race.test = true; // スタッフの「この店だけテストレース」（2026-10-19）: このレースの券・当たり・返却は全部テスト扱い（集計・1 日の上限に入れない）
    race.revealAt = race.runAt + 60000 + race.postSec * 1000;
    race.endAt = race.revealAt + race.resultSec * 1000;
    const secret = { payoutTarget: entry.payout || 0, scope: entry.scope === 'store' ? 'store' : 'all', ruleId: entry.ruleId || null, winProb: odds.winProb };
    return { race, secret };
  }

  /* ---------- 誰に見せるか ---------- */
  const visibleTo = (race, store) => !race.storeId || race.storeId === store;
  function openRaceFor(races, store, t) { return races.filter((r) => visibleTo(r, store)).sort((a, b) => a.at - b.at).find((r) => r.status === 'upcoming' && r.closeAt > t) || null; }
  /* r: レース。o: { role, store, storeSettings, openId, result（TV・done 後）, winners } */
  function publicRace(r, o) {
    if (!r) return null;
    o = o || {};
    const revealed = r.status === 'done';
    let status = r.status;
    if (status === 'closing') status = 'closed';
    if (status === 'upcoming' && o.openId === r.id) status = 'open';
    const ss = o.storeSettings || {};
    // 結果画面の長さは店ごと（API.md 8 章）: その店の endAt = revealAt + 店の resultSec。以前は全体の resultSec のままで、管理画面で店ごとに変えても効かなかった（コードレビュー 2026-10-14）
    const rs = ss.resultSec != null && ss.resultSec !== '' ? Number(ss.resultSec) : NaN;
    const sg = stagesFor(r, ss); // 参加受付の締切・受付画面の始まり（店ごとの上書きつき）
    const out = {
      id: r.id, storeId: r.storeId || null, at: r.at, openAt: sg.openAt, exchangeCloseAt: sg.exchangeCloseAt, exchangeSec: sg.exchangeSec, voteSec: sg.voteSec, closeAt: r.closeAt, runAt: r.runAt, revealAt: r.revealAt, endAt: r.revealAt && Number.isFinite(rs) && rs >= 0 ? r.revealAt + rs * 1000 : r.endAt, status,
      dist: r.dist, weather: r.weather, surface: r.surface, horses: r.horses, tune: r.tune, odds: r.odds, tenkai: r.tenkai,
      participants: r.participants || { total: 0, byStore: {}, medals: 0 }, result: null, winners: null, refunded: !!r.refunded, refundedAt: r.refundedAt || null,
    };
    if (r.test) out.test = true; // テストのレース（2026-10-19。スタッフの「この店だけテストレース」）
    const result = r.result || o.result || null, priv = o.role === 'tv' || o.role === 'admin'; /* 'tv' は合言葉のあるテレビだけ（server.js の viewRole／Firestore のルール） */
    if (result && (revealed || priv)) { out.result = withoutCues(result); out.photo = !!r.photo; }
    // 確定演出（勝ち馬のヒント）: 合言葉のあるテレビと管理にだけ、結果と一緒に（ゲートインの前に届く）。スマホ・スタッフ・合言葉のないテレビには発表後も出さない
    if (priv) { const cues = r.cues || (r.result && r.result.cues) || (o.result && o.result.cues) || (o.secret && o.secret.decision && o.secret.decision.cues) || null; if (cues) out.cues = cues; }
    // テストモードの店の当たりは、その店（と管理）にだけ見せる（ほかの店のテレビに「テストの当たり」を出さない。QA 2026-10-14）
    if (revealed || o.role === 'admin') out.winners = (r.winners || o.winners || []).filter((w) => !w.test || o.role === 'admin' || !o.store || w.storeId === o.store);
    if (o.role === 'admin' && o.secret) { out.payoutTarget = o.secret.payoutTarget; out.scope = o.secret.scope; out.decision = o.secret.decision || null; out.winProb = o.secret.winProb; }
    return out;
  }
  /* 今の状態（GET /api/state と同じ形）。races は見える範囲のレース（公開部分＋ result があれば）、results は { raceId: result }（TV 用） */
  function stateFor(p) {
    const t = p.t, store = p.store, st = p.stores.find((s) => s.id === store);
    if (!st) throw err(404, 'no_store', '店舗が見つかりません');
    const list = p.races.filter((r) => visibleTo(r, store)).sort((a, b) => a.at - b.at), open = openRaceFor(list, store, t);
    const live = list.filter((r) => (r.status === 'closing' || r.status === 'closed' || r.status === 'decided') && t < r.revealAt).pop() || null;
    const last = list.filter((r) => r.status === 'done').pop() || null;
    const next = open ? list.find((r) => r.status === 'upcoming' && r.at > open.at) || null : null;
    const upcoming = (p.upcoming || list.filter((r) => r.status === 'upcoming').map((r) => ({ id: r.id, at: r.at, time: fmtTime(r.at), storeId: r.storeId || null }))).filter((e) => e.at > t && (!e.storeId || e.storeId === store)).slice(0, 5);
    const ss = st.settings || {}, res = p.results || {};
    const pr = (r) => { const o = publicRace(r, { role: p.role, store, storeSettings: ss, openId: open && open.id, result: r && res[r.id] }); if (o) o.horseLook = horseLookFor(p.tuning, r); return o; }; // 馬の見た目はレースごとに決まる（全店同じ）
    return {
      now: t, day: bizDay(t, (p.tuning || {}).dayStartHour), store: { id: st.id, name: st.name, nextSeq: st.nextSeq || 0, reloadSeq: st.reloadSeq || 0 },
      stores: p.stores.map((s) => ({ id: s.id, name: s.name })), settings: settingsFor(p.tuning, ss, t),
      open: pr(open), live: pr(live), last: pr(last), next: pr(next), upcoming,
    };
  }

  /* ---------- 投票券 ---------- */
  function cleanTicket(b) {
    const bill = String(b.bill == null ? '' : b.bill).trim(), nick = String(b.nick || '').trim(), count = Number(b.count);
    if (!/^[0-9A-Za-z-]{1,12}$/.test(bill)) throw err(400, 'bad_bill', '会計番号を入れてください（英数字 12 文字まで）');
    if (!nick || Array.from(nick).length > 8) throw err(400, 'bad_nick', 'ニックネームは 1〜8 文字です'); // オーナー決定: 言葉の禁止はしない
    if (!Number.isInteger(count) || count < 1 || count > 9999) throw err(400, 'bad_count', '枚数は 1〜9999 です');
    return { bill, nick, count };
  }
  function cleanPicks(b, count) {
    let picks = Array.isArray(b.picks) ? b.picks : (b.horse != null ? [{ horse: b.horse, count }] : []);
    const merged = {};
    picks.forEach((p) => { const h = Number(p.horse), c = Number(p.count); if (!Number.isInteger(h) || h < 0 || h > 5 || !Number.isInteger(c) || c < 0) throw err(400, 'bad_pick', '馬と枚数をえらんでください'); if (c > 0) merged[h] = (merged[h] || 0) + c; });
    picks = Object.keys(merged).map((h) => ({ horse: Number(h), count: merged[h] }));
    const total = picks.reduce((a, p) => a + p.count, 0);
    if (!picks.length || total !== count) throw err(400, 'count_mismatch', '投票券 ' + count + ' 枚をぜんぶ使ってください（いま ' + total + ' 枚）');
    const map = { h0: 0, h1: 0, h2: 0, h3: 0, h4: 0, h5: 0 }; picks.forEach((p) => (map['h' + p.horse] = p.count));
    return { picks, pickMap: map };
  }
  const picksFromMap = (m) => [0, 1, 2, 3, 4, 5].filter((h) => m && m['h' + h] > 0).map((h) => ({ horse: h, count: m['h' + h] }));
  // QR の文字列・id・6 桁の番号
  function parseCode(code, kind) {
    const raw = String(code || '').trim(), m = /^derby:(auth|pay):(.+)$/.exec(raw), id = m ? m[2] : raw;
    if (/^\d{6}$/.test(id)) return { short: id };
    if (m && m[1] !== kind) throw err(400, 'wrong_code', kind === 'auth' ? 'これは受け取り用の QR です' : 'これは認証用の QR です');
    return { id };
  }
  function ticketView(tk, race, payout) {
    const out = { tid: tk.tid, short: tk.short || null, test: !!tk.test, storeId: tk.storeId, bill: tk.bill, nick: tk.nick, count: tk.count, status: tk.status, createdAt: tk.createdAt, authAt: tk.authAt || null, raceId: tk.raceId || null, authRaceId: tk.authRaceId || null, rate: tk.authAt || tk.rate != null ? rateOf(tk) : null, bounty: tk.authAt || tk.rate != null ? ticketBounty(tk) : null, novote: !!tk.novote, picks: tk.picks || picksFromMap(tk.pickMap), votedAt: tk.votedAt || null, result: null };
    if (tk.novote) { /* 投票がなかった認証済みの券（返却）: 締切で作った返却の受け取り。レースの発表を待たずに出す（結果は入れない） */
      const p = payout, live = p && p.status !== 'void';
      out.result = { raceId: tk.raceId || tk.authRaceId || null, winner: null, win: false, refunded: false, novote: true, amount: 0, bounty: live ? payoutBounty(p) : 0, payout: live ? { pid: p.pid, short: p.short || null, kind: 'refund', novote: true, bounty: payoutBounty(p), code: 'derby:pay:' + p.pid, status: p.status, paidAt: p.paidAt || null } : null };
      return out;
    }
    if (race && race.status === 'done' && (race.result || race.refunded)) { // 結果が決まらないまま返還したレース（result なし）も返還の QR を出す（QA 2026-10-14）
      const p = payout, live = p && p.status !== 'void';
      out.result = { raceId: race.id, winner: race.result ? race.result.winner : null, win: !!(live && p.kind !== 'refund'), refunded: !!race.refunded, amount: live && p.kind !== 'refund' ? p.amount : 0, bounty: live ? payoutBounty(p) : 0, payout: live ? { pid: p.pid, short: p.short || null, kind: p.kind || 'win', bounty: payoutBounty(p), code: 'derby:pay:' + p.pid, status: p.status, paidAt: p.paidAt || null } : null };
    }
    return out;
  }
  const payoutView = (p, storeName, revealed) => ({ pid: p.pid, short: p.short || null, test: !!p.test, kind: p.kind || 'win', novote: !!p.novote, code: 'derby:pay:' + p.pid, tid: p.tid, raceId: p.raceId, storeId: p.storeId, storeName: storeName ? storeName(p.storeId) : p.storeId, bill: p.bill, nick: p.nick, horse: p.horse, amount: p.kind === 'refund' ? 0 : p.amount, bounty: payoutBounty(p), count: p.count != null ? p.count : null, rate: p.kind === 'refund' ? rateOf(p) : null, status: p.status, createdAt: p.createdAt, paidAt: p.paidAt || null, paidBy: p.paidBy || null, revealed: !!revealed || !!p.novote });

  /* ---------- 結果の決定 ---------- */
  function effectiveCap(tuning, usedToday) {
    const perRace = Math.max(0, Math.floor(tuning.payoutCap || 0)), perDay = Math.max(0, Math.floor(tuning.payoutCapDay || 0));
    if (!perDay) return perRace;
    const left = Math.max(1, perDay - (usedToday || 0));
    return perRace ? Math.min(perRace, left) : left;
  }
  /* race（公開部分）, secret（payoutTarget, scope, winProb）, tickets（このレースの voted の券）→ 結果・払い戻し（id は呼ぶ側で付ける） */
  function decideRace(Engine, Outcome, race, secret, tickets, tuning, salt, t, usedToday) {
    const T = tuningOf(tuning);
    const voted = tickets.filter((tk) => tk.status === 'voted').sort((a, b) => (a.tid < b.tid ? -1 : 1)); // 順番で結果が変わらないように
    const stakes = [];
    // テストモードの店の票は、本物の票があるときは結果の決定に入れない（テストの大きな賭けで本物のお客さんの結果がゆがまないように。QA 2026-10-14）。
    // テストの票しかないときは入れる（テストだけでも設定額に合わせる動きを確かめられる）
    const isT = (tk) => !!tk.test || !!race.test; // テストのレース（race.test）の券は全部テスト扱い（2026-10-19）
    const real = voted.filter((tk) => !isT(tk)), basis = real.length ? real : voted;
    basis.forEach((tk) => (tk.picks || picksFromMap(tk.pickMap)).forEach((p) => stakes.push({ horse: p.horse, count: p.count, group: tk.storeId })));
    const t0 = Date.now(), cap = effectiveCap(T, usedToday);
    const er = engineRace(race);
    const res = Outcome.resolve(Engine, er, { odds: race.odds, winProb: secret.winProb, stakes, target: secret.payoutTarget, scope: secret.scope, up: T.shiftUp, down: T.shiftDown, bandBelow: T.bandBelow, bandAbove: T.bandAbove, cap, seed: Outcome.hash(salt, race.id, 'decide') });
    const run = Engine.replayRun(er, res.seed, { order: res.order });
    // 確定演出: 勝ち馬が決まったあと、seed（salt・レース id）から決める（どの決める係でも同じ）。result.cues で保存し、テレビへは publicRace が out.cues として合言葉のあるテレビにだけ渡す
    const cues = cuesFor(Outcome, salt, race.id, res.winner, T, (race.horses || []).length || 6);
    const result = { winner: res.winner, order: res.order, finalOdds: res.finalOdds, seed: res.seed, finishTimes: run.finishTimes.map((x) => Math.round(x * 1000) / 1000), winTime: Math.round(run.winTime * 1000) / 1000, natural: res.natural, cues };
    const decision = { target: res.target, scope: res.scope, payout: res.payout, perGroup: res.perGroup, reason: res.reason, band: res.band || null, tries: res.tries, ms: Date.now() - t0, cap, cues, cands: res.cands.map((c) => ({ horse: c.horse, bet: c.bet, odds: c.odds, payout: c.payout, dist: c.dist, inBand: !!c.inBand })) }; /* reason: band（当たりの幅の中から抽選）| target（一番近い馬）| cap_conflict | nobody */
    // 遅れて決めた（決める係・サーバーが止まっていた）: ゲートが開く時刻（runAt）を、決めた時刻 + RUN_LEAD_MS まで後ろへずらす（全店のテレビは
    // レースの runAt にしたがうので、どの店も同じだけずれて、レースを最初から全部流せる）。ずれが LATE_CAP_MS を超えたら、ずらさずすぐ発表。
    // 以前は 5 秒遅れただけで「すぐ発表」になり、全店のテレビがレースの映像をまるごと飛ばしていた（QA3 2026-10-14）
    let runAt = race.runAt, revealAt, photo = false, shift = Math.max(0, t + RUN_LEAD_MS - race.runAt), late = false;
    if (shift > LATE_CAP_MS) { shift = 0; late = true; } else runAt = race.runAt + shift;
    { const ft = run.finishTimes.slice().sort((a, b) => a - b); photo = ft.length > 1 && ft[1] - ft[0] <= 0.05; revealAt = runAt + Math.ceil(run.winTime * 1000) + ((race.postSec != null ? race.postSec : T.postSec) + (photo ? (T.photoExtraSec || 0) : 0)) * 1000; }
    if (late) { revealAt = t; photo = false; }
    const endAt = revealAt + (race.resultSec != null ? race.resultSec : T.resultSec) * 1000;
    const w = res.winner, fo = res.finalOdds[w], payouts = [];
    let paid = 0;
    voted.forEach((tk) => {
      const amount = (tk.picks || picksFromMap(tk.pickMap)).filter((p) => p.horse === w).reduce((a, p) => a + Outcome.stakePayout(p.count, fo), 0);
      if (amount > 0) { payouts.push({ kind: 'win', tid: tk.tid, owner: tk.owner || null, raceId: race.id, storeId: tk.storeId, bill: tk.bill, nick: tk.nick, horse: w, amount, status: 'unpaid', test: isT(tk) }); paid += amount; }
    });
    decision.paid = paid;
    decision.bounty = voted.reduce((a, tk) => a + ticketBounty(tk), 0); // 賭けたリングバウンティ（返還するときの目安。認証したときの割合）
    decision.paidReal = payouts.filter((p) => !p.test).reduce((a, p) => a + p.amount, 0); // 1 日の上限に数える分（テストモードの店の当たりは数えない）
    const participants = { total: voted.length, byStore: {}, medals: 0 };
    voted.forEach((tk) => { participants.byStore[tk.storeId] = (participants.byStore[tk.storeId] || 0) + 1; participants.medals += tk.count; });
    decision.runShift = shift; decision.lateReveal = late;
    return { result, decision, cues, runAt, revealAt, endAt, photo, payouts, participants, runShift: shift, lateReveal: late };
  }
  // 当たった人の一覧（テレビの結果画面。金額の大きい順）
  function winnersFrom(payouts, storeName) {
    return payouts.filter((p) => p.kind !== 'refund' && p.status !== 'void').sort((a, b) => b.amount - a.amount || (a.createdAt || 0) - (b.createdAt || 0)).slice(0, 300)
      .map((p) => Object.assign({ storeId: p.storeId, storeName: storeName ? storeName(p.storeId) : p.storeId, nick: p.nick, amount: p.amount, horse: p.horse }, p.test ? { test: true } : {}));
  }
  // 返還: 取り消す当たり・作る返還（id は呼ぶ側）
  function refundPlan(tickets, payouts, race) {
    const paidBy = {}, voids = [];
    payouts.forEach((p) => { if (p.kind === 'refund') return; if (p.status === 'unpaid') voids.push(p); else if (p.status === 'paid') paidBy[p.tid] = (paidBy[p.tid] || 0) + p.amount; });
    const refunds = [];
    /* 返還はリングバウンティで: 投票した券ごとに、認証したときのリングバウンティ（枚数 × そのときの割合）をそのまま全部返す。
       受け取り済みの当選額は差し引かない・取り戻さない（2026-10-17 オーナー決定「当選額はそのまま」）。paidBy は記録用（decision.paid） */
    tickets.filter((tk) => tk.status === 'voted').forEach((tk) => { const rate = rateOf(tk), back = ticketBounty(tk); if (back > 0) refunds.push({ kind: 'refund', tid: tk.tid, owner: tk.owner || null, raceId: tk.raceId, storeId: tk.storeId, bill: tk.bill, nick: tk.nick, horse: null, amount: 0, bounty: back, count: tk.count, rate, status: 'unpaid', test: !!tk.test || !!(race && race.test) }); });
    return { voids, refunds, paidBy, bounty: refunds.reduce((a, r) => a + r.bounty, 0) };
  }
  /* 返却（2026-10-16 オーナー決定）: このレースに認証されたのに投票締切までに投票しなかった券は無効にして、認証した枚数をそのまま返す。
     返還（kind 'refund'）と同じ受け取り（novote: true）。結果の決定（賭けの枚数）には入れない・参加人数にも数えない（参加は投票した人） */
  function novotePlan(race, tickets) {
    return (tickets || []).filter((tk) => tk.status === 'authorized' && tk.authRaceId === race.id).sort((a, b) => (a.tid < b.tid ? -1 : 1))
      .map((tk) => ({ kind: 'refund', novote: true, tid: tk.tid, owner: tk.owner || null, raceId: race.id, storeId: tk.storeId, bill: tk.bill, nick: tk.nick, horse: null, amount: 0, bounty: ticketBounty(tk), count: tk.count, rate: rateOf(tk), status: 'unpaid', test: !!tk.test || !!race.test })); /* 返却 = 認証したときのリングバウンティ（枚数 × そのときの割合） */
  }

  /* ---------- スタッフの「この店だけテストレース」（2026-10-19） ----------
     スタッフは derbyTestReq/<店舗>（Firestore）か POST /api/staff/testrace（模擬クラウド）で「お願い」を書くだけ。レースを作るのは決める係（進行役のテレビ・サーバー）。
     レース: その店だけ（storeId）・test: true（券・当たり・返却は全部テスト扱い）・startIn 秒後に発走・払い戻しの合計は管理画面の「テストのレースを作る」と同じ既定値。
     作れないとき（busy）: その店に見えるレースの「受付の始まり〜結果画面の終わり」が、テストのレースの「今〜終わり」と重なる（時刻表のまだ作っていない分も） */
  const TEST_RACE = { startIn: 120, minSec: 60, maxSec: 600, payout: 30000, waitSec: 180, staleSec: 600 };
  const testRaceId = (store, reqAtMs) => 'x-' + Math.round(reqAtMs).toString(36) + 'test-' + store; // お願いの時刻から決まる（何度やっても同じレース＝二重に作らない）
  const testStartIn = (v) => Math.max(TEST_RACE.minSec, Math.min(TEST_RACE.maxSec, Math.round(Number(v) || TEST_RACE.startIn)));
  function raceSpan(r, T) {
    const start = r.openAt != null ? r.openAt : r.at - (T.exchangeSec + T.voteSec) * 1000;
    const end = r.endAt || (r.revealAt ? r.revealAt + T.resultSec * 1000 : (r.runAt || r.at) + 60000 + (T.postSec + T.resultSec) * 1000);
    return [start, end];
  }
  function testRaceBusy(races, store, t, startIn, tuning, rules) {
    const T = tuningOf(tuning), sec = testStartIn(startIn);
    const gate = T.scenes && T.scenes.gate === false ? 0 : T.gateSec, end = t + (sec + gate + 60 + T.postSec + T.resultSec) * 1000;
    const hit = (s, e) => s < end && e > t;
    for (const r of races || []) { if (!visibleTo(r, store) || r.status === 'void') continue; const [s, e] = raceSpan(r, T); if (hit(s, e)) return { reason: 'busy', raceId: r.id, at: r.at }; }
    const sg = stageSecs(T), have = new Set((races || []).map((r) => r.id));
    for (const e of scheduleAround(t, rules || [])) {
      if (have.has(e.id) || (e.storeId && e.storeId !== store)) continue;
      const s = e.at - (sg.exchangeSec + sg.voteSec) * 1000, en = e.at + (gate + 60 + T.postSec + T.resultSec) * 1000;
      if (hit(s, en)) return { reason: 'busy', at: e.at };
    }
    return null;
  }

  /* テレビのゲームの切り替え（2026-10-17）: 店の設定 settings.tvGame（'slot' | 'derby'、既定 'slot'）。
     Firestore 版は店舗の保存と同じ書き込みで derbySwitch/tv（誰でも読める 1 件）にも写す。casa SLOT のテレビはこれを見て casa DERBY へ移る */
  const TV_GAMES = ['slot', 'derby'];
  const tvGameOf = (settings) => (settings && settings.tvGame === 'derby' ? 'derby' : 'slot');
  function tvSwitchDoc(stores) { const o = {}; (stores || []).forEach((s) => { if (s && s.id) o[s.id] = tvGameOf(s.settings); }); return o; }
  /* テレビ用アカウントのパスワード（管理画面がブラウザの中だけで作る）: 英数字（見まちがえやすい 0 O o 1 l I は使わない）。
     rand(n) は 0〜255 の数を n 個返す関数（ブラウザは crypto.getRandomValues）。かたよりが出ないよう、256 を割り切れない分は捨てて引き直す */
  const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  function genTvPassword(rand, len) {
    len = len || 20; const lim = 256 - (256 % PW_CHARS.length); let s = '';
    while (s.length < len) { const b = rand(len * 2); for (let i = 0; i < b.length && s.length < len; i++) if (b[i] < lim) s += PW_CHARS[b[i] % PW_CHARS.length]; }
    return s;
  }
  // 決まった id（同じレース・同じ券ならいつも同じ。決める係がやり直しても二重にならない）
  function pidFor(Outcome, salt, raceId, tid, kind) { return 'p' + Outcome.hash(salt, raceId, tid, kind || 'win').toString(36) + Outcome.hash(kind || 'win', tid, raceId, salt).toString(36); }
  function shortFor(Outcome, salt, id, k) { return String(100000 + (Outcome.hash(salt, id, 'short', k || 0) % 900000)); }

  return { TEST_RACE, testRaceId, testStartIn, testRaceBusy, MONEY_PER_TICKET, roundAmount, BOUNTY_DEFAULT, BOUNTY_MAX, rateOf, bountyRate, ticketBounty, payoutBounty, isBountyLog, logBounty, sumBill, statBounty, JST, DAY, RUN_LEAD_MS, LATE_CAP_MS, DEFAULT_TUNING, PUBLIC_TUNING_KEYS, err, dateStr, dayStart, weekday, hhmm, fmtTime, compact, bizDate, bizDay, expireAtFor,
    ruleTimes, ruleSlots, ruleMatches, expandDate, scheduleAround, normalizeRules, tuningOf, mergeTuning, publicTuning, modeNow, settingsFor, HORSE_LOOKS, HORSE_LOOK_GRACE_MS, horseLookFor,
    tuneOf, engineRace, raceBase, oddsFor, buildRace, visibleTo, openRaceFor, publicRace, stateFor,
    cleanTicket, cleanPicks, picksFromMap, parseCode, ticketView, payoutView, effectiveCap, decideRace, winnersFrom, refundPlan, novotePlan, pidFor, shortFor,
    STAGE_DEFAULT, stageSecs, stagesFor, exchangeOpen, manualStages,
    CUE_KEYS, DEFAULT_CUES, cuesOf, cuesFor, withoutCues,
    TV_GAMES, tvGameOf, tvSwitchDoc, PW_CHARS, genTvPassword };
});
