import type { Db } from "./db.ts";
import { isAllowed } from "./pool.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";

export const WISH_MAX = 100;
export type WishMessage = Extract<ClientMessage, { type: "wishlist" | "wish_add" | "wish_remove" }>;

// Wishlist storage, faked in tests.
export type WishStore = {
  // Passcodes, oldest wish first.
  wishlist: (userId: string) => Promise<number[]>;
  // Resolves to false when the list is full; a card already wished is kept as is.
  addWish: (userId: string, code: number) => Promise<boolean>;
  removeWish: (userId: string, code: number) => Promise<void>;
};

const WISH_TYPES: ReadonlySet<unknown> = new Set(["wishlist", "wish_add", "wish_remove"]);
export const isWishMessage = (msg: ClientMessage): msg is WishMessage => WISH_TYPES.has(msg.type);

// Shape check of an incoming wishlist message, before its type is trusted.
export const validWishMessage = (msg: Record<string, unknown>): boolean =>
  msg.type === "wishlist" || ((msg.type === "wish_add" || msg.type === "wish_remove") && Number.isInteger(msg.code));

// The answer to a wishlist message, or the error for the sender.
export async function wishReply(store: WishStore, userId: string, msg: WishMessage): Promise<ServerMessage | string> {
  if (msg.type === "wish_add") {
    if (!isAllowed(msg.code)) return "carte inconnue";
    if (!(await store.addWish(userId, msg.code))) return `liste de souhaits pleine (${WISH_MAX} cartes au maximum)`;
  }
  if (msg.type === "wish_remove") await store.removeWish(userId, msg.code);
  return { type: "wishlist", cards: await store.wishlist(userId) };
}

export async function readWishlist(db: Db, userId: string): Promise<number[]> {
  const rows = await db<{ code: number }[]>`
    select card_code as code from yugioh.wishlist where user_id = ${userId} order by added_at, card_code`;
  return rows.map((row) => row.code);
}

// The profile lock keeps two connections of a player from passing the limit together.
export async function addWish(db: Db, userId: string, code: number): Promise<boolean> {
  return db.begin(async (sql) => {
    await sql`select 1 from yugioh.profiles where user_id = ${userId} for update`;
    const [{ count, wished }] = await sql<{ count: number; wished: boolean }[]>`
      select count(*)::int as count, coalesce(bool_or(card_code = ${code}), false) as wished
      from yugioh.wishlist where user_id = ${userId}`;
    if (wished) return true;
    if (count >= WISH_MAX) return false;
    await sql`insert into yugioh.wishlist (user_id, card_code) values (${userId}, ${code})`;
    return true;
  });
}

export function dbWishStore(db: Db): WishStore {
  return {
    wishlist: (userId) => readWishlist(db, userId),
    addWish: (userId, code) => addWish(db, userId, code),
    removeWish: async (userId, code) => {
      await db`delete from yugioh.wishlist where user_id = ${userId} and card_code = ${code}`;
    },
  };
}
