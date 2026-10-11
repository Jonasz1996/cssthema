import { useHostOptions } from "@/api/queries/hosts";
import { Button, Callout, Category, Details, Loading, Pre, toast } from "@/components/ui";
import { copyText } from "@/features/themes/lib/clipboard";
import { errorText } from "@/features/themes/lib/errors";
import { useI18n } from "@/lib/i18n";

async function copyWithToast(text: string, done: string, failed: string) {
  if (await copyText(text)) toast.ok(done);
  else toast.err(failed);
}

/** Kaart "Regel voor NPM": de `sub_filter`-regel voor elke proxy host, en de variant via het eigen domein. */
export function NpmSnippet() {
  const i18n = useI18n();
  const { t } = i18n;
  const options = useHostOptions();

  const copyButton = (text: string, label: string) => (
    <Button
      variant="alt"
      size="sm"
      onClick={() => void copyWithToast(text, t("hosts.snippetCopied"), t("hosts.copyFailed"))}
    >
      <span aria-hidden>⧉</span>
      {label}
    </Button>
  );

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
            <figure className="m-0">
              <figcaption className="sr-only">{t("hosts.snippetLabel")}</figcaption>
              <Pre data-snippet-code="" className="break-normal [overflow-wrap:anywhere]">
                {options.data.snippet}
              </Pre>
            </figure>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {copyButton(options.data.snippet, t("hosts.snippetCopy"))}
            </div>
            <Details summary={t("hosts.ownDomainSummary")} className="mt-3">
              <p className="m-0 mb-2 max-w-[80ch] leading-[1.6] text-muted">
                {t("hosts.ownDomainText")}
              </p>
              <figure className="m-0">
                <figcaption className="sr-only">{t("hosts.ownDomainLabel")}</figcaption>
                <Pre data-snippet-own-domain="" className="break-normal [overflow-wrap:anywhere]">
                  {options.data.snippet_own_domain}
                </Pre>
              </figure>
              <div className="mt-2.5 mb-1 flex flex-wrap items-center gap-2">
                {copyButton(options.data.snippet_own_domain, t("hosts.ownDomainCopy"))}
              </div>
            </Details>
          </>
        )}
      </div>
    </Category>
  );
}
