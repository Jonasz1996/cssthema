import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDashboard } from "@/api/queries/dashboard";
import {
  isScriptGone,
  useDeleteScript,
  useDownloadScript,
  useScripts,
} from "@/api/queries/scripts";
import type { ScriptFile } from "@/api/types";
import { Button, Callout, Code, ConfirmDialog, ItemRow, Loading, toast } from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { formatBytes, formatDateTime, formatRelativeTime } from "@/features/themes/lib/format";
import { listOf } from "@/features/themes/lib/list";
import { fx } from "@/lib/fx";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { type ScriptUploadOutcome, useScriptUpload } from "../hooks/use-script-upload";
import { copyScriptUrl } from "../lib/copy-url";
import { SCRIPT_ARCHIVE_DIR, SCRIPT_ERROR_KEYS, shortHash } from "../lib/scripts";
import { uploadKind, uploadProblem, type UploadProblem } from "../lib/upload";
import { InjectionSnippet } from "./InjectionSnippet";
import { ScriptViewDialog } from "./ScriptViewDialog";

const SCRIPT_ACCEPT = ".js,text/javascript,application/javascript";

const PROBLEM_TEXT: Record<UploadProblem, MessageKey> = {
  type: "import.scriptErrorType",
  empty: "import.problemEmpty",
  tooLarge: "import.problemScriptTooLarge",
  scriptTooLarge: "import.problemScriptTooLarge",
};

/** Wat er zeker mis is met een gekozen script, of `null` (de server controleert de rest). */
function scriptProblem(file: File): UploadProblem | null {
  if (uploadKind(file.name) !== "script") return "type";
  return uploadProblem(file);
}

/**
 * Tab "Scripts": de `.js`-bestanden in de css-files-map (publiek op `/<naam>.js`), met
 * uploaden, bekijken, downloaden, vervangen (vorige versie naar `.scripts-archief/`) en
 * verwijderen (ook naar het archief), plus het snippet om een script in een app te laden.
 */
export function ScriptsPanel() {
  const i18n = useI18n();
  const { t, tc } = i18n;
  const scripts = useScripts();
  const dashboard = useDashboard();
  const { upload, dialog: conflictDialog } = useScriptUpload();
  const { mutateAsync: downloadAsync } = useDownloadScript();
  const { mutateAsync: deleteAsync } = useDeleteScript();

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const listRef = useRef<HTMLElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const listTitleId = useId();

  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [viewing, setViewing] = useState<ScriptFile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScriptFile | null>(null);

  /**
   * Waar de focus heen moet als hij verloren ging. Een knop die uit (disabled) stond toen de
   * vervangvraag sloot of terwijl het bestand opstuurde, kan de focus niet houden of terugkrijgen;
   * de browser zet hem dan op <body>. Na elke render: is het doel er en weer aan, en staat de focus
   * nog op <body>, dan erheen (zoals UploadPanel na een upload).
   */
  const focusLater = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    if (!focusLater.current) return;
    const target = focusLater.current();
    if (target?.matches(":disabled")) return; // nog bezig: na een volgende render
    focusLater.current = null;
    const active = document.activeElement;
    if (target && (!active || active === document.body)) target.focus();
  });

  const list = listOf(scripts.data);
  const dir =
    typeof dashboard.data?.local_files?.dir === "string" ? dashboard.data.local_files.dir : "";

  const track = useCallback(async <T,>(name: string, work: () => Promise<T>): Promise<T> => {
    setBusy((previous) => new Set(previous).add(name));
    try {
      return await work();
    } finally {
      setBusy((previous) => {
        const next = new Set(previous);
        next.delete(name);
        return next;
      });
    }
  }, []);

  /** Een fout als melding, met de bestandsnaam ervoor. */
  const reportError = (file: File, outcome: ScriptUploadOutcome) => {
    if (outcome.status !== "error") return;
    toast.err(`${file.name}: ${errorText(outcome.error, i18n, SCRIPT_ERROR_KEYS)}`);
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length || uploading) return;
    focusLater.current = () => uploadButtonRef.current;
    setUploading(true);
    const done: { script: ScriptFile; created: boolean }[] = [];
    let kept = 0;
    try {
      for (const file of files) {
        const problem = scriptProblem(file);
        if (problem) {
          toast.err(`${file.name}: ${t(PROBLEM_TEXT[problem])}`);
          continue;
        }
        const outcome = await upload(file);
        reportError(file, outcome);
        if (outcome.status === "ok") done.push(outcome);
        if (outcome.status === "kept") kept += 1;
      }
    } finally {
      setUploading(false);
    }
    if (done.length && uploadButtonRef.current) fx.publish(uploadButtonRef.current);
    const [first] = done;
    if (done.length === 1 && first) {
      toast.ok(
        first.created
          ? t("import.scriptLive", { file: first.script.filename, url: first.script.url })
          : t("import.scriptReplaced", { file: first.script.filename }),
      );
    } else if (done.length > 1) {
      toast.ok(t("import.uploadDoneAll", { imported: tc("import.scriptsCount", done.length) }));
    } else if (kept) {
      toast(t("import.uploadNothing"));
    }
  };

  const replaceWith = async (name: string, file: File) => {
    const problem = scriptProblem(file);
    if (problem) {
      toast.err(`${file.name}: ${t(PROBLEM_TEXT[problem])}`);
      return;
    }
    focusLater.current = () =>
      rows.current.get(name)?.querySelector<HTMLElement>("[data-action=replace]");
    const outcome = await track(name, () => upload(file, { name, replace: true }));
    reportError(file, outcome);
    if (outcome.status !== "ok") return;
    const { script } = outcome;
    const row = rows.current.get(script.name);
    if (row?.isConnected) fx.publish(row);
    toast.ok(t("import.scriptReplaced", { file: script.filename }));
  };

  const download = async (script: ScriptFile) => {
    try {
      const file = await track(script.name, () => downloadAsync({ name: script.name }));
      toast.ok(t("import.scriptDownloaded", { file: file.filename }));
    } catch (error) {
      // Al weg (met de hand verwijderd, ander tabblad): de hook haalt het uit de lijst.
      toast.err(
        isScriptGone(error)
          ? t("import.scriptGone", { file: script.filename })
          : errorText(error, i18n, SCRIPT_ERROR_KEYS),
      );
    }
  };

  const chooseReplacement = (script: ScriptFile) => {
    replaceTarget.current = script.name;
    replaceInputRef.current?.click();
  };

  const confirmDelete = async () => {
    const script = pendingDelete;
    setPendingDelete(null);
    if (!script) return;
    const row = rows.current.get(script.name) ?? null;
    const effect = row ? fx.remove(row) : Promise.resolve();
    let gone = false;
    try {
      await track(script.name, () => Promise.all([deleteAsync(script.name), effect]));
    } catch (error) {
      await effect;
      // 404: het stond er al niet meer. Dan is het doel bereikt; de hook haalt de rij weg.
      gone = isScriptGone(error);
      if (!gone) {
        if (row) fx.unzap(row);
        toast.err(errorText(error, i18n, SCRIPT_ERROR_KEYS));
        return;
      }
    }
    if (gone) toast(t("import.scriptGone", { file: script.filename }));
    else toast.ok(t("import.scriptDeleted", { file: script.filename }));
    // De rij (en dus de knop die de dialoog opende) is weg: de focus naar de lijst, of naar
    // de uploadknop als de lijst nu leeg is.
    requestAnimationFrame(() => (listRef.current ?? uploadButtonRef.current)?.focus());
  };

  const refreshButton = (
    <Button
      variant="mini"
      onClick={() => void scripts.refetch()}
      disabled={scripts.isFetching}
      aria-busy={scripts.isFetching || undefined}
    >
      ⟳ {t("import.refresh")}
    </Button>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        ref={uploadButtonRef}
        size="sm"
        onClick={() => uploadInputRef.current?.click()}
        disabled={uploading}
        aria-busy={uploading || undefined}
      >
        <span aria-hidden>⬆️</span>
        {uploading ? t("import.uploading") : t("import.scriptsUpload")}
      </Button>
      {refreshButton}
    </div>
  );

  return (
    <div>
      <p className="m-0 mb-3 max-w-[80ch] text-[12.5px] leading-[1.6] text-muted">
        {t("import.scriptsIntro")}
      </p>

      <input
        ref={uploadInputRef}
        type="file"
        multiple
        accept={SCRIPT_ACCEPT}
        hidden
        data-testid="script-upload-input"
        onChange={(event) => {
          // Eerst kopiëren: de FileList is live en wordt leeg als we het veld wissen.
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void uploadFiles(files);
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept={SCRIPT_ACCEPT}
        hidden
        data-testid="script-replace-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const name = replaceTarget.current;
          event.target.value = "";
          replaceTarget.current = null;
          if (file && name) void replaceWith(name, file);
        }}
      />

      {scripts.isPending ? (
        <Loading label={t("import.scriptsLoading")} />
      ) : scripts.isError ? (
        <Callout tone="err" title={t("import.scriptsError")} actions={refreshButton}>
          {errorText(scripts.error, i18n, SCRIPT_ERROR_KEYS)}
        </Callout>
      ) : list.length === 0 ? (
        <Callout title={t("import.scriptsEmptyTitle")} actions={toolbar}>
          {t("import.scriptsEmptyText")}
        </Callout>
      ) : (
        <section
          ref={listRef}
          tabIndex={-1}
          aria-labelledby={listTitleId}
          aria-busy={scripts.isFetching || undefined}
          className="outline-none"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-[10px] border border-line bg-white/3 px-3.5 py-3">
            <h3 id={listTitleId} className="m-0 text-[12.5px] font-normal text-muted">
              <span className="sr-only">{t("import.scriptsListLabel")}: </span>
              {tc("import.scriptsSummary", list.length)}
            </h3>
            {toolbar}
          </div>
          <ul className="m-0 list-none p-0">
            {list.map((script) => (
              <li key={script.name} className="min-w-0">
                <ScriptRow
                  script={script}
                  dir={dir}
                  busy={busy.has(script.name)}
                  rowRef={(el) => {
                    if (el) rows.current.set(script.name, el);
                    else rows.current.delete(script.name);
                  }}
                  onView={() => setViewing(script)}
                  onDownload={() => void download(script)}
                  onReplace={() => chooseReplacement(script)}
                  onDelete={() => setPendingDelete(script)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!scripts.isError && <InjectionSnippet scripts={list} />}

      {conflictDialog}

      <ScriptViewDialog
        script={viewing}
        onClose={() => {
          setViewing(null);
          // De dialoog zet de focus terug op "Bekijken", tenzij de rij intussen weg is (404).
          focusLater.current = () => listRef.current ?? uploadButtonRef.current;
        }}
        onDownload={(script) => void download(script)}
        onCopyUrl={(script) => void copyScriptUrl(script.url)}
        downloading={viewing ? busy.has(viewing.name) : false}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        command={`cssthema scripts rm ${pendingDelete?.name ?? ""}`}
        title={t("import.deleteScriptTitle", { file: pendingDelete?.filename ?? "" })}
        confirmLabel={`⚡ ${t("import.deleteScriptConfirm")}`}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        {pendingDelete &&
          t("import.deleteScriptText", {
            archive: `${SCRIPT_ARCHIVE_DIR}/`,
            url: pendingDelete.url,
          })}
      </ConfirmDialog>
    </div>
  );
}

interface ScriptRowProps {
  script: ScriptFile;
  /** De css-files-map op de server (voor de `chmod`-tip), of leeg. */
  dir: string;
  busy: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  onView: () => void;
  onDownload: () => void;
  onReplace: () => void;
  onDelete: () => void;
}

function ScriptRow({
  script,
  dir,
  busy,
  rowRef,
  onView,
  onDownload,
  onReplace,
  onDelete,
}: ScriptRowProps) {
  const { t, locale } = useI18n();
  const hash = shortHash(script.sha256);
  const path = dir ? `${dir.replace(/\/+$/, "")}/${script.filename}` : script.filename;
  return (
    <ItemRow
      ref={rowRef}
      data-script={script.name}
      aria-busy={busy || undefined}
      severity={script.world_readable ? "ok" : "err"}
      label={script.world_readable ? t("import.scriptLiveTag") : t("import.scriptUnreadable")}
      title={script.filename}
      meta={
        <>
          {formatBytes(script.size_bytes, locale)}
          {" · "}
          <time dateTime={script.modified_at} title={formatDateTime(script.modified_at, locale)}>
            {t("import.scriptUpdatedAgo", { time: formatRelativeTime(script.modified_at, locale) })}
          </time>
          {hash && (
            <span title={script.sha256 ?? undefined} className="max-[520px]:hidden">
              {" · "}
              {t("import.scriptHash", { hash })}
            </span>
          )}
        </>
      }
      actions={
        <>
          <Button
            variant="mini"
            onClick={onView}
            aria-label={t("import.viewNamed", { name: script.filename })}
          >
            👁 {t("import.actionView")}
          </Button>
          <Button
            variant="mini"
            onClick={onDownload}
            disabled={busy}
            aria-label={t("import.downloadNamed", { name: script.filename })}
          >
            ⤓ {t("import.actionDownload")}
          </Button>
          <Button
            variant="mini"
            data-action="replace"
            onClick={onReplace}
            disabled={busy}
            aria-label={t("import.replaceNamed", { name: script.filename })}
          >
            ⟳ {t("import.actionReplace")}
          </Button>
          <Button
            variant="mini"
            tone="danger"
            onClick={onDelete}
            disabled={busy}
            aria-label={t("import.deleteNamed", { name: script.filename })}
          >
            ⚡ {t("import.actionDelete")}
          </Button>
        </>
      }
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Code className="min-w-0">{script.url}</Code>
        <Button
          variant="mini"
          size="icon"
          className="size-6 flex-none text-[11px]"
          onClick={() => void copyScriptUrl(script.url)}
          aria-label={t("import.copyUrlNamed", { name: script.filename })}
          title={t("import.copyUrl")}
        >
          ⧉
        </Button>
      </span>
      {!script.world_readable && (
        <span className="mt-1 block text-[12px] text-err">
          ⚠ {t("import.scriptUnreadableHint", { url: `/${script.filename}`, path })}
        </span>
      )}
    </ItemRow>
  );
}
