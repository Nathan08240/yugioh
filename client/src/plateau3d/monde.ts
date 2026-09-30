// The 3D board in plain three.js, ported from design/plateau-3d: Plateau3D.tsx mounts it in a react-three-fiber canvas.
import { OcgLocation } from "@n1xx1/ocgcore-wasm";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { Board } from "../board.ts";
import type { Cards } from "../cards.ts";
import { D2, D3, D4, prefersReduced } from "../motion.ts";
import { placeKey } from "../question.ts";
import { surveillant } from "./cadence.ts";
import { CARTE, pileId, PLATEAU, ZONE, zones, type CarteScene, type EtatScene, type PileScene, type Zone } from "./disposition.ts";
import type { Depart, Effet, Variation } from "./effets.ts";
import { FS_BALAYAGE, FS_CONE, FS_FAISCEAU, FS_HOLOGRAMME, FS_SOL, FS_SURBRILLANCE, VS_MONDE, VS_UV } from "./shaders.ts";
import type { Jeu } from "./spectacle.ts";
import { art, couleurCamp, dessinerDos, dessinerFace, dessinerFond, dessinerLueur, dessinerMaillon, dessinerPlateau, dessinerTranche, hdr, texture, TEX, toile, type Ressources } from "./textures.ts";

export type Qualite = "haute" | "basse";
type Etat = "choisie" | "survol" | "visee" | "attaquant" | "activee" | "cible";
type CarteM = CarteScene & { face: THREE.MeshStandardMaterial; mesh: THREE.Mesh; groupe: THREE.Group; libre: boolean; levee: number; saut: number; secousse: number; rotY: number; rotZ: number; echelle: number };
type ZoneM = Zone & { overlay: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; carte?: CarteM; pile?: THREE.Mesh; pileEtat?: string; etats: Set<Etat> };

const TANGAGE = THREE.MathUtils.degToRad(52);
const DEFENSE = 0.8;
const HOLO_Y = 0.3;
const CIBLE = new THREE.Vector3(0, 0, 0.1);
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

const sortie = (k: number) => 1 - (1 - k) ** 4;
const elan = (k: number) => k ** 3;
const uni = <T>(value: T) => ({ value });
const bouge = (...ecarts: number[]) => ecarts.some((ecart) => Math.abs(ecart) > SEUIL);

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
  private readonly maillons: THREE.Sprite[] = [];
  // Half of the mat of each camp, dressed with the artwork of its Field Spell (fades in and out).
  private readonly terrains: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; code: number; vise: number }[] = [];
  private readonly mat: { tranche: THREE.Material; tranchePile: THREE.Material; dos: THREE.MeshStandardMaterial };
  private readonly geo: { carte: THREE.BufferGeometry; zone: THREE.BufferGeometry };
  private readonly holo: { groupe: THREE.Group; plan: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; cone: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>; anneau: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> };
  private readonly fx: { tir: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; tete: THREE.Sprite; eclat: THREE.Sprite; onde: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; balayage: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> };
  private readonly decalage = { lacet: 0, tangage: 0, recul: 0, secousse: 0 };
  private composer: EffectComposer | null = null;
  private distance = 12;
  private holoZone: ZoneM | undefined;
  private survolee: ZoneM | undefined;
  private etatsQuestion = { cibles: new Set<string>(), choisies: new Set<string>() };
  // Everything the world adds to the scene of react-three-fiber, removed as a whole.
  private readonly racine = new THREE.Group();
  // On-demand rendering: the world asks for a frame (`invalider`) whenever something changes or moves, and none at rest.
  private readonly invalider: () => void;
  private readonly mesure: (dt: number) => void;
  private enchaine = false;
  private tweens = 0;
  private minuteur: ReturnType<typeof setTimeout> | undefined;

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
    this.mesure = surveillant(rappels.lent);
    gl.toneMapping = THREE.NeutralToneMapping;
    // As in production builds: no reading of the compile logs (ANGLE warns about the FXAA shader).
    gl.debug.checkShaderErrors = false;
    // The framing sets the projection itself (setViewOffset): react-three-fiber leaves the camera alone.
    Object.assign(camera, { manual: true });
    scene.add(this.racine);
    this.racine.add(new THREE.HemisphereLight(0xc8d0ff, 0x2a1850, 1.3));
    const lune = new THREE.DirectionalLight(0xeef1ff, 2.2);
    lune.position.set(-3, 9, 5);
    this.racine.add(lune);
    for (const [camp, z] of [[0, 2.4], [1, -2.4]]) {
      const lampe = new THREE.PointLight(couleurCamp(camp, 1), 5, 6, 1.5);
      lampe.position.set(0, 1.4, z);
      this.racine.add(lampe);
    }
    this.geo = { carte: geoCarte(CARTE.e), zone: new THREE.PlaneGeometry(ZONE.l + 0.16, ZONE.p + 0.16).rotateX(-Math.PI / 2) };
    this.mat = { tranche: new THREE.MeshStandardMaterial({ color: 0x20264f, roughness: 0.6 }), tranchePile: new THREE.MeshStandardMaterial({ map: dessinerTranche(), roughness: 0.8 }), dos: matCarte(texture(dessinerDos())) };
    const liste = zones(seat);
    for (const zone of liste) this.creerZone(zone);
    this.construireDecor(liste);
    this.holo = this.construireHolo();
    this.fx = this.construireEffets();
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
    const tir = new THREE.Mesh(new THREE.BufferGeometry(), effet(FS_FAISCEAU, { uColor: uni(new THREE.Color()), uMode: uni(1), uProgress: uni(0), uOpacity: uni(1) }));
    const sprite = () => new THREE.Sprite(new THREE.SpriteMaterial({ map: lueur, blending: THREE.AdditiveBlending, depthWrite: false }));
    const onde = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 6).rotateX(-Math.PI / 2), additive());
    const balayage = new THREE.Mesh(new THREE.PlaneGeometry(2 * PLATEAU.l, 0.9).rotateX(-Math.PI / 2), effet(FS_BALAYAGE, { uColor: uni(new THREE.Color()), uOpacity: uni(0) }));
    balayage.position.y = 0.02;
    const fx = { tir, tete: sprite(), eclat: sprite(), onde, balayage };
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

  private syncChaine(chain: Board["chain"]) {
    for (const sprite of this.maillons.splice(0)) {
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
      sprite.scale.set(0.24, 0.26, 1);
      sprite.position.set(zone.x + 0.3, 0.2, zone.z - 0.43);
      sprite.renderOrder = 20;
      this.racine.add(sprite);
      this.maillons.push(sprite);
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
    const rayon = new THREE.Raycaster();
    rayon.setFromCamera(new THREE.Vector2(x, y), this.camera);
    return rayon.intersectObjects(this.cibles, false)[0]?.object.userData.cle;
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
      case "entree":
        return this.entree(this.zones.get(effet.cle), jeu);
      case "invocation":
        return this.invocation(this.zones.get(effet.cle), effet.code, effet.genre, jeu);
      case "pose":
        return this.onde(this.zones.get(effet.cle), 0.5, jeu);
      case "position":
        return this.sauter(this.zones.get(effet.cle), jeu);
      case "depart":
        return this.depart(this.zones.get(effet.cle), effet.genre, jeu);
      case "attaque":
        return this.attaque(this.zones.get(effet.de), effet.vers ? this.zones.get(effet.vers) : undefined, jeu);
      case "activation":
        return this.activation(this.zones.get(effet.cle), jeu);
      case "tour":
        return this.tour(effet.joueur === this.seat ? 0 : 1, jeu);
      case "stats":
        return this.eclatStats(effet.cartes, jeu);
      default:
        return Promise.resolve();
    }
  }

  // The hand of a camp in the scene: bottom of the screen, top for the opponent.
  private pointMain(camp: number) {
    const rayon = new THREE.Raycaster();
    rayon.setFromCamera(new THREE.Vector2(0, camp === 0 ? -0.9 : 0.95), this.camera);
    return rayon.ray.at(camp === 0 ? 4.5 : 9, new THREE.Vector3());
  }

  // The card comes from the hand and lands on its zone.
  private async entree(zone: ZoneM | undefined, jeu: Jeu) {
    const carte = zone?.carte;
    if (!zone || !carte) return;
    if (jeu.reduced) {
      await this.fondu(carte, 0, 1, jeu);
      return;
    }
    carte.libre = true;
    const depart = this.pointMain(zone.camp);
    const haut = new THREE.Vector3(zone.x, 0.5, zone.z);
    const courbe = new THREE.QuadraticBezierCurve3(depart, depart.clone().lerp(haut, 0.5).setY(Math.max(depart.y, haut.y) + 0.4), haut);
    const inclinaison = zone.camp === 0 ? Math.PI / 2 - TANGAGE : 0;
    const pose = this.pose(carte);
    carte.groupe.position.copy(depart);
    await jeu.tween(D3, (k) => {
      const e = sortie(k);
      carte.groupe.position.copy(courbe.getPoint(e));
      carte.groupe.rotation.set(inclinaison * (1 - e), pose.rotY, pose.rotZ);
    });
    await jeu.tween(D2, (k) => carte.groupe.position.set(zone.x, 0.5 + (pose.y - 0.5) * elan(k), zone.z));
    carte.libre = false;
    await this.onde(zone, 0.8, jeu);
  }

  // Only the monster that acts projects itself, then comes down. A god gets a giant hologram and shakes the board.
  private async invocation(zone: ZoneM | undefined, code: number, genre: "normale" | "fusion" | "dieu", jeu: Jeu) {
    if (!zone) return;
    if (genre === "fusion") await this.eclat(zone, "--type-fusion", jeu);
    const dieu = genre === "dieu";
    await this.projeter(zone, code, dieu ? 1.8 : 1, jeu);
    if (dieu) {
      if (!jeu.reduced) this.decalage.secousse = 0.08;
      await jeu.pause(D4 + 1000, true);
    } else await jeu.tenir(400);
    await this.baisser(jeu);
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

  // Destroyed: flash and flight to the Graveyard; tribute: dissolves into light; material: sucked into a violet spiral;
  // banished: spins up and fades away; back to the hand or a Deck: flies there.
  private async depart(zone: ZoneM | undefined, genre: Depart, jeu: Jeu) {
    const carte = zone?.carte;
    if (!zone || !carte) return;
    if (jeu.reduced) await this.fondu(carte, 1, 0, jeu);
    else {
      carte.libre = true;
      const vol = this.vol(zone, carte, genre);
      await Promise.all([this.eclat(zone, DEPARTS[genre], jeu), jeu.tween(D3, (k) => vol(elan(k), k)), genre === "bannissement" && this.fondu(carte, 1, 0, jeu, D3)]);
    }
    this.retirerCarte(zone);
  }

  private vol(zone: ZoneM, carte: CarteM, genre: Depart) {
    switch (genre) {
      case "sacrifice":
      case "materiau":
        return this.dissoudre(carte, genre === "materiau");
      case "bannissement":
        return this.bannir(zone, carte);
      case "main":
        return this.rentrer(zone, carte);
      case "deck":
        return this.briser(zone, carte, OcgLocation.DECK, 0);
      case "extra":
        return this.briser(zone, carte, OcgLocation.EXTRA, 0);
      default:
        return this.briser(zone, carte, OcgLocation.GRAVE, 2);
    }
  }

  // Flight to a pile of the owner, turning `tours` radians on the way.
  private briser(zone: ZoneM, carte: CarteM, pile: OcgLocation, tours: number) {
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
    const inclinaison = zone.camp === 0 ? Math.PI / 2 - TANGAGE : 0;
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

  // A tribute rises into light; a material spirals to the middle of the board.
  private dissoudre(carte: CarteM, spirale: boolean) {
    const pose = this.pose(carte);
    const depuis = carte.groupe.position.clone();
    const aspire = Number(spirale);
    return (e: number) => {
      carte.groupe.position.set(depuis.x * (1 - aspire * e), depuis.y + e * 0.9, depuis.z * (1 - aspire * e * 0.6));
      carte.groupe.rotation.set(0, pose.rotY + aspire * e * 6, pose.rotZ);
      carte.groupe.scale.setScalar(pose.echelle * (1 - e));
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

  private courbe(de: ZoneM, vers: THREE.Vector3) {
    const depart = new THREE.Vector3(de.x, HOLO_Y + 0.6, de.z - 0.15);
    const sommet = depart.clone().lerp(vers, 0.5).setY(1.7);
    // Curve offset to one side, readable when the attack follows the axis of the camera.
    sommet.x += de.x <= vers.x ? -0.9 : 0.9;
    return new THREE.QuadraticBezierCurve3(depart, sommet, vers);
  }

  // Hologram of the attacker, beam, impact on the target (or on the opponent for a direct attack).
  private async attaque(de: ZoneM | undefined, vers: ZoneM | undefined, jeu: Jeu) {
    if (!de?.carte) return;
    this.marquer(de, "attaquant", true);
    this.marquer(vers, "visee", true);
    await this.projeter(de, de.carte.code, 1, jeu);
    const point = vers ? new THREE.Vector3(vers.x, 0.06, vers.z) : new THREE.Vector3(0, 0.3, de.camp === 0 ? -PLATEAU.p : PLATEAU.p);
    const courbe = this.courbe(de, point);
    const { tir, tete } = this.fx;
    tir.geometry.dispose();
    tir.geometry = new THREE.TubeGeometry(courbe, 64, 0.06, 8);
    tir.material.uniforms.uColor.value.copy(couleurCamp(de.camp, 2.5));
    tete.material.color.copy(couleurCamp(de.camp, 3));
    tir.visible = true;
    tete.visible = !jeu.reduced;
    await jeu.tween(D2, (k) => {
      const e = jeu.reduced ? 1 : k * k;
      tir.material.uniforms.uProgress.value = e;
      tete.position.copy(courbe.getPoint(e));
      tete.scale.setScalar(0.5 + 0.3 * e);
    });
    tir.visible = false;
    tete.visible = false;
    await this.impact(point, vers, jeu);
    this.marquer(de, "attaquant", false);
    this.marquer(vers, "visee", false);
    await this.baisser(jeu);
  }

  private async impact(point: THREE.Vector3, vers: ZoneM | undefined, jeu: Jeu) {
    if (jeu.reduced) return;
    const { eclat, onde } = this.fx;
    eclat.position.copy(point).setY(0.12);
    onde.position.copy(point).setY(0.02);
    eclat.material.color.copy(hdr("--danger", 3));
    onde.material.color.copy(hdr("--danger", 2.5));
    eclat.visible = true;
    onde.visible = true;
    if (vers?.carte) vers.carte.secousse = 1;
    await jeu.tween(D4 * 0.7, (k) => {
      const e = sortie(k);
      eclat.scale.setScalar(0.4 + 2.2 * e);
      eclat.material.opacity = 1 - k;
      onde.scale.setScalar(1 + 2.4 * e);
      onde.material.opacity = 1 - k;
      this.decalage.secousse = 0.05 * (1 - k);
    });
    eclat.visible = false;
    onde.visible = false;
  }

  private async activation(zone: ZoneM | undefined, jeu: Jeu) {
    if (!zone?.carte) return;
    zone.carte.saut = 1;
    await this.onde(zone, 1, jeu);
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

  private poserCamera(d: number, lacet = 0, tangage = 0) {
    const p = TANGAGE + tangage;
    this.camera.position.set(Math.sin(lacet) * Math.cos(p) * d, Math.sin(p) * d, Math.cos(lacet) * Math.cos(p) * d).add(CIBLE);
    this.camera.lookAt(CIBLE);
    this.camera.updateMatrixWorld();
  }

  // Shaders driven by time (pulse of the targets, hologram) are the only thing moving.
  private ambiant() {
    if (this.holoZone) return true;
    return [...this.zones.values()].some((zone) => zone.overlay.visible && zone.overlay.material.uniforms.uPulse.value > 0);
  }

  // Called by react-three-fiber on each frame it renders (`frameloop="demand"`); asks for the next one only while something moves.
  // `dt`: the real time since the last frame, which a frame after a rest does not follow (one 60th of a second then).
  frame(dt: number, t: number) {
    const suite = this.enchaine;
    const pas = suite ? Math.min(dt, 0.1) : 1 / 60;
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
    const { lacet, tangage, recul } = this.decalage;
    this.poserCamera(this.distance * (1 + recul), lacet, tangage);
    this.decalage.secousse *= retombe;
    if (this.decalage.secousse > 0.001) {
      mouvement = true;
      this.camera.position.x += Math.sin(t * 91) * this.decalage.secousse;
      this.camera.position.y += Math.cos(t * 73) * this.decalage.secousse;
      this.camera.updateMatrixWorld();
    }
    if (this.holoZone) {
      const { plan } = this.holo;
      const monde = plan.getWorldPosition(new THREE.Vector3());
      plan.lookAt(this.camera.position.x, monde.y, this.camera.position.z);
      plan.rotateX(-0.28);
    }
    if (this.composer) this.composer.render(pas);
    else this.gl.render(this.scene, this.camera);
    // A tween asks for its own frames; the ones that follow each other are the ones that tell the speed of the device.
    const rapide = mouvement || this.tweens > 0;
    if (suite && rapide) this.mesure(dt);
    this.enchaine = rapide;
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

  // High: bloom and FXAA (MSAA 4x cost 12 ms a frame on an integrated GPU); low: no post-processing.
  qualite(q: Qualite, l: number, h: number) {
    this.reveiller();
    this.composer?.dispose();
    this.composer = null;
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

  dispose() {
    clearTimeout(this.minuteur);
    this.composer?.dispose();
    for (const tex of [...this.faces.values(), ...this.arts.values()]) tex.dispose();
    this.scene.remove(this.racine);
    this.racine.traverse((objet) => {
      if (!(objet instanceof THREE.Mesh || objet instanceof THREE.Sprite)) return;
      objet.geometry.dispose();
      for (const m of [objet.material].flat()) m.dispose();
    });
    const fond = this.scene.background;
    if (fond instanceof THREE.Texture) fond.dispose();
    this.scene.background = null;
  }
}
