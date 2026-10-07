import { randomInt } from "node:crypto";
import { listDecks, poolCard, readCollection, saveDeck } from "./collection.ts";
import type { Db, Sql } from "./db.ts";
import { countBy, deckError, MAIN_MIN, NAME_MAX, overLimit } from "./deckcheck.ts";
import { GOAT } from "./limits.ts";
import { DESCRIPTION_MAX, PUBLIC_DECKS_MAX, PUBLIC_LISTED, SHARES_MAX, type ClientMessage, type PublicDeck, type PublicSort, type ServerMessage, type SharedDeck } from "./protocol.ts";

export type PublicDeckMessage = Extract<ClientMessage, { type: "deck_share" | "deck_publish" | "deck_view" | "deck_copy" | "public_decks" | "deck_unpublish" }>;
export type PublicQuery = { sort: PublicSort; goat?: boolean; card?: number };
type Named = { name: string; main: number[]; extra: number[] };

// Shared and public deck storage, faked in tests. Errors come back as texts for the sender.
export type PublicDeckStore = {
  shareDeck: (userId: string, id: number) => Promise<{ code: string } | { error: string }>;
  // `name` and `description` are already cleaned (publication).
  publishDeck: (userId: string, id: number, name: string, description: string) => Promise<{ code: string } | { error: string }>;
  sharedDeck: (viewerId: string, code: string) => Promise<SharedDeck | undefined>;
  copySharedDeck: (userId: string, code: string) => Promise<{ id: number; name: string; missing: [number, number][] } | { error: string }>;
  publicDecks: (viewerId: string, query: PublicQuery) => Promise<PublicDeck[]>;
  // Withdraws a published deck, only the one of `owner` when given. Resolves to false when there is none.
  removePublicDeck: (code: string, owner?: string) => Promise<boolean>;
};

const TYPES: ReadonlySet<unknown> = new Set(["deck_share", "deck_publish", "deck_view", "deck_copy", "public_decks", "deck_unpublish"]);
export const isPublicDeckMessage = (msg: ClientMessage): msg is PublicDeckMessage => TYPES.has(msg.type);

const isCard = (value: unknown) => value === undefined || (Number.isInteger(value) && Math.abs(value as number) < 2 ** 31);
const isFlag = (value: unknown) => value === undefined || typeof value === "boolean";

// Shape check of an incoming shared deck message, before its type is trusted.
export function validPublicDeckMessage(msg: Record<string, unknown>): boolean {
  switch (msg.type) {
    case "deck_share":
      return Number.isInteger(msg.id);
    case "deck_publish":
      return Number.isInteger(msg.id) && typeof msg.name === "string" && typeof msg.description === "string";
    case "deck_view":
    case "deck_copy":
    case "deck_unpublish":
      return typeof msg.code === "string";
    case "public_decks":
      return (msg.sort === undefined || msg.sort === "copies" || msg.sort === "recent") && isFlag(msg.goat) && isCard(msg.card);
    default:
      return false;
  }
}

// Free text shown as text only: control characters become spaces, the ends are trimmed.
const cleanText = (text: string) => text.replaceAll(/\p{Cc}/gu, " ").trim();

// The name and description to publish, cleaned, or the rule they break.
export function publication(name: string, description: string): { name: string; description: string } | { error: string } {
  const clean = { name: cleanText(name), description: cleanText(description) };
  if (clean.name.length === 0 || clean.name.length > NAME_MAX) return { error: `le nom du deck doit faire 1 à ${NAME_MAX} caractères` };
  if (clean.description.length > DESCRIPTION_MAX) return { error: `la description fait ${DESCRIPTION_MAX} caractères au plus` };
  return clean;
}

const CODE_LENGTH = 8;
// The letters and digits of the room codes: nothing to mix up when reading a code aloud.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
export const cleanCode = (code: string) => code.trim().toUpperCase();

const NOT_FOUND = "deck introuvable : code invalide ou deck retiré";

// The answer to a shared deck message, or the error for the sender. `admin`: the sender may withdraw any published deck.
export async function publicDeckReply(store: PublicDeckStore, userId: string, msg: PublicDeckMessage, admin: boolean): Promise<ServerMessage | string> {
  switch (msg.type) {
    case "deck_share": {
      const shared = await store.shareDeck(userId, msg.id);
      return "error" in shared ? shared.error : { type: "deck_shared", code: shared.code, published: false };
    }
    case "deck_publish": {
      const text = publication(msg.name, msg.description);
      if ("error" in text) return text.error;
      const published = await store.publishDeck(userId, msg.id, text.name, text.description);
      return "error" in published ? published.error : { type: "deck_shared", code: published.code, published: true };
    }
    case "deck_view": {
      const deck = await store.sharedDeck(userId, cleanCode(msg.code));
      return deck ? { type: "shared_deck", deck } : NOT_FOUND;
    }
    case "deck_copy": {
      const copied = await store.copySharedDeck(userId, cleanCode(msg.code));
      return "error" in copied ? copied.error : { type: "deck_copied", ...copied };
    }
    case "public_decks":
      return { type: "public_decks", decks: await store.publicDecks(userId, { sort: msg.sort ?? "copies", goat: msg.goat, card: msg.card }) };
    default: {
      const code = cleanCode(msg.code);
      return (await store.removePublicDeck(code, admin ? undefined : userId)) ? { type: "public_deck_removed", code } : "deck public introuvable ou qui n'est pas le vôtre";
    }
  }
}

// What the deck can carry beyond the player's collection: size, pool, fusion and copy rules, the owned cards counted as enough.
const structureError = ({ name, main, extra }: Named) => deckError({ name, main, extra }, poolCard, countBy([...main, ...extra]));

async function readDeck(sql: Sql, userId: string, id: number): Promise<Named | undefined> {
  const [row] = await sql<Named[]>`select name, main_deck as main, extra_deck as extra from yugioh.decks where id = ${id} and user_id = ${userId}`;
  return row;
}

// The code is drawn again on the rare collision.
async function insertShared(sql: Sql, userId: string, deck: Named, published?: { description: string; goat: boolean }): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const rows = await sql`
      insert into yugioh.shared_decks (code, user_id, name, description, main_deck, extra_deck, public, goat)
      values (${code}, ${userId}, ${deck.name}, ${published?.description ?? ""}, ${deck.main}, ${deck.extra}, ${published !== undefined}, ${published?.goat ?? false})
      on conflict do nothing returning code`;
    if (rows.length > 0) return code;
  }
  throw new Error("code de partage introuvable");
}

// The profile lock keeps two connections of a player from passing a limit together.
const lockProfile = (sql: Sql, userId: string) => sql`select 1 from yugioh.profiles where user_id = ${userId} for update`;

// The same deck shared again keeps its code; past SHARES_MAX codes the oldest are dropped.
export async function shareDeck(db: Db, userId: string, id: number): Promise<{ code: string } | { error: string }> {
  return db.begin(async (sql) => {
    await lockProfile(sql, userId);
    const deck = await readDeck(sql, userId, id);
    if (!deck) return { error: "deck introuvable" };
    const error = structureError(deck);
    if (error) return { error };
    const [same] = await sql<{ code: string }[]>`
      select code from yugioh.shared_decks
      where user_id = ${userId} and not public and name = ${deck.name} and main_deck = ${deck.main} and extra_deck = ${deck.extra}`;
    if (same) return { code: same.code };
    const code = await insertShared(sql, userId, deck);
    await sql`
      delete from yugioh.shared_decks
      where user_id = ${userId} and not public
        and code not in (select code from yugioh.shared_decks where user_id = ${userId} and not public order by created_at desc, code limit ${SHARES_MAX})`;
    return { code };
  });
}

export async function publishDeck(db: Db, userId: string, id: number, name: string, description: string): Promise<{ code: string } | { error: string }> {
  return db.begin(async (sql) => {
    await lockProfile(sql, userId);
    const deck = await readDeck(sql, userId, id);
    if (!deck) return { error: "deck introuvable" };
    const error = structureError(deck);
    if (error) return { error };
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from yugioh.shared_decks where user_id = ${userId} and public`;
    if (count >= PUBLIC_DECKS_MAX) return { error: `${PUBLIC_DECKS_MAX} decks publics au plus : retirez-en un avant d'en publier un autre` };
    const goat = overLimit([...deck.main, ...deck.extra], poolCard, GOAT).length === 0;
    return { code: await insertShared(sql, userId, { ...deck, name }, { description, goat }) };
  });
}

// What the player lacks of the codes, as [passcode, copies], in the order the deck lists them.
export function missingCards(codes: number[], owned: ReadonlyMap<number, number>): [number, number][] {
  return [...countBy(codes)].map(([code, copies]): [number, number] => [code, copies - (owned.get(code) ?? 0)]).filter(([, lacking]) => lacking > 0);
}

// The part of a deck the player owns (main deck first, then the extra deck), and the copies left out.
export function ownedPart(deck: { main: number[]; extra: number[] }, owned: ReadonlyMap<number, number>) {
  const left = new Map(owned);
  const keep = (codes: number[]) =>
    codes.filter((code) => {
      const copies = left.get(code) ?? 0;
      if (copies > 0) left.set(code, copies - 1);
      return copies > 0;
    });
  const main = keep(deck.main);
  const extra = keep(deck.extra);
  return { main, extra, missing: missingCards([...deck.main, ...deck.extra], owned) };
}

// `name`, or `name (2)`, `name (3)`... when the player already has a deck of that name.
export function freeName(name: string, taken: ReadonlySet<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = ` (${n})`;
    candidate = `${name.slice(0, NAME_MAX - suffix.length)}${suffix}`;
  }
  return candidate;
}

type SharedRow = { code: string; name: string; description: string; author: string; date: Date; copies: number; goat: boolean; public: boolean; mine: boolean; main: number[]; extra: number[] };

export async function sharedDeck(db: Db, viewerId: string, code: string): Promise<SharedDeck | undefined> {
  const [row] = await db<SharedRow[]>`
    select d.code, d.name, d.description, p.pseudo as author, d.created_at as date, d.copies, d.goat, d.public, d.user_id = ${viewerId} as mine, d.main_deck as main, d.extra_deck as extra
    from yugioh.shared_decks d join yugioh.profiles p on p.user_id = d.user_id where d.code = ${code}`;
  if (!row) return undefined;
  const owned = new Map(await readCollection(db, viewerId));
  return { ...row, date: row.date.toISOString(), missing: missingCards([...row.main, ...row.extra], owned) };
}

// Saves the owned part of the deck as a new deck of the player. The server validates it like any save (collection, 40 cards at least).
// A published deck counts one copy per player, never its author's.
export async function copySharedDeck(db: Db, userId: string, code: string): Promise<{ id: number; name: string; missing: [number, number][] } | { error: string }> {
  const [row] = await db<Named[]>`select name, main_deck as main, extra_deck as extra from yugioh.shared_decks where code = ${code}`;
  if (!row) return { error: NOT_FOUND };
  const { main, extra, missing } = ownedPart(row, new Map(await readCollection(db, userId)));
  if (main.length < MAIN_MIN) {
    const lacking = missing.reduce((sum, [, copies]) => sum + copies, 0);
    return { error: `copie impossible : il vous manque ${lacking} cartes, le main deck n'en garderait que ${main.length} sur ${MAIN_MIN} au minimum` };
  }
  const name = freeName(row.name, new Set((await listDecks(db, userId)).decks.map((deck) => deck.name)));
  const saved = await saveDeck(db, userId, { name, main, extra });
  if ("error" in saved) return saved;
  await db`
    with copied as (
      insert into yugioh.shared_deck_copies (code, user_id)
      select code, ${userId}::uuid from yugioh.shared_decks where code = ${code} and public and user_id <> ${userId}
      on conflict do nothing returning 1)
    update yugioh.shared_decks set copies = copies + 1 where code = ${code} and exists (select 1 from copied)`;
  return { id: saved.id, name, missing };
}

type PublicRow = Omit<PublicDeck, "date"> & { date: Date };

export async function publicDecks(db: Db, viewerId: string, { sort, goat, card }: PublicQuery): Promise<PublicDeck[]> {
  const order = sort === "recent" ? db`d.created_at desc` : db`d.copies desc, d.created_at desc`;
  const rows = await db<PublicRow[]>`
    select d.code, d.name, d.description, p.pseudo as author, d.created_at as date, d.copies, d.goat, d.user_id = ${viewerId} as mine,
      cardinality(d.main_deck) as main, cardinality(d.extra_deck) as extra
    from yugioh.shared_decks d join yugioh.profiles p on p.user_id = d.user_id
    where d.public
      and (${goat ?? null}::boolean is null or d.goat = ${goat ?? null}::boolean)
      and (${card ?? null}::integer is null or ${card ?? null}::integer = any(d.main_deck) or ${card ?? null}::integer = any(d.extra_deck))
    order by ${order}, d.code limit ${PUBLIC_LISTED}`;
  return rows.map((row) => ({ ...row, date: row.date.toISOString() }));
}

export async function removePublicDeck(db: Db, code: string, owner?: string): Promise<boolean> {
  const rows = await db`
    delete from yugioh.shared_decks
    where code = ${code} and public and (${owner ?? null}::uuid is null or user_id = ${owner ?? null}::uuid) returning code`;
  return rows.length > 0;
}

export const dbPublicDeckStore = (db: Db): PublicDeckStore => ({
  shareDeck: (userId, id) => shareDeck(db, userId, id),
  publishDeck: (userId, id, name, description) => publishDeck(db, userId, id, name, description),
  sharedDeck: (viewerId, code) => sharedDeck(db, viewerId, code),
  copySharedDeck: (userId, code) => copySharedDeck(db, userId, code),
  publicDecks: (viewerId, query) => publicDecks(db, viewerId, query),
  removePublicDeck: (code, owner) => removePublicDeck(db, code, owner),
});
