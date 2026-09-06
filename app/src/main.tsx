import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import "./appearance.css";
import App from "./App.tsx";
import { initializeAppearance } from "./lib/appearance";

// Runs synchronously before the first React paint; no Standard-size flash.
initializeAppearance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
