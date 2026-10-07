import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import type { Message } from "./board.ts";

// Cards of the guided duel, placed by server/data/tutorial.json.
export const CELTIC = 91152256;
export const MIRROR_FORCE = 44095762;
export const POT_OF_GREED = 55144522;
export const SUMMONED_SKULL = 70781052;

// `carte`: the card to play, highlighted in the hand. `faite`: the engine message that confirms the step.
export type Etape = { titre: string; consigne: string; carte?: number; faite: (msg: Message, seat: number) => boolean };
// The steps of a guided duel (the tutorial, a lesson of lecons.ts) and the words of its panel.
export type Parcours = { nom: string; quitter: string; etapes: readonly Etape[] };

export const ETAPES: readonly Etape[] = [
  {
    titre: "Invoquer un monstre",
    consigne: "Choisissez Celtic Guardian dans votre main, puis « Invoquer ». Un monstre de niveau 4 ou moins s'invoque sans sacrifice, une fois par tour.",
    carte: CELTIC,
    faite: (msg, seat) => msg.type === OcgMessageType.SUMMONING && msg.controller === seat,
  },
  {
    titre: "Attaquer directement",
    consigne: "Passez en Battle Phase, puis attaquez avec Celtic Guardian : sans monstre en face, l'attaque touche directement les LP adverses.",
    faite: (msg, seat) => msg.type === OcgMessageType.ATTACK && msg.card.controller === seat && !msg.target,
  },
  {
    titre: "Poser un Piège",
    consigne: "Passez en Main Phase 2 et posez Mirror Force face cachée. Un Piège posé attend son moment, à partir du tour suivant.",
    carte: MIRROR_FORCE,
    faite: (msg, seat) => msg.type === OcgMessageType.SET && msg.controller === seat && msg.code === MIRROR_FORCE,
  },
  {
    titre: "Finir le tour",
    consigne: "Choisissez « End Phase » : c'est au tour de l'adversaire.",
    faite: (msg, seat) => msg.type === OcgMessageType.NEW_TURN && msg.player !== seat,
  },
  {
    titre: "Déclencher le Piège",
    consigne:
      "L'adversaire invoque un monstre et attaque. Le jeu vous demande alors « Activer une carte maintenant ? » : choisissez Mirror Force. Elle s'enchaîne à l'attaque, se résout la première et détruit ses monstres en position d'attaque.",
    faite: (msg, seat) => msg.type === OcgMessageType.CHAINING && msg.controller === seat && msg.code === MIRROR_FORCE,
  },
  {
    titre: "Activer une Magie",
    consigne: "Votre tour : vous avez pioché Pot of Greed. Activez cette Magie pour piocher 2 cartes.",
    carte: POT_OF_GREED,
    faite: (msg, seat) => msg.type === OcgMessageType.CHAINING && msg.controller === seat && msg.code === POT_OF_GREED,
  },
  {
    titre: "Invoquer par Sacrifice",
    consigne: "Invoquez Summoned Skull : un monstre de niveau 5 ou 6 demande d'envoyer un de vos monstres au cimetière, ici Celtic Guardian.",
    carte: SUMMONED_SKULL,
    faite: (msg, seat) => msg.type === OcgMessageType.SUMMONING && msg.controller === seat && msg.code === SUMMONED_SKULL,
  },
  {
    titre: "Gagner le duel",
    consigne: "Passez en Battle Phase et attaquez directement avec Summoned Skull : ses 2500 ATK suffisent pour les derniers LP adverses.",
    faite: (msg, seat) => msg.type === OcgMessageType.WIN && msg.player === seat,
  },
];

export const TUTORIEL: Parcours = { nom: "Tutoriel", quitter: "Passer le tutoriel", etapes: ETAPES };

// The step after these messages: a message that completes the current step or a later one moves past it. `etapes.length` once won.
export function avancer(etape: number, messages: readonly Message[], seat: number, etapes: readonly Etape[] = ETAPES): number {
  let courante = etape;
  for (const msg of messages) {
    const faite = etapes.findIndex((candidate, index) => index >= courante && candidate.faite(msg, seat));
    if (faite !== -1) courante = faite + 1;
  }
  return courante;
}
