import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "../client";

export function useHealth(path: "/healthz" | "/readyz") {
  return useQuery({
    queryKey: ["health", path],
    queryFn: () => fetchHealth(path),
    refetchInterval: 30_000,
    retry: false,
  });
}
