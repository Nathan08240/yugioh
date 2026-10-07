import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, sep } from "node:path";

const DIST = join(import.meta.dirname, "..", "..", "client", "dist");
const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".webmanifest", "application/manifest+json"],
]);

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

// The built client (client/dist): its files, else index.html for the client's routes. False when there is no build.
export function serveClient(req: IncomingMessage, res: ServerResponse, dist = DIST): boolean {
  const index = join(dist, "index.html");
  if (req.method !== "GET" || req.url?.startsWith("/api/") || !isFile(index)) return false;
  // URL parsing resolves dot segments, the prefix check keeps any other path inside dist.
  const file = join(dist, new URL(req.url ?? "/", "http://localhost").pathname);
  const asset = file.startsWith(dist + sep) && isFile(file);
  const path = asset ? file : index;
  // Vite hashes the names of assets/ only: index.html, the service worker, the manifest and the other public files are revalidated.
  const cache = asset && path.startsWith(join(dist, "assets") + sep) ? "max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { "content-type": TYPES.get(extname(path)) ?? "application/octet-stream", "cache-control": cache });
  createReadStream(path).pipe(res);
  return true;
}
