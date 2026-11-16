// Minimal Visual FoxPro / dBASE table reader (no dependency) for offline tools.
// Reads only character (C), numeric (N, F), logical (L), date (D) and integer
// (I) fields; memo (M), general (G), datetime (T), currency (Y), double (B)
// and binary fields are skipped (their values are never read). Deleted
// records ("*" flag) are skipped. Text is decoded as Windows-1252.
//
// Header layout (dBASE / VFP): byte 0 version (0x30 = VFP), uint32 LE at 4 =
// record count, uint16 LE at 8 = header length, uint16 LE at 10 = record
// length, field descriptors of 32 bytes from offset 32 until 0x0D: name (11
// bytes, NUL-padded), type (1 byte), displacement (uint32 LE, VFP), length,
// decimal count.
const READABLE = new Set(['C', 'N', 'F', 'L', 'D', 'I']);
const cp1252 = new TextDecoder('windows-1252');

export function parseDbfHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0];
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const fields = [];
  let offset = 1; // byte 0 of a record is the deletion flag
  for (let p = 32; p + 32 <= headerLength && bytes[p] !== 0x0d; p += 32) {
    const nameBytes = bytes.subarray(p, p + 11);
    const end = nameBytes.indexOf(0);
    const name = cp1252.decode(end >= 0 ? nameBytes.subarray(0, end) : nameBytes).trim().toUpperCase();
    const type = String.fromCharCode(bytes[p + 11]);
    const length = bytes[p + 16];
    const decimals = bytes[p + 17];
    fields.push({ name, type, length, decimals, offset });
    offset += length;
  }
  if (offset !== recordLength) throw new Error(`Field lengths (${offset}) do not match the record length (${recordLength}).`);
  return { version, recordCount, headerLength, recordLength, fields };
}

function readValue(bytes, field, view) {
  const raw = bytes.subarray(field.offset, field.offset + field.length);
  switch (field.type) {
    case 'C': return cp1252.decode(raw).replace(/\0+$/, '').trimEnd();
    case 'N':
    case 'F': {
      const text = cp1252.decode(raw).trim();
      if (!text || /^\*+$/.test(text)) return null;
      const value = Number(text);
      return Number.isFinite(value) ? value : null;
    }
    case 'L': {
      const c = String.fromCharCode(raw[0]).toUpperCase();
      return c === 'T' || c === 'Y' ? true : c === 'F' || c === 'N' ? false : null;
    }
    case 'D': {
      const text = cp1252.decode(raw).trim();
      return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : null;
    }
    case 'I': return view.getInt32(field.offset, true);
    default: return undefined;
  }
}

/**
 * Iterates the records of a table as plain objects with only the requested
 * readable fields (`fieldNames`, upper case). Never returns memo contents.
 */
export function* readDbfRecords(bytes, fieldNames) {
  const header = parseDbfHeader(bytes);
  const wanted = header.fields.filter((f) => fieldNames.includes(f.name));
  for (const f of wanted) if (!READABLE.has(f.type)) throw new Error(`Field ${f.name} has unsupported type ${f.type}.`);
  for (let i = 0; i < header.recordCount; i++) {
    const start = header.headerLength + i * header.recordLength;
    if (start + header.recordLength > bytes.length) break;
    const record = bytes.subarray(start, start + header.recordLength);
    if (record[0] === 0x2a) continue; // deleted
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
    const out = {};
    for (const f of wanted) out[f.name] = readValue(record, f, view);
    yield out;
  }
}
