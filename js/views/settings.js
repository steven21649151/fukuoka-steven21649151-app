// 設定頁：主題、匯率覆寫、一鍵匯出全部資料、儲存用量與持久化、版本／檢查更新
import { escapeHtml } from '../lib/md.js';
import { getTheme, setTheme } from '../lib/theme.js';
import { getRate, setOverride, clearOverride, onChange as onRateChange } from '../lib/rate.js';
import { getAllLedger, getAllJournal, isAvailable } from '../lib/db.js';
import { buildCSV as buildLedgerCSV } from './ledger.js';
import { createZip } from '../lib/zip.js';

export async function render(root, params, ctx) {
  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">設定</h1>

      <section class="set-block">
        <div class="set-h">🎨 主題</div>
        <div class="set-seg chiprow" id="themeSeg" role="radiogroup" aria-label="主題">
          <button type="button" class="chip" data-theme="system">跟隨系統</button>
          <button type="button" class="chip" data-theme="light">淺色</button>
          <button type="button" class="chip" data-theme="dark">深色</button>
        </div>
      </section>

      <section class="set-block">
        <div class="set-h">💱 匯率覆寫</div>
        <div class="set-body" id="rateBox"></div>
        <div class="set-row">
          <label class="set-field">
            <span>¥1 = NT$</span>
            <input id="setOverrideInput" inputmode="decimal" placeholder="例：0.2145" step="0.0001">
          </label>
          <button type="button" class="btn btn-primary" id="setOverrideApply">套用</button>
          <button type="button" class="btn" id="setOverrideClear">恢復自動</button>
        </div>
        <div class="small faint">同步顯示在 💱 浮層與記帳頁的即時換算。</div>
      </section>

      <section class="set-block">
        <div class="set-h">💾 一鍵匯出全部</div>
        <div class="small faint" style="margin-bottom:8px">
          打包所有記帳、手帳照片、打包清單、設定成一個 zip。
        </div>
        <button type="button" class="btn btn-primary" id="setExport">📤 匯出 zip</button>
        <span id="setExportState" class="small faint" style="margin-left:8px"></span>
      </section>

      <section class="set-block">
        <div class="set-h">🗄 儲存用量</div>
        <div class="set-body" id="storageBox">計算中…</div>
      </section>

      <section class="set-block">
        <div class="set-h">🆕 版本</div>
        <div class="set-body" id="verBox">讀取中…</div>
        <button type="button" class="btn" id="setCheckUpd">檢查更新</button>
        <span id="setUpdState" class="small faint" style="margin-left:8px"></span>
      </section>

      <p class="small faint" style="margin-top:24px;line-height:1.7">
        打包勾選、記帳、手帳照片都只存在這支手機裡，<b>不是雲端</b>。<br>
        換手機、或在手機設定裡清除瀏覽器資料，這些都會消失——出發前記得用上面的按鈕匯出一份。
      </p>
    </div>
  `;

  wireTheme(root);
  wireRate(root, ctx);
  await wireStorage(root);
  await wireVersion(root);
  wireExport(root, ctx);
}

// ============ 主題 ============
function wireTheme(root) {
  const seg = root.querySelector('#themeSeg');
  const cur = getTheme();
  seg.querySelectorAll('button').forEach(b => {
    if (b.getAttribute('data-theme') === cur) b.setAttribute('aria-current', 'true');
  });
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-theme]');
    if (!btn) return;
    const t = btn.getAttribute('data-theme');
    seg.querySelectorAll('button').forEach(b => b.removeAttribute('aria-current'));
    btn.setAttribute('aria-current', 'true');
    setTheme(t);
  });
}

// ============ 匯率覆寫 ============
function wireRate(root, ctx) {
  const baseFromJson = ctx.data.rate;
  const rateBox = root.querySelector('#rateBox');
  const input = root.querySelector('#setOverrideInput');
  const apply = root.querySelector('#setOverrideApply');
  const clear = root.querySelector('#setOverrideClear');

  function paint() {
    const r = getRate();
    let tag;
    if (r.tag === 'override') tag = `<span class="rate-tag override">手動</span>`;
    else if (r.tag === 'live') tag = `<span class="rate-tag live">即時</span>`;
    else if (r.tag === 'stale') tag = `<span class="rate-tag stale">舊值</span>`;
    else tag = `<span class="rate-tag base">基準</span>`;
    rateBox.innerHTML = `<div>目前生效：<span class="mono">¥1 = NT$${r.jpyToTwd.toFixed(4)}</span> ${tag} <span class="faint small">（${escapeHtml(r.source || '')}）</span></div>`;
    clear.disabled = r.tag !== 'override';
  }
  paint();
  const off = onRateChange(paint);
  window.addEventListener('hashchange', off, { once: true });

  apply.addEventListener('click', () => {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v) || v <= 0) return;
    setOverride(v, baseFromJson);
    input.value = '';
  });
  clear.addEventListener('click', () => clearOverride(baseFromJson));
}

// ============ 儲存用量 ============
async function wireStorage(root) {
  const box = root.querySelector('#storageBox');
  const parts = [];
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      parts.push(`已用 <b>${humanBytes(est.usage || 0)}</b> / 可用 <b>${humanBytes(est.quota || 0)}</b>`);
    } catch { parts.push('估算失敗'); }
  } else {
    parts.push('這個瀏覽器不支援用量估算');
  }
  let persisted = false;
  try { persisted = await (navigator.storage?.persisted?.() || Promise.resolve(false)); } catch {}
  parts.push(persisted
    ? `<div class="set-persist good">✅ 系統已保證不會自動清除</div>`
    : `<div class="set-persist warn">⚠️ 裝置空間不足時可能被清除，建議定期匯出備份</div>`);
  box.innerHTML = parts.join('');
}

// ============ 版本／檢查更新 ============
async function wireVersion(root) {
  const box = root.querySelector('#verBox');
  const state = root.querySelector('#setUpdState');
  let ver = null;
  try {
    const r = await fetch('./version.json', { cache: 'no-store' });
    if (r.ok) ver = await r.json();
  } catch {}
  box.innerHTML = ver
    ? `目前版本：<span class="mono">${escapeHtml(ver.app || '?')}</span> · 資料更新於 <span class="mono">${escapeHtml(ver.data || '?')}</span>`
    : '<span class="faint">讀取版本失敗</span>';

  const btn = root.querySelector('#setCheckUpd');
  btn.addEventListener('click', async () => {
    state.textContent = '檢查中…';
    if (!('serviceWorker' in navigator)) { state.textContent = '這個瀏覽器不支援離線更新機制'; return; }
    const regs = await navigator.serviceWorker.getRegistrations();
    if (!regs.length) { state.textContent = '目前沒有 Service Worker（開發模式）'; return; }
    try {
      for (const reg of regs) await reg.update();
      state.textContent = '已檢查。有新版會在底部跳提示條。';
    } catch (e) {
      state.textContent = '檢查失敗：' + (e.message || e);
    }
  });
}

// ============ 一鍵匯出 zip ============
function wireExport(root, ctx) {
  const btn = root.querySelector('#setExport');
  const state = root.querySelector('#setExportState');
  btn.addEventListener('click', async () => {
    btn.disabled = true; state.textContent = '打包中…';
    try {
      const blob = await buildAllZip(ctx);
      const fname = `fukuoka-備份-${todayStamp()}.zip`;
      await downloadOrShare(blob, fname);
      state.textContent = '完成。';
      try { localStorage.setItem('ledger.lastExport', new Date().toISOString().slice(0,10)); } catch {}
    } catch (e) {
      state.textContent = '失敗：' + (e.message || e);
    } finally { btn.disabled = false; }
  });
}

async function buildAllZip(ctx) {
  const zip = createZip();

  // 記帳
  let ledgerRows = [];
  if (await isAvailable()) {
    try { ledgerRows = await getAllLedger(); } catch {}
  }
  const ledgerCSV = buildLedgerCSV(ledgerRows, ctx.data.days);
  zip.addString('記帳.csv', ledgerCSV);

  // 手帳
  let journalRows = [];
  if (await isAvailable()) {
    try { journalRows = await getAllJournal(); } catch {}
  }
  const jHeader = ['檔名','日期','景點','備註'];
  const jLines = [jHeader.join(',')];
  for (const r of journalRows) {
    const fname = `${(r.name || r.id)}.jpg`;
    zip.addFile(`手帳/${safe(fname)}`, r.blob);
    jLines.push([safe(fname), (r.createdAt||'').slice(0,10), r.spotId || '', csvSafe(r.note)].join(','));
  }
  zip.addString('手帳/手帳.csv', '﻿' + jLines.join('\r\n'));

  // 打包清單（含勾選狀態）
  zip.addString('打包清單.csv', buildPackingCSV(ctx.data.packingGroups || []));

  // 設定
  const settings = {
    theme: getTheme(),
    rateOverride: (() => { try { return localStorage.getItem('rate.override'); } catch { return null; } })(),
    exportedAt: new Date().toISOString(),
  };
  zip.addString('設定.json', JSON.stringify(settings, null, 2));

  return zip.build();
}

function buildPackingCSV(groups) {
  const header = ['分組','項目','已完成','期限','備註'];
  const lines = [header.map(csvSafe).join(',')];
  for (const g of groups) {
    for (const it of (g.items || [])) {
      let done = false;
      try { done = localStorage.getItem('packing.' + it.id) === '1'; } catch {}
      lines.push([g.label || g.key, it.text || '', done ? '是' : '', it.deadline || '', it.detail || '']
        .map(csvSafe).join(','));
    }
  }
  return '﻿' + lines.join('\r\n');
}

// < 1 MB → KB（一位小數）；≥ 1024 MB → GB；其餘 MB
function humanBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  const KB = n / 1024;
  if (KB < 1024) return `${KB < 10 ? KB.toFixed(1) : Math.round(KB)} KB`;
  const MB = KB / 1024;
  if (MB < 1024) return `${MB < 10 ? MB.toFixed(1) : Math.round(MB)} MB`;
  return `${(MB / 1024).toFixed(2)} GB`;
}

function safe(name) { return name.replace(/[\\/:*?"<>|]/g, '_'); }
function csvSafe(s) {
  if (s == null) return '';
  const str = String(s);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

async function downloadOrShare(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch {}
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
  } catch { alert('匯出失敗'); }
}
