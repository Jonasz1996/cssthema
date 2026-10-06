import { queryOptions, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, send, shouldRetry, type ApiError } from "../client";
import type { Palette } from "../types";
import { paletteKeys } from "./keys";
import type { QueryHookOptions } from "./options";

/** Paletten veranderen in fase 1 niet (alleen ingebouwde, alleen lezen). */
const PALETTE_STALE_TIME = 5 * 60_000;

export async function fetchPalettes(signal?: AbortSignal): Promise<Palette[]> {
  const { data } = await send(api.GET("/api/v1/palettes", { signal }));
  return data;
}

export async function fetchPalette(paletteId: string, signal?: AbortSignal): Promise<Palette> {
  const { data } = await send(
    api.GET("/api/v1/palettes/{palette_id}", {
      params: { path: { palette_id: paletteId } },
      signal,
    }),
  );
  return data;
}

export const paletteQueries = {
  list: () =>
    queryOptions<Palette[], ApiError>({
      queryKey: paletteKeys.list(),
      queryFn: ({ signal }) => fetchPalettes(signal),
      staleTime: PALETTE_STALE_TIME,
      retry: shouldRetry,
    }),
};

/** Alle paletten (ingebouwd eerst, zoals de server ze sorteert) met tokens en `theme_count`. */
export function usePalettes(options: QueryHookOptions = {}) {
  return useQuery({ ...paletteQueries.list(), ...options });
}

/**
 * Eén palet; `null`/`undefined` = geen (thema zonder palet). Staat het al in de lijst, dan is
 * die meteen de beginwaarde.
 */
export function usePalette(paletteId: string | null | undefined, options: QueryHookOptions = {}) {
  const queryClient = useQueryClient();
  return useQuery<Palette, ApiError>({
    queryKey: paletteKeys.detail(paletteId ?? ""),
    queryFn: paletteId ? ({ signal }) => fetchPalette(paletteId, signal) : skipToken,
    initialData: () =>
      queryClient
        .getQueryData<Palette[]>(paletteKeys.list())
        ?.find((palette) => palette.id === paletteId),
    initialDataUpdatedAt: () => queryClient.getQueryState(paletteKeys.list())?.dataUpdatedAt,
    staleTime: PALETTE_STALE_TIME,
    retry: shouldRetry,
    ...options,
  });
}
