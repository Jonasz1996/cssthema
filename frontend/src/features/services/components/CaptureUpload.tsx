import { type DragEvent, useRef, useState } from "react";
import { useImportCapture } from "@/api/queries/services";
import type { CaptureImportResult } from "@/api/types";
import {
  Button,
  Category,
  Code,
  Details,
  ItemRow,
  type ItemSeverity,
  Tag,
  toast,
} from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { formatBytes } from "@/features/themes/lib/format";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  CAPTURE_ACCEPT,
  captureFileKey,
  type CaptureProblem,
  captureProblem,
  SERVICE_ERROR_KEYS,
} from "../lib/services";
import { CaptureHelp } from "./CaptureHelp";

type UploadState = "queued" | "uploading" | "done" | "failed" | "invalid";

interface UploadItem {
  id: number;
  file: File;
  state: UploadState;
  /** Wat er vóór het uploaden al mis was (`state: "invalid"`, wordt niet verstuurd). */
  problem: CaptureProblem | null;
  result: CaptureImportResult | null;
  error: string | null;
}

const STATE_LABELS: Record<UploadState, MessageKey> = {
  queued: "services.stateQueued",
  uploading: "services.stateUploading",
  done: "services.stateDone",
  failed: "services.stateFailed",
  invalid: "services.stateInvalid",
};

const STATE_SEVERITY: Record<UploadState, ItemSeverity> = {
  queued: "default",
  uploading: "default",
  done: "ok",
  failed: "err",
  invalid: "err",
};

const PROBLEM_LABELS: Record<CaptureProblem, MessageKey> = {
  type: "services.problemType",
  empty: "services.problemEmpty",
  tooLarge: "services.problemTooLarge",
};

let nextItemId = 1;

/**
 * Kaart "Zips van vastleggen.py uploaden": één of meer zip-delen kiezen of slepen, dan één
 * voor één naar `POST /captures`. Per bestand de status (wacht, bezig, klaar, mislukt) en na
 * afloop wat de import deed: nieuwe en bijgewerkte services, snapshots, services zonder
 * snapshot, behouden vorige snapshots en overgeslagen bestanden. Een fout (422) staat bij het
 * bestand zelf.
 */
export function CaptureUpload({ showHelp }: { showHelp: boolean }) {
  const i18n = useI18n();
  const { t, tc } = i18n;
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragging, setDragging] = useState(false);
  const { mutateAsync } = useImportCapture();

  const queued = items.filter((item) => item.state === "queued");
  const finished = items.some((item) => item.state !== "queued");

  const patch = (id: number, next: Partial<UploadItem>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)));

  const add = (added: FileList | null) => {
    // Eerst kopiëren: de FileList van een <input> is live en wordt leeg zodra we de waarde
    // van het veld wissen (om hetzelfde bestand opnieuw te kunnen kiezen).
    const picked = Array.from(added ?? []);
    if (!picked.length) return;
    setItems((current) => {
      const known = new Set(
        current.filter((item) => item.state === "queued").map((item) => captureFileKey(item.file)),
      );
      const fresh: UploadItem[] = [];
      for (const file of picked) {
        const key = captureFileKey(file);
        if (known.has(key)) continue;
        known.add(key);
        const problem = captureProblem(file);
        fresh.push({
          id: nextItemId++,
          file,
          state: problem ? "invalid" : "queued",
          problem,
          result: null,
          error: null,
        });
      }
      return [...current, ...fresh];
    });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!running) add(event.dataTransfer.files);
  };

  const run = async () => {
    const batch = queued;
    if (!batch.length || running) return;
    setRunning(true);
    setProgress({ done: 0, total: batch.length });
    let imported = 0;
    let failed = 0;
    let snapshots = 0;
    // Eén voor één: elk deel kan tot 25 MB zijn en de server pakt het in één keer uit.
    for (const item of batch) {
      patch(item.id, { state: "uploading", error: null });
      try {
        const result = await mutateAsync(item.file);
        patch(item.id, { state: "done", result });
        imported += 1;
        snapshots += result.snapshots;
      } catch (error) {
        patch(item.id, {
          state: "failed",
          error: errorText(error, i18n, SERVICE_ERROR_KEYS),
        });
        failed += 1;
      }
      setProgress((current) => ({ ...current, done: current.done + 1 }));
    }
    setRunning(false);

    const zips = tc("services.zipCount", imported);
    if (!failed) {
      toast.ok(
        t("services.uploadDone", { zips, snapshots: tc("services.snapshotCount", snapshots) }),
      );
    } else if (imported) {
      toast.mid(t("services.uploadPartly", { zips, failed: tc("services.zipCount", failed) }));
    } else {
      toast.err(t("services.uploadFailed", { failed: tc("services.zipCount", failed) }));
    }
  };

  return (
    <Category title={t("services.uploadTitle")} storageKey="services.upload" className="mb-4">
      <div data-capture-upload="" className="px-1 pt-1 pb-1">
        <p className="m-0 mb-2.5 max-w-[80ch] text-[12.5px] leading-[1.6] text-muted">
          {t("services.uploadIntro")}
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
            "flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed px-4 py-6 text-center",
            "transition-colors",
            dragging ? "border-white/60 bg-white/10" : "border-white/20 bg-white/3",
          )}
        >
          <span aria-hidden className="text-[26px] leading-none">
            🗜️
          </span>
          <p className="m-0 text-[13px] text-fg">{t("services.dropHint")}</p>
          <Button
            variant="alt"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={running}
          >
            {t("services.chooseFiles")}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={CAPTURE_ACCEPT}
            hidden
            data-testid="capture-input"
            onChange={(event) => {
              add(event.target.files);
              event.target.value = "";
            }}
          />
          <p className="m-0 text-[11.5px] text-dim">{t("services.dropLimits")}</p>
        </div>

        {items.length > 0 && (
          <ul aria-label={t("services.uploadList")} className="m-0 mt-3 list-none p-0">
            {items.map((item) => (
              <li key={item.id}>
                <UploadRow
                  item={item}
                  running={running}
                  onRemove={() =>
                    setItems((current) => current.filter((other) => other.id !== item.id))
                  }
                  onRetry={() => patch(item.id, { state: "queued", error: null })}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            onClick={() => void run()}
            disabled={!queued.length || running}
            aria-busy={running || undefined}
          >
            <span aria-hidden>⬆️</span>
            {running
              ? t("services.uploading")
              : queued.length
                ? tc("services.uploadZips", queued.length)
                : t("services.upload")}
          </Button>
          {running && (
            <span className="flex items-center gap-2 text-[12px] text-muted">
              <progress
                max={progress.total}
                value={progress.done}
                aria-label={t("services.progressLabel")}
                className="h-1.5 w-28 accent-white"
              />
              <span role="status">
                {t("services.progress", { done: progress.done, total: progress.total })}
              </span>
            </span>
          )}
          {finished && !running && (
            <Button variant="mini" onClick={() => setItems([])}>
              {t("services.clearList")}
            </Button>
          )}
        </div>

        {showHelp && (
          <Details summary={t("services.helpSummary")} className="mt-3">
            <CaptureHelp className="pt-1 pb-1" />
          </Details>
        )}
      </div>
    </Category>
  );
}

interface UploadRowProps {
  item: UploadItem;
  running: boolean;
  onRemove: () => void;
  onRetry: () => void;
}

function UploadRow({ item, running, onRemove, onRetry }: UploadRowProps) {
  const { t, locale } = useI18n();
  const name = item.file.name;
  return (
    <ItemRow
      data-capture-file={name}
      data-state={item.state}
      severity={STATE_SEVERITY[item.state]}
      label={t(STATE_LABELS[item.state])}
      title={<span className="break-all">{name}</span>}
      tags={<Tag>{formatBytes(item.file.size, locale)}</Tag>}
      actions={
        item.state === "uploading" ? null : (
          <>
            {item.state === "failed" && (
              <Button
                variant="mini"
                aria-label={t("services.retryNamed", { file: name })}
                onClick={onRetry}
                disabled={running}
              >
                ⟳ {t("services.retry")}
              </Button>
            )}
            <Button
              variant="mini"
              size="icon"
              tone="danger"
              className="size-6 text-[11px]"
              aria-label={t("services.removeFile", { file: name })}
              title={t("services.removeFile", { file: name })}
              onClick={onRemove}
              disabled={running}
            >
              ✕
            </Button>
          </>
        )
      }
    >
      {item.state === "uploading" && (
        <span className="inline-flex items-center gap-1.5 text-muted">
          <span aria-hidden className="inline-block motion-safe:animate-spin">
            ⟳
          </span>
          {t("services.working")}
        </span>
      )}
      {item.state === "invalid" && item.problem && t(PROBLEM_LABELS[item.problem])}
      {item.state === "failed" && <span className="text-err">{item.error}</span>}
      {item.state === "done" && item.result && <CaptureSummary result={item.result} />}
    </ItemRow>
  );
}

/** Wat één zip deed: tellers op één regel, daaronder de hostnamen per groep en de overgeslagen bestanden. */
function CaptureSummary({ result }: { result: CaptureImportResult }) {
  const { t, tc } = useI18n();
  const kept = result.kept_previous ?? [];
  const groups = [
    {
      key: "created",
      names: result.services_created,
      text: tc("services.resultCreated", result.services_created.length),
    },
    {
      key: "updated",
      names: result.services_updated,
      text: tc("services.resultUpdated", result.services_updated.length),
    },
    {
      key: "without",
      names: result.without_snapshot,
      text: tc("services.resultWithout", result.without_snapshot.length),
    },
    {
      key: "kept",
      names: kept,
      text: tc("services.resultKept", kept.length),
      hint: t("services.resultKeptHint"),
    },
  ];
  const counts = [
    groups[0]!.text,
    groups[1]!.text,
    tc("services.snapshotCount", result.snapshots),
    groups[2]!.text,
    // Alleen als het gebeurde: een app die stuk was toen vastleggen.py langskwam.
    ...(kept.length ? [groups[3]!.text] : []),
    tc("services.resultSkipped", result.skipped.length),
  ];
  return (
    <div data-capture-result="" className="whitespace-normal">
      <p data-capture-counts="" className="m-0 text-fg">
        {counts.join(" · ")}
      </p>
      {groups
        .filter((group) => group.names.length > 0)
        .map((group) => (
          <p key={group.key} data-group={group.key} className="m-0 mt-1 text-muted">
            <b className="text-heading">{group.text}:</b>{" "}
            {group.names.map((name, index) => (
              <span key={name}>
                {index > 0 && ", "}
                <Code>{name}</Code>
              </span>
            ))}
            {group.hint && <span className="block text-dim">{group.hint}</span>}
          </p>
        ))}
      {result.skipped.length > 0 && (
        <ul data-group="skipped" className="m-0 mt-1 list-none p-0 text-mid">
          {result.skipped.map((item) => (
            <li key={`${item.path}:${item.reason}`} className="[overflow-wrap:anywhere]">
              {t("services.skippedLine", { path: item.path, reason: item.reason })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
