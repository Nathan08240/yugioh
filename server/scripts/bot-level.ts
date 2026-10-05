// Win rate of one bot level against another over N seeds, both seats each. Usage: pnpm --filter server bot-level [expert] [normal] [seeds]
import { Bot } from "../src/bot.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { runDuel, STARTING_LP, type Player, type Seed } from "../src/duel.ts";
import type { BotLevel, Seat } from "../src/protocol.ts";

const [a = "expert", b = "normal", count = "40"] = process.argv.slice(2);

function bot(seat: Seat, level: BotLevel): Player {
  const player = new Bot(seat, STARTING_LP, [YUGI.length, KAIBA.length], 0, undefined, level);
  return (question, log) => player.answer(question, log);
}

let wins = 0;
let draws = 0;
const duels = Number(count) * 2;
for (let i = 0; i < Number(count); i++) {
  const seed: Seed = [BigInt(i + 1), 2n, 3n, 4n];
  for (const seat of [0, 1] as const) {
    const players = seat === 0 ? [bot(0, a as BotLevel), bot(1, b as BotLevel)] : [bot(0, b as BotLevel), bot(1, a as BotLevel)];
    const { winner } = await runDuel(seed, 500, players);
    if (winner === null) draws++;
    else wins += Number(winner === seat);
  }
}
console.log(`${a} contre ${b} : ${wins} victoires sur ${duels} duels (${((wins / duels) * 100).toFixed(1)} %), ${draws} sans vainqueur`);
