/* クラウド同期（店舗 ⇄ マスター）。
   window.CASA_CLOUD が Firebase の設定オブジェクトなら Firebase（Firestore + Auth）を使う。
   'local' なら同じブラウザの localStorage を疑似クラウドとして使う（動作確認用。別端末とは同期しない）。
   未設定なら無効（今までどおり端末内だけで動く1台運用）。

   データの形:
     stores/{storeId}   { name, pin:{salt,hash}, presetIds:[..], activePresetId, logoutAt, lastSeen, deviceVersion }
     presets/{presetId} { name, probs, limits, updatedAt }
     stores/{storeId}/plays/{id} { ts, stage, value, key, playNo, presetId }
     stores/{storeId}/days/{yyyymmdd} { plays, awarded, wins }   … 営業日（リセット時刻区切り）ごとの集計 */
const Cloud = (function () {
  'use strict';
  const cfg = window.CASA_CLOUD || null;
  const enabled = !!cfg;
  const isLocal = cfg === 'local';
  let db = null, auth = null, readyP = null;

  /* ---------- Firebase SDK の読み込み（使うときだけ） ---------- */
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
  }
  async function initFirebase() {
    for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']) await loadScript(SDK + f);
    /* global firebase */
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* 複数タブなどで不可でも動く */ }
    if (!auth.currentUser) await auth.signInAnonymously();
    // ログイン直後は Firestore 側にトークンが渡る前に読みにいくと権限エラーになるので、トークンを取ってひと呼吸おく
    try { await auth.currentUser.getIdToken(); } catch (e) { /* noop */ }
    await new Promise((res) => setTimeout(res, 400));
  }
  /* 権限エラー（ログイン直後の取りこぼし）は1回だけやり直す */
  async function retry(fn) {
    try { return await fn(); }
    catch (e) { if (e && e.code === 'permission-denied') { await new Promise((res) => setTimeout(res, 1200)); return fn(); } throw e; }
  }
  function ready() {
    if (!enabled) return Promise.reject(new Error('cloud disabled'));
    if (!readyP) readyP = isLocal ? Promise.resolve() : initFirebase();
    return readyP;
  }

  /* ---------- ローカル模擬（localStorage） ---------- */
  const LKEY = 'casa-cloud-local';
  function lread() { try { return JSON.parse(localStorage.getItem(LKEY)) || { stores: {}, presets: {}, plays: {}, days: {} }; } catch (e) { return { stores: {}, presets: {}, plays: {}, days: {} }; } }
  function lwrite(d) { localStorage.setItem(LKEY, JSON.stringify(d)); }
  const lid = () => Math.random().toString(36).slice(2, 10);
  function lwatch(getter, cb) { // 1秒ごとに見て、変わっていたら通知（別タブの更新も拾う）
    let last = null;
    const tick = () => { const v = JSON.stringify(getter()); if (v !== last) { last = v; cb(JSON.parse(v)); } };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }

  /* ---------- 共通 API ---------- */
  const now = () => Date.now();
  const dayKey = (ts, resetHour) => { const d = new Date(Engine.windowStart(ts, resetHour)); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); };

  async function listStores() {
    await ready();
    if (isLocal) { const d = lread(); return Object.keys(d.stores).map((id) => ({ id, name: d.stores[id].name })).sort((a, b) => a.name.localeCompare(b.name, 'ja')); }
    const q = await retry(() => db.collection('stores').get());
    return q.docs.map((x) => ({ id: x.id, name: x.data().name || '' })).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }
  async function getStore(id) {
    await ready();
    if (isLocal) { const s = lread().stores[id]; return s ? Object.assign({ id }, s) : null; }
    const d = await retry(() => db.collection('stores').doc(id).get());
    return d.exists ? Object.assign({ id }, d.data()) : null;
  }
  /* 店舗ドキュメントの変更を監視。cb(store|null) */
  function watchStore(id, cb) {
    ready().then(() => {
      if (isLocal) { const un = lwatch(() => { const s = lread().stores[id]; return s ? Object.assign({ id }, s) : null; }, cb); watchStore.un = un; return; }
      watchStore.un = db.collection('stores').doc(id).onSnapshot((d) => cb(d.exists ? Object.assign({ id }, d.data()) : null), () => {});
    }).catch(() => cb(null));
    return () => { if (watchStore.un) watchStore.un(); };
  }
  async function getPreset(id) {
    await ready();
    if (isLocal) { const p = lread().presets[id]; return p ? Object.assign({ id }, p) : null; }
    const d = await retry(() => db.collection('presets').doc(id).get());
    return d.exists ? Object.assign({ id }, d.data()) : null;
  }
  /* プリセットの変更を監視（配布されたものだけ） */
  function watchPreset(id, cb) {
    ready().then(() => {
      if (isLocal) return lwatch(() => { const p = lread().presets[id]; return p ? Object.assign({ id }, p) : null; }, cb);
      return db.collection('presets').doc(id).onSnapshot((d) => cb(d.exists ? Object.assign({ id }, d.data()) : null), () => {});
    }).catch(() => cb(null));
  }
  async function listPresets() {
    await ready();
    if (isLocal) { const d = lread(); return Object.keys(d.presets).map((id) => Object.assign({ id }, d.presets[id])); }
    const q = await retry(() => db.collection('presets').get());
    return q.docs.map((x) => Object.assign({ id: x.id }, x.data()));
  }
  /* 店舗側: いま使うプリセットを選ぶ／生存報告 */
  async function updateStoreFields(id, fields) {
    await ready();
    if (isLocal) { const d = lread(); if (d.stores[id]) Object.assign(d.stores[id], fields); lwrite(d); return; }
    await db.collection('stores').doc(id).update(fields);
  }
  /* 店舗側: プレイ結果を送る（圏外なら SDK が溜めて後で送る） */
  async function pushPlay(storeId, play, resetHour) {
    await ready();
    const day = dayKey(play.ts, resetHour), win = play.value > 0 ? 1 : 0;
    if (isLocal) {
      const d = lread();
      (d.plays[storeId] = d.plays[storeId] || []).push(play);
      if (d.plays[storeId].length > 500) d.plays[storeId].splice(0, d.plays[storeId].length - 500);
      const days = d.days[storeId] = d.days[storeId] || {};
      const x = days[day] = days[day] || { plays: 0, awarded: 0, wins: 0 };
      x.plays += 1; x.awarded += play.value; x.wins += win;
      lwrite(d);
      return;
    }
    const inc = firebase.firestore.FieldValue.increment;
    const ref = db.collection('stores').doc(storeId);
    ref.collection('plays').add(play).catch(() => {});
    ref.collection('days').doc(day).set({ plays: inc(1), awarded: inc(play.value), wins: inc(win) }, { merge: true }).catch(() => {});
  }

  /* ---------- マスター用 ---------- */
  async function masterLogin(email, password) {
    await ready();
    if (isLocal) return { email: email || 'local@master' };
    const r = await auth.signInWithEmailAndPassword(email, password);
    return { email: r.user.email };
  }
  function masterUser() { if (isLocal) return { email: 'local@master' }; return auth && auth.currentUser && !auth.currentUser.isAnonymous ? { email: auth.currentUser.email } : null; }
  async function masterLogout() { if (!isLocal && auth) { await auth.signOut(); await auth.signInAnonymously(); } }
  async function saveStore(id, data) {
    await ready();
    if (isLocal) { const d = lread(); id = id || lid(); d.stores[id] = Object.assign({}, d.stores[id] || {}, data); lwrite(d); return id; }
    if (id) { await db.collection('stores').doc(id).set(data, { merge: true }); return id; }
    const r = await db.collection('stores').add(Object.assign({ createdAt: now() }, data));
    return r.id;
  }
  async function deleteStore(id) {
    await ready();
    if (isLocal) { const d = lread(); delete d.stores[id]; delete d.plays[id]; delete d.days[id]; lwrite(d); return; }
    await db.collection('stores').doc(id).delete();
  }
  async function savePreset(id, data) {
    await ready();
    data = Object.assign({}, data, { updatedAt: now() });
    if (isLocal) { const d = lread(); id = id || lid(); d.presets[id] = Object.assign({}, d.presets[id] || {}, data); lwrite(d); return id; }
    if (id) { await db.collection('presets').doc(id).set(data, { merge: true }); return id; }
    const r = await db.collection('presets').add(data);
    return r.id;
  }
  async function deletePreset(id) {
    await ready();
    if (isLocal) { const d = lread(); delete d.presets[id]; lwrite(d); return; }
    await db.collection('presets').doc(id).delete();
  }
  async function listDays(storeId, n) {
    await ready();
    if (isLocal) { const days = lread().days[storeId] || {}; return Object.keys(days).sort().reverse().slice(0, n || 31).map((k) => Object.assign({ day: k }, days[k])); }
    const q = await db.collection('stores').doc(storeId).collection('days').orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(n || 31).get();
    return q.docs.map((x) => Object.assign({ day: x.id }, x.data()));
  }
  /* 営業日キー（yyyymmdd）の範囲で日別の集計を取る（両端を含む。新しい日が先） */
  async function listDaysRange(storeId, fromKey, toKey) {
    await ready();
    if (isLocal) { const days = lread().days[storeId] || {}; return Object.keys(days).filter((k) => k >= fromKey && k <= toKey).sort().reverse().map((k) => Object.assign({ day: k }, days[k])); }
    const q = await db.collection('stores').doc(storeId).collection('days').orderBy(firebase.firestore.FieldPath.documentId()).startAt(fromKey).endAt(toKey).get();
    return q.docs.map((x) => Object.assign({ day: x.id }, x.data())).reverse();
  }
  /* 時刻の範囲（fromTs 以上 toTs 未満）のプレイを、新しい順に最大 n 件 */
  async function listPlaysRange(storeId, fromTs, toTs, n) {
    await ready();
    if (isLocal) { return (lread().plays[storeId] || []).filter((x) => x.ts >= fromTs && x.ts < toTs).reverse().slice(0, n || 200); }
    const q = await db.collection('stores').doc(storeId).collection('plays').where('ts', '>=', fromTs).where('ts', '<', toTs).orderBy('ts', 'desc').limit(n || 200).get();
    return q.docs.map((x) => x.data());
  }
  async function listPlays(storeId, n) {
    await ready();
    if (isLocal) { return (lread().plays[storeId] || []).slice().reverse().slice(0, n || 50); }
    const q = await db.collection('stores').doc(storeId).collection('plays').orderBy('ts', 'desc').limit(n || 50).get();
    return q.docs.map((x) => x.data());
  }

  return { enabled, isLocal, ready, listStores, getStore, watchStore, getPreset, watchPreset, listPresets, updateStoreFields, pushPlay,
    masterLogin, masterUser, masterLogout, saveStore, deleteStore, savePreset, deletePreset, listDays, listPlays, listDaysRange, listPlaysRange, dayKey };
})();
window.Cloud = Cloud;
