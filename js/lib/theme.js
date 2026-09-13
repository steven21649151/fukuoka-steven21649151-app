// 主題三段：system / light / dark
// - 'system'（預設）：拿掉 data-theme，讓 prefers-color-scheme 決定
// - 'light' / 'dark'：寫 :root[data-theme=...]（tokens.css 已支援）

const LS_KEY = 'theme';

export function getTheme() {
  try { return localStorage.getItem(LS_KEY) || 'system'; }
  catch { return 'system'; }
}

export function setTheme(t) {
  const v = (t === 'light' || t === 'dark') ? t : 'system';
  try {
    if (v === 'system') localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, v);
  } catch {}
  apply(v);
}

export function apply(t = getTheme()) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

export function initTheme() { apply(); }
