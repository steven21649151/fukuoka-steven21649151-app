// 記帳頁：只留「記」——輸入區、今日摘要、最新 3 筆
// - 送出當下寫 IndexedDB（含 rateUsed / twd snapshot）
// - 每筆自帶「可報帳」旗標
// - 完整明細、匯出 CSV、複製 都在帳務分析頁（#/tools/stats）
// - ?edit=<id>：一進來就載入那一筆，存完回上一頁
// - ?date=…&item=…：預填日期和行程項目（行程卡「再記一筆」用）

import { escapeHtml } from '../lib/md.js';
import { yen, twdExact } from '../lib/fmt.js';
import { isAvailable, putLedger, deleteLedger, getAllLedger } from '../lib/db.js';
import { getRate, onChange as onRateChange } from '../lib/rate.js';
import { findNowContext, todayISO } from '../lib/nowitem.js';
import { DAILY_BUDGET_TWD } from '../lib/ledger_chart.js';
import { getPrevHash } from '../router.js';
import {
  rowHtml, confirmDelete, deleteMsg, toast, buildCSV, downloadCSV, markExported, LS_LAST_EXPORT,
} from '../lib/ledger_io.js';

export { buildCSV };   // 舊的呼叫端（測試）還是從這裡拿

const CATS = [
  { key: 'food',    label: '🍽 餐飲' },
  { key: 'transit', label: '🚇 交通' },
  { key: 'shop',    label: '🛍 購物' },
  { key: 'ticket',  label: '🎟 門票' },
  { key: 'hotel',   label: '🏨 住宿' },
  { key: 'other',   label: '🧾 其他' },
];

const RECENT_N = 3;

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
  // 行程卡的「再記一筆」會帶 ?date=…&item=… 進來：日期設成那一天、行程項目選好
  const qDate = /^\d{4}-\d{2}-\d{2}$/.test(params?.query?.date || '') ? params.query.date : '';
  const qItem = qDate ? (params?.query?.item || '') : '';
  const qEdit = params?.query?.edit || '';
  const qItemObj = qItem ? ((ctx.data.days || []).find(d => d.date === qDate)?.items || []).find(it => it.id === qItem) : null;
  const defaultDate = qDate || nowCtx.todayStr || todayISO();
  const defaultItemId = qDate ? (qItemObj ? qItem : '') : (nowCtx.item?.id || '');
  const defaultCat = suggestCategoryFromItem(qDate ? qItemObj : nowCtx.item);
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
          <button type="button" class="btn" id="ldgCancel" hidden>取消</button>
          <span class="ldg-hint faint small" id="ldgHint">用日圓輸入。台幣自動換算。</span>
        </div>
      </section>

      <section class="ldg-summary" id="ldgSummary"></section>

      <a class="btn ldg-stats-btn" href="#/tools/stats">📊 看帳務分析 →</a>

      <section class="ldg-recent" id="ldgRecent"></section>

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
  const cancelBtn   = $('#ldgCancel');
  const summaryEl   = $('#ldgSummary');
  const recentEl    = $('#ldgRecent');
  const nudgeEl     = $('#exportNudge');

  // ==== 狀態
  let rows = [];         // 全部記帳資料
  let currentCat = defaultCat;
  let editingId  = null; // 若在編輯中
  let editingTime = '';  // 編輯時保留原本記的時間
  let leaveAfterSave = false;   // 從 ?edit= 進來 → 存完回上一頁

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
  cancelBtn.addEventListener('click', onCancel);
  amountInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSubmit(); });

  // 「剛剛記的」：改／刪
  recentEl.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { onEdit(ed.getAttribute('data-edit')); return; }
    const del = e.target.closest('[data-del]');
    if (del) onDelete(del.getAttribute('data-del'));
  });

  // ==== 初始渲染
  paintPreview();
  await reload();
  if (qEdit) {
    if (rows.some(r => r.id === qEdit)) { leaveAfterSave = true; onEdit(qEdit); }
    else toast('找不到這一筆，可能已經刪掉了');
  }
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

  function resetForm() {
    amountInput.value = '';
    noteInput.value = '';
    editingId = null; editingTime = '';
    submitBtn.textContent = '加入 →';
    cancelBtn.hidden = true;
    paintPreview();
  }

  // 存完（或取消）之後：從 ?edit= 進來的回上一頁；沒有上一頁就回帳務分析
  function leave() {
    const prev = getPrevHash();
    if (prev && prev !== (location.hash || '#/')) history.back();
    else location.hash = '#/tools/stats';
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
    const time = (editingId && editingTime) || nowHHMM();
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
    const wasEditing = !!editingId;
    resetForm();
    if (wasEditing && leaveAfterSave) { leave(); return; }
    amountInput.focus();
    await reload();
  }

  function onCancel() {
    resetForm();
    if (leaveAfterSave) { leave(); return; }
  }

  async function reload() {
    rows = await getAllLedger();
    paintSummary();
    paintRecent();
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

  // 剛剛記的：最新 3 筆（依記下去的先後）
  function paintRecent() {
    if (rows.length === 0) {
      recentEl.innerHTML = `<div class="empty">還沒有任何一筆。上面輸入金額按「加入」。</div>`;
      return;
    }
    const latest = rows.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, RECENT_N);
    recentEl.innerHTML = `
      <h2 class="ldg-recent-h">剛剛記的</h2>
      <div class="ldg-recent-list">
        ${latest.map(r => rowHtml(r, { lookup: ctx.data.daysLookup, showDate: true })).join('')}
      </div>
      <a class="ldg-all-link small" href="#/tools/stats?d=all&detail=1">看全部明細 →</a>`;
  }

  function onEdit(id) {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    editingId = id; editingTime = r.time || '';
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
    cancelBtn.hidden = false;
    paintPreview();
    amountInput.focus();
    amountInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function onDelete(id) {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    const ok = await confirmDelete(deleteMsg(r));
    if (!ok) return;
    if (editingId === id) resetForm();
    try { await deleteLedger(id); }
    catch (e) { alert('刪除失敗：' + (e.message || e)); return; }
    await reload();
  }

  async function onExportAll() {
    if (!rows.length) { alert('沒有可匯出的資料'); return; }
    await downloadCSV(buildCSV(rows, ctx.data.daysLookup), `fukuoka-ledger-${todayISO().replace(/-/g,'')}.csv`);
    markExported(todayISO());
    nudgeEl.hidden = true;
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
    nudgeEl.querySelector('#nudgeExport').addEventListener('click', onExportAll);
    nudgeEl.querySelector('.cd-x').addEventListener('click', () => nudgeEl.hidden = true);
  }
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

// 給 tools 頁用：算今日累計 ¥
export async function todayLedgerYen() {
  try {
    if (!(await isAvailable())) return null;
    const rows = await getAllLedger();
    const today = todayISO();
    return rows.filter(r => r.date === today).reduce((s, r) => s + (r.jpy || 0), 0);
  } catch { return null; }
}
