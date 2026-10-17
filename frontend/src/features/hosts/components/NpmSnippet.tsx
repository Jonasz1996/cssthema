import { useHostOptions } from "@/api/queries/hosts";
import { Button, Callout, Category, Code, Details, Loading, Pre, toast } from "@/components/ui";
import { copyText } from "@/features/themes/lib/clipboard";
import { errorText } from "@/features/themes/lib/errors";
import { useI18n } from "@/lib/i18n";

async function copyWithToast(text: string, done: string, failed: string) {
  if (await copyText(text)) toast.ok(done);
  else toast.err(failed);
}

/**
 * Kaart "Regel voor NPM": het blok voor Advanced van elke proxy host (server-niveau, nooit in
 * een `location /`), de hosts die het nooit krijgen, en de varianten via het eigen domein: alleen
 * CSS, en apart (met waarschuwing) mét script.
 */
export function NpmSnippet() {
  const i18n = useI18n();
  const { t } = i18n;
  const options = useHostOptions();

  /** Het blok zelf met een kopieerknop; `attr` is het data-attribuut van de `<pre>`. */
  const block = (text: string, label: string, attr: string, copyLabel: string) => (
    <>
      <figure className="m-0">
        <figcaption className="sr-only">{label}</figcaption>
        <Pre {...{ [attr]: "" }} className="break-normal [overflow-wrap:anywhere]">
          {text}
        </Pre>
      </figure>
      <div className="mt-2.5 mb-1 flex flex-wrap items-center gap-2">
        <Button
          variant="alt"
          size="sm"
          onClick={() => void copyWithToast(text, t("hosts.snippetCopied"), t("hosts.copyFailed"))}
        >
          <span aria-hidden>⧉</span>
          {copyLabel}
        </Button>
      </div>
    </>
  );

  const excluded = options.data?.excluded_hosts ?? [];
  const withScript = options.data?.snippet_own_domain_script ?? "";

  return (
    <Category title={t("hosts.snippetTitle")} storageKey="hosts.snippet" className="mb-4">
      <div data-npm-snippet="" className="px-1 pt-1">
        <p className="m-0 mb-2 max-w-[80ch] text-[12.5px] leading-[1.6] text-muted">
          {t("hosts.snippetIntro")}
        </p>
        {options.isPending ? (
          <Loading />
        ) : options.isError ? (
          <Callout tone="err" title={t("hosts.optionsError")} className="mb-1">
            {errorText(options.error, i18n)}
          </Callout>
        ) : (
          <>
            {block(
              options.data.snippet,
              t("hosts.snippetLabel"),
              "data-snippet-code",
              t("hosts.snippetCopy"),
            )}
            <p className="m-0 mt-2 mb-3 max-w-[80ch] text-[12px] leading-[1.55] text-dim">
              {t("hosts.snippetWhy")}
            </p>
            <Callout
              tone="mid"
              title={t("hosts.neverTitle")}
              className="max-w-[80ch]"
              data-never-inject=""
            >
              {t("hosts.neverText")}
              {excluded.length > 0 && (
                <ul
                  aria-label={t("hosts.neverListLabel")}
                  className="m-0 mt-2 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 whitespace-normal"
                >
                  {excluded.map((host) => (
                    <li key={host}>
                      <Code>{host}</Code>
                    </li>
                  ))}
                </ul>
              )}
            </Callout>
            <Details summary={t("hosts.ownDomainSummary")} className="mt-3">
              <p className="m-0 mb-2 max-w-[80ch] leading-[1.6] text-muted">
                {t("hosts.ownDomainText")}
              </p>
              {block(
                options.data.snippet_own_domain,
                t("hosts.ownDomainLabel"),
                "data-snippet-own-domain",
                t("hosts.ownDomainCopy"),
              )}
              {withScript && (
                <Details summary={t("hosts.ownDomainScriptSummary")} className="mt-3">
                  <Callout
                    tone="err"
                    title={`⚠ ${t("hosts.ownDomainScriptWarningTitle")}`}
                    className="mt-2 max-w-[80ch]"
                  >
                    {t("hosts.ownDomainScriptWarning")}
                  </Callout>
                  {block(
                    withScript,
                    t("hosts.ownDomainScriptLabel"),
                    "data-snippet-own-domain-script",
                    t("hosts.ownDomainScriptCopy"),
                  )}
                </Details>
              )}
            </Details>
          </>
        )}
      </div>
    </Category>
  );
}
