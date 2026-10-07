// The 3D board in plain three.js, ported from design/plateau-3d: Plateau3D.tsx mounts it on its canvas.
import { OcgLocation, OcgType } from "@n1xx1/ocgcore-wasm";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { Board } from "../board.ts";
import { has, type Cards } from "../cards.ts";
import { D1, D2, D3, D4, phase, prefersReduced } from "../motion.ts";
import { placeKey } from "../question.ts";
import { jouer as jouerSon } from "../son.ts";
import { horloge } from "./cadence.ts";
import { CARTE, pileId, PLATEAU, ZONE, zones, type CarteScene, type EtatScene, type PileScene, type Zone } from "./disposition.ts";
import type { Depart, Effet, Variation } from "./effets.ts";
import { construire, liberer, poser } from "./lancers.ts";
import { Eclats, Particules } from "./particules.ts";
import { FS_BALAYAGE, FS_CONE, FS_FAISCEAU, FS_HOLOGRAMME, FS_SOL, FS_SURBRILLANCE, VS_MONDE, VS_UV } from "./shaders.ts";
import type { Jeu } from "./spectacle.ts";
import { art, couleurCamp, dessinerDos, dessinerFace, dessinerFond, dessinerLueur, dessinerMaillon, dessinerNombre, dessinerPlateau, dessinerTranche, hdr, texture, TEX, toile, type Ressources } from "./textures.ts";

export type Qualite = "haute" | "basse";
type Etat = "choisie" | "survol" | "visee" | "attaquant" | "activee" | "cible";
type CarteM = CarteScene & { face: THREE.MeshStandardMaterial; mesh: THREE.Mesh; groupe: THREE.Group; libre: boolean; levee: number; saut: number; secousse: number; rotY: number; rotZ: number; echelle: number };
type ZoneM = Zone & { overlay: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; carte?: CarteM; pile?: THREE.Mesh; pileEtat?: string; etats: Set<Etat> };

const TANGAGE = THREE.MathUtils.degToRad(52);
// Tilt that turns a card lying on the board towards the camera.
const FACE_CAMERA = Math.PI / 2 - TANGAGE;
const DEFENSE = 0.8;
const HOLO_Y = 0.3;
const CIBLE = new THREE.Vector3(0, 0, 0.1);
const ZERO = new THREE.Vector3();
const HAUT = new THREE.Vector3(0, 1, 0);
const PRIORITE: Etat[] = ["choisie", "survol", "visee", "attaquant", "activee", "cible"];
const STYLES: Record<Etat, { couleur?: string; force: number; fond: number; pulse: number }> = {
  choisie: { couleur: "--or", force: 2.4, fond: 0.16, pulse: 0 },
  survol: { couleur: "--holo-2", force: 1.8, fond: 0.12, pulse: 0 },
  visee: { couleur: "--danger", force: 2.6, fond: 0.14, pulse: 1 },
  attaquant: { force: 2.2, fond: 0.1, pulse: 0 },
  activee: { force: 1.8, fond: 0.08, pulse: 0 },
  cible: { couleur: "--holo", force: 2, fond: 0.06, pulse: 1 },
};
const TERRAIN = { l: 2 * PLATEAU.l - 0.1, p: PLATEAU.p - 0.05, opacite: 0.72, gain: 1.2 };
// Below this gap a card or fade has arrived; at rest, shaders driven by time redraw at 20 frames per second.
const SEUIL = 1e-3;
const PAUSE_AMBIANT = 50;
const FIELD: ReadonlySet<string> = new Set(["terrain", "monstre", "magie"]);
const DEPARTS: Record<Depart, string> = { destruction: "--danger", sacrifice: "--or", materiau: "--type-fusion", bannissement: "--ombre-violet", main: "--holo-2", deck: "--holo", extra: "--holo" };
// Particles: capacity, and the share low quality keeps. Hit-stop of an attack (ms). Damage that shakes the most.
const PARTICULES = 480;
const PARTICULES_BASSE = 160;
const ARRET = 90;
const DEGATS_MAX = 3000;
const MAILLON = { l: 0.34, h: 0.37 };

const sortie = (k: number) => 1 - (1 - k) ** 4;
const elan = (k: number) => k ** 3;
// Overshoots then settles (--courbe-ressort).
const ressort = (k: number) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;
const uni = <T>(value: T) => ({ value });
const bouge = (...ecarts: number[]) => ecarts.some((ecart) => Math.abs(ecart) > SEUIL);
const puissanceDe = (degats: number) => Math.min(1, Math.max(0, degats) / DEGATS_MAX);

function geoCarte(epaisseur: number) {
  const g = new THREE.BoxGeometry(CARTE.l, epaisseur, CARTE.h);
  // Faces of BoxGeometry: +x, -x, +y, -y, +z, -z. Edge, front (top), back (bottom): 4 draw calls instead of 6.
  g.clearGroups();
  g.addGroup(0, 12, 0);
  g.addGroup(12, 6, 1);
  g.addGroup(18, 6, 2);
  g.addGroup(24, 12, 0);
  return g;
}

function matCarte(map: THREE.Texture) {
  return new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.3, roughness: 0.42, metalness: 0.05, alphaTest: 0.5 });
}

const temps = { value: 0 };

function effet(fragmentShader: string, uniforms: Record<string, { value: unknown }>, additif = true, vertexShader = VS_UV) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uTime: temps, ...uniforms },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additif ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

const additive = () => new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

export class Monde {
  readonly zones = new Map<string, ZoneM>();
  private readonly cibles: THREE.Object3D[] = [];
  private readonly faces = new Map<string, THREE.CanvasTexture>();
  private readonly arts = new Map<number, THREE.Texture>();
  // By link number minus one; a link off the field (hand, Graveyard) has none.
  private readonly maillons: (THREE.Sprite | undefined)[] = [];
  private cleChaine = "";
  // Half of the mat of each camp, dressed with the artwork of its Field Spell (fades in and out).
  private readonly terrains: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; code: number; vise: number }[] = [];
  private readonly lampes: THREE.PointLight[] = [];
  private readonly mat: { tranche: THREE.Material; tranchePile: THREE.Material; dos: THREE.MeshStandardMaterial };
  private readonly geo: { carte: THREE.BufferGeometry; zone: THREE.BufferGeometry };
  private readonly holo: { groupe: THREE.Group; plan: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; cone: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>; anneau: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> };
  private readonly fx: { tir: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; eclat: THREE.Sprite; onde: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; balayage: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> };
  private readonly particules = new Particules(PARTICULES);
  // Camera moves of the effects: sway, recoil and shake, and a point it closes in on (`vise`, `zoom`: share of the distance).
  private readonly decalage = { lacet: 0, tangage: 0, recul: 0, secousse: 0, zoom: 0, vise: new THREE.Vector3() };
  private composer: EffectComposer | null = null;
  private distance = 12;
  private holoZone: ZoneM | undefined;
  private survolee: ZoneM | undefined;
  private etatsQuestion = { cibles: new Set<string>(), choisies: new Set<string>() };
  // Everything the world adds to the scene, removed as a whole.
  private readonly racine = new THREE.Group();
  // On-demand rendering: the world asks for a frame (`invalider`) whenever something changes or moves, and none at rest.
  private readonly invalider: () => void;
  private readonly horloge: ReturnType<typeof horloge>;
  private tweens = 0;
  // Hit-stop: the particles hold still.
  private gel = false;
  private minuteur: ReturnType<typeof setTimeout> | undefined;
  private readonly rayon = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly visee = new THREE.Vector3();

  private readonly gl: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly res: Ressources;
  private readonly cards: Cards;
  private readonly seat: number;

  constructor(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, res: Ressources, cards: Cards, seat: number, rappels: { invalider: () => void; lent: () => void }) {
    this.gl = gl;
    this.scene = scene;
    this.camera = camera;
    this.res = res;
    this.cards = cards;
    this.seat = seat;
    this.invalider = rappels.invalider;
    this.horloge = horloge(rappels.lent);
    gl.toneMapping = THREE.NeutralToneMapping;
    // As in production builds: no reading of the compile logs (ANGLE warns about the FXAA shader).
    gl.debug.checkShaderErrors = false;
    scene.add(this.racine);
    this.racine.add(new THREE.HemisphereLight(0xc8d0ff, 0x2a1850, 1.3));
    const lune = new THREE.DirectionalLight(0xeef1ff, 2.2);
    lune.position.set(-3, 9, 5);
    this.racine.add(lune);
    for (const [camp, z] of [[0, 2.4], [1, -2.4]]) {
      const lampe = new THREE.PointLight(couleurCamp(camp, 1), 5, 6, 1.5);
      lampe.position.set(0, 1.4, z);
      this.racine.add(lampe);
      this.lampes.push(lampe);
    }
    this.geo = { carte: geoCarte(CARTE.e), zone: new THREE.PlaneGeometry(ZONE.l + 0.16, ZONE.p + 0.16).rotateX(-Math.PI / 2) };
    this.mat = { tranche: new THREE.MeshStandardMaterial({ color: 0x20264f, roughness: 0.6 }), tranchePile: new THREE.MeshStandardMaterial({ map: dessinerTranche(), roughness: 0.8 }), dos: matCarte(texture(dessinerDos())) };
    const liste = zones(seat);
    for (const zone of liste) this.creerZone(zone);
    this.construireDecor(liste);
    this.holo = this.construireHolo();
    this.fx = this.construireEffets();
    this.racine.add(this.particules.points);
    this.reveiller();
  }

  // Asks for one more frame: anything that changes the picture outside `frame` calls it.
  reveiller() {
    this.invalider();
  }

  private creerZone(zone: Zone) {
    const overlay = new THREE.Mesh(
      this.geo.zone,
      effet(FS_SURBRILLANCE, { uColor: uni(new THREE.Color()), uFill: uni(0), uPulse: uni(0), uSize: uni(new THREE.Vector2(ZONE.l + 0.16, ZONE.p + 0.16)), uDemi: uni(new THREE.Vector2(ZONE.l / 2, ZONE.p / 2)) }),
    );
    overlay.position.set(zone.x, 0.004, zone.z);
    overlay.visible = false;
    overlay.renderOrder = 2;
    overlay.userData.cle = zone.id;
    this.racine.add(overlay);
    this.cibles.push(overlay);
    this.zones.set(zone.id, { ...zone, overlay, etats: new Set() });
  }

  private construireDecor(liste: Zone[]) {
    // The mat in two layers, the Field Spell artworks (1.5) slide between them.
    for (const [couche, ordre] of [["fond", 1], ["traits", 1.7]] as const) {
      const tapis = new THREE.Mesh(
        new THREE.PlaneGeometry(2 * (PLATEAU.l + 0.25), 2 * (PLATEAU.p + 0.25)).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: dessinerPlateau(liste, this.res, this.gl.capabilities.getMaxAnisotropy(), couche), transparent: true, depthWrite: false, color: new THREE.Color(1.4, 1.4, 1.4) }),
      );
      tapis.renderOrder = ordre;
      this.racine.add(tapis);
    }
    for (const camp of [0, 1]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(TERRAIN.l, TERRAIN.p).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, color: new THREE.Color(TERRAIN.gain, TERRAIN.gain, TERRAIN.gain) }));
      mesh.position.set(0, 0.001, (camp === 0 ? 1 : -1) * (TERRAIN.p / 2));
      mesh.renderOrder = 1.5;
      mesh.visible = false;
      this.racine.add(mesh);
      this.terrains.push({ mesh, code: 0, vise: 0 });
    }
    const sol = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), effet(FS_SOL, { uColor: uni(hdr("--holo", 0.5)) }, true, VS_MONDE));
    sol.position.y = -0.03;
    this.racine.add(sol);
  }

  // Hologram a little smaller than the prototype's, so that it hides less of the opponent's row.
  private construireHolo() {
    const groupe = new THREE.Group();
    const plan = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 1.06), effet(FS_HOLOGRAMME, { map: uni(null), uColor: uni(new THREE.Color()), uReveal: uni(0), uOpacity: uni(1) }, false));
    plan.position.set(0, HOLO_Y + 0.53, -0.15);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.26, 1, 6, 1, true), effet(FS_CONE, { uColor: uni(new THREE.Color()), uOpacity: uni(0) }));
    cone.scale.y = HOLO_Y;
    cone.position.set(0, HOLO_Y / 2, -0.1);
    const anneau = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.4, 6).rotateX(-Math.PI / 2), additive());
    anneau.position.y = 0.02;
    plan.renderOrder = 6;
    cone.renderOrder = 5;
    anneau.renderOrder = 4;
    groupe.add(plan, cone, anneau);
    groupe.visible = false;
    this.racine.add(groupe);
    return { groupe, plan, cone, anneau };
  }

  private construireEffets() {
    const lueur = dessinerLueur();
    const tir = new THREE.Mesh(new THREE.BufferGeometry(), effet(FS_FAISCEAU, { uColor: uni(new THREE.Color()), uMode: uni(0), uProgress: uni(0), uOpacity: uni(1) }));
    const eclat = new THREE.Sprite(new THREE.SpriteMaterial({ map: lueur, blending: THREE.AdditiveBlending, depthWrite: false }));
    const onde = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 6).rotateX(-Math.PI / 2), additive());
    const balayage = new THREE.Mesh(new THREE.PlaneGeometry(2 * PLATEAU.l, 0.9).rotateX(-Math.PI / 2), effet(FS_BALAYAGE, { uColor: uni(new THREE.Color()), uOpacity: uni(0) }));
    balayage.position.y = 0.02;
    const fx = { tir, eclat, onde, balayage };
    Object.values(fx).forEach((objet, i) => {
      objet.visible = false;
      objet.renderOrder = 7 + i;
      this.racine.add(objet);
    });
    return fx;
  }

  // State of the board -------------------------------------------------------------------

  private texFace(code: number, voile: boolean, atk?: number, def?: number) {
    const cle = `${code}|${voile}|${atk}|${def}`;
    let tex = this.faces.get(cle);
    if (!tex) {
      const info = this.cards.get(code);
      const c = toile(TEX.l, TEX.h);
      dessinerFace(c, this.res, info, undefined, voile, atk, def);
      const made = texture(c);
      art(code, info).then((img) => {
        if (!img) return;
        dessinerFace(c, this.res, info, img, voile, atk, def);
        made.needsUpdate = true;
        this.reveiller();
      });
      this.faces.set(cle, made);
      tex = made;
    }
    return tex;
  }

  private poserCarte(zone: ZoneM, etat: CarteScene) {
    const face = etat.code ? matCarte(this.texFace(etat.code, etat.voile, etat.atk, etat.def)) : this.mat.dos.clone();
    const mesh = new THREE.Mesh(this.geo.carte, [this.mat.tranche, face, this.mat.dos]);
    mesh.userData.cle = zone.id;
    const groupe = new THREE.Group();
    groupe.add(mesh);
    this.racine.add(groupe);
    this.cibles.push(mesh);
    const flip = etat.cachee && !etat.voile ? Math.PI : 0;
    zone.carte = { ...etat, face, mesh, groupe, libre: false, levee: 0, saut: 0, secousse: 0, rotY: etat.defense ? Math.PI / 2 : 0, rotZ: flip, echelle: etat.defense ? DEFENSE : 1 };
    this.majCarte(zone, 1, 0);
    return zone.carte;
  }

  private retirerCarte(zone: ZoneM) {
    const carte = zone.carte;
    if (!carte) return;
    if (this.holoZone === zone) this.eteindre();
    this.racine.remove(carte.groupe);
    carte.face.dispose();
    this.cibles.splice(this.cibles.indexOf(carte.mesh), 1);
    zone.carte = undefined;
  }

  private majFace(carte: CarteM, etat: CarteScene) {
    if (carte.code === etat.code && carte.voile === etat.voile && carte.atk === etat.atk && carte.def === etat.def) return;
    const map = etat.code ? this.texFace(etat.code, etat.voile, etat.atk, etat.def) : this.mat.dos.map;
    carte.face.map = map;
    carte.face.emissiveMap = map;
    carte.face.needsUpdate = true;
  }

  private poserPile(zone: ZoneM, pile: PileScene | undefined) {
    const etat = pile ? `${pile.nombre}|${pile.code}` : "";
    if (zone.pileEtat === etat) return;
    zone.pileEtat = etat;
    if (zone.pile) {
      this.racine.remove(zone.pile);
      zone.pile.geometry.dispose();
      this.cibles.splice(this.cibles.indexOf(zone.pile), 1);
      zone.pile = undefined;
    }
    if (!pile?.nombre) return;
    const epaisseur = Math.min(pile.nombre, 60) * 0.0045;
    const dessus = pile.code ? matCarte(this.texFace(pile.code, false)) : this.mat.dos;
    const mesh = new THREE.Mesh(geoCarte(epaisseur), [this.mat.tranchePile, dessus, this.mat.dos]);
    mesh.position.set(zone.x, epaisseur / 2 + 0.003, zone.z);
    mesh.userData.cle = zone.id;
    this.racine.add(mesh);
    this.cibles.push(mesh);
    zone.pile = mesh;
  }

  // Brings the scene to the board shown: cards placed or removed, faces, poses, piles, chain links.
  sync(etat: EtatScene, chain: Board["chain"]) {
    this.reveiller();
    for (const zone of this.zones.values()) {
      if (!FIELD.has(zone.type)) {
        this.poserPile(zone, etat.piles.get(zone.id));
        continue;
      }
      const voulue = etat.cartes.get(zone.id);
      if (!voulue) this.retirerCarte(zone);
      else if (zone.carte) {
        this.majFace(zone.carte, voulue);
        Object.assign(zone.carte, voulue);
      } else this.poserCarte(zone, voulue);
    }
    this.syncTerrains(etat);
    this.syncChaine(chain);
  }

  private syncTerrains(etat: EtatScene) {
    for (const zone of this.zones.values()) {
      if (zone.type !== "terrain") continue;
      const carte = etat.cartes.get(zone.id);
      void this.habillerTerrain(zone.camp, carte && !carte.cachee ? carte.code : 0);
    }
  }

  private async habillerTerrain(camp: number, code: number) {
    const terrain = this.terrains[camp];
    if (terrain.code === code) return;
    terrain.code = code;
    const img = code ? await art(code, this.cards.get(code)) : undefined;
    if (terrain.code !== code) return;
    terrain.vise = img ? TERRAIN.opacite : 0;
    this.reveiller();
    if (!img) return;
    // Cover-crop the artwork to the half mat, anchored low: dark artworks (Yami) keep their light part at the bottom.
    const map = this.texArt(code, img);
    const [a, p] = [img.width / img.height, TERRAIN.l / TERRAIN.p];
    map.repeat.set(Math.min(1, p / a), Math.min(1, a / p));
    map.offset.set((1 - map.repeat.x) / 2, (1 - map.repeat.y) * 0.15);
    terrain.mesh.material.map = map;
    terrain.mesh.material.needsUpdate = true;
  }

  // Chain links: numbered hexagons on the corner of their card, rebuilt only when the chain changes.
  private syncChaine(chain: Board["chain"]) {
    const cle = chain.map((link) => placeKey(link)).join(",");
    if (cle === this.cleChaine) return;
    this.cleChaine = cle;
    for (const sprite of this.maillons.splice(0)) {
      if (!sprite) continue;
      this.racine.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    for (const zone of this.zones.values()) zone.etats.delete("activee");
    chain.forEach((link, i) => {
      const zone = this.zones.get(placeKey(link));
      if (!zone) return;
      zone.etats.add("activee");
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dessinerMaillon(i + 1, zone.camp), depthTest: false }));
      sprite.scale.set(MAILLON.l, MAILLON.h, 1);
      sprite.position.set(zone.x + 0.3, 0.25, zone.z - 0.43);
      sprite.renderOrder = 20;
      sprite.userData.cle = zone.id;
      this.racine.add(sprite);
      this.maillons[i] = sprite;
    });
    this.majEtats();
  }

  // Zones the current question lets the player click, and the ones picked.
  question(cibles: Set<string>, choisies: Set<string>) {
    this.etatsQuestion = { cibles, choisies };
    this.majEtats();
  }

  private majEtats() {
    for (const zone of this.zones.values()) {
      zone.etats.delete("cible");
      zone.etats.delete("choisie");
      if (this.etatsQuestion.cibles.has(zone.id)) zone.etats.add("cible");
      if (this.etatsQuestion.choisies.has(zone.id)) zone.etats.add("choisie");
      this.majZone(zone);
    }
  }

  private majZone(zone: ZoneM) {
    this.reveiller();
    const etat = PRIORITE.find((e) => zone.etats.has(e));
    zone.overlay.visible = Boolean(etat);
    if (!etat) return;
    const style = STYLES[etat];
    const uniforms = zone.overlay.material.uniforms;
    uniforms.uColor.value.copy(style.couleur ? hdr(style.couleur, style.force) : couleurCamp(zone.camp, style.force));
    uniforms.uFill.value = style.fond;
    uniforms.uPulse.value = style.pulse;
  }

  private marquer(zone: ZoneM | undefined, etat: Etat, oui: boolean) {
    if (!zone) return;
    if (oui) zone.etats.add(etat);
    else zone.etats.delete(etat);
    this.majZone(zone);
  }

  survol(id: string | undefined) {
    const zone = id ? this.zones.get(id) : undefined;
    if (zone === this.survolee) return;
    this.marquer(this.survolee, "survol", false);
    this.survolee = zone;
    this.marquer(zone, "survol", true);
  }

  // The zone under the pointer (normalized device coordinates).
  toucher(x: number, y: number): string | undefined {
    this.rayon.setFromCamera(this.ndc.set(x, y), this.camera);
    return this.rayon.intersectObjects(this.cibles, false)[0]?.object.userData.cle;
  }

  // Effects ---------------------------------------------------------------------------------

  jouer(effet: Effet, jeu: Jeu): Promise<void> {
    this.reveiller();
    // A tween redraws at each of its steps and counts as motion; the effect may leave the scene changed at its end.
    const tween: Jeu["tween"] = (duree, update, fondu) => {
      this.tweens++;
      return jeu
        .tween(
          duree,
          (k) => {
            update(k);
            this.reveiller();
          },
          fondu,
        )
        .finally(() => this.tweens--);
    };
    return this.lancer(effet, { ...jeu, tween }).finally(() => this.reveiller());
  }

  private lancer(effet: Effet, jeu: Jeu): Promise<void> {
    switch (effet.type) {
      case "pioche":
        return this.pioche(effet.joueur, effet.nombre, jeu);
      case "entree":
        return this.entree(this.zones.get(effet.cle), effet.depuis, jeu);
      case "invocation":
        return this.invocation(this.zones.get(effet.cle), effet.code, effet.genre, jeu);
      case "pose":
        return this.onde(this.zones.get(effet.cle), 0.5, jeu);
      case "position":
        return this.sauter(this.zones.get(effet.cle), jeu);
      case "melange":
        return Promise.all(effet.cles.map((cle) => this.sauter(this.zones.get(cle), jeu))).then(() => undefined);
      case "depart":
        return this.depart(this.zones.get(effet.cle), effet.genre, effet.vers ? this.zones.get(effet.vers) : undefined, jeu);
      case "attaque":
        return this.attaque(this.zones.get(effet.de), effet.vers ? this.zones.get(effet.vers) : undefined, jeu);
      case "combat":
        return this.combat(this.zones.get(effet.de), effet.vers ? this.zones.get(effet.vers) : undefined, effet.degats, jeu);
      case "lp":
        return this.pointsDeVie(effet.joueur === this.seat ? 0 : 1, effet.delta, effet.choc === true, jeu);
      case "activation":
        return this.activation(this.zones.get(effet.cle), effet.maillon, jeu);
      case "resolution":
        return this.resolution(effet.maillon, effet.annule, jeu);
      case "tour":
        return this.tour(effet.joueur === this.seat ? 0 : 1, jeu);
      case "stats":
        return this.eclatStats(effet.cartes, jeu);
      case "de":
      case "piece":
        return this.jeter(effet, jeu);
      default:
        return Promise.resolve();
    }
  }

  // The hand of a camp in the scene: bottom of the screen, top for the opponent.
  private pointMain(camp: number) {
    this.rayon.setFromCamera(this.ndc.set(0, camp === 0 ? -0.9 : 0.95), this.camera);
    return this.rayon.ray.at(camp === 0 ? 4.5 : 9, new THREE.Vector3());
  }

  // How hard a card lands: a set card softly, a monster by its Level.
  private poids(carte: CarteM) {
    if (carte.cachee) return 0.4;
    const niveau = this.cards.get(carte.code)?.level ?? 0;
    if (niveau >= 7) return 1.25;
    if (niveau >= 5) return 1;
    return 0.7;
  }

  // The card leaves the hand (or its pile) in an arc, turns over on the way, hangs an instant and slams onto its zone.
  private async entree(zone: ZoneM | undefined, depuis: string | undefined, jeu: Jeu) {
    const carte = zone?.carte;
    if (!zone || !carte) return;
    if (jeu.reduced) {
      await this.fondu(carte, 0, 1, jeu);
      return;
    }
    carte.libre = true;
    const pile = depuis ? this.zones.get(depuis) : undefined;
    const depart = pile ? new THREE.Vector3(pile.x, 0.1, pile.z) : this.pointMain(zone.camp);
    const pose = this.pose(carte);
    const poids = this.poids(carte);
    const haut = new THREE.Vector3(zone.x, 0.7 + 0.35 * poids, zone.z + (zone.camp === 0 ? 0.3 : -0.3));
    const courbe = new THREE.QuadraticBezierCurve3(depart, depart.clone().lerp(haut, 0.5).setY(Math.max(depart.y, haut.y) + 0.5), haut);
    const inclinaison = pile || zone.camp !== 0 ? 0 : FACE_CAMERA;
    const g = carte.groupe;
    const vol = (k: number) => {
      const e = sortie(phase(k, 0, 0.8));
      g.position.copy(courbe.getPoint(e));
      g.position.y += 0.08 * Math.sin(Math.PI * phase(k, 0.8, 1));
      // Back up at first: a face-up card shows its face as it turns over, a face-down one stays down.
      g.rotation.set(inclinaison * (1 - e) + 0.35 * e, pose.rotY * e, Math.PI + (pose.rotZ - Math.PI) * e);
      g.scale.setScalar(pose.echelle * (1 + 0.12 * e));
    };
    vol(0);
    await jeu.tween(D3 + D2, vol);
    const au = g.position.clone();
    const sol = new THREE.Vector3(zone.x, pose.y, zone.z);
    await jeu.tween(D1 + 40, (k) => {
      const e = elan(k);
      g.position.lerpVectors(au, sol, e);
      g.rotation.set(0.35 * (1 - e), pose.rotY, pose.rotZ);
      g.scale.setScalar(pose.echelle * (1 + 0.12 * (1 - e)));
    });
    carte.libre = false;
    this.atterrir(zone, poids);
    await this.onde(zone, 0.5 + 0.5 * poids, jeu);
  }

  // A card lands: a thud, dust along the board, a shake as heavy as the card.
  private atterrir(zone: ZoneM, poids: number) {
    jouerSon("atterrissage");
    this.decalage.secousse = Math.max(this.decalage.secousse, 0.01 + 0.035 * poids * poids);
    this.particules.emettre({
      nombre: 14 + 26 * poids,
      origine: new THREE.Vector3(zone.x, 0.03, zone.z),
      rayon: 0.4,
      plat: true,
      vitesse: [0.5, 0.6 + 1.3 * poids],
      taille: [0.1, 0.22],
      vie: [0.5, 0.9],
      couleur: couleurCamp(zone.camp, 0.7),
      freinage: 3.5,
      gravite: 0.2,
    });
  }

  // Only the monster that acts projects itself, then comes down. A Fusion Monster comes out of a flash of the vortex.
  private async invocation(zone: ZoneM | undefined, code: number, genre: "normale" | "fusion" | "dieu", jeu: Jeu) {
    if (!zone) return;
    if (genre === "dieu") {
      await this.dieu(zone, code, jeu);
      return;
    }
    if (genre === "fusion") {
      this.gerbe(zone, "--type-fusion", 60, jeu);
      await this.eclat(zone, "--type-fusion", jeu);
    }
    await this.projeter(zone, code, 1, jeu);
    await jeu.tenir(400);
    await this.baisser(jeu);
  }

  // Sparks rising from a zone.
  private gerbe(zone: ZoneM, couleur: string, nombre: number, jeu: Jeu) {
    if (jeu.reduced) return;
    this.particules.emettre({ nombre, origine: new THREE.Vector3(zone.x, 0.05, zone.z), rayon: 0.45, plat: true, direction: HAUT, ecart: 0.3, vitesse: [0.8, 2.2], taille: [0.04, 0.1], vie: [0.7, 1.3], couleur: hdr(couleur, 2), freinage: 0.9 });
  }

  // Egyptian God: the camera closes in, the lamp of the camp turns gold, sparks rise, a heavy shake and a giant hologram.
  private async dieu(zone: ZoneM, code: number, jeu: Jeu) {
    if (jeu.reduced) {
      await this.projeter(zone, code, 1.8, jeu);
      await jeu.pause(D4 + 1000, true);
      await this.baisser(jeu);
      return;
    }
    const lampe = this.lampes[zone.camp];
    const [teinte, intensite] = [lampe.color.clone(), lampe.intensity];
    const or = hdr("--attr-divin", 1);
    const vise = new THREE.Vector3(zone.x * 0.6, 0.3, zone.z * 0.6);
    const approche = (e: number) => {
      this.decalage.vise.lerpVectors(ZERO, vise, e);
      this.decalage.zoom = 0.22 * e;
      lampe.color.copy(teinte).lerp(or, e);
      lampe.intensity = intensite * (1 + 3 * e);
    };
    await jeu.tween(D4, (k) => approche(sortie(k)));
    this.gerbe(zone, "--attr-divin", 90, jeu);
    this.decalage.secousse = 0.1;
    jouerSon("impact");
    await Promise.all([this.eclat(zone, "--attr-divin", jeu), this.projeter(zone, code, 1.8, jeu)]);
    await jeu.pause(1000, true);
    await Promise.all([this.baisser(jeu), jeu.tween(D3, (k) => approche(1 - sortie(k)))]);
  }

  private texArt(code: number, img: HTMLImageElement | undefined) {
    if (!img) return this.texFace(code, false);
    let tex = this.arts.get(code);
    if (!tex) {
      tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      this.arts.set(code, tex);
    }
    return tex;
  }

  private async projeter(zone: ZoneM, code: number, taille: number, jeu: Jeu) {
    const img = await art(code, this.cards.get(code));
    const { groupe, plan, cone, anneau } = this.holo;
    this.holoZone = zone;
    plan.material.uniforms.map.value = this.texArt(code, img);
    plan.material.uniforms.uColor.value.copy(couleurCamp(zone.camp, 1.3));
    cone.material.uniforms.uColor.value.copy(couleurCamp(zone.camp, 1.3));
    anneau.material.color.copy(couleurCamp(zone.camp, 2.5));
    groupe.position.set(zone.x, 0, zone.z);
    groupe.scale.setScalar(taille);
    groupe.visible = true;
    anneau.visible = !jeu.reduced;
    const opacite = plan.material.uniforms.uOpacity;
    await jeu.tween(taille > 1 ? D4 : D2, (k) => {
      const e = sortie(k);
      plan.material.uniforms.uReveal.value = jeu.reduced ? 1.06 : e * 1.06;
      opacite.value = jeu.reduced ? k : 1;
      cone.material.uniforms.uOpacity.value = e;
      anneau.scale.setScalar(0.7 + 2 * e);
      anneau.material.opacity = 1 - k;
    }, true);
    anneau.visible = false;
  }

  private async baisser(jeu: Jeu) {
    const { plan, cone } = this.holo;
    if (!this.holoZone) return;
    await jeu.tween(D2, (k) => {
      const e = elan(k);
      if (jeu.reduced) plan.material.uniforms.uOpacity.value = 1 - k;
      else plan.material.uniforms.uReveal.value = 1.06 * (1 - e);
      cone.material.uniforms.uOpacity.value = 1 - e;
    }, true);
    this.eteindre();
  }

  private eteindre() {
    this.holoZone = undefined;
    this.holo.groupe.visible = false;
    this.holo.plan.material.uniforms.uOpacity.value = 1;
  }

  private async sauter(zone: ZoneM | undefined, jeu: Jeu) {
    if (!zone?.carte) return;
    zone.carte.saut = 1;
    await jeu.pause(D3);
  }

  private async onde(zone: ZoneM | undefined, force: number, jeu: Jeu, couleur?: string) {
    if (!zone || jeu.reduced) return;
    const { onde } = this.fx;
    onde.position.set(zone.x, 0.02, zone.z);
    onde.material.color.copy(couleur ? hdr(couleur, 2.5 * force) : couleurCamp(zone.camp, 2.5 * force));
    onde.visible = true;
    await jeu.tween(D3, (k) => {
      onde.scale.setScalar(1 + 1.6 * sortie(k));
      onde.material.opacity = 1 - k;
    });
    onde.visible = false;
  }

  private async eclat(zone: ZoneM, couleur: string, jeu: Jeu) {
    if (jeu.reduced) return;
    const { eclat } = this.fx;
    eclat.position.set(zone.x, 0.14, zone.z);
    eclat.material.color.copy(hdr(couleur, 3));
    eclat.visible = true;
    await Promise.all([
      this.onde(zone, 1, jeu, couleur),
      jeu.tween(D3, (k) => {
        eclat.scale.setScalar(0.4 + 2.4 * sortie(k));
        eclat.material.opacity = 1 - k;
      }),
    ]);
    eclat.visible = false;
  }

  // Destroyed: the card breaks into shards; tribute: dissolves into light drawn to the monster summoned; material: sucked
  // into the vortex of the Fusion; banished: spins up and fades away; back to the hand or a Deck: flies there.
  private async depart(zone: ZoneM | undefined, genre: Depart, vers: ZoneM | undefined, jeu: Jeu) {
    const carte = zone?.carte;
    if (!zone || !carte) return;
    if (jeu.reduced) await this.fondu(carte, 1, 0, jeu);
    else if (genre === "destruction") await this.briser(zone, carte, jeu);
    else {
      carte.libre = true;
      const vol = this.vol(zone, carte, genre, vers);
      const duree = genre === "materiau" ? D4 : D3;
      await Promise.all([this.eclat(zone, DEPARTS[genre], jeu), jeu.tween(duree, (k) => vol(elan(k), k)), genre === "bannissement" && this.fondu(carte, 1, 0, jeu, D3)]);
    }
    this.retirerCarte(zone);
  }

  private vol(zone: ZoneM, carte: CarteM, genre: Depart, vers: ZoneM | undefined) {
    switch (genre) {
      case "sacrifice":
        return this.aspirer(carte, vers);
      case "materiau":
        return this.tourbillon(carte, vers);
      case "bannissement":
        return this.bannir(zone, carte);
      case "main":
        return this.rentrer(zone, carte);
      case "deck":
        return this.voler(zone, carte, OcgLocation.DECK, 0);
      case "extra":
        return this.voler(zone, carte, OcgLocation.EXTRA, 0);
      default:
        return this.voler(zone, carte, OcgLocation.GRAVE, 2);
    }
  }

  // Flight to a pile of the owner, turning `tours` radians on the way.
  private voler(zone: ZoneM, carte: CarteM, pile: OcgLocation, tours: number) {
    const pose = this.pose(carte);
    const arrivee = this.zones.get(pileId(zone.joueur, pile)) ?? zone;
    const depuis = carte.groupe.position.clone();
    const vers = new THREE.Vector3();
    return (e: number, k: number) => {
      carte.groupe.position.lerpVectors(depuis, vers.set(arrivee.x, 0.3 + 0.4 * Math.sin(Math.PI * k), arrivee.z), e);
      carte.groupe.rotation.set(0, pose.rotY + e * tours, pose.rotZ);
      carte.groupe.scale.setScalar(pose.echelle * (1 - 0.7 * e));
    };
  }

  // Destroyed: a flash, the card breaks into shards that fly and fall, sparks, then a trail of light to the Graveyard.
  private async briser(zone: ZoneM, carte: CarteM, jeu: Jeu) {
    // The side seen from above: the back for a face-down card.
    const map = Math.cos(carte.groupe.rotation.z) < 0 ? this.mat.dos.map : carte.face.map;
    const eclats = new Eclats(carte.groupe, map, CARTE);
    this.racine.add(eclats.mesh);
    carte.groupe.visible = false;
    const centre = new THREE.Vector3(zone.x, 0.15, zone.z);
    this.particules.emettre({ nombre: 40, origine: centre, direction: HAUT, ecart: 1, vitesse: [1.5, 3.5], gravite: 4, freinage: 1, vie: [0.3, 0.6], taille: [0.03, 0.06], couleur: hdr("--danger", 2.5) });
    const cimetiere = this.zones.get(pileId(zone.joueur, OcgLocation.GRAVE));
    let envoyee = false;
    const duree = D3 + D2;
    await Promise.all([
      this.eclat(zone, "--danger", jeu),
      jeu.tween(duree, (k) => {
        eclats.avancer((k * duree) / 1000);
        eclats.mesh.material.opacity = 1 - phase(k, 0.5, 1);
        if (envoyee || k < 0.35 || !cimetiere) return;
        envoyee = true;
        const vers = new THREE.Vector3(cimetiere.x, 0.1, cimetiere.z);
        this.particules.emettre({ nombre: 18, origine: centre, rayon: 0.3, vitesse: [0.3, 0.8], vie: [0.9, 1.4], taille: [0.05, 0.1], couleur: hdr("--danger", 1.6), vers, attraction: 10 });
      }),
    ]);
    eclats.dispose();
  }

  // Banished: the card rises, spins up and drifts halfway to the Graveyard while it fades (see `depart`).
  private bannir(zone: ZoneM, carte: CarteM) {
    const pose = this.pose(carte);
    const cimetiere = this.zones.get(pileId(zone.joueur, OcgLocation.GRAVE)) ?? zone;
    const depuis = carte.groupe.position.clone();
    return (e: number) => {
      carte.groupe.position.set(depuis.x + (cimetiere.x - depuis.x) * e * 0.5, depuis.y + e * 0.6, depuis.z + (cimetiere.z - depuis.z) * e * 0.5);
      carte.groupe.rotation.set(0, pose.rotY + e * 8, pose.rotZ);
      carte.groupe.scale.setScalar(pose.echelle * (1 - e));
    };
  }

  // Back to the hand: the way of `entree` in reverse, the card tilts to the screen and shrinks.
  private rentrer(zone: ZoneM, carte: CarteM) {
    const pose = this.pose(carte);
    const depuis = carte.groupe.position.clone();
    const main = this.pointMain(zone.camp);
    const courbe = new THREE.QuadraticBezierCurve3(depuis, depuis.clone().lerp(main, 0.5).setY(Math.max(depuis.y, main.y) + 0.4), main);
    const inclinaison = zone.camp === 0 ? FACE_CAMERA : 0;
    return (e: number) => {
      carte.groupe.position.copy(courbe.getPoint(e));
      carte.groupe.rotation.set(inclinaison * e, pose.rotY, pose.rotZ);
      carte.groupe.scale.setScalar(pose.echelle * (1 - 0.3 * e));
    };
  }

  // A flare on the changed ATK (left of the card) and DEF (right): green for a rise, red for a drop.
  private async eclatStats(cartes: Variation[], jeu: Jeu) {
    if (jeu.reduced) return;
    const eclats: THREE.Sprite[] = [];
    for (const { cle, atk, def } of cartes) {
      const groupe = this.zones.get(cle)?.carte?.groupe;
      if (!groupe) continue;
      for (const [delta, cote] of [[atk, -1], [def, 1]]) {
        if (!delta) continue;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.fx.eclat.material.map, color: hdr(delta > 0 ? "--succes" : "--danger", 2.5), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
        sprite.position.set(cote * CARTE.l * 0.3, 0.04, CARTE.h * 0.44);
        sprite.renderOrder = 12;
        groupe.add(sprite);
        eclats.push(sprite);
      }
    }
    await jeu.tween(D3, (k) => {
      for (const sprite of eclats) {
        sprite.scale.setScalar(0.15 + 0.3 * sortie(k));
        sprite.material.opacity = Math.sin(Math.PI * k);
      }
    });
    for (const sprite of eclats) {
      sprite.removeFromParent();
      sprite.material.dispose();
    }
  }

  // A tribute rises and dissolves into golden light, drawn to the zone of the monster about to be summoned.
  private aspirer(carte: CarteM, vers: ZoneM | undefined) {
    const pose = this.pose(carte);
    const depuis = carte.groupe.position.clone();
    const arrivee = vers ? new THREE.Vector3(vers.x, 0.45, vers.z) : depuis.clone().setY(depuis.y + 0.9);
    this.particules.emettre({ nombre: 40, origine: depuis, rayon: 0.35, direction: HAUT, ecart: 0.6, vitesse: [0.4, 1], vie: [0.9, 1.5], taille: [0.05, 0.11], couleur: hdr("--or", 2), vers: arrivee, attraction: vers ? 7 : 0, freinage: 1.5 });
    return (e: number) => {
      carte.groupe.position.lerpVectors(depuis, arrivee, e * 0.6).setY(depuis.y + 0.9 * e);
      carte.groupe.rotation.set(0, pose.rotY + e * 3, pose.rotZ);
      carte.groupe.scale.setScalar(pose.echelle * (1 - e));
      carte.face.emissiveIntensity = 0.3 + 2 * e;
    };
  }

  // A Fusion Material spirals into the vortex over the zone of the Fusion Monster, violet sparks swirling with it.
  private tourbillon(carte: CarteM, vers: ZoneM | undefined) {
    const pose = this.pose(carte);
    const depuis = carte.groupe.position.clone();
    const centre = vers ? new THREE.Vector3(vers.x, 0.5, vers.z) : new THREE.Vector3(0, 0.5, 0);
    const rayon = Math.hypot(depuis.x - centre.x, depuis.z - centre.z);
    const angle = Math.atan2(depuis.z - centre.z, depuis.x - centre.x);
    this.particules.emettre({ nombre: 50, origine: centre, rayon: Math.max(0.4, rayon * 0.6), plat: true, vitesse: [0.2, 0.6], vie: [0.9, 1.5], taille: [0.05, 0.1], couleur: hdr("--type-fusion", 2.2), vers: centre, attraction: 2.5, tourbillon: 6, freinage: 0.8 });
    return (e: number, k: number) => {
      const r = rayon * (1 - e);
      const a = angle + k * Math.PI * 3;
      carte.groupe.position.set(centre.x + Math.cos(a) * r, depuis.y + (centre.y - depuis.y) * Math.sin((Math.PI / 2) * k), centre.z + Math.sin(a) * r);
      carte.groupe.rotation.set(0, pose.rotY + k * 8, pose.rotZ);
      carte.groupe.scale.setScalar(pose.echelle * (1 - 0.8 * e));
      carte.face.emissiveIntensity = 0.3 + 1.5 * e;
    };
  }

  // The card fades in or out: its materials become transparent for the time of the fade.
  private async fondu(carte: CarteM, de: number, a: number, jeu: Jeu, duree = D2) {
    const originaux = carte.mesh.material;
    const clones = (originaux as THREE.Material[]).map((m) => Object.assign(m.clone(), { transparent: true, alphaTest: 0 }));
    carte.mesh.material = clones;
    await jeu.tween(duree, (k) => {
      for (const m of clones) m.opacity = de + (a - de) * k;
    }, true);
    carte.mesh.material = originaux;
    for (const m of clones) m.dispose();
  }

  // Where an attack hits: the target's zone, or the opponent's edge of the board for a direct attack.
  private pointVise(de: ZoneM, vers: ZoneM | undefined) {
    if (vers) return new THREE.Vector3(vers.x, 0.06, vers.z);
    return new THREE.Vector3(de.x * 0.4, 0.3, (de.camp === 0 ? -1 : 1) * (PLATEAU.p + 0.2));
  }

  // Attack declared: the attacker rises and leans towards its target, a dashed line joins them, then it settles back.
  private async attaque(de: ZoneM | undefined, vers: ZoneM | undefined, jeu: Jeu) {
    const carte = de?.carte;
    if (!de || !carte) return;
    this.marquer(de, "attaquant", true);
    this.marquer(vers, "visee", true);
    const point = this.pointVise(de, vers);
    const depart = new THREE.Vector3(de.x, 0.4, de.z);
    const sommet = depart.clone().lerp(point, 0.5).setY(1.2);
    // Curve offset to one side, readable when the attack follows the axis of the camera.
    sommet.x += de.x <= point.x ? -0.6 : 0.6;
    const { tir } = this.fx;
    tir.geometry.dispose();
    tir.geometry = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(depart, sommet, point), 48, 0.03, 6);
    tir.material.uniforms.uColor.value.copy(couleurCamp(de.camp, 2.5));
    tir.visible = true;
    const pose = this.pose(carte);
    const dir = new THREE.Vector3(point.x - de.x, 0, point.z - de.z).normalize();
    carte.libre = !jeu.reduced;
    const lever = (e: number) => {
      tir.material.uniforms.uOpacity.value = e;
      if (jeu.reduced) return;
      carte.groupe.position.set(de.x - dir.x * 0.12 * e, pose.y + 0.35 * e, de.z - dir.z * 0.12 * e);
      carte.groupe.rotation.set(0.45 * e, pose.rotY, pose.rotZ - dir.x * 0.25 * e);
    };
    await jeu.tween(D3, (k) => lever(sortie(k)), true);
    await jeu.tenir(350);
    await jeu.tween(D2, (k) => lever(1 - k), true);
    tir.visible = false;
    carte.libre = false;
    this.marquer(de, "attaquant", false);
    this.marquer(vers, "visee", false);
  }

  // Damage calculation: the attacker winds up, charges, hits (flash, hit-stop, sparks, a shake as strong as the damage)
  // and comes back; on a direct attack the camera goes along to the opponent's side.
  private async combat(de: ZoneM | undefined, vers: ZoneM | undefined, degats: number, jeu: Jeu) {
    const carte = de?.carte;
    if (!de || !carte || jeu.reduced) return;
    this.marquer(de, "attaquant", true);
    this.marquer(vers, "visee", true);
    carte.libre = true;
    const g = carte.groupe;
    const pose = this.pose(carte);
    const point = this.pointVise(de, vers);
    const dir = new THREE.Vector3(point.x - de.x, 0, point.z - de.z).normalize();
    const place = new THREE.Vector3(de.x, pose.y, de.z);
    const recul = new THREE.Vector3(de.x - dir.x * 0.35, 0.55, de.z - dir.z * 0.35);
    const contact = point.clone().addScaledVector(dir, -0.25).setY(vers ? 0.2 : 0.45);
    const roulis = -dir.x * 0.3;
    // Nose down onto the target at the end of the charge.
    const pique = de.camp === 0 ? -0.35 : 0.9;
    const suivre = vers ? undefined : new THREE.Vector3(point.x * 0.5, 0, point.z * 0.45);
    const camera = (e: number) => {
      if (!suivre) return;
      this.decalage.vise.lerpVectors(ZERO, suivre, e);
      this.decalage.zoom = 0.14 * e;
    };
    await jeu.tween(D2 + 60, (k) => {
      const e = sortie(k);
      g.position.lerpVectors(place, recul, e);
      g.rotation.set(0.5 * e, pose.rotY, pose.rotZ + roulis * e);
      g.scale.setScalar(pose.echelle * (1 + 0.15 * e));
      camera(0.3 * e);
    });
    const couleur = couleurCamp(de.camp, 1.8);
    await jeu.tween(D2, (k) => {
      const e = elan(k);
      g.position.lerpVectors(recul, contact, e);
      g.rotation.set(0.5 + (pique - 0.5) * e, pose.rotY, pose.rotZ + roulis);
      camera(0.3 + 0.7 * sortie(k));
      this.particules.emettre({ nombre: 3, origine: g.position, rayon: 0.12, vitesse: [0.05, 0.25], vie: [0.2, 0.35], taille: [0.05, 0.1], couleur });
    });
    await this.frapper(contact, dir, vers, puissanceDe(degats), jeu);
    const choc = g.position.clone();
    await jeu.tween(D3, (k) => {
      const e = sortie(k);
      g.position.lerpVectors(choc, place, e);
      g.position.y += 0.35 * Math.sin(Math.PI * e);
      g.rotation.set(pique * (1 - e), pose.rotY, pose.rotZ + roulis * (1 - e));
      g.scale.setScalar(pose.echelle * (1 + 0.15 * (1 - e)));
      camera(1 - e);
    });
    carte.libre = false;
    this.marquer(de, "attaquant", false);
    this.marquer(vers, "visee", false);
  }

  // The hit: a white flash, the picture holds an instant, then sparks, a shock wave and a shake.
  private async frapper(point: THREE.Vector3, dir: THREE.Vector3, vers: ZoneM | undefined, puissance: number, jeu: Jeu) {
    const { eclat, onde } = this.fx;
    jouerSon("impact");
    eclat.position.copy(point);
    eclat.material.color.copy(hdr("--or-2", 4));
    eclat.material.opacity = 1;
    eclat.scale.setScalar(1.2 + 1.4 * puissance);
    eclat.visible = true;
    this.gel = true;
    await jeu.pause(ARRET);
    this.gel = false;
    this.particules.emettre({ nombre: 30 + 50 * puissance, origine: point, direction: dir.clone().negate().setY(0.9).normalize(), ecart: 0.9, vitesse: [1.5, 3.5 + 2 * puissance], gravite: 5, freinage: 1.2, vie: [0.25, 0.6], taille: [0.025, 0.06], couleur: hdr("--or-2", 3) });
    onde.position.copy(point).setY(0.02);
    onde.material.color.copy(hdr("--danger", 2.5));
    onde.visible = true;
    if (vers?.carte) vers.carte.secousse = 1;
    const secousse = 0.02 + 0.08 * puissance;
    await jeu.tween(D4 * 0.6, (k) => {
      const e = sortie(k);
      eclat.scale.setScalar((1.2 + 1.4 * puissance) * (1 + e));
      eclat.material.opacity = 1 - k;
      onde.scale.setScalar(1 + (2 + puissance) * e);
      onde.material.opacity = 1 - k;
      this.decalage.secousse = secousse * (1 - k);
    });
    eclat.visible = false;
    onde.visible = false;
  }

  // Activation: the card rises towards the camera, turns face up, grows and glows in the color of its type, then goes back.
  private async activation(zone: ZoneM | undefined, maillon: number, jeu: Jeu) {
    const carte = zone?.carte;
    if (!zone || !carte || jeu.reduced) return;
    carte.libre = true;
    const g = carte.groupe;
    const pose = this.pose(carte);
    const depuis = g.position.clone();
    const [rotY, rotZ] = [g.rotation.y, g.rotation.z];
    const devant = new THREE.Vector3(depuis.x * 0.35, depuis.y, depuis.z * 0.5).lerp(this.camera.position, 0.4);
    const { eclat } = this.fx;
    const info = this.cards.get(carte.code);
    let teinte = couleurCamp(zone.camp, 2);
    if (has(info?.type ?? 0, OcgType.SPELL)) teinte = hdr("--type-magie", 2.2);
    else if (has(info?.type ?? 0, OcgType.TRAP)) teinte = hdr("--type-piege", 2.2);
    eclat.material.color.copy(teinte);
    eclat.visible = true;
    const lever = (e: number) => {
      g.position.lerpVectors(depuis, devant, e);
      g.rotation.set(FACE_CAMERA * e, rotY * (1 - e), rotZ + (pose.rotZ - rotZ) * Math.min(1, e * 1.5));
      g.scale.setScalar(pose.echelle + (1.3 - pose.echelle) * e);
      carte.face.emissiveIntensity = 0.3 + 0.9 * e;
      eclat.position.copy(g.position).addScaledVector(this.tmp.subVectors(g.position, this.camera.position).normalize(), 0.05);
      eclat.scale.setScalar(1.6 * e);
      eclat.material.opacity = 0.8 * e;
    };
    lever(0);
    await Promise.all([jeu.tween(D3, (k) => lever(sortie(k))), this.onde(zone, 1, jeu), this.gonflerMaillon(maillon, jeu)]);
    await jeu.tenir(350);
    await jeu.tween(D3, (k) => {
      lever(1 - sortie(k));
      g.rotation.set(g.rotation.x, pose.rotY * sortie(k), pose.rotZ);
    });
    eclat.visible = false;
    // The pose is reached: nothing left to smooth (else the card would turn over again).
    Object.assign(carte, { libre: false, rotY: pose.rotY, rotZ: pose.rotZ, echelle: pose.echelle });
  }

  // A new chain link pops in with a spring.
  private async gonflerMaillon(maillon: number, jeu: Jeu) {
    const sprite = this.maillons[maillon - 1];
    if (!sprite) return;
    sprite.scale.set(0, 0, 1);
    await jeu.tween(D3, (k) => {
      const s = ressort(k);
      sprite.scale.set(MAILLON.l * s, MAILLON.h * s, 1);
    });
  }

  // A link resolves: its number flares then shrinks away; a negated one turns red and shakes.
  private async resolution(maillon: number, annule: boolean, jeu: Jeu) {
    const sprite = this.maillons[maillon - 1];
    if (!sprite || jeu.reduced) return;
    if (annule) sprite.material.color.copy(hdr("--danger", 1.5));
    const x = sprite.position.x;
    await Promise.all([
      this.onde(this.zones.get(sprite.userData.cle), 0.6, jeu, annule ? "--danger" : undefined),
      jeu.tween(D3, (k) => {
        const s = (1 + 0.45 * Math.sin(Math.PI * phase(k, 0, 0.55))) * (1 - elan(phase(k, 0.55, 1)));
        sprite.scale.set(MAILLON.l * s, MAILLON.h * s, 1);
        if (annule) sprite.position.x = x + Math.sin(k * 60) * 0.03 * (1 - k);
      }),
    ]);
  }

  // Draw: the cards slide off the Deck one after the other and fly to the hand, tilting towards the screen.
  private async pioche(joueur: number, nombre: number, jeu: Jeu) {
    const deck = this.zones.get(pileId(joueur, OcgLocation.DECK));
    if (!deck || jeu.reduced || nombre <= 0) return;
    const n = Math.min(nombre, 6);
    const dessus = new THREE.Vector3(deck.x, (deck.pile?.position.y ?? 0) * 2 + 0.01, deck.z);
    const main = this.pointMain(deck.camp);
    const courbe = new THREE.QuadraticBezierCurve3(dessus, dessus.clone().lerp(main, 0.4).setY(Math.max(dessus.y, main.y) + 0.5), main);
    const inclinaison = deck.camp === 0 ? FACE_CAMERA : 0;
    const cartes = Array.from({ length: n }, () => {
      const mesh = new THREE.Mesh(this.geo.carte, [this.mat.tranche, this.mat.dos, this.mat.dos]);
      mesh.visible = false;
      this.racine.add(mesh);
      return mesh;
    });
    const decalage = 70;
    const duree = D3 + decalage * (n - 1);
    await jeu.tween(duree, (k) => {
      cartes.forEach((mesh, i) => {
        const t = phase(k, (i * decalage) / duree, (i * decalage + D3) / duree);
        const e = sortie(t);
        mesh.visible = t > 0 && t < 1;
        mesh.position.copy(courbe.getPoint(e));
        mesh.rotation.set(inclinaison * e, 0.3 * Math.sin(Math.PI * e), 0);
        mesh.scale.setScalar(1 - 0.25 * e);
      });
    });
    for (const mesh of cartes) this.racine.remove(mesh);
  }

  // LP change: the number springs out over the player's side of the board, rises and fades; damage shakes the camera.
  private async pointsDeVie(camp: number, delta: number, choc: boolean, jeu: Jeu) {
    if (jeu.reduced || !delta) return;
    const map = dessinerNombre(delta);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, transparent: true }));
    sprite.renderOrder = 21;
    const base = new THREE.Vector3(0, 0.7, camp === 0 ? 1.3 : -1.3);
    this.racine.add(sprite);
    const puissance = puissanceDe(Math.abs(delta));
    if (choc && delta < 0) this.decalage.secousse = Math.max(this.decalage.secousse, 0.015 + 0.06 * puissance);
    const taille = 0.5 + 0.4 * puissance;
    await jeu.tween(D4 + D3, (k) => {
      const s = taille * ressort(phase(k, 0, 0.2));
      sprite.scale.set(s * 3.2, s, 1);
      sprite.position.copy(base).setY(base.y + 0.5 * sortie(phase(k, 0.45, 1)));
      sprite.material.opacity = 1 - phase(k, 0.65, 1);
    });
    sprite.removeFromParent();
    sprite.material.dispose();
    map.dispose();
  }

  // Dice or coins thrown from the side of the thrower, which stop on their result; they stay a moment, then shrink away.
  private async jeter(effet: Extract<Effet, { type: "de" | "piece" }>, jeu: Jeu) {
    const lancers = construire(effet);
    const depart = effet.joueur === this.seat ? 2.1 : -2.1;
    for (const { mesh } of lancers) this.racine.add(mesh);
    await jeu.tween(D4 + D3, (k) => poser(lancers, k, depart));
    await jeu.pause(900, true);
    await jeu.tween(D2, (k) => {
      for (const { mesh } of lancers) mesh.scale.setScalar(1 - k);
    });
    for (const lancer of lancers) liberer(lancer);
  }

  // Turn change: the camera sways towards the player whose turn it is, a sweep of their color crosses the board.
  private async tour(camp: number, jeu: Jeu) {
    if (jeu.reduced) return;
    const sens = camp === 0 ? 1 : -1;
    const { balayage } = this.fx;
    balayage.material.uniforms.uColor.value.copy(couleurCamp(camp, 1.6));
    balayage.visible = true;
    await jeu.tween(D4 * 1.6, (k) => {
      const s = Math.sin(k * Math.PI);
      this.decalage.lacet = s * 0.12 * sens;
      this.decalage.tangage = s * 0.06;
      this.decalage.recul = s * 0.08;
      balayage.position.z = sens * PLATEAU.p * (1 - 2 * sortie(k));
      balayage.material.uniforms.uOpacity.value = s;
    });
    balayage.visible = false;
  }

  // Frame ------------------------------------------------------------------------------------

  // The pose a card tends to: lifted when hovered or picked, sideways in Defense, back up when face-down.
  private pose(c: CarteM) {
    return { rotY: c.defense ? Math.PI / 2 : 0, rotZ: c.cachee && !c.voile ? Math.PI : 0, echelle: c.defense ? DEFENSE : 1, y: CARTE.e / 2 + 0.003 };
  }

  // True while the card is still moving towards its pose.
  private majCarte(zone: ZoneM, k: number, retombe: number) {
    const c = zone.carte;
    if (!c || c.libre) return false;
    const cible = this.pose(c);
    const leve = zone.etats.has("survol") || zone.etats.has("choisie") ? 0.08 : 0;
    c.levee += (leve - c.levee) * k;
    c.rotY += (cible.rotY - c.rotY) * k;
    c.rotZ += (cible.rotZ - c.rotZ) * k;
    c.echelle += (cible.echelle - c.echelle) * k;
    c.saut *= retombe;
    c.secousse *= retombe;
    // The card lifts while it flips or turns.
    const y = cible.y + c.levee + 0.32 * Math.sin(c.rotZ) + 0.1 * Math.sin(2 * c.rotY) + 0.12 * c.saut;
    c.groupe.position.set(zone.x + Math.sin(temps.value * 70) * 0.04 * c.secousse, y, zone.z);
    c.groupe.rotation.set(0, c.rotY, c.rotZ);
    c.groupe.scale.setScalar(c.echelle);
    c.face.emissiveIntensity = zone.etats.has("survol") ? 0.5 : 0.3;
    return bouge(leve - c.levee, cible.rotY - c.rotY, cible.rotZ - c.rotZ, cible.echelle - c.echelle, c.saut, c.secousse);
  }

  private poserCamera(d: number, lacet = 0, tangage = 0, cible = CIBLE) {
    const p = TANGAGE + tangage;
    this.camera.position.set(Math.sin(lacet) * Math.cos(p) * d, Math.sin(p) * d, Math.cos(lacet) * Math.cos(p) * d).add(cible);
    this.camera.lookAt(cible);
    this.camera.updateMatrixWorld();
  }

  // Shaders driven by time (pulse of the targets, hologram) are the only thing moving.
  private ambiant() {
    if (this.holoZone) return true;
    for (const zone of this.zones.values()) if (zone.overlay.visible && zone.overlay.material.uniforms.uPulse.value > 0) return true;
    return false;
  }

  // Called by Plateau3D on each frame it draws on demand; asks for the next one only while something moves.
  // `dt`: the real time since the last frame, which a frame after a rest does not follow (one 60th of a second then).
  frame(dt: number, t: number) {
    const pas = this.horloge.pas(dt);
    const reduit = prefersReduced();
    temps.value = reduit ? 0 : t;
    const k = reduit ? 1 : 1 - Math.exp(-pas * 12);
    const retombe = reduit ? 0 : Math.exp(-pas * 6);
    let mouvement = false;
    for (const zone of this.zones.values()) mouvement = this.majCarte(zone, k, retombe) || mouvement;
    for (const terrain of this.terrains) {
      const { mesh, vise } = terrain;
      mesh.material.opacity += (vise - mesh.material.opacity) * (reduit ? 1 : 1 - Math.exp(-pas * 3));
      mesh.visible = mesh.material.opacity > 0.005;
      mouvement = bouge(vise - mesh.material.opacity) || mouvement;
    }
    if (this.particules.actives > 0 && !this.gel) {
      this.particules.echelle(this.gl.domElement.height, this.camera.fov);
      mouvement = this.particules.avancer(pas) || mouvement;
    }
    const { lacet, tangage, recul, zoom, vise } = this.decalage;
    this.poserCamera(this.distance * (1 + recul - zoom), lacet, tangage, this.visee.copy(CIBLE).add(vise));
    this.decalage.secousse *= retombe;
    if (this.decalage.secousse > 0.001) {
      mouvement = true;
      this.camera.position.x += Math.sin(t * 91) * this.decalage.secousse;
      this.camera.position.y += Math.cos(t * 73) * this.decalage.secousse;
      this.camera.updateMatrixWorld();
    }
    if (this.holoZone) {
      const { plan } = this.holo;
      const monde = plan.getWorldPosition(this.tmp);
      plan.lookAt(this.camera.position.x, monde.y, this.camera.position.z);
      plan.rotateX(-0.28);
    }
    if (this.composer) this.composer.render(pas);
    else this.gl.render(this.scene, this.camera);
    // A tween asks for its own frames; the ones that follow each other are the ones that tell the speed of the device.
    this.horloge.fin(dt, mouvement || this.tweens > 0);
    if (mouvement) this.invalider();
    else if (!reduit && this.ambiant()) {
      this.minuteur ??= setTimeout(() => {
        this.minuteur = undefined;
        this.reveiller();
      }, PAUSE_AMBIANT);
    }
  }

  // Framing: the whole board fits in the frame the HUD leaves (rect, in canvas pixels), centered on it (setViewOffset).
  cadrer(l: number, h: number, rect: { left: number; top: number; width: number; height: number }) {
    if (l <= 0 || h <= 0) return;
    this.reveiller();
    this.composer?.setPixelRatio(this.gl.getPixelRatio());
    this.composer?.setSize(l, h);
    this.camera.aspect = l / h;
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    let pres = 3;
    let loin = 60;
    for (let i = 0; i < 30; i++) {
      const d = (pres + loin) / 2;
      const b = this.boite(d, l, h);
      if (b.l <= rect.width && b.h <= rect.height) loin = d;
      else pres = d;
    }
    this.distance = loin;
    const b = this.boite(loin, l, h);
    this.camera.setViewOffset(l, h, l / 2 + b.cx - (rect.left + rect.width / 2), h / 2 + b.cy - (rect.top + rect.height / 2), l, h);
    this.camera.updateProjectionMatrix();
    const bordAdverse = new THREE.Vector3(0, 0, -PLATEAU.p).project(this.camera);
    const fond = this.scene.background;
    if (fond instanceof THREE.Texture) fond.dispose();
    this.scene.background = dessinerFond(l, h, ((1 - bordAdverse.y) / 2) * h, this.res);
  }

  private boite(d: number, l: number, h: number) {
    this.poserCamera(d);
    const x: number[] = [];
    const y: number[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = new THREE.Vector3(sx * PLATEAU.l, 0, sz * PLATEAU.p).project(this.camera);
        x.push(p.x);
        y.push(p.y);
      }
    }
    const [x0, x1, y0, y1] = [Math.min(...x), Math.max(...x), Math.min(...y), Math.max(...y)];
    return { l: ((x1 - x0) * l) / 2, h: ((y1 - y0) * h) / 2, cx: ((x0 + x1) / 2) * (l / 2), cy: (-(y0 + y1) / 2) * (h / 2) };
  }

  // High: bloom and FXAA (MSAA 4x cost 12 ms a frame on an integrated GPU); low: no post-processing, a third of the particles.
  qualite(q: Qualite, l: number, h: number) {
    this.reveiller();
    this.jeterComposer();
    this.composer = null;
    this.particules.budget = q === "haute" ? PARTICULES : PARTICULES_BASSE;
    if (q === "haute") {
      const composer = new EffectComposer(this.gl, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.85));
      composer.addPass(new OutputPass());
      composer.addPass(new FXAAPass());
      composer.setPixelRatio(this.gl.getPixelRatio());
      composer.setSize(l, h);
      this.composer = composer;
    }
  }

  // The composer frees its buffers only: the bloom keeps its own targets and materials.
  private jeterComposer() {
    for (const pass of this.composer?.passes ?? []) pass.dispose();
    this.composer?.dispose();
  }

  dispose() {
    clearTimeout(this.minuteur);
    this.jeterComposer();
    for (const tex of [...this.faces.values(), ...this.arts.values()]) tex.dispose();
    this.scene.remove(this.racine);
    this.racine.traverse((objet) => {
      if (!(objet instanceof THREE.Mesh || objet instanceof THREE.Sprite || objet instanceof THREE.Points)) return;
      objet.geometry.dispose();
      for (const m of [objet.material].flat()) m.dispose();
    });
    const fond = this.scene.background;
    if (fond instanceof THREE.Texture) fond.dispose();
    this.scene.background = null;
  }
}
