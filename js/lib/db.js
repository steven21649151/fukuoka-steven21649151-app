// IndexedDB 極小 Promise 包裝——只給 ledger 用
// db: fukuoka  version: 1
// store: ledger  keyPath: id  index: byDate on 'date'
//
// 隱私模式或 iOS 極端情況下開不了 db，try/catch 到 open()。
// 上層 view 用 isAvailable() 檢查，開不了就顯示替代訊息。

const DB_NAME = 'fukuoka';
const DB_VER  = 1;
let _dbPromise = null;
let _lastError = null;

function open() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no-idb')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('ledger')) {
        const s = db.createObjectStore('ledger', { keyPath: 'id' });
        s.createIndex('byDate', 'date', { unique: false });
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
