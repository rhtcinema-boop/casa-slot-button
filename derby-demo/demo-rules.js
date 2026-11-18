/* casa DERBY Web デモ: Firestore のルール（v2/firestore.rules）と同じ決まりを JS で（tests/v2-firestore.test.js の RULES をそのまま写したもの。v4・2026-10-21）。
   にせ Firestore（v2/fake-firestore.js）が読み書きのたびに呼ぶ。PIN ちがい・ほかの人の票・発表前の結果などはここで断られる。 */
window.DemoRules = function (MASTER, TV) {
  'use strict';
  function permErr(m) { const e = new Error('permission: ' + m); e.code = 'permission-denied'; return e; }
  const ms = (v) => (v && v.toMillis ? v.toMillis() : v);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function RULES(ctx) {
    const { op, coll, id, before, after } = ctx;
    if (op === 'list') return;
    const email = (ctx.auth && ctx.auth.token.email) || '', signed = !!ctx.auth, master = email === MASTER;
    const get = (p) => ctx.getDoc(p), now = ctx.now;
    // 決める係（v2/firestore.rules の isDecider と同じ順番: マスター → テレビ用アカウント → 管理画面で選んだ進行役のテレビ derbyDeciders/<uid>。2026-10-19）
    const dec = () => master || email === TV || (signed && !!get('derbyDeciders/' + ctx.auth.uid));
    const tvSelf = () => signed && ctx.auth.uid === id && !!ctx.auth.token.firebase && ctx.auth.token.firebase.sign_in_provider === 'anonymous';
    const tvShape = () => { const d = after || {}; return ['store', 'kind', 'at', 'code'].every((k) => k in d) && typeof d.store === 'string' && /^[a-z0-9_-]{1,32}$/.test(d.store) && (d.kind === 'casatv' || d.kind === 'browser') && ms(d.at) === now && typeof d.code === 'string' && /^[0-9]{4}$/.test(d.code) && (!('h' in d) || tvHealthOk(d.h)); }; const tvHealthOk = ((h) => !!(window.DerbyTvHealth && window.DerbyTvHealth.valid(h))); // テレビの調子 h（2026-10-29。v2/firestore.rules の tvHealthOk と同じ＝v2/tvhealth.js の valid）
    const pinOf = (s) => { const d = get('derbyPins/' + s); return d ? d.pin : undefined; };
    const staffOf = (s) => { if (!signed) return false; const st = get('derbyStaff/' + ctx.auth.uid); return !!(st && st.storeId === s && st.pin === pinOf(s)); };
    const changed = () => { const ks = new Set(Object.keys(before || {}).concat(Object.keys(after || {}))); return Array.from(ks).filter((k) => !same((before || {})[k], (after || {})[k])); };
    const only = (arr) => changed().every((k) => arr.includes(k));
    // テレビのゲーム（2026-10-19。v2/firestore.rules の myStaffStore・tvGameOnly と同じ）
    const myStaffStore = () => (signed ? (get('derbyStaff/' + ctx.auth.uid) || {}).storeId : undefined);
    const tvGameOnly = () => { const a = (after || {}).settings, b = (before || {}).settings || {}; if (!only(['settings']) || !a || typeof a !== 'object') return false; const ks = new Set(Object.keys(a).concat(Object.keys(b))); return Array.from(ks).every((k) => k === 'tvGame' || same(a[k], b[k])) && (a.tvGame === 'slot' || a.tvGame === 'derby'); };
    const tvQualityOnly = () => { const a = (after || {}).settings, b = (before || {}).settings || {}; if (!only(['settings']) || !a || typeof a !== 'object') return false; const ks = new Set(Object.keys(a).concat(Object.keys(b))); return Array.from(ks).every((k) => k === 'tvQuality' || same(a[k], b[k])) && ['', 'auto', 'max', 'lite', 'min'].includes(a.tvQuality); };
    const switchStaffOk = () => { const my = myStaffStore(); return !!my && staffOf(my) && (before ? only([my]) : Object.keys(after || {}).every((k) => k === my)); };
    const keysOnly = (o, arr) => Object.keys(o).every((k) => arr.includes(k));
    // スタンプラリーの 2 票目に使う数（公開の設定 derbyConfig/public の stamp。オフ・無い ＝ 0 ＝ 使えない。2026-11-02）
    const stampCost = () => { const s = (get('derbyConfig/public') || {}).stamp; return s && s.on === true && Number.isInteger(s.cost) && s.cost > 0 ? s.cost : 0; };
    // v4 の票（v2/firestore.rules の voteShape・voteOpen と同じ）
    const voteShape = (d) => !!d && typeof d.bill === 'string' && /^(0[1-9]|[1-9][0-9])$/.test(d.bill) && typeof d.nick === 'string' && Array.from(d.nick).length >= 1 && Array.from(d.nick).length <= 8
      && Number.isInteger(d.first) && Number.isInteger(d.second) && d.first >= 0 && d.first <= 5 && d.second >= 0 && d.second <= 5 && d.first !== d.second;
    const voteOpen = (r, sid) => !!r && r.status === 'upcoming' && now >= ms(r.openAtTs) && now < ms(r.closeAtTs) && (r.storeId == null || r.storeId === sid) && (r.storeIds == null || (Array.isArray(r.storeIds) && r.storeIds.includes(sid))); /* storeIds: 投票できる店（2026-10-26） */
    const R = op === 'get';
    // 本物: ドキュメントがなく、ルールが resource.data を見ていると拒否になる（票は resource == null を許すので入れない）
    if (R && !before && ['derbyResults', 'derbyPayouts', 'derbyLogs'].includes(coll) && !dec()) throw permErr(coll + '/' + id + ' missing');
    const deny = (m) => { throw permErr(coll + '/' + id + ' ' + op + ' ' + m); };
    const allow = (c, m) => { if (!c) deny(m || ''); };
    switch (coll) {
      case 'derbyStores': if (R) return allow(signed); if (op === 'update') return allow(master || (staffOf(id) && only(['nextSeq']) && after.nextSeq === before.nextSeq + 1) || (staffOf(id) && tvGameOnly()) || (staffOf(id) && tvQualityOnly()) || (tvGameOnly() && after.settings.tvGame === 'derby' && dec()), 'store update'); return allow(master);
      case 'derbyPins': return allow(master);
      case 'derbyStaff': if (R || op === 'delete') return allow(signed && ctx.auth.uid === id); return allow(signed && ctx.auth.uid === id && keysOnly(after, ['storeId', 'pin', 'at']) && !!get('derbyPins/' + after.storeId) && after.pin === pinOf(after.storeId), 'staff pin');
      case 'derbyConfig': if (id === 'public') return allow(R ? signed : master); return allow(R ? dec() : master);
      case 'derbySchedule': if (id !== 'public') return deny('only public'); if (R) return; return allow(master); /* v2/firestore.rules の derbySchedule/public と同じ（読むのはログインなしでも・書くのはマスターだけ） */
      case 'derbySwitch': if (R) return; if (op === 'delete') return allow(master); return allow(id === 'tv' && Object.values(after || {}).every((v) => v === 'slot' || v === 'derby') && (master || switchStaffOk() || dec()), 'switch write'); /* v2/firestore.rules の derbySwitch と同じ（読むのは誰でも・書くのはマスターと、その店のスタッフが自分の店だけ・v4 は決める係も） */
      case 'derbyClock': return allow(signed && ctx.auth.uid === id);
      case 'derbyLock': return allow(R ? signed : dec());
      case 'derbyTvs':
        if (R) return allow(master || (signed && ctx.auth.uid === id) || dec());
        if (op === 'create') return allow(tvSelf() && Object.keys(after).every((k) => ['store', 'kind', 'at', 'code', 'h'].includes(k)) && tvShape(), 'tv create');
        if (op === 'update') return allow(master || (tvSelf() && only(['store', 'kind', 'at', 'code', 'h']) && Object.keys(after).every((k) => ['store', 'kind', 'at', 'code', 'ask', 'h'].includes(k)) && tvShape()), 'tv update');
        return allow(master);
      case 'derbyDeciders': return allow(R ? master || (signed && ctx.auth.uid === id) : master);
      case 'derbyTestReq': {
        if (R) return allow(dec() || staffOf(id));
        if (op === 'delete') return allow(dec());
        const a = after || {}, okStaff = staffOf(id) && Object.keys(a).length === 3 && ['at', 'by', 'startIn'].every((k) => k in a) && a.by === ctx.auth.uid && ms(a.at) === now && Number.isInteger(a.startIn) && a.startIn >= 60 && a.startIn <= 600 && (!before || now > ms(before.at) + 8000);
        return allow(okStaff || dec(), 'test req');
      }
      case 'derbyRaces': return allow(R ? signed : dec());
      case 'derbyCounts': return allow(R ? signed : dec());
      case 'derbyLive': return allow(R ? signed : dec());
      case 'derbyResults': if (R) return allow((signed && !!before && now >= ms(before.runAtTs) - 2000) || dec(), 'result before gate'); return allow(dec());
      case 'derbyRaceSecrets': return allow(dec(), 'secret');
      case 'derbyVotes': {
        if (R) return allow(!before || (signed && before.owner === ctx.auth.uid) || dec() || staffOf(before.storeId), 'vote read');
        if (op === 'create') {
          const a0 = after || {};
          if (a0.stamp !== undefined) { // スタンプラリーの 2 票目（2026-11-02。仮・デモだけ）: 自分の 1 票目があり、同じ書き込みでスタンプの使った数が cost 増え、使う前に cost 個以上あった
            const a = a0, uid = signed ? ctx.auth.uid : null, r = get('derbyRaces/' + a.raceId), v1 = get('derbyVotes/' + a.raceId + '~' + a.storeId + '~' + a.bill), sb = signed ? get('derbyStamps/' + uid) : null, sa = signed ? ctx.getAfter('derbyStamps/' + uid) : null, C = stampCost();
            return allow(signed && a.owner === uid && keysOnly(a, ['vid', 'raceId', 'storeId', 'bill', 'nick', 'first', 'second', 'owner', 'votedAt', 'updatedAt', 'test', 'n', 'stamp']) && ['vid', 'raceId', 'storeId', 'bill', 'nick', 'first', 'second', 'owner', 'test', 'n', 'stamp'].every((k) => k in a)
              && a.stamp === true && a.n === 2 && a.test === false && a.vid === id && typeof a.raceId === 'string' && typeof a.storeId === 'string' && id === a.raceId + '~' + a.storeId + '~' + a.bill + '~2' && voteShape(a) && voteOpen(r, a.storeId) && !!r && r.test !== true
              && !!v1 && v1.owner === uid && v1.test === false && C > 0 && !!sb && !!sa && (sb.earned || 0) - (sb.spent || 0) >= C && sa.spent === (sb.spent || 0) + C && sa.use === id, 'vote2 stamp create');
          }
          if (a0.n !== undefined) { // 初参加ボーナスの 2 票目（v2/firestore.rules の 2 つ目の create・bonusOk と同じ。2026-10-24）
            const a = a0, uid = signed ? ctx.auth.uid : null, r = get('derbyRaces/' + a.raceId), v1 = get('derbyVotes/' + a.raceId + '~' + a.storeId + '~' + a.bill), dv = signed ? get('derbyDevices/' + uid) : null, mk = 'derbyBonus/' + (r ? r.day : '') + '~' + a.storeId + '~' + a.bill, md = 'derbyBonusDev/' + (r ? r.day : '') + '~' + uid; /* md: 同じ端末のボーナスは 1 日 1 回（2026-10-27） */
            return allow(signed && a.owner === uid && keysOnly(a, ['vid', 'raceId', 'storeId', 'bill', 'nick', 'first', 'second', 'owner', 'votedAt', 'updatedAt', 'test', 'n']) && ['vid', 'raceId', 'storeId', 'bill', 'nick', 'first', 'second', 'owner', 'test', 'n'].every((k) => k in a)
              && a.n === 2 && a.vid === id && typeof a.raceId === 'string' && typeof a.storeId === 'string' && id === a.raceId + '~' + a.storeId + '~' + a.bill + '~2' && voteShape(a) && voteOpen(r, a.storeId)
              && !!v1 && v1.owner === uid && a.test === v1.test
            && ((v1.test === true && (!dv || dv.firstRaceId === a.raceId)) || (v1.test !== true && !!dv && dv.firstRaceId === a.raceId && !get(mk) && !!ctx.getAfter(mk) && !get(md) && !!ctx.getAfter(md))), 'vote2 create'); /* 本物の票は端末のリストが要る・端末の日の印（2026-10-27） */
          }
          const a = after || {}, r = get('derbyRaces/' + a.raceId), st = get('derbyStores/' + a.storeId);
          return allow(signed && a.owner === ctx.auth.uid && keysOnly(a, ['vid', 'raceId', 'storeId', 'bill', 'nick', 'first', 'second', 'owner', 'votedAt', 'updatedAt', 'test']) && ['vid', 'raceId', 'storeId', 'bill', 'nick', 'first', 'second', 'owner', 'test'].every((k) => k in a)
            && a.vid === id && typeof a.raceId === 'string' && typeof a.storeId === 'string' && id === a.raceId + '~' + a.storeId + '~' + a.bill && voteShape(a) && voteOpen(r, a.storeId)
            && !!st && a.test === ((!!r && r.test === true) || ((st.settings || {}).test === true)), 'vote create');
        }
        if (op === 'update') { if (signed && before.owner === ctx.auth.uid) return allow(only(['nick', 'first', 'second', 'updatedAt']) && voteShape(after) && voteOpen(get('derbyRaces/' + before.raceId), before.storeId), 'vote update'); return allow(dec(), 'vote update'); }
        { const r = get('derbyRaces/' + before.raceId); return allow((staffOf(before.storeId) && !!r && r.status === 'upcoming' && now < ms(r.closeAtTs)) || dec(), 'vote delete'); }
      }
      case 'derbyDevices': { // 端末のリスト（v2/firestore.rules の derbyDevices と同じ。2026-10-24）
        const mine = signed && ctx.auth.uid === id, K = ['firstAt', 'firstRaceId', 'firstStore', 'lastAt', 'lastRaceId', 'lastStore', 'races'], SID = /^[a-z0-9_-]{1,32}$/;
        if (R) return allow(mine || master, 'device read');
        if (op === 'delete') return allow(master, 'device delete');
        const a = after || {};
        if (op === 'create') { const r = get('derbyRaces/' + a.firstRaceId); return allow(mine && keysOnly(a, K) && K.every((k) => k in a) && typeof a.firstAt === 'number' && a.firstAt === a.lastAt && typeof a.firstRaceId === 'string' && a.firstRaceId === a.lastRaceId
          && typeof a.firstStore === 'string' && SID.test(a.firstStore) && a.firstStore === a.lastStore && a.races === 1 && !!r && r.test !== true, 'device create'); }
        return allow(mine && only(['lastAt', 'lastRaceId', 'lastStore', 'races']) && a.races === before.races + 1 && typeof a.lastAt === 'number' && typeof a.lastRaceId === 'string' && a.lastRaceId !== before.lastRaceId && typeof a.lastStore === 'string' && SID.test(a.lastStore), 'device update');
      }
      case 'derbyBonus': { // 初参加ボーナスを使った印（v2/firestore.rules の derbyBonus と同じ。2026-10-24）
        if (R) return allow(!before || (signed && before.owner === ctx.auth.uid) || dec(), 'bonus read');
        if (op === 'delete') return allow(master, 'bonus delete');
        if (op === 'update') return deny('bonus update');
        const a = after || {}, r = get('derbyRaces/' + a.raceId), v2 = typeof a.raceId === 'string' ? ctx.getAfter('derbyVotes/' + a.raceId + '~' + a.storeId + '~' + a.bill + '~2') : null;
        return allow(signed && a.owner === ctx.auth.uid && keysOnly(a, ['day', 'storeId', 'bill', 'raceId', 'owner', 'at']) && ['day', 'storeId', 'bill', 'raceId', 'owner'].every((k) => k in a) && typeof a.raceId === 'string' && typeof a.storeId === 'string' && typeof a.bill === 'string'
          && id === a.day + '~' + a.storeId + '~' + a.bill && !!r && a.day === r.day && !!v2 && v2.owner === ctx.auth.uid && v2.test === false, 'bonus create');
      }
      case 'derbyBonusDev': { // 同じ端末のボーナスは 1 日 1 回（v2/firestore.rules の derbyBonusDev と同じ。2026-10-27）
        if (R) return allow(!before || (signed && before.owner === ctx.auth.uid) || dec(), 'bonusdev read');
        if (op === 'delete') return allow(master, 'bonusdev delete');
        if (op === 'update') return deny('bonusdev update');
        const a = after || {}, r = typeof a.raceId === 'string' ? get('derbyRaces/' + a.raceId) : null, v2 = typeof a.raceId === 'string' ? ctx.getAfter('derbyVotes/' + a.raceId + '~' + a.storeId + '~' + a.bill + '~2') : null;
        return allow(signed && a.owner === ctx.auth.uid && keysOnly(a, ['day', 'owner', 'raceId', 'storeId', 'bill', 'at']) && ['day', 'owner', 'raceId', 'storeId', 'bill'].every((k) => k in a) && typeof a.raceId === 'string' && typeof a.storeId === 'string' && typeof a.bill === 'string' && typeof a.day === 'string'
          && id === a.day + '~' + ctx.auth.uid && !!r && a.day === r.day && !!v2 && v2.owner === ctx.auth.uid && v2.test === false, 'bonusdev create');
      }
      case 'derbyStamps': { // スタンプラリー（2026-11-02。仮・デモだけ）: 自分のだけ読める。付けるのは決める係。自分は「2 票目に使う」、スタッフは「消した 2 票目のぶんを戻す」だけ
        const mine = signed && ctx.auth.uid === id, C = stampCost();
        if (R) return allow(mine || dec(), 'stamps read');
        if (op === 'create' || op === 'delete') return allow(dec(), 'stamps ' + op);
        if (dec()) return;
        const b = before || {}, a = after || {}, num = (x) => typeof x === 'number';
        if (mine && only(['spent', 'use'])) { // 使う: 同じ書き込みで、まだ無かったスタンプの 2 票目ができる
          const v = typeof a.use === 'string' ? ctx.getAfter('derbyVotes/' + a.use) : null;
          return allow(C > 0 && num(a.spent) && a.spent === (b.spent || 0) + C && a.spent <= (b.earned || 0) && !!v && v.stamp === true && v.owner === id && !get('derbyVotes/' + a.use), 'stamps use');
        }
        if (only(['spent', 'refund'])) { // 戻す: その店のスタッフが、同じ書き込みでスタンプの 2 票目を消した
          const v = typeof a.refund === 'string' ? get('derbyVotes/' + a.refund) : null;
          return allow(C > 0 && num(a.spent) && a.spent === (b.spent || 0) - C && a.spent >= 0 && !!v && v.stamp === true && v.owner === id && staffOf(v.storeId) && !ctx.getAfter('derbyVotes/' + a.refund), 'stamps refund');
        }
        return deny('stamps update');
      }
      case 'derbyPayouts': {
        if (R) return allow((signed && !!before && before.owner === ctx.auth.uid && now >= ms(before.revealAtTs)) || dec() || (!!before && (before.revealed === true || now >= ms(before.revealAtTs)) && staffOf(before.storeId)), 'payout read');
        if (op !== 'update') return allow(dec());
        const claimable = () => now >= ms(before.revealAtTs) && now < ms(before.expireAtTs) && before.status === 'unpaid' && !(get('derbyRaces/' + before.raceId) || {}).refunded && only(['status', 'paidAt', 'paidBy', 'paidVia']) && after.status === 'paid' && after.paidBy === (ctx.auth && ctx.auth.uid);
        return allow((signed && before.owner === ctx.auth.uid && claimable() && after.paidVia === 'self') || dec() || (staffOf(before.storeId) && claimable() && after.paidVia === 'staff'), 'claim');
      }
      case 'derbyLogs': if (R) return allow(master || staffOf(before.storeId), 'log read'); if (op === 'create') return allow(dec() || (staffOf(after.storeId) && ['paid', 'release'].includes(after.type)), 'log create'); return allow(master);
      case 'derbyStats': return allow(dec());
    }
    deny('unknown collection');
  }
  return RULES;
};
