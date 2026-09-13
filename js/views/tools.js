// 小工具選單
import { escapeHtml } from '../lib/md.js';
import { pendingBeforeStats } from './packing.js';
import { todayLedgerYen } from './ledger.js';
import { yen } from '../lib/fmt.js';

const TOOLS = [
  { key: 'allergy', emoji: '🦐', label: '過敏卡',    action: 'allergy', urgent: true },
  { key: 'phrases', emoji: '🗣', label: '中日句庫' },
  { key: 'tips',    emoji: '💡', label: '攻略 Tips' },
  { key: 'packing', emoji: '🎒', label: '打包清單' },
  { key: 'flight',  emoji: '✈️', label: '航班' },
  { key: 'ledger',  emoji: '💰', label: '記帳' },
  { key: 'journal', emoji: '📷', label: '手帳' },
  { key: 'rate',    emoji: '💱', label: '匯率' },
  { key: 'settings',emoji: '⚙️', label: '設定' },
];

export async function render(root, params, ctx) {
  const sub = params && params.sub;

  if (!sub) {
    // 計算格子上的數量、進度
    const packing = ctx.data.packingGroups || [];
    const packingTotal = packing.reduce((n, g) => n + (g.items?.length || 0), 0);
    const packingDone = countPackingDone(packing);
    const tipCount = (ctx.data.tips || []).length;
    const ledgerToday = await todayLedgerYen(); // null → 不可用；0 → 沒紀錄

    const stats = pendingBeforeStats(ctx);
    const reminder = renderReminder(stats);

    root.innerHTML = `
      <div class="wrap">
        <div class="topnav"><a class="back" href="#/">← 回行程</a></div>
        <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">小工具</h1>
        ${reminder}
        <div class="tool-menu">
          ${TOOLS.map(t => renderTile(t, { packingDone, packingTotal, tipCount, ledgerToday })).join('')}
        </div>
      </div>
    `;

    // 過敏卡按下去 → 開大字卡（借用頂端 🦐 按鈕的行為）
    root.querySelectorAll('[data-tool-action="allergy"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('allergyBtn')?.click();
      });
    });
    return;
  }

  // fallback：未知的子頁（不會走到，因為 router 已直接接管 phrases/tips/packing/flight/rate）
  const item = TOOLS.find(t => t.key === sub);
  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <div class="empty">
        <div style="font-size:44px;margin-bottom:10px">${item?.emoji || '🚧'}</div>
        <div style="font-family:var(--dis);font-size:18px;color:var(--ink)">${escapeHtml(item?.label || sub)}</div>
        <div class="small" style="margin-top:6px">這個功能還在準備中</div>
      </div>
    </div>
  `;
}

function renderTile(t, s) {
  const href = t.action === 'allergy'
    ? '#'
    : `#/tools/${t.key}`;
  const status = t.soon ? '<span class="status">準備中</span>' : '';
  let meta = '';
  if (t.key === 'packing') meta = `<span class="meta">${s.packingDone} / ${s.packingTotal}</span>`;
  else if (t.key === 'tips') meta = `<span class="meta">${s.tipCount} 條</span>`;
  else if (t.key === 'ledger') {
    if (s.ledgerToday == null)   meta = '';
    else if (s.ledgerToday === 0) meta = `<span class="meta">還沒記帳</span>`;
    else                          meta = `<span class="meta">今日 ${yen(s.ledgerToday)}</span>`;
  }
  return `
    <a href="${href}"${t.action ? ` data-tool-action="${escapeHtml(t.action)}"` : ''}
       class="tool-tile${t.urgent ? ' urgent' : ''}">
      <span class="emoji">${t.emoji}</span>
      <span class="label">${escapeHtml(t.label)}</span>
      ${meta || status}
    </a>
  `;
}

function countPackingDone(groups) {
  let n = 0;
  for (const g of groups) {
    for (const it of (g.items || [])) {
      try { if (localStorage.getItem('packing.' + it.id) === '1') n++; } catch {}
    }
  }
  return n;
}

function renderReminder(stats) {
  if (!stats || stats.pending === 0) return '';
  const next = stats.next;
  const line = next
    ? (next.overdue
        ? `<b>已逾期</b>：${escapeHtml(next.text)}（${formatMD(next.deadline)}）`
        : `最近一件：${escapeHtml(next.text)}（${formatMD(next.deadline)} 到期）`)
    : '';
  return `
    <a class="pk-reminder" href="#/tools/packing">
      <span class="ico">⏰</span>
      <div class="body">
        出發前還有 <b>${stats.pending}</b> 件事沒做。<br>
        <span class="small">${line}</span>
      </div>
      <span class="go">看清單</span>
    </a>
  `;
}

function formatMD(iso) {
  if (!iso || iso.length < 10) return iso || '';
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}
