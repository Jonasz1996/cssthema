import { PlaceholderPage } from "@/components/PlaceholderPage";
import { useI18n } from "@/lib/i18n";

export function ThemesPage() {
  const { t } = useI18n();
  return <PlaceholderPage title={t("themes.title")} hint={t("themes.hint")} />;
}
