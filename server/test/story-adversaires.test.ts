import { describe, expect, it } from "vitest";
import { isUnlocked, STORY, STORY_DUELS, storyRules, storyStars, storyView, validateStory } from "../src/story.ts";

// Side duels added after the release of the story: [id, opponent, duel of the same arc it follows].
const ADDED = [
  ["dk-rex", "Rex Raptor", "dk-weevil"],
  ["dk-panik", "Panik", "dk-mako"],
  ["dk-bonz", "Bonz", "dk-mai"],
  ["bcf-ishizu", "Ishizu Ishtar", "bcf-odion"],
] as const;
const addedIds = new Set<string>(ADDED.map(([id]) => id));
const released = STORY.arcs.flatMap((arc) => arc.duels).filter((duel) => !addedIds.has(duel.id));

describe.each(ADDED)("duel facultatif %s", (id, opponent, follows) => {
  const duel = STORY_DUELS.get(id);

  it("est un duel facultatif contre son adversaire, aux règles de l'arc, qui suit un duel de la trame", () => {
    const arc = STORY.arcs.find((candidate) => candidate.duels.some((other) => other.id === id));
    const neighbour = arc?.duels.find((other) => other.id === follows);
    expect(duel?.opponent).toBe(opponent);
    expect(duel?.optional).toBe(true);
    expect(duel?.requires).toEqual([follows]);
    expect(duel?.rules).toEqual(neighbour?.rules);
    expect(duel?.rewards.cards).toHaveLength(1);
  });

  it("n'est exigé par aucun autre duel", () => {
    expect(STORY.arcs.flatMap((arc) => arc.duels).filter((other) => other.requires.includes(id))).toEqual([]);
  });

  it("est verrouillé tant que son duel précédent n'est pas gagné, ouvert ensuite, avec la conclusion cachée", () => {
    const view = (done: string[]) => storyView(new Map(done.map((won) => [won, 1]))).flatMap((arc) => arc.duels).find((other) => other.id === id);
    expect(view([])?.status).toBe("locked");
    expect(view([follows])).toMatchObject({ status: "available", optional: true, outro: undefined });
    expect(view([follows, id])).toMatchObject({ status: "done", stars: 1 });
  });

  it("marche en facile (LP du joueur doublés) et rapporte 1, 2 ou 3 étoiles", () => {
    const rules = storyRules(duel as NonNullable<typeof duel>, "facile");
    expect(rules.playerLp).toBe((duel?.rules.lp ?? 0) * 2);
    expect(storyRules(duel as NonNullable<typeof duel>).playerLp).toBeUndefined();
    const lp = duel?.rules.lp ?? 0;
    expect([storyStars(true, lp * 2, lp), storyStars(false, lp / 2 - 1, lp), storyStars(false, lp / 2, lp)]).toEqual([1, 2, 3]);
  });
});

describe("progression des joueurs qui avaient fini l'histoire avant ces duels", () => {
  it("valide toute l'histoire, nouveaux decks compris", () => {
    expect(validateStory(STORY)).toEqual([]);
  });

  it("aucun duel déjà déverrouillé ne se reverrouille : tout ce qui était gagné reste gagné, le reste disponible", () => {
    const done = new Map(released.map((duel) => [duel.id, 2]));
    const statuses = storyView(done).flatMap((arc) => arc.duels.map((duel) => [duel.id, duel.status] as const));
    for (const [id, status] of statuses) expect(status, id).toBe(addedIds.has(id) ? "available" : "done");
  });

  it("les arcs suivants restent ouverts sans les duels facultatifs", () => {
    const done = new Set(released.map((duel) => duel.id));
    for (const arc of STORY.arcs.slice(1)) expect(isUnlocked(arc.duels[0], done), arc.id).toBe(true);
  });

  it("un duel de la trame n'exige jamais un duel facultatif", () => {
    const optional = new Set(STORY.arcs.flatMap((arc) => arc.duels).filter((duel) => duel.optional).map((duel) => duel.id));
    const chain = STORY.arcs.flatMap((arc) => arc.duels).filter((duel) => !duel.optional);
    for (const duel of chain) expect(duel.requires.filter((id) => optional.has(id)), duel.id).toEqual([]);
  });
});
