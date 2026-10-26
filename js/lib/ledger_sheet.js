// 行程卡右上 💴 pill 點了跳出的底部面板：這一格記了哪幾筆，可以改、刪、再記一筆
// - 不換頁：用 history.pushState 多墊一層，手機返回鍵只會關面板
// - 讀寫 IndexedDB 只做使用者自己按的「刪除」；出錯只顯示提示，行程頁不受影響

import { escapeHtml } from './md.js';
import { yen } from './fmt.js';
import { getAllLedger, deleteLedger } from './db.js';
import { rowHtml, confirmDelete, deleteMsg, toast } from './ledger_io.js';

let openSheet = null;   // 同時只開一個

// title：行程卡名稱；date：這一格那天（YYYY-MM-DD）；
// onChange(total)：刪除後通知行程頁更新 pill（total 是這一格剩下的日圓合計）
export async function openLedgerSheet({ itemId, date, title, lookup, onChange }) {
  if (openSheet) return;
  let rows;
  try {
    rows = await itemRows(itemId);
  } catch (e) {
    console.error('讀取這一格的記帳失敗', e);
    toast('暫時讀不到這一格的記帳');
    return;
  }
  if (!rows.length) return;

  const ov = document.createElement('div');
  ov.className = 'lsh-overlay';
  ov.innerHTML = `
    <div class="lsh-sheet" role="dialog" aria-modal="true" aria-labelledby="lshTitle">
      <div class="lsh-head">
        <div class="lsh-ttl">
          <div class="lsh-name" id="lshTitle">${escapeHtml(title || '')}</div>
          <div class="lsh-sum" id="lshSum"></div>
        </div>
        <button type="button" class="lsh-x" aria-label="關閉">✕</button>
      </div>
      <div class="lsh-body" id="lshBody"></div>
      <div class="lsh-foot"><button type="button" class="btn btn-primary" id="lshAdd">＋ 再記一筆</button></div>
    </div>`;
  document.body.appendChild(ov);
  const body = ov.querySelector('#lshBody');
  const sumEl = ov.querySelector('#lshSum');

  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  let closed = false;
  let pushed = false;
  try { history.pushState({ lsh: 1 }, ''); pushed = true; } catch { /* 沒有就退成直接關 */ }

  function finish() {
    if (closed) return;
    closed = true;
    openSheet = null;
    window.removeEventListener('popstate', finish);
    window.removeEventListener('hashchange', finish);
    document.documentElement.style.overflow = prevOverflow;
    ov.classList.remove('open');
    setTimeout(() => ov.remove(), 220);
  }
  // 返回鍵／換頁：popstate、hashchange 都只是把面板收掉
  window.addEventListener('popstate', finish);
  window.addEventListener('hashchange', finish);
  openSheet = { finish };

  // 主動關閉：墊過的那層歷史要退掉，不然返回鍵要多按一次
  function close() {
    if (closed) return;
    if (pushed) history.back();   // popstate → finish
    else finish();
  }
  // 關掉面板再去別頁（改／再記一筆）：先退掉墊的那層，這樣記帳頁按「回上一頁」會回到行程頁
  function goto(hash) {
    if (closed) { location.hash = hash; return; }
    if (pushed) {
      window.addEventListener('popstate', () => { location.hash = hash; }, { once: true });
      history.back();
    } else { finish(); location.hash = hash; }
  }

  function paint() {
    const total = rows.reduce((s, r) => s + (Number(r.jpy) || 0), 0);
    const twd = rows.reduce((s, r) => s + (Number(r.twd) || 0), 0);
    sumEl.innerHTML = `<b class="mono">${yen(total)}</b> <span class="mono faint">≈ NT$${twd.toLocaleString('en-US')}</span>　<span class="faint small">${rows.length} 筆</span>`;
    body.innerHTML = rows.map(r => rowHtml(r, { lookup, showItem: false })).join('');
  }
  paint();
  setTimeout(() => ov.classList.add('open'), 20);

  ov.addEventListener('click', async (e) => {
    if (e.target === ov || e.target.closest('.lsh-x')) { close(); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { goto('#/tools/ledger?edit=' + encodeURIComponent(ed.getAttribute('data-edit'))); return; }
    if (e.target.closest('#lshAdd')) {
      goto(`#/tools/ledger?date=${encodeURIComponent(date)}&item=${encodeURIComponent(itemId)}`);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const r = rows.find(x => x.id === del.getAttribute('data-del'));
    if (!r) return;
    if (!(await confirmDelete(deleteMsg(r)))) return;
    try {
      await deleteLedger(r.id);
      rows = await itemRows(itemId);
    } catch (err) {
      console.error('刪除失敗', err);
      toast('刪除失敗，再試一次');
      return;
    }
    const total = rows.reduce((s, x) => s + (Number(x.jpy) || 0), 0);
    try { onChange && onChange(total); } catch (err) { console.error(err); }
    if (!rows.length) close(); else paint();
  });
}

async function itemRows(itemId) {
  return (await getAllLedger())
    .filter(r => r && r.itemId === itemId)
    .sort((a, b) => (a.date === b.date ? (a.time || '').localeCompare(b.time || '') : (a.date < b.date ? -1 : 1)));
}
