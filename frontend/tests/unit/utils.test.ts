import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { cn, mergeRefs } from "@/lib/utils";

describe("cn()", () => {
  it("voegt conditionele klassen samen en laat falsy waarden weg", () => {
    const disabled = false as boolean;
    expect(cn("a", disabled && "b", undefined, null, { c: true, d: false })).toBe("a c");
  });

  it("laat latere Tailwind-utilities conflicterende eerdere overschrijven", () => {
    expect(cn("px-2 py-1 bg-btn", "px-4", "bg-btn-hover")).toBe("py-1 px-4 bg-btn-hover");
  });
});

describe("mergeRefs()", () => {
  it("zet object- en callback-refs", () => {
    const objectRef = createRef<HTMLDivElement>();
    const callback = vi.fn();
    const el = document.createElement("div");
    mergeRefs<HTMLDivElement>(objectRef, callback, undefined)(el);
    expect(objectRef.current).toBe(el);
    expect(callback).toHaveBeenCalledWith(el);
  });
});
