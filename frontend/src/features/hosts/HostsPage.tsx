import { useId, useState } from "react";
import { DEFAULT_HOST, useDeleteHost, useHosts, useUpdateHost } from "@/api/queries/hosts";
import type { HostBinding } from "@/api/types";
import {
  Button,
  Callout,
  ConfirmDialog,
  Empty,
  Input,
  Loading,
  PageHeader,
  Table,
  type TableColumn,
  Tag,
  toast,
} from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { listOf } from "@/features/themes/lib/list";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { HostDialog, type HostDialogTarget } from "./components/HostDialog";
import { ImportHostsDialog } from "./components/ImportHostsDialog";
import { NpmSnippet } from "./components/NpmSnippet";
import { filterHosts, HOST_ERROR_KEYS, isDefaultHost, toInput } from "./lib/hosts";

/**
 * Hosts (`/hosts`): elke proxy host in NPM krijgt dezelfde `sub_filter`-regel met `$host`; hier
 * stel je per host in welke thema's en scripts hij krijgt. Hosts zonder eigen rij volgen `*`.
 */
export function HostsPage() {
  const i18n = useI18n();
  const { t, tc } = i18n;
  const hosts = useHosts();
  const { mutate: updateHost } = useUpdateHost();
  const remove = useDeleteHost();
  const listTitleId = useId();

  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<HostDialogTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<HostBinding | null>(null);
  const [toggling, setToggling] = useState<ReadonlySet<string>>(() => new Set());

  const defaultLabel = t("hosts.defaultLabel");
  const nameOf = (host: HostBinding) =>
    isDefaultHost(host.hostname) ? defaultLabel : host.hostname;
  const list = listOf(hosts.data);
  const visible = filterHosts(list, query, defaultLabel);
  const hasDefault = list.some((host) => isDefaultHost(host.hostname));

  const setBusy = (id: string, on: boolean) =>
    setToggling((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle = (host: HostBinding) => {
    setBusy(host.id, true);
    updateHost(
      { id: host.id, body: { ...toInput(host), enabled: !host.enabled } },
      {
        onSuccess: (saved) =>
          toast.ok(
            t(saved.enabled ? "hosts.toggledOn" : "hosts.toggledOff", { host: nameOf(saved) }),
          ),
        onError: (error) => toast.err(errorText(error, i18n, HOST_ERROR_KEYS)),
        onSettled: () => setBusy(host.id, false),
      },
    );
  };

  const confirmDelete = () => {
    const host = pendingDelete;
    if (!host) return;
    remove.mutate(host.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.ok(t("hosts.deleted", { host: nameOf(host) }));
      },
      onError: (error) => {
        setPendingDelete(null);
        toast.err(errorText(error, i18n, HOST_ERROR_KEYS));
      },
    });
  };

  const openDefault = () =>
    setDialog({ mode: "new", initial: { hostname: DEFAULT_HOST, styles: [], scripts: [] } });

  const columns: TableColumn<HostBinding>[] = [
    {
      key: "host",
      header: t("hosts.colHost"),
      cell: (host) => (
        <span className={cn("block min-w-[12ch]", !host.enabled && "opacity-60")}>
          <b className="break-words text-heading">{nameOf(host)}</b>
          {host.note && <span className="mt-0.5 block text-[11.5px] text-dim">{host.note}</span>}
        </span>
      ),
    },
    {
      key: "styles",
      header: t("hosts.colStyles"),
      cell: (host) => <NameTags names={host.styles ?? []} empty={t("hosts.noStyles")} ordered />,
    },
    {
      key: "scripts",
      header: t("hosts.colScripts"),
      cell: (host) => <NameTags names={host.scripts ?? []} empty={t("hosts.noScripts")} />,
    },
    {
      key: "enabled",
      header: t("hosts.colEnabled"),
      className: "w-[70px]",
      cell: (host) => (
        <Button
          variant="mini"
          role="switch"
          aria-checked={host.enabled}
          aria-label={t("hosts.toggleNamed", { host: nameOf(host) })}
          disabled={toggling.has(host.id)}
          aria-busy={toggling.has(host.id) || undefined}
          onClick={() => toggle(host)}
          className={cn(host.enabled ? "text-ok" : "text-dim")}
        >
          {host.enabled ? `● ${t("hosts.on")}` : `○ ${t("hosts.off")}`}
        </Button>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("hosts.colActions")}</span>,
      className: "w-[1%] whitespace-nowrap",
      cell: (host) => (
        <span className="flex flex-wrap justify-end gap-1">
          <a
            href={host.css_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-[7px] border border-white/12 bg-white/7 px-2.5 py-[5px] text-[12.5px] text-fg no-underline hover:bg-white/16 hover:text-white"
            aria-label={t("hosts.openCssNamed", { host: nameOf(host) })}
            title={host.css_url}
          >
            CSS ↗
          </a>
          <a
            href={host.js_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-[7px] border border-white/12 bg-white/7 px-2.5 py-[5px] text-[12.5px] text-fg no-underline hover:bg-white/16 hover:text-white"
            aria-label={t("hosts.openJsNamed", { host: nameOf(host) })}
            title={host.js_url}
          >
            JS ↗
          </a>
          <Button
            variant="mini"
            aria-label={t("hosts.editNamed", { host: nameOf(host) })}
            onClick={() => setDialog({ mode: "edit", host })}
          >
            ✎ {t("hosts.edit")}
          </Button>
          <Button
            variant="mini"
            tone="danger"
            aria-label={t("hosts.deleteNamed", { host: nameOf(host) })}
            onClick={() => setPendingDelete(host)}
          >
            ✕
          </Button>
        </span>
      ),
    },
  ];

  const actions = (
    <>
      <Button onClick={() => setDialog({ mode: "new" })}>+ {t("hosts.new")}</Button>
      <Button variant="alt" onClick={() => setImportOpen(true)}>
        <span aria-hidden>📥</span>
        {t("hosts.import")}
      </Button>
    </>
  );

  return (
    <div>
      <PageHeader title={t("hosts.title")} hint={t("hosts.hint")} actions={actions} />
      <Callout className="max-w-[90ch]">{t("hosts.intro")}</Callout>

      <NpmSnippet />

      {hosts.isSuccess && !hasDefault && (
        <Callout
          tone="mid"
          title={t("hosts.defaultMissingTitle")}
          actions={
            <Button size="sm" onClick={openDefault}>
              {t("hosts.setDefault")}
            </Button>
          }
        >
          {t("hosts.defaultMissingText")}
        </Callout>
      )}

      <section aria-labelledby={listTitleId} aria-busy={hosts.isFetching || undefined}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <h2 id={listTitleId} className="m-0 text-[13px] font-bold text-heading">
            {t("hosts.listTitle")}
          </h2>
          {hosts.isSuccess && (
            <p role="status" className="m-0 text-[12px] text-muted">
              {query.trim()
                ? t("hosts.filtered", { shown: visible.length, total: list.length })
                : tc("hosts.summary", list.length)}
            </p>
          )}
        </div>
        <div role="search" className="mb-2 flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("hosts.searchPlaceholder")}
            aria-label={t("hosts.search")}
            className="max-w-[420px] flex-1"
          />
          <Button
            variant="mini"
            onClick={() => void hosts.refetch()}
            disabled={hosts.isFetching}
            aria-busy={hosts.isFetching || undefined}
          >
            ⟳ {t("hosts.refresh")}
          </Button>
        </div>

        {hosts.isPending ? (
          <Loading label={t("hosts.loading")} />
        ) : hosts.isError && !hosts.data ? (
          <Callout
            tone="err"
            title={t("hosts.loadError")}
            actions={
              <Button variant="alt" size="sm" onClick={() => void hosts.refetch()}>
                ⟳ {t("hosts.refresh")}
              </Button>
            }
          >
            {errorText(hosts.error, i18n, HOST_ERROR_KEYS)}
          </Callout>
        ) : list.length === 0 ? (
          <Callout
            title={t("hosts.emptyTitle")}
            actions={
              <>
                <Button size="sm" onClick={openDefault}>
                  {t("hosts.setDefault")}
                </Button>
                <Button variant="alt" size="sm" onClick={() => setImportOpen(true)}>
                  {t("hosts.import")}
                </Button>
              </>
            }
          >
            {t("hosts.emptyText")}
          </Callout>
        ) : visible.length === 0 ? (
          <Empty>{t("hosts.noMatch", { q: query.trim() })}</Empty>
        ) : (
          <Table
            columns={columns}
            rows={visible}
            rowKey={(host) => host.id}
            caption={t("hosts.listTitle")}
          />
        )}
      </section>

      <HostDialog
        target={dialog}
        onClose={() => setDialog(null)}
        onSaved={(host, created) => {
          setDialog(null);
          toast.ok(t(created ? "hosts.created" : "hosts.saved", { host: nameOf(host) }));
        }}
      />

      <ImportHostsDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        busy={remove.isPending}
        command={`cssthema hosts rm ${pendingDelete?.hostname ?? ""}`}
        title={t("hosts.deleteTitle", { host: pendingDelete ? nameOf(pendingDelete) : "" })}
        confirmLabel={`⚡ ${t("hosts.deleteConfirm")}`}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        {pendingDelete &&
          (isDefaultHost(pendingDelete.hostname)
            ? t("hosts.deleteDefaultText")
            : t("hosts.deleteText", { host: pendingDelete.hostname }))}
      </ConfirmDialog>
    </div>
  );
}

/** Namen als tags; thema's genummerd (laadvolgorde). */
function NameTags({
  names,
  empty,
  ordered = false,
}: {
  names: readonly string[];
  empty: string;
  ordered?: boolean;
}) {
  if (!names.length) return <span className="text-[12px] text-dim">{empty}</span>;
  const Tagged = ordered ? "ol" : "ul";
  return (
    <Tagged className="m-0 flex list-none flex-wrap gap-1 p-0">
      {names.map((name, index) => (
        <li key={name}>
          <Tag>
            {ordered && <span className="text-dim">{index + 1}.</span>}
            {name}
          </Tag>
        </li>
      ))}
    </Tagged>
  );
}
