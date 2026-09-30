// Duel emotes: a fixed list of phrases. The server relays only an id from it, never text sent by a client.
export const EMOTES = [
  ["bonjour", "Bonjour !"],
  ["bienjoue", "Bien joué !"],
  ["hmm", "Hmm…"],
  ["atoi", "À toi !"],
  ["oups", "Oups !"],
  ["merci", "Merci !"],
  ["bonduel", "Bon duel !"],
] as const;

export type EmoteId = (typeof EMOTES)[number][0];

export const EMOTE_IDS: ReadonlySet<unknown> = new Set(EMOTES.map(([id]) => id));

// Minimum time between two emotes of a player, enforced by the server.
export const EMOTE_DELAY = 3000;
