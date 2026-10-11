import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api, send, shouldRetry, type ApiError } from "../client";
import type {
  HostBinding,
  HostBindingInput,
  HostImportRequest,
  HostImportResult,
  HostOptions,
} from "../types";
import { hostKeys } from "./keys";
import type { QueryHookOptions } from "./options";

/**
 * Host-koppelingen: welke thema's en scripts elke proxy host krijgt via
 * `/host/<hostnaam>.css|.js`. In NPM staat overal dezelfde `sub_filter`-regel met `$host`; de
 * koppeling `*` geldt voor elke host zonder eigen rij.
 */

export const DEFAULT_HOST = "*";

// --- fetchers -------------------------------------------------------------------------------

export async function fetchHosts(signal?: AbortSignal): Promise<HostBinding[]> {
  const { data } = await send(api.GET("/api/v1/hosts", { signal }));
  return data;
}

export async function fetchHostOptions(signal?: AbortSignal): Promise<HostOptions> {
  const { data } = await send(api.GET("/api/v1/hosts/options", { signal }));
  return data;
}

export async function createHost(body: HostBindingInput): Promise<HostBinding> {
  const { data } = await send(api.POST("/api/v1/hosts", { body }));
  return data;
}

export interface UpdateHostInput {
  id: string;
  body: HostBindingInput;
}

export async function updateHost({ id, body }: UpdateHostInput): Promise<HostBinding> {
  const { data } = await send(
    api.PUT("/api/v1/hosts/{binding_id}", { params: { path: { binding_id: id } }, body }),
  );
  return data;
}

export async function deleteHost(id: string): Promise<void> {
  await send(api.DELETE("/api/v1/hosts/{binding_id}", { params: { path: { binding_id: id } } }));
}

export async function importHosts(body: HostImportRequest): Promise<HostImportResult> {
  const { data } = await send(api.POST("/api/v1/hosts/import", { body }));
  return data;
}

// --- query-opties ---------------------------------------------------------------------------

export const hostQueries = {
  list: () =>
    queryOptions<HostBinding[], ApiError>({
      queryKey: hostKeys.list(),
      queryFn: ({ signal }) => fetchHosts(signal),
      retry: shouldRetry,
    }),
  options: () =>
    queryOptions<HostOptions, ApiError>({
      queryKey: hostKeys.options(),
      queryFn: ({ signal }) => fetchHostOptions(signal),
      retry: shouldRetry,
    }),
};

// --- cache ----------------------------------------------------------------------------------

/** Zelfde volgorde als de server: `*` eerst, daarna op hostnaam. */
export function compareHosts(a: HostBinding, b: HostBinding): number {
  if (a.hostname === b.hostname) return 0;
  if (a.hostname === DEFAULT_HOST) return -1;
  if (b.hostname === DEFAULT_HOST) return 1;
  return a.hostname < b.hostname ? -1 : 1;
}

function putHost(queryClient: QueryClient, host: HostBinding): void {
  queryClient.setQueryData<HostBinding[]>(hostKeys.list(), (old) =>
    old ? [...old.filter((item) => item.id !== host.id), host].sort(compareHosts) : old,
  );
}

function refreshHosts(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: hostKeys.list() });
}

// --- hooks ----------------------------------------------------------------------------------

/** Alle koppelingen, `*` eerst. */
export function useHosts(options: QueryHookOptions = {}) {
  return useQuery({ ...hostQueries.list(), ...options });
}

/** Te kiezen thema's en scripts, en de `sub_filter`-regel voor NPM. */
export function useHostOptions(options: QueryHookOptions = {}) {
  return useQuery({ ...hostQueries.options(), ...options });
}

/** `POST /hosts`. Fouten: 409 `host_conflict`, 422 `validation_error` (veldfouten). */
export function useCreateHost() {
  const queryClient = useQueryClient();
  return useMutation<HostBinding, ApiError, HostBindingInput>({
    mutationFn: createHost,
    onSuccess: (host) => {
      putHost(queryClient, host);
      refreshHosts(queryClient);
    },
  });
}

/** `PUT /hosts/{id}` (ook voor aan/uit). Fouten: 404, 409 `host_conflict`, 422. */
export function useUpdateHost() {
  const queryClient = useQueryClient();
  return useMutation<HostBinding, ApiError, UpdateHostInput>({
    mutationFn: updateHost,
    onSuccess: (host) => {
      putHost(queryClient, host);
      refreshHosts(queryClient);
    },
  });
}

/** `DELETE /hosts/{id}`: de host volgt daarna `*`. */
export function useDeleteHost() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: deleteHost,
    onSuccess: (_data, id) => {
      queryClient.setQueryData<HostBinding[]>(hostKeys.list(), (old) =>
        old ? old.filter((item) => item.id !== id) : old,
      );
      refreshHosts(queryClient);
    },
    onError: () => refreshHosts(queryClient),
  });
}

/** `POST /hosts/import`: koppelingen overnemen uit een NPM-config. */
export function useImportHosts() {
  const queryClient = useQueryClient();
  return useMutation<HostImportResult, ApiError, HostImportRequest>({
    mutationFn: importHosts,
    onSuccess: () => refreshHosts(queryClient),
  });
}
