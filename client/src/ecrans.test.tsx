import { OcgLocation, OcgMessageType, OcgResponseType, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CardInfo } from "../../server/src/protocol.ts";
import { newBoard, type EngineMessage } from "./board.ts";
import { interaction } from "./Question.tsx";
import { placeKey } from "./question.ts";

const { MZONE } = OcgLocation;
type Props = { children?: ReactNode; onClick?: () => void; disabled?: boolean; actions?: { label: string; response: OcgResponse }[] };

function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
const text = (node: ReactNode): string => (Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : isValidElement<Props>(node) ? text(node.props.children) : "");

const strings = new Map([
  [1020 + 0, "Guerrier"],
  [1020 + 1, "Magicien"],
  [1020 + 13, "Dragon"],
  [1010 + 4, "LUMIÈRE"],
  [1010 + 5, "TÉNÈBRES"],
]);
const cards = new Map([[10, { name: "Dragon Blanc" } as CardInfo]]);
const at = (sequence: number, location = MZONE) => ({ controller: 0 as const, location, sequence, code: 10 });

// Plays a question the way the panel does: the picks live in `picked`, the panel is rebuilt after each click.
function screen(question: unknown) {
  let picked: string[] = [];
  const sent: OcgResponse[] = [];
  const ui = () => interaction(question as EngineMessage, { board: newBoard(8000, [40, 40]), cards, strings, picked, setPicked: (keys) => (picked = keys), respond: (response) => sent.push(response) });
  const button = (label: string) => {
    const found = elements(ui().panel).find((element) => element.type === "button" && text(element).startsWith(label));
    if (!found) throw new Error(`pas de bouton ${label}`);
    return found;
  };
  return { sent, ui, button, pick: (key: string) => ui().onPick?.(key, { x: 0, y: 0 }), click: (label: string) => button(label).props.onClick?.() };
}

const PLACE = { controller: 0, location: MZONE, sequence: 0 };

it("ANNOUNCE_RACE : déclare exactement le nombre de Types demandé, parmi ceux proposés", () => {
  const { sent, click, button } = screen({ type: OcgMessageType.ANNOUNCE_RACE, player: 0, count: 2, available: String(1n | 2n | 8192n) });
  expect(button("Valider").props.disabled).toBe(true);
  click("Dragon");
  expect(button("Valider").props.disabled).toBe(true);
  click("Guerrier");
  // A third Type is refused until one is taken off.
  click("Magicien");
  expect(button("Valider (2/2)").props.disabled).toBe(false);
  click("Valider");
  expect(sent).toEqual([{ type: OcgResponseType.ANNOUNCE_RACE, races: [8192n, 1n] }]);
});

it("ANNOUNCE_RACE et ANNOUNCE_ATTRIB : un seul choix répond tout de suite, en nommant le Type ou l'Attribut", () => {
  const race = screen({ type: OcgMessageType.ANNOUNCE_RACE, player: 0, count: 1, available: String(2n | 8192n) });
  race.click("Magicien");
  expect(race.sent).toEqual([{ type: OcgResponseType.ANNOUNCE_RACE, races: [2n] }]);
  const attribute = screen({ type: OcgMessageType.ANNOUNCE_ATTRIB, player: 0, count: 1, available: 16 | 32 });
  attribute.click("TÉNÈBRES");
  expect(attribute.sent).toEqual([{ type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: [32] }]);
  const two = screen({ type: OcgMessageType.ANNOUNCE_ATTRIB, player: 0, count: 2, available: 16 | 32 | 4 });
  two.click("LUMIÈRE");
  two.click("TÉNÈBRES");
  two.click("Valider");
  expect(two.sent).toEqual([{ type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: [16, 32] }]);
});

it("garde « Laisser le jeu choisir » sous chaque écran, y compris pour les Types reçus en texte", () => {
  const questions = [
    { type: OcgMessageType.ANNOUNCE_RACE, player: 0, count: 1, available: "8192" },
    { type: OcgMessageType.ANNOUNCE_ATTRIB, player: 0, count: 1, available: 32 },
    { type: OcgMessageType.ANNOUNCE_NUMBER, player: 0, options: ["3"] },
    { type: OcgMessageType.ROCK_PAPER_SCISSORS, player: 0 },
    { type: OcgMessageType.SELECT_COUNTER, player: 0, counter_type: 1, count: 1, cards: [{ ...at(0), count: 1 }] },
    { type: OcgMessageType.SELECT_SUM, player: 0, select_max: 0, amount: 4, min: 1, max: 1, selects_must: [], selects: [{ ...at(0), amount: 4 }] },
    { type: OcgMessageType.SORT_CARD, player: 0, cards: [at(0), at(1)] },
    { type: OcgMessageType.SORT_CHAIN, player: 0, cards: [at(0), at(1)] },
    { type: OcgMessageType.SELECT_DISFIELD, player: 0, count: 1, field_mask: ~1 >>> 0 },
  ];
  for (const question of questions) {
    const panel = renderToStaticMarkup(<>{screen(question).ui().panel}</>);
    expect(panel, String(question.type)).toContain("Laisser le jeu choisir");
    expect(panel, String(question.type)).not.toContain("pas encore d'écran");
  }
});

it("ANNOUNCE_NUMBER : envoie l'index de l'option choisie", () => {
  const { ui } = screen({ type: OcgMessageType.ANNOUNCE_NUMBER, player: 0, options: ["4", "7", "8"] });
  const actions = elements(ui().panel).find((element) => element.props.actions)?.props.actions;
  expect(actions?.map((action) => action.label)).toEqual(["4", "7", "8"]);
  expect(actions?.[1].response).toEqual({ type: OcgResponseType.ANNOUNCE_NUMBER, value: 1 });
});

it("ROCK_PAPER_SCISSORS : Pierre 2, Feuille 3, Ciseaux 1", () => {
  const { ui } = screen({ type: OcgMessageType.ROCK_PAPER_SCISSORS, player: 0 });
  const actions = elements(ui().panel).find((element) => element.props.actions)?.props.actions;
  expect(actions?.map((action) => [action.label, action.response])).toEqual([
    ["Pierre", { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 2 }],
    ["Feuille", { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 3 }],
    ["Ciseaux", { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 1 }],
  ]);
});

it("SELECT_COUNTER : répartit tous les compteurs, sans dépasser une carte ni le total", () => {
  const cards2 = [{ ...at(0), count: 2 }, { ...at(1), count: 3 }];
  const { sent, pick, click, button } = screen({ type: OcgMessageType.SELECT_COUNTER, player: 0, counter_type: 1, count: 3, cards: cards2 });
  const [a, b] = cards2.map(placeKey);
  pick(a);
  pick(a);
  // The first card holds 2: a third click takes nothing.
  pick(a);
  expect(button("Valider (2/3)").props.disabled).toBe(true);
  pick(b);
  // The total is reached: nothing more is taken.
  pick(b);
  expect(button("Valider (3/3)").props.disabled).toBe(false);
  click("Valider");
  expect(sent).toEqual([{ type: OcgResponseType.SELECT_COUNTER, counters: [2, 1] }]);
});

it("SELECT_COUNTER : un compteur repris se répartit autrement", () => {
  const cards2 = [{ ...at(0), count: 2 }, { ...at(1), count: 2 }];
  const { sent, pick, click } = screen({ type: OcgMessageType.SELECT_COUNTER, player: 0, counter_type: 1, count: 2, cards: cards2 });
  const [a, b] = cards2.map(placeKey);
  pick(a);
  pick(a);
  click("Reprendre un compteur");
  pick(b);
  click("Valider");
  expect(sent).toEqual([{ type: OcgResponseType.SELECT_COUNTER, counters: [1, 1] }]);
});

it("SELECT_COUNTER : moins de compteurs que demandé sur le plateau, tous sont pris", () => {
  const { sent, pick, click } = screen({ type: OcgMessageType.SELECT_COUNTER, player: 0, counter_type: 1, count: 5, cards: [{ ...at(0), count: 2 }] });
  pick(placeKey(at(0)));
  pick(placeKey(at(0)));
  click("Valider");
  expect(sent).toEqual([{ type: OcgResponseType.SELECT_COUNTER, counters: [2] }]);
});

const sum = (amount: number, amounts: number[], extra = {}) => ({
  type: OcgMessageType.SELECT_SUM,
  player: 0,
  select_max: 0,
  amount,
  min: 1,
  max: 3,
  selects_must: [],
  selects: amounts.map((value, sequence) => ({ ...at(sequence), amount: value })),
  ...extra,
});

it("SELECT_SUM : n'accepte que la somme exacte demandée", () => {
  const { sent, pick, click, button } = screen(sum(8, [4, 3, 5]));
  const keys = [0, 1, 2].map((sequence) => placeKey(at(sequence)));
  pick(keys[0]);
  pick(keys[1]);
  expect(button("Valider").props.disabled).toBe(true);
  pick(keys[0]);
  pick(keys[2]);
  expect(button("Valider").props.disabled).toBe(false);
  click("Valider");
  expect(sent).toEqual([{ type: OcgResponseType.SELECT_SUM, indicies: [1, 2] }]);
});

it("SELECT_SUM : une carte à deux niveaux compte pour l'un ou l'autre, une carte imposée compte déjà", () => {
  const two = screen(sum(6, [4, (6 << 16) | 1]));
  two.pick(placeKey(at(1)));
  expect(two.button("Valider").props.disabled).toBe(false);
  const must = screen(sum(9, [4, 3], { selects_must: [{ ...at(9), amount: 5 }] }));
  must.pick(placeKey(at(0)));
  expect(must.button("Valider").props.disabled).toBe(false);
  must.pick(placeKey(at(1)));
  expect(must.button("Valider").props.disabled).toBe(true);
});

it("SELECT_SUM : un Rituel veut au moins le niveau, sans carte en trop, et aucune limite de nombre", () => {
  const { pick, button } = screen(sum(8, [4, 5, 4], { select_max: 1, min: 0, max: 0 }));
  const keys = [0, 1, 2].map((sequence) => placeKey(at(sequence)));
  pick(keys[0]);
  expect(button("Valider").props.disabled).toBe(true);
  pick(keys[2]);
  expect(button("Valider").props.disabled).toBe(false);
  // 4 + 4 + 5 has a card to spare.
  pick(keys[1]);
  expect(button("Valider").props.disabled).toBe(true);
});

it("SORT_CARD et SORT_CHAIN : envoie le rang de chaque carte, une fois toutes ordonnées", () => {
  for (const type of [OcgMessageType.SORT_CARD, OcgMessageType.SORT_CHAIN]) {
    const list = [0, 1, 2].map((sequence) => at(sequence));
    const { sent, pick, click, button } = screen({ type, player: 0, cards: list });
    const keys = list.map(placeKey);
    pick(keys[2]);
    pick(keys[0]);
    expect(button("Valider").props.disabled).toBe(true);
    pick(keys[1]);
    click("Valider");
    expect(sent).toEqual([{ type: OcgResponseType.SORT_CARD, order: [1, 2, 0] }]);
  }
});

it("SELECT_DISFIELD : choisit les zones à désactiver parmi les zones libres", () => {
  const { sent, ui, pick } = screen({ type: OcgMessageType.SELECT_DISFIELD, player: 0, count: 2, field_mask: ~(0b11 << 1) >>> 0 });
  expect([...ui().targets]).toEqual([placeKey({ ...PLACE, sequence: 1 }), placeKey({ ...PLACE, sequence: 2 })]);
  pick(placeKey({ ...PLACE, sequence: 2 }));
  expect(sent).toEqual([]);
  pick(placeKey({ ...PLACE, sequence: 1 }));
  expect(sent).toEqual([
    {
      type: OcgResponseType.SELECT_DISFIELD,
      places: [
        { player: 0, location: MZONE, sequence: 2 },
        { player: 0, location: MZONE, sequence: 1 },
      ],
    },
  ]);
});
