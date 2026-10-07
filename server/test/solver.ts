import { OcgMessageType, OcgResponseType, SelectBattleCMDAction, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { Message } from "../../client/src/board.ts";
import { avancer, CELTIC, MIRROR_FORCE, POT_OF_GREED, SUMMONED_SKULL } from "../../client/src/tutoriel.ts";
import { announceCard } from "../src/announce.ts";
import type { Player } from "../src/duel.ts";
import type { Step } from "../src/puzzles.ts";
import { respond } from "../src/respond.ts";

// Index of each code in the list, a different card each time.
export function pick(list: readonly { code: number }[], codes: readonly number[]): number[] {
  const taken: number[] = [];
  for (const code of codes) {
    const index = list.findIndex((card, i) => card.code === code && !taken.includes(i));
    if (index === -1) throw new Error(`carte ${code} introuvable parmi ${list.map((card) => card.code).join(", ")}`);
    taken.push(index);
  }
  return taken;
}

function command(question: OcgMessage, action: string, codes: readonly number[]): OcgResponse | undefined {
  if (question.type === OcgMessageType.SELECT_IDLECMD) {
    if (action === "activate") return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: pick(question.activates, codes)[0] };
    if (action === "battle") return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
  }
  if (question.type === OcgMessageType.SELECT_BATTLECMD) {
    if (action === "attack") return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: pick(question.attacks, codes)[0] };
    if (action === "main2") return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null };
  }
  return undefined;
}

function selection(question: OcgMessage, codes: readonly number[]): OcgResponse | undefined {
  if (question.type === OcgMessageType.SELECT_CARD) return { type: OcgResponseType.SELECT_CARD, indicies: pick(question.selects, codes) };
  if (question.type === OcgMessageType.SELECT_TRIBUTE) return { type: OcgResponseType.SELECT_TRIBUTE, indicies: pick(question.selects, codes) };
  if (question.type === OcgMessageType.SELECT_UNSELECT_CARD && !question.can_finish) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: pick(question.select_cards, codes)[0] };
  return undefined;
}

// The response of a step to this question, undefined when the step is for a later question.
export const play = (question: OcgMessage, [action, ...codes]: Step) => (action === "select" ? selection(question, codes) : command(question, action, codes));

export const ACTIONS = new Set(["activate", "battle", "attack", "main2", "select"]);

// Plays the steps in order, each on the first question it fits; passes on chains, first option for anything else.
export function solver(steps: readonly Step[]): Player {
  const left = [...steps];
  return (question) => {
    const response = left.length > 0 ? play(question, left[0]) : undefined;
    if (response) {
      left.shift();
      return response;
    }
    if (question.type === OcgMessageType.SELECT_CHAIN && !question.forced) return { type: OcgResponseType.SELECT_CHAIN, index: null };
    return respond(question, announceCard);
  };
}

// The player ends their turn at once.
export const pass: Player = (question) => {
  if (question.type === OcgMessageType.SELECT_IDLECMD) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
  return respond(question, announceCard);
};

const index = (list: readonly { code: number }[], code: number) => list.findIndex((card) => card.code === code);
const idle = (action: SelectIdleCMDAction, at: number | null = null): OcgResponse => ({ type: OcgResponseType.SELECT_IDLECMD, action, index: at });
const battle = (action: SelectBattleCMDAction, at: number | null = null): OcgResponse => ({ type: OcgResponseType.SELECT_BATTLECMD, action, index: at });

// What the tutorial step `step` asks for, undefined when this question is not for it.
function lesson(step: number, question: OcgMessage): OcgResponse | undefined {
  if (question.type === OcgMessageType.SELECT_IDLECMD) {
    const actions = [
      idle(SelectIdleCMDAction.SELECT_SUMMON, index(question.summons, CELTIC)),
      idle(SelectIdleCMDAction.TO_BP),
      idle(SelectIdleCMDAction.SELECT_SPELL_SET, index(question.spell_sets, MIRROR_FORCE)),
      idle(SelectIdleCMDAction.TO_EP),
      undefined,
      idle(SelectIdleCMDAction.SELECT_ACTIVATE, index(question.activates, POT_OF_GREED)),
      idle(SelectIdleCMDAction.SELECT_SUMMON, index(question.summons, SUMMONED_SKULL)),
      idle(SelectIdleCMDAction.TO_BP),
    ];
    return actions[step];
  }
  if (question.type === OcgMessageType.SELECT_BATTLECMD) {
    if (step === 1) return battle(SelectBattleCMDAction.SELECT_BATTLE, index(question.attacks, CELTIC));
    if (step === 7) return battle(SelectBattleCMDAction.SELECT_BATTLE, index(question.attacks, SUMMONED_SKULL));
    return battle(step === 2 ? SelectBattleCMDAction.TO_M2 : SelectBattleCMDAction.TO_EP);
  }
  if (question.type === OcgMessageType.SELECT_CHAIN && step === 4 && index(question.selects, MIRROR_FORCE) !== -1) {
    return { type: OcgResponseType.SELECT_CHAIN, index: index(question.selects, MIRROR_FORCE) };
  }
  return undefined;
}

// Seat 0 follows the instructions of the tutorial, its step read from the messages so far; passes on chains, first option for anything else.
export const pupil: Player = (question, log) => {
  const response = lesson(avancer(0, log as unknown as Message[], 0), question);
  if (response) return response;
  if (question.type === OcgMessageType.SELECT_CHAIN && !question.forced) return { type: OcgResponseType.SELECT_CHAIN, index: null };
  return respond(question, announceCard);
};
