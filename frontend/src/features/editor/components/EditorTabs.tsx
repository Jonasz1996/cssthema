import { Link } from "react-router";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { peekSession, useSessionValue } from "../autosave/sessions";
import type { EditorTab } from "../store";

function TabDirtyMark({ id }: { id: string }) {
  const { t } = useI18n();
  const session = peekSession(id);
  const unsynced = useSessionValue(
    session,
    (snapshot) => snapshot.dirty || snapshot.state.kind === "conflict",
    false,
  );
  if (!unsynced) return null;
  return (
    <span className="text-mid" title={t("editor.tabUnsaved")}>
      <span aria-hidden>●</span>
      <span className="sr-only">{t("editor.tabUnsaved")}</span>
    </span>
  );
}

export interface EditorTabsProps {
  tabs: readonly EditorTab[];
  activeId: string;
  onClose: (id: string) => void;
}

/**
 * Tabs voor de open thema's (bewaard in localStorage). Een tab is een gewone link naar de
 * editor van dat thema; ✕ (of middelklik) sluit hem nadat openstaande wijzigingen opgeslagen zijn.
 */
export function EditorTabs({ tabs, activeId, onClose }: EditorTabsProps) {
  const { t } = useI18n();
  if (!tabs.length) return null;
  return (
    <nav aria-label={t("editor.tabsLabel")} className="min-w-0">
      <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 pb-1">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <li
              key={tab.id}
              className={cn(
                "flex flex-none items-center gap-0.5 rounded-t-lg border border-b-0 pr-1 text-[12.5px]",
                active
                  ? "border-line-strong bg-white/10 text-white"
                  : "border-line bg-white/3 text-muted hover:text-fg",
              )}
            >
              <Link
                to={`/editor/${tab.id}`}
                aria-current={active ? "page" : undefined}
                onAuxClick={(event) => {
                  if (event.button !== 1) return;
                  event.preventDefault();
                  onClose(tab.id);
                }}
                className="flex items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 no-underline outline-none focus-visible:outline-2 focus-visible:outline-white"
                title={tab.slug}
              >
                <span className="max-w-[18ch] truncate">{tab.slug}.css</span>
                <TabDirtyMark id={tab.id} />
              </Link>
              <Button
                variant="mini"
                size="icon"
                tone="danger"
                className="size-5 text-[11px]"
                aria-label={t("editor.tabClose", { name: tab.name })}
                title={t("editor.tabClose", { name: tab.name })}
                onClick={() => onClose(tab.id)}
              >
                ✕
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
