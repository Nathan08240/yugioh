import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DeckResult } from "../../server/src/protocol.ts";
import { DeckRecord, tally } from "./DeckRecord.tsx";

const results: DeckResult[] = [
  { deck: 1, mode: "online", wins: 2, losses: 1 },
  { deck: 1, mode: "bot", level: "expert", wins: 1, losses: 0 },
  { deck: 2, mode: "bot", level: "debutant", wins: 1, losses: 1 },
  { deck: 2, mode: "story", wins: 0, losses: 3 },
  { deck: null, mode: "online", wins: 1, losses: 0 },
];

it("totalise par deck, par mode et pour le joueur", () => {
  expect(tally(results, 1)).toEqual({ wins: 3, losses: 1, percent: 75 });
  expect(tally(results, 1, "bot")).toEqual({ wins: 1, losses: 0, percent: 100 });
  expect(tally(results, 2)).toEqual({ wins: 1, losses: 4, percent: 20 });
  expect(tally(results)).toEqual({ wins: 5, losses: 5, percent: 50 });
  expect(tally(results, undefined, "bot", "debutant")).toEqual({ wins: 1, losses: 1, percent: 50 });
  expect(tally(results, undefined, "bot", "normal")).toEqual({ wins: 0, losses: 0, percent: undefined });
  expect(tally(results, 3)).toEqual({ wins: 0, losses: 0, percent: undefined });
});

it("affiche le bilan du deck avec le détail des modes joués", () => {
  const html = renderToStaticMarkup(<DeckRecord results={results} deck={1} />);
  for (const text of ["3 victoires", "1 défaite", "75 % de victoires", "En ligne 2-1", "Contre le bot 1-0"]) expect(html).toContain(text);
  expect(html).not.toContain("Histoire");
  expect(renderToStaticMarkup(<DeckRecord results={results} deck={3} />)).toContain("Aucun duel joué");
  expect(renderToStaticMarkup(<DeckRecord deck={1} />)).toBe("");
});
