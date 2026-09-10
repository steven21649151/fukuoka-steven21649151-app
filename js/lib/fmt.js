// 數字與日期格式工具

// 日圓千分位：yen(2400) → "¥2,400"
export function yen(n) {
  if (n == null || isNaN(n)) return '';
  return '¥' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 「¥2,400–3,700」／「¥210」／「免費」／null
export function yenRange(cost) {
  if (!cost) return '';
  const { min, max } = cost;
  if (min == null && max == null) return '';
  if (min === 0 && max === 0) return '免費';
  if (min === max) return yen(min);
  return `${yen(min)}–${yen(max).replace('¥', '')}`;
}

// 日期：2026-10-25 → 10/25
export function md(dateStr) {
  if (!dateStr) return '';
  return dateStr.slice(5).replace('-', '/');
}

// 台幣：twd(4500, 0.2035) → "NT$920"
// ≥100 元四捨五入到十位，<100 元四捨五入到個位。
// **粗估用**：行程／景點頁的預估價格，進位到 10 讀起來俐落。
// 記帳、匯率換算等**要精確到 1 元**的地方用 twdExact()。
export function twd(jpy, rate) {
  if (jpy == null || !rate) return '';
  const v = jpy * rate;
  const rounded = v >= 100 ? Math.round(v / 10) * 10 : Math.round(v);
  return 'NT$' + rounded.toLocaleString('en-US');
}

// 台幣，四捨五入到 1 元。**記帳／匯率換算專用**——數字要對得上信用卡帳單。
export function twdExact(jpy, rate) {
  if (jpy == null || !rate) return '';
  return 'NT$' + Math.round(jpy * rate).toLocaleString('en-US');
}

// 「NT$920–1,120」
export function twdRange(cost, rate) {
  if (!cost || !rate) return '';
  const { min, max } = cost;
  if (min == null && max == null) return '';
  if (min === 0 && max === 0) return '';
  if (min === max) return twd(min, rate);
  return `${twd(min, rate)}–${twd(max, rate).replace('NT$', '')}`;
}

// 只有 ≥500 才算得上「有必要換算」——省得 ¥210 這種嗶一下就過的行變吵
export function twdIfBig(cost, rate, threshold = 500) {
  if (!cost || !rate) return '';
  const { min, max } = cost;
  const peak = Math.max(min || 0, max || 0);
  if (peak < threshold) return '';
  return twdRange(cost, rate);
}

// 把自由文字裡的 ¥數字 後面補「（≈NT$xxx）」；抓不到就原樣輸出。
// 支援 ¥1,000 / ¥1,000–2,000 / ¥1,078
export function annotateYenTwd(text, rate) {
  if (!text || !rate) return text;
  return text.replace(/¥([\d,]+)(?:[–\-]([\d,]+))?/g, (m, a, b) => {
    const av = parseInt(a.replace(/,/g, ''), 10);
    const bv = b ? parseInt(b.replace(/,/g, ''), 10) : null;
    if (av < 500) return m;
    const twdText = bv != null
      ? twdRange({ min: av, max: bv }, rate)
      : twd(av, rate);
    return `${m}（≈${twdText}）`;
  });
}
