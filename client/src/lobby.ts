import type { Seat, ServerMessage, StoryArcView, Wire } from "../../server/src/protocol.ts";
import { newBoard, playAll, type Board, type Message } from "./board.ts";

export type DeckList = Extract<Wire<ServerMessage>, { type: "decks" }>;

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
  // Has a pseudo but no active deck yet: must pick a starter before playing.
  needsStarter: boolean;
  room?: string;
  seat?: Seat;
  board?: Board;
  // Starting LP of the duel, and the last batch of engine messages: the duel screen animates them (id tells batches apart).
  lp?: number;
  feed?: { id: number; messages: Message[] };
  // The duel has sent its first message.
  started: boolean;
  question?: Asked;
  asked: number;
  error?: string;
  closed: boolean;
  // Owned cards as [passcode, quantity] and the player's decks, loaded by the collection screen.
  collection?: [number, number][];
  decks?: DeckList;
  // Booster timer and pending count, loaded by the boosters screen.
  boosters?: { nextFreeAt: string; pending: number };
  // The cards of the last booster opened, and a counter so a new opening resets the reveal animation.
  opened?: { set: string; cards: { code: number; rarity: string }[] };
  openedCount: number;
  // Story mode screen, kept open across its duels.
  storyOpen: boolean;
  story?: StoryArcView[];
  won?: StoryWon;
};

export const initialLobby: LobbyState = { started: false, asked: 0, closed: false, needsStarter: false, openedCount: 0, storyOpen: false };

export function reduce(state: LobbyState, action: Action): LobbyState {
  switch (action.type) {
    case "connecting":
      return { ...state, pseudo: undefined, error: undefined, closed: false };
    case "closed":
      return { ...state, closed: true };
    case "left":
      return { ...state, room: undefined, seat: undefined, board: undefined, started: false, question: undefined, error: undefined, won: undefined };
    case "profile":
      return { ...state, pseudo: action.pseudo, needsStarter: action.needsStarter, error: undefined };
    case "joined":
      return {
        ...state,
        room: action.room,
        seat: action.seat,
        lp: action.lp,
        board: playAll(newBoard(action.lp, action.decks, action.extras), action.log),
        started: action.log.length > 0,
        question: undefined,
        error: undefined,
      };
    case "messages":
      return {
        ...state,
        board: state.board && playAll(state.board, action.messages),
        feed: { id: (state.feed?.id ?? 0) + 1, messages: action.messages },
        started: true,
      };
    case "question":
      return { ...state, question: { question: action.question, retry: action.retry, id: state.asked + 1 }, asked: state.asked + 1 };
    case "answered":
      return { ...state, question: undefined };
    case "collection":
      return { ...state, collection: action.cards };
    case "decks":
      return { ...state, decks: action, error: undefined };
    case "error":
      return { ...state, error: action.error };
    case "duel_error":
      return { ...state, error: action.error, question: undefined };
    case "booster_state":
      return { ...state, boosters: { nextFreeAt: action.nextFreeAt, pending: action.pending } };
    case "booster_opened":
      return { ...state, opened: { set: action.set, cards: action.cards }, openedCount: state.openedCount + 1 };
    case "story_menu":
      return { ...state, storyOpen: action.open, error: undefined };
    case "story":
      return { ...state, story: action.arcs };
    case "story_won":
      return { ...state, won: action };
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

// "" once the free booster is due, else a HH:MM:SS countdown.
export function countdown(nextFreeAt: string, now: number): string {
  const remaining = Math.max(0, new Date(nextFreeAt).getTime() - now);
  if (remaining === 0) return "";
  const totalSeconds = Math.floor(remaining / 1000);
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;
}
