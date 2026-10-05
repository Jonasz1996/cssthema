import { useEffect } from "react";

export const APP_TITLE = "cssthema";

/** Zet de venstertitel op `<titel> · cssthema` zolang de component gemount is. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${APP_TITLE}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
