import { Link } from "react-router";
import { t } from "@/lib/i18n";

export function NotFoundPage() {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("notFound.title")}</h1>
      <Link to="/" className="text-accent hover:underline">
        {t("notFound.back")}
      </Link>
    </section>
  );
}
