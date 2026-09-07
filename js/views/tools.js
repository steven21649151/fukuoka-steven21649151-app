// 小工具選單
import { escapeHtml } from '../lib/md.js';

const TOOLS = [
  { key: 'flight',  emoji: '✈️', label: '航班',       soon: true },
  { key: 'ledger',  emoji: '💰', label: '記帳',       soon: true },
  { key: 'packing', emoji: '🎒', label: '打包清單',   soon: true },
  { key: 'tips',    emoji: '💡', label: '攻略 Tips', soon: true },
  { key: 'phrases', emoji: '🗣', label: '中日句庫',   soon: true },
  { key: 'journal', emoji: '📷', label: '手帳',       soon: true },
  { key: 'rate',    emoji: '💱', label: '匯率',       soon: false },
  { key: 'settings',emoji: '⚙️', label: '設定',       soon: true },
];

export async function render(root, params) {
  const sub = params && params.sub;

  if (!sub) {
    root.innerHTML = `
      <div class="wrap">
        <div class="topnav"><a class="back" href="#/">← 回行程</a></div>
        <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">小工具</h1>
        <div class="tool-menu">
          ${TOOLS.map(t => `
            <a href="#/tools/${t.key}">
              <span class="emoji">${t.emoji}</span>
              <span class="label">${escapeHtml(t.label)}</span>
              ${t.soon ? '<span class="status">準備中</span>' : ''}
            </a>
          `).join('')}
        </div>
      </div>
    `;
    return;
  }

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
