import type { DiffRef, ThemeListFilters } from "../types";

/**
 * Query-keys van de API-laag. Hiërarchisch, zodat één prefix een hele groep ongeldig maakt:
 *
 * ```
 * ["themes"]                                   alles van thema's
 * ["themes", "list"]                           alle lijsten (pagina's en infinite)
 * ["themes", "list", "page", filters]          één pagina (useThemes)
 * ["themes", "list", "infinite", filters]      "meer laden" (useThemesInfinite)
 * ["themes", "detail", id]                     Theme
 * ["themes", "draft", id]                      Draft
 * ["themes", "lint", id, css | null]           LintResult (null = opgeslagen draft)
 * ["themes", "versions", id, …]                lijsten en details van versies
 * ["themes", "diff", id, from, to]             VersionDiff
 * ["themes", "local-files"]                    handgemaakte bestanden op de server
 * ["palettes", "list"] / ["palettes", "detail", id]
 * ["scripts", "list"]                          thema-scripts (`.js` in css-files)
 * ["scripts", "content", name]                 inhoud van één script
 * ["hosts", "list"] / ["hosts", "options"]     host-koppelingen en de keuzes ervoor
 * ["dashboard"]
 * ```
 *
 * Detail, draft en versies staan bewust níet onder elkaar: een autosave mag de draft-query
 * niet laten herladen wanneer het thema (detail) ververst wordt.
 */
export const themeKeys = {
  all: ["themes"] as const,
  lists: () => [...themeKeys.all, "list"] as const,
  list: (filters: ThemeListFilters = {}) =>
    [...themeKeys.lists(), "page", normalizeThemeFilters(filters)] as const,
  infinite: (filters: ThemeListFilters = {}) =>
    [...themeKeys.lists(), "infinite", normalizeThemeFilters(filters)] as const,
  detail: (themeId: string) => [...themeKeys.all, "detail", themeId] as const,
  draft: (themeId: string) => [...themeKeys.all, "draft", themeId] as const,
  lintAll: (themeId: string) => [...themeKeys.all, "lint", themeId] as const,
  lint: (themeId: string, css: string | null) => [...themeKeys.lintAll(themeId), css] as const,
  versions: (themeId: string) => [...themeKeys.all, "versions", themeId] as const,
  versionList: (themeId: string, limit?: number) =>
    [...themeKeys.versions(themeId), "page", { limit: limit ?? null }] as const,
  versionInfinite: (themeId: string, limit?: number) =>
    [...themeKeys.versions(themeId), "infinite", { limit: limit ?? null }] as const,
  version: (themeId: string, versionNumber: number) =>
    [...themeKeys.versions(themeId), "detail", versionNumber] as const,
  diffs: (themeId: string) => [...themeKeys.all, "diff", themeId] as const,
  diff: (themeId: string, from: DiffRef, to: DiffRef) =>
    [...themeKeys.diffs(themeId), from, to] as const,
  localFiles: () => [...themeKeys.all, "local-files"] as const,
};

export const paletteKeys = {
  all: ["palettes"] as const,
  list: () => [...paletteKeys.all, "list"] as const,
  detail: (paletteId: string) => [...paletteKeys.all, "detail", paletteId] as const,
};

export const scriptKeys = {
  all: ["scripts"] as const,
  list: () => [...scriptKeys.all, "list"] as const,
  contents: () => [...scriptKeys.all, "content"] as const,
  content: (name: string) => [...scriptKeys.contents(), name] as const,
};

export const hostKeys = {
  all: ["hosts"] as const,
  list: () => [...hostKeys.all, "list"] as const,
  options: () => [...hostKeys.all, "options"] as const,
};

export const dashboardKeys = {
  all: ["dashboard"] as const,
};

/**
 * Filters zonder lege waarden (`""`, `null`, `undefined`, `include_deleted: false`), zodat
 * `{ q: "" }` en `{}` dezelfde query zijn. Zoektekst wordt getrimd.
 */
export function normalizeThemeFilters(filters: ThemeListFilters): ThemeListFilters {
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(filters)) {
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === undefined || value === null || value === "") continue;
    if (key === "include_deleted" && value === false) continue;
    result[key] = value;
  }
  return result as ThemeListFilters;
}
