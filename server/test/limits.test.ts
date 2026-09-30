import { describe, expect, it } from "vitest";
import { goatLimits, type LimitCard } from "../scripts/lflist.ts";
import { GOAT } from "../src/limits.ts";
import { POOL } from "../src/pool.ts";

const card = (passwords: string[], ...history: [string, string][]): LimitCard => ({
  passwords,
  legality: { tcg: { history: history.map(([date, legality]) => ({ date, legality })) } },
});

describe("calcul de la liste", () => {
  const inPool = (code: number) => code !== 9;

  it("retient la dernière entrée datée au plus du 2005-04-01, bornes comprises", () => {
    const cards = [
      card(["1"], ["2002-05-07", "limited"], ["2005-10-01", "forbidden"]),
      card(["2"], ["2004-09-01", "semilimited"], ["2005-04-01", "forbidden"]),
      card(["3"], ["2003-01-01", "forbidden"], ["2005-03-01", "unlimited"]),
      card(["4"], ["2005-04-02", "limited"]),
      card(["5"], ["2005-04-01", "limited"], ["2004-01-01", "forbidden"]),
    ];
    expect(goatLimits(cards, inPool)).toEqual({ 1: 1, 2: 0, 5: 1 });
  });

  it("ignore les cartes sans historique TCG et les passcodes hors du pool, garde chaque passcode du pool", () => {
    const cards = [{ passwords: ["6"] }, { passwords: ["7"], legality: {} }, card(["8", "9", "10"], ["2004-01-01", "limited"])];
    expect(goatLimits(cards, inPool)).toEqual({ 8: 1, 10: 1 });
  });
});

describe("liste Goat versionnée", () => {
  it("donne les limites connues d'avril 2005 : Pot de Cupidité limité, Raigeki interdit", () => {
    expect(GOAT.get(55144522)).toBe(1);
    expect(GOAT.get(12580477)).toBe(0);
    expect(GOAT.get(45231177)).toBeUndefined();
  });

  it("ne contient que des cartes du pool, avec des limites de 0 à 2", () => {
    expect(GOAT.size).toBeGreaterThan(0);
    for (const [code, max] of GOAT) {
      expect(POOL.has(code), String(code)).toBe(true);
      expect([0, 1, 2]).toContain(max);
    }
  });
});
