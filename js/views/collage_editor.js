// 拼貼編輯器：選 1–9 張、換版型、三種比例、點兩格交換、✍️ 加字、分享／存到手機
// 拼貼鋪滿照片，沒有標題列與印章；要加字就按「✍️ 加字」，用跟單張一樣的控制項自己找位置放。
// 加字設定只存在這次編輯的記憶體裡（關掉拼貼就重來），不寫 IndexedDB。
import { escapeHtml } from '../lib/md.js';
import { loadBitmap, freeCanvas, ensureFonts, normalizeOverlay } from '../lib/overlay.js';
import { jstParts } from '../lib/exif.js';
import { RATIOS, OUT_SCALE, MAX_PHOTOS, renderCollage, variantCount } from '../lib/collage.js';
import { showProgress, toast, withLock, downloadBlob, shareFiles, safeName } from '../lib/ui.js';
import { sortByTaken } from './share_sheet.js';
import { toolsHtml, wireOverlayTools, attachTextPointer } from './overlay_editor.js';

const WEEK = '日一二三四五六';
const PREVIEW_W = 720;

// 'YYYY-MM-DD' → '10/26（一）'；不是日期就回空字串（不會出現空的「（）」）
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const wd = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${m[2]}/${m[3]}（${WEEK[wd]}）`;
}

// opts: { rows, data, kind: 'day' | 'spot', day?, spot? }
export async function openCollageEditor({ rows, data, kind, day, spot }) {
  const all = sortByTaken(rows);
  if (!all.length) { toast('這裡還沒有照片'); return; }

  const byId = new Map(all.map(r => [r.id, r]));
  let order = all.slice(0, MAX_PHOTOS).map(r => r.id);   // 預設依拍攝時間取前 9 張
  let ratio = '4:5';
  let variant = 0;
  let picked = -1;            // 目前點選、等著跟另一格交換的格子
  let lay = null;
  let closed = false, busy = false, dirty = false;
  const cache = new Map();    // id → 預覽用 ImageBitmap
  const urls = [];

  // ---- 加字（記憶體內）----
  const txt = {
    on: false,                // 有沒有加字
    panel: false,             // 加字控制項是否展開
    note: kind === 'day' ? (day?.title || '') : (spot?.nameZh || spot?.name || ''),
    st: { ...normalizeOverlay(null), auto: true },
  };
  function dateText() {
    if (kind === 'day' && day && /^\d{4}-\d{2}-\d{2}$/.test(day.date || '')) return fmtDate(day.date);
    const first = byId.get(order[0]);
    const p = jstParts(first?.takenAt || first?.createdAt || '');
    return p ? fmtDate(p.date) : '';
  }
  function textSpec() {
    if (!txt.on) return null;
    const first = byId.get(order[0]);
    return {
      st: txt.st, data,
      row: { note: txt.note, takenAt: first?.takenAt, createdAt: first?.createdAt, spotId: null, metaOverride: { date: dateText(), spot: '' } },
    };
  }

  const root = document.createElement('div');
  root.className = 'ove-overlay col-overlay';
  root.innerHTML = `
    <div class="ove-head">
      <button type="button" class="btn" data-a="close">關閉</button>
      <div class="ove-title">🧩 拼貼</div>
      <span style="width:56px"></span>
    </div>
    <div class="ove-stage"><canvas class="ove-canvas"></canvas></div>
    <div class="ove-tools">
      <div class="col-text-tools" hidden>
        ${toolsHtml({ note: txt.note, notePlaceholder: '文字（可以改、可以清空）', size: txt.st.size })}
        <div class="ove-row">
          <button type="button" class="ove-tg" data-a="text-done">完成</button>
          <button type="button" class="ove-tg" data-a="text-remove">✕ 不加字</button>
        </div>
      </div>
      <div class="ove-row col-main">
        ${Object.entries(RATIOS).map(([k, v]) => `<button type="button" class="ove-tg${k === ratio ? ' on' : ''}" data-ratio="${k}">${escapeHtml(v.label)}</button>`).join('')}
        <span class="ove-sep"></span>
        <button type="button" class="ove-tg" data-a="variant">🔀 換版型</button>
        <button type="button" class="ove-tg" data-a="text">✍️ 加字</button>
      </div>
      <div class="small faint col-hint col-main">點一格再點另一格可交換</div>
      <div class="col-strip col-main">
        ${all.map(r => {
          const u = URL.createObjectURL(r.thumb || r.blob); urls.push(u);
          return `<label class="col-pick"><img alt="" src="${u}"><input type="checkbox" data-id="${escapeHtml(r.id)}" ${order.includes(r.id) ? 'checked' : ''} aria-label="選取 ${escapeHtml(r.name || '')}"></label>`;
        }).join('')}
      </div>
      <div class="cap-actions col-main">
        <button type="button" class="btn btn-primary" data-a="share">📤 分享</button>
        <button type="button" class="btn" data-a="save">💾 存到手機</button>
      </div>
      <div class="small faint col-status"></div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('cap-open');

  const stage = root.querySelector('.ove-stage');
  const canvas = root.querySelector('canvas');
  const status = root.querySelector('.col-status');
  const textTools = root.querySelector('.col-text-tools');

  function setPanel(open) {
    txt.panel = open;
    textTools.hidden = !open;
    root.classList.toggle('col-textmode', open);
    picked = -1;
    requestAnimationFrame(() => { if (canvas.width) fitCanvas(canvas.width, canvas.height); });
    draw();
  }

  async function previewBitmap(id) {
    if (cache.has(id)) return cache.get(id);
    const r = byId.get(id);
    const b = await loadBitmap(r.blob, 1000, r.w, r.h);
    cache.set(id, b);
    return b;
  }

  let tools = null;
  // 預覽：同一支 renderCollage，只是寬度小
  async function draw() {
    if (closed) return;
    if (busy) { dirty = true; return; }
    busy = true; dirty = false;
    try {
      const rt = RATIOS[ratio];
      const W = PREVIEW_W, H = Math.round(PREVIEW_W * rt.h / rt.w);
      const ids = order.slice();
      const bmps = await Promise.all(ids.map(previewBitmap));
      const tmp = document.createElement('canvas');
      lay = await renderCollage(tmp, {
        W, H, n: ids.length, variant,
        getBitmap: async (i) => bmps[i],
        text: textSpec(),
      });
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(tmp, 0, 0);
      freeCanvas(tmp);
      if (picked >= 0 && lay.cells[picked]) {
        const c = lay.cells[picked];
        ctx.lineWidth = W * 0.012; ctx.strokeStyle = '#C4452F';
        ctx.strokeRect(c.x + ctx.lineWidth / 2, c.y + ctx.lineWidth / 2, c.w - ctx.lineWidth, c.h - ctx.lineWidth);
      }
      fitCanvas(W, H);
      tools?.sync();
    } finally {
      busy = false;
      if (dirty) draw();
    }
  }
  function fitCanvas(W, H) {
    const s = Math.min(stage.clientWidth / W, stage.clientHeight / H);
    canvas.style.width = Math.floor(W * s) + 'px';
    canvas.style.height = Math.floor(H * s) + 'px';
  }

  // 加字控制項（共用單張編輯器的那一套）
  tools = wireOverlayTools(textTools, {
    st: txt.st, redraw: draw,
    getNote: () => txt.note, setNote: (v) => { txt.note = v; },
    getEff: () => lay?.text?.eff || null,
    getLast: () => lay?.text?.last || null,
    getCw: () => canvas.width || PREVIEW_W,
    hasSpot: () => false,          // 拼貼沒有單一景點，景點名稱放在文字框裡
  });
  attachTextPointer(canvas, txt.st, {
    redraw: draw,
    freeze: () => {
      if (!txt.st.auto) return;
      const eff = lay?.text?.eff;
      if (eff) { txt.st.x = eff.x; txt.st.y = eff.y; txt.st.align = eff.align; }
      txt.st.auto = false;
    },
    enabled: () => txt.on && txt.panel,
  });

  // ---- 點兩格交換（加字展開時是拖曳文字，不交換）----
  canvas.addEventListener('click', (e) => {
    if (!lay || txt.panel) return;
    const rc = canvas.getBoundingClientRect();
    const x = (e.clientX - rc.left) * canvas.width / rc.width;
    const y = (e.clientY - rc.top) * canvas.height / rc.height;
    const idx = lay.cells.findIndex((c, i) => i < order.length && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    if (idx < 0) return;
    if (picked < 0) picked = idx;
    else if (picked === idx) picked = -1;
    else { [order[picked], order[idx]] = [order[idx], order[picked]]; picked = -1; }
    draw();
  });

  // ---- 最終輸出（2 倍解析度，照片用原圖；有加字就一起畫上去）----
  async function exportBlob() {
    await ensureFonts();
    const rt = RATIOS[ratio];
    const W = rt.w * OUT_SCALE, H = rt.h * OUT_SCALE;
    const c = document.createElement('canvas');
    const ids = order.slice();
    await renderCollage(c, {
      W, H, n: ids.length, variant, release: true,
      text: textSpec(),
      getBitmap: async (i, cell) => {
        const r = byId.get(ids[i]);
        const iw = r.w || 1, ih = r.h || 1;
        const sc = Math.max(cell.w / iw, cell.h / ih);
        return loadBitmap(r.blob, Math.ceil(Math.max(iw, ih) * Math.min(1, sc) * 1.05), iw, ih);
      },
    });
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    freeCanvas(c);
    return blob;
  }
  function outName() {
    const first = byId.get(order[0]);
    const p = jstParts(first?.takenAt || first?.createdAt || '');
    const d = p ? p.mmdd.replace('/', '-') : '';
    const base = kind === 'day' && day?.n ? `拼貼_Day${day.n}_${d}` : kind === 'day' ? `拼貼_${d}` : `拼貼_${spot?.nameZh || spot?.name || ''}_${d}`;
    return `${safeName(base)}.jpg`;
  }

  async function doExport(shareIt, btn) {
    await withLock(btn, async () => {
      const prog = showProgress('拼貼輸出中…');
      let blob;
      try { blob = await exportBlob(); }
      catch (e) { prog.close(); alert('輸出失敗：' + (e.message || e)); return; }
      prog.close();
      if (!blob) { alert('輸出失敗'); return; }
      const name = outName();
      if (!shareIt) { downloadBlob(blob, name); toast('已下載到手機'); return; }
      const file = new File([blob], name, { type: 'image/jpeg' });
      const r = await shareFiles([file], { title: name });
      if (r === 'need-gesture' || r === 'cancelled') {
        status.innerHTML = `<button type="button" class="btn btn-primary" data-a="send">📤 送出</button>`;
        status.querySelector('button').onclick = async () => {
          const r2 = await shareFiles([file], { title: name });
          if (r2 !== 'cancelled') { status.textContent = ''; toast(r2 === 'downloaded' ? '已下載到手機' : '已送出'); }
        };
      } else toast(r === 'downloaded' ? '已下載到手機' : '已送出');
    });
  }

  // ---- 事件 ----
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || textTools.contains(t) && !t.dataset.a) return;
    if (t.dataset.ratio) {
      ratio = t.dataset.ratio;
      root.querySelectorAll('[data-ratio]').forEach(b => b.classList.toggle('on', b === t));
      picked = -1; draw();
    } else if (t.dataset.a === 'variant') {
      const n = variantCount(order.length);
      variant = (variant + 1) % Math.max(1, n);
      picked = -1; draw();
      if (n <= 1) toast('這個張數只有一種版型');
    } else if (t.dataset.a === 'text') {
      if (!txt.on) txt.on = true;
      setPanel(!txt.panel);
    } else if (t.dataset.a === 'text-done') setPanel(false);
    else if (t.dataset.a === 'text-remove') { txt.on = false; setPanel(false); }
    else if (t.dataset.a === 'share') doExport(true, t);
    else if (t.dataset.a === 'save') doExport(false, t);
    else if (t.dataset.a === 'close') close();
  });
  root.addEventListener('change', (e) => {
    const i = e.target.closest('input[data-id]');
    if (!i) return;
    const id = i.dataset.id;
    if (i.checked) {
      if (order.length >= MAX_PHOTOS) { i.checked = false; toast(`最多 ${MAX_PHOTOS} 張`); return; }
      order.push(id);
      order = all.map(r => r.id).filter(x => order.includes(x));
    } else {
      if (order.length <= 1) { i.checked = true; toast('至少要 1 張'); return; }
      order = order.filter(x => x !== id);
    }
    variant = 0; picked = -1;
    draw();
  });
  const onResize = () => { if (canvas.width) fitCanvas(canvas.width, canvas.height); };
  window.addEventListener('resize', onResize);

  function close() {
    closed = true;
    window.removeEventListener('resize', onResize);
    tools?.destroy();
    cache.forEach(b => b.close?.());
    cache.clear();
    urls.forEach(u => URL.revokeObjectURL(u));
    freeCanvas(canvas);
    root.remove();
    document.body.classList.remove('cap-open');
  }

  await ensureFonts();
  draw();
}
