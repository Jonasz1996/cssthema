import { Tag } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { statusHintKey, statusLabelKey, statusTone } from "../lib/services";

/**
 * Status van een snapshot uit `vastleggen.py` als pil: `ok` groen, `http-5xx`/`fout` rood,
 * een andere HTTP-fout oranje, een loginscherm grijs. De uitleg staat in de tooltip.
 */
export function SnapshotStatus({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  const label = statusLabelKey(status);
  const hint = statusHintKey(status);
  const tone = statusTone(status);
  return (
    <Tag tone={tone} data-status={status ?? ""} data-tone={tone} title={hint ? t(hint) : undefined}>
      {label ? t(label) : status}
    </Tag>
  );
}
