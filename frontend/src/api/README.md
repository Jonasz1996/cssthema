# API-laag

Getypeerde toegang tot `/api/v1` voor de features. `schema.d.ts` is gegenereerd (`make openapi`), nooit met de
hand wijzigen; `types.ts` geeft er korte namen voor (`Theme`, `Draft`, `Version`, `Palette`, `Locked<T>`, …).

## `client.ts`

| Export                                                                           | Wat                                                                                                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `api`                                                                            | openapi-fetch-client (stuurt bij POST/PUT/PATCH/DELETE `X-CSRF-Token` uit cookie `cssthema_csrf` mee, als die er is)  |
| `send(api.GET(…))`                                                               | `{ data, response }`; elke fout wordt `ApiError` (een `AbortError` blijft een `AbortError`)                           |
| `sendLocked(call, fallback?)`                                                    | `Locked<T> = { data, etag, lockVersion }` uit `ETag: "lv-<n>"` (anders `lock_version` uit de body)                    |
| `lockEtag(n)`, `parseLockEtag(s)`, `ifMatch(n)`, `readLock(res, body)`           | `"lv-<n>"`-helpers (`W/"lv-n"` telt ook)                                                                              |
| `ApiError`                                                                       | `status` (0 = netwerk), `code`, `title`, `detail`, `message`, `errors[]`, `current` (bij 412), `requestId`, `problem` |
| `isApiError`, `isPreconditionFailed`, `isNetworkError`, `isAbortError`           | type guards                                                                                                           |
| `lintIssuesOf(err)`, `fieldErrorsOf(err)`                                        | lint-fouten uit 422 `theme_lint_failed`; veldfouten uit 422 `validation_error`                                        |
| `toFormData`, `multipart<B>(fields)`                                             | multipart-upload (`{ blob, filename }` voor een expliciete bestandsnaam)                                              |
| `sendDownload(call, fallbackName)`, `filenameFromContentDisposition`, `saveBlob` | downloads                                                                                                             |
| `shouldRetry`                                                                    | `retry` voor queries: alleen netwerk/502/503/504, max. 2 keer                                                         |

Teksten: `message` is de (Nederlandse) tekst van de server. Wil je een eigen tekst, vertaal dan op `code`
(`network_error`, `precondition_failed`, `slug_conflict`, `state_conflict`, `theme_lint_failed`, …).

## Hooks (`queries/`)

Query-keys staan in `queries/keys.ts` (`themeKeys`, `paletteKeys`, `scriptKeys`, `dashboardKeys`); mutaties werken de cache zelf
bij (`queries/cache.ts`). Elke muterende call die de lock verschuift geeft `Locked<T>` terug: bewaar `lockVersion`
en stuur hem mee bij de volgende wijziging. Lees-hooks nemen optioneel `{ enabled, staleTime, refetchInterval }`;
een `null`/`undefined`-id betekent "nog niet laden".

- `themes.ts`: `useThemes`, `useThemesInfinite` (+ `flattenPages` uit `options.ts`), `useTheme`, `useCreateTheme`,
  `useUpdateTheme`, `useDeleteTheme`, `useRestoreTheme`, `useDuplicateTheme`, `useExportTheme`, `useImportTheme`,
  `useLocalFiles`, `useImportLocalFiles`.
- `editor.ts`: `useDraft`, `useSaveDraft`, `useLint`, `usePublishTheme`, `useVersions`, `useVersionsInfinite`,
  `useVersion`, `useDiff`, `useRollback`, `useResetDraft`.
- `palettes.ts`: `usePalettes`, `usePalette`. `dashboard.ts`: `useDashboard`. `health.ts`: `useHealth`.
- `scripts.ts` (thema-scripts, `/<naam>.js` uit de css-files-map): `useScripts`, `useScriptContent` (tekst),
  `useUploadScript` (`{ data, created }`; 409 `script_conflict` zonder `replace`), `useDeleteScript`,
  `useDownloadScript`. Geven `useScriptContent`, `useDeleteScript` of `useDownloadScript` 404
  (`isScriptGone`: bv. met de hand verwijderd), dan verdwijnt het script ook uit de lijst.

Elke hook heeft ook een gewone async functie (`fetchTheme`, `saveDraft`, `lintTheme`, …) en waar nuttig
query-opties (`themeQueries`, `editorQueries`, `paletteQueries`, `dashboardQueries`) voor `prefetchQuery`/
`ensureQueryData`.

Editor-afspraken: `useDraft` herlaadt nooit vanzelf (`staleTime: Infinity`); na een autosave staat de opgeslagen
draft in de cache. Gebruik `data.css` dus als beginwaarde, niet als gecontroleerde waarde. Alleen rollback en
een import met `new_version` laden de draft opnieuw. `useSaveDraft` draait ook offline (`networkMode: "always"`)
en faalt dan meteen met `network_error`, zodat de editor zelf kan bufferen.

## Tests (`testing/`)

Alleen voor tests: `createFetchMock()` (routes per methode/pad, `calls`, `callsTo`, `unhandled`), `json`,
`problem`, `etag`, `noContent`; fixtures `makeTheme`, `makeDraft`, `makeVersion`, `makePalette`, `makeScript`, `makeDashboard`,
… en `createTestQueryClient` / `createQueryWrapper` voor `renderHook`. Voorbeelden: `tests/unit/api-*.test.tsx`.
