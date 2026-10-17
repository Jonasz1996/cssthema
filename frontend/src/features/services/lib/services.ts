import type { ServiceSummary, SnapshotSummary } from "@/api/types";
import type { TagTone } from "@/components/ui";
import type { ErrorKeys } from "@/features/themes/lib/errors";
import type { MessageKey } from "@/lib/i18n";

/** Engelse teksten voor de foutcodes van dit scherm (in het Nederlands: de servertekst). */
export const SERVICE_ERROR_KEYS: ErrorKeys = {
  validation_error: "services.errorInvalidZip",
  not_found: "services.errorNotFound",
};

/** Zelfde grens als de backend (`capture_max_bytes`) en nginx (`client_max_body_size 25m`). */
export const CAPTURE_MAX_BYTES = 25 * 1024 * 1024;

export const CAPTURE_ACCEPT = ".zip,application/zip,application/x-zip-compressed";

// --- filteren -------------------------------------------------------------------------------

export const SNAPSHOT_FILTERS = ["all", "with", "without"] as const;
export type SnapshotFilter = (typeof SNAPSHOT_FILTERS)[number];

/** Of de dienst een vastgelegde pagina heeft om tegen te previewen (`snapshot.html`). */
export function hasDocument(service: ServiceSummary): boolean {
  return service.snapshots.some((snapshot) => snapshot.has_document);
}

/**
 * Filtert op naam en hostnaam (hoofdletterongevoelig) en op "met/zonder snapshot". Zonder
 * snapshot = geen enkele pagina met een `snapshot.html` (alleen status en screenshots).
 */
export function filterServices(
  services: readonly ServiceSummary[],
  query: string,
  filter: SnapshotFilter,
): ServiceSummary[] {
  const q = query.trim().toLowerCase();
  return services.filter((service) => {
    if (filter === "with" && !hasDocument(service)) return false;
    if (filter === "without" && hasDocument(service)) return false;
    if (!q) return true;
    return [service.name, service.hostname].some((text) => text.toLowerCase().includes(q));
  });
}

// --- status ---------------------------------------------------------------------------------

/**
 * Kleur van de status uit `vastleggen.py`: `ok` groen; een serverfout (`http-5xx`) of `fout`
 * rood; een andere HTTP-fout oranje; een loginscherm (`inlogpagina`, `authentik-login`),
 * `geen-html` en onbekende waarden neutraal grijs.
 */
export function statusTone(status: string | null | undefined): TagTone {
  if (!status) return "default";
  if (status === "ok") return "ok";
  if (status === "fout" || /^http-5\d\d$/.test(status)) return "err";
  if (/^http-\d+$/.test(status)) return "mid";
  return "default";
}

/**
 * Label van een status: vertaald voor de bekende waarden, anders de waarde zelf (`http-502`
 * blijft `http-502`, zoals in `overzicht.html` van vastleggen.py).
 */
export function statusLabelKey(status: string | null | undefined): MessageKey | null {
  if (!status) return "services.statusNone";
  return STATUS_LABELS[status] ?? null;
}

/** Uitleg bij een status (tooltip); `null` voor onbekende waarden. */
export function statusHintKey(status: string | null | undefined): MessageKey | null {
  if (!status) return null;
  if (/^http-\d+$/.test(status)) return "services.statusHintHttp";
  return STATUS_HINTS[status] ?? null;
}

const STATUS_LABELS: Readonly<Partial<Record<string, MessageKey>>> = {
  ok: "services.statusOk",
  inlogpagina: "services.statusLogin",
  "authentik-login": "services.statusAuthentik",
  "geen-html": "services.statusNotHtml",
  fout: "services.statusError",
};

const STATUS_HINTS: Readonly<Partial<Record<string, MessageKey>>> = {
  ok: "services.statusHintOk",
  inlogpagina: "services.statusHintLogin",
  "authentik-login": "services.statusHintAuthentik",
  "geen-html": "services.statusHintNotHtml",
  fout: "services.statusHintError",
};

// --- screenshots ----------------------------------------------------------------------------

export const SCREENSHOT_KINDS = ["origineel", "met_thema", "mobiel"] as const;
export type ScreenshotKind = (typeof SCREENSHOT_KINDS)[number];

export const SCREENSHOT_LABELS: Record<ScreenshotKind, MessageKey> = {
  origineel: "services.shotOriginal",
  met_thema: "services.shotThemed",
  mobiel: "services.shotMobile",
};

/** De screenshots die er zijn, in vaste volgorde (origineel, met thema, mobiel). */
export function screenshotsOf(snapshot: SnapshotSummary | undefined): ScreenshotKind[] {
  if (!snapshot) return [];
  return SCREENSHOT_KINDS.filter((kind) => Boolean(snapshot.screenshots[kind]));
}

/** Tijd van de opname, of anders van de import (oude zips hebben geen `vastgelegd`). */
export function snapshotTime(snapshot: SnapshotSummary): { iso: string; captured: boolean } {
  return snapshot.captured_at
    ? { iso: snapshot.captured_at, captured: true }
    : { iso: snapshot.imported_at, captured: false };
}

/** Alleen `http(s)`-URL's als link (de URL komt uit een zip, niet van de gebruiker zelf). */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// --- uploaden -------------------------------------------------------------------------------

export type CaptureProblem = "type" | "empty" | "tooLarge";

/** Wat er vóór het uploaden al mis is met een bestand (dat dan niet verstuurd wordt). */
export function captureProblem(file: File): CaptureProblem | null {
  if (!file.name.toLowerCase().endsWith(".zip")) return "type";
  if (file.size === 0) return "empty";
  if (file.size > CAPTURE_MAX_BYTES) return "tooLarge";
  return null;
}

/** Sleutel om hetzelfde bestand niet twee keer in de lijst te zetten. */
export function captureFileKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}
