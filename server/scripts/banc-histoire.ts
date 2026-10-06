// Banc bot contre bot de l'histoire : `pnpm --filter server banc-histoire [parties [filtre|croise [normal]]]` (100 parties, graines 1 à N).
// Taux de victoire d'un deck joueur type (bot Normal) par duel, normal et facile ; `filtre` : arcs ou bouts d'id ; `croise` : niveaux de bot.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Bot } from "../src/bot.ts";
import { runDuel, STANDARD_RULES, type Player, type Rules, type Seed } from "../src/duel.ts";
import type { BotLevel } from "../src/protocol.ts";
import { starterCards } from "../src/starter.ts";
import { playerDeck, STORY, STORY_REVENGES, storyDeck, storyExtra, storyRules, type StoryDuel } from "../src/story.ts";

export type Side = { name: string; main: readonly number[]; extra: readonly number[]; level: BotLevel };
export type Tally = { wins: number; losses: number; draws: number };

type Cards = [code: number, copies: number, name: string][];
const SUGGESTED: { id: string; main: Cards; extra: Cards }[] = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "suggested-decks.json"), "utf-8"));
const expand = (cards: Cards) => cards.flatMap(([code, copies]) => Array<number>(copies).fill(code));
const suggested = (id: string) => {
  const deck = SUGGESTED.find((candidate) => candidate.id === id);
  if (!deck) throw new Error(`deck suggéré introuvable : ${id}`);
  return { main: expand(deck.main), extra: expand(deck.extra) };
};

// Deck joueur type : le starter Yugi (50 cartes) au Royaume des Duellistes, puis le deck suggéré « yugi » (40 cartes, un deck
// complet des sets du jeu, ce que les boosters et les récompenses permettent de monter dès Battle City) ; le parcours de
// Kaiba impose le deck du duel.
const STARTER = { name: "Starter Yugi", main: starterCards("yugi"), extra: [] };
const SUGGESTED_YUGI = { name: "Deck suggéré Yugi", ...suggested("yugi") };
const STARTER_ARCS: ReadonlySet<string> = new Set(["duelist-kingdom"]);
const typicalDeck = (arc: string) => (STARTER_ARCS.has(arc) ? STARTER : SUGGESTED_YUGI);

export type Entry = { id: string; arc: string; opponent: string; level: BotLevel; revenge: boolean; duel: StoryDuel; player: Omit<Side, "level"> };

// Les duels dans l'ordre de l'histoire, la revanche d'un arc après son dernier duel.
export function entries(): Entry[] {
  return STORY.arcs.flatMap((arc) => {
    const list = arc.duels.map((duel): Entry => ({ id: duel.id, arc: arc.id, opponent: duel.opponent, level: "normal", revenge: false, duel, player: imposed(duel) ?? typicalDeck(arc.id) }));
    const revenge = arc.revenge && STORY_REVENGES.get(arc.revenge.boss)?.duel;
    if (revenge) list.push({ id: `${arc.revenge?.boss}+revanche`, arc: arc.id, opponent: revenge.opponent, level: "expert", revenge: true, duel: revenge, player: typicalDeck(arc.id) });
    return list;
  });
}

function imposed(duel: StoryDuel) {
  const deck = playerDeck(duel);
  return deck && { name: `${duel.player?.name} (imposé)`, main: deck.main, extra: deck.extra };
}

// Hasard du bot Débutant, reproductible.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Les tailles de deck que le serveur donne au bot : les cartes de règle spéciale sont dans le deck du joueur 0.
function bot(seat: 0 | 1, rules: Rules, [first, second]: readonly [Side, Side], seedNumber: number): Player {
  const own = new Bot(seat, seat === 0 ? (rules.playerLp ?? rules.lp) : rules.lp, [first.main.length + rules.cards.length, second.main.length], 0, [first.extra.length, second.extra.length], (seat === 0 ? first : second).level, seeded(seedNumber * 2 + seat));
  return (question, log) => own.answer(question, log);
}

// `first` au siège 0, `second` au siège 1, sur les graines 1 à `count` : le bilan vu de `first`.
export async function play(count: number, first: Side, second: Side, rules: Rules = STANDARD_RULES): Promise<Tally> {
  const tally: Tally = { wins: 0, losses: 0, draws: 0 };
  for (let i = 1; i <= count; i++) {
    const seed: Seed = [BigInt(i), 2n, 3n, 4n];
    const sides = [first, second] as const;
    const { winner } = await runDuel(seed, MAX_TURNS, [bot(0, rules, sides, i), bot(1, rules, sides, i)], [first.main, second.main], rules, [first.extra, second.extra]);
    if (winner === 0) tally.wins++;
    else if (winner === 1) tally.losses++;
    else tally.draws++;
  }
  return tally;
}

// Au-delà, le duel est compté sans vainqueur.
const MAX_TURNS = 200;

// Bilan d'un duel d'histoire du point de vue du joueur type.
export function story(entry: Entry, count: number, easy = false): Promise<Tally> {
  const rules = storyRules(entry.duel, easy ? "facile" : "normal");
  const player: Side = { ...entry.player, level: "normal" };
  const opponent: Side = { name: entry.opponent, main: storyDeck(entry.duel), extra: storyExtra(entry.duel), level: entry.level };
  return play(count, player, opponent, rules);
}

const percent = ({ wins, losses, draws }: Tally) => {
  const rate = `${Math.round((wins / (wins + losses + draws)) * 100)} %`;
  return draws > 0 ? `${rate} (${draws} nuls)` : rate;
};
const cell = (text: string, width: number) => text.padEnd(width);

async function bench(count: number, filter: string, normalOnly: boolean) {
  const filters = filter.split(",").filter(Boolean);
  const selected = entries().filter((entry) => filters.length === 0 || filters.some((part) => entry.arc === part || entry.id.includes(part)));
  console.log(`${cell("duel", 26)}${cell("adversaire", 32)}${cell("niveau", 8)}${cell("deck joueur", 28)}${cell("normal", 14)}facile`);
  for (const entry of selected) {
    const normal = await story(entry, count);
    const easy = entry.revenge || normalOnly ? "-" : percent(await story(entry, count, true));
    console.log(`${cell(entry.id, 26)}${cell(entry.opponent, 32)}${cell(entry.level, 8)}${cell(entry.player.name, 28)}${cell(percent(normal), 14)}${easy}`);
  }
}

const LEVELS: BotLevel[] = ["debutant", "normal", "expert"];

// Taux de victoire de la ligne contre la colonne : starter Yugi contre starter Kaiba, chaque niveau jouant chaque deck et chaque siège.
async function crossed(count: number) {
  const half = Math.ceil(count / 2);
  const decks = [{ name: "Starter Yugi", main: starterCards("yugi"), extra: [] }, { name: "Starter Kaiba", main: starterCards("kaiba"), extra: [] }];
  console.log(`taux de victoire de la ligne contre la colonne (${half * 4} duels par case)`);
  console.log(cell("", 10) + LEVELS.map((level) => cell(level, 10)).join(""));
  for (const row of LEVELS) {
    let line = cell(row, 10);
    for (const column of LEVELS) line += cell(percent(await matchup(half, decks, row, column)), 10);
    console.log(line);
  }
}

// Le niveau `row` contre `column`, chacun jouant chaque deck des deux sièges.
async function matchup(half: number, decks: Pick<Side, "name" | "main" | "extra">[], row: BotLevel, column: BotLevel): Promise<Tally> {
  const total: Tally = { wins: 0, losses: 0, draws: 0 };
  for (const [mine, theirs] of [decks, [decks[1], decks[0]]]) {
    const a: Side = { ...mine, level: row };
    const b: Side = { ...theirs, level: column };
    for (const { wins, losses, draws } of [await play(half, a, b), invert(await play(half, b, a))]) {
      total.wins += wins;
      total.losses += losses;
      total.draws += draws;
    }
  }
  return total;
}

const invert = ({ wins, losses, draws }: Tally): Tally => ({ wins: losses, losses: wins, draws });

if (import.meta.main) {
  const [count = "100", filter = "", mode = ""] = process.argv.slice(2);
  if (filter === "croise") await crossed(Number(count));
  else await bench(Number(count), filter, mode === "normal");
}
