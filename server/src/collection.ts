import postgres from "postgres";
import { clientCard } from "./cards.ts";
import type { Db, Sql } from "./db.ts";
import { deckError, type CardLookup, type DeckDraft } from "./deckcheck.ts";
import { isAllowed, type Printing } from "./pool.ts";
import type { ClientMessage, Deck, ServerMessage } from "./protocol.ts";

export type DeckList = { decks: Deck[]; active: number | null };
export type CollectionView = Omit<Extract<ServerMessage, { type: "collection" }>, "type">;
export type DeckMessage = Extract<ClientMessage, { type: "collection" | "decks" | "save_deck" | "delete_deck" | "active_deck" }>;

// Collection and deck storage, faked in tests.
export type DeckStore = {
  collection: (userId: string) => Promise<CollectionView>;
  decks: (userId: string) => Promise<DeckList>;
  saveDeck: (userId: string, deck: DeckDraft) => Promise<{ id: number } | { error: string }>;
  // Resolves to false for the active deck or another player's deck.
  deleteDeck: (userId: string, id: number) => Promise<boolean>;
  activateDeck: (userId: string, id: number) => Promise<boolean>;
};

const DECK_TYPES: ReadonlySet<unknown> = new Set(["collection", "decks", "save_deck", "delete_deck", "active_deck"]);
export const isDeckMessage = (msg: ClientMessage): msg is DeckMessage => DECK_TYPES.has(msg.type);

const isCodes = (value: unknown) => Array.isArray(value) && value.every(Number.isInteger);

function isDraft(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const deck = value as Record<string, unknown>;
  return (deck.id === undefined || Number.isInteger(deck.id)) && typeof deck.name === "string" && isCodes(deck.main) && isCodes(deck.extra);
}

// Shape check of an incoming deck message, before its type is trusted.
export function validDeckMessage(msg: Record<string, unknown>): boolean {
  if (msg.type === "save_deck") return isDraft(msg.deck);
  if (msg.type === "delete_deck" || msg.type === "active_deck") return Number.isInteger(msg.id);
  return msg.type === "collection" || msg.type === "decks";
}

// The answer to a deck message, or the error for the sender.
export async function deckReply(store: DeckStore, userId: string, msg: DeckMessage): Promise<ServerMessage | string> {
  if (msg.type === "collection") return { type: "collection", ...(await store.collection(userId)) };
  let saved: number | undefined;
  if (msg.type === "save_deck") {
    const result = await store.saveDeck(userId, msg.deck);
    if ("error" in result) return result.error;
    saved = result.id;
  }
  if (msg.type === "delete_deck" && !(await store.deleteDeck(userId, msg.id))) return "suppression impossible : deck actif ou introuvable";
  if (msg.type === "active_deck" && !(await store.activateDeck(userId, msg.id))) return "deck introuvable";
  return { type: "decks", ...(await store.decks(userId)), saved };
}

// Card data of the allowed pool only.
export const poolCard: CardLookup = (code) => (isAllowed(code) ? clientCard(code) : undefined);

// Owned cards as [passcode, quantity].
export async function readCollection(db: Sql, userId: string): Promise<[number, number][]> {
  const rows = await db<{ code: number; quantity: number }[]>`
    select card_code as code, quantity from yugioh.collection where user_id = ${userId} order by card_code`;
  return rows.map((row) => [row.code, row.quantity]);
}

// Copies obtained since rarities are kept, as [passcode, rarity, quantity].
export async function readRarities(db: Sql, userId: string): Promise<[number, string, number][]> {
  const rows = await db<{ code: number; rarity: string; quantity: number }[]>`
    select card_code as code, rarity, quantity from yugioh.collection_rarities where user_id = ${userId} order by card_code, rarity`;
  return rows.map((row) => [row.code, row.rarity, row.quantity]);
}

// Collection points of the player (economy.ts).
export async function readPoints(db: Sql, userId: string): Promise<number> {
  const [row] = await db<{ points: number }[]>`select collection_points as points from yugioh.profiles where user_id = ${userId}`;
  return row?.points ?? 0;
}

// Adds copies to the collection and to its breakdown by rarity, within the caller's transaction.
export async function addCards(sql: Sql, userId: string, printings: Printing[]): Promise<void> {
  const codes = printings.map((card) => card.code);
  const rarities = printings.map((card) => card.rarity);
  await sql`
    insert into yugioh.collection (user_id, card_code, quantity)
    select ${userId}::uuid, code, count(*) from unnest(${codes}::integer[]) code group by code
    on conflict (user_id, card_code) do update set quantity = collection.quantity + excluded.quantity`;
  await sql`
    insert into yugioh.collection_rarities (user_id, card_code, rarity, quantity)
    select ${userId}::uuid, code, rarity, count(*) from unnest(${codes}::integer[], ${rarities}::text[]) printing (code, rarity) group by code, rarity
    on conflict (user_id, card_code, rarity) do update set quantity = collection_rarities.quantity + excluded.quantity`;
}

// Deck ids are bigint: the driver returns them as strings.
export async function listDecks(db: Db, userId: string): Promise<DeckList> {
  const rows = await db<{ id: string; name: string; main: number[]; extra: number[]; active: boolean }[]>`
    select d.id, d.name, d.main_deck as main, d.extra_deck as extra, d.id = p.active_deck_id as active
    from yugioh.decks d join yugioh.profiles p on p.user_id = d.user_id
    where d.user_id = ${userId} order by d.id`;
  const decks = rows.map(({ id, name, main, extra }) => ({ id: Number(id), name, main, extra }));
  const active = rows.find((row) => row.active);
  return { decks, active: active ? Number(active.id) : null };
}

// Creates the deck without `id`, else replaces it. Validated against the rules and the player's collection.
export async function saveDeck(db: Db, userId: string, deck: DeckDraft): Promise<{ id: number } | { error: string }> {
  const error = deckError(deck, poolCard, new Map(await readCollection(db, userId)));
  if (error) return { error };
  const name = deck.name.trim();
  try {
    const [row] =
      deck.id === undefined
        ? await db<{ id: string }[]>`
          insert into yugioh.decks (user_id, name, main_deck, extra_deck) values (${userId}, ${name}, ${deck.main}, ${deck.extra})
          returning id`
        : await db<{ id: string }[]>`
          update yugioh.decks set name = ${name}, main_deck = ${deck.main}, extra_deck = ${deck.extra}, updated_at = now()
          where id = ${deck.id} and user_id = ${userId} returning id`;
    return row ? { id: Number(row.id) } : { error: "deck introuvable" };
  } catch (failure) {
    if (failure instanceof postgres.PostgresError && failure.code === "23505") return { error: "un deck porte déjà ce nom" };
    throw failure;
  }
}

// The active deck cannot be deleted: a player without one would be offered a starter again.
// The profile lock keeps a concurrent activation from slipping in between.
export async function deleteDeck(db: Db, userId: string, id: number): Promise<boolean> {
  return db.begin(async (sql) => {
    const [profile] = await sql<{ active: string | null }[]>`
      select active_deck_id as active from yugioh.profiles where user_id = ${userId} for update`;
    if (!profile || Number(profile.active) === id) return false;
    const deleted = await sql`delete from yugioh.decks where id = ${id} and user_id = ${userId} returning id`;
    return deleted.length > 0;
  });
}

// Saved decks are valid, so any of the player's decks can become the active one.
export async function activateDeck(db: Db, userId: string, id: number): Promise<boolean> {
  const updated = await db`
    update yugioh.profiles set active_deck_id = ${id}
    where user_id = ${userId} and exists (select 1 from yugioh.decks where id = ${id} and user_id = ${userId})
    returning user_id`;
  return updated.length > 0;
}

export function dbDeckStore(db: Db): DeckStore {
  return {
    collection: async (userId) => {
      const [cards, rarities, points] = await Promise.all([readCollection(db, userId), readRarities(db, userId), readPoints(db, userId)]);
      return { cards, rarities, points };
    },
    decks: (userId) => listDecks(db, userId),
    saveDeck: (userId, deck) => saveDeck(db, userId, deck),
    deleteDeck: (userId, id) => deleteDeck(db, userId, id),
    activateDeck: (userId, id) => activateDeck(db, userId, id),
  };
}
