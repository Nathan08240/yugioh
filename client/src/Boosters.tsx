import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { ClientMessage } from "../../server/src/protocol.ts";
import { openPack, place, revealCard, STRONG, type Scene, type Shown } from "./boosterMotion.ts";
import { isDone, revealAll, revealOrder, settle, startReveal, touch, type RevealState } from "./boosterReveal.ts";
import { CardView } from "./Card.tsx";
import { rarityKey, rarityLabel } from "./cards.ts";
import { countdown, type LobbyState } from "./lobby.ts";
import { createQueue, type Step } from "./motion.ts";
import type { Page } from "./Shell.tsx";
import "./styles/boosters.css";
import { Icon, Rarity } from "./ui.tsx";

type Send = (msg: ClientMessage) => void;
type BoosterSet = { code: string; name: string; date: string };
type Opened = NonNullable<LobbyState["opened"]>;

// Server FREE_BOOSTER_HOURS (server/src/boosters.ts), for the ring of the countdown.
const FREE_EVERY_MS = 12 * 3600_000;
// Artwork in the window of each pack and hue of its foil: a flagship card of the set.
const PACKS = new Map<string, [number, number]>([
  ["LOB", [89631139, 222]],
  ["MRD", [70781052, 280]],
  ["MRL", [64631466, 160]],
  ["PSV", [77585513, 200]],
  ["LON", [69140098, 330]],
  ["LOD", [3078576, 250]],
  ["PGD", [40659562, 40]],
  ["MFC", [38033121, 300]],
  ["DCR", [53839837, 350]],
  ["IOC", [82301904, 265]],
  ["AST", [30190809, 185]],
  ["SOD", [48229808, 20]],
  ["RDS", [61505339, 50]],
  ["FET", [61441708, 12]],
]);
const year = (set: BoosterSet) => set.date.slice(0, 4);

// A pack drawn by us: metallic foil, sealed strips, hexagonal window. Spans only, so it can sit in a button.
function Pack({ set, className = "", ref }: Readonly<{ set: BoosterSet; className?: string; ref?: Ref<HTMLSpanElement> }>) {
  const [art, hue] = PACKS.get(set.code) ?? [0, 222];
  return (
    <span ref={ref} className={`paquet ${className}`} style={{ "--teinte": hue } as CSSProperties}>
      <span className="paquet__bande" />
      <span className="dechirure" />
      <span className="paquet__code">{set.code}</span>
      <span className="paquet__fenetre">
        {art > 0 && (
          <img
            src={`/api/art/${art}.jpg`}
            alt=""
            draggable={false}
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        )}
      </span>
      <span className="paquet__nom">{set.name}</span>
      <span className="paquet__annee chiffres">{year(set)}</span>
    </span>
  );
}

// Boosters screen: free-booster countdown, earned boosters, choice of the set, then the opening.
export function Boosters({ state, send, go }: Readonly<{ state: LobbyState; send: Send; go: (page: Page) => void }>) {
  const [sets, setSets] = useState<BoosterSet[]>([]);
  const [selected, setSelected] = useState(0);
  const [now, setNow] = useState(Date.now());
  // Openings seen before this visit do not play again.
  const [dismissedCount, setDismissedCount] = useState(state.openedCount);

  // On entering, and after each opening: the booster counts and the collection, which marks the new cards.
  useEffect(() => {
    send({ type: "booster_state" });
    send({ type: "collection" });
  }, [state.openedCount]);

  useEffect(() => {
    fetch("/api/boosters")
      .then((res) => res.json())
      .then((data: BoosterSet[]) => setSets(data))
      .catch((error: unknown) => console.error(error));
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const boosters = state.boosters;
  const remainingMs = boosters ? Math.max(0, new Date(boosters.nextFreeAt).getTime() - now) : FREE_EVERY_MS;
  const free = Boolean(boosters) && remainingMs === 0;
  const available = (boosters?.pending ?? 0) + (free ? 1 : 0);
  const set = sets[selected];
  const open = (code: string) => send({ type: "open_booster", set: code });
  const opening = state.opened && state.openedCount > dismissedCount ? state.opened : undefined;

  if (opening) {
    return (
      <BoosterOpening
        key={state.openedCount}
        opened={opening}
        set={sets.find((candidate) => candidate.code === opening.set) ?? { code: opening.set, name: opening.set, date: "" }}
        owned={state.collection}
        left={available}
        next={() => open(opening.set)}
        collection={() => go("collection")}
        close={() => setDismissedCount(state.openedCount)}
      />
    );
  }

  // The neighbours wrap around: the first set sits between the last one and the second.
  const side = (offset: number) => {
    const index = (selected + offset + sets.length) % sets.length;
    const neighbour = sets[index];
    return (
      <button type="button" className="carrousel__cote" aria-label={`Choisir ${neighbour.name}`} onClick={() => setSelected(index)}>
        <Pack set={neighbour} className="paquet--cote" />
      </button>
    );
  };

  return (
    <div className="boutique">
      <aside className="boutique__statut">
        <div className="panneau compteur" data-entree>
          <div className="anneau" style={{ "--v": `${(1 - remainingMs / FREE_EVERY_MS) * 100}%` } as CSSProperties}>
            <span className="chiffres">{boosters ? countdown(boosters.nextFreeAt, now) || "Prêt" : "…"}</span>
          </div>
          <p>
            <b>Booster gratuit</b>
            <span className="texte-2">{free ? "Disponible maintenant." : "Un booster offert toutes les 12 heures."}</span>
          </p>
        </div>
        <div className="panneau compteur" data-entree>
          <span className="compteur__grand chiffres">{boosters?.pending ?? "…"}</span>
          <p>
            <b>Boosters gagnés</b>
            <span className="texte-2">Victoires en ligne et mode Histoire.</span>
          </p>
        </div>
      </aside>

      <div className="carrousel" data-entree>
        {set && (
          <>
            {side(-1)}
            <Pack set={set} className="paquet--choisi" />
            {side(1)}
          </>
        )}
        <div className="carrousel__action">
          <button type="button" className="btn btn--grand" disabled={!set || available === 0} onClick={() => set && open(set.code)}>
            <Icon id="ui-booster" />
            Ouvrir le booster
          </button>
          {boosters && available === 0 && <p className="texte-2">Aucun booster à ouvrir pour l'instant : revenez quand le prochain gratuit est prêt.</p>}
          {available > 1 && <p className="texte-2">{available} boosters à ouvrir.</p>}
        </div>
      </div>

      {set && (
        <aside className="panneau boutique__contenu" data-entree>
          <h2 className="titre-bloc">{set.name}</h2>
          <p className="texte-2">
            <span className="chiffres">{set.code}</span> · paru en <span className="chiffres">{year(set)}</span>
          </p>
          <p className="texte-2">9 cartes : 7 communes, 1 rare et 1 carte brillante, révélées de la moins rare à la plus rare.</p>
          <h3 className="titre-bloc titre-bloc--petit">Carte phare</h3>
          <div className="phares">
            <CardView code={PACKS.get(set.code)?.[0] ?? 0} />
          </div>
        </aside>
      )}

      <ol className="series" aria-label="Séries de boosters" data-entree>
        {sets.map((candidate, index) => (
          <li key={candidate.code}>
            <button type="button" aria-pressed={index === selected} aria-label={candidate.name} title={candidate.name} onClick={() => setSelected(index)}>
              <b>{candidate.code}</b>
              <span className="chiffres">{year(candidate)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

const LEGEND: [string, string][] = [
  ["common", "retournement sec"],
  ["rare", "éclat argenté"],
  ["super", "balayage holo cyan"],
  ["ultra", "rayons d'or"],
  ["ultimate", "relief, lente bascule"],
  ["secret", "éclatement prismatique"],
];

// Indexes (in reveal order) of the cards the player did not own before this booster, each passcode once.
function freshCards(cards: readonly { code: number }[], owned?: [number, number][]): ReadonlySet<number> {
  const fresh = new Set<number>();
  if (!owned) return fresh;
  const seen = new Set(owned.map(([code]) => code));
  for (const [index, { code }] of cards.entries()) {
    if (seen.has(code)) continue;
    seen.add(code);
    fresh.add(index);
  }
  return fresh;
}

type OpeningProps = {
  opened: Opened;
  set: BoosterSet;
  // The collection before this booster.
  owned?: [number, number][];
  // Boosters left to open.
  left: number;
  next: () => void;
  collection: () => void;
  close: () => void;
};
type Refs = {
  layer: RefObject<HTMLDivElement | null>;
  rays: RefObject<HTMLDivElement | null>;
  veil: RefObject<HTMLDivElement | null>;
  outer: RefObject<HTMLDivElement | null>;
  flip: RefObject<HTMLDivElement | null>;
  label: RefObject<HTMLParagraphElement | null>;
  badge: RefObject<HTMLParagraphElement | null>;
};

function sceneOf({ layer, rays, veil }: Refs): Scene | undefined {
  if (!layer.current || !rays.current || !veil.current) return undefined;
  return { layer: layer.current, rays: rays.current, veil: veil.current };
}

function shownOf({ outer, flip, label, badge }: Refs): Shown | undefined {
  if (!outer.current || !flip.current || !label.current) return undefined;
  return { outer: outer.current, flip: flip.current, label: label.current, badge: badge.current };
}

// The card shown before flies to its slot of the row, then the new one is revealed.
async function revealNext(step: Step, refs: Refs, rarity: string, slot?: Element, from?: DOMRect) {
  if (slot && from) await place(step, slot, from);
  const scene = sceneOf(refs);
  const card = shownOf(refs);
  if (scene && card) await revealCard(step, scene, card, rarity);
}

// The pack tears open, then one card per touch from the least to the most rare; a touch during an animation skips it.
function BoosterOpening({ opened, set, owned, left, next, collection, close }: Readonly<OpeningProps>) {
  const order = useMemo(() => revealOrder(opened.cards), [opened]);
  const [fresh] = useState(() => freshCards(order, owned));
  const [reveal, setReveal] = useState<RevealState>(() => startReveal(order.length));
  const queue = useMemo(() => createQueue(), []);
  const started = useRef(false);
  const pack = useRef<HTMLSpanElement>(null);
  const pile = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLOListElement>(null);
  const toucher = useRef<HTMLButtonElement>(null);
  const refs: Refs = {
    layer: useRef<HTMLDivElement>(null),
    rays: useRef<HTMLDivElement>(null),
    veil: useRef<HTMLDivElement>(null),
    outer: useRef<HTMLDivElement>(null),
    flip: useRef<HTMLDivElement>(null),
    label: useRef<HTMLParagraphElement>(null),
    badge: useRef<HTMLParagraphElement>(null),
  };

  useLayoutEffect(() => {
    if (started.current) return;
    started.current = true;
    const scene = sceneOf(refs);
    const [packEl, pileEl] = [pack.current, pile.current];
    if (!packEl || !pileEl || !scene) return;
    queue.play((step) => openPack(step, scene, packEl, pileEl)).then(() => setReveal((state) => settle(state, 0)));
  }, []);

  // Focus on the pile: Enter or Space reveals the next card.
  useEffect(() => toucher.current?.focus(), []);

  const skip = () => {
    queue.skip();
    setReveal(touch);
  };

  // Escape skips the animation playing, as a touch does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && queue.busy) skip();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [queue]);

  // The next card comes off the pile; the one shown before flies to its place in the row.
  const onTouch = () => {
    if (reveal.playing || reveal.revealed >= reveal.total) {
      skip();
      return;
    }
    const from = refs.outer.current?.getBoundingClientRect();
    const after = touch(reveal);
    flushSync(() => setReveal(after));
    const slot = row.current?.children[after.revealed - 2];
    const rarity = rarityKey(order[after.revealed - 1].rarity);
    queue.play((step) => revealNext(step, refs, rarity, slot, from)).then(() => setReveal((state) => settle(state, after.revealed)));
  };

  const showAll = () => {
    queue.skip();
    setReveal(revealAll);
  };

  const done = isDone(reveal);
  const index = reveal.revealed - 1;
  const shown = index >= 0 ? order[index] : undefined;
  const key = rarityKey(shown?.rarity ?? "");
  const hidden = reveal.playing ? " est-cachee" : "";
  const rays = ["ouverture__rayons", !reveal.playing && STRONG.has(key) && "est-visible", key === "secret" && "ouverture__rayons--prisme"].filter(Boolean).join(" ");

  return (
    <div className="ouverture ecran--scene" role="dialog" aria-modal="true" aria-label={`Ouverture du booster ${set.name}`}>
      <div ref={refs.rays} className={rays} aria-hidden="true" />
      <div ref={refs.veil} className="ouverture__voile" aria-hidden="true" />
      <div className="ouverture__tete">
        <p className="surtitre">{set.name}</p>
        <p className="chiffres ouverture__compte">
          {reveal.revealed} / {reveal.total}
        </p>
      </div>

      <div className="ouverture__scene">
        <div ref={pile} className="ouverture__pile">
          {order.slice(reveal.revealed).map((card, i, rest) => (
            <div key={`${card.code}-${card.rarity}`} className="carte dos" style={{ "--i": rest.length - 1 - i } as CSSProperties} />
          ))}
        </div>
        {reveal.revealed === 0 && reveal.playing && <Pack set={set} className="ouverture__paquet" ref={pack} />}
        {shown && (
          <div key={index} ref={refs.outer} className="vedette">
            <div ref={refs.flip} className={`vedette__carte${hidden}`} data-r={key}>
              <CardView code={shown.code} rarity={shown.rarity} />
              <div className="carte dos vedette__dos" />
            </div>
          </div>
        )}
        {!done && <button type="button" className="ouverture__toucher" aria-label={reveal.playing ? "Passer l'animation" : "Révéler la carte suivante"} onClick={onTouch} ref={toucher} />}
      </div>

      <div className="revelation" aria-live="polite">
        {shown ? (
          <>
            <p key={`r${index}`} ref={refs.label} className={`revelation__rarete${hidden}`} data-r={key}>
              {rarityLabel(shown.rarity)}
            </p>
            {fresh.has(index) && (
              <p key={`n${index}`} ref={refs.badge} className={`puce puce--or${hidden}`}>
                Nouvelle carte
              </p>
            )}
          </>
        ) : (
          <p className="ouverture__aide">{reveal.playing ? "" : "Touchez la pile pour révéler la première carte."}</p>
        )}
      </div>

      <Row ref={row} cards={order.slice(0, -1)} placed={Math.max(0, index)} fresh={fresh} />

      <div className="ouverture__actions">
        {done ? (
          <Recap total={order.length} fresh={owned ? fresh.size : undefined} left={left} next={next} collection={collection} close={close} />
        ) : (
          <button type="button" className="btn btn--fantome" onClick={showAll}>
            Tout révéler
          </button>
        )}
      </div>

      <aside className="legende-raretes" aria-label="Révélation selon la rareté">
        <p className="surtitre">Révélation selon la rareté</p>
        <ol>
          {LEGEND.map(([rarity, text]) => (
            <li key={rarity}>
              <Rarity rarity={rarity} />
              {text}
            </li>
          ))}
        </ol>
      </aside>
      <div ref={refs.layer} className="ouverture__couche" aria-hidden="true" />
    </div>
  );
}

type RowProps = { cards: Opened["cards"]; placed: number; fresh: ReadonlySet<number>; ref: Ref<HTMLOListElement> };

// The row under the pile: the `placed` first cards in their slot, empty frames for the others.
function Row({ cards, placed, fresh, ref }: Readonly<RowProps>) {
  return (
    <ol ref={ref} className="tirage" aria-label="Cartes du booster">
      {cards.map((card, i) => {
        if (i >= placed) return <li key={`${card.code}-${card.rarity}`} className="tirage__vide" />;
        return (
          <li key={`${card.code}-${card.rarity}`}>
            <CardView code={card.code} rarity={card.rarity} />
            {fresh.has(i) && <span className="nouveau">Nouveau</span>}
            {rarityKey(card.rarity) !== "commune" && <Rarity rarity={card.rarity} />}
          </li>
        );
      })}
    </ol>
  );
}

type RecapProps = { total: number; fresh?: number; left: number; next: () => void; collection: () => void; close: () => void };

// Summary once every card is revealed: what joined the collection, and where to go next.
function Recap({ total, fresh, left, next, collection, close }: Readonly<RecapProps>) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  let summary = `${total} cartes ajoutées à votre collection`;
  if (fresh === 1) summary += ", dont 1 nouvelle";
  else if (fresh) summary += `, dont ${fresh} nouvelles`;
  return (
    <>
      <p className="ouverture__bilan" role="status">
        {summary}.
      </p>
      {left > 0 && (
        <button type="button" className="btn btn--grand" onClick={next} ref={first}>
          Ouvrir le suivant ({left} {left > 1 ? "restants" : "restant"})
        </button>
      )}
      <button type="button" className="btn btn--fantome" onClick={collection}>
        Voir la collection
      </button>
      <button type="button" className="btn btn--fantome" onClick={close} ref={left > 0 ? undefined : first}>
        Retour aux boosters
      </button>
    </>
  );
}
