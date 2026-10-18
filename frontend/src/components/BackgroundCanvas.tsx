import { useEffect, useRef } from "react";
import { type NetworkMode, ParticleNetwork } from "@/lib/particles";

/** Vaste canvas achter de app met het deeltjesnetwerk; `mode` bepaalt of het beweegt. */
export function BackgroundCanvas({ mode }: { mode: NetworkMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const networkRef = useRef<ParticleNetwork | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const network = new ParticleNetwork(canvas);
    networkRef.current = network;
    return () => {
      network.destroy();
      networkRef.current = null;
    };
  }, []);

  useEffect(() => {
    networkRef.current?.setMode(mode);
  }, [mode]);

  return <canvas id="bg" ref={canvasRef} className="ui-bg-canvas" data-mode={mode} aria-hidden />;
}
