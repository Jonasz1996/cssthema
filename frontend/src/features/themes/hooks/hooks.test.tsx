import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { publicCssUrl } from "./use-meta";
import { useDebouncedValue } from "./use-debounced-value";
import { useNameSlug } from "./use-name-slug";

describe("useNameSlug", () => {
  it("volgt de naam tot de slug met de hand gewijzigd wordt", () => {
    const { result } = renderHook(() => useNameSlug());
    expect(result.current.slug).toBe("");
    expect(result.current.issue).toBeNull();

    act(() => result.current.setName("Proxmox Nord"));
    expect(result.current.slug).toBe("proxmox-nord");
    expect(result.current.slugEdited).toBe(false);

    act(() => result.current.setSlug("pve"));
    act(() => result.current.setName("Iets anders"));
    expect(result.current.slug).toBe("pve");
    expect(result.current.slugEdited).toBe(true);

    // Leegmaken zet het voorstel weer aan.
    act(() => result.current.setSlug("  "));
    expect(result.current.slug).toBe("iets-anders");
    expect(result.current.slugEdited).toBe(false);
  });

  it("meldt problemen met de slug", () => {
    const { result } = renderHook(() => useNameSlug("Dashboard"));
    expect(result.current.issue).toBe("reserved");
    act(() => result.current.setSlug("Hoofd Letters"));
    expect(result.current.issue).toBe("format");
  });
});

describe("useDebouncedValue", () => {
  it("geeft de nieuwe waarde pas na de wachttijd", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "a" },
    });
    rerender({ value: "ab" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: "abc" });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(60));
    expect(result.current).toBe("abc");
  });
});

describe("publicCssUrl", () => {
  it("plakt basis-URL en slug aan elkaar", () => {
    expect(publicCssUrl("https://css.example/", "proxmox")).toBe("https://css.example/proxmox.css");
    expect(publicCssUrl("https://css.example", "proxmox")).toBe("https://css.example/proxmox.css");
    expect(publicCssUrl(null, "proxmox")).toBeNull();
    expect(publicCssUrl("https://css.example", "")).toBeNull();
  });
});
