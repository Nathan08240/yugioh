import { OcgMessageType, OcgPosition } from "@n1xx1/ocgcore-wasm";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { newBoard, playAll } from "./board.ts";
import { Duel, webgl2 } from "./Duel.tsx";
import { CELTIC, MIRROR_FORCE } from "./tutoriel.ts";

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

it("tutoriel : la consigne suit les messages du moteur, la carte à jouer est mise en évidence dans la main", () => {
  const board = playAll(newBoard(4000, [40, 40]), [{ type: OcgMessageType.DRAW, player: 0, drawn: [CELTIC, MIRROR_FORCE].map((code) => ({ code, position: OcgPosition.FACEDOWN })) }]);
  const duel = (feed?: Parameters<typeof Duel>[0]["feed"]) => renderToStaticMarkup(<Duel board={board} seat={0} respond={() => {}} leave={() => {}} surrender={() => {}} feed={feed} tutoriel />);
  const start = duel();
  expect(start).toContain("Tutoriel · étape 1 sur 8");
  expect(start).toContain("Invoquer un monstre");
  expect(start).toContain("Passer le tutoriel");
  expect(start.match(/est-conseillee/g)).toHaveLength(1);
  expect(start).toContain(`Carte ${CELTIC}, à jouer pour le tutoriel`);

  const summoned = duel({ id: 1, messages: [{ type: OcgMessageType.SUMMONING, code: CELTIC, controller: 0, location: 4, sequence: 0, position: OcgPosition.FACEUP_ATTACK }] });
  expect(summoned).toContain("Attaquer directement");
  expect(summoned).not.toContain("est-conseillee");
  expect(renderToStaticMarkup(<Duel board={board} seat={0} respond={() => {}} leave={() => {}} surrender={() => {}} />)).not.toContain("Tutoriel");
});
