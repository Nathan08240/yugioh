import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Stamps public/sw.js with a hash of the build: each deploy changes the file, so browsers see an update (pwa.ts offers it to the player).
function versionSw(): Plugin {
  const hash = createHash("sha1");
  return {
    name: "version-sw",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) hash.update(item.type === "chunk" ? item.code : item.source);
    },
    writeBundle({ dir = "dist" }) {
      const file = join(dir, "sw.js");
      writeFileSync(file, readFileSync(file, "utf8").replaceAll("__BUILD__", hash.digest("hex").slice(0, 12)));
    },
  };
}

// The game server listens on 3001 in dev (server/.env PORT); /ws and /api are proxied so the client needs no server URL.
export default defineConfig({
  plugins: [react(), versionSw()],
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")) },
  server: { proxy: { "/ws": { target: "ws://localhost:3001", ws: true }, "/api": "http://localhost:3001" } },
});
