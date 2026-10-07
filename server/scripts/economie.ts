// Simulation de l'économie des boosters avec les règles du serveur : `pnpm --filter server economie [joueurs [jours]]`.
// Hypothèses de rythme (le joueur joue tous les jours) :
// - Connexions aux heures de `sessions` (à +-30 min) : booster gratuit si 12 h se sont écoulées, récompense du jour à la première.
// - Boosters ouverts le jour même, tous dans le set visé ; pioche miracle : 1 carte au hasard sur 5 chaque jour.
// - Minutes non jouées reportées au lendemain ; la moitié va au contenu unique (événement, histoire, Tour), la moitié au répétable.
// - Contenu unique épuisé : tout le temps va au répétable. Ordre : événement, histoire, Tour ; puis rejeu d'histoire, puis classé.
// - Durées : duel d'histoire, d'événement ou d'étage 10 min, rejeu 8 min, partie classée 15 min (file d'attente comprise).
// - Victoires : histoire 80 % (3 étoiles une fois sur deux), rejeu 90 %, événement 75 %, classé 50 %, Tour 90, 70 puis 50 % par niveau du bot.
// - Doublons convertis et cartes fabriquées une fois par semaine : manquantes d'abord, les plus chères d'abord, puis 3 exemplaires.
// - Hors simulation : missions du jour, puzzles, tutoriel, Scellé, Draft, parties en ligne hors classé.
import { randomInt } from "node:crypto";
import { BOOSTERS, drawPack, FREE_BOOSTER_HOURS, hasUltra, ULTRA_PITY, ultraPack, WIN_BOOSTER_REWARD } from "../src/boosters.ts";
import { conversionPlan, CRAFT_COSTS, DAILY_BOOSTERS } from "../src/economy.ts";
import { eventOf } from "../src/event.ts";
import type { CardSet, Printing } from "../src/pool.ts";
import { type BotLevel, EVENT_BOOSTERS, KEEP_COPIES, ONLINE_BOOSTERS_MAX, REPLAY_BOOSTERS_MAX, REPLAY_WINS, TOWER_FLOORS } from "../src/protocol.ts";
import { currentSeason, elo, recenter, seasonReward, START_RATING } from "../src/ranked.ts";
import { STORY } from "../src/story.ts";
import { TOWER_REWARDS, towerLevel } from "../src/tower.ts";
import { drawWonder } from "../src/wonder.ts";

export type Profile = { name: string; minutes: number; sessions: number[] };
export const PROFILES: Profile[] = [
  { name: "occasionnel", minutes: 20, sessions: [20] },
  { name: "régulier", minutes: 60, sessions: [8, 20] },
  { name: "assidu", minutes: 180, sessions: [8, 14, 20] },
];

const SOURCES = {
  free: "booster gratuit (12 h)",
  daily: "récompense du jour",
  story: "histoire (premières victoires, étoiles)",
  replay: "histoire (rejeux)",
  online: "victoires en ligne (classé)",
  season: "fin de saison classée",
  event: "événement de la semaine",
  tower: "Tour",
};
type Source = keyof typeof SOURCES;

const PROGRESS_SHARE = 0.5;
const COST = { duel: 10, replay: 8, ranked: 15 };
const WIN = { story: 0.8, stars: 0.5, replay: 0.9, event: 0.75, ranked: 0.5 };
const TOWER_WIN: Record<BotLevel, number> = { debutant: 0.9, normal: 0.7, expert: 0.5 };
const START = Date.UTC(2026, 9, 1, 12);
const DAY = 86_400_000;
const DUELS = STORY.arcs.flatMap((arc) => arc.duels);
// A goal not reached within the horizon.
const NEVER = Number.MAX_SAFE_INTEGER;
const TRACKED = new Set(["ultra", "secret"]);

const chance = (probability: number) => randomInt(2 ** 47) / 2 ** 47 < probability;

// What a player earns day by day: boosters per day, the source of each credit, and story cards (day, passcode).
export type Trace = { boosters: number[]; events: [day: number, source: Source, count: number][]; cards: [day: number, code: number][] };

type Player = {
  profile: Profile;
  trace: Trace;
  day: number;
  week: string;
  nextFreeAt: number;
  progress: number;
  repeat: number;
  nextDuel: number;
  threeStars: Set<string>;
  replayWins: number;
  replayBoosters: number;
  online: number;
  floor: number;
  towerClaimed: Set<number>;
  eventClaimed: string;
  rating: number;
  games: number;
  season: string;
};

function credit(p: Player, source: Source, count: number) {
  if (count <= 0) return;
  p.trace.boosters[p.day] += count;
  p.trace.events.push([p.day, source, count]);
}

function connect(p: Player) {
  for (const [index, hour] of p.profile.sessions.entries()) {
    if (index === 0) credit(p, "daily", DAILY_BOOSTERS);
    const at = p.day * 24 + hour + (randomInt(61) - 30) / 60;
    if (at < p.nextFreeAt) continue;
    credit(p, "free", 1);
    p.nextFreeAt = at + FREE_BOOSTER_HOURS;
  }
}

// Event week and ranked season of each day, computed once for all players.
const calendar: { week: string; season: string }[] = [];
function dayOf(day: number) {
  if (!calendar[day]) {
    const date = new Date(START + day * DAY);
    calendar[day] = { week: eventOf(date).id, season: currentSeason(date) };
  }
  return calendar[day];
}

function newSeason(p: Player, season: string) {
  if (season === p.season) return;
  credit(p, "season", seasonReward(p.rating, p.games));
  Object.assign(p, { season, rating: recenter(p.rating), games: 0 });
}

// The first 3 stars of a duel give a booster.
function stars(p: Player, id: string) {
  if (!chance(WIN.stars) || p.threeStars.has(id)) return;
  p.threeStars.add(id);
  credit(p, "story", 1);
}

function playEvent(p: Player) {
  if (!chance(WIN.event)) return;
  p.eventClaimed = p.week;
  credit(p, "event", EVENT_BOOSTERS);
}

function playStory(p: Player) {
  if (!chance(WIN.story)) return;
  const { id, rewards } = DUELS[p.nextDuel];
  p.nextDuel++;
  credit(p, "story", rewards.boosters ?? 0);
  for (const code of rewards.cards ?? []) p.trace.cards.push([p.day, code]);
  stars(p, id);
}

function playTower(p: Player) {
  const floor = p.floor + 1;
  if (!chance(TOWER_WIN[towerLevel(floor)])) {
    p.floor = 0;
    return;
  }
  p.floor = floor % TOWER_FLOORS;
  if (p.towerClaimed.has(floor)) return;
  p.towerClaimed.add(floor);
  credit(p, "tower", TOWER_REWARDS.get(floor) ?? 0);
}

function playReplay(p: Player) {
  p.repeat -= COST.replay;
  if (!chance(WIN.replay)) return;
  stars(p, DUELS[randomInt(p.nextDuel)].id);
  p.replayWins++;
  if (p.replayWins % REPLAY_WINS !== 0) return;
  p.replayBoosters++;
  credit(p, "replay", 1);
}

// Online players of the same rating meet: the winner gets WIN_BOOSTER_REWARD, ONLINE_BOOSTERS_MAX a day.
function playRanked(p: Player) {
  p.repeat -= COST.ranked;
  const win = chance(WIN.ranked);
  if (win && p.online < ONLINE_BOOSTERS_MAX) {
    p.online++;
    credit(p, "online", WIN_BOOSTER_REWARD);
  }
  p.rating = elo([p.rating, p.rating], win ? 0 : 1)[0];
  p.games++;
}

// The duel played once: the event of the week, then the story, then the floors holding a reward.
function nextOnce(p: Player): (() => void) | undefined {
  if (p.eventClaimed !== p.week) return () => playEvent(p);
  if (p.nextDuel < DUELS.length) return () => playStory(p);
  if ([...TOWER_REWARDS.keys()].some((floor) => !p.towerClaimed.has(floor))) return () => playTower(p);
  return undefined;
}

function playRepeatable(p: Player) {
  while (p.repeat >= COST.replay) {
    if (p.nextDuel > 0 && p.replayBoosters < REPLAY_BOOSTERS_MAX) playReplay(p);
    else if (p.repeat >= COST.ranked) playRanked(p);
    else break;
  }
}

function playDay(p: Player) {
  const { week, season } = dayOf(p.day);
  if (week !== p.week) p.towerClaimed.clear();
  p.week = week;
  p.replayBoosters = 0;
  p.online = 0;
  newSeason(p, season);
  connect(p);
  p.progress += p.profile.minutes * PROGRESS_SHARE;
  p.repeat += p.profile.minutes * (1 - PROGRESS_SHARE);
  for (let play = nextOnce(p); play && p.progress >= COST.duel; play = nextOnce(p)) {
    p.progress -= COST.duel;
    play();
  }
  if (!nextOnce(p)) {
    p.repeat += p.progress;
    p.progress = 0;
  }
  playRepeatable(p);
}

export function income(profile: Profile, days: number): Trace {
  const p: Player = {
    profile, trace: { boosters: [], events: [], cards: [] }, day: 0, week: "", nextFreeAt: 0, progress: 0, repeat: 0, nextDuel: 0,
    threeStars: new Set(), replayWins: 0, replayBoosters: 0, online: 0, floor: 0, towerClaimed: new Set(), eventClaimed: "",
    rating: START_RATING, games: 0, season: currentSeason(new Date(START)),
  };
  for (; p.day < days; p.day++) {
    p.trace.boosters.push(0);
    playDay(p);
  }
  return p.trace;
}

// Boosters per week of each source over the days [from, to), for the average player.
export function weekly(traces: Trace[], from: number, to: number): Map<Source, number> {
  const totals = new Map<Source, number>(Object.keys(SOURCES).map((source) => [source as Source, 0]));
  for (const { events } of traces) {
    for (const [day, source, count] of events) if (day >= from && day < to) totals.set(source, (totals.get(source) ?? 0) + count);
  }
  return new Map([...totals].map(([source, total]) => [source, (total * 7) / ((to - from) * traces.length)]));
}

type Collection = {
  counts: Map<number, number>;
  rarities: Map<string, [code: number, rarity: string, count: number]>;
  // Codes held fewer than 1 and than KEEP_COPIES times.
  missing1: number;
  missing3: number;
  points: number;
  sinceUltra: number;
  day: number;
  // First day each tracked printing ("code:rarity") was obtained.
  firsts: Map<string, number>;
};

function add(c: Collection, card: Printing) {
  const owned = c.counts.get(card.code);
  if (owned === undefined) return;
  c.counts.set(card.code, owned + 1);
  if (owned === 0) c.missing1--;
  if (owned + 1 === KEEP_COPIES) c.missing3--;
  const key = `${card.code}:${card.rarity}`;
  const row = c.rarities.get(key) ?? [card.code, card.rarity, 0];
  row[2]++;
  c.rarities.set(key, row);
  if (c.firsts.get(key) === NEVER) c.firsts.set(key, c.day + 1);
}

function openPack(c: Collection, set: CardSet) {
  const pack = c.sinceUltra >= ULTRA_PITY ? ultraPack(set) : drawPack(set);
  c.sinceUltra = hasUltra(pack) ? 0 : c.sinceUltra + 1;
  for (const card of pack) add(c, card);
}

const cost = (code: number) => CRAFT_COSTS.get(code) ?? NEVER;

// Missing cards first, then up to KEEP_COPIES; the most expensive card affordable goes first.
function craft(c: Collection) {
  const wanted = c.missing1 > 0 ? 1 : KEEP_COPIES;
  for (;;) {
    const options = [...c.counts].filter(([code, owned]) => owned < wanted && cost(code) <= c.points);
    if (options.length === 0) return;
    const [code] = options.reduce((best, option) => (cost(option[0]) > cost(best[0]) ? option : best));
    c.points -= cost(code);
    add(c, { code, rarity: "common" });
  }
}

function maintain(c: Collection) {
  const plan = conversionPlan([...c.counts], [...c.rarities.values()]);
  for (const [code, rarity, taken] of plan.cards) {
    c.counts.set(code, (c.counts.get(code) ?? 0) - taken);
    const row = c.rarities.get(`${code}:${rarity}`);
    if (row) row[2] -= taken;
  }
  c.points += plan.points;
  craft(c);
}

const randomWonderCard = (): Printing => {
  const { cards } = drawWonder();
  return cards[randomInt(cards.length)];
};

export type SetResult = { all: number; three: number; ultra: number[]; secret: number[] };

// Days until every card of `set` is owned, until 3 copies of each, and until each Ultra and Secret printing is drawn.
export function simulateSet(set: CardSet, trace: Trace, wonder: () => Printing = randomWonderCard): SetResult {
  const codes = new Set(set.cards.map((card) => card.code));
  const c: Collection = {
    counts: new Map([...codes].map((code) => [code, 0])), rarities: new Map(), missing1: codes.size, missing3: codes.size, points: 0, sinceUltra: 0, day: 0,
    firsts: new Map(set.cards.filter((card) => TRACKED.has(card.rarity)).map((card) => [`${card.code}:${card.rarity}`, NEVER])),
  };
  const result = { all: NEVER, three: NEVER };
  for (; c.day < trace.boosters.length; c.day++) {
    for (const [day, code] of trace.cards) if (day === c.day) add(c, { code, rarity: "common" });
    for (let i = 0; i < trace.boosters[c.day]; i++) openPack(c, set);
    add(c, wonder());
    if (c.day % 7 === 6) maintain(c);
    if (result.all === NEVER && c.missing1 === 0) result.all = c.day + 1;
    if (result.three === NEVER && c.missing3 === 0) result.three = c.day + 1;
    if (result.three !== NEVER && [...c.firsts.values()].every((first) => first !== NEVER)) break;
  }
  const firsts = (rarity: string) => [...c.firsts].filter(([key]) => key.endsWith(`:${rarity}`)).map(([, first]) => first);
  return { ...result, ultra: firsts("ultra"), secret: firsts("secret") };
}

// Nearest-rank quantile.
export const quantile = (values: number[], q: number): number => values.toSorted((a, b) => a - b)[Math.ceil(q * values.length) - 1];

const days = (value: number, horizon: number) => (value === NEVER ? `>${horizon}` : String(value));
const summary = (values: number[], horizon: number) => `${days(quantile(values, 0.5), horizon)} (p90 ${days(quantile(values, 0.9), horizon)})`;

function reportIncome(traces: Trace[], horizon: number) {
  const early = weekly(traces, 0, 28);
  const steady = weekly(traces, 182, horizon);
  const share = (map: Map<Source, number>, source: Source) => {
    const total = [...map.values()].reduce((sum, value) => sum + value, 0);
    return `${(map.get(source) ?? 0).toFixed(1)} (${(((map.get(source) ?? 0) / total) * 100).toFixed(0)} %)`;
  };
  const rows = Object.entries(SOURCES).map(([source, label]) => ({
    source: label, "sem. 1-4": share(early, source as Source), "sem. 27+": share(steady, source as Source),
  }));
  const sum = (map: Map<Source, number>) => [...map.values()].reduce((total, value) => total + value, 0).toFixed(1);
  rows.push({ source: "TOTAL boosters par semaine", "sem. 1-4": sum(early), "sem. 27+": sum(steady) });
  console.table(rows);
}

function reportSets(profile: Profile, traces: Trace[], horizon: number) {
  const rows = [...BOOSTERS.values()].map((set) => {
    const results = traces.map((trace) => simulateSet(set, trace));
    const secret = results.flatMap((result) => result.secret);
    return {
      set: set.code,
      cartes: new Set(set.cards.map((card) => card.code)).size,
      "toutes (j)": summary(results.map((r) => r.all), horizon),
      "x3 (j)": summary(results.map((r) => r.three), horizon),
      "Ultra précise (j)": summary(results.flatMap((result) => result.ultra), horizon),
      "Secret précise (j)": secret.length > 0 ? summary(secret, horizon) : "-",
    };
  });
  console.log(`\n${profile.name} : jours pour posséder chaque set (médiane, p90)`);
  console.table(rows);
}

if (import.meta.main) {
  const [playersArg = "60", daysArg = "730"] = process.argv.slice(2);
  const [players, horizon] = [Number(playersArg), Number(daysArg)];
  console.log(`Simulation sur ${horizon} jours, ${players} joueurs par set et par profil.`);
  for (const profile of PROFILES) {
    const traces = Array.from({ length: Math.max(players, 300) }, () => income(profile, horizon));
    console.log(`\n=== ${profile.name} : ${profile.minutes} min par jour, connexions à ${profile.sessions.join(" h, ")} h ===`);
    console.log("Boosters par semaine (pioche miracle en plus : 7 cartes, hors boosters)");
    reportIncome(traces, horizon);
    reportSets(profile, traces.slice(0, players), horizon);
  }
}
