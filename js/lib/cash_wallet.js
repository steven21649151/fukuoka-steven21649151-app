// 現金錢包：帶出門的日幣現金 ＋ 之後補的現金 − 付現金的支出
// 只存在這支手機的 localStorage['ledger.cashWallet']（{ start, topups:[{id,date,jpy}] }）；
// 讀寫都包 try/catch，壞掉就當作還沒設定，不影響記帳。

const KEY = 'ledger.cashWallet';
export const LOW_CASH_YEN = 3000;

export function loadWallet() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { start: null, topups: [] };
    const start = Number.isFinite(raw.start) && raw.start >= 0 ? raw.start : null;
    const topups = Array.isArray(raw.topups)
      ? raw.topups.filter(t => t && Number.isFinite(t.jpy) && t.jpy > 0)
          .map(t => ({ id: String(t.id || ''), date: String(t.date || ''), jpy: t.jpy }))
      : [];
    return { start, topups };
  } catch { return { start: null, topups: [] }; }
}

export function saveWallet(w) {
  try { localStorage.setItem(KEY, JSON.stringify({ start: w.start, topups: w.topups })); return true; }
  catch { return false; }
}

export const isConfigured = (w) => w.start != null;

// 付現金的支出合計（pay === 'cash'；舊記錄沒有 pay，不算）
export const cashSpent = (rows) => (rows || []).filter(r => r && r.pay === 'cash').reduce((s, r) => s + (Number(r.jpy) || 0), 0);

// 剩多少（還沒設定 → null）
export function walletBalance(w, rows) {
  if (!isConfigured(w)) return null;
  return w.start + w.topups.reduce((s, t) => s + t.jpy, 0) - cashSpent(rows);
}
