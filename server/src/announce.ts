import { cardMatchesOpcode, type OcgOpCode } from "@n1xx1/ocgcore-wasm";
import { readCard } from "./cards.ts";
import { POOL } from "./pool.ts";

// ponytail: first pool card the filter accepts, scanning the whole pool on each announce.
export function announceCard(opcodes: OcgOpCode[]): number {
  for (const code of POOL) {
    const card = readCard(code);
    if (card && cardMatchesOpcode(card, opcodes)) return code;
  }
  throw new Error("aucune carte déclarable");
}
