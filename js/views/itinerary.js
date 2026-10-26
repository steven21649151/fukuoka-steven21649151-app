// 行程列表（首頁）
import { mdInline, escapeHtml, phraseWrap } from '../lib/md.js';
import { yen, yenRange, md, twdIfBig } from '../lib/fmt.js';
import { mapsUrl } from '../lib/maps.js';
import { computeNowInDay, todayISO } from '../lib/nowitem.js';
import { ticketedItemIds, isAvailable as dbAvailable, getAllLedger } from '../lib/db.js';
import { openLedgerSheet } from '../lib/ledger_sheet.js';

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
  card:   { text: '刷卡感應',   cls: 'touch', tipId: null },
  ic:     { text: '嗶卡／Suica', cls: 'touch', tipId: 'tp-kumamoto-ic' },
  pass:   { text: '一日券',     cls: 'pass',  tipId: 'tp-kumamoto-ic' },
  ticket: { text: '車站取票',   cls: '',       tipId: null },
  qr:     { text: 'App QR 碼',  cls: '',       tipId: null },
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

  // 每個行程項目已經記了多少錢（只讀；失敗就當作空的，行程頁照常顯示）
  const ledgerByItem = new Map();
  try {
    if (await dbAvailable()) {
      for (const r of await getAllLedger()) {
        if (r && r.itemId) ledgerByItem.set(r.itemId, (ledgerByItem.get(r.itemId) || 0) + (Number(r.jpy) || 0));
      }
    }
  } catch { ledgerByItem.clear(); }
  ctx.__ledgerByItem = ledgerByItem;

  root.innerHTML = `
    <div class="wrap">
      ${renderDayHeader(day, ctx)}
      ${renderItems(day, nowInfo, ctx)}
      ${renderTodayTips(day, ctx)}
    </div>
  `;

  // 💴 pill：不換頁，跳出這一格的記帳明細（底部面板）。出錯只顯示提示，不影響行程頁
  root.querySelector('.wrap').addEventListener('click', (e) => {
    const pill = e.target.closest('.ldg-pill[data-ldg-item]');
    if (!pill) return;
    openLedgerSheet({
      itemId: pill.dataset.ldgItem,
      date: pill.dataset.ldgDate,
      title: pill.dataset.ldgTitle,
      lookup: ctx.data.daysLookup,
      // 面板裡刪了東西：行程頁重畫一次，pill 金額跟著變（刪到 0 筆 pill 就消失）
      onChange: () => { render(root, params, ctx, { restored: true }); },
    }).catch((err) => console.error('記帳面板開不起來', err));
  });

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
        <h1>${phraseWrap(day.title || '')}</h1>
        ${renderPlanTag(day, ctx)}
      </div>
      <div class="date">${escapeHtml(md(day.date))}（${escapeHtml(day.weekday || '')}）</div>
      ${day.summary ? `<p class="summary">${mdInline(day.summary)}</p>` : ''}
      ${est}
    </header>
  `;
}

// 只有兩版不一樣的那幾天（10/25、10/26、10/28）顯示目前是哪一版，點了到設定切換
function renderPlanTag(day, ctx) {
  if (!(ctx.data.rainDayNums || []).includes(day.n)) return '';
  const rain = ctx.data.plan !== 'sunny';
  return `<a class="plan-tag${rain ? ' rain' : ' sunny'}" href="#/tools/settings" aria-label="切換行程版本">${rain ? '🌧 雨天版' : '☀️ 晴天版'}</a>`;
}

function renderEstimate(cost, rate) {
  const yenText = `${yen(cost.min)}–${yen(cost.max).replace('¥', '')}`;
  const twdText = twdIfBig(cost, rate?.jpyToTwd, 500);
  const twdSpan = twdText ? ` <span class="approx">≈ ${twdText}</span>` : '';
  return `<div class="cost">預估 <span class="amt nw">${yenText}</span>${twdSpan}</div>`;
}

function renderItems(day, nowInfo, ctx) {
  const items = (day.items || []).map(it => ({ ...it, dayN: day.n }));   // 📷 按鈕帶這一天
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
    if (it.transit && (it.kind !== 'transit' || it.asCard)) {
      const spot = it.spotId ? ctx.data.spots.find(s => s.id === it.spotId)
                 : (it.mapQuery ? { mapQuery: it.mapQuery } : null);
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
    ? ` · ${mdInline(detail)}`
    : (it.transit?.minutes ? ` · ${it.transit.minutes} 分` : '');
  const costText = (it.pay === 'free' && it.cost && it.cost.max === 0) ? '' : yenRange(it.cost);
  const twdText = twdIfBig(it.cost, ctx.data.rate?.jpyToTwd, 500);
  const costParts = costText ? `<span class="cost nw">${costText}</span>` : '';
  const twdSpan = twdText ? ` <span class="approx">≈ ${twdText}</span>` : '';
  const pay = renderPayChip(it.pay);
  const nav = it.mapQuery
    ? `<a class="mapmini" href="${mapsUrl(it.mapQuery, it.transit?.mode)}" target="_blank" rel="noopener" aria-label="用 Google Maps 導航">🗺</a>`
    : '';
  const meta = (costParts || twdSpan || pay) ? `<span class="meta">${costParts}${twdSpan}${pay}</span>` : '';

  return `
    <div class="commute" data-item-id="${escapeHtml(it.id)}"${it.pay ? ` data-pay="${escapeHtml(it.pay)}"` : ''}>
      <span class="mode" aria-hidden="true">${modeIcon}</span>
      <span class="t">${t}</span>
      <span class="body"><b>${title}</b>${suffix}${meta}</span>
      ${nav}
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
      <span class="body">${mdInline(body)}${(costText || pay) ? `<span class="meta">${costText ? `<span class="cost mono nw">${costText}</span>` : ''}${pay}</span>` : ''}</span>
      ${nav}
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
  const costHtml = renderCostRow(it, ctx, spot);
  const buyHtml = renderBuyLine(it, spot);
  const altsHtml = renderAlts(it, ctx);

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
  // 文A：開啟對話字卡，跳到 phraseScene 指定的場景（沒指定就不顯示）
  const phraseScene = it.phraseScene || null;
  if (phraseScene) {
    actions.push(`<a class="btn btn-icon btn-trans" href="#/tools/phrases?scene=${encodeURIComponent(phraseScene)}" aria-label="開啟對話字卡"><span class="trans-ico" aria-hidden="true">文<small>A</small></span></a>`);
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
  // 自訂連結：days item 的選填欄位 links: [{ href, label }]
  for (const l of it.links || []) {
    actions.push(`<a class="btn" href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`);
  }

  // 右上角：這一格已經記了多少錢（只有 > 0 才顯示）。放在 row1 最右邊、tags 後面，跟 APCCAS 立牌（row1 已退位）與「正在進行」pill 不會重疊
  let spendHtml = '';
  try {
    const spent = ctx.__ledgerByItem && ctx.__ledgerByItem.get(it.id);
    if (spent > 0) {
      const date = (ctx.data.days.find(d => d.n === it.dayN) || {}).date || '';
      spendHtml = `<button type="button" class="ldg-pill" data-ldg-item="${escapeHtml(it.id)}" data-ldg-date="${escapeHtml(date)}" data-ldg-title="${escapeHtml(String(it.title || '').replace(/[*`]/g, ''))}" aria-label="這一格已記 ${yen(spent)}，點了看明細">💴 ${yen(spent)}</button>`;
    }
  } catch { spendHtml = ''; }

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
          ${spendHtml}
        </div>
        <div class="title">${phraseWrap(it.title || '')}</div>
        <div class="segs">
          ${desc ? `<div class="desc">${mdInline(desc)}</div>` : ''}
          ${buyHtml}
          ${tipsHtml}
          ${altsHtml}
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
  // 選雨天版時，有 rainDays 的 tip 用 rainDays 判斷，沒有的照舊用 days
  const rain = ctx.data.plan === 'rain';
  const list = tips.filter(t => {
    const ds = rain && Array.isArray(t.rainDays) ? t.rainDays : t.days;
    return Array.isArray(ds) && ds.includes(today);
  });
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

function renderCostRow(it, ctx, spot) {
  const label = yenRange(it.cost);
  const payChip = renderPayChip(it.pay) + renderPxChip(spot);
  if (!label && !payChip) return '';
  const twdText = twdIfBig(it.cost, ctx.data.rate?.jpyToTwd, 500);
  const money = label ? `<span class="ico">💴</span><span class="nw">${label}</span>` : '';
  const twdSpan = twdText ? ` <span class="approx">≈ ${twdText}</span>` : '';
  return `<div class="cost-row">${money}${twdSpan}${payChip}</div>`;
}

// 📱全支付：spot 的 pxpay 是 "yes"（確定收 PayPay）或 "some"（部分店家收）。點了跳到 tp-pxpay
function renderPxChip(spot) {
  const v = spot && spot.pxpay;
  if (v !== 'yes' && v !== 'some') return '';
  const text = v === 'yes' ? '📱全支付' : '📱部分店家';
  return `<button type="button" class="paychip pxpay" data-tip="tp-pxpay" aria-label="${text}｜點看攻略">${text}</button>`;
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


// 🛍 推薦：把 spot.buy 每項的短名接成一行，整行連到內頁（不顯示件數、不做勾選）
function renderBuyLine(it, spot) {
  const buy = Array.isArray(spot?.buy) ? spot.buy : [];
  if (!it.spotId || buy.length === 0) return '';
  const names = buy.map(b => b.zh || b.name).filter(Boolean).join('、');
  return `<a class="buy-line" href="#/spot/${encodeURIComponent(it.spotId)}">🛍 推薦：${escapeHtml(names)}</a>`;
}

// 「也可以選：」備選 chip（餐廳卡的 alts：spot id 陣列），點了進該 spot 內頁
function renderAlts(it, ctx) {
  const alts = (it.alts || []).map(id => (ctx.data.spots || []).find(s => s.id === id)).filter(Boolean);
  if (!alts.length) return '';
  return `<div class="alts-row"><span class="alts-k">也可以選：</span>${
    alts.map(s => `<a class="alt-chip" href="#/spot/${encodeURIComponent(s.id)}">${escapeHtml(s.nameZh || s.name || s.id)}${s.pxpay === 'yes' ? '<small class="alt-px" aria-label="可用全支付"> 📱</small>' : ''}</a>`).join('')
  }</div>`;
}
