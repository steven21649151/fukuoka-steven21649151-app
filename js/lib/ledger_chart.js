// 記帳頁「預算 vs 實際」分類圓餅圖的計算與繪製（純函式＋inline SVG，不碰 IndexedDB）
// 預算不需要新資料：從目前版本（雨天／晴天）的行程算。
//   每個 item：cost 取 (min+max)/2；transit.cost 也加進「交通」；kind 對到分類；pay === 'paid'（已付）的不算
//   購物 ＝ 日預算剩下的：max(0, 日預算換成日圓 − 其他分類加總)

// 日預算（NT$）：記帳頁的日預算進度條、帳務分析頁、圓餅圖預算的「購物＝剩下的」都用這個
export const DAILY_BUDGET_TWD = 8000;

export const CHART_CATS = [
  { key: 'food',    label: '餐飲', emoji: '🍽', color: '#C4452F' },
  { key: 'transit', label: '交通', emoji: '🚇', color: '#6E6863' },
  { key: 'shop',    label: '購物', emoji: '🛍', color: '#A97C1E' },
  { key: 'ticket',  label: '門票', emoji: '🎟', color: '#4F7A4A' },
  { key: 'hotel',   label: '住宿', emoji: '🏨', color: '#6A5E8C' },
  { key: 'other',   label: '其他', emoji: '🧾', color: '#3A5A72' },
];
const KIND_TO_CAT = {
  meal: 'food', transit: 'transit', flight: 'transit', sight: 'ticket',
  conference: 'ticket', shopping: 'shop', hotel: 'hotel',
};
const mid = (c) => (c && Number.isFinite(c.min) && Number.isFinite(c.max)) ? (c.min + c.max) / 2 : 0;

const emptyTotals = () => Object.fromEntries(CHART_CATS.map(c => [c.key, 0]));

// 一天的預算（日圓，按分類）。day 找不到（不在行程內的日期）→ 全 0
export function budgetForDay(day, dailyBudgetTwd, jpyToTwd) {
  const t = emptyTotals();
  if (!day) return t;
  for (const it of day.items || []) {
    if (it.pay !== 'paid') {
      const cat = KIND_TO_CAT[it.kind] || 'other';
      t[cat] += mid(it.cost);
    }
    if (it.transit && it.transit.pay !== 'paid') t.transit += mid(it.transit.cost);
  }
  const others = t.food + t.transit + t.ticket + t.hotel + t.other;
  const budgetJpy = jpyToTwd > 0 ? dailyBudgetTwd / jpyToTwd : 0;
  t.shop = Math.max(0, Math.round(budgetJpy - others));     // 購物 ＝ 日預算剩下的（行程裡購物自己的 cost 不另外算）
  for (const k of Object.keys(t)) t[k] = Math.round(t[k]);
  return t;
}

export function budgetForAll(days, dailyBudgetTwd, jpyToTwd) {
  const t = emptyTotals();
  for (const d of days || []) {
    const b = budgetForDay(d, dailyBudgetTwd, jpyToTwd);
    for (const k of Object.keys(t)) t[k] += b[k];
  }
  return t;
}

// 實際：rows 按 category 加總 jpy
export function actualTotals(rows) {
  const t = emptyTotals();
  for (const r of rows || []) {
    const k = t[r.category] != null ? r.category : 'other';
    t[k] += Number(r.jpy) || 0;
  }
  return t;
}

export const sumTotals = (t) => Object.values(t).reduce((s, v) => s + v, 0);

const yen = (n) => '¥' + Math.round(n).toLocaleString('en-US');

// 甜甜圈 SVG（圓心：總額＋≈NT$）。emptyText 在總額為 0 時顯示。
export function donutSvg(totals, { centerYen, centerTwd, over = false, emptyText = '還沒記帳' }) {
  const total = sumTotals(totals);
  const R = 42, C = 2 * Math.PI * R, SW = 16;
  let rings = '';
  if (total <= 0) {
    rings = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="currentColor" stroke-opacity=".14" stroke-width="${SW}"/>`;
  } else {
    let off = 0;
    for (const c of CHART_CATS) {
      const v = totals[c.key];
      if (v <= 0) continue;
      const len = (v / total) * C;
      rings += `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${c.color}" stroke-width="${SW}"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
        transform="rotate(-90 60 60)"/>`;
      off += len;
    }
  }
  const center = total <= 0
    ? `<text x="60" y="64" text-anchor="middle" class="dn-empty">${emptyText}</text>`
    : `<text x="60" y="58" text-anchor="middle" class="dn-amt${over ? ' over' : ''}">${yen(centerYen)}</text>
       <text x="60" y="74" text-anchor="middle" class="dn-twd">≈ NT$${Math.round(centerTwd).toLocaleString('en-US')}</text>`;
  return `<svg viewBox="0 0 120 120" class="ldg-donut" role="img" aria-label="${total <= 0 ? emptyText : yen(centerYen)}">${rings}${center}</svg>`;
}

// 分類表：[{ cat, budget, actual, diff }]；預算與實際都是 0 的分類不列
export function chartTable(budget, actual) {
  return CHART_CATS
    .map(c => ({ cat: c, budget: budget[c.key], actual: actual[c.key], diff: budget[c.key] - actual[c.key] }))
    .filter(r => r.budget > 0 || r.actual > 0);
}
