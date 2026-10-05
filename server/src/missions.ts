import { createHash } from "node:crypto";
import { OcgLocation, OcgMessageType, OcgQueryFlags, OcgType, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { BOOSTERS, creditBoosters } from "./boosters.ts";
import { readCard } from "./cards.ts";
import { readCollection } from "./collection.ts";
import type { Db, Sql } from "./db.ts";
import type { openDuel } from "./duel.ts";
import { parisDay } from "./economy.ts";
import { WHITELIST } from "./pool.ts";
import { MISSIONS_BONUS, type AchievementView, type MissionReward, type MissionView } from "./protocol.ts";
import { completedDuels, STORY, unlock } from "./story.ts";

// What counted duels and openings brought in a day (Europe/Paris). `summons` and `damage`: the best of a single duel.
export type Gains = { wins: number; fusionWins: number; summons: number; damage: number; storyWins: number; ranked: number; boosters: number };
export const NO_GAINS: Gains = { wins: 0, fusionWins: 0, summons: 0, damage: 0, storyWins: 0, ranked: 0, boosters: 0 };

type Mission = { id: string; text: string; stat: keyof Gains; goal: number; points: number };
export const MISSIONS: readonly Mission[] = [
  { id: "victoire", text: "Gagner un duel", stat: "wins", goal: 1, points: 30 },
  { id: "victoires", text: "Gagner 3 duels", stat: "wins", goal: 3, points: 60 },
  { id: "fusion", text: "Gagner un duel avec un monstre Fusion sur le terrain", stat: "fusionWins", goal: 1, points: 50 },
  { id: "invocations", text: "Invoquer 5 monstres en un duel", stat: "summons", goal: 5, points: 30 },
  { id: "degats", text: "Infliger 3000 points de dégâts en un duel", stat: "damage", goal: 3000, points: 40 },
  { id: "histoire", text: "Gagner un duel du mode Histoire", stat: "storyWins", goal: 1, points: 40 },
  { id: "boosters", text: "Ouvrir 2 boosters", stat: "boosters", goal: 2, points: 20 },
  { id: "classe", text: "Jouer un duel classé", stat: "ranked", goal: 1, points: 40 },
];
export const DAILY_MISSIONS = 3;

// The same 3 missions all day for a player, different from one player or day to the next.
export function dailyMissions(userId: string, day: string): Mission[] {
  const rank = (mission: Mission) => createHash("sha256").update(`${userId}:${day}:${mission.id}`).digest().readUInt32BE(0);
  return MISSIONS.map((mission) => ({ mission, rank: rank(mission) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, DAILY_MISSIONS)
    .map(({ mission }) => mission);
}

// `wins`: counted wins of every day. `story`: the story duels won.
export type Facts = { today: Gains; wins: number; owned: ReadonlySet<number>; story: Pick<ReadonlySet<string>, "has"> };
type Achievement = Omit<AchievementView, "progress"> & { progress: (facts: Facts) => number };

const arcsDone = ({ story }: Facts) => STORY.arcs.filter((arc) => arc.duels.every((duel) => story.has(duel.id))).length;
const setsDone = ({ owned }: Facts) => [...BOOSTERS.values()].filter((set) => set.cards.every((card) => owned.has(card.code))).length;

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "premiere_victoire", title: "Premier pas", text: "Gagner un premier duel", goal: 1, reward: { points: 100 }, progress: (facts) => facts.wins },
  { id: "cent_victoires", title: "Centurion", text: "Gagner 100 duels", goal: 100, reward: { boosters: 3 }, progress: (facts) => facts.wins },
  { id: "arc_histoire", title: "Fin de chapitre", text: "Gagner tous les duels d'un arc du mode Histoire", goal: 1, reward: { boosters: 1 }, progress: arcsDone },
  { id: "dieu_egyptien", title: "Pouvoir divin", text: "Posséder un Dieu Égyptien", goal: 1, reward: { points: 200 }, progress: ({ owned }) => [...WHITELIST].filter((code) => owned.has(code)).length },
  { id: "set_complet", title: "Collectionneur", text: "Posséder toutes les cartes d'un booster", goal: 1, reward: { boosters: 3 }, progress: setsDone },
];

export type MissionsView = { missions: MissionView[]; achievements: AchievementView[] };

export function missionsOf(userId: string, day: string, facts: Facts): MissionsView {
  return {
    missions: dailyMissions(userId, day).map(({ id, text, stat, goal, points }) => ({ id, text, goal, progress: Math.min(goal, facts.today[stat]), reward: { points } })),
    achievements: ACHIEVEMENTS.map(({ progress, ...achievement }) => ({ ...achievement, progress: Math.min(achievement.goal, progress(facts)) })),
  };
}

const reached = (item: { progress: number; goal: number }) => item.progress >= item.goal;

// Every reward reached, by its key in yugioh.story_unlocks, which pays it once: paid or not yet.
export function rewardsDue({ missions, achievements }: MissionsView, day: string): [key: string, reward: MissionReward][] {
  const due: [string, MissionReward][] = missions.filter(reached).map((mission) => [`mission:${day}:${mission.id}`, mission.reward]);
  if (missions.every(reached)) due.push([`mission:${day}:bonus`, { boosters: MISSIONS_BONUS }]);
  return [...due, ...achievements.filter(reached).map((achievement): [string, MissionReward] => [`succes:${achievement.id}`, achievement.reward])];
}

async function grant(sql: Sql, userId: string, { points, boosters }: MissionReward) {
  if (points) await sql`update yugioh.profiles set collection_points = collection_points + ${points} where user_id = ${userId}`;
  if (boosters) await creditBoosters(sql, userId, boosters);
}

// The missions of the day and the achievements; pays what was reached and not paid yet.
export async function missionsView(db: Db, userId: string, day = parisDay()): Promise<MissionsView> {
  const [today = NO_GAINS] = await db<Gains[]>`
    select wins, fusion_wins as "fusionWins", summons, damage, story_wins as "storyWins", ranked, boosters
    from yugioh.mission_days where user_id = ${userId} and day = ${day}::date`;
  const [{ wins }] = await db<{ wins: number }[]>`select coalesce(sum(wins), 0)::int as wins from yugioh.mission_days where user_id = ${userId}`;
  const owned = new Set((await readCollection(db, userId)).map(([code]) => code));
  const view = missionsOf(userId, day, { today, wins, owned, story: await completedDuels(db, userId) });
  const paid = new Set(
    (await db<{ id: string }[]>`
      select unlock_id as id from yugioh.story_unlocks
      where user_id = ${userId} and (unlock_id like 'succes:%' or unlock_id like ${`mission:${day}:%`})`).map(({ id }) => id),
  );
  const unpaid = rewardsDue(view, day).filter(([key]) => !paid.has(key));
  if (unpaid.length > 0) {
    await db.begin(async (sql) => {
      for (const [key, reward] of unpaid) if (await unlock(sql, userId, key)) await grant(sql, userId, reward);
    });
  }
  return view;
}

// `opponent`: an online duel outside ranked and events, which counts once a day per opponent.
export type MissionProgress = { gains: Partial<Gains>; opponent?: string };

// Adds to the day of the player, then reads their missions.
export async function progressMissions(db: Db, userId: string, { gains, opponent }: MissionProgress, day = parisDay()): Promise<MissionsView> {
  const g = { ...NO_GAINS, ...gains };
  await db.begin(async (sql) => {
    if (opponent && !(await unlock(sql, userId, `adversaire:${day}:${opponent}`))) return;
    await sql`
      insert into yugioh.mission_days (user_id, day, wins, fusion_wins, summons, damage, story_wins, ranked, boosters)
      values (${userId}, ${day}::date, ${g.wins}, ${g.fusionWins}, ${g.summons}, ${g.damage}, ${g.storyWins}, ${g.ranked}, ${g.boosters})
      on conflict (user_id, day) do update set
        wins = mission_days.wins + excluded.wins,
        fusion_wins = mission_days.fusion_wins + excluded.fusion_wins,
        summons = greatest(mission_days.summons, excluded.summons),
        damage = greatest(mission_days.damage, excluded.damage),
        story_wins = mission_days.story_wins + excluded.story_wins,
        ranked = mission_days.ranked + excluded.ranked,
        boosters = mission_days.boosters + excluded.boosters`;
  });
  return missionsView(db, userId, day);
}

// Summons and damage dealt by each seat during a duel.
export type Tally = { summons: [number, number]; damage: [number, number] };
export const newTally = (): Tally => ({ summons: [0, 0], damage: [0, 0] });
const SUMMONS: ReadonlySet<OcgMessageType> = new Set([OcgMessageType.SUMMONING, OcgMessageType.SPSUMMONING, OcgMessageType.FLIPSUMMONING]);

export function countEvents(tally: Tally, events: readonly OcgMessage[]) {
  for (const msg of events) {
    if (SUMMONS.has(msg.type) && "controller" in msg) tally.summons[msg.controller]++;
    else if (msg.type === OcgMessageType.DAMAGE) tally.damage[1 - msg.player] += msg.amount;
  }
}

// The type comes from the card database: the library misreads a TYPE query.
export const fusionOnField = ({ lib, handle }: Awaited<ReturnType<typeof openDuel>>, seat: 0 | 1) =>
  lib
    .duelQueryLocation(handle, { flags: OcgQueryFlags.CODE, controller: seat, location: OcgLocation.MZONE })
    .some((card) => card?.code !== undefined && ((readCard(card.code)?.type ?? 0) & OcgType.FUSION) !== 0);

// A finished duel for one of its players. `forfeit`: the loser gave up, timed out or left.
export type MissionDuel = { won: boolean; forfeit: boolean; story: boolean; ranked: boolean; summons: number; damage: number; fusion: boolean };

// A win by forfeit counts as a win and nothing more for the winner.
export function duelGains(duel: MissionDuel): Gains {
  const won = duel.won ? 1 : 0;
  const played = !(duel.won && duel.forfeit);
  return {
    wins: won,
    fusionWins: played && duel.fusion ? won : 0,
    summons: played ? duel.summons : 0,
    damage: played ? duel.damage : 0,
    storyWins: duel.story ? won : 0,
    ranked: duel.ranked ? 1 : 0,
    boosters: 0,
  };
}

export type MissionStore = {
  missions: (userId: string) => Promise<MissionsView>;
  progressMissions: (userId: string, progress: MissionProgress) => Promise<MissionsView>;
};

export function dbMissionStore(db: Db): MissionStore {
  return {
    missions: (userId) => missionsView(db, userId),
    progressMissions: (userId, progress) => progressMissions(db, userId, progress),
  };
}
