/* 管理画面の「ボート」タブ（2026-11-19。casa BOAT）: window.AdminBoat。v2/admin.js が tab === 'boat' のときに render(main, ctx) を呼ぶ。
   できること: ボートの時刻表（毎日・曜日・祝日・日付。時刻と 1 レースの目安 BPT）・1 レースの目安の初期値・1 レース上限・1 日上限・投票の秒数・結果画面の秒数の保存、
   今日のボートのレース（状態・参加・払った BPT／目安・結果）と取り消し（足した BPT を全部戻す）、すぐ始めるボートのレース（確かめ用）。
   競馬と被る時刻は保存できない（全店共通で判定。サーバー・Firestore 版が 409 boat_conflict で断り、その中身を赤字で出す）。画面に「ポイント」と書かない（BPT と書く）。 */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const amt = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP');
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const KINDS = [['daily', '毎日'], ['weekday', '曜日'], ['holiday', '祝日'], ['date', '日付']];
  const ST = { upcoming: '受付前・受付中', decided: 'レース中', done: '発表済み', void: '取り消し' };
  // dirty: 保存していない編集がある（読み直しで消さない。2026-11-20 F12）。busy: ボタンの処理の途中（連打を受けない。F14）。seq: 読み込みの通し番号（古い返事であとから上書きしない）
  /* 2026-11-21: loadErr ＝ 読み込みの失敗（読めたら消す。I5: 前は保存の赤字と同じ置き場で「通信できません」が消えなかった）。actErr ＝ 「すぐ始める」「取り消す」が断られた理由（次の操作まで）。
     gen ＝ タブに入った回数（J15: タブを離れて戻ったあと、古い保存・すぐ始める・取り消しの処理が新しい編集・赤字・ボタンに触らない） */
  const S = { data: null, edit: null, err: '', loadErr: '', actErr: '', conflicts: [], busy: false, dirty: false, seq: 0, gen: 0, on: false, ctx: null, main: null };
  const hm = (ms) => (window.DerbyCore ? DerbyCore.fmtBizTime(ms, 5) : new Date(ms).toTimeString().slice(0, 5));

  /* 時刻表の決まり → 編集の行。1 行 ＝ 目安 1 つ。同じ決まりの中に目安のちがうレースがあれば、目安ごとの行に分けて出す
     （2026-11-20 F13: 前は最初のレースの目安だけを出していて、そのまま保存すると全部のレースが最初の値になった。この画面からは作れない形だが、じかに書かれた決まりでも失わない） */
  function rulesToEdit(rules) {
    const out = [];
    (rules || []).forEach((r, i) => {
      const id = r.id || 'b' + (i + 1), groups = [];
      (r.races ? r.races : (r.times || []).map((t) => ({ time: t, payout: r.payout }))).forEach((x) => { const pay = Number(x.payout) || 0; let g = groups.find((y) => y.pay === pay); if (!g) groups.push((g = { pay, times: [] })); g.times.push(x.time); });
      if (!groups.length) groups.push({ pay: Number(r.payout) || 0, times: [] });
      groups.forEach((g, k) => out.push({ id: k ? id + '-' + (k + 1) : id, enabled: r.enabled !== false, kind: r.kind || 'daily', weekdays: (r.weekdays || []).slice(), date: r.date || '', times: g.times.join(', '), payout: g.pay }));
    });
    return out;
  }
  // BPT の持ち上限（2026-11-20 オーナー決定「3,000 まで」）。数の置き場は v2/core.js の BPT_MAX（お金の係。設定では変えられない決まり）。読めなければ 3,000
  const holdMax = () => { const v = Number((window.DerbyCore && DerbyCore.BPT_MAX) || (window.BoatCore && BoatCore.BPT_MAX)); return v > 0 ? v : 3000; };
  function editToRules(list) {
    return list.map((x, i) => {
      const times = String(x.times || '').replace(/[，、\s]+/g, ',').split(',').map((s) => s.trim()).filter(Boolean);
      const o = { id: x.id || 'b' + (i + 1), enabled: x.enabled !== false, kind: x.kind, races: times.map((t) => ({ time: t, payout: Number(x.payout) || 0 })), payout: Number(x.payout) || 0 };
      if (x.kind === 'weekday') o.weekdays = x.weekdays.map(Number);
      if (x.kind === 'date') o.date = x.date;
      return o;
    });
  }
  /* 小分けの処理が失敗し続けている印（お金の係。ref/boat/opId_の使い方.md の「stuck」: boatConfig の返事の stuck ＝ [{ id, at, step, n, err, errAt }]・今日のレースの行にも stuck）。
     続けて 3 回以上の失敗を赤字で出す。無い（古い部品・模擬）ときは何も出さない */
  const STEP = { decide: '決める', reveal: '発表・BPT を入れる', void: '取り消しの戻し' };
  const stuckOf = (x) => (x && Number(x.n) >= 3 ? x : null);
  const stuckText = (x) => (STEP[x.step] || x.step || '処理') + ' が ' + amt(x.n) + ' 回続けて失敗' + (x.err ? '（' + x.err + '）' : '');
  /* 保存の前に確かめる（2026-11-21 I5）: 目安（初期値）が空・曜日の行で曜日が 1 つも無い → 保存しないで赤字 */
  function checkEdit(e) {
    if (String(e.cfg.target == null ? '' : e.cfg.target).trim() === '' || !(Number(e.cfg.target) >= 0)) return '1 レースの目安（初期値）を入れてください（空にはできません）';
    const i = e.rules.findIndex((x) => x.kind === 'weekday' && !(x.weekdays || []).length); if (i >= 0) return (i + 1) + ' 行目: 曜日を 1 つ以上選んでください';
    return '';
  }
  // 大小の注意（保存は止めない）: 1 レース上限＞1 日上限・目安（初期値・行の目安）＞1 レース上限
  function warnings(e) {
    const c = e.cfg, cr = Number(c.capRace), cd = Number(c.capDay), out = [];
    if (cr > 0 && cd > 0 && cr > cd) out.push('1 レース上限（' + amt(cr) + '）が 1 日上限（' + amt(cd) + '）より大きくなっています');
    if (cr > 0 && Number(c.target) > cr) out.push('1 レースの目安（初期値 ' + amt(c.target) + '）が 1 レース上限（' + amt(cr) + '）より大きくなっています');
    e.rules.forEach((x, i) => { if (cr > 0 && Number(x.payout) > cr) out.push((i + 1) + ' 行目の目安（' + amt(x.payout) + '）が 1 レース上限（' + amt(cr) + '）より大きくなっています'); });
    return out;
  }
  const warnHtml = (e) => warnings(e).map((w) => '<li>' + esc(w) + '</li>').join('');
  function view() {
    const d = S.data, e = S.edit;
    if (!d) return '<section class="card"><h2>ボート</h2><p class="hint">' + (S.loadErr ? esc(S.loadErr) : '読み込み中…') + '</p></section>';
    const cfg = d.cfg, num = (k, lab, unit, hint, attrs) => '<label class="fld"><span>' + lab + '</span><input type="number" inputmode="numeric" data-k="' + k + '" value="' + esc(e.cfg[k]) + '"' + (attrs || '') + '><small>' + unit + '</small>' + (hint ? '<small class="hint"> ' + hint + '</small>' : '') + '</label>';
    const CAP = ' min="100" step="100"', capHint = '100 以上（0 や空にはできません）'; // 上限は必ず入れる（2026-11-20。v2/boat-core.js の CAP_MIN。0 で保存すると断られ、理由が赤字で出る）
    const rows = e.rules.map((x, i) => '<tr data-i="' + i + '"><td><input type="checkbox" data-r="enabled"' + (x.enabled ? ' checked' : '') + '></td>' +
      '<td><select data-r="kind">' + KINDS.map(([v, n]) => '<option value="' + v + '"' + (x.kind === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>' +
      (x.kind === 'weekday' ? '<div class="wds">' + WD.map((w, k) => '<label><input type="checkbox" data-wd="' + k + '"' + (x.weekdays.map(Number).includes(k) ? ' checked' : '') + '>' + w + '</label>').join('') + '</div>' : '') +
      (x.kind === 'date' ? '<input type="date" data-r="date" value="' + esc(x.date) + '">' : '') + '</td>' +
      '<td><input type="text" data-r="times" class="tms" placeholder="21:30, 23:30" value="' + esc(x.times) + '"></td>' +
      '<td><input type="number" data-r="payout" class="pay" placeholder="' + esc(cfg.target) + '" value="' + esc(x.payout || '') + '"></td>' +
      '<td><button class="btn sm ghost" data-del="' + i + '">消す</button></td></tr>').join('');
    const stuck = (d.stuck || []).filter(stuckOf), todayIds = new Set((d.races || []).map((r) => r.id)), stuckOther = stuck.filter((x) => !todayIds.has(x.id)); // 今日の一覧に無いレース（前の日の発表待ちなど）は上にまとめて出す
    const cs = (S.conflicts.length ? S.conflicts : d.conflicts || []).slice(0, 12), dis = S.busy ? ' disabled' : '';
    const races = (d.races || []).map((r) => '<tr><td><b>' + hm(r.at) + '</b>' + (r.test ? ' <small class="hint">テスト</small>' : '') + '</td><td>' + (ST[r.status] || r.status) + '</td><td class="n">' + ((r.participants && r.participants.total) || 0) + '人 / 券 ' + ((r.participants && r.participants.tickets) || 0) + '</td>' +
      '<td class="n">' + amt(r.paid || (r.decision && r.decision.paid) || 0) + ' / ' + amt(r.target) + ' BPT</td><td>' + (r.result ? r.result.combo.split('-').map((x) => Number(x) + 1).join(' → ') + '（' + r.result.odds + '倍）' : '') +
      (stuckOf(r.stuck) || stuck.find((x) => x.id === r.id) ? '<div class="err boatstuck">' + esc(stuckText(stuckOf(r.stuck) || stuck.find((x) => x.id === r.id))) + '</div>' : '') + '</td>' +
      '<td>' + (r.status !== 'done' && r.status !== 'void' ? '<button class="btn sm ghost" data-void="' + esc(r.id) + '"' + dis + '>取り消す</button>' : '') + '</td></tr>').join('');
    return '<section class="card boatadm"><h2>ボートの時刻表</h2>' +
      '<p class="hint">ボートはいつも全店同時。時刻 ＝ 投票の締切（映像の始まり）。投票は ' + Math.round(cfg.voteSec / 60 * 10) / 10 + ' 分前から。1 レースはおよそ ' + Math.ceil((cfg.voteSec + 6 + 190 + cfg.resultSec) / 60) + ' 分。競馬と被る時刻（競馬の投票〜結果画面の最初の 2 分）と、朝 5 時の前後（4 時半〜5 時半ごろ）は保存できません。</p>' +
      '<div class="tbl"><table class="tt-rows"><tr class="hd"><th>使う</th><th>日</th><th>時刻（25 時表記）</th><th>1 レースの目安（BPT）</th><th></th></tr>' + rows + '</table></div>' +
      '<p><button class="btn sm" data-act="addrule">行を足す</button></p>' +
      '<h3>払う BPT</h3><div class="flds">' + num('target', '1 レースの目安（初期値）', 'BPT', '行の目安が空のとき（空にはできません）') + num('capRace', '1 レース上限', 'BPT', capHint, CAP) + num('capDay', '1 日上限', 'BPT', capHint, CAP) + '</div>' +
      '<ul class="boatwarn" id="boatWarn">' + warnHtml(e) + '</ul>' +
      '<p class="hint">お客さんが貯められる BPT は ' + amt(holdMax(cfg)) + ' まで（持ち上限。当たりで超える分は ' + amt(holdMax(cfg)) + ' で止まり、消えます。毎週月曜の朝 5 時にリセット）</p>' + // 2026-11-20 オーナー決定
      '<h3>時間</h3><div class="flds">' + num('voteSec', '投票の長さ', '秒') + num('resultSec', '結果画面の長さ', '秒') + '</div>' +
      '<h3>フライング・転覆</h3><div class="flds"><label class="fld"><input type="checkbox" data-c="incidentOn"' + (Number(e.cfg.incidentOn) > 0 ? ' checked' : '') + '><span>フライング・転覆を出す（本物の率: フライング 1.6%・転覆など 4.6%）</span></label></div>' +
      '<p class="hint">フライング・転覆の艇を含む券は、いつも返還します（BPT の券は BPT を戻します）</p>' + // 2026-11-20 オーナー決定: 「転覆の券も返還」の切り替えは消して、いつも返還

      (cs.length ? '<div class="err boatcs"><b>競馬と被る・近すぎる時刻</b><ul>' + cs.map((c) => '<li>' + esc(c.text) + '</li>').join('') + '</ul></div>' : '') +
      (S.err ? '<p class="err">' + esc(S.err) + '</p>' : '') +
      '<p><button class="btn" data-act="save"' + dis + '>保存する</button></p></section>' +
      '<section class="card"><h2>今日のボート <small class="hint">今日使った BPT ' + amt(d.used) + ' / 1 日上限 ' + amt(cfg.capDay) + '（発表待ちのレースの分も入っています）</small></h2>' + // 2026-11-20: 使った分は「決めた」ときに数える（発表の前でも 1 日の上限に入る）
      (stuckOther.length ? '<div class="err boatstuck"><b>処理が止まっているボートのレース</b><ul>' + stuckOther.map((x) => '<li>' + esc((x.at ? hm(x.at) + ' ' : '') + x.id + ': ' + stuckText(x)) + '</li>').join('') + '</ul></div>' : '') +
      (races ? '<div class="tbl"><table class="cards"><tr class="hd"><th>締切</th><th>状態</th><th class="n">参加</th><th class="n">払った / 目安</th><th>結果（1着 → 2着）</th><th></th></tr>' + races + '</table></div>' : '<p class="hint">今日のボートのレースはまだありません</p>') +
      '<p><button class="btn sm ghost" data-act="test"' + dis + '>すぐ始めるボートレース（2 分後に締切・確かめ用）</button> <button class="btn sm ghost" data-act="reload"' + dis + '>最新にする</button></p>' +
      (S.actErr ? '<p class="err boatact">' + esc(S.actErr) + '</p>' : '') + (S.loadErr ? '<p class="err boatload">' + esc(S.loadErr) + '</p>' : '') + '</section>';
  }
  function paint() { if (S.main && S.on) S.main.innerHTML = view(); } // S.on: ボートのタブを出している間だけ描く（読み込みの返事が、ほかのタブへ移ったあとに届いても、そのタブの中身を上書きしない）
  /* 読み込む。keep: 保存していない編集（S.dirty）があれば編集の中身は残し、今日のレースの一覧・被りだけ最新にする
     （2026-11-20 F12: 「最新にする」「すぐ始める」「取り消す」のあとの読み直しで、保存前の編集が消えていた）。古い返事があとから届いても上書きしない */
  async function load(keep) {
    const my = ++S.seq;
    try {
      const d = await S.ctx.api('boatConfig'); if (my !== S.seq) return;
      S.data = d; S.loadErr = ''; // 読めたら読み込みの赤字は消す（2026-11-21 I5）
      if (!(keep && S.dirty && S.edit)) { S.edit = { cfg: Object.assign({}, d.cfg), rules: rulesToEdit(d.cfg.rules) }; S.dirty = false; S.err = ''; S.conflicts = []; }
    } catch (e) { if (my !== S.seq) return; S.loadErr = (e && (e.body && e.body.message || e.message)) || '読めませんでした'; }
    paint();
  }
  // ボタンの処理の間はボタンを止める（2026-11-20 F14: 「すぐ始める」を続けて押すとレースが 2 つでき、「取り消す」も 2 回走った）
  // gen: 押したときのタブの世代。処理の途中でタブを離れて戻ったら（世代が変わったら）、戻ってきたあと赤字・編集・ボタンの状態に触らない（2026-11-21 J15）
  async function run(fn) {
    if (S.busy) return; S.busy = true; S.actErr = ''; paint();
    const gen = S.gen, live = () => gen === S.gen;
    try { await fn(live); } finally { if (live()) { S.busy = false; paint(); } }
  }
  const errOf = (e, d) => (e && (e.body && e.body.message || e.message)) || d;
  function bind(main) {
    if (main.__boatBound) return; main.__boatBound = true;
    main.addEventListener('input', (ev) => {
      if (!S.edit || !ev.target.closest('.boatadm')) return;
      const t = ev.target, tr = t.closest('tr[data-i]');
      if (t.dataset.k) { S.edit.cfg[t.dataset.k] = t.value; S.dirty = true; }
      if (t.dataset.c) { S.edit.cfg[t.dataset.c] = t.checked ? 1 : 0; S.dirty = true; }
      if (tr) { const x = S.edit.rules[Number(tr.dataset.i)]; if (!x) return; S.dirty = true; if (t.dataset.r === 'enabled') x.enabled = t.checked; else if (t.dataset.wd != null) { const k = Number(t.dataset.wd); x.weekdays = t.checked ? x.weekdays.concat([k]) : x.weekdays.filter((w) => Number(w) !== k); } else if (t.dataset.r) x[t.dataset.r] = t.value; }
      const w = main.querySelector('#boatWarn'); if (w) { const h = warnHtml(S.edit); if (w.__h !== h) { w.__h = h; w.innerHTML = h; } } // 大小の注意は打つたびに注意の所だけ書き換える（欄は描き直さない＝打っている字が消えない）
    });
    main.addEventListener('change', (ev) => { if (S.edit && ev.target.dataset && ev.target.dataset.r === 'kind' && ev.target.closest('.boatadm')) { const tr = ev.target.closest('tr[data-i]'), x = S.edit.rules[Number(tr.dataset.i)]; if (!x) return; x.kind = ev.target.value; S.dirty = true; paint(); } });
    main.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b || !S.main || !S.on || !S.edit || !b.closest('.card') || S.busy) return; // ボートのタブの中だけ・処理の途中は受けない
      if (b.dataset.del != null) { S.edit.rules.splice(Number(b.dataset.del), 1); S.dirty = true; return paint(); }
      if (b.dataset.void) {
        const id = b.dataset.void;
        if (!confirm('このボートのレースを取り消しますか？ BPT の券に使った BPT は全部戻します')) return;
        return run(async (live) => {
          try { const r = await S.ctx.api('boatRefund', id); S.ctx.toast('取り消しました（戻した BPT: ' + amt(Object.values((r && r.back) || {}).reduce((a, x) => a + (Number(x) || 0), 0)) + '）'); } catch (e) { S.ctx.toast(errOf(e, '取り消せませんでした')); if (live()) S.actErr = '取り消せませんでした: ' + errOf(e, ''); }
          if (live()) await load(true);
        });
      }
      const a = b.dataset.act;
      if (a === 'addrule') { S.edit.rules.push({ id: 'b' + Date.now().toString(36), enabled: true, kind: 'daily', weekdays: [], date: '', times: '', payout: '' }); S.dirty = true; return paint(); }
      if (a === 'reload') return run(() => load(true));
      // 「すぐ始める」が断られたら（競馬・ほかのボートと被る・朝 5 時の前後 など）、理由をボタンの下に赤字で残す（次の操作まで。2026-11-21）
      if (a === 'test') return run(async (live) => { try { await S.ctx.api('boatRace', { inSec: 120 }); S.ctx.toast('2 分後に締切のボートレースを作りました'); } catch (e) { S.ctx.toast(errOf(e, '作れませんでした')); if (live()) S.actErr = 'すぐ始めるボートレースは作れませんでした: ' + errOf(e, ''); } if (live()) await load(true); });
      if (a === 'save') return run(async (live) => {
        S.err = ''; S.conflicts = [];
        const bad = checkEdit(S.edit); if (bad) { S.err = bad; return; } // 空の目安・曜日なしは送らない（2026-11-21 I5）
        const sent = JSON.stringify(S.edit), ed = S.edit;
        try {
          const c = S.edit.cfg, body = { rules: editToRules(S.edit.rules), target: Number(c.target), capRace: Number(c.capRace), capDay: Number(c.capDay), voteSec: Number(c.voteSec), resultSec: Number(c.resultSec), incidentOn: Number(c.incidentOn) > 0 }; // 転覆の返還の切り替え（refundFall）は送らない（いつも返還。2026-11-20）
          await S.ctx.api('saveBoat', body); S.ctx.toast('ボートの時刻表を保存しました');
          if (!live() || S.edit !== ed) return; // 返事を待つ間にタブを離れて戻った: 新しい編集には触らない（J15）
          if (JSON.stringify(S.edit) === sent) S.dirty = false; // 保存の返事を待つ間に打った分は残す
          await load(true);
        } catch (e) { if (!live() || S.edit !== ed) return; S.err = errOf(e, '保存できませんでした'); S.conflicts = (e && e.body && e.body.conflicts) || []; } // 断られた理由（競馬と被る・朝 5 時の前後 など）は赤字で出す
      });
    });
  }
  { const st = document.createElement('style'); st.textContent = '.boatadm .flds{display:flex;flex-wrap:wrap;gap:10px 22px;margin:6px 0 10px}.boatadm .fld{display:flex;align-items:center;gap:8px}.boatadm .fld span{min-width:9em}.boatadm .fld input{width:120px}.boatadm .tms{width:100%;min-width:200px}.boatadm .pay{width:110px}.boatadm .wds{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}.boatadm .wds label{display:flex;align-items:center;gap:2px}.boatcs{background:rgba(255,80,60,.1);border:1px solid #b44;border-radius:10px;padding:8px 14px;margin:8px 0}.boatcs ul{margin:4px 0 0 18px;padding:0}.boatwarn{margin:0 0 10px 18px;padding:0;color:#e0a030;font-weight:700}.boatwarn:empty{display:none}.boatstuck{color:#e05040;font-weight:700;margin:4px 0}.boatstuck ul{margin:4px 0 0 18px;padding:0}'; document.head.appendChild(st); }
  // render: ボートのタブを出す（v2/admin.js）。reset: タブに入る前・出るときに呼ばれる（読み直す・保存していない編集を捨てる・途中の読み込みの返事は捨てる）。dirty: 保存していない編集があるか
  window.AdminBoat = { render(main, ctx) { if (!S.on) S.gen++; S.ctx = ctx; S.main = main; S.on = true; bind(main); paint(); if (!S.data) load(); }, reset() { S.on = false; S.gen++; S.seq++; S.data = null; S.edit = null; S.dirty = false; S.busy = false; S.err = ''; S.loadErr = ''; S.actErr = ''; S.conflicts = []; }, dirty: () => !!S.dirty, _rulesToEdit: rulesToEdit, _editToRules: editToRules };
})();
