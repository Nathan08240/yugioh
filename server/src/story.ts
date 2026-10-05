import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OcgType } from "@n1xx1/ocgcore-wasm";
import { creditBoosters, creditUltraBooster } from "./boosters.ts";
import { readCard } from "./cards.ts";
import { addCards } from "./collection.ts";
import type { Db, Sql } from "./db.ts";
import { EXTRA_MAX } from "./deckcheck.ts";
import type { Rules } from "./duel.ts";
import { parisDay } from "./economy.ts";
import { isAllowed } from "./pool.ts";
import { REPLAY_BOOSTERS_MAX, REPLAY_WINS, type RevengeResult, type Rewards, type StoryArcView, type StoryDuelView, type StoryLevel, type StoryResult, type StoryStatus } from "./protocol.ts";

// Format of each data/story/*.json file, version STORY_VERSION. Texts are short summaries written by us, never anime dialogue.
export type StoryDuel = {
  id: string;
  title: string;
  opponent: string;
  // [passcode, copies], main deck only.
  deck: [code: number, copies: number][];
  // Fusion monsters of the extra deck, same format; none when absent.
  extra?: [code: number, copies: number][];
  // `special`: names from EXTRA_RULES.
  rules: { lp: number; hand: number; special?: string[] };
  intro: string;
  outro: string;
  // Reward cards must be in the pool, each one given by a single duel of the story.
  rewards: Rewards;
  // Ids of duels placed before this one, or of earlier arcs, met once every duel of the arc is won.
  requires: string[];
  // A side duel: the arc counts as over without it, so adding one never re-locks the next arcs of players who finished.
  optional?: boolean;
};
// Rematch of the boss (`boss`: id of a duel of the arc) once the arc is finished: the boss duel with this reinforced deck
// (pool cards only), against an Expert bot. Its first win gives a booster holding an Ultra Rare.
export type Revenge = Pick<StoryDuel, "deck" | "extra" | "intro" | "outro"> & { boss: string };
export type Arc = { id: string; title: string; duels: StoryDuel[]; revenge?: Revenge };
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

function checkExtra(extra: StoryDuel["extra"] = []): string[] {
  const errors: string[] = [];
  if (extra.reduce((sum, [, copies]) => sum + copies, 0) > EXTRA_MAX) errors.push(`extra deck de plus de ${EXTRA_MAX} cartes`);
  for (const [code] of extra) {
    const card = readCard(code);
    if (!card) errors.push(`carte ${code} absente de BabelCDB`);
    else if (!(card.type & OcgType.FUSION)) errors.push(`${code} n'est pas une fusion, extra deck refusé`);
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

// The Ultra Rare guaranteed booster of the first win of a revenge.
export const REVENGE_REWARD: Rewards = { boosters: 1 };

const bossOf = (arc: Arc) => arc.duels.find((duel) => duel.id === arc.revenge?.boss);

// The revenge as a duel: the rules and opponent of the boss, its reinforced deck, unlocked once the arc is finished.
function revengeDuel(arc: Arc, boss: StoryDuel, { deck, extra, intro, outro }: Revenge): StoryDuel {
  return { ...boss, title: `Revanche : ${boss.title}`, deck, extra: extra ?? boss.extra, intro, outro, rewards: REVENGE_REWARD, requires: [arc.id] };
}

// Only the pool: the anime cards of the story are not allowed in a revenge deck.
function checkRevenge(arc: Arc): string[] {
  const { revenge } = arc;
  const boss = bossOf(arc);
  if (!revenge) return [];
  if (!boss) return [`${arc.id} : boss ${revenge.boss} absent de l'arc`];
  const duel = revengeDuel(arc, boss, revenge);
  const problems = [...checkTexts(duel), ...checkDeck(duel.deck, new Set()), ...checkExtra(duel.extra)];
  return problems.map((problem) => `${arc.id} revanche : ${problem}`);
}

// Every problem of the data, prefixed by the duel id. Empty when the story can be played.
export function validateStory(story: Story): string[] {
  const errors: string[] = [];
  if (story.version !== STORY_VERSION) errors.push(`version ${story.version}, ${STORY_VERSION} attendue`);
  const anime = new Set(story.anime);
  for (const code of anime) if (!readCard(code)) errors.push(`carte anime ${code} absente de BabelCDB`);
  for (const duel of story.arcs.flatMap((arc) => arc.duels)) errors.push(...checkExtra(duel.extra).map((problem) => `${duel.id} : ${problem}`));
  if (new Set(story.arcs.map((arc) => arc.id)).size !== story.arcs.length) errors.push("identifiant d'arc en double");
  // Duel ids, and arc ids once their arc is over: a duel can only require what comes before it.
  const before = new Set<string>();
  const rewarded = new Set<number>();
  for (const arc of story.arcs) {
    errors.push(...checkRevenge(arc));
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

// The revenges by boss duel id, with the id of their arc.
export const STORY_REVENGES: ReadonlyMap<string, { arc: string; duel: StoryDuel }> = new Map(
  STORY.arcs.flatMap((arc) => {
    const boss = bossOf(arc);
    return arc.revenge && boss ? [[boss.id, { arc: arc.id, duel: revengeDuel(arc, boss, arc.revenge) }] as const] : [];
  }),
);

const expand = (list: [code: number, copies: number][]) => list.flatMap(([code, copies]) => Array<number>(copies).fill(code));

export const storyDeck = (duel: StoryDuel) => expand(duel.deck);

export const storyExtra = (duel: StoryDuel) => expand(duel.extra ?? []);

export const storyRules = ({ rules }: StoryDuel, level: StoryLevel = "normal"): Rules => ({
  lp: rules.lp,
  playerLp: level === "facile" ? rules.lp * 2 : undefined,
  hand: rules.hand,
  cards: (rules.special ?? []).map((name) => EXTRA_RULES.get(name) as number),
});

// 1 star for a win, 2 at "normal", 3 at "normal" with at least half the starting LP left.
export function storyStars(easy: boolean, lp: number, startLp: number): number {
  if (easy) return 1;
  return lp * 2 >= startLp ? 3 : 2;
}

// Ids of the duels won: a Set, or the Map of their best stars.
type Done = Pick<ReadonlySet<string>, "has">;

// A duel requirement is won, an arc requirement once all its duels but the optional ones are.
function met(id: string, done: Done, story: Story): boolean {
  if (done.has(id)) return true;
  const arc = story.arcs.find((candidate) => candidate.id === id);
  return arc !== undefined && arc.duels.every((duel) => duel.optional || done.has(duel.id));
}

export const isUnlocked = (duel: StoryDuel, done: Done, story = STORY) => duel.requires.every((id) => met(id, done, story));

function statusOf(duel: StoryDuel, done: Done, story: Story): StoryStatus {
  if (done.has(duel.id)) return "done";
  return isUnlocked(duel, done, story) ? "available" : "locked";
}

const baseView = (duel: StoryDuel) => ({
  id: duel.id,
  title: duel.title,
  opponent: duel.opponent,
  lp: duel.rules.lp,
  hand: duel.rules.hand,
  special: duel.rules.special ?? [],
  intro: duel.intro,
  rewards: duel.rewards,
  requires: duel.requires,
});

// The revenge of an arc: available once the arc is finished, "done" once won, its conclusion shown then only.
// `done` holds the boss duel itself, so the status cannot come from statusOf.
function revengeView(arc: Arc, done: Done, won: boolean, story: Story): StoryDuelView | undefined {
  const boss = bossOf(arc);
  if (!arc.revenge || !boss) return undefined;
  const duel = revengeDuel(arc, boss, arc.revenge);
  let status: StoryStatus = isUnlocked(duel, done, story) ? "available" : "locked";
  if (won) status = "done";
  return { ...baseView(duel), outro: won ? duel.outro : undefined, status, stars: 0 };
}

// What the player sees: the conclusion only once the duel is won, no opponent deck. `done`: best stars of the duels won,
// `revenges`: ids of the arcs whose revenge was won.
export function storyView(done: ReadonlyMap<string, number>, story = STORY, revenges: ReadonlySet<string> = new Set()): StoryArcView[] {
  return story.arcs.map((arc) => ({
    id: arc.id,
    title: arc.title,
    duels: arc.duels.map((duel) => ({
      ...baseView(duel),
      outro: done.has(duel.id) ? duel.outro : undefined,
      optional: duel.optional,
      status: statusOf(duel, done, story),
      stars: done.get(duel.id) ?? 0,
    })),
    revenge: revengeView(arc, done, revenges.has(arc.id), story),
  }));
}

// Best stars of each duel won.
export async function completedDuels(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db<{ duelId: string; stars: number }[]>`
    select duel_id as "duelId", stars from yugioh.story_duels where user_id = ${userId}`;
  return new Map(rows.map((row) => [row.duelId, row.stars]));
}

// True the first time only: an unlock is recorded once per player.
export async function unlock(sql: Sql, userId: string, id: string): Promise<boolean> {
  const [row] = await sql`
    insert into yugioh.story_unlocks (user_id, unlock_id) values (${userId}, ${id}) on conflict do nothing returning unlock_id`;
  return row !== undefined;
}

// The rewards of a first win, a card only once.
async function grantRewards(sql: Sql, userId: string, { boosters, cards = [] }: Rewards): Promise<Rewards> {
  if (boosters) await creditBoosters(sql, userId, boosters);
  const granted: number[] = [];
  for (const code of cards) {
    if (!(await unlock(sql, userId, `card:${code}`))) continue;
    await addCards(sql, userId, [{ code, rarity: "common" }]);
    granted.push(code);
  }
  return { boosters, cards: granted };
}

// One more win of a duel already won, a booster every REPLAY_WINS and REPLAY_BOOSTERS_MAX a day: resolves to the place of
// this win in its series, or to the daily limit once reached, when the win does not count.
async function replayWin(sql: Sql, userId: string): Promise<Pick<StoryResult, "replays" | "replayLimit">> {
  const today = parisDay();
  const [row] = await sql<{ replays: number }[]>`
    update yugioh.profiles set story_replays = story_replays + 1
    where user_id = ${userId} and (replay_on is distinct from ${today}::date or replay_boosters < ${REPLAY_BOOSTERS_MAX})
    returning story_replays as replays`;
  if (!row) return { replayLimit: true };
  if (row.replays % REPLAY_WINS === 0) {
    await sql`
      update yugioh.profiles set replay_boosters = case when replay_on = ${today}::date then replay_boosters + 1 else 1 end, replay_on = ${today}::date
      where user_id = ${userId}`;
    await creditBoosters(sql, userId, 1);
  }
  return { replays: ((row.replays - 1) % REPLAY_WINS) + 1 };
}

// Records a won duel with its stars (storyStars), keeping the best. The first win grants the duel's rewards, the first
// 3 stars a booster, and a win of a duel already won counts towards a replay booster.
export async function completeDuel(db: Db, userId: string, duel: StoryDuel, stars: number): Promise<StoryResult> {
  return db.begin(async (sql) => {
    const [first] = await sql`
      insert into yugioh.story_duels (user_id, duel_id, stars) values (${userId}, ${duel.id}, ${stars}) on conflict do nothing returning duel_id`;
    const [{ best }] = first
      ? [{ best: stars }]
      : await sql<{ best: number }[]>`
          update yugioh.story_duels set stars = greatest(stars, ${stars}) where user_id = ${userId} and duel_id = ${duel.id} returning stars as best`;
    const starBooster = stars === 3 && (await unlock(sql, userId, `stars:${duel.id}`));
    if (starBooster) await creditBoosters(sql, userId, 1);
    if (!first) return { rewards: null, stars, best, starBooster, ...(await replayWin(sql, userId)) };
    return { rewards: await grantRewards(sql, userId, duel.rewards), stars, best, starBooster };
  });
}

const REVENGE_PREFIX = "revenge:";

// Ids of the arcs whose revenge the player won.
export async function revengesWon(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db<{ unlockId: string }[]>`
    select unlock_id as "unlockId" from yugioh.story_unlocks where user_id = ${userId} and starts_with(unlock_id, ${REVENGE_PREFIX})`;
  return new Set(rows.map((row) => row.unlockId.slice(REVENGE_PREFIX.length)));
}

// A won revenge of the arc: the Ultra Rare booster is paid once per arc (the unlock is recorded once, even for concurrent wins),
// a replay gives nothing.
export async function completeRevenge(db: Db, userId: string, arcId: string): Promise<RevengeResult> {
  return db.begin(async (sql) => {
    const first = await unlock(sql, userId, REVENGE_PREFIX + arcId);
    if (first) await creditUltraBooster(sql, userId);
    return { revenge: true, rewards: first ? REVENGE_REWARD : null };
  });
}
