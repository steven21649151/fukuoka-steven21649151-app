// 📊 帳務分析頁（看的用）：預算 vs 實際 圓餅圖、分類細項、六天花費統計
// ⚠️ 只讀 IndexedDB（getAllLedger），不寫入；計算出錯時只顯示提示，記帳與行程頁不受影響。
// 計算和畫圖沿用 lib/ledger_chart.js。
import { escapeHtml } from '../lib/md.js';
import { md as mdDate } from '../lib/fmt.js';
import { isAvailable, getAllLedger, deleteLedger } from '../lib/db.js';
import { getRate } from '../lib/rate.js';
import { todayISO } from '../lib/nowitem.js';
import {
  CHART_CATS, DAILY_BUDGET_TWD, budgetForDay, budgetForAll, actualTotals, sumTotals, donutSvg, chartTable,
} from '../lib/ledger_chart.js';
import {
  rowHtml, confirmDelete, deleteMsg, toast, buildCSV, downloadCSV, copyCSV, markExported, PAY_LIST, PAY_NONE, payKey,
} from '../lib/ledger_io.js';

const yenStr = (n) => '¥' + Math.round(n).toLocaleString('en-US');
const twdStr = (n) => 'NT$' + Math.round(n).toLocaleString('en-US');
const WEEK = '日一二三四五六';

// 給小工具頁格子的小字：全程 ¥xx,xxx（沒資料 → null）
export async function ledgerTotalYen() {
  try {
    if (!(await isAvailable())) return null;
    const rows = await getAllLedger();
    return rows.reduce((s, r) => s + (Number(r.jpy) || 0), 0);
  } catch { return null; }
}

const catKey = (r) => (CHART_CATS.some(c => c.key === r.category) ? r.category : 'other');

// 全支付回饋估算：每筆都先抓 3.5%（台幣），不設上限（實際有滿額加碼活動，以 App 為準）
function pxpayPoints(rows) {
  let twd = 0;
  for (const r of rows) if (r.pay === 'pxpay') twd += Number(r.twd) || 0;
  return Math.round(twd * 0.035);
}

export async function render(root, params, ctx, opts = {}) {
  const head = `
    <div class="topnav stats-top">
      <a class="back" href="#/tools">← 回小工具</a>
      <a class="btn btn-primary stats-add" href="#/tools/ledger">＋ 記一筆</a>
    </div>
    <h1 style="font-family:var(--dis);font-size:22px;margin:10px 0 6px">帳務分析</h1>`;
  const fail = (msg) => {
    root.innerHTML = `<div class="wrap">${head}<div class="empty">${escapeHtml(msg)}<br><a href="#/tools/ledger">回記帳頁 →</a></div></div>`;
  };

  let rows = [];
  try {
    if (!(await isAvailable())) { fail('這個瀏覽器不允許儲存（可能是隱私模式），沒辦法顯示帳務分析。'); return; }
    rows = await getAllLedger();
  } catch (e) {
    console.error('帳務分析讀取失敗', e);
    fail('帳務資料暫時讀不到，分析先不顯示。記帳照常可以用。');
    return;
  }

  try {
    renderStats(root, params, ctx, rows, head, opts);
  } catch (e) {
    console.error('帳務分析計算失敗', e);
    fail('帳務分析暫時算不出來，先不顯示。記帳和行程照常可以用。');
  }
}

function renderStats(root, params, ctx, rows, head, opts = {}) {
  const days = ctx.data.days || [];
  const lookup = ctx.data.daysLookup || days;
  const today = todayISO();
  const dates = days.map(d => d.date);

  // ---- 範圍：?d=2026-10-26 或 ?d=all；預設今天在行程內就選今天，否則全程
  const q = params?.query?.d;
  let sel = q === 'all' || dates.includes(q) ? q : (dates.includes(today) ? today : 'all');
  let filterCat = null;             // 點分類表的某一列 → 明細只看那個分類（再點取消）
  let filterPay = null;             // 點付款方式的某一格 → 明細只看那種付款方式（跟分類篩選可同時用）

  root.innerHTML = `
    <div class="wrap">
      ${head}
      <div class="stats-chips" id="stChips" role="group" aria-label="範圍"></div>
      <section id="stMain"></section>
      <section id="stList"></section>
      <section id="stBars"></section>
    </div>`;
  const chipsEl = root.querySelector('#stChips');
  const mainEl = root.querySelector('#stMain');
  const listEl = root.querySelector('#stList');
  const barsEl = root.querySelector('#stBars');

  function setSel(v) {
    sel = v; filterCat = null; filterPay = null;
    const base = location.hash.split('?')[0];
    history.replaceState(null, '', `${base}?d=${encodeURIComponent(v)}`);   // 重新整理不會跑掉，也不重跑 view
    paint();
  }

  function paint() {
    // 每一塊各自包 try/catch：某一塊算錯，其他塊還是顯示
    safe(chipsEl, paintChips);
    safe(mainEl, paintMain);
    safe(listEl, paintList);
    safe(barsEl, paintBars);
  }
  function safe(el, fn) {
    try { fn(); }
    catch (e) { console.error('帳務分析區塊失敗', e); el.innerHTML = `<div class="small faint" style="padding:8px 0">這一塊暫時算不出來。</div>`; }
  }

  // ---------- 範圍 chips ----------
  function paintChips() {
    chipsEl.innerHTML = [`<button type="button" class="chip" data-d="all"${sel === 'all' ? ' aria-current="true"' : ''}>全程</button>`]
      .concat(dates.map(d => `<button type="button" class="chip" data-d="${d}"${sel === d ? ' aria-current="true"' : ''}>${escapeHtml(mdDate(d))}</button>`))
      .join('');
    chipsEl.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => setSel(b.getAttribute('data-d'))));
  }

  // ---------- 圓餅圖＋分類表＋細項 ----------
  function paintMain() {
    const rate = getRate().jpyToTwd;
    const isAll = sel === 'all';
    const selRows = isAll ? rows : rows.filter(r => r.date === sel);
    const actual = actualTotals(selRows);
    const budget = isAll
      ? budgetForAll(days, DAILY_BUDGET_TWD, rate)
      : budgetForDay(days.find(d => d.date === sel), DAILY_BUDGET_TWD, rate);
    const aTot = sumTotals(actual), bTot = sumTotals(budget);
    const aTwd = selRows.reduce((s, r) => s + (Number(r.twd) || 0), 0);
    const pct = bTot > 0 ? Math.round(aTot / bTot * 100) : null;
    const over = aTot > bTot && aTot > 0;
    const table = chartTable(budget, actual);

    mainEl.innerHTML = `
      <div class="ldg-donuts">
        <figure class="ldg-donut-box"><figcaption>預算</figcaption>
          ${donutSvg(budget, { centerYen: bTot, centerTwd: bTot * rate, emptyText: '沒有預算' })}
        </figure>
        <figure class="ldg-donut-box"><figcaption>實際</figcaption>
          ${donutSvg(actual, { centerYen: aTot, centerTwd: aTwd, over, emptyText: '還沒記帳' })}
        </figure>
      </div>
      <div class="stats-sum${over ? ' over' : ''}">實際 <b class="mono">${yenStr(aTot)}</b>／預算 <b class="mono">${yenStr(bTot)}</b>${pct != null ? `（<span class="mono">${pct}%</span>）` : ''}</div>
      ${filterBarHtml()}
      ${table.length ? `
      <table class="ldg-chart-table">
        <thead><tr><th>分類</th><th>預算</th><th>實際</th><th>差額</th></tr></thead>
        <tbody>
          ${table.map(r => `
            <tr data-cat="${r.cat.key}" class="${filterCat === r.cat.key ? 'on' : ''}" tabindex="0" role="button" aria-pressed="${filterCat === r.cat.key}">
              <td><i style="background:${r.cat.color}"></i>${r.cat.emoji} ${r.cat.label}</td>
              <td class="mono">${yenStr(r.budget)}</td>
              <td class="mono">${yenStr(r.actual)}</td>
              <td class="mono${r.diff < 0 ? ' neg' : ''}">${r.diff < 0 ? '−' + yenStr(-r.diff) : yenStr(r.diff)}</td>
            </tr>`).join('')}
          <tr class="total">
            <td>合計</td>
            <td class="mono">${yenStr(bTot)}</td>
            <td class="mono">${yenStr(aTot)}</td>
            <td class="mono${bTot - aTot < 0 ? ' neg' : ''}">${bTot - aTot < 0 ? '−' + yenStr(aTot - bTot) : yenStr(bTot - aTot)}</td>
          </tr>
        </tbody>
      </table>
      <div class="small faint ldg-chart-hint">點一列，下面的明細只看這個分類（再點一次取消）</div>` : `<div class="empty" style="margin-top:10px">${isAll ? '還沒有任何記帳。' : '這一天還沒記帳。'}</div>`}
      ${selRows.length ? payBlockHtml(selRows) : ''}
    `;
    mainEl.querySelectorAll('tr[data-cat]').forEach(tr => {
      const toggle = () => {
        const k = tr.getAttribute('data-cat');
        filterCat = filterCat === k ? null : k;
        safe(mainEl, paintMain);
        safe(listEl, paintList);
      };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
    mainEl.querySelector('#stFilterClear')?.addEventListener('click', () => {
      filterCat = null;
      safe(mainEl, paintMain);
      safe(listEl, paintList);
    });
    mainEl.querySelector('#stFilterPayClear')?.addEventListener('click', () => {
      filterPay = null;
      safe(mainEl, paintMain);
      safe(listEl, paintList);
    });
    mainEl.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => {
      const k = b.getAttribute('data-pay');
      filterPay = filterPay === k ? null : k;
      safe(mainEl, paintMain);
      safe(listEl, paintList);
    }));
  }

  function filterBarHtml() {
    const parts = [];
    if (filterCat) {
      const c = CHART_CATS.find(x => x.key === filterCat);
      parts.push(`${c.emoji} ${c.label} <button type="button" class="mini" id="stFilterClear" aria-label="取消分類篩選">✕</button>`);
    }
    if (filterPay) {
      const pm = [...PAY_LIST, PAY_NONE].find(x => x.key === filterPay);
      parts.push(`${pm.emoji ? pm.emoji + ' ' : ''}${pm.label} <button type="button" class="mini" id="stFilterPayClear" aria-label="取消付款方式篩選">✕</button>`);
    }
    return parts.length ? `<div class="ldg-filter">只看：${parts.join('　')}</div>` : '';
  }

  // ---------- 付款方式小計（跟著目前範圍）＋全支付回饋、Visa 手續費估算 ----------
  function payBlockHtml(selRows) {
    const jpy = { visa: 0, cash: 0, pxpay: 0, none: 0 };
    const twd = { visa: 0, cash: 0, pxpay: 0, none: 0 };
    for (const r of selRows) {
      const k = payKey(r);
      jpy[k] += Number(r.jpy) || 0;
      twd[k] += Number(r.twd) || 0;
    }
    const all = jpy.visa + jpy.cash + jpy.pxpay + jpy.none;
    const list = [...PAY_LIST, PAY_NONE].filter(pm => pm.key !== 'none' || jpy.none > 0);
    const pct = (k) => (all > 0 ? Math.round(jpy[k] / all * 100) : 0);
    const pts = pxpayPoints(selRows);
    const fee = Math.round(twd.visa * 0.015);
    return `
      <h2 class="stats-h">付款方式</h2>
      <div class="pay-bar" role="img" aria-label="付款方式佔比">
        ${list.filter(pm => jpy[pm.key] > 0).map(pm => `<span style="width:${(jpy[pm.key] / all * 100).toFixed(2)}%;background:${pm.color}"></span>`).join('') || '<span style="width:100%;background:var(--line)"></span>'}
      </div>
      <div class="pay-grid">
        ${list.map(pm => `
          <button type="button" class="pay-cell${filterPay === pm.key ? ' on' : ''}" data-pay="${pm.key}" aria-pressed="${filterPay === pm.key}">
            <span class="pc-l"><i style="background:${pm.color}"></i>${pm.emoji ? pm.emoji + ' ' : ''}${pm.label}</span>
            <b class="mono">${yenStr(jpy[pm.key])}</b>
            <small class="mono">${pct(pm.key)}%</small>
          </button>`).join('')}
      </div>
      ${jpy.pxpay > 0 ? `<div class="pay-note">📱 全支付回饋約 <b class="mono">${pts}</b> 點（以 3.5% 估算）<small>有滿額加碼活動的話會更多，實際點數以 App 為準</small></div>` : ''}
      ${jpy.visa > 0 ? `<div class="pay-note">💳 Visa 海外手續費約 <b class="mono">${twdStr(fee)}</b></div>` : ''}`;
  }

  // ---------- 明細（依範圍＋分類篩選；全程時依日期分組）＋匯出 ----------
  function paintList() {
    const isAll = sel === 'all';
    const inRange = isAll ? rows : rows.filter(r => r.date === sel);
    const shown = inRange
      .filter(r => (!filterCat || catKey(r) === filterCat) && (!filterPay || payKey(r) === filterPay))
      .sort((a, b) => (a.date === b.date ? (b.time || '').localeCompare(a.time || '') : (a.date < b.date ? 1 : -1)));
    const groups = new Map();
    for (const r of shown) {
      if (!groups.has(r.date)) groups.set(r.date, []);
      groups.get(r.date).push(r);
    }
    const sumJpy = shown.reduce((s, r) => s + (Number(r.jpy) || 0), 0);
    const sumTwd = shown.reduce((s, r) => s + (Number(r.twd) || 0), 0);
    const body = shown.length === 0
      ? `<div class="empty">${rows.length === 0 ? '還沒有任何一筆。' : '這個範圍沒有符合的記帳。'}</div>`
      : [...groups.entries()].map(([date, list]) => {
          const tot = list.reduce((s, r) => s + (Number(r.jpy) || 0), 0);
          const wd = WEEK[new Date(date + 'T00:00:00Z').getUTCDay()];
          return `
          <section class="ldg-day">
            <div class="ldg-day-head">
              <span class="d">${escapeHtml(mdDate(date))}（${wd}）</span>
              <span class="tot mono nw">${yenStr(tot)}</span>
            </div>
            ${list.map(r => rowHtml(r, { lookup })).join('')}
          </section>`;
        }).join('');

    listEl.innerHTML = `
      <h2 class="stats-h" id="stDetail">明細</h2>
      <div class="small faint stats-count">${shown.length} 筆 · ${yenStr(sumJpy)} ≈ ${twdStr(sumTwd)}</div>
      <div class="ldg-list">${body}</div>
      <div class="ldg-exports">
        <button type="button" class="btn" id="expAll">📤 匯出全部</button>
        <button type="button" class="btn" id="expReimb">📤 只匯出可報帳</button>
        <button type="button" class="btn" id="expCopy">📋 複製成文字</button>
      </div>`;
  }

  // 明細的 改／刪、匯出（listEl 本身不會被換掉，事件只接一次）
  listEl.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { location.hash = '#/tools/ledger?edit=' + encodeURIComponent(ed.getAttribute('data-edit')); return; }
    const del = e.target.closest('[data-del]');
    if (del) { await onDelete(del.getAttribute('data-del')); return; }
    const btn = e.target.closest('button[id^="exp"]');
    if (!btn) return;
    const stamp = todayISO().replace(/-/g, '');
    try {
      if (btn.id === 'expAll') await onExport(rows, `fukuoka-ledger-${stamp}.csv`);
      else if (btn.id === 'expReimb') await onExport(rows.filter(r => r.reimbursable), `fukuoka-ledger-報帳-${stamp}.csv`);
      else if (btn.id === 'expCopy') await onCopy(rows);
    } catch (err) { console.error('匯出失敗', err); toast('匯出失敗了'); }
  });

  async function onExport(list, filename) {
    if (!list.length) { alert('沒有可匯出的資料'); return; }
    await downloadCSV(buildCSV(list, lookup), filename);
    markExported(todayISO());
  }
  async function onCopy(list) {
    if (!list.length) { alert('沒有可複製的資料'); return; }
    if (await copyCSV(buildCSV(list, lookup))) markExported(todayISO());
  }
  async function onDelete(id) {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    if (!(await confirmDelete(deleteMsg(r)))) return;
    try {
      await deleteLedger(id);
      rows = await getAllLedger();
    } catch (err) {
      console.error('刪除失敗', err);
      toast('刪除失敗，再試一次');
      return;
    }
    paint();   // 圖、表、明細、長條圖整頁重算
  }

  // ---------- 六天花費統計 ----------
  function paintBars() {
    const rate = getRate().jpyToTwd;
    const per = days.map(d => {
      const rs = rows.filter(r => r.date === d.date);
      const actual = actualTotals(rs);
      const budget = budgetForDay(d, DAILY_BUDGET_TWD, rate);
      return { d, actual, budget, aTot: sumTotals(actual), bTot: sumTotals(budget), aTwd: rs.reduce((s, r) => s + (Number(r.twd) || 0), 0) };
    });
    const max = Math.max(1, ...per.map(p => Math.max(p.aTot, p.bTot)));
    const W = 360, padX = 6, top = 26, baseY = 176, plotH = baseY - top;
    const slot = (W - padX * 2) / Math.max(1, per.length), barW = 32;
    const y = (v) => baseY - (v / max) * plotH;

    const groups = per.map((p, i) => {
      const x0 = padX + i * slot, bx = x0 + (slot - barW) / 2;
      let acc = 0, rects = '';
      for (const c of CHART_CATS) {
        const v = p.actual[c.key];
        if (v <= 0) continue;
        const h = (v / max) * plotH;
        rects += `<rect x="${bx.toFixed(1)}" y="${(baseY - (acc + v) / max * plotH).toFixed(1)}" width="${barW}" height="${Math.max(0.5, h).toFixed(1)}" fill="${c.color}"/>`;
        acc += v;
      }
      const stackH = Math.max(3, (p.aTot / max) * plotH);
      const isToday = p.d.date === today;
      const over = p.aTot > p.bTot && p.aTot > 0;
      const by = y(p.bTot);
      const wd = WEEK[new Date(p.d.date + 'T00:00:00Z').getUTCDay()];
      return `
        <g class="bar-g" data-date="${p.d.date}" tabindex="0" role="button" aria-label="${escapeHtml(mdDate(p.d.date))} 實際 ${yenStr(p.aTot)}，預算 ${yenStr(p.bTot)}">
          <rect class="bar-bg${sel === p.d.date ? ' sel' : ''}" x="${x0.toFixed(1)}" y="${top - 18}" width="${slot.toFixed(1)}" height="${baseY - top + 18 + 34}" rx="6"/>
          ${rects}
          ${isToday ? `<rect class="bar-today" x="${(bx - 1).toFixed(1)}" y="${(baseY - stackH - 1).toFixed(1)}" width="${barW + 2}" height="${(stackH + 2).toFixed(1)}" rx="2"/>` : ''}
          <line class="bar-budget" x1="${(x0 + 3).toFixed(1)}" x2="${(x0 + slot - 3).toFixed(1)}" y1="${by.toFixed(1)}" y2="${by.toFixed(1)}"/>
          <text class="bar-val${over ? ' over' : ''}" x="${(x0 + slot / 2).toFixed(1)}" y="${(baseY - stackH - 5).toFixed(1)}" text-anchor="middle">${p.aTot > 0 ? yenStr(p.aTot) : '—'}</text>
          <text class="bar-lbl" x="${(x0 + slot / 2).toFixed(1)}" y="${baseY + 14}" text-anchor="middle">${escapeHtml(mdDate(p.d.date))}</text>
          <text class="bar-sub" x="${(x0 + slot / 2).toFixed(1)}" y="${baseY + 26}" text-anchor="middle">${p.aTot > 0 ? twdStr(p.aTwd) : ''}</text>
        </g>`;
    }).join('');

    // 全程與可報帳
    const aAll = rows.reduce((s, r) => s + (Number(r.jpy) || 0), 0);
    const aAllTwd = rows.reduce((s, r) => s + (Number(r.twd) || 0), 0);
    const bAll = per.reduce((s, p) => s + p.bTot, 0);
    const reimb = rows.filter(r => r.reimbursable);
    const reimbJpy = reimb.reduce((s, r) => s + (Number(r.jpy) || 0), 0);
    const reimbTwd = reimb.reduce((s, r) => s + (Number(r.twd) || 0), 0);
    const cell = (jpy, twd) => `<span class="mono">${yenStr(jpy)}</span><small class="mono">${twdStr(twd)}</small>`;
    const diffCell = (b, a) => b - a < 0
      ? `<span class="mono neg">−${yenStr(a - b)}</span><small class="mono">−${twdStr((a - b) * rate)}</small>`
      : cell(b - a, (b - a) * rate);

    barsEl.innerHTML = `
      <h2 class="stats-h">六天花費</h2>
      <svg viewBox="0 0 ${W} 214" class="stats-bars" role="group" aria-label="六天花費長條圖">
        ${groups}
      </svg>
      <div class="stats-legend small faint">
        ${CHART_CATS.map(c => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join('')}
        <span><u class="dash"></u>預算</span>
      </div>
      <table class="stats-table">
        <thead><tr><th>日期</th><th>預算</th><th>實際</th><th>差額</th></tr></thead>
        <tbody>
          ${per.map(p => `
            <tr>
              <td>${escapeHtml(mdDate(p.d.date))}</td>
              <td>${cell(p.bTot, p.bTot * rate)}</td>
              <td>${cell(p.aTot, p.aTwd)}</td>
              <td>${diffCell(p.bTot, p.aTot)}</td>
            </tr>`).join('')}
          <tr class="total">
            <td>全程合計</td>
            <td>${cell(bAll, bAll * rate)}</td>
            <td>${cell(aAll, aAllTwd)}</td>
            <td>${diffCell(bAll, aAll)}</td>
          </tr>
          <tr class="reimb">
            <td>可報帳合計</td>
            <td><span class="mono faint">—</span></td>
            <td>${cell(reimbJpy, reimbTwd)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>`;
    barsEl.querySelectorAll('.bar-g').forEach(g => {
      const go = () => setSel(g.getAttribute('data-date'));
      g.addEventListener('click', go);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  paint();
  // 從記帳頁「看全部明細 →」進來：直接捲到明細（返回時尊重 router 的捲動記憶）
  if (params?.query?.detail && !opts.restored) {
    setTimeout(() => listEl.querySelector('#stDetail')?.scrollIntoView({ block: 'start' }), 80);
  }
}
