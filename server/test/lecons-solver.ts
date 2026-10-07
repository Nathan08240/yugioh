import { OcgMessageType, OcgResponseType, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { announceCard } from "../src/announce.ts";
import type { Player } from "../src/duel.ts";
import type { Step } from "../src/puzzles.ts";
import { respond } from "../src/respond.ts";
import { pick, play } from "./solver.ts";

// The actions of the lessons on top of the puzzle ones: summon and set from the hand, flip a face-down monster, answer a chain.
export const LESSON_ACTIONS = new Set(["summon", "set", "flip", "chain"]);

const idle = (action: SelectIdleCMDAction, index: number): OcgResponse => ({ type: OcgResponseType.SELECT_IDLECMD, action, index });

function lessonStep(question: OcgMessage, [action, ...codes]: Step): OcgResponse | undefined {
  if (question.type === OcgMessageType.SELECT_IDLECMD) {
    if (action === "summon") return idle(SelectIdleCMDAction.SELECT_SUMMON, pick(question.summons, codes)[0]);
    if (action === "set") return idle(SelectIdleCMDAction.SELECT_SPELL_SET, pick(question.spell_sets, codes)[0]);
    if (action === "flip") return idle(SelectIdleCMDAction.SELECT_POS_CHANGE, pick(question.pos_changes, codes)[0]);
  }
  if (question.type === OcgMessageType.SELECT_CHAIN && action === "chain") {
    // Chain windows come at every phase: only the one offering the card counts.
    const index = question.selects.findIndex((card) => card.code === codes[0]);
    return index === -1 ? undefined : { type: OcgResponseType.SELECT_CHAIN, index };
  }
  return undefined;
}

// Plays the steps in order, each on the first question it fits; passes on the chains it was not asked to answer, first option for anything else.
export function lessonSolver(steps: readonly Step[]): Player {
  const left = [...steps];
  return (question) => {
    const response = left.length > 0 ? (lessonStep(question, left[0]) ?? play(question, left[0])) : undefined;
    if (response) {
      left.shift();
      return response;
    }
    if (question.type === OcgMessageType.SELECT_CHAIN && !question.forced) return { type: OcgResponseType.SELECT_CHAIN, index: null };
    return respond(question, announceCard);
  };
}
