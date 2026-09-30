import postgres from "postgres";

export type Db = postgres.Sql;
// A connection or a transaction.
export type Sql = postgres.ISql;
export type Profile = { userId: string; pseudo: string; activeDeckId: number | null };

// Connexion en tant que yugioh_server, ex. postgres://yugioh_server:<mdp>@hôte:5432/postgres
export function openDb(url = process.env.YUGIOH_DATABASE_URL): Db {
  if (!url) throw new Error("YUGIOH_DATABASE_URL absente");
  return postgres(url);
}

export async function findProfile(db: Db, userId: string): Promise<Profile | undefined> {
  const [profile] = await db<Profile[]>`
    select user_id as "userId", pseudo, active_deck_id as "activeDeckId" from yugioh.profiles where user_id = ${userId}`;
  return profile;
}

export async function createProfile(db: Db, userId: string, pseudo: string): Promise<Profile> {
  const [profile] = await db<Profile[]>`
    insert into yugioh.profiles (user_id, pseudo) values (${userId}, ${pseudo})
    returning user_id as "userId", pseudo, active_deck_id as "activeDeckId"`;
  return profile;
}

// `id` is the stored deck, absent when the deck is not in the database.
export type ActiveDeck = { main: number[]; extra: number[]; id?: number };

// The active deck, or undefined if the player has none yet.
export async function activeDeck(db: Db, userId: string): Promise<ActiveDeck | undefined> {
  const [row] = await db<{ id: string; main: number[]; extra: number[] }[]>`
    select d.id, d.main_deck as main, d.extra_deck as extra from yugioh.profiles p
    join yugioh.decks d on d.id = p.active_deck_id
    where p.user_id = ${userId}`;
  return row && { ...row, id: Number(row.id) };
}
