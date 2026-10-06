import { OcgMessageType, OcgOpCode, OcgProcessResult, OcgResponseType, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { announceCard, declarable, declarableFromDeck } from "../src/announce.ts";
import { advance, type Room } from "../src/server.ts";

// Serment de l'Archdémon: any card outside the Extra Deck (TYPE_EXTRA, ISTYPE, NOT).
const NOT_EXTRA = [0x4802040n, OcgOpCode.ISTYPE, OcgOpCode.NOT] as OcgOpCode[];
const DARK_MAGICIAN = 46986414;
const MYSTICAL_ELF = 15025844;
const GAIA = 66889139; // a Fusion
const BLUE_EYES = 89631139;

it("donne les cartes du pool que le filtre de déclaration accepte", () => {
  const codes = declarable(NOT_EXTRA);
  expect(codes).toContain(DARK_MAGICIAN);
  expect(codes).not.toContain(GAIA);
  expect(announceCard(NOT_EXTRA)).toBe(codes[0]);
});

it("donne les cartes distinctes du deck que le filtre accepte, les plus nombreuses d'abord", () => {
  const deck = [MYSTICAL_ELF, GAIA, GAIA, GAIA, DARK_MAGICIAN, DARK_MAGICIAN];
  expect(declarableFromDeck(NOT_EXTRA, deck)).toEqual([DARK_MAGICIAN, MYSTICAL_ELF]);
  expect(declarableFromDeck(NOT_EXTRA, [])).toEqual([]);
});

it("le bot déclare la carte la plus présente de son deck, sinon la première du pool", () => {
  expect(announceCard(NOT_EXTRA, [MYSTICAL_ELF, DARK_MAGICIAN, DARK_MAGICIAN, GAIA, GAIA, GAIA])).toBe(DARK_MAGICIAN);
  expect(announceCard(NOT_EXTRA, [GAIA])).toBe(declarable(NOT_EXTRA)[0]);
});

type Duel = NonNullable<Room["duel"]>;
const socket = () => {
  const send = vi.fn();
  return { send, socket: { send } as unknown as WebSocket };
};
const waiting = (question: OcgMessage, setResponse = vi.fn()) =>
  ({ lib: { duelQueryLocation: () => [], duelProcess: () => OcgProcessResult.WAITING, duelGetMessage: () => [question], duelSetResponse: setResponse }, handle: 1 }) as unknown as Duel;
const announced = (player: 0 | 1) => ({ type: OcgMessageType.ANNOUNCE_CARD, player, opcodes: NOT_EXTRA }) as OcgMessage;

it("joint à la question de déclaration le deck du joueur interrogé, jamais celui de l'adversaire", () => {
  const a = socket();
  const b = socket();
  const room: Room = {
    code: "DECK",
    players: [
      { id: "a", socket: a.socket, log: [], deck: [MYSTICAL_ELF, DARK_MAGICIAN, DARK_MAGICIAN] },
      { id: "b", socket: b.socket, log: [], deck: [BLUE_EYES, BLUE_EYES, BLUE_EYES] },
    ],
    duel: waiting(announced(0)),
  };
  advance(room);
  const questions = (client: ReturnType<typeof socket>) => client.send.mock.calls.map(([data]) => JSON.parse(data)).filter((msg) => msg.type === "question");
  expect(questions(a)).toEqual([expect.objectContaining({ announceDeck: [DARK_MAGICIAN, MYSTICAL_ELF] })]);
  expect(questions(a)[0].announce).toContain(BLUE_EYES);
  expect(questions(b)).toEqual([]);
});

it("le bot de la salle déclare la carte la plus présente de son propre deck", async () => {
  const setResponse = vi.fn();
  const room: Room = {
    code: "BOT",
    players: [
      { id: "a", log: [], deck: [BLUE_EYES] },
      { id: "bot", log: [], deck: [GAIA, GAIA, GAIA, MYSTICAL_ELF, DARK_MAGICIAN, DARK_MAGICIAN], bot: { delay: 0, answer: vi.fn(), see: vi.fn() } as never },
    ],
    duel: waiting(announced(1), setResponse),
  };
  setResponse.mockImplementation(() => (room.duel = undefined));
  advance(room);
  await vi.waitFor(() => expect(setResponse).toHaveBeenCalledWith(1, { type: OcgResponseType.ANNOUNCE_CARD, card: DARK_MAGICIAN }));
});
