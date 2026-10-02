/* マスター画面: 店舗・プリセット・集計。オーナーだけがログインして、全店舗の設定を配る。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (v) => Number(v).toLocaleString('en-US');
  const fmtDate = (ts) => { if (!ts) return '—'; const d = new Date(ts), p = (n) => ('0' + n).slice(-2); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const main = $('main');
  let tab = 'stores', stores = [], presets = [], editStore = null, editPreset = null, statsStore = null, statsData = null;
  let toastTimer = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }

  /* ---------- ログイン ---------- */
  async function start() {
    if (!Cloud.enabled) {
      main.innerHTML = '<div class="panel"><h3>クラウドが設定されていません</h3><p class="hint">cloud-config.js に Firebase の設定を入れると使えるようになります。</p></div>';
      return;
    }
    try { await Cloud.ready(); } catch (e) { main.innerHTML = '<div class="panel"><h3>接続できません</h3><p class="hint">' + esc(e.message) + '</p></div>'; return; }
    if (Cloud.masterUser()) return enter();
    main.innerHTML = '<div class="panel" id="login"><h3>ログイン</h3><p class="hint">オーナーのメールアドレスとパスワード（Firebase に登録したもの）</p>' +
      '<label class="f"><span>メールアドレス</span><input type="email" id="email" autocomplete="username"></label>' +
      '<label class="f"><span>パスワード</span><input type="password" id="pw" autocomplete="current-password"></label>' +
      '<div class="err" id="lerr"></div><div class="acts"><button class="btn" id="dologin">ログイン</button></div></div>';
    $('dologin').addEventListener('click', async () => {
      $('lerr').textContent = '';
      try { await Cloud.masterLogin($('email').value.trim(), $('pw').value); enter(); }
      catch (e) { $('lerr').textContent = 'ログインできませんでした。メールアドレスとパスワードを確認してください。'; }
    });
  }
  async function enter() {
    const u = Cloud.masterUser();
    $('who').textContent = u ? u.email : '';
    $('logout').style.display = '';
    $('tabs').style.display = '';
    await reload();
    render();
  }
  $('logout').addEventListener('click', async () => { await Cloud.masterLogout(); location.reload(); });
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; editStore = null; editPreset = null; document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); render(); });

  async function reload() {
    const st = await Cloud.listStores();
    stores = await Promise.all(st.map((s) => Cloud.getStore(s.id)));
    presets = (await Cloud.listPresets()).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
  }
  const presetName = (id) => { const p = presets.find((x) => x.id === id); return p ? p.name : '（未設定）'; };

  function render() {
    if (tab === 'stores') main.innerHTML = editStore ? viewStoreEdit() : viewStores();
    else if (tab === 'presets') main.innerHTML = editPreset ? viewPresetEdit() : viewPresets();
    else main.innerHTML = viewStats();
    main.classList.toggle('wide', tab === 'presets' && !!editPreset);
  }

  /* ---------- 店舗 ---------- */
  function viewStores() {
    return '<div class="panel"><h3>店舗</h3><p class="hint">店舗ごとにパスワードと、使えるプリセットを決めます。店舗の端末は起動時に店舗を選んでパスワードを入れます。</p>' +
      (stores.length ? '<div class="list">' + stores.map((s) => '<div class="item"><div class="name">' + esc(s.name) + '<small>使用中: ' + esc(presetName(s.activePresetId)) + '｜最終起動 ' + fmtDate(s.lastSeen) + (s.deviceVersion ? '（' + esc(s.deviceVersion) + '）' : '') + '</small></div><button class="btn sm ghost" data-act="store-edit" data-id="' + esc(s.id) + '">編集</button></div>').join('') + '</div>' : '<div class="empty">まだ店舗がありません</div>') +
      '<div class="acts"><button class="btn" data-act="store-new">店舗を追加</button></div></div>';
  }
  function viewStoreEdit() {
    const s = editStore;
    return '<div class="panel"><h3>' + (s.id ? '店舗を編集' : '店舗を追加') + '</h3>' +
      '<label class="f"><span>店舗名</span><input type="text" id="sname" value="' + esc(s.name || '') + '" maxlength="30"></label>' +
      '<label class="f"><span>店舗パスワード（4〜8桁の数字）' + (s.id ? '（変えないときは空のまま）' : '') + '</span><input type="text" id="spin" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="' + (s.id ? '変更する場合だけ入力' : '例: 2580') + '"></label>' +
      '<div class="panel" style="margin:10px 0"><h3 style="font-size:14px">使えるプリセット</h3>' + (presets.length ? presets.map((p) => '<label class="check"><input type="checkbox" data-pid="' + esc(p.id) + '" ' + ((s.presetIds || []).indexOf(p.id) >= 0 ? 'checked' : '') + '> ' + esc(p.name) + ' <span class="chip">期待値 ' + fmtN(Math.round(Engine.probStats(p.probs).ev)) + '</span></label>').join('') : '<div class="empty">先にプリセットを作ってください</div>') + '</div>' +
      '<label class="f"><span>いま使うプリセット（マスターから切り替え。店舗側でも選べます）</span><select id="sactive"><option value="">（未設定）</option>' + presets.map((p) => '<option value="' + esc(p.id) + '" ' + (s.activePresetId === p.id ? 'selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
      '<div class="err" id="serr"></div>' +
      '<div class="acts">' + (s.id ? '<button class="btn ghost" data-act="store-logout">端末を強制ログアウト</button><button class="btn danger" data-act="store-del">削除</button>' : '') + '<button class="btn ghost" data-act="store-cancel">戻る</button><button class="btn" data-act="store-save">保存</button></div></div>';
  }
  async function saveStore() {
    const s = editStore, name = $('sname').value.trim(), pin = $('spin').value.trim();
    const err = $('serr'); err.textContent = '';
    if (!name) { err.textContent = '店舗名を入力してください。'; return; }
    if ((!s.id || pin) && !/^\d{4,8}$/.test(pin)) { err.textContent = 'パスワードは4〜8桁の数字にしてください。'; return; }
    const presetIds = Array.from(document.querySelectorAll('[data-pid]:checked')).map((x) => x.dataset.pid);
    const active = $('sactive').value;
    if (active && presetIds.indexOf(active) < 0) presetIds.push(active);
    const data = { name, presetIds, activePresetId: active || null };
    if (pin) data.pin = Engine.makePin(pin);
    await Cloud.saveStore(s.id || null, data);
    toast('保存しました');
    editStore = null; await reload(); render();
  }

  /* ---------- プリセット ---------- */
  const PKEYS = (d) => Engine.probKeys(d);
  const probLabel = (k) => (k === 'NEXT' ? 'NEXT STAGE' : fmtN(+k));
  const pct = (x) => (Math.round(x * 1000000) / 10000) + '%';
  const FREE_DEFAULT = 8; // FREE SPIN ×1 が出る割合の初期値（%）
  const FREE_KEYS = ['freeRate', 'freeRate2', 'freeRate3'], FREE_DEFAULTS = [8, 3, 1], FREE_MAX = [50, 25, 25]; // ×1 / ×2 / ×3
  const freeN = (p, n) => (typeof p[FREE_KEYS[n - 1]] === 'number' ? p[FREE_KEYS[n - 1]] : FREE_DEFAULTS[n - 1]);
  const freeOf = (p) => freeN(p, 1);
  const r2 = (x) => Math.round(x * 100) / 100;
  // 開始直後の高額制限（最初の X 回は Y 以上を出さない）。Y は実際に出る金額の中から選ぶ
  const AMOUNTS = Engine.OUTCOMES.map((o) => o.value).filter((v, i, a) => v > 0 && a.indexOf(v) === i).sort((a, b) => a - b);
  const EARLY_DEFAULT = { on: false, plays: 10, min: 2000 };
  const earlyOf = (L) => Object.assign({}, EARLY_DEFAULT, (L && L.early) || {});
  function viewPresets() {
    return '<div class="panel"><h3>プリセット</h3><p class="hint">確率のセットです。店舗には名前だけが見えます。</p>' +
      (presets.length ? '<div class="list">' + presets.map((p) => '<div class="item"><div class="name">' + esc(p.name) + '<small>最終期待値 ' + fmtN(Math.round(Engine.probStats(p.probs).ev)) + '｜当選率 ' + pct(Engine.probStats(p.probs).win) + (p.limits && p.limits.on ? '｜1日 ' + (p.limits.total || '—') + '本まで' : '') + (earlyOf(p.limits).on ? '｜最初の ' + earlyOf(p.limits).plays + ' 回は ' + fmtN(earlyOf(p.limits).min) + ' 未満' : '') + '｜FREE SPIN ' + freeN(p, 1) + '/' + freeN(p, 2) + '/' + freeN(p, 3) + '%' + (p.test ? '｜<b style="color:var(--ng)">テスト用（記録しない）</b>' : '') + '</small></div><button class="btn sm ghost" data-act="preset-edit" data-id="' + esc(p.id) + '">編集</button></div>').join('') + '</div>' : '<div class="empty">まだプリセットがありません</div>') +
      '<div class="acts"><button class="btn" data-act="preset-new">プリセットを作る</button></div></div>';
  }
  function probSummary(p) {
    const v = Engine.validateProbs(p.probs), st = Engine.probStats(p.probs);
    return '<div class="summary"><div class="stat"><small>当選する確率（0以外）</small><b>' + pct(st.win) + '</b></div><div class="stat"><small>STAGE 2 / 3 に進む確率</small><b>' + pct(st.reach[2]) + ' / ' + pct(st.reach[3]) + '</b></div>' +
      '<div class="stat"><small>最終期待値（1回あたりの平均当選額）</small><b>' + fmtN(Math.round(st.ev)) + '</b></div></div>' +
      (v.ok ? '' : '<div class="err">' + v.errors.map(esc).join('<br>') + '</div>');
  }
  // 各ステージの見出しに出す合計（ちょうど 100% で緑）
  function sumBadge(p, stage) {
    const s = r2(Engine.probStats(p.probs).sums[stage]);
    return '<span class="sum ' + (s === 100 ? 'ok' : 'ng') + '" data-sum="' + stage + '">合計 ' + s + '%' + (s === 100 ? ' ✓' : s < 100 ? '（あと ' + r2(100 - s) + '%）' : '（' + r2(s - 100) + '% 多い）') + '</span>';
  }
  const saveMsg = (p) => (Engine.validateProbs(p.probs).ok ? '<span class="okmsg">保存できます</span>' : '<span class="err">各ステージの合計を 100% にしてください</span>');
  function viewPresetEdit() {
    const p = editPreset, L = p.limits;
    L.early = earlyOf(L);
    const stepRow = (label, val, attr, unit, hint) => '<div class="row"><div class="lbl">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</div><div class="stepper"><button data-act="step" data-d="-1" ' + attr + ' aria-label="減らす">◀</button><span class="pv">' + val + '<i>' + unit + '</i></span><button data-act="step" data-d="1" ' + attr + ' aria-label="増やす">▶</button></div></div>';
    return '<div class="panel"><h3>' + (p.id ? 'プリセットを編集' : 'プリセットを作る') + '</h3>' +
      '<label class="f"><span>名前（店舗に表示されます）</span><input type="text" id="pname" value="' + esc(p.name || '') + '" maxlength="20"></label>' +
      '<div class="row"><div class="lbl">テスト用プリセット<small>ON にすると、このプリセットで回した結果は配当履歴・合計・マスターの集計・当たり本数の制限のどれにも数えません。画面に「TEST」と表示されます</small></div><button class="btn sm ' + (p.test ? '' : 'ghost') + '" data-act="test-on">' + (p.test ? 'ON' : 'OFF') + '</button></div></div>' +
      '<div class="panel"><h3>各ステージの確率</h3><p class="hint">◀ ▶ で 1% ずつ（押しっぱなしで連続）。各ステージの合計をちょうど 100% にしてください。</p><div class="cols">' +
      Engine.STAGE_DEFS.map((d) => '<div class="stage"><h4><span>STAGE ' + d.stage + '</span>' + sumBadge(p, d.stage) + '</h4>' + PKEYS(d).map((k) => stepRow(probLabel(k), p.probs[d.stage][k], 'data-p="' + d.stage + ':' + k + '"', '%')).join('') + '</div>').join('') + '</div>' +
      '<div id="psum">' + probSummary(p) + '</div></div>' +
      '<div class="panel"><h3>FREE SPIN</h3><p class="hint">リールに同じ FREE SPIN が3本そろって、その回数だけ自動で回り直す演出が出る割合です（1回のスピンあたり）。演出なので、当選確率・期待値・回転数は変わりません。本当の結果は最後の回に出ます（×2・×3 の途中の回は 0 で止まります）。0% にした種類は、絵柄も出なくなります。</p>' +
      stepRow('FREE SPIN ×1 が出る割合', freeN(p, 1), 'data-f="1"', '%', 'もう1回まわる（0〜50%）') +
      stepRow('FREE SPIN ×2 が出る割合', freeN(p, 2), 'data-f="2"', '%', 'もう2回まわる（0〜25%）') +
      stepRow('FREE SPIN ×3 が出る割合', freeN(p, 3), 'data-f="3"', '%', 'もう3回まわる（0〜25%）') + '</div>' +
      '<div class="panel"><h3>1日の当たり本数制限</h3><p class="hint">毎日決まった時刻にカウントが 0 に戻り、次のリセットまでに出る当たりを上限までに抑えます（上限に達した分の確率はそのステージの 0 に回ります）。</p>' +
      '<div class="row"><div class="lbl">制限を使う</div><button class="btn sm ' + (L.on ? '' : 'ghost') + '" data-act="lim-on">' + (L.on ? 'ON' : 'OFF') + '</button></div>' +
      stepRow('リセット時刻', L.resetHour, 'data-l="hour"', ':00', '毎日この時刻にカウントが 0 に戻ります') +
      stepRow('1日の当たり本数の上限（合計）', L.total, 'data-l="total"', '本', '0 は無制限') +
      '<p class="hint" style="margin:18px 0 8px"><b style="color:var(--text)">金額ごとの上限</b>（任意。0 は制限なし）</p><div class="cols">' +
      Engine.STAGE_DEFS.map((d) => '<div class="stage"><h4><span>STAGE ' + d.stage + '</span></h4>' + Engine.OUTCOMES.filter((o) => o.stage === d.stage && o.value > 0).map((o) => stepRow(fmtN(o.value), L.max[o.key] || 0, 'data-l="' + o.key + '"', '回')).join('') + '</div>').join('') + '</div></div>' +
      (function () { const E = L.early; return '<div class="panel"><h3>開始直後の高額制限</h3><p class="hint">毎日のリセット時刻（上の設定）から数えて、<b style="color:var(--text)">最初の X 回のプレイでは、Y 以上の金額が当たらない</b>ようにします（その分の確率は、そのステージの 0 に回ります）。X 回を過ぎると通常どおりです。回数は端末ごとに数えます。</p>' +
        '<div class="row"><div class="lbl">この制限を使う</div><button class="btn sm ' + (E.on ? '' : 'ghost') + '" data-act="early-on">' + (E.on ? 'ON' : 'OFF') + '</button></div>' +
        stepRow('最初の何回まで（X）', E.plays, 'data-e="plays"', '回', '1〜999 回') +
        stepRow('いくら以上を出さないか（Y）', fmtN(E.min), 'data-e="min"', '以上', '例: 2,000 にすると、2,000・3,000・5,000・10,000… が出ません') + '</div>'; })() +
      (p.id ? '<div class="panel"><h3>このプリセットを削除</h3><p class="hint">配布中の店舗からも消えます。</p><div class="acts" style="justify-content:flex-start"><button class="btn danger" data-act="preset-del">削除する</button></div></div>' : '') +
      '<div class="savebar"><div class="msg"><span id="pstate">' + saveMsg(p) + '</span><div class="err" id="perr"></div></div><button class="btn ghost" data-act="preset-cancel">戻る</button><button class="btn" data-act="preset-save">保存</button></div>';
  }
  async function savePreset() {
    const p = editPreset, name = $('pname').value.trim(), err = $('perr');
    err.textContent = '';
    if (!name) { err.textContent = '名前を入力してください。'; return; }
    const v = Engine.validateProbs(p.probs);
    if (!v.ok) { err.textContent = v.errors.join(' / '); return; }
    await Cloud.savePreset(p.id || null, { name, probs: p.probs, limits: p.limits, freeRate: freeN(p, 1), freeRate2: freeN(p, 2), freeRate3: freeN(p, 3), test: !!p.test });
    toast('保存しました。配布中の店舗には自動で反映されます');
    editPreset = null; await reload(); render();
  }

  /* ---------- 集計 ---------- */
  function viewStats() {
    const sel = '<label class="f"><span>店舗</span><select id="stsel"><option value="">選んでください</option>' + stores.map((s) => '<option value="' + esc(s.id) + '" ' + (statsStore === s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label>';
    if (!statsStore || !statsData) return '<div class="panel"><h3>集計</h3>' + sel + '</div>';
    const d = statsData;
    const tot = d.days.reduce((a, x) => ({ plays: a.plays + x.plays, awarded: a.awarded + x.awarded, wins: a.wins + x.wins }), { plays: 0, awarded: 0, wins: 0 });
    const fmtDay = (k) => k.slice(4, 6).replace(/^0/, '') + '/' + k.slice(6, 8).replace(/^0/, '');
    return '<div class="panel"><h3>集計</h3>' + sel +
      '<div class="summary"><div class="stat"><small>プレイ回数（表示期間）</small><b>' + fmtN(tot.plays) + '</b></div><div class="stat"><small>当選額の合計</small><b>' + fmtN(tot.awarded) + '</b></div><div class="stat"><small>当たり本数</small><b>' + fmtN(tot.wins) + '</b></div><div class="stat"><small>1回あたりの平均</small><b>' + fmtN(tot.plays ? Math.round(tot.awarded / tot.plays) : 0) + '</b></div></div>' +
      '<table><tr><th>営業日</th><th class="n">回転</th><th class="n">当たり</th><th class="n">当選額</th></tr>' + (d.days.length ? d.days.map((x) => '<tr><td>' + fmtDay(x.day) + '</td><td class="n">' + fmtN(x.plays) + '</td><td class="n">' + fmtN(x.wins) + '</td><td class="n">' + fmtN(x.awarded) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">まだデータがありません</td></tr>') + '</table></div>' +
      '<div class="panel"><h3>直近のプレイ</h3><table><tr><th>日時</th><th>ステージ</th><th class="n">結果</th><th>プリセット</th></tr>' + (d.plays.length ? d.plays.map((x) => '<tr><td>' + fmtDate(x.ts) + '</td><td>STAGE ' + x.stage + '</td><td class="n">' + fmtN(x.value) + '</td><td>' + esc(presetName(x.presetId)) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">まだデータがありません</td></tr>') + '</table></div>';
  }
  async function loadStats(id) {
    statsStore = id; statsData = null;
    if (!id) return render();
    const [days, plays] = await Promise.all([Cloud.listDays(id, 31), Cloud.listPlays(id, 50)]);
    statsData = { days, plays };
    render();
  }

  /* ---------- 操作 ---------- */
  main.addEventListener('change', (e) => { if (e.target.id === 'stsel') loadStats(e.target.value); });
  main.addEventListener('input', (e) => { if (e.target.id === 'pname' && editPreset) editPreset.name = e.target.value; }); // 途中で画面を作り直しても名前が消えないように
  // ◀ ▶ を押しっぱなしにすると連続で増減する
  let holdT = 0, holdI = 0;
  const holdStop = () => { clearTimeout(holdT); clearInterval(holdI); };
  main.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-act="step"]');
    holdStop();
    if (!b) return;
    holdT = setTimeout(() => { holdI = setInterval(() => { if (!document.contains(b)) return holdStop(); b.click(); }, 70); }, 420);
  });
  ['pointerup', 'pointercancel', 'blur'].forEach((ev) => window.addEventListener(ev, holdStop));
  main.addEventListener('pointerleave', holdStop);
  main.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-act="step"]')) e.preventDefault(); });
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    try {
      switch (act) {
        case 'store-new': editStore = { name: '', presetIds: [], activePresetId: null }; return render();
        case 'store-edit': editStore = Object.assign({}, stores.find((s) => s.id === b.dataset.id)); return render();
        case 'store-cancel': editStore = null; return render();
        case 'store-save': return await saveStore();   // 失敗したときに下の catch でメッセージを出すため await する
        case 'store-logout': if (!confirm('この店舗の端末をログアウトさせます。端末は次回起動時に店舗の選び直しとパスワード入力が必要になります。')) return; await Cloud.saveStore(editStore.id, { logoutAt: Date.now() }); toast('ログアウトを指示しました'); return;
        case 'store-del': if (!confirm('店舗「' + editStore.name + '」を削除します。集計も消えます。')) return; await Cloud.deleteStore(editStore.id); editStore = null; await reload(); return render();
        case 'preset-new': editPreset = { name: '', probs: Engine.defaultProbs(), limits: { on: false, total: 0, max: {}, resetHour: 19 }, freeRate: FREE_DEFAULTS[0], freeRate2: FREE_DEFAULTS[1], freeRate3: FREE_DEFAULTS[2], test: false }; return render();
        case 'preset-edit': { const p = presets.find((x) => x.id === b.dataset.id); editPreset = JSON.parse(JSON.stringify({ id: p.id, name: p.name, probs: p.probs, limits: Object.assign({ on: false, total: 0, max: {}, resetHour: 19 }, p.limits || {}), freeRate: freeN(p, 1), freeRate2: freeN(p, 2), freeRate3: freeN(p, 3), test: !!p.test })); return render(); }
        case 'preset-cancel': editPreset = null; return render();
        case 'preset-save': return await savePreset();
        case 'preset-del': if (!confirm('プリセット「' + editPreset.name + '」を削除します。')) return; await Cloud.deletePreset(editPreset.id); editPreset = null; await reload(); return render();
        case 'test-on': editPreset.test = !editPreset.test; return render();
        case 'lim-on': editPreset.limits.on = !editPreset.limits.on; return render();
        case 'early-on': { const top = window.scrollY; editPreset.limits.early = earlyOf(editPreset.limits); editPreset.limits.early.on = !editPreset.limits.early.on; render(); window.scrollTo(0, top); return; }
        case 'step': {
          const d = +b.dataset.d, pv = b.parentNode.querySelector('.pv');
          const show = (v, unit) => { pv.innerHTML = v + '<i>' + unit + '</i>'; };
          if (b.dataset.p) {
            const pk = b.dataset.p.split(':'); const v = Number(editPreset.probs[pk[0]][pk[1]]) || 0;
            editPreset.probs[pk[0]][pk[1]] = Math.max(0, Math.min(100, Math.round((v + d) * 100) / 100));
            show(editPreset.probs[pk[0]][pk[1]], '%');
            $('psum').innerHTML = probSummary(editPreset);
            const badge = main.querySelector('[data-sum="' + pk[0] + '"]'); if (badge) badge.outerHTML = sumBadge(editPreset, +pk[0]);
            $('pstate').innerHTML = saveMsg(editPreset);
            return;
          }
          if (b.dataset.e) {
            const E = editPreset.limits.early = earlyOf(editPreset.limits);
            if (b.dataset.e === 'plays') { E.plays = Math.max(1, Math.min(999, (Number(E.plays) || 0) + d)); return show(E.plays, '回'); }
            const i = Math.max(0, AMOUNTS.indexOf(E.min)); E.min = AMOUNTS[Math.max(0, Math.min(AMOUNTS.length - 1, i + d))];
            return show(fmtN(E.min), '以上');
          }
          if (b.dataset.f) { const n = +b.dataset.f, key = FREE_KEYS[n - 1]; editPreset[key] = Math.max(0, Math.min(FREE_MAX[n - 1], freeN(editPreset, n) + d)); return show(editPreset[key], '%'); }
          const k = b.dataset.l, L = editPreset.limits;
          if (k === 'hour') { L.resetHour = (L.resetHour + d + 24) % 24; return show(L.resetHour, ':00'); }
          if (k === 'total') { L.total = Math.max(0, Math.min(999, (L.total || 0) + d)); return show(L.total, '本'); }
          const v = Math.max(0, Math.min(99, (Number(L.max[k]) || 0) + d)); if (v) L.max[k] = v; else delete L.max[k];
          return show(v, '回');
        }
      }
    } catch (err) { toast('失敗しました: ' + err.message); }
  });

  start();
})();
