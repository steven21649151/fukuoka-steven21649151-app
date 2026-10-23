// 詳情頁（景點／餐廳／店家／會場／飯店）
import { mdInline, escapeHtml, phraseWrap } from '../lib/md.js';
import { mapsUrl } from '../lib/maps.js';
import { annotateYenTwd } from '../lib/fmt.js';
import { getPrevHash } from '../router.js';
import { findSpotDay } from '../lib/plan.js';

const KNOWN_BACK = {
  '#/tools/tips':    '回攻略',
  '#/tools/flight':  '回航班',
  '#/tools/phrases': '回字卡',
  '#/tools/packing': '回打包清單',
  '#/tools':         '回小工具',
};

// 分類 pill 文案
const CAT_LABEL = {
  food:  '🍽 餐廳', sight: '⛩ 景點', venue: '🎤 會場',
  shop:  '🛍 購物', hotel: '🏨 住宿',
};
// intro 區塊標題（hotel 沒標題）
const INTRO_TITLE = {
  sight: '這是什麼', food: '這家店', shop: '這裡有什麼', venue: '會場簡介',
};
// guide 區塊標題（hotel 特別）
const GUIDE_TITLE = {
  sight: '要看什麼', food: '必點・怎麼點', shop: '買什麼・怎麼逛',
  venue: '動線與重點', hotel: '入住注意事項',
};
// 返回鍵的稱呼
const BACK_LABEL = {
  sight: '這個地點', food: '這間餐廳', shop: '這家店', venue: '這場會議', hotel: '這間飯店',
};

export async function render(root, params, ctx) {
  const spot = ctx.data.spots.find(s => s.id === params.id);
  if (!spot) {
    root.innerHTML = `
      <div class="wrap">
        <div class="topnav"><a class="back" href="#/">← 回行程</a></div>
        <div class="empty">找不到這個地點</div>
      </div>`;
    return;
  }

  const cat = spot.category || 'sight';
  const day = findSpotDay(ctx.data.days, spot.id, spot.day);

  const prev = getPrevHash();
  const prevBase = prev ? prev.split('?')[0] : null;
  const useKnown = prevBase && KNOWN_BACK[prevBase];
  const backHref = useKnown ? prev : (day ? `#/day/${day}` : '#/');
  const backLabel = useKnown ? KNOWN_BACK[prevBase] : `回第 ${day || 1} 天`;

  // 飯店：cautions 併進入住注意事項
  const guideItems = cat === 'hotel'
    ? [...(spot.guide || []), ...(spot.cautions || [])]
    : (spot.guide || []);
  const showCautions = cat !== 'hotel' && Array.isArray(spot.cautions) && spot.cautions.length > 0;

  root.innerHTML = `
    <div data-cat="${cat}">
      ${renderPhoto(spot)}
      <div class="wrap">
        <div class="topnav">
          <a class="back" href="${backHref}">← ${escapeHtml(backLabel)}</a>
          <span class="pill">${CAT_LABEL[cat] || cat}</span>
          ${paymentPill(spot)}
        </div>

        <header class="spot-header">
          <div class="nameZh">${phraseWrap(spot.nameZh || spot.name || '')}</div>
          ${spot.name && spot.name !== spot.nameZh ? `<div class="name">${escapeHtml(spot.name)}</div>` : ''}
          ${spot.reading ? `<div class="reading mono">${escapeHtml(spot.reading)}</div>` : ''}
          ${cat !== 'hotel' && spot.oneLine ? `<p class="oneline">${mdInline(spot.oneLine)}</p>` : ''}
        </header>

        ${renderIntroSection(cat, spot.intro)}
        ${renderBuy(spot, ctx.data.rate)}
        ${section(GUIDE_TITLE[cat] || '重點', renderList(guideItems))}
        <div id="spotPhotos"></div>
        ${section('基本資料', renderFacts(spot, ctx.data.rate))}
        ${showCautions ? section('注意事項', renderCautions(spot.cautions)) : ''}

        <div class="actions-row">
          <a class="btn btn-primary" href="${mapsUrl(spot.mapQuery || spot.address || spot.name)}"
             target="_blank" rel="noopener" id="mapbtn">🗺 Google Maps 導航</a>
          <button type="button" class="btn" data-jrn-spot="${escapeHtml(spot.id)}">📷 加照片</button>
          ${spot.story ? `<a class="btn" href="#/story/${encodeURIComponent(spot.id)}">相關攻略 →</a>` : ''}
        </div>
      </div>
    </div>
  `;

  loadSpotPhotos(spot, ctx);

  const mapbtn = document.getElementById('mapbtn');
  const setMapState = () => {
    if (!navigator.onLine) {
      mapbtn.setAttribute('aria-disabled', 'true');
      mapbtn.title = '離線中，導航需要網路';
    } else {
      mapbtn.removeAttribute('aria-disabled');
      mapbtn.title = '';
    }
  };
  setMapState();
  window.addEventListener('online', setMapState);
  window.addEventListener('offline', setMapState);
}

function renderIntroSection(cat, intro) {
  if (!intro) return '';
  if (cat === 'hotel') {
    // 沒標題，intro 直接當開場一段
    return `<div class="section" style="margin-top:14px"><div class="body">${mdInline(intro)}</div></div>`;
  }
  return section(INTRO_TITLE[cat] || '簡介', `<div class="body">${mdInline(intro)}</div>`);
}

function renderPhoto(spot) {
  const src = `./photos/${spot.id}.jpg`;
  return `
    <img class="spot-photo" src="${src}" alt="" loading="eager" decoding="async"
      onerror="this.remove()">
  `;
}

function section(title, body) {
  if (!body) return '';
  return `<section class="section"><h2>${title}</h2>${body}</section>`;
}

function renderList(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `<ul class="guide">${items.map(g => `<li>${mdInline(g)}</li>`).join('')}</ul>`;
}

function renderFacts(spot, rate) {
  const rows = [];
  if (spot.hours)       rows.push(['營業', spot.hours]);
  if (spot.closed)      rows.push(['公休', spot.closed]);
  if (spot.fee)         rows.push(['費用', annotateYenTwd(spot.fee, rate?.jpyToTwd)]);
  if (spot.price)       rows.push(['價位', annotateYenTwd(spot.price, rate?.jpyToTwd)]);
  if (spot.stayMinutes) rows.push(['停留', `${spot.stayMinutes} 分鐘`]);
  if (spot.address)     rows.push(['地址', spot.address]);
  if (spot.payment)     rows.push(['付款', payLabel(spot.payment) + pxSuffix(spot)]);
  if (spot.booking?.note) rows.push(['訂位', (spot.booking.required ? '需訂位 · ' : '') + spot.booking.note]);
  if (rows.length === 0) return '';
  return `<div class="facts">${
    rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${mdInline(v)}</div>`).join('')
  }</div>${spot.pxpayNote ? `<div class="px-note">${mdInline(spot.pxpayNote)}</div>` : ''}`;
}

function renderCautions(cautions) {
  if (!Array.isArray(cautions) || cautions.length === 0) return '';
  return `<ul class="cautions">${cautions.map(c => `<li>${mdInline(c)}</li>`).join('')}</ul>`;
}

function paymentPill(spot) {
  const p = spot.payment;
  if (Array.isArray(p) && p.length === 1 && p[0] === 'cash') {
    return `<span class="pill warn">只收現金</span>`;
  }
  return spot.pxpay === 'yes' ? `<span class="pill pxpay">📱全支付</span>` : '';
}

// 付款列後面接的全支付說明
function pxSuffix(spot) {
  if (spot.pxpay === 'yes') return ' · 📱全支付';
  if (spot.pxpay === 'some') return ' · 📱部分店家可用全支付';
  return '';
}

function payLabel(arr) {
  const map = { cash: '現金', card: '信用卡', ic: 'IC 卡', qr: 'QR Pay' };
  return arr.map(k => map[k] || k).join(' · ');
}

export { BACK_LABEL };

// 🛍 推薦買這些：只顯示推薦，不做勾選、不顯示件數
function renderBuy(spot, rate) {
  const buy = Array.isArray(spot.buy) ? spot.buy : [];
  if (buy.length === 0) return '';
  const items = buy.map(b => {
    const ja = b.name && b.name !== b.zh ? `<span class="buy-ja">${escapeHtml(b.name)}</span>` : '';
    return `
      <div class="buy-item">
        <div class="buy-name"><b>${escapeHtml(b.zh || b.name || '')}</b>${ja}</div>
        ${b.price ? `<div class="buy-price">${escapeHtml(annotateYenTwd(b.price, rate?.jpyToTwd))}</div>` : ''}
        ${b.why ? `<div class="buy-why">${mdInline(b.why)}</div>` : ''}
        ${b.where ? `<div class="buy-where">📍 ${mdInline(b.where)}</div>` : ''}
        ${b.note ? `<div class="buy-note">${mdInline(b.note)}</div>` : ''}
      </div>`;
  }).join('');
  const note = spot.buyNote ? `<div class="buy-sub">${escapeHtml(spot.buyNote)}</div>` : '';
  return section('🛍 推薦買這些', `${note}<div class="buy-list">${items}</div>`);
}

// 📷 我的照片：這個景點有手帳照片才顯示。橫向縮圖列＋分享這個景點／拼貼
async function loadSpotPhotos(spot, ctx) {
  const slot = document.getElementById('spotPhotos');
  if (!slot) return;
  const urls = [];
  const cleanup = () => { urls.splice(0).forEach(u => URL.revokeObjectURL(u)); };

  async function refresh() {
    let rows = [];
    try {
      const db = await import('../lib/db.js');
      if (await db.isAvailable()) rows = await db.getJournalBySpot(spot.id);
    } catch { rows = []; }
    cleanup();
    if (!document.body.contains(slot)) return;
    if (!rows.length) { slot.innerHTML = ''; return; }
    const { sortByTaken } = await import('./share_sheet.js');
    const { ensureThumb } = await import('../lib/journal_capture.js');
    rows = sortByTaken(rows);
    const thumbs = await Promise.all(rows.map(async r => r.thumb || await ensureThumb(r) || r.blob));
    if (!document.body.contains(slot)) return;
    slot.innerHTML = `
      <section class="section">
        <h2>📷 我的照片</h2>
        <div class="spot-photos-strip">
          ${rows.map((r, i) => {
            const u = URL.createObjectURL(thumbs[i]); urls.push(u);
            return `<button type="button" class="spot-photo-thumb" data-i="${i}" aria-label="${escapeHtml(r.name || '照片')}"><img alt="" src="${u}"></button>`;
          }).join('')}
        </div>
        <div class="spot-photos-acts">
          <button type="button" class="btn" data-a="share">📤 分享這個景點</button>
          <button type="button" class="btn" data-a="collage">🧩 拼貼</button>
        </div>
      </section>`;
    slot.onclick = async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.i != null) {
        const { openPhotoSheet } = await import('./journal_detail.js');
        openPhotoSheet(rows[Number(t.dataset.i)], { data: ctx.data, onChange: refresh });
      } else if (t.dataset.a === 'share') {
        const { openShareSheet } = await import('./share_sheet.js');
        openShareSheet({ rows, data: ctx.data, title: spot.nameZh || spot.name || '分享照片' });
      } else if (t.dataset.a === 'collage') {
        const { openCollageEditor } = await import('./collage_editor.js');
        openCollageEditor({ rows, data: ctx.data, kind: 'spot', spot });
      }
    };
  }

  const onAdded = () => refresh();
  window.addEventListener('journal-added', onAdded);
  window.addEventListener('hashchange', () => {
    window.removeEventListener('journal-added', onAdded);
    cleanup();
  }, { once: true });
  await refresh();
}
