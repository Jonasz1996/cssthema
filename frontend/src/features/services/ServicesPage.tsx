import { useId, useState } from "react";
import { useDeleteService, useServices } from "@/api/queries/services";
import type { ServiceSummary } from "@/api/types";
import {
  Button,
  Callout,
  ConfirmDialog,
  Empty,
  Input,
  Loading,
  PageHeader,
  toast,
} from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { listOf } from "@/features/themes/lib/list";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { CaptureHelp } from "./components/CaptureHelp";
import { CaptureUpload } from "./components/CaptureUpload";
import { ScreenshotDialog, type ScreenshotTarget } from "./components/ScreenshotDialog";
import { ServiceCard } from "./components/ServiceCard";
import {
  filterServices,
  SERVICE_ERROR_KEYS,
  SNAPSHOT_FILTERS,
  type SnapshotFilter,
} from "./lib/services";

const FILTER_LABELS: Record<SnapshotFilter, MessageKey> = {
  all: "services.filterAll",
  with: "services.filterWith",
  without: "services.filterWithout",
};

/**
 * Services (`/services`): de apps uit de zips van `vastleggen.py`. Bovenaan de zips uploaden;
 * daaronder per service de status van de laatste snapshot, frameworks, wanneer vastgelegd en
 * de screenshots (origineel, met thema, mobiel). Zoeken op naam en hostnaam, filteren op met of
 * zonder snapshot, en verwijderen.
 */
export function ServicesPage() {
  const i18n = useI18n();
  const { t, tc } = i18n;
  const services = useServices();
  const remove = useDeleteService();
  const listTitleId = useId();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SnapshotFilter>("all");
  const [zoom, setZoom] = useState<ScreenshotTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ServiceSummary | null>(null);

  const list = listOf(services.data);
  const visible = filterServices(list, query, filter);
  const filtered = query.trim() !== "" || filter !== "all";

  const confirmDelete = () => {
    const service = pendingDelete;
    if (!service) return;
    remove.mutate(service.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.ok(t("services.deleted", { name: service.name }));
      },
      onError: (error) => {
        setPendingDelete(null);
        toast.err(errorText(error, i18n, SERVICE_ERROR_KEYS));
      },
    });
  };

  return (
    <div>
      <PageHeader title={t("services.title")} hint={t("services.hint")} />
      <Callout className="max-w-[90ch]">{t("services.intro")}</Callout>

      <CaptureUpload showHelp={list.length > 0} />

      <section aria-labelledby={listTitleId} aria-busy={services.isFetching || undefined}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <h2 id={listTitleId} className="m-0 text-[13px] font-bold text-heading">
            {t("services.listTitle")}
          </h2>
          {services.isSuccess && (
            <p role="status" className="m-0 text-[12px] text-muted">
              {filtered
                ? t("services.filtered", { shown: visible.length, total: list.length })
                : tc("services.summary", list.length)}
            </p>
          )}
        </div>
        <div role="search" className="mb-2.5 flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("services.searchPlaceholder")}
            aria-label={t("services.search")}
            className="max-w-[420px] flex-1"
          />
          <div role="group" aria-label={t("services.filterLabel")} className="flex flex-wrap gap-1">
            {SNAPSHOT_FILTERS.map((value) => (
              <Button
                key={value}
                variant="mini"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {t(FILTER_LABELS[value])}
              </Button>
            ))}
          </div>
          <Button
            variant="mini"
            onClick={() => void services.refetch()}
            disabled={services.isFetching}
            aria-busy={services.isFetching || undefined}
          >
            ⟳ {t("services.refresh")}
          </Button>
        </div>

        {services.isPending ? (
          <Loading label={t("services.loading")} />
        ) : services.isError && !services.data ? (
          <Callout
            tone="err"
            title={t("services.loadError")}
            actions={
              <Button variant="alt" size="sm" onClick={() => void services.refetch()}>
                ⟳ {t("services.refresh")}
              </Button>
            }
          >
            {errorText(services.error, i18n, SERVICE_ERROR_KEYS)}
          </Callout>
        ) : list.length === 0 ? (
          <Callout title={t("services.emptyTitle")} data-services-empty="">
            <p className="m-0 mb-3 max-w-[80ch] whitespace-normal text-fg">
              {t("services.emptyText")}
            </p>
            <CaptureHelp />
          </Callout>
        ) : visible.length === 0 ? (
          <Empty>
            {query.trim()
              ? t("services.noMatch", { q: query.trim() })
              : t("services.noMatchFilter")}
          </Empty>
        ) : (
          <ul
            aria-label={t("services.listTitle")}
            className="m-0 flex list-none flex-col gap-2 p-0"
          >
            {visible.map((service) => (
              <li key={service.id}>
                <ServiceCard service={service} onZoom={setZoom} onDelete={setPendingDelete} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ScreenshotDialog target={zoom} onClose={() => setZoom(null)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        busy={remove.isPending}
        command={`cssthema services rm ${pendingDelete?.slug ?? ""}`}
        title={t("services.deleteTitle", { name: pendingDelete?.name ?? "" })}
        confirmLabel={`⚡ ${t("services.deleteConfirm")}`}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        {pendingDelete &&
          tc("services.deleteText", pendingDelete.snapshots.length, {
            host: pendingDelete.hostname,
          })}
      </ConfirmDialog>
    </div>
  );
}
