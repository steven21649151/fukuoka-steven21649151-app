// 加字編輯器：全螢幕預覽、拖曳／雙指縮放／滑桿、8 色、底帶、陰影、📅 日期／📍 景點、換行／接在後面、對齊、重設
// 預覽與輸出共用 overlay.js 的 drawOverlay，座標都用「相對圖片寬高的比例」，所以看到的位置就是輸出的位置。
// 控制項（toolsHtml／wireOverlayTools）也給拼貼的「✍️ 加字」共用。
import { escapeHtml } from '../lib/md.js';
import { putJournal } from '../lib/db.js';
import {
  ensureFonts, loadBitmap, analyze, srcW, srcH, freeCanvas,
  drawOverlay, computeAuto, normalizeOverlay, defaultOverlay, hasSpotText,
  INK, WHITE, SIZE_MIN, SIZE_MAX, clampSize,
} from '../lib/overlay.js';

export const COLORS = [
  { v: 'auto',    label: '自動', swatch: 'conic-gradient(#fff 0 50%, #2B2622 0)' },
  { v: WHITE,     label: '白',   swatch: '#FFFFFF' },
  { v: INK,       label: '墨',   swatch: '#2B2622' },
  { v: '#C4452F', label: '朱',   swatch: '#C4452F' },
  { v: '#C9A227', label: '金',   swatch: '#C9A227' },
  { v: '#2F5D8A', label: '藍',   swatch: '#2F5D8A' },
  { v: '#3F7A4E', label: '綠',   swatch: '#3F7A4E' },
  { v: '#FCFBF7', label: '米',   swatch: '#FCFBF7' },
];

// ---------------------------------------------------------------
// 控制項 HTML
export function toolsHtml({ note = '', notePlaceholder = '備註（會壓在照片上）', size = 0.09 } = {}) {
  return `
    <input class="ove-note" maxlength="120" placeholder="${escapeHtml(notePlaceholder)}" value="${escapeHtml(note)}">
    <label class="ove-size"><span>字級</span>
      <input type="range" min="${SIZE_MIN * 100}" max="${SIZE_MAX * 100}" step="0.1" value="${size * 100}">
    </label>
    <div class="ove-row ove-colors" role="group" aria-label="文字顏色">
      ${COLORS.map(c => `<button type="button" class="ove-chip" data-color="${c.v}" aria-label="${c.label}"><i style="background:${c.swatch}"></i>${c.label}</button>`).join('')}
    </div>
    <div class="ove-row">
      <button type="button" class="ove-tg" data-tg="band">底帶</button>
      <button type="button" class="ove-tg" data-tg="shadow">陰影</button>
      <span class="ove-sep"></span>
      <button type="button" class="ove-tg" data-tg="date">📅 日期</button>
      <button type="button" class="ove-tg" data-tg="spot">📍 景點</button>
      <span class="ove-sep"></span>
      <button type="button" class="ove-tg" data-mode="newline">↵ 換行</button>
      <button type="button" class="ove-tg" data-mode="inline">· 接在後面</button>
    </div>
    <div class="ove-row">
      <button type="button" class="ove-tg" data-align="left">左</button>
      <button type="button" class="ove-tg" data-align="center">中</button>
      <button type="button" class="ove-tg" data-align="right">右</button>
      <span class="ove-sep"></span>
      <button type="button" class="ove-tg" data-a="reset">↺ 自動</button>
    </div>`;
}

// ---------------------------------------------------------------
// 把控制項接到狀態上。ctl：
//   st            工作中的 overlay 狀態（會被直接修改）
//   getNote/setNote
//   redraw()      重畫預覽
//   getEff()      最近一次實際使用的 overlay（auto 時是算出來的位置）
//   getLast()     最近一次畫出來的 { box, band }（canvas 像素）
//   getCw()       canvas 寬（像素）
//   hasSpot()     這張有沒有景點可加
// 回傳 { sync, destroy }
export function wireOverlayTools(root, ctl) {
  const st = ctl.st;
  const slider = root.querySelector('.ove-size input');
  const noteInput = root.querySelector('.ove-note');

  function freeze() {
    if (!st.auto) return;
    const eff = ctl.getEff();
    if (eff) { st.x = eff.x; st.y = eff.y; st.align = eff.align; }
    st.auto = false;
  }

  function sync() {
    const last = ctl.getLast();
    const eff = ctl.getEff();
    root.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', b.dataset.color === st.color));
    root.querySelector('[data-tg="band"]').classList.toggle('on', st.band === 'auto' ? !!(last && last.band) : !!st.band);
    root.querySelector('[data-tg="shadow"]').classList.toggle('on', st.shadow !== false);
    const hasSpot = ctl.hasSpot();
    const dateBtn = root.querySelector('[data-tg="date"]');
    const spotBtn = root.querySelector('[data-tg="spot"]');
    dateBtn.classList.toggle('on', st.showDate !== false);
    spotBtn.classList.toggle('on', hasSpot && st.showSpot !== false);
    spotBtn.disabled = !hasSpot;
    const anyMeta = st.showDate !== false || (hasSpot && st.showSpot !== false);
    root.querySelectorAll('[data-mode]').forEach(b => {
      b.disabled = !anyMeta;
      b.classList.toggle('on', anyMeta && b.dataset.mode === st.metaMode);
    });
    const al = (eff && eff.align) || st.align;
    root.querySelectorAll('[data-align]').forEach(b => b.classList.toggle('on', b.dataset.align === al));
    root.querySelector('[data-a="reset"]').classList.toggle('on', !!st.auto);
    slider.value = String(clampSize(st.size) * 100);
  }

  const onSlider = () => { st.size = clampSize(Number(slider.value) / 100); ctl.redraw(); };
  const onNote = () => { ctl.setNote(noteInput.value); ctl.redraw(); };
  slider.addEventListener('input', onSlider);
  noteInput.addEventListener('input', onNote);

  const onClick = (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled || !root.contains(t)) return;
    if (t.dataset.color) {
      if (t.dataset.color !== 'auto') freeze();
      st.color = t.dataset.color;
      ctl.redraw();
    } else if (t.dataset.tg === 'band') {
      const last = ctl.getLast();
      freeze();
      st.band = !(st.band === 'auto' ? !!(last && last.band) : st.band);
      ctl.redraw();
    } else if (t.dataset.tg === 'shadow') { st.shadow = st.shadow === false; ctl.redraw(); }
    else if (t.dataset.tg === 'date') { st.showDate = st.showDate === false; ctl.redraw(); }
    else if (t.dataset.tg === 'spot') { st.showSpot = st.showSpot === false; ctl.redraw(); }
    else if (t.dataset.mode) { st.metaMode = t.dataset.mode; ctl.redraw(); }
    else if (t.dataset.align) {
      freeze();
      const b = ctl.getLast() && ctl.getLast().box;
      st.align = t.dataset.align;
      if (b) st.x = (st.align === 'left' ? b.x : st.align === 'right' ? b.x + b.w : b.x + b.w / 2) / ctl.getCw();
      ctl.redraw();
    } else if (t.dataset.a === 'reset') {
      Object.assign(st, defaultOverlay(), { auto: true });
      ctl.redraw();
    }
  };
  root.addEventListener('click', onClick);
  return {
    sync,
    destroy() {
      root.removeEventListener('click', onClick);
      slider.removeEventListener('input', onSlider);
      noteInput.removeEventListener('input', onNote);
    },
  };
}

// 拖曳（單指）與雙指縮放。enabled() 回 false 時不處理（拼貼沒開加字時點格子是交換）
export function attachTextPointer(canvas, st, { redraw, freeze, enabled = () => true }) {
  const pointers = new Map();
  let drag = null, pinch = null;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    if (!enabled()) return;
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
      st.size = clampSize(pinch.size0 * d / pinch.d0);
      redraw();
    } else if (drag) {
      const rect = canvas.getBoundingClientRect();
      st.x = Math.min(1, Math.max(0, drag.ox + (e.clientX - drag.sx) / rect.width));
      st.y = Math.min(1, Math.max(0, drag.oy + (e.clientY - drag.sy) / rect.height));
      redraw();
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) drag = null;
    else if (pointers.size === 1 && !drag) {      // 縮放結束、剩一指 → 接著拖
      const p = [...pointers.values()][0];
      drag = { sx: p.x, sy: p.y, ox: st.x, oy: st.y };
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------
// onSaved(row) 在按「完成」存進 IDB 之後呼叫
export async function openOverlayEditor(row, data, onSaved) {
  await ensureFonts();
  const bmp = await loadBitmap(row.blob, 1600, row.w, row.h);
  const an = analyze(bmp);
  const iw = srcW(bmp), ih = srcH(bmp);

  // 工作中的狀態（舊資料的 meta、過小的 size 在 normalize 時處理）
  const st = normalizeOverlay(row.overlay);
  st.auto = row.overlay ? !!row.overlay.auto : true;
  if (st.auto) { st.color = 'auto'; st.band = 'auto'; }
  let note = row.note || '';
  let last = null;       // 最近一次畫出來的 { box, band, ... }（canvas 像素）
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
    <div class="ove-tools">${toolsHtml({ note, size: st.size })}</div>`;
  document.body.appendChild(root);
  document.body.classList.add('cap-open');

  const stage = root.querySelector('.ove-stage');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
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
  const rowNow = () => ({ ...row, note });

  let tools = null;
  function draw() {
    raf = 0;
    if (closed || !cw) return;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(bmp, 0, 0, cw, ch);
    const r = rowNow();
    eff = st.auto
      ? computeAuto(r, data, an, cw, ch, { showDate: st.showDate, showSpot: st.showSpot, metaMode: st.metaMode, shadow: st.shadow, size: st.size })
      : st;
    last = drawOverlay(ctx, cw, ch, r, { ...eff, color: st.color, band: st.band, shadow: st.shadow, showDate: st.showDate, showSpot: st.showSpot, metaMode: st.metaMode, size: st.size }, data, an);
    tools?.sync();
  }
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

  function freeze() {
    if (!st.auto) return;
    if (eff) { st.x = eff.x; st.y = eff.y; st.align = eff.align; }
    st.auto = false;
  }

  tools = wireOverlayTools(root.querySelector('.ove-tools'), {
    st, redraw,
    getNote: () => note, setNote: (v) => { note = v; },
    getEff: () => eff, getLast: () => last, getCw: () => cw,
    hasSpot: () => hasSpotText(row, data),
  });
  attachTextPointer(canvas, st, { redraw, freeze });

  root.querySelector('.ove-head').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') close(false);
    else if (a === 'done') close(true);
  });

  async function close(save) {
    if (closed) return;
    if (save) {
      const btn = root.querySelector('[data-a="done"]');
      btn.disabled = true;
      row.note = note.trim();
      const flags = { shadow: st.shadow !== false, showDate: st.showDate !== false, showSpot: st.showSpot !== false, metaMode: st.metaMode, size: st.size };
      row.overlay = st.auto
        ? { auto: true, x: eff?.x ?? st.x, y: eff?.y ?? st.y, color: 'auto', band: 'auto', align: eff?.align ?? st.align, ...flags }
        : { auto: false, x: st.x, y: st.y, color: st.color, band: st.band, align: st.align, ...flags };
      try { await putJournal(row); }
      catch (e) { alert('儲存失敗：' + (e.message || e)); btn.disabled = false; return; }
    }
    closed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    tools.destroy();
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
