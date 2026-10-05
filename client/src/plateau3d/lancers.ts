// Dice and coins thrown over the 3D board: their meshes, the pose that turns the result face up, and their flight.
import * as THREE from "three";
import { phase } from "../motion.ts";
import type { Effet } from "./effets.ts";
import { dessinerFaceLancer, hdr } from "./textures.ts";

export type Lancer = { mesh: THREE.Mesh; final: THREE.Quaternion; moitie: number; tours: number; axe: THREE.Vector3 };

const DE = 0.6;
const PIECE = { r: 0.4, e: 0.08 };
const DEMI = Math.PI / 2;
// The number on each face of a BoxGeometry (+x, -x, +y, -y, +z, -z): opposite faces add up to 7.
const FACES = [1, 6, 2, 5, 3, 4];
// Rotation (x, y, z) that turns the face of a die up, for the numbers 1 to 6.
const EN_HAUT: [number, number, number][] = [[0, 0, DEMI], [0, 0, 0], [-DEMI, 0, 0], [DEMI, 0, 0], [Math.PI, 0, 0], [0, 0, -DEMI]];
const AXE_Y = new THREE.Vector3(0, 1, 0);
const spin = new THREE.Quaternion();

const sortie = (k: number) => 1 - (1 - k) ** 4;
const materiau = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.06, roughness: 0.5 });

function de(resultat: number, i: number): Lancer {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(DE, DE, DE), FACES.map((face) => materiau(dessinerFaceLancer(String(face), false))));
  const [x, y, z] = EN_HAUT[resultat - 1] ?? EN_HAUT[1];
  // A turn of the die about the vertical keeps its face up.
  const final = new THREE.Quaternion().setFromAxisAngle(AXE_Y, 0.4 * i + 0.2).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
  return { mesh, final, moitie: DE / 2, tours: 2 + (i % 2), axe: new THREE.Vector3(1, 0.5, 0.3 * (i + 1)).normalize() };
}

function piece(face: boolean, i: number): Lancer {
  const bord = new THREE.MeshStandardMaterial({ color: hdr("--or"), roughness: 0.35, metalness: 0.1 });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(PIECE.r, PIECE.r, PIECE.e, 32), [bord, materiau(dessinerFaceLancer("FACE", true)), materiau(dessinerFaceLancer("PILE", true))]);
  // Heads up as it is, tails by a half turn about the depth axis (the text of the lower cap then reads upright).
  const final = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, face ? 0 : Math.PI));
  return { mesh, final, moitie: PIECE.e / 2, tours: 3 + (i % 2), axe: new THREE.Vector3(1, 0, 0.2 * (i + 1)).normalize() };
}

export const construire = (effet: Extract<Effet, { type: "de" | "piece" }>): Lancer[] =>
  effet.type === "piece" ? effet.resultats.map(piece) : effet.resultats.map(de);

// Frees the geometry, the materials and the faces of a thrown object.
export function liberer({ mesh }: Lancer) {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  for (const m of [mesh.material].flat()) {
    (m as THREE.MeshStandardMaterial).map?.dispose();
    m.dispose();
  }
}

// Poses the objects at the progress `k` of the throw: they come from the side of the thrower (`depart`, a z), fly over the
// middle of the board, bounce twice and spin less and less until they lie side by side on their result.
export function poser(lancers: readonly Lancer[], k: number, depart: number) {
  const vol = phase(k, 0, 0.55);
  const tombe = sortie(vol);
  const arc = (debut: number, fin: number, hauteur: number) => hauteur * Math.sin(Math.PI * phase(k, debut, fin));
  const pas = Math.min(0.8, 3.6 / lancers.length);
  for (const [i, l] of lancers.entries()) {
    const x = (i - (lancers.length - 1) / 2) * pas;
    const z = 0.1 + 0.15 * Math.sin(2.3 * i);
    l.mesh.position.set(x * (0.3 + 0.7 * tombe), l.moitie + 0.9 * (1 - vol) + arc(0, 0.55, 0.9) + arc(0.55, 0.8, 0.22) + arc(0.8, 1, 0.07), depart + (z - depart) * tombe);
    spin.setFromAxisAngle(l.axe, (1 - sortie(phase(k, 0, 0.85))) * l.tours * 2 * Math.PI);
    l.mesh.quaternion.copy(spin).multiply(l.final);
    l.mesh.scale.setScalar(0.5 + 0.5 * phase(k, 0, 0.12));
  }
}
