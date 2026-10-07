import postgres from "postgres";
import { dbAdminStore, type AdminStore } from "./admin.ts";
import { verifySession } from "./auth.ts";
import { boosterState, creditBoosters, openBooster } from "./boosters.ts";
import { dbDeckStore, type DeckStore } from "./collection.ts";
import { activeDeck, createProfile, findProfile, type ActiveDeck, type Db, type Profile } from "./db.ts";
import { dbDraftStore, type DraftStore } from "./draft.ts";
import { dbEconomyStore, type EconomyStore } from "./economy.ts";
import { claimEvent, eventWon } from "./event.ts";
import { onlineToday, winOnline } from "./online.ts";
import { dbFriendStore, type FriendStore } from "./friends.ts";
import { listReplays, readReplay, saveReplay, type HistoryEntry, type StoredReplay } from "./history.ts";
import { dbMissionStore, type MissionStore } from "./missions.ts";
import type { Printing } from "./pool.ts";
import { dbProfileStore, type ProfileStore } from "./profile.ts";
import { dbPublicDeckStore, type PublicDeckStore } from "./public-decks.ts";
import type { DeckResult, ReplaySummary, RevengeResult, StoryResult, TowerView } from "./protocol.ts";
import { solvedPuzzles, solvePuzzle } from "./puzzles.ts";
import { dbRankedStore, type RankedStore } from "./ranked.ts";
import { saveReport, type Report } from "./report.ts";
import { type DuelResult, readResults, recordResult } from "./results.ts";
import { dbSealedStore, type SealedStore } from "./sealed.ts";
import { chooseStarter, type Starter } from "./starter.ts";
import { completeDuel, completedDuels, completeRevenge, revengesWon, type StoryDuel } from "./story.ts";
import { loseTower, startTower, towerView, winTower, type TowerWin } from "./tower.ts";
import { dbTradeStore, type TradeStore } from "./trade.ts";
import { finishTutorial } from "./tutorial.ts";
import { dbWishStore, type WishStore } from "./wishlist.ts";
import { dbWonderStore, type WonderStore } from "./wonder.ts";

// Identity, profile, deck, booster and Story mode storage, faked in tests.
export type Accounts = DeckStore & WishStore & EconomyStore & WonderStore & ProfileStore & SealedStore & DraftStore & FriendStore & TradeStore & RankedStore & MissionStore & AdminStore & PublicDeckStore & {
  verify: (token: string) => Promise<string | null>;
  findProfile: (userId: string) => Promise<Profile | undefined>;
  // Resolves to undefined when the pseudo is already taken.
  createProfile: (userId: string, pseudo: string) => Promise<Profile | undefined>;
  activeDeck: (userId: string) => Promise<ActiveDeck | undefined>;
  // Resolves to false when the player already has an active deck.
  chooseStarter: (userId: string, starter: Starter) => Promise<boolean>;
  boosterState: (userId: string) => Promise<{ nextFreeAt: string; pending: number; ultraIn: number }>;
  // Rejects with a clear message: no right to open, or an unknown set.
  openBooster: (userId: string, setCode: string) => Promise<Printing[]>;
  creditBoosters: (userId: string, count: number) => Promise<void>;
  // Online and ranked wins: resolves to false once today holds ONLINE_BOOSTERS_MAX boosters, and counts today's.
  winOnline: (userId: string) => Promise<boolean>;
  onlineToday: (userId: string) => Promise<number>;
  // Best stars of each story duel won, by id.
  storyProgress: (userId: string) => Promise<ReadonlyMap<string, number>>;
  // Records a win with its stars, resolves to what it earned.
  completeStory: (userId: string, duel: StoryDuel, stars: number) => Promise<StoryResult>;
  // Ids of the arcs whose boss revenge was won, and recording the win of one (the Ultra Rare booster is paid the first time only).
  revengesWon: (userId: string) => Promise<ReadonlySet<string>>;
  completeRevenge: (userId: string, arcId: string) => Promise<RevengeResult>;
  // Stores the result of a finished duel for a human player, and reads their wins and losses per deck and mode.
  recordResult: (result: DuelResult) => Promise<void>;
  duelResults: (userId: string) => Promise<DeckResult[]>;
  // Ids of the puzzles solved; recording a solved puzzle resolves to true the first time, which earns a booster.
  solvedPuzzles: (userId: string) => Promise<ReadonlySet<string>>;
  solvePuzzle: (userId: string, id: string) => Promise<boolean>;
  // Records a win of the tutorial: true the first time, which earns a booster.
  finishTutorial: (userId: string) => Promise<boolean>;
  // Resolves to false when the player already sent too many reports this hour.
  saveReport: (userId: string, message: string, report: Report) => Promise<boolean>;
  // Duels to watch again (history.ts): keeps one (the last HISTORY_MAX per player), lists them, reads one of the player's.
  saveReplay: (entry: HistoryEntry) => Promise<void>;
  replays: (userId: string) => Promise<ReplaySummary[]>;
  readReplay: (userId: string, id: number) => Promise<StoredReplay | undefined>;
  // Event of the week (event.ts): whether its booster was taken, and taking it (resolves to false when it already was).
  eventWon: (userId: string, eventId: string) => Promise<boolean>;
  claimEvent: (userId: string, eventId: string) => Promise<boolean>;
  // Tower mode (tower.ts): progression, the floor of the next duel, the win or the loss of a floor.
  towerView: (userId: string) => Promise<TowerView>;
  startTower: (userId: string) => Promise<number>;
  winTower: (userId: string, floor: number) => Promise<TowerWin>;
  loseTower: (userId: string, floor: number) => Promise<void>;
};

export function dbAccounts(db: Db): Accounts {
  return {
    verify: (token) => verifySession(token),
    findProfile: (userId) => findProfile(db, userId),
    createProfile: (userId, pseudo) =>
      createProfile(db, userId, pseudo).catch((error: unknown) => {
        if (error instanceof postgres.PostgresError && error.code === "23505") return undefined;
        throw error;
      }),
    activeDeck: (userId) => activeDeck(db, userId),
    chooseStarter: (userId, starter) => chooseStarter(db, userId, starter),
    boosterState: (userId) => boosterState(db, userId),
    openBooster: (userId, setCode) => openBooster(db, userId, setCode),
    creditBoosters: (userId, count) => creditBoosters(db, userId, count),
    winOnline: (userId) => winOnline(db, userId),
    onlineToday: (userId) => onlineToday(db, userId),
    storyProgress: (userId) => completedDuels(db, userId),
    completeStory: (userId, duel, stars) => completeDuel(db, userId, duel, stars),
    revengesWon: (userId) => revengesWon(db, userId),
    completeRevenge: (userId, arcId) => completeRevenge(db, userId, arcId),
    recordResult: (result) => recordResult(db, result),
    duelResults: (userId) => readResults(db, userId),
    solvedPuzzles: (userId) => solvedPuzzles(db, userId),
    solvePuzzle: (userId, id) => solvePuzzle(db, userId, id),
    finishTutorial: (userId) => finishTutorial(db, userId),
    saveReport: (userId, message, report) => saveReport(db, userId, message, report),
    saveReplay: (entry) => saveReplay(db, entry),
    replays: (userId) => listReplays(db, userId),
    readReplay: (userId, id) => readReplay(db, userId, id),
    eventWon: (userId, eventId) => eventWon(db, userId, eventId),
    claimEvent: (userId, eventId) => claimEvent(db, userId, eventId),
    towerView: (userId) => towerView(db, userId),
    startTower: (userId) => startTower(db, userId),
    winTower: (userId, floor) => winTower(db, userId, floor),
    loseTower: (userId, floor) => loseTower(db, userId, floor),
    ...dbDeckStore(db),
    ...dbWishStore(db),
    ...dbEconomyStore(db),
    ...dbWonderStore(db),
    ...dbProfileStore(db),
    ...dbSealedStore(db),
    ...dbDraftStore(db),
    ...dbFriendStore(db),
    ...dbTradeStore(db),
    ...dbRankedStore(db),
    ...dbMissionStore(db),
    ...dbAdminStore(db),
    ...dbPublicDeckStore(db),
  };
}
