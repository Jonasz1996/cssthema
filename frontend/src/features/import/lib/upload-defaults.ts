import type { ImportConflict } from "@/api/types";
import { slugify } from "@/features/themes/lib/slug";
import { type PublishChoice, uploadKind } from "./upload";

/**
 * Standaardkeuzes van de tab Uploaden (review THM-2, FEAT-9). Thema's die er al zijn (de naam
 * van het bestand is een bestaande slug) en een uitgepakte zip met losse `.css`-bestanden (zoals
 * `themes/` uit de repo) horen een nieuwe versie te worden die meteen live gaat: met "nieuw
 * thema" en "alleen draft" kwam er een kopie `alg-kern-2` als draft, en kregen de hosts niets.
 * Zelf gekozen waarden gaan altijd voor; een bundel houdt de gewone standaard (zijn manifest).
 */

export type UploadDefaultsReason = "zip" | "existing";

export interface UploadDefaults {
  conflict: ImportConflict;
  publish: PublishChoice;
  /** Waarom de keuzes afwijken van de gewone standaard, of `null`. */
  reason: UploadDefaultsReason | null;
  /** Zoveel `.css`-bestanden hebben de naam van een bestaand thema. */
  existing: number;
}

export const PLAIN_DEFAULTS = { conflict: "rename", publish: "auto" } as const;
export const UPDATE_DEFAULTS = { conflict: "new_version", publish: "yes" } as const;

/** De slug die de server van een bestandsnaam maakt (zonder `.css`). */
export function slugOfFile(name: string): string {
  return slugify(name.replace(/\.css$/i, ""));
}

export function uploadDefaults(
  files: readonly File[],
  {
    unpacked,
    slugs,
  }: {
    /** Kwam het bestand uit een zip die de browser uitpakte? */
    unpacked: (file: File) => boolean;
    /** Slugs van de bestaande thema's (`null` = nog niet bekend). */
    slugs: ReadonlySet<string> | null;
  },
): UploadDefaults {
  const css = files.filter((file) => uploadKind(file.name) === "css");
  const exists = (file: File) => slugs?.has(slugOfFile(file.name)) ?? false;
  const existing = css.filter(exists).length;
  const bundle = files.some((file) => uploadKind(file.name) === "bundle");
  const known = css.length > 0 && css.every((file) => unpacked(file) || exists(file));
  if (bundle || !known) return { ...PLAIN_DEFAULTS, reason: null, existing };
  return {
    ...UPDATE_DEFAULTS,
    reason: css.some(unpacked) ? "zip" : "existing",
    existing,
  };
}
