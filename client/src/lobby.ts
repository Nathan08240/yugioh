import type { EmoteId } from "../../server/src/emotes.ts";
import type { DeckResult, PuzzleView, SealedRun, Seat, ServerMessage, StoryArcView, TowerView, Wire } from "../../server/src/protocol.ts";
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
export type Wonder = Extract<Wire<ServerMessage>, { type: "wonder" }>;
export type PuzzleWon = Extract<ServerMessage, { type: "puzzle_won" }>;
export type TowerWon = Extract<ServerMessage, { type: "tower_won" }>;

// `id` tells two successive questions apart, even identical ones.
// `announce`: the cards the player may declare, for ANNOUNCE_CARD.
export type Asked = { question: EngineMessage; retry: boolean; id: number; announce?: readonly number[] };
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
  // This connection earned the daily booster, announced on the home screen.
  daily?: boolean;
  room?: string;
  seat?: Seat;
  // Name of the other seat, once known, and the avatar of a human opponent.
  opponent?: string;
  opponentAvatar?: number;
  board?: Board;
  // Starting LP of the player and of the opponent, and the last batch of engine messages: the duel screen animates them (id tells batches apart).
  lp?: number;
  opponentLp?: number;
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
  // Copies of known rarity as [passcode, rarity, quantity].
  rarities?: [number, string, number][];
  // Collection points, and the last conversion preview: cleared by the next collection, which follows a conversion.
  points?: number;
  conversion?: Extract<ServerMessage, { type: "conversion" }>;
  decks?: DeckList;
  // Wins and losses per deck and mode, loaded with the decks.
  results?: DeckResult[];
  // Avatar and favorite card of the player (passcodes), loaded with the lobby and by the profile screen.
  profile?: { avatar: number | null; favorite: number | null };
  // Wished passcodes, loaded by the collection and boosters screens.
  wishlist?: number[];
  // Booster timer, pending count and openings left before a sure Ultra Rare, loaded by the boosters screen.
  boosters?: { nextFreeAt: string; pending: number; ultraIn: number };
  // The cards of the last booster opened, and a counter so a new opening resets the reveal animation.
  opened?: { set: string; cards: { code: number; rarity: string }[] };
  openedCount: number;
  // Wonder pick of the day, loaded by the boosters screen.
  wonder?: Wonder;
  // Story mode screen, kept open across its duels.
  storyOpen: boolean;
  story?: StoryArcView[];
  won?: StoryWon;
  // Puzzles and their progression, and the last success the server recorded.
  puzzles?: PuzzleView[];
  solved?: PuzzleWon;
  // Tower mode: the floors and progression, the floor of the duel in progress, its win once recorded.
  tower?: TowerView;
  floor?: number;
  towerWon?: TowerWon;
  // Online rematch: the seat that asked, or declined for good.
  rematch?: { from: Seat } | "declined";
  // Bug reports the server has stored.
  reported: number;
  // Special rules of the room (an event room), the event of the week, and its booster just earned in this duel.
  special?: string[];
  event?: Extract<Wire<ServerMessage>, { type: "event" }>;
  eventWon?: boolean;
  // Latest Sealed session, null before the first one, loaded by the Sealed screen.
  sealed?: SealedRun | null;
};

export const initialLobby: LobbyState = { started: false, asked: 0, emotes: {}, closed: false, needsStarter: false, openedCount: 0, storyOpen: false, reported: 0 };

export function reduce(state: LobbyState, action: Action): LobbyState {
  switch (action.type) {
    case "connecting":
      return { ...state, pseudo: undefined, error: undefined, closed: false };
    case "closed":
      return { ...state, closed: true };
    case "left":
      return { ...state, room: undefined, seat: undefined, board: undefined, started: false, question: undefined, error: undefined, won: undefined, solved: undefined, floor: undefined, towerWon: undefined, rematch: undefined, answerBy: undefined, away: undefined, emotes: {}, special: undefined, eventWon: undefined };
    case "profile":
      return { ...state, pseudo: action.pseudo, needsStarter: action.needsStarter, admin: action.admin, daily: action.daily || state.daily, error: undefined };
    case "joined":
      return {
        ...state,
        room: action.room,
        seat: action.seat,
        opponent: action.opponent,
        opponentAvatar: action.opponentAvatar,
        special: action.special,
        floor: action.floor,
        lp: action.lp,
        opponentLp: action.opponentLp,
        board: playAll(newBoard(action.seat === 0 ? [action.lp, action.opponentLp ?? action.lp] : [action.opponentLp ?? action.lp, action.lp], action.decks, action.extras), action.log),
        started: action.log.length > 0,
        question: undefined,
        error: undefined,
        answerBy: undefined,
        away: undefined,
        emotes: {},
        // An empty log is a new duel (the first, or a rematch): a reconnection replays the old one.
        won: action.log.length === 0 ? undefined : state.won,
        solved: action.log.length === 0 ? undefined : state.solved,
        towerWon: action.log.length === 0 ? undefined : state.towerWon,
        rematch: action.log.length === 0 ? undefined : state.rematch,
        eventWon: action.log.length === 0 ? undefined : state.eventWon,
      };
    case "messages":
      return {
        ...state,
        board: state.board && playAll(state.board, action.messages),
        feed: { id: (state.feed?.id ?? 0) + 1, messages: action.messages },
        started: true,
      };
    case "question":
      return { ...state, question: { question: action.question, retry: action.retry, id: state.asked + 1, announce: action.announce }, asked: state.asked + 1 };
    case "timer": {
      const deadline = action.ms === null ? undefined : { seat: action.seat, until: Date.now() + action.ms };
      return action.kind === "answer" ? { ...state, answerBy: deadline } : { ...state, away: deadline };
    }
    case "emote":
      return { ...state, emotes: { ...state.emotes, [action.seat]: { id: action.id, n: (state.emotes[action.seat]?.n ?? 0) + 1 } } };
    case "answered":
      return { ...state, question: undefined };
    case "collection":
      return { ...state, collection: action.cards, rarities: action.rarities, points: action.points, conversion: undefined };
    case "conversion":
      return { ...state, conversion: action };
    case "decks":
      return { ...state, decks: action, error: undefined };
    case "duel_results":
      return { ...state, results: action.results };
    case "player_profile":
      return { ...state, profile: { avatar: action.avatar, favorite: action.favorite }, error: undefined };
    case "wishlist":
      return { ...state, wishlist: action.cards, error: undefined };
    case "error":
      return { ...state, error: action.error };
    case "duel_error":
      return { ...state, error: action.error, question: undefined, answerBy: undefined, away: undefined };
    case "booster_state":
      return { ...state, boosters: { nextFreeAt: action.nextFreeAt, pending: action.pending, ultraIn: action.ultraIn } };
    case "booster_opened":
      return { ...state, opened: { set: action.set, cards: action.cards }, openedCount: state.openedCount + 1 };
    case "wonder":
      return { ...state, wonder: action, error: undefined };
    case "event":
      return { ...state, event: action };
    case "event_won":
      return { ...state, eventWon: true, event: state.event && { ...state.event, won: true } };
    case "story_menu":
      return { ...state, storyOpen: action.open, error: undefined };
    case "story":
      return { ...state, story: action.arcs };
    case "story_won":
      return { ...state, won: action };
    case "puzzles":
      return { ...state, puzzles: action.puzzles };
    case "puzzle_won":
      return { ...state, solved: action };
    case "tower":
      return { ...state, tower: { floors: action.floors, floor: action.floor, best: action.best, claimed: action.claimed } };
    case "tower_won":
      return { ...state, towerWon: action };
    case "rematch":
      return { ...state, rematch: { from: action.from } };
    case "rematch_declined":
      return { ...state, rematch: "declined" };
    case "report_sent":
      return { ...state, reported: state.reported + 1 };
    case "sealed":
      return { ...state, sealed: action.run, error: undefined };
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
