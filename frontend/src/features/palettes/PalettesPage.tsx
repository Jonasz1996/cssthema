import { useId, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { usePalettes } from "@/api/queries/palettes";
import type { Palette } from "@/api/types";
import { useShellCommand } from "@/app/shell-command";
import {
  Button,
  ButtonLink,
  Callout,
  Code,
  Empty,
  Loading,
  PageHeader,
  Pre,
  Table,
  type TableColumn,
  Tag,
  toast,
} from "@/components/ui";
import { copyText } from "@/features/themes/lib/clipboard";
import { errorText } from "@/features/themes/lib/errors";
import { listOf } from "@/features/themes/lib/list";
import { useI18n } from "@/lib/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { PalettePreview } from "./components/PalettePreview";
import { PaletteSwatches } from "./components/PaletteSwatches";
import { orderedTokens, paletteCss, tokenKind, tokenVar } from "./lib/tokens";

type TokenRow = [name: string, value: string];

async function copyWithToast(text: string, done: string, failed: string) {
  if (await copyText(text)) toast.ok(done);
  else toast.err(failed);
}

function TokenSample({ name, value }: { name: string; value: string }) {
  switch (tokenKind(name, value)) {
    case "color":
      return (
        <span
          aria-hidden
          className="inline-block size-5 rounded-[5px] border border-white/20 align-middle"
          style={{ background: value }}
        />
      );
    case "length":
      return (
        <span
          aria-hidden
          className="inline-block size-5 border border-white/50 bg-white/10 align-middle"
          style={{ borderRadius: value }}
        />
      );
    case "font":
      return (
        <span aria-hidden className="text-[15px] text-heading" style={{ fontFamily: value }}>
          Aa
        </span>
      );
    default:
      return null;
  }
}

function PaletteDetail({ palette }: { palette: Palette }) {
  const { t, tc } = useI18n();
  const titleId = useId();
  const css = paletteCss(palette.tokens);

  const columns: TableColumn<TokenRow>[] = [
    {
      key: "token",
      header: t("palettes.colToken"),
      // Kopieerknoppen rechts uitgelijnd in de kolom, alle cellen verticaal gecentreerd.
      className: "align-middle",
      cell: ([name]) => (
        <span className="flex items-center justify-between gap-1.5">
          <Code>{tokenVar(name)}</Code>
          <Button
            variant="mini"
            size="icon"
            className="size-6 text-[11px]"
            aria-label={t("palettes.copyVar", { name: `var(${tokenVar(name)})` })}
            title={t("palettes.copyVar", { name: `var(${tokenVar(name)})` })}
            onClick={() =>
              void copyWithToast(
                `var(${tokenVar(name)})`,
                t("palettes.copied", { text: `var(${tokenVar(name)})` }),
                t("palettes.copyFailed"),
              )
            }
          >
            ⧉
          </Button>
        </span>
      ),
    },
    {
      key: "sample",
      header: t("palettes.colSample"),
      cell: ([name, value]) => <TokenSample name={name} value={value} />,
      className: "w-[90px] align-middle",
    },
    {
      key: "value",
      header: t("palettes.colValue"),
      cell: ([, value]) => <Code className="break-all">{value}</Code>,
      className: "align-middle",
    },
  ];

  return (
    <article aria-labelledby={titleId} className="min-w-0" data-palette-detail={palette.slug}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 id={titleId} className="m-0 text-[18px] font-bold text-heading">
          {palette.name}
        </h2>
        {palette.is_builtin && <Tag>{t("palettes.builtin")}</Tag>}
        <Tag>{palette.slug}</Tag>
      </header>
      <p className="mt-1.5 mb-3.5 text-[12.5px] leading-[1.6] text-muted">
        {palette.is_builtin ? t("palettes.builtinHint") : t("palettes.customHint")}{" "}
        {palette.theme_count > 0 ? (
          <Link to={`/themes?palette=${palette.id}`} className="text-fg underline hover:text-white">
            {tc("palettes.usedBy", palette.theme_count)} →
          </Link>
        ) : (
          t("palettes.unused")
        )}
      </p>

      <PalettePreview palette={palette} />

      <h3 className="mt-5 mb-0 text-[13px] font-bold text-heading">{t("palettes.tokens")}</h3>
      <Table
        columns={columns}
        rows={orderedTokens(palette.tokens)}
        rowKey={([name]) => name}
        caption={t("palettes.tokensCaption", { name: palette.name })}
      />

      <div className="mt-5 mb-1.5 flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[13px] font-bold text-heading">{t("palettes.css")}</h3>
        <Button
          variant="mini"
          onClick={() => void copyWithToast(css, t("palettes.cssCopied"), t("palettes.copyFailed"))}
        >
          ⧉ {t("palettes.copyCss")}
        </Button>
      </div>
      <p className="mt-0 mb-2 text-[12px] text-dim">{t("palettes.cssHint")}</p>
      <Pre data-palette-css="">{css}</Pre>
    </article>
  );
}

/**
 * Paletten (`/palettes`, docs/04 § 3.10): de ingebouwde paletten met kleurstalen, een
 * voorbeeld en hun tokens als `--ct-*`-variabelen. In fase 1 alleen lezen.
 */
export function PalettesPage() {
  const i18n = useI18n();
  const { t, tc } = i18n;
  const [params] = useSearchParams();
  const palettes = usePalettes();
  const list = listOf(palettes.data);
  const selected = list.find((palette) => palette.slug === params.get("palette")) ?? list[0];
  const detailRef = useRef<HTMLDivElement>(null);

  useShellCommand(selected ? `cssthema palettes ${selected.slug}` : null);

  // Op een smal scherm staat het detail onder de lijst: na een keuze ernaartoe scrollen.
  const revealDetail = () => {
    if (!window.matchMedia?.("(max-width: 767px)").matches) return;
    requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      }),
    );
  };

  return (
    <section>
      <PageHeader title={t("palettes.title")} hint={t("palettes.hint")} />
      {palettes.isPending ? (
        <Loading />
      ) : palettes.isError ? (
        <Callout
          tone="err"
          title={t("palettes.loadError")}
          actions={
            <Button variant="alt" size="sm" onClick={() => void palettes.refetch()}>
              ⟳ {t("themes.retry")}
            </Button>
          }
        >
          {errorText(palettes.error, i18n)}
        </Callout>
      ) : !selected ? (
        <Empty>{t("palettes.empty")}</Empty>
      ) : (
        <div className="grid gap-5 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
          <nav aria-label={t("palettes.listLabel")} className="min-w-0">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {list.map((palette) => (
                <li key={palette.id}>
                  <ButtonLink
                    to={`?palette=${encodeURIComponent(palette.slug)}`}
                    replace
                    preventScrollReset
                    size="sm"
                    active={palette.id === selected.id}
                    onClick={revealDetail}
                    className="w-full justify-start gap-2.5 text-left"
                  >
                    <PaletteSwatches palette={palette} size="md" />
                    <span className="min-w-0 flex-1 truncate">{palette.name}</span>
                    {/* Visueel alleen het aantal; voor schermlezers een zin, na een spatie
                        (die flex niet toont) zodat de naam niet aan elkaar plakt. */}
                    {palette.theme_count > 0 && (
                      <>
                        <span aria-hidden className="text-[11px] font-normal text-muted">
                          {palette.theme_count}
                        </span>{" "}
                        <span className="sr-only">
                          {tc("palettes.usedBy", palette.theme_count)}
                        </span>
                      </>
                    )}
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </nav>
          <div ref={detailRef} className="min-w-0 scroll-mt-4">
            <PaletteDetail palette={selected} />
          </div>
        </div>
      )}
    </section>
  );
}
