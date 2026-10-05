import { afterEach, describe, expect, it } from "vitest";
import { createIdbBuffer, createMemoryBuffer } from "../autosave/buffer";
import {
  DEFAULT_LAYOUT,
  MAX_TABS,
  normalizeLayout,
  useEditorStore,
  VIEWPORTS,
  viewportSize,
} from "../store";

afterEach(() => {
  useEditorStore.setState({ tabs: [], layout: DEFAULT_LAYOUT });
});

const tab = (n: number) => ({ id: `t${n}`, name: `Thema ${n}`, slug: `thema-${n}` });

describe("editor store (tabs + layout, persisted)", () => {
  it("opens tabs once, updates names in place and persists under cssthema.editor", () => {
    const { openTab } = useEditorStore.getState();
    openTab(tab(1));
    openTab(tab(2));
    openTab(tab(1));
    openTab({ ...tab(1), name: "Hernoemd" });
    expect(useEditorStore.getState().tabs.map((item) => item.name)).toEqual([
      "Hernoemd",
      "Thema 2",
    ]);
    const stored = JSON.parse(localStorage.getItem("cssthema.editor") ?? "{}") as {
      state: { tabs: unknown[] };
    };
    expect(stored.state.tabs).toHaveLength(2);
  });

  it("closing a tab returns the neighbour to activate", () => {
    const { openTab, closeTab } = useEditorStore.getState();
    [1, 2, 3].forEach((n) => openTab(tab(n)));
    expect(closeTab("t2")).toBe("t3");
    expect(closeTab("t3")).toBe("t1");
    expect(closeTab("t1")).toBeNull();
    expect(closeTab("nope")).toBeNull();
  });

  it(`keeps at most ${MAX_TABS} tabs, never dropping the active one`, () => {
    const { openTab } = useEditorStore.getState();
    for (let n = 1; n <= MAX_TABS + 2; n += 1) openTab(tab(n));
    const ids = useEditorStore.getState().tabs.map((item) => item.id);
    expect(ids).toHaveLength(MAX_TABS);
    expect(ids.at(-1)).toBe(`t${MAX_TABS + 2}`);
    expect(ids).not.toContain("t1");
  });

  it("clamps layout values (also from a tampered localStorage)", () => {
    const layout = normalizeLayout({
      explorerWidth: 5000,
      previewSize: -3,
      previewPosition: "left" as never,
      viewport: "watch" as never,
      customViewport: { width: 10, height: Number.NaN },
    });
    expect(layout).toMatchObject({
      explorerWidth: 420,
      previewSize: 0.2,
      previewPosition: "right",
      viewport: "desktop",
      customViewport: { width: 240, height: 240 },
    });
    useEditorStore.getState().setLayout({ previewSize: 0.95, viewport: "custom" });
    expect(useEditorStore.getState().layout.previewSize).toBe(0.8);
    expect(viewportSize(useEditorStore.getState().layout)).toEqual(DEFAULT_LAYOUT.customViewport);
    expect(viewportSize({ viewport: "mobile", customViewport: { width: 1, height: 1 } })).toEqual(
      VIEWPORTS.mobile,
    );
  });
});

describe("offline buffer", () => {
  it("memory buffer stores, returns and deletes per theme", async () => {
    const buffer = createMemoryBuffer();
    await buffer.set({ themeId: "a", css: "x", baseLockVersion: 2, savedAt: "now" });
    await expect(buffer.get("a")).resolves.toMatchObject({ css: "x", baseLockVersion: 2 });
    await expect(buffer.get("b")).resolves.toBeUndefined();
    await buffer.delete("a");
    await expect(buffer.get("a")).resolves.toBeUndefined();
  });

  it("IndexedDB buffer falls back to memory when IndexedDB is unavailable (jsdom)", async () => {
    expect(typeof indexedDB).toBe("undefined");
    const buffer = createIdbBuffer();
    await buffer.set({ themeId: "a", css: "y", baseLockVersion: 1, savedAt: "now" });
    await expect(buffer.get("a")).resolves.toMatchObject({ css: "y" });
    await buffer.delete("a");
    await expect(buffer.get("a")).resolves.toBeUndefined();
  });
});
