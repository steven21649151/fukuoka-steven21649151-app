// 分享 sheet：縮圖格＋勾選、原圖／加字版、超過 10 張或 40 MB 自動分批
import { escapeHtml } from '../lib/md.js';
import { renderOverlay, hasOverlayText, ensureFonts } from '../lib/overlay.js';
import { shareFiles, safeName, fileSizeText, toast } from '../lib/ui.js';

const BATCH_MAX_FILES = 10;
const BATCH_MAX_BYTES = 40 * 1024 * 1024;

export function sortByTaken(rows) {
  return [...rows].sort((a, b) =>
    String(a.takenAt || a.createdAt || '') < String(b.takenAt || b.createdAt || '') ? -1 : 1);
}

function fileExt(blob) { return /png/i.test(blob.type || '') ? 'png' : 'jpg'; }

// rows 之中選出的照片 → 要分享的 File（加字版或原圖）
async function buildFile(row, data, mode) {
  if (mode === 'overlay' && hasOverlayText(row, data)) {
    const blob = await renderOverlay(row, data);
    return new File([blob], `${safeName(row.name || 'photo')}.jpg`, { type: 'image/jpeg' });
  }
  return new File([row.blob], `${safeName(row.name || 'photo')}.${fileExt(row.blob)}`, { type: row.blob.type || 'image/jpeg' });
}

function toBatches(files) {
  const out = [];
  let cur = [], size = 0;
  for (const f of files) {
    if (cur.length && (cur.length >= BATCH_MAX_FILES || size + f.size > BATCH_MAX_BYTES)) {
      out.push(cur); cur = []; size = 0;
    }
    cur.push(f); size += f.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

// opts: { rows, data, title }
export function openShareSheet({ rows, data, title }) {
  const list = sortByTaken(rows);
  if (!list.length) { toast('這裡還沒有照片'); return; }
  const urls = [];
  const sel = new Set(list.map(r => r.id));    // 預設全選
  let mode = 'overlay';
  let running = false;

  const el = document.createElement('div');
  el.className = 'cap-overlay shr-overlay';
  el.innerHTML = `
    <div class="cap-sheet shr-sheet" role="dialog" aria-modal="true" aria-label="分享">
      <div class="cap-head">
        <div class="cap-title">📤 ${escapeHtml(title || '分享照片')}</div>
        <button type="button" class="cap-close" aria-label="關閉">✕</button>
      </div>
      <div class="shr-mode" role="group" aria-label="輸出版本">
        <button type="button" class="seg on" data-mode="overlay">加字版</button>
        <button type="button" class="seg" data-mode="orig">原圖</button>
        <span class="shr-count small faint"></span>
      </div>
      <div class="shr-grid">
        ${list.map(r => {
          const b = r.thumb || r.blob;
          const u = URL.createObjectURL(b); urls.push(u);
          return `<label class="shr-cell"><img alt="${escapeHtml(r.name || '')}" src="${u}">
            <input type="checkbox" data-id="${escapeHtml(r.id)}" checked aria-label="選取 ${escapeHtml(r.name || '')}"></label>`;
        }).join('')}
      </div>
      <div class="small faint shr-hint"></div>
      <div class="cap-actions">
        <button type="button" class="btn" data-a="all">全選／取消</button>
        <button type="button" class="btn btn-primary" data-a="go">分享</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('cap-open');

  const goBtn = el.querySelector('[data-a="go"]');
  const hint = el.querySelector('.shr-hint');
  const count = el.querySelector('.shr-count');

  function refresh() {
    count.textContent = `已選 ${sel.size}/${list.length}`;
    goBtn.disabled = running || sel.size === 0;
    hint.textContent = mode === 'overlay'
      ? '加字版：備註與日期壓在照片上；沒有任何文字的照片會輸出原圖。'
      : '原圖：不加字、不壓縮。';
  }
  refresh();

  function close() {
    urls.forEach(u => URL.revokeObjectURL(u));
    el.remove();
    document.body.classList.remove('cap-open');
  }

  // 分批送出
  let batches = null, idx = 0;
  async function sendCurrent() {
    const total = batches.length;
    const r = await shareFiles(batches[idx], { title: title || '福岡手帳' });
    if (r === 'need-gesture' || r === 'cancelled') {
      goBtn.textContent = `📤 送出${total > 1 ? `（${idx + 1}/${total}）` : ''}`;
      goBtn.disabled = false; running = false;
      hint.textContent = r === 'cancelled' ? '沒有送出，再按一次可以重試。' : '檔案準備好了，按一下送出。';
      return;
    }
    idx++;
    if (idx < total) {
      goBtn.textContent = `下一批（${idx + 1}/${total}）`;
      goBtn.disabled = false; running = false;
      hint.textContent = `第 ${idx}/${total} 批已送出。`;
    } else {
      toast(r === 'downloaded' ? '已下載到手機' : '已送出');
      close();
    }
  }

  async function onGo() {
    if (running) return;
    if (batches) { running = true; goBtn.disabled = true; return sendCurrent(); }
    running = true; refresh();
    const picked = list.filter(r => sel.has(r.id));
    const files = [];
    try {
      await ensureFonts();
      for (let i = 0; i < picked.length; i++) {
        goBtn.textContent = `處理中 ${i + 1}/${picked.length}`;
        files.push(await buildFile(picked[i], data, mode));
      }
    } catch (e) {
      alert('處理照片時失敗：' + (e.message || e));
      goBtn.textContent = '分享'; running = false; refresh(); return;
    }
    batches = toBatches(files);
    idx = 0;
    const totalSize = files.reduce((s, f) => s + f.size, 0);
    hint.textContent = `共 ${files.length} 張 · ${fileSizeText(totalSize)}${batches.length > 1 ? ` · 分 ${batches.length} 批送出` : ''}`;
    await sendCurrent();
  }

  el.addEventListener('click', (e) => {
    if (e.target === el) return close();
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('cap-close')) return close();
    if (t.dataset.mode) {
      if (running || batches) return;     // 已經處理完的檔案不再換版本
      mode = t.dataset.mode;
      el.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b === t));
      refresh();
    } else if (t.dataset.a === 'all') {
      if (running || batches) return;
      const allOn = sel.size === list.length;
      el.querySelectorAll('input[data-id]').forEach(i => { i.checked = !allOn; });
      sel.clear();
      if (!allOn) list.forEach(r => sel.add(r.id));
      refresh();
    } else if (t.dataset.a === 'go') onGo();
  });
  el.addEventListener('change', (e) => {
    const i = e.target.closest('input[data-id]');
    if (!i) return;
    if (batches) { i.checked = sel.has(i.dataset.id); return; }
    if (i.checked) sel.add(i.dataset.id); else sel.delete(i.dataset.id);
    refresh();
  });
}
