import { describe, expect, it } from "vitest";
import {
  ACCEPT,
  isThemeFile,
  MAX_BUNDLE_BYTES,
  MAX_SCRIPT_BYTES,
  mergeFiles,
  needsUnpacking,
  publishParam,
  unpackUpload,
  uploadKind,
  uploadProblem,
} from "./upload";
import { zipFile } from "../testing";

function file(name: string, content = "body{}", lastModified = 1) {
  return new File([content], name, { lastModified });
}

describe("uploadKind / uploadProblem", () => {
  it("herkent .css, .zip en .js (hoofdletterongevoelig)", () => {
    expect(uploadKind("proxmox.css")).toBe("css");
    expect(uploadKind("PROXMOX.CSS")).toBe("css");
    expect(uploadKind("proxmox.cssthema.zip")).toBe("bundle");
    expect(uploadKind("algemeen.js")).toBe("script");
    expect(uploadKind("Algemeen.JS")).toBe("script");
    expect(uploadKind("notes.txt")).toBe("unsupported");
    expect(uploadKind("algemeen.json")).toBe("unsupported");
    expect(uploadKind("css")).toBe("unsupported");
    expect(uploadKind("js")).toBe("unsupported");
  });

  it("alleen .css en bundels gaan naar de thema-import, .js naar de scripts", () => {
    expect(isThemeFile("proxmox.css")).toBe(true);
    expect(isThemeFile("nord.cssthema.zip")).toBe(true);
    expect(isThemeFile("algemeen.js")).toBe(false);
    expect(isThemeFile("notes.txt")).toBe(false);
  });

  it("de bestandskiezer laat ook .js toe", () => {
    expect(ACCEPT.split(",")).toEqual(expect.arrayContaining([".css", ".zip", ".js"]));
  });

  it("een script mag hoogstens 512 KB zijn", () => {
    expect(uploadProblem({ name: "a.js", size: MAX_SCRIPT_BYTES })).toBeNull();
    expect(uploadProblem({ name: "a.js", size: MAX_SCRIPT_BYTES + 1 })).toBe("scriptTooLarge");
    expect(uploadProblem({ name: "a.js", size: 0 })).toBe("empty");
  });

  it("meldt verkeerd type, leeg bestand en te grote bundel", () => {
    expect(uploadProblem({ name: "a.txt", size: 10 })).toBe("type");
    expect(uploadProblem({ name: "a.css", size: 0 })).toBe("empty");
    expect(uploadProblem({ name: "a.zip", size: MAX_BUNDLE_BYTES + 1 })).toBe("tooLarge");
    expect(uploadProblem({ name: "a.zip", size: MAX_BUNDLE_BYTES })).toBeNull();
    // De CSS-limiet kent alleen de server.
    expect(uploadProblem({ name: "a.css", size: MAX_BUNDLE_BYTES + 1 })).toBeNull();
  });
});

describe("publishParam", () => {
  it("auto laat de keuze aan de server", () => {
    expect(publishParam("auto")).toBeUndefined();
    expect(publishParam("yes")).toBe(true);
    expect(publishParam("no")).toBe(false);
  });
});

describe("mergeFiles", () => {
  it("voegt toe zonder dubbels (naam, grootte en datum)", () => {
    const a = file("a.css");
    const b = file("b.css");
    const sameAsA = file("a.css");
    const newerA = file("a.css", "body{}", 2);
    const merged = mergeFiles([a], [b, sameAsA, newerA, b]);
    expect(merged).toEqual([a, b, newerA]);
  });

  it("laat de bestaande lijst ongemoeid", () => {
    const current = [file("a.css")];
    mergeFiles(current, [file("b.css")]);
    expect(current).toHaveLength(1);
  });
});

describe("needsUnpacking / unpackUpload", () => {
  it("alleen een .zip die geen .cssthema.zip heet, wordt eerst bekeken", () => {
    expect(needsUnpacking("alg-themas.zip")).toBe(true);
    expect(needsUnpacking("ALG.ZIP")).toBe(true);
    expect(needsUnpacking("nord.cssthema.zip")).toBe(false);
    expect(needsUnpacking("NORD.CSSTHEMA.ZIP")).toBe(false);
    expect(needsUnpacking("a.css")).toBe(false);
  });

  it("losse bestanden: bestandsnaam zonder map, type en datum uit de zip", async () => {
    const zip = await zipFile("alg.zip", [
      { name: "a/b/alg-x.css", data: "x{}" },
      { name: "algemeen.JS", data: "1;" },
      { name: "notities.md", data: "n" },
      { name: "a/.verborgen.css", data: "y{}" },
    ]);
    const result = await unpackUpload(zip);
    if (result.kind !== "files") throw new Error(result.kind);
    expect(result.files.map((f) => [f.name, f.type, f.size])).toEqual([
      ["alg-x.css", "text/css", 3],
      ["algemeen.JS", "text/javascript", 2],
    ]);
    expect(await result.files[0]!.text()).toBe("x{}");
    expect(new Date(result.files[0]!.lastModified).getFullYear()).toBe(2026);
    expect(result.skipped).toEqual(["notities.md"]);
  });

  it("twee bestanden met dezelfde naam in verschillende mappen blijven allebei", async () => {
    const zip = await zipFile("t.zip", [
      { name: "licht/thema.css", data: "a{color:#111}" },
      { name: "donker/thema.css", data: "a{color:#eee}" },
    ]);
    const result = await unpackUpload(zip);
    if (result.kind !== "files") throw new Error(result.kind);
    expect(await Promise.all(result.files.map((f) => f.text()))).toEqual([
      "a{color:#111}",
      "a{color:#eee}",
    ]);
  });

  it("een bundel die in een map gezipt is, wordt niet opgesplitst", async () => {
    const zip = await zipFile("mijn-thema.zip", [
      { name: "mijn-thema/manifest.json", data: "{}" },
      { name: "mijn-thema/draft.css", data: "a{}" },
      { name: "mijn-thema/versions/v1.css", data: "a{}" },
    ]);
    expect(await unpackUpload(zip)).toEqual({
      kind: "error",
      code: "nestedBundle",
      entry: "mijn-thema/manifest.json",
    });
    // Een manifest.json zonder draft.css (bv. van een web-app) houdt het uitpakken niet tegen.
    const app = await zipFile("app.zip", [
      { name: "app/manifest.json", data: "{}" },
      { name: "app/stijl.css", data: "a{}" },
    ]);
    expect((await unpackUpload(app)).kind).toBe("files");
  });

  it("bundel, geen zip, leeg of te groot: blijft zoals het is", async () => {
    const bundle = await zipFile("b.zip", [{ name: "manifest.json", data: "{}" }]);
    expect(await unpackUpload(bundle)).toEqual({ kind: "keep" });
    expect(await unpackUpload(file("nep.zip", "geen zip"))).toEqual({ kind: "keep" });
    expect(await unpackUpload(file("leeg.zip", ""))).toEqual({ kind: "keep" });
    const big = new File([new Uint8Array(MAX_BUNDLE_BYTES + 1)], "groot.zip");
    expect(await unpackUpload(big)).toEqual({ kind: "keep" });
  });

  it("geen .css of .js: empty; fout in een bestand: error met de naam", async () => {
    const empty = await zipFile("e.zip", [{ name: "a.png", data: "p" }]);
    expect(await unpackUpload(empty)).toEqual({ kind: "empty", skipped: ["a.png"] });
    const locked = await zipFile("l.zip", [{ name: "a.css", data: "a{}", flags: 0x1 }]);
    expect(await unpackUpload(locked)).toEqual({
      kind: "error",
      code: "encrypted",
      entry: "a.css",
    });
  });
});
