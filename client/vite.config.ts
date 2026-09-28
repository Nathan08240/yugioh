import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The game server listens on 3001 in dev (server/.env PORT); /ws is proxied so the client needs no server URL.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/ws": { target: "ws://localhost:3001", ws: true } } },
});
