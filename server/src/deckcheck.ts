// Deck building rules, shared by the server (which decides) and the client (which shows them). No runtime import:
// the client bundles this file.
export const MAIN_MIN = 40;
export const MAIN_MAX = 60;
export const EXTRA_MAX = 15;
export const COPIES_MAX = 3;
export const NAME_MAX = 40;

const FUSION = 0x40; // OcgType.FUSION
// An alternate artwork's alias is its original passcode, a few numbers away (EDOPro's artwork offset).
// Other aliases are distinct cards "treated as" another one: Harpie Lady 1, A Legendary Ocean, the anime gods.
const ARTWORK_OFFSET = 20;

export type DeckCard = { name: string; type: number; alias: number };
// `card` returns undefined for a card outside the allowed pool.
export type CardLookup = (code: number) => DeckCard | undefined;
export type DeckDraft = { id?: number; name: string; main: number[]; extra: number[] };

export const isFusion = (card: DeckCard) => (card.type & FUSION) !== 0;

// The passcode the copy limit counts: an alternate artwork counts as its original.
export function sameCard(code: number, card: DeckCard): number {
  return card.alias && Math.abs(card.alias - code) < ARTWORK_OFFSET ? card.alias : code;
}

export function countBy(codes: number[], key: (code: number) => number = (code) => code): Map<number, number> {
  const counts = new Map<number, number>();
  for (const code of codes) counts.set(key(code), (counts.get(key(code)) ?? 0) + 1);
  return counts;
}

function sizeError({ name, main, extra }: DeckDraft): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX) return `le nom du deck doit faire 1 à ${NAME_MAX} caractères`;
  if (main.length < MAIN_MIN || main.length > MAIN_MAX) return `le main deck doit compter ${MAIN_MIN} à ${MAIN_MAX} cartes`;
  if (extra.length > EXTRA_MAX) return `l'extra deck compte ${EXTRA_MAX} cartes au plus`;
  return undefined;
}

// The first rule the deck breaks, or undefined. `owned` is the player's collection (or the Sealed reserve, named by `source`): passcode to quantity.
export function deckError(deck: DeckDraft, card: CardLookup, owned: ReadonlyMap<number, number>, source = "la collection"): string | undefined {
  const size = sizeError(deck);
  if (size) return size;
  const codes = [...deck.main, ...deck.extra];
  const unknown = codes.find((code) => !card(code));
  if (unknown !== undefined) return `carte non autorisée : ${unknown}`;
  const data = (code: number) => card(code) as DeckCard;
  const misplaced = deck.main.find((code) => isFusion(data(code)));
  if (misplaced !== undefined) return `${data(misplaced).name} : les monstres de fusion vont dans l'extra deck`;
  const notFusion = deck.extra.find((code) => !isFusion(data(code)));
  if (notFusion !== undefined) return `${data(notFusion).name} : l'extra deck n'accepte que des monstres de fusion`;
  const key = (code: number) => sameCard(code, data(code));
  const copies = countBy(codes, key);
  const tooMany = codes.find((code) => (copies.get(key(code)) ?? 0) > COPIES_MAX);
  if (tooMany !== undefined) return `${data(tooMany).name} : ${COPIES_MAX} exemplaires au plus`;
  const used = countBy(codes);
  const notOwned = codes.find((code) => (used.get(code) ?? 0) > (owned.get(code) ?? 0));
  if (notOwned !== undefined) return `${data(notOwned).name} : plus d'exemplaires que dans ${source}`;
  return undefined;
}
