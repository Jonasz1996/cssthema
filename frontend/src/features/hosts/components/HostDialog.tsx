import { type FormEvent, useId, useRef, useState } from "react";
import { DEFAULT_HOST, useCreateHost, useHostOptions, useUpdateHost } from "@/api/queries/hosts";
import type { HostBinding, HostBindingInput } from "@/api/types";
import { Callout, Checkbox, Field, Input, Textarea } from "@/components/ui";
import { FormDialog } from "@/features/themes/components/FormDialog";
import { errorText } from "@/features/themes/lib/errors";
import { listOf } from "@/features/themes/lib/list";
import { useI18n } from "@/lib/i18n";
import {
  HOST_ERROR_KEYS,
  hostFormErrors,
  type HostFormErrors,
  isDefaultHost,
  MAX_SCRIPTS,
  MAX_STYLES,
} from "../lib/hosts";
import { NameListEditor } from "./NameListEditor";

/** Wat de dialoog bewerkt: een nieuwe koppeling (eventueel voorgevuld) of een bestaande. */
export type HostDialogTarget =
  { mode: "new"; initial?: Partial<HostBindingInput> } | { mode: "edit"; host: HostBinding };

export interface HostDialogProps {
  target: HostDialogTarget | null;
  onClose: () => void;
  onSaved: (host: HostBinding, created: boolean) => void;
}

/** Dialoog "Nieuwe host" / "<host> aanpassen": hostnaam, thema's en scripts in volgorde, aan/uit. */
export function HostDialog({ target, ...props }: HostDialogProps) {
  if (!target) return null;
  return <HostDialogContent target={target} {...props} />;
}

function HostDialogContent({
  target,
  onClose,
  onSaved,
}: HostDialogProps & { target: HostDialogTarget }) {
  const i18n = useI18n();
  const { t } = i18n;
  const formId = useId();
  const hostnameRef = useRef<HTMLInputElement>(null);
  const start: Partial<HostBindingInput> =
    target.mode === "edit" ? target.host : (target.initial ?? {});
  const [hostname, setHostname] = useState(start.hostname ?? "");
  const [styles, setStyles] = useState<string[]>([...(start.styles ?? [])]);
  const [scripts, setScripts] = useState<string[]>([...(start.scripts ?? [])]);
  const [enabled, setEnabled] = useState(start.enabled ?? true);
  const [note, setNote] = useState(start.note ?? "");
  const [errors, setErrors] = useState<HostFormErrors>({});

  const options = useHostOptions();
  const create = useCreateHost();
  const update = useUpdateHost();
  const busy = create.isPending || update.isPending;
  const label = isDefaultHost(hostname.trim()) ? t("hosts.defaultLabel") : hostname.trim();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!hostname.trim()) {
      setErrors({ hostname: t("hosts.hostnameRequired") });
      return;
    }
    setErrors({});
    const body: HostBindingInput = {
      hostname: hostname.trim(),
      styles,
      scripts,
      enabled,
      note: note.trim() || null,
    };
    const handlers = {
      onSuccess: (host: HostBinding) => onSaved(host, target.mode === "new"),
      onError: (error: unknown) =>
        setErrors(hostFormErrors(error, errorText(error, i18n, HOST_ERROR_KEYS))),
    };
    if (target.mode === "edit") update.mutate({ id: target.host.id, body }, handlers);
    else create.mutate(body, handlers);
  };

  const title =
    target.mode === "edit"
      ? t("hosts.editTitle", {
          host: isDefaultHost(target.host.hostname)
            ? t("hosts.defaultLabel")
            : target.host.hostname,
        })
      : t("hosts.newTitle");

  return (
    <FormDialog
      onClose={onClose}
      busy={busy}
      formId={formId}
      initialFocus={hostnameRef}
      command={`cssthema hosts ${target.mode === "edit" ? "edit" : "add"} ${label || DEFAULT_HOST}`}
      title={title}
      description={t("hosts.dialogDescription")}
      submitLabel={
        target.mode === "edit"
          ? busy
            ? t("hosts.saving")
            : t("hosts.save")
          : busy
            ? t("hosts.creating")
            : t("hosts.create")
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate>
        <Field
          label={t("hosts.fieldHostname")}
          hint={t("hosts.hostnameHint")}
          error={errors.hostname}
        >
          <Input
            ref={hostnameRef}
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            maxLength={300}
            autoComplete="off"
            spellCheck={false}
            placeholder="proxmox.jouwdomein.be"
            disabled={busy}
          />
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <NameListEditor
            name="styles"
            label={t("hosts.fieldStyles")}
            hint={t("hosts.stylesHint")}
            error={errors.styles}
            addLabel={t("hosts.addStyle")}
            value={styles}
            onChange={setStyles}
            options={listOf(options.data?.styles)}
            optionsKnown={options.isSuccess}
            max={MAX_STYLES}
            disabled={busy}
          />
          <NameListEditor
            name="scripts"
            label={t("hosts.fieldScripts")}
            hint={t("hosts.scriptsHint")}
            error={errors.scripts}
            addLabel={t("hosts.addScript")}
            value={scripts}
            onChange={setScripts}
            options={listOf(options.data?.scripts)}
            optionsKnown={options.isSuccess}
            max={MAX_SCRIPTS}
            disabled={busy}
          />
        </div>
        <Field label={t("hosts.fieldNote")} error={errors.note}>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={2}
            className="min-h-[46px]"
            disabled={busy}
          />
        </Field>
        <div className="mt-3.5">
          <Checkbox
            label={t("hosts.fieldEnabled")}
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={busy}
          />
        </div>
        {errors.general && (
          <Callout tone="err" className="mt-4 mb-0" role="alert">
            {errors.general}
          </Callout>
        )}
      </form>
    </FormDialog>
  );
}
