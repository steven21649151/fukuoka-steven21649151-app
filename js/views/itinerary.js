// 行程列表（首頁）
import { mdInline, escapeHtml } from '../lib/md.js';
import { yen, yenRange, md, twdIfBig } from '../lib/fmt.js';
import { mapsUrl } from '../lib/maps.js';
import { computeNowInDay, todayISO } from '../lib/nowitem.js';
import { ticketedItemIds, isAvailable as dbAvailable } from '../lib/db.js';

const KIND_CAT = {
  flight: 'transit', transit: 'transit', meal: 'food', sight: 'sight',
  conference: 'venue', shopping: 'shop', hotel: 'hotel', free: 'transit',
};
const KIND_ICON = {
  flight: '✈️', transit: '🚇', meal: '🍽', sight: '⛩',
  conference: '🎤', shopping: '🛍', hotel: '🏨', free: '🕐',
};
const SEG_LABEL = {
  morning: '🌅 早上', noon: '🌤 中午', afternoon: '🌇 下午', night: '🌙 晚上',
};
const MODE_ICON = {
  walk: '🚶', subway: '🚇', train: '🚆', bus: '🚌',
  taxi: '🚕', boat: '⛴', car: '🚗', shinkansen: '🚄', tram: '🚋',
};
const SPOT_BTN = {
  sight: '看景點 →', food: '看餐廳 →', shop: '看店家 →',
  venue: '看會場 →', hotel: '看住宿 →',
};

// pay 對照表：文字、樣式、對應 tip
const PAY_CHIP = {
  touch:  { text: '嗶卡',       cls: 'touch', tipId: 'tp-touchcap' },
  ic:     { text: '嗶卡／Suica', cls: 'touch', tipId: 'tp-kumamoto-ic' },
  pass:   { text: '一日券',     cls: 'pass',  tipId: 'tp-kumamoto-ic' },
  ticket: { text: '車站取票',   cls: '',       tipId: null },
  cash:   { text: '現金',       cls: 'cash',  tipId: 'tp-cash' },
  free:   { text: '免費',       cls: 'free',  tipId: null },
  paid:   { text: '已付',       cls: 'paid',  tipId: null },
};

export async function render(root, params, ctx, opts = {}) {
  const { days } = ctx.data;
  const today = todayISO();
  let n = params.n;

  if (n == null) {
    const idx = days.findIndex(d => d.date === today);
    n = idx >= 0 ? days[idx].n : 1;
  }
  window.__currentDay = n;

  const day = days.find(d => d.n === n) || days[0];
  const nowInfo = computeNowInDay(day, today);

  // 拿一次「哪些 item 有票」，渲染卡片時決定是否顯示 🎫
  let tkSet = new Set();
  try {
    if (await dbAvailable()) tkSet = await ticketedItemIds();
  } catch {}
  ctx.__ticketedItemIds = tkSet;

  root.innerHTML = `
    <div class="wrap">
      ${renderDayHeader(day, ctx)}
      ${renderItems(day, nowInfo, ctx)}
      ${renderTodayTips(day, ctx)}
    </div>
  `;

  // 只有第一次進到某一天才自動對焦當前時段；返回時尊重 router 的捲動記憶
  if (!opts.restored && nowInfo.highlightId) {
    requestAnimationFrame(() => {
      const el = root.querySelector(`[data-item-id="${nowInfo.highlightId}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }
}

function renderDayHeader(day, ctx) {
  const est = day.costEstimate
    ? renderEstimate(day.costEstimate, ctx.data.rate)
    : '';
  return `
    <header class="day-header">
      <div class="day-topline">
        <div class="k">${escapeHtml(day.kanji)}</div>
        <h1>${escapeHtml(day.title || '')}</h1>
      </div>
      <div class="date">${escapeHtml(md(day.date))}（${escapeHtml(day.weekday || '')}）</div>
      ${day.summary ? `<p class="summary">${mdInline(day.summary)}</p>` : ''}
      ${est}
    </header>
  `;
}

function renderEstimate(cost, rate) {
  const yenText = `${yen(cost.min)}–${yen(cost.max).replace('¥', '')}`;
  const twdText = twdIfBig(cost, rate?.jpyToTwd, 500);
  const twdSpan = twdText ? ` <span class="approx">≈ ${twdText}</span>` : '';
  return `<div class="cost">預估 <span class="amt nw">${yenText}</span>${twdSpan}</div>`;
}

function renderItems(day, nowInfo, ctx) {
  const items = day.items || [];
  const parts = [];
  let prevSeg = null;

  items.forEach((it, i) => {
    if (it.segment && it.segment !== prevSeg) {
      parts.push(`<div class="segdiv"><span class="label">${SEG_LABEL[it.segment] || it.segment}</span></div>`);
      prevSeg = it.segment;
    }

    if (it.kind === 'transit' && !it.asCard) {
      parts.push(renderCommute(it, ctx));
      return;
    }

    // 走路／移動列的導航目的地＝當前這張卡片的 spot
    if (it.transit && it.kind !== 'transit') {
      const spot = it.spotId ? ctx.data.spots.find(s => s.id === it.spotId) : null;
      parts.push(renderTransit(it.transit, spot));
    }
    parts.push(renderCard(it, nowInfo, ctx));
  });

  return items.length ? parts.join('') : `<div class="empty">這天還沒有項目</div>`;
}

function renderCommute(it, ctx) {
  const modeIcon = MODE_ICON[it.transit?.mode] || '🚇';
  const t = escapeHtml(it.time || '');
  const title = escapeHtml(it.title || '');
  const detail = it.transit?.detail;
  const suffix = detail
    ? ` · ${escapeHtml(detail)}`
    : (it.transit?.minutes ? ` · ${it.transit.minutes} 分` : '');
  const costText = yenRange(it.cost);
  const twdText = twdIfBig(it.cost, ctx.data.rate?.jpyToTwd, 500);
  const costParts = costText ? `<span class="cost nw">${costText}</span>` : '';
  const twdSpan = twdText ? ` <span class="approx">≈ ${twdText}</span>` : '';
  const pay = renderPayChip(it.pay);
  const nav = it.mapQuery
    ? `<a class="mapmini" href="${mapsUrl(it.mapQuery, it.transit?.mode)}" target="_blank" rel="noopener" aria-label="用 Google Maps 導航">🗺</a>`
    : '';

  return `
    <div class="commute" data-item-id="${escapeHtml(it.id)}"${it.pay ? ` data-pay="${escapeHtml(it.pay)}"` : ''}>
      <span class="mode" aria-hidden="true">${modeIcon}</span>
      <span class="t">${t}</span>
      <span class="body"><b>${title}</b>${suffix}</span>
      ${costParts}${twdSpan}${pay}${nav}
    </div>
  `;
}

function renderTransit(t, destSpot) {
  const modeIcon = MODE_ICON[t.mode] || '↳';
  const body = t.detail || (t.minutes ? `${t.minutes} 分` : (t.mode || ''));
  const nav = destSpot?.mapQuery
    ? `<a class="mapmini" href="${mapsUrl(destSpot.mapQuery, t.mode)}" target="_blank" rel="noopener" aria-label="用 Google Maps 導航">🗺</a>`
    : '';
  const costText = t.cost ? yenRange(t.cost) : '';
  const pay = renderPayChip(t.pay);
  return `
    <div class="transit-row">
      <span class="mode">${modeIcon}</span>
      <span class="body">${escapeHtml(body)}</span>
      ${costText ? `<span class="cost mono nw">${costText}</span>` : ''}
      ${pay}${nav}
    </div>
  `;
}

function renderCard(it, nowInfo, ctx) {
  const cat = KIND_CAT[it.kind] || 'transit';
  const icon = KIND_ICON[it.kind] || '•';
  const status = it.status || 'normal';
  const isNow = nowInfo.nowId === it.id;
  const isNext = nowInfo.nextId === it.id;
  const hlClass = isNow ? ' now' : (isNext ? ' next' : '');

  const time = it.time
    ? `<span class="time mono nw">${escapeHtml(it.time)}${it.endTime ? '–' + escapeHtml(it.endTime) : ''}</span>`
    : '';

  const tags = [];
  if (isNow)  tags.push(`<span class="pill now">正在進行</span>`);
  if (isNext) tags.push(`<span class="pill next">接下來</span>`);

  const spot = it.spotId ? ctx.data.spots.find(s => s.id === it.spotId) : null;
  const desc = it.desc || spot?.oneLine || '';
  const tipsHtml = renderTipsBlock(it.tips);
  const allergyHtml = it.allergy === 'ask'
    ? `<a href="#" class="allergy-row" data-open-allergy role="button" aria-label="打開過敏大字卡"><span class="ico">🦐</span><span class="body">甲殼類：入座後先跟店家講一次 · 點開大字卡</span></a>`
    : '';
  const costHtml = renderCostRow(it, ctx);

  const actions = [];
  if (it.spotId && spot) {
    const label = SPOT_BTN[spot.category] || '看更多 →';
    actions.push(`<a class="btn" href="#/spot/${encodeURIComponent(it.spotId)}">${label}</a>`);
    if (spot.mapQuery) {
      actions.push(`<a class="btn btn-icon" href="${mapsUrl(spot.mapQuery)}" target="_blank" rel="noopener" aria-label="用 Google Maps 導航">🗺</a>`);
    }
    // 手帳：小圖示按鈕，跟 🗺 並排
    actions.push(`<button type="button" class="btn btn-icon" data-jrn-spot="${escapeHtml(it.spotId)}" data-jrn-day="${it.dayN || ''}" aria-label="拍照記錄">📷</button>`);
  }
  // 🎫：這個 item 有票券 → 跳到 tickets 頁
  if (ctx.__ticketedItemIds && ctx.__ticketedItemIds.has(it.id)) {
    actions.push(`<a class="btn btn-icon" href="#/tools/tickets" aria-label="打開票券頁">🎫</a>`);
  }
  // 特定行程項目的外部 App 連結
  if (it.id === 'd1-14') {
    actions.push(`<a class="btn btn-icon" href="https://line.me/R/ti/p/@yatai_fukuoka" target="_blank" rel="noopener" aria-label="LINE 福岡屋台官方帳號">💬</a>`);
  }
  if (it.guideId) {
    actions.push(`<a class="btn" href="#/guide/${encodeURIComponent(it.guideId)}">✈️ 流程怎麼走 →</a>`);
  }

  const apccasAttr = it.apccas
    ? ` data-apccas data-apccas-label="${it.apccasHighlight ? '你的報告' : 'APCCAS'}"${it.apccasHighlight ? ' data-apccas-highlight' : ''}`
    : '';

  return `
    <article class="card${hlClass}" data-cat="${cat}" data-status="${status}" data-item-id="${escapeHtml(it.id)}"${apccasAttr}>
      <div class="barleft"></div>
      <div class="inner">
        <div class="row1">
          ${time}
          <span class="iconbox" aria-hidden="true">${icon}</span>
          <span class="tags">${tags.join('')}</span>
        </div>
        <div class="title">${escapeHtml(it.title || '')}</div>
        <div class="segs">
          ${desc ? `<div class="desc">${mdInline(desc)}</div>` : ''}
          ${tipsHtml}
          ${allergyHtml}
          ${costHtml}
        </div>
        ${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}
      </div>
    </article>
  `;
}

// 每日底部：今天要注意的 N 條（用 tips.days 過濾，days=null 不算）
function renderTodayTips(day, ctx) {
  const tips = ctx.data.tips || [];
  const today = day.n;
  const list = tips.filter(t => Array.isArray(t.days) && t.days.includes(today));
  if (!list.length) return '';
  const RANK = { critical: 0, important: 1, info: 2 };
  list.sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));
  const items = list.map(t => {
    const sev = t.severity || 'info';
    return `
      <li class="sev-${sev === 'critical' ? 'crit' : sev === 'important' ? 'imp' : 'info'}">
        <span class="dot" aria-hidden="true"></span>
        <a class="text" href="#/tools/tips?highlight=${encodeURIComponent(t.id)}">${escapeHtml(t.title || '')}</a>
        <span class="chev">›</span>
      </li>
    `;
  }).join('');
  return `
    <section class="today-tips">
      <div class="head">💡 今天要注意的 ${list.length} 條</div>
      <ul>${items}</ul>
    </section>
  `;
}

function renderTipsBlock(tips) {
  if (!Array.isArray(tips) || tips.length === 0) return '';
  const items = tips.map((t, i) => `
    <li>
      <span class="lead" aria-hidden="true">${i === 0 ? '💡' : '·'}</span>
      <span class="body">${mdInline(t)}</span>
    </li>
  `).join('');
  return `<div class="tips"><ul>${items}</ul></div>`;
}

function renderCostRow(it, ctx) {
  const label = yenRange(it.cost);
  const payChip = renderPayChip(it.pay);
  if (!label && !payChip) return '';
  const twdText = twdIfBig(it.cost, ctx.data.rate?.jpyToTwd, 500);
  const money = label ? `<span class="ico">💴</span><span class="nw">${label}</span>` : '';
  const twdSpan = twdText ? ` <span class="approx">≈ ${twdText}</span>` : '';
  return `<div class="cost-row">${money}${twdSpan}${payChip}</div>`;
}

function renderPayChip(pay) {
  if (!pay) return '';
  const spec = PAY_CHIP[pay];
  if (!spec) return '';
  const cls = spec.cls ? ` ${spec.cls}` : '';
  if (spec.tipId) {
    // 有 tip 的：做成鍵盤可達的 <button>，全域 handler 抓 data-tip 跳到那條
    return `<button type="button" class="paychip${cls}" data-tip="${spec.tipId}" aria-label="${spec.text}｜點看攻略">${spec.text}</button>`;
  }
  return `<span class="paychip${cls}">${spec.text}</span>`;
}

