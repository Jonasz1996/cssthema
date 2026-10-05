import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { flattenPages } from "@/api/queries/options";
import { usePalettes } from "@/api/queries/palettes";
import { useThemesInfinite } from "@/api/queries/themes";
import type { Theme } from "@/api/types";
import { useShellCommand } from "@/app/shell-command";
import {
  Button,
  ButtonLink,
  Callout,
  ConfirmDialog,
  Empty,
  Input,
  Loading,
  PageHeader,
  Select,
  toast,
} from "@/components/ui";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { DuplicateThemeDialog } from "./components/DuplicateThemeDialog";
import { NewThemeDialog } from "./components/NewThemeDialog";
import { ThemeCard } from "./components/ThemeCard";
import { useDebouncedValue } from "./hooks/use-debounced-value";
import { useThemeCommands } from "./hooks/use-theme-commands";
import { editorPath, type ThemeAction } from "./lib/actions";
import { errorText } from "./lib/errors";
import {
  type BrowserFilters,
  EMPTY_FILTERS,
  hasActiveFilters,
  matchesStatus,
  PAGE_SIZE,
  parseFilters,
  shouldLoadMore,
  STATUS_FILTERS,
  type StatusFilter,
  THEME_SORTS,
  toApiFilters,
  writeFilters,
} from "./lib/filters";
import { listOf } from "./lib/list";

const STATUS_LABELS: Record<StatusFilter, MessageKey> = {
  all: "themes.statusAll",
  live: "themes.statusLive",
  dirty: "themes.statusDirty",
  never: "themes.statusNever",
  deleted: "themes.statusDeleted",
};

const SORT_LABELS: Record<(typeof THEME_SORTS)[number], MessageKey> = {
  "-updated_at": "themes.sortUpdated",
  name: "themes.sortName",
  "-created_at": "themes.sortCreated",
};

interface PendingDelete {
  theme: Theme;
  card: HTMLElement | null;
  hard: boolean;
}

/** Terminalcommando dat de huidige filters weergeeft, bv. `cssthema themes --status live`. */
function shellCommand(filters: BrowserFilters, paletteSlug: string | undefined): string {
  const parts = ["cssthema themes"];
  if (filters.q.trim()) parts.push(`--search ${JSON.stringify(filters.q.trim())}`);
  if (filters.status !== "all") parts.push(`--status ${filters.status}`);
  if (paletteSlug) parts.push(`--palette ${paletteSlug}`);
  return parts.join(" ");
}

/**
 * Themabrowser (`/themes`, docs/04 § 3.5 zonder screenshots): kaarten met status, zoeken en
 * filteren (bewaard in de URL), nieuw thema, en per kaart openen, dupliceren, exporteren, URL
 * kopiëren, verwijderen en herstellen. Paginering met "meer laden".
 */
export function ThemesPage() {
  const i18n = useI18n();
  const { t, tc } = i18n;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const debouncedQ = useDebouncedValue(filters.q, 250);
  const apiFilters = toApiFilters({ ...filters, q: debouncedQ });

  const themes = useThemesInfinite(apiFilters);
  const paletteList = listOf(usePalettes().data);
  const paletteById = new Map(paletteList.map((palette) => [palette.id, palette]));
  const commands = useThemeCommands();

  const filterKey = `${JSON.stringify(apiFilters)}|${filters.status}`;
  const [wanted, setWanted] = useState({ key: filterKey, count: PAGE_SIZE });
  const wantedCount = wanted.key === filterKey ? wanted.count : PAGE_SIZE;
  const matching = listOf(flattenPages(themes.data)).filter((theme) =>
    matchesStatus(theme, filters.status),
  );
  const visible = matching.slice(0, wantedCount);
  const hasMore = matching.length > wantedCount || Boolean(themes.hasNextPage);

  const { hasNextPage, isFetching, fetchNextPage } = themes;
  useEffect(() => {
    if (
      shouldLoadMore({
        visible: matching.length,
        wanted: wantedCount,
        hasNextPage: Boolean(hasNextPage),
        isFetching,
      })
    ) {
      void fetchNextPage();
    }
  }, [matching.length, wantedCount, hasNextPage, isFetching, fetchNextPage]);

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [duplicating, setDuplicating] = useState<Theme | null>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const resultsTitleId = useId();
  const newOpen = params.get("new") === "1";

  useShellCommand(shellCommand(filters, paletteById.get(filters.palette)?.slug));

  const update = (patch: Partial<BrowserFilters>) =>
    setParams((previous) => writeFilters(previous, { ...parseFilters(previous), ...patch }), {
      replace: true,
    });

  const setNewOpen = (open: boolean) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (open) next.set("new", "1");
        else next.delete("new");
        return next;
      },
      { replace: true },
    );

  const onAction = (action: ThemeAction, theme: Theme, card: HTMLElement | null) => {
    switch (action) {
      case "duplicate":
        setDuplicating(theme);
        break;
      case "export-css":
        void commands.exportTheme(theme, "css");
        break;
      case "export-bundle":
        void commands.exportTheme(theme, "bundle");
        break;
      case "copy-url":
        void commands.copyUrl(theme);
        break;
      case "delete":
        setPendingDelete({ theme, card, hard: false });
        break;
      case "purge":
        setPendingDelete({ theme, card, hard: true });
        break;
      case "restore":
        // Herstelde thema's vallen uit het filter "Verwijderd" (de enige plek met deze actie):
        // de focus gaat dan, net als na verwijderen, naar de resultaten in plaats van naar <body>.
        void commands.restore(theme, card).then((ok) => {
          if (ok) resultsRef.current?.focus();
        });
        break;
    }
  };

  const confirmDelete = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    void commands.remove(target.theme, target.card, { hard: target.hard }).then((ok) => {
      if (ok) resultsRef.current?.focus();
    });
  };

  const filtered = hasActiveFilters(filters);
  const countText = themes.isPending
    ? ""
    : `${tc("themes.count", visible.length)}${hasMore ? ` · ${t("themes.countMore")}` : ""}`;

  return (
    <section>
      <PageHeader
        title={t("themes.title")}
        hint={t("themes.hint")}
        actions={
          <>
            <Button onClick={() => setNewOpen(true)}>+ {t("themes.new")}</Button>
            <ButtonLink to="/import">
              <span aria-hidden>📥</span>
              {t("themes.importLink")}
            </ButtonLink>
          </>
        }
      />

      <div
        role="search"
        aria-label={t("themes.filtersLabel")}
        className="mb-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
      >
        <Input
          type="search"
          value={filters.q}
          onChange={(event) => update({ q: event.target.value })}
          placeholder={t("themes.searchPlaceholder")}
          aria-label={t("themes.search")}
          className="sm:col-span-2 lg:col-span-1"
        />
        <Select
          value={filters.status}
          onChange={(event) => update({ status: event.target.value as StatusFilter })}
          aria-label={t("themes.filterStatus")}
        >
          {STATUS_FILTERS.map((status) => (
            <option key={status} value={status}>
              {t(STATUS_LABELS[status])}
            </option>
          ))}
        </Select>
        <Select
          value={filters.palette}
          onChange={(event) => update({ palette: event.target.value })}
          aria-label={t("themes.filterPalette")}
        >
          <option value="">{t("themes.allPalettes")}</option>
          {paletteList.map((palette) => (
            <option key={palette.id} value={palette.id}>
              {palette.name}
            </option>
          ))}
        </Select>
        <Select
          value={filters.sort}
          onChange={(event) => update({ sort: event.target.value as BrowserFilters["sort"] })}
          aria-label={t("themes.sortLabel")}
        >
          {THEME_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(SORT_LABELS[sort])}
            </option>
          ))}
        </Select>
      </div>

      <section
        ref={resultsRef}
        tabIndex={-1}
        aria-labelledby={resultsTitleId}
        aria-busy={themes.isFetching || undefined}
        className="outline-none"
      >
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={resultsTitleId} className="m-0 text-[13px] font-bold text-heading">
            {t("themes.results")}
          </h2>
          <p role="status" className="m-0 text-[12px] text-muted">
            {countText}
          </p>
        </div>

        {themes.isPending ? (
          <Loading label={t("themes.loading")} />
        ) : themes.isError && !themes.data ? (
          <Callout
            tone="err"
            title={t("themes.loadError")}
            actions={
              <Button variant="alt" size="sm" onClick={() => void themes.refetch()}>
                ⟳ {t("themes.retry")}
              </Button>
            }
          >
            {errorText(themes.error, i18n)}
          </Callout>
        ) : visible.length === 0 && !hasMore ? (
          filtered ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <Empty>{t("themes.noResults")}</Empty>
              <Button variant="mini" onClick={() => update(EMPTY_FILTERS)}>
                {t("themes.clearFilters")}
              </Button>
            </div>
          ) : (
            <Callout
              title={t("themes.emptyTitle")}
              actions={
                <>
                  <Button size="sm" onClick={() => setNewOpen(true)}>
                    + {t("themes.new")}
                  </Button>
                  <ButtonLink size="sm" to="/import">
                    <span aria-hidden>📥</span>
                    {t("themes.emptyImport")}
                  </ButtonLink>
                </>
              }
            >
              {t("themes.emptyText")}
            </Callout>
          )
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-2.5 p-0">
            {visible.map((theme) => (
              <li key={`${theme.id}:${theme.deleted_at ?? ""}`} className="min-w-0">
                <ThemeCard
                  theme={theme}
                  palette={theme.palette_id ? paletteById.get(theme.palette_id) : null}
                  busy={commands.busyIds.has(theme.id)}
                  onAction={onAction}
                />
              </li>
            ))}
          </ul>
        )}

        {hasMore && !themes.isPending && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="alt"
              onClick={() => setWanted({ key: filterKey, count: wantedCount + PAGE_SIZE })}
              disabled={themes.isFetchingNextPage}
              aria-busy={themes.isFetchingNextPage || undefined}
            >
              {themes.isFetchingNextPage ? t("themes.loading") : `↓ ${t("themes.loadMore")}`}
            </Button>
          </div>
        )}
      </section>

      <NewThemeDialog
        open={newOpen}
        initialPaletteId={filters.palette}
        onClose={() => setNewOpen(false)}
        onCreated={(theme) => {
          setNewOpen(false);
          toast.ok(t("themes.created", { name: theme.name }));
          void navigate(editorPath(theme.id));
        }}
      />

      <DuplicateThemeDialog
        theme={duplicating}
        onClose={() => setDuplicating(null)}
        onDuplicated={(copy) => {
          setDuplicating(null);
          toast.ok(
            <span>
              {t("themes.duplicated", { name: copy.name })}{" "}
              <Link to={editorPath(copy.id)} className="text-white underline">
                {t("themes.actionOpen")}
              </Link>
            </span>,
          );
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        command={`cssthema rm${pendingDelete?.hard ? " --hard" : ""} ${pendingDelete?.theme.slug ?? ""}`}
        title={
          pendingDelete?.hard
            ? t("themes.purgeTitle", { name: pendingDelete.theme.name })
            : t("themes.deleteTitle", { name: pendingDelete?.theme.name ?? "" })
        }
        confirmLabel={
          pendingDelete?.hard ? `✕ ${t("themes.purgeConfirm")}` : `⚡ ${t("themes.deleteConfirm")}`
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        {pendingDelete &&
          (pendingDelete.hard
            ? t("themes.purgeText")
            : t("themes.deleteText", { file: `/${pendingDelete.theme.slug}.css` }))}
      </ConfirmDialog>
    </section>
  );
}
