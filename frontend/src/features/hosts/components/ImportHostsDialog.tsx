import { type FormEvent, useId, useRef, useState } from "react";
import { useImportHosts } from "@/api/queries/hosts";
import type { HostImportResult } from "@/api/types";
import { Button, Callout, Checkbox, Code, Dialog, Field, Textarea } from "@/components/ui";
import { FormDialog } from "@/features/themes/components/FormDialog";
import { errorText } from "@/features/themes/lib/errors";
import { useI18n } from "@/lib/i18n";
import { HOST_ERROR_KEYS } from "../lib/hosts";

export interface ImportHostsDialogProps {
  open: boolean;
  onClose: () => void;
}

const EXAMPLE = `# proxmox.jouwdomein.be
sub_filter '</head>' '<link rel="stylesheet" href="https://css.jouwdomein.be/algemeen.css"></head>';`;

/** "Importeren uit NPM-config": plakken, importeren, daarna een samenvatting. */
export function ImportHostsDialog({ open, ...props }: ImportHostsDialogProps) {
  if (!open) return null;
  return <ImportHostsContent {...props} />;
}

function ImportHostsContent({ onClose }: Omit<ImportHostsDialogProps, "open">) {
  const i18n = useI18n();
  const { t } = i18n;
  const formId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HostImportResult | null>(null);
  const run = useImportHosts();
  const busy = run.isPending;

  if (result) return <ImportResult result={result} onClose={onClose} />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!text.trim()) {
      setError(t("hosts.importTextRequired"));
      return;
    }
    setError(null);
    run.mutate(
      { text, replace },
      {
        onSuccess: setResult,
        onError: (failure) => setError(errorText(failure, i18n, HOST_ERROR_KEYS)),
      },
    );
  };

  return (
    <FormDialog
      onClose={onClose}
      busy={busy}
      formId={formId}
      initialFocus={textRef}
      command="cssthema hosts import"
      size="lg"
      title={t("hosts.importTitle")}
      description={t("hosts.importDescription")}
      submitLabel={busy ? t("hosts.importing") : t("hosts.importSubmit")}
    >
      <form id={formId} onSubmit={onSubmit} noValidate>
        <Field label={t("hosts.fieldImportText")} error={error ?? undefined}>
          <Textarea
            ref={textRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={12}
            spellCheck={false}
            placeholder={EXAMPLE}
            className="text-[12px]"
            disabled={busy}
          />
        </Field>
        <div className="mt-3">
          <Checkbox
            label={t("hosts.importReplace")}
            checked={replace}
            onChange={(event) => setReplace(event.target.checked)}
            disabled={busy}
          />
        </div>
      </form>
    </FormDialog>
  );
}

function ImportResult({ result, onClose }: { result: HostImportResult; onClose: () => void }) {
  const { t, tc } = useI18n();
  const groups = [
    {
      key: "created",
      names: result.created,
      text: tc("hosts.importCreated", result.created.length),
    },
    {
      key: "updated",
      names: result.updated,
      text: tc("hosts.importUpdated", result.updated.length),
    },
    {
      key: "unchanged",
      names: result.unchanged,
      text: tc("hosts.importUnchanged", result.unchanged.length),
    },
  ];
  const nothing = !result.created.length && !result.updated.length;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("hosts.importResultTitle")}
      command="cssthema hosts import"
      size="lg"
      footer={<Button onClick={onClose}>{t("common.close")}</Button>}
    >
      <div data-import-result="">
        <Callout tone={nothing ? "default" : "ok"} className="mb-3">
          <span role="status">
            {[
              ...groups.map((group) => group.text),
              tc("hosts.importSkipped", result.skipped.length),
            ].join(" · ")}
          </span>
        </Callout>
        {groups
          .filter((group) => group.names.length > 0)
          .map((group) => (
            <p key={group.key} data-group={group.key} className="m-0 mb-2 text-[12.5px] text-muted">
              <b className="text-heading">{group.text}:</b>{" "}
              {group.names.map((name, index) => (
                <span key={name}>
                  {index > 0 && ", "}
                  <Code>{name}</Code>
                </span>
              ))}
            </p>
          ))}
        {result.skipped.length > 0 && (
          <Callout
            tone="mid"
            title={tc("hosts.importSkipped", result.skipped.length)}
            className="mb-0"
          >
            <ul className="m-0 list-none p-0 whitespace-normal" data-group="skipped">
              {result.skipped.map((item) => (
                <li key={`${item.line}:${item.reason}`}>
                  {t("hosts.importSkippedLine", { line: item.line, reason: item.reason })}
                </li>
              ))}
            </ul>
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
