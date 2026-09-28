import type { OcgMessage, OcgResponse } from "@n1xx1/ocgcore-wasm";

// WebSocket protocol, shared with the client. Payloads are JSON: bigint fields travel as strings.
export type Wire<T> = T extends bigint ? string : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

export type Seat = 0 | 1;

// `auth` must come first, with the Supabase access token. Joining a room again as the same user resumes the seat.
export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "pseudo"; pseudo: string }
  | { type: "create" }
  | { type: "join"; room: string }
  | { type: "respond"; response: OcgResponse };

// `joined` replays every message the player was allowed to see, which rebuilds the board after a reconnection.
// `profile` answers `auth` and `pseudo`: a null pseudo means the player has to choose one before playing.
export type ServerMessage =
  | { type: "profile"; pseudo: string | null }
  | { type: "joined"; room: string; seat: Seat; log: OcgMessage[] }
  | { type: "messages"; messages: OcgMessage[] }
  | { type: "question"; question: OcgMessage; retry: boolean }
  | { type: "error"; error: string }
  | { type: "duel_error"; error: string };
