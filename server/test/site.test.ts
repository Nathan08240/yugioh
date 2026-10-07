import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveClient } from "../src/site.ts";

// Faux build du client, à côté d'un fichier qu'il ne faut jamais servir.
const root = mkdtempSync(join(tmpdir(), "site-"));
const dist = join(root, "dist");
mkdirSync(join(dist, "assets"), { recursive: true });
writeFileSync(join(dist, "index.html"), "<html>index</html>");
writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
writeFileSync(join(dist, "sw.js"), "self");
writeFileSync(join(dist, "manifest.webmanifest"), "{}");
writeFileSync(join(root, "secret.txt"), "secret");

const server = createServer((req, res) => {
  if (!serveClient(req, res, dist)) res.writeHead(404).end();
});
let base = "";
beforeAll(() => new Promise<void>((resolve) => server.listen(0, resolve)));
beforeAll(() => {
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("serveClient", () => {
  it("sert les fichiers du build avec leur type", async () => {
    const res = await fetch(`${base}/assets/app.js`);
    expect(res.headers.get("content-type")).toBe("text/javascript");
    expect(await res.text()).toBe("console.log(1)");
  });

  it("ne garde en cache longtemps que les fichiers hachés : le service worker et le manifeste sont revalidés", async () => {
    expect((await fetch(`${base}/assets/app.js`)).headers.get("cache-control")).toBe("max-age=31536000, immutable");
    for (const path of ["/sw.js", "/manifest.webmanifest", "/"]) expect((await fetch(`${base}${path}`)).headers.get("cache-control")).toBe("no-cache");
    expect((await fetch(`${base}/manifest.webmanifest`)).headers.get("content-type")).toBe("application/manifest+json");
  });

  it("renvoie index.html pour les routes du client", async () => {
    const res = await fetch(`${base}/histoire`);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("<html>index</html>");
  });

  // Chemin envoyé tel quel : fetch résoudrait lui-même les "..".
  const raw = (path: string) =>
    new Promise<string>((resolve, reject) => {
      get(`${base}/`, { path }, (res) => res.setEncoding("utf-8").on("data", resolve)).on("error", reject);
    });

  it("ne sort jamais du build", async () => {
    expect(await raw("/../secret.txt")).toBe("<html>index</html>");
    expect(await raw("/%2E%2E/secret.txt")).toBe("<html>index</html>");
    expect(await raw("/assets/..%5C..%5Csecret.txt")).toBe("<html>index</html>");
  });

  it("laisse /api au serveur de jeu", async () => {
    expect((await fetch(`${base}/api/inconnue`)).status).toBe(404);
  });

  it("ne sert rien sans build", async () => {
    const empty = createServer((req, res) => {
      if (!serveClient(req, res, join(root, "absent"))) res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => empty.listen(0, resolve));
    const status = (await fetch(`http://localhost:${(empty.address() as AddressInfo).port}/`)).status;
    empty.close();
    expect(status).toBe(404);
  });
});
