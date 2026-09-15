// hash router：#/…  →  { view, params }  →  view module render 到 #outlet
// 附帶「回上一頁停在原位」的捲動記憶。

import { render as renderItinerary } from './views/itinerary.js';
import { render as renderSpot }      from './views/spot.js';
import { render as renderStory }     from './views/story.js';
import { render as renderTools }     from './views/tools.js';
import { render as renderGuide }     from './views/guide.js';
import { render as renderRate }      from './views/rate.js';
import { render as renderPhrases }   from './views/phrases.js';
import { render as renderTips }      from './views/tips.js';
import { render as renderPacking }   from './views/packing.js';
import { render as renderFlight }    from './views/flight.js';
import { render as renderLedger }    from './views/ledger.js';
import { render as renderJournal }   from './views/journal.js';
import { render as renderSettings }  from './views/settings.js';
import { render as renderTalk }      from './views/talk.js';
import { render as renderSos }       from './views/sos.js';
import { render as renderTickets }   from './views/tickets.js';

const VIEWS = {
  home:    renderItinerary,
  day:     renderItinerary,
  spot:    renderSpot,
  story:   renderStory,
  guide:   renderGuide,
  tools:   renderTools,
  toolsub: renderTools,
  rate:    renderRate,
  phrases: renderPhrases,
  tips:    renderTips,
  packing: renderPacking,
  flight:  renderFlight,
  ledger:  renderLedger,
  journal: renderJournal,
  settings: renderSettings,
  talk:    renderTalk,
  sos:     renderSos,
  tickets: renderTickets,
};

const TOOL_VIEWS = {
  rate: 'rate',
  phrases: 'phrases',
  tips: 'tips',
  packing: 'packing',
  flight: 'flight',
  ledger: 'ledger',
  journal: 'journal',
  settings: 'settings',
  talk:    'talk',
  sos:     'sos',
  tickets: 'tickets',
};

export function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '').replace(/^\/+/, '');
  if (!raw) return { view: 'home', params: {} };

  // 拆掉 query
  const [path, queryStr] = raw.split('?');
  const query = {};
  if (queryStr) {
    for (const kv of queryStr.split('&')) {
      if (!kv) continue;
      const [k, v = ''] = kv.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }

  const parts = path.split('/').filter(Boolean);
  const [head, a] = parts;

  if (head === 'day')   return { view: 'day',   params: { n: Number(a) || 1, query } };
  if (head === 'spot')  return { view: 'spot',  params: { id: a, query } };
  if (head === 'story') return { view: 'story', params: { id: a, query } };
  if (head === 'guide') return { view: 'guide', params: { id: a, query } };
  if (head === 'tools') {
    if (a && TOOL_VIEWS[a]) return { view: TOOL_VIEWS[a], params: { query } };
    return { view: a ? 'toolsub' : 'tools', params: { sub: a || null, query } };
  }
  return { view: 'home', params: {} };
}

// 自己管捲動，不要讓瀏覽器插手
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const scrollMemory = new Map();   // hash → scrollY
let lastHash = location.hash || '#/';
let prevHash = null;              // 上一頁的 hash（給返回鍵決定要回哪）

function normalizeHash(h) { return h || '#/'; }

// 給 view 用：拿到「進到這頁之前的那個 hash」——比 backTo 精準
export function getPrevHash() { return prevHash; }

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

    if (currentHash !== lastHash) prevHash = lastHash;
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
  const isTools = route.view === 'tools' || route.view === 'toolsub'
    || route.view === 'rate' || route.view === 'phrases' || route.view === 'tips'
    || route.view === 'packing' || route.view === 'flight' || route.view === 'ledger'
    || route.view === 'journal' || route.view === 'settings'
    || route.view === 'talk' || route.view === 'sos' || route.view === 'tickets';

  tabs.forEach((a) => {
    a.removeAttribute('aria-current');
    if (isTools && a.dataset.role === 'tools') a.setAttribute('aria-current', 'page');
    if (activeDay != null && Number(a.dataset.day) === activeDay) a.setAttribute('aria-current', 'page');
  });
}
