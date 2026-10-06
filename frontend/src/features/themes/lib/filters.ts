import type { Theme, ThemeListFilters, ThemeSort } from "@/api/types";

/**
 * Filters van de themabrowser (`/themes`), bewaard in de URL (`?q=&status=&palette=&sort=`)
 * zodat terugknop, herladen en delen werken.
 *
 * De API kent `status=published|draft` en `include_deleted`; "draft gewijzigd" en "verwijderd"
 * filtert de browser zelf op de geladen pagina's (`matchesStatus`). Daarom laadt de lijst bij
 * zo'n filter zelf extra pagina's bij tot er genoeg zichtbaar is (`shouldLoadMore`).
 */

export type StatusFilter = "all" | "live" | "dirty" | "never" | "deleted";

export const STATUS_FILTERS: readonly StatusFilter[] = ["all", "live", "dirty", "never", "deleted"];
export const THEME_SORTS: readonly ThemeSort[] = ["-updated_at", "name", "-created_at"];
export const DEFAULT_SORT: ThemeSort = "-updated_at";

/** Aantal thema's per pagina (deelbaar door 1, 2, 3 en 4 kolommen). */
export const PAGE_SIZE = 24;

export interface BrowserFilters {
  q: string;
  status: StatusFilter;
  /** Palet-id, of `""` voor alle paletten. */
  palette: string;
  sort: ThemeSort;
}

export const EMPTY_FILTERS: BrowserFilters = {
  q: "",
  status: "all",
  palette: "",
  sort: DEFAULT_SORT,
};

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** URL → filters; onbekende waarden vallen terug op de standaard. */
export function parseFilters(params: URLSearchParams): BrowserFilters {
  return {
    q: params.get("q") ?? "",
    status: oneOf(params.get("status"), STATUS_FILTERS, "all"),
    palette: params.get("palette") ?? "",
    sort: oneOf(params.get("sort"), THEME_SORTS, DEFAULT_SORT),
  };
}

/**
 * Filters → URL. Standaardwaarden laten we weg (een kale `/themes` blijft kaal); andere
 * parameters (bv. `new=1`) blijven staan.
 */
export function writeFilters(params: URLSearchParams, filters: BrowserFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string, fallback: string) => {
    if (value && value !== fallback) next.set(key, value);
    else next.delete(key);
  };
  set("q", filters.q, "");
  set("status", filters.status, "all");
  set("palette", filters.palette, "");
  set("sort", filters.sort, DEFAULT_SORT);
  return next;
}

/** Wat de server filtert. */
export function toApiFilters(filters: BrowserFilters): ThemeListFilters {
  const api: ThemeListFilters = { sort: filters.sort, limit: PAGE_SIZE };
  if (filters.q.trim()) api.q = filters.q.trim();
  if (filters.palette) api.palette_id = filters.palette;
  switch (filters.status) {
    case "live":
      api.status = "published";
      break;
    case "never":
      api.status = "draft";
      break;
    case "deleted":
      api.include_deleted = true;
      break;
    case "dirty":
    case "all":
      break;
  }
  return api;
}

/** Wat de browser zelf nog filtert, bovenop de server. */
export function matchesStatus(
  theme: Pick<Theme, "deleted_at" | "draft_dirty">,
  status: StatusFilter,
): boolean {
  switch (status) {
    case "deleted":
      return Boolean(theme.deleted_at);
    case "dirty":
      // Zoals de server (en de KPI op het dashboard): de draft wijkt af van de live versie,
      // of er is nog geen live versie en de draft is niet leeg.
      return !theme.deleted_at && theme.draft_dirty;
    default:
      return true;
  }
}

/** Of dit statusfilter (ook) in de browser filtert, zodat pagina's minder tonen dan ze laden. */
export function filtersClientSide(status: StatusFilter): boolean {
  return status === "dirty" || status === "deleted";
}

/** Of er filters actief zijn (voor de lege toestand: "geen resultaten" i.p.v. "nog geen thema's"). */
export function hasActiveFilters(filters: BrowserFilters): boolean {
  return Boolean(filters.q.trim()) || filters.status !== "all" || Boolean(filters.palette);
}

export interface LoadMoreState {
  /** Aantal zichtbare thema's (na het browserfilter). */
  visible: number;
  /** Hoeveel er gevraagd zijn (begint bij één pagina, "meer laden" telt er een pagina bij). */
  wanted: number;
  hasNextPage: boolean;
  isFetching: boolean;
}

/** Nog een pagina van de server halen: er is er een, we zijn niet al bezig, en er zijn er te weinig. */
export function shouldLoadMore({
  visible,
  wanted,
  hasNextPage,
  isFetching,
}: LoadMoreState): boolean {
  return hasNextPage && !isFetching && visible < wanted;
}
