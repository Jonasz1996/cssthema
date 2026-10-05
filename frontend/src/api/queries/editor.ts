import {
  infiniteQueryOptions,
  keepPreviousData,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { api, ifMatch, send, sendLocked, shouldRetry, type ApiError } from "../client";
import type {
  DiffRef,
  Draft,
  LintResult,
  Locked,
  Version,
  VersionDiff,
  VersionPage,
} from "../types";
import { invalidateCollections, invalidateThemeState, patchDraft, patchTheme } from "./cache";
import { themeKeys } from "./keys";
import type { QueryHookOptions } from "./options";
import { fetchTheme } from "./themes";

/**
 * Editor en versies: draft lezen/opslaan (autosave met `If-Match`), lint, publiceren, versies,
 * diff, rollback en draft terugzetten. Elke mutatie geeft de nieuwe `lockVersion` terug; de
 * editor bewaart die zelf en stuurt hem mee bij de volgende call.
 */

// --- fetchers -------------------------------------------------------------------------------------

export async function fetchDraft(themeId: string, signal?: AbortSignal): Promise<Draft> {
  const { data } = await send(
    api.GET("/api/v1/themes/{theme_id}/draft", { params: { path: { theme_id: themeId } }, signal }),
  );
  return data;
}

export interface SaveDraftInput {
  themeId: string;
  css: string;
  /** `lock_version` van de laatst gelezen/opgeslagen draft. */
  lockVersion: number;
}

/** `PUT /draft` met `If-Match`. 412 → `ApiError.current`; 413 te groot; netwerk → `network_error`. */
export function saveDraft({ themeId, css, lockVersion }: SaveDraftInput): Promise<Locked<Draft>> {
  return sendLocked(
    api.PUT("/api/v1/themes/{theme_id}/draft", {
      params: { path: { theme_id: themeId }, header: ifMatch(lockVersion) },
      body: { css },
    }),
  );
}

/** Lint `css` (of, met `null`, de opgeslagen draft). Geeft altijd 200 met fouten en waarschuwingen. */
export async function lintTheme(
  themeId: string,
  css: string | null,
  signal?: AbortSignal,
): Promise<LintResult> {
  const { data } = await send(
    api.POST("/api/v1/themes/{theme_id}/lint", {
      params: { path: { theme_id: themeId } },
      body: css === null ? {} : { css },
      signal,
    }),
  );
  return data;
}

export interface PublishThemeInput {
  themeId: string;
  /** `lock_version` van de draft die je publiceert (de server weigert met 412 als hij nieuwer is). */
  expectedLockVersion: number;
  message?: string | null;
}

/**
 * `POST /publish` → de nieuwe live `Version` (201). Fouten: 409 `state_conflict` (geen
 * wijzigingen), 412 (draft intussen gewijzigd), 422 `theme_lint_failed` (zie `lintIssuesOf`).
 */
export function publishTheme({
  themeId,
  expectedLockVersion,
  message,
}: PublishThemeInput): Promise<Locked<Version>> {
  return sendLocked(
    api.POST("/api/v1/themes/{theme_id}/publish", {
      params: { path: { theme_id: themeId } },
      body: { expected_lock_version: expectedLockVersion, message: message || null },
    }),
    async () => (await fetchTheme(themeId)).lock_version,
  );
}

export interface VersionListParams {
  /** Paginagrootte (1–200, server-standaard 50). */
  limit?: number;
}

export async function fetchVersions(
  themeId: string,
  { limit, cursor }: VersionListParams & { cursor?: string | null } = {},
  signal?: AbortSignal,
): Promise<VersionPage> {
  const { data } = await send(
    api.GET("/api/v1/themes/{theme_id}/versions", {
      params: { path: { theme_id: themeId }, query: { limit, cursor: cursor ?? undefined } },
      signal,
    }),
  );
  return data;
}

export async function fetchVersion(
  themeId: string,
  versionNumber: number,
  signal?: AbortSignal,
): Promise<Version> {
  const { data } = await send(
    api.GET("/api/v1/themes/{theme_id}/versions/{version_number}", {
      params: { path: { theme_id: themeId, version_number: versionNumber } },
      signal,
    }),
  );
  return data;
}

export async function fetchDiff(
  themeId: string,
  from: DiffRef,
  to: DiffRef = "draft",
  signal?: AbortSignal,
): Promise<VersionDiff> {
  const { data } = await send(
    api.GET("/api/v1/themes/{theme_id}/diff", {
      params: { path: { theme_id: themeId }, query: { from: String(from), to: String(to) } },
      signal,
    }),
  );
  return data;
}

export interface RollbackInput {
  themeId: string;
  versionNumber: number;
  /** `If-Match`: de rollback vervangt ook de draft. */
  lockVersion: number;
  message?: string | null;
}

/** `POST /rollback` → nieuwe live `Version` (bron `rollback`); de draft wordt die inhoud. 409 = al live. */
export function rollbackTheme({
  themeId,
  versionNumber,
  lockVersion,
  message,
}: RollbackInput): Promise<Locked<Version>> {
  return sendLocked(
    api.POST("/api/v1/themes/{theme_id}/rollback", {
      params: { path: { theme_id: themeId }, header: ifMatch(lockVersion) },
      body: { version_number: versionNumber, message: message || null },
    }),
    async () => (await fetchTheme(themeId)).lock_version,
  );
}

export interface ResetDraftInput {
  themeId: string;
  versionNumber: number;
  lockVersion: number;
}

/** `POST /draft/reset` → draft = die versie, zonder publiceren ("open in editor"). */
export function resetDraft({
  themeId,
  versionNumber,
  lockVersion,
}: ResetDraftInput): Promise<Locked<Draft>> {
  return sendLocked(
    api.POST("/api/v1/themes/{theme_id}/draft/reset", {
      params: { path: { theme_id: themeId }, header: ifMatch(lockVersion) },
      body: { version_number: versionNumber },
    }),
  );
}

// --- query-opties ---------------------------------------------------------------------------------

export const editorQueries = {
  versionsInfinite: (themeId: string, { limit }: VersionListParams = {}) =>
    infiniteQueryOptions<
      VersionPage,
      ApiError,
      InfiniteData<VersionPage, string | null>,
      ReturnType<typeof themeKeys.versionInfinite>,
      string | null
    >({
      queryKey: themeKeys.versionInfinite(themeId, limit),
      queryFn: ({ pageParam, signal }) =>
        fetchVersions(themeId, { limit, cursor: pageParam }, signal),
      initialPageParam: null,
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? null,
      retry: shouldRetry,
    }),
};

// --- lees-hooks -----------------------------------------------------------------------------------

/**
 * De opgeslagen draft (`css` + `lock_version`). `staleTime: Infinity`: hij herlaadt alleen na
 * rollback of import, of als je hem ongeldig maakt. Gebruik `data` als beginwaarde van de
 * editor, niet als gecontroleerde waarde: na elke autosave staat hier de opgeslagen versie.
 */
export function useDraft(themeId: string | null | undefined, options: QueryHookOptions = {}) {
  return useQuery<Draft, ApiError>({
    queryKey: themeKeys.draft(themeId ?? ""),
    queryFn: themeId ? ({ signal }) => fetchDraft(themeId, signal) : skipToken,
    staleTime: Infinity,
    retry: shouldRetry,
    ...options,
  });
}

/**
 * Lint-resultaat voor `css` (debounce zelf, bv. 400 ms); `null` = de opgeslagen draft,
 * `undefined` = (nog) niet linten. Het vorige resultaat blijft staan tot het nieuwe binnen is,
 * zodat markers niet flikkeren; een verouderde request wordt afgebroken.
 */
export function useLint(
  themeId: string | null | undefined,
  css: string | null | undefined,
  options: QueryHookOptions = {},
) {
  return useQuery<LintResult, ApiError>({
    queryKey: themeKeys.lint(themeId ?? "", css ?? null),
    queryFn:
      themeId && css !== undefined ? ({ signal }) => lintTheme(themeId, css, signal) : skipToken,
    // Dezelfde CSS geeft hetzelfde resultaat; de opgeslagen draft kan intussen veranderen.
    staleTime: css === null ? 0 : Infinity,
    gcTime: 30_000,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
    ...options,
  });
}

/** Eén pagina versies, nieuwste eerst. */
export function useVersions(
  themeId: string | null | undefined,
  { limit }: VersionListParams = {},
  options: QueryHookOptions = {},
) {
  return useQuery<VersionPage, ApiError>({
    queryKey: themeKeys.versionList(themeId ?? "", limit),
    queryFn: themeId ? ({ signal }) => fetchVersions(themeId, { limit }, signal) : skipToken,
    retry: shouldRetry,
    ...options,
  });
}

/** Versies met "meer laden" (`fetchNextPage` / `hasNextPage`; `flattenPages(data)`). */
export function useVersionsInfinite(
  themeId: string,
  params: VersionListParams = {},
  options: QueryHookOptions = {},
) {
  return useInfiniteQuery({ ...editorQueries.versionsInfinite(themeId, params), ...options });
}

/** Eén versie met `css_source`, `css_compiled` en `lint_warnings`. */
export function useVersion(
  themeId: string | null | undefined,
  versionNumber: number | null | undefined,
  options: QueryHookOptions = {},
) {
  return useQuery<Version, ApiError>({
    queryKey: themeKeys.version(themeId ?? "", versionNumber ?? 0),
    queryFn:
      themeId && typeof versionNumber === "number"
        ? ({ signal }) => fetchVersion(themeId, versionNumber, signal)
        : skipToken,
    retry: shouldRetry,
    ...options,
  });
}

/**
 * Unified diff tussen twee versies of versie ↔ draft (`to` standaard `"draft"`).
 * Tussen twee vaste versies verandert hij nooit (`staleTime: Infinity`).
 */
export function useDiff(
  themeId: string | null | undefined,
  from: DiffRef | null | undefined,
  to: DiffRef = "draft",
  options: QueryHookOptions = {},
) {
  return useQuery<VersionDiff, ApiError>({
    queryKey: themeKeys.diff(themeId ?? "", from ?? "draft", to),
    queryFn:
      themeId && from !== null && from !== undefined
        ? ({ signal }) => fetchDiff(themeId, from, to, signal)
        : skipToken,
    staleTime: from !== "draft" && to !== "draft" ? Infinity : 0,
    retry: shouldRetry,
    ...options,
  });
}

// --- mutaties -------------------------------------------------------------------------------------

/**
 * Autosave: `PUT /draft` met `If-Match` → `Locked<Draft>`. Draait ook offline
 * (`networkMode: "always"`): dan faalt hij meteen met `network_error` in plaats van te
 * wachten, zodat de editor zelf kan bufferen. Bij 412 staat de servertoestand in `error.current`.
 */
export function useSaveDraft() {
  const queryClient = useQueryClient();
  return useMutation<Locked<Draft>, ApiError, SaveDraftInput>({
    mutationFn: saveDraft,
    networkMode: "always",
    onSuccess: ({ data }, { themeId }) => {
      queryClient.setQueryData(themeKeys.draft(themeId), data);
      patchTheme(queryClient, themeId, {
        lock_version: data.lock_version,
        draft_size_bytes: data.size_bytes,
        draft_updated_at: data.updated_at,
        draft_updated_by: data.updated_by,
      });
      // `draft_dirty` en de diffs met de draft rekent de server uit; de versies blijven gelijk.
      void invalidateThemeState(queryClient, themeId, { versions: false });
      void invalidateCollections(queryClient);
    },
  });
}

/** Publiceren → `Locked<Version>`; de draft-inhoud blijft, alleen de lock schuift op. */
export function usePublishTheme() {
  const queryClient = useQueryClient();
  return useMutation<Locked<Version>, ApiError, PublishThemeInput>({
    mutationFn: publishTheme,
    onSuccess: ({ lockVersion }, { themeId }) => {
      patchDraft(queryClient, themeId, { lock_version: lockVersion });
      patchTheme(queryClient, themeId, { lock_version: lockVersion });
      void invalidateThemeState(queryClient, themeId);
      void invalidateCollections(queryClient);
    },
  });
}

/** Rollback naar een versie → nieuwe live `Locked<Version>`; de draft herlaadt (nieuwe inhoud). */
export function useRollback() {
  const queryClient = useQueryClient();
  return useMutation<Locked<Version>, ApiError, RollbackInput>({
    mutationFn: rollbackTheme,
    onSuccess: ({ lockVersion }, { themeId }) => {
      patchTheme(queryClient, themeId, { lock_version: lockVersion });
      void invalidateThemeState(queryClient, themeId, { draft: true });
      void invalidateCollections(queryClient);
    },
  });
}

/** Draft terugzetten naar een versie (zonder publiceren) → `Locked<Draft>`. */
export function useResetDraft() {
  const queryClient = useQueryClient();
  return useMutation<Locked<Draft>, ApiError, ResetDraftInput>({
    mutationFn: resetDraft,
    onSuccess: ({ data }, { themeId }) => {
      queryClient.setQueryData(themeKeys.draft(themeId), data);
      patchTheme(queryClient, themeId, { lock_version: data.lock_version });
      void invalidateThemeState(queryClient, themeId, { versions: false });
      void invalidateCollections(queryClient);
    },
  });
}
