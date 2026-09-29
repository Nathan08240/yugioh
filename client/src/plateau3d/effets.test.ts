import { OcgAttribute, OcgLocation, OcgMessageType, OcgPhase, OcgPosition, OcgType } from "@n1xx1/ocgcore-wasm";
import { expect, it, vi } from "vitest";
import type { CardInfo, ServerMessage, Wire } from "../../../server/src/protocol.ts";
import { newBoard, playAll, type Message } from "../board.ts";
import recorded from "../fixtures/duel.json";
import { createQueue } from "../motion.ts";
import { etapes, type Effet } from "./effets.ts";
import { jouer } from "./spectacle.ts";

const { HAND, MZONE, SZONE, GRAVE, EXTRA } = OcgLocation;
const { FACEUP_ATTACK, FACEDOWN_DEFENSE, FACEDOWN } = OcgPosition;
const KURIBOH = 40640057;
const SUMMONED_SKULL = 70781052;
const FLAME_SWORDSMAN = 45231177;
const OBELISK = 10000000;

const info = (type: number, attribute: number = OcgAttribute.DARK) => ({ type, attribute }) as CardInfo;
const cards = new Map([
  [KURIBOH, info(OcgType.MONSTER | OcgType.EFFECT)],
  [SUMMONED_SKULL, info(OcgType.MONSTER | OcgType.NORMAL)],
  [FLAME_SWORDSMAN, info(OcgType.MONSTER | OcgType.FUSION)],
  [OBELISK, info(OcgType.MONSTER | OcgType.EFFECT, OcgAttribute.DIVINE)],
]);
const at = (controller: 0 | 1, location: OcgLocation, sequence: number, position: OcgPosition = FACEUP_ATTACK) => ({ controller, location, sequence, position });
const move = (card: number, from: ReturnType<typeof at>, to: ReturnType<typeof at>): Message => ({ type: OcgMessageType.MOVE, card, from, to });
const summon = (type: OcgMessageType.SUMMONING | OcgMessageType.SPSUMMONING, code: number, sequence: number): Message => ({ type, code, controller: 0, location: MZONE, sequence, position: FACEUP_ATTACK });
const draw = (player: 0 | 1, codes: number[]): Message => ({ type: OcgMessageType.DRAW, player, drawn: codes.map((code) => ({ code, position: FACEDOWN })) });

const start = playAll(newBoard(4000, [40, 40], [1, 0]), [draw(0, [KURIBOH, SUMMONED_SKULL, OBELISK, KURIBOH]), draw(1, [0, 0, 0])]);
const onField = playAll(start, [move(KURIBOH, at(0, HAND, 0), at(0, MZONE, 0)), summon(OcgMessageType.SUMMONING, KURIBOH, 0)]);
const effects = (board = start, messages: Message[] = []) => etapes(board, messages, cards).map(({ avant, apres }) => [...avant, ...apres]);

it("pioche, puis invocation : la carte arrive sur sa zone et son hologramme se lève", () => {
  expect(effects(start, [draw(0, [1]), move(KURIBOH, at(0, HAND, 0), at(0, MZONE, 2)), summon(OcgMessageType.SUMMONING, KURIBOH, 2)])).toEqual([
    [{ type: "pioche", joueur: 0, nombre: 1 }],
    [{ type: "entree", cle: `0:${MZONE}:2`, joueur: 0 }],
    [{ type: "invocation", cle: `0:${MZONE}:2`, code: KURIBOH, genre: "normale" }],
  ]);
});

it("distingue un sacrifice, un matériau de fusion et une destruction d'après la suite des messages", () => {
  const tribute = [move(KURIBOH, at(0, MZONE, 0), at(0, GRAVE, 0)), move(SUMMONED_SKULL, at(0, HAND, 0), at(0, MZONE, 1)), summon(OcgMessageType.SUMMONING, SUMMONED_SKULL, 1)];
  expect(effects(onField, tribute)[0]).toEqual([{ type: "depart", cle: `0:${MZONE}:0`, genre: "sacrifice" }]);

  const fusion = [move(KURIBOH, at(0, MZONE, 0), at(0, GRAVE, 0)), move(FLAME_SWORDSMAN, at(0, EXTRA, 0), at(0, MZONE, 3)), summon(OcgMessageType.SPSUMMONING, FLAME_SWORDSMAN, 3)];
  const [material, , summoned] = effects(onField, fusion);
  expect(material).toEqual([{ type: "depart", cle: `0:${MZONE}:0`, genre: "materiau" }]);
  expect(summoned).toEqual([{ type: "invocation", cle: `0:${MZONE}:3`, code: FLAME_SWORDSMAN, genre: "fusion" }]);

  const battle: Message[] = [move(KURIBOH, at(0, MZONE, 0), at(0, GRAVE, 0)), { type: OcgMessageType.DAMAGE, player: 0, amount: 300 }];
  expect(effects(onField, battle)[0]).toEqual([{ type: "depart", cle: `0:${MZONE}:0`, genre: "destruction" }]);
});

it("joue l'attaque avant les dégâts, directe quand elle n'a pas de cible", () => {
  const attack: Message[] = [
    { type: OcgMessageType.ATTACK, card: at(0, MZONE, 0), target: null },
    { type: OcgMessageType.DAMAGE, player: 1, amount: 300 },
    { type: OcgMessageType.PAY_LPCOST, player: 0, amount: 1000 },
  ];
  const steps = etapes(onField, attack, cards);
  expect(steps[0].avant).toEqual([{ type: "attaque", de: `0:${MZONE}:0`, vers: undefined, joueur: 0 }]);
  expect(steps.slice(1).map((step) => step.apres)).toEqual([[{ type: "lp", joueur: 1, delta: -300, directe: true }], [{ type: "lp", joueur: 0, delta: -1000, directe: false }]]);
});

it("invoque un Dieu Égyptien, pose face cachée, enchaîne et change de tour", () => {
  const messages: Message[] = [
    move(OBELISK, at(0, HAND, 2), at(0, MZONE, 4)),
    summon(OcgMessageType.SUMMONING, OBELISK, 4),
    move(0, at(1, HAND, 0), at(1, SZONE, 1, FACEDOWN_DEFENSE)),
    { type: OcgMessageType.SET, code: 0, controller: 1, location: SZONE, sequence: 1, position: FACEDOWN_DEFENSE },
    { type: OcgMessageType.CHAINING, code: 5318639, controller: 1, location: SZONE, sequence: 1, position: FACEUP_ATTACK, triggering_controller: 1, triggering_location: SZONE, triggering_sequence: 1, description: "0", chain_size: 1 },
    { type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 },
    { type: OcgMessageType.NEW_TURN, player: 1 },
    { type: OcgMessageType.NEW_PHASE, phase: OcgPhase.DRAW },
  ];
  expect(effects(start, messages).slice(1)).toEqual([
    [{ type: "invocation", cle: `0:${MZONE}:4`, code: OBELISK, genre: "dieu" }],
    [{ type: "entree", cle: `1:${SZONE}:1`, joueur: 1 }],
    [{ type: "pose", cle: `1:${SZONE}:1` }],
    [{ type: "activation", cle: `1:${SZONE}:1`, maillon: 1, joueur: 1 }],
    [{ type: "resolution", maillon: 1, annule: false }],
    [{ type: "tour", joueur: 1, tour: 1 }],
    [{ type: "phase", phase: OcgPhase.DRAW, joueur: 1 }],
  ]);
});

type Fixture = { lp: number; decks: [number, number]; received: Wire<ServerMessage>[] };

it("rejoue un duel réel étape par étape jusqu'au même plateau, avec invocations, attaques et dégâts", () => {
  const { lp, decks, received } = recorded as unknown as Fixture;
  let board = newBoard(lp, decks);
  let shown = board;
  const seen = new Set<Effet["type"]>();
  for (const msg of received) {
    if (msg.type !== "messages") continue;
    for (const step of etapes(board, msg.messages, cards)) {
      shown = playAll(shown, [...step.prelude, ...(step.message ? [step.message] : [])]);
      for (const effet of [...step.avant, ...step.apres]) seen.add(effet.type);
    }
    board = playAll(board, msg.messages);
    expect(shown).toEqual(board);
  }
  expect([...seen]).toEqual(expect.arrayContaining(["pioche", "entree", "invocation", "attaque", "lp", "depart", "phase", "tour"]));
});

it("applique chaque message quand son animation l'atteint, dans l'ordre de la file", async () => {
  vi.useFakeTimers();
  const log: string[] = [];
  const queue = createQueue(() => false);
  const steps = etapes(onField, [{ type: OcgMessageType.NEW_PHASE, phase: OcgPhase.BATTLE_START }, { type: OcgMessageType.ATTACK, card: at(0, MZONE, 0), target: null }, { type: OcgMessageType.DAMAGE, player: 1, amount: 300 }], cards);
  const hold = (name: string) => async (effet: Effet, jeu: { tenir: (ms: number) => Promise<void> }) => {
    log.push(`${name} ${effet.type}`);
    await jeu.tenir(500);
  };
  let waiting = false;
  const done = jouer(steps, (messages) => log.push(`applique ${messages.map((msg) => msg.type).join(",")}`), { scene: hold("3d"), hud: hold("hud") }, () => waiting, () => log.push("fin"), queue);
  await vi.advanceTimersByTimeAsync(0);
  expect(log).toEqual([`applique ${OcgMessageType.NEW_PHASE}`, "3d phase", "hud phase"]);
  // A question waiting cuts the decorative holds.
  waiting = true;
  await vi.advanceTimersByTimeAsync(500);
  await done;
  expect(log.slice(3)).toEqual(["3d attaque", "hud attaque", `applique ${OcgMessageType.ATTACK}`, `applique ${OcgMessageType.DAMAGE}`, "3d lp", "hud lp", "fin"]);
  vi.useRealTimers();
});
