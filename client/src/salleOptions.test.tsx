import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { RoomOptions } from "../../server/src/protocol.ts";
import { AlertesView } from "./Amis.tsx";
import { DuelView } from "./cards.ts";
import { initialLobby, reduce } from "./lobby.ts";
import { duelRules } from "./regles.tsx";
import { ApercuSalle, RoomForm, RoomRules } from "./SalleOptions.tsx";

const OPTIONS: RoomOptions = { lp: 8000, hand: 6, goat: true, rule: "battle-city" };
const joined = { type: "joined" as const, room: "ABCDE", seat: 0 as const, lp: 8000, decks: [40, 40] as [number, number], extras: [0, 0] as [number, number], log: [] };
const render = (node: React.ReactNode) => renderToStaticMarkup(<DuelView value={{ cards: new Map(), show: () => {}, seat: 0 }}>{node}</DuelView>);

it("garde les règles d'une salle demandée jusqu'à ce que le joueur la rejoigne ou la refuse, et celles du duel en cours", () => {
  let state = reduce(initialLobby, { type: "room_rules", room: "ABCDE", options: OPTIONS });
  expect(state.preview).toEqual({ room: "ABCDE", options: OPTIONS });
  expect(reduce(state, { type: "preview_close" }).preview).toBeUndefined();
  expect(reduce(state, { type: "error", error: "salle complète" }).preview).toBeUndefined();
  expect(reduce(state, { type: "room_rules", room: "ABCDE" }).preview).toBeUndefined();

  state = reduce(state, { ...joined, special: ["battle-city"], options: OPTIONS });
  expect(state).toMatchObject({ preview: undefined, options: OPTIONS, special: ["battle-city"] });
  expect(reduce(state, { type: "left" })).toMatchObject({ options: undefined, special: undefined });
  expect(reduce(reduce(state, { type: "left" }), joined).options).toBeUndefined();
});

it("garde les règles d'un défi reçu avec le défi", () => {
  const state = reduce(initialLobby, { type: "challenged", from: "Joey", ms: 60_000, options: OPTIONS });
  expect(state.challenges).toMatchObject([{ from: "Joey", options: OPTIONS }]);
  const html = render(<AlertesView challenges={state.challenges} send={() => {}} now={Date.now()} />);
  expect(html).toContain("8000 LP de départ.");
  expect(html).toContain("6 cartes en main au départ.");
  expect(html).toContain("Goat appliquée");
  expect(html).toContain("Règles spéciales : Battle City.");
});

it("le badge du duel commence par les règles de la salle, puis celles de son arc ; un duel standard n'en a pas", () => {
  const rules = duelRules(["battle-city"], OPTIONS);
  expect(rules.map((rule) => rule.title)).toEqual(["Règles de la salle", "Règles de Battle City"]);
  expect(rules[0].details).toEqual(["8000 LP de départ.", "6 cartes en main au départ.", "Liste des cartes limitées Goat appliquée aux deux decks."]);
  expect(duelRules([], { lp: 4000, hand: 5, goat: false })[0].details.at(-1)).toContain("non appliquée");
  expect(duelRules([])).toEqual([]);
});

it("propose les valeurs des listes fermées, 4000 LP et 5 cartes par défaut, sans règle de l'histoire", () => {
  const html = render(<RoomForm title="Règles de la salle" action="Créer la salle" submit={() => {}} cancel={() => {}} />);
  for (const label of ["4000", "8000", "4", "5", "6", "Aucune", "Royaume des Duellistes", "Battle City", "liste des cartes limitées Goat", "Créer la salle"]) expect(html).toContain(label);
  expect(html).not.toContain("Monde virtuel");
  expect(html.match(/checked=""/g)).toHaveLength(3);
});

it("l'aperçu demande d'accepter les règles avant de rejoindre, et n'affiche rien sans salle", () => {
  expect(render(<ApercuSalle send={() => {}} close={() => {}} />)).toBe("");
  const html = render(<ApercuSalle preview={{ room: "ABCDE", options: OPTIONS }} send={() => {}} close={() => {}} />);
  expect(html).toContain("ABCDE");
  expect(html).toContain("Accepter et rejoindre");
  expect(html).toContain("Refuser");
  expect(render(<RoomRules options={{ lp: 4000, hand: 5, goat: false }} />)).not.toContain("Règles spéciales");
});
