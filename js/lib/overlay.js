// 照片疊字：自動位置、自動顏色、輸出加字版
// 原則：不破壞原圖。設定只存在 row.overlay，分享／匯出時才畫出加字版。
//
// overlay 格式（x, y 是文字區左上／中／右錨點相對圖片寬高的比例，size 是相對短邊的比例）：
//   { auto, x, y, size, color, band, shadow, meta, align }
//   color: 'auto' 或 '#RRGGBB'；band: true / false / 'auto'
import { jstParts } from './exif.js';

export const FONT_FAMILY = `'WenKaiTC', 'Noto Serif TC', 'PingFang TC', 'Microsoft JhengHei', serif`;
export const INK = '#2B2622';
export const WHITE = '#FFFFFF';
export const MAX_OUT_EDGE = 4096;
const OUT_QUALITY = 0.92;

// ---------- 字型 ----------
export async function ensureFonts() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all([
      document.fonts.load('400 48px WenKaiTC', '福岡文楷'),
      document.fonts.load('700 48px WenKaiTC', '福岡文楷'),
    ]);
  } catch { /* 字型載不到就用系統字 */ }
}

// ---------- 圖片載入 ----------
// 回傳已套用 EXIF 方向的 ImageBitmap（或 <img>）；長邊超過 maxLong 時盡量在解碼時就縮小
export async function loadBitmap(blob, maxLong = 0, w = 0, h = 0) {
  if ('createImageBitmap' in window) {
    if (maxLong && w && h && Math.max(w, h) > maxLong) {
      const s = maxLong / Math.max(w, h);
      try {
        const bmp = await createImageBitmap(blob, {
          imageOrientation: 'from-image',
          resizeWidth: Math.max(1, Math.round(w * s)),
          resizeHeight: Math.max(1, Math.round(h * s)),
          resizeQuality: 'high',
        });
        if (Math.abs(bmp.width / bmp.height - w / h) < 0.02) return bmp;
        bmp.close?.();
      } catch { /* 往下走完整解碼 */ }
    }
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* 往下 */ }
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}
export const srcW = (s) => s.width ?? s.naturalWidth;
export const srcH = (s) => s.height ?? s.naturalHeight;

export function freeCanvas(c) { if (c) { c.width = 0; c.height = 0; } }

// ---------- 縮圖分析（160px 寬）----------
export function analyze(src) {
  const sw = srcW(src), sh = srcH(src);
  const aw = 160;
  const ah = Math.max(8, Math.round(aw * sh / sw));
  const c = document.createElement('canvas');
  c.width = aw; c.height = ah;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, aw, ah);
  const rgb = g.getImageData(0, 0, aw, ah).data;
  freeCanvas(c);

  const lum = new Float32Array(aw * ah);
  for (let i = 0; i < aw * ah; i++) {
    lum[i] = (0.299 * rgb[i * 4] + 0.587 * rgb[i * 4 + 1] + 0.114 * rgb[i * 4 + 2]) / 255;
  }
  // Sobel 梯度強度：越大細節越多（通常是主體）
  const grad = new Float32Array(aw * ah);
  const L = (x, y) => lum[Math.min(ah - 1, Math.max(0, y)) * aw + Math.min(aw - 1, Math.max(0, x))];
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const gx = -L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1) + L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1);
      const gy = -L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1) + L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1);
      grad[y * aw + x] = Math.hypot(gx, gy);
    }
  }
  return { aw, ah, rgb, lum, grad };
}

// rect 是相對圖片的比例 { x0, y0, x1, y1 }
export function regionStats(an, rect) {
  const x0 = Math.max(0, Math.floor(rect.x0 * an.aw)), x1 = Math.min(an.aw, Math.max(x0 + 1, Math.ceil(rect.x1 * an.aw)));
  const y0 = Math.max(0, Math.floor(rect.y0 * an.ah)), y1 = Math.min(an.ah, Math.max(y0 + 1, Math.ceil(rect.y1 * an.ah)));
  let n = 0, grad = 0, lum = 0, r = 0, g = 0, b = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * an.aw + x;
      grad += an.grad[i]; lum += an.lum[i];
      r += an.rgb[i * 4]; g += an.rgb[i * 4 + 1]; b += an.rgb[i * 4 + 2];
      n++;
    }
  }
  if (!n) return { grad: 0, L: 0.5, rgb: [128, 128, 128] };
  return { grad: grad / n, L: lum / n, rgb: [r / n, g / n, b / n] };
}

// ---------- WCAG 對比 ----------
function relLum([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(rgbA, rgbB) {
  const a = relLum(rgbA), b = relLum(rgbB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------- 疊字內容 ----------
export function metaLine(row, data) {
  const p = jstParts(row.takenAt || row.createdAt || '');
  const parts = [];
  if (p) parts.push(p.mmdd);
  if (row.spotId) {
    const s = (data?.spots || []).find(x => x.id === row.spotId);
    parts.push(s ? (s.nameZh || s.name || row.spotId) : '');
  }
  return parts.filter(Boolean).join(' · ');
}

export function overlayTexts(row, data, ov) {
  const main = (row.note || '').trim();
  const meta = (!ov || ov.meta !== false) ? metaLine(row, data) : '';
  return { main, meta };
}

// 有沒有任何字要畫（沒有就輸出原圖）
export function hasOverlayText(row, data) {
  const { main, meta } = overlayTexts(row, data, row.overlay);
  return !!(main || meta);
}

export function defaultOverlay() {
  return { auto: true, x: 0.06, y: 0.88, size: 0.06, color: 'auto', band: 'auto', shadow: true, meta: true, align: 'left' };
}

// ---------- 排版 ----------
function wrapLines(ctx, text, maxW, maxLines) {
  const out = [];
  for (const para of text.split(/\r?\n/)) {
    let cur = '';
    for (const ch of para) {
      if (cur && ctx.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch; }
      else cur += ch;
    }
    out.push(cur);
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/.$/, '…');
    return cut;
  }
  return out;
}

// 算文字區大小（不含底帶內距）。回傳 null 表示沒有字
export function layoutText(ctx, row, data, ov, W, H) {
  const { main, meta } = overlayTexts(row, data, ov);
  if (!main && !meta) return null;
  const px = Math.max(8, ov.size * Math.min(W, H));
  const px2 = px * 0.55;
  const maxW = W * 0.88;
  const lh = 1.3;

  ctx.save();
  ctx.font = `700 ${px}px ${FONT_FAMILY}`;
  const mainLines = main ? wrapLines(ctx, main, maxW, 4) : [];
  let bw = 0;
  for (const l of mainLines) bw = Math.max(bw, ctx.measureText(l).width);

  ctx.font = `400 ${px2}px ${FONT_FAMILY}`;
  let metaText = meta;
  if (metaText) {
    while (metaText.length > 1 && ctx.measureText(metaText).width > maxW) metaText = metaText.slice(0, -1);
    if (metaText !== meta) metaText = metaText.slice(0, -1) + '…';
    bw = Math.max(bw, ctx.measureText(metaText).width);
  }
  ctx.restore();

  const gap = main && meta ? px * 0.1 : 0;
  const bh = mainLines.length * px * lh + (meta ? px2 * lh + gap : 0);
  return { mainLines, metaText, px, px2, lh, gap, bw, bh, pad: px * 0.4 };
}

// 把錨點換成文字區左上角，並夾在圖片裡
export function placeBox(lay, ov, W, H) {
  const pc = lay.pad;
  let left = ov.align === 'center' ? ov.x * W - lay.bw / 2 : ov.align === 'right' ? ov.x * W - lay.bw : ov.x * W;
  let top = ov.y * H;
  left = Math.min(Math.max(left, pc), Math.max(pc, W - pc - lay.bw));
  top = Math.min(Math.max(top, pc), Math.max(pc, H - pc - lay.bh));
  return { x: left, y: top, w: lay.bw, h: lay.bh };
}

// ---------- 自動位置 ＋ 自動顏色 ----------
const CANDIDATES = [   // 平手時的優先順序
  { key: 'BL', align: 'left',   row: 'bottom' },
  { key: 'BC', align: 'center', row: 'bottom' },
  { key: 'BR', align: 'right',  row: 'bottom' },
  { key: 'TL', align: 'left',   row: 'top' },
  { key: 'TR', align: 'right',  row: 'top' },
  { key: 'TC', align: 'center', row: 'top' },
];

export function computeAuto(row, data, an, W, H, base = {}) {
  const ov = { ...defaultOverlay(), ...base, auto: true, color: 'auto', band: 'auto' };
  const refW = 1000, refH = Math.max(1, Math.round(refW * H / W));
  const c = document.createElement('canvas'); c.width = 4; c.height = 4;
  const lay = layoutText(c.getContext('2d'), row, data, ov, refW, refH);
  freeCanvas(c);
  if (!lay) return ov;

  const fw = lay.bw / refW, fh = lay.bh / refH;
  const padX = lay.pad / refW, padY = lay.pad / refH;
  const mX = Math.max(0.04, padX), mY = Math.max(0.04, padY);
  let best = null;
  for (const cand of CANDIDATES) {
    const x = cand.align === 'left' ? mX : cand.align === 'right' ? 1 - mX : 0.5;
    const y = cand.row === 'bottom' ? 1 - mY - fh : mY;
    const left = cand.align === 'left' ? x : cand.align === 'right' ? x - fw : x - fw / 2;
    const st = regionStats(an, { x0: left, y0: y, x1: left + fw, y1: y + fh });
    if (!best || st.grad < best.st.grad - 1e-4) best = { cand, x, y, st };
  }
  ov.align = best.cand.align;
  ov.x = best.x;
  ov.y = best.y;
  return ov;
}

// 依文字框所在區塊決定顏色與底帶
export function resolveStyle(ov, an, box, W, H, pad) {
  let color = ov.color;
  let band = ov.band;
  let L = 0.5, rgb = [128, 128, 128];
  if (an) {
    const st = regionStats(an, { x0: (box.x - pad) / W, y0: (box.y - pad) / H, x1: (box.x + box.w + pad) / W, y1: (box.y + box.h + pad) / H });
    L = st.L; rgb = st.rgb;
  }
  if (color === 'auto' || !color) color = L > 0.6 ? INK : WHITE;
  if (band === 'auto') band = contrast(hexToRgb(color), rgb) < 4.5;
  return { color, band: !!band };
}

// ---------- 繪製（預覽與輸出共用）----------
// 回傳 { box, color, band }，編輯器用 box 做拖曳命中判斷
export function drawOverlay(ctx, W, H, row, ovIn, data, an) {
  const ov = { ...defaultOverlay(), ...(ovIn || {}) };
  const lay = layoutText(ctx, row, data, ov, W, H);
  if (!lay) return null;
  const box = placeBox(lay, ov, W, H);
  const { color, band } = resolveStyle(ov, an, box, W, H, lay.pad);
  const ink = color.toLowerCase() === INK.toLowerCase();
  const isLight = !ink && relLum(hexToRgb(color)) > 0.4;

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = ov.align === 'center' ? 'center' : ov.align === 'right' ? 'right' : 'left';
  const tx = ov.align === 'center' ? box.x + box.w / 2 : ov.align === 'right' ? box.x + box.w : box.x;

  if (band) {
    const p = lay.pad;
    ctx.fillStyle = isLight ? 'rgba(0,0,0,.35)' : 'rgba(252,251,247,.6)';
    roundRect(ctx, box.x - p, box.y - p, box.w + p * 2, box.h + p * 2, p * 0.8);
    ctx.fill();
  }
  if (ov.shadow !== false) {
    ctx.shadowColor = isLight ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.55)';
    ctx.shadowBlur = lay.px * (isLight ? 0.18 : 0.2);
    ctx.shadowOffsetY = isLight ? lay.px * 0.03 : 0;
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';

  let y = box.y;
  ctx.font = `700 ${lay.px}px ${FONT_FAMILY}`;
  ctx.lineWidth = lay.px * 0.022;       // 讓粗體字重更明顯
  for (const line of lay.mainLines) {
    ctx.strokeText(line, tx, y);
    ctx.fillText(line, tx, y);
    y += lay.px * lay.lh;
  }
  if (lay.metaText) {
    y += lay.gap;
    ctx.font = `400 ${lay.px2}px ${FONT_FAMILY}`;
    ctx.fillText(lay.metaText, tx, y);
  }
  ctx.restore();
  return { box, color, band, pad: lay.pad };
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// 輸出時：row.overlay 是 null 或 auto → 每次重新跑自動位置
export function resolveOverlayForOutput(row, data, an, W, H) {
  const ov = row.overlay;
  if (!ov || ov.auto) {
    return computeAuto(row, data, an, W, H, { meta: ov?.meta ?? true, shadow: ov?.shadow ?? true, size: ov?.size ?? 0.06 });
  }
  return ov;
}

// ---------- 輸出加字版 ----------
export async function renderOverlay(row, data, maxEdge = MAX_OUT_EDGE, quality = OUT_QUALITY) {
  await ensureFonts();
  const bmp = await loadBitmap(row.blob, maxEdge, row.w, row.h);
  const sw = srcW(bmp), sh = srcH(bmp);
  const s = Math.min(1, maxEdge / Math.max(sw, sh));
  const W = Math.round(sw * s), H = Math.round(sh * s);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, W, H);
  const an = analyze(bmp);
  bmp.close?.();
  const ov = resolveOverlayForOutput(row, data, an, W, H);
  drawOverlay(ctx, W, H, row, ov, data, an);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  freeCanvas(canvas);
  return blob;
}
