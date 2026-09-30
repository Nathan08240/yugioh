import { OcgMessageType, OcgResponseType, SelectBattleCMDAction, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { announceCard } from "../src/announce.ts";
import type { Player } from "../src/duel.ts";
import type { Step } from "../src/puzzles.ts";
import { respond } from "../src/respond.ts";

// Index of each code in the list, a different card each time.
function pick(list: readonly { code: number }[], codes: readonly number[]): number[] {
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
const play = (question: OcgMessage, [action, ...codes]: Step) => (action === "select" ? selection(question, codes) : command(question, action, codes));

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
