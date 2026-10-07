import { randomInt } from "node:crypto";
import type { WebSocket } from "ws";
import type { Accounts } from "./accounts.ts";
import { ROOM_LIMITS, roomRules } from "./custom.ts";
import type { ActiveDeck } from "./db.ts";
import { KAIBA } from "./decks.ts";
import { lpLeft, lpOf } from "./duel.ts";
import type { EmoteId } from "./emotes.ts";
import { eventOf, eventRules } from "./event.ts";
import { duelDeck, enter, limitsOf, MAINTENANCE, type Connection, type FriendEntry, type Lobby, type Queued } from "./lobby.ts";
import { SPECTATORS_MAX, type BotLevel, type ClientMessage, type RevengeResult, type RoomOptions, type Seat, type ServerMessage, type StoryLevel, type StoryResult } from "./protocol.ts";
import { PUZZLE_IDS, PUZZLE_TURNS, puzzleField, puzzleRules } from "./puzzles.ts";
import { pairUp } from "./ranked.ts";
import { creditWinner, towerFloor } from "./rewards.ts";
import { newCode, sendAll, sendSpectators, sendWatching, type Room } from "./room.ts";
import { botDeck } from "./sealed.ts";
import { isUnlocked, playerDeck, STORY_DUELS, STORY_REVENGES, storyDeck, storyExtra, storyRules, storyStars, type StoryDuel } from "./story.ts";
import { TOWER } from "./tower.ts";
import { TUTORIAL_FIELD, TUTORIAL_RULES } from "./tutorial.ts";
import { send } from "./wire.ts";

// The bot greets this long after the room opens, once the client has the duel on screen.
const BOT_GREETING_DELAY = 1500;
const NO_ROOM = "salle introuvable";

// The custom rules of a room: its options and the duel rules built from them, nothing for a standard room.
const customRoom = (options?: RoomOptions): Pick<Room, "options" | "rules"> => (options ? { options, rules: roomRules(options) } : {});

// A new online room for a pair found: a ranked one rates its duel, a quick one is a normal online duel.
function openRoom(lobby: Lobby, pair: Queued[], ranked?: true) {
  const room: Room = { code: newCode(lobby.rooms), players: [], mode: { mode: "online" }, ...(ranked && { ranked }) };
  room.onWin = (winner) => creditWinner(room, winner as Seat, lobby.accounts);
  for (const player of pair) player.join(room);
}

// The ranked window of each player widens as they wait; the quick queue pairs the two who have waited the longest.
export function matchQueue(lobby: Lobby) {
  const { waiting, quick, lastOpponent } = lobby;
  const now = Date.now();
  for (const pair of pairUp([...waiting.values()], now, lastOpponent)) {
    pair.forEach((player, index) => {
      waiting.delete(player.id);
      lastOpponent.set(player.id, { opponent: pair[1 - index].id, at: now });
    });
    openRoom(lobby, pair, true);
  }
  const queued = [...quick.values()].sort((a, b) => a.since - b.since);
  for (let i = 1; i < queued.length; i += 2) {
    const pair = [queued[i - 1], queued[i]];
    for (const player of pair) quick.delete(player.id);
    openRoom(lobby, pair);
  }
}

// Waits in the ranked queue with the active deck of the moment, until matched or disconnected.
export async function queueRanked(conn: Connection, userId: string): Promise<string | undefined> {
  const { lobby, socket } = conn;
  const deck = await duelDeck(lobby.accounts, userId, "en classé");
  if (typeof deck === "string") return deck;
  const { rating } = await lobby.accounts.rating(userId);
  if (socket.readyState !== socket.OPEN) return undefined;
  lobby.waiting.set(userId, { id: userId, rating, since: Date.now(), socket, join: (room) => enter(conn, userId, room, deck) });
  send(socket, { type: "ranked_queue", waiting: true });
  matchQueue(lobby);
  return undefined;
}

// Waits in the quick queue with the active deck, no Goat list: an invalid deck never waits.
export async function queueQuick(conn: Connection, userId: string): Promise<string | undefined> {
  const { lobby, socket } = conn;
  const deck = await duelDeck(lobby.accounts, userId);
  if (typeof deck === "string") return deck;
  if (lobby.draining) return MAINTENANCE;
  if (socket.readyState !== socket.OPEN) return undefined;
  lobby.quick.set(userId, { id: userId, since: Date.now(), socket, join: (room) => enter(conn, userId, room, deck) });
  send(socket, { type: "quick_queue", waiting: true });
  matchQueue(lobby);
  return undefined;
}

// Leaves the given queues (both by default) this connection waits in.
export function leaveQueue(conn: Connection, userId: string, queues: Map<string, { socket: WebSocket }>[] = [conn.lobby.waiting, conn.lobby.quick]) {
  for (const queue of queues) {
    if (queue.get(userId)?.socket === conn.socket) queue.delete(userId);
  }
}

// A challenge between friends: the challenger hosts a new online room, the one who accepted joins it.
export async function challengeDuel(lobby: Lobby, challenger: FriendEntry, acceptor: FriendEntry, options?: RoomOptions): Promise<string | undefined> {
  const where = limitsOf({ options });
  const [host, guest] = await Promise.all([challenger.deck(where), acceptor.deck(where)]);
  if (typeof host === "string") return "l'adversaire n'a pas de deck actif valide";
  if (typeof guest === "string") return guest;
  const room: Room = { code: newCode(lobby.rooms), players: [], mode: { mode: "online" }, ...customRoom(options) };
  room.onWin = (winner) => creditWinner(room, winner as Seat, lobby.accounts);
  return challenger.enter(room, host) ?? acceptor.enter(room, guest);
}

// A challenge under the Goat list is sent only by a host whose own deck follows it.
export async function challengeFriend(conn: Connection, userId: string, msg: Extract<ClientMessage, { type: "challenge" }>): Promise<string | undefined> {
  const deck = msg.options?.goat ? await duelDeck(conn.lobby.accounts, userId, ROOM_LIMITS) : undefined;
  return typeof deck === "string" ? deck : conn.lobby.friends.handle(conn.socket, msg);
}

// The first win of the week in an event room earns a booster, for a human seat only.
function rewardEvent(accounts: Accounts, room: Room, seat: number) {
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
function enterBotRoom(conn: Connection, userId: string, room: Room, deck: ActiveDeck, level?: BotLevel): string | undefined {
  const botSays = (id: EmoteId) => sendAll(room, { type: "emote", seat: 1, id });
  room.onWin = (winner) => {
    if (winner === 0) botSays("bienjoue");
    rewardEvent(conn.lobby.accounts, room, winner);
  };
  const error = enter(conn, userId, room, deck, { deck: { main: KAIBA, extra: [] }, name: "Bot", level });
  if (!error && randomInt(2) === 0) setTimeout(() => botSays("bonduel"), BOT_GREETING_DELAY).unref();
  return error;
}

// An online room rewards its winner with a booster, a quick duel against the bot rewards nothing.
export async function enterRoom(conn: Connection, userId: string, msg: Extract<ClientMessage, { type: "create" | "join" | "bot" }>): Promise<string | undefined> {
  const { rooms, accounts } = conn.lobby;
  const joined = msg.type === "join" ? rooms.get(msg.room.toUpperCase()) : undefined;
  const deck = await duelDeck(accounts, userId, limitsOf(msg.type === "join" ? joined : msg));
  if (typeof deck === "string") return deck;
  if (msg.type === "join") return joined ? enter(conn, userId, joined, deck) : NO_ROOM;
  const room: Room = { code: newCode(rooms), players: [], mode: { mode: "online" }, ...(msg.type === "create" && customRoom(msg.options)) };
  if (msg.event) {
    room.event = eventOf();
    room.rules = eventRules(room.event);
  }
  if (msg.type === "bot") {
    room.mode = { mode: "bot", level: msg.level ?? "normal" };
    return enterBotRoom(conn, userId, room, deck, msg.level);
  }
  room.onWin = (winner) => {
    creditWinner(room, winner as Seat, accounts);
    rewardEvent(accounts, room, winner);
  };
  return enter(conn, userId, room, deck);
}

// The next duel of a Sealed or Draft session, against the bot at "normal" with the `opponent` deck. `record` counts it and tells the player.
// A duel left unfinished resumes; left until its room expires, it is lost. A draw does not count.
async function playLimited<R extends { id: number; status: string; main: number[] | null; extra: number[] | null }>(
  conn: Connection,
  userId: string,
  forfeit: NonNullable<Room["forfeit"]>,
  run: R | undefined,
  opponent: (run: R) => ActiveDeck | Promise<ActiveDeck>,
  record: (run: R, won: boolean) => Promise<ServerMessage | undefined>,
): Promise<string | undefined> {
  const { rooms } = conn.lobby;
  const running = [...rooms.values()].find((room) => room.forfeit === forfeit && room.duel && room.players[0]?.id === userId);
  if (running) return enter(conn, userId, running, { main: [], extra: [] });
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
  return enter(conn, userId, room, { main: run.main, extra: run.extra ?? [] }, { deck: await opponent(run), name: "Bot", level: "normal" });
}

// Against a bot deck drawn from 6 boosters of the session's set.
export async function playSealed(conn: Connection, userId: string): Promise<string | undefined> {
  const { accounts } = conn.lobby;
  return playLimited(conn, userId, "Scellé", await accounts.sealedRun(userId), (run) => botDeck(run.set), async (run, won) => {
    const updated = await accounts.sealedResult(userId, run.id, won);
    return updated && { type: "sealed", run: updated };
  });
}

// Against the deck of a bot of the draft.
export async function playDraft(conn: Connection, userId: string): Promise<string | undefined> {
  const { accounts } = conn.lobby;
  return playLimited(conn, userId, "Draft", await accounts.draftRun(userId), (run) => accounts.draftBotDeck(run.id), async (run, won) => {
    const updated = await accounts.draftResult(userId, run.id, won);
    return updated && { type: "draft", run: updated };
  });
}

// Only a room with two players and no bot has a public log to watch.
export function spectate(conn: Connection, code: string): string | undefined {
  const room = conn.lobby.rooms.get(code.toUpperCase());
  if (!room) return NO_ROOM;
  if (!room.watch) return "aucun duel en ligne à regarder dans cette salle";
  if (room.watch.sockets.length >= SPECTATORS_MAX) return "trop de spectateurs dans cette salle";
  room.watch.sockets.push(conn.socket);
  conn.watching = room;
  sendWatching(room, conn.socket);
  sendSpectators(room);
  return undefined;
}

export function stopWatching(socket: WebSocket, room: Room) {
  const sockets = room.watch?.sockets;
  const index = sockets?.indexOf(socket) ?? -1;
  if (index === -1) return;
  sockets?.splice(index, 1);
  sendSpectators(room);
}

// The custom rules of a room, shown to a guest before they join.
export function showRoomRules(conn: Connection, code: string): string | undefined {
  const room = conn.lobby.rooms.get(code.toUpperCase());
  if (!room) return NO_ROOM;
  send(conn.socket, { type: "room_rules", room: room.code, options: room.options });
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

// The story duel to play, or why it cannot be: a revenge is the boss duel of an arc.
function storyDuelOf(id: string, revenge?: true) {
  const boss = revenge ? STORY_REVENGES.get(id) : undefined;
  if (revenge && !boss) return "pas de revanche pour ce duel";
  const duel = boss?.duel ?? STORY_DUELS.get(id);
  return duel ? { duel, boss } : "duel d'histoire inconnu";
}

// The player keeps seat 0 against the bot; only their win counts. A revenge is the boss duel with its reinforced deck, at
// the Expert level, once its arc is finished; its win records no stars.
export async function playStory(conn: Connection, userId: string, id: string, level?: StoryLevel, revenge?: true): Promise<string | undefined> {
  const found = storyDuelOf(id, revenge);
  if (typeof found === "string") return found;
  const { duel, boss } = found;
  const { accounts, rooms } = conn.lobby;
  if (!isUnlocked(duel, await accounts.storyProgress(userId))) return boss ? "revanche verrouillée : terminez d'abord l'arc" : "duel verrouillé : gagnez d'abord les duels précédents";
  const deck = playerDeck(duel) ?? (await duelDeck(accounts, userId));
  if (typeof deck === "string") return deck;
  const rules = storyRules(duel, boss ? undefined : level);
  const room: Room = { code: newCode(rooms), players: [], rules, mode: { mode: "story", level: boss ? "revanche" : (level ?? "normal") } };
  // The duel is still open when its winner is known: its LP give the stars.
  room.onWin = (winner) => {
    if (winner !== 0 || !room.duel) return;
    const stars = storyStars(level === "facile", lpLeft(room.duel, 0), lpOf(rules, 0));
    recordWin(room, duel, boss ? accounts.completeRevenge(userId, boss.arc) : accounts.completeStory(userId, duel, stars));
  };
  return enter(conn, userId, room, deck, { deck: { main: storyDeck(duel), extra: storyExtra(duel) }, name: duel.opponent, level: boss ? "expert" : undefined });
}

// The player keeps seat 0 against the Normal bot, from a state set up by hand, without their deck; only their win counts,
// recorded by `solve` and announced as `puzzle_won` with `id`.
function playSetUp(conn: Connection, userId: string, room: Room, id: string, solve: () => Promise<boolean>, retry: string): string | undefined {
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
  return enter(conn, userId, room, empty, { deck: empty, name: "Bot", level: "normal" });
}

export function playPuzzle(conn: Connection, userId: string, id: string): string | undefined {
  const puzzle = PUZZLE_IDS.get(id);
  if (!puzzle) return "puzzle inconnu";
  const room: Room = { code: newCode(conn.lobby.rooms), players: [], rules: puzzleRules(puzzle), field: puzzleField(puzzle), turnLimit: PUZZLE_TURNS };
  return playSetUp(conn, userId, room, id, () => conn.lobby.accounts.solvePuzzle(userId, id), "réussite non enregistrée, rejouez le puzzle plus tard");
}

// The guided duel of client/src/tutoriel.ts, without turn limit.
export function playTutorial(conn: Connection, userId: string): string | undefined {
  const room: Room = { code: newCode(conn.lobby.rooms), players: [], rules: TUTORIAL_RULES, field: TUTORIAL_FIELD };
  return playSetUp(conn, userId, room, "tutorial", () => conn.lobby.accounts.finishTutorial(userId), "victoire non enregistrée, rejouez le tutoriel plus tard");
}

// The player keeps seat 0 against the bot of the floor. The deck is checked first: an invalid one keeps the progression.
export async function playTower(conn: Connection, userId: string): Promise<string | undefined> {
  const { accounts, rooms } = conn.lobby;
  const deck = await duelDeck(accounts, userId);
  if (typeof deck === "string") return deck;
  const room: Room = { code: newCode(rooms), players: [] };
  const floor = await accounts.startTower(userId);
  towerFloor(room, floor, accounts);
  const { name, main, extra } = TOWER[floor - 1];
  return enter(conn, userId, room, deck, { deck: { main, extra }, name, level: room.level });
}
