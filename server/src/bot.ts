import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  OcgType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgCardLoc,
  type OcgCardLocActive,
  type OcgCardLocAttack,
  type OcgMessage,
  type OcgMessageAttack,
  type OcgMessageSelectBattleCMD,
  type OcgMessageSelectCard,
  type OcgMessageSelectChain,
  type OcgMessageSelectIdlecmd,
  type OcgMessageSelectPosition,
  type OcgMessageSelectTribute,
  type OcgMessageSelectUnselectCard,
  type OcgPosition as Position,
  type OcgResponse,
} from "@n1xx1/ocgcore-wasm";
import { cardAt, newBoard, playAll, type Board, type Card, type Message, type Place, type Side } from "../../client/src/board.ts";
import { announceCard } from "./announce.ts";
import { firstStep, lethal, safest, type Attacker, type Foe } from "./attack-plan.ts";
import { cardInfo, readCard, readScript } from "./cards.ts";
import type { BotLevel, DuelEvent, Seat } from "./protocol.ts";
import { respond, tributes } from "./respond.ts";

// A face-down monster the bot cannot see is assumed this strong.
const GUESS = 1500;
// Weight of a spell or trap when picking targets.
const NON_MONSTER = 1000;
// Guards against an effect the engine would let the bot activate again and again.
const MAX_ACTIVATIONS = 8;
// Beginner mistakes: chance to pass on an activation, to attack without looking at the strengths.
const SKIP_ACTIVATION = 0.5;
const CARELESS_ATTACK = 0.3;
const HAND_OR_FIELD = OcgLocation.HAND | OcgLocation.MZONE | OcgLocation.SZONE;
// Deck Master System, Stringid(153000000, 5): summon the Deck Master from outside the duel?
const SUMMON_DECK_MASTER = (153000000n << 20n) | 5n;

type Stats = { atk: number; def: number; level: number; type: number };
type Choice = [SelectIdleCMDAction, number];
type Attack = { index: number; target: Place | null };

function stats(code: number): Stats {
  const card = code ? readCard(code) : null;
  if (!card) return { atk: GUESS, def: GUESS, level: 4, type: OcgType.MONSTER };
  return { atk: card.attack, def: card.defense, level: card.level & 0xff, type: card.type };
}

// A monster on the field: the ATK and DEF the server sent (equips, fields, effects), else the printed ones.
function current(card: Card): Stats {
  const printed = stats(card.code);
  return { ...printed, atk: card.atk ?? printed.atk, def: card.def ?? printed.def };
}

const is = (code: number, type: number) => (stats(code).type & type) !== 0;
const faceUp = (card: Card) => (card.position & OcgPosition.FACEUP) !== 0;

function value(code: number): number {
  const card = stats(code);
  return card.type & OcgType.MONSTER ? Math.max(card.atk, card.def) : NON_MONSTER;
}

// What an attacker has to beat to destroy this monster.
function guard(card: Card): number {
  if (!card.code) return GUESS;
  const { atk, def } = current(card);
  return card.position & OcgPosition.ATTACK ? atk : def;
}

function tributesFor(level: number): number {
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}

const scripts = new Map<number, string>();

// ponytail: effects read from the card script text, a per-card table if this misjudges cards.
function script(code: number): string {
  let text = scripts.get(code);
  if (text === undefined) {
    text = readScript(`c${code}.lua`) ?? "";
    scripts.set(code, text);
  }
  return text;
}

const mass = (text: string) => text.includes("GetMatchingGroup") || text.includes("GetFieldGroup");
const has = (code: number, category: string) => script(code).includes(`CATEGORY_${category}`);

const cards = (zones: (Card | null)[]) => zones.filter((card): card is Card => card !== null);

// Plays one seat with simple rules, from what that seat may see only: its log of messages filtered by
// visibility.ts and its questions through hideCards. Anything it has no rule for goes to respond().
export class Bot {
  // Pause the server leaves before each answer.
  readonly delay: number;
  private board: Board;
  private readonly seat: Seat;
  private seen = 0;
  private threat: "attack" | "summon" | undefined;
  // ATK of the attacking or summoned monster behind the threat.
  private menace = GUESS;
  // Last card activated, to tell a boost (target own side) from an attack on the opponent.
  private source: { code: number; controller: number } | undefined;
  // Attack target chosen with the attacker, asked right after; null for a direct attack.
  private target: Place | null | undefined;
  private activations = 0;
  private readonly level: BotLevel;
  private readonly random: () => number;

  // `random` is injectable to test the beginner mistakes.
  constructor(seat: Seat, lp: number, decks: readonly number[], delay: number, extras?: readonly number[], level: BotLevel = "normal", random: () => number = Math.random) {
    this.seat = seat;
    this.level = level;
    this.random = random;
    this.board = newBoard(lp, decks, extras);
    this.delay = delay;
  }

  answer(question: OcgMessage, log: readonly DuelEvent[]): OcgResponse {
    this.see(log.slice(this.seen));
    this.seen = log.length;
    const target = this.target;
    this.target = undefined;
    try {
      return this.decide(question, target) ?? respond(question, announceCard);
    } catch (error) {
      console.error(`[bot] repli sur la première option : ${error}`);
      return respond(question, announceCard);
    }
  }

  private see(messages: readonly DuelEvent[]) {
    // board.ts reads no bigint field, so the engine form of the messages works as is.
    this.board = playAll(this.board, messages as unknown as Message[]);
    this.board.log = [];
    for (const msg of messages) this.track(msg);
  }

  private track(msg: DuelEvent) {
    switch (msg.type) {
      case OcgMessageType.NEW_TURN:
        this.activations = 0;
        this.threat = undefined;
        break;
      case OcgMessageType.NEW_PHASE:
      case OcgMessageType.BATTLE:
        this.threat = undefined;
        break;
      case OcgMessageType.ATTACK:
        if (msg.card.controller !== this.seat && this.harmful(msg)) {
          this.threat = "attack";
          const attacker = cardAt(this.board, msg.card);
          this.menace = attacker ? current(attacker).atk : GUESS;
        }
        break;
      case OcgMessageType.SUMMONING:
      case OcgMessageType.SPSUMMONING:
      case OcgMessageType.FLIPSUMMONING:
        if (msg.controller !== this.seat) {
          this.threat = "summon";
          this.menace = stats(msg.code).atk;
        }
        break;
      case OcgMessageType.CHAINING:
        this.source = { code: msg.code, controller: msg.controller };
        break;
      default:
        break;
    }
  }

  private harmful(msg: OcgMessageAttack): boolean {
    const attacker = cardAt(this.board, msg.card);
    const target = msg.target && cardAt(this.board, msg.target);
    if (!attacker || !target) return true;
    return current(attacker).atk >= guard(target);
  }

  private decide(q: OcgMessage, target: Place | null | undefined): OcgResponse | undefined {
    switch (q.type) {
      case OcgMessageType.SELECT_IDLECMD:
        return this.idle(q);
      case OcgMessageType.SELECT_BATTLECMD:
        return this.battle(q);
      case OcgMessageType.SELECT_CHAIN:
        return this.chain(q);
      case OcgMessageType.SELECT_CARD:
        return { type: OcgResponseType.SELECT_CARD, indicies: target === undefined ? this.best(q.selects, Math.max(q.min, 1)) : [attackTarget(q, target)] };
      case OcgMessageType.SELECT_UNSELECT_CARD:
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: this.unselect(q) };
      case OcgMessageType.SELECT_TRIBUTE:
        return { type: OcgResponseType.SELECT_TRIBUTE, indicies: cheapestTributes(q) };
      case OcgMessageType.SELECT_POSITION:
        return { type: OcgResponseType.SELECT_POSITION, position: this.position(q) };
      // Out of the duel it still counts as Deck Master and cannot be destroyed: losing it loses the duel.
      case OcgMessageType.SELECT_YESNO:
        return q.description === SUMMON_DECK_MASTER ? { type: OcgResponseType.SELECT_YESNO, yes: false } : undefined;
      default:
        return undefined;
    }
  }

  // A beginner makes this mistake with the given chance.
  private slips(chance: number): boolean {
    return this.level === "debutant" && this.random() < chance;
  }

  // Expert: the opponent's monsters that the bot's own monsters cannot block could take all its LP.
  private endangered(): boolean {
    if (this.level !== "expert") return false;
    const atks = cards(this.opponent().monsters).map((card) => current(card).atk).sort((a, b) => b - a);
    return atks.slice(cards(this.mine().monsters).length).reduce((sum, atk) => sum + atk, 0) >= this.mine().lp;
  }

  private mine(): Side {
    return this.board.players[this.seat];
  }

  private opponent(): Side {
    return this.board.players[1 - this.seat];
  }

  // Strongest ATK the opponent shows, a face-down monster counting as GUESS.
  private danger(): number {
    return Math.max(0, ...cards(this.opponent().monsters).map((card) => current(card).atk));
  }

  private idle(q: OcgMessageSelectIdlecmd): OcgResponse {
    const choice = this.idleChoice(q);
    if (choice) return { type: OcgResponseType.SELECT_IDLECMD, action: choice[0], index: choice[1] };
    const action = q.to_bp ? SelectIdleCMDAction.TO_BP : SelectIdleCMDAction.TO_EP;
    return { type: OcgResponseType.SELECT_IDLECMD, action, index: null };
  }

  // Special summons, useful spells, the best summon, better positions, then traps set face down.
  private idleChoice(q: OcgMessageSelectIdlecmd): Choice | undefined {
    if (q.special_summons.length > 0) return [SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, 0];
    const activate = this.slips(SKIP_ACTIVATION) ? -1 : this.activation(q.activates);
    if (activate !== -1) {
      this.activations++;
      return [SelectIdleCMDAction.SELECT_ACTIVATE, activate];
    }
    const summon = this.summon(q);
    if (summon) return summon;
    const reposition = q.pos_changes.findIndex((card) => this.repositions(card, q.to_bp));
    if (reposition !== -1) return [SelectIdleCMDAction.SELECT_POS_CHANGE, reposition];
    const set = this.setChoice(q.spell_sets);
    if (set !== -1) return [SelectIdleCMDAction.SELECT_SPELL_SET, set];
    return undefined;
  }

  // Traps first. An expert also sets quick-play spells and the spells it found no use for, up to three spell zones, never its last card.
  private setChoice(sets: readonly OcgCardLoc[]): number {
    if (this.level === "debutant") return -1;
    const trap = sets.findIndex((card) => is(card.code, OcgType.TRAP));
    if (trap !== -1 || this.level !== "expert" || cards(this.mine().spells.slice(0, 5)).length >= 3) return trap;
    return sets.findIndex((card) => !is(card.code, OcgType.FIELD) && (is(card.code, OcgType.QUICKPLAY) || this.mine().hand.length > 1));
  }

  private activation(activates: readonly OcgCardLocActive[]): number {
    if (this.activations >= MAX_ACTIVATIONS) return -1;
    return activates.findIndex((card) => this.useful(card.code));
  }

  // Traps wait for a response; destruction only when it removes more from the opponent.
  private useful(code: number): boolean {
    if (is(code, OcgType.TRAP)) return false;
    if (is(code, OcgType.EQUIP)) return cards(this.mine().monsters).some(faceUp);
    if (!has(code, "DESTROY")) return true;
    if (cardInfo(code)?.desc.includes("Spell")) return cards(this.opponent().spells).length > 0;
    if (this.level === "expert" && mass(script(code))) return this.destruction(script(code)) > 0;
    return cards(this.opponent().monsters).length > cards(this.mine().monsters).length;
  }

  // Attack position when nothing the opponent shows is stronger (and the LP are safe), else set the best wall.
  private summon(q: OcgMessageSelectIdlecmd): Choice | undefined {
    const attacker = this.strongest(q.summons, (card) => card.atk);
    if (attacker !== -1 && !this.endangered() && stats(q.summons[attacker].code).atk >= this.danger()) return [SelectIdleCMDAction.SELECT_SUMMON, attacker];
    const wall = this.strongest(q.monster_sets, (card) => card.def);
    if (wall !== -1) return [SelectIdleCMDAction.SELECT_MONSTER_SET, wall];
    return attacker === -1 ? undefined : [SelectIdleCMDAction.SELECT_SUMMON, attacker];
  }

  // Index of the best card by `rate` among those worth their tributes, or -1.
  private strongest(list: readonly OcgCardLoc[], rate: (card: Stats) => number): number {
    let best = -1;
    for (const [index, card] of list.entries()) {
      if (!this.worthTributes(card.code)) continue;
      if (best === -1 || rate(stats(card.code)) > rate(stats(list[best].code))) best = index;
    }
    return best;
  }

  // A tribute summon must bring more than the weakest monsters it sends to the graveyard. A monster the engine offers
  // without the tributes to pay for it is summoned for free (Duelist Kingdom), and must be: a turn without one loses.
  private worthTributes(code: number): boolean {
    const needed = tributesFor(stats(code).level);
    if (needed === 0) return true;
    const own = cards(this.mine().monsters)
      .map((card) => value(card.code))
      .sort((a, b) => a - b);
    if (own.length < needed) return true;
    return value(code) > own.slice(0, needed).reduce((total, worth) => total + worth, 0);
  }

  // To attack when stronger than anything the opponent shows, to defense when weaker once the battle is over.
  private repositions(card: OcgCardLoc, beforeBattle: boolean): boolean {
    const own = cardAt(this.board, card);
    if (!own) return false;
    const { atk } = current(own);
    const endangered = this.endangered();
    if (own.position & OcgPosition.DEFENSE) return !endangered && atk > this.danger();
    return !beforeBattle && (endangered || atk < this.danger());
  }

  private battle(q: OcgMessageSelectBattleCMD): OcgResponse {
    const plan = this.attackPlan(q.attacks);
    if (plan) {
      this.target = plan.target;
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: plan.index };
    }
    const action = q.to_m2 ? SelectBattleCMDAction.TO_M2 : SelectBattleCMDAction.TO_EP;
    return { type: OcgResponseType.SELECT_BATTLECMD, action, index: null };
  }

  // Strongest attacker first, on the most valuable monster it destroys, else directly when it can.
  // A beginner sometimes attacks the first monster with the first attacker; an expert leaves face-down monsters
  // for last, and then attacks them with the weakest attacker that beats them.
  private attackPlan(attacks: readonly OcgCardLocAttack[]): Attack | undefined {
    const opponent = 1 - this.seat;
    const targets = this.opponent().monsters.flatMap((card, sequence) => (card ? [{ card, place: { controller: opponent, location: OcgLocation.MZONE, sequence } }] : []));
    const atks = attacks.map((attack) => {
      const card = cardAt(this.board, attack);
      return card ? current(card).atk : stats(attack.code).atk;
    });
    if (attacks.length > 0 && this.slips(CARELESS_ATTACK)) return { index: 0, target: targets[0]?.place ?? null };
    const order = [...attacks.keys()].sort((a, b) => atks[b] - atks[a]);
    const plan = (list: number[], known: boolean): Attack | undefined => {
      for (const index of list) {
        const atk = atks[index];
        const beaten = targets.filter(({ card }) => atk > guard(card) && (!known || card.code !== 0)).sort((a, b) => value(b.card.code) - value(a.card.code));
        if (beaten.length > 0) return { index, target: beaten[0].place };
        if (attacks[index].can_direct) return { index, target: null };
      }
      return undefined;
    };
    if (this.level !== "expert") return plan(order, false);
    return this.expertAttack(attacks, atks, targets) ?? plan(order, true) ?? plan(order.reverse(), false);
  }

  // The order of attacks that ends the duel, else the one that destroys the most without losing a monster, face-down ones last.
  private expertAttack(attacks: readonly OcgCardLocAttack[], atks: readonly number[], targets: readonly { card: Card; place: Place }[]): Attack | undefined {
    const attackers: Attacker[] = attacks.map((attack, index) => ({ atk: atks[index], direct: attack.can_direct, pierce: script(attack.code).includes("EFFECT_PIERCE") }));
    const foes: Foe[] = targets.map(({ card }) => ({ guard: guard(card), attackPos: (card.position & OcgPosition.ATTACK) !== 0, worth: value(card.code), known: card.code !== 0 }));
    const plan = lethal(attackers, foes, this.opponent().lp) ?? safest(attackers, foes, false) ?? safest(attackers, foes, true);
    const step = plan && firstStep(plan, foes);
    if (!step) return undefined;
    return { index: step[0], target: step[1] === null ? null : targets[step[1]].place };
  }

  private chain(q: OcgMessageSelectChain): OcgResponse {
    const index = this.response(q);
    if (index !== null) this.threat = undefined;
    return { type: OcgResponseType.SELECT_CHAIN, index };
  }

  // Traps and monster effects answer a harmful attack; destruction traps also answer a summon.
  private response(q: OcgMessageSelectChain): number | null {
    if (q.selects.length === 0) return null;
    if (q.forced) return 0;
    if (!this.threat) return null;
    if (this.level === "expert") return this.bestResponse(q);
    const usable = [...q.selects.keys()].filter((i) => !is(q.selects[i].code, OcgType.SPELL));
    const destroy = usable.find((i) => has(q.selects[i].code, "DESTROY"));
    if (destroy !== undefined) return destroy;
    return this.threat === "attack" && usable.length > 0 ? usable[0] : null;
  }

  // Expert: the answer worth the most, none when no card is worth using.
  private bestResponse(q: OcgMessageSelectChain): number | null {
    let best: number | null = null;
    let top = 0;
    for (const [index, card] of q.selects.entries()) {
      const worth = this.responseWorth(card.code);
      if (worth > top) [best, top] = [index, worth];
    }
    return best;
  }

  // In ATK points: destroying the monster behind the threat is worth its ATK, stopping its attack half of it, a mass
  // destruction what it takes from the opponent minus what it takes from the bot, and only half of that when it hits one monster.
  private responseWorth(code: number): number {
    if (is(code, OcgType.SPELL) && !is(code, OcgType.QUICKPLAY)) return 0;
    const text = script(code);
    if (has(code, "DESTROY") && !cardInfo(code)?.desc.includes("Spell")) return this.destruction(text);
    if (this.threat !== "attack") return 0;
    if (text.includes("NegateAttack")) return this.menace / 2;
    if (["EFFECT_AVOID_BATTLE_DAMAGE", "EFFECT_INDESTRUCTABLE_BATTLE", "EFFECT_CANNOT_ATTACK"].some((effect) => text.includes(effect))) return this.menace / 3;
    return has(code, "DAMAGE") ? 1 : 0;
  }

  private destruction(text: string): number {
    if (!mass(text)) return this.menace;
    const attackOnly = text.includes("IsAttackPos");
    const lost = cards(this.opponent().monsters).filter((card) => !attackOnly || (card.position & OcgPosition.ATTACK) !== 0);
    const cost = text.replaceAll(" ", "").includes("LOCATION_MZONE,LOCATION_MZONE") ? cards(this.mine().monsters) : [];
    const net = lost.reduce((sum, card) => sum + value(card.code), 0) - cost.reduce((sum, card) => sum + value(card.code), 0);
    return Math.max(0, lost.length > 1 ? net : net / 2);
  }

  // Indices of the `count` best cards: the opponent's or public ones by value, the bot's own hand and field least valuable first.
  private best(list: readonly OcgCardLoc[], count: number): number[] {
    const friendly = this.friendly();
    const score = (card: OcgCardLoc) => {
      const worth = value(card.code);
      const own = card.controller === this.seat;
      if (friendly) return own ? worth : -worth;
      return own && (card.location & HAND_OR_FIELD) !== 0 ? -worth : worth;
    };
    return [...list.keys()].sort((a, b) => score(list[b]) - score(list[a])).slice(0, count);
  }

  // An equip or an ATK boost the bot activated targets its own side.
  private friendly(): boolean {
    const source = this.source;
    if (source?.controller !== this.seat) return false;
    return is(source.code, OcgType.EQUIP) || (has(source.code, "ATKCHANGE") && !has(source.code, "DESTROY"));
  }

  // Picks one card, then finishes as soon as the selection is valid.
  private unselect(q: OcgMessageSelectUnselectCard): number | null {
    if (q.can_finish && (q.unselect_cards.length > 0 || q.select_cards.length === 0)) return null;
    return this.best(q.select_cards, 1)[0] ?? null;
  }

  private position(q: OcgMessageSelectPosition): Position {
    const weak = this.endangered() || stats(q.code).atk < this.danger();
    const order = weak
      ? [OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEDOWN_DEFENSE, OcgPosition.FACEUP_ATTACK]
      : [OcgPosition.FACEUP_ATTACK, OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEDOWN_DEFENSE];
    return order.find((position) => (q.positions & position) !== 0) ?? ((q.positions & -q.positions) as Position);
  }
}

// The planned target, else the easiest one.
function attackTarget(q: OcgMessageSelectCard, target: Place | null): number {
  const planned = q.selects.findIndex((card) => target && card.controller === target.controller && card.location === target.location && card.sequence === target.sequence);
  if (planned !== -1) return planned;
  return [...q.selects.keys()].sort((a, b) => guard(q.selects[a]) - guard(q.selects[b]))[0];
}

const cheapestTributes = (q: OcgMessageSelectTribute) => tributes(q, [...q.selects.keys()].sort((a, b) => value(q.selects[a].code) - value(q.selects[b].code)));
