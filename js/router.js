// hash router：#/…  →  { view, params }  →  view module render 到 #outlet
// 附帶「回上一頁停在原位」的捲動記憶。

import { render as renderItinerary } from './views/itinerary.js';
import { render as renderSpot }      from './views/spot.js';
import { render as renderStory }     from './views/story.js';
import { render as renderTools }     from './views/tools.js';
import { render as renderGuide }     from './views/guide.js';
import { render as renderRate }      from './views/rate.js';

const VIEWS = {
  home:    renderItinerary,
  day:     renderItinerary,
  spot:    renderSpot,
  story:   renderStory,
  guide:   renderGuide,
  tools:   renderTools,
  toolsub: renderTools,
  rate:    renderRate,
};

export function parseHash(hash) {
  const h = (hash || '').replace(/^#/, '').replace(/^\/+/, '');
  if (!h) return { view: 'home', params: {} };

  const parts = h.split('/').filter(Boolean);
  const [head, a] = parts;

  if (head === 'day')   return { view: 'day',   params: { n: Number(a) || 1 } };
  if (head === 'spot')  return { view: 'spot',  params: { id: a } };
  if (head === 'story') return { view: 'story', params: { id: a } };
  if (head === 'guide') return { view: 'guide', params: { id: a } };
  if (head === 'tools' && a === 'rate') return { view: 'rate', params: {} };
  if (head === 'tools') return { view: a ? 'toolsub' : 'tools', params: { sub: a || null } };
  return { view: 'home', params: {} };
}

// 自己管捲動，不要讓瀏覽器插手
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const scrollMemory = new Map();   // hash → scrollY
let lastHash = location.hash || '#/';

function normalizeHash(h) { return h || '#/'; }

export function initRouter(ctx) {
  const outlet = document.getElementById('outlet');
  const hero = document.getElementById('hero');

  async function run() {
    // 離開這頁之前把位置記下來
    scrollMemory.set(normalizeHash(lastHash), window.scrollY);

    const currentHash = normalizeHash(location.hash);
    const prevRoute = parseHash(lastHash);
    const route = parseHash(location.hash);

    // 從 tabbar 切換日期算「換頁」，不是「返回」→ 清目標記錄
    if (prevRoute.view === 'day' && route.view === 'day' && prevRoute.params.n !== route.params.n) {
      scrollMemory.delete(currentHash);
    }

    lastHash = currentHash;

    const showHero = route.view === 'home' || route.view === 'day';
    if (hero) hero.hidden = !showHero;

    const fn = VIEWS[route.view] || VIEWS.home;
    const restored = scrollMemory.has(currentHash);

    try {
      await fn(outlet, route.params, ctx, { restored });
    } catch (e) {
      console.error(e);
      outlet.innerHTML = `<div class="empty">畫面壞了：${e.message}</div>`;
    }

    const saved = scrollMemory.get(currentHash);
    // 用 setTimeout 而不是 rAF：tab 在背景時 rAF 會被 throttle，
    // 但捲動位置仍要準確
    setTimeout(() => {
      window.scrollTo({ top: saved ?? 0, behavior: 'instant' });
    }, 0);
    updateTabbar(route);
  }

  window.addEventListener('hashchange', run);
  run();
}

function updateTabbar(route) {
  const tabs = document.querySelectorAll('#tabbar a');
  const activeDay =
    route.view === 'day' ? route.params.n :
    route.view === 'home' ? (window.__currentDay || 1) :
    null;
  const isTools = route.view === 'tools' || route.view === 'toolsub' || route.view === 'rate';

  tabs.forEach((a) => {
    a.removeAttribute('aria-current');
    if (isTools && a.dataset.role === 'tools') a.setAttribute('aria-current', 'page');
    if (activeDay != null && Number(a.dataset.day) === activeDay) a.setAttribute('aria-current', 'page');
  });
}
