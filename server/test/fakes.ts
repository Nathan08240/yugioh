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
    wishlist: async () => [],
    addWish: async () => true,
    removeWish: async () => {},
    boosterState: async () => ({ nextFreeAt: new Date(0).toISOString(), pending: 0 }),
    openBooster: async () => [],
    creditBoosters: async () => {},
    storyProgress: async () => new Map(),
    completeStory: async (_userId, _duel, stars) => ({ rewards: null, stars, best: stars, starBooster: false, replays: 1 }),
    recordResult: async () => {},
    duelResults: async () => [],
    saveReport: async () => true,
    eventWon: async () => false,
    claimEvent: async () => true,
    ...overrides,
  };
}
