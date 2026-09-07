// 相關攻略頁 — 獨立一頁
import { mdInline, escapeHtml } from '../lib/md.js';

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

  const backHref = `#/spot/${encodeURIComponent(spot.id)}`;
  const story = spot.story;

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav">
        <a class="back" href="${backHref}">← 回 ${escapeHtml(spot.nameZh || spot.name)}</a>
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
