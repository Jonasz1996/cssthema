import { useId, useRef, useState, type FormEvent } from "react";
import { fieldErrorsOf, isApiError } from "@/api/client";
import { usePalettes } from "@/api/queries/palettes";
import { useCreateTheme, useThemes } from "@/api/queries/themes";
import type { Theme } from "@/api/types";
import { Callout, Field, Select, Textarea } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useNameSlug } from "../hooks/use-name-slug";
import { buildThemeCreate, type StartKind } from "../lib/create";
import { errorText } from "../lib/errors";
import { listOf } from "../lib/list";
import { FormDialog } from "./FormDialog";
import { NameSlugFields } from "./NameSlugFields";

export interface NewThemeDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (theme: Theme) => void;
  /** Voorgeselecteerd palet (bv. het actieve filter). */
  initialPaletteId?: string;
}

/** Dialoog "Nieuw thema": naam → slug-voorstel, palet, startinhoud. */
export function NewThemeDialog({ open, ...props }: NewThemeDialogProps) {
  if (!open) return null;
  return <NewThemeDialogContent {...props} />;
}

const START_KINDS: readonly StartKind[] = ["empty", "copy", "template"];

function NewThemeDialogContent({
  onClose,
  onCreated,
  initialPaletteId = "",
}: Omit<NewThemeDialogProps, "open">) {
  const i18n = useI18n();
  const { t } = i18n;
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const names = useNameSlug();
  const [paletteId, setPaletteId] = useState(initialPaletteId);
  const [description, setDescription] = useState("");
  const [start, setStart] = useState<StartKind>("empty");
  const [copyFrom, setCopyFrom] = useState("");
  const [errors, setErrors] = useState<{
    name?: string;
    slug?: string;
    copy?: string;
    general?: string;
  }>({});

  const palettes = listOf(usePalettes().data);
  const themes = useThemes({ sort: "name", limit: 200 }, { enabled: start === "copy" });
  const copyCandidates = listOf(themes.data?.items);
  const create = useCreateTheme();
  const busy = create.isPending;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const next: typeof errors = {};
    if (!names.name.trim()) next.name = t("themes.nameRequired");
    if (start === "copy" && !copyFrom) next.copy = t("themes.copyRequired");
    if (Object.keys(next).length || names.issue) {
      setErrors(next);
      return;
    }
    setErrors({});
    const palette = palettes.find((item) => item.id === paletteId) ?? null;
    const body = buildThemeCreate(
      { name: names.name, slug: names.slug, paletteId, description, start, copyFrom },
      palette,
    );
    create.mutate(body, {
      onSuccess: ({ data }) => onCreated(data),
      onError: (error) => {
        const text = errorText(error, i18n);
        if (
          isApiError(error) &&
          (error.code === "slug_conflict" || error.code === "invalid_slug")
        ) {
          setErrors({ slug: text });
          return;
        }
        const fields = fieldErrorsOf(error);
        if (fields.name || fields.slug || fields.template) {
          setErrors({ name: fields.name, slug: fields.slug, copy: fields.template });
          return;
        }
        setErrors({ general: text });
      },
    });
  };

  return (
    <FormDialog
      onClose={onClose}
      busy={busy}
      formId={formId}
      initialFocus={nameRef}
      command="cssthema new"
      title={t("themes.newTitle")}
      description={t("themes.newDescription")}
      submitLabel={busy ? t("themes.creating") : t("themes.create")}
    >
      <form id={formId} onSubmit={onSubmit} noValidate>
        <NameSlugFields
          state={names}
          nameRef={nameRef}
          nameError={errors.name}
          slugError={errors.slug}
          disabled={busy}
        />
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label={t("themes.fieldPalette")} hint={t("themes.paletteHint")}>
            <Select
              value={paletteId}
              onChange={(event) => setPaletteId(event.target.value)}
              disabled={busy}
            >
              <option value="">{t("themes.noPalette")}</option>
              {palettes.map((palette) => (
                <option key={palette.id} value={palette.id}>
                  {palette.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("themes.fieldDescription")}>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={2}
              className="min-h-[46px]"
              disabled={busy}
            />
          </Field>
        </div>

        <fieldset className="m-0 mt-3.5 min-w-0 border-0 p-0" disabled={busy}>
          <legend className="mb-1 p-0 text-[11.5px] tracking-[.08em] text-muted uppercase">
            {t("themes.fieldStart")}
          </legend>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {START_KINDS.map((kind) => (
              <label
                key={kind}
                className={cn(
                  "flex min-w-0 cursor-pointer items-start gap-2 rounded-[10px] border px-3 py-2.5 text-[12.5px]",
                  "transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-white",
                  start === kind
                    ? "border-white/40 bg-white/12 text-white"
                    : "border-line-strong bg-white/4 text-fg hover:bg-white/8",
                )}
              >
                <input
                  type="radio"
                  name={`${formId}-start`}
                  value={kind}
                  checked={start === kind}
                  onChange={() => setStart(kind)}
                  className="mt-0.5 size-3.5 flex-none accent-[#bbb] focus-visible:outline-none"
                />
                <span className="min-w-0">
                  <b className="block">{t(`themes.start_${kind}`)}</b>
                  <span className="text-[11.5px] text-muted">{t(`themes.start_${kind}Hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {start === "copy" && (
          <Field label={t("themes.fieldCopyFrom")} error={errors.copy}>
            <Select
              value={copyFrom}
              onChange={(event) => setCopyFrom(event.target.value)}
              disabled={busy || themes.isPending}
            >
              <option value="">
                {themes.isPending ? t("themes.loadingThemes") : t("themes.chooseTheme")}
              </option>
              {copyCandidates.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name} ({theme.slug})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {errors.general && (
          <Callout tone="err" className="mt-4 mb-0" role="alert">
            {errors.general}
          </Callout>
        )}
      </form>
    </FormDialog>
  );
}
