import { fieldErrorsOf, isApiError } from "@/api/client";
import { DEFAULT_HOST } from "@/api/queries/hosts";
import type {
  HostBinding,
  HostBindingInput,
  HostBulkRequest,
  HostHealth,
  HostHealthLevel,
} from "@/api/types";
import type { ErrorKeys } from "@/features/themes/lib/errors";
import type { MessageKey } from "@/lib/i18n";

/** Engelse teksten voor de foutcodes van dit scherm (in het Nederlands: de servertekst). */
export const HOST_ERROR_KEYS: ErrorKeys = {
  host_conflict: "hosts.errorHostConflict",
  not_found: "hosts.errorNotFound",
};

/** Zelfde grenzen als de backend (`domain/hosts.py`). */
export const MAX_STYLES = 20;
export const MAX_SCRIPTS = 10;

export function isDefaultHost(hostname: string): boolean {
  return hostname === DEFAULT_HOST;
}

/** De body voor `PUT` uit een bestaande koppeling (bv. om alleen `enabled` te wisselen). */
export function toInput(host: HostBinding): HostBindingInput {
  return {
    hostname: host.hostname,
    styles: [...(host.styles ?? [])],
    scripts: [...(host.scripts ?? [])],
    enabled: host.enabled,
    note: host.note ?? null,
  };
}

/** Filtert op hostnaam en notitie (hoofdletterongevoelig); `standaard`/`*` vindt `*`. */
export function filterHosts(
  hosts: readonly HostBinding[],
  query: string,
  defaultLabel: string,
): HostBinding[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...hosts];
  return hosts.filter((host) => {
    const label = isDefaultHost(host.hostname) ? defaultLabel : host.hostname;
    return [host.hostname, label, host.note ?? ""].some((text) => text.toLowerCase().includes(q));
  });
}

/** Schuift één element een plaats op (`-1`) of neer (`1`) in een geordende lijst. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export type HostField = "hostname" | "styles" | "scripts" | "note";
export type HostFormErrors = Partial<Record<HostField | "general", string>>;

/**
 * Fouten van de server per veld: 409 `host_conflict` hoort bij de hostnaam, 422-veldfouten
 * (`styles.2` → `styles`) bij hun veld; de rest is algemeen.
 */
export function hostFormErrors(error: unknown, text: string): HostFormErrors {
  if (isApiError(error) && error.code === "host_conflict") return { hostname: text };
  const result: HostFormErrors = {};
  for (const [path, message] of Object.entries(fieldErrorsOf(error))) {
    const field = path.split(".")[0] as HostField;
    if (["hostname", "styles", "scripts", "note"].includes(field)) result[field] ??= message;
    else result.general ??= message;
  }
  return Object.keys(result).length ? result : { general: text };
}

// --- gezondheid -----------------------------------------------------------------------------

/** Kleur van het bolletje per niveau (zelfde statuskleuren als de rest van de app). */
export const LEVEL_DOT: Record<HostHealthLevel, string> = {
  ok: "text-ok",
  warn: "text-mid",
  error: "text-err",
  unknown: "text-dim",
};

const LEVEL_KEYS: Record<HostHealthLevel, MessageKey> = {
  ok: "hosts.levelOk",
  warn: "hosts.levelWarn",
  error: "hosts.levelError",
  unknown: "hosts.levelUnknown",
};

/** Korte label per code van de controle (`HostCheck.code`). */
export const CHECK_CODE_KEYS: Readonly<Partial<Record<string, MessageKey>>> = {
  rule_active: "hosts.checkRuleActive",
  old_rule: "hosts.checkOldRule",
  no_rule: "hosts.checkNoRule",
  csp_blocked: "hosts.checkCspBlocked",
  login: "hosts.checkLogin",
  not_html: "hosts.checkNotHtml",
  http_error: "hosts.checkHttpError",
  unreachable: "hosts.checkUnreachable",
};

/**
 * Sleutel van de korte statustekst: de code van de controle als die er is (en bekend is),
 * anders het niveau. Zonder controle maar met ontbrekende onderdelen: "Onderdeel ontbreekt".
 */
export function healthLabelKey(health: HostHealth): MessageKey {
  if (health.excluded) return "hosts.statusExcluded";
  // Achter login (of niet gecontroleerd) en nooit geladen: dat laatste zegt het meest.
  if (health.stale && (!health.check || health.check.code === "login")) return "hosts.levelStale";
  if (health.check) return CHECK_CODE_KEYS[health.check.code] ?? LEVEL_KEYS[health.check.level];
  if (health.missing_styles.length || health.missing_scripts.length) return "hosts.levelMissing";
  return LEVEL_KEYS[health.level];
}

/** Ontbrekende thema's en scripts in één lijst; scripts met `.js` erachter. */
export function missingParts(health: HostHealth): string[] {
  return [...health.missing_styles, ...health.missing_scripts.map((name) => `${name}.js`)];
}

/** Hosts die de regel laadden maar geen eigen koppeling hebben (zonder `*`). */
export function unboundHosts(hosts: readonly HostHealth[] | undefined): HostHealth[] {
  return (hosts ?? []).filter((host) => !host.bound && !isDefaultHost(host.hostname));
}

export interface HealthSummary {
  ok: number;
  login: number;
  warn: number;
  error: number;
  unchecked: number;
}

/**
 * Telling voor de regel boven de lijst: hoeveel hosts in orde zijn, achter login zitten, een
 * waarschuwing of een fout hebben. Telt hosts die iets krijgen en gecontroleerd worden: eigen
 * koppelingen (aan, niet uitgesloten, zonder `*`) en diensten die `*` volgen; geen namen die
 * alleen in "laatst geladen" staan.
 */
export function healthSummary(hosts: readonly HostHealth[] | undefined): HealthSummary {
  const summary: HealthSummary = { ok: 0, login: 0, warn: 0, error: 0, unchecked: 0 };
  for (const host of hosts ?? []) {
    if (isDefaultHost(host.hostname) || host.excluded || !host.enabled) continue;
    if (!host.bound && !host.service) continue;
    if (host.level === "ok") summary.ok += 1;
    else if (host.level === "warn") summary.warn += 1;
    else if (host.level === "error") summary.error += 1;
    else if (host.check?.code === "login") summary.login += 1;
    else summary.unchecked += 1;
  }
  return summary;
}

export type BulkChoice =
  | "add-styles"
  | "remove-styles"
  | "replace-styles"
  | "add-scripts"
  | "remove-scripts"
  | "replace-scripts"
  | "enable"
  | "disable";

export const BULK_CHOICES: readonly { value: BulkChoice; label: MessageKey }[] = [
  { value: "add-styles", label: "hosts.bulkAddStyle" },
  { value: "remove-styles", label: "hosts.bulkRemoveStyle" },
  { value: "replace-styles", label: "hosts.bulkReplaceStyle" },
  { value: "add-scripts", label: "hosts.bulkAddScript" },
  { value: "remove-scripts", label: "hosts.bulkRemoveScript" },
  { value: "replace-scripts", label: "hosts.bulkReplaceScript" },
  { value: "enable", label: "hosts.bulkEnable" },
  { value: "disable", label: "hosts.bulkDisable" },
];

/** De body van `POST /hosts/bulk` voor een keuze uit de dialoog; `hostnames` null = alle. */
export function bulkRequest(
  choice: BulkChoice,
  hostnames: readonly string[] | null,
  name: string,
  replacement: string,
): HostBulkRequest {
  const list = hostnames ? [...hostnames] : null;
  if (choice === "enable" || choice === "disable") {
    return { hostnames: list, action: choice, kind: "styles" };
  }
  const [action, kind] = choice.split("-") as ["add" | "remove" | "replace", "styles" | "scripts"];
  return {
    hostnames: list,
    action,
    kind,
    name: name.trim(),
    replacement: action === "replace" ? replacement.trim() : null,
  };
}
