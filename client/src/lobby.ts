import type { EmoteId } from "../../server/src/emotes.ts";
import type { Seat, ServerMessage, StoryArcView, Wire } from "../../server/src/protocol.ts";
import { newBoard, playAll, type Board, type EngineMessage, type Message } from "./board.ts";

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
export type Asked = { question: EngineMessage; retry: boolean; id: number };
// The time, in ms since the epoch, when `seat` loses the duel.
export type Deadline = { seat: Seat; until: number };

// The last emote of a seat; `n` tells two successive ones apart, even identical ones.
export type ShownEmote = { id: EmoteId; n: number };

export type LobbyState = {
  // undefined until the server has checked the token, null while the player has no pseudo.
  pseudo?: string | null;
  // Has a pseudo but no active deck yet: must pick a starter before playing.
  needsStarter: boolean;
  // Account listed in the server's ADMIN_USER_IDS: sees the admin commands.
  admin?: boolean;
  room?: string;
  seat?: Seat;
  // Name of the other seat, once known.
  opponent?: string;
  board?: Board;
  // Starting LP of the duel, and the last batch of engine messages: the duel screen animates them (id tells batches apart).
  lp?: number;
  feed?: { id: number; messages: Message[] };
  // The duel has sent its first message.
  started: boolean;
  question?: Asked;
  asked: number;
  // Online duel between two players: when the seat asked loses unless they answer, and when a disconnected seat loses.
  answerBy?: Deadline;
  away?: Deadline;
  // Last emote of each seat.
  emotes: Partial<Record<Seat, ShownEmote>>;
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

export const initialLobby: LobbyState = { started: false, asked: 0, emotes: {}, closed: false, needsStarter: false, openedCount: 0, storyOpen: false };

export function reduce(state: LobbyState, action: Action): LobbyState {
  switch (action.type) {
    case "connecting":
      return { ...state, pseudo: undefined, error: undefined, closed: false };
    case "closed":
      return { ...state, closed: true };
    case "left":
      return { ...state, room: undefined, seat: undefined, board: undefined, started: false, question: undefined, error: undefined, won: undefined, answerBy: undefined, away: undefined, emotes: {} };
    case "profile":
      return { ...state, pseudo: action.pseudo, needsStarter: action.needsStarter, admin: action.admin, error: undefined };
    case "joined":
      return {
        ...state,
        room: action.room,
        seat: action.seat,
        opponent: action.opponent,
        lp: action.lp,
        board: playAll(newBoard(action.lp, action.decks, action.extras), action.log),
        started: action.log.length > 0,
        question: undefined,
        error: undefined,
        answerBy: undefined,
        away: undefined,
        emotes: {},
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
    case "timer": {
      const deadline = action.ms === null ? undefined : { seat: action.seat, until: Date.now() + action.ms };
      return action.kind === "answer" ? { ...state, answerBy: deadline } : { ...state, away: deadline };
    }
    case "emote":
      return { ...state, emotes: { ...state.emotes, [action.seat]: { id: action.id, n: (state.emotes[action.seat]?.n ?? 0) + 1 } } };
    case "answered":
      return { ...state, question: undefined };
    case "collection":
      return { ...state, collection: action.cards };
    case "decks":
      return { ...state, decks: action, error: undefined };
    case "error":
      return { ...state, error: action.error };
    case "duel_error":
      return { ...state, error: action.error, question: undefined, answerBy: undefined, away: undefined };
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

// "1:05" left before `until`, never below 0:00.
export function minutes(until: number, now: number): string {
  const totalSeconds = Math.max(0, Math.ceil((until - now) / 1000));
  return `${Math.floor(totalSeconds / 60)}:${pad(totalSeconds % 60)}`;
}

// "" once the free booster is due, else a HH:MM:SS countdown.
export function countdown(nextFreeAt: string, now: number): string {
  const remaining = Math.max(0, new Date(nextFreeAt).getTime() - now);
  if (remaining === 0) return "";
  const totalSeconds = Math.floor(remaining / 1000);
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;
}

// Same alphabet as the server's room codes.
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{5}$/;

// The room code carried by an invitation link (?salle=ABCDE), if valid.
export function roomFromUrl(href: string): string | undefined {
  const code = new URL(href).searchParams.get("salle")?.trim().toUpperCase() ?? "";
  return ROOM_CODE.test(code) ? code : undefined;
}

export const inviteLink = (origin: string, room: string) => `${origin}/?salle=${room}`;
