// Audit des cartes du pool : `pnpm --filter server audit-cartes [graines [codes [processus]]]` (3 graines, tout le pool, tous les coeurs moins 2).
// Chaque carte joue en bot contre bot, un deck construit autour d'elle des deux côtés, sur les graines 1 à N (fixes, relançable).
// Relève : erreurs de script ou du moteur, réponses refusées (en boucle ou non), questions non gérées, plateau reconstruit par le
// client différent de celui du moteur, duels qui ne finissent pas, moteur qui ne rend plus la main (le worker est tué au bout de 2 min).
// Hors `pnpm test` : 3 minutes pour tout le pool sur 3 graines. Pour suivre un duel (une carte, une graine) : AUDIT_TRACE=1, et
// AUDIT_LUA=fichier.lua charge ce script Lua dans chaque duel (isoler le script d'une carte).
import { fork } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { OcgLocation, OcgMessageType, OcgPosition, OcgProcessResult, OcgQueryFlags, OcgType, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { applyAll, newBoard, type Board, type Message } from "../../client/src/board.ts";
import { announceCard } from "../src/announce.ts";
import { Bot } from "../src/bot.ts";
import { cardName, readCard, readScript } from "../src/cards.ts";
import { YUGI } from "../src/decks.ts";
import { agreeToRules, fieldMonsters, fieldStats, lpLeft, openDuel, STANDARD_RULES, STARTING_LP, type Seed } from "../src/duel.ts";
import { POOL } from "../src/pool.ts";
import type { DuelEvent } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { hideCards, visibleTo } from "../src/visibility.ts";

export type Finding = { seed: number; kind: string; detail: string };
export type Played = { findings: Finding[]; turns: number; ended: boolean; types: number[] };
type Duel = Awaited<ReturnType<typeof openDuel>>;
type Result = { code: number; findings: Finding[]; duels: number; ended: number; turns: number; types: number[] };

// Un duel est déclaré sans fin au-delà de ces bornes.
const MAX_STEPS = 20_000;
const MAX_ANSWERS_PER_TURN = 400;
const MAX_TURNS = 150;
const RETRIES_IN_A_ROW = 3;
// Au-delà, le worker est tué : le moteur ne rend plus la main.
const CARD_TIMEOUT_MS = 120_000;
const POLYMERIZATION = 24094653;
// AUDIT_TRACE=1 : les messages, les erreurs du moteur et les réponses de chaque étape.
const TRACE = process.env.AUDIT_TRACE === "1";
const json = (value: unknown) => JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? String(item) : item));

// Les messages sans effet sur le plateau, pour ne lister dans un écart que ceux qui pouvaient le changer.
const NEUTRAL = new Set<number>([
  OcgMessageType.HINT, OcgMessageType.START, OcgMessageType.WAITING, OcgMessageType.NEW_PHASE, OcgMessageType.NEW_TURN, OcgMessageType.CHAINING,
  OcgMessageType.CHAINED, OcgMessageType.CHAIN_SOLVING, OcgMessageType.CHAIN_SOLVED, OcgMessageType.CHAIN_END, OcgMessageType.CHAIN_NEGATED,
  OcgMessageType.CHAIN_DISABLED, OcgMessageType.CARD_SELECTED, OcgMessageType.RANDOM_SELECTED, OcgMessageType.BECOME_TARGET, OcgMessageType.DAMAGE,
  OcgMessageType.RECOVER, OcgMessageType.LPUPDATE, OcgMessageType.PAY_LPCOST, OcgMessageType.ATTACK, OcgMessageType.BATTLE, OcgMessageType.WIN,
  OcgMessageType.DAMAGE_STEP_START, OcgMessageType.DAMAGE_STEP_END, OcgMessageType.SUMMONED, OcgMessageType.SPSUMMONED, OcgMessageType.FLIPSUMMONED,
  OcgMessageType.DRAW, OcgMessageType.MOVE, OcgMessageType.SET, OcgMessageType.POS_CHANGE, OcgMessageType.SWAP, OcgMessageType.SUMMONING,
  OcgMessageType.SPSUMMONING, OcgMessageType.FLIPSUMMONING, OcgMessageType.SHUFFLE_HAND, OcgMessageType.SHUFFLE_DECK, OcgMessageType.TOSS_COIN,
  OcgMessageType.TOSS_DICE, OcgMessageType.CONFIRM_CARDS, OcgMessageType.CONFIRM_DECKTOP, OcgMessageType.MISSED_EFFECT, OcgMessageType.CARD_TARGET,
  OcgMessageType.CANCEL_TARGET, OcgMessageType.BE_CHAIN_TARGET, OcgMessageType.EQUIP, OcgMessageType.ADD_COUNTER, OcgMessageType.REMOVE_COUNTER,
  OcgMessageType.CREATE_RELATION, OcgMessageType.RELEASE_RELATION, OcgMessageType.ATTACK_DISABLED, OcgMessageType.FIELD_DISABLED, OcgMessageType.CARD_HINT,
]);

// Hasard du bot, fixé par la graine.
const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const EXTRA_TYPES = OcgType.FUSION | OcgType.SYNCHRO | OcgType.XYZ | OcgType.LINK;
const isExtra = (code: number) => ((readCard(code)?.type ?? 0) & EXTRA_TYPES) !== 0;

// Les cartes du pool que le script nomme (matériaux, cibles de recherche), au plus 3.
function support(code: number): number[] {
  const text = readScript(`c${code}.lua`) ?? "";
  const named = [...new Set(text.match(/\b\d{6,9}\b/g)?.map(Number) ?? [])].filter((other) => other !== code && POOL.has(other) && !isExtra(other));
  return named.slice(0, 3);
}

// 40 cartes : 3 exemplaires de la carte (dans l'Extra Deck pour une carte d'Extra Deck), ses cartes liées par deux, le reste du deck de Yugi.
export function auditDeck(code: number): { main: number[]; extra: number[] } {
  const extra = isExtra(code);
  const fusion = ((readCard(code)?.type ?? 0) & OcgType.FUSION) !== 0 && POOL.has(POLYMERIZATION);
  const linked = [...support(code).flatMap((other) => [other, other]), ...(fusion ? [POLYMERIZATION] : [])];
  const own = extra ? [] : [code, code, code];
  const filler = YUGI.filter((other) => other !== code && !linked.includes(other));
  return { main: [...own, ...linked, ...filler].slice(0, 40), extra: extra ? [code, code, code] : [] };
}

const handCodes = (cards: readonly { code?: number }[]) =>
  cards
    .map((card) => card.code ?? 0)
    .sort((a, b) => a - b)
    .join(",");

// Écarts de nombre de cartes entre le plateau du client et celui du moteur, pour le joueur `controller`.
function countGaps(duel: Duel, board: Board, controller: 0 | 1): string[] {
  const side = board.players[controller];
  const count = (location: OcgLocation) => duel.lib.duelQueryCount(duel.handle, controller, location);
  const counts: [string, number, number][] = [
    ["main", side.hand.length, count(OcgLocation.HAND)],
    ["cimetière", side.grave.length, count(OcgLocation.GRAVE)],
    ["bannies", side.banished.length, count(OcgLocation.REMOVED)],
    ["deck", side.deck, count(OcgLocation.DECK)],
    ["extra deck", side.extra, count(OcgLocation.EXTRA)],
  ];
  return counts.filter(([, mine, real]) => mine !== real).map(([name, mine, real]) => `J${controller + 1} ${name} : ${mine} au lieu de ${real}`);
}

// Écarts sur les zones de monstres et de magies/pièges, la carte n'étant comparée que si `seat` a le droit de la voir.
function zoneGaps(duel: Duel, board: Board, controller: 0 | 1, seat: number): string[] {
  const flags = (OcgQueryFlags.CODE | OcgQueryFlags.POSITION) as OcgQueryFlags;
  const side = board.players[controller];
  const zones: [string, typeof side.monsters, OcgLocation, number][] = [
    ["monstres", side.monsters, OcgLocation.MZONE, 5],
    ["magies/pièges", side.spells, OcgLocation.SZONE, 6],
  ];
  const gaps: string[] = [];
  for (const [name, mine, location, size] of zones) {
    const real = duel.lib.duelQueryLocation(duel.handle, { flags, controller, location });
    for (let sequence = 0; sequence < size; sequence++) {
      const seen = mine[sequence];
      const card = real[sequence];
      const shown = controller === seat || ((card?.position ?? 0) & OcgPosition.FACEUP) !== 0;
      const same = seen && card ? !shown || seen.code === card.code : !seen === !card;
      if (!same) gaps.push(`J${controller + 1} ${name} zone ${sequence} : ${seen?.code ?? "vide"} au lieu de ${card?.code ?? "vide"}`);
    }
  }
  return gaps;
}

// Écarts entre le plateau que le client reconstruit pour `seat` et le plateau réel du moteur.
function boardGaps(duel: Duel, board: Board, seat: number): string[] {
  return ([0, 1] as const).flatMap((controller) => {
    const hand = duel.lib.duelQueryLocation(duel.handle, { flags: OcgQueryFlags.CODE, controller, location: OcgLocation.HAND });
    const sameHand = controller !== seat || handCodes(board.players[controller].hand) === handCodes(hand.flatMap((card) => card ?? []));
    return [...countGaps(duel, board, controller), ...(sameHand ? [] : [`J${controller + 1} cartes en main différentes`]), ...zoneGaps(duel, board, controller, seat)];
  });
}

// Un duel bot contre bot sur une graine, joué comme la salle du serveur : mêmes messages filtrés, mêmes questions masquées.
class Audit {
  readonly findings: Finding[] = [];
  readonly types = new Set<number>();
  turns = 0;
  ended = false;
  private readonly seed: number;
  private readonly bots: Bot[];
  private readonly boards: Board[];
  private readonly logs: DuelEvent[][] = [[], []];
  private duel!: Duel;
  private answers = 0;
  private retries = 0;
  private gapFound = false;
  private question: OcgMessage | undefined;

  constructor(code: number, seed: number) {
    const { main, extra } = auditDeck(code);
    const lengths = [main.length, main.length] as const;
    this.seed = seed;
    this.bots = [0, 1].map((seat) => new Bot(seat as 0 | 1, STARTING_LP, lengths, 0, [extra.length, extra.length], "normal", seeded(seed * 2 + seat)));
    this.boards = [0, 1].map(() => newBoard(STARTING_LP, lengths, [extra.length, extra.length]));
  }

  static async play(code: number, seed: number): Promise<Played> {
    const audit = new Audit(code, seed);
    const { main, extra } = auditDeck(code);
    audit.duel = await openDuel([BigInt(seed), 2n, 3n, 4n] satisfies Seed, [main, main], (text) => audit.engineError(text), undefined, STANDARD_RULES, [extra, extra]);
    if (process.env.AUDIT_LUA) audit.duel.lib.loadScript(audit.duel.handle, "audit.lua", readFileSync(process.env.AUDIT_LUA, "utf-8"));
    return audit.run();
  }

  private add(kind: string, detail: string) {
    if (!this.findings.some((found) => found.kind === kind && found.detail === detail)) this.findings.push({ seed: this.seed, kind, detail });
  }

  private engineError(text: string) {
    if (TRACE) console.log(`  moteur : ${text}`);
    this.add("erreur moteur", text.split("\n")[0].slice(0, 200));
  }

  private run(): Played {
    // Les replis du bot sont signalés par console.error : on les relève au lieu de les afficher.
    const original = console.error;
    const fallbacks: string[] = [];
    console.error = (text: unknown) => fallbacks.push(String(text).slice(0, 200));
    try {
      this.loop();
      if (!this.gapFound) this.checkBoards();
    } catch (error) {
      this.add("exception du duel", `${(error as Error).stack}`.slice(0, 600));
    } finally {
      console.error = original;
      for (const text of new Set(fallbacks)) this.add("repli du bot", text);
      this.duel.lib.destroyDuel(this.duel.handle);
    }
    return { findings: this.findings, turns: this.turns, ended: this.ended, types: [...this.types] };
  }

  private loop() {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (!this.step()) return;
    }
    this.add("duel sans fin", `${MAX_STEPS} étapes du moteur sans vainqueur`);
  }

  // Une étape du moteur : false quand le duel est fini ou qu'il faut s'arrêter.
  private step(): boolean {
    const { lib, handle } = this.duel;
    const status = lib.duelProcess(handle);
    const messages = lib.duelGetMessage(handle);
    if (TRACE) console.log(`${messages.map((msg) => OcgMessageType[msg.type]).join(" ")}`);
    if (messages.some((msg) => msg.type === OcgMessageType.RETRY)) return this.refused();
    this.retries = 0;
    this.observe(status === OcgProcessResult.WAITING ? messages.slice(0, -1) : messages);
    if (status === OcgProcessResult.END || messages.some((msg) => msg.type === OcgMessageType.WIN)) {
      this.ended = true;
      return false;
    }
    if (this.turns > MAX_TURNS) {
      const players = this.duel.lib.duelQueryField(this.duel.handle).players;
      const state = players.map((player, seat) => `${lpLeft(this.duel, seat as 0 | 1)} LP, deck ${player.deck_size}, main ${player.hand_size}`);
      this.add("duel sans fin", `plus de ${MAX_TURNS} tours sans vainqueur (${state.join(" / ")})`);
      return false;
    }
    this.question = messages.at(-1);
    return status !== OcgProcessResult.WAITING || this.answer();
  }

  // Le moteur a refusé la dernière réponse : le serveur la remplace par la première option valide, qui peut être refusée à son tour.
  private refused(): boolean {
    if (++this.retries === 1) this.add("réponse refusée", json(this.question).slice(0, 300));
    if (this.retries > RETRIES_IN_A_ROW) {
      this.add("réponses refusées en boucle", `question ${this.question && OcgMessageType[this.question.type]}`);
      return false;
    }
    const question = this.question;
    if (question && "player" in question) this.duel.lib.duelSetResponse(this.duel.handle, respond(hideCards(question, question.player), announceCard));
    return true;
  }

  // Les messages montrés à chaque siège, appliqués à son plateau ; le plateau est comparé à celui du moteur à chaque tour.
  private observe(shown: OcgMessage[]) {
    for (const msg of shown) {
      this.types.add(msg.type);
      if (msg.type === OcgMessageType.NEW_TURN) [this.turns, this.answers] = [this.turns + 1, 0];
    }
    for (const seat of [0, 1]) applyAll(this.boards[seat], feed(this.duel, shown, seat, this.logs[seat]) as unknown as Message[]);
    if (!this.gapFound && shown.some((msg) => msg.type === OcgMessageType.NEW_TURN)) this.checkBoards();
  }

  // Répond à la question en cours avec le bot du siège concerné ; false pour arrêter le duel.
  private answer(): boolean {
    const question = this.question;
    if (!question || !("player" in question)) return true;
    if (++this.answers > MAX_ANSWERS_PER_TURN) {
      this.add("duel sans fin", `plus de ${MAX_ANSWERS_PER_TURN} questions dans le tour ${this.turns}`);
      return false;
    }
    const seat = question.player;
    let response = agreeToRules(question);
    try {
      response ??= this.bots[seat].answer(hideCards(question, seat), this.logs[seat]);
    } catch (error) {
      this.add("question non gérée", `${error}`);
      return false;
    }
    if (TRACE) console.log(`  ${json(question)} -> ${json(response)}`);
    this.duel.lib.duelSetResponse(this.duel.handle, response);
    return true;
  }

  // Seul le premier écart d'un duel est relevé.
  private checkBoards() {
    for (const seat of [0, 1]) {
      const gaps = boardGaps(this.duel, this.boards[seat], seat);
      if (gaps.length === 0) continue;
      const suspects = [...this.types].filter((type) => !NEUTRAL.has(type)).map((type) => OcgMessageType[type]);
      this.add("plateau différent", `siège ${seat}, tour ${this.turns}, messages hors liste neutre : ${suspects.join(" ") || "aucun"} : ${gaps.slice(0, 3).join(" ; ")}`);
      this.gapFound = true;
      return;
    }
  }
}

// Les évènements d'un siège comme le serveur les lui envoie : messages filtrés puis stats des monstres.
function feed(duel: Duel, messages: OcgMessage[], seat: number, log: DuelEvent[]): DuelEvent[] {
  const events: DuelEvent[] = messages.flatMap((msg) => visibleTo(msg, seat) ?? []);
  if (events.length > 0) events.push(fieldStats(duel, seat, fieldMonsters(duel)));
  log.push(...events);
  return events;
}

export const playAudit = Audit.play;

export async function auditCard(code: number, seeds: number): Promise<Result> {
  const result: Result = { code, findings: [], duels: seeds, ended: 0, turns: 0, types: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    const played = await playAudit(code, seed);
    result.findings.push(...played.findings);
    result.types = [...new Set([...result.types, ...played.types])];
    result.ended += Number(played.ended);
    result.turns += played.turns;
  }
  return result;
}

// Le processus parent distribue les cartes à des workers et tue celui qui ne rend plus la main.
function parent(codes: number[], seeds: number, workers: number) {
  const started = Date.now();
  const results: Result[] = [];
  const queue = [...codes];
  let running = 0;
  const spawn = () => {
    const child = fork(import.meta.filename, [], { stdio: ["inherit", "inherit", "inherit", "ipc"] });
    running++;
    let timer: NodeJS.Timeout | undefined;
    const next = () => {
      clearTimeout(timer);
      const code = queue.shift();
      if (code === undefined) {
        child.kill();
        return;
      }
      child.send({ code, seeds });
      timer = setTimeout(() => {
        results.push({ code, findings: [{ seed: 0, kind: "moteur bloqué", detail: `pas de réponse au bout de ${CARD_TIMEOUT_MS / 1000} s` }], duels: seeds, ended: 0, turns: 0, types: [] });
        child.kill();
      }, CARD_TIMEOUT_MS);
    };
    child.on("message", (message: Result | "ready") => {
      if (message === "ready") return next();
      results.push(message);
      if (results.length % 100 === 0) console.error(`${results.length}/${codes.length} cartes`);
      next();
    });
    child.on("exit", () => {
      clearTimeout(timer);
      running--;
      if (queue.length > 0) spawn();
      else if (running === 0) report(results, seeds, Date.now() - started);
    });
  };
  for (let i = 0; i < Math.min(workers, codes.length); i++) spawn();
}

function report(results: Result[], seeds: number, ms: number) {
  const bad = results.filter((result) => result.findings.length > 0).sort((a, b) => a.code - b.code);
  const sum = (pick: (result: Result) => number) => results.reduce((total, result) => total + pick(result), 0);
  const duels = sum((result) => result.duels);
  console.log(`${results.length} cartes, ${seeds} graines chacune, ${Math.round(ms / 1000)} s : ${bad.length} avec au moins un problème`);
  console.log(`${duels} duels, ${sum((result) => result.ended)} finis avec un vainqueur, ${Math.round(sum((result) => result.turns) / duels)} tours en moyenne`);
  const seen = new Map<number, number>();
  for (const result of results) for (const type of result.types) seen.set(type, (seen.get(type) ?? 0) + 1);
  const rare = [...seen].filter(([type]) => !NEUTRAL.has(type)).map(([type, cards]) => `${OcgMessageType[type]} (${cards})`);
  console.log(`messages du moteur hors liste neutre vus, avec le nombre de cartes : ${rare.join(", ") || "aucun"}\n`);
  const byKind = new Map<string, Result[]>();
  for (const result of bad) for (const kind of new Set(result.findings.map((finding) => finding.kind))) byKind.set(kind, [...(byKind.get(kind) ?? []), result]);
  for (const [kind, list] of byKind) {
    console.log(`## ${kind} (${list.length} cartes)`);
    for (const { code, findings } of list) {
      const first = findings.find((finding) => finding.kind === kind);
      console.log(`${code} ${cardName(code)} [graine ${first?.seed}] ${first?.detail}`);
    }
    console.log();
  }
}

if (import.meta.main) {
  if (process.send) {
    const send = process.send.bind(process);
    process.on("message", async ({ code, seeds }: { code: number; seeds: number }) => send(await auditCard(code, seeds)));
    send("ready");
  } else {
    const [seeds = "3", only = "", procs = ""] = process.argv.slice(2);
    const wanted = only.split(",").filter(Boolean).map(Number);
    parent(wanted.length > 0 ? wanted : [...POOL].sort((a, b) => a - b), Number(seeds), Number(procs) || Math.max(1, availableParallelism() - 2));
  }
}
