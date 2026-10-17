import type { Theme, ThemeUpdate } from "@/api/types";

/** Het formulier "Instellingen" in de editor (review FE-4): naam, slug, beschrijving, palet. */
export interface ThemeSettingsForm {
  name: string;
  slug: string;
  description: string;
  /** Leeg = geen palet. */
  paletteId: string;
}

export function themeSettingsForm(
  theme: Pick<Theme, "name" | "slug" | "description" | "palette_id">,
): ThemeSettingsForm {
  return {
    name: theme.name,
    slug: theme.slug,
    description: theme.description ?? "",
    paletteId: theme.palette_id ?? "",
  };
}

/**
 * Formulier → `PATCH /themes/{id}`-body met alleen wat echt veranderde: `useUpdateTheme`
 * ververst hosts en paletten zodra `slug` of `palette_id` in de body staat, ook als de waarde
 * gelijk bleef. Een lege naam of slug laat het veld zoals het is (de dialoog meldt dat vooraf);
 * een lege beschrijving maakt hem leeg (`null`).
 */
export function themeSettingsPatch(
  theme: Pick<Theme, "name" | "slug" | "description" | "palette_id">,
  form: ThemeSettingsForm,
): ThemeUpdate {
  const patch: ThemeUpdate = {};
  const name = form.name.trim();
  if (name && name !== theme.name) patch.name = name;
  const slug = form.slug.trim();
  if (slug && slug !== theme.slug) patch.slug = slug;
  const description = form.description.trim() || null;
  if (description !== (theme.description?.trim() || null)) patch.description = description;
  const paletteId = form.paletteId || null;
  if (paletteId !== theme.palette_id) patch.palette_id = paletteId;
  return patch;
}
