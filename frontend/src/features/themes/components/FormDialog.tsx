import type { ReactNode, RefObject } from "react";
import { Button, Dialog, type DialogProps } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export interface FormDialogProps {
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Id van het `<form>` in `children`; de verstuurknop in de voet hoort erbij (`form=`). */
  formId: string;
  submitLabel: ReactNode;
  /** Bezig: knoppen uit en niet sluitbaar (Esc/overlay/✕). */
  busy?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  command?: string;
  size?: DialogProps["size"];
  children: ReactNode;
}

/** Dialoog met een formulier: verstuurknop (primair) en annuleren in de voet. */
export function FormDialog({
  onClose,
  title,
  description,
  formId,
  submitLabel,
  busy = false,
  initialFocus,
  command,
  size = "md",
  children,
}: FormDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      command={command}
      size={size}
      dismissible={!busy}
      initialFocus={initialFocus}
      footer={
        <>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy || undefined}>
            {submitLabel}
          </Button>
          <Button variant="alt" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
