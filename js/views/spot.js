// 詳情頁（景點／餐廳／店家／會場／飯店）
import { mdInline, escapeHtml } from '../lib/md.js';
import { mapsUrl } from '../lib/maps.js';
import { annotateYenTwd } from '../lib/fmt.js';
import { getPrevHash } from '../router.js';

const KNOWN_BACK = {
  '#/tools/tips':    '回攻略',
  '#/tools/flight':  '回航班',
  '#/tools/phrases': '回句庫',
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
  const day = spot.day;

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
          <div class="nameZh">${escapeHtml(spot.nameZh || spot.name || '')}</div>
          ${spot.name && spot.name !== spot.nameZh ? `<div class="name">${escapeHtml(spot.name)}</div>` : ''}
          ${spot.reading ? `<div class="reading mono">${escapeHtml(spot.reading)}</div>` : ''}
          ${cat !== 'hotel' && spot.oneLine ? `<p class="oneline">${mdInline(spot.oneLine)}</p>` : ''}
        </header>

        ${renderIntroSection(cat, spot.intro)}
        ${section(GUIDE_TITLE[cat] || '重點', renderList(guideItems))}
        ${section('基本資料', renderFacts(spot, ctx.data.rate))}
        ${showCautions ? section('注意事項', renderCautions(spot.cautions)) : ''}

        <div class="actions-row">
          <a class="btn btn-primary" href="${mapsUrl(spot.mapQuery || spot.address || spot.name)}"
             target="_blank" rel="noopener" id="mapbtn">🗺 Google Maps 導航</a>
          ${spot.story ? `<a class="btn" href="#/story/${encodeURIComponent(spot.id)}">相關攻略 →</a>` : ''}
        </div>
      </div>
    </div>
  `;

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
    <img class="spot-photo" src="${src}" alt=""
      onerror="this.outerHTML='<div class=&quot;spot-photo placeholder&quot;>📷</div>'">
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
  if (spot.payment)     rows.push(['付款', payLabel(spot.payment)]);
  if (spot.booking?.note) rows.push(['訂位', (spot.booking.required ? '需訂位 · ' : '') + spot.booking.note]);
  if (spot.allergyNote) rows.push(['過敏', spot.allergyNote]);
  if (rows.length === 0) return '';
  return `<div class="facts">${
    rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${mdInline(v)}</div>`).join('')
  }</div>`;
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
  return '';
}

function payLabel(arr) {
  const map = { cash: '現金', card: '信用卡', ic: 'IC 卡', qr: 'QR Pay' };
  return arr.map(k => map[k] || k).join(' · ');
}

export { BACK_LABEL };
