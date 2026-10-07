import type { Accounts } from "./accounts.ts";
import type { ActiveDeck } from "./db.ts";
import { duelDeck, limitsOf, MAINTENANCE, newBot, type Connection, type Lobby } from "./lobby.ts";
import { REPORT_MAX, type Seat } from "./protocol.ts";
import { REPORT_BYTES } from "./report.ts";
import { towerFloor } from "./rewards.ts";
import { declineRematch, reportOf, sendAll, sendJoined, start, type Room } from "./room.ts";
import { send } from "./wire.ts";

export async function reportBug(conn: Connection, room: Room, userId: string, text = ""): Promise<string | undefined> {
  const message = text.trim();
  if (message.length > REPORT_MAX) return `texte trop long : ${REPORT_MAX} caractères au maximum`;
  const report = reportOf(room);
  if (!report) return "aucun duel à signaler";
  if (JSON.stringify(report).length > REPORT_BYTES) return "duel trop long pour être signalé";
  if (!(await conn.lobby.accounts.saveReport(userId, message, report))) return "trop de signalements, réessayez dans une heure";
  send(conn.socket, { type: "report_sent" });
  return undefined;
}

// A new duel in the same room, from empty logs. The caller has checked `room.over`.
function restart(lobby: Lobby, room: Room) {
  room.over = false;
  room.rematch = undefined;
  for (const player of room.players) {
    player.log = [];
    player.stats = undefined;
    if (player.bot) player.bot = newBot(lobby, room);
  }
  room.players.forEach((_player, index) => sendJoined(room, index as Seat));
  start(room, lobby.newSeed()).catch((error: unknown) => console.error(error));
}

// After a tower duel: the next floor once its win is recorded, floor 1 once its loss is.
async function climb(accounts: Accounts, room: Room, tower: NonNullable<Room["tower"]>) {
  await tower.saved;
  towerFloor(room, await accounts.startTower(room.players[0].id), accounts);
}

// Against the bot, a rematch starts at once (the next floor of the tower). Online, it starts once both seats asked, with their active decks of the moment.
export async function rematch(lobby: Lobby, room: Room, index: Seat, accept: boolean): Promise<string | undefined> {
  if (!room.over) return "aucun duel terminé";
  if (lobby.draining) return MAINTENANCE;
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
    if (room.tower) await climb(lobby.accounts, room, room.tower);
    restart(lobby, room);
    return undefined;
  }
  return rematchOnline(lobby, room, index);
}

// The first seat to accept waits for the other; both accepted, the duel restarts if both active decks are still valid.
async function rematchOnline(lobby: Lobby, room: Room, index: Seat): Promise<string | undefined> {
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
  const decks = await Promise.all(room.players.map((player) => duelDeck(lobby.accounts, player.id, limitsOf(room))));
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
  restart(lobby, room);
  return undefined;
}
