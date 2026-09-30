import { cardMatchesOpcode, type OcgOpCode } from "@n1xx1/ocgcore-wasm";
import { readCard } from "./cards.ts";
import { POOL } from "./pool.ts";

// ponytail: scans the whole pool on each announce.
export function declarable(opcodes: OcgOpCode[]): number[] {
  return [...POOL].filter((code) => {
    const card = readCard(code);
    return card ? cardMatchesOpcode(card, opcodes) : false;
  });
}

// The bot declares the first pool card the filter accepts.
export function announceCard(opcodes: OcgOpCode[]): number {
  const [code] = declarable(opcodes);
  if (code === undefined) throw new Error("aucune carte déclarable");
  return code;
}
