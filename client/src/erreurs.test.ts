import { beforeEach, expect, it, vi } from "vitest";
import { ERROR_MAX, type ClientMessage } from "../../server/src/protocol.ts";

// The module keeps its queue and the errors already seen: each test starts from a fresh one.
beforeEach(() => vi.resetModules());

async function charger() {
  const erreurs = await import("./erreurs.ts");
  erreurs.contexte.ecran = "profil";
  const sent: ClientMessage[] = [];
  return { ...erreurs, sent, send: (msg: ClientMessage) => sent.push(msg) };
}

it("envoie le type, le message, la pile, la page, la version et le navigateur, coupés à leurs limites", async () => {
  const { signalerErreur, brancher, send, sent } = await charger();
  brancher(send);
  const erreur = new TypeError("x ".repeat(500));
  erreur.stack = "s".repeat(5000);
  signalerErreur("render", erreur, "\ncomposants");
  expect(sent).toHaveLength(1);
  const [msg] = sent;
  if (msg.type !== "client_error") throw new Error("message inattendu");
  expect(msg).toMatchObject({ kind: "render", page: "profil", build: expect.any(String), browser: expect.any(String) });
  expect(msg.message.length).toBe(ERROR_MAX.message);
  expect(msg.message.startsWith("TypeError: x x")).toBe(true);
  expect(msg.stack?.length).toBe(ERROR_MAX.stack);
});

it("garde les premières erreurs jusqu'à la connexion, puis les envoie, sans doublon", async () => {
  const { signalerErreur, brancher, send, sent } = await charger();
  // Built at one place, so that two errors of the same text also share their stack.
  const erreur = (texte: string) => new Error(texte);
  for (let i = 0; i < 8; i++) signalerErreur("error", erreur(`erreur ${i}`));
  signalerErreur("error", erreur("erreur 0"));
  expect(sent).toHaveLength(0);
  brancher(send);
  expect(sent.map((msg) => (msg.type === "client_error" ? msg.message : ""))).toEqual(["Error: erreur 0", "Error: erreur 1", "Error: erreur 2", "Error: erreur 3", "Error: erreur 4"]);
  // The same error again, once sent, is not sent twice in the same page load.
  signalerErreur("error", erreur("erreur 1"));
  expect(sent).toHaveLength(5);
  brancher(undefined);
  signalerErreur("rejection", "refus");
  expect(sent).toHaveLength(5);
  brancher(send);
  expect(sent.at(-1)).toMatchObject({ kind: "rejection", message: "refus" });
});

it("ne lève jamais d'erreur si l'envoi échoue", async () => {
  const { signalerErreur, brancher } = await charger();
  brancher(() => {
    throw new Error("socket fermée");
  });
  expect(() => signalerErreur("error", new Error("x"))).not.toThrow();
});
