import { PlaceholderPage } from "@/components/PlaceholderPage";
import { useI18n } from "@/lib/i18n";

export function JobsPage() {
  const { t } = useI18n();
  return <PlaceholderPage title={t("nav.jobs")} />;
}
