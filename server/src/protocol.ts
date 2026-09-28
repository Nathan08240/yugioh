import type { OcgMessage, OcgResponse } from "@n1xx1/ocgcore-wasm";
import type { DeckDraft } from "./deckcheck.ts";
import type { Printing } from "./pool.ts";

// WebSocket protocol, shared with the client. Payloads are JSON: bigint fields travel as strings.
export type Wire<T> = T extends bigint ? string : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

export type Seat = 0 | 1;

// `auth` must come first, with the Supabase access token. Joining a room again as the same user resumes the seat.
export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "pseudo"; pseudo: string }
  | { type: "starter"; starter: "yugi" | "kaiba" }
  | { type: "create" }
  // A room against the bot, which takes seat 1.
  | { type: "bot" }
  | { type: "join"; room: string }
  | { type: "respond"; response: OcgResponse }
  // Collection and decks: each deck message is answered with `decks`. `save_deck` creates a deck without `id`.
  | { type: "collection" }
  | { type: "decks" }
  | { type: "save_deck"; deck: DeckDraft }
  | { type: "delete_deck"; id: number }
  | { type: "active_deck"; id: number }
  // Boosters: `booster_state` is answered with `booster_state`, `open_booster` with `booster_opened` or an error.
  | { type: "booster_state" }
  | { type: "open_booster"; set: string }
  // Story mode: `story` asks for the arcs and progression, `story_duel` starts a duel against the bot.
  | { type: "story" }
  | { type: "story_duel"; duel: string };

export type Deck = { id: number; name: string; main: number[]; extra: number[] };

// `joined` replays every message the player was allowed to see, which rebuilds the board after a reconnection,
// from the starting LP and main deck sizes (the engine never sends them).
// `profile` answers `auth`, `pseudo` and `starter`: a null pseudo means the player has to choose one before playing,
// `needsStarter` means the player has a pseudo but no active deck yet and must pick a starter deck.
export type ServerMessage =
  | { type: "profile"; pseudo: string | null; needsStarter: boolean }
  | { type: "joined"; room: string; seat: Seat; lp: number; decks: [number, number]; log: OcgMessage[] }
  | { type: "messages"; messages: OcgMessage[] }
  | { type: "question"; question: OcgMessage; retry: boolean }
  | { type: "error"; error: string }
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

// GET /api/cards: every card of the pool by passcode, from BabelCDB. `strings` are the effect descriptions (str1 to str16).
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
  // GET /api/images/<code>.jpg exists.
  image: boolean;
};
