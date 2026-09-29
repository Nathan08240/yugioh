import { OcgMessageType, OcgPosition } from "@n1xx1/ocgcore-wasm";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { newBoard, playAll } from "./board.ts";
import { Duel, webgl2 } from "./Duel.tsx";

it("sans WebGL 2, garde le HUD et joue le duel sur le plateau 2D avec un message", () => {
  expect(webgl2()).toBe(false);
  const board = playAll(newBoard(4000, [40, 40]), [
    { type: OcgMessageType.DRAW, player: 0, drawn: [7, 8].map((code) => ({ code, position: OcgPosition.FACEDOWN })) },
    { type: OcgMessageType.DRAW, player: 1, drawn: [0].map((code) => ({ code, position: OcgPosition.FACEDOWN })) },
  ]);
  const html = renderToStaticMarkup(<Duel board={board} seat={0} respond={() => {}} leave={() => {}} lp={4000} pseudo="Yugi" opponent="Rafael" />);
  expect(html).toContain("le duel se joue sur le plateau 2D");
  expect(html).toContain('class="table"');
  expect(html).not.toContain("plateau-3d");
  for (const text of ["Vos points de vie : 4000 sur 4000", 'Main de l&#x27;adversaire : 1 carte"', 'aria-label="Votre main"', "Yugi", "Rafael", "Journal"]) expect(html).toContain(text);
  expect(html.match(/class="main__carte"/g)).toHaveLength(2);
});
