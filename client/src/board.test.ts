import { OcgLocation, OcgMessageType, OcgPhase, OcgPosition, type OcgFieldPlayer } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it } from "vitest";
import type { ServerMessage, Wire } from "../../server/src/protocol.ts";
import { losesAtTurnEnd, newBoard, playAll, type Message } from "./board.ts";
import recorded from "./fixtures/duel.json";

const DARK_MAGICIAN = 46986414;
const POT_OF_GREED = 55144522;
const { HAND, MZONE, SZONE, GRAVE } = OcgLocation;
const { FACEUP_ATTACK, FACEDOWN_DEFENSE, FACEDOWN } = OcgPosition;

const hand = (player: 0 | 1, codes: number[]): Message => ({
  type: OcgMessageType.DRAW,
  player,
  drawn: codes.map((code) => ({ code, position: FACEDOWN })),
});
const start = playAll(newBoard(4000, [40, 40]), [hand(0, [1, 2, DARK_MAGICIAN, 3, 4]), hand(1, [0, 0, 0, 0, 0])]);
// Player 0 normal summons Dark Magician from the third card of the hand.
const summoned = playAll(start, [
  { type: OcgMessageType.MOVE, card: DARK_MAGICIAN, from: { controller: 0, location: HAND, sequence: 2, position: FACEDOWN }, to: { controller: 0, location: MZONE, sequence: 0, position: FACEUP_ATTACK } },
  { type: OcgMessageType.SUMMONING, code: DARK_MAGICIAN, controller: 0, location: MZONE, sequence: 0, position: FACEUP_ATTACK },
]);

describe("plateau reconstruit à partir des messages du moteur", () => {
  it("affiche la taille de l'extra deck et l'invoque par fusion vers le terrain", () => {
    const FLAME_SWORDSMAN = 45231177;
    const board = playAll(newBoard(4000, [40, 40], [2, 0]), [
      { type: OcgMessageType.MOVE, card: FLAME_SWORDSMAN, from: { controller: 0, location: OcgLocation.EXTRA, sequence: 0, position: FACEDOWN }, to: { controller: 0, location: MZONE, sequence: 1, position: FACEUP_ATTACK } },
      { type: OcgMessageType.SPSUMMONING, code: FLAME_SWORDSMAN, controller: 0, location: MZONE, sequence: 1, position: FACEUP_ATTACK },
    ]);
    expect(board.players.map((side) => side.extra)).toEqual([1, 0]);
    expect(board.players[0].monsters[1]).toEqual({ code: FLAME_SWORDSMAN, position: FACEUP_ATTACK });
    expect(newBoard(4000, [40, 40]).players.map((side) => side.extra)).toEqual([0, 0]);
  });

  it("pioche la main de départ, cachée pour l'adversaire", () => {
    expect(start.players[0]).toMatchObject({ deck: 35, lp: 4000 });
    expect(start.players[0].hand.map((card) => card.code)).toEqual([1, 2, DARK_MAGICIAN, 3, 4]);
    expect(start.players[1].hand.map((card) => card.code)).toEqual([0, 0, 0, 0, 0]);
    expect(start.log.at(-1)).toEqual({ player: 1, parts: ["Pioche 5 cartes"] });
  });

  it("invoque un monstre depuis la main", () => {
    expect(summoned.players[0].monsters[0]).toEqual({ code: DARK_MAGICIAN, position: FACEUP_ATTACK });
    expect(summoned.players[0].hand.map((card) => card.code)).toEqual([1, 2, 3, 4]);
    expect(summoned.log.at(-1)).toEqual({ player: 0, parts: ["Invocation : ", { code: DARK_MAGICIAN }] });
    // The previous board is left untouched.
    expect(start.players[0].monsters[0]).toBeNull();
  });

  it("garde les stats courantes envoyées par le serveur jusqu'au départ du monstre", () => {
    const empty = [null, null, null, null, null];
    const boosted = playAll(summoned, [{ type: "stats", monsters: [[{ atk: 2700, def: 2300 }, ...empty.slice(1)], empty] }]);
    expect(boosted.players[0].monsters[0]).toEqual({ code: DARK_MAGICIAN, position: FACEUP_ATTACK, atk: 2700, def: 2300 });
    const destroyed = playAll(boosted, [
      { type: OcgMessageType.MOVE, card: DARK_MAGICIAN, from: { controller: 0, location: MZONE, sequence: 0, position: FACEUP_ATTACK }, to: { controller: 0, location: GRAVE, sequence: 0, position: FACEUP_ATTACK } },
    ]);
    expect(destroyed.players[0].grave).toEqual([{ code: DARK_MAGICIAN, position: FACEUP_ATTACK }]);
  });

  it("pose une carte adverse face cachée sans la connaître, puis la révèle quand elle est retournée", () => {
    const set = playAll(start, [
      { type: OcgMessageType.MOVE, card: 0, from: { controller: 1, location: HAND, sequence: 4, position: FACEDOWN }, to: { controller: 1, location: MZONE, sequence: 2, position: FACEDOWN_DEFENSE } },
      { type: OcgMessageType.SET, code: 0, controller: 1, location: MZONE, sequence: 2, position: FACEDOWN_DEFENSE },
    ]);
    expect(set.players[1].monsters[2]).toEqual({ code: 0, position: FACEDOWN_DEFENSE });
    expect(set.players[1].hand).toHaveLength(4);

    const flipped = playAll(set, [
      { type: OcgMessageType.POS_CHANGE, code: DARK_MAGICIAN, controller: 1, location: MZONE, sequence: 2, prev_position: FACEDOWN_DEFENSE, position: FACEUP_ATTACK },
    ]);
    expect(flipped.players[1].monsters[2]).toEqual({ code: DARK_MAGICIAN, position: FACEUP_ATTACK });
  });

  it("attaque directement et inflige des dégâts", () => {
    const board = playAll(summoned, [
      { type: OcgMessageType.ATTACK, card: { controller: 0, location: MZONE, sequence: 0, position: FACEUP_ATTACK }, target: null },
      { type: OcgMessageType.DAMAGE, player: 1, amount: 2500 },
      // LP below 0 come back as unsigned values.
      { type: OcgMessageType.LPUPDATE, player: 0, lp: 2 ** 32 - 200 },
    ]);
    expect(board.players[1].lp).toBe(1500);
    expect(board.players[0].lp).toBe(-200);
    expect(board.log.slice(-2)).toEqual([
      { player: 0, parts: ["Attaque : ", { code: DARK_MAGICIAN }, " directement"] },
      { player: 1, parts: ["Perd 2500 LP"] },
    ]);
    // The end of the duel shows the final blow.
    expect(board.lastHit).toEqual({ player: 1, amount: 2500, code: DARK_MAGICIAN });
    const burnt = playAll(board, [
      { type: OcgMessageType.CHAINING, code: POT_OF_GREED, controller: 1, location: SZONE, sequence: 1, position: FACEUP_ATTACK, triggering_controller: 1, triggering_location: SZONE, triggering_sequence: 1, description: "0", chain_size: 1 },
      { type: OcgMessageType.PAY_LPCOST, player: 1, amount: 500 },
      { type: OcgMessageType.DAMAGE, player: 0, amount: 800 },
    ]);
    expect(burnt.lastHit).toEqual({ player: 0, amount: 800, code: POT_OF_GREED });
  });

  it("attribue les dégâts de combat à l'attaquant, même après une chaîne, et ignore une carte activée plus tôt", () => {
    const activation = {
      type: OcgMessageType.CHAINING,
      code: POT_OF_GREED,
      controller: 1,
      location: SZONE,
      sequence: 1,
      position: FACEUP_ATTACK,
      triggering_controller: 1,
      triggering_location: SZONE,
      triggering_sequence: 1,
      description: "0",
      chain_size: 1,
    } as const;
    const attack = { type: OcgMessageType.ATTACK, card: { controller: 0, location: MZONE, sequence: 0, position: FACEUP_ATTACK }, target: null } as const;
    const solved = [{ type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 }, { type: OcgMessageType.CHAIN_END }] as const;
    const main2 = { type: OcgMessageType.NEW_PHASE, phase: OcgPhase.MAIN2 } as const;
    const hit = { type: OcgMessageType.DAMAGE, player: 1, amount: 2500 } as const;

    expect(playAll(summoned, [attack, activation, ...solved, hit]).lastHit?.code).toBe(DARK_MAGICIAN);
    // No attack and no chain in progress: the source is unknown, not the card activated earlier.
    expect(playAll(summoned, [activation, ...solved, main2, hit]).lastHit?.code).toBe(0);
    // The attacker is forgotten once the phase changes.
    expect(playAll(summoned, [attack, main2, hit]).lastHit?.code).toBe(0);
  });

  it("envoie au cimetière une carte détruite, et suit la chaîne", () => {
    const board = playAll(summoned, [
      { type: OcgMessageType.MOVE, card: POT_OF_GREED, from: { controller: 0, location: HAND, sequence: 0, position: FACEDOWN }, to: { controller: 0, location: SZONE, sequence: 1, position: FACEUP_ATTACK } },
      { type: OcgMessageType.CHAINING, code: POT_OF_GREED, controller: 0, location: SZONE, sequence: 1, position: FACEUP_ATTACK, triggering_controller: 0, triggering_location: SZONE, triggering_sequence: 1, description: "0", chain_size: 1 },
    ]);
    expect(board.chain).toEqual([{ code: POT_OF_GREED, controller: 0, location: SZONE, sequence: 1 }]);

    const destroyed = playAll(board, [
      { type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 },
      { type: OcgMessageType.MOVE, card: DARK_MAGICIAN, from: { controller: 0, location: MZONE, sequence: 0, position: FACEUP_ATTACK }, to: { controller: 0, location: GRAVE, sequence: 0, position: FACEUP_ATTACK } },
      { type: OcgMessageType.CHAIN_END },
    ]);
    expect(destroyed.chain).toEqual([]);
    expect(destroyed.players[0].monsters[0]).toBeNull();
    expect(destroyed.players[0].grave).toEqual([{ code: DARK_MAGICIAN, position: FACEUP_ATTACK }]);
    expect(destroyed.log.at(-1)).toEqual({ player: 0, parts: ["Envoyée au cimetière : ", { code: DARK_MAGICIAN }] });
  });

  it("change de tour et de phase", () => {
    const board = playAll(start, [
      { type: OcgMessageType.NEW_TURN, player: 1 },
      { type: OcgMessageType.NEW_PHASE, phase: OcgPhase.DRAW },
      { type: OcgMessageType.NEW_PHASE, phase: OcgPhase.MAIN1 },
    ]);
    expect(board).toMatchObject({ turn: 1, turnPlayer: 1, phase: OcgPhase.MAIN1 });
  });
});

type Fixture = { lp: number; decks: [number, number]; received: Wire<ServerMessage>[]; field: { players: (OcgFieldPlayer & { lp: number })[] } };

it("rejoue un duel automatique du serveur jusqu'au plateau réel du moteur", () => {
  // Generated by `pnpm --filter server record-duel`: what player 0's client received, and the engine field at the end.
  const { lp, decks, received, field } = recorded as unknown as Fixture;
  const messages = received.flatMap((msg) => (msg.type === "messages" ? msg.messages : []));
  const board = playAll(newBoard(lp, decks), messages);

  const positions = (zone: ({ position: number } | null)[]) => zone.map((card) => card?.position ?? null);
  const counts = board.players.map((side) => ({
    lp: side.lp,
    deck: side.deck,
    hand: side.hand.length,
    grave: side.grave.length,
    banished: side.banished.length,
    extra: side.extra,
    monsters: positions(side.monsters),
    spells: positions(side.spells),
  }));
  expect(counts).toEqual(
    field.players.map((player) => ({
      lp: player.lp | 0,
      deck: player.deck_size,
      hand: player.hand_size,
      grave: player.grave_size,
      banished: player.banish_size,
      extra: player.extra_size,
      monsters: positions(player.monsters),
      spells: positions(player.spells),
    })),
  );
  // Player 0 knows every card of theirs and the public ones, never the opponent's hand.
  const [me, opponent] = board.players;
  expect([...me.hand, ...me.grave, ...opponent.grave].every((card) => card.code)).toBe(true);
  expect(opponent.hand.every((card) => !card.code)).toBe(true);
  expect(board.winner).toBe(1);
  expect(board.log.at(-1)).toEqual({ player: 1, parts: ["Remporte le duel"] });
});

describe("règles spéciales du mode Histoire", () => {
  const FISSURE = 66788016;
  const empty = [null, null, null, null, null];
  const strong = playAll(summoned, [{ type: "stats", monsters: [[{ atk: 2500, def: 2100 }, ...empty.slice(1)], empty] }]);
  const fissure = { type: OcgMessageType.CHAINING, code: FISSURE, controller: 1, location: SZONE, sequence: 0, position: FACEUP_ATTACK, triggering_controller: 1, triggering_location: SZONE, triggering_sequence: 0, description: "0", chain_size: 1 } as const;
  const destroyed = { type: OcgMessageType.MOVE, card: DARK_MAGICIAN, from: { controller: 0, location: MZONE, sequence: 0, position: FACEUP_ATTACK }, to: { controller: 0, location: GRAVE, sequence: 0, position: FACEUP_ATTACK } } as const;
  const solved = [{ type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 }, { type: OcgMessageType.CHAIN_END }] as const;

  it("reconnaît les dégâts de destruction du Royaume : la moitié de l'ATK du monstre détruit par un effet", () => {
    const board = playAll(strong, [fissure, destroyed, { type: OcgMessageType.DAMAGE, player: 0, amount: 1250 }]);
    expect(board.lastHit).toEqual({ player: 0, amount: 1250, code: FISSURE, destroyed: [DARK_MAGICIAN] });
    expect(board.log.at(-1)).toEqual({ player: 0, parts: ["Règle spéciale : ", { code: DARK_MAGICIAN }, " détruit, perd la moitié de son ATK (1250 LP)"] });
  });

  it("garde le libellé ordinaire quand le montant ou le contexte ne correspond pas", () => {
    // Not half of the ATK, then a destruction outside any chain (battle), then a chain that has ended.
    const wrongAmount = playAll(strong, [fissure, destroyed, { type: OcgMessageType.DAMAGE, player: 0, amount: 800 }]);
    expect(wrongAmount.lastHit?.destroyed).toBeUndefined();
    expect(wrongAmount.log.at(-1)).toEqual({ player: 0, parts: ["Perd 800 LP"] });
    expect(playAll(strong, [destroyed, { type: OcgMessageType.DAMAGE, player: 0, amount: 1250 }]).lastHit?.destroyed).toBeUndefined();
    expect(playAll(strong, [fissure, destroyed, ...solved, { type: OcgMessageType.DAMAGE, player: 0, amount: 1250 }]).lastHit?.destroyed).toBeUndefined();
  });

  it("garde la raison de la victoire et explique la défaite d'un tour fini sans monstre", () => {
    const board = playAll(strong, [{ type: OcgMessageType.WIN, player: 1, reason: 0x5a }]);
    expect(board.winner).toBe(1);
    expect(board.winReason).toBe(0x5a);
    expect(board.log.at(-1)).toEqual({ player: 1, parts: ["Remporte le duel : l'autre duelliste a fini son tour sans monstre (règle spéciale)"] });
    expect(playAll(strong, [{ type: OcgMessageType.WIN, player: 1, reason: 1 }]).winReason).toBe(1);
  });
});

describe("fin de tour sans monstre (règle du Royaume)", () => {
  const summon = (type: OcgMessageType.SUMMONING | OcgMessageType.SPSUMMONING | OcgMessageType.FLIPSUMMONING, controller: 0 | 1) =>
    ({ type, code: DARK_MAGICIAN, controller, location: MZONE, sequence: 0, position: FACEUP_ATTACK }) as Message;

  it("perd le duel sans monstre ni invocation, et plus avec un monstre ou une invocation du tour", () => {
    const turn = playAll(start, [{ type: OcgMessageType.NEW_TURN, player: 0 }]);
    expect(losesAtTurnEnd(turn)).toBe(true);
    expect(losesAtTurnEnd(summoned)).toBe(false);
    for (const type of [OcgMessageType.SUMMONING, OcgMessageType.SPSUMMONING, OcgMessageType.FLIPSUMMONING] as const) {
      expect(losesAtTurnEnd(playAll(turn, [summon(type, 0)]))).toBe(false);
    }
  });

  it("ignore l'invocation de l'adversaire et repart de zéro à chaque tour", () => {
    const turn = playAll(start, [{ type: OcgMessageType.NEW_TURN, player: 0 }]);
    expect(losesAtTurnEnd(playAll(turn, [summon(OcgMessageType.SUMMONING, 1)]))).toBe(true);
    const next = playAll(playAll(turn, [summon(OcgMessageType.SUMMONING, 0)]), [{ type: OcgMessageType.NEW_TURN, player: 1 }]);
    expect(next.summoned).toBe(false);
    expect(losesAtTurnEnd(next)).toBe(true);
  });
});
