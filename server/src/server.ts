import { randomInt } from "node:crypto";
import { OcgMessageType, OcgProcessResult, OcgResponseType, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { WebSocketServer, type WebSocket } from "ws";
import { KAIBA, YUGI } from "./decks.ts";
import { openDuel, type Seed } from "./duel.ts";
import type { ClientMessage, Seat, ServerMessage } from "./protocol.ts";
import { hideCards, visibleTo } from "./visibility.ts";

type Question = Extract<OcgMessage, { player: number }>;
type Player = { id: string; socket?: WebSocket; log: OcgMessage[] };
type Room = {
  code: string;
  players: Player[];
  duel?: Awaited<ReturnType<typeof openDuel>>;
  question?: Question;
  timer?: NodeJS.Timeout;
};

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// An empty room is kept this long so a player can come back to it.
const ROOM_TTL = 10 * 60_000;

// Response type the engine expects for each of its questions.
const ANSWERS = new Map<OcgMessageType, OcgResponseType>([
  [OcgMessageType.SELECT_BATTLECMD, OcgResponseType.SELECT_BATTLECMD],
  [OcgMessageType.SELECT_IDLECMD, OcgResponseType.SELECT_IDLECMD],
  [OcgMessageType.SELECT_EFFECTYN, OcgResponseType.SELECT_EFFECTYN],
  [OcgMessageType.SELECT_YESNO, OcgResponseType.SELECT_YESNO],
  [OcgMessageType.SELECT_OPTION, OcgResponseType.SELECT_OPTION],
  [OcgMessageType.SELECT_CARD, OcgResponseType.SELECT_CARD],
  [OcgMessageType.SELECT_CHAIN, OcgResponseType.SELECT_CHAIN],
  [OcgMessageType.SELECT_PLACE, OcgResponseType.SELECT_PLACE],
  [OcgMessageType.SELECT_POSITION, OcgResponseType.SELECT_POSITION],
  [OcgMessageType.SELECT_TRIBUTE, OcgResponseType.SELECT_TRIBUTE],
  [OcgMessageType.SORT_CHAIN, OcgResponseType.SORT_CARD],
  [OcgMessageType.SELECT_COUNTER, OcgResponseType.SELECT_COUNTER],
  [OcgMessageType.SELECT_SUM, OcgResponseType.SELECT_SUM],
  [OcgMessageType.SELECT_DISFIELD, OcgResponseType.SELECT_DISFIELD],
  [OcgMessageType.SORT_CARD, OcgResponseType.SORT_CARD],
  [OcgMessageType.SELECT_UNSELECT_CARD, OcgResponseType.SELECT_UNSELECT_CARD],
  [OcgMessageType.ROCK_PAPER_SCISSORS, OcgResponseType.ROCK_PAPER_SCISSORS],
  [OcgMessageType.ANNOUNCE_RACE, OcgResponseType.ANNOUNCE_RACE],
  [OcgMessageType.ANNOUNCE_ATTRIB, OcgResponseType.ANNOUNCE_ATTRIB],
  [OcgMessageType.ANNOUNCE_CARD, OcgResponseType.ANNOUNCE_CARD],
  [OcgMessageType.ANNOUNCE_NUMBER, OcgResponseType.ANNOUNCE_NUMBER],
]);

export const randomSeed = (): Seed => [...crypto.getRandomValues(new BigUint64Array(4))] as Seed;

function send(socket: WebSocket | undefined, data: ServerMessage) {
  socket?.send(JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}

const isId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 64;

function parse(data: string): ClientMessage | undefined {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof msg !== "object" || msg === null) return undefined;
  const valid =
    (msg.type === "create" && isId(msg.player)) ||
    (msg.type === "join" && isId(msg.player) && typeof msg.room === "string") ||
    (msg.type === "respond" && typeof msg.response === "object" && msg.response !== null);
  return valid ? (msg as ClientMessage) : undefined;
}

function ask(room: Room, retry: boolean) {
  const question = room.question;
  if (question) send(room.players[question.player]?.socket, { type: "question", question: hideCards(question, question.player), retry });
}

function broadcast(room: Room, messages: OcgMessage[]) {
  room.players.forEach((player, seat) => {
    const visible = messages.flatMap((msg) => visibleTo(msg, seat) ?? []);
    if (visible.length === 0) return;
    player.log.push(...visible);
    send(player.socket, { type: "messages", messages: visible });
  });
}

function endDuel(room: Room) {
  room.duel?.lib.destroyDuel(room.duel.handle);
  room.duel = undefined;
  room.question = undefined;
}

// Runs the engine until it asks a question or the duel ends.
function advance(room: Room) {
  if (!room.duel) return;
  const { lib, handle } = room.duel;
  for (;;) {
    const status = lib.duelProcess(handle);
    const messages = lib.duelGetMessage(handle);
    if (messages.some((msg) => msg.type === OcgMessageType.RETRY)) {
      ask(room, true);
      return;
    }
    const events = messages.filter((msg) => !ANSWERS.has(msg.type));
    // The engine keeps sending WIN without ever reaching END: the first one closes the duel.
    const win = events.findIndex((msg) => msg.type === OcgMessageType.WIN);
    broadcast(room, win === -1 ? events : events.slice(0, win + 1));
    if (win !== -1 || status === OcgProcessResult.END) {
      endDuel(room);
      return;
    }
    const last = messages.at(-1);
    if (status === OcgProcessResult.WAITING && last && "player" in last) {
      room.question = last;
      ask(room, false);
      return;
    }
  }
}

// Returns an error for the sender, if any. A response the engine cannot take is asked again.
function answer(room: Room, seat: Seat, response: OcgResponse): string | undefined {
  const question = room.question;
  if (!room.duel || question?.player !== seat) return "aucune question en attente";
  try {
    if (response.type !== ANSWERS.get(question.type)) throw new Error("type de réponse inattendu");
    room.duel.lib.duelSetResponse(room.duel.handle, response);
  } catch {
    ask(room, true);
    return undefined;
  }
  advance(room);
  return undefined;
}

async function start(room: Room, seed: Seed) {
  room.duel = await openDuel(seed, [YUGI, KAIBA], (text) => console.error(`[salle ${room.code}] ${text}`));
  advance(room);
}

function newCode(rooms: Map<string, Room>): string {
  let code: string;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

// ponytail: every duel is Yugi (host) vs Kaiba until the deck builder exists.
export function startServer(port: number, newSeed = randomSeed): WebSocketServer {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ port, maxPayload: 64 * 1024 });

  function sit(room: Room, id: string, socket: WebSocket): Seat | undefined {
    const known = room.players.findIndex((player) => player.id === id);
    if (known === -1 && room.players.length === 2) return undefined;
    const seat = (known === -1 ? room.players.push({ id, log: [] }) - 1 : known) as Seat;
    const player = room.players[seat];
    if (player.socket !== socket) player.socket?.close();
    player.socket = socket;
    clearTimeout(room.timer);
    send(socket, { type: "joined", room: room.code, seat, log: player.log });
    if (room.question?.player === seat) ask(room, false);
    if (known === -1 && seat === 1) start(room, newSeed()).catch((error: unknown) => console.error(error));
    return seat;
  }

  function leave(room: Room, socket: WebSocket) {
    const player = room.players.find((seated) => seated.socket === socket);
    if (player) player.socket = undefined;
    if (room.players.some((player) => player.socket)) return;
    room.timer = setTimeout(() => {
      endDuel(room);
      rooms.delete(room.code);
    }, ROOM_TTL).unref();
  }

  wss.on("connection", (socket) => {
    let seat: { room: Room; index: Seat } | undefined;

    // Returns an error for the sender, if any.
    function handle(msg: ClientMessage): string | undefined {
      if (msg.type === "respond") return seat ? answer(seat.room, seat.index, msg.response) : "pas dans une salle";
      if (seat) return "déjà dans une salle";
      const room = msg.type === "create" ? { code: newCode(rooms), players: [] } : rooms.get(msg.room.toUpperCase());
      if (!room) return "salle introuvable";
      rooms.set(room.code, room);
      const index = sit(room, msg.player, socket);
      if (index === undefined) return "salle complète";
      seat = { room, index };
      return undefined;
    }

    socket.on("close", () => {
      if (seat) leave(seat.room, socket);
    });
    socket.on("message", (data) => {
      const msg = parse(String(data));
      const error = msg ? handle(msg) : "message invalide";
      if (error) send(socket, { type: "error", error });
    });
  });
  return wss;
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  startServer(port);
  console.log(`Serveur de partie sur ws://localhost:${port}`);
}
