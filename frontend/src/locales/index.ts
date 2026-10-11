/**
 * Vertalingen per taal en per namespace (`<taal>/<namespace>.json`). Elke namespace is een
 * eigen bestand zodat verschillende features tegelijk sleutels kunnen toevoegen zonder
 * merge-conflicten. `src/lib/i18n.ts` voegt ze samen tot één platte map met sleutels
 * `<namespace>.<sleutel>` (bv. `nav.themes`).
 *
 * Een nieuwe namespace toevoegen: het bestand in `en/` én `nl/` aanmaken en hieronder in
 * beide objecten opnemen. Engels is de bron van de sleutels (type `MessageKey`); de test
 * `i18n.test.ts` controleert dat het Nederlands dezelfde sleutels heeft.
 */
import enCommon from "./en/common.json";
import enDashboard from "./en/dashboard.json";
import enEditor from "./en/editor.json";
import enHosts from "./en/hosts.json";
import enImport from "./en/import.json";
import enNav from "./en/nav.json";
import enPalettes from "./en/palettes.json";
import enThemes from "./en/themes.json";
import enVersions from "./en/versions.json";
import nlCommon from "./nl/common.json";
import nlDashboard from "./nl/dashboard.json";
import nlEditor from "./nl/editor.json";
import nlHosts from "./nl/hosts.json";
import nlImport from "./nl/import.json";
import nlNav from "./nl/nav.json";
import nlPalettes from "./nl/palettes.json";
import nlThemes from "./nl/themes.json";
import nlVersions from "./nl/versions.json";

export const en = {
  common: enCommon,
  nav: enNav,
  dashboard: enDashboard,
  themes: enThemes,
  editor: enEditor,
  versions: enVersions,
  palettes: enPalettes,
  import: enImport,
  hosts: enHosts,
};

export type Namespaces = typeof en;
export type NamespaceName = keyof Namespaces & string;

/** Andere talen mogen sleutels missen (terugval op Engels), maar geen onbekende namespaces hebben. */
export const nl: { [N in NamespaceName]: Partial<Record<keyof Namespaces[N], string>> } = {
  common: nlCommon,
  nav: nlNav,
  dashboard: nlDashboard,
  themes: nlThemes,
  editor: nlEditor,
  versions: nlVersions,
  palettes: nlPalettes,
  import: nlImport,
  hosts: nlHosts,
};
