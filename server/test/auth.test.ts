import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifySession } from "../src/auth.ts";

// Faux GoTrue : GET /auth/v1/user renvoie l'utilisateur du jeton "bon".
const gotrue = createServer((request, response) => {
  const authorized = request.headers.apikey === "anon" && request.url === "/auth/v1/user";
  if (request.headers.authorization === "Bearer panne") {
    response.writeHead(503).end();
  } else if (authorized && request.headers.authorization === "Bearer bon") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "user-1" }));
  } else {
    response.writeHead(403).end();
  }
});
let url = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => gotrue.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(gotrue.address() as AddressInfo).port}`;
});
afterAll(() => {
  gotrue.close();
});

describe("vérification de session Supabase", () => {
  it("renvoie l'id du joueur pour un jeton valide", async () => {
    expect(await verifySession("bon", url, "anon")).toBe("user-1");
  });

  it("refuse un jeton invalide ou une clé anon fausse", async () => {
    expect(await verifySession("faux", url, "anon")).toBeNull();
    expect(await verifySession("bon", url, "autre")).toBeNull();
  });

  it("échoue si Supabase Auth est en panne", async () => {
    await expect(verifySession("panne", url, "anon")).rejects.toThrow("indisponible");
  });
});
