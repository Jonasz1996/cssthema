import type { VersionSummary } from "@/api/types";

/**
 * Welke twee kanten de versiepagina vergelijkt. `null` als linkerkant = leeg (eerste versie).
 * URL: `?from=<n|live|draft>&to=<n|live|draft>`.
 */
export type CompareRef = number | "draft";

export interface Comparison {
  from: CompareRef | null;
  to: CompareRef;
}

/** `"7"` → 7, `"draft"` → draft, `"live"` → het live versienummer; anders `undefined`. */
export function parseCompareRef(
  value: string | null,
  liveVersion: number | null,
): CompareRef | undefined {
  if (value === null) return undefined;
  if (value === "draft") return "draft";
  if (value === "live") return liveVersion ?? undefined;
  if (/^\d{1,9}$/.test(value)) {
    const n = Number(value);
    return n >= 1 ? n : undefined;
  }
  return undefined;
}

/** Standaard linkerkant voor een gekozen rechterkant: de vorige versie, of live voor de draft. */
export function defaultFrom(
  to: CompareRef,
  { liveVersion, latestVersion }: { liveVersion: number | null; latestVersion: number },
): CompareRef | null {
  if (to === "draft") return liveVersion ?? (latestVersion > 0 ? latestVersion : null);
  return to > 1 ? to - 1 : null;
}

/**
 * Vergelijking uit de URL, met redelijke standaarden: zonder `to` de live versie (of de
 * nieuwste, of de draft als er nog geen versies zijn).
 */
export function resolveComparison(
  params: { from: string | null; to: string | null },
  { liveVersion, latestVersion }: { liveVersion: number | null; latestVersion: number },
): Comparison {
  const fallbackTo: CompareRef = liveVersion ?? (latestVersion > 0 ? latestVersion : "draft");
  const to = parseCompareRef(params.to, liveVersion) ?? fallbackTo;
  const from =
    params.from === "empty"
      ? null
      : (parseCompareRef(params.from, liveVersion) ??
        defaultFrom(to, { liveVersion, latestVersion }));
  return { from: from === to ? null : from, to };
}

/** Querystring voor een vergelijking (`from=empty` voor een lege linkerkant). */
export function comparisonSearch({ from, to }: Comparison): string {
  const params = new URLSearchParams();
  params.set("from", from === null ? "empty" : String(from));
  params.set("to", String(to));
  return `?${params.toString()}`;
}

/** Label voor een kant: `v7`, `draft`, of leeg. */
export function refLabel(ref: CompareRef | null, draftLabel: string, emptyLabel: string): string {
  if (ref === null) return emptyLabel;
  return ref === "draft" ? draftLabel : `v${ref}`;
}

/** De live versie in een lijst samenvattingen (of `null`). */
export function liveVersionOf(versions: readonly VersionSummary[]): VersionSummary | null {
  return versions.find((version) => version.is_live) ?? null;
}
