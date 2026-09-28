import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";

const RUNTIME_IMPORT = /^import (?!type )[^;]*? from "(\.[^"]+)"/gm;

// Modules reached by runtime imports from `file` that import a Node built-in.
function nodeModules(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = readFileSync(file, "utf8");
  const own = source.includes('from "node:') ? [file] : [];
  const deps = [...source.matchAll(RUNTIME_IMPORT)].map((match) => resolve(dirname(file), match[1]));
  return [...own, ...deps.flatMap((dep) => nodeModules(dep, seen))];
}

// The browser cannot run Node built-ins: a server module the client imports must not reach one (vite only warns).
it("le client n'embarque aucun module Node, même via les modules du serveur qu'il importe", () => {
  const src = import.meta.dirname;
  const roots = readdirSync(src).filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."));
  const seen = new Set<string>();
  expect(roots.flatMap((name) => nodeModules(join(src, name), seen))).toEqual([]);
});
