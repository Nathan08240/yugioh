// Who attacks what in one battle phase, for the expert bot. Plain numbers only: no engine, no card data.
export type Attacker = { atk: number; direct: boolean; pierce: boolean };
// `guard`: what an attacker has to beat (ATK in attack position, DEF otherwise); `worth`: what its destruction takes from the opponent.
export type Foe = { guard: number; attackPos: boolean; worth: number; known: boolean };
export type Plan = { kills: [attacker: number, foe: number][]; direct: number[]; worth: number; damage: number; spent: number };

const beats = (attacker: Attacker, foe: Foe, trade: boolean) => (trade && foe.attackPos ? attacker.atk >= foe.guard : attacker.atk > foe.guard);
const hit = (attacker: Attacker, foe: Foe) => (foe.attackPos || attacker.pierce ? attacker.atk - foe.guard : 0);

// Every way to send attackers on foes they beat. The others hit directly once the field is clear, or when they can anyway.
// `trade`: a tie in attack position (both destroyed) counts as a win. `blind`: face-down foes may be picked as targets.
function* plans(attackers: readonly Attacker[], foes: readonly Foe[], trade: boolean, blind: boolean): Generator<Plan> {
  const kills: Plan["kills"] = [];
  const claimed = foes.map(() => false);

  function* walk(next: number, damage: number, worth: number, spent: number): Generator<Plan> {
    if (next === attackers.length) {
      const cleared = claimed.every(Boolean);
      const used = new Set(kills.map(([attacker]) => attacker));
      const direct = attackers.flatMap((attacker, index) => (!used.has(index) && (cleared || attacker.direct) ? [index] : []));
      yield { kills: [...kills], direct, worth, spent, damage: direct.reduce((sum, index) => sum + attackers[index].atk, damage) };
      return;
    }
    yield* walk(next + 1, damage, worth, spent);
    for (const [index, foe] of foes.entries()) {
      if (claimed[index] || !(blind || foe.known) || !beats(attackers[next], foe, trade)) continue;
      claimed[index] = true;
      kills.push([next, index]);
      yield* walk(next + 1, damage + hit(attackers[next], foe), worth + foe.worth, spent + attackers[next].atk);
      kills.pop();
      claimed[index] = false;
    }
  }

  yield* walk(0, 0, 0, 0);
}

// An order of attacks that takes all the `lp` of the opponent, if there is one.
export function lethal(attackers: readonly Attacker[], foes: readonly Foe[], lp: number): Plan | undefined {
  for (const plan of plans(attackers, foes, true, true)) if (plan.damage >= lp) return plan;
  return undefined;
}

const gap = (a: Plan, b: Plan) => a.worth - b.worth || a.damage - b.damage || b.spent - a.spent;

// The plan that destroys the most (then hits hardest, then spends the weakest attackers) without losing an attacker.
export function safest(attackers: readonly Attacker[], foes: readonly Foe[], blind: boolean): Plan | undefined {
  let best: Plan | undefined;
  for (const plan of plans(attackers, foes, false, blind)) {
    if (plan.kills.length === 0) continue;
    if (!best || gap(plan, best) > 0) best = plan;
  }
  return best;
}

// The attack to declare now: the most valuable kill first, then the direct attackers. `null` foe: a direct attack.
export function firstStep(plan: Plan, foes: readonly Foe[]): [attacker: number, foe: number | null] | undefined {
  const [kill] = [...plan.kills].sort(([, a], [, b]) => foes[b].worth - foes[a].worth);
  if (kill) return kill;
  return plan.direct.length > 0 ? [plan.direct[0], null] : undefined;
}
