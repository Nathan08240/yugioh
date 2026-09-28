// Steps the pack-opening animation one card at a time, pure so the stepping can be tested without timers.
export type RevealState = { revealed: number; total: number };

export const startReveal = (total: number): RevealState => ({ revealed: 0, total });

// One more card revealed, capped at `total`.
export function stepReveal(state: RevealState): RevealState {
  return state.revealed >= state.total ? state : { ...state, revealed: state.revealed + 1 };
}

export const isDone = (state: RevealState) => state.revealed >= state.total;
