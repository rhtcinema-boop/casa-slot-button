/* casa BOAT の投票の Firestore 版（2026-11-19）: window.DerbyBoatFS。v2/client-firestore.js の create() の中で attach して使う（同じログイン・同じ見回り）。
   決まりごとは v2/boat-core.js（模擬クラウド v2/boat-server.js と同じ計算）。置き場の決まりの下書きは v2/firestore.prod.rules.boat-draft。
   置き場（競馬とは分ける＝競馬のスマホの見張り derbyLive・競馬の読み取りを増やさない）:
     boatRaces/<id>     公開してよいレース（艇の走りの再現 model・倍率・時刻・発表のあとは結果と当たった人）。読む: ログインした人。書く: 決める係
     boatSecrets/<id>   目安・起きやすさ・決めた結果（発表まで裏）。決める係だけ
     boatKeys/<id>      QR の合言葉（レースで 1 つ）。決める係（テレビ用アカウント・進行役・マスター）だけが読める＝スマホは QR を読まないと知らない
     boatResults/<id>   決めた結果の種と着順（テレビの映像用）。決める係だけ
     boatVotes/<レース id>~<uid>  票（無料の券＋BPT の券 bets: { 組番: 枚数 }・n: BPT の券の合計の枚数。発表のあと当たった人には got: 実際に増えた BPT・capped: 上限 3,000 で止まった）。読む: 自分・決める係
     boatLive/all       いまの状態の 1 件（スマホ・テレビが見張る。変わったときだけ書く）
     boatCounts/live    投票中の参加人数（テレビだけが投票中だけ見張る。15 秒に 1 回まで書く）
     boatStats/<営業日>  その日の BPT（1 日上限）: committed ＝ 決めたレースの払う額の合計（決めた時点で足す＝発表待ちの分も数える。取り消しで戻す。2026-11-20）・paid ＝ 発表した分・races。決める係だけ
     boatTvs/<uid>      進行役でも予備でもないテレビ（パソコンのブラウザのテレビなど）に、QR の合言葉を読ませる印（マスターだけが書く。2026-11-20）
     derbyConfig/boat   設定（時刻表・目安・上限）。読む: 決める係・書く: マスター
     derbyBpt/<uid>     BPT（競馬と同じ置き場。週の番号 wk で毎週月曜朝 5 時にリセット。残り＝earned − spent は 3,000 まで＝Core.BPT_MAX。2026-11-20 夜）
   読み取りの見込み（1 レース 30 人・テレビ 3 台）: スマホ 1 人 約 6〜9（いまの状態 1＋見張りの変化 4〜5＋レース 1＋自分の票・BPT 1〜2＋投票の決まりの中の読み）、
     テレビ 1 台 約 20（いまの状態の変化・参加人数 15 秒ごと × 3 分 ≈ 12・レース 1・合言葉 1・結果 1）、進行役 約 70（票の見張り・決める・発表）＝ 1 レース 約 400。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DerbyBoatFS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLB = { races: 'boatRaces', secrets: 'boatSecrets', keys: 'boatKeys', results: 'boatResults', votes: 'boatVotes', live: 'boatLive', counts: 'boatCounts', stats: 'boatStats', bpt: 'derbyBpt', config: 'derbyConfig', dvotes: 'derbyVotes', draces: 'derbyRaces', tvs: 'boatTvs' };
  // 中身が同じかを比べる文字列（項目の順番によらない）
  const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));
  const rand = () => { try { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] / 4294967296; } catch (e) { return Math.random(); } };
  const strip = (r) => { if (!r) return r; const o = Object.assign({}, r); delete o._id; delete o.openAtTs; delete o.closeAtTs; return o; };

  function attach(X) {
    const { db, doc, data, now, uid, ready, role, store, Ts, Core, Boat, Engine, Outcome, BoatModel, E, oddsAsync, getStores, auto } = X;
    const cap = X.cap || ((big) => big); // 1 回の取引で書く件数: テレビ用アカウント・マスターは big、管理画面で選んだ進行役のテレビ（匿名ログイン）は small（決まりの中の読み取りの上限。競馬と同じ分け方）
    const T = { cfg: null, cfgUn: null, races: null, raceUn: null, raceFrom: 0, local: {}, cntFor: null, cntUn: null, cntVotes: null, cntSig: '', cntAt: 0, liveSig: '', making: false };
    const storeNames = async () => { try { const L = await getStores(); const m = {}; L.forEach((s) => { m[s.id] = s.name; }); return m; } catch (e) { return {}; } };
    const mapVoteErr = (e) => { if (e && e.status) return e; if (e && e.code === 'permission-denied') return E(403, 'denied', 'この投票はできません。テレビの QR を読み直してください（締切のあと・今日の競馬に参加していないスマホは投票できません）'); return E(0, 'network', '通信できません。電波を確認してください'); };
    const usedOf = (st) => Math.max(0, Number(st && (st.committed != null ? st.committed : st.paid)) || 0); // その営業日に決めたレースの払う額の合計（前の形は paid）

    /* ---------- スマホ・テレビ ---------- */
    let liveCache = null, watching = 0; // watching: 見張っている数（見張っていない時の写しは古いかもしれないので使わない）
    async function boatState() { await ready(); if (watching > 0 && liveCache) return { now: now(), live: liveCache }; /* 見張り中は届いている写しを返す（読まない。2026-11-20） */ const d = strip(data(await doc(COLB.live, 'all').get())); liveCache = d || { race: null, next: null }; return { now: now(), live: liveCache }; }
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
    /* 自分の BPT（derbyBpt/<uid>）: 競馬と同じ手元の写し（60 秒。client-firestore.js の myBpt）を使う＝開くたび・押すたびに読まない（2026-11-20）。
       force: 読み直す（BPT の券を足す前・当たりや返還で増えたはずのとき）。まだ無い ＝ {}・読めない ＝ null */
    async function bptDoc(force) { if (X.myBpt) return X.myBpt(!!force); try { return data(await doc(COLB.bpt, uid()).get()) || {}; } catch (e) { return null; } }
    const bptNote = (d) => { if (X.bptNote) X.bptNote(d); }; // 自分で書いたあとの中身を写しに（null ＝ 分からなくなった → 次は読み直す）
    const bptView = (w, r, v) => { const bal = w ? Core.bptBalance(w, now()) : 0; return { bal, cost: Boat.STAKE, left: Boat.picksLeft(v, r, bal, now()) }; };
    async function raceOf(id) { const L = watching > 0 && liveCache && liveCache.race; if (L && L.id === id && L.day) return L; return strip(data(await doc(COLB.races, id).get())); } // 見張っているいまの状態にあれば読まない（読み取りを増やさない）
    const bptSeen = {}; // 結果のあとに BPT を読み直したレース（1 回だけ）
    /* 2026-11-21 深夜: 届いたかの確かめは置き場（サーバー）から読む（手元の写しを使わない）。まだ送り終わっていない自分の書き込みが混ざっているときは pending */
    async function srvRead(ref) { const sn = await ref.get({ source: 'server' }); return { v: data(sn), pending: !!(sn && sn.metadata && sn.metadata.hasPendingWrites) }; }
    const pendingErr = () => E(0, 'pending', '前の送信がまだ終わっていません。電波を確かめて、少し待ってからもう一度押してください');
    /* 自分の票と BPT。opt.fresh: 票をサーバーから・BPT も読み直す（電波が戻った・投票の返事が来なかったあとなど、画面が「確かめ直したい」とき） */
    async function myBoatVote(raceId, opt) {
      await ready(); const id = String(raceId || ''), r = await raceOf(id); if (!r) throw E(404, 'no_race', 'レースが見つかりません');
      const fresh = !!(opt && opt.fresh), ref = doc(COLB.votes, Boat.voteId(id, uid()));
      let v = null;
      if (fresh) { let x; try { x = await srvRead(ref); } catch (e) { throw mapVoteErr(e); } if (x.pending) throw pendingErr(); v = x.v; } // 届いたかの確かめ: 読めない・送り途中は「まだ分からない」（失敗で返す）
      else { try { v = data(await ref.get()); } catch (e) { v = null; } }
      const view = Boat.voteView(v, r);
      // 当たり・返還・取り消しで BPT が増えたはずのレースは、そのとき 1 回だけ読み直す（ほかは手元の写し）
      const grew = !!(view && !bptSeen[id] && ((r.status === 'done' && (view.won > 0 || (view.back && view.back.bpt > 0))) || (view.refunded && view.n > 0 && r.backDone === true))); // 取り消しは戻し終えてから（backDone）1 回
      const w = await bptDoc(grew || fresh);
      if (grew && w) bptSeen[id] = 1; // 2026-11-21 深夜（M7）: 読めたときだけ「読み直しずみ」（読めなければ次の回にもう一度）
      return { vote: view, bpt: bptView(w, r, v), race: Boat.lite(r) };
    }
    /* その日（ボートの営業日）に競馬へ参加した自分の票の候補（2026-11-20 読み取りを減らす）: dvs（このスマホが覚えている競馬の票の id。新しい順）から。
       時刻表のレースの票は id（営業日 YYYYMMDD-HHMM…~店~番号）から営業日と店が分かるので読まない（本当に自分の票かは、置き場の決まりが投票の書き込みのときに確かめる）。
       手動のレースの票（id から日が分からない）だけ読む（1 件 2 回）。読んだ結果は覚える（押すたびに読み直さない）。この店の票を先に */
    const dvMemo = {}; // 競馬の票の id → { day: 読んで確かめた営業日 | null（自分の本物の票でない） }
    async function verifyDv(x, day) {
      let m = dvMemo[x.vid];
      if (!m) {
        let v = null, d = null; try { v = data(await doc(COLB.dvotes, x.vid).get()); } catch (e) { v = null; }
        if (v && v.owner === uid() && !v.test) { let r = null; try { r = data(await doc(COLB.draces, v.raceId).get()); } catch (e) { r = null; } if (r && !r.test) d = r.day || Core.bizDate(r.at, 5); }
        m = dvMemo[x.vid] = { day: d };
      }
      return m.day === day;
    }
    function derbyCands(dvs, day) {
      const L = [], seen = {};
      (Array.isArray(dvs) ? dvs : []).slice(0, 6).forEach((vid) => { if (typeof vid !== 'string' || !/^[^/]{3,120}$/.test(vid)) return; const x = Boat.derbyVoteInfo(vid); if (!x || seen[x.vid]) return; seen[x.vid] = 1; const m = dvMemo[x.vid]; if (m ? m.day === day : x.day == null || x.day === day) L.push(Object.assign({ sure: !!m }, x)); });
      const rank = (x) => (x.day === day ? 0 : 2) + (x.storeId === store ? 0 : 1); // id で日が分かるもの → この店のもの
      return L.sort((a, b) => rank(a) - rank(b));
    }
    /* 投票: o = { raceId, code（QR の合言葉。初めての 1 票だけ）, nick, first?, second?（無料の券の組番。選び直し）, add?: ['a-b', ...]（BPT の券を足す）, dvs?: 競馬の票の id }
       1 回の書き込みで「票」と「BPT の使った数（spent・buse）」を一緒に（決まりが突き合わせる）。
       票の店（storeId）は、その日に競馬へ参加した店（競馬の票の店。2026-11-20: 好きな店を名乗れない。決まりも競馬の票と突き合わせる） */
    async function boatVote(o) {
      await ready(); o = o || {};
      const raceId = String(o.raceId || ''), vid = Boat.voteId(raceId, uid()), ref = doc(COLB.votes, vid), t = now();
      const op = Boat.cleanOp(o.opId) || Boat.newOp(rand); // 操作の番号（2026-11-21 H1・J11。同じ番号の書き込みは 1 回だけ通す。ref/boat/opId_の使い方.md）
      const prev = Boat.cleanPrevOps(o.prevOps, op); // 打ち切りのあとに中身を変えた押し直し: まだ決着していない前の番号（2026-11-21 深夜 L1。届いていたら足さない・届いていなければ取り消す）
      const r = await raceOf(raceId);
      if (!r) throw E(409, 'closed', '締め切りました');
      const sameView = async (v, st) => { delete v._id; return Object.assign({ vote: Boat.voteView(v, r), bpt: bptView(await bptDoc(true), r, v), race: Boat.lite(r), same: true }, st && st.prevLanded ? { prevLanded: st.prevLanded } : {}, st && st.dead ? { dead: true } : {}); };
      const landed = async () => { let x = null; try { x = await srvRead(ref); } catch (e) { return null; } if (!x.v || x.pending) return null; const st = Boat.opState(x.v, op, prev); return st ? { v: x.v, st } : null; }; // 届いていたか（番号の一覧で見る・サーバーから）
      /* 今の票はサーバーから読む（2026-11-21 深夜: 手元の写しにまだ送り終わっていない書き込みが混ざると「届いていた」と見てしまうため）。読めない・送り途中は失敗で返す */
      let old = null;
      { let x; try { x = await srvRead(ref); } catch (e) { throw mapVoteErr(e); } if (x.pending) throw pendingErr(); old = x.v; }
      /* 2026-11-21 深夜（M4）: 同じ番号の確かめ（もう通っている・前の番号が届いていた・取り消した番号）は、締切の判定より先に答える（何も足さない） */
      { const st = Boat.opState(old, op, prev); if (st) return sameView(old, st); }
      if (r.status !== 'upcoming' || t >= r.closeAt) throw E(409, 'closed', '締め切りました');
      if (t < r.openAt) throw E(409, 'not_open', '投票はまだ始まっていません');
      const lists = Boat.opLists(old, op, prev); // ops に今の番号・dead に前の番号（このあと遅れて届いても決まりが断る）
      const add = Boat.cleanPicks(o.add || []);
      const nick = Core.cleanNick(o.nick != null ? o.nick : old && old.nick);
      const pair = o.first != null || !old ? Boat.cleanPair(o) : { first: old.first, second: old.second };
      let cands = null;
      if (!old) {
        if (!Boat.CODE_RE.test(String(o.code || ''))) throw E(403, 'bad_code', 'テレビの QR を読み直してください');
        cands = derbyCands(o.dvs, r.day);
        if (!cands.length) throw E(403, 'no_derby', '今日の競馬に会計番号で参加したスマホだけ投票できます');
      }
      let w = null;
      if (add.length) {
        if (r.test) throw E(409, 'no_bpt', 'テストのレースでは BPT の券は使えません');
        w = await bptDoc(true); const bal = w ? Core.bptBalance(w, t) : 0; // 使う前は読み直す
        if (bal < add.length * Boat.STAKE) throw E(409, 'no_bpt', 'BPT が足りません');
      }
      const bets = Boat.addBets(old ? Boat.betsOf(old) : {}, add), n = Boat.betCount(bets); // 組番ごとの枚数（上限なし。何枚足しても 1 回の書き込み）。n ＝ 合計の枚数（決まりが「n ＝ bets の合計」「n の増えた分 × 100 ＝ 払った BPT」を確かめる）
      const write = async (dv, sid) => {
        const b = db.batch();
        if (add.length) b.update(doc(COLB.bpt, uid()), { spent: (Number(w.spent) || 0) + add.length * Boat.STAKE, buse: vid });
        const patch = { nick, first: pair.first, second: pair.second, bets, n, op, ops: lists.ops, dead: lists.dead, updatedAt: t };
        const nv = old ? Object.assign({}, old, patch) : Object.assign({ raceId, owner: uid(), storeId: sid, code: String(o.code), dv, votedAt: t }, patch);
        if (old) b.update(ref, patch); else b.set(ref, nv);
        try { await b.commit(); } catch (e) { if (add.length) bptNote(null); throw e; } // 届いたか分からない: BPT の写しは捨てる（次は読み直す）
        return nv;
      };
      let nv = null;
      if (old) { try { nv = await write(); } catch (e) { const x = await landed(); if (x) return sameView(x.v, x.st); throw mapVoteErr(e); } }
      else {
        let last = null;
        for (const x of cands) {
          if (x.day == null && !x.sure && !(await verifyDv(x, r.day))) continue; // 手動のレースの票: 読んで確かめる
          try { nv = await write(x.vid, x.storeId); break; }
          catch (e) {
            { const y = await landed(); if (y) return sameView(y.v, y.st); } // 同じ番号（または前の番号）が先に届いていた（打ち切りのあとの押し直しなど）
            if (!(e && e.code === 'permission-denied')) throw mapVoteErr(e);
            last = e;
            if (x.sure || dvMemo[x.vid]) break; // 競馬の票は確かめてある → 断られたのは別の理由（合言葉・締切・BPT）
            if (await verifyDv(x, r.day)) break; // 読んで確かめたら本物 → 別の理由
            // この競馬の票は使えない（スタッフが番号を空けた・別の日）→ 次の候補
          }
        }
        if (!nv) { if (last && cands.some((x) => dvMemo[x.vid] && dvMemo[x.vid].day === r.day)) throw mapVoteErr(last); throw E(403, 'no_derby', '今日の競馬に会計番号で参加したスマホだけ投票できます'); }
      }
      if (add.length) { w = Object.assign({}, w, { spent: (Number(w.spent) || 0) + add.length * Boat.STAKE, buse: vid }); bptNote(w); }
      else w = await bptDoc(false);
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
      const out = Object.assign({}, m); Object.keys(T.local).forEach((k) => { if (out[k] && out[k].status === 'void') return; /* 管理画面が取り消したレースは置き場の中身が正しい（自分の控えで「決めた」に戻さない） */ out[k] = Object.assign({}, out[k] || {}, T.local[k]); }); // 自分が書いたばかりの変化（見張りに届く前）
      return Object.values(out);
    }
    const note = (id, patch) => { T.local[id] = Object.assign({}, T.local[id] || {}, patch); };
    /* 2026-11-21（J2）: 発表・返還の途中のレースは、6 時間より古くても探して続ける（進行役が長く止まったあと）。60 秒に 1 回だけ読む（ふつうは 0 件） */
    async function pendingRaces() {
      if (T.pendAt && now() - T.pendAt < 60000 && T.pend) return T.pend;
      const m = {};
      /* 2026-11-21 深夜（K2・M8）: 締切を過ぎて「投票中」のまま残ったレース（進行役が締切の前から長く止まった）も探す（投票中のレースはふつう 1〜2 件） */
      for (const q of [db.collection(COLB.races).where('status', '==', 'decided'), db.collection(COLB.races).where('backDone', '==', false), db.collection(COLB.races).where('status', '==', 'upcoming')]) { try { (await q.get()).docs.forEach((d) => { m[d.id] = strip(Object.assign({ id: d.id }, d.data())); }); } catch (e) { /* 次の回 */ } }
      T.pendAt = now(); T.pend = Object.values(m); return T.pend;
    }
    /* 2026-11-21 深夜（K2・M8）: 締切から 6 時間を過ぎても決めていないレースは、決めずに取り消して BPT を全額戻す（映像も結果画面も出せない古いレースに、あとから結果だけ付けない。
       取り消しと同じ道＝スマホは「取り消し・BPT を戻しました」、戻し終わりは backDone）。画面には出さない（endAt ＝ いま） */
    const STALE_MS = 6 * 3600000;
    async function voidStale(r, why) {
      const rref = doc(COLB.races, r.id); let ok = false; why = why || 'stale';
      await db.runTransaction(async (tx) => { ok = false; const cur = data(await tx.get(rref)); if (!cur || cur.status !== 'upcoming' || (why === 'stale' && now() < cur.closeAt + STALE_MS)) return; const t = now(); tx.update(rref, { status: 'void', refunded: true, backDone: false, voidWhy: why, revealAt: t, endAt: why === 'late' ? t + 60000 : t }); ok = true; }); // late: 「取り消し・BPT を戻しました」を 1 分だけ出す
      if (!ok) return null;
      note(r.id, { status: 'void', refunded: true, backDone: false, voidWhy: why });
      return finishVoid(r.id);
    }
    /* 2026-11-21（J5）: 小分けの処理（決める・発表・取り消しの戻し）が失敗したら、理由と続けて失敗した回数を boatSecrets/<id> の stuck に残す（管理画面が赤字で出す）。うまくいったら消す */
    async function markStuck(id, step, e) {
      const f = (T.fail = T.fail || {}), x = (f[id] = { step, n: ((f[id] && f[id].step === step && f[id].n) || 0) + 1 });
      try { await doc(COLB.secrets, id).set({ stuck: { step, n: x.n, err: String((e && (e.code || e.message)) || e || 'error').slice(0, 80), errAt: now() } }, { merge: true }); } catch (x2) { /* 書けなくても次の回 */ }
    }
    async function clearStuck(id) { if (!T.fail || !T.fail[id]) return; delete T.fail[id]; try { await doc(COLB.secrets, id).set({ stuck: null }, { merge: true }); } catch (e) { /* noop */ } }
    /* レースを作る。同じ id のレースがもうあれば作らない（2026-11-20: 2 回作ると QR の合言葉・倍率が変わってしまうので、取引の中で「まだ無い」を確かめる）→ 置いてあるレース */
    async function create(e, cfg, sc) {
      const model = Boat.modelOf(Engine, Outcome, BoatModel, sc.salt, e.id); let odds = null;
      if (oddsAsync) { try { odds = await oddsAsync(model, Outcome.hash(sc.salt, e.id, 'odds'), cfg.oddsSims); } catch (x) { odds = null; } } // テレビは Worker で（絵を止めない）
      const built = Boat.buildRace(Engine, Outcome, BoatModel, e, cfg, sc.salt, now(), { odds, dayStartHour: sc.tuning.dayStartHour });
      const r = built.race; let have = null;
      await db.runTransaction(async (tx) => {
        have = strip(data(await tx.get(doc(COLB.races, r.id)))); if (have) return;
        tx.set(doc(COLB.races, r.id), Object.assign({}, r, { openAtTs: Ts(r.openAt), closeAtTs: Ts(r.closeAt) }));
        tx.set(doc(COLB.secrets, r.id), built.secret);
        tx.set(doc(COLB.keys, r.id), { code: Boat.newCode(rand), at: now() });
      });
      if (have) return Object.assign({ id: r.id }, have); // 手元の控え（note）には入れない: 置いてある中身はこのあと読める（古い中身で上書きしない）
      note(r.id, r);
      return r;
    }
    async function materialize(cfg, sc, races, derbyRaces) {
      if (!cfg.rules.length || T.making) return null;
      const t = now(), horizon = Math.max(cfg.voteSec * 1000 + 120000, ((sc.tuning && sc.tuning.horizonMin) || 15) * 60000), have = new Set(races.map((r) => r.id));
      let ders = null;
      for (const e of Boat.schedule(t, cfg.rules)) {
        if (e.at - t > horizon) break;
        if (e.at <= t + 1000 || have.has(e.id)) continue;
        if (Boat.quietSpan(e.at, cfg, sc.tuning && sc.tuning.dayStartHour)) continue; // 朝 5 時の前後は作らない（時刻表でも断っている。2026-11-20）
        if (!ders) ders = (derbyRaces || []).map((r) => r.at).concat(Core.scheduleAround(t, (sc.timetable && sc.timetable.rules) || []).map((x) => x.at));
        if (Boat.busyWithDerby(e.at, ders, sc.tuning, cfg)) continue; // 念のため（管理画面で断っている）: 競馬が勝つ
        T.making = true; try { await create(e, cfg, sc); } finally { T.making = false; }
        return e.id;
      }
      return null;
    }
    /* 票を持っている人の BPT の残り { 持ち主: 残り }（2026-11-20 夜。読み取りを少なく）: 10 人ずつ「id で一覧読み」する（'__name__' ＝ ドキュメントの id）。
       読み取りの数 ＝ BPT の書類がある人の数（まだ 1 回も当たっていない人の分は数えない。1 回の一覧読みは最低 1）＋決まりの確かめ（一覧読み 1 回につき 1）。
       1 人ずつ読むと「人数 × 2」（選ばれた進行役のテレビは 1 回ごとに決まりの確かめが付く）になるため。一覧読みが使えないときだけ 1 人ずつ読む */
    async function balsOf(owners) {
      const ids = Array.from(new Set((owners || []).filter(Boolean))), out = {}, t = now();
      try {
        for (let i = 0; i < ids.length; i += 10) { const q = await db.collection(COLB.bpt).where('__name__', 'in', ids.slice(i, i + 10)).get(); q.docs.forEach((d) => { out[d.id] = Core.bptBalance(d.data(), t); }); }
        ids.forEach((o) => { if (out[o] == null) out[o] = 0; });
        return out;
      } catch (e) { /* 一覧読みが使えない → 1 人ずつ */ }
      await Promise.all(ids.map(async (o) => { try { out[o] = Core.bptBalance(data(await doc(COLB.bpt, o).get()), t); } catch (e) { out[o] = 0; } }));
      return out;
    }
    /* 決める: その営業日に決めたレースの払う額の合計（boatStats の committed）から 1 日の上限の残りを出し、決めた取引の中でこのレースの払う額を足す
       （2026-11-20: 以前は発表のときに足していたので、発表待ちのレースの分を次のレースが知らず、1 日の上限を超えた）。
       取引の中で合計が読んだときから変わっていたら（ほかの進行役が同時に別のレースを決めた）、読み直して決め直す。
       票は置き場から読み直す（締切のあとは増えない。見張りの写しは届き遅れがありうるので、決めるときだけは使わない） */
    /* 2026-11-21 深夜（M5 オーナー決定）: 決めるのが遅れたら、次のレース（ボートの投票の始まり・競馬がテレビを使い始める時刻）までは映像を後ろへずらす（前は 60 秒まで）。
       映像の終わり（revealAt）がそれを超えるなら決めずに取り消して BPT を全額戻す（K2 と同じ道）。次のレースが無いときは上限なし（締切から 6 時間を過ぎたら K2 で取り消し） */
    function lateLimit(r, races, cfg, sc, ders) {
      let lim = r.closeAt + STALE_MS;
      (races || []).forEach((x) => { if (x && x.id !== r.id && x.at > r.at && x.status !== 'void' && x.openAt > r.closeAt) lim = Math.min(lim, x.openAt); });
      const nx = Boat.schedule(r.at + 1000, cfg.rules).find((e) => e.at > r.at && !(races || []).some((x) => x.id === e.id)); if (nx) lim = Math.min(lim, nx.at - cfg.voteSec * 1000);
      (ders || []).forEach((d) => { const sp = Boat.derbySpan(d, sc.tuning); if (sp[0] > r.closeAt) lim = Math.min(lim, sp[0]); });
      return lim;
    }
    async function decideOne(r, cfg, sc, lim) {
      const q = await db.collection(COLB.votes).where('raceId', '==', r.id).get(), votes = q.docs.map((d) => d.data()).filter((v) => v && v.owner);
      const sec = data(await doc(COLB.secrets, r.id).get()) || {}, names = await storeNames(), sref = doc(COLB.stats, r.day);
      /* 持てる BPT の上限 3,000（2026-11-20 夜）: 払い出しを「実際に増える分」で数えるため、票を持っている人の残りを読む（1 人 1 回。テストのレースは払わないので読まない）。
         読めなかった人は残り 0 と見る（空き 3,000。発表のときにもう一度確かめて 3,000 で止めるので、超えることは無い） */
      const bals = r.test ? {} : await balsOf(votes.map((v) => v.owner));
      for (let k = 0; k < 3; k++) {
        const used = usedOf(data(await sref.get()));
        const d = Boat.decide(Engine, Outcome, r, sec, votes, cfg, sc.salt, now(), used, bals, lim != null ? lim - r.runAt : null);
        if (lim != null && d.runAt - r.runAt > 60000 && d.revealAt > lim) return (await voidStale(r, 'late')) ? true : false; // 次のレースまでに映像が終わらない: 取り消して全額戻す
        const patch = { status: 'decided', runAt: d.runAt, revealAt: d.revealAt, endAt: d.endAt, participants: Boat.countVotes(votes) };
        let res = null;
        await db.runTransaction(async (tx) => {
          res = null;
          const cur = data(await tx.get(doc(COLB.races, r.id))); if (!cur || cur.status !== 'upcoming') { res = 'gone'; return; }
          const st = data(await tx.get(sref)); if (usedOf(st) !== used) { res = 'again'; return; }
          tx.update(doc(COLB.races, r.id), patch);
          tx.set(doc(COLB.secrets, r.id), { result: d.result, decision: d.decision, paid: d.paid, refunds: d.refunds, refunded: d.refunded, winners: d.winners.map((w) => Object.assign({ owner: w.owner, nick: w.nick, storeId: w.storeId, storeName: names[w.storeId] || w.storeId, amount: w.amount, n: w.n, gain: w.gain }, w.capped ? { capped: true } : {})) }, { merge: true }); // amount: 当たりの額・gain: 実際に増える分（3,000 まで）
          tx.set(doc(COLB.results, r.id), Object.assign({}, d.hidden, { runAtTs: Ts(d.hidden.runAt) }));
          if (!r.test) tx.set(sref, { committed: used + (Number(d.paid) || 0) }, { merge: true });
          res = 'ok';
        });
        if (res === 'ok') { note(r.id, patch); return true; }
        if (res !== 'again') return false;
      }
      return false;
    }
    /* 発表: 先に当たりと返還の BPT を入れる（人数が多くても 1 回の取引の上限に当たらないように分ける。入れた人の印 boatSecrets の credited を同じ取引で書く＝止まって復帰しても 2 回は入れない）。
       全員に入れ終わってからレースを「発表ずみ」にする（スマホは発表を見てから BPT を読むので、増えたあとの数が見える）。2026-11-20
       持てる BPT の上限 3,000（2026-11-20 夜）: 入れるときにもう一度その人の残りを見て 3,000 で止める（Boat.creditPlan。決めたときに数えた gain より多くは増やさない）。
       実際に増えた分を credited の g に・当たった人の票に got（増えた分）と capped（上限で止まった）を書く。集計（boatStats・レースの paid・当たった人の一覧の gain）は実際に増えた分で */
    async function revealOne(id) {
      const rref = doc(COLB.races, id), cref = doc(COLB.secrets, id);
      const r0 = data(await rref.get()); if (!r0 || r0.status !== 'decided') return false;
      const sec0 = data(await cref.get()) || {}, ws = r0.test ? [] : sec0.winners || [], back = r0.test ? {} : sec0.refunds || {};
      const win = {}; ws.forEach((w) => { const x = (win[w.owner] = win[w.owner] || { amount: 0, gain: 0 }); x.amount += Number(w.amount) || 0; x.gain += w.gain != null ? Number(w.gain) || 0 : Number(w.amount) || 0; });
      const owners = Array.from(new Set(Object.keys(win).concat(Object.keys(back)))).sort(), done0 = sec0.credited || {}, pend = owners.filter((o) => done0[o] == null), K = cap(100, 4);
      for (let i = 0; i < pend.length; i += K) {
        const part = pend.slice(i, i + K);
        const okc = await db.runTransaction(async (tx) => {
          const r = data(await tx.get(rref)); if (!r || r.status !== 'decided') return false;
          const cr = (data(await tx.get(cref)) || {}).credited || {}, todo = part.filter((o) => cr[o] == null), cur = [];
          for (const o of todo) cur.push(data(await tx.get(doc(COLB.bpt, o))));
          const t = now(), mark = {};
          todo.forEach((o, j) => {
            const w = win[o] || { amount: 0, gain: 0 }, p = Boat.creditPlan(cur[j], w.amount, t, back[o] || 0, r.at, w.gain); // 当たりと返還（フライング・転覆・上限）を 1 回で。週をまたいだレースは書かない（null）
            if (p) tx.set(doc(COLB.bpt, o), p.doc, { merge: true });
            const g = p ? p.gain : 0; mark[o] = { g, b: p ? p.back : 0 };
            const vu = {}; if (w.amount > 0) { vu.got = g; if (g < w.amount) vu.capped = true; } if ((back[o] || 0) > 0) vu.backGot = p ? p.back : 0; // スマホの結果用: 実際に増えた分・上限で止まった印・返還で実際に戻った額（2026-11-21 J6）
            if (Object.keys(vu).length) tx.update(doc(COLB.votes, Boat.voteId(id, o)), vu);
          });
          if (todo.length) tx.set(cref, { credited: mark }, { merge: true });
          return true;
        });
        if (!okc) return false;
      }
      let patch = null;
      await db.runTransaction(async (tx) => {
        patch = null;
        const r = data(await tx.get(rref)); if (!r || r.status !== 'decided') return;
        const sec = data(await tx.get(cref)) || {}, cr = sec.credited || {}; if (owners.some((o) => cr[o] == null)) return; // まだ入れていない人がいる（次の見回りで続きから）
        const st = data(await tx.get(doc(COLB.stats, r.day))) || {}, gainOf = (o) => (cr[o] && Number(cr[o].g)) || 0;
        const got = r.test ? 0 : owners.reduce((a, o) => a + gainOf(o), 0), held = r.test ? 0 : Number(sec.paid) || 0; // got: 実際に増えた合計・held: 決めたときに数えた合計
        const backGot = r.test ? 0 : owners.reduce((a, o) => a + ((cr[o] && Number(cr[o].b)) || 0), 0); // 返還で実際に戻った合計（2026-11-21 J6。上限 3,000 で減った分は入れない）
        const p = { status: 'done', result: sec.result || null, paid: got, backBpt: backGot, /* 返還で戻した BPT（取り消しの印 refunded とは別） */ people: (sec.winners || []).length,
          winners: (sec.winners || []).slice(0, 300).map((w) => { const g = r.test ? 0 : Math.min(Number(w.amount) || 0, gainOf(w.owner)); return Object.assign({ nick: w.nick, storeId: w.storeId, storeName: w.storeName || w.storeId, amount: w.amount, n: w.n, gain: g }, g < w.amount && !r.test ? { capped: true } : {}); }) }; // amount: 当たりの額・gain: 実際に増えた分・capped: 上限 3,000 で止まった
        const tn = now(); if (tn > (Number(r.revealAt) || 0) + 5000) p.endAt = Math.max(Number(r.endAt) || 0, tn + (Number(r.resultSec) || 120) * 1000); // 発表が遅れた: 結果画面をここから出す（2026-11-21）
        const stp = { paid: (Number(st.paid) || 0) + got, races: (Number(st.races) || 0) + 1 };
        if (!r.test && got !== held) stp.committed = Math.max(0, usedOf(st) - (held - got)); // 決めたあとに残りが変わって、数えたより少なく増えた分は 1 日の使った額から戻す
        tx.set(doc(COLB.stats, r.day), stp, { merge: true });
        tx.update(rref, p); patch = p;
      });
      if (patch) note(id, patch);
      return !!patch;
    }
    /* 取り消したレース（status 'void'）の BPT を戻す続き（2026-11-20）: 取り消しの印を先に付けてから票を読む（印のあとは決まりが票を受け付けない＝読んだあとで券が増えない）。
       票ごとに「戻した」印 back を同じ取引で付ける＝何度呼んでも 1 回だけ。人数が多くても分ける。全部終わったらレースに backDone。管理画面が途中で閉じても、進行役の見回りが続きをやる
       → { 持ち主: 戻した BPT }（もう終わっていれば {}。取り消したレースでなければ null） */
    async function finishVoid(id) {
      const rref = doc(COLB.races, id), r0 = data(await rref.get()); if (!r0 || r0.status !== 'void') return null;
      if (r0.backDone === true) return {};
      const q = await db.collection(COLB.votes).where('raceId', '==', id).get(), todo = q.docs.map((d) => Object.assign({ _vid: d.id }, d.data())).filter((v) => v.owner && !v.back && Boat.betCount(Boat.betsOf(v)) > 0);
      const back = {}, K = cap(100, 3);
      for (let i = 0; i < todo.length; i += K) {
        const part = todo.slice(i, i + K); let got = null;
        await db.runTransaction(async (tx) => {
          got = {};
          const vs = [], cur = []; for (const v of part) vs.push(data(await tx.get(doc(COLB.votes, v._vid)))); for (const v of part) cur.push(data(await tx.get(doc(COLB.bpt, v.owner))));
          const t = now();
          part.forEach((v, j) => { const x = vs[j]; if (!x || x.back) return; const n = Boat.betCount(Boat.betsOf(x)) * Boat.STAKE, p = Boat.creditPlan(cur[j], n, t, true, r0.at); if (p) { tx.set(doc(COLB.bpt, v.owner), p.doc, { merge: true }); got[v.owner] = (got[v.owner] || 0) + p.back; /* 実際に戻した分（残りは 3,000 まで） */ } tx.update(doc(COLB.votes, v._vid), { back: true, voidGot: p ? p.back : 0 }); /* voidGot: 実際に戻った額（2026-11-21 J6） */ });
        });
        Object.keys(got || {}).forEach((o) => { back[o] = (back[o] || 0) + got[o]; });
      }
      await rref.update({ backDone: true }); note(id, { backDone: true });
      return back;
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
      if (!live.next && cfg.rules.length) { const e = Boat.schedule(t, cfg.rules).find((x) => x.at - cfg.voteSec * 1000 > t && !Boat.quietSpan(x.at, cfg)); if (e) live.next = { id: e.id, at: e.at, openAt: e.at - cfg.voteSec * 1000 }; } // まだ作っていない次のレース（時刻表から）
      const sig = stable(live);
      if (sig === T.liveSig) return false;
      if (!T.liveSig) { // 進行役になって最初の 1 回（2026-11-20）: いま置いてある中身を 1 回読み、同じなら書かない（書くと、見張っているスマホ・テレビの全員がもう 1 回読むことになる）
        try { const cur = strip(data(await doc(COLB.live, 'all').get())); if (cur) { delete cur.updatedAt; if (stable(cur) === sig) { T.liveSig = sig; return false; } } } catch (e) { /* 読めなければ書く */ }
      }
      await doc(COLB.live, 'all').set(Object.assign({}, live, { updatedAt: t }));
      T.liveSig = sig; return true;
    }
    async function tick(sc, derbyRaces) {
      const did = [], cfg = await getCfg();
      let races = await getRaces(); const t = now();
      const all = races.slice(), seen = new Set(all.map((r) => r.id)); (await pendingRaces()).forEach((r) => { if (!seen.has(r.id)) all.push(r); });
      let firstErr = null, ders = null;
      for (const r of all.sort((a, b) => a.at - b.at)) {
        const step = r.status === 'upcoming' && t >= r.closeAt + 1500 ? (t >= r.closeAt + STALE_MS ? 'stale' : 'decide') : r.status === 'decided' && t >= r.revealAt ? 'reveal' : r.status === 'void' && r.backDone === false ? 'void' : null;
        if (!step) continue;
        try {
          if (step === 'decide') { if (!ders) ders = (derbyRaces || []).map((x) => x.at).concat(Core.scheduleAround(t, (sc.timetable && sc.timetable.rules) || []).map((x) => x.at)); if (await decideOne(r, cfg, sc, lateLimit(r, all, cfg, sc, ders))) did.push('boat decide ' + r.id); }
          else if (step === 'stale') { if (await voidStale(r)) did.push('boat void-stale ' + r.id); }
          else if (step === 'reveal') { if (await revealOne(r.id)) did.push('boat reveal ' + r.id); }
          else if (await finishVoid(r.id)) did.push('boat void-back ' + r.id); // 取り消しの BPT の戻しが途中（管理画面が閉じた）: 続きをやる
          await clearStuck(r.id);
        } catch (e) { await markStuck(r.id, step, e); if (!firstErr) firstErr = e; } // ほかのレースは続ける。最後に投げる（鍵の lastErr にも残る）
      }
      if (did.length) T.pendAt = 0;
      const made = await materialize(cfg, sc, races, derbyRaces); if (made) did.push('boat create ' + made);
      if (did.length) races = await getRaces();
      await counts(races, now());
      await publish(races, cfg, now());
      if (firstErr) throw firstErr;
      return did;
    }
    function stop() { [T.cfgUn, T.raceUn, T.cntUn].forEach((u) => { if (u) { try { u(); } catch (e) { /* noop */ } } }); T.cfgUn = T.raceUn = T.cntUn = null; T.races = null; T.cfg = null; T.cntFor = null; T.liveSig = ''; /* liveSig を空に: 次に進行役になったら、置いてある中身を 1 回読んで比べる（publish） */ }

    /* ---------- 管理（マスター。client-firestore.js の admin() の wrap の中で呼ぶ） ---------- */
    async function derbyRulesNow() { const s = data(await doc(COLB.config, 'secret').get()) || {}; return { rules: (s.timetable && s.timetable.rules) || [], tuning: Core.tuningOf(s.tuning || {}) }; }
    const conflictErr = (cs, pre) => E(409, 'boat_conflict', (pre || '') + cs[0].text, { conflicts: cs.slice(0, 20) });
    function admin(wrap) {
      return {
        boatConfig: wrap(async () => {
          const cfg = Boat.configOf(data(await doc(COLB.config, 'boat').get()) || {}), dr = await derbyRulesNow(), day = Core.bizDate(now(), dr.tuning.dayStartHour);
          const q = await db.collection(COLB.races).where('day', '==', day).get(), st = data(await doc(COLB.stats, day).get()) || {};
          const races = []; for (const d of q.docs) { const r = strip(Object.assign({ id: d.id }, d.data())), s = data(await doc(COLB.secrets, d.id).get()) || {}; races.push(Object.assign(Boat.lite(r), { participants: r.participants, target: s.target, decision: s.decision || null })); }
          races.sort((a, b) => a.at - b.at);
          /* 小分けの処理が失敗し続けている印（2026-11-21 J5）: 今日のレースと、発表・取り消しの戻しの途中のレース（前の日も） */
          const stuck = [], sid = new Set(); const pushStuck = (r, sx) => { if (sid.has(r.id) || !sx || !sx.stuck || !(Number(sx.stuck.n) > 0)) return; sid.add(r.id); stuck.push(Object.assign({ id: r.id, at: r.at }, sx.stuck)); };
          for (const d of q.docs) { const s2 = data(await doc(COLB.secrets, d.id).get()); pushStuck({ id: d.id, at: d.data().at }, s2); const it = races.find((x) => x.id === d.id); if (it && s2 && s2.stuck && Number(s2.stuck.n) > 0) it.stuck = s2.stuck; }
          for (const qq of [db.collection(COLB.races).where('status', '==', 'decided'), db.collection(COLB.races).where('backDone', '==', false)]) { try { for (const d of (await qq.get()).docs) { if (!sid.has(d.id)) pushStuck({ id: d.id, at: d.data().at }, data(await doc(COLB.secrets, d.id).get())); } } catch (e) { /* noop */ } }
          return { cfg, used: usedOf(st), races, stuck, conflicts: Boat.conflicts(cfg.rules, dr.rules, dr.tuning, cfg, now(), 14) };
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
          o = o || {}; const cfg0 = Boat.configOf(data(await doc(COLB.config, 'boat').get()) || {}), s = data(await doc(COLB.config, 'secret').get()) || {}, inSec = Math.max(5, Math.min(3600, Number(o.inSec) || 60)), tu = Core.tuningOf(s.tuning || {});
          const cfg = Object.assign({}, cfg0, { voteSec: Math.max(5, Math.min(cfg0.voteSec, Number(o.voteSec) || inSec)) }), id = 'bx-' + Boat.newCode(rand).toLowerCase().slice(0, 6), at = now() + inSec * 1000;
          if (!o.test && Boat.quietSpan(at, cfg, tu.dayStartHour)) throw E(409, 'quiet', 'ボートは朝 ' + Boat.quietText(tu.dayStartHour) + ' には始められません（BPT のリセットと営業日の区切りの前後。投票の始まりから結果画面の終わりまでがかからないように。テストのレースは始められます）');
          /* 2026-11-21（I2）: ほかのボート（投票中・映像中・結果中・作る予定）と、時刻表の競馬（作ったもの・作る予定）と被るなら断る（全店のテレビの流れが崩れるため） */
          const span = Boat.boatSpan(at, cfg), bq = await db.collection(COLB.races).where('at', '>=', now() - 6 * 3600000).get();
          const hit = Boat.busyWithBoat(span[0], span[1], bq.docs.map((d) => strip(Object.assign({ id: d.id }, d.data()))), cfg0.rules, cfg0, now());
          if (hit) throw E(409, 'boat_busy', 'ほかのボート（' + Core.fmtBizTime(hit.at, tu.dayStartHour) + ' 締切）の投票・映像・結果の時間と重なります。終わってから始めてください');
          let ders = Core.scheduleAround(now(), (s.timetable && s.timetable.rules) || []).map((x) => x.at);
          /* 2026-11-21 深夜（K1）: 管理画面で作った手動の競馬（id が x-）・スタッフのテストレースも見る（以前は時刻表の競馬だけ＝手動の競馬の投票中にボートを始められ、同じ BPT を両方に使う道が開いていた） */
          try { (await db.collection(COLB.draces).where('at', '>=', now() - 3 * 3600000).get()).docs.forEach((d) => { const x = d.data() || {}; if (!x.refunded && x.status !== 'void' && Number(x.at) > 0) ders.push(Number(x.at)); }); } catch (e) { /* 読めなければ時刻表だけ */ }
          ders = ders.filter((x) => Boat.busyWithDerby(at, [x], tu, cfg));
          if (ders.length) throw E(409, 'derby_busy', Core.fmtBizTime(ders[0], tu.dayStartHour) + ' の競馬と重なります（競馬の投票から結果画面の最初の 2 分まで）。時刻をずらしてください');
          const r = await create({ id, at, payout: o.payout, test: !!o.test }, Object.assign(cfg, { oddsSims: o.sims || cfg.oddsSims }), { salt: s.salt || 'nosalt', tuning: tu });
          return { race: Boat.lite(r) };
        }),
        /* 取り消し: 足した BPT の券を全額戻す（2026-11-18 オーナー決定）。
           2026-11-20: 先にレースを「取り消し」にしてから票を読んで戻す（以前は票を先に読んでいたので、同時に足された券の BPT が戻らなかった）。決めたあとの取り消しは 1 日の使った額の予約も戻す */
        boatRefund: wrap(async (raceId) => {
          const id = String(raceId || ''), rref = doc(COLB.races, id);
          await db.runTransaction(async (tx) => {
            const r = data(await tx.get(rref)); if (!r) throw E(404, 'no_race', 'レースが見つかりません'); if (r.status === 'done') throw E(409, 'done', '発表したレースは取り消せません'); if (r.status === 'void') return;
            const t = now(), held = r.status === 'decided' && !r.test;
            const sec = r.status === 'decided' ? data(await tx.get(doc(COLB.secrets, id))) || {} : null, st = held ? data(await tx.get(doc(COLB.stats, r.day))) : null;
            if (sec && sec.credited && Object.keys(sec.credited).length) throw E(409, 'crediting', '発表の途中（BPT を入れ始めた）のレースは取り消せません。少し待つと発表されます'); // 2026-11-21（G2・J1）: 当たりと返還の両方が残らないように
            if (held) tx.set(doc(COLB.stats, r.day), { committed: Math.max(0, usedOf(st) - (Number(sec.paid) || 0)) }, { merge: true });
            tx.update(rref, { status: 'void', refunded: true, backDone: false, revealAt: Math.max(t, r.openAt), endAt: Math.max(t, r.openAt) + 60000 });
          });
          const back = await finishVoid(id);
          return { ok: true, back: back || {} };
        }),
      };
    }
    // 競馬の時刻表を保存するとき、ボートと被らないか（被れば 409 boat_conflict）
    async function checkDerbyRules(rules, tuning) { const cfg = Boat.configOf(data(await doc(COLB.config, 'boat').get()) || {}); if (!cfg.rules.length) return; const cs = Boat.conflicts(cfg.rules, rules, tuning, cfg, now(), 14); if (cs.length) throw conflictErr(cs); }
    // 競馬の設定（投票の秒数など）を保存するとき（2026-11-20）: 競馬がテレビをふさぐ長さ・朝の区切りが変わるときだけ、ボートと被らないか確かめる（ほかの設定の保存は止めない）
    async function checkDerbyTuning(curTuning, nextTuning, rules) { if (!Boat.derbyTimingChanged(curTuning, nextTuning)) return; const cfg = Boat.configOf(data(await doc(COLB.config, 'boat').get()) || {}); if (!cfg.rules.length) return; const cs = Boat.conflicts(cfg.rules, rules || [], nextTuning, cfg, now(), 14); if (cs.length) throw conflictErr(cs, 'この設定にすると競馬がボートと重なります: '); }
    /* 管理画面の手動の競馬（2026-11-21 深夜 K1）: 時間 [t0, t1] がボートと被るか → 被るボート | null。管理画面から 1 回だけ読む（見張りを作らない）。ボートの決まりを入れる前（読めない）は null */
    async function derbyBusy(t0, t1) {
      let cfg, races;
      try { cfg = Boat.configOf(data(await doc(COLB.config, 'boat').get()) || {}); races = (await db.collection(COLB.races).where('at', '>=', now() - 6 * 3600000).get()).docs.map((d) => strip(Object.assign({ id: d.id }, d.data()))); } catch (e) { return null; }
      return Boat.busyWithBoat(t0, t1, races, cfg.rules, cfg, now());
    }
    // 競馬のスタッフのテストレース（時間 [t0, t1]）がボートと被るか（進行役が作る前に確かめる。2026-11-20）→ 被るボート | null
    async function testBusy(t0, t1) { const cfg = await getCfg(), races = await getRaces(); return Boat.busyWithBoat(t0, t1, races, cfg.rules, cfg, now()); }

    return { api: { boatState, boatWatch, boatRace, boatKey, boatVote, myBoatVote }, tick, stop, admin, checkDerbyRules, checkDerbyTuning, testBusy, derbyBusy, finishVoid, create /* create: 試験用（同じレースを 2 回作っても上書きしないこと） */ };
  }
  return { attach, COLB };
});
