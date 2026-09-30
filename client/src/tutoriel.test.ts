import { OcgLocation, OcgMessageType, OcgPosition } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it } from "vitest";
import type { Message } from "./board.ts";
import { avancer, CELTIC, ETAPES, MIRROR_FORCE } from "./tutoriel.ts";

const summon = (controller: 0 | 1, code: number): Message => ({ type: OcgMessageType.SUMMONING, code, controller, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK });
const set = (code: number): Message => ({ type: OcgMessageType.SET, code, controller: 0, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEDOWN });
const attack = (target: boolean): Message => ({
  type: OcgMessageType.ATTACK,
  card: { controller: 0, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
  target: target ? { controller: 1, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK } : null,
});

describe("étapes du tutoriel", () => {
  it("avancent quand le moteur confirme l'action du joueur, pas celle de l'adversaire", () => {
    expect(avancer(0, [summon(1, CELTIC)], 0)).toBe(0);
    expect(avancer(0, [summon(0, CELTIC)], 0)).toBe(1);
    expect(avancer(1, [attack(true)], 0)).toBe(1);
    expect(avancer(1, [attack(false)], 0)).toBe(2);
    expect(avancer(0, [summon(1, CELTIC)], 1)).toBe(1);
  });

  it("une action d'une étape plus loin y saute, une action déjà passée ne recule pas", () => {
    expect(avancer(1, [set(MIRROR_FORCE)], 0)).toBe(3);
    expect(avancer(3, [summon(0, CELTIC)], 0)).toBe(3);
    expect(avancer(0, [summon(0, CELTIC), attack(false), set(MIRROR_FORCE), { type: OcgMessageType.NEW_TURN, player: 1 }], 0)).toBe(4);
  });

  it("la victoire du joueur termine le tutoriel, pas celle de l'adversaire", () => {
    expect(avancer(4, [{ type: OcgMessageType.WIN, player: 1, reason: 1 }], 0)).toBe(4);
    expect(avancer(4, [{ type: OcgMessageType.WIN, player: 0, reason: 1 }], 0)).toBe(ETAPES.length);
  });
});
