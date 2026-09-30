import { addCards } from "./collection.ts";
import type { Db, Sql } from "./db.ts";
import { RARITIES } from "./pool.ts";
import { TRADE_HOURS, TRADES_PER_DAY, type ClientMessage, type ServerMessage, type TradeOffer } from "./protocol.ts";

// Pending offers a player may have sent at once.
export const TRADE_PENDING_MAX = 10;
const EXPIRY = `${TRADE_HOURS} hours`;
const NOT_FRIEND = "ami introuvable";
const RANK = [...RARITIES];

export type TradeList = Omit<Extract<ServerMessage, { type: "trades" }>, "type">;
export type TradeCards = Omit<Extract<ServerMessage, { type: "trade_cards" }>, "type" | "pseudo">;

// Trade storage, faked in tests.
export type TradeStore = {
  trades: (userId: string) => Promise<TradeList>;
  // The cards the player and the friend `pseudo` may trade, or the error for the player.
  tradeCards: (userId: string, pseudo: string) => Promise<TradeCards | string>;
  // The friend the offer went to, or the error for the player.
  offerTrade: (userId: string, pseudo: string, give: number, get: number) => Promise<{ to: string } | string>;
  // The player who made the offer, or the error for the player.
  acceptTrade: (userId: string, id: number) => Promise<{ from: string } | string>;
  // The other player, `refused` for an offer received; undefined when there was no such offer.
  removeTrade: (userId: string, id: number) => Promise<{ other: string; refused: boolean } | undefined>;
};

export type TradeMessage = Extract<ClientMessage, { type: "trades" | "trade_cards" | "trade_offer" | "trade_accept" | "trade_remove" }>;
const TRADE_TYPES: ReadonlySet<unknown> = new Set(["trades", "trade_cards", "trade_offer", "trade_accept", "trade_remove"]);
export const isTradeMessage = (msg: ClientMessage): msg is TradeMessage => TRADE_TYPES.has(msg.type);

const isPseudo = (value: unknown) => typeof value === "string" && value.length <= 40;

// Shape check of an incoming trade message, before its type is trusted.
export function validTradeMessage(msg: Record<string, unknown>): boolean {
  switch (msg.type) {
    case "trades":
      return true;
    case "trade_cards":
      return isPseudo(msg.pseudo);
    case "trade_offer":
      return isPseudo(msg.pseudo) && Number.isInteger(msg.give) && Number.isInteger(msg.get);
    case "trade_accept":
    case "trade_remove":
      return Number.isInteger(msg.id);
    default:
      return false;
  }
}

type Notify = (userId: string, msg: ServerMessage) => void;

// Answers a trade message through `notify`, which reaches every connection of a player; returns the error for the sender.
export async function tradeReply(store: TradeStore, player: { id: string; pseudo: string }, msg: TradeMessage, notify: Notify): Promise<string | undefined> {
  const push = async (id: string) => notify(id, { type: "trades", ...(await store.trades(id)) });
  const changed = async (other: string, notice?: string) => {
    await push(player.id);
    await push(other);
    if (notice) notify(other, { type: "friend_notice", text: notice });
    return undefined;
  };
  switch (msg.type) {
    case "trades":
      await push(player.id);
      return undefined;
    case "trade_cards": {
      const cards = await store.tradeCards(player.id, msg.pseudo);
      if (typeof cards === "string") return cards;
      notify(player.id, { type: "trade_cards", pseudo: msg.pseudo, ...cards });
      return undefined;
    }
    case "trade_offer": {
      const sent = await store.offerTrade(player.id, msg.pseudo, msg.give, msg.get);
      if (typeof sent === "string") return sent;
      notify(player.id, { type: "friend_notice", text: `Offre d'échange envoyée à ${msg.pseudo}.` });
      return changed(sent.to, `${player.pseudo} vous propose un échange de cartes.`);
    }
    case "trade_accept": {
      const done = await store.acceptTrade(player.id, msg.id);
      if (typeof done === "string") return done;
      notify(player.id, { type: "friend_notice", text: "Échange effectué : la carte est dans votre collection." });
      return changed(done.from, `${player.pseudo} a accepté votre échange de cartes.`);
    }
    case "trade_remove": {
      const removed = await store.removeTrade(player.id, msg.id);
      if (!removed) return "offre expirée ou déjà traitée";
      return changed(removed.other, removed.refused ? `${player.pseudo} a refusé votre échange de cartes.` : undefined);
    }
  }
}

// The accepted friend of the player with that pseudo.
async function friendOf(sql: Sql, userId: string, pseudo: string): Promise<{ id: string; pseudo: string } | undefined> {
  const [friend] = await sql<{ id: string; pseudo: string }[]>`
    select p.user_id as id, p.pseudo from yugioh.profiles p
    join yugioh.friendships f on f.status = 'accepted'
      and ((f.user_id = ${userId} and f.friend_id = p.user_id) or (f.user_id = p.user_id and f.friend_id = ${userId}))
    where lower(p.pseudo) = lower(${pseudo})`;
  return friend;
}

const acceptedToday = (sql: Sql, userId: string) => sql<{ count: number }[]>`
  select count(*)::int as count from yugioh.trades
  where status = 'accepted' and ${userId} in (from_id, to_id)
    and (decided_at at time zone 'Europe/Paris')::date = (now() at time zone 'Europe/Paris')::date`.then(([row]) => row.count);

// Owned cards (or the one `code`) with the most copies a single deck of the player uses.
function usage(sql: Sql, userId: string, code?: number) {
  return sql<{ code: number; quantity: number; used: number }[]>`
    select c.card_code as code, c.quantity, coalesce(max(u.n), 0)::int as used
    from yugioh.collection c
    left join (
      select x.code, count(*)::int as n from yugioh.decks d cross join unnest(d.main_deck || d.extra_deck) x (code)
      where d.user_id = ${userId} group by d.id, x.code
    ) u on u.code = c.card_code
    where c.user_id = ${userId} ${code === undefined ? sql`` : sql`and c.card_code = ${code}`}
    group by c.card_code, c.quantity
    order by c.card_code`;
}

// Copies a player may give: never the last one, nor those one of their decks uses.
const spare = ({ quantity, used }: { quantity: number; used: number }) => quantity - Math.max(1, used);

// Cards with copies to spare, as [passcode, copies].
async function spareCards(sql: Sql, userId: string): Promise<[number, number][]> {
  return (await usage(sql, userId)).filter((row) => spare(row) > 0).map((row) => [row.code, spare(row)]);
}

// Why `userId` cannot give a copy of `code`, if so; `other` is their pseudo when they are not the player the message is for.
async function copyError(sql: Sql, userId: string, code: number, other?: string): Promise<string | undefined> {
  const [row] = await usage(sql, userId, code);
  if (!row || row.quantity < 2) {
    if (other) return `${other} n'a plus au moins 2 exemplaires de sa carte : le dernier est toujours gardé`;
    return "il vous faut au moins 2 exemplaires de votre carte : le dernier est toujours gardé";
  }
  if (spare(row) > 0) return undefined;
  if (other) return `échange impossible : un deck de ${other} utilise tous ses exemplaires de sa carte`;
  return "échange impossible : un de vos decks utilise tous vos exemplaires de cette carte, retirez-en un du deck d'abord";
}

// Moves one copy, of unknown rarity first then of the lowest one, as a duplicate conversion takes them. Rows locked by the caller.
async function moveCopy(sql: Sql, from: string, to: string, code: number): Promise<void> {
  const [{ quantity }] = await sql<{ quantity: number }[]>`select quantity from yugioh.collection where user_id = ${from} and card_code = ${code}`;
  const known = await sql<{ rarity: string; quantity: number }[]>`
    select rarity, quantity from yugioh.collection_rarities where user_id = ${from} and card_code = ${code}`;
  const counted = known.reduce((sum, row) => sum + row.quantity, 0);
  const rarity = quantity > counted ? undefined : known.map((row) => row.rarity).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0];
  await sql`update yugioh.collection set quantity = quantity - 1 where user_id = ${from} and card_code = ${code}`;
  if (rarity === undefined) {
    await sql`
      insert into yugioh.collection (user_id, card_code, quantity) values (${to}, ${code}, 1)
      on conflict (user_id, card_code) do update set quantity = collection.quantity + 1`;
    return;
  }
  // A row left with one copy goes before the others lose one.
  await sql`delete from yugioh.collection_rarities where user_id = ${from} and card_code = ${code} and rarity = ${rarity} and quantity = 1`;
  await sql`update yugioh.collection_rarities set quantity = quantity - 1 where user_id = ${from} and card_code = ${code} and rarity = ${rarity} and quantity > 1`;
  await addCards(sql, to, [{ code, rarity }]);
}

// Pending offers with a friend that have not expired, newest first.
export async function listTrades(db: Db, userId: string): Promise<TradeList> {
  const rows = await db<{ id: string; sent: boolean; pseudo: string; give: number; get: number; expires: Date }[]>`
    select t.id, t.from_id = ${userId} as sent, p.pseudo,
      case when t.from_id = ${userId} then t.give_code else t.take_code end as give,
      case when t.from_id = ${userId} then t.take_code else t.give_code end as get,
      t.created_at + ${EXPIRY}::interval as expires
    from yugioh.trades t
    join yugioh.profiles p on p.user_id = case when t.from_id = ${userId} then t.to_id else t.from_id end
    join yugioh.friendships f on f.status = 'accepted'
      and ((f.user_id = t.from_id and f.friend_id = t.to_id) or (f.user_id = t.to_id and f.friend_id = t.from_id))
    where t.status = 'pending' and ${userId} in (t.from_id, t.to_id) and t.created_at > now() - ${EXPIRY}::interval
    order by t.created_at desc, t.id desc`;
  const offer = ({ id, pseudo, give, get, expires }: (typeof rows)[number]): TradeOffer => ({ id: Number(id), pseudo, give, get, expiresAt: expires.toISOString() });
  const left = Math.max(0, TRADES_PER_DAY - (await acceptedToday(db, userId)));
  return { received: rows.filter((row) => !row.sent).map(offer), sent: rows.filter((row) => row.sent).map(offer), left };
}

export async function tradeCards(db: Db, userId: string, pseudo: string): Promise<TradeCards | string> {
  const friend = await friendOf(db, userId, pseudo);
  if (!friend) return NOT_FRIEND;
  return { mine: await spareCards(db, userId), theirs: await spareCards(db, friend.id) };
}

// The profile lock keeps two connections of a player from passing the limit of pending offers together.
export async function offerTrade(db: Db, userId: string, pseudo: string, give: number, get: number): Promise<{ to: string } | string> {
  if (give === get) return "choisissez deux cartes différentes";
  const friend = await friendOf(db, userId, pseudo);
  if (!friend) return NOT_FRIEND;
  return db.begin(async (sql) => {
    await sql`select 1 from yugioh.profiles where user_id = ${userId} for update`;
    await sql`delete from yugioh.trades where from_id = ${userId} and status = 'pending' and created_at <= now() - ${EXPIRY}::interval`;
    const [{ pending }] = await sql<{ pending: number }[]>`
      select count(*)::int as pending from yugioh.trades where from_id = ${userId} and status = 'pending'`;
    if (pending >= TRADE_PENDING_MAX) return `trop d'offres d'échange en attente (${TRADE_PENDING_MAX} au maximum)`;
    const error = (await copyError(sql, userId, give)) ?? (await copyError(sql, friend.id, get, friend.pseudo));
    if (error) return error;
    await sql`insert into yugioh.trades (from_id, to_id, give_code, take_code) values (${userId}, ${friend.id}, ${give}, ${get})`;
    return { to: friend.id };
  });
}

// Possession is checked again under lock: the offer row, then both profiles (daily limit), then the collection rows involved,
// each in a fixed order, so a second acceptance or a change of the collection waits for this one and sees its result.
export async function acceptTrade(db: Db, userId: string, id: number): Promise<{ from: string } | string> {
  return db.begin(async (sql) => {
    const [trade] = await sql<{ from: string; pseudo: string; give: number; take: number }[]>`
      select t.from_id as from, p.pseudo, t.give_code as give, t.take_code as take
      from yugioh.trades t join yugioh.profiles p on p.user_id = t.from_id
      where t.id = ${id} and t.to_id = ${userId} and t.status = 'pending' and t.created_at > now() - ${EXPIRY}::interval
      for update of t`;
    if (!trade) return "offre expirée ou déjà traitée";
    if (!(await friendOf(sql, userId, trade.pseudo))) return `${trade.pseudo} n'est plus dans vos amis`;
    await sql`select 1 from yugioh.profiles where user_id in (${userId}, ${trade.from}) order by user_id for update`;
    if ((await acceptedToday(sql, userId)) >= TRADES_PER_DAY) return `déjà ${TRADES_PER_DAY} échanges aujourd'hui, réessayez demain`;
    if ((await acceptedToday(sql, trade.from)) >= TRADES_PER_DAY) return `${trade.pseudo} a déjà fait ${TRADES_PER_DAY} échanges aujourd'hui, réessayez demain`;
    await sql`
      select 1 from yugioh.collection
      where user_id in (${userId}, ${trade.from}) and card_code in (${trade.give}, ${trade.take})
      order by user_id, card_code for update`;
    const error = (await copyError(sql, userId, trade.take)) ?? (await copyError(sql, trade.from, trade.give, trade.pseudo));
    if (error) return error;
    await moveCopy(sql, trade.from, userId, trade.give);
    await moveCopy(sql, userId, trade.from, trade.take);
    await sql`update yugioh.trades set status = 'accepted', decided_at = now() where id = ${id}`;
    return { from: trade.from };
  });
}

export async function removeTrade(db: Db, userId: string, id: number): Promise<{ other: string; refused: boolean } | undefined> {
  const [row] = await db<{ from: string; to: string }[]>`
    delete from yugioh.trades where id = ${id} and status = 'pending' and ${userId} in (from_id, to_id)
    returning from_id as from, to_id as to`;
  if (!row) return undefined;
  return row.from === userId ? { other: row.to, refused: false } : { other: row.from, refused: true };
}

export const dbTradeStore = (db: Db): TradeStore => ({
  trades: (userId) => listTrades(db, userId),
  tradeCards: (userId, pseudo) => tradeCards(db, userId, pseudo),
  offerTrade: (userId, pseudo, give, get) => offerTrade(db, userId, pseudo, give, get),
  acceptTrade: (userId, id) => acceptTrade(db, userId, id),
  removeTrade: (userId, id) => removeTrade(db, userId, id),
});
