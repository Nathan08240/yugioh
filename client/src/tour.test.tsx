import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { TowerView } from "../../server/src/protocol.ts";
import { Tour, towerLine } from "./Tour.tsx";

const floors = Array.from({ length: 10 }, (_, i) => ({ opponent: `Adversaire ${i + 1}`, level: "normal" as const, lp: 4000, boosters: [3, 6, 10].includes(i + 1) ? 1 : 0 }));
const tower: TowerView = { floors, floor: 3, best: 7, claimed: [3, 6] };

it("montre l'étage à jouer, le record et les récompenses déjà prises", () => {
  const html = renderToStaticMarkup(<Tour tower={tower} send={() => {}} />);
  expect(html).toContain("Monter à l&#x27;étage 4");
  expect(html).toContain("7 étages");
  expect(html.match(/obtenus/g)).toHaveLength(2);
  expect(html).toMatch(/aria-current="step"[^>]*><b class="tour__numero chiffres">4</);
  expect(towerLine(tower)).toBe("Étage 4 sur 10 · record : 7 étages");
  expect(towerLine({ ...tower, floor: 0, best: 0 })).toBe("Étage 1 sur 10");
});
