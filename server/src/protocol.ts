import type { OcgMessage, OcgResponse } from "@n1xx1/ocgcore-wasm";

// WebSocket protocol, shared with the client. Payloads are JSON: bigint fields travel as strings.
export type Wire<T> = T extends bigint ? string : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

export type Seat = 0 | 1;

// `player` is a provisional identity chosen by the client; joining again with it resumes the seat.
export type ClientMessage =
  | { type: "create"; player: string }
  | { type: "join"; room: string; player: string }
  | { type: "respond"; response: OcgResponse };

// `joined` replays every message the player was allowed to see, which rebuilds the board after a reconnection.
export type ServerMessage =
  | { type: "joined"; room: string; seat: Seat; log: OcgMessage[] }
  | { type: "messages"; messages: OcgMessage[] }
  | { type: "question"; question: OcgMessage; retry: boolean }
  | { type: "error"; error: string }
  | { type: "duel_error"; error: string };
