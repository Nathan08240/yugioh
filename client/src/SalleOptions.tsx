import { useState } from "react";
import { ROOM_HANDS, ROOM_LPS, ROOM_RULES, type ClientMessage, type RoomOptions } from "../../server/src/protocol.ts";
import { RuleBlock, roomSummary, specialRules } from "./regles.tsx";
import "./styles/parametres.css";
import "./styles/salle-options.css";

const DEFAULT: RoomOptions = { lp: 4000, hand: 5, goat: false };

type ChoixProps<T extends number | string> = { name: string; legend: string; values: readonly T[]; value: T; label: (value: T) => string; onChange: (value: T) => void };

// One option as a group of radio buttons, styled as in the settings screen.
function Choix<T extends number | string>({ name, legend, values, value, label, onChange }: Readonly<ChoixProps<T>>) {
  return (
    <fieldset className="salle-options__groupe">
      <legend className="titre-bloc">{legend}</legend>
      <div className="reglage__choix">
        {values.map((candidate) => (
          <label key={candidate}>
            <input type="radio" name={name} value={candidate} checked={candidate === value} onChange={() => onChange(candidate)} />
            <span>{label(candidate)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const NO_RULE = "aucune";
const ruleName = (rule: string) => (rule === NO_RULE ? "Aucune" : (specialRules([rule])[0]?.name ?? rule));

type FormProps = { title: string; action: string; submit: (options: RoomOptions) => void; cancel: () => void };

// The choices of the host of a private room or of a challenge, from the closed lists the server accepts.
export function RoomForm({ title, action, submit, cancel }: Readonly<FormProps>) {
  const [options, setOptions] = useState<RoomOptions>(DEFAULT);
  const [arc] = specialRules(options.rule ? [options.rule] : []);
  return (
    <form
      className="salle-options panneau"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        submit(options);
      }}
    >
      <h2 className="titre-bloc">{title}</h2>
      <Choix name="lp" legend="LP de départ" values={ROOM_LPS} value={options.lp} label={String} onChange={(lp) => setOptions({ ...options, lp })} />
      <Choix name="main" legend="Cartes en main au départ" values={ROOM_HANDS} value={options.hand} label={String} onChange={(hand) => setOptions({ ...options, hand })} />
      <label className="salle-options__goat">
        <input type="checkbox" checked={options.goat} onChange={(event) => setOptions({ ...options, goat: event.target.checked })} />
        <span>Appliquer la liste des cartes limitées Goat aux deux decks</span>
      </label>
      <Choix
        name="regle"
        legend="Règle de l'histoire"
        values={[NO_RULE, ...ROOM_RULES]}
        value={options.rule ?? NO_RULE}
        label={ruleName}
        onChange={(rule) => setOptions({ ...options, rule: rule === NO_RULE ? undefined : (rule as RoomOptions["rule"]) })}
      />
      {arc && <RuleBlock rule={arc} />}
      <div className="mode__actions">
        <button type="submit" className="btn btn--holo">
          {action}
        </button>
        <button type="button" className="btn btn--fantome" onClick={cancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}

// The rules of a room in a few lines, for the guest who has to accept them.
export function RoomRules({ options }: Readonly<{ options: RoomOptions }>) {
  const [arc] = specialRules(options.rule ? [options.rule] : []);
  return (
    <ul className="salle-regles">
      {roomSummary(options).details.map((detail) => (
        <li key={detail}>{detail}</li>
      ))}
      {arc && <li>Règles spéciales : {arc.name}.</li>}
    </ul>
  );
}

type PreviewProps = { preview?: { room: string; options: RoomOptions }; send: (msg: ClientMessage) => void; close: () => void };

// The custom rules of the room the player asked to join, over any screen: joining is accepting them.
export function ApercuSalle({ preview, send, close }: Readonly<PreviewProps>) {
  if (!preview) return null;
  return (
    <div className="apercu-salle panneau" role="alertdialog" aria-label={`Règles de la salle ${preview.room}`}>
      <p>
        La salle <b className="chiffres">{preview.room}</b> a des règles personnalisées.
      </p>
      <RoomRules options={preview.options} />
      <div className="alerte-ami__actions">
        <button type="button" className="btn btn--holo" onClick={() => send({ type: "join", room: preview.room })}>
          Accepter et rejoindre
        </button>
        <button type="button" className="btn btn--fantome" onClick={close}>
          Refuser
        </button>
      </div>
    </div>
  );
}
