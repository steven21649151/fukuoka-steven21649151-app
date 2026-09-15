// IndexedDB 極小 Promise 包裝
// db: fukuoka
//   v1: 建 ledger（keyPath id, index byDate）
//   v2: 新增 journal（keyPath id, index byDay + bySpot）——不動 ledger
//   v3: 新增 tickets（keyPath id, index byDay）——不動 ledger/journal
//
// 隱私模式或 iOS 極端情況下開不了 db，try/catch 到 open()。
// 上層 view 用 isAvailable() 檢查，開不了就顯示替代訊息。

const DB_NAME = 'fukuoka';
const DB_VER  = 3;
let _dbPromise = null;
let _lastError = null;

function open() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no-idb')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      // v0 → v1：建 ledger（新使用者第一次開）
      if (ev.oldVersion < 1) {
        const s = db.createObjectStore('ledger', { keyPath: 'id' });
        s.createIndex('byDate', 'date', { unique: false });
      }
      // v1 → v2：只新增 journal，不動 ledger
      if (ev.oldVersion < 2) {
        if (!db.objectStoreNames.contains('journal')) {
          const j = db.createObjectStore('journal', { keyPath: 'id' });
          j.createIndex('byDay',  'day',    { unique: false });
          j.createIndex('bySpot', 'spotId', { unique: false });
        }
      }
      // v2 → v3：只新增 tickets，不動 ledger/journal
      if (ev.oldVersion < 3) {
        if (!db.objectStoreNames.contains('tickets')) {
          const tk = db.createObjectStore('tickets', { keyPath: 'id' });
          tk.createIndex('byDay',    'dayN',   { unique: false });
          tk.createIndex('byItem',   'itemId', { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('open-failed'));
    req.onblocked = () => reject(new Error('open-blocked'));
  }).catch(err => {
    _lastError = err;
    _dbPromise = null;
    throw err;
  });
  return _dbPromise;
}

export async function isAvailable() {
  try { await open(); return true; }
  catch { return false; }
}
export function lastError() { return _lastError; }

function tx(storeName, mode = 'readonly') {
  return open().then(db => {
    const t = db.transaction(storeName, mode);
    return { store: t.objectStore(storeName), done: new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('aborted'));
    }) };
  });
}

function req2promise(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function putLedger(row) {
  const { store, done } = await tx('ledger', 'readwrite');
  store.put(row);
  await done;
  return row;
}

export async function deleteLedger(id) {
  const { store, done } = await tx('ledger', 'readwrite');
  store.delete(id);
  await done;
}

export async function getAllLedger() {
  const { store, done } = await tx('ledger', 'readonly');
  const rows = await req2promise(store.getAll());
  await done;
  return rows;
}

export async function getLedger(id) {
  const { store, done } = await tx('ledger', 'readonly');
  const row = await req2promise(store.get(id));
  await done;
  return row;
}

// ================= journal =================

export async function putJournal(row) {
  const { store, done } = await tx('journal', 'readwrite');
  store.put(row);
  await done;
  return row;
}

export async function deleteJournal(id) {
  const { store, done } = await tx('journal', 'readwrite');
  store.delete(id);
  await done;
}

export async function getAllJournal() {
  const { store, done } = await tx('journal', 'readonly');
  const rows = await req2promise(store.getAll());
  await done;
  return rows;
}

export async function getJournal(id) {
  const { store, done } = await tx('journal', 'readonly');
  const row = await req2promise(store.get(id));
  await done;
  return row;
}

// 計算某景點目前有幾張手帳（拍照命名流水號用）
export async function countJournalBySpot(spotId) {
  const { store, done } = await tx('journal', 'readonly');
  const idx = store.index('bySpot');
  const n = await req2promise(idx.count(IDBKeyRange.only(spotId)));
  await done;
  return n;
}

// ================= tickets =================

export async function putTicket(row) {
  const { store, done } = await tx('tickets', 'readwrite');
  store.put(row);
  await done;
  return row;
}
export async function deleteTicket(id) {
  const { store, done } = await tx('tickets', 'readwrite');
  store.delete(id);
  await done;
}
export async function getAllTickets() {
  const { store, done } = await tx('tickets', 'readonly');
  const rows = await req2promise(store.getAll());
  await done;
  return rows;
}
export async function getTicket(id) {
  const { store, done } = await tx('tickets', 'readonly');
  const row = await req2promise(store.get(id));
  await done;
  return row;
}
// 拿到「哪些 itemId 有票」的 Set——行程頁渲染卡片時查 🎫 圖示要不要顯示
// index.getAllKeys() 回的是「符合索引的主鍵」不是「索引值本身」，所以走 getAll() 撈 itemId
export async function ticketedItemIds() {
  const { store, done } = await tx('tickets', 'readonly');
  const rows = await req2promise(store.getAll());
  await done;
  return new Set(rows.map(r => r.itemId).filter(Boolean));
}
