import { BOOSTERS, drawPack } from "./boosters.ts";
import { cardInfo } from "./cards.ts";
import type { Db } from "./db.ts";
import type { CardSet, Printing } from "./pool.ts";
import type { ClientMessage, DraftRun, ServerMessage } from "./protocol.ts";
import { abandon, cardScore, isCodes, latest, type Limited, randomSet, recordDuel, reserveDeck, type Row, saveDeck, SEALED, SEALED_PACKS } from "./sealed.ts";

// The player (seat 0) and 3 bots.
export const DRAFTERS = 4;
export type DraftMessage = Extract<ClientMessage, { type: "draft" | "draft_start" | "draft_pick" | "draft_deck" | "draft_abandon" }>;
type Deck = { main: number[]; extra: number[] };

// Draft session storage, faked in tests.
export type DraftStore = {
  // The latest session, in progress or over.
  draftRun: (userId: string) => Promise<DraftRun | undefined>;
  // A new session, or the one already in progress.
  startDraft: (userId: string) => Promise<DraftRun>;
  // Resolves to the error when no draft is in progress or the card is not in the player's booster.
  pickDraft: (userId: string, index: number) => Promise<DraftRun | string>;
  saveDraftDeck: (userId: string, main: number[], extra: number[]) => Promise<DraftRun | string>;
  // Counts a duel of session `runId`; undefined when the session is not playing anymore.
  draftResult: (userId: string, runId: number, won: boolean) => Promise<DraftRun | undefined>;
  abandonDraft: (userId: string) => Promise<DraftRun | undefined>;
  // The deck of the bot the player faces, built from the cards the first bot drafted.
  draftBotDeck: (runId: number) => Promise<Deck>;
};

const DRAFT_TYPES: ReadonlySet<unknown> = new Set(["draft", "draft_start", "draft_pick", "draft_deck", "draft_abandon"]);
export const isDraftMessage = (msg: ClientMessage): msg is DraftMessage => DRAFT_TYPES.has(msg.type);

// Shape check of an incoming Draft message (draft_duel included), before its type is trusted.
export function validDraftMessage(msg: Record<string, unknown>): boolean {
  if (msg.type === "draft_pick") return Number.isInteger(msg.index);
  if (msg.type === "draft_deck") return isCodes(msg.main) && isCodes(msg.extra);
  return DRAFT_TYPES.has(msg.type) || msg.type === "draft_duel";
}

// The answer to a Draft message, or the error for the sender.
export async function draftReply(store: DraftStore, userId: string, msg: DraftMessage): Promise<ServerMessage | string> {
  let run: DraftRun | string | undefined;
  if (msg.type === "draft") run = await store.draftRun(userId);
  else if (msg.type === "draft_start") run = await store.startDraft(userId);
  else if (msg.type === "draft_pick") run = await store.pickDraft(userId, msg.index);
  else if (msg.type === "draft_deck") run = await store.saveDraftDeck(userId, msg.main, msg.extra);
  else run = await store.abandonDraft(userId);
  return typeof run === "string" ? run : { type: "draft", run: run ?? null };
}

// packs[s]: the booster in front of drafter s, picks[s]: the cards drafter s kept.
export type Draft = { round: number; packs: Printing[][]; picks: Printing[][] };

export const openPacks = (set: CardSet) => Array.from({ length: DRAFTERS }, () => drawPack(set));

// The card of best value (cardScore), the first one on a tie.
export function botPick(pack: Printing[]): number {
  const scores = pack.map(({ code }) => {
    const info = cardInfo(code);
    return info ? cardScore(info) : -Infinity;
  });
  return scores.indexOf(Math.max(...scores));
}

// The player keeps card `index` of their booster, each bot its best card; the rest goes to the next drafter, to the left
// (seat s to s + 1) on odd rounds and to the right on even ones. Empty boosters open the next round with `open`, until the
// last one. Undefined for a card not in the booster.
export function pickCard(draft: Draft, index: number, open: () => Printing[][]): Draft | undefined {
  if (!Number.isInteger(index) || draft.packs[0]?.[index] === undefined) return undefined;
  const kept = draft.packs.map((pack, seat) => (seat === 0 ? index : botPick(pack)));
  const picks = draft.picks.map((cards, seat) => [...cards, draft.packs[seat][kept[seat]]]);
  const left = draft.packs.map((pack, seat) => pack.filter((_, i) => i !== kept[seat]));
  const from = draft.round % 2 === 1 ? DRAFTERS - 1 : 1;
  const packs = left.map((_, seat) => left[(seat + from) % DRAFTERS]);
  if (packs[0].length > 0 || draft.round >= SEALED_PACKS) return { round: draft.round, packs, picks };
  return { round: draft.round + 1, packs: open(), picks };
}

// `status` may also be "drafting". `bots[s - 1]`: the cards bot s kept.
type DraftRow = Row & { round: number; packs: Printing[][]; bots: Printing[][] };

const draftView = (row: Row): DraftRun => {
  const { round, packs } = row as DraftRow;
  return { ...SEALED.view(row), round, pack: packs[0] ?? [] };
};
const DRAFT: Limited<DraftRun> = { table: "yugioh.draft_runs", name: "Draft", view: draftView };

// The unique index on the sessions in progress keeps a second one out, even when two starts cross.
export async function startDraftRun(db: Db, userId: string, setCode = randomSet()): Promise<DraftRun> {
  const set = BOOSTERS.get(setCode);
  if (!set) throw new Error(`booster inconnu : ${setCode}`);
  const bots = Array.from({ length: DRAFTERS - 1 }, (): Printing[] => []);
  await db`
    insert into yugioh.draft_runs (user_id, set_code, packs, bots)
    values (${userId}, ${set.code}, ${db.json(openPacks(set))}, ${db.json(bots)})
    on conflict do nothing`;
  return (await latest(db, DRAFT, userId)) as DraftRun;
}

// The row lock applies each pick once, in order: a player coming back finds the same booster.
export async function pickDraftCard(db: Db, userId: string, index: number): Promise<DraftRun | string> {
  return db.begin(async (sql) => {
    const [row] = await sql<DraftRow[]>`select * from yugioh.draft_runs where user_id = ${userId} and status = 'drafting' for update`;
    if (!row) return "aucun draft en cours";
    const set = BOOSTERS.get(row.set_code) as CardSet;
    const next = pickCard({ round: row.round, packs: row.packs, picks: [SEALED.view(row).pool, ...row.bots] }, index, () => openPacks(set));
    if (!next) return "carte absente du booster";
    const [mine, ...bots] = next.picks;
    const [updated] = await sql<DraftRow[]>`
      update yugioh.draft_runs set round = ${next.round}, packs = ${sql.json(next.packs)}, bots = ${sql.json(bots)},
        pool = ${mine.map((card) => card.code)}, rarities = ${mine.map((card) => card.rarity)},
        status = ${next.packs[0].length > 0 ? "drafting" : "building"}
      where id = ${row.id} returning *`;
    return draftView(updated);
  });
}

export async function draftOpponent(db: Db, runId: number): Promise<Deck> {
  const [row] = await db<{ bots: Printing[][] }[]>`select bots from yugioh.draft_runs where id = ${runId}`;
  return reserveDeck(row?.bots[0] ?? []);
}

export function dbDraftStore(db: Db): DraftStore {
  return {
    draftRun: (userId) => latest(db, DRAFT, userId),
    startDraft: (userId) => startDraftRun(db, userId),
    pickDraft: (userId, index) => pickDraftCard(db, userId, index),
    saveDraftDeck: (userId, main, extra) => saveDeck(db, DRAFT, userId, main, extra),
    draftResult: (userId, runId, won) => recordDuel(db, DRAFT, userId, runId, won),
    abandonDraft: (userId) => abandon(db, DRAFT, userId),
    draftBotDeck: (runId) => draftOpponent(db, runId),
  };
}
