import { useId, useRef, useState, type FormEvent } from "react";
import { fieldErrorsOf, isApiError } from "@/api/client";
import { usePalettes } from "@/api/queries/palettes";
import { useUpdateTheme } from "@/api/queries/themes";
import type { Theme, ThemeUpdate } from "@/api/types";
import { Callout, Field, Select, Textarea, toast } from "@/components/ui";
import { FormDialog } from "@/features/themes/components/FormDialog";
import { NameSlugFields } from "@/features/themes/components/NameSlugFields";
import type { NameSlugState } from "@/features/themes/hooks/use-name-slug";
import { errorText } from "@/features/themes/lib/errors";
import { listOf } from "@/features/themes/lib/list";
import { slugIssue } from "@/features/themes/lib/slug";
import { useI18n } from "@/lib/i18n";
import type { DraftSession } from "../autosave/draft-session";
import { themeSettingsForm, themeSettingsPatch } from "../lib/theme-settings";

export interface ThemeSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  /** De editorsessie: eerst wordt de draft opgeslagen, daarna neemt ze de nieuwe lock over. */
  session: DraftSession;
}

/**
 * Instellingen van het thema in de editor (review FE-4): naam, slug, beschrijving en palet,
 * zonder terug naar de lijst. Eén lock voor draft en metadata: de dialoog slaat eerst op wat
 * nog wacht en geeft de sessie daarna de nieuwe lock, anders weigerde de volgende autosave.
 */
export function ThemeSettingsDialog(props: ThemeSettingsDialogProps) {
  if (!props.open) return null;
  return <ThemeSettingsDialogContent key={props.theme.id} {...props} />;
}

/** Naam en slug los van elkaar: bij een bestaand thema volgt de slug de naam niet. */
function useEditNameSlug(theme: Theme): NameSlugState {
  const initial = themeSettingsForm(theme);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const trimmed = slug.trim();
  return {
    name,
    setName,
    slug,
    setSlug,
    slugEdited: true,
    // De huidige slug is goed zoals hij is (ook een oude die strengere regels niet haalt).
    issue: trimmed === theme.slug ? null : slugIssue(trimmed),
  };
}

function ThemeSettingsDialogContent({ onClose, theme, session }: ThemeSettingsDialogProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const names = useEditNameSlug(theme);
  const [paletteId, setPaletteId] = useState(theme.palette_id ?? "");
  const [description, setDescription] = useState(theme.description ?? "");
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; slug?: string; general?: string }>({});
  const palettes = listOf(usePalettes().data);
  const update = useUpdateTheme();
  const busy = sending || update.isPending;
  const newSlug = names.slug.trim();
  const slugChanged = newSlug !== theme.slug && !names.issue && newSlug !== "";

  const showError = (error: unknown) => {
    const text = errorText(error, i18n);
    if (isApiError(error) && (error.code === "slug_conflict" || error.code === "invalid_slug")) {
      setErrors({ slug: text });
      return;
    }
    const fields = fieldErrorsOf(error);
    if (fields.name || fields.slug) setErrors({ name: fields.name, slug: fields.slug });
    else setErrors({ general: text });
  };

  const send = async (patch: ThemeUpdate, retried = false): Promise<void> => {
    try {
      const { data } = await update.mutateAsync({
        themeId: theme.id,
        // Uit de sessie, zoals bij publiceren: na `refreshLock()` staat daar de nieuwe lock.
        lockVersion: session.getSnapshot().lockVersion,
        patch,
      });
      session.setLockVersion(data.lock_version);
      toast.ok(t("editor.settingsSaved"));
      onClose();
    } catch (error) {
      // Alleen de lock schoof op (bv. publiceren in een ander tabblad): één keer opnieuw.
      if (isApiError(error) && error.status === 412 && !retried && (await session.refreshLock()))
        return send(patch, true);
      showError(error);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!names.name.trim()) {
      setErrors({ name: t("themes.nameRequired") });
      return;
    }
    if (names.issue) return;
    setErrors({});
    const patch = themeSettingsPatch(theme, {
      name: names.name,
      slug: names.slug,
      description,
      paletteId,
    });
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    // Wachtende autosave eerst: anders kruisen draft en PATCH elkaar met dezelfde lock (412).
    setSending(true);
    try {
      await session.flush();
      await send(patch);
    } finally {
      setSending(false);
    }
  };

  return (
    <FormDialog
      onClose={onClose}
      busy={busy}
      formId={formId}
      initialFocus={nameRef}
      command={`cssthema settings ${theme.slug}`}
      title={t("editor.settingsTitle", { name: theme.name })}
      description={t("editor.settingsDescription")}
      submitLabel={busy ? t("editor.settingsSaving") : t("editor.settingsSave")}
    >
      <form id={formId} onSubmit={(event) => void onSubmit(event)} noValidate>
        <NameSlugFields
          state={names}
          nameRef={nameRef}
          nameError={errors.name}
          slugError={errors.slug}
          disabled={busy}
        />
        {slugChanged && (
          <Callout tone="mid" className="mt-1 mb-3" data-slug-change>
            {t("editor.settingsSlugChange", { slug: newSlug, old: theme.slug })}
          </Callout>
        )}
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
        {errors.general && (
          <Callout tone="err" className="mt-4 mb-0" role="alert">
            {errors.general}
          </Callout>
        )}
      </form>
    </FormDialog>
  );
}
