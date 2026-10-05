import { type DragEvent, useId, useRef, useState } from "react";
import { lintIssuesOf } from "@/api/client";
import { useImportTheme } from "@/api/queries/themes";
import type { ImportConflict, LintIssue, Theme } from "@/api/types";
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
import {
  ACCEPT,
  CONFLICT_CHOICES,
  mergeFiles,
  publishParam,
  type PublishChoice,
  uploadKind,
  uploadProblem,
  type UploadProblem,
} from "../lib/upload";
import { LintIssueList } from "./LintIssueList";

type UploadResult =
  | { id: number; file: string; ok: true; theme: Theme; created: boolean }
  | { id: number; file: string; ok: false; message: string; issues: LintIssue[] };

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
};

let nextResultId = 1;

/**
 * Tab "Uploaden": `.css` of `.cssthema.zip` kiezen of slepen, kiezen wat er gebeurt bij een
 * bestaande slug en of er gepubliceerd wordt; elk bestand wordt apart geïmporteerd met een
 * eigen resultaat (nieuw thema, nieuwe versie of fout met de lint-meldingen).
 */
export function UploadPanel() {
  const i18n = useI18n();
  const { t, tc, locale } = i18n;
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const nameId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [conflict, setConflict] = useState<ImportConflict>("rename");
  const [publish, setPublish] = useState<PublishChoice>("auto");
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const { mutateAsync } = useImportTheme();

  const valid = files.filter((file) => !uploadProblem(file));
  const single = files.length === 1;

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

  const run = async () => {
    if (!valid.length || running) return;
    setRunning(true);
    const batch: UploadResult[] = [];
    const done = new Set<File>();
    for (const file of valid) {
      try {
        const { data, created } = await mutateAsync({
          file,
          filename: file.name,
          onConflict: conflict,
          publish: publishParam(publish),
          name: single && name.trim() ? name.trim() : undefined,
        });
        batch.push({ id: nextResultId++, file: file.name, ok: true, theme: data, created });
        done.add(file);
      } catch (error) {
        batch.push({
          id: nextResultId++,
          file: file.name,
          ok: false,
          message: errorText(error, i18n),
          issues: lintIssuesOf(error),
        });
      }
    }
    setRunning(false);
    setResults((previous) => [...batch, ...previous]);
    setFiles((current) => current.filter((file) => !done.has(file)));
    if (done.size === files.length) setName("");
    const ok = batch.filter((result) => result.ok).length;
    const failed = batch.length - ok;
    if (ok && batch.some((r) => r.ok && r.theme.published_version) && submitRef.current) {
      fx.publish(submitRef.current);
    }
    if (failed) {
      toast.mid(
        t("import.uploadDone", {
          imported: tc("import.themesCount", ok),
          failed: tc("import.filesCount", failed),
        }),
      );
    } else {
      toast.ok(t("import.uploadDoneAll", { imported: tc("import.themesCount", ok) }));
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
            return (
              <li
                key={`${file.name}:${file.size}:${file.lastModified}`}
                data-upload-file={file.name}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-lg border border-white/8 border-l-[3px] bg-white/5 px-3 py-2 text-[12.5px]",
                  problem ? "border-l-err" : "border-l-[#666]",
                )}
              >
                <Code className="min-w-0 break-all">{file.name}</Code>
                <Tag>
                  {kind === "bundle" ? t("import.kindBundle") : kind === "css" ? "CSS" : "?"}
                </Tag>
                <span className="text-[11.5px] text-dim">{formatBytes(file.size, locale)}</span>
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
        <Field
          id={nameId}
          label={t("import.fieldName")}
          hint={single ? t("import.nameHint") : t("import.nameOnlySingle")}
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
          {running ? t("import.uploading") : tc("import.uploadSelected", valid.length)}
        </Button>
      </div>

      {results.length > 0 && (
        <Category title={t("import.result")} count={results.length} className="mt-5">
          {results.map((result) =>
            result.ok ? (
              <ItemRow
                key={result.id}
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
            ) : (
              <ItemRow
                key={result.id}
                data-upload-result={result.file}
                severity="err"
                label={t("import.resultFailed")}
                title={result.file}
              >
                {result.message}
                <LintIssueList issues={result.issues} />
              </ItemRow>
            ),
          )}
          <div className="mt-1 flex justify-end">
            <Button variant="mini" onClick={() => setResults([])} disabled={running}>
              {t("import.resultClear")}
            </Button>
          </div>
        </Category>
      )}
    </div>
  );
}
