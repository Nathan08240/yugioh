// Engine messages as a queue of animations (design/motion.md): the board stays pure, the display catches up with it.
import { OcgAttribute, OcgLocation, OcgMessageType, OcgPhase, OcgPosition, OcgType } from "@n1xx1/ocgcore-wasm";
import { cardAt, playAll, type Board, type Message, type Place } from "../board.ts";
import { has, type Cards } from "../cards.ts";
import { placeKey } from "../question.ts";
import { pileId } from "./disposition.ts";

export type Depart = "destruction" | "sacrifice" | "materiau" | "bannissement" | "main" | "deck" | "extra";
export type Variation = { cle: string; atk: number; def: number };
// `depuis`: the pile a card entering the field comes from (none: the hand). `vers`: the zone a tribute or a material goes into.
// `combat`: damage calculation, with the damage the battle deals. `choc`: the LP change is damage (the camera shakes).
export type Effet =
  | { type: "pioche"; joueur: number; nombre: number }
  | { type: "entree"; cle: string; joueur: number; depuis?: string }
  | { type: "invocation"; cle: string; code: number; genre: "normale" | "fusion" | "dieu" }
  | { type: "pose"; cle: string }
  | { type: "position"; cle: string }
  | { type: "depart"; cle: string; genre: Depart; vers?: string }
  | { type: "attaque"; de: string; vers?: string; joueur: number }
  | { type: "combat"; de: string; vers?: string; joueur: number; degats: number }
  | { type: "lp"; joueur: number; delta: number; directe: boolean; choc?: boolean }
  | { type: "activation"; cle: string; maillon: number; joueur: number }
  | { type: "resolution"; maillon: number; annule: boolean }
  | { type: "phase"; phase: number; joueur: number }
  | { type: "tour"; joueur: number; tour: number }
  | { type: "stats"; cartes: Variation[] };

// Messages without animation of their own are applied at once, before the next step (`prelude`).
// `avant` plays before `message` changes the board (the card still in place), `apres` once it has.
export type Etape = { prelude: Message[]; avant: Effet[]; message?: Message; apres: Effet[] };

const ON_FIELD: ReadonlySet<number> = new Set([OcgLocation.MZONE, OcgLocation.SZONE]);
// Where a card leaving the field goes, other than the Graveyard (whose reason depends on what follows).
const DESTINATIONS: ReadonlyMap<number, Depart> = new Map([
  [OcgLocation.REMOVED, "bannissement"],
  [OcgLocation.HAND, "main"],
  [OcgLocation.DECK, "deck"],
  [OcgLocation.EXTRA, "extra"],
]);
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

// The piles a card can enter the field from, other than the hand.
const SOURCES: ReadonlySet<number> = new Set([OcgLocation.GRAVE, OcgLocation.REMOVED, OcgLocation.DECK, OcgLocation.EXTRA]);

const MAIN: ReadonlySet<number> = new Set([OcgPhase.MAIN1, OcgPhase.MAIN2]);

// A monster leaving the field just before a Tribute Summon (or Set) is a tribute; before a Fusion Summon, a material.
// The engine asks for the zone in between, so the summon often comes in a later batch: a monster sent to the Graveyard
// in a Main Phase outside a chain is taken for a tribute too.
function departure(ctx: Ctx, from: Place): { genre: Depart; vers?: string } {
  const { next, cards, board } = ctx;
  if (next?.type === OcgMessageType.SUMMONING) return { genre: "sacrifice", vers: placeKey(next) };
  if (next?.type === OcgMessageType.SET && next.location === OcgLocation.MZONE) return { genre: "sacrifice", vers: placeKey(next) };
  if (next?.type === OcgMessageType.SPSUMMONING && has(cards.get(next.code)?.type ?? 0, OcgType.FUSION)) return { genre: "materiau", vers: placeKey(next) };
  if (!next && from.location === OcgLocation.MZONE && board.chain.length === 0 && MAIN.has(board.phase)) return { genre: "sacrifice" };
  return { genre: "destruction" };
}

// Battle damage of a damage calculation: the ATK gap, the DEF over the attacker's ATK, the whole ATK for a direct attack.
function degats({ card, target }: Extract<Message, { type: OcgMessageType.BATTLE }>): number {
  if (!target) return card.attack;
  if (has(target.position, OcgPosition.DEFENSE)) return Math.max(0, target.defense - card.attack);
  return Math.abs(card.attack - target.attack);
}

function summonKind(msg: Extract<Message, { code: number }>, cards: Cards): "normale" | "fusion" | "dieu" {
  const info = cards.get(msg.code);
  if (info?.attribute === OcgAttribute.DIVINE) return "dieu";
  if (msg.type === OcgMessageType.SPSUMMONING && has(info?.type ?? 0, OcgType.FUSION)) return "fusion";
  return "normale";
}

function moveEffects(msg: Extract<Message, { type: OcgMessageType.MOVE }>, ctx: Ctx): Pick<Etape, "avant" | "apres"> {
  const { from, to } = msg;
  if (ON_FIELD.has(from.location) && cardAt(ctx.board, from)) {
    const { genre, vers } = to.location === OcgLocation.GRAVE ? departure(ctx, from) : { genre: DESTINATIONS.get(to.location), vers: undefined };
    if (genre) return { avant: [{ type: "depart", cle: placeKey(from), genre, vers }], apres: [] };
  }
  if (ON_FIELD.has(to.location) && !ON_FIELD.has(from.location)) {
    // Banished cards lie beside the Graveyard (disposition.ts): they come back from it.
    const pile = from.location === OcgLocation.REMOVED ? OcgLocation.GRAVE : from.location;
    const depuis = SOURCES.has(from.location) ? pileId(from.controller, pile) : undefined;
    return { avant: [], apres: [{ type: "entree", cle: placeKey(to), joueur: to.controller, depuis }] };
  }
  return { avant: [], apres: [] };
}

const NONE = { avant: [], apres: [] };
const after = (...apres: Effet[]) => ({ avant: [], apres });
const before = (...avant: Effet[]) => ({ avant, apres: [] });

// Change of a stat against the one shown, else the printed one (unknown for a "?" ATK).
function variation(now: number, shown: number | undefined, printed: number | undefined) {
  const base = shown ?? printed;
  return base === undefined || base < 0 ? 0 : now - base;
}

// The monsters whose ATK or DEF differ from what the board shows.
function statsEffects(msg: Extract<Message, { type: "stats" }>, ctx: Ctx): Pick<Etape, "avant" | "apres"> {
  const cartes = msg.monsters.flatMap((list, controller) =>
    list.flatMap((now, sequence) => {
      const card = ctx.board.players[controller].monsters[sequence];
      if (!now || !card) return [];
      const info = ctx.cards.get(card.code);
      const atk = variation(now.atk, card.atk, info?.atk);
      const def = variation(now.def, card.def, info?.def);
      return atk || def ? [{ cle: placeKey({ controller, location: OcgLocation.MZONE, sequence }), atk, def }] : [];
    }),
  );
  return cartes.length > 0 ? after({ type: "stats", cartes }) : NONE;
}

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
    case OcgMessageType.BATTLE:
      return before({ type: "combat", de: placeKey(msg.card), vers: msg.target ? placeKey(msg.target) : undefined, joueur: msg.card.controller, degats: degats(msg) });
    case OcgMessageType.DAMAGE:
      return after({ type: "lp", joueur: msg.player, delta: -msg.amount, directe: ctx.direct, choc: true });
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
    case "stats":
      return statsEffects(msg, ctx);
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
    if (msg.type === OcgMessageType.ATTACK || msg.type === OcgMessageType.BATTLE) direct = !msg.target;
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
