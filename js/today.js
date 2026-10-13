/* 今日の当たりだけを見るページ（b99、オーナー指示「今日の当選結果だけわかるアプリ」）。
   データは全店舗の配当履歴（feed: ts / value / storeId / store）。「今日」は各店舗のリセット時刻（端末の設定。既定 19:00）からの営業日。
   会計番号は店舗ドキュメントの stat.checks（端末が書く直近 40 件）から、同じ時刻の当たりに付ける。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (n) => (Number(n) || 0).toLocaleString('ja-JP');
  const pad = (n) => ('0' + n).slice(-2);
  let stores = [];          // [{ id, name }]
  const docs = {};          // storeId → 店舗ドキュメント（stat を見る）
  let feed = null;          // 配当履歴（新しい順）または null（未取得）
  let sel = 'all', feedOk = true;

  const resetHourOf = (id) => { const d = docs[id]; const h = d && d.stat && Number.isInteger(d.stat.resetHour) ? d.stat.resetHour : 19; return h; };
  // 店舗ごとの「今日」の始まり（リセット時刻を過ぎていれば今日のその時刻、まだなら昨日のその時刻）
  function dayStart(id, now) {
    const h = resetHourOf(id), d = new Date(now); d.setHours(h, 0, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  }
  function checkOf(storeId, ts) {
    const d = docs[storeId], list = d && d.stat && Array.isArray(d.stat.checks) ? d.stat.checks : [];
    let best = null;
    list.forEach((c) => { const dt = Math.abs((c.ts || 0) - ts); if (dt < 5000 && (!best || dt < best.dt)) best = { dt, check: c.check }; });
    return best ? best.check : '';
  }
  function render() {
    const now = Date.now();
    const ids = sel === 'all' ? stores.map((s) => s.id) : [sel];
    const starts = {}; ids.forEach((id) => { starts[id] = dayStart(id, now); });
    const rows = (feed || []).filter((f) => f && f.value > 0 && ids.indexOf(f.storeId) >= 0 && f.ts >= starts[f.storeId]);
    rows.sort((a, b) => b.ts - a.ts);
    const total = rows.reduce((a, r) => a + (Number(r.value) || 0), 0);
    $('n').textContent = feed ? rows.length + ' 本' : '—';
    $('total').textContent = feed ? fmtN(total) : '—';
    // 日付の表示: 選んだ店舗（全店舗なら最初の店舗）のリセット時刻を使う
    const refId = ids[0] || null, st = refId ? starts[refId] : now, sd = new Date(st);
    $('day').textContent = (sd.getMonth() + 1) + '/' + sd.getDate() + '（' + '日月火水木金土'[sd.getDay()] + '）' + pad(sd.getHours()) + ':00 から いま（' + pad(new Date(now).getHours()) + ':' + pad(new Date(now).getMinutes()) + '）まで';
    const list = $('list');
    if (!feed) list.innerHTML = '<div class="empty">' + (feedOk ? '読み込んでいます…' : 'クラウドに接続できません。通信を確認してください。') + '</div>';
    else if (!rows.length) list.innerHTML = '<div class="empty">今日の当たりはまだありません。<br>当たりが出ると、ここに自動で並びます。</div>';
    else list.innerHTML = rows.map((r) => {
      const d = new Date(r.ts), chk = checkOf(r.storeId, r.ts);
      const cls = r.value >= 50000 ? ' huge' : r.value >= 5000 ? ' big' : '';
      return '<div class="row"><small>' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</small><div class="st">' + esc(r.store || '') + (chk ? '<i>会計 No.' + esc(chk) + '</i>' : '') + '</div><b class="' + cls + '">' + fmtN(r.value) + '</b></div>';
    }).join('');
    const alive = stores.map((s) => { const d = docs[s.id]; const ok = d && d.lastSeen && now - d.lastSeen < 25 * 60 * 1000; return '<b class="' + (ok ? '' : 'off') + '">●</b> ' + esc(s.name); }).join('　');
    $('foot').innerHTML = (stores.length ? '端末: ' + alive + '<br>' : '') + '自動で更新されます。会計番号は、スマホの紙幣で始めた当たりにだけ付きます。';
  }
  function renderChips() {
    const chips = [{ id: 'all', name: '全店舗' }].concat(stores);
    $('chips').innerHTML = chips.map((c) => '<button data-id="' + esc(c.id) + '" class="' + (sel === c.id ? 'on' : '') + '">' + esc(c.name) + '</button>').join('');
    $('chips').querySelectorAll('button').forEach((b) => { b.onclick = () => { sel = b.dataset.id; renderChips(); render(); }; });
  }
  async function init() {
    if (!Cloud.enabled) { $('list').innerHTML = '<div class="empty">この公開先は店舗モードではないため、このページは使えません。</div>'; $('day').textContent = ''; return; }
    try { stores = await Promise.race([Cloud.listStores(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]); }
    catch (e) { stores = []; feedOk = false; render(); setTimeout(init, 8000); return; }
    renderChips();
    stores.forEach((s) => Cloud.watchStore(s.id, (d) => { if (d) docs[s.id] = d; render(); }));
    Cloud.watchFeed(300, (list) => { if (list === null) { feedOk = false; if (!feed) render(); return; } feedOk = true; feed = list; render(); });
    render();
    setInterval(render, 60000); // 「いま」の時刻と、日付をまたいだときの表示を進める
  }
  document.addEventListener('DOMContentLoaded', init);
})();
