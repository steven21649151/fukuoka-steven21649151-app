// 日文 TTS 共用工具
// 1) getVoices() 第一次常常回空陣列，要等 voiceschanged；但有的瀏覽器根本不觸發 → 設 timeout
// 2) speak() 一定要在使用者的點擊事件裡「同步」呼叫（iOS Safari 限制）
//    → 頁面載入時就 warmUpJaVoice()，之後同步 speak()

let cachedVoice = null;
let cachedPromise = null;

function pickJa() {
  const voices = (typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices()) || [];
  return voices.find(v => v.lang?.toLowerCase().startsWith('ja')) || null;
}

export function getJaVoice() {
  if (cachedVoice) return Promise.resolve(cachedVoice);
  if (cachedPromise) return cachedPromise;
  if (!('speechSynthesis' in window)) return Promise.resolve(null);

  cachedPromise = new Promise((resolve) => {
    const v = pickJa();
    if (v) { cachedVoice = v; resolve(v); return; }
    let done = false;
    const on = () => {
      if (done) return;
      done = true;
      speechSynthesis.removeEventListener('voiceschanged', on);
      cachedVoice = pickJa();
      resolve(cachedVoice);
    };
    speechSynthesis.addEventListener('voiceschanged', on);
    setTimeout(on, 1500);
  });
  return cachedPromise;
}

// 頁面載入時預熱一次
export function warmUpJaVoice() { getJaVoice(); }

export function hasTTS() { return 'speechSynthesis' in window; }

// 同步呼叫 speak()：voice 有 cache 就用，沒 cache 也送出去，等 speech 引擎自己挑
// onEnd 在 utterance 結束或錯誤時觸發
export function speakJa(text, onEnd) {
  if (!hasTTS()) { onEnd?.(new Error('no-tts')); return null; }
  try { speechSynthesis.cancel(); } catch {}
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 0.95;
  if (cachedVoice) u.voice = cachedVoice;
  u.onend = () => onEnd?.(null);
  u.onerror = (e) => onEnd?.(e.error || new Error('speech-error'));
  try { speechSynthesis.speak(u); } catch (e) { onEnd?.(e); }
  return u;
}

export function stopSpeak() {
  if (!hasTTS()) return;
  try { speechSynthesis.cancel(); } catch {}
}
