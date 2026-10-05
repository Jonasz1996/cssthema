import { useCallback, useEffect, useState } from "react";
import { loadBridge, type PreviewBridge } from "./bridge";

export type BridgeState =
  | { status: "loading" }
  | { status: "ready"; bridge: PreviewBridge }
  | { status: "error"; message: string };

/** Laadt `/preview-bridge.js` (één keer per pagina); `retry` probeert opnieuw na een fout. */
export function useBridge(): { state: BridgeState; retry: () => void } {
  const [state, setState] = useState<BridgeState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadBridge().then(
      (bridge) => {
        if (!cancelled) setState({ status: "ready", bridge });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  return { state, retry };
}
