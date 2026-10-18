import { type FormEvent, useId, useRef, useState } from "react";
import { useBulkHosts, useHostOptions } from "@/api/queries/hosts";
import { Field, Input, Select, toast } from "@/components/ui";
import { FormDialog } from "@/features/themes/components/FormDialog";
import { errorText } from "@/features/themes/lib/errors";
import { useI18n } from "@/lib/i18n";
import { BULK_CHOICES, type BulkChoice, bulkRequest, HOST_ERROR_KEYS } from "../lib/hosts";

export interface BulkHostsDialogProps {
  open: boolean;
  /** Geselecteerde hostnamen (leeg: alleen "alle koppelingen" kan). */
  selected: readonly string[];
  /** Aantal koppelingen in totaal (voor de tekst bij "alle"). */
  total: number;
  onClose: () => void;
  /** Na een geslaagde actie (bv. om de selectie te wissen). */
  onDone: () => void;
}

/** "Bulkactie": één wijziging (thema of script toevoegen, weghalen, vervangen; aan/uit) voor veel hosts. */
export function BulkHostsDialog({ open, ...props }: BulkHostsDialogProps) {
  if (!open) return null;
  return <BulkHostsContent {...props} />;
}

function BulkHostsContent({
  selected,
  total,
  onClose,
  onDone,
}: Omit<BulkHostsDialogProps, "open">) {
  const i18n = useI18n();
  const { t, tc } = i18n;
  const formId = useId();
  const listId = useId();
  const choiceRef = useRef<HTMLSelectElement>(null);
  const options = useHostOptions();
  const run = useBulkHosts();
  const busy = run.isPending;

  const [scope, setScope] = useState<"selected" | "all">(selected.length ? "selected" : "all");
  const [choice, setChoice] = useState<BulkChoice>("add-styles");
  const [name, setName] = useState("");
  const [replacement, setReplacement] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggleOnly = choice === "enable" || choice === "disable";
  const replacing = choice.startsWith("replace-");
  const suggestions = choice.endsWith("-scripts")
    ? (options.data?.scripts ?? [])
    : (options.data?.styles ?? []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!toggleOnly && (!name.trim() || (replacing && !replacement.trim()))) {
      setError(t("hosts.bulkNameRequired"));
      return;
    }
    setError(null);
    run.mutate(bulkRequest(choice, scope === "all" ? null : selected, name, replacement), {
      onSuccess: (result) => {
        toast.ok(tc("hosts.bulkDone", result.changed.length));
        if (result.skipped.length) {
          const list = result.skipped.map((item) => `${item.hostname} (${item.reason})`);
          toast.err(tc("hosts.bulkSkipped", result.skipped.length, { list: list.join(", ") }));
        }
        onDone();
      },
      onError: (failure) => setError(errorText(failure, i18n, HOST_ERROR_KEYS)),
    });
  };

  return (
    <FormDialog
      onClose={onClose}
      busy={busy}
      formId={formId}
      initialFocus={choiceRef}
      command="cssthema hosts bulk"
      title={t("hosts.bulkTitle")}
      description={t("hosts.bulkDescription")}
      submitLabel={busy ? t("hosts.bulkSubmitting") : t("hosts.bulkSubmit")}
    >
      <form id={formId} onSubmit={onSubmit} noValidate>
        <Field label={t("hosts.bulkScope")}>
          <Select
            value={scope}
            onChange={(event) => setScope(event.target.value as "selected" | "all")}
            disabled={busy}
          >
            {selected.length > 0 && (
              <option value="selected">{tc("hosts.bulkScopeSelected", selected.length)}</option>
            )}
            <option value="all">{t("hosts.bulkScopeAll", { count: total })}</option>
          </Select>
        </Field>
        <Field label={t("hosts.bulkAction")}>
          <Select
            ref={choiceRef}
            value={choice}
            onChange={(event) => setChoice(event.target.value as BulkChoice)}
            disabled={busy}
          >
            {BULK_CHOICES.map((item) => (
              <option key={item.value} value={item.value}>
                {t(item.label)}
              </option>
            ))}
          </Select>
        </Field>
        {!toggleOnly && (
          <Field label={t("hosts.bulkName")} error={(!replacing && error) || undefined}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              list={listId}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
            />
          </Field>
        )}
        {replacing && (
          <Field label={t("hosts.bulkReplacement")} error={error ?? undefined}>
            <Input
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              list={listId}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
            />
          </Field>
        )}
        {toggleOnly && error && (
          <p role="alert" className="m-0 text-[12px] text-err">
            {error}
          </p>
        )}
        <datalist id={listId}>
          {suggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </form>
    </FormDialog>
  );
}
