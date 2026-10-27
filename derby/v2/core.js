/* casa DERBY の決まりごと（DOM・通信なし。node とブラウザの両方で動く）: window.DerbyCore
   v2/server.js（模擬クラウド）と同じ計算を、データを引数で受け取る形にしたもの。Firestore 版（v2/client-firestore.js）と
   「結果を決めるテレビ」はこれを使う。
   v4（2026-10-21・仕様書_v4_大改修.md。設計のまとめは v2/V4_CORE_NOTES.md）:
   - 参加無料。1 票 ＝「店＋会計番号（2 桁 01〜99）」ごとに 1 レース 1 票。ニックネームは必ず（8 文字まで）。リングバウンティの交換・認証・返却はなくした。
   - 投票は 2 連単だけ（1 着・2 着を順番どおり。30 通り）。締切までは選び直せる（最後の選択が 1 票）。選び直せるのは最初に投票したスマホだけ。
   - 当選額 ＝ 100pt × 2 連単の倍率 を 100pt 単位に切り上げ（v2/outcome.js の payFor）。受け取りは投票した店で、その営業日のうち（朝 5 時の区切り）。
   - 時刻表の時刻 ＝ レースが走り出す時刻（at）。投票は at の voteSec 秒前（初期 180 秒）から at まで。テストレースは投票 60 秒。
   - 投票が始まった時刻に、そのレースが見える店のテレビのゲームを DERBY にする（tvAutoPlan。レースのあとも DERBY のまま）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DerbyCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const JST = 9 * 3600 * 1000, DAY = 86400000;
  /* お金: 1 票 ＝ 100pt（STAKE）。当選額 ＝ 100pt × 倍率 の 100pt 切り上げ。時刻表の「当選額の目標」・上限も pt（100 単位に丸めて保存） */
  const STAKE = 100, MONEY_PER_TICKET = STAKE; // MONEY_PER_TICKET は以前の名前（同じ 100）
  const roundAmount = (v) => Math.max(0, Math.round((Number(v) || 0) / STAKE) * STAKE); // 管理画面で入れた額は 100 単位に丸める
  /* 会計番号ごとの集計（記録 API の byBill）: win＝当選額・paid＝渡した額・expired＝期限切れ（どれも pt） */
  function sumBill(logs) {
    const by = {};
    (logs || []).forEach((l) => {
      const k = (l.storeId ? l.storeId + ':' : '') + l.bill, x = (by[k] = by[k] || { storeId: l.storeId || null, bill: l.bill, nick: l.nick, votes: 0, win: 0, paid: 0, expired: 0 }), n = Number(l.amount != null ? l.amount : l.count) || 0;
      if (l.type === 'win') x.win += n; else if (l.type === 'paid') x.paid += n; else if (l.type === 'expired') x.expired += n; else if (l.type === 'vote') x.votes++;
      if (l.nick) x.nick = l.nick;
    });
    return by;
  }
  const RUN_LEAD_MS = 2000, LATE_CAP_MS = 60000; // 遅れて決めたとき: ゲートは「決めた 2 秒後」より前に開けない／60 秒より大きく遅れたらすぐ発表
  /* 確定演出（2026-10-16 オーナー決定。v4 でも「1 着の馬だけ教える」のまま）: 6 つの演出 CUE_KEYS。show＝出す割合（%）・hit＝出たとき本当の 1 着を指す割合（%） */
  const CUE_KEYS = ['fruit', 'crowd', 'sign', 'cloud', 'gateLate', 'eye'];
  const DEFAULT_CUES = { fruit: { show: 30, hit: 100 }, crowd: { show: 40, hit: 70 }, sign: { show: 30, hit: 100 }, cloud: { show: 30, hit: 100 }, gateLate: { show: 25, hit: 70 }, eye: { show: 20, hit: 100 } };
  /* 調整の初期値（ver: 4 ＝ v4 の形。ver のない以前の保存データは、投票の秒数の意味が違う＝2 段の 2 段目だったので初期値 180 秒に読み替える） */
  const DEFAULT_TUNING = { ver: 4, payoutRate: 0.85, volatility: 1.0, payoutCap: 0, payoutCapDay: 0, shiftUp: 0.1, shiftDown: 0.1, bandBelow: 0.2, bandAbove: 0.2, voteSec: 180, resultSec: 300, gateSec: 8, postSec: 28, photoExtraSec: 6, closeLeadSec: 0, scenes: { paddock: true, gate: true, replay: true, winner: true }, oddsSims: 1500, horizonMin: 15, dayStartHour: 5, horseLook: 'cute', horseLookPrev: 'cute', horseLookAt: 0, cues: DEFAULT_CUES, maxBillsPerDevice: 4 }; /* maxBillsPerDevice（2026-10-27）: 1 台のスマホが 1 レースでこの数以上の会計番号を使うと、その票は決め方に数えない（0 ＝ 使わない。裏の設定＝public に入れない） */
  const PUBLIC_TUNING_KEYS = ['ver', 'shiftUp', 'shiftDown', 'voteSec', 'resultSec', 'gateSec', 'postSec', 'photoExtraSec', 'closeLeadSec', 'scenes', 'dayStartHour', 'horizonMin', 'horseLook', 'horseLookPrev', 'horseLookAt']; /* cues（演出の割合）・当たりの幅・上限・払い戻し率は裏＝入れない */
  const LEGACY_TUNING_KEYS = ['exchangeSec', 'betSec', 'bountyPerTicket', 'shiftWidth']; // 以前の形の項目（読むときに捨てる）
  const SHIFT_UP_MAX = 10000, SHIFT_DOWN_MAX = 1; // 締切のあとの倍率のずらし幅（2026-10-20「上限なしで管理画面から全部決められる」）: 上げ幅は事実上上限なし・下げ幅は 100% まで（倍率は 1.0 倍より下げない）
  const pct = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : d; };
  function cuesOf(stored) {
    const src = stored && typeof stored === 'object' ? stored : {}, out = {};
    CUE_KEYS.forEach((k) => { const s = src[k] && typeof src[k] === 'object' ? src[k] : {}, d = DEFAULT_CUES[k]; out[k] = { show: pct(s.show, d.show), hit: pct(s.hit, d.hit) }; });
    return out;
  }
  function mulberry(seed) { let a = (seed >>> 0) || 0x9e3779b9; return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /* 演出を決める。winner: 1 着の馬（0〜5）。返り値 { fruit: { horse: 2 } | null, crowd, sign, cloud, gateLate, eye } */
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
  /* 馬の見た目（全店共通。'cute' | 'real'）: 変えた時刻 horseLookAt から HORSE_LOOK_GRACE_MS 後より後に投票が始まる（openAt）レースから新しい見た目 */
  const HORSE_LOOKS = ['cute', 'real'], HORSE_LOOK_GRACE_MS = 30000;
  function horseLookFor(s, race) {
    s = s || {}; const cur = HORSE_LOOKS.indexOf(s.horseLook) >= 0 ? s.horseLook : 'cute', prev = HORSE_LOOKS.indexOf(s.horseLookPrev) >= 0 ? s.horseLookPrev : 'cute', at = Number(s.horseLookAt) || 0;
    if (!at || !race) return cur;
    const open = Number(race.openAt != null ? race.openAt : race.at) || 0;
    return open >= at + HORSE_LOOK_GRACE_MS ? cur : prev;
  }

  /* ---------- 投票の時間（v4: 1 段だけ） ----------
     closeAt（締切）＝ at（発走）− closeLeadSec（初期 0）。openAt（投票の始まり）＝ closeAt − voteSec。全店同じ（店ごとの上書きはしない）。
     テレビの QR はいつも出す。openAt より前に読んだスマホは「次のレースは 21:00、投票は 20:57 から」で待つ */
  const VOTE_SEC_MIN = 10, VOTE_SEC_MAX = 3600;
  const secOf = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
  function voteWindow(r) { if (!r) return null; const close = Number(r.closeAt) || 0, open = r.openAt != null ? Number(r.openAt) : close - (Number(r.voteSec) || 0) * 1000; return { openAt: open, closeAt: close, voteSec: Math.max(0, Math.round((close - open) / 1000)) }; }
  // いま投票できるか（締切前の upcoming で、投票の始まりを過ぎた）
  const votingOpen = (r, t) => !!r && r.status === 'upcoming' && t >= voteWindow(r).openAt && t < Number(r.closeAt);
  /* 手動のレース（管理のテスト用 createRace）: voteSec を渡せる。渡さないときは min(全体の voteSec, inSec)（作ってすぐ投票できる） */
  function manualStages(b, inSec, tuning) {
    b = b || {}; const T = tuningOf(tuning), v = secOf(b.voteSec), i = Math.max(0, Number(inSec) || 0);
    return { voteSec: v != null ? v : Math.min(T.voteSec, i), sims: b.sims };
  }

  /* ---------- エラー（DerbyCloud と同じ形: err.code / err.status / err.body） ---------- */
  function err(status, code, message, extra) { const e = new Error(message || code); e.status = status; e.code = code; e.body = Object.assign({ error: code, message: message || code }, extra || {}); return e; }

  /* ---------- 日付（日本時間・営業日） ---------- */
  const dateStr = (ms) => new Date(ms + JST).toISOString().slice(0, 10);
  const dayStart = (ds) => { const p = ds.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) - JST; };
  const weekday = (ds) => { const p = ds.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); };
  const hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const fmtTime = (ms) => new Date(ms + JST).toISOString().slice(11, 16);
  /* 営業日の時刻（2026-10-26 25 時表記。オーナー「営業が 25 時まである」）: 朝の区切り h 時（dayStartHour。初期 5）より前の時刻は 24 を足す → "25:00"・"28:59"。
     テレビ・スマホ・スタッフ・管理画面の時刻の表示はこれを使う（fmtTime はカレンダーの時刻。id・記録の日付など中の処理用） */
  const fmtBizTime = (ms, h) => { h = h == null ? 5 : Number(h) || 0; const d = new Date(Number(ms) + JST); let hr = d.getUTCHours(); if (hr < h) hr += 24; return String(hr).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
  const compact = (ds) => ds.replace(/-/g, '');
  const bizDate = (ms, h) => dateStr(ms - (h == null ? 5 : h) * 3600000);
  const bizDay = (ms, h) => compact(bizDate(ms, h));
  // 受け取りの期限: 時刻 ms（発表した時刻とレースの時刻の遅いほう）が入る営業日の終わり（次の区切り h 時）
  const expireAtFor = (ms, h) => { h = h == null ? 5 : h; return dayStart(bizDate(ms, h)) + DAY + h * 3600000; };

  /* ---------- 祝日（2026-10-27 オーナー「時刻表に『祝日』の決まり。祝日かどうかは自動で」） ----------
     日本の国民の祝日を計算で求める（表は持たない。2020〜2099 年で正しい。オリンピックの年だけの特別な移動（2019〜2021）は見ない＝今の決まりだけ）。
     固定: 1/1 元日・2/11 建国記念の日・2/23 天皇誕生日・4/29 昭和の日・5/3 憲法記念日・5/4 みどりの日・5/5 こどもの日・8/11 山の日・11/3 文化の日・11/23 勤労感謝の日
     月曜: 成人の日（1 月の第 2）・海の日（7 月の第 3）・敬老の日（9 月の第 3）・スポーツの日（10 月の第 2）。春分の日・秋分の日は近似式（1980〜2099 年で正しい）。
     振替休日: 祝日が日曜なら、そのあと最初の祝日でない日（5/3 が日曜なら 5/6）。国民の休日: 前の日も次の日も祝日で、日曜でも祝日でもない日（9 月の敬老の日と秋分の日の間。2026-09-22）。
     ds は 'YYYY-MM-DD'（日本時間のカレンダーの日付。営業日ではない）。形がちがえば null。
     v2/next-open.js（Core なしで動く casa SLOT のテレビ用）にも同じものを置いてある。直すときは両方を同じに（tests/v4-holiday.test.js が 2025〜2030 の毎日と中身の文字列を比べる） */
  /* 祝日の計算ここから（v2/core.js と v2/next-open.js で同じ文字列） */
  const HOLIDAY_FIXED = { '01-01': '元日', '02-11': '建国記念の日', '02-23': '天皇誕生日', '04-29': '昭和の日', '05-03': '憲法記念日', '05-04': 'みどりの日', '05-05': 'こどもの日', '08-11': '山の日', '11-03': '文化の日', '11-23': '勤労感謝の日' };
  const HOLIDAY_MONDAY = [[1, 2, '成人の日'], [7, 3, '海の日'], [9, 3, '敬老の日'], [10, 2, 'スポーツの日']]; // [月, 第 n 月曜, 名前]
  const ymd = (ds) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ds == null ? '' : ds)); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
  const shiftDs = (ds, n) => { const p = ymd(ds); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }; // n 日あと（負なら前）
  const dowOf = (p) => new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); // 0 ＝ 日曜
  const nthMonday = (y, mo, n) => 1 + ((8 - dowOf([y, mo, 1])) % 7) + (n - 1) * 7; // その月の第 n 月曜の日
  const equinox = (y, base) => Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)); // 春分 base 20.8431・秋分 base 23.2488
  // 法で日が決まっている祝日（振替休日・国民の休日は含まない）の名前。祝日でなければ null
  function baseHoliday(ds) {
    const p = ymd(ds); if (!p) return null;
    const y = p[0], mo = p[1], d = p[2], fixed = HOLIDAY_FIXED[ds.slice(5)];
    if (fixed) return fixed;
    for (let i = 0; i < HOLIDAY_MONDAY.length; i++) { const h = HOLIDAY_MONDAY[i]; if (mo === h[0] && d === nthMonday(y, h[0], h[1])) return h[2]; }
    if (mo === 3 && d === equinox(y, 20.8431)) return '春分の日';
    if (mo === 9 && d === equinox(y, 23.2488)) return '秋分の日';
    return null;
  }
  // 祝日の名前（振替休日・国民の休日も）。祝日でなければ null
  function holidayName(ds) {
    const p = ymd(ds); if (!p) return null;
    const base = baseHoliday(ds); if (base) return base;
    for (let b = shiftDs(ds, -1); baseHoliday(b); b = shiftDs(b, -1)) if (dowOf(ymd(b)) === 0) return '振替休日'; // 前へ祝日が続く限りさかのぼり、日曜の祝日に届けば振替休日
    if (dowOf(p) !== 0 && baseHoliday(shiftDs(ds, -1)) && baseHoliday(shiftDs(ds, 1))) return '国民の休日';
    return null;
  }
  const isHoliday = (ds) => holidayName(ds) != null;
  /* 祝日の計算ここまで */
  // その日の種類（管理画面の予定の見出し「祝日（スポーツの日）」用）: { holiday: 名前 | null, weekday: 0（日）〜6（土） }
  const dayKind = (ds) => ({ holiday: holidayName(ds), weekday: weekday(ds) });

  /* ---------- 時刻表（時刻 ＝ レースが走り出す時刻。全店同じ） ----------
     決まりの種類 kind: 'daily'（毎日）・'weekday'（曜日）・'holiday'（祝日。2026-10-27）・'date'（日付）。
     同じ日に重なるときは店ごとのまとまりの中で 日付 > 祝日 > 曜日 > 毎日 の順に強い（月曜が祝日なら祝日の決まり。オーナー決定） */
  const RULE_KINDS = ['daily', 'weekday', 'holiday', 'date'], RULE_PRIORITY = ['date', 'holiday', 'weekday'];
  function ruleTimes(rule) {
    if (Array.isArray(rule.times)) return rule.times.map(hhmm).filter((x) => x != null);
    const from = hhmm(rule.from), to = hhmm(rule.to), ev = Math.max(1, Number(rule.everyMin) || 0);
    if (from == null || to == null || !ev) return [];
    const out = []; for (let m = from; m <= to && out.length < 2000; m += ev) out.push(m);
    return out;
  }
  function ruleSlots(rule) {
    const pay = Math.max(0, Math.floor(Number(rule.payout) || 0));
    if (Array.isArray(rule.races)) return rule.races.map((x) => ({ min: hhmm(x.time), payout: x.payout != null ? Math.max(0, Math.floor(Number(x.payout) || 0)) : pay })).filter((x) => x.min != null);
    return ruleTimes(rule).map((min) => ({ min, payout: pay }));
  }
  function ruleMatches(rule, ds) {
    if (rule.enabled === false) return false;
    if (rule.kind === 'date') return rule.date === ds;
    if (rule.kind === 'weekday') return Array.isArray(rule.weekdays) && rule.weekdays.map(Number).includes(weekday(ds));
    if (rule.kind === 'holiday') return isHoliday(ds);
    return rule.kind === 'daily' || !rule.kind;
  }
  function expandDate(ds, rules) {
    const groups = {};
    (rules || []).forEach((r, idx) => { const g = r.storeId || ''; (groups[g] = groups[g] || []).push(Object.assign({ _idx: idx }, r)); });
    const out = {};
    Object.keys(groups).forEach((g) => {
      const rs = groups[g].filter((r) => ruleMatches(r, ds));
      const pri = RULE_PRIORITY.find((k) => rs.some((r) => r.kind === k)) || 'daily'; // 日付 > 祝日 > 曜日 > 毎日
      rs.filter((r) => (r.kind || 'daily') === pri).forEach((r) => {
        ruleSlots(r).forEach(({ min, payout }) => {
          const at = dayStart(ds) + min * 60000, h = Math.floor(min / 60), mm = min % 60;
          const id = compact(ds) + '-' + String(h).padStart(2, '0') + String(mm).padStart(2, '0') + (g ? '-' + g : '');
          out[id] = { id, at, time: String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0'), payout, scope: r.scope === 'store' ? 'store' : 'all', storeId: g || null, storeIds: storeIdsOf(r.storeIds), ruleId: r.id || String(r._idx), tpl: r.tpl || null };
        });
      });
    });
    return Object.values(out).sort((a, b) => a.at - b.at);
  }
  function scheduleAround(t, rules) {
    const all = [].concat(expandDate(dateStr(t - DAY), rules), expandDate(dateStr(t), rules), expandDate(dateStr(t + DAY), rules)), seen = {};
    return all.filter((e) => { const k = (e.storeId || '') + '|' + e.at; if (seen[k]) return false; seen[k] = 1; return true; }).sort((a, b) => a.at - b.at);
  }
  /* 投票できる店（2026-10-26 オーナー「レースごとに投票できる店をチェックで選べる」）: rule.storeIds・race.storeIds。null ＝ 全店。
     選ばれていない店はテレビで「見るだけ」（visibleTo は true・canVote は false）。storeIdsOf: 形をそろえる（空・配列でない → null。重複は 1 つに） */
  function storeIdsOf(v) { if (!Array.isArray(v)) return null; const out = []; v.forEach((x) => { const s = String(x == null ? '' : x).trim(); if (s && !out.includes(s)) out.push(s); }); return out.length ? out : null; }
  // 管理画面から来た storeIds の確かめ: 無い・null ＝ 全店。あるなら店を 1 つ以上・知っている店だけ。全店をえらんだら null（全店）に
  function cleanStoreIds(v, known, where) {
    if (v == null) return null;
    if (!Array.isArray(v)) throw err(400, 'bad_rule', '店の選び方の形がちがいます' + (where || ''));
    const ids = storeIdsOf(v);
    if (!ids) throw err(400, 'bad_rule', '店を 1 つは選んでください' + (where || ''));
    if (Array.isArray(known)) { const bad = ids.find((s) => !known.includes(s)); if (bad) throw err(400, 'bad_rule', '店舗がありません: ' + bad); if (known.every((s) => ids.includes(s))) return null; }
    return ids;
  }
  /* 時刻表の時刻の範囲（2026-10-26 25 時表記）: 朝の区切り h 時（dayStartHour。初期 5）から 24 時間 ＝ "05:00"〜"28:59"（深夜は 24:00〜28:59 と書く。00:00〜04:59 は受け付けない） */
  const bizMinOk = (min, h) => min >= h * 60 && min < (24 + h) * 60;
  const bizRangeText = (h) => String(h).padStart(2, '0') + ':00〜' + String(23 + h).padStart(2, '0') + ':59';
  /* storeIds: 知っている店の id の一覧（決まりの storeId・storeIds の確かめ）。storeName: 店名（重なりのエラー文）。dayStartHour: 時刻の範囲の確かめ（初期 5）。
     決まりに storeId（その店だけ別のレース。以前からの形）があるときは storeIds は見ない（その店だけのレースなので） */
  function normalizeRules(input, storeIds, storeName, dayStartHour) {
    if (!Array.isArray(input)) throw err(400, 'bad_rules', '時刻表の決まりがありません');
    const h = dayStartHour == null ? 5 : Math.max(0, Math.min(12, Number(dayStartHour) || 0));
    const rules = input.map((r, i) => {
      const kind = RULE_KINDS.includes(r.kind) ? r.kind : 'daily'; // 'holiday'（祝日）は曜日も日付もいらない
      if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) throw err(400, 'bad_rule', '日付の形がちがいます（' + (i + 1) + ' 行目）');
      const rule = { id: String(r.id || 'r' + (i + 1)), enabled: r.enabled !== false, kind, payout: roundAmount(r.payout), scope: r.scope === 'store' ? 'store' : 'all', storeId: r.storeId || null, storeIds: null };
      if (!rule.storeId) rule.storeIds = cleanStoreIds(r.storeIds, Array.isArray(storeIds) ? storeIds : null, '（' + (i + 1) + ' 行目）');
      if (kind === 'weekday') rule.weekdays = (r.weekdays || []).map(Number).filter((d) => d >= 0 && d <= 6);
      if (kind === 'date') rule.date = r.date;
      if (r.tpl != null) rule.tpl = String(r.tpl).slice(0, 64);
      if (r.name != null) rule.name = String(r.name).slice(0, 40);
      if (Array.isArray(r.races)) {
        rule.races = r.races.map((x) => ({ time: String(x.time), payout: roundAmount(x.payout != null ? x.payout : r.payout) }));
        if (rule.races.some((x) => hhmm(x.time) == null)) throw err(400, 'bad_rule', '時刻は HH:MM で（' + (i + 1) + ' 行目）');
      } else if (Array.isArray(r.times)) { rule.times = r.times.map(String); if (rule.times.some((x) => hhmm(x) == null)) throw err(400, 'bad_rule', '時刻は HH:MM で（' + (i + 1) + ' 行目）'); }
      else { rule.from = r.from; rule.to = r.to; rule.everyMin = Number(r.everyMin); if (hhmm(r.from) == null || hhmm(r.to) == null || !(rule.everyMin >= 1)) throw err(400, 'bad_rule', '開始・終了・間隔を入れてください（' + (i + 1) + ' 行目）'); }
      // 時刻の範囲（25 時表記）: 時刻の一覧・開始・終了のどれも h:00〜(23+h):59 の中
      const mins = ruleSlots(rule).map((x) => x.min).concat(rule.from != null ? [hhmm(rule.from), hhmm(rule.to)] : []);
      if (mins.some((m) => m != null && !bizMinOk(m, h))) throw err(400, 'bad_rule', '時刻は ' + bizRangeText(h) + ' で（深夜は 24:00〜' + String(23 + h).padStart(2, '0') + ':59。' + (i + 1) + ' 行目）');
      if (rule.storeId && storeIds && !storeIds.includes(rule.storeId)) throw err(400, 'bad_rule', '店舗がありません: ' + rule.storeId);
      return rule;
    });
    const seen = {};
    rules.forEach((r) => {
      if (!r.enabled) return;
      const days = r.kind === 'date' ? ['D' + r.date] : r.kind === 'weekday' ? (r.weekdays || []).map((d) => 'W' + d) : r.kind === 'holiday' ? ['H'] : ['daily']; // 祝日の決まり同士の同じ時刻だけ重なりと見る（毎日・曜日との重なりは祝日が勝つので可）
      ruleSlots(r).forEach(({ min }) => days.forEach((d) => {
        const k = (r.storeId || '') + '|' + d + '|' + min;
        if (seen[k] && seen[k] !== r.id) throw err(400, 'duplicate_time', '同じ時刻のレースが 2 つあります（' + String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0') + (r.storeId ? '・' + (storeName ? storeName(r.storeId) : r.storeId) : '') + '・' + (r.name || r.id) + ' と ' + seen[k] + '）');
        seen[k] = r.id;
      }));
    });
    return rules;
  }
  /* 時刻表の間隔の目安（管理画面の確かめ用）: 投票＋ゲートイン＋走り（約 60 秒）＋リプレイ（postSec）。これより短い間隔だと前のレースの結果発表と次の投票が重なる */
  /* 公開の時刻表（Firestore derbySchedule/public・模擬クラウド GET /api/schedule）: 時刻と秒数だけ。目標額 payout・名前・型の印は入れない。
     casa SLOT のテレビが v2/next-open.js（DerbyNextOpen.next）で投票の始まりを求めて DERBY へ移るために読む（ログインなしで読める）。
     管理画面で時刻表・調整（投票の秒数など）を保存したときに書き直す */
  function publicRules(rules) {
    return (Array.isArray(rules) ? rules : []).map((r) => {
      const o = { id: String(r.id || ''), enabled: r.enabled !== false, kind: RULE_KINDS.includes(r.kind) ? r.kind : 'daily', storeId: r.storeId || null, storeIds: storeIdsOf(r.storeIds) }; /* kind 'holiday'（祝日）もそのまま（casa SLOT のテレビは next-open.js で祝日を同じ計算で判定） */ /* storeIds: 投票できる店（null ＝ 全店。2026-10-26）。casa SLOT のテレビは見ない（見るだけの店もレースの時刻に DERBY へ移る） */
      if (o.kind === 'weekday') o.weekdays = (r.weekdays || []).map(Number);
      if (o.kind === 'date') o.date = String(r.date || '');
      if (Array.isArray(r.races)) o.races = r.races.map((x) => ({ time: String((x && x.time) || '') }));
      else if (Array.isArray(r.times)) o.times = r.times.map(String);
      else { o.from = String(r.from || ''); o.to = String(r.to || ''); o.everyMin = Number(r.everyMin) || 0; }
      return o;
    });
  }
  /* 投票の秒数（voteSec）を変えたとき、もう作ってあるがまだ投票が始まっていない時刻表のレースも新しい秒数に合わせる（2026-10-21）。
     そうしないと、作ってある 15 分先までのレースは前の秒数のまま＝公開の時刻表（casa SLOT のテレビが読む）と投票の始まりがずれる。
     手動・テストのレース（id が x- / t-）・投票が 5 秒以内に始まるもの・新しい始まりが 5 秒以内になるものは変えない。返り値 [{ id, openAt, voteSec }] */
  function revoteRaces(races, tuning, t) {
    const T = tuningOf(tuning), out = [];
    (races || []).forEach((r) => {
      if (!r || r.status !== 'upcoming' || r.test || /^[xt]-/.test(r.id) || !(r.closeAt > 0)) return;
      const cur = voteWindow(r), openAt = r.closeAt - T.voteSec * 1000;
      if (cur.voteSec === T.voteSec || cur.openAt <= t + 5000 || openAt <= t + 5000) return;
      out.push({ id: r.id, openAt, voteSec: T.voteSec });
    });
    return out;
  }
  function publicSchedule(rules, tuning, t) { const T = tuningOf(tuning); return { rules: publicRules(rules), voteSec: T.voteSec, closeLeadSec: T.closeLeadSec, dayStartHour: T.dayStartHour, updatedAt: Number(t) || 0 }; }
  function minGapSec(tuning) { const T = tuningOf(tuning), gate = T.scenes && T.scenes.gate === false ? 0 : T.gateSec; return T.voteSec + gate + 60 + T.postSec + 2 * T.photoExtraSec; }

  /* 保存されている調整値 → 初期値で埋めた調整値。以前の形の項目（交換の割合・参加受付の秒数など）は捨てる。
     ver のない以前のデータの voteSec（2 段の 2 段目＝30 秒など）は v4 の初期値 180 秒に読み替える。以前の shiftWidth（±1 つ）は上げ・下げの両方に */
  function tuningOf(stored) {
    const src = stored || {}, t = Object.assign(JSON.parse(JSON.stringify(DEFAULT_TUNING)), src);
    if (src.shiftWidth != null) { const w = Math.min(0.5, Math.max(0, Number(src.shiftWidth) || 0)); if (src.shiftUp == null) t.shiftUp = w; if (src.shiftDown == null) t.shiftDown = w; }
    if (src.ver !== 4) t.voteSec = DEFAULT_TUNING.voteSec;
    t.ver = 4;
    LEGACY_TUNING_KEYS.forEach((k) => { delete t[k]; });
    t.cues = cuesOf(src.cues);
    return t;
  }
  // 調整値の確かめ（管理画面の保存。範囲の外は 400 bad_tuning。以前の画面が送る交換の割合などは黙って捨てる）
  function mergeTuning(cur, b, now) {
    const t = tuningOf(cur);
    b = b || {};
    const num = (k, lo, hi) => { if (b[k] == null || b[k] === '') return; const v = Number(b[k]); if (!Number.isFinite(v) || v < lo || v > hi) throw err(400, 'bad_tuning', k + ' は ' + lo + '〜' + hi + ' です'); t[k] = v; };
    num('payoutRate', 0.3, 1.2); num('volatility', 0.2, 3); num('payoutCap', 0, 1e11); num('payoutCapDay', 0, 1e12);
    if (b.shiftWidth != null && b.shiftUp == null && b.shiftDown == null) { const w = Number(b.shiftWidth); if (!Number.isFinite(w) || w < 0 || w > SHIFT_DOWN_MAX) throw err(400, 'bad_tuning', 'shiftWidth は 0〜' + SHIFT_DOWN_MAX + ' です'); t.shiftUp = w; t.shiftDown = w; }
    num('shiftUp', 0, SHIFT_UP_MAX); num('shiftDown', 0, SHIFT_DOWN_MAX);
    num('bandBelow', 0, 0.5); num('bandAbove', 0, 0.5);
    num('maxBillsPerDevice', 0, 99); if (b.maxBillsPerDevice != null && b.maxBillsPerDevice !== '' && (Number(b.maxBillsPerDevice) === 1 || !Number.isInteger(Number(b.maxBillsPerDevice)))) throw err(400, 'bad_tuning', 'maxBillsPerDevice は 0（使わない）か 2〜99 です'); // 1 台の番号の上限（2026-10-27）
    num('voteSec', VOTE_SEC_MIN, VOTE_SEC_MAX); num('resultSec', 0, 3600); num('gateSec', 0, 60); num('postSec', 0, 120); num('photoExtraSec', 0, 60); num('closeLeadSec', 0, 600); num('oddsSims', 100, 10000); num('horizonMin', 1, 120); num('dayStartHour', 0, 12);
    if (b.scenes && typeof b.scenes === 'object') t.scenes = Object.assign({}, t.scenes, b.scenes);
    if (b.horseLook != null) {
      if (HORSE_LOOKS.indexOf(b.horseLook) < 0) throw err(400, 'bad_tuning', 'horseLook は cute か real です');
      const old = HORSE_LOOKS.indexOf(t.horseLook) >= 0 ? t.horseLook : 'cute';
      if (b.horseLook !== old) { t.horseLookPrev = horseLookFor(t, { openAt: Number(now) || Date.now() }); t.horseLook = b.horseLook; t.horseLookAt = Number(now) || Date.now(); }
    }
    if (b.cues != null) {
      if (typeof b.cues !== 'object' || Array.isArray(b.cues)) throw err(400, 'bad_tuning', 'cues は { fruit: { show, hit }, ... } です');
      const next = cuesOf(t.cues);
      CUE_KEYS.forEach((k) => {
        const c = b.cues[k]; if (c == null) return;
        if (typeof c !== 'object') throw err(400, 'bad_tuning', 'cues.' + k + ' は { show, hit } です');
        ['show', 'hit'].forEach((f) => { if (c[f] == null) return; const v = Number(c[f]); if (!Number.isFinite(v) || v < 0 || v > 100) throw err(400, 'bad_tuning', 'cues.' + k + '.' + f + ' は 0〜100 です'); next[k][f] = Math.round(v); });
      });
      t.cues = next;
    }
    t.ver = 4;
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
  // テレビ・スマホ・スタッフに配る設定（/api/state の settings）。当たりの幅・上限・払い戻し率・演出の割合は入れない
  function settingsFor(tuning, storeSettings, t) {
    const T = tuningOf(tuning), s = storeSettings || {};
    return { voteSec: T.voteSec, testVoteSec: TEST_RACE.voteSec, stake: STAKE, resultSec: s.resultSec != null ? s.resultSec : T.resultSec, gateSec: T.gateSec, postSec: T.postSec, photoExtraSec: T.photoExtraSec, closeLeadSec: T.closeLeadSec,
      scenes: Object.assign({}, T.scenes, s.scenes || {}), sceneSec: Object.assign({ gate: T.gateSec, replay: T.postSec }, s.sceneSec || {}),
      modes: Array.isArray(s.modes) ? s.modes : [], modeDefault: s.modeDefault || 'auto', mode: modeNow(s, t), test: !!s.test, dayStartHour: T.dayStartHour,
      horseLook: T.horseLook || 'cute', horseLookPrev: T.horseLookPrev || 'cute', horseLookAt: Number(T.horseLookAt) || 0, horseLookFrom: (Number(T.horseLookAt) || 0) ? Number(T.horseLookAt) + HORSE_LOOK_GRACE_MS : 0,
      shiftUp: Number(T.shiftUp) || 0, shiftDown: Number(T.shiftDown) || 0, tvQuality: tvQualityOf(s), tvGame: tvGameOf(s) };
  }

  /* ---------- レースを作る ---------- */
  function tuneOf(Engine, t) { return { sigmaMul: Math.round(Engine.TUNE.sigmaMul * Math.max(0.2, Math.min(3, Number(t.volatility) || 1)) * 1000) / 1000, payoutRate: Math.max(0.3, Math.min(1.2, Number(t.payoutRate) || 0.85)) }; }
  const engineRace = (r) => ({ dist: r.dist, weather: r.weather, surface: r.surface, horses: r.horses, tune: r.tune, odds: r.odds, exacta: r.exacta });
  function raceBase(Engine, Outcome, salt, id, tuning) {
    const base = Engine.makeRace(Engine.rng(Outcome.hash(salt, id, 'horses')));
    return Object.assign(base, { tune: tuneOf(Engine, tuning) });
  }
  /* 倍率（重い。テレビは Worker で計算してよい＝v2/client.js の oddsWorker も同じ形を返す）: { tansho（参考の単勝）, winProb, tenkai, exacta（2 連単 30 通り）, exactaProb } */
  function oddsFor(Engine, Outcome, salt, id, base, sims) { const o = Engine.calcOdds(base, Engine.rng(Outcome.hash(salt, id, 'odds')), sims || 1500); return { tansho: o.tansho, winProb: o.winProb, tenkai: o.tenkai, exacta: o.exacta, exactaProb: o.exactaProb }; }
  /* entry: { id, at, payout, scope, storeId, ruleId, test? }。opt: { odds?, sims?, voteSec? }。返り値 { race（公開してよい部分）, secret（目標額など。マスターと決める係だけ） } */
  function buildRace(Engine, Outcome, entry, tuning, salt, t, opt) {
    opt = opt || {};
    const T = tuningOf(tuning);
    const base = raceBase(Engine, Outcome, salt, entry.id, T);
    const odds = opt.odds && opt.odds.exacta ? opt.odds : oddsFor(Engine, Outcome, salt, entry.id, base, opt.sims || T.oddsSims);
    const vs = secOf(opt.voteSec) != null ? secOf(opt.voteSec) : T.voteSec, gateSec = T.scenes && T.scenes.gate === false ? 0 : T.gateSec;
    const closeAt = entry.at - T.closeLeadSec * 1000;
    const race = {
      id: entry.id, storeId: entry.storeId || null, storeIds: storeIdsOf(entry.storeIds), at: entry.at, openAt: closeAt - vs * 1000, voteSec: vs, closeAt, runAt: entry.at + gateSec * 1000, revealAt: 0, endAt: 0, /* storeIds: 投票できる店（null ＝ 全店。2026-10-26） */
      gateSec, postSec: T.postSec, resultSec: T.resultSec, status: 'upcoming', createdAt: t,
      dist: base.dist, weather: base.weather, surface: base.surface, horses: base.horses, tune: base.tune,
      odds: odds.tansho, exacta: odds.exacta, tenkai: odds.tenkai, participants: { total: 0, byStore: {}, combos: {} }, refunded: false, day: bizDate(entry.at, T.dayStartHour),
    };
    if (entry.test) race.test = true; // テストレース（スタッフの「この店だけテストレース」）: 当たりは払わない・集計に入れない
    race.revealAt = race.runAt + 60000 + race.postSec * 1000;
    race.endAt = race.revealAt + race.resultSec * 1000;
    const secret = { payoutTarget: entry.payout || 0, scope: entry.scope === 'store' ? 'store' : 'all', ruleId: entry.ruleId || null, winProb: odds.winProb, comboProb: odds.exactaProb };
    return { race, secret };
  }

  /* ---------- 誰に見せるか ---------- */
  const visibleTo = (race, store) => !race.storeId || race.storeId === store;
  /* その店が投票できるレースか（2026-10-26「このレースはこの店だけ」）: 見えていて、storeIds が無い（全店）か その店が入っている。
     見えるが投票できないレース（canVote が false）はテレビで「見るだけ」（stateFor の watch）。スマホは次に投票できるレースを出す */
  const canVote = (race, store) => visibleTo(race, store) && (!Array.isArray(race.storeIds) || !race.storeIds.length || race.storeIds.includes(store));
  // 投票できない店からの投票・番号を空ける → 409 not_my_store「このレースは 渋谷・上野 だけの開催です」（模擬クラウドと Firestore 版で同じ文）。storeName: 店の id → 名前
  function notMyStore(race, storeName) { const ids = storeIdsOf(race && race.storeIds) || []; return err(409, 'not_my_store', 'このレースは ' + ids.map((s) => (storeName ? storeName(s) : s) || s).join('・') + ' だけの開催です', { raceId: race && race.id, storeIds: ids }); }
  // いまのレース: その店が投票できる、締切前の upcoming のうち一番早いもの（投票の前で待っているときも。見るだけのレースは入らない）
  function currentRaceFor(races, store, t) { return races.filter((r) => canVote(r, store)).sort((a, b) => a.at - b.at).find((r) => r.status === 'upcoming' && r.closeAt > t) || null; }
  // いま投票できるレース（いまのレースが投票の時間に入っていれば）
  function openRaceFor(races, store, t) { const r = currentRaceFor(races, store, t); return r && t >= voteWindow(r).openAt ? r : null; }
  /* 2 連単の人気の上位（テレビの「人気の組み合わせ上位 6」・レース中の右側）: 実際の票が多い順。票が 0・同じ数のときは倍率の低い順で補う。
     odds は使う倍率（締切前は race.exacta、レース中は result.finalExacta）。返り値 [{ combo, first, second, odds, votes }]（テレビには順番と倍率だけ出す） */
  function popularCombos(race, n, odds) {
    if (!race) return [];
    const ex = odds || (race.result && race.result.finalExacta) || race.exacta || {}, cnt = (race.participants && race.participants.combos) || {};
    return Object.keys(ex).map((k) => { const m = /^(\d+)-(\d+)$/.exec(k); return { combo: k, first: Number(m[1]), second: Number(m[2]), odds: Number(ex[k]), votes: Number(cnt[k]) || 0 }; })
      .sort((a, b) => b.votes - a.votes || a.odds - b.odds || (a.combo < b.combo ? -1 : 1)).slice(0, n || 6);
  }
  /* r: レース。o: { role, store, storeSettings, openId, result（TV・done 後）, winners, secret（管理） } */
  function publicRace(r, o) {
    if (!r) return null;
    o = o || {};
    const revealed = r.status === 'done';
    let status = r.status;
    if (status === 'closing') status = 'closed';
    if (status === 'upcoming' && o.openId === r.id) status = 'open';
    const ss = o.storeSettings || {};
    const rs = ss.resultSec != null && ss.resultSec !== '' ? Number(ss.resultSec) : NaN;
    const vw = voteWindow(r);
    const out = {
      id: r.id, storeId: r.storeId || null, storeIds: storeIdsOf(r.storeIds), at: r.at, openAt: vw.openAt, voteSec: vw.voteSec, closeAt: r.closeAt, runAt: r.runAt, revealAt: r.revealAt, endAt: r.revealAt && Number.isFinite(rs) && rs >= 0 ? r.revealAt + rs * 1000 : r.endAt, status,
      dist: r.dist, weather: r.weather, surface: r.surface, horses: r.horses, tune: r.tune, odds: r.odds, exacta: r.exacta || null, tenkai: r.tenkai,
      participants: Object.assign({ total: 0, byStore: {}, combos: {} }, r.participants || {}), result: null, winners: null, refunded: !!r.refunded, refundedAt: r.refundedAt || null,
    };
    if (r.test) out.test = true;
    const result = r.result || o.result || null, priv = o.role === 'tv' || o.role === 'admin';
    if (result && (revealed || priv)) { out.result = withoutCues(result); out.photo = !!r.photo; out.photo2 = !!r.photo2; }
    // 2 連単の人気の上位 6（テレビの右の列・投票中の「人気の組み合わせ上位 6」。V4_RACE_NOTES.md 5 章の形 { first, second, odds }。倍率は見せてよい結果があれば確定倍率）
    out.exactaTop = popularCombos(out, 6, out.result && out.result.finalExacta).map((x) => ({ first: x.first, second: x.second, odds: x.odds, combo: x.combo }));
    if (priv) { const cues = r.cues || (r.result && r.result.cues) || (o.result && o.result.cues) || (o.secret && o.secret.decision && o.secret.decision.cues) || null; if (cues) out.cues = cues; }
    // テストのレース・テストの店の当たりは、その店（と管理）にだけ見せる
    if (revealed || o.role === 'admin') out.winners = (r.winners || o.winners || []).filter((w) => !w.test || o.role === 'admin' || !o.store || w.storeId === o.store);
    if (o.role === 'admin' && o.secret) { out.payoutTarget = o.secret.payoutTarget; out.scope = o.secret.scope; out.decision = o.secret.decision || null; out.winProb = o.secret.winProb; out.comboProb = o.secret.comboProb; }
    return out;
  }
  /* 今の状態（GET /api/state と同じ形）。
     open: いま投票できるレース | null。next: open 以外で一番早い締切前のレース（open がなければ「投票の始まりを待っている」レース。待ち画面の「次のレースは 21:00、投票は 20:57 から」）。
     current: open || next。live: 締切後〜発表前。last: 一番新しい発表済み。upcoming: この先 5 レースの時刻（作る前の時刻表の分も。openAt つき）。
     2026-10-26「このレースはこの店だけ」: open・next・current はその店が投票できるレースだけ。watch: この店は投票できないが見えるレースで、投票が始まっている（openAt〜closeAt）もの（テレビの「見るだけ」。QR の所に「このレースは ○○店のみ投票」）| null。
     upcoming の 1 件は { id, at, time（25 時表記）, storeId, storeIds（null ＝ 全店）, canVote（この店が投票できるか）, openAt }。スマホ（role phone）は投票できる分だけ、テレビ・スタッフ・管理は見える分ぜんぶ。
     time の文字はどれも fmtBizTime（営業日の時刻。深夜は 25:00）
     2026-10-27「本日の出走時間」: p.rules（公開の時刻表の決まり）を渡すと today ＝ todayRaces(...)（この営業日のこの店が投票できるレースの時刻。済み・次の印つき）を足す。渡さなければ today は付かない */
  /* 本日の出走時間（2026-10-27 オーナー「本日の出走時間を店ごとにテレビとスマホへ」。テレビの待ち時間・結果、スマホの待ち・投票済み・結果の「本日のレース 13:00 ✓ 16:00 ✓ 19:00 ◀次 22:00 25:00」）
     rules: 時刻表の決まり（公開の publicRules でも管理の決まりでもよい）。store: この店。nowMs: いま。tuning: dayStartHour（営業日の区切り）を見る。
     営業日 ＝ bizDate(nowMs, dayStartHour)。その日の決まりを expandDate で広げ（日付 > 祝日 > 曜日 > 毎日 は expandDate のまま）、
     区切り h 時〜翌日 h 時の間に走り出すもの（25:00 の決まりは同じ営業日。深夜 1:30 に見れば「きょう」は前の日の営業日で、25:00 は済み）。
     古い形の決まりで 00:00〜04:59 の時刻（次のカレンダーの日の深夜）も同じ営業日に入れる（翌日の決まりも広げて、営業日の中の分だけ取る）。
     この店が投票できるものだけ（storeIds が無い＝全店、またはこの店が入っている。以前の形の storeId はその店だけ）。テストレース・手で作ったレースは時刻表に無いので入らない。
     返り値（発走の早い順）: [{ id, at, time（25 時表記）, storeIds（null ＝ 全店）, done（at <= now）, next（まだ来ていない最初の 1 つ） }]。時刻表が空ならば [] */
  function todayRaces(rules, store, nowMs, tuning) {
    const T = tuningOf(tuning), H = T.dayStartHour, t = Number(nowMs);
    if (!Number.isFinite(t)) return [];
    const ds = bizDate(t, H), from = dayStart(ds) + H * 3600000, to = from + DAY, seen = {}, out = [];
    [].concat(expandDate(ds, rules || []), expandDate(dateStr(dayStart(ds) + DAY), rules || [])).forEach((e) => {
      if (e.at < from || e.at >= to) return;
      if (e.storeId && e.storeId !== store) return;
      if (Array.isArray(e.storeIds) && e.storeIds.length && !e.storeIds.includes(store)) return;
      const k = (e.storeId || '') + '|' + e.at; if (seen[k]) return; seen[k] = 1;
      out.push({ id: e.id, at: e.at, time: fmtBizTime(e.at, H), storeIds: storeIdsOf(e.storeIds), done: e.at <= t, next: false });
    });
    out.sort((a, b) => a.at - b.at);
    const nx = out.find((e) => !e.done); if (nx) nx.next = true;
    return out;
  }
  function stateFor(p) {
    const t = p.t, store = p.store, st = p.stores.find((s) => s.id === store);
    if (!st) throw err(404, 'no_store', '店舗が見つかりません');
    const T = tuningOf(p.tuning), H = T.dayStartHour;
    const list = p.races.filter((r) => visibleTo(r, store)).sort((a, b) => a.at - b.at), cur = currentRaceFor(list, store, t), open = cur && t >= voteWindow(cur).openAt ? cur : null;
    const live = list.filter((r) => (r.status === 'closing' || r.status === 'closed' || r.status === 'decided') && t < r.revealAt).pop() || null;
    const last = list.filter((r) => r.status === 'done').pop() || null;
    const next = list.find((r) => canVote(r, store) && r.status === 'upcoming' && r.closeAt > t && (!open || r.id !== open.id)) || null;
    // 見るだけのレース: この店は投票できないが、投票が始まっていて締切前（他店の投票中）。テレビはこれを映す
    const watch = list.find((r) => !canVote(r, store) && r.status === 'upcoming' && t >= voteWindow(r).openAt && t < r.closeAt) || null;
    const up0 = p.upcoming || list.filter((r) => r.status === 'upcoming').map((r) => ({ id: r.id, at: r.at, storeId: r.storeId || null, storeIds: storeIdsOf(r.storeIds), openAt: voteWindow(r).openAt }));
    const upcoming = up0.filter((e) => e.at > t && (!e.storeId || e.storeId === store))
      .map((e) => Object.assign({}, e, { time: fmtBizTime(e.at, H), storeIds: storeIdsOf(e.storeIds), canVote: canVote({ storeId: e.storeId || null, storeIds: e.storeIds }, store), openAt: e.openAt != null ? e.openAt : e.at - T.closeLeadSec * 1000 - T.voteSec * 1000 }))
      .filter((e) => p.role !== 'phone' || e.canVote).slice(0, 5);
    const ss = st.settings || {}, res = p.results || {};
    const pr = (r) => { const o = publicRace(r, { role: p.role, store, storeSettings: ss, openId: open && open.id, result: r && res[r.id] }); if (o) o.horseLook = horseLookFor(p.tuning, r); return o; };
    const out = {
      now: t, day: bizDay(t, H), store: { id: st.id, name: st.name, nextSeq: st.nextSeq || 0, reloadSeq: st.reloadSeq || 0 },
      stores: p.stores.map((s) => ({ id: s.id, name: s.name })), settings: settingsFor(p.tuning, ss, t),
      open: pr(open), next: pr(next), live: pr(live), last: pr(last), watch: pr(watch), upcoming,
    };
    out.current = out.open || out.next;
    if (p.rules) out.today = todayRaces(p.rules, store, t, p.tuning); // 本日の出走時間（2026-10-27）。公開の時刻表を渡した呼び方だけ
    return out;
  }

  /* ---------- 票（v4） ----------
     1 票 ＝ レース × 店 × 会計番号（2 桁）。id は voteId（レース id ~ 店 ~ 会計番号）。
     持ち主: 最初に投票したスマホ。模擬クラウドは秘密のキー（key。スマホがそのレースの間だけ覚える）、Firestore 版は匿名ログインの uid（owner）。 */
  const BILL_RE = /^(0[1-9]|[1-9][0-9])$/;
  function cleanBill(v) {
    const s = String(v == null ? '' : v).trim();
    if (!/^\d{1,2}$/.test(s) || Number(s) < 1 || Number(s) > 99) throw err(400, 'bad_bill', '会計番号は 2 けた（01〜99）で入れてください');
    return s.padStart(2, '0');
  }
  function cleanNick(v) { const nick = String(v == null ? '' : v).trim(); if (!nick || Array.from(nick).length > 8) throw err(400, 'bad_nick', 'ニックネームは 1〜8 文字です'); return nick; }
  function cleanPair(b, n) {
    n = n || 6; const num = (v) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim())) ? Number(v) : NaN), a = num(b.first), c = num(b.second);
    if (!Number.isInteger(a) || !Number.isInteger(c) || a < 0 || c < 0 || a >= n || c >= n) throw err(400, 'bad_pick', '1 着と 2 着の馬をえらんでください');
    if (a === c) throw err(400, 'bad_pick', '1 着と 2 着は別の馬にしてください');
    return { first: a, second: c };
  }
  function cleanVote(b, n) { b = b || {}; return Object.assign({ bill: cleanBill(b.bill), nick: cleanNick(b.nick) }, cleanPair(b, n)); }
  /* 票の id: レース~店~会計番号。初参加ボーナスの 2 票目（2026-10-24）は後ろに ~2（n = 2） */
  const voteId = (raceId, store, bill, n) => String(raceId) + '~' + String(store) + '~' + String(bill) + (Number(n) === 2 ? '~2' : '');
  function parseVoteId(vid) { const m = /^(.+)~([a-z0-9_-]{1,32})~(\d{2})(~2)?$/.exec(String(vid || '')); return m ? { raceId: m[1], storeId: m[2], bill: m[3], n: m[4] ? 2 : 1 } : null; }
  const baseVid = (vid) => String(vid || '').replace(/~2$/, ''); // 2 票目の id → 1 票目の id
  const comboOf = (v) => (v && v.first != null && v.second != null ? v.first + '-' + v.second : null);
  /* 投票した組み合わせの数（参加人数と人気）: { total, byStore, combos, bonus }。
     total・byStore は人数（初参加ボーナスの 2 票目は数えない）、combos は票の数（2 票目も 1 票）、bonus は 2 票目の数 */
  function countVotes(votes) {
    const p = { total: 0, byStore: {}, combos: {}, bonus: 0 };
    (votes || []).forEach((v) => { if (!v || v.first == null) return; const k = comboOf(v); p.combos[k] = (p.combos[k] || 0) + 1; if (v.n === 2) { p.bonus++; return; } p.total++; p.byStore[v.storeId] = (p.byStore[v.storeId] || 0) + 1; });
    return p;
  }
  /* ---------- 端末 ID と 初参加ボーナス（2026-10-24 オーナー決定。仕様書_v4_大改修.md の最後） ----------
     端末 ID: Firestore 版は匿名ログインの uid、模擬クラウドはスマホが覚える番号（client.js の deviceId）。
     端末のリスト（derbyDevices/<端末 ID>）: { firstAt, firstRaceId, firstStore, lastAt, lastRaceId, lastStore, races }。本物のレースの 1 票目を作ったときだけ書く（テストレース・テストの店の票は数えない）。
     ボーナス: その端末で初めて投票するレース（端末のリストが無い・firstRaceId がこのレース）で、その日・その店・その会計番号でまだ使っていなければ 2 票目を入れられる。
     使った印（derbyBonus/<営業日>~<店>~<会計番号>）は 2 票目と一緒に作る（消さない）。テストの票は印を見ない・作らない（テストで本物の印を使い切らない）。 */
  const bonusKey = (day, store, bill) => String(day) + '~' + String(store) + '~' + String(bill);
  /* 同じ端末のボーナスは 1 日 1 回まで（2026-10-27）: derbyBonusDev/<営業日>~<端末 ID>（Firestore 版は uid）。2 票目・derbyBonus と同じ書き込みで作る（消さない）。模擬クラウドは db.bonusDev */
  const bonusDevKey = (day, dev) => String(day) + '~' + String(dev);
  // dev: 端末のリストの 1 件（無ければ null）、marked: その日・店・番号の印があるか、test: 1 票目がテスト
  const bonusDeviceOk = (dev, raceId) => !dev || !dev.firstRaceId || dev.firstRaceId === raceId;
  const bonusOk = (dev, raceId, marked, test) => bonusDeviceOk(dev, raceId) && (!!test || !marked);
  // 1 票目を作ったときの端末のリストの書き方: null（書かない）| { create: {...} } | { update: {...} }
  function devicePlan(dev, raceId, store, t) {
    if (!dev) return { create: { firstAt: t, firstRaceId: raceId, firstStore: store, lastAt: t, lastRaceId: raceId, lastStore: store, races: 1 } };
    if (dev.lastRaceId === raceId) return null;
    return { update: { lastAt: t, lastRaceId: raceId, lastStore: store, races: (Number(dev.races) || 0) + 1 } };
  }
  // QR の文字列（derby:pay:<pid>）・id
  function parseCode(code) { const raw = String(code || '').trim(), m = /^derby:(auth|pay):(.+)$/.exec(raw); if (m && m[1] !== 'pay') throw err(400, 'wrong_code', 'これは受け取りの QR ではありません'); return { id: m ? m[2] : raw }; }
  /* 持ち主に見せる票（スマホ）。race: レース（公開部分でよい）、payout: その票の当たり（なければ null）。
     result は発表のあと（done）だけ: { combo（レースの 1 着-2 着）, first, second, odds（確定倍率）, win, amount（当選額。テストでも計算した額）, test（テストなので受け取りなし）, payout } */
  function voteView(v, race, payout) {
    if (!v) return null;
    const out = { vid: v.vid, raceId: v.raceId, storeId: v.storeId, bill: v.bill, nick: v.nick, first: v.first, second: v.second, combo: comboOf(v), votedAt: v.votedAt || null, updatedAt: v.updatedAt || null, test: !!v.test, n: v.n === 2 ? 2 : 1, result: null };
    if (race && race.status === 'done' && race.result) {
      const R = race.result, combo = R.combo || (R.order ? R.order[0] + '-' + R.order[1] : null), win = combo === out.combo && !race.refunded;
      const odds = R.finalExacta && combo ? Number(R.finalExacta[combo]) : null, p = payout && payout.status !== 'void' ? payout : null;
      out.result = { raceId: race.id, combo, first: R.first != null ? R.first : R.winner, second: R.second != null ? R.second : (R.order ? R.order[1] : null), odds, win, refunded: !!race.refunded,
        amount: win ? (p ? p.amount : odds ? payFor(odds) : 0) : 0, test: !!(v.test || race.test),
        payout: win && p ? { pid: p.pid, code: 'derby:pay:' + p.pid, status: p.status, paidAt: p.paidAt || null, paidVia: p.paidVia || null, expireAt: p.expireAt || null } : null };
    }
    return out;
  }
  // 1 票の当選額（outcome.js と同じ: 100pt × 倍率 の 100pt 切り上げ）。core.js は Outcome を持たないので写し
  function payFor(odds) { const t = Math.max(10, Math.round(Number(odds) * 10)); return Math.ceil(t * 10 / STAKE - 1e-9) * STAKE; }
  /* 当たりの見せ方（スタッフの「今日の当たり一覧」・管理）。paidVia: 'staff'（スタッフのスマホ）| 'self'（お客さんのスマホのスライド） */
  const payoutView = (p, storeName, revealed) => ({ pid: p.pid, code: 'derby:pay:' + p.pid, vid: p.vid || null, test: !!p.test, kind: 'win', n: p.n === 2 ? 2 : 1, raceId: p.raceId, raceAt: p.raceAt || null, storeId: p.storeId, storeName: storeName ? storeName(p.storeId) : p.storeId, bill: p.bill, nick: p.nick,
    first: p.first != null ? p.first : null, second: p.second != null ? p.second : null, combo: p.combo || null, odds: p.odds != null ? p.odds : null, amount: p.amount, status: p.status, createdAt: p.createdAt, paidAt: p.paidAt || null, paidBy: p.paidBy || null, paidVia: p.paidVia || null, expireAt: p.expireAt || null, revealed: !!revealed });
  // スタッフの一覧の並び: まだ渡していない（unpaid）を上（新しい順）、渡した（paid）は下（渡した時刻の新しい順）、期限切れ・取り消しは最後
  function sortWins(list) {
    const rank = (p) => (p.status === 'unpaid' ? 0 : p.status === 'paid' ? 1 : 2);
    return list.slice().sort((a, b) => rank(a) - rank(b) || (a.status === 'paid' ? (b.paidAt || 0) - (a.paidAt || 0) : (b.raceAt || b.createdAt || 0) - (a.raceAt || a.createdAt || 0)) || (a.bill < b.bill ? -1 : 1));
  }

  /* ---------- 結果の決定 ---------- */
  function effectiveCap(tuning, usedToday) {
    const perRace = Math.max(0, Math.floor(tuning.payoutCap || 0)), perDay = Math.max(0, Math.floor(tuning.payoutCapDay || 0));
    if (!perDay) return perRace;
    const left = Math.max(1, perDay - (usedToday || 0)); // 1 日の上限を使い切ったら 1（＝どの当たりも超える → 当たりなし）
    return perRace ? Math.min(perRace, left) : left;
  }
  /* ---------- 1 台で番号が多いスマホ（2026-10-27。P1: 1 台で会計番号をたくさん入れて全部の組み合わせを買う） ----------
     ownerOf: 票の持ち主（Firestore 版は owner＝匿名ログインの uid、模擬クラウドは device＝スマホが覚える番号。無い古い画面の票は null＝数えない）。
     manyBillOwners(votes, n): 持ち主ごとの会計番号の数（店~番号。2 票目は同じ番号）が n 以上の持ち主 → { 持ち主: 番号の数 }。n が 0 なら {}（使わない）。
     2〜3 個（友だちの分を 1 台で）は n（初期 4）より少ないので何も変わらない */
  const ownerOf = (v) => (v && (v.owner || v.device)) || null;
  const shortDev = (id) => (id ? '…' + String(id).slice(-6) : '?');
  const maxBillsOf = (n) => { const x = Math.floor(Number(n)); return Number.isFinite(x) && x >= 2 ? x : 0; };
  function billsByOwner(votes) { const by = {}; (votes || []).forEach((v) => { const o = ownerOf(v); if (!o) return; (by[o] = by[o] || {})[v.storeId + '~' + v.bill] = 1; }); const out = {}; Object.keys(by).forEach((o) => { out[o] = Object.keys(by[o]).length; }); return out; }
  function manyBillOwners(votes, n) { const N = maxBillsOf(n), out = {}; if (!N) return out; const by = billsByOwner(votes); Object.keys(by).forEach((o) => { if (by[o] >= N) out[o] = by[o]; }); return out; }
  /* 見える化（管理の集計タブの「注意」。2026-10-27）: マスターが読めるデータ（票・当たり・ボーナスの印・レース）から、営業日 × 店ごとの
     ボーナスの数・端末の数（持ち主の数）・1 台あたりの番号の数（1 レースでの最大・多い端末）・端末ごとの当たりの回数と額、と気になる端末（注意）を出す。
     p: { races: [{ id, day, test }], votes: [票（owner か device）], payouts: [当たり（owner か device・flag）], bonus: [ボーナスの印（day・storeId・owner か device）], tuning, from?, to?, store? }
     注意の決まり: 1 レースで maxBillsPerDevice（初期 4）個以上の番号・1 営業日に 3 回以上の当たり・1 営業日に 2 回以上のボーナス（1 日 1 回にしたので起きないはず）・当たりに many_bills の印。
     テストのレース・テストの票は入れない。返り値 { from, to, threshold, days: [{ date, stores: [{ storeId, votes, bonus, devices, maxBills, top: [{ dev, bills, billsDay, races, wins, pt }] }] }], flags: [{ date, dev, stores, bills, wins, pt, bonus, reasons }] } */
  function abuseReport(p) {
    p = p || {}; const T = tuningOf(p.tuning), N = maxBillsOf(T.maxBillsPerDevice) || 4, from = p.from || '', to = p.to || '\uffff';
    const raceDay = {}; (p.races || []).forEach((r) => { if (r && r.id && !r.test) raceDay[r.id] = r.day || bizDate(r.at, T.dayStartHour); });
    const inRange = (d) => !!d && d >= from && d <= to && true;
    const days = {}, cell = (d, s) => { const D = (days[d] = days[d] || {}); return (D[s] = D[s] || { storeId: s, votes: 0, bonus: 0, own: {} }); };
    const devOf = (c, o) => (c.own[o] = c.own[o] || { races: {}, bills: {}, wins: 0, pt: 0 });
    const dayDev = {}, dd = (d, o) => { const k = d + '|' + o; return (dayDev[k] = dayDev[k] || { date: d, id: o, stores: {}, bills: 0, wins: 0, pt: 0, bonus: 0, flagged: 0 }); };
    (p.votes || []).forEach((v) => {
      const d = raceDay[v.raceId]; if (!d || v.test || !inRange(d) || (p.store && v.storeId !== p.store)) return;
      const c = cell(d, v.storeId); c.votes++; const o = ownerOf(v); if (!o) return;
      const x = devOf(c, o); (x.races[v.raceId] = x.races[v.raceId] || {})[v.bill] = 1; x.bills[v.bill] = 1; dd(d, o).stores[v.storeId] = 1;
    });
    (p.payouts || []).forEach((q) => {
      if (!q || q.status === 'void' || q.test) return; const d = q.day || raceDay[q.raceId]; if (!inRange(d) || (p.store && q.storeId !== p.store)) return;
      const o = ownerOf(q), c = cell(d, q.storeId); if (!o) return;
      const x = devOf(c, o); x.wins++; x.pt += Number(q.amount) || 0; const y = dd(d, o); y.wins++; y.pt += Number(q.amount) || 0; y.stores[q.storeId] = 1; if (q.flag) y.flagged++;
    });
    (p.bonus || []).forEach((b) => { if (!b || !inRange(b.day) || (p.store && b.storeId !== p.store)) return; cell(b.day, b.storeId).bonus++; const o = ownerOf(b); if (o) { const y = dd(b.day, o); y.bonus++; y.stores[b.storeId] = 1; } });
    const outDays = Object.keys(days).sort().reverse().map((d) => ({ date: d, stores: Object.keys(days[d]).sort().map((s) => {
      const c = days[d][s], own = Object.keys(c.own).map((o) => { const x = c.own[o], br = Object.keys(x.races).map((r) => Object.keys(x.races[r]).length); const row = { dev: shortDev(o), bills: br.length ? Math.max.apply(null, br) : 0, billsDay: Object.keys(x.bills).length, races: br.length, wins: x.wins, pt: x.pt };
        const m = dd(d, o); m.bills = Math.max(m.bills, row.bills); return row; });
      own.sort((a, b) => b.bills - a.bills || b.wins - a.wins || b.pt - a.pt || (a.dev < b.dev ? -1 : 1));
      return { storeId: s, votes: c.votes, bonus: c.bonus, devices: own.filter((x) => x.races > 0).length, maxBills: own.length ? Math.max.apply(null, own.map((x) => x.bills)) : 0, top: own.slice(0, 5) };
    }) }));
    const flags = [];
    Object.keys(dayDev).forEach((k) => {
      const y = dayDev[k], reasons = [];
      if (y.bills >= N) reasons.push('bills'); if (y.wins >= 3) reasons.push('wins'); if (y.bonus >= 2) reasons.push('bonus'); if (y.flagged) reasons.push('flag');
      if (reasons.length) flags.push({ date: y.date, dev: shortDev(y.id), stores: Object.keys(y.stores).sort(), bills: y.bills, wins: y.wins, pt: y.pt, bonus: y.bonus, reasons });
    });
    flags.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || b.reasons.length - a.reasons.length || b.pt - a.pt || (a.dev < b.dev ? -1 : 1));
    return { from: p.from || null, to: p.to || null, threshold: N, days: outDays, flags };
  }
  /* race（公開部分）, secret（payoutTarget, scope, comboProb）, votes（このレースの票）→ 結果・当たり（id は呼ぶ側で付ける）。
     テストのレース・テストの店の票: 本物の票があるときは決め方に入れない。当たりは作らない（winners には test つきで出す。スマホは「テストなので受け取りはありません」） */
  function decideRace(Engine, Outcome, race, secret, votes, tuning, salt, t, usedToday) {
    const T = tuningOf(tuning);
    const list = (votes || []).filter((v) => v && v.first != null && v.second != null).sort((a, b) => (a.vid < b.vid ? -1 : 1)); // 順番で結果が変わらないように
    const isT = (v) => !!v.test || !!race.test;
    const real = list.filter((v) => !isT(v)), basis = real.length ? real : list;
    /* 1 台で番号が多いスマホ（2026-10-27）: 本物の票で、同じ持ち主（owner＝uid・模擬クラウドは device）が maxBillsPerDevice 個以上の会計番号を使ったら、その票は
       決め方（目標の幅・必ず誰かは当てる・倍率のずらし）に数えない（上限にだけ数える）。自然に当たったら払う（当たりに flag: 'many_bills'。管理の「注意」にだけ出る） */
    const heavy = manyBillOwners(real, T.maxBillsPerDevice), isHeavy = (v) => !isT(v) && heavy[ownerOf(v)] != null;
    const honest = basis.filter((v) => !isHeavy(v)), extra = basis.filter(isHeavy);
    const t0 = Date.now(), cap = real.length ? effectiveCap(T, usedToday) : 0, er = engineRace(race); // テストの票だけのときは払わないので上限は見ない
    const vin = (v) => ({ first: v.first, second: v.second, group: v.storeId });
    const input = { exacta: race.exacta, comboProb: secret.comboProb, n: (race.horses || []).length || 6, votes: honest.map(vin), target: secret.payoutTarget, scope: secret.scope, up: T.shiftUp, down: T.shiftDown, bandBelow: T.bandBelow, bandAbove: T.bandAbove, cap, seed: Outcome.hash(salt, race.id, 'decide') };
    if (extra.length) input.extra = extra.map(vin); // 多いスマホが無いレースは今までとまったく同じ入力
    const res = Outcome.resolveExacta(Engine, er, input);
    const run = Engine.replayRun(er, res.seed, { order: res.order });
    const cues = cuesFor(Outcome, salt, race.id, res.first, T, (race.horses || []).length || 6);
    const result = { winner: res.first, second: res.second, combo: res.combo, comboOdds: res.comboOdds, order: res.order, finalExacta: res.finalExacta, finalOdds: race.odds, seed: res.seed, finishTimes: run.finishTimes.map((x) => Math.round(x * 1000) / 1000), winTime: Math.round(run.winTime * 1000) / 1000, natural: res.natural, cues };
    const decision = { target: res.target, scope: res.scope, payout: res.payout, perGroup: res.perGroup, reason: res.reason, band: res.band || null, tries: res.tries, swapsNeeded: res.swapsNeeded, swaps: run.swaps || null, noWinner: res.noWinner, ms: Date.now() - t0, cap, cues, combo: res.combo, comboOdds: res.comboOdds,
      cands: res.cands.map((c) => ({ combo: c.combo, votes: c.votes, odds: c.odds, payout: c.payout, dist: c.dist, inBand: !!c.inBand })) };
    let runAt = race.runAt, revealAt, shift = Math.max(0, t + RUN_LEAD_MS - race.runAt), late = false;
    if (shift > LATE_CAP_MS) { shift = 0; late = true; } else runAt = race.runAt + shift;
    // 写真判定: 1 着争い（photo）と 2 着争い（photo2。2026-10-20「2 着争いが接戦のときも写真判定とスロー」）。どちらも 0.05 秒以内。発表はそれぞれ photoExtraSec ずつ遅らせる
    const ft = result.finishTimes.slice().sort((a, b) => a - b); // テレビ（Race3D.photoOf）と同じ値（ミリ秒に丸めた result.finishTimes）で判定
    let photo = ft.length > 1 && ft[1] - ft[0] <= 0.05, photo2 = ft.length > 2 && ft[2] - ft[1] <= 0.05;
    revealAt = runAt + Math.ceil(run.winTime * 1000) + ((race.postSec != null ? race.postSec : T.postSec) + (photo ? (T.photoExtraSec || 0) : 0) + (photo2 ? (T.photoExtraSec || 0) : 0)) * 1000;
    if (late) { revealAt = t; photo = false; photo2 = false; }
    const endAt = revealAt + (race.resultSec != null ? race.resultSec : T.resultSec) * 1000;
    const odds = res.finalExacta[res.combo], amount = payFor(odds), payouts = [], winners = [];
    let paid = 0;
    list.forEach((v) => {
      if (comboOf(v) !== res.combo) return;
      const test = isT(v);
      winners.push(Object.assign({ storeId: v.storeId, bill: v.bill, nick: v.nick, amount, combo: res.combo }, test ? { test: true } : {}));
      if (test) return; // テストの当たりは払わない（当たりを作らない）
      const po = { kind: 'win', vid: v.vid, owner: v.owner || null, raceId: race.id, raceAt: race.at, storeId: v.storeId, bill: v.bill, nick: v.nick, first: res.first, second: res.second, combo: res.combo, odds, amount, status: 'unpaid' };
      if (v.n === 2) po.n = 2; // 初参加ボーナスの 2 票目（当たればそれぞれ払う）。undefined は Firestore に書けないので付けるときだけ
      if (isHeavy(v)) { po.flag = 'many_bills'; po.bills = heavy[ownerOf(v)]; } // 1 台で番号が多いスマホの当たり（払うのはふつうどおり。スタッフの一覧には出さない＝管理の「注意」だけ）
      payouts.push(po);
      paid += amount;
    });
    mergeWinners(winners); // 同じ人の 2 票（同じ組み合わせ）はテレビでは 1 行（額は 2 票分）
    winners.sort((a, b) => b.amount - a.amount || (a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : a.bill < b.bill ? -1 : 1));
    decision.paid = paid; decision.paidReal = paid; decision.winners = winners.length; decision.votes = real.length; decision.testVotes = list.length - real.length;
    if (extra.length) { // 1 台で番号が多いスマホ（管理のオーナー用・記録）
      decision.manyBills = Object.keys(heavy).sort().map((o) => ({ dev: shortDev(o), bills: heavy[o] })); decision.manyBillVotes = extra.length;
      decision.manyBillPaid = payouts.filter((x) => x.flag === 'many_bills').reduce((a, x) => a + x.amount, 0); decision.maxBills = T.maxBillsPerDevice;
    }
    const participants = countVotes(list);
    decision.runShift = shift; decision.lateReveal = late;
    return { result, decision, cues, runAt, revealAt, endAt, photo, photo2, payouts, winners, participants, runShift: shift, lateReveal: late };
  }
  /* 同じ人（店・会計番号）の当たりは 1 行にまとめる（初参加ボーナスの 2 票が同じ組み合わせで当たったとき。額は 2 票分・votes: 2）。list をその場で書き換えて返す */
  function mergeWinners(list) {
    if (!list) return list;
    const seen = {}, out = [];
    list.forEach((w) => { const k = w.storeId + '~' + w.bill + (w.test ? '~t' : ''), x = seen[k]; if (x) { x.amount += w.amount; x.votes = (x.votes || 1) + 1; } else { seen[k] = w; out.push(w); } });
    list.length = 0; out.forEach((w) => list.push(w)); return list;
  }
  // 当たった人の一覧（テレビの結果画面「上野 12番 たろう 1,300pt」。全店。金額の大きい順。最大 300 件）。storeName で店名を付ける
  function winnersView(winners, storeName) { return (winners || []).slice(0, 300).map((w) => Object.assign({}, w, { storeName: storeName ? storeName(w.storeId) : w.storeId })); }
  // 当たり（payouts）から一覧を作る（以前の形の呼び方。取り消し済みは除く。同じ人の 2 票は 1 行）
  function winnersFrom(payouts, storeName) {
    return winnersView(mergeWinners((payouts || []).filter((p) => p.status !== 'void').sort((a, b) => b.amount - a.amount || (a.createdAt || 0) - (b.createdAt || 0)).map((p) => Object.assign({ storeId: p.storeId, bill: p.bill, nick: p.nick, amount: p.amount, combo: p.combo || null }, p.test ? { test: true } : {}))).sort((a, b) => b.amount - a.amount), storeName);
  }
  // 取り消し（成立しなかったレース。管理の「返還」の v4 版）: まだ渡していない当たりは void。渡した当たりはそのまま（参加無料なので返すものはない）
  function voidPlan(payouts) { const voids = [], kept = []; (payouts || []).forEach((p) => { if (p.status === 'unpaid') voids.push(p); else if (p.status === 'paid') kept.push(p); }); return { voids, kept, voided: voids.reduce((a, p) => a + p.amount, 0) }; }
  /* 集計の 1 行（営業日・店ごと）: races（テストを除くレース数）・votes（票の数＝参加人数）・players（会計番号の数）・target（当選額の目標）・paid（当選額）・
     claimed（渡した額）・expired（期限切れ）・unclaimed（まだ渡していない額）・payRate（当選額 ÷ 目標） */
  function statRow(x, claimed) {
    x = x || {}; const n = (k) => Number(x[k]) || 0;
    const row = { races: n('races'), votes: n('votes'), players: x.bills ? Object.keys(x.bills).length : n('players'), target: n('target'), paid: n('paid'), claimed: claimed != null ? claimed : n('claimed'), expired: n('expired') };
    row.unclaimed = Math.max(0, row.paid - row.claimed - row.expired);
    row.payRate = row.target ? Math.round(row.paid / row.target * 1000) / 1000 : 0;
    return row;
  }
  // 1 レースの目標（集計用）: 全店の合計なら目標そのまま、店ごとなら目標 × 票のあった店の数
  const raceTargetSum = (target, scope, byStore) => (scope === 'store' ? (Number(target) || 0) * Math.max(1, Object.keys(byStore || {}).length) : Number(target) || 0);

  /* ---------- 投票が始まったら、テレビのゲームを DERBY に（2026-10-20 オーナー決定） ----------
     「レースの時刻にテレビが SLOT なら自動で DERBY にする（投票が始まる時刻。SLOT で遊んでいる途中なら終わってから）。レースのあとも DERBY のまま」。
     races: レースの一覧、stores: [{ id, settings }]、t: 今。返り値 [{ raceId, stores: [SLOT から DERBY に変える店] }]（まだ印 tvAutoAt のないレースだけ）。
     決める係（模擬クラウドはサーバー、Firestore 版は進行役のテレビ）が、店の settings.tvGame と derbySwitch/tv を 'derby' にして、レースに tvAutoAt を書く。
     1 レースにつき 1 回だけ（投票の途中でスタッフが SLOT にしたら、そのレースの間はそのまま。次のレースの投票の始まりでまた DERBY）。
     SLOT で遊んでいる途中かどうかは、casa SLOT のテレビ（js/tvswitch.js）が見て、終わってから移る（回転中・CREDIT 残り・設定画面の間は移らない） */
  function tvAutoPlan(races, stores, t) {
    const out = [];
    (races || []).forEach((r) => {
      if (!r || r.tvAutoAt || r.status !== 'upcoming' || !(t >= voteWindow(r).openAt && t < r.closeAt)) return;
      out.push({ raceId: r.id, stores: (stores || []).filter((s) => s && s.id && visibleTo(r, s.id) && tvGameOf(s.settings) !== 'derby').map((s) => s.id) });
    });
    return out;
  }

  /* ---------- スタッフの「この店だけテストレース」 ----------
     v4: 投票は 60 秒（TEST_RACE.voteSec）。押した時刻から startIn 秒後に発走（60〜600。決まりの範囲）。投票の始まりは発走の 60 秒前（startIn が 60 なら押してすぐ）。
     店のテレビが SLOT のときは、切り替えのお願い（switchSec 120 秒）＝テレビが来るのを待ってから作る（来た時刻から quickSec）。当たりは払わない・集計に入れない */
  /* waitSec 8: 連打よけだけ（2026-10-25 オーナー「テストレースは何度でも走らせられるように」。以前は 180 秒。v2/firestore.rules の derbyTestReq と同じ数） */
  const TEST_RACE = { startIn: 120, quickSec: 60, switchSec: 120, minSec: 60, maxSec: 600, voteSec: 60, payout: 30000, waitSec: 8, staleSec: 600, deciderWaitSec: 300, tvWaitSec: 300, tvGraceSec: 20, tvSeenDays: 14 };
  function testTvWait(tvs, store, reqAt, t) {
    const mine = (tvs || []).filter((x) => x && x.store === store && x.kind === 'casatv' && Number(x.at) > t - TEST_RACE.tvSeenDays * DAY);
    if (!mine.length) return null;
    return mine.some((x) => Number(x.at) >= reqAt) ? 'arrived' : 'waiting';
  }
  const testRaceId = (store, reqAtMs) => 'x-' + Math.round(reqAtMs).toString(36) + 'test-' + store;
  const testStartIn = (v) => Math.max(TEST_RACE.minSec, Math.min(TEST_RACE.maxSec, Math.round(Number(v) || TEST_RACE.startIn)));
  // テストのレースの時間: { voteSec: 60（発走までが短ければその秒数）, startIn }。closeLeadSec のぶん発走を後ろへ
  function testStages(startIn, tuning) {
    const T = tuningOf(tuning), lead = Math.max(0, Number(T.closeLeadSec) || 0), sec = Math.min(TEST_RACE.maxSec, Math.max(testStartIn(startIn), Math.ceil(lead + 10)));
    return { voteSec: Math.min(TEST_RACE.voteSec, Math.max(10, sec - lead)), startIn: sec };
  }
  /* レースが「ふさいでいる」時間 ＝ 投票の始まり〜結果の発表（revealAt）まで。結果の画面（resultSec。既定 5 分）はふさがない
     （2026-10-25 オーナー「テストレースは何度でも走らせられるように。今、終わると押せなくなっている」。テレビは投票が始まれば結果の画面を閉じて投票の画面にする＝tv.js の decide） */
  function raceSpan(r, T) {
    const start = r.openAt != null ? r.openAt : r.at - T.voteSec * 1000;
    const end = r.revealAt || (r.runAt || r.at) + 60000 + T.postSec * 1000;
    return [start, end];
  }
  // 新しいテストレースがふさぐ時間: 今〜（発走 sec 秒後 ＋ ゲート ＋ 走り 60 秒 ＋ 結果まで postSec）
  function testRaceBusy(races, store, t, startIn, tuning, rules) {
    const T = tuningOf(tuning), sec = testStartIn(startIn);
    const gate = T.scenes && T.scenes.gate === false ? 0 : T.gateSec, end = t + (sec + gate + 60 + T.postSec) * 1000;
    const hit = (s, e) => s < end && e > t;
    for (const r of races || []) { if (!visibleTo(r, store) || r.status === 'void') continue; const [s, e] = raceSpan(r, T); if (hit(s, e)) return { reason: 'busy', raceId: r.id, at: r.at }; }
    const have = new Set((races || []).map((r) => r.id));
    for (const e of scheduleAround(t, rules || [])) {
      if (have.has(e.id) || (e.storeId && e.storeId !== store)) continue;
      const s = e.at - T.voteSec * 1000, en = e.at + (gate + 60 + T.postSec) * 1000;
      if (hit(s, en)) return { reason: 'busy', at: e.at };
    }
    return null;
  }

  /* テレビのゲームの切り替え: 店の設定 settings.tvGame（'slot' | 'derby'、既定 'slot'）。Firestore 版は derbySwitch/tv（誰でも読める 1 件）にも写す */
  const TV_GAMES = ['slot', 'derby'];
  const tvGameOf = (settings) => (settings && settings.tvGame === 'derby' ? 'derby' : 'slot');
  function tvSwitchDoc(stores) { const o = {}; (stores || []).forEach((s) => { if (s && s.id) o[s.id] = tvGameOf(s.settings); }); return o; }
  /* テレビの画質: '' ＝標準・'auto' ＝なめらか優先・'max' ＝きれい優先 */
  const TV_QUALITIES = ['auto', '', 'max'];
  function tvQualityOf(settings) { const q = settings && settings.tvQuality; return q === 'auto' || q === 'max' ? q : ''; }
  const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  function genTvPassword(rand, len) {
    len = len || 20; const lim = 256 - (256 % PW_CHARS.length); let s = '';
    while (s.length < len) { const b = rand(len * 2); for (let i = 0; i < b.length && s.length < len; i++) if (b[i] < lim) s += PW_CHARS[b[i] % PW_CHARS.length]; }
    return s;
  }
  // 決まった id（同じレース・同じ票ならいつも同じ。決める係がやり直しても二重にならない）
  function pidFor(Outcome, salt, raceId, vid, kind) { return 'p' + Outcome.hash(salt, raceId, vid, kind || 'win').toString(36) + Outcome.hash(kind || 'win', vid, raceId, salt).toString(36); }

  return { TEST_RACE, testRaceId, testStartIn, testStages, testRaceBusy, testTvWait, STAKE, MONEY_PER_TICKET, roundAmount, sumBill, statRow, raceTargetSum, JST, DAY, RUN_LEAD_MS, LATE_CAP_MS, DEFAULT_TUNING, PUBLIC_TUNING_KEYS, LEGACY_TUNING_KEYS, SHIFT_UP_MAX, SHIFT_DOWN_MAX, VOTE_SEC_MIN, VOTE_SEC_MAX,
    err, dateStr, dayStart, weekday, hhmm, fmtTime, fmtBizTime, compact, bizDate, bizDay, expireAtFor,
    isHoliday, holidayName, dayKind, RULE_KINDS, RULE_PRIORITY,
    ruleTimes, ruleSlots, ruleMatches, expandDate, scheduleAround, normalizeRules, storeIdsOf, cleanStoreIds, notMyStore, publicRules, publicSchedule, revoteRaces, minGapSec, tuningOf, mergeTuning, publicTuning, modeNow, settingsFor, HORSE_LOOKS, HORSE_LOOK_GRACE_MS, horseLookFor,
    tuneOf, engineRace, raceBase, oddsFor, buildRace, visibleTo, canVote, currentRaceFor, openRaceFor, popularCombos, publicRace, stateFor, todayRaces, voteWindow, votingOpen, manualStages,
    BILL_RE, cleanBill, cleanNick, cleanPair, cleanVote, voteId, parseVoteId, baseVid, comboOf, countVotes, bonusKey, bonusDevKey, bonusDeviceOk, bonusOk, devicePlan, mergeWinners, parseCode, voteView, payFor, payoutView, sortWins,
    effectiveCap, decideRace, ownerOf, shortDev, maxBillsOf, billsByOwner, manyBillOwners, abuseReport, winnersView, winnersFrom, voidPlan, pidFor, tvAutoPlan,
    CUE_KEYS, DEFAULT_CUES, cuesOf, cuesFor, withoutCues,
    TV_GAMES, tvGameOf, tvSwitchDoc, TV_QUALITIES, tvQualityOf, PW_CHARS, genTvPassword };
});
