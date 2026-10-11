import { fieldErrorsOf, isApiError } from "@/api/client";
import { DEFAULT_HOST } from "@/api/queries/hosts";
import type { HostBinding, HostBindingInput } from "@/api/types";
import type { ErrorKeys } from "@/features/themes/lib/errors";

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
