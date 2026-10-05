import { useHealth } from "@/api/queries/health";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type MessageKey, t } from "@/lib/i18n";

const stats: MessageKey[] = [
  "dashboard.services",
  "dashboard.themes",
  "dashboard.published",
  "dashboard.requests24h",
];

function HealthRow({ path, label }: { path: "/healthz" | "/readyz"; label: MessageKey }) {
  const { isPending, isError } = useHealth(path);
  return (
    <li className="flex items-center justify-between py-2">
      <span className="text-sm">{t(label)}</span>
      {isPending ? (
        <Badge variant="outline">{t("status.checking")}</Badge>
      ) : isError ? (
        <Badge variant="danger">{t("status.error")}</Badge>
      ) : (
        <Badge variant="success">{t("status.ok")}</Badge>
      )}
    </li>
  );
}

export function DashboardPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("nav.dashboard")}</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((key) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle>{t(key)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">—</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{t("dashboard.systemStatus")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            <HealthRow path="/healthz" label="dashboard.liveness" />
            <HealthRow path="/readyz" label="dashboard.readiness" />
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
