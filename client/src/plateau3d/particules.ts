// Particles and shards of the effects: one draw call each, simulated on the CPU while they live, nothing at rest.
import * as THREE from "three";
import { FS_PARTICULE, VS_PARTICULE } from "./shaders.ts";

// A small fixed generator: the same burst every time, and no Math.random.
let graine = 7;
export function alea() {
  graine = (graine * 16807) % 2147483647;
  return (graine - 1) / 2147483646;
}
const entre = ([min, max]: readonly [number, number]) => min + (max - min) * alea();

// `rayon`: spread around the origin (flat on the board with `plat`). `direction`: main way of the burst, `ecart` how far
// they stray from it (1: any way). `vers`: point they are drawn to, `attraction` its pull, `tourbillon` a swirl around it.
export type Emission = {
  nombre: number;
  origine: THREE.Vector3;
  couleur: THREE.Color;
  vitesse: readonly [number, number];
  taille: readonly [number, number];
  vie: readonly [number, number];
  rayon?: number;
  plat?: boolean;
  direction?: THREE.Vector3;
  ecart?: number;
  gravite?: number;
  freinage?: number;
  vers?: THREE.Vector3;
  attraction?: number;
  tourbillon?: number;
};

// Per particle: position 3, speed 3, color 3, size, age, life, gravity, braking, target 3, pull, swirl.
const CASES = 19;
const [P, V, C, T, AGE, VIE, G, F, CIBLE, TIRE, TOUR] = [0, 3, 6, 9, 10, 11, 12, 13, 14, 17, 18];
const HAUT = new THREE.Vector3(0, 1, 0);

export class Particules {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly etat: Float32Array;
  private readonly attributs: THREE.BufferAttribute[];
  private vivantes = 0;
  // Budget of the quality, at most the capacity.
  budget: number;
  private readonly tmp = new THREE.Vector3();

  constructor(capacite: number) {
    this.budget = capacite;
    this.etat = new Float32Array(capacite * CASES);
    const geo = new THREE.BufferGeometry();
    this.attributs = ([["position", 3], ["aCouleur", 3], ["aTaille", 1], ["aAlpha", 1]] as const).map(([nom, taille]) => {
      const attribut = new THREE.BufferAttribute(new Float32Array(capacite * taille), taille).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(nom, attribut);
      return attribut;
    });
    geo.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({ vertexShader: VS_PARTICULE, fragmentShader: FS_PARTICULE, uniforms: { uEchelle: { value: 800 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 15;
  }

  get actives() {
    return this.vivantes;
  }

  // Pixels per world unit at a distance of 1, from the height of the drawing buffer and the field of view.
  echelle(hauteur: number, fov: number) {
    this.points.material.uniforms.uEchelle.value = hauteur / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  emettre(e: Emission) {
    const n = Math.min(Math.round(e.nombre), Math.max(0, this.budget - this.vivantes));
    for (let j = 0; j < n; j++) this.naitre(this.vivantes++ * CASES, e);
  }

  private naitre(o: number, e: Emission) {
    const s = this.etat;
    const angle = alea() * Math.PI * 2;
    const r = (e.rayon ?? 0) * Math.sqrt(alea());
    const u = e.plat ? 0 : alea() * 2 - 1;
    const horizontal = Math.sqrt(1 - u * u);
    s[o + P] = e.origine.x + Math.cos(angle) * r * horizontal;
    s[o + P + 1] = e.origine.y + u * r;
    s[o + P + 2] = e.origine.z + Math.sin(angle) * r * horizontal;
    // Any way (a point of the sphere), pulled towards `direction` by 1 - ecart.
    const dir = this.tmp.set(Math.cos(angle) * horizontal, e.plat ? 0.15 : u, Math.sin(angle) * horizontal);
    if (e.direction) dir.multiplyScalar(e.ecart ?? 0.5).add(e.direction);
    dir.normalize().multiplyScalar(entre(e.vitesse));
    s.set([dir.x, dir.y, dir.z, e.couleur.r, e.couleur.g, e.couleur.b, entre(e.taille), 0, entre(e.vie), e.gravite ?? 0, e.freinage ?? 0], o + V);
    const vers = e.vers ?? e.origine;
    s.set([vers.x, vers.y, vers.z, e.vers ? (e.attraction ?? 6) : 0, e.tourbillon ?? 0], o + CIBLE);
  }

  // Moves the living particles by `dt` seconds; true while some are left.
  avancer(dt: number) {
    const s = this.etat;
    let i = 0;
    while (i < this.vivantes) {
      const o = i * CASES;
      s[o + AGE] += dt;
      const dx = s[o + CIBLE] - s[o + P];
      const dy = s[o + CIBLE + 1] - s[o + P + 1];
      const dz = s[o + CIBLE + 2] - s[o + P + 2];
      const distance = Math.hypot(dx, dy, dz);
      const arrivee = s[o + TIRE] > 0 && distance < 0.06;
      if (s[o + AGE] >= s[o + VIE] || arrivee) {
        this.vivantes--;
        s.copyWithin(o, this.vivantes * CASES, this.vivantes * CASES + CASES);
        continue;
      }
      this.pousser(o, dx, dy, dz, distance, dt);
      i++;
    }
    this.ecrire();
    return this.vivantes > 0;
  }

  private pousser(o: number, dx: number, dy: number, dz: number, distance: number, dt: number) {
    const s = this.etat;
    const tire = (s[o + TIRE] * dt) / Math.max(distance, 0.05);
    const tour = s[o + TOUR] * dt;
    s[o + V] += dx * tire + dz * tour;
    s[o + V + 1] += dy * tire - s[o + G] * dt;
    s[o + V + 2] += dz * tire - dx * tour;
    const frein = Math.exp(-s[o + F] * dt);
    for (let k = 0; k < 3; k++) {
      s[o + V + k] *= frein;
      s[o + P + k] += s[o + V + k] * dt;
    }
  }

  private ecrire() {
    const s = this.etat;
    const [pos, col, taille, alpha] = this.attributs;
    for (let i = 0; i < this.vivantes; i++) {
      const o = i * CASES;
      const k = s[o + AGE] / s[o + VIE];
      (pos.array as Float32Array).set(s.subarray(o + P, o + P + 3), i * 3);
      (col.array as Float32Array).set(s.subarray(o + C, o + C + 3), i * 3);
      taille.array[i] = s[o + T] * (1 - 0.5 * k);
      // Quick fade in, slow fade out.
      alpha.array[i] = Math.min(1, k * 12) * (1 - k) ** 1.5;
    }
    for (const attribut of this.attributs) {
      attribut.clearUpdateRanges();
      attribut.addUpdateRange(0, this.vivantes * attribut.itemSize);
      attribut.needsUpdate = true;
    }
    this.points.geometry.setDrawRange(0, this.vivantes);
  }
}

// Corners (x, z) of the triangles cut in a card of l x h: a grid whose inner points move a little, for uneven shards.
function decouper(l: number, h: number, colonnes: number, rangees: number): number[][] {
  const point = (i: number, j: number) => {
    const jeu = i === 0 || j === 0 || i === colonnes || j === rangees ? 0 : 0.35;
    return [(i / colonnes - 0.5 + ((alea() - 0.5) * jeu) / colonnes) * l, (j / rangees - 0.5 + ((alea() - 0.5) * jeu) / rangees) * h];
  };
  const grille = Array.from({ length: colonnes + 1 }, (_, i) => Array.from({ length: rangees + 1 }, (_, j) => point(i, j)));
  const cases = Array.from({ length: colonnes * rangees }, (_, n) => [Math.floor(n / rangees), n % rangees]);
  return cases.flatMap(([i, j]) => {
    const [a, b, c, d] = [grille[i][j], grille[i + 1][j], grille[i + 1][j + 1], grille[i][j + 1]];
    return (i + j) % 2 === 0 ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
  });
}

// A card broken into triangles flying apart, in the frame of its group (so a face-down or Defense card breaks as it lies).
export class Eclats {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly repos: Float32Array;
  private readonly centres: THREE.Vector3[] = [];
  private readonly vitesses: THREE.Vector3[] = [];
  private readonly axes: THREE.Vector3[] = [];
  private readonly tours: number[] = [];
  private readonly gravite: THREE.Vector3;
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();

  constructor(groupe: THREE.Object3D, map: THREE.Texture | null, taille: { l: number; h: number; e: number }, colonnes = 3, rangees = 4) {
    const { l, h, e } = taille;
    const coins = decouper(l, h, colonnes, rangees);
    const sommets = coins.flatMap(([x, z]) => [x, e / 2, z]);
    // UV of the top face of BoxGeometry: u follows x, v goes down with z.
    const uvs = coins.flatMap(([x, z]) => [0.5 + x / l, 0.5 - z / h]);
    this.repos = new Float32Array(sommets);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sommets), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: new THREE.Color(1.15, 1.15, 1.15) }));
    this.mesh.renderOrder = 9;
    groupe.updateMatrixWorld();
    groupe.matrixWorld.decompose(this.mesh.position, this.mesh.quaternion, this.mesh.scale);
    // Gravity and "up" in the frame of the card.
    const inverse = this.mesh.quaternion.clone().invert();
    this.gravite = new THREE.Vector3(0, -5, 0).applyQuaternion(inverse);
    const haut = HAUT.clone().applyQuaternion(inverse);
    for (let t = 0; t < this.repos.length / 9; t++) {
      const centre = new THREE.Vector3();
      for (let k = 0; k < 3; k++) centre.add(this.p.fromArray(this.repos, t * 9 + k * 3));
      centre.divideScalar(3);
      this.centres.push(centre);
      const dehors = centre.clone().setComponent(1, 0).normalize();
      this.vitesses.push(dehors.multiplyScalar(0.8 + 1.4 * alea()).addScaledVector(haut, 1.2 + 1.6 * alea()));
      this.axes.push(new THREE.Vector3(alea() - 0.5, alea() - 0.5, alea() - 0.5).normalize());
      this.tours.push((alea() - 0.5) * 22);
    }
  }

  // Shards `t` seconds after the break.
  avancer(t: number) {
    const attribut = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const sortie = attribut.array as Float32Array;
    this.centres.forEach((centre, s) => {
      this.q.setFromAxisAngle(this.axes[s], this.tours[s] * t);
      for (let k = 0; k < 3; k++) {
        const o = s * 9 + k * 3;
        this.p.fromArray(this.repos, o).sub(centre).applyQuaternion(this.q).add(centre).addScaledVector(this.vitesses[s], t).addScaledVector(this.gravite, (t * t) / 2);
        this.p.toArray(sortie, o);
      }
    });
    attribut.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
