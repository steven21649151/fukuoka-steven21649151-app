// 極簡渲染：只處理 **粗體** 與 \n 換行。另外把不該拆行的 token 包成 <span class="nw">。

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

// 不拆行的類型：金額（¥、NT$）、時間（09:15、13:15–15:00）、短括號（不超過 8 字）
function nowrapTokens(s) {
  // 全形括號整組（8 字以內）不拆
  s = s.replace(/（([^（）]{1,8})）/g, '<span class="nw">（$1）</span>');
  // 半形括號（10 字以內）不拆
  s = s.replace(/\(([^()]{1,10})\)/g, '<span class="nw">($1)</span>');
  // 金額：¥ / NT$，帶千分位與範圍
  s = s.replace(/(¥[\d,]+(?:[–\-][\d,]+)?)/g, '<span class="nw">$1</span>');
  s = s.replace(/(NT\$[\d,]+(?:[–\-][\d,]+)?)/g, '<span class="nw">$1</span>');
  // 時間 09:15 / 13:15–15:00
  s = s.replace(/(\b\d{1,2}:\d{2}(?:[–\-]\d{1,2}:\d{2})?\b)/g, '<span class="nw">$1</span>');
  return s;
}

export function mdInline(s) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  out = nowrapTokens(out);
  out = out.replace(/\n/g, '<br>');
  return out;
}
