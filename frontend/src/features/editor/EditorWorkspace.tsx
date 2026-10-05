import { useParams } from "react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { Code } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export function EditorWorkspace() {
  const { t } = useI18n();
  const { themeId } = useParams<{ themeId: string }>();
  return (
    <PlaceholderPage
      title={t("editor.title")}
      hint={
        <>
          {t("editor.hint")} <Code>themeId={themeId}</Code>
        </>
      }
    />
  );
}
