import type { QueryClient } from "@tanstack/react-query";
import type { Draft, Theme } from "../types";
import { dashboardKeys, paletteKeys, themeKeys } from "./keys";

/**
 * Cache-bijwerking na mutaties, gedeeld door `themes.ts` en `editor.ts`. Ongeldig maken
 * herlaadt alleen queries die op het scherm staan (TanStack-standaard `refetchType: "active"`);
 * de rest haalt zichzelf op bij het volgende gebruik.
 */

/** Zet een vers Theme in de detail-cache. */
export function putTheme(queryClient: QueryClient, theme: Theme): void {
  queryClient.setQueryData(themeKeys.detail(theme.id), theme);
}

/** Werkt velden van een gecachet Theme bij (bv. de nieuwe `lock_version`), als het er is. */
export function patchTheme(queryClient: QueryClient, themeId: string, patch: Partial<Theme>): void {
  queryClient.setQueryData<Theme>(themeKeys.detail(themeId), (old) =>
    old ? { ...old, ...patch } : old,
  );
}

/** Werkt velden van een gecachete Draft bij, als die er is (de inhoud blijft van de editor). */
export function patchDraft(queryClient: QueryClient, themeId: string, patch: Partial<Draft>): void {
  queryClient.setQueryData<Draft>(themeKeys.draft(themeId), (old) =>
    old ? { ...old, ...patch } : old,
  );
}

/** Lijsten, dashboard (tellers, recent) en optioneel paletten (`theme_count`). */
export async function invalidateCollections(
  queryClient: QueryClient,
  { palettes = false, localFiles = false }: { palettes?: boolean; localFiles?: boolean } = {},
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: themeKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
    palettes ? queryClient.invalidateQueries({ queryKey: paletteKeys.all }) : null,
    localFiles ? queryClient.invalidateQueries({ queryKey: themeKeys.localFiles() }) : null,
  ]);
}

/**
 * Toestand van één thema: detail, versies, diffs en de lint van de opgeslagen draft. De
 * draft-inhoud alleen met `draft: true` (rollback, import): die herladen overschrijft de editor.
 */
export async function invalidateThemeState(
  queryClient: QueryClient,
  themeId: string,
  { draft = false, versions = true }: { draft?: boolean; versions?: boolean } = {},
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: themeKeys.detail(themeId) }),
    versions ? queryClient.invalidateQueries({ queryKey: themeKeys.versions(themeId) }) : null,
    queryClient.invalidateQueries({ queryKey: themeKeys.diffs(themeId) }),
    queryClient.invalidateQueries({ queryKey: themeKeys.lint(themeId, null), exact: true }),
    draft ? queryClient.invalidateQueries({ queryKey: themeKeys.draft(themeId) }) : null,
  ]);
}

/** Na definitief verwijderen: alle caches van dat thema weg. */
export function removeTheme(queryClient: QueryClient, themeId: string): void {
  for (const queryKey of [
    themeKeys.detail(themeId),
    themeKeys.draft(themeId),
    themeKeys.lintAll(themeId),
    themeKeys.versions(themeId),
    themeKeys.diffs(themeId),
  ]) {
    queryClient.removeQueries({ queryKey });
  }
}
