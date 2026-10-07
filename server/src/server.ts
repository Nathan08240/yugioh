import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { dbAccounts, type Accounts } from "./accounts.ts";
import { Bot } from "./bot.ts";
import { deckReply, isDeckMessage, poolCard, type DeckMessage } from "./collection.ts";
import { ROOM_LIMITS, roomRules } from "./custom.ts";
import { openDb, type ActiveDeck } from "./db.ts";
import { EXTRA_MAX, isFusion, limitError, MAIN_MAX, MAIN_MIN } from "./deckcheck.ts";
import { KAIBA } from "./decks.ts";
import { lpLeft, lpOf } from "./duel.ts";
import { economyReply, isEconomyMessage, type EconomyMessage } from "./economy.ts";
import type { EmoteId } from "./emotes.ts";
import { eventOf, eventRules } from "./event.ts";
import { friendHub, isFriendMessage } from "./friends.ts";
import { historyEntry, replayAllowed, replayMessage, REPLAYS_LIMITED } from "./history.ts";
import { artFile, SERVED, serveHttp } from "./http.ts";
import { GOAT } from "./limits.ts";
import type { MissionProgress } from "./missions.ts";
import { isAllowed } from "./pool.ts";
import { isProfileMessage, profileReply, type ProfileMessage } from "./profile.ts";
import { REPORT_MAX, SPECTATORS_MAX, type BotLevel, type ClientMessage, type RevengeResult, type RoomOptions, type Seat, type ServerMessage, type StoryLevel, type StoryResult } from "./protocol.ts";
import { PUZZLE_IDS, PUZZLE_TURNS, puzzleField, puzzleRules, puzzleView } from "./puzzles.ts";
import { pairUp, type Waiting } from "./ranked.ts";
import { REPORT_BYTES } from "./report.ts";
import { draftReply, isDraftMessage, type DraftMessage } from "./draft.ts";
import { creditWinner, missionProgress, towerFloor } from "./rewards.ts";
import { advance, ANSWERS, answer, ask, away, back, CONNECTION_LOST, DECISION_TIME, deckSizes, declineRematch, emote, endDuel, extraSizes, fail, finish, newCode, online, randomSeed, RECONNECT_TIME, rematchMessage, reportOf, rulesOf, sendAll, sendJoined, sendSpectators, sendWatching, start, surrender, type Player, type Room } from "./room.ts";
import { botDeck, isSealedMessage, sealedReply, type SealedMessage } from "./sealed.ts";
import type { Starter } from "./starter.ts";
import { isUnlocked, playerDeck, STORY, STORY_DUELS, STORY_REVENGES, storyDeck, storyExtra, storyRules, storyStars, storyView, type StoryDuel } from "./story.ts";
import { TOWER } from "./tower.ts";
import { isTradeMessage, tradeReply } from "./trade.ts";
import { TUTORIAL_FIELD, TUTORIAL_RULES } from "./tutorial.ts";
import { isWishMessage, wishReply, type WishMessage } from "./wishlist.ts";
import { isWonderMessage, wonderReply, type WonderMessage } from "./wonder.ts";
import { parse, send } from "./wire.ts";

export { advance, ANSWERS, creditWinner, dbAccounts, DECISION_TIME, missionProgress, randomSeed, RECONNECT_TIME, towerFloor, type Accounts, type Room };

const PSEUDO = /^[A-Za-z0-9_-]{3,20}$/;
// An empty room is kept this long so a player can come back to it.
const ROOM_TTL = 10 * 60_000;
// Pause before each answer of the bot, so the human can follow its moves.
const BOT_DELAY = 700;
// The bot greets this long after the room opens, once the client has the duel on screen.
const BOT_GREETING_DELAY = 1500;

// Comma-separated Supabase user ids allowed to use the admin commands.
const adminIds = (value = "") => new Set(value.split(",").map((id) => id.trim()).filter(Boolean));
const dailyFlag = (daily: boolean) => (daily ? { daily: true as const } : {});

// The custom rules of a room: its options and the duel rules built from them, nothing for a standard room.
const customRoom = (options?: RoomOptions): Pick<Room, "options" | "rules"> => (options ? { options, rules: roomRules(options) } : {});

const isPoolFusion = (code: number) => {
  const card = poolCard(code);
  return card !== undefined && isFusion(card);
};

// A deck as validated for a duel: 40 to 60 cards from the allowed pool, and at most 15 Fusion monsters in the extra deck.
const validDeck = ({ main, extra }: ActiveDeck) =>
  main.length >= MAIN_MIN && main.length <= MAIN_MAX && main.every(isAllowed) && extra.length <= EXTRA_MAX && extra.every(isPoolFusion);

// Where the Goat list applies besides the ranked queue: a room or a bot duel of the weekly event.
const EVENT_LIMITS = "en événement";

// Where the Goat list holds the decks of a room (or of a message that creates one), undefined when it does not.
function limitsOf(source?: { event?: unknown; options?: RoomOptions }): string | undefined {
  if (source?.event) return EVENT_LIMITS;
  return source?.options?.goat ? ROOM_LIMITS : undefined;
}

type FriendEntry = { deck: (where?: string) => Promise<ActiveDeck | string>; enter: (room: Room, deck: ActiveDeck) => string | undefined };

// While the server stops for an update: what a new duel gets, and the end of a duel still running at the deadline.
const MAINTENANCE = "mise à jour en cours : les nouveaux duels reprennent dans quelques minutes";
const INTERRUPTED = "mise à jour du serveur : duel interrompu, sans victoire ni défaite";
// Messages that may seat a player back in a duel they already play (or watch) while the server stops.
const RESUMING = new Set<ClientMessage["type"]>(["join", "spectate", "sealed_duel", "draft_duel"]);

// The bot takes seat 1. `shutdown` stops the server for an update (see its comment).
export function startServer(port: number, accounts: Accounts, newSeed = randomSeed, botDelay = BOT_DELAY): WebSocketServer & { shutdown: (maxMs: number) => Promise<void> } {
  const rooms = new Map<string, Room>();
  const http = createServer(serveHttp);
  const admins = adminIds(process.env.ADMIN_USER_IDS);
  const adminFlag = (id: string) => (admins.has(id) ? { admin: true as const } : {});
  const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
  wss.on("close", () => http.close());
  http.listen(port);

  // Players waiting for a ranked duel, by user id, and the last ranked opponent of each player.
  const waiting = new Map<string, Waiting & { socket: WebSocket; join: (room: Room) => void }>();
  const lastOpponent = new Map<string, { opponent: string; at: number }>();
  // When each player asked their last replays (history.ts).
  const replaysAsked = new Map<string, number[]>();

  // Each pair found sits in a new online room; the window of each player widens as they wait.
  function matchQueue() {
    const now = Date.now();
    for (const pair of pairUp([...waiting.values()], now, lastOpponent)) {
      const room: Room = { code: newCode(rooms), players: [], mode: { mode: "online" }, ranked: true };
      room.onWin = (winner) => creditWinner(room, winner as Seat, accounts);
      pair.forEach((player, index) => {
        waiting.delete(player.id);
        lastOpponent.set(player.id, { opponent: pair[1 - index].id, at: now });
      });
      for (const player of pair) player.join(room);
    }
  }
  const matcher = setInterval(matchQueue, 1000).unref();
  wss.on("close", () => clearInterval(matcher));

  // Set by shutdown: no new duel starts.
  let draining = false;

  // No new duel, every client is told. Resolves once no duel has a player still connected, or after `maxMs`: the duels
  // left then end with no winner, nothing recorded. A duel nobody plays any more is dropped with the process.
  function shutdown(maxMs: number): Promise<void> {
    draining = true;
    for (const { socket } of waiting.values()) send(socket, { type: "ranked_queue", waiting: false });
    waiting.clear();
    wss.clients.forEach((socket) => send(socket, { type: "maintenance" }));
    const deadline = Date.now() + maxMs;
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const playing = [...rooms.values()].filter((room) => room.duel && room.players.some((player) => player.socket));
        if (playing.length > 0 && Date.now() < deadline) return;
        for (const room of playing) fail(room, "arrêt du serveur", INTERRUPTED);
        clearInterval(check);
        resolve();
      }, 1000).unref();
    });
  }

  // Once per duel (the end of a duel is reported once): both ratings change, each player gets theirs.
  function rateRanked(room: Room, winner: number, reason: number) {
    const players: [string, string] = [room.players[0].id, room.players[1].id];
    accounts.rateDuel({ players, winner: winner === 0 || winner === 1 ? winner : null, reason }).then(
      (ratings) => ratings.forEach(({ before, after }, index) => send(room.players[index]?.socket, { type: "ranked_result", delta: after - before, rating: after })),
      (error: unknown) => console.error(error),
    );
  }

  function sit(room: Room, id: string, socket: WebSocket, deck: ActiveDeck, name?: string, avatar?: number): Seat | undefined {
    const known = room.players.findIndex((player) => player.id === id);
    if (known === -1 && room.players.length === 2) return undefined;
    const isNew = known === -1;
    const seat = (isNew ? room.players.push({ id, name, avatar, log: [], deck: deck.main, deckId: deck.id, extra: deck.extra }) - 1 : known) as Seat;
    const player = room.players[seat];
    if (player.socket !== socket) player.socket?.close();
    player.socket = socket;
    clearTimeout(room.timer);
    sendJoined(room, seat);
    back(room, seat);
    // The host's first `joined` guessed the guest's deck size as 0: correct it once they arrive.
    if (isNew && seat === 1) sendJoined(room, 0);
    if (room.question?.player === seat) ask(room, false);
    const pending = rematchMessage(room);
    if (pending) send(player.socket, pending);
    if (room.watch?.sockets.length) send(player.socket, { type: "spectators", count: room.watch.sockets.length });
    if (isNew && seat === 1) start(room, newSeed()).catch((error: unknown) => console.error(error));
    return seat;
  }

  function addBot(room: Room, deck: ActiveDeck, name: string, level?: BotLevel) {
    const player: Player = { id: "bot", name, log: [], deck: deck.main, extra: deck.extra };
    room.players.push(player);
    room.level = level;
    player.bot = newBot(room);
    sendJoined(room, 0);
    start(room, newSeed()).catch((error: unknown) => console.error(error));
  }

  // A challenge between friends: the challenger hosts a new online room, the one who accepted joins it.
  const friends = friendHub<FriendEntry>(accounts, send, async (challenger, acceptor, options) => {
    const where = limitsOf({ options });
    const [host, guest] = await Promise.all([challenger.deck(where), acceptor.deck(where)]);
    if (typeof host === "string") return "l'adversaire n'a pas de deck actif valide";
    if (typeof guest === "string") return guest;
    const room: Room = { code: newCode(rooms), players: [], mode: { mode: "online" }, ...customRoom(options) };
    room.onWin = (winner) => creditWinner(room, winner as Seat, accounts);
    return challenger.enter(room, host) ?? acceptor.enter(room, guest);
  }, (code) => rooms.get(code)?.watch !== undefined);

  const newBot = (room: Room) => new Bot(1, lpOf(rulesOf(room), 1), deckSizes(room), botDelay, extraSizes(room), room.level);

  // A new duel in the same room, from empty logs. The caller has checked `room.over`.
  function restart(room: Room) {
    room.over = false;
    room.rematch = undefined;
    for (const player of room.players) {
      player.log = [];
      player.stats = undefined;
      if (player.bot) player.bot = newBot(room);
    }
    room.players.forEach((_player, index) => sendJoined(room, index as Seat));
    start(room, newSeed()).catch((error: unknown) => console.error(error));
  }

  // After a tower duel: the next floor once its win is recorded, floor 1 after a loss.
  async function climb(room: Room, tower: NonNullable<Room["tower"]>) {
    await tower.saved;
    towerFloor(room, await accounts.startTower(room.players[0].id), accounts);
  }

  function leave(room: Room, socket: WebSocket) {
    const seat = room.players.findIndex((seated) => seated.socket === socket);
    if (seat !== -1) {
      room.players[seat].socket = undefined;
      away(room, seat as Seat);
      if (room.over && online(room) && room.rematch !== "declined") declineRematch(room);
    }
    if (room.players.some((player) => player.socket)) return;
    room.timer = setTimeout(() => {
      if (room.forfeit) finish(room, 1, CONNECTION_LOST);
      endDuel(room);
      rooms.delete(room.code);
    }, ROOM_TTL).unref();
  }

  wss.on("connection", (socket) => {
    let user: { id: string; pseudo?: string; avatar?: number } | undefined;
    let seat: { room: Room; index: Seat } | undefined;
    let watching: Room | undefined;
    // Messages are handled one at a time, so an action sent right after `auth` waits for its verification.
    let queue = Promise.resolve();
    if (draining) send(socket, { type: "maintenance" });

    async function identify(token: string): Promise<string | undefined> {
      if (user) return "déjà authentifié";
      const id = await accounts.verify(token);
      if (!id) return "jeton invalide";
      const profile = await accounts.findProfile(id);
      const [cards, daily] = profile ? await Promise.all([accounts.profileCards(id), accounts.claimDaily(id)]) : [undefined, false];
      user = { id, pseudo: profile?.pseudo, avatar: cards?.avatar ?? undefined };
      if (user.pseudo) joinFriends(user.id, user.pseudo);
      send(socket, { type: "profile", pseudo: user.pseudo ?? null, needsStarter: profile !== undefined && profile.activeDeckId === null, ...adminFlag(id), ...dailyFlag(daily) });
      return undefined;
    }

    async function choosePseudo(player: { id: string; pseudo?: string }, pseudo: string): Promise<string | undefined> {
      if (player.pseudo) return "pseudo déjà choisi";
      if (!PSEUDO.test(pseudo)) return "pseudo invalide : 3 à 20 caractères, lettres sans accent, chiffres, _ ou -";
      const profile = await accounts.createProfile(player.id, pseudo);
      if (!profile) return "pseudo déjà pris";
      player.pseudo = profile.pseudo;
      joinFriends(player.id, profile.pseudo);
      const daily = await accounts.claimDaily(player.id);
      send(socket, { type: "profile", pseudo: profile.pseudo, needsStarter: profile.activeDeckId === null, ...adminFlag(player.id), ...dailyFlag(daily) });
      return undefined;
    }

    async function pickStarter(player: { id: string; pseudo?: string }, starter: Starter): Promise<string | undefined> {
      const chosen = await accounts.chooseStarter(player.id, starter);
      if (!chosen) return "starter déjà choisi";
      send(socket, { type: "profile", pseudo: player.pseudo ?? null, needsStarter: false, ...adminFlag(player.id) });
      return undefined;
    }

    async function manageDecks(player: { id: string }, msg: DeckMessage): Promise<string | undefined> {
      const reply = await deckReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    async function manageWishes(player: { id: string }, msg: WishMessage): Promise<string | undefined> {
      const reply = await wishReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    async function manageEconomy(player: { id: string }, msg: EconomyMessage): Promise<string | undefined> {
      const reply = await economyReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    async function manageWonder(player: { id: string }, msg: WonderMessage): Promise<string | undefined> {
      const reply = await wonderReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    async function manageProfile(player: { id: string; avatar?: number }, msg: ProfileMessage): Promise<string | undefined> {
      const reply = await profileReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      if (reply.type === "player_profile") player.avatar = reply.avatar ?? undefined;
      send(socket, reply);
      return undefined;
    }

    async function grantBoosters(player: { id: string }, count: number): Promise<string | undefined> {
      if (!admins.has(player.id)) return "commande réservée";
      await accounts.creditBoosters(player.id, count);
      return sendBoosterState(player);
    }

    async function sendBoosterState(player: { id: string }): Promise<string | undefined> {
      send(socket, { type: "booster_state", ...(await accounts.boosterState(player.id)) });
      return undefined;
    }

    async function openBoosterFor(player: { id: string }, set: string): Promise<string | undefined> {
      try {
        send(socket, { type: "booster_opened", set, cards: await accounts.openBooster(player.id, set) });
        progressMissions(player.id, { gains: { boosters: 1 } }, { socket });
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : "erreur inattendue";
      }
    }

    // The active deck of the player, or the error that keeps them out of a duel. `where` ("en classé") also holds it to the Goat list.
    async function duelDeck(userId: string, where?: string): Promise<ActiveDeck | string> {
      const deck = await accounts.activeDeck(userId);
      if (!deck) return "deck actif requis";
      if (!validDeck(deck)) return "deck actif invalide";
      const over = where && limitError([...deck.main, ...deck.extra], poolCard, GOAT, where);
      return over || deck;
    }

    // Stores the result of the duel for each human player. A failure is logged, the duel is over anyway.
    function recordResults(room: Room, winner: Seat, reason: number) {
      const { mode } = room;
      if (!mode) return;
      room.players.forEach((player, index) => {
        if (player.bot) return;
        const result = { userId: player.id, deckId: player.deckId, ...mode, won: index === winner, reason, turns: room.turns ?? 0 };
        accounts.recordResult(result).catch((error: unknown) => console.error(error));
        progressMissions(player.id, missionProgress(room, index as Seat, winner, reason), player);
      });
    }

    // The player gets their missions once the progress is recorded, on the socket they have by then.
    function progressMissions(userId: string, progress: MissionProgress, to: { socket?: WebSocket }) {
      accounts.progressMissions(userId, progress).then(
        (view) => send(to.socket, { type: "missions", ...view }),
        (error: unknown) => console.error(error),
      );
    }

    async function showMissions(userId: string): Promise<undefined> {
      send(socket, { type: "missions", ...(await accounts.missions(userId)) });
      return undefined;
    }

    // Keeps the duel for each human player to watch again, unless it is too long to store.
    function recordReplays(room: Room, winner: Seat, reason: number) {
      const report = reportOf(room);
      if (!report || JSON.stringify(report).length > REPORT_BYTES) return;
      room.players.forEach((player, index) => {
        if (player.bot) return;
        accounts.saveReplay(historyEntry(room, report, index as Seat, winner, reason)).catch((error: unknown) => console.error(error));
      });
    }

    async function sendReplays(userId: string): Promise<undefined> {
      send(socket, { type: "replays", replays: await accounts.replays(userId) });
      return undefined;
    }

    async function showReplay(userId: string, id: number): Promise<string | undefined> {
      if (!replayAllowed(replaysAsked, userId)) return REPLAYS_LIMITED;
      const stored = await accounts.readReplay(userId, id);
      if (!stored) return "duel introuvable";
      send(socket, await replayMessage(stored, id));
      return undefined;
    }

    function enter(userId: string, room: Room, deck: ActiveDeck, bot?: { deck: ActiveDeck; name: string; level?: BotLevel }): string | undefined {
      if (seat) return "déjà dans une salle";
      // While stopping, only a player coming back to their seat gets in: no new room, no new guest.
      if (draining && !room.players.some((player) => player.id === userId)) return MAINTENANCE;
      room.onEnd = (winner, reason) => {
        recordResults(room, winner, reason);
        recordReplays(room, winner, reason);
        if (room.ranked) rateRanked(room, winner, reason);
      };
      rooms.set(room.code, room);
      const index = sit(room, userId, socket, deck, user?.pseudo, user?.avatar);
      if (index === undefined) return "salle complète";
      seat = { room, index };
      room.onWatch = () => friends.opened(room.code);
      friends.seat(socket, room.code);
      if (bot) addBot(room, bot.deck, bot.name, bot.level);
      return undefined;
    }

    // The first win of the week in an event room earns a booster, for a human seat only.
    function rewardEvent(room: Room, seat: number) {
      const player = room.players[seat];
      if (!room.event || !player || player.bot) return;
      accounts.claimEvent(player.id, room.event.id).then(
        (earned) => {
          if (earned) send(player.socket, { type: "event_won" });
        },
        (error: unknown) => console.error(error),
      );
    }

    // The bot of a quick duel sometimes greets and compliments its winner, as a player would.
    function enterBotRoom(userId: string, room: Room, deck: ActiveDeck, level?: BotLevel): string | undefined {
      const botSays = (id: EmoteId) => sendAll(room, { type: "emote", seat: 1, id });
      room.onWin = (winner) => {
        if (winner === 0) botSays("bienjoue");
        rewardEvent(room, winner);
      };
      const error = enter(userId, room, deck, { deck: { main: KAIBA, extra: [] }, name: "Bot", level });
      if (!error && randomInt(2) === 0) setTimeout(() => botSays("bonduel"), BOT_GREETING_DELAY).unref();
      return error;
    }

    // An online room rewards its winner with a booster, a quick duel against the bot rewards nothing.
    async function enterRoom(userId: string, msg: Extract<ClientMessage, { type: "create" | "join" | "bot" }>): Promise<string | undefined> {
      const joined = msg.type === "join" ? rooms.get(msg.room.toUpperCase()) : undefined;
      const deck = await duelDeck(userId, limitsOf(msg.type === "join" ? joined : msg));
      if (typeof deck === "string") return deck;
      if (msg.type === "join") return joined ? enter(userId, joined, deck) : "salle introuvable";
      const room: Room = { code: newCode(rooms), players: [], mode: { mode: "online" }, ...(msg.type === "create" && customRoom(msg.options)) };
      if (msg.event) {
        room.event = eventOf();
        room.rules = eventRules(room.event);
      }
      if (msg.type === "bot") {
        room.mode = { mode: "bot", level: msg.level ?? "normal" };
        return enterBotRoom(userId, room, deck, msg.level);
      }
      room.onWin = (winner) => {
        creditWinner(room, winner as Seat, accounts);
        rewardEvent(room, winner);
      };
      return enter(userId, room, deck);
    }

    async function manageLimited(player: { id: string }, msg: SealedMessage | DraftMessage): Promise<string | undefined> {
      const reply = isDraftMessage(msg) ? await draftReply(accounts, player.id, msg) : await sealedReply(accounts, player.id, msg);
      if (typeof reply === "string") return reply;
      send(socket, reply);
      return undefined;
    }

    // The next duel of a Sealed or Draft session, against the bot at "normal" with the `opponent` deck. `record` counts it and tells the player.
    // A duel left unfinished resumes; left until its room expires, it is lost. A draw does not count.
    async function playLimited<R extends { id: number; status: string; main: number[] | null; extra: number[] | null }>(
      userId: string,
      forfeit: NonNullable<Room["forfeit"]>,
      run: R | undefined,
      opponent: (run: R) => ActiveDeck | Promise<ActiveDeck>,
      record: (run: R, won: boolean) => Promise<ServerMessage | undefined>,
    ): Promise<string | undefined> {
      const running = [...rooms.values()].find((room) => room.forfeit === forfeit && room.duel && room.players[0]?.id === userId);
      if (running) return enter(userId, running, { main: [], extra: [] });
      if (run?.status !== "playing" || !run.main) return `aucun duel ${forfeit} à jouer`;
      const room: Room = { code: newCode(rooms), players: [], mode: { mode: "bot", level: "normal" }, forfeit };
      room.onWin = (winner) => {
        if (winner > 1) return;
        record(run, winner === 0).then(
          (updated) => {
            if (updated) send(room.players[0]?.socket, updated);
          },
          (error: unknown) => console.error(error),
        );
      };
      return enter(userId, room, { main: run.main, extra: run.extra ?? [] }, { deck: await opponent(run), name: "Bot", level: "normal" });
    }

    // Against a bot deck drawn from 6 boosters of the session's set.
    async function playSealed(userId: string): Promise<string | undefined> {
      return playLimited(userId, "Scellé", await accounts.sealedRun(userId), (run) => botDeck(run.set), async (run, won) => {
        const updated = await accounts.sealedResult(userId, run.id, won);
        return updated && { type: "sealed", run: updated };
      });
    }

    // Against the deck of a bot of the draft.
    async function playDraft(userId: string): Promise<string | undefined> {
      return playLimited(userId, "Draft", await accounts.draftRun(userId), (run) => accounts.draftBotDeck(run.id), async (run, won) => {
        const updated = await accounts.draftResult(userId, run.id, won);
        return updated && { type: "draft", run: updated };
      });
    }

    // Only a room with two players and no bot has a public log to watch.
    function spectate(code: string): string | undefined {
      const room = rooms.get(code.toUpperCase());
      if (!room) return "salle introuvable";
      if (!room.watch) return "aucun duel en ligne à regarder dans cette salle";
      if (room.watch.sockets.length >= SPECTATORS_MAX) return "trop de spectateurs dans cette salle";
      room.watch.sockets.push(socket);
      watching = room;
      sendWatching(room, socket);
      sendSpectators(room);
      return undefined;
    }

    function stopWatching(room: Room) {
      const sockets = room.watch?.sockets;
      const index = sockets?.indexOf(socket) ?? -1;
      if (index === -1) return;
      sockets?.splice(index, 1);
      sendSpectators(room);
    }

    async function reportBug(room: Room, userId: string, text = ""): Promise<string | undefined> {
      const message = text.trim();
      if (message.length > REPORT_MAX) return `texte trop long : ${REPORT_MAX} caractères au maximum`;
      const report = reportOf(room);
      if (!report) return "aucun duel à signaler";
      if (JSON.stringify(report).length > REPORT_BYTES) return "duel trop long pour être signalé";
      if (!(await accounts.saveReport(userId, message, report))) return "trop de signalements, réessayez dans une heure";
      send(socket, { type: "report_sent" });
      return undefined;
    }

    async function showStory(userId: string): Promise<undefined> {
      const [progress, revenges] = await Promise.all([accounts.storyProgress(userId), accounts.revengesWon(userId)]);
      send(socket, { type: "story", arcs: storyView(progress, STORY, revenges) });
      return undefined;
    }

    function recordWin(room: Room, duel: StoryDuel, recorded: Promise<StoryResult | RevengeResult>) {
      recorded.then(
        (result) => send(room.players[0]?.socket, { type: "story_won", duel: duel.id, outro: duel.outro, ...result }),
        (error: unknown) => {
          console.error(error);
          send(room.players[0]?.socket, { type: "error", error: "victoire non enregistrée, rejouez le duel plus tard" });
        },
      );
    }

    // The player keeps seat 0 against the bot; only their win counts. A revenge is the boss duel with its reinforced deck, at
    // the Expert level, once its arc is finished; its win records no stars.
    async function playStory(userId: string, id: string, level?: StoryLevel, revenge?: true): Promise<string | undefined> {
      const boss = revenge ? STORY_REVENGES.get(id) : undefined;
      if (revenge && !boss) return "pas de revanche pour ce duel";
      const duel = boss?.duel ?? STORY_DUELS.get(id);
      if (!duel) return "duel d'histoire inconnu";
      if (!isUnlocked(duel, await accounts.storyProgress(userId))) return boss ? "revanche verrouillée : terminez d'abord l'arc" : "duel verrouillé : gagnez d'abord les duels précédents";
      const deck = playerDeck(duel) ?? (await duelDeck(userId));
      if (typeof deck === "string") return deck;
      const rules = storyRules(duel, boss ? undefined : level);
      const room: Room = { code: newCode(rooms), players: [], rules, mode: { mode: "story", level: boss ? "revanche" : (level ?? "normal") } };
      // The duel is still open when its winner is known: its LP give the stars.
      room.onWin = (winner) => {
        if (winner !== 0 || !room.duel) return;
        const stars = storyStars(level === "facile", lpLeft(room.duel, 0), lpOf(rules, 0));
        recordWin(room, duel, boss ? accounts.completeRevenge(userId, boss.arc) : accounts.completeStory(userId, duel, stars));
      };
      return enter(userId, room, deck, { deck: { main: storyDeck(duel), extra: storyExtra(duel) }, name: duel.opponent, level: boss ? "expert" : undefined });
    }

    async function showEvent(userId: string): Promise<undefined> {
      const { id, rule, lp, hand } = eventOf();
      send(socket, { type: "event", rule, lp, hand, won: await accounts.eventWon(userId, id) });
      return undefined;
    }

    // Against the bot, a rematch starts at once (the next floor of the tower). Online, it starts once both seats asked, with their active decks of the moment.
    async function rematch(room: Room, index: Seat, accept: boolean): Promise<string | undefined> {
      if (!room.over) return "aucun duel terminé";
      if (draining) return MAINTENANCE;
      if (room.forfeit) return `le duel suivant se lance depuis l'écran ${room.forfeit}`;
      if (room.ranked) return "pas de revanche en classé";
      const bot = room.players.some((player) => player.bot);
      if (room.rematch === "declined") return "revanche refusée";
      if (!accept) {
        if (!bot) declineRematch(room);
        return undefined;
      }
      if (bot) {
        // Set first: a second rematch cannot climb twice.
        room.over = false;
        if (room.tower) await climb(room, room.tower);
        restart(room);
        return undefined;
      }
      if (!room.players[1 - index]?.socket) {
        declineRematch(room);
        return undefined;
      }
      if (room.rematch === undefined) {
        room.rematch = index;
        sendAll(room, { type: "rematch", from: index });
        return undefined;
      }
      if (room.rematch === index) return undefined;
      room.over = false;
      const decks = await Promise.all(room.players.map((player) => duelDeck(player.id, limitsOf(room))));
      const invalid = decks.find((deck): deck is string => typeof deck === "string");
      if (invalid !== undefined) {
        room.over = true;
        declineRematch(room);
        return invalid;
      }
      room.players.forEach((player, seatIndex) => {
        const deck = decks[seatIndex] as ActiveDeck;
        player.deck = deck.main;
        player.deckId = deck.id;
        player.extra = deck.extra;
      });
      restart(room);
      return undefined;
    }

    async function showPuzzles(userId: string): Promise<undefined> {
      send(socket, { type: "puzzles", puzzles: puzzleView(await accounts.solvedPuzzles(userId)) });
      return undefined;
    }

    // The player keeps seat 0 against the Normal bot, from a state set up by hand, without their deck; only their win counts,
    // recorded by `solve` and announced as `puzzle_won` with `id`.
    function playSetUp(userId: string, room: Room, id: string, solve: () => Promise<boolean>, retry: string): string | undefined {
      room.onWin = (winner) => {
        if (winner !== 0) return;
        solve().then(
          (booster) => send(room.players[0]?.socket, { type: "puzzle_won", id, booster }),
          (error: unknown) => {
            console.error(error);
            send(room.players[0]?.socket, { type: "error", error: retry });
          },
        );
      };
      const empty = { main: [], extra: [] };
      return enter(userId, room, empty, { deck: empty, name: "Bot", level: "normal" });
    }

    function playPuzzle(userId: string, id: string): string | undefined {
      const puzzle = PUZZLE_IDS.get(id);
      if (!puzzle) return "puzzle inconnu";
      const room: Room = { code: newCode(rooms), players: [], rules: puzzleRules(puzzle), field: puzzleField(puzzle), turnLimit: PUZZLE_TURNS };
      return playSetUp(userId, room, id, () => accounts.solvePuzzle(userId, id), "réussite non enregistrée, rejouez le puzzle plus tard");
    }

    // The guided duel of client/src/tutoriel.ts, without turn limit.
    function playTutorial(userId: string): string | undefined {
      const room: Room = { code: newCode(rooms), players: [], rules: TUTORIAL_RULES, field: TUTORIAL_FIELD };
      return playSetUp(userId, room, "tutorial", () => accounts.finishTutorial(userId), "victoire non enregistrée, rejouez le tutoriel plus tard");
    }

    async function showTower(userId: string): Promise<undefined> {
      send(socket, { type: "tower", ...(await accounts.towerView(userId)) });
      return undefined;
    }

    // The player keeps seat 0 against the bot of the floor. The deck is checked first: an invalid one keeps the progression.
    async function playTower(userId: string): Promise<string | undefined> {
      const deck = await duelDeck(userId);
      if (typeof deck === "string") return deck;
      const room: Room = { code: newCode(rooms), players: [] };
      const floor = await accounts.startTower(userId);
      towerFloor(room, floor, accounts);
      const { name, main, extra } = TOWER[floor - 1];
      return enter(userId, room, deck, { deck: { main, extra }, name, level: room.level });
    }

    // What the friend hub needs to seat this connection in the room of an accepted challenge.
    function joinFriends(id: string, pseudo: string) {
      friends.join(socket, id, pseudo, {
        deck: (where) => duelDeck(id, where),
        enter: (room, deck) => (socket.readyState === socket.OPEN ? enter(id, room, deck) : "adversaire déconnecté"),
      });
    }

    async function sendResults(userId: string): Promise<undefined> {
      send(socket, { type: "duel_results", results: await accounts.duelResults(userId) });
      return undefined;
    }

    async function showRanked(userId: string): Promise<undefined> {
      send(socket, { type: "ranked", ...(await accounts.ranked(userId)) });
      return undefined;
    }

    // Waits in the ranked queue with the active deck of the moment, until matched or disconnected.
    async function queueRanked(userId: string): Promise<string | undefined> {
      const deck = await duelDeck(userId, "en classé");
      if (typeof deck === "string") return deck;
      const { rating } = await accounts.rating(userId);
      if (socket.readyState !== socket.OPEN) return undefined;
      waiting.set(userId, { id: userId, rating, since: Date.now(), socket, join: (room) => enter(userId, room, deck) });
      send(socket, { type: "ranked_queue", waiting: true });
      matchQueue();
      return undefined;
    }

    function leaveQueue(userId: string) {
      if (waiting.get(userId)?.socket === socket) waiting.delete(userId);
    }

    // A challenge under the Goat list is sent only by a host whose own deck follows it.
    async function challengeFriend(userId: string, msg: Extract<ClientMessage, { type: "challenge" }>): Promise<string | undefined> {
      const deck = msg.options?.goat ? await duelDeck(userId, ROOM_LIMITS) : undefined;
      return typeof deck === "string" ? deck : friends.handle(socket, msg);
    }

    // The custom rules of a room, shown to a guest before they join.
    function showRoomRules(code: string): string | undefined {
      const room = rooms.get(code.toUpperCase());
      if (!room) return "salle introuvable";
      send(socket, { type: "room_rules", room: room.code, options: room.options });
      return undefined;
    }

    // Returns an error for the sender, if any.
    function handle(msg: ClientMessage): string | undefined | Promise<string | undefined> {
      if (msg.type === "auth") return identify(msg.token);
      if (!user) return "non authentifié";
      if (msg.type === "pseudo") return choosePseudo(user, msg.pseudo);
      if (!user.pseudo) return "pseudo à choisir d'abord";
      if (msg.type === "starter") return pickStarter(user, msg.starter);
      if (isDeckMessage(msg)) return manageDecks(user, msg);
      if (isWishMessage(msg)) return manageWishes(user, msg);
      if (isEconomyMessage(msg)) return manageEconomy(user, msg);
      if (isWonderMessage(msg)) return manageWonder(user, msg);
      if (isProfileMessage(msg)) return manageProfile(user, msg);
      if (isSealedMessage(msg) || isDraftMessage(msg)) return manageLimited(user, msg);
      if (msg.type === "challenge") return challengeFriend(user.id, msg);
      if (isFriendMessage(msg)) return friends.handle(socket, msg);
      if (isTradeMessage(msg)) return tradeReply(accounts, { id: user.id, pseudo: user.pseudo }, msg, friends.sendTo);
      if (msg.type === "booster_state") return sendBoosterState(user);
      if (msg.type === "open_booster") return openBoosterFor(user, msg.set);
      if (msg.type === "admin_boosters") return grantBoosters(user, msg.count);
      if (msg.type === "story") return showStory(user.id);
      if (msg.type === "duel_results") return sendResults(user.id);
      if (msg.type === "event") return showEvent(user.id);
      if (msg.type === "puzzles") return showPuzzles(user.id);
      if (msg.type === "tower") return showTower(user.id);
      if (msg.type === "ranked") return showRanked(user.id);
      if (msg.type === "missions") return showMissions(user.id);
      if (msg.type === "replays") return sendReplays(user.id);
      if (msg.type === "replay") return showReplay(user.id, msg.id);
      if (msg.type === "ranked_cancel") {
        leaveQueue(user.id);
        send(socket, { type: "ranked_queue", waiting: false });
        return undefined;
      }
      if (msg.type === "respond") return seat ? answer(seat.room, seat.index, msg.response) : "pas dans une salle";
      if (msg.type === "surrender") return seat ? surrender(seat.room, seat.index) : "pas dans une salle";
      if (msg.type === "emote") return seat ? emote(seat.room, seat.index, msg.id) : "pas dans une salle";
      if (msg.type === "report") return seat ? reportBug(seat.room, user.id, msg.message) : "pas dans une salle";
      if (msg.type === "rematch") return seat ? rematch(seat.room, seat.index, msg.accept !== false) : "pas dans une salle";
      if (seat || watching) return "déjà dans une salle";
      if (waiting.has(user.id)) return "recherche d'un adversaire classé en cours";
      // Before any side effect: a tower duel starts by resetting the floor, the ranked queue would wait for nothing.
      if (draining && !RESUMING.has(msg.type)) return MAINTENANCE;
      if (msg.type === "spectate") return spectate(msg.room);
      if (msg.type === "room_rules") return showRoomRules(msg.room);
      if (msg.type === "ranked_queue") return queueRanked(user.id);
      if (msg.type === "story_duel") return playStory(user.id, msg.duel, msg.level, msg.revenge);
      if (msg.type === "puzzle") return playPuzzle(user.id, msg.id);
      if (msg.type === "tutorial") return playTutorial(user.id);
      if (msg.type === "tower_duel") return playTower(user.id);
      if (msg.type === "sealed_duel") return playSealed(user.id);
      if (msg.type === "draft_duel") return playDraft(user.id);
      return enterRoom(user.id, msg);
    }

    socket.on("close", () => {
      friends.leave(socket);
      if (user) leaveQueue(user.id);
      if (seat) leave(seat.room, socket);
      if (watching) stopWatching(watching);
    });
    socket.on("message", (data) => {
      queue = queue.then(async () => {
        if (socket.readyState !== socket.OPEN) return;
        const msg = parse(String(data));
        let error: string | undefined;
        try {
          error = msg ? await handle(msg) : "message invalide";
        } catch (failure) {
          console.error(failure);
          error = "service indisponible, réessayer plus tard";
        }
        if (error) send(socket, { type: "error", error });
      });
    });
  });
  return Object.assign(wss, { shutdown });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  const server = startServer(port, dbAccounts(openDb()));
  console.log(`Serveur de partie sur http://localhost:${port} (WebSocket et /api)`);
  // Missing artworks download in the background: the server answers without them meanwhile.
  if ([...SERVED].some((code) => !existsSync(artFile(code)))) {
    spawn(process.execPath, [join(import.meta.dirname, "..", "scripts", "images.ts")], { stdio: "inherit" }).on("error", console.error);
  }
  // As PID 1 in a container, Node ignores SIGTERM without a handler.
  // Each deployment stops the old container this way: the duels in progress end first (DEPLOY.md).
  process.once("SIGTERM", () => {
    console.log("Arrêt demandé : plus de nouveau duel, fin des duels en cours");
    server.shutdown(Number(process.env.SHUTDOWN_MINUTES ?? 15) * 60_000).then(() => process.exit());
  });
}
