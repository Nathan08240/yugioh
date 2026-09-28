import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgMessageType, OcgProcessResult, OcgResponseType, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Bot } from "../src/bot.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { POOL } from "../src/pool.ts";
import type { CardInfo, ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { advance, creditWinner, startServer, type Accounts, type Room } from "../src/server.ts";

const FLAME_SWORDSMAN = 45231177;

type Received = Wire<ServerMessage>;
type Answer = (question: OcgMessage, retry: boolean) => OcgResponse | undefined;

// Active decks, keyed by user id: preset for the usual test users, "sansdeck" never gets one.
const decks = new Map<string, number[]>([["alice", YUGI], ["bob", KAIBA], ["carol", YUGI], ["dave", YUGI], ["eve", YUGI]]);
// Extra decks, empty unless a test sets one.
const extras = new Map<string, number[]>();

// Token "jeton-<id>" identifies user <id>; "nouveau" has no profile yet and "pris" is a taken pseudo.
const accounts: Accounts = {
  verify: async (token) => (token.startsWith("jeton-") ? token.slice(6) : null),
  findProfile: async (userId) => (userId === "nouveau" ? undefined : { userId, pseudo: userId, activeDeckId: decks.has(userId) ? 1 : null }),
  createProfile: async (userId, pseudo) => (pseudo === "pris" ? undefined : { userId, pseudo, activeDeckId: null }),
  activeDeck: async (userId) => {
    const main = decks.get(userId);
    return main && { main, extra: extras.get(userId) ?? [] };
  },
  chooseStarter: async (userId, starter) => {
    if (decks.has(userId)) return false;
    decks.set(userId, starter === "yugi" ? YUGI : KAIBA);
    return true;
  },
  collection: async () => [],
  decks: async () => ({ decks: [], active: null }),
  saveDeck: async () => ({ error: "non simulé" }),
  deleteDeck: async () => false,
  activateDeck: async () => false,
  boosterState: async () => ({ nextFreeAt: new Date(0).toISOString(), pending: 0 }),
  // "sansdroit" a un profil mais aucun droit d'ouverture ; le set "ZZZ" n'existe pas.
  openBooster: async (userId, set) => {
    if (set === "ZZZ") throw new Error(`booster inconnu : ${set}`);
    if (userId === "sansdroit") throw new Error("aucun booster disponible");
    return [{ code: 1, rarity: "common" }];
  },
  creditBoosters: async () => {},
  storyProgress: async () => new Set(),
  completeStory: async () => undefined,
};
const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n]);
await once(wss, "listening");
const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
afterAll(() => wss.close());

// A client logged in as `user` (if any) that records everything and answers its questions with `answer`
// (undefined keeps the question pending).
async function connect(user?: string, answer: Answer = (question) => respond(question)) {
  const socket = new WebSocket(url);
  const received: Received[] = [];
  socket.on("message", (data) => {
    const msg: Received = JSON.parse(String(data));
    received.push(msg);
    // respond() reads no bigint field, so the wire form of a question works as is.
    const response = msg.type === "question" ? answer(msg.question as unknown as OcgMessage, msg.retry) : undefined;
    if (response) socket.send(JSON.stringify({ type: "respond", response } satisfies ClientMessage));
  });
  await once(socket, "open");
  const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
  if (user) send({ type: "auth", token: `jeton-${user}` });
  const messages = () => received.flatMap((msg) => (msg.type === "messages" ? msg.messages : []));
  return { socket, received, send, messages };
}

const joined = (received: Received[]) => received.find((msg): msg is Extract<Received, { type: "joined" }> => msg.type === "joined");

describe("serveur de partie", () => {
  it("joue un duel à deux sans fuite d'information cachée, avec reconnexion", { timeout: 30_000 }, async () => {
    let setCode = 0;
    let retried = false;
    // A sends a wrong answer once, then sets a monster face down at the first chance.
    const a = await connect("alice", (question, retry) => {
      if (question.type !== OcgMessageType.SELECT_IDLECMD || setCode) return respond(question);
      if (!retried && !retry) {
        retried = true;
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 99 };
      }
      if (question.monster_sets.length === 0) return respond(question);
      setCode = question.monster_sets[0].code;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: 0 };
    });
    a.send({ type: "create" });
    await vi.waitFor(() => expect(joined(a.received)).toBeDefined());
    const room = joined(a.received)?.room ?? "";

    // B stops answering once A's monster is set, so the duel waits on B.
    let held: OcgMessage | undefined;
    const b = await connect("bob", (question) => {
      if (!b.messages().some((msg) => msg.type === OcgMessageType.SET && msg.controller === 0)) return respond(question);
      held = question;
      return undefined;
    });
    b.send({ type: "join", room });
    await vi.waitFor(() => expect(held).toBeDefined(), { timeout: 20_000 });

    expect(a.received).toContainEqual(expect.objectContaining({ type: "question", retry: true }));
    expect(a.messages()).toContainEqual(expect.objectContaining({ type: OcgMessageType.MOVE, card: setCode }));
    expect(b.messages()).toContainEqual(expect.objectContaining({ type: OcgMessageType.SET, controller: 0, code: 0 }));
    for (const msg of b.messages()) if (msg.type === OcgMessageType.DRAW && msg.player === 0) expect(msg.drawn.every((card) => card.code === 0)).toBe(true);
    expect(JSON.stringify(b.received)).not.toContain(String(setCode));
    for (const msg of b.received) if (msg.type === "question") expect(msg.question).toMatchObject({ player: 1 });

    // B reconnects with the same identity: same visible history, same pending question.
    b.socket.close();
    const b2 = await connect("bob");
    b2.send({ type: "join", room });
    await vi.waitFor(() => expect(b2.messages().length).toBeGreaterThan(0));
    expect(joined(b2.received)).toEqual({ type: "joined", room, seat: 1, lp: 4000, decks: [40, 40], extras: [0, 0], log: b.messages() });
    expect(b2.received).toContainEqual({ type: "question", question: held, retry: false });
  });

  it("une salle dont le moteur lève une erreur est fermée, une autre salle continue de jouer", () => {
    type Duel = NonNullable<Room["duel"]>;
    const fakeDuel = (lib: Partial<Duel["lib"]>): Duel => ({ lib, handle: 1 }) as unknown as Duel;
    const socket = () => {
      const send = vi.fn();
      return { send, socket: { send } as unknown as WebSocket };
    };

    const destroyDuel = vi.fn();
    const a = socket();
    const b = socket();
    const crashing: Room = {
      code: "CRASH",
      players: [
        { id: "a", socket: a.socket, log: [], deck: [] },
        { id: "b", socket: b.socket, log: [], deck: [] },
      ],
      duel: fakeDuel({
        duelProcess: () => {
          throw new Error("panique moteur");
        },
        duelGetMessage: vi.fn(),
        destroyDuel,
      }),
    };
    advance(crashing);
    expect(crashing.duel).toBeUndefined();
    expect(destroyDuel).toHaveBeenCalledWith(1);
    expect(a.send).toHaveBeenCalledWith(expect.stringContaining('"duel_error"'));
    expect(b.send).toHaveBeenCalledWith(expect.stringContaining('"duel_error"'));

    const question = { type: OcgMessageType.SELECT_YESNO, player: 0, description: 0n, code: 0, data: { location: 0, controller: 0, sequence: 0 } } as unknown as OcgMessage;
    const c = socket();
    const other: Room = {
      code: "OTHER",
      players: [{ id: "c", socket: c.socket, log: [], deck: [] }, { id: "d", socket: socket().socket, log: [], deck: [] }],
      duel: fakeDuel({ duelProcess: vi.fn(() => OcgProcessResult.WAITING), duelGetMessage: vi.fn(() => [question]), destroyDuel: vi.fn() }),
    };
    advance(other);
    expect(other.duel).toBeDefined();
    expect(other.question).toEqual(question);
    expect(c.send).toHaveBeenCalledWith(expect.stringContaining('"question"'));
  });

  it("sert les données des cartes du pool en français et leurs illustrations, pas celles hors pool ou absentes", async () => {
    const http = url.replace("ws:", "http:");
    const cards: Record<string, CardInfo> = await (await fetch(`${http}/api/cards`)).json();
    // The pool, plus the anime cards of the story and its rule cards.
    expect(Object.keys(cards).length).toBeGreaterThanOrEqual(POOL.size);
    expect(cards[511002621]).toMatchObject({ name: "Règles du Royaume des Duellistes", desc: expect.stringContaining("attaque directe") });
    expect(cards[46986414]).toMatchObject({ name: "Magicien Sombre", level: 7, attribute: 32, atk: 2500, def: 2100, image: true });
    expect(cards[46986414]).toMatchObject({ attributeName: "TÉNÈBRES", typeLine: "Magicien / Normal" });
    expect(cards[55144522].desc).toBe("Piochez 2 cartes.");
    const art = await fetch(`${http}/api/art/46986414.jpg`);
    expect(art.status).toBe(200);
    expect(art.headers.get("content-type")).toBe("image/jpeg");
    expect(art.headers.get("cache-control")).toContain("max-age");
    expect((await art.arrayBuffer()).byteLength).toBeGreaterThan(0);
    // Ash Blossom & Joyous Spring: a card outside the pool; 1: no such card.
    expect((await fetch(`${http}/api/art/14558127.jpg`)).status).toBe(404);
    expect((await fetch(`${http}/api/art/1.jpg`)).status).toBe(404);
    expect((await fetch(`${http}/api/art/..%2F..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${http}/api/images/46986414.jpg`)).status).toBe(404);
  });

  it("sert les chaînes système du moteur en français", async () => {
    const http = url.replace("ws:", "http:");
    const strings: Record<string, string> = await (await fetch(`${http}/api/strings`)).json();
    expect(strings[1015]).toBe("TÉNÈBRES");
    expect(strings[31]).toBe("Attaquer Directement?");
  });

  it("utilise le deck actif de chaque joueur pour le duel, pas des decks fixes", async () => {
    decks.set("hote", Array<number>(45).fill(15025844)); // Mystical Elf
    decks.set("invite", Array<number>(50).fill(89631139)); // Blue-Eyes White Dragon

    const host = await connect("hote");
    host.send({ type: "create" });
    await vi.waitFor(() => expect(joined(host.received)).toBeDefined());
    const room = joined(host.received)?.room ?? "";

    const guest = await connect("invite");
    guest.send({ type: "join", room });
    await vi.waitFor(() => expect(joined(guest.received)).toBeDefined());
    expect(joined(guest.received)).toMatchObject({ seat: 1, decks: [45, 50] });
    await vi.waitFor(() => expect(host.messages().length).toBeGreaterThan(0));
  });

  it("annonce la taille de l'extra deck de chaque joueur et le charge dans le duel", async () => {
    decks.set("hote2", YUGI);
    decks.set("invite2", KAIBA);
    extras.set("hote2", [FLAME_SWORDSMAN, FLAME_SWORDSMAN]);
    extras.set("invite2", [FLAME_SWORDSMAN]);

    const host = await connect("hote2");
    host.send({ type: "create" });
    await vi.waitFor(() => expect(joined(host.received)).toBeDefined());
    expect(joined(host.received)).toMatchObject({ seat: 0, decks: [40, 0], extras: [2, 0] });
    const guest = await connect("invite2");
    guest.send({ type: "join", room: joined(host.received)?.room ?? "" });
    await vi.waitFor(() => expect(joined(guest.received)).toMatchObject({ seat: 1, decks: [40, 40], extras: [2, 1] }));
    await vi.waitFor(() => expect(host.received.filter((msg) => msg.type === "joined").at(-1)).toMatchObject({ extras: [2, 1] }));
  });

  it("refuse un deck actif dont l'extra deck a plus de 15 cartes ou une carte qui n'est pas une fusion", async () => {
    decks.set("trop", YUGI);
    extras.set("trop", Array<number>(16).fill(FLAME_SWORDSMAN));
    decks.set("intrus", YUGI);
    extras.set("intrus", [46986414]); // Dark Magician
    const errors: Received[] = [];
    for (const user of ["trop", "intrus"]) {
      const p = await connect(user);
      p.send({ type: "create" });
      await vi.waitFor(() => expect(p.received).toHaveLength(2));
      errors.push(p.received[1]);
    }
    expect(errors).toEqual([
      { type: "error", error: "deck actif invalide" },
      { type: "error", error: "deck actif invalide" },
    ]);
  });

  it("refuse de créer ou rejoindre une salle sans deck actif", async () => {
    const h = await connect("sansdeck");
    h.send({ type: "create" });
    h.send({ type: "join", room: "ZZZZZ" });
    await vi.waitFor(() => expect(h.received).toHaveLength(3));
    expect(h.received).toEqual([
      { type: "profile", pseudo: "sansdeck", needsStarter: true },
      { type: "error", error: "deck actif requis" },
      { type: "error", error: "deck actif requis" },
    ]);
  });

  it("refuse une salle inconnue et une salle complète", async () => {
    const [c, d, e] = await Promise.all([connect("carol"), connect("dave"), connect("eve")]);
    c.send({ type: "join", room: "ZZZZZ" });
    await vi.waitFor(() => expect(c.received).toContainEqual({ type: "error", error: "salle introuvable" }));
    c.send({ type: "create" });
    await vi.waitFor(() => expect(joined(c.received)).toBeDefined());
    const room = joined(c.received)?.room ?? "";
    d.send({ type: "join", room });
    await vi.waitFor(() => expect(joined(d.received)).toBeDefined());
    e.send({ type: "join", room });
    await vi.waitFor(() => expect(e.received).toContainEqual({ type: "error", error: "salle complète" }));
  });

  it("refuse toute action avant authentification et un jeton invalide", async () => {
    const f = await connect();
    f.send({ type: "create" });
    f.send({ type: "respond", response: { type: OcgResponseType.SELECT_YESNO, yes: true } });
    f.send({ type: "auth", token: "faux" });
    f.send({ type: "join", room: "ZZZZZ" });
    await vi.waitFor(() => expect(f.received).toHaveLength(4));
    expect(f.received).toEqual([
      { type: "error", error: "non authentifié" },
      { type: "error", error: "non authentifié" },
      { type: "error", error: "jeton invalide" },
      { type: "error", error: "non authentifié" },
    ]);
  });

  it("authentifie par le jeton et fait choisir un pseudo au premier passage", async () => {
    const known = await connect("carol");
    await vi.waitFor(() => expect(known.received).toEqual([{ type: "profile", pseudo: "carol", needsStarter: false }]));

    const g = await connect("nouveau");
    g.send({ type: "create" });
    g.send({ type: "pseudo", pseudo: "a b" });
    g.send({ type: "pseudo", pseudo: "pris" });
    g.send({ type: "pseudo", pseudo: "Nouveau_1" });
    g.send({ type: "create" });
    g.send({ type: "auth", token: "jeton-autre" });
    g.send({ type: "starter", starter: "yugi" });
    g.send({ type: "create" });
    await vi.waitFor(() => expect(joined(g.received)).toBeDefined());
    expect(g.received.slice(0, 8)).toEqual([
      { type: "profile", pseudo: null, needsStarter: false },
      { type: "error", error: "pseudo à choisir d'abord" },
      { type: "error", error: expect.stringContaining("pseudo invalide") },
      { type: "error", error: "pseudo déjà pris" },
      { type: "profile", pseudo: "Nouveau_1", needsStarter: true },
      { type: "error", error: "deck actif requis" },
      { type: "error", error: "déjà authentifié" },
      { type: "profile", pseudo: "Nouveau_1", needsStarter: false },
    ]);
  });

  it("renvoie l'état des boosters et les cartes d'une ouverture réussie", async () => {
    const p = await connect("carol");
    p.send({ type: "booster_state" });
    p.send({ type: "open_booster", set: "LOB" });
    await vi.waitFor(() => expect(p.received.length).toBeGreaterThanOrEqual(3));
    expect(p.received).toContainEqual({ type: "booster_state", nextFreeAt: new Date(0).toISOString(), pending: 0 });
    expect(p.received).toContainEqual({ type: "booster_opened", set: "LOB", cards: [{ code: 1, rarity: "common" }] });
  });

  it("refuse l'ouverture d'un booster sans droit ou d'un set inconnu", async () => {
    const p = await connect("sansdroit");
    p.send({ type: "open_booster", set: "LOB" });
    p.send({ type: "open_booster", set: "ZZZ" });
    await vi.waitFor(() => expect(p.received.length).toBeGreaterThanOrEqual(3));
    expect(p.received).toContainEqual({ type: "error", error: "aucun booster disponible" });
    expect(p.received).toContainEqual({ type: "error", error: "booster inconnu : ZZZ" });
  });
});

describe("récompense de boosters à la fin d'un duel", () => {
  it("crédite le vainqueur d'un duel en ligne, pas celui d'un duel contre le bot", () => {
    const credited: [string, number][] = [];
    const fakeAccounts: Pick<Accounts, "creditBoosters"> = {
      creditBoosters: async (userId, count) => {
        credited.push([userId, count]);
      },
    };
    const room = (bot?: boolean): Room => ({
      code: "X",
      players: [
        { id: "p0", log: [], deck: [] },
        { id: "p1", log: [], deck: [], bot: bot ? ({} as Bot) : undefined },
      ],
    });

    creditWinner(room(), 1, fakeAccounts);
    creditWinner(room(true), 0, fakeAccounts);

    expect(credited).toEqual([["p1", 1]]);
  });

  it("advance() signale le vainqueur à room.onWin quand le moteur envoie WIN", () => {
    const socket = () => ({ send: vi.fn() }) as unknown as WebSocket;
    const fakeDuel = (messages: OcgMessage[]) =>
      ({ lib: { duelProcess: () => OcgProcessResult.END, duelGetMessage: () => messages, destroyDuel: vi.fn() }, handle: 1 }) as unknown as NonNullable<Room["duel"]>;
    const room: Room = {
      code: "WIN",
      players: [{ id: "p0", socket: socket(), log: [], deck: [] }, { id: "p1", socket: socket(), log: [], deck: [] }],
      duel: fakeDuel([{ type: OcgMessageType.WIN, player: 1, type_win: 0 } as unknown as OcgMessage]),
    };
    const onWin = vi.fn();
    room.onWin = onWin;

    advance(room);

    expect(onWin).toHaveBeenCalledWith(1);
    expect(room.duel).toBeUndefined();
  });
});
