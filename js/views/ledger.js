// 記帳頁：一頁式輸入 + 列表 + 匯出
// - 送出當下寫 IndexedDB（含 rateUsed / twd snapshot）
// - 每筆自帶「可報帳」旗標
// - CSV 匯出（UTF-8 BOM）＋ 手機分享／下載／複製三段備援

import { escapeHtml, mdInline } from '../lib/md.js';
import { yen, twdExact, md as mdDate } from '../lib/fmt.js';
import { isAvailable, putLedger, deleteLedger, getAllLedger } from '../lib/db.js';
import { getRate, onChange as onRateChange } from '../lib/rate.js';
import { findNowContext, todayISO } from '../lib/nowitem.js';

const CATS = [
  { key: 'food',    label: '🍽 餐飲' },
  { key: 'transit', label: '🚇 交通' },
  { key: 'shop',    label: '🛍 購物' },
  { key: 'ticket',  label: '🎟 門票' },
  { key: 'hotel',   label: '🏨 住宿' },
  { key: 'other',   label: '🧾 其他' },
];
const CAT_LABEL = Object.fromEntries(CATS.map(c => [c.key, c.label]));

const DAILY_BUDGET_TWD = 8000;
const LS_LAST_EXPORT = 'ledger.lastExport';   // YYYY-MM-DD

export async function render(root, params, ctx) {
  const dbOk = await isAvailable();
  if (!dbOk) {
    root.innerHTML = `
      <div class="wrap">
        <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
        <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">記帳</h1>
        <div class="empty">這個瀏覽器不允許儲存（可能是隱私模式）。記帳暫時不能用，請改用一般模式或別台裝置。</div>
      </div>`;
    return;
  }

  const nowCtx = findNowContext(ctx.data.days);
  const defaultDate = nowCtx.todayStr || todayISO();
  const defaultItemId = nowCtx.item?.id || '';
  const defaultDayN = nowCtx.day?.n ?? null;
  const defaultCat = suggestCategoryFromItem(nowCtx.item);
  const defaultReimb = (defaultCat === 'hotel');

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">記帳</h1>

      <div id="exportNudge" hidden></div>

      <section class="ldg-input">
        <div class="ldg-amount-row">
          <div class="ldg-yen">¥</div>
          <input id="ldgAmount" class="ldg-amount" inputmode="decimal" placeholder="0" aria-label="金額（日圓）">
        </div>
        <div class="ldg-preview" id="ldgPreview">≈ NT$—</div>

        <div class="ldg-chips" id="ldgCats" role="radiogroup" aria-label="分類">
          ${CATS.map(c => `
            <button type="button" class="chip" data-cat="${c.key}"
                    ${c.key === defaultCat ? 'aria-current="true"' : ''}>${c.label}</button>
          `).join('')}
        </div>

        <div class="ldg-meta">
          <label class="ldg-field">
            <span class="k">日期</span>
            <input type="date" id="ldgDate" value="${defaultDate}">
          </label>
          <label class="ldg-field">
            <span class="k">關聯行程</span>
            <select id="ldgItem">
              <option value="">（不關聯）</option>
              ${renderItemOptions(ctx.data.days, defaultDate, defaultItemId)}
            </select>
          </label>
        </div>

        <label class="ldg-reimb">
          <input type="checkbox" id="ldgReimb" ${defaultReimb ? 'checked' : ''}>
          <span>可報帳（例如 Comfort Inn 住宿）</span>
        </label>

        <label class="ldg-note-row">
          <input id="ldgNote" placeholder="備註（選填）" maxlength="80">
        </label>

        <div class="ldg-submit-row">
          <button type="button" class="btn btn-primary" id="ldgSubmit">加入 →</button>
          <span class="ldg-hint faint small" id="ldgHint">用日圓輸入。台幣自動換算。</span>
        </div>
      </section>

      <section class="ldg-summary" id="ldgSummary"></section>

      <section class="ldg-list" id="ldgList"></section>

      <section class="ldg-exports">
        <button type="button" class="btn" id="expAll">📤 匯出全部</button>
        <button type="button" class="btn" id="expReimb">📤 只匯出可報帳</button>
        <button type="button" class="btn" id="expCopy">📋 複製成文字</button>
      </section>

      <div id="confirmSlot"></div>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const amountInput = $('#ldgAmount');
  const previewEl   = $('#ldgPreview');
  const catsEl      = $('#ldgCats');
  const dateInput   = $('#ldgDate');
  const itemSelect  = $('#ldgItem');
  const reimbInput  = $('#ldgReimb');
  const noteInput   = $('#ldgNote');
  const submitBtn   = $('#ldgSubmit');
  const summaryEl   = $('#ldgSummary');
  const listEl      = $('#ldgList');
  const nudgeEl     = $('#exportNudge');

  // ==== 狀態
  let rows = [];         // 全部記帳資料
  let currentCat = defaultCat;
  let editingId  = null; // 若在編輯中

  amountInput.addEventListener('input', paintPreview);
  onRateChange(paintPreview);

  catsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (!btn) return;
    catsEl.querySelectorAll('button').forEach(b => b.removeAttribute('aria-current'));
    btn.setAttribute('aria-current', 'true');
    currentCat = btn.getAttribute('data-cat');
    // 分類切成 hotel → 預設打勾；其他 → 不動使用者已改過的
    if (currentCat === 'hotel' && !reimbInput.dataset.userTouched) reimbInput.checked = true;
    if (currentCat !== 'hotel' && !reimbInput.dataset.userTouched) reimbInput.checked = false;
  });
  reimbInput.addEventListener('change', () => { reimbInput.dataset.userTouched = '1'; });

  dateInput.addEventListener('change', () => {
    // 換日期→重繪 item 選單
    itemSelect.innerHTML = `<option value="">（不關聯）</option>` + renderItemOptions(ctx.data.days, dateInput.value, '');
  });

  submitBtn.addEventListener('click', onSubmit);
  amountInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSubmit(); });

  $('#expAll').addEventListener('click', () => onExport(rows, `fukuoka-ledger-${todayISO().replace(/-/g,'')}.csv`));
  $('#expReimb').addEventListener('click', () => onExport(rows.filter(r => r.reimbursable), `fukuoka-ledger-報帳-${todayISO().replace(/-/g,'')}.csv`));
  $('#expCopy').addEventListener('click', () => onCopy(rows));

  // ==== 初始渲染
  paintPreview();
  await reload();
  setTimeout(() => amountInput.focus(), 30);

  // ==== 提醒：20:00 之後且今天還沒匯出
  maybeShowExportNudge();

  // ==== 工具函式（closure）
  function paintPreview() {
    const v = parseFloat(amountInput.value);
    if (!isFinite(v) || v <= 0) { previewEl.textContent = '≈ NT$—'; return; }
    const r = getRate();
    previewEl.innerHTML = `≈ <b>${twdExact(v, r.jpyToTwd)}</b> <span class="faint small">（${escapeHtml(rateBadge(r))}）</span>`;
  }

  async function onSubmit() {
    const v = parseFloat(amountInput.value);
    if (!isFinite(v) || v <= 0) {
      amountInput.focus();
      shake(amountInput);
      return;
    }
    const r = getRate();
    const date = dateInput.value || todayISO();
    const time = nowHHMM();
    const dayN = findDayN(ctx.data.days, date);
    const row = {
      id: editingId || cryptoUUID(),
      ts: Date.now(),
      date, time,
      category: currentCat,
      jpy: v,
      twd: Math.round(v * r.jpyToTwd),
      rateUsed: r.jpyToTwd,
      itemId: itemSelect.value || null,
      dayN,
      note: (noteInput.value || '').trim(),
      reimbursable: !!reimbInput.checked,
    };
    try {
      await putLedger(row);
    } catch (e) {
      alert('儲存失敗：' + (e.message || e));
      return;
    }
    // reset input
    amountInput.value = '';
    noteInput.value = '';
    editingId = null;
    submitBtn.textContent = '加入 →';
    paintPreview();
    amountInput.focus();
    await reload();
  }

  async function reload() {
    rows = (await getAllLedger()).sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.time || '').localeCompare(a.time || '');
    });
    paintSummary();
    paintList();
  }

  function paintSummary() {
    const today = dateInput.value || todayISO();
    const todayRows  = rows.filter(r => r.date === today);
    const todayJpy   = todayRows.reduce((s, r) => s + r.jpy, 0);
    const todayTwd   = todayRows.reduce((s, r) => s + r.twd, 0);
    const totalJpy   = rows.reduce((s, r) => s + r.jpy, 0);
    const totalTwd   = rows.reduce((s, r) => s + r.twd, 0);
    const reimbJpy   = rows.filter(r => r.reimbursable).reduce((s, r) => s + r.jpy, 0);
    const reimbTwd   = rows.filter(r => r.reimbursable).reduce((s, r) => s + r.twd, 0);
    const pct = Math.min(100, Math.round(todayTwd / DAILY_BUDGET_TWD * 100));
    const over = todayTwd > DAILY_BUDGET_TWD;
    summaryEl.innerHTML = `
      <div class="ldg-sum">
        <div class="ldg-sum-row">
          <span class="k">今日</span>
          <span class="v mono nw">${yen(todayJpy)}</span>
          <span class="approx">≈ NT$${todayTwd.toLocaleString()}</span>
        </div>
        <div class="ldg-budget${over ? ' over' : ''}">
          <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
          <div class="txt">日預算 <span class="mono">NT$${DAILY_BUDGET_TWD.toLocaleString()}</span> · ${pct}%</div>
        </div>
        <div class="ldg-sum-row muted">
          <span class="k">全程累計</span>
          <span class="v mono nw">${yen(totalJpy)}</span>
          <span class="approx">≈ NT$${totalTwd.toLocaleString()}</span>
        </div>
        <div class="ldg-sum-row reimb">
          <span class="k">可報帳合計</span>
          <span class="v mono nw">${yen(reimbJpy)}</span>
          <span class="approx">≈ NT$${reimbTwd.toLocaleString()}</span>
        </div>
      </div>
    `;
  }

  function paintList() {
    if (rows.length === 0) {
      listEl.innerHTML = `<div class="empty">還沒有任何一筆。上面輸入金額按「加入」。</div>`;
      return;
    }
    const groups = groupByDate(rows);
    listEl.innerHTML = groups.map(([date, list]) => {
      const sum = list.reduce((s, r) => s + r.jpy, 0);
      return `
        <section class="ldg-day">
          <div class="ldg-day-head">
            <span class="d">${escapeHtml(mdDate(date))}</span>
            <span class="tot mono nw">${yen(sum)}</span>
          </div>
          ${list.map(renderRow).join('')}
        </section>
      `;
    }).join('');

    listEl.querySelectorAll('.ldg-row').forEach(row => {
      row.querySelector('.act-edit')?.addEventListener('click', () => onEdit(row.dataset.id));
      row.querySelector('.act-del')?.addEventListener('click', () => onDelete(row.dataset.id));
    });
  }

  function renderRow(r) {
    const itemLabel = r.itemId ? findItemLabel(ctx.data.days, r.itemId) : '';
    return `
      <div class="ldg-row" data-id="${escapeHtml(r.id)}"${r.reimbursable ? ' data-reimb' : ''}>
        <div class="head">
          <span class="cat">${escapeHtml(CAT_LABEL[r.category] || r.category)}</span>
          <span class="time mono">${escapeHtml(r.time || '')}</span>
          ${r.reimbursable ? '<span class="tag-reimb">可報帳</span>' : ''}
        </div>
        <div class="amt">
          <span class="mono nw">${yen(r.jpy)}</span>
          <span class="approx">≈ NT$${(r.twd ?? 0).toLocaleString()}</span>
          <span class="rate faint tiny nw">@ ${r.rateUsed?.toFixed(4)}</span>
        </div>
        ${itemLabel ? `<div class="link small faint">↳ ${escapeHtml(itemLabel)}</div>` : ''}
        ${r.note ? `<div class="note small">${mdInline(r.note)}</div>` : ''}
        <div class="acts">
          <button type="button" class="mini act-edit">編輯</button>
          <button type="button" class="mini act-del">刪除</button>
        </div>
      </div>
    `;
  }

  function onEdit(id) {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    editingId = id;
    amountInput.value = String(r.jpy);
    noteInput.value = r.note || '';
    dateInput.value = r.date;
    reimbInput.checked = !!r.reimbursable;
    reimbInput.dataset.userTouched = '1';
    // 分類選中
    catsEl.querySelectorAll('button').forEach(b => b.removeAttribute('aria-current'));
    const catBtn = catsEl.querySelector(`button[data-cat="${r.category}"]`);
    if (catBtn) catBtn.setAttribute('aria-current', 'true');
    currentCat = r.category;
    // item 選項
    itemSelect.innerHTML = `<option value="">（不關聯）</option>` + renderItemOptions(ctx.data.days, r.date, r.itemId || '');
    submitBtn.textContent = '更新 ✓';
    paintPreview();
    amountInput.focus();
    amountInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function onDelete(id) {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    const ok = await confirmDialog(`要刪除這筆嗎？\n${CAT_LABEL[r.category]} · ${yen(r.jpy)} · ${r.date}`);
    if (!ok) return;
    await deleteLedger(id);
    await reload();
  }

  async function onExport(list, filename) {
    if (!list.length) { alert('沒有可匯出的資料'); return; }
    const csv = buildCSV(list, ctx.data.days);
    await downloadCSV(csv, filename);
    try { localStorage.setItem(LS_LAST_EXPORT, todayISO()); } catch {}
    hideExportNudge();
  }
  async function onCopy(list) {
    if (!list.length) { alert('沒有可複製的資料'); return; }
    const csv = buildCSV(list, ctx.data.days);
    try {
      await navigator.clipboard.writeText(csv);
      toast('已複製到剪貼簿');
      localStorage.setItem(LS_LAST_EXPORT, todayISO());
      hideExportNudge();
    } catch {
      const w = window.open('', '_blank');
      if (w) { w.document.body.innerText = csv; }
      else prompt('手動複製這段：', csv);
    }
  }

  function confirmDialog(msg) {
    return new Promise(resolve => {
      const slot = $('#confirmSlot');
      slot.innerHTML = `
        <div class="cd-overlay">
          <div class="cd-sheet">
            <div class="cd-msg">${escapeHtml(msg)}</div>
            <div class="cd-btns">
              <button type="button" class="btn" data-r="0">取消</button>
              <button type="button" class="btn btn-primary" data-r="1">刪除</button>
            </div>
          </div>
        </div>`;
      const close = (v) => { slot.innerHTML = ''; resolve(!!v); };
      slot.querySelectorAll('button[data-r]').forEach(b =>
        b.addEventListener('click', () => close(b.getAttribute('data-r') === '1'))
      );
      slot.querySelector('.cd-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) close(false);
      });
    });
  }

  function maybeShowExportNudge() {
    const h = new Date().getHours();
    if (h < 20) return;
    let last;
    try { last = localStorage.getItem(LS_LAST_EXPORT); } catch {}
    if (last === todayISO()) return;
    if (!rows.length) return;
    nudgeEl.hidden = false;
    nudgeEl.innerHTML = `
      <div class="ldg-nudge">
        <span class="ico">💾</span>
        <span class="body">今天還沒備份，要不要匯出一份？</span>
        <button type="button" class="btn btn-primary" id="nudgeExport">匯出全部</button>
        <button type="button" class="cd-x" aria-label="關閉">✕</button>
      </div>
    `;
    nudgeEl.querySelector('#nudgeExport').addEventListener('click',
      () => onExport(rows, `fukuoka-ledger-${todayISO().replace(/-/g,'')}.csv`));
    nudgeEl.querySelector('.cd-x').addEventListener('click', () => nudgeEl.hidden = true);
  }
  function hideExportNudge() { nudgeEl.hidden = true; }
}

// ==================== 小工具 ====================

function cryptoUUID() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  // fallback
  return 'r_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function findDayN(days, date) {
  const d = (days || []).find(x => x.date === date);
  return d ? d.n : null;
}
function findItemLabel(days, itemId) {
  for (const d of (days || [])) {
    const it = (d.items || []).find(x => x.id === itemId);
    if (it) return `${d.date}｜${it.time || ''} ${it.title || ''}`;
  }
  return itemId;
}
function renderItemOptions(days, date, selected) {
  const d = (days || []).find(x => x.date === date);
  if (!d) return '';
  return (d.items || []).filter(it => it.time).map(it => `
    <option value="${escapeHtml(it.id)}"${it.id === selected ? ' selected' : ''}>${escapeHtml(`${it.time} ${it.title || ''}`)}</option>
  `).join('');
}
function suggestCategoryFromItem(it) {
  if (!it) return 'food';
  const map = { meal: 'food', flight: 'transit', transit: 'transit', shopping: 'shop', sight: 'ticket', hotel: 'hotel' };
  return map[it.kind] || 'food';
}
function rateBadge(r) {
  if (r.tag === 'override') return `手動 ¥1=NT$${r.jpyToTwd.toFixed(4)}`;
  if (r.tag === 'live')     return `即期 ¥1=NT$${r.jpyToTwd.toFixed(4)}`;
  if (r.tag === 'stale')    return `舊值 ¥1=NT$${r.jpyToTwd.toFixed(4)}`;
  return `基準 ¥1=NT$${r.jpyToTwd.toFixed(4)}`;
}
function shake(el) {
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 320);
}
function groupByDate(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date).push(r);
  }
  return [...map.entries()];
}

// ==================== CSV ====================

function csvField(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
export function buildCSV(list, days) {
  const header = ['日期','時間','分類','日圓','台幣','當時匯率','關聯行程','可報帳','備註'];
  const lines = [header.map(csvField).join(',')];
  // 用日期＋時間排序，早的在前
  const sorted = list.slice().sort((a, b) =>
    (a.date === b.date) ? (a.time || '').localeCompare(b.time || '') : (a.date < b.date ? -1 : 1));
  for (const r of sorted) {
    lines.push([
      r.date, r.time || '',
      CAT_LABEL[r.category] || r.category,
      r.jpy, r.twd,
      r.rateUsed?.toFixed?.(4) ?? r.rateUsed,
      r.itemId ? findItemLabel(days, r.itemId) : '',
      r.reimbursable ? '是' : '',
      r.note || '',
    ].map(csvField).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

async function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const file = new File([blob], filename, { type: 'text/csv' });
  // ① 系統分享（iOS/Android PWA 首選）
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch { /* 分享被拒 → 掉到 ② */ }
  // ② <a download>
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    return;
  } catch { /* fall through */ }
  // ③ 開新視窗顯示原文
  try {
    const w = window.open('', '_blank');
    if (w) { w.document.body.innerText = csv; return; }
  } catch {}
  // ④ 提示複製
  prompt('複製這段（CSV）：', csv);
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 1800);
}

// 給 tools 頁用：算今日累計 ¥
export async function todayLedgerYen() {
  try {
    if (!(await isAvailable())) return null;
    const rows = await getAllLedger();
    const today = todayISO();
    return rows.filter(r => r.date === today).reduce((s, r) => s + (r.jpy || 0), 0);
  } catch { return null; }
}
