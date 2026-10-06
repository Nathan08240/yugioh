// The shared styles first: each screen imports its own stylesheet after them (styles/).
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/cartes.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// After a deploy the chunks of a page left open are gone: a failed load reloads it on the new version.
addEventListener("vite:preloadError", () => location.reload());

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
