// 極小的 JPEG EXIF 讀取器 ＋ 把拍攝時間對到行程
// 只解析 APP1 → IFD0 → ExifIFD 的 DateTimeOriginal（0x9003）與 OffsetTimeOriginal（0x9011）。
// HEIC／PNG 或讀不到就回 null。

const JST_OFFSET_MIN = 9 * 60;

// 回傳 { local: 'YYYY-MM-DDTHH:mm:ss', offset: '+09:00' | null } 或 null
export async function readExifDateTime(file) {
  let buf;
  try { buf = await file.slice(0, 256 * 1024).arrayBuffer(); } catch { return null; }
  const dv = new DataView(buf);
  if (dv.byteLength < 12 || dv.getUint16(0) !== 0xFFD8) return null;

  // 走 JPEG marker 找 APP1 "Exif\0\0"
  let p = 2;
  let tiff = -1;
  while (p + 4 <= dv.byteLength) {
    if (dv.getUint8(p) !== 0xFF) { p++; continue; }
    const marker = dv.getUint8(p + 1);
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; }
    if (marker === 0xDA || marker === 0xD9) break;           // 影像資料開始，不會再有 EXIF
    const len = dv.getUint16(p + 2);
    if (marker === 0xE1 && p + 10 <= dv.byteLength &&
        dv.getUint32(p + 4) === 0x45786966 && dv.getUint16(p + 8) === 0) {   // "Exif\0\0"
      tiff = p + 10;
      break;
    }
    p += 2 + len;
  }
  if (tiff < 0) return null;

  const bo = dv.getUint16(tiff);
  const le = bo === 0x4949;
  if (!le && bo !== 0x4D4D) return null;
  if (dv.getUint16(tiff + 2, le) !== 0x002A) return null;

  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  const inRange = (o, n = 1) => o >= 0 && o + n <= dv.byteLength;

  // 在一個 IFD 裡找 tag，回傳 entry 的 { type, count, valueOffset(絕對位置) }
  function findTag(ifdOffset, tag) {
    const base = tiff + ifdOffset;
    if (!inRange(base, 2)) return null;
    const n = u16(base);
    for (let i = 0; i < n; i++) {
      const e = base + 2 + i * 12;
      if (!inRange(e, 12)) return null;
      if (u16(e) === tag) {
        const type = u16(e + 2);
        const count = u32(e + 4);
        const size = count * (type === 2 || type === 1 ? 1 : type === 3 ? 2 : 4);
        const valueOffset = size <= 4 ? e + 8 : tiff + u32(e + 8);
        return { type, count, valueOffset };
      }
    }
    return null;
  }
  function readAscii(entry) {
    if (!entry || entry.type !== 2 || !inRange(entry.valueOffset, entry.count)) return null;
    let s = '';
    for (let i = 0; i < entry.count; i++) {
      const c = dv.getUint8(entry.valueOffset + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  const ifd0 = u32(tiff + 4);
  const exifPtr = findTag(ifd0, 0x8769);
  if (!exifPtr) return null;
  const exifIfd = u32(exifPtr.valueOffset);

  const dt = readAscii(findTag(exifIfd, 0x9003));
  const m = dt && /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(dt);
  if (!m) return null;
  const off = readAscii(findTag(exifIfd, 0x9011));
  const offset = off && /^[+-]\d{2}:\d{2}$/.test(off) ? off : null;
  return { local: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, offset };
}

// 取得 takenAt（ISO 字串）：EXIF（沒時區當日本時間）→ lastModified → 現在
export async function getTakenAt(file) {
  try {
    const ex = await readExifDateTime(file);
    if (ex) return `${ex.local}${ex.offset || '+09:00'}`;
  } catch { /* 讀不到就往下 */ }
  if (file && file.lastModified) return new Date(file.lastModified).toISOString();
  return new Date().toISOString();
}

// ISO 字串 → 日本時間的 { date: 'YYYY-MM-DD', hhmm: 'HH:MM', mmdd: 'MM/DD', weekday: 0–6 }
export function jstParts(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + JST_OFFSET_MIN * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return {
    date,
    hhmm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    mmdd: `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`,
    weekday: d.getUTCDay(),
  };
}

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 對到行程：{ day: 1–6 | null, spotId: string | null }
export function matchItinerary(takenAt, days, spots) {
  const p = jstParts(takenAt);
  if (!p) return { day: null, spotId: null };
  const dayObj = (days || []).find(d => d.date === p.date);
  if (!dayObj) return { day: null, spotId: null };

  const known = new Set((spots || []).map(s => s.id));
  const items = (dayObj.items || []).filter(it => it.time && it.spotId && (!spots || known.has(it.spotId)));
  const t = toMin(p.hhmm);

  // 1) 剛好落在 time ≤ t < endTime
  const inside = items.find(it => it.endTime && toMin(it.time) <= t && t < toMin(it.endTime));
  if (inside) return { day: dayObj.n, spotId: inside.spotId };

  // 2) 拍攝時間之前最近的一個有 spotId 的項目
  let best = null;
  for (const it of items) {
    if (toMin(it.time) <= t && (!best || toMin(it.time) >= toMin(best.time))) best = it;
  }
  return { day: dayObj.n, spotId: best ? best.spotId : null };
}
