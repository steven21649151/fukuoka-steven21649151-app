// 手帳拍照流程：開相機 → resize → 命名 sheet → 存 IDB
import { escapeHtml } from './md.js';
import { putJournal, countJournalBySpot, isAvailable } from './db.js';
import { todayISO } from './nowitem.js';

const MAX_EDGE = 1600;
const JPEG_Q   = 0.8;

// opts: { spot?: { id, nameZh }, dayN?: number }
export async function openCapture(opts = {}) {
  const ok = await isAvailable();
  if (!ok) { alert('這個瀏覽器不允許儲存（可能是隱私模式）。手帳無法使用。'); return; }

  // 讓使用者選相機
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  // ⚠️ 一定要用 setAttribute。HTMLInputElement.capture 這個 IDL property 不是每個瀏覽器都實作，
  // 手機判斷「直接開相機」看的是 HTML 屬性——用 property 設在部分環境上會沒作用。
  input.setAttribute('capture', 'environment');
  input.style.display = 'none';
  document.body.appendChild(input);

  const file = await new Promise((res) => {
    input.addEventListener('change', () => res(input.files?.[0] || null), { once: true });
    // Safari 上 cancel 不會觸發 change，這裡沒辦法 100% 檢測——如果久了都沒回應就當作放棄
    input.click();
  });
  input.remove();
  if (!file) return;

  const { blob, w, h } = await resizeToBlob(file);
  await showNamingSheet({ blob, w, h, spot: opts.spot, dayN: opts.dayN });
}

// 把 File 縮到長邊 MAX_EDGE、輸出 JPEG q=0.8
async function resizeToBlob(file) {
  const bmpOrImg = await loadImage(file);
  const iw = bmpOrImg.width  ?? bmpOrImg.naturalWidth;
  const ih = bmpOrImg.height ?? bmpOrImg.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(iw, ih));
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmpOrImg, 0, 0, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_Q));
  bmpOrImg.close?.();
  return { blob, w, h };
}

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch { /* fall through */ }
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

async function showNamingSheet({ blob, w, h, spot, dayN }) {
  // 產生預填檔名
  let prefill;
  const today = todayISO();
  if (spot?.id) {
    const n = (await countJournalBySpot(spot.id)) + 1;
    prefill = `${spot.nameZh || spot.id}_${n}`;
  } else {
    // 規格 7.5：<MM-DD>_<流水號>，例 10-27_1
    const mmdd = today.slice(5);
    prefill = `${mmdd}_1`;
  }

  const previewUrl = URL.createObjectURL(blob);
  const overlay = document.createElement('div');
  overlay.className = 'cap-overlay';
  overlay.innerHTML = `
    <div class="cap-sheet" role="dialog" aria-modal="true" aria-labelledby="capTitle">
      <div class="cap-head">
        <div class="cap-title" id="capTitle">命名這張</div>
        <button type="button" class="cap-close" aria-label="關閉">✕</button>
      </div>
      <div class="cap-preview"><img alt="剛拍的照片" src="${previewUrl}"></div>
      <label class="cap-field">
        <span class="k">檔名</span>
        <input id="capName" maxlength="80" value="${escapeHtml(prefill)}">
      </label>
      <label class="cap-field">
        <span class="k">備註（選填）</span>
        <input id="capNote" maxlength="120" placeholder="這張想記什麼">
      </label>
      <div class="cap-actions">
        <button type="button" class="btn" data-r="0">取消</button>
        <button type="button" class="btn btn-primary" data-r="1" id="capSave">存起來</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('cap-open');

  const nameInput = overlay.querySelector('#capName');
  const noteInput = overlay.querySelector('#capNote');
  const closeBtn  = overlay.querySelector('.cap-close');
  const cancelBtn = overlay.querySelector('button[data-r="0"]');
  const saveBtn   = overlay.querySelector('#capSave');

  setTimeout(() => nameInput.focus({ preventScroll: true }), 30);

  return new Promise((resolve) => {
    function cleanup() {
      URL.revokeObjectURL(previewUrl);
      overlay.remove();
      document.body.classList.remove('cap-open');
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') { close(false); } }
    async function close(saved) {
      if (saved) {
        const name = (nameInput.value || prefill).trim() || prefill;
        const row = {
          id: cryptoUUID(),
          name,
          note: (noteInput.value || '').trim(),
          spotId: spot?.id || null,
          day: dayN ?? null,
          createdAt: new Date().toISOString(),
          blob, w, h,
          synced: false,
        };
        saveBtn.disabled = true;
        try { await putJournal(row); }
        catch (e) { alert('儲存失敗：' + (e.message || e)); saveBtn.disabled = false; return; }
        // 通知手帳頁重繪
        window.dispatchEvent(new CustomEvent('journal-added', { detail: row }));
      }
      cleanup();
      resolve(saved);
    }
    closeBtn.addEventListener('click', () => close(false));
    cancelBtn.addEventListener('click', () => close(false));
    saveBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);
  });
}

function cryptoUUID() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'j_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
