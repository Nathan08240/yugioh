import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bindSkip, createQueue, FONDU, phase, type Sequence } from "./motion.ts";

// Stand-in for Element.animate: an animation that finishes after its delay and duration, or on finish().
type Played = { keyframes: Keyframe[]; options: KeyframeAnimationOptions; rate: number; done: boolean };
function element() {
  const played: Played[] = [];
  const el = {
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const entry: Played = { keyframes, options, rate: 1, done: false };
      played.push(entry);
      let finish = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = () => {
          entry.done = true;
          resolve();
        };
      });
      setTimeout(finish, Number(options.delay) + Number(options.duration));
      return { finished, finish, updatePlaybackRate: (rate: number) => (entry.rate = rate) };
    },
  };
  return { el: el as unknown as Element, played };
}

const rise: Keyframe[] = [
  { opacity: 0, translate: "0 18px" },
  { opacity: 1, translate: "0 0" },
];
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("joue les séquences une à une, dans l'ordre", async () => {
  const queue = createQueue(() => false);
  const { el, played } = element();
  const order: string[] = [];
  const seq =
    (name: string): Sequence =>
    async ({ anim }) => {
      order.push(`${name} début`);
      await anim(el, rise, { duration: 420 });
      order.push(`${name} fin`);
    };
  const both = Promise.all([queue.play(seq("a")), queue.play(seq("b"))]);
  await flush();
  expect(order).toEqual(["a début"]);
  expect(queue.busy).toBe(true);
  await vi.advanceTimersByTimeAsync(420);
  expect(order).toEqual(["a début", "a fin", "b début"]);
  await vi.advanceTimersByTimeAsync(420);
  await both;
  expect(order).toEqual(["a début", "a fin", "b début", "b fin"]);
  expect(played.map((entry) => entry.options.duration)).toEqual([420, 420]);
  expect(queue.busy).toBe(false);
});

it("passer termine la séquence en cours : animations finies, pauses coupées, la suite à vitesse normale", async () => {
  const queue = createQueue(() => false);
  const { el, played } = element();
  const first = queue.play(async ({ anim, pause }) => {
    await anim(el, rise, { duration: 900 });
    await pause(2000);
    await anim(el, rise, { duration: 420 });
  });
  const second = queue.play(({ anim }) => anim(el, rise, { duration: 420 }));
  await flush();
  queue.skip();
  await flush();
  await first;
  expect(played.slice(0, 2).map((entry) => [entry.options.duration, entry.done])).toEqual([
    [900, true],
    [0, true],
  ]);
  expect(played[2].options.duration).toBe(420);
  await vi.runAllTimersAsync();
  await second;
});

it("double la vitesse quand plus de 3 séquences attendent", async () => {
  const queue = createQueue(() => false);
  const { el, played } = element();
  const seq: Sequence = async ({ anim, pause }) => {
    await anim(el, rise, { duration: 420, delay: 60 });
    await pause(400);
  };
  const all = [1, 2, 3, 4, 5].map(() => queue.play(seq));
  await flush();
  expect(queue.waiting).toBe(4);
  expect(played[0].options).toMatchObject({ duration: 210, delay: 30 });
  await vi.advanceTimersByTimeAsync(240 + 200);
  // Second sequence: 3 left waiting, back to normal speed.
  expect(queue.waiting).toBe(3);
  expect(played[1].options).toMatchObject({ duration: 420, delay: 60 });
  // A backlog building up speeds up the animations already running.
  queue.play(seq);
  expect(played[1].rate).toBe(2);
  await vi.runAllTimersAsync();
  await Promise.all(all);
});

it("en réduction, applique l'état final d'un coup et ne garde qu'un fondu de 150 ms et les temps de lecture", async () => {
  const queue = createQueue(() => true);
  const { el, played } = element();
  let waited = 0;
  const done = queue.play(async ({ anim, pause, reduced }) => {
    expect(reduced).toBe(true);
    await anim(el, rise, { duration: 900, delay: 300 });
    await anim(el, [{ translate: "0 0" }, { translate: "0 -30px" }], { duration: 420 });
    const start = Date.now();
    await pause(700);
    await pause(500, true);
    waited = Date.now() - start;
  });
  await vi.runAllTimersAsync();
  await done;
  expect(played.map((entry) => [entry.keyframes, entry.options.duration, entry.options.delay])).toEqual([
    [rise, 0, 0],
    [[{ opacity: 0 }, { opacity: 1 }], FONDU, 0],
    [[{ translate: "0 0" }, { translate: "0 -30px" }], 0, 0],
  ]);
  expect(waited).toBe(500);
});

it("clic, Échap et Espace passent la séquence en cours, pas Espace dans un champ", async () => {
  const queue = createQueue(() => false);
  const { el } = element();
  const target = new EventTarget();
  const unbind = bindSkip(queue, target);
  const key = (name: string, tagName = "BODY") => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: name });
    Object.defineProperty(event, "target", { value: { tagName } });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const long: Sequence = ({ anim }) => anim(el, rise, { duration: 5000 });

  expect(key("Escape")).toBe(false);
  for (const skip of [() => key("Escape"), () => key(" "), () => target.dispatchEvent(new Event("pointerdown"))]) {
    const done = queue.play(long);
    await flush();
    expect(key(" ", "INPUT")).toBe(false);
    expect(queue.busy).toBe(true);
    skip();
    await done;
    expect(queue.busy).toBe(false);
  }
  unbind();
  const done = queue.play(long);
  await flush();
  expect(key("Escape")).toBe(false);
  await vi.runAllTimersAsync();
  await done;
});

it("fait progresser une interpolation image par image, la termine si on passe, la saute en réduction sauf un fondu", async () => {
  vi.stubGlobal("requestAnimationFrame", (tick: FrameRequestCallback) => setTimeout(() => tick(Date.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => clearTimeout(frame));
  const seen: number[] = [];
  const queue = createQueue(() => false);
  const done = queue.play(async ({ tween }) => {
    await tween(160, (k) => seen.push(k));
    await tween(5000, (k) => seen.push(k));
  });
  await vi.advanceTimersByTimeAsync(16 * 12);
  expect(seen.slice(0, 11)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((k) => expect.closeTo(k, 5)));
  queue.skip();
  await done;
  expect(seen.at(-1)).toBe(1);

  const reduced = createQueue(() => true);
  const faded: number[] = [];
  const jumped: number[] = [];
  const both = reduced.play(async ({ tween }) => {
    await tween(900, (k) => jumped.push(k));
    await tween(900, (k) => faded.push(k), true);
  });
  await vi.advanceTimersByTimeAsync(FONDU + 32);
  await both;
  expect(jumped).toEqual([1]);
  expect(faded.length).toBeGreaterThan(5);
  expect(faded.at(-1)).toBe(1);
  vi.unstubAllGlobals();
});

it("découpe une interpolation en temps successifs ou décalés", () => {
  expect([0, 0.2, 0.5, 0.8, 1].map((k) => phase(k, 0.2, 0.8))).toEqual([0, 0, 0.5, 1, 1].map((k) => expect.closeTo(k, 9)));
  // Stagger of the third of five cards drawn: its flight starts at 2/8 and ends at 6/8 of the tween.
  expect(phase(0.25, 2 / 8, 6 / 8)).toBe(0);
  expect(phase(0.5, 2 / 8, 6 / 8)).toBe(0.5);
});

it("passer une chorégraphie en plusieurs temps (élan, arrêt sur image, retour) les mène tous à leur fin d'un coup", async () => {
  vi.stubGlobal("requestAnimationFrame", (tick: FrameRequestCallback) => setTimeout(() => tick(Date.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => clearTimeout(frame));
  const queue = createQueue(() => false);
  const fins: string[] = [];
  const done = queue.play(async ({ tween, pause }) => {
    await tween(260, (k) => k === 1 && fins.push("élan"));
    await tween(220, (k) => k === 1 && fins.push("charge"));
    await pause(90);
    fins.push("arrêt");
    await tween(420, (k) => k === 1 && fins.push("retour"));
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(fins).toEqual([]);
  queue.skip();
  await done;
  expect(fins).toEqual(["élan", "charge", "arrêt", "retour"]);
  vi.unstubAllGlobals();
});
