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
  HostBulkRequest,
  HostBulkResult,
  HostCheckStarted,
  HostHealthOverview,
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

/** Zo vaak `GET /hosts/health` opnieuw zolang een controle loopt. */
export const HOST_CHECK_POLL_MS = 2000;

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

export async function fetchHostHealth(signal?: AbortSignal): Promise<HostHealthOverview> {
  const { data } = await send(api.GET("/api/v1/hosts/health", { signal }));
  return data;
}

export async function startHostCheck(): Promise<HostCheckStarted> {
  const { data } = await send(api.POST("/api/v1/hosts/check"));
  return data;
}

export async function forgetSeenHost(hostname: string): Promise<void> {
  await send(api.DELETE("/api/v1/hosts/seen/{hostname}", { params: { path: { hostname } } }));
}

export async function forgetAllSeenHosts(): Promise<void> {
  await send(api.DELETE("/api/v1/hosts/seen"));
}

export async function bulkHosts(body: HostBulkRequest): Promise<HostBulkResult> {
  const { data } = await send(api.POST("/api/v1/hosts/bulk", { body }));
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
  /** Ververst om de {@link HOST_CHECK_POLL_MS} zolang `check_running`. */
  health: () =>
    queryOptions<HostHealthOverview, ApiError>({
      queryKey: hostKeys.health(),
      queryFn: ({ signal }) => fetchHostHealth(signal),
      retry: shouldRetry,
      refetchInterval: (query) => (query.state.data?.check_running ? HOST_CHECK_POLL_MS : false),
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

/**
 * Alles onder `["hosts"]`: een nieuwe of gewiste koppeling verandert ook `bound`, de status en
 * de preview-stapels en het gebruik van een thema in de editor.
 */
function refreshHosts(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: hostKeys.all });
}

function refreshHealth(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: hostKeys.health() });
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

/** Per host: laatst geladen, ontbrekende onderdelen en de laatste controle. */
export function useHostHealth(options: QueryHookOptions = {}) {
  return useQuery({ ...hostQueries.health(), ...options });
}

/**
 * `POST /hosts/check` (202): de controle loopt op de achtergrond. `started: false` betekent dat
 * er al een liep; in beide gevallen gaat de cache op `check_running`, zodat het pollen start.
 */
export function useStartHostCheck() {
  const queryClient = useQueryClient();
  return useMutation<HostCheckStarted, ApiError, void>({
    mutationFn: startHostCheck,
    onSuccess: () => {
      queryClient.setQueryData<HostHealthOverview>(hostKeys.health(), (old) =>
        old ? { ...old, check_running: true } : old,
      );
      refreshHealth(queryClient);
    },
  });
}

/** `DELETE /hosts/seen/{hostname}`: de host verdwijnt uit "laatst geladen". */
export function useForgetSeenHost() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: forgetSeenHost,
    onSuccess: (_data, hostname) => {
      queryClient.setQueryData<HostHealthOverview>(hostKeys.health(), (old) =>
        old
          ? {
              ...old,
              hosts: old.hosts.filter((host) => host.bound || host.hostname !== hostname),
            }
          : old,
      );
      refreshHealth(queryClient);
    },
    onError: () => refreshHealth(queryClient),
  });
}

/** `DELETE /hosts/seen`: elke host zonder eigen koppeling verdwijnt uit "laatst geladen". */
export function useForgetAllSeenHosts() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: forgetAllSeenHosts,
    onSettled: () => refreshHealth(queryClient),
  });
}

/**
 * `POST /hosts/bulk`: één wijziging voor veel koppelingen (naam toevoegen, weghalen, vervangen,
 * aan/uit). Fouten: 422 `validation_error`.
 */
export function useBulkHosts() {
  const queryClient = useQueryClient();
  return useMutation<HostBulkResult, ApiError, HostBulkRequest>({
    mutationFn: bulkHosts,
    onSuccess: () => refreshHosts(queryClient),
  });
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
