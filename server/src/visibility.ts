import { OcgHintType, OcgLocation, OcgMessageType, OcgPosition, type OcgLocPos, type OcgMessage } from "@n1xx1/ocgcore-wasm";

// The engine sends every card code in clear: each player only gets what the rules let them see.
const PUBLIC_ZONES = OcgLocation.GRAVE | OcgLocation.OVERLAY;

export const faceUp = (position: number) => (position & OcgPosition.FACEUP) !== 0;

// Verified against EDOPro's GenericDuel::Sending (gframe/generic_duel.cpp, case MSG_HINT): these hint types
// report the acting player's choice, so they go to the other side, which doesn't already know it. CARD goes to both.
const HINT_OPPONENT_ONLY = new Set<OcgHintType>([
  OcgHintType.OPSELECTED,
  OcgHintType.RACE,
  OcgHintType.ATTRIB,
  OcgHintType.CODE,
  OcgHintType.NUMBER,
  OcgHintType.ZONE,
]);

function hiddenFrom(card: Record<string, unknown>, viewer: number): boolean {
  if (typeof card.code !== "number" || typeof card.location !== "number") return false;
  if (card.controller === viewer || (card.location & PUBLIC_ZONES) !== 0) return false;
  return typeof card.position !== "number" || !faceUp(card.position);
}

// Zeroes, at any depth, the code of every opponent card that is not face up or in a public zone. What has nothing
// to hide is returned as is, never copied: the logs of both seats and of the spectators then share it.
export function hideCards<T>(value: T, viewer: number): T {
  if (Array.isArray(value)) {
    const items = value.map((item) => hideCards(item, viewer));
    return (items.some((item, index) => item !== value[index]) ? items : value) as T;
  }
  if (typeof value !== "object" || value === null) return value;
  const source = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;
  for (const [key, item] of Object.entries(source)) {
    const hidden = hideCards(item, viewer);
    if (hidden !== item) {
      copy ??= { ...source };
      copy[key] = hidden;
    }
  }
  const result = copy ?? source;
  if (result.code !== 0 && hiddenFrom(result, viewer)) return { ...result, code: 0 } as T;
  return result as T;
}

// Same rule as YGOPro: a card entering a deck, a hand or a face-down spot is only known to its new controller.
function outOfSight(to: OcgLocPos): boolean {
  if ((to.location & PUBLIC_ZONES) !== 0) return false;
  return (to.location & (OcgLocation.DECK | OcgLocation.HAND)) !== 0 || !faceUp(to.position);
}

// The message as the viewer may see it, or null when it is not for them. Questions go through hideCards only.
export function visibleTo(msg: OcgMessage, viewer: number): OcgMessage | null {
  switch (msg.type) {
    case OcgMessageType.HINT: {
      if (msg.hint_type === OcgHintType.CARD) return msg;
      if (HINT_OPPONENT_ONLY.has(msg.hint_type)) return msg.player !== viewer ? msg : null;
      return msg.player === viewer ? msg : null;
    }
    case OcgMessageType.MISSED_EFFECT:
      return msg.controller === viewer ? msg : null;
    case OcgMessageType.CONFIRM_CARDS:
      return msg.player === viewer || msg.cards.every((card) => card.location !== OcgLocation.DECK) ? msg : null;
    case OcgMessageType.DRAW:
      if (msg.player === viewer) return msg;
      return { ...msg, drawn: msg.drawn.map((card) => (faceUp(card.position) ? card : { ...card, code: 0 })) };
    case OcgMessageType.MOVE:
      return msg.to.controller === viewer || !outOfSight(msg.to) ? msg : { ...msg, card: 0 };
    case OcgMessageType.SHUFFLE_HAND:
    case OcgMessageType.SHUFFLE_EXTRA:
      return msg.player === viewer ? msg : { ...msg, cards: msg.cards.map(() => 0) };
    case OcgMessageType.DECK_TOP:
      return faceUp(msg.position) ? msg : { ...msg, code: 0 };
    // Activations and excavations are public, wherever the card sits.
    case OcgMessageType.CHAINING:
    case OcgMessageType.CONFIRM_DECKTOP:
    case OcgMessageType.CONFIRM_EXTRATOP:
      return msg;
    default:
      return hideCards(msg, viewer);
  }
}
