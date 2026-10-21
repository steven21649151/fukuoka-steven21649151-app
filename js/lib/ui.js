// 手帳相關畫面共用的小元件：進度浮層、提示、防連點、下載／分享
import { escapeHtml } from './md.js';

// 進度浮層：const p = showProgress('處理中…'); p.update('處理中 3/8'); p.close();
export function showProgress(text) {
  const el = document.createElement('div');
  el.className = 'prog-overlay';
  el.innerHTML = `<div class="prog-box"><div class="prog-spin" aria-hidden="true"></div><div class="prog-text" role="status"></div></div>`;
  const t = el.querySelector('.prog-text');
  t.textContent = text || '';
  document.body.appendChild(el);
  return {
    update(s) { t.textContent = s; },
    close() { el.remove(); },
  };
}

// 短暫提示
export function toast(text, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'jrn-toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// 按鈕執行 async 動作時鎖住，避免連點
export async function withLock(btn, fn) {
  if (!btn || btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  try { return await fn(); }
  finally { btn.dataset.busy = ''; btn.disabled = false; }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

// 分享檔案；不支援就逐張下載。回傳 'shared' | 'downloaded' | 'cancelled' | 'need-gesture'
export async function shareFiles(files, { title, text } = {}) {
  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title, text });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
    if (e && e.name === 'NotAllowedError') return 'need-gesture';
    /* 其他錯誤 → 改走下載 */
  }
  for (const f of files) {
    downloadBlob(f, f.name);
    await new Promise(r => setTimeout(r, 350));
  }
  return 'downloaded';
}

export function fileSizeText(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

export function safeName(name) {
  return String(name || 'photo').replace(/[\\/:*?"<>|]/g, '_');
}

export { escapeHtml };
