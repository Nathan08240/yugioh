// Engine messages as a queue of animations (design/motion.md): the board stays pure, the display catches up with it.
import { OcgAttribute, OcgLocation, OcgMessageType, OcgType } from "@n1xx1/ocgcore-wasm";
import { cardAt, playAll, type Board, type Message } from "../board.ts";
import { has, type Cards } from "../cards.ts";
import { placeKey } from "../question.ts";

export type Depart = "destruction" | "sacrifice" | "materiau";
export type Effet =
  | { type: "pioche"; joueur: number; nombre: number }
  | { type: "entree"; cle: string; joueur: number }
  | { type: "invocation"; cle: string; code: number; genre: "normale" | "fusion" | "dieu" }
  | { type: "pose"; cle: string }
  | { type: "position"; cle: string }
  | { type: "depart"; cle: string; genre: Depart }
  | { type: "attaque"; de: string; vers?: string; joueur: number }
  | { type: "lp"; joueur: number; delta: number; directe: boolean }
  | { type: "activation"; cle: string; maillon: number; joueur: number }
  | { type: "resolution"; maillon: number; annule: boolean }
  | { type: "phase"; phase: number; joueur: number }
  | { type: "tour"; joueur: number; tour: number };

// Messages without animation of their own are applied at once, before the next step (`prelude`).
// `avant` plays before `message` changes the board (the card still in place), `apres` once it has.
export type Etape = { prelude: Message[]; avant: Effet[]; message?: Message; apres: Effet[] };

const ON_FIELD: ReadonlySet<number> = new Set([OcgLocation.MZONE, OcgLocation.SZONE]);
const OFF_FIELD: ReadonlySet<number> = new Set([OcgLocation.GRAVE, OcgLocation.REMOVED]);
// The messages that tell what a card leaving the field was for; the others are skipped when looking ahead.
const TELLING: ReadonlySet<Message["type"]> = new Set([
  OcgMessageType.SUMMONING,
  OcgMessageType.SPSUMMONING,
  OcgMessageType.FLIPSUMMONING,
  OcgMessageType.SET,
  OcgMessageType.ATTACK,
  OcgMessageType.BATTLE,
  OcgMessageType.CHAINING,
  OcgMessageType.CHAIN_SOLVED,
  OcgMessageType.DAMAGE,
  OcgMessageType.DRAW,
  OcgMessageType.NEW_PHASE,
  OcgMessageType.NEW_TURN,
]);

type Ctx = { board: Board; cards: Cards; next: Message | undefined; direct: boolean };

// A monster leaving the field just before a Tribute Summon (or Set) is a tribute; before a Fusion Summon, a material.
function departure(ctx: Ctx): Depart {
  const { next, cards } = ctx;
  if (next?.type === OcgMessageType.SUMMONING) return "sacrifice";
  if (next?.type === OcgMessageType.SET && next.location === OcgLocation.MZONE) return "sacrifice";
  if (next?.type === OcgMessageType.SPSUMMONING && has(cards.get(next.code)?.type ?? 0, OcgType.FUSION)) return "materiau";
  return "destruction";
}

function summonKind(msg: Extract<Message, { code: number }>, cards: Cards): "normale" | "fusion" | "dieu" {
  const info = cards.get(msg.code);
  if (info?.attribute === OcgAttribute.DIVINE) return "dieu";
  if (msg.type === OcgMessageType.SPSUMMONING && has(info?.type ?? 0, OcgType.FUSION)) return "fusion";
  return "normale";
}

function moveEffects(msg: Extract<Message, { type: OcgMessageType.MOVE }>, ctx: Ctx): Pick<Etape, "avant" | "apres"> {
  const { from, to } = msg;
  if (ON_FIELD.has(from.location) && OFF_FIELD.has(to.location) && cardAt(ctx.board, from)) {
    return { avant: [{ type: "depart", cle: placeKey(from), genre: departure(ctx) }], apres: [] };
  }
  if (ON_FIELD.has(to.location) && !ON_FIELD.has(from.location)) return { avant: [], apres: [{ type: "entree", cle: placeKey(to), joueur: to.controller }] };
  return { avant: [], apres: [] };
}

const NONE = { avant: [], apres: [] };
const after = (...apres: Effet[]) => ({ avant: [], apres });
const before = (...avant: Effet[]) => ({ avant, apres: [] });

function effects(msg: Message, ctx: Ctx): Pick<Etape, "avant" | "apres"> {
  const { board } = ctx;
  switch (msg.type) {
    case OcgMessageType.DRAW:
      return after({ type: "pioche", joueur: msg.player, nombre: msg.drawn.length });
    case OcgMessageType.MOVE:
      return moveEffects(msg, ctx);
    case OcgMessageType.SUMMONING:
    case OcgMessageType.SPSUMMONING:
    case OcgMessageType.FLIPSUMMONING:
      return after({ type: "invocation", cle: placeKey(msg), code: msg.code, genre: summonKind(msg, ctx.cards) });
    case OcgMessageType.SET:
      return after({ type: "pose", cle: placeKey(msg) });
    case OcgMessageType.POS_CHANGE:
      return after({ type: "position", cle: placeKey(msg) });
    case OcgMessageType.ATTACK:
      return before({ type: "attaque", de: placeKey(msg.card), vers: msg.target ? placeKey(msg.target) : undefined, joueur: msg.card.controller });
    case OcgMessageType.DAMAGE:
      return after({ type: "lp", joueur: msg.player, delta: -msg.amount, directe: ctx.direct });
    case OcgMessageType.PAY_LPCOST:
      return after({ type: "lp", joueur: msg.player, delta: -msg.amount, directe: false });
    case OcgMessageType.RECOVER:
      return after({ type: "lp", joueur: msg.player, delta: msg.amount, directe: false });
    case OcgMessageType.LPUPDATE: {
      const delta = (msg.lp | 0) - board.players[msg.player].lp;
      return delta ? after({ type: "lp", joueur: msg.player, delta, directe: false }) : NONE;
    }
    case OcgMessageType.CHAINING:
      return after({ type: "activation", cle: placeKey(msg), maillon: msg.chain_size, joueur: msg.controller });
    case OcgMessageType.CHAIN_SOLVED:
      return before({ type: "resolution", maillon: msg.chain_size, annule: false });
    case OcgMessageType.CHAIN_NEGATED:
    case OcgMessageType.CHAIN_DISABLED:
      return before({ type: "resolution", maillon: msg.chain_size, annule: true });
    case OcgMessageType.NEW_PHASE:
      return after({ type: "phase", phase: msg.phase, joueur: board.turnPlayer });
    case OcgMessageType.NEW_TURN:
      return after({ type: "tour", joueur: msg.player, tour: board.turn + 1 });
    default:
      return NONE;
  }
}

// The steps to play for a batch of messages received on `board`, in their order.
export function etapes(board: Board, messages: readonly Message[], cards: Cards): Etape[] {
  const steps: Etape[] = [];
  let prelude: Message[] = [];
  let current = board;
  let direct = false;
  messages.forEach((msg, i) => {
    const next = messages.slice(i + 1).find((later) => TELLING.has(later.type));
    if (msg.type === OcgMessageType.ATTACK) direct = !msg.target;
    const { avant, apres } = effects(msg, { board: current, cards, next, direct });
    if (msg.type === OcgMessageType.DAMAGE) direct = false;
    if (avant.length + apres.length > 0) {
      steps.push({ prelude, avant, message: msg, apres });
      prelude = [];
    } else prelude.push(msg);
    current = playAll(current, [msg]);
  });
  if (prelude.length > 0) steps.push({ prelude, avant: [], apres: [] });
  return steps;
}
