// Opening a booster: the pack opens, then one card per touch from the least to the most rare. Pure, tested without the DOM.

// Printing rarities of the server (server/src/pool.ts), from the least to the most rare.
export const RARITY_ORDER = ["common", "shortprint", "rare", "super", "ultra", "ultimate", "secret"];

const rank = (rarity: string) => Math.max(0, RARITY_ORDER.indexOf(rarity));

// The cards in reveal order: stable, so the server order stays within a rarity; an unknown rarity counts as common.
export const revealOrder = <T extends { rarity: string }>(cards: readonly T[]): T[] => [...cards].sort((a, b) => rank(a.rarity) - rank(b.rarity));

// `revealed` cards are off the pile, the last one being shown; `playing` while an animation runs (the pack first).
export type RevealState = { total: number; revealed: number; playing: boolean };

export const startReveal = (total: number): RevealState => ({ total, revealed: 0, playing: true });

// A touch skips the animation playing, else reveals the next card.
export function touch(state: RevealState): RevealState {
  if (state.playing) return { ...state, playing: false };
  if (state.revealed >= state.total) return state;
  return { ...state, revealed: state.revealed + 1, playing: true };
}

// End of the animation of card `revealed` (0: the pack); a late end of an earlier one changes nothing.
export const settle = (state: RevealState, revealed: number): RevealState => (state.revealed === revealed ? { ...state, playing: false } : state);

export const revealAll = (state: RevealState): RevealState => ({ ...state, revealed: state.total, playing: false });

export const isDone = (state: RevealState) => state.revealed >= state.total && !state.playing;
