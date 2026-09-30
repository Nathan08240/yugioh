import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";
import { addCards } from "../src/collection.ts";
import { createProfile, type Db } from "../src/db.ts";
import { SETS } from "../src/pool.ts";
import type { ClientMessage, ServerMessage } from "../src/protocol.ts";
import { dbAccounts, startServer } from "../src/server.ts";
import { chooseStarter, starterCards } from "../src/starter.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("collection et decks sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let wss: WebSocketServer;
  let url: string;

  beforeAll(async () => {
    pg = await startPostgres();
    admin = pg.admin;
    // Vérification Supabase simulée : le jeton est l'id du joueur.
    wss = startServer(0, { ...dbAccounts(pg.server), verify: async (token) => token });
    await once(wss, "listening");
    url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
  }, 180_000);

  afterAll(async () => {
    wss?.close();
    await pg?.stop();
  });

  // A player with the Yugi starter, connected: `ask` sends a message and resolves to the server's answer.
  async function player(pseudo: string) {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(pg.server, id, pseudo);
    await chooseStarter(pg.server, id, "yugi");
    const socket = new WebSocket(url);
    const received: ServerMessage[] = [];
    socket.on("message", (data) => received.push(JSON.parse(String(data))));
    await once(socket, "open");
    const ask = async (msg: ClientMessage) => {
      const count = received.length + 1;
      socket.send(JSON.stringify(msg));
      await vi.waitFor(() => expect(received).toHaveLength(count));
      return received[count - 1];
    };
    await ask({ type: "auth", token: id });
    return { id, ask, close: () => socket.close() };
  }

  it("lit la collection et les decks, enregistre, renomme et relit un deck en base", async () => {
    const yugi = await player("Yugi");
    const codes = starterCards("yugi");
    try {
      const collection = await yugi.ask({ type: "collection" });
      const printings = SETS.find((set) => set.code === "SDY")?.cards ?? [];
      expect(collection).toEqual({
        type: "collection",
        cards: [...new Set(codes)].sort((a, b) => a - b).map((code) => [code, 1]),
        rarities: printings.toSorted((a, b) => a.code - b.code).map(({ code, rarity }) => [code, rarity, 1]),
        points: 0,
      });

      const listed = await yugi.ask({ type: "decks" });
      expect(listed).toEqual({ type: "decks", decks: [{ id: expect.any(Number), name: "Starter Yugi", main: codes, extra: [] }], active: expect.any(Number) });
      const starterId = listed.type === "decks" ? listed.active : null;

      const main = codes.slice(0, 40);
      const saved = await yugi.ask({ type: "save_deck", deck: { name: "  Magiciens  ", main, extra: [] } });
      const newId = saved.type === "decks" ? saved.saved : undefined;
      expect(saved).toMatchObject({ type: "decks", active: starterId, saved: expect.any(Number) });

      await yugi.ask({ type: "save_deck", deck: { id: newId, name: "Magiciens noirs", main: [...main, codes[40]], extra: [] } });
      const [row] = await admin<{ name: string; main_deck: number[]; extra_deck: number[] }[]>`
        select name, main_deck, extra_deck from yugioh.decks where id = ${newId ?? 0}`;
      expect(row).toEqual({ name: "Magiciens noirs", main_deck: [...main, codes[40]], extra_deck: [] });
      expect(await admin`select id from yugioh.decks where user_id = ${yugi.id}`).toHaveLength(2);
    } finally {
      yugi.close();
    }
  });

  it("laisse en rareté inconnue les exemplaires obtenus avant que la rareté soit gardée", async () => {
    const tea = await player("Tea");
    const exodia = 33396948;
    try {
      await admin`insert into yugioh.collection (user_id, card_code, quantity) values (${tea.id}, ${exodia}, 2)`;
      await pg.server.begin((sql) => addCards(sql, tea.id, [{ code: exodia, rarity: "secret" }]));
      const collection = await tea.ask({ type: "collection" });
      if (collection.type !== "collection") throw new Error(JSON.stringify(collection));
      expect(collection.cards).toContainEqual([exodia, 3]);
      expect(collection.rarities.filter(([code]) => code === exodia)).toEqual([[exodia, "secret", 1]]);
    } finally {
      tea.close();
    }
  });

  it("refuse un deck invalide, un nom déjà pris et le deck d'un autre joueur", async () => {
    const kaiba = await player("Kaiba");
    const main = starterCards("yugi").slice(0, 40);
    try {
      expect(await kaiba.ask({ type: "save_deck", deck: { name: "Court", main: main.slice(1), extra: [] } })).toEqual({
        type: "error",
        error: "le main deck doit compter 40 à 60 cartes",
      });
      expect(await kaiba.ask({ type: "save_deck", deck: { name: "Double", main: [...main.slice(1), main[1]], extra: [] } })).toEqual({
        type: "error",
        error: expect.stringContaining("plus d'exemplaires que dans la collection"),
      });
      expect(await kaiba.ask({ type: "save_deck", deck: { name: "Starter Yugi", main, extra: [] } })).toEqual({
        type: "error",
        error: "un deck porte déjà ce nom",
      });
      expect(await kaiba.ask({ type: "save_deck", deck: { name: "Fusion", main, extra: [45231177] } })).toEqual({
        type: "error",
        error: "Spadassin des Flammes : plus d'exemplaires que dans la collection",
      });
      expect(await kaiba.ask({ type: "save_deck", deck: { name: "Bad", main: "x", extra: [] } as never })).toEqual({ type: "error", error: "message invalide" });

      const [{ id: other }] = await admin<{ id: string }[]>`select d.id from yugioh.decks d join yugioh.profiles p using (user_id) where p.pseudo = 'Yugi' limit 1`;
      const theirs = Number(other);
      expect(await kaiba.ask({ type: "save_deck", deck: { id: theirs, name: "Volé", main, extra: [] } })).toEqual({ type: "error", error: "deck introuvable" });
      expect(await kaiba.ask({ type: "active_deck", id: theirs })).toEqual({ type: "error", error: "deck introuvable" });
      expect(await kaiba.ask({ type: "delete_deck", id: theirs })).toMatchObject({ type: "error" });
      expect(await admin`select id from yugioh.decks where id = ${theirs}`).toHaveLength(1);
    } finally {
      kaiba.close();
    }
  });

  it("change le deck actif et refuse de supprimer le deck actif", async () => {
    const joey = await player("Joey");
    try {
      const saved = await joey.ask({ type: "save_deck", deck: { name: "Second", main: starterCards("yugi").slice(0, 40), extra: [] } });
      if (saved.type !== "decks" || saved.saved === undefined || saved.active === null) throw new Error(JSON.stringify(saved));
      const { saved: second, active: starter } = saved;

      expect(await joey.ask({ type: "delete_deck", id: starter })).toEqual({ type: "error", error: "suppression impossible : deck actif ou introuvable" });
      expect(await joey.ask({ type: "active_deck", id: second })).toMatchObject({ type: "decks", active: second });
      expect(await joey.ask({ type: "delete_deck", id: starter })).toMatchObject({ type: "decks", active: second, decks: [{ id: second }] });

      const [profile] = await admin<{ active: string }[]>`select active_deck_id as active from yugioh.profiles where user_id = ${joey.id}`;
      expect(Number(profile.active)).toBe(second);
    } finally {
      joey.close();
    }
  });
});
