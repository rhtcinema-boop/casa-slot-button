/* casa BOAT の投票の Firestore 版（2026-11-19）: window.DerbyBoatFS。v2/client-firestore.js の create() の中で attach して使う（同じログイン・同じ見回り）。
   決まりごとは v2/boat-core.js（模擬クラウド v2/boat-server.js と同じ計算）。置き場の決まりの下書きは v2/firestore.prod.rules.boat-draft。
   置き場（競馬とは分ける＝競馬のスマホの見張り derbyLive・競馬の読み取りを増やさない）:
     boatRaces/<id>     公開してよいレース（艇の走りの再現 model・倍率・時刻・発表のあとは結果と当たった人）。読む: ログインした人。書く: 決める係
     boatSecrets/<id>   目安・起きやすさ・決めた結果（発表まで裏）。決める係だけ
     boatKeys/<id>      QR の合言葉（レースで 1 つ）。決める係（テレビ用アカウント・進行役・マスター）だけが読める＝スマホは QR を読まないと知らない
     boatResults/<id>   決めた結果の種と着順（テレビの映像用）。決める係だけ
     boatVotes/<レース id>~<uid>  票（無料の券＋BPT の券 bets: { 組番: 枚数 }）。読む: 自分・決める係
     boatLive/all       いまの状態の 1 件（スマホ・テレビが見張る。変わったときだけ書く）
     boatCounts/live    投票中の参加人数（テレビだけが投票中だけ見張る。15 秒に 1 回まで書く）
     boatStats/<営業日>  その日に払った BPT（1 日上限）。決める係だけ
     derbyConfig/boat   設定（時刻表・目安・上限）。読む: 決める係・書く: マスター
     derbyBpt/<uid>     BPT（競馬と同じ置き場。週の番号 wk で毎週月曜朝 5 時にリセット）
   読み取りの見込み（1 レース 30 人・テレビ 3 台）: スマホ 1 人 約 6〜9（いまの状態 1＋見張りの変化 4〜5＋レース 1＋自分の票・BPT 1〜2＋投票の決まりの中の読み）、
     テレビ 1 台 約 20（いまの状態の変化・参加人数 15 秒ごと × 3 分 ≈ 12・レース 1・合言葉 1・結果 1）、進行役 約 70（票の見張り・決める・発表）＝ 1 レース 約 400。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DerbyBoatFS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLB = { races: 'boatRaces', secrets: 'boatSecrets', keys: 'boatKeys', results: 'boatResults', votes: 'boatVotes', live: 'boatLive', counts: 'boatCounts', stats: 'boatStats', bpt: 'derbyBpt', config: 'derbyConfig', dvotes: 'derbyVotes', draces: 'derbyRaces' };
  const rand = () => { try { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] / 4294967296; } catch (e) { return Math.random(); } };
  const strip = (r) => { if (!r) return r; const o = Object.assign({}, r); delete o._id; delete o.openAtTs; delete o.closeAtTs; return o; };

  function attach(X) {
    const { db, doc, data, now, uid, ready, role, store, Ts, Core, Boat, Engine, Outcome, BoatModel, E, oddsAsync, getStores, auto } = X;
    const T = { cfg: null, cfgUn: null, races: null, raceUn: null, raceFrom: 0, local: {}, cntFor: null, cntUn: null, cntVotes: null, cntSig: '', cntAt: 0, liveSig: '', making: false };
    const storeNames = async () => { try { const L = await getStores(); const m = {}; L.forEach((s) => { m[s.id] = s.name; }); return m; } catch (e) { return {}; } };
    const mapVoteErr = (e) => { if (e && e.status) return e; if (e && e.code === 'permission-denied') return E(403, 'denied', 'この投票はできません。テレビの QR を読み直してください（締切のあと・今日の競馬に参加していないスマホは投票できません）'); return E(0, 'network', '通信できません。電波を確認してください'); };

    /* ---------- スマホ・テレビ ---------- */
    let liveCache = null, watching = 0; // watching: 見張っている数（見張っていない時の写しは古いかもしれないので使わない）
    async function boatState() { await ready(); const d = strip(data(await doc(COLB.live, 'all').get())); liveCache = d || { race: null, next: null }; return { now: now(), live: liveCache }; }
    function boatWatch(h) {
      h = h || {}; let unCount = null, countFor = null;
      const countWatch = (d) => {
        const r = d && d.race, want = role === 'tv' && r && r.status === 'upcoming' && now() < r.closeAt + 3000 ? r.id : null; // テレビだけ・投票中だけ（読み取りを増やさない）
        if (want === countFor) return; if (unCount) { unCount(); unCount = null; } countFor = want;
        if (want) unCount = doc(COLB.counts, 'live').onSnapshot((sn) => { const c = data(sn); if (c && c.raceId === want && h.count) h.count(strip(c)); }, () => {});
      };
      watching++;
      const un = doc(COLB.live, 'all').onSnapshot((sn) => { liveCache = strip(data(sn)) || { race: null, next: null }; if (h.boat) h.boat(liveCache); countWatch(liveCache); }, (e) => { if (h.error) h.error(e); });
      const iv = setInterval(() => countWatch(liveCache), 5000);
      return () => { watching--; un(); if (unCount) unCount(); clearInterval(iv); };
    }
    async function boatRace(id) {
      await ready(); const r = data(await doc(COLB.races, String(id || '')).get());
      if (!r) throw E(404, 'no_race', 'レースが見つかりません');
      const o = Object.assign(strip(r), { boats: Boat.boatsOf(r) });
      if (r.status !== 'upcoming' && (role === 'tv' || r.status === 'done')) { try { const x = data(await doc(COLB.results, r.id).get()); if (x) { o.hidden = strip(x); delete o.hidden.runAtTs; } } catch (e) { /* スマホは読めない（発表まで） */ } }
      return o;
    }
    async function boatKey(id) { await ready(); try { const k = data(await doc(COLB.keys, String(id || '')).get()); if (!k) throw E(404, 'no_key', '合言葉がありません'); return { raceId: String(id), code: k.code }; } catch (e) { if (e && e.status) throw e; throw E(403, 'tv_only', 'テレビだけが読めます'); } }
    async function bptDoc() { try { return data(await doc(COLB.bpt, uid()).get()) || {}; } catch (e) { return null; } }
    const bptView = (w, r, v) => { const bal = w ? Core.bptBalance(w, now()) : 0; return { bal, cost: Boat.STAKE, left: Boat.picksLeft(v, r, bal, now()) }; };
    async function raceOf(id) { const L = watching > 0 && liveCache && liveCache.race; if (L && L.id === id && L.day) return L; return strip(data(await doc(COLB.races, id).get())); } // 見張っているいまの状態にあれば読まない（読み取りを増やさない）
    async function myBoatVote(raceId) {
      await ready(); const id = String(raceId || ''), r = await raceOf(id); if (!r) throw E(404, 'no_race', 'レースが見つかりません');
      let v = null; try { v = data(await doc(COLB.votes, Boat.voteId(id, uid())).get()); } catch (e) { v = null; }
      return { vote: Boat.voteView(v, r), bpt: bptView(await bptDoc(), r, v), race: Boat.lite(r) };
    }
    // その日（ボートの営業日）に競馬へ参加した自分の票: dvs（このスマホが覚えている競馬の票の id。新しい順）から探す（1 件 2 回の読み取り）
    async function findDerbyVote(dvs, day) {
      for (const vid of (Array.isArray(dvs) ? dvs : []).slice(0, 6)) {
        if (typeof vid !== 'string' || !/^[^/]{3,120}$/.test(vid)) continue;
        let v = null; try { v = data(await doc(COLB.dvotes, vid).get()); } catch (e) { v = null; }
        if (!v || v.owner !== uid() || v.test) continue;
        let r = null; try { r = data(await doc(COLB.draces, v.raceId).get()); } catch (e) { r = null; }
        if (r && !r.test && (r.day || Core.bizDate(r.at, 5)) === day) return vid;
      }
      return null;
    }
    /* 投票: o = { raceId, code（QR の合言葉。初めての 1 票だけ）, nick, first?, second?（無料の券の組番。選び直し）, add?: ['a-b', ...]（BPT の券を足す）, dvs?: 競馬の票の id }
       1 回の書き込みで「票」と「BPT の使った数（spent・buse）」を一緒に（決まりが突き合わせる）。 */
    async function boatVote(o) {
      await ready(); o = o || {};
      const raceId = String(o.raceId || ''), vid = Boat.voteId(raceId, uid()), ref = doc(COLB.votes, vid), t = now();
      const r = await raceOf(raceId);
      if (!r || r.status !== 'upcoming' || t >= r.closeAt) throw E(409, 'closed', '締め切りました');
      if (t < r.openAt) throw E(409, 'not_open', '投票はまだ始まっていません');
      let old = null; try { old = data(await ref.get()); } catch (e) { old = null; }
      const add = Boat.cleanPicks(o.add || []);
      const nick = Core.cleanNick(o.nick != null ? o.nick : old && old.nick);
      const pair = o.first != null || !old ? Boat.cleanPair(o) : { first: old.first, second: old.second };
      let dv = old ? old.dv : null;
      if (!old) {
        if (!Boat.CODE_RE.test(String(o.code || ''))) throw E(403, 'bad_code', 'テレビの QR を読み直してください');
        dv = await findDerbyVote(o.dvs, r.day);
        if (!dv) throw E(403, 'no_derby', '今日の競馬に会計番号で参加したスマホだけ投票できます');
      }
      const b = db.batch(); let w = null;
      if (add.length) {
        if (r.test) throw E(409, 'no_bpt', 'テストのレースでは BPT の券は使えません');
        w = await bptDoc(); const bal = w ? Core.bptBalance(w, t) : 0;
        if (bal < add.length * Boat.STAKE) throw E(409, 'no_bpt', 'BPT が足りません');
        b.update(doc(COLB.bpt, uid()), { spent: (Number(w.spent) || 0) + add.length * Boat.STAKE, buse: vid });
      }
      const bets = Boat.addBets(old ? Boat.betsOf(old) : {}, add); // 組番ごとの枚数（上限なし。何枚足しても 1 回の書き込み）
      const nv = old ? Object.assign({}, old, { nick, first: pair.first, second: pair.second, bets, updatedAt: t }) : { raceId, owner: uid(), storeId: store, nick, first: pair.first, second: pair.second, bets, code: String(o.code), dv, votedAt: t, updatedAt: t };
      if (old) b.update(ref, { nick, first: pair.first, second: pair.second, bets, updatedAt: t }); else b.set(ref, nv);
      try { await b.commit(); } catch (e) { throw mapVoteErr(e); }
      if (w) w = Object.assign({}, w, { spent: (Number(w.spent) || 0) + add.length * Boat.STAKE });
      else w = await bptDoc();
      delete nv._id;
      return { vote: Boat.voteView(nv, r), bpt: bptView(w, r, nv), race: Boat.lite(r) };
    }

    /* ---------- 決める係（進行役のテレビの見回りの中。client-firestore.js の deciderTick0 から） ---------- */
    async function getCfg() {
      if (auto && !T.cfgUn) T.cfgUn = doc(COLB.config, 'boat').onSnapshot((sn) => { T.cfg = Boat.configOf(data(sn) || {}); }, () => { T.cfgUn = null; });
      if (auto && T.cfg) return T.cfg;
      return (T.cfg = Boat.configOf(data(await doc(COLB.config, 'boat').get()) || {}));
    }
    async function getRaces() {
      const from = now() - 6 * 3600000;
      if (auto && (!T.raceUn || from - T.raceFrom > 6 * 3600000)) { if (T.raceUn) T.raceUn(); T.raceFrom = from; T.raceUn = db.collection(COLB.races).where('at', '>=', from).onSnapshot((q) => { const m = {}; q.docs.forEach((d) => { m[d.id] = strip(Object.assign({ id: d.id }, d.data())); }); T.races = m; T.local = {}; }, () => { T.raceUn = null; }); }
      let m = T.races;
      if (!auto || !m) { const q = await db.collection(COLB.races).where('at', '>=', from).get(); m = {}; q.docs.forEach((d) => { m[d.id] = strip(Object.assign({ id: d.id }, d.data())); }); if (!auto) T.races = m; }
      const out = Object.assign({}, m); Object.keys(T.local).forEach((k) => { out[k] = Object.assign({}, out[k] || {}, T.local[k]); }); // 自分が書いたばかりの変化（見張りに届く前）
      return Object.values(out);
    }
    const note = (id, patch) => { T.local[id] = Object.assign({}, T.local[id] || {}, patch); };
    async function create(e, cfg, sc) {
      const model = Boat.modelOf(Engine, Outcome, BoatModel, sc.salt, e.id); let odds = null;
      if (oddsAsync) { try { odds = await oddsAsync(model, Outcome.hash(sc.salt, e.id, 'odds'), cfg.oddsSims); } catch (x) { odds = null; } } // テレビは Worker で（絵を止めない）
      const built = Boat.buildRace(Engine, Outcome, BoatModel, e, cfg, sc.salt, now(), { odds, dayStartHour: sc.tuning.dayStartHour });
      const r = built.race, b = db.batch();
      b.set(doc(COLB.races, r.id), Object.assign({}, r, { openAtTs: Ts(r.openAt), closeAtTs: Ts(r.closeAt) }));
      b.set(doc(COLB.secrets, r.id), built.secret);
      b.set(doc(COLB.keys, r.id), { code: Boat.newCode(rand), at: now() });
      await b.commit(); note(r.id, r);
      return r;
    }
    async function materialize(cfg, sc, races, derbyRaces) {
      if (!cfg.rules.length || T.making) return null;
      const t = now(), horizon = Math.max(cfg.voteSec * 1000 + 120000, ((sc.tuning && sc.tuning.horizonMin) || 15) * 60000), have = new Set(races.map((r) => r.id));
      let ders = null;
      for (const e of Boat.schedule(t, cfg.rules)) {
        if (e.at - t > horizon) break;
        if (e.at <= t + 1000 || have.has(e.id)) continue;
        if (!ders) ders = (derbyRaces || []).map((r) => r.at).concat(Core.scheduleAround(t, (sc.timetable && sc.timetable.rules) || []).map((x) => x.at));
        if (Boat.busyWithDerby(e.at, ders, sc.tuning, cfg)) continue; // 念のため（管理画面で断っている）: 競馬が勝つ
        T.making = true; try { await create(e, cfg, sc); } finally { T.making = false; }
        return e.id;
      }
      return null;
    }
    async function decideOne(r, cfg, sc) {
      const q = await db.collection(COLB.votes).where('raceId', '==', r.id).get(), votes = q.docs.map((d) => d.data()).filter((v) => v && v.owner);
      const sec = data(await doc(COLB.secrets, r.id).get()) || {}, st = data(await doc(COLB.stats, r.day).get()) || {};
      const d = Boat.decide(Engine, Outcome, r, sec, votes, cfg, sc.salt, now(), st.paid || 0), names = await storeNames();
      const patch = { status: 'decided', runAt: d.runAt, revealAt: d.revealAt, endAt: d.endAt, participants: Boat.countVotes(votes) };
      let ok = false;
      await db.runTransaction(async (tx) => {
        const cur = data(await tx.get(doc(COLB.races, r.id))); if (!cur || cur.status !== 'upcoming') return;
        tx.update(doc(COLB.races, r.id), patch);
        tx.set(doc(COLB.secrets, r.id), { result: d.result, decision: d.decision, paid: d.paid, refunds: d.refunds, refunded: d.refunded, winners: d.winners.map((w) => ({ owner: w.owner, nick: w.nick, storeId: w.storeId, storeName: names[w.storeId] || w.storeId, amount: w.amount, n: w.n })) }, { merge: true });
        tx.set(doc(COLB.results, r.id), Object.assign({}, d.hidden, { runAtTs: Ts(d.hidden.runAt) }));
        ok = true;
      });
      if (ok) note(r.id, patch);
      return ok;
    }
    async function revealOne(id) {
      let patch = null;
      await db.runTransaction(async (tx) => {
        const r = data(await tx.get(doc(COLB.races, id))); if (!r || r.status !== 'decided') return;
        const sec = data(await tx.get(doc(COLB.secrets, id))) || {}, ws = r.test ? [] : sec.winners || [], back = r.test ? {} : sec.refunds || {}, t = now();
        const win = {}; ws.forEach((w) => { win[w.owner] = (win[w.owner] || 0) + w.amount; });
        const owners = Array.from(new Set(Object.keys(win).concat(Object.keys(back)))), cur = []; for (const o of owners) cur.push(data(await tx.get(doc(COLB.bpt, o))));
        const st = data(await tx.get(doc(COLB.stats, r.day))) || {};
        owners.forEach((o, i) => tx.set(doc(COLB.bpt, o), Boat.creditDoc(cur[i], win[o] || 0, t, back[o] || 0), { merge: true })); // 当たりと返還（フライング）を 1 回で
        tx.set(doc(COLB.stats, r.day), { paid: (Number(st.paid) || 0) + (r.test ? 0 : Number(sec.paid) || 0), races: (Number(st.races) || 0) + 1 }, { merge: true });
        patch = { status: 'done', result: sec.result || null, paid: r.test ? 0 : sec.paid || 0, backBpt: r.test ? 0 : sec.refunded || 0, /* 返還で戻した BPT（取り消しの印 refunded とは別） */ people: (sec.winners || []).length, winners: (sec.winners || []).slice(0, 300).map((w) => ({ nick: w.nick, storeId: w.storeId, storeName: w.storeName || w.storeId, amount: w.amount, n: w.n })) };
        tx.update(doc(COLB.races, id), patch);
      });
      if (patch) note(id, patch);
      return !!patch;
    }
    // 投票中の参加人数（テレビが投票中だけ見る）: 進行役が票を見張り、15 秒に 1 回まで boatCounts/live に書く
    async function counts(races, t) {
      const cur = races.find((r) => Boat.votingOpen(r, t)) || null, want = cur ? cur.id : null;
      if (want !== T.cntFor) { if (T.cntUn) { T.cntUn(); T.cntUn = null; } T.cntFor = want; T.cntVotes = null; T.cntSig = ''; if (want && auto) T.cntUn = db.collection(COLB.votes).where('raceId', '==', want).onSnapshot((q) => { T.cntVotes = q.docs.map((d) => d.data()); }, () => { T.cntUn = null; T.cntFor = null; }); }
      if (!want || t - T.cntAt < Boat.COUNT_SEC * 1000) return;
      let votes = T.cntVotes; if (!auto) votes = (await db.collection(COLB.votes).where('raceId', '==', want).get()).docs.map((d) => d.data());
      if (!votes) return;
      const c = Boat.countVotes(votes), sig = want + JSON.stringify(c);
      if (sig === T.cntSig) return;
      T.cntSig = sig; T.cntAt = t;
      await doc(COLB.counts, 'live').set({ raceId: want, total: c.total, tickets: c.tickets, byStore: c.byStore, combos: c.combos, at: t });
    }
    async function publish(races, cfg, t) {
      const live = Boat.liveOf(races, t);
      if (!live.next && cfg.rules.length) { const e = Boat.schedule(t, cfg.rules).find((x) => x.at - cfg.voteSec * 1000 > t); if (e) live.next = { id: e.id, at: e.at, openAt: e.at - cfg.voteSec * 1000 }; } // まだ作っていない次のレース（時刻表から）
      const sig = JSON.stringify(live);
      if (sig === T.liveSig) return false;
      await doc(COLB.live, 'all').set(Object.assign({}, live, { updatedAt: t }));
      T.liveSig = sig; return true;
    }
    async function tick(sc, derbyRaces) {
      const did = [], cfg = await getCfg();
      let races = await getRaces(); const t = now();
      for (const r of races.slice().sort((a, b) => a.at - b.at)) {
        if (r.status === 'upcoming' && t >= r.closeAt + 1500) { if (await decideOne(r, cfg, sc)) did.push('boat decide ' + r.id); }
        else if (r.status === 'decided' && t >= r.revealAt) { if (await revealOne(r.id)) did.push('boat reveal ' + r.id); }
      }
      const made = await materialize(cfg, sc, races, derbyRaces); if (made) did.push('boat create ' + made);
      if (did.length) races = await getRaces();
      await counts(races, now());
      await publish(races, cfg, now());
      return did;
    }
    function stop() { [T.cfgUn, T.raceUn, T.cntUn].forEach((u) => { if (u) { try { u(); } catch (e) { /* noop */ } } }); T.cfgUn = T.raceUn = T.cntUn = null; T.races = null; T.cfg = null; T.cntFor = null; T.liveSig = ''; }

    /* ---------- 管理（マスター。client-firestore.js の admin() の wrap の中で呼ぶ） ---------- */
    async function derbyRulesNow() { const s = data(await doc(COLB.config, 'secret').get()) || {}; return { rules: (s.timetable && s.timetable.rules) || [], tuning: Core.tuningOf(s.tuning || {}) }; }
    const conflictErr = (cs) => E(409, 'boat_conflict', cs[0].text, { conflicts: cs.slice(0, 20) });
    function admin(wrap) {
      return {
        boatConfig: wrap(async () => {
          const cfg = Boat.configOf(data(await doc(COLB.config, 'boat').get()) || {}), dr = await derbyRulesNow(), day = Core.bizDate(now(), dr.tuning.dayStartHour);
          const q = await db.collection(COLB.races).where('day', '==', day).get(), st = data(await doc(COLB.stats, day).get()) || {};
          const races = []; for (const d of q.docs) { const r = strip(Object.assign({ id: d.id }, d.data())), s = data(await doc(COLB.secrets, d.id).get()) || {}; races.push(Object.assign(Boat.lite(r), { participants: r.participants, target: s.target, decision: s.decision || null })); }
          races.sort((a, b) => a.at - b.at);
          return { cfg, used: st.paid || 0, races, conflicts: Boat.conflicts(cfg.rules, dr.rules, dr.tuning, cfg, now(), 14) };
        }),
        saveBoat: wrap(async (b) => {
          const cur = data(await doc(COLB.config, 'boat').get()) || {}, dr = await derbyRulesNow(), stores = await getStores();
          const nx = Boat.mergeConfig(cur, b, stores.map((s) => s.id), dr.tuning.dayStartHour), cs = Boat.conflicts(nx.rules, dr.rules, dr.tuning, nx, now(), 14);
          if (cs.length) throw conflictErr(cs);
          await doc(COLB.config, 'boat').set(nx);
          const keep = new Set(Boat.schedule(now(), nx.rules).map((e) => e.id)), q = await db.collection(COLB.races).where('status', '==', 'upcoming').get();
          for (const d of q.docs) { const r = d.data(); if (!/^b\d/.test(d.id) || keep.has(d.id) || now() >= r.openAt - 5000) continue; const v = await db.collection(COLB.votes).where('raceId', '==', d.id).limit(1).get(); if (!v.empty) continue; const bb = db.batch(); bb.delete(doc(COLB.races, d.id)); bb.delete(doc(COLB.secrets, d.id)); bb.delete(doc(COLB.keys, d.id)); await bb.commit(); }
          return { ok: true, cfg: nx };
        }),
        boatRace: wrap(async (o) => { // すぐ始めるレース（確かめ用）
          o = o || {}; const cfg0 = Boat.configOf(data(await doc(COLB.config, 'boat').get()) || {}), s = data(await doc(COLB.config, 'secret').get()) || {}, inSec = Math.max(5, Math.min(3600, Number(o.inSec) || 60));
          const cfg = Object.assign({}, cfg0, { voteSec: Math.max(5, Math.min(cfg0.voteSec, Number(o.voteSec) || inSec)) }), id = 'bx-' + Boat.newCode(rand).toLowerCase().slice(0, 6);
          const r = await create({ id, at: now() + inSec * 1000, payout: o.payout, test: !!o.test }, Object.assign(cfg, { oddsSims: o.sims || cfg.oddsSims }), { salt: s.salt || 'nosalt', tuning: Core.tuningOf(s.tuning || {}) });
          return { race: Boat.lite(r) };
        }),
        boatRefund: wrap(async (raceId) => { // 取り消し: 足した BPT の券を全額戻す（2026-11-18 オーナー決定）
          const id = String(raceId || ''), q = await db.collection(COLB.votes).where('raceId', '==', id).get(), votes = q.docs.map((d) => Object.assign({ _vid: d.id }, d.data()));
          const plan = Boat.refundPlan(votes), owners = Object.keys(plan); let back = null;
          await db.runTransaction(async (tx) => {
            const r = data(await tx.get(doc(COLB.races, id))); if (!r) throw E(404, 'no_race', 'レースが見つかりません'); if (r.status === 'done') throw E(409, 'done', '発表したレースは取り消せません'); if (r.status === 'void') { back = {}; return; }
            const cur = []; for (const o of owners) cur.push(data(await tx.get(doc(COLB.bpt, o)))); const t = now();
            owners.forEach((o, i) => { const nx = Boat.creditDoc(cur[i], plan[o], t, true); if (nx) tx.set(doc(COLB.bpt, o), nx, { merge: true }); });
            votes.forEach((v) => { if (Boat.betCount(Boat.betsOf(v)) && !v.back) tx.update(doc(COLB.votes, v._vid), { back: true }); });
            tx.update(doc(COLB.races, id), { status: 'void', refunded: true, revealAt: Math.max(t, r.openAt), endAt: Math.max(t, r.openAt) + 60000 });
            back = plan;
          });
          return { ok: true, back };
        }),
      };
    }
    // 競馬の時刻表を保存するとき、ボートと被らないか（被れば 409 boat_conflict）
    async function checkDerbyRules(rules, tuning) { const cfg = Boat.configOf(data(await doc(COLB.config, 'boat').get()) || {}); if (!cfg.rules.length) return; const cs = Boat.conflicts(cfg.rules, rules, tuning, cfg, now(), 14); if (cs.length) throw conflictErr(cs); }

    return { api: { boatState, boatWatch, boatRace, boatKey, boatVote, myBoatVote }, tick, stop, admin, checkDerbyRules };
  }
  return { attach, COLB };
});
