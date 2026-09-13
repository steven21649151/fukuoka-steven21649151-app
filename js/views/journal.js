// 手帳頁：按日分組縮圖網格、可分享／改名／刪除、全部匯出 zip
import { escapeHtml, mdInline } from '../lib/md.js';
import { getAllJournal, putJournal, deleteJournal, isAvailable } from '../lib/db.js';
import { openCapture } from '../lib/journal_capture.js';
import { createZip } from '../lib/zip.js';
import { md as mdDate } from '../lib/fmt.js';

let _urls = new WeakMap();   // img element → objectURL（供離開時 revoke）
let _observer = null;

export async function render(root, params, ctx) {
  const ok = await isAvailable();
  if (!ok) {
    root.innerHTML = `
      <div class="wrap">
        <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
        <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">手帳</h1>
        <div class="empty">這個瀏覽器不允許儲存（可能是隱私模式）。手帳暫時不能用。</div>
      </div>`;
    return;
  }

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <div class="jrn-topline">
        <h1 style="font-family:var(--dis);font-size:22px">手帳</h1>
        <div class="spacer"></div>
        <button type="button" class="btn btn-primary" id="jrnShoot">📷 記錄</button>
      </div>
      <p class="small faint" style="margin-bottom:10px">
        照片只存在這支手機裡。想備份就到 <a href="#/tools/settings">設定</a> 一鍵匯出。
      </p>
      <div id="jrnList" class="jrn-list"></div>

      <section class="jrn-tools">
        <button type="button" class="btn" id="jrnExport">📤 全部匯出（zip）</button>
      </section>

      <div id="jrnDetailSlot"></div>
    </div>
  `;

  const listEl = root.querySelector('#jrnList');
  const detailSlot = root.querySelector('#jrnDetailSlot');

  let rows = [];

  async function reload() {
    disposeObservedImages();
    rows = (await getAllJournal()).sort((a, b) =>
      (a.createdAt < b.createdAt) ? 1 : -1
    );
    if (rows.length === 0) {
      listEl.innerHTML = `<div class="empty">還沒有任何一張。上面「📷 記錄」開相機。</div>`;
      return;
    }
    // group by day (isoDate)
    const groups = new Map();
    for (const r of rows) {
      const iso = (r.createdAt || '').slice(0, 10);
      if (!groups.has(iso)) groups.set(iso, []);
      groups.get(iso).push(r);
    }
    const sorted = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    listEl.innerHTML = sorted.map(([iso, list]) => `
      <section class="jrn-day">
        <div class="jrn-day-head">
          <span class="d">${escapeHtml(mdDate(iso))}</span>
          <span class="c">${list.length} 張</span>
        </div>
        <div class="jrn-grid">
          ${list.map(renderThumb).join('')}
        </div>
      </section>
    `).join('');
    observeThumbs();
  }

  root.querySelector('#jrnShoot').addEventListener('click', async () => {
    await openCapture({});
  });
  root.querySelector('#jrnExport').addEventListener('click', () => onExportZip(rows));

  window.addEventListener('journal-added', reload);
  window.addEventListener('hashchange', disposeObservedImages, { once: true });

  // 點縮圖 → 大圖 sheet
  listEl.addEventListener('click', (e) => {
    const el = e.target.closest('.jrn-thumb');
    if (!el) return;
    const id = el.getAttribute('data-id');
    const row = rows.find(r => r.id === id);
    if (row) openDetail(row);
  });

  function openDetail(row) {
    const url = URL.createObjectURL(row.blob);
    detailSlot.innerHTML = `
      <div class="jrn-detail-overlay">
        <div class="jrn-detail-sheet">
          <div class="jrn-detail-head">
            <span class="name">${escapeHtml(row.name || '')}</span>
            <button type="button" class="cap-close" data-a="close" aria-label="關閉">✕</button>
          </div>
          <div class="jrn-detail-img"><img alt="" src="${url}"></div>
          ${row.note ? `<div class="jrn-detail-note">${mdInline(row.note)}</div>` : ''}
          <div class="jrn-detail-meta small faint">
            ${escapeHtml(mdDate((row.createdAt||'').slice(0,10)))}
            ${row.spotId ? '·' : ''} ${row.spotId ? escapeHtml(findSpotLabel(ctx.data.spots, row.spotId)) : ''}
            · ${row.w}×${row.h}
          </div>
          <div class="jrn-detail-actions">
            <button type="button" class="btn btn-primary" data-a="share">📤 分享</button>
            <button type="button" class="btn" data-a="rename">✎ 改名</button>
            <button type="button" class="btn" data-a="del">🗑 刪除</button>
          </div>
        </div>
      </div>
    `;
    const overlay = detailSlot.querySelector('.jrn-detail-overlay');
    function close() { URL.revokeObjectURL(url); detailSlot.innerHTML = ''; }
    overlay.addEventListener('click', async (e) => {
      if (e.target === overlay) return close();
      const a = e.target.closest('[data-a]')?.getAttribute('data-a');
      if (a === 'close') return close();
      if (a === 'share') return doShare(row);
      if (a === 'rename') {
        const n = prompt('新的檔名：', row.name || '');
        if (!n || !n.trim()) return;
        row.name = n.trim();
        await putJournal(row);
        close();
        await reload();
      }
      if (a === 'del') {
        const ok = confirm(`刪掉這張？\n${row.name}`);
        if (!ok) return;
        await deleteJournal(row.id);
        close();
        await reload();
      }
    });
  }

  await reload();
}

function renderThumb(r) {
  return `<div class="jrn-thumb" data-id="${escapeHtml(r.id)}" data-blob-thumb>
    <img alt="${escapeHtml(r.name || '')}" data-lazy>
    <div class="jrn-thumb-name">${escapeHtml(r.name || '')}</div>
  </div>`;
}

// ============ 延遲載縮圖 ============
// 前 EAGER 張直接載，避免第一次進頁面時 IO 尚未 fire 的空窗（也適用於背景載入的情境）；
// 其餘用 IntersectionObserver 進出 viewport 才載/釋放。
const EAGER = 24;
function observeThumbs() {
  disposeObservedImages();
  const thumbs = [...document.querySelectorAll('.jrn-thumb')];
  const eager = thumbs.slice(0, EAGER);
  const lazy  = thumbs.slice(EAGER);
  eager.forEach(el => attachBlobUrl(el));

  if (!('IntersectionObserver' in window)) {
    lazy.forEach(el => attachBlobUrl(el));
    return;
  }
  _observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const el = en.target;
      if (en.isIntersecting) attachBlobUrl(el);
      else detachBlobUrl(el);
    }
  }, { root: null, rootMargin: '200px 0px', threshold: 0.01 });
  lazy.forEach(el => _observer.observe(el));
}

async function attachBlobUrl(thumbEl) {
  const img = thumbEl.querySelector('img[data-lazy]');
  if (!img || _urls.has(img)) return;
  const id = thumbEl.getAttribute('data-id');
  try {
    const { getJournal } = await import('../lib/db.js');
    const row = await getJournal(id);
    if (!row) return;
    const url = URL.createObjectURL(row.blob);
    img.src = url;
    _urls.set(img, url);
  } catch {}
}
function detachBlobUrl(thumbEl) {
  const img = thumbEl.querySelector('img[data-lazy]');
  if (!img) return;
  const url = _urls.get(img);
  if (url) { URL.revokeObjectURL(url); _urls.delete(img); img.removeAttribute('src'); }
}
function disposeObservedImages() {
  if (_observer) { try { _observer.disconnect(); } catch {} _observer = null; }
  document.querySelectorAll('.jrn-thumb img[data-lazy]').forEach(img => {
    const url = _urls.get(img);
    if (url) { URL.revokeObjectURL(url); _urls.delete(img); }
  });
}

// ============ 分享 / 下載 / 手動 三段 ============
async function doShare(row) {
  const file = new File([row.blob], `${row.name || 'photo'}.jpg`, { type: 'image/jpeg' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: row.note || row.name || '' });
      return;
    }
  } catch { /* 分享被拒 → 下載 */ }
  try {
    const url = URL.createObjectURL(row.blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${row.name || 'photo'}.jpg`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
    return;
  } catch {}
  alert('這台裝置無法直接分享或下載，長按上面的圖片可以存到相簿。');
}

// ============ 全部匯出 zip ============
async function onExportZip(rows) {
  if (!rows.length) { alert('還沒有可匯出的照片'); return; }
  const zip = createZip();
  const csvHeader = ['檔名','日期','景點','備註'];
  const csvLines = [csvHeader.join(',')];
  for (const r of rows) {
    const fname = `${r.name || r.id}.jpg`;
    zip.addFile(`手帳/${safe(fname)}`, r.blob);
    csvLines.push([safe(fname), (r.createdAt||'').slice(0,10), r.spotId || '', csvSafe(r.note)].join(','));
  }
  zip.addString('手帳/手帳.csv', '﻿' + csvLines.join('\r\n'));
  const out = await zip.build();
  await downloadOrShare(out, `fukuoka-手帳-${todayStamp()}.zip`);
}

function safe(name) { return name.replace(/[\\/:*?"<>|]/g, '_'); }
function csvSafe(s) {
  if (s == null) return '';
  const str = String(s);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

async function downloadOrShare(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch {}
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
  } catch {
    alert('匯出失敗');
  }
}

function findSpotLabel(spots, id) {
  const s = (spots || []).find(x => x.id === id);
  return s ? (s.nameZh || s.name || id) : id;
}
