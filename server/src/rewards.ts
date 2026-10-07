import type { Accounts } from "./accounts.ts";
import { duelGains, fusionOnField, newTally, type MissionProgress } from "./missions.ts";
import type { Seat } from "./protocol.ts";
import { CONNECTION_LOST, SURRENDER, TIME_LIMIT, type Room } from "./room.ts";
import { TOWER, towerLevel, towerRules } from "./tower.ts";
import { send } from "./wire.ts";

// Credits the winner of an online duel between two players with a booster, ONLINE_BOOSTERS_MAX a day; a duel against the bot earns nothing.
export function creditWinner(room: Room, seat: Seat, accounts: Pick<Accounts, "winOnline">) {
  const winner = room.players[seat];
  if (winner && !room.players.some((player) => player.bot)) {
    accounts.winOnline(winner.id).then(
      (earned) => send(winner.socket, { type: "online_won", earned }),
      (error: unknown) => console.error(error),
    );
  }
}

const FORFEITS: ReadonlySet<number> = new Set([SURRENDER, TIME_LIMIT, CONNECTION_LOST]);

// What a finished duel brings to the missions of `seat`, while the duel is still open. An online duel outside ranked and
// events counts once a day per opponent.
export function missionProgress(room: Room, seat: Seat, winner: Seat, reason: number): MissionProgress {
  const tally = room.tally ?? newTally();
  const gains = duelGains({
    won: seat === winner,
    forfeit: FORFEITS.has(reason),
    story: room.mode?.mode === "story",
    ranked: room.ranked === true,
    summons: tally.summons[seat],
    damage: tally.damage[seat],
    fusion: room.duel !== undefined && fusionOnField(room.duel, seat),
  });
  const casual = room.mode?.mode === "online" && !room.ranked && !room.event;
  return casual ? { gains, opponent: room.players[1 - seat]?.id } : { gains };
}

// Tower mode: sets the room up for `floor`, with its opponent once the bot is seated. A win of seat 0 climbs, any other
// result of the duel (loss, surrender) sends back to floor 1; a duel without result changes nothing.
export function towerFloor(room: Room, floor: number, accounts: Pick<Accounts, "winTower" | "loseTower">) {
  const level = towerLevel(floor);
  const tower: NonNullable<Room["tower"]> = { floor };
  const opponent = TOWER[floor - 1];
  room.rules = towerRules(floor);
  room.level = level;
  room.mode = { mode: "bot", level };
  room.tower = tower;
  const bot = room.players[1];
  if (bot) {
    bot.name = opponent.name;
    bot.deck = opponent.main;
    bot.extra = opponent.extra;
  }
  room.onWin = (winner) => {
    const player = room.players[0];
    if (!player) return;
    if (winner !== 0) {
      tower.saved = accounts.loseTower(player.id, floor).catch((error: unknown) => console.error(error));
      return;
    }
    tower.saved = accounts.winTower(player.id, floor).then(
      (won) => send(room.players[0]?.socket, { type: "tower_won", ...won }),
      (error: unknown) => {
        console.error(error);
        send(room.players[0]?.socket, { type: "error", error: "victoire non enregistrée, l'étage est à rejouer" });
      },
    );
  };
}
