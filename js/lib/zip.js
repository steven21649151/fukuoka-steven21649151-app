// 極小 ZIP 寫入器：只用 store（method 0，不壓縮），因為主要是 JPEG，本身已壓過。
// 規範：PKWARE APPNOTE 4.5+；輸出 Blob {type:'application/zip'}。
//
// 用法：
//   const zip = createZip();
//   zip.addFile('手帳/foo.jpg', blob);          // Blob 或 Uint8Array
//   zip.addString('手帳.csv', '﻿日期,...\n');   // 字串（會自動 UTF-8 編碼）
//   const out = await zip.build();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function toU8(input) {
  if (input instanceof Uint8Array) return input;
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new Error('unsupported zip input');
}

export function createZip() {
  const entries = []; // { nameU8, data, crc, size, time, date, offset(填在 build) }
  const pending = []; // add() 產生的 promise，build() 前要 flush 完

  function add(name, data) {
    const p = (async () => {
      const nameU8 = new TextEncoder().encode(name);
      const u8 = await toU8(data);
      const { time, date } = dosDateTime();
      entries.push({ nameU8, data: u8, crc: crc32(u8), size: u8.length, time, date });
    })();
    pending.push(p);
    return p;
  }

  return {
    addFile: (name, data) => add(name, data),
    addString: (name, str) => add(name, str),
    async build() {
      await Promise.all(pending);
      // 先寫 local file headers + data，記錄每筆 offset
      const localParts = [];
      let offset = 0;
      for (const e of entries) {
        e.offset = offset;
        const header = new ArrayBuffer(30);
        const dv = new DataView(header);
        dv.setUint32(0,  0x04034b50, true);          // local file header signature
        dv.setUint16(4,  20, true);                  // version needed: 2.0
        dv.setUint16(6,  0x0800, true);              // general purpose bit flag: UTF-8 filename
        dv.setUint16(8,  0, true);                   // compression: store
        dv.setUint16(10, e.time, true);
        dv.setUint16(12, e.date, true);
        dv.setUint32(14, e.crc, true);
        dv.setUint32(18, e.size, true);              // compressed size
        dv.setUint32(22, e.size, true);              // uncompressed size
        dv.setUint16(26, e.nameU8.length, true);
        dv.setUint16(28, 0, true);                   // extra field length
        localParts.push(new Uint8Array(header), e.nameU8, e.data);
        offset += 30 + e.nameU8.length + e.size;
      }
      const cdStart = offset;

      // Central directory
      const cdParts = [];
      let cdSize = 0;
      for (const e of entries) {
        const hdr = new ArrayBuffer(46);
        const dv = new DataView(hdr);
        dv.setUint32(0,  0x02014b50, true);          // central file header signature
        dv.setUint16(4,  20, true);                  // version made by
        dv.setUint16(6,  20, true);                  // version needed
        dv.setUint16(8,  0x0800, true);              // flags: UTF-8
        dv.setUint16(10, 0, true);                   // compression
        dv.setUint16(12, e.time, true);
        dv.setUint16(14, e.date, true);
        dv.setUint32(16, e.crc, true);
        dv.setUint32(20, e.size, true);
        dv.setUint32(24, e.size, true);
        dv.setUint16(28, e.nameU8.length, true);
        dv.setUint16(30, 0, true);                   // extra
        dv.setUint16(32, 0, true);                   // comment
        dv.setUint16(34, 0, true);                   // disk number start
        dv.setUint16(36, 0, true);                   // internal attrs
        dv.setUint32(38, 0, true);                   // external attrs
        dv.setUint32(42, e.offset, true);            // relative offset of local header
        cdParts.push(new Uint8Array(hdr), e.nameU8);
        cdSize += 46 + e.nameU8.length;
      }

      // End of central directory record
      const eocd = new ArrayBuffer(22);
      const dv = new DataView(eocd);
      dv.setUint32(0,  0x06054b50, true);
      dv.setUint16(4,  0, true);   // disk number
      dv.setUint16(6,  0, true);   // start disk
      dv.setUint16(8,  entries.length, true);
      dv.setUint16(10, entries.length, true);
      dv.setUint32(12, cdSize, true);
      dv.setUint32(16, cdStart, true);
      dv.setUint16(20, 0, true);   // comment length

      return new Blob([...localParts, ...cdParts, new Uint8Array(eocd)], { type: 'application/zip' });
    },
  };
}
