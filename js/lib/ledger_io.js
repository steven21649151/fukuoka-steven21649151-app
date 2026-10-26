// 記帳的共用小零件：分類名稱、一筆記錄的畫法、刪除確認、CSV 匯出／複製、toast
// 記帳頁（最新 3 筆）、帳務分析頁（完整明細）、行程卡底部面板都用這一份，畫法才會一致。
// 只放不碰 IndexedDB 的東西。

import { escapeHtml } from './md.js';
import { yen, md as mdDate } from './fmt.js';

export const CAT_LABEL = {
  food: '🍽 餐飲', transit: '🚇 交通', shop: '🛍 購物', ticket: '🎟 門票', hotel: '🏨 住宿', other: '🧾 其他',
};
export const CAT_EMOJI = {
  food: '🍽', transit: '🚇', shop: '🛍', ticket: '🎟', hotel: '🏨', other: '🧾',
};

// 付款方式：新存的記錄才有 pay 欄位；舊記錄沒有 → 一律當「未標記」
export const PAY_LIST = [
  { key: 'visa',  emoji: '💳', label: 'Visa',  color: '#3B6FB6' },
  { key: 'cash',  emoji: '💴', label: '現金',  color: '#4F7A4A' },
  { key: 'pxpay', emoji: '📱', label: '全支付', color: '#D9731F' },
];
export const PAY_NONE = { key: 'none', emoji: '', label: '未標記', color: '#8A8580' };
export const payKey = (r) => (PAY_LIST.some(p => p.key === r?.pay) ? r.pay : 'none');
export const payLabel = (r) => (PAY_LIST.find(p => p.key === r?.pay) || PAY_NONE).label;

// 行程項目名稱（lookup ＝ 目前版本＋另一版本的 days，找舊記錄綁的項目用）
export function itemTitle(days, itemId) {
  for (const d of days || []) {
    const it = (d.items || []).find(x => x.id === itemId);
    if (it) return it.title || itemId;
  }
  return itemId;
}
export function findItemLabel(days, itemId) {
  for (const d of (days || [])) {
    const it = (d.items || []).find(x => x.id === itemId);
    if (it) return `${d.date}｜${it.time || ''} ${it.title || ''}`;
  }
  return itemId;
}

// 一筆記錄的一行（兩行高）：時間｜分類｜金額（NT$）｜行程或備註｜可報帳｜改／刪
// 按鈕只帶 data-edit／data-del，各頁自己接事件。
export function rowHtml(r, { lookup, showDate = false, showItem = true } = {}) {
  const label = [showItem && r.itemId ? itemTitle(lookup, r.itemId) : '', r.note || ''].filter(Boolean).join(' · ') || '—';
  const when = `${showDate ? mdDate(r.date) + ' ' : ''}${r.time || ''}`.trim();
  const id = escapeHtml(r.id);
  const pay = PAY_LIST.find(p => p.key === r.pay);
  return `
    <div class="lr" data-id="${id}"${r.reimbursable ? ' data-reimb' : ''}>
      <span class="lr-t mono">${escapeHtml(when)}</span>
      <span class="lr-c" title="${escapeHtml(CAT_LABEL[r.category] || r.category)}">${CAT_EMOJI[r.category] || '🧾'}</span>
      <span class="lr-a">${pay ? `<i class="lr-p" title="${pay.label}">${pay.emoji}</i>` : ''}<b class="mono">${yen(r.jpy)}</b><small class="mono">NT$${(Number(r.twd) || 0).toLocaleString('en-US')}</small></span>
      <span class="lr-b">
        <button type="button" class="mini" data-edit="${id}" aria-label="改這一筆">改</button>
        <button type="button" class="mini del" data-del="${id}" aria-label="刪這一筆">刪</button>
      </span>
      <span class="lr-l">${escapeHtml(label)}${r.reimbursable ? ' <em class="lr-re">可報帳</em>' : ''}</span>
    </div>`;
}

// 刪除確認（回傳 true／false）。蓋在最上層，行程卡底部面板裡也能用
export function confirmDelete(msg) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'cd-overlay';
    ov.innerHTML = `
      <div class="cd-sheet" role="alertdialog" aria-modal="true">
        <div class="cd-msg">${escapeHtml(msg)}</div>
        <div class="cd-btns">
          <button type="button" class="btn" data-r="0">取消</button>
          <button type="button" class="btn btn-primary" data-r="1">刪除</button>
        </div>
      </div>`;
    const close = (v) => { ov.remove(); resolve(!!v); };
    ov.querySelectorAll('button[data-r]').forEach(b => b.addEventListener('click', () => close(b.getAttribute('data-r') === '1')));
    ov.addEventListener('click', (e) => { if (e.target === ov) close(false); });
    document.body.appendChild(ov);
  });
}
export const deleteMsg = (r) => `要刪除這筆嗎？\n${CAT_LABEL[r.category] || r.category} · ${yen(r.jpy)} · ${r.date}`;

export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 1800);
}

// ==================== CSV ====================

function csvField(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
export function buildCSV(list, days) {
  const header = ['日期','時間','分類','日圓','台幣','當時匯率','關聯行程','可報帳','付款方式','備註'];
  const lines = [header.map(csvField).join(',')];
  // 用日期＋時間排序，早的在前
  const sorted = list.slice().sort((a, b) =>
    (a.date === b.date) ? (a.time || '').localeCompare(b.time || '') : (a.date < b.date ? -1 : 1));
  for (const r of sorted) {
    lines.push([
      r.date, r.time || '',
      CAT_LABEL[r.category] || r.category,
      r.jpy, r.twd,
      r.rateUsed?.toFixed?.(4) ?? r.rateUsed,
      r.itemId ? findItemLabel(days, r.itemId) : '',
      r.reimbursable ? '是' : '',
      payLabel(r),
      r.note || '',
    ].map(csvField).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

// 手機分享／下載／開新視窗／提示複製 四段備援
export async function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const file = new File([blob], filename, { type: 'text/csv' });
  // ① 系統分享（iOS/Android PWA 首選）
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch { /* 分享被拒 → 掉到 ② */ }
  // ② <a download>
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    return;
  } catch { /* fall through */ }
  // ③ 開新視窗顯示原文
  try {
    const w = window.open('', '_blank');
    if (w) { w.document.body.innerText = csv; return; }
  } catch {}
  // ④ 提示複製
  prompt('複製這段（CSV）：', csv);
}

// 複製成文字；成功回 true
export async function copyCSV(csv) {
  try {
    await navigator.clipboard.writeText(csv);
    toast('已複製到剪貼簿');
    return true;
  } catch {
    const w = window.open('', '_blank');
    if (w) { w.document.body.innerText = csv; }
    else prompt('手動複製這段：', csv);
    return false;
  }
}

export const LS_LAST_EXPORT = 'ledger.lastExport';   // YYYY-MM-DD
export function markExported(dateStr) { try { localStorage.setItem(LS_LAST_EXPORT, dateStr); } catch {} }
