import { useHealth } from "@/api/queries/health";
import { Category, ItemRow, Kpi, KpiGrid, PageHeader, Tag } from "@/components/ui";
import { type MessageKey, useI18n } from "@/lib/i18n";

const kpis: MessageKey[] = [
  "dashboard.kpiThemes",
  "dashboard.kpiPublished",
  "dashboard.kpiDraftDirty",
  "dashboard.kpiPalettes",
];

function HealthRow({
  path,
  label,
  hint,
}: {
  path: "/healthz" | "/readyz";
  label: MessageKey;
  hint: MessageKey;
}) {
  const { t } = useI18n();
  const { isPending, isError } = useHealth(path);
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
      {t(hint)}
    </ItemRow>
  );
}

export function DashboardPage() {
  const { t } = useI18n();
  return (
    <section>
      <PageHeader title={t("dashboard.title")} hint={t("dashboard.hint")} />
      <KpiGrid className="mb-5">
        {kpis.map((key) => (
          <Kpi key={key} label={t(key)} value="—" sub={t("dashboard.kpiPending")} />
        ))}
      </KpiGrid>
      <Category title={t("dashboard.systemStatus")} storageKey="dashboard.system">
        <HealthRow path="/healthz" label="dashboard.liveness" hint="dashboard.livenessHint" />
        <HealthRow path="/readyz" label="dashboard.readiness" hint="dashboard.readinessHint" />
      </Category>
    </section>
  );
}
