// 票券頁：使用者自己輸入，全部存 IDB，永遠不進 repo
import { escapeHtml, mdInline } from '../lib/md.js';
import { md as mdDate } from '../lib/fmt.js';
import { isAvailable, putTicket, deleteTicket, getAllTickets, getTicket } from '../lib/db.js';

const KIND_LABEL = {
  flight: '✈️ 機票', hotel: '🏨 住宿', transit: '🚇 交通',
  ticket: '🎫 票券', other: '📎 其他',
};
const HOW_OPTIONS = [
  '現場報到',
  '車站取票',
  '出示這張 QR 就可以',
  '⚠️ 要開原生 App 出示',
];

// 票券圖片：長邊 ≥ 2000 才 resize；否則存原圖（避免 QR 壓糊）
const IMG_MAX = 2000;
const IMG_Q   = 0.92;

let _thumbUrls = new WeakMap();
let _observer = null;

export async function render(root, params, ctx) {
  if (!(await isAvailable())) {
    root.innerHTML = `
      <div class="wrap">
        <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
        <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">票券</h1>
        <div class="empty">這個瀏覽器不允許儲存（可能是隱私模式）。票券暫時不能用。</div>
      </div>`;
    return;
  }

  const editId = params?.query?.edit || null;
  const preItemId = params?.query?.item || null;

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <div class="jrn-topline">
        <h1 style="font-family:var(--dis);font-size:22px">票券</h1>
        <div class="spacer"></div>
        <button type="button" class="btn btn-primary" id="tkAdd">＋ 加一張</button>
      </div>

      <div class="tk-warn">
        <b>這裡存的是副本，方便你隨時查。</b>
        機票 QR、熊本城電子票這類固定的 QR 通常可以直接出示；
        <b>但 my route 的太宰府柳川數位票有「啟用後 2 天內有效」的狀態，
        很可能必須在 my route App 裡叫出來才有效，截圖不一定過得了閘門。</b>
        每一張票的「怎麼用」欄位請照實填，不確定的出發前先問清楚。
      </div>

      <div id="tkList" class="tk-list"></div>

      <div id="tkFormSlot"></div>
      <div id="tkDetailSlot"></div>
      <div id="confirmSlot"></div>
    </div>
  `;

  const listEl = root.querySelector('#tkList');
  const formSlot = root.querySelector('#tkFormSlot');
  const detailSlot = root.querySelector('#tkDetailSlot');

  let rows = [];

  async function reload() {
    disposeThumbs();
    rows = (await getAllTickets()).sort((a, b) => {
      if ((a.dayN ?? 99) !== (b.dayN ?? 99)) return (a.dayN ?? 99) - (b.dayN ?? 99);
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    if (rows.length === 0) {
      listEl.innerHTML = `<div class="empty">還沒有任何一張。上面「＋ 加一張」把你的票輸進來。</div>`;
      return;
    }
    // group by day
    const map = new Map();
    for (const r of rows) {
      const k = r.dayN ?? 'other';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    const orderedKeys = [...map.keys()].sort((a, b) => {
      if (a === 'other') return 1;
      if (b === 'other') return -1;
      return a - b;
    });
    listEl.innerHTML = orderedKeys.map(k => {
      const label = k === 'other' ? '沒關聯日期' : dayLabel(ctx.data.days, k);
      return `
        <section class="tk-day">
          <div class="tk-day-head">${escapeHtml(label)}</div>
          <div class="tk-day-body">${map.get(k).map(renderRow).join('')}</div>
        </section>
      `;
    }).join('');
    observeThumbs();
  }

  root.querySelector('#tkAdd').addEventListener('click', () => openForm(null, preItemId));
  listEl.addEventListener('click', (e) => {
    const rowEl = e.target.closest('.tk-row');
    if (!rowEl) return;
    const id = rowEl.getAttribute('data-id');
    const row = rows.find(r => r.id === id);
    if (!row) return;
    // 點圖 → 出示模式；點卡其它區 → 開 detail
    if (e.target.closest('.tk-thumb')) openPresent(row);
    else openDetail(row);
  });

  window.addEventListener('hashchange', disposeThumbs, { once: true });
  await reload();
  if (editId) {
    const r = rows.find(x => x.id === editId);
    if (r) openForm(r, null);
  }

  // ============ 表單 ============
  function openForm(existing, preItemId) {
    const isNew = !existing;
    const row = existing || {
      id: cryptoUUID(),
      title: '', kind: 'ticket',
      dayN: preItemId ? findDayNForItem(ctx.data.days, preItemId) : null,
      itemId: preItemId || null,
      code: '', howToUse: '', link: '', note: '',
      image: null,
      createdAt: new Date().toISOString(),
    };

    formSlot.innerHTML = `
      <div class="cap-overlay" role="dialog" aria-modal="true">
        <div class="cap-sheet tk-form">
          <div class="cap-head">
            <div class="cap-title">${isNew ? '加一張票' : '編輯這張票'}</div>
            <button type="button" class="cap-close" data-a="close" aria-label="關閉">✕</button>
          </div>
          <label class="cap-field">
            <span class="k">名稱</span>
            <input id="tkfTitle" maxlength="60" value="${escapeHtml(row.title)}" placeholder="例：BR106 桃園→福岡">
          </label>
          <div class="cap-field">
            <span class="k">種類</span>
            <div class="chiprow" id="tkfKind" role="radiogroup" aria-label="種類">
              ${Object.entries(KIND_LABEL).map(([k, l]) => `
                <button type="button" class="chip" data-kind="${k}" ${k === row.kind ? 'aria-current="true"' : ''}>${l}</button>
              `).join('')}
            </div>
          </div>
          <label class="cap-field">
            <span class="k">關聯行程項目（可選）</span>
            <select id="tkfItem">
              <option value="">（不關聯）</option>
              ${renderAllItemOptions(ctx.data.days, row.itemId || '')}
            </select>
          </label>
          <label class="cap-field">
            <span class="k">確認編號／訂位代號</span>
            <input id="tkfCode" maxlength="60" value="${escapeHtml(row.code || '')}">
          </label>
          <label class="cap-field">
            <span class="k">怎麼用</span>
            <select id="tkfHow">
              <option value="">（未指定）</option>
              ${HOW_OPTIONS.map(o => `<option value="${escapeHtml(o)}" ${o === row.howToUse ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
            </select>
          </label>
          <label class="cap-field">
            <span class="k">外部連結（可選）</span>
            <input id="tkfLink" type="url" value="${escapeHtml(row.link || '')}" placeholder="Gmail 那封信、相簿⋯⋯">
          </label>
          <label class="cap-field">
            <span class="k">備註（可選）</span>
            <input id="tkfNote" maxlength="120" value="${escapeHtml(row.note || '')}">
          </label>
          <div class="cap-field">
            <span class="k">票券圖片（可選）</span>
            <div id="tkfImgSlot" class="tk-img-slot">${row.image ? '<span class="faint small">已有圖片，重選會覆蓋。</span>' : '（尚未選）'}</div>
            <label class="btn" style="width:max-content">
              <input type="file" id="tkfFile" accept="image/*" style="display:none">
              📷 選擇 / 拍照
            </label>
            <div class="small faint">壓縮輕，QR 碼可掃。</div>
          </div>
          <div class="cap-actions">
            ${!isNew ? '<button type="button" class="btn" data-a="del" style="margin-right:auto;color:var(--shu)">刪除</button>' : ''}
            <button type="button" class="btn" data-a="close">取消</button>
            <button type="button" class="btn btn-primary" data-a="save">存起來</button>
          </div>
        </div>
      </div>
    `;
    document.body.classList.add('cap-open');

    const overlay = formSlot.querySelector('.cap-overlay');
    const kindGroup = overlay.querySelector('#tkfKind');
    const fileInput = overlay.querySelector('#tkfFile');
    // 圖片一定要用 setAttribute（相同的坑）
    fileInput.setAttribute('accept', 'image/*');
    let pendingImage = null; // 只有選了才會有

    kindGroup.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-kind]');
      if (!b) return;
      kindGroup.querySelectorAll('button').forEach(x => x.removeAttribute('aria-current'));
      b.setAttribute('aria-current', 'true');
    });

    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      overlay.querySelector('#tkfImgSlot').textContent = '處理中…';
      pendingImage = await prepareTicketImage(f);
      const url = URL.createObjectURL(pendingImage.blob);
      overlay.querySelector('#tkfImgSlot').innerHTML = `
        <img src="${url}" alt="預覽" style="max-width:120px;max-height:120px;border-radius:6px">
        <span class="small faint" style="margin-left:8px">${pendingImage.w}×${pendingImage.h}</span>
      `;
    });

    async function close() {
      overlay.remove();
      formSlot.innerHTML = '';
      document.body.classList.remove('cap-open');
    }
    overlay.addEventListener('click', async (e) => {
      if (e.target === overlay) return close();
      const a = e.target.closest('[data-a]')?.getAttribute('data-a');
      if (a === 'close') return close();
      if (a === 'del') {
        const ok = await confirmDialog(`刪掉「${row.title || '這張票'}」？`);
        if (!ok) return;
        await deleteTicket(row.id);
        close();
        await reload();
      }
      if (a === 'save') {
        const kind = kindGroup.querySelector('[aria-current="true"]')?.getAttribute('data-kind') || row.kind;
        const itemId = overlay.querySelector('#tkfItem').value || null;
        const dayN = itemId ? findDayNForItem(ctx.data.days, itemId) : row.dayN;
        const merged = {
          ...row,
          title: overlay.querySelector('#tkfTitle').value.trim(),
          kind, itemId, dayN,
          code: overlay.querySelector('#tkfCode').value.trim(),
          howToUse: overlay.querySelector('#tkfHow').value,
          link: overlay.querySelector('#tkfLink').value.trim(),
          note: overlay.querySelector('#tkfNote').value.trim(),
        };
        if (pendingImage) { merged.image = pendingImage.blob; merged.imgW = pendingImage.w; merged.imgH = pendingImage.h; }
        if (!merged.title && !merged.code) {
          alert('至少填一個名稱或確認編號');
          return;
        }
        await putTicket(merged);
        close();
        await reload();
      }
    });
  }

  // ============ 詳情 sheet ============
  function openDetail(row) {
    detailSlot.innerHTML = `
      <div class="cap-overlay">
        <div class="cap-sheet tk-detail">
          <div class="cap-head">
            <div class="cap-title">${escapeHtml(KIND_LABEL[row.kind] || '')} ${escapeHtml(row.title || '')}</div>
            <button type="button" class="cap-close" data-a="close">✕</button>
          </div>
          ${row.code ? `<div class="tk-code"><span class="k">確認編號</span><code>${escapeHtml(row.code)}</code></div>` : ''}
          ${row.howToUse ? `<div class="tk-how ${row.howToUse.startsWith('⚠️') ? 'warn' : ''}">${escapeHtml(row.howToUse)}</div>` : ''}
          ${row.dayN != null ? `<div class="small faint">關聯：${escapeHtml(dayLabel(ctx.data.days, row.dayN))}${row.itemId ? ' · ' + escapeHtml(findItemLabel(ctx.data.days, row.itemId)) : ''}</div>` : ''}
          ${row.note ? `<div class="tk-note">${mdInline(row.note)}</div>` : ''}
          ${row.image ? `<div class="tk-detail-img"><img alt="" id="tkDetImg"></div><div class="small faint">點圖進出示模式</div>` : ''}
          ${row.link ? `<div class="tk-link"><a class="btn" href="${escapeHtml(row.link)}" target="_blank" rel="noopener">🔗 打開連結</a></div>` : ''}
          <div class="cap-actions">
            <button type="button" class="btn" data-a="edit">編輯</button>
            <button type="button" class="btn btn-primary" data-a="present" ${!row.image ? 'disabled' : ''}>🔎 出示模式</button>
          </div>
        </div>
      </div>
    `;
    document.body.classList.add('cap-open');
    const overlay = detailSlot.querySelector('.cap-overlay');
    let url;
    if (row.image) {
      url = URL.createObjectURL(row.image);
      overlay.querySelector('#tkDetImg').src = url;
      overlay.querySelector('#tkDetImg').addEventListener('click', () => { close(); openPresent(row); });
    }
    function close() {
      if (url) URL.revokeObjectURL(url);
      overlay.remove();
      detailSlot.innerHTML = '';
      document.body.classList.remove('cap-open');
    }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return close();
      const a = e.target.closest('[data-a]')?.getAttribute('data-a');
      if (a === 'close') return close();
      if (a === 'edit') { close(); openForm(row, null); }
      if (a === 'present') { close(); openPresent(row); }
    });
  }

  // ============ 出示模式（全螢幕）============
  async function openPresent(row) {
    if (!row.image) return;
    const url = URL.createObjectURL(row.image);
    const overlay = document.createElement('div');
    overlay.className = 'tk-present';
    overlay.innerHTML = `
      <div class="tk-present-tip">先把螢幕調亮一些，QR 才容易被掃到。</div>
      <button type="button" class="bc-close" aria-label="關閉">✕</button>
      <div class="tk-present-body"><img alt="" src="${url}"></div>
      ${row.code ? `<div class="tk-present-code"><code>${escapeHtml(row.code)}</code></div>` : ''}
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('bigcard-open');

    // Wake Lock
    let wl = null;
    try { if ('wakeLock' in navigator) wl = await navigator.wakeLock.request('screen'); } catch {}

    function close() {
      try { wl?.release?.(); } catch {}
      URL.revokeObjectURL(url);
      overlay.remove();
      document.body.classList.remove('bigcard-open');
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.querySelector('.bc-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
  }

  // ============ 二次確認 ============
  function confirmDialog(msg) {
    return new Promise(resolve => {
      const slot = root.querySelector('#confirmSlot');
      slot.innerHTML = `
        <div class="cd-overlay">
          <div class="cd-sheet">
            <div class="cd-msg">${escapeHtml(msg)}</div>
            <div class="cd-btns">
              <button type="button" class="btn" data-r="0">取消</button>
              <button type="button" class="btn btn-primary" data-r="1">刪除</button>
            </div>
          </div>
        </div>`;
      const close = (v) => { slot.innerHTML = ''; resolve(!!v); };
      slot.querySelectorAll('button[data-r]').forEach(b => b.addEventListener('click', () => close(b.getAttribute('data-r') === '1')));
      slot.querySelector('.cd-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) close(false); });
    });
  }
}

// ============ helpers ============

function renderRow(r) {
  const has = !!r.image;
  const warn = (r.howToUse || '').startsWith('⚠️');
  return `
    <article class="tk-row" data-id="${escapeHtml(r.id)}">
      <div class="tk-thumb" data-lazy>${has ? '<img alt="" data-lazy-img>' : '<div class="tk-noimg">📎</div>'}</div>
      <div class="tk-body">
        <div class="tk-title">${escapeHtml(KIND_LABEL[r.kind] || '')} ${escapeHtml(r.title || '（未命名）')}</div>
        ${r.code ? `<div class="tk-code-inline"><span class="k">代號</span><code>${escapeHtml(r.code)}</code></div>` : ''}
        ${r.howToUse ? `<div class="tk-how-inline ${warn ? 'warn' : ''}">${escapeHtml(r.howToUse)}</div>` : ''}
      </div>
      <span class="chev">›</span>
    </article>
  `;
}

async function prepareTicketImage(file) {
  const bmp = await loadImage(file);
  const iw = bmp.width  ?? bmp.naturalWidth;
  const ih = bmp.height ?? bmp.naturalHeight;
  const longEdge = Math.max(iw, ih);
  if (longEdge <= IMG_MAX) {
    // 原圖 <= IMG_MAX → 完全不重編碼，直接存原始 blob（QR 保清晰）
    bmp.close?.();
    return { blob: file, w: iw, h: ih };
  }
  const scale = IMG_MAX / longEdge;
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', IMG_Q));
  bmp.close?.();
  return { blob, w, h };
}
async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch {}
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

function cryptoUUID() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 't_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function dayLabel(days, n) {
  const d = (days || []).find(x => x.n === Number(n));
  return d ? `第 ${d.n} 天 · ${mdDate(d.date)}（${d.weekday || ''}）` : `第 ${n} 天`;
}
function findDayNForItem(days, itemId) {
  for (const d of (days || [])) {
    if ((d.items || []).some(it => it.id === itemId)) return d.n;
  }
  return null;
}
function findItemLabel(days, itemId) {
  for (const d of (days || [])) {
    const it = (d.items || []).find(x => x.id === itemId);
    if (it) return `${it.time || ''} ${it.title || ''}`;
  }
  return itemId;
}
function renderAllItemOptions(days, selected) {
  return (days || []).map(d => {
    const items = (d.items || []).filter(it => it.time);
    if (!items.length) return '';
    return `<optgroup label="第 ${d.n} 天 · ${mdDate(d.date)}">
      ${items.map(it => `
        <option value="${escapeHtml(it.id)}"${it.id === selected ? ' selected' : ''}>${escapeHtml(`${it.time} ${it.title || ''}`)}</option>
      `).join('')}
    </optgroup>`;
  }).join('');
}

// lazy thumbs
function observeThumbs() {
  disposeThumbs();
  const thumbs = [...document.querySelectorAll('.tk-thumb[data-lazy]')];
  if (!('IntersectionObserver' in window)) {
    thumbs.forEach(attachThumb);
    return;
  }
  _observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) attachThumb(en.target);
      else detachThumb(en.target);
    }
  }, { rootMargin: '200px 0px', threshold: 0.01 });
  thumbs.slice(0, 12).forEach(attachThumb);
  thumbs.slice(12).forEach(el => _observer.observe(el));
}
async function attachThumb(el) {
  const img = el.querySelector('img[data-lazy-img]');
  if (!img || _thumbUrls.has(img)) return;
  const rowEl = el.closest('.tk-row');
  const id = rowEl?.getAttribute('data-id');
  if (!id) return;
  const row = await getTicket(id);
  if (!row?.image) return;
  const url = URL.createObjectURL(row.image);
  img.src = url;
  _thumbUrls.set(img, url);
}
function detachThumb(el) {
  const img = el.querySelector('img[data-lazy-img]');
  if (!img) return;
  const url = _thumbUrls.get(img);
  if (url) { URL.revokeObjectURL(url); _thumbUrls.delete(img); img.removeAttribute('src'); }
}
function disposeThumbs() {
  if (_observer) { try { _observer.disconnect(); } catch {} _observer = null; }
  document.querySelectorAll('.tk-thumb img[data-lazy-img]').forEach(img => {
    const url = _thumbUrls.get(img);
    if (url) { URL.revokeObjectURL(url); _thumbUrls.delete(img); }
  });
}
