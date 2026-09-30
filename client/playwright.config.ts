import { defineConfig } from "@playwright/test";

// Interface tests on the Edge of the machine (no browser download): the real app, a fake game server and login (e2e/harnais.ts).
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  use: { channel: "msedge", baseURL: "http://localhost:5198" },
  webServer: {
    command: "vite --port 5198 --strictPort",
    url: "http://localhost:5198",
    reuseExistingServer: false,
    // Over client/.env: the login never reaches the real Supabase.
    env: { VITE_SUPABASE_URL: "http://supabase.localhost:5199", VITE_SUPABASE_ANON_KEY: "e2e" },
  },
});
