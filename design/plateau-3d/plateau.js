// Plateau de duel en 3D (prototype Three.js de la charte « Duel Disk »). Scène reprise de la maquette #duel.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/OutputPass.js";
import { FXAAPass } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/FXAAPass.js";
import { CARTES } from "../assets/cartes.js";

const params = new URLSearchParams(location.search);
const reduit = matchMedia("(prefers-reduced-motion: reduce)");
const css = getComputedStyle(document.documentElement);
const jeton = (nom) => css.getPropertyValue(nom).trim();
// Durées des jetons en secondes : 0 quand le mouvement est réduit.
const duree = (nom) => Number.parseFloat(jeton(nom)) / 1000;
const hdr = (nom, force = 1) => new THREE.Color(jeton(nom)).multiplyScalar(force);
const CAMPS = ["--camp-moi", "--camp-adverse"];
const couleurCamp = (camp, force) => hdr(CAMPS[camp], force);
const sortie = (k) => 1 - (1 - k) ** 4;
const maintenant = () => performance.now() / 1000;

// Disposition ---------------------------------------------------------------
// Unité : 10 cm. Vous (camp 0) au premier plan, l'adversaire (camp 1) en symétrie centrale.
const CARTE = { l: 0.59, h: 0.86, e: 0.01 };
const ZONE = { l: 0.7, p: 0.96 };
const PAS = { x: 0.8, z: 1.08 };
const MILIEU = 0.28;
const PLATEAU = { l: 4 * PAS.x + ZONE.l / 2 + 0.13, p: MILIEU + ZONE.p + PAS.z + 0.13 };
const DEFENSE = 0.8;
const TANGAGE = THREE.MathUtils.degToRad(52);
const HOLO_Y = 0.36;
// Rangée 0 : Terrain, 5 Monstres, Cimetière, Bannies. Rangée 1 : Extra Deck, 5 Magie/Piège, Deck (ordre de Board.tsx).
const TYPES = [
  ["terrain", "monstre", "monstre", "monstre", "monstre", "monstre", "cimetiere", "bannies"],
  ["extra", "magie", "magie", "magie", "magie", "magie", "deck"],
];
const NOMS_ZONE = { terrain: "Terrain", monstre: "Monstre", magie: "Magie/Piège", cimetiere: "Cimetière", bannies: "Bannies", extra: "Extra", deck: "Deck" };
const ICONES_ZONE = { terrain: "ui-terrain", cimetiere: "ui-cimetiere", bannies: "ui-bannie", extra: "ui-extra", deck: "ui-deck" };

function centreZone(camp, rangee, col) {
  const x = (col - 3) * PAS.x;
  const z = MILIEU + ZONE.p / 2 + rangee * PAS.z;
  return camp === 0 ? new THREE.Vector3(x, 0, z) : new THREE.Vector3(-x, 0, -z);
}

// Scène de la maquette : attaque du Dragon Blanc, chaîne Force de Miroir puis Sept Outils du Bandit.
const EXEMPLE = [
  ["1:1:4", 3819470, { etats: ["activee"], maillon: 2 }],
  ["1:1:2", 0, { cachee: true }],
  ["1:0:4", 17985575],
  ["1:0:3", 89631139],
  ["1:0:2", 13039848, { defense: true, cachee: true }],
  ["0:0:2", 91152256, { defense: true }],
  ["0:0:3", 46986414],
  ["0:1:2", 44095762, { etats: ["activee"], maillon: 1 }],
  ["0:1:3", 12607053, { cachee: true, etats: ["cible", "choisie"] }],
  ["0:1:4", 4206964, { cachee: true }],
];
const PILES = [["1:1:6", 24], ["1:1:0", 1], ["1:0:6", 5, 43973174], ["1:0:7", 0], ["0:1:6", 27], ["0:1:0", 1], ["0:0:6", 4, 55144522], ["0:0:7", 0]];
const INVOQUEE = 38033121;

// Chargement ------------------------------------------------------------------
const ARTS = new Map();
let icones;
let ville;

async function chargerImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

async function chargerIcones(demandes) {
  const sprite = new DOMParser().parseFromString(await (await fetch("../icons.svg")).text(), "image/svg+xml");
  const images = new Map();
  await Promise.all(
    demandes.map(async ([id, couleur]) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="none" stroke="${couleur}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${sprite.getElementById(id).innerHTML}</svg>`;
      images.set(`${id}|${couleur}`, await chargerImage(`data:image/svg+xml,${encodeURIComponent(svg)}`));
    }),
  );
  return images;
}

async function charger() {
  const codes = new Set([...EXEMPLE.map(([, code]) => code), ...PILES.map(([, , code]) => code), INVOQUEE]);
  codes.delete(0);
  codes.delete(undefined);
  const gemmes = ["lumiere", "tenebres", "terre", "eau", "feu", "vent", "divin"].map((a) => [`attr-${a}`, "#0b0f2a"]);
  const camps = CAMPS.map((nom) => jeton(nom));
  const zonesIc = Object.values(ICONES_ZONE).flatMap((id) => camps.map((c) => [id, c]));
  const svgVille = (await (await fetch("../maquette/ville.svg")).text()).replace("<svg ", '<svg width="1600" height="360" ');
  [icones, ville] = await Promise.all([
    chargerIcones([...gemmes, ["type-magie", "#0b0f2a"], ["type-piege", "#0b0f2a"], ...zonesIc]),
    chargerImage(`data:image/svg+xml,${encodeURIComponent(svgVille)}`),
    ...[...codes].map(async (code) => ARTS.set(code, await chargerImage(`../assets/art/${code}.jpg`))),
    ...["800 32px Oxanium", "700 24px 'Barlow Condensed'", "600 24px 'Barlow Condensed'"].map((f) => document.fonts.load(f)),
  ]);
}

// Textures dessinées (cadre maison de cartes.css, dos hexagonal, plateau, fond) ---------------
const TEX = { l: 256, h: 373 };
const BLANC_0 = "rgb(255 255 255 / 0)";

function toile(l, h) {
  const c = document.createElement("canvas");
  c.width = l;
  c.height = h;
  return c;
}

function texture(c, anisotropie = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropie;
  return t;
}

function hexagone(g, x, y, l, h) {
  g.beginPath();
  g.moveTo(x + l / 2, y);
  g.lineTo(x + l, y + h * 0.25);
  g.lineTo(x + l, y + h * 0.75);
  g.lineTo(x + l / 2, y + h);
  g.lineTo(x, y + h * 0.75);
  g.lineTo(x, y + h * 0.25);
  g.closePath();
}

// Gemme ronde d'attribut, ou de Magie/Piège.
function dessinerGemme(g, u, teinte, icone) {
  const r = 9.5 * u;
  const c = 1.6 * u + r;
  g.beginPath();
  g.arc(c, c, r + u, 0, Math.PI * 2);
  g.fillStyle = "#0b0f2a";
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
  g.drawImage(icone, c - 5.9 * u, c - 5.9 * u, 11.8 * u, 11.8 * u);
}

// Voile hachuré d'une carte posée, lisible par son seul propriétaire.
function dessinerVoile(g, u) {
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

// Petite carte du terrain (cartes.css sous 100 px) : illustration, gemme, ATK/DEF.
function dessinerFace(code, voile) {
  const [, cadre, attr, , atk, def] = CARTES[code];
  const { l, h } = TEX;
  const u = l / 100;
  const c = toile(l, h);
  const g = c.getContext("2d");
  const couleur = jeton(`--type-${cadre}`);
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
  const art = ARTS.get(code);
  g.save();
  g.beginPath();
  g.roundRect(m, m, la, ha, 3 * u);
  g.clip();
  g.drawImage(art, 0, art.height * 0.05, art.width, art.height * 0.9, m, m, la, ha);
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
  g.fillStyle = "#0b0f2a";
  g.fill();
  const fondu = g.createLinearGradient(0, yb, 0, yb + hb);
  fondu.addColorStop(0, `${couleur}52`);
  fondu.addColorStop(0.8, `${couleur}00`);
  g.fillStyle = fondu;
  g.fill();

  const monstre = Boolean(attr);
  dessinerGemme(g, u, monstre ? jeton(`--attr-${attr}`) : couleur, icones.get(`${monstre ? `attr-${attr}` : `type-${cadre}`}|#0b0f2a`));
  if (monstre) {
    g.font = `800 ${13 * u}px Oxanium`;
    g.fillStyle = jeton("--texte");
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    g.fillText(atk === -2 ? "?" : String(atk), m + 3 * u, h - 8 * u);
    g.textAlign = "right";
    g.fillText(def === -2 ? "?" : String(def), l - m - 3 * u, h - 8 * u);
  }
  if (voile) dessinerVoile(g, u);
  return c;
}

// Dos maison : hexagone du Duel Disk (cartes.css, .carte.dos).
function dessinerDos() {
  const { l, h } = TEX;
  const c = toile(l, h);
  const g = c.getContext("2d");
  g.beginPath();
  g.roundRect(0, 0, l, h, l * 0.06);
  g.clip();
  const fond = g.createRadialGradient(l / 2, h * 0.45, 0, l / 2, h * 0.45, Math.hypot(l / 2, h * 0.55));
  fond.addColorStop(0, "#3542b0");
  fond.addColorStop(0.4, "#161d5c");
  fond.addColorStop(0.78, "#0a0e2e");
  g.fillStyle = fond;
  g.fillRect(0, 0, l, h);
  g.lineWidth = 4;
  g.strokeStyle = "#0a0e2e";
  g.strokeRect(0, 0, l, h);
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

// Tapis du Duel Disk : plaque, teintes des camps, trame, zones et libellés, en une seule texture.
function dessinerPlateau(zones) {
  const lx = PLATEAU.l + 0.25;
  const pz = PLATEAU.p + 0.25;
  const e = 2048 / (2 * lx);
  const c = toile(2048, Math.round(2 * pz * e));
  const g = c.getContext("2d");
  const X = (x) => (x + lx) * e;
  const Z = (z) => (z + pz) * e;
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

  // Ligne médiane et hexagone du Duel Disk
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

  for (const zone of zones.values()) {
    const couleur = jeton(CAMPS[zone.camp]);
    const x = X(zone.centre.x - ZONE.l / 2);
    const y = Z(zone.centre.z - ZONE.p / 2);
    const coins = [0.08 * e, 0.02 * e];
    g.beginPath();
    g.roundRect(x, y, ZONE.l * e, ZONE.p * e, [coins[0], coins[1], coins[0], coins[1]]);
    g.fillStyle = `${couleur}12`;
    g.fill();
    g.lineWidth = 0.011 * e;
    g.strokeStyle = `${couleur}88`;
    g.stroke();
    const id = ICONES_ZONE[zone.type];
    if (!id) continue;
    const cx = X(zone.centre.x);
    const cz = Z(zone.centre.z);
    g.globalAlpha = 0.75;
    g.drawImage(icones.get(`${id}|${couleur}`), cx - 0.11 * e, cz - 0.2 * e, 0.22 * e, 0.22 * e);
    g.globalAlpha = 1;
    g.font = `600 ${0.085 * e}px 'Barlow Condensed'`;
    g.letterSpacing = `${0.01 * e}px`;
    g.textAlign = "center";
    g.fillStyle = `${couleur}bb`;
    g.fillText(NOMS_ZONE[zone.type].toUpperCase(), cx, cz + 0.14 * e);
  }
  return texture(c, renderer.capabilities.getMaxAnisotropy());
}

// Nuit de Battle City : dégradé de .ecran--duel, ville.svg posée derrière le bord adverse du plateau (y en px).
function dessinerFond(largeur, hauteur, horizon) {
  const c = toile(Math.round(largeur / 2), Math.round(hauteur / 2));
  const g = c.getContext("2d");
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
  g.fillRect(-l, -2 * h / aplatir, 2 * l, 4 * h / aplatir);
  g.restore();

  const bande = toile(l, Math.round(horizon / 2 + h * 0.04));
  const b = bande.getContext("2d");
  const hv = Math.min(bande.height, h * 0.24);
  const lv = (hv * 1600) / 360;
  let x = (l - lv) / 2;
  while (x > 0) x -= lv;
  for (; x < l; x += lv) b.drawImage(ville, x, bande.height - hv, lv, hv);
  b.globalCompositeOperation = "destination-in";
  const masque = b.createLinearGradient(0, 0, 0, bande.height);
  masque.addColorStop(0, "#0000");
  masque.addColorStop(Math.max(0, 1 - (1.4 * hv) / bande.height), "#0000");
  masque.addColorStop(1 - (0.5 * hv) / bande.height, "#000");
  b.fillStyle = masque;
  b.fillRect(0, 0, l, bande.height);
  g.globalAlpha = 0.6;
  g.drawImage(bande, 0, 0);
  return texture(c, 1);
}

function dessinerMaillon(numero, camp) {
  const c = toile(64, 70);
  const g = c.getContext("2d");
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

function dessinerLueur() {
  const c = toile(64, 64);
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "#fff");
  r.addColorStop(0.25, "rgb(255 255 255 / 0.55)");
  r.addColorStop(1, BLANC_0);
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return texture(c, 1);
}

function dessinerTranche() {
  const c = toile(4, 64);
  const g = c.getContext("2d");
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

// Shaders des effets : tous additifs sauf l'hologramme, uTime partagé (figé si mouvement réduit).
const TEMPS = { value: 0 };
const FIN = "\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n";
const VS_UV = "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const VS_MONDE = "varying vec3 vMonde; void main() { vec4 m = modelMatrix * vec4(position, 1.0); vMonde = m.xyz; gl_Position = projectionMatrix * viewMatrix * m; }";

const FS_SURBRILLANCE = `
uniform vec3 uColor; uniform float uFill, uPulse, uTime; uniform vec2 uSize, uDemi; varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  vec2 q = abs(p) - uDemi + 0.05;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.05;
  float trait = 1.0 - smoothstep(0.0, 0.025, abs(d));
  float halo = exp(-max(d, 0.0) * 16.0) * step(0.0, d) * 0.8;
  float pulse = mix(1.0, 0.6 + 0.4 * sin(uTime * 4.0), uPulse);
  gl_FragColor = vec4(uColor, (trait + halo + step(d, 0.0) * uFill) * pulse);${FIN}}`;

const FS_HOLOGRAMME = `
uniform sampler2D map; uniform vec3 uColor; uniform float uReveal, uOpacity, uTime; varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float d = max(abs(p.x) * 2.0, abs(p.y) * 2.0 + abs(p.x));
  if (d > 1.0) discard;
  vec3 art = texture2D(map, vec2(0.5 + p.x / 1.1, vUv.y)).rgb;
  float trame = 0.8 + 0.2 * sin(vUv.y * 260.0 - uTime * 5.0);
  float bord = smoothstep(0.86, 1.0, d);
  float monte = 1.0 - smoothstep(uReveal - 0.04, uReveal, vUv.y);
  float front = exp(-abs(vUv.y - uReveal) * 70.0) * step(uReveal, 1.0);
  float pied = smoothstep(0.0, 0.42, vUv.y);
  float scintille = 0.94 + 0.06 * sin(uTime * 31.0);
  vec3 col = art * trame * 0.9 + uColor * (bord * smoothstep(0.05, 0.45, vUv.y) * 1.6 + smoothstep(0.6, 1.0, vUv.y) * 0.22 + front * 2.5);
  gl_FragColor = vec4(col, min(1.0, monte * uOpacity * scintille * max(pied * 0.92, bord * smoothstep(0.05, 0.45, vUv.y)) + front * uOpacity));${FIN}}`;

const FS_CONE = `
uniform vec3 uColor; uniform float uOpacity, uTime; varying vec2 vUv;
void main() {
  float stries = 0.55 + 0.45 * sin(vUv.x * 37.7 + uTime * 3.0);
  gl_FragColor = vec4(uColor, mix(0.3, 1.0, 1.0 - vUv.y) * stries * 0.4 * uOpacity);${FIN}}`;

const FS_FAISCEAU = `
uniform vec3 uColor; uniform float uMode, uProgress, uOpacity, uTime; varying vec2 vUv;
void main() {
  float tirets = step(0.45, fract(vUv.x * 12.0 - uTime * 1.5)) * 0.8;
  float tete = smoothstep(uProgress - 0.45, uProgress, vUv.x) * step(vUv.x, uProgress);
  vec3 col = mix(uColor, vec3(4.0), tete * tete * uMode * 0.6);
  gl_FragColor = vec4(col, mix(tirets, tete, uMode) * uOpacity);${FIN}}`;

const FS_SOL = `
uniform vec3 uColor; varying vec3 vMonde;
void main() {
  vec2 c = vMonde.xz / vec2(${PAS.x}, ${PAS.z}) + 0.5;
  vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  float trait = 1.0 - min(min(g.x, g.y), 1.0);
  float fondu = 1.0 - smoothstep(2.0, 6.5, length(vMonde.xz * vec2(0.55, mix(1.7, 1.1, step(0.0, vMonde.z)))));
  gl_FragColor = vec4(uColor, trait * fondu * 0.45);${FIN}}`;

const FS_BALAYAGE = `
uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
void main() {
  float y = (vUv.y - 0.5) * 5.0;
  gl_FragColor = vec4(uColor, exp(-y * y) * uOpacity);${FIN}}`;

function effet(fragmentShader, uniforms, { additif = true, vertexShader = VS_UV } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uTime: TEMPS, ...uniforms },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additif ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

const uni = (value) => ({ value });

// Scène -------------------------------------------------------------------------
const canvas = document.querySelector("#plateau");
const cadre = document.querySelector(".cadre-3d");
const calque = document.querySelector(".etiquettes");
const annonce = document.querySelector("#annonce");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const CIBLE = new THREE.Vector3(0, 0, 0.1);
const decalage = { lacet: 0, tangage: 0, recul: 0, secousse: 0 };
let renderer;
let composer = null;
let distance = 12;
let qualite = "haute";

const zones = new Map();
const cibles = [];
const etiquettes = [];
const faces = new Map();
const arts = new Map();
const MAT = {};
const GEO = {};
const holo = {};
const fx = {};
let attaque = null;
let survolee = null;
let choisie = null;
let tour = 7;
let joueurTour = 1;

function geoCarte(epaisseur) {
  const g = new THREE.BoxGeometry(CARTE.l, epaisseur, CARTE.h);
  // Faces de BoxGeometry : +x, -x, +y, -y, +z, -z. Tranche, recto (dessus), dos (dessous) : 4 appels au lieu de 6.
  g.clearGroups();
  g.addGroup(0, 12, 0);
  g.addGroup(12, 6, 1);
  g.addGroup(18, 6, 2);
  g.addGroup(24, 12, 0);
  return g;
}

function matCarte(map) {
  return new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.3, roughness: 0.42, metalness: 0.05, alphaTest: 0.5 });
}

function texFace(code, voile) {
  const cle = `${code}${voile ? "v" : ""}`;
  if (!faces.has(cle)) faces.set(cle, texture(dessinerFace(code, voile)));
  return faces.get(cle);
}

function texArt(code) {
  if (!arts.has(code)) {
    const t = new THREE.Texture(ARTS.get(code));
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    arts.set(code, t);
  }
  return arts.get(code);
}

const visible = (carte) => carte.code !== 0 && !(carte.cachee && carte.camp === 1);

function construire() {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.info.autoReset = false;
  // Comme en production : pas de lecture des journaux de compilation (ANGLE y signale des avertissements du shader FXAA).
  renderer.debug.checkShaderErrors = false;

  scene.add(new THREE.HemisphereLight(0xc8d0ff, 0x2a1850, 1.3));
  const lune = new THREE.DirectionalLight(0xeef1ff, 2.2);
  lune.position.set(-3, 9, 5);
  scene.add(lune);
  for (const [nom, z] of [[CAMPS[0], 2.4], [CAMPS[1], -2.4]]) {
    const lampe = new THREE.PointLight(jeton(nom), 5, 6, 1.5);
    lampe.position.set(0, 1.4, z);
    scene.add(lampe);
  }

  GEO.carte = geoCarte(CARTE.e);
  GEO.zone = new THREE.PlaneGeometry(ZONE.l + 0.16, ZONE.p + 0.16).rotateX(-Math.PI / 2);
  MAT.tranche = new THREE.MeshStandardMaterial({ color: 0x20264f, roughness: 0.6 });
  MAT.tranchePile = new THREE.MeshStandardMaterial({ map: dessinerTranche(), roughness: 0.8 });
  MAT.dos = matCarte(texture(dessinerDos()));
  for (const camp of [0, 1]) TYPES.forEach((rangee, r) => rangee.forEach((type, col) => creerZone(camp, r, col, type)));
  construireDecor();
  construireEffets();
  poserExemple();
}

// Chaque zone a sa surbrillance, invisible au repos mais toujours touchée par le raycasting.
function creerZone(camp, rangee, col, type) {
  const cle = `${camp}:${rangee}:${col}`;
  const centre = centreZone(camp, rangee, col);
  const overlay = new THREE.Mesh(GEO.zone, effet(FS_SURBRILLANCE, { uColor: uni(new THREE.Color()), uFill: uni(0), uPulse: uni(0), uSize: uni(new THREE.Vector2(ZONE.l + 0.16, ZONE.p + 0.16)), uDemi: uni(new THREE.Vector2(ZONE.l / 2, ZONE.p / 2)) }));
  overlay.position.copy(centre).setY(0.004);
  overlay.visible = false;
  overlay.renderOrder = 2;
  overlay.userData.cle = cle;
  scene.add(overlay);
  cibles.push(overlay);
  zones.set(cle, { cle, camp, rangee, col, type, centre, overlay, carte: null, pile: null, etats: new Set() });
}

function construireDecor() {
  const tapis = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * (PLATEAU.l + 0.25), 2 * (PLATEAU.p + 0.25)).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: dessinerPlateau(zones), transparent: true, depthWrite: false, color: new THREE.Color(1.4, 1.4, 1.4) }),
  );
  tapis.renderOrder = 1;
  scene.add(tapis);
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), effet(FS_SOL, { uColor: uni(hdr("--holo", 0.5)) }, { vertexShader: VS_MONDE }));
  sol.position.y = -0.03;
  scene.add(sol);
}

function construireEffets() {
  holo.plan = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.32), effet(FS_HOLOGRAMME, { map: uni(null), uColor: uni(new THREE.Color()), uReveal: uni(0), uOpacity: uni(1) }, { additif: false }));
  holo.cone = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.32, 1, 6, 1, true), effet(FS_CONE, { uColor: uni(new THREE.Color()), uOpacity: uni(0) }));
  holo.cone.scale.y = HOLO_Y;
  holo.anneau = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  holo.plan.renderOrder = 6;
  holo.cone.renderOrder = 5;
  holo.anneau.renderOrder = 4;

  const lueur = dessinerLueur();
  const faisceau = () => effet(FS_FAISCEAU, { uColor: uni(new THREE.Color()), uMode: uni(0), uProgress: uni(0), uOpacity: uni(1) });
  fx.visee = new THREE.Mesh(new THREE.BufferGeometry(), faisceau());
  fx.tir = new THREE.Mesh(new THREE.BufferGeometry(), faisceau());
  fx.tir.material.uniforms.uMode.value = 1;
  const sprite = () => new THREE.Sprite(new THREE.SpriteMaterial({ map: lueur, blending: THREE.AdditiveBlending, depthWrite: false }));
  fx.tete = sprite();
  fx.eclat = sprite();
  fx.onde = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  fx.balayage = new THREE.Mesh(new THREE.PlaneGeometry(2 * PLATEAU.l, 0.9).rotateX(-Math.PI / 2), effet(FS_BALAYAGE, { uColor: uni(new THREE.Color()), uOpacity: uni(0) }));
  fx.balayage.position.y = 0.02;
  for (const [i, objet] of [...Object.values(holo), ...Object.values(fx)].entries()) {
    objet.visible = false;
    objet.renderOrder ||= 7 + i;
    scene.add(objet);
  }
}

function poserExemple() {
  for (const [cle, code, options = {}] of EXEMPLE) {
    const zone = zones.get(cle);
    poserCarte(zone, code, options);
    for (const etat of options.etats ?? []) marquer(zone, etat);
    if (options.maillon) {
      const maillon = new THREE.Sprite(new THREE.SpriteMaterial({ map: dessinerMaillon(options.maillon, zone.camp), depthTest: false }));
      maillon.scale.set(0.28, 0.3, 1);
      maillon.position.copy(zone.centre).add(new THREE.Vector3(0.3, 0.2, -0.43));
      maillon.renderOrder = 20;
      scene.add(maillon);
    }
  }
  choisie = zones.get("0:1:3");
  for (const [cle, nombre, code] of PILES) poserPile(zones.get(cle), nombre, code);
}

function poserCarte(zone, code, { defense = false, cachee = false } = {}) {
  const face = matCarte(code ? texFace(code, cachee && zone.camp === 0) : MAT.dos.map);
  const mesh = new THREE.Mesh(GEO.carte, [MAT.tranche, face, MAT.dos]);
  mesh.userData.cle = zone.cle;
  const groupe = new THREE.Group();
  groupe.add(mesh);
  scene.add(groupe);
  cibles.push(mesh);
  const flip = cachee && zone.camp === 1 ? Math.PI : 0;
  zone.carte = { code, camp: zone.camp, defense, cachee, face, mesh, groupe, libre: false, levee: 0, saut: 0, secousse: 0, rotY: defense ? Math.PI / 2 : 0, rotZ: flip, echelle: defense ? DEFENSE : 1 };
  return zone.carte;
}

function retirerCarte(zone) {
  const carte = zone.carte;
  if (!carte) return;
  if (holo.zone === zone) eteindre();
  scene.remove(carte.groupe);
  carte.face.dispose();
  cibles.splice(cibles.indexOf(carte.mesh), 1);
  zone.carte = null;
}

function poserPile(zone, nombre, code) {
  zone.pile = { nombre, code };
  const el = document.createElement("span");
  el.textContent = `${NOMS_ZONE[zone.type]} ${nombre}`;
  calque.append(el);
  // Monstres : libellé côté ligne médiane ; Magie/Piège : côté bord du plateau.
  const versLeBord = (zone.rangee === 1) === (zone.camp === 0);
  el.classList.toggle("haut", !versLeBord);
  etiquettes.push({ el, point: new THREE.Vector3(zone.centre.x, 0, zone.centre.z + (versLeBord ? 1 : -1) * (ZONE.p / 2 + 0.05)) });
  if (!nombre) return;
  const epaisseur = nombre * 0.0045;
  const mesh = new THREE.Mesh(geoCarte(epaisseur), [MAT.tranchePile, code ? matCarte(texFace(code, false)) : MAT.dos, MAT.dos]);
  mesh.position.set(zone.centre.x, epaisseur / 2 + 0.003, zone.centre.z);
  mesh.userData.cle = zone.cle;
  scene.add(mesh);
  cibles.push(mesh);
}

// États des zones : une surbrillance par zone, la plus importante l'emporte.
const PRIORITE = ["choisie", "survol", "visee", "attaquant", "activee", "cible"];
const STYLES = {
  choisie: { couleur: "--or", force: 2.4, fond: 0.16, pulse: 0 },
  survol: { couleur: "--holo-2", force: 1.8, fond: 0.12, pulse: 0 },
  visee: { couleur: "--danger", force: 2.6, fond: 0.14, pulse: 1 },
  attaquant: { camp: true, force: 2.2, fond: 0.1, pulse: 0 },
  activee: { camp: true, force: 1.8, fond: 0.08, pulse: 0 },
  cible: { couleur: "--holo", force: 2, fond: 0.06, pulse: 1 },
};

function majZone(zone) {
  const etat = PRIORITE.find((e) => zone.etats.has(e));
  zone.overlay.visible = Boolean(etat);
  if (!etat) return;
  const style = STYLES[etat];
  const uniforms = zone.overlay.material.uniforms;
  uniforms.uColor.value.copy(style.camp ? couleurCamp(zone.camp, style.force) : hdr(style.couleur, style.force));
  uniforms.uFill.value = style.fond;
  uniforms.uPulse.value = style.pulse;
}

function marquer(zone, etat) {
  zone.etats.add(etat);
  majZone(zone);
}

function demarquer(zone, etat) {
  zone.etats.delete(etat);
  majZone(zone);
}

// Animations : une file de fonctions k = 0..1. Durée nulle (mouvement réduit) : état final immédiat.
const anims = new Set();

function animer(secondes, maj) {
  return new Promise((fin) => {
    if (secondes <= 0) {
      maj(1);
      fin();
      return;
    }
    anims.add({ debut: maintenant(), secondes, maj, fin });
  });
}

function avancer() {
  const t = maintenant();
  for (const a of anims) {
    const k = Math.min((t - a.debut) / a.secondes, 1);
    a.maj(k);
    if (k === 1) {
      anims.delete(a);
      a.fin();
    }
  }
}

// Effets ------------------------------------------------------------------------
async function projeter(zone) {
  const carte = zone.carte;
  holo.zone = zone;
  const plan = holo.plan.material.uniforms;
  plan.map.value = texArt(carte.code);
  plan.uColor.value.copy(couleurCamp(zone.camp, 1.3));
  holo.cone.material.uniforms.uColor.value.copy(couleurCamp(zone.camp, 1.3));
  holo.anneau.material.color.copy(couleurCamp(zone.camp, 2.5));
  holo.plan.position.set(zone.centre.x, HOLO_Y + 0.66, zone.centre.z - 0.15);
  holo.cone.position.set(zone.centre.x, HOLO_Y / 2, zone.centre.z - 0.1);
  holo.anneau.position.set(zone.centre.x, 0.02, zone.centre.z);
  holo.plan.visible = holo.cone.visible = holo.anneau.visible = true;
  await animer(duree("--duree-2"), (k) => {
    const e = sortie(k);
    plan.uReveal.value = e * 1.06;
    holo.cone.material.uniforms.uOpacity.value = e;
    holo.anneau.scale.setScalar(0.7 + 2 * e);
    holo.anneau.material.opacity = 1 - k;
  });
  holo.anneau.visible = false;
}

function eteindre() {
  holo.zone = null;
  holo.plan.visible = holo.cone.visible = false;
}

function courbeAttaque(attaquant, cible) {
  const depart = new THREE.Vector3(attaquant.centre.x, HOLO_Y + 0.7, attaquant.centre.z - 0.15);
  const arrivee = cible.centre.clone().setY(0.06);
  // Courbe décalée de côté pour rester lisible quand l'attaque suit l'axe de la caméra.
  const sommet = depart.clone().lerp(arrivee, 0.5).setY(1.7);
  sommet.x += attaquant.centre.x <= cible.centre.x ? -0.9 : 0.9;
  return new THREE.QuadraticBezierCurve3(depart, sommet, arrivee);
}

function viser(attaquant, cible) {
  attaque = { attaquant, cible };
  fx.visee.geometry.dispose();
  fx.visee.geometry = new THREE.TubeGeometry(courbeAttaque(attaquant, cible), 48, 0.03, 6);
  fx.visee.material.uniforms.uColor.value.copy(couleurCamp(attaquant.camp, 1.6));
  fx.visee.visible = true;
  marquer(attaquant, "attaquant");
  marquer(cible, "visee");
}

function finAttaque() {
  if (!attaque) return;
  fx.visee.visible = false;
  demarquer(attaque.attaquant, "attaquant");
  demarquer(attaque.cible, "visee");
  attaque = null;
}

async function tirer(attaquant, cible) {
  if (holo.zone !== attaquant) await projeter(attaquant);
  const courbe = courbeAttaque(attaquant, cible);
  fx.tir.geometry.dispose();
  fx.tir.geometry = new THREE.TubeGeometry(courbe, 64, 0.06, 8);
  fx.tir.material.uniforms.uColor.value.copy(couleurCamp(attaquant.camp, 2.5));
  fx.tete.material.color.copy(couleurCamp(attaquant.camp, 3));
  fx.tir.visible = fx.tete.visible = true;
  await animer(duree("--duree-2"), (k) => {
    const e = k * k;
    fx.tir.material.uniforms.uProgress.value = e;
    fx.tete.position.copy(courbe.getPoint(e));
    fx.tete.scale.setScalar(0.5 + 0.3 * e);
  });
  fx.tir.visible = fx.tete.visible = false;
  await impact(cible);
}

async function impact(zone) {
  fx.eclat.position.copy(zone.centre).setY(0.12);
  fx.onde.position.copy(zone.centre).setY(0.02);
  fx.eclat.material.color.copy(hdr("--danger", 3));
  fx.onde.material.color.copy(hdr("--danger", 2.5));
  fx.eclat.visible = fx.onde.visible = true;
  if (zone.carte) zone.carte.secousse = 1;
  await animer(duree("--duree-4") * 0.7, (k) => {
    const e = sortie(k);
    fx.eclat.scale.setScalar(0.4 + 2.2 * e);
    fx.eclat.material.opacity = 1 - k;
    fx.onde.scale.setScalar(1 + 2.4 * e);
    fx.onde.material.opacity = 1 - k;
    decalage.secousse = 0.05 * (1 - k);
  });
  fx.eclat.visible = fx.onde.visible = false;
}

// Démo --------------------------------------------------------------------------
const PHASES = [["DP", "Draw Phase"], ["SP", "Standby Phase"], ["MP1", "Main Phase 1"], ["BP", "Battle Phase"], ["MP2", "Main Phase 2"], ["EP", "End Phase"]];
const nomCarte = (zone) => (zone.carte && visible(zone.carte) ? CARTES[zone.carte.code][0] : "une carte face cachée");

function annoncer(texte) {
  annonce.textContent = texte;
}

function decrire(zone) {
  const numero = zone.type === "monstre" || zone.type === "magie" ? ` ${zone.col}` : "";
  const lieu = `${zone.camp === 0 ? "Vous" : "Seto_K"}, ${NOMS_ZONE[zone.type]}${numero}`;
  if (zone.pile) return `${lieu} : ${zone.pile.nombre} carte${zone.pile.nombre > 1 ? "s" : ""}`;
  if (!zone.carte) return `${lieu} : vide`;
  const position = zone.carte.defense ? ", en Position de Défense" : "";
  return `${lieu} : ${nomCarte(zone)}${position}${zone.carte.cachee && zone.camp === 0 ? ", face cachée" : ""}`;
}

async function invoquer() {
  const zone = zones.get("0:0:4");
  retirerCarte(zone);
  const carte = poserCarte(zone, INVOQUEE);
  carte.libre = true;
  const rayon = new THREE.Raycaster();
  rayon.setFromCamera(new THREE.Vector2(0, -0.9), camera);
  const depart = rayon.ray.at(4.5, new THREE.Vector3());
  const arrivee = new THREE.Vector3(zone.centre.x, CARTE.e / 2 + 0.003, zone.centre.z);
  const courbe = new THREE.QuadraticBezierCurve3(depart, depart.clone().lerp(arrivee, 0.5).setY(depart.y + 0.6), arrivee);
  const inclinaison = Math.PI / 2 - TANGAGE;
  await animer(duree("--duree-4") * 0.8, (k) => {
    const e = sortie(k);
    carte.groupe.position.copy(courbe.getPoint(e));
    carte.groupe.rotation.set(inclinaison * (1 - e), 0, 0);
  });
  carte.libre = false;
  annoncer(`Invocation : ${CARTES[INVOQUEE][0]}`);
  await projeter(zone);
}

async function attaquer() {
  const [attaquant, cible] = joueurTour === 1 ? [zones.get("1:0:3"), zones.get("0:0:3")] : [zones.get("0:0:3"), zones.get("1:0:2")];
  finAttaque();
  viser(attaquant, cible);
  annoncer(`${nomCarte(attaquant)} attaque ${nomCarte(cible)}`);
  await tirer(attaquant, cible);
  finAttaque();
}

function changerPosition() {
  const carte = choisie?.type === "monstre" ? choisie.carte : null;
  if (!carte) {
    annoncer("Choisissez d'abord un monstre sur le terrain.");
    return;
  }
  // Attaque, puis Défense, puis Défense face cachée.
  if (carte.cachee) {
    carte.defense = false;
    carte.cachee = false;
  } else if (carte.defense) carte.cachee = true;
  else carte.defense = true;
  if (carte.camp === 0) {
    const map = texFace(carte.code, carte.cachee);
    carte.face.map = map;
    carte.face.emissiveMap = map;
    carte.saut = 1;
  }
  if (visible(carte)) montrerDetail(carte.code);
  annoncer(decrire(choisie));
}

function majTour() {
  const moi = joueurTour === 0;
  document.querySelector(".tour").classList.toggle("est-mon-tour", moi);
  document.querySelector(".tour .surtitre").textContent = `Tour ${tour}`;
  const nom = document.querySelector(".tour__ligne b");
  nom.textContent = moi ? "Votre tour" : "Tour de Seto_K";
  nom.className = moi ? "moi" : "adverse";
  document.querySelectorAll(".phases li").forEach((li, i) => {
    const [court, long] = PHASES[i];
    li.textContent = i === 0 ? long : court;
    li.title = i === 0 ? "" : long;
    if (i === 0) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
}

async function tourSuivant() {
  finAttaque();
  eteindre();
  joueurTour = 1 - joueurTour;
  tour += 1;
  majTour();
  const sens = joueurTour === 0 ? 1 : -1;
  const balayage = fx.balayage;
  balayage.material.uniforms.uColor.value.copy(couleurCamp(joueurTour, 1.6));
  balayage.visible = true;
  annoncer(`Tour ${tour} : ${joueurTour === 0 ? "à vous" : "à Seto_K"}`);
  await animer(duree("--duree-4") * 1.6, (k) => {
    const s = Math.sin(k * Math.PI);
    decalage.lacet = s * 0.12 * sens;
    decalage.tangage = s * 0.06;
    decalage.recul = s * 0.08;
    balayage.position.z = sens * PLATEAU.p * (1 - 2 * sortie(k));
    balayage.material.uniforms.uOpacity.value = s;
  });
  balayage.visible = false;
}

async function intro() {
  await animer(duree("--duree-4") * 1.8, (k) => {
    const e = 1 - sortie(k);
    decalage.recul = e * 0.45;
    decalage.tangage = e * 0.2;
    decalage.lacet = e * -0.3;
  });
  const attaquant = zones.get("1:0:3");
  await projeter(attaquant);
  viser(attaquant, zones.get("0:0:3"));
}

// Interaction : pointeur (raycasting) et clavier --------------------------------------
const raycaster = new THREE.Raycaster();
const pointeur = new THREE.Vector2();
let pointeurBouge = false;
let occupe = false;

function survoler(zone) {
  if (zone === survolee) return;
  if (survolee) demarquer(survolee, "survol");
  survolee = zone;
  canvas.style.cursor = zone ? "pointer" : "";
  if (!zone) return;
  marquer(zone, "survol");
  const code = zone.pile?.code ?? (zone.carte && visible(zone.carte) ? zone.carte.code : 0);
  if (code) montrerDetail(code);
}

function choisir(zone) {
  const avant = choisie;
  if (avant) demarquer(avant, "choisie");
  choisie = zone === avant ? null : zone;
  if (choisie) marquer(choisie, "choisie");
  annoncer(choisie ? `Choisi : ${decrire(choisie)}` : "Choix annulé");
}

function zoneSousPointeur() {
  raycaster.setFromCamera(pointeur, camera);
  const [touche] = raycaster.intersectObjects(cibles, false);
  return touche ? zones.get(touche.object.userData.cle) : null;
}

let lignes;
const FLECHES = new Map([["ArrowLeft", [-1, 0]], ["ArrowRight", [1, 0]], ["ArrowUp", [0, -1]], ["ArrowDown", [0, 1]]]);

function voisine(zone, dx, dy) {
  const i = lignes.findIndex((ligne) => ligne.includes(zone));
  const ligne = lignes[THREE.MathUtils.clamp(i + dy, 0, lignes.length - 1)];
  if (dy) return ligne.reduce((a, b) => (Math.abs(b.centre.x - zone.centre.x) < Math.abs(a.centre.x - zone.centre.x) ? b : a));
  return ligne[THREE.MathUtils.clamp(ligne.indexOf(zone) + dx, 0, ligne.length - 1)];
}

function ecouter() {
  // Lignes de l'écran, de haut en bas : Magie/Piège adverses, Monstres adverses, vos Monstres, vos Magie/Piège.
  lignes = [[1, 1], [1, 0], [0, 0], [0, 1]].map(([camp, r]) => [...zones.values()].filter((z) => z.camp === camp && z.rangee === r).sort((a, b) => a.centre.x - b.centre.x));
  canvas.addEventListener("pointermove", (e) => {
    pointeur.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    pointeurBouge = true;
  });
  canvas.addEventListener("pointerleave", () => survoler(null));
  canvas.addEventListener("click", () => survolee && choisir(survolee));
  canvas.addEventListener("focus", () => survolee ?? survoler(zones.get("0:0:3")));
  canvas.addEventListener("blur", () => survoler(null));
  canvas.addEventListener("keydown", (e) => {
    const fleche = FLECHES.get(e.key);
    if (fleche) {
      e.preventDefault();
      survoler(voisine(survolee ?? zones.get("0:0:3"), ...fleche));
      annoncer(decrire(survolee));
    } else if ((e.key === "Enter" || e.key === " ") && survolee) {
      e.preventDefault();
      choisir(survolee);
    } else if (e.key === "Escape" && choisie) choisir(choisie);
  });
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    repli("Le processeur graphique s'est réinitialisé : le duel continue sur le plateau 2D.");
  });

  const demo = document.querySelector(".demo");
  demo.addEventListener("click", async (e) => {
    const bouton = e.target.closest("button[data-action]");
    if (bouton) await jouer(actions[bouton.dataset.action]);
  });
  document.querySelector(".hud").addEventListener("pointerover", (e) => {
    const el = e.target.closest("[data-carte], [data-nom]");
    if (el && !el.closest(".detail")) montrerDetail(el.dataset.carte ?? el.dataset.nom);
  });
  addEventListener("resize", cadrer);
}

const actions = { invoquer, attaquer, position: changerPosition, tour: tourSuivant };

// Une action de démo à la fois ; les boutons restent focalisables (aria-disabled).
async function jouer(action) {
  if (occupe) return;
  occupe = true;
  const boutons = document.querySelectorAll(".demo button");
  for (const b of boutons) b.setAttribute("aria-disabled", "true");
  try {
    await action();
  } finally {
    occupe = false;
    for (const b of boutons) b.removeAttribute("aria-disabled");
  }
}

// Détail de carte du HUD (même balisage que maquette.js).
const panneauDetail = document.querySelector(".colonne--gauche .detail");
const NOMS_ATTR = { lumiere: "LUMIÈRE", tenebres: "TÉNÈBRES", terre: "TERRE", eau: "EAU", feu: "FEU", vent: "VENT", divin: "DIVIN" };
const stat = (v) => (v === -2 ? "?" : String(v));
const icone = (id) => `<svg class="ic" aria-hidden="true"><use href="../icons.svg#${id}"/></svg>`;

function montrerDetail(code) {
  if (!CARTES[code] || panneauDetail.dataset.detail === String(code)) return;
  const [nom, cadreType, attr, niveau, atk, def, type, texte] = CARTES[code];
  const stats = attr ? `<p class="carte__stats"><span>ATK<b>${stat(atk)}</b></span><span>DEF<b>${stat(def)}</b></span></p>` : "";
  panneauDetail.dataset.detail = code;
  panneauDetail.innerHTML = `<div class="carte t-${cadreType}${attr ? ` a-${attr}` : ""}">
      <div class="carte__art"><img src="../assets/art/${code}.jpg" alt="" draggable="false"></div>
      <span class="carte__attr">${icone(attr ? `attr-${attr}` : `type-${cadreType}`)}</span>
      ${attr ? `<span class="carte__niveau" aria-label="Niveau ${niveau}">${niveau}</span>` : ""}
      <div class="carte__infos"><p class="carte__nom">${nom}</p><p class="carte__type">${type}</p>${stats}</div>
    </div>
    <div class="detail__texte">
      <h3>${nom}</h3>
      <p class="detail__meta">${attr ? `${NOMS_ATTR[attr]} · Niveau ${niveau} · ${type}` : type}</p>
      ${attr ? `<p class="detail__stats">ATK <b>${stat(atk)}</b> DEF <b>${stat(def)}</b></p>` : ""}
      <p class="detail__desc${cadreType === "normal" ? " saveur" : ""}">${texte.replaceAll("\n", "<br>")}</p>
    </div>`;
}

// Caméra : le plateau entier tient dans le cadre réservé par le HUD, centré dessus (setViewOffset).
function poserCamera(d, lacet = 0, tangage = 0) {
  const p = TANGAGE + tangage;
  camera.position.set(Math.sin(lacet) * Math.cos(p) * d, Math.sin(p) * d, Math.cos(lacet) * Math.cos(p) * d).add(CIBLE);
  camera.lookAt(CIBLE);
  camera.updateMatrixWorld();
}

const COINS = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.Vector3(sx * PLATEAU.l, 0, sz * PLATEAU.p)));

function boite(d, l, h) {
  poserCamera(d);
  const x = [];
  const y = [];
  for (const coin of COINS) {
    const p = coin.clone().project(camera);
    x.push(p.x);
    y.push(p.y);
  }
  const [x0, x1, y0, y1] = [Math.min(...x), Math.max(...x), Math.min(...y), Math.max(...y)];
  return { l: ((x1 - x0) * l) / 2, h: ((y1 - y0) * h) / 2, cx: ((x0 + x1) / 2) * (l / 2), cy: (-(y0 + y1) / 2) * (h / 2) };
}

function cadrer() {
  const l = innerWidth;
  const h = innerHeight;
  renderer.setSize(l, h);
  composer?.setPixelRatio(renderer.getPixelRatio());
  composer?.setSize(l, h);
  camera.aspect = l / h;
  camera.clearViewOffset();
  const r = cadre.getBoundingClientRect();
  let pres = 3;
  let loin = 60;
  for (let i = 0; i < 30; i++) {
    const d = (pres + loin) / 2;
    const b = boite(d, l, h);
    if (b.l <= r.width && b.h <= r.height) loin = d;
    else pres = d;
  }
  distance = loin;
  const b = boite(distance, l, h);
  camera.setViewOffset(l, h, l / 2 + b.cx - (r.left + r.width / 2), h / 2 + b.cy - (r.top + r.height / 2), l, h);
  const bordAdverse = new THREE.Vector3(0, 0, -PLATEAU.p).project(camera);
  scene.background?.dispose();
  scene.background = dessinerFond(l, h, ((1 - bordAdverse.y) / 2) * h);
}

// Qualité : haute (bloom, FXAA, DPR ≤ 2) ; basse sans post-traitement, DPR 1. Auto : bascule si < 45 i/s.
function appliquerQualite(q) {
  qualite = q;
  renderer.setPixelRatio(q === "haute" ? Math.min(devicePixelRatio, 2) : 1);
  composer?.dispose();
  composer = null;
  if (q === "haute") {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.85));
    composer.addPass(new OutputPass());
    // FXAA plutôt que le MSAA de la cible de rendu : 4x MSAA coûtait 12 ms par image sur GPU intégré.
    composer.addPass(new FXAAPass());
  }
  cadrer();
}

const perf = { ips: 0, pireImage: 0, appels: 0, triangles: 0, textures: 0, geometries: 0, qualite: "" };
const panneauPerf = params.has("stats") ? document.querySelector("#duel").appendChild(Object.assign(document.createElement("p"), { className: "perf" })) : null;
let qualiteAuto = !params.has("qualite");
let cumul = 0;
let images = 0;
let pire = 0;
let lentes = 0;

function mesurer(dt) {
  cumul += dt;
  images += 1;
  pire = Math.max(pire, dt);
  if (cumul < 1) return;
  const { render, memory } = renderer.info;
  Object.assign(perf, { ips: Math.round(images / cumul), pireImage: Math.round(pire * 1000), appels: render.calls, triangles: render.triangles, textures: memory.textures, geometries: memory.geometries, qualite });
  cumul = 0;
  images = 0;
  pire = 0;
  if (panneauPerf) panneauPerf.textContent = `${perf.ips} i/s · pire image ${perf.pireImage} ms\n${perf.appels} appels · ${(perf.triangles / 1000).toFixed(1)} k triangles\n${perf.textures} textures · qualité ${qualite}`;
  lentes = perf.ips < 45 ? lentes + 1 : 0;
  if (qualiteAuto && lentes >= 3) {
    qualiteAuto = false;
    appliquerQualite("basse");
  }
}

// Coût d'une image hors requestAnimationFrame : n rendus synchrones (readPixels attend le GPU).
function banc(n = 120) {
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    renderer.info.reset();
    if (composer) composer.render(0.016);
    else renderer.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  }
  return { msParImage: Number(((performance.now() - t0) / n).toFixed(2)), qualite, appels: renderer.info.render.calls };
}

// Boucle -------------------------------------------------------------------------
const lisser = (dt, vitesse) => (reduit.matches ? 1 : 1 - Math.exp(-dt * vitesse));
const projete = new THREE.Vector3();
let precedent = 0;

// Les poses se rapprochent de leur cible à chaque image : k = 1 (mouvement réduit) les pose directement.
function majCarte(zone, k, retombe) {
  const c = zone.carte;
  const leve = zone.etats.has("survol") || zone.etats.has("choisie") ? 0.08 : 0;
  const flip = c.cachee && c.camp === 1 ? Math.PI : 0;
  c.levee += (leve - c.levee) * k;
  c.rotY += ((c.defense ? Math.PI / 2 : 0) - c.rotY) * k;
  c.rotZ += (flip - c.rotZ) * k;
  c.echelle += ((c.defense ? DEFENSE : 1) - c.echelle) * k;
  c.saut *= retombe;
  c.secousse *= retombe;
  // La carte se soulève pendant qu'elle se retourne ou pivote.
  const y = CARTE.e / 2 + 0.003 + c.levee + 0.32 * Math.sin(c.rotZ) + 0.1 * Math.sin(2 * c.rotY) + 0.12 * c.saut;
  c.groupe.position.set(zone.centre.x + Math.sin(TEMPS.value * 70) * 0.04 * c.secousse, y, zone.centre.z);
  c.groupe.rotation.set(0, c.rotY, c.rotZ);
  c.groupe.scale.setScalar(c.echelle);
  c.face.emissiveIntensity = zone.etats.has("survol") ? 0.5 : 0.3;
}

function majCartes(dt) {
  const k = lisser(dt, 12);
  const retombe = 1 - lisser(dt, 6);
  for (const zone of zones.values()) if (zone.carte && !zone.carte.libre) majCarte(zone, k, retombe);
}

function boucle(ms) {
  const t = ms / 1000;
  const dt = Math.min(t - precedent, 0.1);
  precedent = t;
  mesurer(dt);
  avancer();
  TEMPS.value = reduit.matches ? 0 : t;
  if (pointeurBouge) {
    pointeurBouge = false;
    survoler(zoneSousPointeur());
  }
  majCartes(dt);
  poserCamera(distance * (1 + decalage.recul), decalage.lacet, decalage.tangage);
  if (decalage.secousse > 0.001) {
    camera.position.x += Math.sin(t * 91) * decalage.secousse;
    camera.position.y += Math.cos(t * 73) * decalage.secousse;
    camera.updateMatrixWorld();
  }
  if (holo.zone) {
    holo.plan.lookAt(camera.position.x, holo.plan.position.y, camera.position.z);
    holo.plan.rotateX(-0.28);
  }
  for (const { el, point } of etiquettes) {
    projete.copy(point).project(camera);
    el.style.translate = `${((projete.x + 1) / 2) * innerWidth}px ${((1 - projete.y) / 2) * innerHeight}px`;
  }
  renderer.info.reset();
  if (composer) composer.render(dt);
  else renderer.render(scene, camera);
}

// Démarrage : WebGL 2 requis (three r163+), sinon le plateau 2D.
function repli(raison) {
  cadre.innerHTML = `<div class="panneau message-3d"><p class="surtitre">Plateau en 2D</p><p>${raison}</p><p><a class="lien" href="../maquette/index.html#duel">Voir le plateau 2D</a></p></div>`;
  canvas.hidden = true;
}

function creerRendu() {
  if (params.has("repli") || !document.createElement("canvas").getContext("webgl2")) return null;
  try {
    return new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
}

renderer = creerRendu();
if (renderer) {
  await charger();
  construire();
  ecouter();
  appliquerQualite(params.get("qualite") === "basse" ? "basse" : "haute");
  renderer.setAnimationLoop(boucle);
  canvas.classList.add("est-pret");
  cadre.replaceChildren();
  window.plateau = { perf, qualite: appliquerQualite, banc, demo: (nom) => jouer(actions[nom]) };
  await jouer(intro);
} else {
  repli("Votre navigateur n'affiche pas la 3D (WebGL 2 indisponible) : le duel se joue sur le plateau 2D.");
}
