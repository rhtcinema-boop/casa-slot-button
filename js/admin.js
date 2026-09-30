/* PIN入力・確認ダイアログ・設定画面（営業設定 / 管理者）。 */
const fmtN = (v) => Number(v).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyLabel = (key) => { const o = Engine.OUTCOME_BY_KEY[key]; return 'STAGE ' + o.stage + ' / ' + fmtN(o.value); };
const fmtDate = (ts) => {
  const d = new Date(ts), p = (n) => ('0' + n).slice(-2);
  return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
};
const sessLabel = (id) => (id ? 'S-' + ('000' + id).slice(-4) : '—');
const ROLE_JP = { staff: '営業設定', admin: '管理者' };

const UI = (function () {
  'use strict';
  const root = () => document.getElementById('ui');
  let toastTimer = 0;

  function toast(msg, kind) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = kind || ''), 3200);
    if (kind === 'err') Sfx.play('error');
  }

  /* 確認ダイアログ。Promise<boolean> */
  function confirm(o) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'scrim';
      wrap.innerHTML =
        '<div class="card dialog"><h2>' + esc(o.title) + '</h2><div class="body">' + o.html + '</div><div class="acts">' +
        (o.cancel === false ? '' : '<button class="btn ghost" data-r="0">' + esc(o.cancelLabel || 'キャンセル') + '</button>') +
        '<button class="btn ' + (o.danger ? 'danger' : '') + '" data-r="1">' + esc(o.ok || 'OK') + '</button></div></div>';
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        Sfx.play('button');
        wrap.remove();
        resolve(b.dataset.r === '1');
      });
      root().appendChild(wrap);
    });
  }

  /* PINパッド。check(pin) がエラー文字列を返す間は閉じない。Promise<pin|null> */
  function askPin(o) {
    return new Promise((resolve) => {
      const MIN = 4, MAX = 8;
      let pin = '';
      const wrap = document.createElement('div');
      wrap.className = 'scrim' + (o.solid ? ' solid' : '');
      wrap.innerHTML =
        '<div class="card pinpad"><h2>' + esc(o.title) + '</h2><p class="sub"></p><div class="pin-dots"></div><div class="pin-keys">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<button data-k="' + n + '">' + n + '</button>').join('') +
        '<button class="fn" data-k="del">削除</button><button data-k="0">0</button><button class="go" data-k="ok">決定</button></div>' +
        (o.cancelable === false ? '' : '<button class="cancel" data-k="cancel">キャンセル</button>') + '</div>';
      const pad = wrap.querySelector('.pinpad'), sub = wrap.querySelector('.sub'), dots = wrap.querySelector('.pin-dots'), go = wrap.querySelector('.go');
      const baseSub = o.sub || '4〜8桁の数字';
      function paint(err) {
        sub.textContent = err || baseSub;
        sub.className = 'sub' + (err ? ' err' : '');
        let h = '';
        for (let i = 0; i < Math.max(MIN, pin.length); i++) h += '<i class="' + (i < pin.length ? 'f' : '') + '"></i>';
        dots.innerHTML = h;
        go.disabled = pin.length < MIN;
      }
      function fail(msg) {
        pin = '';
        paint(msg);
        pad.classList.remove('bad'); void pad.offsetWidth; pad.classList.add('bad');
        Sfx.play('error');
      }
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b) return;
        const k = b.dataset.k;
        if (k === 'cancel') { Sfx.play('button'); wrap.remove(); return resolve(null); }
        if (k === 'del') { Sfx.play('key'); pin = pin.slice(0, -1); return paint(); }
        if (k === 'ok') {
          if (pin.length < MIN) return;
          const err = o.check ? o.check(pin) : null;
          if (err) return fail(err);
          Sfx.play('ok');
          wrap.remove();
          return resolve(pin);
        }
        if (pin.length >= MAX) return;
        Sfx.play('key');
        pin += k;
        paint();
      });
      paint();
      root().appendChild(wrap);
    });
  }

  /* 新しいPINを2回入力させて登録する。differFrom: 同一にしてはいけない既存PINレコード */
  async function askNewPin(title, o) {
    o = o || {};
    for (;;) {
      const p1 = await askPin({
        title, sub: o.sub || '4〜8桁の数字を入力', solid: o.solid, cancelable: o.cancelable,
        check: (p) => (o.differFrom && Engine.checkPin(p, o.differFrom) ? (o.differMsg || 'もう一方のPINと同じ番号は使用できません。') : o.differPin && p === o.differPin ? (o.differMsg || 'もう一方のPINと同じ番号は使用できません。') : null),
      });
      if (p1 === null) return null;
      const p2 = await askPin({ title: title + '（確認）', sub: '確認のためもう一度入力', solid: o.solid, cancelable: o.cancelable });
      if (p2 === null) return null;
      if (p1 === p2) return p1;
      toast('PINが一致しません。もう一度登録してください。', 'err');
    }
  }

  /* PIN認証。allowed に含まれる権限のPINなら {role,pin相当} を返す。連続失敗でロック。 */
  function authCheck(pin, allowed, context) {
    const s = Store.state, now = Date.now();
    if (s.auth.lockUntil > now) return { error: '連続して失敗したためロック中です。\n' + Math.ceil((s.auth.lockUntil - now) / 1000) + '秒後に再試行してください。' };
    let role = null;
    if (Engine.checkPin(pin, s.pins.admin)) role = 'admin';
    else if (Engine.checkPin(pin, s.pins.staff)) role = 'staff';
    if (role && allowed.indexOf(role) >= 0) {
      if (s.auth.fails) Store.transact((st) => { st.auth.fails = 0; });
      return { role };
    }
    let locked = false;
    Store.transact((st) => {
      st.auth.fails += 1;
      if (st.auth.fails >= 5) {
        st.auth.fails = 0; st.auth.lockUntil = now + 60000; locked = true;
        Store.log('AUTH_LOCKOUT', { context });
      }
    });
    if (locked) return { error: '5回連続で失敗したため60秒間ロックします。' };
    return { error: role ? 'このPINでは操作できません。' : 'PINが正しくありません。' };
  }

  async function auth(title, allowed, context, sub) {
    let role = null;
    const pin = await askPin({
      title, sub,
      check: (p) => { const r = authCheck(p, allowed, context); if (r.error) return r.error; role = r.role; return null; },
    });
    return pin === null ? null : role;
  }

  /* 数字入力パッド。Promise<number|null> */
  function askNumber(o) {
    return new Promise((resolve) => {
      let v = '';
      const wrap = document.createElement('div');
      wrap.className = 'scrim';
      wrap.innerHTML =
        '<div class="card pinpad"><h2>' + esc(o.title) + '</h2><p class="sub"></p><div class="num-show"></div><div class="pin-keys">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<button data-k="' + n + '">' + n + '</button>').join('') +
        '<button class="fn" data-k="del">削除</button><button data-k="0">0</button><button class="go" data-k="ok">決定</button></div>' +
        '<button class="cancel" data-k="cancel">キャンセル</button></div>';
      const sub = wrap.querySelector('.sub'), show = wrap.querySelector('.num-show'), go = wrap.querySelector('.go');
      const valid = () => v !== '' && +v >= (o.min || 0) && +v <= (o.max || 9999);
      const paint = () => { sub.textContent = o.sub || ''; show.textContent = v === '' ? '0' : String(+v); go.disabled = !valid(); };
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b) return;
        const k = b.dataset.k;
        if (k === 'cancel') { Sfx.play('button'); wrap.remove(); return resolve(null); }
        if (k === 'del') { Sfx.play('key'); v = v.slice(0, -1); return paint(); }
        if (k === 'ok') { if (!valid()) return; wrap.remove(); return resolve(+v); }
        if (v.length >= String(o.max || 9999).length) return;
        Sfx.play('key');
        v += k;
        paint();
      });
      paint();
      root().appendChild(wrap);
    });
  }

  return { toast, confirm, askPin, askNewPin, auth, askNumber };
})();

const Admin = (function () {
  'use strict';
  const PAGE = 50;
  const TYPES = {
    PLAY: ['play', 'プレイ'], OVERFLOW_PLAY: ['over', '超過プレイ'],
    SESSION_START: ['ops', '営業開始'], SESSION_END: ['ops', '営業終了'], NEXT_PLAY: ['ops', '次のプレイ'], CREDIT_ADD: ['ops', 'クレジット追加'], CREDIT_SET: ['ops', 'クレジット変更'], TOTAL: ['ops', 'クレジット終了'],
    PROB_SET: ['cfg', '確率変更'], STATS_RESET: ['ops', '集計リセット'],
    DRAFT_SAVE: ['cfg', '設定保存'], ADJUST: ['cfg', '残存内訳調整'], CAP_RULES: ['cfg', '上限ルール変更'],
    PIN_SETUP: ['pin', 'PIN初期登録'], PIN_STAFF_REISSUE: ['pin', '営業設定PIN再発行'], PIN_ADMIN_CHANGE: ['pin', '管理者PIN変更'],
    AUTH_LOCKOUT: ['pin', 'PIN連続失敗'], ADMIN_LOGIN: ['pin', '設定画面ログイン'],
  };
  const GROUPS = [['all', 'すべて'], ['play', 'プレイ'], ['ops', '営業'], ['cfg', '設定変更'], ['pin', 'PIN・認証']];

  let el = null, role = null, tab = 'ops';
  let form = null;      // 営業開始前の編集中設定 { total, counts }
  let adjust = null;    // 営業途中の残存内訳編集 { counts } | null
  let capForm = null;
  let hist = { all: null, group: 'all', session: 'all', page: 0 };

  const tabsFor = (r) => r === 'admin'
    ? [['ops', '確率設定'], ['history', '全履歴'], ['changes', '設定変更履歴'], ['pins', 'PIN管理'], ['misc', 'その他']]
    : [['ops', '確率設定']];
  const TITLES = { ops: '確率設定', history: '全履歴', changes: '設定変更履歴', caps: 'プライズ上限ルール', pins: 'PIN管理', misc: 'その他' };
  let probForm = null;  // 編集中の確率 { stage: { key: % } }
  const copyProbs = (p) => JSON.parse(JSON.stringify(p));
  const probLabel = (k) => (k === 'NEXT' ? 'NEXT STAGE' : fmtN(+k));
  const pct = (x) => (Math.round(x * 1000000) / 10000) + '%';

  function probSummary() {
    const v = Engine.validateProbs(probForm), st = Engine.probStats(probForm);
    const changed = JSON.stringify(probForm) !== JSON.stringify(Store.state.probs);
    return '<div class="summary">' +
      Engine.STAGE_DEFS.map((d) => stat('STAGE ' + d.stage + ' の合計', st.sums[d.stage] + '%', st.sums[d.stage] === 100 ? 'ok' : 'ng')).join('') +
      stat('当選する確率（0以外）', pct(st.win)) + stat('STAGE 2 に進む確率', pct(st.reach[2])) + stat('STAGE 3 に進む確率', pct(st.reach[3])) +
      '</div><div class="summary">' + stat('最終期待値（1回あたりの平均当選額）', fmtN(Math.round(st.ev))) + '</div>' +
      errorsHtml(v.errors, changed ? '入力内容に問題はありません。保存すると次のプレイから反映されます。' : '') +
      '<div class="acts"><button class="btn ghost" data-act="prob-reset" ' + (changed ? '' : 'disabled') + '>元に戻す</button>' +
      '<button class="btn" data-act="prob-save" ' + (v.ok && changed ? '' : 'disabled') + '>確率を保存</button></div>';
  }
  function viewProbs() {
    const s = Store.state, ses = s.session;
    return '<div class="panel"><h4>各ステージの確率</h4><p class="hint">ステージごとに、それぞれの目で止まる確率（％）を ◀ ▶ で増減します。各ステージの合計をちょうど 100% にしてください。NEXT STAGE は次のステージに進む確率です。プレイヤー画面には確率は表示されません。</p></div>' +
      '<div class="cols3">' + Engine.STAGE_DEFS.map((d) =>
        '<div class="panel"><h4>STAGE ' + d.stage + '</h4>' +
        Engine.probKeys(d).map((k) => { const p = d.stage + ':' + k; return '<div class="row"><div class="lbl">' + probLabel(k) + '</div><div class="stepper pstep"><button data-act="pstep" data-d="-1" data-p="' + p + '">◀</button><span class="pv">' + probForm[d.stage][k] + '<i>%</i></span><button data-act="pstep" data-d="1" data-p="' + p + '">▶</button></div></div>'; }).join('') +
        '</div>').join('') + '</div>' +
      '<div id="live">' + probSummary() + '</div>' +
      '<div class="panel"><h4>集計</h4><div class="summary">' + stat('プレイ回数', fmtN(ses.playNo)) + stat('当選額の合計', fmtN(ses.awarded)) + '</div><div class="acts" style="justify-content:flex-start"><button class="btn sm ghost" data-act="stats-reset">集計をリセット</button></div></div>';
  }

  function loadForm() {
    const d = Store.state.draft;
    form = { total: d ? d.total : 0, counts: Object.assign(Engine.emptyCounts(), d ? d.counts : {}) };
    adjust = null;
  }

  function open(r) {
    role = r; tab = 'ops';
    loadForm();
    probForm = copyProbs(Store.state.probs);
    capForm = null;
    hist = { all: null, group: 'all', session: 'all', page: 0 };
    if (!el) {
      el = document.createElement('div');
      el.className = 'adm';
      el.addEventListener('click', onClick);
      el.addEventListener('input', onInput);
      el.addEventListener('change', onChange);
    }
    document.getElementById('ui').appendChild(el);
    render();
  }
  function close() {
    if (el) el.remove();
    role = null;
    Game.refresh();
  }
  const isOpen = () => !!role;

  /* ---------- 描画 ---------- */
  function render() {
    const s = Store.state;
    const nav = tabsFor(role).map(([k, n]) => '<button class="tab ' + (k === tab ? 'on' : '') + '" data-act="tab" data-tab="' + k + '">' + n + '</button>').join('');
    const keepScroll = el.querySelector('.adm-body') ? el.querySelector('.adm-body').scrollTop : 0;
    el.innerHTML =
      '<nav class="adm-nav"><h2>SETTINGS</h2><div class="role">' + ROLE_JP[role] + 'PINでログイン中</div>' + nav +
      '<div class="sp"></div><button class="btn ghost" data-act="close">閉じる</button></nav>' +
      '<section class="adm-main"><div class="adm-head"><h3>' + TITLES[tab] + '</h3>' +
      '<span class="pill on">プレイ ' + fmtN(s.session ? s.session.playNo : 0) + ' 回</span></div>' +
      '<div class="adm-body">' + body() + '</div></section>';
    el.querySelector('.adm-body').scrollTop = keepScroll;
  }
  function body() {
    if (tab === 'ops') return viewProbs();
    if (tab === 'history' || tab === 'changes') return viewHistory();
    if (tab === 'caps') return viewCaps();
    if (tab === 'pins') return viewPins();
    return viewMisc();
  }

  function stepper(attr, val, wide) {
    return '<div class="stepper"><button data-act="step" data-d="-1" ' + attr + '>−</button>' +
      '<input class="num ' + (wide ? 'wide' : '') + '" type="number" inputmode="numeric" pattern="[0-9]*" min="0" step="1" value="' + val + '" ' + attr + '>' +
      '<button data-act="step" data-d="1" ' + attr + '>＋</button></div>';
  }
  function stageCols(cell) {
    return '<div class="cols3">' + Engine.STAGE_DEFS.map((d) =>
      '<div class="panel"><h4>STAGE ' + d.stage + ' で終了</h4>' +
      d.values.map((v) => { const key = d.stage + ':' + v; return '<div class="row"><div class="lbl">' + fmtN(v) + '</div>' + cell(key) + '</div>'; }).join('') +
      '</div>').join('') + '</div>';
  }
  function stat(label, value, cls) {
    return '<div class="stat ' + (cls || '') + '"><small>' + label + '</small><b>' + value + '</b></div>';
  }
  function errorsHtml(errors, okText) {
    if (errors.length) return '<ul class="errors">' + errors.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>';
    return okText ? '<div class="okmsg">' + okText + '</div>' : '';
  }

  /* --- 営業開始前 --- */
  function setupSummary() {
    const v = Engine.validateSetup(form.total, form.counts, Store.state.capRules);
    const sumOk = v.sum === form.total && form.total >= 1;
    return '<div class="summary">' +
      stat('総本数', Number.isFinite(form.total) ? fmtN(form.total) : '—') +
      stat('各結果の合計', Number.isFinite(v.sum) ? fmtN(v.sum) : '—', sumOk ? 'ok' : 'ng') +
      stat('プライズ総額', Number.isFinite(v.prize) ? fmtN(v.prize) : '—', v.prize <= v.cap ? 'ok' : 'ng') +
      stat('プライズ上限', Number.isFinite(v.cap) ? fmtN(v.cap) : '—') + '</div>' +
      errorsHtml(v.errors, '設定内容に問題はありません。保存・営業開始が可能です。') +
      '<div class="acts"><button class="btn ghost" data-act="clear-form">すべて0に戻す</button>' +
      '<button class="btn ghost" data-act="save-draft" ' + (v.ok ? '' : 'disabled') + '>設定を保存</button>' +
      '<button class="btn" data-act="start" ' + (v.ok ? '' : 'disabled') + '>営業開始へ進む</button></div>';
  }
  function viewSetup() {
    return '<div class="panel"><h4>総本数</h4><p class="hint">総本数と、下の各最終結果の本数合計が一致している必要があります。プレイヤー画面には本数・確率は一切表示されません。</p>' +
      '<div class="row"><div class="lbl" style="font-family:var(--font-ui);font-size:20px">本日の総本数<small>各結果の合計と一致させてください</small></div>' +
      '<div class="stepper"><button class="w" data-act="step" data-d="-5" data-f="total">−5</button>' + stepper('data-f="total"', form.total, true) +
      '<button class="w" data-act="step" data-d="5" data-f="total">＋5</button><button class="btn sm ghost" data-act="fit-total">合計に合わせる</button></div></div></div>' +
      stageCols((key) => stepper('data-k="' + key + '"', form.counts[key])) +
      '<div id="live">' + setupSummary() + '</div>';
  }

  /* --- 営業中 --- */
  function viewSession() {
    const s = Store.state, ses = s.session;
    const remain = Engine.sumCounts(ses.remaining);
    const cap = Engine.capFor(ses.total, s.capRules);
    return '<div class="summary">' +
      stat('総本数', fmtN(ses.total)) + stat('消化済み', fmtN(ses.total - remain)) + stat('残り本数', fmtN(remain), remain > 0 ? 'ok' : 'ng') + stat('超過プレイ', fmtN(ses.overflowCount), ses.overflowCount ? 'ng' : '') +
      stat('払出済みプライズ', fmtN(ses.awarded)) + stat('残存プライズ', fmtN(Engine.prizeTotal(ses.remaining))) + stat('プライズ上限', fmtN(cap)) + stat('開始日時', '<span style="font:600 17px var(--font-ui)">' + fmtDate(ses.startedAt) + '</span>') +
      '</div>' +
      (remain === 0 ? '<ul class="errors"><li>抽選可能回数がありません。営業を終了して設定し直してください。</li></ul>' : '') +
      '<div class="panel"><h4>内訳</h4><table class="tbl"><tr><th>最終結果</th><th class="n">初期本数</th><th class="n">消化済み</th><th class="n">残り</th></tr>' +
      Engine.OUTCOMES.map((o) => '<tr><td>' + keyLabel(o.key) + '</td><td class="n">' + ses.initial[o.key] + '</td><td class="n">' + ses.consumed[o.key] + '</td><td class="n">' + ses.remaining[o.key] + '</td></tr>').join('') +
      '</table></div>' +
      '<div class="panel"><h4>クレジット</h4><div class="row"><div class="lbl" style="font-family:var(--font-ui);font-size:20px">残クレジット<small>1プレイで1消費。0 になると NEXT GAME でPINを求めます</small></div>' +
      '<div class="stepper"><span class="lbl" style="min-width:70px;text-align:center">' + (s.credits || 0) + '</span><button class="btn sm ghost" data-act="credit-set">クレジットを変更</button></div></div></div>' +
      '<div class="acts"><button class="btn ghost" data-act="adjust" ' + (remain > 0 ? '' : 'disabled') + '>残存内訳を調整</button>' +
      '<button class="btn danger" data-act="end">営業終了</button></div>';
  }
  function adjustSummary() {
    const s = Store.state, ses = s.session;
    const v = Engine.validateAdjust(ses, adjust.counts, s.capRules);
    const changed = Engine.OUTCOMES.some((o) => adjust.counts[o.key] !== ses.remaining[o.key]);
    return '<div class="summary">' +
      stat('残り総本数（固定）', fmtN(v.remain)) +
      stat('変更後の合計', Number.isFinite(v.sum) ? fmtN(v.sum) : '—', v.sum === v.remain ? 'ok' : 'ng') +
      stat('払出済み＋残存プライズ', Number.isFinite(v.prize) ? fmtN(v.prize) : '—', v.prize <= v.cap ? 'ok' : 'ng') +
      stat('プライズ上限', fmtN(v.cap)) + '</div>' +
      errorsHtml(v.errors, changed ? '変更内容に問題はありません。' : '') +
      '<div class="acts"><button class="btn ghost" data-act="adjust-cancel">キャンセル</button>' +
      '<button class="btn" data-act="adjust-save" ' + (v.ok && changed ? '' : 'disabled') + '>変更内容を確認</button></div>';
  }
  function viewAdjust() {
    const ses = Store.state.session;
    return '<div class="panel"><h4>残存内訳の調整</h4><p class="hint">残り本数の内訳だけを変更します。消化済みの結果と残り総本数は変わりません。ある結果を減らした分だけ、別の結果を増やしてください。</p></div>' +
      stageCols((key) => '<div style="display:flex;align-items:center;gap:12px"><span style="font-size:14px;color:#8e8672">現在 ' + ses.remaining[key] + '</span>' + stepper('data-a="' + key + '"', adjust.counts[key]) + '</div>') +
      '<div id="live">' + adjustSummary() + '</div>';
  }

  /* --- 履歴 --- */
  function describe(e) {
    const d = e.data || {};
    const counts = (c) => Engine.OUTCOMES.filter((o) => c[o.key] > 0).map((o) => keyLabel(o.key) + ' ×' + c[o.key]).join('、') || 'なし';
    switch (e.type) {
      case 'PLAY':
        return 'プレイ #' + d.playNo + '｜<b>STAGE ' + d.stage + ' / ' + fmtN(d.value) + '</b>｜通過: ' + d.path.map((p) => 'STAGE ' + p).join(' → ');
      case 'PROB_SET': {
        const f = (p) => Engine.STAGE_DEFS.map((x) => 'STAGE ' + x.stage + '［' + Engine.probKeys(x).map((k) => probLabel(k) + ' ' + p[x.stage][k] + '%').join('、') + '］').join(' ');
        return '変更前: ' + f(d.before) + '<br>変更後: ' + f(d.after);
      }
      case 'STATS_RESET': return 'プレイ ' + d.plays + ' 回・当選額合計 ' + fmtN(d.awarded) + ' をリセット';
      case 'OVERFLOW_PLAY':
        return 'プレイ #' + d.playNo + '｜<b>超過プレイ / 0</b>（STAGE ' + d.stage + ' で終了）｜通過: ' + d.path.map((p) => 'STAGE ' + p).join(' → ') + '｜残本数 ' + d.remainBefore + ' → ' + d.remainAfter + '（在庫消費なし）';
      case 'SESSION_START':
        return '総本数 ' + d.total + '｜プライズ総額 ' + fmtN(d.prize) + ' / 上限 ' + fmtN(d.cap) + '<br>内訳: ' + counts(d.counts);
      case 'SESSION_END':
        return '総本数 ' + d.total + '｜消化 ' + d.consumedTotal + '｜未消化で破棄 ' + d.remainTotal + '｜払出済みプライズ ' + fmtN(d.awarded) + '｜超過プレイ ' + d.overflowCount +
          (d.remainTotal ? '<br>破棄した残存内訳: ' + counts(d.remaining) : '');
      case 'NEXT_PLAY':
        return 'プレイ #' + d.playNo + ' の結果確認後、次のプレイへ' + (d.credits !== undefined ? '｜残クレジット ' + d.credits : '');
      case 'CREDIT_ADD':
        return d.amount + ' クレジット追加｜' + d.before + ' → ' + d.after;
      case 'TOTAL':
        return 'クレジットを使い切り｜合計当選額 <b>' + fmtN(d.total) + '</b>';
      case 'CREDIT_SET':
        return 'クレジットを変更｜' + d.before + ' → ' + d.after;
      case 'DRAFT_SAVE':
        return '総本数 ' + d.total + '｜プライズ総額 ' + fmtN(d.prize) + '<br>内訳: ' + counts(d.counts);
      case 'ADJUST':
        return '残り ' + d.remainTotal + ' 本の内訳を変更｜' + d.changes.map((c) => keyLabel(c.key) + ': ' + c.from + ' → ' + c.to).join('、') +
          '<br>残存プライズ ' + fmtN(d.prizeBefore) + ' → ' + fmtN(d.prizeAfter);
      case 'CAP_RULES': {
        const f = (r) => r.ranges.map((x) => x.from + '〜' + x.to + ': ' + fmtN(x.cap)).join('、') + '、以降 ' + r.beyond.step + ' エントリーごとに +' + fmtN(r.beyond.inc);
        return '変更前: ' + f(d.before) + '<br>変更後: ' + f(d.after);
      }
      case 'PIN_SETUP': return '管理者PINを初期登録';
      case 'PIN_STAFF_REISSUE': return '営業設定PINを再発行（旧PINは即時無効）';
      case 'PIN_ADMIN_CHANGE': return '管理者PINを変更';
      case 'AUTH_LOCKOUT': return 'PIN入力を5回連続で失敗（60秒ロック）｜場面: ' + esc(d.context || '');
      case 'ADMIN_LOGIN': return '設定画面にログイン';
      default: return esc(JSON.stringify(d));
    }
  }
  function histFiltered() {
    const fixed = tab === 'changes' ? 'cfg' : hist.group;
    return (hist.all || []).filter((e) => {
      const g = (TYPES[e.type] || ['etc'])[0];
      if (fixed !== 'all' && g !== fixed) return false;
      if (hist.session !== 'all' && String(e.sessionId) !== hist.session) return false;
      return true;
    });
  }
  function viewHistory() {
    if (!hist.all) {
      Store.readLog().then((all) => { hist.all = all; if (role && (tab === 'history' || tab === 'changes')) render(); });
      return '<div class="panel">読み込み中…</div>';
    }
    const list = histFiltered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    hist.page = Math.min(hist.page, pages - 1);
    const rows = list.slice(hist.page * PAGE, hist.page * PAGE + PAGE);
    const sessions = Array.from(new Set(hist.all.map((e) => e.sessionId).filter((x) => x))).sort((a, b) => b - a);
    return '<div class="filters">' +
      (tab === 'history' ? GROUPS.map(([k, n]) => '<button class="chip ' + (hist.group === k ? 'on' : '') + '" data-act="hist-group" data-g="' + k + '">' + n + '</button>').join('') : '') +
      '<select class="sel" data-sel="session"><option value="all">全セッション</option>' + sessions.map((id) => '<option value="' + id + '" ' + (String(id) === hist.session ? 'selected' : '') + '>' + sessLabel(id) + '</option>').join('') + '</select>' +
      '<span style="flex:1"></span><span style="color:#8e8672;font-size:16px">' + list.length + ' 件</span>' +
      '<button class="btn sm ghost" data-act="csv">CSV出力</button></div>' +
      '<div class="panel" style="padding:8px 14px"><table class="tbl"><tr><th>No.</th><th>日時</th><th>セッション</th><th>種別</th><th>権限</th><th>内容</th></tr>' +
      (rows.length ? rows.map((e) => {
        const t = TYPES[e.type] || ['', e.type];
        return '<tr><td class="nw">' + e.id + '</td><td class="nw">' + fmtDate(e.ts) + '</td><td class="nw">' + sessLabel(e.sessionId) + '</td><td><span class="tag ' + t[0] + '">' + t[1] + '</span></td><td class="nw">' + (ROLE_JP[e.role] || '—') + '</td><td>' + describe(e) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:#8e8672;padding:40px">該当する履歴はありません</td></tr>') +
      '</table></div>' +
      '<div class="pager"><button class="btn sm ghost" data-act="hist-page" data-d="-1" ' + (hist.page > 0 ? '' : 'disabled') + '>前へ</button><span>' + (hist.page + 1) + ' / ' + pages + '</span>' +
      '<button class="btn sm ghost" data-act="hist-page" data-d="1" ' + (hist.page < pages - 1 ? '' : 'disabled') + '>次へ</button></div>';
  }
  function exportCsv() {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = ['No,日時,セッション,種別,権限,内容,データ'];
    histFiltered().slice().reverse().forEach((e) => {
      const text = describe(e).replace(/<br>/g, ' / ').replace(/<[^>]+>/g, '');
      lines.push([e.id, q(fmtDate(e.ts)), q(sessLabel(e.sessionId)), q((TYPES[e.type] || ['', e.type])[1]), q(ROLE_JP[e.role] || ''), q(text), q(JSON.stringify(e.data))].join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'casa-slot-history-' + fmtDate(Date.now()).replace(/[/: ]/g, '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  /* --- プライズ上限ルール --- */
  function capErrors() {
    const errs = Engine.validateCapRules(capForm);
    return errorsHtml(errs, '') + '<div class="acts"><button class="btn ghost" data-act="cap-reset">編集を取り消す</button><button class="btn" data-act="cap-save" ' + (errs.length ? 'disabled' : '') + '>ルールを保存</button></div>';
  }
  function viewCaps() {
    if (!capForm) capForm = JSON.parse(JSON.stringify(Store.state.capRules));
    const last = capForm.ranges.length - 1;
    return '<div class="panel"><h4>総本数ごとのプライズ総額上限</h4><p class="hint">「何エントリー〜何エントリーまでは、プライズ総額いくらまで」を設定します。開始エントリーは前の行の終了+1に自動で連動します。</p>' +
      '<table class="tbl"><tr><th>開始エントリー</th><th></th><th>終了エントリー</th><th>プライズ総額上限</th><th></th></tr>' +
      capForm.ranges.map((r, i) => '<tr><td class="n" style="text-align:left;font-size:26px">' + r.from + '</td><td>〜</td>' +
        '<td><input class="num" type="number" inputmode="numeric" min="0" value="' + r.to + '" data-c="to" data-i="' + i + '"></td>' +
        '<td><input class="num wide" type="number" inputmode="numeric" min="0" step="1000" value="' + r.cap + '" data-c="cap" data-i="' + i + '"></td>' +
        '<td>' + (i === last && i > 0 ? '<button class="btn sm ghost" data-act="cap-del">この行を削除</button>' : '') + '</td></tr>').join('') +
      '</table><div class="acts" style="justify-content:flex-start;margin-top:16px"><button class="btn sm ghost" data-act="cap-add">行を追加</button></div></div>' +
      '<div class="panel"><h4>最終行を超える総本数の扱い</h4><div class="row"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">最終行の終了エントリーを超えた分は ' +
      '<input class="num" type="number" inputmode="numeric" min="1" value="' + capForm.beyond.step + '" data-c="step"> エントリー増えるごとに ' +
      '<input class="num wide" type="number" inputmode="numeric" min="0" step="1000" value="' + capForm.beyond.inc + '" data-c="inc"> を加算</div></div></div>' +
      '<div id="live">' + capErrors() + '</div>';
  }

  function viewPins() {
    return '<div class="panel"><h4>管理者PIN</h4><p class="hint">設定画面を開くためのPINです。忘れると設定画面を開けなくなります。厳重に管理してください。</p><div class="acts" style="justify-content:flex-start"><button class="btn ghost" data-act="pin-admin">管理者PINを変更</button></div></div>';
  }
  function viewMisc() {
    const fs = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    return '<div class="panel"><h4>効果音の音量</h4><div class="row"><input class="vol" type="range" min="0" max="100" value="' + Math.round(Store.state.settings.volume * 100) + '" data-vol>' +
      '<button class="btn sm ghost" data-act="test-sound">テスト再生</button></div></div>' +
      (fs ? '<div class="panel"><h4>表示</h4><div class="acts" style="justify-content:flex-start"><button class="btn sm ghost" data-act="fullscreen">フルスクリーン切替</button></div></div>' : '') +
      (function () { const p = Store.state.settings.perf || {}; const sw = (k, label, hint) => '<div class="row"><div class="lbl" style="font-family:var(--font-ui);font-size:19px">' + label + '<small>' + hint + '</small></div><button class="btn sm ' + (p[k] ? '' : 'ghost') + '" data-act="perf" data-k="' + k + '">' + (p[k] ? 'ON' : 'OFF') + '</button></div>';
        return '<div class="panel"><h4>動作が重いときの診断</h4><p class="hint">どれをONにすると軽くなるかで、重さの原因を切り分けられます。</p>' +
          sw('meter', 'コマ時間を表示', '画面の左下に、直近5秒の最大コマ時間と、33ms・50msを超えた回数を出します') +
          sw('noBg', '背景の光のアニメを止める', '回転する光条・サーチライト・外周の光・LED・電球の点滅を止めます') +
          sw('noFx', '粒子を止める', '火花・チップ・紙吹雪などを出しません') +
          sw('lite', '軽量モード', '残響・扉の枚数・粒子・影を減らして軽くします（テレビ版は常にON。切り替えると再読み込みします）') + '</div>'; })() +
      '<div class="panel"><h4>データ</h4><dl class="kv"><dt>履歴件数</dt><dd>' + Store.state.logSeq + ' 件（営業終了しても削除されません）</dd><dt>保存先</dt><dd>この端末のブラウザ内ストレージ</dd></dl>' +
      '<p class="hint" style="margin-top:14px">ホーム画面に追加したアプリとして使用すると、データが自動削除されにくくなります。ブラウザの「履歴とWebサイトデータを消去」を行うと全データが失われます。</p></div>';
  }

  /* ---------- 操作 ---------- */
  function refreshLive() {
    const live = el.querySelector('#live');
    if (!live) return;
    if (tab === 'ops') live.innerHTML = probSummary();
    else if (tab === 'caps') live.innerHTML = capErrors();
    else if (adjust) live.innerHTML = adjustSummary();
    else live.innerHTML = setupSummary();
  }
  const parseNum = (v) => (String(v).trim() === '' ? 0 : Number(v));

  function onInput(e) {
    const t = e.target;
    if (t.dataset.vol !== undefined) { Sfx.setVolume(t.value / 100); return; }
    if (!t.classList.contains('num')) return;
    const v = parseNum(t.value);
    if (t.dataset.p) { const pk = t.dataset.p.split(':'); probForm[pk[0]][pk[1]] = v; }
    else if (t.dataset.f === 'total') form.total = v;
    else if (t.dataset.k) form.counts[t.dataset.k] = v;
    else if (t.dataset.a) adjust.counts[t.dataset.a] = v;
    else if (t.dataset.c) {
      const c = t.dataset.c;
      if (c === 'step' || c === 'inc') capForm.beyond[c] = v;
      else capForm.ranges[+t.dataset.i][c] = v;
    }
    refreshLive();
  }
  function onChange(e) {
    const t = e.target;
    if (t.dataset.vol !== undefined) { Store.transact((s) => { s.settings.volume = t.value / 100; }); return; }
    if (t.dataset.sel === 'session') { hist.session = t.value; hist.page = 0; render(); return; }
    if (t.dataset.c === 'to') { // 次の行の開始エントリーを連動
      for (let i = 1; i < capForm.ranges.length; i++) capForm.ranges[i].from = capForm.ranges[i - 1].to + 1;
      render();
    }
  }

  async function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    Sfx.play('button');
    try {
      switch (act) {
        case 'close': return close();
        case 'tab': tab = b.dataset.tab; adjust = null; hist.page = 0; if (tab === 'history' || tab === 'changes') hist.all = null; return render();
        case 'step': {
          const d = +b.dataset.d;
          const bump = (v) => Math.max(0, (Number.isFinite(v) ? Math.floor(v) : 0) + d);
          if (b.dataset.f === 'total') form.total = bump(form.total);
          else if (b.dataset.k) form.counts[b.dataset.k] = bump(form.counts[b.dataset.k]);
          else if (b.dataset.a) adjust.counts[b.dataset.a] = bump(adjust.counts[b.dataset.a]);
          return render();
        }
        case 'pstep': {
          const pk = b.dataset.p.split(':'), d = +b.dataset.d;
          const v = Number(probForm[pk[0]][pk[1]]) || 0;
          probForm[pk[0]][pk[1]] = Math.max(0, Math.min(100, Math.round((v + d) * 100) / 100));
          return render();
        }
        case 'prob-reset': probForm = copyProbs(Store.state.probs); return render();
        case 'prob-save': {
          if (!Engine.validateProbs(probForm).ok) return;
          Store.transact((st) => { const before = st.probs; st.probs = copyProbs(probForm); Store.log('PROB_SET', { before, after: st.probs }, role); });
          UI.toast('確率を保存しました。次のプレイから反映されます。', 'ok');
          return render();
        }
        case 'stats-reset': {
          const ok = await UI.confirm({ title: '集計をリセット', html: '<p>プレイ回数・合計当選額・画面右の「直近の当選」を 0 に戻します。履歴は消えません。</p>', ok: 'リセットする' });
          if (!ok) return;
          Store.transact((st) => { Store.log('STATS_RESET', { plays: st.session.playNo, awarded: st.session.awarded, total: st.wonTotal || 0 }, role); st.session.playNo = 0; st.session.awarded = 0; st.wonTotal = 0; st.recent = []; });
          UI.toast('集計をリセットしました。', 'ok');
          return render();
        }
        case 'fit-total': form.total = Engine.sumCounts(form.counts) || 0; return render();
        case 'clear-form': form = { total: 0, counts: Engine.emptyCounts() }; return render();
        case 'save-draft': return saveDraft();
        case 'start': return startSession();
        case 'adjust': adjust = { counts: Object.assign({}, Store.state.session.remaining) }; return render();
        case 'adjust-cancel': adjust = null; return render();
        case 'adjust-save': return saveAdjust();
        case 'end': return endSession();
        case 'credit-set': {
          const n = await UI.askNumber({ title: 'クレジットを変更', sub: '設定するクレジット数（0〜99）', min: 0, max: 99 });
          if (n === null) return;
          Store.transact((st) => { const before = st.credits || 0; st.credits = n; Store.log('CREDIT_SET', { before, after: n }, role); });
          UI.toast('クレジットを ' + n + ' にしました。', 'ok');
          return render();
        }
        case 'hist-group': hist.group = b.dataset.g; hist.page = 0; return render();
        case 'hist-page': hist.page += +b.dataset.d; return render();
        case 'csv': return exportCsv();
        case 'cap-add': {
          const l = capForm.ranges[capForm.ranges.length - 1];
          capForm.ranges.push({ from: l.to + 1, to: l.to + Math.max(1, capForm.beyond.step || 5), cap: l.cap + (capForm.beyond.inc || 0) });
          return render();
        }
        case 'cap-del': capForm.ranges.pop(); return render();
        case 'cap-reset': capForm = null; return render();
        case 'cap-save': return saveCaps();
        case 'pin-staff': return reissueStaffPin();
        case 'pin-admin': return changeAdminPin();
        case 'test-sound': return Sfx.play('winSmall');
        case 'perf': {
          const k = b.dataset.k;
          Store.transact((st) => { st.settings.perf = Object.assign({}, st.settings.perf); st.settings.perf[k] = !st.settings.perf[k]; });
          Game.applyPerf();
          return render();
        }
        case 'fullscreen': {
          const d = document, r = d.documentElement;
          if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
          else (r.requestFullscreen || r.webkitRequestFullscreen).call(r);
          return;
        }
      }
    } catch (err) {
      UI.toast('処理に失敗しました: ' + err.message, 'err');
      render();
    }
  }

  function breakdownHtml(counts) {
    return '<table class="tbl">' + Engine.STAGE_DEFS.map((d) =>
      d.values.map((v, i) => '<tr>' + (i === 0 ? '<td rowspan="' + d.values.length + '" class="nw">STAGE ' + d.stage + '</td>' : '') + '<td class="n">' + fmtN(v) + '</td><td class="n">× ' + counts[d.stage + ':' + v] + ' 本</td></tr>').join('')).join('') + '</table>';
  }

  function saveDraft() {
    const s = Store.state;
    const v = Engine.validateSetup(form.total, form.counts, s.capRules);
    if (!v.ok) return UI.toast(v.errors[0], 'err');
    Store.transact((st) => {
      st.draft = { total: form.total, counts: Object.assign({}, form.counts) };
      Store.log('DRAFT_SAVE', { total: form.total, counts: st.draft.counts, prize: v.prize, cap: v.cap }, role);
    });
    UI.toast('設定を保存しました。', 'ok');
    render();
  }

  async function startSession() {
    const v = Engine.validateSetup(form.total, form.counts, Store.state.capRules);
    if (!v.ok) return UI.toast(v.errors[0], 'err');
    const ok = await UI.confirm({
      title: '営業開始の最終確認', ok: 'この内容で営業開始', cancelLabel: '戻る',
      html: '<div class="summary" style="grid-template-columns:repeat(3,1fr);margin-top:0">' + stat('総本数', fmtN(form.total)) + stat('プライズ総額', fmtN(v.prize)) + stat('適用されるプライズ上限', fmtN(v.cap)) + '</div>' + breakdownHtml(form.counts) +
        '<p style="color:#8e8672;font-size:16px">開始後は総本数を変更できません（残存内訳の調整のみ可能）。</p>',
    });
    if (!ok) return;
    // 確認中に状態が変わっていないか再検証してから確定
    const v2 = Engine.validateSetup(form.total, form.counts, Store.state.capRules);
    if (!v2.ok || Store.state.session) return UI.toast('営業を開始できません。設定を確認してください。', 'err');
    Store.transact((st) => {
      st.sessionSeq += 1;
      st.session = Engine.createSession(st.sessionSeq, form.total, form.counts, st.capRules, Date.now());
      st.draft = { total: form.total, counts: Object.assign({}, form.counts) };
      st.play = null; st.locked = false;
      Store.log('SESSION_START', { total: form.total, counts: st.draft.counts, prize: v2.prize, cap: v2.cap }, role);
    });
    UI.toast('営業を開始しました。', 'ok');
    render();
  }

  async function saveAdjust() {
    const ses = Store.state.session;
    const v = Engine.validateAdjust(ses, adjust.counts, Store.state.capRules);
    if (!v.ok) return UI.toast(v.errors[0], 'err');
    const changes = Engine.OUTCOMES.filter((o) => adjust.counts[o.key] !== ses.remaining[o.key]).map((o) => ({ key: o.key, from: ses.remaining[o.key], to: adjust.counts[o.key] }));
    if (!changes.length) return;
    const ok = await UI.confirm({
      title: '残存内訳の変更確認', ok: '変更を確定',
      html: '<table class="tbl"><tr><th>最終結果</th><th class="n">変更前</th><th class="n">変更後</th><th class="n">差</th></tr>' +
        changes.map((c) => '<tr><td>' + keyLabel(c.key) + '</td><td class="n">' + c.from + '</td><td class="n">' + c.to + '</td><td class="n ' + (c.to > c.from ? 'diff-up">+' : 'diff-down">') + (c.to - c.from) + '</td></tr>').join('') +
        '</table><p>残り総本数 ' + v.remain + ' 本は変わりません。この変更は履歴に記録されます。</p>',
    });
    if (!ok) return;
    const target = adjust.counts;
    Store.transact((st) => {
      // 確認中に在庫が動いていないこと（=表示した変更前と一致）を保証
      const cur = st.session;
      changes.forEach((c) => { if (cur.remaining[c.key] !== c.from) throw new Error('在庫が変化したため変更を中止しました。'); });
      const chk = Engine.validateAdjust(cur, target, st.capRules);
      if (!chk.ok) throw new Error(chk.errors[0]);
      const prizeBefore = Engine.prizeTotal(cur.remaining);
      Engine.OUTCOMES.forEach((o) => { cur.remaining[o.key] = target[o.key]; });
      Store.log('ADJUST', { remainTotal: chk.remain, changes, prizeBefore, prizeAfter: Engine.prizeTotal(cur.remaining), awarded: cur.awarded, cap: chk.cap }, role);
    });
    adjust = null;
    UI.toast('残存内訳を変更しました。', 'ok');
    render();
  }

  async function endSession() {
    const ses = Store.state.session;
    const remain = Engine.sumCounts(ses.remaining);
    const ok = await UI.confirm({
      title: '営業終了の確認', ok: '営業終了を確定', danger: true,
      html: '<p>営業を終了すると、当日の残存本数・抽選状態・営業用設定がすべてリセットされます。<br>履歴は削除されません。次回営業時はゼロから設定してください。</p>' +
        '<dl class="kv"><dt>総本数</dt><dd>' + ses.total + '</dd><dt>消化済み</dt><dd>' + (ses.total - remain) + '</dd><dt>未消化（破棄）</dt><dd>' + remain + '</dd><dt>払出済みプライズ</dt><dd>' + fmtN(ses.awarded) + '</dd></dl>',
    });
    if (!ok) return;
    Store.transact((st) => {
      const c = st.session;
      Store.log('SESSION_END', {
        total: c.total, consumedTotal: c.total - Engine.sumCounts(c.remaining), remainTotal: Engine.sumCounts(c.remaining),
        initial: c.initial, consumed: c.consumed, remaining: c.remaining, awarded: c.awarded, overflowCount: c.overflowCount, plays: c.playNo, startedAt: c.startedAt, creditsLeft: st.credits || 0,
      }, role);
      st.session = null; st.draft = null; st.play = null; st.locked = false; st.credits = 0; st.wonTotal = 0;
    });
    loadForm();
    UI.toast('営業を終了しました。', 'ok');
    render();
  }

  async function saveCaps() {
    const errs = Engine.validateCapRules(capForm);
    if (errs.length) return UI.toast(errs[0], 'err');
    const ok = await UI.confirm({ title: 'プライズ上限ルールの変更', ok: '保存する', html: '<p>このルールは保存直後から、設定保存・営業開始・残存内訳調整の上限チェックに適用されます。</p>' });
    if (!ok) return;
    Store.transact((st) => {
      const before = st.capRules;
      st.capRules = JSON.parse(JSON.stringify(capForm));
      Store.log('CAP_RULES', { before, after: st.capRules }, role);
    });
    capForm = null;
    UI.toast('プライズ上限ルールを保存しました。', 'ok');
    render();
  }

  async function reissueStaffPin() {
    const pin = await UI.askNewPin('新しい営業設定PIN', { differFrom: Store.state.pins.admin, differMsg: '管理者PINと同じ番号は使用できません。' });
    if (pin === null) return;
    Store.transact((st) => { st.pins.staff = Engine.makePin(pin); Store.log('PIN_STAFF_REISSUE', {}, role); });
    UI.toast('営業設定PINを再発行しました。古いPINは無効です。', 'ok');
  }
  async function changeAdminPin() {
    const pin = await UI.askNewPin('新しい管理者PIN', {});
    if (pin === null) return;
    Store.transact((st) => { st.pins.admin = Engine.makePin(pin); Store.log('PIN_ADMIN_CHANGE', {}, role); });
    UI.toast('管理者PINを変更しました。', 'ok');
  }

  return { open, close, isOpen };
})();
