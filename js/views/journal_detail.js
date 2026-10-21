// 手帳大圖 sheet：手帳頁與景點頁共用
import { escapeHtml, mdInline } from '../lib/md.js';
import { putJournal, deleteJournal } from '../lib/db.js';
import { jstParts } from '../lib/exif.js';
import { renderOverlay } from '../lib/overlay.js';
import { fileSizeText } from '../lib/ui.js';
import { openShareSheet } from './share_sheet.js';

const WEEK = '日一二三四五六';

export function takenText(row) {
  const p = jstParts(row.takenAt || row.createdAt || '');
  return p ? `${p.mmdd}（${WEEK[p.weekday]}）${p.hhmm}` : '';
}

function spotLabel(data, id) {
  const s = (data?.spots || []).find(x => x.id === id);
  return s ? (s.nameZh || s.name || id) : id;
}

// onChange() 在改名／刪除／加字之後呼叫，讓呼叫端重繪
export async function openPhotoSheet(row, { data, onChange } = {}) {
  const slot = document.createElement('div');
  document.body.appendChild(slot);
  let url = null;

  async function show() {
    if (url) { URL.revokeObjectURL(url); url = null; }
    // 有疊字設定就顯示加字版預覽（不存檔），否則顯示原圖
    let blob = row.blob;
    if (row.overlay) {
      try { blob = await renderOverlay(row, data, 1400, 0.85); } catch { blob = row.blob; }
    }
    url = URL.createObjectURL(blob);
    slot.innerHTML = `
      <div class="jrn-detail-overlay">
        <div class="jrn-detail-sheet">
          <div class="jrn-detail-head">
            <span class="name">${escapeHtml(row.name || '')}</span>
            <button type="button" class="cap-close" data-a="close" aria-label="關閉">✕</button>
          </div>
          <div class="jrn-detail-img"><img alt="" src="${url}"></div>
          ${row.note && !row.overlay ? `<div class="jrn-detail-note">${mdInline(row.note)}</div>` : ''}
          <div class="jrn-detail-meta small faint">
            ${escapeHtml([
              takenText(row),
              row.spotId ? spotLabel(data, row.spotId) : '',
              row.w && row.h ? `${row.w}×${row.h}` : '',
              row.blob ? fileSizeText(row.blob.size) : '',
            ].filter(Boolean).join(' · '))}
          </div>
          <div class="jrn-detail-actions">
            <button type="button" class="btn btn-primary" data-a="share">📤 分享</button>
            <button type="button" class="btn" data-a="overlay">✍️ 加字</button>
            <button type="button" class="btn" data-a="rename">✎ 改名</button>
            <button type="button" class="btn" data-a="del">🗑 刪除</button>
          </div>
        </div>
      </div>`;
    const overlay = slot.querySelector('.jrn-detail-overlay');
    overlay.addEventListener('click', onClick);
  }

  function close() {
    if (url) URL.revokeObjectURL(url);
    slot.remove();
  }

  async function onClick(e) {
    if (e.target.classList.contains('jrn-detail-overlay')) return close();
    const btn = e.target.closest('[data-a]');
    const a = btn?.getAttribute('data-a');
    if (!a) return;
    if (a === 'close') return close();
    if (a === 'share') return openShareSheet({ rows: [row], data, title: row.name || '分享照片' });
    if (a === 'overlay') {
      const { openOverlayEditor } = await import('./overlay_editor.js');
      await openOverlayEditor(row, data, async () => { onChange?.(); await show(); });
      return;
    }
    if (a === 'rename') {
      const n = prompt('新的檔名：', row.name || '');
      if (!n || !n.trim()) return;
      row.name = n.trim();
      await putJournal(row);
      onChange?.();
      return show();
    }
    if (a === 'del') {
      if (!confirm(`刪掉這張？\n${row.name}`)) return;
      await deleteJournal(row.id);
      close();
      onChange?.();
    }
  }

  await show();
}
