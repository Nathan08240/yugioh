import type { Rules } from "./duel.ts";
import { ROOM_HANDS, ROOM_LPS, ROOM_RULES, type RoomOptions } from "./protocol.ts";
import { EXTRA_RULES } from "./story.ts";

// Where the Goat list holds the decks of a custom room, as limitError words it.
export const ROOM_LIMITS = "dans cette salle";

const LPS: ReadonlySet<unknown> = new Set(ROOM_LPS);
const HANDS: ReadonlySet<unknown> = new Set(ROOM_HANDS);
const RULES: ReadonlySet<unknown> = new Set(ROOM_RULES);

// Room options from the wire: only the four known fields, each from its closed list.
export function validRoomOptions(value: unknown): value is RoomOptions {
  if (typeof value !== "object" || value === null) return false;
  const { lp, hand, goat, rule, ...rest } = value as Record<string, unknown>;
  return Object.keys(rest).length === 0 && LPS.has(lp) && HANDS.has(hand) && typeof goat === "boolean" && (rule === undefined || RULES.has(rule));
}

// The duel rules of a custom room: the story rule is a card of the rule, placed in seat 0's deck like the event ones.
export const roomRules = ({ lp, hand, rule }: RoomOptions): Rules => ({ lp, hand, cards: rule ? [EXTRA_RULES.get(rule) as number] : [] });
