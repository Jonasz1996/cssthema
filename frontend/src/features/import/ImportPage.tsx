import { useSearchParams } from "react-router";
import { useShellCommand } from "@/app/shell-command";
import { PageHeader, TabPanel, Tabs } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { LocalFilesPanel } from "./components/LocalFilesPanel";
import { ScriptsPanel } from "./components/ScriptsPanel";
import { UploadPanel } from "./components/UploadPanel";

type ImportTab = "server" | "upload" | "scripts";

const TABS_ID = "import";

function tabOf(value: string | null): ImportTab {
  return value === "upload" || value === "scripts" ? value : "server";
}

/**
 * Import (`/import`): handgemaakte CSS-bestanden van de server binnenhalen, een `.css` /
 * `.cssthema.zip` / `.js` uploaden, en de thema-scripts (`/<naam>.js`) beheren. Exporteren staat
 * bij het thema zelf (menu op de kaart).
 */
export function ImportPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = tabOf(params.get("tab"));

  // De tab Uploaden zet zijn eigen commando (`cssthema scripts upload …` als er alleen
  // scripts gekozen zijn).
  useShellCommand(
    tab === "server" ? "cssthema import --local" : tab === "scripts" && "cssthema scripts",
  );

  const setTab = (next: ImportTab) =>
    setParams(
      (previous) => {
        const search = new URLSearchParams(previous);
        if (next === "server") search.delete("tab");
        else search.set("tab", next);
        return search;
      },
      { replace: true },
    );

  return (
    <section>
      <PageHeader title={t("import.title")} hint={t("import.hint")} />
      <Tabs<ImportTab>
        id={TABS_ID}
        label={t("import.tabsLabel")}
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "server", label: `🗄️ ${t("import.tabServer")}` },
          { value: "upload", label: `⬆️ ${t("import.tabUpload")}` },
          { value: "scripts", label: `📜 ${t("import.tabScripts")}` },
        ]}
        className="mb-3.5"
      />
      <TabPanel id={TABS_ID} value="server" selected={tab} className="p-0.5">
        <LocalFilesPanel />
      </TabPanel>
      <TabPanel id={TABS_ID} value="upload" selected={tab} className="p-0.5">
        <UploadPanel />
      </TabPanel>
      <TabPanel id={TABS_ID} value="scripts" selected={tab} className="p-0.5">
        <ScriptsPanel />
      </TabPanel>
    </section>
  );
}
