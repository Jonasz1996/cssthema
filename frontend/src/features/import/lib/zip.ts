/**
 * Kleine zip-lezer voor de browser: centrale map, "stored" (0) en "deflate" (8) via
 * `DecompressionStream("deflate-raw")`. Genoeg om een zip met losse `.css`/`.js`-bestanden uit
 * te pakken vóór het uploaden; de server controleert elk bestand daarna opnieuw. Geen ZIP64,
 * geen versleuteling. Harde limieten tegen zip-bommen in het tabblad.
 */

export type ZipErrorCode =
  | "notZip"
  | "tooManyEntries"
  | "encrypted"
  | "zip64"
  | "method"
  | "tooLarge"
  | "corrupt"
  | "unsupported";

export class ZipError extends Error {
  constructor(
    readonly code: ZipErrorCode,
    readonly entry?: string,
  ) {
    super(entry ? `${code}: ${entry}` : code);
    this.name = "ZipError";
  }
}

export interface ZipEntry {
  /** Volledig pad in de zip, met `/` als scheiding. */
  name: string;
  directory: boolean;
  compressedSize: number;
  size: number;
  /** Wijzigingsdatum uit de zip (lokale tijd), in ms. */
  lastModified: number;
}

export interface ZipLimits {
  maxEntries: number;
  /** Per bestand, uitgepakt. */
  maxEntryBytes: number;
  /** Alle gelezen bestanden samen, uitgepakt. */
  maxTotalBytes: number;
}

export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxEntryBytes: 25 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

interface RawEntry extends ZipEntry {
  method: number;
  encrypted: boolean;
  crc: number;
  localOffset: number;
}

export interface ZipArchive {
  entries: readonly ZipEntry[];
  /** Pakt één bestand uit (controleert grootte en CRC-32). */
  read(entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>>;
}

export function openZip(buffer: ArrayBuffer, limits: ZipLimits = ZIP_LIMITS): ZipArchive {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new ZipError("notZip");

  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ZipError("zip64");
  }
  if (disk !== 0 || centralDisk !== 0) throw new ZipError("unsupported");
  if (count > limits.maxEntries) throw new ZipError("tooManyEntries");
  if (centralOffset + centralSize > eocd) throw new ZipError("corrupt");

  const entries: RawEntry[] = [];
  let pos = centralOffset;
  for (let index = 0; index < count; index++) {
    if (pos + 46 > eocd || view.getUint32(pos, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError("corrupt");
    }
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const time = view.getUint16(pos + 12, true);
    const date = view.getUint16(pos + 14, true);
    const crc = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const end = pos + 46 + nameLength + extraLength + commentLength;
    if (end > eocd) throw new ZipError("corrupt");
    const name = decodeName(bytes.subarray(pos + 46, pos + 46 + nameLength), (flags & 0x800) !== 0);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError("zip64", name);
    }
    entries.push({
      name,
      directory: name.endsWith("/"),
      compressedSize,
      size,
      lastModified: dosTime(date, time),
      method,
      // Bit 0: pas een fout bij het lezen, zodat een versleuteld bestand dat we niet nodig
      // hebben (bv. een README) de rest niet tegenhoudt.
      encrypted: (flags & 0x1) !== 0,
      crc,
      localOffset,
    });
    pos = end;
  }

  let total = 0;
  const read = async (entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> => {
    const raw = entries.find((item) => item === entry);
    if (!raw) throw new ZipError("corrupt", entry.name);
    if (raw.encrypted) throw new ZipError("encrypted", raw.name);
    if (raw.size > limits.maxEntryBytes || total + raw.size > limits.maxTotalBytes) {
      throw new ZipError("tooLarge", raw.name);
    }
    const local = raw.localOffset;
    if (local + 30 > centralOffset || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
      throw new ZipError("corrupt", raw.name);
    }
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + raw.compressedSize > centralOffset) throw new ZipError("corrupt", raw.name);
    const packed = bytes.subarray(start, start + raw.compressedSize);

    let data: Uint8Array<ArrayBuffer>;
    if (raw.method === 0) {
      if (raw.compressedSize !== raw.size) throw new ZipError("corrupt", raw.name);
      data = packed.slice();
    } else if (raw.method === 8) {
      data = await inflateRaw(packed, raw.size, raw.name);
    } else {
      throw new ZipError("method", raw.name);
    }
    if (data.length !== raw.size || crc32(data) !== raw.crc)
      throw new ZipError("corrupt", raw.name);
    total += data.length;
    return data;
  };

  return { entries, read };
}

/** Zoekt het einde van de centrale map van achter naar voor (er kan commentaar na staan). */
function findEndOfCentralDirectory(view: DataView): number {
  const last = view.byteLength - EOCD_SIZE;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let pos = last; pos >= first; pos--) {
    if (
      view.getUint32(pos, true) === EOCD_SIGNATURE &&
      pos + EOCD_SIZE + view.getUint16(pos + 20, true) === view.byteLength
    ) {
      return pos;
    }
  }
  return -1;
}

function decodeName(raw: Uint8Array, utf8: boolean): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    // Zonder UTF-8-vlag is het de OEM-codepagina van de maker; windows-1252 benadert dat.
    return new TextDecoder(utf8 ? "utf-8" : "windows-1252").decode(raw);
  }
}

function dosTime(date: number, time: number): number {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = Math.max(1, (date >> 5) & 0x0f) - 1;
  const day = Math.max(1, date & 0x1f);
  const stamp = new Date(
    year,
    month,
    day,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  ).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

async function inflateRaw(
  packed: Uint8Array<ArrayBuffer>,
  expected: number,
  name: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream === "undefined") throw new ZipError("unsupported", name);
  let stream: ReadableStream<Uint8Array<ArrayBuffer>>;
  try {
    stream = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(packed);
        controller.close();
      },
    }).pipeThrough(new DecompressionStream("deflate-raw"));
  } catch {
    throw new ZipError("unsupported", name);
  }
  const reader = stream.getReader();
  const out = new Uint8Array(expected);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > expected) {
        await reader.cancel().catch(() => undefined);
        throw new ZipError("corrupt", name);
      }
      out.set(value, length);
      length += value.length;
    }
  } catch (error) {
    if (error instanceof ZipError) throw error;
    throw new ZipError("corrupt", name);
  }
  if (length !== expected) throw new ZipError("corrupt", name);
  return out;
}

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
