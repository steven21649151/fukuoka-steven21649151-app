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
  rowHtml, confirmDelete, deleteMsg, toast, buildCSV, downloadCSV, markExported, LS_LAST_EXPORT, PAY_LIST,
} from '../lib/ledger_io.js';
import { loadWallet, saveWallet, walletBalance, isConfigured, LOW_CASH_YEN } from '../lib/cash_wallet.js';

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
const LS_LAST_PAY = 'ledger.lastPay';

function lastPay() {
  try { const v = localStorage.getItem(LS_LAST_PAY); return PAY_LIST.some(p => p.key === v) ? v : null; }
  catch { return null; }
}
// 付款方式預設值：① 行程項目 pay 是現金 → 現金；嗶卡／刷卡類 → Visa；景點收全支付 → 全支付
//                ② 否則用上一次存的，再沒有就 Visa
function defaultPayFor(it, spots) {
  if (it) {
    if (it.pay === 'cash') return 'cash';
    if (['touch', 'card', 'ic', 'pass'].includes(it.pay)) return 'visa';
    const spot = it.spotId ? (spots || []).find(sp => sp.id === it.spotId) : null;
    if (spot && spot.pxpay === 'yes') return 'pxpay';
  }
  return lastPay() || 'visa';
}
const findItem = (days, date, id) => id ? ((days || []).find(d => d.date === date)?.items || []).find(it => it.id === id) : null;

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
  const defaultPay = defaultPayFor(qDate ? qItemObj : nowCtx.item, ctx.data.spots);

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">記帳</h1>

      <button type="button" class="ldg-wallet" id="ldgWallet"></button>

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

        <div class="ldg-chips ldg-pays" id="ldgPays" role="radiogroup" aria-label="付款方式">
          ${PAY_LIST.map(pm => `
            <button type="button" class="chip" data-pay="${pm.key}"
                    ${pm.key === defaultPay ? 'aria-current="true"' : ''}>${pm.emoji} ${pm.label}</button>
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
  const paysEl      = $('#ldgPays');
  const walletEl    = $('#ldgWallet');
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
  let leaveAfterSave = params?.query?.back === '1';   // ?back=1（行程卡快速記）進來、或載入 ?edit= 之後 → 存完回上一頁
  let currentPay = defaultPay;   // 編輯沒有 pay 的舊記錄時是 null（＝未標記）
  let payTouched = false;        // 使用者自己點過付款方式 → 換行程項目不再幫他改

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

  function showPay(key) {
    currentPay = key;
    paysEl.querySelectorAll('button').forEach(b => b.removeAttribute('aria-current'));
    if (key) paysEl.querySelector(`button[data-pay="${key}"]`)?.setAttribute('aria-current', 'true');
  }
  paysEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-pay]');
    if (!btn) return;
    payTouched = true;
    showPay(btn.getAttribute('data-pay'));
  });
  // 換關聯行程 → 付款方式跟著行程項目重新猜（使用者自己選過或在編輯就不動）
  itemSelect.addEventListener('change', () => {
    if (payTouched || editingId) return;
    showPay(defaultPayFor(findItem(ctx.data.days, dateInput.value, itemSelect.value), ctx.data.spots));
  });
  walletEl.addEventListener('click', openWalletPanel);

  dateInput.addEventListener('change', () => {
    // 換日期→重繪 item 選單
    itemSelect.innerHTML = `<option value="">（不關聯）</option>` + renderItemOptions(ctx.data.days, dateInput.value, '');
    if (!payTouched && !editingId) showPay(defaultPayFor(null, ctx.data.spots));
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
    const wasEditing = !!editingId;
    editingId = null; editingTime = '';
    submitBtn.textContent = '加入 →';
    cancelBtn.hidden = true;
    if (wasEditing) { payTouched = false; showPay(lastPay() || 'visa'); }
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
    if (currentPay) row.pay = currentPay;   // 編輯沒有 pay 的舊記錄又沒補選 → 維持沒有（未標記）
    try {
      await putLedger(row);
    } catch (e) {
      alert('儲存失敗：' + (e.message || e));
      return;
    }
    if (currentPay) { try { localStorage.setItem(LS_LAST_PAY, currentPay); } catch {} }
    resetForm();
    if (leaveAfterSave) { leave(); return; }
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
    paintWallet();
  }

  // ==== 現金錢包（只存在這支手機）
  function paintWallet() {
    try {
      const w = loadWallet();
      const bal = walletBalance(w, rows);
      if (bal == null) {
        walletEl.className = 'ldg-wallet unset';
        walletEl.innerHTML = '<span class="w-main">設定一下帶了多少現金 →</span>';
        return;
      }
      const low = bal < LOW_CASH_YEN;
      walletEl.className = 'ldg-wallet' + (low ? ' low' : '');
      walletEl.innerHTML = `<span class="w-main">💴 現金還剩 <b class="mono">${bal < 0 ? '−' : ''}${yen(Math.abs(bal))}</b></span>${low ? '<span class="w-warn">現金快用完了</span>' : ''}`;
    } catch (e) {
      console.error('現金錢包算不出來', e);
      walletEl.className = 'ldg-wallet unset';
      walletEl.innerHTML = '<span class="w-main">現金餘額暫時算不出來</span>';
    }
  }

  function openWalletPanel() {
    const ov = document.createElement('div');
    ov.className = 'lsh-overlay';
    ov.innerHTML = `
      <div class="lsh-sheet" role="dialog" aria-modal="true" aria-labelledby="wlTitle">
        <div class="lsh-head">
          <div class="lsh-ttl"><div class="lsh-name" id="wlTitle">💴 現金錢包</div><div class="lsh-sum" id="wlSum"></div></div>
          <button type="button" class="lsh-x" aria-label="關閉">✕</button>
        </div>
        <div class="lsh-body wl-body">
          <label class="wl-field"><span class="k">一開始帶了多少日幣現金</span>
            <span class="wl-inline"><input id="wlStart" inputmode="numeric" placeholder="例如 30000"><button type="button" class="btn" id="wlSaveStart">存</button></span>
          </label>
          <div class="wl-field"><span class="k">＋ 補現金（ATM 領錢或換錢時）</span>
            <span class="wl-inline"><input type="date" id="wlDate"><input id="wlAmt" inputmode="numeric" placeholder="金額 ¥"><button type="button" class="btn" id="wlAdd">＋ 補現金</button></span>
          </div>
          <div id="wlList"></div>
          <div class="small faint wl-note">這個金額只存在這支手機</div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const q = (sel) => ov.querySelector(sel);
    q('#wlDate').value = todayISO();
    const num = (v) => { const n = Math.round(parseFloat(String(v).replace(/,/g, ''))); return Number.isFinite(n) && n > 0 ? n : null; };
    function paintPanel() {
      const w = loadWallet();
      const bal = walletBalance(w, rows);
      q('#wlSum').innerHTML = bal == null ? '<span class="faint small">還沒設定</span>' : `還剩 <b class="mono">${bal < 0 ? '−' : ''}${yen(Math.abs(bal))}</b>`;
      if (document.activeElement !== q('#wlStart')) q('#wlStart').value = w.start != null ? String(w.start) : '';
      q('#wlList').innerHTML = w.topups.length
        ? `<div class="wl-list">${w.topups.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map(t => `
            <div class="wl-row"><span class="mono">${escapeHtml(t.date.slice(5).replace('-', '/'))}</span><b class="mono">＋${yen(t.jpy)}</b>
              <button type="button" class="mini del" data-wl-del="${escapeHtml(t.id)}" aria-label="刪除這筆補現金">刪</button></div>`).join('')}</div>`
        : '';
      paintWallet();
    }
    function close() { ov.classList.remove('open'); setTimeout(() => ov.remove(), 220); }
    q('#wlSaveStart').addEventListener('click', () => {
      const raw = q('#wlStart').value.trim();
      const w = loadWallet();
      if (raw === '') { w.start = null; }
      else {
        const n = parseFloat(raw.replace(/,/g, ''));
        if (!Number.isFinite(n) || n < 0) { toast('請輸入日幣金額'); return; }
        w.start = Math.round(n);
      }
      if (!saveWallet(w)) toast('這個瀏覽器存不下來'); else toast('已存好');
      paintPanel();
    });
    q('#wlAdd').addEventListener('click', () => {
      const n = num(q('#wlAmt').value);
      if (!n) { q('#wlAmt').focus(); return; }
      const w = loadWallet();
      w.topups.push({ id: cryptoUUID(), date: q('#wlDate').value || todayISO(), jpy: n });
      if (!saveWallet(w)) { toast('這個瀏覽器存不下來'); return; }
      q('#wlAmt').value = '';
      paintPanel();
    });
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('.lsh-x')) { close(); return; }
      const del = e.target.closest('[data-wl-del]');
      if (del) {
        const w = loadWallet();
        w.topups = w.topups.filter(t => t.id !== del.getAttribute('data-wl-del'));
        saveWallet(w);
        paintPanel();
      }
    });
    paintPanel();
    setTimeout(() => ov.classList.add('open'), 20);
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
    showPay(PAY_LIST.some(pm => pm.key === r.pay) ? r.pay : null);   // 舊記錄沒有付款方式 → 都不選，可以補選
    payTouched = true;
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
