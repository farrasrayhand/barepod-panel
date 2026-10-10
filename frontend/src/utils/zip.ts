// Minimal store-only (no compression) ZIP writer.
// Used for File Manager batch download so users get a single .zip archive,
// mirroring the real backend behavior (tar/zip export from the daemon).

export interface ZipEntry {
  name: string;
  content: string | Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pushU16 = (arr: number[], value: number) => {
  arr.push(value & 0xff, (value >>> 8) & 0xff);
};

const pushU32 = (arr: number[], value: number) => {
  arr.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
};

export const createZip = (entries: ZipEntry[]): Blob => {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const data = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const crc = crc32(data);
    const size = data.length;

    const local: number[] = [];
    pushU32(local, 0x04034b50);
    pushU16(local, 20); // version needed to extract
    pushU16(local, 0); // general purpose flags
    pushU16(local, 0); // compression method: store
    pushU16(local, 0); // last mod time
    pushU16(local, 0); // last mod date
    pushU32(local, crc);
    pushU32(local, size); // compressed size
    pushU32(local, size); // uncompressed size
    pushU16(local, nameBytes.length);
    pushU16(local, 0); // extra field length
    const localHeader = new Uint8Array(local);

    chunks.push(localHeader, nameBytes, data);

    const record: number[] = [];
    pushU32(record, 0x02014b50);
    pushU16(record, 20); // version made by
    pushU16(record, 20); // version needed to extract
    pushU16(record, 0); // flags
    pushU16(record, 0); // method: store
    pushU16(record, 0); // time
    pushU16(record, 0); // date
    pushU32(record, crc);
    pushU32(record, size);
    pushU32(record, size);
    pushU16(record, nameBytes.length);
    pushU16(record, 0); // extra length
    pushU16(record, 0); // comment length
    pushU16(record, 0); // disk number start
    pushU16(record, 0); // internal attributes
    pushU32(record, 0); // external attributes
    pushU32(record, offset); // relative offset of local header
    central.push(new Uint8Array(record), nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  });

  const centralStart = offset;
  let centralSize = 0;
  central.forEach((chunk) => {
    chunks.push(chunk);
    centralSize += chunk.length;
  });

  const end: number[] = [];
  pushU32(end, 0x06054b50);
  pushU16(end, 0); // disk number
  pushU16(end, 0); // disk with central directory
  pushU16(end, entries.length);
  pushU16(end, entries.length);
  pushU32(end, centralSize);
  pushU32(end, centralStart);
  pushU16(end, 0); // comment length
  chunks.push(new Uint8Array(end));

  return new Blob(chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer), { type: 'application/zip' });
};
