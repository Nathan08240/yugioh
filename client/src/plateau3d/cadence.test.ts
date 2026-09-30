import { describe, expect, it, vi } from "vitest";
import { surveillant } from "./cadence.ts";

const jouer = (mesure: (dt: number) => void, dt: number, secondes: number) => {
  for (let t = 0; t < secondes; t += dt) mesure(dt);
};

describe("surveillant", () => {
  it("declares slow after 3 s under 45 frames per second", () => {
    const lent = vi.fn();
    jouer(surveillant(lent), 1 / 20, 3.5);
    expect(lent).toHaveBeenCalledTimes(1);
  });

  it("stays quiet at 60 frames per second", () => {
    const lent = vi.fn();
    jouer(surveillant(lent), 1 / 60, 10);
    expect(lent).not.toHaveBeenCalled();
  });

  it("ignores the gaps of a tab that was hidden or idle", () => {
    const lent = vi.fn();
    const mesure = surveillant(lent);
    for (let i = 0; i < 50; i++) mesure(30);
    jouer(mesure, 1 / 60, 5);
    expect(lent).not.toHaveBeenCalled();
  });

  it("calls back only once", () => {
    const lent = vi.fn();
    jouer(surveillant(lent), 1 / 20, 10);
    expect(lent).toHaveBeenCalledTimes(1);
  });
});
