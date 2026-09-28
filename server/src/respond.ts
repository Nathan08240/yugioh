import {
  OcgLocation,
  OcgMessageType,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  ocgMessageTypeStrings,
  type OcgAttribute,
  type OcgCardLocSum,
  type OcgMessage,
  type OcgMessageSelectBattleCMD,
  type OcgMessageSelectIdlecmd,
  type OcgMessageSelectSum,
  type OcgMessageSelectTribute,
  type OcgOpCode,
  type OcgPosition,
  type OcgRace,
  type OcgResponse,
  type SelectFieldPlace,
} from "@n1xx1/ocgcore-wasm";

// No runtime import of the server's card data: the client bundles this file for its fallback choice.
type Announce = (opcodes: OcgOpCode[]) => number;
const cannotAnnounce: Announce = () => {
  throw new Error("aucune carte déclarable");
};

// Pass on position changes so monsters stay in attack and the duel moves forward.
function idle(msg: OcgMessageSelectIdlecmd): OcgResponse {
  const choices: [SelectIdleCMDAction, unknown[]][] = [
    [SelectIdleCMDAction.SELECT_SUMMON, msg.summons],
    [SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, msg.special_summons],
    [SelectIdleCMDAction.SELECT_ACTIVATE, msg.activates],
    [SelectIdleCMDAction.SELECT_MONSTER_SET, msg.monster_sets],
    [SelectIdleCMDAction.SELECT_SPELL_SET, msg.spell_sets],
  ];
  const choice = choices.find(([, list]) => list.length > 0);
  if (choice) return { type: OcgResponseType.SELECT_IDLECMD, action: choice[0], index: 0 };
  const action = msg.to_bp ? SelectIdleCMDAction.TO_BP : SelectIdleCMDAction.TO_EP;
  return { type: OcgResponseType.SELECT_IDLECMD, action, index: null };
}

function battle(msg: OcgMessageSelectBattleCMD): OcgResponse {
  if (msg.attacks.length > 0) {
    return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 };
  }
  const action = msg.to_m2 ? SelectBattleCMDAction.TO_M2 : SelectBattleCMDAction.TO_EP;
  return { type: OcgResponseType.SELECT_BATTLECMD, action, index: null };
}

// field_mask has a bit set for every zone that cannot be chosen: 0-7 own monsters, 8-15 own S/T, +16 opponent.
function freePlaces(player: number, fieldMask: number, count: number): SelectFieldPlace[] {
  const places: SelectFieldPlace[] = [];
  for (let bit = 0; bit < 32 && places.length < count; bit++) {
    if ((fieldMask >>> bit) & 1) continue;
    const owner = bit < 16 ? player : 1 - player;
    const location = bit % 16 < 8 ? OcgLocation.MZONE : OcgLocation.SZONE;
    places.push({ player: owner, location, sequence: bit % 8 });
  }
  if (places.length < count) throw new Error("aucune zone libre");
  return places;
}

// Some monsters count as two tributes (release_param 2), so add cards, in `order`, until the count is reached.
export function tributes(msg: OcgMessageSelectTribute, order = [...msg.selects.keys()]): number[] {
  const picked: number[] = [];
  let count = 0;
  for (const index of order) {
    if (count >= msg.min) break;
    picked.push(index);
    count += msg.selects[index].release_param;
  }
  return picked;
}

// A card counts for its low 16 bits or, when set, its high 16 bits (cards with two levels).
const sumValues = (amount: number) => (amount >>> 16 ? [amount & 0xffff, amount >>> 16] : [amount & 0xffff]);

function totals(cards: readonly OcgCardLocSum[]): number[] {
  let sums = [0];
  for (const card of cards) sums = sums.flatMap((sum) => sumValues(card.amount).map((value) => sum + value));
  return sums;
}

function* subsets(n: number, size: number, start = 0): Generator<number[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = start; i <= n - size; i++) for (const rest of subsets(n, size - 1, i + 1)) yield [i, ...rest];
}

// Smallest selection whose total hits the amount exactly, or else reaches it with no card to spare.
function sum(msg: OcgMessageSelectSum): number[] {
  const total = (picked: number[]) => totals([...msg.selects_must, ...picked.map((i) => msg.selects[i])]);
  const reaches = (picked: number[]) => total(picked).some((value) => value >= msg.amount);
  const exact = (picked: number[]) => total(picked).includes(msg.amount);
  const tight = (picked: number[]) => reaches(picked) && picked.every((drop) => !reaches(picked.filter((i) => i !== drop)));
  // select_max 1, a ritual's "equal or more": min and max are 0, any count goes.
  const largest = msg.select_max ? msg.selects.length : Math.min(msg.max, msg.selects.length);
  for (const fits of [exact, tight]) {
    for (let size = Math.max(msg.min, 1); size <= largest; size++) {
      for (const picked of subsets(msg.selects.length, size)) if (fits(picked)) return picked;
    }
  }
  throw new Error("aucune sélection n'atteint la somme demandée");
}

function counters(cards: readonly { count: number }[], count: number): number[] {
  let left = count;
  return cards.map((card) => {
    const taken = Math.min(card.count, left);
    left -= taken;
    return taken;
  });
}

// The `count` lowest bits set in a mask (races, attributes).
function lowBits(mask: bigint, count: number): bigint[] {
  const bits: bigint[] = [];
  for (let bit = 1n; bit <= mask && bits.length < count; bit <<= 1n) if ((mask & bit) !== 0n) bits.push(bit);
  return bits;
}

const firstIndices = (min: number) => Array.from({ length: Math.max(min, 1) }, (_, i) => i);

// Takes the first valid option of every question: the fallback of the bot (src/bot.ts). The server passes announceCard.
export function respond(msg: OcgMessage, announce = cannotAnnounce): OcgResponse {
  switch (msg.type) {
    case OcgMessageType.SELECT_IDLECMD:
      return idle(msg);
    case OcgMessageType.SELECT_BATTLECMD:
      return battle(msg);
    case OcgMessageType.SELECT_CHAIN:
      return { type: OcgResponseType.SELECT_CHAIN, index: msg.selects.length > 0 ? 0 : null };
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: true };
    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: true };
    case OcgMessageType.SELECT_OPTION:
      return { type: OcgResponseType.SELECT_OPTION, index: 0 };
    case OcgMessageType.SELECT_CARD:
      return { type: OcgResponseType.SELECT_CARD, indicies: firstIndices(msg.min) };
    case OcgMessageType.SELECT_TRIBUTE:
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: tributes(msg) };
    case OcgMessageType.SELECT_UNSELECT_CARD:
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: msg.can_finish ? null : 0 };
    case OcgMessageType.SELECT_PLACE:
      return { type: OcgResponseType.SELECT_PLACE, places: freePlaces(msg.player, msg.field_mask, msg.count) };
    case OcgMessageType.SELECT_DISFIELD:
      return { type: OcgResponseType.SELECT_DISFIELD, places: freePlaces(msg.player, msg.field_mask, msg.count) };
    case OcgMessageType.SELECT_POSITION:
      return { type: OcgResponseType.SELECT_POSITION, position: (msg.positions & -msg.positions) as OcgPosition };
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      return { type: OcgResponseType.SORT_CARD, order: null };
    case OcgMessageType.SELECT_SUM:
      return { type: OcgResponseType.SELECT_SUM, indicies: sum(msg) };
    case OcgMessageType.SELECT_COUNTER:
      return { type: OcgResponseType.SELECT_COUNTER, counters: counters(msg.cards, msg.count) };
    case OcgMessageType.ANNOUNCE_RACE:
      return { type: OcgResponseType.ANNOUNCE_RACE, races: lowBits(msg.available, msg.count) as OcgRace[] };
    case OcgMessageType.ANNOUNCE_ATTRIB:
      return { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: lowBits(BigInt(msg.available), msg.count).map(Number) as OcgAttribute[] };
    case OcgMessageType.ANNOUNCE_CARD:
      return { type: OcgResponseType.ANNOUNCE_CARD, card: announce(msg.opcodes) };
    // The engine takes the index of the chosen option.
    case OcgMessageType.ANNOUNCE_NUMBER:
      return { type: OcgResponseType.ANNOUNCE_NUMBER, value: 0 };
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 1 };
    default:
      throw new Error(`question du moteur non gérée : ${ocgMessageTypeStrings.get(msg.type)}`);
  }
}
