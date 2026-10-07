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
  [KURIBOH, { ...info(OcgType.MONSTER | OcgType.EFFECT), atk: 300, def: 200 }],
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
// Only the steps that play something (the others just apply their messages).
const played = (board: typeof start, messages: Message[]) => effects(board, messages).filter((list) => list.length > 0);

it("pioche, puis invocation : la carte arrive sur sa zone et son hologramme se lève", () => {
  expect(effects(start, [draw(0, [1]), move(KURIBOH, at(0, HAND, 0), at(0, MZONE, 2)), summon(OcgMessageType.SUMMONING, KURIBOH, 2)])).toEqual([
    [{ type: "pioche", joueur: 0, nombre: 1 }],
    [{ type: "entree", cle: `0:${MZONE}:2`, joueur: 0 }],
    [{ type: "invocation", cle: `0:${MZONE}:2`, code: KURIBOH, genre: "normale" }],
  ]);
});

it("distingue un sacrifice, un matériau de fusion et une destruction d'après la suite des messages", () => {
  const tribute = [move(KURIBOH, at(0, MZONE, 0), at(0, GRAVE, 0)), move(SUMMONED_SKULL, at(0, HAND, 0), at(0, MZONE, 1)), summon(OcgMessageType.SUMMONING, SUMMONED_SKULL, 1)];
  // The tribute's light and the material's swirl go to the zone of the monster summoned.
  expect(effects(onField, tribute)[0]).toEqual([{ type: "depart", cle: `0:${MZONE}:0`, genre: "sacrifice", vers: `0:${MZONE}:1` }]);

  const fusion = [move(KURIBOH, at(0, MZONE, 0), at(0, GRAVE, 0)), move(FLAME_SWORDSMAN, at(0, EXTRA, 0), at(0, MZONE, 3)), summon(OcgMessageType.SPSUMMONING, FLAME_SWORDSMAN, 3)];
  const [material, entered, summoned] = effects(onField, fusion);
  expect(material).toEqual([{ type: "depart", cle: `0:${MZONE}:0`, genre: "materiau", vers: `0:${MZONE}:3` }]);
  expect(entered).toEqual([{ type: "entree", cle: `0:${MZONE}:3`, joueur: 0, depuis: `0:${EXTRA}` }]);
  expect(summoned).toEqual([{ type: "invocation", cle: `0:${MZONE}:3`, code: FLAME_SWORDSMAN, genre: "fusion" }]);

  const battle: Message[] = [move(KURIBOH, at(0, MZONE, 0), at(0, GRAVE, 0)), { type: OcgMessageType.DAMAGE, player: 0, amount: 300 }];
  expect(effects(onField, battle)[0]).toEqual([{ type: "depart", cle: `0:${MZONE}:0`, genre: "destruction" }]);
});

it("prend pour un sacrifice un monstre envoyé seul au Cimetière en Main Phase hors chaîne (l'invocation suit après le choix de la zone)", () => {
  const phase = (p: OcgPhase) => playAll(onField, [{ type: OcgMessageType.NEW_PHASE, phase: p }]);
  const tribute = [move(KURIBOH, at(0, MZONE, 0), at(0, GRAVE, 0))];
  expect(played(phase(OcgPhase.MAIN1), tribute)).toEqual([[{ type: "depart", cle: `0:${MZONE}:0`, genre: "sacrifice" }]]);
  expect(played(phase(OcgPhase.MAIN2), tribute)[0][0]).toMatchObject({ genre: "sacrifice" });
  // Destroyed by an effect while a chain resolves, or by battle.
  const chaining: Message = { type: OcgMessageType.CHAINING, code: 5318639, controller: 1, location: SZONE, sequence: 1, position: FACEUP_ATTACK, triggering_controller: 1, triggering_location: SZONE, triggering_sequence: 1, description: "0", chain_size: 1 };
  expect(played(playAll(phase(OcgPhase.MAIN1), [chaining]), tribute)[0][0]).toMatchObject({ genre: "destruction" });
  expect(played(phase(OcgPhase.DAMAGE), tribute)[0][0]).toMatchObject({ genre: "destruction" });
});

it("distingue un bannissement et un retour en main, au Deck ou à l'Extra Deck d'une destruction", () => {
  const leaves = (to: ReturnType<typeof at>) => played(onField, [move(KURIBOH, at(0, MZONE, 0), to)]);
  expect(leaves(at(0, OcgLocation.REMOVED, 0))).toEqual([[{ type: "depart", cle: `0:${MZONE}:0`, genre: "bannissement" }]]);
  expect(leaves(at(0, HAND, 0))).toEqual([[{ type: "depart", cle: `0:${MZONE}:0`, genre: "main" }]]);
  expect(leaves(at(0, OcgLocation.DECK, 0))).toEqual([[{ type: "depart", cle: `0:${MZONE}:0`, genre: "deck" }]]);
  expect(leaves(at(0, EXTRA, 0))).toEqual([[{ type: "depart", cle: `0:${MZONE}:0`, genre: "extra" }]]);
  // A card banished from the Graveyard leaves no zone of the field.
  const grave = playAll(onField, [move(KURIBOH, at(0, MZONE, 0), at(0, GRAVE, 0))]);
  expect(played(grave, [move(KURIBOH, at(0, GRAVE, 0), at(0, OcgLocation.REMOVED, 0))])).toEqual([]);
});

it("annonce un gain, un paiement et une mise à jour des LP pour le joueur concerné", () => {
  const messages: Message[] = [
    { type: OcgMessageType.RECOVER, player: 1, amount: 500 },
    { type: OcgMessageType.PAY_LPCOST, player: 0, amount: 1000 },
    { type: OcgMessageType.LPUPDATE, player: 0, lp: 2500 },
    { type: OcgMessageType.LPUPDATE, player: 1, lp: 4500 },
  ];
  expect(played(start, messages)).toEqual([
    [{ type: "lp", joueur: 1, delta: 500, directe: false }],
    [{ type: "lp", joueur: 0, delta: -1000, directe: false }],
    [{ type: "lp", joueur: 0, delta: -500, directe: false }],
  ]);
});

it("signale les monstres dont l'ATK ou la DEF ont changé, contre la valeur affichée ou imprimée", () => {
  const stats = (atk: number, def: number): Message => ({ type: "stats", monsters: [[{ atk, def }, null, null, null, null], [null, null, null, null, null]] });
  const key = `0:${MZONE}:0`;
  // Nothing shown yet: compared with the printed 300/200.
  expect(played(onField, [stats(300, 200)])).toEqual([]);
  expect(played(onField, [stats(800, 200)])).toEqual([[{ type: "stats", cartes: [{ cle: key, atk: 500, def: 0 }] }]]);
  const boosted = playAll(onField, [stats(800, 200)]);
  expect(played(boosted, [stats(800, 200)])).toEqual([]);
  expect(played(boosted, [stats(300, 100)])).toEqual([[{ type: "stats", cartes: [{ cle: key, atk: -500, def: -100 }] }]]);
});

it("fait sauter les zones des cartes posées que le moteur mélange", () => {
  const place = (sequence: number) => at(0, MZONE, sequence, FACEDOWN_DEFENSE);
  const shuffle: Message = { type: OcgMessageType.SHUFFLE_SET_CARD, location: MZONE, cards: [{ from: place(0), to: place(0) }, { from: place(2), to: place(2) }] };
  expect(played(onField, [shuffle])).toEqual([[{ type: "melange", cles: [`0:${MZONE}:0`, `0:${MZONE}:2`] }]]);
});

it("montre un lancer de dé ou de pièce avant d'inscrire son résultat, avec tous les résultats", () => {
  const dice: Message = { type: OcgMessageType.TOSS_DICE, player: 1, results: [2, 5] };
  const coin: Message = { type: OcgMessageType.TOSS_COIN, player: 0, results: [true] };
  const [first, second] = etapes(start, [dice, coin], cards);
  expect(first).toMatchObject({ avant: [{ type: "de", joueur: 1, resultats: [2, 5] }], message: dice, apres: [] });
  expect(second).toMatchObject({ avant: [{ type: "piece", joueur: 0, resultats: [true] }], message: coin, apres: [] });
});

it("joue l'attaque avant les dégâts, directe quand elle n'a pas de cible", () => {
  const attack: Message[] = [
    { type: OcgMessageType.ATTACK, card: at(0, MZONE, 0), target: null },
    { type: OcgMessageType.DAMAGE, player: 1, amount: 300 },
    { type: OcgMessageType.PAY_LPCOST, player: 0, amount: 1000 },
  ];
  const steps = etapes(onField, attack, cards);
  expect(steps[0].avant).toEqual([{ type: "attaque", de: `0:${MZONE}:0`, vers: undefined, joueur: 0 }]);
  // Damage shakes the camera, a cost does not.
  expect(steps.slice(1).map((step) => step.apres)).toEqual([[{ type: "lp", joueur: 1, delta: -300, directe: true, choc: true }], [{ type: "lp", joueur: 0, delta: -1000, directe: false }]]);
});

it("joue la charge et l'impact au calcul des dégâts, avec les dégâts du combat", () => {
  const battle = (target: { position: OcgPosition; attack: number; defense: number } | null): Message => ({
    type: OcgMessageType.BATTLE,
    card: { ...at(0, MZONE, 0), attack: 1500, defense: 1000, destroyed: false },
    target: target && { ...at(1, MZONE, 2, target.position), ...target, destroyed: false },
  });
  const combat = (target: Parameters<typeof battle>[0]) => etapes(onField, [battle(target)], cards)[0].avant;
  expect(combat({ position: FACEUP_ATTACK, attack: 1200, defense: 800 })).toEqual([{ type: "combat", de: `0:${MZONE}:0`, vers: `1:${MZONE}:2`, joueur: 0, degats: 300 }]);
  // Against a Defense Position monster, only a higher DEF deals damage (to the attacker).
  expect(combat({ position: OcgPosition.FACEUP_DEFENSE, attack: 0, defense: 2000 })[0]).toMatchObject({ degats: 500 });
  expect(combat({ position: FACEDOWN_DEFENSE, attack: 0, defense: 1000 })[0]).toMatchObject({ degats: 0 });
  expect(combat(null)).toEqual([{ type: "combat", de: `0:${MZONE}:0`, vers: undefined, joueur: 0, degats: 1500 }]);
  // The damage that follows in the same batch is that of a direct attack.
  expect(played(onField, [battle(null), { type: OcgMessageType.DAMAGE, player: 1, amount: 1500 }])[1]).toEqual([{ type: "lp", joueur: 1, delta: -1500, directe: true, choc: true }]);
});

it("fait partir une carte revenue sur le terrain de sa pile, les bannies du Cimetière", () => {
  const enters = (from: ReturnType<typeof at>) => played(start, [move(KURIBOH, from, at(0, MZONE, 1))])[0];
  expect(enters(at(0, GRAVE, 0))).toEqual([{ type: "entree", cle: `0:${MZONE}:1`, joueur: 0, depuis: `0:${GRAVE}` }]);
  expect(enters(at(0, OcgLocation.REMOVED, 0))).toEqual([{ type: "entree", cle: `0:${MZONE}:1`, joueur: 0, depuis: `0:${GRAVE}` }]);
  expect(enters(at(0, HAND, 0))[0]).toMatchObject({ depuis: undefined });
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
  expect([...seen]).toEqual(expect.arrayContaining(["pioche", "entree", "invocation", "attaque", "combat", "lp", "depart", "phase", "tour", "activation"]));
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
  const done = jouer(steps, (messages) => log.push(`applique ${messages.map((msg) => msg.type).join(",")}`), { scene: hold("3d"), hud: hold("hud"), son: (effet) => log.push(`son ${effet.type}`) }, () => waiting, () => log.push("fin"), queue);
  await vi.advanceTimersByTimeAsync(0);
  expect(log).toEqual([`applique ${OcgMessageType.NEW_PHASE}`, "son phase", "3d phase", "hud phase"]);
  // A question waiting cuts the decorative holds.
  waiting = true;
  await vi.advanceTimersByTimeAsync(500);
  await done;
  expect(log.slice(4)).toEqual(["son attaque", "3d attaque", "hud attaque", `applique ${OcgMessageType.ATTACK}`, `applique ${OcgMessageType.DAMAGE}`, "son lp", "3d lp", "hud lp", "fin"]);
  vi.useRealTimers();
});
