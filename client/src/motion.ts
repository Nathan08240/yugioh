// 2D motion with the Web Animations API, no library (design/motion.md): a queue of sequences played one at a time,
// skipped by a click, Escape or Space, twice as fast when more than 3 wait, a fade alone when motion is reduced.

// Durations (ms) and easings of tokens.css.
export const D1 = 120;
export const D2 = 220;
export const D3 = 420;
export const D4 = 900;
export const FONDU = 150;
export const SORTIE = "cubic-bezier(0.16, 1, 0.3, 1)";
export const RESSORT = "cubic-bezier(0.34, 1.56, 0.64, 1)";
export const ELAN = "cubic-bezier(0.5, 0, 0.75, 0)";

export type AnimOptions = { duration?: number; delay?: number; easing?: string; fill?: FillMode };
export type Step = {
  // Plays keyframes on `el`; with reduced motion the end state applies at once, only an opacity fade remains.
  anim: (el: Element, keyframes: Keyframe[], options?: AnimOptions) => Promise<void>;
  // A wait; `reading` keeps it with reduced motion (time left to read).
  pause: (ms: number, reading?: boolean) => Promise<void>;
  // Calls `update` each frame with the progress k (0 to 1), for what the Web Animations API cannot reach (3D, counters).
  // With reduced motion it jumps to 1, unless `fade` keeps it as a fade of 150 ms.
  tween: (duration: number, update: (k: number) => void, fade?: boolean) => Promise<void>;
  // Reduced motion: no decoration (sweeps, rays, flashes).
  reduced: boolean;
};
export type Sequence = (step: Step) => Promise<void>;
export type Queue = {
  // Queues a sequence; the promise resolves once it is played (or skipped).
  play: (sequence: Sequence) => Promise<void>;
  // Ends the sequence being played: its animations finish, its waits stop.
  skip: () => void;
  readonly busy: boolean;
  readonly waiting: number;
};

export const prefersReduced = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const BACKLOG = 3;
type Run = { fast: boolean; anims: Set<Animation>; wakers: Set<() => void> };

export function createQueue(reduced: () => boolean = prefersReduced): Queue {
  let tail = Promise.resolve();
  let waiting = 0;
  let current: Run | undefined;
  const rate = () => (waiting > BACKLOG ? 2 : 1);

  function step(run: Run): Step {
    const start = (el: Element, keyframes: Keyframe[], { duration = D3, delay = 0, easing = SORTIE, fill = "both" }: AnimOptions) => {
      const speed = run.fast ? Infinity : rate();
      const animation = el.animate(keyframes, { duration: duration / speed, delay: delay / speed, easing, fill });
      run.anims.add(animation);
      return animation.finished.then(
        () => {},
        () => {},
      );
    };
    const isReduced = reduced();
    return {
      reduced: isReduced,
      anim(el, keyframes, options = {}) {
        if (!isReduced) return start(el, keyframes, options);
        const end = start(el, keyframes, { ...options, duration: 0, delay: 0 });
        const opacity = keyframes.map((frame) => frame.opacity).filter((value) => value !== undefined);
        if (run.fast || opacity.length < 2 || opacity[0] === opacity.at(-1)) return end;
        return start(el, [{ opacity: opacity[0] }, { opacity: opacity.at(-1) }], { duration: FONDU, fill: options.fill });
      },
      pause(ms, reading = false) {
        if (run.fast || (isReduced && !reading)) return Promise.resolve();
        return new Promise((resolve) => {
          const wake = () => {
            clearTimeout(timer);
            run.wakers.delete(wake);
            resolve();
          };
          const timer = setTimeout(wake, ms / rate());
          run.wakers.add(wake);
        });
      },
      tween(duration, update, fade = false) {
        const length = isReduced ? Number(fade) * FONDU : duration;
        if (run.fast || length <= 0) {
          update(1);
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          let elapsed = 0;
          let last: number | undefined;
          let frame = 0;
          const end = () => {
            cancelAnimationFrame(frame);
            run.wakers.delete(end);
            update(1);
            resolve();
          };
          const tick = (now: number) => {
            elapsed += (now - (last ?? now)) * rate();
            last = now;
            if (elapsed >= length) {
              end();
              return;
            }
            update(elapsed / length);
            frame = requestAnimationFrame(tick);
          };
          run.wakers.add(end);
          frame = requestAnimationFrame(tick);
        });
      },
    };
  }

  return {
    play(sequence) {
      waiting++;
      if (waiting > BACKLOG) for (const animation of current?.anims ?? []) animation.updatePlaybackRate(2);
      tail = tail.then(async () => {
        waiting--;
        const run: Run = { fast: false, anims: new Set(), wakers: new Set() };
        current = run;
        try {
          await sequence(step(run));
        } catch (error) {
          console.error(error);
        } finally {
          current = undefined;
        }
      });
      return tail;
    },
    skip() {
      if (!current) return;
      current.fast = true;
      for (const animation of current.anims) animation.finish();
      for (const wake of [...current.wakers]) wake();
    },
    get busy() {
      return current !== undefined;
    },
    get waiting() {
      return waiting;
    },
  };
}

// Shared queue: duel messages, end of the duel. Screen transitions have their own (Shell.tsx).
export const sequences = createQueue();

const SKIP_KEYS: ReadonlySet<string> = new Set(["Escape", " "]);
const TYPING: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// A click, Escape or Space skips the sequence being played. Returns the removal of the listeners.
export function bindSkip(queue: Queue, target: EventTarget = globalThis): () => void {
  const onKey = (event: Event) => {
    const { key, target: from } = event as KeyboardEvent;
    if (!queue.busy || !SKIP_KEYS.has(key)) return;
    if (key === " " && TYPING.has((from as HTMLElement | null)?.tagName ?? "")) return;
    event.preventDefault();
    queue.skip();
  };
  const onPointer = () => {
    if (queue.busy) queue.skip();
  };
  target.addEventListener("keydown", onKey);
  target.addEventListener("pointerdown", onPointer);
  return () => {
    target.removeEventListener("keydown", onKey);
    target.removeEventListener("pointerdown", onPointer);
  };
}

const MONTEE: Keyframe[] = [
  { opacity: 0, translate: "0 18px" },
  { opacity: 1, translate: "0 0" },
];

// Screen entrance: the [data-entree] blocks (else the whole screen) rise in cascade, the cyan sweep goes down.
export const entrance =
  (el: HTMLElement, sweep?: HTMLElement | null): Sequence =>
  async ({ anim, reduced }) => {
    const found = [...el.querySelectorAll("[data-entree]")];
    const blocks = found.length > 0 ? found : [el];
    const steps = blocks.map((block, i) => anim(block, MONTEE, { delay: i * 60, fill: "backwards" }));
    if (sweep && !reduced) {
      const height = sweep.parentElement?.clientHeight ?? 0;
      steps.push(anim(sweep, [{ opacity: 1, translate: "0 0" }, { opacity: 0.2, translate: `0 ${height}px` }], { fill: "backwards" }));
    }
    await Promise.all(steps);
  };

// Screen exit: the screen fades, shrinks and blurs, and stays hidden until it is replaced.
export const exit =
  (el: Element): Sequence =>
  ({ anim }) =>
    anim(
      el,
      [
        { opacity: 1, scale: "1", filter: "blur(0)" },
        { opacity: 0, scale: "0.98", filter: "blur(4px)" },
      ],
      { duration: D2, easing: ELAN },
    );
