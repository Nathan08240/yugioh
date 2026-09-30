import { OcgMessageType, OcgPosition } from "@n1xx1/ocgcore-wasm";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { newBoard, playAll } from "./board.ts";
import { Duel, webgl2 } from "./Duel.tsx";

it("sans WebGL 2, garde le HUD et joue le duel sur le plateau 2D avec un message", () => {
  expect(webgl2()).toBe(false);
  const board = playAll(newBoard(4000, [40, 40]), [
    { type: OcgMessageType.DRAW, player: 0, drawn: [7, 8].map((code) => ({ code, position: OcgPosition.FACEDOWN })) },
    { type: OcgMessageType.DRAW, player: 1, drawn: [0].map((code) => ({ code, position: OcgPosition.FACEDOWN })) },
  ]);
  const html = renderToStaticMarkup(<Duel board={board} seat={0} respond={() => {}} leave={() => {}} surrender={() => {}} lp={4000} pseudo="Yugi" opponent="Rafael" />);
  expect(html).toContain("le duel se joue sur le plateau 2D");
  expect(html).toContain('class="table"');
  expect(html).not.toContain("plateau-3d");
  for (const text of ["Vos points de vie : 4000 sur 4000", 'Main de l&#x27;adversaire : 1 carte"', 'aria-label="Votre main"', "Yugi", "Rafael", "Journal"]) expect(html).toContain(text);
  expect(html.match(/class="main__carte"/g)).toHaveLength(2);
});

it("affiche le temps de réponse sur la plaque du joueur interrogé et la déconnexion de l'adversaire", () => {
  vi.useFakeTimers({ now: 0 });
  const board = newBoard(4000, [40, 40]);
  const html = renderToStaticMarkup(
    <Duel board={board} seat={0} respond={() => {}} leave={() => {}} surrender={() => {}} answerBy={{ seat: 1, until: 95_000 }} away={{ seat: 1, until: 120_000 }} opponent="Rafael" />,
  );
  vi.useRealTimers();
  expect(html.match(/Temps pour répondre/g)).toHaveLength(1);
  expect(html).toMatch(/plaque--adverse.*Temps pour répondre.*1:35/);
  expect(html).toContain("Rafael s&#x27;est déconnecté, victoire dans <span class=\"chiffres\">2:00</span>");
  expect(html).toContain("Abandonner");
});

it("vu par un spectateur : ni abandon, ni emotes, ni signalement ; les deux joueurs nommés et le nombre de spectateurs", () => {
  const board = playAll(newBoard(4000, [40, 40]), [{ type: OcgMessageType.DRAW, player: 0, drawn: [{ code: 0, position: OcgPosition.FACEDOWN }] }]);
  const html = renderToStaticMarkup(<Duel board={board} seat={0} respond={() => {}} leave={() => {}} surrender={() => {}} lp={4000} pseudo="Yugi" opponent="Rafael" spectateur spectators={2} />);
  for (const text of ["Points de vie de Yugi : 4000 sur 4000", "Points de vie de Rafael : 4000 sur 4000", "Tour de Yugi", "à Yugi", "Main de Yugi", "2 spectateurs"]) expect(html).toContain(text);
  for (const text of ["Abandonner", "Votre main", "Votre tour", "Vous", "Signaler", "réfléchit"]) expect(html).not.toContain(text);
  expect(renderToStaticMarkup(<Duel board={board} seat={0} respond={() => {}} leave={() => {}} surrender={() => {}} spectators={1} />)).toContain("1 spectateur<");
});
