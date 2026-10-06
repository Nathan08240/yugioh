// The 3D board (plain three.js), loaded on its own chunk when a duel starts: the other screens pay nothing for it.
import { OcgLocation } from "@n1xx1/ocgcore-wasm";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { PerspectiveCamera, Scene, Timer, Vector3, WebGLRenderer } from "three";
import type { Board } from "../board.ts";
import type { Cards } from "../cards.ts";
import { pointDe, type Appui, type Point } from "../question.ts";
import { useReglages } from "../reglages.ts";
import { etatScene, pileId, zones, ZONE, type EtatScene, type Zone } from "./disposition.ts";
import { Monde, type Qualite } from "./monde.ts";
import type { Regie } from "./spectacle.ts";
import { charger } from "./textures.ts";

export type Props = {
  board: Board;
  seat: number;
  cards: Cards;
  // 3D zones the question lets the player click, and the ones picked.
  cibles: Set<string>;
  choisies: Set<string>;
  onZone: (id: string, point: Point) => void;
  onSurvol: (id: string | undefined) => void;
  // A press on a zone, where a drag may start; `sonde` gives the zone under a point of the screen.
  onAppui: (id: string, event: Appui) => void;
  sonde: RefObject<((x: number, y: number) => string | undefined) | null>;
  regie: Regie;
  // The frame the HUD leaves for the board.
  cadre: RefObject<HTMLElement | null>;
  // WebGL context lost: the duel goes on on the 2D board.
  onPerdu: () => void;
};

type Taille = { width: number; height: number };
type Rendu = {
  gl: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  taille: Taille;
  // Asks for one frame: the world calls it whenever something changes or moves, none is drawn at rest.
  invalider: () => void;
  // Pins the labels ([data-x]) on their point of the board.
  placer: () => void;
  arreter: () => void;
};

const POINT = new Vector3();

function creerRendu(canvas: HTMLCanvasElement, hote: HTMLElement, monde: RefObject<Monde | null>): Rendu {
  const gl = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
  const camera = new PerspectiveCamera(32, 1, 0.1, 100);
  const timer = new Timer();
  const poses = new WeakMap<HTMLElement, string>();
  let image = 0;
  const rendu: Rendu = {
    gl,
    scene: new Scene(),
    camera,
    taille: { width: 0, height: 0 },
    invalider() {
      image ||= requestAnimationFrame(dessiner);
    },
    placer() {
      const { width, height } = rendu.taille;
      for (const el of hote.querySelectorAll<HTMLElement>("[data-x]")) {
        const p = POINT.set(Number(el.dataset.x), 0, Number(el.dataset.z)).project(camera);
        const pose = `translate3d(${((p.x + 1) * width) / 2}px,${((1 - p.y) * height) / 2}px,0)`;
        if (poses.get(el) === pose) continue;
        poses.set(el, pose);
        el.style.transform = pose;
      }
    },
    arreter() {
      cancelAnimationFrame(image);
      image = 0;
    },
  };
  function dessiner() {
    image = 0;
    timer.update();
    monde.current?.frame(timer.getDelta(), timer.getElapsed());
    rendu.placer();
  }
  return rendu;
}

export default function Plateau3D({ board, seat, cards, cibles, choisies, onZone, onSurvol, onAppui, sonde, regie, cadre, onPerdu }: Readonly<Props>) {
  const [reglage] = useReglages();
  const [degradee, setDegradee] = useState(false);
  const qualite: Qualite = reglage.qualite === "basse" || degradee ? "basse" : "haute";
  const [pret, setPret] = useState(false);
  const monde = useRef<Monde>(null);
  const etat = useMemo(() => etatScene(board, seat), [board, seat]);
  const hote = useRef<HTMLDivElement>(null);
  const toile = useRef<HTMLCanvasElement>(null);
  const moteur = useRef<Rendu>(null);
  // Set once the canvas has a size; `taille` follows it.
  const [rendu, setRendu] = useState<Rendu>();
  const [taille, setTaille] = useState<Taille>({ width: 0, height: 0 });

  // The effects are cleaned up in this order: listeners, world, then renderer.
  useEffect(() => {
    const canvas = toile.current;
    if (!canvas) return;
    const sousPoint = (x: number, y: number) => {
      const r = canvas.getBoundingClientRect();
      return monde.current?.toucher(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    };
    const sous = (event: PointerEvent) => sousPoint(event.clientX, event.clientY);
    sonde.current = sousPoint;
    const move = (event: PointerEvent) => {
      const id = sous(event);
      monde.current?.survol(id);
      canvas.style.cursor = id ? "pointer" : "";
      onSurvol(id);
    };
    const leave = () => {
      monde.current?.survol(undefined);
      onSurvol(undefined);
    };
    const click = (event: MouseEvent) => {
      const id = sous(event as PointerEvent);
      if (id) onZone(id, { x: event.clientX, y: event.clientY });
    };
    const down = (event: PointerEvent) => {
      const id = sous(event);
      if (id) onAppui(id, event);
    };
    const lost = (event: Event) => {
      event.preventDefault();
      onPerdu();
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("click", click);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      sonde.current = null;
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("click", click);
      canvas.removeEventListener("webglcontextlost", lost);
    };
  }, [onZone, onSurvol, onAppui, sonde, onPerdu]);

  useEffect(() => {
    regie.scene = (effet, jeu) => monde.current?.jouer(effet, jeu) ?? Promise.resolve();
    return () => {
      regie.scene = undefined;
    };
  }, [regie]);

  // The world is built once per renderer and seat.
  useEffect(() => {
    if (!rendu) return;
    let vivant = true;
    let cree: Monde | undefined;
    charger()
      .then((res) => {
        if (!vivant) return;
        cree = new Monde(rendu.gl, rendu.scene, rendu.camera, res, cards, seat, { invalider: rendu.invalider, lent: () => setDegradee(true) });
        monde.current = cree;
        setPret(true);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (vivant) onPerdu();
      });
    return () => {
      vivant = false;
      cree?.dispose();
      monde.current = null;
    };
    // onPerdu only switches to the 2D board.
  }, [rendu, cards, seat]);

  // One renderer per canvas, freed once the canvas leaves the page (StrictMode runs the effects twice on the same canvas).
  useEffect(() => {
    const canvas = toile.current;
    const div = hote.current;
    if (!canvas || !div) return;
    const r = (moteur.current ??= creerRendu(canvas, div, monde));
    const observer = new ResizeObserver(([entree]) => {
      const { width, height } = entree.contentRect;
      r.taille = { width, height };
      r.gl.setSize(width, height);
      setTaille(r.taille);
      if (width > 0 && height > 0) setRendu(r);
      r.invalider();
    });
    observer.observe(div);
    return () => {
      observer.disconnect();
      r.arreter();
      if (canvas.isConnected) return;
      r.gl.dispose();
      r.gl.forceContextLoss();
    };
  }, []);

  // High quality: up to twice the pixels on a dense screen. The framing (cadrer) resizes the post-processing.
  useEffect(() => {
    if (!rendu || !pret) return;
    rendu.gl.setPixelRatio(qualite === "haute" ? Math.min(Math.max(1, devicePixelRatio), 2) : 1);
    monde.current?.qualite(qualite, rendu.taille.width, rendu.taille.height);
  }, [rendu, qualite, pret]);

  // The board is framed again when the canvas or the frame left by the HUD changes size.
  useEffect(() => {
    const el = cadre.current;
    if (!el || !rendu || !pret) return;
    const cadrer = () => {
      const canvas = rendu.gl.domElement.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      monde.current?.cadrer(taille.width, taille.height, { left: r.left - canvas.left, top: r.top - canvas.top, width: r.width, height: r.height });
    };
    cadrer();
    const observer = new ResizeObserver(cadrer);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cadre, rendu, taille, pret]);

  // Layout effects: a message applied with flushSync is on the scene before its animation starts.
  useLayoutEffect(() => {
    if (pret) monde.current?.sync(etat, board.chain);
  }, [etat, board.chain, pret]);
  useLayoutEffect(() => {
    if (pret) monde.current?.question(cibles, choisies);
  }, [cibles, choisies, pret]);

  return (
    <div ref={hote} className={pret ? "plateau-3d est-pret" : "plateau-3d"} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas ref={toile} style={{ display: "block" }} aria-hidden="true" />
      {/* The canvas draws on demand; under 45 frames per second for 3 s of motion (cadence.ts): low quality, for good. */}
      {pret && rendu && <Etiquettes etat={etat} seat={seat} cibles={cibles} onZone={onZone} onSurvol={onSurvol} onAppui={onAppui} placer={rendu.placer} />}
    </div>
  );
}

const NOMS: Record<string, string> = { monstre: "Zone Monstre", magie: "Zone Magie/Piège", terrain: "Zone Terrain", cimetiere: "Cimetière", deck: "Deck", extra: "Extra Deck" };
const nomZone = (zone: Zone) => `${NOMS[zone.type]}${zone.type === "monstre" || zone.type === "magie" ? ` ${zone.col}` : ""}${zone.camp === 0 ? "" : " adverse"}`;

// A DOM element centered on a point of the board, above the canvas (`couche`: its z-index); the renderer moves it at each frame.
function Repere({ x, z, couche, className, children }: Readonly<{ x: number; z: number; couche: number; className?: string; children: ReactNode }>) {
  return (
    <div data-x={x} data-z={z} style={{ position: "absolute", top: 0, left: 0, transformOrigin: "0 0", zIndex: couche }}>
      <div className={className} style={{ position: "absolute", transform: "translate3d(-50%,-50%,0)" }}>
        {children}
      </div>
    </div>
  );
}

type EtiquettesProps = Pick<Props, "onZone" | "onSurvol" | "onAppui"> & { etat: EtatScene; seat: number; cibles: Set<string>; placer: () => void };

// Pile counters, banished cards beside the Graveyard, and one focusable button per zone to choose (keyboard, screen reader).
function Etiquettes({ etat, seat, cibles, onZone, onSurvol, onAppui, placer }: Readonly<EtiquettesProps>) {
  const liste = useMemo(() => zones(seat), [seat]);
  // A label that appears is on its point before it is painted.
  useLayoutEffect(placer);
  return (
    <>
      {liste.map((zone) => {
        const pile = etat.piles.get(zone.id);
        // Monster row: label on the side of the middle line; Spell/Trap row: on the edge of the board.
        const versLeBord = zone.rangee === 1;
        const dz = (versLeBord === (zone.camp === 0) ? 1 : -1) * (ZONE.p / 2 + 0.08);
        return (
          <Fragment key={zone.id}>
            {pile && (
              <Repere x={zone.x} z={zone.z + dz} couche={4} className={versLeBord === (zone.camp === 0) ? "etiquette" : "etiquette etiquette--haut"}>
                {zone.type === "cimetiere" ? (
                  <Cimetiere zone={zone} etat={etat} cibles={cibles} onZone={onZone} />
                ) : (
                  <span>
                    {NOMS[zone.type]} <b className="chiffres">{pile.nombre}</b>
                  </span>
                )}
              </Repere>
            )}
            {cibles.has(zone.id) && zone.type !== "cimetiere" && (
              <Repere x={zone.x} z={zone.z} couche={5}>
                <button
                  type="button"
                  className="zone-3d"
                  aria-label={`Choisir : ${nomZone(zone)}`}
                  onClick={(event) => onZone(zone.id, pointDe(event))}
                  onPointerDown={(event) => onAppui(zone.id, event)}
                  onFocus={() => onSurvol(zone.id)}
                  onPointerEnter={() => onSurvol(zone.id)}
                />
              </Repere>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function Cimetiere({ zone, etat, cibles, onZone }: Readonly<{ zone: Zone; etat: EtatScene; cibles: Set<string>; onZone: (id: string, point: Point) => void }>) {
  const bannies = pileId(zone.joueur, OcgLocation.REMOVED);
  const qui = zone.camp === 0 ? "" : " adverse";
  return (
    <span className="etiquette__piles">
      <button type="button" className={cibles.has(zone.id) ? "etiquette__bouton est-cible" : "etiquette__bouton"} aria-label={`Cimetière${qui} : ${etat.piles.get(zone.id)?.nombre ?? 0} cartes, voir la liste`} onClick={(event) => onZone(zone.id, pointDe(event))}>
        Cimetière <b className="chiffres">{etat.piles.get(zone.id)?.nombre ?? 0}</b>
      </button>
      <button type="button" className={cibles.has(bannies) ? "etiquette__bouton est-cible" : "etiquette__bouton"} aria-label={`Bannies${qui} : ${etat.piles.get(bannies)?.nombre ?? 0} cartes, voir la liste`} onClick={(event) => onZone(bannies, pointDe(event))}>
        Bannies <b className="chiffres">{etat.piles.get(bannies)?.nombre ?? 0}</b>
      </button>
    </span>
  );
}
