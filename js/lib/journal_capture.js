// 手帳加入照片：📷 拍照／🖼 從相簿加入 → 讀拍攝時間、自動對到第幾天與景點 → 命名表單 → 存 IDB
// 照片不壓縮：存進 IDB 的 blob 就是使用者選的原始 File；另外產生長邊 480 的縮圖只給清單用。
import { escapeHtml } from './md.js';
import { putJournal, getAllJournal, isAvailable } from './db.js';
import { getTakenAt, matchItinerary, jstParts } from './exif.js';
import { findSpotDay, canLinkCard } from './plan.js';
import { loadBitmap, srcW, srcH, freeCanvas } from './overlay.js';
import { showProgress, toast, downloadBlob, safeName } from './ui.js';

export const THUMB_EDGE = 480;
const THUMB_Q = 0.8;
export const AUTOSAVE_KEY = 'jrn.autoSave';

export function autoSaveEnabled() {
  try { return localStorage.getItem(AUTOSAVE_KEY) !== '0'; } catch { return true; }
}

// ---------------------------------------------------------------
// 縮圖
export async function makeThumb(bmp) {
  const sw = srcW(bmp), sh = srcH(bmp);
  const s = Math.min(1, THUMB_EDGE / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * s));
  c.height = Math.max(1, Math.round(sh * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', THUMB_Q));
  freeCanvas(c);
  return blob;
}

// 舊資料沒有 thumb：第一次顯示時現場產生並回寫
export async function ensureThumb(row) {
  if (row.thumb) return row.thumb;
  try {
    const bmp = await loadBitmap(row.blob, THUMB_EDGE * 2, row.w, row.h);
    row.thumb = await makeThumb(bmp);
    bmp.close?.();
    await putJournal(row);
  } catch { /* 做不出縮圖就先用原圖 */ }
  return row.thumb || null;
}

// ---------------------------------------------------------------
// 入口：data-jrn-spot 按鈕與手帳頁都從這裡進來
// opts: { spot?: { id, nameZh }, dayN?: number, data: { days, spots } }
export async function openCapture(opts = {}) {
  if (!(await ensureAvailable())) return;
  showSourceMenu(opts);
}
export async function pickCamera(opts = {}) {
  if (!(await ensureAvailable())) return;
  startPick('camera', opts);
}
export async function pickAlbum(opts = {}) {
  if (!(await ensureAvailable())) return;
  startPick('album', opts);
}

async function ensureAvailable() {
  const ok = await isAvailable();
  if (!ok) alert('這個瀏覽器不允許儲存（可能是隱私模式）。手帳無法使用。');
  return ok;
}

// ---------------------------------------------------------------
// 行程卡（今天以後的天，照片可以直接連到某一張卡）
const cleanTitle = (s) => String(s || '').replace(/[*`]/g, '').trim();
const dayByN = (data, n) => (data?.days || []).find(d => d.n === n) || null;
function findCard(data, itemId) {
  if (!itemId) return null;
  for (const d of data?.days || []) {
    const it = (d.items || []).find(x => x.id === itemId);
    if (it) return { day: d, it };
  }
  return null;
}
const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + (m || 0); };
// 這天有這個景點的卡裡挑一張：拍攝時間落在哪張就哪張，不然第一張
function pickCardForSpot(dayObj, spotId, takenAt) {
  const cards = (dayObj?.items || []).filter(it => it.spotId === spotId);
  if (!cards.length) return null;
  const p = takenAt ? jstParts(takenAt) : null;
  if (p && p.date === dayObj.date) {
    const t = toMin(p.hhmm);
    const inside = cards.find(it => it.time && it.endTime && toMin(it.time) <= t && t < toMin(it.endTime));
    if (inside) return inside;
    let best = null;
    for (const it of cards) if (it.time && toMin(it.time) <= t && (!best || toMin(it.time) >= toMin(best.time))) best = it;
    if (best) return best;
  }
  return cards[0];
}

function showSourceMenu(opts) {
  const card = findCard(opts.data, opts.itemId);
  const where = opts.spot ? (opts.spot.nameZh || opts.spot.name || '') : (card ? cleanTitle(card.it.title) : '');
  const ov = document.createElement('div');
  ov.className = 'cap-overlay cap-menu';
  ov.innerHTML = `
    <div class="cap-sheet" role="dialog" aria-modal="true" aria-label="加入照片">
      <div class="cap-title">${where ? escapeHtml(where) + ' · ' : ''}加入照片</div>
      <button type="button" class="btn btn-primary cap-menu-btn" data-src="camera">📷 拍照</button>
      <button type="button" class="btn cap-menu-btn" data-src="album">🖼 從相簿加入</button>
      <button type="button" class="btn" data-src="">取消</button>
    </div>`;
  document.body.appendChild(ov);
  document.body.classList.add('cap-open');
  const close = () => { ov.remove(); document.body.classList.remove('cap-open'); };
  ov.addEventListener('click', (e) => {
    if (e.target === ov) return close();
    const b = e.target.closest('[data-src]');
    if (!b) return;
    const src = b.getAttribute('data-src');
    close();
    // 要在同一次點擊裡呼叫 input.click()，瀏覽器才肯開相機／相簿
    if (src) startPick(src, opts);
  });
}

// ---------------------------------------------------------------
// 開檔案選擇器（⚠️ 要在使用者點擊的同一個 tick 裡呼叫）
function startPick(source, opts) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (source === 'camera') {
    // ⚠️ 一定要用 setAttribute：手機判斷「直接開相機」看的是 HTML 屬性，
    // 部分瀏覽器沒實作 capture 這個 IDL property。
    input.setAttribute('capture', 'environment');
  } else {
    input.multiple = true;      // 相簿：不要 capture，可多選
  }
  input.style.display = 'none';
  document.body.appendChild(input);

  let handled = false;
  const finish = async () => {
    if (handled) return;
    handled = true;
    const files = [...(input.files || [])];
    input.remove();
    if (files.length) await processFiles(files, source, opts);
  };
  input.addEventListener('change', finish, { once: true });
  input.addEventListener('cancel', () => { handled = true; input.remove(); }, { once: true });
  input.click();
}

async function processFiles(files, source, opts) {
  const prog = showProgress(files.length > 1 ? `處理中 0/${files.length}` : '處理中…');
  const items = [];
  try {
    for (let i = 0; i < files.length; i++) {
      prog.update(files.length > 1 ? `處理中 ${i + 1}/${files.length}` : '處理中…');
      try { items.push(await prepare(files[i], source, opts)); }
      catch { /* 讀不了的檔案（例如不是圖片）略過 */ }
    }
  } finally { prog.close(); }
  if (!items.length) { alert('這些檔案讀不了，請選 JPEG 或 PNG 照片。'); return; }
  await showCaptureSheet(items, source, opts);
}

async function prepare(file, source, opts) {
  const takenAt = await getTakenAt(file);
  const bmp = await loadBitmap(file);
  const w = srcW(bmp), h = srcH(bmp);
  const thumb = await makeThumb(bmp);
  bmp.close?.();
  let { day, spotId } = matchItinerary(takenAt, opts.data?.days, opts.data?.spots);
  if (opts.spot?.id) {            // 從景點按鈕進來：以那個景點為準
    spotId = opts.spot.id;
    // 先在目前版本裡找第一個有這個景點的天（鞋店在雨天版是 10/25，spot.day 卻寫 4），找不到才用 spot.day
    day = opts.dayN ?? findSpotDay(opts.data?.days, spotId, opts.spot.day) ?? day;
  }
  let itemId = null;
  const card = findCard(opts.data, opts.itemId);
  if (card && canLinkCard(card.day.date)) {   // 從行程卡的 📷 進來：以那張卡為準（沒景點的卡 spotId 就是 null）
    itemId = card.it.id;
    day = card.day.n;
    spotId = card.it.spotId && (opts.data?.spots || []).some(s => s.id === card.it.spotId) ? card.it.spotId : null;
  } else if (spotId && day != null) {
    const dobj = dayByN(opts.data, day);
    if (dobj && canLinkCard(dobj.date)) itemId = pickCardForSpot(dobj, spotId, takenAt)?.id ?? null;
  }
  return { file, thumb, w, h, takenAt, source, day: day ?? null, spotId: spotId ?? null, itemId, note: '', name: '' };
}

// ---------------------------------------------------------------
// 天／景點選單
function dayOptions(data, cur) {
  const opts = [`<option value="">不指定</option>`];
  for (const d of data?.days || []) {
    opts.push(`<option value="${d.n}"${cur === d.n ? ' selected' : ''}>第 ${d.n} 天 · ${escapeHtml(String(d.date || '').slice(5).replace('-', '/'))}</option>`);
  }
  return opts.join('');
}
function spotOptions(data, dayN, cur) {
  const seen = new Set();
  const list = [];
  const day = (data?.days || []).find(d => d.n === dayN);
  for (const it of day?.items || []) {
    if (!it.spotId || seen.has(it.spotId)) continue;
    const sp = (data?.spots || []).find(s => s.id === it.spotId);
    if (!sp) continue;
    seen.add(it.spotId);
    list.push({ id: sp.id, label: `${it.time || ''} ${sp.nameZh || sp.name || sp.id}`.trim() });
  }
  if (cur && !seen.has(cur)) {
    const sp = (data?.spots || []).find(s => s.id === cur);
    if (sp) list.push({ id: sp.id, label: sp.nameZh || sp.name || sp.id });
  }
  return `<option value="">不指定</option>` + list.map(o =>
    `<option value="${escapeHtml(o.id)}"${cur === o.id ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
}
// 今天以後的天：下拉列出當天每一張行程卡（值是卡片 id）
function cardOptions(dayObj, curItemId) {
  return `<option value="">不指定</option>` + (dayObj.items || []).map(it =>
    `<option value="${escapeHtml(it.id)}"${curItemId === it.id ? ' selected' : ''}>${escapeHtml(`${it.time || ''} ${cleanTitle(it.title)}`.trim())}</option>`).join('');
}
function placeOptions(data, item) {
  const d = dayByN(data, item.day);
  return d && canLinkCard(d.date) ? cardOptions(d, item.itemId) : spotOptions(data, item.day, item.spotId);
}
const placeLabel = (data, item) => {
  const d = dayByN(data, item.day);
  return d && canLinkCard(d.date) ? '行程卡' : '景點';
};
export function placeSummary(day, spotId, data, itemId) {
  const parts = [];
  if (day) parts.push(`第 ${day} 天`);
  const sp = spotId ? (data?.spots || []).find(s => s.id === spotId) : null;
  const card = findCard(data, itemId);
  if (sp) parts.push(sp.nameZh || sp.name || sp.id);
  else if (card) parts.push(cleanTitle(card.it.title));
  return parts.length ? `📅 ${parts.join(' · ')}` : '📅 未指定天與景點';
}

// 把「摘要按鈕＋可展開的兩個下拉」綁到一個容器上。item 需有 day / spotId。
export function wirePlacePicker(box, item, data, onChange) {
  const sum = box.querySelector('[data-ds-sum]');
  const pick = box.querySelector('[data-ds-pick]');
  const dsel = box.querySelector('[data-ds-day]');
  const ssel = box.querySelector('[data-ds-spot]');
  const lbl = box.querySelector('[data-ds-lbl]');
  const refresh = () => { sum.textContent = placeSummary(item.day, item.spotId, data, item.itemId) + ' ▾'; };
  sum.addEventListener('click', () => { pick.hidden = !pick.hidden; });
  dsel.addEventListener('change', () => {
    item.day = dsel.value ? Number(dsel.value) : null;
    const day = dayByN(data, item.day);
    if (day && canLinkCard(day.date)) {
      // 換到新的一天：原本的景點還在這天就挑那天對應的卡，不然清掉
      const c = item.spotId ? pickCardForSpot(day, item.spotId, item.takenAt) : null;
      item.itemId = c ? c.id : null;
      if (!c) item.spotId = null;
    } else {
      item.itemId = null;
      if (item.spotId) {
        const stillThere = (day?.items || []).some(it => it.spotId === item.spotId);
        if (!stillThere) item.spotId = null;
      }
    }
    ssel.innerHTML = placeOptions(data, item);
    if (lbl) lbl.textContent = placeLabel(data, item);
    ssel.disabled = !item.day;
    refresh(); onChange?.();
  });
  ssel.addEventListener('change', () => {
    const day = dayByN(data, item.day);
    if (day && canLinkCard(day.date)) {
      const c = (day.items || []).find(it => it.id === ssel.value) || null;
      item.itemId = c ? c.id : null;
      item.spotId = c && c.spotId && (data?.spots || []).some(s => s.id === c.spotId) ? c.spotId : null;
    } else {
      item.itemId = null;
      item.spotId = ssel.value || null;
    }
    refresh(); onChange?.();
  });
  refresh();
}
export function placePickerHtml(item, data) {
  return `
    <div class="ds-box">
      <button type="button" class="ds-sum" data-ds-sum></button>
      <div class="ds-pick" data-ds-pick hidden>
        <label class="cap-field"><span class="k">天</span>
          <select data-ds-day>${dayOptions(data, item.day)}</select></label>
        <label class="cap-field"><span class="k" data-ds-lbl>${placeLabel(data, item)}</span>
          <select data-ds-spot${item.day ? '' : ' disabled'}>${placeOptions(data, item)}</select></label>
      </div>
    </div>`;
}

// ---------------------------------------------------------------
// 命名表單（單張／多張）
async function makeNamer(data) {
  const rows = await getAllJournal().catch(() => []);
  const bySpot = new Map();
  const byCard = new Map();   // 連到沒有景點的行程卡的照片，檔名用卡片名稱
  const byDate = new Map();
  for (const r of rows) {
    if (r.spotId) bySpot.set(r.spotId, (bySpot.get(r.spotId) || 0) + 1);
    else if (r.itemId) byCard.set(r.itemId, (byCard.get(r.itemId) || 0) + 1);
    const p = jstParts(r.takenAt || r.createdAt || '');
    if (p) byDate.set(p.mmdd.replace('/', '-'), (byDate.get(p.mmdd.replace('/', '-')) || 0) + 1);
  }
  const used = { spot: new Map(), card: new Map(), date: new Map() };
  return (item) => {
    const card = !item.spotId ? findCard(data, item.itemId) : null;
    if (card) {
      const n = (byCard.get(item.itemId) || 0) + (used.card.get(item.itemId) || 0) + 1;
      used.card.set(item.itemId, (used.card.get(item.itemId) || 0) + 1);
      const t = cleanTitle(card.it.title);
      const short = (t.length > 12 ? t.replace(/[（(].*$/, '') : t).trim().slice(0, 20) || t.slice(0, 12);   // 括號裡的細節不放進檔名
      return `${short}_${n}`;
    }
    if (item.spotId) {
      const sp = (data?.spots || []).find(s => s.id === item.spotId);
      const n = (bySpot.get(item.spotId) || 0) + (used.spot.get(item.spotId) || 0) + 1;
      used.spot.set(item.spotId, (used.spot.get(item.spotId) || 0) + 1);
      return `${sp?.nameZh || item.spotId}_${n}`;
    }
    const p = jstParts(item.takenAt);
    const key = p ? p.mmdd.replace('/', '-') : 'photo';
    const n = (byDate.get(key) || 0) + (used.date.get(key) || 0) + 1;
    used.date.set(key, (used.date.get(key) || 0) + 1);
    return `${key}_${n}`;
  };
}

async function showCaptureSheet(items, source, opts) {
  const data = opts.data || {};
  const namer = await makeNamer(data);
  const multi = items.length > 1;
  const urls = [];
  const mkUrl = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };

  const overlay = document.createElement('div');
  overlay.className = 'cap-overlay';
  let body;
  if (!multi) {
    const it = items[0];
    it.name = namer(it);
    body = `
      <div class="cap-preview"><img alt="要加入的照片" src="${mkUrl(it.file)}"></div>
      <div data-row="0">${placePickerHtml(it, data)}</div>
      <label class="cap-field"><span class="k">檔名</span>
        <input data-name maxlength="80" value="${escapeHtml(it.name)}"></label>
      <label class="cap-field"><span class="k">備註（選填）</span>
        <input data-note maxlength="120" placeholder="這張想記什麼"></label>
      ${source === 'camera' && autoSaveEnabled() ? `<div class="small faint">這張也會存一份到手機的 Download 資料夾</div>` : ''}`;
  } else {
    body = `<div class="cap-multi">` + items.map((it, i) => {
      return `
        <div class="cap-mrow" data-row="${i}">
          <img class="cap-mthumb" alt="" src="${mkUrl(it.thumb)}">
          <div class="cap-mmain">
            ${placePickerHtml(it, data)}
            <input data-note maxlength="120" placeholder="備註（選填）">
          </div>
        </div>`;
    }).join('') + `</div>`;
  }

  overlay.innerHTML = `
    <div class="cap-sheet" role="dialog" aria-modal="true" aria-labelledby="capTitle">
      <div class="cap-head">
        <div class="cap-title" id="capTitle">${multi ? `加入 ${items.length} 張照片` : '命名這張'}</div>
        <button type="button" class="cap-close" aria-label="關閉">✕</button>
      </div>
      ${body}
      <div class="cap-actions">
        <button type="button" class="btn" data-r="0">取消</button>
        <button type="button" class="btn btn-primary" data-r="1" id="capSave">${multi ? '全部存起來' : '存起來'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('cap-open');

  items.forEach((it, i) => {
    const box = overlay.querySelector(`[data-row="${i}"]`);
    wirePlacePicker(box, it, data, () => {});
  });

  const saveBtn = overlay.querySelector('#capSave');
  return new Promise((resolve) => {
    function cleanup() {
      urls.forEach(u => URL.revokeObjectURL(u));
      overlay.remove();
      document.body.classList.remove('cap-open');
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(false); }
    async function close(saved) {
      if (saved) {
        if (saveBtn.dataset.busy === '1') return;
        saveBtn.dataset.busy = '1'; saveBtn.disabled = true;
        try {
          const now = new Date().toISOString();
          const rows = [];
          items.forEach((it, i) => {
            const box = overlay.querySelector(`[data-row="${i}"]`);
            const note = (multi ? box.querySelector('[data-note]') : overlay.querySelector('[data-note]')).value.trim();
            let name;
            if (!multi) name = (overlay.querySelector('[data-name]').value || it.name).trim() || it.name;
            else name = namer(it);
            rows.push({
              id: cryptoUUID(), name, note,
              spotId: it.spotId || null, day: it.day ?? null,
              ...(it.itemId ? { itemId: it.itemId } : {}),   // 今天以後的天才有；舊的照片和前面幾天不加這個欄位
              createdAt: now, takenAt: it.takenAt,
              blob: it.file, thumb: it.thumb, w: it.w, h: it.h,
              source: it.source, overlay: null, synced: false,
            });
          });
          for (const r of rows) await putJournal(r);
          window.dispatchEvent(new CustomEvent('journal-added', { detail: rows }));
          // 拍照的不會自動進相簿 → 存一份到手機的 Download
          if (source === 'camera' && autoSaveEnabled()) {
            const r = rows[0];
            const ext = /png/i.test(r.blob.type) ? 'png' : 'jpg';
            downloadBlob(r.blob, `${safeName(r.name)}.${ext}`);
          }
          toast(multi ? `已加入 ${rows.length} 張` : '已存起來');
        } catch (e) {
          alert('儲存失敗：' + (e.message || e));
          saveBtn.dataset.busy = ''; saveBtn.disabled = false;
          return;
        }
      }
      cleanup();
      resolve(saved);
    }
    overlay.querySelector('.cap-close').addEventListener('click', () => close(false));
    overlay.querySelector('button[data-r="0"]').addEventListener('click', () => close(false));
    saveBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);
  });
}

function cryptoUUID() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'j_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
