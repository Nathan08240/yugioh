import { YUGI } from "../src/decks.ts";
import type { Accounts } from "../src/server.ts";

// Accounts where every token is the user id, every user has a pseudo and plays Yugi's deck; `overrides` replaces any part.
export function fakeAccounts(overrides: Partial<Accounts> = {}): Accounts {
  return {
    verify: async (token) => token,
    findProfile: async (userId) => ({ userId, pseudo: userId, activeDeckId: 1 }),
    createProfile: async () => undefined,
    activeDeck: async () => ({ main: YUGI, extra: [] }),
    chooseStarter: async () => false,
    collection: async () => ({ cards: [], rarities: [] }),
    decks: async () => ({ decks: [], active: null }),
    saveDeck: async () => ({ error: "non simulé" }),
    deleteDeck: async () => false,
    activateDeck: async () => false,
    boosterState: async () => ({ nextFreeAt: new Date(0).toISOString(), pending: 0 }),
    openBooster: async () => [],
    creditBoosters: async () => {},
    storyProgress: async () => new Set(),
    completeStory: async () => undefined,
    ...overrides,
  };
}
