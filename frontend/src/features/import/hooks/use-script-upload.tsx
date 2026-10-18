import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ApiError } from "@/api/client";
import { useUploadScript } from "@/api/queries/scripts";
import type { ScriptFile } from "@/api/types";
import { ConfirmDialog } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import {
  isScriptConflict,
  problemScriptName,
  SCRIPT_ARCHIVE_DIR,
  SCRIPT_SUFFIX,
  scriptTarget,
  shellWord,
} from "../lib/scripts";

export type ScriptUploadOutcome =
  /** Geüpload; `created: false` = een bestaand script is vervangen. */
  | { status: "ok"; script: ScriptFile; created: boolean }
  /** De naam bestond al en de gebruiker koos om niet te vervangen. */
  | { status: "kept"; name: string }
  | { status: "error"; error: ApiError };

export interface ScriptUploadOptions {
  /** Naam in plaats van de bestandsnaam (de server normaliseert hem). */
  name?: string;
  /** Meteen vervangen, zonder te vragen (bv. de knop "Vervangen…" bij een script). */
  replace?: boolean;
}

interface PendingConflict {
  name: string;
  file: string;
  resolve: (replace: boolean) => void;
}

/**
 * Een `.js` uploaden naar `POST /scripts`, met de vraag "vervangen?" bij 409
 * `script_conflict`. `upload()` wacht op die keuze; render `dialog` ergens in de component.
 * Fouten komen terug als `{ status: "error" }` (geen toast: de aanroeper kiest hoe hij ze toont).
 */
export function useScriptUpload(): {
  upload: (file: File, options?: ScriptUploadOptions) => Promise<ScriptUploadOutcome>;
  dialog: ReactNode;
} {
  const { t } = useI18n();
  const { mutateAsync } = useUploadScript();
  const [pending, setPending] = useState<PendingConflict | null>(null);
  const pendingRef = useRef<PendingConflict | null>(null);

  // Verdwijnt de component terwijl de vraag openstaat, dan telt dat als "niet vervangen".
  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  const ask = useCallback(
    (name: string, file: string) =>
      new Promise<boolean>((resolve) => {
        const entry: PendingConflict = {
          name,
          file,
          resolve: (replace) => {
            pendingRef.current = null;
            setPending(null);
            resolve(replace);
          },
        };
        pendingRef.current = entry;
        setPending(entry);
      }),
    [],
  );

  const upload = useCallback(
    async (
      file: File,
      { name, replace = false }: ScriptUploadOptions = {},
    ): Promise<ScriptUploadOutcome> => {
      const send = async (withReplace: boolean): Promise<ScriptUploadOutcome> => {
        const { data, created } = await mutateAsync({ file, name, replace: withReplace });
        return { status: "ok", script: data, created };
      };
      try {
        return await send(replace);
      } catch (error) {
        if (replace || !isScriptConflict(error))
          return { status: "error", error: error as ApiError };
        const target = problemScriptName(error) ?? scriptTarget(file.name, name).name ?? file.name;
        if (!(await ask(target, file.name))) return { status: "kept", name: target };
        try {
          return await send(true);
        } catch (retryError) {
          return { status: "error", error: retryError as ApiError };
        }
      }
    },
    [ask, mutateAsync],
  );

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      command={`cssthema scripts replace ${shellWord(pending?.file ?? "")}`}
      title={t("import.scriptConflictTitle", { file: `${pending?.name ?? ""}${SCRIPT_SUFFIX}` })}
      confirmLabel={`⟳ ${t("import.scriptReplace")}`}
      cancelLabel={t("import.scriptKeep")}
      onConfirm={() => pending?.resolve(true)}
      onCancel={() => pending?.resolve(false)}
    >
      {pending && (
        <p className="m-0">
          {t("import.scriptConflictText", {
            file: pending.file,
            url: `/${pending.name}${SCRIPT_SUFFIX}`,
            archive: `${SCRIPT_ARCHIVE_DIR}/`,
          })}
        </p>
      )}
    </ConfirmDialog>
  );

  return { upload, dialog };
}
