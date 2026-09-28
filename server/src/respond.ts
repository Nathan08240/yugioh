import {
  OcgLocation,
  OcgMessageType,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  ocgMessageTypeStrings,
  type OcgMessage,
  type OcgMessageSelectBattleCMD,
  type OcgMessageSelectIdlecmd,
  type OcgMessageSelectTribute,
  type OcgPosition,
  type OcgResponse,
  type SelectFieldPlace,
} from "@n1xx1/ocgcore-wasm";

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
function firstFreePlace(player: number, fieldMask: number): SelectFieldPlace[] {
  for (let bit = 0; bit < 32; bit++) {
    if ((fieldMask >>> bit) & 1) continue;
    const owner = bit < 16 ? player : 1 - player;
    const location = bit % 16 < 8 ? OcgLocation.MZONE : OcgLocation.SZONE;
    return [{ player: owner, location, sequence: bit % 8 }];
  }
  throw new Error("aucune zone libre");
}

// Some monsters count as two tributes (release_param 2), so add cards until the count is reached.
function tributes(msg: OcgMessageSelectTribute): number[] {
  const picked: number[] = [];
  let count = 0;
  for (const [index, card] of msg.selects.entries()) {
    if (count >= msg.min) break;
    picked.push(index);
    count += card.release_param;
  }
  return picked;
}

const firstIndices = (min: number) => Array.from({ length: Math.max(min, 1) }, (_, i) => i);

// ponytail: takes the first valid option of every question, a real bot comes with F-bot.
export function respond(msg: OcgMessage): OcgResponse {
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
      return { type: OcgResponseType.SELECT_PLACE, places: firstFreePlace(msg.player, msg.field_mask) };
    case OcgMessageType.SELECT_POSITION:
      return { type: OcgResponseType.SELECT_POSITION, position: (msg.positions & -msg.positions) as OcgPosition };
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      return { type: OcgResponseType.SORT_CARD, order: null };
    default:
      throw new Error(`question du moteur non gérée : ${ocgMessageTypeStrings.get(msg.type)}`);
  }
}
