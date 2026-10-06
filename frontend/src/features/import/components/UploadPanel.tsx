import { type DragEvent, useId, useRef, useState } from "react";
import { lintIssuesOf } from "@/api/client";
import { useImportTheme } from "@/api/queries/themes";
import type { ImportConflict, LintIssue, ScriptFile, Theme } from "@/api/types";
import { useShellCommand } from "@/app/shell-command";
import {
  Button,
  ButtonLink,
  Category,
  Code,
  Field,
  Input,
  ItemRow,
  Select,
  Tag,
  toast,
} from "@/components/ui";
import { ThemeStatusTags } from "@/features/themes/components/ThemeStatusTags";
import { editorPath } from "@/features/themes/lib/actions";
import { errorText } from "@/features/themes/lib/errors";
import { formatBytes } from "@/features/themes/lib/format";
import { fx } from "@/lib/fx";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useScriptUpload } from "../hooks/use-script-upload";
import { copyScriptUrl } from "../lib/copy-url";
import {
  SCRIPT_ERROR_KEYS,
  SCRIPT_SUFFIX,
  scriptTarget,
  type ScriptNameIssue,
  shellWord,
} from "../lib/scripts";
import {
  ACCEPT,
  CONFLICT_CHOICES,
  isThemeFile,
  mergeFiles,
  publishParam,
  type PublishChoice,
  type UploadKind,
  uploadKind,
  uploadProblem,
  type UploadProblem,
} from "../lib/upload";
import { LintIssueList } from "./LintIssueList";

type UploadResult =
  | { id: number; file: string; kind: "theme"; theme: Theme; created: boolean }
  | { id: number; file: string; kind: "script"; script: ScriptFile; created: boolean }
  /** Script met een bestaande naam, en de gebruiker koos om niet te vervangen. */
  | { id: number; file: string; kind: "kept"; name: string }
  | { id: number; file: string; kind: "failed"; message: string; issues: LintIssue[] };

/** Link naar de tab Scripts (zelfde pagina, `?tab=scripts`). */
const SCRIPTS_TAB_PATH = "/import?tab=scripts";

const CONFLICT_LABELS: Record<ImportConflict, MessageKey> = {
  rename: "import.conflictRename",
  new_version: "import.conflictNewVersion",
  fail: "import.conflictFail",
};

const CONFLICT_HINTS: Record<ImportConflict, MessageKey> = {
  rename: "import.conflictRenameHint",
  new_version: "import.conflictNewVersionHint",
  fail: "import.conflictFailHint",
};

const PUBLISH_HINTS: Record<PublishChoice, MessageKey> = {
  auto: "import.publishAutoHint",
  yes: "import.publishYesHint",
  no: "import.publishNoHint",
};

const PUBLISH_LABELS: Record<PublishChoice, MessageKey> = {
  auto: "import.publishAuto",
  yes: "import.publishYes",
  no: "import.publishNo",
};

const PROBLEM_LABELS: Record<UploadProblem, MessageKey> = {
  type: "import.problemType",
  empty: "import.problemEmpty",
  tooLarge: "import.problemTooLarge",
  scriptTooLarge: "import.problemScriptTooLarge",
};

const NAME_ISSUE_LABELS: Record<ScriptNameIssue, MessageKey> = {
  empty: "import.scriptNameEmpty",
  path: "import.scriptNamePath",
  length: "import.scriptNameLength",
  reserved: "import.scriptNameReserved",
};

const KIND_LABELS: Record<UploadKind, MessageKey | null> = {
  css: null,
  bundle: "import.kindBundle",
  script: "import.kindScript",
  unsupported: null,
};

let nextResultId = 1;

/**
 * Tab "Uploaden": `.css`, `.cssthema.zip` of `.js` kiezen of slepen. Thema-bestanden gaan naar
 * de thema-import (met de keuze bij een bestaande slug en of er gepubliceerd wordt); een `.js`
 * gaat naar `POST /scripts` en vraagt bij een bestaande naam of hij vervangen mag worden. Elk
 * bestand krijgt een eigen resultaat (nieuw thema of script, nieuwe versie, vervangen of fout).
 */
export function UploadPanel() {
  const i18n = useI18n();
  const { t, tc, locale } = i18n;
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const nameId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [conflict, setConflict] = useState<ImportConflict>("rename");
  const [publish, setPublish] = useState<PublishChoice>("auto");
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const { mutateAsync } = useImportTheme();
  const { upload: uploadScript, dialog: conflictDialog } = useScriptUpload();

  const single = files.length === 1;
  /** Naam voor een script: het naamveld (alleen bij één bestand), anders de bestandsnaam. */
  const targetOf = (file: File) => scriptTarget(file.name, single ? name : undefined);
  const nameIssue = (file: File) =>
    uploadKind(file.name) === "script" ? targetOf(file).issue : null;
  const valid = files.filter((file) => !uploadProblem(file) && !nameIssue(file));
  // Alleen scripts gekozen: de thema-opties (slug, publiceren) doen dan niets.
  const scriptsOnly = files.length > 0 && files.every((file) => uploadKind(file.name) === "script");
  const singleScript = single && scriptsOnly;

  useShellCommand(
    scriptsOnly && valid.length
      ? `cssthema scripts upload ${valid.map((file) => shellWord(file.name)).join(" ")}`
      : "cssthema import --upload",
  );

  const add = (added: FileList | null) => {
    // Eerst kopiëren: de FileList van een <input> is live en wordt leeg zodra we de waarde
    // van het veld wissen (om hetzelfde bestand opnieuw te kunnen kiezen).
    const picked = Array.from(added ?? []);
    if (picked.length) setFiles((current) => mergeFiles(current, picked));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!running) add(event.dataTransfer.files);
  };

  const importTheme = async (file: File, customName: string | undefined) => {
    try {
      const { data, created } = await mutateAsync({
        file,
        filename: file.name,
        onConflict: conflict,
        publish: publishParam(publish),
        name: customName,
      });
      return { id: nextResultId++, file: file.name, kind: "theme", theme: data, created } as const;
    } catch (error) {
      return {
        id: nextResultId++,
        file: file.name,
        kind: "failed",
        message: errorText(error, i18n),
        issues: lintIssuesOf(error),
      } as const;
    }
  };

  const sendScript = async (file: File, customName: string | undefined): Promise<UploadResult> => {
    const outcome = await uploadScript(file, { name: customName });
    const base = { id: nextResultId++, file: file.name };
    if (outcome.status === "ok") {
      return { ...base, kind: "script", script: outcome.script, created: outcome.created };
    }
    if (outcome.status === "kept") return { ...base, kind: "kept", name: outcome.name };
    return {
      ...base,
      kind: "failed",
      message: errorText(outcome.error, i18n, SCRIPT_ERROR_KEYS),
      issues: [],
    };
  };

  const run = async () => {
    if (!valid.length || running) return;
    setRunning(true);
    const batch: UploadResult[] = [];
    const done = new Set<File>();
    const customName = single && name.trim() ? name.trim() : undefined;
    for (const file of valid) {
      const result =
        uploadKind(file.name) === "script"
          ? await sendScript(file, customName)
          : await importTheme(file, customName);
      batch.push(result);
      if (result.kind === "theme" || result.kind === "script") done.add(file);
    }
    setRunning(false);
    setResults((previous) => [...batch, ...previous]);
    setFiles((current) => current.filter((file) => !done.has(file)));
    if (done.size === files.length) setName("");
    // Na de vervangvraag kan de focus op <body> staan (de knop was uit): naar de resultaten.
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        resultsRef.current?.focus();
      }
    });

    const themes = batch.filter((result) => result.kind === "theme");
    const scripts = batch.filter((result) => result.kind === "script");
    const failed = batch.filter((result) => result.kind === "failed").length;
    const kept = batch.filter((result) => result.kind === "kept").length;
    const live = scripts.length > 0 || themes.some((result) => result.theme.published_version);
    if (live && submitRef.current) fx.publish(submitRef.current);

    // Tellen per soort die in deze ronde zat ("0 scripts", niet "0 thema's", als er alleen
    // scripts waren).
    const sentScripts = valid.some((file) => uploadKind(file.name) === "script");
    const sentThemes = valid.some((file) => isThemeFile(file.name));
    const parts = [
      sentThemes ? tc("import.themesCount", themes.length) : null,
      sentScripts ? tc("import.scriptsCount", scripts.length) : null,
    ].filter((part): part is string => part !== null);
    const imported = parts.join(", ");
    const [onlyScript] = scripts;
    if (failed) {
      toast.mid(t("import.uploadDone", { imported, failed: tc("import.filesCount", failed) }));
    } else if (onlyScript && batch.length === 1) {
      toast.ok(
        onlyScript.created
          ? t("import.scriptLive", { file: onlyScript.script.filename, url: onlyScript.script.url })
          : t("import.scriptReplaced", { file: onlyScript.script.filename }),
      );
    } else if (themes.length || scripts.length) {
      toast.ok(t("import.uploadDoneAll", { imported }));
    } else if (kept) {
      toast(t("import.uploadNothing"));
    }
  };

  return (
    <div>
      <p className="mt-0 mb-3 max-w-[80ch] text-[12.5px] leading-[1.6] text-muted">
        {t("import.uploadIntro")}
      </p>

      <div
        data-dropzone=""
        data-dragging={dragging || undefined}
        onDragOver={(event) => {
          event.preventDefault();
          if (!running) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed px-4 py-7 text-center",
          "transition-colors",
          dragging ? "border-white/60 bg-white/10" : "border-white/20 bg-white/3",
        )}
      >
        <span aria-hidden className="text-[26px] leading-none">
          ⬆️
        </span>
        <p className="m-0 text-[13px] text-fg">{t("import.dropHint")}</p>
        <Button
          variant="alt"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={running}
        >
          {t("import.chooseFiles")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          data-testid="upload-input"
          onChange={(event) => {
            add(event.target.files);
            event.target.value = "";
          }}
        />
        <p className="m-0 text-[11.5px] text-dim">{t("import.dropLimits")}</p>
      </div>

      {files.length > 0 && (
        <ul
          aria-label={t("import.selectedFiles")}
          className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0"
        >
          {files.map((file) => {
            const problem = uploadProblem(file);
            const kind = uploadKind(file.name);
            const kindLabel = KIND_LABELS[kind];
            const target = kind === "script" && !problem ? targetOf(file) : null;
            return (
              <li
                key={`${file.name}:${file.size}:${file.lastModified}`}
                data-upload-file={file.name}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-lg border border-white/8 border-l-[3px] bg-white/5 px-3 py-2 text-[12.5px]",
                  problem || target?.issue ? "border-l-err" : "border-l-[#666]",
                )}
              >
                <Code className="min-w-0 break-all">{file.name}</Code>
                <Tag>{kindLabel ? t(kindLabel) : kind === "css" ? "CSS" : "?"}</Tag>
                <span className="text-[11.5px] text-dim">{formatBytes(file.size, locale)}</span>
                {target && !target.issue && (
                  <span className="min-w-0 text-[11.5px] break-all text-dim">
                    → /{target.name}
                    {SCRIPT_SUFFIX}
                  </span>
                )}
                {target?.issue && <Tag tone="err">{t(NAME_ISSUE_LABELS[target.issue])}</Tag>}
                {problem && <Tag tone="err">{t(PROBLEM_LABELS[problem])}</Tag>}
                <Button
                  variant="mini"
                  size="icon"
                  tone="danger"
                  className="ml-auto size-6 text-[11px]"
                  aria-label={t("import.removeFile", { name: file.name })}
                  title={t("import.removeFile", { name: file.name })}
                  onClick={() => setFiles((current) => current.filter((item) => item !== file))}
                  disabled={running}
                >
                  ✕
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-x-4 sm:grid-cols-3">
        {scriptsOnly ? (
          <p
            data-script-options=""
            className="m-0 mt-3.5 self-start rounded-[10px] border border-line bg-white/3 px-3.5 py-3 text-[12px] leading-[1.6] text-muted sm:col-span-2"
          >
            {t("import.scriptOptions")}
          </p>
        ) : (
          <>
            <Field label={t("import.fieldConflict")} hint={t(CONFLICT_HINTS[conflict])}>
              <Select
                value={conflict}
                onChange={(event) => setConflict(event.target.value as ImportConflict)}
                disabled={running}
              >
                {CONFLICT_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {t(CONFLICT_LABELS[choice])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("import.fieldPublish")} hint={t(PUBLISH_HINTS[publish])}>
              <Select
                value={publish}
                onChange={(event) => setPublish(event.target.value as PublishChoice)}
                disabled={running}
              >
                {(Object.keys(PUBLISH_LABELS) as PublishChoice[]).map((choice) => (
                  <option key={choice} value={choice}>
                    {t(PUBLISH_LABELS[choice])}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field
          id={nameId}
          label={t("import.fieldName")}
          hint={
            !single
              ? t("import.nameOnlySingle")
              : singleScript
                ? t("import.nameHintScript")
                : t("import.nameHint")
          }
        >
          <Input
            value={single ? name : ""}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            disabled={running || !single}
            autoComplete="off"
          />
        </Field>
      </div>

      <div className="mt-4">
        <Button
          ref={submitRef}
          onClick={() => void run()}
          disabled={!valid.length || running}
          aria-busy={running || undefined}
        >
          <span aria-hidden>⬆️</span>
          {running
            ? t("import.uploading")
            : scriptsOnly
              ? tc("import.uploadScripts", valid.length)
              : tc("import.uploadSelected", valid.length)}
        </Button>
      </div>

      {results.length > 0 && (
        <section
          ref={resultsRef}
          tabIndex={-1}
          aria-label={t("import.result")}
          className="mt-5 outline-none"
        >
          <Category title={t("import.result")} count={results.length} className="mb-0">
            {results.map((result) => (
              <UploadResultRow key={result.id} result={result} />
            ))}
            <div className="mt-1 flex justify-end">
              <Button variant="mini" onClick={() => setResults([])} disabled={running}>
                {t("import.resultClear")}
              </Button>
            </div>
          </Category>
        </section>
      )}

      {conflictDialog}
    </div>
  );
}

function UploadResultRow({ result }: { result: UploadResult }) {
  const { t } = useI18n();
  switch (result.kind) {
    case "theme":
      return (
        <ItemRow
          data-upload-result={result.file}
          severity="ok"
          label={result.created ? t("import.resultCreated") : t("import.resultNewVersion")}
          title={result.theme.name}
          tags={<ThemeStatusTags theme={result.theme} />}
          meta={
            <>
              <Code>{result.file}</Code> → <Code>/{result.theme.slug}.css</Code>
            </>
          }
          actions={
            <ButtonLink
              variant="mini"
              to={editorPath(result.theme.id)}
              aria-label={t("themes.openNamed", { name: result.theme.name })}
            >
              ✎ {t("themes.actionOpen")}
            </ButtonLink>
          }
        />
      );
    case "script":
      return (
        <ItemRow
          data-upload-result={result.file}
          severity="ok"
          label={
            result.created ? t("import.resultScriptCreated") : t("import.resultScriptReplaced")
          }
          title={result.script.filename}
          tags={<Tag tone="ok">{t("import.scriptLiveTag")}</Tag>}
          meta={
            <>
              <Code>{result.file}</Code> → <Code>{result.script.url}</Code>
            </>
          }
          actions={
            <>
              <Button
                variant="mini"
                onClick={() => void copyScriptUrl(result.script.url)}
                aria-label={t("import.copyUrlNamed", { name: result.script.filename })}
              >
                ⧉ {t("import.copyUrl")}
              </Button>
              <ButtonLink variant="mini" to={SCRIPTS_TAB_PATH}>
                📜 {t("import.openScripts")}
              </ButtonLink>
            </>
          }
        />
      );
    case "kept":
      return (
        <ItemRow
          data-upload-result={result.file}
          severity="mid"
          label={t("import.resultScriptKept")}
          title={result.file}
          actions={
            <ButtonLink variant="mini" to={SCRIPTS_TAB_PATH}>
              📜 {t("import.openScripts")}
            </ButtonLink>
          }
        >
          {t("import.resultScriptKeptText", { url: `/${result.name}${SCRIPT_SUFFIX}` })}
        </ItemRow>
      );
    case "failed":
      return (
        <ItemRow
          data-upload-result={result.file}
          severity="err"
          label={t("import.resultFailed")}
          title={result.file}
        >
          {result.message}
          <LintIssueList issues={result.issues} />
        </ItemRow>
      );
  }
}
