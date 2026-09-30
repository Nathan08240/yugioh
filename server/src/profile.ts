import type { Db } from "./db.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";

export type ProfileField = "avatar" | "favorite";
export type ProfileCards = Record<ProfileField, number | null>;
export type ProfileMessage = Extract<ClientMessage, { type: "player_profile" | "set_avatar" | "set_favorite" }>;

// Avatar and favorite card storage, faked in tests.
export type ProfileStore = {
  profileCards: (userId: string) => Promise<ProfileCards>;
  // Resolves to false when the player does not own the card.
  setProfileCard: (userId: string, field: ProfileField, code: number) => Promise<boolean>;
};

export const isProfileMessage = (msg: ClientMessage): msg is ProfileMessage => msg.type === "player_profile" || msg.type === "set_avatar" || msg.type === "set_favorite";

// Shape check of an incoming profile message, before its type is trusted.
export const validProfileMessage = (msg: Record<string, unknown>): boolean =>
  msg.type === "player_profile" || ((msg.type === "set_avatar" || msg.type === "set_favorite") && Number.isInteger(msg.code));

// Answers a profile message with the player's cards, or the error for the sender.
export async function profileReply(store: ProfileStore, userId: string, msg: ProfileMessage): Promise<ServerMessage | string> {
  if (msg.type !== "player_profile" && !(await store.setProfileCard(userId, msg.type === "set_avatar" ? "avatar" : "favorite", msg.code))) return "carte non possédée";
  return { type: "player_profile", ...(await store.profileCards(userId)) };
}

export async function readProfileCards(db: Db, userId: string): Promise<ProfileCards> {
  const [row] = await db<ProfileCards[]>`select avatar_code as avatar, favorite_code as favorite from yugioh.profiles where user_id = ${userId}`;
  return row ?? { avatar: null, favorite: null };
}

const COLUMNS: Record<ProfileField, string> = { avatar: "avatar_code", favorite: "favorite_code" };

export async function setProfileCard(db: Db, userId: string, field: ProfileField, code: number): Promise<boolean> {
  const rows = await db`
    update yugioh.profiles set ${db(COLUMNS[field])} = ${code}
    where user_id = ${userId} and exists (select 1 from yugioh.collection where user_id = ${userId} and card_code = ${code})
    returning user_id`;
  return rows.length > 0;
}

export const dbProfileStore = (db: Db): ProfileStore => ({
  profileCards: (userId) => readProfileCards(db, userId),
  setProfileCard: (userId, field, code) => setProfileCard(db, userId, field, code),
});
