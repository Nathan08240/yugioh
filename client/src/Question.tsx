import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  ocgMessageTypeStrings,
  type OcgMessage,
  type OcgResponse,
} from "@n1xx1/ocgcore-wasm";
import type { ReactNode } from "react";
import { respond as automatic } from "../../server/src/respond.ts";
import type { Board, EngineMessage, Place } from "./board.ts";
import type { Targets } from "./Board.tsx";
import { cardName, effectText, has, useDuelView, type Cards, type Strings } from "./cards.ts";
import { freePlaces, placeKey } from "./question.ts";

type Q<T extends OcgMessageType> = Extract<EngineMessage, { type: T }>;
type Located = Place & { code: number };
export type Ctx = { board: Board; cards: Cards; strings: Strings; picked: string[]; setPicked: (keys: string[]) => void; respond: (response: OcgResponse) => void };
export type Ui = Omit<Targets, "picked"> & { panel: ReactNode };

const NONE: ReadonlySet<string> = new Set();

// Turns an engine question into clickable cards or zones on the board, and the panel that goes with them.
export function interaction(question: EngineMessage | undefined, ctx: Ctx): Ui {
  if (!question) return { targets: NONE, panel: <p className="muted">L'adversaire réfléchit…</p> };
  switch (question.type) {
    case OcgMessageType.SELECT_IDLECMD:
      return idle(question, ctx);
    case OcgMessageType.SELECT_BATTLECMD:
      return battle(question, ctx);
    case OcgMessageType.SELECT_CHAIN:
      return chain(question, ctx);
    case OcgMessageType.SELECT_CARD:
      return pickCards(`Choisissez ${range(question.min, question.max)} carte(s)`, question, () => 1, ctx, (indicies) =>
        ctx.respond({ type: OcgResponseType.SELECT_CARD, indicies }),
      );
    case OcgMessageType.SELECT_TRIBUTE:
      return tribute(question, ctx);
    case OcgMessageType.SELECT_UNSELECT_CARD:
      return unselect(question, ctx);
    case OcgMessageType.SELECT_PLACE:
      return place(question, ctx);
    case OcgMessageType.SELECT_POSITION:
      return position(question, ctx);
    case OcgMessageType.SELECT_EFFECTYN: {
      const title = `Activer l'effet de ${cardName(ctx.cards, question.code)} ?`;
      return yesNo(title, effectText(ctx.cards, ctx.strings, question.description), ctx, OcgResponseType.SELECT_EFFECTYN, [question]);
    }
    case OcgMessageType.SELECT_YESNO: {
      const title = effectText(ctx.cards, ctx.strings, question.description) ?? "Confirmer ?";
      return yesNo(title, undefined, ctx, OcgResponseType.SELECT_YESNO, []);
    }
    case OcgMessageType.SELECT_OPTION:
      return option(question, ctx);
    default:
      return generic(question, ctx);
  }
}

const range = (min: number, max: number) => (min === max ? String(min) : `${min} à ${max}`);

type Choice = { place: Located; id: string; label: string; response: OcgResponse };
type Action = { label: string; response: OcgResponse };

// Card actions (summon, attack, activate...): click a highlighted card, then one of its actions.
function menu(title: string, choices: Choice[], actions: Action[], ctx: Ctx): Ui {
  const focused = ctx.picked[0];
  const own = choices.filter((choice) => placeKey(choice.place) === focused);
  const places = [...new Map(choices.map((choice) => [placeKey(choice.place), choice.place])).values()];
  const focus = (key: string) => ctx.setPicked([key]);
  return {
    targets: new Set(places.map(placeKey)),
    onPick: focus,
    panel: (
      <>
        <h3>{title}</h3>
        {places.length > 0 && <Chips places={places} picked={ctx.picked} onPick={focus} />}
        {own.length > 0 && (
          <div className="actions">
            {own.map((choice) => (
              <button key={choice.id} type="button" className="btn" onClick={() => ctx.respond(choice.response)}>
                {choice.label}
              </button>
            ))}
          </div>
        )}
        <Buttons actions={actions} ctx={ctx} />
      </>
    ),
  };
}

function Buttons({ actions, ctx }: Readonly<{ actions: Action[]; ctx: Ctx }>) {
  return (
    <div className="actions">
      {actions.map((action) => (
        <button key={action.label} type="button" className="btn btn--fantome" onClick={() => ctx.respond(action.response)}>
          {action.label}
        </button>
      ))}
    </div>
  );
}

const activateLabel = (ctx: Ctx, description: string) => {
  const text = effectText(ctx.cards, ctx.strings, description);
  return text ? `Activer : ${text}` : "Activer";
};

const IDLE_LISTS = [
  ["summons", SelectIdleCMDAction.SELECT_SUMMON, "Invoquer"],
  ["special_summons", SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, "Invocation spéciale"],
  ["pos_changes", SelectIdleCMDAction.SELECT_POS_CHANGE, "Changer de position"],
  ["monster_sets", SelectIdleCMDAction.SELECT_MONSTER_SET, "Poser"],
  ["spell_sets", SelectIdleCMDAction.SELECT_SPELL_SET, "Poser"],
] as const;

function idle(q: Q<OcgMessageType.SELECT_IDLECMD>, ctx: Ctx): Ui {
  const idleResponse = (action: SelectIdleCMDAction, index: number | null): OcgResponse => ({ type: OcgResponseType.SELECT_IDLECMD, action, index });
  const choices: Choice[] = [
    ...IDLE_LISTS.flatMap(([list, action, label]) =>
      q[list].map((card, index) => ({ place: card, id: `${action}-${index}`, label, response: idleResponse(action, index) })),
    ),
    ...q.activates.map((card, index) => ({
      place: card,
      id: `activate-${index}`,
      label: activateLabel(ctx, card.description),
      response: idleResponse(SelectIdleCMDAction.SELECT_ACTIVATE, index),
    })),
  ];
  const actions: Action[] = [];
  if (q.to_bp) actions.push({ label: "Battle Phase", response: idleResponse(SelectIdleCMDAction.TO_BP, null) });
  if (q.to_ep) actions.push({ label: "End Phase", response: idleResponse(SelectIdleCMDAction.TO_EP, null) });
  return menu("À vous de jouer : choisissez une carte ou changez de phase", choices, actions, ctx);
}

function battle(q: Q<OcgMessageType.SELECT_BATTLECMD>, ctx: Ctx): Ui {
  const battleResponse = (action: SelectBattleCMDAction, index: number | null): OcgResponse => ({ type: OcgResponseType.SELECT_BATTLECMD, action, index });
  const choices: Choice[] = [
    ...q.attacks.map((card, index) => ({ place: card, id: `attack-${index}`, label: "Attaquer", response: battleResponse(SelectBattleCMDAction.SELECT_BATTLE, index) })),
    ...q.chains.map((card, index) => ({
      place: card,
      id: `chain-${index}`,
      label: activateLabel(ctx, card.description),
      response: battleResponse(SelectBattleCMDAction.SELECT_CHAIN, index),
    })),
  ];
  const actions: Action[] = [];
  if (q.to_m2) actions.push({ label: "Main Phase 2", response: battleResponse(SelectBattleCMDAction.TO_M2, null) });
  if (q.to_ep) actions.push({ label: "End Phase", response: battleResponse(SelectBattleCMDAction.TO_EP, null) });
  return menu("Battle Phase : choisissez un monstre qui attaque", choices, actions, ctx);
}

function chain(q: Q<OcgMessageType.SELECT_CHAIN>, ctx: Ctx): Ui {
  const choices = q.selects.map((card, index) => ({
    place: card,
    id: String(index),
    label: activateLabel(ctx, card.description),
    response: { type: OcgResponseType.SELECT_CHAIN, index } as const,
  }));
  const actions: Action[] = q.forced ? [] : [{ label: "Ne pas enchaîner", response: { type: OcgResponseType.SELECT_CHAIN, index: null } }];
  const last = ctx.board.chain.at(-1);
  const title = last ? `Répondre à ${cardName(ctx.cards, last.code)} ?` : "Activer une carte maintenant ?";
  return menu(title, choices, actions, ctx);
}

type Pickable = { min: number; max: number; can_cancel: boolean; selects: Located[] };

// Toggles cards until the count is right. A single card answers at once.
function pickCards(title: string, q: Pickable, weight: (index: number) => number, ctx: Ctx, answer: (indicies: number[] | null) => void): Ui {
  const keys = q.selects.map(placeKey);
  const indices = ctx.picked.map((key) => keys.indexOf(key));
  const total = indices.reduce((sum, index) => sum + weight(index), 0);
  const valid = total >= q.min && indices.length <= q.max;
  const toggle = (key: string) => {
    if (q.max === 1) answer([keys.indexOf(key)]);
    else ctx.setPicked(ctx.picked.includes(key) ? ctx.picked.filter((other) => other !== key) : [...ctx.picked, key]);
  };
  return {
    targets: new Set(keys),
    onPick: toggle,
    panel: (
      <>
        <h3>{title}</h3>
        <Chips places={q.selects} picked={ctx.picked} onPick={toggle} />
        <div className="actions">
          {q.max > 1 && (
            <button type="button" className="btn" disabled={!valid} onClick={() => answer(indices)}>
              Valider ({indices.length})
            </button>
          )}
          {q.can_cancel && (
            <button type="button" className="btn btn--fantome" onClick={() => answer(null)}>
              Annuler
            </button>
          )}
        </div>
      </>
    ),
  };
}

// Some monsters count as two tributes (release_param 2).
function tribute(q: Q<OcgMessageType.SELECT_TRIBUTE>, ctx: Ctx): Ui {
  const title = `Choisissez les monstres à sacrifier (${range(q.min, q.max)})`;
  return pickCards(title, q, (index) => q.selects[index].release_param, ctx, (indicies) => ctx.respond({ type: OcgResponseType.SELECT_TRIBUTE, indicies }));
}

function unselect(q: Q<OcgMessageType.SELECT_UNSELECT_CARD>, ctx: Ctx): Ui {
  const answer = (index: number | null) => ctx.respond({ type: OcgResponseType.SELECT_UNSELECT_CARD, index });
  const all = [...q.select_cards, ...q.unselect_cards];
  const keys = all.map(placeKey);
  const pick = (key: string) => answer(keys.indexOf(key));
  const done = q.can_finish || q.can_cancel;
  return {
    targets: new Set(keys),
    onPick: pick,
    panel: (
      <>
        <h3>Choisissez {range(q.min, q.max)} carte(s), une à la fois</h3>
        <Chips places={q.select_cards} picked={[]} onPick={pick} />
        {q.unselect_cards.length > 0 && <p className="muted">Déjà choisies (cliquer pour retirer) :</p>}
        <Chips places={q.unselect_cards} picked={q.unselect_cards.map(placeKey)} onPick={pick} />
        {done && (
          <div className="actions">
            <button type="button" className="btn btn--fantome" onClick={() => answer(null)}>
              {q.can_finish ? "Terminer" : "Annuler"}
            </button>
          </div>
        )}
      </>
    ),
  };
}

function place(q: Q<OcgMessageType.SELECT_PLACE>, ctx: Ctx): Ui {
  const free = new Map(freePlaces(q.player, q.field_mask).map((zone) => [placeKey(zone), zone]));
  const pick = (key: string) => {
    const keys = [...ctx.picked, key];
    if (keys.length < q.count) {
      ctx.setPicked(keys);
      return;
    }
    const places = keys.flatMap((picked) => {
      const zone = free.get(picked);
      return zone ? [{ player: zone.controller, location: zone.location, sequence: zone.sequence }] : [];
    });
    ctx.respond({ type: OcgResponseType.SELECT_PLACE, places });
  };
  return {
    targets: new Set(free.keys()),
    onPick: pick,
    panel: (
      <>
        <h3>Choisissez {q.count > 1 ? `${q.count} zones` : "une zone"}</h3>
        <p className="muted">Cliquez sur une zone en surbrillance du plateau.</p>
      </>
    ),
  };
}

const POSITIONS: [number, string][] = [
  [OcgPosition.FACEUP_ATTACK, "Attaque"],
  [OcgPosition.FACEDOWN_ATTACK, "Attaque face cachée"],
  [OcgPosition.FACEUP_DEFENSE, "Défense"],
  [OcgPosition.FACEDOWN_DEFENSE, "Défense face cachée"],
];

function position(q: Q<OcgMessageType.SELECT_POSITION>, ctx: Ctx): Ui {
  const actions = POSITIONS.filter(([bit]) => has(q.positions, bit)).map(([bit, label]) => ({
    label,
    response: { type: OcgResponseType.SELECT_POSITION, position: bit } as OcgResponse,
  }));
  return {
    targets: NONE,
    panel: (
      <>
        <h3>Position de {cardName(ctx.cards, q.code)}</h3>
        <Buttons actions={actions} ctx={ctx} />
      </>
    ),
  };
}

function yesNo(title: string, text: string | undefined, ctx: Ctx, type: OcgResponseType.SELECT_YESNO | OcgResponseType.SELECT_EFFECTYN, cards: Located[]): Ui {
  return {
    targets: new Set(cards.map(placeKey)),
    panel: (
      <>
        <h3>{title}</h3>
        {text && <p>{text}</p>}
        <Buttons
          actions={[
            { label: "Oui", response: { type, yes: true } },
            { label: "Non", response: { type, yes: false } },
          ]}
          ctx={ctx}
        />
      </>
    ),
  };
}

function option(q: Q<OcgMessageType.SELECT_OPTION>, ctx: Ctx): Ui {
  const actions = q.options.map((description, index) => ({
    label: effectText(ctx.cards, ctx.strings, description) ?? `Option ${index + 1}`,
    response: { type: OcgResponseType.SELECT_OPTION, index } as OcgResponse,
  }));
  return { targets: NONE, panel: <><h3>Choisissez une option</h3><Buttons actions={actions} ctx={ctx} /></> };
}

// The server's first-valid-option player, or undefined for the questions it cannot answer either.
function fallback(question: EngineMessage): OcgResponse | undefined {
  try {
    // respond() reads no bigint field, so the wire form of a question works as is.
    return automatic(question as unknown as OcgMessage);
  } catch {
    return undefined;
  }
}

function generic(question: EngineMessage, ctx: Ctx): Ui {
  const response = fallback(question);
  return {
    targets: NONE,
    panel: (
      <>
        <h3>Question du jeu : {ocgMessageTypeStrings.get(question.type) ?? question.type}</h3>
        <p className="muted">Ce choix n'a pas encore d'écran dédié.</p>
        {response ? <Buttons actions={[{ label: "Laisser le jeu choisir", response }]} ctx={ctx} /> : <p className="error">Choix impossible depuis cet écran.</p>}
      </>
    ),
  };
}

const LOCATIONS = new Map<number, string>([
  [OcgLocation.HAND, "main"],
  [OcgLocation.DECK, "deck"],
  [OcgLocation.GRAVE, "cimetière"],
  [OcgLocation.REMOVED, "bannie"],
  [OcgLocation.EXTRA, "extra deck"],
]);

function placeLabel(place: Place): string {
  if (place.location === OcgLocation.MZONE) return `zone monstre ${place.sequence + 1}`;
  if (place.location === OcgLocation.SZONE && place.sequence === 5) return "zone terrain";
  if (place.location === OcgLocation.SZONE) return `zone magie/piège ${place.sequence + 1}`;
  return LOCATIONS.get(place.location) ?? "";
}

// Question cards as a list: hidden opponent cards come with code 0, their place tells them apart.
function Chips({ places, picked, onPick }: Readonly<{ places: Located[]; picked: readonly string[]; onPick: (key: string) => void }>) {
  const { cards, show, seat } = useDuelView();
  return (
    <ul className="chips">
      {places.map((located) => {
        const key = placeKey(located);
        const reveal = () => show(located.code);
        return (
          <li key={key}>
            <button type="button" className={picked.includes(key) ? "chip picked" : "chip"} onClick={() => onPick(key)} onMouseEnter={reveal} onFocus={reveal}>
              {cardName(cards, located.code)}
              <small>
                {placeLabel(located)}
                {located.controller === seat ? "" : " adverse"}
              </small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
