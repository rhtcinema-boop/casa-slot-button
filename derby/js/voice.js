/* 実況の声（ブラウザの読み上げ機能 speechSynthesis を使う。音声ファイルは不要）
   Voice.say(text, { urgent }) … 画面の実況テロップと同じ文をしゃべる。
   - 実況らしく速め・高めに。「！」のある文は少しテンションを上げる
   - 前の文が終わる前に次の文が来たら: urgent（残り200m・ゴールなど）は前を切ってすぐ、そうでなければ 1 つだけ待たせる（古いものは捨てる）
   - ?mute=1 または ?voice=0 で無効。Sfx.mute(true) のときも黙る */
window.Voice = (function () {
  'use strict';
  const ok = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  const off = /[?&](mute=1|voice=0)/.test(location.search);
  // 男性の実況アナウンサーらしい声を優先（Mac: Otoya / Reed / Rocko / Eddy、Android: Google 日本語）
  const PREFER = ['Otoya', 'Reed', 'Rocko', 'Eddy', 'Google 日本語', 'Kyoko'];
  let voice = null, waiting = null, speaking = false, enabled = ok && !off, lastAt = 0;
  function pickVoice() {
    if (!ok) return;
    const vs = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
    for (const name of PREFER) { const v = vs.find((x) => x.name.indexOf(name) === 0); if (v) { voice = v; return; } }
    voice = vs[0] || null;
  }
  if (ok) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  // 表示用の文を、読み上げやすい言葉に直す
  function toSpeech(t) {
    return String(t)
      .replace(/(\d+)\.(\d{2})\.(\d)/g, (_, m, s, d) => (Number(m) ? m + '分' : '') + Number(s) + '秒' + d)   // 0.59.8 → 59秒8
      .replace(/(\d+)\.(\d)(?!\d)/g, '$1秒$2')                                                                   // 59.8 → 59秒8
      .replace(/(\d+)m/g, '$1メートル')
      .replace(/[　\s]+/g, '、')
      .replace(/…/g, '、')
      .replace(/、+/g, '、');
  }
  function speak(text, hot) {
    const u = new SpeechSynthesisUtterance(toSpeech(text));
    u.lang = 'ja-JP'; if (voice) u.voice = voice;
    u.rate = hot ? 1.45 : 1.3; u.pitch = hot ? 1.2 : 1.05; u.volume = 1;
    u.onstart = () => { speaking = true; };
    u.onend = u.onerror = () => { speaking = false; if (waiting && Date.now() - waiting.at < 3500) { const w = waiting; waiting = null; speak(w.text, w.hot); } else waiting = null; };
    speaking = true; lastAt = Date.now();
    speechSynthesis.speak(u);
  }
  function say(text, opt) {
    if (!enabled || !text) return;
    if (window.Sfx && Sfx.isMuted && Sfx.isMuted()) return;
    opt = opt || {};
    const hot = /！|!/.test(text) || !!opt.urgent;
    const busy = speaking || speechSynthesis.speaking || speechSynthesis.pending;
    if (!busy) { speak(text, hot); return; }
    if (opt.urgent) { waiting = null; speechSynthesis.cancel(); speaking = false; setTimeout(() => speak(text, hot), 30); return; }
    waiting = { text, hot, at: Date.now() };                // 待たせるのは 1 つだけ（新しいものに置き換え）
    // まれに onend が来ない環境があるので、長く黙ったままなら強制的に次へ
    if (Date.now() - lastAt > 6000) { speechSynthesis.cancel(); speaking = false; const w = waiting; waiting = null; speak(w.text, w.hot); }
  }
  // 最初のタップのときに 1 回呼ぶ（ブラウザによっては、操作の中で一度しゃべらないと声が出ない）
  function unlock() { if (!enabled) return; try { const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } catch (e) {} }
  function stop() { if (ok) { waiting = null; speechSynthesis.cancel(); speaking = false; } }
  return { say, unlock, stop, get enabled() { return enabled; }, set enabled(v) { enabled = ok && !!v; if (!enabled) stop(); }, get voiceName() { return voice ? voice.name : ''; } };
})();
