import { describe, expect, it } from "vitest";
import { makeZip } from "../testing";
import { crc32, openZip, ZIP_LIMITS, ZipError } from "./zip";

const text = (data: Uint8Array) => new TextDecoder().decode(data);

async function codeOf(promise: Promise<unknown> | (() => unknown)): Promise<string | undefined> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    if (error instanceof ZipError) return error.code;
    throw error;
  }
  return undefined;
}

describe("crc32", () => {
  it("geeft de standaardwaarde", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("openZip", () => {
  it("leest stored en deflate, met mappen en datum", async () => {
    const zip = await makeZip([
      { name: "map/", data: "" },
      { name: "map/a.css", data: "body { color: red; }", method: 0 },
      { name: "b.js", data: "console.log(1);".repeat(50) },
    ]);
    const archive = openZip(zip.buffer);
    expect(archive.entries.map((entry) => [entry.name, entry.directory])).toEqual([
      ["map/", true],
      ["map/a.css", false],
      ["b.js", false],
    ]);
    const [, a, b] = archive.entries;
    expect(text(await archive.read(a!))).toBe("body { color: red; }");
    expect(text(await archive.read(b!))).toBe("console.log(1);".repeat(50));
    expect(new Date(a!.lastModified).getFullYear()).toBe(2026);
    expect(b!.compressedSize).toBeLessThan(b!.size);
  });

  it("vindt het einde ook met commentaar achteraan", async () => {
    const zip = await makeZip([{ name: "a.css", data: "a{}" }], { comment: "PK\u0005\u0006 nep" });
    const archive = openZip(zip.buffer);
    expect(text(await archive.read(archive.entries[0]!))).toBe("a{}");
  });

  it("geen zip: notZip", async () => {
    expect(await codeOf(() => openZip(new TextEncoder().encode("PK").buffer))).toBe("notZip");
    expect(await codeOf(() => openZip(new ArrayBuffer(0)))).toBe("notZip");
  });

  it("te veel bestanden", async () => {
    const zip = await makeZip([
      { name: "a.css", data: "a{}" },
      { name: "b.css", data: "b{}" },
    ]);
    expect(await codeOf(() => openZip(zip.buffer, { ...ZIP_LIMITS, maxEntries: 1 }))).toBe(
      "tooManyEntries",
    );
  });

  it("versleuteld bestand: pas een fout bij het lezen", async () => {
    const zip = await makeZip([
      { name: "geheim.txt", data: "x", flags: 0x1 },
      { name: "a.css", data: "a{}" },
    ]);
    const archive = openZip(zip.buffer);
    expect(await codeOf(archive.read(archive.entries[0]!))).toBe("encrypted");
    expect(text(await archive.read(archive.entries[1]!))).toBe("a{}");
  });

  it("te groot per bestand en in totaal", async () => {
    const zip = await makeZip([
      { name: "a.css", data: "a".repeat(100) },
      { name: "b.css", data: "b".repeat(100) },
    ]);
    const perEntry = openZip(zip.buffer, { ...ZIP_LIMITS, maxEntryBytes: 99 });
    expect(await codeOf(perEntry.read(perEntry.entries[0]!))).toBe("tooLarge");
    const total = openZip(zip.buffer, { ...ZIP_LIMITS, maxTotalBytes: 150 });
    await total.read(total.entries[0]!);
    expect(await codeOf(total.read(total.entries[1]!))).toBe("tooLarge");
  });

  it("beschadigde inhoud of verkeerde CRC: corrupt", async () => {
    const zip = await makeZip([{ name: "a.css", data: "body { color: red; }", method: 0 }]);
    // Eén byte van de inhoud wijzigen (na de lokale kop van 30 + 5 bytes naam).
    zip[35] = zip[35]! ^ 0xff;
    const archive = openZip(zip.buffer);
    expect(await codeOf(archive.read(archive.entries[0]!))).toBe("corrupt");
  });

  it("afgebroken deflate-stroom: corrupt", async () => {
    const zip = await makeZip([{ name: "a.css", data: "x".repeat(5000) }]);
    const archive = openZip(zip.buffer);
    const entry = archive.entries[0]!;
    // De gecomprimeerde inhoud overschrijven met rommel.
    zip.fill(0xff, 35, 35 + entry.compressedSize);
    expect(await codeOf(archive.read(entry))).toBe("corrupt");
  });

  it("onbekende compressiemethode", async () => {
    const zip = await makeZip([{ name: "a.css", data: "a{}", method: 0 }]);
    const view = new DataView(zip.buffer);
    // Methode 12 (bzip2) in de centrale map: na de lokale kop (30 + 5 + 3 bytes).
    view.setUint16(38 + 10, 12, true);
    const archive = openZip(zip.buffer);
    expect(await codeOf(archive.read(archive.entries[0]!))).toBe("method");
  });

  it("ZIP64-markering wordt geweigerd", async () => {
    const zip = await makeZip([{ name: "a.css", data: "a{}", method: 0 }]);
    const view = new DataView(zip.buffer);
    view.setUint32(38 + 24, 0xffffffff, true);
    expect(await codeOf(() => openZip(zip.buffer))).toBe("zip64");
  });

  it("centrale map buiten het bestand: corrupt", async () => {
    const zip = await makeZip([{ name: "a.css", data: "a{}", method: 0 }]);
    const view = new DataView(zip.buffer);
    const eocd = zip.length - 22;
    view.setUint32(eocd + 16, 10_000, true);
    expect(await codeOf(() => openZip(zip.buffer))).toBe("corrupt");
  });
});
