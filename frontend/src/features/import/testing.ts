import { crc32 } from "./lib/zip";

/** Testhulp: een zip-bestand in het geheugen bouwen (stored of deflate). */

export interface ZipSpec {
  name: string;
  data?: string | Uint8Array;
  /** 0 = stored, 8 = deflate (standaard). */
  method?: 0 | 8;
  /** Extra vlaggen (bv. 0x1 = versleuteld). */
  flags?: number;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  }).pipeThrough(new CompressionStream("deflate-raw"));
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concat(chunks);
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function header(size: number, fill: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

/** 2026-10-06 12:00:00 in DOS-formaat. */
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 6;
const DOS_TIME = 12 << 11;

export async function makeZip(
  specs: readonly ZipSpec[],
  { comment = "" }: { comment?: string } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const spec of specs) {
    const name = encoder.encode(spec.name);
    const raw =
      typeof spec.data === "string" ? encoder.encode(spec.data) : (spec.data ?? new Uint8Array());
    const method = spec.method ?? 8;
    const packed = method === 8 ? await deflateRaw(raw) : raw;
    const crc = crc32(raw);
    const flags = 0x800 | (spec.flags ?? 0);
    const local = header(30, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, flags, true);
      view.setUint16(8, method, true);
      view.setUint16(10, DOS_TIME, true);
      view.setUint16(12, DOS_DATE, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, packed.length, true);
      view.setUint32(22, raw.length, true);
      view.setUint16(26, name.length, true);
    });
    const central = header(46, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, flags, true);
      view.setUint16(10, method, true);
      view.setUint16(12, DOS_TIME, true);
      view.setUint16(14, DOS_DATE, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, packed.length, true);
      view.setUint32(24, raw.length, true);
      view.setUint16(28, name.length, true);
      view.setUint32(42, offset, true);
    });
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = concat(centrals);
  const note = encoder.encode(comment);
  const end = header(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, specs.length, true);
    view.setUint16(10, specs.length, true);
    view.setUint32(12, directory.length, true);
    view.setUint32(16, offset, true);
    view.setUint16(20, note.length, true);
  });
  return concat([...locals, directory, end, note]);
}

export async function zipFile(name: string, specs: readonly ZipSpec[]): Promise<File> {
  return new File([await makeZip(specs)], name, { lastModified: 1 });
}
