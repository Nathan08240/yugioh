import { YUGI } from "../src/decks.ts";
import { GOAT } from "../src/limits.ts";
import type { DraftStore } from "../src/draft.ts";
import type { SealedStore } from "../src/sealed.ts";
import type { Accounts } from "../src/server.ts";

// Yugi's starter deck without the cards the Goat list forbids (Raigeki, Dark Hole...), swapped one for one for Flame Swordsman.
export const GOAT_YUGI = YUGI.map((code) => (GOAT.get(code) === 0 ? 45231177 : code));

// A player without any Sealed session.
export const noSealed: SealedStore = {
  sealedRun: async () => undefined,
  startSealed: async () => {
    throw new Error("non simulé");
  },
  saveSealedDeck: async () => "non simulé",
  sealedResult: async () => undefined,
  abandonSealed: async () => undefined,
};

// A player without any Draft session.
export const noDraft: DraftStore = {
  draftRun: async () => undefined,
  startDraft: async () => {
    throw new Error("non simulé");
  },
  pickDraft: async () => "non simulé",
  saveDraftDeck: async () => "non simulé",
  draftResult: async () => undefined,
  abandonDraft: async () => undefined,
  draftBotDeck: async () => ({ main: [], extra: [] }),
};

// Accounts where every token is the user id, every user has a pseudo and plays Yugi's deck; `overrides` replaces any part.
export function fakeAccounts(overrides: Partial<Accounts> = {}): Accounts {
  return {
    verify: async (token) => token,
    findProfile: async (userId) => ({ userId, pseudo: userId, activeDeckId: 1 }),
    createProfile: async () => undefined,
    activeDeck: async () => ({ main: YUGI, extra: [] }),
    chooseStarter: async () => false,
    collection: async () => ({ cards: [], rarities: [], points: 0 }),
    decks: async () => ({ decks: [], active: null }),
    saveDeck: async () => ({ error: "non simulé" }),
    deleteDeck: async () => false,
    activateDeck: async () => false,
    profileCards: async () => ({ avatar: null, favorite: null }),
    setProfileCard: async () => false,
    wishlist: async () => [],
    addWish: async () => true,
    removeWish: async () => {},
    wonder: async () => ({ status: "available" }),
    wonderDraw: async () => ({ status: "available" }),
    wonderPick: async () => "aucune pioche miracle en cours",
    boosterState: async () => ({ nextFreeAt: new Date(0).toISOString(), pending: 0, ultraIn: 21 }),
    openBooster: async () => [],
    creditBoosters: async () => {},
    storyProgress: async () => new Map(),
    completeStory: async (_userId, _duel, stars) => ({ rewards: null, stars, best: stars, starBooster: false, replays: 1 }),
    recordResult: async () => {},
    duelResults: async () => [],
    solvedPuzzles: async () => new Set(),
    solvePuzzle: async () => true,
    finishTutorial: async () => true,
    saveReplay: async () => {},
    replays: async () => [],
    readReplay: async () => undefined,
    saveReport: async () => true,
    previewConversion: async () => ({ cards: [], points: 0 }),
    convertDuplicates: async () => "aucun doublon à convertir",
    craftCard: async () => "points insuffisants",
    claimDaily: async () => false,
    eventWon: async () => false,
    claimEvent: async () => true,
    towerView: async () => ({ floors: [], floor: 0, best: 0, claimed: [] }),
    startTower: async () => 1,
    winTower: async (_userId, floor) => ({ floor, best: floor, boosters: 0 }),
    ...noSealed,
    ...noDraft,
    friendList: async () => [],
    requestFriend: async () => "joueur introuvable",
    acceptFriend: async () => undefined,
    removeFriend: async () => undefined,
    rating: async () => ({ rating: 1000, games: 0, seasonGames: 0 }),
    ranked: async () => ({ rating: 1000, games: 0, season: "2026-10", daysLeft: 31, seasonGames: 0, leaderboard: [], previousSeason: "2026-09", previousLeaderboard: [], lastResult: null }),
    rateDuel: async () => [
      { before: 1000, after: 1016 },
      { before: 1000, after: 984 },
    ],
    ...overrides,
  };
}
