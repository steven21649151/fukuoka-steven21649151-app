// 手帳頁：依「拍攝日」分組的縮圖格；每天可「分享這天」「拼貼」；匯出按天打包 zip
// 照片不壓縮、留在手機（IndexedDB），App 只是加備註。
import { escapeHtml } from '../lib/md.js';
import { getAllJournal, isAvailable } from '../lib/db.js';
import { pickCamera, pickAlbum, ensureThumb } from '../lib/journal_capture.js';
import { createZip } from '../lib/zip.js';
import { jstParts } from '../lib/exif.js';
import { renderOverlay, hasOverlayText, ensureFonts } from '../lib/overlay.js';
import { showProgress, toast, downloadBlob, safeName, withLock } from '../lib/ui.js';
import { openPhotoSheet, takenText } from './journal_detail.js';
import { openShareSheet, sortByTaken } from './share_sheet.js';

const WEEK = '日一二三四五六';

let _urls = new Map();     // img element → objectURL（供離開時 revoke）
let _observer = null;

function rowDate(r) {
  const p = jstParts(r.takenAt || r.createdAt || '');
  return p ? p.date : '';
}

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

  const data = ctx.data;
  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <div class="jrn-topline">
        <h1 style="font-family:var(--dis);font-size:22px">手帳</h1>
        <div class="spacer"></div>
        <button type="button" class="btn btn-primary" id="jrnShoot">📷 拍照</button>
        <button type="button" class="btn" id="jrnAlbum">🖼 從相簿加入</button>
      </div>
      <p class="small faint" style="margin-bottom:10px">
        照片是原檔、只存在這支手機裡。想備份就到下面「匯出」，或到 <a href="#/tools/settings">設定</a>。
      </p>
      <div id="jrnList" class="jrn-list"></div>

      <section class="jrn-tools">
        <button type="button" class="btn" id="jrnExport">📤 匯出（zip）</button>
      </section>
    </div>
  `;

  const listEl = root.querySelector('#jrnList');
  let rows = [];

  async function reload() {
    disposeObservedImages();
    rows = await getAllJournal();
    if (rows.length === 0) {
      listEl.innerHTML = `<div class="empty">還沒有任何一張。上面「📷 拍照」或「🖼 從相簿加入」。</div>`;
      return;
    }
    const groups = new Map();
    for (const r of sortByTaken(rows)) {
      const d = rowDate(r) || '未知日期';
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(r);
    }
    const sorted = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    listEl.innerHTML = sorted.map(([iso, list]) => {
      const day = (data.days || []).find(d => d.date === iso);
      const wd = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? WEEK[new Date(iso + 'T00:00:00Z').getUTCDay()] : '';
      const label = /^\d{4}-/.test(iso)
        ? `${iso.slice(5).replace('-', '/')}${wd ? `（${wd}）` : ''}${day ? ` · 第 ${day.n} 天` : ''}`
        : iso;
      return `
      <section class="jrn-day" data-date="${escapeHtml(iso)}">
        <div class="jrn-day-head">
          <span class="d">${escapeHtml(label)}</span>
          <span class="c">${list.length} 張</span>
        </div>
        <div class="jrn-day-acts">
          <button type="button" class="btn" data-day-share="${escapeHtml(iso)}">📤 分享這天</button>
          <button type="button" class="btn" data-day-collage="${escapeHtml(iso)}">🧩 拼貼</button>
        </div>
        <div class="jrn-grid">
          ${list.map(renderThumb).join('')}
        </div>
      </section>`;
    }).join('');
    observeThumbs(rows);
  }

  root.querySelector('#jrnShoot').addEventListener('click', () => pickCamera({ data }));
  root.querySelector('#jrnAlbum').addEventListener('click', () => pickAlbum({ data }));
  root.querySelector('#jrnExport').addEventListener('click', () => openExportSheet(rows, data));

  const onAdded = () => reload();
  window.addEventListener('journal-added', onAdded);
  window.addEventListener('hashchange', () => {
    window.removeEventListener('journal-added', onAdded);
    disposeObservedImages();
  }, { once: true });

  listEl.addEventListener('click', async (e) => {
    const shareBtn = e.target.closest('[data-day-share]');
    const colBtn = e.target.closest('[data-day-collage]');
    if (shareBtn || colBtn) {
      const iso = (shareBtn || colBtn).getAttribute(shareBtn ? 'data-day-share' : 'data-day-collage');
      const list = rows.filter(r => rowDate(r) === iso);
      const day = (data.days || []).find(d => d.date === iso);
      if (shareBtn) {
        openShareSheet({ rows: list, data, title: day ? `第 ${day.n} 天 · ${iso.slice(5).replace('-', '/')}` : iso });
      } else {
        const { openCollageEditor } = await import('./collage_editor.js');
        openCollageEditor({ rows: list, data, kind: 'day', day: day || { n: '', date: iso, weekday: '', title: '' } });
      }
      return;
    }
    const el = e.target.closest('.jrn-thumb');
    if (!el) return;
    const row = rows.find(r => r.id === el.getAttribute('data-id'));
    if (row) openPhotoSheet(row, { data, onChange: reload });
  });

  await reload();
}

function renderThumb(r) {
  return `<div class="jrn-thumb" data-id="${escapeHtml(r.id)}">
    <img alt="${escapeHtml(r.name || '')}" data-lazy>
    <div class="jrn-thumb-name">${escapeHtml(r.name || '')}</div>
  </div>`;
}

// ============ 延遲載縮圖 ============
const EAGER = 24;
function observeThumbs(rows) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const thumbs = [...document.querySelectorAll('.jrn-thumb')];
  const eager = thumbs.slice(0, EAGER);
  const lazy = thumbs.slice(EAGER);
  eager.forEach(el => attach(el, byId));
  if (!('IntersectionObserver' in window)) { lazy.forEach(el => attach(el, byId)); return; }
  _observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) attach(en.target, byId); else detach(en.target);
    }
  }, { root: null, rootMargin: '200px 0px', threshold: 0.01 });
  lazy.forEach(el => _observer.observe(el));
}
async function attach(thumbEl, byId) {
  const img = thumbEl.querySelector('img[data-lazy]');
  if (!img || _urls.has(img)) return;
  const row = byId.get(thumbEl.getAttribute('data-id'));
  if (!row) return;
  _urls.set(img, null);                       // 佔位，避免重複載入
  const blob = row.thumb || await ensureThumb(row) || row.blob;
  if (!_urls.has(img)) return;                // 等的時候已經被釋放
  const url = URL.createObjectURL(blob);
  img.src = url;
  _urls.set(img, url);
}
function detach(thumbEl) {
  const img = thumbEl.querySelector('img[data-lazy]');
  if (!img) return;
  const url = _urls.get(img);
  if (url) URL.revokeObjectURL(url);
  _urls.delete(img);
  img.removeAttribute('src');
}
function disposeObservedImages() {
  if (_observer) { try { _observer.disconnect(); } catch {} _observer = null; }
  for (const url of _urls.values()) if (url) URL.revokeObjectURL(url);
  _urls = new Map();
}

// ============ 匯出：選哪一天 ============
function openExportSheet(rows, data) {
  if (!rows.length) { alert('還沒有可匯出的照片'); return; }
  const byDay = new Map();
  for (const r of sortByTaken(rows)) {
    const d = rowDate(r) || '未知日期';
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(r);
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const el = document.createElement('div');
  el.className = 'cap-overlay';
  el.innerHTML = `
    <div class="cap-sheet" role="dialog" aria-modal="true" aria-label="匯出">
      <div class="cap-head">
        <div class="cap-title">📤 匯出哪一天</div>
        <button type="button" class="cap-close" aria-label="關閉">✕</button>
      </div>
      <div class="small faint">每個 zip 有「原圖」「加字版」「手帳.csv」。原圖不壓縮，一次一天比較不會爆記憶體。</div>
      <div class="exp-list">
        ${days.map(([iso, list]) => {
          const day = (data.days || []).find(d => d.date === iso);
          const label = /^\d{4}-/.test(iso) ? `${iso.slice(5).replace('-', '/')}${day ? ` · 第 ${day.n} 天` : ''}` : iso;
          return `<button type="button" class="btn" data-exp="${escapeHtml(iso)}">${escapeHtml(label)}　${list.length} 張</button>`;
        }).join('')}
        ${days.length > 1 ? `<button type="button" class="btn btn-primary" data-exp="*">全部（每天一個 zip）</button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('cap-open');
  const close = () => { el.remove(); document.body.classList.remove('cap-open'); };
  el.addEventListener('click', async (e) => {
    if (e.target === el || e.target.classList.contains('cap-close')) return close();
    const b = e.target.closest('[data-exp]');
    if (!b) return;
    const which = b.getAttribute('data-exp');
    await withLock(b, async () => {
      const targets = which === '*' ? days : days.filter(([iso]) => iso === which);
      const prog = showProgress('打包中…');
      try {
        for (let i = 0; i < targets.length; i++) {
          const [iso, list] = targets[i];
          prog.update(`打包中 ${i + 1}/${targets.length}（${list.length} 張）`);
          const blob = await buildDayZip(iso, list, data, (n) => prog.update(`打包中 ${i + 1}/${targets.length} · 加字版 ${n}/${list.length}`));
          downloadBlob(blob, `fukuoka-手帳-${iso}.zip`);
          if (i < targets.length - 1) await new Promise(r => setTimeout(r, 800));
        }
        toast('已下載到手機');
        close();
      } catch (err) {
        alert('匯出失敗：' + (err.message || err));
      } finally { prog.close(); }
    });
  });
}

export async function buildDayZip(iso, list, data, onOverlayProgress) {
  await ensureFonts();
  const zip = createZip();
  const used = new Set();
  const uniq = (base, ext) => {
    let name = `${safeName(base)}.${ext}`, n = 2;
    while (used.has(name)) name = `${safeName(base)}_${n++}.${ext}`;
    used.add(name);
    return name;
  };
  const csv = [['檔名', '日期', '景點', '備註', '拍攝時間', '天', '景點中文名'].join(',')];
  let done = 0;
  for (const r of list) {
    const ext = /png/i.test(r.blob.type || '') ? 'png' : 'jpg';
    const fname = uniq(r.name || r.id, ext);
    zip.addFile(`原圖/${fname}`, r.blob);
    // 有疊字設定或有備註的才放加字版
    if ((r.overlay || (r.note && r.note.trim())) && hasOverlayText(r, data)) {
      try {
        const ob = await renderOverlay(r, data);
        zip.addFile(`加字版/${fname.replace(/\.\w+$/, '')}.jpg`, ob);
      } catch { /* 單張失敗不擋整包 */ }
      onOverlayProgress?.(++done);
    }
    const sp = r.spotId ? (data.spots || []).find(s => s.id === r.spotId) : null;
    const day = (data.days || []).find(d => d.date === rowDate(r));
    csv.push([
      csvSafe(fname), rowDate(r), csvSafe(r.spotId || ''), csvSafe(r.note),
      csvSafe(takenText(r)), day ? day.n : (r.day ?? ''), csvSafe(sp ? (sp.nameZh || sp.name) : ''),
    ].join(','));
  }
  zip.addString('手帳.csv', '﻿' + csv.join('\r\n'));
  return zip.build();
}

function csvSafe(s) {
  if (s == null) return '';
  const str = String(s);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
