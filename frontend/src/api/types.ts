import type { components, operations } from "./schema";

/**
 * Korte namen voor de gegenereerde API-types (bron: `schema.d.ts`, niet met de hand wijzigen).
 * Velden blijven `snake_case`, precies zoals de API ze stuurt.
 */
type Schemas = components["schemas"];

export type Theme = Schemas["Theme"];
export type ThemePage = Schemas["ThemePage"];
export type ThemeStatus = Schemas["ThemeStatus"];
export type ThemeCreate = Schemas["ThemeCreate"];
export type ThemeUpdate = Schemas["ThemeUpdate"];
export type ThemeTemplate = Schemas["ThemeTemplate"];
export type DuplicateRequest = Schemas["DuplicateRequest"];
export type Draft = Schemas["Draft"];
export type LintResult = Schemas["LintResult"];
export type LintIssue = Schemas["LintIssueOut"];
export type Version = Schemas["Version"];
export type VersionSummary = Schemas["VersionSummary"];
export type VersionPage = Schemas["VersionPage"];
export type VersionSource = Schemas["VersionSource"];
export type VersionDiff = Schemas["VersionDiff"];
export type Palette = Schemas["Palette"];
export type Dashboard = Schemas["Dashboard"];
export type LocalCssFile = Schemas["LocalCssFile"];
export type LocalFilesSummary = Schemas["LocalFilesSummary"];
export type LocalImportRequest = Schemas["LocalImportRequest"];
export type LocalImportResult = Schemas["LocalImportResult"];
export type ImportedTheme = Schemas["ImportedTheme"];
export type SkippedFile = Schemas["SkippedFile"];
export type ScriptFile = Schemas["ScriptFile"];
export type HostBinding = Schemas["HostBinding"];
export type HostBindingInput = Schemas["HostBindingInput"];
export type HostOptions = Schemas["HostOptions"];
export type HostImportRequest = Schemas["HostImportRequest"];
export type HostImportResult = Schemas["HostImportResult"];
export type UserRef = Schemas["UserRef"];
export type EtagState = Schemas["EtagState"];
export type Problem = Schemas["Problem"];

type ThemesListQuery = NonNullable<operations["themes_list"]["parameters"]["query"]>;

/** Filters van `GET /themes` (zonder `cursor`; die beheert de infinite query). */
export type ThemeListFilters = Omit<ThemesListQuery, "cursor">;
export type ThemeSort = NonNullable<ThemesListQuery["sort"]>;

/** Eén kant van een diff: een versienummer of de huidige draft. */
export type DiffRef = number | "draft";

export type ExportFormat = "css" | "bundle";
export type ImportConflict = Schemas["Body_themes_import"]["on_conflict"];

/**
 * Antwoord van een muterende call samen met de nieuwe lock-toestand van het thema
 * (`ETag: "lv-<n>"`). Bewaar `lockVersion` en stuur hem mee bij de volgende wijziging.
 */
export interface Locked<T> {
  data: T;
  /** Zoals de server hem stuurde, bv. `"lv-13"` (met aanhalingstekens). */
  etag: string;
  lockVersion: number;
}
