import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OcgType } from "@n1xx1/ocgcore-wasm";
import { creditBoosters } from "./boosters.ts";
import { readCard } from "./cards.ts";
import type { Db } from "./db.ts";
import type { Rules } from "./duel.ts";
import { isAllowed } from "./pool.ts";
import type { Rewards, StoryArcView, StoryStatus } from "./protocol.ts";

// Format of each data/story/*.json file, version STORY_VERSION. Texts are short summaries written by us, never anime dialogue.
export type StoryDuel = {
  id: string;
  title: string;
  opponent: string;
  // [passcode, copies], main deck only.
  deck: [code: number, copies: number][];
  // `special`: names from EXTRA_RULES.
  rules: { lp: number; hand: number; special?: string[] };
  intro: string;
  outro: string;
  // Reward cards must be in the pool, each one given by a single duel of the story.
  rewards: Rewards;
  // Ids of duels placed before this one, or of earlier arcs, met once every duel of the arc is won.
  requires: string[];
};
export type Arc = { id: string; title: string; duels: StoryDuel[] };
// `anime`: unofficial cards the opponents may play, outside the pool.
export type Story = { version: number; anime: number[]; arcs: Arc[] };

export const STORY_VERSION = 1;
const MAX_TEXT = 600;

// EDOPro Extra Rules of the series, whose CardScripts/unofficial scripts call aux.EnableExtraRules. An arc uses one
// only once a full duel against the bot goes through with it.
export const EXTRA_RULES: ReadonlyMap<string, number> = new Map([
  ["duelist-kingdom", 511002621],
  ["battle-city", 511004014],
  ["virtual-world", 153999999],
]);

function checkDeck(deck: StoryDuel["deck"], anime: ReadonlySet<number>): string[] {
  const errors: string[] = [];
  const size = deck.reduce((sum, [, copies]) => sum + copies, 0);
  if (size < 40 || size > 60) errors.push(`deck de ${size} cartes, 40 à 60 attendues`);
  if (new Set(deck.map(([code]) => code)).size !== deck.length) errors.push("carte listée deux fois dans le deck");
  for (const [code, copies] of deck) {
    const card = readCard(code);
    if (!Number.isInteger(copies) || copies < 1 || copies > 3) errors.push(`${copies} exemplaires de ${code}`);
    if (!card) {
      errors.push(`carte ${code} absente de BabelCDB`);
      continue;
    }
    if (!isAllowed(code) && !anime.has(code)) errors.push(`carte ${code} hors pool et hors liste blanche de l'histoire`);
    if (card.type & OcgType.FUSION) errors.push(`fusion ${code} dans le deck principal`);
  }
  return errors;
}

function checkRules({ lp, hand, special = [] }: StoryDuel["rules"]): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(lp) || lp <= 0) errors.push(`LP de départ invalides : ${lp}`);
  if (!Number.isInteger(hand) || hand < 0 || hand > 10) errors.push(`main de départ invalide : ${hand}`);
  for (const name of special) if (!EXTRA_RULES.has(name)) errors.push(`règle spéciale inconnue : ${name}`);
  return errors;
}

function checkRewards({ boosters, cards = [] }: Rewards, rewarded: Set<number>): string[] {
  const errors: string[] = [];
  if (boosters !== undefined && (!Number.isInteger(boosters) || boosters < 1)) errors.push(`boosters invalides : ${boosters}`);
  for (const code of cards) {
    if (!isAllowed(code)) errors.push(`carte offerte ${code} hors pool`);
    if (rewarded.has(code)) errors.push(`carte ${code} déjà offerte par un autre duel`);
    rewarded.add(code);
  }
  return errors;
}

function checkTexts(duel: StoryDuel): string[] {
  const texts = { title: duel.title, opponent: duel.opponent, intro: duel.intro, outro: duel.outro };
  return Object.entries(texts).flatMap(([name, text]) =>
    typeof text === "string" && text.trim() && text.length <= MAX_TEXT ? [] : [`${name} vide ou de plus de ${MAX_TEXT} caractères`],
  );
}

// Every problem of the data, prefixed by the duel id. Empty when the story can be played.
export function validateStory(story: Story): string[] {
  const errors: string[] = [];
  if (story.version !== STORY_VERSION) errors.push(`version ${story.version}, ${STORY_VERSION} attendue`);
  const anime = new Set(story.anime);
  for (const code of anime) if (!readCard(code)) errors.push(`carte anime ${code} absente de BabelCDB`);
  if (new Set(story.arcs.map((arc) => arc.id)).size !== story.arcs.length) errors.push("identifiant d'arc en double");
  // Duel ids, and arc ids once their arc is over: a duel can only require what comes before it.
  const before = new Set<string>();
  const rewarded = new Set<number>();
  for (const arc of story.arcs) {
    for (const duel of arc.duels) {
      const problems = [...checkTexts(duel), ...checkDeck(duel.deck, anime), ...checkRules(duel.rules), ...checkRewards(duel.rewards, rewarded)];
      if (before.has(duel.id)) problems.push("identifiant en double");
      for (const id of duel.requires) if (!before.has(id)) problems.push(`prérequis ${id} inconnu ou placé après`);
      errors.push(...problems.map((problem) => `${duel.id} : ${problem}`));
      before.add(duel.id);
    }
    before.add(arc.id);
  }
  return errors;
}

// One file per arc, read in file name order, so arcs can be written separately.
function loadStory(dir: string): Story {
  const parts: Story[] = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf-8")));
  const version = parts.find((part) => part.version !== STORY_VERSION)?.version ?? STORY_VERSION;
  return { version, anime: parts.flatMap((part) => part.anime), arcs: parts.flatMap((part) => part.arcs) };
}

export const STORY: Story = loadStory(join(import.meta.dirname, "..", "data", "story"));
const errors = validateStory(STORY);
if (errors.length > 0) throw new Error(`data/story invalide :\n${errors.join("\n")}`);

export const STORY_DUELS: ReadonlyMap<string, StoryDuel> = new Map(STORY.arcs.flatMap((arc) => arc.duels.map((duel) => [duel.id, duel])));

export const storyDeck = (duel: StoryDuel) => duel.deck.flatMap(([code, copies]) => Array<number>(copies).fill(code));

export const storyRules = ({ rules }: StoryDuel): Rules => ({
  lp: rules.lp,
  hand: rules.hand,
  cards: (rules.special ?? []).map((name) => EXTRA_RULES.get(name) as number),
});

// A duel requirement is won, an arc requirement once all its duels are.
function met(id: string, done: ReadonlySet<string>, story: Story): boolean {
  if (done.has(id)) return true;
  const arc = story.arcs.find((candidate) => candidate.id === id);
  return arc !== undefined && arc.duels.every((duel) => done.has(duel.id));
}

export const isUnlocked = (duel: StoryDuel, done: ReadonlySet<string>, story = STORY) => duel.requires.every((id) => met(id, done, story));

function statusOf(duel: StoryDuel, done: ReadonlySet<string>, story: Story): StoryStatus {
  if (done.has(duel.id)) return "done";
  return isUnlocked(duel, done, story) ? "available" : "locked";
}

// What the player sees: the conclusion only once the duel is won, no opponent deck.
export function storyView(done: ReadonlySet<string>, story = STORY): StoryArcView[] {
  return story.arcs.map((arc) => ({
    id: arc.id,
    title: arc.title,
    duels: arc.duels.map((duel) => ({
      id: duel.id,
      title: duel.title,
      opponent: duel.opponent,
      lp: duel.rules.lp,
      hand: duel.rules.hand,
      special: duel.rules.special ?? [],
      intro: duel.intro,
      outro: done.has(duel.id) ? duel.outro : undefined,
      rewards: duel.rewards,
      requires: duel.requires,
      status: statusOf(duel, done, story),
    })),
  }));
}

export async function completedDuels(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db<{ duelId: string }[]>`select duel_id as "duelId" from yugioh.story_duels where user_id = ${userId}`;
  return new Set(rows.map((row) => row.duelId));
}

// Records a won duel. Only the first win of a duel grants its rewards, and a card only once: resolves to what
// was granted, undefined for a duel already won.
export async function completeDuel(db: Db, userId: string, duel: StoryDuel): Promise<Rewards | undefined> {
  return db.begin(async (sql) => {
    const [first] = await sql`
      insert into yugioh.story_duels (user_id, duel_id) values (${userId}, ${duel.id}) on conflict do nothing returning duel_id`;
    if (!first) return undefined;
    const { boosters, cards = [] } = duel.rewards;
    if (boosters) await creditBoosters(sql, userId, boosters);
    const granted: number[] = [];
    for (const code of cards) {
      const [unlocked] = await sql`
        insert into yugioh.story_unlocks (user_id, unlock_id) values (${userId}, ${`card:${code}`}) on conflict do nothing returning unlock_id`;
      if (!unlocked) continue;
      await sql`
        insert into yugioh.collection (user_id, card_code, quantity) values (${userId}, ${code}, 1)
        on conflict (user_id, card_code) do update set quantity = collection.quantity + 1`;
      granted.push(code);
    }
    return { boosters, cards: granted };
  });
}
