// Sound effects synthesized with Web Audio (no audio file): short notes and filtered noise, played from the duel effects.
import type { Effet } from "./plateau3d/effets.ts";
import { FACTEUR, reglages } from "./reglages.ts";

export type Son = "pioche" | "invocation" | "pose" | "activation" | "attaque" | "degats" | "destruction" | "gain" | "victoire" | "defaite" | "clic";

// A tone gliding from `de` to `vers` Hz, `debut` seconds after the sound starts.
type Ton = { type: OscillatorType; de: number; vers?: number; duree: number; debut?: number; gain?: number };
// Noise through a filter whose frequency glides from `de` to `vers`.
type Souffle = { filtre: BiquadFilterType; de: number; vers?: number; duree: number; debut?: number; gain?: number };
type Partition = { tons?: Ton[]; souffles?: Souffle[] };

const arpege = (type: OscillatorType, notes: number[], pas: number, duree: number): Ton[] => notes.map((de, i) => ({ type, de, duree, debut: i * pas }));

const PARTITIONS: Record<Son, Partition> = {
  pioche: { souffles: [{ filtre: "bandpass", de: 1800, vers: 5000, duree: 0.12 }] },
  invocation: {
    tons: [
      { type: "triangle", de: 300, vers: 600, duree: 0.25 },
      { type: "sine", de: 600, vers: 900, duree: 0.2, debut: 0.08, gain: 0.6 },
    ],
  },
  pose: { tons: [{ type: "sine", de: 180, vers: 90, duree: 0.1 }], souffles: [{ filtre: "lowpass", de: 900, duree: 0.05, gain: 0.5 }] },
  activation: { tons: arpege("sine", [660, 990, 1320], 0.06, 0.1) },
  attaque: { tons: [{ type: "sawtooth", de: 400, vers: 120, duree: 0.18, gain: 0.5 }], souffles: [{ filtre: "highpass", de: 3000, vers: 600, duree: 0.2 }] },
  degats: { tons: [{ type: "square", de: 160, vers: 60, duree: 0.25, gain: 0.6 }] },
  destruction: { tons: [{ type: "sine", de: 120, vers: 40, duree: 0.3 }], souffles: [{ filtre: "lowpass", de: 1200, vers: 200, duree: 0.4 }] },
  gain: { tons: arpege("sine", [523, 784], 0.1, 0.14) },
  victoire: { tons: arpege("triangle", [523, 659, 784, 1047], 0.12, 0.3) },
  defaite: { tons: arpege("triangle", [392, 330, 262, 196], 0.18, 0.35) },
  clic: { tons: [{ type: "sine", de: 900, vers: 600, duree: 0.03, gain: 0.7 }] },
};

// The sound of an effect for the player in `seat`: damage and healing are heard for their own life points only.
export function sonDe(effet: Effet, seat: number): Son | undefined {
  switch (effet.type) {
    case "pioche":
    case "invocation":
    case "pose":
    case "activation":
    case "attaque":
      return effet.type;
    case "depart":
      return effet.genre === "destruction" ? "destruction" : undefined;
    case "lp":
      if (effet.joueur !== seat) return undefined;
      return effet.delta < 0 ? "degats" : "gain";
    default:
      return undefined;
  }
}

// Master level of a sound: discreet even at 100.
const NIVEAU = 0.3;
// Instant speed: sounds closer than this (seconds) are dropped instead of stacked.
const ECART = 0.12;
const NOTE = 0.0001;

let contexte: AudioContext | undefined;
let bruit: AudioBuffer | undefined;
let libre = 0;
let debloque = false;

// A first user gesture allows sound: the AudioContext is created or resumed only then (autoplay policy).
export function debloquer() {
  debloque = true;
  const Contexte = globalThis.AudioContext;
  if (!Contexte) return;
  contexte ??= new Contexte();
  if (contexte.state === "suspended") void contexte.resume();
}

function enveloppe(c: AudioContext, sortie: AudioNode, debut: number, duree: number, niveau: number) {
  const gain = c.createGain();
  gain.gain.setValueAtTime(NOTE, debut);
  gain.gain.exponentialRampToValueAtTime(niveau, debut + Math.min(0.01, duree / 2));
  gain.gain.exponentialRampToValueAtTime(NOTE, debut + duree);
  gain.connect(sortie);
  return gain;
}

function glisse(param: AudioParam, de: number, vers: number | undefined, debut: number, duree: number) {
  param.setValueAtTime(de, debut);
  if (vers) param.exponentialRampToValueAtTime(vers, debut + duree);
}

function ton(c: AudioContext, sortie: AudioNode, t: number, { type, de, vers, duree, debut = 0, gain = 1 }: Ton) {
  const osc = c.createOscillator();
  osc.type = type;
  glisse(osc.frequency, de, vers, t + debut, duree);
  osc.connect(enveloppe(c, sortie, t + debut, duree, gain));
  osc.start(t + debut);
  osc.stop(t + debut + duree);
}

// Half a second of white noise from a small fixed generator, so every play sounds the same.
function nouveauBruit(c: AudioContext): AudioBuffer {
  const tampon = c.createBuffer(1, c.sampleRate / 2, c.sampleRate);
  const data = tampon.getChannelData(0);
  let graine = 1;
  for (let i = 0; i < data.length; i++) {
    graine = (graine * 16807) % 2147483647;
    data[i] = graine / 1073741823.5 - 1;
  }
  return tampon;
}

function souffle(c: AudioContext, sortie: AudioNode, t: number, { filtre, de, vers, duree, debut = 0, gain = 1 }: Souffle) {
  const source = c.createBufferSource();
  bruit ??= nouveauBruit(c);
  source.buffer = bruit;
  const filter = c.createBiquadFilter();
  filter.type = filtre;
  glisse(filter.frequency, de, vers, t + debut, duree);
  source.connect(filter);
  filter.connect(enveloppe(c, sortie, t + debut, duree, gain));
  source.start(t + debut);
  source.stop(t + debut + duree);
}

// Plays a sound at the volume of the settings; nothing before a user gesture, when muted or at volume 0.
export function jouer(son: Son) {
  const { son: actif, volume, vitesse } = reglages();
  if (!debloque || actif === "coupe" || volume === 0 || !contexte) return;
  const t = contexte.currentTime;
  if (FACTEUR[vitesse] === Infinity) {
    if (t < libre) return;
    libre = t + ECART;
  }
  const sortie = contexte.createGain();
  sortie.gain.value = (volume / 100) * NIVEAU;
  sortie.connect(contexte.destination);
  const { tons = [], souffles = [] } = PARTITIONS[son];
  for (const note of tons) ton(contexte, sortie, t, note);
  for (const bruitee of souffles) souffle(contexte, sortie, t, bruitee);
}

// The first gesture unlocks the sound; a click on a button of the question panel makes a small click.
if (globalThis.document) {
  for (const evenement of ["pointerdown", "keydown"]) globalThis.addEventListener(evenement, debloquer, { capture: true, once: true });
  globalThis.document.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest?.(".question button")) jouer("clic");
  });
}
