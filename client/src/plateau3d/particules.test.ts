import * as THREE from "three";
import { expect, it } from "vitest";
import { CARTE } from "./disposition.ts";
import { Eclats, Particules } from "./particules.ts";

const blanc = new THREE.Color(1, 1, 1);
const burst = (origine: THREE.Vector3, extra: Partial<Parameters<Particules["emettre"]>[0]> = {}) => ({ nombre: 30, origine, couleur: blanc, vitesse: [1, 2] as const, taille: [0.05, 0.1] as const, vie: [0.4, 0.5] as const, ...extra });

it("n'émet pas au-delà du budget de la qualité, et s'éteint à la fin de la vie des particules", () => {
  const p = new Particules(100);
  p.budget = 40;
  p.emettre(burst(new THREE.Vector3()));
  p.emettre(burst(new THREE.Vector3()));
  expect(p.actives).toBe(40);
  expect(p.avancer(0.1)).toBe(true);
  expect(p.points.geometry.drawRange.count).toBe(40);
  for (let i = 0; i < 5; i++) p.avancer(0.1);
  expect(p.actives).toBe(0);
  expect(p.avancer(1 / 60)).toBe(false);
  expect(p.points.geometry.drawRange.count).toBe(0);
});

it("attire vers leur cible les particules d'un sacrifice, qui s'y éteignent", () => {
  const p = new Particules(50);
  const cible = new THREE.Vector3(2, 0.5, 0);
  p.emettre(burst(new THREE.Vector3(0, 0.5, 0), { nombre: 20, vitesse: [0, 0], vie: [10, 10], vers: cible, attraction: 12, freinage: 3 }));
  let pas = 0;
  while (p.avancer(1 / 60) && pas < 600) pas++;
  // All gone well before the end of their 10 s of life: they reached the target.
  expect(p.actives).toBe(0);
  expect(pas).toBeLessThan(300);
});

it("brise une carte en triangles qui partent de sa face et retombent", () => {
  const groupe = new THREE.Group();
  groupe.position.set(1, 0.01, 2);
  const eclats = new Eclats(groupe, null, CARTE);
  const position = eclats.mesh.geometry.getAttribute("position");
  expect(position.count).toBe(3 * 4 * 2 * 3);
  eclats.avancer(0);
  // At the break the shards cover the card, on its face.
  for (let i = 0; i < position.count; i++) {
    expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(CARTE.l / 2 + 1e-6);
    expect(position.getY(i)).toBeCloseTo(CARTE.e / 2);
  }
  eclats.avancer(1.2);
  const hauteurs = Array.from({ length: position.count }, (_, i) => position.getY(i));
  expect(Math.min(...hauteurs)).toBeLessThan(0);
  expect(eclats.mesh.position.toArray()).toEqual([1, 0.01, 2]);
  eclats.dispose();
});
