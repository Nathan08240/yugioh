import { describe, expect, it } from "vitest";
import { firstStep, lethal, safest, type Attacker, type Foe } from "../src/attack-plan.ts";

const attacker = (atk: number, extra: Partial<Attacker> = {}): Attacker => ({ atk, direct: false, pierce: false, ...extra });
const foe = (guard: number, extra: Partial<Foe> = {}): Foe => ({ guard, attackPos: true, worth: guard, known: true, ...extra });

describe("plan d'attaque", () => {
  it("compte les dégâts de percée sur un monstre en défense", () => {
    const wall = foe(1000, { attackPos: false });
    expect(lethal([attacker(2000)], [wall], 1000)).toBeUndefined();
    expect(lethal([attacker(2000, { pierce: true })], [wall], 1000)).toBeDefined();
  });

  it("attaque en direct avec le reste une fois le terrain vidé, détruisant d'abord", () => {
    const foes = [foe(1000)];
    const plan = lethal([attacker(1500), attacker(1800)], foes, 2300);
    expect(plan && firstStep(plan, foes)).toEqual([1, 0]);
    expect(lethal([attacker(1500), attacker(1800)], foes, 2400)).toBeUndefined();
  });

  it("compte une égalité en position d'attaque pour finir le duel, pas pour détruire sans perte", () => {
    expect(lethal([attacker(1000), attacker(1500)], [foe(1000)], 1500)).toBeDefined();
    expect(safest([attacker(1000)], [foe(1000)], false)).toBeUndefined();
  });

  it("ne vise une face cachée que faute d'autre cible, avec le plus faible attaquant qui la bat", () => {
    const hidden = foe(1500, { known: false });
    expect(safest([attacker(2000), attacker(1800)], [hidden], false)).toBeUndefined();
    expect(safest([attacker(2000), attacker(1800)], [hidden], true)?.kills).toEqual([[1, 0]]);
  });
});
