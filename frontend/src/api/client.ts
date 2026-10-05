import createClient from "openapi-fetch";
import type { paths } from "./schema";

/**
 * Typed client for the cssthema API. Paths in the OpenAPI schema already include `/api/v1`,
 * so the base URL is the site origin. CSRF + error middleware follow in phase 1.
 *
 * The origin is absolute because openapi-fetch builds a `Request` before fetching, and
 * outside the browser (Vitest/jsdom on undici) a relative URL throws. `fetch` is resolved
 * per call so tests can stub `globalThis.fetch` after this module is imported.
 */
export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? "",
  credentials: "include",
  fetch: (request: Request) => globalThis.fetch(request),
});

export type HealthState = "ok" | "error";

/** Probe an unversioned health endpoint (`/healthz`, `/readyz`). Throws on non-2xx. */
export async function fetchHealth(path: "/healthz" | "/readyz"): Promise<HealthState> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return "ok";
}
