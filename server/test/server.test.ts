import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { OcgMessageType, OcgProcessResult, OcgResponseType, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { WebSocket } from "ws";
import type { Bot } from "../src/bot.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { EMOTE_DELAY } from "../src/emotes.ts";
import { artFile } from "../src/http.ts";
import { POOL, SETS } from "../src/pool.ts";
import { elo } from "../src/ranked.ts";
import type { CardInfo, ClientMessage, ServerMessage, Wire, WonderView } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { WISH_MAX } from "../src/wishlist.ts";
import { drawWonder } from "../src/wonder.ts";
import { advance, creditWinner, DECISION_TIME, RECONNECT_TIME, startServer, towerFloor, type Accounts, type Room } from "../src/server.ts";
import { GOAT_YUGI, noAdmin, noDraft, noMissions, noSealed, noTrades } from "./fakes.ts";

const FLAME_SWORDSMAN = 45231177;

type Received = Wire<ServerMessage>;
type Answer = (question: OcgMessage, retry: boolean) => OcgResponse | undefined;

// Active decks, keyed by user id: preset for the usual test users, "sansdeck" never gets one.
const decks = new Map<string, number[]>([["alice", YUGI], ["bob", KAIBA], ["carol", YUGI], ["dave", YUGI], ["eve", YUGI]]);
// Extra decks, empty unless a test sets one.
const extras = new Map<string, number[]>();
const wishes = new Map<string, Set<number>>();
const wonderDraws = new Map<string, Exclude<WonderView, { status: "available" }>>();
// Classements en mémoire, 1000 par défaut.
const ratings = new Map<string, number>();
const seasonView = {
  rating: 1000,
  games: 7,
  season: "2026-10",
  daysLeft: 31,
  seasonGames: 2,
  leaderboard: [{ pseudo: "alice", avatar: null, rating: 1200, games: 3 }],
  previousSeason: "2026-09",
  previousLeaderboard: [{ pseudo: "bob", avatar: null, rating: 1450, games: 20 }],
  lastResult: { season: "2026-09", rating: 1250, games: 6, boosters: 3 },
};

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
  collection: async () => ({ cards: [], rarities: [], points: 7 }),
  decks: async () => ({ decks: [], active: null }),
  saveDeck: async () => ({ error: "non simulé" }),
  deleteDeck: async () => false,
  activateDeck: async () => false,
  profileCards: async () => ({ avatar: null, favorite: null }),
  setProfileCard: async () => false,
  // Souhaits en mémoire, par joueur.
  wishlist: async (userId) => [...(wishes.get(userId) ?? [])],
  addWish: async (userId, code) => {
    const list = wishes.get(userId) ?? new Set<number>();
    wishes.set(userId, list);
    if (!list.has(code) && list.size >= WISH_MAX) return false;
    list.add(code);
    return true;
  },
  removeWish: async (userId, code) => {
    wishes.get(userId)?.delete(code);
  },
  // Pioche miracle en mémoire : le tirage est celui de la vraie fonction, le choix retient l'index.
  wonder: async (userId) => wonderDraws.get(userId) ?? { status: "available" },
  wonderDraw: async (userId) => {
    if (!wonderDraws.has(userId)) wonderDraws.set(userId, { status: "drawn", cards: drawWonder().cards });
    return wonderDraws.get(userId) as WonderView;
  },
  wonderPick: async (userId, index) => {
    const draw = wonderDraws.get(userId);
    if (!draw) return "aucune pioche miracle en cours";
    if (draw.status === "picked") return "carte déjà choisie";
    const picked: Exclude<WonderView, { status: "available" }> = { status: "picked", cards: draw.cards, shuffle: [4, 3, 2, 1, 0], picked: index };
    wonderDraws.set(userId, picked);
    return picked;
  },
  boosterState: async () => ({ nextFreeAt: new Date(0).toISOString(), pending: 0, ultraIn: 21 }),
  // "sansdroit" a un profil mais aucun droit d'ouverture ; le set "ZZZ" n'existe pas.
  openBooster: async (userId, set) => {
    if (set === "ZZZ") throw new Error(`booster inconnu : ${set}`);
    if (userId === "sansdroit") throw new Error("aucun booster disponible");
    return [{ code: 1, rarity: "common" }];
  },
  creditBoosters: async () => {},
  // "plein" a déjà gagné son plafond de boosters en ligne du jour.
  winOnline: async (userId) => {
    if (userId === "plein") return false;
    await accounts.creditBoosters(userId, 1);
    return true;
  },
  onlineToday: async () => 0,
  storyProgress: async () => new Map(),
  completeStory: async (_userId, _duel, stars) => ({ rewards: null, stars, best: stars, starBooster: false, replays: 1 }),
  revengesWon: async () => new Set(),
  completeRevenge: async () => ({ revenge: true, rewards: null }),
  recordResult: async () => {},
  duelResults: async () => [],
  solvedPuzzles: async () => new Set(),
  solvePuzzle: async () => true,
  finishTutorial: async () => true,
  saveReport: async () => true,
  saveReplay: async () => {},
  replays: async () => [],
  readReplay: async () => undefined,
  previewConversion: async () => ({ cards: [[1, "", 2]], points: 10 }),
  convertDuplicates: async (_userId, expected) => (expected === 10 ? undefined : "la collection a changé, relancez l'aperçu"),
  craftCard: async () => "points insuffisants : 40 nécessaires",
  // Seul "quotidien" reçoit la récompense du jour à cette connexion.
  claimDaily: async (userId) => userId === "quotidien",
  eventWon: async () => false,
  claimEvent: async () => true,
  towerView: async () => ({ floors: [], floor: 0, best: 0, claimed: [] }),
  startTower: async () => 1,
  winTower: async (_userId, floor) => ({ floor, best: floor, boosters: 0 }),
  loseTower: async () => undefined,
  ...noSealed,
  ...noDraft,
  ...noMissions,
  ...noAdmin,
  friendList: async () => [],
  requestFriend: async () => "joueur introuvable",
  acceptFriend: async () => undefined,
  removeFriend: async () => undefined,
  ...noTrades,
  rating: async (userId) => ({ rating: ratings.get(userId) ?? 1000, games: 0, seasonGames: 0 }),
  ranked: async (userId) => ({ ...seasonView, rating: ratings.get(userId) ?? 1000 }),
  rateDuel: async ({ players, winner }) => {
    const before = players.map((id) => ratings.get(id) ?? 1000) as [number, number];
    const after = elo(before, winner);
    players.forEach((id, index) => ratings.set(id, after[index]));
    return [
      { before: before[0], after: after[0] },
      { before: before[1], after: after[1] },
    ];
  },
};
// "admin" peut s'ajouter des boosters.
process.env.ADMIN_USER_IDS = "admin, autreadmin";
// Thumbnails go to a throwaway folder, never next to the real artworks.
const thumbsDir = mkdtempSync(join(tmpdir(), "vignettes-"));
process.env.ART_THUMBS_DIR = thumbsDir;
// Artworks are downloaded apart (pnpm images), so absent on CI: a stand-in for the one read here, removed afterwards.
const darkMagicianArt = artFile(46986414);
const madeArt = !existsSync(darkMagicianArt);
if (madeArt) {
  mkdirSync(dirname(darkMagicianArt), { recursive: true });
  await sharp({ create: { width: 624, height: 456, channels: 3, background: "#4b2a7a" } }).jpeg().toFile(darkMagicianArt);
}
const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n]);
await once(wss, "listening");
const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
afterAll(() => {
  wss.close();
  rmSync(thumbsDir, { recursive: true, force: true });
  if (madeArt) rmSync(darkMagicianArt);
});

// A client logged in as `user` (if any) that records everything and answers its questions with `answer`
// (undefined keeps the question pending).
async function connect(user?: string, answer: Answer = (question) => respond(question), to = url) {
  const socket = new WebSocket(to);
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
    // The current stats of the set monster, and its code, reach its owner only.
    const zone = a.messages().flatMap((msg) => (msg.type === OcgMessageType.MOVE && msg.card === setCode ? [msg.to.sequence] : []))[0];
    const stats = (client: typeof a) => client.messages().flatMap((msg) => (msg.type === "stats" ? [msg.monsters[0][zone]] : [])).at(-1);
    expect(stats(a)).toEqual({ atk: expect.any(Number), def: expect.any(Number), code: setCode });
    expect(stats(b)).toBeNull();

    // B reconnects with the same identity: same visible history, same pending question.
    b.socket.close();
    const b2 = await connect("bob");
    b2.send({ type: "join", room });
    await vi.waitFor(() => expect(b2.messages().length).toBeGreaterThan(0));
    expect(joined(b2.received)).toEqual({ type: "joined", room, seat: 1, lp: 4000, decks: [40, 40], extras: [0, 0], opponent: "alice", log: b.messages() });
    expect(b2.received).toContainEqual({ type: "question", question: held, retry: false });
  });

  it("une salle dont le moteur lève une erreur est fermée, une autre salle continue de jouer", () => {
    type Duel = NonNullable<Room["duel"]>;
    const fakeDuel = (lib: Partial<Duel["lib"]>): Duel => ({ lib: { duelQueryLocation: () => [], ...lib }, handle: 1 }) as unknown as Duel;
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

  // Reads the whole pool cold: over the default 5 s when the machine is busy.
  it("sert les données des cartes du pool en français et leurs illustrations, pas celles hors pool ou absentes", { timeout: 20_000 }, async () => {
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

  it("sert les vignettes WebP des illustrations, en cache immuable, pour les largeurs prévues seulement", async () => {
    const http = url.replace("ws:", "http:");
    for (const width of [160, 320]) {
      const thumb = await fetch(`${http}/api/art/46986414-${width}.webp`);
      expect(thumb.status).toBe(200);
      expect(thumb.headers.get("content-type")).toBe("image/webp");
      expect(thumb.headers.get("cache-control")).toContain("immutable");
      const bytes = Buffer.from(await thumb.arrayBuffer());
      expect((await sharp(bytes).metadata()).width).toBe(width);
      expect(bytes.byteLength).toBeLessThan(statSync(artFile(46986414)).size);
    }
    expect((await fetch(`${http}/api/art/46986414-200.webp`)).status).toBe(404);
    expect((await fetch(`${http}/api/art/14558127-160.webp`)).status).toBe(404);
    expect((await fetch(`${http}/api/art/..%2F46986414-160.webp`)).status).toBe(404);
  });

  it("sert les cartes de chaque set, une fois par passcode", async () => {
    const http = url.replace("ws:", "http:");
    const sets: { code: string; name: string; cards: number[] }[] = await (await fetch(`${http}/api/sets`)).json();
    expect(sets.map((set) => set.code)).toEqual(SETS.map((set) => set.code));
    expect(sets.find((set) => set.code === "LOB")?.cards).toHaveLength(126);
    expect(sets.find((set) => set.code === "LOB")?.cards).toContain(89631139);
    // Ultimate Rare variants repeat a passcode: FET has 85 printings for 60 cards.
    expect(sets.find((set) => set.code === "FET")?.cards).toHaveLength(60);
    for (const set of sets) expect(new Set(set.cards).size).toBe(set.cards.length);
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
    expect(joined(guest.received)).toMatchObject({ seat: 1, decks: [45, 50], opponent: "hote" });
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
    expect(joined(host.received)?.opponent).toBeUndefined();
    const guest = await connect("invite2");
    guest.send({ type: "join", room: joined(host.received)?.room ?? "" });
    await vi.waitFor(() => expect(joined(guest.received)).toMatchObject({ seat: 1, decks: [40, 40], extras: [2, 1] }));
    await vi.waitFor(() => expect(host.received.filter((msg) => msg.type === "joined").at(-1)).toMatchObject({ extras: [2, 1], opponent: "invite2" }));
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

  it("annonce la récompense du jour, convertit les doublons après l'aperçu et relaie les refus", async () => {
    const p = await connect("quotidien");
    p.send({ type: "convert_preview" });
    p.send({ type: "convert", points: 9 });
    p.send({ type: "convert", points: 10 });
    p.send({ type: "craft", code: 1 });
    p.send({ type: "craft", code: 1.5 } as unknown as ClientMessage);
    await vi.waitFor(() => expect(p.received).toHaveLength(6));
    expect(p.received).toEqual([
      { type: "profile", pseudo: "quotidien", needsStarter: true, daily: true },
      { type: "conversion", cards: [[1, "", 2]], points: 10 },
      { type: "error", error: "la collection a changé, relancez l'aperçu" },
      { type: "collection", cards: [], rarities: [], points: 7 },
      { type: "error", error: "points insuffisants : 40 nécessaires" },
      { type: "error", error: "message invalide" },
    ]);
  });

  it("renvoie l'état des boosters et les cartes d'une ouverture réussie", async () => {
    const p = await connect("carol");
    p.send({ type: "booster_state" });
    p.send({ type: "open_booster", set: "LOB" });
    await vi.waitFor(() => expect(p.received.length).toBeGreaterThanOrEqual(3));
    expect(p.received).toContainEqual({ type: "booster_state", nextFreeAt: new Date(0).toISOString(), pending: 0, ultraIn: 21, online: 0 });
    expect(p.received).toContainEqual({ type: "booster_opened", set: "LOB", cards: [{ code: 1, rarity: "common" }] });
  });

  it("ajoute et retire des souhaits, refuse une carte hors du pool et la 101e carte", async () => {
    const [first, second] = [...POOL];
    const p = await connect("wisher");
    await vi.waitFor(() => expect(p.received).toHaveLength(1));
    const last = () => p.received.at(-1);
    const ask = async (msg: ClientMessage) => {
      const count = p.received.length;
      p.send(msg);
      await vi.waitFor(() => expect(p.received.length).toBeGreaterThan(count));
    };
    await ask({ type: "wishlist" });
    expect(last()).toEqual({ type: "wishlist", cards: [] });
    await ask({ type: "wish_add", code: first });
    await ask({ type: "wish_add", code: second });
    await ask({ type: "wish_add", code: first });
    expect(last()).toEqual({ type: "wishlist", cards: [first, second] });
    await ask({ type: "wish_add", code: 1 });
    expect(last()).toEqual({ type: "error", error: "carte inconnue" });
    await ask({ type: "wish_remove", code: first });
    expect(last()).toEqual({ type: "wishlist", cards: [second] });

    const before = p.received.length;
    for (const code of [...POOL].slice(2, WISH_MAX + 1)) p.send({ type: "wish_add", code });
    await vi.waitFor(() => expect(p.received).toHaveLength(before + WISH_MAX - 1));
    expect(last()).toMatchObject({ type: "wishlist", cards: expect.arrayContaining([second]) });
    expect((last() as { cards: number[] }).cards).toHaveLength(WISH_MAX);
    await ask({ type: "wish_add", code: first });
    expect(last()).toEqual({ type: "error", error: `liste de souhaits pleine (${WISH_MAX} cartes au maximum)` });
    await ask({ type: "wish_add", code: second });
    expect((last() as { cards: number[] }).cards).toHaveLength(WISH_MAX);
    p.send({ type: "wish_add", code: 1.5 });
    await vi.waitFor(() => expect(p.received.at(-1)).toEqual({ type: "error", error: "message invalide" }));
  });

  it("répond à la pioche miracle : tirage, même tirage ensuite, un seul choix, index refusé hors des 5 cartes", async () => {
    const p = await connect("miracle");
    await vi.waitFor(() => expect(p.received).toHaveLength(1));
    const ask = async (msg: ClientMessage) => {
      const count = p.received.length;
      p.send(msg);
      await vi.waitFor(() => expect(p.received.length).toBeGreaterThan(count));
      return p.received.at(-1);
    };
    expect(await ask({ type: "wonder" })).toEqual({ type: "wonder", status: "available" });
    const drawn = await ask({ type: "wonder_draw" });
    expect(drawn).toMatchObject({ type: "wonder", status: "drawn", cards: expect.any(Array) });
    expect(await ask({ type: "wonder_draw" })).toEqual(drawn);
    expect(await ask({ type: "wonder" })).toEqual(drawn);
    for (const index of [5, -1, 1.5]) {
      p.send({ type: "wonder_pick", index });
      await vi.waitFor(() => expect(p.received.at(-1)).toEqual({ type: "error", error: "message invalide" }));
    }
    expect(await ask({ type: "wonder_pick", index: 1 })).toMatchObject({ type: "wonder", status: "picked", picked: 1 });
    expect(await ask({ type: "wonder_pick", index: 2 })).toEqual({ type: "error", error: "carte déjà choisie" });
    const other = await connect("miracle2");
    await vi.waitFor(() => expect(other.received).toHaveLength(1));
    other.send({ type: "wonder_pick", index: 0 });
    await vi.waitFor(() => expect(other.received.at(-1)).toEqual({ type: "error", error: "aucune pioche miracle en cours" }));
  });

  it("réserve l'ajout de boosters aux comptes admin", async () => {
    const credit = vi.spyOn(accounts, "creditBoosters");
    const admin = await connect("admin");
    const joueur = await connect("dave");
    const profile = (received: Received[]) => received.find((msg) => msg.type === "profile");
    await vi.waitFor(() => expect(profile(admin.received)).toMatchObject({ pseudo: "admin", admin: true }));
    await vi.waitFor(() => expect(profile(joueur.received)).toBeDefined());
    expect(profile(joueur.received)).not.toHaveProperty("admin");
    admin.send({ type: "admin_boosters", count: 10 });
    joueur.send({ type: "admin_boosters", count: 10 });
    admin.send({ type: "admin_boosters", count: 51 });
    await vi.waitFor(() => expect(admin.received.filter((msg) => msg.type === "booster_state" || msg.type === "error")).toHaveLength(2));
    await vi.waitFor(() => expect(joueur.received).toContainEqual({ type: "error", error: "commande réservée" }));
    expect(admin.received).toContainEqual({ type: "error", error: "message invalide" });
    // Other tests credit their own players meanwhile: only this test's accounts count.
    expect(credit.mock.calls.filter(([id]) => id === "admin" || id === "dave")).toEqual([["admin", 10]]);
    credit.mockRestore();
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
  it("crédite le vainqueur d'un duel en ligne, pas celui d'un duel contre le bot, et lui dit si le plafond du jour est atteint", async () => {
    const credited: string[] = [];
    const fakeAccounts: Pick<Accounts, "winOnline"> = {
      winOnline: async (userId) => {
        credited.push(userId);
        return userId !== "plein";
      },
    };
    const sent = vi.fn();
    const socket = { send: sent } as unknown as WebSocket;
    const room = (second: string, bot?: boolean): Room => ({
      code: "X",
      players: [
        { id: "p0", socket, log: [], deck: [] },
        { id: second, socket, log: [], deck: [], bot: bot ? ({} as Bot) : undefined },
      ],
    });

    creditWinner(room("p1"), 1, fakeAccounts);
    creditWinner(room("p1", true), 0, fakeAccounts);
    creditWinner(room("plein"), 1, fakeAccounts);

    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(2));
    expect(credited).toEqual(["p1", "plein"]);
    expect(sent.mock.calls.map(([data]) => JSON.parse(data))).toEqual([
      { type: "online_won", earned: true },
      { type: "online_won", earned: false },
    ]);
  });

  it("advance() signale le vainqueur à room.onWin quand le moteur envoie WIN", () => {
    const socket = () => ({ send: vi.fn() }) as unknown as WebSocket;
    const fakeDuel = (messages: OcgMessage[]) =>
      ({ lib: { duelProcess: () => OcgProcessResult.END, duelGetMessage: () => messages, duelQueryLocation: () => [], destroyDuel: vi.fn() }, handle: 1 }) as unknown as NonNullable<Room["duel"]>;
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

describe("fins de duel décidées par le serveur", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const wins = (client: Awaited<ReturnType<typeof connect>>) => client.messages().filter((msg) => msg.type === OcgMessageType.WIN);
  const win = (player: number, reason: number) => [{ type: OcgMessageType.WIN, player, reason }];
  // Boosters credited to these users: duels of the previous tests may still end meanwhile.
  const credited = (users: string[]) => vi.mocked(accounts.creditBoosters).mock.calls.filter(([id]) => users.includes(id));

  // An online duel where nobody answers, once the engine has asked its first question to seat `asked`.
  async function hold(host: string, guest: string) {
    decks.set(host, YUGI);
    decks.set(guest, KAIBA);
    const a = await connect(host, () => undefined);
    a.send({ type: "create" });
    await vi.waitFor(() => expect(joined(a.received)).toBeDefined());
    const room = joined(a.received)?.room ?? "";
    const b = await connect(guest, () => undefined);
    b.send({ type: "join", room });
    const players = [a, b];
    const first = () => players.findIndex((client) => client.received.some((msg) => msg.type === "question"));
    await vi.waitFor(() => expect(first()).not.toBe(-1), { timeout: 20_000 });
    const asked = first();
    return { players, room, asked, other: players[1 - asked], names: [host, guest] };
  }

  it("un abandon donne la victoire à l'autre joueur, une seule fois, avec la raison 0", { timeout: 30_000 }, async () => {
    vi.spyOn(accounts, "creditBoosters");
    const { players, names } = await hold("abandon-a", "abandon-b");
    players[0].send({ type: "surrender" });
    await vi.waitFor(() => expect(wins(players[1])).toEqual(win(1, 0)));
    expect(wins(players[0])).toEqual(win(1, 0));
    players[1].send({ type: "surrender" });
    await vi.waitFor(() => expect(players[1].received).toContainEqual({ type: "error", error: "aucun duel en cours" }));
    expect(credited(names)).toEqual([["abandon-b", 1]]);
  });

  it("le joueur qui ne répond pas à temps perd le duel, avec la raison 3", { timeout: 30_000 }, async () => {
    vi.spyOn(accounts, "creditBoosters");
    fakeTimers();
    const { players, asked, other, names } = await hold("lent-a", "lent-b");
    for (const client of players) expect(client.received).toContainEqual({ type: "timer", kind: "answer", seat: asked, ms: DECISION_TIME });
    vi.advanceTimersByTime(DECISION_TIME);
    await vi.waitFor(() => expect(wins(other)).toEqual(win(1 - asked, 3)));
    vi.advanceTimersByTime(RECONNECT_TIME + DECISION_TIME);
    expect(wins(players[asked])).toEqual(win(1 - asked, 3));
    expect(credited(names)).toEqual([[names[1 - asked], 1]]);
  });

  it("un joueur déconnecté trop longtemps perd le duel, avec la raison 4 ; son temps de réponse est suspendu", { timeout: 30_000 }, async () => {
    fakeTimers();
    const { players, asked, other } = await hold("parti-a", "parti-b");
    players[asked].socket.close();
    await vi.waitFor(() => expect(other.received).toContainEqual({ type: "timer", kind: "reconnect", seat: asked, ms: RECONNECT_TIME }));
    expect(other.received).toContainEqual({ type: "timer", kind: "answer", seat: asked, ms: null });
    vi.advanceTimersByTime(RECONNECT_TIME);
    await vi.waitFor(() => expect(wins(other)).toEqual(win(1 - asked, 4)));
  });

  it("un joueur revenu avant le délai garde son siège, son temps de réponse reprend", { timeout: 30_000 }, async () => {
    fakeTimers();
    const { players, room, asked, other, names } = await hold("revenu-a", "revenu-b");
    players[asked].socket.close();
    await vi.waitFor(() => expect(other.received).toContainEqual({ type: "timer", kind: "reconnect", seat: asked, ms: RECONNECT_TIME }));
    vi.advanceTimersByTime(RECONNECT_TIME - 5000);
    const again = await connect(names[asked], () => undefined);
    again.send({ type: "join", room });
    await vi.waitFor(() => expect(other.received).toContainEqual({ type: "timer", kind: "reconnect", seat: asked, ms: null }));
    expect(again.received).toContainEqual({ type: "timer", kind: "answer", seat: asked, ms: expect.any(Number) });
    vi.advanceTimersByTime(6000);
    expect(wins(other)).toEqual([]);
    vi.advanceTimersByTime(DECISION_TIME);
    await vi.waitFor(() => expect(wins(other)).toEqual(win(1 - asked, 3)));
  });

  it("relaie une émote aux deux joueurs, refuse un id inconnu et ignore une émote avant 3 s", { timeout: 30_000 }, async () => {
    const { players } = await hold("emote-a", "emote-b");
    fakeTimers();
    const emotes = (client: (typeof players)[number]) => client.received.filter((msg) => msg.type === "emote");
    const from = (seat: number, id: string) => ({ type: "emote", seat, id });
    players[0].send({ type: "emote", id: "bonjour" });
    await vi.waitFor(() => expect(emotes(players[1])).toEqual([from(0, "bonjour")]));
    expect(emotes(players[0])).toEqual([from(0, "bonjour")]);
    // Too soon for the same player, not for the other one.
    players[0].send({ type: "emote", id: "merci" });
    players[1].send({ type: "emote", id: "oups" });
    await vi.waitFor(() => expect(emotes(players[0])).toHaveLength(2));
    expect(emotes(players[0])).toEqual([from(0, "bonjour"), from(1, "oups")]);
    vi.advanceTimersByTime(EMOTE_DELAY);
    players[0].send({ type: "emote", id: "merci" });
    await vi.waitFor(() => expect(emotes(players[1]).at(-1)).toEqual(from(0, "merci")));
    // Only the ids of the list go through, never text.
    players[0].send({ type: "emote", id: "Salut !" } as unknown as ClientMessage);
    await vi.waitFor(() => expect(players[0].received).toContainEqual({ type: "error", error: "message invalide" }));
    expect(emotes(players[1])).toHaveLength(3);
  });

  it("refuse une émote hors d'une salle ou d'un duel", async () => {
    const alone = await connect("emote-seul");
    alone.send({ type: "auth", token: "jeton-emote-seul" });
    alone.send({ type: "emote", id: "hmm" });
    await vi.waitFor(() => expect(alone.received).toContainEqual({ type: "error", error: "pas dans une salle" }));
    decks.set("emote-seul", YUGI);
    alone.send({ type: "create" });
    alone.send({ type: "emote", id: "hmm" });
    await vi.waitFor(() => expect(alone.received).toContainEqual({ type: "error", error: "aucun duel en cours" }));
  });

  it("aucune minuterie contre le bot", { timeout: 30_000 }, async () => {
    fakeTimers();
    decks.set("patient", YUGI);
    const human = await connect("patient", () => undefined);
    human.send({ type: "bot" });
    await vi.waitFor(() => expect(human.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    vi.advanceTimersByTime(DECISION_TIME + RECONNECT_TIME);
    expect(human.received.filter((msg) => msg.type === "timer")).toEqual([]);
    expect(wins(human)).toEqual([]);
  });
});

describe("revanche", () => {
  const joins = (client: Awaited<ReturnType<typeof connect>>) => client.received.filter((msg) => msg.type === "joined");
  const hasQuestion = (client: Awaited<ReturnType<typeof connect>>, after: number) => client.received.slice(after).some((msg) => msg.type === "question");

  async function ended(first: ClientMessage, user: string) {
    decks.set(user, YUGI);
    const human = await connect(user);
    human.send(first);
    await vi.waitFor(() => expect(human.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    human.send({ type: "surrender" });
    await vi.waitFor(() => expect(human.messages().some((msg) => msg.type === OcgMessageType.WIN)).toBe(true));
    return human;
  }

  it.each([
    ["contre le bot", { type: "bot", level: "expert" }, "rev-bot"],
    ["en mode Histoire", { type: "story_duel", duel: "dk-weevil" }, "rev-histoire"],
  ] satisfies [string, ClientMessage, string][])("relance un duel identique tout de suite %s", { timeout: 30_000 }, async (_name, first, user) => {
    const human = await ended(first, user);
    const before = joins(human).at(-1);
    const count = human.received.length;
    const total = joins(human).length;
    human.send({ type: "rematch" });
    await vi.waitFor(() => expect(hasQuestion(human, count + 1)).toBe(true), { timeout: 20_000 });
    expect(joins(human)).toHaveLength(total + 1);
    expect(joins(human).at(-1)).toEqual({ ...before, log: [] });
    expect(human.received.slice(count + 1).flatMap((msg) => (msg.type === "messages" ? msg.messages : [])).some((msg) => msg.type === OcgMessageType.WIN)).toBe(false);
  });

  it("refuse une revanche tant que le duel n'est pas terminé", { timeout: 30_000 }, async () => {
    decks.set("rev-tot", YUGI);
    const human = await connect("rev-tot", () => undefined);
    human.send({ type: "bot" });
    await vi.waitFor(() => expect(human.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    human.send({ type: "rematch" });
    await vi.waitFor(() => expect(human.received).toContainEqual({ type: "error", error: "aucun duel terminé" }));
  });

  async function onlineEnded(host: string, guest: string) {
    decks.set(host, YUGI);
    decks.set(guest, KAIBA);
    const a = await connect(host);
    a.send({ type: "create" });
    await vi.waitFor(() => expect(joined(a.received)).toBeDefined());
    const b = await connect(guest);
    b.send({ type: "join", room: joined(a.received)?.room ?? "" });
    await vi.waitFor(() => expect(a.received.some((msg) => msg.type === "question") || b.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    a.send({ type: "surrender" });
    await vi.waitFor(() => expect(b.messages().some((msg) => msg.type === OcgMessageType.WIN)).toBe(true));
    return { a, b };
  }

  it("en ligne, démarre un nouveau duel dans la salle quand les deux acceptent, avec les decks actifs du moment, sans double booster", { timeout: 30_000 }, async () => {
    vi.spyOn(accounts, "creditBoosters");
    const { a, b } = await onlineEnded("rev-a", "rev-b");
    const first = [joins(a).length, joins(b).length];
    decks.set("rev-b", Array<number>(45).fill(89631139));
    a.send({ type: "rematch" });
    await vi.waitFor(() => expect(b.received).toContainEqual({ type: "rematch", from: 0 }));
    expect(a.received).toContainEqual({ type: "rematch", from: 0 });
    b.send({ type: "rematch" });
    await vi.waitFor(() => expect(joins(a)).toHaveLength(first[0] + 1));
    await vi.waitFor(() => expect(joins(b)).toHaveLength(first[1] + 1));
    expect(joins(a).at(-1)).toMatchObject({ room: joined(a.received)?.room, seat: 0, decks: [40, 45], log: [] });
    expect(joins(b).at(-1)).toMatchObject({ seat: 1, decks: [40, 45], log: [] });
    a.send({ type: "surrender" });
    await vi.waitFor(() => expect(a.messages().filter((msg) => msg.type === OcgMessageType.WIN)).toHaveLength(2));
    const rewards = vi.mocked(accounts.creditBoosters).mock.calls.filter(([id]) => id.startsWith("rev-"));
    expect(rewards).toEqual([["rev-b", 1], ["rev-b", 1]]);
  });

  it("en ligne, un refus ou un départ donne « revanche refusée » et aucun nouveau duel", { timeout: 30_000 }, async () => {
    const refused = await onlineEnded("ref-a", "ref-b");
    const count = joins(refused.a).length;
    refused.a.send({ type: "rematch" });
    await vi.waitFor(() => expect(refused.b.received).toContainEqual({ type: "rematch", from: 0 }));
    refused.b.send({ type: "rematch", accept: false });
    await vi.waitFor(() => expect(refused.a.received).toContainEqual({ type: "rematch_declined" }));
    refused.a.send({ type: "rematch" });
    await vi.waitFor(() => expect(refused.a.received).toContainEqual({ type: "error", error: "revanche refusée" }));
    expect(joins(refused.a)).toHaveLength(count);

    const left = await onlineEnded("dep-a", "dep-b");
    const total = joins(left.a).length;
    left.b.socket.close();
    await vi.waitFor(() => expect(left.a.received).toContainEqual({ type: "rematch_declined" }));
    expect(joins(left.a)).toHaveLength(total);
  });
});

describe("mode Tour", () => {
  it("prépare l'étage : adversaire, niveau, LP ; une victoire monte, une défaite renvoie à l'étage 1, sans résultat rien ne change", async () => {
    const socket = { send: vi.fn() } as unknown as WebSocket;
    const winTower = vi.fn(async (_userId: string, floor: number) => ({ floor, best: floor, boosters: 2 }));
    const loseTower = vi.fn(async () => undefined);
    const room: Room = { code: "TOUR", players: [{ id: "p0", socket, log: [], deck: [] }, { id: "bot", name: "Bot", log: [], deck: [], bot: {} as Bot }] };

    towerFloor(room, 6, { winTower, loseTower });
    expect(room.rules).toEqual({ lp: 4500, playerLp: 4000, hand: 5, cards: [] });
    expect(room.level).toBe("normal");
    expect(room.players[1]).toMatchObject({ name: "Machines de guerre", deck: expect.any(Array) });
    expect(room.players[1].deck).toHaveLength(40);
    expect(loseTower).not.toHaveBeenCalled();
    room.onWin?.(1);
    await room.tower?.saved;
    expect(winTower).not.toHaveBeenCalled();
    expect(loseTower).toHaveBeenCalledWith("p0", 6);
    room.onWin?.(0);
    await room.tower?.saved;
    expect(winTower).toHaveBeenCalledWith("p0", 6);
    expect(loseTower).toHaveBeenCalledTimes(1);
    expect(vi.mocked(socket.send)).toHaveBeenCalledWith(JSON.stringify({ type: "tower_won", floor: 6, best: 6, boosters: 2 }));

    towerFloor(room, 3, { winTower, loseTower });
    expect(room.rules?.lp).toBe(4000);
    expect(room.level).toBe("debutant");
  });

  it("joue l'étage donné par le serveur ; après un abandon, la revanche repart de l'étage donné", { timeout: 30_000 }, async () => {
    const start = vi.spyOn(accounts, "startTower").mockResolvedValueOnce(8).mockResolvedValueOnce(1);
    const win = vi.spyOn(accounts, "winTower");
    const lose = vi.spyOn(accounts, "loseTower");
    decks.set("tour-a", YUGI);
    const human = await connect("tour-a");
    const joins = () => human.received.filter((msg) => msg.type === "joined");
    human.send({ type: "tower_duel" });
    await vi.waitFor(() => expect(human.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    expect(joins().at(-1)).toMatchObject({ opponent: "Yugi, Magicien Sombre", lp: 4000, opponentLp: 5500, floor: 8 });
    const count = joins().length;
    human.send({ type: "surrender" });
    await vi.waitFor(() => expect(human.messages().some((msg) => msg.type === OcgMessageType.WIN)).toBe(true));
    human.send({ type: "rematch" });
    await vi.waitFor(() => expect(joins()).toHaveLength(count + 1));
    expect(joins().at(-1)).toMatchObject({ opponent: "Marées d'Umi", lp: 4000, floor: 1, log: [] });
    expect(joins().at(-1)).not.toHaveProperty("opponentLp");
    expect(start.mock.calls.filter(([id]) => id === "tour-a")).toHaveLength(2);
    expect(win.mock.calls.filter(([id]) => id === "tour-a")).toEqual([]);
    expect(lose.mock.calls.filter(([id]) => id === "tour-a")).toEqual([["tour-a", 8]]);
    start.mockRestore();
    win.mockRestore();
    lose.mockRestore();
  });

  it("refuse la Tour sans deck valide, sans toucher à la progression", async () => {
    const start = vi.spyOn(accounts, "startTower");
    const human = await connect("sansdeck");
    human.send({ type: "tower_duel" });
    await vi.waitFor(() => expect(human.received).toContainEqual({ type: "error", error: "deck actif requis" }));
    expect(start.mock.calls.filter(([id]) => id === "sansdeck")).toEqual([]);
    start.mockRestore();
  });
});

describe("mode classé", () => {
  afterEach(() => vi.restoreAllMocks());
  const joins = (client: Awaited<ReturnType<typeof connect>>) => client.received.filter((msg) => msg.type === "joined");
  // Players of each test get a rating far from the others, so a player left in the queue never pairs with them.
  async function queued(user: string, rating: number, answer?: Answer) {
    decks.set(user, GOAT_YUGI);
    ratings.set(user, rating);
    const client = await connect(user, answer);
    client.send({ type: "ranked_queue" });
    await vi.waitFor(() => expect(client.received).toContainEqual({ type: "ranked_queue", waiting: true }));
    return client;
  }

  it("refuse la file classée à un deck hors de la liste Goat, sans l'y mettre en attente, mais l'accepte contre le bot", async () => {
    decks.set("classe-hors-liste", [...GOAT_YUGI.slice(2), 55144522, 55144522]);
    const client = await connect("classe-hors-liste");
    client.send({ type: "ranked_queue" });
    await vi.waitFor(() => expect(client.received).toContainEqual({ type: "error", error: "Pot de Cupidité : 1 exemplaire au plus en classé" }));
    expect(client.received).not.toContainEqual({ type: "ranked_queue", waiting: true });
    client.send({ type: "bot" });
    await vi.waitFor(() => expect(joined(client.received)).toBeDefined());
    client.socket.close();
  });

  it("envoie le classement du joueur, la saison en cours et la précédente, en faisant d'abord entrer le joueur dans la saison", async () => {
    ratings.set("classe-vue", 1100);
    const ranked = vi.spyOn(accounts, "ranked");
    const client = await connect("classe-vue");
    client.send({ type: "ranked" });
    await vi.waitFor(() => expect(client.received).toContainEqual({ type: "ranked", ...seasonView, rating: 1100 }));
    expect(ranked).toHaveBeenCalledWith("classe-vue");
  });

  it("apparie deux joueurs en attente dans un duel en ligne, met à jour les deux classements une seule fois, sans revanche", { timeout: 30_000 }, async () => {
    vi.spyOn(accounts, "rateDuel");
    vi.spyOn(accounts, "creditBoosters");
    const a = await queued("classe-a", 2000, () => undefined);
    const b = await queued("classe-b", 2050, () => undefined);
    await vi.waitFor(() => expect(joined(a.received)).toBeDefined());
    await vi.waitFor(() => expect(joined(b.received)).toBeDefined());
    expect(joined(b.received)?.room).toBe(joined(a.received)?.room);
    await vi.waitFor(() => expect(a.received.some((msg) => msg.type === "question") || b.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    // The player who waited the longest sits first. B, rated higher, wins less than half of K.
    expect([joined(a.received)?.seat, joined(b.received)?.seat]).toEqual([0, 1]);
    a.send({ type: "surrender" });
    await vi.waitFor(() => expect(b.received).toContainEqual({ type: "ranked_result", delta: 14, rating: 2064 }));
    await vi.waitFor(() => expect(a.received).toContainEqual({ type: "ranked_result", delta: -14, rating: 1986 }));
    a.send({ type: "surrender" });
    a.send({ type: "rematch" });
    await vi.waitFor(() => expect(a.received).toContainEqual({ type: "error", error: "pas de revanche en classé" }));
    expect(a.received).toContainEqual({ type: "error", error: "aucun duel en cours" });
    const rated = vi.mocked(accounts.rateDuel).mock.calls.filter(([duel]) => duel.players.includes("classe-a"));
    expect(rated).toEqual([[{ players: ["classe-a", "classe-b"], winner: 1, reason: 0 }]]);
    expect(vi.mocked(accounts.creditBoosters).mock.calls.filter(([id]) => id.startsWith("classe-"))).toHaveLength(1);
    a.socket.close();
    b.socket.close();
  });

  it("retire de la file un joueur qui annule ou se déconnecte, et refuse une autre salle pendant l'attente", { timeout: 30_000 }, async () => {
    const annule = await queued("file-annule", 3000);
    annule.send({ type: "create" });
    await vi.waitFor(() => expect(annule.received).toContainEqual({ type: "error", error: "recherche d'un adversaire classé en cours" }));
    annule.send({ type: "ranked_cancel" });
    await vi.waitFor(() => expect(annule.received).toContainEqual({ type: "ranked_queue", waiting: false }));
    const parti = await queued("file-parti", 3000);
    parti.socket.close();
    await once(parti.socket, "close");
    const b = await queued("file-b", 3000);
    const c = await queued("file-c", 3000);
    await vi.waitFor(() => expect(joined(c.received)).toBeDefined());
    await vi.waitFor(() => expect(joined(b.received)).toBeDefined());
    expect(joined(b.received)?.room).toBe(joined(c.received)?.room);
    expect(joins(annule)).toEqual([]);
    for (const client of [annule, b, c]) client.socket.close();
  });
});

describe("arrêt pour une mise à jour", () => {
  afterEach(() => vi.restoreAllMocks());

  // A server of its own, stopped by the test, with `user` in a duel against the bot that waits on their answer.
  async function inDuel(user: string) {
    const server = startServer(0, accounts, () => [1n, 2n, 3n, 4n]);
    await once(server, "listening");
    const to = `ws://localhost:${(server.address() as AddressInfo).port}`;
    decks.set(user, YUGI);
    const player = await connect(user, () => undefined, to);
    player.send({ type: "bot" });
    await vi.waitFor(() => expect(player.received.some((msg) => msg.type === "question")).toBe(true), { timeout: 20_000 });
    return { server, to, player };
  }

  it("refuse les nouveaux duels, laisse finir celui en cours puis s'arrête", { timeout: 30_000 }, async () => {
    const { server, to, player } = await inDuel("arret-a");
    let stopped = false;
    const stop = server.shutdown(60_000).then(() => {
      stopped = true;
    });
    await vi.waitFor(() => expect(player.received).toContainEqual({ type: "maintenance" }));
    const late = await connect("arret-b", undefined, to);
    await vi.waitFor(() => expect(late.received).toContainEqual({ type: "maintenance" }));
    late.send({ type: "create" });
    await vi.waitFor(() => expect(late.received).toContainEqual({ type: "error", error: "mise à jour en cours : les nouveaux duels reprennent dans quelques minutes" }));
    // A check went by: the duel in progress keeps the server up.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(stopped).toBe(false);
    player.send({ type: "surrender" });
    await stop;
    expect(player.messages()).toContainEqual(expect.objectContaining({ type: OcgMessageType.WIN, player: 1 }));
    player.send({ type: "rematch" });
    await vi.waitFor(() => expect(player.received.at(-1)).toEqual({ type: "error", error: "mise à jour en cours : les nouveaux duels reprennent dans quelques minutes" }));
    for (const client of [player, late]) client.socket.close();
    server.close();
  });

  it("au bout du délai maximum, termine les duels restants sans vainqueur ni résultat enregistré", { timeout: 30_000 }, async () => {
    const { server, player } = await inDuel("arret-c");
    vi.spyOn(accounts, "recordResult");
    await server.shutdown(0);
    await vi.waitFor(() => expect(player.received).toContainEqual({ type: "duel_error", error: "mise à jour du serveur : duel interrompu, sans victoire ni défaite" }));
    expect(player.messages().some((msg) => msg.type === OcgMessageType.WIN)).toBe(false);
    expect(accounts.recordResult).not.toHaveBeenCalled();
    player.socket.close();
    server.close();
  });
});
