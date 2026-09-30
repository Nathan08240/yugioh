import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeDeck, createProfile, type Db } from "../src/db.ts";
import { SETS } from "../src/pool.ts";
import { chooseStarter, starterCards } from "../src/starter.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("choix du starter sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let server: Db;

  beforeAll(async () => {
    pg = await startPostgres();
    ({ admin, server } = pg);
  }, 180_000);

  afterAll(() => pg?.stop());

  async function newPlayer(pseudo: string): Promise<string> {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(server, id, pseudo);
    return id;
  }

  it("ajoute les cartes à la collection, crée le deck et le rend actif", async () => {
    const id = await newPlayer("Yugi");
    const codes = starterCards("yugi");

    expect(await chooseStarter(server, id, "yugi")).toBe(true);

    const collection = await admin<{ card_code: number; quantity: number }[]>`
      select card_code, quantity from yugioh.collection where user_id = ${id} order by card_code`;
    expect(collection).toEqual([...codes].sort((a, b) => a - b).map((code) => ({ card_code: code, quantity: 1 })));
    const rarities = await admin<{ rarity: string; copies: number }[]>`
      select rarity, sum(quantity)::int as copies from yugioh.collection_rarities where user_id = ${id} group by rarity order by rarity`;
    const ultra = SETS.find((set) => set.code === "SDY")?.cards.find((card) => card.rarity === "ultra");
    expect(rarities).toEqual([
      { rarity: "common", copies: 47 },
      { rarity: "super", copies: 2 },
      { rarity: "ultra", copies: 1 },
    ]);
    expect(await admin`select rarity from yugioh.collection_rarities where user_id = ${id} and card_code = ${ultra?.code ?? 0}`).toEqual([{ rarity: "ultra" }]);

    const [deck] = await admin<{ name: string; main_deck: number[] }[]>`
      select name, main_deck from yugioh.decks where user_id = ${id}`;
    expect(deck).toEqual({ name: "Starter Yugi", main_deck: codes });

    const [profile] = await admin<{ active_deck_id: number }[]>`select active_deck_id from yugioh.profiles where user_id = ${id}`;
    expect(profile.active_deck_id).not.toBeNull();
  });

  it("lit le main deck et l'extra deck du deck actif, rien sans deck actif", async () => {
    const id = await newPlayer("Tea");
    expect(await activeDeck(server, id)).toBeUndefined();

    await chooseStarter(server, id, "yugi");
    expect(await activeDeck(server, id)).toEqual({ id: expect.any(Number), main: starterCards("yugi"), extra: [] });

    await admin`update yugioh.decks set extra_deck = ${[45231177, 45231177]} where user_id = ${id}`;
    expect((await activeDeck(server, id))?.extra).toEqual([45231177, 45231177]);
  });

  it("refuse un deuxième choix", async () => {
    const id = await newPlayer("Kaiba");
    expect(await chooseStarter(server, id, "kaiba")).toBe(true);
    expect(await chooseStarter(server, id, "yugi")).toBe(false);

    const decks = await admin`select name from yugioh.decks where user_id = ${id}`;
    expect(decks).toEqual([{ name: "Starter Kaiba" }]);
  });

  it("ne consomme qu'une fois un double envoi simultané", async () => {
    const id = await newPlayer("Joey");
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => chooseStarter(server, id, "yugi")));

    expect(results.filter((result) => result.status === "fulfilled" && result.value === true)).toHaveLength(1);
    const decks = await admin`select name from yugioh.decks where user_id = ${id}`;
    expect(decks).toHaveLength(1);
  });
});
