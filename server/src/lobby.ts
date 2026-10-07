import type { WebSocket, WebSocketServer } from "ws";
import type { Accounts } from "./accounts.ts";
import { Bot } from "./bot.ts";
import { poolCard } from "./collection.ts";
import { ROOM_LIMITS } from "./custom.ts";
import type { ActiveDeck } from "./db.ts";
import { EXTRA_MAX, isExtraDeck, limitError, MAIN_MAX, MAIN_MIN } from "./deckcheck.ts";
import { lpOf, type Seed } from "./duel.ts";
import type { friendHub } from "./friends.ts";
import { historyEntry } from "./history.ts";
import { GOAT } from "./limits.ts";
import type { MissionProgress } from "./missions.ts";
import { isAllowed } from "./pool.ts";
import type { BotLevel, RoomOptions, Seat } from "./protocol.ts";
import type { Waiting } from "./ranked.ts";
import { REPORT_BYTES } from "./report.ts";
import { missionProgress } from "./rewards.ts";
import { ask, away, back, CONNECTION_LOST, declineRematch, deckSizes, endDuel, extraSizes, fail, finish, online, rematchMessage, reportOf, rulesOf, sendJoined, start, type Player, type Room } from "./room.ts";
import { send } from "./wire.ts";

// An empty room is kept this long so a player can come back to it.
const ROOM_TTL = 10 * 60_000;
// While the server stops for an update: what a new duel gets, and the end of a duel still running at the deadline.
export const MAINTENANCE = "mise à jour en cours : les nouveaux duels reprennent dans quelques minutes";
const INTERRUPTED = "mise à jour du serveur : duel interrompu, sans victoire ni défaite";

// What the friend hub needs to seat a connection in the room of an accepted challenge.
export type FriendEntry = { deck: (where?: string) => Promise<ActiveDeck | string>; enter: (room: Room, deck: ActiveDeck) => string | undefined };

// What the connections share. `draining` is set by shutdown: no new duel starts.
export type Lobby = {
  rooms: Map<string, Room>;
  accounts: Accounts;
  // Supabase user ids allowed to use the admin commands.
  admins: ReadonlySet<string>;
  newSeed: () => Seed;
  botDelay: number;
  // Players waiting for a ranked duel, by user id, and the last ranked opponent of each player.
  waiting: Map<string, Waiting & { socket: WebSocket; join: (room: Room) => void }>;
  lastOpponent: Map<string, { opponent: string; at: number }>;
  // When each player asked their last replays (history.ts).
  replaysAsked: Map<string, number[]>;
  // When each player last sent a browser error (admin.ts).
  errorsSent: Map<string, number[]>;
  friends: ReturnType<typeof friendHub<FriendEntry>>;
  draining: boolean;
};

export type User = { id: string; pseudo?: string; avatar?: number };

// One WebSocket connection: the player authenticated on it, the seat it holds, the room it watches.
export type Connection = { lobby: Lobby; socket: WebSocket; user?: User; seat?: { room: Room; index: Seat }; watching?: Room };

// No new duel, every client is told. Resolves once no duel has a player still connected, or after `maxMs`: the duels
// left then end with no winner, nothing recorded. A duel nobody plays any more is dropped with the process.
export function shutdown(lobby: Lobby, wss: WebSocketServer, maxMs: number): Promise<void> {
  lobby.draining = true;
  for (const { socket } of lobby.waiting.values()) send(socket, { type: "ranked_queue", waiting: false });
  lobby.waiting.clear();
  wss.clients.forEach((socket) => send(socket, { type: "maintenance" }));
  const deadline = Date.now() + maxMs;
  return new Promise((resolve) => {
    const check = setInterval(() => {
      const playing = [...lobby.rooms.values()].filter((room) => room.duel && room.players.some((player) => player.socket));
      if (playing.length > 0 && Date.now() < deadline) return;
      for (const room of playing) fail(room, "arrêt du serveur", INTERRUPTED);
      clearInterval(check);
      resolve();
    }, 1000).unref();
  });
}

const isPoolFusion = (code: number) => {
  const card = poolCard(code);
  return card !== undefined && isExtraDeck(card);
};

// A deck as validated for a duel: 40 to 60 cards from the allowed pool, and at most 15 Fusion monsters in the extra deck.
const validDeck = ({ main, extra }: ActiveDeck) =>
  main.length >= MAIN_MIN && main.length <= MAIN_MAX && main.every(isAllowed) && extra.length <= EXTRA_MAX && extra.every(isPoolFusion);

// Where the Goat list applies besides the ranked queue: a room or a bot duel of the weekly event.
const EVENT_LIMITS = "en événement";

// Where the Goat list holds the decks of a room (or of a message that creates one), undefined when it does not.
export function limitsOf(source?: { event?: unknown; options?: RoomOptions }): string | undefined {
  if (source?.event) return EVENT_LIMITS;
  return source?.options?.goat ? ROOM_LIMITS : undefined;
}

// The active deck of the player, or the error that keeps them out of a duel. `where` ("en classé") also holds it to the Goat list.
export async function duelDeck(accounts: Accounts, userId: string, where?: string): Promise<ActiveDeck | string> {
  const deck = await accounts.activeDeck(userId);
  if (!deck) return "deck actif requis";
  if (!validDeck(deck)) return "deck actif invalide";
  if (!where) return deck;
  return limitError([...deck.main, ...deck.extra], poolCard, GOAT, where) ?? deck;
}

// Once per duel (the end of a duel is reported once): both ratings change, each player gets theirs.
function rateRanked(accounts: Accounts, room: Room, winner: number, reason: number) {
  const players: [string, string] = [room.players[0].id, room.players[1].id];
  accounts.rateDuel({ players, winner: winner === 0 || winner === 1 ? winner : null, reason }).then(
    (ratings) => ratings.forEach(({ before, after }, index) => send(room.players[index]?.socket, { type: "ranked_result", delta: after - before, rating: after })),
    (error: unknown) => console.error(error),
  );
}

// The player gets their missions once the progress is recorded, on the socket they have by then.
export function progressMissions(accounts: Accounts, userId: string, progress: MissionProgress, to: { socket?: WebSocket }) {
  accounts.progressMissions(userId, progress).then(
    (view) => send(to.socket, { type: "missions", ...view }),
    (error: unknown) => console.error(error),
  );
}

// Stores the result of the duel for each human player. A failure is logged, the duel is over anyway.
function recordResults(accounts: Accounts, room: Room, winner: Seat, reason: number) {
  const { mode } = room;
  if (!mode) return;
  room.players.forEach((player, index) => {
    if (player.bot) return;
    const result = { userId: player.id, deckId: player.deckId, ...mode, won: index === winner, reason, turns: room.turns ?? 0 };
    accounts.recordResult(result).catch((error: unknown) => console.error(error));
    progressMissions(accounts, player.id, missionProgress(room, index as Seat, winner, reason), player);
  });
}

// Keeps the duel for each human player to watch again, unless it is too long to store.
function recordReplays(accounts: Accounts, room: Room, winner: Seat, reason: number) {
  const report = reportOf(room);
  if (!report || JSON.stringify(report).length > REPORT_BYTES) return;
  room.players.forEach((player, index) => {
    if (player.bot) return;
    accounts.saveReplay(historyEntry(room, report, index as Seat, winner, reason)).catch((error: unknown) => console.error(error));
  });
}

function sit(conn: Connection, room: Room, id: string, deck: ActiveDeck): Seat | undefined {
  const { socket, user } = conn;
  const known = room.players.findIndex((player) => player.id === id);
  if (known === -1 && room.players.length === 2) return undefined;
  const isNew = known === -1;
  const seat = (isNew ? room.players.push({ id, name: user?.pseudo, avatar: user?.avatar, log: [], deck: deck.main, deckId: deck.id, extra: deck.extra }) - 1 : known) as Seat;
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
  if (isNew && seat === 1) start(room, conn.lobby.newSeed()).catch((error: unknown) => console.error(error));
  return seat;
}

export const newBot = (lobby: Lobby, room: Room) => new Bot(1, lpOf(rulesOf(room), 1), deckSizes(room), lobby.botDelay, extraSizes(room), room.level);

// The bot takes seat 1.
function addBot(lobby: Lobby, room: Room, deck: ActiveDeck, name: string, level?: BotLevel) {
  const player: Player = { id: "bot", name, log: [], deck: deck.main, extra: deck.extra };
  room.players.push(player);
  room.level = level;
  player.bot = newBot(lobby, room);
  sendJoined(room, 0);
  start(room, lobby.newSeed()).catch((error: unknown) => console.error(error));
}

// Seats the player of the connection in `room`, against a bot when `bot` is given. Returns an error, if any.
export function enter(conn: Connection, userId: string, room: Room, deck: ActiveDeck, bot?: { deck: ActiveDeck; name: string; level?: BotLevel }): string | undefined {
  const { lobby } = conn;
  if (conn.seat) return "déjà dans une salle";
  // While stopping, only a player coming back to their seat gets in: no new room, no new guest.
  if (lobby.draining && !room.players.some((player) => player.id === userId)) return MAINTENANCE;
  room.onEnd = (winner, reason) => {
    recordResults(lobby.accounts, room, winner, reason);
    recordReplays(lobby.accounts, room, winner, reason);
    if (room.ranked) rateRanked(lobby.accounts, room, winner, reason);
  };
  lobby.rooms.set(room.code, room);
  const index = sit(conn, room, userId, deck);
  if (index === undefined) return "salle complète";
  conn.seat = { room, index };
  room.onWatch = () => lobby.friends.opened(room.code);
  lobby.friends.seat(conn.socket, room.code);
  if (bot) addBot(lobby, room, bot.deck, bot.name, bot.level);
  return undefined;
}

export function leave(lobby: Lobby, room: Room, socket: WebSocket) {
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
    lobby.rooms.delete(room.code);
  }, ROOM_TTL).unref();
}

// What the friend hub needs to seat this connection in the room of an accepted challenge.
export function joinFriends(conn: Connection, id: string, pseudo: string) {
  const { socket, lobby } = conn;
  lobby.friends.join(socket, id, pseudo, {
    deck: (where) => duelDeck(lobby.accounts, id, where),
    enter: (room, deck) => (socket.readyState === socket.OPEN ? enter(conn, id, room, deck) : "adversaire déconnecté"),
  });
}
