import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The game server listens on 3001 in dev (server/.env PORT); /ws and /api are proxied so the client needs no server URL.
export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")) },
  server: { proxy: { "/ws": { target: "ws://localhost:3001", ws: true }, "/api": "http://localhost:3001" } },
});
