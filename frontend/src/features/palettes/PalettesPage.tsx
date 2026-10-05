import { PlaceholderPage } from "@/components/PlaceholderPage";
import { useI18n } from "@/lib/i18n";

export function PalettesPage() {
  const { t } = useI18n();
  return <PlaceholderPage title={t("palettes.title")} hint={t("palettes.hint")} />;
}
