import { useRef, useState } from "react";
import { useUploadPage } from "@/api/queries/services";
import type { PageUploadResult } from "@/api/types";
import { Button, Code, Field, Input, toast } from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { formatBytes } from "@/features/themes/lib/format";
import { useI18n } from "@/lib/i18n";
import { CAPTURE_MAX_BYTES, PAGE_ACCEPT, SERVICE_ERROR_KEYS } from "../lib/services";

export interface PageUploadProps {
  /** Na een geslaagde upload (bv. de editor kiest dan die snapshot als preview). */
  onUploaded?: (result: PageUploadResult) => void;
}

/**
 * Een opgeslagen webpagina uploaden: een `.html` (bv. SingleFile) of een `.zip` met de pagina
 * en zijn map `<naam>_files` ("Webpagina, volledig" in de browser). Die wordt een snapshot van
 * de host, zodat de preview het thema op precies die pagina toont, met haar eigen CSS en
 * afbeeldingen. Host en paginanaam zijn optioneel: de server haalt ze uit de pagina en de
 * bestandsnaam.
 */
export function PageUpload({ onUploaded }: PageUploadProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [hostname, setHostname] = useState("");
  const [page, setPage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PageUploadResult | null>(null);
  const upload = useUploadPage();

  const tooLarge = file !== null && file.size > CAPTURE_MAX_BYTES;

  const submit = () => {
    if (!file || tooLarge || upload.isPending) return;
    setError(null);
    setResult(null);
    upload.mutate(
      { file, hostname, page },
      {
        onSuccess: (done) => {
          setResult(done);
          toast.ok(t("services.pageDone", { host: done.hostname, page: done.page }));
          onUploaded?.(done);
        },
        onError: (failure) => setError(errorText(failure, i18n, SERVICE_ERROR_KEYS)),
      },
    );
  };

  return (
    <div data-page-upload="" className="flex flex-col gap-2.5">
      <p className="m-0 max-w-[80ch] text-[12.5px] leading-[1.6] text-muted">
        {t("services.pageIntro")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="alt"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
        >
          📄 {t("services.pageChoose")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={PAGE_ACCEPT}
          hidden
          data-testid="page-input"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
            event.target.value = "";
          }}
        />
        <span className="text-[12px] break-all text-fg">
          {file ? `${file.name} · ${formatBytes(file.size, locale)}` : t("services.pageNone")}
        </span>
      </div>
      {tooLarge && <p className="m-0 text-[12px] text-err">{t("services.pageTooLarge")}</p>}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label={t("services.pageHost")} hint={t("services.pageHostHint")}>
          <Input
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="portainer.jbogaert.be"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label={t("services.pageName")} hint={t("services.pageNameHint")}>
          <Input
            value={page}
            onChange={(event) => setPage(event.target.value)}
            placeholder="dashboard"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </div>
      <div>
        <Button
          onClick={submit}
          disabled={!file || tooLarge || upload.isPending}
          aria-busy={upload.isPending || undefined}
        >
          <span aria-hidden>⬆️</span>
          {upload.isPending ? t("services.uploading") : t("services.pageUpload")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[12.5px] text-err">
          {error}
        </p>
      )}
      {result && (
        <div data-page-result="" className="text-[12.5px] leading-[1.6] text-fg">
          <p className="m-0">
            {t("services.pageResult", {
              host: result.hostname,
              page: result.page,
              sheets: result.stylesheets,
              files: result.inlined_files,
            })}
          </p>
          {result.missing_stylesheets.length > 0 && (
            <p className="m-0 mt-1 text-mid">
              {t("services.pageMissing")}{" "}
              {result.missing_stylesheets.slice(0, 5).map((href, index) => (
                <span key={href} className="[overflow-wrap:anywhere]">
                  {index > 0 && ", "}
                  <Code>{href}</Code>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
