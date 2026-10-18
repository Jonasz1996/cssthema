import { queryOptions, useQuery } from "@tanstack/react-query";
import { api, send, shouldRetry, type ApiError } from "../client";
import type { Dashboard } from "../types";
import { dashboardKeys } from "./keys";
import type { QueryHookOptions } from "./options";

export async function fetchDashboard(signal?: AbortSignal): Promise<Dashboard> {
  const { data } = await send(api.GET("/api/v1/dashboard", { signal }));
  return data;
}

export const dashboardQueries = {
  summary: () =>
    queryOptions<Dashboard, ApiError>({
      queryKey: dashboardKeys.all,
      queryFn: ({ signal }) => fetchDashboard(signal),
      retry: shouldRetry,
    }),
};

/**
 * KPI's (`themes_total`, `themes_published`, `themes_draft_dirty`, `themes_deleted`,
 * `palettes_total`), de 5 laatst gewijzigde thema's en `local_files` (importeerbare
 * handgemaakte bestanden). Elke thema-mutatie maakt dit ongeldig.
 */
export function useDashboard(options: QueryHookOptions = {}) {
  return useQuery({ ...dashboardQueries.summary(), ...options });
}
