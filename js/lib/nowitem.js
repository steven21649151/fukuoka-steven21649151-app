// 算「現在正在進行的那一格」——行程頁與記帳頁共用
// 只在旅行期間有效；不在期間內回全 null

const TRIP_START = '2026-10-25';
const TRIP_END   = '2026-10-30';

export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// day: days.json 的一天；todayStr: 今天 ISO（可自帶，測試用）
export function computeNowInDay(day, todayStr = todayISO()) {
  if (!day || todayStr !== day.date) return { nowId: null, nextId: null, highlightId: null };
  if (todayStr < TRIP_START || todayStr > TRIP_END) return { nowId: null, nextId: null, highlightId: null };

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const items = (day.items || []).filter(it => it.time);
  const spans = items.map((it, i) => {
    const start = toMin(it.time);
    let end = it.endTime ? toMin(it.endTime) : null;
    if (end == null) {
      const next = items[i + 1];
      end = next ? toMin(next.time) : Math.min(24 * 60 - 1, start + 60);
    }
    return { it, start, end };
  });

  const cur = spans.find(s => s.start <= nowMin && nowMin < s.end);
  if (cur) return { nowId: cur.it.id, nextId: null, highlightId: cur.it.id };

  const next = spans.find(s => s.start > nowMin);
  if (next) return { nowId: null, nextId: next.it.id, highlightId: next.it.id };

  return { nowId: null, nextId: null, highlightId: null };
}

// 找「當下所在的天 + 該天當下的 item」——記帳頁預設關聯用
// 回 { day, item, todayStr }；不在旅行期間回 { day: null, item: null }
export function findNowContext(days) {
  const t = todayISO();
  const day = (days || []).find(d => d.date === t);
  if (!day) return { day: null, item: null, todayStr: t };
  const { nowId } = computeNowInDay(day, t);
  const item = nowId ? day.items.find(it => it.id === nowId) : null;
  return { day, item, todayStr: t };
}

export { TRIP_START, TRIP_END };
