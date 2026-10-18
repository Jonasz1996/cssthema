import type { RefObject } from "react";
import { Code, Field, Input } from "@/components/ui";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { NameSlugState } from "../hooks/use-name-slug";
import { publicCssUrl, useMeta } from "../hooks/use-meta";
import type { SlugIssue } from "../lib/slug";

const ISSUE_KEYS: Record<SlugIssue, MessageKey> = {
  short: "themes.slugTooShort",
  long: "themes.slugTooLong",
  format: "themes.slugFormat",
  reserved: "themes.slugReserved",
};

export interface NameSlugFieldsProps {
  state: NameSlugState;
  nameRef?: RefObject<HTMLInputElement | null>;
  /** Fouten van de server (409 `slug_conflict`, 422 veldfouten). */
  nameError?: string | null;
  slugError?: string | null;
  disabled?: boolean;
  /** Onder elkaar in plaats van naast elkaar (smalle dialoog). */
  stacked?: boolean;
}

/** Naam + slug met live voorstel, controle en de toekomstige live-URL. */
export function NameSlugFields({
  state,
  nameRef,
  nameError,
  slugError,
  disabled,
  stacked = false,
}: NameSlugFieldsProps) {
  const { t } = useI18n();
  const meta = useMeta();
  const url = publicCssUrl(meta.data?.public_base_url, state.slug);
  const issue = state.issue ? t(ISSUE_KEYS[state.issue], { slug: state.slug }) : null;

  return (
    <div className={stacked ? "grid" : "grid gap-x-4 sm:grid-cols-2"}>
      <Field label={t("themes.fieldName")} error={nameError}>
        <Input
          ref={nameRef}
          value={state.name}
          onChange={(event) => state.setName(event.target.value)}
          maxLength={120}
          required
          autoComplete="off"
          disabled={disabled}
        />
      </Field>
      <Field
        label={t("themes.fieldSlug")}
        error={slugError || issue}
        hint={
          url ? (
            <>
              {t("themes.slugHintUrl")} <Code>{url}</Code>
            </>
          ) : state.slugEdited ? undefined : (
            t("themes.slugHintAuto")
          )
        }
      >
        <Input
          value={state.slug}
          onChange={(event) => state.setSlug(event.target.value)}
          placeholder={t("themes.slugPlaceholder")}
          maxLength={64}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          disabled={disabled}
          data-slug-edited={state.slugEdited || undefined}
        />
      </Field>
    </div>
  );
}
