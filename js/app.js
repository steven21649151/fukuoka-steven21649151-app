// 進入點：載五份資料 → 建 tabbar → 初始化 router → 依環境註冊 SW → 掛時間條

import { initRouter } from './router.js';
import { md } from './lib/fmt.js';
import { openBigCard } from './lib/bigcard.js';
import { warmUpJaVoice } from './lib/tts.js';

const DATA_FILES = ['spots', 'days', 'tips', 'phrases', 'packing', 'guides', 'rates'];
const FALLBACK_RATE = { jpyToTwd: 0.2035, asOf: null, source: null };
const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];

boot();

async function boot() {
  const outlet = document.getElementById('outlet');
  let data;
  try {
    data = await loadAllData();
  } catch (e) {
    outlet.innerHTML = `<div class="empty">資料載入失敗：${e.message}<br><br>本機開啟時請用 <code>python -m http.server</code> 或 <code>serve.ps1</code>，別直接 file:// 開。</div>`;
    return;
  }

  const ctx = { data };
  window.__ctx = ctx;

  buildTabbar(data.days);
  startNowClock(data.days);
  wireAllergyButton(ctx);
  wireGlobalTipLinks(ctx);
  initRouter(ctx);
  warmUpJaVoice();
  registerSW();
}

// 常駐 🦐：打開甲殼類過敏大字卡（scene=allergy，按 priority 排序）
function wireAllergyButton(ctx) {
  const btn = document.getElementById('allergyBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const list = (ctx.data.phrases || [])
      .filter(p => p.scene === 'allergy')
      .sort((a, b) => (a.priority || 99) - (b.priority || 99));
    if (!list.length) return;
    openBigCard(list, { startId: list[0].id });
  });
}

// 全域：文件中任何 data-tip="<id>" 的元素，點一下跳到那條 tip 並自動展開
function wireGlobalTipLinks(_ctx) {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    const id = el.getAttribute('data-tip');
    if (!id) return;
    e.preventDefault();
    location.hash = `#/tools/tips?highlight=${encodeURIComponent(id)}`;
  });
  // 行程頁上的過敏列（allergy-row）點下去→打開大字卡
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.allergy-row[data-open-allergy]');
    if (!el) return;
    e.preventDefault();
    document.getElementById('allergyBtn')?.click();
  });
}

async function loadAllData() {
  const entries = await Promise.all(DATA_FILES.map(async (k) => {
    try {
      const res = await fetch(`./data/${k}.json`, { cache: 'no-cache' });
      if (!res.ok) {
        // rates 讀不到 → fallback，不擋整頁
        if (k === 'rates') return [k, null];
        throw new Error(`${k}.json ${res.status}`);
      }
      return [k, await res.json()];
    } catch (e) {
      if (k === 'rates') return [k, null];
      throw e;
    }
  }));
  const raw = Object.fromEntries(entries);
  const rate = raw.rates
    ? { jpyToTwd: raw.rates.jpyToTwd || FALLBACK_RATE.jpyToTwd, asOf: raw.rates.asOf, source: raw.rates.source }
    : FALLBACK_RATE;
  return {
    spots: raw.spots.spots || [],
    days:  raw.days.days || [],
    tips:  raw.tips.tips || [],
    tipCategories: raw.tips.categories || [],
    scenes: raw.phrases.scenes || [],
    phrases: raw.phrases.phrases || [],
    emergencyInfo: raw.phrases.emergencyInfo || null,
    packingGroups: raw.packing.groups || [],
    guides: raw.guides.guides || [],
    rate,
  };
}

function buildTabbar(days) {
  const bar = document.getElementById('tabbar');
  const html = days.map(d => `<a href="#/day/${d.n}" data-day="${d.n}">
      <span class="kanji">${d.kanji}</span>
      <span class="date">${md(d.date)}</span>
    </a>`).join('') + `
    <a href="#/tools" data-role="tools" class="tools">
      <span class="toolicon">⚙︎</span>
      <span class="toollabel">小工具</span>
    </a>`;
  bar.innerHTML = html;
}

function startNowClock(days) {
  const nowEl = document.getElementById('nowtime');
  const stateEl = document.getElementById('tripstate');

  function tick() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    nowEl.textContent = `現在 ${m}/${dd}（${WEEKDAY_ZH[d.getDay()]}）${hh}:${mm}`;

    const today = `${d.getFullYear()}-${m}-${dd}`;
    const day = days.find(x => x.date === today);
    if (day) {
      stateEl.textContent = `第 ${day.n} 天 · ${md(day.date)}（${day.weekday}）`;
    } else if (days.length) {
      const first = days[0];
      const diff = daysBetween(today, first.date);
      if (diff > 0) stateEl.textContent = `距出發 ${diff} 天`;
      else if (diff < 0) stateEl.textContent = `已結束`;
      else stateEl.textContent = '';
    }
  }
  tick();
  const msToNextMin = 60000 - (Date.now() % 60000);
  setTimeout(() => { tick(); setInterval(tick, 60000); }, msToNextMin);
}

function daysBetween(aISO, bISO) {
  const a = new Date(aISO + 'T00:00:00');
  const b = new Date(bISO + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

// 開發期預設不註冊 SW，避免舊 SW / 舊 cache 卡住開發迭代。
// localhost 上加 ?sw=1 或 localStorage.devSW='1' 才註冊，用來測離線。
// 正式站（GitHub Pages）永遠註冊，並掛上「有新版」提示。
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  const isDev = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const forceSW = new URLSearchParams(location.search).has('sw')
    || localStorage.getItem('devSW') === '1';

  if (isDev && !forceSW) {
    navigator.serviceWorker.getRegistrations()
      .then(rs => rs.forEach(r => r.unregister()))
      .catch(() => {});
    caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
    return;
  }

  let reg;
  try {
    reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (err) {
    console.warn('SW register failed', err);
    return;
  }

  // 換版完成後只重整一次
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });

  // 一進來就檢查一次；waiting 已經在了就直接秀更新條
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg);

  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', () => {
      if (sw.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdateBar(reg);
      }
    });
  });

  // 啟動時檢查更新；從背景回前景時再檢查一次
  try { reg.update(); } catch {}
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      try { reg.update(); } catch {}
    }
  });
}

function showUpdateBar(reg) {
  if (document.getElementById('updatebar')) return;
  const bar = document.createElement('button');
  bar.id = 'updatebar';
  bar.className = 'updatebar';
  bar.type = 'button';
  bar.innerHTML = '<span>行程有更新</span><span class="cta">點一下重新整理</span>';
  bar.addEventListener('click', () => {
    bar.disabled = true;
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });
  document.body.appendChild(bar);
}
