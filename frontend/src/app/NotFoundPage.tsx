import { useLocation } from "react-router";
import { ButtonLink, PageHeader, Terminal } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export function NotFoundPage() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  return (
    <section>
      <PageHeader title={t("common.notFoundTitle")} hint={t("common.notFoundHint")} />
      <Terminal
        className="mb-4"
        lines={[
          { kind: "cmd", text: `$ cssthema open ${pathname}` },
          { kind: "err", text: t("common.notFoundError", { path: pathname }) },
          { kind: "dim", text: "# exit 404" },
        ]}
      />
      <ButtonLink to="/" variant="primary">
        {t("common.notFoundBack")}
      </ButtonLink>
    </section>
  );
}
