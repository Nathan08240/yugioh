import { readFileSync } from "node:fs";
import { join } from "node:path";
import { creditBoosters } from "./boosters.ts";
import type { Db } from "./db.ts";
import { STARTING_LP, type Rules } from "./duel.ts";
import { eventOf } from "./event.ts";
import { TOWER_FLOORS, type BotLevel, type TowerFloorView, type TowerView } from "./protocol.ts";
import { STORY_DUELS, storyDeck, storyExtra, unlock, type StoryDuel } from "./story.ts";

// Past floor TOWER_LP_FROM, the opponent starts with TOWER_LP_STEP more LP per floor.
export const TOWER_LP_STEP = 500;
const TOWER_LP_FROM = 5;
// Boosters of the first win of a floor each week.
export const TOWER_REWARDS: ReadonlyMap<number, number> = new Map([
  [3, 1],
  [6, 2],
  [10, 3],
]);
// Suggested decks from the simplest to the strongest, then two story bosses.
const SUGGESTED = ["aqua", "zombies", "joey", "demons", "pegasus", "machines", "kaiba", "yugi"];
const BOSSES = ["kcgc-zigfried", "mds-zorc"];

type Cards = [code: number, copies: number, name?: string][];
type Suggestion = { id: string; title: string; main: Cards; extra: Cards };
export type TowerOpponent = { name: string; main: number[]; extra: number[] };

const expand = (cards: Cards) => cards.flatMap(([code, copies]) => Array<number>(copies).fill(code));
const suggested: Suggestion[] = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "suggested-decks.json"), "utf-8"));

// Opponent of each floor, floor 1 first.
export const TOWER: readonly TowerOpponent[] = [
  ...SUGGESTED.map((id) => {
    const deck = suggested.find((candidate) => candidate.id === id) as Suggestion;
    return { name: deck.title, main: expand(deck.main), extra: expand(deck.extra) };
  }),
  ...BOSSES.map((id) => {
    const duel = STORY_DUELS.get(id) as StoryDuel;
    return { name: duel.opponent, main: storyDeck(duel), extra: storyExtra(duel) };
  }),
];
if (TOWER.length !== TOWER_FLOORS) throw new Error(`${TOWER.length} adversaires pour ${TOWER_FLOORS} étages`);

export function towerLevel(floor: number): BotLevel {
  if (floor <= 3) return "debutant";
  return floor <= 7 ? "normal" : "expert";
}

export const towerRules = (floor: number): Rules => ({
  lp: STARTING_LP + TOWER_LP_STEP * Math.max(0, floor - TOWER_LP_FROM),
  playerLp: STARTING_LP,
  hand: 5,
  cards: [],
});

const FLOORS: TowerFloorView[] = TOWER.map(({ name }, index) => ({
  opponent: name,
  level: towerLevel(index + 1),
  lp: towerRules(index + 1).lp,
  boosters: TOWER_REWARDS.get(index + 1) ?? 0,
}));

// Unlock ids of the reward floors taken this week: "tower:2026-W40:3".
const weekPrefix = () => `tower:${eventOf().id}:`;

export type TowerWin = { floor: number; best: number; boosters: number };

export async function towerView(db: Db, userId: string): Promise<TowerView> {
  const [row] = await db<{ floor: number; best: number }[]>`
    select tower_floor as floor, tower_best as best from yugioh.profiles where user_id = ${userId}`;
  const unlocks = await db<{ id: string }[]>`
    select unlock_id as id from yugioh.story_unlocks where user_id = ${userId} and starts_with(unlock_id, ${weekPrefix()})`;
  const claimed = unlocks.map(({ id }) => Number(id.slice(weekPrefix().length))).sort((a, b) => a - b);
  return { floors: FLOORS, floor: row?.floor ?? 0, best: row?.best ?? 0, claimed };
}

// The floor of the next duel. A duel left without result (server stopped, crash, disconnection) keeps the floor: only
// loseTower sends the player back to floor 1.
export async function startTower(db: Db, userId: string): Promise<number> {
  const [{ floor }] = await db<{ floor: number }[]>`select tower_floor as floor from yugioh.profiles where user_id = ${userId}`;
  return floor + 1;
}

// Records the loss or surrender of `floor`, as returned by startTower: back to floor 1, best kept. The loss of a floor
// already cleared since (a stale room) changes nothing.
export async function loseTower(db: Db, userId: string, floor: number): Promise<void> {
  await db`update yugioh.profiles set tower_floor = 0 where user_id = ${userId} and tower_floor < ${floor}`;
}

// Records the win of `floor`, as returned by startTower. The last floor ends the attempt; the first win of a reward floor
// grants its boosters.
export async function winTower(db: Db, userId: string, floor: number): Promise<TowerWin> {
  return db.begin(async (sql) => {
    const [{ best }] = await sql<{ best: number }[]>`
      update yugioh.profiles set tower_floor = ${floor % TOWER_FLOORS}, tower_best = greatest(tower_best, ${floor})
      where user_id = ${userId} returning tower_best as best`;
    const reward = TOWER_REWARDS.get(floor) ?? 0;
    const boosters = reward > 0 && (await unlock(sql, userId, `${weekPrefix()}${floor}`)) ? reward : 0;
    if (boosters) await creditBoosters(sql, userId, boosters);
    return { floor, best, boosters };
  });
}
