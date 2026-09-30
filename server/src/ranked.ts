import type { Db } from "./db.ts";
import type { RankedPlayer, Seat } from "./protocol.ts";

export const START_RATING = 1000;
export const K_FACTOR = 32;
// Rating gap allowed between two waiting players, widened by RANGE_STEP every RANGE_EVERY ms of waiting.
export const RANGE_START = 100;
export const RANGE_STEP = 50;
export const RANGE_EVERY = 10_000;
// The same two players are not paired again within this time.
export const REMATCH_DELAY = 10 * 60_000;
export const LEADERBOARD_SIZE = 50;

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

export type Rating = { rating: number; games: number };
// A ranked duel: players by seat, `winner` null for a draw.
export type RankedDuel = { players: [string, string]; winner: Seat | null; reason: number };

// Ranked storage, faked in tests.
export type RankedStore = {
  rating: (userId: string) => Promise<Rating>;
  leaderboard: () => Promise<RankedPlayer[]>;
  // Updates both ratings and logs the duel; resolves to the ratings of each seat before and after.
  rateDuel: (duel: RankedDuel) => Promise<[{ before: number; after: number }, { before: number; after: number }]>;
};

export async function readRating(db: Db, userId: string): Promise<Rating> {
  const [row] = await db<Rating[]>`select rating, ranked_games as games from yugioh.profiles where user_id = ${userId}`;
  return row ?? { rating: START_RATING, games: 0 };
}

export function readLeaderboard(db: Db): Promise<RankedPlayer[]> {
  return db<RankedPlayer[]>`
    select pseudo, avatar_code as avatar, rating, ranked_games as games from yugioh.profiles
    where ranked_games > 0 order by rating desc, ranked_games desc, pseudo limit ${LEADERBOARD_SIZE}`;
}

// Both profile rows are locked in user_id order, so two duels ending at once never deadlock.
export function rateDuel(db: Db, { players, winner, reason }: RankedDuel): ReturnType<RankedStore["rateDuel"]> {
  return db.begin(async (sql) => {
    const before = new Map<string, number>();
    for (const id of [...players].sort()) {
      const [row] = await sql<{ rating: number }[]>`select rating from yugioh.profiles where user_id = ${id} for update`;
      before.set(id, row.rating);
    }
    const ratings: [number, number] = [before.get(players[0]) ?? START_RATING, before.get(players[1]) ?? START_RATING];
    const after = elo(ratings, winner);
    for (const seat of [0, 1] as const) {
      await sql`update yugioh.profiles set rating = ${after[seat]}, ranked_games = ranked_games + 1 where user_id = ${players[seat]}`;
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
  rating: (userId) => readRating(db, userId),
  leaderboard: () => readLeaderboard(db),
  rateDuel: (duel) => rateDuel(db, duel),
});
