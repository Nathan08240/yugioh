import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { OcgLocation, OcgMessageType, OcgPosition, SelectBattleCMDAction, SelectIdleCMDAction, type OcgMessage } from "@n1xx1/ocgcore-wasm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import type { Board, Card } from "../../client/src/board.ts";
import { Bot } from "../src/bot.ts";
import { KAIBA, YUGI } from "../src/decks.ts";
import { runDuel, STARTING_LP, type Player, type Seed } from "../src/duel.ts";
import type { BotLevel, ClientMessage, DuelEvent, Seat, ServerMessage, Wire } from "../src/protocol.ts";
import { respond } from "../src/respond.ts";
import { startServer } from "../src/server.ts";
import { hideCards, visibleTo } from "../src/visibility.ts";
import { fakeAccounts } from "./fakes.ts";

const seeds: Seed[] = Array.from({ length: 40 }, (_, i) => [BigInt(i + 1), 2n, 3n, 4n]);
const firstOption: Player = (question) => respond(question);

function bot(seat: Seat, level?: BotLevel): Player {
  const player = new Bot(seat, STARTING_LP, [YUGI.length, KAIBA.length], 0, undefined, level);
  return (question, log) => player.answer(question, log);
}

describe("bot", () => {
  it("joue contre lui-même jusqu'à la victoire sur 40 seeds, sans réponse refusée ni repli", { timeout: 120_000 }, async () => {
    const errors = vi.spyOn(console, "error");
    for (const seed of seeds) {
      const state = await runDuel(seed, 500, [bot(0), bot(1)]);
      expect(state.winner, `seed ${seed[0]}`).not.toBeNull();
      expect(state.errors).toEqual([]);
    }
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("bat nettement le répondeur « première option valide », avec les deux decks", { timeout: 120_000 }, async () => {
    let wins = 0;
    for (const seed of seeds) {
      wins += Number((await runDuel(seed, 500, [bot(0), firstOption])).winner === 0);
      wins += Number((await runDuel(seed, 500, [firstOption, bot(1)])).winner === 1);
    }
    console.log(`bot contre première option : ${wins} victoires sur ${seeds.length * 2} duels`);
    expect(wins / (seeds.length * 2)).toBeGreaterThan(0.65);
  });

  it("joue un duel complet dans une salle contre un humain, sans recevoir d'information cachée", { timeout: 30_000 }, async () => {
    const credit = vi.fn(async () => {});
    const wss = startServer(0, fakeAccounts({ creditBoosters: credit }), () => [5n, 2n, 3n, 4n], 0);
    onTestFinished(() => wss.close());
    await once(wss, "listening");
    const answer = vi.spyOn(Bot.prototype, "answer");

    const socket = new WebSocket(`ws://localhost:${(wss.address() as AddressInfo).port}`);
    const received: Wire<ServerMessage>[] = [];
    const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
    socket.on("message", (data) => {
      const msg: Wire<ServerMessage> = JSON.parse(String(data));
      received.push(msg);
      // respond() reads no bigint field for the questions of these decks, so the wire form works as is.
      if (msg.type === "question") send({ type: "respond", response: respond(msg.question as unknown as OcgMessage) });
    });
    await once(socket, "open");
    send({ type: "auth", token: "alice" });
    send({ type: "bot" });
    const messages = () => received.flatMap((msg) => (msg.type === "messages" ? msg.messages : []));
    await vi.waitFor(() => expect(messages()).toContainEqual(expect.objectContaining({ type: OcgMessageType.WIN })), { timeout: 25_000 });
    // The bot compliments the human who beat it, and only then.
    const won = messages().find((msg) => msg.type === OcgMessageType.WIN);
    const compliment = { type: "emote", seat: 1, id: "bienjoue" };
    if (won?.type === OcgMessageType.WIN && won.player === 0) await vi.waitFor(() => expect(received).toContainEqual(compliment));
    else expect(received).not.toContainEqual(compliment);
    socket.close();

    // The player's active deck against the bot's, and no booster for a duel against the bot.
    expect(received).toContainEqual(expect.objectContaining({ type: "joined", seat: 0, decks: [YUGI.length, KAIBA.length], opponent: "Bot" }));
    expect(credit).not.toHaveBeenCalled();
    for (const msg of received) if (msg.type === "question") expect(msg.question).toMatchObject({ player: 0 });
    expect(answer).toHaveBeenCalled();
    const log = answer.mock.lastCall?.[1] ?? [];
    // Everything the bot got had already gone through the filter of its seat.
    const engine = log.flatMap((msg) => (msg.type === "stats" ? [] : [msg]));
    expect(engine.map((msg) => visibleTo(msg, 1))).toEqual(engine);
    for (const [question] of answer.mock.calls) expect(hideCards(question, 1)).toEqual(question);
    const drawn = log.flatMap((msg) => (msg.type === OcgMessageType.DRAW && msg.player === 0 ? msg.drawn : []));
    const hidden = drawn.filter((card) => (card.position & OcgPosition.FACEUP) === 0);
    expect(hidden.length).toBeGreaterThan(5);
    expect(hidden.filter((card) => card.code !== 0)).toEqual([]);
    answer.mockRestore();
  });
});

describe("bot : ATK et DEF actuelles", () => {
  const CELTIC_GUARDIAN = 91152256; // 1400 / 1200
  const BEAVER_WARRIOR = 32452818; // 1200 / 1500
  const GAIA = 6368038; // 2300 / 2100
  const faceUpAttack = (code: number, atk?: number): Card => ({ code, position: OcgPosition.FACEUP_ATTACK, atk });

  // Does the bot's monster (seat 0, sequence 0) attack the opponent's one (seat 1, sequence 0)?
  function attacks(own: Card, opponent: Card): boolean {
    const player = new Bot(0, STARTING_LP, [YUGI.length, KAIBA.length], 0);
    const { players } = (player as unknown as { board: Board }).board;
    players[0].monsters[0] = own;
    players[1].monsters[0] = opponent;
    const question: OcgMessage = {
      type: OcgMessageType.SELECT_BATTLECMD,
      player: 0,
      chains: [],
      attacks: [{ code: own.code, controller: 0, location: OcgLocation.MZONE, sequence: 0, can_direct: false }],
      to_m2: true,
      to_ep: true,
    };
    return (player.answer(question, []) as { action: SelectBattleCMDAction }).action === SelectBattleCMDAction.SELECT_BATTLE;
  }

  it("n'attaque pas un monstre adverse boosté au-dessus de son ATK imprimée", () => {
    expect(attacks(faceUpAttack(CELTIC_GUARDIAN), faceUpAttack(BEAVER_WARRIOR))).toBe(true);
    expect(attacks(faceUpAttack(CELTIC_GUARDIAN), faceUpAttack(BEAVER_WARRIOR, 2000))).toBe(false);
  });

  it("attaque avec son propre monstre boosté au-dessus de l'ATK imprimée de la cible", () => {
    expect(attacks(faceUpAttack(CELTIC_GUARDIAN), faceUpAttack(GAIA))).toBe(false);
    expect(attacks(faceUpAttack(CELTIC_GUARDIAN, 2600), faceUpAttack(GAIA))).toBe(true);
  });
});

describe("bot : niveaux", () => {
  const CELTIC_GUARDIAN = 91152256; // 1400 / 1200
  const BEAVER_WARRIOR = 32452818; // 1200 / 1500
  const GAIA = 6368038; // 2300 / 2100, level 7
  const SUMMONED_SKULL = 70781052; // 2500 / 1200
  const KURIBOH = 40640057; // 300 / 200
  const POT_OF_GREED = 55144522;
  const TRAP_HOLE = 4206964;
  const always = () => 0;
  const never = () => 0.99;
  const faceUp = (code: number): Card => ({ code, position: OcgPosition.FACEUP_ATTACK });
  const faceDown: Card = { code: 0, position: OcgPosition.FACEDOWN_DEFENSE };
  const at = (code: number, sequence: number) => ({ code, controller: 0 as const, location: OcgLocation.MZONE, sequence });

  function make(level: BotLevel, random = never, own: Card[] = [], opponent: Card[] = []) {
    const player = new Bot(0, STARTING_LP, [YUGI.length, KAIBA.length], 0, undefined, level, random);
    const { players } = (player as unknown as { board: Board }).board;
    for (const [sequence, card] of own.entries()) players[0].monsters[sequence] = card;
    for (const [sequence, card] of opponent.entries()) players[1].monsters[sequence] = card;
    return player;
  }

  // The attacker (index in the attack list) and the opponent monster (sequence) chosen, undefined when the bot does not attack.
  function attackPick(player: Bot, attackers: number[], targets: number): { attacker: number; target: number } | undefined {
    const own = (player as unknown as { board: Board }).board.players[0].monsters;
    const battle: OcgMessage = {
      type: OcgMessageType.SELECT_BATTLECMD,
      player: 0,
      chains: [],
      attacks: attackers.map((sequence) => ({ ...at(own[sequence]?.code ?? 0, sequence), can_direct: false })),
      to_m2: true,
      to_ep: true,
    };
    const first = player.answer(battle, []) as { action: SelectBattleCMDAction; index: number };
    if (first.action !== SelectBattleCMDAction.SELECT_BATTLE) return undefined;
    const selects = Array.from({ length: targets }, (_, sequence) => ({ ...at(0, sequence), controller: 1 as const, position: OcgPosition.FACEUP_ATTACK }));
    const pick = player.answer({ type: OcgMessageType.SELECT_CARD, player: 0, can_cancel: false, min: 1, max: 1, selects }, []) as { indicies: number[] };
    return { attacker: first.index, target: pick.indicies[0] };
  }

  function idle(player: Bot, fields: Partial<Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }>>): SelectIdleCMDAction {
    const question = { type: OcgMessageType.SELECT_IDLECMD, player: 0, summons: [], special_summons: [], pos_changes: [], monster_sets: [], spell_sets: [], activates: [], to_bp: true, to_ep: true, ...fields };
    return (player.answer(question as unknown as OcgMessage, []) as { action: SelectIdleCMDAction }).action;
  }

  const hand = (code: number) => ({ code, controller: 0 as const, location: OcgLocation.HAND, sequence: 0 });

  it("débutant : attaque parfois un monstre plus fort, là où le niveau normal s'abstient", () => {
    const attack = (level: BotLevel, random: () => number) => attackPick(make(level, random, [faceUp(CELTIC_GUARDIAN)], [faceUp(GAIA)]), [0], 1);
    expect(attack("normal", always)).toBeUndefined();
    expect(attack("debutant", never)).toBeUndefined();
    expect(attack("debutant", always)).toEqual({ attacker: 0, target: 0 });
  });

  it("débutant : n'active pas toujours ses cartes", () => {
    const pot = { activates: [{ ...hand(POT_OF_GREED), description: 0n, client_mode: 0 }] };
    expect(idle(make("normal"), pot)).toBe(SelectIdleCMDAction.SELECT_ACTIVATE);
    expect(idle(make("debutant", never), pot)).toBe(SelectIdleCMDAction.SELECT_ACTIVATE);
    expect(idle(make("debutant", always), pot)).toBe(SelectIdleCMDAction.TO_BP);
  });

  it("débutant : ne pose pas de pièges", () => {
    const sets = { spell_sets: [hand(TRAP_HOLE)] };
    expect(idle(make("normal"), sets)).toBe(SelectIdleCMDAction.SELECT_SPELL_SET);
    expect(idle(make("debutant", never), sets)).toBe(SelectIdleCMDAction.TO_BP);
  });

  it("expert : n'attaque pas un monstre face cachée quand il peut attaquer ailleurs", () => {
    const attack = (level: BotLevel) => attackPick(make(level, never, [faceUp(GAIA)], [faceDown, faceUp(KURIBOH)]), [0], 2)?.target;
    expect(attack("normal")).toBe(0);
    expect(attack("expert")).toBe(1);
  });

  it("expert : attaque un monstre face cachée avec son plus faible attaquant qui le bat", () => {
    const attacker = (level: BotLevel) => attackPick(make(level, never, [faceUp(GAIA), faceUp(SUMMONED_SKULL)], [faceDown]), [0, 1], 1)?.attacker;
    expect(attacker("normal")).toBe(1);
    expect(attacker("expert")).toBe(0);
  });

  it("expert : préfère poser un monstre en défense quand ses LP sont menacés", () => {
    const summon = (level: BotLevel) => {
      const player = make(level, never, [], [faceUp(CELTIC_GUARDIAN)]);
      (player as unknown as { board: Board }).board.players[0].lp = 1000;
      return idle(player, { summons: [at(GAIA, 0)], monster_sets: [at(BEAVER_WARRIOR, 1)] });
    };
    expect(summon("normal")).toBe(SelectIdleCMDAction.SELECT_SUMMON);
    expect(summon("expert")).toBe(SelectIdleCMDAction.SELECT_MONSTER_SET);
  });

  describe("expert plus fort", () => {
    const GIANT_SOLDIER = 13039848; // 1300 / 2000
    const MYSTICAL_SPACE_TYPHOON = 5318639;
    const DARK_HOLE = 53129443;
    const WABOKU = 12607053;
    const DRAGON_CAPTURE_JAR = 50045299;
    const TORRENTIAL_TRIBUTE = 53582587;
    const faceUpDefense = (code: number): Card => ({ code, position: OcgPosition.FACEUP_DEFENSE });
    const boardOf = (player: Bot) => (player as unknown as { board: Board }).board;

    // The bot at seat 0 with `size` cards in hand and `backrow` traps set.
    function stocked(level: BotLevel, size: number, backrow: number) {
      const player = make(level);
      const { players } = boardOf(player);
      players[0].hand = Array.from({ length: size }, () => ({ code: DARK_HOLE, position: OcgPosition.FACEDOWN_DEFENSE }));
      for (let i = 0; i < backrow; i++) players[0].spells[i] = { code: TRAP_HOLE, position: OcgPosition.FACEDOWN_DEFENSE };
      return player;
    }

    // The opponent's monster at `sequence` attacks the bot's monster `target`, or the bot directly; the bot answers a chain of `codes`.
    function responds(player: Bot, codes: number[], sequence: number, target: number | null): number | null {
      const place = (seq: number, controller: 0 | 1) => ({ ...at(0, seq), controller, position: OcgPosition.FACEUP_ATTACK });
      const attack = { type: OcgMessageType.ATTACK, card: place(sequence, 1), target: target === null ? null : place(target, 0) } as unknown as DuelEvent;
      const selects = codes.map((code, i) => ({ ...at(code, i), location: OcgLocation.SZONE, position: OcgPosition.FACEDOWN_DEFENSE, description: 0n, client_mode: 0 }));
      const question = { type: OcgMessageType.SELECT_CHAIN, player: 0, spe_count: 0, forced: false, hint_timing: 0, hint_timing_other: 0, selects } as unknown as OcgMessage;
      return (player.answer(question, [attack]) as { index: number | null }).index;
    }

    it("choisit l'attaque qui finit le duel, même sur un monstre moins précieux", () => {
      const pick = (level: BotLevel) => {
        const player = make(level, never, [faceUp(SUMMONED_SKULL), faceUp(GAIA)], [faceUpDefense(GIANT_SOLDIER), faceUp(CELTIC_GUARDIAN)]);
        boardOf(player).players[1].lp = 1100;
        return attackPick(player, [0, 1], 2);
      };
      expect(pick("normal")).toEqual({ attacker: 0, target: 0 });
      expect(pick("expert")).toEqual({ attacker: 0, target: 1 });
    });

    it("répartit ses attaquants pour détruire le plus, sans perdre de monstre", () => {
      const pick = (level: BotLevel) => attackPick(make(level, never, [faceUp(GAIA), faceUp(CELTIC_GUARDIAN)], [faceUp(CELTIC_GUARDIAN), faceUp(BEAVER_WARRIOR), faceUp(KURIBOH)]), [0, 1], 3);
      expect(pick("normal")).toEqual({ attacker: 0, target: 1 });
      expect(pick("expert")).toEqual({ attacker: 1, target: 1 });
    });

    it("ne se croit pas menacé quand ses monstres bloquent les attaquants adverses", () => {
      const summon = (own: Card[]) => {
        const player = make("expert", never, own, [faceUp(CELTIC_GUARDIAN), faceUp(CELTIC_GUARDIAN)]);
        boardOf(player).players[0].lp = 2000;
        return idle(player, { summons: [at(GAIA, 0)], monster_sets: [at(BEAVER_WARRIOR, 1)] });
      };
      expect(summon([])).toBe(SelectIdleCMDAction.SELECT_MONSTER_SET);
      expect(summon([faceUp(BEAVER_WARRIOR), faceUp(KURIBOH)])).toBe(SelectIdleCMDAction.SELECT_SUMMON);
    });

    it("pose face cachée une magie jeu-rapide", () => {
      const sets = { spell_sets: [hand(MYSTICAL_SPACE_TYPHOON)] };
      expect(idle(stocked("normal", 3, 0), sets)).toBe(SelectIdleCMDAction.TO_BP);
      expect(idle(stocked("expert", 3, 0), sets)).toBe(SelectIdleCMDAction.SELECT_SPELL_SET);
    });

    it("pose une magie qu'il ne peut pas utiliser, sans vider sa main ni bloquer ses zones", () => {
      const sets = { spell_sets: [hand(DARK_HOLE)] };
      expect(idle(stocked("normal", 3, 0), sets)).toBe(SelectIdleCMDAction.TO_BP);
      expect(idle(stocked("expert", 3, 0), sets)).toBe(SelectIdleCMDAction.SELECT_SPELL_SET);
      expect(idle(stocked("expert", 1, 0), sets)).toBe(SelectIdleCMDAction.TO_BP);
      expect(idle(stocked("expert", 3, 3), sets)).toBe(SelectIdleCMDAction.TO_BP);
    });

    it("répond à une attaque par le piège qui l'arrête, pas par le premier utilisable", () => {
      const answer = (level: BotLevel) => responds(make(level, never, [faceUp(CELTIC_GUARDIAN)], [faceUp(SUMMONED_SKULL)]), [DRAGON_CAPTURE_JAR, WABOKU], 0, 0);
      expect(answer("normal")).toBe(0);
      expect(answer("expert")).toBe(1);
    });

    it("garde une destruction de masse qui coûte plus qu'elle ne rapporte, la joue sinon", () => {
      const costly = (level: BotLevel, codes: number[]) => responds(make(level, never, [faceUp(GAIA), faceUp(CELTIC_GUARDIAN)], [faceUp(SUMMONED_SKULL)]), codes, 0, 0);
      expect(costly("normal", [TORRENTIAL_TRIBUTE, WABOKU])).toBe(0);
      expect(costly("expert", [TORRENTIAL_TRIBUTE, WABOKU])).toBe(1);
      expect(costly("expert", [TORRENTIAL_TRIBUTE])).toBeNull();
      const pays = responds(make("expert", never, [], [faceUp(SUMMONED_SKULL), faceUp(GAIA)]), [WABOKU, TORRENTIAL_TRIBUTE], 0, null);
      expect(pays).toBe(1);
    });

    it("joue contre lui-même jusqu'à la victoire, sans réponse refusée ni repli", { timeout: 120_000 }, async () => {
      const errors = vi.spyOn(console, "error");
      onTestFinished(() => errors.mockRestore());
      for (const seed of seeds) {
        const state = await runDuel(seed, 500, [bot(0, "expert"), bot(1, "expert")]);
        expect(state.winner, `seed ${seed[0]}`).not.toBeNull();
        expect(state.errors).toEqual([]);
      }
      expect(errors).not.toHaveBeenCalled();
    });
  });

  it.each(["debutant", "expert"] as const)("niveau %s : mène un duel contre le niveau normal jusqu'au bout, sans réponse refusée", { timeout: 60_000 }, async (level) => {
    for (const seed of seeds.slice(0, 6)) {
      const state = await runDuel(seed, 500, [bot(0, level), bot(1)]);
      expect(state.winner, `seed ${seed[0]}`).not.toBeNull();
      expect(state.errors).toEqual([]);
    }
  });

  it("le message bot accepte un niveau connu et refuse les autres", { timeout: 30_000 }, async () => {
    const wss = startServer(0, fakeAccounts(), () => [5n, 2n, 3n, 4n], 0);
    onTestFinished(() => wss.close());
    await once(wss, "listening");
    const socket = new WebSocket(`ws://localhost:${(wss.address() as AddressInfo).port}`);
    onTestFinished(() => socket.close());
    const received: Wire<ServerMessage>[] = [];
    socket.on("message", (data) => received.push(JSON.parse(String(data))));
    await once(socket, "open");
    socket.send(JSON.stringify({ type: "auth", token: "alice" }));
    socket.send(JSON.stringify({ type: "bot", level: "impossible" }));
    await vi.waitFor(() => expect(received).toContainEqual({ type: "error", error: "message invalide" }), { timeout: 10_000 });
    socket.send(JSON.stringify({ type: "bot", level: "expert" }));
    await vi.waitFor(() => expect(received).toContainEqual(expect.objectContaining({ type: "joined", opponent: "Bot" })), { timeout: 10_000 });
  });
});
