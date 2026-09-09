// 相關攻略頁 — 獨立一頁
import { mdInline, escapeHtml } from '../lib/md.js';
import { getPrevHash } from '../router.js';

const KNOWN_BACK = {
  '#/tools/tips':    '回攻略',
  '#/tools/flight':  '回航班',
  '#/tools/phrases': '回句庫',
  '#/tools/packing': '回打包清單',
  '#/tools':         '回小工具',
};

export async function render(root, params, ctx) {
  const spot = ctx.data.spots.find(s => s.id === params.id);
  if (!spot || !spot.story) {
    root.innerHTML = `
      <div class="wrap">
        <div class="topnav"><a class="back" href="#/spot/${encodeURIComponent(params.id || '')}">← 回上一頁</a></div>
        <div class="empty">這裡還沒有相關攻略</div>
      </div>`;
    return;
  }

  const prev = getPrevHash();
  const prevBase = prev ? prev.split('?')[0] : null;
  const useKnown = prevBase && KNOWN_BACK[prevBase];
  const backHref = useKnown ? prev : `#/spot/${encodeURIComponent(spot.id)}`;
  const backLabel = useKnown ? KNOWN_BACK[prevBase] : `回 ${spot.nameZh || spot.name}`;
  const story = spot.story;

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav">
        <a class="back" href="${backHref}">← ${escapeHtml(backLabel)}</a>
      </div>

      <h1 class="story-title">${escapeHtml(story.title || '')}</h1>
      <div class="story-sub">關於 · ${escapeHtml(spot.nameZh || spot.name)}</div>

      ${(story.sections || []).map(sec => `
        <section class="story-section">
          ${sec.h ? `<h3>${escapeHtml(sec.h)}</h3>` : ''}
          ${sec.p ? `<p>${mdInline(sec.p)}</p>` : ''}
        </section>
      `).join('')}
    </div>
  `;
}
