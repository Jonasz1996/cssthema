import { isApiError, NETWORK_ERROR } from "@/api/client";
import type { I18n, MessageKey } from "@/lib/i18n";

/**
 * Leesbare foutmelding voor een fout uit de API-laag. De server stuurt specifieke Nederlandse
 * teksten (bv. "Slug 'proxmox' is al in gebruik."): in het Nederlands tonen we die. In het
 * Engels vertalen we op `code`; onbekende codes houden de servertekst.
 */
const ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  slug_conflict: "themes.errorSlugConflict",
  invalid_slug: "themes.errorInvalidSlug",
  state_conflict: "themes.errorStateConflict",
  not_found: "themes.errorNotFound",
  precondition_failed: "themes.errorPrecondition",
  payload_too_large: "themes.errorTooLarge",
  unsupported_media_type: "themes.errorUnsupported",
  theme_lint_failed: "themes.errorLint",
  validation_error: "themes.errorValidation",
  // Schrijven geweigerd: van een andere pagina (api) of niet via de reverse proxy (nginx).
  csrf_failed: "themes.errorCsrf",
  proxy_required: "themes.errorProxyRequired",
};

/** Eigen Engelse teksten per foutcode voor één scherm (bv. scripts in plaats van thema's). */
export type ErrorKeys = Readonly<Partial<Record<string, MessageKey>>>;

/**
 * `keys` gaat voor op de standaardvertalingen (alleen in het Engels; in het Nederlands blijft
 * de specifieke tekst van de server staan).
 */
export function errorText(
  error: unknown,
  i18n: Pick<I18n, "t" | "locale">,
  keys?: ErrorKeys,
): string {
  if (!isApiError(error)) return i18n.t("themes.errorUnknown");
  return apiErrorText(
    {
      code: error.code,
      status: error.status,
      message: error.message,
      fromServer: error.problem !== null,
    },
    i18n,
    keys,
  );
}

export interface ApiErrorParts {
  code: string;
  status: number;
  /** Tekst van de server (Problem `detail`/`title`). */
  message: string;
  /**
   * `true` als de tekst uit een Problem-body van cssthema komt. Zonder Problem-body (een proxy,
   * nginx, de browser) is de tekst niet voor mensen bedoeld (HTML, "Failed to fetch") en tonen
   * we een eigen melding.
   */
  fromServer: boolean;
}

/** Zoals `errorText`, voor een fout die al ontleed is (bv. de foutstatus van de autosave). */
export function apiErrorText(
  { code, status, message, fromServer }: ApiErrorParts,
  { t, locale }: Pick<I18n, "t" | "locale">,
  keys?: ErrorKeys,
): string {
  if (code === NETWORK_ERROR) return t("themes.errorNetwork");
  if (!fromServer) {
    if (status === 413) return t("themes.errorTooLarge");
    if (status >= 500) return t("themes.errorServer");
    return status > 0 ? t("themes.errorHttp", { status }) : t("themes.errorUnknown");
  }
  if (locale === "nl") return message;
  const key = keys?.[code] ?? ERROR_KEYS[code];
  return key ? t(key) : message;
}
