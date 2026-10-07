import { OcgType } from "@n1xx1/ocgcore-wasm";
import keyCards from "../../server/data/key-cards.json";
import { COPIES_MAX, countBy, EXTRA_MAX, MAIN_MIN, sameCard, type DeckDraft, type Limits } from "../../server/src/deckcheck.ts";
import type { CardInfo } from "../../server/src/protocol.ts";
import { has, type Cards } from "./cards.ts";
import { kindOf } from "./collection.ts";
import { fitSuggestion, type Suggestion } from "./deckTools.ts";
import { byOriginal, isExtraDeck, summonableFrom } from "./extraDeck.ts";

// Key cards of the Goat era in the pool (server/data/key-cards.json): [passcode, tier 1 to 3, copies to play, French name].
type Key = [code: number, tier: number, copies: number, name: string];
export const KEY_CARDS = (keyCards as Key[]).toSorted((a, b) => a[1] - b[1]);

// Shape of a built main deck of MAIN_MIN cards; a category short of cards leaves its slots to the others.
const TARGET = { monster: 18, spell: 12, trap: 10 };
const TRIBUTES_MAX = 4;
const HIGH_MAX = 2; // Level 7 or more: two tributes.
const SUPPORT_COPIES = 2;
const SUPPORT_MIN = 6; // Monsters of the deck a Field or Equip spell must boost.
const THEME_MIN = 10; // Monsters of the pool a theme needs.
// Never picked by the builder: fusions go to the Extra Deck, rituals need their spell, the others a special summon.
const UNPLAYABLE = OcgType.FUSION | OcgType.RITUAL | OcgType.SPSUMMON | OcgType.TOKEN;

// A monster Type (race) or Attribute, with its French label.
export type Theme = { kind: "race" | "attribute"; value: number; label: string };
export type Style = { theme?: Theme; base?: Pick<Suggestion, "main" | "extra"> };
export type Built = { main: number[]; extra: number[]; levels: [level: number, count: number][]; keys: number[]; missing: number[] };

const raceLabel = (card: CardInfo) => card.typeLine.split(" / ")[0];
const isMonster = (card: CardInfo) => kindOf(card.type) === "monster";
const inTheme = (card: CardInfo, theme: Theme) => card[theme.kind] === theme.value;
// Spells, traps and any card without a theme fit; a monster must be of the theme.
const fitsTheme = (card: CardInfo, theme?: Theme) => !theme || !isMonster(card) || inTheme(card, theme);

function tributes(level: number): number {
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}

// Generic value of a monster: its stats ("?" counts 0), an effect, minus its tribute cost.
export function power(card: CardInfo): number {
  const effect = has(card.type, OcgType.EFFECT) ? 200 : 0;
  return Math.max(card.atk, 0) + Math.max(card.def, 0) / 4 + effect - 600 * tributes(card.level);
}

// Themes of the pool: Attributes in engine order, then Types by name.
export function themes(cards: Cards): Theme[] {
  const monsters = [...cards.values()].filter((card) => isMonster(card) && !has(card.type, UNPLAYABLE));
  const of = (kind: Theme["kind"], label: (card: CardInfo) => string) =>
    [...countBy(monsters.map((card) => card[kind]))]
      .filter(([, count]) => count >= THEME_MIN)
      .map(([value]): Theme => ({ kind, value, label: label(monsters.find((card) => card[kind] === value) as CardInfo) }));
  const attributes = of("attribute", (card) => card.attributeName).sort((a, b) => a.value - b.value);
  return [...attributes, ...of("race", raceLabel).sort((a, b) => a.label.localeCompare(b.label))];
}

const GAIN = ["gagn", "augment"];
const LOSS = ["perd", "diminu"];

// Types and Attributes a Field or Equip spell boosts, from its French text, longest label first ("Bête-Guerrier" before "Bête").
// ponytail: text heuristic (a weakening-only sentence and the part after "et aussi" are skipped), a curated list if one is misread.
function boosted(card: CardInfo, labels: readonly string[]): Set<string> {
  const found = new Set<string>();
  const lower = card.desc.toLowerCase();
  if (!has(card.type, OcgType.FIELD | OcgType.EQUIP) || !GAIN.some((word) => lower.includes(word))) return found;
  for (const sentence of card.desc.split(". ")) {
    const words = sentence.toLowerCase();
    if (!GAIN.some((word) => words.includes(word)) && LOSS.some((word) => words.includes(word))) continue;
    let text = sentence.split("et aussi")[0];
    for (const label of labels) {
      if (text.includes(label)) {
        found.add(label);
        text = text.replaceAll(label, "|");
      }
    }
  }
  return found;
}

const monsters = (cards: Cards, codes: number[]) => codes.map((code) => cards.get(code)).filter((card): card is CardInfo => card !== undefined && isMonster(card));

// Owned cards only, deterministic: kept cards, the base deck, tier 1 keys, key monsters, monsters by power (theme first),
// Field and Equip spells boosting them, other keys, other spells and traps, then anything owned. Short when too few cards.
// `limits`: copies allowed per card (the Goat list), COPIES_MAX for the others.
export function buildDeck(cards: Cards, owned: ReadonlyMap<number, number>, style: Style = {}, keep: Pick<DeckDraft, "main" | "extra"> = { main: [], extra: [] }, limits?: Limits): Built {
  const { theme } = style;
  const main: number[] = [];
  const used = new Map<number, number>();
  const copies = new Map<number, number>();
  const card = (code: number) => cards.get(code);
  const info = (code: number) => cards.get(code) as CardInfo;
  const key = (code: number) => {
    const found = card(code);
    return found ? sameCard(code, found) : code;
  };
  const count = (map: Map<number, number>, code: number) => map.get(code) ?? 0;
  const record = (code: number) => {
    used.set(code, count(used, code) + 1);
    copies.set(key(code), count(copies, key(code)) + 1);
  };
  const add = (code: number) => {
    main.push(code);
    record(code);
  };
  const left = (code: number) => Math.min((owned.get(code) ?? 0) - count(used, code), (limits?.get(key(code)) ?? COPIES_MAX) - count(copies, key(code)));

  const fits = (code: number, capped: boolean) => {
    const found = card(code);
    if (!found || main.length >= MAIN_MIN || left(code) <= 0) return false;
    const kind = kindOf(found.type);
    if (capped && main.filter((other) => kindOf(card(other)?.type ?? 0) === kind).length >= TARGET[kind]) return false;
    const cost = tributes(found.level);
    if (kind !== "monster" || cost === 0) return true;
    const costs = monsters(cards, main).map((monster) => tributes(monster.level));
    return costs.filter(Boolean).length < TRIBUTES_MAX && (cost < 2 || costs.filter((value) => value === 2).length < HIGH_MAX);
  };
  const take = (code: number, wanted: number, capped = true) => {
    for (let added = 0; added < wanted && fits(code, capped); added++) add(code);
  };

  keep.main.forEach(add);
  for (const code of keep.extra) record(code);
  for (const code of style.base ? fitSuggestion(style.base, card, owned).main : []) {
    if (main.length < MAIN_MIN && left(code) > 0) add(code);
  }

  const takeKeys = (wanted: (tier: number, card: CardInfo) => boolean) => {
    for (const [code, tier, copies] of KEY_CARDS) {
      const found = card(code);
      if (found && fitsTheme(found, theme) && wanted(tier, found)) take(code, copies - count(used, code));
    }
  };
  takeKeys((tier) => tier === 1);
  takeKeys((_, found) => isMonster(found));

  const playable = [...owned.keys()].filter((code) => {
    const found = card(code);
    return found !== undefined && !has(found.type, UNPLAYABLE);
  });
  const score = (code: number) => (theme && inTheme(info(code), theme) ? 1e5 : 0) + power(info(code));
  const byPower = playable.filter((code) => isMonster(info(code))).sort((a, b) => score(b) - score(a) || a - b);
  for (const code of byPower) take(code, COPIES_MAX);

  const labels = [...new Set(monsters(cards, [...cards.keys()]).flatMap((monster) => [raceLabel(monster), monster.attributeName]))].sort((a, b) => b.length - a.length);
  const spells = playable.filter((code) => !isMonster(info(code)));
  const boosts = new Map(spells.map((code) => [code, boosted(info(code), labels)]));
  const helped = (code: number) => {
    const boost = boosts.get(code) ?? new Set();
    return monsters(cards, main).filter((monster) => boost.has(raceLabel(monster)) || boost.has(monster.attributeName)).length;
  };
  const support = spells.filter((code) => helped(code) >= SUPPORT_MIN).sort((a, b) => helped(b) - helped(a) || a - b);
  for (const code of support) take(code, SUPPORT_COPIES - count(used, code));
  takeKeys(() => true);

  // Spells and traps boosting no Type: the most owned first, one copy each before the next ones.
  const others = spells.filter((code) => boosts.get(code)?.size === 0).sort((a, b) => (owned.get(b) ?? 0) - (owned.get(a) ?? 0) || a - b);
  for (const limit of [1, COPIES_MAX]) for (const code of others) take(code, limit - count(used, code));
  for (const code of [...byPower, ...spells]) take(code, COPIES_MAX, false);

  return { main, extra: extraDeck(cards, main, keep.extra, owned, used), ...report(cards, main, owned, theme) };
}

// The kept Extra Deck monsters, then each owned one whose materials and Polymerization are in the main deck, highest ATK first.
function extraDeck(cards: Cards, main: number[], kept: number[], owned: ReadonlyMap<number, number>, used: ReadonlyMap<number, number>): number[] {
  const extra = [...kept];
  const inMain = byOriginal(countBy(main), cards);
  const atk = (code: number) => cards.get(code)?.atk ?? 0;
  const fusions = [...owned.keys()].filter((code) => {
    const card = cards.get(code);
    return card !== undefined && isExtraDeck(card) && (owned.get(code) ?? 0) > (used.get(code) ?? 0) && !extra.includes(code) && summonableFrom(card, inMain);
  });
  for (const code of fusions.sort((a, b) => atk(b) - atk(a) || a - b)) if (extra.length < EXTRA_MAX) extra.push(code);
  return extra;
}

// Monsters by level (highest first), key cards included, and the key cards of tier 1 or 2 the player does not own.
function report(cards: Cards, main: number[], owned: ReadonlyMap<number, number>, theme?: Theme): Pick<Built, "levels" | "keys" | "missing"> {
  const inDeck = new Set(main);
  const fitsCode = (code: number) => {
    const card = cards.get(code);
    return card !== undefined && fitsTheme(card, theme);
  };
  return {
    levels: [...countBy(monsters(cards, main).map((card) => card.level))].sort(([a], [b]) => b - a),
    keys: KEY_CARDS.map(([code]) => code).filter((code) => inDeck.has(code)),
    missing: KEY_CARDS.filter(([code, tier]) => tier <= 2 && !owned.get(code) && fitsCode(code)).map(([code]) => code),
  };
}
