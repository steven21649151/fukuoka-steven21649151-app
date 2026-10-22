// 拼貼：版型、排版、繪製。只由「🧩 拼貼」按鈕手動觸發（一天或一個景點）。
// 照片鋪滿整張（沒有標題列、沒有印章），要加字就用「✍️ 加字」自己找位置放。
import { ensureFonts, analyze, srcW, srcH, freeCanvas, computeAuto, drawOverlay } from './overlay.js';

export const RATIOS = {
  '4:5':  { w: 1080, h: 1350, label: '4:5' },
  '9:16': { w: 1080, h: 1920, label: '9:16 限動' },
  '1:1':  { w: 1080, h: 1080, label: '1:1' },
};
export const OUT_SCALE = 2;          // 輸出 2 倍解析度（寬 2160）
export const MAX_PHOTOS = 9;
const BG = '#FCFBF7';                // 只在格線露出

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
  // 7、8 張：最後一列的照片橫跨補滿，不留空格
  7: [{ ...G3, cells: [...row3.slice(0, 6), [0, 2, 3, 1]] }],
  8: [{ ...G3, cells: [...row3.slice(0, 7), [1, 2, 2, 1]] }],
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
  return tpl.cells.map(rectOf);
}

// 回傳 { cells: [{x,y,w,h}], gap }。照片鋪滿：四邊與格線間距都是 W * 0.012
export function computeLayout(n, variant, W, H) {
  const list = TEMPLATES[n] || TEMPLATES[1];
  const tpl = list[((variant % list.length) + list.length) % list.length];
  const g = W * 0.012;
  const area = { x: g, y: g, w: W - 2 * g, h: H - 2 * g };
  return { cells: gridRects(tpl, area, g), gap: g };
}

// ---------- 繪製 ----------
function drawCover(ctx, src, r) {
  const iw = srcW(src), ih = srcH(src);
  const sc = Math.max(r.w / iw, r.h / ih);
  const sw = r.w / sc, sh = r.h / sc;
  ctx.drawImage(src, (iw - sw) / 2, (ih - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
}

// spec: { W, H, n, variant, getBitmap: async (index, cellRect) => bitmap, release?: bool,
//         text?: { row, st, data } }   ← text 有給才加字（st 是加字編輯器的狀態）
// 回傳 { cells, gap, text: { eff, last } | null }（編輯器用來做點選交換、拖曳字、算自動顏色）
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
  lay.text = null;
  if (spec.text) {
    const { row, st, data } = spec.text;
    // 自動位置／顏色都看「整張拼貼畫好之後」的樣子；換比例、版型、交換格子後會重新算
    const an = analyze(canvas);
    const eff = st.auto
      ? computeAuto(row, data, an, W, H, { showDate: st.showDate, showSpot: st.showSpot, metaMode: st.metaMode, shadow: st.shadow, size: st.size })
      : st;
    const last = drawOverlay(ctx, W, H, row, { ...eff, color: st.color, band: st.band, shadow: st.shadow, showDate: st.showDate, showSpot: st.showSpot, metaMode: st.metaMode, size: st.size }, data, an);
    lay.text = { eff, last };
  }
  return lay;
}

export { freeCanvas };
