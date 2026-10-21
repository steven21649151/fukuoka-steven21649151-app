// 拼貼：版型、排版、繪製。只由「🧩 拼貼」按鈕手動觸發（一天或一個景點）。
import { FONT_FAMILY, srcW, srcH, ensureFonts, roundRect } from './overlay.js';

export const RATIOS = {
  '4:5':  { w: 1080, h: 1350, label: '4:5' },
  '9:16': { w: 1080, h: 1920, label: '9:16 限動' },
  '1:1':  { w: 1080, h: 1080, label: '1:1' },
};
export const OUT_SCALE = 2;          // 輸出 2 倍解析度（寬 2160）
export const MAX_PHOTOS = 9;
const BG = '#FCFBF7';
const INK = '#2B2622';
const INK2 = '#6B625A';
const VERMILION = '#C4452F';

// cells: [col, row, colSpan, rowSpan]；cols／rows 是權重
const G3 = { cols: [1, 1, 1], rows: [1, 1, 1] };
const row3 = [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]];
const TEMPLATES = {
  1: [{ cols: [1], rows: [1], cells: [[0, 0, 1, 1]] }],
  2: [
    { cols: [1], rows: [1, 1], cells: [[0, 0, 1, 1], [0, 1, 1, 1]] },                         // 上下二分
    { cols: [1, 1], rows: [1], cells: [[0, 0, 1, 1], [1, 0, 1, 1]] },                         // 左右二分
  ],
  3: [
    { cols: [1, 1], rows: [2, 1], cells: [[0, 0, 2, 1], [0, 1, 1, 1], [1, 1, 1, 1]] },        // 上大下二
    { cols: [2, 1], rows: [1, 1], cells: [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1]] },        // 左大右二
    { cols: [1, 1, 1], rows: [1], cells: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1]] },        // 三等分
  ],
  4: [
    { cols: [1, 1], rows: [1, 1], cells: [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]] },   // 2×2
    { cols: [1, 1, 1], rows: [2, 1], cells: [[0, 0, 3, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1]] }, // 上大下三
  ],
  5: [
    { cols: [1, 1, 1, 1], rows: [2, 1], cells: [[0, 0, 4, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1]] },   // 上大下四
    { cols: [1, 1, 1, 1, 1, 1], rows: [1, 1], cells: [[0, 0, 3, 1], [3, 0, 3, 1], [0, 1, 2, 1], [2, 1, 2, 1], [4, 1, 2, 1]] }, // 上二下三
  ],
  6: [
    { cols: [1, 1], rows: [1, 1, 1], cells: [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1]] },   // 2×3
    { cols: [1, 1, 1], rows: [1, 1], cells: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1]] },   // 3×2
  ],
  7: [{ ...G3, cells: row3.slice(0, 7), titleCell: [1, 2, 2, 1] }],     // 3×3，空格放標題卡
  8: [{ ...G3, cells: row3.slice(0, 8), titleCell: [2, 2, 1, 1] }],
  9: [{ ...G3, cells: row3 }],
};

export function variantCount(n) { return (TEMPLATES[n] || []).length; }

// ---------- 幾何 ----------
function gridRects(tpl, area, g) {
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const cw = tpl.cols.map(w => (area.w - g * (tpl.cols.length - 1)) * w / sum(tpl.cols));
  const rh = tpl.rows.map(h => (area.h - g * (tpl.rows.length - 1)) * h / sum(tpl.rows));
  const rectOf = ([c, r, cs, rs]) => {
    let x = area.x + g * c, y = area.y + g * r;
    for (let i = 0; i < c; i++) x += cw[i];
    for (let i = 0; i < r; i++) y += rh[i];
    let w = g * (cs - 1), h = g * (rs - 1);
    for (let i = c; i < c + cs; i++) w += cw[i];
    for (let i = r; i < r + rs; i++) h += rh[i];
    return { x, y, w, h };
  };
  return { cells: tpl.cells.map(rectOf), titleRect: tpl.titleCell ? rectOf(tpl.titleCell) : null };
}

// 回傳 { cells: [{x,y,w,h}], titleRect, titleMode: 'strip'|'cell' }
export function computeLayout(n, variant, W, H) {
  const list = TEMPLATES[n] || TEMPLATES[1];
  const tpl = list[((variant % list.length) + list.length) % list.length];
  const g = W * 0.012;
  if (tpl.titleCell) {
    const area = { x: g, y: g, w: W - 2 * g, h: H - 2 * g };
    const r = gridRects(tpl, area, g);
    return { cells: r.cells, titleRect: r.titleRect, titleMode: 'cell', gap: g };
  }
  const hh = W * 0.15;
  const strip = { x: g, y: g, w: W - 2 * g, h: hh };
  const top = g + hh + g;
  const area = { x: g, y: top, w: W - 2 * g, h: H - top - g };
  const r = gridRects(tpl, area, g);
  return { cells: r.cells, titleRect: strip, titleMode: 'strip', gap: g };
}

// ---------- 繪製 ----------
function wrap(ctx, text, maxW, maxLines = 3) {
  const out = [];
  let cur = '';
  for (const ch of text) {
    if (cur && ctx.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch; }
    else cur += ch;
  }
  out.push(cur);
  if (out.length > maxLines) { const c = out.slice(0, maxLines); c[maxLines - 1] = c[maxLines - 1].replace(/.$/, '…'); return c; }
  return out;
}

function fitOneLine(ctx, text, weight, maxW, startPx, minPx) {
  let px = startPx;
  ctx.font = `${weight} ${px}px ${FONT_FAMILY}`;
  while (px > minPx && ctx.measureText(text).width > maxW) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${FONT_FAMILY}`;
  }
  return px;
}

function drawStamp(ctx, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-6 * Math.PI / 180);
  ctx.fillStyle = VERMILION;
  roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.12);
  ctx.fill();
  ctx.fillStyle = BG;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${s * 0.36}px ${FONT_FAMILY}`;
  ctx.fillText('福岡', 0, -s * 0.15);
  ctx.font = `700 ${s * 0.27}px ${FONT_FAMILY}`;
  ctx.fillText('2026', 0, s * 0.22);
  ctx.restore();
}

function drawTitle(ctx, rect, mode, title, W) {
  ctx.save();
  ctx.fillStyle = BG;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  if (mode === 'strip') {
    const s = Math.min(rect.h * 0.78, W * 0.115);
    const padL = rect.w * 0.02;
    const textW = rect.w - s - padL * 3;
    const px1 = fitOneLine(ctx, title.line1, 700, textW, rect.h * 0.42, rect.h * 0.22);
    const px2 = px1 * 0.62;
    const hasL2 = !!title.line2;
    const blockH = px1 * 1.15 + (hasL2 ? px2 * 1.35 : 0);
    let y = rect.y + (rect.h - blockH) / 2 + px1 * 0.95;
    ctx.fillStyle = INK; ctx.font = `700 ${px1}px ${FONT_FAMILY}`;
    ctx.fillText(title.line1, rect.x + padL, y);
    if (hasL2) {
      y += px2 * 1.45;
      const p2 = fitOneLine(ctx, title.line2, 400, textW, px2, px2 * 0.6);
      ctx.fillStyle = INK2; ctx.font = `400 ${p2}px ${FONT_FAMILY}`;
      ctx.fillText(title.line2, rect.x + padL, y);
    }
    drawStamp(ctx, rect.x + rect.w - s / 2 - padL, rect.y + rect.h / 2, s);
  } else {
    // 3×3 空格裡的標題卡：文字靠左上、印章在右下
    const pad = Math.min(rect.w, rect.h) * 0.1;
    const s = Math.min(rect.w, rect.h) * 0.42;
    const px1 = Math.min(rect.h * 0.16, rect.w * 0.12);
    ctx.fillStyle = INK; ctx.font = `700 ${px1}px ${FONT_FAMILY}`;
    const lines = wrap(ctx, title.line1, rect.w - pad * 2, 3);
    let y = rect.y + pad + px1 * 0.9;
    for (const l of lines) { ctx.fillText(l, rect.x + pad, y); y += px1 * 1.25; }
    if (title.line2) {
      const px2 = px1 * 0.62;
      ctx.fillStyle = INK2; ctx.font = `400 ${px2}px ${FONT_FAMILY}`;
      ctx.fillText(title.line2, rect.x + pad, y + px2 * 0.2);
    }
    drawStamp(ctx, rect.x + rect.w - s / 2 - pad * 0.6, rect.y + rect.h - s / 2 - pad * 0.6, s);
  }
  ctx.restore();
}

function drawCover(ctx, src, r) {
  const iw = srcW(src), ih = srcH(src);
  const sc = Math.max(r.w / iw, r.h / ih);
  const sw = r.w / sc, sh = r.h / sc;
  ctx.drawImage(src, (iw - sw) / 2, (ih - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
}

// spec: { W, H, n, variant, title:{line1,line2}, getBitmap: async (index, cellRect) => bitmap, release?: bool }
// 回傳 { cells, titleRect }（編輯器用來做點選交換）
export async function renderCollage(canvas, spec) {
  await ensureFonts();
  const { W, H } = spec;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const lay = computeLayout(spec.n, spec.variant, W, H);
  for (let i = 0; i < spec.n; i++) {
    const r = lay.cells[i];
    const bmp = await spec.getBitmap(i, r);
    if (bmp) {
      ctx.save();
      ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      drawCover(ctx, bmp, r);
      ctx.restore();
      if (spec.release) bmp.close?.();
    }
  }
  if (lay.titleRect) drawTitle(ctx, lay.titleRect, lay.titleMode, spec.title, W);
  return lay;
}
