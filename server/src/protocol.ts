import type { OcgMessage, OcgResponse } from "@n1xx1/ocgcore-wasm";

// WebSocket protocol, shared with the client. Payloads are JSON: bigint fields travel as strings.
export type Wire<T> = T extends bigint ? string : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

export type Seat = 0 | 1;

// `auth` must come first, with the Supabase access token. Joining a room again as the same user resumes the seat.
export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "pseudo"; pseudo: string }
  | { type: "starter"; starter: "yugi" | "kaiba" }
  | { type: "create" }
  | { type: "join"; room: string }
  | { type: "respond"; response: OcgResponse };

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
  | { type: "duel_error"; error: string };

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
