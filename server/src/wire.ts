import type { WebSocket } from "ws";
import { validAdminMessage } from "./admin.ts";
import { validDeckMessage } from "./collection.ts";
import { validRoomOptions } from "./custom.ts";
import { validDraftMessage } from "./draft.ts";
import { validEconomyMessage } from "./economy.ts";
import { EMOTE_IDS } from "./emotes.ts";
import { validFriendMessage } from "./friends.ts";
import { validProfileMessage } from "./profile.ts";
import type { BotLevel, ClientMessage, ServerMessage, StoryLevel } from "./protocol.ts";
import { validPublicDeckMessage } from "./public-decks.ts";
import { validSealedMessage } from "./sealed.ts";
import { validTradeMessage } from "./trade.ts";
import { validWishMessage } from "./wishlist.ts";
import { validWonderMessage } from "./wonder.ts";

const serialize = (data: ServerMessage) => JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value));

export function send(socket: WebSocket | undefined, data: ServerMessage) {
  socket?.send(serialize(data));
}

// The same message to several sockets, serialized once.
export function sendEach(sockets: readonly (WebSocket | undefined)[], data: ServerMessage) {
  const open = sockets.filter((socket) => socket !== undefined);
  if (open.length === 0) return;
  const text = serialize(data);
  for (const socket of open) socket.send(text);
}

export const ADMIN_BOOSTERS_MAX = 50;

const BOT_LEVELS = new Set<unknown>(["debutant", "normal", "expert"] satisfies BotLevel[]);
const STORY_LEVELS = new Set<unknown>(["normal", "facile"] satisfies StoryLevel[]);

const isOptionalFlag = (value: unknown) => value === undefined || typeof value === "boolean";

type Check = (msg: Record<string, unknown>) => boolean;
const always: Check = () => true;
const unknownType: Check = () => false;
const hasString = (key: string): Check => (msg) => typeof msg[key] === "string";

// The fields of each message checked here, by type; the other modules check theirs.
const CHECKS: ReadonlyMap<unknown, Check> = new Map<ClientMessage["type"], Check>([
  ["auth", (msg) => typeof msg.token === "string" && msg.token.length <= 4096],
  ["pseudo", hasString("pseudo")],
  ["starter", (msg) => msg.starter === "yugi" || msg.starter === "kaiba"],
  ["create", (msg) => isOptionalFlag(msg.event) && (msg.options === undefined || (msg.event !== true && validRoomOptions(msg.options)))],
  ["room_rules", hasString("room")],
  ["bot", (msg) => (msg.level === undefined || BOT_LEVELS.has(msg.level)) && isOptionalFlag(msg.event)],
  ["story", always],
  ["duel_results", always],
  ["event", always],
  ["puzzles", always],
  ["puzzle", hasString("id")],
  ["tutorial", always],
  ["lessons", always],
  ["lesson", hasString("id")],
  ["tower", always],
  ["tower_duel", always],
  ["missions", always],
  ["ranked", always],
  ["ranked_queue", always],
  ["ranked_cancel", always],
  ["quick_queue", always],
  ["quick_cancel", always],
  ["story_duel", (msg) => typeof msg.duel === "string" && (msg.level === undefined || STORY_LEVELS.has(msg.level)) && (msg.revenge === undefined || msg.revenge === true)],
  ["emote", (msg) => EMOTE_IDS.has(msg.id)],
  ["join", hasString("room")],
  ["spectate", hasString("room")],
  ["respond", (msg) => typeof msg.response === "object" && msg.response !== null],
  ["surrender", always],
  ["replays", always],
  ["replay", (msg) => Number.isSafeInteger(msg.id)],
  ["report", (msg) => msg.message === undefined || typeof msg.message === "string"],
  ["rematch", (msg) => isOptionalFlag(msg.accept)],
  ["booster_state", always],
  ["open_booster", hasString("set")],
  ["admin_boosters", (msg) => typeof msg.count === "number" && Number.isInteger(msg.count) && msg.count >= 1 && msg.count <= ADMIN_BOOSTERS_MAX],
]);

export function parse(data: string): ClientMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const msg = parsed as Record<string, unknown>;
  const valid =
    (CHECKS.get(msg.type) ?? unknownType)(msg) ||
    validDeckMessage(msg) ||
    validWonderMessage(msg) ||
    validWishMessage(msg) ||
    validEconomyMessage(msg) ||
    validProfileMessage(msg) ||
    validSealedMessage(msg) ||
    validDraftMessage(msg) ||
    validFriendMessage(msg) ||
    validTradeMessage(msg) ||
    validAdminMessage(msg) ||
    validPublicDeckMessage(msg);
  return valid ? (msg as ClientMessage) : undefined;
}
