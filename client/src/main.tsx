// The shared styles first: each screen imports its own stylesheet after them (styles/).
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/cartes.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { installerCapteur, signalerErreur } from "./erreurs.ts";
import { enregistrer } from "./pwa.ts";

// After a deploy the chunks of a page left open are gone: a failed load reloads it on the new version.
addEventListener("vite:preloadError", () => location.reload());
installerCapteur();
enregistrer();

// An error of rendering unmounts the app: React reports it here instead of on the window (React 19), so the console still gets it.
const options = {
  onUncaughtError: (error: unknown, info: { componentStack?: string }) => {
    console.error(error);
    signalerErreur("render", error, `\n${info.componentStack ?? ""}`);
  },
};

createRoot(document.getElementById("root") as HTMLElement, options).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
