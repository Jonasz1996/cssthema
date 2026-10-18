import { Pre } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Eenmalig op de pc (zie `scripts/capture/README.md`). */
const SETUP_COMMANDS = [
  "pip install -U playwright",
  "python -m playwright install chromium",
  "python vastleggen.py login --npm http://IP-VAN-NPM:81",
].join("\n");

const RUN_COMMAND = "python vastleggen.py alles";

/** Hoe je een capture-zip maakt: installeren en inloggen, `alles` draaien, de delen uploaden. */
export function CaptureHelp({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <ol
      data-capture-help=""
      className={cn(
        "m-0 flex max-w-[80ch] list-decimal flex-col gap-2.5 pl-5 text-[12.5px] leading-[1.6] whitespace-normal text-muted",
        className,
      )}
    >
      <li>
        {t("services.helpSetup")}
        <Pre className="mt-1.5">{SETUP_COMMANDS}</Pre>
      </li>
      <li>
        {t("services.helpRun")}
        <Pre className="mt-1.5">{RUN_COMMAND}</Pre>
      </li>
      <li>{t("services.helpUpload")}</li>
    </ol>
  );
}
