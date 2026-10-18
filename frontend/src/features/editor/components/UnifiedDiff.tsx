import { cn } from "@/lib/utils";
import { type DiffLineKind, diffLineKind } from "../lib/diff-lines";

const kindClass: Record<DiffLineKind, string> = {
  add: "bg-ok/10 text-ok",
  remove: "bg-err/10 text-err",
  hunk: "text-dim",
  meta: "text-muted",
  context: "text-code",
};

/** Een unified diff (van de server) als codeblok met groene/rode regels. */
export function UnifiedDiff({
  unified,
  label,
  className,
}: {
  unified: string;
  label: string;
  className?: string;
}) {
  const lines = unified.replace(/\n$/, "").split("\n");
  return (
    <pre
      aria-label={label}
      tabIndex={0}
      className={cn(
        "m-0 max-h-[40vh] overflow-auto rounded-lg border border-white/10 bg-black/45 py-2 font-mono text-xs leading-[1.55]",
        "focus-visible:outline-2 focus-visible:outline-white",
        className,
      )}
    >
      {lines.map((line, index) => (
        <span
          key={index}
          className={cn("block px-3 whitespace-pre-wrap", kindClass[diffLineKind(line)])}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}
