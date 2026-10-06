// Load test: N bot-vs-bot duels at once. Direct mode drives the real rooms without sockets; --ws goes through the WebSocket server.
// Each step runs in its own process, so the WASM heap of a step does not inflate the next. Usage: pnpm --filter server load [--ws] [--delay ms] [counts...]
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { OcgMessageType, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { WebSocket } from "ws";
import { Bot } from "../src/bot.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { openDuel, STARTING_LP, type Seed } from "../src/duel.ts";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { advance, startServer, type Room } from "../src/server.ts";
import { fakeAccounts } from "../test/fakes.ts";

type Result = { duels: number; finished: number; seconds: number; cpuSeconds: number; rssMb: number; heapMb: number; decisions: number[]; loopMaxMs: number; openMs: number; kbPerDuel: number; errors: string[] };

const DEADLINE = 10 * 60_000;
const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const seedOf = (i: number): Seed => [BigInt(i + 1), 2n, 3n, 4n];

// Samples the memory while `running()` holds, and collects console.error as errors.
async function measure(run: () => Promise<{ running: () => boolean; finished: () => number; decisions: number[]; openMs?: number[]; bytes?: () => number }>, duels: number): Promise<Result> {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  const loop = monitorEventLoopDelay();
  const start = performance.now();
  const cpu = process.cpuUsage();
  const state = await run();
  loop.enable();
  let rss = 0;
  let heap = 0;
  while (state.running() && performance.now() - start < DEADLINE) {
    const usage = process.memoryUsage();
    rss = Math.max(rss, usage.rss);
    heap = Math.max(heap, usage.heapUsed);
    await sleep(100);
  }
  const seconds = (performance.now() - start) / 1000;
  const used = process.cpuUsage(cpu);
  loop.disable();
  console.error = original;
  return { duels, finished: state.finished(), seconds, cpuSeconds: (used.user + used.system) / 1e6, rssMb: mb(rss), heapMb: mb(heap), decisions: state.decisions, loopMaxMs: loop.max / 1e6, openMs: median(state.openMs ?? []), kbPerDuel: (state.bytes?.() ?? 0) / 1024 / duels, errors };
}

// A bot that adds the engine time spent since its last answer to its own thinking time: one decision.
class TimedBot extends Bot {
  private readonly clock: { spent: number };
  private readonly decisions: number[];
  constructor(seat: 0 | 1, clock: { spent: number }, decisions: number[], delay: number) {
    super(seat, STARTING_LP, [YUGI.length, KAIBA.length], delay);
    this.clock = clock;
    this.decisions = decisions;
  }
  override answer(...args: Parameters<Bot["answer"]>): OcgResponse {
    const from = performance.now();
    const response = super.answer(...args);
    this.decisions.push(this.clock.spent + performance.now() - from);
    this.clock.spent = 0;
    return response;
  }
}

function direct(n: number, delay: number) {
  return measure(async () => {
    const decisions: number[] = [];
    const rooms: Room[] = [];
    const openMs: number[] = [];
    let finished = 0;
    for (let i = 0; i < n; i++) {
      const opening = performance.now();
      const { lib, handle } = await openDuel(seedOf(i), [YUGI, KAIBA], console.error);
      const clock = { spent: 0 };
      // Every engine call is timed into the clock of its room.
      const timed = new Proxy(lib, {
        get: (target, key) => {
          const member = Reflect.get(target, key);
          if (typeof member !== "function") return member;
          return (...args: unknown[]) => {
            const from = performance.now();
            try {
              return member.apply(target, args);
            } finally {
              clock.spent += performance.now() - from;
            }
          };
        },
      });
      const room: Room = {
        code: `L${i}`,
        players: [YUGI, KAIBA].map((deck, seat) => ({ id: `bot${seat}`, log: [], deck, bot: new TimedBot(seat as 0 | 1, clock, decisions, delay) })),
        duel: { lib: timed, handle },
        onWin: () => finished++,
      };
      rooms.push(room);
      advance(room);
      openMs.push(performance.now() - opening);
    }
    // Duels still open at the deadline are destroyed here; finished ones were destroyed by the room.
    setTimeout(() => rooms.forEach((room) => room.duel?.lib.destroyDuel(room.duel.handle)), DEADLINE).unref();
    return { running: () => rooms.some((room) => room.duel), finished: () => finished, decisions, openMs };
  }, n);
}

function viaWebSocket(n: number, delay: number) {
  return measure(async () => {
    let seed = 0;
    const wss = startServer(0, fakeAccounts(), () => seedOf(seed++), delay);
    await once(wss, "listening");
    const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;
    // Client-side latency: from the response sent to the next question received.
    const decisions: number[] = [];
    let finished = 0;
    let open = n;
    // What the clients received, in bytes of JSON.
    let bytes = 0;
    for (let i = 0; i < n; i++) {
      const socket = new WebSocket(url);
      const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
      let sentAt = 0;
      socket.on("open", () => {
        send({ type: "auth", token: `user${i}` });
        send({ type: "bot" });
      });
      socket.on("message", (data) => {
        const text = String(data);
        bytes += Buffer.byteLength(text);
        const msg: Wire<ServerMessage> = JSON.parse(text);
        if (msg.type === "question") {
          if (sentAt) decisions.push(performance.now() - sentAt);
          sentAt = performance.now();
          send({ type: "respond", response: respond(msg.question as unknown as OcgMessage) });
        } else if (msg.type === "messages" && msg.messages.some((m) => m.type === OcgMessageType.WIN)) {
          finished++;
          socket.close();
        } else if (msg.type === "duel_error" || msg.type === "error") {
          console.error(JSON.stringify(msg));
          socket.close();
        }
      });
      socket.on("close", () => open--);
    }
    return { running: () => open > 0, finished: () => finished, decisions, bytes: () => bytes };
  }, n);
}

const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const fixed = (value: number, digits = 1) => value.toFixed(digits);

const { values, positionals } = parseArgs({ allowPositionals: true, options: { ws: { type: "boolean" }, delay: { type: "string", default: "0" }, json: { type: "boolean" } } });
const delay = Number(values.delay);

if (values.json) {
  const n = Number(positionals[0]);
  const { decisions, ...rest } = await (values.ws ? viaWebSocket(n, delay) : direct(n, delay));
  console.log(JSON.stringify({ ...rest, decisions: decisions.length, meanMs: avg(decisions), maxMs: decisions.reduce((a, b) => Math.max(a, b), 0) }));
  process.exit(0);
}

const steps = positionals.length ? positionals : ["1", "10", "50", "100"];
const label = values.ws ? "WebSocket (latence client, réponse -> question suivante)" : "direct (moteur + bot par décision)";
console.log(`Mode ${label}, délai du bot ${delay} ms, Node ${process.version}
`);
console.log("| duels | terminés | durée (s) | CPU (s) | rss pic (Mo) | heap pic (Mo) | décisions | moy (ms) | max (ms) | ouverture méd. (ms) | retard boucle max (ms) | reçu par duel (Ko) | erreurs |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const step of steps) {
  const args = [import.meta.filename, "--json", ...(values.ws ? ["--ws"] : []), "--delay", String(delay), step];
  const r = JSON.parse(execFileSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  console.log(`| ${r.duels} | ${r.finished} | ${fixed(r.seconds)} | ${fixed(r.cpuSeconds)} | ${r.rssMb} | ${r.heapMb} | ${r.decisions} | ${fixed(r.meanMs, 2)} | ${fixed(r.maxMs)} | ${r.openMs ? fixed(r.openMs) : "-"} | ${fixed(r.loopMaxMs)} | ${r.kbPerDuel ? fixed(r.kbPerDuel) : "-"} | ${r.errors.length} |`);
  for (const error of r.errors.slice(0, 3)) console.log(`  ${error}`);
}
