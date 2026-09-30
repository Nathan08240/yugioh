import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProfile, type Db } from "../src/db.ts";
import { dbFriendStore, FRIEND_REQUESTS_PER_HOUR, type FriendStore } from "../src/friends.ts";
import { FRIENDS_MAX } from "../src/protocol.ts";
import { type Pg, startPostgres } from "./pg.ts";

describe("amis sur Postgres jetable", () => {
  let pg: Pg;
  let admin: Db;
  let store: FriendStore;

  beforeAll(async () => {
    pg = await startPostgres();
    admin = pg.admin;
    store = dbFriendStore(pg.server);
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  async function player(pseudo: string) {
    const [{ id }] = await admin<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await createProfile(pg.server, id, pseudo);
    return id;
  }
  const statuses = async (id: string) => (await store.friendList(id)).map(({ pseudo, status }) => [pseudo, status]);

  it("envoie une demande par pseudo sans tenir compte de la casse, l'accepte, puis la retire", async () => {
    const alice = await player("Alice");
    const bob = await player("Bob");
    await admin`update yugioh.profiles set avatar_code = 100 where user_id = ${bob}`;
    expect(await store.requestFriend(alice, "bOB")).toEqual({ id: bob, accepted: false });
    expect(await store.requestFriend(alice, "Bob")).toBe("demande déjà envoyée");
    expect(await store.friendList(alice)).toEqual([{ id: bob, pseudo: "Bob", avatar: 100, status: "sent" }]);
    expect(await statuses(bob)).toEqual([["Alice", "received"]]);
    expect(await store.acceptFriend(alice, "Bob")).toBeUndefined();
    expect(await store.acceptFriend(bob, "alice")).toBe(alice);
    expect(await statuses(alice)).toEqual([["Bob", "accepted"]]);
    expect(await statuses(bob)).toEqual([["Alice", "accepted"]]);
    expect(await store.requestFriend(bob, "Alice")).toBe("déjà dans vos amis");
    expect(await store.removeFriend(bob, "ALICE")).toBe(alice);
    expect(await store.removeFriend(bob, "Alice")).toBeUndefined();
    expect(await store.friendList(alice)).toEqual([]);
  });

  it("une demande croisée accepte la première, un pseudo inconnu ne révèle rien", async () => {
    const carol = await player("Carol");
    const dave = await player("Dave");
    await store.requestFriend(carol, "Dave");
    expect(await store.requestFriend(dave, "Carol")).toEqual({ id: carol, accepted: true });
    expect(await statuses(carol)).toEqual([["Dave", "accepted"]]);
    expect(await store.requestFriend(carol, "Personne")).toBe("joueur introuvable");
    expect(await store.requestFriend(carol, "carol")).toBe("c'est votre propre pseudo");
  });

  it("limite les demandes à 20 par heure, même retirées", async () => {
    const eve = await player("Eve");
    for (let i = 0; i < FRIEND_REQUESTS_PER_HOUR; i++) {
      await player(`Cible${i}`);
      expect(await store.requestFriend(eve, `Cible${i}`)).toMatchObject({ accepted: false });
      await store.removeFriend(eve, `Cible${i}`);
    }
    await player("Encore");
    expect(await store.requestFriend(eve, "Encore")).toBe("trop de demandes d'ami, réessayez dans une heure");
    await admin`update yugioh.friend_requests set created_at = now() - interval '2 hours' where user_id = ${eve}`;
    expect(await store.requestFriend(eve, "Encore")).toMatchObject({ accepted: false });
  });

  it("limite à 100 amis, demandes en attente comprises, des deux côtés et en parallèle", { timeout: 60_000 }, async () => {
    const star = await player("Star");
    const fans: string[] = [];
    for (let i = 0; i < FRIENDS_MAX + 3; i++) fans.push(await player(`Fan${i}`));
    const results = await Promise.all(fans.map((_fan, i) => store.requestFriend(fans[i], "Star")));
    expect(results.filter((result) => typeof result !== "string")).toHaveLength(FRIENDS_MAX);
    expect(results.filter((result) => result === "la liste d'amis de ce joueur est pleine")).toHaveLength(3);
    expect(await store.friendList(star)).toHaveLength(FRIENDS_MAX);
    const late = fans.find((_fan, i) => typeof results[i] === "string") as string;
    await admin`insert into yugioh.friendships (user_id, friend_id) select ${late}, user_id from yugioh.profiles where pseudo like 'Fan%' and user_id <> ${late} limit ${FRIENDS_MAX}`;
    await player("Autre");
    expect(await store.requestFriend(late, "Autre")).toBe(`liste d'amis pleine (${FRIENDS_MAX} au maximum, demandes comprises)`);
  });

  it("supprime les relations avec le profil ; ni une demande vers soi, ni un statut inconnu, ni l'effacement du journal ne passent", async () => {
    const gina = await player("Gina");
    const hugo = await player("Hugo");
    await store.requestFriend(gina, "Hugo");
    await admin`delete from yugioh.profiles where user_id = ${hugo}`;
    expect(await store.friendList(gina)).toEqual([]);
    await expect(pg.server`insert into yugioh.friendships (user_id, friend_id) values (${gina}, ${gina})`).rejects.toThrow();
    await expect(pg.server`update yugioh.friendships set status = 'bloque'`).rejects.toThrow();
    await expect(pg.server`delete from yugioh.friend_requests`).rejects.toThrow();
  });
});
