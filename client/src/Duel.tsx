import { OcgLocation, OcgPhase, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { flushSync } from "react-dom";
import { cardAt, playAll, type Board, type Card, type LogEntry, type Message } from "./board.ts";
import { Table, type Targets } from "./Board.tsx";
import { CardDetail, CardView } from "./Card.tsx";
import { cardName, DuelView, phaseName, useCards, useDuelView, useSystemStrings, type Cards } from "./cards.ts";
import type { Asked } from "./lobby.ts";
import { D1, D2, D3, D4, ELAN, RESSORT } from "./motion.ts";
import { cibles3D, zones } from "./plateau3d/disposition.ts";
import { etapes, type Effet } from "./plateau3d/effets.ts";
import { jouer, type Jeu, type Regie } from "./plateau3d/spectacle.ts";
import { interaction, type Choice, type Ui } from "./Question.tsx";
import { placeKey, pointDe, reponseVisee, type Appui, type Point } from "./question.ts";
import { RulesBadge, type Rule } from "./regles.tsx";
import "./styles/duel.css";
import { Icon } from "./ui.tsx";

// The 3D board and three.js are fetched when a duel starts (their own chunk).
const Plateau3D = lazy(() => import("./plateau3d/Plateau3D.tsx"));

type Feed = { id: number; messages: Message[] };
// Cards picked for the current question; `point` and `cible`: where the bubble of a picked card opens, the zone it was dropped on.
type Picks = { id?: number; keys: string[]; point?: Point; cible?: string };
type Sonde = RefObject<((x: number, y: number) => string | undefined) | null>;
type Props = {
  board: Board;
  seat: number;
  asked?: Asked;
  respond: (response: OcgResponse) => void;
  leave: () => void;
  feed?: Feed;
  lp?: number;
  pseudo?: string;
  opponent?: string;
  // Special rules of a story duel, opened from a badge.
  rules?: Rule[];
};

const { HAND, GRAVE, REMOVED } = OcgLocation;
const SANS_3D = "Votre navigateur n'affiche pas la 3D (WebGL 2 indisponible) : le duel se joue sur le plateau 2D.";
const PERDU = "Le processeur graphique s'est réinitialisé : le duel continue sur le plateau 2D.";

// three.js needs WebGL 2 (r163+): without it, the 2D board.
export function webgl2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

// The board shown catches up with the real one message by message, as their animations play (design/motion.md).
function useSpectacle(board: Board, feed: Feed | undefined, cards: Cards, regie: Regie, waiting: boolean) {
  const [shown, setShown] = useState(board);
  const [playing, setPlaying] = useState(0);
  const seen = useRef(feed?.id ?? 0);
  const base = useRef(board);
  const attend = useRef(waiting);
  useLayoutEffect(() => {
    attend.current = waiting;
  }, [waiting]);
  // A layout effect: the steps are queued before the end of the duel (Fin.tsx) queues its own sequence.
  useLayoutEffect(() => {
    if (!feed || feed.id <= seen.current) return;
    seen.current = feed.id;
    const steps = etapes(base.current, feed.messages, cards);
    const fin = board;
    base.current = board;
    setPlaying((n) => n + 1);
    // flushSync: the scene and the HUD show the message before its animation starts.
    const appliquer = (messages: Message[]) => flushSync(() => setShown((before) => playAll(before, messages)));
    // The last step lands on the board of the server, whatever the animations did.
    jouer(steps, appliquer, regie, () => attend.current, () => flushSync(() => setShown(fin))).then(() => setPlaying((n) => n - 1));
  }, [feed, board, cards, regie]);
  return { shown, idle: playing === 0 };
}

// Card at a 3D zone: a card of the field, the top of a Graveyard or of the banished cards.
function zoneCard(board: Board, id: string): Card | undefined {
  const [controller, location, sequence] = id.split(":").map(Number);
  if (sequence !== undefined) return cardAt(board, { controller, location: location as OcgLocation, sequence });
  const side = board.players[controller];
  if (location === GRAVE) return side.grave.at(-1);
  if (location === REMOVED) return side.banished.at(-1);
  return undefined;
}

const codeAt = (board: Board, id: string) => zoneCard(board, id)?.code ?? 0;

// The end of the duel (Fin.tsx) is drawn over the board by the lobby.
export function Duel({ board, seat, asked, respond, leave, feed, lp, pseudo, opponent, rules }: Readonly<Props>) {
  const cards = useCards();
  const strings = useSystemStrings();
  const [detail, setDetail] = useState<{ code: number; place?: string }>();
  const view = useMemo(() => ({ cards, show: (code: number, place?: string) => setDetail({ code, place }), seat }), [cards, seat]);
  const regie = useRef<Regie>({}).current;
  const hud = useHud(regie, seat, cards);
  const { shown, idle } = useSpectacle(board, feed, cards, regie, asked !== undefined);
  const [mode, setMode] = useState<"3d" | "2d" | "perdu">(() => (webgl2() ? "3d" : "2d"));
  const [pile, setPile] = useState<string>();
  // A new question starts with nothing picked.
  const [picks, setPicks] = useState<Picks>(AUCUN);
  const courant = picks.id === asked?.id ? picks : AUCUN;
  const picked = courant.keys;
  const setPicked = (keys: string[], point?: Point, cible?: string) => setPicks({ id: asked?.id, keys, point, cible });
  const question = idle ? asked?.question : undefined;
  const ui = interaction(question, { board: shown, cards, strings, picked, cible: courant.cible, setPicked, respond });
  const visee = useVisee(asked, respond);
  const repondre = (response: OcgResponse, cible: string | undefined) => {
    if (cible) visee(cible);
    respond(response);
  };
  const sonde: Sonde = useRef(null);
  // What a card can be dropped on: zones of the 3D board, and the opponent's plate for a direct attack.
  const depots = (key: string) => [...zones(seat).map((zone) => zone.id), String(1 - seat)].filter((id) => (ui.deposer?.(key, id).length ?? 0) > 0);
  // One action goes at once; several open the bubble where the card was dropped.
  const deposer = (key: string, x: number, y: number) => {
    const cible = cibleSous(x, y, sonde);
    const choix = cible ? (ui.deposer?.(key, cible) ?? []) : [];
    if (choix.length === 1) repondre(choix[0].response, cible);
    else if (choix.length > 1) setPicked([key], { x, y }, cible);
  };
  const { glisse, fantome, glisser } = useGlisser(deposer);
  // No drag and drop on the 2D board.
  const appui = (key: string, code: number, event: Appui) => {
    if (mode === "3d" && depots(key).length > 0) glisser(key, code, event);
  };
  const enDepot = glisse ? depots(glisse.key) : undefined;
  const normales = useMemo(() => cibles3D(ui.targets), [ui.targets]);
  const cibles = enDepot ? new Set(enDepot) : normales;
  const choisies = useMemo(() => cibles3D(picked), [picked]);
  const cadre = useRef<HTMLDivElement>(null);
  const start = lp ?? Math.max(...board.players.map((side) => side.lp), 1);

  const onZone = (id: string, point: Point) => {
    const location = Number(id.split(":")[1]);
    if (location === GRAVE || location === REMOVED) setPile(id);
    else if (ui.targets.has(id)) ui.onPick?.(id, point);
    else if (codeAt(shown, id)) setDetail({ code: codeAt(shown, id), place: id });
  };
  const onSurvol = (id: string | undefined) => {
    const code = id ? codeAt(shown, id) : 0;
    if (code) setDetail({ code, place: id });
  };
  // Current stats of the shown card while it stays on the field, followed live.
  const enJeu = detail?.place ? zoneCard(shown, detail.place) : undefined;
  const stats = enJeu?.code === detail?.code ? enJeu : undefined;
  const targets: Targets = { ...ui, picked };

  return (
    <DuelView value={view}>
      <section className="ecran ecran--duel" aria-label="Plateau de duel">
        <h1 className="sr">Duel</h1>
        {mode === "3d" && cards.size > 0 && (
          <Suspense fallback={<p className="plateau-chargement surtitre">Chargement du plateau…</p>}>
            <Plateau3D
              board={shown}
              seat={seat}
              cards={cards}
              cibles={cibles}
              choisies={choisies}
              onZone={onZone}
              onSurvol={onSurvol}
              onAppui={(id, event) => appui(id, codeAt(shown, id), event)}
              sonde={sonde}
              regie={regie}
              cadre={cadre}
              onPerdu={() => setMode("perdu")}
            />
          </Suspense>
        )}
        <div ref={cadre} className="cadre-3d">
          {mode !== "3d" && (
            <div className="repli ancien">
              <p className="repli__message">{mode === "perdu" ? PERDU : SANS_3D}</p>
              <Table board={shown} seat={seat} ui={targets} />
            </div>
          )}
        </div>
        <div className="hud">
          <Plaque board={shown} player={1 - seat} start={start} name={opponent ?? "Adversaire"} refs={hud.refs} visee={enDepot?.includes(String(1 - seat))} />
          <section className="main-adverse" ref={hud.refs.mains[1 - seat]} aria-label={`Main de l'adversaire : ${cartes(shown.players[1 - seat].hand.length)}`}>
            {[...shown.players[1 - seat].hand.keys()].map((i) => (
              <CardView key={i} code={0} />
            ))}
          </section>
          <Turn board={shown} seat={seat} leave={leave} />
          <aside className="colonne colonne--gauche">
            <div className="panneau colonne__detail">
              <CardDetail code={detail?.code} atk={stats?.atk} def={stats?.def} />
            </div>
            <Plaque board={shown} player={seat} start={start} name={pseudo ?? "Vous"} refs={hud.refs} />
          </aside>
          <Hand hand={shown.players[seat].hand} seat={seat} ui={targets} main={hud.refs.mains[seat]} appui={appui} />
          <aside className="colonne colonne--droite">
            {rules?.length ? <RulesBadge rules={rules} /> : null}
            {shown.chain.length > 0 && <Chain chain={shown.chain} seat={seat} opponent={opponent} />}
            <Log log={shown.log} opponent={opponent} />
            <section className="panneau question" aria-live="polite">
              <p className="surtitre surtitre--or">{asked && idle ? "À vous de répondre" : "Duel en cours"}</p>
              {asked?.retry && idle && <p className="error">Choix refusé par le moteur : essayez autre chose.</p>}
              {idle || !asked ? ui.panel : <p className="muted">Action en cours…</p>}
            </section>
          </aside>
        </div>
        {pile && <PileList id={pile} board={shown} seat={seat} ui={ui} close={() => setPile(undefined)} />}
        {courant.point && ui.bulle && ui.bulle.length > 0 && (
          <Bulle
            key={`${picked[0]}|${courant.point.x}|${courant.point.y}`}
            point={courant.point}
            choix={ui.bulle}
            choisir={(choice) => repondre(choice.response, courant.cible)}
            fermer={() => setPicked([])}
          />
        )}
        {glisse && (
          <div ref={fantome} className="fantome" style={{ translate: `${glisse.x}px ${glisse.y}px` }} aria-hidden="true">
            <CardView code={glisse.code} />
          </div>
        )}
        <div className="bandeau" ref={hud.refs.bandeau} aria-hidden="true">
          <p />
        </div>
        <div className="bords" ref={hud.refs.bords} aria-hidden="true" />
        <div className="cinema" ref={hud.refs.cinema} aria-hidden="true">
          <span className="cinema__bande" />
          <p className="cinema__nom" />
          <span className="cinema__bande cinema__bande--bas" />
        </div>
      </section>
    </DuelView>
  );
}

const cartes = (n: number) => (n > 1 ? `${n} cartes` : `${n} carte`);
const AUCUN: Picks = { keys: [] };

// What lies under a point of the screen: the opponent's plate, or a zone of the 3D board.
function cibleSous(x: number, y: number, sonde: Sonde) {
  const sous = document.elementFromPoint(x, y);
  const plaque = sous?.closest<HTMLElement>("[data-cible]")?.dataset.cible;
  if (plaque) return plaque;
  return sous?.closest(".plateau-3d") ? sonde.current?.(x, y) : undefined;
}

// A drop remembers the zone or the monster it landed on, and answers the next questions that offer it (SELECT_PLACE, SELECT_CARD); any other question forgets it.
function useVisee(asked: Asked | undefined, respond: (response: OcgResponse) => void) {
  const visee = useRef<{ apres: number; cible: string }>(undefined);
  useEffect(() => {
    const intention = visee.current;
    if (!asked || !intention || asked.id === intention.apres) return;
    const response = asked.retry ? undefined : reponseVisee(asked.question, intention.cible);
    visee.current = response && { apres: asked.id, cible: intention.cible };
    if (response) respond(response);
  }, [asked, respond]);
  return (cible: string) => {
    if (asked) visee.current = { apres: asked.id, cible };
  };
}

const SEUIL = 8;

// Drag a card with the mouse or a finger: past a few pixels it follows the pointer, released it lands on what is under it.
function useGlisser(deposer: (key: string, x: number, y: number) => void) {
  const [glisse, setGlisse] = useState<{ key: string; code: number; x: number; y: number }>();
  const fantome = useRef<HTMLDivElement>(null);
  const dernier = useRef(deposer);
  useLayoutEffect(() => {
    dernier.current = deposer;
  });
  const glisser = (key: string, code: number, depart: Appui) => {
    if (depart.button !== 0) return;
    let parti = false;
    const suivre = (event: PointerEvent) => {
      if (event.pointerId !== depart.pointerId) return;
      if (!parti && Math.hypot(event.clientX - depart.clientX, event.clientY - depart.clientY) < SEUIL) return;
      if (!parti) setGlisse({ key, code, x: event.clientX, y: event.clientY });
      parti = true;
      fantome.current?.style.setProperty("translate", `${event.clientX}px ${event.clientY}px`);
    };
    const lacher = (event: PointerEvent) => {
      if (event.pointerId !== depart.pointerId) return;
      document.removeEventListener("pointermove", suivre);
      document.removeEventListener("pointerup", lacher);
      document.removeEventListener("pointercancel", lacher);
      if (!parti) return;
      setGlisse(undefined);
      // The click that ends a drag is not a click on what lies under it.
      const avaler = (click: Event) => click.stopPropagation();
      document.addEventListener("click", avaler, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", avaler, true));
      if (event.type === "pointerup") dernier.current(key, event.clientX, event.clientY);
    };
    document.addEventListener("pointermove", suivre);
    document.addEventListener("pointerup", lacher);
    document.addEventListener("pointercancel", lacher);
  };
  return { glisse, fantome, glisser };
}

// The actions of the picked card, in a bubble beside it: the first one takes the focus, Escape or a press elsewhere closes it.
function Bulle({ point, choix, choisir, fermer }: Readonly<{ point: Point; choix: Choice[]; choisir: (choice: Choice) => void; fermer: () => void }>) {
  const { cards } = useDuelView();
  const bulle = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const el = bulle.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const haut = point.y - r.height - 12;
    el.style.left = `${Math.min(Math.max(point.x - r.width / 2, 8), innerWidth - r.width - 8)}px`;
    el.style.top = `${haut < 8 ? point.y + 12 : haut}px`;
    const avant = document.activeElement;
    el.querySelector("button")?.focus({ preventScroll: true });
    return () => {
      if (avant instanceof HTMLElement) avant.focus({ preventScroll: true });
    };
  }, [point]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") fermer();
    };
    const onDown = (event: PointerEvent) => {
      if (!bulle.current?.contains(event.target as Node)) fermer();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [fermer]);
  return (
    <dialog open ref={bulle} className="panneau bulle" aria-label={`Actions : ${cardName(cards, choix[0].place.code)}`}>
      {choix.map((choice) => (
        <button key={choice.id} type="button" className="btn" onClick={() => choisir(choice)}>
          {choice.label}
        </button>
      ))}
    </dialog>
  );
}

// HUD ---------------------------------------------------------------------------------------

type Refs = {
  valeurs: RefObject<HTMLSpanElement | null>[];
  deltas: RefObject<HTMLSpanElement | null>[];
  plaques: RefObject<HTMLDivElement | null>[];
  mains: RefObject<HTMLElement | null>[];
  bandeau: RefObject<HTMLDivElement | null>;
  bords: RefObject<HTMLDivElement | null>;
  cinema: RefObject<HTMLDivElement | null>;
};

const sortie = (k: number) => 1 - (1 - k) ** 4;
const BANDEAUX: ReadonlySet<number> = new Set([OcgPhase.MAIN1, OcgPhase.BATTLE_START, OcgPhase.MAIN2, OcgPhase.END]);

async function pioche(jeu: Jeu, main: HTMLElement | null, nombre: number, dy: number) {
  const cartes = [...(main?.children ?? [])].slice(-nombre);
  const arrivee: Keyframe[] = [
    { opacity: 0, translate: `0 ${dy}px`, scale: "0.7" },
    { opacity: 1, translate: "0 0", scale: "1" },
  ];
  await Promise.all(cartes.map((carte, i) => jeu.anim(carte, arrivee, { delay: i * 60, easing: RESSORT, fill: "backwards" })));
}

// LP roll down (or up), the -X badge pops, the plate glows; a direct attack reddens the edges of the screen.
async function pointsDeVie(jeu: Jeu, refs: Refs, effet: Extract<Effet, { type: "lp" }>) {
  const valeur = refs.valeurs[effet.joueur].current;
  const delta = refs.deltas[effet.joueur].current;
  const plaque = refs.plaques[effet.joueur].current;
  if (!valeur || !delta || !plaque) return;
  const to = Math.max(Number(valeur.dataset.lp), 0);
  const from = Math.max(Number(valeur.dataset.lp) - effet.delta, 0);
  delta.textContent = effet.delta < 0 ? `−${-effet.delta}` : `+${effet.delta}`;
  delta.classList.toggle("lp__delta--gain", effet.delta > 0);
  const bords = refs.bords.current;
  await Promise.all([
    jeu.anim(delta, [{ opacity: 0, scale: "0.6" }, { opacity: 1, scale: "1" }], { duration: D2, easing: RESSORT }),
    effet.delta < 0 && jeu.anim(plaque, [{ filter: "drop-shadow(0 0 16px rgb(255 77 109 / 0.9))" }, { filter: "drop-shadow(0 0 0 transparent)" }], { duration: D4 }),
    effet.directe && bords && jeu.anim(bords, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }], { duration: D1 + D4, easing: "linear" }),
    effet.directe && jeu.anim(plaque, [{ translate: "0 0" }, { translate: "-6px 0" }, { translate: "6px 0" }, { translate: "0 0" }], { duration: D2, easing: "linear" }),
    jeu.tween(D4, (k) => {
      valeur.textContent = String(Math.round(from + (to - from) * sortie(k)));
    }),
  ]);
  await jeu.tenir(500);
  await jeu.anim(delta, [{ opacity: 1 }, { opacity: 0 }], { duration: D4 });
}

// Phase and turn banner: opens from the middle, the title tightens, holds, leaves to the left.
async function bandeau(jeu: Jeu, el: HTMLDivElement | null, texte: string, camp: string) {
  const titre = el?.querySelector("p");
  if (!el || !titre) return;
  titre.textContent = texte;
  el.dataset.camp = camp;
  await Promise.all([
    jeu.anim(el, [{ opacity: 0, transform: "scaleX(0.2)" }, { opacity: 1, transform: "none" }], { duration: D2 }),
    jeu.anim(titre, [{ letterSpacing: "0.5em" }, { letterSpacing: "0.12em" }], { duration: D3 }),
  ]);
  await jeu.tenir(700);
  await jeu.anim(el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-12%)" }], { duration: D2, easing: ELAN });
}

// Egyptian God: cinema bars over the HUD for about 4.5 s, a click skips them.
async function cinema(jeu: Jeu, el: HTMLDivElement | null, nom: string) {
  const [haut, titre, bas] = [...(el?.children ?? [])];
  if (!el || !haut || !titre || !bas) return;
  titre.textContent = nom;
  el.classList.add("est-active");
  await Promise.all([
    jeu.anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: D3 }),
    jeu.anim(haut, [{ translate: "0 -100%" }, { translate: "0 0" }], { duration: D3 }),
    jeu.anim(bas, [{ translate: "0 100%" }, { translate: "0 0" }], { duration: D3 }),
  ]);
  await jeu.anim(titre, [{ opacity: 0, scale: "1.3", letterSpacing: "0.4em" }, { opacity: 1, scale: "1", letterSpacing: "0.06em" }], { duration: D4 });
  await jeu.pause(4500 - 2 * D3 - D4, true);
  await jeu.anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: D3, easing: ELAN });
  el.classList.remove("est-active");
}

function useHud(regie: Regie, seat: number, cards: Cards) {
  const refs: Refs = {
    valeurs: [useRef(null), useRef(null)],
    deltas: [useRef(null), useRef(null)],
    plaques: [useRef(null), useRef(null)],
    mains: [useRef(null), useRef(null)],
    bandeau: useRef(null),
    bords: useRef(null),
    cinema: useRef(null),
  };
  const latest = useRef({ seat, cards, refs });
  useLayoutEffect(() => {
    latest.current = { seat, cards, refs };
  });
  useLayoutEffect(() => {
    regie.hud = (effet, jeu) => {
      const { seat: me, cards: data, refs: now } = latest.current;
      const camp = (player: number) => (player === me ? "moi" : "adverse");
      switch (effet.type) {
        case "pioche":
          return pioche(jeu, now.mains[effet.joueur].current, effet.nombre, effet.joueur === me ? 60 : -40);
        case "lp":
          return pointsDeVie(jeu, now, effet);
        case "phase":
          return BANDEAUX.has(effet.phase) ? bandeau(jeu, now.bandeau.current, phaseName(effet.phase), camp(effet.joueur)) : Promise.resolve();
        case "tour":
          return bandeau(jeu, now.bandeau.current, `Tour ${effet.tour} · ${effet.joueur === me ? "Votre tour" : "Tour de l'adversaire"}`, camp(effet.joueur));
        case "invocation":
          return effet.genre === "dieu" ? cinema(jeu, now.cinema.current, cardName(data, effet.code)) : Promise.resolve();
        default:
          return Promise.resolve();
      }
    };
    return () => {
      regie.hud = undefined;
    };
  }, [regie]);
  return { refs };
}

// `visee`: a monster being dragged can attack this player directly.
function Plaque({ board, player, start, name, refs, visee }: Readonly<{ board: Board; player: number; start: number; name: string; refs: Refs; visee?: boolean }>) {
  const { seat } = useDuelView();
  const side = board.players[player];
  const lp = Math.max(side.lp, 0);
  const mine = player === seat;
  // The value is written by hand so that the LP can roll down: React only writes the first one.
  const [first] = useState(lp);
  const valeur = refs.valeurs[player];
  useLayoutEffect(() => {
    const el = valeur.current;
    if (!el) return;
    el.dataset.lp = String(side.lp);
    el.textContent = String(lp);
  }, [lp, side.lp, valeur]);
  const label = mine ? `Vos points de vie : ${lp} sur ${start}` : `Points de vie de l'adversaire : ${lp} sur ${start}`;
  return (
    <div ref={refs.plaques[player]} className={`plaque plaque--${mine ? "moi" : "adverse"}${visee ? " est-visee" : ""}`} data-cible={mine ? undefined : String(player)}>
      <span className="avatar" aria-hidden="true">
        {name.charAt(0).toUpperCase()}
      </span>
      <div className="plaque__id">
        <b>{name}</b>
        <span className="compteurs">
          <span>
            <Icon id="ui-cartes" />
            <span className="sr">Main</span>
            {side.hand.length}
          </span>
          <span>
            <Icon id="ui-deck" />
            <span className="sr">Deck</span>
            {side.deck}
          </span>
          <span>
            <Icon id="ui-cimetiere" />
            <span className="sr">Cimetière</span>
            {side.grave.length}
          </span>
        </span>
      </div>
      <div className="lp">
        <span className="sr">{label}</span>
        <span ref={valeur} aria-hidden="true" className="lp__valeur chiffres" data-lp={first}>
          {first}
        </span>
        <span ref={refs.deltas[player]} className="lp__delta" aria-hidden="true" />
        <span className="lp__barre" style={{ "--v": `${Math.min(100, (lp / start) * 100)}%` } as CSSProperties} />
      </div>
    </div>
  );
}

const PHASES: [ReadonlySet<number>, string, string][] = [
  [new Set([OcgPhase.DRAW]), "DP", "Draw Phase"],
  [new Set([OcgPhase.STANDBY]), "SP", "Standby Phase"],
  [new Set([OcgPhase.MAIN1]), "MP1", "Main Phase 1"],
  [new Set([OcgPhase.BATTLE_START, OcgPhase.BATTLE_STEP, OcgPhase.DAMAGE, OcgPhase.DAMAGE_CAL, OcgPhase.BATTLE]), "BP", "Battle Phase"],
  [new Set([OcgPhase.MAIN2]), "MP2", "Main Phase 2"],
  [new Set([OcgPhase.END]), "EP", "End Phase"],
];

function Turn({ board, seat, leave }: Readonly<{ board: Board; seat: number; leave: () => void }>) {
  const mine = board.turnPlayer === seat;
  return (
    <div className={mine ? "tour est-mon-tour" : "tour"}>
      <div className="tour__ligne">
        <p>
          <span className="surtitre">Tour {board.turn}</span>
          <b className={mine ? "moi" : "adverse"}>{mine ? "Votre tour" : "Tour de l'adversaire"}</b>
        </p>
        <button className="btn-icone" type="button" aria-label="Quitter le duel" title="Quitter le duel" onClick={leave}>
          <Icon id="ui-sortie" />
        </button>
      </div>
      <ol className="phases" aria-label="Phases du tour">
        {PHASES.map(([phases, court, long]) => {
          const current = phases.has(board.phase);
          return (
            <li key={court} title={current ? undefined : long} aria-current={current ? "step" : undefined}>
              {current ? long : court}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Your hand as a fan: a card the question lets you play is highlighted, clickable, and can be dragged to the board.
function Hand({ hand, seat, ui, main, appui }: Readonly<{ hand: Card[]; seat: number; ui: Targets; main: RefObject<HTMLElement | null>; appui: (key: string, code: number, event: Appui) => void }>) {
  const { cards, show } = useDuelView();
  const middle = (hand.length - 1) / 2;
  return (
    <section className="main" ref={main} aria-label="Votre main">
      {/* Hand cards have no identity of their own: the engine refers to them by position. */}
      {[...hand.keys()].map((i) => {
        const { code } = hand[i];
        const key = placeKey({ controller: seat, location: HAND, sequence: i });
        const target = ui.targets.has(key);
        const classes = [target && "est-cible", ui.picked.includes(key) && "est-choisie"].filter(Boolean).join(" ");
        const decal = i - middle;
        return (
          <button
            key={i}
            type="button"
            className="main__carte"
            style={{ "--rot": `${decal * 4}deg`, "--haut": `${decal * decal * 2}px` } as CSSProperties}
            aria-label={target ? `${cardName(cards, code)}, jouable` : cardName(cards, code)}
            onMouseEnter={() => show(code)}
            onFocus={() => show(code)}
            onClick={(event) => (target ? ui.onPick?.(key, pointDe(event)) : show(code))}
            onPointerDown={target ? (event) => appui(key, code, event) : undefined}
            onDragStart={(event) => event.preventDefault()}
          >
            <CardView code={code} className={classes || undefined} />
          </button>
        );
      })}
    </section>
  );
}

function Chain({ chain, seat, opponent }: Readonly<{ chain: Board["chain"]; seat: number; opponent?: string }>) {
  const { cards } = useDuelView();
  return (
    <section className="panneau chaine" aria-label="Chaîne en cours">
      <h2 className="titre-bloc">
        <Icon id="ui-chaine" />
        Chaîne
      </h2>
      <ol reversed>
        {[...chain.keys()].reverse().map((i) => {
          const link = chain[i];
          const mine = link.controller === seat;
          return (
            <li key={i} className={mine ? "maillon-ligne" : "maillon-ligne maillon-ligne--adverse"}>
              <span className={mine ? "maillon" : "maillon maillon--adverse"}>{i + 1}</span>
              <CardView code={link.code} />
              <p>
                <b>{cardName(cards, link.code)}</b>
                <span>{mine ? "Vous" : (opponent ?? "Adversaire")}</span>
              </p>
            </li>
          );
        })}
      </ol>
      <p className="note">Résolution du dernier maillon au premier.</p>
    </section>
  );
}

function Log({ log, opponent }: Readonly<{ log: LogEntry[]; opponent?: string }>) {
  return (
    <section className="panneau journal" aria-label="Journal du duel">
      <h2 className="titre-bloc">
        <Icon id="ui-journal" />
        Journal
      </h2>
      {/* column-reverse keeps the last entry in view. */}
      <div className="journal__defil">
        <ol>
          {/* Entries are only ever appended: their position is their identity. */}
          {[...log.keys()].map((i) => (
            <Entry key={i} entry={log[i]} opponent={opponent} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function Entry({ entry, opponent }: Readonly<{ entry: LogEntry; opponent?: string }>) {
  const { seat } = useDuelView();
  const first = entry.parts[0];
  const turn = entry.parts.length === 1 && typeof first === "string" && first.startsWith("Tour ");
  let who: string | undefined;
  if (entry.player === seat) who = "Vous";
  else if (entry.player !== undefined) who = opponent ?? "Adversaire";
  if (turn) {
    return (
      <li className="journal__tour">
        {first} · {who}
      </li>
    );
  }
  return (
    <li>
      {who && <b className={entry.player === seat ? "moi" : "adverse"}>{who} </b>}
      {[...entry.parts.keys()].map((i) => {
        const part = entry.parts[i];
        return typeof part === "string" ? part : <CardName key={i} code={part.code} />;
      })}
    </li>
  );
}

function CardName({ code }: Readonly<{ code: number }>) {
  const { cards, show } = useDuelView();
  if (!code) return <>une carte face cachée</>;
  const reveal = () => show(code);
  return (
    <button type="button" className="nom-carte" onMouseEnter={reveal} onFocus={reveal} onClick={reveal}>
      {cardName(cards, code)}
    </button>
  );
}

// Cards of a Graveyard or of the banished ones, opened from the board: the ones the question asks for can be picked.
function PileList({ id, board, seat, ui, close }: Readonly<{ id: string; board: Board; seat: number; ui: Ui; close: () => void }>) {
  const { cards, show } = useDuelView();
  const fermer = useRef<HTMLButtonElement>(null);
  const [controller, location] = id.split(":").map(Number);
  const side = board.players[controller];
  const list = location === GRAVE ? side.grave : side.banished;
  const title = location === GRAVE ? `Cimetière${controller === seat ? "" : " adverse"}` : `Cartes bannies${controller === seat ? "" : " adverses"}`;
  // The list opens on a click: its close button takes the focus, Escape closes it.
  useLayoutEffect(() => fermer.current?.focus(), [id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <dialog open className="panneau pile-liste" aria-label={title}>
      <header className="pile-liste__tete">
        <h2 className="titre-bloc">
          {title} <span className="chiffres">{list.length}</span>
        </h2>
        <button ref={fermer} type="button" className="btn-icone" aria-label="Fermer" onClick={close}>
          <Icon id="ui-fermer" />
        </button>
      </header>
      {list.length === 0 ? (
        <p className="texte-2">Aucune carte.</p>
      ) : (
        <ol className="pile-liste__cartes">
          {[...list.keys()].reverse().map((i) => {
            const { code } = list[i];
            const key = placeKey({ controller, location: location as OcgLocation, sequence: i });
            const target = ui.targets.has(key);
            return (
              <li key={i}>
                <button
                  type="button"
                  className="pile-liste__carte"
                  aria-label={target ? `${cardName(cards, code)}, à choisir` : cardName(cards, code)}
                  onMouseEnter={() => show(code)}
                  onFocus={() => show(code)}
                  onClick={(event) => (target ? ui.onPick?.(key, pointDe(event)) : show(code))}
                >
                  <CardView code={code} className={target ? "est-cible" : undefined} />
                  <span>{cardName(cards, code)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </dialog>
  );
}
