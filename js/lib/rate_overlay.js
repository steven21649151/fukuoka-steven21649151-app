// 💱 匯率浮層——不是整頁跳轉，就地換算
import { yen, twdExact } from './fmt.js';
import { getRate, onChange as onRateChange, formatFetchedAt } from './rate.js';

let releaseFn = null;

export function openRateOverlay(ctx) {
  if (releaseFn) releaseFn();
  const overlay = document.createElement('div');
  overlay.className = 'rate-overlay';
  overlay.innerHTML = `
    <div class="ro-sheet" role="dialog" aria-modal="true" aria-labelledby="roTitle">
      <div class="ro-head">
        <div class="ro-title" id="roTitle">💱 匯率換算</div>
        <button type="button" class="ro-close" aria-label="關閉">✕</button>
      </div>
      <div class="ro-source" id="roSource"></div>
      <div class="ro-line">
        <label class="ro-field">
          <span>¥</span>
          <input id="roJpy" inputmode="decimal" placeholder="日圓">
        </label>
        <span class="ro-arrow">≈</span>
        <label class="ro-field">
          <span>NT$</span>
          <input id="roTwd" inputmode="decimal" placeholder="台幣">
        </label>
      </div>
      <div class="ro-tip" id="roTip"></div>
      <div class="ro-actions">
        <a class="btn" href="#/tools/rate">匯率頁 · 手動覆寫 →</a>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('ro-open');

  const jpyInput = overlay.querySelector('#roJpy');
  const twdInput = overlay.querySelector('#roTwd');
  const sourceEl = overlay.querySelector('#roSource');
  const tipEl    = overlay.querySelector('#roTip');
  const closeBtn = overlay.querySelector('.ro-close');

  function paintSource() {
    const r = getRate();
    sourceEl.innerHTML = renderSource(r);
    tipEl.textContent = r.tag === 'live' || r.tag === 'stale'
      ? '即期參考匯率，實際換鈔以銀行現金賣出為準，通常略差 1–2%。'
      : '';
    // 有輸入的話重算
    if (jpyInput.value) jpyInput.dispatchEvent(new Event('input'));
    else if (twdInput.value) twdInput.dispatchEvent(new Event('input'));
  }

  jpyInput.addEventListener('input', () => {
    const v = parseFloat(jpyInput.value);
    if (isNaN(v)) { twdInput.value = ''; return; }
    twdInput.value = twdExact(v, getRate().jpyToTwd).replace('NT$', '');
  });
  twdInput.addEventListener('input', () => {
    const v = parseFloat(twdInput.value);
    if (isNaN(v)) { jpyInput.value = ''; return; }
    jpyInput.value = yen(v / getRate().jpyToTwd).replace('¥', '').replace(/,/g, '');
  });

  function close() {
    if (!releaseFn) return;
    document.removeEventListener('keydown', onKey);
    overlay.removeEventListener('click', onOverlayClick);
    off();
    overlay.remove();
    document.body.classList.remove('ro-open');
    releaseFn = null;
  }
  releaseFn = close;

  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  function onOverlayClick(e) { if (e.target === overlay) close(); }
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', onOverlayClick);
  const off = onRateChange(paintSource);

  paintSource();
  setTimeout(() => jpyInput.focus(), 30);
}

function renderSource(r) {
  const rateStr = `¥1 = NT$${r.jpyToTwd.toFixed(4)}`;
  let tag = '';
  if (r.tag === 'override') tag = `<span class="ro-tag override">手動</span>`;
  else if (r.tag === 'live') tag = `<span class="ro-tag live">即時 · ${formatFetchedAt(r.asOf)}</span>`;
  else if (r.tag === 'stale') tag = `<span class="ro-tag stale">舊值</span>`;
  else tag = `<span class="ro-tag base">基準</span>`;
  return `<span class="ro-src-line"><b>${rateStr}</b> ${tag}<span class="ro-src-name">${r.source || ''}</span></span>`;
}
