import type { Palette, ThemeCreate } from "@/api/types";
import { starterTemplate } from "./template";

/** Startinhoud van een nieuw thema (docs/04 § 3.5: leeg · kopie van een thema · basissjabloon). */
export type StartKind = "empty" | "copy" | "template";

export interface NewThemeForm {
  name: string;
  /** Leeg = de server leidt de slug af van de naam. */
  slug: string;
  paletteId: string;
  description: string;
  start: StartKind;
  /** Thema-id bij `start: "copy"`. */
  copyFrom: string;
}

/** Formulier → `POST /themes`-body. Lege optionele velden worden weggelaten of `null`. */
export function buildThemeCreate(
  form: NewThemeForm,
  palette: Pick<Palette, "name" | "tokens"> | null | undefined,
): ThemeCreate {
  const body: ThemeCreate = {
    name: form.name.trim(),
    palette_id: form.paletteId || null,
    description: form.description.trim() || null,
  };
  const slug = form.slug.trim();
  if (slug) body.slug = slug;
  if (form.start === "copy" && form.copyFrom) {
    body.template = { kind: "theme", id: form.copyFrom };
  } else if (form.start === "template") {
    body.css = starterTemplate(form.name, palette);
  }
  return body;
}
