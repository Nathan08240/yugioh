import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Db, openDb } from "../src/db.ts";

const migrationsDir = join(import.meta.dirname, "..", "..", "supabase", "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"));
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();

async function waitFor(url: string): Promise<Db> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const db = openDb(url);
    try {
      await db`select 1`;
      return db;
    } catch {
      await db.end();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Postgres jetable injoignable");
}

export type Pg = { admin: Db; server: Db; stop: () => Promise<void> };

// Postgres 15 jetable (version de l'instance), auth.users et rôles Supabase factices.
export async function startPostgres(): Promise<Pg> {
  const container = docker("run", "-d", "--rm", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-p", "127.0.0.1::5432", "postgres:15-alpine");
  const remove = () => docker("rm", "-f", container);
  try {
    const port = docker("port", container, "5432").split(":").at(-1);
    const base = `postgres://%s@127.0.0.1:${port}/postgres`;
    const admin = await waitFor(base.replace("%s", "postgres"));
    await admin.unsafe(`
      create schema auth;
      create table auth.users (id uuid primary key);
      create role anon nologin;
      create role authenticated nologin;`);
    for (const migration of migrations) await admin.unsafe(migration);
    // Étape manuelle du propriétaire, sans mot de passe ici car le conteneur est en trust.
    await admin.unsafe("alter role yugioh_server login");
    const server = openDb(base.replace("%s", "yugioh_server"));
    const stop = async () => {
      await server.end();
      await admin.end();
      remove();
    };
    return { admin, server, stop };
  } catch (error) {
    remove();
    throw error;
  }
}
