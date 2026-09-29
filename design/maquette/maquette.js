// Remplit les cartes de la maquette depuis les vraies données (design/assets/cartes.js, généré par copier-assets.mts).
import { CARTES } from "../assets/cartes.js";

const SPRITE = "../icons.svg";
const SANS_STATS = new Set(["magie", "piege"]);
const NOMS_ATTR = new Map([["lumiere", "LUMIÈRE"], ["tenebres", "TÉNÈBRES"], ["terre", "TERRE"], ["eau", "EAU"], ["feu", "FEU"], ["vent", "VENT"], ["divin", "DIVIN"]]);
const stat = (valeur) => (valeur === -2 ? "?" : String(valeur));
const icone = (id) => `<svg class="ic" aria-hidden="true"><use href="${SPRITE}#${id}"/></svg>`;

export function remplirCarte(el) {
  const code = el.dataset.carte;
  const [nom, cadre, attr, niveau, atk, def, type] = CARTES[code];
  const monstre = !SANS_STATS.has(cadre);
  el.classList.add(`t-${cadre}`);
  if (attr) el.classList.add(`a-${attr}`);
  const stats = monstre ? `<p class="carte__stats"><span>ATK<b>${stat(atk)}</b></span><span>DEF<b>${stat(def)}</b></span></p>` : "";
  el.innerHTML = `<div class="carte__art"><img src="../assets/art/${code}.jpg" alt="" draggable="false"></div>
    <span class="carte__attr">${icone(monstre ? `attr-${attr}` : `type-${cadre}`)}</span>
    ${monstre ? `<span class="carte__niveau" aria-label="Niveau ${niveau}">${niveau}</span>` : ""}
    <div class="carte__infos"><p class="carte__nom">${nom}</p><p class="carte__type">${type}</p>${stats}</div>`;
}

function remplirDetail(el) {
  const code = el.dataset.detail;
  const [nom, cadre, attr, niveau, atk, def, type, texte] = CARTES[code];
  const monstre = !SANS_STATS.has(cadre);
  const meta = monstre ? `${NOMS_ATTR.get(attr)} · Niveau ${niveau} · ${type}` : type;
  const saveur = cadre === "normal" ? " saveur" : "";
  el.innerHTML = `<div class="carte ${el.dataset.rarete ?? ""}" data-carte="${code}"></div>
    <div class="detail__texte">
      <h3>${nom}</h3>
      <p class="detail__meta">${meta}</p>
      ${monstre ? `<p class="detail__stats">ATK <b>${stat(atk)}</b> DEF <b>${stat(def)}</b></p>` : ""}
      <p class="detail__desc${saveur}">${texte.replaceAll("\n", "<br>")}</p>
    </div>`;
}

for (const el of document.querySelectorAll("[data-detail]")) remplirDetail(el);
for (const el of document.querySelectorAll("[data-carte]")) remplirCarte(el);
for (const el of document.querySelectorAll("[data-nom]")) el.textContent = CARTES[el.dataset.nom][0];

// Rail de navigation : repère l'écran affiché.
function marquerEcran() {
  const ecran = location.hash || "#accueil";
  for (const lien of document.querySelectorAll(".rail a")) {
    if (lien.getAttribute("href") === ecran) lien.setAttribute("aria-current", "page");
    else lien.removeAttribute("aria-current");
  }
  // Le journal montre toujours la dernière entrée.
  for (const journal of document.querySelectorAll(".journal ol")) journal.scrollTop = journal.scrollHeight;
}

addEventListener("hashchange", marquerEcran);
document.fonts.ready.then(marquerEcran);

