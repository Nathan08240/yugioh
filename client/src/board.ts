import { OcgLocation, OcgMessageType, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import type { Wire } from "../../server/src/protocol.ts";

export type Message = Wire<OcgMessage>;
// Code 0: a card this player is not allowed to see.
export type Card = { code: number; position: number };
export type Place = { controller: number; location: OcgLocation; sequence: number };
export type Side = {
  lp: number;
  deck: number;
  extra: number;
  hand: Card[];
  // Engine sequences: monsters 0-4 (5-6 are Extra Monster Zones, unused here), spells 0-4 and 5 for the field zone.
  monsters: (Card | null)[];
  spells: (Card | null)[];
  grave: Card[];
  banished: Card[];
};
export type LogPart = string | { code: number };
export type LogEntry = { player?: number; parts: LogPart[] };
export type Board = {
  players: [Side, Side];
  turn: number;
  turnPlayer: number;
  phase: number;
  chain: (Place & { code: number })[];
  winner?: number;
  log: LogEntry[];
  // The card behind the damage being dealt (the attacker, else the last card activated), and the last damage dealt.
  source?: number;
  lastHit?: { player: number; amount: number; code: number };
};

const side = (lp: number, deck: number, extra: number): Side => ({
  lp,
  deck,
  extra,
  hand: [],
  monsters: new Array(7).fill(null),
  spells: new Array(8).fill(null),
  grave: [],
  banished: [],
});

export const newBoard = (lp: number, decks: readonly number[], extras: readonly number[] = [0, 0]): Board => ({
  players: [side(lp, decks[0], extras[0]), side(lp, decks[1], extras[1])],
  turn: 0,
  turnPlayer: 0,
  phase: 0,
  chain: [],
  log: [],
});

function pile(owner: Side, location: number): Card[] | undefined {
  if (location === OcgLocation.HAND) return owner.hand;
  if (location === OcgLocation.GRAVE) return owner.grave;
  if (location === OcgLocation.REMOVED) return owner.banished;
  return undefined;
}

function zones(owner: Side, location: number): (Card | null)[] | undefined {
  if (location === OcgLocation.MZONE) return owner.monsters;
  if (location === OcgLocation.SZONE) return owner.spells;
  return undefined;
}

export function cardAt(board: Board, place: Place): Card | undefined {
  const owner = board.players[place.controller];
  if (!owner) return undefined;
  return (pile(owner, place.location) ?? zones(owner, place.location))?.[place.sequence] ?? undefined;
}

// Removes the card at `place`: a card entering the game (token) has no location.
function take(board: Board, place: Place): Card | undefined {
  const owner = board.players[place.controller];
  const list = pile(owner, place.location);
  if (list) return list.splice(place.sequence, 1)[0];
  const slots = zones(owner, place.location);
  if (slots) {
    const card = slots[place.sequence];
    slots[place.sequence] = null;
    return card ?? undefined;
  }
  if (place.location === OcgLocation.DECK) owner.deck--;
  if (place.location === OcgLocation.EXTRA) owner.extra--;
  return undefined;
}

function put(board: Board, place: Place, card: Card) {
  const owner = board.players[place.controller];
  const list = pile(owner, place.location);
  const slots = zones(owner, place.location);
  if (list) list.splice(place.sequence, 0, card);
  else if (slots) slots[place.sequence] = card;
  else if (place.location === OcgLocation.DECK) owner.deck++;
  else if (place.location === OcgLocation.EXTRA) owner.extra++;
}

// Updates the card a message shows at its place (summons, flips, sets). Code 0 hides it again.
function reveal(board: Board, place: Place, code: number, position: number) {
  const card = cardAt(board, place);
  if (card) Object.assign(card, { code, position });
}

// LP are sent as unsigned 32-bit values: below 0 they wrap around.
const int32 = (value: number) => value | 0;

function apply(board: Board, msg: Message) {
  switch (msg.type) {
    case OcgMessageType.DRAW: {
      const owner = board.players[msg.player];
      owner.deck -= msg.drawn.length;
      owner.hand.push(...msg.drawn.map(({ code, position }) => ({ code, position })));
      break;
    }
    case OcgMessageType.MOVE: {
      take(board, msg.from);
      put(board, msg.to, { code: msg.card, position: msg.to.position });
      break;
    }
    case OcgMessageType.SWAP: {
      const first = take(board, msg.card1);
      const second = take(board, msg.card2);
      if (second) put(board, msg.card1, second);
      if (first) put(board, msg.card2, first);
      break;
    }
    case OcgMessageType.POS_CHANGE:
    case OcgMessageType.SET:
    case OcgMessageType.SUMMONING:
    case OcgMessageType.SPSUMMONING:
    case OcgMessageType.FLIPSUMMONING:
      reveal(board, msg, msg.code, msg.position);
      break;
    case OcgMessageType.SHUFFLE_HAND: {
      const owner = board.players[msg.player];
      owner.hand = msg.cards.map((code, i) => ({ code, position: owner.hand[i]?.position ?? 0 }));
      break;
    }
    case OcgMessageType.ATTACK:
      board.source = cardAt(board, msg.card)?.code;
      break;
    case OcgMessageType.CHAINING:
      if (msg.code) reveal(board, msg, msg.code, msg.position);
      board.source = msg.code;
      board.chain.push({ code: msg.code, controller: msg.controller, location: msg.location, sequence: msg.sequence });
      break;
    case OcgMessageType.CHAIN_SOLVED:
      board.chain = board.chain.slice(0, msg.chain_size - 1);
      break;
    case OcgMessageType.CHAIN_END:
      board.chain = [];
      break;
    case OcgMessageType.NEW_TURN:
      board.turn++;
      board.turnPlayer = msg.player;
      break;
    case OcgMessageType.NEW_PHASE:
      board.phase = msg.phase;
      break;
    case OcgMessageType.DAMAGE:
      board.lastHit = { player: msg.player, amount: msg.amount, code: board.source ?? 0 };
      board.players[msg.player].lp -= msg.amount;
      break;
    case OcgMessageType.PAY_LPCOST:
      board.players[msg.player].lp -= msg.amount;
      break;
    case OcgMessageType.RECOVER:
      board.players[msg.player].lp += msg.amount;
      break;
    case OcgMessageType.LPUPDATE:
      board.players[msg.player].lp = int32(msg.lp);
      break;
    case OcgMessageType.WIN:
      board.winner = msg.player;
      break;
    default:
      break;
  }
}

const MOVE_LOG = new Map<number, string>([
  [OcgLocation.GRAVE, "Envoyée au cimetière : "],
  [OcgLocation.REMOVED, "Bannie : "],
  [OcgLocation.HAND, "Ajoutée à la main : "],
  [OcgLocation.DECK, "Renvoyée dans le deck : "],
]);

function moveLog(msg: Extract<Message, { type: OcgMessageType.MOVE }>): LogEntry | undefined {
  const { from, to } = msg;
  if (from.location === OcgLocation.MZONE && to.location === OcgLocation.MZONE && from.controller !== to.controller) {
    return { player: to.controller, parts: ["Prend le contrôle de ", { code: msg.card }] };
  }
  const label = MOVE_LOG.get(to.location);
  if (!label || from.location === to.location || !from.location) return undefined;
  return { player: to.controller, parts: [label, { code: msg.card }] };
}

const at = (board: Board, place: Place) => ({ code: cardAt(board, place)?.code ?? 0 });

function drawLog(msg: Extract<Message, { type: OcgMessageType.DRAW }>): LogEntry {
  const count = msg.drawn.length;
  if (msg.drawn.every((card) => !card.code)) return { player: msg.player, parts: [`Pioche ${count} carte${count > 1 ? "s" : ""}`] };
  return { player: msg.player, parts: ["Pioche : ", ...msg.drawn.flatMap((card, i) => [i ? ", " : "", { code: card.code }])] };
}

function attackLog(board: Board, msg: Extract<Message, { type: OcgMessageType.ATTACK }>): LogEntry {
  const parts: LogPart[] = ["Attaque : ", at(board, msg.card)];
  if (msg.target) parts.push(" sur ", at(board, msg.target));
  else parts.push(" directement");
  return { player: msg.card.controller, parts };
}

// A readable line for the messages worth showing, read before the message changes the board.
function describe(board: Board, msg: Message): LogEntry | undefined {
  switch (msg.type) {
    case OcgMessageType.NEW_TURN:
      return { player: msg.player, parts: [`Tour ${board.turn + 1}`] };
    case OcgMessageType.DRAW:
      return drawLog(msg);
    case OcgMessageType.SUMMONING:
      return { player: msg.controller, parts: ["Invocation : ", { code: msg.code }] };
    case OcgMessageType.SPSUMMONING:
      return { player: msg.controller, parts: ["Invocation spéciale : ", { code: msg.code }] };
    case OcgMessageType.FLIPSUMMONING:
      return { player: msg.controller, parts: ["Invocation flip : ", { code: msg.code }] };
    case OcgMessageType.SET:
      return { player: msg.controller, parts: ["Pose : ", { code: msg.code }] };
    case OcgMessageType.CHAINING:
      return { player: msg.controller, parts: ["Active : ", { code: msg.code }, msg.chain_size > 1 ? ` (maillon ${msg.chain_size})` : ""] };
    case OcgMessageType.CHAIN_NEGATED:
    case OcgMessageType.CHAIN_DISABLED:
      return { parts: [`Maillon ${msg.chain_size} annulé`] };
    case OcgMessageType.ATTACK:
      return attackLog(board, msg);
    case OcgMessageType.EQUIP:
      return { player: msg.card.controller, parts: ["Équipe ", at(board, msg.card), " à ", at(board, msg.target)] };
    case OcgMessageType.DAMAGE:
      return { player: msg.player, parts: [`Perd ${msg.amount} LP`] };
    case OcgMessageType.PAY_LPCOST:
      return { player: msg.player, parts: [`Paie ${msg.amount} LP`] };
    case OcgMessageType.RECOVER:
      return { player: msg.player, parts: [`Gagne ${msg.amount} LP`] };
    case OcgMessageType.MOVE:
      return moveLog(msg);
    case OcgMessageType.WIN:
      return { player: msg.player, parts: ["Remporte le duel"] };
    default:
      return undefined;
  }
}

// Rebuilds the board from the engine messages the player received: from a fresh board, the whole visible history.
export function playAll(board: Board, messages: readonly Message[]): Board {
  const next = structuredClone(board);
  for (const msg of messages) {
    const line = describe(next, msg);
    if (line) next.log.push(line);
    apply(next, msg);
  }
  return next;
}
