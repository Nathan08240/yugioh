import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { newBoard } from "./board.ts";
import { Duel } from "./Duel.tsx";
import { Emote, MenuEmotes } from "./Emotes.tsx";
import { initialLobby, reduce } from "./lobby.ts";
import { regler } from "./reglages.ts";

afterEach(() => regler({ emotes: "oui" }));

it("garde la dernière émote de chaque siège, numérotée, jusqu'à la sortie du duel", () => {
  let state = reduce(initialLobby, { type: "emote", seat: 1, id: "bonjour" });
  state = reduce(state, { type: "emote", seat: 1, id: "bonjour" });
  state = reduce(state, { type: "emote", seat: 0, id: "merci" });
  expect(state.emotes).toEqual({ 0: { id: "merci", n: 1 }, 1: { id: "bonjour", n: 2 } });
  expect(reduce(state, { type: "left" }).emotes).toEqual({});
});

it("annonce la phrase dans une zone polie toujours présente, vide sans émote", () => {
  expect(renderToStaticMarkup(<Emote emote={{ id: "bienjoue", n: 1 }} />)).toBe('<p class="emote" aria-live="polite">Bien joué !</p>');
  expect(renderToStaticMarkup(<Emote />)).toBe('<p class="emote" aria-live="polite"></p>');
});

it("ouvre la liste des phrases depuis un bouton nommé, fermée au départ", () => {
  const html = renderToStaticMarkup(<MenuEmotes send={() => {}} />);
  expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Émotes<\/button>/);
  expect(html).not.toContain("Bonjour");
});

const duel = (props: Partial<Parameters<typeof Duel>[0]> = {}) =>
  renderToStaticMarkup(<Duel board={newBoard(4000, [40, 40])} seat={0} respond={() => {}} leave={() => {}} surrender={() => {}} opponent="Rafael" {...props} />);
const emotes = { 0: { id: "merci", n: 1 }, 1: { id: "hmm", n: 1 } } as const;

it("pose la bulle de chaque joueur contre sa plaque, celle de l'adversaire seulement si le réglage est actif", () => {
  expect(duel({ emotes })).toMatch(/plaque--adverse.*Hmm….*plaque--moi.*Merci !/);
  regler({ emotes: "non" });
  const html = duel({ emotes });
  expect(html).not.toContain("Hmm…");
  expect(html).toContain("Merci !");
});

it("n'affiche le bouton d'émotes que lorsqu'on peut en envoyer", () => {
  expect(duel()).not.toContain("Émotes");
  expect(duel({ sendEmote: () => {} })).toContain("Émotes");
});
