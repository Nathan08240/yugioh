import type { WebSocket } from "ws";
import type { Db, Sql } from "./db.ts";
import { FRIENDS_MAX, type ClientMessage, type Friend, type Presence, type ServerMessage } from "./protocol.ts";

export const FRIEND_REQUESTS_PER_HOUR = 20;
export const CHALLENGE_TIME = 60_000;
const UNKNOWN = "joueur introuvable";

// A relation of the player: "sent" and "received" are pending requests.
export type FriendRow = { id: string; pseudo: string; avatar: number | null; status: "accepted" | "sent" | "received" };

// Friend storage, faked in tests.
export type FriendStore = {
  // Friends and requests, by pseudo.
  friendList: (userId: string) => Promise<FriendRow[]>;
  // The other player, `accepted` when this request accepted theirs; or the error for the sender.
  requestFriend: (userId: string, pseudo: string) => Promise<{ id: string; accepted: boolean } | string>;
  // Resolve to the other player, undefined when there was no request to accept, or nothing to remove.
  acceptFriend: (userId: string, pseudo: string) => Promise<string | undefined>;
  removeFriend: (userId: string, pseudo: string) => Promise<string | undefined>;
};

export type FriendMessage = Extract<ClientMessage, { type: "friends" | "friend_add" | "friend_accept" | "friend_remove" | "challenge" | "challenge_reply" }>;
const FRIEND_TYPES: ReadonlySet<unknown> = new Set(["friends", "friend_add", "friend_accept", "friend_remove", "challenge", "challenge_reply"]);
export const isFriendMessage = (msg: ClientMessage): msg is FriendMessage => FRIEND_TYPES.has(msg.type);

// Shape check of an incoming friend message, before its type is trusted.
export function validFriendMessage(msg: Record<string, unknown>): boolean {
  if (msg.type === "friends") return true;
  if (!FRIEND_TYPES.has(msg.type) || typeof msg.pseudo !== "string" || msg.pseudo.length > 40) return false;
  return msg.type !== "challenge_reply" || typeof msg.accept === "boolean";
}

export async function friendList(db: Db, userId: string): Promise<FriendRow[]> {
  return db<FriendRow[]>`
    select p.user_id as id, p.pseudo, p.avatar_code as avatar,
      case when f.status = 'accepted' then 'accepted' when f.user_id = ${userId} then 'sent' else 'received' end as status
    from yugioh.friendships f
    join yugioh.profiles p on p.user_id = case when f.user_id = ${userId} then f.friend_id else f.user_id end
    where ${userId} in (f.user_id, f.friend_id)
    order by lower(p.pseudo)`;
}

const countOf = (sql: Sql, userId: string) => sql<{ count: number }[]>`
  select count(*)::int as count from yugioh.friendships where ${userId} in (user_id, friend_id)`.then(([row]) => row.count);

// Both profile locks keep concurrent requests from passing the limits; they are taken in id order, so never in a deadlock.
export async function requestFriend(db: Db, userId: string, pseudo: string): Promise<{ id: string; accepted: boolean } | string> {
  const [target] = await db<{ id: string }[]>`select user_id as id from yugioh.profiles where lower(pseudo) = lower(${pseudo})`;
  if (!target) return UNKNOWN;
  if (target.id === userId) return "c'est votre propre pseudo";
  return db.begin(async (sql) => {
    await sql`select 1 from yugioh.profiles where user_id in (${userId}, ${target.id}) order by user_id for update`;
    const [known] = await sql<{ from: string; status: string }[]>`
      select user_id as from, status from yugioh.friendships
      where (user_id = ${userId} and friend_id = ${target.id}) or (user_id = ${target.id} and friend_id = ${userId})`;
    if (known?.status === "accepted") return "déjà dans vos amis";
    if (known?.from === userId) return "demande déjà envoyée";
    if (known) {
      await sql`update yugioh.friendships set status = 'accepted' where user_id = ${target.id} and friend_id = ${userId}`;
      return { id: target.id, accepted: true };
    }
    const [{ sent }] = await sql<{ sent: number }[]>`
      select count(*)::int as sent from yugioh.friend_requests where user_id = ${userId} and created_at > now() - interval '1 hour'`;
    if (sent >= FRIEND_REQUESTS_PER_HOUR) return "trop de demandes d'ami, réessayez dans une heure";
    if ((await countOf(sql, userId)) >= FRIENDS_MAX) return `liste d'amis pleine (${FRIENDS_MAX} au maximum, demandes comprises)`;
    if ((await countOf(sql, target.id)) >= FRIENDS_MAX) return "la liste d'amis de ce joueur est pleine";
    await sql`insert into yugioh.friendships (user_id, friend_id) values (${userId}, ${target.id})`;
    await sql`insert into yugioh.friend_requests (user_id) values (${userId})`;
    return { id: target.id, accepted: false };
  });
}

export async function acceptFriend(db: Db, userId: string, pseudo: string): Promise<string | undefined> {
  const [row] = await db<{ id: string }[]>`
    update yugioh.friendships f set status = 'accepted' from yugioh.profiles p
    where lower(p.pseudo) = lower(${pseudo}) and f.user_id = p.user_id and f.friend_id = ${userId} and f.status = 'pending'
    returning p.user_id as id`;
  return row?.id;
}

export async function removeFriend(db: Db, userId: string, pseudo: string): Promise<string | undefined> {
  const [row] = await db<{ id: string }[]>`
    delete from yugioh.friendships f using yugioh.profiles p
    where lower(p.pseudo) = lower(${pseudo})
      and ((f.user_id = ${userId} and f.friend_id = p.user_id) or (f.user_id = p.user_id and f.friend_id = ${userId}))
    returning p.user_id as id`;
  return row?.id;
}

export const dbFriendStore = (db: Db): FriendStore => ({
  friendList: (userId) => friendList(db, userId),
  requestFriend: (userId, pseudo) => requestFriend(db, userId, pseudo),
  acceptFriend: (userId, pseudo) => acceptFriend(db, userId, pseudo),
  removeFriend: (userId, pseudo) => removeFriend(db, userId, pseudo),
});

// An authenticated connection with a pseudo; `entry` is what the server needs to seat it in a room.
type Session<E> = { id: string; pseudo: string; seated: boolean; room?: string; entry: E };
type Challenge = { from: string; pseudo: string; to: string; socket: WebSocket; timer: NodeJS.Timeout };
type Send = (socket: WebSocket | undefined, msg: ServerMessage) => void;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Presence of the connected players and challenges between friends, in memory. `startDuel` seats both players of an accepted challenge.
export function friendHub<E>(store: FriendStore, send: Send, startDuel: (challenger: E, acceptor: E) => Promise<string | undefined>, watchable: (room: string) => boolean) {
  const sessions = new Map<WebSocket, Session<E>>();
  const challenges = new Set<Challenge>();

  // ponytail: scans every connection, an index by user id if the player count grows large.
  const socketsOf = (id: string) => [...sessions].filter(([, session]) => session.id === id);
  const sendTo = (id: string, msg: ServerMessage) => socketsOf(id).forEach(([socket]) => send(socket, msg));

  function presence(id: string): Presence {
    const mine = socketsOf(id);
    if (mine.length === 0) return "offline";
    return mine.some(([, session]) => session.seated) ? "duel" : "online";
  }

  // The room code of a friend in a room that can be watched, given to accepted friends only.
  const watchOf = (id: string) => socketsOf(id).find(([, session]) => session.room && watchable(session.room))?.[1].room;

  const view = (row: FriendRow): Friend => {
    if (row.status !== "accepted") return { pseudo: row.pseudo, avatar: row.avatar, status: row.status };
    return { pseudo: row.pseudo, avatar: row.avatar, status: presence(row.id), watch: watchOf(row.id) };
  };

  async function pushList(id: string) {
    if (socketsOf(id).length === 0) return;
    sendTo(id, { type: "friends", friends: (await store.friendList(id)).map(view) });
  }

  // Tells the connected friends of the player about a new presence.
  async function announce(session: Session<E>, before?: Presence) {
    const status = presence(session.id);
    if (status === before) return;
    const watch = watchOf(session.id);
    for (const row of await store.friendList(session.id)) if (row.status === "accepted") sendTo(row.id, { type: "friend_status", pseudo: session.pseudo, status, watch });
  }

  function close(challenge: Challenge) {
    clearTimeout(challenge.timer);
    challenges.delete(challenge);
    sendTo(challenge.to, { type: "challenge_gone", from: challenge.pseudo });
  }

  // A player who enters a room or leaves withdraws the challenges they sent.
  function update(socket: WebSocket, change: (session: Session<E>) => void) {
    const session = sessions.get(socket);
    if (!session) return;
    const before = presence(session.id);
    change(session);
    for (const challenge of challenges) if (challenge.socket === socket) close(challenge);
    announce(session, before).catch((error: unknown) => console.error(error));
  }

  async function challenge(socket: WebSocket, session: Session<E>, pseudo: string): Promise<string | undefined> {
    if (session.seated) return "déjà dans une salle";
    const friend = (await store.friendList(session.id)).find((row) => row.status === "accepted" && same(row.pseudo, pseudo));
    if (!friend) return "ami introuvable";
    if (presence(friend.id) !== "online") return `${friend.pseudo} n'est pas disponible`;
    for (const old of challenges) if (old.socket === socket && old.to === friend.id) close(old);
    const expire = () => {
      close(sent);
      send(socket, { type: "friend_notice", text: `${friend.pseudo} n'a pas répondu au défi.` });
    };
    const sent: Challenge = { from: session.id, pseudo: session.pseudo, to: friend.id, socket, timer: setTimeout(expire, CHALLENGE_TIME).unref() };
    challenges.add(sent);
    sendTo(friend.id, { type: "challenged", from: session.pseudo, ms: CHALLENGE_TIME });
    send(socket, { type: "friend_notice", text: `Défi envoyé à ${friend.pseudo}.` });
    return undefined;
  }

  async function reply(session: Session<E>, pseudo: string, accept: boolean): Promise<string | undefined> {
    const received = [...challenges].find((candidate) => candidate.to === session.id && same(candidate.pseudo, pseudo));
    if (!received) return "défi expiré";
    if (accept && session.seated) return "déjà dans une salle";
    close(received);
    if (!accept) {
      send(received.socket, { type: "friend_notice", text: `${session.pseudo} a refusé le défi.` });
      return undefined;
    }
    const challenger = sessions.get(received.socket);
    return challenger ? startDuel(challenger.entry, session.entry) : "défi expiré";
  }

  async function refresh(session: Session<E>, other: string | undefined, notice: string, error: string): Promise<string | undefined> {
    if (!other) return error;
    await pushList(session.id);
    await pushList(other);
    if (notice) sendTo(other, { type: "friend_notice", text: notice });
    return undefined;
  }

  async function request(session: Session<E>, pseudo: string): Promise<string | undefined> {
    const result = await store.requestFriend(session.id, pseudo);
    if (typeof result === "string") return result;
    const notice = result.accepted ? `${session.pseudo} a accepté votre demande d'ami.` : `${session.pseudo} vous a envoyé une demande d'ami.`;
    return refresh(session, result.id, notice, UNKNOWN);
  }

  // Returns an error for the sender, if any.
  async function handle(socket: WebSocket, msg: FriendMessage): Promise<string | undefined> {
    const session = sessions.get(socket);
    if (!session) return "pseudo à choisir d'abord";
    switch (msg.type) {
      case "friends":
        await pushList(session.id);
        return undefined;
      case "friend_add":
        return request(session, msg.pseudo);
      case "friend_accept":
        return refresh(session, await store.acceptFriend(session.id, msg.pseudo), `${session.pseudo} a accepté votre demande d'ami.`, "aucune demande de ce joueur");
      case "friend_remove":
        return refresh(session, await store.removeFriend(session.id, msg.pseudo), "", "joueur absent de vos amis");
      case "challenge":
        return challenge(socket, session, msg.pseudo);
      case "challenge_reply":
        return reply(session, msg.pseudo, msg.accept);
    }
  }

  return {
    // The connection is authenticated, with a pseudo.
    join(socket: WebSocket, id: string, pseudo: string, entry: E) {
      const before = presence(id);
      const session = { id, pseudo, seated: false, entry };
      sessions.set(socket, session);
      announce(session, before).catch((error: unknown) => console.error(error));
    },
    seat: (socket: WebSocket, room: string) =>
      update(socket, (session) => {
        session.seated = true;
        session.room = room;
      }),
    // The duel of the room can now be watched: tells the friends of its players.
    opened(room: string) {
      for (const session of sessions.values()) if (session.room === room) announce(session).catch((error: unknown) => console.error(error));
    },
    leave: (socket: WebSocket) => update(socket, () => sessions.delete(socket)),
    handle,
    // Every connection of a player with a pseudo (trade.ts).
    sendTo,
  };
}
