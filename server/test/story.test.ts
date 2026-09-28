import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import { Bot } from "../src/bot.ts";
import { YUGI } from "../src/decks.ts";
import { runDuel, type Player } from "../src/duel.ts";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { startServer } from "../src/server.ts";
import { STORY, STORY_DUELS, storyDeck, storyRules, storyView, validateStory, type Story, type StoryDuel } from "../src/story.ts";
import { fakeAccounts } from "./fakes.ts";

const [weevil, mako, mai] = ["dk-weevil", "dk-mako", "dk-mai"].map((id) => STORY_DUELS.get(id) as StoryDuel);
// "Duelist Kingdom", an unofficial card outside the pool.
const ANIME = 511002621;

const storyWith = (duel: Partial<StoryDuel>, anime: number[] = []): Story => ({ version: 1, anime, arcs: [{ id: "arc", title: "Arc", duels: [{ ...weevil, ...duel }] }] });

describe("données du mode Histoire", () => {
  it("valide l'histoire livrée : cartes dans BabelCDB et autorisées, prérequis, règles, récompenses", () => {
    expect(validateStory(STORY)).toEqual([]);
    expect(STORY.arcs[0].duels.map((duel) => duel.id)).toEqual(["dk-weevil", "dk-mako", "dk-mai"]);
  });

  it("refuse une carte inconnue, hors pool, un deck trop court, un prérequis manquant, une règle inconnue", () => {
    const deck: StoryDuel["deck"] = [...weevil.deck.slice(1), [1, 1], [ANIME, 1]];
    expect(validateStory(storyWith({ deck, requires: ["dk-absent"], rules: { lp: 0, hand: 5, special: ["battle-city"] } }))).toEqual([
      "dk-weevil : carte 1 absente de BabelCDB",
      "dk-weevil : carte 511002621 hors pool et hors liste blanche de l'histoire",
      "dk-weevil : LP de départ invalides : 0",
      "dk-weevil : règle spéciale inconnue : battle-city",
      "dk-weevil : prérequis dk-absent inconnu ou placé après",
    ]);
    expect(validateStory(storyWith({ deck: weevil.deck.slice(2) }))).toEqual(["dk-weevil : deck de 35 cartes, 40 à 60 attendues"]);
    expect(validateStory(storyWith({ rewards: { cards: [ANIME] } }, [ANIME]))).toEqual(["dk-weevil : carte offerte 511002621 hors pool"]);
  });

  it("accepte une carte anime de la liste blanche de l'histoire dans le deck adverse", () => {
    const deck: StoryDuel["deck"] = [...weevil.deck.slice(1), [89091579, 1], [ANIME, 1]];
    expect(validateStory(storyWith({ deck }, [ANIME]))).toEqual([]);
  });

  it("déverrouille chaque duel quand ses prérequis sont gagnés, la conclusion seulement une fois gagné", () => {
    const statuses = (done: string[]) => storyView(new Set(done))[0].duels.map((duel) => duel.status);
    expect(statuses([])).toEqual(["available", "locked", "locked"]);
    expect(statuses(["dk-weevil"])).toEqual(["done", "available", "locked"]);
    expect(statuses(["dk-weevil", "dk-mako", "dk-mai"])).toEqual(["done", "done", "done"]);
    const [first, second] = storyView(new Set(["dk-weevil"]))[0].duels;
    expect(first).toMatchObject({ opponent: "Weevil Underwood", lp: 2000, hand: 5, special: ["duelist-kingdom"], outro: weevil.outro });
    expect(second.outro).toBeUndefined();
    expect(second).not.toHaveProperty("deck");
  });
});

describe("règles du Royaume des Duellistes", () => {
  it("chaque duel de l'histoire va au bout bot contre bot, sans attaque directe", { timeout: 120_000 }, async () => {
    for (const duel of [weevil, mako, mai]) {
      const rules = storyRules(duel);
      for (let seed = 1n; seed <= 5n; seed++) {
        const bots = [0, 1].map((seat) => new Bot(seat as 0 | 1, rules.lp, [YUGI.length + 1, 40], 0));
        const state = await runDuel([seed, 2n, 3n, 4n], 500, bots.map((bot): Player => (question, log) => bot.answer(question, log)), [YUGI, storyDeck(duel)], rules);
        expect(state.winner, `${duel.id} seed ${seed}`).not.toBeNull();
        expect(state.errors).toEqual([]);
        expect(state.scripts).toContain("c511002621.lua");
        expect(state.log.filter((line) => line.includes("directement"))).toEqual([]);
      }
    }
  });
});

describe("duel d'histoire sur le serveur", () => {
  type Received = Wire<ServerMessage>;
  const won: string[] = [];
  const completed = new Set<string>();
  const accounts = fakeAccounts({
    storyProgress: async () => completed,
    completeStory: async (_userId, duel) => {
      won.push(duel.id);
      const first = !completed.has(duel.id);
      completed.add(duel.id);
      return first ? duel.rewards : undefined;
    },
  });

  async function play(seed: bigint, send: (socket: WebSocket, received: Received[]) => void) {
    const wss = startServer(0, accounts, () => [seed, 2n, 3n, 4n], 0);
    onTestFinished(() => wss.close());
    await once(wss, "listening");
    const socket = new WebSocket(`ws://localhost:${(wss.address() as AddressInfo).port}`);
    const received: Received[] = [];
    socket.on("message", (data) => {
      const msg: Received = JSON.parse(String(data));
      received.push(msg);
      // respond() reads no bigint field for the questions of these decks, so the wire form works as is.
      const response = msg.type === "question" ? respond(msg.question as unknown as OcgMessage) : undefined;
      if (response) socket.send(JSON.stringify({ type: "respond", response } satisfies ClientMessage));
    });
    await once(socket, "open");
    socket.send(JSON.stringify({ type: "auth", token: "yugi" } satisfies ClientMessage));
    send(socket, received);
    return received;
  }
  const story = (socket: WebSocket, msg: ClientMessage) => socket.send(JSON.stringify(msg));
  const messages = (received: Received[]) => received.flatMap((msg) => (msg.type === "messages" ? msg.messages : []));

  it("refuse un duel verrouillé ou inconnu et envoie la progression", async () => {
    const received = await play(1n, (socket) => {
      story(socket, { type: "story_duel", duel: "dk-mako" });
      story(socket, { type: "story_duel", duel: "dk-absent" });
      story(socket, { type: "story" });
    });
    await vi.waitFor(() => expect(received.at(-1)?.type).toBe("story"));
    expect(received.slice(1)).toEqual([
      { type: "error", error: "duel verrouillé : gagnez d'abord les duels précédents" },
      { type: "error", error: "duel d'histoire inconnu" },
      { type: "story", arcs: storyView(new Set()) },
    ]);
  });

  it("joue un duel complet contre le bot aux règles de l'île, enregistre la victoire, rien de plus au second passage", { timeout: 60_000 }, async () => {
    const finished = (received: Received[]) => received.some((msg) => msg.type === "story_won");
    // With seed 11 the first valid option beats the bot on this duel: pick another seed if the bot changes.
    const first = await play(11n, (socket) => story(socket, { type: "story_duel", duel: "dk-weevil" }));
    await vi.waitFor(() => expect(finished(first)).toBe(true), { timeout: 25_000 });
    expect(first).toContainEqual(expect.objectContaining({ type: "joined", seat: 0, lp: 2000, decks: [41, 40] }));
    expect(messages(first)).toContainEqual(expect.objectContaining({ type: OcgMessageType.WIN, player: 0 }));
    expect(first).toContainEqual({ type: "story_won", duel: "dk-weevil", outro: weevil.outro, rewards: { boosters: 1 } });
    // The rule agreement is answered by the server, never asked to the player.
    const agreement = String((4014n << 20n) | 6n);
    expect(first.filter((msg) => msg.type === "question" && "description" in msg.question && msg.question.description === agreement)).toEqual([]);

    const again = await play(11n, (socket) => story(socket, { type: "story_duel", duel: "dk-weevil" }));
    await vi.waitFor(() => expect(finished(again)).toBe(true), { timeout: 25_000 });
    expect(again).toContainEqual({ type: "story_won", duel: "dk-weevil", outro: weevil.outro, rewards: null });
    expect(won).toEqual(["dk-weevil", "dk-weevil"]);
  });
});
