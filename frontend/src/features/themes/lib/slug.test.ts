import { describe, expect, it } from "vitest";
import { FALLBACK_SLUG, RESERVED_SLUGS, slugify, slugIssue, suggestSlug } from "./slug";

describe("slugify", () => {
  it.each([
    ["Proxmox (Nord)", "proxmox-nord"],
    ["  Home   Assistant  ", "home-assistant"],
    ["Crème brûlée", "creme-brulee"],
    ["Jellyfin_v2.0", "jellyfin-v2-0"],
    ["--dubbel--streepje--", "dubbel-streepje"],
    ["ÄÖÜ ß", "aou"],
  ])("%s → %s", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("valt terug op 'thema' als er te weinig overblijft", () => {
    expect(slugify("")).toBe(FALLBACK_SLUG);
    expect(slugify("✨")).toBe(FALLBACK_SLUG);
    expect(slugify("a")).toBe(FALLBACK_SLUG);
  });

  it("knipt af op 64 tekens zonder streepje op het einde", () => {
    const slug = slugify(`${"a".repeat(63)} b`);
    expect(slug).toBe("a".repeat(63));
    expect(slugify("x".repeat(100))).toHaveLength(64);
  });

  it("geeft altijd een geldig formaat (behalve gereserveerde woorden)", () => {
    for (const name of ["Grafana Tokyo Night", "Ünïcödé!!", "12 34", "x".repeat(80)]) {
      expect(["reserved", null]).toContain(slugIssue(slugify(name)));
    }
  });
});

describe("suggestSlug", () => {
  it("laat een lege naam leeg", () => {
    expect(suggestSlug("")).toBe("");
    expect(suggestSlug("   ")).toBe("");
  });

  it("volgt slugify voor een echte naam", () => {
    expect(suggestSlug("Nextcloud Dracula")).toBe("nextcloud-dracula");
  });
});

describe("slugIssue", () => {
  it.each([
    ["a", "short"],
    ["", "short"],
    ["a".repeat(65), "long"],
    ["Proxmox", "format"],
    ["-proxmox", "format"],
    ["proxmox-", "format"],
    ["prox_mox", "format"],
    ["api", "reserved"],
    ["editor", "reserved"],
    ["proxmox", null],
    ["a1", null],
    ["home-assistant", null],
  ] as const)("%s → %s", (slug, issue) => {
    expect(slugIssue(slug)).toBe(issue);
  });

  it("kent de gereserveerde routes van cssthema", () => {
    for (const word of ["themes", "palettes", "import", "dashboard", "healthz"]) {
      expect(RESERVED_SLUGS.has(word)).toBe(true);
    }
  });
});
