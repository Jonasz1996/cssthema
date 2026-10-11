import { useCallback, useMemo } from "react";
import { useServices, useSnapshotDocument } from "@/api/queries/services";
import {
  DEMO_SOURCE,
  findSnapshot,
  type PreviewSourceTheme,
  resolvePreviewSource,
  type SnapshotGroup,
  type SnapshotOption,
  snapshotGroups,
  usePreviewSourceStore,
} from "./source";

export interface PreviewSource {
  /** `demo`, een snapshot-id, of `null` zolang de keuze nog niet vaststaat. */
  value: string | null;
  /** Het snapshot-id als de bron een snapshot is. */
  snapshotId: string | null;
  /** Diensten met snapshots om uit te kiezen. */
  groups: SnapshotGroup[];
  /** De diensten zijn geladen (dan zegt een lege `groups`: nog geen snapshots). */
  servicesLoaded: boolean;
  /** De gekozen snapshot en zijn dienst, als die in de lijst staat. */
  selected: { group: SnapshotGroup; snapshot: SnapshotOption } | null;
  /** Kiest `demo` of een snapshot-id voor dit thema (en onthoudt dat). */
  select: (value: string) => void;
  /** Het document van de gekozen snapshot (HTML + CSS van de app). */
  document: ReturnType<typeof useSnapshotDocument>;
}

/**
 * De bron van de preview voor een thema (zie `source.ts`). De editor gebruikt dezelfde hook voor
 * de autocomplete; de keuze staat in een gedeelde store en de queries delen hun cache, dus
 * preview en autocomplete volgen dezelfde snapshot zonder iets dubbel op te halen.
 */
export function usePreviewSource(theme: PreviewSourceTheme | null | undefined): PreviewSource {
  const services = useServices({ enabled: Boolean(theme) });
  const themeId = theme?.id;
  const stored = usePreviewSourceStore((state) => (themeId ? state.choices[themeId] : undefined));
  const choose = usePreviewSourceStore((state) => state.choose);
  const groups = useMemo(() => snapshotGroups(services.data ?? []), [services.data]);

  const value = theme
    ? resolvePreviewSource(stored, theme, services.data ? groups : undefined, services.isError)
    : DEMO_SOURCE;
  const snapshotId = value !== null && value !== DEMO_SOURCE ? value : null;
  const document = useSnapshotDocument(snapshotId);
  const select = useCallback(
    (next: string) => {
      if (themeId) choose(themeId, next);
    },
    [choose, themeId],
  );

  return {
    value,
    snapshotId,
    groups,
    servicesLoaded: services.isSuccess,
    selected: snapshotId ? findSnapshot(groups, snapshotId) : null,
    select,
    document,
  };
}
