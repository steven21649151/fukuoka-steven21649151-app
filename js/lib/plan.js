// 行程版本：🌧 雨天版（預設）／☀️ 晴天版
// data/days.json ＝ 晴天版（完整六天）；data/days_rain.json ＝ 雨天版，只放跟晴天版不一樣的天（10/25、10/26、10/28），
// 其他天兩版共用。雨天版 items 裡的 { "ref": "<id>" } ＝ 直接沿用晴天版同 id 的項目。
export const PLAN_KEY = 'plan';

export function getPlan() {
  try { return localStorage.getItem(PLAN_KEY) === 'sunny' ? 'sunny' : 'rain'; }
  catch { return 'rain'; }
}
export function setPlan(plan) {
  try { localStorage.setItem(PLAN_KEY, plan === 'sunny' ? 'sunny' : 'rain'); } catch { /* 無痕模式等 */ }
}

const clone = (x) => JSON.parse(JSON.stringify(x));

// plan === 'rain' 且雨天版有這天 → { ...晴天那天, title, summary, costEstimate, tipIds, items: 展開後的 items }
// 其他天（或晴天版）原封不動
export function applyPlan(sunnyDays, rainFile, plan) {
  const days = sunnyDays || [];
  if (plan !== 'rain' || !rainFile || !Array.isArray(rainFile.days)) return days;

  // ref 要在「所有晴天版天數」裡找
  const byId = new Map();
  for (const d of days) for (const it of d.items || []) byId.set(it.id, it);

  const rainByN = new Map(rainFile.days.map(d => [d.n, d]));
  return days.map(sd => {
    const rd = rainByN.get(sd.n);
    if (!rd) return sd;
    const items = [];
    for (const it of rd.items || []) {
      if (it && it.ref != null) {
        const base = byId.get(it.ref);
        if (!base) { console.error(`雨天版找不到要沿用的項目：${it.ref}`); continue; }
        items.push(clone(base));
      } else {
        items.push(clone(it));
      }
    }
    return {
      ...sd,
      title: rd.title ?? sd.title,
      summary: rd.summary ?? sd.summary,
      costEstimate: rd.costEstimate ?? sd.costEstimate,
      tipIds: rd.tipIds ?? sd.tipIds,
      items,
    };
  });
}

// 手帳照片可以連到「行程卡」（不只景點）：只對這天以後的行程開放，之前的天維持原本只連景點
export const CARD_LINK_FROM = '2026-10-27';
export const canLinkCard = (date) => !!date && String(date) >= CARD_LINK_FROM;

// 在目前版本裡找第一個有這個 spotId 的天（例如鞋店在雨天版是 10/25、spot.day 卻寫 4）；找不到才用 fallback
export function findSpotDay(days, spotId, fallback = null) {
  for (const d of days || []) {
    if ((d.items || []).some(it => it.spotId === spotId)) return d.n;
  }
  return fallback;
}
