import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCards, poolCard } from "../src/collection.ts";
import { createProfile, type Db } from "../src/db.ts";
import { isExtraDeck, sameCard } from "../src/deckcheck.ts";
import { GOAT } from "../src/limits.ts";
import { POOL } from "../src/pool.ts";
import { PUBLIC_DECKS_MAX, SHARES_MAX } from "../src/protocol.ts";
import { dbAccounts, type Accounts } from "../src/server.ts";
import { publicDeckReply } from "../src/public-decks.ts";
import { type Pg, startPostgres } from "./pg.ts";

// 14 different cards the Goat list does not limit (3 copies each: a 42-card deck that follows it), and one it forbids.
const keys = new Set<number>();
const FILLERS = [...POOL]
  .filter((code) => {
    const card = poolCard(code);
    if (!card || isExtraDeck(card) || GOAT.has(sameCard(code, card)) || keys.has(sameCard(code, card))) return false;
    keys.add(sameCard(code, card));
    return true;
  })
  .slice(0, 14);
const FORBIDDEN = [...POOL].find((code) => GOAT.get(code) === 0 && poolCard(code) && !isExtraDeck(poolCard(code)!)) as number;
const GOAT_DECK = FILLERS.flatMap((code) => [code, code, code]);
const OUTSIDE_GOAT = [...FILLERS.slice(0, 13).flatMap((code) => [code, code, code]), FORBIDDEN];
const copiesOf = (codes: number[]) => codes.map((code) => ({ code, rarity: "common" }));

describe("decks publics et partagés sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let accounts: Accounts;

  beforeAll(async () => {
    pg = await startPostgres();
    admin = pg.admin;
    accounts = dbAccounts(pg.server);
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  // A player owning `cards` (one entry per copy), without any deck.
  async function player(pseudo: string, cards: number[]) {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(pg.server, id, pseudo);
    await pg.server.begin((sql) => addCards(sql, id, copiesOf(cards)));
    return id;
  }

  async function deck(userId: string, name: string, main: number[]) {
    const saved = await accounts.saveDeck(userId, { name, main, extra: [] });
    if ("error" in saved) throw new Error(saved.error);
    return saved.id;
  }

  it("publie un deck et le liste avec son auteur, son format Goat, ses copies, filtré et trié", async () => {
    const alice = await player("Alice", [...GOAT_DECK, ...OUTSIDE_GOAT]);
    const bob = await player("Bob", []);
    const conforme = await deck(alice, "Conforme", GOAT_DECK);
    const hors = await deck(alice, "Hors liste", OUTSIDE_GOAT);
    const first = await accounts.publishDeck(alice, conforme, "Goat sage", "Un deck sans carte interdite");
    expect(first).toEqual({ code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{8}$/) });
    const second = await accounts.publishDeck(alice, hors, "Avec interdite", "");
    const [{ code: conformeCode }, { code: horsCode }] = [first, second] as { code: string }[];

    const all = await accounts.publicDecks(bob, { sort: "recent" });
    expect(all.map((entry) => entry.name)).toEqual(["Avec interdite", "Goat sage"]);
    expect(all[1]).toEqual({ code: conformeCode, name: "Goat sage", description: "Un deck sans carte interdite", author: "Alice", date: expect.any(String), copies: 0, goat: true, mine: false, main: 42, extra: 0 });
    expect(all[0]).toMatchObject({ code: horsCode, goat: false, mine: false, main: 40 });
    expect((await accounts.publicDecks(alice, { sort: "copies" })).every((entry) => entry.mine)).toBe(true);
    expect((await accounts.publicDecks(bob, { sort: "recent", goat: true })).map((entry) => entry.code)).toEqual([conformeCode]);
    expect((await accounts.publicDecks(bob, { sort: "recent", goat: false })).map((entry) => entry.code)).toEqual([horsCode]);
    expect((await accounts.publicDecks(bob, { sort: "recent", card: FORBIDDEN })).map((entry) => entry.code)).toEqual([horsCode]);
    expect(await accounts.publicDecks(bob, { sort: "recent", card: 1 })).toEqual([]);
  });

  it("refuse la publication d'un deck absent ou d'un autre joueur, et au-delà de 10 decks publics même en parallèle", async () => {
    const carol = await player("Carol", GOAT_DECK);
    const dave = await player("Dave", GOAT_DECK);
    const id = await deck(carol, "Deck de Carol", GOAT_DECK);
    expect(await accounts.publishDeck(dave, id, "Volé", "")).toEqual({ error: "deck introuvable" });
    expect(await accounts.publishDeck(carol, id + 1000, "Absent", "")).toEqual({ error: "deck introuvable" });
    const results = await Promise.all(Array.from({ length: PUBLIC_DECKS_MAX + 2 }, (_, n) => accounts.publishDeck(carol, id, `Publié ${n}`, "")));
    expect(results.filter((result) => "code" in result)).toHaveLength(PUBLIC_DECKS_MAX);
    expect(results.filter((result) => "error" in result).map((result) => (result as { error: string }).error)).toEqual(Array(2).fill(`${PUBLIC_DECKS_MAX} decks publics au plus : retirez-en un avant d'en publier un autre`));
    // Another player is not held back by it.
    expect(await accounts.publishDeck(dave, await deck(dave, "Deck de Dave", GOAT_DECK), "Autre", "")).toHaveProperty("code");
  });

  it("partage un deck par code sans doublon, garde les derniers codes, et fait voir ce qui manque", async () => {
    const erin = await player("Erin", GOAT_DECK);
    const frank = await player("Frank", FILLERS.slice(0, 5).flatMap((code) => [code, code]));
    const id = await deck(erin, "À partager", GOAT_DECK);
    const shared = await accounts.shareDeck(erin, id);
    expect(shared).toEqual({ code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{8}$/) });
    expect(await accounts.shareDeck(erin, id)).toEqual(shared);
    expect(await accounts.shareDeck(erin, id + 1000)).toEqual({ error: "deck introuvable" });

    const code = (shared as { code: string }).code;
    const seen = await accounts.sharedDeck(frank, code);
    expect(seen).toMatchObject({ code, name: "À partager", author: "Erin", description: "", public: false, mine: false, main: GOAT_DECK, extra: [], copies: 0 });
    // Frank owns 2 copies of 5 cards: he lacks 1 of each, and the 9 others entirely.
    expect(seen?.missing).toEqual(FILLERS.map((filler, index): [number, number] => [filler, index < 5 ? 1 : 3]));
    expect((await accounts.sharedDeck(erin, code))?.mine).toBe(true);
    expect(await accounts.sharedDeck(frank, "ZZZZZZZZ")).toBeUndefined();
    // A private code does not show in the public list.
    expect((await accounts.publicDecks(frank, { sort: "recent" })).some((entry) => entry.code === code)).toBe(false);

    // A new version of the deck gets a new code, and only the last SHARES_MAX are kept.
    for (let n = 0; n < SHARES_MAX + 2; n++) {
      await accounts.shareDeck(erin, await deck(erin, `Version ${n}`, GOAT_DECK));
    }
    const [{ count }] = await admin<{ count: number }[]>`select count(*)::int as count from yugioh.shared_decks where user_id = ${erin}`;
    expect(count).toBe(SHARES_MAX);
    expect(await accounts.sharedDeck(frank, code)).toBeUndefined();
  });

  it("copie un deck public sans les cartes manquantes, compte une copie par joueur et jamais celle de l'auteur", async () => {
    const gina = await player("Gina", GOAT_DECK);
    // Hank lacks one copy of one card: 41 cards remain. Ivy lacks 3 cards in 42: refused.
    const hank = await player("Hank", GOAT_DECK.slice(1));
    const ivy = await player("Ivy", GOAT_DECK.slice(3).filter((_, index) => index > 0));
    const id = await deck(gina, "Modèle", GOAT_DECK);
    const { code } = (await accounts.publishDeck(gina, id, "Modèle public", "À copier")) as { code: string };

    const copied = await accounts.copySharedDeck(hank, code);
    expect(copied).toEqual({ id: expect.any(Number), name: "Modèle public", missing: [[GOAT_DECK[0], 1]] });
    const { decks } = await accounts.decks(hank);
    expect(decks).toEqual([{ id: (copied as { id: number }).id, name: "Modèle public", main: GOAT_DECK.slice(1), extra: [] }]);
    // A second copy gets another name and does not count again.
    expect(await accounts.copySharedDeck(hank, code)).toMatchObject({ name: "Modèle public (2)" });
    expect(await accounts.copySharedDeck(gina, code)).toMatchObject({ name: "Modèle public", missing: [] });
    expect((await accounts.publicDecks(ivy, { sort: "copies" })).find((entry) => entry.code === code)?.copies).toBe(1);

    const refused = await accounts.copySharedDeck(ivy, code);
    expect(refused).toEqual({ error: expect.stringContaining("copie impossible") });
    expect((await accounts.decks(ivy)).decks).toEqual([]);
    expect(await accounts.copySharedDeck(ivy, "ZZZZZZZZ")).toEqual({ error: "deck introuvable : code invalide ou deck retiré" });

    // The most copied come first.
    const other = await accounts.publishDeck(gina, id, "Moins copié", "");
    expect((await accounts.publicDecks(ivy, { sort: "copies" })).slice(0, 2).map((entry) => entry.code)).toEqual([code, (other as { code: string }).code]);
  });

  it("laisse l'auteur ou un admin retirer un deck public, jamais un autre joueur, ni un simple code de partage", async () => {
    const jack = await player("Jack", GOAT_DECK);
    const kim = await player("Kim", GOAT_DECK);
    const id = await deck(jack, "À retirer", GOAT_DECK);
    const { code } = (await accounts.publishDeck(jack, id, "Public", "")) as { code: string };
    const { code: privateCode } = (await accounts.shareDeck(jack, id)) as { code: string };
    const retirer = { type: "deck_unpublish", code } as const;

    expect(await publicDeckReply(accounts, kim, retirer, false)).toBe("deck public introuvable ou qui n'est pas le vôtre");
    expect(await accounts.sharedDeck(kim, code)).toBeDefined();
    expect(await publicDeckReply(accounts, jack, { type: "deck_unpublish", code: privateCode }, false)).toBe("deck public introuvable ou qui n'est pas le vôtre");
    expect(await publicDeckReply(accounts, kim, { type: "deck_unpublish", code }, true)).toEqual({ type: "public_deck_removed", code });
    expect(await accounts.sharedDeck(kim, code)).toBeUndefined();
    expect(await accounts.sharedDeck(kim, privateCode)).toBeDefined();

    const again = (await accounts.publishDeck(jack, id, "Public", "")) as { code: string };
    expect(await publicDeckReply(accounts, jack, { type: "deck_unpublish", code: again.code }, false)).toEqual({ type: "public_deck_removed", code: again.code });
  });

  it("supprime les decks partagés avec le profil, et le serveur ne peut pas réécrire un deck partagé", async () => {
    const lea = await player("Lea", GOAT_DECK);
    const id = await deck(lea, "Éphémère", GOAT_DECK);
    const { code } = (await accounts.publishDeck(lea, id, "Éphémère", "")) as { code: string };
    await expect(pg.server`update yugioh.shared_decks set name = 'Pirate' where code = ${code}`).rejects.toThrow();
    await accounts.copySharedDeck(await player("Max", GOAT_DECK), code);
    await admin`delete from yugioh.profiles where user_id = ${lea}`;
    expect(await admin`select 1 from yugioh.shared_decks where code = ${code}`).toHaveLength(0);
    expect(await admin`select 1 from yugioh.shared_deck_copies where code = ${code}`).toHaveLength(0);
  });
});
