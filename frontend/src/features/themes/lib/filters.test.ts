import { describe, expect, it } from "vitest";
import { makeTheme } from "@/api/testing/fixtures";
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filtersClientSide,
  hasActiveFilters,
  matchesStatus,
  PAGE_SIZE,
  parseFilters,
  shouldLoadMore,
  toApiFilters,
  writeFilters,
} from "./filters";

describe("parseFilters / writeFilters", () => {
  it("leest de URL en valt terug op standaardwaarden", () => {
    expect(parseFilters(new URLSearchParams(""))).toEqual(EMPTY_FILTERS);
    expect(parseFilters(new URLSearchParams("q=nord&status=live&palette=p1&sort=name"))).toEqual({
      q: "nord",
      status: "live",
      palette: "p1",
      sort: "name",
    });
    expect(parseFilters(new URLSearchParams("status=bogus&sort=hack"))).toEqual(EMPTY_FILTERS);
  });

  it("schrijft alleen wat afwijkt van de standaard en laat andere parameters staan", () => {
    const next = writeFilters(new URLSearchParams("new=1&status=live&q=x"), {
      ...EMPTY_FILTERS,
      palette: "p2",
    });
    expect(next.get("new")).toBe("1");
    expect(next.get("palette")).toBe("p2");
    expect(next.has("status")).toBe(false);
    expect(next.has("q")).toBe(false);
    expect(next.has("sort")).toBe(false);
  });

  it("is omkeerbaar", () => {
    const filters = {
      q: "dra cula",
      status: "deleted",
      palette: "p",
      sort: "-created_at",
    } as const;
    expect(parseFilters(writeFilters(new URLSearchParams(), filters))).toEqual(filters);
  });
});

describe("toApiFilters", () => {
  it("zet altijd sortering en paginagrootte", () => {
    expect(toApiFilters(EMPTY_FILTERS)).toEqual({ sort: DEFAULT_SORT, limit: PAGE_SIZE });
  });

  it("vertaalt zoeken, palet en status naar de API", () => {
    expect(toApiFilters({ q: "  nord ", status: "live", palette: "p1", sort: "name" })).toEqual({
      q: "nord",
      palette_id: "p1",
      status: "published",
      sort: "name",
      limit: PAGE_SIZE,
    });
    expect(toApiFilters({ ...EMPTY_FILTERS, status: "never" }).status).toBe("draft");
    expect(toApiFilters({ ...EMPTY_FILTERS, status: "deleted" }).include_deleted).toBe(true);
    const dirty = toApiFilters({ ...EMPTY_FILTERS, status: "dirty" });
    expect(dirty.status).toBeUndefined();
    expect(dirty.include_deleted).toBeUndefined();
  });
});

describe("matchesStatus", () => {
  const live = makeTheme({ status: "published", draft_dirty: false });
  const dirty = makeTheme({ status: "published", draft_dirty: true });
  const neverButDirty = makeTheme({ status: "draft", draft_dirty: true });
  const deleted = makeTheme({ deleted_at: "2026-10-01T10:00:00Z", draft_dirty: true });

  it("verwijderd: alleen thema's met deleted_at", () => {
    expect([live, dirty, deleted].map((t) => matchesStatus(t, "deleted"))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("draft gewijzigd: zoals de server (ook nooit gepubliceerd met inhoud), niet verwijderd", () => {
    expect([live, dirty, neverButDirty, deleted].map((t) => matchesStatus(t, "dirty"))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("andere statussen filtert de server", () => {
    for (const status of ["all", "live", "never"] as const) {
      expect(matchesStatus(deleted, status)).toBe(true);
    }
  });

  it("weet welke statussen in de browser filteren", () => {
    expect(filtersClientSide("dirty")).toBe(true);
    expect(filtersClientSide("deleted")).toBe(true);
    expect(filtersClientSide("live")).toBe(false);
    expect(filtersClientSide("all")).toBe(false);
  });
});

describe("hasActiveFilters", () => {
  it("negeert sortering en lege zoektekst", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, sort: "name", q: "  " })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: "x" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, status: "live" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, palette: "p" })).toBe(true);
  });
});

describe("shouldLoadMore", () => {
  const base = { visible: 3, wanted: 24, hasNextPage: true, isFetching: false };

  it("laadt bij als er te weinig zichtbaar is en er nog een pagina is", () => {
    expect(shouldLoadMore(base)).toBe(true);
  });

  it("niet als er genoeg zijn, er geen pagina meer is of er al geladen wordt", () => {
    expect(shouldLoadMore({ ...base, visible: 24 })).toBe(false);
    expect(shouldLoadMore({ ...base, hasNextPage: false })).toBe(false);
    expect(shouldLoadMore({ ...base, isFetching: true })).toBe(false);
  });
});
