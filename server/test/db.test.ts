import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db, findProfile, openDb } from "../src/db.ts";

const migration = readFileSync(
  join(import.meta.dirname, "..", "..", "supabase", "migrations", "20260928120000_yugioh_init.sql"),
  "utf8",
);
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();

function hasDocker(): boolean {
  try {
    docker("info", "--format", "{{.ServerVersion}}");
    return true;
  } catch {
    return false;
  }
}

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

// Postgres 15 jetable (version de l'instance), auth.users et rôles Supabase factices.
describe.skipIf(!hasDocker())("migration yugioh sur Postgres jetable", () => {
  let container = "";
  let admin: Db;
  let server: Db;

  beforeAll(async () => {
    container = docker("run", "-d", "--rm", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-p", "127.0.0.1::5432", "postgres:15-alpine");
    const port = docker("port", container, "5432").split(":").at(-1);
    const base = `postgres://%s@127.0.0.1:${port}/postgres`;
    admin = await waitFor(base.replace("%s", "postgres"));
    await admin.unsafe(`
      create schema auth;
      create table auth.users (id uuid primary key);
      create role anon nologin;
      create role authenticated nologin;`);
    await admin.unsafe(migration);
    server = openDb(base.replace("%s", "yugioh_server"));
  }, 180_000);

  afterAll(async () => {
    await server?.end();
    await admin?.end();
    if (container) docker("rm", "-f", container);
  });

  it("crée et relit un profil en tant que yugioh_server, pseudo unique sans casse", async () => {
    const [yugi, kaiba] = await admin<{ id: string }[]>`
      insert into auth.users (id) values (gen_random_uuid()), (gen_random_uuid()) returning id`;

    expect(await createProfile(server, yugi.id, "Yugi")).toEqual({ userId: yugi.id, pseudo: "Yugi" });
    expect(await findProfile(server, yugi.id)).toEqual({ userId: yugi.id, pseudo: "Yugi" });
    expect(await findProfile(server, kaiba.id)).toBeUndefined();
    await expect(createProfile(server, kaiba.id, "yugi")).rejects.toThrow("profiles_pseudo_key");
  });

  it("garde le journal des ouvertures en ajout seul", async () => {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(server, id, "Joey");
    await server`insert into yugioh.booster_openings (user_id, set_code, source, cards) values (${id}, 'LOB', 'free', ${[89631139]})`;

    await expect(server`update yugioh.booster_openings set cards = '{1}'`).rejects.toThrow("permission denied");
    await expect(server`delete from yugioh.booster_openings`).rejects.toThrow("permission denied");
  });

  it("n'ouvre rien à anon et authenticated et active la RLS partout", async () => {
    const leaks = await admin`
      select c.relname, r.role from pg_class c cross join unnest(array['anon', 'authenticated']) r(role)
      where c.relnamespace = 'yugioh'::regnamespace
        and (has_schema_privilege(r.role, 'yugioh', 'usage')
          or has_table_privilege(r.role, c.oid, 'select, insert, update, delete'))`;
    const withoutRls = await admin`
      select relname from pg_class where relnamespace = 'yugioh'::regnamespace and relkind = 'r' and not relrowsecurity`;

    expect(leaks).toEqual([]);
    expect(withoutRls).toEqual([]);
    await expect(server`select * from auth.users`).rejects.toThrow("permission denied");
  });
});
