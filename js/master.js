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
  // casa ロゴ3つ = 10 FREE SPIN（本物の追加プレイ）が出る割合。予算が増えるので初期値は 0（出ない）
  const LOGO_SPINS = 10, LOGO_MAX = 5;
  const logoOf = (p) => (typeof p.logoRate === 'number' ? p.logoRate : 0);
  const noRetrig = (p) => p.noRetrigger !== false; // FREE SPIN で回っているゲームでは FREE SPIN を出さない（未設定は ON）
  // FREE SPIN ×1〜×3 と casa ロゴは、どちらも本物の追加プレイ（CREDIT）。その分を含めた期待値の目安。
  // 1スピンあたりに増える CREDIT = ×1 の割合×1 + ×2 の割合×2 + ×3 の割合×3 + ロゴの割合×10。
  // 抽選はスピンごとなので（1プレイで STAGE 2・3 に進むと回数が増える）、有料プレイ1回あたりは 平均スピン数 を掛ける
  function creditCost(p) {
    const st = Engine.probStats(p.probs), ev = st.ev;
    const perSpin = (freeN(p, 1) + freeN(p, 2) * 2 + freeN(p, 3) * 3 + logoOf(p) * LOGO_SPINS) / 100;
    const r = perSpin * (1 + st.reach[2] + st.reach[3]);
    if (r <= 0) return '<span class="okmsg">オフ（FREE SPIN も casa ロゴも出ません。予算は変わりません）</span>';
    // FREE SPIN 中に FREE SPIN を出さないなら、増えるのはその回数ぶんだけ（1 + r 倍）。出すなら、その中でもまたそろうので 1 / (1 - r) 倍
    if (!noRetrig(p) && r >= 1) return '<span class="err">割合が高すぎます（FREE SPIN が終わらなくなります）</span>';
    const k = noRetrig(p) ? 1 + r : 1 / (1 - r);
    return '<span class="err" style="color:var(--gold)">予算の目安: 1回の有料プレイあたりの期待値が <b>' + fmtN(Math.round(ev)) + ' → ' + fmtN(Math.round(ev * k)) + '</b>（約 ' + (Math.round(k * 1000) / 10) + '%）になります。FREE SPIN（×1〜×3 と casa ロゴの合計）の追加プレイは、有料プレイ 100 回あたり約 ' + (Math.round((k - 1) * 1000) / 10) + ' 回ぶんです。</span>';
  }
  const refreshCost = () => { main.querySelectorAll('.ccost').forEach((el) => { el.innerHTML = creditCost(editPreset); }); };
  // 開始直後の高額制限（最初の X 回は Y 以上を出さない）。Y は実際に出る金額の中から選ぶ
  const amountsOf = (p) => { const a = []; Engine.tableOf(p.probs).forEach((d) => d.values.forEach((v) => { if (v > 0 && a.indexOf(v) < 0) a.push(v); })); return a.sort((x, y) => x - y); };
  const EARLY_DEFAULT = { on: false, plays: 10, min: 2000 };
  const earlyOf = (L) => Object.assign({}, EARLY_DEFAULT, (L && L.early) || {});
  function viewPresets() {
    return '<div class="panel"><h3>プリセット</h3><p class="hint">確率のセットです。店舗には名前だけが見えます。</p>' +
      (presets.length ? '<div class="list">' + presets.map((p) => '<div class="item"><div class="name">' + esc(p.name) + '<small>最終期待値 ' + fmtN(Math.round(Engine.probStats(p.probs).ev)) + '｜当選率 ' + pct(Engine.probStats(p.probs).win) + (p.limits && p.limits.on ? '｜1日 ' + (p.limits.total || '—') + '本まで' : '') + (earlyOf(p.limits).on ? '｜最初の ' + earlyOf(p.limits).plays + ' 回は ' + fmtN(earlyOf(p.limits).min) + ' 未満' : '') + '｜FREE SPIN ' + freeN(p, 1) + '/' + freeN(p, 2) + '/' + freeN(p, 3) + '%' + (logoOf(p) > 0 ? '｜ロゴ10回 ' + logoOf(p).toFixed(1) + '%' : '') + (p.test ? '｜<b style="color:var(--ng)">テスト用（記録しない）</b>' : '') + '</small></div><button class="btn sm ghost" data-act="preset-edit" data-id="' + esc(p.id) + '">編集</button></div>').join('') + '</div>' : '<div class="empty">まだプリセットがありません</div>') +
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
  const saveMsg = (p) => { const v = Engine.validateProbs(p.probs); return v.ok ? '<span class="okmsg">保存できます</span>' : '<span class="err">' + esc(v.errors[0]) + '</span>'; };
  /* 配当表の1行。金額の行は、金額そのものを書き換えられて × で消せる。0（ハズレ）と NEXT STAGE は固定 */
  function probRow(p, d, k) {
    const attr = 'data-p="' + d.stage + ':' + k + '"', fixed = k === '0' || k === 'NEXT';
    const lbl = fixed ? '<div class="lbl">' + (k === 'NEXT' ? 'NEXT STAGE' : '0<small>ハズレ</small>') + '</div>'
      : '<div class="lbl"><input type="number" class="amtin" inputmode="numeric" min="1" step="100" value="' + k + '" data-amt="' + d.stage + ':' + k + '" aria-label="STAGE ' + d.stage + ' の金額"></div>';
    return '<div class="row prow">' + lbl + '<div class="stepper"><button data-act="step" data-d="-1" ' + attr + ' aria-label="減らす">◀</button><span class="pv">' + p.probs[d.stage][k] + '<i>%</i></span><button data-act="step" data-d="1" ' + attr + ' aria-label="増やす">▶</button></div>' +
      (fixed ? '<span class="del ph"></span>' : '<button class="del" data-act="amt-del" data-k="' + d.stage + ':' + k + '" aria-label="' + fmtN(+k) + ' の行を消す">×</button>') + '</div>';
  }
  function probStage(p, d) {
    const n = d.values.length - 1, full = n >= Engine.MAX_AMOUNTS;
    return '<div class="stage"><h4><span>STAGE ' + d.stage + '</span>' + sumBadge(p, d.stage) + '</h4>' + PKEYS(d).map((k) => probRow(p, d, k)).join('') +
      '<div class="addrow"><button class="btn sm ghost" data-act="amt-add" data-s="' + d.stage + '"' + (full ? ' disabled' : '') + '>＋ 金額を追加</button><small>' + (full ? '金額は ' + Engine.MAX_AMOUNTS + ' 種類までです' : '金額 ' + n + ' / ' + Engine.MAX_AMOUNTS + ' 種類') + '</small></div></div>';
  }
  function viewPresetEdit() {
    const p = editPreset, L = p.limits;
    L.early = earlyOf(L);
    const stepRow = (label, val, attr, unit, hint) => '<div class="row"><div class="lbl">' + label + (hint ? '<small>' + hint + '</small>' : '') + '</div><div class="stepper"><button data-act="step" data-d="-1" ' + attr + ' aria-label="減らす">◀</button><span class="pv">' + val + '<i>' + unit + '</i></span><button data-act="step" data-d="1" ' + attr + ' aria-label="増やす">▶</button></div></div>';
    return '<div class="panel"><h3>' + (p.id ? 'プリセットを編集' : 'プリセットを作る') + '</h3>' +
      '<label class="f"><span>名前（店舗に表示されます）</span><input type="text" id="pname" value="' + esc(p.name || '') + '" maxlength="20"></label>' +
      '<div class="row"><div class="lbl">テスト用プリセット<small>ON にすると、このプリセットで回した結果は配当履歴・合計・マスターの集計・当たり本数の制限のどれにも数えません。画面に「TEST」と表示されます</small></div><button class="btn sm ' + (p.test ? '' : 'ghost') + '" data-act="test-on">' + (p.test ? 'ON' : 'OFF') + '</button></div></div>' +
      '<div class="panel"><h3>各ステージの配当と確率</h3><p class="hint"><b style="color:var(--text)">金額は数字を直接書き換えられます。</b>「＋ 金額を追加」で行を増やし、× で消せます（消した行の確率は 0 に足されます）。確率は ◀ ▶ で 1% ずつ（押しっぱなしで連続）。<b style="color:var(--text)">数字を押すと、直接入力もできます</b>（小数も可。ほかの欄の数字も同じです）。各ステージの合計をちょうど 100% にしてください。下に、1回あたりの平均当選額（予算の目安）が出ます。</p><div class="cols pcols">' +
      Engine.tableOf(p.probs).map((d) => probStage(p, d)).join('') + '</div>' +
      '<p class="hint" style="margin-top:10px">金額を増やしたり消したりしたプリセットは、店舗の端末が b52 以上になってから反映されます（端末は 1 時間以内に自動でアップデートします。店舗一覧で端末の版を確認できます）。</p>' +
      '<div id="psum">' + probSummary(p) + '</div></div>' +
      '<div class="panel"><h3>FREE SPIN ×1・×2・×3</h3><p class="hint">リールに同じ FREE SPIN が3本そろうと、<b style="color:var(--text)">その回数ぶんの FREE SPIN（本物の追加プレイ）</b>を獲得します（b58 から。それまでは演出だけでした）。端末の CREDIT が 1・2・3 増え、STAGE 1 から 1 回ずつ普通に抽選します。<b style="color:var(--text)">当選額が増える</b>ので、下の予算の目安を見て割合を決めてください（1回のスピンあたりの割合）。0% にした種類は、絵柄も出なくなります。</p>' +
      stepRow('FREE SPIN ×1 が出る割合', freeN(p, 1), 'data-f="1"', '%', 'CREDIT +1（0〜50%）') +
      stepRow('FREE SPIN ×2 が出る割合', freeN(p, 2), 'data-f="2"', '%', 'CREDIT +2（0〜25%）') +
      stepRow('FREE SPIN ×3 が出る割合', freeN(p, 3), 'data-f="3"', '%', 'CREDIT +3（0〜25%）') +
      '<div class="ccost" style="margin-top:8px;font-size:14px">' + creditCost(p) + '</div></div>' +
      '<div class="panel"><h3>casa ロゴ3つ ＝ 10 FREE SPIN</h3><p class="hint">リールに casa のロゴが3本そろうと、<b style="color:var(--text)">10 回ぶんの FREE SPIN（本物の追加プレイ）</b>を獲得します。端末の CREDIT が 10 増え、CREDIT がなくなるまで自動で回り続けます（1回ごとに普通に抽選します）。FREE SPIN は毎回 STAGE 1 から回ります。<b style="color:var(--text)">当選額が増える</b>ので、割合は慎重に決めてください。0% ならロゴは出ず、画面上部の説明も出ません。</p>' +
      stepRow('casa ロゴが3本そろう割合', logoOf(p).toFixed(1), 'data-g="1"', '%', '1回のスピンあたり（0〜5%、0.1% きざみ）') +
      '<div class="ccost" style="margin-top:8px;font-size:14px">' + creditCost(p) + '</div>' +
      '<div class="row" style="margin-top:10px"><div class="lbl">FREE SPIN で回っている間は、FREE SPIN を出さない<small>ON: 獲得した FREE SPIN（CREDIT）で回っているゲームでは、FREE SPIN ×1〜×3 も casa ロゴも出ません（絵柄も出ません）。OFF: FREE SPIN 中にも、さらに FREE SPIN を獲得できます（そのぶん予算が増えます）</small></div><button class="btn sm ' + (noRetrig(p) ? '' : 'ghost') + '" data-act="retrig-on">' + (noRetrig(p) ? 'ON' : 'OFF') + '</button></div></div>' +
      '<div class="panel"><h3>1日の当たり本数制限</h3><p class="hint">毎日決まった時刻にカウントが 0 に戻り、次のリセットまでに出る当たりを上限までに抑えます（上限に達した分の確率はそのステージの 0 に回ります）。</p>' +
      '<div class="row"><div class="lbl">制限を使う</div><button class="btn sm ' + (L.on ? '' : 'ghost') + '" data-act="lim-on">' + (L.on ? 'ON' : 'OFF') + '</button></div>' +
      stepRow('リセット時刻', L.resetHour, 'data-l="hour"', ':00', '毎日この時刻にカウントが 0 に戻ります') +
      stepRow('1日の当たり本数の上限（合計）', L.total, 'data-l="total"', '本', '0 は無制限') +
      '<p class="hint" style="margin:18px 0 8px"><b style="color:var(--text)">金額ごとの上限</b>（任意。0 は制限なし）</p><div class="cols">' +
      Engine.tableOf(p.probs).map((d) => '<div class="stage"><h4><span>STAGE ' + d.stage + '</span></h4>' + (d.values.filter((v) => v > 0).map((v) => stepRow(fmtN(v), L.max[d.stage + ':' + v] || 0, 'data-l="' + d.stage + ':' + v + '"', '回')).join('') || '<div class="empty" style="padding:8px 0">金額がありません</div>') + '</div>').join('') + '</div></div>' +
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
    await Cloud.savePreset(p.id || null, { name, probs: p.probs, limits: p.limits, freeRate: freeN(p, 1), freeRate2: freeN(p, 2), freeRate3: freeN(p, 3), logoRate: logoOf(p), noRetrigger: noRetrig(p), test: !!p.test });
    toast('保存しました。配布中の店舗には自動で反映されます');
    editPreset = null; await reload(); render();
  }

  /* ---------- 集計（期間を指定できる。日付は営業日＝当たりのリセット時刻で切り替わる日） ---------- */
  const PLAY_MAX = 200; // 期間内のプレイの一覧に出す件数の上限
  let statsRange = null; // { from: 'yyyy-mm-dd', to: 'yyyy-mm-dd' }（営業日）
  const p2 = (n) => ('0' + n).slice(-2);
  const iso = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const isoToDate = (s) => { const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
  const addDays = (s, n) => { const d = isoToDate(s); d.setDate(d.getDate() + n); return iso(d); };
  // その店舗で使用中のプリセットのリセット時刻（営業日の切り替わり）。未設定は 19 時
  function resetHourOf(storeId) {
    const s = stores.find((x) => x.id === storeId), pr = s && presets.find((x) => x.id === s.activePresetId);
    return pr && pr.limits && Number.isInteger(pr.limits.resetHour) ? pr.limits.resetHour : 19;
  }
  // いまの営業日（リセット時刻より前なら前日の日付）
  const bizToday = (storeId) => iso(new Date(Engine.windowStart(Date.now(), resetHourOf(storeId))));
  function quickRange(q, storeId) {
    const t = bizToday(storeId), d = isoToDate(t);
    if (q === 'today') return { from: t, to: t };
    if (q === 'yesterday') return { from: addDays(t, -1), to: addDays(t, -1) };
    if (q === '7') return { from: addDays(t, -6), to: t };
    if (q === 'month') return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: t };
    if (q === 'last') return { from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) };
    return { from: addDays(t, -30), to: t }; // 直近31日
  }
  const QUICK = [['today', '今日'], ['yesterday', '昨日'], ['7', '直近7日'], ['month', '今月'], ['last', '先月'], ['31', '直近31日']];
  function viewStats() {
    const sel = '<label class="f"><span>店舗</span><select id="stsel"><option value="">選んでください</option>' + stores.map((s) => '<option value="' + esc(s.id) + '" ' + (statsStore === s.id ? 'selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label>';
    if (!statsStore) return '<div class="panel"><h3>集計</h3>' + sel + '</div>';
    const R = statsRange || quickRange('31', statsStore), rh = resetHourOf(statsStore);
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    const fmtDay = (k) => { const d = new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')'; };
    const isQ = (q) => { const x = quickRange(q, statsStore); return x.from === R.from && x.to === R.to; };
    const period = '<div class="range"><label class="f"><span>開始（営業日）</span><input type="date" id="stfrom" value="' + R.from + '" max="' + R.to + '"></label><label class="f"><span>終了（営業日）</span><input type="date" id="stto" value="' + R.to + '" min="' + R.from + '"></label></div>' +
      '<div class="quick">' + QUICK.map((q) => '<button class="btn sm ' + (isQ(q[0]) ? '' : 'ghost') + '" data-act="st-quick" data-q="' + q[0] + '">' + q[1] + '</button>').join('') + '</div>' +
      '<p class="hint" style="margin-top:8px">営業日は、当たりのリセット時刻（' + rh + ':00）で切り替わります。たとえば ' + fmtDay(R.from.replace(/-/g, '')) + ' の営業日は、その日の ' + rh + ':00 から翌日の ' + rh + ':00 の直前までです。</p>';
    if (!statsData) return '<div class="panel"><h3>集計</h3>' + sel + period + '<div class="empty">読み込み中…</div></div>';
    const d = statsData;
    const tot = d.days.reduce((a, x) => ({ plays: a.plays + (x.plays || 0), awarded: a.awarded + (x.awarded || 0), wins: a.wins + (x.wins || 0) }), { plays: 0, awarded: 0, wins: 0 });
    return '<div class="panel"><h3>集計</h3>' + sel + period +
      '<div class="summary"><div class="stat"><small>プレイ回数（この期間）</small><b>' + fmtN(tot.plays) + '</b></div><div class="stat"><small>当選額の合計</small><b>' + fmtN(tot.awarded) + '</b></div><div class="stat"><small>当たり本数</small><b>' + fmtN(tot.wins) + '</b></div><div class="stat"><small>1回あたりの平均</small><b>' + fmtN(tot.plays ? Math.round(tot.awarded / tot.plays) : 0) + '</b></div></div>' +
      '<table><tr><th>営業日</th><th class="n">回転</th><th class="n">当たり</th><th class="n">当選額</th></tr>' + (d.days.length ? d.days.map((x) => '<tr><td>' + fmtDay(x.day) + '</td><td class="n">' + fmtN(x.plays || 0) + '</td><td class="n">' + fmtN(x.wins || 0) + '</td><td class="n">' + fmtN(x.awarded || 0) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">この期間のデータはありません</td></tr>') + '</table></div>' +
      '<div class="panel"><h3>この期間のプレイ</h3>' + (tot.plays > d.plays.length && d.plays.length >= PLAY_MAX ? '<p class="hint">この期間のプレイは ' + fmtN(tot.plays) + ' 回あります。新しい ' + PLAY_MAX + ' 件を表示しています。</p>' : '') +
      '<table><tr><th>日時</th><th>ステージ</th><th class="n">結果</th><th>プリセット</th></tr>' + (d.plays.length ? d.plays.map((x) => '<tr><td>' + fmtDate(x.ts) + '</td><td>STAGE ' + x.stage + '</td><td class="n">' + fmtN(x.value) + '</td><td>' + esc(presetName(x.presetId)) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">この期間のプレイはありません</td></tr>') + '</table></div>';
  }
  async function loadStats(id, range) {
    if (id !== statsStore) statsRange = null; // 店舗を変えたら、期間は直近31日に戻す
    statsStore = id; statsData = null;
    if (range) statsRange = range;
    if (!id) return render();
    const R = statsRange || quickRange('31', id), rh = resetHourOf(id);
    render(); // 先に期間の欄だけ出す
    const from = isoToDate(R.from), to = isoToDate(R.to);
    from.setHours(rh, 0, 0, 0); to.setDate(to.getDate() + 1); to.setHours(rh, 0, 0, 0);
    const k0 = R.from.replace(/-/g, ''), k1 = R.to.replace(/-/g, ''), t0 = from.getTime(), t1 = to.getTime();
    let days, plays;
    try {
      [days, plays] = await Promise.all([Cloud.listDaysRange(id, k0, k1), Cloud.listPlaysRange(id, t0, t1, PLAY_MAX)]);
    } catch (err) {
      // 期間での問い合わせに失敗したら、これまでの取り方（新しい順にまとめて取る）で取って、こちらで期間に絞る
      try {
        const all = await Promise.all([Cloud.listDays(id, 400), Cloud.listPlays(id, 500)]);
        days = all[0].filter((x) => x.day >= k0 && x.day <= k1);
        plays = all[1].filter((x) => x.ts >= t0 && x.ts < t1).slice(0, PLAY_MAX);
      } catch (err2) { days = []; plays = []; toast('集計を読み込めませんでした: ' + err2.message); }
    }
    if (id !== statsStore) return; // 読み込み中に店舗を切り替えた
    statsData = { days, plays };
    render();
  }

  /* ---------- 操作 ---------- */
  main.addEventListener('change', (e) => {
    if (e.target.id === 'stsel') return loadStats(e.target.value);
    // 集計の期間（開始・終了）を変えた
    if ((e.target.id === 'stfrom' || e.target.id === 'stto') && statsStore) {
      const R = Object.assign({}, statsRange || quickRange('31', statsStore));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return;
      R[e.target.id === 'stfrom' ? 'from' : 'to'] = e.target.value;
      if (R.from > R.to) { if (e.target.id === 'stfrom') R.to = R.from; else R.from = R.to; }
      return loadStats(statsStore, R);
    }
    // 配当表の金額を書き換えた
    if (e.target.dataset.amt && editPreset) {
      const pk = e.target.dataset.amt.split(':'), row = editPreset.probs[pk[0]], v = Number(e.target.value), key = String(v);
      const back = (msg) => { e.target.value = pk[1]; toast(msg); };
      if (!Number.isInteger(v) || v < 1 || v > Engine.MAX_VALUE) return back('金額は 1 以上の整数で入力してください');
      if (key === pk[1]) return;
      if (row[key] !== undefined) return back('STAGE ' + pk[0] + ' には、すでに ' + fmtN(v) + ' があります');
      row[key] = row[pk[1]]; delete row[pk[1]];
      const M = editPreset.limits.max || {}, old = pk[0] + ':' + pk[1];
      if (M[old]) { M[pk[0] + ':' + key] = M[old]; delete M[old]; } // 金額ごとの上限も一緒に移す
      const top = window.scrollY; render(); window.scrollTo(0, top);
    }
  });
  main.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.amt) e.target.blur(); }); // Enter で確定
  main.addEventListener('input', (e) => { if (e.target.id === 'pname' && editPreset) editPreset.name = e.target.value; }); // 途中で画面を作り直しても名前が消えないように
  /* ◀ ▶ 1回ぶん（d = ±1）の増減。数字の直接入力からは、d に「入力した値 − いまの値」を渡す（上限・下限・丸めは同じ決まり） */
  function doStep(b, d) {
    const pv = b.parentNode.querySelector('.pv');
    const show = (v, unit) => { pv.innerHTML = v + '<i>' + unit + '</i>'; };
    if (b.dataset.p) {
      const pk = b.dataset.p.split(':'); const v = Number(editPreset.probs[pk[0]][pk[1]]) || 0;
      editPreset.probs[pk[0]][pk[1]] = Math.max(0, Math.min(100, Math.round((v + d) * 100) / 100));
      show(editPreset.probs[pk[0]][pk[1]], '%');
      $('psum').innerHTML = probSummary(editPreset);
      const badge = main.querySelector('[data-sum="' + pk[0] + '"]'); if (badge) badge.outerHTML = sumBadge(editPreset, +pk[0]);
      $('pstate').innerHTML = saveMsg(editPreset);
      refreshCost();
      return;
    }
    if (b.dataset.e) {
      const E = editPreset.limits.early = earlyOf(editPreset.limits);
      if (b.dataset.e === 'plays') { E.plays = Math.max(1, Math.min(999, Math.round((Number(E.plays) || 0) + d))); return show(E.plays, '回'); }
      const A = amountsOf(editPreset); if (!A.length) return;
      let i = A.indexOf(E.min); if (i < 0) { i = A.filter((x) => x < E.min).length; if (d > 0) i -= 1; } // 配当表から消えた金額のときは、近い金額から選び直す
      E.min = A[Math.max(0, Math.min(A.length - 1, i + Math.round(d)))];
      return show(fmtN(E.min), '以上');
    }
    if (b.dataset.g) { editPreset.logoRate = Math.max(0, Math.min(LOGO_MAX, Math.round((logoOf(editPreset) + d * 0.1) * 10) / 10)); refreshCost(); return show(editPreset.logoRate.toFixed(1), '%'); }
    if (b.dataset.f) { const n = +b.dataset.f, key = FREE_KEYS[n - 1]; editPreset[key] = Math.max(0, Math.min(FREE_MAX[n - 1], Math.round((freeN(editPreset, n) + d) * 10) / 10)); refreshCost(); return show(editPreset[key], '%'); }
    const k = b.dataset.l, L = editPreset.limits;
    if (k === 'hour') { L.resetHour = ((Math.round(L.resetHour + d) % 24) + 24) % 24; return show(L.resetHour, ':00'); }
    if (k === 'total') { L.total = Math.max(0, Math.min(999, Math.round((L.total || 0) + d))); return show(L.total, '本'); }
    const v = Math.max(0, Math.min(99, Math.round((Number(L.max[k]) || 0) + d))); if (v) L.max[k] = v; else delete L.max[k];
    return show(v, '回');
  }
  /* 数字の直接入力: ◀ ▶ の間の数字を押すと入力欄になる。Enter か欄の外を押すと確定、Esc で取り消し */
  const curVal = (b) => { // その行のいまの値と、◀ ▶ 1回ぶんの大きさ（金額を選ぶ欄は直接入力なし）
    const P = editPreset, L = P.limits;
    if (b.dataset.p) { const pk = b.dataset.p.split(':'); return { v: Number(P.probs[pk[0]][pk[1]]) || 0, unit: 1 }; }
    if (b.dataset.e === 'plays') return { v: Number(earlyOf(L).plays) || 0, unit: 1 };
    if (b.dataset.e) return null;
    if (b.dataset.g) return { v: logoOf(P), unit: 0.1 };
    if (b.dataset.f) return { v: freeN(P, +b.dataset.f), unit: 1 };
    if (b.dataset.l === 'hour') return { v: L.resetHour, unit: 1 };
    if (b.dataset.l === 'total') return { v: L.total || 0, unit: 1 };
    if (b.dataset.l) return { v: Number(L.max[b.dataset.l]) || 0, unit: 1 };
    return null;
  };
  main.addEventListener('click', (e) => {
    const pv = e.target.closest('.stepper .pv');
    if (!pv || pv.querySelector('input') || !editPreset) return;
    const b = pv.parentNode.querySelector('[data-act="step"][data-d="1"]'), c = b && curVal(b);
    if (!c) return;
    const unit = (pv.querySelector('i') || {}).textContent || '';
    pv.innerHTML = '<input type="number" class="pvin" inputmode="decimal" step="any" value="' + c.v + '" aria-label="数字を入力"><i>' + esc(unit) + '</i>';
    const inp = pv.querySelector('input');
    inp.focus(); inp.select();
    let done = false;
    const commit = (apply) => {
      if (done) return; done = true;
      const now = curVal(b), x = Number(inp.value);
      doStep(b, apply && inp.value !== '' && isFinite(x) ? (x - now.v) / now.unit : 0); // 0 でも、表示を数字に戻すために呼ぶ
    };
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(true); } else if (ev.key === 'Escape') commit(false); });
    inp.addEventListener('blur', () => commit(true));
  });

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
        case 'preset-new': editPreset = { name: '', probs: Engine.defaultProbs(), limits: { on: false, total: 0, max: {}, resetHour: 19 }, freeRate: FREE_DEFAULTS[0], freeRate2: FREE_DEFAULTS[1], freeRate3: FREE_DEFAULTS[2], logoRate: 0, noRetrigger: true, test: false }; return render();
        case 'preset-edit': { const p = presets.find((x) => x.id === b.dataset.id); editPreset = JSON.parse(JSON.stringify({ id: p.id, name: p.name, probs: p.probs, limits: Object.assign({ on: false, total: 0, max: {}, resetHour: 19 }, p.limits || {}), freeRate: freeN(p, 1), freeRate2: freeN(p, 2), freeRate3: freeN(p, 3), logoRate: logoOf(p), noRetrigger: noRetrig(p), test: !!p.test })); return render(); }
        case 'preset-cancel': editPreset = null; return render();
        case 'preset-save': return await savePreset();
        case 'preset-del': if (!confirm('プリセット「' + editPreset.name + '」を削除します。')) return; await Cloud.deletePreset(editPreset.id); editPreset = null; await reload(); return render();
        case 'test-on': editPreset.test = !editPreset.test; return render();
        case 'retrig-on': { const top = window.scrollY; editPreset.noRetrigger = !noRetrig(editPreset); render(); window.scrollTo(0, top); return; }
        case 'lim-on': editPreset.limits.on = !editPreset.limits.on; return render();
        case 'early-on': { const top = window.scrollY; editPreset.limits.early = earlyOf(editPreset.limits); editPreset.limits.early.on = !editPreset.limits.early.on; render(); window.scrollTo(0, top); return; }
        case 'st-quick': return await loadStats(statsStore, quickRange(b.dataset.q, statsStore));
        case 'amt-add': {
          const s = b.dataset.s, row = editPreset.probs[s], vals = Engine.tableOf(editPreset.probs)[s - 1].values.filter((v) => v > 0);
          if (vals.length >= Engine.MAX_AMOUNTS) return;
          // 新しい行の金額の初期値: いちばん大きい金額に、いちばん小さい金額を足した額（あとで直接書き換えられる）
          let v = vals.length ? vals[vals.length - 1] + vals[0] : Engine.DEFAULT_VALUES[s][1];
          while (row[v] !== undefined) v += vals[0] || 100;
          row[v] = 0;
          const top = window.scrollY; render(); window.scrollTo(0, top);
          const inp = main.querySelector('[data-amt="' + s + ':' + v + '"]'); if (inp) { inp.focus(); inp.select(); }
          return;
        }
        case 'amt-del': {
          const pk = b.dataset.k.split(':'), row = editPreset.probs[pk[0]];
          row['0'] = Math.round(((Number(row['0']) || 0) + (Number(row[pk[1]]) || 0)) * 100) / 100; // 消す行の確率は 0（ハズレ）に足す
          delete row[pk[1]];
          if (editPreset.limits.max) delete editPreset.limits.max[b.dataset.k];
          const top = window.scrollY; render(); window.scrollTo(0, top);
          return;
        }
        case 'step': return doStep(b, +b.dataset.d);
      }
    } catch (err) { toast('失敗しました: ' + err.message); }
  });

  start();
})();
