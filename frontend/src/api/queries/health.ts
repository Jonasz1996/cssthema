import { useQuery } from "@tanstack/react-query";
import { fetchHealth, type HealthState } from "../client";

/** `/healthz` of `/readyz`, elke 30 s; bij een fout is `error` meestal een `HealthError`. */
export function useHealth(path: "/healthz" | "/readyz") {
  return useQuery<HealthState, Error>({
    queryKey: ["health", path],
    queryFn: () => fetchHealth(path),
    refetchInterval: 30_000,
    retry: false,
  });
}
