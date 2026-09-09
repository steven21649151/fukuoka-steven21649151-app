// 攻略 Tips：分類 chip、critical 置頂、可摺疊、sources 連結（離線停用）、highlight query
import { escapeHtml, mdInline } from '../lib/md.js';

const SEVERITY = {
  critical:  { rank: 0, label: '一定要知道', color: 'crit' },
  important: { rank: 1, label: '會吃虧',     color: 'imp' },
  info:      { rank: 2, label: '知道更好',   color: 'info' },
};

export async function render(root, params, ctx) {
  const cats = ctx.data.tipCategories || [];
  const tips = ctx.data.tips || [];

  const initialCat = params?.query?.cat || (cats[0]?.key || null);
  const highlightId = params?.query?.highlight || null;

  // 如果有 highlight 指定，切到那條的分類
  let currentCat = initialCat;
  if (highlightId) {
    const t = tips.find(x => x.id === highlightId);
    if (t) currentCat = t.category;
  }

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">攻略 Tips</h1>
      <p class="small faint" style="margin-bottom:10px">
        點標題展開；紅色的是「不知道會出事」，優先看。
      </p>

      <nav class="chiprow" id="tipCats" aria-label="分類切換">
        <button type="button" class="chip" data-cat="__all"
                ${!currentCat ? 'aria-current="true"' : ''}>全部</button>
        ${cats.map(c => `
          <button type="button" class="chip" data-cat="${escapeHtml(c.key)}"
                  ${c.key === currentCat ? 'aria-current="true"' : ''}>
            ${escapeHtml(c.label || c.key)}
          </button>
        `).join('')}
      </nav>

      <div id="tipList" class="tip-list"></div>
    </div>
  `;

  const listEl = root.querySelector('#tipList');
  const chipsEl = root.querySelector('#tipCats');

  chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (!btn) return;
    const key = btn.getAttribute('data-cat');
    chipsEl.querySelectorAll('button').forEach(b => b.removeAttribute('aria-current'));
    btn.setAttribute('aria-current', 'true');
    paint(key);
    // 更新 URL
    const cur = location.hash.split('?')[0];
    if (key === '__all') history.replaceState(null, '', cur);
    else history.replaceState(null, '', `${cur}?cat=${encodeURIComponent(key)}`);
  });

  function paint(catKey) {
    let list = tips.slice();
    if (catKey && catKey !== '__all') list = list.filter(t => t.category === catKey);
    list.sort((a, b) => {
      const ra = SEVERITY[a.severity]?.rank ?? 9;
      const rb = SEVERITY[b.severity]?.rank ?? 9;
      if (ra !== rb) return ra - rb;
      return 0;
    });
    listEl.innerHTML = list.length
      ? list.map(t => renderTip(t, t.id === highlightId)).join('')
      : `<div class="empty">這個分類還沒有內容</div>`;

    wireExpand();
    if (highlightId) scrollToHighlighted();
  }

  function wireExpand() {
    listEl.querySelectorAll('.tip-item .tip-head').forEach(head => {
      head.addEventListener('click', () => {
        const item = head.closest('.tip-item');
        if (!item) return;
        const isOpen = item.getAttribute('data-open') === '1';
        item.setAttribute('data-open', isOpen ? '0' : '1');
      });
    });
  }

  function scrollToHighlighted() {
    const el = listEl.querySelector(`.tip-item[data-id="${CSS.escape(highlightId)}"]`);
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  paint(currentCat || '__all');
}

function renderTip(t, expanded) {
  const sev = SEVERITY[t.severity] || { color: 'info', label: '' };
  const online = navigator.onLine;
  const sourcesHtml = Array.isArray(t.sources) && t.sources.length
    ? `<div class="sources">
         ${t.sources.map(u => `
           <a class="src ${online ? '' : 'disabled'}" href="${escapeHtml(u)}"
              ${online ? 'target="_blank" rel="noopener"' : 'aria-disabled="true"'}
              >${online ? '🔗' : '🔒'} ${escapeHtml(shortUrl(u))}</a>
         `).join('')}
       </div>` : '';

  return `
    <article class="tip-item sev-${sev.color}" data-id="${escapeHtml(t.id)}" data-open="${expanded ? '1' : '0'}">
      <button type="button" class="tip-head">
        <span class="dot" aria-hidden="true"></span>
        <span class="title">${escapeHtml(t.title || '')}</span>
        <span class="chev" aria-hidden="true">▾</span>
      </button>
      <div class="tip-body">
        ${renderBody(t.body)}
        ${sourcesHtml}
      </div>
    </article>
  `;
}

// body 支援 **粗體**、\n 換行、- 清單
function renderBody(text) {
  if (!text) return '';
  const lines = String(text).split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) {
      if (!inList) { out.push('<ul class="tip-ul">'); inList = true; }
      const body = line.replace(/^\s*-\s+/, '');
      out.push(`<li>${mdInline(body)}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (line.trim() === '') out.push('<div class="sp"></div>');
      else out.push(`<p>${mdInline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

function shortUrl(u) {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, '') + (url.pathname !== '/' ? url.pathname : '');
  } catch { return u; }
}
