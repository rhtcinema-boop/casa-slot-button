/* 永続化レイヤー。
   - 営業状態・在庫・PIN・上限ルールは localStorage に「1キー・同期1回書き込み」で保存する。
     抽選結果の確定と在庫の消費は同じ書き込みに含まれるため、途中でアプリが落ちても
     「在庫だけ減った／結果だけ出た／二重抽選された」という状態にはならない。
   - 履歴は先に同じ書き込みの中で pendingLog に積み（write-ahead）、その後 IndexedDB に
     移して容量を確保する。IndexedDB への移動が完了するまで pendingLog からは消さない。 */
const Store = (function () {
  'use strict';
  const KEY = 'casa-slot-button.state.v1';
  const DB_NAME = 'casa-slot-button', DB_STORE = 'log';
  let state = null;
  let db = null, flushing = false;

  function defaults() {
    return {
      v: 1,
      pins: null,                 // { staff:{salt,hash}, admin:{salt,hash} }
      auth: { fails: 0, lockUntil: 0 },
      capRules: Engine.defaultCapRules(),
      draft: null,                // 営業開始前の保存済み設定 { total, counts }
      session: null,              // 営業中のセッション（Engine.createSession の戻り値）
      sessionSeq: 0,
      play: null,                 // 直近プレイ { playNo, stage, value, overflow, phase:'drawn'|'shown' }
      locked: false,              // true の間はスタッフ認証までレバー完全ロック
      logSeq: 0,
      pendingLog: [],
      credits: 0,                 // 残クレジット（1プレイで1消費）
      wonTotal: 0,                // 今のクレジット分の合計当選額（0 から入れ直したときにリセット）
      settings: { volume: 0.9 },
    };
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* 保存不可環境 */ }
    state = defaults();
    if (raw) {
      try { Object.assign(state, JSON.parse(raw)); }
      catch (e) { throw new Error('保存データが破損しています。'); }
    }
    return state;
  }
  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  /* すべての状態変更はここを通す。保存に失敗したら変更を巻き戻して例外を投げる。 */
  function transact(fn) {
    const snapshot = JSON.stringify(state);
    try {
      const r = fn(state);
      save();
      flush();
      return r;
    } catch (e) {
      state = JSON.parse(snapshot);
      throw e;
    }
  }

  /* transact の中から呼ぶ。履歴1件を積む。 */
  function log(type, data, role) {
    state.logSeq += 1;
    state.pendingLog.push({
      id: state.logSeq,
      ts: Date.now(),
      type,
      sessionId: state.session ? state.session.id : null,
      role: role || null,
      data: data || {},
    });
  }

  function openDb() {
    return new Promise((resolve) => {
      if (db) return resolve(db);
      if (typeof indexedDB === 'undefined') return resolve(null);
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }

  function flush() {
    if (flushing || !state.pendingLog.length) return;
    flushing = true;
    const batch = state.pendingLog.slice();
    openDb().then((d) => {
      if (!d) { flushing = false; return; } // IndexedDB 不可: localStorage 側に保持し続ける
      let tx;
      try { tx = d.transaction(DB_STORE, 'readwrite'); } catch (e) { flushing = false; return; }
      const os = tx.objectStore(DB_STORE);
      batch.forEach((e) => os.put(e));
      tx.oncomplete = () => {
        const done = new Set(batch.map((e) => e.id));
        state.pendingLog = state.pendingLog.filter((e) => !done.has(e.id));
        try { save(); } catch (e) { /* 次回 flush で再試行（put は冪等） */ }
        flushing = false;
        if (state.pendingLog.length) flush();
      };
      tx.onerror = tx.onabort = () => { flushing = false; };
    });
  }

  /* 全履歴（新しい順）。IndexedDB 分と未移動分をマージする。 */
  function readLog() {
    return openDb().then((d) => new Promise((resolve) => {
      const byId = new Map();
      const finish = () => {
        state.pendingLog.forEach((e) => byId.set(e.id, e));
        resolve(Array.from(byId.values()).sort((a, b) => b.id - a.id));
      };
      if (!d) return finish();
      try {
        const req = d.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
        req.onsuccess = () => { req.result.forEach((e) => byId.set(e.id, e)); finish(); };
        req.onerror = finish;
      } catch (e) { finish(); }
    }));
  }

  function init() {
    load();
    flush();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    // 別タブで状態が変わった場合は整合性のため読み直す
    window.addEventListener('storage', (e) => { if (e.key === KEY) location.reload(); });
    return state;
  }

  return {
    init, transact, log, readLog,
    get state() { return state; },
  };
})();
