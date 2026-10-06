import type { ImportConflict } from "@/api/types";
import { openZip, ZIP_LIMITS, ZipError, type ZipErrorCode, type ZipLimits } from "./zip";

/**
 * Uploads op `/import`: `.css` (één thema, draft = inhoud), `.cssthema.zip` (bundel met alle
 * versies, docs/05 § 4.6) of `.js` (thema-script, gaat naar `POST /scripts` en niet naar de
 * thema-import). Een andere `.zip` zonder `manifest.json` pakt de browser eerst uit in losse
 * `.css`- en `.js`-bestanden (`unpackUpload`). De server controleert alles opnieuw; dit is
 * alleen om meteen te melden wat zeker niet gaat.
 */

export type UploadKind = "css" | "bundle" | "script" | "unsupported";

/** Maximale grootte van een bundel (vast in de backend). CSS-limiet: server (`CSS_MAX_BYTES`). */
export const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;

/** Maximale grootte van een script (vast in de backend, `MAX_SCRIPT_BYTES`). */
export const MAX_SCRIPT_BYTES = 512 * 1024;

export const ACCEPT =
  ".css,.zip,.js,text/css,application/zip,text/javascript,application/javascript";

export function uploadKind(name: string): UploadKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".zip")) return "bundle";
  if (lower.endsWith(".js")) return "script";
  return "unsupported";
}

/** Een thema-bestand (`.css` of bundel), dus voor `POST /themes/import`. */
export function isThemeFile(name: string): boolean {
  const kind = uploadKind(name);
  return kind === "css" || kind === "bundle";
}

export type UploadProblem = "type" | "empty" | "tooLarge" | "scriptTooLarge";

/** Wat er zeker mis is met een bestand vóór het uploaden, of `null`. */
export function uploadProblem(file: Pick<File, "name" | "size">): UploadProblem | null {
  const kind = uploadKind(file.name);
  if (kind === "unsupported") return "type";
  if (file.size === 0) return "empty";
  if (kind === "bundle" && file.size > MAX_BUNDLE_BYTES) return "tooLarge";
  if (kind === "script" && file.size > MAX_SCRIPT_BYTES) return "scriptTooLarge";
  return null;
}

/** Publiceren: `auto` = .css niet, bundel zoals in het manifest; `yes` / `no` voor allebei. */
export type PublishChoice = "auto" | "yes" | "no";

export function publishParam(choice: PublishChoice): boolean | undefined {
  return choice === "auto" ? undefined : choice === "yes";
}

export const CONFLICT_CHOICES: readonly ImportConflict[] = ["rename", "new_version", "fail"];

/** Zelfde naam, grootte en wijzigingsdatum = hetzelfde bestand. */
export function fileKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/** Bestanden zonder dubbels (zelfde naam, grootte en wijzigingsdatum). */
export function mergeFiles(current: readonly File[], added: Iterable<File>): File[] {
  const key = fileKey;
  const seen = new Set(current.map(key));
  const result = [...current];
  for (const file of added) {
    if (seen.has(key(file))) continue;
    seen.add(key(file));
    result.push(file);
  }
  return result;
}

/** Een `.zip` die geen `.cssthema.zip` heet: eerst kijken of het een bundel is of losse bestanden. */
export function needsUnpacking(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".zip") && !lower.endsWith(".cssthema.zip");
}

export type Unpacked =
  /** Een bundel (`manifest.json` in de root) of geen leesbare zip: zo naar de server sturen. */
  | { kind: "keep" }
  /** Losse `.css`/`.js`-bestanden; `skipped` = andere bestanden in de zip. */
  | { kind: "files"; files: File[]; skipped: string[] }
  /** Geen `.css` of `.js` en geen bundel. */
  | { kind: "empty"; skipped: string[] }
  | { kind: "error"; code: ZipErrorCode; entry?: string };

const MANIFEST = "manifest.json";

/** Mappen en bestanden die zip-programma's zelf toevoegen (macOS, verborgen bestanden). */
function ignoredPath(parts: readonly string[]): boolean {
  return parts[0] === "__MACOSX" || parts.some((part) => part.startsWith("."));
}

/**
 * Pakt een zip met losse `.css`- en `.js`-bestanden uit tot `File`-objecten (bestandsnaam zonder
 * map). Een bundel of een bestand dat geen zip is, blijft zoals het is; de server meldt dan wat
 * er mis is.
 */
export async function unpackUpload(file: File, limits: ZipLimits = ZIP_LIMITS): Promise<Unpacked> {
  if (file.size === 0 || file.size > MAX_BUNDLE_BYTES) return { kind: "keep" };
  try {
    const archive = openZip(await file.arrayBuffer(), limits);
    if (archive.entries.some((entry) => entry.name === MANIFEST)) return { kind: "keep" };
    const files: File[] = [];
    const skipped: string[] = [];
    for (const entry of archive.entries) {
      if (entry.directory) continue;
      const parts = entry.name.split("/");
      if (ignoredPath(parts)) continue;
      const base = parts[parts.length - 1] ?? "";
      const kind = uploadKind(base);
      if (kind !== "css" && kind !== "script") {
        skipped.push(entry.name);
        continue;
      }
      const data = await archive.read(entry);
      files.push(
        new File([data], base, {
          type: kind === "css" ? "text/css" : "text/javascript",
          lastModified: entry.lastModified || file.lastModified,
        }),
      );
    }
    return files.length ? { kind: "files", files, skipped } : { kind: "empty", skipped };
  } catch (error) {
    if (error instanceof ZipError) {
      return error.code === "notZip"
        ? { kind: "keep" }
        : { kind: "error", code: error.code, entry: error.entry };
    }
    return { kind: "error", code: "corrupt" };
  }
}
