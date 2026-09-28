import postgres from "postgres";

export type Db = postgres.Sql;
export type Profile = { userId: string; pseudo: string };

// Connexion en tant que yugioh_server, ex. postgres://yugioh_server:<mdp>@hôte:5432/postgres
export function openDb(url = process.env.YUGIOH_DATABASE_URL): Db {
  if (!url) throw new Error("YUGIOH_DATABASE_URL absente");
  return postgres(url);
}

export async function findProfile(db: Db, userId: string): Promise<Profile | undefined> {
  const [profile] = await db<Profile[]>`
    select user_id as "userId", pseudo from yugioh.profiles where user_id = ${userId}`;
  return profile;
}

export async function createProfile(db: Db, userId: string, pseudo: string): Promise<Profile> {
  const [profile] = await db<Profile[]>`
    insert into yugioh.profiles (user_id, pseudo) values (${userId}, ${pseudo})
    returning user_id as "userId", pseudo`;
  return profile;
}
