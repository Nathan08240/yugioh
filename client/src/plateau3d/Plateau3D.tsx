// The 3D board (react-three-fiber), loaded on its own chunk when a duel starts: the other screens pay nothing for it.
import { OcgLocation } from "@n1xx1/ocgcore-wasm";
import { Html, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PerspectiveCamera } from "three";
import type { Board } from "../board.ts";
import type { Cards } from "../cards.ts";
import { pointDe, type Appui, type Point } from "../question.ts";
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

type Monté = RefObject<Monde | null>;

export default function Plateau3D(props: Readonly<Props>) {
  const { board, seat, cibles, choisies } = props;
  const [qualite, setQualite] = useState<Qualite>("haute");
  const [pret, setPret] = useState(false);
  const monde = useRef<Monde>(null);
  const etat = useMemo(() => etatScene(board, seat), [board, seat]);

  // Layout effects: a message applied with flushSync is on the scene before its animation starts.
  useLayoutEffect(() => {
    if (pret) monde.current?.sync(etat, board.chain);
  }, [etat, board.chain, pret]);
  useLayoutEffect(() => {
    if (pret) monde.current?.question(cibles, choisies);
  }, [cibles, choisies, pret]);

  return (
    <Canvas
      className={pret ? "plateau-3d est-pret" : "plateau-3d"}
      style={{ position: "absolute", inset: 0 }}
      dpr={qualite === "haute" ? [1, 2] : 1}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      camera={{ fov: 32, near: 0.1, far: 100 }}
      onCreated={({ gl }) => gl.domElement.setAttribute("aria-hidden", "true")}
    >
      {/* Under 45 frames per second for 3 s: low quality, for good. */}
      <PerformanceMonitor ms={300} iterations={10} bounds={() => [45, 1000]} flipflops={1} onDecline={() => setQualite("basse")} />
      <Scene {...props} monde={monde} qualite={qualite} pret={pret} onPret={() => setPret(true)} />
      {pret && <Etiquettes etat={etat} seat={seat} cibles={cibles} onZone={props.onZone} onSurvol={props.onSurvol} onAppui={props.onAppui} />}
    </Canvas>
  );
}

type SceneProps = Props & { monde: Monté; qualite: Qualite; pret: boolean; onPret: () => void };

function Scene({ seat, cards, monde, qualite, pret, onPret, cadre, regie, onZone, onSurvol, onAppui, sonde, onPerdu }: Readonly<SceneProps>) {
  const { gl, scene, camera, size } = useThree();

  useEffect(() => {
    let vivant = true;
    let cree: Monde | undefined;
    charger()
      .then((res) => {
        if (!vivant) return;
        cree = new Monde(gl, scene, camera as PerspectiveCamera, res, cards, seat);
        monde.current = cree;
        onPret();
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
    // onPret only sets a flag: the world is built once per renderer and seat.
  }, [gl, scene, camera, cards, seat, monde]);

  useEffect(() => {
    monde.current?.qualite(qualite, size.width, size.height);
  }, [qualite, pret, size, monde]);

  // The board is framed again when the canvas or the frame left by the HUD changes size.
  useEffect(() => {
    const el = cadre.current;
    if (!el || !pret) return;
    const cadrer = () => {
      const canvas = gl.domElement.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      monde.current?.cadrer(size.width, size.height, { left: r.left - canvas.left, top: r.top - canvas.top, width: r.width, height: r.height });
    };
    cadrer();
    const observer = new ResizeObserver(cadrer);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cadre, gl, size, pret, monde]);

  // Priority 1: the world renders the frame itself (post-processing).
  useFrame((state, dt) => monde.current?.frame(Math.min(dt, 0.1), state.clock.elapsedTime), 1);

  useEffect(() => {
    regie.scene = (effet, jeu) => monde.current?.jouer(effet, jeu) ?? Promise.resolve();
    return () => {
      regie.scene = undefined;
    };
  }, [regie, monde]);

  useEffect(() => {
    const canvas = gl.domElement;
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
  }, [gl, monde, onZone, onSurvol, onAppui, sonde, onPerdu]);

  return null;
}

const NOMS: Record<string, string> = { monstre: "Zone Monstre", magie: "Zone Magie/Piège", terrain: "Zone Terrain", cimetiere: "Cimetière", deck: "Deck", extra: "Extra Deck" };
const nomZone = (zone: Zone) => `${NOMS[zone.type]}${zone.type === "monstre" || zone.type === "magie" ? ` ${zone.col}` : ""}${zone.camp === 0 ? "" : " adverse"}`;

type EtiquettesProps = Pick<Props, "onZone" | "onSurvol" | "onAppui"> & { etat: EtatScene; seat: number; cibles: Set<string> };

// Pile counters, banished cards beside the Graveyard, and one focusable button per zone to choose (keyboard, screen reader).
function Etiquettes({ etat, seat, cibles, onZone, onSurvol, onAppui }: Readonly<EtiquettesProps>) {
  const liste = useMemo(() => zones(seat), [seat]);
  return (
    <>
      {liste.map((zone) => {
        const pile = etat.piles.get(zone.id);
        // Monster row: label on the side of the middle line; Spell/Trap row: on the edge of the board.
        const versLeBord = zone.rangee === 1;
        const dz = (versLeBord === (zone.camp === 0) ? 1 : -1) * (ZONE.p / 2 + 0.08);
        return (
          <group key={zone.id}>
            {pile && (
              <Html position={[zone.x, 0, zone.z + dz]} center zIndexRange={[4, 0]} className={versLeBord === (zone.camp === 0) ? "etiquette" : "etiquette etiquette--haut"}>
                {zone.type === "cimetiere" ? (
                  <Cimetiere zone={zone} etat={etat} cibles={cibles} onZone={onZone} />
                ) : (
                  <span>
                    {NOMS[zone.type]} <b className="chiffres">{pile.nombre}</b>
                  </span>
                )}
              </Html>
            )}
            {cibles.has(zone.id) && zone.type !== "cimetiere" && (
              <Html position={[zone.x, 0, zone.z]} center zIndexRange={[5, 0]}>
                <button
                  type="button"
                  className="zone-3d"
                  aria-label={`Choisir : ${nomZone(zone)}`}
                  onClick={(event) => onZone(zone.id, pointDe(event))}
                  onPointerDown={(event) => onAppui(zone.id, event)}
                  onFocus={() => onSurvol(zone.id)}
                  onPointerEnter={() => onSurvol(zone.id)}
                />
              </Html>
            )}
          </group>
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
