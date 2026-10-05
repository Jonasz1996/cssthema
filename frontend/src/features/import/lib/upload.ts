import type { ImportConflict } from "@/api/types";

/**
 * Uploads op `/import`: `.css` (één thema, draft = inhoud) of `.cssthema.zip` (bundel met alle
 * versies, docs/05 § 4.6). De server controleert alles opnieuw; dit is alleen om meteen te
 * melden wat zeker niet gaat.
 */

export type UploadKind = "css" | "bundle" | "unsupported";

/** Maximale grootte van een bundel (vast in de backend). CSS-limiet: server (`CSS_MAX_BYTES`). */
export const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;

export const ACCEPT = ".css,.zip,text/css,application/zip";

export function uploadKind(name: string): UploadKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".zip")) return "bundle";
  return "unsupported";
}

export type UploadProblem = "type" | "empty" | "tooLarge";

/** Wat er zeker mis is met een bestand vóór het uploaden, of `null`. */
export function uploadProblem(file: Pick<File, "name" | "size">): UploadProblem | null {
  const kind = uploadKind(file.name);
  if (kind === "unsupported") return "type";
  if (file.size === 0) return "empty";
  if (kind === "bundle" && file.size > MAX_BUNDLE_BYTES) return "tooLarge";
  return null;
}

/** Publiceren: `auto` = .css niet, bundel zoals in het manifest; `yes` / `no` voor allebei. */
export type PublishChoice = "auto" | "yes" | "no";

export function publishParam(choice: PublishChoice): boolean | undefined {
  return choice === "auto" ? undefined : choice === "yes";
}

export const CONFLICT_CHOICES: readonly ImportConflict[] = ["rename", "new_version", "fail"];

/** Bestanden zonder dubbels (zelfde naam, grootte en wijzigingsdatum). */
export function mergeFiles(current: readonly File[], added: Iterable<File>): File[] {
  const key = (file: File) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
  const seen = new Set(current.map(key));
  const result = [...current];
  for (const file of added) {
    if (seen.has(key(file))) continue;
    seen.add(key(file));
    result.push(file);
  }
  return result;
}
