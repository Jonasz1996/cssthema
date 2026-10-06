export type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

/** Soort van een regel uit een unified diff. */
export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}
