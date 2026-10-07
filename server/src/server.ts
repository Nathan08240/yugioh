import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { dbAccounts, type Accounts } from "./accounts.ts";
import { connect } from "./connection.ts";
import { openDb } from "./db.ts";
import { friendHub } from "./friends.ts";
import { artFile, SERVED, serveHttp } from "./http.ts";
import { shutdown, type FriendEntry, type Lobby } from "./lobby.ts";
import { challengeDuel, matchQueue } from "./modes.ts";
import { creditWinner, missionProgress, towerFloor } from "./rewards.ts";
import { advance, ANSWERS, DECISION_TIME, randomSeed, RECONNECT_TIME, type Room } from "./room.ts";
import { send } from "./wire.ts";

export { advance, ANSWERS, creditWinner, dbAccounts, DECISION_TIME, missionProgress, randomSeed, RECONNECT_TIME, towerFloor, type Accounts, type Room };

// Pause before each answer of the bot, so the human can follow its moves.
const BOT_DELAY = 700;

// Comma-separated Supabase user ids allowed to use the admin commands.
const adminIds = (value = "") => new Set(value.split(",").map((id) => id.trim()).filter(Boolean));

// The bot takes seat 1. `shutdown` stops the server for an update (see its comment in lobby.ts).
export function startServer(port: number, accounts: Accounts, newSeed = randomSeed, botDelay = BOT_DELAY): WebSocketServer & { shutdown: (maxMs: number) => Promise<void> } {
  const http = createServer(serveHttp);
  const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
  wss.on("close", () => http.close());
  http.listen(port);
  const lobby: Lobby = {
    rooms: new Map(),
    accounts,
    admins: adminIds(process.env.ADMIN_USER_IDS),
    newSeed,
    botDelay,
    waiting: new Map(),
    quick: new Map(),
    lastOpponent: new Map(),
    replaysAsked: new Map(),
    errorsSent: new Map(),
    friends: friendHub<FriendEntry>(accounts, send, (challenger, acceptor, options) => challengeDuel(lobby, challenger, acceptor, options), (code) => lobby.rooms.get(code)?.watch !== undefined),
    draining: false,
  };
  const matcher = setInterval(() => matchQueue(lobby), 1000).unref();
  wss.on("close", () => clearInterval(matcher));
  wss.on("connection", (socket) => connect(lobby, socket));
  return Object.assign(wss, { shutdown: (maxMs: number) => shutdown(lobby, wss, maxMs) });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  const server = startServer(port, dbAccounts(openDb()));
  console.log(`Serveur de partie sur http://localhost:${port} (WebSocket et /api)`);
  // Missing artworks download in the background: the server answers without them meanwhile.
  if ([...SERVED].some((code) => !existsSync(artFile(code)))) {
    spawn(process.execPath, [join(import.meta.dirname, "..", "scripts", "images.ts")], { stdio: "inherit" }).on("error", console.error);
  }
  // As PID 1 in a container, Node ignores SIGTERM without a handler.
  // Each deployment stops the old container this way: the duels in progress end first (DEPLOY.md).
  process.once("SIGTERM", () => {
    console.log("Arrêt demandé : plus de nouveau duel, fin des duels en cours");
    server.shutdown(Number(process.env.SHUTDOWN_MINUTES ?? 15) * 60_000).then(() => process.exit());
  });
}
