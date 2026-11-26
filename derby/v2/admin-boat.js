/* casa BOAT の管理画面（window.AdminBoat。v2/admin.js が tab === 'boat' のときに render(main, ctx) を呼ぶ）。
   2026-11-22 オーナー「競馬と同じみたいな感じのさ、全部設定画面にしてほしい」: 1 枚に並べていたのをやめて、競馬の管理画面と同じ「下のタブ」に分けた。
     今日   … 今日のボートのレース（状態・参加・払った BPT／目安・結果）・取り消し・すぐ始めるボートレース（確かめ用）
     時刻表 … 競馬と同じ「予定」の札（名前・ON/OFF・コピー・いつ・まとめて作る・おまかせ・1 レースずつの行）
     テレビ … 店ごとの映像の画質（押したらすぐ保存）
     調整   … 払う BPT（目安・上限）・時間・ボートを始める日と時刻・フライングと転覆
     選手   … 出走する選手の一覧（名前・級・得意・★・平均 ST・前付け・出走／休み）
     集計   … 日ごとのレース数と払った BPT・その日のレース
   保存は下のタブごと（ほかのタブの中身は送らない＝変えない）。競馬と被る時刻は保存できない（サーバー・Firestore 版が 409 boat_conflict で断り、その中身を赤字で出す）。
   画面に「ポイント」と書かない（BPT と書く）。
   守っていること（不具合一覧 2026-11-20・21）: 「最新にする」で保存前の編集を消さない（F12）／目安のちがうレースを保存で失わない（F13）／ボタンの連打を受けない（F14）／
   読み込みの赤字は読めたら消す（I5）／処理の途中でタブを離れて戻ったら、古い返事は新しい画面に触らない（J15。S.gen） */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const KIND = { daily: '毎日', weekday: '曜日', holiday: '祝日', date: '日付' };
  const ST = { upcoming: '受付前・受付中', decided: 'レース中', done: '発表済み', void: '取り消し' };
  const SUBS = [['today', '今日'], ['timetable', '時刻表'], ['tv', 'テレビ'], ['tuning', '調整'], ['racers', '選手'], ['stats', '集計']];
  const EDITS = ['timetable', 'tuning', 'racers']; // 保存ボタンのあるタブ
  const S = { sub: 'today', data: null, tt: null, tun: null, rc: null, open: new Set(), dirty: {}, err: {}, conflicts: [], loadErr: '', actErr: '', busy: false, seq: 0, gen: 0, on: false, ctx: null, main: null,
    stores: null, storesErr: '', st: { from: '', to: '', data: null, err: '', days: {} },
    gr: { code: '', who: null, n: '', note: '', err: '', msg: '' } }; // gr: BPT を付ける（2026-11-26）。who ＝ 確かめた人 { code, name, bal }
  const hm = (ms) => (window.DerbyCore ? DerbyCore.fmtBizTime(ms, 5) : new Date(ms).toTimeString().slice(0, 5));
  const errOf = (e, d) => (e && (e.body && e.body.message || e.message)) || d;
  let kSeq = 0; const nk = () => 'k' + (++kSeq);
  const addScript = (src) => new Promise((ok, ng) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ng(new Error(src + ' を読めませんでした')); document.head.appendChild(s); });
  const J9 = 9 * 3600000;
  const dayShift = (ds, k) => { const q = ds.split('-').map(Number); return new Date(Date.UTC(q[0], q[1] - 1, q[2] + k)).toISOString().slice(0, 10); };
  const bizToday = () => (window.DerbyCore ? DerbyCore.bizDate(Date.now(), 5) : new Date(Date.now() + J9 - 5 * 3600000).toISOString().slice(0, 10));
  const fmtDay = (ds) => { const p = ds.split('-').map(Number), w = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); return p[1] + '/' + p[2] + '（' + WD[w] + '）'; };
  // BPT の持ち上限（2026-11-20 オーナー決定「3,000 まで」）。数の置き場は v2/core.js の BPT_MAX。読めなければ 3,000
  const holdMax = () => { const v = Number((window.DerbyCore && DerbyCore.BPT_MAX) || (window.BoatCore && BoatCore.BPT_MAX)); return v > 0 ? v : 3000; };

  /* ---------- 時刻 ---------- */
  // 「1900」→ 19:00・「25」→ 25:00・「9:5」→ 09:05（競馬の時刻表と同じ整え方）。読めなければそのまま返す
  function normT(s) {
    s = String(s == null ? '' : s).trim().replace(/：/g, ':');
    let m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
    if (!m && /^\d{1,2}$/.test(s)) m = [0, s, '0'];
    if (!m && /^\d{3,4}$/.test(s)) m = [0, s.slice(0, -2), s.slice(-2)];
    return m ? String(+m[1]).padStart(2, '0') + ':' + String(+m[2]).padStart(2, '0') : s;
  }
  const tMin = (s) => { const m = /^(\d{2}):(\d{2})$/.exec(String(s || '')); return m && +m[2] < 60 ? +m[1] * 60 + +m[2] : NaN; };
  const tOk = (m) => m >= 5 * 60 && m < 29 * 60;
  const tHm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const TIME_MSG = '時刻は 05:00〜28:59 で入れてください（深夜は 24:00〜28:59）';

  /* ---------- 時刻表: 決まり（rules）⇔ 予定の札（tpls） ----------
     札 1 枚 ＝ { k, id, name, enabled, kind, weekdays, date, rows: [{ k, t, p }] }（p ＝ その行の目安。'' ＝ 初期値）。
     保存の形は競馬と同じ: 札の中で目安ごとに決まりを分け、同じ札の印（tpl）を付ける。印の無い決まり（前の画面で保存したもの）は 1 つで 1 枚 */
  function rulesToTpls(rules) {
    const out = [], by = {};
    (rules || []).forEach((r, i) => {
      const id = String(r.tpl || r.id || 'b' + (i + 1));
      let t = by[id];
      if (!t) { t = by[id] = { k: nk(), id, name: r.name || '', enabled: r.enabled !== false, kind: KIND[r.kind] ? r.kind : 'daily', weekdays: (r.weekdays || []).map(Number), date: r.date || '', rows: [], bulk: null }; out.push(t); }
      (r.races ? r.races : (r.times || []).map((x) => ({ time: x, payout: r.payout }))).forEach((x) => { const p = Number(x.payout) || 0; t.rows.push({ k: nk(), t: normT(x.time), p: p > 0 ? String(p) : '' }); });
    });
    out.forEach(sortRows);
    return out;
  }
  function tplsToRules(tpls) {
    const rules = [];
    tpls.forEach((t) => {
      const groups = new Map();
      t.rows.forEach((r) => { const p = Number(r.p) || 0; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(normT(r.t)); });
      if (!groups.size) groups.set(0, []);
      let i = 0;
      groups.forEach((times, p) => {
        const ts = times.slice().sort((a, b) => tMin(a) - tMin(b)), o = { id: i ? t.id + '~' + i : t.id, tpl: t.id, name: t.name || '', enabled: t.enabled !== false, kind: t.kind, times: ts, payout: p, races: ts.map((x) => ({ time: x, payout: p })) };
        if (t.kind === 'weekday') o.weekdays = t.weekdays.map(Number).sort();
        if (t.kind === 'date') o.date = t.date;
        rules.push(o); i++;
      });
    });
    return rules;
  }
  function sortRows(t) { t.rows.sort((a, b) => (tMin(a.t) || 0) - (tMin(b.t) || 0)); }
  const tplName = (t) => t.name || (t.kind === 'weekday' ? (t.weekdays.length ? [1, 2, 3, 4, 5, 6, 0].filter((d) => t.weekdays.indexOf(d) >= 0).map((d) => WD[d]).join('・') + '曜' : '曜日の予定') : t.kind === 'date' ? (t.date ? fmtDay(t.date) : '日付の予定') : t.kind === 'holiday' ? '祝日' : '毎日');
  function tplSummary(t) {
    const ms = t.rows.map((r) => tMin(r.t)).filter((m) => !isNaN(m));
    return KIND[t.kind] + '・' + t.rows.length + ' レース' + (ms.length ? '・' + tHm(Math.min.apply(null, ms)) + '〜' + tHm(Math.max.apply(null, ms)) : '') + (t.enabled ? '' : '・停止中');
  }
  // 保存の前の確かめ: { errs: { 札の k: 文 }, rows: { 行の k: 文 }, n }
  function checkTT() {
    const errs = {}, rows = {}; let n = 0;
    S.tt.forEach((t) => {
      const seen = {};
      if (t.kind === 'weekday' && !t.weekdays.length) { errs[t.k] = '曜日を 1 つ以上選んでください'; n++; }
      if (t.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) { errs[t.k] = '日付を選んでください'; n++; }
      t.rows.forEach((r) => {
        const m = tMin(normT(r.t)), p = String(r.p == null ? '' : r.p).trim();
        const e = isNaN(m) ? '時刻を入れてください' : !tOk(m) ? TIME_MSG : seen[m] ? '同じ時刻があります' : p !== '' && !(/^\d+$/.test(p) && +p >= 1) ? '目安は 1 以上の整数（空なら初期値）' : '';
        if (!isNaN(m)) seen[m] = 1;
        if (e) { rows[r.k] = e; n++; }
      });
    });
    return { errs, rows, n };
  }

  /* ---------- 時刻表: まとめて作る・おまかせ ---------- */
  const bulkOf = (t) => t.bulk || (t.bulk = { from: '19:00', to: '23:00', every: '30', pay: '' });
  function bulkCheck(b, needEvery) {
    const f = tMin(normT(b.from)), t = tMin(normT(b.to)), ev = Number(b.every), pay = String(b.pay == null ? '' : b.pay).trim();
    if (isNaN(f) || isNaN(t)) return { err: '開始と終了の時刻を入れてください（例 19:00）' };
    if (!tOk(f) || !tOk(t)) return { err: TIME_MSG };
    if (t < f) return { err: '終了は開始より後にしてください（深夜は 24:00〜28:59 と書きます）' };
    if (needEvery && !(ev >= 1 && ev <= 180 && Math.floor(ev) === ev)) return { err: '何分おきは 1〜180 の整数で入れてください' };
    if (pay !== '' && !(/^\d+$/.test(pay) && +pay >= 1)) return { err: '目安は 1 以上の整数で入れてください（空なら初期値）' };
    return { f, t, ev, pay };
  }
  // 札に時刻を足す（同じ時刻は飛ばす）→ { add, skip }
  function addTimes(t, mins, pay) {
    const have = new Set(t.rows.map((r) => tMin(normT(r.t)))); let add = 0, skip = 0;
    mins.forEach((m) => { if (have.has(m)) { skip++; return; } have.add(m); t.rows.push({ k: nk(), t: tHm(m), p: pay }); add++; });
    sortRows(t); return { add, skip };
  }
  /* おまかせ（2026-11-22 オーナー「ボートは、競馬と被んない時間で、ざっくり 1 時間に 1 回みたいなのを勝手に設定してくれればいい」）:
     開始〜終了を 1 時間ずつに区切り、それぞれの 1 時間の中で「先 14 日のどの日の競馬（投票〜結果画面の最初の 2 分）とも、今ある予定のボートとも重ならない」最初の時刻を 1 つ選ぶ
     （きりのいい時刻 ＝ 10 分・5 分の刻みを先に見る。空きが無い 1 時間は飛ばす）。最後に保存のときと同じ調べ方（BoatCore.conflicts）でもう一度見て、引っかかった時刻は外す。
     返事 ＝ { mins, none: [入らなかった時間帯] } か { err }。計算の部品（core.js・boat-core.js）が無い画面では読み込む */
  async function autoPick(b, tpls, cfgSaved, api) {
    const c0 = bulkCheck(b, false); if (c0.err) return c0;
    const f = c0.f, t = c0.t;
    if (!window.DerbyCore) await addScript('core.js'); if (!window.BoatCore) await addScript('boat-core.js');
    const Core = window.DerbyCore, Boat = window.BoatCore, dc = (await api('config')) || {};
    const dRules = (dc.timetable && dc.timetable.rules) || [], T = Core.tuningOf(dc.tuning || {}), hh = T.dayStartHour, now = Date.now(), cfg = cfgSaved;
    const mine = tplsToRules(tpls).filter((r) => r.races.length && r.races.every((x) => tOk(tMin(x.time)))), one = (time) => ({ id: 'auto', enabled: true, kind: 'daily', races: [{ time, payout: 0 }], payout: 0 });
    const d0 = Core.bizDate(now, hh), days = [];
    for (let k = 0; k < 14; k++) {
      const ds = dayShift(d0, k), base = Core.expandDate(ds, [one('12:00')])[0].at - 720 * 60000, busy = [];
      [-1, 0, 1].forEach((j) => { const x = dayShift(ds, j); Core.expandDate(x, dRules).forEach((d) => busy.push(Boat.derbySpan(d.at, T))); Core.expandDate(x, mine).forEach((m) => busy.push(Boat.boatSpan(m.at, cfg))); });
      days.push({ base, busy });
    }
    const picked = [], free = (m) => !(Boat.quietSpanMin ? Boat.quietSpanMin(m, hh, cfg) : Boat.quietMin(m, hh)) && days.every((d) => { const s = Boat.boatSpan(d.base + m * 60000, cfg); return !d.busy.some((x) => s[0] < x[1] && x[0] < s[1]) && !picked.some((q) => { const y = Boat.boatSpan(d.base + q * 60000, cfg); return s[0] < y[1] && y[0] < s[1]; }); });
    const none = [];
    for (let H = f; H <= t; H += 60) {
      const c = []; for (let m = H; m <= Math.min(H + 59, t); m++) c.push(m);
      c.sort((x, y) => (x % 10 ? (x % 5 ? 2 : 1) : 0) - (y % 10 ? (y % 5 ? 2 : 1) : 0) || x - y);
      const hit = c.find(free); if (hit == null) none.push(tHm(H) + '〜'); else picked.push(hit);
    }
    const keyOf = (x) => x.date + ' ' + x.boat, base = new Set(Boat.conflicts(mine, dRules, T, cfg, now, 14).map(keyOf));
    for (let k = 0; k < 30 && picked.length; k++) {
      const rule = Object.assign(one('12:00'), { races: picked.map((m) => ({ time: tHm(m), payout: 0 })) });
      const bad = new Set(Boat.conflicts(mine.concat([rule]), dRules, T, cfg, now, 14).filter((x) => !base.has(keyOf(x))).map((x) => x.boat));
      const i = picked.findIndex((m) => bad.has(tHm(m))); if (i < 0) break;
      none.push(tHm(picked[i]) + '（先の日の競馬と重なる）'); picked.splice(i, 1);
    }
    picked.sort((x, y) => x - y);
    if (!picked.length) return { err: '競馬と被らない時刻が見つかりませんでした（' + tHm(f) + '〜' + tHm(t) + '）' };
    return { mins: picked, pay: c0.pay, none };
  }

  /* ---------- 調整 ---------- */
  // ボートを始める日・時刻: 設定の startAt（ms。0 ＝ 決めていない）⇔ 画面の日付と時刻（日本の時刻）。日付が空 ＝ 決めていない。時刻が空なら 0:00
  const startParts = (ms) => { if (!(Number(ms) > 0)) return { d: '', t: '' }; const s = new Date(Number(ms) + J9).toISOString(); return { d: s.slice(0, 10), t: s.slice(11, 16) }; };
  const startMs = (d, t) => { const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')), b = /^(\d{1,2}):(\d{2})$/.exec(String(t || '') || '00:00'); return a && b ? Date.UTC(+a[1], +a[2] - 1, +a[3], +b[1], +b[2]) - J9 : 0; };
  const startText = (ms) => { const p = startParts(ms); return p.d ? Number(p.d.slice(5, 7)) + '月' + Number(p.d.slice(8, 10)) + '日 ' + p.t : ''; };
  function tunOf(cfg) { const sp = startParts(cfg.startAt); return { target: cfg.target, capRace: cfg.capRace, capDay: cfg.capDay, voteSec: cfg.voteSec, resultSec: cfg.resultSec, incidentOn: Number(cfg.incidentOn) > 0 ? 1 : 0, startDate: sp.d, startTime: sp.t }; }
  const checkTun = (c) => (String(c.target == null ? '' : c.target).trim() === '' || !(Number(c.target) >= 0) ? '1 レースの目安（初期値）を入れてください（空にはできません）' : '');
  // 大小の注意（保存は止めない）: 1 レース上限＞1 日上限・目安（初期値）＞1 レース上限
  function tunWarn(c) {
    const cr = Number(c.capRace), cd = Number(c.capDay), out = [];
    if (cr > 0 && cd > 0 && cr > cd) out.push('1 レース上限（' + amt(cr) + '）が 1 日上限（' + amt(cd) + '）より大きくなっています');
    if (cr > 0 && Number(c.target) > cr) out.push('1 レースの目安（初期値 ' + amt(c.target) + '）が 1 レース上限（' + amt(cr) + '）より大きくなっています');
    return out.map((w) => '<li>' + esc(w) + '</li>').join('');
  }

  /* ---------- 選手 ---------- */
  const R_CLS = ['A1', 'A2', 'B1', 'B2'], R_TYPES = [['nige', '逃げ'], ['senko', 'まくり'], ['sashi', '差し'], ['oikomi', 'まくり差し']], R_LV = [1, 2, 3, 4, 5].map((n) => [n, '★' + n]);
  const R_MAE = [[0.05, 'ほぼしない'], [0.1, 'まれに'], [0.15, 'ときどき'], [0.25, 'わりとする'], [0.3, 'よくする'], [0.35, 'かなりする'], [0.4, 'とてもよくする']];
  const R_ST = []; for (let v = 10; v <= 25; v++) R_ST.push([v / 100, (v / 100).toFixed(2)]);
  const R_MIN = 6, R_MAX = 40;
  const racerDefault = () => ((window.BoatModel && BoatModel.POOL) || []).map((h) => ({ name: h.name, yomi: h.yomi || '', type: h.type, cls: h.cls, st: h.st, spd: h.spd, sta: h.sta, pow: h.pow, mae: h.mae }));
  const racerKey = (L) => JSON.stringify(L.map((h) => [h.name, h.yomi || '', h.type, h.cls, Number(h.st), Number(h.spd), Number(h.sta), Number(h.pow), Number(h.mae), !!h.off]));
  const rcOf = (cfg) => (Array.isArray(cfg.racers) && cfg.racers.length ? cfg.racers : racerDefault()).map((h) => Object.assign({ k: nk() }, h, { off: !!h.off }));
  const rcClean = (L) => L.map((h) => { const o = { name: String(h.name || '').trim(), yomi: String(h.yomi || '').trim(), type: h.type, cls: h.cls, st: Number(h.st), spd: Number(h.spd), sta: Number(h.sta), pow: Number(h.pow), mae: Number(h.mae) }; if (h.off) o.off = true; return o; });
  function checkRc() {
    const errs = {}, cnt = {}; let n = 0;
    S.rc.forEach((h) => { const nm = String(h.name || '').trim(); cnt[nm] = (cnt[nm] || 0) + 1; });
    S.rc.forEach((h) => { const nm = String(h.name || '').trim(), e = nm.length < 2 || nm.length > 8 ? '名前は 2〜8 文字で入れてください' : /[<>&"']/.test(nm) ? '名前に使えない記号があります' : cnt[nm] > 1 ? '同じ名前の選手がいます' : ''; if (e) { errs[h.k] = e; n++; } });
    const on = S.rc.filter((h) => !h.off).length;
    return { errs, n, on, msg: n ? 'まちがいが ' + n + ' つあります' : on < R_MIN ? '出走する選手は ' + R_MIN + ' 人以上にしてください（いま ' + on + ' 人）' : S.rc.length > R_MAX ? '選手は ' + R_MAX + ' 人までです' : '' };
  }

  /* ---------- 小分けの処理が失敗し続けている印（お金の係。boatConfig の返事の stuck。続けて 3 回以上を赤字で） ---------- */
  const STEP = { decide: '決める', reveal: '発表・BPT を入れる', void: '取り消しの戻し' };
  const stuckOf = (x) => (x && Number(x.n) >= 3 ? x : null);
  const stuckText = (x) => (STEP[x.step] || x.step || '処理') + ' が ' + amt(x.n) + ' 回続けて失敗' + (x.err ? '（' + x.err + '）' : '');

  /* ---------- 画面 ---------- */
  const opts = (list, cur) => { let hit = false; const h = list.map(([v, l]) => { const on = String(v) === String(cur); if (on) hit = true; return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); return (hit || cur == null || cur === '' ? '' : '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>') + h; };
  const dis = () => (S.busy ? ' disabled' : '');
  const savebar = (sub, msgId) => '<div class="savebar"><div class="msg" id="' + msgId + '">' + (S.err[sub] ? '<div class="err">' + esc(S.err[sub]) + '</div>' : '') + '</div><button type="button" class="btn ghost" data-act="revert"' + dis() + '>元に戻す</button><button type="button" class="btn" data-act="save"' + dis() + '>保存</button></div>';

  /* 当たった人（2026-11-26 オーナー「誰がいつ当たったか見れるように」）: 発表したレースの下に、名前・店・足した BPT を並べる。
     中身は発表のときにレースに書く winners（v2/boat-firestore.js の revealOne。名前・店・当たりの額・実際に増えた分・上限で止まった印）。ボートは会計札を聞かないので名前と店だけ */
  function winRow(r, cols) {
    if (!r || r.status !== 'done') return '';
    const ws = r.winners || [];
    const body = ws.length ? ws.map((w) => '<span class="bwin"><b>' + esc(w.nick || '（名前なし）') + '</b> <small>' + esc(w.storeName || w.storeId || '') + '</small> +' + amt(w.gain != null ? w.gain : w.amount) + ' BPT' + (w.capped ? ' <small class="hint">（上限で ' + amt(w.amount) + ' → ' + amt(w.gain) + '）</small>' : '') + '</span>').join('')
      : '<span class="hint">当たった人なし</span>';
    return '<tr class="bwins"><td colspan="' + cols + '"><small class="hint">当たった人 ' + ws.length + '人</small> ' + body + '</td></tr>';
  }
  (function () { if (document.getElementById('bwinCss')) return; const st = document.createElement('style'); st.id = 'bwinCss'; st.textContent = '.boatadm tr.bwins td{padding-top:2px;line-height:1.9}.boatadm .bwin{display:inline-block;margin:0 14px 0 6px;white-space:nowrap}'; document.head.appendChild(st); })();
  function viewToday() {
    const d = S.data, cfg = d.cfg;
    const stuck = (d.stuck || []).filter(stuckOf), todayIds = new Set((d.races || []).map((r) => r.id)), stuckOther = stuck.filter((x) => !todayIds.has(x.id)); // 今日の一覧に無いレース（前の日の発表待ちなど）は上にまとめて出す
    const races = (d.races || []).map((r) => '<tr><td><b>' + hm(r.at) + '</b>' + (r.test ? ' <small class="hint">テスト</small>' : '') + '</td><td>' + (ST[r.status] || r.status) + '</td><td class="n">' + ((r.participants && r.participants.total) || 0) + '人 / 券 ' + ((r.participants && r.participants.tickets) || 0) + '</td>' +
      '<td class="n">' + amt(r.paid || (r.decision && r.decision.paid) || 0) + ' / ' + amt(r.target) + ' BPT</td><td>' + (r.result ? r.result.combo.split('-').map((x) => Number(x) + 1).join(' → ') + '（' + r.result.odds + '倍）' : '') +
      (stuckOf(r.stuck) || stuck.find((x) => x.id === r.id) ? '<div class="err boatstuck">' + esc(stuckText(stuckOf(r.stuck) || stuck.find((x) => x.id === r.id))) + '</div>' : '') + '</td>' +
      '<td>' + (r.status !== 'done' && r.status !== 'void' ? '<button class="btn sm ghost" data-void="' + esc(r.id) + '"' + dis() + '>取り消す</button>' : '') + '</td></tr>' + winRow(r, 6)).join('');
    const start = Number(cfg.startAt) > Date.now() ? '<p class="hint"><b class="boatstart">ボートは ' + esc(startText(cfg.startAt)) + ' から始まります（「調整」の「ボートを始める日」）</b></p>' : '';
    return '<div class="boatadm" data-sub="today"><div class="panel"><h3>今日のボート <button type="button" class="btn sm ghost" data-act="reload"' + dis() + '>最新にする</button></h3>' +
      '<p class="hint">今日使った BPT ' + amt(d.used) + ' / 1 日上限 ' + amt(cfg.capDay) + '（発表待ちのレースの分も入っています）</p>' + start + // 使った分は「決めた」ときに数える（発表の前でも 1 日の上限に入る。2026-11-20）
      (!cfg.rules.length ? '<p class="hint">時刻表がまだ空です。「時刻表」で予定を作ると、お店のテレビとスマホにボートが出ます。</p>' : '') +
      (stuckOther.length ? '<div class="err boatstuck"><b>処理が止まっているボートのレース</b><ul>' + stuckOther.map((x) => '<li>' + esc((x.at ? hm(x.at) + ' ' : '') + x.id + ': ' + stuckText(x)) + '</li>').join('') + '</ul></div>' : '') +
      (races ? '<div class="tbl"><table class="cards"><tr class="hd"><th>締切</th><th>状態</th><th class="n">参加</th><th class="n">払った / 目安</th><th>結果（1着 → 2着）</th><th></th></tr>' + races + '</table></div>' : '<div class="empty">今日のボートのレースはまだありません</div>') +
      '<div class="acts l"><button type="button" class="btn sm ghost" data-act="test"' + dis() + '>すぐ始めるボートレース（2 分後に締切・確かめ用）</button></div>' +
      (S.actErr ? '<p class="err boatact">' + esc(S.actErr) + '</p>' : '') + (S.loadErr ? '<p class="err boatload">' + esc(S.loadErr) + '</p>' : '') + '</div></div>';
  }

  function tplHtml(t, i, v, n) {
    const open = S.open.has(t.id), b = bulkOf(t), cfg = S.data.cfg;
    const cond = t.kind === 'weekday' ? '<div class="wdays">' + [1, 2, 3, 4, 5, 6, 0].map((d) => '<label class="' + (t.weekdays.indexOf(d) >= 0 ? 'on' : '') + '"><input type="checkbox" data-wd="' + d + '"' + (t.weekdays.indexOf(d) >= 0 ? ' checked' : '') + '>' + WD[d] + '</label>').join('') + '</div>'
      : t.kind === 'date' ? '<input type="date" data-tf="date" value="' + esc(t.date) + '">'
      : t.kind === 'holiday' ? '<div class="hint" style="margin:0;padding-top:18px">祝日は自動で判定します（振替休日・国民の休日を含む）</div>'
      : '<div class="hint" style="margin:0;padding-top:18px">祝日・曜日・日付の予定がない日に使います</div>';
    const bad = (v.errs[t.k] ? 1 : 0) + t.rows.filter((r) => v.rows[r.k]).length;
    return '<div class="tpl' + (t.enabled ? '' : ' off') + (open ? ' open' : '') + (bad ? ' has-err' : '') + '" data-tk="' + t.k + '">' +
      '<div class="tpl-top"><button type="button" class="open-btn" data-act="tpl-open" aria-expanded="' + open + '"><b data-tname>' + esc(tplName(t)) + '</b><span class="sum" data-sum>' + esc(tplSummary(t)) + '</span><span class="chip ng" data-terrn' + (bad ? '' : ' hidden') + '>要確認 ' + bad + '</span><span class="ol"></span></button>' +
      '<button type="button" class="btn xs onoff' + (t.enabled ? ' on' : '') + '" data-act="tpl-on" title="押すと切り替え">' + (t.enabled ? 'ON 使用中' : 'OFF 停止中') + '</button></div>' +
      '<div class="tpl-body">' +
      '<div class="tpl-head"><input type="text" class="name" data-tf="name" value="' + esc(t.name) + '" placeholder="' + esc(tplName(Object.assign({}, t, { name: '' }))) + '" maxlength="30" aria-label="予定の名前">' +
      '<span class="chip info" data-cnt>' + t.rows.length + ' レース</span>' +
      '<button type="button" class="icon" data-act="tpl-up" aria-label="上へ"' + (i ? '' : ' disabled') + '>↑</button><button type="button" class="icon" data-act="tpl-down" aria-label="下へ"' + (i < n - 1 ? '' : ' disabled') + '>↓</button>' +
      '<button type="button" class="btn xs ghost" data-act="tpl-dup">コピー</button><button type="button" class="icon del" data-act="tpl-del" aria-label="この予定を消す">×</button></div>' +
      '<div class="tpl-cond v4"><label class="f"><span>いつ</span><select data-tf="kind">' + opts([['daily', '毎日'], ['weekday', '曜日を選ぶ'], ['date', '日付を選ぶ'], ['holiday', '祝日']], t.kind) + '</select></label>' +
      '<div class="f">' + (t.kind === 'weekday' || t.kind === 'date' ? '<span class="hint" style="display:block;margin:0 0 4px">' + (t.kind === 'weekday' ? '曜日' : '日付') + '</span>' : '') + cond + '</div></div>' +
      '<div class="err" data-terr>' + esc(v.errs[t.k] || '') + '</div>' +
      '<div class="bulk"><b class="bt">まとめて作る</b>' +
      '<label class="f"><span>開始</span><input type="text" inputmode="numeric" class="tm" data-bf="from" value="' + esc(b.from) + '" placeholder="19:00"></label><span class="t">〜</span>' +
      '<label class="f"><span>終了</span><input type="text" inputmode="numeric" class="tm" data-bf="to" value="' + esc(b.to) + '" placeholder="23:00"></label>' +
      '<label class="f"><span>何分おき</span><input type="number" data-bf="every" value="' + esc(b.every) + '" min="1" max="180"></label>' +
      '<label class="f"><span>目安（BPT）</span><input type="number" data-bf="pay" value="' + esc(b.pay) + '" placeholder="' + esc(cfg.target) + '" min="1" step="100"></label>' +
      '<button type="button" class="btn sm ghost" data-act="bulk"' + dis() + '>まとめて作る</button>' +
      '<button type="button" class="btn sm" data-act="auto"' + dis() + '>おまかせ（1 時間に 1 回）</button></div>' +
      '<p class="hint" style="margin:4px 0 0">「おまかせ」は、開始〜終了の間で、競馬と被らない時刻を 1 時間に 1 つずつ選びます（何分おき は使いません）。</p>' +
      '<div class="tbl"><table class="tt-rows"><tr class="hd"><th class="no">#</th><th class="th-t">締切の時刻</th><th class="th-p">1 レースの目安（BPT）</th><th></th><th></th></tr>' +
      (t.rows.length ? t.rows.map((r, j) => '<tr data-rk="' + r.k + '"><td class="no">' + (j + 1) + '</td><td class="tdt"><input type="text" inputmode="numeric" class="tm" data-rf="t" value="' + esc(r.t) + '" placeholder="21:30" aria-label="締切の時刻"></td>' +
        '<td class="tdp"><input type="number" class="pay" data-rf="p" value="' + esc(r.p) + '" placeholder="' + esc(cfg.target) + '" min="1" step="100" inputmode="numeric" aria-label="1 レースの目安"></td><td class="msg err" data-rerr>' + esc(v.rows[r.k] || '') + '</td>' +
        '<td class="ops"><button type="button" class="icon" data-act="row-dup" aria-label="この行をコピー" title="この行をコピー（1 時間あと）">⧉</button><button type="button" class="icon del" data-act="row-del" aria-label="この行を消す" title="この行を消す">×</button></td></tr>').join('')
        : '<tr><td colspan="5" class="empty">まだレースがありません。上の「まとめて作る」か「おまかせ」で入れてください</td></tr>') +
      '</table></div>' +
      '<div class="acts l" style="margin-top:6px"><button type="button" class="btn sm ghost" data-act="row-add">＋ 1 行追加</button><button type="button" class="btn xs ghost" data-act="row-sort">時刻順に並べる</button><button type="button" class="btn xs ghost" data-act="row-payall">目安を全部そろえる</button><button type="button" class="btn xs ghost" data-act="row-clear"' + (t.rows.length ? '' : ' disabled') + '>全部消す</button></div>' +
      '</div></div>';
  }
  function viewTT() {
    const d = S.data, cfg = d.cfg, v = checkTT(), cs = (S.conflicts.length ? S.conflicts : d.conflicts || []).slice(0, 12);
    return '<div class="boatadm" data-sub="timetable"><div class="panel"><h3>ボートの時刻表を変える</h3>' +
      '<p class="hint">時刻は<b>投票の締切（映像の始まり）</b>。投票はその ' + Math.round(cfg.voteSec / 60 * 10) / 10 + ' 分前から。ボートはいつも<b>全店同時</b>です。1 レースはおよそ ' + Math.ceil((cfg.voteSec + 6 + 190 + cfg.resultSec) / 60) + ' 分。</p>' +
      '<p class="hint nightnote" style="margin-bottom:0">深夜は <b>24:00〜28:59</b> と書きます（25:00 ＝ 深夜 1 時）。</p>' +
      '<details class="fold"><summary>くわしく</summary><div class="in">' +
      '<p class="hint">競馬と被る時刻（競馬の投票〜結果画面の最初の 2 分）と、朝 5 時の前後（4 時半〜5 時半ごろ）は保存できません。断られた理由は赤字で出ます。</p>' +
      '<p class="hint">数字だけ打っても整えます（「1900」→ 19:00・「25」→ 25:00）。</p>' +
      '<p class="hint">1 レースの目安＝そのレースで当たった人に足す BPT の合計の目安。空なら「調整」の初期値（いま ' + amt(cfg.target) + '）。</p>' +
      '<p class="hint">その日に<b>日付の予定があればそれだけ → なければ祝日 → なければ曜日 → なければ毎日</b>を使います。</p>' +
      '<p class="hint">保存すると、まだ作られていないこれからのレースに反映されます。「調整」の「ボートを始める日」より前のレースは出ません。</p>' +
      '</div></details>' +
      (cs.length ? '<div class="err boatcs"><b>競馬と被る・近すぎる時刻</b><ul>' + cs.map((c) => '<li>' + esc(c.text) + '</li>').join('') + '</ul></div>' : '') + '</div>' +
      (S.tt.length ? S.tt.map((t, i) => tplHtml(t, i, v, S.tt.length)).join('') : '<div class="panel"><div class="empty">まだ予定がありません。下のボタンで作ってください。</div></div>') +
      '<div class="acts l"><button type="button" class="btn ghost" data-act="tpl-add" data-kind="daily">＋ 毎日の予定</button><button type="button" class="btn ghost" data-act="tpl-add" data-kind="weekday">＋ 曜日の予定</button><button type="button" class="btn ghost" data-act="tpl-add" data-kind="date">＋ 日付の予定</button><button type="button" class="btn ghost" data-act="tpl-add" data-kind="holiday">＋ 祝日の予定</button></div>' +
      savebar('timetable', 'bttMsg') + '</div>';
  }

  function viewTuning() {
    const d = S.data, cfg = d.cfg, c = S.tun;
    const num = (k, lab, unit, hint, attrs) => '<label class="fld"><span>' + lab + '</span><input type="number" inputmode="numeric" data-k="' + k + '" value="' + esc(c[k]) + '"' + (attrs || '') + '><small>' + unit + '</small>' + (hint ? '<small class="hint"> ' + hint + '</small>' : '') + '</label>';
    const CAP = ' min="100" step="100"', capHint = '100 以上（0 や空にはできません）'; // 上限は必ず入れる（2026-11-20。v2/boat-core.js の CAP_MIN）
    return '<div class="boatadm" data-sub="tuning">' +
      '<div class="panel"><h3>払う BPT</h3><div class="flds">' + num('target', '1 レースの目安（初期値）', 'BPT', '時刻表の行の目安が空のとき（空にはできません）') + num('capRace', '1 レース上限', 'BPT', capHint, CAP) + num('capDay', '1 日上限', 'BPT', capHint, CAP) + '</div>' +
      '<ul class="boatwarn" id="boatWarn">' + tunWarn(c) + '</ul>' +
      '<p class="hint">お客さんが貯められる BPT は ' + amt(holdMax()) + ' まで（持ち上限。当たりで超える分は ' + amt(holdMax()) + ' で止まり、消えます。毎週月曜の朝 5 時にリセット）</p></div>' + // 2026-11-20 オーナー決定
      '<div class="panel"><h3>時間</h3><div class="flds">' + num('voteSec', '投票の長さ', '秒') + num('resultSec', '結果画面の長さ', '秒') + '</div></div>' +
      '<div class="panel"><h3>ボートを始める日</h3><div class="flds"><label class="fld"><span>始める日</span><input type="date" data-k="startDate" class="sd" value="' + esc(c.startDate) + '"></label><label class="fld"><span>時刻</span><input type="time" data-k="startTime" class="sd" value="' + esc(c.startTime) + '"></label></div>' +
      '<p class="hint">この日・時刻より前は、時刻表にあってもボートを出しません。空なら、時刻表を保存したらすぐ始まります。' + (Number(cfg.startAt) > 0 ? '<b class="boatstart">' + (Number(cfg.startAt) > Date.now() ? ' いまの設定: ' + esc(startText(cfg.startAt)) + ' から始まります' : ' いまの設定: ' + esc(startText(cfg.startAt)) + ' から（もう始まっています）') + '</b>' : '') + '</p></div>' +
      '<div class="panel"><h3>フライング・転覆</h3><div class="flds"><label class="fld"><input type="checkbox" data-c="incidentOn"' + (Number(c.incidentOn) > 0 ? ' checked' : '') + '><span>フライング・転覆を出す（本物の率: フライング 1.6%・転覆など 4.6%）</span></label></div>' +
      '<p class="hint">フライング・転覆の艇を含む券は、いつも返還します（BPT の券は BPT を戻します）</p></div>' + // 2026-11-20 オーナー決定: いつも返還
      savebar('tuning', 'btuMsg') + '</div>';
  }

  /* 画質の 5 段（2026-11-23 オーナー「ボートの画質 競馬と同じぐらい細かく」。名前は競馬のテレビのタブと同じ）。保存する値は max・std・auto・lite・min（前の値 high ＝ std・low ＝ lite） */
  const BQ = [['min', '最もなめらか'], ['lite', 'さらになめらか'], ['auto', 'なめらか優先'], ['std', '標準'], ['max', 'きれい優先']];
  const bqOf = (v) => (v === 'max' || v === 'auto' || v === 'lite' || v === 'min' ? v : v === 'low' ? 'lite' : 'std');
  const bqNow = (cfg, id) => bqOf((cfg.tvqs && cfg.tvqs[id]) || cfg.tvq);
  function viewTv() {
    const cfg = S.data.cfg, L = S.stores;
    const rows = !L ? '<div class="empty">' + (S.storesErr ? esc(S.storesErr) : '読み込み中…') + '</div>' : !L.length ? '<div class="empty">店舗がまだありません</div>'
      : L.map((s) => { const q = bqNow(cfg, s.id); return '<div class="tvrow" data-store="' + esc(s.id) + '"><div class="nm">' + esc(s.name || s.id) + '</div><div class="tvq"><span>画質</span><div class="seg q5r" role="group" aria-label="' + esc(s.name || s.id) + 'のボートの画質">' +
        BQ.map(([v, l]) => '<button type="button" class="' + (q === v ? 'on' : '') + '" aria-pressed="' + (q === v) + '" data-act="tvq" data-q="' + v + '"' + dis() + '>' + l + '</button>').join('') + '</div></div></div>'; }).join('');
    return '<div class="boatadm" data-sub="tv"><div class="panel"><h3>ボートの映像の画質 <small class="qsub">店ごと</small></h3>' +
      '<p class="hint">押すとすぐ保存し、その店の<b>次のボートの映像</b>から変わります。</p>' + rows +
      '<ul class="qnotes"><li><b>最もなめらか</b>いちばん軽い。観客・木・旗を出さず、絵も粗くなります</li><li><b>さらになめらか</b>動きが重いテレビ向け。艇や水しぶきが少し粗くなり、影を出しません</li><li><b>なめらか優先</b>重いときだけ自動で少し粗くして、動きをなめらかに</li><li><b>標準</b>ふだんはこれ</li><li><b>きれい優先</b>ふちまでくっきり。動きがカクカクすることがあります</li></ul>' +
      (S.err.tv ? '<p class="err">' + esc(S.err.tv) + '</p>' : '') + '</div>' +
      '<div class="panel quiet"><p class="hint">テレビの切り替え（SLOT・DERBY）・読み込み直し・進行役は、いちばん上の <b>casa DERBY</b> →「テレビ」にあります（ボートも同じテレビに出ます）。</p></div></div>';
  }

  function rcRow(h, i, v) {
    const sel = (f, list, cur, lab) => '<label class="brc-f"><span>' + lab + '</span><select data-hf="' + f + '">' + opts(list, cur) + '</select></label>';
    return '<div class="brc-row' + (h.off ? ' off' : '') + '" data-hk="' + h.k + '"><div class="brc-no" aria-hidden="true">' + (i + 1) + '</div>' +
      '<label class="brc-f brc-name"><span>名前</span><input type="text" data-hf="name" value="' + esc(h.name) + '" maxlength="8" autocomplete="off" spellcheck="false" placeholder="例: 河野 流"></label>' +
      '<label class="brc-f brc-yomi"><span>よみ</span><input type="text" data-hf="yomi" value="' + esc(h.yomi) + '" maxlength="24" autocomplete="off" spellcheck="false" placeholder="かわの ながれ"></label>' +
      sel('cls', R_CLS.map((x) => [x, x]), h.cls, '級') + sel('type', R_TYPES, h.type, '得意') +
      '<div class="brc-ops"><button type="button" class="btn xs onoff' + (h.off ? '' : ' on') + '" data-act="rc-on" title="押すと切り替え">' + (h.off ? '休み' : '出走') + '</button><button type="button" class="btn xs ghost" data-act="rc-del">削除</button></div>' +
      '<div class="brc-st">' + sel('spd', R_LV, h.spd, 'スタート') + sel('sta', R_LV, h.sta, 'ターン') + sel('pow', R_LV, h.pow, '伸び') + sel('st', R_ST, Number(h.st).toFixed(2) * 1, '平均 ST') + sel('mae', R_MAE, h.mae, '前付け') + '</div>' +
      '<div class="brc-err err" data-he' + (v.errs[h.k] ? '' : ' hidden') + '>' + esc(v.errs[h.k] || '') + '</div></div>';
  }
  function viewRacers() {
    if (!S.rc) return '<div class="boatadm" data-sub="racers"><div class="panel"><h3>選手</h3><div class="empty">' + (S.err.racers ? esc(S.err.racers) : '読み込み中…') + '</div></div></div>';
    const v = checkRc(), custom = racerKey(rcClean(S.rc)) !== racerKey(racerDefault());
    return '<div class="boatadm" data-sub="racers"><div class="panel" id="racerPanel"><h3>出走する選手 <small class="qsub">全店共通</small></h3>' +
      '<p class="hint">レースごとに、<b>出走</b>の選手から 6 人を選んで走らせます。<b>休み</b>にした選手は一覧に残して走らせません。保存すると<b>これから作るレース</b>から使われます（作ってあるレースは前の選手のまま）。</p>' +
      '<p class="hint">級・★・平均 ST は走りに効きます（平均 ST は小さいほどスタートが早い）。前付け＝内のコースを取りに動きやすさ。新しい名前は、実況では「○号艇」と番号で読みます。</p>' +
      '<div class="hrs-sum" id="brcSum">出走 <b>' + v.on + '</b> 人・休み ' + (S.rc.length - v.on) + ' 人（全部で ' + S.rc.length + ' 人）</div>' +
      '<div class="brc-list" id="brcList">' + S.rc.map((h, i) => rcRow(h, i, v)).join('') + '</div>' +
      '<div class="acts l"><button type="button" class="btn ghost" data-act="rc-add"' + (S.rc.length >= R_MAX ? ' disabled' : '') + '>＋ 選手を追加</button>' + (custom ? '<button type="button" class="btn link" data-act="rc-default">初期の 18 人に戻す</button>' : '') + '</div></div>' +
      savebar('racers', 'brcMsg') + '</div>';
  }

  const stQuick = (q) => { const t = bizToday(); return q === 'today' ? [t, t] : q === 'yday' ? [dayShift(t, -1), dayShift(t, -1)] : q === 'month' ? [t.slice(0, 8) + '01', t] : [dayShift(t, -(Number(q) - 1)), t]; };
  /* BPT を付ける（2026-11-26 オーナー決定。LINE でログインした人の会員 ID に、遠隔で BPT を付ける）: ID を入れて「確かめる」→ 名前と今の残りを見てから、数と理由を入れて「付ける」。
     記録は derbyBptGrants（誰に・いくつ・理由・いつ）。付けたあとの残りは持ち上限まで（超える分は付かない） */
  function grantHtml() {
    const g = S.gr, w = g.who;
    return '<div class="panel bgrant"><h3>BPT を付ける</h3>' +
      '<div class="grrow"><label class="f"><span>会員 ID</span><input type="text" id="grCode" data-gr="code" value="' + esc(g.code) + '" placeholder="C-4821" autocomplete="off" inputmode="text" maxlength="12"></label>' +
      '<button type="button" class="btn sm ghost" data-act="gr-look">確かめる</button></div>' +
      '<div id="grWho">' + (w ? '<p class="grw"><b>' + esc(w.name || '（名前なし）') + '</b>（' + esc(w.code) + '）・いまの BPT <b>' + amt(w.bal) + '</b></p>' +
        '<div class="grrow"><label class="f"><span>付ける BPT</span><input type="number" id="grN" data-gr="n" value="' + esc(g.n) + '" min="1" max="' + holdMax() + '" step="1" inputmode="numeric"></label>' +
        '<label class="f grnote"><span>理由</span><input type="text" id="grNote" data-gr="note" value="' + esc(g.note) + '" maxlength="100" placeholder="例: 不具合のおわび"></label></div>' +
        '<button type="button" class="btn sm" data-act="gr-give">付ける</button></div>' : '') + '</div>' +
      (g.err ? '<div class="err">' + esc(g.err) + '</div>' : '') + (g.msg ? '<p class="hint grmsg">' + esc(g.msg) + '</p>' : '') +
      '<p class="hint">持てる BPT は ' + amt(holdMax()) + ' まで（超える分は付きません）。付けた記録は残ります。</p></div>';
  }
  function viewStats() {
    const st = S.st, days = (st.data && st.data.days) || [], tot = days.reduce((a, x) => ({ races: a.races + x.races, paid: a.paid + x.paid }), { races: 0, paid: 0 });
    const qOn = (q) => { const r = stQuick(q); return r[0] === st.from && r[1] === st.to; };
    const dayRaces = (x) => {
      const o = st.days[x.day]; if (!o) return '';
      const body = o.err ? '<div class="err">' + esc(o.err) + '</div>' : !o.races ? '<div class="empty">読み込み中…</div>' : !o.races.length ? '<div class="empty">この日のレースはありません</div>'
        : '<table class="cards"><tr class="hd"><th>締切</th><th>状態</th><th class="n">参加</th><th class="n">払った BPT</th><th>結果（1着 → 2着）</th></tr>' + o.races.map((r) => '<tr><td><b>' + hm(r.at) + '</b>' + (r.test ? ' <small class="hint">テスト</small>' : '') + '</td><td>' + (ST[r.status] || r.status) + '</td><td class="n">' + ((r.participants && r.participants.total) || 0) + '人 / 券 ' + ((r.participants && r.participants.tickets) || 0) + '</td><td class="n">' + amt(r.paid) + '</td><td>' + (r.result ? r.result.combo.split('-').map((y) => Number(y) + 1).join(' → ') + '（' + r.result.odds + '倍）' : '') + '</td></tr>' + winRow(r, 5)).join('') + '</table>';
      return '<tr class="bst-day"><td colspan="3"><div class="tbl">' + body + '</div></td></tr>';
    };
    return '<div class="boatadm" data-sub="stats">' + grantHtml() + '<div class="panel"><h3>ボートの集計を見る</h3>' +
      '<div class="quick">' + [['today', '今日'], ['yday', '昨日'], ['7', '7 日'], ['month', '今月'], ['31', '31 日']].map((q) => '<button type="button" class="btn sm ghost" data-act="stq" data-q="' + q[0] + '" aria-pressed="' + qOn(q[0]) + '">' + q[1] + '</button>').join('') + '</div>' +
      '<div class="range"><label class="f"><span>開始</span><input type="date" id="bstfrom" value="' + esc(st.from) + '" max="' + esc(st.to) + '"></label><label class="f"><span>終了</span><input type="date" id="bstto" value="' + esc(st.to) + '" min="' + esc(st.from) + '"></label></div>' +
      (st.err ? '<div class="err">' + esc(st.err) + '</div>' : '') +
      '<div class="summary" id="bstSum"><div class="stat"><small>発表したレース</small><b>' + amt(tot.races) + '</b></div><div class="stat"><small>払った BPT</small><b>' + amt(tot.paid) + '</b></div></div>' +
      (st.data == null && !st.err ? '<div class="empty">読み込み中…</div>' :
        '<h4 class="sumh">日ごと</h4><div class="tbl"><table class="cards days" id="bstDays"><tr class="hd"><th>日付</th><th class="n">発表したレース</th><th class="n">払った BPT</th></tr>' +
        (days.length ? days.map((x) => '<tr data-day="' + esc(x.day) + '"><td class="head"><b>' + fmtDay(x.day) + '</b> <button type="button" class="btn xs ghost" data-act="st-day" aria-expanded="' + !!st.days[x.day] + '">' + (st.days[x.day] ? '閉じる' : 'レースを見る') + '</button></td><td class="n">' + amt(x.races) + '</td><td class="n">' + amt(x.paid) + '</td></tr>' + dayRaces(x)).join('') : '<tr><td colspan="3" class="empty">この期間のデータはありません</td></tr>') + '</table></div>') +
      '<details class="fold"><summary>言葉の意味</summary><div class="in"><p class="hint">発表したレース＝結果を発表したボートのレースの数（取り消しは入りません）。払った BPT＝当たった人に実際に足した BPT の合計（持ち上限 ' + amt(holdMax()) + ' で止まった分は入りません）。期間は 62 日まで。</p></div></details></div></div>';
  }

  function view() {
    if (!S.data) return '<div class="boatadm"><div class="panel"><h3>ボート</h3><p class="hint' + (S.loadErr ? ' err boatload' : '') + '">' + (S.loadErr ? esc(S.loadErr) : '読み込み中…') + '</p>' + (S.loadErr ? '<div class="acts l"><button type="button" class="btn sm ghost" data-act="reload">もう一度読む</button></div>' : '') + '</div></div>';
    return S.sub === 'timetable' ? viewTT() : S.sub === 'tuning' ? viewTuning() : S.sub === 'tv' ? viewTv() : S.sub === 'racers' ? viewRacers() : S.sub === 'stats' ? viewStats() : viewToday();
  }
  // 下のタブ（競馬の #tabs と同じ見た目。ボートの画面を出している間だけ）
  function nav() {
    let n = document.getElementById('btabs');
    if (!n) { n = document.createElement('nav'); n.className = 'tabs'; n.id = 'btabs'; const t = document.getElementById('tabs'); if (t && t.parentNode) t.parentNode.insertBefore(n, t.nextSibling); else document.body.insertBefore(n, S.main); n.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-bt]'); if (b) go(b.dataset.bt); }); }
    n.style.display = S.on ? '' : 'none';
    n.innerHTML = SUBS.map(([k, l]) => '<button type="button" data-bt="' + k + '" class="' + (S.sub === k ? 'on' : '') + '">' + l + '</button>').join('');
  }
  function paint() { nav(); if (S.main && S.on) S.main.innerHTML = view(); } // S.on: ボートの画面を出している間だけ描く（読み込みの返事が、ほかのタブへ移ったあとに届いても、そのタブの中身を上書きしない）
  const keepScroll = (fn) => { const y = window.scrollY; fn(); window.scrollTo(0, y); };
  function go(sub) {
    if (S.busy) return;
    if (sub === S.sub) { if (!S.dirty[sub]) run(() => load(true)); return; } // いまのタブを押したら読み直す
    if (S.dirty[S.sub] && !confirm('保存していない変更があります。このタブを離れますか？（変更は消えます）')) return;
    drop(S.sub); S.sub = sub; S.actErr = ''; enter(); paint(); window.scrollTo(0, 0);
  }
  // そのタブの保存していない編集を捨てて、保存済みの中身に戻す
  function drop(sub) {
    S.dirty[sub] = false; S.err[sub] = '';
    if (!S.data) return;
    if (sub === 'timetable') { S.tt = rulesToTpls(S.data.cfg.rules); S.conflicts = []; }
    if (sub === 'tuning') S.tun = tunOf(S.data.cfg);
    if (sub === 'racers') S.rc = window.BoatModel ? rcOf(S.data.cfg) : null;
  }
  // タブに入ったときの読み込み（店の一覧・選手の初期の一覧・集計）
  function enter() {
    const gen = S.gen;
    if (S.sub === 'tv' && !S.stores) { S.storesErr = ''; S.ctx.api('config').then((c) => { S.stores = ((c && c.stores) || []).map((s) => ({ id: s.id, name: s.name || s.id })); }, (e) => { S.storesErr = errOf(e, '店舗を読めませんでした'); }).then(() => { if (gen === S.gen && S.sub === 'tv') paint(); }); }
    if (S.sub === 'racers' && !S.rc) { (window.BoatModel ? Promise.resolve() : addScript('../js/boat-model.js')).then(() => { if (S.data && !S.rc) S.rc = rcOf(S.data.cfg); }, (e) => { S.err.racers = errOf(e, '選手の一覧を読めませんでした'); }).then(() => { if (gen === S.gen && S.sub === 'racers') paint(); }); }
    if (S.sub === 'stats') { if (!S.st.to) { S.st.to = bizToday(); S.st.from = dayShift(S.st.to, -6); } if (!S.st.data && !S.st.err) loadStats(); }
  }
  async function loadStats() {
    const st = S.st, gen = S.gen, key = st.from + '~' + st.to; st.key = key; st.err = ''; st.data = null; st.days = {};
    try { const r = await S.ctx.api('boatStats', st.from, st.to); if (st.key !== key) return; st.data = r || { days: [] }; } catch (e) { if (st.key !== key) return; st.err = errOf(e, '集計を読めませんでした'); }
    if (gen === S.gen && S.sub === 'stats') keepScroll(paint);
  }
  /* 読む。keep: 保存していない編集があるタブは編集の中身を残し、今日のレースの一覧・被りだけ最新にする（F12）。古い返事があとから届いても上書きしない */
  async function load(keep) {
    const my = ++S.seq;
    try {
      const d = await S.ctx.api('boatConfig'); if (my !== S.seq) return;
      S.data = d; S.loadErr = ''; // 読めたら読み込みの赤字は消す（I5）
      EDITS.forEach((sub) => { if (!(keep && S.dirty[sub]) || (sub === 'timetable' && !S.tt) || (sub === 'tuning' && !S.tun)) drop(sub); });
      enter();
    } catch (e) { if (my !== S.seq) return; S.loadErr = errOf(e, '読めませんでした'); }
    paint();
  }
  // ボタンの処理の間はボタンを止める（F14）。gen: 押したときの世代。処理の途中でタブを離れて戻ったら、戻ってきたあと赤字・編集・ボタンの状態に触らない（J15）
  async function run(fn) {
    if (S.busy) return; S.busy = true; S.actErr = ''; keepScroll(paint);
    const gen = S.gen, live = () => gen === S.gen;
    try { await fn(live); } finally { if (live()) { S.busy = false; keepScroll(paint); } }
  }
  const touch = (sub) => { S.dirty[sub] = true; };
  const tplOf = (el) => { const box = el.closest('.tpl'); return box ? S.tt.find((t) => t.k === box.dataset.tk) : null; };
  const rowOf = (t, el) => { const tr = el.closest('tr[data-rk]'); return tr && t ? t.rows.find((r) => r.k === tr.dataset.rk) : null; };
  // 時刻表: 打っている間は欄を描き直さない。札の見出し・件数・赤字だけその場で書き換える
  function ttMarks() {
    if (!S.main || S.sub !== 'timetable') return;
    const v = checkTT();
    S.tt.forEach((t) => {
      const box = S.main.querySelector('.tpl[data-tk="' + t.k + '"]'); if (!box) return;
      const bad = (v.errs[t.k] ? 1 : 0) + t.rows.filter((r) => v.rows[r.k]).length, set = (q, txt) => { const e = box.querySelector(q); if (e && e.textContent !== txt) e.textContent = txt; };
      box.classList.toggle('has-err', !!bad); set('[data-tname]', tplName(t)); set('[data-sum]', tplSummary(t)); set('[data-cnt]', t.rows.length + ' レース'); set('[data-terr]', v.errs[t.k] || '');
      const ch = box.querySelector('[data-terrn]'); if (ch) { ch.hidden = !bad; ch.textContent = '要確認 ' + bad; }
      t.rows.forEach((r) => { const tr = box.querySelector('tr[data-rk="' + r.k + '"]'), e = tr && tr.querySelector('[data-rerr]'); if (e && e.textContent !== (v.rows[r.k] || '')) e.textContent = v.rows[r.k] || ''; });
    });
  }
  function rcMarks() {
    if (!S.main || S.sub !== 'racers' || !S.rc) return;
    const v = checkRc();
    S.rc.forEach((h) => { const e = S.main.querySelector('.brc-row[data-hk="' + h.k + '"] [data-he]'); if (e) { e.hidden = !v.errs[h.k]; e.textContent = v.errs[h.k] || ''; } });
    const s = S.main.querySelector('#brcSum'); if (s) s.innerHTML = '出走 <b>' + v.on + '</b> 人・休み ' + (S.rc.length - v.on) + ' 人（全部で ' + S.rc.length + ' 人）';
  }

  async function saveNow(live) {
    const sub = S.sub; S.err[sub] = '';
    let body = null, okMsg = '', ref = null;
    if (sub === 'timetable') {
      S.tt.forEach((t) => t.rows.forEach((r) => { r.t = normT(r.t); }));
      const v = checkTT(); if (v.n) { S.err[sub] = 'まちがいが ' + v.n + ' つあります。赤い所を直してください'; S.tt.forEach((t) => { if (v.errs[t.k] || t.rows.some((r) => v.rows[r.k])) S.open.add(t.id); }); return; }
      S.conflicts = []; S.tt.forEach(sortRows); body = { rules: tplsToRules(S.tt) }; okMsg = 'ボートの時刻表を保存しました'; ref = S.tt;
    } else if (sub === 'tuning') {
      const c = S.tun, bad = checkTun(c); if (bad) { S.err[sub] = bad; return; } // 空の目安は送らない（I5）
      body = { target: Number(c.target), capRace: Number(c.capRace), capDay: Number(c.capDay), voteSec: Number(c.voteSec), resultSec: Number(c.resultSec), incidentOn: Number(c.incidentOn) > 0, startAt: startMs(c.startDate, c.startTime) };
      okMsg = 'ボートの設定を保存しました'; ref = S.tun;
    } else if (sub === 'racers') {
      const v = checkRc(); if (v.msg) { S.err[sub] = v.msg; return; }
      const L = rcClean(S.rc); body = { racers: racerKey(L) === racerKey(racerDefault()) ? null : L }; okMsg = '選手を保存しました'; ref = S.rc;
    } else return;
    const sent = JSON.stringify(ref);
    try {
      await S.ctx.api('saveBoat', body); S.ctx.toast(okMsg);
      if (!live() || (sub === 'timetable' ? S.tt : sub === 'tuning' ? S.tun : S.rc) !== ref) return; // 返事を待つ間にタブを離れて戻った: 新しい編集には触らない（J15）
      if (JSON.stringify(ref) === sent) S.dirty[sub] = false; // 保存の返事を待つ間に打った分は残す
      await load(true);
    } catch (e) {
      if (!live() || (sub === 'timetable' ? S.tt : sub === 'tuning' ? S.tun : S.rc) !== ref) return;
      S.err[sub] = errOf(e, '保存できませんでした'); if (sub === 'timetable') S.conflicts = (e && e.body && e.body.conflicts) || []; // 断られた理由（競馬と被る・朝 5 時の前後 など）は赤字で出す
    }
  }

  function bind(main) {
    if (main.__boatBound) return; main.__boatBound = true;
    main.addEventListener('input', (ev) => {
      const t = ev.target; if (!S.on || !S.data || !t.closest('.boatadm')) return;
      if (t.dataset.gr) { // BPT を付ける（2026-11-26）: 打っている間は描き直さない。ID を変えたら確かめ直す
        S.gr[t.dataset.gr] = t.value;
        if (t.dataset.gr === 'code' && S.gr.who) { S.gr.who = null; const w = main.querySelector('#grWho'); if (w) w.innerHTML = ''; }
        return;
      }
      if (S.sub === 'tuning' && S.tun) {
        if (t.dataset.k) { S.tun[t.dataset.k] = t.value; touch('tuning'); }
        if (t.dataset.c) { S.tun[t.dataset.c] = t.checked ? 1 : 0; touch('tuning'); }
        const w = main.querySelector('#boatWarn'); if (w) { const h = tunWarn(S.tun); if (w.__h !== h) { w.__h = h; w.innerHTML = h; } } // 大小の注意は打つたびに注意の所だけ書き換える（欄は描き直さない＝打っている字が消えない）
      } else if (S.sub === 'timetable' && S.tt) {
        const tp = tplOf(t); if (!tp) return;
        if (t.dataset.bf) { bulkOf(tp)[t.dataset.bf] = t.value; return; } // まとめて作るの欄（時刻表の編集ではないので「保存していない」にはしない）
        if (t.dataset.wd != null) { const d = Number(t.dataset.wd); tp.weekdays = t.checked ? tp.weekdays.concat([d]) : tp.weekdays.filter((x) => x !== d); t.closest('label').classList.toggle('on', t.checked); }
        else if (t.dataset.tf === 'name') tp.name = t.value;
        else if (t.dataset.tf === 'date') tp.date = t.value;
        else if (t.dataset.rf) { const r = rowOf(tp, t); if (!r) return; r[t.dataset.rf] = t.value; }
        else return;
        touch('timetable'); ttMarks();
      } else if (S.sub === 'racers' && S.rc) {
        const row = t.closest('.brc-row'), h = row && S.rc.find((x) => x.k === row.dataset.hk); if (!h || !t.dataset.hf) return;
        h[t.dataset.hf] = /^(spd|sta|pow|st|mae)$/.test(t.dataset.hf) ? Number(t.value) : t.value; touch('racers'); rcMarks();
      }
    });
    main.addEventListener('change', (ev) => {
      const t = ev.target; if (!S.on || !S.data || !t.closest('.boatadm')) return;
      if (S.sub === 'timetable' && S.tt) {
        const tp = tplOf(t); if (!tp) return;
        if (t.dataset.tf === 'kind') { tp.kind = t.value; if (tp.kind === 'weekday' && !tp.weekdays.length) tp.weekdays = [6, 0]; if (tp.kind === 'date' && !tp.date) tp.date = dayShift(bizToday(), 1); touch('timetable'); keepScroll(paint); }
        else if (t.dataset.rf === 't') { const r = rowOf(tp, t); if (r) { r.t = normT(t.value); t.value = r.t; ttMarks(); } } // 「1900」→ 19:00（欄だけ書き換える。描き直すと次に押したボタンが消える）
        else if (t.dataset.bf === 'from' || t.dataset.bf === 'to') { bulkOf(tp)[t.dataset.bf] = normT(t.value); t.value = bulkOf(tp)[t.dataset.bf]; }
      } else if (S.sub === 'stats' && (t.id === 'bstfrom' || t.id === 'bstto')) {
        const f = main.querySelector('#bstfrom').value, to = main.querySelector('#bstto').value; if (!f || !to || f > to) return;
        S.st.from = f; S.st.to = to; loadStats(); keepScroll(paint);
      }
    });
    main.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b || !S.main || !S.on || !b.closest('.boatadm') || S.busy) return; // ボートの画面の中だけ・処理の途中は受けない
      const a = b.dataset.act;
      if (a === 'reload') return run(() => load(true));
      if (!S.data) return;
      if (b.dataset.void) {
        const id = b.dataset.void;
        if (!confirm('このボートのレースを取り消しますか？ BPT の券に使った BPT は全部戻します')) return;
        return run(async (live) => {
          try { const r = await S.ctx.api('boatRefund', id); S.ctx.toast('取り消しました（戻した BPT: ' + amt(Object.values((r && r.back) || {}).reduce((x, y) => x + (Number(y) || 0), 0)) + '）'); } catch (e) { S.ctx.toast(errOf(e, '取り消せませんでした')); if (live()) S.actErr = '取り消せませんでした: ' + errOf(e, ''); }
          if (live()) await load(true);
        });
      }
      // 「すぐ始める」が断られたら（競馬・ほかのボートと被る・朝 5 時の前後 など）、理由をボタンの下に赤字で残す（次の操作まで。2026-11-21）
      if (a === 'test') return run(async (live) => { try { await S.ctx.api('boatRace', { inSec: 120 }); S.ctx.toast('2 分後に締切のボートレースを作りました'); } catch (e) { S.ctx.toast(errOf(e, '作れませんでした')); if (live()) S.actErr = 'すぐ始めるボートレースは作れませんでした: ' + errOf(e, ''); } if (live()) await load(true); });
      if (a === 'save') return run(saveNow);
      if (a === 'revert') { if (S.dirty[S.sub] && !confirm('保存していない変更を捨てて、保存済みの中身に戻しますか？')) return; drop(S.sub); return run(() => load(true)); }
      if (S.sub === 'timetable') return ttClick(b, a);
      if (S.sub === 'racers') return rcClick(b, a);
      if (S.sub === 'tv' && a === 'tvq') {
        const row = b.closest('.tvrow'), id = row && row.dataset.store, q = bqOf(b.dataset.q); if (!id) return;
        return run(async (live) => {
          S.err.tv = '';
          const m = {}; (S.stores || []).forEach((s) => { m[s.id] = bqNow(S.data.cfg, s.id); }); m[id] = q;
          try { await S.ctx.api('saveBoat', { tvqs: m }); S.ctx.toast('画質を保存しました（次のボートの映像から）'); } catch (e) { if (live()) S.err.tv = errOf(e, '保存できませんでした'); }
          if (live()) await load(true);
        });
      }
      if (S.sub === 'stats' && (a === 'gr-look' || a === 'gr-give')) { // BPT を付ける（2026-11-26）
        const g = S.gr; g.err = ''; g.msg = ''; const gErr = (e, d) => (e && e.code === 'not_supported' ? '本番（Firebase）のときだけ使えます' : errOf(e, d)); // 模擬クラウドには無い
        if (a === 'gr-look') return run(async (live) => { try { const w = await S.ctx.api('bptMember', g.code); if (!live()) return; g.who = w; g.code = w.code; } catch (e) { if (live()) { g.who = null; g.err = gErr(e, '確かめられませんでした'); } } });
        const w = g.who, n = Number(g.n), note = String(g.note || '').trim();
        if (!w) { g.err = '先に会員 ID を確かめてください'; return keepScroll(paint); }
        if (!Number.isInteger(n) || n < 1 || n > holdMax()) { g.err = '付ける BPT は 1〜' + amt(holdMax()) + ' の整数で入れてください'; return keepScroll(paint); }
        if (!note) { g.err = '理由を入れてください'; return keepScroll(paint); }
        if (!confirm((w.name || '（名前なし）') + '（' + w.code + '）に ' + amt(n) + ' BPT を付けますか？\n理由: ' + note)) return;
        return run(async (live) => {
          try {
            const r = await S.ctx.api('bptGrant', { code: w.code, n, note }); if (!live()) return;
            g.who = Object.assign({}, w, { bal: r.bal }); g.n = ''; g.note = '';
            g.msg = (r.name || w.name || w.code) + ' に ' + amt(r.gain) + ' BPT を付けました（いまの BPT ' + amt(r.bal) + '）' + (r.capped ? '。上限のため ' + amt(n - r.gain) + ' は付きませんでした' : '');
            S.ctx.toast('BPT を付けました');
          } catch (e) { if (live()) g.err = gErr(e, '付けられませんでした'); }
        });
      }
      if (S.sub === 'stats') {
        if (a === 'stq') { const r = stQuick(b.dataset.q); S.st.from = r[0]; S.st.to = r[1]; loadStats(); return keepScroll(paint); }
        if (a === 'st-day') {
          const tr = b.closest('tr[data-day]'), day = tr && tr.dataset.day; if (!day) return;
          if (S.st.days[day]) { delete S.st.days[day]; return keepScroll(paint); }
          const o = (S.st.days[day] = { races: null, err: '' }), gen = S.gen; keepScroll(paint);
          S.ctx.api('boatDay', day).then((r) => { o.races = (r && r.races) || []; }, (e) => { o.err = errOf(e, '読めませんでした'); }).then(() => { if (gen === S.gen && S.sub === 'stats' && S.st.days[day] === o) keepScroll(paint); });
        }
      }
    });
  }
  function ttClick(b, a) {
    const repaint = () => { touch('timetable'); keepScroll(paint); };
    if (a === 'tpl-add') {
      const kind = KIND[b.dataset.kind] ? b.dataset.kind : 'daily', t = { k: nk(), id: 'bt' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: '', enabled: true, kind, weekdays: kind === 'weekday' ? [6, 0] : [], date: kind === 'date' ? dayShift(bizToday(), 1) : '', rows: [], bulk: null };
      S.tt.push(t); S.open.add(t.id); repaint(); const box = S.main.querySelector('.tpl[data-tk="' + t.k + '"]'); if (box) box.scrollIntoView({ block: 'center' }); return;
    }
    const t = tplOf(b); if (!t) return;
    const i = S.tt.indexOf(t);
    if (a === 'tpl-open') { if (S.open.has(t.id)) S.open.delete(t.id); else S.open.add(t.id); return keepScroll(paint); }
    if (a === 'tpl-on') { t.enabled = !t.enabled; return repaint(); }
    if (a === 'tpl-up' && i > 0) { S.tt.splice(i - 1, 0, S.tt.splice(i, 1)[0]); return repaint(); }
    if (a === 'tpl-down' && i < S.tt.length - 1) { S.tt.splice(i + 1, 0, S.tt.splice(i, 1)[0]); return repaint(); }
    if (a === 'tpl-dup') { const c = { k: nk(), id: 'bt' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: (t.name || tplName(t)) + ' のコピー', enabled: false, kind: t.kind, weekdays: t.weekdays.slice(), date: t.date, rows: t.rows.map((r) => ({ k: nk(), t: r.t, p: r.p })), bulk: null }; S.tt.splice(i + 1, 0, c); S.open.add(c.id); S.ctx.toast('コピーしました（OFF で作りました。日や曜日を変えてから ON にしてください）'); return repaint(); }
    if (a === 'tpl-del') { if (t.rows.length && !confirm('この予定（' + tplName(t) + '・' + t.rows.length + ' レース）を消しますか？')) return; S.tt.splice(i, 1); return repaint(); }
    if (a === 'row-add') { const last = t.rows[t.rows.length - 1], m = last && !isNaN(tMin(last.t)) ? tMin(last.t) + 60 : NaN; t.rows.push({ k: nk(), t: !isNaN(m) && tOk(m) ? tHm(m) : '', p: last ? last.p : '' }); return repaint(); }
    if (a === 'row-sort') { t.rows.forEach((r) => { r.t = normT(r.t); }); sortRows(t); return repaint(); }
    if (a === 'row-clear') { if (!confirm('この予定のレース（' + t.rows.length + ' 件）を全部消しますか？')) return; t.rows = []; return repaint(); }
    if (a === 'row-payall') { const v = prompt('この予定の全部のレースの目安（BPT）を入れてください（空 ＝ 初期値）', (t.rows[0] && t.rows[0].p) || ''); if (v == null) return; const p = String(v).trim(); if (p !== '' && !(/^\d+$/.test(p) && +p >= 1)) { S.ctx.toast('目安は 1 以上の整数で入れてください'); return; } t.rows.forEach((r) => { r.p = p; }); return repaint(); }
    const r = rowOf(t, b);
    if (a === 'row-del' && r) { t.rows.splice(t.rows.indexOf(r), 1); return repaint(); }
    if (a === 'row-dup' && r) { const m = tMin(normT(r.t)) + 60; t.rows.splice(t.rows.indexOf(r) + 1, 0, { k: nk(), t: !isNaN(m) && tOk(m) ? tHm(m) : '', p: r.p }); return repaint(); }
    if (a === 'bulk') {
      const c = bulkCheck(bulkOf(t), true); if (c.err) { S.ctx.toast(c.err); return; }
      const mins = []; for (let m = c.f; m <= c.t; m += c.ev) mins.push(m);
      const x = addTimes(t, mins, c.pay); S.ctx.toast(x.add + ' レースを追加しました' + (x.skip ? '（同じ時刻の ' + x.skip + ' 件は飛ばしました）' : '') + '。保存するまで変わりません'); return repaint();
    }
    if (a === 'auto') return run(async (live) => {
      const tt = S.tt; let r = null;
      try { r = await autoPick(bulkOf(t), tt, S.data.cfg, S.ctx.api); } catch (e) { r = { err: 'おまかせで作れませんでした: ' + errOf(e, '') }; }
      if (!live() || S.tt !== tt) return;
      if (r.err) { S.ctx.toast(r.err); return; }
      const x = addTimes(t, r.mins, r.pay); touch('timetable');
      S.ctx.toast(x.add + ' レースを選びました' + (r.none.length ? '（入らなかった: ' + r.none.join('・') + '）' : '') + '。保存するまで変わりません');
    });
  }
  function rcClick(b, a) {
    if (!S.rc) return;
    const repaint = () => { touch('racers'); keepScroll(paint); };
    if (a === 'rc-add') { if (S.rc.length >= R_MAX) return; S.rc.push({ k: nk(), name: '', yomi: '', type: 'sashi', cls: 'B1', st: 0.17, spd: 3, sta: 3, pow: 3, mae: 0.05, off: false }); repaint(); const L = S.main.querySelectorAll('.brc-row [data-hf="name"]'); if (L.length) L[L.length - 1].focus(); return; }
    if (a === 'rc-default') { if (!confirm('選手を初期の 18 人に戻しますか？（保存するまで変わりません）')) return; S.rc = racerDefault().map((h) => Object.assign({ k: nk(), off: false }, h)); return repaint(); }
    const row = b.closest('.brc-row'), h = row && S.rc.find((x) => x.k === row.dataset.hk); if (!h) return;
    if (a === 'rc-on') { h.off = !h.off; return repaint(); }
    if (a === 'rc-del') { if (h.name && !confirm('「' + h.name + '」を一覧から消しますか？')) return; S.rc.splice(S.rc.indexOf(h), 1); return repaint(); }
  }

  { const st = document.createElement('style'); st.textContent = '.boatadm .flds{display:flex;flex-wrap:wrap;gap:10px 22px;margin:6px 0 10px}.boatadm .fld{display:flex;align-items:center;gap:8px}.boatadm .fld span{min-width:9em}.boatadm .fld input{width:120px}.boatadm .fld input.sd{width:170px}.boatstart{color:var(--gold,#e9c25e)}' +
    '.boatadm .tt-rows input.tm,.boatadm .bulk input.tm{width:104px;text-align:center;font-variant-numeric:tabular-nums}.boatadm .tt-rows td.msg{color:var(--ng,#ff9d8c)}.boatadm .tpl .err:empty{display:none}' +
    '.boatcs{background:rgba(255,80,60,.1);border:1px solid #b44;border-radius:10px;padding:8px 14px;margin:8px 0}.boatcs ul{margin:4px 0 0 18px;padding:0}.boatwarn{margin:0 0 10px 18px;padding:0;color:#e0a030;font-weight:700}.boatwarn:empty{display:none}.boatstuck{color:#e05040;font-weight:700;margin:4px 0}.boatstuck ul{margin:4px 0 0 18px;padding:0}' +
    '.brc-row{display:grid;grid-template-columns:28px minmax(120px,1.2fr) minmax(140px,1.5fr) 92px 150px auto;gap:6px 8px;align-items:end;padding:10px 0;border-top:1px solid var(--line,#2a2a31)}.brc-row:first-child{border-top:0}.brc-row.off{opacity:.55}.brc-no{color:var(--sub,#a89f89);padding-bottom:10px;font-variant-numeric:tabular-nums}' +
    '.brc-f{display:flex;flex-direction:column;gap:2px;min-width:0;margin:0}.brc-f span{font-size:11px;color:var(--sub,#a89f89)}.brc-f input,.brc-f select{height:38px;border-radius:10px;width:100%;min-width:0}.brc-ops{display:flex;gap:6px;padding-bottom:3px}.brc-st{grid-column:2/-1;display:grid;grid-template-columns:repeat(4,minmax(0,110px)) minmax(0,170px);gap:6px 8px}.brc-err{grid-column:2/-1;margin:0}' +
    '@media (max-width:760px){.brc-row{grid-template-columns:28px repeat(2,minmax(0,1fr))}.brc-ops{grid-column:2/-1}.brc-st{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
    '.bst-day td{background:rgba(255,255,255,.03);padding:6px 10px}' +
    '.bgrant .grrow{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 12px;margin:0 0 8px}.bgrant .grrow .f{margin:0}.bgrant .grw{margin:4px 0 8px;font-size:15px}.bgrant .grw b{font-variant-numeric:tabular-nums}.bgrant .grnote{flex:1 1 220px}.bgrant .grmsg{color:var(--ok,#8fe0a0);font-weight:700}.bgrant #grCode{text-transform:uppercase;width:140px}.bgrant #grN{width:120px}'; /* BPT を付ける（2026-11-26） */ document.head.appendChild(st); }

  /* render: ボートの画面を出す（v2/admin.js）。reset: 画面に入る前・出るときに呼ばれる（読み直す・保存していない編集を捨てる・途中の読み込みの返事は捨てる）。dirty: 保存していない編集があるか */
  window.AdminBoat = {
    render(main, ctx) { if (!S.on) S.gen++; S.ctx = ctx; S.main = main; S.on = true; bind(main); paint(); if (!S.data) load(); },
    reset() { S.on = false; S.gen++; S.seq++; S.data = null; S.tt = null; S.tun = null; S.rc = null; S.stores = null; S.dirty = {}; S.err = {}; S.busy = false; S.loadErr = ''; S.actErr = ''; S.conflicts = []; S.st.data = null; S.st.err = ''; S.st.days = {}; const n = document.getElementById('btabs'); if (n) n.style.display = 'none'; },
    dirty: () => EDITS.some((k) => S.dirty[k]),
    go, get sub() { return S.sub; },
    _rulesToTpls: rulesToTpls, _tplsToRules: tplsToRules, _autoPick: autoPick, _normT: normT,
  };
})();
