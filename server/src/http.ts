import { createReadStream, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { BOOSTERS } from "./boosters.ts";
import { clientCard, RULE_CARDS } from "./cards.ts";
import { CRAFT_COSTS } from "./economy.ts";
import { POOL, SETS } from "./pool.ts";
import type { CardInfo } from "./protocol.ts";
import { serveClient } from "./site.ts";
import { starterCards } from "./starter.ts";
import { STORY } from "./story.ts";
import { systemStrings } from "./strings.ts";
import { ART_DIR, ensureThumb, THUMB_WIDTHS } from "./thumbs.ts";

export const artFile = (code: number) => join(ART_DIR, `${code}.jpg`);
// The artwork (<code>.jpg) or one of its thumbnails (<code>-<width>.webp).
const ART_URL = /^\/api\/art\/(\d{1,10})(?:-(\d{3})\.webp|\.jpg)$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
// The pool, the anime cards of the story opponents and the rule cards.
export const SERVED: ReadonlySet<number> = new Set([...POOL, ...STORY.anime, ...RULE_CARDS.keys()]);
// The served cards with an artwork to download: not the rule cards, nor the Deck Master System of the Noah arc (153000000).
export const ARTWORKS: ReadonlySet<number> = new Set([...POOL, ...STORY.anime].filter((code) => code !== 153000000));
let cardList: [number, Omit<CardInfo, "image">][] | undefined;

function cardInfos() {
  cardList ??= [...SERVED].flatMap((code) => {
    const info = clientCard(code);
    return info ? [[code, info] as const] : [];
  });
  return Object.fromEntries(cardList.map(([code, info]) => [code, { ...info, image: existsSync(artFile(code)) } satisfies CardInfo]));
}

// The JSON answers of the API, by URL.
const API = new Map<string | undefined, () => unknown>([
  ["/api/cards", cardInfos],
  ["/api/strings", () => Object.fromEntries(systemStrings())],
  ["/api/starters", () => ({ yugi: starterCards("yugi"), kaiba: starterCards("kaiba") })],
  ["/api/boosters", () => [...BOOSTERS.values()].map(({ code, name, date }) => ({ code, name, date }))],
  // Points to obtain each booster card as [passcode, cost].
  ["/api/craft", () => [...CRAFT_COSTS]],
  // Boosters then starter decks, each passcode once per set (an Ultimate Rare variant repeats it).
  ["/api/sets", () => SETS.map(({ code, name, date, cards }) => ({ code, name, date, cards: [...new Set(cards.map((card) => card.code))] }))],
]);

function sendThumb(res: ServerResponse, code: number, width: number) {
  ensureThumb(artFile(code), code, width).then(
    (file) => {
      res.writeHead(200, { "content-type": "image/webp", "cache-control": IMMUTABLE });
      createReadStream(file).pipe(res);
    },
    () => res.writeHead(404).end(),
  );
}

// Card data, system strings and artworks for the client (see CardInfo). Artworks are optional: `pnpm images` downloads them.
export function serveHttp(req: IncomingMessage, res: ServerResponse) {
  const api = req.method === "GET" ? API.get(req.url) : undefined;
  if (api) {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(api()));
    return;
  }
  const art = ART_URL.exec(req.url ?? "");
  const code = Number(art?.[1]);
  if (req.method === "GET" && SERVED.has(code) && existsSync(artFile(code))) {
    const width = Number(art?.[2] ?? 0);
    if (width === 0) {
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=86400" });
      createReadStream(artFile(code)).pipe(res);
    } else if (THUMB_WIDTHS.has(width)) {
      sendThumb(res, code, width);
    } else {
      res.writeHead(404).end();
    }
    return;
  }
  if (serveClient(req, res)) return;
  res.writeHead(404).end();
}
