// 上台講稿提詞頁：按頁顯示 data/speech.json（投影片備忘錄逐字），大字、左右滑換頁、計時速度燈、螢幕常亮
// 最後一頁之後是 Q&A 頁：救命句、9 題收合的題目卡（展開看英文回答）
// 路由 #/tools/script。進來時 body 加 script-open（藏掉 tabbar 與 hero），離開時移除。
// 測試用：#/tools/script?t=715 會把計時起點調到 11:55 並開始跑。
import { escapeHtml } from '../lib/md.js';
import { getPrevHash } from '../router.js';
import { speakEn, stopSpeak, hasTTS, getVoice } from '../lib/tts.js';

const LS_PAGE = 'script.page';
const LS_FS = 'script.fs';
const LS_THEME = 'script.theme';
const SS_TIMER = 'script.timer';
const SS_STATE = 'script.state';
const FS_MIN = 18, FS_MAX = 36, FS_STEP = 2, FS_DEFAULT = 24;
const OVER_SEC = 13 * 60;          // 講稿總時間超過 13:00 → 超時
const QA_START = 13 * 60, QA_END = 15 * 60;   // Q&A 頁的預計區間 13–15 分

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* 無痕模式等 */ } };
const ssGet = (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const ssDel = (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } };

export function mmss(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// 速度燈：e＝已經過秒數，[start, end]＝這一頁的預計區間
//   太快 e < start - tol、太慢 e > end + tol、其餘正常；tol = max(20, 區間長度 × 25%) 秒
export function paceState(e, start, end, isQA = false) {
  if (isQA ? e > QA_END : e > OVER_SEC) return 'over';
  const tol = Math.max(20, (end - start) * 0.25);
  if (e < start - tol) return 'fast';
  if (e > end + tol) return 'slow';
  return 'ok';
}
const STATE_LABEL = { ok: '正常', fast: '太快', slow: '太慢', over: '超時' };

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
  const qa = speech.qa && Array.isArray(speech.qa.items) && speech.qa.items.length ? speech.qa : null;
  const M = N + (qa ? 1 : 0);          // 總頁數；第 N+1 頁是 Q&A
  const isQA = (p) => !!qa && p === N + 1;

  // ---- 狀態 ----
  let page = Math.min(M, Math.max(1, parseInt(lsGet(LS_PAGE, '1'), 10) || 1));
  let fs = Math.min(FS_MAX, Math.max(FS_MIN, parseInt(lsGet(LS_FS, String(FS_DEFAULT)), 10) || FS_DEFAULT));
  let theme = lsGet(LS_THEME, 'dark') === 'light' ? 'light' : 'dark';
  let openQ = null;                    // Q&A 頁目前展開的題目 id（同時只開一張）
  let openRescue = null;               // 展開的救命句 index

  // 計時：{ running, startMs, accMs }。換頁、切 App 都不會歸零（存 sessionStorage）
  let timer = ssGet(SS_TIMER) || { running: false, startMs: 0, accMs: 0 };
  const q = params?.query?.t;
  if (q != null && q !== '' && Number.isFinite(Number(q))) {
    timer = { running: true, startMs: Date.now(), accMs: Math.max(0, Number(q)) * 1000 };
    ssSet(SS_TIMER, timer);
    ssDel(SS_STATE);
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
        <div class="script-progline"><span id="scEnd"></span></div>
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
          <div class="script-legend">🟢 正常　🟡 太快，可以放慢　🔴 太慢，要加快</div>
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

  // ---- 這一頁的預計區間（skip 的頁沿用上一頁）----
  function interval(p) {
    if (isQA(p)) return [QA_START, QA_END];
    if (slides[p - 1]?.skip && p > 1) return interval(p - 1);
    return [p > 1 ? (slides[p - 2].endSec || 0) : 0, slides[p - 1].endSec || 0];
  }

  // ---- 畫出目前這頁 ----
  function showPage(scrollTop = true) {
    stopSpeak();
    if (isQA(page)) {
      $('scPage').textContent = 'Q&A';
      $('scTitle').textContent = 'Questions · 問答';
      $('scEnd').textContent = `建議講到 ${mmss(QA_END)}`;
      $('scNext').textContent = '最後一頁';
      renderQA();
    } else {
      const s = slides[page - 1];
      $('scPage').textContent = `${page} / ${N}`;
      $('scTitle').textContent = s.title || '';
      $('scEnd').textContent = `建議講到 ${mmss(s.endSec || 0)}`;
      $('scNext').textContent = page < N ? `下一頁：${slides[page].title || ''}` : (qa ? '下一頁：Q&A' : '最後一頁');
      if (s.skip || !(s.paragraphs || []).length) {
        bodyEl.innerHTML = `<div class="script-skip">參考文獻頁，不用講——按下一頁</div>`;
      } else {
        bodyEl.innerHTML = s.paragraphs.map(par =>
          `<div class="script-par">${par.map(t => `<p class="script-sent">${escapeHtml(t)}</p>`).join('')}</div>`
        ).join('');
      }
    }
    $('scBar').style.width = `${(page / M) * 100}%`;
    $('scPrev').disabled = page <= 1;
    $('scForward').disabled = page >= M;
    if (scrollTop) bodyEl.scrollTop = 0;
    lsSet(LS_PAGE, page);
    markGrid();
    tick();
  }
  function go(n) {
    const next = Math.min(M, Math.max(1, n));
    if (next === page) return;
    page = next;
    showPage(true);
  }

  // ---- Q&A 頁 ----
  function renderQA() {
    const rescue = qa.rescue || [];
    const html = [];
    if (qa.note) html.push(`<div class="qa-note">${escapeHtml(qa.note)}</div>`);
    if (rescue.length) {
      html.push(`<div class="qa-h">救命句</div><div class="qa-rescue">${
        rescue.map((r, i) => `<button type="button" class="qa-pill${openRescue === i ? ' on' : ''}" data-rescue="${i}">${escapeHtml(r.zh)}</button>`).join('')
      }</div>`);
      if (openRescue != null && rescue[openRescue]) {
        const r = rescue[openRescue];
        html.push(`<div class="qa-rescue-open"><p class="qa-rescue-en" lang="en">${escapeHtml(r.en)}</p>
          <button type="button" class="qa-speak" data-speak-rescue="${openRescue}" aria-label="用英文唸">🔊</button></div>`);
      }
    }
    html.push(`<div class="qa-h">可能被問的 ${qa.items.length} 題</div>`);
    html.push(qa.items.map(it => {
      const open = openQ === it.id;
      const ans = open
        ? `<div class="qa-answer" lang="en">${(it.a || []).map(t => `<p class="script-sent">${escapeHtml(t)}</p>`).join('')}
            <button type="button" class="qa-speak" data-speak-q="${escapeHtml(it.id)}" aria-label="用英文唸整段">🔊 唸整段</button></div>`
        : '';
      return `<article class="qa-card${open ? ' open' : ''}" data-q="${escapeHtml(it.id)}">
        <button type="button" class="qa-head" data-toggle-q="${escapeHtml(it.id)}" aria-expanded="${open}">
          <span class="qa-who">${escapeHtml(it.who || '')}</span>
          <span class="qa-q" lang="en">${escapeHtml(it.q || '')}</span>
          <span class="qa-zh">${escapeHtml(it.zh || '')}</span>
        </button>${ans}</article>`;
    }).join(''));
    bodyEl.innerHTML = html.join('');
  }

  function speakBtn(btn, text) {
    if (!hasTTS()) { alert('這台裝置沒有英文語音。可到 設定 → 語言與輸入 → 文字轉語音 下載英文語音包。'); return; }
    if (btn.classList.contains('speaking')) { stopSpeak(); btn.classList.remove('speaking'); return; }
    bodyEl.querySelectorAll('.speaking').forEach(b => b.classList.remove('speaking'));
    btn.classList.add('speaking');
    getVoice('en');
    speakEn(text, () => btn.classList.remove('speaking'));
  }

  bodyEl.addEventListener('click', (e) => {
    if (!isQA(page)) return;
    const resc = e.target.closest('[data-rescue]');
    if (resc) {
      const i = Number(resc.dataset.rescue);
      stopSpeak();
      openRescue = openRescue === i ? null : i;
      const top = bodyEl.scrollTop;
      renderQA();
      bodyEl.scrollTop = top;
      return;
    }
    const sr = e.target.closest('[data-speak-rescue]');
    if (sr) { speakBtn(sr, qa.rescue[Number(sr.dataset.speakRescue)].en); return; }
    const sq = e.target.closest('[data-speak-q]');
    if (sq) {
      const it = qa.items.find(x => x.id === sq.dataset.speakQ);
      if (it) speakBtn(sq, (it.a || []).join(' '));
      return;
    }
    const tg = e.target.closest('[data-toggle-q]');
    if (tg) {
      stopSpeak();
      const id = tg.dataset.toggleQ;
      openQ = openQ === id ? null : id;       // 同時只展開一張
      renderQA();
      if (openQ) {
        const card = bodyEl.querySelector(`.qa-card[data-q="${CSS.escape(openQ)}"]`);
        if (card) bodyEl.scrollTop = Math.max(0, card.offsetTop - bodyEl.offsetTop - 8);
      }
    }
  });

  // ---- 計時速度燈 ----
  function vibrate() { try { navigator.vibrate?.(200); } catch { /* 不支援就略過 */ } }
  function tick() {
    const e = elapsed();
    const btn = $('scTimer');
    const started = timer.running || e >= 1;
    if (!started) {
      btn.className = 'script-timer idle';
      btn.textContent = '▶ 開始計時';
      btn.setAttribute('aria-label', '開始計時');
      return;
    }
    const [start, end] = interval(page);
    const state = paceState(e, start, end, isQA(page));
    const label = timer.running ? STATE_LABEL[state] : '暫停';
    btn.className = `script-timer sl-${state}${timer.running ? '' : ' paused'}`;
    btn.innerHTML = `<span class="st-time">${mmss(e)}</span><span class="st-label">${label}</span>`;
    btn.setAttribute('aria-label', `${timer.running ? '暫停計時' : '繼續計時'}，${mmss(e)}，${STATE_LABEL[state]}`);
    // 變成「太慢」或「超時」時震動一次；同一個狀態不重複震
    const last = ssGet(SS_STATE);
    if (state !== last) {
      ssSet(SS_STATE, state);
      if (timer.running && (state === 'slow' || state === 'over')) vibrate();
    }
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
    ssDel(SS_STATE);
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
  $('scGrid').innerHTML = slides.map(s => `<button type="button" class="script-cell" data-n="${s.n}">${s.n}</button>`).join('')
    + (qa ? `<button type="button" class="script-cell qa" data-n="qa">Q&amp;A</button>` : '');
  function markGrid() {
    const cur = isQA(page) ? 'qa' : String(slides[page - 1].n);
    root.querySelectorAll('.script-cell').forEach(c => c.classList.toggle('on', c.dataset.n === cur));
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
    if (cell) { page = cell.dataset.n === 'qa' ? N + 1 : Number(cell.dataset.n); panel.hidden = true; showPage(true); return; }
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

  getVoice('en');
  showPage(false);

  // ---- 離開時清乾淨 ----
  window.addEventListener('hashchange', () => {
    clearInterval(timerId);
    stopSpeak();
    document.removeEventListener('visibilitychange', onVis);
    try { lock?.release?.(); } catch { /* ignore */ }
    lock = null;
    if (!location.hash.startsWith('#/tools/script')) document.body.classList.remove('script-open');
  }, { once: true });
}
