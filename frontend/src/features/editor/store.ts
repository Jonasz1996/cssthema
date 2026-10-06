import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { readStorage, writeStorage } from "@/lib/storage";

/**
 * Toestand van de editor die de pagina overleeft (localStorage, `cssthema.editor`): de open
 * thema's als tabs en de indeling (breedtes, preview rechts/onder, viewport). De inhoud van de
 * drafts zelf staat niet hier maar in de sessies (`autosave/sessions.ts`) en op de server.
 */

export interface EditorTab {
  id: string;
  name: string;
  slug: string;
}

export type PreviewPosition = "right" | "bottom";
export type ViewportPreset = "desktop" | "tablet" | "mobile" | "custom";

export interface ViewportSize {
  width: number;
  height: number;
}

export const VIEWPORTS: Record<Exclude<ViewportPreset, "custom">, ViewportSize> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

export const VIEWPORT_LIMITS = { min: 240, max: 3840 } as const;
export const EXPLORER_WIDTH = { min: 160, max: 420, default: 230 } as const;
/** Aandeel van de preview in de ruimte naast/onder de editor. */
export const PREVIEW_SIZE = { min: 0.2, max: 0.8, default: 0.42 } as const;
/** Maximum aantal open tabs; de oudste (niet-actieve) valt weg. */
export const MAX_TABS = 12;

export interface EditorLayout {
  explorerOpen: boolean;
  explorerWidth: number;
  previewOpen: boolean;
  previewPosition: PreviewPosition;
  previewSize: number;
  problemsOpen: boolean;
  viewport: ViewportPreset;
  customViewport: ViewportSize;
}

export const DEFAULT_LAYOUT: EditorLayout = {
  explorerOpen: true,
  explorerWidth: EXPLORER_WIDTH.default,
  previewOpen: true,
  previewPosition: "right",
  previewSize: PREVIEW_SIZE.default,
  problemsOpen: false,
  viewport: "desktop",
  customViewport: { width: 1024, height: 768 },
};

interface EditorState {
  tabs: EditorTab[];
  layout: EditorLayout;
  /** Tab toevoegen of bijwerken (naam/slug gewijzigd); de volgorde blijft. */
  openTab: (tab: EditorTab, activeId?: string) => void;
  /** Tab sluiten; geeft het id van de buur die actief moet worden (of `null`). */
  closeTab: (id: string) => string | null;
  setLayout: (patch: Partial<EditorLayout>) => void;
  resetLayout: () => void;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Waarden uit localStorage of de UI binnen de grenzen houden. */
export function normalizeLayout(layout: Partial<EditorLayout> | undefined): EditorLayout {
  const merged = { ...DEFAULT_LAYOUT, ...(layout ?? {}) };
  const custom = merged.customViewport ?? DEFAULT_LAYOUT.customViewport;
  return {
    explorerOpen: Boolean(merged.explorerOpen),
    explorerWidth: Math.round(clamp(merged.explorerWidth, EXPLORER_WIDTH.min, EXPLORER_WIDTH.max)),
    previewOpen: Boolean(merged.previewOpen),
    previewPosition: merged.previewPosition === "bottom" ? "bottom" : "right",
    previewSize: clamp(merged.previewSize, PREVIEW_SIZE.min, PREVIEW_SIZE.max),
    problemsOpen: Boolean(merged.problemsOpen),
    viewport: (["desktop", "tablet", "mobile", "custom"] as const).includes(merged.viewport)
      ? merged.viewport
      : "desktop",
    customViewport: {
      width: Math.round(clamp(custom.width, VIEWPORT_LIMITS.min, VIEWPORT_LIMITS.max)),
      height: Math.round(clamp(custom.height, VIEWPORT_LIMITS.min, VIEWPORT_LIMITS.max)),
    },
  };
}

/** Viewport-afmetingen voor de gekozen stand. */
export function viewportSize(layout: Pick<EditorLayout, "viewport" | "customViewport">) {
  return layout.viewport === "custom" ? layout.customViewport : VIEWPORTS[layout.viewport];
}

function isTab(value: unknown): value is EditorTab {
  if (typeof value !== "object" || value === null) return false;
  const tab = value as Record<string, unknown>;
  return typeof tab.id === "string" && typeof tab.name === "string" && typeof tab.slug === "string";
}

/** localStorage via de veilige helpers (privévenster, volle opslag). */
const storage: StateStorage = {
  getItem: (name) => readStorage(name),
  setItem: (name, value) => writeStorage(name, value),
  removeItem: (name) => writeStorage(name, null),
};

export const EDITOR_STORAGE_KEY = "editor";

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      tabs: [],
      layout: DEFAULT_LAYOUT,
      openTab: (tab, activeId = tab.id) =>
        set((state) => {
          const index = state.tabs.findIndex((item) => item.id === tab.id);
          if (index >= 0) {
            const current = state.tabs[index]!;
            if (current.name === tab.name && current.slug === tab.slug) return state;
            const tabs = [...state.tabs];
            tabs[index] = { ...tab };
            return { tabs };
          }
          let tabs = [...state.tabs, { ...tab }];
          while (tabs.length > MAX_TABS) {
            const drop = tabs.findIndex((item) => item.id !== activeId);
            tabs = tabs.filter((_, i) => i !== drop);
          }
          return { tabs };
        }),
      closeTab: (id) => {
        const tabs = get().tabs;
        const index = tabs.findIndex((item) => item.id === id);
        if (index < 0) return null;
        const rest = tabs.filter((item) => item.id !== id);
        set({ tabs: rest });
        const neighbour = rest[Math.min(index, rest.length - 1)];
        return neighbour?.id ?? null;
      },
      setLayout: (patch) =>
        set((state) => ({ layout: normalizeLayout({ ...state.layout, ...patch }) })),
      resetLayout: () => set({ layout: DEFAULT_LAYOUT }),
    }),
    {
      name: `${EDITOR_STORAGE_KEY}`,
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({ tabs: state.tabs, layout: state.layout }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Pick<EditorState, "tabs" | "layout">>;
        return {
          ...current,
          tabs: Array.isArray(saved.tabs) ? saved.tabs.filter(isTab).slice(-MAX_TABS) : [],
          layout: normalizeLayout(saved.layout),
        };
      },
    },
  ),
);
