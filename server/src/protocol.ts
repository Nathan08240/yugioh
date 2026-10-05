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

// Most spectators of a room at once.
export const SPECTATORS_MAX = 20;
// Friends of a player, pending requests included.
export const FRIENDS_MAX = 100;

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
  // Watches the online duel of a room between two players, without taking a seat: answered with `joined` (`spectating`) then
  // `messages` without any hand or face-down card. The room refuses its responses, surrender, emotes, reports and rematches.
  | { type: "spectate"; room: string }
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
  // Friends (friends.ts), by pseudo: `friends` is answered with `friends`, sent again to both players at each change of their list.
  // `friend_add` sends a request (or accepts the one of that player), `friend_accept` accepts one, `friend_remove` refuses,
  // cancels or removes. FRIENDS_MAX friends at most, requests included, and FRIEND_REQUESTS_PER_HOUR requests sent per hour.
  | { type: "friends" }
  | { type: "friend_add"; pseudo: string }
  | { type: "friend_accept"; pseudo: string }
  | { type: "friend_remove"; pseudo: string }
  // Challenges a friend who is online and not in a room: they get `challenged` for CHALLENGE_TIME. Accepted with
  // `challenge_reply`, both players enter a new online room with their active decks.
  | { type: "challenge"; pseudo: string }
  | { type: "challenge_reply"; pseudo: string; accept: boolean }
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
  // Puzzles: `puzzles` asks for the list, answered with `puzzles`; `puzzle` starts one against the bot.
  | { type: "puzzles" }
  | { type: "puzzle"; id: string }
  // The guided duel of the tutorial against the bot; its first win is announced as `puzzle_won` with the id "tutorial".
  | { type: "tutorial" }
  // Wins and losses of the player per deck, answered with `duel_results`.
  | { type: "duel_results" }
  // The event of the week, answered with `event`.
  | { type: "event" }
  // Tower mode: `tower` asks for the floors and progression, `tower_duel` starts the next floor against the bot. After a
  // tower duel, `rematch` starts the next one: the next floor after a win, floor 1 after a loss.
  | { type: "tower" }
  | { type: "tower_duel" }
  // Sealed mode (sealed.ts), each answered with `sealed`: the latest session, a new one (or the one in progress), its deck
  // (once, from the reserve only), or giving it up without reward. `sealed_duel` starts its next duel against the bot.
  | { type: "sealed" }
  | { type: "sealed_start" }
  | { type: "sealed_deck"; main: number[]; extra: number[] }
  | { type: "sealed_abandon" }
  | { type: "sealed_duel" }
  // Draft mode (draft.ts), each answered with `draft`: as the Sealed messages, and `draft_pick` keeps card `index` of the
  // booster in front of the player while the bots keep theirs. `draft_duel` starts the next duel against the bot.
  | { type: "draft" }
  | { type: "draft_start" }
  | { type: "draft_pick"; index: number }
  | { type: "draft_deck"; main: number[]; extra: number[] }
  | { type: "draft_abandon" }
  | { type: "draft_duel" }
  // Ranked mode (ranked.ts): `ranked` is answered with `ranked`. `ranked_queue` waits for an opponent of close rating, with the
  // active deck, until the duel starts with `joined`; `ranked_cancel` stops waiting. Both are answered with `ranked_queue`.
  | { type: "ranked" }
  | { type: "ranked_queue" }
  | { type: "ranked_cancel" };

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
// `floor`: the floor of a tower duel.
// `profile` answers `auth`, `pseudo` and `starter`: a null pseudo means the player has to choose one before playing,
// `needsStarter` means the player has a pseudo but no active deck yet and must pick a starter deck.
// `spectating`: the recipient watches from outside, with `seat` 0 as the point of view: it holds the name and avatar of seat 0 and
// `opponent` those of seat 1; no hand and no face-down card of either seat is in the log.
// `daily`: this connection is the first of the day (Europe/Paris), which earned a booster.
export type ServerMessage =
  | { type: "profile"; pseudo: string | null; needsStarter: boolean; admin?: true; daily?: true }
  | { type: "joined"; room: string; seat: Seat; lp: number; opponentLp?: number; decks: [number, number]; extras: [number, number]; opponent?: string; opponentAvatar?: number; spectating?: { name?: string; avatar?: number }; special?: string[]; log: DuelEvent[]; floor?: number }
  // Spectators of the room, sent to everyone in it when it changes (and to a player who comes back while there are some).
  | { type: "spectators"; count: number }
  | { type: "messages"; messages: DuelEvent[] }
  // `announce`: for ANNOUNCE_CARD, the pool cards the engine accepts. `announceDeck`: those of the asked player's own deck, the most numerous first.
  | { type: "question"; question: OcgMessage; retry: boolean; announce?: number[]; announceDeck?: number[] }
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
  // The friends of the player, by pseudo. `friend_status`: the presence of a friend changed. `friend_notice`: a text to show
  // (request received or accepted, challenge refused or unanswered). `challenged`: `from` challenges the player, for `ms`;
  // `challenge_gone`: that challenge was answered, withdrawn or expired.
  | { type: "friends"; friends: Friend[] }
  | { type: "friend_status"; pseudo: string; status: Presence; watch?: string }
  | { type: "friend_notice"; text: string }
  | { type: "challenged"; from: string; ms: number }
  | { type: "challenge_gone"; from: string }
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
  | { type: "event_won" }
  | { type: "puzzles"; puzzles: PuzzleView[] }
  // A solved puzzle (or the tutorial won, id "tutorial"), recorded: `booster` the first time only.
  | { type: "puzzle_won"; id: string; booster: boolean }
  | ({ type: "tower" } & TowerView)
  // A won tower duel, recorded: `boosters` earned by the first win of a reward floor, 0 otherwise.
  | { type: "tower_won"; floor: number; best: number; boosters: number }
  // null before the first session.
  | { type: "sealed"; run: SealedRun | null }
  | { type: "draft"; run: DraftRun | null }
  | ({ type: "ranked" } & RankedView)
  | { type: "ranked_queue"; waiting: boolean }
  // End of a ranked duel: the change of the player's rating, and the new one.
  | { type: "ranked_result"; delta: number; rating: number };

// Online is connected and not in a room, "duel" is in a room. Never stored.
export type Presence = "online" | "duel" | "offline";
// `status`: the presence of an accepted friend, else the request "sent" by the player or "received" from that player.
// `avatar`: passcode of the card chosen as avatar, null until chosen.
// `watch`: code of the room to watch when an accepted friend is in an online duel between two players.
export type Friend = { pseudo: string; avatar: number | null; status: Presence | "sent" | "received"; watch?: string };

// A player of the ranked leaderboard; `avatar` is null until chosen.
export type RankedPlayer = { pseudo: string; avatar: number | null; rating: number; games: number };

// Ranked seasons (ranked.ts): a calendar month in France, "2026-10". A player with SEASON_MIN_GAMES duels or more in a season
// gets, at its end, the boosters of the first tier whose rating the final rating reaches.
export const SEASON_MIN_GAMES = 5;
export const SEASON_REWARDS: readonly (readonly [rating: number, boosters: number])[] = [
  [1400, 5],
  [1200, 3],
  [1000, 1],
];
export type SeasonResult = { season: string; rating: number; games: number; boosters: number };
// `games`: ranked duels of all seasons. `daysLeft` counts today. Leaderboards list the season duels as `games`: the best
// LEADERBOARD_SIZE players of the season, the best 10 of the previous one. `lastResult`: the last season the player played.
export type RankedView = {
  rating: number;
  games: number;
  season: string;
  daysLeft: number;
  seasonGames: number;
  leaderboard: RankedPlayer[];
  previousSeason: string;
  previousLeaderboard: RankedPlayer[];
  lastResult: SeasonResult | null;
};

// Wonder pick of the day. `cards` are shown face up in this order, then shuffled: face-down card `i` is `cards[shuffle[i]]`.
// The server keeps `shuffle` to itself until the player picks `picked`, a face-down index.
export type WonderView =
  | { status: "available" }
  | { status: "drawn"; cards: Printing[] }
  | { status: "picked"; cards: Printing[]; shuffle: number[]; picked: number };

export type PuzzleView = { id: string; title: string; goal: string; done: boolean };
// WIN reason of a failed puzzle: the player's turn ended with the opponent still standing.
export const PUZZLE_FAILED = 0x60;

export const TOWER_FLOORS = 10;
// `lp`: starting LP of the opponent; `boosters`: reward of the first win of the floor, 0 for none.
export type TowerFloorView = { opponent: string; level: BotLevel; lp: number; boosters: number };
// `floor`: floors won in the current attempt, the next duel is floor + 1. `best`: most floors won in one attempt.
// `claimed`: the floors whose reward was taken.
export type TowerView = { floors: TowerFloorView[]; floor: number; best: number; claimed: number[] };

export type Rewards = { boosters?: number; cards?: number[] };
// A booster for every REPLAY_WINS wins of story duels already won, REPLAY_BOOSTERS_MAX a day at most (Europe/Paris).
export const REPLAY_WINS = 3;
export const REPLAY_BOOSTERS_MAX = 2;
// `rewards` of a first win, null for a duel already won. `stars` of this win (1: won, 2: at "normal", 3: at "normal" with at
// least half the starting LP left), `best` kept for the duel; `starBooster`: the booster of the first 3 stars of the duel.
// `replays`, for a duel already won: wins of the current series of REPLAY_WINS, the last one gives a booster.
// `replayLimit`: REPLAY_BOOSTERS_MAX replay boosters already earned today, this win does not count.
export type StoryResult = { rewards: Rewards | null; stars: number; best: number; starBooster: boolean; replays?: number; replayLimit?: true };
// A Sealed session ends at SEALED_WINS wins or SEALED_LOSSES losses; SEALED_REWARDS[wins] boosters at its end.
export const SEALED_WINS = 3;
export const SEALED_LOSSES = 2;
export const SEALED_REWARDS = [0, 1, 2, 4];
export type SealedStatus = "building" | "playing" | "done" | "abandoned";
// `pool`: the reserve of the 6 boosters of `set` (`setName`), one printing per copy. `main` and `extra`: the deck, null until validated.
// `boosters`: earned once done.
export type SealedRun = { id: number; set: string; setName: string; pool: Printing[]; main: number[] | null; extra: number[] | null; wins: number; losses: number; status: SealedStatus; boosters: number };
// A Draft session: a Sealed session whose reserve (`pool`) is drafted first, booster `round` of 6, from `pack`.
export type DraftRun = Omit<SealedRun, "status"> & { status: "drafting" | SealedStatus; round: number; pack: Printing[] };

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
