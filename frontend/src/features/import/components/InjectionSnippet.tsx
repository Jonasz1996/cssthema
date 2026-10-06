import { useId, useMemo, useState } from "react";
import { useThemes } from "@/api/queries/themes";
import type { ScriptFile } from "@/api/types";
import { Button, Callout, Category, Field, Input, Pre, Select, toast } from "@/components/ui";
import { useMeta } from "@/features/themes/hooks/use-meta";
import { copyText } from "@/features/themes/lib/clipboard";
import { listOf } from "@/features/themes/lib/list";
import { useI18n } from "@/lib/i18n";
import { injectionSnippet, normalizeScriptName, siblingCssUrl } from "../lib/scripts";

/** Standaardthema en -script van Jonas' algemene look (algemeen.css + algemeen.js). */
export const DEFAULT_SNIPPET_NAME = "algemeen";

/**
 * Snippet voor *Advanced* van een proxy host in Nginx Proxy Manager: thema (vrij te kiezen,
 * standaard `algemeen`) en script vóór `</head>`, plus de waarschuwing dat een script in de app
 * zelf draait. Zonder scripts toont hij `/algemeen.js` als voorbeeld.
 */
export function InjectionSnippet({ scripts }: { scripts: readonly ScriptFile[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const meta = useMeta();
  const themes = useThemes({ status: "published", sort: "name", limit: 200 });
  const listId = useId();
  const [theme, setTheme] = useState(DEFAULT_SNIPPET_NAME);
  const [chosen, setChosen] = useState<string | null>(null);

  const preferred =
    scripts.find((script) => script.name === DEFAULT_SNIPPET_NAME)?.name ?? scripts[0]?.name;
  const scriptName =
    chosen && scripts.some((script) => script.name === chosen) ? chosen : preferred;
  const base = (meta.data?.public_base_url ?? "").replace(/\/+$/, "");
  const scriptUrl =
    scripts.find((script) => script.name === scriptName)?.url ??
    `${base}/${DEFAULT_SNIPPET_NAME}.js`;
  const themeSlug = normalizeScriptName(theme).name;

  const snippet = useMemo(
    () =>
      injectionSnippet({
        cssUrl: themeSlug ? siblingCssUrl(scriptUrl, themeSlug) : null,
        scriptUrl,
        comments: {
          head: t("import.snippetCommentHead"),
          accessList: t("import.snippetCommentAccessList"),
          websockets: t("import.snippetCommentWebsockets"),
        },
      }),
    [scriptUrl, t, themeSlug],
  );

  const copy = async () => {
    if (await copyText(snippet)) toast.ok(t("import.snippetCopied"));
    else toast.err(t("import.snippetCopyFailed"));
  };

  const live = listOf(themes.data?.items);

  return (
    <Category title={t("import.snippetTitle")} storageKey="import.snippet" className="mt-5">
      <div data-snippet="" className="px-1 pt-1">
        <p className="m-0 mb-2 max-w-[80ch] text-[12.5px] leading-[1.6] text-muted">
          {t("import.snippetIntro")}
        </p>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label={t("import.snippetTheme")} hint={t("import.snippetThemeHint")}>
            <Input
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
              list={listId}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          {scripts.length > 1 && (
            <Field label={t("import.snippetScript")}>
              <Select value={scriptName ?? ""} onChange={(event) => setChosen(event.target.value)}>
                {scripts.map((script) => (
                  <option key={script.name} value={script.name}>
                    {script.filename}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <datalist id={listId}>
          {live.map((item) => (
            <option key={item.id} value={item.slug}>
              {item.name}
            </option>
          ))}
        </datalist>
        <figure className="m-0 mt-3">
          <figcaption className="sr-only">{t("import.snippetLabel")}</figcaption>
          <Pre data-snippet-code="" className="break-normal [overflow-wrap:anywhere]">
            {snippet}
          </Pre>
        </figure>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button variant="alt" size="sm" onClick={() => void copy()}>
            <span aria-hidden>⧉</span>
            {t("import.snippetCopy")}
          </Button>
        </div>
        <Callout tone="mid" title={`⚠ ${t("import.scriptWarningTitle")}`} className="mt-3.5 mb-1">
          {t("import.scriptWarning")}
        </Callout>
      </div>
    </Category>
  );
}
