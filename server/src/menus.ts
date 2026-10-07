import type { WebSocket } from "ws";
import type { Accounts } from "./accounts.ts";
import { deckReply, isDeckMessage } from "./collection.ts";
import { draftReply, isDraftMessage } from "./draft.ts";
import { economyReply, isEconomyMessage } from "./economy.ts";
import { eventOf } from "./event.ts";
import { replayAllowed, replayMessage, REPLAYS_LIMITED } from "./history.ts";
import { joinFriends, progressMissions, type Connection, type Lobby, type User } from "./lobby.ts";
import { profileReply, type ProfileMessage } from "./profile.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";
import { puzzleView } from "./puzzles.ts";
import { isSealedMessage, sealedReply } from "./sealed.ts";
import type { Starter } from "./starter.ts";
import { STORY, storyView } from "./story.ts";
import { isWishMessage, wishReply } from "./wishlist.ts";
import { isWonderMessage, wonderReply } from "./wonder.ts";
import { send } from "./wire.ts";

const PSEUDO = /^[\w-]{3,20}$/;
const adminFlag = (lobby: Lobby, id: string) => (lobby.admins.has(id) ? { admin: true as const } : {});
const dailyFlag = (daily: boolean) => (daily ? { daily: true as const } : {});

export async function identify(conn: Connection, token: string): Promise<string | undefined> {
  if (conn.user) return "déjà authentifié";
  const { accounts } = conn.lobby;
  const id = await accounts.verify(token);
  if (!id) return "jeton invalide";
  const profile = await accounts.findProfile(id);
  const [cards, daily] = profile ? await Promise.all([accounts.profileCards(id), accounts.claimDaily(id)]) : [undefined, false];
  const user: User = { id, pseudo: profile?.pseudo, avatar: cards?.avatar ?? undefined };
  conn.user = user;
  if (user.pseudo) joinFriends(conn, user.id, user.pseudo);
  send(conn.socket, { type: "profile", pseudo: user.pseudo ?? null, needsStarter: profile?.activeDeckId === null, ...adminFlag(conn.lobby, id), ...dailyFlag(daily) });
  return undefined;
}

export async function choosePseudo(conn: Connection, player: User, pseudo: string): Promise<string | undefined> {
  if (player.pseudo) return "pseudo déjà choisi";
  if (!PSEUDO.test(pseudo)) return "pseudo invalide : 3 à 20 caractères, lettres sans accent, chiffres, _ ou -";
  const { accounts } = conn.lobby;
  const profile = await accounts.createProfile(player.id, pseudo);
  if (!profile) return "pseudo déjà pris";
  player.pseudo = profile.pseudo;
  joinFriends(conn, player.id, profile.pseudo);
  const daily = await accounts.claimDaily(player.id);
  send(conn.socket, { type: "profile", pseudo: profile.pseudo, needsStarter: profile.activeDeckId === null, ...adminFlag(conn.lobby, player.id), ...dailyFlag(daily) });
  return undefined;
}

export async function pickStarter(conn: Connection, player: User, starter: Starter): Promise<string | undefined> {
  const chosen = await conn.lobby.accounts.chooseStarter(player.id, starter);
  if (!chosen) return "starter déjà choisi";
  send(conn.socket, { type: "profile", pseudo: player.pseudo ?? null, needsStarter: false, ...adminFlag(conn.lobby, player.id) });
  return undefined;
}

// The reply of the collection, wishlist, economy, wonder, sealed and draft modules to their messages, undefined for another message.
export function storeReply(accounts: Accounts, userId: string, msg: ClientMessage): Promise<ServerMessage | string> | undefined {
  if (isDeckMessage(msg)) return deckReply(accounts, userId, msg);
  if (isWishMessage(msg)) return wishReply(accounts, userId, msg);
  if (isEconomyMessage(msg)) return economyReply(accounts, userId, msg);
  if (isWonderMessage(msg)) return wonderReply(accounts, userId, msg);
  if (isDraftMessage(msg)) return draftReply(accounts, userId, msg);
  if (isSealedMessage(msg)) return sealedReply(accounts, userId, msg);
  return undefined;
}

// Sends a reply to the player, or returns it when it is an error.
export async function sendReply(socket: WebSocket, reply: Promise<ServerMessage | string>): Promise<string | undefined> {
  const message = await reply;
  if (typeof message === "string") return message;
  send(socket, message);
  return undefined;
}

export async function manageProfile(conn: Connection, player: User, msg: ProfileMessage): Promise<string | undefined> {
  const reply = await profileReply(conn.lobby.accounts, player.id, msg);
  if (typeof reply === "string") return reply;
  if (reply.type === "player_profile") player.avatar = reply.avatar ?? undefined;
  send(conn.socket, reply);
  return undefined;
}

export async function grantBoosters(conn: Connection, player: { id: string }, count: number): Promise<string | undefined> {
  if (!conn.lobby.admins.has(player.id)) return "commande réservée";
  await conn.lobby.accounts.creditBoosters(player.id, count);
  return sendBoosterState(conn, player);
}

export async function sendBoosterState(conn: Connection, player: { id: string }): Promise<string | undefined> {
  send(conn.socket, { type: "booster_state", ...(await conn.lobby.accounts.boosterState(player.id)) });
  return undefined;
}

export async function openBoosterFor(conn: Connection, player: { id: string }, set: string): Promise<string | undefined> {
  const { accounts } = conn.lobby;
  try {
    send(conn.socket, { type: "booster_opened", set, cards: await accounts.openBooster(player.id, set) });
    progressMissions(accounts, player.id, { gains: { boosters: 1 } }, conn);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "erreur inattendue";
  }
}

export async function showMissions(conn: Connection, userId: string): Promise<undefined> {
  send(conn.socket, { type: "missions", ...(await conn.lobby.accounts.missions(userId)) });
  return undefined;
}

export async function sendReplays(conn: Connection, userId: string): Promise<undefined> {
  send(conn.socket, { type: "replays", replays: await conn.lobby.accounts.replays(userId) });
  return undefined;
}

export async function showReplay(conn: Connection, userId: string, id: number): Promise<string | undefined> {
  if (!replayAllowed(conn.lobby.replaysAsked, userId)) return REPLAYS_LIMITED;
  const stored = await conn.lobby.accounts.readReplay(userId, id);
  if (!stored) return "duel introuvable";
  send(conn.socket, await replayMessage(stored, id));
  return undefined;
}

export async function showStory(conn: Connection, userId: string): Promise<undefined> {
  const { accounts } = conn.lobby;
  const [progress, revenges] = await Promise.all([accounts.storyProgress(userId), accounts.revengesWon(userId)]);
  send(conn.socket, { type: "story", arcs: storyView(progress, STORY, revenges) });
  return undefined;
}

export async function showEvent(conn: Connection, userId: string): Promise<undefined> {
  const { id, rule, lp, hand } = eventOf();
  send(conn.socket, { type: "event", rule, lp, hand, won: await conn.lobby.accounts.eventWon(userId, id) });
  return undefined;
}

export async function showPuzzles(conn: Connection, userId: string): Promise<undefined> {
  send(conn.socket, { type: "puzzles", puzzles: puzzleView(await conn.lobby.accounts.solvedPuzzles(userId)) });
  return undefined;
}

export async function showTower(conn: Connection, userId: string): Promise<undefined> {
  send(conn.socket, { type: "tower", ...(await conn.lobby.accounts.towerView(userId)) });
  return undefined;
}

export async function sendResults(conn: Connection, userId: string): Promise<undefined> {
  send(conn.socket, { type: "duel_results", results: await conn.lobby.accounts.duelResults(userId) });
  return undefined;
}

export async function showRanked(conn: Connection, userId: string): Promise<undefined> {
  send(conn.socket, { type: "ranked", ...(await conn.lobby.accounts.ranked(userId)) });
  return undefined;
}
