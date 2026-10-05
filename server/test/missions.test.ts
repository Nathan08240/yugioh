import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import { KAIBA, YUGI } from "../src/decks.ts";
import { openDuel, STANDARD_RULES } from "../src/duel.ts";
import { countEvents, dailyMissions, duelGains, fusionOnField, MISSIONS, missionsOf, NO_GAINS, newTally, rewardsDue, type MissionProgress } from "../src/missions.ts";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { startServer } from "../src/server.ts";
import { fakeAccounts } from "./fakes.ts";

const FLAME_SWORDSMAN = 45231177;
const duel = { won: true, forfeit: false, story: false, ranked: false, summons: 6, damage: 3200, fusion: true };
const facts = { today: NO_GAINS, wins: 0, owned: new Set<number>(), story: new Set<string>() };

describe("missions du jour", () => {
  it("tire 3 missions différentes par joueur et par jour, toujours les mêmes ce jour-là", () => {
    const today = dailyMissions("yugi", "2026-10-02");
    expect(new Set(today.map((mission) => mission.id)).size).toBe(3);
    expect(dailyMissions("yugi", "2026-10-02")).toEqual(today);
    const days = Array.from({ length: 10 }, (_, day) => dailyMissions("yugi", `2026-10-${10 + day}`).map((mission) => mission.id).join());
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it("une victoire par abandon ne compte que la victoire, le perdant garde ce qu'il a fait", () => {
    expect(duelGains(duel)).toEqual({ wins: 1, fusionWins: 1, summons: 6, damage: 3200, storyWins: 0, ranked: 0, boosters: 0 });
    expect(duelGains({ ...duel, forfeit: true })).toEqual({ ...NO_GAINS, wins: 1 });
    expect(duelGains({ ...duel, won: false, forfeit: true, ranked: true })).toEqual({ ...NO_GAINS, summons: 6, damage: 3200, ranked: 1 });
    expect(duelGains({ ...duel, story: true, fusion: false })).toMatchObject({ wins: 1, storyWins: 1, fusionWins: 0 });
  });

  it("compte les invocations de chaque joueur et les dégâts qu'il inflige", () => {
    const tally = newTally();
    const events = [
      { type: OcgMessageType.SUMMONING, controller: 0 },
      { type: OcgMessageType.SPSUMMONING, controller: 0 },
      { type: OcgMessageType.FLIPSUMMONING, controller: 1 },
      { type: OcgMessageType.DAMAGE, player: 1, amount: 1200 },
      { type: OcgMessageType.DAMAGE, player: 1, amount: 800 },
      { type: OcgMessageType.PAY_LPCOST, player: 0, amount: 1000 },
    ] as OcgMessage[];
    countEvents(tally, events);
    expect(tally).toEqual({ summons: [2, 1], damage: [2000, 0] });
  });

  it("voit un monstre Fusion sur le terrain du joueur, pas sur celui de l'adversaire", async () => {
    const field = [{ code: FLAME_SWORDSMAN, controller: 0 as const, location: OcgLocation.MZONE, sequence: 2, position: OcgPosition.FACEUP_ATTACK }];
    const opened = await openDuel([1n, 2n, 3n, 4n], [YUGI, KAIBA], () => {}, undefined, STANDARD_RULES, [], field);
    onTestFinished(() => opened.lib.destroyDuel(opened.handle));
    expect([fusionOnField(opened, 0), fusionOnField(opened, 1)]).toEqual([true, false]);
  });

  it("verse chaque mission atteinte, le booster une fois les 3 faites, et les succès", () => {
    const partial = missionsOf("yugi", "2026-10-02", { ...facts, wins: 1, today: { ...NO_GAINS, wins: 1 } });
    const firstWin = ["succes:premiere_victoire", { points: 100 }];
    expect(rewardsDue(partial, "2026-10-02")).toContainEqual(firstWin);
    expect(rewardsDue(partial, "2026-10-02").map(([key]) => key)).not.toContain("mission:2026-10-02:bonus");

    const all = { wins: 3, fusionWins: 1, summons: 9, damage: 5000, storyWins: 1, ranked: 1, boosters: 2 };
    const done = missionsOf("yugi", "2026-10-02", { ...facts, today: all, owned: new Set([511600399]) });
    expect(done.missions.every((mission) => mission.progress === mission.goal)).toBe(true);
    const due = rewardsDue(done, "2026-10-02");
    for (const mission of done.missions) expect(due).toContainEqual([`mission:2026-10-02:${mission.id}`, { points: MISSIONS.find(({ id }) => id === mission.id)?.points }]);
    expect(due).toContainEqual(["mission:2026-10-02:bonus", { boosters: 1 }]);
    expect(due).toContainEqual(["succes:dieu_egyptien", { points: 200 }]);
    expect(done.achievements.find(({ id }) => id === "cent_victoires")).toMatchObject({ progress: 0, goal: 100 });
  });
});

describe("missions sur le serveur de partie", () => {
  async function setup() {
    const progress: [string, MissionProgress][] = [];
    const view = { missions: [{ id: "victoire", text: "Gagner un duel", progress: 0, goal: 1, reward: { points: 30 } }], achievements: [] };
    const accounts = fakeAccounts({
      openBooster: async () => [{ code: 1, rarity: "common" }],
      missions: async () => view,
      progressMissions: async (userId, update) => {
        progress.push([userId, update]);
        return view;
      },
    });
    const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n], 0);
    onTestFinished(() => wss.close());
    await once(wss, "listening");
    const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
    async function connect(user: string) {
      const socket = new WebSocket(url);
      const received: Wire<ServerMessage>[] = [];
      socket.on("message", (data) => {
        const msg: Wire<ServerMessage> = JSON.parse(String(data));
        received.push(msg);
        const response = msg.type === "question" ? respond(msg.question as unknown as OcgMessage) : undefined;
        if (response) socket.send(JSON.stringify({ type: "respond", response } satisfies ClientMessage));
      });
      await once(socket, "open");
      const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
      send({ type: "auth", token: user });
      return { received, send };
    }
    return { progress, view, connect };
  }

  it("répond à missions, compte l'ouverture d'un booster et renvoie les missions", async () => {
    const { progress, view, connect } = await setup();
    const player = await connect("mis-booster");
    player.send({ type: "missions" });
    await vi.waitFor(() => expect(player.received).toContainEqual({ type: "missions", ...view }));
    player.send({ type: "open_booster", set: "LOB" });
    await vi.waitFor(() => expect(progress).toEqual([["mis-booster", { gains: { boosters: 1 } }]]));
    await vi.waitFor(() => expect(player.received.filter((msg) => msg.type === "missions")).toHaveLength(2));
  });

  it("en ligne, un abandon ne donne que la victoire au gagnant et chacun est compté une fois par adversaire", { timeout: 30_000 }, async () => {
    const { progress, connect } = await setup();
    const a = await connect("mis-a");
    a.send({ type: "create" });
    await vi.waitFor(() => expect(a.received.find((msg) => msg.type === "joined")).toBeDefined());
    const b = await connect("mis-b");
    b.send({ type: "join", room: (a.received.find((msg) => msg.type === "joined") as { room: string }).room });
    await vi.waitFor(() => expect([...a.received, ...b.received].some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    a.send({ type: "surrender" });
    await vi.waitFor(() => expect(progress).toHaveLength(2));
    expect(Object.fromEntries(progress)).toEqual({
      "mis-a": { gains: expect.objectContaining({ wins: 0, fusionWins: 0 }), opponent: "mis-b" },
      "mis-b": { gains: { ...NO_GAINS, wins: 1 }, opponent: "mis-a" },
    });
  });

  it("contre le bot, le duel compte sans adversaire à vérifier", { timeout: 30_000 }, async () => {
    const { progress, connect } = await setup();
    const human = await connect("mis-bot");
    human.send({ type: "bot" });
    await vi.waitFor(() => expect(human.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    human.send({ type: "surrender" });
    await vi.waitFor(() => expect(progress).toHaveLength(1));
    expect(progress[0]).toEqual(["mis-bot", { gains: expect.objectContaining({ wins: 0, ranked: 0, storyWins: 0 }) }]);
  });
});
