import { toast } from "@/components/ui";
import { copyText } from "@/features/themes/lib/clipboard";
import { t } from "@/lib/i18n";

/** Publieke URL van een script naar het klembord, met een melding (ook als het niet lukt). */
export async function copyScriptUrl(url: string): Promise<boolean> {
  const ok = await copyText(url);
  if (ok) toast.ok(t("import.urlCopied", { url }));
  else toast.err(t("import.copyFailed", { url }));
  return ok;
}
