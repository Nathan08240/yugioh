import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import { Bot } from "../src/bot.ts";
import { runDuel, type Player } from "../src/duel.ts";
import { isAllowed, WHITELIST } from "../src/pool.ts";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { startServer } from "../src/server.ts";
import { isUnlocked, playerDeck, STORY, storyDeck, storyExtra, storyRules, storyView, validateStory, type StoryDuel } from "../src/story.ts";
import { fakeAccounts } from "./fakes.ts";

const arc = STORY.arcs.find((candidate) => candidate.id === "parcours-kaiba");
const duels: StoryDuel[] = arc?.duels ?? [];
const finales = STORY.arcs.find((candidate) => candidate.id === "battle-city-finales")?.duels.map((duel) => duel.id) ?? [];
const BLUE_EYES = 89631139;

describe("parcours de Seto Kaiba", () => {
  it("compte 5 ou 6 duels joués avec le deck de Kaiba, cartes du pool des sets uniquement, 40 à 60 cartes", () => {
    expect(duels.length).toBeGreaterThanOrEqual(5);
    expect(duels.length).toBeLessThanOrEqual(6);
    for (const duel of duels) {
      const deck = playerDeck(duel);
      expect(duel.player?.name, duel.id).toBe("Seto Kaiba");
      expect(deck?.main.length, duel.id).toBeGreaterThanOrEqual(40);
      expect(deck?.main.length, duel.id).toBeLessThanOrEqual(60);
      expect(deck?.main.filter((code) => code === BLUE_EYES)).toHaveLength(3);
      for (const code of [...(deck?.main ?? []), ...(deck?.extra ?? [])]) expect(isAllowed(code) && !WHITELIST.has(code), `${duel.id} ${code}`).toBe(true);
    }
    expect(duels.map((duel) => duel.opponent)).not.toContain("Ishizu");
  });

  it("refuse un deck imposé trop court, avec une carte anime ou sans nom", () => {
    const [first] = duels;
    const player = { name: " ", deck: [[89631139, 3], [511002621, 1]] as [number, number][] };
    const story = { version: 1, anime: [511002621], arcs: [{ id: "arc", title: "Arc", duels: [{ ...first, requires: [], player }] }] };
    expect(validateStory(story)).toEqual([
      "kb-yugi : deck imposé : deck de 4 cartes, 40 à 60 attendues",
      "kb-yugi : deck imposé : carte 511002621 hors pool et hors liste blanche de l'histoire",
      "kb-yugi : deck imposé : nom vide",
    ]);
  });

  it("se débloque une fois les finales de Battle City terminées", () => {
    const [first] = duels;
    expect(first.requires).toEqual(["battle-city-finales"]);
    expect(isUnlocked(first, new Set(finales.slice(0, -1)))).toBe(false);
    expect(isUnlocked(first, new Set(finales))).toBe(true);
    const view = storyView(new Map(finales.map((id) => [id, 1]))).find((candidate) => candidate.id === "parcours-kaiba");
    expect(view?.duels[0]).toMatchObject({ status: "available", player: first.player });
  });

  it("chaque duel va au bout bot contre bot avec le deck imposé, sans erreur", { timeout: 300_000 }, async () => {
    for (const duel of duels) {
      const rules = storyRules(duel);
      const deck = playerDeck(duel) ?? { main: [], extra: [] };
      const sizes = [deck.main.length + rules.cards.length, storyDeck(duel).length];
      const extras = [deck.extra.length, storyExtra(duel).length];
      for (let seed = 1n; seed <= 2n; seed++) {
        const players = ([0, 1] as const).map((seat): Player => {
          const bot = new Bot(seat, rules.lp, sizes, 0, extras);
          return (question, log) => bot.answer(question, log);
        });
        const state = await runDuel([seed, 2n, 3n, 4n], 500, players, [deck.main, storyDeck(duel)], rules, [deck.extra, storyExtra(duel)]);
        expect(state.winner, `${duel.id} seed ${seed}`).not.toBeNull();
        expect(state.errors, `${duel.id} seed ${seed}`).toEqual([]);
      }
    }
  });
});

describe("duel au deck imposé sur le serveur", () => {
  type Received = Wire<ServerMessage>;

  // A player without an active deck: only the imposed deck lets them in.
  async function play(done: string[]) {
    const accounts = fakeAccounts({ activeDeck: async () => undefined, storyProgress: async () => new Map(done.map((id) => [id, 1])) });
    const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n], 0);
    onTestFinished(() => wss.close());
    await once(wss, "listening");
    const socket = new WebSocket(`ws://localhost:${(wss.address() as AddressInfo).port}`);
    onTestFinished(() => socket.close());
    const received: Received[] = [];
    socket.on("message", (data) => received.push(JSON.parse(String(data))));
    await once(socket, "open");
    for (const msg of [{ type: "auth", token: "seto" }, { type: "story_duel", duel: duels[0].id }] satisfies ClientMessage[]) socket.send(JSON.stringify(msg));
    await vi.waitFor(() => expect(received.some((msg) => msg.type === "joined" || msg.type === "error")).toBe(true));
    return received;
  }

  it("lance le duel avec le deck de Kaiba sans deck actif, refuse avant la fin des finales de Battle City", async () => {
    const [first] = duels;
    const joined = await play(finales);
    expect(joined).toContainEqual(expect.objectContaining({ type: "joined", seat: 0, decks: [(playerDeck(first)?.main.length ?? 0) + storyRules(first).cards.length, storyDeck(first).length], opponent: first.opponent }));
    expect(joined.filter((msg) => msg.type === "error")).toEqual([]);

    const locked = await play(finales.slice(0, -1));
    expect(locked).toContainEqual({ type: "error", error: "duel verrouillé : gagnez d'abord les duels précédents" });
  });
});
