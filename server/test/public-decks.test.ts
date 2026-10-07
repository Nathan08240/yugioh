import { describe, expect, it, vi } from "vitest";
import { DESCRIPTION_MAX, type ClientMessage } from "../src/protocol.ts";
import { cleanCode, freeName, missingCards, ownedPart, publication, publicDeckReply, type PublicDeckMessage } from "../src/public-decks.ts";
import { parse } from "../src/wire.ts";
import { noPublicDecks } from "./fakes.ts";

describe("messages de decks partagés", () => {
  const accepted: ClientMessage[] = [
    { type: "deck_share", id: 3 },
    { type: "deck_publish", id: 3, name: "Mon deck", description: "" },
    { type: "deck_view", code: "ABCD2345" },
    { type: "deck_copy", code: "abcd2345" },
    { type: "deck_unpublish", code: "ABCD2345" },
    { type: "public_decks" },
    { type: "public_decks", sort: "recent", goat: false, card: 46986414 },
  ];
  const refused = [
    { type: "deck_share" },
    { type: "deck_share", id: "3" },
    { type: "deck_publish", id: 3, name: "x" },
    { type: "deck_publish", id: 3, name: 1, description: "" },
    { type: "deck_view", code: 12 },
    { type: "public_decks", sort: "oldest" },
    { type: "public_decks", goat: "oui" },
    { type: "public_decks", card: 2 ** 40 },
    { type: "public_decks", card: "46986414" },
  ];

  it("accepte les messages bien formés et refuse les autres", () => {
    for (const msg of accepted) expect(parse(JSON.stringify(msg)), JSON.stringify(msg)).toEqual(msg);
    for (const msg of refused) expect(parse(JSON.stringify(msg)), JSON.stringify(msg)).toBeUndefined();
  });
});

describe("nom et description d'un deck publié", () => {
  it("enlève les caractères de contrôle et les espaces autour, sans toucher au HTML qui reste du texte", () => {
    expect(publication("  Mon deck\u0000 ", "ligne 1\nligne 2 <b>gras</b>")).toEqual({ name: "Mon deck", description: "ligne 1 ligne 2 <b>gras</b>" });
  });

  it("refuse un nom vide ou trop long et une description trop longue", () => {
    expect(publication("   ", "")).toEqual({ error: "le nom du deck doit faire 1 à 40 caractères" });
    expect(publication("x".repeat(41), "")).toEqual({ error: "le nom du deck doit faire 1 à 40 caractères" });
    expect(publication("x".repeat(40), "y".repeat(DESCRIPTION_MAX))).toEqual({ name: "x".repeat(40), description: "y".repeat(DESCRIPTION_MAX) });
    expect(publication("x", "y".repeat(DESCRIPTION_MAX + 1))).toEqual({ error: `la description fait ${DESCRIPTION_MAX} caractères au plus` });
  });
});

describe("copie d'un deck partagé", () => {
  it("ne garde que les cartes possédées, le main deck puis l'extra, et compte les manquantes", () => {
    const owned = new Map([
      [1, 2],
      [2, 3],
      [9, 1],
    ]);
    const part = ownedPart({ main: [1, 1, 1, 2, 3], extra: [9, 9] }, owned);
    expect(part.main).toEqual([1, 1, 2]);
    expect(part.extra).toEqual([9]);
    expect(part.missing).toEqual([
      [1, 1],
      [3, 1],
      [9, 1],
    ]);
    expect(missingCards([1, 1, 2], owned)).toEqual([]);
  });

  it("donne un nom libre en ajoutant un numéro sans dépasser la longueur du nom", () => {
    expect(freeName("Goat", new Set())).toBe("Goat");
    expect(freeName("Goat", new Set(["Goat"]))).toBe("Goat (2)");
    expect(freeName("Goat", new Set(["Goat", "Goat (2)"]))).toBe("Goat (3)");
    const long = "x".repeat(40);
    expect(freeName(long, new Set([long]))).toBe(`${"x".repeat(36)} (2)`);
  });

  it("lit un code sans tenir compte de la casse ni des espaces", () => {
    expect(cleanCode(" abcd2345 ")).toBe("ABCD2345");
  });
});

describe("réponses du serveur", () => {
  const removePublicDeck = vi.fn(async (_code: string, owner?: string) => owner === undefined || owner === "auteur");
  const store = { ...noPublicDecks, removePublicDeck };
  const retirer: PublicDeckMessage = { type: "deck_unpublish", code: "abcd2345" };

  it("retire un deck public pour son auteur ou pour un admin, pas pour un autre joueur", async () => {
    removePublicDeck.mockClear();
    expect(await publicDeckReply(store, "auteur", retirer, false)).toEqual({ type: "public_deck_removed", code: "ABCD2345" });
    expect(await publicDeckReply(store, "admin", retirer, true)).toEqual({ type: "public_deck_removed", code: "ABCD2345" });
    expect(await publicDeckReply(store, "intrus", retirer, false)).toBe("deck public introuvable ou qui n'est pas le vôtre");
    expect(removePublicDeck.mock.calls).toEqual([
      ["ABCD2345", "auteur"],
      ["ABCD2345", undefined],
      ["ABCD2345", "intrus"],
    ]);
  });

  it("ne publie pas un deck au nom invalide, sans toucher au stockage", async () => {
    const publishDeck = vi.fn(noPublicDecks.publishDeck);
    expect(await publicDeckReply({ ...noPublicDecks, publishDeck }, "joueur", { type: "deck_publish", id: 1, name: " ", description: "" }, false)).toBe("le nom du deck doit faire 1 à 40 caractères");
    expect(publishDeck).not.toHaveBeenCalled();
  });

  it("publie sous le nom nettoyé", async () => {
    const publishDeck = vi.fn(async () => ({ code: "ABCD2345" }));
    const reply = await publicDeckReply({ ...noPublicDecks, publishDeck }, "joueur", { type: "deck_publish", id: 1, name: " Goat ", description: "Rapide\n" }, false);
    expect(reply).toEqual({ type: "deck_shared", code: "ABCD2345", published: true });
    expect(publishDeck).toHaveBeenCalledWith("joueur", 1, "Goat", "Rapide");
  });

  it("dit qu'un code inconnu ne mène à aucun deck", async () => {
    expect(await publicDeckReply(noPublicDecks, "joueur", { type: "deck_view", code: "ZZZZZZZZ" }, false)).toBe("deck introuvable : code invalide ou deck retiré");
  });

  it("liste par défaut les plus copiés d'abord", async () => {
    const publicDecks = vi.fn(async () => []);
    await publicDeckReply({ ...noPublicDecks, publicDecks }, "joueur", { type: "public_decks", goat: true }, false);
    expect(publicDecks).toHaveBeenCalledWith("joueur", { sort: "copies", goat: true, card: undefined });
  });
});
