import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { AdminError, AdminReport, ClientMessage } from "../../server/src/protocol.ts";
import { Erreurs, Signalements } from "./Admin.tsx";
import { initialLobby, reduce } from "./lobby.ts";
import { Shell } from "./Shell.tsx";

type Props = { children?: ReactNode; onClick?: () => void };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<Props>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

const reports: AdminReport[] = [
  { id: 7, date: "2026-10-08T10:00:00.000Z", pseudo: "Yugi", mode: "online", turn: 4, message: "Le monstre ne s'invoque pas", handled: false },
  { id: 5, date: "2026-10-07T10:00:00.000Z", pseudo: "Kaiba", mode: "puzzle", turn: 1, message: "", handled: true },
];
const errors: AdminError[] = [
  { id: 2, kind: "render", message: "TypeError: x is undefined", stack: "TypeError\n    at f", page: "profil", build: "2026-10-08 11:00", browser: "Edge", pseudo: "Joey", count: 12, firstSeen: "2026-10-07T10:00:00.000Z", lastSeen: "2026-10-08T10:00:00.000Z" },
  { id: 3, kind: "rejection", message: "échec", stack: "", page: "", build: "", browser: "", pseudo: null, count: 1, firstSeen: "2026-10-07T10:00:00.000Z", lastSeen: "2026-10-07T10:00:00.000Z" },
];

it("garde les listes du serveur dans l'état, que le joueur quitte ensuite", () => {
  const state = reduce(reduce(initialLobby, { type: "admin_reports", reports }), { type: "admin_errors", errors });
  expect(state.adminReports).toEqual(reports);
  expect(state.adminErrors).toEqual(errors);
  expect(reduce(state, { type: "left" }).adminReports).toEqual(reports);
});

it("liste les signalements avec joueur, mode, tour et message, et grise ceux déjà traités", () => {
  const html = renderToStaticMarkup(<Signalements reports={reports} send={() => {}} />);
  for (const texte of ["Yugi", "En ligne", "Le monstre ne s&#x27;invoque pas", "Kaiba", "Puzzle", "Marquer traité", "Rouvrir"]) expect(html).toContain(texte);
  expect(html.match(/admin__traite/g)).toHaveLength(1);
  expect(renderToStaticMarkup(<Signalements send={() => {}} />)).toContain("Chargement");
  expect(renderToStaticMarkup(<Signalements reports={[]} send={() => {}} />)).toContain("Aucun signalement");
});

it("rejoue un signalement des deux côtés et le marque traité ou rouvert", () => {
  const sent: ClientMessage[] = [];
  const tree = Signalements({ reports, send: (msg) => sent.push(msg) });
  const click = (label: string, nth = 0) => elements(tree).filter((element) => element.type === "button" && text(element).includes(label))[nth].props.onClick?.();
  click("Revoir côté 1");
  click("Revoir côté 2");
  click("Marquer traité");
  click("Rouvrir");
  expect(sent).toEqual([
    { type: "admin_report_replay", id: 7, seat: 0 },
    { type: "admin_report_replay", id: 7, seat: 1 },
    { type: "admin_report_handled", id: 7, handled: true },
    { type: "admin_report_handled", id: 5, handled: false },
  ]);
});

it("liste les erreurs dans l'ordre reçu, avec leur nombre, leur type et leur pile", () => {
  const html = renderToStaticMarkup(<Erreurs errors={errors} />);
  expect(html.indexOf("TypeError: x is undefined")).toBeLessThan(html.indexOf("échec"));
  for (const texte of ["12", "Rendu React", "Promesse rejetée", "Joey", "Edge", "<pre"]) expect(html).toContain(texte);
  expect(html.match(/<pre/g)).toHaveLength(1);
  expect(renderToStaticMarkup(<Erreurs errors={[]} />)).toContain("Aucune erreur");
});

it("n'ajoute l'entrée Admin au menu que pour un compte admin", () => {
  const menu = (admin: boolean) =>
    renderToStaticMarkup(
      <Shell id="x" pseudo="Yugi" page="accueil" go={() => {}} admin={admin}>
        <p>x</p>
      </Shell>,
    );
  expect(menu(false)).not.toContain(">Admin ");
  expect(menu(true)).toContain(">Admin ");
});
