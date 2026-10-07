import type { EmoteId } from "../../server/src/emotes.ts";
import type { ClientMessage, DeckResult, DraftRun, Friend, PuzzleView, RankedView, ReplaySummary, RoomOptions, SealedRun, Seat, ServerMessage, StoryArcView, TowerView, Wire } from "../../server/src/protocol.ts";
import { newBoard, playAll, type Board, type EngineMessage, type Message } from "./board.ts";

export type DeckList = Extract<Wire<ServerMessage>, { type: "decks" }>;
export type ReplayView = Extract<Wire<ServerMessage>, { type: "replay" }>;

export type Action =
  | Wire<ServerMessage>
  | { type: "connecting" }
  | { type: "closed" }
  | { type: "answered" }
  | { type: "left" }
  | { type: "story_menu"; open: boolean }
  | { type: "preview_close" }
  | { type: "replay_closed" };
export type StoryWon = Extract<ServerMessage, { type: "story_won" }>;
export type Wonder = Extract<Wire<ServerMessage>, { type: "wonder" }>;
export type PuzzleWon = Extract<ServerMessage, { type: "puzzle_won" }>;
export type TowerWon = Extract<ServerMessage, { type: "tower_won" }>;

// `id` tells two successive questions apart, even identical ones.
// `announce`: the cards the player may declare, for ANNOUNCE_CARD. `announceDeck`: those of their own deck.
export type Asked = { question: EngineMessage; retry: boolean; id: number; announce?: readonly number[]; announceDeck?: readonly number[] };
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
  // The player watches the duel from outside: name and avatar of seat 0, the point of view. `spectators`: how many watch the room.
  spectating?: { name?: string; avatar?: number };
  spectators: number;
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
  boosters?: { nextFreeAt: string; pending: number; ultraIn: number; online: number };
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
  // Custom rules of a private room, and those of a room the player is about to join (asked with room_rules).
  options?: RoomOptions;
  preview?: { room: string; options: RoomOptions };
  event?: Extract<Wire<ServerMessage>, { type: "event" }>;
  eventWon?: boolean;
  // Whether the online win of this duel earned its booster, false once the day is full.
  onlineEarned?: boolean;
  // Latest Sealed session, null before the first one, loaded by the Sealed screen.
  sealed?: SealedRun | null;
  // Latest Draft session, likewise.
  draft?: DraftRun | null;
  // Friends and requests, loaded by the friends screen and kept up to date by the server.
  friends?: Friend[];
  // Challenges received, shown on every screen until answered or `until` (ms since the epoch).
  challenges: { from: string; until: number; options?: RoomOptions }[];
  // Last friend notice; `n` tells two successive ones apart.
  notice?: { text: string; n: number };
  // Trade offers, loaded by the friends screen and kept up to date by the server; the cards to trade with the friend last asked for.
  trades?: Extract<Wire<ServerMessage>, { type: "trades" }>;
  tradeCards?: Extract<Wire<ServerMessage>, { type: "trade_cards" }>;
  // Ranked mode: rating, season and leaderboards, loaded by its screen; when the search for an opponent started (ms since the
  // epoch), and the rating change of the last ranked duel.
  ranked?: RankedView;
  rankedSince?: number;
  rankedResult?: { delta: number; rating: number };
  // The server stops for an update: no new duel until the next one runs.
  maintenance?: boolean;
  // Connecting again to the room on screen: an error instead of `joined` means the room is gone.
  rejoining?: boolean;
  // Missions of the day and achievements, loaded by the home and profile screens, sent again after each duel or booster.
  missions?: Omit<Extract<Wire<ServerMessage>, { type: "missions" }>, "type">;
  // The last finished duels of the player, loaded by the profile screen, and the one being watched again.
  replays?: ReplaySummary[];
  replay?: ReplayView;
};

export const ROOM_GONE = "Ce duel n'est plus disponible : le serveur a été mis à jour ou la salle a expiré.";

export const initialLobby: LobbyState = { started: false, spectators: 0, asked: 0, emotes: {}, closed: false, needsStarter: false, openedCount: 0, storyOpen: false, reported: 0, challenges: [] };

export function reduce(state: LobbyState, action: Action): LobbyState {
  switch (action.type) {
    case "connecting":
      return { ...state, pseudo: undefined, error: undefined, closed: false, rankedSince: undefined, maintenance: undefined, rejoining: state.room !== undefined };
    case "closed":
      return { ...state, closed: true };
    case "left":
      return { ...state, room: undefined, seat: undefined, board: undefined, started: false, question: undefined, error: undefined, won: undefined, rankedResult: undefined, solved: undefined, floor: undefined, towerWon: undefined, rematch: undefined, answerBy: undefined, away: undefined, emotes: {}, spectating: undefined, spectators: 0, special: undefined, options: undefined, preview: undefined, eventWon: undefined, onlineEarned: undefined };
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
        options: action.options,
        preview: undefined,
        floor: action.floor,
        spectating: action.spectating,
        lp: action.lp,
        opponentLp: action.opponentLp,
        board: playAll(newBoard(action.seat === 0 ? [action.lp, action.opponentLp ?? action.lp] : [action.opponentLp ?? action.lp, action.lp], action.decks, action.extras), action.log),
        started: action.log.length > 0 || action.spectating !== undefined,
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
        onlineEarned: action.log.length === 0 ? undefined : state.onlineEarned,
        rankedResult: action.log.length === 0 ? undefined : state.rankedResult,
        rankedSince: undefined,
        rejoining: undefined,
        replay: undefined,
      };
    case "messages":
      return {
        ...state,
        board: state.board && playAll(state.board, action.messages),
        feed: { id: (state.feed?.id ?? 0) + 1, messages: action.messages },
        started: true,
      };
    case "question":
      return { ...state, question: { question: action.question, retry: action.retry, id: state.asked + 1, announce: action.announce, announceDeck: action.announceDeck }, asked: state.asked + 1 };
    case "timer": {
      const deadline = action.ms === null ? undefined : { seat: action.seat, until: Date.now() + action.ms };
      return action.kind === "answer" ? { ...state, answerBy: deadline } : { ...state, away: deadline };
    }
    case "emote":
      return { ...state, emotes: { ...state.emotes, [action.seat]: { id: action.id, n: (state.emotes[action.seat]?.n ?? 0) + 1 } } };
    case "spectators":
      return { ...state, spectators: action.count };
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
      // The room is gone (a new server after an update, or expired): back to the menus rather than a frozen duel.
      if (state.rejoining) return { ...reduce(state, { type: "left" }), rejoining: undefined, error: ROOM_GONE, preview: undefined };
      return { ...state, error: action.error, preview: undefined };
    case "maintenance":
      return { ...state, maintenance: true };
    case "duel_error":
      return { ...state, error: action.error, question: undefined, answerBy: undefined, away: undefined };
    case "booster_state":
      return { ...state, boosters: { nextFreeAt: action.nextFreeAt, pending: action.pending, ultraIn: action.ultraIn, online: action.online } };
    case "online_won":
      return { ...state, onlineEarned: action.earned };
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
    case "draft":
      return { ...state, draft: action.run, error: undefined };
    case "friends":
      return { ...state, friends: action.friends, error: undefined };
    case "friend_status":
      return { ...state, friends: state.friends?.map((friend) => (friend.pseudo === action.pseudo ? { ...friend, status: action.status, watch: action.watch } : friend)) };
    case "friend_notice":
      return { ...state, notice: { text: action.text, n: (state.notice?.n ?? 0) + 1 } };
    case "room_rules":
      return { ...state, preview: action.options && { room: action.room, options: action.options } };
    case "preview_close":
      return { ...state, preview: undefined };
    case "challenged":
      return { ...state, challenges: [...state.challenges.filter((challenge) => challenge.from !== action.from), { from: action.from, until: Date.now() + action.ms, options: action.options }] };
    case "challenge_gone":
      return { ...state, challenges: state.challenges.filter((challenge) => challenge.from !== action.from) };
    case "trades":
      return { ...state, trades: action, error: undefined };
    case "trade_cards":
      return { ...state, tradeCards: action };
    case "ranked":
      return { ...state, ranked: action };
    case "ranked_queue":
      return { ...state, rankedSince: action.waiting ? Date.now() : undefined, error: undefined };
    case "ranked_result":
      return { ...state, rankedResult: { delta: action.delta, rating: action.rating } };
    case "missions":
      return { ...state, missions: { missions: action.missions, achievements: action.achievements } };
    case "replays":
      return { ...state, replays: action.replays };
    case "replay":
      return { ...state, replay: action, error: undefined };
    case "replay_closed":
      return { ...state, replay: undefined };
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

function codeFromUrl(href: string, param: string): string | undefined {
  const code = new URL(href).searchParams.get(param)?.trim().toUpperCase() ?? "";
  return ROOM_CODE.test(code) ? code : undefined;
}

// The room code carried by an invitation link (?salle=ABCDE), if valid.
export const roomFromUrl = (href: string) => codeFromUrl(href, "salle");

// What a link opens: the room to play in (?salle=ABCDE) or the duel to watch (?regarder=ABCDE).
export function inviteFromUrl(href: string): Extract<ClientMessage, { type: "join" | "spectate" }> | undefined {
  const room = roomFromUrl(href);
  if (room) return { type: "join", room };
  const watched = codeFromUrl(href, "regarder");
  return watched ? { type: "spectate", room: watched } : undefined;
}

export const inviteLink = (origin: string, room: string) => `${origin}/?salle=${room}`;

// "Battle City · Duel 4 sur 5", for the briefing and the end of the duel.
export function duelLabel(arcs: StoryArcView[] | undefined, id: string | undefined): string | undefined {
  for (const arc of arcs ?? []) {
    const index = arc.duels.findIndex((duel) => duel.id === id);
    if (index >= 0) return `${arc.title} · Duel ${index + 1} sur ${arc.duels.length}`;
  }
  return undefined;
}

const findDuel = (arcs: StoryArcView[] | undefined, id: string | undefined) => arcs?.flatMap((arc) => arc.duels).find((duel) => duel.id === id);

// The special rules of a story duel, for the duel screen and its end.
export const duelSpecial = (arcs: StoryArcView[] | undefined, id: string | undefined): string[] => findDuel(arcs, id)?.special ?? [];

// The starting LP of a story duel as written, for the stars of its end.
export const duelLp = (arcs: StoryArcView[] | undefined, id: string | undefined) => findDuel(arcs, id)?.lp;
