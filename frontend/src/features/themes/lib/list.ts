/**
 * Een lijst uit API-data, of een lege lijst zolang er (nog) niets geldigs is. Zo kan een scherm
 * renderen tijdens het laden, na een fout of bij een onverwacht antwoord zonder te crashen.
 */
export function listOf<T>(value: readonly T[] | null | undefined): T[] {
  return Array.isArray(value) ? (value as T[]).filter((item) => item != null) : [];
}

/** Een getal uit API-data, of `null` (dan toont de UI "—"). */
export function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
