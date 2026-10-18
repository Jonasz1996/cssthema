import type { Palette } from "@/api/types";
import { useI18n } from "@/lib/i18n";
import { tokenValue } from "../lib/tokens";

/**
 * Klein voorbeeldscherm in de kleuren van een palet: kop, kaart met tekst, knoppen, een veld en
 * statuslabels. Puur illustratief (`aria-hidden`); het bijschrift zegt wat het is.
 */
export function PalettePreview({ palette }: { palette: Pick<Palette, "name" | "tokens"> }) {
  const { t } = useI18n();
  const v = (token: Parameters<typeof tokenValue>[1]) => tokenValue(palette, token);
  const radius = v("radius");
  const chip = (color: string, label: string) => (
    <span
      style={{ color, border: `1px solid ${color}`, borderRadius: 999 }}
      className="px-2 py-px text-[11px]"
    >
      {label}
    </span>
  );

  return (
    <figure className="m-0">
      <div
        aria-hidden
        data-palette-preview=""
        style={{
          background: v("bg"),
          color: v("fg"),
          fontFamily: v("font-sans"),
          borderRadius: radius,
          border: `1px solid ${v("border")}`,
        }}
        className="overflow-hidden text-[13px]"
      >
        <div
          style={{ background: v("surface"), borderBottom: `1px solid ${v("border")}` }}
          className="flex items-center gap-2 px-3.5 py-2.5"
        >
          <b>{palette.name}</b>
          <span style={{ color: v("muted") }} className="text-[12px]">
            · {t("palettes.previewNav")}
          </span>
          <span className="ml-auto flex gap-1.5">
            {chip(v("success"), "ok")}
            {chip(v("warning"), "!")}
            {chip(v("danger"), "✕")}
          </span>
        </div>
        <div className="grid gap-3 p-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div
            style={{
              background: v("surface"),
              border: `1px solid ${v("border")}`,
              borderRadius: radius,
            }}
            className="p-3"
          >
            <b className="block">{t("palettes.previewCardTitle")}</b>
            <span style={{ color: v("muted") }} className="mt-1 block text-[12px]">
              {t("palettes.previewCardText")}
            </span>
            <span className="mt-3 flex flex-wrap gap-2">
              <span
                style={{ background: v("accent"), color: v("accent-fg"), borderRadius: radius }}
                className="px-3 py-1.5 font-bold"
              >
                {t("palettes.previewPrimary")}
              </span>
              <span
                style={{ border: `1px solid ${v("border")}`, borderRadius: radius }}
                className="px-3 py-1.5"
              >
                {t("palettes.previewSecondary")}
              </span>
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span
              style={{
                background: v("surface"),
                border: `1px solid ${v("border")}`,
                borderRadius: radius,
                color: v("muted"),
              }}
              className="px-3 py-2"
            >
              {t("palettes.previewInput")}
            </span>
            <code
              style={{
                fontFamily: v("font-mono"),
                background: v("surface"),
                borderRadius: radius,
                color: v("accent"),
              }}
              className="truncate px-3 py-2 text-[12px]"
            >
              color: var(--ct-accent);
            </code>
            <span style={{ color: v("success") }} className="text-[12px]">
              ✓ {t("palettes.previewSaved")}
            </span>
          </div>
        </div>
      </div>
      <figcaption className="mt-1.5 text-[11.5px] text-dim">
        {t("palettes.previewCaption", { name: palette.name })}
      </figcaption>
    </figure>
  );
}
