import { describe, expect, it, vi } from "vitest";
import { horloge, surveillant } from "./cadence.ts";

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

describe("horloge", () => {
  it("counts neither a hit-stop nor a hold without frames as a step or as slowness", () => {
    const lent = vi.fn();
    const h = horloge(lent);
    // Bursts of 0.2 s of motion at 60 fps (charge, impact), each ended by a still frame then 90 ms to 700 ms without frames.
    for (let i = 0; i < 20; i++) {
      const arret = [0.09, 0.35, 0.7][i % 3];
      expect(h.pas(arret)).toBe(1 / 60);
      h.fin(arret, true);
      for (let t = 0; t < 0.2; t += 1 / 60) {
        expect(h.pas(1 / 60)).toBe(1 / 60);
        h.fin(1 / 60, true);
      }
      h.fin(1 / 60, false);
    }
    expect(lent).not.toHaveBeenCalled();
  });

  it("times the frames that follow a moving one, with a step of a tenth of a second at most", () => {
    const lent = vi.fn();
    const h = horloge(lent);
    h.fin(1 / 60, true);
    expect(h.pas(0.5)).toBe(0.1);
    jouer((dt) => h.fin(dt, true), 1 / 20, 3.5);
    expect(lent).toHaveBeenCalledTimes(1);
  });
});
