import {
  queryOptions,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import {
  api,
  isApiError,
  multipart,
  saveBlob,
  send,
  sendDownload,
  shouldRetry,
  type ApiError,
  type DownloadedFile,
} from "../client";
import type { components } from "../schema";
import type { ScriptFile } from "../types";
import { scriptKeys } from "./keys";
import type { QueryHookOptions } from "./options";

/**
 * Thema-scripts (docs/05 § 4.6a): gewone `<naam>.js`-bestanden in de css-files-map, die nginx
 * publiek serveert op `/<naam>.js`. Geen versies en geen draft: een upload is meteen live,
 * vervangen en verwijderen verplaatsen de vorige versie naar `.scripts-archief/`.
 */

// --- fetchers -------------------------------------------------------------------------------

export async function fetchScripts(signal?: AbortSignal): Promise<ScriptFile[]> {
  const { data } = await send(api.GET("/api/v1/scripts", { signal }));
  return data;
}

/** Inhoud van een script als tekst (`GET /scripts/{name}`). */
export async function fetchScriptContent(name: string, signal?: AbortSignal): Promise<string> {
  const { data } = await send(
    api.GET("/api/v1/scripts/{name}", { params: { path: { name } }, parseAs: "text", signal }),
  );
  return data;
}

export interface UploadScriptInput {
  /** `.js` (bv. uit `<input type="file">`). */
  file: Blob;
  /** Nodig als `file` geen `File` is; de server leidt er de naam van af. */
  filename?: string;
  /** Naam (en URL `/<naam>.js`) in plaats van de bestandsnaam; de server normaliseert hem. */
  name?: string;
  /** Een bestaand script vervangen (anders 409 `script_conflict`). */
  replace?: boolean;
}

export interface UploadScriptResult {
  data: ScriptFile;
  /** `false`: een bestaand script is vervangen (HTTP 200). */
  created: boolean;
}

type UploadBody = components["schemas"]["Body_scripts_upload"];

export async function uploadScript({
  file,
  filename,
  name,
  replace = false,
}: UploadScriptInput): Promise<UploadScriptResult> {
  const upload = {
    blob: file,
    filename: filename ?? (file instanceof File ? file.name : "upload.js"),
  };
  // `replace` is in het gegenereerde type verplicht (standaardwaarde); de body serialiseren we
  // zelf, dus alleen meesturen als het aan staat.
  const { data, response } = await send(
    api.POST("/api/v1/scripts", {
      ...multipart<UploadBody>({ file: upload, name, replace: replace || undefined }),
    }),
  );
  return { data, created: response.status === 201 };
}

export async function deleteScript(name: string): Promise<void> {
  await send(api.DELETE("/api/v1/scripts/{name}", { params: { path: { name } } }));
}

export interface DownloadScriptInput {
  name: string;
  /** Meteen laten opslaan door de browser (standaard `true`). */
  save?: boolean;
}

export async function downloadScript({
  name,
  save = true,
}: DownloadScriptInput): Promise<DownloadedFile> {
  const file = await sendDownload(
    api.GET("/api/v1/scripts/{name}", {
      params: { path: { name }, query: { download: true } },
      parseAs: "blob",
    }),
    `${name}.js`,
  );
  if (save) saveBlob(file.blob, file.filename);
  return file;
}

// --- query-opties ---------------------------------------------------------------------------

export const scriptQueries = {
  list: () =>
    queryOptions<ScriptFile[], ApiError>({
      queryKey: scriptKeys.list(),
      queryFn: ({ signal }) => fetchScripts(signal),
      retry: shouldRetry,
    }),
  content: (name: string) =>
    queryOptions<string, ApiError>({
      queryKey: scriptKeys.content(name),
      queryFn: ({ signal }) => fetchScriptContent(name, signal),
      retry: shouldRetry,
    }),
};

// --- cache ----------------------------------------------------------------------------------

/** Zet een (nieuw of vervangen) script in de lijst, op naam gesorteerd zoals de server. */
function putScript(queryClient: QueryClient, script: ScriptFile): void {
  queryClient.setQueryData<ScriptFile[]>(scriptKeys.list(), (old) =>
    old
      ? [...old.filter((item) => item.name !== script.name), script].sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        )
      : old,
  );
}

function dropScript(queryClient: QueryClient, name: string): void {
  queryClient.setQueryData<ScriptFile[]>(scriptKeys.list(), (old) =>
    old ? old.filter((item) => item.name !== name) : old,
  );
}

/**
 * 404 `not_found`: het script staat niet (meer) in de map, bv. met de hand verwijderd of in een
 * ander tabblad. De lijst is dan verouderd.
 */
export function isScriptGone(error: unknown): boolean {
  return isApiError(error) && error.status === 404 && error.code === "not_found";
}

/** Een script dat er niet meer is: uit de lijst halen en de lijst opnieuw ophalen. */
function forgetScript(queryClient: QueryClient, name: string): void {
  dropScript(queryClient, name);
  void queryClient.invalidateQueries({ queryKey: scriptKeys.list() });
}

// --- hooks ----------------------------------------------------------------------------------

/** De scripts in de css-files-map, op naam gesorteerd. Een ontbrekende map geeft `[]`. */
export function useScripts(options: QueryHookOptions = {}) {
  return useQuery({ ...scriptQueries.list(), ...options });
}

/**
 * Inhoud van één script (tekst); `null`/`undefined` = nog niet laden. Geeft de server 404, dan
 * verdwijnt het script ook uit de lijst.
 */
export function useScriptContent(name: string | null | undefined, options: QueryHookOptions = {}) {
  const queryClient = useQueryClient();
  const query = useQuery<string, ApiError>({
    queryKey: scriptKeys.content(name ?? ""),
    queryFn: name ? ({ signal }) => fetchScriptContent(name, signal) : skipToken,
    retry: shouldRetry,
    ...options,
  });
  const gone = name && isScriptGone(query.error) ? name : null;
  useEffect(() => {
    if (gone) forgetScript(queryClient, gone);
  }, [gone, queryClient]);
  return query;
}

/**
 * Upload `.js` (multipart) → `{ data, created }`. Fouten: 409 `script_conflict` (naam bestaat,
 * zonder `replace`) of `state_conflict`, 413, 415, 422 `invalid_script_name` /
 * `validation_error`, 503 `storage_unavailable`.
 */
export function useUploadScript() {
  const queryClient = useQueryClient();
  return useMutation<UploadScriptResult, ApiError, UploadScriptInput>({
    mutationFn: uploadScript,
    onSuccess: ({ data }) => {
      putScript(queryClient, data);
      void queryClient.invalidateQueries({ queryKey: scriptKeys.list() });
      void queryClient.invalidateQueries({ queryKey: scriptKeys.content(data.name) });
    },
  });
}

/**
 * `DELETE /scripts/{name}`: het bestand gaat naar `.scripts-archief/` (204). Bij 404 (al weg)
 * verdwijnt het ook uit de lijst; de fout blijft (zie `isScriptGone`).
 */
export function useDeleteScript() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: deleteScript,
    onSuccess: (_data, name) => {
      forgetScript(queryClient, name);
      queryClient.removeQueries({ queryKey: scriptKeys.content(name) });
    },
    onError: (error, name) => {
      if (isScriptGone(error)) forgetScript(queryClient, name);
    },
  });
}

/** Download `<naam>.js`; slaat standaard meteen op. Bij 404 verdwijnt het uit de lijst. */
export function useDownloadScript() {
  const queryClient = useQueryClient();
  return useMutation<DownloadedFile, ApiError, DownloadScriptInput>({
    mutationFn: downloadScript,
    onError: (error, { name }) => {
      if (isScriptGone(error)) forgetScript(queryClient, name);
    },
  });
}
