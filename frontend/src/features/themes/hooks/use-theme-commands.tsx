import { useCallback, useState } from "react";
import { useDeleteTheme, useExportTheme, useRestoreTheme } from "@/api/queries/themes";
import type { Theme } from "@/api/types";
import { Button, toast } from "@/components/ui";
import { fx } from "@/lib/fx";
import { useI18n } from "@/lib/i18n";
import { exportFilename } from "../lib/actions";
import { copyText } from "../lib/clipboard";
import { errorText } from "../lib/errors";

type CommandTheme = Pick<Theme, "id" | "slug" | "name" | "public_url">;

export interface ThemeCommands {
  /** Thema's waarop nu een actie loopt (knoppen uit, `aria-busy`). */
  busyIds: ReadonlySet<string>;
  exportTheme: (theme: CommandTheme, format: "css" | "bundle") => Promise<boolean>;
  copyUrl: (theme: CommandTheme) => Promise<boolean>;
  /** Soft delete (of `hard`), met bliksem op `card`; bij soft delete een toast met "ongedaan maken". */
  remove: (
    theme: CommandTheme,
    card: Element | null,
    options?: { hard?: boolean },
  ) => Promise<boolean>;
  /** Herstellen, met blauwe vonken op `card`. */
  restore: (theme: CommandTheme, card: Element | null) => Promise<boolean>;
}

/**
 * Acties op een thema met meldingen en effecten (docs/04 § 1): verwijderen = bliksem + flits +
 * shake + zap, herstellen = blauwe vonken. Elke functie geeft `true` als het lukte; fouten
 * worden als toast getoond.
 */
export function useThemeCommands(): ThemeCommands {
  const i18n = useI18n();
  const { t } = i18n;
  const exportMutation = useExportTheme();
  const deleteMutation = useDeleteTheme();
  const restoreMutation = useRestoreTheme();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());

  const track = useCallback(async <T,>(id: string, work: () => Promise<T>): Promise<T> => {
    setBusyIds((previous) => new Set(previous).add(id));
    try {
      return await work();
    } finally {
      setBusyIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const { mutateAsync: exportAsync } = exportMutation;
  const { mutateAsync: deleteAsync } = deleteMutation;
  const { mutateAsync: restoreAsync } = restoreMutation;

  const exportTheme = useCallback<ThemeCommands["exportTheme"]>(
    async (theme, format) => {
      try {
        const file = await track(theme.id, () =>
          exportAsync({
            themeId: theme.id,
            format,
            fallbackName: exportFilename(theme.slug, format),
          }),
        );
        toast.ok(t("themes.exported", { file: file.filename }));
        return true;
      } catch (error) {
        toast.err(errorText(error, i18n));
        return false;
      }
    },
    [exportAsync, i18n, t, track],
  );

  const copyUrl = useCallback<ThemeCommands["copyUrl"]>(
    async (theme) => {
      const ok = await copyText(theme.public_url);
      if (ok) toast.ok(t("themes.urlCopied", { url: theme.public_url }));
      else toast.err(t("themes.copyFailed", { url: theme.public_url }));
      return ok;
    },
    [t],
  );

  const restore = useCallback<ThemeCommands["restore"]>(
    async (theme, card) => {
      try {
        await track(theme.id, () => restoreAsync(theme.id));
        if (card?.isConnected) fx.rollback(card);
        toast.ok(t("themes.restored", { name: theme.name }));
        return true;
      } catch (error) {
        toast.err(errorText(error, i18n));
        return false;
      }
    },
    [i18n, restoreAsync, t, track],
  );

  const remove = useCallback<ThemeCommands["remove"]>(
    async (theme, card, { hard = false } = {}) => {
      const effect = card ? fx.remove(card) : Promise.resolve();
      try {
        await track(theme.id, () =>
          Promise.all([deleteAsync({ themeId: theme.id, hard }), effect]),
        );
      } catch (error) {
        await effect;
        if (card) fx.unzap(card);
        toast.err(errorText(error, i18n));
        return false;
      }
      if (hard) {
        toast.ok(t("themes.purged", { name: theme.name }));
      } else {
        let id = 0;
        id = toast.ok(
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{t("themes.deleted", { name: theme.name })}</span>
            <Button
              variant="mini"
              onClick={() => {
                toast.dismiss(id);
                void restore(theme, null);
              }}
            >
              ↺ {t("themes.undo")}
            </Button>
          </span>,
          { duration: 8000 },
        );
      }
      return true;
    },
    [deleteAsync, i18n, restore, t, track],
  );

  return { busyIds, exportTheme, copyUrl, remove, restore };
}
