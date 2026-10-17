import { useHostHealth, useStartHostCheck } from "@/api/queries/hosts";
import { Button, toast } from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { formatDateTime, formatRelativeTime } from "@/features/themes/lib/format";
import { useI18n } from "@/lib/i18n";
import { healthSummary } from "../lib/hosts";

/**
 * "Alles controleren" met de tijd van de laatste controle. De controle loopt op de server op de
 * achtergrond; `useHostHealth` pollt zolang `check_running` waar is.
 */
export function HostCheckBar() {
  const i18n = useI18n();
  const { t, tc, locale } = i18n;
  const health = useHostHealth();
  const start = useStartHostCheck();
  const running = health.data?.check_running === true || start.isPending;
  const finished = health.data?.check_finished_at ?? null;
  const summary = healthSummary(health.data?.hosts);
  const summaryParts = [
    tc("hosts.healthOk", summary.ok),
    tc("hosts.healthLogin", summary.login),
    tc("hosts.healthWarn", summary.warn),
    tc("hosts.healthError", summary.error),
    ...(summary.unchecked ? [tc("hosts.healthUnchecked", summary.unchecked)] : []),
  ];
  const counted = summary.ok + summary.login + summary.warn + summary.error + summary.unchecked;

  const onCheck = () =>
    start.mutate(undefined, {
      onSuccess: (result) =>
        result.started ? toast.ok(t("hosts.checkStarted")) : toast(t("hosts.checkAlreadyRunning")),
      onError: (error) => toast.err(errorText(error, i18n)),
    });

  return (
    <section
      aria-label={t("hosts.checkTitle")}
      className="mb-3.5 max-w-[90ch] rounded-xl border border-line bg-white/3 px-3.5 py-3"
    >
      <p className="m-0 text-[12.5px] leading-[1.55] text-body">{t("hosts.checkIntro")}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" onClick={onCheck} disabled={running} aria-busy={running || undefined}>
          {running ? (
            <>
              <span aria-hidden className="inline-block motion-safe:animate-spin">
                ⟳
              </span>
              {t("hosts.checkRunning")}
            </>
          ) : (
            t("hosts.checkAll")
          )}
        </Button>
        {health.isSuccess && (
          <p role="status" className="m-0 text-[12px] text-muted">
            {finished ? (
              <time dateTime={finished} title={formatDateTime(finished, locale)}>
                {t("hosts.lastCheck", { time: formatRelativeTime(finished, locale) })}
              </time>
            ) : (
              t("hosts.neverChecked")
            )}
          </p>
        )}
        {health.isError && (
          <p role="alert" className="m-0 text-[12px] text-err">
            {t("hosts.healthError")}
          </p>
        )}
      </div>
      {health.isSuccess && counted > 0 && (
        <p data-health-summary="" className="m-0 mt-2 text-[12px] text-muted">
          <span className="sr-only">{t("hosts.healthSummaryLabel")}: </span>
          {summaryParts.join(" · ")}
        </p>
      )}
    </section>
  );
}
