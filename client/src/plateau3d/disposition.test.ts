import { OcgLocation, OcgMessageType, OcgPosition } from "@n1xx1/ocgcore-wasm";
import { expect, it } from "vitest";
import { newBoard, playAll } from "../board.ts";
import { cibles3D, etatScene, zones } from "./disposition.ts";

const { HAND, MZONE, SZONE, GRAVE, REMOVED, DECK } = OcgLocation;
const { FACEUP_ATTACK, FACEDOWN_DEFENSE, FACEUP_DEFENSE, FACEDOWN } = OcgPosition;

it("place vos zones au premier plan et celles de l'adversaire en symétrie centrale", () => {
  const all = zones(1);
  expect(all).toHaveLength(28);
  const mine = all.find((zone) => zone.id === `1:${MZONE}:0`);
  const theirs = all.find((zone) => zone.id === `0:${MZONE}:0`);
  expect(mine).toMatchObject({ camp: 0, type: "monstre", col: 1 });
  expect(theirs).toMatchObject({ camp: 1, type: "monstre", x: -(mine?.x ?? 0), z: -(mine?.z ?? 0) });
  expect(all.find((zone) => zone.id === `1:${SZONE}:5`)).toMatchObject({ type: "terrain", rangee: 0, col: 0 });
  expect(all.find((zone) => zone.id === `1:${GRAVE}`)).toMatchObject({ type: "cimetiere", col: 6 });
  expect(all.find((zone) => zone.id === `1:${DECK}`)).toMatchObject({ type: "deck", rangee: 1, col: 6 });
});

it("montre les cartes du plateau : défense de côté, vos cartes posées sous un voile, le dos des cartes adverses posées", () => {
  const board = playAll(newBoard(4000, [40, 40]), [
    { type: OcgMessageType.DRAW, player: 0, drawn: [{ code: 7, position: FACEDOWN }, { code: 8, position: FACEDOWN }] },
    { type: OcgMessageType.MOVE, card: 7, from: { controller: 0, location: HAND, sequence: 0, position: FACEDOWN }, to: { controller: 0, location: MZONE, sequence: 1, position: FACEDOWN_DEFENSE } },
    { type: OcgMessageType.MOVE, card: 8, from: { controller: 0, location: HAND, sequence: 0, position: FACEDOWN }, to: { controller: 0, location: GRAVE, sequence: 0, position: FACEUP_ATTACK } },
    { type: OcgMessageType.MOVE, card: 0, from: { controller: 1, location: DECK, sequence: 0, position: FACEDOWN }, to: { controller: 1, location: SZONE, sequence: 2, position: FACEDOWN_DEFENSE } },
    { type: OcgMessageType.MOVE, card: 9, from: { controller: 1, location: DECK, sequence: 0, position: FACEDOWN }, to: { controller: 1, location: MZONE, sequence: 0, position: FACEUP_DEFENSE } },
  ]);
  const { cartes, piles } = etatScene(board, 0);
  expect(cartes.get(`0:${MZONE}:1`)).toEqual({ code: 7, defense: true, cachee: true, voile: true });
  expect(cartes.get(`1:${SZONE}:2`)).toEqual({ code: 0, defense: false, cachee: true, voile: false });
  expect(cartes.get(`1:${MZONE}:0`)).toEqual({ code: 9, defense: true, cachee: false, voile: false });
  expect(cartes.size).toBe(3);
  expect(piles.get(`0:${GRAVE}`)).toEqual({ nombre: 1, code: 8 });
  expect(piles.get(`1:${DECK}`)).toEqual({ nombre: 38, code: 0 });
  expect(piles.get(`1:${REMOVED}`)).toEqual({ nombre: 0, code: 0 });
  expect(etatScene(board, 1).cartes.get(`0:${MZONE}:1`)?.voile).toBe(false);
});

it("allume en 3D les zones et les piles des cibles d'une question, pas la main", () => {
  const targets = [`0:${MZONE}:2`, `1:${SZONE}:5`, `1:${GRAVE}:3`, `1:${GRAVE}:0`, `0:${REMOVED}:1`, `0:${HAND}:4`];
  expect([...cibles3D(targets)]).toEqual([`0:${MZONE}:2`, `1:${SZONE}:5`, `1:${GRAVE}`, `0:${REMOVED}`]);
});
