import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, multipart, send, shouldRetry, type ApiError } from "../client";
import type {
  CaptureImportResult,
  PageUploadResult,
  ServiceSummary,
  SnapshotDocument,
} from "../types";
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

/** Een opgeslagen webpagina: `.html`, of een `.zip` met de pagina en zijn map `<naam>_files`. */
export interface PageUploadInput {
  file: File;
  /** Host van de app; leeg = uit de pagina zelf ("saved from url", canonical, …). */
  hostname?: string;
  /** Naam van de pagina; leeg = de bestandsnaam. */
  page?: string;
}

export async function uploadPage({
  file,
  hostname,
  page,
}: PageUploadInput): Promise<PageUploadResult> {
  const { data } = await send(
    api.POST("/api/v1/pages", {
      ...multipart<{ file: string; hostname?: string | null; page?: string | null }>({
        file,
        hostname: hostname?.trim() || null,
        page: page?.trim() || null,
      }),
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
    // Een snapshot verandert alleen door een nieuwe import van dezelfde pagina (zelfde id);
    // `useImportCapture` maakt de documenten dan ongeldig. De server stuurt een ETag, dus een
    // nieuwe editor-load kost alleen een 304.
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
    // Ook de documenten: een nieuwe import werkt bestaande snapshots bij onder hetzelfde id.
    onSettled: () => queryClient.invalidateQueries({ queryKey: serviceKeys.all }),
  });
}

export function useUploadPage() {
  const queryClient = useQueryClient();
  return useMutation<PageUploadResult, ApiError, PageUploadInput>({
    mutationFn: uploadPage,
    // Dezelfde pagina opnieuw: zelfde snapshot-id, nieuwe inhoud.
    onSettled: () => queryClient.invalidateQueries({ queryKey: serviceKeys.all }),
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
