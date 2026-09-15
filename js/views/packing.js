// 打包清單：分組摺疊、checkbox → localStorage(packing.<id>)、進度、逾期標色、複製成文字
import { escapeHtml, mdInline } from '../lib/md.js';

const LS_PREFIX = 'packing.';
const TODAY = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

export function isChecked(id) {
  try { return localStorage.getItem(LS_PREFIX + id) === '1'; } catch { return false; }
}
function setChecked(id, v) {
  try {
    if (v) localStorage.setItem(LS_PREFIX + id, '1');
    else localStorage.removeItem(LS_PREFIX + id);
  } catch {}
}

// 給小工具首頁用：算「出發前還有 N 件事沒做、最近一件 X 到期」
export function pendingBeforeStats(ctx) {
  const groups = ctx.data.packingGroups || [];
  const before = groups.find(g => g.key === 'before');
  if (!before) return { pending: 0, next: null };
  const today = TODAY();
  const items = (before.items || []).filter(it => !isChecked(it.id));
  items.sort((a, b) => (a.deadline || '9999') > (b.deadline || '9999') ? 1 : -1);
  return {
    pending: items.length,
    next: items[0] ? { text: items[0].text, deadline: items[0].deadline, overdue: items[0].deadline && items[0].deadline < today } : null,
    total: (before.items || []).length,
  };
}

export async function render(root, params, ctx) {
  const groups = ctx.data.packingGroups || [];
  const today = TODAY();

  // 先算好每個 item 的狀態
  const totalCount = groups.reduce((n, g) => n + (g.items?.length || 0), 0);

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">打包清單</h1>
      <div class="pk-progress">
        <div class="bar"><div class="fill" id="pkFill" style="width:0%"></div></div>
        <div class="txt"><span id="pkDone">0</span> / <span>${totalCount}</span></div>
      </div>

      <div class="pk-groups">
        ${groups.map(g => renderGroup(g, today)).join('')}
      </div>

      <div class="pk-tools">
        <button type="button" class="btn" id="pkCopy">📋 複製成文字</button>
        <span class="small faint">localStorage 存的，清瀏覽器資料會不見。要保險就先複製到別的筆記。</span>
      </div>
    </div>
  `;

  // wire checkboxes
  const done = { n: 0 };
  root.querySelectorAll('.pk-item').forEach(row => {
    const cb = row.querySelector('input[type=checkbox]');
    const id = row.getAttribute('data-id');
    const already = isChecked(id);
    cb.checked = already;
    if (already) row.classList.add('done');
    else done.n = done.n; // no-op
    if (already) done.n++;
    cb.addEventListener('change', () => {
      setChecked(id, cb.checked);
      row.classList.toggle('done', cb.checked);
      updateProgress();
    });
  });
  updateProgress();

  // group headers can toggle
  root.querySelectorAll('.pk-group > .pk-group-head').forEach(head => {
    head.addEventListener('click', () => {
      const g = head.closest('.pk-group');
      g.setAttribute('data-open', g.getAttribute('data-open') === '1' ? '0' : '1');
    });
  });

  // deadline detail toggle（點 item 主體切換 detail）
  root.querySelectorAll('.pk-item').forEach(row => {
    const btn = row.querySelector('.pk-more');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      row.classList.toggle('open');
    });
  });

  // copy
  root.querySelector('#pkCopy').addEventListener('click', () => copyAsText(groups));

  function updateProgress() {
    const n = root.querySelectorAll('.pk-item.done').length;
    root.querySelector('#pkDone').textContent = String(n);
    const pct = totalCount ? Math.round(n / totalCount * 100) : 0;
    root.querySelector('#pkFill').style.width = pct + '%';
  }
}

function renderGroup(g, today) {
  let items = g.items || [];
  // 有 deadline 的按日期排（早的在前）；無 deadline 的維持原順序
  const hasAnyDeadline = items.some(it => it.deadline);
  if (hasAnyDeadline) {
    items = items.slice().sort((a, b) => {
      const da = a.deadline || '9999';
      const db = b.deadline || '9999';
      return da > db ? 1 : (da < db ? -1 : 0);
    });
  }
  const doneN = items.filter(it => isChecked(it.id)).length;
  return `
    <section class="pk-group" data-open="1">
      <button type="button" class="pk-group-head">
        <span class="label">${escapeHtml(g.label || g.key)}</span>
        <span class="count">${doneN} / ${items.length}</span>
        <span class="chev">▾</span>
      </button>
      ${g.note ? `<div class="pk-note">${escapeHtml(g.note)}</div>` : ''}
      <div class="pk-items">
        ${items.map(it => renderItem(it, today)).join('')}
      </div>
    </section>
  `;
}

function renderItem(it, today) {
  const dl = it.deadline || null;
  let flag = '';
  if (dl) {
    if (dl < today) flag = 'overdue';
    else {
      // 三天內
      const d1 = new Date(today + 'T00:00:00');
      const d2 = new Date(dl + 'T00:00:00');
      const diff = Math.round((d2 - d1) / 86400000);
      if (diff <= 3) flag = 'soon';
    }
  }
  const dlText = dl ? formatMD(dl) : '';
  const critBadge = it.critical ? `<span class="pk-crit" title="重要">⭐</span>` : '';
  const extLinks = renderPackingExt(it.id);
  // 只有 pk-more 展開時 detail 才會出來——沒 detail 但有 extLinks 也要能展

  const detailHtml = (it.detail || extLinks)
    ? `<div class="pk-detail"><span class="ico">💡</span><div class="body">${it.detail ? mdInline(it.detail) : ''}${extLinks}</div></div>`
    : '';
  return `
    <div class="pk-item" data-id="${escapeHtml(it.id)}"${flag ? ` data-flag="${flag}"` : ''}>
      <label class="pk-check">
        <input type="checkbox">
        <span class="pk-text">${escapeHtml(it.text || '')}</span>
      </label>
      ${dl ? `<span class="pk-deadline nw">${escapeHtml(dlText)}</span>` : ''}
      ${critBadge}
      ${(it.detail || extLinks) ? `<button type="button" class="pk-more" aria-label="展開說明">▾</button>` : ''}
      ${detailHtml}
    </div>
  `;
}

// 特定打包項目附上外部 App 連結（只對這幾條做，不做成資料驅動）
function renderPackingExt(id) {
  if (id === 'pk-dazaifu') {
    return `<div class="ext-row" style="margin-top:8px">
      <a class="ext-btn" href="https://www.myroute.fun/" target="_blank" rel="noopener">
        <span class="ico">🚌</span><span class="lbl">my route</span>
        <span class="ext-hint">會開 App 或網頁版</span>
      </a>
    </div>`;
  }
  if (id === 'pk-vjw') {
    return `<div class="ext-row" style="margin-top:8px">
      <a class="ext-btn" href="https://services.digital.go.jp/visit-japan-web/" target="_blank" rel="noopener">
        <span class="ico">🛂</span><span class="lbl">Visit Japan Web</span>
        <span class="ext-hint">會開 App 或網頁版</span>
      </a>
    </div>`;
  }
  return '';
}

function formatMD(iso) {
  // 2026-09-25 → 9/25
  if (!iso || iso.length < 10) return iso || '';
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return `${m}/${d}`;
}

async function copyAsText(groups) {
  const lines = ['# 打包清單', ''];
  for (const g of groups) {
    lines.push(`## ${g.label || g.key}`);
    for (const it of (g.items || [])) {
      const mark = isChecked(it.id) ? 'x' : ' ';
      const dl = it.deadline ? ` (${formatMD(it.deadline)})` : '';
      lines.push(`- [${mark}] ${it.text}${dl}`);
    }
    lines.push('');
  }
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('已複製到剪貼簿');
  } catch {
    // fallback: 開新視窗顯示
    const w = window.open('', '_blank');
    if (w) { w.document.body.innerText = text; }
    else prompt('複製失敗，手動複製這段：', text);
  }
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 1800);
}
