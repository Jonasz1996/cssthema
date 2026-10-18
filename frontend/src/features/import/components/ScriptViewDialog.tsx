import { useScriptContent } from "@/api/queries/scripts";
import type { ScriptFile } from "@/api/types";
import { Button, Callout, Code, Dialog, Loading, Pre } from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { formatBytes, formatDateTime, formatRelativeTime } from "@/features/themes/lib/format";
import { useI18n } from "@/lib/i18n";
import { SCRIPT_ERROR_KEYS } from "../lib/scripts";

export interface ScriptViewDialogProps {
  script: ScriptFile | null;
  onClose: () => void;
  onDownload: (script: ScriptFile) => void;
  onCopyUrl: (script: ScriptFile) => void;
  /** Er loopt al een download voor dit script. */
  downloading?: boolean;
}

function lineCount(text: string): number {
  if (!text) return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

/**
 * De inhoud van een script, alleen lezen (`GET /scripts/{name}`, zonder cache). Monaco kent hier
 * alleen CSS, dus een gewoon codeblok; lange regels (geminificeerd) breken af.
 */
export function ScriptViewDialog({
  script,
  onClose,
  onDownload,
  onCopyUrl,
  downloading = false,
}: ScriptViewDialogProps) {
  const i18n = useI18n();
  const { t, tc, locale } = i18n;
  const content = useScriptContent(script?.name, { staleTime: 0 });

  return (
    <Dialog
      open={script !== null}
      onClose={onClose}
      size="lg"
      command={`cssthema scripts show ${script?.name ?? ""}`}
      title={script?.filename ?? ""}
      description={
        script && (
          <>
            <Code>{script.url}</Code>
            <br />
            {formatBytes(script.size_bytes, locale)}
            {content.data !== undefined && ` · ${tc("import.linesCount", lineCount(content.data))}`}
            {" · "}
            <time dateTime={script.modified_at} title={formatDateTime(script.modified_at, locale)}>
              {t("import.scriptUpdatedAgo", {
                time: formatRelativeTime(script.modified_at, locale),
              })}
            </time>
          </>
        )
      }
      footer={
        script && (
          <>
            <Button
              variant="alt"
              onClick={() => onDownload(script)}
              disabled={downloading}
              aria-busy={downloading || undefined}
            >
              <span aria-hidden>⤓</span>
              {t("import.actionDownload")}
            </Button>
            <Button variant="alt" onClick={() => onCopyUrl(script)}>
              <span aria-hidden>🔗</span>
              {t("import.copyUrl")}
            </Button>
          </>
        )
      }
    >
      {content.isPending ? (
        <Loading label={t("import.viewLoading")} />
      ) : content.isError ? (
        <Callout tone="err" title={t("import.viewError")} className="mb-0">
          {errorText(content.error, i18n, SCRIPT_ERROR_KEYS)}
        </Callout>
      ) : (
        <figure className="m-0">
          <figcaption className="sr-only">
            {t("import.viewLabel", { file: script?.filename ?? "" })}
          </figcaption>
          <Pre
            data-script-content=""
            tabIndex={0}
            className="max-h-[60vh] overflow-auto break-normal [overflow-wrap:anywhere]"
          >
            {content.data}
          </Pre>
        </figure>
      )}
    </Dialog>
  );
}
