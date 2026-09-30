// Wonder pick: the cards are shown face up, turned over and shuffled, then the player picks one. Pure, tested without the DOM.

export type Phase = "look" | "shuffle" | "choose" | "result";

// Time the cards stay face up, and the duration of each step of the shuffle (ms).
export const LOOK_MS = 5000;
export const SHUFFLE_MS = 550;

// Shuffle shown while the cards are face down: card `i` slides to slot `SHUFFLE_ROUNDS[round][i]`. Only a show: the real
// order is the server's, which keeps it to itself until the pick. The last round puts every card back in its slot.
export const SHUFFLE_ROUNDS: readonly (readonly number[])[] = [
  [2, 4, 0, 3, 1],
  [3, 0, 4, 1, 2],
  [1, 3, 2, 4, 0],
  [4, 2, 1, 0, 3],
  [0, 1, 2, 3, 4],
];

// Distance, in slots, each card slides in `round`; none before the first round (-1).
export const slideOffsets = (count: number, round: number): number[] =>
  Array.from({ length: count }, (_, card) => (SHUFFLE_ROUNDS[round]?.[card] ?? card) - card);

// The cards in their face-down order: slot `i` holds the card of rank `shuffle[i]` of the order they were shown in.
export const faceDownOrder = <T>(cards: readonly T[], shuffle: readonly number[]): T[] => shuffle.map((rank) => cards[rank]);
