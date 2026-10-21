// 加字編輯器：全螢幕預覽、拖曳／雙指縮放／滑桿、顏色、底帶、陰影、第二行、對齊、重設
// 預覽與輸出共用 overlay.js 的 drawOverlay，座標都用「相對圖片寬高的比例」，所以看到的位置就是輸出的位置。
import { escapeHtml } from '../lib/md.js';
import { putJournal } from '../lib/db.js';
import {
  ensureFonts, loadBitmap, analyze, srcW, srcH, freeCanvas,
  drawOverlay, computeAuto, defaultOverlay, INK, WHITE,
} from '../lib/overlay.js';

const COLORS = [
  { v: 'auto',    label: '自動', swatch: 'conic-gradient(#fff 0 50%, #2B2622 0)' },
  { v: WHITE,     label: '白',   swatch: '#FFFFFF' },
  { v: INK,       label: '墨',   swatch: '#2B2622' },
  { v: '#C4452F', label: '朱',   swatch: '#C4452F' },
  { v: '#C9A227', label: '金',   swatch: '#C9A227' },
  { v: '#FCFBF7', label: '米',   swatch: '#FCFBF7' },
];
const SIZE_MIN = 0.03, SIZE_MAX = 0.12;

// onSaved(row) 在按「完成」存進 IDB 之後呼叫
export async function openOverlayEditor(row, data, onSaved) {
  await ensureFonts();
  const bmp = await loadBitmap(row.blob, 1600, row.w, row.h);
  const an = analyze(bmp);
  const iw = srcW(bmp), ih = srcH(bmp);

  // 工作中的狀態
  const base = row.overlay ? { ...defaultOverlay(), ...row.overlay } : defaultOverlay();
  const st = { ...base, auto: row.overlay ? !!row.overlay.auto : true };
  if (st.auto) { st.color = 'auto'; st.band = 'auto'; }
  let note = row.note || '';
  let last = null;       // 最近一次畫出來的 { box, ... }（canvas 像素）
  let eff = null;        // 最近一次實際使用的 overlay（auto 時是算出來的）

  const root = document.createElement('div');
  root.className = 'ove-overlay';
  root.innerHTML = `
    <div class="ove-head">
      <button type="button" class="btn" data-a="cancel">取消</button>
      <div class="ove-title">加字</div>
      <button type="button" class="btn btn-primary" data-a="done">完成</button>
    </div>
    <div class="ove-stage"><canvas class="ove-canvas"></canvas></div>
    <div class="ove-tools">
      <input class="ove-note" maxlength="120" placeholder="備註（會壓在照片上）" value="${escapeHtml(note)}">
      <label class="ove-size"><span>字級</span>
        <input type="range" min="${SIZE_MIN * 100}" max="${SIZE_MAX * 100}" step="0.1" value="${st.size * 100}">
      </label>
      <div class="ove-row ove-colors" role="group" aria-label="文字顏色">
        ${COLORS.map(c => `<button type="button" class="ove-chip" data-color="${c.v}" aria-label="${c.label}"><i style="background:${c.swatch}"></i>${c.label}</button>`).join('')}
      </div>
      <div class="ove-row">
        <button type="button" class="ove-tg" data-tg="band">底帶</button>
        <button type="button" class="ove-tg" data-tg="shadow">陰影</button>
        <button type="button" class="ove-tg" data-tg="meta">日期·景點</button>
        <span class="ove-sep"></span>
        <button type="button" class="ove-tg" data-align="left">左</button>
        <button type="button" class="ove-tg" data-align="center">中</button>
        <button type="button" class="ove-tg" data-align="right">右</button>
        <span class="ove-sep"></span>
        <button type="button" class="ove-tg" data-a="reset">↺ 自動</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('cap-open');

  const stage = root.querySelector('.ove-stage');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const noteInput = root.querySelector('.ove-note');
  const slider = root.querySelector('.ove-size input');
  let cw = 0, ch = 0, raf = 0, closed = false;

  function fit() {
    const maxW = stage.clientWidth, maxH = stage.clientHeight;
    const s = Math.min(maxW / iw, maxH / ih);
    const dispW = Math.max(40, Math.floor(iw * s)), dispH = Math.max(40, Math.floor(ih * s));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = dispW + 'px';
    canvas.style.height = dispH + 'px';
    cw = Math.round(dispW * dpr); ch = Math.round(dispH * dpr);
    canvas.width = cw; canvas.height = ch;
  }

  function rowNow() { return { ...row, note }; }

  function draw() {
    raf = 0;
    if (closed || !cw) return;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(bmp, 0, 0, cw, ch);
    const r = rowNow();
    eff = st.auto
      ? computeAuto(r, data, an, cw, ch, { meta: st.meta, shadow: st.shadow, size: st.size })
      : st;
    last = drawOverlay(ctx, cw, ch, r, { ...eff, color: st.color, band: st.band, shadow: st.shadow, meta: st.meta, size: st.size }, data, an);
    syncTools();
  }
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

  function syncTools() {
    root.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', b.dataset.color === st.color));
    const bandOn = last ? last.band : false;
    root.querySelector('[data-tg="band"]').classList.toggle('on', st.band === 'auto' ? bandOn : !!st.band);
    root.querySelector('[data-tg="shadow"]').classList.toggle('on', st.shadow !== false);
    root.querySelector('[data-tg="meta"]').classList.toggle('on', st.meta !== false);
    const al = (eff && eff.align) || st.align;
    root.querySelectorAll('[data-align]').forEach(b => b.classList.toggle('on', b.dataset.align === al));
    root.querySelector('[data-a="reset"]').classList.toggle('on', !!st.auto);
    slider.value = String(st.size * 100);
  }

  // 第一次動手調整時，把自動算出的位置固定下來
  function freeze() {
    if (!st.auto) return;
    if (eff) { st.x = eff.x; st.y = eff.y; st.align = eff.align; }
    st.auto = false;
  }

  // ---- 拖曳／雙指縮放 ----
  const pointers = new Map();
  let drag = null, pinch = null;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      freeze();
      drag = { sx: e.clientX, sy: e.clientY, ox: st.x, oy: st.y };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, size0: st.size };
      drag = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      st.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, pinch.size0 * d / pinch.d0));
      redraw();
    } else if (drag) {
      const rect = canvas.getBoundingClientRect();
      st.x = Math.min(1, Math.max(0, drag.ox + (e.clientX - drag.sx) / rect.width));
      st.y = Math.min(1, Math.max(0, drag.oy + (e.clientY - drag.sy) / rect.height));
      redraw();
    }
  });
  const endPtr = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) drag = null;
    else if (pointers.size === 1 && !drag) {      // 縮放結束、剩一指 → 接著拖
      const p = [...pointers.values()][0];
      drag = { sx: p.x, sy: p.y, ox: st.x, oy: st.y };
    }
  };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);

  // ---- 工具列 ----
  slider.addEventListener('input', () => { st.size = Number(slider.value) / 100; redraw(); });
  noteInput.addEventListener('input', () => { note = noteInput.value; redraw(); });

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.color) {
      if (t.dataset.color !== 'auto') freeze();
      st.color = t.dataset.color;
      if (st.auto && t.dataset.color === 'auto') { /* 仍是全自動 */ }
      redraw();
    } else if (t.dataset.tg === 'band') {
      freeze();
      st.band = !(st.band === 'auto' ? (last && last.band) : st.band);
      redraw();
    } else if (t.dataset.tg === 'shadow') { st.shadow = st.shadow === false; redraw(); }
    else if (t.dataset.tg === 'meta') { st.meta = st.meta === false; redraw(); }
    else if (t.dataset.align) {
      freeze();
      const b = last && last.box;
      st.align = t.dataset.align;
      if (b) st.x = (st.align === 'left' ? b.x : st.align === 'right' ? b.x + b.w : b.x + b.w / 2) / cw;
      redraw();
    } else if (t.dataset.a === 'reset') {
      Object.assign(st, defaultOverlay(), { auto: true });
      redraw();
    } else if (t.dataset.a === 'cancel') close(false);
    else if (t.dataset.a === 'done') close(true);
  });

  async function close(save) {
    if (closed) return;
    if (save) {
      const btn = root.querySelector('[data-a="done"]');
      btn.disabled = true;
      row.note = note.trim();
      row.overlay = st.auto
        ? { auto: true, x: eff?.x ?? st.x, y: eff?.y ?? st.y, size: st.size, color: 'auto', band: 'auto', shadow: st.shadow !== false, meta: st.meta !== false, align: eff?.align ?? st.align }
        : { auto: false, x: st.x, y: st.y, size: st.size, color: st.color, band: st.band, shadow: st.shadow !== false, meta: st.meta !== false, align: st.align };
      try { await putJournal(row); }
      catch (e) { alert('儲存失敗：' + (e.message || e)); btn.disabled = false; return; }
    }
    closed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    bmp.close?.();
    freeCanvas(canvas);
    root.remove();
    document.body.classList.remove('cap-open');
    if (save) onSaved?.(row);
  }
  const onResize = () => { fit(); redraw(); };
  window.addEventListener('resize', onResize);

  fit();
  draw();
}
