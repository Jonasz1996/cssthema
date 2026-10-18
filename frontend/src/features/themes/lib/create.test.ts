import { describe, expect, it } from "vitest";
import { makePalette } from "@/api/testing/fixtures";
import { type NewThemeForm, buildThemeCreate } from "./create";
import { starterTemplate } from "./template";

const form: NewThemeForm = {
  name: "  Proxmox Nord ",
  slug: "",
  paletteId: "",
  description: "  ",
  start: "empty",
  copyFrom: "",
};

describe("buildThemeCreate", () => {
  it("leeg thema: getrimde naam, geen slug, null voor lege velden", () => {
    expect(buildThemeCreate(form, null)).toEqual({
      name: "Proxmox Nord",
      palette_id: null,
      description: null,
    });
  });

  it("neemt slug, palet en beschrijving mee", () => {
    expect(
      buildThemeCreate(
        { ...form, slug: " proxmox ", paletteId: "p1", description: " Donker " },
        null,
      ),
    ).toEqual({ name: "Proxmox Nord", slug: "proxmox", palette_id: "p1", description: "Donker" });
  });

  it("kopie van een thema gebruikt een sjabloon van het type theme", () => {
    const body = buildThemeCreate({ ...form, start: "copy", copyFrom: "t-1" }, null);
    expect(body.template).toEqual({ kind: "theme", id: "t-1" });
    expect(body.css).toBeUndefined();
  });

  it("kopie zonder gekozen thema stuurt geen sjabloon", () => {
    expect(buildThemeCreate({ ...form, start: "copy" }, null).template).toBeUndefined();
  });

  it("basissjabloon zet de CSS met de waarden van het palet", () => {
    const palette = makePalette({ name: "Nord", tokens: { bg: "#2e3440", accent: "#88c0d0" } });
    const body = buildThemeCreate({ ...form, start: "template", paletteId: palette.id }, palette);
    expect(body.css).toBe(starterTemplate(form.name, palette));
    expect(body.css).toContain("var(--ct-bg, #2e3440)");
  });
});

describe("starterTemplate", () => {
  it("gebruikt --ct-* met de standaardwaarden zonder palet", () => {
    const css = starterTemplate("Mijn thema");
    expect(css).toContain("/* Mijn thema — basissjabloon");
    expect(css).toContain("background: var(--ct-bg, #141414);");
    expect(css).toContain("color: var(--ct-danger, #e58b8b);");
    expect(css).not.toContain("undefined");
  });

  it("valt per token terug op de standaard als het palet het niet heeft", () => {
    const css = starterTemplate("X", makePalette({ name: "Klein", tokens: { fg: "#fff" } }));
    expect(css).toContain("color: var(--ct-fg, #fff);");
    expect(css).toContain("border-radius: var(--ct-radius, 10px);");
    expect(css).toContain("Palet: Klein");
  });

  it("kan de commentaar niet voortijdig sluiten", () => {
    const css = starterTemplate("Boos */ body{}", makePalette({ name: "*/x", tokens: {} }));
    // De naam blijft binnen de kopcommentaar: die sluit pas na de regel met het palet.
    const header = css.slice(0, css.indexOf("*/") + 2);
    expect(header).toContain("Boos * / body{}");
    expect(header).toContain("Palet: * /x");
    expect(css.slice(header.length).trimStart().startsWith(":root")).toBe(true);
  });

  it("heeft gebalanceerde accolades", () => {
    const css = starterTemplate("Y");
    expect(css.split("{").length).toBe(css.split("}").length);
  });
});
