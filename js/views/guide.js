// 流程頁 — 給第一次搭飛機的人照著走
import { mdInline, escapeHtml } from '../lib/md.js';
import { getPrevHash } from '../router.js';

// 從這些頁面來的，返回就回去那裡（比 guide.backTo 準）
const KNOWN_BACK = {
  '#/tools/flight': '回航班',
  '#/tools/tips':   '回攻略',
};

export async function render(root, params, ctx) {
  const guide = (ctx.data.guides || []).find(g => g.id === params.id);
  if (!guide) {
    root.innerHTML = `
      <div class="wrap">
        <div class="topnav"><a class="back" href="#/">← 回行程</a></div>
        <div class="empty">找不到這份流程</div>
      </div>`;
    return;
  }

  const prev = getPrevHash();
  const prevKey = prev && matchKnown(prev);
  const backHref  = prevKey ? prev : (guide.backTo || '#/');
  const backLabel = prevKey ? KNOWN_BACK[prevKey] : (guide.backLabel || '回行程');

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="${escapeHtml(backHref)}">← ${escapeHtml(backLabel)}</a></div>
      <header class="guide-header">
        <h1>${escapeHtml(guide.title || '')}</h1>
        ${guide.lead ? `<p class="lead">${mdInline(guide.lead)}</p>` : ''}
      </header>

      ${(guide.steps || []).map(renderStep).join('')}

      ${Array.isArray(guide.faq) && guide.faq.length ? `
        <section class="guide-faq">
          <h2>常見問題</h2>
          ${guide.faq.map(q => `
            <div class="qa">
              <div class="q">${mdInline(q.q || '')}</div>
              <div class="a">${mdInline(q.a || '')}</div>
            </div>
          `).join('')}
        </section>
      ` : ''}
    </div>
  `;
}

// 忽略 query string 比對
function matchKnown(hash) {
  const base = hash.split('?')[0];
  return KNOWN_BACK[base] ? base : null;
}

function renderStep(s) {
  const doList = Array.isArray(s.do) && s.do.length
    ? `<ul class="do">${s.do.map(x => `<li>${mdInline(x)}</li>`).join('')}</ul>` : '';
  return `
    <section class="step">
      <div class="n">STEP ${s.n ?? ''}</div>
      <h3>${escapeHtml(s.h || '')}</h3>
      ${s.see ? `<div class="k">你會看到</div><div class="see">${mdInline(s.see)}</div>` : ''}
      ${doList ? `<div class="k">你要做</div>${doList}` : ''}
      ${s.watch ? `<div class="watch">${mdInline(s.watch)}</div>` : ''}
    </section>
  `;
}
