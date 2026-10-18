import type { MessageKey } from "@/lib/i18n";
import type { DemoTexts } from "./demo-page";

/** Velden van de demo-pagina; de tekst staat in `editor.demo<Veld>` (nl/en). */
export const DEMO_TEXT_FIELDS = [
  "brand",
  "navOverview",
  "navServices",
  "navSettings",
  "search",
  "sidebarTitle",
  "menuDashboard",
  "menuUsers",
  "menuFiles",
  "menuLogs",
  "breadcrumb",
  "title",
  "lead",
  "paletteTitle",
  "alertInfo",
  "alertSuccess",
  "alertWarning",
  "alertDanger",
  "buttonPrimary",
  "buttonSecondary",
  "buttonDanger",
  "buttonDisabled",
  "link",
  "cardTitle",
  "cardText",
  "cardAction",
  "tableTitle",
  "colName",
  "colStatus",
  "colCpu",
  "colUpdated",
  "statusOnline",
  "statusWarning",
  "statusOffline",
  "formTitle",
  "fieldName",
  "fieldEmail",
  "fieldRole",
  "fieldNotes",
  "optionAdmin",
  "optionUser",
  "checkboxLabel",
  "radioA",
  "radioB",
  "submit",
  "loginTitle",
  "loginUser",
  "loginPassword",
  "loginButton",
  "loginForgot",
  "tabsTitle",
  "tabOne",
  "tabTwo",
  "tabThree",
  "tabPanel",
  "dialogTitle",
  "dialogText",
  "dialogConfirm",
  "dialogCancel",
  "progressLabel",
  "codeTitle",
  "footer",
] as const satisfies readonly (keyof DemoTexts)[];

/** i18n-sleutel van een veld, bv. `brand` → `editor.demoBrand`. */
export function demoTextKey(field: keyof DemoTexts): MessageKey {
  return `editor.demo${field[0]!.toUpperCase()}${field.slice(1)}` as MessageKey;
}

export function demoTexts(t: (key: MessageKey) => string): DemoTexts {
  const texts = {} as DemoTexts;
  for (const field of DEMO_TEXT_FIELDS) texts[field] = t(demoTextKey(field));
  return texts;
}

/** Compileert alleen als `DEMO_TEXT_FIELDS` alle velden van `DemoTexts` bevat. */
export const DEMO_TEXT_FIELDS_COMPLETE: [
  Exclude<keyof DemoTexts, (typeof DEMO_TEXT_FIELDS)[number]>,
] extends [never]
  ? true
  : never = true;
