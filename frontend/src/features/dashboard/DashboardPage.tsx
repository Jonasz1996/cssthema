import { Link } from "react-router";
import { HealthError } from "@/api/client";
import { useDashboard } from "@/api/queries/dashboard";
import { useHealth } from "@/api/queries/health";
import type { Theme } from "@/api/types";
import {
  Button,
  ButtonLink,
  Callout,
  Category,
  Code,
  Empty,
  ItemRow,
  Kpi,
  KpiGrid,
  Loading,
  PageHeader,
  Tag,
} from "@/components/ui";
import { ThemeStatusTags } from "@/features/themes/components/ThemeStatusTags";
import { editorPath } from "@/features/themes/lib/actions";
import { errorText } from "@/features/themes/lib/errors";
import { formatDateTime, formatRelativeTime } from "@/features/themes/lib/format";
import { countOf, listOf } from "@/features/themes/lib/list";
import { themeSeverity } from "@/features/themes/lib/status";
import { type I18n, intlLocale, type MessageKey, useI18n } from "@/lib/i18n";

/** Getal voor een KPI-tegel; "—" zolang het (nog) niet bekend is. */
function kpiValue(value: number | null, locale: string): string {
  return value === null ? "—" : value.toLocaleString(locale);
}

const CHECK_LABELS: Readonly<Record<string, MessageKey>> = {
  database: "dashboard.checkDatabase",
  redis: "dashboard.checkRedis",
};

/** Wat er mis is met een health-endpoint, per onderdeel als `/readyz` dat meegaf. */
function healthErrorText(error: Error | null, { t }: Pick<I18n, "t">): string {
  if (!(error instanceof HealthError)) return t("dashboard.healthUnreachable");
  const checks = Object.entries(error.checks);
  if (!checks.length) return t("dashboard.healthHttp", { status: error.status });
  const parts = checks.map(([name, value]) => {
    const key = CHECK_LABELS[name];
    const status = value === "ok" ? t("common.statusOk") : t("common.statusError");
    return `${key ? t(key) : name}: ${status}`;
  });
  return t("dashboard.healthChecks", { checks: parts.join(" · ") });
}

function HealthRow({
  path,
  label,
  hint,
}: {
  path: "/healthz" | "/readyz";
  label: MessageKey;
  hint: MessageKey;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { isPending, isError, error } = useHealth(path);
  const state = isPending ? "checking" : isError ? "error" : "ok";
  return (
    <ItemRow
      data-health={path}
      severity={state === "ok" ? "ok" : state === "error" ? "err" : "default"}
      title={t(label)}
      tags={
        <Tag tone={state === "ok" ? "ok" : state === "error" ? "err" : "default"}>
          {state === "ok"
            ? t("common.statusOk")
            : state === "error"
              ? t("common.statusError")
              : t("common.statusChecking")}
        </Tag>
      }
    >
      {state === "error" ? healthErrorText(error, i18n) : t(hint)}
    </ItemRow>
  );
}

function RecentRow({ theme }: { theme: Theme }) {
  const { t, locale } = useI18n();
  const updated = theme.draft_updated_at ?? theme.updated_at;
  const author = theme.draft_updated_by?.display_name ?? theme.created_by?.display_name;
  return (
    <ItemRow
      data-recent={theme.slug}
      severity={themeSeverity(theme)}
      title={theme.name}
      tags={<ThemeStatusTags theme={theme} />}
      meta={
        <>
          <Code>/{theme.slug}.css</Code>
          {" · "}
          <time dateTime={updated} title={formatDateTime(updated, locale)}>
            {t("themes.updatedAgo", { time: formatRelativeTime(updated, locale) })}
          </time>
          {author && ` · ${t("dashboard.byUser", { name: author })}`}
        </>
      }
      actions={
        <ButtonLink
          variant="mini"
          to={editorPath(theme.id)}
          aria-label={t("themes.openNamed", { name: theme.name })}
        >
          ✎ {t("themes.actionOpen")}
        </ButtonLink>
      }
    />
  );
}

/**
 * Dashboard (docs/04 § 3.1, F-PL-02 basis): KPI's uit `GET /dashboard`, een opvallend blok als
 * er handgemaakte CSS-bestanden te importeren zijn, recent gewijzigde thema's en de
 * systeemstatus.
 */
export function DashboardPage() {
  const i18n = useI18n();
  const { t, tc, locale } = i18n;
  const dashboard = useDashboard();
  const data = dashboard.data;
  const intl = intlLocale(locale);

  const total = countOf(data?.themes_total);
  const published = countOf(data?.themes_published);
  const dirty = countOf(data?.themes_draft_dirty);
  const deleted = countOf(data?.themes_deleted);
  const palettes = countOf(data?.palettes_total);
  const recent = listOf(data?.recent);
  const localDir = typeof data?.local_files?.dir === "string" ? data.local_files.dir : "";
  const localTotal = countOf(data?.local_files?.total);
  const importable = countOf(data?.local_files?.importable) ?? 0;

  return (
    <section>
      <PageHeader
        title={t("dashboard.title")}
        hint={t("dashboard.hint")}
        actions={
          <>
            <ButtonLink variant="primary" to="/themes?new=1">
              + {t("dashboard.newTheme")}
            </ButtonLink>
            <ButtonLink to="/themes">
              <span aria-hidden>🎨</span>
              {t("dashboard.allThemes")}
            </ButtonLink>
          </>
        }
      />

      {importable > 0 && (
        <Callout
          tone="mid"
          data-local-files-callout=""
          title={`📂 ${tc("dashboard.localFilesTitle", importable)}`}
          actions={
            <ButtonLink variant="primary" size="sm" to="/import">
              <span aria-hidden>📥</span>
              {t("dashboard.localFilesAction")}
            </ButtonLink>
          }
        >
          {t("dashboard.localFilesText", { dir: localDir })}
        </Callout>
      )}

      {dashboard.isError && (
        <Callout
          tone="err"
          title={t("dashboard.loadError")}
          actions={
            <Button variant="alt" size="sm" onClick={() => void dashboard.refetch()}>
              ⟳ {t("themes.retry")}
            </Button>
          }
        >
          {errorText(dashboard.error, i18n)}
        </Callout>
      )}

      <KpiGrid className="mb-5" aria-busy={dashboard.isPending || undefined}>
        <Kpi
          label={t("dashboard.kpiThemes")}
          value={kpiValue(total, intl)}
          sub={
            total || deleted ? (
              <>
                {total ? (
                  <Link to="/themes" className="text-muted hover:text-white">
                    {t("dashboard.view")} →
                  </Link>
                ) : null}
                {total && deleted ? " · " : null}
                {deleted ? (
                  <Link to="/themes?status=deleted" className="text-muted hover:text-white">
                    {tc("dashboard.kpiDeleted", deleted)}
                  </Link>
                ) : null}
              </>
            ) : undefined
          }
        />
        <Kpi
          label={t("dashboard.kpiPublished")}
          value={kpiValue(published, intl)}
          tone={published ? "ok" : "default"}
          sub={
            published ? (
              <Link to="/themes?status=live" className="text-muted hover:text-white">
                {t("dashboard.view")} →
              </Link>
            ) : undefined
          }
        />
        <Kpi
          label={t("dashboard.kpiDraftDirty")}
          value={kpiValue(dirty, intl)}
          tone={dirty ? "mid" : "default"}
          sub={
            dirty ? (
              <Link to="/themes?status=dirty" className="text-muted hover:text-white">
                {t("dashboard.kpiDraftDirtySub")} →
              </Link>
            ) : undefined
          }
        />
        <Kpi
          label={t("dashboard.kpiPalettes")}
          value={kpiValue(palettes, intl)}
          sub={
            palettes ? (
              <Link to="/palettes" className="text-muted hover:text-white">
                {t("dashboard.view")} →
              </Link>
            ) : undefined
          }
        />
      </KpiGrid>

      <Category
        title={t("dashboard.recent")}
        count={dashboard.isPending ? undefined : recent.length}
        meta={
          <Link to="/themes" className="text-dim hover:text-white">
            {t("dashboard.allThemes")} →
          </Link>
        }
        storageKey="dashboard.recent"
      >
        {dashboard.isPending ? (
          <Loading />
        ) : recent.length ? (
          recent.map((theme) => <RecentRow key={theme.id} theme={theme} />)
        ) : (
          <Empty>{t("dashboard.recentEmpty")}</Empty>
        )}
      </Category>

      <Category title={t("dashboard.systemStatus")} storageKey="dashboard.system">
        <HealthRow path="/healthz" label="dashboard.liveness" hint="dashboard.livenessHint" />
        <HealthRow path="/readyz" label="dashboard.readiness" hint="dashboard.readinessHint" />
        {localTotal !== null && (
          <ItemRow
            data-local-files=""
            severity={importable > 0 ? "mid" : "ok"}
            title={t("dashboard.localFiles")}
            tags={
              <>
                <Tag>{tc("dashboard.localFilesTotal", localTotal)}</Tag>
                {importable > 0 && (
                  <Tag tone="mid">{tc("dashboard.localFilesImportable", importable)}</Tag>
                )}
              </>
            }
            actions={
              localTotal > 0 ? (
                <ButtonLink variant="mini" to="/import">
                  {t("dashboard.localFilesOpen")}
                </ButtonLink>
              ) : undefined
            }
          >
            {t("dashboard.localFilesHint")} <Code>{localDir}</Code>
          </ItemRow>
        )}
      </Category>
    </section>
  );
}
