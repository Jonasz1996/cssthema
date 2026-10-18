import type { DiffViewProps } from "../../components/DiffView";

/** Vervangt de Monaco-diff in component-tests. */
export function DiffView({ original, modified, ariaLabel, sideBySide = true }: DiffViewProps) {
  return (
    <pre aria-label={ariaLabel} data-side-by-side={sideBySide}>
      {`--- ${original}\n+++ ${modified}`}
    </pre>
  );
}
