import { cardMatchesOpcode, type OcgOpCode } from "@n1xx1/ocgcore-wasm";
import { readCard } from "./cards.ts";
import { POOL } from "./pool.ts";

const accepts = (opcodes: OcgOpCode[], code: number) => {
  const card = readCard(code);
  return card ? cardMatchesOpcode(card, opcodes) : false;
};

// ponytail: scans the whole pool on each announce.
export function declarable(opcodes: OcgOpCode[]): number[] {
  return [...POOL].filter((code) => accepts(opcodes, code));
}

// The distinct cards of `deck` the filter accepts, the most numerous first.
export function declarableFromDeck(opcodes: OcgOpCode[], deck: readonly number[]): number[] {
  const copies = new Map<number, number>();
  for (const code of deck) copies.set(code, (copies.get(code) ?? 0) + 1);
  return [...copies]
    .filter(([code]) => accepts(opcodes, code))
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => code);
}

// The bot declares the card of its own deck it holds most copies of, else the first pool card the filter accepts.
export function announceCard(opcodes: OcgOpCode[], deck: readonly number[] = []): number {
  const code = declarableFromDeck(opcodes, deck)[0] ?? declarable(opcodes)[0];
  if (code === undefined) throw new Error("aucune carte déclarable");
  return code;
}
