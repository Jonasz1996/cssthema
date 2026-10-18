import { useRef, useState } from "react";
import { Link } from "react-router";
import { useDashboard } from "@/api/queries/dashboard";
import { useImportLocalFiles, useLocalFiles } from "@/api/queries/themes";
import type { ImportedTheme, LocalCssFile, LocalImportResult } from "@/api/types";
import {
  Button,
  ButtonLink,
  Callout,
  Category,
  Checkbox,
  Code,
  Empty,
  ItemRow,
  Loading,
  Table,
  type TableColumn,
  Tag,
  toast,
} from "@/components/ui";
import { ThemeStatusTags } from "@/features/themes/components/ThemeStatusTags";
import { editorPath } from "@/features/themes/lib/actions";
import { errorText } from "@/features/themes/lib/errors";
import { formatBytes, formatDateTime, formatRelativeTime } from "@/features/themes/lib/format";
import { listOf } from "@/features/themes/lib/list";
import { fx } from "@/lib/fx";
import { useI18n } from "@/lib/i18n";

/** Eén importronde: wat de server teruggaf en of er toen gearchiveerd werd. */
interface ImportBatch {
  id: number;
  data: LocalImportResult;
  archive: boolean;
}

let nextBatchId = 1;

function ImportedRow({ theme, archived }: { theme: ImportedTheme; archived: boolean }) {
  const { t } = useI18n();
  const problem = theme.archive_error;
  return (
    <ItemRow
      data-imported={theme.source_file}
      severity={problem ? "mid" : "ok"}
      label={t("import.resultImported")}
      title={theme.name}
      tags={
        <>
          <ThemeStatusTags theme={theme} />
          {archived && !problem && <Tag tone="ok">{t("import.archived")}</Tag>}
        </>
      }
      meta={
        <>
          <Code>{theme.source_file}</Code> → <Code>/{theme.slug}.css</Code>
        </>
      }
      actions={
        <ButtonLink
          variant="mini"
          to={editorPath(theme.id)}
          aria-label={t("themes.openNamed", { name: theme.name })}
        >
          ✎ {t("themes.actionOpen")}
        </ButtonLink>
      }
    >
      {problem}
    </ItemRow>
  );
}

function ImportBatchRows({ batch }: { batch: ImportBatch }) {
  const { t } = useI18n();
  return (
    <>
      {listOf(batch.data.imported).map((theme) => (
        <ImportedRow key={theme.id} theme={theme} archived={batch.archive} />
      ))}
      {listOf(batch.data.skipped).map((file) => (
        <ItemRow
          key={file.name}
          data-skipped={file.name}
          severity="err"
          label={t("import.resultSkipped")}
          title={file.name}
        >
          {file.reason}
        </ItemRow>
      ))}
    </>
  );
}

/**
 * Tab "CSS-bestanden op de server": de handgemaakte `*.css` uit de css-files-map (native install:
 * `/var/lib/cssthema/css-files`), met vinkjes. Importeren maakt per bestand een thema (v1, live
 * als "publiceren" aan staat) en verplaatst het bestand daarna naar `.geimporteerd/`, zodat nginx
 * naar de api doorvalt en dezelfde URL meteen het thema serveert.
 */
export function LocalFilesPanel() {
  const i18n = useI18n();
  const { t, tc, locale } = i18n;
  const files = useLocalFiles();
  const dashboard = useDashboard();
  const importFiles = useImportLocalFiles();
  const submitRef = useRef<HTMLButtonElement>(null);

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [publish, setPublish] = useState(true);
  const [archive, setArchive] = useState(true);
  // Elke importronde komt bovenaan bij, zodat een tweede ronde de eerste niet wegveegt.
  const [batches, setBatches] = useState<ImportBatch[]>([]);

  const list = listOf(files.data);
  const importable = list.filter((file) => file.importable);
  const chosen = importable.filter((file) => selected.has(file.name)).map((file) => file.name);
  const allChosen = importable.length > 0 && chosen.length === importable.length;
  const dir =
    typeof dashboard.data?.local_files?.dir === "string" ? dashboard.data.local_files.dir : "";
  const busy = importFiles.isPending;

  const toggle = (name: string, on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  const toggleAll = (on: boolean) =>
    setSelected(on ? new Set(importable.map((file) => file.name)) : new Set());

  const runImport = () => {
    if (!chosen.length || busy) return;
    const archiveNow = publish && archive;
    importFiles.mutate(
      { names: chosen, publish, archive: archiveNow },
      {
        onSuccess: (data) => {
          setBatches((previous) => [{ id: nextBatchId++, data, archive: archiveNow }, ...previous]);
          setSelected(new Set());
          const imported = listOf(data.imported).length;
          const skipped = listOf(data.skipped).length;
          if (imported && publish && submitRef.current) fx.publish(submitRef.current);
          if (skipped) {
            toast.mid(
              t("import.localDone", {
                imported: tc("import.themesCount", imported),
                skipped: tc("import.filesCount", skipped),
              }),
            );
          } else {
            toast.ok(t("import.localDoneAll", { imported: tc("import.themesCount", imported) }));
          }
        },
        onError: (error) => toast.err(errorText(error, i18n)),
      },
    );
  };

  const columns: TableColumn<LocalCssFile>[] = [
    {
      key: "select",
      header: (
        <Checkbox
          label={<span className="sr-only">{t("import.selectAll")}</span>}
          checked={allChosen}
          ref={(el) => {
            if (el) el.indeterminate = chosen.length > 0 && !allChosen;
          }}
          onChange={(event) => toggleAll(event.target.checked)}
          disabled={!importable.length || busy}
        />
      ),
      cell: (file) => (
        <Checkbox
          label={<span className="sr-only">{t("import.selectFile", { name: file.name })}</span>}
          checked={selected.has(file.name)}
          onChange={(event) => toggle(file.name, event.target.checked)}
          disabled={!file.importable || busy}
        />
      ),
      className: "w-8",
    },
    {
      key: "name",
      header: t("import.colFile"),
      cell: (file) => (
        <span className="flex flex-col">
          <Code>{file.name}</Code>
          {file.slug && (
            <span className="text-[11.5px] text-dim max-[640px]:hidden">→ /{file.slug}.css</span>
          )}
        </span>
      ),
    },
    {
      key: "size",
      header: t("import.colSize"),
      cell: (file) => formatBytes(file.size_bytes, locale),
      className: "whitespace-nowrap",
    },
    {
      key: "modified",
      header: t("import.colModified"),
      cell: (file) => (
        <time dateTime={file.modified_at} title={formatDateTime(file.modified_at, locale)}>
          {formatRelativeTime(file.modified_at, locale)}
        </time>
      ),
      className: "whitespace-nowrap max-[640px]:hidden",
    },
    {
      key: "status",
      header: t("import.colStatus"),
      cell: (file) =>
        file.importable ? (
          <Tag tone="ok">{t("import.importable")}</Tag>
        ) : (
          <span className="flex flex-col gap-1">
            <span className="flex flex-wrap gap-1.5">
              <Tag tone="warn">{t("import.notImportable")}</Tag>
              {file.theme_id && <Tag tone="warn">{t("import.shadowsTheme")}</Tag>}
            </span>
            {/* Bij een bestand dat voorgaat op een thema zegt de uitleg hieronder meer dan de reden. */}
            {!file.theme_id && <span className="text-[12px] text-muted">{file.reason}</span>}
            {file.theme_id && (
              <span className="text-[12px] text-err">
                {t("import.shadowsHint", { slug: file.slug ?? "" })}{" "}
                <Link to={editorPath(file.theme_id)} className="text-fg underline hover:text-white">
                  {t("import.openTheme")}
                </Link>
              </span>
            )}
          </span>
        ),
    },
  ];

  const resultCount = batches.reduce(
    (sum, batch) => sum + listOf(batch.data.imported).length + listOf(batch.data.skipped).length,
    0,
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2.5">
        <p className="m-0 min-w-0 flex-1 text-[12.5px] leading-[1.6] text-muted">
          {t("import.localIntro")} {dir && <Code className="break-all">{dir}</Code>}
        </p>
        <Button
          variant="mini"
          onClick={() => void files.refetch()}
          disabled={files.isFetching}
          aria-busy={files.isFetching || undefined}
        >
          ⟳ {t("import.refresh")}
        </Button>
      </div>

      {files.isPending ? (
        <Loading label={t("import.loadingFiles")} />
      ) : files.isError ? (
        <Callout tone="err" title={t("import.filesError")}>
          {errorText(files.error, i18n)}
        </Callout>
      ) : list.length === 0 ? (
        <Empty>{t("import.noFiles")}</Empty>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-[10px] border border-line bg-white/3 px-3.5 py-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <Checkbox
                  label={t("import.optionPublish")}
                  checked={publish}
                  onChange={(event) => setPublish(event.target.checked)}
                  disabled={busy}
                />
                <Checkbox
                  label={t("import.optionArchive")}
                  checked={publish && archive}
                  onChange={(event) => setArchive(event.target.checked)}
                  disabled={busy || !publish}
                />
              </div>
              <p className="m-0 text-[11.5px] text-dim">
                {publish ? t("import.archiveHint") : t("import.archiveNeedsPublish")}
              </p>
            </div>
            <Button
              ref={submitRef}
              onClick={runImport}
              disabled={!chosen.length || busy}
              aria-busy={busy || undefined}
            >
              <span aria-hidden>📥</span>
              {busy ? t("import.importing") : tc("import.importSelected", chosen.length)}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="m-0 text-[12px] text-dim">
              {tc("import.filesSummary", list.length, {
                importable: tc("import.importableCount", importable.length),
              })}
            </p>
            {importable.length > 0 && (
              <Button
                variant="mini"
                onClick={() => toggleAll(!allChosen)}
                disabled={busy}
                className="ml-auto"
              >
                {allChosen
                  ? t("import.selectNone")
                  : tc("import.selectAllCount", importable.length)}
              </Button>
            )}
          </div>
          <Table
            columns={columns}
            rows={list}
            rowKey={(file) => file.name}
            caption={t("import.filesCaption")}
          />
        </>
      )}

      {batches.length > 0 && (
        <Category title={t("import.result")} count={resultCount} className="mt-5">
          {batches.map((batch) => (
            <ImportBatchRows key={batch.id} batch={batch} />
          ))}
          {resultCount === 0 && <Empty>{t("import.resultEmpty")}</Empty>}
          <div className="mt-1 flex justify-end">
            <Button variant="mini" onClick={() => setBatches([])}>
              {t("import.resultClear")}
            </Button>
          </div>
        </Category>
      )}
    </div>
  );
}
