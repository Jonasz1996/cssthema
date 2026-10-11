import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, multipart, send, shouldRetry, type ApiError } from "../client";
import type { CaptureImportResult, ServiceSummary, SnapshotDocument } from "../types";
import { serviceKeys } from "./keys";
import type { QueryHookOptions } from "./options";

/**
 * Diensten en snapshots uit de capture-zips van `vastleggen.py` (stappenplan D1/D2). Een
 * snapshot is de vastgelegde pagina van een app (zonder scripts) met de CSS van de app; de
 * editor kan daartegen previewen.
 */

// --- fetchers -------------------------------------------------------------------------------

export async function fetchServices(signal?: AbortSignal): Promise<ServiceSummary[]> {
  const { data } = await send(api.GET("/api/v1/services", { signal }));
  return data;
}

export async function fetchSnapshotDocument(
  snapshotId: string,
  signal?: AbortSignal,
): Promise<SnapshotDocument> {
  const { data } = await send(
    api.GET("/api/v1/snapshots/{snapshot_id}/document", {
      params: { path: { snapshot_id: snapshotId } },
      signal,
    }),
  );
  return data;
}

export async function importCapture(file: File): Promise<CaptureImportResult> {
  const { data } = await send(
    api.POST("/api/v1/captures", {
      ...multipart<{ file: string }>({ file }),
    }),
  );
  return data;
}

export async function deleteService(id: string): Promise<void> {
  await send(api.DELETE("/api/v1/services/{service_id}", { params: { path: { service_id: id } } }));
}

// --- queries --------------------------------------------------------------------------------

export const servicesQuery = () =>
  queryOptions({
    queryKey: serviceKeys.list(),
    queryFn: ({ signal }) => fetchServices(signal),
    retry: shouldRetry,
  });

export const snapshotDocumentQuery = (snapshotId: string) =>
  queryOptions({
    queryKey: serviceKeys.document(snapshotId),
    queryFn: ({ signal }) => fetchSnapshotDocument(snapshotId, signal),
    retry: shouldRetry,
    // Een snapshot verandert nooit (een nieuwe import maakt een nieuwe).
    staleTime: Infinity,
  });

export function useServices(options: QueryHookOptions = {}) {
  return useQuery({ ...servicesQuery(), ...options });
}

export function useSnapshotDocument(snapshotId: string | null, options: QueryHookOptions = {}) {
  return useQuery({
    ...snapshotDocumentQuery(snapshotId ?? ""),
    enabled: snapshotId !== null && (options.enabled ?? true),
  });
}

// --- mutaties -------------------------------------------------------------------------------

export function useImportCapture() {
  const queryClient = useQueryClient();
  return useMutation<CaptureImportResult, ApiError, File>({
    mutationFn: importCapture,
    onSettled: () => queryClient.invalidateQueries({ queryKey: serviceKeys.list() }),
  });
}

export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: deleteService,
    onSuccess: (_data, id) =>
      queryClient.setQueryData<ServiceSummary[]>(serviceKeys.list(), (old) =>
        old?.filter((service) => service.id !== id),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: serviceKeys.list() }),
  });
}
