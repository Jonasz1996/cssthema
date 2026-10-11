import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { ServiceSummary, Theme } from "@/api/types";
import { readStorage, writeStorage } from "@/lib/storage";

/**
 * Waartegen de preview het thema toont (stappenplan D2): de ingebouwde demo-pagina of een
 * vastgelegde pagina (snapshot) van een echte app. De keuze geldt per thema en blijft bewaard
 * (localStorage, `cssthema.editor.previewSource`); zonder keuze kiest `defaultPreviewSource`.
 */

/** Waarde van de keuze voor de demo-pagina; anders is de waarde een snapshot-id. */
export const DEMO_SOURCE = "demo";

/** Zoveel thema's onthouden we hoogstens (de oudste keuze valt weg). */
export const MAX_REMEMBERED_SOURCES = 100;

export type PreviewSourceTheme = Pick<Theme, "id" | "slug" | "service_id">;

export interface SnapshotOption {
  id: string;
  page: string;
  title: string | null;
  capturedAt: string | null;
}

/** Eén dienst met de snapshots waartegen je kunt previewen (nieuwste eerst). */
export interface SnapshotGroup {
  serviceId: string;
  slug: string;
  hostname: string;
  snapshots: SnapshotOption[];
}

/** Diensten met minstens één snapshot met document, op hostnaam gesorteerd. */
export function snapshotGroups(services: readonly ServiceSummary[]): SnapshotGroup[] {
  return services
    .map((service) => ({
      serviceId: service.id,
      slug: service.slug,
      hostname: service.hostname,
      snapshots: service.snapshots
        .filter((snapshot) => snapshot.has_document)
        .map((snapshot) => ({
          id: snapshot.id,
          page: snapshot.page,
          title: snapshot.title,
          capturedAt: snapshot.captured_at,
        })),
    }))
    .filter((group) => group.snapshots.length > 0)
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
}

/** De snapshot met dit id, samen met zijn dienst. */
export function findSnapshot(
  groups: readonly SnapshotGroup[],
  id: string,
): { group: SnapshotGroup; snapshot: SnapshotOption } | null {
  for (const group of groups) {
    const snapshot = group.snapshots.find((item) => item.id === id);
    if (snapshot) return { group, snapshot };
  }
  return null;
}

/**
 * Standaardbron voor een thema zonder bewaarde keuze:
 * 1. het thema hangt aan een dienst → de nieuwste snapshot van die dienst;
 * 2. de slug `alg-<x>` of `<x>` past bij een dienst waarvan de hostnaam met `<x>.` begint
 *    (bv. `grafana` → `grafana.lan`), of waarvan de slug met `<x>` begint;
 * 3. anders de demo-pagina.
 */
export function defaultPreviewSource(
  theme: PreviewSourceTheme,
  groups: readonly SnapshotGroup[],
): string {
  const linked = theme.service_id
    ? groups.find((group) => group.serviceId === theme.service_id)
    : undefined;
  if (linked) return linked.snapshots[0]!.id;
  const name = theme.slug.toLowerCase().replace(/^alg-/, "");
  if (name) {
    const match =
      groups.find((group) => group.hostname.toLowerCase().startsWith(`${name}.`)) ??
      groups.find((group) => group.slug.toLowerCase().startsWith(name));
    if (match) return match.snapshots[0]!.id;
  }
  return DEMO_SOURCE;
}

/**
 * De bron die de preview nu toont: de bewaarde keuze als die nog bestaat, anders de
 * standaard. `null` zolang dat nog niet vaststaat (geen keuze en de diensten laden nog).
 * `groups` is `undefined` zolang de diensten niet geladen zijn; lukt dat niet, dan de demo.
 */
export function resolvePreviewSource(
  stored: string | undefined,
  theme: PreviewSourceTheme,
  groups: readonly SnapshotGroup[] | undefined,
  servicesFailed: boolean,
): string | null {
  if (stored === DEMO_SOURCE) return DEMO_SOURCE;
  if (stored) {
    // Nog niet bekend of de snapshot bestaat: alvast laden. Verdwenen: terug naar de standaard.
    if (!groups || findSnapshot(groups, stored)) return stored;
  }
  if (!groups) return servicesFailed ? DEMO_SOURCE : null;
  return defaultPreviewSource(theme, groups);
}

// --- bewaarde keuzes ----------------------------------------------------------------------------

interface PreviewSourceState {
  /** Thema-id → `demo` of snapshot-id (oudste keuze eerst). */
  choices: Record<string, string>;
  choose: (themeId: string, source: string) => void;
}

/** localStorage via de veilige helpers (privévenster, geblokkeerde of volle opslag). */
const storage: StateStorage = {
  getItem: (name) => readStorage(name),
  setItem: (name, value) => writeStorage(name, value),
  removeItem: (name) => writeStorage(name, null),
};

export const PREVIEW_SOURCE_STORAGE_KEY = "editor.previewSource";

function validChoices(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1])
      .slice(-MAX_REMEMBERED_SOURCES),
  );
}

export const usePreviewSourceStore = create<PreviewSourceState>()(
  persist(
    (set) => ({
      choices: {},
      choose: (themeId, source) =>
        set((state) => {
          if (state.choices[themeId] === source) return state;
          const rest = Object.entries(state.choices).filter(([id]) => id !== themeId);
          return {
            choices: Object.fromEntries(
              [...rest, [themeId, source]].slice(-MAX_REMEMBERED_SOURCES),
            ),
          };
        }),
    }),
    {
      name: PREVIEW_SOURCE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({ choices: state.choices }),
      merge: (persisted, current) => ({
        ...current,
        choices: validChoices((persisted as { choices?: unknown } | undefined)?.choices),
      }),
    },
  ),
);
