// Server WISH_MAX (server/src/wishlist.ts).
export const WISH_MAX = 100;

// Cards of a set the player wishes for and does not own yet, each passcode once.
export const wishedMissing = (setCards: readonly number[], wished: ReadonlySet<number>, owned: ReadonlySet<number>): number =>
  [...new Set(setCards)].filter((code) => wished.has(code) && !owned.has(code)).length;

// Indexes of the cards of a booster that answer a wish: new to the player (`fresh`, see Boosters.tsx) and wished.
export const grantedWishes = (cards: readonly { code: number }[], fresh: ReadonlySet<number>, wished: ReadonlySet<number>): ReadonlySet<number> =>
  new Set([...fresh].filter((index) => wished.has(cards[index].code)));
