import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { TRADES_PER_DAY } from "../src/protocol.ts";
import { dbTradeStore, TRADE_PENDING_MAX, type TradeStore } from "../src/trade.ts";
import { type Pg, startPostgres } from "./pg.ts";

const X = 46986414;
const Y = 89631139;
const GONE = "offre expirée ou déjà traitée";

describe("échanges de cartes sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let store: TradeStore;
  let n = 0;

  beforeAll(async () => {
    pg = await startPostgres();
    admin = pg.admin;
    store = dbTradeStore(pg.server);
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  async function player() {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const pseudo = `Joueur${++n}`;
    await createProfile(pg.server, id, pseudo);
    return { id, pseudo };
  }
  async function friends(a: string, b: string) {
    await admin`insert into yugioh.friendships (user_id, friend_id, status) values (${a}, ${b}, 'accepted')`;
  }
  // `rarities`: copies of known rarity; the rest of `quantity` has an unknown rarity.
  async function own(userId: string, code: number, quantity: number, rarities: Record<string, number> = {}) {
    await admin`insert into yugioh.collection (user_id, card_code, quantity) values (${userId}, ${code}, ${quantity})`;
    for (const [rarity, count] of Object.entries(rarities)) {
      await admin`insert into yugioh.collection_rarities (user_id, card_code, rarity, quantity) values (${userId}, ${code}, ${rarity}, ${count})`;
    }
  }
  const copies = async (userId: string) => {
    const cards = await admin<{ code: number; quantity: number }[]>`
      select card_code as code, quantity from yugioh.collection where user_id = ${userId} order by card_code`;
    const rarities = await admin<{ code: number; rarity: string; quantity: number }[]>`
      select card_code as code, rarity, quantity from yugioh.collection_rarities where user_id = ${userId} order by card_code, rarity`;
    return { cards: cards.map((row) => [row.code, row.quantity]), rarities: rarities.map((row) => [row.code, row.rarity, row.quantity]) };
  };
  // Two friends: `a` holds 2 X, `b` holds 2 Y, and `a` offered X for Y.
  async function offered() {
    const a = await player();
    const b = await player();
    await friends(a.id, b.id);
    await own(a.id, X, 2);
    await own(b.id, Y, 2);
    expect(await store.offerTrade(a.id, b.pseudo, X, Y)).toEqual({ to: b.id });
    const [offer] = (await store.trades(b.id)).received;
    return { a, b, id: offer.id };
  }

  it("échange un exemplaire contre un autre, la rareté la plus basse (inconnue d'abord) suivant la carte", async () => {
    const a = await player();
    const b = await player();
    await friends(b.id, a.id);
    await own(a.id, X, 3, { common: 1, super: 2 });
    await own(b.id, Y, 2, { rare: 1 });
    expect(await store.tradeCards(a.id, b.pseudo.toLowerCase())).toEqual({ mine: [[X, 2]], theirs: [[Y, 1]] });
    expect(await store.offerTrade(a.id, b.pseudo, X, Y)).toEqual({ to: b.id });
    const sent = await store.trades(a.id);
    expect(sent).toMatchObject({ received: [], sent: [{ pseudo: b.pseudo, give: X, get: Y }], left: TRADES_PER_DAY });
    const received = await store.trades(b.id);
    expect(received.received).toMatchObject([{ id: sent.sent[0].id, pseudo: a.pseudo, give: Y, get: X }]);
    expect(Date.parse(received.received[0].expiresAt) - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect(await store.acceptTrade(a.id, sent.sent[0].id)).toBe(GONE);
    expect(await store.acceptTrade(b.id, sent.sent[0].id)).toEqual({ from: a.id });
    expect(await copies(a.id)).toEqual({ cards: [[X, 2], [Y, 1]], rarities: [[X, "super", 2]] });
    expect(await copies(b.id)).toEqual({ cards: [[X, 1], [Y, 1]], rarities: [[X, "common", 1], [Y, "rare", 1]] });
    expect(await store.trades(a.id)).toEqual({ received: [], sent: [], left: TRADES_PER_DAY - 1 });
    expect(await store.acceptTrade(b.id, sent.sent[0].id)).toBe(GONE);
  });

  it("refuse une offre sans ami, sans doublon, sur une carte identique ou sur les exemplaires d'un deck", async () => {
    const a = await player();
    const b = await player();
    const stranger = await player();
    await friends(a.id, b.id);
    await own(a.id, X, 2);
    await own(b.id, Y, 1);
    await own(stranger.id, Y, 2);
    expect(await store.tradeCards(a.id, stranger.pseudo)).toBe("ami introuvable");
    expect(await store.offerTrade(a.id, stranger.pseudo, X, Y)).toBe("ami introuvable");
    expect(await store.offerTrade(a.id, b.pseudo, X, X)).toBe("choisissez deux cartes différentes");
    expect(await store.offerTrade(a.id, b.pseudo, X, Y)).toMatch(/n'a plus au moins 2 exemplaires/);
    expect(await store.offerTrade(a.id, b.pseudo, Y, X)).toMatch(/il vous faut au moins 2 exemplaires/);
    await admin`update yugioh.collection set quantity = 3 where user_id = ${b.id}`;
    await admin`insert into yugioh.decks (user_id, name, main_deck, extra_deck) values (${a.id}, 'Deck', ${[X, X]}, '{}')`;
    expect(await store.tradeCards(a.id, b.pseudo)).toEqual({ mine: [], theirs: [[Y, 2]] });
    expect(await store.offerTrade(a.id, b.pseudo, X, Y)).toMatch(/un de vos decks utilise tous vos exemplaires/);
    expect(await store.trades(a.id)).toMatchObject({ sent: [] });
  });

  it("deux acceptations simultanées de la même offre n'échangent qu'une fois", async () => {
    const { a, b, id } = await offered();
    const results = await Promise.all([store.acceptTrade(b.id, id), store.acceptTrade(b.id, id)]);
    expect(results.filter((result) => typeof result !== "string")).toHaveLength(1);
    expect(results).toContain(GONE);
    expect((await copies(a.id)).cards).toEqual([[X, 1], [Y, 1]]);
    expect((await copies(b.id)).cards).toEqual([[X, 1], [Y, 1]]);
  });

  it("deux offres sur le même doublon acceptées en même temps : la seconde voit qu'il n'y est plus", async () => {
    const a = await player();
    const b = await player();
    const c = await player();
    await friends(a.id, b.id);
    await friends(a.id, c.id);
    await own(a.id, X, 2);
    await own(b.id, Y, 2);
    await own(c.id, Y, 2);
    await store.offerTrade(a.id, b.pseudo, X, Y);
    await store.offerTrade(a.id, c.pseudo, X, Y);
    const [toB] = (await store.trades(b.id)).received;
    const [toC] = (await store.trades(c.id)).received;
    const results = await Promise.all([store.acceptTrade(b.id, toB.id), store.acceptTrade(c.id, toC.id)]);
    expect(results.filter((result) => typeof result !== "string")).toHaveLength(1);
    expect(results.find((result) => typeof result === "string")).toMatch(/n'a plus au moins 2 exemplaires de sa carte/);
    expect((await copies(a.id)).cards).toEqual([[X, 1], [Y, 1]]);
  });

  it("revérifie la possession et les decks à l'acceptation, sans rien changer en cas de refus", async () => {
    const first = await offered();
    await admin`update yugioh.collection set quantity = 1 where user_id = ${first.a.id}`;
    expect(await store.acceptTrade(first.b.id, first.id)).toMatch(/n'a plus au moins 2 exemplaires/);
    expect((await copies(first.b.id)).cards).toEqual([[Y, 2]]);

    const second = await offered();
    await admin`insert into yugioh.decks (user_id, name, main_deck, extra_deck) values (${second.b.id}, 'Deck', ${[Y, Y]}, '{}')`;
    expect(await store.acceptTrade(second.b.id, second.id)).toMatch(/un de vos decks utilise tous vos exemplaires/);
    await admin`insert into yugioh.decks (user_id, name, main_deck, extra_deck) values (${second.a.id}, 'Deck', '{}', ${[X, X]})`;
    await admin`delete from yugioh.decks where user_id = ${second.b.id}`;
    expect(await store.acceptTrade(second.b.id, second.id)).toMatch(/un deck de Joueur\d+ utilise tous ses exemplaires/);
    expect((await copies(second.a.id)).cards).toEqual([[X, 2]]);

    const third = await offered();
    await admin`delete from yugioh.friendships where ${third.a.id} in (user_id, friend_id)`;
    expect(await store.acceptTrade(third.b.id, third.id)).toMatch(/n'est plus dans vos amis/);
    expect(await store.trades(third.b.id)).toMatchObject({ received: [] });
  });

  it("limite à 3 échanges acceptés par jour et par joueur, fait expirer les offres après 24 h, en borne le nombre", async () => {
    const { a, b, id } = await offered();
    const other = await player();
    for (let i = 0; i < TRADES_PER_DAY; i++) {
      await admin`
        insert into yugioh.trades (from_id, to_id, give_code, take_code, status, decided_at)
        values (${other.id}, ${a.id}, 1, 2, 'accepted', now())`;
    }
    expect(await store.acceptTrade(b.id, id)).toMatch(/a déjà fait 3 échanges aujourd'hui/);
    expect((await store.trades(a.id)).left).toBe(0);
    await admin`update yugioh.trades set decided_at = now() - interval '2 days' where from_id = ${other.id}`;
    await admin`update yugioh.trades set created_at = now() - interval '25 hours' where id = ${id}`;
    expect(await store.trades(b.id)).toEqual({ received: [], sent: [], left: TRADES_PER_DAY });
    expect(await store.acceptTrade(b.id, id)).toBe(GONE);
    for (let i = 0; i < TRADE_PENDING_MAX; i++) expect(await store.offerTrade(a.id, b.pseudo, X, Y)).toEqual({ to: b.id });
    expect(await store.offerTrade(a.id, b.pseudo, X, Y)).toMatch(/trop d'offres d'échange en attente/);
    expect(await admin`select 1 from yugioh.trades where id = ${id}`).toHaveLength(0);
  });

  it("refuse ou annule une offre, une seule fois, et seulement entre ses deux joueurs", async () => {
    const { a, b, id } = await offered();
    const stranger = await player();
    expect(await store.removeTrade(stranger.id, id)).toBeUndefined();
    expect(await store.removeTrade(b.id, id)).toEqual({ other: a.id, refused: true });
    expect(await store.removeTrade(b.id, id)).toBeUndefined();
    await store.offerTrade(a.id, b.pseudo, X, Y);
    const [again] = (await store.trades(a.id)).sent;
    expect(await store.removeTrade(a.id, again.id)).toEqual({ other: b.id, refused: false });
    await expect(pg.server`insert into yugioh.trades (from_id, to_id, give_code, take_code) values (${a.id}, ${a.id}, 1, 2)`).rejects.toThrow();
    await expect(pg.server`insert into yugioh.trades (from_id, to_id, give_code, take_code, status) values (${a.id}, ${b.id}, 1, 2, 'accepted')`).rejects.toThrow();
  });
});
