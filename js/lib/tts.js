// TTS 共用工具（日文＋英文）
// 1) getVoices() 第一次常常回空陣列，要等 voiceschanged；但有的瀏覽器根本不觸發 → 設 timeout
// 2) speak() 一定要在使用者的點擊事件裡「同步」呼叫（iOS Safari 限制）
//    → 頁面載入時就 warmUp*，之後同步 speak()

const _cache = {};         // lang prefix (ja/en/…) → voice
const _pending = {};       // lang prefix → Promise

function pickByLang(prefix) {
  const voices = (typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices()) || [];
  return voices.find(v => v.lang?.toLowerCase().startsWith(prefix)) || null;
}

export function getVoice(prefix) {
  if (_cache[prefix]) return Promise.resolve(_cache[prefix]);
  if (_pending[prefix]) return _pending[prefix];
  if (!('speechSynthesis' in window)) return Promise.resolve(null);

  _pending[prefix] = new Promise((resolve) => {
    const v = pickByLang(prefix);
    if (v) { _cache[prefix] = v; resolve(v); return; }
    let done = false;
    const on = () => {
      if (done) return;
      done = true;
      speechSynthesis.removeEventListener('voiceschanged', on);
      _cache[prefix] = pickByLang(prefix);
      resolve(_cache[prefix]);
    };
    speechSynthesis.addEventListener('voiceschanged', on);
    setTimeout(on, 1500);
  });
  return _pending[prefix];
}

// 相容既有呼叫
export function getJaVoice() { return getVoice('ja'); }
export function warmUpJaVoice() { getVoice('ja'); getVoice('en'); }

export function hasTTS() { return 'speechSynthesis' in window; }

// 同步呼叫 speak()：voice 有 cache 就用，沒 cache 也送出去，等 speech 引擎自己挑
// opts.lang: 'ja-JP' | 'en-US' 等 BCP47
export function speak(text, opts = {}, onEnd) {
  if (!hasTTS()) { onEnd?.(new Error('no-tts')); return null; }
  const lang = opts.lang || 'ja-JP';
  const prefix = lang.slice(0, 2).toLowerCase();
  try { speechSynthesis.cancel(); } catch {}
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = opts.rate ?? 0.95;
  const v = _cache[prefix];
  if (v) u.voice = v;
  u.onend = () => onEnd?.(null);
  u.onerror = (e) => onEnd?.(e.error || new Error('speech-error'));
  try { speechSynthesis.speak(u); } catch (e) { onEnd?.(e); }
  return u;
}

// 相容舊呼叫
export function speakJa(text, onEnd) { return speak(text, { lang: 'ja-JP' }, onEnd); }
export function speakEn(text, onEnd) { return speak(text, { lang: 'en-US' }, onEnd); }

export function stopSpeak() {
  if (!hasTTS()) return;
  try { speechSynthesis.cancel(); } catch {}
}

// 檢查是否有某語言的 voice
export function hasVoice(prefix) { return !!_cache[prefix]; }
