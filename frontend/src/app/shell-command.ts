import { useEffect } from "react";
import { useUiStore } from "./ui-store";

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Commando in de terminalbalk voor een route: `/` → `cssthema dashboard`, `/themes` →
 * `cssthema themes`, `/editor/<id>` → `cssthema edit <id>`, `/editor/<id>/versions` →
 * `cssthema versions <id>`, anders `cssthema <segmenten…>`.
 */
export function routeCommand(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean).map(decode);
  const [first, second, third] = segments;
  if (!first) return "cssthema dashboard";
  if (first === "editor" && second) {
    return third === "versions" ? `cssthema versions ${second}` : `cssthema edit ${second}`;
  }
  return `cssthema ${segments.join(" ")}`;
}

/**
 * Laat een pagina het commando in de terminalbalk overschrijven zolang ze gemount is,
 * bv. `useShellCommand(theme && \`cssthema edit ${theme.slug}\`)` zodra de slug bekend is.
 */
export function useShellCommand(command: string | null | undefined | false): void {
  const setCommandOverride = useUiStore((state) => state.setCommandOverride);
  useEffect(() => {
    if (!command) return;
    setCommandOverride(command);
    return () => setCommandOverride(null);
  }, [command, setCommandOverride]);
}
