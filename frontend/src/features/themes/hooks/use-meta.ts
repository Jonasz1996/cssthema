import { useQuery } from "@tanstack/react-query";
import { api, send, shouldRetry, type ApiError } from "@/api/client";
import type { components } from "@/api/schema";

export type MetaInfo = components["schemas"]["MetaInfo"];

/** Gegevens van de installatie (`GET /api/v1/meta`), o.a. `public_base_url` voor live-URL's. */
export function useMeta() {
  return useQuery<MetaInfo, ApiError>({
    queryKey: ["meta"],
    queryFn: async ({ signal }) => (await send(api.GET("/api/v1/meta", { signal }))).data,
    staleTime: Infinity,
    retry: shouldRetry,
  });
}

/** `https://css.example/` + `proxmox` → `https://css.example/proxmox.css`. */
export function publicCssUrl(base: string | null | undefined, slug: string): string | null {
  if (typeof base !== "string" || !base || !slug) return null;
  return `${base.replace(/\/+$/, "")}/${slug}.css`;
}
