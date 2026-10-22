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

// ---------- 字級範圍 ----------
export const SIZE_MIN = 0.06;
export const SIZE_MAX = 0.13;
export const SIZE_DEFAULT = 0.09;
const MAX_LINES = 3;

export function clampSize(s) {
  const v = Number.isFinite(s) ? s : SIZE_DEFAULT;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, v));
}

export function defaultOverlay() {
  return {
    auto: true, x: 0.06, y: 0.88, size: SIZE_DEFAULT, color: 'auto', band: 'auto', shadow: true,
    showDate: true, showSpot: true, metaMode: 'newline', align: 'left',
  };
}

// 讀出來的設定一律先過這裡：舊資料的 meta → showDate／showSpot，size 夾進範圍（不回寫）
export function normalizeOverlay(ov) {
  const o = { ...defaultOverlay(), ...(ov || {}) };
  if (ov && 'meta' in ov && !('showDate' in ov) && !('showSpot' in ov)) {
    o.showDate = ov.meta !== false;
    o.showSpot = ov.meta !== false;
  }
  delete o.meta;
  if (o.metaMode !== 'inline') o.metaMode = 'newline';
  o.showDate = o.showDate !== false;
  o.showSpot = o.showSpot !== false;
  o.size = clampSize(o.size);
  return o;
}

// ---------- 疊字內容 ----------
// row 可以是手帳照片，也可以是拼貼用的假 row（帶 metaOverride: { date, spot }）
export function spotNameOf(row, data) {
  if (!row.spotId) return '';
  const s = (data?.spots || []).find(x => x.id === row.spotId);
  return s ? (s.nameZh || s.name || '') : '';
}
export function dateTextOf(row) {
  const p = jstParts(row.takenAt || row.createdAt || '');
  return p ? p.mmdd : '';
}
// 這張有沒有景點可以加（編輯器用來灰掉「📍 景點」）
export function hasSpotText(row, data) {
  return row.metaOverride ? !!row.metaOverride.spot : !!spotNameOf(row, data);
}

// 回傳 { main, meta }：
//   newline：main＝備註（沒備註時改放日期景點，用主字級）、meta＝日期景點（小字，另起一行）
//   inline ：main＝「備註 · 日期 · 景點」一整段同字級、meta＝''
export function overlayTexts(row, data, ovIn) {
  const ov = normalizeOverlay(ovIn);
  const note = (row.note || '').trim();
  const date = ov.showDate ? (row.metaOverride ? row.metaOverride.date : dateTextOf(row)) : '';
  const spot = ov.showSpot ? (row.metaOverride ? row.metaOverride.spot : spotNameOf(row, data)) : '';
  const parts = [date, spot].filter(Boolean);
  const metaStr = parts.join(' · ');
  if (ov.metaMode === 'inline') {
    const segs = [note, ...parts].filter(Boolean);
    return { main: segs.join(' · '), meta: '', segs };
  }
  if (!note) return { main: metaStr, meta: '' };
  return { main: note, meta: metaStr };
}

// 有沒有任何字要畫（沒有就輸出原圖）
export function hasOverlayText(row, data) {
  const { main, meta } = overlayTexts(row, data, row.overlay);
  return !!(main || meta);
}

// ---------- 排版 ----------
const CLOSERS = '）」』】》〉，。、！？：；,.!?;:)]}…';
function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of text.split(/\r?\n/)) {
    let cur = '';
    for (const ch of para) {
      // 收尾的標點（）」，。等）不單獨換到下一行，寧可這行多出一個字
      if (cur && !CLOSERS.includes(ch) && ctx.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch; }
      else cur += ch;
    }
    out.push(cur);
  }
  // 行尾行首的空白不算字：否則底帶會多出一截
  return out.map(l => l.trim()).filter((l, i, a) => l || a.length === 1);
}

// 「備註 · 日期 · 景點」接在一起時：優先在各段之間換行（行尾不留「 · 」），單段太長才逐字換行
function wrapSegs(ctx, segs, maxW) {
  const out = [];
  let cur = '';
  for (const seg of segs) {
    const joined = cur ? `${cur} · ${seg}` : seg;
    if (ctx.measureText(joined).width <= maxW) { cur = joined; continue; }
    if (cur) { out.push(cur); cur = ''; }
    if (ctx.measureText(seg).width <= maxW) { cur = seg; continue; }
    const pieces = wrapLines(ctx, seg, maxW);
    cur = pieces.pop() || '';
    out.push(...pieces);
  }
  if (cur) out.push(cur);
  return out;
}

// 算文字區大小（不含底帶內距）。回傳 null 表示沒有字。
// 放不下（超過 3 行）才自動縮小，但不小於 SIZE_MIN。
export function layoutText(ctx, row, data, ovIn, W, H) {
  const ov = normalizeOverlay(ovIn);
  const { main, meta, segs } = overlayTexts(row, data, ov);
  if (!main && !meta) return null;
  const base = Math.min(W, H);
  const maxW = W * 0.88;
  const lh = 1.1;
  const minPx = Math.max(8, SIZE_MIN * base);
  let px = Math.max(minPx, ov.size * base);

  let mainLines = [];
  ctx.save();
  for (;;) {
    ctx.font = `700 ${px}px ${FONT_FAMILY}`;
    mainLines = !main ? [] : segs ? wrapSegs(ctx, segs, maxW) : wrapLines(ctx, main, maxW);
    if (mainLines.length <= MAX_LINES || px <= minPx) break;
    px = Math.max(minPx, px * 0.94);
  }
  if (mainLines.length > MAX_LINES) {
    mainLines = mainLines.slice(0, MAX_LINES);
    mainLines[MAX_LINES - 1] = mainLines[MAX_LINES - 1].replace(/.$/, '…');
  }
  let bw = 0;
  const mainWidths = [];
  for (const l of mainLines) { const w = ctx.measureText(l).width; mainWidths.push(w); bw = Math.max(bw, w); }

  const px2 = px * 0.55;
  ctx.font = `400 ${px2}px ${FONT_FAMILY}`;
  let metaText = meta;
  let metaWidth = 0;
  if (metaText) {
    while (metaText.length > 1 && ctx.measureText(metaText).width > maxW) metaText = metaText.slice(0, -1);
    if (metaText !== meta) metaText = metaText.slice(0, -1) + '…';
    metaWidth = ctx.measureText(metaText).width;
    bw = Math.max(bw, metaWidth);
  }
  ctx.restore();

  const gap = mainLines.length && metaText ? px * 0.05 : 0;
  const bh = mainLines.length * px * lh + (metaText ? px2 * lh + gap : 0);
  // pad：夾在圖片內的邊距；padX／padY：底帶只比字多出一點點，剛好把字包住
  return { mainLines, mainWidths, metaText, metaWidth, px, px2, lh, gap, bw, bh, pad: px * 0.3, padX: px * 0.2, padY: px * 0.07 };
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
  const ov = { ...normalizeOverlay(base), auto: true, color: 'auto', band: 'auto' };
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
  const ov = normalizeOverlay(ovIn);
  const lay = layoutText(ctx, row, data, ov, W, H);
  if (!lay) return null;
  const box = placeBox(lay, ov, W, H);
  const { color, band } = resolveStyle(ov, an, box, W, H, lay.pad);
  const ink = color.toLowerCase() === INK.toLowerCase();
  const isLight = !ink && relLum(hexToRgb(color)) > 0.3;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = ov.align === 'center' ? 'center' : ov.align === 'right' ? 'right' : 'left';
  const tx = ov.align === 'center' ? box.x + box.w / 2 : ov.align === 'right' ? box.x + box.w : box.x;
  const BASE = 0.86;      // 中文字的基線大約在字高 86% 的位置
  const leftOf = (w) => ov.align === 'center' ? box.x + (box.w - w) / 2 : ov.align === 'right' ? box.x + box.w - w : box.x;

  // 每一行的垂直位置（字的上緣）
  const rows = [];
  let yy = box.y;
  lay.mainLines.forEach((l, i) => { rows.push({ y: yy, h: lay.px, w: lay.mainWidths[i] }); yy += lay.px * lay.lh; });
  if (lay.metaText) { yy += lay.gap; rows.push({ y: yy, h: lay.px2, w: lay.metaWidth }); }

  if (band) {
    // 底帶只包住字：每一行各畫一塊，貼著那一行的寬度，上下左右只多一點點
    const bf = bandFill(color);
    ctx.fillStyle = bf;
    const r = lay.px * 0.16;
    for (const rw of rows) {
      roundRect(ctx, leftOf(rw.w) - lay.padX, rw.y - lay.padY, rw.w + lay.padX * 2, rw.h + lay.padY * 2, r);
      ctx.fill();
    }
  }
  if (ov.shadow !== false && !band) {
    ctx.shadowColor = isLight ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.55)';
    ctx.shadowBlur = lay.px * (isLight ? 0.18 : 0.2);
    ctx.shadowOffsetY = isLight ? lay.px * 0.03 : 0;
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';

  ctx.font = `700 ${lay.px}px ${FONT_FAMILY}`;
  ctx.lineWidth = lay.px * 0.022;       // 讓粗體字重更明顯
  lay.mainLines.forEach((line, i) => {
    const by = rows[i].y + lay.px * BASE;
    ctx.strokeText(line, tx, by);
    ctx.fillText(line, tx, by);
  });
  if (lay.metaText) {
    const rw = rows[rows.length - 1];
    ctx.font = `400 ${lay.px2}px ${FONT_FAMILY}`;
    ctx.fillText(lay.metaText, tx, rw.y + lay.px2 * BASE);
  }
  ctx.restore();
  return { box, color, band, pad: lay.pad };
}

// 底帶顏色：在黑底與米白底之間挑跟文字對比比較高的，並且夠不透明，字才看得清楚
export function bandFill(textHex) {
  const t = hexToRgb(textHex);
  const dark = [20, 18, 16], cream = [252, 251, 247];
  return contrast(t, dark) >= contrast(t, cream) ? 'rgba(20,18,16,.8)' : 'rgba(252,251,247,.85)';
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
    const n = normalizeOverlay(ov);
    return computeAuto(row, data, an, W, H, { showDate: n.showDate, showSpot: n.showSpot, metaMode: n.metaMode, shadow: n.shadow, size: n.size });
  }
  return normalizeOverlay(ov);
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
