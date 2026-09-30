import type { OcgMessage, OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { DeckDraft } from "./deckcheck.ts";
import type { EmoteId } from "./emotes.ts";
import type { Printing } from "./pool.ts";

// WebSocket protocol, shared with the client. Payloads are JSON: bigint fields travel as strings.
export type Wire<T> = T extends bigint ? string : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

export type Seat = 0 | 1;

// Longest text of a bug report.
export const REPORT_MAX = 500;

// Copies of a card a duplicate conversion keeps, and the most a card can be obtained up to with collection points.
export const KEEP_COPIES = 3;

export type BotLevel = "debutant" | "normal" | "expert";
// Story duel difficulty: "facile" doubles the starting LP of the player.
export type StoryLevel = "normal" | "facile";

// `auth` must come first, with the Supabase access token. Joining a room again as the same user resumes the seat.
export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "pseudo"; pseudo: string }
  | { type: "starter"; starter: "yugi" | "kaiba" }
  // `event`: a room under the special rule of the week (see `event`); absent or false, a normal duel.
  | { type: "create"; event?: boolean }
  // A room against the bot, which takes seat 1. Without `level`, the bot plays at "normal". `event`: as for `create`.
  | { type: "bot"; level?: BotLevel; event?: boolean }
  | { type: "join"; room: string }
  | { type: "respond"; response: OcgResponse }
  // Gives up the duel in progress: the other seat wins.
  | { type: "surrender" }
  // Reports a problem of the duel in progress or just ended: the server stores what it takes to replay it, with an optional text
  // of at most 500 characters. Answered with `report_sent`. 5 per player and per hour.
  | { type: "report"; message?: string }
  // A phrase of the fixed list (emotes.ts) for the other seat. One per EMOTE_DELAY: the server ignores the others.
  | { type: "emote"; id: EmoteId }
  // After a duel: against the bot, starts an identical one at once. Online, asks for a rematch (or accepts the one asked,
  // or refuses it with `accept: false`): it starts, with each player's active deck, once both seats asked.
  | { type: "rematch"; accept?: boolean }
  // Collection and decks: each deck message is answered with `decks`. `save_deck` creates a deck without `id`.
  | { type: "collection" }
  | { type: "decks" }
  | { type: "save_deck"; deck: DeckDraft }
  | { type: "delete_deck"; id: number }
  | { type: "active_deck"; id: number }
  // Wishlist (wishlist.ts): each message is answered with `wishlist`. `wish_add` fails for a card out of the pool or past WISH_MAX.
  | { type: "wishlist" }
  | { type: "wish_add"; code: number }
  | { type: "wish_remove"; code: number }
  // Collection points (economy.ts): `convert_preview` is answered with `conversion`. `convert` turns the copies past 3 of
  // each card into points if they still give `points`, the preview confirmed; `craft` spends points on one Common copy of a
  // booster card owned fewer than 3 times. Both are answered with `collection`.
  | { type: "convert_preview" }
  | { type: "convert"; points: number }
  | { type: "craft"; code: number }
  // Avatar and favorite card (profile.ts): each message is answered with `player_profile`. `set_avatar` and `set_favorite` fail for a card not owned.
  | { type: "player_profile" }
  | { type: "set_avatar"; code: number }
  | { type: "set_favorite"; code: number }
  // Boosters: `booster_state` is answered with `booster_state`, `open_booster` with `booster_opened` or an error.
  | { type: "booster_state" }
  | { type: "open_booster"; set: string }
  // Accounts listed in ADMIN_USER_IDS only: adds 1 to ADMIN_BOOSTERS_MAX earned boosters, answered with `booster_state`.
  | { type: "admin_boosters"; count: number }
  // Wonder pick, once a day (wonder.ts): `wonder` reads the state, `wonder_draw` draws the 5 cards, `wonder_pick` keeps the face-down
  // card `index` (0 to 4). Each is answered with `wonder`, or an error.
  | { type: "wonder" }
  | { type: "wonder_draw" }
  | { type: "wonder_pick"; index: number }
  // Story mode: `story` asks for the arcs and progression, `story_duel` starts a duel against the bot, at "normal" without `level`.
  | { type: "story" }
  | { type: "story_duel"; duel: string; level?: StoryLevel }
  // Wins and losses of the player per deck, answered with `duel_results`.
  | { type: "duel_results" }
  // The event of the week, answered with `event`.
  | { type: "event" };

export type DuelMode = "online" | "bot" | "story";
// Wins and losses of a player with a deck in a mode (and at a level, against the bot or in Story mode); `deck` is null for a deck deleted since.
export type DeckResult = { deck: number | null; mode: DuelMode; level?: string; wins: number; losses: number };

export type Deck = { id: number; name: string; main: number[]; extra: number[] };

// Current ATK and DEF of Monster Zones 0-4 of each player, null for an empty zone or a monster the player may not see.
// Not an engine message: the server adds it after the engine messages, like MSG_UPDATE_DATA in EDOPro.
export type StatsEvent = { type: "stats"; monsters: [MonsterStats[], MonsterStats[]] };
export type MonsterStats = { atk: number; def: number } | null;
export type DuelEvent = OcgMessage | StatsEvent;

// `joined` replays every message the player was allowed to see, which rebuilds the board after a reconnection,
// from the starting LP (`lp` for the player, `opponentLp` when the opponent's differs), main deck and extra deck sizes (the engine never sends them).
// `opponent` is the name of the other seat once someone (a player, the bot or a story character) sits there, `opponentAvatar`
// the avatar (passcode of a card whose artwork to show) of an opponent who is a player and chose one.
// `special`: the special rules of an event room (names of story.ts EXTRA_RULES).
// `profile` answers `auth`, `pseudo` and `starter`: a null pseudo means the player has to choose one before playing,
// `needsStarter` means the player has a pseudo but no active deck yet and must pick a starter deck.
// `daily`: this connection is the first of the day (Europe/Paris), which earned a booster.
export type ServerMessage =
  | { type: "profile"; pseudo: string | null; needsStarter: boolean; admin?: true; daily?: true }
  | { type: "joined"; room: string; seat: Seat; lp: number; opponentLp?: number; decks: [number, number]; extras: [number, number]; opponent?: string; opponentAvatar?: number; special?: string[]; log: DuelEvent[] }
  | { type: "messages"; messages: DuelEvent[] }
  // `announce`: for ANNOUNCE_CARD, the pool cards the engine accepts.
  | { type: "question"; question: OcgMessage; retry: boolean; announce?: number[] }
  // Online duel between two players: ms left before `seat` loses, to answer the engine or to come back after a lost connection.
  // null: that clock stopped. Sent to both players, and again to a player who comes back.
  | { type: "timer"; kind: "answer" | "reconnect"; seat: Seat; ms: number | null }
  | { type: "error"; error: string }
  // An emote of `seat`, sent to both seats.
  | { type: "emote"; seat: Seat; id: EmoteId }
  // Online: `from` asked for a rematch. `rematch_declined`: refused or left, no rematch in this room. A new duel starts with `joined`.
  | { type: "rematch"; from: Seat }
  | { type: "rematch_declined" }
  | { type: "report_sent" }
  // Owned cards as [passcode, quantity]. `rarities`: copies of known rarity as [passcode, rarity, quantity], the rest of
  // a card's quantity (copies obtained before rarities were kept) has an unknown rarity.
  // `points`: collection points to spend with `craft`.
  | { type: "collection"; cards: [number, number][]; rarities: [number, string, number][]; points: number }
  // Copies a conversion would turn into points, as [passcode, rarity ("" when unknown), quantity], and the points they give.
  | { type: "conversion"; cards: [number, string, number][]; points: number }
  // `saved` is the deck a `save_deck` just stored.
  | { type: "decks"; decks: Deck[]; active: number | null; saved?: number }
  | { type: "duel_error"; error: string }
  // Avatar and favorite card of the player, null until chosen.
  | { type: "player_profile"; avatar: number | null; favorite: number | null }
  // Wished passcodes, oldest first. Owned cards stay in the list until the player removes them.
  | { type: "wishlist"; cards: number[] }
  // `ultraIn`: the booster that many openings ahead holds an Ultra Rare or better for sure (1: the next one).
  | { type: "booster_state"; nextFreeAt: string; pending: number; ultraIn: number }
  | { type: "booster_opened"; set: string; cards: Printing[] }
  | ({ type: "wonder" } & WonderView)
  | { type: "story"; arcs: StoryArcView[] }
  // A won story duel, recorded.
  | ({ type: "story_won"; duel: string; outro: string } & StoryResult)
  | { type: "duel_results"; results: DeckResult[] }
  // The event of the week: a story special rule (story.ts EXTRA_RULES) played with `lp` and `hand`; `won`: this week's booster was taken.
  | { type: "event"; rule: string; lp: number; hand: number; won: boolean }
  // The first event win of the week was just recorded: 1 booster earned.
  | { type: "event_won" };

// Wonder pick of the day. `cards` are shown face up in this order, then shuffled: face-down card `i` is `cards[shuffle[i]]`.
// The server keeps `shuffle` to itself until the player picks `picked`, a face-down index.
export type WonderView =
  | { status: "available" }
  | { status: "drawn"; cards: Printing[] }
  | { status: "picked"; cards: Printing[]; shuffle: number[]; picked: number };

export type Rewards = { boosters?: number; cards?: number[] };
// A booster for every REPLAY_WINS wins of story duels already won, REPLAY_BOOSTERS_MAX a day at most (Europe/Paris).
export const REPLAY_WINS = 3;
export const REPLAY_BOOSTERS_MAX = 2;
// `rewards` of a first win, null for a duel already won. `stars` of this win (1: won, 2: at "normal", 3: at "normal" with at
// least half the starting LP left), `best` kept for the duel; `starBooster`: the booster of the first 3 stars of the duel.
// `replays`, for a duel already won: wins of the current series of REPLAY_WINS, the last one gives a booster.
// `replayLimit`: REPLAY_BOOSTERS_MAX replay boosters already earned today, this win does not count.
export type StoryResult = { rewards: Rewards | null; stars: number; best: number; starBooster: boolean; replays?: number; replayLimit?: true };
// Locked until every duel of `requires` is won.
export type StoryStatus = "locked" | "available" | "done";
export type StoryDuelView = {
  id: string;
  title: string;
  opponent: string;
  lp: number;
  hand: number;
  special: string[];
  intro: string;
  outro?: string;
  rewards: Rewards;
  requires: string[];
  status: StoryStatus;
  // Best stars won, 0 until the duel is won.
  stars: number;
};
export type StoryArcView = { id: string; title: string; duels: StoryDuelView[] };

// GET /api/cards: every card of the pool by passcode, from BabelCDB with French name and text from YGOJSON (English when
// missing). `strings` are the effect descriptions (str1 to str16), in English. GET /api/strings: EDOPro system strings, in French.
export type CardInfo = {
  name: string;
  // Passcode of the original card for an alternate artwork, or of the card it is treated as; 0 otherwise.
  alias: number;
  desc: string;
  type: number;
  level: number;
  attribute: number;
  race: number;
  atk: number;
  def: number;
  strings: string[];
  // French labels from the EDOPro system strings: "TÉNÈBRES", "Magicien / Effet", "Magie Continue".
  attributeName: string;
  typeLine: string;
  // GET /api/art/<code>.jpg exists: the artwork alone, square, without the card frame.
  image: boolean;
};
