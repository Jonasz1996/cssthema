import { useHealth } from "@/api/queries/health";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useUiStore } from "./ui-store";

type HealthView = "checking" | "ok" | "error";

const dotClass: Record<HealthView, string> = {
  checking: "text-dim",
  ok: "text-ok",
  error: "text-err",
};

/** Kleine systeemstatus uit `/readyz`: ● ok / ● fout. */
export function SystemStatus() {
  const { t } = useI18n();
  const { isPending, isError } = useHealth("/readyz");
  const state: HealthView = isPending ? "checking" : isError ? "error" : "ok";
  const label =
    state === "ok"
      ? t("common.statusOk")
      : state === "error"
        ? t("common.statusError")
        : t("common.statusChecking");
  return (
    <span
      data-state={state}
      title={t("common.statusTitle", { state: label })}
      className="inline-flex items-center gap-1.5 px-1 text-[12px] whitespace-nowrap text-muted"
    >
      <span aria-hidden className={dotClass[state]}>
        ●
      </span>
      <span className="sr-only">{t("common.statusLabel")}: </span>
      {label}
    </span>
  );
}

/** Schakelaar voor de bewegende achtergrond; uit (en vergrendeld) bij reduced motion. */
export function BackgroundToggle() {
  const { t } = useI18n();
  const enabled = useUiStore((state) => state.backgroundEnabled);
  const setEnabled = useUiStore((state) => state.setBackgroundEnabled);
  const reduced = useReducedMotion();
  return (
    <Button
      variant="mini"
      aria-pressed={enabled && !reduced}
      disabled={reduced}
      title={reduced ? t("common.backgroundReduced") : t("common.backgroundToggle")}
      onClick={() => setEnabled(!enabled)}
    >
      <span aria-hidden className={cn(enabled && !reduced ? "text-white" : "text-dim")}>
        ✦
      </span>
      {t("common.backgroundLabel")}
    </Button>
  );
}

/** Wissel tussen Nederlands en Engels. */
export function LanguageToggle() {
  const { t, locale } = useI18n();
  const setLocale = useUiStore((state) => state.setLocale);
  const next = locale === "nl" ? "en" : "nl";
  return (
    <Button
      variant="mini"
      lang={next}
      aria-label={t("common.switchLanguage")}
      title={t("common.switchLanguage")}
      onClick={() => setLocale(next)}
    >
      {t("common.switchLanguageShort")}
    </Button>
  );
}
