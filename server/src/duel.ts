import {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  OcgQueryFlags,
  OcgResponseType,
  type InitializerSync,
  type OcgCoreSync,
  type OcgLocPos,
  type OcgMessage,
  type OcgResponse,
} from "@n1xx1/ocgcore-wasm";
import { announceCard } from "./announce.ts";
import { cardName, readCard, readScript } from "./cards.ts";
import { KAIBA, YUGI } from "./decks.ts";
import { respond } from "./respond.ts";
import { hideCards, visibleTo } from "./visibility.ts";

// Goat format (2005): Master Rule 1 plus the pre-2008 rulings, the closest the engine gets to 2002.
export const RULES = OcgDuelMode.MODE_GOAT;
export const STARTING_LP = 4000;
// `cards`: EDOPro Extra Rules cards (aux.EnableExtraRules), shuffled into player 0's deck; each one leaves the duel at the start.
export type Rules = { lp: number; hand: number; cards: readonly number[] };
export const STANDARD_RULES: Rules = { lp: STARTING_LP, hand: 5, cards: [] };
// aux.EnableExtraRules asks both players to agree, Stringid(4014, 6): the host imposes the rule and says yes.
const RULE_AGREEMENT = (4014n << 20n) | 6n;

export function agreeToRules(question: OcgMessage): OcgResponse | undefined {
  if (question.type !== OcgMessageType.SELECT_YESNO || question.description !== RULE_AGREEMENT) return undefined;
  return { type: OcgResponseType.SELECT_YESNO, yes: true };
}
const MAX_STEPS = 20_000;

export type DuelState = {
  turns: number;
  lp: [number, number];
  winner: number | null;
  log: string[];
  errors: string[];
  scripts: string[];
};

export type Seed = [bigint, bigint, bigint, bigint];

// The JSR entry point re-exports everything except the default export, createCore.
async function createCore(options: InitializerSync): Promise<OcgCoreSync> {
  const entry = new URL("dist/index.js", import.meta.resolve("@n1xx1/ocgcore-wasm"));
  const core: { default: typeof createCore } = await import(entry.href);
  return core.default(options);
}

// ocgcore leaves deck order to the host, as EDOPro does: seeded shuffle so a duel replays identically.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(deck: readonly number[], random: () => number): number[] {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const player = (p: number) => `J${p + 1}`;

function track(state: DuelState, msg: OcgMessage) {
  switch (msg.type) {
    case OcgMessageType.NEW_TURN:
      state.turns++;
      break;
    case OcgMessageType.DAMAGE:
    case OcgMessageType.PAY_LPCOST:
      state.lp[msg.player] -= msg.amount;
      break;
    case OcgMessageType.RECOVER:
      state.lp[msg.player] += msg.amount;
      break;
    case OcgMessageType.LPUPDATE:
      state.lp[msg.player] = msg.lp;
      break;
    case OcgMessageType.WIN:
      state.winner = msg.player;
      break;
    default:
      break;
  }
}

function describe(msg: OcgMessage, state: DuelState, nameAt: (loc: OcgLocPos) => string): string | undefined {
  switch (msg.type) {
    case OcgMessageType.NEW_TURN:
      return `--- Tour ${state.turns} : ${player(msg.player)} ---`;
    case OcgMessageType.DRAW:
      return `${player(msg.player)} pioche ${msg.drawn.map((card) => cardName(card.code)).join(", ")}`;
    case OcgMessageType.SUMMONING:
      return `${player(msg.controller)} invoque ${cardName(msg.code)}`;
    case OcgMessageType.SPSUMMONING:
      return `${player(msg.controller)} invoque spécialement ${cardName(msg.code)}`;
    case OcgMessageType.FLIPSUMMONING:
      return `${player(msg.controller)} retourne ${cardName(msg.code)}`;
    case OcgMessageType.SET:
      return `${player(msg.controller)} pose une carte`;
    case OcgMessageType.CHAINING:
      return `${player(msg.controller)} active ${cardName(msg.code)}`;
    case OcgMessageType.ATTACK:
      return `${nameAt(msg.card)} attaque ${msg.target ? nameAt(msg.target) : "directement"}`;
    case OcgMessageType.DAMAGE:
      return `${player(msg.player)} perd ${msg.amount} LP (reste ${state.lp[msg.player]})`;
    case OcgMessageType.RECOVER:
      return `${player(msg.player)} gagne ${msg.amount} LP (total ${state.lp[msg.player]})`;
    case OcgMessageType.MOVE:
      return msg.to.location === OcgLocation.GRAVE ? `${cardName(msg.card)} va au cimetière` : undefined;
    case OcgMessageType.WIN:
      return `${player(msg.player)} gagne le duel`;
    default:
      return undefined;
  }
}

let core: Promise<OcgCoreSync> | undefined;

// Creates a started duel, each deck shuffled by the seed (deck 0 goes to player 0). `extras` are the extra decks, in the same order.
export async function openDuel(
  seed: Seed,
  decks: readonly (readonly number[])[],
  onError: (text: string) => void,
  onScript = (_name: string) => {},
  rules = STANDARD_RULES,
  extras: readonly (readonly number[])[] = [],
) {
  const lib = await (core ??= createCore({ sync: true }));
  const settings = { startingLP: rules.lp, startingDrawCount: rules.hand, drawCountPerTurn: 1 };
  const handle = lib.createDuel({
    flags: RULES,
    seed,
    team1: settings,
    team2: settings,
    cardReader: readCard,
    scriptReader: (name) => {
      onScript(name);
      return readScript(name);
    },
    errorHandler: (_type, text) => onError(text),
  });
  if (!handle) throw new Error("création du duel impossible");

  for (const base of ["constant.lua", "utility.lua"]) lib.loadScript(handle, base, readScript(base) ?? "");
  const random = mulberry32(Number(seed[0]));
  [[...decks[0], ...rules.cards], decks[1]].forEach((deck, owner) => {
    const team = owner as 0 | 1;
    for (const code of shuffle(deck, random)) {
      lib.duelNewCard(handle, { team, duelist: 0, code, controller: team, location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE });
    }
  });
  extras.forEach((extra, owner) => {
    const team = owner as 0 | 1;
    for (const code of extra) {
      lib.duelNewCard(handle, { team, duelist: 0, code, controller: team, location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE });
    }
  });
  lib.startDuel(handle);
  return { lib, handle };
}

// Answers from what its seat may see: the question through hideCards, the messages so far through visibleTo.
export type Player = (question: OcgMessage, log: readonly OcgMessage[]) => OcgResponse;
const firstOption: Player = (question) => respond(question, announceCard);

export async function runDuel(
  seed: Seed,
  maxTurns: number,
  players: readonly Player[] = [firstOption, firstOption],
  decks: readonly (readonly number[])[] = [YUGI, KAIBA],
  rules = STANDARD_RULES,
  extras: readonly (readonly number[])[] = [],
): Promise<DuelState> {
  const state: DuelState = { turns: 0, lp: [rules.lp, rules.lp], winner: null, log: [], errors: [], scripts: [] };
  const { lib, handle } = await openDuel(seed, decks, (text) => state.errors.push(text), (name) => state.scripts.push(name), rules, extras);

  const nameAt = (loc: OcgLocPos) => {
    const card = lib.duelQuery(handle, { flags: OcgQueryFlags.CODE, controller: loc.controller, location: loc.location, sequence: loc.sequence, overlaySequence: 0 });
    return card?.code ? cardName(card.code) : "?";
  };

  const logs: OcgMessage[][] = [[], []];
  let question: OcgMessage | undefined;
  for (let step = 0; step < MAX_STEPS; step++) {
    const status = lib.duelProcess(handle);
    const messages = lib.duelGetMessage(handle);
    const events = status === OcgProcessResult.WAITING ? messages.slice(0, -1) : messages;
    for (const [seat, log] of logs.entries()) log.push(...events.flatMap((msg) => visibleTo(msg, seat) ?? []));
    for (const msg of messages) {
      if (msg.type === OcgMessageType.RETRY) throw new Error(`réponse refusée par le moteur : ${JSON.stringify(question, (_k, v) => (typeof v === "bigint" ? String(v) : v))}`);
      track(state, msg);
      const line = describe(msg, state, nameAt);
      if (line) state.log.push(line);
    }
    if (status === OcgProcessResult.END || state.winner !== null || state.turns > maxTurns) {
      lib.destroyDuel(handle);
      return state;
    }
    question = messages.at(-1);
    if (status === OcgProcessResult.WAITING && question && "player" in question) {
      lib.duelSetResponse(handle, agreeToRules(question) ?? players[question.player](hideCards(question, question.player), logs[question.player]));
    }
  }
  throw new Error(`duel bloqué après ${MAX_STEPS} étapes`);
}

if (import.meta.main) {
  const [turns = "10", seed = "1"] = process.argv.slice(2);
  const state = await runDuel([BigInt(seed), 2n, 3n, 4n], Number(turns));
  console.log(state.log.join("\n"));
  console.log(`\nTours : ${state.turns}, LP : ${state.lp.join(" / ")}, erreurs moteur : ${state.errors.length}`);
  for (const error of state.errors) console.log(`  ${error}`);
}
