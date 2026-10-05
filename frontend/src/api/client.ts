import createClient from "openapi-fetch";
import type { paths } from "./schema";

/**
 * Typed client for the cssthema API. Paths in the OpenAPI schema already include `/api/v1`,
 * so the base URL is the site root. CSRF + error middleware follow in phase 1.
 */
export const api = createClient<paths>({
  baseUrl: "",
  credentials: "include",
});

export type HealthState = "ok" | "error";

/** Probe an unversioned health endpoint (`/healthz`, `/readyz`). Throws on non-2xx. */
export async function fetchHealth(path: "/healthz" | "/readyz"): Promise<HealthState> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return "ok";
}
