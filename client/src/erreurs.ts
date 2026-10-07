import { ERROR_MAX, type ClientError, type ClientMessage } from "../../server/src/protocol.ts";

// The screen the player is on, which the lobby keeps up to date: the page of an error.
export const contexte = { ecran: "" };

// Errors met before the player is logged in are kept (a few) and sent once they are.
const ATTENTE_MAX = 5;
const attente: ClientError[] = [];
// Each distinct error goes once per page load: the server counts the page loads, a loop does not use up its quota.
const vues = new Set<string>();
let envoi: ((msg: ClientMessage) => void) | undefined;

function transmettre(erreur: ClientError) {
  if (!envoi) {
    attente.push(erreur);
    return;
  }
  try {
    envoi({ type: "client_error", ...erreur });
  } catch {
    // An error report must never raise an error of its own.
  }
}

// The sender of the lobby once the player is logged in, undefined when they are not any more.
export function brancher(send?: (msg: ClientMessage) => void) {
  envoi = send;
  if (send) for (const erreur of attente.splice(0)) transmettre(erreur);
}

// `detail`: more of the stack (the components of a render error).
export function signalerErreur(kind: ClientError["kind"], error: unknown, detail = "") {
  const erreur = error instanceof Error ? error : undefined;
  const message = (erreur ? `${erreur.name}: ${erreur.message}` : String(error)).slice(0, ERROR_MAX.message);
  const stack = `${erreur?.stack ?? ""}${detail}`.slice(0, ERROR_MAX.stack);
  const cle = `${kind}\0${message}\0${stack.split("\n", 2).join("\n")}`;
  if (vues.has(cle) || (!envoi && attente.length >= ATTENTE_MAX)) return;
  vues.add(cle);
  transmettre({ kind, message, stack, page: (contexte.ecran || location.pathname).slice(0, ERROR_MAX.page), build: __BUILD__.slice(0, ERROR_MAX.build), browser: navigator.userAgent.slice(0, ERROR_MAX.browser) });
}

// The errors nobody caught: scripts and promises. The render errors come from the React root (main.tsx).
export function installerCapteur() {
  addEventListener("error", (event) => signalerErreur("error", event.error ?? event.message));
  addEventListener("unhandledrejection", (event) => signalerErreur("rejection", event.reason));
}
