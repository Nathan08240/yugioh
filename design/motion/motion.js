// Démo du mouvement : séquences en Web Animations API, sans bibliothèque. Durées et courbes lues dans tokens.css.
import { CARTES } from "../assets/cartes.js";
import { remplirCarte } from "../maquette/maquette.js";

const $ = (sel, el = document) => el.querySelector(sel);
const racine = document.documentElement;
const jeton = (nom) => getComputedStyle(racine).getPropertyValue(nom).trim();
const ms = (nom) => Number.parseFloat(jeton(nom)) || 0;
const [D1, D2, D3, D4] = [1, 2, 3, 4].map((n) => ms(`--duree-${n}`));
const FONDU = ms("--duree-fondu");
const SORTIE = jeton("--courbe-sortie") || "ease-out";
const RESSORT = jeton("--courbe-ressort") || "ease-out";
const ELAN = jeton("--courbe-elan") || "ease-in";
const C = Object.fromEntries(["holo", "or", "danger", "camp-moi", "camp-adverse", "type-fusion", "attr-feu", "texte-2"].map((n) => [n, jeton(`--${n}`)]));
const PRISME = ["#ff5a8a", "#ffc53d", "#6dff9e", "#43f0ff", "#8b7dff", "#ff5ad9"];

// Réduction des animations : préférence système, ou case à cocher pour la tester
const mq = matchMedia("(prefers-reduced-motion: reduce)");
const bascule = $("#reduit");
function suivreReduction() {
  if (mq.matches) bascule.checked = true;
  bascule.disabled = mq.matches;
  racine.classList.toggle("reduit", bascule.checked);
}
mq.addEventListener("change", suivreReduction);
bascule.addEventListener("change", suivreReduction);
suivreReduction();
const reduit = () => bascule.checked;

// Séquence en cours : « passer » termine toutes ses animations et ses pauses
const nouvelleSeq = () => ({ vite: false, anims: new Set(), reveils: new Set(), fin: null });
let seq = nouvelleSeq();
let generation = 0;
const decor = () => reduit() || seq.vite;

// En réduction, l'état final est appliqué tout de suite et seul le fondu d'opacité reste.
function anim(el, images, { duree = D3, courbe = SORTIE, delai = 0 } = {}) {
  const s = seq;
  const jouer = (i, options) => {
    const a = el.animate(i, { fill: "both", ...options });
    s.anims.add(a);
    return a.finished.catch(() => {});
  };
  if (!reduit()) return jouer(images, { duration: s.vite ? 0 : duree, delay: s.vite ? 0 : delai, easing: courbe });
  const fin = jouer(images, { duration: 0 });
  const o = images.map((i) => i.opacity).filter((x) => x !== undefined);
  if (s.vite || o.length < 2 || o[0] === o.at(-1)) return fin;
  return jouer([{ opacity: o[0] }, { opacity: o.at(-1) }], { duration: FONDU });
}

// lecture : temps laissé pour lire, gardé en réduction
function pause(duree, lecture = false) {
  const s = seq;
  if (s.vite || (reduit() && !lecture)) return Promise.resolve();
  return new Promise((resoudre) => {
    const fin = () => {
      clearTimeout(minuteur);
      s.reveils.delete(fin);
      resoudre();
    };
    const minuteur = setTimeout(fin, duree);
    s.reveils.add(fin);
  });
}

function passer() {
  seq.vite = true;
  for (const a of seq.anims) a.finish();
  for (const r of [...seq.reveils]) r();
}

async function lancer(scene, nom, fn) {
  const mienne = ++generation;
  if (seq.fin) {
    passer();
    await seq.fin;
  }
  if (mienne !== generation) return;
  seq = nouvelleSeq();
  const s = seq;
  $("#annonce").textContent = nom;
  scene.setAttribute("aria-busy", "true");
  s.fin = fn()
    .catch((e) => console.error(e))
    .finally(() => {
      scene.removeAttribute("aria-busy");
      s.fin = null;
    });
}

// Géométrie : centre et taille d'un élément dans le repère de sa scène
function boite(el) {
  const s = el.closest(".scene-demo").getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, l: r.width, h: r.height };
}

function dansCouche(scene, classe, { x, y, l, h }, style = "") {
  const el = document.createElement("div");
  el.className = classe;
  el.style.cssText = `${style};left:${x - l / 2}px;top:${y - h / 2}px;inline-size:${l}px;block-size:${h}px`;
  $(".couche", scene).append(el);
  return el;
}

// Copie volante d'une carte, posée dans la couche au-dessus de la scène
function fantome(carte) {
  const b = boite(carte);
  const vol = dansCouche(carte.closest(".scene-demo"), "vol", { x: b.x, y: b.y, l: carte.offsetWidth, h: carte.offsetHeight });
  const copie = carte.cloneNode(true);
  copie.style.cssText = `--carte-l:${carte.offsetWidth}px;margin:0;translate:none;opacity:${carte.style.opacity || 1};rotate:${getComputedStyle(carte).rotate}`;
  vol.append(copie);
  return vol;
}

function voler(vol, cible, { duree = D3, courbe = SORTIE } = {}) {
  const vers = cible instanceof Element ? boite(cible) : cible;
  const rot = cible instanceof Element ? getComputedStyle(cible).rotate : "0deg";
  const x0 = vol.offsetLeft + vol.offsetWidth / 2;
  const y0 = vol.offsetTop + vol.offsetHeight / 2;
  const k = (cible instanceof Element ? cible.offsetWidth || vers.l : vers.l) / vol.offsetWidth;
  const copie = vol.firstElementChild;
  anim(copie, [{ rotate: getComputedStyle(copie).rotate }, { rotate: rot }], { duree, courbe });
  return anim(vol, [{ transform: getComputedStyle(vol).transform }, { transform: `translate(${vers.x - x0}px, ${vers.y - y0}px) scale(${k})` }], { duree, courbe });
}

// Retournement : la carte s'écrase sur sa largeur, change de face, se rouvre
async function retourner(carte, changer, duree = D3) {
  const s = getComputedStyle(carte).scale;
  const [sx, sy = sx] = s === "none" ? [1] : s.split(" ").map(Number);
  await anim(carte, [{ scale: `${sx} ${sy}` }, { scale: `0 ${sy}` }], { duree: duree / 2, courbe: ELAN });
  changer();
  await anim(carte, [{ scale: `0 ${sy}` }, { scale: `${sx} ${sy}` }], { duree: duree / 2 });
}

function montrer(carte, code, classes = "") {
  carte.className = `carte ${classes}`;
  carte.dataset.carte = code;
  remplirCarte(carte);
}

// Déplacement FLIP : les éléments glissent de leur ancienne place à la nouvelle
function deplacer(elements, muter) {
  const avant = elements.map((e) => e.getBoundingClientRect());
  muter();
  return Promise.all(
    elements.map((e, i) => {
      const r = e.getBoundingClientRect();
      const dx = avant[i].left - r.left;
      const dy = avant[i].top - r.top;
      if (!e.isConnected || (!dx && !dy)) return null;
      return anim(e, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }]);
    }),
  );
}

// Effets décoratifs : absents en réduction et quand on passe
function onde(zone, couleur = "") {
  if (decor()) return;
  const o = document.createElement("span");
  o.className = "onde";
  if (couleur) o.style.setProperty("--c", couleur);
  zone.append(o);
  anim(o, [{ opacity: 1, transform: "scale(0.7)" }, { opacity: 0, transform: "scale(1.6)" }]).then(() => o.remove());
}

function ondeSur(el, couleur) {
  if (decor()) return;
  const o = dansCouche(el.closest(".scene-demo"), "onde", boite(el), `inset:auto;--c:${couleur}`);
  anim(o, [{ opacity: 1, transform: "scale(0.9)" }, { opacity: 0, transform: "scale(1.5)" }], { duree: D4 }).then(() => o.remove());
}

function flash(scene, { x, y }, couleur = "rgb(255 255 255 / 0.9)") {
  if (decor()) return;
  const f = document.createElement("div");
  f.className = "flash";
  f.style.cssText = `--x:${x}px;--y:${y}px;--f:${couleur}`;
  $(".couche", scene).append(f);
  anim(f, [{ opacity: 0 }, { opacity: 0.85, offset: 0.25 }, { opacity: 0 }]).then(() => f.remove());
}

function secousse(el, a = 4) {
  return anim(el, [0, a, -a, a / 2, 0].map((x) => ({ translate: `${x}px 0` })), { duree: D2, courbe: "linear" });
}

function particules(de, vers, couleur) {
  if (decor()) return;
  const scene = de.closest(".scene-demo");
  const a = boite(de);
  const b = vers instanceof Element ? boite(vers) : vers;
  for (let i = 0; i < 8; i++) {
    const x = a.x + (((i * 0.618) % 1) - 0.5) * a.l;
    const y = a.y + (((i * 0.382) % 1) - 0.5) * a.h;
    const p = dansCouche(scene, "particule", { x, y, l: 7, h: 7 }, `--c:${couleur}`);
    anim(p, [{ opacity: 1, transform: "none" }, { opacity: 0.2, transform: `translate(${b.x - x}px, ${b.y - y}px) scale(0.5)` }], { duree: D3 + D2, delai: i * 30 }).then(() => p.remove());
  }
}

function eclats(scene, { x, y }, { n = 8, distance = 50, couleurs = ["#fff"] } = {}) {
  if (decor()) return;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 2 * Math.PI;
    const d = distance * (0.7 + ((i * 0.618) % 1) * 0.6);
    const e = dansCouche(scene, "eclat", { x, y, l: 9, h: 18 }, `--c:${couleurs[i % couleurs.length]}`);
    const depart = `rotate(${angle + Math.PI / 2}rad)`;
    anim(e, [{ opacity: 1, transform: depart }, { opacity: 0, transform: `translate(${Math.cos(angle) * d}px, ${Math.sin(angle) * d}px) ${depart} scale(0.4)` }], { duree: D3 + D2 }).then(() => e.remove());
  }
}

function disparaitre(el) {
  return anim(el, [{ opacity: 1 }, { opacity: 0 }], { duree: D2 }).then(() => el.remove());
}

const remplirTout = (el) => el.querySelectorAll("[data-carte]").forEach(remplirCarte);
const icone = (id) => `<svg class="ic" aria-hidden="true"><use href="../icons.svg#${id}"/></svg>`;
const carte = (code, classes = "") => `<div class="carte ${classes}" data-carte="${code}"></div>`;

/* Duel ------------------------------------------------------------------ */

const sceneDuel = $("#scene-duel");
const zone = (z) => $(`[data-z="${z}"]`, sceneDuel);
const deMain = (code) => $(`.main-demo [data-carte="${code}"]`, sceneDuel);
const DOS = '<div class="carte dos"></div>';
const nb = (libelle, n) => `<span class="zone__nb" data-libelle="${libelle}" data-n="${n}">${libelle} ${n}</span>`;
const TERRAINS = new Set(["7-2", "1-4"]);
const CIMETIERE_MOI = "7-4";
const CIMETIERE_ADV = "1-2";
// Colonne-rangée : 1 et 2 à l'adversaire, 4 et 5 à vous (comme la maquette)
const DEPART = new Map([
  ["1-1", DOS + nb("Deck", 24)],
  ["3-1", DOS],
  ["7-1", DOS + nb("Extra", 1)],
  ["1-2", carte(43973174) + nb("Cimetière", 5)],
  ["3-2", carte(91152256)],
  ["4-2", carte(89631139)],
  ["5-2", '<div class="carte dos est-defense"></div>'],
  ["2-4", carte(75356564)],
  ["3-4", carte(46986414)],
  ["5-4", carte(6368038)],
  ["6-4", carte(28279543)],
  ["7-4", carte(55144522) + nb("Cimetière", 4)],
  ["1-5", DOS + nb("Extra", 1)],
  ["3-5", carte(44095762, "est-posee")],
  ["7-5", DOS + nb("Deck", 27)],
]);
const MAIN = [43230671, 70781052, 24094653, 12607053, 511600399];
const PHASES = [["DP", "Draw Phase"], ["SP", "Standby Phase"], ["MP1", "Main Phase 1"], ["BP", "Battle Phase"], ["MP2", "Main Phase 2"], ["EP", "End Phase"]];

function plateauHtml() {
  let zones = "";
  for (const r of [1, 2, 4, 5]) {
    for (let c = 1; c <= 7; c++) {
      const z = `${c}-${r}`;
      const classes = ["zone", r < 3 ? "zone--adv" : "", TERRAINS.has(z) ? "zone--terrain" : ""].join(" ");
      zones += `<div class="${classes}" data-z="${z}" style="--c:${c};--r:${r}">${DEPART.get(z) ?? ""}</div>`;
    }
  }
  return `<div class="plateau-demo" aria-hidden="true"><div class="tapis"><div class="tapis__milieu"></div>${zones}</div></div>`;
}

function plaqueHtml(camp, initiale, nom, libelle, [main, deck], active) {
  return `<div class="plaque plaque--${camp}${active ? " est-active" : ""}">
    <span class="avatar" aria-hidden="true">${initiale}</span>
    <div class="plaque__id"><b>${nom}</b><span class="compteurs"><span>${icone("ui-cartes")}<span class="sr">Main</span>${main}</span><span>${icone("ui-deck")}<span class="sr">Deck</span>${deck}</span></span></div>
    <div class="lp" data-libelle="${libelle}" aria-label="${libelle} : 4000 sur 4000"><span class="lp__valeur chiffres">4000</span><span class="lp__barre" style="--v: 100%"></span></div>
  </div>`;
}

const phasesHtml = (courante) =>
  PHASES.map(([court, long], n) => {
    if (n === courante) return `<li aria-current="step">${long}</li>`;
    return `<li class="${n < courante ? "passee" : ""}" title="${long}">${court}</li>`;
  }).join("");

function construireDuel() {
  sceneDuel.innerHTML = `${plateauHtml()}
  <div class="hud-demo">
    ${plaqueHtml("adverse", "S", "Seto_K", "Points de vie de Seto_K", [3, 24], false)}
    <div class="tour"><div class="tour__ligne"><p><span class="surtitre">Tour 7</span><b class="moi">Votre tour</b></p></div><ol class="phases" aria-label="Phases du tour">${phasesHtml(2)}</ol></div>
    <section class="panneau chaine" aria-label="Chaîne"><h3 class="titre-bloc">${icone("ui-chaine")}Chaîne</h3><ol reversed></ol><p class="note">Résolution du dernier maillon au premier.</p></section>
    ${plaqueHtml("moi", "P", "Pharaon_08", "Vos points de vie", [5, 27], true)}
    <div class="main-demo" aria-label="Votre main">${MAIN.map((c) => carte(c)).join("")}</div>
  </div>
  <div class="voile"></div><div class="vignette"></div><div class="bandes"></div><p class="nom-divin"></p>
  <div class="bandeau" aria-hidden="true"><p class="surtitre"></p><p class="bandeau__titre"></p></div>
  <div class="couche"></div><p class="aide-scene">Cliquez pour passer</p>`;
  remplirTout(sceneDuel);
  eventail($(".main-demo", sceneDuel));
}

function eventail(main) {
  const cartes = [...main.children];
  cartes.forEach((c, i) => {
    const k = i - (cartes.length - 1) / 2;
    c.style.setProperty("--rot", `${k * 4}deg`);
    c.style.setProperty("--y", `${Math.abs(k) * 6}px`);
  });
}

function retirerDeMain(c) {
  const main = c.parentElement;
  return deplacer(
    [...main.children].filter((x) => x !== c),
    () => {
      c.remove();
      eventail(main);
    },
  );
}

function dansZone(z, code, classes = "") {
  z.insertAdjacentHTML("afterbegin", carte(code, classes));
  remplirCarte(z.firstElementChild);
  return z.firstElementChild;
}

// Atterrissage : la carte tombe sur sa zone et accélère jusqu'à l'impact
function atterrir(el, z, lourd = false) {
  onde(z, lourd ? C.or : "");
  if (lourd) secousse($(".tapis", sceneDuel), 3);
  const hauteur = lourd ? 70 : 34;
  return anim(el, [{ opacity: 0, transform: `translateZ(${hauteur}px) scale(1.15)` }, { opacity: 1, transform: "none" }], { duree: lourd ? D3 : D2, courbe: ELAN });
}

function poserDoux(el, z) {
  onde(z, "rgb(150 170 255 / 0.5)");
  return anim(el, [{ opacity: 0, transform: "translateZ(18px)" }, { opacity: 1, transform: "none" }], { duree: D2 });
}

// De la main à une zone : la carte se lève, vole, se pose (face cachée si classes)
async function versZone(c, z, { classes = "", lourd = false } = {}) {
  const code = c.dataset.carte;
  await anim(c, [{ transform: "none" }, { transform: "translateY(-28px) scale(1.06)" }], { duree: D1 });
  const vol = reduit() ? null : fantome(c);
  const rangement = retirerDeMain(c);
  if (vol) {
    const copie = vol.firstElementChild;
    const retour = classes ? retourner(copie, () => copie.classList.add(...classes.split(" "))) : null;
    await Promise.all([voler(vol, z), retour]);
    vol.remove();
  }
  await rangement;
  const el = dansZone(z, code, classes);
  await (classes ? poserDoux(el, z) : atterrir(el, z, lourd));
  return el;
}

// Hologramme : seul le monstre qui agit se projette au-dessus de sa carte
async function hologramme(z, code) {
  const h = document.createElement("div");
  h.className = "hologramme";
  h.innerHTML = `<img src="../assets/art/${code}.jpg" alt="">`;
  z.append(h);
  await anim(h, [{ opacity: 0, scale: "1 0.1", filter: "brightness(2.5)" }, { opacity: 0.9, scale: "1 1", filter: "brightness(1)" }], { duree: D2 });
  return h;
}

async function baisser(h) {
  await anim(h, [{ opacity: 0.9, scale: "1 1" }, { opacity: 0, scale: "1 0.4" }], { duree: D2, courbe: ELAN });
  h.remove();
}

async function compter(z, delta) {
  const n = $(".zone__nb", z);
  n.dataset.n = Number(n.dataset.n) + delta;
  n.textContent = `${n.dataset.libelle} ${n.dataset.n}`;
  await anim(n, [{ transform: "scale(1.4)", color: C.or }, { transform: "none", color: C["texte-2"] }], { courbe: RESSORT });
}

// Le compteur s'anime sans retenir la séquence
function auCimetiere(z, code) {
  const ancienne = $(".carte", z);
  dansZone(z, code);
  ancienne?.remove();
  compter(z, 1);
}

// Envoi au Cimetière : une copie translucide rejoint la pile, le compteur s'incrémente
async function envoyer(c, z) {
  const code = c.dataset.carte;
  if (reduit()) {
    await anim(c, [{ opacity: 1 }, { opacity: 0 }]);
    c.remove();
  } else {
    const vol = fantome(c);
    c.remove();
    await voler(vol, z);
    vol.remove();
  }
  auCimetiere(z, code);
}

async function briser(c) {
  const b = boite(c);
  const scene = c.closest(".scene-demo");
  const moities = ["inset(0 50% 0 0)", "inset(0 0 0 50%)"].map((clip) => {
    const m = dansCouche(scene, "vol", { x: b.x, y: b.y, l: c.offsetWidth, h: c.offsetHeight });
    const copie = c.cloneNode(true);
    copie.classList.add("moitie");
    copie.style.cssText = `--carte-l:${c.offsetWidth}px;margin:0;clip-path:${clip};rotate:${getComputedStyle(c).rotate}`;
    m.append(copie);
    return m;
  });
  c.style.opacity = "0";
  eclats(scene, b, { couleurs: ["#fff", C.danger] });
  await Promise.all(
    moities.map((m, i) => {
      const s = i ? 1 : -1;
      return anim(m, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translate(${s * 18}px, 14px) rotate(${s * 16}deg)` }], { courbe: ELAN });
    }),
  );
  moities.forEach((m) => m.remove());
  c.style.opacity = "0.45";
}

async function detruire(c, z) {
  if (!reduit()) await briser(c);
  await envoyer(c, z);
}

// Compteur de LP : pastille de perte, chiffres qui défilent, barre qui se vide
function compterLP(plaque, perte) {
  const s = seq;
  const lp = $(".lp", plaque);
  const valeur = $(".lp__valeur", lp);
  const barre = $(".lp__barre", lp);
  const de = Number(valeur.textContent);
  const a = Math.max(0, de - perte);
  const delta = $(".lp__delta", lp) ?? document.createElement("span");
  delta.className = "lp__delta";
  delta.textContent = `−${perte}`;
  valeur.after(delta);
  anim(delta, [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], { duree: D2, courbe: RESSORT });
  anim(plaque, [{ boxShadow: `0 0 0 2px ${C.danger}, 0 0 30px ${C.danger}` }, { boxShadow: getComputedStyle(plaque).boxShadow }], { duree: D4 });
  const t0 = performance.now();
  return new Promise((resoudre) => {
    const pas = (t) => {
      const p = s.vite || reduit() ? 1 : Math.min(1, (t - t0) / D4);
      const x = de + (a - de) * (1 - (1 - p) ** 3);
      valeur.textContent = Math.round(x);
      barre.style.setProperty("--v", `${x / 40}%`);
      if (p < 1) {
        requestAnimationFrame(pas);
        return;
      }
      lp.classList.toggle("est-bas", a <= 1000);
      lp.setAttribute("aria-label", `${lp.dataset.libelle} : ${a} sur 4000`);
      resoudre();
    };
    requestAnimationFrame(pas);
  });
}

async function degats(point, texte) {
  const d = dansCouche(sceneDuel, "degats", { ...point, l: 0, h: 0 });
  d.textContent = texte;
  await anim(d, [{ opacity: 0, transform: "scale(1.6)" }, { opacity: 1, transform: "none" }], { duree: D2, courbe: RESSORT });
  await pause(500, true);
  await anim(d, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-36px)" }], { duree: D4 });
  d.remove();
}

async function rayon(a, b, couleur) {
  const r = dansCouche(sceneDuel, "rayon-attaque", { x: a.x, y: a.y, l: 0, h: 6 }, `--c:${couleur}`);
  r.style.inlineSize = `${Math.hypot(b.x - a.x, b.y - a.y)}px`;
  r.style.rotate = `${Math.atan2(b.y - a.y, b.x - a.x)}rad`;
  await anim(r, [{ scale: "0 1" }, { scale: "1 1" }], { duree: D2, courbe: ELAN });
  return r;
}

function majPhases(courante) {
  [...$(".phases", sceneDuel).children].forEach((li, n) => {
    const [court, long] = PHASES[n];
    if (n === courante) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
    li.classList.toggle("passee", n < courante);
    li.textContent = n === courante ? long : court;
  });
}

async function bandeau(surtitre, titre, adverse = false) {
  const b = $(".bandeau", sceneDuel);
  const t = $(".bandeau__titre", b);
  b.classList.toggle("bandeau--adverse", adverse);
  $(".surtitre", b).textContent = surtitre;
  t.textContent = titre;
  await Promise.all([
    anim(b, [{ opacity: 0, clipPath: "inset(0 50%)" }, { opacity: 1, clipPath: "inset(0 0%)" }], { duree: D2 }),
    anim(t, [{ opacity: 0, letterSpacing: "0.5em" }, { opacity: 1, letterSpacing: "0.08em" }], { delai: D1 }),
  ]);
  await pause(700, true);
  await anim(b, [{ opacity: 1, translate: "0 -50%" }, { opacity: 0, translate: "-8% -50%" }], { duree: D2, courbe: ELAN });
}

async function pioche() {
  const main = $(".main-demo", sceneDuel);
  const deck = zone("7-5");
  const nouvelle = document.createElement("div");
  montrer(nouvelle, 55144522);
  nouvelle.style.opacity = "0";
  const rangement = deplacer([...main.children], () => {
    main.append(nouvelle);
    eventail(main);
  });
  compter(deck, -1);
  if (!reduit()) {
    const vol = fantome($(".carte", deck));
    const copie = vol.firstElementChild;
    await anim(vol, [{ transform: "none" }, { transform: "translateY(-16px) scale(1.15)" }], { duree: D2 });
    await Promise.all([voler(vol, nouvelle), retourner(copie, () => montrer(copie, 55144522))]);
    vol.remove();
  }
  await rangement;
  nouvelle.style.opacity = "";
  if (reduit()) await anim(nouvelle, [{ opacity: 0 }, { opacity: 1 }]);
  else await anim(nouvelle, [{ transform: "translateY(-12px)" }, { transform: "none" }], { duree: D2, courbe: RESSORT });
}

async function phase() {
  majPhases(3);
  await bandeau("Phase", "Battle Phase");
}

async function tour() {
  majPhases(5);
  await pause(D3 + D2);
  const t = $(".tour", sceneDuel);
  const qui = $("b", t);
  t.classList.add("tour--adverse");
  $(".surtitre", t).textContent = "Tour 8";
  qui.className = "adverse";
  qui.textContent = "Tour de Seto_K";
  majPhases(0);
  $(".plaque--moi", sceneDuel).classList.remove("est-active");
  $(".plaque--adverse", sceneDuel).classList.add("est-active");
  await bandeau("Tour 8", "Seto_K", true);
}

async function invocation() {
  const z = zone("4-4");
  await versZone(deMain(43230671), z);
  const h = await hologramme(z, 43230671);
  await pause(400, true);
  await baisser(h);
}

async function dissoudre(zt, vers, couleur = C.holo) {
  const c = $(".carte", zt);
  const code = c.dataset.carte;
  particules(c, vers, couleur);
  await anim(c, [{ opacity: 1, filter: "brightness(1)", transform: "none" }, { opacity: 0, filter: "brightness(3)", transform: "translateZ(40px) scale(0.6)" }], { courbe: ELAN });
  c.remove();
  auCimetiere(zone(CIMETIERE_MOI), code);
}

async function sacrifice() {
  const z = zone("4-4");
  await dissoudre(zone("2-4"), z);
  await versZone(deMain(70781052), z, { lourd: true });
  const h = await hologramme(z, 70781052);
  await pause(500, true);
  await baisser(h);
}

function vortex(z) {
  if (decor()) return null;
  const b = boite(z);
  const v = dansCouche(sceneDuel, "vortex", { x: b.x, y: b.y, l: b.l * 3, h: b.l * 3 });
  anim(v, [{ opacity: 0, transform: "scaleY(0.55) scale(0.2) rotate(0deg)" }, { opacity: 1, transform: "scaleY(0.55) scale(1) rotate(540deg)" }], { duree: D4 + D3, courbe: "linear" });
  return v;
}

function aspirer(m, z, i) {
  const dx = z.offsetLeft - m.parentElement.offsetLeft;
  const dy = z.offsetTop - m.parentElement.offsetTop;
  const sens = i ? -1 : 1;
  return anim(
    m,
    [
      { opacity: 1, transform: "none" },
      { opacity: 1, transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 30}px) rotate(${sens * 140}deg) scale(0.8)`, offset: 0.5 },
      { opacity: 0, transform: `translate(${dx}px, ${dy}px) rotate(${sens * 320}deg) scale(0.15)` },
    ],
    { duree: D4, courbe: ELAN },
  );
}

async function activer(c, z, maillon = 0) {
  await anim(c, [{ transform: "none" }, { transform: "translateZ(22px) scale(1.12)" }], { duree: D2 });
  c.classList.remove("est-posee");
  c.classList.add("est-activee");
  onde(z, getComputedStyle(z).getPropertyValue("--camp"));
  if (maillon) poserMaillon(z, maillon);
  await anim(c, [{ transform: "translateZ(22px) scale(1.12)" }, { transform: "none" }]);
}

function poserMaillon(z, n) {
  const m = document.createElement("span");
  m.className = z.classList.contains("zone--adv") ? "maillon maillon--adverse" : "maillon";
  m.textContent = n;
  z.append(m);
  return anim(m, [{ opacity: 0, transform: "scale(0)" }, { opacity: 1, transform: "none" }], { courbe: RESSORT });
}

async function fusion() {
  const z = zone("4-4");
  const zm = zone("5-5");
  const poly = await versZone(deMain(24094653), zm);
  activer(poly, zm);
  const materiaux = ["5-4", "6-4"].map((x) => $(".carte", zone(x)));
  const v = vortex(z);
  await Promise.all(materiaux.map((m, i) => aspirer(m, z, i)));
  flash(sceneDuel, boite(z), "rgb(155 92 255 / 0.9)");
  const codes = materiaux.map((m) => m.dataset.carte);
  materiaux.forEach((m) => m.remove());
  onde(z, C["type-fusion"]);
  await Promise.all([atterrir(dansZone(z, 66889139), z, true), v && disparaitre(v)]);
  const h = await hologramme(z, 66889139);
  codes.forEach((code) => auCimetiere(zone(CIMETIERE_MOI), code));
  await Promise.all([pause(500, true), envoyer(poly, zone(CIMETIERE_MOI))]);
  await baisser(h);
}

async function hologrammeDivin(z, code) {
  const b = boite(z);
  const l = sceneDuel.clientHeight * 0.36;
  const h = dansCouche(sceneDuel, "holo-dieu", { x: b.x, y: b.y - l * 0.62, l, h: l * 1.1 });
  h.innerHTML = `<img src="../assets/art/${code}.jpg" alt="">`;
  await anim(h, [{ opacity: 0, transform: "scaleY(0.1)", filter: "brightness(3)" }, { opacity: 1, transform: "none", filter: "brightness(1)" }], { duree: D4 });
  return h;
}

function aura(z) {
  if (decor()) return null;
  const b = boite(z);
  const a = dansCouche(sceneDuel, "aura", { x: b.x, y: b.y, l: b.l * 4, h: b.l * 2.6 });
  anim(a, [{ opacity: 0, transform: "scale(0.3)" }, { opacity: 1, transform: "none" }], { duree: D4 });
  return a;
}

async function dieu() {
  const z = zone("4-4");
  const c = deMain(511600399);
  const voile = $(".voile", sceneDuel);
  const bandes = $(".bandes", sceneDuel);
  const nom = $(".nom-divin", sceneDuel);
  const tapis = $(".tapis", sceneDuel);
  anim(voile, [{ opacity: 0 }, { opacity: 1 }]);
  anim(bandes, [{ opacity: 0, transform: "scaleY(1.35)" }, { opacity: 1, transform: "none" }]);
  await anim(c, [{ transform: "none" }, { transform: "translateY(-28px) scale(1.06)" }], { duree: D2 });
  const vol = reduit() ? null : fantome(c);
  const rangement = retirerDeMain(c);
  if (vol) await voler(vol, { x: sceneDuel.clientWidth / 2, y: sceneDuel.clientHeight * 0.4, l: c.offsetWidth * 1.7 });
  await rangement;
  await Promise.all(["2-4", "5-4", "6-4"].map((x, i) => pause(i * D1).then(() => dissoudre(zone(x), vol ?? z, C["attr-feu"]))));
  const halo = aura(z);
  secousse(tapis, 3);
  await pause(D2);
  if (vol) {
    await voler(vol, z, { duree: D2, courbe: ELAN });
    vol.remove();
  }
  flash(sceneDuel, boite(z), "rgb(255 197 61 / 0.9)");
  secousse(tapis, 7);
  await atterrir(dansZone(z, 511600399), z, true);
  nom.textContent = CARTES[511600399][0];
  const [h] = await Promise.all([hologrammeDivin(z, 511600399), anim(nom, [{ opacity: 0, letterSpacing: "0.4em" }, { opacity: 1, letterSpacing: "0.08em" }], { duree: D4, delai: D2 })]);
  await pause(1000, true);
  await Promise.all([voile, bandes, nom, h, halo].filter(Boolean).map((x) => anim(x, [{ opacity: 1 }, { opacity: 0 }])));
  h.remove();
  halo?.remove();
}

async function poser() {
  await versZone(deMain(12607053), zone("4-5"), { classes: "est-posee" });
}

async function retournement() {
  const c = $(".carte", zone("5-2"));
  const ombre = getComputedStyle(c).boxShadow;
  await anim(c, [{ transform: "none" }, { transform: "translateZ(16px)" }], { duree: D1 });
  await retourner(c, () => montrer(c, 13039848, "est-defense"));
  anim(c, [{ boxShadow: `0 0 0 2px ${C["camp-adverse"]}, 0 0 26px ${C["camp-adverse"]}` }, { boxShadow: ombre }], { duree: D4 });
  await anim(c, [{ transform: "translateZ(16px)" }, { transform: "none" }], { duree: D2, courbe: ELAN });
}

async function attaque() {
  const za = zone("3-4");
  const zc = zone("3-2");
  const cible = $(".carte", zc);
  const h = await hologramme(za, 46986414);
  zc.classList.add("zone--visee");
  const r = await rayon(boite(za), boite(zc), C["camp-moi"]);
  flash(sceneDuel, boite(zc));
  onde(zc, C.danger);
  secousse(cible, 5);
  degats(boite(zc), "−1100");
  disparaitre(r);
  const lp = compterLP($(".plaque--adverse", sceneDuel), 1100);
  await detruire(cible, zone(CIMETIERE_ADV));
  zc.classList.remove("zone--visee");
  await Promise.all([lp, baisser(h)]);
}

async function directe() {
  const za = zone("4-2");
  const moi = $(".plaque--moi", sceneDuel);
  const vignette = $(".vignette", sceneDuel);
  const cible = { x: sceneDuel.clientWidth / 2, y: sceneDuel.clientHeight * 0.8 };
  const h = await hologramme(za, 89631139);
  const r = await rayon(boite(za), cible, C["camp-adverse"]);
  flash(sceneDuel, cible, "rgb(255 77 109 / 0.8)");
  anim(vignette, [{ opacity: 0 }, { opacity: 1 }], { duree: D1 }).then(() => anim(vignette, [{ opacity: 1 }, { opacity: 0 }], { duree: D4 }));
  secousse(moi, 6);
  degats(cible, "−3000");
  disparaitre(r);
  await compterLP(moi, 3000);
  await baisser(h);
}

async function ajouterMaillon(liste, n, code, texte, adverse) {
  const li = document.createElement("li");
  li.className = adverse ? "maillon-ligne maillon-ligne--adverse" : "maillon-ligne";
  li.innerHTML = `<span class="maillon${adverse ? " maillon--adverse" : ""}">${n}</span>${carte(code)}<p><b>${CARTES[code][0]}</b><span>${texte}</span></p>`;
  remplirCarte($(".carte", li));
  await Promise.all([
    deplacer([...liste.children], () => liste.prepend(li)),
    anim(li, [{ opacity: 0, transform: "translateY(-16px)" }, { opacity: 1, transform: "none" }]),
  ]);
}

async function retirerMaillon(li) {
  await anim(li, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(28px)" }], { duree: D2, courbe: ELAN });
  await deplacer([...li.parentElement.children].filter((x) => x !== li), () => li.remove());
}

async function resoudre(li, z) {
  const couleur = getComputedStyle($(".maillon", li)).backgroundColor;
  const m = $(".maillon", z);
  await Promise.all([
    anim(li, [{ boxShadow: `0 0 0 2px ${couleur}, 0 0 22px ${couleur}` }, { boxShadow: "0 0 0 0 transparent" }]),
    anim(m, [{ opacity: 1, transform: "scale(1.3)" }, { opacity: 0, transform: "scale(0)" }], { courbe: ELAN }).then(() => m.remove()),
  ]);
}

async function chaine() {
  const liste = $(".chaine ol", sceneDuel);
  const note = $(".chaine .note", sceneDuel);
  const z1 = zone("3-5");
  const z2 = zone("3-1");
  const c1 = $(".carte", z1);
  const c2 = $(".carte", z2);
  await activer(c1, z1, 1);
  await ajouterMaillon(liste, 1, 44095762, "Vous · détruit ses monstres en attaque", false);
  await pause(700, true);
  await retourner(c2, () => montrer(c2, 3819470));
  await activer(c2, z2, 2);
  const cout = compterLP($(".plaque--adverse", sceneDuel), 1000);
  await ajouterMaillon(liste, 2, 3819470, "Seto_K paie 1000 LP · annule Force de Miroir", true);
  await cout;
  await pause(600, true);
  const [l2, l1] = liste.children;
  note.textContent = "Maillon 2 : Force de Miroir est annulée et détruite.";
  await resoudre(l2, z2);
  l1.classList.add("est-annule");
  await Promise.all([detruire(c1, zone(CIMETIERE_MOI)), retirerMaillon(l2)]);
  note.textContent = "Maillon 1 : annulé, sans effet.";
  await resoudre(l1, z1);
  await Promise.all([retirerMaillon(l1), envoyer(c2, zone(CIMETIERE_ADV))]);
  note.textContent = "Chaîne résolue.";
}

/* Booster ---------------------------------------------------------------- */

const sceneBooster = $("#scene-booster");
const TIRAGE = [["75356564", "commune"], ["16956455", "rare"], ["38033121", "super"], ["89631139", "ultra", true], ["74677422", "ultimate"], ["46986414", "secret", true]];
const RARETES = TIRAGE.map(([, r]) => r);
const LIBELLES = new Map([["commune", "Commune"], ["rare", "Rare"], ["super", "Super Rare"], ["ultra", "Ultra Rare"], ["ultimate", "Ultimate Rare"], ["secret", "Secret Rare"]]);
const LUEURS = new Map([
  ["rare", "0 0 0 2px #dfe6f5, 0 0 22px rgb(223 230 245 / 0.5)"],
  ["super", "0 0 0 2px #43f0ff, 0 0 34px rgb(67 240 255 / 0.6)"],
  ["ultra", "0 0 0 2px #ffe08a, 0 0 60px 10px rgb(255 197 61 / 0.55)"],
  ["secret", "0 0 0 2px #ff7ad9, 0 0 60px 10px rgb(255 122 217 / 0.5), 0 0 120px rgb(67 240 255 / 0.35)"],
]);
const PAQUET = `<div class="paquet" style="--teinte: 222"><span class="paquet__bande"></span><span class="dechirure"></span>
  <span class="paquet__code">LOB</span><div class="paquet__fenetre"><img src="../assets/art/89631139.jpg" alt=""></div>
  <span class="paquet__nom">Legend of Blue Eyes White Dragon</span><span class="paquet__annee chiffres">2002</span></div>`;
let revelees = 0;

function construireBooster(avecPaquet = true) {
  sceneBooster.innerHTML = `<div class="rayons" aria-hidden="true"></div><div class="voile"></div>
  <div class="booster__tete"><p class="surtitre">Legend of Blue Eyes White Dragon</p><p class="chiffres ouverture__compte">0 / ${TIRAGE.length}</p></div>
  <div class="booster__centre">${avecPaquet ? PAQUET : ""}<div class="pile" hidden></div></div>
  <div class="revelation"><p class="revelation__rarete"></p><p class="puce puce--or" hidden>Nouvelle carte</p><p class="booster__aide">Ouvrez le booster.</p></div>
  <ol class="tirage" aria-label="Cartes révélées">${"<li></li>".repeat(TIRAGE.length)}</ol>
  <div class="couche"></div><p class="aide-scene">Cliquez pour passer</p>`;
  revelees = 0;
}

async function ouvrir() {
  construireBooster();
  const paquet = $(".paquet", sceneBooster);
  const pile = $(".pile", sceneBooster);
  const aide = $(".booster__aide", sceneBooster);
  const dechirure = $(".dechirure", paquet);
  aide.textContent = "";
  await anim(paquet, [{ opacity: 0, transform: "translateY(30px) scale(0.92)" }, { opacity: 1, transform: "none" }]);
  await anim(paquet, ["0deg", "-2.5deg", "2.5deg", "-1.5deg", "0deg"].map((r) => ({ rotate: r })), { courbe: "ease-in-out" });
  await anim(dechirure, [{ scale: "0 1" }, { scale: "1 1" }], { duree: D2, courbe: ELAN });
  paquet.classList.add("paquet--ouvert");
  flash(sceneBooster, boite(dechirure));
  await Promise.all([
    anim($(".paquet__bande", paquet), [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate(50px, -80px) rotate(24deg)" }], { courbe: ELAN }),
    anim(dechirure, [{ opacity: 1 }, { opacity: 0 }]),
  ]);
  pile.innerHTML = TIRAGE.map((_, i) => `<div class="carte dos" style="--i:${i}"></div>`).join("");
  pile.hidden = false;
  await Promise.all([
    anim(paquet, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(45%) scale(0.95)" }], { courbe: ELAN }),
    anim(pile, [{ opacity: 0, transform: "translateY(24px) scale(0.9)" }, { opacity: 1, transform: "none" }], { delai: D1 }),
  ]);
  paquet.remove();
  aide.textContent = "Touchez la pile pour révéler la carte suivante.";
}

async function ranger(v, li, [code, rarete, nouveau]) {
  li.innerHTML = carte(code, `r-${rarete}`) + (nouveau ? '<span class="nouveau">Nouveau</span>' : "");
  const place = $(".carte", li);
  remplirCarte(place);
  if (reduit()) {
    v.remove();
    await anim(li, [{ opacity: 0 }, { opacity: 1 }]);
    return;
  }
  place.style.opacity = "0";
  const vol = fantome(v);
  v.remove();
  await voler(vol, place);
  vol.remove();
  place.style.opacity = "";
}

const lueur = (c, rarete, duree) => anim(c, [{ boxShadow: getComputedStyle(c).boxShadow }, { boxShadow: LUEURS.get(rarete) }], { duree });
const trembler = (c, duree) => anim(c, [0, 2, -2, 2, -2, 1, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duree, courbe: "linear" });
const balayer = (c, duree = D4) => anim(c, [{ "--reflet-x": "0%", "--reflet-y": "10%" }, { "--reflet-x": "100%", "--reflet-y": "90%" }], { duree });

function rayons(prisme) {
  const r = $(".rayons", sceneBooster);
  r.classList.toggle("rayons--prisme", prisme);
  return anim(r, [{ opacity: 0 }, { opacity: 1 }], { duree: D4 });
}

function balaiArgent(c) {
  if (decor()) return;
  const b = boite(c);
  const e = dansCouche(sceneBooster, "balai-argent", { ...b, l: c.offsetWidth, h: c.offsetHeight });
  anim(e, [{ backgroundPosition: "120% 0" }, { backgroundPosition: "-20% 0" }], { duree: D4 }).then(() => e.remove());
}

function anneauPrisme(c) {
  if (decor()) return;
  const b = boite(c);
  const a = dansCouche(sceneBooster, "anneau-prisme", { ...b, l: b.h * 1.2, h: b.h * 1.2 });
  anim(a, [{ opacity: 1, transform: "scale(0.3)" }, { opacity: 0, transform: "scale(3.2)" }], { duree: D4 }).then(() => a.remove());
}

async function secretAvant(c) {
  await anim($(".voile", sceneBooster), [{ opacity: 0 }, { opacity: 1 }]);
  await Promise.all([lueur(c, "secret", D4), trembler(c, D4)]);
  await pause(D2);
  anneauPrisme(c);
  eclats(sceneBooster, boite(c), { n: 14, distance: 190, couleurs: PRISME });
  flash(sceneBooster, boite(c), "rgb(255 122 217 / 0.8)");
  rayons(true);
}

// Révélation graduée : anticipation, retournement, puis éclat selon la rareté
const REVELATIONS = new Map([
  ["commune", { flip: D2 }],
  ["rare", { avant: (c) => lueur(c, "rare", D2), flip: D2, apres: balaiArgent }],
  ["super", { avant: (c) => lueur(c, "super", D3), flip: D3, apres: (c) => Promise.all([balayer(c), ondeSur(c, C.holo)]) }],
  [
    "ultra",
    {
      avant: async (c) => {
        await Promise.all([lueur(c, "ultra", D3), trembler(c, D3)]);
        await pause(D2);
        flash(sceneBooster, boite(c), "rgb(255 197 61 / 0.85)");
        rayons(false);
      },
      flip: D3,
      apres: (c) => balayer(c),
    },
  ],
  [
    "ultimate",
    {
      avant: async (c) => {
        await Promise.all([lueur(c, "ultra", D4), trembler(c, D4)]);
        rayons(false);
      },
      flip: D4,
      apres: (c) =>
        Promise.all([
          balayer(c, D4 + D3),
          anim(c, [{ transform: "perspective(900px) rotateY(-26deg) rotateX(10deg)" }, { transform: "perspective(900px) rotateY(-8deg) rotateX(4deg)" }], { duree: D4 + D3 }),
        ]),
    },
  ],
  ["secret", { avant: secretAvant, flip: D3, apres: (c) => Promise.all([balayer(c), anim($(".voile", sceneBooster), [{ opacity: 1 }, { opacity: 0 }])]) }],
]);

async function reveler(c, [code, rarete, nouveau]) {
  const effet = REVELATIONS.get(rarete);
  const libelle = $(".revelation__rarete", sceneBooster);
  const puce = $(".revelation .puce", sceneBooster);
  const fort = RARETES.indexOf(rarete) >= 3;
  $(".ouverture__compte", sceneBooster).textContent = `${revelees} / ${TIRAGE.length}`;
  $(".booster__aide", sceneBooster).textContent = "";
  libelle.textContent = "";
  puce.hidden = true;
  await effet.avant?.(c);
  await retourner(c, () => montrer(c, code, `r-${rarete} vedette`), effet.flip);
  await effet.apres?.(c);
  libelle.dataset.r = rarete;
  libelle.textContent = LIBELLES.get(rarete);
  await anim(libelle, [{ opacity: 0, transform: `scale(${fort ? 1.5 : 1.1})` }, { opacity: 1, transform: "none" }], { courbe: fort ? RESSORT : SORTIE });
  if (!nouveau) return;
  puce.hidden = false;
  await anim(puce, [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], { duree: D2, courbe: RESSORT });
}

async function suivante() {
  const pile = $(".pile", sceneBooster);
  if (!pile || pile.hidden || !pile.children.length) return ouvrir();
  const vedette = $(".vedette", pile);
  if (vedette) await ranger(vedette, $(".tirage", sceneBooster).children[revelees - 1], TIRAGE[revelees - 1]);
  const c = pile.lastElementChild;
  if (c) {
    revelees += 1;
    await reveler(c, TIRAGE[revelees - 1]);
  } else {
    $(".booster__aide", sceneBooster).textContent = "Booster terminé. Touchez pour en ouvrir un autre.";
  }
}

async function revelerSeule(rarete) {
  construireBooster(false);
  const pile = $(".pile", sceneBooster);
  pile.innerHTML = '<div class="carte dos" style="--i:0"></div>';
  pile.hidden = false;
  revelees = RARETES.indexOf(rarete) + 1;
  await reveler(pile.firstElementChild, TIRAGE[revelees - 1]);
}

/* Écrans ----------------------------------------------------------------- */

const sceneEcrans = $("#scene-ecrans");
const barre = (courant) =>
  `<header class="mini-barre" data-entree><b>Duel Monsters</b>${["Accueil", "Collection et decks", "Boosters", "Mode Histoire"].map((n) => `<span${n === courant ? ' aria-current="page"' : ""}>${n}</span>`).join("")}</header>`;
const mode = (ic, nom) => `<div class="mini-mode" data-entree>${icone(ic)}${nom}</div>`;
const paquet = (teinte, code, art, nom) =>
  `<div class="paquet" data-entree style="--teinte: ${teinte}"><span class="paquet__code">${code}</span><div class="paquet__fenetre"><img src="../assets/art/${art}.jpg" alt=""></div><span class="paquet__nom">${nom}</span></div>`;
const ECRANS = new Map([
  [
    "accueil",
    `<div class="mini-ecran" aria-hidden="true">${barre("Accueil")}<div class="mini-corps">
      <p class="surtitre" data-entree>Bonsoir, Pharaon_08</p><p class="titre" data-entree>Prêt pour le duel ?</p>
      <div class="mini-modes">${mode("ui-duel", "Jouer en ligne")}${mode("ui-bot", "Contre le bot")}${mode("ui-booster", "Boosters")}${mode("ui-histoire", "Mode Histoire")}</div>
      <span class="btn btn--grand" data-entree>Lancer un duel</span></div></div>`,
  ],
  [
    "boosters",
    `<div class="mini-ecran" aria-hidden="true">${barre("Boosters")}<div class="mini-corps">
      <p class="surtitre" data-entree>3 boosters à ouvrir</p><p class="titre" data-entree>Boosters</p>
      <div class="mini-paquets">${paquet(12, "FET", 61441708, "Flammes Éternelles")}${paquet(222, "LOB", 89631139, "Legend of Blue Eyes")}${paquet(280, "MRD", 70781052, "Metal Raiders")}</div>
      <span class="btn btn--grand" data-entree>Ouvrir un booster</span></div></div>`,
  ],
]);
let ecranCourant = "accueil";

function construireEcran() {
  sceneEcrans.innerHTML = `${ECRANS.get(ecranCourant)}<div class="balayage"></div><div class="couche"></div><p class="aide-scene">Cliquez pour passer</p>`;
}

async function entree() {
  const blocs = [...$(".mini-ecran", sceneEcrans).querySelectorAll("[data-entree]")];
  await Promise.all(blocs.map((b, i) => anim(b, [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }], { delai: i * 60 })));
}

async function changer() {
  const actuel = $(".mini-ecran", sceneEcrans);
  await anim(actuel, [{ opacity: 1, transform: "none", filter: "blur(0)" }, { opacity: 0, transform: "scale(0.98)", filter: "blur(4px)" }], { duree: D2, courbe: ELAN });
  ecranCourant = ecranCourant === "accueil" ? "boosters" : "accueil";
  actuel.outerHTML = ECRANS.get(ecranCourant);
  if (!decor()) {
    const b = $(".balayage", sceneEcrans);
    anim(b, [{ opacity: 1, transform: "none" }, { opacity: 0.2, transform: `translateY(${sceneEcrans.clientHeight}px)` }]);
  }
  await entree();
}

/* Fin de duel ------------------------------------------------------------ */

const sceneFin = $("#scene-fin");
const FINS = new Map([
  [
    "victoire",
    `<div class="rayons" aria-hidden="true"></div><div class="fin">
      <p class="surtitre surtitre--or">Battle City · Duel 5 sur 5</p><h3 class="fin__titre">Victoire</h3>
      <p class="fin__score"><span class="chiffres">1850</span> LP restants · tour <span class="chiffres">9</span></p>
      <div class="fin__gains"><div class="recompense"><span class="mini-paquet" aria-hidden="true"></span><span class="mini-paquet" aria-hidden="true"></span><b>2 boosters</b></div>
      <div class="recompense recompense--vedette">${carte(511600399, "r-ultra")}<b>${CARTES[511600399][0]}</b><span class="puce puce--or">Nouvelle carte</span></div></div>
      <div class="fin__actions"><span class="btn btn--grand">Ouvrir mes boosters</span><span class="btn btn--fantome">Retour à l'histoire</span></div></div>`,
  ],
  [
    "defaite",
    `<div class="fin">
      <p class="surtitre">Duel en ligne · salle K7QX2</p><h3 class="fin__titre">Défaite</h3>
      <p class="fin__score">Seto_K l'emporte au tour <span class="chiffres">11</span> avec <span class="chiffres">600</span> LP</p>
      <div class="fin__coup">${carte(89631139)}<p><span class="surtitre">Coup final</span><b>${CARTES[89631139][0]}</b><span class="texte-2">attaque directe, 3000 points de dégâts</span></p></div>
      <div class="fin__actions"><span class="btn btn--grand btn--holo">Retour à l'accueil</span><span class="btn btn--fantome">Modifier mon deck</span></div></div>`,
  ],
]);
const MONTER = [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }];

function construireFin(type) {
  sceneFin.classList.toggle("ecran--defaite", type === "defaite");
  sceneFin.innerHTML = `${FINS.get(type)}<div class="couche"></div><p class="aide-scene">Cliquez pour passer</p>`;
  remplirTout(sceneFin);
}

async function victoire() {
  construireFin("victoire");
  const [surtitre, titre, score, gains, actions] = $(".fin", sceneFin).children;
  await Promise.all([
    anim($(".rayons", sceneFin), [{ opacity: 0 }, { opacity: 1 }], { duree: D4 + D3 }),
    anim(surtitre, MONTER),
    anim(titre, [{ opacity: 0, transform: "scale(1.35)", letterSpacing: "0.35em" }, { opacity: 1, transform: "none", letterSpacing: "0.02em" }], { duree: D4, delai: D1 }),
    anim(score, MONTER, { delai: D4 }),
    ...[...gains.children].map((g, i) => anim(g, [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], { courbe: RESSORT, delai: D4 + D2 + i * 150 })),
    anim(actions, MONTER, { duree: D2, delai: D4 + D4 }),
  ]);
}

async function defaite() {
  construireFin("defaite");
  const [surtitre, titre, score, coup, actions] = $(".fin", sceneFin).children;
  const ombre = "drop-shadow(0 0 30px rgb(255 106 136 / 0.35))";
  await Promise.all([
    anim(surtitre, MONTER),
    anim(titre, [{ opacity: 0, transform: "translateY(-28px)", filter: "blur(8px) drop-shadow(0 0 0 transparent)" }, { opacity: 1, transform: "none", filter: `blur(0) ${ombre}` }], { duree: D4 + D3, delai: D2 }),
    anim(titre, [{ translate: "0 0" }, { translate: "-3px 0" }, { translate: "2px 0" }, { translate: "0 0" }], { duree: D2, courbe: "steps(3)", delai: D2 + D4 + D3 }),
    anim(score, MONTER, { delai: D4 + D2 }),
    anim(coup, [{ opacity: 0, transform: "translateX(-24px)" }, { opacity: 1, transform: "none" }], { delai: D4 + D3 }),
    anim(actions, MONTER, { delai: D4 + D4 }),
  ]);
}

/* Commandes -------------------------------------------------------------- */

const duel = (fn) => () => {
  construireDuel();
  return fn();
};
const ACTIONS = new Map([
  ["pioche", [sceneDuel, "Pioche", duel(pioche)]],
  ["phase", [sceneDuel, "Changement de phase", duel(phase)]],
  ["tour", [sceneDuel, "Changement de tour", duel(tour)]],
  ["invocation", [sceneDuel, "Invocation normale", duel(invocation)]],
  ["sacrifice", [sceneDuel, "Invocation Sacrifice", duel(sacrifice)]],
  ["fusion", [sceneDuel, "Invocation Fusion", duel(fusion)]],
  ["dieu", [sceneDuel, "Invocation d'un Dieu Égyptien", duel(dieu)]],
  ["poser", [sceneDuel, "Carte posée face cachée", duel(poser)]],
  ["retourner", [sceneDuel, "Retournement", duel(retournement)]],
  ["attaque", [sceneDuel, "Attaque et destruction", duel(attaque)]],
  ["directe", [sceneDuel, "Attaque directe", duel(directe)]],
  ["chaine", [sceneDuel, "Activation et chaîne", duel(chaine)]],
  ["ouvrir", [sceneBooster, "Ouverture du booster", ouvrir]],
  ["suivante", [sceneBooster, "Carte suivante", suivante]],
  ["changer", [sceneEcrans, "Changement d'écran", changer]],
  ["entree", [sceneEcrans, "Entrée d'écran", entree]],
  ["victoire", [sceneFin, "Victoire", victoire]],
  ["defaite", [sceneFin, "Défaite", defaite]],
]);

for (const b of document.querySelectorAll("[data-seq]")) b.addEventListener("click", () => lancer(...ACTIONS.get(b.dataset.seq)));
for (const b of document.querySelectorAll("[data-rarete]")) {
  b.addEventListener("click", () => lancer(sceneBooster, `Révélation ${LIBELLES.get(b.dataset.rarete)}`, () => revelerSeule(b.dataset.rarete)));
}
for (const s of [sceneDuel, sceneEcrans, sceneFin]) {
  s.addEventListener("click", () => {
    if (s.hasAttribute("aria-busy")) passer();
  });
}
sceneBooster.addEventListener("click", () => {
  if (sceneBooster.hasAttribute("aria-busy")) passer();
  else lancer(sceneBooster, "Carte suivante", suivante);
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && seq.fin) passer();
});

// Survol holographique : le reflet suit le pointeur, la carte s'incline (pas en réduction)
for (const c of document.querySelectorAll("[data-survol]")) {
  c.addEventListener("pointermove", (e) => {
    const r = c.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    c.style.setProperty("--reflet-x", `${px * 100}%`);
    c.style.setProperty("--reflet-y", `${py * 100}%`);
    c.style.transform = reduit() ? "" : `perspective(700px) rotateY(${(px - 0.5) * 18}deg) rotateX(${(0.5 - py) * 14}deg)`;
  });
  c.addEventListener("pointerleave", () => {
    c.style.removeProperty("--reflet-x");
    c.style.removeProperty("--reflet-y");
    c.style.transform = "";
  });
}

construireDuel();
construireBooster();
construireEcran();
construireFin("victoire");
