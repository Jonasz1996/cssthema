import { isApiError } from "@/api/client";
import type { ErrorKeys } from "@/features/themes/lib/errors";

/**
 * Thema-scripts (`.js` in de css-files-map, publiek op `/<naam>.js`). De naamregels volgen
 * `backend/src/cssthema/services/script_files.py` (`normalize_name`, `script_name`), zodat de
 * UI vóór het uploaden kan tonen op welke URL een bestand terechtkomt. De server blijft de bron
 * van waarheid (422 `invalid_script_name`).
 */

export const SCRIPT_SUFFIX = ".js";
export const SCRIPT_NAME_MIN = 2;
export const SCRIPT_NAME_MAX = 64;
/** nginx serveert `/preview-bridge.js` zelf (een bestand van het dashboard). */
export const RESERVED_SCRIPT_NAMES: ReadonlySet<string> = new Set(["preview-bridge"]);
/** Archiefmap naast de scripts (niet publiek): vorige versies en verwijderde scripts. */
export const SCRIPT_ARCHIVE_DIR = ".scripts-archief";

export type ScriptNameIssue = "empty" | "path" | "length" | "reserved";

export type ScriptTarget =
  { name: string; issue: null } | { name: string | null; issue: ScriptNameIssue };

/**
 * `Netwerk Achtergrond` → `netwerk-achtergrond`: accenten weg (NFKD + alleen ASCII), kleine
 * letters, alles buiten a-z0-9 wordt één streepje. Geen inkorten en geen standaardnaam: wat
 * niet past, krijgt een `issue` (zelfde volgorde als de server).
 */
export function normalizeScriptName(raw: string): ScriptTarget {
  const value = raw.trim();
  if (!value) return { name: null, issue: "empty" };
  if (value.includes("/") || value.includes("\\") || value.startsWith(".")) {
    return { name: null, issue: "path" };
  }
  const ascii = value.normalize("NFKD").replace(/[\u0080-\uffff]/g, "");
  const name = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (name.length < SCRIPT_NAME_MIN || name.length > SCRIPT_NAME_MAX) {
    return { name: name || null, issue: "length" };
  }
  if (RESERVED_SCRIPT_NAMES.has(name)) return { name, issue: "reserved" };
  return { name, issue: null };
}

/** Zonder `.js` op het einde (hoofdletters maken niet uit). */
function stripSuffix(value: string): string {
  return value.toLowerCase().endsWith(SCRIPT_SUFFIX)
    ? value.slice(0, -SCRIPT_SUFFIX.length)
    : value;
}

/**
 * De naam waaronder een upload terechtkomt: uit het naamveld als dat ingevuld is, anders uit
 * de bestandsnaam (zonder map en zonder `.js`).
 */
export function scriptTarget(filename: string, name?: string | null): ScriptTarget {
  if (name?.trim()) return normalizeScriptName(stripSuffix(name.trim()));
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? "";
  return normalizeScriptName(stripSuffix(base));
}

/** Bestandsnaam als één woord in een shell-commando: `'Klok Widget.js'` als het moet. */
export function shellWord(value: string): string {
  if (/^[\w.@%+=:,/-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Eerste 12 tekens van een SHA-256, zoals `git log --oneline` (genoeg om versies te herkennen). */
export function shortHash(sha256: string | null | undefined): string | null {
  return sha256 ? sha256.slice(0, 12) : null;
}

/** Engelse teksten voor de foutcodes van `/api/v1/scripts` (Nederlands: de tekst van de server). */
export const SCRIPT_ERROR_KEYS: ErrorKeys = {
  script_conflict: "import.scriptErrorConflict",
  state_conflict: "import.scriptErrorStateConflict",
  invalid_script_name: "import.scriptErrorName",
  unsupported_media_type: "import.scriptErrorType",
  payload_too_large: "import.scriptErrorTooLarge",
  validation_error: "import.scriptErrorContent",
  not_found: "import.scriptErrorNotFound",
  storage_unavailable: "import.scriptErrorStorage",
  storage_error: "import.scriptErrorStorageWrite",
};

/** 409 `script_conflict`: de naam bestaat al en er is niet om vervangen gevraagd. */
export function isScriptConflict(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.code === "script_conflict";
}

/** De (genormaliseerde) naam die de server in een Problem meestuurt, of `null`. */
export function problemScriptName(error: unknown): string | null {
  if (!isApiError(error) || !error.problem) return null;
  const name = (error.problem as { name?: unknown }).name;
  return typeof name === "string" && name ? name : null;
}

/** `https://css.example/algemeen.js` + `nord` → `https://css.example/nord.css`. */
export function siblingCssUrl(scriptUrl: string, themeSlug: string): string {
  const base = scriptUrl.replace(/\/[^/]*$/, "");
  return `${base}/${themeSlug}.css`;
}

export interface SnippetInput {
  /** Publieke URL van het thema (`https://…/algemeen.css`), of `null` voor alleen het script. */
  cssUrl: string | null;
  /** Publieke URL van het script (`https://…/algemeen.js`). */
  scriptUrl: string;
  /**
   * Commentaarregels (in de taal van de UI): bovenaan, over de Access List van NPM (die geldt
   * in deze location niet meer) en bij de websocket-regels.
   */
  comments: { head: string; accessList: string; websockets: string };
}

/** Enkele aanhalingstekens in een `sub_filter`-argument (nginx) ontsnappen. */
function nginxQuote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * Snippet voor het tabblad *Advanced* van een proxy host in Nginx Proxy Manager: een eigen
 * `location /` die het thema (`<link>`) en het script (`<script defer>`) vóór `</head>` zet.
 * Zoals docs/10 § 2.2 en spike S1: `Accept-Encoding ""` is verplicht (anders ziet `sub_filter`
 * alleen gecomprimeerde HTML), de websocket-headers en NPM's `proxy.conf` blijven erin omdat
 * deze location die van NPM vervangt. Daarmee vervalt ook de Access List van de proxy host
 * (NPM zet `_access.conf` alleen in zijn eigen `location /`): de commentaarregel zegt dat.
 */
export function injectionSnippet({ cssUrl, scriptUrl, comments }: SnippetInput): string {
  const tags = [
    cssUrl ? `<link rel="stylesheet" href="${cssUrl}">` : null,
    `<script src="${scriptUrl}" defer></script>`,
    "</head>",
  ]
    .filter(Boolean)
    .join("");
  return [
    `# ${comments.head}`,
    "location / {",
    `    # ${comments.accessList}`,
    '    proxy_set_header Accept-Encoding "";',
    `    sub_filter '</head>' ${nginxQuote(tags)};`,
    "    sub_filter_once on;",
    "",
    `    # ${comments.websockets}`,
    "    proxy_http_version 1.1;",
    "    proxy_set_header Upgrade $http_upgrade;",
    "    proxy_set_header Connection $http_connection;",
    "",
    "    include conf.d/include/proxy.conf;",
    "}",
    "",
  ].join("\n");
}
