// Service worker : les pages passent toujours par le réseau (jamais de vieille version), seuls les fichiers hachés et les illustrations sont gardés.
// Le build remplace la fin du nom du cache (vite.config.ts) : chaque déploiement change ce fichier, le jeu propose alors la mise à jour.
const COQUE = "coque-__BUILD__";
const ILLUSTRATIONS = "illustrations";
const ILLUSTRATIONS_MAX = 500;
const HORS_LIGNE = "/hors-ligne.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(COQUE).then((cache) => cache.add(HORS_LIGNE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((nom) => nom !== COQUE && nom !== ILLUSTRATIONS).map((nom) => caches.delete(nom))))
      .then(() => self.clients.claim()),
  );
});

// Le joueur accepte la mise à jour : la nouvelle version prend la main.
self.addEventListener("message", (event) => {
  if (event.data === "activer") self.skipWaiting();
});

async function cacheDabord(event, nom, max = Infinity) {
  const cache = await caches.open(nom);
  const connue = await cache.match(event.request);
  if (connue) return connue;
  const reponse = await fetch(event.request);
  // Une page de repli renvoyée à la place d'un fichier absent n'est pas gardée.
  if (reponse.ok && !reponse.headers.get("content-type")?.startsWith("text/html")) {
    event.waitUntil(
      cache.put(event.request, reponse.clone()).then(async () => {
        const cles = await cache.keys();
        await Promise.all(cles.slice(0, Math.max(0, cles.length - max)).map((cle) => cache.delete(cle)));
      }),
    );
  }
  return reponse;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const { origin, pathname } = new URL(request.url);
  if (request.method !== "GET" || origin !== location.origin) return;
  if (request.mode === "navigate") event.respondWith(fetch(request).catch(() => caches.match(HORS_LIGNE)));
  else if (pathname.startsWith("/assets/")) event.respondWith(cacheDabord(event, COQUE));
  else if (pathname.startsWith("/api/art/")) event.respondWith(cacheDabord(event, ILLUSTRATIONS, ILLUSTRATIONS_MAX));
});

// Un clic sur une notification (voir notifications.ts) ramène le joueur dans le jeu, sur l'écran concerné.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { page } = event.notification.data ?? {};
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
      const [fenetre] = fenetres;
      if (!fenetre) return self.clients.openWindow("/");
      fenetre.postMessage({ type: "ouvrir", page });
      return fenetre.focus();
    }),
  );
});
