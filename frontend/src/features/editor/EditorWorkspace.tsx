import { useParams } from "react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { Badge } from "@/components/ui/badge";
import { t } from "@/lib/i18n";

export function EditorWorkspace() {
  const { themeId } = useParams<{ themeId: string }>();
  return (
    <PlaceholderPage title={t("nav.editor")}>
      <div>
        <Badge variant="outline" className="font-mono">
          themeId: {themeId}
        </Badge>
      </div>
    </PlaceholderPage>
  );
}
