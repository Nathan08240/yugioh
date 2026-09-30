import { creditBoosters } from "./boosters.ts";
import type { Db, Sql } from "./db.ts";
import { parisDay } from "./economy.ts";
import { SEASON_MIN_GAMES, SEASON_REWARDS, type RankedPlayer, type RankedView, type SeasonResult, type Seat } from "./protocol.ts";

export const START_RATING = 1000;
export const K_FACTOR = 32;
// Rating gap allowed between two waiting players, widened by RANGE_STEP every RANGE_EVERY ms of waiting.
export const RANGE_START = 100;
export const RANGE_STEP = 50;
export const RANGE_EVERY = 10_000;
// The same two players are not paired again within this time.
export const REMATCH_DELAY = 10 * 60_000;
export const LEADERBOARD_SIZE = 50;
// Best players of the previous season shown.
export const SEASON_TOP_SIZE = 10;

// New ratings of both seats; `winner` null for a draw. The sum of the ratings stays the same.
export function elo(ratings: readonly [number, number], winner: Seat | null): [number, number] {
  const expected = 1 / (1 + 10 ** ((ratings[1] - ratings[0]) / 400));
  let score = 0.5;
  if (winner !== null) score = winner === 0 ? 1 : 0;
  const delta = Math.round(K_FACTOR * (score - expected));
  return [ratings[0] + delta, ratings[1] - delta];
}

export type Waiting = { id: string; rating: number; since: number };
export type LastOpponent = ReadonlyMap<string, { opponent: string; at: number }>;

// The gap a pair may have: the window of the player who has waited the longest.
const allowedGap = (a: Waiting, b: Waiting, now: number) => RANGE_START + RANGE_STEP * Math.floor((now - Math.min(a.since, b.since)) / RANGE_EVERY);

const metRecently = (a: Waiting, b: Waiting, now: number, last: LastOpponent) =>
  [[a, b], [b, a]].some(([x, y]) => {
    const met = last.get(x.id);
    return met?.opponent === y.id && now - met.at < REMATCH_DELAY;
  });

// Pairs the waiting players, oldest first, each with the closest rating in range.
export function pairUp<T extends Waiting>(waiting: readonly T[], now: number, last: LastOpponent): [T, T][] {
  const left = [...waiting].sort((a, b) => a.since - b.since);
  const pairs: [T, T][] = [];
  while (left.length > 1) {
    const [first] = left.splice(0, 1);
    let best = -1;
    left.forEach((other, index) => {
      const gap = Math.abs(first.rating - other.rating);
      if (gap > allowedGap(first, other, now) || metRecently(first, other, now, last)) return;
      if (best === -1 || gap < Math.abs(first.rating - left[best].rating)) best = index;
    });
    if (best !== -1) pairs.push([first, left.splice(best, 1)[0]]);
  }
  return pairs;
}

// "2026-10": the calendar month in France, which is the ranked season.
export const currentSeason = (now = new Date()) => parisDay(now).slice(0, 7);

// Days left in the season, today included.
export function daysLeft(now = new Date()): number {
  const [year, month, day] = parisDay(now).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate() - day + 1;
}

export function previousSeason(season: string): string {
  const [year, month] = season.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

// Boosters earned by a season ended at `rating` after `games` duels.
export function seasonReward(rating: number, games: number): number {
  if (games < SEASON_MIN_GAMES) return 0;
  return SEASON_REWARDS.find(([floor]) => rating >= floor)?.[1] ?? 0;
}

// The rating a new season starts from: halfway back to START_RATING.
export const recenter = (rating: number) => START_RATING + Math.round((rating - START_RATING) / 2);

export type Rating = { rating: number; games: number; seasonGames: number };
// A ranked duel: players by seat, `winner` null for a draw.
export type RankedDuel = { players: [string, string]; winner: Seat | null; reason: number };

// Ranked storage, faked in tests. Each call first moves the players to the current season.
export type RankedStore = {
  rating: (userId: string) => Promise<Rating>;
  ranked: (userId: string) => Promise<RankedView>;
  // Updates both ratings and logs the duel; resolves to the ratings of each seat before and after.
  rateDuel: (duel: RankedDuel) => Promise<[{ before: number; after: number }, { before: number; after: number }]>;
};

export async function readRating(db: Sql, userId: string): Promise<Rating> {
  const [row] = await db<Rating[]>`
    select rating, ranked_games as games, season_games as "seasonGames" from yugioh.profiles where user_id = ${userId}`;
  return row ?? { rating: START_RATING, games: 0, seasonGames: 0 };
}

// Moves the player to `season` once, under the profile lock: the season left is recorded and rewarded, then the rating
// recentered. A profile without season yet (created before the seasons) only joins `season`.
export async function rollSeason(sql: Sql, userId: string, season: string): Promise<void> {
  const [row] = await sql<{ season: string | null; rating: number; games: number }[]>`
    select season, rating, season_games as games from yugioh.profiles where user_id = ${userId} for update`;
  if (!row || (row.season !== null && row.season >= season)) return;
  if (row.season === null) {
    await sql`update yugioh.profiles set season = ${season} where user_id = ${userId}`;
    return;
  }
  const boosters = seasonReward(row.rating, row.games);
  const [recorded] = await sql`
    insert into yugioh.ranked_seasons (user_id, season, final_rating, games, boosters)
    values (${userId}, ${row.season}, ${row.rating}, ${row.games}, ${boosters}) on conflict do nothing returning user_id`;
  if (recorded && boosters > 0) await creditBoosters(sql, userId, boosters);
  await sql`update yugioh.profiles set season = ${season}, rating = ${recenter(row.rating)}, season_games = 0 where user_id = ${userId}`;
}

export const enterSeason = (db: Db, userId: string, season = currentSeason()): Promise<Rating> =>
  db.begin(async (sql) => {
    await rollSeason(sql, userId, season);
    return readRating(sql, userId);
  });

export function readLeaderboard(db: Db, season: string): Promise<RankedPlayer[]> {
  return db<RankedPlayer[]>`
    select pseudo, avatar_code as avatar, rating, season_games as games from yugioh.profiles
    where season = ${season} and season_games > 0 order by rating desc, season_games desc, pseudo limit ${LEADERBOARD_SIZE}`;
}

// Players not moved to the next season yet still hold their final rating in their profile.
export function readSeasonTop(db: Db, season: string): Promise<RankedPlayer[]> {
  return db<RankedPlayer[]>`
    select p.pseudo, p.avatar_code as avatar, s.rating, s.games from (
      select user_id, final_rating as rating, games from yugioh.ranked_seasons where season = ${season} and games > 0
      union all
      select user_id, rating, season_games from yugioh.profiles where season = ${season} and season_games > 0
    ) s join yugioh.profiles p using (user_id)
    order by s.rating desc, s.games desc, p.pseudo limit ${SEASON_TOP_SIZE}`;
}

export async function readRanked(db: Db, userId: string, now = new Date()): Promise<RankedView> {
  const season = currentSeason(now);
  const previous = previousSeason(season);
  const rating = await enterSeason(db, userId, season);
  const [leaderboard, previousLeaderboard, [lastResult]] = await Promise.all([
    readLeaderboard(db, season),
    readSeasonTop(db, previous),
    db<SeasonResult[]>`
      select season, final_rating as rating, games, boosters from yugioh.ranked_seasons
      where user_id = ${userId} and games > 0 order by season desc limit 1`,
  ]);
  return { ...rating, season, daysLeft: daysLeft(now), leaderboard, previousSeason: previous, previousLeaderboard, lastResult: lastResult ?? null };
}

// Both profile rows are locked in user_id order, so two duels ending at once never deadlock.
export function rateDuel(db: Db, { players, winner, reason }: RankedDuel, season = currentSeason()): ReturnType<RankedStore["rateDuel"]> {
  return db.begin(async (sql) => {
    const before = new Map<string, number>();
    for (const id of [...players].sort()) {
      await rollSeason(sql, id, season);
      const [row] = await sql<{ rating: number }[]>`select rating from yugioh.profiles where user_id = ${id} for update`;
      before.set(id, row.rating);
    }
    const ratings: [number, number] = [before.get(players[0]) ?? START_RATING, before.get(players[1]) ?? START_RATING];
    const after = elo(ratings, winner);
    for (const seat of [0, 1] as const) {
      await sql`
        update yugioh.profiles set rating = ${after[seat]}, ranked_games = ranked_games + 1, season_games = season_games + 1
        where user_id = ${players[seat]}`;
    }
    await sql`
      insert into yugioh.ranked_matches (player_a, player_b, winner, rating_a_before, rating_a_after, rating_b_before, rating_b_after, reason)
      values (${players[0]}, ${players[1]}, ${winner === null ? null : players[winner]}, ${ratings[0]}, ${after[0]}, ${ratings[1]}, ${after[1]}, ${reason})`;
    return [
      { before: ratings[0], after: after[0] },
      { before: ratings[1], after: after[1] },
    ];
  });
}

export const dbRankedStore = (db: Db): RankedStore => ({
  rating: (userId) => enterSeason(db, userId),
  ranked: (userId) => readRanked(db, userId),
  rateDuel: (duel) => rateDuel(db, duel),
});
