// 外部 App 快捷連結
// ⚠️ 網頁沒有能力偵測 App 是否安裝。分兩類處理：
// - 有網頁版的 → https 連結（有 App 就開 App、沒有就開網頁版，兩者都能用）
// - 只有 App 的 → 開 Play 商店下載頁（不做「跳轉 + 沒裝就提醒」的假嘗試）

// Google 翻譯：可選帶預填文字，來源日文 → 繁中
export function googleTranslateUrl(text = '') {
  const base = 'https://translate.google.com/?sl=ja&tl=zh-TW&op=translate';
  return text ? `${base}&text=${encodeURIComponent(text)}` : base;
}

// my route（Toyota 與西鐵的官方 App，也有 web）
export const myRouteUrl        = 'https://www.myroute.fun/';

// Visit Japan Web
export const visitJapanWebUrl  = 'https://services.digital.go.jp/visit-japan-web/';

// Jorudan 轉乘（網頁版）
export const jorudanUrl        = 'https://world.jorudan.co.jp/mln/zh-TW/';

// LINE 福岡屋台官方帳號（LINE 有 web 版）
export const lineFukuokaYatai  = 'https://line.me/R/ti/p/@yatai_fukuoka';

// Safety tips — 只有 App，連 Play 商店
export const safetyTipsPlay    = 'https://play.google.com/store/apps/details?id=jp.co.rcsc.safetytips.android';

// 通用文案：按鈕旁的小字提醒
export const APP_OR_WEB_HINT   = '會開 App 或網頁版';

// 對外連結按鈕的統一渲染
export function renderExtBtn({ href, emoji, label, hint = APP_OR_WEB_HINT }) {
  return `<a class="ext-btn" href="${href}" target="_blank" rel="noopener">
    <span class="ico">${emoji}</span>
    <span class="lbl">${label}</span>
    ${hint ? `<span class="ext-hint">${hint}</span>` : ''}
  </a>`;
}
