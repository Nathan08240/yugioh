const FENETRE = 0.3;
const NOMBRE = 10;
const SEUIL = 45;

// Calls `onLent` once when more than 3/4 of 10 windows of 0.3 s run under 45 frames per second.
// Fed only with the frames that follow one another: idle time is not slowness, and a gap over 1 s (hidden tab) is skipped.
export function surveillant(onLent: () => void) {
  let duree = 0;
  let images = 0;
  let lentes = 0;
  let fenetres = 0;
  let fini = false;
  return (dt: number) => {
    if (fini || dt > 1) return;
    duree += dt;
    images++;
    if (duree < FENETRE) return;
    if (images / duree < SEUIL) lentes++;
    duree = 0;
    images = 0;
    if (++fenetres < NOMBRE) return;
    if (lentes > NOMBRE * 0.75) {
      fini = true;
      onLent();
    }
    fenetres = 0;
    lentes = 0;
  };
}
