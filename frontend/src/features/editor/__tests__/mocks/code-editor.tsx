import { useEffect } from "react";
import { useSessionValue } from "../../autosave/sessions";
import type { CodeEditorProps } from "../../components/CodeEditor";
import { revealCalls } from "./reveal-calls";

/**
 * Vervangt Monaco in component-tests (`vi.mock("../components/CodeEditor", …)`): een textarea
 * die net als de echte editor `session.edit()` aanroept, plus de lint-markers en de classes van
 * de snapshot (autocomplete) als tekst.
 */
export function CodeEditor({
  session,
  ariaLabel,
  lint,
  readOnly,
  onReady,
  snapshot,
}: CodeEditorProps) {
  const css = useSessionValue(session, (snapshot) => snapshot.css, "");
  useEffect(() => {
    onReady?.({
      reveal: () => {},
      revealCodePoint: (line, column) => revealCalls.push([line, column]),
      insert: (text) => session.edit(session.getSnapshot().css + text),
      focus: () => {},
    });
    return () => onReady?.(null);
  }, [onReady, session]);
  return (
    <div>
      <textarea
        aria-label={ariaLabel}
        value={css}
        readOnly={readOnly}
        onChange={(event) => session.edit(event.target.value)}
      />
      <output data-testid="markers">
        {lint ? `${lint.errors.length} errors, ${lint.warnings.length} warnings` : "no lint"}
      </output>
      <output data-testid="snapshot-completions">
        {snapshot
          ? `${snapshot.hostname} ${snapshot.page}: ${snapshot.symbols.classes.map((item) => item.name).join(" ")}`
          : "no snapshot"}
      </output>
    </div>
  );
}
