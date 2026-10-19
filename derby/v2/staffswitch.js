/* casa DERBY スタッフのスマホ（v2/staff.html）: 店のテレビのゲーム（casa SLOT / casa DERBY）の切り替えと、スマホの画面の入れ替え（2026-10-19）
   - 上の帯（店舗の行の下）の「テレビ: casa ○○ 切り替え」→ 今のゲームと「casa SLOT」「casa DERBY」。書く値は管理画面・casa SLOT のマスター画面と同じ
     （derbyStores/<店舗ID>.settings.tvGame と derbySwitch/tv.<店舗ID> を 1 回で。DerbyCloud の tvGame(pin, game)。ルールはその店のスタッフの自分の店だけ）。
     ログインはこの画面の PIN（staff.js が覚えているもの）。
   - スマホの画面も自動で入れ替える（casa SLOT の下に置いた公開版だけ。tools/build-derby-deploy.js が window.DERBY_SLOT_BILL を書き足す）:
     店のゲームが casa SLOT になったら casa SLOT の紙幣のページ（bill.html）へ。対象は、このスマホで紙幣のページにもログインしてある
     （localStorage 'casa-slot-bill.v1' の店が、この店と同じ）スタッフのスマホだけ。お客さんのスマホ（bet.html）は対象外。
     途中では移らない: 確認の画面（認証・受け取りのシート）・番号の手入力・ログインの入力中・このシートを開いている間・6 秒さわっていないとき以外。
     行ったり来たり: 10 分に 6 回を超えたら 10 分止める（js/phoneswitch.js と同じ記録。テレビと同じ回数）。「このスマホは自動で入れ替えない」も同じ設定（'casa.phoneSwitch'）。
   - 変更の通知は v2/tvswitch.js の DerbyTvSwitch.watch（数秒）。通知が使えないときは 30 秒ごとに読む。Web デモでは何もしない。
   - テレビの画質（2026-10-19）: 同じシートに「なめらか優先・標準・きれい優先」（店舗の設定 settings.tvQuality = 'auto' | '' | 'max'）。
     今の値は staff.js のいつもの状態（STAFF.st.settings.tvQuality）で見る（読み取りなし）。書くのは DerbyCloud の tvQuality(pin, q)（ルールは自分の店の tvQuality だけ）。
     テレビは 1 分ほどで読み込み直して反映（レース中は終わってから。v2/tvswitch.js）
   - 2026-10-19 その 2（オーナー「スタッフ画面でスロットと競馬を切り替えれるようにしたい」）:
     左上に「スロット ｜ 競馬」のタブ（casa SLOT の js/phoneswitch.js と同じ見た目。今いる方＝競馬が銀）。「スロット」で casa SLOT の紙幣のページへ（自動で戻るときと同じ行き先）。
     casa SLOT の下に置いた公開版だけ（DERBY_SLOT_BILL があるとき）。認証・受け取りの確認の画面や、番号を手で入れている途中なら、画面の中の確認の窓を出してから。
     手で移ったら localStorage 'casa.phoneSwitchManual' = { store, game: 移ったときの店のゲーム, to, at }。店のゲームがそれと同じあいだは自動で入れ替えない
     （紙幣のページと同じ決まり）。店のゲームが変わったら記録を消して今までどおり。手で移った分は行ったり来たりの回数に数えない。
   - 2026-10-19 その 3（オーナー「テストレース開始ボタンがあれば、すぐ始まるように」）: 店のテレビが casa SLOT なら、押すと casa DERBY に切り替えてすぐ走らせる
     （staff.js の testPress → DerbyCloud.testRace の switchTv。終わったあと SLOT には戻さない）。説明の文は STAFF.test.hint
   - 2026-10-19 その 2（オーナー「すぐテストレースを走らせるみたいなボタン」）: シートに「テストレースを今すぐ走らせる」。
     「次へ」の「この店だけテストレース」と同じもの（staff.js の window.STAFF.test。1 分半後＝参加受付 1 分 → 投票 30 秒（2026-10-20 その 5）。押せないときは同じ理由） */
(function () {
  'use strict';
  const T = window.DerbyTvSwitch, S = () => window.STAFF;
  if (!T || !window.STAFF || (window.DERBY_FIREBASE && window.DERBY_FIREBASE.demo)) return;
  const MAP = [[/渋谷/, 'shibuya'], [/上野/, 'ueno'], [/札幌/, 'sapporo']]; // js/tvswitch.js（casa SLOT）と同じ
  const BILL_KEY = 'casa-slot-bill.v1', AUTO_KEY = 'casa.phoneSwitch', LOG_KEY = 'casa.phoneSwitchLog', MAN_KEY = 'casa.phoneSwitchManual';
  const QUIET_MS = 6000, RETRY_MS = 2000, POLL_MS = 30000, LOOP_N = 6, LOOP_MS = 10 * 60000;
  const NAMES = { slot: 'casa SLOT', derby: 'casa DERBY' };
  const QS3 = [['auto', 'なめらか優先', '重いときは自動で少し粗くして、動きをなめらかに'], ['', '標準', 'ふだんはこれ。細かさはそのまま'], ['max', 'きれい優先', '影までくっきり。動きがカクカクすることがあります']];
  const QN = { auto: 'なめらか優先', '': '標準', max: 'きれい優先' };
  const qNorm = (v) => (v === 'auto' || v === 'max' ? v : '');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* noop */ } };
  const qs = new URLSearchParams(location.search);
  const state = { id: null, game: null, at: 0, busy: false, msg: '', open: false, waiting: false, leaving: false, why: '', q: undefined, qAt: 0, qmsg: '', qPainted: undefined };
  /* 今のテレビの画質: いつもの状態（読み取りなし）。押した直後の 15 秒は書いた値（状態が届くまで） */
  function qNow() { const st = S().st, v = st && st.settings && typeof st.settings.tvQuality === 'string' ? qNorm(st.settings.tvQuality) : undefined; return state.q !== undefined && (v === undefined || Date.now() - state.qAt < 15000) ? state.q : v; }
  const auto = () => lsGet(AUTO_KEY) !== 'off';
  const home = () => window.DERBY_SLOT_BILL || '';
  const storeId = () => { const s = S().saved; return (s && s.store) || qs.get('store') || null; };
  function billFits(id) { // このスマホは casa SLOT の紙幣のページにも、同じ店でログインしてある
    let b = null; try { b = JSON.parse(lsGet(BILL_KEY)); } catch (e) { b = null; }
    if (!b || !b.storeId) return false;
    const o = lsGet('casa.derbyStore'); if (o) return o === id;
    const hit = MAP.find(([re]) => re.test(b.name || ''));
    return !!hit && hit[1] === id;
  }

  /* ---------- 画面 ---------- */
  const css = document.createElement('style');
  css.textContent = '#tvgBtn{display:inline-flex;align-items:center;gap:6px;margin:6px 0 2px;padding:5px 14px;border-radius:999px;border:1px solid #2a3a2c;background:#101612;color:#cfd6cc;font:12px/1.3 -apple-system,"Hiragino Sans",sans-serif}' +
    '#tvgBtn b{font-size:13px;color:#9fe07a}#tvgBtn.slot b{color:#ffe9a8}#tvgBtn i{font-style:normal;color:#9aa89c}#tvgBtn[hidden]{display:none}' +
    '#tvgSheet{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.78);display:flex;align-items:flex-end;justify-content:center}' +
    '#tvgSheet .card{width:100%;max-width:480px;max-height:92vh;overflow-y:auto;box-sizing:border-box;background:#101612;border:1px solid #5fb53a;border-bottom:0;border-radius:18px 18px 0 0;padding:18px 18px calc(env(safe-area-inset-bottom,0px) + 18px);color:#e8e3d2;font-family:-apple-system,"Hiragino Sans",sans-serif}' +
    '#tvgSheet h3{margin:0 0 4px;font-size:16px;color:#9fe07a}#tvgSheet p{margin:6px 0;font-size:13px;color:#9aa89c;line-height:1.6}#tvgSheet .now{font-size:15px;color:#e8e3d2}#tvgSheet .now b{color:#d8f5c4}' +
    '#tvgSheet .two{display:flex;gap:10px;margin:12px 0}#tvgSheet .two button{flex:1;padding:16px 6px;border-radius:14px;border:1px solid #5fb53a;background:#0b0f0c;color:#d8f5c4;font:700 17px/1.2 inherit}' +
    '#tvgSheet .two button.cur{background:linear-gradient(180deg,#b9ec8f,#5fb53a);color:#0b1a06}#tvgSheet .two button.cur small{display:block;font-size:11px;font-weight:400}#tvgSheet .two button:disabled:not(.cur){opacity:.45}' +
    '#tvgSheet .tq{margin-top:12px;padding-top:12px;border-top:1px solid #1d2a1f}#tvgSheet .tq h4{margin:0;font-size:15px;color:#9fe07a}#tvgSheet .tq h4 small{font-weight:400;font-size:12px;color:#9aa89c;margin-left:6px}' +
    '#tvgSheet .three{display:flex;flex-direction:column;gap:8px;margin:10px 0 4px}#tvgSheet .three button{display:block;width:100%;text-align:left;padding:10px 14px;border-radius:12px;border:1px solid #2f5a2a;background:#0b0f0c;color:#d8f5c4;font:inherit}' +
    '#tvgSheet .three button b{display:block;font-size:15px}#tvgSheet .three button small{display:block;font-size:12px;color:#9aa89c;margin-top:2px;line-height:1.45}#tvgSheet .three button i{float:right;font-style:normal;font-size:11px;margin-top:2px}' +
    '#tvgSheet .three button.cur{background:linear-gradient(180deg,#b9ec8f,#5fb53a);border-color:#5fb53a;color:#0b1a06}#tvgSheet .three button.cur small{color:#16300c}#tvgSheet .three button:disabled:not(.cur){opacity:.45}' +
    '#tvgSheet .err{color:#ff8c7a;font-size:14px;min-height:18px;margin:6px 0}#tvgSheet .okm{color:#35e07a;font-size:14px;margin:6px 0}' +
    '#tvgSheet .auto{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid #1d2a1f;font-size:13px;color:#cfd6cc}' +
    '#tvgSheet .auto button{flex:none;white-space:nowrap}#tvgSheet .auto button,#tvgSheet .close{padding:9px 14px;border-radius:999px;border:1px solid #3a3a3a;background:#1a1a1a;color:#cfd6cc;font:inherit;font-size:13px}#tvgSheet .close{width:100%;margin-top:12px;padding:13px}';
  document.head.appendChild(css);
  const btn = document.createElement('button');
  btn.id = 'tvgBtn'; btn.type = 'button'; btn.hidden = true;
  btn.addEventListener('click', () => { state.open = true; state.msg = ''; state.qmsg = ''; paint(); if (S().test) S().test.watch(true); });
  (document.querySelector('header.top') || document.body).appendChild(btn); // 上の帯の、店舗の行の下（ロゴと重ならない）

  /* ---------- 手で移った記録（2026-10-19 その 2。casa SLOT の js/phoneswitch.js と同じ決まり・同じ場所） ---------- */
  function manualGet() { try { const j = JSON.parse(lsGet(MAN_KEY)); return j && j.store ? j : null; } catch (e) { return null; } }
  function manualHold(id, game) { // true ＝手で移ったあと、店のゲームがまだ同じ（自動で入れ替えない）
    const m = manualGet(); if (!m) return false;
    if (m.store !== id) { lsSet(MAN_KEY, null); return false; } // ほかの店の記録は消す
    if (!game) return true;
    if (m.game == null) { m.game = game; lsSet(MAN_KEY, JSON.stringify(m)); return true; } // 移ったときに店のゲームがまだ分からなかった → 最初に分かった値を「そのときのゲーム」に
    if (m.game === game) return true;
    lsSet(MAN_KEY, null); return false; // 店のゲームが変わった → 今までどおり自動で
  }

  /* ---------- 「スロット ｜ 競馬」のタブ（2026-10-19 その 2。見た目は js/phoneswitch.js と同じ） ---------- */
  const gcss = document.createElement('style');
  gcss.textContent = '#gameTabs{position:fixed;top:calc(var(--sat,0px) + 5px);left:10px;z-index:45;display:flex;gap:2px;padding:2px;border-radius:12px;border:1px solid #3a3a42;background:#101012;font:700 13px/1 -apple-system,"Hiragino Sans",sans-serif}' +
    '#gameTabs[hidden]{display:none}#gameTabs button{height:34px;min-width:46px;padding:0 8px;border:0;border-radius:9px;background:transparent;color:#cfd6cc;font:inherit;letter-spacing:.02em;white-space:nowrap}' +
    '#gameTabs button.cur{background:#d9dce3;color:#1a1d24}@media (max-width:389px){#gameTabs{font-size:12px}#gameTabs button{padding:0 7px;min-width:42px}}' +
    '#gtAsk{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:24px}' +
    '#gtAsk .card{width:100%;max-width:360px;box-sizing:border-box;background:#15120a;border:1px solid #c9a03e;border-radius:16px;padding:18px;color:#e8e3d2;font-family:-apple-system,"Hiragino Sans",sans-serif}' +
    '#gtAsk h3{margin:0 0 8px;font-size:17px;color:#ffd773}#gtAsk p{margin:0 0 16px;font-size:15px;line-height:1.6;color:#cfd6cc}#gtAsk .row{display:flex;gap:10px}' +
    '#gtAsk button{flex:1;min-height:50px;border-radius:12px;font:inherit;font-size:16px}#gtAsk [data-gt="no"]{border:1px solid #3a3a42;background:#1a1a1a;color:#cfd6cc}' +
    '#gtAsk [data-gt="yes"]{border:1px solid #a57c26;background:linear-gradient(#f3d27a,#c99a3a);color:#1a1205;font-weight:800}' +
    '#tvgSheet .tr{margin-top:12px;padding-top:12px;border-top:1px solid #1d2a1f}#tvgSheet .tr h4{margin:0;font-size:15px;color:#9fe07a}#tvgSheet .tr h4 small{font-weight:400;font-size:12px;color:#9aa89c;margin-left:6px}' +
    '#tvgSheet .tr .warn{color:#ffb347;font-size:13px}#tvgSheet .go{display:block;width:100%;margin-top:10px;padding:13px 14px;border-radius:12px;border:1px solid #a57c26;background:linear-gradient(#f3d27a,#c99a3a);color:#1a1205;font:inherit;font-weight:800;font-size:15px}#tvgSheet .go:disabled{opacity:.45}';
  document.head.appendChild(gcss);
  const tabs = document.createElement('div');
  tabs.id = 'gameTabs'; tabs.hidden = true; tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = '<button type="button" role="tab" data-gt="slot" aria-selected="false">スロット</button><button type="button" role="tab" data-gt="derby" class="cur" aria-selected="true">競馬</button>';
  ($('app') || document.body).appendChild(tabs);
  function ask(title, text) { // 画面の中の確認の窓（ブラウザの確認は写真に写らない・見た目をそろえる）
    return new Promise((res) => {
      const old = $('gtAsk'); if (old) old.remove();
      const w = document.createElement('div'); w.id = 'gtAsk';
      w.innerHTML = '<div class="card" role="dialog" aria-modal="true"><h3>' + esc(title) + '</h3><p>' + text + '</p><div class="row"><button type="button" data-gt="no">やめる</button><button type="button" data-gt="yes">移る</button></div></div>';
      w.addEventListener('click', (e) => { const b = e.target.closest('[data-gt]'); if (!b && e.target !== w) return; w.remove(); res(!!b && b.dataset.gt === 'yes'); });
      document.body.appendChild(w);
    });
  }
  function midFlow() { // 認証・受け取りの確認の画面か、番号を手で入れている途中
    if (S().sheetOpen) return true;
    const m = $('mcode'), lg = $('login');
    return !!(m && m.value.trim() && lg && !lg.classList.contains('hidden'));
  }
  tabs.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-gt]'); if (!b || b.dataset.gt !== 'slot') return; // 今いる方（競馬）は何もしない
    const id = storeId(); if (!home() || !id || state.leaving) return;
    if (midFlow() && !(await ask('手続きの途中です', '認証・受け取りの手続きはここで止まります。<br>スロット（casa SLOT の紙幣のページ）へ移りますか？'))) return;
    if (state.leaving) return;
    lsSet(MAN_KEY, JSON.stringify({ store: id, game: state.game || null, to: 'slot', at: Date.now() })); // 手で移った（行ったり来たりの回数には数えない）
    state.leaving = true; state.open = false; paint();
    location.href = home();
  });
  function placeTabs() { // ロゴ（上の帯）がタブと重ならないように、重なる分だけ右へ
    const on = !!home() && !!storeId();
    tabs.hidden = !on;
    const cr = document.querySelector('header.top .crest'); if (!cr) return;
    cr.style.position = 'relative'; cr.style.left = '0px';
    if (!on) return;
    const t = tabs.getBoundingClientRect(), c = (cr.querySelector('img') || cr).getBoundingClientRect();
    const need = Math.ceil(t.right + 10 - c.left);
    if (need > 0 && c.top < t.bottom) cr.style.left = need + 'px';
  }
  window.addEventListener('resize', placeTabs);

  const loggedIn = () => { const s = S().saved; return !!(s && s.store && s.pin && S().C); };
  function paintBtn() {
    placeTabs();
    const on = loggedIn() && $('login').classList.contains('hidden');
    btn.hidden = !on;
    if (!on) return;
    const g = state.game;
    btn.className = g === 'slot' ? 'slot' : '';
    btn.innerHTML = 'テレビ: <b>' + (g ? NAMES[g] : '…') + '</b><i>切り替え・画質 ›</i>';
  }
  function sheetHtml() {
    const g = state.game, s = S().saved;
    const b = (x) => '<button type="button" data-tvg="' + x + '" class="' + (g === x ? 'cur' : '') + '"' + (g === x || state.busy || !g ? ' disabled' : '') + '>' + NAMES[x] + '<span style="display:block;font-size:13px;font-weight:600;margin-top:3px">をテレビで表示</span>' + (g === x ? '<small>いまこちら</small>' : '') + '</button>'; // 2026-10-20 オーナーの文字帳: 「casa SLOT をテレビで表示」「casa DERBY をテレビで表示」
    return '<div class="card"><h3>テレビで表示中のゲーム</h3>' + // 2026-10-20 オーナーの文字帳: 見出しを直し、「○○ のテレビ: ○○」の行と説明の文は消した
      '<div class="two">' + b('slot') + b('derby') + '</div>' +
      (state.msg ? '<div class="' + (/^OK /.test(state.msg) ? 'okm' : 'err') + '" id="tvgMsg">' + esc(state.msg.replace(/^OK /, '')) + '</div>' : '') +
      trHtml() + // テストレース（2026-10-19 その 2）
      qHtml() +
      (home() ? '<div class="auto"><span>このスマホの画面も自動で入れ替える<br><small style="color:#9aa89c">casa SLOT のときは casa SLOT の紙幣のページに（紙幣のページにもログインしてあるスマホだけ）</small></span><button type="button" data-tvg="auto">' + (auto() ? 'する' : 'しない') + '</button></div>' : '') +
      '<button type="button" class="close" data-tvg="close">閉じる</button></div>';
  }
  function trHtml() { // この店だけテストレース（staff.js の STAFF.test。「次へ」の同じボタンと同じ状態）
    const X = S().test; if (!X) return '';
    const [t, off] = X.why();
    return '<div class="tr" id="trBox"><h4>テストレース<small>この店のテレビだけ・集計に入りません</small></h4>' +
      '<p class="now" id="trNow">' + esc(t || (X.hint ? X.hint() : '押すと 1 分半後に発走します（参加受付 1 分 → 投票 30 秒）')) + '</p>' + // その 3: テレビが SLOT なら「切り替えてから」
      '<button type="button" class="go" data-tvg="test"' + (off || X.busy || state.busy ? ' disabled' : '') + '>テストレースを今すぐ走らせる</button></div>';
  }
  function paintTest() { const b = $('trBox'); if (b && state.open) { const h = trHtml(); if (b.outerHTML !== h) b.outerHTML = h; } }
  if (S().test) S().test.onChange(paintTest);
  function qHtml() { // テレビの画質（2026-10-19）
    const q = qNow(); state.qPainted = q;
    return '<div class="tq" id="tvqBox"><h4>テレビの画質<small>casa DERBY を映しているとき</small></h4>' +
      '<p class="now">いま: <b id="tvqNow">' + (q === undefined ? '確認中…' : QN[q]) + '</b></p>' +
      '<div class="three">' + QS3.map(([v, name, note]) => '<button type="button" data-tvq="' + v + '" class="' + (q === v ? 'cur' : '') + '"' + (q === v || state.busy ? ' disabled' : '') + '>' + (q === v ? '<i>いまこちら</i>' : '') + '<b>' + name + '</b><small>' + note + '</small></button>').join('') + '</div>' +
      (state.qmsg ? '<div class="' + (/^OK /.test(state.qmsg) ? 'okm' : 'err') + '" id="tvqMsg">' + esc(state.qmsg.replace(/^OK /, '')) + '</div>' : '') + '</div>';
  }
  function paint() {
    paintBtn();
    let sh = $('tvgSheet');
    if (!state.open || !loggedIn()) { if (sh) sh.remove(); if (state.open || sh) { if (S().test) S().test.watch(false); } state.open = false; return; }
    if (!sh) { sh = document.createElement('div'); sh.id = 'tvgSheet'; sh.addEventListener('click', onClick); document.body.appendChild(sh); }
    sh.innerHTML = sheetHtml();
  }
  const ERR = { bad_pin: 'PIN が変わりました。ログインし直してください', permission: '書き込みが許可されませんでした（PIN を確かめてください）', no_store: '店舗が見つかりません', bad_quality: 'なめらか優先・標準・きれい優先から選んでください' };
  async function onQuality(v) { // テレビの画質を変える（確認 → 書く → 「1 分ほどでテレビに反映」）
    if (state.busy || !loggedIn() || v === qNow()) return;
    const s = S().saved;
    if (!window.confirm(s.name + ' のテレビの画質を「' + QN[v] + '」にします。\n1 分ほどでテレビに反映されます（レース中は終わってから）。' + (v === 'max' ? '\nきれい優先は動きがカクカクすることがあります。' : ''))) return;
    state.busy = true; state.qmsg = ''; paint();
    try { const r = await S().C.tvQuality(s.pin, v); state.q = qNorm(r && r.tvQuality != null ? r.tvQuality : v); state.qAt = Date.now(); state.qmsg = 'OK 画質を「' + QN[state.q] + '」にしました。1 分ほどでテレビに反映されます（レース中は終わってから）。'; }
    catch (err) { state.qmsg = (err && ERR[err.code]) || (err && !err.status ? '通信できませんでした。もう一度お試しください' : (err && err.message) || 'うまくいきませんでした'); }
    state.busy = false; paint();
  }
  async function onClick(e) {
    const tq = e.target.closest('[data-tvq]');
    if (tq) return onQuality(qNorm(tq.dataset.tvq));
    const t = e.target.closest('[data-tvg]');
    if (!t) { if (e.target.id === 'tvgSheet' && !state.busy) { state.open = false; paint(); } return; }
    const a = t.dataset.tvg;
    if (a === 'close') { if (!state.busy) { state.open = false; paint(); } return; }
    if (a === 'auto') { lsSet(AUTO_KEY, auto() ? 'off' : null); paint(); kick(); return; }
    if (a === 'test') { if (!state.busy && S().test) S().test.press(); return; }
    if (state.busy || (a !== 'slot' && a !== 'derby') || !loggedIn()) return;
    const s = S().saved;
    if (!window.confirm(s.name + ' のテレビを ' + NAMES[a] + ' にします。数秒で切り替わります（ゲーム中・レース中は終わってから）。')) return;
    state.busy = true; state.msg = ''; paint();
    try { await S().C.tvGame(s.pin, a); state.game = a; state.at = Date.now(); state.msg = 'OK ' + s.name + ' のテレビを ' + NAMES[a] + ' にしました。'; }
    catch (err) { state.msg = (err && ERR[err.code]) || (err && !err.status ? '通信できませんでした。もう一度お試しください' : (err && err.message) || 'うまくいきませんでした'); }
    state.busy = false; paint(); kick();
  }

  /* ---------- 店の設定を見張る → スマホの画面の入れ替え ---------- */
  let lastTouch = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { capture: true, passive: true }));
  function looping() { let l = []; try { l = JSON.parse(lsGet(LOG_KEY) || '[]'); } catch (e) { l = []; } const now = Date.now(); return l.filter((x) => now - x < LOOP_MS).length >= LOOP_N; }
  function mark() { let l = []; try { l = JSON.parse(lsGet(LOG_KEY) || '[]'); } catch (e) { l = []; } l.push(Date.now()); lsSet(LOG_KEY, JSON.stringify(l.slice(-LOOP_N * 3))); }
  function busyNow() {
    if (state.open || state.busy || S().sheetOpen) return true;
    const lg = $('login');
    if (lg && !lg.classList.contains('hidden') && Array.from(lg.querySelectorAll('input')).some((i) => i.value || document.activeElement === i)) return true; // PIN・番号を入れている途中
    const ae = document.activeElement;
    return !!(ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName));
  }
  let ready = null;
  async function slotReady() {
    if (ready === true) return true;
    try { const r = await fetch(home() + '?t=' + Date.now(), { cache: 'no-store' }); ready = r.ok && /phoneswitch\.js/.test(await r.text()); } catch (e) { ready = false; }
    return ready;
  }
  let timer = 0;
  function kick(ms) { clearTimeout(timer); timer = setTimeout(maybeGo, ms == null ? 300 : ms); }
  async function maybeGo() {
    const id = storeId();
    state.id = id; state.waiting = false;
    if (!home() || !id || state.leaving || state.game !== 'slot') { state.why = !home() ? 'not under slot' : state.game !== 'slot' ? 'derby' : ''; return; }
    if (!billFits(id)) { state.why = 'no bill login'; return; }
    if (manualHold(id, state.game)) { state.why = 'manual'; return; } // 手で移ったあと、店のゲームが変わるまで（2026-10-19 その 2）
    if (!auto()) { state.why = 'auto off'; return; }
    if (looping()) { state.why = 'loop'; return kick(60000); }
    if (busyNow() || Date.now() - lastTouch < QUIET_MS) { state.waiting = true; state.why = 'busy'; return kick(RETRY_MS); }
    if (!(await slotReady())) { state.why = 'no slot bill'; return kick(POLL_MS); }
    if (state.game !== 'slot' || busyNow() || manualHold(id, state.game)) return kick(RETRY_MS);
    state.leaving = true; state.why = 'go'; mark();
    location.href = home();
  }
  let lastDoc = null;
  function onDoc(doc) {
    lastDoc = doc;
    const id = storeId(); state.id = id; if (!id) return paintBtn();
    state.game = T.gameOf(doc, id); state.at = Date.now();
    manualHold(id, state.game); // 店のゲームが手で移ったときと変わっていたら、ここで記録を消す（どちらのゲームに変わっても）
    paint(); kick();
  }
  T.watch(onDoc);
  setInterval(async () => { if (T.live.on || !storeId()) return; const d = await T.readDoc(); if (d) onDoc(d); }, POLL_MS);
  setTimeout(async () => { if (!T.live.on && storeId()) { const d = await T.readDoc(); if (d) onDoc(d); } }, 3000);
  setInterval(() => { if (lastDoc && storeId() !== state.id) onDoc(lastDoc); else paintBtn(); if (state.open && !state.busy && qNow() !== state.qPainted) paint(); }, 2000); // 画質がほかの画面で変わったらシートも塗り直す
  setInterval(() => { if (state.open) paintTest(); }, 1000); // 発走までの残り
  placeTabs();
  window.StaffSwitch = { state, manualHold, placeTabs, open() { state.open = true; paint(); }, maybeGo, qNow };
})();
