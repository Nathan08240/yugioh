// Canvas textures of the board, drawn from the tokens (design/plateau-3d): house card frame, hexagonal back, mat, night.
import { OcgType } from "@n1xx1/ocgcore-wasm";
import * as THREE from "three";
import type { CardInfo } from "../../../server/src/protocol.ts";
import ville from "../assets/ville.svg";
import { attributeKey, frame, has, ICONS, statChange } from "../cards.ts";
import { PLATEAU, ZONE, type TypeZone, type Zone } from "./disposition.ts";

const jeton = (nom: string) => getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
export const CAMPS = ["--camp-moi", "--camp-adverse"];
export const hdr = (nom: string, force = 1) => new THREE.Color(jeton(nom)).multiplyScalar(force);
export const couleurCamp = (camp: number, force: number) => hdr(CAMPS[camp], force);

const NOMS_ZONE: Record<TypeZone, string> = { terrain: "Terrain", monstre: "Monstre", magie: "Magie/Piège", cimetiere: "Cimetière", extra: "Extra", deck: "Deck" };
const ICONES_ZONE: Partial<Record<TypeZone, string>> = { terrain: "ui-terrain", cimetiere: "ui-cimetiere", extra: "ui-extra", deck: "ui-deck" };
const ATTRIBUTS = ["lumiere", "tenebres", "terre", "eau", "feu", "vent", "divin"];
const SOMBRE = "#0b0f2a";
const BLANC_0 = "rgb(255 255 255 / 0)";

export type Ressources = { icones: Map<string, HTMLImageElement>; ville: HTMLImageElement };

async function image(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

// Icons of the sprite drawn in one color, fonts and the city skyline: everything the textures need before drawing.
export async function charger(): Promise<Ressources> {
  const sprite = new DOMParser().parseFromString(await (await fetch(ICONS)).text(), "image/svg+xml");
  const demandes = [
    ...ATTRIBUTS.map((a) => [`attr-${a}`, SOMBRE]),
    ["type-magie", SOMBRE],
    ["type-piege", SOMBRE],
    ...Object.values(ICONES_ZONE).flatMap((id) => CAMPS.map((camp) => [id, jeton(camp)])),
  ];
  const icones = new Map<string, HTMLImageElement>();
  const svgVille = (await (await fetch(ville)).text()).replace("<svg ", '<svg width="1600" height="360" ');
  const [skyline] = await Promise.all([
    image(`data:image/svg+xml,${encodeURIComponent(svgVille)}`),
    ...demandes.map(async ([id, couleur]) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="none" stroke="${couleur}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${sprite.getElementById(id)?.innerHTML ?? ""}</svg>`;
      icones.set(`${id}|${couleur}`, await image(`data:image/svg+xml,${encodeURIComponent(svg)}`));
    }),
    ...["800 32px Oxanium", "700 24px 'Barlow Condensed'", "600 24px 'Barlow Condensed'"].map((font) => document.fonts.load(font)),
  ]);
  return { icones, ville: skyline };
}

// Artworks served by /api/art, loaded once per code (undefined when the card has none or it fails).
const ARTS = new Map<number, Promise<HTMLImageElement | undefined>>();
export function art(code: number, info?: CardInfo): Promise<HTMLImageElement | undefined> {
  if (!info?.image) return Promise.resolve(undefined);
  let loading = ARTS.get(code);
  if (!loading) {
    loading = image(`/api/art/${code}.jpg`).catch(() => undefined);
    ARTS.set(code, loading);
  }
  return loading;
}

export const TEX = { l: 256, h: 373 };

export function toile(l: number, h: number) {
  const c = document.createElement("canvas");
  c.width = l;
  c.height = h;
  return c;
}

export function texture(c: HTMLCanvasElement, anisotropie = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropie;
  return t;
}

function hexagone(g: CanvasRenderingContext2D, x: number, y: number, l: number, h: number) {
  g.beginPath();
  g.moveTo(x + l / 2, y);
  g.lineTo(x + l, y + h * 0.25);
  g.lineTo(x + l, y + h * 0.75);
  g.lineTo(x + l / 2, y + h);
  g.lineTo(x, y + h * 0.75);
  g.lineTo(x, y + h * 0.25);
  g.closePath();
}

// Round gem of the attribute, or of Spell/Trap.
function dessinerGemme(g: CanvasRenderingContext2D, u: number, teinte: string, icone: HTMLImageElement | undefined) {
  const r = 9.5 * u;
  const c = 1.6 * u + r;
  g.beginPath();
  g.arc(c, c, r + u, 0, Math.PI * 2);
  g.fillStyle = SOMBRE;
  g.fill();
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fillStyle = teinte;
  g.fill();
  const brillance = g.createRadialGradient(c - 0.3 * r, c - 0.4 * r, 0, c - 0.3 * r, c - 0.4 * r, 0.92 * r);
  brillance.addColorStop(0, "rgb(255 255 255 / 0.65)");
  brillance.addColorStop(1, BLANC_0);
  g.fillStyle = brillance;
  g.fill();
  if (icone) g.drawImage(icone, c - 5.9 * u, c - 5.9 * u, 11.8 * u, 11.8 * u);
}

// Hatched veil of a set card, readable by its owner only.
function dessinerVoile(g: CanvasRenderingContext2D, u: number) {
  const { l, h } = TEX;
  g.fillStyle = "rgb(10 14 46 / 0.4)";
  g.fillRect(0, 0, l, h);
  g.fillStyle = "rgb(10 14 46 / 0.37)";
  for (let x = 0; x < l + h; x += 10 * u) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 5 * u, 0);
    g.lineTo(x + 5 * u - h, h);
    g.lineTo(x - h, h);
    g.fill();
  }
  g.lineWidth = 3 * u;
  g.strokeStyle = "rgb(67 240 255 / 0.45)";
  g.beginPath();
  g.roundRect(1.5 * u, 1.5 * u, l - 3 * u, h - 3 * u, 5 * u);
  g.stroke();
}

const stat = (value: number) => (value === -2 ? "?" : String(value));
// Current stats above or below the printed ones, as in cartes.css.
const TEINTES = { hausse: "--succes", baisse: "--danger" };

// Small field card (cartes.css under 100 px): artwork, gem, ATK/DEF (current ones when given). Drawn again into `c` once the artwork is loaded.
export function dessinerFace(c: HTMLCanvasElement, res: Ressources, info: CardInfo | undefined, illustration: HTMLImageElement | undefined, voile: boolean, atk?: number, def?: number) {
  const { l, h } = TEX;
  const u = l / 100;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const type = info?.type ?? 0;
  const monstre = has(type, OcgType.MONSTER);
  const cadre = frame(type);
  const attr = monstre ? (attributeKey(info?.attribute ?? 0) ?? "lumiere") : undefined;
  const couleur = jeton(`--type-${cadre}`);
  g.clearRect(0, 0, l, h);
  g.save();
  g.beginPath();
  g.roundRect(0, 0, l, h, 6 * u);
  g.clip();
  g.fillStyle = couleur;
  g.fillRect(0, 0, l, h);
  const reflet = g.createLinearGradient(0, 0, l * 0.75, h);
  reflet.addColorStop(0, "rgb(255 255 255 / 0.4)");
  reflet.addColorStop(0.32, BLANC_0);
  reflet.addColorStop(0.7, "rgb(0 0 0 / 0)");
  reflet.addColorStop(1, "rgb(0 0 0 / 0.35)");
  g.fillStyle = reflet;
  g.fillRect(0, 0, l, h);

  const m = 3.5 * u;
  const la = l - 2 * m;
  const ha = la * 0.9;
  const icone = res.icones.get(`${attr ? `attr-${attr}` : `type-${cadre}`}|${SOMBRE}`);
  g.save();
  g.beginPath();
  g.roundRect(m, m, la, ha, 3 * u);
  g.clip();
  g.fillStyle = SOMBRE;
  g.fillRect(m, m, la, ha);
  if (illustration) g.drawImage(illustration, 0, illustration.height * 0.05, illustration.width, illustration.height * 0.9, m, m, la, ha);
  else if (icone) {
    g.globalAlpha = 0.35;
    g.drawImage(icone, l / 2 - 22 * u, m + ha / 2 - 22 * u, 44 * u, 44 * u);
    g.globalAlpha = 1;
  }
  g.restore();
  g.lineWidth = 1.6 * u;
  g.strokeStyle = "rgb(0 0 0 / 0.35)";
  g.beginPath();
  g.roundRect(m, m, la, ha, 3 * u);
  g.stroke();

  const yb = m + ha + 2.5 * u;
  const hb = h - yb - 3.5 * u;
  g.beginPath();
  g.roundRect(m, yb, la, hb, 2.5 * u);
  g.fillStyle = SOMBRE;
  g.fill();
  const fondu = g.createLinearGradient(0, yb, 0, yb + hb);
  fondu.addColorStop(0, `${couleur}52`);
  fondu.addColorStop(0.8, `${couleur}00`);
  g.fillStyle = fondu;
  g.fill();

  dessinerGemme(g, u, attr ? jeton(`--attr-${attr}`) : couleur, icone);
  if (monstre && info) {
    g.font = `800 ${13 * u}px Oxanium`;
    g.textBaseline = "alphabetic";
    const chiffre = (courante: number, imprimee: number, x: number, align: CanvasTextAlign) => {
      const change = statChange(courante, imprimee);
      g.fillStyle = jeton(change ? TEINTES[change] : "--texte");
      g.textAlign = align;
      g.fillText(stat(courante), x, h - 8 * u);
    };
    chiffre(atk ?? info.atk, info.atk, m + 3 * u, "left");
    chiffre(def ?? info.def, info.def, l - m - 3 * u, "right");
  }
  if (voile) dessinerVoile(g, u);
  g.restore();
}

// House back: the hexagon of the Duel Disk (cartes.css, .carte.dos).
export function dessinerDos() {
  const { l, h } = TEX;
  const c = toile(l, h);
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.beginPath();
  g.roundRect(0, 0, l, h, l * 0.06);
  g.clip();
  const fond = g.createRadialGradient(l / 2, h * 0.45, 0, l / 2, h * 0.45, Math.hypot(l / 2, h * 0.55));
  fond.addColorStop(0, "#3542b0");
  fond.addColorStop(0.4, "#161d5c");
  fond.addColorStop(0.78, "#0a0e2e");
  g.fillStyle = fond;
  g.fillRect(0, 0, l, h);
  g.lineWidth = 2;
  g.strokeStyle = "rgb(67 240 255 / 0.5)";
  g.beginPath();
  g.roundRect(3, 3, l - 6, h - 6, l * 0.05);
  g.stroke();
  const conique = g.createConicGradient((120 * Math.PI) / 180, l / 2, h / 2);
  [jeton("--holo"), jeton("--ombre-violet"), jeton("--or"), jeton("--holo")].forEach((couleur, i) => conique.addColorStop(i / 3, couleur));
  hexagone(g, l * 0.21, h * 0.29, l * 0.58, h * 0.42);
  g.fillStyle = conique;
  g.fill();
  const coeur = g.createRadialGradient(l / 2, h / 2, 0, l / 2, h / 2, Math.hypot(l * 0.21, h * 0.155));
  coeur.addColorStop(0.09, jeton("--holo-2"));
  coeur.addColorStop(0.11, "#0a0e2e");
  hexagone(g, l * 0.29, h * 0.345, l * 0.42, h * 0.31);
  g.fillStyle = coeur;
  g.fill();
  return c;
}

// Mat of the Duel Disk: plate, tints of the two camps, grid, zones and their labels, in one texture.
export function dessinerPlateau(zones: Zone[], res: Ressources, anisotropie: number) {
  const lx = PLATEAU.l + 0.25;
  const pz = PLATEAU.p + 0.25;
  const e = 2048 / (2 * lx);
  const c = toile(2048, Math.round(2 * pz * e));
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const X = (x: number) => (x + lx) * e;
  const Z = (z: number) => (z + pz) * e;
  const plaque = () => {
    g.beginPath();
    g.roundRect(X(-PLATEAU.l), Z(-PLATEAU.p), 2 * PLATEAU.l * e, 2 * PLATEAU.p * e, 0.2 * e);
  };

  g.save();
  g.shadowColor = "rgb(67 240 255 / 0.3)";
  g.shadowBlur = 0.18 * e;
  plaque();
  g.fillStyle = "rgb(10 14 46 / 0.86)";
  g.fill();
  g.restore();

  g.save();
  plaque();
  g.clip();
  const teinte = g.createLinearGradient(0, Z(-PLATEAU.p), 0, Z(PLATEAU.p));
  teinte.addColorStop(0, "rgb(255 106 136 / 0.13)");
  teinte.addColorStop(0.46, "rgb(255 106 136 / 0)");
  teinte.addColorStop(0.54, "rgb(67 240 255 / 0)");
  teinte.addColorStop(1, "rgb(67 240 255 / 0.13)");
  g.fillStyle = teinte;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "rgb(150 170 255 / 0.07)";
  g.lineWidth = 2;
  for (let x = 0; x < c.width; x += 0.22 * e) g.strokeRect(x, -1, 0, c.height + 2);
  for (let y = 0; y < c.height; y += 0.22 * e) g.strokeRect(-1, y, c.width + 2, 0);
  g.restore();

  const bord = g.createLinearGradient(0, Z(-PLATEAU.p), 0, Z(PLATEAU.p));
  bord.addColorStop(0, "rgb(255 106 136 / 0.7)");
  bord.addColorStop(1, "rgb(67 240 255 / 0.7)");
  g.lineWidth = 0.02 * e;
  g.strokeStyle = bord;
  plaque();
  g.stroke();

  // Middle line and hexagon of the Duel Disk
  const milieu = g.createLinearGradient(X(-PLATEAU.l), 0, X(PLATEAU.l), 0);
  milieu.addColorStop(0, "rgb(67 240 255 / 0)");
  milieu.addColorStop(0.2, jeton("--holo"));
  milieu.addColorStop(0.8, jeton(CAMPS[1]));
  milieu.addColorStop(1, "rgb(255 106 136 / 0)");
  g.save();
  g.shadowColor = jeton("--holo");
  g.shadowBlur = 0.08 * e;
  g.fillStyle = milieu;
  g.fillRect(X(-PLATEAU.l), Z(0) - 0.008 * e, 2 * PLATEAU.l * e, 0.016 * e);
  g.lineWidth = 0.012 * e;
  g.strokeStyle = milieu;
  hexagone(g, X(-0.2), Z(-0.22), 0.4 * e, 0.44 * e);
  g.stroke();
  g.restore();

  for (const zone of zones) {
    const couleur = jeton(CAMPS[zone.camp]);
    const coins = [0.08 * e, 0.02 * e];
    g.beginPath();
    g.roundRect(X(zone.x - ZONE.l / 2), Z(zone.z - ZONE.p / 2), ZONE.l * e, ZONE.p * e, [coins[0], coins[1], coins[0], coins[1]]);
    g.fillStyle = `${couleur}12`;
    g.fill();
    g.lineWidth = 0.011 * e;
    g.strokeStyle = `${couleur}88`;
    g.stroke();
    const icone = res.icones.get(`${ICONES_ZONE[zone.type]}|${couleur}`);
    if (!icone) continue;
    const cx = X(zone.x);
    const cz = Z(zone.z);
    g.globalAlpha = 0.75;
    g.drawImage(icone, cx - 0.11 * e, cz - 0.2 * e, 0.22 * e, 0.22 * e);
    g.globalAlpha = 1;
    g.font = `600 ${0.085 * e}px 'Barlow Condensed'`;
    g.letterSpacing = `${0.01 * e}px`;
    g.textAlign = "center";
    g.fillStyle = `${couleur}bb`;
    g.fillText(NOMS_ZONE[zone.type].toUpperCase(), cx, cz + 0.14 * e);
  }
  return texture(c, anisotropie);
}

// Night of Battle City: the gradient of the duel screen, the skyline behind the opponent's edge of the board (y in px).
export function dessinerFond(largeur: number, hauteur: number, horizon: number, res: Ressources) {
  const c = toile(Math.max(1, Math.round(largeur / 2)), Math.max(1, Math.round(hauteur / 2)));
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const { width: l, height: h } = c;
  g.fillStyle = jeton("--nuit-0");
  g.fillRect(0, 0, l, h);
  g.save();
  g.translate(l / 2, h * 0.45);
  const aplatir = (0.55 * h) / (0.7 * l);
  g.scale(1, aplatir);
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, 0.7 * l);
  halo.addColorStop(0, "#1b2370");
  halo.addColorStop(0.55, "#0c1236");
  halo.addColorStop(1, jeton("--nuit-0"));
  g.fillStyle = halo;
  g.fillRect(-l, (-2 * h) / aplatir, 2 * l, (4 * h) / aplatir);
  g.restore();

  const bande = toile(l, Math.max(1, Math.round(horizon / 2 + h * 0.04)));
  const b = bande.getContext("2d") as CanvasRenderingContext2D;
  const hv = Math.min(bande.height, h * 0.24);
  const lv = (hv * 1600) / 360;
  let x = (l - lv) / 2;
  while (x > 0) x -= lv;
  for (; x < l; x += lv) b.drawImage(res.ville, x, bande.height - hv, lv, hv);
  b.globalCompositeOperation = "destination-in";
  const masque = b.createLinearGradient(0, 0, 0, bande.height);
  masque.addColorStop(0, "#0000");
  masque.addColorStop(Math.max(0, 1 - (1.4 * hv) / bande.height), "#0000");
  masque.addColorStop(Math.max(0, 1 - (0.5 * hv) / bande.height), "#000");
  b.fillStyle = masque;
  b.fillRect(0, 0, l, bande.height);
  g.globalAlpha = 0.6;
  g.drawImage(bande, 0, 0);
  return texture(c, 1);
}

export function dessinerMaillon(numero: number, camp: number) {
  const c = toile(64, 70);
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  hexagone(g, 2, 2, 60, 66);
  g.fillStyle = jeton(CAMPS[camp]);
  g.fill();
  g.font = "800 38px Oxanium";
  g.fillStyle = jeton("--nuit-0");
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(numero), 32, 38);
  return texture(c, 1);
}

export function dessinerLueur() {
  const c = toile(64, 64);
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "#fff");
  r.addColorStop(0.25, "rgb(255 255 255 / 0.55)");
  r.addColorStop(1, BLANC_0);
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return texture(c, 1);
}

export function dessinerTranche() {
  const c = toile(4, 64);
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  for (let y = 0; y < 64; y += 8) {
    g.fillStyle = "#c9cfe8";
    g.fillRect(0, y, 4, 5);
    g.fillStyle = "#39406e";
    g.fillRect(0, y + 5, 4, 3);
  }
  const t = texture(c, 1);
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 5);
  return t;
}
