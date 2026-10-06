import type { Palette } from "@/api/types";
import { tokenValue } from "@/features/palettes/lib/tokens";

/**
 * Basissjabloon voor een nieuw thema: generieke regels die de `--ct-*`-variabelen van het
 * gekoppelde palet gebruiken. Elke `var()` heeft de waarde van het gekozen palet als terugval,
 * zodat het sjabloon ook zonder (of na het wisselen van) palet iets zinnigs toont.
 */
export function starterTemplate(
  name: string,
  palette?: Pick<Palette, "name" | "tokens"> | null,
): string {
  const v = (token: Parameters<typeof tokenValue>[1]) =>
    `var(--ct-${token}, ${tokenValue(palette, token)})`;
  const title = name.trim().replace(/\*\//g, "* /") || "Nieuw thema";
  const source = palette
    ? `Palet: ${palette.name.replace(/\*\//g, "* /")} (--ct-* komen uit het palet).`
    : "Zonder palet: de waarden achter de komma's in var() gelden.";

  return `/* ${title} — basissjabloon
 * ${source}
 */

:root {
  color-scheme: dark;
}

body {
  background: ${v("bg")};
  color: ${v("fg")};
  font-family: ${v("font-sans")};
}

a {
  color: ${v("accent")};
}

header,
nav,
aside,
.card,
.panel {
  background: ${v("surface")};
  border: 1px solid ${v("border")};
  border-radius: ${v("radius")};
}

button,
.btn {
  background: ${v("accent")};
  color: ${v("accent-fg")};
  border: 1px solid ${v("border")};
  border-radius: ${v("radius")};
}

input,
select,
textarea {
  background: ${v("surface")};
  color: ${v("fg")};
  border: 1px solid ${v("border")};
  border-radius: ${v("radius")};
}

code,
pre {
  font-family: ${v("font-mono")};
}

small,
.muted {
  color: ${v("muted")};
}

.success {
  color: ${v("success")};
}

.warning {
  color: ${v("warning")};
}

.danger,
.error {
  color: ${v("danger")};
}
`;
}
