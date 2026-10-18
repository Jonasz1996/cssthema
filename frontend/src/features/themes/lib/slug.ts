/**
 * Slugs zoals de backend ze maakt en controleert (`backend/src/cssthema/domain/css/slugs.py`),
 * zodat de dialoog "Nieuw thema" live een voorstel en een foutmelding kan tonen. De server
 * blijft de bron van waarheid (409 `slug_conflict`, 422 `invalid_slug`).
 */

export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 64;
export const FALLBACK_SLUG = "thema";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

/** Woorden die botsen met routes van cssthema zelf (zelfde lijst als de backend). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "themes",
  "assets",
  "healthz",
  "readyz",
  "metrics",
  "nginx-health",
  "preview-bridge",
  "index",
  "favicon",
  "robots",
  "static",
  "admin",
  "editor",
  "login",
  "logout",
  "import",
  "discovery",
  "ai",
  "palettes",
  "jobs",
  "settings",
  "services",
  "dashboard",
  "cssthema",
]);

/**
 * `Proxmox (Nord)` → `proxmox-nord`: accenten weg (NFKD + alleen ASCII), kleine letters, alles
 * wat geen letter of cijfer is wordt één streepje, hoogstens 64 tekens. Korter dan 2 tekens
 * wordt `thema`. Het resultaat kan nog gereserveerd zijn; `slugIssue` controleert dat.
 */
export function slugify(name: string): string {
  const ascii = name.normalize("NFKD").replace(/[\u0080-\uffff]/g, "");
  let slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  slug = slug.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, "");
  return slug.length < SLUG_MIN_LENGTH ? FALLBACK_SLUG : slug;
}

/** Voorstel voor een (nog lege) naam: leeg blijft leeg, zodat er geen `thema` verschijnt. */
export function suggestSlug(name: string): string {
  return name.trim() ? slugify(name) : "";
}

export type SlugIssue = "short" | "long" | "format" | "reserved";

/** Waarom een slug niet bruikbaar is, of `null` als hij in orde is (zelfde volgorde als de server). */
export function slugIssue(slug: string): SlugIssue | null {
  if (slug.length < SLUG_MIN_LENGTH) return "short";
  if (slug.length > SLUG_MAX_LENGTH) return "long";
  if (!SLUG_RE.test(slug)) return "format";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}
