import type { OcgMessage, OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { DeckDraft } from "./deckcheck.ts";
import type { EmoteId } from "./emotes.ts";
import type { Printing } from "./pool.ts";

// WebSocket protocol, shared with the client. Payloads are JSON: bigint fields travel as strings.
export type Wire<T> = T extends bigint ? string : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

export type Seat = 0 | 1;

export type BotLevel = "debutant" | "normal" | "expert";
// Story duel difficulty: "facile" doubles the starting LP of the player.
export type StoryLevel = "normal" | "facile";

// `auth` must come first, with the Supabase access token. Joining a room again as the same user resumes the seat.
export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "pseudo"; pseudo: string }
  | { type: "starter"; starter: "yugi" | "kaiba" }
  | { type: "create" }
  // A room against the bot, which takes seat 1. Without `level`, the bot plays at "normal".
  | { type: "bot"; level?: BotLevel }
  | { type: "join"; room: string }
  | { type: "respond"; response: OcgResponse }
  // Gives up the duel in progress: the other seat wins.
  | { type: "surrender" }
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
  // Boosters: `booster_state` is answered with `booster_state`, `open_booster` with `booster_opened` or an error.
  | { type: "booster_state" }
  | { type: "open_booster"; set: string }
  // Accounts listed in ADMIN_USER_IDS only: adds 1 to ADMIN_BOOSTERS_MAX earned boosters, answered with `booster_state`.
  | { type: "admin_boosters"; count: number }
  // Story mode: `story` asks for the arcs and progression, `story_duel` starts a duel against the bot, at "normal" without `level`.
  | { type: "story" }
  | { type: "story_duel"; duel: string; level?: StoryLevel };

export type Deck = { id: number; name: string; main: number[]; extra: number[] };

// Current ATK and DEF of Monster Zones 0-4 of each player, null for an empty zone or a monster the player may not see.
// Not an engine message: the server adds it after the engine messages, like MSG_UPDATE_DATA in EDOPro.
export type StatsEvent = { type: "stats"; monsters: [MonsterStats[], MonsterStats[]] };
export type MonsterStats = { atk: number; def: number } | null;
export type DuelEvent = OcgMessage | StatsEvent;

// `joined` replays every message the player was allowed to see, which rebuilds the board after a reconnection,
// from the starting LP (`lp` for the player, `opponentLp` when the opponent's differs), main deck and extra deck sizes (the engine never sends them).
// `opponent` is the name of the other seat once someone (a player, the bot or a story character) sits there.
// `profile` answers `auth`, `pseudo` and `starter`: a null pseudo means the player has to choose one before playing,
// `needsStarter` means the player has a pseudo but no active deck yet and must pick a starter deck.
export type ServerMessage =
  | { type: "profile"; pseudo: string | null; needsStarter: boolean; admin?: true }
  | { type: "joined"; room: string; seat: Seat; lp: number; opponentLp?: number; decks: [number, number]; extras: [number, number]; opponent?: string; log: DuelEvent[] }
  | { type: "messages"; messages: DuelEvent[] }
  | { type: "question"; question: OcgMessage; retry: boolean }
  // Online duel between two players: ms left before `seat` loses, to answer the engine or to come back after a lost connection.
  // null: that clock stopped. Sent to both players, and again to a player who comes back.
  | { type: "timer"; kind: "answer" | "reconnect"; seat: Seat; ms: number | null }
  | { type: "error"; error: string }
  // An emote of `seat`, sent to both seats.
  | { type: "emote"; seat: Seat; id: EmoteId }
  // Online: `from` asked for a rematch. `rematch_declined`: refused or left, no rematch in this room. A new duel starts with `joined`.
  | { type: "rematch"; from: Seat }
  | { type: "rematch_declined" }
  // Owned cards as [passcode, quantity].
  | { type: "collection"; cards: [number, number][] }
  // `saved` is the deck a `save_deck` just stored.
  | { type: "decks"; decks: Deck[]; active: number | null; saved?: number }
  | { type: "duel_error"; error: string }
  | { type: "booster_state"; nextFreeAt: string; pending: number }
  | { type: "booster_opened"; set: string; cards: Printing[] }
  | { type: "story"; arcs: StoryArcView[] }
  // A won story duel, recorded. `rewards` is null when the duel had already been won.
  | { type: "story_won"; duel: string; outro: string; rewards: Rewards | null };

export type Rewards = { boosters?: number; cards?: number[] };
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
