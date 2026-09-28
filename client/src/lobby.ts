import type { Seat, ServerMessage, StoryArcView, Wire } from "../../server/src/protocol.ts";
import { newBoard, playAll, type Board, type Message } from "./board.ts";

export type Action =
  | Wire<ServerMessage>
  | { type: "connecting" }
  | { type: "closed" }
  | { type: "answered" }
  | { type: "left" }
  | { type: "story_menu"; open: boolean };
export type StoryWon = Extract<ServerMessage, { type: "story_won" }>;

// `id` tells two successive questions apart, even identical ones.
export type Asked = { question: Message; retry: boolean; id: number };

export type LobbyState = {
  // undefined until the server has checked the token, null while the player has no pseudo.
  pseudo?: string | null;
  room?: string;
  seat?: Seat;
  board?: Board;
  // The duel has sent its first message.
  started: boolean;
  question?: Asked;
  asked: number;
  error?: string;
  closed: boolean;
  // Story mode screen, kept open across its duels.
  storyOpen: boolean;
  story?: StoryArcView[];
  won?: StoryWon;
};

export const initialLobby: LobbyState = { started: false, asked: 0, closed: false, storyOpen: false };

export function reduce(state: LobbyState, action: Action): LobbyState {
  switch (action.type) {
    case "connecting":
      return { ...state, pseudo: undefined, error: undefined, closed: false };
    case "closed":
      return { ...state, closed: true };
    case "left":
      return { ...state, room: undefined, seat: undefined, board: undefined, started: false, question: undefined, error: undefined, won: undefined };
    case "profile":
      return { ...state, pseudo: action.pseudo, error: undefined };
    case "joined":
      return {
        ...state,
        room: action.room,
        seat: action.seat,
        board: playAll(newBoard(action.lp, action.decks), action.log),
        started: action.log.length > 0,
        question: undefined,
        error: undefined,
      };
    case "messages":
      return { ...state, board: state.board && playAll(state.board, action.messages), started: true };
    case "question":
      return { ...state, question: { question: action.question, retry: action.retry, id: state.asked + 1 }, asked: state.asked + 1 };
    case "answered":
      return { ...state, question: undefined };
    case "error":
      return { ...state, error: action.error };
    case "duel_error":
      return { ...state, error: action.error, question: undefined };
    case "story_menu":
      return { ...state, storyOpen: action.open, error: undefined };
    case "story":
      return { ...state, story: action.arcs };
    case "story_won":
      return { ...state, won: action };
  }
}
