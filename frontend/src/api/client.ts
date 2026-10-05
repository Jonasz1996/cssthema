import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import type { EtagState, LintIssue, Locked, Problem } from "./types";

/**
 * Typed client for the cssthema API. Paths in the OpenAPI schema already include `/api/v1`,
 * so the base URL is the site origin.
 *
 * The origin is absolute because openapi-fetch builds a `Request` before fetching, and
 * outside the browser (Vitest/jsdom on undici) a relative URL throws. `fetch` is resolved
 * per call so tests can stub `globalThis.fetch` after this module is imported.
 *
 * Gebruik in features bij voorkeur de hooks uit `src/api/queries/*`; die zetten fouten om in
 * `ApiError` en houden de cache bij. Rechtstreeks `api.GET(...)` kan, verpak het dan in `send()`.
 */
export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? "",
  credentials: "include",
  fetch: (request: Request) => globalThis.fetch(request),
});

// --- CSRF -------------------------------------------------------------------------------------

const CSRF_COOKIE = "cssthema_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/** Waarde van een cookie, of `null`. */
export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

/**
 * Stuurt bij muterende calls de CSRF-token uit cookie `cssthema_csrf` mee (docs/05 § 1).
 * Fase 1 heeft nog geen login en dus geen cookie: dan gebeurt er niets.
 */
const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (SAFE_METHODS.has(request.method.toUpperCase())) return undefined;
    const token = readCookie(CSRF_COOKIE);
    if (token && !request.headers.has(CSRF_HEADER)) request.headers.set(CSRF_HEADER, token);
    return undefined;
  },
};
api.use(csrfMiddleware);

// --- ETag / If-Match ("lv-<n>") ----------------------------------------------------------------

const LOCK_ETAG_RE = /^(?:W\/)?"lv-(\d{1,10})"$/;

/** `ETag`/`If-Match`-waarde voor een lock_version: `"lv-12"` (met aanhalingstekens). */
export function lockEtag(lockVersion: number): string {
  return `"lv-${lockVersion}"`;
}

/** Leest `"lv-12"` (ook zwak, `W/"lv-12"`, zoals nginx hem na compressie maakt) → `12`. */
export function parseLockEtag(value: string | null | undefined): number | null {
  const match = LOCK_ETAG_RE.exec(value?.trim() ?? "");
  return match ? Number(match[1]) : null;
}

/** Header-object voor `params.header` van muterende draft-/metadata-calls. */
export function ifMatch(lockVersion: number): { "If-Match": string } {
  return { "If-Match": lockEtag(lockVersion) };
}

/** Lock-toestand uit een response: eerst de `ETag`-header, anders `lock_version` uit de body. */
export function readLock(
  response: Response,
  data?: unknown,
): { etag: string; lockVersion: number } | null {
  const header = response.headers.get("ETag");
  const fromHeader = parseLockEtag(header);
  if (header && fromHeader !== null) return { etag: header.trim(), lockVersion: fromHeader };
  if (isRecord(data) && typeof data.lock_version === "number") {
    return { etag: lockEtag(data.lock_version), lockVersion: data.lock_version };
  }
  return null;
}

// --- Problem Details → ApiError ------------------------------------------------------------------

/** Foutcode van de client zelf: de server was niet bereikbaar (offline, DNS, CORS, …). */
export const NETWORK_ERROR = "network_error";
/** Foutcode van de client zelf: een antwoord zonder de verwachte `ETag`. */
export const MISSING_ETAG = "missing_etag";

/** Eén element van `errors[]` in een Problem (lint-melding of veldfout). */
export type ProblemErrorItem = Record<string, unknown>;

export interface ApiErrorInit {
  status: number;
  code: string;
  title: string;
  detail?: string | null;
  errors?: ProblemErrorItem[] | null;
  current?: EtagState | null;
  requestId?: string | null;
  problem?: Problem | null;
  cause?: unknown;
}

/**
 * Elke fout uit de API-laag (RFC 9457 Problem Details, docs/05 § 2). `status` 0 betekent: geen
 * antwoord (netwerk). Toon `message` (Nederlandse tekst van de server) of vertaal op `code`.
 */
export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly status: number;
  /** Bv. `precondition_failed`, `slug_conflict`, `theme_lint_failed`, `network_error`. */
  readonly code: string;
  readonly title: string;
  readonly detail: string | null;
  readonly errors: ProblemErrorItem[];
  /** Alleen bij 412: de huidige toestand op de server (`etag`, `lock_version`, `updated_by`). */
  readonly current: EtagState | null;
  readonly requestId: string | null;
  /** De ruwe Problem-body, als de server er een stuurde. */
  readonly problem: Problem | null;

  constructor(init: ApiErrorInit) {
    super(init.detail || init.title, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail ?? null;
    this.errors = init.errors ?? [];
    this.current = init.current ?? null;
    this.requestId = init.requestId ?? null;
    this.problem = init.problem ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** 412 `precondition_failed`: iemand anders heeft intussen gewijzigd; `current` is gevuld. */
export function isPreconditionFailed(
  error: unknown,
): error is ApiError & { status: 412; current: EtagState } {
  return isApiError(error) && error.status === 412 && error.current !== null;
}

/** Geen antwoord van de server (offline of verbinding verbroken). */
export function isNetworkError(error: unknown): error is ApiError {
  return isApiError(error) && error.code === NETWORK_ERROR;
}

/** Afgebroken via een `AbortSignal` (TanStack Query annuleert zo verouderde queries). */
export function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

/** Lint-fouten uit een 422 `theme_lint_failed` (publiceren of import geweigerd). */
export function lintIssuesOf(error: unknown): LintIssue[] {
  if (!isApiError(error)) return [];
  return error.errors.filter(isLintIssue);
}

/**
 * Veldfouten uit een 422 `validation_error`, per veld (`name`, `template.id`, …). Het eerste
 * deel van `loc` (`body`, `query`, `path`) valt weg.
 */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isApiError(error)) return result;
  for (const item of error.errors) {
    if (!Array.isArray(item.loc) || typeof item.msg !== "string") continue;
    const path = item.loc
      .filter((part, index) => !(index === 0 && ["body", "query", "path", "header"].includes(part)))
      .join(".");
    result[path || "_"] ??= item.msg;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLintIssue(item: ProblemErrorItem): item is ProblemErrorItem & LintIssue {
  return (
    typeof item.line === "number" &&
    typeof item.column === "number" &&
    typeof item.rule === "string" &&
    typeof item.severity === "string" &&
    typeof item.message === "string"
  );
}

function isProblem(body: unknown): body is Problem {
  return (
    isRecord(body) &&
    typeof body.code === "string" &&
    typeof body.title === "string" &&
    typeof body.status === "number"
  );
}

function parseEtagState(value: unknown): EtagState | null {
  if (!isRecord(value)) return null;
  if (typeof value.lock_version !== "number" || typeof value.updated_at !== "string") return null;
  return {
    etag: typeof value.etag === "string" ? value.etag : lockEtag(value.lock_version),
    lock_version: value.lock_version,
    updated_at: value.updated_at,
    updated_by: isRecord(value.updated_by) ? (value.updated_by as EtagState["updated_by"]) : null,
  };
}

/** Maakt een `ApiError` van een niet-2xx-response met (al geparste) body. */
export function apiErrorFrom(response: Response, body: unknown): ApiError {
  const requestId = response.headers.get("X-Request-ID");
  if (isProblem(body)) {
    return new ApiError({
      status: response.status,
      code: body.code,
      title: body.title,
      detail: body.detail,
      errors: Array.isArray(body.errors) ? body.errors.filter(isRecord) : [],
      current:
        response.status === 412 ? parseEtagState((body as { current?: unknown }).current) : null,
      requestId: body.request_id ?? requestId,
      problem: body,
    });
  }
  return new ApiError({
    status: response.status,
    code: `http_${response.status}`,
    title: response.statusText || `HTTP ${response.status}`,
    detail: plainTextDetail(response, body),
    requestId,
  });
}

/**
 * Body van een antwoord zonder Problem als `detail`, maar alleen platte tekst: een HTML-
 * foutpagina (nginx "502 Bad Gateway") is niet voor mensen bedoeld en hoort niet in een melding.
 */
function plainTextDetail(response: Response, body: unknown): string | null {
  if (typeof body !== "string" || !body.trim()) return null;
  const type = response.headers.get("Content-Type") ?? "";
  if (/html|xml/i.test(type) || /^\s*</.test(body)) return null;
  return body.trim().slice(0, 500);
}

/** Leest de body van een niet-2xx-response en maakt er een `ApiError` van. */
export async function readApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  } catch {
    // Body niet leesbaar: alleen de status telt.
  }
  return apiErrorFrom(response, body);
}

/** Zet een fout van `fetch` zelf om: afbreken blijft afbreken, de rest wordt `network_error`. */
export function toRequestError(error: unknown): unknown {
  if (isAbortError(error) || isApiError(error)) return error;
  return new ApiError({
    status: 0,
    code: NETWORK_ERROR,
    title: "Server niet bereikbaar",
    detail: error instanceof Error ? error.message : null,
    cause: error,
  });
}

// --- calls uitvoeren -------------------------------------------------------------------------------

interface ApiResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

export type ApiData<R extends ApiResult> = Exclude<R["data"], undefined>;

/**
 * Wacht op een openapi-fetch-call en geeft `data` + `response` terug; elke fout wordt een
 * `ApiError` (of blijft een `AbortError`).
 *
 * ```ts
 * const { data } = await send(api.GET("/api/v1/palettes", { signal }));
 * ```
 */
export async function send<R extends ApiResult>(
  request: Promise<R>,
): Promise<{ data: ApiData<R>; response: Response }> {
  let result: R;
  try {
    result = await request;
  } catch (error) {
    throw toRequestError(error);
  }
  if (!result.response.ok) throw apiErrorFrom(result.response, result.error);
  return { data: result.data as ApiData<R>, response: result.response };
}

/**
 * Zoals `send`, plus de nieuwe lock-toestand (`ETag: "lv-<n>"`, anders `lock_version` uit de
 * body). Zonder beide wordt `fallback` gevraagd (bv. het thema opnieuw ophalen).
 */
export async function sendLocked<R extends ApiResult>(
  request: Promise<R>,
  fallback?: () => Promise<number>,
): Promise<Locked<ApiData<R>>> {
  const { data, response } = await send(request);
  const lock = readLock(response, data);
  if (lock) return { data, ...lock };
  if (fallback) {
    const lockVersion = await fallback();
    return { data, etag: lockEtag(lockVersion), lockVersion };
  }
  throw new ApiError({
    status: response.status,
    code: MISSING_ETAG,
    title: "Antwoord zonder ETag",
    requestId: response.headers.get("X-Request-ID"),
  });
}

/**
 * Bij de standaard-`retry` van TanStack Query: alleen opnieuw proberen bij netwerk- en
 * serverfouten (max. 2 keer), nooit bij 4xx.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2 || !isApiError(error)) return false;
  return error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504;
}

// --- multipart ---------------------------------------------------------------------------------------

/** Bestand met een expliciete bestandsnaam (een gewone `Blob` heet anders "blob"). */
export interface NamedBlob {
  blob: Blob;
  filename: string;
}

export type MultipartValue = string | number | boolean | Blob | NamedBlob | null | undefined;

function isNamedBlob(value: unknown): value is NamedBlob {
  return isRecord(value) && value.blob instanceof Blob && typeof value.filename === "string";
}

/**
 * Bouwt `multipart/form-data`: `null`/`undefined` vallen weg, booleans worden `true`/`false`,
 * arrays geven meerdere velden met dezelfde naam. `File`s houden hun eigen naam.
 */
export function toFormData(fields: Record<string, MultipartValue | MultipartValue[]>): FormData {
  const form = new FormData();
  const append = (name: string, value: MultipartValue) => {
    if (value === null || value === undefined) return;
    if (isNamedBlob(value)) form.append(name, value.blob, value.filename);
    else if (value instanceof Blob) {
      form.append(name, value, value instanceof File ? value.name : "upload");
    } else form.append(name, String(value));
  };
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => append(name, item));
    else append(name, value);
  }
  return form;
}

/**
 * Body-opties voor een multipart-call met openapi-fetch. De browser zet zelf
 * `Content-Type: multipart/form-data; boundary=…`.
 *
 * ```ts
 * api.POST("/api/v1/themes/import", { ...multipart<ImportBody>({ file, on_conflict: "rename" }) })
 * ```
 */
export function multipart<B>(fields: Record<string, MultipartValue | MultipartValue[]>): {
  body: B;
  bodySerializer: () => FormData;
} {
  const form = toFormData(fields);
  return { body: fields as unknown as B, bodySerializer: () => form };
}

// --- downloads ---------------------------------------------------------------------------------------

export interface DownloadedFile {
  blob: Blob;
  filename: string;
  contentType: string;
}

/** Pad-scheidingstekens en stuurtekens worden `_`; `.`/`..`/leeg geeft `null`. */
function cleanFilename(value: string): string | null {
  let cleaned = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    cleaned += char === "/" || char === "\\" || code < 0x20 || code === 0x7f ? "_" : char;
  }
  cleaned = cleaned.trim();
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : null;
}

function asBlob(data: unknown, type: string): Blob {
  // Duck typing: in tests (jsdom + undici) is een Blob uit `response.blob()` geen `instanceof Blob`.
  if (isRecord(data) && typeof data.size === "number" && typeof data.arrayBuffer === "function") {
    return data as unknown as Blob;
  }
  return new Blob([typeof data === "string" ? data : JSON.stringify(data ?? "")], { type });
}

/**
 * Bestandsnaam uit `Content-Disposition` (RFC 6266): `filename*=UTF-8''…` gaat voor
 * `filename="…"`. Pad-tekens worden `_`.
 */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*"?([^";]+)"?/i.exec(header);
  if (extended?.[1]) {
    const match = /^[\w!#$%&+^`{}~.-]*'[^']*'(.*)$/.exec(extended[1].trim());
    if (match?.[1] !== undefined) {
      try {
        const name = cleanFilename(decodeURIComponent(match[1]));
        if (name) return name;
      } catch {
        // Ongeldige percent-codering: val terug op `filename=`.
      }
    }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(header);
  const raw = plain?.[1]?.replace(/\\(.)/g, "$1") ?? plain?.[2]?.trim();
  return raw ? cleanFilename(raw) : null;
}

/** Wacht op een openapi-fetch-call met `parseAs: "blob"` en leest de bestandsnaam. */
export async function sendDownload<R extends ApiResult>(
  request: Promise<R>,
  fallbackName: string,
): Promise<DownloadedFile> {
  const { data, response } = await send(request);
  const contentType = response.headers.get("Content-Type") ?? "application/octet-stream";
  return {
    blob: asBlob(data, contentType),
    filename:
      filenameFromContentDisposition(response.headers.get("Content-Disposition")) ?? fallbackName,
    contentType,
  };
}

/** Laat de browser een `Blob` opslaan onder `filename` (tijdelijke `<a download>`). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Firefox heeft de URL nog even nodig nadat de download gestart is.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

// --- health ------------------------------------------------------------------------------------------

export type HealthState = "ok" | "error";

/**
 * Health-endpoint antwoordde niet met 2xx. `checks` komt uit de body van `/readyz` (bv.
 * `{ database: "ok", redis: "error" }`), zodat de UI kan tonen wát er stuk is.
 */
export class HealthError extends Error {
  override readonly name = "HealthError";
  constructor(
    readonly path: string,
    readonly status: number,
    readonly checks: Readonly<Record<string, HealthState>>,
  ) {
    super(`${path} responded ${status}`);
  }
}

/**
 * Probe an unversioned health endpoint (`/healthz`, `/readyz`). Throws `HealthError` on non-2xx
 * (with the per-check result when the body has one); a network failure throws as `fetch` does.
 */
export async function fetchHealth(path: "/healthz" | "/readyz"): Promise<HealthState> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (res.ok) return "ok";
  const checks: Record<string, HealthState> = {};
  try {
    const body: unknown = await res.json();
    if (isRecord(body) && isRecord(body.checks)) {
      for (const [name, value] of Object.entries(body.checks)) {
        if (value === "ok" || value === "error") checks[name] = value;
      }
    }
  } catch {
    // Geen JSON (proxy-foutpagina): alleen de status telt.
  }
  throw new HealthError(path, res.status, checks);
}
