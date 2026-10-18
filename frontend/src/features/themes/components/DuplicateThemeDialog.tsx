import { useId, useRef, useState, type FormEvent } from "react";
import { fieldErrorsOf, isApiError } from "@/api/client";
import { useDuplicateTheme } from "@/api/queries/themes";
import type { Theme } from "@/api/types";
import { Callout } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useNameSlug } from "../hooks/use-name-slug";
import { errorText } from "../lib/errors";
import { FormDialog } from "./FormDialog";
import { NameSlugFields } from "./NameSlugFields";

export interface DuplicateThemeDialogProps {
  /** Het thema om te dupliceren; `null` = dialoog dicht. */
  theme: Theme | null;
  onClose: () => void;
  onDuplicated: (copy: Theme, source: Theme) => void;
}

/** Dupliceren: nieuwe naam en slug; draft en metadata gaan mee, de versies niet. */
export function DuplicateThemeDialog({ theme, ...props }: DuplicateThemeDialogProps) {
  if (!theme) return null;
  return <DuplicateThemeDialogContent key={theme.id} theme={theme} {...props} />;
}

function DuplicateThemeDialogContent({
  theme,
  onClose,
  onDuplicated,
}: DuplicateThemeDialogProps & { theme: Theme }) {
  const i18n = useI18n();
  const { t } = i18n;
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const names = useNameSlug(t("themes.copyName", { name: theme.name }));
  const [errors, setErrors] = useState<{ name?: string; slug?: string; general?: string }>({});
  const duplicate = useDuplicateTheme();
  const busy = duplicate.isPending;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!names.name.trim()) {
      setErrors({ name: t("themes.nameRequired") });
      return;
    }
    if (names.issue) return;
    setErrors({});
    duplicate.mutate(
      { themeId: theme.id, name: names.name.trim(), slug: names.slug || undefined },
      {
        onSuccess: ({ data }) => onDuplicated(data, theme),
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
          if (fields.name || fields.slug) setErrors({ name: fields.name, slug: fields.slug });
          else setErrors({ general: text });
        },
      },
    );
  };

  return (
    <FormDialog
      onClose={onClose}
      busy={busy}
      formId={formId}
      initialFocus={nameRef}
      command={`cssthema duplicate ${theme.slug}`}
      title={t("themes.duplicateTitle", { name: theme.name })}
      description={t("themes.duplicateDescription")}
      submitLabel={busy ? t("themes.duplicating") : t("themes.duplicate")}
      size="sm"
    >
      <form id={formId} onSubmit={onSubmit} noValidate>
        <NameSlugFields
          state={names}
          nameRef={nameRef}
          nameError={errors.name}
          slugError={errors.slug}
          disabled={busy}
          stacked
        />
        {errors.general && (
          <Callout tone="err" className="mt-4 mb-0" role="alert">
            {errors.general}
          </Callout>
        )}
      </form>
    </FormDialog>
  );
}
