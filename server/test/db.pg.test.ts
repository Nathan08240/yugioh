import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createProfile, type Db, findProfile } from "../src/db.ts";
import type { ClientMessage } from "../src/protocol.ts";
import { dbAccounts, startServer } from "../src/server.ts";
import { type Pg, startPostgres } from "./pg.ts";

// Envoie `messages` sur une nouvelle connexion et renvoie les `count` premières réponses.
async function exchange(url: string, messages: ClientMessage[], count: number): Promise<unknown[]> {
  const socket = new WebSocket(url);
  const received: unknown[] = [];
  socket.on("message", (data) => received.push(JSON.parse(String(data))));
  await once(socket, "open");
  for (const msg of messages) socket.send(JSON.stringify(msg));
  await vi.waitFor(() => expect(received).toHaveLength(count));
  socket.close();
  return received;
}

describe("migration yugioh sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let server: Db;

  beforeAll(async () => {
    pg = await startPostgres();
    ({ admin, server } = pg);
  }, 180_000);

  afterAll(() => pg?.stop());

  it("crée et relit un profil en tant que yugioh_server, pseudo unique sans casse", async () => {
    const [yugi, kaiba] = await admin<{ id: string }[]>`
      insert into auth.users (id) values (gen_random_uuid()), (gen_random_uuid()) returning id`;

    expect(await createProfile(server, yugi.id, "Yugi")).toEqual({ userId: yugi.id, pseudo: "Yugi", activeDeckId: null });
    expect(await findProfile(server, yugi.id)).toEqual({ userId: yugi.id, pseudo: "Yugi", activeDeckId: null });
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

  it("crée le profil via le serveur de partie, pseudo unique sans casse", async () => {
    const [lea, max] = await admin<{ id: string }[]>`
      insert into auth.users (id) values (gen_random_uuid()), (gen_random_uuid()) returning id`;
    // Vérification Supabase simulée : le jeton est l'id du joueur.
    const wss = startServer(0, { ...dbAccounts(server), verify: async (token) => token });
    await once(wss, "listening");
    const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
    const choose = (id: string, pseudo: string) => exchange(url, [{ type: "auth", token: id }, { type: "pseudo", pseudo }], 2);
    try {
      expect(await choose(lea.id, "Lea")).toEqual([
        { type: "profile", pseudo: null, needsStarter: false },
        { type: "profile", pseudo: "Lea", needsStarter: true },
      ]);
      expect(await choose(max.id, "LEA")).toEqual([
        { type: "profile", pseudo: null, needsStarter: false },
        { type: "error", error: "pseudo déjà pris" },
      ]);
      expect(await choose(lea.id, "Autre")).toEqual([
        { type: "profile", pseudo: "Lea", needsStarter: true },
        { type: "error", error: "pseudo déjà choisi" },
      ]);
      expect(await findProfile(server, lea.id)).toEqual({ userId: lea.id, pseudo: "Lea", activeDeckId: null });
    } finally {
      wss.close();
    }
  });
});
