import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { installStaleChunkReload } from "./app/stale-chunk";
import "./styles/globals.css";

// Oude chunk na een update (404): één keer herladen, daarna toont de route een melding.
installStaleChunkReload();

const container = document.getElementById("root");
if (!container) throw new Error("#root element missing");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
