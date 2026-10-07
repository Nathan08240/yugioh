import type { WebSocket } from "ws";
import { isAdminMessage } from "./admin.ts";
import { isFriendMessage } from "./friends.ts";
import { leave, MAINTENANCE, type Connection, type Lobby, type User } from "./lobby.ts";
import { adminReply, choosePseudo, grantBoosters, identify, manageProfile, openBoosterFor, pickStarter, reportClientError, sendBoosterState, sendReplays, sendReply, sendResults, showEvent, showMissions, showPuzzles, showRanked, showReplay, showStory, showTower, storeReply } from "./menus.ts";
import { challengeFriend, enterRoom, leaveQueue, playDraft, playPuzzle, playSealed, playStory, playTower, playTutorial, queueRanked, showRoomRules, spectate, stopWatching } from "./modes.ts";
import { isProfileMessage } from "./profile.ts";
import type { ClientMessage } from "./protocol.ts";
import { answer, emote, surrender } from "./room.ts";
import { rematch, reportBug } from "./seated.ts";
import { isTradeMessage, tradeReply } from "./trade.ts";
import { parse, send } from "./wire.ts";

// An error for the sender, if any.
type Reply = string | undefined | Promise<string | undefined>;

const NOT_SEATED = "pas dans une salle";
// Messages that may seat a player back in a duel they already play (or watch) while the server stops.
const RESUMING = new Set<ClientMessage["type"]>(["join", "spectate", "sealed_duel", "draft_duel"]);

function handle(conn: Connection, msg: ClientMessage): Reply {
  if (msg.type === "auth") return identify(conn, msg.token);
  const { user, lobby, socket } = conn;
  if (!user) return "non authentifié";
  if (msg.type === "pseudo") return choosePseudo(conn, user, msg.pseudo);
  if (!user.pseudo) return "pseudo à choisir d'abord";
  const stored = storeReply(lobby.accounts, user.id, msg);
  if (stored) return sendReply(socket, stored);
  if (msg.type === "client_error") return reportClientError(conn, user.id, msg);
  if (isAdminMessage(msg)) return adminReply(conn, user, msg);
  if (isProfileMessage(msg)) return manageProfile(conn, user, msg);
  if (msg.type === "challenge") return challengeFriend(conn, user.id, msg);
  if (isFriendMessage(msg)) return lobby.friends.handle(socket, msg);
  if (isTradeMessage(msg)) return tradeReply(lobby.accounts, { id: user.id, pseudo: user.pseudo }, msg, lobby.friends.sendTo);
  return handleMenu(conn, user, msg);
}

// The pages of the menus, outside any room.
function handleMenu(conn: Connection, user: User, msg: ClientMessage): Reply {
  switch (msg.type) {
    case "starter":
      return pickStarter(conn, user, msg.starter);
    case "booster_state":
      return sendBoosterState(conn, user);
    case "open_booster":
      return openBoosterFor(conn, user, msg.set);
    case "admin_boosters":
      return grantBoosters(conn, user, msg.count);
    case "story":
      return showStory(conn, user.id);
    case "duel_results":
      return sendResults(conn, user.id);
    case "event":
      return showEvent(conn, user.id);
    case "puzzles":
      return showPuzzles(conn, user.id);
    case "tower":
      return showTower(conn, user.id);
    case "ranked":
      return showRanked(conn, user.id);
    case "missions":
      return showMissions(conn, user.id);
    case "replays":
      return sendReplays(conn, user.id);
    case "replay":
      return showReplay(conn, user.id, msg.id);
    case "ranked_cancel":
      leaveQueue(conn, user.id);
      send(conn.socket, { type: "ranked_queue", waiting: false });
      return undefined;
    default:
      return handleSeat(conn, user, msg);
  }
}

// What a seated player does in their room.
function handleSeat(conn: Connection, user: User, msg: ClientMessage): Reply {
  const { seat } = conn;
  switch (msg.type) {
    case "respond":
      return seat ? answer(seat.room, seat.index, msg.response) : NOT_SEATED;
    case "surrender":
      return seat ? surrender(seat.room, seat.index) : NOT_SEATED;
    case "emote":
      return seat ? emote(seat.room, seat.index, msg.id) : NOT_SEATED;
    case "report":
      return seat ? reportBug(conn, seat.room, user.id, msg.message) : NOT_SEATED;
    case "rematch":
      return seat ? rematch(conn.lobby, seat.room, seat.index, msg.accept !== false) : NOT_SEATED;
    default:
      return enterDuel(conn, user, msg);
  }
}

// A room to enter or watch, or the ranked queue, for a player in none.
function enterDuel(conn: Connection, user: User, msg: ClientMessage): Reply {
  const { lobby } = conn;
  if (conn.seat || conn.watching) return "déjà dans une salle";
  if (lobby.waiting.has(user.id)) return "recherche d'un adversaire classé en cours";
  // Before any side effect: the ranked queue would wait for nothing.
  if (lobby.draining && !RESUMING.has(msg.type)) return MAINTENANCE;
  switch (msg.type) {
    case "spectate":
      return spectate(conn, msg.room);
    case "room_rules":
      return showRoomRules(conn, msg.room);
    case "ranked_queue":
      return queueRanked(conn, user.id);
    case "story_duel":
      return playStory(conn, user.id, msg.duel, msg.level, msg.revenge);
    case "puzzle":
      return playPuzzle(conn, user.id, msg.id);
    case "tutorial":
      return playTutorial(conn, user.id);
    case "tower_duel":
      return playTower(conn, user.id);
    case "sealed_duel":
      return playSealed(conn, user.id);
    case "draft_duel":
      return playDraft(conn, user.id);
    case "create":
    case "join":
    case "bot":
      return enterRoom(conn, user.id, msg);
    default:
      return "message invalide";
  }
}

export function connect(lobby: Lobby, socket: WebSocket) {
  const conn: Connection = { lobby, socket };
  // Messages are handled one at a time, so an action sent right after `auth` waits for its verification.
  let queue = Promise.resolve();
  if (lobby.draining) send(socket, { type: "maintenance" });
  socket.on("close", () => {
    lobby.friends.leave(socket);
    if (conn.user) leaveQueue(conn, conn.user.id);
    if (conn.seat) leave(lobby, conn.seat.room, socket);
    if (conn.watching) stopWatching(socket, conn.watching);
  });
  socket.on("message", (data) => {
    queue = queue.then(async () => {
      if (socket.readyState !== socket.OPEN) return;
      const msg = parse(String(data));
      let error: string | undefined;
      try {
        error = msg ? await handle(conn, msg) : "message invalide";
      } catch (failure) {
        console.error(failure);
        error = "service indisponible, réessayer plus tard";
      }
      if (error) send(socket, { type: "error", error });
    });
  });
}
