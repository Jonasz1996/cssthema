import { describe, expect, it } from "vitest";
import { slugOfFile, uploadDefaults } from "./upload-defaults";

const file = (name: string) => new File(["x"], name, { lastModified: 1 });

describe("uploadDefaults", () => {
  const zipped = new Set<File>();
  const unpacked = (item: File) => zipped.has(item);

  it("the server's slug of a file name", () => {
    expect(slugOfFile("Alg Kern.CSS")).toBe("alg-kern");
    expect(slugOfFile("alg-fw-adminlte.css")).toBe("alg-fw-adminlte");
  });

  it("new version and publish when every .css file exists or came from a zip", () => {
    const slugs = new Set(["alg-kern", "algemeen"]);
    expect(
      uploadDefaults([file("alg-kern.css"), file("algemeen.css")], { unpacked, slugs }),
    ).toEqual({ conflict: "new_version", publish: "yes", reason: "existing", existing: 2 });
    const fromZip = file("alg-nieuw.css");
    zipped.add(fromZip);
    expect(
      uploadDefaults([fromZip, file("alg-kern.css"), file("x.js")], { unpacked, slugs }),
    ).toEqual({ conflict: "new_version", publish: "yes", reason: "zip", existing: 1 });
  });

  it("keeps the plain defaults otherwise", () => {
    const slugs = new Set(["alg-kern"]);
    const plain = { conflict: "rename", publish: "auto", reason: null };
    expect(uploadDefaults([file("alg-kern.css"), file("nieuw.css")], { unpacked, slugs })).toEqual({
      ...plain,
      existing: 1,
    });
    // Bundel erbij, alleen scripts, of de thema's zijn nog niet geladen.
    expect(
      uploadDefaults([file("alg-kern.css"), file("nord.cssthema.zip")], { unpacked, slugs }),
    ).toMatchObject(plain);
    expect(uploadDefaults([file("algemeen.js")], { unpacked, slugs })).toMatchObject(plain);
    expect(uploadDefaults([file("alg-kern.css")], { unpacked, slugs: null })).toEqual({
      ...plain,
      existing: 0,
    });
  });
});
