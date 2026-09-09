// 全螢幕大字卡：黑底白字、日文特大，把手機轉過去給店員看
// - 進場要 wakeLock（不支援就安靜略過）
// - Esc 或右上 ✕ 關閉
// - 左右滑或點兩側箭頭切換
// - 支援單一 phrase 或 phrase 陣列

let wakeLockRef = null;
let releaseFn = null;

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLockRef = await navigator.wakeLock.request('screen');
    }
  } catch {} // 拒絕或不支援 → 安靜略過
}
function releaseWakeLock() {
  try { wakeLockRef?.release?.(); } catch {}
  wakeLockRef = null;
}

// phrases: 一個 phrase 物件，或 phrase 陣列
// options: { startId?, all? } — all=true 且傳陣列時，可左右滑
export function openBigCard(phrases, options = {}) {
  const list = Array.isArray(phrases) ? phrases.slice() : [phrases];
  if (!list.length) return;

  let idx = 0;
  if (options.startId) {
    const i = list.findIndex(p => p && p.id === options.startId);
    if (i >= 0) idx = i;
  }

  // 已經有一張了 → 先關掉
  if (releaseFn) releaseFn();

  const overlay = document.createElement('div');
  overlay.className = 'bigcard';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = renderShell();
  document.body.appendChild(overlay);
  document.body.classList.add('bigcard-open');

  const zhEl     = overlay.querySelector('.bc-zh');
  const jaEl     = overlay.querySelector('.bc-ja');
  const romajiEl = overlay.querySelector('.bc-romaji');
  const idxEl    = overlay.querySelector('.bc-idx');
  const prevBtn  = overlay.querySelector('.bc-prev');
  const nextBtn  = overlay.querySelector('.bc-next');
  const closeBtn = overlay.querySelector('.bc-close');

  function paint() {
    const p = list[idx];
    if (!p) return;
    zhEl.textContent = p.zh || '';
    jaEl.textContent = p.ja || '';
    romajiEl.textContent = p.romaji || '';
    idxEl.textContent = list.length > 1 ? `${idx + 1} / ${list.length}` : '';
    prevBtn.hidden = list.length <= 1;
    nextBtn.hidden = list.length <= 1;
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx >= list.length - 1;
  }

  function go(delta) {
    const n = idx + delta;
    if (n < 0 || n >= list.length) return;
    idx = n; paint();
  }

  function close() {
    if (!releaseFn) return;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    overlay.removeEventListener('touchstart', onTouchStart);
    overlay.removeEventListener('touchend', onTouchEnd);
    releaseWakeLock();
    overlay.remove();
    document.body.classList.remove('bigcard-open');
    releaseFn = null;
  }
  releaseFn = close;

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); go(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1);  return; }
  }
  function onVis() {
    // 從背景回來時 wakeLock 常被系統釋放，再要一次
    if (document.visibilityState === 'visible' && !wakeLockRef) acquireWakeLock();
  }

  // 觸控滑動切換
  let touchX0 = null, touchY0 = null;
  function onTouchStart(e) {
    const t = e.changedTouches?.[0];
    if (!t) return;
    touchX0 = t.clientX; touchY0 = t.clientY;
  }
  function onTouchEnd(e) {
    const t = e.changedTouches?.[0];
    if (!t || touchX0 == null) return;
    const dx = t.clientX - touchX0;
    const dy = t.clientY - touchY0;
    touchX0 = touchY0 = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) go(1); else go(-1);
  }

  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVis);
  overlay.addEventListener('touchstart', onTouchStart, { passive: true });
  overlay.addEventListener('touchend', onTouchEnd, { passive: true });

  acquireWakeLock();
  paint();
}

function renderShell() {
  return `
    <button class="bc-close" type="button" aria-label="關閉大字卡">✕</button>
    <button class="bc-prev" type="button" aria-label="上一句" hidden>‹</button>
    <button class="bc-next" type="button" aria-label="下一句" hidden>›</button>
    <div class="bc-body">
      <div class="bc-zh"></div>
      <div class="bc-ja" lang="ja"></div>
      <div class="bc-romaji"></div>
    </div>
    <div class="bc-idx"></div>
  `;
}
