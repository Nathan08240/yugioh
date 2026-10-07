import { OcgMessageType } from "@n1xx1/ocgcore-wasm";
import type { Message } from "./board.ts";
import type { Etape, Parcours } from "./tutoriel.ts";

// Cards of the lessons, placed by server/data/lessons.json.
const CURSE_OF_DRAGON = 28279543;
const BLUE_EYES = 89631139;
const POLYMERIZATION = 24094653;
const GAIA_DRAGON = 66889139;
const MIRROR_FORCE = 44095762;
const RUSH_RECKLESSLY = 70046172;
const SEVEN_TOOLS = 3819470;

type Quand = Etape["faite"];
const mine = (msg: Message, seat: number) => "controller" in msg && msg.controller === seat;
const invoque =
  (code: number): Quand =>
  (msg, seat) =>
    msg.type === OcgMessageType.SUMMONING && mine(msg, seat) && msg.code === code;
const active =
  (code: number): Quand =>
  (msg, seat) =>
    msg.type === OcgMessageType.CHAINING && mine(msg, seat) && msg.code === code;
const attaque =
  (direct: boolean): Quand =>
  (msg, seat) =>
    msg.type === OcgMessageType.ATTACK && msg.card.controller === seat && Boolean(msg.target) !== direct;
const gagne: Quand = (msg, seat) => msg.type === OcgMessageType.WIN && msg.player === seat;

const attaqueDirecte = (titre: string, consigne: string): Etape => ({ titre, consigne, faite: attaque(true) });

// The steps of each lesson, by its id in data/lessons.json. The last one ends with the win.
const ETAPES_LECONS: Record<string, readonly Etape[]> = {
  "tribut-simple": [
    {
      titre: "Invoquer avec un sacrifice",
      consigne: "Choisissez Curse of Dragon (niveau 5) dans votre main, puis « Invoquer ». Le jeu demande un monstre à sacrifier : prenez Mystical Shine Ball (500 ATK) et gardez Mystic Clown (1500 ATK).",
      carte: CURSE_OF_DRAGON,
      faite: invoque(CURSE_OF_DRAGON),
    },
    attaqueDirecte("Première attaque", "Passez en Battle Phase et attaquez directement avec Curse of Dragon : 2000 ATK."),
    { titre: "Seconde attaque", consigne: "Attaquez directement avec Mystic Clown : 2000 + 1500 = 3500, tous les LP de l'adversaire.", faite: gagne },
  ],
  "tribut-double": [
    {
      titre: "Invoquer avec deux sacrifices",
      consigne: "Choisissez Blue-Eyes White Dragon (niveau 8) dans votre main, puis « Invoquer ». Un niveau 7 ou plus demande deux sacrifices : cochez Mystical Shine Ball et Mystical Sheep #2, puis validez. Gardez Mystic Clown.",
      carte: BLUE_EYES,
      faite: invoque(BLUE_EYES),
    },
    attaqueDirecte("Première attaque", "Passez en Battle Phase et attaquez directement avec Blue-Eyes White Dragon : 3000 ATK."),
    { titre: "Seconde attaque", consigne: "Attaquez directement avec Mystic Clown : 3000 + 1500 = 4500, tous les LP de l'adversaire.", faite: gagne },
  ],
  fusion: [
    {
      titre: "Activer Polymérisation",
      consigne: "Aucun de vos monstres n'atteint les 2600 LP adverses seul. Activez Polymérisation depuis votre main : elle fusionne deux monstres.",
      carte: POLYMERIZATION,
      faite: active(POLYMERIZATION),
    },
    {
      titre: "Choisir la Fusion",
      consigne: "Prenez Gaia the Dragon Champion, de votre Extra Deck, puis ses deux matériaux : Gaia The Fierce Knight et Curse of Dragon. Ils vont au cimetière.",
      faite: (msg, seat) => msg.type === OcgMessageType.SPSUMMONING && mine(msg, seat) && msg.code === GAIA_DRAGON,
    },
    { titre: "Attaquer", consigne: "Une Fusion est une Invocation spéciale : elle peut attaquer ce tour-ci. Battle Phase, puis attaque directe : 2600 ATK.", faite: gagne },
  ],
  chaine: [
    attaqueDirecte("Attaquer", "Passez en Battle Phase et attaquez directement avec Summoned Skull. L'adversaire garde un Piège face cachée : il va répondre."),
    {
      titre: "Répondre en chaîne",
      consigne: "Il active Sakuretsu Armor (chaîne 1) pour détruire Summoned Skull. Le jeu vous propose de répondre : choisissez Seven Tools of the Bandit (chaîne 2), qui annule l'activation d'un Piège pour 1000 LP.",
      faite: active(SEVEN_TOOLS),
    },
    { titre: "Résolution", consigne: "Une chaîne se résout à l'envers : la dernière carte activée s'applique la première. Seven Tools annule Sakuretsu Armor, puis l'attaque reprend.", faite: gagne },
  ],
  "jeu-rapide": [
    {
      titre: "Poser un Piège",
      consigne: "Posez Mirror Force face cachée. Un Piège posé ne s'active pas le tour où on le pose : il attendra le tour suivant. Une Magie jeu-rapide, elle, s'active dès ce tour, même depuis la main.",
      carte: MIRROR_FORCE,
      faite: (msg, seat) => msg.type === OcgMessageType.SET && mine(msg, seat) && msg.code === MIRROR_FORCE,
    },
    {
      titre: "Attaquer",
      consigne: "Passez en Battle Phase et attaquez Curse of Dragon (2000 ATK) avec Mystic Clown (1500 ATK) : il perdrait. Avant l'attaque, refusez les propositions d'activer une carte (« Ne pas enchaîner »).",
      faite: (msg, seat) => msg.type === OcgMessageType.ATTACK && msg.card.controller === seat && Boolean(msg.target),
    },
    {
      titre: "Jeu-rapide en plein combat",
      consigne: "Le jeu demande « Activer une carte maintenant ? » : choisissez Rush Recklessly. Une Magie jeu-rapide se joue même pendant la Battle Phase.",
      faite: active(RUSH_RECKLESSLY),
    },
    { titre: "Choisir la cible", consigne: "Désignez Mystic Clown : +700 ATK jusqu'à la fin du tour, 2200 contre 2000. Il détruit Curse of Dragon et l'adversaire perd la différence : 200 LP.", faite: gagne },
  ],
  combat: [
    {
      titre: "Retourner un monstre",
      consigne: "Man-Eater Bug est posé face cachée, en défense. Choisissez-le puis « Changer de position » : c'est une Invocation Flip, il passe en attaque et son effet de retournement se déclenche.",
      faite: (msg, seat) => msg.type === OcgMessageType.FLIPSUMMONING && mine(msg, seat),
    },
    {
      titre: "Effet de retournement",
      consigne: "Il détruit un monstre au choix : prenez Mystical Elf, en défense avec 2000 DEF. Curse of Dragon (2000 ATK) n'aurait pas pu le détruire en l'attaquant : il faut dépasser la DEF.",
      faite: (msg) => msg.type === OcgMessageType.BECOME_TARGET,
    },
    {
      titre: "Combat",
      consigne: "Passez en Battle Phase et attaquez Mystic Clown (1500 ATK, en attaque) avec Curse of Dragon (2000 ATK) : le plus faible est détruit, son propriétaire perd la différence, 500 LP.",
      faite: (msg, seat) => msg.type === OcgMessageType.ATTACK && msg.card.controller === seat && Boolean(msg.target),
    },
    { titre: "Attaque directe", consigne: "Plus aucun monstre en face : attaquez directement avec Man-Eater Bug (450 ATK). 500 + 450 = 950, tous les LP adverses.", faite: gagne },
  ],
};

// The guided duel of a lesson, none for an id this client does not know.
export function parcoursDeLecon(id: string): Parcours | undefined {
  const etapes = ETAPES_LECONS[id];
  return etapes && { nom: "Leçon", quitter: "Quitter la leçon", etapes };
}
