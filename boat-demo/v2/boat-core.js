/* casa BOAT の投票の決まりごと（DOM・通信なし。node とブラウザの両方で動く）: window.BoatCore
   決めたこと: ref/boat/投票ルール_2026-11-18.md（末尾の「追加の決定」が最新）・ref/boat/投票画面_下調べ_2026-11-18.md。
   - ボートは 2 連単だけ（6 艇で 30 通り）。1 人 1 レース「無料の券」1 枚（組番は締切まで変えられる）＋ BPT 100 ごとに 1 枚の券を何通りにでも（同じ組番に重ねてもよい。持っている BPT まで上限なし。足した券は消せない）。
   - 当たりは BPT（100 BPT × 2 連単の倍率 を 100 BPT 単位に切り上げ。競馬の pt と同じ計算＝v2/outcome.js の payFor）。BPT は競馬の追加の券にしか使えない。受け取りのスライドは無い（発表で自動で増える）。
   - 当たりの決め方は競馬と同じ隠れた方式（v2/outcome.js の resolveExacta）。1 レースで払う BPT の合計の目安（target）は時刻表の行ごと（初期 1,000 BPT）。
     1 レース上限（capRace 初期 10,000）・1 日上限（capDay 初期 50,000）は管理画面で変えられる。上限は目安より強い（上限を超える組番は選ばない＝当たりなしもある）。
   - 倍率は 2〜40 倍・真ん中が 10 倍になるように、自然な起きやすさの順のまま縮める（oddsOf）。締切後の ±10% のずらしは競馬と同じ。
   - 投票できるのは「その日（営業日）に競馬へ会計番号で参加したスマホ」で、テレビの QR を読んだ人だけ（QR の合言葉はレースで 1 つ）。位置情報は使わない。
   - いつも全店同時。時刻表の時刻 at ＝ 投票の締切＝映像の始まり。投票は at の voteSec 秒前から（初期 3 分）。締めてから映像（ピット離れ 100 秒＋走り 約 72 秒＋ゴール後 8 秒）、
     そのあと結果画面 resultSec（初期 2 分）。
   - 競馬と被る時刻は入れられない（全店共通で判定。conflicts）。競馬の「ふさぐ時間」は投票の始まり〜発表（長い場合）＋結果画面の最初の 2 分（DERBY_GUARD_SEC）。
   - 取り消したレースの BPT は全額戻す（refundPlan）。BPT は毎週月曜の朝 5 時にリセット（v2/core.js の bptWeek・bptBalance。週の番号 wk が変わったら残りは 0）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.BoatCore = factory(root.DerbyCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  const STAKE = 100, N = 6;
  const FILM_PRE = 100, FILM_POST = 8, RUN_EST = 72, RUN_MAX = 90; // 映像の長さ（boat/race-boat.js の PRE_T・POST_T、走り約 72 秒）
  const DERBY_GUARD_SEC = 120, DERBY_RUN_MAX = 70, DERBY_SCRATCH_SEC = 14; // 競馬の結果画面の最初の 2 分は守る（2026-11-18）。競馬の走り 1000m 約 57 秒（長めに 70 秒で見る）・競走除外の延長 14 秒
  const COUNT_SEC = 15; // テレビが参加人数を読み直す間隔（2026-11-18 オーナー「ボートでは 15 秒ごと」）
  const DEF = { target: 1000, capRace: 10000, capDay: 50000, voteSec: 180, resultSec: 120, leadSec: 6, bandBelow: 0.2, bandAbove: 0.2, shiftUp: 0.1, shiftDown: 0.1, oddsSims: 1000, incidentOn: 1, refundFall: 1 }; // incidentOn: フライング・転覆を出す（1）。refundFall: 転覆の艇の券も返還（2026-11-19 オーナー決定で 1＝返還する。本物は返還なし）
  const ODDS_LO = 2, ODDS_MID = 10, ODDS_HI = 40;
  const ALL = []; for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (a !== b) ALL.push(a + '-' + b);
  const err = Core.err;
  const isInt = (v) => Number.isInteger(v);
  const r100 = (v) => Math.max(0, Math.round((Number(v) || 0) / STAKE) * STAKE);

  /* ---------- 設定（derbyConfig/boat・模擬クラウドの db.boat） ---------- */
  function configOf(s) {
    s = s && typeof s === 'object' ? s : {};
    const o = Object.assign({}, DEF);
    Object.keys(DEF).forEach((k) => { const v = Number(s[k]); if (s[k] != null && s[k] !== '' && Number.isFinite(v)) o[k] = v; });
    o.rules = Array.isArray(s.rules) ? s.rules : [];
    return o;
  }
  /* 管理画面の保存: b = { rules?, target?, capRace?, capDay?, voteSec?, resultSec? }。ボートはいつも全店同時なので、行の店の指定は消す */
  function mergeConfig(cur, b, storeIds, dayStartHour) {
    const c = configOf(cur); b = b || {};
    const num = (k, lo, hi, int) => { if (b[k] == null || b[k] === '') return; const v = Number(b[k]); if (!Number.isFinite(v) || v < lo || v > hi || (int && !isInt(v))) throw err(400, 'bad_boat', k + ' は ' + lo + '〜' + hi + ' です'); c[k] = int ? v : v; };
    num('target', 0, 1e7, true); num('capRace', 0, 1e8, true); num('capDay', 0, 1e9, true); num('voteSec', 60, 600, true); num('resultSec', 30, 900, true);
    ['target', 'capRace', 'capDay'].forEach((k) => { c[k] = r100(c[k]); });
    ['incidentOn', 'refundFall'].forEach((k) => { if (b[k] != null) c[k] = b[k] === true || Number(b[k]) > 0 ? 1 : 0; }); // フライング・転覆（2026-11-19）
    if (b.rules !== undefined) c.rules = normalizeRules(b.rules, storeIds, dayStartHour);
    return c;
  }
  function normalizeRules(input, storeIds, dayStartHour) {
    const list = (Array.isArray(input) ? input : []).map((r) => Object.assign({}, r, { storeId: null, storeIds: null, scope: 'all', big: false }));
    return Core.normalizeRules(list, storeIds, null, dayStartHour).map((r) => { const o = Object.assign({}, r); delete o.big; return o; });
  }
  const publicRules = (rules) => Core.publicRules(rules || []);

  /* ---------- 時刻表 → レース ---------- */
  const idOf = (e) => 'b' + e.id; // 競馬の id（20261119-2130）と分ける
  function schedule(t, rules) { return Core.scheduleAround(t, rules || []).map((e) => Object.assign({}, e, { id: idOf(e), storeId: null, storeIds: null, scope: 'all' })); }
  // 時刻（at ＝ 締切＝映像の始まり）から各時刻。winSec: 走りの長さ（決めたあとに分かる。前は RUN_EST）
  function timesOf(at, cfg, winSec) {
    const c = configOf(cfg), openAt = at - c.voteSec * 1000, closeAt = at, runAt = at + c.leadSec * 1000;
    const revealAt = runAt + Math.round((FILM_PRE + (winSec > 0 ? winSec : RUN_EST) + FILM_POST) * 1000);
    return { at, openAt, closeAt, runAt, revealAt, endAt: revealAt + c.resultSec * 1000, voteSec: c.voteSec, leadSec: c.leadSec, resultSec: c.resultSec };
  }
  // テレビの画面をふさぐ時間（判定用。長い場合で見る）
  function boatSpan(at, cfg) { const c = configOf(cfg); return [at - c.voteSec * 1000, at + (c.leadSec + FILM_PRE + RUN_MAX + FILM_POST + c.resultSec) * 1000]; }
  function derbySpan(at, tuning) {
    const T = Core.tuningOf(tuning), gate = T.scenes && T.scenes.gate === false ? 0 : T.gateSec, close = at - T.closeLeadSec * 1000;
    const reveal = at + (gate + DERBY_SCRATCH_SEC + DERBY_RUN_MAX + T.postSec + 2 * T.photoExtraSec) * 1000;
    return [close - T.voteSec * 1000, reveal + DERBY_GUARD_SEC * 1000];
  }
  const DAY = 86400000;
  const fmt = (ms, h) => Core.fmtBizTime(ms, h);
  /* 競馬と被る時刻（全店共通で判定）・ボートどうしが近すぎる時刻: [{ boatId, date, boat, derby?, kind: 'derby'|'boat', text }]
     boatRules / derbyRules: 時刻表の決まり。from: いつから見るか（ms）。days: 何日分（初期 14 日。日付の決まりはその日も）。h: 朝の区切り（25 時表記） */
  function conflicts(boatRules, derbyRules, tuning, cfg, from, days) {
    const T = Core.tuningOf(tuning), h = T.dayStartHour, out = [], seen = {};
    const allDerby = (derbyRules || []).map((r) => Object.assign({}, r, { storeId: null })); // 全店共通: 店だけのレースも同じ 1 本の線に並べる
    const dates = {}; const d0 = Core.bizDate(from, h); const n = Math.max(1, Math.min(60, Number(days) || 14));
    for (let k = 0; k < n; k++) dates[shift(d0, k)] = 1;
    (boatRules || []).forEach((r) => { if (r && r.kind === 'date' && r.date && r.date >= d0) dates[r.date] = 1; });
    Object.keys(dates).sort().forEach((ds) => {
      const bs = Core.expandDate(ds, boatRules || []).filter((e) => e.at >= from);
      if (!bs.length) return;
      const ds0 = shift(ds, -1), ds1 = shift(ds, 1);
      const dv = [].concat(Core.expandDate(ds0, allDerby), Core.expandDate(ds, allDerby), Core.expandDate(ds1, allDerby));
      const uniq = {}; dv.forEach((e) => { uniq[e.at] = e; }); const ders = Object.values(uniq);
      bs.forEach((b, i) => {
        const sb = boatSpan(b.at, cfg), key = 'b' + b.id;
        for (const d of ders) {
          const sd = derbySpan(d.at, T);
          if (sb[0] < sd[1] && sd[0] < sb[1]) {
            if (seen[key]) break; seen[key] = 1;
            out.push({ boatId: idOf(b), date: ds, kind: 'derby', boat: fmt(b.at, h), derby: fmt(d.at, h), boatAt: b.at, derbyAt: d.at,
              text: ds + ' ' + fmt(b.at, h) + ' のボートは ' + fmt(d.at, h) + ' の競馬（全店）と重なります（競馬の投票 ' + fmt(sd[0], h) + '〜結果画面の最初の 2 分 ' + fmt(sd[1], h) + ' ごろまで）' });
            break;
          }
        }
        const nx = bs[i + 1];
        if (nx && !seen[key] && boatSpan(nx.at, cfg)[0] < sb[1]) { seen[key] = 1; out.push({ boatId: idOf(b), date: ds, kind: 'boat', boat: fmt(b.at, h), boatAt: b.at, text: ds + ' ' + fmt(b.at, h) + ' と ' + fmt(nx.at, h) + ' のボートが近すぎます（1 レースに約 ' + Math.ceil((sb[1] - sb[0]) / 60000) + ' 分かかります）' }); }
      });
    });
    return out;
  }
  function shift(ds, k) { const p = ds.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + k)).toISOString().slice(0, 10); }
  // 作る直前の確かめ（進行役）: そのボートが、作ってある・作る予定の競馬と被るか（被ったら作らない＝競馬が勝つ）
  function busyWithDerby(at, derbyAts, tuning, cfg) { const sb = boatSpan(at, cfg); return (derbyAts || []).some((d) => { const sd = derbySpan(d, tuning); return sb[0] < sd[1] && sd[0] < sb[1]; }); }

  /* ---------- 倍率: 2〜40 倍・真ん中 10 倍（自然な起きやすさの順のまま。対数の上で 低い端 → 2・真ん中 → 10・高い端 → 40 へまっすぐ） ---------- */
  function oddsOf(exactaProb) {
    const ks = ALL.filter((k) => exactaProb && exactaProb[k] > 0), L = {}, out = {};
    ks.forEach((k) => { L[k] = Math.log(0.85 / exactaProb[k]); });
    const s = ks.map((k) => L[k]).sort((a, b) => a - b);
    if (!s.length) { ALL.forEach((k) => { out[k] = ODDS_MID; }); return out; }
    const lo = s[0], hi = s[s.length - 1], mid = s.length >= 2 ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : s[0];
    const r1 = (x) => Math.round(x * 10) / 10;
    ALL.forEach((k) => {
      if (L[k] == null) { out[k] = ODDS_HI; return; }
      let v;
      if (L[k] <= mid) v = mid - lo > 1e-9 ? ODDS_LO * Math.pow(ODDS_MID / ODDS_LO, (L[k] - lo) / (mid - lo)) : ODDS_MID;
      else v = hi - mid > 1e-9 ? ODDS_MID * Math.pow(ODDS_HI / ODDS_MID, (L[k] - mid) / (hi - mid)) : ODDS_MID;
      out[k] = Math.min(ODDS_HI, Math.max(ODDS_LO, r1(v)));
    });
    return out;
  }

  /* ---------- レースを作る ----------
     entry: { id, at, payout（その行の目安。0 ＝ 設定の target）, test? }。opt: { odds?（{ exactaProb } を先に計算したもの）, sims? }
     返り値 { race（公開してよい: スマホ・テレビ）, secret（目安・起きやすさ: 決める係だけ） }。race.model は艇の走りを再現するレース（テレビが映像に使う） */
  function modelOf(Engine, Outcome, BoatModel, salt, id) {
    const m = BoatModel.makeRace(Engine.rng(Outcome.hash(salt, id, 'boat')));
    m.tune = { payoutRate: 0.85 };
    return m;
  }
  function buildRace(Engine, Outcome, BoatModel, entry, cfg, salt, t, opt) {
    opt = opt || {}; const c = configOf(cfg);
    const model = modelOf(Engine, Outcome, BoatModel, salt, entry.id);
    const prob = opt.odds && opt.odds.exactaProb ? opt.odds.exactaProb : Engine.calcOdds(model, Engine.rng(Outcome.hash(salt, entry.id, 'odds')), opt.sims || c.oddsSims).exactaProb;
    const tm = timesOf(entry.at, c, null), dsh = opt.dayStartHour == null ? 5 : opt.dayStartHour;
    const race = Object.assign({ id: entry.id, kind: 'boat' }, tm, { status: 'upcoming', day: Core.bizDate(entry.at, dsh), createdAt: t, model, exacta: oddsOf(prob), participants: { total: 0, tickets: 0, combos: {} } });
    if (entry.test) race.test = true;
    const secret = { target: entry.payout > 0 ? r100(entry.payout) : c.target, comboProb: prob };
    return { race, secret };
  }
  // スマホ・テレビの一覧に出す艇（出走表）
  function boatsOf(race) {
    const hs = (race && race.model && race.model.horses) || [];
    return hs.map((h, i) => ({ no: i + 1, name: h.name, cls: h.cls, color: h.color, ink: h.ink, type: h.type, st: h.st, cond: h.cond ? h.cond.mark : '', past: h.past || [] }));
  }
  // 公開の「いまの状態」に入れる軽い形（艇の走りの再現 model は入れない。テレビはレースの書類を 1 回読む）
  const LITE_KEYS = ['id', 'kind', 'at', 'openAt', 'closeAt', 'runAt', 'revealAt', 'endAt', 'voteSec', 'resultSec', 'status', 'day', 'test', 'exacta', 'refunded'];
  function lite(r) {
    if (!r) return null; const o = {};
    LITE_KEYS.forEach((k) => { if (r[k] !== undefined) o[k] = r[k]; });
    o.boats = r.boats || boatsOf(r);
    if (r.status === 'done') { o.result = r.result || null; o.winners = (r.winners || []).slice(0, 60); o.paid = r.paid || 0; o.people = r.people || 0; }
    return o;
  }
  /* 「いまの状態」の 1 件（boatLive/all）: いま映す・投票するレースと、次のレース。races は作ってあるボートのレース */
  function liveOf(races, t) {
    const L = (races || []).filter((r) => r && r.kind === 'boat').sort((a, b) => a.at - b.at);
    const cur = L.find((r) => t >= r.openAt - 60000 && t < (r.endAt || 0)) || null; // 取り消したレース（void）も endAt まで出す（「取り消し・BPT は戻しました」）
    const next = L.find((r) => r.status === 'upcoming' && r.openAt > t && (!cur || r.id !== cur.id)) || null;
    return { race: lite(cur), next: next ? { id: next.id, at: next.at, openAt: next.openAt } : null };
  }
  // いまの場面: wait（投票の前）| vote | closed（締切〜映像の前）| film | result | over
  function stageOf(r, t) {
    if (!r) return 'none';
    if (r.status === 'void' || r.refunded) return t < (r.endAt || 0) ? 'void' : 'over';
    if (t < r.openAt) return 'wait';
    if (t < r.closeAt && r.status === 'upcoming') return 'vote';
    if (t < r.runAt || r.status === 'upcoming' || r.status === 'closed') return 'closed';
    if (t < r.revealAt) return 'film';
    if (t < r.endAt) return 'result';
    return 'over';
  }
  const votingOpen = (r, t) => !!r && r.status === 'upcoming' && t >= r.openAt && t < r.closeAt;

  /* ---------- 票 ----------
     boatVotes/<レース id>~<持ち主>: { raceId, owner, storeId, nick, first, second（無料の券）, bets: { 'a-b': 枚数 }（BPT の券。足すだけ・枚数の上限なし＝持っている BPT まで。2026-11-19 オーナー決定）,
       code（QR の合言葉）, dv（その日の競馬の票の id）, votedAt, updatedAt }
     bets を「組番ごとの枚数」にしたのは、何百枚になっても書類の形が 30 項目までで変わらず、置き場の決まりで 1 回の書き込みに何枚足しても確かめられるため（一覧の形だと決まりの中で数えきれない） */
  const voteId = (raceId, owner) => raceId + '~' + owner;
  const comboKey = (a, b) => a + '-' + b;
  function cleanPair(b) {
    const f = Number(b && b.first), s = Number(b && b.second);
    if (!isInt(f) || !isInt(s) || f < 0 || s < 0 || f >= N || s >= N || f === s) throw err(400, 'bad_pick', '1着と2着をえらんでください');
    return { first: f, second: s };
  }
  // 足す券（['a-b', ...]。同じ組番が何回あってもよい）
  function cleanPicks(v) {
    if (v == null) return [];
    if (!Array.isArray(v)) throw err(400, 'bad_pick', '券の形がちがいます');
    v.forEach((k) => { if (ALL.indexOf(String(k)) < 0) throw err(400, 'bad_pick', '組番がちがいます'); });
    return v.map(String);
  }
  // 票の BPT の券 { 'a-b': 枚数 }（前の形 picks: [...] も読める）
  function betsOf(v) {
    const o = {};
    if (v && v.bets && typeof v.bets === 'object') Object.keys(v.bets).forEach((k) => { const n = Math.floor(Number(v.bets[k]) || 0); if (ALL.indexOf(k) >= 0 && n > 0) o[k] = n; });
    else if (v && Array.isArray(v.picks)) v.picks.forEach((k) => { if (ALL.indexOf(String(k)) >= 0) o[k] = (o[k] || 0) + 1; });
    return o;
  }
  const betCount = (m) => Object.keys(m || {}).reduce((a, k) => a + (Number(m[k]) || 0), 0);
  function addBets(m, list) { const o = Object.assign({}, m || {}); (list || []).forEach((k) => { o[k] = (o[k] || 0) + 1; }); return o; }
  // 1 人の券（無料の 1 枚＋BPT の券）を 1 枚ずつに
  function ticketsOf(votes) {
    const out = [];
    (votes || []).forEach((v) => {
      if (!v) return;
      if (isInt(v.first) && isInt(v.second)) out.push({ owner: v.owner, nick: v.nick, storeId: v.storeId, first: v.first, second: v.second, free: true });
      const m = betsOf(v); Object.keys(m).forEach((k) => { const p = k.split('-').map(Number); for (let i = 0; i < m[k]; i++) out.push({ owner: v.owner, nick: v.nick, storeId: v.storeId, first: p[0], second: p[1], bpt: true }); });
    });
    return out;
  }
  function countVotes(votes) {
    const o = { total: 0, tickets: 0, bpt: 0, byStore: {}, combos: {} };
    (votes || []).forEach((v) => {
      if (!v) return; o.total++; o.byStore[v.storeId] = (o.byStore[v.storeId] || 0) + 1;
      if (isInt(v.first) && isInt(v.second)) { const k = comboKey(v.first, v.second); o.combos[k] = (o.combos[k] || 0) + 1; o.tickets++; }
      const m = betsOf(v); Object.keys(m).forEach((k) => { o.combos[k] = (o.combos[k] || 0) + m[k]; o.tickets += m[k]; o.bpt += m[k]; });
    });
    return o;
  }
  // 返還（フライング＝本物どおり。転覆は設定 refundFall のときだけ）: その艇を含む組番の券。boat は艇の添字
  const hasBoat = (k, boat) => k.split('-').map(Number).indexOf(boat) >= 0;
  function refundOf(v, inc) { // { n: 返還の BPT の券の枚数, bpt: 戻す BPT, free: 無料の券が返還か }
    if (!inc || !inc.refund || !v) return { n: 0, bpt: 0, free: false };
    const m = betsOf(v); let n = 0; Object.keys(m).forEach((k) => { if (hasBoat(k, inc.boat)) n += m[k]; });
    return { n, bpt: n * STAKE, free: isInt(v.first) && (v.first === inc.boat || v.second === inc.boat) };
  }
  // スマホに見せる自分の票
  function voteView(v, race) {
    if (!v) return null;
    const bets = betsOf(v);
    const o = { id: v.id || voteId(v.raceId, v.owner), raceId: v.raceId, storeId: v.storeId, nick: v.nick, first: v.first, second: v.second, bets, n: betCount(bets), votedAt: v.votedAt || 0 };
    if (race && race.status === 'done' && race.result) {
      const k = race.result.combo, pay = race.result.pay || 0, n = ticketsOf([v]).filter((x) => comboKey(x.first, x.second) === k).length;
      o.hit = n; o.won = n * pay;
      const rf = refundOf(v, race.result.incident); if (rf.n || rf.free) o.back = rf;
    }
    if (race && race.refunded) o.refunded = true;
    return o;
  }

  /* ---------- 結果を決める（締切のあと。決める係＝進行役のテレビ・模擬クラウド） ----------
     usedToday: その営業日にもう払った BPT（1 日上限の残りを出す）。返り値 { result（公開・発表で出す）, hidden（seed など。テレビの映像用）, decision（記録）, winners（1 人 1 行）, refunds（返還）, paid }
     フライング・転覆（2026-11-19 オーナー決定「投票のあるボートでも出す」）: 起きる率は本物（js/boat-model.js の INCIDENT・風と波で変わる rollIncident）。
       起きる艇は当たりの 1 着・2 着の艇にはしない（先に当たりの組番を決め、そのあとで残りの 4 艇から本物のコースの重みで選ぶ。競馬の脱落と同じ順）。
       フライングの艇を含む券は返還（ref/boat/research/27_返還のルール.md: 公式「その艇に関する舟券は全額返還」）。BPT の券は BPT を戻し、無料の券は「返還」（戻すものなし）。
       スタートのあとの転覆は本物では返還なし（同じ資料）だが、2026-11-19 オーナー決定で初期は返還する（refundFall 1）。管理画面で 0 にすると本物どおり。
       返還の券は当たりにならない（その艇は 1・2 着にならない）ので、払う BPT（目安・上限・1 日上限）には入らない。戻した BPT は paid に入れず refunded に分けて数える */
  const BM = () => (typeof self !== 'undefined' && self.BoatModel) || (typeof globalThis !== 'undefined' && globalThis.BoatModel) || (typeof module === 'object' && module.exports && typeof require === 'function' ? require('../js/boat-model.js') : null);
  function pickIncident(Engine, Outcome, model, salt, id, c, first, second) {
    if (!(c.incidentOn > 0)) return null;
    const B = BM(); if (!B || !B.rollIncident) return null;
    const r = Engine.rng(Outcome.hash(salt, id, 'boatinc')), x = B.rollIncident(model, r); if (!x) return null;
    const n = model.horses.length, ok = (h) => h !== first && h !== second;
    let h = x.horse;
    if (!ok(h)) { const entry = Array.isArray(model.entry) && model.entry.length === n ? model.entry : model.horses.map((_, i) => i), w0 = x.type === 'scratch' ? B.INCIDENT.fCourse : B.INCIDENT.xCourse, L = []; let s = 0; entry.forEach((b, c2) => { if (ok(b)) { L.push([b, w0[c2] || 1]); s += w0[c2] || 1; } }); let y = r() * s; h = L[L.length - 1][0]; for (const [b, w] of L) { y -= w; if (y < 0) { h = b; break; } } }
    return { type: x.type, horse: h, at: x.at };
  }
  function decide(Engine, Outcome, race, secret, votes, cfg, salt, t, usedToday) {
    const c = configOf(cfg), tickets = ticketsOf(votes);
    const caps = [];
    if (c.capRace > 0) caps.push(c.capRace);
    if (c.capDay > 0) caps.push(Math.max(0, c.capDay - Math.max(0, Number(usedToday) || 0)));
    let cap = caps.length ? Math.min.apply(null, caps) : 0; if (caps.length && cap <= 0) cap = 1; // 1 日の上限を使い切った ＝ どの当たりも超える（0 は「上限なし」の意味なので 1 にする）
    const seed = Outcome.hash(salt, race.id, 'boatseed');
    const input = { exacta: race.exacta, comboProb: secret && secret.comboProb, n: N, votes: tickets.map((x) => ({ first: x.first, second: x.second })), target: race.test ? 0 : (secret && secret.target) || c.target, scope: 'all',
      bandBelow: c.bandBelow, bandAbove: c.bandAbove, cap, seed, up: c.shiftUp, down: c.shiftDown, spread: 0 };
    const mr = Object.assign({}, race.model, { exacta: race.exacta });
    const ch = Outcome.chooseCombo(input), baseSeed = Outcome.hash('race', seed >>> 0);
    let first = ch.first, second = ch.second;
    if (first == null) { const fs0 = Outcome.findSeedPair(Engine, mr, null, null, baseSeed, 1); first = fs0.order[0]; second = fs0.order[1]; } // 票なし: 自然の 1・2 着
    const inc = pickIncident(Engine, Outcome, mr, salt, race.id, c, first, second);
    if (inc) mr.incident = inc;
    const fs = Outcome.findSeedPair(Engine, mr, first, second, baseSeed, 200);
    const combo = comboKey(first, second), comboOdds = ch.combo == null ? Math.min(Outcome.MAX_T, Math.max(Outcome.MIN_T, Outcome.toT(race.exacta[combo]) || Outcome.MAX_T)) / 10 : ch.comboOdds;
    const finalExacta = Outcome.shapeExacta(race.exacta, combo, comboOdds, Outcome.shiftOf(input), seed);
    const odds = finalExacta[combo], pay = Outcome.payFor(odds);
    const run = Engine.replayRun(mr, fs.seed, { order: fs.order }), winSec = Math.round(run.winTime * 1000) / 1000;
    const incPub = inc ? { type: inc.type, boat: inc.horse, refund: inc.type === 'scratch' || c.refundFall > 0 } : null;
    const by = {}, refunds = {}; let refunded = 0, refundTickets = 0;
    tickets.forEach((x) => { if (comboKey(x.first, x.second) !== combo) return; const w = (by[x.owner] = by[x.owner] || { owner: x.owner, nick: x.nick, storeId: x.storeId, n: 0, amount: 0 }); w.n++; w.amount += pay; });
    if (incPub && incPub.refund && !race.test) (votes || []).forEach((v) => { const rf = refundOf(v, incPub); if (rf.bpt > 0 && v.owner) { refunds[v.owner] = (refunds[v.owner] || 0) + rf.bpt; refunded += rf.bpt; refundTickets += rf.n; } });
    const winners = Object.values(by).sort((a, b) => b.amount - a.amount || String(a.nick).localeCompare(String(b.nick)));
    const paid = race.test ? 0 : winners.reduce((a, w) => a + w.amount, 0);
    const late = Math.max(0, t + 3000 - race.runAt); // 決めるのが遅れたら映像を後ろへ（最大 60 秒）
    const runAt = race.runAt + Math.min(60000, late), tm = timesOf(race.at, c, winSec);
    const revealAt = runAt + (tm.revealAt - tm.runAt), endAt = revealAt + c.resultSec * 1000;
    const result = { first, second, combo, odds, pay, order: fs.order, finalExacta };
    if (incPub) result.incident = incPub;
    return {
      runAt, revealAt, endAt, result,
      hidden: Object.assign({ seed: fs.seed, order: fs.order, winSec, natural: fs.natural, runAt, revealAt }, inc ? { incident: inc } : {}),
      decision: { reason: ch.reason, target: input.target, cap, paid, refunded, refundTickets, tickets: tickets.length, bpt: tickets.filter((x) => x.bpt).length, people: (votes || []).length, at: t },
      winners, refunds, refunded, paid,
    };
  }
  // 取り消したレースで戻す BPT: { 持ち主: BPT }（足した券の枚数 × 100。無料の券は戻すものが無い）
  function refundPlan(votes) { const o = {}; (votes || []).forEach((v) => { const n = betCount(betsOf(v)); if (n > 0 && v.owner && !v.back) o[v.owner] = (o[v.owner] || 0) + n * STAKE; }); return o; }
  /* BPT を増やす（当たり）・戻す（返還・取り消し）: 週が変わっていたら 0 から（毎週月曜朝 5 時のリセット）。back: 戻す額（spent を減らす。先週のぶんは戻さない） */
  function creditDoc(cur, amount, t, back) {
    const wk = Core.bptWeek(t), same = !!cur && (cur.wk == null || Number(cur.wk) === wk), e = same ? Number(cur.earned) || 0 : 0, s = same ? Number(cur.spent) || 0 : 0;
    if (back === true) { if (!same) return null; return { earned: e, spent: Math.max(0, s - amount), wk }; }
    const bk = Number(back) > 0 && same ? Number(back) : 0; // 当たりと返還を 1 回で（発表のとき）
    return { earned: e + amount, spent: Math.max(0, s - bk), wk };
  }
  // いま BPT の券を足せる枚数（上限なし＝持っている BPT まで）
  function picksLeft(v, race, bal, t) {
    if (!race || race.test || !votingOpen(race, t)) return 0;
    return Math.max(0, Math.floor((Number(bal) || 0) / STAKE));
  }
  // 競馬の票の id からその日（営業日）: 時刻表のレースの id は YYYYMMDD-HHMM…（テスト・手動のレースは見ない）
  function derbyVoteDay(vid) { const p = Core.parseVoteId(vid); return p ? p.raceId : null; }
  // 合言葉（QR）: 8 文字。rand は 0〜1 を返す関数（ブラウザ・node の暗号の乱数から作ったもの）
  function newCode(rand) { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 8; i++) s += a[Math.floor(rand() * a.length)]; return s; }
  const CODE_RE = /^[A-Za-z0-9]{8}$/;
  // QR の住所: <サイト>/v2/boat.html?s=<店>#<レース id>.<合言葉>（合言葉は # の後ろ＝サーバーに送られない）
  function joinURL(base, store, raceId, code) { return base + (base.indexOf('?') >= 0 ? '&' : '?') + 's=' + encodeURIComponent(store) + '#' + raceId + '.' + code; }
  function parseHash(h) { const m = /^#?(b[0-9A-Za-z_-]{3,40})\.([A-Za-z0-9]{8})$/.exec(String(h || '')); return m ? { raceId: m[1], code: m[2] } : null; }

  return { STAKE, N, ALL, DEF, FILM_PRE, FILM_POST, RUN_EST, RUN_MAX, DERBY_GUARD_SEC, COUNT_SEC, ODDS_LO, ODDS_MID, ODDS_HI, CODE_RE,
    configOf, mergeConfig, normalizeRules, publicRules, schedule, timesOf, boatSpan, derbySpan, conflicts, busyWithDerby, oddsOf, modelOf, buildRace, boatsOf, lite, liveOf, stageOf, votingOpen,
    voteId, comboKey, cleanPair, cleanPicks, betsOf, betCount, addBets, refundOf, hasBoat, ticketsOf, countVotes, voteView, decide, refundPlan, creditDoc, picksLeft, derbyVoteDay, newCode, joinURL, parseHash };
});
