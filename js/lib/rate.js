// 匯率來源優先序：
//   ① localStorage 'rate.override'（手動覆寫）——一律最高
//   ② localStorage 'rate.cache'（今天成功抓到的 API 值）
//   ③ ②的舊值（不是今天，但成功過）
//   ④ 內建 data/rates.json（台銀現金賣出）
//
// 用法：
//   initRate(ctx.data.rate);   // 頁面啟動時：立即拿到 ③④，同時背景抓 ②
//   getRate();                 // 任何時候取現值 { jpyToTwd, tag, source, asOf }
//   setOverride(v)/clearOverride()
//   onChange(fn)               // 監聽變動（背景 API 回來、手動覆寫、恢復）→ 通知 view 重繪

const LS_OVERRIDE = 'rate.override';
const LS_CACHE    = 'rate.cache';        // { rate, fetchedAt(ISO) }
const API_URL     = 'https://open.er-api.com/v6/latest/JPY';
const API_TIMEOUT = 5000;
const FALLBACK    = { jpyToTwd: 0.2035, asOf: '2026-08-27', source: '台灣銀行 現金賣出' };

let _current = null;
const _listeners = new Set();

function readOverride() {
  try {
    const v = localStorage.getItem(LS_OVERRIDE);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}
function readCache() {
  try {
    const raw = localStorage.getItem(LS_CACHE);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !Number.isFinite(o.rate) || !o.fetchedAt) return null;
    return o;
  } catch { return null; }
}
function writeCache(rate) {
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify({ rate, fetchedAt: new Date().toISOString() }));
  } catch {}
}

function isSameDay(iso) {
  if (!iso) return false;
  return iso.slice(0, 10) === new Date().toISOString().slice(0, 10);
}
function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function compose(baseFromJson) {
  const base = baseFromJson || FALLBACK;
  const override = readOverride();
  if (override != null) {
    return { jpyToTwd: override, tag: 'override', source: '手動', asOf: null };
  }
  const cache = readCache();
  if (cache) {
    return {
      jpyToTwd: cache.rate,
      tag: isSameDay(cache.fetchedAt) ? 'live' : 'stale',
      source: isSameDay(cache.fetchedAt) ? '即期參考' : '即期參考（舊值）',
      asOf: cache.fetchedAt,
    };
  }
  return { jpyToTwd: base.jpyToTwd, tag: 'base', source: base.source || FALLBACK.source, asOf: base.asOf || FALLBACK.asOf };
}

function notify() { for (const fn of _listeners) { try { fn(_current); } catch {} } }

async function fetchWithTimeout(url, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function tryFetch(baseFromJson) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    const j = await fetchWithTimeout(API_URL, API_TIMEOUT);
    const r = j?.rates?.TWD;
    if (!Number.isFinite(r) || r <= 0) return;
    writeCache(r);
    _current = compose(baseFromJson);
    notify();
  } catch (e) {
    console.warn('rate api failed:', e.message || e);
  }
}

// 頁面啟動時呼叫一次。立刻回值，同時背景抓 API。
export function initRate(baseFromJson) {
  _current = compose(baseFromJson);
  // 有 override → 不打 API（省流量、對他也無用）
  if (readOverride() == null) tryFetch(baseFromJson);

  // App 從背景回前景 & 網路恢復時再抓一次
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => tryFetch(baseFromJson));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && readOverride() == null) tryFetch(baseFromJson);
    });
  }
  return _current;
}

export function getRate() {
  if (!_current) _current = compose(null);
  return _current;
}

export function setOverride(rate, baseFromJson) {
  try { localStorage.setItem(LS_OVERRIDE, String(rate)); } catch {}
  _current = compose(baseFromJson);
  notify();
}
export function clearOverride(baseFromJson) {
  try { localStorage.removeItem(LS_OVERRIDE); } catch {}
  _current = compose(baseFromJson);
  notify();
  tryFetch(baseFromJson);
}

export function onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
export function formatFetchedAt(iso) { return iso ? hhmm(iso) : ''; }
