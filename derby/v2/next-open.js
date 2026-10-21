/* casa DERBY v4: 次のレースの「投票の始まり」と「発走」を、公開の時刻表だけで求める小さな道具（2026-10-21）。
   casa SLOT のテレビ（casa-slot-button の js/tvswitch.js）が、SLOT を映している間も投票の始まりに DERBY へ移るために読む。
   Core（v2/core.js）なしで動く。計算は Core.expandDate / Core.scheduleAround と同じ（tests/v2-next-open.test.js で同じ答えか確かめる）。

   読む場所: Firestore casa-derby の derbySchedule/public（ログインなしで読める。書くのは管理画面だけ）
     { rules: [時刻だけの決まり（目標額などは抜いてある。作るのは Core.publicSchedule）], voteSec, closeLeadSec, dayStartHour, updatedAt }
     模擬クラウド（v2/server.js）は GET /api/schedule（同じ中身を Firestore の REST と同じ形 { name, fields } で返す）

   DerbyNextOpen.next(schedule, nowMs[, storeId]) → { at, openAt, closeAt, time, id, storeId } | null
     発走（at）が nowMs より後のレースのうち、いちばん早いもの（投票がもう始まっていても、そのレースを返す）。
     openAt ＝ at − (closeLeadSec ＋ voteSec) 秒。closeAt ＝ at − closeLeadSec 秒（初期 0 ＝ 発走の時刻）。
     storeId を渡さないときは全店のレースだけ（v4 の時刻表は全店同じ）。渡すと、その店だけの決まりも入れる。
     テストレース（スタッフ・管理画面で作るもの）は時刻表に無いので入らない。時刻表が無い・空なら null。
     8 日先まで探す（曜日・日付の決まりで今日・明日に無いときも）。
   DerbyNextOpen.list(schedule, nowMs[, storeId, n]) → この先 n 件（初期 5）
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
    return rule.kind === 'daily' || !rule.kind;
  }
  // 1 日分（Core.expandDate と同じ: 店ごとのまとまりの中で 日付 > 曜日 > 毎日 の順に強い）
  function expandDate(ds, rules) {
    const groups = {};
    arr(rules).forEach((r) => { if (!r || typeof r !== 'object') return; const g = r.storeId || ''; (groups[g] = groups[g] || []).push(r); });
    const out = {};
    Object.keys(groups).forEach((g) => {
      const rs = groups[g].filter((r) => ruleMatches(r, ds));
      const pri = rs.some((r) => r.kind === 'date') ? 'date' : rs.some((r) => r.kind === 'weekday') ? 'weekday' : 'daily';
      rs.filter((r) => (r.kind || 'daily') === pri).forEach((r) => {
        ruleMins(r).forEach((min) => {
          const at = dayStart(ds) + min * 60000, id = compact(ds) + '-' + pad(Math.floor(min / 60)) + pad(min % 60) + (g ? '-' + g : '');
          out[id] = { id, at, time: pad(Math.floor(min / 60)) + ':' + pad(min % 60), storeId: g || null };
        });
      });
    });
    return Object.values(out).sort((a, b) => a.at - b.at);
  }
  const secs = (v, d) => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? d : Math.max(0, n); };

  function list(schedule, nowMs, storeId, n) {
    const sc = schedule || {}, rules = arr(sc.rules), t = Number(nowMs);
    if (!rules.length || !Number.isFinite(t)) return [];
    const voteSec = secs(sc.voteSec, VOTE_SEC_DEFAULT), lead = secs(sc.closeLeadSec, 0), want = n || 5, seen = {}, out = [];
    for (let d = 0; d <= LOOK_DAYS && out.length < want; d++) {
      for (const e of expandDate(dateStr(t + d * DAY), rules)) {
        if (e.at <= t || (e.storeId && e.storeId !== storeId)) continue;
        const k = (e.storeId || '') + '|' + e.at; if (seen[k]) continue; seen[k] = 1;
        out.push(Object.assign(e, { closeAt: e.at - lead * 1000, openAt: e.at - (lead + voteSec) * 1000 }));
      }
    }
    return out.sort((a, b) => a.at - b.at).slice(0, want);
  }
  function next(schedule, nowMs, storeId) { return list(schedule, nowMs, storeId, 1)[0] || null; }
  function voting(schedule, nowMs, storeId) { const e = next(schedule, nowMs, storeId); return e && nowMs >= e.openAt && nowMs < e.closeAt ? e : null; }

  return { next, list, voting, expandDate, LOOK_DAYS };
});
