import { Construction } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/lib/i18n";

export function PlaceholderPage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Card>
        <CardContent className="flex items-center gap-3 pt-4 text-muted-foreground">
          <Construction className="size-5 text-accent" aria-hidden />
          <p>{t("app.comingLater")}</p>
        </CardContent>
      </Card>
      {children}
    </section>
  );
}
