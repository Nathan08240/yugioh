import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import { Bot } from "../src/bot.ts";
import { YUGI } from "../src/decks.ts";
import { openDuel, runDuel, type Player } from "../src/duel.ts";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { startServer } from "../src/server.ts";
import { isUnlocked, STORY, STORY_DUELS, storyDeck, storyExtra, storyRules, storyStars, storyView, validateStory, type Story, type StoryDuel } from "../src/story.ts";
import { fakeAccounts } from "./fakes.ts";

const DK = ["dk-weevil", "dk-mako", "dk-mai", "dk-keith", "dk-bakura", "dk-kaiba", "dk-pegasus"];
const [weevil, mako, mai] = DK.slice(0, 3).map((id) => STORY_DUELS.get(id) as StoryDuel);
// "Duelist Kingdom", an unofficial card outside the pool.
const ANIME = 511002621;

const storyWith = (duel: Partial<StoryDuel>, anime: number[] = []): Story => ({ version: 1, anime, arcs: [{ id: "arc", title: "Arc", duels: [{ ...weevil, ...duel }] }] });

describe("données du mode Histoire", () => {
  it("valide l'histoire livrée : cartes dans BabelCDB et autorisées, prérequis, règles, récompenses", () => {
    expect(validateStory(STORY)).toEqual([]);
    expect(STORY.arcs[0].duels.filter((duel) => !duel.optional).map((duel) => duel.id)).toEqual(DK);
  });

  it("refuse une carte inconnue, hors pool, un deck trop court, un prérequis manquant, une règle inconnue", () => {
    const deck: StoryDuel["deck"] = [...weevil.deck.slice(1), [1, 1], [ANIME, 1]];
    expect(validateStory(storyWith({ deck, requires: ["dk-absent"], rules: { lp: 0, hand: 5, special: ["turbo-duel"] } }))).toEqual([
      "dk-weevil : carte 1 absente de BabelCDB",
      "dk-weevil : carte 511002621 hors pool et hors liste blanche de l'histoire",
      "dk-weevil : LP de départ invalides : 0",
      "dk-weevil : règle spéciale inconnue : turbo-duel",
      "dk-weevil : prérequis dk-absent inconnu ou placé après",
    ]);
    expect(validateStory(storyWith({ deck: weevil.deck.slice(2) }))).toEqual(["dk-weevil : deck de 35 cartes, 40 à 60 attendues"]);
    expect(validateStory(storyWith({ rewards: { cards: [ANIME] } }, [ANIME]))).toEqual(["dk-weevil : carte offerte 511002621 hors pool"]);
  });

  it("accepte un extra deck de fusions facultatif, refuse plus de 15 cartes ou un monstre qui n'est pas une fusion", () => {
    const swordsman = 45231177;
    expect(storyExtra(weevil)).toEqual([]);
    expect(validateStory(storyWith({ extra: [[swordsman, 3]] }))).toEqual([]);
    expect(storyExtra({ ...weevil, extra: [[swordsman, 2]] })).toEqual([swordsman, swordsman]);
    expect(validateStory(storyWith({ extra: [[swordsman, 3], [1, 1], [46986414, 1]] }))).toEqual([
      "dk-weevil : carte 1 absente de BabelCDB",
      "dk-weevil : 46986414 n'est pas une fusion, extra deck refusé",
    ]);
    expect(validateStory(storyWith({ extra: [[swordsman, 16]] }))).toEqual(["dk-weevil : extra deck de plus de 15 cartes"]);
  });

  it("accepte une carte anime de la liste blanche de l'histoire dans le deck adverse", () => {
    const deck: StoryDuel["deck"] = [...weevil.deck.slice(1), [89091579, 1], [ANIME, 1]];
    expect(validateStory(storyWith({ deck }, [ANIME]))).toEqual([]);
  });

  it("déverrouille chaque duel quand ses prérequis sont gagnés, la conclusion seulement une fois gagné", () => {
    const statuses = (done: string[]) =>
      storyView(new Map(done.map((id) => [id, 1])))[0]
        .duels.filter((duel) => !duel.optional)
        .map((duel) => duel.status);
    expect(statuses([])).toEqual(["available", ...DK.slice(1).map(() => "locked")]);
    expect(statuses(["dk-weevil"])).toEqual(["done", "available", ...DK.slice(2).map(() => "locked")]);
    expect(statuses(DK)).toEqual(DK.map(() => "done"));
    const [first, second] = storyView(new Map([["dk-weevil", 2]]))[0].duels;
    expect(first).toMatchObject({ opponent: "Weevil Underwood", lp: 2000, hand: 5, special: ["duelist-kingdom"], outro: weevil.outro, stars: 2 });
    expect(second.outro).toBeUndefined();
    expect(second.stars).toBe(0);
    expect(second).not.toHaveProperty("deck");
  });

  it("donne 1 étoile en facile, 2 en normal, 3 en normal avec au moins la moitié des LP de départ", () => {
    expect(storyStars(true, 8000, 4000)).toBe(1);
    expect(storyStars(false, 1999, 4000)).toBe(2);
    expect(storyStars(false, 2000, 4000)).toBe(3);
    expect(storyStars(false, 1000, 2001)).toBe(2);
  });

  it("déverrouille un arc une fois tous les duels de l'arc précédent gagnés, jamais un arc placé après", () => {
    const withArc = (requires: string[]): Story => ({
      ...STORY,
      arcs: [STORY.arcs[0], { id: "suite", title: "Suite", duels: [{ ...weevil, id: "suite-1", requires, rewards: {} }] }],
    });
    const story = withArc([STORY.arcs[0].id]);
    const [next] = story.arcs[1].duels;
    const previous = STORY.arcs[0].duels.map((duel) => duel.id);
    expect(validateStory(story)).toEqual([]);
    expect(isUnlocked(next, new Set(previous.slice(0, -1)), story)).toBe(false);
    expect(isUnlocked(next, new Set(previous), story)).toBe(true);
    expect(validateStory(withArc(["suite"]))).toContainEqual(expect.stringContaining("prérequis suite inconnu ou placé après"));
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

describe("difficulté des duels d'histoire", () => {
  const startingLp = async (level?: "normal" | "facile") => {
    const { lib, handle } = await openDuel([1n, 2n, 3n, 4n], [YUGI, storyDeck(weevil)], vi.fn(), undefined, storyRules(weevil, level), [[], []]);
    return lib.duelQueryField(handle).players.map((player) => (player as typeof player & { lp: number }).lp);
  };

  it("double les LP de départ du joueur en facile, ceux de l'adversaire restent inchangés", async () => {
    expect(await startingLp()).toEqual([weevil.rules.lp, weevil.rules.lp]);
    expect(await startingLp("normal")).toEqual([weevil.rules.lp, weevil.rules.lp]);
    expect(await startingLp("facile")).toEqual([weevil.rules.lp * 2, weevil.rules.lp]);
    expect(storyRules(weevil, "facile")).toMatchObject({ hand: weevil.rules.hand, cards: storyRules(weevil).cards });
  });
});

describe("duel d'histoire sur le serveur", () => {
  type Received = Wire<ServerMessage>;
  const won: [string, number][] = [];
  const completed = new Map<string, number>();
  const accounts = fakeAccounts({
    storyProgress: async () => completed,
    completeStory: async (_userId, duel, stars) => {
      won.push([duel.id, stars]);
      const first = !completed.has(duel.id);
      completed.set(duel.id, stars);
      return first ? { rewards: duel.rewards, stars, best: stars, starBooster: false } : { rewards: null, stars, best: stars, starBooster: false, replays: 1 };
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
      { type: "story", arcs: storyView(new Map()) },
    ]);
  });

  it("en facile, le joueur voit ses LP doublés et ceux de l'adversaire, et la victoire est enregistrée", { timeout: 60_000 }, async () => {
    won.length = 0;
    completed.clear();
    const received = await play(10n, (socket) => story(socket, { type: "story_duel", duel: "dk-weevil", level: "facile" }));
    await vi.waitFor(() => expect(received.some((msg) => msg.type === "story_won")).toBe(true), { timeout: 25_000 });
    expect(received).toContainEqual(expect.objectContaining({ type: "joined", seat: 0, lp: weevil.rules.lp * 2, opponentLp: weevil.rules.lp }));
    expect(received).toContainEqual({ type: "story_won", duel: "dk-weevil", outro: weevil.outro, rewards: weevil.rewards, stars: 1, best: 1, starBooster: false });
    expect(won).toEqual([["dk-weevil", 1]]);
    won.length = 0;
    completed.clear();
  });

  it("refuse un niveau inconnu", async () => {
    const received = await play(1n, (socket) => socket.send(JSON.stringify({ type: "story_duel", duel: "dk-weevil", level: "divin" })));
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(1));
    expect(received.slice(1)).toEqual([{ type: "error", error: "message invalide" }]);
  });

  it("joue un duel complet contre le bot aux règles de l'île, enregistre la victoire, rien de plus au second passage", { timeout: 60_000 }, async () => {
    const finished = (received: Received[]) => received.some((msg) => msg.type === "story_won");
    // Seed 10 wins at "normal" with 400 LP of 2000 left: 2 stars.
    const STARS = 2;
    // With seed 10 the first valid option beats the bot on this duel: pick another seed if the bot changes.
    const first = await play(10n, (socket) => story(socket, { type: "story_duel", duel: "dk-weevil" }));
    await vi.waitFor(() => expect(finished(first)).toBe(true), { timeout: 25_000 });
    expect(first).toContainEqual(expect.objectContaining({ type: "joined", seat: 0, lp: 2000, decks: [41, 40], opponent: weevil.opponent }));
    expect(messages(first)).toContainEqual(expect.objectContaining({ type: OcgMessageType.WIN, player: 0 }));
    expect(first).toContainEqual({ type: "story_won", duel: "dk-weevil", outro: weevil.outro, rewards: { boosters: 1 }, stars: STARS, best: STARS, starBooster: false });
    // The rule agreement is answered by the server, never asked to the player.
    const agreement = String((4014n << 20n) | 6n);
    expect(first.filter((msg) => msg.type === "question" && "description" in msg.question && msg.question.description === agreement)).toEqual([]);

    const again = await play(10n, (socket) => story(socket, { type: "story_duel", duel: "dk-weevil" }));
    await vi.waitFor(() => expect(finished(again)).toBe(true), { timeout: 25_000 });
    expect(again).toContainEqual({ type: "story_won", duel: "dk-weevil", outro: weevil.outro, rewards: null, stars: STARS, best: STARS, starBooster: false, replays: 1 });
    expect(won).toEqual([["dk-weevil", STARS], ["dk-weevil", STARS]]);
  });
});
