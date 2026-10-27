/* casa DERBY v4: 次のレースの「投票の始まり」と「発走」を、公開の時刻表だけで求める小さな道具（2026-10-21）。
   casa SLOT のテレビ（casa-slot-button の js/tvswitch.js）が、SLOT を映している間も投票の始まりに DERBY へ移るために読む。
   Core（v2/core.js）なしで動く。計算は Core.expandDate / Core.scheduleAround と同じ（tests/v2-next-open.test.js で同じ答えか確かめる）。祝日の決まり（kind 'holiday'。2026-10-27）も Core と同じ計算（isHoliday / holidayName）。

   読む場所: Firestore casa-derby の derbySchedule/public（ログインなしで読める。書くのは管理画面だけ）
     { rules: [時刻だけの決まり（目標額などは抜いてある。作るのは Core.publicSchedule）], voteSec, closeLeadSec, dayStartHour, updatedAt }
     模擬クラウド（v2/server.js）は GET /api/schedule（同じ中身を Firestore の REST と同じ形 { name, fields } で返す）

   DerbyNextOpen.next(schedule, nowMs[, storeId]) → { at, openAt, closeAt, time, id, storeId } | null
     発走（at）が nowMs より後のレースのうち、いちばん早いもの（投票がもう始まっていても、そのレースを返す）。
     openAt ＝ at − (closeLeadSec ＋ voteSec) 秒。closeAt ＝ at − closeLeadSec 秒（初期 0 ＝ 発走の時刻）。
     storeId を渡さないときは全店のレースだけ（v4 の時刻表は全店同じ）。渡すと、その店だけの決まりも入れる。
     テストレース（スタッフ・管理画面で作るもの）は時刻表に無いので入らない。時刻表が無い・空なら null。
     8 日先まで探す（曜日・日付の決まりで今日・明日に無いときも）。
   DerbyNextOpen.list(schedule, nowMs[, storeId, n, opts]) → この先 n 件（初期 5）。opts.votableOnly（2026-10-27）: その店が投票できるレース（storeIds）だけ
   DerbyNextOpen.voting(schedule, nowMs[, storeId]) → いま投票中（openAt ≤ now < closeAt）なら next と同じもの、でなければ null */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DerbyNextOpen = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const JST = 9 * 3600000, DAY = 86400000, LOOK_DAYS = 8, VOTE_SEC_DEFAULT = 180;
  const dateStr = (ms) => new Date(ms + JST).toISOString().slice(0, 10);
  const dayStart = (ds) => { const p = ds.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) - JST; };
  const weekday = (ds) => { const p = ds.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); };
  const hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim()); return m && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const compact = (ds) => ds.replace(/-/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const arr = (v) => (Array.isArray(v) ? v : []);

  /* 祝日（2026-10-27。時刻表の決まり kind 'holiday'）: Core.isHoliday / Core.holidayName と同じ計算の写し（Core なしで動くため）。
     直すときは v2/core.js と両方を同じに（tests/v4-holiday.test.js が「ここから〜ここまで」の文字列と 2025〜2030 の毎日の答えを比べる） */
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

  function ruleMins(rule) {
    if (Array.isArray(rule.races)) return rule.races.map((x) => hhmm(x && x.time)).filter((x) => x != null);
    if (Array.isArray(rule.times)) return rule.times.map(hhmm).filter((x) => x != null);
    const from = hhmm(rule.from), to = hhmm(rule.to), ev = Math.max(1, Number(rule.everyMin) || 0);
    if (from == null || to == null || !ev) return [];
    const out = []; for (let m = from; m <= to && out.length < 2000; m += ev) out.push(m);
    return out;
  }
  function ruleMatches(rule, ds) {
    if (rule.enabled === false) return false;
    if (rule.kind === 'date') return rule.date === ds;
    if (rule.kind === 'weekday') return arr(rule.weekdays).map(Number).includes(weekday(ds));
    if (rule.kind === 'holiday') return isHoliday(ds);
    return rule.kind === 'daily' || !rule.kind;
  }
  // 1 日分（Core.expandDate と同じ: 店ごとのまとまりの中で 日付 > 祝日 > 曜日 > 毎日 の順に強い。祝日は 2026-10-27）
  function expandDate(ds, rules) {
    const groups = {};
    arr(rules).forEach((r) => { if (!r || typeof r !== 'object') return; const g = r.storeId || ''; (groups[g] = groups[g] || []).push(r); });
    const out = {};
    Object.keys(groups).forEach((g) => {
      const rs = groups[g].filter((r) => ruleMatches(r, ds));
      const pri = ['date', 'holiday', 'weekday'].find((k) => rs.some((r) => r.kind === k)) || 'daily';
      rs.filter((r) => (r.kind || 'daily') === pri).forEach((r) => {
        ruleMins(r).forEach((min) => {
          const at = dayStart(ds) + min * 60000, id = compact(ds) + '-' + pad(Math.floor(min / 60)) + pad(min % 60) + (g ? '-' + g : '');
          out[id] = { id, at, time: pad(Math.floor(min / 60)) + ':' + pad(min % 60), storeId: g || null, storeIds: Array.isArray(r.storeIds) && r.storeIds.length ? r.storeIds.map(String) : null }; /* storeIds: 投票できる店（null ＝ 全店。2026-10-26）。casa SLOT のテレビは見ない（見るだけの店もレースの時刻に DERBY へ移る）。time は 25:00 のような営業日の時刻のまま */
        });
      });
    });
    return Object.values(out).sort((a, b) => a.at - b.at);
  }
  const secs = (v, d) => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? d : Math.max(0, n); };

  /* n: 件数（初期 5）。opts.votableOnly（2026-10-27）: storeId を渡したとき、その店が投票できるレース（storeIds が無い＝全店、またはその店が入っている）だけにする
     （初期は false ＝ 見るだけの店にも出す。casa SLOT のテレビは見るだけの店もレースの時刻に DERBY へ移るので今までどおり）。n の代わりに { n, votableOnly } でもよい */
  function list(schedule, nowMs, storeId, n, opts) {
    if (n && typeof n === 'object') { opts = n; n = opts.n; }
    opts = opts || {};
    const sc = schedule || {}, rules = arr(sc.rules), t = Number(nowMs);
    if (!rules.length || !Number.isFinite(t)) return [];
    const voteSec = secs(sc.voteSec, VOTE_SEC_DEFAULT), lead = secs(sc.closeLeadSec, 0), want = n || 5, seen = {}, out = [];
    // d = -1: 前の日の決まりの 24:00〜28:59（25 時表記。2026-10-26）は今日の深夜に走る（Core.scheduleAround も前の日から見る）
    for (let d = -1; d <= LOOK_DAYS && out.length < want; d++) {
      for (const e of expandDate(dateStr(t + d * DAY), rules)) {
        if (e.at <= t || (e.storeId && e.storeId !== storeId)) continue;
        if (opts.votableOnly && storeId && e.storeIds && !e.storeIds.includes(String(storeId))) continue;
        const k = (e.storeId || '') + '|' + e.at; if (seen[k]) continue; seen[k] = 1;
        out.push(Object.assign(e, { closeAt: e.at - lead * 1000, openAt: e.at - (lead + voteSec) * 1000 }));
      }
    }
    return out.sort((a, b) => a.at - b.at).slice(0, want);
  }
  function next(schedule, nowMs, storeId) { return list(schedule, nowMs, storeId, 1)[0] || null; }
  function voting(schedule, nowMs, storeId) { const e = next(schedule, nowMs, storeId); return e && nowMs >= e.openAt && nowMs < e.closeAt ? e : null; }

  return { next, list, voting, expandDate, isHoliday, holidayName, LOOK_DAYS };
});
