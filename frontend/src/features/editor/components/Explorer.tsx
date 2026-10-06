import { type ReactNode, useDeferredValue, useState } from "react";
import { Link } from "react-router";
import { flattenPages } from "@/api/queries/options";
import { useThemesInfinite } from "@/api/queries/themes";
import type { Theme } from "@/api/types";
import { Button, Input, Loading } from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { paletteTokens } from "../palette";

export interface ExplorerProps {
  id: string;
  currentTheme: Theme | undefined;
  palette: { name: string; tokens: Readonly<Record<string, string>> } | null;
  /** `var(--ct-…)` invoegen in de editor. */
  onInsert: (text: string) => void;
  onClose: () => void;
  className?: string;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="m-0 mt-3 mb-1 px-2 text-[11px] font-normal tracking-[.08em] text-muted uppercase">
      {children}
    </h2>
  );
}

/**
 * Verkenner links in de editor (docs/04 § 3.2): thema's (filter, openen), onder het huidige
 * thema de draft en de versies, en de tokens van het gekoppelde palet (klik = invoegen).
 */
export function Explorer({
  id,
  currentTheme,
  palette,
  onInsert,
  onClose,
  className,
}: ExplorerProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const [filter, setFilter] = useState("");
  const query = useDeferredValue(filter.trim());
  const themes = useThemesInfinite({ q: query || undefined, sort: "name", limit: 50 });
  const items = flattenPages(themes.data);
  const tokens = paletteTokens(palette?.tokens);

  return (
    <aside
      id={id}
      aria-label={t("editor.explorerLabel")}
      className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-black/30", className)}
    >
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <span className="text-[11px] tracking-[.08em] text-muted uppercase">
          {t("editor.explorerTitle")}
        </span>
        <Button
          variant="mini"
          size="icon"
          tone="danger"
          className="ml-auto"
          aria-label={t("editor.explorerHide")}
          title={t("editor.explorerHide")}
          onClick={onClose}
        >
          ✕
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
        <div className="px-1 pt-2">
          <Input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("editor.explorerFilter")}
            aria-label={t("editor.explorerFilter")}
            className="px-2.5 py-1.5 text-[12.5px]"
          />
        </div>

        <SectionTitle>{t("editor.explorerThemes")}</SectionTitle>
        {themes.isPending ? (
          <Loading className="px-2 py-1 text-[12px]" />
        ) : themes.isError ? (
          <p className="m-0 px-2 text-[12px] text-err">{errorText(themes.error, i18n)}</p>
        ) : items.length === 0 ? (
          <p className="m-0 px-2 text-[12px] text-dim">{t("editor.explorerNoThemes")}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {items.map((theme) => {
              const current = theme.id === currentTheme?.id;
              return (
                <li key={theme.id}>
                  <Link
                    to={`/editor/${theme.id}`}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-baseline gap-1.5 rounded-md px-2 py-1 text-[12.5px] no-underline outline-none",
                      "focus-visible:outline-2 focus-visible:outline-white",
                      current ? "bg-white/12 text-white" : "text-fg hover:bg-white/6",
                    )}
                  >
                    <span aria-hidden className="text-dim">
                      {current ? "▾" : "▸"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{theme.name}</span>
                    {theme.published_version ? (
                      <span className="flex-none text-[11px] text-ok">
                        v{theme.published_version.version_number}
                      </span>
                    ) : (
                      <span className="flex-none text-[11px] text-dim">
                        {t("editor.explorerDraftOnly")}
                      </span>
                    )}
                    {theme.deleted_at && (
                      <span className="flex-none text-[11px] text-err">
                        {t("editor.statusDeleted")}
                      </span>
                    )}
                  </Link>
                  {current && (
                    <ul className="m-0 mb-1 ml-5 list-none border-l border-line p-0 pl-2 text-[12px]">
                      <li className="flex items-center gap-1.5 py-0.5 text-muted">
                        <span
                          aria-hidden
                          className={
                            !currentTheme?.published_version
                              ? "text-dim"
                              : currentTheme.draft_dirty
                                ? "text-mid"
                                : "text-ok"
                          }
                        >
                          ●
                        </span>
                        {!currentTheme?.published_version
                          ? t("editor.statusNeverPublished")
                          : currentTheme.draft_dirty
                            ? t("editor.explorerDraftChanged")
                            : t("editor.explorerDraftClean")}
                      </li>
                      <li>
                        <Link
                          to={`/editor/${theme.id}/versions`}
                          className="block rounded py-0.5 text-muted no-underline outline-none hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                        >
                          <span aria-hidden>▸ </span>
                          {t("editor.explorerVersions")}
                        </Link>
                      </li>
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {themes.hasNextPage && (
          <Button
            variant="mini"
            className="mt-1 ml-2"
            disabled={themes.isFetchingNextPage}
            onClick={() => void themes.fetchNextPage()}
          >
            {t("editor.loadMore")}
          </Button>
        )}

        <SectionTitle>
          {palette ? t("editor.explorerPalette", { name: palette.name }) : t("editor.noPalette")}
        </SectionTitle>
        {palette && tokens.length > 0 && (
          <>
            <p className="m-0 mb-1 px-2 text-[11.5px] leading-[1.45] text-dim">
              {t("editor.explorerPaletteHint")}
            </p>
            <ul className="m-0 list-none p-0">
              {tokens.map((token) => (
                <li key={token.name}>
                  <button
                    type="button"
                    onClick={() => onInsert(`var(${token.variable})`)}
                    title={t("editor.insertToken", { text: `var(${token.variable})` })}
                    aria-label={`${t("editor.insertToken", { text: `var(${token.variable})` })} · ${token.value}`}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-[3px] text-left text-[12px] text-fg outline-none hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <span
                      aria-hidden
                      className="size-3.5 flex-none rounded-[4px] border border-white/20"
                      style={{ background: token.isColor ? token.value : "transparent" }}
                    />
                    <span className="min-w-0 flex-1 truncate">{token.variable}</span>
                    <span className="max-w-[45%] flex-none truncate text-[11px] text-dim">
                      {token.value}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
