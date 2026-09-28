import type { Seat, ServerMessage, Wire } from "../../server/src/protocol.ts";

export type Action = Wire<ServerMessage> | { type: "connecting" } | { type: "closed" };

export type LobbyState = {
  // undefined until the server has checked the token, null while the player has no pseudo.
  pseudo?: string | null;
  room?: string;
  seat?: Seat;
  // Provisional duel screen: every message received, as JSON.
  journal: string[];
  error?: string;
  closed: boolean;
};

export const initialLobby: LobbyState = { journal: [], closed: false };

const line = (entry: unknown) => JSON.stringify(entry);

export function reduce(state: LobbyState, action: Action): LobbyState {
  switch (action.type) {
    case "connecting":
      return { ...state, pseudo: undefined, error: undefined, closed: false };
    case "closed":
      return { ...state, closed: true };
    case "profile":
      return { ...state, pseudo: action.pseudo, error: undefined };
    case "joined":
      return { ...state, room: action.room, seat: action.seat, journal: action.log.map(line), error: undefined };
    case "messages":
      return { ...state, journal: [...state.journal, ...action.messages.map(line)] };
    case "question":
      return { ...state, journal: [...state.journal, `question : ${line(action.question)}`] };
    case "error":
      return { ...state, error: action.error };
    case "duel_error":
      return { ...state, error: action.error, journal: [...state.journal, `erreur : ${action.error}`] };
  }
}
