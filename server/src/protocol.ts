import type { OcgMessage, OcgResponse } from "@n1xx1/ocgcore-wasm";

// WebSocket protocol, shared with the client. Payloads are JSON: bigint fields travel as strings.
export type Wire<T> = T extends bigint ? string : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

export type Seat = 0 | 1;

// `auth` must come first, with the Supabase access token. Joining a room again as the same user resumes the seat.
export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "pseudo"; pseudo: string }
  | { type: "create" }
  // A room against the bot, which takes seat 1.
  | { type: "bot" }
  | { type: "join"; room: string }
  | { type: "respond"; response: OcgResponse }
  // Story mode: `story` asks for the arcs and progression, `story_duel` starts a duel against the bot.
  | { type: "story" }
  | { type: "story_duel"; duel: string };

// `joined` replays every message the player was allowed to see, which rebuilds the board after a reconnection,
// from the starting LP and main deck sizes (the engine never sends them).
// `profile` answers `auth` and `pseudo`: a null pseudo means the player has to choose one before playing.
export type ServerMessage =
  | { type: "profile"; pseudo: string | null }
  | { type: "joined"; room: string; seat: Seat; lp: number; decks: [number, number]; log: OcgMessage[] }
  | { type: "messages"; messages: OcgMessage[] }
  | { type: "question"; question: OcgMessage; retry: boolean }
  | { type: "error"; error: string }
  | { type: "duel_error"; error: string }
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
