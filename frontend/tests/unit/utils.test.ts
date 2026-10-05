import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

describe("cn()", () => {
  it("joins conditional classes and drops falsy values", () => {
    const disabled = false as boolean;
    expect(cn("a", disabled && "b", undefined, null, { c: true, d: false })).toBe("a c");
  });

  it("lets later Tailwind utilities override conflicting earlier ones", () => {
    expect(cn("px-2 py-1 bg-panel", "px-4", "bg-accent")).toBe("py-1 px-4 bg-accent");
  });
});

describe("t()", () => {
  it("returns English labels by default", () => {
    expect(t("nav.palettes")).toBe("Palettes");
  });
});
