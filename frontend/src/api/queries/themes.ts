import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  api,
  ifMatch,
  lockEtag,
  multipart,
  readLock,
  saveBlob,
  send,
  sendDownload,
  sendLocked,
  shouldRetry,
  type ApiError,
  type DownloadedFile,
} from "../client";
import type { components } from "../schema";
import type {
  DuplicateRequest,
  ExportFormat,
  ImportConflict,
  LocalCssFile,
  LocalImportResult,
  Locked,
  Theme,
  ThemeCreate,
  ThemeListFilters,
  ThemePage,
  ThemeUpdate,
} from "../types";
import { invalidateCollections, invalidateThemeState, putTheme, removeTheme } from "./cache";
import { normalizeThemeFilters, themeKeys } from "./keys";
import type { QueryHookOptions } from "./options";

/** Lock uit `ETag`, anders uit `lock_version` van het thema zelf. */
function lockOf(response: Response, theme: Theme): { etag: string; lockVersion: number } {
  return (
    readLock(response, theme) ?? {
      etag: lockEtag(theme.lock_version),
      lockVersion: theme.lock_version,
    }
  );
}

// --- fetchers (ook bruikbaar buiten React, bv. in een loader of prefetch) ----------------------

export async function fetchThemes(
  filters: ThemeListFilters = {},
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<ThemePage> {
  const query = { ...normalizeThemeFilters(filters), cursor: cursor ?? undefined };
  const { data } = await send(api.GET("/api/v1/themes", { params: { query }, signal }));
  return data;
}

export async function fetchTheme(themeId: string, signal?: AbortSignal): Promise<Theme> {
  const { data } = await send(
    api.GET("/api/v1/themes/{theme_id}", { params: { path: { theme_id: themeId } }, signal }),
  );
  return data;
}

export function createTheme(input: ThemeCreate): Promise<Locked<Theme>> {
  return sendLocked(api.POST("/api/v1/themes", { body: input }));
}

export interface UpdateThemeInput {
  themeId: string;
  /** `lock_version` van de laatst gelezen toestand → `If-Match: "lv-<n>"`. */
  lockVersion: number;
  /** Alleen de meegestuurde velden veranderen; `null` maakt een optioneel veld leeg. */
  patch: ThemeUpdate;
}

export function updateTheme({ themeId, lockVersion, patch }: UpdateThemeInput) {
  return sendLocked(
    api.PATCH("/api/v1/themes/{theme_id}", {
      params: { path: { theme_id: themeId }, header: ifMatch(lockVersion) },
      body: patch,
    }),
  );
}

export interface DeleteThemeInput {
  themeId: string;
  /** `true` = definitief, met alle versies (anders soft delete, herstelbaar). */
  hard?: boolean;
  /** Optioneel: met `If-Match` weigert de server (412) als iemand intussen wijzigde. */
  lockVersion?: number;
}

export async function deleteTheme({ themeId, hard, lockVersion }: DeleteThemeInput) {
  await send(
    api.DELETE("/api/v1/themes/{theme_id}", {
      params: {
        path: { theme_id: themeId },
        query: hard ? { hard: true } : undefined,
        header: lockVersion === undefined ? undefined : ifMatch(lockVersion),
      },
    }),
  );
}

export function restoreTheme(themeId: string): Promise<Locked<Theme>> {
  return sendLocked(
    api.POST("/api/v1/themes/{theme_id}/restore", { params: { path: { theme_id: themeId } } }),
  );
}

export type DuplicateThemeInput = DuplicateRequest & { themeId: string };

export function duplicateTheme({ themeId, ...body }: DuplicateThemeInput) {
  return sendLocked(
    api.POST("/api/v1/themes/{theme_id}/duplicate", {
      params: { path: { theme_id: themeId } },
      body,
    }),
  );
}

export interface ExportThemeInput {
  themeId: string;
  /** `css` = gecompileerde CSS (standaard), `bundle` = `.cssthema.zip` met alle versies. */
  format?: ExportFormat;
  /** Alleen bij `css`: een vaste versie in plaats van de live versie. */
  version?: number;
  /** Bestandsnaam als de server geen `Content-Disposition` stuurt (bv. `<slug>.css`). */
  fallbackName?: string;
  /** Meteen laten opslaan door de browser (standaard `true`). */
  save?: boolean;
}

export async function exportTheme({
  themeId,
  format = "css",
  version,
  fallbackName,
  save = true,
}: ExportThemeInput): Promise<DownloadedFile> {
  const file = await sendDownload(
    api.GET("/api/v1/themes/{theme_id}/export", {
      params: {
        path: { theme_id: themeId },
        query: { format, version: format === "css" ? version : undefined },
      },
      parseAs: "blob",
    }),
    fallbackName ?? `${themeId}${format === "bundle" ? ".cssthema.zip" : ".css"}`,
  );
  if (save) saveBlob(file.blob, file.filename);
  return file;
}

export interface ImportThemeInput {
  /** `.css` of `.cssthema.zip` (bv. uit `<input type="file">`). */
  file: Blob;
  /** Nodig als `file` geen `File` is; de server leidt er type en slug van af. */
  filename?: string;
  /** Slug bestaat al: `rename` (standaard), `new_version` of `fail` (409). */
  onConflict?: ImportConflict;
  /** `.css`: v1 meteen live. Bundel: weglaten = de live versie uit het manifest. */
  publish?: boolean;
  /** Naam (en slug) in plaats van de bestandsnaam. */
  name?: string;
}

export type ImportThemeResult = Locked<Theme> & {
  /** `false`: nieuwe versie op een bestaand thema (`on_conflict=new_version`, HTTP 200). */
  created: boolean;
};

type ImportBody = components["schemas"]["Body_themes_import"];

export async function importTheme({
  file,
  filename,
  onConflict = "rename",
  publish,
  name,
}: ImportThemeInput): Promise<ImportThemeResult> {
  const upload = {
    blob: file,
    filename: filename ?? (file instanceof File ? file.name : "upload.css"),
  };
  const { data, response } = await send(
    api.POST("/api/v1/themes/import", {
      ...multipart<ImportBody>({ file: upload, on_conflict: onConflict, publish, name }),
    }),
  );
  return { data, ...lockOf(response, data), created: response.status === 201 };
}

export async function fetchLocalFiles(signal?: AbortSignal): Promise<LocalCssFile[]> {
  const { data } = await send(api.GET("/api/v1/themes/local-files", { signal }));
  return data;
}

export interface ImportLocalFilesInput {
  /** Bestandsnamen uit `GET /themes/local-files` (bv. `proxmox.css`). */
  names: string[];
  /** v1 meteen live (standaard `true`). */
  publish?: boolean;
  /** Bestand daarna naar `.geimporteerd/` verplaatsen (standaard `true`). */
  archive?: boolean;
}

export async function importLocalFiles({
  names,
  publish = true,
  archive = true,
}: ImportLocalFilesInput): Promise<LocalImportResult> {
  const { data } = await send(
    api.POST("/api/v1/themes/local-files/import", { body: { names, publish, archive } }),
  );
  return data;
}

// --- query-opties ---------------------------------------------------------------------------------

export const themeQueries = {
  list: (filters: ThemeListFilters = {}) =>
    queryOptions<ThemePage, ApiError>({
      queryKey: themeKeys.list(filters),
      queryFn: ({ signal }) => fetchThemes(filters, null, signal),
      retry: shouldRetry,
    }),
  infinite: (filters: ThemeListFilters = {}) =>
    infiniteQueryOptions<
      ThemePage,
      ApiError,
      InfiniteData<ThemePage, string | null>,
      ReturnType<typeof themeKeys.infinite>,
      string | null
    >({
      queryKey: themeKeys.infinite(filters),
      queryFn: ({ pageParam, signal }) => fetchThemes(filters, pageParam, signal),
      initialPageParam: null,
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? null,
      retry: shouldRetry,
    }),
  detail: (themeId: string) =>
    queryOptions<Theme, ApiError>({
      queryKey: themeKeys.detail(themeId),
      queryFn: ({ signal }) => fetchTheme(themeId, signal),
      retry: shouldRetry,
    }),
  localFiles: () =>
    queryOptions<LocalCssFile[], ApiError>({
      queryKey: themeKeys.localFiles(),
      queryFn: ({ signal }) => fetchLocalFiles(signal),
      retry: shouldRetry,
    }),
};

// --- lees-hooks -----------------------------------------------------------------------------------

/** Eén pagina thema's (bv. voor een keuzelijst). Houdt de vorige data vast tijdens het filteren. */
export function useThemes(filters: ThemeListFilters = {}, options: QueryHookOptions = {}) {
  return useQuery({ ...themeQueries.list(filters), placeholderData: keepPreviousData, ...options });
}

/**
 * Thema's met cursor-paginering: `fetchNextPage()` / `hasNextPage` voor "meer laden";
 * `flattenPages(data)` geeft één array.
 */
export function useThemesInfinite(filters: ThemeListFilters = {}, options: QueryHookOptions = {}) {
  return useInfiniteQuery({
    ...themeQueries.infinite(filters),
    placeholderData: keepPreviousData,
    ...options,
  });
}

/** Eén thema (met `lock_version`); `null`/`undefined` = nog niet laden. */
export function useTheme(themeId: string | null | undefined, options: QueryHookOptions = {}) {
  return useQuery<Theme, ApiError>({
    queryKey: themeKeys.detail(themeId ?? ""),
    queryFn: themeId ? ({ signal }) => fetchTheme(themeId, signal) : skipToken,
    retry: shouldRetry,
    ...options,
  });
}

/** Handgemaakte `.css`-bestanden in de css-files-map van de server. */
export function useLocalFiles(options: QueryHookOptions = {}) {
  return useQuery({ ...themeQueries.localFiles(), ...options });
}

// --- mutaties -------------------------------------------------------------------------------------

/** `POST /themes` → `Locked<Theme>` (201). Fouten: 409 `slug_conflict`, 422 `invalid_slug`. */
export function useCreateTheme() {
  const queryClient = useQueryClient();
  return useMutation<Locked<Theme>, ApiError, ThemeCreate>({
    mutationFn: createTheme,
    onSuccess: ({ data }) => {
      putTheme(queryClient, data);
      void invalidateCollections(queryClient, { palettes: true, localFiles: true });
    },
  });
}

/** `PATCH /themes/{id}` met `If-Match`. Fouten: 409 `slug_conflict`, 412 (zie `current`), 428. */
export function useUpdateTheme() {
  const queryClient = useQueryClient();
  return useMutation<Locked<Theme>, ApiError, UpdateThemeInput>({
    mutationFn: updateTheme,
    onSuccess: ({ data }, { patch }) => {
      putTheme(queryClient, data);
      void invalidateCollections(queryClient, {
        palettes: "palette_id" in patch,
        localFiles: "slug" in patch,
      });
    },
  });
}

/** `DELETE /themes/{id}` (soft, of `hard: true`). */
export function useDeleteTheme() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, DeleteThemeInput>({
    mutationFn: deleteTheme,
    onSuccess: (_data, { themeId, hard }) => {
      if (hard) removeTheme(queryClient, themeId);
      // De lock schuift op (de draft niet): een open editor neemt hem zo over.
      else void invalidateThemeState(queryClient, themeId, { draft: true });
      void invalidateCollections(queryClient, { palettes: true, localFiles: true });
    },
  });
}

/** `POST /themes/{id}/restore` → `Locked<Theme>`. 409 als de slug intussen bezet is. */
export function useRestoreTheme() {
  const queryClient = useQueryClient();
  return useMutation<Locked<Theme>, ApiError, string>({
    mutationFn: restoreTheme,
    onSuccess: ({ data }) => {
      putTheme(queryClient, data);
      // Herstellen verhoogt de lock zonder de draft te wijzigen: de editor moet hem overnemen.
      void invalidateThemeState(queryClient, data.id, { draft: true });
      void invalidateCollections(queryClient, { palettes: true, localFiles: true });
    },
  });
}

/** `POST /themes/{id}/duplicate` → het nieuwe thema (draft gekopieerd, geen versies). */
export function useDuplicateTheme() {
  const queryClient = useQueryClient();
  return useMutation<Locked<Theme>, ApiError, DuplicateThemeInput>({
    mutationFn: duplicateTheme,
    onSuccess: ({ data }) => {
      putTheme(queryClient, data);
      void invalidateCollections(queryClient, { palettes: true, localFiles: true });
    },
  });
}

/** Download `.css` (live of `version`) of `.cssthema.zip`; slaat standaard meteen op. */
export function useExportTheme() {
  return useMutation<DownloadedFile, ApiError, ExportThemeInput>({ mutationFn: exportTheme });
}

/** Upload `.css` / `.cssthema.zip` (multipart). Fouten: 409, 413, 415, 422 `theme_lint_failed`. */
export function useImportTheme() {
  const queryClient = useQueryClient();
  return useMutation<ImportThemeResult, ApiError, ImportThemeInput>({
    mutationFn: importTheme,
    onSuccess: ({ data, created }) => {
      putTheme(queryClient, data);
      if (!created) void invalidateThemeState(queryClient, data.id, { draft: true });
      void invalidateCollections(queryClient, { palettes: true, localFiles: true });
    },
  });
}

/** Handgemaakte bestanden importeren (en archiveren) → `{ imported, skipped }`. */
export function useImportLocalFiles() {
  const queryClient = useQueryClient();
  return useMutation<LocalImportResult, ApiError, ImportLocalFilesInput>({
    mutationFn: importLocalFiles,
    onSuccess: ({ imported }) => {
      for (const theme of imported) putTheme(queryClient, theme);
      void invalidateCollections(queryClient, { palettes: true, localFiles: true });
    },
  });
}
