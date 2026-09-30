import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { newBoard } from "./board.ts";
import { Duel } from "./Duel.tsx";
import { initialLobby, reduce } from "./lobby.ts";
import { Signaler } from "./Signaler.tsx";

const duel = (props: Partial<Parameters<typeof Duel>[0]> = {}) =>
  renderToStaticMarkup(<Duel board={newBoard(4000, [40, 40])} seat={0} respond={() => {}} leave={() => {}} surrender={() => {}} {...props} />);

it("compte les signalements que le serveur a enregistrés", () => {
  const state = reduce(reduce(initialLobby, { type: "report_sent" }), { type: "report_sent" });
  expect(state.reported).toBe(2);
  expect(reduce(state, { type: "left" }).reported).toBe(2);
});

it("propose le bouton, formulaire fermé au départ", () => {
  const html = renderToStaticMarkup(<Signaler report={{ send: () => {}, sent: 0 }} />);
  expect(html).toContain("Signaler un problème");
  expect(html).not.toContain("<textarea");
});

it("n'affiche le bouton dans le duel que lorsqu'on peut signaler", () => {
  expect(duel()).not.toContain("Signaler un problème");
  expect(duel({ report: { send: () => {}, sent: 0 } })).toContain("Signaler un problème");
});
