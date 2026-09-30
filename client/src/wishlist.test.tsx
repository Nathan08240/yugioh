import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { initialLobby, reduce } from "./lobby.ts";
import { WishButton } from "./Souhait.tsx";
import { grantedWishes, wishedMissing } from "./wishlist.ts";

it("compte les cartes souhaitées et non possédées d'un set, chaque carte une fois", () => {
  const set = [1, 2, 3, 3, 4];
  expect(wishedMissing(set, new Set([1, 3, 9]), new Set([1, 4]))).toBe(1);
  expect(wishedMissing(set, new Set([2, 3, 4]), new Set())).toBe(3);
  expect(wishedMissing(set, new Set(), new Set())).toBe(0);
  expect(wishedMissing([], new Set([1]), new Set())).toBe(0);
});

it("repère les cartes neuves d'un booster qui figuraient dans les souhaits", () => {
  const cards = [{ code: 5 }, { code: 6 }, { code: 7 }, { code: 5 }];
  const fresh = new Set([0, 1, 2]);
  expect(grantedWishes(cards, fresh, new Set([5, 7, 8]))).toEqual(new Set([0, 2]));
  expect(grantedWishes(cards, fresh, new Set())).toEqual(new Set());
  // Une carte déjà possédée n'est pas neuve : elle ne réalise plus de souhait.
  expect(grantedWishes(cards, new Set([1]), new Set([5]))).toEqual(new Set());
});

it("garde la liste de souhaits reçue du serveur", () => {
  expect(reduce(initialLobby, { type: "wishlist", cards: [3, 1] }).wishlist).toEqual([3, 1]);
});

it("affiche le cœur comme un bouton à bascule nommé selon l'action", () => {
  const off = renderToStaticMarkup(<WishButton code={1} wished={false} send={() => {}} />);
  expect(off).toContain('aria-pressed="false"');
  expect(off).toContain('aria-label="Ajouter aux souhaits"');
  const on = renderToStaticMarkup(<WishButton code={1} wished send={() => {}} label />);
  expect(on).toContain('aria-pressed="true"');
  expect(on).toContain("Dans mes souhaits");
});
