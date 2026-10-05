import { PlaceholderPage } from "@/components/PlaceholderPage";
import { useI18n } from "@/lib/i18n";

export function ImportPage() {
  const { t } = useI18n();
  return <PlaceholderPage title={t("import.title")} hint={t("import.hint")} />;
}
