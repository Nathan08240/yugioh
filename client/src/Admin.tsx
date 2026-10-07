import { useEffect, useState } from "react";
import type { AdminError, AdminReport, ClientMessage, PublicDeck } from "../../server/src/protocol.ts";
import { Retirer } from "./DecksPublics.tsx";
import type { LobbyState } from "./lobby.ts";
import "./styles/admin.css";

type Send = (msg: ClientMessage) => void;

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
const MODES: Record<AdminReport["mode"], string> = { online: "En ligne", bot: "Bot", histoire: "Histoire", puzzle: "Puzzle" };
const KINDS: Record<AdminError["kind"], string> = { error: "Erreur", rejection: "Promesse rejetée", render: "Rendu React" };

// The bug reports, the ones to handle first, each one playable from either seat.
export function Signalements({ reports, send }: Readonly<{ reports?: AdminReport[]; send: Send }>) {
  if (!reports) return <p className="texte-2">Chargement des signalements…</p>;
  if (reports.length === 0) return <p className="texte-2">Aucun signalement.</p>;
  return (
    <table className="admin__table">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Joueur</th>
          <th scope="col">Mode</th>
          <th scope="col">Tour</th>
          <th scope="col">Message</th>
          <th scope="col">
            <span className="sr">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {reports.map(({ id, date, pseudo, mode, turn, message, handled }) => (
          <tr key={id} className={handled ? "admin__traite" : undefined}>
            <td>{DATE.format(new Date(date))}</td>
            <td>{pseudo}</td>
            <td>{MODES[mode]}</td>
            <td className="chiffres">{turn}</td>
            <td className="admin__message">{message || "—"}</td>
            <td>
              <div className="admin__actions">
                {([0, 1] as const).map((seat) => (
                  <button key={seat} type="button" className="btn btn--fantome" onClick={() => send({ type: "admin_report_replay", id, seat })}>
                    Revoir côté {seat + 1}
                  </button>
                ))}
                <button type="button" className="btn btn--fantome" onClick={() => send({ type: "admin_report_handled", id, handled: !handled })}>
                  {handled ? "Rouvrir" : "Marquer traité"}
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The browser errors, grouped, the most frequent first (the order the server gives).
export function Erreurs({ errors }: Readonly<{ errors?: AdminError[] }>) {
  if (!errors) return <p className="texte-2">Chargement des erreurs…</p>;
  if (errors.length === 0) return <p className="texte-2">Aucune erreur du navigateur.</p>;
  return (
    <table className="admin__table">
      <thead>
        <tr>
          <th scope="col">Fois</th>
          <th scope="col">Erreur</th>
          <th scope="col">Page</th>
          <th scope="col">Version</th>
          <th scope="col">Navigateur</th>
          <th scope="col">Dernier joueur</th>
          <th scope="col">Dernière fois</th>
        </tr>
      </thead>
      <tbody>
        {errors.map(({ id, kind, message, stack, page, build, browser, pseudo, count, lastSeen }) => (
          <tr key={id}>
            <td className="chiffres">{count}</td>
            <td className="admin__message">
              <span className="surtitre">{KINDS[kind]}</span>
              <br />
              {message}
              {stack && (
                <details>
                  <summary>Pile</summary>
                  <pre className="admin__pile">{stack}</pre>
                </details>
              )}
            </td>
            <td>{page || "—"}</td>
            <td>{build || "—"}</td>
            <td className="admin__navigateur">{browser || "—"}</td>
            <td>{pseudo ?? "—"}</td>
            <td>{DATE.format(new Date(lastSeen))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The published decks, newest first, each one withdrawable (the server lets an admin withdraw any of them).
export function DecksPublicsAdmin({ decks, send }: Readonly<{ decks?: PublicDeck[]; send: Send }>) {
  if (!decks) return <p className="texte-2">Chargement des decks publics…</p>;
  if (decks.length === 0) return <p className="texte-2">Aucun deck public.</p>;
  return (
    <table className="admin__table">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Auteur</th>
          <th scope="col">Deck</th>
          <th scope="col">Copies</th>
          <th scope="col">
            <span className="sr">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {decks.map(({ code, name, description, author, date, copies }) => (
          <tr key={code}>
            <td>{DATE.format(new Date(date))}</td>
            <td>{author}</td>
            <td className="admin__message">
              <b>{name}</b>
              <br />
              {description || "—"}
            </td>
            <td className="chiffres">{copies}</td>
            <td>
              <Retirer code={code} send={send} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The admin page: the server answers only to the accounts it lists, whatever this screen shows.
export function Admin({ state, send }: Readonly<{ state: LobbyState; send: Send }>) {
  const [onglet, setOnglet] = useState<"signalements" | "erreurs" | "decks">("signalements");
  // Once per visit: `send` changes on every render of the lobby.
  useEffect(() => {
    send({ type: "admin_reports" });
    send({ type: "admin_errors" });
    send({ type: "public_decks", sort: "recent" });
  }, []);
  const choix: [typeof onglet, string][] = [
    ["signalements", "Signalements"],
    ["erreurs", "Erreurs du navigateur"],
    ["decks", "Decks publics"],
  ];
  return (
    <div className="admin">
      <div data-entree>
        <p className="surtitre">Administration</p>
        <h1 className="titre">Admin</h1>
      </div>
      <div className="admin__onglets" role="group" aria-label="Section" data-entree>
        {choix.map(([id, label]) => (
          <button key={id} type="button" className="btn btn--fantome" aria-pressed={id === onglet} onClick={() => setOnglet(id)}>
            {label}
          </button>
        ))}
      </div>
      <section className="panneau admin__bloc" data-entree>
        {onglet === "signalements" && <Signalements reports={state.adminReports} send={send} />}
        {onglet === "erreurs" && <Erreurs errors={state.adminErrors} />}
        {onglet === "decks" && <DecksPublicsAdmin decks={state.publicDecks} send={send} />}
      </section>
    </div>
  );
}
