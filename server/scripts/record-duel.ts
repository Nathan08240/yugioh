// Records what player 0's client receives during an automated duel, replayed by client/src/board.test.ts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OcgFieldState } from "@n1xx1/ocgcore-wasm";
import type { WebSocket } from "ws";
import { KAIBA, YUGI } from "../src/decks.ts";
import { openDuel, STARTING_LP } from "../src/duel.ts";
import { respond } from "../src/respond.ts";
import { advance, type Room } from "../src/server.ts";

const [seed = "77"] = process.argv.slice(2);
const received: unknown[] = [];
const recorder = { send: (data: string) => received.push(JSON.parse(data)) } as unknown as WebSocket;
const { lib, handle } = await openDuel([BigInt(seed), 2n, 3n, 4n], [YUGI, KAIBA], console.error);
// The real field when the duel ends, to check the board the client rebuilds.
let field: OcgFieldState | undefined;
const room: Room = {
  code: "FIXTURE",
  players: [
    { id: "a", socket: recorder, log: [] },
    { id: "b", log: [] },
  ],
  duel: {
    handle,
    lib: {
      duelProcess: (h) => lib.duelProcess(h),
      duelGetMessage: (h) => lib.duelGetMessage(h),
      destroyDuel: (h) => {
        field = lib.duelQueryField(h);
        lib.destroyDuel(h);
      },
    } as Partial<typeof lib> as typeof lib,
  },
};

advance(room);
while (room.duel && room.question) {
  lib.duelSetResponse(handle, respond(room.question));
  advance(room);
}
const fixture = { seat: 0, lp: STARTING_LP, decks: [YUGI.length, KAIBA.length], received, field };
const file = join(import.meta.dirname, "..", "..", "client", "src", "fixtures", "duel.json");
writeFileSync(file, JSON.stringify(fixture, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
console.log(`${received.length} messages reçus par J1 dans ${file}`);
