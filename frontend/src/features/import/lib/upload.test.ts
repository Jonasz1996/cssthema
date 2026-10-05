import { describe, expect, it } from "vitest";
import { MAX_BUNDLE_BYTES, mergeFiles, publishParam, uploadKind, uploadProblem } from "./upload";

function file(name: string, content = "body{}", lastModified = 1) {
  return new File([content], name, { lastModified });
}

describe("uploadKind / uploadProblem", () => {
  it("herkent .css en .zip (hoofdletterongevoelig)", () => {
    expect(uploadKind("proxmox.css")).toBe("css");
    expect(uploadKind("PROXMOX.CSS")).toBe("css");
    expect(uploadKind("proxmox.cssthema.zip")).toBe("bundle");
    expect(uploadKind("notes.txt")).toBe("unsupported");
    expect(uploadKind("css")).toBe("unsupported");
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
