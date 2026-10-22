// 上台講稿提詞頁：按頁顯示 data/speech.json（投影片備忘錄逐字），大字、左右滑換頁、計時、螢幕常亮
// 路由 #/tools/script。進來時 body 加 script-open（藏掉 tabbar 與 hero），離開時移除。
// 測試用：#/tools/script?t=715 會把計時起點調到 11:55 並開始跑，方便看 12:00／13:00 變色。
import { escapeHtml } from '../lib/md.js';
import { getPrevHash } from '../router.js';

const LS_PAGE = 'script.page';
const LS_FS = 'script.fs';
const LS_THEME = 'script.theme';
const SS_TIMER = 'script.timer';
const SS_VIB = 'script.vib';
const FS_MIN = 18, FS_MAX = 36, FS_STEP = 2, FS_DEFAULT = 24;
const ORANGE_SEC = 12 * 60, RED_SEC = 13 * 60;

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* 無痕模式等 */ } };
const ssGet = (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const ssDel = (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } };

export function mmss(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
const mss = (sec) => `${Math.floor(Math.abs(sec) / 60)}:${String(Math.round(Math.abs(sec)) % 60).padStart(2, '0')}`;

export async function render(root, params, ctx) {
  const speech = ctx.data.speech;
  if (!speech || !Array.isArray(speech.slides) || !speech.slides.length) {
    root.innerHTML = `
      <div class="wrap">
        <div class="topnav"><a class="back" href="#/tools/talk">← 報告</a></div>
        <div class="empty">找不到講稿資料</div>
      </div>`;
    return;
  }
  const slides = speech.slides;
  const N = slides.length;

  // ---- 狀態 ----
  let page = Math.min(N, Math.max(1, parseInt(lsGet(LS_PAGE, '1'), 10) || 1));
  let fs = Math.min(FS_MAX, Math.max(FS_MIN, parseInt(lsGet(LS_FS, String(FS_DEFAULT)), 10) || FS_DEFAULT));
  let theme = lsGet(LS_THEME, 'dark') === 'light' ? 'light' : 'dark';

  // 計時：{ running, startMs, accMs }。換頁、切 App 都不會歸零（存 sessionStorage）
  let timer = ssGet(SS_TIMER) || { running: false, startMs: 0, accMs: 0 };
  const q = params?.query?.t;
  if (q != null && q !== '' && Number.isFinite(Number(q))) {
    timer = { running: true, startMs: Date.now(), accMs: Math.max(0, Number(q)) * 1000 };
    ssSet(SS_TIMER, timer);
    ssSet(SS_VIB, 0);
  }
  const elapsed = () => (timer.accMs + (timer.running ? Date.now() - timer.startMs : 0)) / 1000;

  document.body.classList.add('script-open');

  // 返回：從第 N 天的卡片進來就回那一天，其他（我的報告、直接開）回「我的報告」
  const prev = getPrevHash() || '';
  const dm = /^#\/day\/(\d+)/.exec(prev);
  const back = dm ? { href: `#/day/${dm[1]}`, label: `← 第 ${dm[1]} 天` } : { href: '#/tools/talk', label: '← 報告' };

  root.innerHTML = `
    <div class="script-app" data-theme="${theme}" style="--script-fs:${fs}px">
      <div class="script-top">
        <a class="script-back" href="${back.href}">${back.label}</a>
        <button type="button" class="script-page" id="scPage" aria-label="跳頁"></button>
        <button type="button" class="script-timer" id="scTimer" aria-label="計時"></button>
      </div>
      <div class="script-title" id="scTitle"></div>
      <div class="script-prog">
        <div class="script-bar"><i id="scBar"></i></div>
        <div class="script-progline"><span id="scEnd"></span><span id="scDiff"></span></div>
      </div>
      <div class="script-body" id="scBody"></div>
      <div class="script-bottom">
        <div class="script-next" id="scNext"></div>
        <div class="script-btns">
          <button type="button" class="script-btn" id="scPrev">◀ 上一頁</button>
          <button type="button" class="script-btn primary" id="scForward">下一頁 ▶</button>
        </div>
      </div>
      <div class="script-panel" id="scPanel" hidden>
        <div class="script-panel-box" role="dialog" aria-modal="true" aria-label="跳頁">
          <div class="script-grid" id="scGrid"></div>
          <div class="script-panel-row">
            <button type="button" class="script-chip" data-a="first">⟲ 回第 1 頁</button>
            <button type="button" class="script-chip" data-a="reset">⏹ 計時歸零</button>
          </div>
          <div class="script-panel-row">
            <button type="button" class="script-chip" data-a="fs-">A−</button>
            <span class="script-fsval" id="scFs"></span>
            <button type="button" class="script-chip" data-a="fs+">A+</button>
            <button type="button" class="script-chip" data-a="theme" id="scTheme"></button>
          </div>
          <button type="button" class="script-chip close" data-a="close">關閉</button>
        </div>
      </div>
    </div>`;

  const app = root.querySelector('.script-app');
  const $ = (id) => root.querySelector('#' + id);
  const bodyEl = $('scBody');

  // ---- 畫出目前這頁 ----
  function showPage(scrollTop = true) {
    const s = slides[page - 1];
    $('scPage').textContent = `${page} / ${N}`;
    $('scTitle').textContent = s.title || '';
    $('scBar').style.width = `${(page / N) * 100}%`;
    $('scEnd').textContent = `這頁講完約 ${mmss(s.endSec || 0)}`;
    $('scNext').textContent = page < N ? `下一頁：${slides[page].title || ''}` : '最後一頁';
    $('scPrev').disabled = page <= 1;
    $('scForward').disabled = page >= N;
    if (s.skip || !(s.paragraphs || []).length) {
      bodyEl.innerHTML = `<div class="script-skip">參考文獻頁，不用講——按下一頁</div>`;
    } else {
      bodyEl.innerHTML = s.paragraphs.map(par =>
        `<div class="script-par">${par.map(t => `<p class="script-sent">${escapeHtml(t)}</p>`).join('')}</div>`
      ).join('');
    }
    if (scrollTop) bodyEl.scrollTop = 0;
    lsSet(LS_PAGE, page);
    markGrid();
    tick();
  }
  function go(n) {
    const next = Math.min(N, Math.max(1, n));
    if (next === page) return;
    page = next;
    showPage(true);
  }

  // ---- 計時 ----
  function vibrate() { try { navigator.vibrate?.(200); } catch { /* 不支援就略過 */ } }
  function tick() {
    const e = elapsed();
    const btn = $('scTimer');
    btn.textContent = `${timer.running ? '⏸' : '▶'} ${mmss(e)}`;
    btn.classList.toggle('orange', e >= ORANGE_SEC && e < RED_SEC);
    btn.classList.toggle('red', e >= RED_SEC);
    // 12:00、13:00 各震動一次（只在剛跨過時；重新整理時已經過了就不補震）
    const fired = ssGet(SS_VIB) || 0;
    for (const th of [ORANGE_SEC, RED_SEC]) {
      if (e >= th && fired < th) {
        ssSet(SS_VIB, th);
        if (timer.running && e - th < 3) vibrate();
      }
    }
    // 超前／落後：已經過時間 vs 上一頁的 endSec
    const diffEl = $('scDiff');
    const planned = page > 1 ? (slides[page - 2].endSec || 0) : 0;
    if (!timer.running && e < 1) { diffEl.textContent = ''; diffEl.className = ''; return; }
    const d = e - planned;
    if (d <= 0) { diffEl.textContent = `超前 ${mss(d)}`; diffEl.className = 'ahead'; }
    else { diffEl.textContent = `落後 ${mss(d)}`; diffEl.className = d > 60 ? 'late' : 'behind'; }
  }
  function toggleTimer() {
    if (timer.running) timer = { running: false, startMs: 0, accMs: elapsed() * 1000 };
    else timer = { running: true, startMs: Date.now(), accMs: timer.accMs };
    ssSet(SS_TIMER, timer);
    tick();
  }
  function resetTimer() {
    timer = { running: false, startMs: 0, accMs: 0 };
    ssSet(SS_TIMER, timer);
    ssDel(SS_VIB);
    tick();
  }
  $('scTimer').addEventListener('click', toggleTimer);
  const timerId = setInterval(tick, 250);

  // ---- 換頁：按鈕、左右滑 ----
  $('scPrev').addEventListener('click', () => go(page - 1));
  $('scForward').addEventListener('click', () => go(page + 1));
  let sw = null;
  bodyEl.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY }; });
  bodyEl.addEventListener('pointercancel', () => { sw = null; });
  bodyEl.addEventListener('pointerup', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    sw = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(page + (dx < 0 ? 1 : -1));
  });

  // ---- 跳頁面板 ----
  const panel = $('scPanel');
  $('scGrid').innerHTML = slides.map(s => `<button type="button" class="script-cell" data-n="${s.n}">${s.n}</button>`).join('');
  function markGrid() {
    root.querySelectorAll('.script-cell').forEach(c => c.classList.toggle('on', Number(c.dataset.n) === slides[page - 1].n));
  }
  function applyLook() {
    app.dataset.theme = theme;
    app.style.setProperty('--script-fs', fs + 'px');
    $('scFs').textContent = `${fs}px`;
    $('scTheme').textContent = theme === 'dark' ? '☀ 淺色' : '🌙 深色';
  }
  $('scPage').addEventListener('click', () => { panel.hidden = false; });
  panel.addEventListener('click', (e) => {
    if (e.target === panel) { panel.hidden = true; return; }
    const cell = e.target.closest('.script-cell');
    if (cell) { page = Number(cell.dataset.n); panel.hidden = true; showPage(true); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'close') panel.hidden = true;
    else if (a === 'first') { page = 1; panel.hidden = true; showPage(true); }
    else if (a === 'reset') resetTimer();
    else if (a === 'fs-') { fs = Math.max(FS_MIN, fs - FS_STEP); lsSet(LS_FS, fs); applyLook(); }
    else if (a === 'fs+') { fs = Math.min(FS_MAX, fs + FS_STEP); lsSet(LS_FS, fs); applyLook(); }
    else if (a === 'theme') { theme = theme === 'dark' ? 'light' : 'dark'; lsSet(LS_THEME, theme); applyLook(); }
  });
  applyLook();

  // ---- 螢幕常亮（沿用 bigcard 的做法）----
  let lock = null;
  async function acquireLock() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); }
    catch { /* 拒絕或不支援 → 安靜略過 */ }
  }
  const onVis = () => { if (document.visibilityState === 'visible') { acquireLock(); tick(); } };
  document.addEventListener('visibilitychange', onVis);
  acquireLock();

  showPage(false);

  // ---- 離開時清乾淨 ----
  window.addEventListener('hashchange', () => {
    clearInterval(timerId);
    document.removeEventListener('visibilitychange', onVis);
    try { lock?.release?.(); } catch { /* ignore */ }
    lock = null;
    if (!location.hash.startsWith('#/tools/script')) document.body.classList.remove('script-open');
  }, { once: true });
}
